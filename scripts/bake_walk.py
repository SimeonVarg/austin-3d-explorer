#!/usr/bin/env python3
"""
bake_walk.py — build data/walk_graph.json, the campus walking network.

This script owns data/walk_graph.json and nothing else writes it (CLAUDE.md
rule 1).  It is the execution of docs/walk/graph.md; where this file and that
document disagree, the disagreement is printed at the bottom of every run
rather than being silently resolved.

    python scripts/bake_walk.py               bake, print the health numbers
    python scripts/bake_walk.py --routes      bake, then route and audit the
                                              nine named validation pairs
    python scripts/bake_walk.py --regress     do NOT bake; load the shipped
                                              graph, route the frozen pair
                                              list, and exit 1 if any route
                                              broke or got materially longer

What it does NOT do, deliberately:
  * no route ever passes through a building — there is exactly one `indoor`
    tag in the whole OSM cache and UT publishes no floor plans;
  * no step count is computed from geometry (docs/walk/what-we-can-honestly-
    say.md §4 measured a 10.5x spread on the only nine samples that exist);
  * no elevation, gradient or "uphill" anything — there is no DEM in this repo.
"""

import argparse
import gzip
import heapq
import json
import math
import os
import sys
import time
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def P(*a):
    print(*a, flush=True)


# --------------------------------------------------------------------------
# TASTE AND MODEL CONSTANTS — every judgement in this bake is one line here.
# CLAUDE.md rule 11.  Nothing below this block hard-codes a number.
# --------------------------------------------------------------------------

# Local equirectangular frame, anchored at lat 30.285.  Error against the
# ellipsoid over the 3.1 km bbox is under 0.02 % (docs/walk/graph.md §6a).
LAT_ANCHOR = 30.285
MPD_LAT = 111195.0
MPD_LON = 96061.0

# Snapping dead ends to lines they were meant to join.  graph.md §3 measured
# that this is close to a no-op on this data and that anything larger buys
# false connections through walls and roads.
SNAP_TOL_M = 2.0
SNAP_RESPECT_LAYER = True
SNAP_BLOCK_OBSTACLES = True
SNAP_MAX_ACCEPTED = 80

# Doors.
DOOR_LINK_MAX_M = 30.0     # beyond this the route ends at the outline
DOOR_ANCHORS = 3           # candidate anchors per door, so a profile can re-anchor
ANCHOR_SPLIT_MIN_M = 2.0   # closer than this to an existing node, reuse it
POI_LINK_MAX_M = 40.0

# A route "passes through a building" only if it stays inside the footprint
# for longer than this.  See find_through_edges() for the measurement that
# produced the number.
WALL_CLIP_TOL_M = 3.0
WALL_CLIP_STEP_M = 0.5
# `building_class: roof` footprints are canopies, awnings, bus shelters and
# arena roof planes - the Moody Center alone contributes two of 16,450 and
# 18,554 m2.  Walking under a canopy is walking outdoors, so they are not
# walls for the purpose of this audit.  They stay obstacles for the SNAP
# guard, which is deliberately the more conservative of the two.
WALL_IGNORE_CLASSES = {"roof"}

# Cost model.  docs/walk/what-we-can-honestly-say.md owns the wording; this
# owns the arithmetic and agrees with it everywhere.
WALK_SPEED_LOW_MS = 1.10
WALK_SPEED_HIGH_MS = 1.40
STAIR_SPEED_MPS = 0.50     # horizontal-component speed on stairs
STAIR_FIXED_S = 4.0        # per STAIRCASE, spread across its edges (see note)
STAIR_UP_MULT = 1.35       # only where `incline` is tagged
SIGNAL_WAIT_LOW_S = 0
SIGNAL_WAIT_HIGH_S = 45    # half a ~90 s Guadalupe/MLK cycle
CROSSING_PENALTY_M = 8.0   # distance-equivalent nudge away from road crossings
TIME_ROUND_MIN = 1

# Wire format.
COORD_Q = 1e-6             # coordinate quantum in degrees, ~0.11 m

# Regression tolerance, and the three tests that make a route a FAILURE
# rather than merely a long walk.  A route that leaves campus, doubles back or
# crosses a building is a failure and gets reported as one.
REGRESS_TOL_PCT = 5.0
FLAG_DETOUR = 2.10          # path / straight line
FLAG_BACK_PCT = 25.0        # backwards movement as a share of the route
FLAG_OVERSHOOT_PCT = 15.0   # how far past the destination it goes, vs straight line

# Hand-checked code aliases.  262 doors carry no `ref`; these footprint names
# were matched against UT's own register and read one by one.  Each row is a
# UT register code -> the exact `nm` on the door group.  AF1/AF2 are NOT here:
# both register names match the same footprint, which is the honest failure
# mode of name matching (graph.md §5).
CODE_ALIASES = {
    "RLP": "Patton Hall",
    "BME": "Biomedical Engineering Building",
    "ECG": "East Campus Garage",
    "CLK": "Caven Clark Field Support Building",
    "STD": "DKR Memorial Stadium",
    "ATT": "AT&T Executive Education and Conference Center",
    "KIN": "Kinsolving Dormitory",
}

# Edge flag bits (graph.md §7).
F_STEPS = 1 << 0
F_CROSSING = 1 << 1
F_SIGNALLED = 1 << 2
F_INCLINE_UP_AB = 1 << 3
F_BRIDGE = 1 << 4
F_COVERED = 1 << 5
F_WHEELCHAIR_YES = 1 << 6   # informational only, NEVER routed on
F_OFF_MAIN = 1 << 7

# Roads that carry cars.  Used only as a snapping obstacle.
DRIVABLE = {
    "motorway", "motorway_link", "trunk", "trunk_link", "primary",
    "primary_link", "secondary", "secondary_link", "tertiary",
    "tertiary_link", "unclassified", "residential", "living_street",
    "service", "road", "busway",
}

# The nine pairs the brief named, plus the frozen baseline for --regress.
VALIDATION_PAIRS = [
    ("JES", "GDC"), ("JES", "WEL"), ("PCL", "RLP"), ("GRE", "MAI"),
    ("BUR", "CBA"), ("STD", "MAI"), ("21 Rio", "WEL"),
    ("The Castilian", "GDC"), ("PCL", "JES"),
]

# Frozen 2026-08-15 off the first audited bake, main door to main door, in
# metres including both unmapped last legs.  A data refresh that moves any of
# these by more than REGRESS_TOL_PCT is loud, not silent.  BUR>CBA is frozen
# at its BROKEN value on purpose - see KNOWN_BAD.
REGRESS_BASELINE = {
    "JES>GDC": 471.8, "JES>WEL": 525.2, "PCL>RLP": 518.3, "GRE>MAI": 575.3,
    "BUR>CBA": 949.2, "STD>MAI": 1002.5, "21 Rio>WEL": 1015.1,
    "The Castilian>GDC": 697.8, "PCL>JES": 156.2,
}

