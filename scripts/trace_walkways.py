# -*- coding: utf-8 -*-
"""trace_walkways.py -- check the campus walking network against a real
aerial photograph, and write down what the photograph confirms.

This script owns data/walkway_evidence.json and nothing else writes it
(CLAUDE.md rule 1).  It invents NO geometry: every line it can emit already
has both endpoints in the OSM walking network, and all this file does is say
whether the ground BETWEEN two of those points is walkable in the
photograph.  A line the photograph cannot confirm is not written.

WHY IT EXISTS.  scripts/bake_walk.py puts a `highway=pedestrian area=yes`
way into the graph as a ring of edges -- the OUTLINE of a plaza and nothing
across the middle.  docs/walk/graph.md 10 accepted that for v1 and
docs/walk-sidewalks.md 6 measured it as the biggest thing left:

    "a door in the middle of the East Mall frontage projects sixteen metres
     sideways to the nearest rim ... PCL->UNB walks 1,058 m for a 449 m
     straight line"

So the router walks students AROUND the South Mall rather than down it.
The fix needs one fact this repo did not have: is the middle of each of
those 41 rings actually a continuous walkable surface, or is it a lawn with
a path round the edge?  That is a question for a photograph.

TWO THINGS IT LOOKS FOR
  A. PLAZA CHORDS.  Every straight line between two vertices of the same
     pedestrian-area ring that stays inside the ring, misses every building
     and every carriageway, and SAVES real walking against going round.
     Confirmed only if the photograph shows no run of open grass along it.
  B. DESIRE PATHS.  Straight lines between two existing network nodes that
     are far apart on the network and close in the air -- the shortcuts
     students actually take.  Confirmed only if the photograph shows an
     unbroken worn or paved streak the whole way.  A candidate that shows
     open grass is REJECTED and counted, never emitted "because people
     probably walk there".

THE ORACLE is USGS NAIP orthoimagery -- a real aerial photograph, U.S.
federal government work, public domain, and NOT derived from OSM, so it can
disagree with the map.  It is fetched at the source's own native ground
sample distance (0.30 m/px, `pixelSizeX` off the service's own metadata);
the fixture campusmeter.mjs already carries is the same imagery at 1.55 m/px
-- five times coarser than the source offers, and too coarse to see a walk.
The tiles land in data/imagery_cache/, which .gitignore already covers: they
are a regenerable input, and this file records the exact query.

Usage:
    python scripts/trace_walkways.py              # fetch, measure, write
    python scripts/trace_walkways.py --report     # measure, print, write nothing
    python scripts/trace_walkways.py --sheet DIR  # labelled crops to look at
"""
import argparse
import json
import math
import os
import re
import statistics
import sys
import time
import urllib.request

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bake_walk as BW  # noqa: E402  -- the graph, the obstacles, the geometry

OUT_REL = "data/walkway_evidence.json"
CACHE = os.path.join(ROOT, "data", "imagery_cache", "naip")

# --------------------------------------------------------------------------
# TASTE AND MODEL CONSTANTS -- every judgement in this script is one line
# here.  CLAUDE.md rule 11.  Nothing below this block hard-codes a number.
# --------------------------------------------------------------------------

NAIP_URL = ("https://imagery.nationalmap.gov/arcgis/rest/services/"
            "USGSNAIPPlus/ImageServer/exportImage")
NAIP_GSD_M = 0.30          # the service's own pixelSizeX, not a guess
NAIP_TILE_MAX_PX = 3600    # the service caps a request at 4000; stay under it
NAIP_LICENCE = "USGS/USDA NAIP: U.S. federal government work, public domain."

# The same local frame bake_walk.py uses, imported rather than restated so
# the two cannot disagree about a metre.
MPD_LAT = BW.MPD_LAT
MPD_LON = BW.MPD_LON

# ---- the surface test ----------------------------------------------------
# Normalised green, g/(r+g+b).  Chosen over excess green (2G-R-B) because it
# is invariant to exposure: a shaded walk and a sunlit walk have the same
# normalised green and very different excess green, and this campus is under
# live oak for much of its length.  Measured on the imagery itself:
#   the 41 drawn plaza RIMS, 1 m sampling      median 0.333 - 0.344
#   a hand transect across the South Mall      pavement 0.337, turf 0.387
# so the split is wide and the threshold sits in the gap, nearer the turf.
NG_GRASS = 0.370
# Two more numbers keep canopy out of the answer.  Live oak in this imagery
# is DARK and only mildly green; open turf is bright and strongly green.
# Refusing a line for canopy would refuse the middle of the Main Mall, which
# is exactly the line this script exists to confirm.
NG_CANOPY_MAX_LUMA = 105.0   # below this it is shade, and shade is not turf
SAMPLE_STEP_M = 1.0

