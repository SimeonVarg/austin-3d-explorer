#!/usr/bin/env python3
"""DATA ONLY: verify downtown identity coverage, contacts and facade joins.

Run after bake_outer.py and bake_outer_facades.py with Python + Shapely 2.
Reads actual baked data; never rebuilds geometry or writes baseline files.
This does not establish visual fidelity, physical-phone behavior or frame rate.
"""
import copy
import json
import math
from collections import defaultdict
from pathlib import Path
import sys

from shapely.geometry import Polygon, shape
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
from bake_outer_facades import stamp_towers
from downtown_facade_profiles import PROFILES, GRIDS
from downtown_landmarks import LANDMARKS
from downtown_tower_identities import TOWER_IDENTITIES

EXPECTED_KEYS = {
    "independent", "austonian", "frost-bank", "360-condominiums", "block-185",
    "modern-austin", "natiivo", "70-rainey", "northshore", "seaholm",
    "colorado-tower", "one-american", "100-congress", "jw-marriott", "fairmont",
    "w-austin", "republic", "waterline", "sixth-guadalupe",
    "atx-tower", "415-colorado", "44-east", "paseo", "the-travis",
    "indeed-tower",
}
# The baked polygons round longitude/latitude to six decimals. Allow at most
# 9 cm horizontally for coincident faces and 1.5 cm in the stored z intervals.
CONTACT_XY_M = 0.09
CONTACT_Z_M = 0.015
GROUND_Z_M = 0.05
HEIGHT_TOLERANCE_M = 0.15


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def metric_polygon(feature, center):
    """Local metre projection for contact distances; preserve all holes."""
    lon0, lat0 = center
    sx, sy = 111320 * math.cos(math.radians(lat0)), 111320
    rings = feature["geometry"]["coordinates"]
    require(feature["geometry"]["type"] == "Polygon", "Expected extruded Polygon")
    projected = [[((lon-lon0)*sx, (lat-lat0)*sy) for lon, lat in ring]
                 for ring in rings]
    return Polygon(projected[0], projected[1:])


def disconnected_parts(features, center):
    polys = [metric_polygon(f, center) for f in features]
    tree = STRtree(polys)
    graph = [set() for _ in features]
    for i, feature in enumerate(features):
        p = feature["properties"]
        buffered = polys[i].buffer(CONTACT_XY_M)
        for hit in tree.query(buffered):
            j = int(hit)
            if j <= i:
                continue
            q = features[j]["properties"]
            if max(p.get("b", 0), q.get("b", 0)) > min(p["h"], q["h"]) + CONTACT_Z_M:
                continue
            if buffered.intersects(polys[j]):
                graph[i].add(j)
                graph[j].add(i)
    connected = {i for i, f in enumerate(features)
                 if f["properties"].get("b", 0) <= GROUND_Z_M}
    todo = list(connected)
    while todo:
        adjacent = graph[todo.pop()] - connected
        connected.update(adjacent)
        todo.extend(adjacent)
    return [{"part": f["properties"].get("part"),
             "base": f["properties"].get("b", 0), "top": f["properties"]["h"]}
            for i, f in enumerate(features) if i not in connected]


def generic_floating_crowns(features):
    """Catch a cap left above a taper that stopped before reaching its base.

    Reproduces the broad support-area audit that found the original crown gap.
    Ignore roofs/ground and authored parts, whose finer contacts are tested by
    the graph. A generic cap needs another overlapping extrusion reaching its
    underside and covering more than half its plan, within 0.6 m vertically.
    """
    walls = [f for f in features if f["properties"].get("k") not in ("r", "g")]
    polys = [shape(f["geometry"]).buffer(0) for f in walls]
    tree = STRtree(polys)
    floating = []
    for i, feature in enumerate(walls):
        p = feature["properties"]
        base = p.get("b", 0)
        if p.get("k") != "c" or base <= GROUND_Z_M or p.get("lm"):
            continue
        supported = any(
            int(j) != i and walls[int(j)]["properties"]["h"] >= base - 0.6
            and walls[int(j)]["properties"].get("b", 0) <= base + CONTACT_Z_M
            and polys[int(j)].intersection(polys[i]).area > polys[i].area * 0.5
            for j in tree.query(polys[i]))
        if not supported:
            floating.append({"base": base, "top": p["h"]})
    return floating


