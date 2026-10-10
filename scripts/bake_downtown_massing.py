#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""bake_downtown_massing.py -- every downtown building's shape, measured.

    data/osm_cache/downtown_buildings.json     (outlines + tags, OpenStreetMap)
    data/outer/downtown_city_structures.json   (outlines + heights, City of Austin 2023)
    data/outer/downtown_districts.json         (what "downtown" is)
    <raster dir>                               (the 2021 laser scan, 0.5 m cells; private)
        ->  data/outer/downtown_massing.json   (this script's ONE output)

WHY. Before this, a downtown building that nobody had modelled by hand was a
guess: one outline, one height from a second-hand table, a podium "of 2 to 5
floors by tower height" and a shaft "set back 15 % of the plan width". The
2021 airborne laser scan (Bexar and Travis Counties Lidar, TxGIO, CC0 1.0,
about 12 points per square metre) saw the real thing: where the podium ends,
how far the tower stands back and on which side, the penthouse, the low wing.
This script reads that for every building and writes it down as a short list
of LEVELS: "the whole outline rises to 21.5 m; this smaller outline goes on to
88 m; this one to 93 m". scripts/downtown_bodies.py turns the levels into the
extrusions the app draws.

WHAT A LEVEL IS. Level 0 is the building's own outline (from the map, so the
walls sit on the street line) and its top is the lowest roof the scan found.
Level k > 0 is the part of the plan that rises higher: the cells of the scan
at or above that level's floor, cleaned, traced, and cut to the outline. Levels
nest, so the app stacks them: each one stands on the one below. A wall that
reaches the outline's edge is cut by the outline itself, so a tower's street
wall is flush with its podium's where the scan says it is.

WHAT IS NOT MEASURED. The scan was flown January to March 2021. A building
finished later reads as a hole, a crane or half a tower. Such a building gets
`st: "none"` or `"late"` and no levels; its height then comes from the public
tables (see `claim`). Nothing is invented here.

The raster comes from scripts/lidar_raster.py and stays outside the repo
(about 3 GB of tiles in, 0.2 GB of raster out). Give its folder with --raster
or LIDAR_RASTER_DIR.

    Usage:  python scripts/bake_downtown_massing.py --raster <dir> [--only ID,ID] [--debug DIR]
"""
import argparse
import json
import math
import os
import sys

import numpy as np
import shapely
from shapely import affinity
from shapely.geometry import Polygon, box, shape
from shapely.ops import unary_union
from shapely.strtree import STRtree

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OSM = os.path.join(ROOT, "data", "osm_cache", "downtown_buildings.json")
CITY = os.path.join(ROOT, "data", "outer", "downtown_city_structures.json")
DISTRICTS = os.path.join(ROOT, "data", "outer", "downtown_districts.json")
OUT = os.path.join(ROOT, "data", "outer", "downtown_massing.json")

FT = 1200.0 / 3937.0          # one US survey foot in metres (the scan's unit)
RASTER_CRS = "EPSG:6578"

# ── every number below is a dial; each is a length or a share you can check ──
M = {
    # which outlines become buildings
    "min_area_m2": 12.0,          # smaller is a kiosk, a bin store, a mapping slip
    "city_only_min_area_m2": 40.0,  # a City outline with no OSM building under it
    "city_only_max_overlap": 0.30,  # ...counts as its own building below this overlap
    "contained_share": 0.85,      # an outline this far inside a bigger one is a duplicate
    "overlap_min_m2": 5.0,        # two outlines sharing more than this: the smaller owns the shared part

    # reading the scan
    "cell_m": 1.0,                # the working grid, turned to the building's own axes
    "roof_min_m": 2.5,            # below this a return is a car, a wall, a planter
    "cover_scan": 0.50,           # share of the outline the scan must see as building
    "cover_partial": 0.20,
    "edge_cells": 2,              # the rim takes the height of the roof just inside it
    "fill_depth_cells": 2,        # glass roofs: first returns are used this deep inside only

    # cutting the roof into levels
    "single_below_m": 7.0,        # a building this low is one box
    "single_below_area_m2": 110.0,
    "gap_min_m": 2.5,             # two roofs closer than this are one roof
    "gap_frac": 0.06,             # ...or closer than this share of their height
    "level_min_area_m2": 16.0,    # a level smaller than this is plant, not massing
    "level_min_share": 0.02,      # ...or smaller than this share of the outline
    "max_levels": 6,
    "open_cells": 1,              # 3 x 3 opening: nothing narrower than 3 m survives
    "hole_min_m2": 60.0,          # a courtyard smaller than this is filled
    "simplify_m": 0.8,            # stair-steps of the grid become straight walls

    # a building the scan cannot speak for
    "late_margin_m": 8.0,         # a tagged height this far above the scan = built since
    "late_city_margin_m": 15.0,   # the same for a City height from 2021+ imagery
    "city_inside_share": 0.6,     # a City piece this far inside the outline belongs to it
}


def dominant_angle(poly):
    """The direction most of the outline's wall length runs in, mod 90 degrees."""
    xs, ys = poly.exterior.coords.xy
    acc = {}
    for i in range(len(xs) - 1):
        dx, dy = xs[i + 1] - xs[i], ys[i + 1] - ys[i]
        ln = math.hypot(dx, dy)
        if ln < 0.5:
            continue
        a = math.degrees(math.atan2(dy, dx)) % 90.0
        k = int(round(a)) % 90
        acc[k] = acc.get(k, 0.0) + ln
    if not acc:
        return 0.0
    # smooth over +-2 degrees so 14.6 and 15.4 vote together
    best, best_k = -1.0, 0
    for k in acc:
        s = sum(acc.get((k + d) % 90, 0.0) * w for d, w in
                ((-2, 0.4), (-1, 0.8), (0, 1.0), (1, 0.8), (2, 0.4)))
        if s > best:
            best, best_k = s, k
    num = den = 0.0
    for d in (-2, -1, 0, 1, 2):
        w = acc.get((best_k + d) % 90, 0.0)
        num += w * (best_k + d)
        den += w
    return num / den if den else float(best_k)