# A line is refused when the photograph shows this many CONSECUTIVE metres of
# open turf under it.  One metre is a mown edge beside a walk; four is a lawn.
VEG_RUN_REJECT_M = 4.0

# ---- A. plaza chords -----------------------------------------------------
PLAZA_HIGHWAY = "pedestrian"
PLAZA_MIN_AREA_M2 = 200.0      # smaller than this and the rim IS the plaza
CHORD_MIN_M = 8.0              # shorter than this the rim costs nothing
CHORD_MIN_GAIN_M = 10.0        # metres saved against walking round the rim
CHORD_INSIDE_STEP_M = 2.0      # how finely a chord is tested for staying in

# ---- B. desire paths -----------------------------------------------------
# A candidate is a pair of EXISTING network nodes that the network makes you
# walk a long way between while they are close in the air.  Both bounds
# matter: under the low one the shortcut saves nothing; over the high one the
# straight line is long enough to be crossing something (a building court, a
# creek) rather than cutting the corner of a lawn.
DESIRE_MIN_M = 12.0
DESIRE_MAX_M = 70.0
DESIRE_MIN_RATIO = 1.8         # network distance / straight-line distance
DESIRE_MIN_GAIN_M = 25.0       # metres saved, so 2x on an 8 m hop does not count
DESIRE_SEARCH_R_M = 80.0       # how far apart two candidate ends may be
DESIRE_MAX_CAND = 20000        # a cap, so a bad constant cannot run all night
# Two candidates that start and end within this of each other are the same
# shortcut across the same corner; the higher-gain one is kept.
DESIRE_DEDUPE_M = 10.0

# WHAT A DESIRE PATH LOOKS LIKE FROM ABOVE, and why the test is RELATIVE.
#
# The first version of this test asked "is the line free of turf", and it
# confirmed 247 lines out of 4,000 while refusing only 22 -- which is not a
# test, it is a rubber stamp.  The reason is that an absolute turf call
# cannot separate shaded grass from a shaded walk, and this campus is under
# live oak: measured on the intramural fields, a line straight across 67 m of
# open turf came back with only 8 m of it called turf, because the rest was
# in shade.
#
# A desire path is not "a line without grass on it".  It is a WORN STREAK
# THROUGH A LAWN: the ground either side of it is vegetation and the line
# itself is not.  That is a relative test, it needs no exposure calibration,
# and it is the shape of the thing rather than a property of one pixel.  So:
#   the FLANKS, DESIRE_FLANK_M either side, must read as vegetation, and
#   the LINE must read as surface over DESIRE_WORN_FRAC of its length.
# A candidate whose flanks are pavement is not a desire path at all -- it is
# a missing link in a paved court, which is a different claim needing a
# different justification, and this file does not make it.
DESIRE_FLANK_M = 3.0
DESIRE_WORN_FRAC = 0.75        # share of the line that must read as surface
DESIRE_FLANK_FRAC = 0.60       # share of the flanks that must read as veg
NG_PAVE = 0.350                # at or below this a pixel reads as surface

# ---- the contact sheet ---------------------------------------------------
SHEET_MAX = 40
SHEET_PAD_M = 14.0
SHEET_SCALE = 3


def P(*a):
    print(*a, flush=True)


# --------------------------------------------------------------------------
# the photograph
# --------------------------------------------------------------------------
def campus_bbox():
    """(s, w, n, e), read live out of scripts/bake_entrances.py's CAMPUS, so
    this file and campusmeter.mjs cannot drift about where campus is."""
    src = open(os.path.join(ROOT, "scripts", "bake_entrances.py"),
               "r", encoding="utf-8").read()
    m = re.search(r"CAMPUS = \(([-\d.]+), ([-\d.]+), ([-\d.]+), ([-\d.]+)\)", src)
    if not m:
        raise SystemExit("CAMPUS not found in scripts/bake_entrances.py")
    return tuple(float(x) for x in m.groups())


