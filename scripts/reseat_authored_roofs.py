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


def area(g):
    """Shoelace, in squared degrees. Only ever compared against itself."""
    a = 0.0
    for r in rings(g):
        for i in range(len(r) - 1):
            a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]
    return abs(a) / 2


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

        # ── Pass 2: ordinary buildings whose roof floats a little ──────
        #
        # Nothing to do with the passes. Simeon: "building right in front of nano
        # science and right behind molecular science (unnamed) has a diagonal
        # roof". That is Anna Hiss Gymnasium — it has a name but sits below the
        # 12 m label gate, so it reads as unnamed — and its hip starts 0.35 m
        # above the top of its own parapet cap.
        #
        # Measured across all 100 pitched-roof buildings, roof base minus cap top
        # (final_height + max(1.0, 0.015*h), the CAP_GEOM rule):
        #
        #     0.00 m   83 buildings    correct
        #     0.35 m   13 buildings    floating - these
        #    -1.00 m    2 buildings    buried, different problem
        #    -6.30 m    1 building
        #   -12.00 m    1 building
        #
        # The 0.35 is the thickness of the base plate bake_roofs.py lays under a
        # hip. Where the lowest feature IS that plate the roof sits flush; on
        # these 13 the plate is missing, so the lowest thing is a facet and the
        # whole stack hangs by exactly its thickness.
        #
        # Only that small positive gap is closed. The buried ones need a
        # different fix and are reported, not moved — lifting a roof 12 m on a
        # guess is the same mistake as lifting DKR's deck onto a mast.
        if fn == "roofs.geojson":
            snapb = json.load(open(os.path.join(snap, latest, "buildings.detailed.geojson"),
                                   encoding="utf-8"))["features"]
            bgrid = {}
            for f in snapb:
                for r in rings(f["geometry"]):
                    los = [p[0] for p in r]
                    las = [p[1] for p in r]
                    for gx in range(int(min(los) * 2000), int(max(los) * 2000) + 1):
                        for gy in range(int(min(las) * 2000), int(max(las) * 2000) + 1):
                            bgrid.setdefault((gx, gy), []).append(f)

            def bldg(pt):
                """Which building does a roof at this point belong to?

                SMALLEST CONTAINING FOOTPRINT, not the first one found, and the
                difference is the whole of this script's two worst reports.

                Footprints overlap: 131 of the 2,831 roof features whose centroid
                lands on a building land on TWO of them (4.6%, measured
                2026-08-01). Returning whichever the grid happened to list first
                meant a roof correctly seated on a low wing could be attributed
                to the tall neighbour that contains it, and then read as buried
                by the height difference. That is exactly what produced:

                    -12.00 m  3fb4507f
                     -6.35 m  Austin Recreation Center

                Neither was a defect. The Rec Center's own roof is at 16.05 on a
                15.70 cap - a 0.35 m float, the ordinary base-plate case this
                script already fixes. It only looked like a 6.35 m burial because
                a 9.35 m roof belonging to the 8 m building inside its footprint
                was being counted as the Rec Center's lowest feature.

                The queue's stated hypothesis - "final_height changed under a
                roof baked against the old value" - was also wrong: 3fb4507f has
                read final_height 24.8 in every snapshot back to 2026-07-10.

                Smallest-containing-footprint is the standard most-specific-
                polygon rule and it is the right one here: a footprint drawn
                inside another footprint is a more precise statement about that
                patch of ground than the one that encloses it.

                THE REAL FIX IS UPSTREAM AND IS NOT DONE. bake_roofs.py knows
                exactly which building it is baking each roof for and throws that
                away; stamping a `pid` would make this lookup unnecessary. It is
                not done here because re-baking roofs.geojson would overwrite the
                hand-verified reseats in commits 12eb981 and baf2678.
                """
                best, best_a = None, None
                for f in bgrid.get((int(pt[0] * 2000), int(pt[1] * 2000)), []):
                    if any(inside(pt, r) for r in rings(f["geometry"])):
                        a = area(f["geometry"])
                        if best is None or a < best_a:
                            best, best_a = f, a
                return best

            lowest2, owner2 = {}, {}
            for f in feats:
                c = centroid(f["geometry"])
                if not c or (owner(c) is not None):
                    continue                     # pass-claimed; handled above
                bf = bldg(c)
                if bf is None:
                    continue
                bid = bf["properties"]["id"]
                owner2[bid] = bf
                b = f["properties"].get("b")
                if isinstance(b, (int, float)):
                    lowest2[bid] = min(lowest2.get(bid, 1e9), float(b))

            drop2, buried = {}, {}
            for bid, lo in lowest2.items():
                h = owner2[bid]["properties"].get("final_height") or 0
                cap = h + max(1.0, 0.015 * h)
                d = cap - lo                     # negative = floating above
                if -MAX_DROP <= d < -MIN_SHIFT:
                    drop2[bid] = d
                elif d > MIN_SHIFT:
                    buried[bid] = d

            moved2 = 0
            for f in feats:
                c = centroid(f["geometry"])
                if not c:
                    continue
                bf = bldg(c)
                if bf is None:
                    continue
                d = drop2.get(bf["properties"].get("id"))
                if d is None:
                    continue
                p = f["properties"]
                for k in ("b", "base", "h"):
                    if isinstance(p.get(k), (int, float)):
                        p[k] = round(p[k] + d, 2)
                moved2 += 1
            if drop2:
                print("  ordinary buildings whose hip floated above its own cap: %d"
                      % len(drop2))
                for bid, d in sorted(drop2.items(), key=lambda kv: kv[1]):
                    print("    %+6.2f m  %s" % (d, owner2[bid]["properties"].get("name")
                                                or bid[:8]))
                moved += moved2
            # WHAT IS LEFT HERE IS EXPECTED, AND SHOULD NOT BE "FIXED" BLIND.
            # After the attribution fix in bldg() the only remaining entries are
            # Blanton Museum of Art and the Edgar A. Smith Building, both at
            # exactly 1.00 m, both with their lowest roof feature sitting at
            # exactly `final_height` rather than at the cap top. That is a roof
            # authored to the wall line instead of the parapet, and at least one
            # of them is deliberate: commit 12eb981, "Blanton's roof was floating
            # one metre above Blanton", moved it there after looking at it.
            #
            # So do not close this gap on arithmetic. 1.00 m is also exactly
            # max(1.0, 0.015*h) for a building of this height, which makes the
            # two indistinguishable without a render. If you want to settle it,
            # screenshot the parapet edge - do not reason about it.
            if buried:
                print("  roofs seated at wall top rather than cap top (not moved, "
                      "see the comment): %d" % len(buried))
                for bid, d in sorted(buried.items(), key=lambda kv: -kv[1])[:5]:
                    print("    -%.2f m  %s" % (d, owner2[bid]["properties"].get("name")
                                               or bid[:8]))

        if shift or dropped or refused or moved:
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
