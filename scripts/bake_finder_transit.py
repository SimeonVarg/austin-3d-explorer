"""bake_finder_transit.py -- weekday-morning bus minutes for the apartment finder.

Sole writer of data/finder/transit.json (CLAUDE.md rule 1). Read by js/finder.js.

WHY IT IS PRECOMPUTED. A student's class buildings must never leave the
browser (js/wayfind.js section 12 enforces it at runtime), so the finder cannot
ask a live trip planner. Everything a bus answer needs is baked here from the
public timetable and shipped as a small static table; the browser only adds its
own walking-graph leg from the campus stop to the class building.

SOURCE (not in the repo -- download it and pass its path)
  CapMetro GTFS, https://data.texas.gov/dataset/CapMetro-GTFS/r4v4-vz24
  (direct: https://data.texas.gov/download/r4v4-vz24/application/zip). The
  shipped table was baked from feed_version 260826_0956, valid 2026-08-26 ..
  2027-01-09, service date 2026-09-30 (a Wednesday with UT classes in session).
  Transitland lists the feed as allowing derived products, no attribution
  required. Also read (in the repo): data/finder/homes.json (the homes marked
  `bus`) and data/walk_graph.json (door centroids of the anchor buildings).

MODEL (every number is a parameter below). Adapted from the research script
build_transit_minutes.py (2026-09-23); the arithmetic is unchanged, the loop is
reorganised so a grid of a few hundred origins bakes in seconds:
  origin -> walk to a boarding stop    straight line x DETOUR at WALK_MPS
         -> wait                       half the scheduled headway of that route
                                       and direction at that stop around the trip
         -> ride                       stop_times arrival(alight) - departure(board)
         -> walk to the anchor stop    straight line x DETOUR at WALK_MPS
  Single-seat rides only (no transfers). For each (route, direction, board
  stop, alight stop) the trip used is the LATEST one still reaching the anchor
  stop by the deadline; a trip landing more than EARLY_MAX_MIN early is not an
  option. The best total over every route is kept.

  Origins are the `bus` homes AND a GRID_STEP_M grid over GRID_BBOX, so the
  finder can colour the ground by minutes where there is no walking graph.

Re-run next semester with a new feed and an in-session weekday:
    python scripts/bake_finder_transit.py PATH/TO/capmetro.zip 20270203
"""
import collections
import csv
import io
import json
import math
import os
import sys
import zipfile

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
OUT = os.path.join(ROOT, "data", "finder", "transit.json")

# ── parameters ────────────────────────────────────────────────────────────────
WALK_MPS = 1.34          # walking speed, m/s
DETOUR = 1.3             # street distance / straight-line distance
BOARD_RADIUS_M = 1000    # straight-line search radius for boarding stops
ALIGHT_RADIUS_M = 800    # straight-line radius around an anchor stop for alighting
HEADWAY_WINDOW_MIN = (60, 30)  # departures from 60 min before to 30 min after the trip
EARLY_MAX_MIN = 90       # a trip that lands this early is not a real option
DEADLINE_KEY = "by_0900"
DEADLINE_MIN = 9 * 60    # arrive at the campus stop by 09:00
# Campus anchors: the served stop nearest each point. A code = mean of that
# building's doors in the walking graph; None = the WEST_MALL point.
ANCHOR_BUILDINGS = [("GDC", "GDC"), ("WEL", "WEL"), ("UTC", "UTC"), ("WESTMALL", None)]
WEST_MALL = (30.2851, -97.7405)  # midpoint of the West Mall (ASSUMED point)
# Ground grid (south, west, north, east): East Riverside, research/domain-riverside.md
GRID_BBOX = (30.222, -97.740, 30.252, -97.690)
GRID_STEP_M = 250
SHAPE_TOL_M = 8          # Douglas-Peucker tolerance for the drawn bus line
ROUTE_KINDS = [("6", "UT shuttle"), ("8", "MetroRapid"), ("", "bus")]  # by route_id prefix
IN_SESSION_ROUTES = {"640", "642", "656", "661", "663", "670", "672"}   # UT shuttles


def dist_m(la1, lo1, la2, lo2):
    x = math.radians(lo2 - lo1) * math.cos(math.radians((la1 + la2) / 2))
    y = math.radians(la2 - la1)
    return 6371000 * math.hypot(x, y)


