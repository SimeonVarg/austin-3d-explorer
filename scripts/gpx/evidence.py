"""Conservative wall events, candidate paths and connected route matching."""

from __future__ import annotations
import json
import statistics
from datetime import datetime

from geometry import boundary_crossing, distance, length, lonlat, nearest_wall, simplify, xy
from tracks import drop_vehicles, read_tracks


def smoothed(walk):
    result = []
    for index, fix in enumerate(walk):
        neighbors = walk[max(0, index - 2):index + 3] if 1 < index < len(walk) - 2 else [fix]
        result.append(tuple(statistics.median(other.position[axis] for other in neighbors) for axis in (0, 1)))
    return result


def feature(kind, positions, properties):
    geometry = {"type": "Point", "coordinates": lonlat(positions[0])} if len(positions) == 1 else {"type": "LineString", "coordinates": [lonlat(position) for position in positions]}
    return {"type": "Feature", "geometry": geometry, "properties": {"kind": kind, **properties}}


def door_event(building, wall, action, timestamp, session, quality, reason, scene, settings):
    doors = sorted((distance(wall, door.position), door.identifier, door) for door in scene.doors if door.building == building.identifier)
    door = doors[0][2] if doors and doors[0][0] <= settings.door_radius else None
    separation = doors[0][0] if door else settings.door_radius
    confidence = max(0.2, min(0.88, (0.7 if reason == "footprint_crossing" else 0.42)
                                 - min(quality or 15.0, 30.0) / 150 + (0.12 if door else 0.0) - separation / 200))
    properties = {"building_id": building.identifier, "action": action, "time": timestamp.isoformat(),
                  "session": session, "confidence": round(confidence, 3), "reason": reason,
                  "position_uncertainty_m": quality, "wall_position": lonlat(wall)}
    if door:
        properties.update(door_id=door.identifier, source=door.source, snap_distance_m=round(separation, 1))
    return feature("door_confirmation" if door else "new_door", [door.position if door else wall], properties)


def detect_doors(walks, scene, settings, privacy):
    events = []
    for walk in walks:
        positions = smoothed(walk)
        relevant = {building.identifier: building for position in positions for building in scene.near_buildings(position, settings.wall_radius)}
        for building in relevant.values():
            states = [building.contains(position) for position in positions]
            index = 0
            while index < len(walk):
                if not states[index]:
                    index += 1
                    continue
                stop = index
                while stop + 1 < len(walk) and states[stop + 1]:
                    stop += 1
                duration = (walk[stop].time - walk[index].time).total_seconds()
                quality = statistics.median(fix.accuracy or 15 for fix in walk[index:stop + 1])
                depth = statistics.median(nearest_wall(position, building.polygons)[0] for position in positions[index:stop + 1])
                if duration >= settings.inside_seconds and depth >= max(4, quality * 0.5):
                    crossings = []
                    if index > 0:
                        crossings.append((index, "entry"))
                    if stop + 1 < len(walk):
                        crossings.append((stop + 1, "exit"))
                    for crossing, action in crossings:
                        wall = boundary_crossing(positions[crossing - 1], positions[crossing], building.polygons)
                        if not privacy.reason(wall):
                            events.append(door_event(building, wall, action, walk[crossing].time,
                                                     walk[crossing].session, quality, "footprint_crossing", scene, settings))
                index = stop + 1
        for fix, position in zip(walk, positions):
            for action, timestamp in (("entry", fix.collapse_after), ("exit", fix.recovery_before)):
                if timestamp is None:
                    continue
                nearby = [(nearest_wall(position, building.polygons)[0], building.identifier, building)
                          for building in scene.near_buildings(position, settings.wall_radius)]
                if not nearby or min(nearby)[0] > settings.wall_radius:
                    continue
                building = min(nearby)[2]
                wall = nearest_wall(position, building.polygons)[1]
                if not privacy.reason(wall):
                    events.append(door_event(building, wall, action, timestamp, fix.session, fix.accuracy,
                                             "quality_collapse" if action == "entry" else "quality_recovery", scene, settings))
    deduplicated = []
    for event in sorted(events, key=lambda event: (event["properties"]["session"], event["properties"]["time"])):
        properties = event["properties"]
        duplicate = next((old for old in deduplicated if old["properties"]["session"] == properties["session"]
                          and old["properties"]["building_id"] == properties["building_id"] and old["properties"]["action"] == properties["action"]
                          and abs((datetime.fromisoformat(old["properties"]["time"]) - datetime.fromisoformat(properties["time"])).total_seconds()) < 30), None)
        if duplicate is None:
            deduplicated.append(event)
        elif properties["confidence"] > duplicate["properties"]["confidence"]:
            deduplicated[deduplicated.index(duplicate)] = event
    return deduplicated