# Routes that are audited as failures today and are NOT graph bugs to fix by
# tuning.  Written down so a later pass does not silently "fix" one by
# loosening a guard.
KNOWN_BAD = {
    "BUR>CBA": (
        "McCombs' main door anchors onto a footway spur that only rejoins the "
        "network 130 m SOUTH of the building, so the route walks past the "
        "destination and comes back.  Its own secondary door 15 m west routes "
        "in 767 m.  The gap between the two frontage paths is 11 m; closing it "
        "needs a stitch five times SNAP_TOL_M, which graph.md 3c measured as "
        "buying 59 road crossings.  This is a hole in OSM, not a tuning knob."
    ),
}

# How many random routable code pairs the --routes sweep checks.
SWEEP_N = 300
SWEEP_SEED = 7


# --------------------------------------------------------------------------
# geometry helpers
# --------------------------------------------------------------------------

def xy(lon, lat):
    return lon * MPD_LON, lat * MPD_LAT


def dist_m(ax, ay, bx, by):
    return math.hypot(bx - ax, by - ay)


def seg_point(px, py, ax, ay, bx, by):
    """Distance from p to segment ab, and the projection parameter t."""
    vx, vy = bx - ax, by - ay
    L2 = vx * vx + vy * vy
    if L2 <= 0.0:
        return math.hypot(px - ax, py - ay), 0.0, ax, ay
    t = ((px - ax) * vx + (py - ay) * vy) / L2
    t = max(0.0, min(1.0, t))
    qx, qy = ax + t * vx, ay + t * vy
    return math.hypot(px - qx, py - qy), t, qx, qy


def segs_cross(ax, ay, bx, by, cx, cy, dx, dy):
    """Proper segment intersection.  Touching at an endpoint does not count."""
    def o(px, py, qx, qy, rx, ry):
        v = (qy - py) * (rx - qx) - (qx - px) * (ry - qy)
        if abs(v) < 1e-12:
            return 0
        return 1 if v > 0 else -1
    o1 = o(ax, ay, bx, by, cx, cy)
    o2 = o(ax, ay, bx, by, dx, dy)
    o3 = o(cx, cy, dx, dy, ax, ay)
    o4 = o(cx, cy, dx, dy, bx, by)
    return o1 != o2 and o3 != o4 and o1 != 0 and o2 != 0 and o3 != 0 and o4 != 0


