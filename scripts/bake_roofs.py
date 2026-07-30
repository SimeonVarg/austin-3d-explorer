# -*- coding: utf-8 -*-
"""Give the historic campus halls the pitched roofs they actually have.

THE PROBLEM. `fill-extrusion` has exactly one roof shape: flat. Every building
in this app is a prism, and on a campus where most of the orange roofs are
hipped and converge to a ridge, that is probably the single loudest tell that
the scene is generated.

WHICH BUILDINGS (factual, from the photograph). MapLibre cannot slope a roof,
but before shape comes the question of WHOSE roof, and that is sourced rather
than guessed: each footprint is sampled against current nadir aerial imagery
and scored for terracotta tile. Calibrated against the only ground truth
available - the buildings OSM tags with roof:shape:
    Sutton Hall                 osm=hipped  tile_frac 0.58
    University Teaching Center  osm=flat    tile_frac 0.00
and the campus spread is sharply bimodal (median 0.00; 18 of 95 above 0.5,
71 below 0.15). The ones above the threshold are precisely the historic halls -
Will C. Hogg, Waggener, Batts, Parlin, Garrison, Benedict, Mezes, Homer Rainey.

THE SHAPE (generative). A hipped roof is approximated by STEPPED INSET CAPS:
the footprint is offset inward in equal steps, each step sitting higher than
the last. Offsetting a long rectangle inward collapses its short axis to a
line, so an elongated hall naturally produces a ridge - which is the shape we
want, arrived at honestly rather than drawn on. From flying altitude the steps
read as a pitch; up close they read as steps, and that is stated rather than
hidden.

Usage:  python scripts/bake_roofs.py
"""
import json
import math
import os
import sys
from collections import Counter

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SNAP = os.path.join(ROOT, "data", "snapshots", "2026-07-30", "buildings.detailed.geojson")
TILES = os.path.join(ROOT, "data", "imagery_cache")
OUT = os.path.join(ROOT, "data", "roofs.geojson")
Z = 19
M_LAT = 111320.0

# ── Taste / rule constants ────────────────────────────────────────────
TILE_MIN      = 0.50    # tile fraction above which a roof counts as tiled
MIN_SAMPLES   = 45      # below this the imagery does not cover the footprint
STEPS         = 6       # inset rings; more is smoother and costs more geometry
PITCH         = 0.32    # rise per metre of half-span (≈18°, a Spanish-tile pitch)
RISE_MAX      = 5.0     # a campus hall's roof, not a spire
MIN_SPAN_M    = 6.0     # narrower than this and the steps are wider than the roof
MAX_HEIGHT_M  = 34.0    # towers are flat-topped; the Tower's own roof is its own thing