class Aerial:
    """The NAIP mosaic, fetched at the source's own 0.30 m/px and cached."""

    def __init__(self, s, w, n, e, verbose=True):
        os.makedirs(CACHE, exist_ok=True)
        self.tiles = []
        wide = int(math.ceil((e - w) * MPD_LON / NAIP_GSD_M / NAIP_TILE_MAX_PX))
        tall = int(math.ceil((n - s) * MPD_LAT / NAIP_GSD_M / NAIP_TILE_MAX_PX))
        self.query = dict(url=NAIP_URL, bboxSR=4326, imageSR=4326,
                          format="jpgpng", gsd_m=NAIP_GSD_M,
                          bbox=[w, s, e, n], grid=[wide, tall],
                          licence=NAIP_LICENCE)
        for iy in range(tall):
            for ix in range(wide):
                tw = w + (e - w) * ix / wide
                te = w + (e - w) * (ix + 1) / wide
                ts = s + (n - s) * iy / tall
                tn = s + (n - s) * (iy + 1) / tall
                px = int(round((te - tw) * MPD_LON / NAIP_GSD_M))
                py = int(round((tn - ts) * MPD_LAT / NAIP_GSD_M))
                fn = os.path.join(
                    CACHE, "naip_%.5f_%.5f_%.5f_%.5f_%dx%d.jpg"
                    % (tw, ts, te, tn, px, py))
                if not os.path.exists(fn):
                    url = ("%s?bbox=%s,%s,%s,%s&bboxSR=4326&size=%d,%d"
                           "&imageSR=4326&format=jpgpng&f=image"
                           % (NAIP_URL, tw, ts, te, tn, px, py))
                    if verbose:
                        P("  fetching %d x %d px over %.4f,%.4f .. %.4f,%.4f"
                          % (px, py, tw, ts, te, tn))
                    urllib.request.urlretrieve(url, fn)
                    time.sleep(0.4)
                im = Image.open(fn).convert("RGB")
                self.tiles.append(dict(w=tw, s=ts, e=te, n=tn,
                                       W=im.size[0], H=im.size[1],
                                       im=im, px=im.load(),
                                       file=os.path.basename(fn)))
        self.misses = 0

    def rgb(self, lon, lat):
        for t in self.tiles:
            if t["w"] <= lon <= t["e"] and t["s"] <= lat <= t["n"]:
                x = int((lon - t["w"]) / (t["e"] - t["w"]) * t["W"])
                y = int((t["n"] - lat) / (t["n"] - t["s"]) * t["H"])
                x = min(t["W"] - 1, max(0, x))
                y = min(t["H"] - 1, max(0, y))
                return t["px"][x, y]
        self.misses += 1
        return None

    def is_open_turf(self, lon, lat):
        """True where the photograph shows sunlit grass.

        Deliberately NOT "not pavement": shade and canopy are excluded, so a
        walk under a live oak reads as walkable, which it is.  The failure
        this buys is that a SHADED lawn also reads as walkable -- stated
        here rather than hidden, and it is the conservative direction for a
        script whose job is to refuse things."""
        c = self.rgb(lon, lat)
        if c is None:
            return None
        r, g, b = c
        s = r + g + b + 1e-9
        if (r + g + b) / 3.0 < NG_CANOPY_MAX_LUMA:
            return False
        return (g / s) >= NG_GRASS


def turf_run_m(air, lon0, lat0, lon1, lat1):
    """Longest unbroken run of open turf under a line, in metres.

    Returns (run_m, samples, unknown).  A point the mosaic does not cover is
    `unknown` and BREAKS a run rather than extending it -- an unknown metre
    is not evidence of grass."""
    L = math.hypot((lon1 - lon0) * MPD_LON, (lat1 - lat0) * MPD_LAT)
    n = max(2, int(round(L / SAMPLE_STEP_M)))
    run = best = 0
    unknown = 0
    for k in range(n + 1):
        t = k / n
        v = air.is_open_turf(lon0 + (lon1 - lon0) * t, lat0 + (lat1 - lat0) * t)
        if v is None:
            unknown += 1
            run = 0
            continue
        if v:
            run += 1
            best = max(best, run)
        else:
            run = 0
    return best * (L / n), n + 1, unknown


def worn_streak(air, lon0, lat0, lon1, lat1):
    """Does the photograph show a worn line through a lawn here?

    Returns (verdict, worn_share, flank_share).  Both shares are measured on
    the SAME mosaic at the same sampling step, so the comparison between the
    line and its flanks is between like and like."""
    dlon, dlat = lon1 - lon0, lat1 - lat0
    L = math.hypot(dlon * MPD_LON, dlat * MPD_LAT)
    if L <= 0:
        return False, 0.0, 0.0
    n = max(4, int(round(L / SAMPLE_STEP_M)))
    px, py = -dlat * MPD_LAT, dlon * MPD_LON        # perpendicular, in metres
    pl = math.hypot(px, py) or 1.0
    px, py = px / pl, py / pl
    on, flank = [], []
    for k in range(1, n):                            # skip both endpoints
        t = k / n
        lo = lon0 + dlon * t
        la = lat0 + dlat * t
        c = air.rgb(lo, la)
        if c is None:
            return False, 0.0, 0.0
        on.append(_ng(c))
        for sgn in (1, -1):
            f = air.rgb(lo + px * DESIRE_FLANK_M * sgn / MPD_LON,
                        la + py * DESIRE_FLANK_M * sgn / MPD_LAT)
            if f is None:
                return False, 0.0, 0.0
            flank.append(_ng(f))
    if not on or not flank:
        return False, 0.0, 0.0
    worn = sum(1 for v in on if v <= NG_PAVE) / float(len(on))
    veg = sum(1 for v in flank if v >= NG_GRASS) / float(len(flank))
    return (worn >= DESIRE_WORN_FRAC and veg >= DESIRE_FLANK_FRAC), worn, veg


