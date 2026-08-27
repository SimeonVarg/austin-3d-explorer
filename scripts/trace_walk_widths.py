#!/usr/bin/env python
"""trace_walk_widths.py -- how wide is each walk, measured off a real survey.

OWNS `data/walkway_widths.json` AND NOTHING ELSE.  `scripts/bake_ground.py`
reads that file; nothing else writes it.

THE DEFECT THIS EXISTS TO FIX.  `DEFAULT_WIDTH` in `scripts/bake_ground.py` is
marked GENERATIVE and reads `footway 2.4, steps 3.0, path 1.5, pedestrian 6.0`.
Measured: **0 of 3,098 campus footways in `data/osm_cache/footways.json`
carries a `width` tag** -- not a few, none.  So every walk in the city, from a
1 m service alley behind a dorm to a 10 m mall approach, is drawn as the same
2.4 m ribbon.  That is the facade-template defect one system over: uniform
geometry standing in for real variation.

WHY NOT THE PHOTOGRAPH.  `docs/walkways-on-the-real-paths.md` s6b tried, and
the measurement that says it cannot work is worth keeping: the aggregate
perpendicular profile of 8,822 stations along every campus footway, sampled
every 15 cm out to 7.8 m either side of NAIP orthoimagery at 0.30 m/px, is
FLAT.  Normalised green does not change from the centreline to eight metres
off it.  The reason is not the instrument -- most campus footways are not
bordered by turf at all.  They sit inside continuous paved courts or under
live oak, and there is no pavement/grass edge to find.

WHAT THIS USES INSTEAD.  The City of Austin's PLANIMETRIC IMPERVIOUS-SURFACE
layer: real digitised polygons of the actual paved surface, one per slab,
each carrying the year of the orthoimagery it was traced off.  It is a survey,
not a picture -- so canopy does not hide it, and a 1.5 m walk is a 1.5 m
polygon rather than five pixels.  City of Austin open data is public domain.

THE RULE, and it is deliberately small.  Station the OSM centreline every
WIDTH_STATION_M metres; at each station march perpendicular in both
directions until the surveyed pavement ends.  A station only counts if BOTH
marches found an edge inside WIDTH_HALF_MAX_M -- inside a continuous paved
court there IS no edge, the court is the surface, and this file must not
invent a corridor width for it.  The way's width is the MEDIAN of its counted
stations.

WHAT THIS FILE MAY AND MAY NOT SAY.  It may say "this walk is 1.4 m wide".
It may NOT say "there is no walk here".  46.7 % of ways get no measurement,
and the reason is NOT that the walk is imaginary: the city's planimetric
mapping is INCOMPLETE OVER UT'S INTERIOR CAMPUS.  Two off-pavement cases were
put to NAIP and looked at -- ways 1317394733 and 129347372 -- and in both the
photograph shows a wide, obviously paved court under the line while the city
layer maps nothing there at all (see docs/walkways-widths.md).  So this is a
strictly OPT-IN evidence file, exactly like the entrance survey in
`bake_entrances.py`: a way with no row keeps `DEFAULT_WIDTH` and is marked
unsourced.  Nothing here is ever used to narrow, move or delete a path.
"""

import argparse
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

OUT_REL = "data/walkway_widths.json"
CACHE = os.path.join(ROOT, "data", "gis_cache")

# --------------------------------------------------------------------------
# TASTE AND MODEL CONSTANTS -- every judgement in this script is one line
# here.  CLAUDE.md rule 11.  Nothing below this block hard-codes a number.
# --------------------------------------------------------------------------

# ---- the survey ----------------------------------------------------------
IMPERV_URL = ("https://services.arcgis.com/0L95CJ0VTaxqcmED/ArcGIS/rest/"
              "services/impervious_cover_2023/FeatureServer/0/query")
IMPERV_LICENCE = ("City of Austin open GIS (impervious_cover_2023). "
                  "Public domain: the City publishes its open data "
                  "free and without restriction.")
# The FEATURE classes that are a WALKING surface.  `Paved Parking`,
# `Paved Road`, `Paved Driveway` and `Bridge` are deliberately NOT here: a
# footway crossing a car park is on pavement, but the car park's width is not
# the walk's width, and measuring it would be worse than not measuring.
WALK_FEATURES = ("Sidewalk", "Pavement", "Courtyard", "Trail")
# Fetched over the bounding box of data/osm_cache/footways.json itself, grown
# by this much, so the survey cannot run out before the walks do.
FETCH_PAD_DEG = 0.0015
PAGE = 1000                 # the service's own maxRecordCount is 2000

