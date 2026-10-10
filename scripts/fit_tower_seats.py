#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""fit_tower_seats.py -- put the hand-modelled towers where the scan says they stand.

    data/outer/downtown_massing.json    (measured levels per building)
    data/outer/downtown_scan_2m.png     (the scan, for scoring)
        ->  scripts/downtown_tower_seats.json   (this script's ONE output)

WHY. scripts/downtown_tower_identities.py models 23 towers by hand: a shaft
rectangle `r` around a centre, a podium height, a form. Its own header says the
plan numbers are "bounded photo fits, not survey measurements", and the centre
is the middle of the mapped outline, which for a tower on a podium is the middle
of the BLOCK. Measured against the 2021 laser scan, half of those shafts stand
on the wrong part of their block (the JW Marriott's slab runs north-south along
the east edge; it was drawn east-west across the middle), and the podiums are 5
to 25 m too low.

WHAT A SEAT IS. For a tower the scan saw, the SHAFT is the measured level with
the largest volume of its own (plan area times its rise above the level below).
The seat is that level's plan reduced to the builder's rectangle: its centre,
its direction, and a rectangle of the same area and proportions. The podium is
the top of the level below it. Nothing about the tower's form, colour, crown or
public height changes.

A SEAT IS USED ONLY IF IT MEASURES BETTER. Each tower is built both ways,
turned into a height field on the scan's grid, and scored inside its own
outline (volume both agree on / volume either claims). The seat is kept when
that score rises by SEAT["min_gain"] or more; otherwise the tower stays as it
was and the table says so. Towers finished after the flight have no seat.

    Usage:  python scripts/fit_tower_seats.py
"""
import json
import math
import os
import sys

import numpy as np
import shapely
from shapely.geometry import Point, Polygon
from shapely.ops import unary_union

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.argv = [sys.argv[0]]            # bake_outer reads argv[1] as a date
import bake_outer as bo                                    # noqa: E402
import downtown_bodies                                      # noqa: E402
from downtown_facade_profiles import PROFILES, profile_for  # noqa: E402
from downtown_tower_identities import TOWER_IDENTITIES, TUNING, build_tower_identity  # noqa: E402

MASSING = os.path.join(ROOT, "data", "outer", "downtown_massing.json")
SCAN = os.path.join(ROOT, "data", "outer", "downtown_scan_2m.png")
OUT = os.path.join(HERE, "downtown_tower_seats.json")

SEAT = {
    "min_gain": 0.03,          # the score must rise by this much for a seat to be used
    "wing_gain": 0.01,         # ...and by this much more for the measured wings to be added
    "shaft_min_height_share": 0.5,   # the shaft's roof is at least this share of the top
    "podium_min_cover": 0.70,  # a podium covers at least this share of the outline
    "min_shaft_area_m2": 250.0,
    "near_m": 40.0,            # a tower's centre may sit this far outside its outline
}


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def poly_m(rings):
    p = Polygon(bo.to_metres(rings[0]), [bo.to_metres(h) for h in rings[1:]]).buffer(0)
    return max(p.geoms, key=lambda q: q.area) if p.geom_type == "MultiPolygon" else p


class Grid:
    def __init__(self):
        from PIL import Image
        im = Image.open(SCAN)
        self.f = json.loads(im.text["frame"])
        self.scan = np.asarray(im, np.float32) / 10.0
        self.ny, self.nx = self.scan.shape

    def cells(self, poly):
        f, c = self.f, self.f["cell_m"]
        if poly.is_empty:
            return np.empty(0, int), np.empty(0, int)
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
        rr, cc = np.nonzero(shapely.contains_xy(poly, X, Y))
        return rr + r0, cc + c0

    def score(self, solids, outline):
        """Volume agreement of a list of features with the scan, inside `outline`."""
        field = np.zeros((self.ny, self.nx), np.float32)
        for s in solids:
            p = s["properties"]
            if p.get("lmThin") or p.get("lmEmit") or p.get("k") in ("g", "r"):
                continue
            q = Polygon(bo.to_metres(s["geometry"]["coordinates"][0])).buffer(0)
            rr, cc = self.cells(q)
            if rr.size:
                np.maximum.at(field, (rr, cc), np.float32(p["h"]))
        rr, cc = self.cells(outline)
        d, s = field[rr, cc], self.scan[rr, cc]
        den = float(np.maximum(d, s).sum())
        return float(np.minimum(d, s).sum()) / den if den else 0.0


def seat_from_levels(row, default_bearing):
    lv = row.get("lv") or []
    if len(lv) < 2:
        return None
    best, best_vol = None, 0.0
    for k in range(1, len(lv)):
        if lv[k][0] < SEAT["shaft_min_height_share"] * lv[-1][0]:
            continue                       # a shaft is tall; a big low level is podium
        plans = [poly_m(rings) for rings in lv[k][1]]
        area = sum(p.area for p in plans)
        vol = area * (lv[k][0] - lv[k - 1][0])
        if vol > best_vol:
            best, best_vol = (k, plans, area), vol
    if best is None or best[2] < SEAT["min_shaft_area_m2"]:
        return None
    k, plans, area = best
    # The podium is the highest level under the shaft that still covers most
    # of the outline. A level that covers half of it is a wing, not the podium.
    podium = lv[0][0]
    for j in range(1, k):
        a_j = sum(poly_m(rings).area for rings in lv[j][1])
        if a_j >= SEAT["podium_min_cover"] * row["a"]:
            podium = lv[j][0]
    shaft = max(plans, key=lambda p: p.area)
    mrr = shaft.minimum_rotated_rectangle
    xs, ys = mrr.exterior.coords.xy
    e1 = (xs[1] - xs[0], ys[1] - ys[0])
    e2 = (xs[2] - xs[1], ys[2] - ys[1])
    # The builder's x axis points `bearing` degrees clockwise from east. Take
    # the rectangle's edge direction nearest the street grid's.
    def bearing_of(e):
        return -math.degrees(math.atan2(e[1], e[0]))
    cands = []
    for e, ln_x, ln_y in ((e1, math.hypot(*e1), math.hypot(*e2)),
                          (e2, math.hypot(*e2), math.hypot(*e1))):
        b = bearing_of(e)
        b = (b - default_bearing + 90.0) % 180.0 - 90.0 + default_bearing
        cands.append((abs(b - default_bearing), b, ln_x, ln_y))
    _, bearing, w, d = min(cands)
    k_area = math.sqrt(shaft.area / (w * d))        # same area as the measured plan
    w, d = w * k_area, d * k_area
    c = shaft.centroid
    return {
        "center": [round(bo.OUTER["minlon"] + c.x / bo.M_LON, 6),
                   round(bo.OUTER["minlat"] + c.y / bo.M_LAT, 6)],
        "r": [round(-w / 2, 1), round(w / 2, 1), round(-d / 2, 1), round(d / 2, 1)],
        "bearing": round(bearing, 1),
        "podium": round(podium, 1),
        "shaft_top_m": lv[k][0],
        "shaft_area_m2": round(shaft.area),
    }


def main():
    rows = [r for r in load(MASSING)["rows"] if r.get("dt")]
    polys = [poly_m(r["g"]) for r in rows]
    grid = Grid()
    out = {}
    for name, cfg in TOWER_IDENTITIES.items():
        x, y = bo.to_metres([cfg["center"]])[0]
        pt = Point(x, y)
        hit = [i for i, p in enumerate(polys) if p.contains(pt)]
        if not hit:
            near = sorted((p.distance(pt), i) for i, p in enumerate(polys))
            hit = [near[0][1]] if near and near[0][0] <= SEAT["near_m"] else []
        if not hit:
            out[name] = {"used": False, "why": "no mapped outline under it"}
            continue
        i = max(hit, key=lambda j: polys[j].area)
        row, outline = rows[i], polys[i]
        entry = {"outline": row["id"]}
        if row["st"] != "scan":
            entry.update(used=False, why="finished after the 2021 scan")
            out[name] = entry
            continue
        ring = list(outline.exterior.coords)
        old = build_tower_identity(bo, name, cfg["height"], 0, footprint=ring)
        entry["viou_as_authored"] = round(grid.score(old, outline), 3)
        seat = seat_from_levels(row, cfg.get("bearing", TUNING["bearing"]))
        if seat is None:
            entry.update(used=False, why="the scan shows no separate shaft")
            out[name] = entry
            continue
        try:
            new = build_tower_identity(bo, name, cfg["height"], 0, footprint=ring, seat=seat)
            bad = sum(1 for s in new if not Polygon(s["geometry"]["coordinates"][0]).is_valid)
            if bad:
                raise ValueError("%d invalid pieces" % bad)
            entry["viou_seated"] = round(grid.score(new, outline), 3)
            fp_w = profile_for(name, "commercial", cfg["height"], outline.area)
            wing = downtown_bodies.wings(bo, row, seat["podium"], new,
                                         PROFILES[fp_w]["wd"], fp_w, row["id"])
            entry["viou_seated_with_wings"] = round(grid.score(new + wing, outline), 3)
            seat["wings"] = bool(wing) and (entry["viou_seated_with_wings"]
                                            >= entry["viou_seated"] + SEAT["wing_gain"])
        except Exception as exc:  # noqa: BLE001 -- a form that cannot take the plan keeps its own
            entry.update(used=False, why="the form cannot take the measured plan (%s)" % exc)
            out[name] = entry
            continue
        entry.update(seat)
        entry["was"] = {"center": [round(v, 6) for v in cfg["center"]], "r": cfg["r"],
                        "bearing": cfg.get("bearing", TUNING["bearing"]),
                        "podium": cfg["podium"]}
        entry["moved_m"] = round(math.hypot(
            (seat["center"][0] - cfg["center"][0]) * bo.M_LON,
            (seat["center"][1] - cfg["center"][1]) * bo.M_LAT), 1)
        best_new = entry["viou_seated_with_wings"] if seat["wings"] else entry["viou_seated"]
        entry["used"] = best_new >= entry["viou_as_authored"] + SEAT["min_gain"]
        if not entry["used"]:
            entry["why"] = "the seat does not measure better"
        out[name] = entry
        print("  %-26s %s  %.2f -> %.2f (wings %.2f)  moved %5.1f m  podium %s -> %s  plan %s -> %s"
              % (name, "USED" if entry["used"] else "kept", entry["viou_as_authored"],
                 entry["viou_seated"], entry["viou_seated_with_wings"], entry["moved_m"], cfg["podium"], seat["podium"],
                 "%dx%d" % (cfg["r"][1] - cfg["r"][0], cfg["r"][3] - cfg["r"][2]),
                 "%.0fx%.0f" % (seat["r"][1] - seat["r"][0], seat["r"][3] - seat["r"][2])))
    doc = {
        "note": "Where each hand-modelled downtown tower's shaft stands, measured from "
                "the 2021 laser scan. Written by scripts/fit_tower_seats.py; read by "
                "scripts/downtown_bodies.py. `used: false` means the tower is built "
                "exactly as scripts/downtown_tower_identities.py says.",
        "score": "viou = volume the model and the scan agree on / volume either claims, "
                 "inside the tower's mapped outline, on a 2 m grid",
        "dials": SEAT,
        "towers": out,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=1)
    print("  wrote %s: %d of %d seats used" % (OUT, sum(1 for v in out.values() if v.get("used")),
                                               len(out)))


if __name__ == "__main__":
    main()
