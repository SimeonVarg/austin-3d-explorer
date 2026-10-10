#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""bake_outer_homes.py - the houses of the outer city, measured.

    <work>/overture, <work>/lidar/raster, <work>/img   ->   data/outer_homes.bin
                                                              data/outer/outer_homes_split.json
                                                              data/outer/outer_homes_report.json

THE ONE WRITER of data/outer_homes.bin, the file js/outer-homes.js draws. The
inputs are public and live OUTSIDE the repo; scripts/fetch_outer_homes_inputs.py
fetches them (its header has every source and licence). docs/outer-homes.md has
the method in words, the accuracy table and what is still wrong.

WHY THIS EXISTS. scripts/bake_outer.py keeps a footprint only when it is tall or
big for its distance, so the frame budget survives ten times the core's area.
Measured against the City's 2023 outlines that rule kept 15.6 % of the outer
city's buildings: a house is under the limit almost everywhere. A resident
looking for their street found bare ground. A house does not need a polygon, a
facade or a draw call of its own, though. It needs eleven bytes:

    where it is, how long and wide, which way it faces, how high its walls
    are, how high its ridge is, what kind of roof, and two colours.

FOUR STAGES, each cached in the work folder so a change to a later one does not
repeat an earlier one (--from a|b|c|d):

  a  WHICH BUILDINGS, AS RECTANGLES. Every Overture building outside the core,
     the Capitol strip and downtown that no other lane draws. An outline that
     fills 80 % of its bounding rectangle is that rectangle; any other is
     carved into at most three (the largest rectangle inside it, then the
     largest in what is left). The ring's own low-rise prisms are taken over
     when rectangles keep their outline (IoU >= 0.78) and they are house-sized.
  b  WALLS AND ROOF, FROM THE 2021 LASER SCAN. Per rectangle: flat or pitched
     from the roof surface's own slope (median over the surface, after a 2.5 m
     median takes the roof units off); which pitched roof from a least-squares
     fit of three ridge models; eave from the fit, ridge from the surface's
     97th percentile. Building-class returns only, so a tree over a roof is not
     the roof. Heights are absolute: a roof is level even when its lot is not.
  c  IS IT STILL THERE, AND WHAT IS MISSING. A footprint with no building under
     it in 2021 is dropped (gone) or replaced (moved). Then every building the
     scan has that no footprint has is found, as blobs of building-class cells
     outside every known outline, and carved into rectangles the same way.
  d  COLOUR, AND THE FILE. Roof colour: the sunlit half of the roof's own
     pixels in the City's 2025 aerial, 64 colours by k-means. Wall colour:
     INFERRED from a per-area mix (an aerial does not show a wall).

    python scripts/bake_outer_homes.py --work DIR [--from a|b|c|d] [--jobs 3]
    python scripts/bake_outer.py --homes-split        # then: hand the ring's houses over
    bash scripts/tile.sh                              # then: rebuild data/tiles/outer.pmtiles
