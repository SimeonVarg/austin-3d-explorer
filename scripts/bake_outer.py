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

from shapely.geometry import shape, Polygon
from shapely.strtree import STRtree

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATE = sys.argv[1] if len(sys.argv) > 1 else "2026-07-30"

RAW = os.path.join(ROOT, "data", "outer", "outer_raw.geojson")
CORE_SNAP = os.path.join(ROOT, "data", "snapshots", DATE, "buildings.detailed.geojson")
CAPITOL = os.path.join(ROOT, "data", "capitol.geojson")
OVERRIDES = os.path.join(ROOT, "scripts", "outer_heights.json")
OSM_TAGS = os.path.join(ROOT, "data", "osm_cache", "outer_tags.json")
GREEN_RAW = os.path.join(ROOT, "data", "outer", "downtown_green_raw.json")
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
# ── the downtown streetwall ───────────────────────────────────────────
# The second exception, and the reason for it is a photograph. PR #99 gave the
# 114 towers podiums, setbacks and crowns; everything under 40 m stayed a flat
# untextured prism, because the ring's whole design is "one flat colour, it is
# backdrop". Downtown is not backdrop — it is the second subject of the app,
# and 1,534 of these sit inside the downtown box with 604 in the 8-18 m band
# that forms the actual street frontage. Blank cream boxes between detailed
# towers is exactly the "smaller ones are just skeletons" report.
#
# So a downtown building at or above MIDRISE_H is tagged `t=2`: it earns a
# window pattern (js/outer.js:outer-midrise), a parapet cap and roof plant.
# The gate is deliberately HEIGHT AND AREA, not height alone — a tall narrow
# stair core is not a streetwall.
MIDRISE_H = 8.0
MIDRISE_AREA = 150.0
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
# A mast is painted steel, not the building's own material — it is the one part
# of a tower that is a different substance from the rest of it, and giving it
# the wall colour makes it read as an extension of the shaft rather than a mast.
MAST_COL = "#5a6068"
# A ground floor is glass and shadow, not stucco. The band is mixed toward this
# rather than set to it, so a warm limestone tower still keeps a warm plinth.
STOREFRONT = "#586270"

