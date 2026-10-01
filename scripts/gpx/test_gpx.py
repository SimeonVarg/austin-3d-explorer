#!/usr/bin/env python3
"""Synthetic-only checks, including a full day against the real public graph."""

from __future__ import annotations
import contextlib
import io
import json
import math
import random
import statistics
import tempfile
import unittest
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

from evidence import analyze, candidates_from, detect_doors, match_walk
from geometry import distance, in_polygon, lonlat, nearest_wall, xy
from import_gpx import main
from models import Door, Fix, REPO, Settings
from output import write_outputs
from scene import Building, Scene
from tracks import Privacy, drop_vehicles, read_tracks, repository_roots, require_external

EPOCH = datetime(2000, 1, 1, 12, tzinfo=timezone.utc)


def interpolate(start, end, fraction):
    return tuple(start[axis] + (end[axis] - start[axis]) * fraction for axis in (0, 1))


def sample_route(vertices, start_seconds, scene, seed=42, speed=1.35, noise=True):
    randomizer = random.Random(seed)
    points = []
    elapsed = start_seconds
    for start, end in zip(vertices, vertices[1:]):
        span = distance(start, end)
        steps = max(1, math.ceil(span / (speed * 4)))
        for index in range(steps):
            ideal = interpolate(start, end, index / steps)
            wall_distance = min((nearest_wall(ideal, building.polygons)[0] for building in scene.near_buildings(ideal, 25)), default=100)
            accuracy = 15.0 if wall_distance < 20 else 5.0
            perturbed = tuple(component + (randomizer.gauss(0, accuracy / math.sqrt(2)) if noise else 0)
                              for component in ideal)
            points.append((perturbed, EPOCH + timedelta(seconds=elapsed + span / speed * index / steps), accuracy))
        elapsed += span / speed
    points.append((vertices[-1], EPOCH + timedelta(seconds=elapsed), 5.0))
    return points


def write_gpx(path, segments):
    root = ET.Element("gpx", {"xmlns": "http://www.topografix.com/GPX/1/1", "version": "1.1", "creator": "synthetic-test"})
    track = ET.SubElement(root, "trk")
    for points in segments:
        segment = ET.SubElement(track, "trkseg")
        for index, (position, timestamp, accuracy) in enumerate(points):
            longitude, latitude = lonlat(position)
            element = ET.SubElement(segment, "trkpt", {"lat": str(latitude), "lon": str(longitude)})
            ET.SubElement(element, "time").text = timestamp.isoformat()
            ET.SubElement(element, "ele").text = "150.0"
            if index % 2:
                ET.SubElement(element, "hdop").text = str(accuracy / 5)
            else:
                extension = ET.SubElement(element, "extensions")
                ET.SubElement(extension, "{urn:synthetic}accuracy", {"unit": "m"}).text = str(accuracy)
    ET.ElementTree(root).write(path, encoding="utf-8", xml_declaration=True)


def choose_through(scene):
    groups = defaultdict(list)
    for door in scene.doors:
        if door.building in scene.building_by_id:
            groups[door.building].append(door)
    for identifier, doors in groups.items():
        building = scene.building_by_id[identifier]
        for first in doors:
            for second in doors:
                span = distance(first.position, second.position)
                if first.identifier >= second.identifier or not 40 < span < 110:
                    continue
                inside = [interpolate(first.position, second.position, fraction / 20) for fraction in range(1, 20)]
                if sum(building.contains(position) for position in inside) >= 18 and statistics.median(nearest_wall(position, building.polygons)[0] for position in inside) > 12:
                    return building, first, second
    raise AssertionError("Public scene has no suitable synthetic through-building fixture")


def choose_graph_route(scene, center):
    for index, edge in sorted(enumerate(scene.graph.edges), key=lambda pair: pair[1][2], reverse=True):
        if edge[3] or edge[2] < 180:
            continue
        start, end = (scene.graph.nodes[node] for node in edge[:2])
        if distance(center, start) > 1400:
            continue
        positions = [interpolate(start, end, fraction / 20) for fraction in range(21)]
        if all(not any(building.contains(position) for building in scene.near_buildings(position, 0)) for position in positions):
            return [start, end], index
    raise AssertionError("No outdoor real-graph test route")


