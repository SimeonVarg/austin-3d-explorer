#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""measure_outer.py - how accurate is the outer city? Numbers per area, before and after.

    python scripts/measure_outer.py --work DIR --before <ring.geojson before the houses>

Writes data/outer/outer_accuracy.json (the table docs/outer-homes.md prints) and
prints it. "Before" is the ring file as it was (pass a copy, or `git show
<rev>:data/outer_ring.geojson > before.geojson`); "after" is the ring on disk
plus the rectangles of the last bake_outer_homes.py run.

WHAT IS COMPARED WITH WHAT. Every row is the app's drawn buildings against a
source the app's data did NOT come from, except where the note says otherwise.

  present, missing   City of Austin Building Footprints 2023, 30 m2 and up. A
                     City building is PRESENT when at least half of its outline
                     is covered by what the app draws. Independent: the app's
                     outlines are Overture (OpenStreetMap) and the 2021 scan.
  extra              drawn pieces (ring prisms and house rectangles) with less
                     than 20 % of their area on any City 2023 outline.
  height             drawn top against the City's MAX_HEIGHT (feet, the roof's
                     highest point). NOT INDEPENDENT BEFORE: the ring's heights
                     were copied, through OpenStreetMap, from an earlier edition
                     of that same City number, so they agree with it by
                     construction (median 0.04 m). After, the houses' heights
                     come from the 2021 scan, so the comparison is a real one.
                     `all` counts a missing building as drawn 0 m tall.
  roof colour        the colour drawn on top against the mean of the sunlit
                     half of the roof's pixels in the City's 2025 aerial, as
                     CIE76 delta E. NOT INDEPENDENT AFTER: the houses' roof
                     colours were read from that aerial; what is left is the
                     64-colour palette and the outline difference.
  canopy             share of the ground under vegetation 3 m or taller in the
                     2021 scan, against the share under the app's tree crowns.
                     Measured only; this script changes no tree.
  roof kind          data/outer/outer_roof_labels.json: blind labels of three
                     samples of 160 buildings, made from the aerial and the
                     scan's height picture without seeing the fit.