"""
import argparse
import collections
import gzip
import hashlib
import json
import math
import os
import pickle
import struct
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from outer_homes_lib import (OUTER, DOWNTOWN, Scan, area_of, excluded, geom_m, in_box,  # noqa: E402
                             max_rect, rect_poly, to_ll, work_dir)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "outer_homes.bin")
SPLIT = os.path.join(ROOT, "data", "outer", "outer_homes_split.json")
REPORT = os.path.join(ROOT, "data", "outer", "outer_homes_report.json")
RING = os.path.join(ROOT, "data", "outer_ring.geojson")
CORE_SNAP = os.path.join(ROOT, "data", "snapshots", "2026-07-30", "buildings.detailed.geojson")
CAPITOL_GJ = os.path.join(ROOT, "data", "capitol.geojson")

# ══════════════════════════════════════════════════════════════════════
#  Every number that is a choice. Stage by stage.
# ══════════════════════════════════════════════════════════════════════
# a. footprints
MIN_AREA = 18.0          # m2: smaller is a shed nobody recognises a street by
RECT_OK = 0.80           # outline area / bounding rectangle area at or above this: one rectangle
MAX_RECTS = 3
MIN_PART = 7.0           # m2: a carved rectangle smaller than this is dropped
MIN_PART_SHARE = 0.07    # ... or smaller than this share of the building
RING_TAKE_IOU = 0.78     # a ring prism is taken over only when rectangles keep its outline this well
RING_TAKE_AREA = 1500.0  # m2: bigger stays a polygon in the ring
# b. roofs
MIN_CELLS = 14           # building-class cells a rectangle needs before its roof is fitted
MIN_COVER = 0.22         # share of a footprint's cells that carry building-class returns
PITCH_MIN_RISE = 0.55    # m: a fitted rise under this is a flat roof
HIP_GAIN = 0.90          # a hip must beat the gable's residual by this factor
MAX_SLOPE = 1.3          # rise over run; steeper is not a roof plane
FLAT_RANGE = 0.80        # m: with no slope reading, a surface spanning less than this is flat
RIDGE_PCT = 97           # the ridge is this percentile of the surface (the very top is chimneys and vents)
FLAT_PCT = 85            # a flat roof's top is its parapet, not the middle of its deck
SLOPE_SMOOTH_CELLS = 5   # 2.5 m median before the slope is read
SLOPE_FLAT = 0.10        # median slope (rise over run) under this is a flat roof, however many levels it has
# c. presence
KEEP_COVER = 0.45        # a footprint with this share of building-class cells is where the scan says a building is
GONE_FIRST = 1.5         # m: first returns at or below this over a footprint with no building = nothing stands there
HIDDEN_MIN_COVER = 0.15  # under trees with fewer roof cells than this, half are not in the City's 2023 outlines ...
HIDDEN_KEEP_AREA = 150.0 # ... so only the big ones are kept
BLOB_MIN_M2 = 28.0       # smallest scan-only building
BLOB_MIN_H = 2.6         # m: lower is a carport, a canopy or a truck
BLOB_MIN_SIDE = 3.5      # m: narrower is a wall or a fence line
BLOCK, OVER = 2400, 160  # the blob search walks the raster in blocks of cells, with this overlap
# d. colour and packing
N_ROOF = 64
STEP_SIZE = 0.2          # m per unit of half length / half width
STEP_H = 0.2             # m per unit of eave and rise
RING_PCT = 90            # a ring prism that stays is raised to this percentile of its roof ...
RING_RAISE_MIN = 1.5     # ... when that is at least this much above it. RAISES ONLY (docs/lidar-heights.md).
DEFAULT_ROOF = (118, 112, 106)   # weathered shingle: only where no roof pixel could be read
M_LAT = 111320.0
LON0, LAT0 = OUTER[0], OUTER[1]
M_LON = M_LAT * math.cos(math.radians(LAT0))
STEP_XY = (max((OUTER[2] - OUTER[0]) * M_LON, (OUTER[3] - OUTER[1]) * M_LAT) + 1.0) / 65535.0
# Wall colours. INFERRED, and said so wherever the number is used: an aerial does
# not show a wall. Twenty paints and masonries; the mix is by the housing stock of
# the area (prewar bungalow streets are painted siding, postwar ranch streets are
# brick and limestone), and the choice within the mix is a stable hash of the
# building's position, so a re-bake does not repaint the city.
WALLS = ["#e8e4da", "#d9d2c0", "#cbb392", "#c2bdae", "#a9a59a", "#8a8f92", "#6f7a7d", "#55595c", "#9fb0a3", "#a7b8c4",
         "#d8c98a", "#b98b6e", "#a9765d", "#8c5a48", "#d5cdba", "#c9b9a0", "#b0aca4", "#7d6a58", "#3f4346", "#c7a98f"]
MIX = {
    "bungalow": {0: .20, 1: .12, 2: .07, 3: .08, 4: .06, 5: .06, 6: .04, 7: .05, 8: .07, 9: .06, 10: .05, 11: .03, 12: .03, 17: .04, 18: .03, 15: .01},
    "ranch":    {15: .14, 14: .10, 11: .10, 19: .10, 12: .09, 13: .04, 0: .12, 1: .08, 3: .06, 4: .05, 2: .05, 7: .03, 17: .02, 8: .02},
    "other":    {14: .30, 16: .20, 12: .14, 3: .12, 2: .10, 4: .08, 7: .06},
}
STOCK = {"Hyde Park": "bungalow", "Old West Austin": "bungalow", "Bouldin Creek": "bungalow", "Travis Heights-SoCo": "bungalow",
         "Central East": "bungalow", "Holly-Cesar Chavez": "bungalow", "Tarrytown": "ranch", "Rosedale-Heritage": "ranch",
         "Hancock-Cherrywood": "ranch", "Zilker-Barton Hills": "ranch", "West Lake shore": "ranch", "East Riverside": "other"}

WORK = None
SCAN = None


def scan():
    global SCAN
    if SCAN is None:
        SCAN = Scan(WORK)
    return SCAN


def cache(name):
    return os.path.join(WORK, "bake_" + name + ".pkl")


# ══════════════════════════════════════════════════════════════════════
#  a. which buildings, as rectangles
# ══════════════════════════════════════════════════════════════════════
def decompose(P):
    """A footprint in the metre frame -> ([(cx, cy, half_long, half_short, angle of the long axis)], IoU)."""
    import shapely
    from shapely import affinity
    mrr = P.minimum_rotated_rectangle
    if mrr.geom_type != "Polygon":
        return [], 0.0
    c = np.asarray(mrr.exterior.coords)[:4]
    e0, e1 = c[1] - c[0], c[2] - c[1]
    l0, l1 = np.hypot(*e0), np.hypot(*e1)
    if l0 < 0.5 or l1 < 0.5:
        return [], 0.0
    if l0 >= l1:
        th, L, W = math.atan2(e0[1], e0[0]), l0 / 2, l1 / 2
    else:
        th, L, W = math.atan2(e1[1], e1[0]), l1 / 2, l0 / 2
    ctr = c.mean(axis=0)
    fill = P.area / (4 * L * W)
    if fill >= RECT_OK:
        s = math.sqrt(fill)                       # the equal-area rectangle
        return [(ctr[0], ctr[1], L * s, W * s, th)], fill
    Q = affinity.rotate(P, -math.degrees(th), origin=(ctr[0], ctr[1]))
    step = 0.25 if L < 20 else (0.5 if L < 45 else 1.0)
    xs = np.arange(ctr[0] - L + step / 2, ctr[0] + L, step)
    ys = np.arange(ctr[1] - W + step / 2, ctr[1] + W, step)
    X, Y = np.meshgrid(xs, ys)
    M0 = shapely.contains_xy(Q, X, Y)
    M = M0.copy()
    rects, cover = [], np.zeros_like(M0)
    need = max(MIN_PART, MIN_PART_SHARE * P.area) / (step * step)
    for _ in range(MAX_RECTS):
        a, r0, r1, c0, c1 = max_rect(M)
        if a < need:
            break
        rects.append([c0, c1, r0, r1])
        M[r0:r1, c0:c1] = False
        cover[r0:r1, c0:c1] = True
    if not rects:
        s = math.sqrt(fill)
        return [(ctr[0], ctr[1], L * s, W * s, th)], fill
    iou = (cover & M0).sum() / max(1, (cover | M0).sum())
    # A wing runs into the main block, so its roof meets the main roof instead of stopping at a wall.
    a = rects[0]
    for b in rects[1:]:
        ov_r = min(a[3], b[3]) - max(a[2], b[2])
        ov_c = min(a[1], b[1]) - max(a[0], b[0])
        if ov_r > 0 and ov_c <= 0:
            ext = int(min((b[3] - b[2]) / 2, (a[1] - a[0]) / 2))
            if abs(b[1] - a[0]) <= 1:
                b[1] += ext
            elif abs(b[0] - a[1]) <= 1:
                b[0] -= ext
        elif ov_c > 0 and ov_r <= 0:
            ext = int(min((b[1] - b[0]) / 2, (a[3] - a[2]) / 2))
            if abs(b[3] - a[2]) <= 1:
                b[3] += ext
            elif abs(b[2] - a[3]) <= 1:
                b[2] -= ext
    out = []
    ct, st = math.cos(th), math.sin(th)
    for c0, c1, r0, r1 in rects:
        x0 = xs[0] - step / 2 + c0 * step
        x1 = xs[0] - step / 2 + c1 * step
        y0 = ys[0] - step / 2 + r0 * step
        y1 = ys[0] - step / 2 + r1 * step
        mx, my = (x0 + x1) / 2 - ctr[0], (y0 + y1) / 2 - ctr[1]
        gx, gy = ctr[0] + mx * ct - my * st, ctr[1] + mx * st + my * ct
        hx, hy = (x1 - x0) / 2, (y1 - y0) / 2
        out.append((gx, gy, hx, hy, th) if hx >= hy else (gx, gy, hy, hx, th + math.pi / 2))
    return out, float(iou)


def stage_a(log):
    import duckdb
    import shapely
    from shapely import STRtree
    from shapely.geometry import Polygon, shape
    t0 = time.time()
    rows = duckdb.connect().execute(
        "select id, name, height, src[1], wkb from '%s'" % os.path.join(WORK, "overture", "building.parquet")).fetchall()
    # Two kinds of "already drawn": HARD (the core, the Capitol, downtown and every tower or streetwall body:
    # another lane's city, never touched) and the ring's flat prisms outside downtown, which this layer may take.
    hard, ringflat, ringidx = [], [], []
    for k, f in enumerate(json.load(open(RING, encoding="utf-8"))["features"]):
        p = f["properties"]
        if "k" in p:
            continue
        g = shape(f["geometry"])
        c = g.centroid
        if p.get("t") in (1, 2) or in_box(c.x, c.y, DOWNTOWN):
            hard.append(g)
        else:
            ringflat.append(g)
            ringidx.append(k)
    for fn in (CORE_SNAP, CAPITOL_GJ):
        for f in json.load(open(fn, encoding="utf-8"))["features"]:
            hard.append(shape(f["geometry"]))
    Hm = [geom_m(g if g.is_valid else g.buffer(0)) for g in hard]
    Fm = [geom_m(g if g.is_valid else g.buffer(0)) for g in ringflat]
    htree, ftree = STRtree(Hm), STRtree(Fm)
    out, cnt = [], collections.Counter()
    for id_, name, h, src, wkb in rows:
        g = shapely.from_wkb(bytes(wkb))
        if not g.is_valid:
            g = g.buffer(0)
        if g.geom_type == "MultiPolygon":
            g = max(g.geoms, key=lambda p: p.area)
        if g.geom_type != "Polygon" or g.is_empty:
            cnt["bad_geometry"] += 1
            continue
        c = g.centroid
        if not in_box(c.x, c.y, OUTER):
            cnt["outside_box"] += 1
            continue
        if excluded(c.x, c.y):
            cnt["core_capitol_downtown"] += 1
            continue
        P = geom_m(Polygon(g.exterior))
        if P.area < MIN_AREA:
            cnt["too_small"] += 1
            continue
        a = 0.0
        for j in htree.query(P):
            try:
                a += P.intersection(Hm[j]).area
            except Exception:                       # noqa: BLE001
                pass
        if a / P.area >= 0.3:
            cnt["drawn_by_another_lane"] += 1
            continue
        b, mine, droppable = 0.0, [], False
        rp = P.representative_point()
        for j in ftree.query(P):
            try:
                x = P.intersection(Fm[j]).area
            except Exception:                       # noqa: BLE001
                x = 0.0
            if x > 0.3 * min(P.area, Fm[j].area):
                mine.append(ringidx[j])
            # the test scripts/bake_outer.py:apply_homes_split() will make: only then can the prism be removed
            if Fm[j].contains(rp) and abs(Fm[j].area - P.area) <= 0.45 * max(P.area, Fm[j].area):
                droppable = True
            b += x
        rects, iou = decompose(P)
        if not rects:
            cnt["no_rectangle"] += 1
            continue
        in_ring = b / P.area >= 0.5
        if in_ring and (iou < RING_TAKE_IOU or P.area > RING_TAKE_AREA or not droppable):
            cnt["ring_keeps_it"] += 1
            continue
        cnt["kept"] += 1
        cnt["rectangles"] += len(rects)
        cnt["taken_from_ring"] += int(in_ring)
        out.append(dict(id=id_, name=name, ov_h=h, src=src, lon=c.x, lat=c.y, area=P.area, poly=P, rects=rects,
                        iou=iou, ring=mine if in_ring else None))
    io = np.array([o["iou"] for o in out])
    ar = np.array([o["area"] for o in out])
    rep = dict(counts=dict(cnt), iou_mean=round(float(io.mean()), 3), iou_area_weighted=round(float((io * ar).sum() / ar.sum()), 3),
               iou_p10=round(float(np.percentile(io, 10)), 3), iou_below_0_7_pct=round(100 * float((io < 0.7).mean()), 2),
               rect_count=dict(collections.Counter(len(o["rects"]) for o in out)))
    log("a", rep, time.time() - t0)
    pickle.dump(out, open(cache("a"), "wb"))
    return rep


# ══════════════════════════════════════════════════════════════════════
#  b. walls and roof, from the scan
# ══════════════════════════════════════════════════════════════════════
def robust(A, h):
    """Least squares, twice re-fitted without the cells that sit far off (chimneys, a tree's edge)."""
    co, *_ = np.linalg.lstsq(A, h, rcond=None)
    r = h - A @ co
    for _ in range(2):
        lim = max(0.35, 2.5 * 1.48 * np.median(np.abs(r - np.median(r))))
        k = np.abs(r) < lim
        if k.sum() < max(6, A.shape[1] + 2):
            break
        co, *_ = np.linalg.lstsq(A[k], h[k], rcond=None)
        r = h - A @ co
    return co, float(np.sqrt(np.mean(np.clip(r, -1.5, 1.5) ** 2)))


def fit_roof(u, v, h, L, W, gu=None, gv=None):
    """u along the long axis (|u| <= L), v across; gu, gv the surface's slope along each, per cell.
    kind: 0 flat, 1 gable with the ridge along the long axis, 2 hip, 3 gable with the ridge across it."""
    one = np.ones_like(h)
    _, rF = robust(one[:, None], h)
    rng = float(np.percentile(h, 95) - np.percentile(h, 5))
    out = dict(kind=0, eave=float(np.percentile(h, FLAT_PCT)), rise=0.0, rms=rF, n=int(h.size), rng=rng, slope=None, how="flat")
    ok = np.isfinite(gu) & np.isfinite(gv) if gu is not None else np.zeros(h.size, bool)
    if ok.sum() >= 10:
        mag = np.hypot(gu[ok], gv[ok])
        slope = float(np.median(mag))
        out["slope"] = slope
        if slope < SLOPE_FLAT or rng < 0.5:
            return out
        steep = mag > 0.08
        eu = float(np.mean(np.abs(gu[ok][steep]))) if steep.any() else 0.0
        ev = float(np.mean(np.abs(gv[ok][steep]))) if steep.any() else 0.0
    else:
        if rng < FLAT_RANGE:
            return out
        slope, eu, ev = None, 0.0, 0.0
    cands = []
    for kind, f, run in ((1, np.clip(W - np.abs(v), 0, None), W), (3, np.clip(L - np.abs(u), 0, None), L),
                         (2, np.clip(np.minimum(W - np.abs(v), L - np.abs(u)), 0, None), min(W, L))):
        if run < 1.0:
            continue
        co, r = robust(np.column_stack([one, f]), h)
        e, sl = float(co[0]), float(co[1])
        if sl <= 0.04 or sl > MAX_SLOPE or sl * run < PITCH_MIN_RISE or e < 1.8:
            continue
        cands.append((r, kind, e, sl * run))
    g = [c for c in cands if c[1] != 2]
    hp = [c for c in cands if c[1] == 2]
    best = min(g) if g else None
    if hp and (best is None or hp[0][0] < HIP_GAIN * best[0]):
        best = hp[0]
    if best is not None and best[0] <= 0.97 * rF:
        r, kind, e, rise = best
        hi = float(np.percentile(h, RIDGE_PCT))
        out.update(kind=kind, eave=e, rise=float(np.clip(max(rise, hi - e), PITCH_MIN_RISE, 7.0)), rms=r, how="model")
        return out
    # Pitched by its slopes, but no single ridge explains it (several ridges, an off-centre ridge, a shed, a
    # step): a gable whose ridge runs across the stronger slope direction, as tall as the surface is.
    lo, hi = float(np.percentile(h, 8)), float(np.percentile(h, RIDGE_PCT))
    kind = 1 if (ev >= eu or slope is None) else 3
    rise = float(np.clip(hi - lo, PITCH_MIN_RISE, 6.5))
    if lo < 1.8:
        lo = max(1.8, hi - rise)
    out.update(kind=kind, eave=lo, rise=rise, how="slopes")
    return out


def measure(o):
    """Everything the scan says about one building: cover, canopy, ground, and a roof per rectangle."""
    import shapely
    from scipy import ndimage as ndi
    S = scan()
    P = o["poly"]
    x0, y0, x1, y1 = P.bounds
    r0, r1, c0, c1 = S.window(x0, y0, x1, y1, pad=1.0)
    if r1 - r0 < 2 or c1 - c0 < 2:
        return None
    zb = np.asarray(S.arr("zb_max.f32.npy")[r0:r1, c0:c1])
    zf = np.asarray(S.arr("zf_max.f32.npy")[r0:r1, c0:c1])
    X, Y = S.centres(r0, r1, c0, c1)
    inside = shapely.contains_xy(P, X, Y)
    n_in = int(inside.sum())
    if n_in < 8:
        return None
    gp = S.ground(r0, r1, c0, c1)
    if not np.isfinite(zf).any():
        return dict(cover=0.0, n_in=n_in, nolidar=True)
    g0 = float(np.median(gp[inside]))            # ONE ground level per building: the app's ground is flat
    with np.errstate(invalid="ignore"):
        hb, hf = zb - g0, zf - g0
        has = inside & np.isfinite(zb) & (zb - gp > 1.5) & (hb < 80)
        seen = inside & np.isfinite(zf)
        over = inside & np.isfinite(zf) & ((~np.isfinite(zb) & (hf > 3.0)) | (np.isfinite(zb) & (zf - zb > 1.5)))
        fin = np.isfinite(zb) & (zb - gp > 1.5)
    res = dict(n_in=n_in, cover=float(has.sum() / n_in), ground=g0, canopy=float(over.sum() / n_in))
    if seen.sum() > 0:
        res["first_p50"] = float(np.median(hf[seen]))
        res["first_p90"] = float(np.percentile(hf[seen], 90))
    if has.sum() >= 6:
        hh = hb[has]
        res.update(h_p50=float(np.median(hh)), h_p90=float(np.percentile(hh, RING_PCT)))
    # The roof's slope, cell by cell, from a surface with the small things taken off it first: a 2.5 m median
    # removes roof units, skylight ribs and chimneys and leaves the planes. Without it a flat roof with
    # machinery on it reads as steep as a gable (median slope 0.2 to 0.6 on two labelled flat roofs).
    if fin.any():
        filled = np.where(fin, hb, np.float32(np.median(hb[fin])))
        sm = ndi.median_filter(filled, size=SLOPE_SMOOTH_CELLS, mode="nearest")
        d_row, d_col = np.gradient(sm, S.RES)
        solid = ndi.binary_erosion(fin, np.ones((3, 3)), border_value=0)     # not beside a gap: the fill is not roof
        d_row, d_col = np.where(solid, d_row, np.nan), np.where(solid, d_col, np.nan)
    else:
        d_row = d_col = np.full(zb.shape, np.nan)
    g_e, g_n = d_col, -d_row
    fits, taken = [], np.zeros_like(inside)
    for (cx, cy, L, W, th) in o["rects"]:
        ct, st = math.cos(th), math.sin(th)
        dx, dy = X - cx, Y - cy
        u, v = dx * ct + dy * st, -dx * st + dy * ct
        box = (np.abs(u) <= L) & (np.abs(v) <= W)
        m = has & box & ~taken                    # a wing does not fit the cells its main block already has
        taken |= box
        if m.sum() >= MIN_CELLS and res["cover"] >= MIN_COVER:
            fits.append(fit_roof(u[m], v[m], hb[m], L, W, (g_e * ct + g_n * st)[m], (-g_e * st + g_n * ct)[m]))
        else:
            fits.append(None)
    res["fits"] = fits
    return res


def _b_worker(args):
    global WORK
    WORK, lo, hi = args
    A = pickle.load(open(cache("a"), "rb"))
    out = {}
    for i in range(lo, hi):
        try:
            out[i] = measure(A[i])
        except Exception:                           # noqa: BLE001
            out[i] = None
    return out


def stage_b(log, jobs):
    import multiprocessing as mp
    t0 = time.time()
    n = len(pickle.load(open(cache("a"), "rb")))
    parts = [(WORK, a, min(n, a + 1500)) for a in range(0, n, 1500)]
    out = {}
    with mp.Pool(jobs) as pool:
        for part in pool.imap_unordered(_b_worker, parts):
            out.update(part)
    pickle.dump(out, open(cache("b"), "wb"))
    fits = [f for r in out.values() if r and r.get("fits") for f in r["fits"]]
    rep = dict(measured=len(out), roof_kinds=dict(collections.Counter((f["kind"] if f else -1) for f in fits)),
               decided_by=dict(collections.Counter(f["how"] for f in fits if f)))
    log("b", rep, time.time() - t0)
    return rep


# ══════════════════════════════════════════════════════════════════════
#  c. is it still there, and what is missing
# ══════════════════════════════════════════════════════════════════════
def raster_polys(polys, r0, r1, c0, c1):
    import shapely
    S = scan()
    M = np.zeros((r1 - r0, c1 - c0), bool)
    for P in polys:
        x0, y0, x1, y1 = P.bounds
        a0, a1, b0, b1 = S.window(x0, y0, x1, y1)
        a0, a1, b0, b1 = max(a0, r0), min(a1, r1), max(b0, c0), min(b1, c1)
        if a1 <= a0 or b1 <= b0:
            continue
        X, Y = S.centres(a0, a1, b0, b1)
        M[a0 - r0:a1 - r0, b0 - c0:b1 - c0] |= shapely.contains_xy(P, X, Y)
    return M


def decompose_cells(xs, ys, area):
    """Rectangles for a blob of scan cells (their centres, metres)."""
    from scipy import ndimage as ndi
    from shapely.geometry import MultiPoint
    mrr = MultiPoint(np.column_stack([xs, ys])).convex_hull.minimum_rotated_rectangle
    if mrr.geom_type != "Polygon":
        return [], 0.0
    c = np.asarray(mrr.exterior.coords)[:4]
    e0, e1 = c[1] - c[0], c[2] - c[1]
    l0, l1 = np.hypot(*e0), np.hypot(*e1)
    if l0 >= l1:
        th, L, W = math.atan2(e0[1], e0[0]), l0 / 2 + 0.25, l1 / 2 + 0.25
    else:
        th, L, W = math.atan2(e1[1], e1[0]), l1 / 2 + 0.25, l0 / 2 + 0.25
    ctr = c.mean(axis=0)
    ct, st = math.cos(th), math.sin(th)
    u = (xs - ctr[0]) * ct + (ys - ctr[1]) * st
    v = -(xs - ctr[0]) * st + (ys - ctr[1]) * ct
    step = 0.5 if L < 40 else 1.0
    nu, nv = int(np.ceil(2 * L / step)) + 1, int(np.ceil(2 * W / step)) + 1
    M0 = np.zeros((nv, nu), bool)
    M0[np.clip(((v + W) / step).astype(int), 0, nv - 1), np.clip(((u + L) / step).astype(int), 0, nu - 1)] = True
    M0 = ndi.binary_fill_holes(ndi.binary_closing(M0, np.ones((3, 3)), border_value=0) | M0)   # a rotated grid leaves pinholes
    M = M0.copy()
    rects, cover = [], np.zeros_like(M0)
    nmax = 3 if area < 350 else (5 if area < 1000 else 8)
    need = max(MIN_PART, MIN_PART_SHARE * area) / (step * step)
    for _ in range(nmax):
        a, r0, r1, c0, c1 = max_rect(M)
        if a < need:
            break
        rects.append((c0, c1, r0, r1))
        M[r0:r1, c0:c1] = False
        cover[r0:r1, c0:c1] = True
    if not rects:
        return [], 0.0
    iou = (cover & M0).sum() / max(1, (cover | M0).sum())
    out = []
    for c0, c1, r0, r1 in rects:
        mu, mv = -L + (c0 + c1) / 2 * step, -W + (r0 + r1) / 2 * step
        hu, hv = (c1 - c0) * step / 2, (r1 - r0) * step / 2
        gx, gy = ctr[0] + mu * ct - mv * st, ctr[1] + mu * st + mv * ct
        out.append((gx, gy, hu, hv, th) if hu >= hv else (gx, gy, hv, hu, th + math.pi / 2))
    return out, float(iou)


def stage_c(log):
    import shapely
    from scipy import ndimage as ndi
    from shapely.geometry import MultiPoint, shape
    t0 = time.time()
    S = scan()
    A = pickle.load(open(cache("a"), "rb"))
    B = pickle.load(open(cache("b"), "rb"))
    verdict, cnt = {}, collections.Counter()
    for i, o in enumerate(A):
        r = B.get(i)
        if not r or r.get("nolidar"):
            v = "noscan"                          # outside the tiles read (the north 280 m of the box)
        elif r["cover"] >= KEEP_COVER:
            v = "ok"
        elif r.get("canopy", 0) >= 0.35 or (r.get("first_p50", 0) > 3.0 and r["cover"] > 0.08):
            v = "hidden"                          # under trees
        elif r.get("first_p90", 9) <= GONE_FIRST:
            v = "gone"
        else:
            v = "moved"                           # something stands near here, but not on this outline
        if v == "hidden" and r["cover"] < HIDDEN_MIN_COVER and o["area"] < HIDDEN_KEEP_AREA:
            v = "hidden_dropped"
        verdict[i] = v
        cnt[v] += 1
    known = [o["poly"] for i, o in enumerate(A) if verdict[i] in ("ok", "hidden", "noscan")]
    for f in json.load(open(RING, encoding="utf-8"))["features"]:
        if "k" not in f["properties"]:
            known.append(geom_m(shape(f["geometry"]).buffer(0)))
    for fn in (CORE_SNAP, CAPITOL_GJ):
        for f in json.load(open(fn, encoding="utf-8"))["features"]:
            known.append(geom_m(shape(f["geometry"]).buffer(0)))
    known = [p for g in known for p in (g.geoms if g.geom_type == "MultiPolygon" else [g]) if p.geom_type == "Polygon" and not p.is_empty]
    tree = shapely.STRtree(known)
    zb, bc, D = S.arr("zb_max.f32.npy"), S.arr("b_cnt.u8.npy"), S.arr("dtm2.f32.npy")
    blobs = []
    for r0 in range(0, S.NR, BLOCK):
        for c0 in range(0, S.NC, BLOCK):
            a0, a1 = max(0, r0 - OVER), min(S.NR, r0 + BLOCK + OVER)
            b0, b1 = max(0, c0 - OVER), min(S.NC, c0 + BLOCK + OVER)
            z = np.asarray(zb[a0:a1, b0:b1])
            hag = z - S.ground(a0, a1, b0, b1)
            with np.errstate(invalid="ignore"):
                mask = np.isfinite(z) & (hag > 2.0) & (np.asarray(bc[a0:a1, b0:b1]) >= 2)
            if not mask.any():
                continue
            bx = shapely.box(S.X0 + b0 * S.RES, S.YT - a1 * S.RES, S.X0 + b1 * S.RES, S.YT - a0 * S.RES)
            K = raster_polys([known[j] for j in tree.query(bx)], a0, a1, b0, b1)
            K = ndi.binary_dilation(K, np.ones((3, 3)), iterations=3)        # 1.5 m: eaves overhang an outline
            lab, nl = ndi.label(ndi.binary_opening(mask & ~K, np.ones((3, 3)), iterations=2))
            for k, s in enumerate(ndi.find_objects(lab), 1):
                rr, cc = np.nonzero(lab[s] == k)
                rr, cc = rr + s[0].start + a0, cc + s[1].start + b0
                cr, ccn = rr.mean(), cc.mean()
                if not (r0 <= cr < r0 + BLOCK and c0 <= ccn < c0 + BLOCK):   # owned by the block its centre is in
                    continue
                area = rr.size * S.RES * S.RES
                h = hag[rr - a0, cc - b0]
                if area < BLOB_MIN_M2 or np.median(h) < BLOB_MIN_H:
                    continue
                xs, ys = S.X0 + (cc + 0.5) * S.RES, S.YT - (rr + 0.5) * S.RES
                rects, iou = decompose_cells(xs, ys, area)
                if not rects or min(rects[0][2], rects[0][3]) * 2 < BLOB_MIN_SIDE:
                    continue
                lon, lat = (float(q) for q in to_ll(xs.mean(), ys.mean()))
                if not in_box(lon, lat, OUTER) or excluded(lon, lat):
                    continue
                blobs.append(dict(id="scan:%d_%d" % (int(cr), int(ccn)), lon=lon, lat=lat, area=float(area), rects=rects, iou=iou,
                                  poly=MultiPoint(np.column_stack([xs, ys])).buffer(0.36, cap_style="square").buffer(0), ring=None))
    rep = dict(footprint_verdicts=dict(cnt), scan_only_buildings=len(blobs), scan_only_m2=round(float(sum(b["area"] for b in blobs))))
    log("c", rep, time.time() - t0)
    pickle.dump(dict(verdict=verdict, blobs=blobs), open(cache("c"), "wb"))
    return rep


# ══════════════════════════════════════════════════════════════════════
#  d. colour, and the file
# ══════════════════════════════════════════════════════════════════════
def h01(key):
    return int(hashlib.md5(key.encode()).hexdigest()[:8], 16) / 0xFFFFFFFF


def pick(mix, r):
    acc, tot = 0.0, sum(mix.values())
    for k, w in mix.items():
        acc += w / tot
        if r < acc:
            return k
    return list(mix)[0]


def roof_colour(o, img):
    """Per rectangle: the mean of the sunlit half of the roof's own pixels, where the scan says roof with no canopy above."""
    import shapely
    S = scan()
    P = o["poly"]
    x0, y0, x1, y1 = P.bounds
    r0, r1, c0, c1 = S.window(x0, y0, x1, y1, pad=0.5)
    if r1 - r0 < 2 or c1 - c0 < 2:
        return [None] * len(o["rects"])
    X, Y = S.centres(r0, r1, c0, c1)
    inside = shapely.contains_xy(P.buffer(-0.6) if P.area > 30 else P, X, Y)
    zb = np.asarray(S.arr("zb_max.f32.npy")[r0:r1, c0:c1])
    zf = np.asarray(S.arr("zf_max.f32.npy")[r0:r1, c0:c1])
    with np.errstate(invalid="ignore"):
        clear = np.isfinite(zb) & ~(zf - zb > 1.0)
    px = np.asarray(img[r0:r1, c0:c1]).astype(np.float32)
    out = []
    for (cx, cy, L, W, th) in o["rects"]:
        ct, st = math.cos(th), math.sin(th)
        dx, dy = X - cx, Y - cy
        m = inside & clear & (np.abs(dx * ct + dy * st) <= L) & (np.abs(-dx * st + dy * ct) <= W)
        if m.sum() < 8:
            m = inside & clear
        if m.sum() < 8:
            out.append(None)
            continue
        p = px[m]
        lum = p @ np.array([.299, .587, .114], np.float32)
        out.append(tuple(p[lum >= np.median(lum)].mean(axis=0)))
    return out


def stage_d(log):
    import shapely
    from scipy.cluster.vq import kmeans2
    from shapely.geometry import shape
    t0 = time.time()
    S = scan()
    A = pickle.load(open(cache("a"), "rb"))
    B = pickle.load(open(cache("b"), "rb"))
    C = pickle.load(open(cache("c"), "rb"))
    img = np.load(os.path.join(WORK, "img", "aerial2025.u8.npy"), mmap_mode="r")
    cnt, builds = collections.Counter(), []
    for i, o in [(i, o) for i, o in enumerate(A)] + [(None, b) for b in C["blobs"]]:
        v = C["verdict"][i] if i is not None else "scan"
        if v in ("gone", "moved", "hidden_dropped"):
            cnt["dropped_" + v] += 1
            continue
        r = B.get(i) if i is not None else measure(o)
        fits = (r or {}).get("fits") or [None] * len(o["rects"])
        cols = roof_colour(o, img) if (r and not r.get("nolidar")) else [None] * len(o["rects"])
        # Heights for a rectangle the scan could not fit are INFERRED: from the building's own fitted rectangles
        # first, then its scan height, then its footprint source's height, then its size.
        got = [f for f in fits if f]
        if got:
            base_e = float(np.median([f["eave"] for f in got]))
        elif r and r.get("h_p50"):
            base_e = r["h_p50"] * 0.85
        elif o.get("ov_h"):
            base_e = max(2.6, 0.72 * float(o["ov_h"]))
        else:
            base_e = 3.2 if o["area"] > 45 else 2.5
        mine = []
        for k, (rect, f, col) in enumerate(zip(o["rects"], fits, cols)):
            cx, cy, L, W, th = rect
            if f:
                kind, eave, rise, src = f["kind"], f["eave"], f["rise"], "scan"
            else:
                pitched = 45 <= o["area"] <= 450
                kind, eave, rise, src = (1 if pitched else 0), base_e, (min(0.42 * W, 2.4) if pitched else 0.0), "inferred"
            mine.append(dict(cx=cx, cy=cy, L=L, W=W, th=th, kind=kind, eave=float(np.clip(eave, 2.2, 255 * STEP_H)),
                             rise=float(np.clip(rise, 0, 7.0)), col=col, src=src, first=(k == 0)))
            cnt["rect_" + src] += 1
        area = area_of(o["lon"], o["lat"])
        stock = STOCK.get(area, "bungalow")
        big_flat = mine[0]["kind"] == 0 and (o["area"] >= 350 or mine[0]["eave"] >= 6.5)
        wall = pick(MIX["other" if (big_flat or stock == "other") else stock], h01("%.6f,%.6f" % (o["lon"], o["lat"])))
        anyc = [m["col"] for m in mine if m["col"] is not None]
        for m in mine:
            if m["col"] is None and anyc:
                m["col"] = anyc[0]
            m["wall"] = wall
        builds.append(dict(o=o, rects=mine, area=area, verdict=v))
        cnt["buildings"] += 1
        cnt["from_" + v] += 1
    # roof palette
    allc = np.array([m["col"] for b in builds for m in b["rects"] if m["col"] is not None], np.float32)
    cent, _ = kmeans2(allc, N_ROOF, minit="++", iter=25, seed=7)
    cent = np.clip(np.round(cent), 0, 255).astype(np.uint8)
    centf = cent.astype(np.float32)
    dmin = np.sqrt(((allc[:, None, :] - centf[None]) ** 2).sum(-1)).min(1)
    default_idx = int(np.sqrt(((centf - np.array(DEFAULT_ROOF, np.float32)) ** 2).sum(1)).argmin())
    # order: along a Z curve, so neighbours in the file are neighbours on the ground and the differences are small
    for b in builds:
        lon, lat = to_ll(b["rects"][0]["cx"], b["rects"][0]["cy"])
        bx = int(round((float(lon) - LON0) * M_LON / STEP_XY))
        by = int(round((float(lat) - LAT0) * M_LAT / STEP_XY))
        key = 0
        for bit in range(16):
            key |= ((bx >> bit) & 1) << (2 * bit) | ((by >> bit) & 1) << (2 * bit + 1)
        b["z"] = key
    builds.sort(key=lambda b: b["z"])
    recs = []
    for b in builds:
        for m in b["rects"]:
            # The scan's grid is rotated from true north: turn the axis back into longitude and latitude.
            lon, lat = (float(q) for q in to_ll(m["cx"], m["cy"]))
            ex, ey = (float(q) for q in to_ll(m["cx"] + 10 * math.cos(m["th"]), m["cy"] + 10 * math.sin(m["th"])))
            ang = math.atan2((ey - lat) * M_LAT, (ex - lon) * M_LON) % math.pi
            ri = default_idx if m["col"] is None else int(np.sqrt(((centf - np.array(m["col"], np.float32)) ** 2).sum(1)).argmin())
            m["roof_idx"] = ri
            recs.append((min(65535, max(0, int(round((lon - LON0) * M_LON / STEP_XY)))),
                         min(65535, max(0, int(round((lat - LAT0) * M_LAT / STEP_XY)))),
                         min(255, max(1, int(round(m["L"] / STEP_SIZE)))), min(255, max(1, int(round(m["W"] / STEP_SIZE)))),
                         int(round(ang / math.pi * 256)) % 256, min(255, int(round(m["eave"] / STEP_H))),
                         min(255, int(round(m["rise"] / STEP_H))), (m["kind"] & 3) | (4 if m["first"] else 0), m["wall"], ri))
    R = np.array(recs, np.int64)
    n = len(R)
    x, y, ang = R[:, 0].astype(np.uint16), R[:, 1].astype(np.uint16), R[:, 4].astype(np.uint8)
    dx = np.diff(x, prepend=np.uint16(0)).astype(np.uint16)
    dy = np.diff(y, prepend=np.uint16(0)).astype(np.uint16)
    da = np.diff(ang, prepend=np.uint8(0)).astype(np.uint8)
    dx[0], dy[0], da[0] = x[0], y[0], ang[0]
    first = (R[:, 7] & 4) > 0

    def inner(col):          # a wing repeats its building's value: the difference from the row before, except on a first row
        c = R[:, col].astype(np.uint8)
        return np.where(first, c, np.diff(c, prepend=np.uint8(0)).astype(np.uint8)).astype(np.uint8)
    wall_pal = bytes(int(h[i:i + 2], 16) for h in WALLS for i in (1, 3, 5))
    head = b"OHM1" + struct.pack("<IddfffHH", n, LON0, LAT0, STEP_XY, STEP_SIZE, STEP_H, len(WALLS), N_ROOF)
    cols = [(dx & 255).astype(np.uint8), (dx >> 8).astype(np.uint8), (dy & 255).astype(np.uint8), (dy >> 8).astype(np.uint8),
            R[:, 2].astype(np.uint8), R[:, 3].astype(np.uint8), da, inner(5), R[:, 6].astype(np.uint8), R[:, 7].astype(np.uint8),
            inner(8), inner(9)]
    body = head + wall_pal + cent.tobytes() + b"".join(c.tobytes() for c in cols)
    gz = gzip.compress(body, 9, mtime=0)
    with open(OUT, "wb") as f:
        f.write(gz)
    pickle.dump(dict(builds=builds, roof_pal=["#%02x%02x%02x" % tuple(int(v) for v in c) for c in cent]), open(cache("d"), "wb"))
    # ── the ring: which prisms this layer took, and scan heights for the ones that stay ──
    ring = json.load(open(RING, encoding="utf-8"))["features"]
    drop, taken = [], set()
    for o in A:
        if o.get("ring"):
            pt = o["poly"].representative_point()
            lon, lat = to_ll(pt.x, pt.y)
            drop.append([round(float(lon), 6), round(float(lat), 6), round(o["area"], 1)])
            taken.update(o["ring"])
    heights, stay = [], 0
    for k, f in enumerate(ring):
        p = f["properties"]
        if "k" in p or p.get("t") in (1, 2) or k in taken:
            continue
        g = shape(f["geometry"])
        c = g.centroid
        if in_box(c.x, c.y, DOWNTOWN) or excluded(c.x, c.y):
            continue
        P = geom_m(g.buffer(0))
        if P.geom_type != "Polygon":
            continue
        r = measure(dict(poly=P, rects=[]))
        if not r or r.get("nolidar") or r["cover"] < 0.6 or "h_p90" not in r:
            continue
        stay += 1
        # RAISES ONLY, the owner's choice for the core (docs/lidar-heights.md): the prism's height is the roof's
        # highest point from an older survey, the scan's 90th percentile sits under it by design, and a lower
        # number is not a fix.
        if r["h_p90"] - p["h"] >= RING_RAISE_MIN:
            pt = P.representative_point()
            lon, lat = to_ll(pt.x, pt.y)
            heights.append([round(float(lon), 6), round(float(lat), 6), round(r["h_p90"], 1)])
    # THE LIST ONLY GROWS. Once `bake_outer.py --homes-split` has run, the prisms listed here are gone from the
    # ring, so this stage no longer finds them to list, and a ring rebuilt from its raw extract would then draw
    # them again inside the houses. So the entries already on disk are kept. A kept entry can do no harm: it only
    # ever removes a ring prism that stands on a building this layer was given.
    if os.path.exists(SPLIT):
        old = json.load(open(SPLIT, encoding="utf-8"))
        have = {(e[0], e[1]) for e in drop}
        drop += [e for e in old.get("drop", []) if (e[0], e[1]) not in have]
        have = {(e[0], e[1]) for e in heights}
        heights += [e for e in old.get("heights", []) if (e[0], e[1]) not in have]
    drop.sort()
    heights.sort()
    with open(SPLIT, "w", encoding="utf-8") as f:
        json.dump({"note": "written by scripts/bake_outer_homes.py; read by scripts/bake_outer.py apply_homes_split()",
                   "drop": drop, "heights": heights}, f, separators=(",", ":"))
    rep = dict(counts=dict(cnt), buildings=len(builds), rectangles=n, raw_bytes=len(body), gzip_bytes=len(gz),
               bytes_per_building=round(len(gz) / len(builds), 2),
               roof_colours_measured=int(len(allc)), roof_palette=N_ROOF, roof_quantisation_rgb_rms=round(float(np.sqrt((dmin ** 2).mean())), 1),
               ring_prisms_taken=len(drop), ring_prisms_that_stay_and_the_scan_covers=stay, ring_prisms_raised=len(heights))
    log("d", rep, time.time() - t0)
    return rep


def main():
    global WORK
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--work")
    ap.add_argument("--from", dest="start", default="a", choices=list("abcd"))
    ap.add_argument("--jobs", type=int, default=3)
    a = ap.parse_args()
    WORK = work_dir(a.work)
    report = json.load(open(REPORT)) if os.path.exists(REPORT) else {}

    def log(stage, rep, secs):
        report[stage] = rep
        print("stage %s, %.0f s: %s" % (stage, secs, json.dumps(rep)), flush=True)
    for st in "abcd"[ "abcd".index(a.start):]:
        if st == "a":
            stage_a(log)
        elif st == "b":
            stage_b(log, a.jobs)
        elif st == "c":
            stage_c(log)
        else:
            stage_d(log)
    report["sources"] = {
        "footprints": "Overture Maps buildings (OpenStreetMap contributors, ODbL; Microsoft ML Buildings, CDLA-Permissive-2.0)",
        "heights_roofs_presence": "StratMap Bexar & Travis Counties Lidar 2021, TxGIO, CC0-1.0",
        "roof_colour": "City of Austin 2025 aerial (one colour per building is read; no pixel is shipped)",
        "wall_colour": "INFERRED per area; not measured",
    }
    with open(REPORT, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=1, sort_keys=True)
    print("wrote", OUT, os.path.getsize(OUT), "bytes;", SPLIT, ";", REPORT)


if __name__ == "__main__":
    main()