def nanmedian3(a):
    """3 x 3 median that ignores holes; a hole stays a hole."""
    p = np.pad(a, 1, constant_values=np.nan)
    st = np.stack([p[i:i + a.shape[0], j:j + a.shape[1]]
                   for i in range(3) for j in range(3)])
    with np.errstate(all="ignore"):
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            med = np.nanmedian(st, axis=0)
    med[~np.isfinite(a)] = np.nan
    return med


class Scan:
    def __init__(self, folder):
        from pyproj import Transformer
        self.g = json.load(open(os.path.join(folder, "grid.json")))
        self.res = self.g["res_m"]
        self.bldg = np.load(os.path.join(folder, "hag_bldg.f16.npy"), mmap_mode="r")
        self.first = np.load(os.path.join(folder, "hag_first.f16.npy"), mmap_mode="r")
        self.fwd = Transformer.from_crs("EPSG:4326", RASTER_CRS, always_xy=True)
        self.inv = Transformer.from_crs(RASTER_CRS, "EPSG:4326", always_xy=True)

    def to_m(self, ring):
        a = np.asarray(ring, float)
        x, y = self.fwd.transform(a[:, 0], a[:, 1])
        return np.column_stack([np.asarray(x) * FT, np.asarray(y) * FT])

    def to_lonlat(self, xy):
        a = np.asarray(xy, float)
        lon, lat = self.inv.transform(a[:, 0] / FT, a[:, 1] / FT)
        return [[round(float(u), 6), round(float(v), 6)] for u, v in zip(lon, lat)]

    def window(self, minx, miny, maxx, maxy):
        g, r = self.g, self.res
        c0 = max(0, int((minx - g["x0_m"]) / r))
        c1 = min(g["ncols"], int(math.ceil((maxx - g["x0_m"]) / r)))
        r0 = max(0, int((g["y_top_m"] - maxy) / r))
        r1 = min(g["nrows"], int(math.ceil((g["y_top_m"] - miny) / r)))
        if c1 <= c0 or r1 <= r0:
            return None
        b = np.asarray(self.bldg[r0:r1, c0:c1], np.float32)
        f = np.asarray(self.first[r0:r1, c0:c1], np.float32)
        xs = g["x0_m"] + (np.arange(c0, c1) + 0.5) * r
        ys = g["y_top_m"] - (np.arange(r0, r1) + 0.5) * r
        X, Y = np.meshgrid(xs, ys)
        return X, Y, b, f


def poly_m(scan, rings):
    ext = scan.to_m(rings[0])
    holes = [scan.to_m(h) for h in rings[1:]]
    p = Polygon(ext, holes).buffer(0)
    if p.geom_type == "MultiPolygon":
        p = max(p.geoms, key=lambda q: q.area)
    return p


