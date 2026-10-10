#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""downtown-accuracy.py -- how close is downtown to the real downtown? No browser.

For EVERY building in the City's downtown districts this compares what the app
draws with outside sources, and prints one table: a row per building with its
state and its biggest error, and totals.

WHAT IS COMPARED
    drawn      data/outer_ring.geojson (what the outer layer's tiles are cut
               from): every extrusion, as a height field on a 2 m grid.
    scan       data/outer/downtown_scan_2m.png: roof height above ground from
               the 2021 airborne laser scan (CC0), same grid.
    outlines   data/outer/downtown_massing.json: the reference list of
               buildings (OpenStreetMap outlines, City of Austin 2023 structures
               where OpenStreetMap has none) and what the public tables claim.
    public     scripts/outer_heights.json: published heights of the towers.

THE NUMBERS, PER BUILDING (inside its reference outline)
    dh      drawn roof minus scan roof, both the 90th percentile of the cells.
    mae     mean |drawn - scan| over the cells: one number for height, step and
            footprint errors together, in metres.
    viou    volume both agree on / volume either claims (1.0 = the same solid).
    cover   share of the outline the app draws anything on.
A building the scan cannot speak for (finished after early 2021) is compared
with its public height only, and says so.

STATE
    authored   a hand-modelled tower (features carrying `lm`)
    measured   drawn from levels cut out of the scan (the bake says so in
               data/outer/outer_report.json)
    generic    everything else: one outline, one height, guessed steps
    unmapped   in the City's 2023 survey but not on today's map (pulled down
               since, or never mapped). Not drawn on purpose; listed, not scored.
    other file drawn by the core snapshot or the Capitol bake (not the ring);
               compared as plain prisms from `final_height`, which is NOT always
               what those layers put on screen. Listed, not scored.

    Usage:  python scripts/verify/downtown-accuracy.py [--ring FILE] [--json OUT]
                                                       [--md OUT] [--label TEXT]