def detect_through(events, settings, privacy):
    pending = {}
    links = []
    for event in sorted(events, key=lambda item: item["properties"]["time"]):
        properties = event["properties"]
        key = (properties["session"], properties["building_id"])
        if properties["action"] == "entry":
            pending[key] = event
            continue
        entry = pending.pop(key, None)
        if entry is None:
            continue
        elapsed = (datetime.fromisoformat(properties["time"]) - datetime.fromisoformat(entry["properties"]["time"])).total_seconds()
        positions = [xy(entry["geometry"]["coordinates"]), xy(event["geometry"]["coordinates"])]
        different = entry["properties"].get("door_id") != properties.get("door_id") or properties.get("door_id") is None
        if 0 < elapsed <= settings.through_seconds and distance(*positions) >= 10 and different and privacy.line_safe(positions):
            links.append(feature("through_building", positions,
                                 {"building_id": properties["building_id"], "elapsed_seconds": elapsed,
                                  "entry_door_id": entry["properties"].get("door_id"), "exit_door_id": properties.get("door_id"),
                                  "time": entry["properties"]["time"],
                                  "confidence": round(min(properties["confidence"], entry["properties"]["confidence"]) * 0.85, 3)}))
    return links


def public_path(positions, settings):
    simplified = simplify(positions, settings.public_grid)
    rounded = [tuple(round(component / settings.public_grid) * settings.public_grid for component in position) for position in simplified]
    return [position for index, position in enumerate(rounded) if index == 0 or position != rounded[index - 1]]


def detect_shortcuts(walks, scene, settings, privacy):
    events = []
    for walk in walks:
        positions = smoothed(walk)
        runs = []
        run = []
        for index, position in enumerate(positions):
            separation = scene.graph.nearest_distance(position)
            indoors = any(building.contains(position) for building in scene.near_buildings(position, 0))
            if separation > settings.offgraph_distance and not indoors:
                run.append(index)
            else:
                if run:
                    runs.append(run)
                run = []
        if run:
            runs.append(run)
        for run in runs:
            section = [positions[index] for index in run]
            if len(section) < 3 or length(section) <= settings.offgraph_length:
                continue
            derived = public_path(section, settings)
            if len(derived) < 2 or not privacy.line_safe(derived):
                continue
            confidence = max(0.2, min(0.8, 0.5 + min(length(section), 100) / 500
                                     - statistics.median(walk[index].accuracy or 15 for index in run) / 100))
            events.append(feature("shortcut", derived, {"confidence": round(confidence, 3), "length_m": round(length(derived), 1),
                                                        "time": walk[run[0]].time.isoformat(), "reason": "sustained_off_graph"}))
    return events


def match_walk(walk, graph, scene, settings):
    elapsed = (walk[-1].time - walk[0].time).total_seconds()
    result = {"elapsed_seconds": elapsed, "comparable": False, "reason": "too_short", "confidence": 0.0, "matched_route": []}
    if elapsed <= 0 or len(walk) < 3:
        return result
    positions = smoothed(walk)
    samples = [0]
    for index in range(1, len(walk) - 1):
        if distance(positions[index], positions[samples[-1]]) >= 12.0:
            samples.append(index)
    if samples[-1] != len(walk) - 1:
        samples.append(len(walk) - 1)
    candidates = [graph.nearby(positions[index], max(25.0, min(50.0, (walk[index].accuracy or 15) * 2)), 4) for index in samples]
    covered = sum(bool(group) and group[0][0] <= settings.offgraph_distance for group in candidates) / len(samples)
    result["coverage"] = round(covered, 3)
    if any(not group for group in candidates):
        result["reason"] = "off_graph_or_disconnected"
        return result
    states = [(candidate[0] ** 2 / 100, candidate, [], [candidate[3]]) for candidate in candidates[0]]
    for sample_index in range(1, len(samples)):
        duration = (walk[samples[sample_index]].time - walk[samples[sample_index - 1]].time).total_seconds()
        observed = distance(positions[samples[sample_index - 1]], positions[samples[sample_index]])
        next_states = []
        for candidate in candidates[sample_index]:
            best = None
            for cost, previous, route, route_positions in states:
                connection = graph.connect(previous, candidate, max(60.0, duration * settings.vehicle_speed + 30))
                if connection is None:
                    continue
                next_cost = cost + abs(connection[0] - observed) / 5.0 + candidate[0] ** 2 / 100
                if best is None or next_cost < best[0]:
                    intermediate = [graph.nodes[graph.edges[index][1] if forward else graph.edges[index][0]]
                                    for index, fraction, forward in connection[1][:-1] if fraction > 0]
                    best = (next_cost, candidate, route + connection[1], route_positions + intermediate + [candidate[3]])
            if best:
                next_states.append(best)
        if not next_states:
            result["reason"] = "no_connected_match"
            return result
        states = next_states
    _, _, route, route_positions = min(states, key=lambda state: state[0])
    times = graph.route_times(route, settings.walk_speed)
    result.update(times)
    result["matched_route"] = [lonlat(position) for position in route_positions]
    result["confidence"] = round(covered * max(0.2, 1 - statistics.median(group[0][0] for group in candidates) / 40), 3)
    indoor = False
    inside_start = None
    inside_count = 0
    for fix, position in zip(walk, positions):
        deep_inside = any(building.contains(position) and nearest_wall(position, building.polygons)[0] > max(5, (fix.accuracy or 15) * 0.5)
                          for building in scene.near_buildings(position, 0))
        if deep_inside:
            inside_count += 1
            inside_start = fix.time if inside_start is None else inside_start
            indoor = indoor or (fix.time - inside_start).total_seconds() >= settings.inside_seconds
        else:
            inside_start = None
    indoor = indoor or inside_count / len(walk) > 0.2
    if covered < 0.85:
        result["reason"] = "off_graph_route_is_not_comparable"
    elif indoor:
        result["reason"] = "indoor_route_is_not_comparable"
    elif times["distance_m"] < 20:
        result["reason"] = "too_short"
    else:
        result.update(comparable=True, reason="connected_observed_route",
                      difference_percent=round((elapsed / times["predicted_seconds"] - 1) * 100, 1))
    return result


