#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""bake_downtown_scan.py -- the 2021 laser scan of downtown, small enough to keep.

    <raster dir>  (0.5 m height-above-ground raster from scripts/lidar_raster.py; private, 0.2 GB)
        ->  data/outer/downtown_scan_2m.png   (this script's ONE output)

WHY IT IS IN THE REPO. scripts/verify/downtown-accuracy.py compares what the app
draws downtown with what the scan measured, cell by cell. The scan itself is
3 GB of point clouds and stays outside the repo, so without this file nobody
else could run the comparison, and a number nobody can re-run is a claim, not a
measurement. This is the scan cut down to what the comparison needs: the roof
height above ground of every 2 m cell that the scan classed as BUILDING, as a
16-bit PNG in decimetres (0 = no building). About 0.3 MB.

The grid is the bake's own flat frame (scripts/bake_outer.py: metres east and
north of the outer box's south-west corner), not the scan's, so the comparison
needs no map-projection library. The frame is written into the PNG's text
chunk `frame`.

A 2 m cell takes the MEDIAN of the 0.5 m cells under it that are roof (2.5 m or
more), and is roof only if at least half of them are. So a wall line is neither
fattened nor thinned by more than a metre.

Source: Bexar & Travis Counties Lidar 2021, TxGIO StratMap, flown 2021-01-26 to
2021-03-07, CC0 1.0. The app does not fetch this file.

    Usage:  python scripts/bake_downtown_scan.py --raster <dir>
"""
import argparse
import json
import math
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "outer", "downtown_scan_2m.png")
DISTRICTS = os.path.join(ROOT, "data", "outer", "downtown_districts.json")

CELL = 2.0
ROOF_MIN = 2.5
MARGIN_M = 130.0
FT = 1200.0 / 3937.0

# scripts/bake_outer.py's frame, transcribed (importing it would pull in the
# whole bake): metres from the outer box's south-west corner.
OUTER_MINLON, OUTER_MINLAT, OUTER_MAXLAT = -97.7880, 30.2400, 30.3150
M_LAT = 111320.0
M_LON = M_LAT * math.cos(math.radians(0.5 * (OUTER_MINLAT + OUTER_MAXLAT)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raster", default=os.environ.get("LIDAR_RASTER_DIR"))
    a = ap.parse_args()
    if not a.raster:
        sys.exit("give the scan raster folder: --raster <dir> or LIDAR_RASTER_DIR")
    from PIL import Image, PngImagePlugin
    from pyproj import Transformer
    from shapely.geometry import shape
    from shapely.ops import unary_union

    g = json.load(open(os.path.join(a.raster, "grid.json")))
    hag = np.load(os.path.join(a.raster, "hag_bldg.f16.npy"), mmap_mode="r")
    dt = unary_union([shape(r["g"]) for r in
                      json.load(open(DISTRICTS, encoding="utf-8"))["rows"]])
    minlon, minlat, maxlon, maxlat = dt.bounds
    x0 = math.floor(((minlon - OUTER_MINLON) * M_LON - MARGIN_M) / CELL) * CELL
    x1 = math.ceil(((maxlon - OUTER_MINLON) * M_LON + MARGIN_M) / CELL) * CELL
    y0 = math.floor(((minlat - OUTER_MINLAT) * M_LAT - MARGIN_M) / CELL) * CELL
    y1 = math.ceil(((maxlat - OUTER_MINLAT) * M_LAT + MARGIN_M) / CELL) * CELL
    nx, ny = int(round((x1 - x0) / CELL)), int(round((y1 - y0) / CELL))

    tr = Transformer.from_crs("EPSG:4326", g["crs"], always_xy=True)
    k = int(round(CELL / g["res_m"]))
    offs = (np.arange(k) + 0.5) * g["res_m"]
    stack = np.full((k * k, ny, nx), np.nan, np.float32)
    i = 0
    for oy in offs:
        for ox in offs:
            xs = x0 + np.arange(nx) * CELL + ox
            ys = y1 - np.arange(ny) * CELL - oy          # row 0 is the north edge
            X, Y = np.meshgrid(xs, ys)
            lon = OUTER_MINLON + X / M_LON
            lat = OUTER_MINLAT + Y / M_LAT
            rx, ry = tr.transform(lon, lat)
            col = np.floor((np.asarray(rx) * FT - g["x0_m"]) / g["res_m"]).astype(np.int64)
            row = np.floor((g["y_top_m"] - np.asarray(ry) * FT) / g["res_m"]).astype(np.int64)
            ok = (col >= 0) & (col < g["ncols"]) & (row >= 0) & (row < g["nrows"])
            v = np.full((ny, nx), np.nan, np.float32)
            v[ok] = np.asarray(hag[row[ok], col[ok]], np.float32)
            v[~(v >= ROOF_MIN)] = np.nan
            stack[i] = v
            i += 1
    cnt = np.isfinite(stack).sum(axis=0)
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        med = np.nanmedian(stack, axis=0)
    roof = cnt >= (k * k) // 2
    dm = np.where(roof, np.clip(np.round(med * 10.0), 1, 65535), 0).astype(np.uint16)

    info = PngImagePlugin.PngInfo()
    info.add_text("frame", json.dumps({
        "x0_m": x0, "y_top_m": y1, "cell_m": CELL, "nx": nx, "ny": ny,
        "origin_lon": OUTER_MINLON, "origin_lat": OUTER_MINLAT,
        "m_per_deg_lon": M_LON, "m_per_deg_lat": M_LAT,
        "unit": "decimetres above ground; 0 = not a building in the scan",
        "source": "Bexar & Travis Counties Lidar 2021, TxGIO StratMap, "
                  "flown 2021-01-26 to 2021-03-07, CC0 1.0"}))
    Image.fromarray(dm, mode="I;16").save(OUT, pnginfo=info, optimize=True)
    print("  %d x %d cells of %.0f m, %.1f%% roof, tallest %.1f m"
          % (nx, ny, CELL, 100.0 * roof.mean(), dm.max() / 10.0))
    print("  wrote %s (%d KB)" % (OUT, os.path.getsize(OUT) // 1024))


if __name__ == "__main__":
    main()