def _ng(c):
    r, g, b = c
    return g / (r + g + b + 1e-9)


# --------------------------------------------------------------------------
# the graph, borrowed whole from bake_walk.py
# --------------------------------------------------------------------------
def plaza_rings(G):
    """The `highway=pedestrian area=yes` rings, as node-index rings."""
    out = []
    nid_ix = G["nid_ix"]
    for w in G["ways"]:
        t = w.get("tags", {}) or {}
        if t.get("area") != "yes" or t.get("highway") != PLAZA_HIGHWAY:
            continue
        ns = w.get("nodes") or []
        g = w.get("geometry") or []
        if len(ns) != len(g) or len(ns) < 4 or ns[0] != ns[-1]:
            continue
        ix = [nid_ix[n] for n in ns if n in nid_ix]
        if len(ix) < 4:
            continue
        out.append(dict(wid=w["id"], name=t.get("name") or "",
                        nodes=ns, ix=ix))
    return out


def ring_area_m2(pts):
    a = 0.0
    for i in range(len(pts) - 1):
        a += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1]
    return abs(a) / 2.0


def chord_inside(pts, ax, ay, bx, by):
    """The chord stays inside the ring: no proper crossing of a ring edge,
    and every sampled interior point is in the ring.  The second test is
    what catches a concave plaza whose midpoint happens to be inside."""
    for i in range(len(pts) - 1):
        p, q = pts[i], pts[i + 1]
        if BW.segs_cross(ax, ay, bx, by, p[0], p[1], q[0], q[1]):
            return False
    L = math.hypot(bx - ax, by - ay)
    n = max(2, int(L / CHORD_INSIDE_STEP_M))
    for k in range(1, n):
        t = k / n
        if not BW.point_in_ring(pts, ax + (bx - ax) * t, ay + (by - ay) * t):
            return False
    return True


def build_blockers(G):
    """Everything a straight line across open ground may not cross.

    Buildings and carriageways come from bake_walk's own obstacle builder, so
    this script and the bake agree by construction about where a wall is.
    Two more classes matter for a line that leaves the pavement and neither
    is in that set: a mapped FENCE or WALL, and WATER."""
    bgrid, rgrid, polys, nroad, bnames, bclass = BW.build_obstacles()
    fgrid = BW.Grid(30.0)
    nfence = 0
    try:
        d = BW.load("data/osm_cache/furn_barrier.json")
    except Exception:
        d = {"elements": []}
    for el in d["elements"]:
        t = el.get("tags", {}) or {}
        if t.get("barrier") not in ("fence", "wall"):
            continue
        g = el.get("geometry") or []
        for i in range(len(g) - 1):
            ax, ay = BW.xy(g[i]["lon"], g[i]["lat"])
            bx, by = BW.xy(g[i + 1]["lon"], g[i + 1]["lat"])
            fgrid.add(ax, ay, bx, by, (ax, ay, bx, by))
        if len(g) > 1:
            nfence += 1
    wgrid = BW.Grid(30.0)
    nwater = 0
    gj = BW.load("data/ground.geojson")
    for ft in gj["features"]:
        p = ft["properties"]
        if not ((p.get("k") == "area" and p.get("u") in ("water", "fountain"))
                or (p.get("k") == "bank" and p.get("u") == "channel")):
            continue
        if ft["geometry"]["type"] != "Polygon":
            continue
        ring = [BW.xy(c[0], c[1]) for c in ft["geometry"]["coordinates"][0]]
        for i in range(len(ring) - 1):
            wgrid.add(ring[i][0], ring[i][1], ring[i + 1][0], ring[i + 1][1],
                      (ring[i][0], ring[i][1], ring[i + 1][0], ring[i + 1][1]))
        nwater += 1
    return dict(bgrid=bgrid, rgrid=rgrid, polys=polys, bclass=bclass,
                fgrid=fgrid, wgrid=wgrid, nfence=nfence, nwater=nwater)


def crosses_lines(grid, ax, ay, bx, by):
    for (cx, cy, dx, dy) in grid.near_seg(ax, ay, bx, by):
        if BW.segs_cross(ax, ay, bx, by, cx, cy, dx, dy):
            return True
    return False