# ══ DOWNTOWN DETAIL ════════════════════════════════════════════════════
# A skyline reads by its TOPS and by the line where a building meets the
# street; the middle of a shaft is the part nobody looks at. Until this block
# existed every one of the 114 downtown towers was one prism from the pavement
# to a flat cut, so downtown was forty boxes of slightly different heights.
#
# Everything here is a taste dial (CLAUDE.md rule 11) and every one of them has
# a measured count printed in data/outer/outer_report.json under `downtown`.
# `?dtdetail=0` is not a thing — this is DATA, so the switch is DT["on"] and a
# re-bake.
DT = {
    "on": True,

    # ── the podium ────────────────────────────────────────────────────
    # The footprint Overture gives a downtown tower is its GROUND plan, and
    # downtown Austin's ground plan is a parking-and-retail podium that the
    # shaft stands back from. So the emitted feature stops being one prism and
    # becomes two: the podium keeps the original footprint from z=0, and the
    # SHAFT is inset and starts on top of it.
    #
    # THE HEIGHT IS MEASURED WHERE THE DATA MEASURED IT. PODIUM_RULE above
    # already found six towers whose Overture LiDAR height is far too short for
    # their floor count — Sixth and Guadalupe at 18.7 m over 63 floors,
    # Northshore 19.9 over 38, Fairmont 20.6 over 37, One American Center 24.1
    # over 32. That short height is not noise: it is the roof of the podium,
    # returned because the podium is what the LiDAR sweep saw. Those towers get
    # their real, surveyed podium height for free and the rest are derived.
    "podium_floor_m": 4.6,          # a garage/retail floor is deeper than an office one
    # floors of podium by tower height — taller tower, deeper base
    "podium_floors": ((70.0, 2), (120.0, 3), (175.0, 4), (1e9, 5)),
    "podium_min_m": 8.0,
    "podium_max_frac": 0.26,        # never more than this share of the tower
    # A measured podium (from the LiDAR short-height cases) is trusted between
    # these bounds and derived outside them — 60 m of "podium" is a bad reading,
    # not a base.
    "podium_measured_min_m": 8.0,
    "podium_measured_max_m": 42.0,
    "podium_measured_max_frac": 0.55,   # a reading this far below the roof is a base

    # ── the setback ───────────────────────────────────────────────────
    # How far the shaft stands back from the podium's edge, as a share of the
    # plan's own width (2 * area / perimeter * 2, i.e. twice the inradius). A
    # fraction, not a constant, because a 20 m lot and a 70 m block cannot take
    # the same ledge.
    "setback_frac": 0.15,
    "setback_min_m": 1.5,
    "setback_max_m": 6.5,
    # Below this the plan is already a slim tower and an inset would whittle it
    # into a stick. Measured: 260 m2 is about a 16 x 16 m floorplate.
    "shaft_min_area_m2": 260.0,

    # ── the crown ─────────────────────────────────────────────────────
    # Every tower gets a mechanical penthouse: a smaller box on the roof. This
    # is the single cheapest thing that stops a skyline reading as a bar chart,
    # because it puts a second silhouette line on every top.
    "crown_frac": 0.045,            # of tower height
    "crown_min_m": 3.5,
    "crown_max_m": 12.0,
    "crown_inset_m": 2.8,
    "crown_min_area_m2": 90.0,
    # …and above this, a mast. Austin's tall towers all carry one and it is what
    # makes the Waterline / Sixth and Guadalupe / Independent group read as tall
    # rather than merely big.
    "mast_min_h_m": 115.0,
    "mast_frac": 0.085,             # of tower height
    "mast_plan_frac": 0.20,         # of the crown's width
    "mast_min_m": 6.0,
    # A tower never gives more than this share of its shaft to crown + mast.
    # Without it a short mid-rise that just clears mast_min_h_m ends up as
    # mostly hat.
    "top_max_frac": 0.22,

    # ── ground-floor retail ───────────────────────────────────────────
    # js/drag.js's shape, applied by rule: a SEPARATE banded feature with its
    # own base and its own height, never a pattern that tries to place a band
    # "at the top" of a wall. Outset slightly so its face is not coplanar with
    # the wall above it — two coplanar faces have no defined winner and that is
    # HANDOFF §34's whole A2 finding.
    "retail_h_m": 5.2,
    "retail_out_m": 0.40,
    # WAS 18.0, which is 6 storeys — so the entire 8-18 m streetwall, 604
    # buildings and the majority of what you actually see at street level
    # downtown, had no ground floor at all. A two-storey building on Congress
    # is ALL storefront. The band is shorter on a short building so a 9 m
    # box does not become 58% plinth (see retail_max_frac).
    "retail_min_building_h_m": 8.0,
    "retail_min_area_m2": 150.0,
    "retail_max_frac": 0.34,           # never more than this share of the wall
    "retail_min_h_m": 3.4,             # one commercial storey

    # ── the mid-rise roof ─────────────────────────────────────────────
    # A flat cut is what makes a mid-rise read as a massing study. Two cheap
    # pieces fix it and both are visible from the campus-facing viewpoints the
    # tour uses: a PARAPET (the wall continues ~1 m past the roof deck, which
    # every flat-roofed commercial building has and which puts a shadow line on
    # the top edge) and ROOF PLANT (the mechanical box, lift overrun and stair
    # bulkhead that clutter every real flat roof).
    #
    # Plant is placed on the roof CENTROID rather than inset from the outline,
    # because offset_ring on a small L-shaped plan collapses; the centroid box
    # is always well formed. It is one box, not a cluster — at downtown viewing
    # distance a cluster is the same silhouette for four times the features.
    #
    # The PARAPET is not here because it costs zero features: `t=2` carries
    # rd/rg/rn like a tower does, and js/outer.js caps it with the same shared
    # window.CAP_GEOM rule the towers use. A second extrusion on an existing
    # feature beats 725 new thin-band polygons, and it cannot drift from the
    # core's parapet because it is literally the core's rule.
    "plant_min_h_m": 12.0,
    "plant_min_area_m2": 420.0,
    "plant_h_m": 2.8,
    "plant_plan_frac": 0.34,        # of plan width, as a square on the centroid
    "plant_max_side_m": 16.0,
    "plant_min_side_m": 4.5,

    # ── parks, plazas and water ───────────────────────────────────────
    # Read from OSM (data/outer/downtown_green_raw.json). The outer ring draws
    # NO ground of its own — the basemap's pale wash is all there is out there,
    # which is HANDOFF §35 item 4 ("a tan carpet") and item 8 ("the canopy stops
    # at the campus edge"). A 0.45 m green pad is one polygon, no texture and no
    # trees, and it puts Republic Square, Waterloo Park, Brush Square, Palm Park
    # and Auditorium Shores on the map.
    "green_h_m": 0.45,
    "green_min_area_m2": 350.0,
    # Outside the two anchors a small park is below a pixel; the floor grows
    # with distance exactly like the building cull's does.
    "green_area_per_km_m2": 900.0,
    "green_simplify_m": 2.0,
    # The core box draws its own ground (js/ground.js) — anything inside it,
    # plus this margin, is somebody else's surface.
    "green_core_margin_m": 40.0,
}

# Ground colours are COPIED from js/ground.js's SURF table rather than chosen,
# so a park in the ring is the same green as a lawn on campus. If they are
# authored twice they drift, and a seam between two greens along the core box
# edge is worse than no park at all.
GREEN_TONES = {
    "lawn":  ("#8fa869", "#8a9457", "#111a14"),   # SURF grass
    "wood":  ("#5d7a48", "#5a6a3c", "#0c130f"),   # SURF wood
    "plaza": ("#e6ddc9", "#ecd6ac", "#1a1d26"),   # SURF paving
}
# OSM tag -> tone. `pitch` and `playground` are lawn: at this distance a ball
# field is a green rectangle and giving it its own tone buys nothing.
GREEN_USE = {
    "park": "lawn", "garden": "lawn", "pitch": "lawn", "playground": "lawn",
    "dog_park": "lawn", "grass": "lawn", "recreation_ground": "lawn",
    "cemetery": "wood", "square": "plaza", "pedestrian": "plaza",
}

