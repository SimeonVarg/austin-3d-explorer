#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""bake_outer_trees.py - the outer city's tree cover, as one small grid.

    <work>/lidar/raster   ->   data/outer_trees.bin
                               data/outer/outer_trees_report.json

THE ONE WRITER of data/outer_trees.bin, which js/outer-trees.js turns into trees.

WHY. The 2021 laser scan has 38 % of the outer city under vegetation 3 m or
taller. The app drew crowns over 2.4 % of it: the street and park trees of the
City's inventory, and nothing in a back yard. Tarrytown is half canopy and was
drawn with 0.6 %. A tree is not a thing worth a polygon either. Nobody knows one
back-yard oak from the next; what a resident knows is WHERE the canopy is and
how tall. So the file is a grid:

    10 m cells over the box, 4 bits a cell: 0 = no tree, else the height of the
    canopy in that cell in 2 m steps. About 0.6 bytes a tree after gzip.

and the browser plants one tree per marked cell (a little off-centre, by a hash
of the cell, so the grid does not show), as tall as the cell says and wide
enough to meet its neighbours. See js/outer-trees.js.

A CELL IS MARKED WHEN
  * at least CANOPY_MIN of its 400 scan cells carry vegetation 3 m or taller,
  * its middle is not on a roof (a tree overhangs a roof; it does not grow out
    of one) and not in a carriageway (the same rule scripts/shape_trees.py
    applies to the inventory's trees: the trunk is the test, not the crown),
  * it is outside the campus core, the Capitol strip and downtown, where the
    trees are another lane's, and
  * no tree the app already draws stands within KEEP_CLEAR of it.

    python scripts/bake_outer_trees.py --work DIR
"""
import argparse
import gzip
import json
import math
import os
import struct
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from outer_homes_lib import OUTER, Scan, area_of, excluded, in_box, to_ll, to_m, work_dir  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "outer_trees.bin")
REPORT = os.path.join(ROOT, "data", "outer", "outer_trees_report.json")
TREES = os.path.join(ROOT, "data", "trees.geojson")
ROADS = os.path.join(ROOT, "data", "roads.geojson")

CELL = 20                # scan cells (0.5 m) per grid cell: 10 m
MIN_H = 3.0              # m: lower is a shrub or a hedge
MAX_H = 40.0             # m: taller is a crane or a bird
CANOPY_MIN = 0.40        # share of a cell under canopy before it gets a tree
TOP_PCT = 0.90           # the tree is as tall as this share of the cell's canopy, not its single highest twig
ROOF_MAX = 0.50          # more of the cell's middle under roof than this: no tree
H_STEP = 2.0             # m per height level; 4 bits, so 2 to 30 m
KEEP_CLEAR = 7.0         # m around a tree the app already draws
ROAD_CLASSES = {"motorway", "trunk", "primary", "secondary", "tertiary", "residential", "unclassified", "living_street"}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--work")
    a = ap.parse_args()
    S = Scan(work_dir(a.work))
    t0 = time.time()
    nr, nc = S.NR // CELL, S.NC // CELL
    cm = CELL * S.RES
    top = np.zeros((nr, nc), np.float32)
    frac = np.zeros((nr, nc), np.float32)
    roof = np.zeros((nr, nc), np.float32)
    zv, bc = S.arr("zv_max.f32.npy"), S.arr("b_cnt.u8.npy")
    mid = slice(CELL // 4, CELL - CELL // 4)                 # the middle half of a cell, each way
    for r0 in range(0, nr * CELL, 100 * CELL):
        r1 = min(nr * CELL, r0 + 100 * CELL)
        z = np.asarray(zv[r0:r1, :nc * CELL])
        g = S.ground(r0, r1, 0, nc * CELL)
        with np.errstate(invalid="ignore"):
            h = np.where(np.isfinite(z), z - g, 0.0)
        h[(h < MIN_H) | (h > MAX_H)] = 0
        k = (r1 - r0) // CELL
        cells = h.reshape(k, CELL, nc, CELL).transpose(0, 2, 1, 3)
        flat = np.sort(cells.reshape(k, nc, CELL * CELL), axis=2)
        n_can = (flat > 0).sum(axis=2)
        frac[r0 // CELL:r0 // CELL + k] = n_can / float(CELL * CELL)
        # the TOP_PCT point of the canopy cells only (the zeros sort first)
        idx = np.clip(CELL * CELL - 1 - ((1 - TOP_PCT) * n_can).astype(int), 0, CELL * CELL - 1)
        top[r0 // CELL:r0 // CELL + k] = np.take_along_axis(flat, idx[..., None], 2)[..., 0]
        b = (np.asarray(bc[r0:r1, :nc * CELL]) > 0).reshape(k, CELL, nc, CELL).transpose(0, 2, 1, 3)
        roof[r0 // CELL:r0 // CELL + k] = b[:, :, mid, mid].mean(axis=(2, 3))
    occ = (frac >= CANOPY_MIN) & (top >= MIN_H)
    counts = {"cells": int(nr * nc), "canopy_cells": int(occ.sum())}

    # the cell centres, in the metre frame and in longitude / latitude
    cx = S.X0 + (np.arange(nc) + 0.5) * cm
    cy = S.YT - (np.arange(nr) + 0.5) * cm
    X, Y = np.meshgrid(cx, cy)
    lon, lat = to_ll(X, Y)
    inside = np.zeros((nr, nc), bool)
    for i in range(nr):
        for j in range(nc):
            if occ[i, j]:
                inside[i, j] = in_box(lon[i, j], lat[i, j], OUTER) and not excluded(lon[i, j], lat[i, j])
    counts["dropped_other_lanes_or_outside"] = int((occ & ~inside).sum())
    occ &= inside
    on_roof = roof > ROOF_MAX
    counts["dropped_on_a_roof"] = int((occ & on_roof).sum())
    occ &= ~on_roof

    def cell_of(x, y):
        return int((S.YT - y) / cm), int((x - S.X0) / cm)

    # carriageways: every cell whose centre is within half the road's width of its centre line
    road = np.zeros((nr, nc), bool)
    for f in json.load(open(ROADS, encoding="utf-8"))["features"]:
        p = f["properties"]
        if p.get("k") != "road" or p.get("c") not in ROAD_CLASSES or f["geometry"]["type"] != "LineString":
            continue
        c = np.asarray(f["geometry"]["coordinates"], float)
        if not (c[:, 0].max() >= OUTER[0] and c[:, 0].min() <= OUTER[2] and c[:, 1].max() >= OUTER[1] and c[:, 1].min() <= OUTER[3]):
            continue
        mx, my = to_m(c[:, 0], c[:, 1])
        half = float(p.get("w") or 8.0) / 2.0
        for k in range(len(mx) - 1):
            seg = math.hypot(mx[k + 1] - mx[k], my[k + 1] - my[k])
            for t in np.linspace(0.0, 1.0, max(2, int(seg / 2.5) + 1)):
                x, y = mx[k] + (mx[k + 1] - mx[k]) * t, my[k] + (my[k + 1] - my[k]) * t
                reach = int(math.ceil(half / cm))
                r_, c_ = cell_of(x, y)
                for dr in range(-reach, reach + 1):
                    for dc in range(-reach, reach + 1):
                        rr, cc = r_ + dr, c_ + dc
                        if 0 <= rr < nr and 0 <= cc < nc and math.hypot(cx[cc] - x, cy[rr] - y) <= half:
                            road[rr, cc] = True
    counts["dropped_in_a_carriageway"] = int((occ & road).sum())
    occ &= ~road

    # trees the app already draws (the City's inventory, mostly)
    near = np.zeros((nr, nc), bool)
    for f in json.load(open(TREES, encoding="utf-8"))["features"]:
        if f["properties"].get("kind") == "trunk":
            continue
        ring = np.asarray(f["geometry"]["coordinates"][0], float)
        lo, la = ring[:, 0].mean(), ring[:, 1].mean()
        if not in_box(lo, la, OUTER):
            continue
        x, y = (float(q) for q in to_m(lo, la))
        r_, c_ = cell_of(x, y)
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                rr, cc = r_ + dr, c_ + dc
                if 0 <= rr < nr and 0 <= cc < nc and math.hypot(cx[cc] - x, cy[rr] - y) <= KEEP_CLEAR:
                    near[rr, cc] = True
    counts["dropped_beside_a_drawn_tree"] = int((occ & near).sum())
    occ &= ~near
    counts["trees"] = int(occ.sum())

    level = np.where(occ, np.clip(np.round(top / H_STEP), 2, 15), 0).astype(np.uint8)
    # two cells a byte, high nibble first
    if (nr * nc) % 2:
        raise SystemExit("odd cell count")
    flat = level.reshape(-1)
    packed = ((flat[0::2] << 4) | flat[1::2]).astype(np.uint8)

    # cell (row, column) -> longitude, latitude: a plane fitted to the exact values. The worst cell is written down.
    R, C = np.meshgrid(np.arange(nr) + 0.5, np.arange(nc) + 0.5, indexing="ij")
    A = np.column_stack([np.ones(R.size), C.ravel(), R.ravel()])
    k_lon, *_ = np.linalg.lstsq(A, lon.ravel(), rcond=None)
    k_lat, *_ = np.linalg.lstsq(A, lat.ravel(), rcond=None)
    err = max(float(np.abs(A @ k_lon - lon.ravel()).max()) * 111320 * math.cos(math.radians(30.28)),
              float(np.abs(A @ k_lat - lat.ravel()).max()) * 111320)
    head = b"OTR1" + struct.pack("<IIff", nr, nc, cm, H_STEP) + struct.pack("<6d", *k_lon, *k_lat)
    body = head + packed.tobytes()
    gz = gzip.compress(body, 9, mtime=0)
    with open(OUT, "wb") as f:
        f.write(gz)

    # canopy per area, for the accuracy table: the scan, and what the grid will draw
    areas = {}
    for i in range(0, nr):
        for j in range(0, nc):
            a_ = area_of(float(lon[i, j]), float(lat[i, j]))
            if a_ is None:
                continue
            d = areas.setdefault(a_, [0, 0.0, 0])
            d[0] += 1
            d[1] += float(frac[i, j])
            d[2] += int(occ[i, j])
    hs = top[occ]
    rep = dict(counts=counts, grid=[nr, nc], cell_m=cm, raw_bytes=len(body), gzip_bytes=len(gz),
               bytes_per_tree=round(len(gz) / max(1, counts["trees"]), 2), plane_fit_worst_m=round(err, 3),
               height_pcts_m={"p10": round(float(np.percentile(hs, 10)), 1), "p50": round(float(np.percentile(hs, 50)), 1),
                              "p90": round(float(np.percentile(hs, 90)), 1)},
               per_area={k: dict(scan_canopy_pct=round(100 * v[1] / v[0], 1), cells_with_a_tree_pct=round(100 * v[2] / v[0], 1),
                                 trees=v[2]) for k, v in sorted(areas.items())},
               source="StratMap Bexar & Travis Counties Lidar 2021, TxGIO, CC0-1.0 (vegetation classes 3 to 5)")
    with open(REPORT, "w", encoding="utf-8") as f:
        json.dump(rep, f, indent=1, sort_keys=True)
    print(json.dumps({k: v for k, v in rep.items() if k != "per_area"}))
    print("wrote", OUT, len(gz), "bytes in %.0f s" % (time.time() - t0))


if __name__ == "__main__":
    main()