def binary(op, a, n):
    from scipy import ndimage as ndi
    st = np.ones((2 * n + 1, 2 * n + 1), bool)
    return getattr(ndi, op)(a, structure=st)


def trace(mask):
    """Cells -> polygon(s) in grid units, by joining the runs of each row."""
    boxes = []
    for i in range(mask.shape[0]):
        row = mask[i]
        if not row.any():
            continue
        d = np.diff(np.concatenate([[0], row.astype(np.int8), [0]]))
        for s, e in zip(np.flatnonzero(d == 1), np.flatnonzero(d == -1)):
            boxes.append(box(s, i, e, i + 1))
    return unary_union(boxes) if boxes else None


def analyse(scan, P, exclude=None, debug=None):
    """One outline (raster metres) against the scan. Returns the stats and levels.

    `exclude` is the union of the SMALLER outlines that overlap this one (a
    tower mapped inside its own podium, a shop inside a block). Their cells
    belong to them: this outline's upper levels are cut from the rest, so no
    part of the scan is drawn twice.
    """
    from scipy import ndimage as ndi
    cell = M["cell_m"]
    area = P.area
    theta = dominant_angle(P)
    c = P.centroid
    Pl = affinity.rotate(P, -theta, origin=(c.x, c.y))        # building-aligned
    minx, miny, maxx, maxy = Pl.bounds
    pad = 3 * cell
    u0, v0 = minx - pad, miny - pad
    nu = int(math.ceil((maxx - minx + 2 * pad) / cell))
    nv = int(math.ceil((maxy - miny + 2 * pad) / cell))
    wb = P.buffer(pad + 1).bounds
    win = scan.window(*wb)
    out = {"cov": 0.0}
    if win is None or nu * nv > 4_000_000:
        return out, []
    X, Y, hb, hf = win
    ct, st_ = math.cos(math.radians(-theta)), math.sin(math.radians(-theta))
    dx, dy = X - c.x, Y - c.y
    U = c.x + dx * ct - dy * st_
    V = c.y + dx * st_ + dy * ct
    iu = np.floor((U - u0) / cell).astype(np.int64)
    iv = np.floor((V - v0) / cell).astype(np.int64)
    ok = (iu >= 0) & (iu < nu) & (iv >= 0) & (iv < nv)
    flat = (iv * nu + iu)[ok]

    def pool(src):
        g = np.full(nu * nv, -np.inf, np.float32)
        vals = src[ok]
        fin = np.isfinite(vals)
        np.maximum.at(g, flat[fin], vals[fin])
        g[np.isneginf(g)] = np.nan
        return g.reshape(nv, nu)

    Hb, Hf = pool(hb), pool(hf)
    uu = u0 + (np.arange(nu) + 0.5) * cell
    vv = v0 + (np.arange(nv) + 0.5) * cell
    GU, GV = np.meshgrid(uu, vv)
    inside = shapely.contains_xy(Pl, GU, GV)
    n_in = int(inside.sum())
    if n_in < 4:
        return out, []
    mine = inside
    if exclude is not None and not exclude.is_empty:
        El = affinity.rotate(exclude, -theta, origin=(c.x, c.y))
        mine = inside & ~shapely.contains_xy(El, GU, GV)
        if mine.sum() < 4:
            mine = inside

    roof = np.isfinite(Hb) & (Hb >= M["roof_min_m"])
    cov = float((roof & inside).sum()) / n_in
    out["cov"] = round(cov, 2)
    if cov < M["cover_partial"]:
        # what the scan DID see here, for the record: all first returns
        vals = Hf[inside & np.isfinite(Hf)]
        if vals.size:
            out["first_p90"] = round(float(np.percentile(vals, 90)), 1)
        return out, []

    H = np.where(roof, Hb, np.nan)
    # glass and unclassified roofs: use the first return, but only well inside
    # the outline, where it cannot be a street tree leaning over the wall
    deep = binary("binary_erosion", inside, M["fill_depth_cells"])
    glass = deep & ~np.isfinite(H) & np.isfinite(Hf) & (Hf >= M["roof_min_m"])
    H[glass] = Hf[glass]
    H = nanmedian3(H)
    # holes inside the outline take the nearest roof
    have = np.isfinite(H)
    if have.any():
        _, (ir, ic) = ndi.distance_transform_edt(~have, return_indices=True)
        Hfill = H[ir, ic]
    else:
        return out, []
    Hin = np.where(inside, np.where(have, H, Hfill), np.nan)
    # the rim reads low or mixed (the beam sees wall and street); it takes the
    # height of the roof just inside it
    core = binary("binary_erosion", inside, M["edge_cells"])
    if core.sum() >= 9:
        _, (ir, ic) = ndi.distance_transform_edt(~core, return_indices=True)
        rim = inside & ~core
        Hin[rim] = Hin[ir, ic][rim]

    vals = Hin[mine]
    vals = vals[np.isfinite(vals)]
    out.update(p50=round(float(np.percentile(vals, 50)), 1),
               p90=round(float(np.percentile(vals, 90)), 1),
               max=round(float(np.nanmax(Hb[mine & roof])), 1)
               if (mine & roof).any() else round(float(vals.max()), 1))
    if cov < M["cover_scan"]:
        return out, []

    a_min = max(M["level_min_area_m2"], M["level_min_share"] * area)
    single = (out["p90"] < M["single_below_m"]
              or area < M["single_below_area_m2"])
    if single:
        return out, [[round(float(np.percentile(vals, 60)), 1), None]]

    # ── the roofs as clusters of height ───────────────────────────────
    bins = np.floor(vals / 0.5).astype(int)
    cl = []                                    # [lo_bin, hi_bin, cells]
    for b in np.unique(bins):
        cl.append([int(b), int(b), int((bins == b).sum())])

    def height_of(k):
        sel = vals[(bins >= k[0]) & (bins <= k[1])]
        return float(np.median(sel))

    while len(cl) > 1:
        hs = [height_of(k) for k in cl]
        gaps = [hs[i + 1] - hs[i] for i in range(len(cl) - 1)]
        i = int(np.argmin(gaps))
        need = max(M["gap_min_m"], M["gap_frac"] * 0.5 * (hs[i] + hs[i + 1]))
        if gaps[i] >= need:
            break
        cl[i] = [cl[i][0], cl[i + 1][1], cl[i][2] + cl[i + 1][2]]
        del cl[i + 1]
    # small clusters join their nearest neighbour in height
    while len(cl) > 1:
        sm = [i for i, k in enumerate(cl) if k[2] * cell * cell < a_min]
        if not sm:
            break
        i = min(sm, key=lambda j: cl[j][2])
        hs = [height_of(k) for k in cl]
        if i == 0:
            j = 1
        elif i == len(cl) - 1:
            j = i - 1
        else:
            j = i - 1 if hs[i] - hs[i - 1] <= hs[i + 1] - hs[i] else i + 1
        a, b = min(i, j), max(i, j)
        cl[a] = [cl[a][0], cl[b][1], cl[a][2] + cl[b][2]]
        del cl[b]
    while len(cl) > M["max_levels"]:
        hs = [height_of(k) for k in cl]
        cost = [(hs[i + 1] - hs[i]) * min(cl[i][2], cl[i + 1][2])
                for i in range(len(cl) - 1)]
        i = int(np.argmin(cost))
        cl[i] = [cl[i][0], cl[i + 1][1], cl[i][2] + cl[i + 1][2]]
        del cl[i + 1]

    # ── each level's plan: the cells at or above its floor ────────────
    regions = [inside.copy()]
    for k in cl[1:]:
        r = mine & (Hin >= k[0] * 0.5)
        r = binary("binary_opening", r, M["open_cells"])
        r = binary("binary_closing", r, M["open_cells"]) & mine
        lab, n = ndi.label(r)
        if n:
            sizes = ndi.sum(r, lab, range(1, n + 1))
            for li, s in enumerate(sizes, 1):
                if s * cell * cell < a_min:
                    r[lab == li] = False
        r &= regions[-1]
        regions.append(r)
    # drop a level whose own roof (its plan minus the next level's) is too small
    keep = [0]
    for i in range(1, len(regions)):
        nxt = regions[i + 1] if i + 1 < len(regions) else np.zeros_like(inside)
        own = regions[i] & ~nxt
        if own.sum() * cell * cell >= a_min and regions[i].sum() < regions[keep[-1]].sum():
            keep.append(i)
    regions = [regions[i] for i in keep]

    levels = []
    for i, r in enumerate(regions):
        nxt = regions[i + 1] if i + 1 < len(regions) else np.zeros_like(inside)
        own = r & ~nxt & mine
        hv = Hin[own]
        hv = hv[np.isfinite(hv)]
        if hv.size == 0:
            continue
        top = round(float(np.median(hv)), 1)
        if i == 0:
            levels.append([top, None])
            continue
        # let the plan run past the outline where it touches it; the outline
        # itself then cuts it, so the wall is flush with the wall below
        grow = binary("binary_dilation", r, 2) & ~inside
        g = trace(r | grow)
        if g is None:
            continue
        g = g.simplify(M["simplify_m"] / cell)
        g = affinity.scale(g, cell, cell, origin=(0, 0))
        g = affinity.translate(g, u0, v0)
        g = affinity.rotate(g, theta, origin=(c.x, c.y)).intersection(P).buffer(0)
        parts = [g] if g.geom_type == "Polygon" else [
            q for q in getattr(g, "geoms", []) if q.geom_type == "Polygon"]
        rings = []
        for q in parts:
            if q.area < a_min:
                continue
            holes = [h for h in q.interiors if Polygon(h).area >= M["hole_min_m2"]]
            rings.append([list(q.exterior.coords)] + [list(h.coords) for h in holes])
        if rings and top > levels[-1][0] + 0.5:
            levels.append([top, rings])
    if debug is not None:
        debug.update(Hin=Hin, inside=inside, regions=regions, theta=theta)
    return out, levels


