"""bake_transit_live.py -- a small slice of the CapMetro timetable for the live bus layer.

Sole writer of data/transit-live.json (CLAUDE.md rule 1). Read by js/transit-live.js
(scheduled "next departures" fallback, stop and route names, colours) and by the route search.

SOURCE (not in the repo -- download it and pass its path)
  CapMetro GTFS, https://data.texas.gov/dataset/CapMetro-GTFS/r4v4-vz24
  (direct: https://data.texas.gov/download/r4v4-vz24/application/zip, about 34 MB).
  Keep the zip OUTSIDE the repo (the team keeps it in ~/flyover-private/transit/).
  Licence: CapMetro "Open Data License Agreement and Terms of Use", see docs/transit-live.md.

    python3 scripts/bake_transit_live.py PATH/TO/capmetro.zip [WEEKDAY SATURDAY SUNDAY]
  dates are YYYYMMDD service dates inside the feed; defaults are the first in-session
  Wednesday, Saturday and Sunday after the baked feed starts (see DEFAULT_DATES).

WHAT IS KEPT. Only stops inside BBOX, only routes that serve at least MIN_ROUTE_STOPS of
them, and per route and direction:
  - the ordered stop list of the most common weekday pattern (stops inside BBOX only),
    scheduled run minutes to each, the drawn line (clipped to BBOX, simplified),
    first and last departure and headway by hour, for weekday, Saturday and Sunday;
  - `tt`, the whole timetable in compact form, so the browser can list next departures
    when the live feed is down. A trip is one of the direction's PATTERNS (the in-box
    stops it serves, each with a run offset in minutes from the first in-box stop; the
    offset is the MEDIAN over the trips of that pattern, so a rush-hour trip can differ
    by a minute or two) plus, per trip, its start time and DEV, the whole minutes by which
    that trip's span from first to last in-box stop differs from the median span (the
    browser stretches the offsets by (span+DEV)/span: this cut the error from a mean of
    1.1 min, p95 4.9, to a mean of 0.3 min, p95 1.2). Times are minutes after the START
    of the service day, so a trip after midnight is 1470 for 00:30. Per pattern the
    list is [pattern, "gap gap/dev gap ..."]: minutes since the previous start (the first
    is the start itself), with "/dev" added when DEV is not 0.
Every number a taste or size decision depends on is a parameter just below.
"""
import collections
import csv
import json
import math
import os
import statistics
import sys
import zipfile

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
OUT = os.path.join(ROOT, "data", "transit-live.json")

# ── parameters ────────────────────────────────────────────────────────────────
# (west, south, east, north): UT campus, West and North Campus, downtown, and East
# Riverside student housing down to Montopolis Dr. Same box is used by the browser.
BBOX = (-97.765, 30.225, -97.700, 30.310)
MIN_ROUTE_STOPS = 6        # a route touching fewer stops than this in BBOX is not kept
                           # (3 kept 50 routes = 175 KB; 6 drops the routes that only brush the box)
SHAPE_TOL_M = 5            # Douglas-Peucker tolerance of the drawn line
SHAPE_MARGIN = 0.002       # degrees: the line is clipped to BBOX grown by this much
COORD_DECIMALS = 5         # about 1 m
MID_MORNING = 10 * 60      # the "mid-morning trip" used for runMin
DEFAULT_DATES = ("20261014", "20261017", "20261018")  # Wed, Sat, Sun in feed 260826_0956
DAY_KEYS = ("wk", "sa", "su")


def tmin(s):
    h, m, sec = s.split(":")
    return int(h) * 60 + int(m) + int(sec) / 60


def hhmm(m):
    m = int(round(m))
    return f"{m // 60:02d}:{m % 60:02d}"


def ymd(d):
    return f"{d[:4]}-{d[4:6]}-{d[6:]}"


def read(z, name):
    import io
    return csv.DictReader(io.TextIOWrapper(z.open(name), encoding="utf-8-sig"))


def long_name(r):
    """'20-Riverside' -> 'Riverside' (the number is already in `short`)."""
    n = r["route_long_name"].strip()
    for sep in ("-", " "):
        if n.startswith(r["route_short_name"] + sep):
            return n[len(r["route_short_name"]) + 1:].strip()
    return n


def inside(lon, lat, grow=0.0):
    w, s, e, n = BBOX
    return w - grow <= lon <= e + grow and s - grow <= lat <= n + grow


def simplify(pts, tol_m):
    """Douglas-Peucker on (lon, lat) points in local metres."""
    if len(pts) < 3:
        return pts
    kx = 111320 * math.cos(math.radians(pts[0][1]))
    xy = [(p[0] * kx, p[1] * 111320) for p in pts]
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = xy[a]
        dx, dy = xy[b][0] - ax, xy[b][1] - ay
        L = math.hypot(dx, dy) or 1e-9
        best, bi = -1, -1
        for i in range(a + 1, b):
            d = abs(dy * (xy[i][0] - ax) - dx * (xy[i][1] - ay)) / L
            if d > best:
                best, bi = d, i
        if best > tol_m:
            keep[bi] = True
            stack.append((a, bi))
            stack.append((bi, b))
    return [p for p, k in zip(pts, keep) if k]