def walk_min(d):
    return d * DETOUR / WALK_MPS / 60


def tmin(s):
    h, m, sec = s.split(":")
    return int(h) * 60 + int(m) + int(sec) / 60


def fmt(m):
    return f"{int(m // 60):02d}:{int(round(m % 60)):02d}" if m is not None else None


def read(z, name):
    return csv.DictReader(io.TextIOWrapper(z.open(name), encoding="utf-8-sig"))


def r1(x):
    return round(x, 1)


def simplify(pts, tol_m):
    """Douglas-Peucker on (lat, lon) points in local metres."""
    if len(pts) < 3:
        return pts
    lat0 = pts[0][0]
    kx = 111320 * math.cos(math.radians(lat0))
    xy = [((p[1]) * kx, p[0] * 111320) for p in pts]
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = xy[a]
        bx, by = xy[b]
        dx, dy = bx - ax, by - ay
        L = math.hypot(dx, dy) or 1e-9
        best, bi = -1, -1
        for i in range(a + 1, b):
            px, py = xy[i]
            d = abs(dy * (px - ax) - dx * (py - ay)) / L
            if d > best:
                best, bi = d, i
        if best > tol_m:
            keep[bi] = True
            stack.append((a, bi))
            stack.append((bi, b))
    return [p for p, k in zip(pts, keep) if k]


