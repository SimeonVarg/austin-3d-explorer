#!/usr/bin/env python3
"""
reseat_authored_roofs.py — sit generic roofs on the building that is actually there.

THE DEFECT. Simeon: "Blanton's roof looks wrong to me." It is. The arts pass
authors the Blanton Museum's massing up to 14.30 m, and data/roofs.geojson carries
its stepped terracotta hip starting at 15.30 m — a 1.00 m band of clear sky
between the top of the building and the bottom of its roof.

WHAT I ALMOST SHIPPED INSTEAD, because it matters. The first version of this
script DELETED every generic roof feature sitting on a pass-claimed building, on
the theory that a pass which replaces a volume owns its roof. That would have
dropped 274 pitched facets — and 222 of them were CORRECT:

    building                authored top   generic roof spans   verdict
    Gregory Gym                  21.00 m   21.00 - 25.47 m      meets exactly
    Union Building               12.90 m   12.90 - 16.85 m      meets exactly
    Blanton Museum of Art        14.30 m   15.30 - 20.52 m      floats 1.00 m
    Edgar A. Smith Building      14.20 m   15.20 - 20.80 m      floats 1.00 m

Gregory Gym and the Union Building would have been flattened to fix a bug they do
not have. Checking four numbers before deleting 274 features is the only reason
that did not happen.

THE ACTUAL RULE. Generic roofs are baked to sit on the PARAPET CAP that js/app.js
draws on every ordinary building — base = final_height + max(1.0, 0.015*h), the
CAP_GEOM lift. A pass that authors its own massing does not necessarily draw that
cap, so its roof is left hanging by exactly the lift. The fix is not to delete the
roof, it is to RESEAT it: shift every roof feature on that building by the
difference between where it starts and where the authored geometry actually ends.

Shape, colour, height and step count are all preserved — only `b` and `h` move,
by one constant per building. A roof that already meets its building gets a shift
of 0.00 and is left byte-identical.

Where a pass claims a building and authors NOTHING at that footprint, there is no
top to sit on, and the roof is dropped — that case is real (the stadium's own
footprint) and is reported separately.

    python scripts/reseat_authored_roofs.py [--dry]
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
DRY = "--dry" in sys.argv

# Generic roof documents, and the pass documents whose geometry they must sit on.
TARGETS = ["roofs.geojson", "roofscape.geojson", "roofscape.detail.geojson"]
PASSES = ["arts.geojson", "drag.geojson", "moody.geojson", "westcampus.geojson",
          "tower.geojson", "stadium.geojson", "places.geojson"]

# Anything smaller than this is inside the noise of a 0.01 m rounded bake and is
# not worth rewriting a file for.
MIN_SHIFT = 0.05

# ONLY CLOSE A SMALL GAP. `top` is the highest authored feature on the footprint,
# which is the right anchor for an ordinary building and badly wrong for one with
# a tall thin element on it. Measured, unrestricted:
#
#   DKR Memorial Stadium   +81.20 m   the anchor is a floodlight mast
#   Moody Center           +19.70 m   the anchor is the arena roof peak
#
# Lifting a roof deck 81 m onto the tip of a mast is a worse defect than the one
# being fixed, and it is the same trap the Sutton Hall analysis hit ("do NOT use
# max(part.h)"). A NEGATIVE shift means the roof is hanging above the building and
# needs to come down, which is the reported defect and is safe. A POSITIVE shift
# means the roof is buried inside taller authored geometry — a different problem
# with a different fix, and not one to solve by moving the roof up.
#
# So: only small downward moves are applied. Everything else is reported and left
# exactly as it is.
MAX_DROP = 2.5


def rings(g):
    t = g.get("type")
    if t == "Polygon":
        return g["coordinates"]
    if t == "MultiPolygon":
        return [r for poly in g["coordinates"] for r in poly]
    return []


def centroid(g):
    if g.get("type") == "Point":
        return tuple(g["coordinates"][:2])
    rs = rings(g)
    if not rs:
        return None
    r = rs[0]
    return (sum(p[0] for p in r) / len(r), sum(p[1] for p in r) / len(r))


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


def load(fn):
    p = os.path.join(DATA, fn)
    if not os.path.exists(p):
        return None
    return json.load(open(p, encoding="utf-8"))


def main():
    claimed = set()
    for fn in PASSES:
        gj = load(fn)
        if not gj:
            continue
        claimed |= set(gj.get("replacedBuildingIds") or []) | set(gj.get("authoredRoofIds") or [])
    print("buildings claimed by a pass: %d" % len(claimed))

    snap = os.path.join(DATA, "snapshots")
    latest = sorted(d for d in os.listdir(snap) if os.path.isdir(os.path.join(snap, d)))[-1]
    B = json.load(open(os.path.join(snap, latest, "buildings.detailed.geojson"),
                       encoding="utf-8"))["features"]
    owned = [f for f in B if f["properties"].get("id") in claimed]
    name_of = {f["properties"]["id"]: (f["properties"].get("name") or f["properties"]["id"][:8])
               for f in owned}

    # Grid the claimed footprints once.
    grid = {}
    for f in owned:
        for r in rings(f["geometry"]):
            los = [p[0] for p in r]
            las = [p[1] for p in r]
            for cx in range(int(min(los) * 2000), int(max(los) * 2000) + 1):
                for cy in range(int(min(las) * 2000), int(max(las) * 2000) + 1):
                    grid.setdefault((cx, cy), []).append(f)

    def owner(pt):
        for f in grid.get((int(pt[0] * 2000), int(pt[1] * 2000)), []):
            if any(inside(pt, r) for r in rings(f["geometry"])):
                return f["properties"]["id"]
        return None

    # The authored TOP per claimed building: the highest h of any pass feature
    # whose centroid falls in that footprint.
    top = {}
    for fn in PASSES:
        gj = load(fn)
        if not gj:
            continue
        for f in gj["features"]:
            c = centroid(f["geometry"])
            if not c:
                continue
            o = owner(c)
            if o is None:
                continue
            h = f["properties"].get("h")
            if isinstance(h, (int, float)):
                top[o] = max(top.get(o, 0.0), float(h))

    print("authored tops resolved for %d of them\n" % len(top))

    for fn in TARGETS:
        gj = load(fn)
        if not gj:
            continue
        feats = gj["features"]
        # Lowest generic roof base per building, so one shift serves the stack.
        lowest = {}
        for f in feats:
            c = centroid(f["geometry"])
            o = owner(c) if c else None
            if o is None:
                continue
            b = f["properties"].get("b", f["properties"].get("base"))
            if isinstance(b, (int, float)):
                lowest[o] = min(lowest.get(o, 1e9), float(b))

        shift, refused = {}, {}
        for bid, lo in lowest.items():
            t = top.get(bid)
            if t is None:
                continue
            d = t - lo
            if abs(d) < MIN_SHIFT:
                continue
            if -MAX_DROP <= d < 0:
                shift[bid] = d
            else:
                refused[bid] = d

        moved, dropped, kept = 0, 0, 0
        for f in feats:
            c = centroid(f["geometry"])
            o = owner(c) if c else None
            if o is None:
                kept += 1
                continue
            if o not in top:
                dropped += 1
                continue
            d = shift.get(o)
            if d is None:
                kept += 1
                continue
            p = f["properties"]
            for k in ("b", "base", "h"):
                if isinstance(p.get(k), (int, float)):
                    p[k] = round(p[k] + d, 2)
            moved += 1

        if shift or dropped or refused:
            print("%s: %d features" % (fn, len(feats)))
            counts = {}
            for f in feats:
                c = centroid(f["geometry"])
                o = owner(c) if c else None
                if o:
                    counts[o] = counts.get(o, 0) + 1
            for bid, d in sorted(shift.items(), key=lambda kv: -abs(kv[1])):
                print("    %+6.2f m  %3d features  %s" % (d, counts.get(bid, 0),
                                                          name_of.get(bid, bid[:8])))
            for bid, d in sorted(refused.items(), key=lambda kv: -abs(kv[1])):
                print("    REFUSED %+7.2f m  %3d features  %s  (outside the safe "
                      "downward window; the anchor is probably a mast or a peak)"
                      % (d, counts.get(bid, 0), name_of.get(bid, bid[:8])))
            if dropped:
                print("    %d features sit on a claimed building with NO authored geometry "
                      "beneath - left alone, reported only" % dropped)
            if not DRY and moved:
                gj["features"] = feats
                with open(os.path.join(DATA, fn), "w", encoding="utf-8") as fh:
                    json.dump(gj, fh, separators=(",", ":"))
                print("    written (%d features moved)" % moved)
        else:
            print("%s: nothing to reseat" % fn)


main()
