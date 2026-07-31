#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""bake_outer.py — turn the raw tripled-bbox extract into the CHEAP outer ring.

    data/outer/outer_raw.geojson   ->   data/outer_ring.geojson
                                        data/outer/outer_report.json

WHY THE OUTER RING IS A SECOND CLASS OF BUILDING, ON PURPOSE.

The core scene (scripts/config.sh's 2.5 x 2.2 km box) is 3,057 buildings that
each pay for: a facade pattern from the quantised atlas, a contact-shadow line
with a 44 px blur, a parapet roof cap, a swept ground shadow, a label, and in
some cases hero palettes, OSM parts and pitched roof facets. That scene ALREADY
auto-drops itself to the performance preset at ~30 fps (js/graphics.js). Adding
ten times its AREA at that price is not a trade-off, it is a crash.

So the ring is built to be nearly free, and everything it does not get is listed
in docs/OUTER_RING.md and enforced HERE, at bake time, where a cut costs nothing
at runtime:

  * geometry is simplified in metres, holes are dropped, MultiPolygons keep
    only their largest ring
  * a minimum-footprint-area cull that GROWS with distance from the nearest of
    two anchors (the core, and downtown), so the ring thins out toward the
    horizon instead of ending at one
  * five properties per feature — `h`, three baked colours, and a density rank
    `d`. No id, no name, no class, no source_height, because nothing downstream
    reads them
  * colours come from a five-tone city palette (plus four tower materials)
    instead of the core's 14 data-derived buckets, with the horizon fade
    already mixed in

THE ONE EXCEPTION, and it is the whole reason for reaching south: downtown
towers. A building at or above TOWER_H is tagged `t=1` and js/outer.js renders
it with the core's EXISTING facade atlas (no new pattern images) plus a roof
cap, because the skyline silhouette is what a stranger scrolling past uses to
decide whether this is Austin.

DEDUP. The new box swallows both the core snapshot and the Capitol Complex
(js/capitol.js). Nothing here is allowed to double-draw either:
  * extract_outer.py already excludes the exact set the core extraction took
    (same "fully inside the box" predicate, negated)
  * this script then does a GEOMETRIC pass against the real footprints of the
    core snapshot AND data/capitol.geojson, so a building that straddles a seam
    — rejected by the core for not being fully inside, and possibly present in
    the Capitol's OSM bake — is caught by overlap rather than by a rectangle

Usage:  python scripts/bake_outer.py [snapshot-date]
"""
import json
import math
import colorsys
import hashlib
import os
import sys

from shapely.geometry import shape
from shapely.strtree import STRtree

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATE = sys.argv[1] if len(sys.argv) > 1 else "2026-07-30"

RAW = os.path.join(ROOT, "data", "outer", "outer_raw.geojson")
CORE_SNAP = os.path.join(ROOT, "data", "snapshots", DATE, "buildings.detailed.geojson")
CAPITOL = os.path.join(ROOT, "data", "capitol.geojson")
OVERRIDES = os.path.join(ROOT, "scripts", "outer_heights.json")
OSM_TAGS = os.path.join(ROOT, "data", "osm_cache", "outer_tags.json")
OUT = os.path.join(ROOT, "data", "outer_ring.geojson")
REPORT = os.path.join(ROOT, "data", "outer", "outer_report.json")

# How close a curated height entry has to sit to a footprint's centroid to be
# applied. 45 m is about half a downtown block: tight enough that two towers on
# one block cannot swap heights, loose enough to survive the difference between
# an OSM centroid and an Overture one (measured spread on the 89 entries: 2-21 m).
HEIGHT_MATCH_M = 45.0
# Same idea for pulling a building CLASS off the OSM tag layer, but tighter,
# because a class applied to the wrong footprint paints a house like a church.
CLASS_MATCH_M = 22.0

# ── the boxes ─────────────────────────────────────────────────────────
OUTER = dict(minlon=-97.7880, minlat=30.2400, maxlon=-97.7020, maxlat=30.3150)
CORE = dict(minlon=-97.752, minlat=30.276, maxlon=-97.726, maxlat=30.296)
# Downtown proper: the reason the box reaches south. Density here is the point,
# so the area cull is held at its floor inside this rectangle no matter how far
# it sits from the core.
DOWNTOWN = dict(minlon=-97.7580, minlat=30.2560, maxlon=-97.7280, maxlat=30.2770)

M_LAT = 111320.0
LAT0 = 0.5 * (OUTER["minlat"] + OUTER["maxlat"])
M_LON = M_LAT * math.cos(math.radians(LAT0))

# ── the cull. Every number here is a taste dial with a measured count. ──
# Keep a footprint if it is TALL (it contributes to a silhouette at any
# distance) or BIG ENOUGH for the distance it sits at.
KEEP_ANY_HEIGHT = 24.0          # m — always keep at or above this
AREA_FLOOR = 115.0              # m^2 at an anchor's edge (a small house is ~150)
AREA_PER_KM = 170.0             # m^2 of extra threshold per km of distance
AREA_HARD_MIN = 40.0            # nothing smaller than this, ever (sheds, carports)
TOWER_H = 40.0                  # at/above: the exception that gets the atlas
# DISTANCE IS MEASURED FROM THE NEAREST OF **TWO** ANCHORS, not from the core
# alone. The first version ramped the threshold outward from the core rectangle
# only, which put the SOUTH BANK OF LADY BIRD LAKE 2.6 km "away" and culled
# almost everything there — and the along-the-lake shot came back with a
# correct downtown skyline standing behind a bare tan plain where Bouldin is.
# Downtown is the second place the camera lives, so it is the second anchor.

# Geometry simplification, in metres, also graded by distance.
SIMPLIFY_NEAR = 1.2
SIMPLIFY_PER_KM = 1.1
SIMPLIFY_TOWER = 0.6            # towers keep their plan shape; it reads

# Horizon fade: the outermost band mixes toward the haze colour so the ring
# thins into the atmosphere instead of ending at a line. js/atmosphere.js
# deliberately hugs the horizon and no longer covers the mid distance, so this
# is what carries aerial perspective for the far ring.
FADE_M = 750.0
FADE_MAX = 0.34                 # strongest mix at the very edge
HAZE_DAY = "#c4dced"
HAZE_GOLD = "#e7c49a"
HAZE_NIGHT = "#151a2e"

# Height fallbacks — the same chain scripts/enrich.py uses, so a building does
# not change height by being on the other side of the seam.
MPL = 3.2
CLASS_DEFAULT = {
    "residential": 9.0, "apartments": 18.0, "commercial": 12.0, "retail": 6.0,
    "education": 12.0, "civic": 12.0, "industrial": 8.0, "outbuilding": 4.0,
    "garage": 4.0, "parking": 12.0, "service": 4.0, "shed": 3.0,
    "house": 7.0, "detached": 7.0, "semidetached_house": 7.0, "church": 12.0,
    "school": 10.0, "university": 14.0, "hotel": 20.0, "office": 16.0,
    "roof": 4.0, "carport": 3.0, "shed_": 3.0,
}
FALLBACK_DEFAULT = 8.0

# THE PODIUM RULE. Overture's LiDAR height for a recent downtown tower is
# sometimes the PODIUM, not the roof - Sixth and Guadalupe comes back at 18.7 m
# against a true 267 m, and it is not alone. In every measured case Overture's
# own `num_floors` was right. So when a building claims a serious floor count
# and a height that cannot possibly hold it, the floor count wins.
#
# scripts/outer_heights.json covers the named towers from two published
# sources; this is the safety net for the ones nobody has named. The metres per
# floor is GENERATIVE - 3.5 m is a downtown average across office and
# residential - and it is only ever used where the alternative is a 12 m box
# standing in for a 32-storey building.
PODIUM_MIN_FLOORS = 8
PODIUM_MAX_M_PER_FLOOR = 2.4     # below this, the height cannot be the roof
PODIUM_M_PER_FLOOR = 3.5         # generative

# ── the palette ───────────────────────────────────────────────────────
# Five city tones plus four tower materials, against the core's fourteen
# data-derived buckets. The core's are derived from the data so West Campus
# keeps its character; at a kilometre and beyond that distinction is below a
# pixel, and every extra tone is one more thing to keep apart for no gain.
# Tones are pulled from the core's own baked range so the two tiers read as one
# city rather than two datasets.
PALETTE = {
    "res_warm":  "#cbb392",   # the bungalow neighbourhoods: warm painted wood
    "res_cool":  "#c2bdae",   # the other half of them, greyer
    "brick":     "#a9765d",   # east Austin + the older commercial strips
    "stone":     "#d5cdba",   # mid-rise commercial, pale stone and stucco
    "deck":      "#b0aca4",   # parking structures, raw concrete
    # FOUR tower materials, not one. The first pass gave every downtown tower
    # the same cool blue-grey, they all snapped to the same bucket in the
    # facade atlas, and the shot from campus came back with the skyline as a
    # single grey slab against a warm tan city. Downtown Austin is not one
    # material: Frost is blue-green glass, Waterline and Fairmont are dark,
    # Indeed and One American are warm bronze and limestone, the Independent
    # and the Northshore are pale. Four tones split by a stable hash gets that
    # variety back for nothing, and — because the atlas snap is nearest-colour
    # — it also spreads the towers across four different window patterns.
    "glass":     "#8fa3b4",   # cool blue-grey curtain wall
    "glass_dark": "#6d7a87",  # dark glass / bronze-black
    "glass_warm": "#a8917a",  # bronze and amber glazing
    "tower_pale": "#c9cdcd",  # white precast and pale stone
}
PAL_ORDER = list(PALETTE)
# Split of the four tower tones. Eyeballed against the real skyline from the
# south shore rather than counted: cool glass dominates, pale is next, dark and
# bronze are the accents.
TOWER_MIX = [("glass", 0.42), ("tower_pale", 0.24),
             ("glass_warm", 0.18), ("glass_dark", 0.16)]

GOLDEN_TINT = "#ffb26a"


# ── colour maths, lifted from scripts/bake_detail.py so the two tiers ──
# ── grade identically through the day. ────────────────────────────────
def hex_to_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def rgb_to_hex(r, g, b):
    return "#%02x%02x%02x" % (max(0, min(255, round(r))),
                              max(0, min(255, round(g))),
                              max(0, min(255, round(b))))


def lerp_hex(a, b, t):
    A, B = hex_to_rgb(a), hex_to_rgb(b)
    return rgb_to_hex(*(A[i] + (B[i] - A[i]) * t for i in range(3)))


def night_wall(day_hex):
    """Identical to bake_detail.night_wall — dark and cool, so the skyline
    silhouettes against the night sky instead of glowing khaki against it."""
    r, g, b = hex_to_rgb(day_hex)
    dark = (r * 0.24, g * 0.24, b * 0.24)
    cool = (17, 22, 42)
    return rgb_to_hex(*(dark[i] + (cool[i] - dark[i]) * 0.5 for i in range(3)))


def adjust_light(h, dl):
    """Shift lightness by dl (-1..1) in HLS. Same as bake_detail.adjust_light."""
    r, g, b = (v / 255 for v in hex_to_rgb(h))
    hh, ll, ss = colorsys.rgb_to_hls(r, g, b)
    ll = max(0.05, min(0.95, ll + dl))
    r, g, b = colorsys.hls_to_rgb(hh, ll, ss)
    return rgb_to_hex(r * 255, g * 255, b * 255)


def make_roof_colors(roof_hex):
    """Verbatim from bake_detail.make_roof_colors, so a tower's parapet grades
    through the day exactly like every roof cap in the core."""
    rg = lerp_hex(roof_hex, GOLDEN_TINT, 0.22)
    rn = lerp_hex(adjust_light(roof_hex, -0.38), "#10152a", 0.6)
    return roof_hex, rg, rn


def stable01(key):
    return int(hashlib.md5(key.encode()).hexdigest()[:8], 16) / 0xFFFFFFFF


# ── geometry helpers ──────────────────────────────────────────────────
def to_metres(ring):
    return [((x - OUTER["minlon"]) * M_LON, (y - OUTER["minlat"]) * M_LAT)
            for x, y in ring]


def to_degrees(ring):
    return [[round(OUTER["minlon"] + x / M_LON, 6),
             round(OUTER["minlat"] + y / M_LAT, 6)] for x, y in ring]


def ring_area(ring_m):
    """Shoelace, in m^2, on an already-metric ring."""
    a = 0.0
    n = len(ring_m)
    for i in range(n):
        x1, y1 = ring_m[i]
        x2, y2 = ring_m[(i + 1) % n]
        a += x1 * y2 - x2 * y1
    return abs(a) * 0.5


def dp(points, tol):
    """Douglas-Peucker on a metric polyline. Written out rather than reached
    for through shapely because the ring has to stay CLOSED and shapely's
    simplify on a degenerate result returns an empty polygon rather than the
    original, which silently deleted buildings on the first attempt."""
    if len(points) < 3:
        return points
    dmax, idx = 0.0, 0
    x1, y1 = points[0]
    x2, y2 = points[-1]
    dx, dy = x2 - x1, y2 - y1
    den = math.hypot(dx, dy)
    for i in range(1, len(points) - 1):
        px, py = points[i]
        d = (abs(dy * px - dx * py + x2 * y1 - y2 * x1) / den) if den > 1e-9 \
            else math.hypot(px - x1, py - y1)
        if d > dmax:
            dmax, idx = d, i
    if dmax <= tol:
        return [points[0], points[-1]]
    return dp(points[:idx + 1], tol)[:-1] + dp(points[idx:], tol)


def simplify_ring(ring_m, tol):
    """Simplify a CLOSED metric ring, keeping it closed and non-degenerate."""
    if len(ring_m) < 5:
        return ring_m
    open_ring = ring_m[:-1]
    # Anchor the split at the two furthest-apart-ish points so DP cannot
    # collapse the whole loop into a line: run it as two halves of the loop.
    half = len(open_ring) // 2
    a = dp(open_ring[:half + 1], tol)
    b = dp(open_ring[half:] + [open_ring[0]], tol)
    out = a[:-1] + b[:-1]
    if len(out) < 3:
        return ring_m
    return out + [out[0]]


def dist_outside_rect(lon, lat, r):
    """Metres from (lon,lat) to the nearest point of rect r; 0 inside."""
    dx = max(r["minlon"] - lon, 0.0, lon - r["maxlon"]) * M_LON
    dy = max(r["minlat"] - lat, 0.0, lat - r["maxlat"]) * M_LAT
    return math.hypot(dx, dy)


def dist_inside_edge(lon, lat, r):
    """Metres from (lon,lat) to the nearest EDGE of rect r, from inside."""
    return min((lon - r["minlon"]) * M_LON, (r["maxlon"] - lon) * M_LON,
               (lat - r["minlat"]) * M_LAT, (r["maxlat"] - lat) * M_LAT)


def in_rect(lon, lat, r):
    return (r["minlon"] <= lon <= r["maxlon"]) and (r["minlat"] <= lat <= r["maxlat"])


def load(path, default=None):
    if not os.path.exists(path):
        print(f"  [skip] {path} not found")
        return default
    with open(path, encoding="utf-8") as f:
        return json.load(f)


class PointIndex:
    """Nearest-point lookup on a fixed metric grid.

    A linear scan over 89 height entries x 40,656 candidates is fine; the same
    scan over 35,538 OSM tag rows is 1.4 billion distance tests and turns a
    30-second bake into an afternoon. One grid, cell = the match radius, so a
    query only ever looks at nine cells.
    """

    def __init__(self, rows, cell_m):
        self.cell = cell_m
        self.g = {}
        self.rows = rows
        for i, r in enumerate(rows):
            x = (r["lon"] - OUTER["minlon"]) * M_LON
            y = (r["lat"] - OUTER["minlat"]) * M_LAT
            self.g.setdefault((int(x // cell_m), int(y // cell_m)), []).append((x, y, i))

    def nearest(self, lon, lat, max_m):
        x = (lon - OUTER["minlon"]) * M_LON
        y = (lat - OUTER["minlat"]) * M_LAT
        cx, cy = int(x // self.cell), int(y // self.cell)
        best, bd = None, max_m * max_m
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for (px, py, i) in self.g.get((cx + dx, cy + dy), ()):
                    d = (px - x) ** 2 + (py - y) ** 2
                    if d < bd:
                        bd, best = d, i
        return None if best is None else self.rows[best]


# ── material choice ───────────────────────────────────────────────────
RES_CLASSES = {"house", "detached", "semidetached_house", "residential",
               "bungalow", "terrace", "static_caravan", "cabin"}
CIVIC_CLASSES = {"commercial", "retail", "industrial", "office", "civic",
                 "public", "government", "medical", "hospital", "service",
                 "warehouse", "transportation", "school", "university",
                 "college", "church", "chapel", "hotel", "museum", "supermarket"}


def material_for(cls, h, area, lon, lat, key):
    """Six tones, chosen by class where OSM gives one and by size where it does
    not. 95% of the Overture rows in this box carry `class = NULL`, so the
    fallbacks matter far more here than they do in the core."""
    cls = (cls or "").lower()
    if "parking" in cls or "garage" in cls or "carport" in cls:
        return "deck"
    if h >= TOWER_H:
        roll = stable01(key + ":t")
        acc = 0.0
        for name, w in TOWER_MIX:
            acc += w
            if roll < acc:
                return name
        return TOWER_MIX[0][0]
    downtown = in_rect(lon, lat, DOWNTOWN)
    if h >= 26:
        # Mid-rise: glass downtown, pale stone elsewhere, with a little variety.
        return "glass" if (downtown and stable01(key + ":g") < 0.55) else "stone"
    if cls in CIVIC_CLASSES:
        return "brick" if stable01(key + ":b") < 0.30 else "stone"
    if cls in RES_CLASSES:
        return "res_warm" if stable01(key + ":r") < 0.62 else "res_cool"
    if h >= 14 or area >= 900:
        return "stone"
    # Unclassed and small. In this box that is overwhelmingly a bungalow, and
    # two tones keep a neighbourhood from reading as one flat slab from the air.
    return "res_warm" if stable01(key + ":r") < 0.62 else "res_cool"


def main():
    raw = load(RAW)
    if not raw:
        sys.exit("run scripts/extract_outer.py first")
    core = load(CORE_SNAP, {"features": []})
    cap = load(CAPITOL, {"features": []})
    overrides = load(OVERRIDES, {"by_point": []})
    osm_rows = load(OSM_TAGS, [])
    osm_idx = PointIndex(
        [{"lon": r["x"], "lat": r["y"], **r} for r in osm_rows], CLASS_MATCH_M) \
        if osm_rows else None
    print(f"  {len(osm_rows)} OSM tag rows, "
          f"{len(overrides.get('by_point') or [])} curated heights")

    # ── dedup index: the real footprints already on screen ────────────
    existing = []
    for f in list(core.get("features", [])) + list(cap.get("features", [])):
        try:
            g = shape(f["geometry"])
            if g.is_valid and not g.is_empty:
                existing.append(g)
        except Exception:  # noqa: BLE001 -- a bad ring is not worth dying over
            pass
    tree = STRtree(existing) if existing else None
    print(f"  dedup index: {len(existing)} footprints already in the scene")

    feats = raw["features"]
    print(f"  raw candidates: {len(feats)}")

    kept, out = 0, []
    n_dedup = n_small = 0
    n_tower = 0
    n_over_h = {"overture": 0, "osm_height": 0, "osm_levels": 0,
                "overture_floors": 0, "class_default": 0,
                "curated": 0, "podium_rule": 0}
    verts_in = verts_out = 0
    area_hist = {}
    podium_examples = []

    # ── PASS A: parse geometry, class and a base height for everything ──
    cands = []
    for f in feats:
        p = f.get("properties") or {}
        geom = f.get("geometry") or {}
        gtype = geom.get("type")
        if gtype == "Polygon":
            polys = [geom["coordinates"]]
        elif gtype == "MultiPolygon":
            polys = geom["coordinates"]
        else:
            continue

        # Largest ring only: an outer-ring building never needs its courtyard.
        best_ring_m, best_area = None, 0.0
        for poly in polys:
            rm = to_metres(poly[0])
            a = ring_area(rm)
            if a > best_area:
                best_area, best_ring_m = a, rm
        if best_ring_m is None or best_area <= 0:
            continue
        verts_in += len(best_ring_m)

        cx = sum(x for x, _ in best_ring_m) / len(best_ring_m)
        cy = sum(y for _, y in best_ring_m) / len(best_ring_m)
        lon = OUTER["minlon"] + cx / M_LON
        lat = OUTER["minlat"] + cy / M_LAT

        # ── class: OSM's `building=*` beats Overture's mostly-NULL class ──
        osm = osm_idx.nearest(lon, lat, CLASS_MATCH_M) if osm_idx else None
        cls = (osm.get("b") if osm else None) or p.get("building_class")

        # ── height chain ─────────────────────────────────────────────
        # Same order as scripts/enrich.py (Overture first, it is LiDAR), plus
        # the podium rule. The curated corrections are applied in PASS B.
        floors = p.get("num_floors")
        h = p.get("overture_height")
        src = "overture"
        if h and floors and floors >= PODIUM_MIN_FLOORS \
                and h < floors * PODIUM_MAX_M_PER_FLOOR:
            if len(podium_examples) < 12:
                podium_examples.append(
                    {"name": p.get("name"), "was": round(float(h), 1),
                     "floors": floors, "now": round(floors * PODIUM_M_PER_FLOOR, 1)})
            h, src = floors * PODIUM_M_PER_FLOOR, "podium_rule"
        if not h and osm and osm.get("h"):
            h, src = float(osm["h"]), "osm_height"
        if not h and osm and osm.get("lv"):
            h, src = float(osm["lv"]) * MPL, "osm_levels"
        if not h and floors:
            h, src = float(floors) * MPL, "overture_floors"
        if not h:
            h = CLASS_DEFAULT.get(cls, FALLBACK_DEFAULT)
            src = "class_default"

        cands.append({"ring": best_ring_m, "area": best_area, "lon": lon,
                      "lat": lat, "h": float(h), "src": src, "cls": cls,
                      "id": p.get("id"), "name": p.get("name")})

    # ── PASS B: curated heights, ONE footprint each ──────────────────
    # Assigned override -> footprint, not footprint -> nearest override. The
    # other direction is what produced 148 "corrections" from 89 entries: a
    # tower's parking garage sits well inside 45 m of it and cheerfully took
    # the tower's 267 m. Containment decides it where it can; nearest-centroid
    # is the tie-break, and each entry is spent exactly once.
    grid = {}
    CELL = HEIGHT_MATCH_M
    for i, c in enumerate(cands):
        gx = int((c["lon"] - OUTER["minlon"]) * M_LON // CELL)
        gy = int((c["lat"] - OUTER["minlat"]) * M_LAT // CELL)
        grid.setdefault((gx, gy), []).append(i)

    def ring_contains(ring_m, px, py):
        inside = False
        j = len(ring_m) - 1
        for k in range(len(ring_m)):
            xi, yi = ring_m[k]
            xj, yj = ring_m[j]
            if (yi > py) != (yj > py) and px < (xj - xi) * (py - yi) / (yj - yi) + xi:
                inside = not inside
            j = k
        return inside

    n_curated = n_curated_missed = 0
    for e in (overrides.get("by_point") or []):
        px = (e["lon"] - OUTER["minlon"]) * M_LON
        py = (e["lat"] - OUTER["minlat"]) * M_LAT
        gx, gy = int(px // CELL), int(py // CELL)
        contained, nearest, nd = None, None, HEIGHT_MATCH_M ** 2
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for i in grid.get((gx + dx, gy + dy), ()):
                    c = cands[i]
                    cxm = (c["lon"] - OUTER["minlon"]) * M_LON
                    cym = (c["lat"] - OUTER["minlat"]) * M_LAT
                    d2 = (cxm - px) ** 2 + (cym - py) ** 2
                    if ring_contains(c["ring"], px, py):
                        # Two footprints can contain one point (a tower over its
                        # own podium); the bigger one is the tower.
                        if contained is None or c["area"] > cands[contained]["area"]:
                            contained = i
                    if d2 < nd:
                        nd, nearest = d2, i
        pick = contained if contained is not None else nearest
        if pick is None:
            n_curated_missed += 1
            continue
        cands[pick]["h"] = float(e["height"])
        cands[pick]["src"] = "curated"
        n_curated += 1
    print(f"  curated heights applied to {n_curated} footprints "
          f"({n_curated_missed} found no footprint)")

    # ── PASS C: cull, dedup, simplify, colour, emit ──────────────────
    for c in cands:
        best_ring_m, best_area = c["ring"], c["area"]
        lon, lat, h, src, cls = c["lon"], c["lat"], c["h"], c["src"], c["cls"]
        p = {"id": c["id"], "name": c["name"]}

        # ── the cull ─────────────────────────────────────────────────
        # Two anchors: the modelled core, and downtown. See the note by
        # AREA_PER_KM for why one anchor emptied the lake's south bank.
        d = min(dist_outside_rect(lon, lat, CORE),
                dist_outside_rect(lon, lat, DOWNTOWN))
        need = AREA_FLOOR + AREA_PER_KM * (d / 1000.0)
        if best_area < AREA_HARD_MIN or (h < KEEP_ANY_HEIGHT and best_area < need):
            n_small += 1
            continue

        # ── dedup against what is already drawn ──────────────────────
        if tree is not None:
            cand = None
            try:
                cand = shape({"type": "Polygon", "coordinates": [
                    to_degrees(best_ring_m)]})
            except Exception:  # noqa: BLE001
                cand = None
            if cand is not None and cand.is_valid:
                hit = False
                # shapely 2.x returns a numpy int64 array here, and
                # `isinstance(np.int64(3), int)` is FALSE on Windows. The first
                # version indexed on that test, passed the raw int to
                # `intersection`, threw, swallowed it, and reported 0 duplicates
                # for a box that overlaps 604 Capitol footprints. Cast, always.
                for i in tree.query(cand):
                    g = existing[int(i)]
                    try:
                        inter = cand.intersection(g).area
                    except Exception:  # noqa: BLE001
                        continue
                    if inter > 0.35 * min(cand.area, g.area):
                        hit = True
                        break
                if hit:
                    n_dedup += 1
                    continue

        n_over_h[src] += 1
        is_tower = h >= TOWER_H

        # ── simplify ─────────────────────────────────────────────────
        tol = SIMPLIFY_TOWER if is_tower else (SIMPLIFY_NEAR + SIMPLIFY_PER_KM * d / 1000.0)
        ring_m = simplify_ring(best_ring_m, tol)
        if len(ring_m) < 4 or ring_area(ring_m) < AREA_HARD_MIN * 0.5:
            ring_m = best_ring_m
        verts_out += len(ring_m)

        # ── colour ───────────────────────────────────────────────────
        key = p.get("id") or f"{lon:.5f},{lat:.5f}"
        mat = material_for(cls, h, best_area, lon, lat, key)
        base = PALETTE[mat]
        # +-6% lightness so a block of identical class is not one flat slab.
        j = (stable01(key + ":j") - 0.5) * 0.12
        base = lerp_hex(base, "#ffffff" if j > 0 else "#000000", abs(j))

        # Horizon fade: only the outermost FADE_M band, and it is mixed into the
        # BAKED colours so it costs nothing at render time.
        edge = dist_inside_edge(lon, lat, OUTER)
        fade = FADE_MAX * max(0.0, min(1.0, 1.0 - edge / FADE_M))
        wd = lerp_hex(base, HAZE_DAY, fade)
        wg = lerp_hex(lerp_hex(base, GOLDEN_TINT, 0.16), HAZE_GOLD, fade)
        wn = lerp_hex(night_wall(base), HAZE_NIGHT, fade * 0.75)

        props = {"h": round(h, 1), "wd": wd, "wg": wg, "wn": wn}
        if is_tower:
            props["t"] = 1
            n_tower += 1
            # The atlas snap needs a wall colour to match against, and the
            # towers are the one place the fade must NOT wash the material out.
            props["wd"] = lerp_hex(base, HAZE_DAY, fade * 0.35)
            # Roof cap colours, for the towers ONLY - 114 features, not 7,138.
            # The cap layer first reused wd/wg/wn, which made the parapet the
            # same colour as the wall it sits on: a cap you cannot see is a
            # draw call you are paying for and a roof plane wearing windows.
            # Same formula as bake_detail.make_roof_colors so a tower's roof
            # grades through the day exactly like the core's.
            roof = adjust_light(base, -0.16)
            rd, rg, rn = make_roof_colors(roof)
            props["rd"], props["rg"], props["rn"] = rd, rg, rn

        out.append({"type": "Feature",
                    "geometry": {"type": "Polygon", "coordinates": [to_degrees(ring_m)]},
                    "properties": props,
                    # not emitted; used below to rank importance
                    # Towers sort first, unconditionally. A plain formula put
                    # them LAST: every other rank is negative, so the tower's
                    # 0.0 was the largest number in the list and density 0.55
                    # thinned the skyline before it thinned a shed.
                    "_rank": (-1e9 if is_tower else
                              -(h * 3.0 + math.sqrt(best_area) - d * 0.010))})
        kept += 1
        band = int(d // 1000)
        area_hist[band] = area_hist.get(band, 0) + 1

    # ── the density rank ─────────────────────────────────────────────
    # `d` is 0..1, lowest = most worth drawing, so the graphics menu can thin
    # the ring with a filter instead of a rebake - the same shape the tree
    # density knob uses (`js/app.js:treeFilter`). Ranking beats a raw height
    # threshold because it degrades evenly: at d<=0.5 you lose the small and
    # the far first, everywhere at once, rather than punching a hole in one
    # neighbourhood. Towers rank 0 and are never thinned.
    out.sort(key=lambda o: o.pop("_rank"))
    n = max(1, len(out) - 1)
    for i, o in enumerate(out):
        o["properties"]["d"] = round(i / n, 3)

    fc = {"type": "FeatureCollection", "features": out}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(fc, f, separators=(",", ":"))

    size_kb = os.path.getsize(OUT) // 1024
    report = {
        "date": DATE,
        "outer_bbox": OUTER, "core_bbox": CORE, "downtown_bbox": DOWNTOWN,
        "raw_candidates": len(feats),
        "kept": kept, "towers": n_tower,
        "dropped_too_small": n_small, "dropped_duplicate": n_dedup,
        "height_source": n_over_h,
        "podium_rule_examples": podium_examples,
        "vertices_in": verts_in, "vertices_out": verts_out,
        "vertices_saved_pct": round(100 * (1 - verts_out / max(1, verts_in)), 1),
        "kept_by_km_from_core": {str(k): v for k, v in sorted(area_hist.items())},
        "file_kb": size_kb,
        "rules": {
            "keep_any_height_m": KEEP_ANY_HEIGHT, "area_floor_m2": AREA_FLOOR,
            "area_per_km_m2": AREA_PER_KM, "tower_h_m": TOWER_H,
            "fade_band_m": FADE_M, "fade_max": FADE_MAX,
        },
    }
    os.makedirs(os.path.dirname(REPORT), exist_ok=True)
    with open(REPORT, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    # ── the manifest, INFORMATIONALLY ────────────────────────────────
    # The ring is deliberately NOT a snapshot: it is context, not the tracked
    # dataset, and putting it under data/snapshots/<date>/ would mean the three
    # earlier dated snapshots do not have one, so switching date would pop the
    # entire outer city in and out. `snapshots` and `diffs` are untouched, which
    # is what js/date-switcher.js and js/diff-tour.js actually read; this block
    # is provenance for a human. scripts/update_manifest.py carries it forward
    # (see FOREIGN_KEYS there) so a re-run of the core pipeline cannot delete it.
    man_path = os.path.join(ROOT, "data", "manifest.json")
    try:
        with open(man_path, encoding="utf-8") as f:
            man = json.load(f)
        src = load(os.path.join(ROOT, "data", "outer", "outer_source.json"), {})
        man["outer_ring"] = {
            "file": "outer_ring.geojson",
            "note": ("Context, not a snapshot. Date-independent, like "
                     "capitol.geojson / ground.geojson / trees.geojson. Read by "
                     "js/outer.js; ignored by the date switcher and the diff tour."),
            "bbox": OUTER,
            "overture_release": src.get("release"),
            "built_against_snapshot": DATE,
            "buildings": kept,
            "towers": n_tower,
        }
        with open(man_path, "w", encoding="utf-8") as f:
            json.dump(man, f, indent=2)
        print("  manifest.json: outer_ring block updated "
              "(snapshots/diffs untouched)")
    except Exception as exc:  # noqa: BLE001 -- provenance, not a build step
        print(f"  [warn] could not update manifest.json: {exc}")

    print(f"  kept {kept} of {len(feats)}  ({n_tower} towers >= {TOWER_H} m)")
    print(f"  dropped: {n_small} below the area threshold, {n_dedup} duplicates")
    print(f"  heights: {n_over_h}")
    print(f"  vertices {verts_in} -> {verts_out} ({report['vertices_saved_pct']}% fewer)")
    print(f"  kept per km-band from the core edge: {report['kept_by_km_from_core']}")
    print(f"  wrote {OUT} ({size_kb} KB)")


if __name__ == "__main__":
    main()