# ---- the measurement -----------------------------------------------------
WIDTH_STATION_M = 4.0       # spacing of stations along a way
WIDTH_TRIM_M = 2.0          # ignored at each end: a junction is a blob
WIDTH_HALF_MAX_M = 6.0      # look this far each side; further is a court
WIDTH_STEP_M = 0.20         # march step out from the centreline
WIDTH_BISECT_M = 0.05       # then bisect the last step to this

# ---- what is allowed to reach the bake -----------------------------------
WIDTH_MIN_EDGED = 0.60      # share of stations that must find BOTH edges
WIDTH_MIN_STATIONS = 2      # and at least this many of them
WIDTH_MIN_LEN_M = 6.0       # shorter ways are junction stubs
WIDTH_MIN_M = 0.90          # narrower than this is a digitising sliver
WIDTH_MAX_M = 12.0          # wider than this is a plaza wearing a walk's name
WIDTH_ROUND_M = 0.05        # what gets written out

# ---- the local frame -----------------------------------------------------
LAT0, LON0 = 30.285, -97.738
MPD_LAT = 110574.0
MPD_LON = 111320.0 * math.cos(math.radians(LAT0))


def P(*a):
    print(*a, flush=True)


def xy(lon, lat):
    return ((lon - LON0) * MPD_LON, (lat - LAT0) * MPD_LAT)


# --------------------------------------------------------------------------
# the survey
# --------------------------------------------------------------------------
def footway_bbox():
    """(w, s, e, n) of data/osm_cache/footways.json, padded."""
    els = json.load(open(os.path.join(ROOT, "data", "osm_cache",
                                      "footways.json"),
                         "r", encoding="utf-8"))["elements"]
    la = [p["lat"] for e in els for p in e.get("geometry", [])]
    lo = [p["lon"] for e in els for p in e.get("geometry", [])]
    if not la:
        raise SystemExit("footways.json has no geometry")
    return (min(lo) - FETCH_PAD_DEG, min(la) - FETCH_PAD_DEG,
            max(lo) + FETCH_PAD_DEG, max(la) + FETCH_PAD_DEG)


def fetch_survey(bbox, verbose=True):
    """Every walking-surface polygon over the footway bbox, cached on disk."""
    os.makedirs(CACHE, exist_ok=True)
    w, s, e, n = bbox
    fn = os.path.join(CACHE, "austin_imperv_walk_%.4f_%.4f_%.4f_%.4f.json"
                      % (w, s, e, n))
    if os.path.exists(fn):
        return json.load(open(fn, "r", encoding="utf-8")), fn
    where = "FEATURE IN (%s)" % ",".join("'%s'" % f for f in WALK_FEATURES)
    feats, off = [], 0
    while True:
        q = dict(geometry="%s,%s,%s,%s" % (w, s, e, n),
                 geometryType="esriGeometryEnvelope", inSR=4326, outSR=4326,
                 spatialRel="esriSpatialRelIntersects", where=where,
                 outFields="OBJECTID,FEATURE,SOURCE", returnGeometry="true",
                 resultOffset=off, resultRecordCount=PAGE, f="geojson")
        url = IMPERV_URL + "?" + urllib.parse.urlencode(q)
        last = None
        for attempt in range(4):
            try:
                d = json.loads(urllib.request.urlopen(url, timeout=240).read()
                               .decode("utf-8"))
                last = None
                break
            except Exception as exc:                       # noqa: BLE001
                last = exc
                time.sleep(3)
        if last is not None:
            raise SystemExit("Austin GIS fetch failed: %s" % last)
        got = d.get("features", [])
        feats += got
        if verbose:
            P("  fetched %d (total %d)" % (len(got), len(feats)))
        if len(got) < PAGE:
            break
        off += PAGE
    out = {"query": {"url": IMPERV_URL, "bbox": [w, s, e, n],
                     "where": where, "licence": IMPERV_LICENCE,
                     "fetched": time.strftime("%Y-%m-%d")},
           "features": feats}
    json.dump(out, open(fn, "w", encoding="utf-8"))
    return out, fn