"""
import argparse
import collections
import json
import math
import os
import pickle
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from outer_homes_lib import OUTER, AREAS, Scan, area_of, geom_m, in_box, rect_poly, to_ll, to_m, work_dir  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RING = os.path.join(ROOT, "data", "outer_ring.geojson")
CORE_SNAP = os.path.join(ROOT, "data", "snapshots", "2026-07-30", "buildings.detailed.geojson")
CAPITOL_GJ = os.path.join(ROOT, "data", "capitol.geojson")
TREES = os.path.join(ROOT, "data", "trees.geojson")
OUT = os.path.join(ROOT, "data", "outer", "outer_accuracy.json")
LABELS = os.path.join(ROOT, "data", "outer", "outer_roof_labels.json")
FT_M = 0.3048
ALL = "ALL outer"


def hex_rgb(h):
    return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], np.float32)


def lab(rgb):
    c = np.asarray(rgb, np.float64) / 255.0
    c = np.where(c > 0.04045, ((c + 0.055) / 1.055) ** 2.4, c / 12.92)
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = c @ M.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def bodies_of(ring_path):
    """(polygon in metres, top, colour on top, kind) for every wall body the ring, the core and the Capitol draw."""
    from shapely.geometry import shape
    out = []
    for f in json.load(open(ring_path, encoding="utf-8"))["features"]:
        p = f["properties"]
        if "k" not in p:
            out.append((geom_m(shape(f["geometry"]).buffer(0)), float(p["h"]), p.get("rd") or p.get("wd"), "ring"))
    for fn in (CORE_SNAP, CAPITOL_GJ):
        for f in json.load(open(fn, encoding="utf-8"))["features"]:
            p = f["properties"]
            out.append((geom_m(shape(f["geometry"]).buffer(0)), float(p.get("final_height") or p.get("height") or p.get("h") or 0), None, "core"))
    return out


def evaluate(bodies, truth, img, S):
    import shapely
    from shapely import STRtree
    polys = [b[0] for b in bodies]
    tree = STRtree(polys)
    V = collections.defaultdict(lambda: collections.defaultdict(list))
    C = collections.defaultdict(collections.Counter)
    for P, lon, lat, mh in truth:
        a = area_of(lon, lat)
        if a is None or P.area < 30:
            continue
        cov, best, bi = 0.0, None, 0.0
        for j in tree.query(P):
            try:
                x = P.intersection(polys[j]).area
            except Exception:                       # noqa: BLE001
                x = 0.0
            cov += x
            if x > bi:
                bi, best = x, int(j)
        drawn = cov / P.area >= 0.5
        for k in (a, ALL):
            C[k]["truth_n"] += 1
            C[k]["truth_m2"] += P.area
            if drawn:
                C[k]["drawn_n"] += 1
                C[k]["drawn_m2"] += P.area
            if mh and mh > 0:
                top = bodies[best][1] if (drawn and best is not None) else 0.0
                V[k]["h_all"].append(abs(top - mh))
                if drawn:
                    V[k]["h_drawn"].append(top - mh)
            if drawn and best is not None and bodies[best][2]:
                x0, y0, x1, y1 = P.bounds
                r0, r1, c0, c1 = S.window(x0, y0, x1, y1)
                if r1 - r0 > 2 and c1 - c0 > 2:
                    X, Y = S.centres(r0, r1, c0, c1)
                    m = shapely.contains_xy(P.buffer(-0.8), X, Y)
                    if m.sum() >= 12:
                        px = np.asarray(img[r0:r1, c0:c1]).astype(np.float32)[m]
                        lum = px @ np.array([.299, .587, .114], np.float32)
                        ref = px[lum >= np.median(lum)].mean(axis=0)
                        V[k]["dE"].append(float(np.linalg.norm(lab(ref) - lab(hex_rgb(bodies[best][2])))))
    tpolys = [t[0] for t in truth]
    ttree = STRtree(tpolys)
    for P, h, col, kind in bodies:
        if kind == "core":
            continue
        c = P.centroid
        lon, lat = (float(q) for q in to_ll(c.x, c.y))
        a = area_of(lon, lat)
        if a is None:
            continue
        ov = 0.0
        for j in ttree.query(P):
            try:
                ov += P.intersection(tpolys[j]).area
            except Exception:                       # noqa: BLE001
                pass
        for k in (a, ALL):
            C[k]["pieces"] += 1
            if ov / max(P.area, 1e-6) < 0.2:
                C[k]["extra"] += 1
    rows = {}
    for k in sorted(C):
        c, v = C[k], V[k]
        if not c["truth_n"]:
            continue
        e = np.array(v["h_drawn"]) if v["h_drawn"] else np.array([np.nan])
        rows[k] = dict(
            city_buildings=c["truth_n"], present_pct=round(100 * c["drawn_n"] / c["truth_n"], 1),
            present_area_pct=round(100 * c["drawn_m2"] / c["truth_m2"], 1), missing=c["truth_n"] - c["drawn_n"],
            pieces_drawn=c["pieces"], extra=c["extra"], extra_pct=round(100 * c["extra"] / max(1, c["pieces"]), 1),
            height_n=int(np.isfinite(e).sum()), height_median_abs_m=round(float(np.nanmedian(np.abs(e))), 2),
            height_mean_abs_m=round(float(np.nanmean(np.abs(e))), 2), height_bias_m=round(float(np.nanmedian(e)), 2),
            height_within_1m_pct=round(100 * float(np.nanmean(np.abs(e) <= 1.0)), 1),
            height_mean_abs_all_m=round(float(np.mean(v["h_all"])), 2) if v["h_all"] else None,
            roof_colour_dE=round(float(np.median(v["dE"])), 1) if v["dE"] else None, roof_colour_n=len(v["dE"]))
    return rows


def canopy(S):
    """Per area: share of cells under vegetation >= 3 m in the 2021 scan, and share under the app's tree crowns."""
    import shapely
    from shapely.geometry import shape
    crowns = collections.defaultdict(float)
    for f in json.load(open(TREES, encoding="utf-8"))["features"]:
        if f["properties"].get("kind") == "trunk":
            continue
        g = shape(f["geometry"])
        c = g.centroid
        a = area_of(c.x, c.y, buildings=False)
        if a is not None:
            crowns[a] += geom_m(g).area
            crowns[ALL] += geom_m(g).area
    zv, out = S.arr("zv_max.f32.npy"), {}
    tot_v = tot_n = 0
    names = list(AREAS)
    for name in names:
        b = AREAS[name]
        xs, ys = to_m([b[0], b[2], b[0], b[2]], [b[1], b[1], b[3], b[3]])
        r0, r1, c0, c1 = S.window(xs.min(), ys.min(), xs.max(), ys.max())
        veg = n = 0
        for a0 in range(r0, r1, 2000):
            a1 = min(r1, a0 + 2000)
            z = np.asarray(zv[a0:a1, c0:c1])
            g = S.ground(a0, a1, c0, c1)
            X, Y = S.centres(a0, a1, c0, c1)
            lon, lat = to_ll(X[::8, ::8], Y[::8, ::8])                       # which cells belong to this area: every 4 m
            mine = np.zeros(lon.shape, bool)
            for i in range(lon.shape[0]):
                for j in range(lon.shape[1]):
                    mine[i, j] = area_of(float(lon[i, j]), float(lat[i, j]), buildings=False) == name
            with np.errstate(invalid="ignore"):
                tall = (np.isfinite(z) & (z - g >= 3.0))[::8, ::8]
            veg += int((tall & mine).sum())
            n += int(mine.sum())
        land = n * 16.0
        out[name] = dict(scan_canopy_pct=round(100 * veg / max(1, n), 1), app_crowns_pct=round(100 * crowns[name] / max(1.0, land), 1))
        tot_v += veg
        tot_n += n
    out[ALL] = dict(scan_canopy_pct=round(100 * tot_v / max(1, tot_n), 1), app_crowns_pct=round(100 * crowns[ALL] / max(1.0, tot_n * 16.0), 1))
    return out