# ── curated crowns, and the confidence is written next to each one ────
# HANDOFF §33's lesson: a landmark that is the wrong SHAPE cannot be fixed by
# care inside a generic recipe, and ten hand-tuned multipliers are ten guesses.
# So this table is SHORT and every entry is a published, checkable massing fact
# — not "it looks like". Anything not in it gets the generative crown above,
# which is right for the eighty anonymous boxes it applies to.
#
# Matched on Overture's own `name`, which is present and correct for every
# downtown tower (verified: 112 named buildings over 10 floors in the box).
CROWNS = {
    # Four stacked cubes, each cantilevered out over the one below in a
    # different direction. Universally described as the Jenga Tower; the massing
    # IS the building and a plain prism is unrecognisable.
    "The Independent":      {"r": "jenga", "blocks": 4, "off": 0.17},
    # Stepped, tapering crowns. Each of these narrows toward the top in
    # published elevations; the step count and fractions are the taste dial.
    "The Austonian":        {"r": "taper", "mast": 1.35},
    "The Republic":         {"r": "taper"},
    "ATX Tower":            {"r": "taper"},
    "Sixth and Guadalupe":  {"r": "taper", "mast": 1.30},
    "Waterline":            {"r": "taper", "mast": 1.45},
    "One American Center":  {"r": "taper", "steps": 3},
    # THE OWL. Frost Bank Tower's crown is four glass gables rising off the
    # shaft's corners around a stepped centre — the most recognisable roofline
    # in the city and the reason this table exists at all.
    "Frost Bank Tower":     {"r": "gable"},
    "Indeed Tower":         {"r": "taper", "steps": 1},
    "100 Congress":         {"r": "taper", "steps": 1},
}
# Shared shape dials for the recipes above.
CROWN_R = {
    "taper_steps": 2,
    "taper_top_frac": 0.86,     # the first step starts this far up the shaft
    "taper_inset_frac": 0.12,   # of plan width, per step
    "gable_h_frac": 0.085,      # gable height as a share of the tower
    "gable_fin_frac": 0.26,     # corner fin plan, as a share of the crown plan
    "gable_fin_rise": 1.55,     # fins stand this much above the gable box
    "jenga_gap_m": 0.0,         # blocks are flush in elevation, offset in plan
}


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


# ── metric-ring geometry, for the downtown detail ─────────────────────
def ring_perimeter(ring_m):
    p = 0.0
    for i in range(len(ring_m) - 1):
        p += math.hypot(ring_m[i + 1][0] - ring_m[i][0],
                        ring_m[i + 1][1] - ring_m[i][1])
    return p


def plan_width(ring_m, area=None):
    """A single number for "how wide is this plan", in metres.

    Twice the inradius, approximated as 4A/P. For a square of side s that is
    exactly s, and for a long thin slab it returns the SHORT dimension — which
    is the one that decides whether an inset survives. Using sqrt(area) instead
    would call a 12 x 90 m slab 33 m wide and inset it into nothing.
    """
    per = ring_perimeter(ring_m)
    if per <= 0:
        return 0.0
    a = ring_area(ring_m) if area is None else area
    return 4.0 * a / per


def offset_ring(ring_m, delta):
    """Inset (delta < 0) or outset (delta > 0) a closed metric ring.

    Mitred, because a building's corners are square and a rounded join turns a
    tower plan into a lozenge. Returns None rather than a degenerate ring — an
    inset that eats the whole plan must SKIP the setback, not emit a sliver
    (HANDOFF §51's `add()` trap in a new place: a shape too small to see is
    still a shape you are paying to draw).
    """
    try:
        poly = Polygon(ring_m)
        if not poly.is_valid:
            poly = poly.buffer(0)
        if poly.is_empty:
            return None
        g = poly.buffer(delta, join_style=2, mitre_limit=3.0)
        if g.is_empty:
            return None
        if g.geom_type == "MultiPolygon":
            g = max(g.geoms, key=lambda q: q.area)
        r = [(x, y) for x, y in g.exterior.coords]
        return r if len(r) >= 4 else None
    except Exception:  # noqa: BLE001 -- a bad ring skips its detail, nothing more
        return None


def roof_seat(ring_m, half, must_fit=True):
    """A point this roof can seat a `2*half` square on, or None.

    `must_fit=False` relaxes it to "a point INSIDE the ring" when the caller
    cannot skip — a mast is the tallest piece of its tower and dropping it
    would silently change the tower's height, which §33's re-measure would then
    (correctly) fail. A mast overhanging its crown by a metre is a detail; a
    mast forty metres away over the street is the defect.

    THE CENTROID IS NOT SUCH A POINT. A downtown block is routinely L-shaped, U
    -shaped or a doughnut around a light well, and the centroid of a non-convex
    ring lies outside it — so the first cut of the roof plant put boxes in mid
    air BESIDE their building (shots/e1-tiles/congress.png before this, the two
    dark cubes over the plaza at 6th and Brazos). A stable random nudge off the
    centroid, added for variety, made it worse by pushing borderline ones out.

    So: inset by the half-width plus a margin, and take shapely's
    representative_point of what survives — which is guaranteed INSIDE the
    polygon, unlike a centroid. If nothing survives the inset, the roof cannot
    seat the box and the answer is no box, not a smaller one in the wrong place.
    """
    inner = offset_ring(ring_m, -(half + 0.8))
    try:
        if inner is not None:
            poly = Polygon(inner)
            if not poly.is_valid:
                poly = poly.buffer(0)
            if not poly.is_empty and poly.area >= 1.0:
                p = poly.representative_point()
                return (p.x, p.y)
        if must_fit:
            return None
        outer = Polygon(ring_m)
        if not outer.is_valid:
            outer = outer.buffer(0)
        if outer.is_empty:
            return None
        p = outer.representative_point()
        return (p.x, p.y)
    except Exception:  # noqa: BLE001
        return None


def ring_centroid(ring_m):
    try:
        c = Polygon(ring_m).centroid
        return (c.x, c.y)
    except Exception:  # noqa: BLE001
        n = len(ring_m) - 1
        return (sum(p[0] for p in ring_m[:n]) / n, sum(p[1] for p in ring_m[:n]) / n)


def move_ring(ring_m, dx, dy):
    return [(x + dx, y + dy) for x, y in ring_m]


def square_ring(cx, cy, side):
    h = side * 0.5
    return [(cx - h, cy - h), (cx + h, cy - h), (cx + h, cy + h),
            (cx - h, cy + h), (cx - h, cy - h)]


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