def tile_xy_f(lon, lat, z):
    n = 2.0 ** z
    return ((lon + 180.0) / 360.0 * n,
            (1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n)


_tiles = {}


def px_at(lon, lat):
    xf, yf = tile_xy_f(lon, lat, Z)
    xt, yt = int(xf), int(yf)
    k = (xt, yt)
    if k not in _tiles:
        p = os.path.join(TILES, "%d_%d_%d.jpg" % (Z, xt, yt))
        _tiles[k] = np.asarray(Image.open(p).convert("RGB")) if os.path.exists(p) else None
    a = _tiles[k]
    if a is None:
        return None
    return a[int((yf - yt) * 256), int((xf - xt) * 256)]


def point_in_ring(x, y, ring):
    inside = False
    for (x0, y0), (x1, y1) in zip(ring, ring[1:]):
        if (y0 > y) != (y1 > y):
            xi = x0 + (y - y0) / (y1 - y0) * (x1 - x0)
            if x < xi:
                inside = not inside
    return inside


def tile_frac(ring, grid=20):
    lons = [p[0] for p in ring]; lats = [p[1] for p in ring]
    w, e, s, n = min(lons), max(lons), min(lats), max(lats)
    hit = tot = 0
    for i in range(grid):
        for j in range(grid):
            lon = w + (e - w) * (i + 0.5) / grid
            lat = s + (n - s) * (j + 0.5) / grid
            if not point_in_ring(lon, lat, ring):
                continue
            c = px_at(lon, lat)
            if c is None:
                continue
            tot += 1
            R, G, B = int(c[0]), int(c[1]), int(c[2])
            mx, mn = max(R, G, B), min(R, G, B)
            if mx and R == mx and (mx - mn) / mx > 0.28 and R > 70 and G >= B and (R - B) > 38:
                hit += 1
    return (hit / tot if tot else 0.0), tot


# ── geometry ──────────────────────────────────────────────────────────
def to_m(ring, lat0):
    k = math.cos(math.radians(lat0))
    return [(p[0] * M_LAT * k, p[1] * M_LAT) for p in ring]


def to_ll(pts, lat0):
    k = math.cos(math.radians(lat0))
    return [[round(x / (M_LAT * k), 6), round(y / M_LAT, 6)] for (x, y) in pts]


def signed_area(pts):
    a = 0.0
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        a += x0 * y1 - x1 * y0
    return a * 0.5


def inset(pts, d):
    """Offset a closed ring inward by d metres (edge offset + corner intersect).

    Returns None when the result degenerates — which is the correct answer for
    a roof step narrower than the building, and is what stops a thin wing from
    turning inside out.
    """
    p = pts[:-1] if pts[0] == pts[-1] else pts[:]
    n = len(p)
    if n < 3:
        return None
    if signed_area(p + [p[0]]) < 0:            # force CCW
        p = p[::-1]
    lines = []
    for i in range(n):
        x0, y0 = p[i]
        x1, y1 = p[(i + 1) % n]
        dx, dy = x1 - x0, y1 - y0
        L = math.hypot(dx, dy)
        if L < 1e-9:
            return None
        # inward normal for CCW winding
        nx, ny = dy / L, -dx / L
        lines.append((x0 - nx * d, y0 - ny * d, dx, dy))
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
    a = signed_area(ring)
    if a <= 1.0:                                # collapsed or inverted
        return None
    return ring


def half_span(pts):
    """Rough inradius: the largest inset that still survives."""
    lo, hi = 0.0, 40.0
    for _ in range(14):
        mid = (lo + hi) / 2
        if inset(pts, mid) is not None:
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
        h = p.get("final_height") or 0
        if h < 4 or h > MAX_HEIGHT_M:
            continue
        g = f["geometry"]
        rings = [g["coordinates"][0]] if g["type"] == "Polygon" else [poly[0] for poly in g["coordinates"]]
        for ring in rings:
            if len(ring) < 4:
                continue
            fr, n = tile_frac(ring)
            if n < MIN_SAMPLES:
                stats["no_imagery"] += 1
                continue
            if fr < TILE_MIN:
                stats["flat"] += 1
                continue
            lat0 = sum(q[1] for q in ring) / len(ring)
            pm = to_m(ring, lat0)
            hs = half_span(pm)
            if hs < MIN_SPAN_M / 2:
                stats["too_narrow"] += 1
                continue
            rise = min(RISE_MAX, PITCH * hs)
            # The wall's cap already sits at h + lift (see CAP_GEOM in app.js);
            # start the roof from there so nothing z-fights the parapet.
            base = h + max(1.0, 0.015 * h)
            made = 0
            for s in range(1, STEPS + 1):
                d = hs * s / (STEPS + 0.35)
                r = inset(pm, d)
                if r is None:
                    break
                out.append({
                    "type": "Feature",
                    "geometry": {"type": "Polygon", "coordinates": [to_ll(r, lat0)]},
                    "properties": {
                        "b": round(base + rise * (s - 1) / STEPS, 2),
                        "h": round(base + rise * s / STEPS, 2),
                        "tf": round(fr, 2),
                        # Carry the parent's baked day/golden/night roof colours
                        # so a step is tinted by exactly the same expression as
                        # the wall cap it sits on and can never drift from it.
                        "rd": p.get("rd"), "rg": p.get("rg"), "rn": p.get("rn"),
                    },
                })
                made += 1
            stats["tiled" if made else "tiled_but_degenerate"] += 1
            stats["steps"] += made

    fc = {"type": "FeatureCollection", "features": out}
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(fc, fh, separators=(",", ":"))
    print(json.dumps({
        "roof_steps": len(out),
        "file_kb": round(os.path.getsize(OUT) / 1024, 1),
        "counts": dict(sorted(stats.items())),
        "rule": "tile_frac >= %.2f from nadir imagery (calibrated on OSM roof:shape)" % TILE_MIN,
        "provenance": {"which buildings": "factual - terracotta tile read off the photograph",
                       "roof shape": "GENERATIVE - stepped inset caps approximating a hip; "
                                     "fill-extrusion cannot slope a face"},
    }, indent=2))


if __name__ == "__main__":
    main()