def load_units(scan):
    osm = json.load(open(OSM, encoding="utf-8"))
    city = json.load(open(CITY, encoding="utf-8"))
    dist = json.load(open(DISTRICTS, encoding="utf-8"))
    downtown = unary_union([shape(r["g"]) for r in dist["rows"]])
    dt_m = [poly_m(scan, [list(q.exterior.coords)]) for q in
            (downtown.geoms if downtown.geom_type == "MultiPolygon" else [downtown])]
    dt_m = unary_union(dt_m)

    units = []
    for r in osm["rows"]:
        t = r["t"]
        if "building" not in t or t.get("location") == "underground":
            continue
        p = poly_m(scan, r["g"])
        if p.is_empty or p.area < M["min_area_m2"]:
            continue
        units.append({"id": r["id"], "t": t, "g": r["g"], "P": p, "src": "osm"})
    # an outline that sits inside a bigger one is the same building drawn twice
    tree = STRtree([u["P"] for u in units])
    drop = set()
    for i, u in enumerate(units):
        for j in tree.query(u["P"]):
            j = int(j)
            if j == i or j in drop:
                continue
            v = units[j]
            if v["P"].area > u["P"].area and \
                    u["P"].intersection(v["P"]).area > M["contained_share"] * u["P"].area:
                drop.add(i)
                break
    units = [u for i, u in enumerate(units) if i not in drop]

    tree = STRtree([u["P"] for u in units])
    city_m = []
    for r in city["rows"]:
        p = poly_m(scan, r["g"])
        if not p.is_empty:
            city_m.append((r, p))
    n_city = 0
    for r, p in city_m:
        if p.area < M["city_only_min_area_m2"]:
            continue
        hit = sum(p.intersection(units[int(j)]["P"]).area for j in tree.query(p))
        if hit <= M["city_only_max_overlap"] * p.area:
            units.append({"id": "c%d" % r["o"], "t": {}, "g": r["g"], "P": p,
                          "src": "city"})
            n_city += 1
    for u in units:
        u["dt"] = bool(dt_m.contains(u["P"].representative_point()))
    print("  %d outlines (%d from the City only), %d inside downtown"
          % (len(units), n_city, sum(u["dt"] for u in units)))
    return units, city_m