class Pavement:
    """Point-in-any-surveyed-paved-polygon, on a uniform grid index."""

    CELL = 24.0

    def __init__(self, features):
        self.polys = []
        for f in features:
            g = f.get("geometry") or {}
            t, c = g.get("type"), g.get("coordinates")
            if not c:
                continue
            parts = [c] if t == "Polygon" else (c if t == "MultiPolygon" else [])
            for part in parts:
                rings = [[xy(p[0], p[1]) for p in r] for r in part if len(r) >= 4]
                if rings:
                    self.polys.append(rings)
        self.grid, self.bbox = {}, {}
        for i, rings in enumerate(self.polys):
            xs = [p[0] for p in rings[0]]
            ys = [p[1] for p in rings[0]]
            bb = (min(xs), max(xs), min(ys), max(ys))
            self.bbox[i] = bb
            for cx in range(int(bb[0] // self.CELL), int(bb[1] // self.CELL) + 1):
                for cy in range(int(bb[2] // self.CELL), int(bb[3] // self.CELL) + 1):
                    self.grid.setdefault((cx, cy), []).append(i)

    @staticmethod
    def _pip(ring, x, y):
        inside = False
        n = len(ring)
        j = n - 1
        for i in range(n):
            xi, yi = ring[i]
            xj, yj = ring[j]
            if (yi > y) != (yj > y):
                if x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                    inside = not inside
            j = i
        return inside

    def paved(self, x, y):
        for i in self.grid.get((int(x // self.CELL), int(y // self.CELL)), ()):
            x0, x1, y0, y1 = self.bbox[i]
            if not (x0 <= x <= x1 and y0 <= y <= y1):
                continue
            rings = self.polys[i]
            if self._pip(rings[0], x, y) and not any(
                    self._pip(h, x, y) for h in rings[1:]):
                return True
        return False


# --------------------------------------------------------------------------
# the measurement
# --------------------------------------------------------------------------
# `--selftest --break` sets this.  The sabotage is the defect itself: the
# marcher stops at a fixed half-width instead of at the surveyed edge, so every
# walk comes out 2.4 m wide -- which is exactly what the city draws today.
BREAK_HALF_M = None


def march(pv, px, py, dx, dy, half, step=None):
    """(distance to the edge of the pavement, did we actually find one)."""
    if BREAK_HALF_M is not None:
        return BREAK_HALF_M, True
    step = step or WIDTH_STEP_M
    last, d = 0.0, step
    while d <= half:
        if not pv.paved(px + dx * d, py + dy * d):
            lo, hi = last, d
            while hi - lo > WIDTH_BISECT_M:
                mid = (lo + hi) / 2.0
                if pv.paved(px + dx * mid, py + dy * mid):
                    lo = mid
                else:
                    hi = mid
            return lo, True
        last, d = d, d + step
    return half, False


def stations(pts, spacing=WIDTH_STATION_M, trim=WIDTH_TRIM_M):
    """[(x, y, normal_x, normal_y)], plus the way's length in metres."""
    segs, tot = [], 0.0
    for a, b in zip(pts, pts[1:]):
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        if L > 0:
            segs.append((a, b, L, tot))
            tot += L
    if tot <= 0:
        return [], 0.0
    if tot <= 2 * trim + 0.5:
        ss = [tot / 2.0]
    else:
        span = tot - 2 * trim
        n = max(2, int(span // spacing) + 1)
        ss = [trim + i * span / (n - 1) for i in range(n)]
    out = []
    for s in ss:
        for (a, b, L, s0) in segs:
            if s <= s0 + L or (a, b, L, s0) is segs[-1]:
                t = (s - s0) / L
                out.append((a[0] + (b[0] - a[0]) * t,
                            a[1] + (b[1] - a[1]) * t,
                            -(b[1] - a[1]) / L, (b[0] - a[0]) / L))
                break
    return out, tot


def measure_way(pv, pts, half=WIDTH_HALF_MAX_M, step=None):
    """Every station's width, and how the ones that failed failed."""
    st, tot = stations(pts)
    edged, on = [], 0
    for (px, py, nx, ny) in st:
        if not pv.paved(px, py):
            continue
        on += 1
        left, hitl = march(pv, px, py, nx, ny, half, step)
        right, hitr = march(pv, px, py, -nx, -ny, half, step)
        if hitl and hitr:
            edged.append(left + right)
    n = len(st) or 1
    edged.sort()
    return {
        "n": len(st), "onpave": on / n, "edged": len(edged) / n,
        "w": (edged[len(edged) // 2] if len(edged) % 2
              else (edged[len(edged) // 2 - 1] + edged[len(edged) // 2]) / 2.0)
             if edged else None,
        "lo": edged[len(edged) // 4] if edged else None,
        "hi": edged[3 * len(edged) // 4] if edged else None,
        "len": tot,
    }


def accept(m):
    """The one place a measurement becomes a number the bake may draw."""
    if m["w"] is None:
        return False, "no station found an edge on both sides"
    if m["len"] < WIDTH_MIN_LEN_M:
        return False, "shorter than WIDTH_MIN_LEN_M"
    if m["edged"] * m["n"] < WIDTH_MIN_STATIONS:
        return False, "fewer than WIDTH_MIN_STATIONS counted stations"
    if m["edged"] < WIDTH_MIN_EDGED:
        return False, "under WIDTH_MIN_EDGED of stations found both edges"
    if m["w"] < WIDTH_MIN_M:
        return False, "narrower than WIDTH_MIN_M"
    if m["w"] > WIDTH_MAX_M:
        return False, "wider than WIDTH_MAX_M -- a court, not a walk"
    return True, ""


# --------------------------------------------------------------------------
# the gate, watchable failing
# --------------------------------------------------------------------------
class _Rect:
    """A hand-built pavement: axis-aligned slabs of a width we chose."""

    def __init__(self, slabs):
        self.slabs = slabs

    def paved(self, x, y):
        return any(x0 <= x <= x1 and y0 <= y <= y1
                   for (x0, x1, y0, y1) in self.slabs)


def selftest(pv, broken=False):
    """Four assertions on geometry whose answer is known by construction, and
    three on real campus walks whose answer was read off the photograph.

    `--break` makes the marcher stop at a fixed 1.2 m either side instead of
    at the surveyed edge -- i.e. it reinstates the 2.4 m template this file
    exists to remove -- and the gate must come back red.  A gate that cannot
    be watched failing is decoration.
    """
    global BREAK_HALF_M
    BREAK_HALF_M = 1.2 if broken else None
    half = WIDTH_HALF_MAX_M
    ok = []

    for want in (1.5, 2.4, 6.0):
        slab = _Rect([(-100.0, 100.0, -want / 2.0, want / 2.0)])
        m = measure_way(slab, [(-40.0, 0.0), (40.0, 0.0)], half=half)
        got = m["w"]
        good = got is not None and abs(got - want) <= 0.15
        ok.append(good)
        P("  a %.1f m slab measures %s                       %s"
          % (want, ("%.2f m" % got) if got is not None else "nothing",
             "ok" if good else "FAIL"))

    # A walk inside a court has no edge, and the answer must be "no answer".
    court = _Rect([(-100.0, 100.0, -100.0, 100.0)])
    m = measure_way(court, [(-40.0, 0.0), (40.0, 0.0)], half=half)
    ok.append(m["w"] is None)
    P("  a walk inside a 200 m paved court measures %-13s %s"
      % ("nothing" if m["w"] is None else "%.2f m" % m["w"],
         "ok" if m["w"] is None else "FAIL"))

    if pv is not None:
        els = load_ways()
        for wid, lo, hi, why in SELFTEST_WAYS:
            e = els.get(wid)
            if e is None:
                ok.append(False)
                P("  way %-12s MISSING from footways.json          FAIL" % wid)
                continue
            m = measure_way(pv, [xy(p["lon"], p["lat"]) for p in e["geometry"]],
                            half=half)
            got = m["w"]
            good = got is not None and lo <= got <= hi
            ok.append(good)
            P("  way %-12s %-26s %s in [%.1f, %.1f]  %s"
              % (wid, why, ("%.2f m" % got) if got is not None else "nothing",
                 lo, hi, "ok" if good else "FAIL"))

    bad = sum(1 for x in ok if not x)
    if broken:
        P("  --break: %d of %d assertions went red, as they must" % (bad, len(ok)))
        return bad > 0
    P("  PASS" if bad == 0 else "  FAIL -- %d assertion(s)" % bad)
    return bad == 0


# Three real campus walks whose width was read off NAIP orthoimagery at
# 0.30 m/px with the transect drawn on the picture, 2026-08-27.  The bands are
# wide on purpose: they are a check that this file has not drifted into
# nonsense, not a claim of centimetre accuracy.
SELFTEST_WAYS = [
    ("1020963716", 1.1, 1.9, "a narrow walk by a car park"),
    ("129347386", 2.0, 2.9, "an ordinary campus walk"),
    ("1199982735", 4.4, 6.6, "a walk on a wide paved apron"),
]


def load_ways():
    els = json.load(open(os.path.join(ROOT, "data", "osm_cache",
                                      "footways.json"),
                         "r", encoding="utf-8"))["elements"]
    return {str(e["id"]): e for e in els if len(e.get("geometry") or []) >= 2}


# --------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", action="store_true",
                    help="measure and print, write nothing")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--break", dest="brk", action="store_true",
                    help="with --selftest: sabotage the marcher; must go red")
    a = ap.parse_args()

    P("scripts/trace_walk_widths.py")
    bbox = footway_bbox()
    P("  footway bbox %.5f,%.5f .. %.5f,%.5f" % bbox)
    survey, cache_file = fetch_survey(bbox, verbose=not a.selftest)
    pv = Pavement(survey["features"])
    P("  %d surveyed walking-surface polygons  (%s)"
      % (len(pv.polys), os.path.basename(cache_file)))

    if a.selftest:
        P("")
        ok = selftest(pv, broken=a.brk)
        sys.exit(0 if ok else 1)

    ways = load_ways()
    P("  %d OSM ways in data/osm_cache/footways.json" % len(ways))

    rows, why = {}, {}
    t0 = time.time()
    for wid, e in ways.items():
        m = measure_way(pv, [xy(p["lon"], p["lat"]) for p in e["geometry"]])
        good, reason = accept(m)
        if good:
            rows[wid] = {
                "w": round(m["w"] / WIDTH_ROUND_M) * WIDTH_ROUND_M,
                "n": int(round(m["edged"] * m["n"])),
                "lo": round(m["lo"], 2), "hi": round(m["hi"], 2),
                "len": round(m["len"], 1),
                "hw": (e.get("tags") or {}).get("highway"),
            }
        else:
            key = reason
            if m["onpave"] < 0.5:
                key = ("the city's survey maps no walking surface under it "
                       "(a COVERAGE gap, not a missing walk)")
            why[key] = why.get(key, 0) + 1
    P("  measured %d ways in %.0f s" % (len(ways), time.time() - t0))

    drawn = sum(r["len"] for r in rows.values())
    total = sum(measure_len(e) for e in ways.values())
    hist = {}
    for r in rows.values():
        hist[round(r["w"] * 2) / 2.0] = hist.get(round(r["w"] * 2) / 2.0, 0) + 1

    out = {
        "_what": ("Per-OSM-way walking-surface width in metres, measured off "
                  "the City of Austin's planimetric impervious-surface survey. "
                  "OPT-IN: a way with no row here keeps bake_ground.py's "
                  "DEFAULT_WIDTH. A missing row NEVER means 'no walk here' -- "
                  "the city's survey does not cover all of UT's interior."),
        "generated": time.strftime("%Y-%m-%d"),
        "source": {"url": IMPERV_URL, "layer": "impervious_cover_2023",
                   "features": list(WALK_FEATURES),
                   "polygons": len(pv.polys),
                   "bbox": list(bbox), "licence": IMPERV_LICENCE,
                   "fetched": survey["query"]["fetched"]},
        "params": {k: v for k, v in sorted(globals().items())
                   if k.startswith("WIDTH_")},
        "stats": {"ways": len(ways), "measured": len(rows),
                  "metres_total": round(total), "metres_measured": round(drawn),
                  "not_measured": dict(sorted(why.items(), key=lambda kv: -kv[1]))},
        "widths": dict(sorted(rows.items(), key=lambda kv: int(kv[0]))),
    }

    P("")
    P("  %d of %d ways measured  (%.0f%%)  --  %d m of %d m of drawn walk"
      % (len(rows), len(ways), 100.0 * len(rows) / len(ways), drawn, total))
    for k, v in sorted(why.items(), key=lambda kv: -kv[1]):
        P("     %5d  %s" % (v, k))
    P("")
    P("  width, 0.5 m bins:")
    for k in sorted(hist):
        P("     %5.1f m  %s %d" % (k, "#" * min(60, hist[k] // 4), hist[k]))
    ws = sorted(r["w"] for r in rows.values())
    if ws:
        P("  p10 %.1f  p25 %.1f  median %.1f  p75 %.1f  p90 %.1f  max %.1f m"
          % (ws[len(ws) // 10], ws[len(ws) // 4], ws[len(ws) // 2],
             ws[3 * len(ws) // 4], ws[9 * len(ws) // 10], ws[-1]))
        off = sum(1 for w in ws if abs(w - 2.4) > 0.5)
        P("  %d of %d (%.0f%%) are more than 0.5 m from the 2.4 m default"
          % (off, len(ws), 100.0 * off / len(ws)))

    if a.report:
        P("\n  --report: nothing written")
        return
    path = os.path.join(ROOT, OUT_REL.replace("/", os.sep))
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(out, fh, indent=1, sort_keys=False)
        fh.write("\n")
    P("\n  wrote %s  (%.1f KB)" % (OUT_REL, os.path.getsize(path) / 1024.0))


def measure_len(e):
    pts = [xy(p["lon"], p["lat"]) for p in e["geometry"]]
    return sum(math.hypot(b[0] - a[0], b[1] - a[1])
               for a, b in zip(pts, pts[1:]))


if __name__ == "__main__":
    main()