def tri(base_hex, fade, fade_scale=1.0):
    """The (wd, wg, wn) triple for a wall colour at a given horizon fade.

    One function so a podium, a crown and the shaft between them cannot grade
    apart through the day — three copies of this arithmetic is three chances for
    downtown to fall out of step with itself at dusk.
    """
    # Only `wd` takes the tower's reduced fade, because that is what PASS C
    # does — and a podium whose day colour matched its shaft but whose NIGHT
    # colour did not would come apart after dark on exactly the towers this
    # pass exists to build. Transcribed, not re-derived.
    return (lerp_hex(base_hex, HAZE_DAY, fade * fade_scale),
            lerp_hex(lerp_hex(base_hex, GOLDEN_TINT, 0.16), HAZE_GOLD, fade),
            lerp_hex(night_wall(base_hex), HAZE_NIGHT, fade * 0.75))


def piece(ring_m, b, h, base_hex, fade, kind=None, tower=False, roof_hex=None,
          fb=None):
    """One emitted sub-feature of a downtown building.

    `k` is what js/outer.js's detail layer filters on; a piece WITHOUT `k` is a
    wall and keeps the tower pattern and the parapet cap, a piece WITH `k` is a
    flat-coloured solid (crown, mast, retail band, park pad). `b` is omitted
    when it is zero so 7,600 low-rise features do not each carry `"b":0`.
    """
    wd, wg, wn = tri(base_hex, fade, 0.35 if tower else 1.0)
    props = {"h": round(h, 1), "wd": wd, "wg": wg, "wn": wn}
    if b > 0.05:
        props["b"] = round(b, 1)
    if kind:
        props["k"] = kind
    if tower:
        props["t"] = 1
        rd, rg, rn = make_roof_colors(adjust_light(roof_hex or base_hex, -0.16))
        props["rd"], props["rg"], props["rn"] = rd, rg, rn
        if fb is not None:
            props["fb"] = fb
    return {"type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": [to_degrees(ring_m)]},
            "properties": props}