def main():
    if len(sys.argv) < 2:
        sys.exit("usage: python scripts/bake_finder_transit.py PATH/TO/capmetro.zip [YYYYMMDD]")
    zpath = sys.argv[1]
    date = sys.argv[2] if len(sys.argv) > 2 else "20260930"

    homes_doc = json.load(open(os.path.join(ROOT, "data", "finder", "homes.json"), encoding="utf-8"))
    bus_homes = [h for h in homes_doc["homes"] if h.get("bus")]

    z = zipfile.ZipFile(zpath)
    feed = next(read(z, "feed_info.txt"))
    services = {r["service_id"] for r in read(z, "calendar_dates.txt")
                if r["date"] == date and r["exception_type"] == "1"}
    trips = {r["trip_id"]: r for r in read(z, "trips.txt") if r["service_id"] in services}
    routes = {r["route_id"]: r for r in read(z, "routes.txt")}
    stops = {r["stop_id"]: r for r in read(z, "stops.txt")}
    st = collections.defaultdict(list)
    for r in read(z, "stop_times.txt"):
        if r["trip_id"] in trips:
            st[r["trip_id"]].append((int(r["stop_sequence"]), r["stop_id"], tmin(r["arrival_time"]), tmin(r["departure_time"])))
    for v in st.values():
        v.sort()
    served = {s for v in st.values() for _, s, _, _ in v}
    ll = {s: (float(stops[s]["stop_lat"]), float(stops[s]["stop_lon"])) for s in served}

    deps = collections.defaultdict(list)
    for tid, v in st.items():
        t = trips[tid]
        for _, s, _, d in v[:-1]:
            deps[(t["route_id"], t["direction_id"], s)].append(d)
    for k in deps:
        deps[k].sort()

    def headway(route, direc, stop, dep):
        ds = deps[(route, direc, stop)]
        win = [d for d in ds if dep - HEADWAY_WINDOW_MIN[0] <= d <= dep + HEADWAY_WINDOW_MIN[1]]
        gaps = [b - a for a, b in zip(win, win[1:]) if b > a]
        if not gaps:
            gaps = [b - a for a, b in zip(ds, ds[1:]) if b > a] or [60]
            i = min(range(len(ds)), key=lambda i: abs(ds[i] - dep)) if ds else 0
            gaps = gaps[max(0, i - 1):i + 1] or gaps
        gaps.sort()
        return gaps[len(gaps) // 2]

    # anchors
    g = json.load(open(os.path.join(ROOT, "data", "walk_graph.json"), encoding="utf-8"))
    doors = g["d"]
    anchors = []
    for aid, code in ANCHOR_BUILDINGS:
        if code:
            idx = g["code"][code]
            pt = (sum(doors[i][1] for i in idx) / len(idx) / 1e6, sum(doors[i][0] for i in idx) / len(idx) / 1e6)
        else:
            pt = WEST_MALL
        sid = min(served, key=lambda s: dist_m(*pt, *ll[s]))
        anchors.append({"id": aid, "stop": sid, "pt": pt})

    # origins: bus homes, then the grid
    origins = [("home", h["id"], h["p"][1], h["p"][0]) for h in bus_homes]
    s, w, n, e = GRID_BBOX
    dlat = GRID_STEP_M / 111320
    dlon = GRID_STEP_M / (111320 * math.cos(math.radians((s + n) / 2)))
    grid_pts = []
    lat = s + dlat / 2
    while lat < n:
        lon = w + dlon / 2
        while lon < e:
            grid_pts.append((lat, lon))
            lon += dlon
        lat += dlat
    origins += [("grid", i, la, lo) for i, (la, lo) in enumerate(grid_pts)]

    near = {}   # origin index -> {stop: metres}
    boardset = set()
    for oi, (_, _, la, lo) in enumerate(origins):
        near[oi] = {sid: d for sid in served for d in [dist_m(la, lo, *ll[sid])] if d <= BOARD_RADIUS_M}
        boardset.update(near[oi])

    # per anchor: the best onward trip from every boarding stop
    best_from = {}
    for a in anchors:
        alat, alon = ll[a["stop"]]
        alight = {sid: dist_m(alat, alon, *ll[sid]) for sid in served if dist_m(alat, alon, *ll[sid]) <= ALIGHT_RADIUS_M}
        w2m = {sid: walk_min(d) for sid, d in alight.items()}
        latest = {}
        for tid, v in st.items():
            t = trips[tid]
            for j, (_, sa, arr, _) in enumerate(v):
                if sa not in alight or arr + w2m[sa] > DEADLINE_MIN:
                    continue
                for i in range(j):
                    sb, dep = v[i][1], v[i][3]
                    if sb not in boardset:
                        continue
                    k = (t["route_id"], t["direction_id"], sb, sa)
                    if k not in latest or dep > latest[k][0]:
                        latest[k] = (dep, arr, tid)
        per_stop = {}
        for (r, dr, sb, sa), (dep, arr, tid) in latest.items():
            if DEADLINE_MIN - (arr + w2m[sa]) > EARLY_MAX_MIN:
                continue
            hw = headway(r, dr, sb, dep)
            c = {"tail": hw / 2 + (arr - dep) + w2m[sa], "route": r, "wait": hw / 2, "headway": hw,
                 "ride": arr - dep, "walk_to_anchor": w2m[sa], "board": sb, "alight": sa, "dep": dep, "tid": tid}
            if sb not in per_stop or c["tail"] < per_stop[sb]["tail"]:
                per_stop[sb] = c
        best_from[a["id"]] = per_stop

    def best(oi, aid):
        cands = [(walk_min(d) + best_from[aid][sb]["tail"], sb) for sb, d in near[oi].items() if sb in best_from[aid]]
        if not cands:
            return None
        tot, sb = min(cands)
        c = dict(best_from[aid][sb])
        c["min"] = tot
        c["walk_to_stop"] = walk_min(near[oi][sb])
        return c

    # homes
    shapes_wanted = {}
    home_rows = {}
    for oi, (kind, hid, _, _) in enumerate(origins):
        if kind != "home":
            continue
        row = {}
        for a in anchors:
            c = best(oi, a["id"])
            if not c:
                continue
            shp = trips[c["tid"]].get("shape_id")
            key = (shp, c["board"], c["alight"])
            shapes_wanted.setdefault(key, len(shapes_wanted))
            row[a["id"]] = {"min": r1(c["min"]), "wait": r1(c["wait"]), "route": c["route"],
                            "walk_to_stop": r1(c["walk_to_stop"]), "ride": r1(c["ride"]),
                            "walk_to_anchor": r1(c["walk_to_anchor"]), "headway": r1(c["headway"]),
                            "board": c["board"], "alight": c["alight"], "bus_departs": fmt(c["dep"]),
                            "shape": shapes_wanted[key]}
        home_rows[hid] = row

    # grid
    cells = []
    for oi, (kind, gi, la, lo) in enumerate(origins):
        if kind != "grid":
            continue
        vals, anyv = [], False
        for a in anchors:
            c = best(oi, a["id"])
            if c:
                anyv = True
                vals += [r1(c["min"]), r1(c["wait"])]
            else:
                vals += [None, None]
        if anyv:
            cells.append([round(lo, 5), round(la, 5)] + vals)

    # shapes, clipped board -> alight and simplified
    need_ids = {k[0] for k in shapes_wanted}
    raw = collections.defaultdict(list)
    for r in read(z, "shapes.txt"):
        if r["shape_id"] in need_ids:
            raw[r["shape_id"]].append((int(r["shape_pt_sequence"]), float(r["shape_pt_lat"]), float(r["shape_pt_lon"])))
    shapes_out = [None] * len(shapes_wanted)
    for (shp, sb, sa), ix in shapes_wanted.items():
        pts = [(la, lo) for _, la, lo in sorted(raw.get(shp, []))]
        if not pts:
            shapes_out[ix] = [[round(ll[sb][1], 5), round(ll[sb][0], 5)], [round(ll[sa][1], 5), round(ll[sa][0], 5)]]
            continue
        i0 = min(range(len(pts)), key=lambda i: dist_m(*pts[i], *ll[sb]))
        i1 = min(range(i0, len(pts)), key=lambda i: dist_m(*pts[i], *ll[sa]))
        seg = simplify(pts[i0:i1 + 1], SHAPE_TOL_M)
        shapes_out[ix] = [[round(lo, 5), round(la, 5)] for la, lo in seg]

    used_stops = {a["stop"] for a in anchors}
    used_routes = set()
    for row in home_rows.values():
        for c in row.values():
            used_stops.update([c["board"], c["alight"]])
            used_routes.add(c["route"])
    def kind_of(rid):
        return next(k for p, k in ROUTE_KINDS if rid.startswith(p))

    out = {
        "v": 1,
        "_about": "Weekday bus minutes, arriving at a campus anchor stop by 09:00, from the finder's bus homes and "
                  "from a ground grid over East Riverside. min = walk to stop + wait (half the headway) + ride + "
                  "walk to the anchor stop. The browser adds its walking-graph leg from the anchor stop to the "
                  "class building. Precomputed so no trip planner is ever asked.",
        "_source": f"CapMetro GTFS feed_version {feed['feed_version']} (valid {feed['feed_start_date']}.."
                   f"{feed['feed_end_date']}), https://data.texas.gov/dataset/CapMetro-GTFS/r4v4-vz24",
        "_script": "scripts/bake_finder_transit.py",
        "service_date": date,
        "deadline": DEADLINE_KEY,
        "arrive_by": fmt(DEADLINE_MIN),
        "assumptions": {"walk_mps": WALK_MPS, "detour_factor": DETOUR, "board_radius_m": BOARD_RADIUS_M,
                        "alight_radius_m": ALIGHT_RADIUS_M, "transfers": 0,
                        "wait": "half the scheduled headway (median gap, 60 min before to 30 min after the trip)",
                        "trip_used": "latest trip reaching the anchor stop by the deadline"},
        "anchors": [{"id": a["id"], "stop": a["stop"]} for a in anchors],
        "stops": {sid: [round(ll[sid][1], 6), round(ll[sid][0], 6), stops[sid]["stop_name"]] for sid in sorted(used_stops)},
        "routes": {rid: {"name": routes[rid]["route_long_name"], "kind": kind_of(rid),
                         "in_session_only": rid in IN_SESSION_ROUTES} for rid in sorted(used_routes)},
        "shapes": shapes_out,
        "homes": home_rows,
        "grid": {"step_m": GRID_STEP_M, "bbox": list(GRID_BBOX),
                 "shape": "[lon, lat, then min and wait for each anchor in `anchors` order; null = no single-seat ride]",
                 "cells": cells},
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))
        fh.write("\n")

    print(f"feed {feed['feed_version']} date {date} trips {len(st)} board stops {len(boardset)}")
    for a in anchors:
        print(f"anchor {a['id']:8s} stop {a['stop']} {stops[a['stop']]['stop_name']}")
    for hid, row in home_rows.items():
        print(f"{hid:30s} " + "  ".join(f"{k}={v['min']:.1f}({v['route']})" for k, v in row.items()))
    print(f"grid {len(cells)} of {len(grid_pts)} points reach campus; {len(shapes_out)} shapes; "
          f"{os.path.getsize(OUT)} bytes -> {os.path.relpath(OUT, ROOT)}")


if __name__ == "__main__":
    main()