# --------------------------------------------------------------------------
# A. plaza chords
# --------------------------------------------------------------------------
def find_plaza_chords(G, obs, air, stats):
    nx, ny, nlon, nlat = G["nx"], G["ny"], G["nlon"], G["nlat"]
    out = []
    for pz in plaza_rings(G):
        ix = pz["ix"]
        pts = [(nx[i], ny[i]) for i in ix]
        if ring_area_m2(pts) < PLAZA_MIN_AREA_M2:
            stats["plaza_too_small"] += 1
            continue
        stats["plaza_considered"] += 1
        uniq = ix[:-1]
        uids = pz["nodes"][:-1]
        n = len(uniq)
        seg = [math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
               for i in range(len(pts) - 1)]
        per = sum(seg)
        for a in range(n):
            for b in range(a + 1, n):
                if (b - a) == 1 or (b - a) == n - 1:
                    continue                      # adjacent on the ring
                ia, ib = uniq[a], uniq[b]
                if ia == ib:
                    continue
                ax, ay = nx[ia], ny[ia]
                bx, by = nx[ib], ny[ib]
                L = math.hypot(bx - ax, by - ay)
                if L < CHORD_MIN_M:
                    stats["chord_short"] += 1
                    continue
                fwd = sum(seg[a:b])
                gain = min(fwd, per - fwd) - L
                if gain < CHORD_MIN_GAIN_M:
                    stats["chord_no_gain"] += 1
                    continue
                if not chord_inside(pts, ax, ay, bx, by):
                    stats["chord_outside_ring"] += 1
                    continue
                nb, _ = BW.crosses_building(obs["bgrid"], ax, ay, bx, by,
                                            bclass=obs["bclass"])
                if nb:
                    stats["chord_building"] += 1
                    continue
                if BW.crosses_road(obs["rgrid"], ax, ay, bx, by):
                    stats["chord_road"] += 1
                    continue
                if crosses_lines(obs["fgrid"], ax, ay, bx, by):
                    stats["chord_fence"] += 1
                    continue
                run, ns_, unk = turf_run_m(air, nlon[ia], nlat[ia],
                                           nlon[ib], nlat[ib])
                if run >= VEG_RUN_REJECT_M:
                    stats["chord_photo_turf"] += 1
                    continue
                stats["chord_confirmed"] += 1
                out.append([pz["wid"], uids[a], uids[b],
                            int(round(L * 100)), int(round(run * 100)),
                            int(round(gain))])
    return out


# --------------------------------------------------------------------------
# B. desire paths
# --------------------------------------------------------------------------
def network_balls(G, cap_m):
    """Bounded Dijkstra from every node out to cap_m, as a list of {v: dist}.

    A pair whose network distance exceeds the cap is simply absent, and that
    is enough: the test is network > straight * ratio, and the cap is set to
    the largest value that product can take."""
    import heapq
    n = len(G["nx"])
    adj = [[] for _ in range(n)]
    for (a, b), rec in G["edges"].items():
        adj[a].append((b, rec[0]))
        adj[b].append((a, rec[0]))
    balls = []
    for u in range(n):
        dist = {u: 0.0}
        pq = [(0.0, u)]
        while pq:
            d, x = heapq.heappop(pq)
            if d > dist.get(x, 1e18) + 1e-9:
                continue
            for (y, w) in adj[x]:
                nd = d + w
                if nd <= cap_m and nd < dist.get(y, 1e18) - 1e-9:
                    dist[y] = nd
                    heapq.heappush(pq, (nd, y))
        balls.append(dist)
    return balls