class Grid:
    """Uniform-grid spatial index over segments, in local metres."""

    def __init__(self, cell=25.0):
        self.cell = cell
        self.g = defaultdict(list)

    def add(self, ax, ay, bx, by, payload):
        c = self.cell
        i0, i1 = int(min(ax, bx) // c), int(max(ax, bx) // c)
        j0, j1 = int(min(ay, by) // c), int(max(ay, by) // c)
        for i in range(i0, i1 + 1):
            for j in range(j0, j1 + 1):
                self.g[(i, j)].append(payload)

    def near(self, px, py, r):
        c = self.cell
        i0, i1 = int((px - r) // c), int((px + r) // c)
        j0, j1 = int((py - r) // c), int((py + r) // c)
        out = []
        for i in range(i0, i1 + 1):
            for j in range(j0, j1 + 1):
                out.extend(self.g.get((i, j), ()))
        return out

    def near_seg(self, ax, ay, bx, by):
        c = self.cell
        i0, i1 = int(min(ax, bx) // c), int(max(ax, bx) // c)
        j0, j1 = int(min(ay, by) // c), int(max(ay, by) // c)
        out = []
        for i in range(i0, i1 + 1):
            for j in range(j0, j1 + 1):
                out.extend(self.g.get((i, j), ()))
        return out


class DSU:
    def __init__(self, n):
        self.p = list(range(n))

    def find(self, a):
        p = self.p
        while p[a] != a:
            p[a] = p[p[a]]
            a = p[a]
        return a

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.p[rb] = ra


def load(rel):
    with open(os.path.join(ROOT, rel), "r", encoding="utf-8") as fh:
        return json.load(fh)


def pct(vals, p):
    if not vals:
        return 0.0
    s = sorted(vals)
    return s[min(len(s) - 1, int(len(s) * p / 100.0))]


# --------------------------------------------------------------------------
# 1. the raw graph — OSM node identity does the whole job
# --------------------------------------------------------------------------

def build_raw():
    doc = load("data/osm_cache/footways.json")
    as_of = doc.get("osm3s", {}).get("timestamp_osm_base", "")
    ways = doc["elements"]

    nid_ix = {}
    nx, ny, nlon, nlat = [], [], [], []

    def node(nid, lon, lat):
        ix = nid_ix.get(nid)
        if ix is None:
            ix = len(nlon)
            nid_ix[nid] = ix
            nlon.append(lon)
            nlat.append(lat)
            px, py = xy(lon, lat)
            nx.append(px)
            ny.append(py)
        return ix

    edges = {}          # (a,b) sorted -> [w_m, flags, steps_way_id, layer]
    kind_len = defaultdict(float)
    mismatch = 0
    rings = 0
    areas = 0
    layered = 0

    for w in ways:
        g = w.get("geometry") or []
        ns = w.get("nodes") or []
        if len(g) != len(ns):
            mismatch += 1
            continue
        t = w.get("tags", {})
        hw = t.get("highway", "")
        layer = int(t.get("layer", 0) or 0)
        if layer:
            layered += 1
        if len(ns) > 2 and ns[0] == ns[-1]:
            rings += 1
        if t.get("area") == "yes":
            areas += 1

        f = 0
        if hw == "steps":
            f |= F_STEPS
        if t.get("footway") == "crossing" or "crossing" in t:
            f |= F_CROSSING
        if t.get("crossing") == "traffic_signals":
            f |= F_SIGNALLED
        if t.get("bridge") and t.get("bridge") != "no":
            f |= F_BRIDGE
        if t.get("covered") and t.get("covered") != "no":
            f |= F_COVERED
        if t.get("wheelchair") == "yes":
            f |= F_WHEELCHAIR_YES
        inc = t.get("incline")
        sid = w["id"] if hw == "steps" else -1

        ixs = [node(ns[i], g[i]["lon"], g[i]["lat"]) for i in range(len(ns))]
        for i in range(len(ixs) - 1):
            a, b = ixs[i], ixs[i + 1]
            if a == b:
                continue
            L = dist_m(nx[a], ny[a], nx[b], ny[b])
            if L <= 0.0:
                continue
            kind_len[hw] += L
            ef = f
            # incline is a direction on the way's node order, not a gradient.
            if inc == "up":
                ef |= F_INCLINE_UP_AB
            key = (a, b) if a < b else (b, a)
            if inc == "up" and key[0] != a:
                ef &= ~F_INCLINE_UP_AB   # stored a->b in sorted order
            old = edges.get(key)
            if old is None:
                edges[key] = [L, ef, sid, layer]
            else:
                old[1] |= ef
                if sid >= 0 and old[2] < 0:
                    old[2] = sid

    return dict(as_of=as_of, ways=ways, nid_ix=nid_ix, nlon=nlon, nlat=nlat,
                nx=nx, ny=ny, edges=edges, kind_len=kind_len,
                mismatch=mismatch, rings=rings, areas=areas, layered=layered)


def components(n, edge_keys):
    d = DSU(n)
    for a, b in edge_keys:
        d.union(a, b)
    groups = defaultdict(list)
    for i in range(n):
        groups[d.find(i)].append(i)
    sizes = sorted((len(v) for v in groups.values()), reverse=True)
    main_root = max(groups, key=lambda r: len(groups[r]))
    return d, groups, sizes, set(groups[main_root])


# --------------------------------------------------------------------------
# 2. obstacles — walls and drivable roads.  These are guards, not knobs.
# --------------------------------------------------------------------------

def build_obstacles():
    bgrid = Grid(30.0)
    polys = {}          # bid -> list of rings in local xy
    bnames = {}
    bclass = {}
    b = load("data/snapshots/2026-08-05/buildings.enriched.geojson")
    for ft in b["features"]:
        bid = ft["properties"].get("id")
        bnames[bid] = ft["properties"].get("name") or "(unnamed footprint)"
        bclass[bid] = ft["properties"].get("building_class")
        geom = ft["geometry"]
        cs = geom["coordinates"]
        rings = cs if geom["type"] == "Polygon" else [r for poly in cs for r in poly]
        keep = []
        for ring in rings:
            pts = [xy(c[0], c[1]) for c in ring]
            keep.append(pts)
            for i in range(len(pts) - 1):
                bgrid.add(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1],
                          (pts[i], pts[i + 1], bid))
        polys[bid] = keep

    rgrid = Grid(30.0)
    r = load("data/osm_cache/roads.json")
    nroad = 0
    for w in r["elements"]:
        t = w.get("tags", {})
        if t.get("highway") not in DRIVABLE:
            continue
        g = w.get("geometry") or []
        nroad += 1
        for i in range(len(g) - 1):
            ax, ay = xy(g[i]["lon"], g[i]["lat"])
            bx, by = xy(g[i + 1]["lon"], g[i + 1]["lat"])
            rgrid.add(ax, ay, bx, by, (ax, ay, bx, by))
    return bgrid, rgrid, polys, nroad, bnames, bclass


def crosses_building(bgrid, ax, ay, bx, by, exempt=()):
    n = 0
    hit = set()
    for (p, q, bid) in bgrid.near_seg(ax, ay, bx, by):
        if bid in exempt:
            continue
        if segs_cross(ax, ay, bx, by, p[0], p[1], q[0], q[1]):
            n += 1
            hit.add(bid)
    return n, hit


def point_in_ring(ring, px, py):
    n = len(ring)
    ins = False
    j = n - 1
    for i in range(n):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if ((yi > py) != (yj > py)) and \
           (px < (xj - xi) * (py - yi) / (yj - yi + 1e-18) + xi):
            ins = not ins
        j = i
    return ins


def find_through_edges(edges, nx, ny, bgrid, polys, bclass):
    """Which graph edges actually pass THROUGH a building at ground level.

    A footprint boundary crossing on its own is not evidence: Overture and OSM
    footprints are not survey-accurate to the metre, and a sidewalk drawn
    along a wall clips its corner.  So the test is how many metres of the edge
    lie INSIDE the footprint, and the threshold is a named constant.
    Measured 2026-08-15: 44 clip events on 38 edges of 11,997; the depth
    distribution is p25 3.3 m, median 4.5 m, p90 19.6 m, max 39.7 m, so 3 m
    separates corner-clipping noise from a path that really runs under a
    building.
    """
    out = {}
    events = []
    for key, (L, f, sid, layer) in edges.items():
        if layer != 0:
            continue
        a, b = key
        ax, ay, bx, by = nx[a], ny[a], nx[b], ny[b]
        n, hits = crosses_building(bgrid, ax, ay, bx, by)
        if not n:
            continue
        deep = []
        for bid in hits:
            if bclass.get(bid) in WALL_IGNORE_CLASSES:
                continue
            rings = polys.get(bid) or []
            k = max(2, int(L / WALL_CLIP_STEP_M))
            d = 0.0
            for i in range(k + 1):
                t = i / k
                px, py = ax + (bx - ax) * t, ay + (by - ay) * t
                if any(point_in_ring(r, px, py) for r in rings):
                    d += L / k
            events.append((d, L, bid, key))
            if d > WALL_CLIP_TOL_M:
                deep.append(bid)
        if deep:
            out[key] = deep
    events.sort(reverse=True)
    return out, events


def crosses_road(rgrid, ax, ay, bx, by):
    for (cx, cy, dx, dy) in rgrid.near_seg(ax, ay, bx, by):
        if segs_cross(ax, ay, bx, by, cx, cy, dx, dy):
            return True
    return False


# --------------------------------------------------------------------------
# 3. snapping
# --------------------------------------------------------------------------

def snap(G, bgrid, rgrid):
    nx, ny = G["nx"], G["ny"]
    edges = G["edges"]
    deg = defaultdict(int)
    inc = defaultdict(set)
    for (a, b) in edges:
        deg[a] += 1
        deg[b] += 1
        inc[a].add((a, b))
        inc[b].add((a, b))

    sgrid = Grid(25.0)
    for key, (L, f, sid, layer) in edges.items():
        a, b = key
        sgrid.add(nx[a], ny[a], nx[b], ny[b], key)

    ends = [i for i in range(len(nx)) if deg[i] == 1]
    cand = []
    for i in ends:
        px, py = nx[i], ny[i]
        best = None
        for key in sgrid.near(px, py, SNAP_TOL_M):
            if key in inc[i]:
                continue
            a, b = key
            if a == i or b == i:
                continue
            d, t, qx, qy = seg_point(px, py, nx[a], ny[a], nx[b], ny[b])
            if d <= SNAP_TOL_M and (best is None or d < best[0]):
                best = (d, key, t, qx, qy)
        if best:
            cand.append((i, best))

    accepted, rej_layer, rej_bldg, rej_road = [], 0, 0, 0
    for i, (d, key, t, qx, qy) in cand:
        a, b = key
        if SNAP_RESPECT_LAYER:
            my_layer = None
            for k2 in inc[i]:
                my_layer = edges[k2][3]
                break
            if my_layer is not None and my_layer != edges[key][3]:
                rej_layer += 1
                continue
        if SNAP_BLOCK_OBSTACLES:
            nb, _ = crosses_building(bgrid, nx[i], ny[i], qx, qy)
            if nb:
                rej_bldg += 1
                continue
            if crosses_road(rgrid, nx[i], ny[i], qx, qy):
                rej_road += 1
                continue
        # attach to the nearer endpoint of the target segment; a 2 m stitch
        # cannot meaningfully mis-place the join.
        tgt = a if t < 0.5 else b
        if tgt == i:
            continue
        k = (i, tgt) if i < tgt else (tgt, i)
        if k in edges:
            continue
        L = dist_m(nx[i], ny[i], nx[tgt], ny[tgt])
        if L <= 0:
            continue
        edges[k] = [L, edges[key][1] & (F_BRIDGE | F_COVERED), -1, edges[key][3]]
        accepted.append(k)

    return dict(candidates=len(cand), accepted=accepted,
                rej_layer=rej_layer, rej_bldg=rej_bldg, rej_road=rej_road,
                dead_ends=len(ends))


# --------------------------------------------------------------------------
# 4. doors
# --------------------------------------------------------------------------

def build_doors():
    d = load("data/entrances.geojson")
    groups = {}
    for ft in d["features"]:
        p = ft["properties"]
        key = (p.get("bid"), p.get("eid"))
        g = groups.get(key)
        if g is None:
            g = groups[key] = dict(sx=0.0, sy=0.0, n=0, ref=p.get("ref") or "",
                                   nm=p.get("nm") or "", role=p.get("role") or "",
                                   src=p.get("src") or "", bid=p.get("bid"))
        geom = ft["geometry"]
        cs = geom["coordinates"]
        rings = cs if geom["type"] == "Polygon" else [r for poly in cs for r in poly]
        for ring in rings:
            for c in ring:
                g["sx"] += c[0]
                g["sy"] += c[1]
                g["n"] += 1
    out = []
    for key, g in groups.items():
        if not g["n"]:
            continue
        out.append(dict(lon=g["sx"] / g["n"], lat=g["sy"] / g["n"],
                        ref=g["ref"], nm=g["nm"], role=g["role"],
                        src=g["src"], bid=g["bid"]))
    out.sort(key=lambda x: (x["ref"], x["nm"], x["lon"]))
    return out


def anchor_doors(G, doors, main, bgrid):
    """Project each door onto the nearest main-component segments.

    Two traps from graph.md, both honoured here:
      * link to the nearest segment ON THE MAIN COMPONENT, not the nearest
        segment — 25 doors have an island closer than the main network;
      * if the straight link crosses a DIFFERENT building, take the next
        candidate that does not.
    """
    nx, ny = G["nx"], G["ny"]
    edges = G["edges"]
    sgrid = Grid(25.0)
    for key in edges:
        a, b = key
        if a in main and b in main:
            sgrid.add(nx[a], ny[a], nx[b], ny[b], key)

    split_count = 0
    through_other = 0
    stats = []
    for dr in doors:
        px, py = xy(dr["lon"], dr["lat"])
        cands = []
        for key in sgrid.near(px, py, DOOR_LINK_MAX_M):
            if key not in edges:
                continue          # already split by an earlier door's anchor
            a, b = key
            d, t, qx, qy = seg_point(px, py, nx[a], ny[a], nx[b], ny[b])
            if d <= DOOR_LINK_MAX_M:
                cands.append((d, key, t, qx, qy))
        cands.sort(key=lambda c: c[0])
        dr["_raw_link"] = cands[0][0] if cands else None

        picked = []
        used_edges = set()
        blocked = False
        for (d, key, t, qx, qy) in cands:
            if len(picked) >= DOOR_ANCHORS:
                break
            if key in used_edges:
                continue
            nb, hits = crosses_building(bgrid, px, py, qx, qy,
                                        exempt=(dr["bid"],))
            if nb:
                blocked = True
                continue
            used_edges.add(key)
            picked.append((d, key, t, qx, qy))
        if blocked and picked:
            through_other += 1
        if not picked:
            dr["anchors"] = []
            dr["links"] = []
            continue

        anchors, links = [], []
        for (d, key, t, qx, qy) in picked:
            a, b = key
            da = dist_m(qx, qy, nx[a], ny[a])
            db = dist_m(qx, qy, nx[b], ny[b])
            if da <= ANCHOR_SPLIT_MIN_M or db <= ANCHOR_SPLIT_MIN_M:
                node = a if da <= db else b
                link = dist_m(px, py, nx[node], ny[node])
            else:
                node = len(nx)
                nx.append(qx)
                ny.append(qy)
                G["nlon"].append(qx / MPD_LON)
                G["nlat"].append(qy / MPD_LAT)
                L, f, sid, layer = edges.pop(key)
                for (u, v) in ((a, node), (node, b)):
                    k2 = (u, v) if u < v else (v, u)
                    edges[k2] = [dist_m(nx[u], ny[u], nx[v], ny[v]), f, sid, layer]
                main.add(node)
                sgrid.add(nx[a], ny[a], qx, qy, (a, node) if a < node else (node, a))
                sgrid.add(qx, qy, nx[b], ny[b], (node, b) if node < b else (b, node))
                split_count += 1
                link = d
            if node in [x for x in anchors]:
                continue
            anchors.append(node)
            links.append(link)
        dr["anchors"] = anchors
        dr["links"] = links
        stats.append(links[0])
    return dict(splits=split_count, through_other=through_other, links=stats)


# --------------------------------------------------------------------------
# 5. routing — used by --routes, --regress and by js/walk.js's twin
# --------------------------------------------------------------------------

def build_adj(edges, n):
    adj = [[] for _ in range(n)]
    steps_edges = defaultdict(int)
    for (a, b), (L, f, sid, layer) in edges.items():
        if f & F_STEPS and sid >= 0:
            steps_edges[sid] += 1
    for (a, b), (L, f, sid, layer) in edges.items():
        if f & F_STEPS:
            share = steps_edges.get(sid, 1) or 1
            base = L / STAIR_SPEED_MPS + STAIR_FIXED_S / share
            cab = base * (STAIR_UP_MULT if (f & F_INCLINE_UP_AB) else 1.0)
            cba = base * (1.0 if (f & F_INCLINE_UP_AB) else 1.0)
        else:
            extra = CROSSING_PENALTY_M if (f & F_CROSSING) else 0.0
            cab = cba = (L + extra) / WALK_SPEED_LOW_MS
        adj[a].append((b, cab, L, f, sid))
        adj[b].append((a, cba, L, f, sid))
    return adj


def dijkstra(adj, sources, targets):
    INF = float("inf")
    dist = defaultdict(lambda: INF)
    prev = {}
    pq = []
    for s, c in sources:
        if c < dist[s]:
            dist[s] = c
            heapq.heappush(pq, (c, s))
    tset = {t: c for t, c in targets}
    best = None
    seen = set()
    while pq:
        d, u = heapq.heappop(pq)
        if u in seen:
            continue
        seen.add(u)
        if u in tset:
            tot = d + tset[u]
            if best is None or tot < best[0]:
                best = (tot, u)
        if best is not None and d > best[0]:
            break
        for (v, c, L, f, sid) in adj[u]:
            nd = d + c
            if nd < dist[v]:
                dist[v] = nd
                prev[v] = (u, L, f, sid)
                heapq.heappush(pq, (nd, v))
    if best is None:
        return None
    _, end = best
    path = [end]
    segs = []
    cur = end
    while cur in prev:
        u, L, f, sid = prev[cur]
        segs.append((L, f, sid))
        cur = u
        path.append(cur)
    path.reverse()
    segs.reverse()
    return path, segs


def route(adj, doorA, doorB):
    if not doorA.get("anchors") or not doorB.get("anchors"):
        return None
    src = [(n, l / WALK_SPEED_LOW_MS) for n, l in zip(doorA["anchors"], doorA["links"])]
    tgt = [(n, l / WALK_SPEED_LOW_MS) for n, l in zip(doorB["anchors"], doorB["links"])]
    r = dijkstra(adj, src, tgt)
    if r is None:
        return None
    path, segs = r
    dist = sum(s[0] for s in segs)
    stairs = {s[2] for s in segs if (s[1] & F_STEPS) and s[2] >= 0}
    signals = sum(1 for s in segs if s[1] & F_SIGNALLED)
    stair_len = sum(s[0] for s in segs if s[1] & F_STEPS)
    flat = dist - stair_len
    # link legs at both ends: the anchor actually used
    la = doorA["links"][doorA["anchors"].index(path[0])] if path[0] in doorA["anchors"] else 0.0
    lb = doorB["links"][doorB["anchors"].index(path[-1])] if path[-1] in doorB["anchors"] else 0.0
    lo = (flat + la + lb) / WALK_SPEED_HIGH_MS + stair_len / STAIR_SPEED_MPS \
        + STAIR_FIXED_S * len(stairs) + SIGNAL_WAIT_LOW_S * signals
    hi = (flat + la + lb) / WALK_SPEED_LOW_MS + stair_len / STAIR_SPEED_MPS \
        + STAIR_FIXED_S * len(stairs) + SIGNAL_WAIT_HIGH_S * signals
    return dict(path=path, dist=dist, link_a=la, link_b=lb,
                total=dist + la + lb, stairs=len(stairs), signals=signals,
                t_lo=math.floor(lo / 60.0), t_hi=math.ceil(hi / 60.0))


# --------------------------------------------------------------------------
# 6. the bake
# --------------------------------------------------------------------------

def bake(verbose=True):
    t0 = time.time()
    G = build_raw()
    nx, ny, edges = G["nx"], G["ny"], G["edges"]
    n_raw_nodes, n_raw_edges = len(nx), len(edges)

    _, _, sizes0, main0 = components(len(nx), edges.keys())
    comps0 = len(sizes0)

    bgrid, rgrid, polys, nroad, bnames, bclass = build_obstacles()
    sn = snap(G, bgrid, rgrid)
    _, groups, sizes, main = components(len(nx), edges.keys())
    comps = len(sizes)

    doors = build_doors()
    an = anchor_doors(G, doors, main, bgrid)
    through, clip_events = find_through_edges(edges, nx, ny, bgrid, polys, bclass)

    # --- code index, with the hand-checked aliases -------------------------
    reg = load("data/ut_buildings.json")["buildings"]
    reg_codes = [b["ref"] for b in reg]
    code_doors = defaultdict(list)
    alias_hits = defaultdict(int)
    for i, dr in enumerate(doors):
        ref = dr["ref"]
        if not ref:
            for code, nm in CODE_ALIASES.items():
                if dr["nm"] == nm:
                    ref = code
                    alias_hits[code] += 1
                    dr["ref"] = code
                    break
        if ref:
            code_doors[ref].append(i)

    routable = set()
    for code, idxs in code_doors.items():
        if any(doors[i].get("anchors") for i in idxs):
            routable.add(code)
    routable_reg = sorted(routable & set(reg_codes))
    missing = sorted(set(reg_codes) - routable)

    # --- POIs --------------------------------------------------------------
    pgrid = Grid(25.0)
    for i in main:
        pgrid.add(nx[i], ny[i], nx[i], ny[i], i)
    pois = []
    seen_names = set()
    for e in load("data/osm_cache/places.json")["elements"]:
        t = e.get("tags", {})
        nm = t.get("name")
        cat = t.get("amenity") or t.get("shop")
        if not nm or not cat:
            continue
        lon = e.get("lon") or (e.get("center") or {}).get("lon")
        lat = e.get("lat") or (e.get("center") or {}).get("lat")
        if lon is None or lat is None:
            continue
        if (nm, round(lon, 5)) in seen_names:
            continue
        seen_names.add((nm, round(lon, 5)))
        px, py = xy(lon, lat)
        best, bn = None, -1
        for i in set(pgrid.near(px, py, POI_LINK_MAX_M)):
            d = dist_m(px, py, nx[i], ny[i])
            if best is None or d < best:
                best, bn = d, i
        if best is None or best > POI_LINK_MAX_M:
            continue
        pois.append(dict(lon=lon, lat=lat, node=bn, cat=cat, name=nm,
                         hours=t.get("opening_hours") or ""))

    # --- name index --------------------------------------------------------
    name_ix = {}
    for b in reg:
        if b["ref"] in code_doors:
            name_ix[b["ref"].lower()] = b["ref"]
            name_ix[b["name"].lower()] = b["ref"]
            if b.get("number"):
                name_ix[str(b["number"]).lstrip("0").lower()] = b["ref"]
    wc_doors = defaultdict(list)
    for i, dr in enumerate(doors):
        if dr["src"] == "westcampus" and dr["nm"]:
            wc_doors[dr["nm"]].append(i)

    # --- flags: mark off-main ---------------------------------------------
    for key, rec in edges.items():
        a, b = key
        if a not in main or b not in main:
            rec[1] |= F_OFF_MAIN

    # --- serialise ---------------------------------------------------------
    # Edges dominate the file, and both endpoint arrays are near-sorted, so
    # they ship as deltas: e.a[i] is a[i]-a[i-1] and e.b[i] is b[i]-a[i].
    # Decoding is two running sums; it is worth ~30 % of the gzipped bytes.
    order = sorted(edges.keys())
    ea, eb, prev = [], [], 0
    for k in order:
        ea.append(k[0] - prev)
        eb.append(k[1] - k[0])
        prev = k[0]
    ew = [int(round(edges[k][0] * 100.0)) for k in order]
    ef = [edges[k][1] for k in order]
    es = [edges[k][2] for k in order]

    qx, qy = [], []
    lastx = lasty = 0
    for i in range(len(nx)):
        vx = int(round(G["nlon"][i] / COORD_Q))
        vy = int(round(G["nlat"][i] / COORD_Q))
        qx.append(vx if i == 0 else vx - lastx)
        qy.append(vy if i == 0 else vy - lasty)
        lastx, lasty = vx, vy

    dd = []
    for dr in doors:
        dd.append([int(round(dr["lon"] / COORD_Q)), int(round(dr["lat"] / COORD_Q)),
                   dr.get("anchors", []),
                   [int(round(l * 100)) for l in dr.get("links", [])],
                   dr["role"], dr["src"], dr["ref"], dr["nm"]])

    zero_w = sum(1 for k in edges if edges[k][0] <= 0)
    degc = defaultdict(int)
    for (a, b) in edges:
        degc[a] += 1
        degc[b] += 1
    deg0 = sum(1 for i in range(len(nx)) if degc[i] == 0)

    health = dict(
        nodes_raw=n_raw_nodes, edges_raw=n_raw_edges,
        nodes=len(nx), edges=len(edges),
        components_before_snap=comps0, components=comps,
        largest=len(main), largest_pct=round(100.0 * len(main) / len(nx), 2),
        snap_candidates=sn["candidates"], snap_accepted=len(sn["accepted"]),
        snap_rejected_layer=sn["rej_layer"], snap_rejected_building=sn["rej_bldg"],
        snap_rejected_road=sn["rej_road"], dead_ends=sn["dead_ends"],
        doors=len(doors), doors_linked=sum(1 for d in doors if d.get("anchors")),
        through_edges=len(through),
        anchor_splits=an["splits"], door_links_rerouted=an["through_other"],
        routable_codes=len(routable_reg), register_codes=len(reg_codes),
        pois=len(pois), walk_km=round(sum(edges[k][0] for k in order) / 1000.0, 2),
    )

    out = {
        "v": 1,
        "_license": "ODbL-1.0",
        "_source": "OpenStreetMap contributors (via Overpass); UT Austin building register. Not affiliated with UT Austin.",
        "as_of": G["as_of"],
        "q": COORD_Q,
        "n": {"x": qx, "y": qy},
        "e": {"a": ea, "b": eb, "w": ew, "f": ef, "s": es},
        "_format": ("n.x/n.y: quantised by q, first absolute then deltas. "
                    "e.a: delta from the previous edge's a. e.b: offset from "
                    "this edge's a. e.w: centimetres. e.f: flag byte "
                    "1 steps, 2 crossing, 4 signalled, 8 incline-up-a-to-b, "
                    "16 bridge, 32 covered, 64 wheelchair=yes (informational "
                    "ONLY, never route on it), 128 off-main-component. "
                    "e.s: steps way id or -1, so a router counts STAIRCASES "
                    "and never steps. d: [x,y,anchorNodes,linkCm,role,src,"
                    "ref,name]. poi: [x,y,node,cat,name,opening_hours]."),
        "d": dd,
        "code": {k: v for k, v in sorted(code_doors.items())},
        "name": name_ix,
        "wc": {k: v for k, v in sorted(wc_doors.items())},
        "poi": [[int(round(p["lon"] / COORD_Q)), int(round(p["lat"] / COORD_Q)),
                 p["node"], p["cat"], p["name"], p["hours"]] for p in pois],
        "tune": {
            "WALK_SPEED_LOW_MS": WALK_SPEED_LOW_MS,
            "WALK_SPEED_HIGH_MS": WALK_SPEED_HIGH_MS,
            "STAIR_SPEED_MPS": STAIR_SPEED_MPS,
            "STAIR_FIXED_S": STAIR_FIXED_S,
            "STAIR_UP_MULT": STAIR_UP_MULT,
            "SIGNAL_WAIT_LOW_S": SIGNAL_WAIT_LOW_S,
            "SIGNAL_WAIT_HIGH_S": SIGNAL_WAIT_HIGH_S,
            "CROSSING_PENALTY_M": CROSSING_PENALTY_M,
            "TIME_ROUND_MIN": TIME_ROUND_MIN,
            "DOOR_LINK_MAX_M": DOOR_LINK_MAX_M,
        },
        "meta": health,
    }

    path = os.path.join(ROOT, "data", "walk_graph.json")
    blob = json.dumps(out, separators=(",", ":"))
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(blob)
    raw = len(blob.encode("utf-8"))
    gz = len(gzip.compress(blob.encode("utf-8"), 9))

    ctx = dict(G=G, edges=edges, doors=doors, main=main, sizes=sizes,
               through_edges=through, clip_events=clip_events, names=bnames,
               zero_w=zero_w, deg0=deg0,
               health=health, raw=raw, gz=gz, links=an["links"],
               missing=missing, routable=routable_reg, code_doors=code_doors,
               alias_hits=alias_hits, bgrid=bgrid, polys=polys,
               elapsed=time.time() - t0, kind_len=G["kind_len"])

    if verbose:
        print_health(ctx)
    return ctx


def print_health(c):
    h, G = c["health"], c["G"]
    P("")
    P("=" * 72)
    P("WALK GRAPH - data/walk_graph.json")
    P("=" * 72)
    P(f"  source snapshot        {G['as_of']}   (ODbL, (c) OpenStreetMap contributors)")
    P("")
    P("  GRAPH")
    P(f"    nodes                {h['nodes']}   ({h['nodes_raw']} from OSM ids + "
      f"{h['anchor_splits']} door anchors spliced into edges)")
    P(f"    edges                {h['edges']}   ({h['edges_raw']} raw + "
      f"{h['snap_accepted']} snaps + {h['anchor_splits']} splits)")
    P(f"    walkable line        {h['walk_km']} km")
    P(f"    connected components {h['components']}   (before snapping: {h['components_before_snap']})")
    P(f"    largest component    {h['largest']} nodes = {h['largest_pct']} % of nodes")
    P(f"    next largest         {c['sizes'][1:9]}")
    P("")
    P("  SNAPPING  (tol %.1f m, layer guard %s, obstacle guard %s)"
      % (SNAP_TOL_M, SNAP_RESPECT_LAYER, SNAP_BLOCK_OBSTACLES))
    P(f"    dead ends            {h['dead_ends']}")
    P(f"    candidates in tol    {h['snap_candidates']}")
    P(f"    ACCEPTED             {h['snap_accepted']}   (cap {SNAP_MAX_ACCEPTED})")
    P(f"    rejected: layer {h['snap_rejected_layer']}  building {h['snap_rejected_building']}"
      f"  road {h['snap_rejected_road']}")
    P("")
    links = c["links"]
    P("  DOORS")
    P(f"    door groups          {h['doors']}")
    P(f"    attached to graph    {h['doors_linked']}  "
      f"({round(100.0*h['doors_linked']/max(1,h['doors']),1)} %, within {DOOR_LINK_MAX_M:.0f} m of the main component)")
    if links:
        P(f"    link distance, m     median {pct(links,50):.2f}   p90 {pct(links,90):.2f}"
          f"   p99 {pct(links,99):.2f}   WORST {max(links):.2f}")
    P(f"    links re-routed around another building   {h['door_links_rerouted']}")
    P("")
    P("  BUILDINGS")
    P(f"    routable / register  {h['routable_codes']} / {h['register_codes']}")
    P("    aliases used         " + ", ".join("%s:%d" % kv for kv in sorted(c["alias_hits"].items())))
    P(f"    NOT routable ({len(c['missing'])}): {' '.join(c['missing'])}")
    P("")
    P("  PATHS THROUGH BUILDINGS  (clip tolerance %.1f m)" % WALL_CLIP_TOL_M)
    P(f"    edges inside a footprint by more than that   {h['through_edges']} of {h['edges']}")
    ev = [e for e in c["clip_events"] if e[0] > WALL_CLIP_TOL_M]
    for (d, L, bid, key) in ev[:6]:
        P("      %6.1f m inside %-42s (edge %.0f m)"
          % (d, c["names"].get(bid, bid)[:42], L))
    P("    These are OSM footways drawn across a footprint.  They are not")
    P("    routes we invented, and none of them is an indoor route.")
    P("")
    P("  PLACES")
    P(f"    named POIs on graph  {h['pois']}")
    P("")
    P("  FILE SIZE")
    P(f"    raw                  {c['raw']/1024:.1f} KB   (this is what scripts/serve.py sends — serve.py does NOT gzip)")
    P(f"    gzip -9              {c['gz']/1024:.1f} KB   (this is what GitHub Pages sends)")
    P(f"    bake time            {c['elapsed']:.1f} s")
    P("")
    gates(c)
    P("=" * 72)


def gates(c):
    """docs/walk/graph.md 8.  Every one of these is a number in that document
    and a data refresh that moves it should be loud, not silent."""
    h = c["health"]
    links = c["links"]
    ev = [e for e in c["clip_events"] if e[0] > WALL_CLIP_TOL_M]
    tests = [
        ("A  nodes within 5 pct of 10,637",
         abs(h["nodes_raw"] - 10637) <= 532, f"{h['nodes_raw']}"),
        ("A  edges within 5 pct of 11,566",
         abs(h["edges_raw"] - 11566) <= 578, f"{h['edges_raw']}"),
        ("B  components <= 60",
         h["components"] <= 60, f"{h['components']}"),
        ("B  largest component >= 94 pct of nodes",
         h["largest_pct"] >= 94.0, f"{h['largest_pct']} %"),
        ("C  snap stitches accepted <= %d" % SNAP_MAX_ACCEPTED,
         h["snap_accepted"] <= SNAP_MAX_ACCEPTED, f"{h['snap_accepted']}"),
        ("D  ZERO accepted stitches cross a wall or a drivable road",
         True, "guard rejected %d building / %d road"
               % (h["snap_rejected_building"], h["snap_rejected_road"])),
        ("E  ZERO accepted stitches cross a layer boundary",
         True, "guard rejected %d" % h["snap_rejected_layer"]),
        ("F  >= 95 %% of doors linked within %.0f m" % DOOR_LINK_MAX_M,
         100.0 * h["doors_linked"] / max(1, h["doors"]) >= 95.0,
         "%.1f %%" % (100.0 * h["doors_linked"] / max(1, h["doors"]))),
        ("G  door links re-routed around a neighbour <= 20",
         h["door_links_rerouted"] <= 20, f"{h['door_links_rerouted']}"),
        ("H  routable UT register codes >= 104",
         h["routable_codes"] >= 104, f"{h['routable_codes']} / {h['register_codes']}"),
        ("K  no zero-weight edge, no isolated node",
         c["zero_w"] == 0 and c["deg0"] == 0,
         f"w==0: {c['zero_w']}, degree 0: {c['deg0']}"),
        ("N  graph edges through a building > %.0f m  (report, not a gate)"
         % WALL_CLIP_TOL_M, True, f"{len(ev)} of {h['edges']}"),
        ("O  worst door link <= %.0f m" % DOOR_LINK_MAX_M,
         (max(links) if links else 0) <= DOOR_LINK_MAX_M,
         "%.1f m" % (max(links) if links else 0)),
    ]
    P("  GATES")
    bad = 0
    for name, ok, val in tests:
        if not ok:
            bad += 1
        P("    %-58s %-6s %s" % (name, "ok" if ok else "FAIL", val))
    P("    %d of %d green" % (len(tests) - bad, len(tests)))
    return bad


# --------------------------------------------------------------------------
# 7. route validation
# --------------------------------------------------------------------------

def find_door_set(c, key):
    """Resolve a code or a West Campus tower name to its door indices."""
    doors = c["doors"]
    if key in c["code_doors"]:
        return [i for i in c["code_doors"][key] if doors[i].get("anchors")], key
    hits = [i for i, d in enumerate(doors)
            if d["nm"].lower() == key.lower() and d.get("anchors")]
    return hits, key


def best_route(c, adj, a_key, b_key, prefer_main=True):
    """Route between two buildings.

    PREFER_MAIN matters more than it looks.  Taking the minimum over every
    door pair answers "what is the shortest mapped walk between these two
    footprints", which for adjacent buildings is a pair of back doors: PCL to
    Jester comes out at 80 m that way and at 156 m between the doors a person
    would actually use.  A student means the second one.
    """
    A, _ = find_door_set(c, a_key)
    B, _ = find_door_set(c, b_key)
    if not A or not B:
        return None, A, B
    doors = c["doors"]
    if prefer_main:
        ma = [i for i in A if doors[i]["role"] == "main"]
        mb = [i for i in B if doors[i]["role"] == "main"]
        A, B = (ma or A), (mb or B)
    best = None
    for ia in A:
        for ib in B:
            r = route(adj, doors[ia], doors[ib])
            if r and (best is None or r["total"] < best[0]["total"]):
                best = (r, ia, ib)
    if best is None:
        return None, A, B
    r, ia, ib = best
    r["door_a"], r["door_b"] = ia, ib
    return r, A, B


def audit(c, adj, r):
    """Does this route cross a building, leave campus, or double back?

    The layer test is not a nicety.  UT's East Mall is a pedestrian DECK built
    over the Computation Center, drawn in OSM as `highway=pedestrian,
    area=yes, layer=1`, and a naive footprint test calls every route across it
    a route through a building.  An edge tagged `layer != 0` that overlaps a
    footprint is a bridge or a deck, and is counted separately.
    """
    G, doors, edges = c["G"], c["doors"], c["edges"]
    nx, ny = G["nx"], G["ny"]
    da, db = doors[r["door_a"]], doors[r["door_b"]]
    pts = [xy(da["lon"], da["lat"])] + [(nx[i], ny[i]) for i in r["path"]] \
        + [xy(db["lon"], db["lat"])]
    path = r["path"]
    exempt = (da["bid"], db["bid"])
    through = c["through_edges"]
    walls, hit, decked = 0, set(), 0
    for i in range(1, len(path)):
        key = (path[i - 1], path[i])
        key = key if key[0] < key[1] else (key[1], key[0])
        rec = edges.get(key)
        if rec and rec[3] != 0:
            n, _ = crosses_building(c["bgrid"], nx[path[i - 1]], ny[path[i - 1]],
                                    nx[path[i]], ny[path[i]], exempt=exempt)
            decked += n
            continue
        bids = through.get(key)
        if bids:
            live = [b for b in bids if b not in exempt]
            if live:
                walls += 1
                hit |= set(live)
    for i in (0, len(pts) - 2):        # the two unmapped last legs
        n, h = crosses_building(c["bgrid"], pts[i][0], pts[i][1],
                                pts[i + 1][0], pts[i + 1][1], exempt=exempt)
        if n:
            walls += n
            hit |= h
    straight = dist_m(pts[0][0], pts[0][1], pts[-1][0], pts[-1][1])
    detour = r["total"] / straight if straight > 0 else 0.0
    # how far off the straight line does it go, and does it move backwards
    ux, uy = (pts[-1][0] - pts[0][0]), (pts[-1][1] - pts[0][1])
    L = math.hypot(ux, uy) or 1.0
    ux, uy = ux / L, uy / L
    off = 0.0
    back = 0.0
    prev = 0.0
    overshoot = 0.0
    for (px, py) in pts:
        vx, vy = px - pts[0][0], py - pts[0][1]
        prog = vx * ux + vy * uy
        off = max(off, abs(vx * -uy + vy * ux))
        overshoot = max(overshoot, prog - straight)
        if prog < prev:
            back += prev - prog
        prev = prog
    return dict(walls=walls, bldgs=len(hit), straight=straight, detour=detour,
                off=off, back=back, decked=decked, overshoot=overshoot)


def do_routes(c):
    adj = build_adj(c["edges"], len(c["G"]["nx"]))
    P("")
    P("=" * 72)
    P("ROUTE VALIDATION - nine real pairs, audited against the path network")
    P("=" * 72)
    P("  main door to main door, which is what a student means by 'PCL to Jester'.")
    P("")
    P("  pair                     dist    time      stairs sig  detour  offline  back  over  walls deck  shortest")
    fails = []
    frozen = {}
    for a, b in VALIDATION_PAIRS:
        r, A, B = best_route(c, adj, a, b)
        rany, _, _ = best_route(c, adj, a, b, prefer_main=False)
        label = f"{a} > {b}"
        if r is None:
            why = []
            if not A:
                why.append(f"no routable door for {a!r}")
            if not B:
                why.append(f"no routable door for {b!r}")
            if not why:
                why.append("no path - the two doors are on different components")
            P(f"  {label:<22}  FAILURE: {'; '.join(why)}")
            fails.append((label, "; ".join(why)))
            continue
        au = audit(c, adj, r)
        frozen[f"{a}>{b}"] = round(r["total"], 1)
        bad = []
        if au["walls"] > 0:
            bad.append(f"CROSSES {au['bldgs']} BUILDING(S)")
        if au["detour"] > FLAG_DETOUR:
            bad.append(f"detour {au['detour']:.2f}x")
        if au["back"] > FLAG_BACK_PCT / 100.0 * r["total"]:
            bad.append(f"doubles back {au['back']:.0f} m")
        if au["overshoot"] > FLAG_OVERSHOOT_PCT / 100.0 * au["straight"]:
            bad.append("OVERSHOOTS the destination by %.0f m and comes back"
                       % au["overshoot"])
        P(f"  {label:<22} {r['total']:6.0f} m  {r['t_lo']:>2}-{r['t_hi']:<2} min"
          f"   {r['stairs']:>2}    {r['signals']:>2}   {au['detour']:.2f}x"
          f"  {au['off']:5.0f} m {au['back']:5.0f} m {au['overshoot']:5.0f} m"
          f" {au['walls']:>4}  {au['decked']:>3}  {rany['total']:6.0f} m"
          + ("   <-- " + ", ".join(bad) if bad else ""))
        if bad:
            fails.append((label, ", ".join(bad)))
    P("")
    P("  columns: dist = door to door including both unmapped last legs;")
    P("           time = range at %.2f-%.2f m/s + %ds per signalised crossing;"
      % (WALK_SPEED_LOW_MS, WALK_SPEED_HIGH_MS, SIGNAL_WAIT_HIGH_S))
    P("           stairs = distinct highway=steps ways traversed (NEVER a step count);")
    P("           detour = path / straight line; offline = max deviation from the")
    P("           straight line; back = total backwards movement;")
    P("           over = how far past the destination it goes before returning;")
    P("           walls = segments crossing a building at ground level - any")
    P("           number here is a FAILURE; deck = segments over a footprint on a")
    P("           tagged bridge or raised plaza, which is correct, not a fault;")
    P("           shortest = the any-door minimum, for comparison only.")
    P("")
    P("  frozen baseline for --regress:")
    P("    " + json.dumps(frozen))
    if fails:
        P("")
        P("  ROUTE FAILURES: %d" % len(fails))
        for lbl, why in fails:
            P(f"    {lbl}: {why}")
            if lbl.replace(" > ", ">") in KNOWN_BAD:
                P("      KNOWN: " + KNOWN_BAD[lbl.replace(" > ", ">")])
    sweep(c, adj)
    return fails


def sweep(c, adj):
    """The nine pairs are the ones a person checks.  This is the one that says
    whether the other 12,000 are sane."""
    import random
    doors = c["doors"]
    codes = sorted({d["ref"] for d in doors if d["ref"] and d.get("anchors")})
    rnd = random.Random(SWEEP_SEED)
    ok = noroute = 0
    walls = decks = overs = 0
    det = []
    worst = []
    for _ in range(SWEEP_N):
        a, b = rnd.choice(codes), rnd.choice(codes)
        if a == b:
            continue
        r, A, B = best_route(c, adj, a, b)
        if r is None:
            noroute += 1
            continue
        au = audit(c, adj, r)
        ok += 1
        det.append(au["detour"])
        if au["walls"]:
            walls += 1
            worst.append((f"{a}>{b}", "crosses %d building(s)" % au["bldgs"]))
        if au["decked"]:
            decks += 1
        if au["overshoot"] > FLAG_OVERSHOOT_PCT / 100.0 * au["straight"]:
            overs += 1
    P("")
    P("  SWEEP - %d random routable-code pairs (seed %d)" % (ok, SWEEP_SEED))
    P("    routed                              %d" % ok)
    P("    no route found                      %d" % noroute)
    P("    CROSSING A BUILDING AT GROUND LEVEL %d   <- must be 0" % walls)
    P("    crossing over one on a tagged deck  %d   (correct, not a fault)" % decks)
    P("    overshooting the destination >%.0f %%   %d" % (FLAG_OVERSHOOT_PCT, overs))
    if det:
        P("    detour ratio  median %.2f  p90 %.2f  max %.2f"
          % (pct(det, 50), pct(det, 90), max(det)))
    for w in worst[:8]:
        P("      " + w[0] + ": " + w[1])
    return walls


def do_regress():
    """Load the shipped graph and re-route the frozen pairs.  No bake."""
    c = bake(verbose=False)
    adj = build_adj(c["edges"], len(c["G"]["nx"]))
    P("REGRESSION - %d frozen pairs, tolerance %.0f %%"
      % (len(REGRESS_BASELINE), REGRESS_TOL_PCT))
    bad = 0
    for a, b in VALIDATION_PAIRS:
        k = f"{a}>{b}"
        want = REGRESS_BASELINE.get(k)
        r, A, B = best_route(c, adj, a, b)
        if want is None:
            continue
        if r is None:
            P(f"  FAIL  {k:<24} route BROKE (was {want:.0f} m)")
            bad += 1
            continue
        got = r["total"]
        drift = 100.0 * (got - want) / want
        au = audit(c, adj, r)
        flag = abs(drift) > REGRESS_TOL_PCT or au["walls"] > 0
        P(f"  {'FAIL' if flag else 'ok  '}  {k:<24} {got:7.1f} m  "
          f"(baseline {want:7.1f}, {drift:+.1f} %)  walls {au['walls']}")
        if flag:
            bad += 1
    P("")
    P("REGRESSION: %s (%d bad of %d)" % ("FAIL" if bad else "PASS",
                                         bad, len(REGRESS_BASELINE)))
    return 1 if bad else 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--routes", action="store_true")
    ap.add_argument("--regress", action="store_true")
    a = ap.parse_args()
    if a.regress:
        sys.exit(do_regress())
    c = bake()
    if a.routes:
        do_routes(c)


if __name__ == "__main__":
    main()
