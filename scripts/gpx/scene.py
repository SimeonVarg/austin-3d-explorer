"""Read the app's baked graph, footprints and grouped entrance geometry."""

from __future__ import annotations
import heapq
import hashlib
import json
import math
import re
import statistics
from collections import Counter, defaultdict
from dataclasses import dataclass

from geometry import Grid, in_polygon, project, xy
from models import Door, REPO, read_json


@dataclass
class Building:
    identifier: str
    polygons: list

    def contains(self, position):
        return any(in_polygon(position, rings) for rings in self.polygons)


class Graph:
    def __init__(self, path):
        data = read_json(path)
        if data.get("v") != 1 or not isinstance(data.get("n"), dict):
            raise ValueError("Unsupported walk graph format")
        longitude = latitude = 0
        self.nodes = []
        for delta_x, delta_y in zip(data["n"]["x"], data["n"]["y"]):
            longitude += delta_x
            latitude += delta_y
            self.nodes.append(xy((longitude * data["q"], latitude * data["q"])))
        self.edges = []
        self.adjacency = defaultdict(list)
        self.grid = Grid()
        self.stair_counts = Counter()
        start = 0
        for index, delta in enumerate(data["e"]["a"]):
            start += delta
            end = start + data["e"]["b"][index]
            metres = data["e"]["w"][index] / 100.0
            flags, stair = data["e"]["f"][index], data["e"]["s"][index]
            self.edges.append((start, end, metres, flags, stair))
            self.adjacency[start].append((end, metres, index))
            self.adjacency[end].append((start, metres, index))
            self.grid.add(index, [self.nodes[start], self.nodes[end]])
            if stair >= 0:
                self.stair_counts[stair] += 1
        self.tune = data["tune"]
        self.cache = {}

    def nearby(self, position, radius=50.0, count=4):
        candidates = []
        for index in self.grid.near(position, radius):
            start, end = self.edges[index][:2]
            separation, projected, fraction = project(position, self.nodes[start], self.nodes[end])
            if separation <= radius:
                candidates.append((separation, index, fraction, projected))
        return sorted(candidates)[:count]

    def nearest_distance(self, position):
        for radius in (25.0, 75.0, 250.0):
            candidates = self.nearby(position, radius, 1)
            if candidates:
                return candidates[0][0]
        return min(project(position, self.nodes[edge[0]], self.nodes[edge[1]])[0] for edge in self.edges)

    def shortest(self, start, end, limit):
        if start == end:
            return 0.0, []
        key = (start, end)
        if key in self.cache:
            result = self.cache[key]
            return result if result[0] <= limit else None
        queue = [(0.0, start)]
        costs = {start: 0.0}
        previous = {}
        while queue:
            cost, node = heapq.heappop(queue)
            if cost != costs[node]:
                continue
            if cost > limit:
                break
            if node == end:
                route = []
                while node != start:
                    parent, edge = previous[node]
                    route.append((edge, 1.0, parent == self.edges[edge][0]))
                    node = parent
                result = (cost, route[::-1])
                if len(self.cache) > 20000:
                    self.cache.clear()
                self.cache[key] = result
                return result
            for neighbor, metres, edge in self.adjacency[node]:
                candidate = cost + metres
                if candidate <= limit and candidate < costs.get(neighbor, math.inf):
                    costs[neighbor] = candidate
                    previous[neighbor] = (node, edge)
                    heapq.heappush(queue, (candidate, neighbor))
        return None

    def connect(self, first, second, limit):
        first_edge, second_edge = self.edges[first[1]], self.edges[second[1]]
        choices = []
        if first[1] == second[1]:
            fraction = abs(first[2] - second[2])
            choices.append((fraction * first_edge[2], [(first[1], fraction, second[2] >= first[2])]))
        for first_node, first_fraction, forward_first in (
                (first_edge[0], first[2], False), (first_edge[1], 1 - first[2], True)):
            for second_node, second_fraction, forward_second in (
                    (second_edge[0], second[2], True), (second_edge[1], 1 - second[2], False)):
                legs = first_fraction * first_edge[2] + second_fraction * second_edge[2]
                route = self.shortest(first_node, second_node, max(0.0, limit - legs))
                if route is not None and legs + route[0] <= limit:
                    choices.append((legs + route[0], [(first[1], first_fraction, forward_first)]
                                    + route[1] + [(second[1], second_fraction, forward_second)]))
        return min(choices, key=lambda choice: choice[0]) if choices else None

    def route_times(self, route, speed):
        flat = stairs = 0.0
        flights = set()
        signals = 0
        previous_edge = None
        for index, fraction, forward in route:
            if fraction <= 1e-8:
                continue
            _, _, metres, flags, stair = self.edges[index]
            if flags & 1:
                stairs += metres * fraction
                flights.add(stair if stair >= 0 else ("edge", index))
            else:
                flat += metres * fraction
            if flags & 4 and index != previous_edge:
                signals += 1
            previous_edge = index
        tune = self.tune
        fixed = stairs / tune["STAIR_SPEED_MPS"] + len(flights) * tune["STAIR_FIXED_S"]
        return {"distance_m": flat + stairs,
                "predicted_seconds": flat / speed + fixed + signals * tune["SIGNAL_WAIT_LOW_S"],
                "low_seconds": flat / tune["WALK_SPEED_HIGH_MS"] + fixed + signals * tune["SIGNAL_WAIT_LOW_S"],
                "high_seconds": flat / tune["WALK_SPEED_LOW_MS"] + fixed + signals * tune["SIGNAL_WAIT_HIGH_S"]}


