# -*- coding: utf-8 -*-
"""Feasibility probe: can nadir imagery tell a terracotta TILE roof (which on
this campus means a pitched roof) from a flat membrane roof?

Calibrated against the only ground truth available: the five buildings OSM
tags with roof:shape. If tile-fraction does not separate `hipped` from `flat`,
the whole imagery route for roofs is dead and it gets reported as such rather
than shipped on a guess.

Usage: python scripts/probe_roofs.py
"""
import json
import math
import os

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TILES = os.path.join(ROOT, "data", "imagery_cache")
Z = 19


def tile_xy_f(lon, lat, z):
    n = 2.0 ** z
    return ((lon + 180.0) / 360.0 * n,
            (1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n)


_cache = {}


def px_at(lon, lat):
    """Return the RGB at a lon/lat from the cached z19 tiles, or None."""
    xf, yf = tile_xy_f(lon, lat, Z)
    xt, yt = int(xf), int(yf)
    key = (xt, yt)
    if key not in _cache:
        p = os.path.join(TILES, "%d_%d_%d.jpg" % (Z, xt, yt))
        _cache[key] = np.asarray(Image.open(p).convert("RGB")) if os.path.exists(p) else None
    a = _cache[key]
    if a is None:
        return None
    return a[int((yf - yt) * 256), int((xf - xt) * 256)]


def tile_frac(ring, samples=420):
    """Fraction of sampled interior pixels that look like terracotta tile."""
    lons = [p[0] for p in ring]
    lats = [p[1] for p in ring]
    w, e, s, n = min(lons), max(lons), min(lats), max(lats)
    hit = tot = 0
    g = int(math.sqrt(samples))
    for i in range(g):
        for j in range(g):
            lon = w + (e - w) * (i + 0.5) / g
            lat = s + (n - s) * (j + 0.5) / g
            if not point_in_ring(lon, lat, ring):
                continue
            c = px_at(lon, lat)
            if c is None:
                continue
            tot += 1
            R, G, B = int(c[0]), int(c[1]), int(c[2])
            mx, mn = max(R, G, B), min(R, G, B)
            if mx == 0:
                continue
            sat = (mx - mn) / mx
            # Terracotta: red dominant, green above blue, decently saturated.
            if R == mx and sat > 0.28 and R > 70 and G >= B and (R - B) > 38:
                hit += 1
    return (hit / tot if tot else 0.0), tot


def point_in_ring(x, y, ring):
    inside = False
    for (x0, y0), (x1, y1) in zip(ring, ring[1:]):
        if (y0 > y) != (y1 > y):
            xi = x0 + (y - y0) / (y1 - y0) * (x1 - x0)
            if x < xi:
                inside = not inside
    return inside


def main():
    bl = json.load(open(os.path.join(ROOT, "data/snapshots/2026-07-30/buildings.detailed.geojson"),
                        encoding="utf-8"))["features"]
    tags = json.load(open(os.path.join(ROOT, "data/building_tags.geojson"), encoding="utf-8"))["features"]
    known = {}
    for t in tags:
        p = t["properties"]
        if p.get("roof_shape"):
            known[p.get("name")] = p["roof_shape"]

    def ring_of(f):
        g = f["geometry"]
        return g["coordinates"][0] if g["type"] == "Polygon" else g["coordinates"][0][0]

    print("CALIBRATION — buildings OSM tags with roof:shape")
    for f in bl:
        nm = f["properties"].get("name")
        if nm in known:
            fr, n = tile_frac(ring_of(f))
            print("  %-46s osm=%-18s tile_frac=%.2f (n=%d)" % (nm[:46], known[nm], fr, n))

    print("\nSPREAD — a sample of campus buildings in the cached imagery")
    rows = []
    for f in bl:
        p = f["properties"]
        h = p.get("final_height") or 0
        if h < 4 or h > 40:
            continue
        r = ring_of(f)
        cx = sum(q[0] for q in r) / len(r)
        cy = sum(q[1] for q in r) / len(r)
        if not (-97.7452 <= cx <= -97.7375 and 30.2838 <= cy <= 30.2876):
            continue
        fr, n = tile_frac(r, 260)
        if n >= 40:
            rows.append((fr, h, p.get("name") or "(unnamed)"))
    rows.sort(reverse=True)
    print("  buildings sampled:", len(rows))
    for fr, h, nm in rows[:12]:
        print("   HIGH %.2f  h=%4.1f  %s" % (fr, h, nm[:44]))
    for fr, h, nm in rows[-8:]:
        print("   LOW  %.2f  h=%4.1f  %s" % (fr, h, nm[:44]))
    import statistics
    fr_all = [r[0] for r in rows]
    if fr_all:
        print("  tile_frac: median %.2f  >0.5: %d  <0.15: %d" % (
            statistics.median(fr_all), sum(1 for v in fr_all if v > 0.5),
            sum(1 for v in fr_all if v < 0.15)))


if __name__ == "__main__":
    main()