def find_desire_paths(G, obs, air, stats, inbox):
    nx, ny, nlon, nlat = G["nx"], G["ny"], G["nlon"], G["nlat"]
    nodeid = G["node_id"]
    cap = DESIRE_MAX_M * DESIRE_MIN_RATIO
    P("  bounded Dijkstra from every node out to %.0f m ..." % cap)
    balls = network_balls(G, cap)

    grid = BW.Grid(DESIRE_SEARCH_R_M)
    for i in range(len(nx)):
        grid.add(nx[i], ny[i], nx[i], ny[i], i)

    seen = set()
    cands = []
    for u in range(len(nx)):
        for v in grid.near(nx[u], ny[u], DESIRE_SEARCH_R_M):
            if v <= u:
                continue
            if (u, v) in seen:
                continue
            seen.add((u, v))
            straight = math.hypot(nx[v] - nx[u], ny[v] - ny[u])
            if straight < DESIRE_MIN_M or straight > DESIRE_MAX_M:
                continue
            if not (inbox(nlon[u], nlat[u]) and inbox(nlon[v], nlat[v])):
                continue
            d = balls[u].get(v)
            net = d if d is not None else cap
            if net < straight * DESIRE_MIN_RATIO:
                continue
            if net - straight < DESIRE_MIN_GAIN_M:
                continue
            cands.append((net - straight, u, v, straight, net))
    cands.sort(reverse=True)
    stats["desire_candidates"] = len(cands)
    P("  %d geometric candidates before the photograph" % len(cands))

    kept = []
    anchors = []
    for gain, u, v, straight, net in cands[:DESIRE_MAX_CAND]:
        ax, ay, bx, by = nx[u], ny[u], nx[v], ny[v]
        nb, _ = BW.crosses_building(obs["bgrid"], ax, ay, bx, by,
                                    bclass=obs["bclass"])
        if nb:
            stats["desire_building"] += 1
            continue
        if BW.crosses_road(obs["rgrid"], ax, ay, bx, by):
            stats["desire_road"] += 1
            continue
        if crosses_lines(obs["fgrid"], ax, ay, bx, by):
            stats["desire_fence"] += 1
            continue
        if crosses_lines(obs["wgrid"], ax, ay, bx, by):
            stats["desire_water"] += 1
            continue
        dup = False
        for (px1, py1, px2, py2) in anchors:
            if ((math.hypot(ax - px1, ay - py1) < DESIRE_DEDUPE_M
                 and math.hypot(bx - px2, by - py2) < DESIRE_DEDUPE_M)
                    or (math.hypot(ax - px2, ay - py2) < DESIRE_DEDUPE_M
                        and math.hypot(bx - px1, by - py1) < DESIRE_DEDUPE_M)):
                dup = True
                break
        if dup:
            stats["desire_duplicate"] += 1
            continue
        ok, worn, veg = worn_streak(air, nlon[u], nlat[u], nlon[v], nlat[v])
        if worn == 0.0 and veg == 0.0:
            stats["desire_off_photo"] += 1
            continue
        if veg < DESIRE_FLANK_FRAC:
            stats["desire_flanks_not_lawn"] += 1
            continue
        if not ok:
            stats["desire_no_worn_line"] += 1
            continue
        stats["desire_confirmed"] += 1
        anchors.append((ax, ay, bx, by))
        kept.append([nodeid[u], nodeid[v], int(round(straight * 100)),
                     int(round(worn * 100)), int(round(veg * 100)),
                     int(round(gain)), int(round(net))])
    return kept


# --------------------------------------------------------------------------
# the two gates, watchable failing
#
# scripts/verify/README.md: "Every gate must be watchable failing."  Both
# surface tests in this file decide what ships, so both are asserted against
# hand-picked lines whose answer was read off the photograph BY EYE before
# these numbers were written down, and `--selftest --break` moves the one
# constant they turn on and must come back red.
#
#   the intramural fields, east campus -- 67 m and 77 m of open turf, no walk
#   the South Mall, straight down the middle -- 78 m of paving, no turf
#
# The pair is deliberately complementary: the field line must FAIL the chord
# gate and the mall line must PASS it, so a gate stuck on either answer is
# caught.  `worn` and `vegflank` are asserted on the same two lines, which is
# what proves the desire-path test is measuring the shape and not the
# exposure -- the mall reads 100 % surface with 0 % vegetated flanks, the
# field reads 3 % surface with 58 % vegetated flanks.
# --------------------------------------------------------------------------
SELFTEST = [
    # name, lon0, lat0, lon1, lat1, checks
    ("intramural field, east-west", -97.72820, 30.28720, -97.72900, 30.28720,
     dict(turf_run_min=4.0, worn_max=0.50)),
    ("intramural field, north-south", -97.72860, 30.28700, -97.72860, 30.28760,
     dict(turf_run_min=4.0, worn_max=0.20, veg_min=0.50)),
    ("South Mall, down the middle", -97.73946, 30.28470, -97.73946, 30.28540,
     dict(turf_run_max=1.0, worn_min=0.90, veg_max=0.10)),
]