class Scene:
    def __init__(self, repo=REPO):
        self.repo = repo
        manifest = read_json(repo / "data/manifest.json")
        self.snapshot = manifest["latest"]
        extent = manifest["outer_ring"]["bbox"]
        self.bounds = tuple(extent[key] for key in ("minlon", "minlat", "maxlon", "maxlat"))
        overrides = read_json(repo / "data/building_overrides.json").get("buildings", {})
        excluded = {identifier for identifier, override in overrides.items() if override.get("exclude") is True}
        excluded_ways = {str(override["osm_way_id"]) for override in overrides.values()
                         if override.get("exclude") is True and "osm_way_id" in override}
        collections = [repo / "data/snapshots" / self.snapshot / "buildings.detailed.geojson",
                       repo / "data/capitol.geojson", repo / "data/outer_ring.geojson"]
        features = {}
        for path in collections:
            for feature in read_json(path)["features"]:
                properties = feature.get("properties", {})
                if path.name == "outer_ring.geojson" and any(key in properties for key in ("k", "part", "lmGlass", "lmEmit")):
                    continue
                identifier = str(properties.get("id", properties.get("bid", "")))
                if not identifier:
                    digest = hashlib.sha256(json.dumps(feature["geometry"], sort_keys=True).encode()).hexdigest()[:20]
                    identifier = "outer:" + digest
                way = str(properties.get("osm_way_id", properties.get("osm", ""))).removeprefix("way/").removeprefix("w")
                if identifier and identifier not in features and identifier not in excluded and way not in excluded_ways:
                    features[identifier] = feature
        apply_union_courtyard(features, repo)
        self.buildings = []
        self.building_by_id = {}
        self.grid = Grid(80.0)
        for identifier, feature in features.items():
            geometry = feature["geometry"]
            if geometry["type"] not in ("Polygon", "MultiPolygon"):
                continue
            polygons = geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]
            building = Building(identifier, [[[xy(coordinate) for coordinate in ring] for ring in rings]
                                             for rings in polygons])
            self.grid.add(len(self.buildings), [position for rings in building.polygons for ring in rings for position in ring])
            self.buildings.append(building)
            self.building_by_id[identifier] = building
        self.graph = Graph(repo / "data/walk_graph.json")
        grouped = defaultdict(list)
        properties_by_id = {}
        for feature in read_json(repo / "data/entrances.geojson")["features"]:
            properties = feature.get("properties", {})
            if properties.get("k") == "door":
                identifier = properties["eid"]
                properties_by_id[identifier] = properties
                geometry = feature["geometry"]
                polygons = geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]
                for rings in polygons:
                    grouped[identifier].extend(xy(coordinate) for coordinate in rings[0][:-1])
        self.doors = []
        for identifier, positions in sorted(grouped.items()):
            properties = properties_by_id[identifier]
            center = tuple(statistics.mean(position[axis] for position in positions) for axis in (0, 1))
            self.doors.append(Door(identifier, str(properties["bid"]), center, properties.get("src", "unknown")))

    def near_buildings(self, position, radius=25.0):
        return [self.buildings[index] for index in sorted(self.grid.near(position, radius))]


def apply_union_courtyard(features, repo):
    source = (repo / "js/union24.js").read_text(encoding="utf-8")
    if re.search(r"\bon:\s*false", source):
        return
    name_match = re.search(r"\bmatch:\s*'([^']+)'", source)
    feature = next((feature for feature in features.values() if feature["properties"].get("name") == name_match.group(1)), None) if name_match else None
    if feature is None:
        return
    origin_match = re.search(r"\borigin:\s*\[\s*([-\d.]+),\s*([-\d.]+)\s*\]", source)
    if not origin_match:
        raise ValueError("Runtime courtyard footprint configuration needs review")

    def number(name):
        match = re.search(r"\b" + name + r":\s*([-\d.]+)", source)
        if not match:
            raise ValueError("Runtime courtyard footprint configuration needs review")
        return float(match.group(1))

    origin = [float(value) for value in origin_match.groups()]
    module = number("MOD")
    width, depth, wing = number("envelope") * module, number("depth") * module, number("wing") * module
    south, north = number("southCourt") * module, depth - number("northCourt") * module
    angles = [re.search(r"\b" + name + r"\s*=\s*([-\d.]+)\s*\*\s*Math.PI", source) for name in ("BU", "BV")]
    if not all(angles):
        raise ValueError("Runtime courtyard footprint orientation needs review")
    angle_u, angle_v = (math.radians(float(match.group(1))) for match in angles)
    plan = [(0, 0), (wing, 0), (wing, south), (width - wing, south), (width - wing, 0), (width, 0),
            (width, depth), (width - wing, depth), (width - wing, north), (wing, north), (wing, depth), (0, depth)]
    coordinates = [[origin[0] + (math.sin(angle_u) * across + math.sin(angle_v) * along) / 96000,
                    origin[1] + (math.cos(angle_u) * across + math.cos(angle_v) * along) / 111000]
                   for across, along in plan]
    coordinates.append(coordinates[0])
    feature["geometry"] = {"type": "Polygon", "coordinates": [coordinates]}