def roof_labels(work):
    """Blind labels (data/outer/outer_roof_labels.json) against the fitted roof of each labelled building's biggest rectangle."""
    A = pickle.load(open(os.path.join(work, "bake_a.pkl"), "rb"))
    B = pickle.load(open(os.path.join(work, "bake_b.pkl"), "rb"))
    by_id = {o["id"]: i for i, o in enumerate(A)}
    names = {0: "flat", 1: "gable", 2: "hip", 3: "gable"}
    out = {}
    for name, items in json.load(open(LABELS, encoding="utf-8")).items():
        if name == "note":
            continue
        rows = []
        for t in items:
            i = by_id.get(t["overture_id"])
            fs = [x for x in ((B.get(i) or {}).get("fits") or []) if x] if i is not None else []
            if t["roof"] == "unclear" or not fs:
                continue
            rows.append((t["roof"], t["conf"], names[max(fs, key=lambda x: x["n"])["kind"]]))
        pitched = lambda x: x != "flat"                                      # noqa: E731
        gh = [r for r in rows if r[0] in ("gable", "hip")]
        hi = [r for r in rows if r[1] == "high"]
        out[name] = dict(
            labelled=len(rows),
            flat_vs_pitched_pct=round(100 * sum(pitched(r[0]) == pitched(r[2]) for r in rows) / len(rows), 1),
            flat_vs_pitched_before_pct=round(100 * sum(not pitched(r[0]) for r in rows) / len(rows), 1),
            flat_vs_pitched_high_confidence_pct=round(100 * sum(pitched(r[0]) == pitched(r[2]) for r in hi) / max(1, len(hi)), 1),
            high_confidence_n=len(hi),
            gable_vs_hip_pct=round(100 * sum(r[0] == r[2] for r in gh) / max(1, len(gh)), 1), gable_or_hip_n=len(gh),
            confusion={"%s -> %s" % k: v for k, v in sorted(collections.Counter((r[0], r[2]) for r in rows).items())})
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--work")
    ap.add_argument("--before", required=True, help="the ring GeoJSON as it was before the houses layer")
    a = ap.parse_args()
    work = work_dir(a.work)
    from shapely.geometry import shape
    S = Scan(work)
    truth = []
    for f in json.load(open(os.path.join(work, "coa", "footprints2023.geojson")))["features"]:
        g = shape(f["geometry"])
        g = g if g.is_valid else g.buffer(0)
        if g.is_empty:
            continue
        c = g.centroid
        if not in_box(c.x, c.y, OUTER):
            continue
        mh = f["properties"].get("MAX_HEIGHT")
        truth.append((geom_m(g), c.x, c.y, mh * FT_M if mh else None))
    img = np.load(os.path.join(work, "img", "aerial2025.u8.npy"), mmap_mode="r")
    res = {"before": evaluate(bodies_of(a.before), truth, img, S)}
    after = bodies_of(RING)
    d = pickle.load(open(os.path.join(work, "bake_d.pkl"), "rb"))
    for b in d["builds"]:
        for m in b["rects"]:
            after.append((rect_poly(m["cx"], m["cy"], m["L"], m["W"], m["th"]), m["eave"] + (m["rise"] if m["kind"] else 0.0),
                          d["roof_pal"][m["roof_idx"]], "homes"))
    res["after"] = evaluate(after, truth, img, S)
    res["canopy"] = canopy(S)
    res["roof_kind"] = roof_labels(work)
    res["truth"] = {"outlines_and_heights": "City of Austin Building Footprints 2023 (Watershed Protection Department)",
                    "canopy": "StratMap Bexar & Travis Counties Lidar 2021, vegetation classes, 3 m and taller",
                    "roof_colour": "City of Austin 2025 aerial, 0.5 m samples"}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(res, f, indent=1)
    for leg in ("before", "after"):
        print("\n== %s ==" % leg)
        print("%-24s %7s %8s %8s %7s %6s %8s %8s %8s %9s %7s" % ("area", "city n", "present", "by m2", "missing", "extra", "h med", "h bias", "in 1 m", "h all", "roof dE"))
        for k, r in res[leg].items():
            print("%-24s %7d %7.1f%% %7.1f%% %7d %6d %8.2f %8.2f %7.1f%% %9s %7s" % (
                k, r["city_buildings"], r["present_pct"], r["present_area_pct"], r["missing"], r["extra"], r["height_median_abs_m"],
                r["height_bias_m"], r["height_within_1m_pct"], r["height_mean_abs_all_m"], r["roof_colour_dE"]))
    print("\n== canopy: scan vs the app's tree crowns ==")
    for k, r in res["canopy"].items():
        print("%-24s scan %5.1f%%   app %5.1f%%" % (k, r["scan_canopy_pct"], r["app_crowns_pct"]))
    print("\n== roof kind against blind labels ==")
    print(json.dumps(res["roof_kind"], indent=1))
    print("\nwrote", OUT)


if __name__ == "__main__":
    main()
