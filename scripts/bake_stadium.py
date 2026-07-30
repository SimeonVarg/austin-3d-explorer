# -*- coding: utf-8 -*-
"""Give the stadiums a seating bowl that steps DOWN to the field.

THE PROBLEM. A stadium footprint in Overture/OSM is a ring: an outer wall with
a hole punched for the field. Extruded, that gives a flat-topped mesa with a
rectangular void in it — the one thing a stadium never looks like. From the air
DKR reads as a solid block with a hole, when what you actually see is a bowl:
outer wall high, then seating decks descending in tiers to the turf.

WHAT THIS DOES. For every stadium-class building whose geometry HAS a hole, it
emits concentric bands between the hole and the outer wall, each one lower than
the last, in seating grey. Nothing is invented: the bands are offsets of the
building's OWN hole ring, so they follow the real bowl shape.

  POSITION — factual. Offsets of the actual footprint's inner ring.
  TIER HEIGHTS — generative. No source gives per-deck heights; the ratios below
                 are chosen so the bowl descends convincingly from the wall
                 height the data already carries.

Usage:  python scripts/bake_stadium.py
"""
import json
import math
import os
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SNAP = os.path.join(ROOT, "data", "snapshots", "2026-07-30", "buildings.detailed.geojson")
OUT = os.path.join(ROOT, "data", "stadium.geojson")
M_LAT = 111320.0

# ── Taste block ───────────────────────────────────────────────────────
# Each tier: (how far out from the hole, in metres, as a fraction of the
# available gap) and (its top height as a fraction of the building height).
TIERS = [
    (0.34, 0.30),    # lower bowl: closest to the field, lowest
    (0.68, 0.58),    # mid deck
    (1.00, 0.86),    # upper deck, just below the outer wall
]
SEAT_DAY   = "#b3b0a8"     # pale concrete-and-seats grey, as it reads from the air
SEAT_GOLD  = "#bda88c"
SEAT_NIGHT = "#1a1c24"
STADIUM_CLASSES = ("stadium", "arena", "grandstand")


def signed_area(pts):
    a = 0.0
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        a += x0 * y1 - x1 * y0
    return a * 0.5


def offset(pts, d):
    """Offset a closed ring by d metres. Positive d = outward for a CCW ring.

    Returns None if the result degenerates, which is the right answer for an
    offset larger than the shape.
    """
    p = pts[:-1] if pts[0] == pts[-1] else pts[:]
    n = len(p)
    if n < 3:
        return None
    if signed_area(p + [p[0]]) < 0:
        p = p[::-1]
    lines = []
    for i in range(n):
        x0, y0 = p[i]
        x1, y1 = p[(i + 1) % n]
        dx, dy = x1 - x0, y1 - y0
        L = math.hypot(dx, dy)
        if L < 1e-9:
            return None
        nx, ny = dy / L, -dx / L        # inward normal for CCW
        lines.append((x0 + nx * d, y0 + ny * d, dx, dy))
    out = []
    for i in range(n):
        ax, ay, adx, ady = lines[i - 1]
        bx, by, bdx, bdy = lines[i]
        den = adx * bdy - ady * bdx
        if abs(den) < 1e-9:
            return None
        t = ((bx - ax) * bdy - (by - ay) * bdx) / den
        out.append((ax + adx * t, ay + ady * t))
    ring = out + [out[0]]
    if signed_area(ring) <= 1.0:
        return None
    return ring


def to_m(ring, lat0):
    k = math.cos(math.radians(lat0))
    return [(p[0] * M_LAT * k, p[1] * M_LAT) for p in ring]


def to_ll(pts, lat0):
    k = math.cos(math.radians(lat0))
    return [[round(x / (M_LAT * k), 6), round(y / M_LAT, 6)] for (x, y) in pts]


def gap_to_outer(hole_m, outer_m):
    """Largest outward offset of the hole that still fits inside the outer ring."""
    lo, hi = 0.0, 120.0
    ox = [p[0] for p in outer_m]; oy = [p[1] for p in outer_m]
    ow, oe, os_, on = min(ox), max(ox), min(oy), max(oy)
    for _ in range(16):
        mid = (lo + hi) / 2
        r = offset(hole_m, mid)
        if r is None:
            hi = mid
            continue
        xs = [p[0] for p in r]; ys = [p[1] for p in r]
        if min(xs) > ow and max(xs) < oe and min(ys) > os_ and max(ys) < on:
            lo = mid
        else:
            hi = mid
    return lo


def main():
    feats = json.load(open(SNAP, encoding="utf-8"))["features"]
    out = []
    stats = Counter()
    for f in feats:
        p = f["properties"]
        cls = (p.get("building_class") or "")
        if not any(c in cls for c in STADIUM_CLASSES):
            continue
        g = f["geometry"]
        if g["type"] != "Polygon" or len(g["coordinates"]) < 2:
            stats["stadium_no_hole"] += 1
            continue
        outer, hole = g["coordinates"][0], g["coordinates"][1]
        h = p.get("final_height") or 0
        if h < 8:
            continue
        lat0 = sum(q[1] for q in hole) / len(hole)
        hole_m = to_m(hole, lat0)
        outer_m = to_m(outer, lat0)
        gap = gap_to_outer(hole_m, outer_m)
        if gap < 6:
            stats["gap_too_small"] += 1
            continue
        name = p.get("name") or "(unnamed)"
        # Start from the ACTUAL hole, so the innermost band is a ring around the
        # field rather than a slab over it. (First cut used None here and the
        # lower bowl covered the turf completely.)
        prev = hole_m
        for frac, hfrac in TIERS:
            ring = offset(hole_m, gap * frac)
            if ring is None:
                break
            # Each band is [this offset] with [the previous offset] as a hole,
            # so the tiers are bands rather than stacked solid slabs.
            coords = [to_ll(ring, lat0)]
            if prev is not None:
                coords.append(to_ll(prev, lat0))
            out.append({
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": coords},
                "properties": {"h": round(h * hfrac, 2), "name": name},
            })
            prev = ring
            stats["tiers"] += 1
        stats["stadiums"] += 1
        print("  %-34s h=%5.1f gap=%4.1f m -> %d tiers" % (name[:34], h, gap, len(TIERS)))

    fc = {"type": "FeatureCollection", "features": out}
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(fc, fh, separators=(",", ":"))
    print(json.dumps({
        "tier_polygons": len(out),
        "file_kb": round(os.path.getsize(OUT) / 1024, 1),
        "counts": dict(sorted(stats.items())),
        "provenance": {"position": "factual - offsets of the building's own inner ring",
                       "tier heights": "GENERATIVE - fractions of the data's own building height"},
    }, indent=2))


if __name__ == "__main__":
    main()