def downtown_detail(out, rep):
    """PASS D — turn each downtown tower from one prism into a building, and
    put the parks back on the ground beside it.

    Runs AFTER the density rank, on the features already emitted, so it cannot
    change which buildings survive the cull; it only changes what a survivor is
    made of. Everything it appends carries `d` = 0, because nothing here is
    worth thinning before the box it belongs to is thinned.
    """
    add = []

    def emit(bucket, feat):
        """Every sub-feature goes to the file AND to its own tower's bucket.

        The re-measure below groups a tower's pieces by WHO MADE THEM, not by
        where they landed. The first version matched on a padded bounding box
        and reported four height errors that were all the same artefact — the
        Four Seasons at 40.3 m "measuring" 111.4 m because the tower on the next
        lot dropped a mast inside its box. Guessing at the grouping made the
        instrument wrong in exactly the way the instrument exists to catch.
        """
        add.append(feat)
        bucket.append(feat)
        return feat

    parts = []
    n = {"podium": 0, "podium_measured": 0, "setback_skipped_slim": 0,
         "crown": 0, "mast": 0, "retail": 0, "plant": 0, "curated": 0,
         "jenga": 0, "taper": 0, "gable": 0, "curated_unmatched": []}
    seen_names = set()

    for f in out:
        if not f.get("_tower"):
            continue
        ring, h, area = f["_m"], f["_h"], f["_area"]
        base, fade, name = f["_base"], f["_fade"], f["_name"]
        width = plan_width(ring, area)
        recipe = CROWNS.get(name or "")
        if recipe:
            seen_names.add(name)
        mine = []
        parts.append((f, mine))

        # ── 1. the podium height ──────────────────────────────────────
        # THE TEST IS ON THE NUMBER, NOT ON WHICH RULE SET IT. The first
        # version asked whether `src == "podium_rule"`, and got 1 measured
        # podium out of 114 — because PASS B's curated heights overwrite `src`
        # for exactly the named towers whose LiDAR reading is short. Sixth and
        # Guadalupe, Northshore, Fairmont and One American Center all carry a
        # surveyed podium roof in `ovh_raw` and all four were being derived.
        # A short LiDAR return under a tall building IS the podium, whatever
        # later replaced the height.
        ovh = f["_ovh"]
        if (ovh and ovh < h * DT["podium_measured_max_frac"]
                and DT["podium_measured_min_m"] <= ovh <= DT["podium_measured_max_m"]):
            pod, pod_src = float(ovh), "measured"
        else:
            floors = next(nf for lim, nf in DT["podium_floors"] if h < lim)
            pod, pod_src = max(DT["podium_min_m"],
                               floors * DT["podium_floor_m"]), "derived"
        pod = min(pod, h * DT["podium_max_frac"])

        # ── 2. the setback ────────────────────────────────────────────
        sb = max(DT["setback_min_m"], min(DT["setback_max_m"],
                                          DT["setback_frac"] * width))
        shaft = offset_ring(ring, -sb) if area >= DT["shaft_min_area_m2"] else None
        if shaft is not None and ring_area(shaft) < 0.34 * area:
            shaft = None            # the inset ate the plan; leave it alone
        if shaft is None or h - pod < 15.0:
            # Already a slim tower, or too short to hold a base. It keeps the
            # generative crown below but stays one prism from the pavement.
            n["setback_skipped_slim"] += 1
            shaft, pod = ring, 0.0
        else:
            f["geometry"]["coordinates"] = [to_degrees(shaft)]
            f["properties"]["b"] = round(pod, 1)
            emit(mine, piece(ring, 0.0, pod, base, fade, tower=True,
                             fb=f["properties"].get("fb")))
            n["podium"] += 1
            if pod_src == "measured":
                n["podium_measured"] += 1

        # ── 2b. THE HEIGHT BUDGET, and it is the whole correctness of this ──
        #
        # `h` is the tower's ARCHITECTURAL height: outer_heights.json's 90
        # entries are published roof-or-spire figures and Overture's are LiDAR
        # returns off the highest thing on the roof. Either way the crown and
        # the mast are ALREADY INSIDE that number. The first cut stacked them on
        # top of it and took Waterline from a correct 315 m to 365.8 m — a 16%
        # error on the tallest building in Texas, introduced by a pass whose
        # entire subject is the skyline. So the pieces are carved DOWNWARD out
        # of h, and the top of the tallest piece is exactly h.
        crown_h = max(DT["crown_min_m"], min(DT["crown_max_m"],
                                             DT["crown_frac"] * h))
        mast_mul = (recipe or {}).get("mast", 1.0)
        mast_h = (max(DT["mast_min_m"], DT["mast_frac"] * h) * mast_mul
                  if h >= DT["mast_min_h_m"] else 0.0)
        if recipe and recipe["r"] == "gable":
            crown_h = CROWN_R["gable_h_frac"] * h * CROWN_R["gable_fin_rise"]
        # The shaft never gives up more than this much of itself to its own hat.
        budget = min(crown_h + mast_h, (h - pod) * DT["top_max_frac"])
        if crown_h + mast_h > budget and (crown_h + mast_h) > 0:
            k = budget / (crown_h + mast_h)
            crown_h, mast_h = crown_h * k, mast_h * k
        shaft_top = h - crown_h - mast_h

        top = shaft_top    # running z: where the next piece starts
        cap = shaft        # the plan the next piece sits on
        last_wall = f      # the piece that currently owns the top of the wall
        f["properties"]["h"] = round(shaft_top, 1)

        # ── 3. the curated massing recipes ────────────────────────────
        if recipe and recipe["r"] == "jenga":
            # Four stacked cubes, each cantilevered in a different direction.
            # The ORIGINAL feature becomes block 0; blocks 1..n-1 are appended.
            nb = recipe.get("blocks", 4)
            step = (shaft_top - pod) / nb
            off = recipe.get("off", 0.17) * width
            f["properties"]["h"] = round(pod + step, 1)
            dirs = [(0, 0), (off, 0), (0, off), (-off, 0), (0, -off)]
            for i in range(1, nb):
                dx, dy = dirs[i % len(dirs)]
                blk = move_ring(shaft, dx, dy)
                last_wall = emit(mine, piece(
                    blk, pod + i * step, pod + (i + 1) * step, base, fade,
                    tower=True, fb=f["properties"].get("fb")))
                cap = blk
            n["jenga"] += 1
            n["curated"] += 1
        elif recipe and recipe["r"] == "taper":
            steps = recipe.get("steps", CROWN_R["taper_steps"])
            z0 = pod + (shaft_top - pod) * CROWN_R["taper_top_frac"]
            f["properties"]["h"] = round(z0, 1)
            dz = (shaft_top - z0) / max(1, steps)
            cur = shaft
            for i in range(steps):
                nxt = offset_ring(cur, -CROWN_R["taper_inset_frac"] * width)
                if nxt is None or ring_area(nxt) < DT["crown_min_area_m2"]:
                    break
                last_wall = emit(mine, piece(
                    nxt, z0 + i * dz, z0 + (i + 1) * dz, base, fade,
                    tower=True, fb=f["properties"].get("fb")))
                cur = nxt
            cap = cur
            n["taper"] += 1
            n["curated"] += 1

        # ── 4. the crown ──────────────────────────────────────────────
        crown = offset_ring(cap, -DT["crown_inset_m"])
        if crown is not None and ring_area(crown) < DT["crown_min_area_m2"]:
            crown = None
        if crown is None:
            # No room for a hat. Give the height back to the wall rather than
            # shipping a tower that is quietly crown_h + mast_h too short —
            # a silent height error is exactly what §33's re-measure exists for.
            last_wall["properties"]["h"] = round(h, 1)
            continue
        if recipe and recipe["r"] == "gable":
            # THE OWL. A stepped centre box with four corner fins standing
            # proud of it — the silhouette, not the glazing.
            gb = crown_h / CROWN_R["gable_fin_rise"]
            # The centre is DELIBERATELY lower than the fins — that is the owl.
            # So the solid under the mast stops here, not at top + crown_h, and
            # `cap_top` has to say so or the mast starts 6.5 m above the last
            # thing holding it up. That was Frost Bank's floating cube.
            emit(mine, piece(crown, top, top + gb, adjust_light(base, -0.10),
                             fade, kind="c"))
            cap_top = top + gb
            cw = plan_width(crown)
            fin = max(2.2, CROWN_R["gable_fin_frac"] * cw)
            seat = roof_seat(crown, 0.0, must_fit=False)
            cx, cy = seat if seat else ring_centroid(crown)
            # THE RING'S OWN VERTICES, one per quadrant.
            #
            # Two wrong rules were tried first and both are worth naming.
            # `centroid +- plan_width/2` uses 4A/P — twice the INRADIUS, the
            # SHORT dimension — so on an oblong plan it lands the fins between
            # the centre and the corners. Replacing it with the bounding box's
            # corners was worse and it is a trap this repo has already written
            # down (QUEUE: "a bounding box is not a shape", §50): Frost Bank's
            # plan is ROTATED relative to north, so its bbox corners sit
            # outside the polygon and MORE fins fell off, not fewer.
            #
            # A corner of a rotated rectangle is a VERTEX of the ring. Inset
            # the ring by half the fin first, so any vertex of what survives
            # can seat the whole square, then take the furthest vertex from the
            # centre in each quadrant. Correct for any rotation and any shape.
            seed = offset_ring(crown, -fin * 0.5) or crown
            quad = {}
            for vx, vy in seed:
                key = (vx >= cx, vy >= cy)
                d2 = (vx - cx) ** 2 + (vy - cy) ** 2
                if key not in quad or d2 > quad[key][0]:
                    quad[key] = (d2, vx, vy)
            cpoly = Polygon(crown).buffer(0)
            for _, fx, fy in quad.values():
                fr = square_ring(fx, fy, fin)
                # The four corners assume a roughly square plan. Frost Bank's
                # is, so all four land — but a fin that does not touch its own
                # crown is a block hanging off the side of the tower, and the
                # owl is worth less than that costs.
                try:
                    if not cpoly.intersects(Polygon(fr).buffer(0)):
                        n["gable_fin_dropped"] = n.get("gable_fin_dropped", 0) + 1
                        continue
                except Exception:  # noqa: BLE001
                    continue
                emit(mine, piece(fr, top, top + crown_h,
                                 adjust_light(base, 0.06), fade, kind="c"))
            n["gable"] += 1
            n["curated"] += 1
        else:
            emit(mine, piece(crown, top, top + crown_h,
                             adjust_light(base, -0.10), fade, kind="c"))
            cap_top = top + crown_h
        top += crown_h
        cap = crown
        n["crown"] += 1

        # ── 5. the mast ───────────────────────────────────────────────
        if mast_h > 0.5:
            side = max(2.4, DT["mast_plan_frac"] * plan_width(cap))
            # roof_seat, NOT ring_centroid. The centroid of a non-convex crown
            # lies outside it, and that is where downtown's floating cubes came
            # from: a mast standing in mid air over the street beside its own
            # tower. Visible in shots/e1-before/congress.png and present since
            # PR #99 — the same root cause as the roof plant below, found the
            # same way, by cropping the picture and then writing the detector.
            seat = roof_seat(cap, side * 0.5, must_fit=False)
            cx, cy = seat if seat else ring_centroid(cap)
            # Stand it on what is actually under it (`cap_top`), and keep the
            # TOP where it was — the tower's architectural height is the one
            # number a viewer can check and §33's re-measure holds it. So a
            # spire through the gables gets longer, it does not get lowered.
            emit(mine, piece(square_ring(cx, cy, side), cap_top, top + mast_h,
                             MAST_COL, fade, kind="c"))
            n["mast"] += 1

    for nm in CROWNS:
        if nm not in seen_names:
            n["curated_unmatched"].append(nm)

    # ── the re-measure, before anything else is appended ──────────────
    # §33's rule. A tower is now up to nine features and the ONLY number a
    # viewer can check is where its highest piece stops. Walk the emitted
    # pieces, group them back onto the tower they came from by plan overlap of
    # their bounding boxes, and assert the tallest one lands on the tower's own
    # architectural height. A silhouette that is silently 16% too tall is what
    # this catches, and it caught it.
    worst, checked = [], 0
    for f, mine in parts:
        tops = [f["properties"]["h"]] + [
            a["properties"]["h"] for a in mine
            if a["properties"].get("k") != "r"]
        checked += 1
        err = max(tops) - f["_h"]
        if abs(err) > 0.75:
            worst.append({"name": f["_name"], "want": round(f["_h"], 1),
                          "got": round(max(tops), 1), "err": round(err, 1),
                          "parts": len(mine) + 1})
    worst.sort(key=lambda w: -abs(w["err"]))
    n["height_checked"] = checked
    n["height_mismatch"] = len(worst)
    n["height_worst"] = worst[:8]
    n["parts_per_tower_max"] = max((len(m) + 1 for _, m in parts), default=0)

    # ── 6. the ground-floor band ──────────────────────────────────────
    # Every downtown building tall enough to have a lobby gets one. This is the
    # line where a building meets the street, and downtown Austin's is glass.
    for f in out:
        if not f.get("_dt"):
            continue
        if f["_h"] < DT["retail_min_building_h_m"] or f["_area"] < DT["retail_min_area_m2"]:
            continue
        band = offset_ring(f["_m"], DT["retail_out_m"])
        if band is None:
            continue
        # A fixed 5.2 m plinth is a lobby on a 60 m tower and two thirds of the
        # wall on a 9 m shopfront. Cap it by share of the building, floor it at
        # one commercial storey, so the same rule works across the 8-300 m range
        # this pass now covers.
        rh = min(DT["retail_h_m"], f["_h"] * DT["retail_max_frac"])
        rh = max(DT["retail_min_h_m"], rh)
        if rh >= f["_h"] - 0.5:          # nothing left of the wall above it
            continue
        add.append(piece(band, 0.0, rh,
                         lerp_hex(adjust_light(f["_base"], -0.18), STOREFRONT, 0.45),
                         f["_fade"], kind="r"))
        n["retail"] += 1

    # ── 7. roof plant on the mid-rise ─────────────────────────────────
    # The towers got a mechanical penthouse in PR #99 and it is most of why
    # they stopped reading as a bar chart. The mid-rise got nothing, so 725
    # downtown buildings still end in a flat cut. One box on the roof centroid,
    # squared to the plan, is the whole fix.
    for f in out:
        if not f.get("_midrise"):
            continue
        if f["_h"] < DT["plant_min_h_m"] or f["_area"] < DT["plant_min_area_m2"]:
            continue
        side = plan_width(f["_m"], f["_area"]) * DT["plant_plan_frac"]
        side = max(DT["plant_min_side_m"], min(DT["plant_max_side_m"], side))
        # Seat it on a point the roof actually contains. A plan that cannot
        # take the box at this size is tried once at the minimum and then left
        # alone — an L-shaped block with a 6 m wing has nowhere to put plant.
        seat = roof_seat(f["_m"], side * 0.5)
        if seat is None and side > DT["plant_min_side_m"]:
            side = DT["plant_min_side_m"]
            seat = roof_seat(f["_m"], side * 0.5)
        if seat is None:
            n["plant_no_seat"] = n.get("plant_no_seat", 0) + 1
            continue
        cx, cy = seat
        box = square_ring(cx, cy, side)
        # The inset guarantees containment. Assert it anyway: the version
        # WITHOUT this assert shipped boxes hanging in mid air next to their
        # building, and the only reason it was caught was that the next thing
        # done was to look at a picture (§45's rule, earned again).
        try:
            if not Polygon(f["_m"]).buffer(0).contains(Polygon(box)):
                n["plant_offroof"] = n.get("plant_offroof", 0) + 1
                continue
        except Exception:  # noqa: BLE001
            n["plant_offroof"] = n.get("plant_offroof", 0) + 1
            continue
        add.append(piece(box, f["_h"], f["_h"] + DT["plant_h_m"],
                         adjust_light(f["_base"], -0.22), f["_fade"], kind="c"))
        n["plant"] = n.get("plant", 0) + 1

    # ── 8. NOTHING MAY FLOAT ──────────────────────────────────────────
    # §33's re-measure asserts a tower's HEIGHT. It cannot see a piece at the
    # right height in the wrong PLACE, and downtown shipped two of those for
    # four passes because no instrument asked. Every raised piece must have
    # something under it whose top reaches its base and which sits beneath most
    # of its plan.
    #
    # The first version of this detector reported 39 and was WRONG: it only
    # accepted a WALL as support, and a mast stands on a crown. A detector that
    # flags its own blind spot has the shape of a real result — §45's rule, and
    # the reason this one is written to accept any solid piece.
    solids, spoly = [], []
    for f in out + add:
        p = f["properties"]
        if p.get("k") in ("r", "g"):      # a ground band / park pad holds nothing
            continue
        try:
            q = Polygon(f["geometry"]["coordinates"][0]).buffer(0)
        except Exception:  # noqa: BLE001
            continue
        if q.is_empty:
            continue
        solids.append((p, f))
        spoly.append(q)
    tree = STRtree(spoly)
    floating = 0
    for f in add:
        p = f["properties"]
        b = p.get("b", 0)
        if p.get("k") != "c" or b <= 0.05:
            continue
        try:
            q = Polygon(f["geometry"]["coordinates"][0]).buffer(0)
        except Exception:  # noqa: BLE001
            continue
        held = False
        for i in tree.query(q):
            if solids[i][1] is f:
                continue
            if solids[i][0]["h"] >= b - 0.6 and \
                    spoly[i].intersection(q).area > q.area * 0.5:
                held = True
                break
        if not held:
            floating += 1
    n["floating_pieces"] = floating

    for a in add:
        a["properties"]["d"] = 0
    rep["downtown"] = n
    return add