def selftest(air, broken=False):
    global NG_GRASS, NG_PAVE
    if broken:
        # One constant, moved so far that turf and paving cannot be told
        # apart.  Every assertion below must go red.
        NG_GRASS = 0.0
        NG_PAVE = 1.0
    bad = 0
    P("")
    P("SELFTEST -- the two surface gates against lines read off the photo by eye")
    for name, a, b, c, d, want in SELFTEST:
        run, _, _ = turf_run_m(air, a, b, c, d)
        ok, worn, veg = worn_streak(air, a, b, c, d)
        fails = []
        if "turf_run_min" in want and not run >= want["turf_run_min"]:
            fails.append("turf run %.1f m < %.1f" % (run, want["turf_run_min"]))
        if "turf_run_max" in want and not run <= want["turf_run_max"]:
            fails.append("turf run %.1f m > %.1f" % (run, want["turf_run_max"]))
        if "worn_min" in want and not worn >= want["worn_min"]:
            fails.append("worn %.2f < %.2f" % (worn, want["worn_min"]))
        if "worn_max" in want and not worn <= want["worn_max"]:
            fails.append("worn %.2f > %.2f" % (worn, want["worn_max"]))
        if "veg_min" in want and not veg >= want["veg_min"]:
            fails.append("vegflank %.2f < %.2f" % (veg, want["veg_min"]))
        if "veg_max" in want and not veg <= want["veg_max"]:
            fails.append("vegflank %.2f > %.2f" % (veg, want["veg_max"]))
        P("  %-32s turf run %5.1f m  worn %.2f  vegflank %.2f   %s"
          % (name, run, worn, veg, "ok" if not fails else "FAIL " + "; ".join(fails)))
        bad += len(fails)
    P("  %s" % ("PASS" if not bad else "FAIL -- %d assertion(s)" % bad))
    return bad


# --------------------------------------------------------------------------
# looking at it
# --------------------------------------------------------------------------
def contact_sheet(air, G, chords, desires, outdir):
    """One labelled crop per confirmed line, so a person can look.

    Every crop is drawn from the SAME mosaic the verdict was read off, with
    the line the verdict is about drawn on it, so a crop cannot be of some
    other imagery that happens to look plausible."""
    os.makedirs(outdir, exist_ok=True)
    nlon, nlat = G["nlon"], G["nlat"]
    ixof = G["nid_ix"]
    jobs = []
    for wid, na, nb, lcm, runcm, gain in chords[:SHEET_MAX]:
        if na in ixof and nb in ixof:
            jobs.append(("chord-%d-%d" % (wid, na), ixof[na], ixof[nb],
                         "plaza %d  %.1f m  saves %d m" % (wid, lcm / 100.0, gain)))
    for na, nb, scm, worn, veg, gain, net in desires[:SHEET_MAX]:
        if na in ixof and nb in ixof:
            jobs.append(("desire-%d-%d" % (na, nb), ixof[na], ixof[nb],
                         "desire %.1f m  worn %d%%  flanks veg %d%%  network %d m"
                         % (scm / 100.0, worn, veg, net)))
    made = 0
    for name, ia, ib, label in jobs:
        lo0, la0, lo1, la1 = nlon[ia], nlat[ia], nlon[ib], nlat[ib]
        pad = SHEET_PAD_M
        w = min(lo0, lo1) - pad / MPD_LON
        e = max(lo0, lo1) + pad / MPD_LON
        s = min(la0, la1) - pad / MPD_LAT
        n = max(la0, la1) + pad / MPD_LAT
        W = int((e - w) * MPD_LON / NAIP_GSD_M * SHEET_SCALE)
        H = int((n - s) * MPD_LAT / NAIP_GSD_M * SHEET_SCALE)
        if W < 8 or H < 8 or W > 4000 or H > 4000:
            continue
        im = Image.new("RGB", (W, H))
        px = im.load()
        for y in range(H):
            lat = n - (n - s) * (y + 0.5) / H
            for x in range(W):
                lon = w + (e - w) * (x + 0.5) / W
                c = air.rgb(lon, lat)
                px[x, y] = c if c else (255, 0, 255)
        d = ImageDraw.Draw(im)
        p0 = ((lo0 - w) / (e - w) * W, (n - la0) / (n - s) * H)
        p1 = ((lo1 - w) / (e - w) * W, (n - la1) / (n - s) * H)
        d.line([p0, p1], fill=(255, 0, 255), width=2)
        d.ellipse([p0[0] - 4, p0[1] - 4, p0[0] + 4, p0[1] + 4], outline=(255, 255, 0), width=2)
        d.ellipse([p1[0] - 4, p1[1] - 4, p1[0] + 4, p1[1] + 4], outline=(255, 255, 0), width=2)
        d.text((4, 4), label, fill=(255, 255, 0))
        im.save(os.path.join(outdir, name + ".png"))
        made += 1
    P("  %d crops written to %s" % (made, outdir))