def day_summary(starts):
    """first, last and headway-by-hour from the sorted start minutes at the first stop."""
    if not starts:
        return None
    starts = sorted(starts)
    by_hour = collections.defaultdict(list)
    for a, b in zip(starts, starts[1:]):
        if b > a:
            by_hour[int(a // 60)].append(b - a)
    hw, last = [], None
    for h in range(int(starts[0] // 60), int(starts[-1] // 60) + 1):
        g = by_hour.get(h)
        if g:
            v = int(round(statistics.median(g)))
        elif last is not None:
            v = last          # an hour with a single departure keeps the previous value
        else:
            continue
        if v != last:
            hw.append([h, v])
            last = v
    return {"first": hhmm(starts[0]), "last": hhmm(starts[-1]), "headway": hw}


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    z = zipfile.ZipFile(sys.argv[1])
    dates = tuple(sys.argv[2:5]) if len(sys.argv) >= 5 else DEFAULT_DATES
    feed = next(read(z, "feed_info.txt"))

    service = {}   # date -> set of service ids
    for r in read(z, "calendar_dates.txt"):
        if r["exception_type"] == "1":
            service.setdefault(r["date"], set()).add(r["service_id"])
    day_of = {}    # service id -> list of day keys
    for dk, d in zip(DAY_KEYS, dates):
        if d not in service:
            sys.exit(f"no service on {d} in this feed")
        for sid in service[d]:
            day_of.setdefault(sid, []).append(dk)

    routes = {r["route_id"]: r for r in read(z, "routes.txt")}
    stops_all = {r["stop_id"]: r for r in read(z, "stops.txt")}
    box_stops = {k for k, r in stops_all.items() if inside(float(r["stop_lon"]), float(r["stop_lat"]))}
    trips = {r["trip_id"]: r for r in read(z, "trips.txt") if r["service_id"] in day_of}

    # in-box stop times per trip
    st = collections.defaultdict(list)
    for r in read(z, "stop_times.txt"):
        if r["trip_id"] in trips and r["stop_id"] in box_stops:
            st[r["trip_id"]].append((int(r["stop_sequence"]), r["stop_id"], tmin(r["departure_time"])))

    # group into patterns: (route, dir) -> stops tuple -> [(daykeys, headsign, shape, [times])]
    grp = collections.defaultdict(lambda: collections.defaultdict(list))
    for tid, v in st.items():
        v.sort()
        t = trips[tid]
        key = (t["route_id"], t["direction_id"])
        grp[key][tuple(s for _, s, _ in v)].append((tid, day_of[t["service_id"]], [d for _, _, d in v]))

    kept = {}
    for key, pats in grp.items():
        served = {s for p in pats for s in p}
        if len(served) >= MIN_ROUTE_STOPS:
            kept[key] = pats

    # shapes: the most common weekday shape of each kept (route, dir)
    want_shape = {}
    for key, pats in kept.items():
        cnt = collections.Counter(trips[tid]["shape_id"] for p in pats.values() for tid, dks, _ in p if "wk" in dks)
        want_shape[key] = cnt.most_common(1)[0][0] if cnt else None
    need = {s for s in want_shape.values() if s}
    raw = collections.defaultdict(list)
    for r in read(z, "shapes.txt"):
        if r["shape_id"] in need:
            raw[r["shape_id"]].append((int(r["shape_pt_sequence"]), float(r["shape_pt_lon"]), float(r["shape_pt_lat"])))

    def clip_line(sid):
        pts = [(a, b) for _, a, b in sorted(raw[sid])]
        segs, cur = [], []
        for i, (lo, la) in enumerate(pts):
            if inside(lo, la, SHAPE_MARGIN):
                cur.append((lo, la))
            elif cur:
                segs.append(cur)
                cur = []
        if cur:
            segs.append(cur)
        seg = max(segs, key=len) if segs else []   # one line; a route that leaves and re-enters keeps its longer part
        seg = simplify(seg, SHAPE_TOL_M)
        return [[round(a, COORD_DECIMALS), round(b, COORD_DECIMALS)] for a, b in seg]

    out_routes, used_stops = {}, set()
    for (rid, did), pats in sorted(kept.items()):
        r = routes[rid]
        # main pattern = most common among weekday trips (all trips if there are none)
        def wk_count(p):
            return sum(1 for _, dks, _ in pats[p] if "wk" in dks)
        main = max(pats, key=lambda p: (wk_count(p), len(pats[p])))
        # offsets: median over a pattern's trips, minutes from the first in-box stop
        pat_list, pat_index = [], {}
        starts = {dk: collections.defaultdict(list) for dk in DAY_KEYS}
        mid_trip, mid_gap = None, 1e9
        for p in [main] + [q for q in pats if q != main]:
            offs = []
            for i in range(len(p)):
                offs.append(round(statistics.median(tr[2][i] - tr[2][0] for tr in pats[p]), 1))
            heads = collections.Counter(trips[tr[0]]["trip_headsign"] for tr in pats[p])
            pat_index[p] = len(pat_list)
            head = heads.most_common(1)[0][0]
            short = routes[rid]["route_short_name"]
            if head.startswith(short + " "):       # "20 University of Texas NB" -> "University of Texas NB"
                head = head[len(short) + 1:]
            pat_list.append({"s": None if p == main else list(p), "o": offs, "h": head})
            for tid, dks, ts in pats[p]:
                for dk in dks:
                    span = ts[-1] - ts[0]
                    dev = int(round(span - offs[-1])) if offs[-1] > 0 else 0
                    starts[dk][pat_index[p]].append((round(ts[0]), dev))
                if p == main and "wk" in dks and abs(ts[0] - MID_MORNING) < mid_gap:
                    mid_gap, mid_trip = abs(ts[0] - MID_MORNING), ts
        for p in pats:
            used_stops.update(p)
        tt = {}
        for dk in DAY_KEYS:
            lst = []
            for pi in sorted(starts[dk]):
                a = sorted(starts[dk][pi])
                toks, prev = [], 0
                for s0, dev in a:           # "gap" from the previous start, "gap/dev" when DEV is not 0
                    toks.append(str(s0 - prev) + (f"/{dev}" if dev else ""))
                    prev = s0
                lst.append([pi, " ".join(toks)])
            if lst:
                tt[dk] = lst
        first_stop = main[0]
        d = {
            "dir": int(did),
            "headsign": pat_list[0]["h"],
            "stops": list(main),
            "runMin": [round(x - mid_trip[0], 1) for x in mid_trip] if mid_trip else pat_list[0]["o"],
            "shape": clip_line(want_shape[(rid, did)]) if want_shape[(rid, did)] else [],
        }
        for dk, name in (("wk", None), ("sa", "sat"), ("su", "sun")):
            s = [x for p, pl in pats.items() for tid, dks, ts in pl if dk in dks and p[0] == first_stop for x in [ts[0]]]
            # departures at the first listed stop: trips of any pattern that serves it first
            s += [ts[p.index(first_stop)] for p, pl in pats.items() if p[0] != first_stop and first_stop in p
                  for tid, dks, ts in pl if dk in dks]
            summ = day_summary(s)
            if summ:
                if name:
                    d[name] = summ
                else:
                    d.update(summ)
        d["pats"] = pat_list
        d["tt"] = tt
        entry = out_routes.setdefault(rid, {
            "short": r["route_short_name"], "name": long_name(r),
            "color": "#" + (r["route_color"] or "004A97").lower(), "dirs": []})
        entry["dirs"].append(d)

    stops_out = {s: [stops_all[s]["stop_name"], round(float(stops_all[s]["stop_lat"]), COORD_DECIMALS),
                     round(float(stops_all[s]["stop_lon"]), COORD_DECIMALS)] for s in sorted(used_stops, key=lambda x: (len(x), x))}
    doc = {
        "version": 1,
        "feed": {"version": feed["feed_version"], "from": ymd(feed["feed_start_date"]), "to": ymd(feed["feed_end_date"]),
                 "serviceDate": ymd(dates[0]), "saturday": ymd(dates[1]), "sunday": ymd(dates[2])},
        "bbox": list(BBOX),
        "credit": "Transit data: Capital Metropolitan Transportation Authority (CapMetro), via data.texas.gov",
        "stops": stops_out,
        "routes": dict(sorted(out_routes.items(), key=lambda kv: (len(kv[0]), kv[0]))),
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(doc, f, separators=(",", ":"), ensure_ascii=False)
        f.write("\n")
    size = os.path.getsize(OUT)
    print(f"wrote {OUT}: {size} bytes, {len(out_routes)} routes, {len(stops_out)} stops")

    # how far the stored offsets (median, stretched by the per-trip DEV) sit from the real trips
    errs = []
    for key, pats in kept.items():
        for p, pl in pats.items():
            offs = [statistics.median(tr[2][i] - tr[2][0] for tr in pl) for i in range(len(p))]
            for tr in pl:
                span = tr[2][-1] - tr[2][0]
                k = (offs[-1] + int(round(span - offs[-1]))) / offs[-1] if offs[-1] > 0 else 1
                errs.extend(abs((tr[2][i] - tr[2][0]) - round(offs[i], 1) * k) for i in range(len(p)))
    errs.sort()
    print(f"offset error vs real trips: mean {sum(errs)/len(errs):.2f} min, p95 {errs[int(len(errs)*.95)]:.2f}, max {errs[-1]:.1f}")


if __name__ == "__main__":
    main()