def choose_shortcut(scene, center):
    for radius in (150, 300, 500, 800):
        for offset_y in range(-radius, radius + 1, 20):
            for offset_x in range(-radius, radius + 1, 20):
                start = (center[0] + offset_x, center[1] + offset_y)
                end = (start[0] + 65, start[1])
                positions = [interpolate(start, end, fraction / 8) for fraction in range(9)]
                if all(scene.graph.nearest_distance(position) > 24 and
                       not any(building.contains(position) for building in scene.near_buildings(position, 0)) for position in positions):
                    return [start, end]
    raise AssertionError("No off-graph synthetic shortcut fixture")


def choose_new_door(scene, center):
    for building in sorted(scene.buildings, key=lambda building: distance(building.polygons[0][0][0], center)):
        doors = [door for door in scene.doors if door.building == building.identifier]
        for rings in building.polygons:
            for start, end in zip(rings[0], rings[0][1:]):
                span = distance(start, end)
                if span < 35:
                    continue
                wall = interpolate(start, end, 0.5)
                if any(distance(wall, door.position) < 35 for door in doors):
                    continue
                normal = (-(end[1] - start[1]) / span, (end[0] - start[0]) / span)
                for sign in (-1, 1):
                    inside = tuple(wall[axis] + normal[axis] * sign * 30 for axis in (0, 1))
                    outside = tuple(wall[axis] - normal[axis] * sign * 40 for axis in (0, 1))
                    if building.contains(inside) and nearest_wall(inside, building.polygons)[0] > 15 and not building.contains(outside):
                        return [outside, wall, inside], building.identifier
    raise AssertionError("No synthetic unmapped-wall fixture")


def synthetic_day(directory, scene, seed=42):
    directory = require_external(directory, repository_roots(), "Synthetic scratch directory")
    directory.mkdir(parents=True, exist_ok=True)
    building, first, second = choose_through(scene)
    vector = tuple((second.position[axis] - first.position[axis]) / distance(first.position, second.position) for axis in (0, 1))
    outside_first = tuple(first.position[axis] - vector[axis] * 35 for axis in (0, 1))
    outside_second = tuple(second.position[axis] + vector[axis] * 35 for axis in (0, 1))
    through_vertices = [outside_first, first.position, second.position, outside_second]
    route, route_edge = choose_graph_route(scene, first.position)
    shortcut = choose_shortcut(scene, first.position)
    new_door_vertices, new_building = choose_new_door(scene, first.position)
    segments = [sample_route(route, 0, scene, seed), sample_route(through_vertices, 600, scene, seed + 1),
                sample_route(shortcut, 1200, scene, seed + 2), sample_route(new_door_vertices, 1800, scene, seed + 3)]
    dwell_start = segments[3][-1][1]
    randomizer = random.Random(seed + 99)
    segments[3].extend((tuple(component + randomizer.gauss(0, 15 / math.sqrt(2)) for component in new_door_vertices[-1]),
                        dwell_start + timedelta(seconds=index * 4), 15) for index in range(1, 7))
    driving = sample_route(route, 2400, scene, seed + 4, speed=9.0)
    segments.append(driving)
    private_center = (first.position[0] - 100, first.position[1] - 100)
    circles = [{"lat": lonlat(private_center)[1], "lon": lonlat(private_center)[0], "radius_m": 30}]
    private_points = [(tuple(private_center[axis] + 2 * math.sin(index + axis) for axis in (0, 1)),
                       EPOCH + timedelta(seconds=3000 + index * 4), 5.0) for index in range(12)]
    segments.append(private_points)
    outside = xy((scene.bounds[0] - 0.01, scene.bounds[1] - 0.01))
    segments.append([(outside, EPOCH + timedelta(seconds=3100 + index * 4), 5) for index in range(3)])
    approach = sample_route([outside_first, first.position], 3600, scene, seed + 5)
    bad = [(interpolate(first.position, second.position, (index + 1) / 8), EPOCH + timedelta(seconds=3640 + index * 4), 75)
           for index in range(7)]
    recovery = sample_route([second.position, outside_second], 3690, scene, seed + 6)
    segments.append(approach + bad + recovery)
    path = directory / "synthetic-day.gpx"
    privacy_path = directory / "privacy-circles.json"
    write_gpx(path, segments)
    privacy_path.write_text(json.dumps(circles), encoding="utf-8")
    return {"path": path, "privacy_path": privacy_path, "circles": circles, "private_count": len(private_points),
            "driving_count": len(driving), "known_door": first, "exit_door": second,
            "building": building, "new_building": new_building, "route_edge": route_edge, "segments": segments}


class GPXTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.scene = Scene()
        cls.settings = Settings()
        cls.scratch = tempfile.TemporaryDirectory(prefix="gpx-synthetic-")
        cls.day = synthetic_day(Path(cls.scratch.name), cls.scene)
        cls.privacy = Privacy(cls.day["circles"], cls.scene.bounds)
        cls.result = analyze([cls.day["path"]], cls.scene, cls.privacy, cls.settings)

    @classmethod
    def tearDownClass(cls):
        cls.scratch.cleanup()

    def test_privacy_and_driving_removed(self):
        stats = self.result["stats"]
        self.assertEqual(stats["privacy"], self.day["private_count"])
        self.assertEqual(stats["outside_area"], 3)
        self.assertGreaterEqual(stats["vehicle"], self.day["driving_count"] - 2)
        self.assertEqual(stats["poor_accuracy"], 7)
        for walk in self.result["walks"]:
            self.assertTrue(self.privacy.line_safe([fix.position for fix in walk]))

    def test_known_door_recovered_within_ten_metres(self):
        events = [event for event in self.result["events"] if event["properties"].get("door_id") == self.day["known_door"].identifier]
        self.assertTrue(events, str(self.result["events"]))
        self.assertTrue(any(event["properties"]["action"] == "entry" for event in events))
        self.assertLess(distance(xy(events[0]["geometry"]["coordinates"]), self.day["known_door"].position), 10)
        self.assertTrue(any(event["properties"]["reason"] == "footprint_crossing" for event in events))

    def test_through_shortcut_and_new_candidate(self):
        counts = Counter(event["properties"]["kind"] for event in self.result["events"])
        self.assertGreater(counts["through_building"], 0)
        self.assertGreater(counts["shortcut"], 0)
        self.assertGreater(counts["new_door"], 0)
        self.assertTrue(any(event["properties"].get("reason") == "quality_collapse" for event in self.result["events"]))

    def test_real_graph_walk_time_within_ten_percent(self):
        timing = self.result["times"][0]
        self.assertTrue(timing["comparable"], str(timing))
        self.assertLess(abs(timing["difference_percent"]), 10)
        truth = (self.day["segments"][0][-1][1] - self.day["segments"][0][0][1]).total_seconds()
        self.assertLess(abs(timing["elapsed_seconds"] / truth - 1), 0.1)
        self.assertTrue(any(accuracy == 5 for _, _, accuracy in self.day["segments"][0]))

    def test_full_cli_produces_four_outputs(self):
        output = Path(self.scratch.name) / "cli"
        with contextlib.redirect_stdout(io.StringIO()):
            status = main([str(self.day["path"]), "--privacy", str(self.day["privacy_path"]), "--out", str(output)])
        self.assertEqual(status, 0)
        self.assertEqual({path.name for path in output.iterdir()}, {"report.md", "evidence.geojson", "candidates.geojson", "map.svg"})
        ET.parse(output / "map.svg")
        json.loads((output / "evidence.geojson").read_text())

    def test_public_schema_has_no_track_or_timestamps(self):
        serialized = json.dumps(self.result["candidates"])
        for forbidden in ("times", "time", "wall_position", "session", "accuracy_m", "elevations", "filtered_track", "matched_route"):
            self.assertNotIn('"' + forbidden + '"', serialized)
        self.assertNotIn("2000-01-01", serialized)
        for candidate in self.result["candidates"]["features"]:
            geometry = candidate["geometry"]
            positions = [xy(geometry["coordinates"])] if geometry["type"] == "Point" else [xy(coordinate) for coordinate in geometry["coordinates"]]
            self.assertTrue(self.privacy.line_safe(positions))

    def test_refuses_repo_output_and_raw_input(self):
        for root in repository_roots():
            with self.assertRaises(ValueError):
                require_external(root / "not-created", repository_roots(), "Output")
        with contextlib.redirect_stderr(io.StringIO()):
            status = main([str(REPO / "synthetic.gpx"), "--privacy", str(self.day["privacy_path"]), "--out", str(Path(self.scratch.name) / "bad")])
        self.assertEqual(status, 2)
        self.assertFalse((Path(self.scratch.name) / "bad").exists())

    def test_privacy_break_is_not_bridged(self):
        center = self.privacy.circles[0][0]
        positions = [(center[0] - 40, center[1]), (center[0] + 40, center[1])]
        path = Path(self.scratch.name) / "crossing.gpx"
        write_gpx(path, [[(position, EPOCH + timedelta(seconds=index * 40), 5) for index, position in enumerate(positions)]])
        chunks, stats = read_tracks([path], self.privacy, self.settings)
        self.assertEqual(len(chunks), 2)
        self.assertEqual(stats["privacy_segment_breaks"], 1)

    def test_polygon_holes_and_multisegment_gaps(self):
        rings = [[(0, 0), (40, 0), (40, 40), (0, 40), (0, 0)], [(10, 10), (30, 10), (30, 30), (10, 30), (10, 10)]]
        self.assertTrue(in_polygon((5, 5), rings))
        self.assertFalse(in_polygon((20, 20), rings))
        position = self.day["known_door"].position
        path = Path(self.scratch.name) / "gaps.gpx"
        write_gpx(path, [[(position, EPOCH + timedelta(seconds=seconds), 5) for seconds in (0, 4, 500, 504, 503)]])
        chunks, stats = read_tracks([path], self.privacy, self.settings)
        self.assertEqual(len(chunks), 3)
        self.assertEqual(stats["time_breaks"], 2)

    def test_noise_is_not_driving(self):
        randomizer = random.Random(7)
        fixes = [Fix((randomizer.gauss(0, 15), randomizer.gauss(0, 15)), EPOCH + timedelta(seconds=index * 4), accuracy=15)
                 for index in range(50)]
        stats = Counter()
        drop_vehicles([fixes], self.settings, stats)
        self.assertLess(stats["vehicle"], 5)

    def test_noisy_real_route_multiple_seeds(self):
        route = [self.scene.graph.nodes[node] for node in self.scene.graph.edges[self.day["route_edge"]][:2]]
        for seed in range(5):
            with self.subTest(seed=seed):
                points = sample_route(route, 0, self.scene, seed)
                fixes = [Fix(position, timestamp, accuracy=accuracy) for position, timestamp, accuracy in points]
                stats = Counter()
                retained = drop_vehicles([fixes], self.settings, stats)
                self.assertEqual(stats["vehicle"], 0)
                timing = match_walk(retained[0], self.scene.graph, self.scene, self.settings)
                self.assertTrue(timing["comparable"], str(timing))
                self.assertLess(abs(timing["difference_percent"]), 10)

    def test_accuracy_parser_and_invalid_times(self):
        position = self.day["known_door"].position
        path = Path(self.scratch.name) / "accuracy.gpx"
        write_gpx(path, [[(position, EPOCH + timedelta(seconds=index * 4), 5) for index in range(5)]])
        tree = ET.parse(path)
        points = [element for element in tree.getroot().iter() if element.tag.endswith("trkpt")]
        for child in list(points[0]):
            if child.tag.endswith("extensions"):
                points[0].remove(child)
        extension = next(child for child in points[2].iter() if child.tag.endswith("accuracy"))
        extension.text = "4000"
        extension.set("unit", "cm")
        next(child for child in points[4] if child.tag.endswith("time")).text = "2000-01-01T12:00:16"
        tree.write(path, encoding="utf-8", xml_declaration=True)
        chunks, stats = read_tracks([path], self.privacy, self.settings)
        self.assertEqual(stats["unknown_accuracy"], 1)
        self.assertEqual(stats["hdop_estimated"], 2)
        self.assertEqual(stats["poor_accuracy"], 1)
        self.assertEqual(stats["invalid"], 1)
        self.assertTrue(any(fix.accuracy is None for chunk in chunks for fix in chunk))

    def test_multiple_files_and_segment_boundaries(self):
        position = self.day["known_door"].position
        path = Path(self.scratch.name) / "segments.gpx"
        write_gpx(path, [[(position, EPOCH + timedelta(seconds=index * 4), 5) for index in range(2)],
                         [(position, EPOCH + timedelta(seconds=8 + index * 4), 5) for index in range(2)]])
        chunks, _ = read_tracks([path, path], self.privacy, self.settings)
        self.assertEqual(len(chunks), 4)
        self.assertEqual(len({chunk[0].session for chunk in chunks}), 4)

    def test_stair_and_signal_costs_use_graph_tuning(self):
        graph = self.scene.graph
        stair = next(index for index, edge in enumerate(graph.edges) if edge[3] & 1)
        signal = next(index for index, edge in enumerate(graph.edges) if edge[3] & 4 and not edge[3] & 1)
        route = [(stair, 0.4, True), (stair, 0.6, True), (signal, 1, True)]
        times = graph.route_times(route, self.settings.walk_speed)
        tune = graph.tune
        expected = graph.edges[stair][2] / tune["STAIR_SPEED_MPS"] + tune["STAIR_FIXED_S"]
        expected += graph.edges[signal][2] / self.settings.walk_speed + tune["SIGNAL_WAIT_LOW_S"]
        self.assertAlmostEqual(times["predicted_seconds"], expected)

    def test_candidates_are_regenerated_and_circle_checked(self):
        center = self.privacy.circles[0][0]
        event = {"type": "Feature", "geometry": {"type": "Point", "coordinates": lonlat(center)},
                 "properties": {"kind": "new_door", "building_id": "synthetic", "time": "private", "confidence": 0.5}}
        self.assertEqual(candidates_from([event], self.privacy, self.settings)["features"], [])

    def test_output_hardlinks_refused(self):
        import os
        output = Path(self.scratch.name) / "hardlink-output"
        output.mkdir()
        source = Path(self.scratch.name) / "external.txt"
        source.write_text("unchanged")
        os.link(source, output / "report.md")
        with self.assertRaises(ValueError):
            write_outputs(self.result, self.scene, self.privacy, self.settings, output)
        self.assertEqual(source.read_text(), "unchanged")

    def test_outer_bodies_and_runtime_courtyard_loaded(self):
        self.assertGreater(sum(building.identifier.startswith("outer:") for building in self.scene.buildings), 1000)
        self.assertTrue(any(len(building.polygons[0][0]) == 13 for building in self.scene.buildings))

    def test_privacy_geometry_never_exported(self):
        for event in self.result["evidence"]["features"]:
            geometry = event["geometry"]
            positions = [xy(geometry["coordinates"])] if geometry["type"] == "Point" else [xy(coordinate) for coordinate in geometry["coordinates"]]
            self.assertTrue(self.privacy.line_safe(positions))


    def test_redaction_splits_trip_and_prevents_through_pair(self):
        from evidence import detect_through
        building = Building("synthetic", [[[(0, 0), (60, 0), (60, 40), (0, 40), (0, 0)]]])
        class LocalScene:
            doors = [Door(1, "synthetic", (0, 20), "synthetic"), Door(2, "synthetic", (60, 20), "synthetic")]
            def near_buildings(self, position, radius=25):
                return [building]
        local = LocalScene()
        privacy = Privacy([{"lat": lonlat((30, 20))[1], "lon": lonlat((30, 20))[0], "radius_m": 8}], self.scene.bounds)
        vertices = [(-20, 20), (0, 20), (15, 20), (30, 20), (45, 20), (60, 20), (80, 20)]
        points = [(position, EPOCH + timedelta(seconds=index * 10), 5) for index, position in enumerate(vertices)]
        path = Path(self.scratch.name) / "redacted-trip.gpx"
        write_gpx(path, [points])
        chunks, stats = read_tracks([path], privacy, self.settings)
        self.assertEqual(stats["privacy"], 1)
        self.assertEqual(len(chunks), 2)
        events = detect_doors(chunks, local, self.settings, privacy)
        self.assertEqual(detect_through(events, self.settings, privacy), [])

    def test_contiguous_graph_detour_is_not_endpoint_shortest_path(self):
        graph = self.scene.graph
        first = self.day["route_edge"]
        start, joint = graph.edges[first][:2]
        neighbor = next((node, index) for node, metres, index in graph.adjacency[joint]
                        if index != first and not graph.edges[index][3] and metres > 15)
        end, second = neighbor
        vertices = [graph.nodes[start], graph.nodes[joint], graph.nodes[end]]
        points = sample_route(vertices, 0, self.scene, seed=6, noise=False)
        fixes = [Fix(position, timestamp, accuracy=5) for position, timestamp, _ in points]
        timing = match_walk(fixes, graph, self.scene, self.settings)
        self.assertTrue(timing["matched_route"])
        self.assertLess(abs(timing["distance_m"] / (graph.edges[first][2] + graph.edges[second][2]) - 1), 0.1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