def green_pads(rep):
    """PASS E — parks, plazas and squares, from OSM, as 0.45 m pads.

    The outer ring has never drawn any ground of its own, so outside the core
    box the only green is whatever the basemap washes in — which is HANDOFF §35
    item 4 and item 8 in one sentence. This is not a ground pass: no texture, no
    trees, no edging. One polygon per park, in the SAME green js/ground.js uses
    on campus, at a height a fill-extrusion can win against the basemap.
    """
    raw = load(GREEN_RAW)
    n = {"read": 0, "kept": 0, "small": 0, "in_core": 0, "unclosed": 0,
         "by_tone": {}}
    if not raw:
        rep["green"] = n
        return []
    out = []

    def use_of(t):
        for key in ("leisure", "landuse", "place"):
            if t.get(key) in GREEN_USE:
                return GREEN_USE[t[key]]
        if t.get("highway") == "pedestrian" and t.get("area") == "yes":
            return GREEN_USE["pedestrian"]
        return None

    def rings_of(e):
        if e.get("type") == "way" and e.get("geometry"):
            return [[(p["lon"], p["lat"]) for p in e["geometry"]]]
        rs = []
        for m in (e.get("members") or []):
            if m.get("role") != "outer" or not m.get("geometry"):
                continue
            rs.append([(p["lon"], p["lat"]) for p in m["geometry"]])
        return rs

    for e in raw.get("elements", []):
        tone = use_of(e.get("tags") or {})
        if not tone:
            continue
        for deg in rings_of(e):
            n["read"] += 1
            if len(deg) < 4 or deg[0] != deg[-1]:
                n["unclosed"] += 1
                continue
            rm = to_metres(deg)
            a = ring_area(rm)
            cx = sum(x for x, _ in rm) / len(rm)
            cy = sum(y for _, y in rm) / len(rm)
            lon = OUTER["minlon"] + cx / M_LON
            lat = OUTER["minlat"] + cy / M_LAT
            if not in_rect(lon, lat, OUTER):
                continue
            # The core draws its own ground; the margin keeps a park that
            # straddles the seam from being drawn twice along the join.
            if in_rect(lon, lat, CORE) and \
                    dist_inside_edge(lon, lat, CORE) > DT["green_core_margin_m"]:
                n["in_core"] += 1
                continue
            d = min(dist_outside_rect(lon, lat, CORE),
                    dist_outside_rect(lon, lat, DOWNTOWN))
            need = DT["green_min_area_m2"] + DT["green_area_per_km_m2"] * d / 1000.0
            if a < need:
                n["small"] += 1
                continue
            rm = simplify_ring(rm, DT["green_simplify_m"])
            if len(rm) < 4:
                n["small"] += 1
                continue
            edge = dist_inside_edge(lon, lat, OUTER)
            fade = FADE_MAX * max(0.0, min(1.0, 1.0 - edge / FADE_M))
            wd, wg, wn = GREEN_TONES[tone]
            out.append({
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [to_degrees(rm)]},
                "properties": {"h": DT["green_h_m"], "k": "g", "d": 0,
                               "wd": lerp_hex(wd, HAZE_DAY, fade),
                               "wg": lerp_hex(wg, HAZE_GOLD, fade),
                               "wn": lerp_hex(wn, HAZE_NIGHT, fade * 0.75)},
            })
            n["kept"] += 1
            n["by_tone"][tone] = n["by_tone"].get(tone, 0) + 1
    rep["green"] = n
    return out


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
    n_midrise = 0
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
                      "id": p.get("id"), "name": p.get("name"),
                      # The LiDAR height BEFORE the podium rule overrode it.
                      # Where the rule fired, this number is the roof of the
                      # PODIUM — a surveyed measurement of exactly the thing
                      # PASS D wants — so it is carried rather than discarded.
                      "ovh_raw": (float(p["overture_height"])
                                  if p.get("overture_height") else None),
                      "floors": floors})

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

        is_dt = in_rect(lon, lat, DOWNTOWN)
        # The downtown streetwall: not a tower, but not backdrop either. Same
        # shape of exception as `t=1` and for the same reason — this is the
        # half of downtown you look AT rather than past.
        is_midrise = (DT["on"] and is_dt and not is_tower
                      and h >= MIDRISE_H and best_area >= MIDRISE_AREA)

        props = {"h": round(h, 1), "wd": wd, "wg": wg, "wn": wn}
        if is_midrise:
            props["t"] = 2
            n_midrise += 1
            # Same two reasons the towers get these. The fade is NOT reduced
            # the way a tower's is: a tower is the silhouette on the horizon
            # and has to keep its material, a mid-rise at the edge of the box
            # should still wash out with everything around it.
            roof = adjust_light(base, -0.16)
            rd, rg, rn = make_roof_colors(roof)
            props["rd"], props["rg"], props["rn"] = rd, rg, rn
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
                    # PASS D's working set. Every underscore key is popped
                    # before the file is written; `assert` at the end of main()
                    # is what stops one leaking into 7,600 features.
                    "_m": ring_m, "_base": base, "_name": c.get("name"),
                    "_h": h, "_ovh": c.get("ovh_raw"), "_src": src,
                    "_fade": fade, "_area": best_area, "_tower": is_tower,
                    "_midrise": is_midrise,
                    "_dt": is_dt,
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

    # ── PASS D and E: the downtown detail, and the parks ──────────────
    # AFTER the rank, deliberately. These passes change what a building is MADE
    # OF, never which buildings survive, so a re-tune of the crown dials cannot
    # silently move the density thinning under the graphics menu.
    extra = []
    detail_rep = {}
    n_body = len(out)
    if DT["on"]:
        extra += downtown_detail(out, detail_rep)
        extra += green_pads(detail_rep)
    # Strip PASS D's working set. This is not tidiness: `_m` is a full metric
    # ring, so one leaked underscore key would roughly DOUBLE the file.
    for o in out:
        for k in [k for k in o if k.startswith("_")]:
            del o[k]
    out += extra

    fc = {"type": "FeatureCollection", "features": out}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(fc, f, separators=(",", ":"))

    # ── re-measure the file that was just written ─────────────────────
    # bake_art.py's rule, for the same reason: a counter incremented at emit
    # time counts INTENT. HANDOFF §36 records seven creek-sheen features that
    # were reported as shipped and were not in the file. These numbers are read
    # back off the emitted list.
    shipped = {"features": len(out), "bodies": n_body, "detail": len(extra)}
    kinds = {}
    for o in out:
        pr = o["properties"]
        kinds[pr.get("k") or ("tower" if pr.get("t") == 1 else "flat")] = \
            kinds.get(pr.get("k") or ("tower" if pr.get("t") == 1 else "flat"), 0) + 1
    shipped["by_kind"] = kinds
    shipped["with_base"] = sum(1 for o in out if "b" in o["properties"])
    shipped["max_top_m"] = round(max(o["properties"]["h"] for o in out), 1)
    leaked = sum(1 for o in out if any(k.startswith("_") for k in o))
    if leaked:
        sys.exit("PASS D leaked a working key onto %d features" % leaked)

    size_kb = os.path.getsize(OUT) // 1024
    report = {
        "downtown_detail": detail_rep,
        "shipped": shipped,
        "date": DATE,
        "outer_bbox": OUTER, "core_bbox": CORE, "downtown_bbox": DOWNTOWN,
        "raw_candidates": len(feats),
        "kept": kept, "towers": n_tower, "midrise": n_midrise,
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
            "midrise": n_midrise,
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
    if DT["on"]:
        print(f"  downtown detail: {detail_rep.get('downtown')}")
        print(f"  parks/plazas:    {detail_rep.get('green')}")
        print(f"  shipped by kind: {shipped['by_kind']}  "
              f"({shipped['with_base']} with a base, top {shipped['max_top_m']} m)")
    print(f"  wrote {OUT} ({size_kb} KB)")


if __name__ == "__main__":
    main()