"""
import argparse
import json
import math
import os
import sys

import numpy as np
import shapely
from shapely.geometry import Point, Polygon, shape
from shapely.strtree import STRtree

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RING = os.path.join(ROOT, "data", "outer_ring.geojson")
SCAN = os.path.join(ROOT, "data", "outer", "downtown_scan_2m.png")
MASSING = os.path.join(ROOT, "data", "outer", "downtown_massing.json")
DISTRICTS = os.path.join(ROOT, "data", "outer", "downtown_districts.json")
CAPITOL = os.path.join(ROOT, "data", "capitol.geojson")
HEIGHTS = os.path.join(ROOT, "scripts", "outer_heights.json")
MANIFEST = os.path.join(ROOT, "data", "manifest.json")
REPORT = os.path.join(ROOT, "data", "outer", "outer_report.json")

ROOF_MIN = 2.5          # metres; below this a cell is ground
MISSING_COVER = 0.30    # the app draws on less than this share of the outline
AUTHORED_COVER = 0.40
OTHER_COVER = 0.35
INNER_M = 1.5           # roof height is read this far inside the outline...
INNER_MIN_CELLS = 6     # ...when at least this many cells are


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


class Grid:
    def __init__(self, png):
        from PIL import Image
        im = Image.open(png)
        self.f = json.loads(im.text["frame"])
        self.scan = np.asarray(im, np.float32) / 10.0
        self.ny, self.nx = self.scan.shape
        self.cell = self.f["cell_m"]

    def xy(self, ring):
        f = self.f
        return [((lon - f["origin_lon"]) * f["m_per_deg_lon"],
                 (lat - f["origin_lat"]) * f["m_per_deg_lat"]) for lon, lat in ring]

    def poly(self, rings):
        try:
            p = Polygon(self.xy(rings[0]), [self.xy(h) for h in rings[1:]])
            if not p.is_valid:
                p = p.buffer(0)
            return p
        except Exception:  # noqa: BLE001
            return Polygon()

    def cells(self, poly):
        """(rows, cols) of the cells whose centre is inside the polygon."""
        if poly.is_empty:
            return np.empty(0, int), np.empty(0, int)
        f, c = self.f, self.cell
        minx, miny, maxx, maxy = poly.bounds
        c0 = max(0, int(math.floor((minx - f["x0_m"]) / c)))
        c1 = min(self.nx, int(math.ceil((maxx - f["x0_m"]) / c)))
        r0 = max(0, int(math.floor((f["y_top_m"] - maxy) / c)))
        r1 = min(self.ny, int(math.ceil((f["y_top_m"] - miny) / c)))
        if c1 <= c0 or r1 <= r0:
            return np.empty(0, int), np.empty(0, int)
        xs = f["x0_m"] + (np.arange(c0, c1) + 0.5) * c
        ys = f["y_top_m"] - (np.arange(r0, r1) + 0.5) * c
        X, Y = np.meshgrid(xs, ys)
        m = shapely.contains_xy(poly, X, Y)
        rr, cc = np.nonzero(m)
        return rr + r0, cc + c0


def rasterise(grid, feats, height_of, skip=None):
    field = np.zeros((grid.ny, grid.nx), np.float32)
    polys = []
    for ft in feats:
        p = ft.get("properties") or {}
        if skip and skip(p):
            continue
        g = ft.get("geometry") or {}
        parts = [g["coordinates"]] if g.get("type") == "Polygon" else \
            (g.get("coordinates") or []) if g.get("type") == "MultiPolygon" else []
        h = height_of(p)
        if not h:
            continue
        for rings in parts:
            q = grid.poly(rings)
            rr, cc = grid.cells(q)
            if rr.size:
                np.maximum.at(field, (rr, cc), np.float32(h))
            polys.append((q, p))
    return field, polys


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ring", default=RING)
    ap.add_argument("--json")
    ap.add_argument("--md")
    ap.add_argument("--label", default="")
    ap.add_argument("--before", action="store_true",
                    help="the ring is an older one: no outline counts as measured")
    a = ap.parse_args()

    grid = Grid(SCAN)
    scan = grid.scan
    massing = load(MASSING)
    districts = [(r["name"], grid.poly([list(q.exterior.coords)]))
                 for r in load(DISTRICTS)["rows"]
                 for q in (shape(r["g"]).geoms if shape(r["g"]).geom_type == "MultiPolygon"
                           else [shape(r["g"])])]
    ring = load(a.ring)["features"]

    # ── what the app draws ────────────────────────────────────────────
    # Park pads and ground-floor bands are not roofs; thin masts and light
    # strips are not massing.
    def not_massing(p):
        return p.get("k") in ("g", "r") or p.get("lmThin") or p.get("lmEmit")

    drawn, ring_polys = rasterise(grid, ring, lambda p: p.get("h"), not_massing)
    authored, lm_polys = rasterise(grid, [f for f in ring if f["properties"].get("lm")],
                                   lambda p: p.get("h"))
    # A spire or a crown rim is narrower than a 2 m cell and can fall between
    # cell centres, so a hand-modelled tower's TOP is read off its own pieces.
    lm_tree = STRtree([q for q, _ in lm_polys]) if lm_polys else None
    other_feats = list(load(CAPITOL)["features"])
    snap = os.path.join(ROOT, "data", "snapshots", str(load(MANIFEST).get("latest")),
                        "buildings.detailed.geojson")
    if os.path.exists(snap):
        other_feats += load(snap)["features"]
    other, _ = rasterise(grid, other_feats, lambda p: p.get("final_height") or p.get("h"))
    drawn_all = np.maximum(drawn, other)

    curated = [(e["name"], Point(*grid.xy([(e["lon"], e["lat"])])[0]), float(e["height"]))
               for e in load(HEIGHTS).get("by_point") or []]

    # How the bake drew each outline (data/outer/outer_report.json). --before
    # ignores it: an older ring knows nothing of measured levels.
    bake_state = {}
    if not a.before and os.path.exists(REPORT):
        bake_state = ((load(REPORT).get("downtown_detail") or {})
                      .get("downtown_bodies") or {}).get("state") or {}

    rows = []
    unit_cells = np.zeros((grid.ny, grid.nx), bool)
    for r in massing["rows"]:
        if not r.get("dt"):
            continue
        P = grid.poly(r["g"])
        rr, cc = grid.cells(P)
        if rr.size == 0:
            # smaller than a cell: take the cell under its centre
            c = P.representative_point() if not P.is_empty else None
            if c is None:
                continue
            col = int((c.x - grid.f["x0_m"]) / grid.cell)
            row = int((grid.f["y_top_m"] - c.y) / grid.cell)
            if not (0 <= col < grid.nx and 0 <= row < grid.ny):
                continue
            rr, cc = np.array([row]), np.array([col])
        unit_cells[rr, cc] = True
        t = r.get("t") or {}
        d = drawn_all[rr, cc]
        s = scan[rr, cc]
        cover = float((d >= ROOF_MIN).mean())
        o_cover = float((other[rr, cc] >= ROOF_MIN).mean())
        a_cover = float((authored[rr, cc] > 0).mean())
        pub = max([h for nm, pt, h in curated if P.contains(pt)] or [0]) or None
        claim = pub or r.get("osm_h") or r.get("city_h")
        cpt = P.representative_point()
        district = next((nm for nm, q in districts if q.contains(cpt)), "")
        row = {"id": r["id"], "name": t.get("name") or "", "district": district,
               "area": r["a"], "scan_state": r["st"], "cover": round(cover, 2)}
        # Roof HEIGHT is read on the cells well inside the outline: a 2 m cell on
        # the edge is half the neighbour, and next to a tower that neighbour is
        # 100 m of error that belongs to nobody. Volume is read on all cells.
        ir, ic = grid.cells(P.buffer(-INNER_M))
        if ir.size < INNER_MIN_CELLS:
            ir, ic = rr, cc
        d_in, s_in = drawn_all[ir, ic], scan[ir, ic]
        d_roof = d_in[d_in >= ROOF_MIN]
        row["drawn"] = round(float(np.percentile(d_roof, 90)), 1) if d_roof.size else 0.0
        drawn_top = round(float(d.max()), 1) if d.size else 0.0
        if claim:
            row["public"] = round(float(claim), 1)
        scored = r["st"] == "scan"
        if scored:
            s_roof = s_in[s_in >= ROOF_MIN]
            row["scan"] = round(float(np.percentile(s_roof, 90)), 1) if s_roof.size \
                else r.get("p90", 0.0)
            row["dh"] = round(row["drawn"] - row["scan"], 1)
            row["mae"] = round(float(np.abs(d - s).mean()), 1)
            den = float(np.maximum(d, s).sum())
            row["viou"] = round(float(np.minimum(d, s).sum()) / den, 2) if den else 0.0
            ref = row["scan"]
        else:
            ref = claim
            if ref:
                row["dh"] = round(row["drawn"] - float(ref), 1)
        # A hand-modelled tower is built to its PUBLISHED height, which counts
        # the crown and the spire; the scan's roof does not. Its height is
        # checked against the published figure, its shape against the scan.
        if a_cover >= AUTHORED_COVER and pub:
            tops = [lm_polys[int(j)][1]["h"] for j in lm_tree.query(P)
                    if lm_polys[int(j)][0].representative_point().within(P)]
            drawn_top = round(max(tops), 1) if tops else drawn_top
            row["drawn"] = drawn_top
            row["dh"] = round(drawn_top - pub, 1)
            row["dh_ref"] = "public"
        # state
        if o_cover >= OTHER_COVER:
            state = "other file"
        elif a_cover >= AUTHORED_COVER:
            state = "authored"
        elif r["src"] == "city":
            state = "unmapped"
        elif bake_state.get(r["id"]) == "m":
            state = "measured"
        else:
            state = "generic"
        row["state"] = state
        # the biggest error, in words
        if cover < MISSING_COVER:
            err = "MISSING: nothing drawn here"
        elif not scored and ref is None:
            err = "no reference (not in the 2021 scan, no public height)"
        elif not scored:
            err = "height %+.0f m against the public figure (not in the 2021 scan)" % row["dh"]
        else:
            cands = [(abs(row["dh"]), "height %+.1f m%s" % (
                row["dh"], " against the published height" if row.get("dh_ref") else ""))]
            if cover < 0.85:
                cands.append(((1 - cover) * 20, "outline: %.0f%% of it is drawn" % (100 * cover)))
            if row["viou"] < 0.85 and abs(row["dh"]) < 3:
                cands.append(((1 - row["viou"]) * 30,
                              "shape: steps or setbacks wrong (%.0f%% of the volume agrees)"
                              % (100 * row["viou"])))
            err = max(cands)[1]
            if row["viou"] < 0.85 and row.get("dh_ref") and abs(row["dh"]) < 3:
                err = "shape: %.0f%% of the volume agrees with the scan" % (100 * row["viou"])
            if row["mae"] < 1.0 and abs(row["dh"]) < 1.5:
                err = "within 1.5 m"
        row["error"] = err
        rows.append(row)

    # ── extra: drawn where neither the scan nor any outline has a building ──
    in_dt = np.zeros((grid.ny, grid.nx), bool)
    for _, q in districts:
        rr, cc = grid.cells(q)
        in_dt[rr, cc] = True
    extra = []
    for q, p in ring_polys:
        if p.get("k") or q.is_empty or q.area < 30:
            continue
        rr, cc = grid.cells(q)
        if rr.size == 0 or not in_dt[rr, cc].any():
            continue
        if unit_cells[rr, cc].mean() < 0.30 and (scan[rr, cc] >= ROOF_MIN).mean() < 0.30:
            c = q.representative_point()
            extra.append({"area": round(q.area), "h": p.get("h"),
                          "lon": round(grid.f["origin_lon"] + c.x / grid.f["m_per_deg_lon"], 5),
                          "lat": round(grid.f["origin_lat"] + c.y / grid.f["m_per_deg_lat"], 5)})

    # ── totals ────────────────────────────────────────────────────────
    ringed = [r for r in rows if r["state"] not in ("other file", "unmapped")]
    scored = [r for r in ringed if "viou" in r]
    late = [r for r in ringed if "viou" not in r]

    def stat(sel):
        if not sel:
            return {}
        dh = np.array([abs(r["dh"]) for r in sel])
        return {"n": len(sel),
                "median_abs_dh_m": round(float(np.median(dh)), 1),
                "mean_abs_dh_m": round(float(dh.mean()), 1),
                "within_2m_pct": round(100 * float((dh <= 2).mean())),
                "within_5m_pct": round(100 * float((dh <= 5).mean())),
                "off_by_10m": int((dh > 10).sum()),
                "mean_mae_m": round(float(np.mean([r["mae"] for r in sel])), 1),
                "median_viou": round(float(np.median([r["viou"] for r in sel])), 2)}

    # the whole of downtown as one solid, on the cells the ring owns
    own = in_dt & (other < ROOF_MIN)
    lateish = np.zeros_like(own)
    for r in massing["rows"]:
        if r.get("dt") and (r["st"] != "scan" or r["src"] == "city"):
            rr, cc = grid.cells(grid.poly(r["g"]))
            lateish[rr, cc] = True
    cmp = own & ~lateish
    dd, ss = drawn[cmp], scan[cmp]
    whole = {
        "cells": int(cmp.sum()),
        "volume_scan_Mm3": round(float(ss.sum()) * grid.cell ** 2 / 1e6, 2),
        "volume_drawn_Mm3": round(float(dd.sum()) * grid.cell ** 2 / 1e6, 2),
        "viou": round(float(np.minimum(dd, ss).sum() / max(1.0, np.maximum(dd, ss).sum())), 3),
        "mae_on_roof_cells_m": round(float(np.abs(dd - ss)[(dd >= ROOF_MIN) | (ss >= ROOF_MIN)].mean()), 2),
        "footprint_iou": round(float(((dd >= ROOF_MIN) & (ss >= ROOF_MIN)).sum()
                                     / max(1, ((dd >= ROOF_MIN) | (ss >= ROOF_MIN)).sum())), 3),
    }
    by_state = {}
    for st in ("authored", "measured", "generic"):
        by_state[st] = stat([r for r in scored if r["state"] == st])
        by_state[st]["not_in_scan"] = sum(1 for r in late if r["state"] == st)
    summary = {
        "label": a.label, "ring": os.path.relpath(a.ring, ROOT),
        "buildings": len(rows), "in_ring": len(ringed),
        "other_file": sum(1 for r in rows if r["state"] == "other file"),
        "unmapped_today": sum(1 for r in rows if r["state"] == "unmapped"),
        "states": {st: sum(1 for r in ringed if r["state"] == st)
                   for st in ("authored", "measured", "generic")},
        "missing": sum(1 for r in ringed if r["cover"] < MISSING_COVER),
        "extra": len(extra),
        "against_scan": stat(scored),
        "against_scan_by_state": by_state,
        "not_in_scan": {
            "n": len(late),
            "with_public_height": sum(1 for r in late if "dh" in r),
            "median_abs_dh_m": round(float(np.median([abs(r["dh"]) for r in late if "dh" in r])), 1)
            if any("dh" in r for r in late) else None,
            "off_by_10m": sum(1 for r in late if "dh" in r and abs(r["dh"]) > 10),
        },
        "whole_downtown": whole,
    }
    print(json.dumps(summary, indent=1))
    if a.json:
        with open(a.json, "w", encoding="utf-8") as f:
            json.dump({"summary": summary, "rows": rows, "extra": extra}, f,
                      separators=(",", ":"), ensure_ascii=False)
    if a.md:
        rows_s = sorted(rows, key=lambda r: (r["state"] == "other file", -r["area"]))
        with open(a.md, "w", encoding="utf-8") as f:
            f.write("| building | district | m2 | state | scan m | public m | drawn m | "
                    "dh m | mae m | volume agrees | biggest error |\n")
            f.write("|---|---|---:|---|---:|---:|---:|---:|---:|---:|---|\n")
            for r in rows_s:
                f.write("| %s | %s | %d | %s | %s | %s | %s | %s | %s | %s | %s |\n" % (
                    (r["name"] or r["id"]).replace("|", "/"), r["district"], r["area"],
                    r["state"], r.get("scan", ""), r.get("public", ""), r["drawn"],
                    r.get("dh", ""), r.get("mae", ""),
                    ("%d%%" % round(100 * r["viou"])) if "viou" in r else "",
                    r["error"]))


if __name__ == "__main__":
    main()