def candidates_from(events, privacy, settings):
    public = []
    allowed = {"building_id", "door_id", "confidence", "reason", "source", "action", "entry_door_id", "exit_door_id", "length_m"}
    grouped = {}
    for event in events:
        properties = event["properties"]
        kind = properties["kind"]
        geometry = event["geometry"]
        positions = [xy(geometry["coordinates"])] if geometry["type"] == "Point" else [xy(coordinate) for coordinate in geometry["coordinates"]]
        if kind == "new_door":
            positions = [tuple(round(component / settings.public_grid) * settings.public_grid for component in positions[0])]
        if not privacy.line_safe(positions):
            continue
        safe_properties = {key: properties[key] for key in sorted(allowed) if key in properties}
        if kind == "through_building":
            safe_properties["elapsed_seconds_rounded"] = round(properties["elapsed_seconds"] / 5) * 5
        candidate = feature(kind, positions, safe_properties)
        key = (kind, properties.get("building_id"), properties.get("door_id"), properties.get("action"), json.dumps(candidate["geometry"], sort_keys=True))
        if key in grouped:
            grouped[key]["properties"]["observations"] += 1
        else:
            candidate["properties"]["observations"] = 1
            grouped[key] = candidate
            public.append(candidate)
    return {"type": "FeatureCollection", "features": public}


def analyze(paths, scene, privacy, settings):
    chunks, stats = read_tracks(paths, privacy, settings)
    walks = drop_vehicles(chunks, settings, stats)
    doors = detect_doors(walks, scene, settings, privacy)
    events = doors + detect_through(doors, settings, privacy) + detect_shortcuts(walks, scene, settings, privacy)
    times = [match_walk(walk, scene.graph, scene, settings) for walk in walks if len(walk) >= 2]
    for walk, timing in zip((walk for walk in walks if len(walk) >= 2), times):
        if any(fix.collapse_after is not None or fix.recovery_before is not None for fix in walk):
            timing.update(comparable=False, reason="quality_gap_at_wall")
        elif any(event["properties"]["session"] == walk[0].session and
                 walk[0].time <= datetime.fromisoformat(event["properties"]["time"]) <= walk[-1].time
                 for event in doors):
            timing.update(comparable=False, reason="building_event_on_route")
    events = [event for event in events if privacy.line_safe(
        [xy(event["geometry"]["coordinates"])] if event["geometry"]["type"] == "Point"
        else [xy(coordinate) for coordinate in event["geometry"]["coordinates"]])]
    tracks = []
    for walk in walks:
        positions = [fix.position for fix in walk]
        if not privacy.line_safe(positions):
            raise ValueError("Internal privacy check failed")
        tracks.append(feature("filtered_track", positions,
                              {"times": [fix.time.isoformat() for fix in walk], "elevations": [fix.elevation for fix in walk],
                               "accuracy_m": [fix.accuracy for fix in walk], "hdop": [fix.hdop for fix in walk],
                               "accuracy_sources": [fix.accuracy_source for fix in walk]}))
    matches = [feature("matched_route", [xy(coordinate) for coordinate in timing["matched_route"]],
                       {key: value for key, value in timing.items() if key != "matched_route"})
               for timing in times if len(timing["matched_route"]) >= 2 and privacy.line_safe([xy(coordinate) for coordinate in timing["matched_route"]])]
    evidence = {"type": "FeatureCollection", "features": tracks + events + matches}
    return {"stats": dict(stats), "walks": walks, "events": events, "times": times,
            "evidence": evidence, "candidates": candidates_from(events, privacy, settings)}