def num(v):
    try:
        return float(str(v).split()[0].replace("m", "").replace("'", ""))
    except (TypeError, ValueError, IndexError):
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raster", default=os.environ.get("LIDAR_RASTER_DIR"))
    ap.add_argument("--only")
    args = ap.parse_args()
    if not args.raster:
        sys.exit("give the scan raster folder: --raster <dir> or LIDAR_RASTER_DIR")
    scan = Scan(args.raster)
    units, city_m = load_units(scan)
    city_tree = STRtree([p for _, p in city_m])
    unit_tree = STRtree([u["P"] for u in units])
    only = set(args.only.split(",")) if args.only else None

    rows = []
    n = {"scan": 0, "partial": 0, "none": 0, "late": 0, "levels": 0}
    for u in sorted(units, key=lambda u: u["id"]):
        if only and u["id"] not in only:
            continue
        P, t = u["P"], u["t"]
        inner = [v["P"] for v in (units[int(j)] for j in unit_tree.query(P))
                 if v is not u and v["P"].area < P.area
                 and v["P"].intersection(P).area > M["overlap_min_m2"]]
        stats, levels = analyse(scan, P, unary_union(inner) if inner else None)
        # the City's own height for the same building: the tallest structure
        # outline that lies mostly inside this one
        city_h, city_src = None, None
        for j in city_tree.query(P):
            r, p = city_m[int(j)]
            # the City's piece must lie INSIDE this outline. "Mostly overlaps"
            # is not enough: a garage took the 104 m of the tower beside it.
            if r["h"] and p.intersection(P).area > M["city_inside_share"] * p.area:
                if city_h is None or r["h"] > city_h:
                    city_h, city_src = r["h"], r["s"]
        osm_h = num(t.get("height"))
        osm_lv = num(t.get("building:levels"))
        cov = stats.get("cov", 0.0)
        st = ("scan" if cov >= M["cover_scan"] else
              "partial" if cov >= M["cover_partial"] else "none")
        # Built (or still rising) after the flight: a tagged height well above
        # anything the scan saw, or a City height from imagery NEWER than the
        # scan that is far above it. A City height from older imagery that
        # disagrees with the scan loses to the scan, which is the later survey.
        try:
            city_new = city_h and int(str(city_src)[:4]) >= 2021
        except ValueError:
            city_new = False
        if st == "scan" and (
                (osm_h and osm_h > stats["max"] + M["late_margin_m"]) or
                (city_new and city_h > stats["max"] + M["late_city_margin_m"])):
            st = "late"
        if st != "scan":
            levels = []
        n[st] += 1
        n["levels"] += len(levels)
        row = {"id": u["id"], "src": u["src"], "dt": 1 if u["dt"] else 0,
               "a": round(P.area), "st": st, "cov": cov}
        for k in ("p50", "p90", "max", "first_p90"):
            if k in stats:
                row[k] = stats[k]
        if osm_h:
            row["osm_h"] = round(osm_h, 1)
        if osm_lv:
            row["osm_lv"] = osm_lv
        if city_h:
            row["city_h"], row["city_yr"] = city_h, city_src
        keep = {k: t[k] for k in ("name", "building", "amenity", "tourism", "shop",
                                  "office", "parking", "start_date", "roof:shape",
                                  "building:material", "building:colour",
                                  "historic", "religion", "wikidata") if k in t}
        if keep:
            row["t"] = keep
        row["g"] = [[[round(x, 6), round(y, 6)] for x, y in ring] for ring in u["g"]]
        if levels:
            row["lv"] = [[top, None if rings is None else
                          [[scan.to_lonlat(r) for r in poly] for poly in rings]]
                         for top, rings in levels]
        rows.append(row)

    if only:
        print(json.dumps(rows, indent=1)[:6000])
        return
    doc = {
        "note": "Measured massing of downtown Austin buildings. Written by "
                "scripts/bake_downtown_massing.py; read by scripts/downtown_bodies.py "
                "and scripts/verify/downtown-accuracy.py. Not fetched by the app.",
        "sources": {
            "scan": "Bexar & Travis Counties Lidar 2021 (TxGIO StratMap), flown "
                    "2021-01-26 to 2021-03-07, CC0 1.0",
            "outlines": "OpenStreetMap contributors (ODbL 1.0); City of Austin "
                        "impervious_cover_2023 structures (public domain) where "
                        "OpenStreetMap has no building",
        },
        "fields": {
            "st": "scan = levels measured; partial / none = the scan does not show "
                  "this building; late = a public height is far above the scan",
            "cov": "share of the outline the scan classed as building",
            "p50/p90/max": "roof height above ground inside the outline, metres",
            "lv": "[top_m, plans]; the first level is the outline itself (plans "
                  "null); each later level stands on the one before it",
            "osm_h / osm_lv / city_h / city_yr": "what the public tables claim",
        },
        "dials": M,
        "counts": n,
        "rows": rows,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(doc, f, separators=(",", ":"), ensure_ascii=False)
    print("  %s" % n)
    print("  wrote %s (%d KB)" % (OUT, os.path.getsize(OUT) // 1024))


if __name__ == "__main__":
    main()