# --------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", action="store_true",
                    help="measure and print; write no file")
    ap.add_argument("--sheet", metavar="DIR", default=None,
                    help="write labelled crops of every confirmed line there")
    ap.add_argument("--no-desire", action="store_true")
    ap.add_argument("--selftest", action="store_true",
                    help="assert the two surface gates and exit")
    ap.add_argument("--break", dest="brk", action="store_true",
                    help="with --selftest: sabotage the gates; must come back red")
    a = ap.parse_args()

    t0 = time.time()
    s, w, n, e = campus_bbox()
    P("campus bbox  %.4f,%.4f .. %.4f,%.4f" % (s, w, n, e))
    P("the photograph: USGS NAIP at %.2f m/px" % NAIP_GSD_M)
    air = Aerial(s, w, n, e)
    inbox = lambda lo, la: (w <= lo <= e and s <= la <= n)
    P("  %d tile(s), %s" % (len(air.tiles), NAIP_LICENCE))

    if a.selftest:
        bad = selftest(air, broken=a.brk)
        if a.brk:
            P("  --break: %s" % ("the gates went red, as they must"
                                 if bad else "THE GATES DID NOT MOVE -- they cannot fail"))
            sys.exit(0 if bad else 1)
        sys.exit(0 if not bad else 1)

    G = BW.build_raw()
    G["node_id"] = [0] * len(G["nx"])
    for nid, i in G["nid_ix"].items():
        G["node_id"][i] = nid
    P("graph  %d nodes  %d edges" % (len(G["nx"]), len(G["edges"])))
    obs = build_blockers(G)
    P("blockers  %d fence/wall ways  %d water polygons" % (obs["nfence"], obs["nwater"]))

    from collections import defaultdict
    stats = defaultdict(int)

    P("\nA. plaza chords")
    chords = find_plaza_chords(G, obs, air, stats)
    P("  %d confirmed" % len(chords))

    desires = []
    if not a.no_desire:
        P("\nB. desire paths")
        desires = find_desire_paths(G, obs, air, stats, inbox)
        P("  %d confirmed" % len(desires))

    P("\nwhy candidates were refused")
    for k in sorted(stats):
        P("  %-24s %6d" % (k, stats[k]))
    if air.misses:
        P("  %-24s %6d" % ("sample off the mosaic", air.misses))

    doc = {
        "_what": ("Lines the aerial PHOTOGRAPH confirms are walkable, between "
                  "pairs of nodes that are already in the OSM walking network. "
                  "No geometry is invented here: an endpoint that is not an OSM "
                  "node cannot appear. scripts/bake_walk.py reads this file."),
        "_oracle": air.query,
        "_generated": time.strftime("%Y-%m-%d"),
        "_format": ("plaza_chords: [pedestrian_area_way_id, osm_node_a, "
                    "osm_node_b, chord_cm, longest_turf_run_cm, "
                    "metres_saved_against_the_rim]. desire_paths: [osm_node_a, "
                    "osm_node_b, straight_cm, longest_turf_run_cm, "
                    "worn_percent_of_the_line, vegetated_percent_of_its_flanks, "
                    "metres_saved, network_metres_today]."),
        "params": {
            "NG_GRASS": NG_GRASS, "NG_CANOPY_MAX_LUMA": NG_CANOPY_MAX_LUMA,
            "VEG_RUN_REJECT_M": VEG_RUN_REJECT_M,
            "SAMPLE_STEP_M": SAMPLE_STEP_M,
            "PLAZA_MIN_AREA_M2": PLAZA_MIN_AREA_M2,
            "CHORD_MIN_M": CHORD_MIN_M, "CHORD_MIN_GAIN_M": CHORD_MIN_GAIN_M,
            "DESIRE_MIN_M": DESIRE_MIN_M, "DESIRE_MAX_M": DESIRE_MAX_M,
            "DESIRE_MIN_RATIO": DESIRE_MIN_RATIO,
            "DESIRE_MIN_GAIN_M": DESIRE_MIN_GAIN_M,
            "DESIRE_DEDUPE_M": DESIRE_DEDUPE_M,
            "DESIRE_FLANK_M": DESIRE_FLANK_M,
            "DESIRE_WORN_FRAC": DESIRE_WORN_FRAC,
            "DESIRE_FLANK_FRAC": DESIRE_FLANK_FRAC,
            "NG_PAVE": NG_PAVE,
        },
        "refused": {k: stats[k] for k in sorted(stats)},
        "plaza_chords": chords,
        "desire_paths": desires,
    }

    if a.sheet:
        P("\ncontact sheet")
        contact_sheet(air, G, chords, desires, a.sheet)

    if a.report:
        P("\n--report: nothing written")
    else:
        path = os.path.join(ROOT, OUT_REL)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(doc, fh, separators=(",", ":"))
        P("\nwrote %s  (%.1f KB)" % (OUT_REL, os.path.getsize(path) / 1024.0))
    P("%.1f s" % (time.time() - t0))


if __name__ == "__main__":
    main()
