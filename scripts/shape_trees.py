#!/usr/bin/env python3
"""
shape_trees.py — take the trees out of the buildings, and give the big ones a top.

TWO REPORTED DEFECTS, one pass over data/trees.geojson.

1. "Trees clip through buildings and appear on top of them - fix the
   ordering/placement rule, not individual trees." It is not ordering. A tree
   whose centre lands inside a building footprint is INSIDE the building, and no
   layer order fixes a trunk growing out of a roof. The city tree inventory and
   the imagery-detected crowns both place points that fall on buildings — a
   street tree recorded a few metres off, a crown blob that is really a rooftop
   planter — and nothing downstream ever checked. They are dropped here.

2. "instead of octagonal prisms, if they could like taper off near the top."
   A fill-extrusion cannot taper: it is a prism with one radius. What it CAN do
   is stack, so a crown becomes two prisms — the lower one full width, a narrower
   one above it. From a flying camera that reads as a crown rather than a tin can,
   and it is the same trick bake_roofs.py uses to imply a hip.

   Only the LARGER crowns are split. A 2 m sapling is a handful of pixels and
   splitting it doubles the feature count for nothing, so the threshold is the
   median radius: half the trees gain a tier, half stay as they are. Feature
   count is the whole cost model here — js/lod.js drops `trees-canopy` as one
   whole draw pass at altitude, so what matters is how many features exist at
   street level.

A data transform, not a re-bake: scripts/fetch_city_trees.py needs the network and
the imagery cache, and re-running it would rewrite positions, species and heights.
This touches geometry and nothing else.

    python scripts/shape_trees.py [--dry]
"""
import json
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
DRY = "--dry" in sys.argv

# Taste block.
UPPER_FRAC = 0.30     # share of the crown's HEIGHT that becomes the upper tier
UPPER_SCALE = 0.62    # radius of the upper tier, as a fraction of the lower
MIN_SPLIT_H = 0.9     # do not split a crown shorter than this, in metres


def rings(g):
    t = g.get("type")
    if t == "Polygon":
        return g["coordinates"]
    if t == "MultiPolygon":
        return [r for poly in g["coordinates"] for r in poly]
    return []


def centroid(ring):
    n = len(ring)
    return (sum(p[0] for p in ring) / n, sum(p[1] for p in ring) / n)


def inside(pt, ring):
    x, y = pt
    c = False
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i][:2]
        x2, y2 = ring[(i + 1) % n][:2]
        if ((y1 > y) != (y2 > y)) and (x < (x2 - x1) * (y - y1) / ((y2 - y1) or 1e-12) + x1):
            c = not c
    return c


def scaled(ring, k):
    """Shrink a ring toward its own centroid. Keeps the octagon's rotation and
    squash, so the upper tier is the same crown shape, smaller."""
    cx, cy = centroid(ring)
    return [[cx + (p[0] - cx) * k, cy + (p[1] - cy) * k] for p in ring]


def radius_m(ring, lat):
    cx, cy = centroid(ring)
    kx = 111320 * math.cos(math.radians(lat))
    return max(math.hypot((p[0] - cx) * kx, (p[1] - cy) * 111320) for p in ring)


def main():
    snap = os.path.join(DATA, "snapshots")
    latest = sorted(d for d in os.listdir(snap) if os.path.isdir(os.path.join(snap, d)))[-1]
    B = json.load(open(os.path.join(snap, latest, "buildings.detailed.geojson"),
                       encoding="utf-8"))["features"]

    # Grid the footprints so this is not 19,440 x 2,453 point-in-polygon tests.
    grid = {}
    for f in B:
        for r in rings(f["geometry"]):
            los = [p[0] for p in r]
            las = [p[1] for p in r]
            for cx in range(int(min(los) * 2000), int(max(los) * 2000) + 1):
                for cy in range(int(min(las) * 2000), int(max(las) * 2000) + 1):
                    grid.setdefault((cx, cy), []).append(r)

    def in_building(pt):
        for r in grid.get((int(pt[0] * 2000), int(pt[1] * 2000)), []):
            if inside(pt, r):
                return True
        return False

    path = os.path.join(DATA, "trees.geojson")
    gj = json.load(open(path, encoding="utf-8"))
    feats = gj["features"]

    # 1. Drop anything standing inside a building.
    keep, dropped = [], 0
    for f in feats:
        rs = rings(f["geometry"])
        if rs and in_building(centroid(rs[0])):
            dropped += 1
            continue
        keep.append(f)
    print("trees.geojson: %d features" % len(feats))
    print("  dropped inside a building footprint: %d" % dropped)

    # 2. Split the larger crowns into two tiers.
    canopies = [f for f in keep if f["properties"].get("kind") == "canopy"]
    if not canopies:
        print("  no canopies found - nothing to taper")
        return
    lat0 = centroid(rings(canopies[0]["geometry"])[0])[1]
    radii = sorted(radius_m(rings(f["geometry"])[0], lat0) for f in canopies)
    median_r = radii[len(radii) // 2]
    print("  canopy radius: median %.2f m  max %.2f m" % (median_r, radii[-1]))

    out, split = [], 0
    for f in keep:
        p = f["properties"]
        if p.get("kind") != "canopy":
            out.append(f)
            continue
        ring = rings(f["geometry"])[0]
        base = float(p.get("base") or 0)
        h = float(p.get("h") or 0)
        span = h - base
        if radius_m(ring, lat0) < median_r or span < MIN_SPLIT_H:
            out.append(f)
            continue
        cut = round(base + span * (1 - UPPER_FRAC), 2)
        lower = json.loads(json.dumps(f))
        lower["properties"]["h"] = cut
        out.append(lower)
        upper = json.loads(json.dumps(f))
        upper["properties"]["base"] = cut
        upper["properties"]["h"] = round(h, 2)
        upper["geometry"]["coordinates"] = [scaled(ring, UPPER_SCALE)]
        out.append(upper)
        split += 1

    print("  crowns given an upper tier: %d of %d" % (split, len(canopies)))
    print("  features: %d -> %d" % (len(feats), len(out)))
    if not DRY:
        gj["features"] = out
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(gj, fh, separators=(",", ":"))
        print("  written")


main()