def main():
    features = json.loads((ROOT / "data/outer_ring.geojson").read_text(encoding="utf-8"))["features"]
    palette = json.loads((ROOT / "data/outer_tower_palette.json").read_text(encoding="utf-8"))
    configs = {c["key"]: c for c in [*TOWER_IDENTITIES.values(), *LANDMARKS.values()]}
    require(set(configs) == EXPECTED_KEYS,
            f"Authored configuration must retain all {len(EXPECTED_KEYS)} identity keys")
    groups = defaultdict(list)
    for feature in features:
        key = feature["properties"].get("lm")
        if key:
            groups[key].append(feature)
    require(EXPECTED_KEYS <= groups.keys(), f"Missing identities: {EXPECTED_KEYS - groups.keys()}")

    identity_report = {}
    for config in TOWER_IDENTITIES.values():
        key = config["key"]
        parts = groups[key]
        for part in parts:
            geometry = shape(part["geometry"])
            p = part["properties"]
            require(geometry.is_valid and not geometry.is_empty and geometry.area > 0,
                    f"{key}: invalid polygon in {p.get('part')}")
            require(math.isfinite(p["h"]) and math.isfinite(p.get("b", 0))
                    and p["h"] > p.get("b", 0) >= 0,
                    f"{key}: invalid vertical interval in {p.get('part')}")
        height = max(f["properties"]["h"] for f in parts)
        require(abs(height-config["height"]) <= HEIGHT_TOLERANCE_M,
                f"{key}: baked top {height} differs from configured height {config['height']}")
        orphan = disconnected_parts(parts, config["center"])
        require(not orphan, f"{key}: disconnected pieces: {orphan[:12]}")
        identity_report[key] = {"pieces": len(parts), "height": height, "disconnected": 0}

    architecture = [f for f in features if f["properties"].get("t") in (1, 2)]
    require(architecture, "No patterned downtown buildings")
    require(palette.get("shared_architecture") is True and palette.get("midrise") == [],
            "Expected a shared tower/streetwall architecture palette")
    by_fb = {b["fb"]: b for b in palette["buckets"]}
    require(len(by_fb) == len(palette["buckets"]) <= 17, "Duplicate/excess palette ordinals")
    require(len(palette["grids"]) <= 8 and set(palette["grids"]) <= GRIDS.keys(),
            "Unexpected or excess grid families")
    for feature in architecture:
        p = feature["properties"]
        require(p.get("fp") in PROFILES and p.get("fb") in by_fb, "Unresolved facade identity")
        require(by_fb[p["fb"]]["profile"] == p["fp"], "Facade ordinal maps to wrong profile")
        require("wp" not in p and "wf" not in p, "Stale browser pattern ID in baked data")
    restamped = copy.deepcopy(features)
    derived, _, changed, count = stamp_towers(restamped)
    require(not changed and restamped == features and derived == palette["buckets"]
            and count == len(architecture), "Facade bake is not idempotent")
    floating = generic_floating_crowns(features)
    require(not floating, f"Generic floating crown regression: {floating}")
    print(json.dumps({"result": "PASS", "scope": "DATA ONLY; not visual, phone or performance acceptance",
                      "authoredKeys": len(groups.keys() & EXPECTED_KEYS),
                      "newIdentityChecks": identity_report,
                      "patternedPieces": len(architecture), "profiles": len(by_fb),
                      "grids": len(palette["grids"]), "genericFloatingCrowns": 0}, indent=2))


if __name__ == "__main__":
    main()
