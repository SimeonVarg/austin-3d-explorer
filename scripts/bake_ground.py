# -*- coding: utf-8 -*-
"""Bake the cached OSM ground data (data/osm_cache/*.json) into render-ready
data/ground.geojson AND data/roads.geojson.

TRUTH RULE, which governs this whole file: every POSITION here comes from OSM.
Nothing is scattered, invented or nudged for looks. What is generative is FORM —
the drawn width of a path whose width OSM does not record, and the colour we
choose for a named surface. Those two are called out in the report this prints.

Emits per feature:
  k  kind      path | area
  s  surface   limestone | concrete | brick | asphalt | paving | gravel |
               grass | wood | water | track | sand | dirt
  u  use       what the thing IS (footway, steps, plaza, lawn, pitch, parking…)
  w  width_m   paths only; measured where tagged, else a default by use (form)
  wt tagged    1 if the width came from OSM, 0 if it is our default

Usage:  python scripts/bake_ground.py
"""
import json
import math
import os
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "data", "osm_cache")
OUT = os.path.join(ROOT, "data", "ground.geojson")
OUT_ROADS = os.path.join(ROOT, "data", "roads.geojson")

# The detailed bbox. Inside it we keep every driveway and parking aisle; outside
# it those are 4,000 hairlines the camera never resolves, and they double the
# file for nothing.
DETAIL_BB = (-97.752, 30.276, -97.726, 30.296)

# Speedway Mall: 30 ft, from PWP Landscape Architecture's own project record for
# the Speedway Corridor -- "narrowed to a pedestrian-friendly 30 feet wide".
# SOURCED. The brick, the herringbone and the extent all come from the same
# record; see docs/PASS_ROADS.md.
SPEEDWAY_W = 9.1

# ---------------------------------------------------------------- surfaces --
# OSM surface value -> our surface class. Anything unmapped is reported, never
# silently guessed.
SURFACE_MAP = {
    "concrete": "concrete", "concrete:plates": "concrete", "concrete:lanes": "concrete",
    "paved": "paving", "paving_stones": "paving", "sett": "paving",
    "cobblestone": "paving", "unhewn_cobblestone": "paving",
    "brick": "brick", "bricks": "brick", "paving_stones:brick": "brick",
    "asphalt": "asphalt", "chipseal": "asphalt", "tartan": "track",
    "grass": "grass", "grass_paver": "grass", "ground": "dirt", "dirt": "dirt",
    "earth": "dirt", "mud": "dirt", "unpaved": "gravel", "compacted": "gravel",
    "gravel": "gravel", "fine_gravel": "gravel", "pebblestone": "gravel",
    "sand": "sand", "wood": "wood", "metal": "concrete", "rubber": "track",
    "limestone": "limestone", "stone": "limestone", "rock": "limestone",
    "artificial_turf": "turf", "synthetic": "turf",
}
# The burnt-orange end zones of a Texas football field. Not an OSM surface —
# a derived class, see the end-zone pass in main().

# What a thing IS, when its surface is not tagged. This is a GENERATIVE default:
# an untagged campus footway is overwhelmingly concrete here (of the corridor's
# tagged paths, concrete outnumbers everything else better than 2:1), and the
# malls are limestone-paved. Reported as a default, not as sourced fact.
DEFAULT_SURFACE = {
    "footway": "concrete", "steps": "concrete", "cycleway": "asphalt",
    "path": "gravel", "pedestrian": "paving", "plaza": "paving",
    "lawn": "grass", "park": "grass", "wood": "wood", "scrub": "grass",
    "pitch": "grass", "track": "track", "parking": "asphalt",
    "water": "water", "fountain": "water", "sand": "sand",
    "construction": "dirt", "playground": "sand",
    # A GARDEN IS NOT A LAWN, and until this line it was: `u:'garden'` fell
    # through to the same `grass` colour as every mown panel on campus, which is
    # the whole of why the Memorial Garden read as a flat green rectangle. Its
    # turf is watered, edged and shaded, so it is deeper and cooler than a mall
    # lawn -- see SURF.gardenlawn in js/ground.js.
    "garden": "gardenlawn",
}

# ------------------------------------------------------------- lawn tone --
#
# "Make south mall more vibrant and saturated. Lawns like that throughout the
# project should be more saturated."
#
# ONE TABLE, and it is the whole knob: which palette entry each kind of green
# is painted from. Set a row back to "grass" and that class is exactly what it
# was before this pass; empty the table and the pass is a no-op.
#
# WHY IT IS A RECLASSIFICATION AND NOT A SATURATION MULTIPLIER, which is what
# he actually asked for and is worth being straight about. Ground colour lives
# entirely in the `SURF` palette in js/ground.js, keyed on this `s` value —
# `matchExpr` is `['match', ['get','s'], 'grass', '#8fa869', ...]` and there is
# no data-driven colour channel at all. js/ground.js is not this lane's file
# this round, so the only lever the data side owns is WHICH existing entry a
# polygon points at. Measured off the palette, sorted by HSL saturation:
#
#     grass       #8fa869   S 0.266   luma 153    <- what every lawn was
#     gardenlawn  #7d9c5c   S 0.258   luma 140
#     turf        #4f7a3c   S 0.341   luma 102    <- the most saturated green
#
# So `turf` is the answer to "more saturated" and it is also darker, which on a
# mown ceremonial lawn is right — a watered, edged, shaded mall panel IS deeper
# than rough grass, and it is the tone the practice fields already read as in
# the frame. The real fix, a saturation multiplier over the whole green band,
# is one line in js/ground.js and is written up in HANDOFF for that lane.
LAWN_TONE = {
    # A mown panel: the malls, the quads, the medians. The thing he named.
    "lawn": "turf",
    # A park is bigger, rougher and further from a mower. One step, not two, so
    # the malls still read as the most tended green in the frame.
    "park": "gardenlawn",
    # Deliberately NOT here: `pitch` (the stadium and the practice fields are
    # the mac lane's picture), `scrub` and `wood` (the creek corridor's three
    # planting zones are separated BY their colours -- see js/ground.js SURF --
    # and pushing one of them moves it onto another), `garden` (already on its
    # own entry) and `endzone` (burnt orange, not green).
}

# Drawn width in metres for paths OSM does not measure. GENERATIVE, and it is
# the FALLBACK now rather than the answer -- see MEASURED_WIDTHS below.
DEFAULT_WIDTH = {
    "footway": 2.4, "steps": 3.0, "cycleway": 2.2, "path": 1.5, "pedestrian": 6.0,
}

# ── measured widths ────────────────────────────────────────────────────────
# 0 of 3,098 campus footways in data/osm_cache/footways.json carries an OSM
# `width` tag -- not a few, none -- so before this, every walk in the city was
# the same 2.4 m ribbon whether it was a service alley behind a dorm or a mall
# approach carrying thousands of students. That is the facade-template defect
# one system over.
#
# `scripts/trace_walk_widths.py` measures each way against the CITY OF AUSTIN's
# planimetric impervious-surface survey -- real digitised polygons of the
# actual paved slab, public domain -- and writes data/walkway_widths.json. It
# owns that file; this bake only reads it.
#
# IT IS OPT-IN AND ONLY EVER WIDENS OR NARROWS A WAY THAT HAS A ROW. A way
# with no row keeps DEFAULT_WIDTH and is marked unsourced, because a missing
# row does NOT mean "no walk here": the city's survey does not cover all of
# UT's interior campus, and two off-pavement cases were put to the aerial
# photograph and shown to be real, obviously paved courts the city simply
# has not mapped. Nothing here is allowed to delete or move a path.
WALK_WIDTHS_REL = "data/walkway_widths.json"
MEASURED_WIDTHS_ON = os.environ.get("MW", "1") != "0"   # A/B control arm
MEASURED_WIDTH_SRC = "atxplan"      # the `src` a measured way carries out

# ── the kerb apron ─────────────────────────────────────────────────────────
# A `footway=crossing` way is not drawn as a path, and that is right: the
# painted zebra belongs to the street, and laying a pale concrete ribbon across
# every carriageway on campus is the defect the skip exists to prevent.
#
# But a crossing way does not start at the kerb. It starts a metre or two back,
# on the ramp, and the sidewalk it leaves ALSO stops short — `widen_paths` uses
# flat caps, so the pavement polygon ends square at the sidewalk's last node.
# Between the two there was nothing painted at all. Measured against the
# router's own network: 2,245 m of the walking graph runs over ground the scene
# paints as neither pavement nor road, and essentially all of it is these two
# stubs, at every street corner in the city. Walk a route across Speedway and
# the ribbon steps off the end of the sidewalk onto bare dirt before it reaches
# the street.
#
# So: emit the FIRST and LAST CROSSING_APRON_M of every crossing as ordinary
# footway, and nothing in between. The middle — the part actually over the
# street — is still never drawn, and the resolver's carriageway cut removes any
# apron that overshoots onto the travelled way, so this cannot become the pale
# ribbon the skip was guarding against. It can only close the gap.
CROSSING_APRON_M = 2.5
# A kerb ramp is poured concrete here whatever the crossing carries. The tag on
# a crossing describes the ROAD it is painted on — `surface=asphalt` is common
# and true of the street, not of the ramp — and honouring it would drop a black
# patch at every corner instead of continuing the sidewalk.
CROSSING_APRON_SURFACE = "concrete"

# ── a pedestrian mall is a WALK, not a lawn-band area ──────────────────────
#
# OSM draws the campus malls — Main Mall, East Mall, the Speedway courts, the
# Jester, Gates and Blanton forecourts — as `highway=pedestrian, area=yes`
# polygons, 44 of them in this cache. They were emitted as `k:'area',
# u:'plaza'`: a FLAT fill, in the same band as lawns and parking lots.
# Everything else you walk on in this scene is a `k:'patharea'` slab standing
# GROUND.pathRaise = 0.22 m proud, and the walking ribbon's own base is pinned
# to that same 0.22 m (`WAYFIND.routeBaseM`, and its comment says to keep the
# two equal). So over a mall the ribbon floated 22 cm in the air, and over a
# mall's outline — which is where the walking graph runs, because a closed way
# is a ring of edges — it half floated and half sat on nothing.
#
# The apron pass above closed the gap at the kerb. This closes the other one,
# and it is the bigger of the two: 4.0 % of the twenty routes' drawn length is
# on a mall, against 2.5 % on a crossing.
#
# This file's own rank ladder already says what a mall is: ('patharea',
# 'pedestrian') sits at 60, above the generic footway laid over it. Only the
# `area=yes` branch was routing the very things that entry describes into the
# other band. Speedway — tagged `highway=pedestrian` as a LINE — has always come
# out of this bake as a patharea; the polygons are the same kind of thing, and
# after this they are the same colour as the walks that cross them, which they
# were not before (measured off the frames in shots/walk/sidewalks/: the mall
# was rgb(224,207,175) and a walk crossing it rgb(237,192,132), in one frame,
# both concrete).
#
# Set False and the malls go back to flat plaza fills with no other change.
PEDESTRIAN_AREA_IS_A_WALK = True

# ── the mall rim ───────────────────────────────────────────────────────────
#
# THE SAME DEFECT AS THE KERB APRON, IN THE ONE PLACE THAT PASS COULD NOT SEE.
# Measured on this branch with `--walkaudit --where`: of the 454 m of walking
# graph the twenty routes ride over ground this file paints as NOTHING, **not
# one metre is more than 5 m from pavement, 87 % is within 5 CENTIMETRES, and
# 88 % of it is riding the outline of a `('patharea','pedestrian')` polygon**.
# 81 % of those metres have pavement on one side and open, unpainted ground on
# the other. It is not a missing sidewalk. It is a seam.
#
# WHY THE SEAM IS THERE. The loop below drops every `area=yes` way with the
# comment "a pedestrian AREA is a plaza, not a line", and for PAINT that is
# right — the polygon is emitted with the areas. But `scripts/bake_walk.py`
# reads the SAME `data/osm_cache/footways.json` and does not drop them: a closed
# way goes into the walking graph as an ordinary ring of edges (its own
# `areas` counter counts them). So 41 of these rings are simultaneously the
# outer EDGE of a painted polygon and a line the router sends people down, and
# the scene paints a walk's worth of nothing on the far side of it. The ribbon
# is 1.6 m wide and centred on that line, so its outer half hangs over bare
# ground for 7.1 km of rim.
#
# So paint under the line, exactly as the kerb apron does. The rim goes in as an
# ordinary footway of PEDESTRIAN_RIM_WALK_M, which is DEFAULT_WIDTH['footway']
# and not a new number: when OSM does not say how wide a walk is, this file has
# always said 2.4 m, and this is a walk.
#
# THREE THINGS MAKE IT SAFE, and all three are machinery that already exists:
#   * `u:'footway'` (52) is CUT BY the mall (60), so the inward half is
#     discarded and only the hem outside the polygon survives — see the rank
#     ladder, and the round-2 note that already relies on this cut.
#   * `u:'footway'` is also cut by the carriageway, so a mall that ends on a
#     street cannot creep onto the asphalt. `u:'pedestrian'` would NOT have
#     been: "a pedestrian mall outranks a carriageway" is right for a surveyed
#     mall and wrong for a 1.2 m hem this file derived itself.
#   * colour in js/ground.js is keyed on `s`, never on `u`, so taking the
#     mall's own surface makes the hem the mall's own colour. There is no halo
#     to see; that was checked on the frames, not assumed.
#
# Set False and the rims go back to unpainted with no other change.
# Default True / 2.4 m. Both read the environment ONLY so the control bake can
# flip them without editing this file -- `RIM=0 python scripts/bake_ground.py`
# reproduced the pre-change data/ground.geojson to the same SHA-256, which is
# what lets §14 of docs/walk-sidewalks.md say the whole diff is this change.
PEDESTRIAN_RIM_IS_A_WALK = os.environ.get("RIM", "1") != "0"
PEDESTRIAN_RIM_WALK_M = float(os.environ.get("RIM_W", DEFAULT_WIDTH["footway"]))

# ── a surveyed sidewalk must not be painted as road ────────────────────────
#
# THE THIRD FORM OF THE SAME DEFECT, and the biggest of the three. The apron
# pass painted under the walking graph at the kerb; the rim pass painted under
# it around the malls. This paints under it along the STREETS, which is where
# most of a campus's sidewalk network actually is.
#
# `resolve_ground_conflicts` cuts every `patharea` against the buffered
# carriageways, and that cut is right — it is the one cross-band cut in this
# file and it exists to stop a pale slab standing across the middle of every
# junction. But the carriageway polygon is DERIVED: `w` is lanes * LANE_M +
# KERB_M, a guess from a lane count, while a sidewalk centreline is SURVEYED.
# Where OSM maps a sidewalk close to the kerb — which is where sidewalks are —
# the whole 2.4 m slab falls inside the guessed corridor and is deleted, and
# the scene then paints asphalt over a sidewalk that is really there.
#
# Measured on this branch before the change, sampling all 160.78 km of surveyed
# campus footway at 1 m against the shipped data/ground.geojson:
#
#     ALONGSIDE (non-crossing)  149.05 km    patharea  90.5 %
#                                            roadarea   5.5 %   <- 8.24 km
#                                            cyclearea  3.9 %
#     CROSSING                   11.73 km    roadarea  66.1 %   <- correct
#
# 8.24 km of surveyed, non-crossing campus sidewalk had carriageway paint under
# it. The route audit agrees from the other side: 4.9 % of the twenty pairs'
# drawn ribbon stands on a `roadarea`, and `js/wayfind.js`'s own note (§10 of
# docs/walk-sidewalks.md) says what that costs — `WAYFIND.routeBaseM` is 0.22 m
# because a walk stands 0.22 m proud, and a road is a FLAT fill at zero, so
# over every one of those metres the walking ribbon floats 22 cm in the air.
#
# THE RULE: the carriageway cut may not take the CORE of a way OSM actually
# surveyed. It may still take the rest, so a sidewalk that overhangs the
# travelled way is still trimmed back, and a crossing apron — which this bake
# DERIVED rather than read — is still cut exactly as before. Only a surveyed
# centreline is exempt, and only for SIDEWALK_KEEP_HALF_M either side of it.
#
# HOW WIDE, and the number is not a guess. `WAYFIND.routeWidthM` is 1.6 m, so
# the walking ribbon drawn along a sidewalk is 1.6 m wide: keep a narrower strip
# than that and the ribbon covers every pixel of it, the route still LOOKS
# painted on the road, and the outer rail hangs over asphalt. That is the same
# argument PEDESTRIAN_RIM_WALK_M already makes for the mall rims, one street
# over. Measured: at a 0.45 half-width the eye-level frame at Robert Dedman
# Drive is indistinguishable from the frame before the change. 0.9 paints a
# 1.8 m strip — the ribbon plus 10 cm either side — and is still narrower than
# DEFAULT_WIDTH['footway'] / 2 = 1.2, so a sidewalk that genuinely overhangs the
# travelled way is still trimmed back.
#
# TASTE VALUE, CLAUDE.md rule 11: it is the width of the pale strip that now
# appears along the kerb of every street a surveyed sidewalk runs beside. Set it
# to 0 and the cut goes back to taking everything with no other change — checked,
# not assumed: `KEEPHALF=0 python scripts/bake_ground.py` reproduces the previous
# data/ground.geojson to the same SHA-256.
SIDEWALK_KEEP_HALF_M = float(os.environ.get("KEEPHALF", "0.9"))

# ── ...BESIDE A ROAD. NOT ACROSS ONE. ─────────────────────────────────────
#
# THE DEFECT THE LINE ABOVE CAUSED, photographed before it was changed
# (docs/shots/ground-waggener-before.jpg, straight down over Inner Campus
# Drive): pale sidewalk bars shoot out of the kerb, run three to seven metres
# into the middle of the carriageway, and stop. "Like branches" is exactly what
# they look like from the air and from the pavement.
#
# WHY. SIDEWALK_KEEP_HALF_M exempts the core of every SURVEYED walking
# centreline from the carriageway cut, and that exemption was written with one
# case in mind -- a sidewalk running ALONGSIDE a street, which falls inside the
# derived carriageway only because `w` is a guess from a lane count. It is right
# for that case and it is 8.24 km of real pavement. But it was applied to the
# whole centreline, and a campus sidewalk does not only run alongside: it also
# runs INTO the street, at every kerb ramp, every service entrance and every
# untagged desire line OSM records as `footway=sidewalk` instead of
# `footway=crossing`. On those metres the exemption punched a 1.8 m hole in the
# carriageway cutter and painted a walk on the road.
#
# MEASURED near Waggener before the change: 29 surveyed footways put more than
# 3 m2 of pavement on a carriageway inside one 380 m box, and three of them
# (ways 1380823430, 1380849647, 1380849648) are 24 m long with 16.5 m2 -- 28 %
# of their own area -- standing in the street. City-wide, 32,041 m2 of drawn
# pavement, 7.9 % of all of it, sat on a carriageway.
#
# THE RULE, and it is one sentence: THE KEEP-CORE IS FOR A WALK THAT RUNS
# BESIDE A ROAD, NEVER ONE THAT RUNS ACROSS IT. Segment by segment, compare the
# walk's own bearing with the bearing of the nearest road CENTRELINE. Within
# SIDEWALK_KEEP_PARALLEL_DEG the walk is alongside and keeps its core; beyond
# it the walk is crossing, and this bake does not draw crossings -- the
# carriageway takes it, exactly as it took every `footway=crossing` before.
#
# PER SEGMENT, not per way, and that is the whole point. Way 1245334958 is
# 419 m of sidewalk that runs beside Inner Campus Drive for most of its length
# and turns into it at the end. A per-way test would either lose 419 m of real
# pavement or keep the branch. A per-segment test keeps the 400 m and drops the
# branch, which is what the picture shows.
#
# AND A DEPTH CAP as the second guard, because the bearing test cannot see the
# case where a walk runs parallel to road A while standing in road B: no part of
# a keep-core may lie more than SIDEWALK_KEEP_DEPTH_M inside the carriageway
# from its edge. A walk beside a street pokes a metre or two past the guessed
# kerb; a walk across one goes to the middle.
#
# THE SWITCH. `KEEPANG=90 KEEPDEPTH=0 python scripts/bake_ground.py` disables
# both tests -- every segment is "alongside" and no depth is capped -- which
# reproduces the previous data/ground.geojson to the same SHA-256. Checked, not
# assumed; see docs/ground-curves-and-kerbs.md.
SIDEWALK_KEEP_PARALLEL_DEG = float(os.environ.get("KEEPANG", "35"))
# 0 disables the cap. 2.5 m is a kerb plus a gutter plus the slop in a lane
# count: measured, the derived carriageway is 1.4 m per side wider than the
# painted edge on the campus streets sampled in docs/PASS_ROADS.md.
SIDEWALK_KEEP_DEPTH_M = float(os.environ.get("KEEPDEPTH", "2.5"))

# `k:'path'` LineStrings this bake DERIVED rather than read out of OSM carry
# this private key, and the keep-core exemption skips them. It never reaches the
# output file: widen_paths re-emits {k, u, s} only. Two things wear it — the
# crossing aprons (CROSSING_APRON_M) and the mall rims (PEDESTRIAN_RIM_IS_A_WALK)
# — and both are cut by the carriageway on purpose, which is what stops an apron
# reaching past the kerb and a mall creeping onto the asphalt.
DERIVED_PATH_KEY = "drv"


# ── CURVES STAY CURVES ─────────────────────────────────────────────────────
#
# "sidewalks and roads are jagged where they should curve."
#
# TWO CAUSES, and only one of them was ours.
#
# 1. THE TOLERANCE WAS SET FOR A CAMERA THAT NO LONGER EXISTS. `simplify()`
#    ran Ramer-Douglas-Peucker at 1.2 m on every road and cycleway centreline,
#    and its own docstring justified it: "at the tolerance used nothing moves
#    by more than a quarter of a rendered pixel AT THE ZOOM THE CAMERA FLIES
#    AT". That was true of a flyover. This app walks now -- 1.2 m of lateral
#    error on a kerb ten metres from a pedestrian's eye is a visible kink, and
#    it is the same class of mistake as a facade template that only works from
#    the air. MEASURED on data/osm_cache/roads.json: 12,124 ways, 70,236 raw
#    vertices, and RDP at 1.2 m threw away 30,676 of them -- 44 % of every
#    curve the mapper actually drew. At 0.25 m it throws away 20,794, so the
#    whole cost of keeping four times the accuracy is 9,882 vertices.
#
# 2. THE MAPPER'S OWN NODE SPACING. Even with RDP off, a curve in OSM is a
#    chain of straight chords -- 8 to 15 m apart on a campus kerb -- and a
#    10 m chord on a 30 m radius stands 0.42 m off the true arc. No tolerance
#    fixes that, because the vertices are all the source has. It needs the
#    other half of the rule: put the curve back.
#
# SO THE RULE IS IN TWO PARTS AND BOTH ARE NEEDED.
#   * Simplify at CURVE_SIMPLIFY_M, a walking tolerance instead of a flying
#     one, so the vertices that describe a curve survive.
#   * Then CHAIKIN-smooth the runs that are curved, and ONLY those. A turn
#     sharper than CURVE_CORNER_DEG is a corner -- a junction, a right-angle
#     kerb return -- and rounding it off would be the tippecanoe
#     `--simplification` trap in reverse: a visual change hiding inside a
#     cleanup. A turn gentler than CURVE_MIN_DEG is a straight run and does
#     not need cutting. Only the band between them is a curve.
#
# THE GUARD, because corner-cutting MOVES geometry and this file's truth rule
# says every position comes from OSM. Chaikin cannot move a point further than
# a quarter of the shorter adjacent edge, but a long edge in the curved band
# could still shift a kerb by more than a kerb's width, so a run whose smoothed
# points stand further than CURVE_MAX_DEV_M from the polyline they came from is
# LEFT UNSMOOTHED. Reported, never silent: `curve_run_over_dev` in the stats.
#
# THE SWITCH. `CURVES=0 python scripts/bake_ground.py` puts the tolerance back
# to 1.2 m and the smoothing passes to 0, which is exactly what this file did
# before -- checked by SHA-256, not assumed. See docs/ground-curves-and-kerbs.md.
_CURVES_ON = os.environ.get("CURVES", "1") != "0"
# TASTE VALUES, CLAUDE.md rule 11. Every one is a single number at the top.
CURVE_SIMPLIFY_M = float(os.environ.get("CURVE_EPS", "0.25" if _CURVES_ON else "1.2"))
CURVE_SMOOTH_PASSES = int(os.environ.get("CURVE_SMOOTH", "2" if _CURVES_ON else "0"))
CURVE_CORNER_DEG = 40.0     # sharper than this is a CORNER and stays sharp
CURVE_MIN_DEG = 4.0         # gentler than this is straight and is left alone
CURVE_MAX_DEV_M = 0.60      # a smoothed run may not move further than this


def _turn_deg(a, b, c, kx, ky):
    """Direction change in degrees at b, walking a -> b -> c."""
    ux, uy = (b[0] - a[0]) * kx, (b[1] - a[1]) * ky
    vx, vy = (c[0] - b[0]) * kx, (c[1] - b[1]) * ky
    if (ux or uy) and (vx or vy):
        return abs(math.degrees(math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)))
    return 0.0


def _chaikin(seq, passes):
    """Chaikin corner cutting with both ENDS PINNED, so a smoothed run still
    starts and finishes on the vertices its neighbours share with it."""
    for _ in range(passes):
        out = [seq[0]]
        for i in range(len(seq) - 1):
            (px, py), (qx, qy) = seq[i], seq[i + 1]
            out.append([px + (qx - px) * 0.25, py + (qy - py) * 0.25])
            out.append([px + (qx - px) * 0.75, py + (qy - py) * 0.75])
        out.append(seq[-1])
        seq = out
    return seq


def _dev_m(smoothed, original, kx, ky):
    """Furthest a smoothed point stands from the polyline it came from, metres."""
    seg = [((original[i][0] * kx, original[i][1] * ky),
            (original[i + 1][0] * kx, original[i + 1][1] * ky))
           for i in range(len(original) - 1)]
    worst = 0.0
    for p in smoothed:
        px, py = p[0] * kx, p[1] * ky
        best = 1e18
        for (ax, ay), (bx, by) in seg:
            dx, dy = bx - ax, by - ay
            L2 = dx * dx + dy * dy
            t = 0.0 if L2 <= 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L2))
            best = min(best, math.hypot(px - (ax + dx * t), py - (ay + dy * t)))
            if best <= worst:
                break
        worst = max(worst, best)
    return worst


def smooth_curves(pts, stats=None, key="curve"):
    """Put the arc back into the runs of `pts` that are curved, and only those.

    Corners stay corners, straight runs stay straight, and a run that would move
    further than CURVE_MAX_DEV_M is returned exactly as it came in.
    """
    if CURVE_SMOOTH_PASSES <= 0 or len(pts) < 4:
        return pts
    kx = math.cos(math.radians(pts[0][1])) * M_LAT
    ky = M_LAT
    curvy = [False] * len(pts)
    for i in range(1, len(pts) - 1):
        a = _turn_deg(pts[i - 1], pts[i], pts[i + 1], kx, ky)
        curvy[i] = CURVE_MIN_DEG <= a <= CURVE_CORNER_DEG
    if not any(curvy):
        return pts
    out = [pts[0]]
    i = 1
    while i < len(pts) - 1:
        if not curvy[i]:
            out.append(pts[i])
            i += 1
            continue
        j = i
        while j < len(pts) - 1 and curvy[j]:
            j += 1
        run = pts[i - 1:j + 1]                      # anchored on both sides
        sm = _chaikin([list(p) for p in run], CURVE_SMOOTH_PASSES)
        if _dev_m(sm, run, kx, ky) > CURVE_MAX_DEV_M:
            if stats is not None:
                stats[key + "_run_over_dev"] += 1
            out.extend(pts[i:j])
        else:
            if stats is not None:
                stats[key + "_run_smoothed"] += 1
            out.extend([[round(x, 7), round(y, 7)] for x, y in sm[1:-1]])
        out.append(pts[j])
        i = j + 1
    if i == len(pts) - 1:
        pass
    out.append(pts[-1])
    # A pinned run can re-emit its own anchor; drop only exact repeats.
    ded = [out[0]]
    for p in out[1:]:
        if p != ded[-1]:
            ded.append(p)
    return ded


def crossing_aprons(coords, apron_m=None):
    """The two ends of a crossing way, `apron_m` metres each, as coordinate
    lists. Returns [] for a way shorter than one apron (it is all ramp anyway,
    and the carriageway cut will take whatever of it is street)."""
    apron_m = CROSSING_APRON_M if apron_m is None else apron_m
    mlat = 111195.08
    mlon = mlat * math.cos(math.radians(LAT0))
    pts = [((x + 97.74) * mlon, (y - LAT0) * mlat) for x, y in coords]
    segs = [math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1)]
    total = sum(segs)
    if total <= 0:
        return []
    if total <= apron_m:
        return [list(coords)]

    def walk(order):
        """Trim from one end, returning the coords covering `apron_m`."""
        idx = range(len(segs)) if order > 0 else range(len(segs) - 1, -1, -1)
        out = [coords[0] if order > 0 else coords[-1]]
        left = apron_m
        for i in idx:
            d = segs[i]
            nxt = i + 1 if order > 0 else i
            if d >= left:
                f = (left / d) if d else 0.0
                a = coords[i] if order > 0 else coords[i + 1]
                b = coords[i + 1] if order > 0 else coords[i]
                out.append([round(a[0] + (b[0] - a[0]) * f, 6),
                            round(a[1] + (b[1] - a[1]) * f, 6)])
                break
            left -= d
            out.append(list(coords[nxt]))
        return out

    head, tail = walk(1), walk(-1)
    return [p for p in (head, tail) if len(p) >= 2]


# landuse/natural/leisure value -> our `use`, for area features.
AREA_USE = {
    "grass": "lawn", "meadow": "lawn", "village_green": "lawn", "greenfield": "lawn",
    "recreation_ground": "lawn", "grassland": "lawn",
    "forest": "wood", "wood": "wood", "scrub": "scrub",
    "park": "park", "garden": "garden", "pitch": "pitch", "track": "track",
    "playground": "playground", "common": "lawn",
    "water": "water", "reservoir": "water", "basin": "water", "fountain": "fountain",
    "parking": "parking", "construction": "construction", "brownfield": "construction",
    "sand": "sand",
}

# Values that are a BUILDING or an enclosure, not a ground surface. Without
# this, `leisure=stadium` on DKR became a 235x231 m rust-red "track" slab laid
# over the entire bowl, burying the actual field inside it.
NOT_GROUND = {"stadium", "sports_centre", "grandstand", "pavilion", "building"}

M_LAT = 111320.0
unmapped_surface = Counter()
warnings = []


def load(key):
    p = os.path.join(CACHE, key + ".json")
    if not os.path.exists(p):
        warnings.append("cache miss: %s.json not fetched yet; its features are ABSENT" % key)
        return []
    with open(p, encoding="utf-8") as f:
        return json.load(f).get("elements", [])


def load_measured_widths():
    """{osm way id (str): width in metres} from data/walkway_widths.json.

    Absent file is not an error -- it is the unsourced state this bake had
    before the survey existed -- but it IS a warning, because a silently
    missing evidence file that puts every walk back on the template is
    exactly the bake trap this repo keeps being bitten by.
    """
    if not MEASURED_WIDTHS_ON:
        return {}
    p = os.path.join(ROOT, WALK_WIDTHS_REL.replace("/", os.sep))
    if not os.path.exists(p):
        warnings.append("%s missing: every walk falls back to DEFAULT_WIDTH "
                        "(run scripts/trace_walk_widths.py)" % WALK_WIDTHS_REL)
        return {}
    with open(p, encoding="utf-8") as f:
        d = json.load(f)
    return {k: float(v["w"]) for k, v in (d.get("widths") or {}).items()}


def parse_width(val):
    if val is None:
        return None
    s = str(val).strip().lower().replace("m", "").replace(" ", "").replace(",", ".")
    try:
        f = float(s)
        return f if 0.3 < f < 60 else None
    except ValueError:
        return None


def surface_of(tags, use):
    raw = tags.get("surface")
    if raw:
        s = SURFACE_MAP.get(raw.strip().lower())
        if s:
            return s, True
        unmapped_surface[raw] += 1
    return DEFAULT_SURFACE.get(use, "concrete"), False


def ring_of(geom):
    if not geom or len(geom) < 3:
        return None
    r = [[round(p["lon"], 6), round(p["lat"], 6)] for p in geom]
    if r[0] != r[-1]:
        r.append(list(r[0]))
    return r if len(r) >= 4 else None


def rings_from_relation(el):
    """Stitch outer members of a multipolygon relation into closed rings."""
    segs = []
    for m in el.get("members", []):
        if m.get("type") == "way" and m.get("role") in ("outer", "") and m.get("geometry"):
            segs.append([[p["lon"], p["lat"]] for p in m["geometry"]])
    rings = []
    while segs:
        ring = segs.pop(0)
        moved = True
        while moved and ring[0] != ring[-1]:
            moved = False
            for i, s in enumerate(segs):
                if s[0] == ring[-1]:      ring += s[1:]
                elif s[-1] == ring[-1]:   ring += s[-2::-1]
                elif s[-1] == ring[0]:    ring = s[:-1] + ring
                elif s[0] == ring[0]:     ring = s[::-1][:-1] + ring
                else:                     continue
                segs.pop(i); moved = True; break
        if ring[0] != ring[-1]:
            ring.append(list(ring[0]))
        if len(ring) >= 4:
            rings.append([[round(x, 7) for x in p] for p in ring])
    return rings


def area_m2(ring):
    """Rough planar area of a lon/lat ring, in m^2."""
    if not ring:
        return 0.0
    lat0 = sum(p[1] for p in ring) / len(ring)
    k = math.cos(math.radians(lat0))
    a = 0.0
    for (x0, y0), (x1, y1) in zip(ring, ring[1:]):
        a += (x0 * k) * y1 - (x1 * k) * y0
    return abs(a) * 0.5 * M_LAT * M_LAT


# ============================================================== the roads ==
#
# Roads used to come from the Liberty basemap's OpenMapTiles `transportation`
# source-layer, which carries `class`, `subclass`, `oneway`, `ramp` and
# `brunnel` and nothing else. No lane count, so every width was a guess per
# class; no name, so Speedway could not be told from San Jacinto; and no
# cycleway tags at all, so a bike lane could not exist even in principle.
#
# This reads OSM directly (scripts/fetch_roads.py) over the outer-ring bbox --
# the area the camera can actually see from 900 m -- and emits every road with
# what it really is.

# Metres of one US urban travel lane, and the kerb/gutter allowance either side.
# These two are the only GENERATIVE numbers in the width model; everything they
# multiply is OSM's own lane count.
LANE_M = 3.4
KERB_M = 1.6
BIKE_M = 1.8      # a 6 ft bike lane
BUFF_M = 0.9      # a 3 ft painted buffer, where cycleway:*:buffer=yes

# Fallback pavement width by highway class, for the 78% of ways OSM does not
# give a lane count. GENERATIVE: an honest typical section, not a survey.
CLASS_W = {
    "motorway": 30.0, "trunk": 24.0, "primary": 18.0, "secondary": 15.0,
    "tertiary": 12.0, "unclassified": 9.5, "residential": 9.5,
    "living_street": 8.0, "busway": 8.0, "road": 9.0, "service": 5.5,
}
LINKS = {"motorway_link": "motorway", "trunk_link": "trunk", "primary_link": "primary",
         "secondary_link": "secondary", "tertiary_link": "tertiary"}
LINK_W = 7.5      # a ramp is one lane plus shoulders

# What each OSM cycleway value MEANS, and therefore whether a lane may be drawn
# for it. This table IS the "render a lane only where the data says one exists"
# rule. Anything not in it draws nothing -- in particular `shared_lane` (a
# sharrow stencilled on a shared travel lane), `share_busway`, and `separate`
# (which is mapped as its own way and would otherwise be drawn twice).
CYCLE_KIND = {
    "lane": 1, "opposite_lane": 1, "shoulder": 1,
    "track": 2, "opposite_track": 2,
}
CYCLE_IGNORED = ("shared_lane", "share_busway", "separate", "no", "shared",
                 "shared_parking_lane", "crossing", "sidepath", "planned", "link",
                 "traffic_island")

# The surface of a road, when OSM bothers to say. Concrete carriageways are real
# here -- East MLK is tagged concrete for most of its length.
ROAD_SURF = {"asphalt": "asphalt", "chipseal": "asphalt", "paved": "asphalt",
             "concrete": "roadconcrete", "concrete:plates": "roadconcrete",
             "concrete:lanes": "roadconcrete",
             "paving_stones": "paving", "sett": "paving", "bricks": "brick",
             "gravel": "gravel", "compacted": "gravel", "unpaved": "gravel",
             "fine_gravel": "gravel", "dirt": "dirt", "ground": "dirt",
             "grass_paver": "gravel"}


def lane_count(t):
    """OSM `lanes`, defensively. Values like '2;3' and '4' both occur."""
    raw = t.get("lanes")
    if raw is None:
        return 0
    try:
        n = int(str(raw).split(";")[0].strip())
    except ValueError:
        return 0
    return n if 1 <= n <= 12 else 0


def cycle_sides(t):
    """-> (left, right) each 0 none / 1 painted lane / 2 protected track.

    OSM's scheme is a fallback chain: `cycleway:left` beats `cycleway:both`
    beats plain `cycleway`. Reading only `cycleway` would miss 663 of the 883
    tagged ways in this extract, and reading `cycleway:both` as if it were
    one-sided would draw half the lanes that exist.
    """
    both = t.get("cycleway:both") or t.get("cycleway")
    out = []
    for side in ("left", "right"):
        raw = t.get("cycleway:" + side) or both
        out.append(CYCLE_KIND.get((raw or "").strip(), 0))
    # `bicycle=designated` on a road with no cycleway tag is a bike ROUTE, not a
    # lane. It gets nothing, deliberately.
    return out[0], out[1]


def cycle_buffer(t, side):
    both = t.get("cycleway:both:buffer")
    v = t.get("cycleway:%s:buffer" % side) or both
    return 1 if (v or "").strip() == "yes" else 0


def road_width(t, bl, br):
    """Pavement width in metres, and whether the lane count was OSM's.

    lanes x 3.4 + 1.6 is the whole model. It is checkable: MLK is tagged 5 or 6
    lanes and comes out 18.6-22.0 m, Guadalupe 4-5 lanes gives 15.2-18.6 m, and
    San Jacinto's 2-3 lanes gives 8.4-11.8 m. Those are three visibly different
    roads, which is the entire complaint.
    """
    hw = t.get("highway")
    n = lane_count(t)
    if n:
        w, tagged = n * LANE_M + KERB_M, 1
    elif hw in LINKS:
        w, tagged = LINK_W, 0
    else:
        w, tagged = CLASS_W.get(hw, 9.0), 0
    # A bike lane is pavement too, and it is why a "2 lane" street measures
    # wider than 8.4 m on the ground.
    for side, kind in (("left", bl), ("right", br)):
        if kind:
            w += BIKE_M + (BUFF_M if cycle_buffer(t, side) else 0.0)
    return round(w, 1), tagged


def simplify(pts, eps_m):
    """Ramer-Douglas-Peucker on lon/lat, tolerance in metres.

    Purely a file-size measure: at the tolerance used (1.2 m) nothing moves by
    more than a quarter of a rendered pixel at the zoom the camera flies at.
    """
    if len(pts) < 3:
        return pts
    lat0 = pts[0][1]
    kx = math.cos(math.radians(lat0)) * M_LAT
    ky = M_LAT
    eps = eps_m

    def rdp(seq):
        if len(seq) < 3:
            return seq
        (x0, y0), (x1, y1) = seq[0], seq[-1]
        ax, ay = (x1 - x0) * kx, (y1 - y0) * ky
        L = math.hypot(ax, ay)
        worst, wi = -1.0, 0
        for i in range(1, len(seq) - 1):
            px_, py = (seq[i][0] - x0) * kx, (seq[i][1] - y0) * ky
            d = abs(px_ * ay - py * ax) / L if L > 1e-9 else math.hypot(px_, py)
            if d > worst:
                worst, wi = d, i
        if worst <= eps:
            return [seq[0], seq[-1]]
        return rdp(seq[:wi + 1])[:-1] + rdp(seq[wi:])

    import sys as _sys
    _sys.setrecursionlimit(10000)
    return rdp(pts)


def bake_roads(stats, warnings):
    """data/roads.geojson: carriageways, bike lanes, cycle paths, stop bars."""
    green_ids = set()
    gp = os.path.join(CACHE, "_green_lanes.json")
    if os.path.exists(gp):
        with open(gp, encoding="utf-8") as f:
            green_ids = set(json.load(f).get("green_way_ids", []))
    else:
        warnings.append("_green_lanes.json missing; no green paint will be drawn "
                        "(run scripts/sample_bike_lane_paint.py)")

    feats = []
    ways_by_node = {}          # node id -> [(way tags, geometry, index)]
    unknown_surface = Counter()
    emitted_ids = set()        # OSM way ids already drawn, so the far-field
                               # query cannot draw the same arterial twice

    def in_detail(g):
        return any(DETAIL_BB[0] <= p["lon"] <= DETAIL_BB[2]
                   and DETAIL_BB[1] <= p["lat"] <= DETAIL_BB[3] for p in g)

    # ---- carriageways ---------------------------------------------------
    for el in load("roads"):
        if el.get("type") != "way":
            continue
        t = el.get("tags", {}) or {}
        g = el.get("geometry") or []
        if len(g) < 2:
            continue
        hw = t.get("highway")
        # Underground is not ground. A tunnel drawn on the surface puts I-35's
        # lower deck through the middle of a city block.
        if t.get("tunnel") in ("yes", "building_passage") or _layer(t) < 0:
            stats["road_skipped_tunnel"] += 1
            continue
        svc = t.get("service")
        detail = in_detail(g)
        if not detail and (hw == "service" and svc in ("parking_aisle", "driveway",
                                                       "drive-through")):
            stats["road_skipped_far_service"] += 1
            continue

        bl, br = cycle_sides(t)
        w, wt = road_width(t, bl, br)
        cls = LINKS.get(hw, hw)
        surf_raw = (t.get("surface") or "").strip().lower()
        surf = ROAD_SURF.get(surf_raw, "asphalt")
        if surf_raw and surf_raw not in ROAD_SURF:
            unknown_surface[surf_raw] += 1
        # CURVES STAY CURVES: a walking tolerance, then the arc put back on
        # the runs that are curved. See the CURVE_* block.
        pts = smooth_curves(
            simplify([[round(p["lon"], 6), round(p["lat"], 6)] for p in g],
                     CURVE_SIMPLIFY_M), stats, "curve_road")
        n_lanes = lane_count(t)
        props = {
            "k": "road", "c": cls, "w": w, "wt": wt, "s": surf,
        }
        if hw in LINKS:
            props["lk"] = 1
        if n_lanes:
            props["ln"] = n_lanes
        if (t.get("oneway") or "") in ("yes", "1", "true"):
            props["ow"] = 1
        elif (t.get("oneway") or "") == "-1":
            props["ow"] = -1
        if t.get("bridge"):
            props["bg"] = 1
        if svc:
            props["sv"] = svc
        if bl:
            props["bl"] = bl
        if br:
            props["br"] = br
        if (bl or br) and el.get("id") in green_ids:
            props["gp"] = 1
            stats["road_green_painted"] += 1
        if t.get("name"):
            props["name"] = t["name"]
        feats.append({"type": "Feature",
                      "geometry": {"type": "LineString", "coordinates": pts},
                      "properties": props})
        emitted_ids.add(el.get("id"))
        stats["road_" + cls] += 1
        if wt:
            stats["road_width_FROM_LANES"] += 1
        else:
            stats["road_width_from_class_default"] += 1
        if bl or br:
            stats["road_with_bike_lane"] += 1
        # Remember the way against its nodes, for the stop bars.
        if cls in ("motorway", "trunk", "primary", "secondary", "tertiary") and detail:
            for i, nid in enumerate(el.get("nodes") or []):
                ways_by_node.setdefault(nid, []).append((props, g, i))

    # ---- the far-field arterial armature ---------------------------------
    # Taking the roads off the basemap took them off the WHOLE WORLD, and the
    # basemap had global coverage. A wide establishing shot came back with the
    # far third of the frame blank tan and the city reading as a plate -- see
    # shots/before-wide-day.png against shots/roads-wide-day.png.
    #
    # So motorways, trunks, primaries and secondaries are pulled over a box about
    # four times the outer ring and appended. Nothing smaller: at 5 km out a
    # residential street is sub-pixel. Geometry is simplified five times harder,
    # because at that distance 6 m is well under a pixel, and the cycleway and
    # bike-lane properties are dropped -- a bike lane 6 km away is not a thing.
    for el in load("roads_far"):
        if el.get("type") != "way" or el.get("id") in emitted_ids:
            continue
        t = el.get("tags", {}) or {}
        g = el.get("geometry") or []
        if len(g) < 2:
            continue
        if t.get("tunnel") or _layer(t) < 0:
            continue
        hw = t.get("highway")
        cls = LINKS.get(hw, hw)
        n = lane_count(t)
        w = round(n * LANE_M + KERB_M, 1) if n else (
            LINK_W if hw in LINKS else CLASS_W.get(hw, 12.0))
        pts = simplify([[round(p["lon"], 5), round(p["lat"], 5)] for p in g], 6.0)
        props = {"k": "road", "c": cls, "w": w, "wt": 1 if n else 0,
                 "s": "asphalt", "far": 1}
        if hw in LINKS:
            props["lk"] = 1
        if (t.get("oneway") or "") in ("yes", "1", "true"):
            props["ow"] = 1
        feats.append({"type": "Feature",
                      "geometry": {"type": "LineString", "coordinates": pts},
                      "properties": props})
        stats["road_far_" + cls] += 1

    # ---- separate cycle ways --------------------------------------------
    for el in load("cycleways"):
        if el.get("type") != "way":
            continue
        t = el.get("tags", {}) or {}
        g = el.get("geometry") or []
        if len(g) < 2:
            continue
        if t.get("tunnel") or _layer(t) < 0:
            continue
        # A `cycleway=crossing` is a road marking across a junction, not a path.
        # Drawing them lays a hatch across every intersection -- the same trap
        # the footway bake already hits with footway=crossing.
        if t.get("cycleway") == "crossing" or t.get("footway") == "crossing":
            stats["cycle_skipped_crossing"] += 1
            continue
        hw = t.get("highway")
        if hw != "cycleway" and (t.get("bicycle") or "") not in ("designated",):
            # A footway merely signed bicycle=yes is a footpath; the footway
            # bake already draws it, and drawing it again doubles it.
            stats["cycle_skipped_shared_footway"] += 1
            continue
        w = parse_width(t.get("width")) or 0
        # CURVES STAY CURVES: a walking tolerance, then the arc put back on
        # the runs that are curved. See the CURVE_* block.
        pts = smooth_curves(
            simplify([[round(p["lon"], 6), round(p["lat"], 6)] for p in g],
                     CURVE_SIMPLIFY_M), stats, "curve_road")
        surf_raw = (t.get("surface") or "").strip().lower()
        feats.append({
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": pts},
            "properties": {
                "k": "cycle", "w": round(w or 2.5, 1), "wt": 1 if w else 0,
                "s": ROAD_SURF.get(surf_raw, "asphalt"),
                **({"sg": 1} if t.get("segregated") == "yes" else {}),
                **({"name": t["name"]} if t.get("name") else {}),
            },
        })
        stats["cycle_path"] += 1

    # ---- stop bars at signalised approaches ------------------------------
    # A real stop bar is 12-24 in deep and spans one direction of travel. At the
    # altitude the camera flies at one pixel is ~0.5 m, so the DEPTH is drawn
    # over-scale (js/ground.js, GROUND.stopBarDepth) and the LENGTH is true.
    # That is declared, not hidden -- see docs/PASS_ROADS.md.
    signals = [el for el in load("furn_vertical")
               if el.get("type") == "node"
               and (el.get("tags") or {}).get("highway") == "traffic_signals"]
    SETBACK = 5.5          # metres back from the junction node
    for nd in signals:
        for props, g, i in ways_by_node.get(nd["id"], []):
            half = props["w"] / 2.0
            for direction in (-1, 1):
                p = _walk(g, i, SETBACK * direction)
                if p is None:
                    continue
                (lon, lat), (ux, uy) = p
                # Approaching WITH the way's direction, the driver's right is
                # the way's right; approaching against it, the driver's right is
                # the way's left. So the two bars sit on opposite sides, which
                # is exactly how a two-way junction looks from the air.
                if direction > 0 and props.get("ow"):
                    continue                     # no opposing approach on a oneway
                sgn = 1.0 if direction < 0 else -1.0
                nx, ny = -uy * sgn, ux * sgn
                kx = math.cos(math.radians(lat)) * M_LAT
                a = [lon, lat]
                b = [lon + nx * half / kx, lat + ny * half / M_LAT]
                feats.append({
                    "type": "Feature",
                    "geometry": {"type": "LineString",
                                 "coordinates": [[round(a[0], 6), round(a[1], 6)],
                                                 [round(b[0], 6), round(b[1], 6)]]},
                    "properties": {"k": "stopbar", "c": props["c"]},
                })
                stats["stopbar"] += 1

    fc = {"type": "FeatureCollection", "features": feats}
    with open(OUT_ROADS, "w", encoding="utf-8") as f:
        json.dump(fc, f, separators=(",", ":"))
    stats["road_unknown_surface_values"] = dict(unknown_surface)
    stats["roads_file_kb"] = round(os.path.getsize(OUT_ROADS) / 1024, 1)
    stats["roads_features"] = len(feats)
    stats["signals_seen"] = len(signals)
    return feats


def _layer(t):
    try:
        return int(str(t.get("layer", 0)).strip())
    except ValueError:
        return 0


def _walk(g, i, dist_m):
    """Walk `dist_m` along a way from vertex i. -> ((lon,lat), unit tangent)."""
    if not (0 <= i < len(g)):
        return None
    step = 1 if dist_m > 0 else -1
    need = abs(dist_m)
    j = i
    while 0 <= j + step < len(g):
        a, b = g[j], g[j + step]
        kx = math.cos(math.radians(a["lat"])) * M_LAT
        dx = (b["lon"] - a["lon"]) * kx
        dy = (b["lat"] - a["lat"]) * M_LAT
        L = math.hypot(dx, dy)
        if L < 1e-9:
            j += step
            continue
        if L >= need:
            t = need / L
            lon = a["lon"] + (b["lon"] - a["lon"]) * t
            lat = a["lat"] + (b["lat"] - a["lat"]) * t
            # Tangent points along the way's own direction, always.
            return ([lon, lat], (dx / L * step, dy / L * step))
        need -= L
        j += step
    return None


# ---------------------------------------------------------- water shape --
#
# WHY THIS EXISTS AT ALL: js/ground.js has carried a `creek` and a `pond` colour
# in all three palettes, plus a whole `ground-creek-bank` layer with its own
# taste knobs and a paragraph explaining why a wooded channel must not be
# painted the same pale blue as Lady Bird Lake -- and NOTHING HAS EVER SET
# `s` TO EITHER. Every water area in the file is `s: "water"`, so the bank layer
# has never drawn a pixel and both palette entries have never been read. The
# rule the code was written against was simply missing.
#
# THE RULE. A watercourse is long and thin; a pond is compact. The isoperimetric
# quotient Q = 4*pi*A / P^2 is 1.0 for a circle and tends to 0 for a ribbon, so
# it says exactly that and needs no threshold on size. Measured over the twelve
# water areas in this file:
#
#     Q  0.008 0.011 0.012 0.016 0.017 0.031 0.036  | 0.183 0.199 0.310 0.767 0.991
#            seven creeks, up to 40,745 m2          |     five ponds, from 19 m2
#
# The gap between 0.036 and 0.183 is five-fold, so the cut is not delicate. 0.15
# sits in the middle of it.
WATER_Q_CREEK = 0.15


def _shape_q(ring_m):
    """4*pi*A/P^2 — 1.0 for a circle, near 0 for a long thin ribbon."""
    a = abs(sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(ring_m, ring_m[1:]))) / 2.0
    per = sum(math.hypot(x1 - x0, y1 - y0) for (x0, y0), (x1, y1) in zip(ring_m, ring_m[1:]))
    return (4 * math.pi * a / (per * per)) if per > 0 else 0.0


def classify_water(feats, stats):
    """u:'water' areas become s:'creek' or s:'pond' by their own shape."""
    for f in feats:
        p = f["properties"]
        if p.get("u") != "water" or f["geometry"]["type"] != "Polygon":
            continue
        ring = f["geometry"]["coordinates"][0]
        if len(ring) < 4:
            continue
        lat0 = sum(q[1] for q in ring) / len(ring)
        kx = math.cos(math.radians(lat0)) * M_LAT
        q = _shape_q([(x * kx, y * M_LAT) for x, y in ring])
        p["s"] = "creek" if q < WATER_Q_CREEK else "pond"
        p["q"] = round(q, 4)
        stats["water_" + p["s"]] += 1
    return feats


# ------------------------------------------------------------ Waller Creek --
#
# "you added a bit of green around the creeky water when i asked for more than
# just that ... the creek behind patton and alumni is a very vibrant in depth
# creek, samd with the area behind san jacinto and the rec center and the track
# that area also very lush. Hope you will add more detail there and not the bare
# minimum"
#
# What was here was a 9 m ring of `u:'wood'` around each creek and nothing else:
# a flat green ribbon at the same height as the lawn beside it, with a blurred
# dark line along its edge standing in for a bank. He is right that it is the
# bare minimum, and the picture is `shots/creek2/before/patton.png`.
#
# THE CHANNEL IS CUT NOW, and the thing that unblocked it is one measurement.
# PR #62's docstring says a basin must build UP from z=0 because "a `fill` does
# not depth-test against a `fill-extrusion`, so a basin sunk below z=0 is painted
# straight over by the flat ground fill above it." That is true of a fill drawn
# over the same ground -- and the answer is therefore not to build upward, it is
# to STOP DRAWING THE FLAT FILL THERE. The resolver added for A2 already does
# exactly that for a living: give the channel the top rank and every lawn, wood
# and park polygon gives up its footprint. With no flat fill over the hole,
# `fill-extrusion-base` may go negative, and the creek can be a trench.
#
# So the profile is real geometry:
#
#   grade 0.0 ---\                                            /--- 0.0
#                 \___ terrace   -0.6                  -0.6 __/
#                     \___ bench -1.3                -1.3 __/
#                         \__ toe -2.0            -2.0 __/
#                            [====== water -2.4 ======]
#                             bed -3.0
#
# Every number is a taste knob (CHANNEL below) and every one of them is drawn
# from the same place: Waller Creek through campus runs 2-4 m below the walks
# either side, which is why it needs bridges at 21st, 23rd and 24th rather than
# a kerb. The depth is scaled by the reach's OWN width so the 4.7 m reach north
# of Dean Keeton is not given the same trench as the 10.3 m reach downstream.
#
# THE PLANTING IS THREE ZONES, NOT ONE COLOUR. A Central Texas riparian corridor
# is legible from the air precisely because it is layered: bare or gravelly bank
# at the water, scrub and understorey above the toe, then closed canopy that is
# noticeably darker than any lawn. One `u:'wood'` band cannot say that. Widths
# scale with the reach, so the wide reaches behind the Alumni Center and behind
# the Rec Center get the deep corridor he is describing and a 4.7 m headwater
# ditch does not pretend to be one.
CHANNEL = {
    # Depth of the water surface below grade, as a MULTIPLE of the reach's own
    # mean width, then clamped. 0.30 x a 7 m channel is 2.1 m, which is what the
    # bridge soffits on campus imply.
    "depth_per_width": 0.30,
    "depth_min_m": 1.4,
    "depth_max_m": 3.2,
    # The bed sits this far below the water surface. It is only ever seen
    # through the water colour, so it is shallow on purpose.
    "bed_below_water_m": 0.6,
    # Bank courses between grade and the water, and how far back the top of bank
    # is from the water's edge, as a multiple of the reach's mean width.
    "courses": 3,
    "bank_per_width": 0.75,
    "bank_min_m": 2.5,
    "bank_max_m": 9.0,
    # A bank is not a staircase of equal treads, and the horizontal run and the
    # vertical drop are NOT the same distribution -- that is the difference
    # between a cut section and a ramp. Both are fractions, outermost course
    # first, and both must sum to 1.0; it is asserted below rather than trusted.
    #
    # First cut used one list for both and gave the outermost course half the
    # run at zero drop. That is a 2.6 m flat shelf at grade wearing the chalk
    # colour, and from the air it read as a dirt TRACK running beside the water
    # rather than as the top of a bank (shots/creek2/after/patton-n.png, first
    # version). Steeper at the top, flatter at the toe, is the real section.
    "course_run":  [0.34, 0.34, 0.32],
    "course_drop": [0.42, 0.33, 0.25],
    # And the bank is GREEN except at the water. Waller Creek through campus is
    # a vegetated cut with Austin Chalk showing at the toe and under the
    # bridges, not an earthwork -- the pale ledge belongs at the water line and
    # nowhere else. Outermost course first.
    "course_mat": ["bankveg", "bankshade", "bank"],
    # Planting, as multiples of the reach's mean width, measured OUT from the
    # top of bank. scrub -> understorey -> canopy.
    "scrub_per_width": 0.45,
    "under_per_width": 0.90,
    "canopy_per_width": 1.60,
    "scrub_min_m": 2.0, "scrub_max_m": 6.0,
    "under_min_m": 4.0, "under_max_m": 12.0,
    "canopy_min_m": 7.0, "canopy_max_m": 24.0,
    # THE WATER SHEEN. The channel had a water PRISM from the start and it was
    # still read as "a green stripe", and the reason is measurable rather than
    # aesthetic: `BANK_MAT.water` was #41604a (luma 88) against `bankshade`
    # #425c33 (luma 82) two metres away, both green-dominant. Six luma and no
    # hue difference is not a surface, it is the same surface. So the water gets
    # a cool colour in js/ground.js AND a rippled top face here.
    #
    # The sheen is its OWN 0.10 m slab standing on the water rather than a
    # pattern on the water prism itself, for two reasons. A `fill-extrusion`
    # takes a colour or a pattern and not both, so painting the ripple on the
    # water prism would cost the water its time-of-day colour; and two prisms
    # with tops at exactly the same z is the A2 defect this bake exists to
    # remove. 0.10 m is under a fifth of a pixel from any altitude this app
    # flies and it makes the depth order defined.
    "sheen_m": 0.10,
    # Drop the slivers a difference leaves behind.
    "min_m2": 3.0,
    # A 3.9 km creek buffered seven times with round joins is 1 MB of vertices
    # on its own -- the first cut DOUBLED data/ground.geojson, from 1,067 to
    # 2,081 KB, and this file is not tiled. 0.5 m is about one pixel at the
    # altitude the camera flies at, and 3 segments per quarter-turn is plenty
    # for a bank line that is never straight in the first place.
    "simplify_m": 0.5,
    "quad_segs": 3,
}


# ------------------------------------------------- crossings over the creek --
#
# "the creek near DKR completely slices through 21st and DKR, but sidewalks
# still go over them (added to the ducktape analogy) same thing happened with
# this creek and other roads too"
#
# He is describing both halves of one omission. cut_creek_channels digs a
# trench along the whole reach and was never told that anything crosses it, so:
# the carriageway is interrupted by a 2 m gorge, and the footway -- which IS
# drawn across, because a patharea is a flat slab that knows nothing about what
# is under it -- appears to hang over the water on nothing.
#
# Where a street meets a creek there is a culvert or a bridge, and the ground
# over it belongs to the STRUCTURE, not to the channel. That is exactly what the
# A2 rank ladder is for: `RANK[('bank','deck')]` sits above the channel, so the
# trench, the banks and the planting all give the crossing back its footprint
# and the road runs over the top. One square metre, one surface -- QUEUE A4.
#
# Measured on merged main before any of this: 30 road centrelines cross the
# creek's own water polygons, of which 11 carry an OSM `bridge` tag and 19 do
# not. The tag is not the test and must not be: a culverted crossing is not
# tagged as a bridge and is still a crossing. Geometry is the test.
DECK = {
    "enable": True,
    # A crossing is decked where the way meets the WATER, not where it meets the
    # planted corridor. The corridor runs 30-60 m wide at its zones and a street
    # running parallel 20 m away is not a bridge -- testing against the corridor
    # decked half of San Jacinto Boulevard on the first run.
    # THE DECK IS DERIVED FROM WHAT IS DRAWN ON IT, plus a parapet. It is not a
    # re-buffered centreline, and the difference is the whole look of the thing.
    #
    # First cut buffered the centreline by half-width + 3.5 m of shoulder. On a
    # 9.5 m street that is a 16.5 m deck, of which 7 m has nothing drawn over it
    # -- photographed at Aug 3, it read as a large pale slab dropped beside the
    # road rather than as the road crossing the water. Halving the shoulder
    # barely moved it, because the number was never the problem: a deck derived
    # from the centreline cannot know where the carriageway's edge actually is.
    #
    # `widen_roads` draws the carriageway at exactly w/2 with flat caps, so the
    # deck takes THAT band and the walk polygons as they will really be drawn,
    # and adds only a parapet. What shows from above is then a rim, which is
    # what a bridge looks like from above.
    "parapet_m": 0.7,
    # A road and its sidewalk are separate polygons a couple of metres apart, and
    # a deck that is only their union has a slot of open trench running between
    # them. A morphological closing at this radius seals any gap up to twice it
    # without growing the outline -- a real deck is continuous under both.
    "close_gap_m": 3.0,
    # How far past the cut the deck reaches onto solid ground at each end.
    # Without an abutment the deck stops exactly on the trench edge and leaves a
    # sliver of bank standing proud of the carriageway it was meant to carry.
    "abutment_m": 2.5,
    # The slab's thickness. Only its EDGE is ever seen -- the road on top is
    # drawn by ground-road and the walks by ground-paths -- so this is the depth
    # of the soffit that reads from a low oblique, not a structural number.
    "soffit_m": 1.1,
    # The top sits just BELOW grade. `ground-road` is a flat fill at z=0, so a
    # deck topping out at exactly 0.0 is two coplanar surfaces with no defined
    # winner, which is the A2 defect this bake exists to remove. 40 mm is under
    # a tenth of a pixel from any altitude here and it makes the order defined.
    "top_below_grade_m": 0.04,
    # Slivers where a way clips the very corner of the corridor are not
    # crossings; they are noise, and each one would be a floating grey chip.
    "min_m2": 6.0,
    "simplify_m": 0.4,
}


# ------------------------------------------------------- the creek canopy --
#
# "Waller Creek is still a green stripe ... there is NO WATER SURFACE and no
# canopy from flying altitude -- the src:'creek_canopy' hook added in an earlier
# pass was never consumed."
#
# The hook is real: 33 features carry `src:'creek_canopy'` and 34 carry
# `creek_under`, and they were written for `shape_trees.py` to read and densify
# `data/trees.geojson` over. Nothing has read them, so the corridor is still a
# FLAT green ribbon: three tones of paint at exactly the height of the lawn
# beside it. From 200 m a flat tone is a flat tone whatever colour it is, which
# is why every previous colour change to this corridor failed to fix it.
#
# WHAT ACTUALLY MAKES A CANOPY READ FROM THE AIR is not the colour, it is that
# the top of it is TEN METRES ABOVE THE GROUND. A raised, lumpy, self-shadowing
# mass reads as trees from any altitude; a green polygon on the ground never
# will. So the canopy is geometry, baked here, and it does not wait on the trees
# file.
#
# WHY NOT JUST EXTRUDE THE ZONE POLYGON. A single flat-topped slab over the
# whole 125,383 m2 canopy band is a 12 m green wall following the creek -- the
# giant-hedge failure this repo has already shipped once. A canopy has to have a
# broken silhouette and a varying top, so it is built from overlapping crowns.
#
# AND NOT AS TIERED DISCS. HANDOFF §35 item 7 is that every tree in the scene is
# "a stack of flat octagonal discs ... wedding cakes". Stacking is what produces
# that, so a crown here is ONE prism and the variety comes from three species
# with different radius, height and colour, plus a per-crown wobble on the ring.
# Overlapping single prisms merge into a mass; stacked ones read as furniture.
CANOPY = {
    "on": True,
    # Grid spacing in metres, staggered every other row (a hexagonal lattice, so
    # the density is 1 / (spacing^2 * sin60)). This is the ONE knob that trades
    # canopy density against file size, and the file is not tiled, so it is the
    # expensive knob. Measured on this data: 20 m gives ~0.82 crown coverage at
    # about 150 KB, 14 m gives full closure at about 300 KB on a 1.3 MB file.
    "spacing_m": 20.0,
    # How far a crown centre may wander off its lattice point, as a fraction of
    # the spacing. A lattice you can SEE is worse than no canopy at all -- and
    # this is jittered off the point's own coordinates, not off a running RNG,
    # so adding one reach cannot move every crown in the file.
    "jitter": 0.40,
    # Which planted zones get crowns. The scrub band next to the water does NOT:
    # it is the one place the channel is visible from above, and roofing it over
    # would hide the water this same pass just gave the creek. Real corridors are
    # open at the water's edge for the same reason -- that is where the light is.
    "zones": ("under", "canopy"),
    # Per species: (radius m, crown top m, share). The top is where the foliage
    # ENDS; the base is `base_frac` of it, so a crown is a thick mass rather than
    # a floating plate, and neighbours close the gaps between them. Waller Creek
    # through campus is bald cypress at the water, pecan and cedar elm above it,
    # live oak on the terrace -- three is enough to stop it reading as one green.
    "species": {
        "cypress": (6.5, 19.0, 0.28),   # tall, narrow, blue-green
        "pecan":   (10.5, 16.0, 0.40),  # broad, light, yellow-green
        "liveoak": (9.5, 11.5, 0.32),   # wide and low, dark
    },
    # Each crown's own radius and height are drawn from +/- this fraction of its
    # species' figures, so no two are identical and the top surface is lumpy.
    # SIZE VARIANCE IS THE ANTI-BLOCK KNOB and it is worth more than vertices.
    # At 0.30 a species renders as one repeated slab: 261 pecans within +/-30%
    # of each other, tops within a metre, and a cluster of them is a plateau.
    # At 0.45 the same 261 span 5.8 to 15.2 m of radius and the canopy line is
    # broken by neighbours that are half the height of each other. Costs zero
    # bytes, which is the whole reason it is the first thing to reach for.
    "size_var": 0.45,
    # A LONE PRISM IS A BLOCK; A CLUSTER OF THEM IS A CANOPY. This is the fix
    # for the thing the first render got wrong and it is worth stating plainly:
    # eight sides, a wobbled ring and 45% size variance do NOT stop a single
    # isolated crown from reading as a flat-topped green box
    # (shots/creek/crop-corridor.png, the dark one standing alone over San
    # Jacinto). What stops it is a NEIGHBOUR — two crowns that overlap merge
    # into one silhouette with a stepped top, and three merge into foliage.
    #
    # So a crown must have at least `min_neighbours` others whose centres are
    # within `touch` x (r_i + r_j), or it is not emitted. It costs nothing; it
    # SAVES bytes, because the crowns it deletes are the ones stranded in the
    # narrow reaches where the planted band is a few metres wide.
    #
    # AND `touch` IS 1.3, NOT THE 0.85 THAT WOULD MEAN "ACTUALLY OVERLAPPING",
    # because 0.85 measured at 27 crowns out of 604. That is arithmetic, not a
    # tuning accident: at spacing 20 m and mean radius 8.8 m, two lattice
    # neighbours are ~20 m apart and 0.85 x (r_i + r_j) is 15 m, so almost
    # nothing qualifies. Requiring literal overlap requires spacing under the
    # crown DIAMETER, which is 1,206 crowns and 374 KB on an untiled file, and
    # that is not a trade worth making for a defect only visible at 3x
    # magnification of a z17.4 frame -- at the altitudes this camera flies
    # (shots/creek/air.png, z16.2) the corridor already reads as a mass. 1.3
    # keeps a crown that has company within ~24 m and drops the ones stranded
    # alone in a narrow reach, which is where the block read actually happens.
    #
    # AND `min_neighbours` IS 1, WHICH IS THE HONEST ANSWER TO A MEASUREMENT.
    # Requiring two neighbours kept 132 of 604, because the planted band is a
    # 10-30 m ribbon and a 20 m lattice puts roughly ONE crown across it: there
    # is no cluster to belong to. The band's own geometry, not the rule, is why
    # this corridor is a line of trees rather than a wood, and the only way to
    # change that is to halve the spacing -- 1,206 crowns, 374 KB, on a file
    # that is not tiled. `spacing_m` is that knob and this is the number to
    # quote when turning it.
    "min_neighbours": 1,
    "touch": 1.5,
    "base_frac": 0.34,          # underside of the foliage, as a fraction of top
    # SIDES 8, AND IT WAS 6, AND THE PICTURE IS THE ARGUMENT. Six sides at this
    # radius renders a flat-topped block -- shots/creek-after/recctr.png at
    # spacing 19 has crowns that read as green CUBES beside the existing trees,
    # not as foliage. Two more vertices is ~50 bytes a crown, paid for by taking
    # the spacing from 19 m back to 20 m. Below about 8 the silhouette is the
    # polygon; above it, it is the wobble.
    "sides": 8,                 # ring vertices; every extra one is ~25 bytes x N
    "wobble": 0.34,             # per-vertex radius variation, kills the polygon
    # Crowns are POSITIONS, not surfaces: 5 decimal places is 1.1 m here, which
    # is a fiftieth of a crown and a fifth of a pixel from flying altitude. 6 dp
    # everywhere else in this file costs 12 bytes per crown for nothing.
    "coord_dp": 5,
    "min_h_m": 5.0,             # never emit a crown shorter than this
}


def _h01(*ints):
    """Deterministic hash of integers -> [0,1). Positional, never sequential.

    A running RNG would be reproducible too, but only for an unchanged input:
    add one creek reach and every crown downstream of it moves. Hashing the
    lattice cell means a crown depends on WHERE it is and nothing else, so a
    re-bake after an OSM refresh moves only the trees near what changed.
    """
    s = 0x9E3779B9
    for v in ints:
        s = (s ^ (int(v) & 0xFFFFFFFF)) * 0x85EBCA6B & 0xFFFFFFFF
        s ^= s >> 13
    s = (s * 0xC2B2AE35) & 0xFFFFFFFF
    return ((s ^ (s >> 16)) & 0xFFFFFF) / 0x1000000


def plant_creek_canopy(feats, stats, warnings):
    """Overlapping crown prisms over the creek's understorey and canopy zones."""
    if not CANOPY["on"]:
        return feats
    try:
        from shapely.ops import unary_union
        from shapely.geometry import Point
    except ImportError:
        warnings.append("shapely not installed: the creek gets no canopy")
        return feats

    want = {"creek_" + z for z in CANOPY["zones"]}
    band = [f for f in feats if f["properties"].get("src") in want
            and f["geometry"]["type"] == "Polygon"]
    if not band:
        warnings.append("no creek_%s zones to plant: did cut_creek_channels run?"
                        % "/".join(CANOPY["zones"]))
        return feats

    polys = [g for g in (_poly_m(f["geometry"]) for f in band) if g and not g.is_empty]
    area = unary_union(polys)
    stats["canopy_band_m2"] = int(area.area)

    # Cumulative species shares, so one hash draw picks the species.
    names = sorted(CANOPY["species"])
    acc, cuts = 0.0, []
    for n in names:
        acc += CANOPY["species"][n][2]
        cuts.append((acc, n))
    if abs(acc - 1.0) > 1e-6:
        warnings.append("CANOPY.species shares sum to %.3f, not 1.0" % acc)

    S = CANOPY["spacing_m"]
    row_h = S * math.sin(math.radians(60))
    x0, y0, x1, y1 = area.bounds
    dp, sides, var = CANOPY["coord_dp"], CANOPY["sides"], CANOPY["size_var"]
    made = 0

    # ---- candidates on a staggered lattice ------------------------------
    cand = []
    j = 0
    y = y0
    while y <= y1 + row_h:
        # Stagger every other row: a square lattice is visible as rows and
        # columns the moment the crowns are regular in size, and they are.
        x = x0 + (S / 2.0 if j % 2 else 0.0)
        i = 0
        while x <= x1 + S:
            cx = x + (_h01(i, j, 1) - 0.5) * 2 * CANOPY["jitter"] * S
            cy = y + (_h01(i, j, 2) - 0.5) * 2 * CANOPY["jitter"] * row_h
            if area.contains(Point(cx, cy)):
                t = _h01(i, j, 3)
                sp = next(n for c, n in cuts if t <= c)
                r0, h0, _ = CANOPY["species"][sp]
                r = r0 * (1.0 + (_h01(i, j, 4) - 0.5) * 2 * var)
                h = h0 * (1.0 + (_h01(i, j, 5) - 0.5) * 2 * var)
                if h >= CANOPY["min_h_m"]:
                    cand.append((cx, cy, r, h, sp, i, j))
            x += S
            i += 1
        y += row_h
        j += 1
    stats["canopy_candidates"] = len(cand)

    # ---- drop the loners ------------------------------------------------
    # O(n^2) over ~700 points is nothing, and an index here would be one more
    # thing that can be wrong about a number nobody re-derives.
    touch, need = CANOPY["touch"], CANOPY["min_neighbours"]
    keep = []
    for a in cand:
        n = 0
        for b in cand:
            if b is a:
                continue
            if math.hypot(a[0] - b[0], a[1] - b[1]) <= touch * (a[2] + b[2]):
                n += 1
                if n >= need:
                    break
        if n >= need:
            keep.append(a)
    stats["canopy_dropped_isolated"] = len(cand) - len(keep)

    # ---- emit -----------------------------------------------------------
    covered = 0.0
    for cx, cy, r, h, sp, i, j in keep:
        a0 = _h01(i, j, 6) * math.tau
        ring = []
        for k in range(sides):
            a = a0 + math.tau * k / sides
            rk = r * (1.0 + (_h01(i, j, 10 + k) - 0.5) * 2 * CANOPY["wobble"])
            ring.append([round((cx + rk * math.cos(a)) / _KX, dp),
                         round((cy + rk * math.sin(a)) / M_LAT, dp)])
        ring.append(ring[0])
        feats.append({
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": [ring]},
            # `b` is NOT baked: js/ground.js derives it as base_frac * h, which
            # is 12 bytes x N saved on a file that ships whole.
            #
            # TWO decimal places on `h`, not one, and it is not fussiness:
            # crowns OVERLAP by design, and two overlapping prisms with tops at
            # exactly the same z is the A2 z-fight. At 0.1 m a species has ~80
            # distinct heights across 261 crowns and ties are common; at 0.01 m
            # they are ~1 in 800 and would have to overlap as well. 3 bytes a
            # crown, 1.8 KB in the file.
            "properties": {"k": "cnp", "m": sp, "h": round(h, 2)},
        })
        stats["canopy_" + sp] += 1
        covered += math.pi * r * r
        made += 1

    stats["canopy_crowns"] = made
    # Crown area over band area. It is an UPPER bound -- crowns overlap, which
    # is the point -- so read it as "how much foliage per square metre of band",
    # not as closure. Under about 0.8 the corridor has holes you can see through.
    stats["canopy_cover_ratio"] = round(covered / max(1.0, area.area), 2)
    return feats


def _mean_width(poly):
    """Area / (half the perimeter) -- the width of the equivalent ribbon.

    For a long thin polygon the perimeter is very nearly twice the length, so
    this is the honest mean width and it needs no centreline. Measured against
    the seven reaches in this file it gives 4.7 to 10.3 m, which is what Waller
    Creek is.
    """
    per = poly.length
    return (poly.area / (per / 2.0)) if per > 1e-6 else 0.0


def _emit(feats, gm, props, stats, key, min_m2, simplify_m=None):
    """Emit a metric shapely geometry as lon/lat Polygon feature(s).

    `simplify_m` defaults to the creek's 0.5 m, which is about a pixel at flying
    altitude and right for a 3.9 km bank line. It is WRONG for a small round
    thing: a 5.5 m specimen bed simplified at 0.5 m collapses to an octagon, and
    it looked like one. Anything under ~10 m across passes its own tolerance.
    """
    tol = CHANNEL["simplify_m"] if simplify_m is None else simplify_m
    if tol:
        gm = gm.simplify(tol)
    parts = list(gm.geoms) if gm.geom_type == "MultiPolygon" else [gm]
    n = 0
    for g in parts:
        if g.geom_type != "Polygon" or g.is_empty or g.area < min_m2:
            continue
        rings = [[[round(x / _KX, 6), round(y / M_LAT, 6)] for x, y in g.exterior.coords]]
        rings += [[[round(x / _KX, 6), round(y / M_LAT, 6)] for x, y in r.coords]
                  for r in g.interiors]
        feats.append({"type": "Feature",
                      "geometry": {"type": "Polygon", "coordinates": rings},
                      "properties": dict(props)})
        n += 1
    stats[key] += n
    return n


def cut_creek_channels(feats, stats, warnings):
    """Waller Creek as a cut channel with a layered riparian corridor."""
    try:
        from shapely.geometry import Polygon
    except ImportError:
        warnings.append("shapely not installed: the creek stays a flat ribbon")
        return feats

    run, drop = CHANNEL["course_run"], CHANNEL["course_drop"]
    mats = CHANNEL["course_mat"]
    for name, lst in (("course_run", run), ("course_drop", drop)):
        if len(lst) != CHANNEL["courses"] or abs(sum(lst) - 1.0) > 1e-6:
            warnings.append("CHANNEL.%s must have `courses` entries summing to "
                            "1.0; got %s -- channel NOT cut" % (name, lst))
            return feats
    if len(mats) != CHANNEL["courses"]:
        warnings.append("CHANNEL.course_mat must have `courses` entries -- "
                        "channel NOT cut")
        return feats

    creeks = [f for f in feats
              if f["properties"].get("s") == "creek"
              and f["geometry"]["type"] == "Polygon"]
    if not creeks:
        warnings.append("no s:'creek' features: classify_water ran before this?")
        return feats

    clamp = lambda v, lo, hi: max(lo, min(hi, v))
    for f in creeks:
        water = _poly_m(f["geometry"])
        if water is None or water.is_empty:
            continue
        w = _mean_width(water)
        if w <= 0.5:
            continue
        depth = clamp(CHANNEL["depth_per_width"] * w,
                      CHANNEL["depth_min_m"], CHANNEL["depth_max_m"])
        bank = clamp(CHANNEL["bank_per_width"] * w,
                     CHANNEL["bank_min_m"], CHANNEL["bank_max_m"])
        f["properties"]["dep"] = round(depth, 2)     # so the report can be read
        f["properties"]["bw"] = round(w, 1)

        # ---- the bed and the water surface -------------------------------
        #
        # EVERY PRISM STANDS ON THE SAME BED and only its TOP differs. That is
        # not a shortcut: courses that each started at the tread below them
        # would put a downward-facing wall at the OUTER edge of the outermost
        # course, i.e. a wall visible from outside the channel with nothing
        # behind it. Standing them all on the bed leaves exactly one visible
        # vertical face per course -- the riser looking INTO the trench, which
        # is the whole read -- and the rings do not overlap in plan, so nothing
        # here can re-introduce the A2 defect.
        bed = -(depth + CHANNEL["bed_below_water_m"])
        _emit(feats, water, {"k": "bank", "u": "channel", "m": "water",
                             "b": round(bed, 2), "h": round(-depth, 2)},
              stats, "creek_water_prism", 1.0)
        # The rippled top face. Same footprint, standing CHANNEL.sheen_m on the
        # water, so `ground-creek-sheen` can carry the water pattern while the
        # prism under it keeps its time-of-day colour. See CHANNEL.sheen_m.
        # Simplified four times harder than the bank lines and pulled 0.4 m
        # inside the water's edge: it is a lid whose only job is to modulate the
        # colour under it, so an edge good to a couple of metres is good enough,
        # and it must never poke out over the chalk toe. 24 KB of duplicated
        # 343-vertex creek outline down to 7.
        _emit(feats, water.buffer(-0.4), {"k": "bank", "u": "channel", "m": "sheen",
                             "b": round(-depth, 2),
                             "h": round(-depth + CHANNEL["sheen_m"], 2)},
              stats, "creek_water_sheen", 1.0, simplify_m=2.0)

        # ---- the bank courses, outermost first ---------------------------
        # Outermost course tops out AT grade, innermost at the water line, so
        # the profile closes at both ends without a step that has to be tuned.
        acc_r = acc_d = 0.0
        for i in range(CHANNEL["courses"]):
            r_out = bank * (1.0 - acc_r)
            top = -depth * acc_d
            acc_r += run[i]
            acc_d += drop[i]
            r_in = bank * (1.0 - acc_r)
            outer = water.buffer(r_out, join_style=1, quad_segs=CHANNEL['quad_segs']) if r_out > 0.01 else water
            innerp = water.buffer(r_in, join_style=1, quad_segs=CHANNEL['quad_segs']) if r_in > 0.01 else water
            ring = outer.difference(innerp)
            if ring.is_empty:
                continue
            _emit(feats, ring,
                  {"k": "bank", "u": "channel", "m": mats[i],
                   "b": round(bed, 2), "h": round(top, 2)},
                  stats, "creek_bank_course", CHANNEL["min_m2"])

        # ---- the planting, three zones out from the top of bank ----------
        top_of_bank = water.buffer(bank, join_style=1, quad_segs=CHANNEL['quad_segs'])
        # `scrub` is its OWN surface now, not `grass`. It was sharing the lawn's
        # colour AND the lawn's texture tile, so the outermost, widest and
        # nearest-the-camera zone of the corridor was literally mown grass --
        # three "zones" of which one was indistinguishable from the field beside
        # it. That is most of what "still a green stripe" is describing.
        zones = [
            ("scrub", "scrub", "scrub",
             clamp(CHANNEL["scrub_per_width"] * w, CHANNEL["scrub_min_m"], CHANNEL["scrub_max_m"])),
            ("under", "wood", "understorey",
             clamp(CHANNEL["under_per_width"] * w, CHANNEL["under_min_m"], CHANNEL["under_max_m"])),
            ("canopy", "wood", "wood",
             clamp(CHANNEL["canopy_per_width"] * w, CHANNEL["canopy_min_m"], CHANNEL["canopy_max_m"])),
        ]
        prev = top_of_bank
        for label, use, surf, reach in zones:
            outer = top_of_bank.buffer(reach, join_style=1, quad_segs=CHANNEL['quad_segs'])
            ring = outer.difference(prev)
            prev = outer
            if ring.is_empty:
                continue
            _emit(feats, ring,
                  {"k": "area", "u": use, "s": surf, "src": "creek_" + label},
                  stats, "creek_zone_" + label, CHANNEL["min_m2"])
    return feats


def deck_creek_crossings(feats, road_feats, stats, warnings):
    """Every road and walk that crosses the creek gets a deck to cross it ON.

    Runs AFTER cut_creek_channels (it needs the trench) and BEFORE
    resolve_ground_conflicts (the ladder is what actually takes the ground back
    off the channel). It emits ONE unioned set of decks rather than one per way:
    two decks overlapping at the same height would be the very A2 tie this file
    exists to remove, and at a junction beside a creek several ways overlap.
    """
    if not DECK["enable"]:
        return feats
    try:
        from shapely.geometry import LineString
        from shapely.ops import unary_union
    except ImportError:
        warnings.append("shapely not installed: creek crossings NOT decked -- "
                        "the channel will cut straight through every street")
        return feats

    water = [q for q in (_poly_m(f["geometry"]) for f in feats
                         if f["properties"].get("s") == "creek"
                         and f["geometry"]["type"] == "Polygon")
             if q is not None and not q.is_empty]
    cut = [q for q in (_poly_m(f["geometry"]) for f in feats
                       if f["properties"].get("k") == "bank"
                       and f["properties"].get("u") == "channel"
                       and f["geometry"]["type"] == "Polygon")
           if q is not None and not q.is_empty]
    if not water or not cut:
        warnings.append("no creek water or no cut channel: crossings NOT decked")
        return feats
    water_u = unary_union(water)
    # The span to bridge is the TRENCH, not the water: a deck that only covered
    # the water would leave the two bank courses either side of it standing as a
    # pair of gorges with a road hanging between them.
    span = unary_union(cut).buffer(DECK["abutment_m"])

    carried, n_road, n_walk = [], 0, 0
    for f in road_feats:
        p = f["properties"]
        if p.get("k") != "road":
            continue
        gm = f["geometry"]
        lines = ([gm["coordinates"]] if gm["type"] == "LineString"
                 else gm["coordinates"] if gm["type"] == "MultiLineString" else [])
        for cs in lines:
            try:
                L = LineString(_line_m(cs))
            except Exception:
                continue
            if not L.intersects(water_u):
                continue
            # EXACTLY the band widen_roads will draw -- same half width, same
            # flat caps, same mitre. A deck sized off anything else is a deck
            # whose edge does not agree with the kerb standing on it.
            half = float(p.get("w") or 9.0) / 2.0
            carried.append(L.buffer(half, cap_style=2, join_style=2, mitre_limit=2.0))
            n_road += 1

    # The walks are carried too, and they are the half of the report that says
    # "sidewalks still go over them". A footbridge over Waller Creek is a real
    # thing on this campus; what was wrong was that the walk was drawn across
    # with NOTHING under it.
    for f in feats:
        p = f["properties"]
        if p.get("k") != "patharea" or f["geometry"]["type"] != "Polygon":
            continue
        q = _poly_m(f["geometry"])
        if q is None or q.is_empty or not q.intersects(water_u):
            continue
        carried.append(q)
        n_walk += 1

    if not carried:
        stats["creek_deck"] = 0
        return feats

    # parapet, then close the slots between a road and the walk beside it, then
    # keep only what is over the cut. Closing BEFORE the intersection matters:
    # do it after and the closing radius reaches across the abutment edge and
    # squares off the deck's ends against the bank.
    core = unary_union(carried).buffer(DECK["parapet_m"], join_style=2, mitre_limit=2.0)
    g = DECK["close_gap_m"]
    core = core.buffer(g, join_style=2, mitre_limit=2.0).buffer(-g, join_style=2, mitre_limit=2.0)
    decks = core.intersection(span)
    if decks.is_empty:
        stats["creek_deck"] = 0
        return feats

    top = -DECK["top_below_grade_m"]
    merged = decks
    parts = list(merged.geoms) if merged.geom_type == "MultiPolygon" else [merged]
    kept = 0
    for gm in parts:
        kept += _emit(feats, gm,
                      {"k": "bank", "u": "deck", "m": "deck",
                       "b": round(top - DECK["soffit_m"], 2), "h": round(top, 2)},
                      stats, "creek_deck", DECK["min_m2"],
                      simplify_m=DECK["simplify_m"])
    stats["creek_deck_road_ways"] = n_road
    stats["creek_deck_walk_ways"] = n_walk
    print("  creek crossings: %d road ways + %d walk ways -> %d decks"
          % (n_road, n_walk, kept))
    return feats


# -------------------------------------------------------------- gardens --
#
# "turtle pond too many turtiles, fix this lawn in general its really bland"
#
# The Memorial Garden is a 2,190 m2 polygon OSM tags `leisure=garden` and names,
# and everything downstream treated it as a lawn: AREA_USE maps it to
# `u:'garden'`, DEFAULT_SURFACE gives `u:'garden'` the colour `grass`, and that
# is the entire difference between a garden and a lawn in this file. So it
# renders as a flat green rectangle with a 218 m2 blue disc in it, which is
# exactly what he is looking at.
#
# NOTHING HERE IS DRAWN FREEHAND, and that matters because the truth rule at the
# top of this file says every position comes from OSM. A garden's structure IS
# its circulation -- the beds are what is left between the walks -- and this
# campus's walks are all mapped. So:
#
#   * a BED is the band of ground a fixed distance back from a real walk, set
#     inside a real garden polygon, minus a mown verge. The bed follows the path
#     network because in life it does;
#   * a SPECIMEN bed sits at the pole of inaccessibility of each remaining lawn
#     panel -- the centre of the largest circle that fits in it. That is a
#     derived point, not a chosen one, and it is exactly where a garden puts the
#     one tree it wants you to look at;
#   * the POND COPING is a ring buffered off the real pond, and it is applied
#     only to a pond that sits in a built setting (a garden or a plaza), because
#     a stone rim on a farm pond would be a lie. Turtle Pond has one in life --
#     the low limestone edge people sit on to watch the turtles.
#
# The coping goes UP, unlike the creek. A raised rim is what is actually there,
# and it costs none of the machinery the sunken channel needed.
GARDEN = {
    "bed_w": 3.0,          # depth of a planting border, out from the verge
    "verge_w": 1.0,        # mown strip between the walk and the bed
    "bed_min_m2": 5.0,
    # A panel has to be big enough to earn a specimen, and the specimen is a
    # fraction of the panel's own inscribed circle so a narrow strip never gets
    # a bed wider than itself.
    "specimen_min_panel_m2": 90.0,
    "specimen_frac": 0.42,
    "specimen_min_r": 1.6,
    "specimen_max_r": 5.5,
    "pond_coping_w": 1.2,      # width of the built rim
    "pond_coping_h": 0.38,     # how far it stands proud -- a sitting height kerb
    "pond_coping_touch_m": 6.0,  # how close a pond must be to a garden or plaza
                                 # to count as being IN one
    # Garden features are 2-12 m across, an order of magnitude smaller than a
    # creek reach, so they carry their own simplify tolerance. At the creek's
    # 0.5 m a specimen bed came out an octagon.
    "simplify_m": 0.12,
}


def plant_gardens(feats, stats, warnings):
    """Give every OSM `leisure=garden` the structure a garden actually has."""
    try:
        from shapely.ops import unary_union, polylabel
    except ImportError:
        warnings.append("shapely not installed: gardens left as flat lawn")
        return feats

    gardens, walks, ponds, built = [], [], [], []
    for f in feats:
        p = f["properties"]
        if f["geometry"]["type"] != "Polygon":
            continue
        q = _poly_m(f["geometry"])
        if q is None or q.is_empty:
            continue
        if p.get("k") == "area" and p.get("u") == "garden":
            gardens.append((f, q))
            built.append(q)
        elif p.get("k") == "patharea":
            walks.append(q)
        elif p.get("k") == "area" and p.get("s") == "pond":
            ponds.append((f, q))
        elif p.get("k") == "area" and p.get("u") == "plaza":
            built.append(q)
    if not gardens:
        warnings.append("no u:'garden' areas found -- gardens NOT planted")
        return feats

    walk_u = unary_union(walks) if walks else None
    pond_u = unary_union([q for _, q in ponds]) if ponds else None

    for gf, g in gardens:
        name = gf["properties"].get("name") or "unnamed"
        # ---- the planting borders ------------------------------------
        inner = g
        if pond_u is not None:
            inner = inner.difference(pond_u)
        beds = None
        if walk_u is not None:
            near = walk_u.buffer(GARDEN["verge_w"] + GARDEN["bed_w"], join_style=2)
            verge = walk_u.buffer(GARDEN["verge_w"], join_style=2)
            beds = inner.intersection(near).difference(verge)
        if beds is not None and not beds.is_empty:
            n = _emit(feats, beds,
                      {"k": "area", "u": "bed", "s": "bed", "src": "garden_bed"},
                      stats, "garden_bed", GARDEN["bed_min_m2"],
                      simplify_m=GARDEN["simplify_m"])
            if n:
                inner = inner.difference(beds)

        # ---- a specimen at the centre of each remaining panel --------
        panels = list(inner.geoms) if inner.geom_type == "MultiPolygon" else [inner]
        for panel in panels:
            if panel.is_empty or panel.area < GARDEN["specimen_min_panel_m2"]:
                continue
            try:
                pt = polylabel(panel, tolerance=0.4)
            except Exception:
                continue
            r_in = panel.exterior.distance(pt)
            r = max(GARDEN["specimen_min_r"],
                    min(GARDEN["specimen_max_r"], r_in * GARDEN["specimen_frac"]))
            _emit(feats, pt.buffer(r, quad_segs=6),
                  {"k": "area", "u": "bed", "s": "bed", "src": "garden_specimen"},
                  stats, "garden_specimen", GARDEN["bed_min_m2"],
                  simplify_m=GARDEN["simplify_m"])
        stats["garden_planted_" + name.replace(" ", "_")] += 1

    # ---- the built pond edge -----------------------------------------
    built_u = unary_union(built) if built else None
    for pf, q in ponds:
        if built_u is None or q.distance(built_u) > GARDEN["pond_coping_touch_m"]:
            stats["pond_no_coping"] += 1
            continue
        ring = q.buffer(GARDEN["pond_coping_w"], join_style=1, quad_segs=4).difference(q)
        if ring.is_empty:
            continue
        _emit(feats, ring,
              {"k": "bank", "u": "coping", "m": "coping",
               "b": 0.0, "h": GARDEN["pond_coping_h"]},
              stats, "pond_coping", 1.0, simplify_m=GARDEN["simplify_m"])
    return feats


# -------------------------------------------------- the boulevard medallions --
#
# "the grass median on the road south of the fountain has cool designs add them
# (the circles have stars on them)"
#
# THE ROAD SOUTH OF THE FOUNTAIN IS UNIVERSITY AVENUE, NOT 21st. Worth writing
# down because the brief that reached this lane said 21st and it is wrong, and
# rebuilding the wrong median would have been silent. Littlefield Fountain sits
# at -97.73961, 30.28390. 21st runs east-west PAST the fountain; the road that
# runs SOUTH out of it is University Avenue, and OSM has it as two `oneway=yes`
# carriageways 12 m apart (ways 25908905 / 124953129 / 124953703 / 842374750 /
# 842374751) with eight `landuse=grass` panels strung between them, 80 to 500 m2
# each, from 30.2816 up to 30.2839. Those eight panels ARE the median, they are
# already in this file, and they are eight blank green rectangles.
#
# WHAT IS GENERATIVE HERE, stated plainly because the truth rule at the top of
# this file demands it: the medallions' POSITIONS are derived from OSM (the
# median panel's own minimum rotated rectangle, spaced along its long axis) but
# they are not surveyed — OSM does not map paving inlay. Their FORM is ours.
# This is the second generative-position source in the ground bake after the
# precinct lawns, and like those it is derived from mapped geometry rather than
# drawn freehand: move the median in OSM and the medallions move with it.
#
# The corridor is found from the road NAME, not from a bounding box, so a
# re-bake that shifts the median by a metre still finds it.
MEDALLION = {
    # Which boulevards get laid out. A name, because the median panels are
    # unnamed and a bbox would be a guess that silently rots.
    "roads": ("University Avenue",),
    # How far a carriageway may be and still count as flanking a panel. The two
    # University Avenue centrelines are 12 m apart, so each is ~6 m off the
    # median's spine; 16 m leaves room for a wide panel without reaching the
    # next street over.
    "between_max_m": 16.0,
    # Centre-to-centre along the panel's long axis. 22 m gives the two 34 m and
    # 50 m panels two medallions each and the short ones one apiece.
    "spacing_m": 22.0,
    # Disc radius as a fraction of the panel's HALF-WIDTH, so a narrow strip
    # never gets a medallion wider than the grass it sits in.
    "disc_frac": 0.62,
    "disc_min_r": 1.5,          # under this it is a smudge; skip the panel
    "disc_max_r": 4.0,
    "edge_clear_m": 0.6,        # a disc must sit this far inside the grass
    # The star inside the disc. `waist` is the inner/outer radius ratio of a
    # regular five-pointed star (1/phi^2 = 0.382); anything larger reads as a
    # pentagon and anything smaller as a splat.
    "star_frac": 0.72,
    "star_waist": 0.382,
    # TASTE, both of them, and one edit each. The disc is pale stone against
    # grass; the star is the inlay. `brick` reads as inlaid stone and lands 121
    # luma below the disc, which is unmissable from the air. Swap the star to
    # `endzone` for burnt orange if he wants it louder.
    "disc_surface": "limestone",
    "star_surface": "brick",
    # A 3 m disc simplified at the creek's 0.5 m comes out a triangle. Same
    # lesson as GARDEN["simplify_m"].
    "simplify_m": 0.08,
}


def _star_ring(cx, cy, r, waist, points=5):
    """A regular star centred on (cx, cy) in metres, one point due NORTH."""
    ring = []
    for i in range(points * 2):
        rad = r if i % 2 == 0 else r * waist
        # +90 deg puts vertex 0 on +y, which is north in the metric frame.
        a = math.radians(90.0 + i * (180.0 / points))
        ring.append((cx + rad * math.cos(a), cy + rad * math.sin(a)))
    return ring


def lay_median_medallions(feats, stats, warnings):
    """Star medallions down the grass median of the named boulevards."""
    try:
        from shapely.geometry import LineString, Polygon
        from shapely.ops import unary_union
    except ImportError:
        warnings.append("shapely not installed: median medallions NOT laid")
        return feats

    lines = []
    for el in load("roads"):
        t = el.get("tags", {}) or {}
        if (t.get("name") or "") not in MEDALLION["roads"]:
            continue
        g = el.get("geometry") or []
        if len(g) < 2:
            continue
        lines.append(LineString([(p["lon"] * _KX, p["lat"] * M_LAT) for p in g]))
    if not lines:
        warnings.append("MEDALLION: no roads named %s in the cache -- NO medians laid"
                        % (MEDALLION["roads"],))
        return feats

    # A PANEL IS A MEDIAN IF IT HAS A CARRIAGEWAY ON BOTH SIDES OF IT, and this
    # is the whole selection rule. The first cut took the convex hull of every
    # way of that name instead, and it was wrong in a way worth recording: OSM
    # carries University Avenue in TWO separate dual-carriageway stretches, one
    # south of the fountain (30.2811-30.2836) and one north of Dean Keeton
    # (30.2875-30.2953), so their joint hull spanned the mile between them and
    # laid medallions down the middle of the SOUTH MALL and the MAIN MALL. A
    # hull over a disconnected corridor is not the corridor.
    #
    # The test is orientation-free: take the nearest point on each of the two
    # closest centrelines, and require them to lie on OPPOSITE sides of the
    # panel's centroid (their offsets have a negative dot product). Two
    # carriageways flanking a median pass; a single street running past a lawn
    # fails, and so do two colinear halves of one street, because both of their
    # nearest points are in the same direction.
    panels = []
    for f in feats:
        p = f["properties"]
        if p.get("k") != "area" or p.get("u") not in ("lawn", "park"):
            continue
        if f["geometry"]["type"] != "Polygon":
            continue
        q = _poly_m(f["geometry"])
        if q is None or q.is_empty:
            continue
        c = q.centroid
        near = sorted(((ln.distance(c), i) for i, ln in enumerate(lines)))[:2]
        if len(near) < 2 or near[1][0] > MEDALLION["between_max_m"]:
            continue
        va, vb = (lines[i].interpolate(lines[i].project(c)) for _, i in near)
        if ((va.x - c.x) * (vb.x - c.x) + (va.y - c.y) * (vb.y - c.y)) >= 0:
            continue
        panels.append(q)
    if not panels:
        warnings.append("MEDALLION: roads found but no lawn panel sits between "
                        "two of their carriageways -- NO medallions laid")
        return feats
    stats["median_panels"] = len(panels)

    for q in panels:
        rect = q.minimum_rotated_rectangle
        rc = list(rect.exterior.coords)[:4]
        e0 = math.hypot(rc[1][0] - rc[0][0], rc[1][1] - rc[0][1])
        e1 = math.hypot(rc[2][0] - rc[1][0], rc[2][1] - rc[1][1])
        if e0 >= e1:
            L, W = e0, e1
            ux, uy = (rc[1][0] - rc[0][0]) / e0, (rc[1][1] - rc[0][1]) / e0
        else:
            L, W = e1, e0
            ux, uy = (rc[2][0] - rc[1][0]) / e1, (rc[2][1] - rc[1][1]) / e1
        r = min(MEDALLION["disc_max_r"], (W / 2.0) * MEDALLION["disc_frac"])
        if r < MEDALLION["disc_min_r"]:
            stats["medallion_panel_too_narrow"] += 1
            continue
        n = max(1, int(round(L / MEDALLION["spacing_m"])))
        cx0, cy0 = rect.centroid.x, rect.centroid.y
        room = q.buffer(-(r + MEDALLION["edge_clear_m"]))
        for i in range(n):
            t = ((i + 0.5) / n - 0.5) * L
            cx, cy = cx0 + ux * t, cy0 + uy * t
            from shapely.geometry import Point
            if room.is_empty or not room.contains(Point(cx, cy)):
                stats["medallion_no_room"] += 1
                continue
            disc = Point(cx, cy).buffer(r, quad_segs=16)
            star = Polygon(_star_ring(cx, cy, r * MEDALLION["star_frac"],
                                      MEDALLION["star_waist"]))
            _emit(feats, disc,
                  {"k": "area", "u": "medallion", "s": MEDALLION["disc_surface"],
                   "src": "median"},
                  stats, "median_medallion", 1.0,
                  simplify_m=MEDALLION["simplify_m"])
            _emit(feats, star,
                  {"k": "area", "u": "star", "s": MEDALLION["star_surface"],
                   "src": "median"},
                  stats, "median_star", 0.3,
                  simplify_m=0.0)      # a star is all corners; do not simplify
    return feats


def tone_lawns(feats, stats):
    """Repaint every green class named in LAWN_TONE. See the table for why.

    Runs LAST, after every pass that keys off `s`: classify_water reads it, the
    creek corridor reads it, and plant_gardens reads `u:'garden'`. Doing this
    early would have the medallion pass hunting for `s:'grass'` panels that no
    longer say grass.
    """
    for f in feats:
        p = f["properties"]
        if p.get("k") != "area":
            continue
        want = LAWN_TONE.get(p.get("u"))
        # Only ever repaints a polygon that is currently plain `grass`. A pitch
        # that came in tagged `artificial_turf`, or a lawn the creek pass has
        # already moved to `scrub`, keeps what it was given.
        if not want or p.get("s") != "grass" or want == "grass":
            continue
        p["s"] = want
        stats["toned_" + p["u"] + "_to_" + want] += 1
    return feats


# ------------------------------------------------------- flagpole plinths --
#
# "the area in front of UT tower looks bland - see whats here and add it."
#
# WHAT IS ACTUALLY THERE, checked before drawing: the two flagpoles. OSM has
# them as nodes 3600938144 (United States, -97.73985, 30.28539) and 3600938143
# (Texas, -97.73908, 30.28532), one standing in each of the Main Mall's two
# grass panels, and they are the tallest things on the mall after the Tower.
# Twelve `man_made=flagpole` nodes exist in the cache; this plinths every one
# that stands in a mapped soft surface, which is a rule rather than a hand-pick.
#
# THE POLE ITSELF IS NOT THIS LANE'S — it belongs in data/props.geojson. What
# ground can carry is the stone base every one of them stands on, which is real,
# is ground, and is what makes a blank lawn panel read as designed. Written down
# here so whoever owns props knows the plinths are waiting for their poles.
PLINTH = {
    "r_m": 2.2,                 # radius of the stone base
    "surface": "limestone",
    # A pole standing on a PEDESTRIAN MALL gets no plinth, and that is
    # deliberate rather than an oversight. Since PEDESTRIAN_AREA_IS_A_WALK the
    # malls arrive in the `patharea` band, so they no longer match `plaza`
    # here -- two poles moved from "plinth laid" to "not in a surface". Nothing
    # visible changed: a plinth is ('area','plinth') at rank 13 and a plaza was
    # rank 30, so the surface underneath ATE the plinth in the resolver anyway
    # (the bake reported one of them as `resolve_covered_plinth` every run).
    # Emitting a polygon that is then deleted is not better than not emitting
    # it; if a mall pole should ever have a visible base it needs its own entry
    # in the path band of RANK, not a line here.
    "hosts": ("lawn", "park", "garden", "plaza"),
    "simplify_m": 0.08,
}


def lay_flagpole_plinths(feats, stats, warnings):
    """A stone base under every flagpole that stands in a mapped surface."""
    try:
        from shapely.geometry import Point
    except ImportError:
        warnings.append("shapely not installed: flagpole plinths NOT laid")
        return feats

    poles = [(el["lon"], el["lat"]) for el in load("furn_vertical")
             if (el.get("tags", {}) or {}).get("man_made") == "flagpole"
             and el.get("lon") is not None]
    if not poles:
        warnings.append("PLINTH: no man_made=flagpole nodes in the cache")
        return feats
    stats["flagpoles_in_cache"] = len(poles)

    hosts = []
    for f in feats:
        p = f["properties"]
        if p.get("k") != "area" or p.get("u") not in PLINTH["hosts"]:
            continue
        if f["geometry"]["type"] != "Polygon":
            continue
        q = _poly_m(f["geometry"])
        if q is not None and not q.is_empty:
            hosts.append(q)

    for lon, lat in poles:
        pt = Point(lon * _KX, lat * M_LAT)
        if not any(h.contains(pt) for h in hosts):
            stats["flagpole_not_in_a_surface"] += 1
            continue
        _emit(feats, pt.buffer(PLINTH["r_m"], quad_segs=12),
              {"k": "area", "u": "plinth", "s": PLINTH["surface"],
               "src": "flagpole"},
              stats, "flagpole_plinth", 1.0, simplify_m=PLINTH["simplify_m"])
    return feats


# ---------------------------------------------------------- precinct lawns --
#
# "austin building by ellsworth has chromatic circle of glass can you add that
# with the colors. also that whole area is supposed to be green can you make it
# look nicer (not just add green lol)"
#
# The colour went on in PR #58. The green is this. Photographed, Ellsworth
# Kelly's chapel sits on a 38 x 54 m lawn in the middle of an enormous expanse
# of bare tan base ground -- OSM maps the lawn immediately under the building
# and nothing at all for the block around it, so the base colour shows through
# and reads as dirt.
#
# NOT ONE BIG GREEN POLYGON, which is what he asked it not to be. The lawn is
# grown outward from the lawn that IS mapped until it meets the things that
# really bound it: the walks, and the buildings. Both are already in the data,
# so the resulting panel is derived from the site rather than drawn freehand --
# the space between a chapel and the paths around it is lawn, and that is a
# fact about the place, not a guess.
#
# Keyed by a point rather than a name because the lawn polygons here are
# unnamed; the entry says which precinct it is and where to start.
#
# ---------------------------------------------------------------------------
# AND THE SENTENCE ABOVE WAS HALF FALSE UNTIL THIS PASS. "the walks, and the
# buildings. Both are already in the data" -- the walks were; the buildings
# were not. `feats` at this point in the bake contains ground only, so the
# blocker list could never have held a footprint, and the grown lawn ran
# straight under the buildings it was supposed to stop at. Measured on the one
# precinct that existed: 745 m2 of 6,025 m2, 12.4% of it, was under a building.
# Invisible (the extrusion covers it) and wrong, and on a file that is not
# tiled it is 12% of the bytes spent on ground nobody can see.
#
# The footprints come from the SAME file shape_trees.py uses for the same
# question, `data/snapshots/<latest>/buildings.detailed.geojson`, rather than
# from a second query -- two copies of "where are the buildings" drift.
#
# ---------------------------------------------------------------------------
# WHERE THE PRECINCTS COME FROM, since a table of nine points is exactly the
# kind of thing that gets guessed. The campus core was rasterised at 6 m and
# every cell not covered by a ground polygon, a buffered carriageway or a
# building footprint counted as base ground showing through:
#
#     51.8% of the UT campus core is bare, 821,016 m2
#     biggest connected bare blobs: 22,932 / 15,048 / 14,220 / 12,564 /
#                                   12,276 / 10,944 / 10,188 / 9,936 m2
#
# Each entry below is the mapped lawn NEAREST one of those blobs, with `grow`
# set to reach across it. The blob is the evidence that the block is bare; the
# seed lawn is the evidence that the block is landscaped. Neither on its own
# would justify painting a block green.
#
# WEST CAMPUS IS NOT IN THIS TABLE AND CANNOT BE. The mechanism needs a mapped
# lawn to grow from and West Campus has none -- the nearest mapped green to
# -97.7470, 30.2890 is 409 m away and is a 1 m2 sliver. Growing a lawn there
# would be drawing one freehand, which is the thing this whole pass is written
# not to do. It needs its own source, not a bigger `grow`.
PRECINCTS = [
    # (label, lon, lat, how far to grow in metres)
    ("Ellsworth Kelly / Austin",   -97.737838, 30.281665, 26.0),
    # The Blanton block. 9,756 m2 bare between the museum, the art building and
    # Speedway; the mapped green is the strip on the museum's south side.
    ("Blanton block",              -97.738244, 30.280400, 34.0),
    # The East Mall. 10,944 + 10,188 + 9,936 m2 of bare ground in three blobs
    # either side of the axis; one 131 m2 lawn is mapped near San Jacinto.
    ("East Mall",                  -97.735013, 30.285364, 44.0),
    # The Drama / art precinct behind Winship. 12,564 m2 bare, and there is a
    # 1,681 m2 lawn 87 m away -- the biggest seed on this side of campus.
    ("Drama and art precinct",     -97.732150, 30.286172, 36.0),
    # The power-plant yard. 12,276 m2, seed 603 m2.
    ("Power plant yard",           -97.730377, 30.286638, 38.0),
    # Speedway north of Dean Keeton, 1,001 m2 seed.
    #
    # THIS ENTRY REPLACED A "Dean Keeton north" ONE AND THE REASON IS WORTH
    # KEEPING. The first table was written from polygon CENTROIDS, and the
    # centroid of a concave lawn -- an L round a building, a ring round a
    # court -- is not in the lawn. That entry's point measured 106 m from its
    # own seed at bake time and was dropped with a warning. Every point here is
    # a shapely `representative_point()`, which is guaranteed inside.
    ("Speedway north",             -97.737383, 30.290330, 36.0),
    # Whitis. 5,796 m2 bare and the seed lawn TOUCHES it (0 m).
    ("Whitis",                     -97.739739, 30.288738, 32.0),
    # LBJ and east campus. 14,220 m2, seed is the 2,760 m2 park by the library.
    ("LBJ east campus",            -97.731331, 30.281432, 40.0),
    # San Jacinto south, between the Erwin Center site and the mall.
    ("San Jacinto south",          -97.735545, 30.281172, 34.0),
]
PRECINCT_KEEP_M2 = 60.0     # drop slivers the subtraction leaves behind
PRECINCT_SEED_MAX_M = 40.0  # a point further than this from a lawn is a typo
# A grown panel much bigger than this is not a courtyard any more, it is a
# freehand green field -- reported loudly rather than silently shipped.
PRECINCT_WARN_M2 = 26000.0
# Snapshot to read footprints from. `None` = the newest on disk, which is what
# shape_trees.py does; pin it if a bake has to be reproducible against an old
# snapshot.
PRECINCT_SNAPSHOT = None
# How far short of a wall a lawn stops. Every building on this campus has a mow
# strip, a drip line or a paved apron; a lawn butted against the wall face reads
# as the building growing out of the grass.
BUILDING_STANDOFF_M = 0.3


def _building_blockers(to_m, warnings):
    """Footprints, from the snapshot shape_trees.py uses for the same question."""
    from shapely.geometry import Polygon
    root = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "data", "snapshots")
    try:
        snap = PRECINCT_SNAPSHOT or sorted(
            d for d in os.listdir(root) if os.path.isdir(os.path.join(root, d)))[-1]
        gj = json.load(open(os.path.join(root, snap, "buildings.detailed.geojson"),
                            encoding="utf-8"))
    except Exception as e:
        # LOUD. Without this the lawn runs under every building on the block and
        # nothing on screen says so, which is exactly how it shipped before.
        warnings.append("precinct lawns: NO BUILDING FOOTPRINTS (%s) -- "
                        "lawns will run under buildings" % e)
        return [], "none"
    out = []
    for f in gj["features"]:
        g = f["geometry"]
        rings = ([g["coordinates"]] if g["type"] == "Polygon"
                 else g["coordinates"] if g["type"] == "MultiPolygon" else [])
        for rr in rings:
            try:
                q = Polygon(to_m(rr[0]))
                if not q.is_valid:
                    q = q.buffer(0)
                if q.is_valid and not q.is_empty:
                    out.append(q)
            except Exception:
                pass
    return out, snap


def grow_precinct_lawns(feats, stats, warnings):
    try:
        from shapely.geometry import Polygon, Point
        from shapely.ops import unary_union
    except ImportError:
        warnings.append("shapely not installed: precinct lawns not grown")
        return feats

    lat0 = 30.283
    kx = math.cos(math.radians(lat0)) * M_LAT
    to_m = lambda r: [(x * kx, y * M_LAT) for x, y in r]
    to_ll = lambda r: [[round(x / kx, 7), round(y / M_LAT, 7)] for x, y in r]

    from shapely.geometry import LineString

    # What a lawn may NOT grow over: every walk, every plaza, every other
    # surface, and every building footprint.
    #
    # BUILT ONCE, not once per precinct. The single-entry version appended the
    # path blockers INSIDE the precinct loop and re-unioned the whole list every
    # time round, which is invisible at one precinct and quadratic at nine.
    blockers = []
    for f in feats:
        p = f["properties"]
        if f["geometry"]["type"] != "Polygon":
            continue
        if p.get("k") == "path" or (p.get("k") == "area" and p.get("u") != "lawn"):
            try:
                q = Polygon(to_m(f["geometry"]["coordinates"][0]))
                blockers.append(q if q.is_valid else q.buffer(0))
            except Exception:
                pass
    # PATHS ARE NOT BLOCKERS YET at this point in the bake -- they are still
    # LineStrings and become polygons in widen_paths, which runs after this.
    # So buffer the path lines by their own width here rather than skipping
    # them, or the lawn would swallow every walk on the block.
    for f in feats:
        p = f["properties"]
        if p.get("k") != "path" or f["geometry"]["type"] != "LineString":
            continue
        w = float(p.get("w") or 2.0)
        try:
            blockers.append(LineString(to_m(f["geometry"]["coordinates"]))
                            .buffer(w / 2 + 0.6, cap_style=2, join_style=2))
        except Exception:
            pass
    builds, snap = _building_blockers(to_m, warnings)
    stats["precinct_building_blockers"] = len(builds)

    cutter = unary_union(blockers) if blockers else None
    # THE BUILDINGS ARE SUBTRACTED SEPARATELY, and that is not tidiness.
    # Unioned into the same ~12,000-polygon cutter they under-removed: the
    # emitted lawn still had 1,354 m2 inside a footprint, and 55% of it was
    # more than 2 m from the nearest wall -- too deep to be edge residue, so
    # the big union was losing them, not nicking them. Two smaller differences,
    # the second applied to an already-clipped polygon, drive it to zero.
    #
    # WITH A 0.3 m OUTWARD BUFFER, because a lawn does not run to the wall
    # face; there is a mow strip or a drip line at every building on campus.
    bldu = unary_union(builds).buffer(BUILDING_STANDOFF_M) if builds else None

    # Seed candidates, built ONCE. A park is as good a seed as a lawn -- both
    # are mown grass in this palette -- but a garden is not: it has its own
    # surface and its own structure (see plant_gardens) and growing it would
    # spread planting beds across a block.
    seeds = []
    for f in feats:
        p = f["properties"]
        if p.get("k") != "area" or p.get("u") not in ("lawn", "park"):
            continue
        if f["geometry"]["type"] != "Polygon":
            continue
        try:
            q = Polygon(to_m(f["geometry"]["coordinates"][0]))
            if not q.is_valid:
                q = q.buffer(0)
            if q.is_valid and not q.is_empty:
                seeds.append(q)
        except Exception:
            pass

    total_made, total_m2 = 0, 0.0
    for label, lon, lat, grow in PRECINCTS:
        seed_pt = Point(lon * kx, lat * M_LAT)
        best, bestd = None, 1e18
        for q in seeds:
            d = q.distance(seed_pt)
            if d < bestd:
                best, bestd = q, d
        if best is None or bestd > PRECINCT_SEED_MAX_M:
            stats["precinct_no_seed_lawn"] += 1
            warnings.append("precinct %r: no seed lawn within %.0f m (nearest %.0f m)"
                            % (label, PRECINCT_SEED_MAX_M, bestd))
            continue
        grown = best.buffer(grow, join_style=1)
        cut = grown.difference(cutter) if cutter is not None else grown
        if bldu is not None:
            cut = cut.difference(bldu)
        parts = cut.geoms if cut.geom_type == "MultiPolygon" else [cut]
        made, m2 = 0, 0.0
        for gm in parts:
            if gm.is_empty or gm.area < PRECINCT_KEEP_M2:
                continue
            rings = [to_ll(list(gm.exterior.coords))]
            rings += [to_ll(list(r.coords)) for r in gm.interiors]
            feats.append({
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": rings},
                "properties": {"k": "area", "u": "lawn", "s": "grass",
                               "src": "precinct"},
            })
            made += 1
            m2 += gm.area
        # MEASURED, not intended. §36's lesson: a counter incremented at emit
        # time reported seven sheens shipped on a run where all seven had been
        # deleted. This is the area of the polygons actually appended.
        print("  precinct %-24s seed %6.0f m2 at %3.0f m -> %2d parts, %7.0f m2"
              % (label, best.area, bestd, made, m2))
        if m2 > PRECINCT_WARN_M2:
            warnings.append("precinct %r grew %.0f m2, over the %.0f m2 sanity "
                            "limit -- that is a green field, not a courtyard"
                            % (label, m2, PRECINCT_WARN_M2))
        total_made += made
        total_m2 += m2
        stats["precinct_lawn_" + label.split("/")[0].strip().replace(" ", "_")] += made
    # RE-MEASURE THE RESULT, which is the check the docstring's old claim needed
    # and did not have: how much of what was just emitted is under a building?
    # It was 12.4% before the footprints went in and it has to be ~0 now.
    # WITH THE INTERIOR RINGS, and that is the whole point of the check.
    # The first version of this re-measure read `coordinates[0]` only -- the
    # exterior -- so every building-shaped HOLE the subtraction had just cut was
    # counted back in as lawn, and it reported 2.0% under a building on a file
    # that measures 0.0%. The instrument had the same bug as the thing it was
    # instrumenting, which is the §35 lesson about a script that cannot see the
    # defect it was written for.
    if builds:
        made_u = unary_union([Polygon(to_m(f["geometry"]["coordinates"][0]),
                                      [to_m(h) for h in f["geometry"]["coordinates"][1:]])
                              for f in feats
                              if f["properties"].get("src") == "precinct"
                              and f["geometry"]["type"] == "Polygon"])
        under = made_u.intersection(unary_union(builds)).area if not made_u.is_empty else 0.0
        print("  precinct lawns: %d parts, %.0f m2 total, %.0f m2 under a building "
              "(%.1f%%)  [footprints from snapshot %s]"
              % (total_made, total_m2, under, 100.0 * under / max(1.0, total_m2), snap))
        stats["precinct_m2_under_building"] = int(under)
    return feats


# ------------------------------------------------------------ path widening --
#
# WHY PATHS ARE POLYGONS AND NOT LINES.
#
# "i look closer to horizontal (low) and speedway gets super wide and right
# after monochrome is a seperate layer thats a bit narrower that also grows
# wider as i approach 90 degrees."
#
# A MapLibre `line-width` is a number of SCREEN PIXELS, and it is the same
# number for the whole line. The ground is not: under perspective, 9.1 m of
# Speedway near the camera is a lot of pixels and 9.1 m of it up by Dean Keeton
# is a few. So one constant pixel width cannot be right everywhere, and the
# error is not small. Measured with scripts/verify/road-fan.mjs, camera on the
# south end of the promenade looking north:
#
#     pitch 20   1.10x at the only point still on screen
#     pitch 60   1.26x near  ->  3.33x at the far end
#     pitch 86   1.30x near  ->  3.69x at the far end
#
# 3.69x on a 9.1 m mall is a 34 m motorway, which is exactly what he saw. And it
# gets worse as the camera lies down not because the ratio changes much past 60
# -- it barely does -- but because pitching over drags the far, wrong end of the
# road INTO the frame. At pitch 20 everything past 30.2845 is off screen.
#
# The old expression was not sloppy; it is exactly right at the map centre,
# which is where it was derived. There is no per-vertex line width in MapLibre,
# so no expression can fix this. The width has to live in the geometry.
#
# So: buffer each centreline by half its real width and emit a polygon. A fill
# is ground geometry and gets the true perspective for free, at every pitch,
# everywhere in the frame.
#
# UNIONED PER (use, surface) GROUP, which is not an optimisation. Fills draw at
# `pathOpacity` 0.92, and two overlapping translucent polygons in one layer
# composite twice -- every junction where two footways meet would show as a
# darker patch. Union dissolves the overlap. It also drops the interior
# boundaries, so 2,512 lines become ~1,000 polygons.
#
# The kerb is NOT a second buffered ring. It is a bevel, and a bevel is a
# screen-space effect: ground.js strokes the polygon boundary at a constant few
# pixels, which is what a highlight along an edge should do at any pitch, and it
# saves the 0.55 MB a second polygon set would have cost.
LAT0 = 30.285                       # metric anchor for the buffer, mid-campus
PATH_SIMPLIFY_M = 0.15              # post-union tolerance; well under a pixel
PATH_MIN_AREA_M2 = 1.0              # drop slivers the union leaves behind

# ---------------------------------------------------------------- stairs --
#
# WHY A DRAWN STAIRCASE NEEDS TO SAY WHICH OSM WAY IT IS.
#
# The walking router (data/walk_graph.json, js/wayfind.js) prices 189
# `highway=steps` ways and tells a student "3 sets of stairs on this route".
# This file draws them. Until now the only way to ask "is the staircase the
# router just charged me for the same one the city drew?" was to compare
# centroids and hope -- and comparing by eye is exactly how this project has
# been wrong before. So every stepped slab now carries the OSM way ids that
# made it, and the two files join on identity.
#
# THEY ALSO EXPLAIN THE 179 vs 189, WHICH IS NOT A DISAGREEMENT. widen_paths
# unions the buffered centrelines per (use, surface), so flights that touch
# merge into one drawn polygon: 188 ways come out as 179 slabs and `wid` says
# which went where. (The 189th, way 147362093, is tagged `area=yes` and was
# being dropped on the floor by the line branch -- one real staircase the
# router would send you up and the city drew nowhere. It is drawn now.)
#
# WHAT ELSE RIDES ALONG, and only where OSM actually says it: a step count
# (9 ways of 189 have one), a handrail (68), a ramp beside the steps (12) and
# an incline direction (80, and only where ONE way made the slab, because
# "up" on a merged blob of three flights is not a direction).
STAIR_ID_USES = ("steps",)          # which `u` values get `wid` attribution
STAIR_ATTRIB_MIN_M2 = 0.05          # source must really be in the merged part


def stair_tags(t):
    """The step facts OSM actually carries, or {} -- never a guess.

    Kept as a plain dict on the source feature under `_st`, merged by
    `_stair_props` once the union knows which sources made which slab.
    """
    out = {}
    sc = t.get("step_count")
    if sc and str(sc).strip().lstrip("-").isdigit():
        out["sc"] = int(str(sc).strip())
    inc = t.get("incline")
    if inc in ("up", "down"):
        out["inc"] = inc
    hr = t.get("handrail") or t.get("handrail:both") or t.get("handrail:left") \
        or t.get("handrail:right")
    if hr:
        out["hr"] = 0 if hr == "no" else 1
    if t.get("ramp") not in (None, "no") or t.get("ramp:wheelchair") == "yes" \
            or t.get("ramp:stroller") == "yes" or t.get("ramp:bicycle") == "yes":
        out["rmp"] = 1
    if t.get("lit") not in (None, "no"):
        out["lit"] = 1
    if t.get("conveying") not in (None, "no"):
        out["cv"] = 1                      # an escalator, and it is not stairs
    return out


def _stair_props(part, sources, tree, stats):
    """Which OSM ways made this merged slab, and what they agree on.

    `sources` is [(polygon, way_id, tags_dict)]; `tree` an STRtree over their
    polygons in the same index order. A source counts only if it really
    overlaps -- a shared boundary is not a contribution.
    """
    idxs = tree.query(part)
    hits = []
    for i in idxs:
        poly, wid, st = sources[int(i)]
        try:
            if part.intersection(poly).area >= STAIR_ATTRIB_MIN_M2:
                hits.append((wid, st))
        except Exception:
            continue
    if not hits:
        stats["stair_slab_unattributed"] += 1
        return {}
    wids = sorted(w for w, _ in hits)
    props = {"wid": wids}
    tags = [st for _, st in hits]
    if all("sc" in st for st in tags):
        props["sc"] = sum(st["sc"] for st in tags)
    # A direction only means something when ONE way drew this slab. Merged
    # flights genuinely have no single answer and inventing one would be the
    # exact failure this file's TRUTH RULE forbids.
    if len(hits) == 1 and "inc" in tags[0]:
        props["inc"] = tags[0]["inc"]
    if tags and all(st.get("hr") == 1 for st in tags):
        props["hr"] = 1
    if any(st.get("rmp") for st in tags):
        props["rmp"] = 1
    if tags and all(st.get("lit") for st in tags):
        props["lit"] = 1
    if any(st.get("cv") for st in tags):
        props["cv"] = 1
    stats["stair_slab_ways_%d" % min(len(hits), 4)] += 1
    return props


def widen_paths(feats, stats, warnings):
    """k:'path' LineStrings -> unioned k:'patharea' Polygons, width in metres.

    A k:'path' feature whose geometry is already a Polygon is a mapped
    pedestrian AREA (`area=yes`) and joins the same union un-buffered: it is
    the thing itself, not a centreline standing in for it.
    """
    try:
        from shapely.geometry import LineString, Polygon
        from shapely.ops import unary_union
        from shapely.strtree import STRtree
    except ImportError:
        warnings.append("shapely not installed: paths left as LineStrings, which "
                        "means they fan out with pitch (see road-fan.mjs)")
        # `_wid`/`_st` are scaffolding for the union below and must never reach
        # a shipped file, not even down the degraded path.
        for f in feats:
            f["properties"].pop("_wid", None)
            f["properties"].pop("_st", None)
        return feats

    mlat = 111195.08
    mlon = mlat * math.cos(math.radians(LAT0))
    to_m = lambda c: [((x + 97.74) * mlon, (y - LAT0) * mlat) for x, y in c]
    to_ll = lambda c: [[round(x / mlon - 97.74, 6), round(y / mlat + LAT0, 6)] for x, y in c]

    kept, groups, sources = [], {}, {}
    for f in feats:
        p = f["properties"]
        gt = f["geometry"]["type"]
        if p.get("k") != "path" or gt not in ("LineString", "Polygon"):
            kept.append(f)
            continue
        if gt == "Polygon":
            ring = f["geometry"]["coordinates"][0]
            if len(ring) < 4:
                continue
            poly = Polygon(to_m(ring))
            if not poly.is_valid:
                poly = poly.buffer(0)
            stats["path_area_polygon"] += 1
        else:
            coords = f["geometry"]["coordinates"]
            if len(coords) < 2:
                continue
            w = float(p.get("w") or 2.0)
            # Mitre joins and flat caps: a round join on a 2 m footpath adds a
            # dozen vertices per corner to draw a curve nobody can see at 200 m.
            poly = LineString(to_m(coords)).buffer(
                w / 2.0, cap_style=2, join_style=2, mitre_limit=2.0)
            stats["path_widened"] += 1
        if poly.is_empty:
            continue
        key = (p.get("u"), p.get("s"))
        groups.setdefault(key, []).append(poly)
        if p.get("u") in STAIR_ID_USES and p.get("_wid") is not None:
            sources.setdefault(key, []).append((poly, p["_wid"], p.get("_st") or {}))

    for (use, surf), polys in sorted(groups.items(), key=lambda kv: str(kv[0])):
        merged = unary_union(polys)
        if PATH_SIMPLIFY_M:
            merged = merged.simplify(PATH_SIMPLIFY_M)
        parts = merged.geoms if merged.geom_type == "MultiPolygon" else [merged]
        src = sources.get((use, surf))
        tree = STRtree([s[0] for s in src]) if src else None
        for gm in parts:
            if gm.is_empty or gm.area < PATH_MIN_AREA_M2:
                stats["path_sliver_dropped"] += 1
                continue
            rings = [to_ll(list(gm.exterior.coords))]
            rings += [to_ll(list(r.coords)) for r in gm.interiors]
            props = {"k": "patharea", "u": use, "s": surf}
            if tree is not None:
                props.update(_stair_props(gm, src, tree, stats))
            kept.append({
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": rings},
                "properties": props,
            })
            stats["patharea_" + str(use)] += 1
    return kept


# ------------------------------------------------------- scored concrete --
#
# "sidewalks look like bathroom tiles. looks like its all one huge tile floor
#  and the sidewalks just reveal a portion of that one floor."
#
# HE DIAGNOSED IT EXACTLY, and the diagnosis is the whole design of this block.
# The scoring was a `fill-pattern`, and a fill-pattern is anchored in TILE
# space: one square lattice, laid over the entire city, that every walk cuts a
# window into. Two separate walks that never touch share joint lines, and a
# walk running north-east wears joints running north and east. That is not a
# sidewalk, that is a floor seen through walk-shaped holes.
#
# A different tile image cannot fix it. THE JOINTS HAVE TO RUN ALONG EACH PATH,
# which means the pattern's ORIENTATION has to be a property of the feature.
# MapLibre will do that -- `fill-extrusion-pattern` is data-driven, so one
# `['match', ['get','o'], ...]` picks a different pre-rotated image per feature
# -- but only if the geometry is cut so that one polygon carries one direction.
#
# WHY NOT PER-SLAB GEOMETRY, which is the obvious honest answer. Measured:
# 136 km of walk centreline at a real 1.5 m slab pitch is 90,600 quads, about
# 19 MB of GeoJSON on a 3.9 MB file. It is not affordable and it was not close.
#
# So: cut the walk area into regions of constant DIRECTION and give each region
# a pre-rotated bar tile. The regions are a partition -- disjoint by
# construction -- because two overlapping translucent grain polygons composite
# twice and every junction would wear a darker patch (the same reason
# widen_paths unions in the first place).
#
# THE DECK IS NOT TOUCHED. `k:'patharea'` stays exactly one polygon set,
# unioned per (use, surface), because the kerb is a stroke on its boundary --
# cut the deck into direction regions and every cut draws a bright kerb line
# straight across the middle of a walk. The scoring rides on `k:'pathslab'`,
# which nothing strokes.
#
# THE ANGLES ARE INTEGER VECTORS AND THAT IS NOT ARBITRARY. A bar tile is
# seamless on a T x T torus only if the phase is periodic in both axes, and
# phase = frac((a*x + b*y) * k / T) is periodic for ANY integers a, b, k --
# exactly, at every angle atan2(b, a), with no seam to hide. Pick a
# non-integer angle and the lattice does not close on the tile and the seam
# draws its own grid over the city, which is the bug being fixed.
WALK_ANG = [(1, 0), (2, 1), (1, 1), (1, 2), (0, 1), (-1, 2), (-1, 1), (-2, 1)]
# Worst-case error between a walk's true bearing and its bucket, over this set,
# is 13.3 degrees. A joint 13 degrees off square, one to three pixels wide from
# any altitude this app flies, is not a thing anyone can see; a joint running
# ALONG the walk instead of across it is the first thing everyone sees.
WALK_VARIANTS = 2        # phase/pitch variants per angle; see js/ground.js
WALK_RUN_OVERLAP_M = 1.5  # runs overlap this far so a direction change leaves no gap
WALK_SIMPLIFY_M = 0.20    # the region only carries a texture; its edge is under a kerb
WALK_MIN_AREA_M2 = 1.5


def _walk_bucket(dx, dy):
    """Index into WALK_ANG whose direction is closest to (dx, dy), mod 180."""
    n = math.hypot(dx, dy)
    if n == 0.0:
        return None
    ux, uy = dx / n, dy / n
    best, bi = -2.0, 0
    for i, (a, b) in enumerate(WALK_ANG):
        d = abs((a * ux + b * uy) / math.hypot(a, b))
        if d > best:
            best, bi = d, i
    return bi


def _walk_variant(coord):
    """A stable 0..WALK_VARIANTS-1 for one path.

    Two parallel walks on opposite sides of a street land in the SAME angle
    bucket, and with one tile per bucket their joints would line up across the
    road -- which is the reported defect in miniature. The variants are the same
    bars at a different phase and a slightly different pitch, so neighbours
    disagree. `zlib.crc32`, not `hash()`: Python salts `hash()` per process and
    the bake has to be byte-reproducible.
    """
    import zlib
    key = ("%.5f,%.5f" % (coord[0], coord[1])).encode("ascii")
    return zlib.crc32(key) % WALK_VARIANTS


def walk_direction_runs(feats, stats):
    """k:'path' LineStrings -> [(o, metric polygon)], one direction each.

    Run BEFORE widen_paths consumes the centrelines, and consumed AFTER the
    resolver has finished cutting the walks -- see score_walks for why.
    """
    try:
        from shapely.geometry import LineString
    except ImportError:
        return []
    out = []
    for f in feats:
        p = f["properties"]
        if p.get("k") != "path" or f["geometry"]["type"] != "LineString":
            continue
        # Steps carry their own risers from data/depth.geojson, and a slab
        # lattice laid over a flight reads as a fault in the stair. The brick
        # mall has its own herringbone bond.
        if p.get("u") == "steps" or p.get("s") == "brickpave":
            continue
        c = f["geometry"]["coordinates"]
        if len(c) < 2:
            continue
        pts = _line_m(c)
        var = _walk_variant(c[0])
        half = float(p.get("w") or 2.0) / 2.0

        # Vertex index ranges of constant bucket.
        runs, i0, cur = [], 0, None
        for i in range(1, len(pts)):
            b = _walk_bucket(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
            if b is None:
                continue
            if cur is None:
                cur = b
            elif b != cur:
                runs.append((i0, i - 1, cur))
                i0, cur = i - 1, b
        if cur is None:
            continue
        runs.append((i0, len(pts) - 1, cur))

        for (a, b, bucket) in runs:
            if b <= a:
                continue
            # Extend each run back and forward ALONG the polyline, so the two
            # flat caps at a direction change overlap instead of leaving a wedge
            # of unscored walk on the outside of every curve. The added points
            # lie on the line itself, so the run's buffer can never reach
            # outside the buffer of the whole line.
            seq = pts[a:b + 1]
            for src, dst, end in ((a, a - 1, "head"), (b, b + 1, "tail")):
                if dst < 0 or dst >= len(pts):
                    continue
                x0, y0 = pts[src]
                x1, y1 = pts[dst]
                d = math.hypot(x1 - x0, y1 - y0)
                if d <= 1e-9:
                    continue
                t = min(WALK_RUN_OVERLAP_M, d) / d
                q = (x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)
                if end == "head":
                    seq = [q] + seq
                else:
                    seq = seq + [q]
            poly = LineString(seq).buffer(half, cap_style=2, join_style=2,
                                          mitre_limit=2.0)
            if not poly.is_empty:
                out.append((bucket * WALK_VARIANTS + var, poly))
                stats["walk_run"] += 1
    return out


def _polys(g):
    """Every Polygon inside any geometry, flattened.

    THIS FUNCTION IS A BUG FIX WITH A NAME. The first cut of score_walks did
    `g.geoms if g.geom_type.startswith("Multi") else [g]`, which is correct for
    a MultiPolygon and silently catastrophic for a GeometryCollection -- and
    `intersection` returns one of those the moment two polygons touch along an
    edge, which on a network of walks is constantly. The whole collection then
    failed the `!= "Polygon"` test and was dropped as a single sliver: the bake
    reported 97,158 m2 of scoring where the walks cover about 320,000, and the
    only visible symptom was that two thirds of the city's walks were bare.
    """
    if g is None or g.is_empty:
        return []
    if g.geom_type == "Polygon":
        return [g]
    if hasattr(g, "geoms"):
        out = []
        for p in g.geoms:
            out.extend(_polys(p))
        return out
    return []


def score_walks(feats, runs, stats, warnings):
    """Emit k:'pathslab' -- the resolved walk area, cut by direction.

    AFTER resolve_ground_conflicts, and that is load-bearing: the resolver cuts
    every walk against the carriageways, so a region derived from the raw
    buffered centrelines would hang the scoring out over the asphalt at every
    junction. Intersecting with the walks the resolver actually KEPT is the
    only way the grain cannot outlive the deck it stands on.

    WORKED IN A LOCAL FRAME. `_poly_m` measures from the equator and the prime
    meridian, so a campus footpath sits at (-9.38e6, 3.37e6) and every overlay
    here spends its double precision on the first eight digits. Shifting the
    origin to the middle of campus is free and it took this block from twelve
    minutes to under two.
    """
    if not runs:
        return feats
    try:
        from shapely.ops import unary_union
        from shapely.strtree import STRtree
        from shapely.affinity import translate
    except ImportError:
        warnings.append("shapely not installed: walks left with no scoring")
        return feats

    X0, Y0 = -97.7371 * _KX, 30.2849 * M_LAT     # mid-campus, metres
    deck = []
    for f in feats:
        p = f["properties"]
        if (p.get("k") != "patharea" or f["geometry"]["type"] != "Polygon"
                or p.get("u") == "steps" or p.get("s") == "brickpave"):
            continue
        q = _poly_m(f["geometry"])
        if q is not None and not q.is_empty:
            deck.append(translate(q, -X0, -Y0))
    if not deck:
        return feats
    # NOT a single union of the whole network: clipping each region against
    # only the walk polygons its own envelope touches is the difference between
    # one overlay of 22,000 vertices and a few hundred small ones.
    tree = STRtree(deck)

    groups = {}
    for o, poly in runs:
        groups.setdefault(o, []).append(translate(poly, -X0, -Y0))

    acc, made, area = None, 0, 0.0
    for o in sorted(groups):
        g = unary_union(groups[o])
        if acc is not None:
            g = g.difference(acc)
        parts = _polys(g)
        if not parts:
            continue
        acc = unary_union(parts if acc is None else [acc] + parts)
        for part in parts:
            near = tree.query(part)
            if len(near) == 0:
                continue
            clip = part.intersection(unary_union([deck[int(i)] for i in near]))
            if WALK_SIMPLIFY_M:
                clip = clip.simplify(WALK_SIMPLIFY_M)
            for gm in _polys(clip):
                if gm.area < WALK_MIN_AREA_M2:
                    stats["pathslab_sliver_dropped"] += 1
                    continue
                feats.append({
                    "type": "Feature",
                    "geometry": {"type": "Polygon",
                                 "coordinates": _rings_ll(translate(gm, X0, Y0))},
                    "properties": {"k": "pathslab", "o": o},
                })
                made += 1
                area += gm.area
    stats["pathslab"] = made
    stats["pathslab_m2"] = round(area)
    return feats


# --------------------------------------------------------- road  polygons --
#
# "when im all the way down vertically and look at an angle towards the roads
#  and start facing upright, the roads get bigger. some roads dont do this."
#
# "some roads dont" was the whole clue and it is not about roads at all: the
# ones that DON'T swell are the sidewalks, because PR #70 moved their width out
# of `line-width` and into the geometry. The carriageways were left behind, so
# they still fan. Measured on merged main by scripts/verify/road-fan.mjs
# (camera on Speedway's south end, `ground-road`):
#
#     pitch 20   1.10x at the only sample still on screen
#     pitch 60   1.26x near  ->  3.33x far
#     pitch 86   1.30x near  ->  3.69x far   (over 900 m of road; it keeps going)
#
# A `line-width` is a number of SCREEN PIXELS and it is the same number for the
# whole line, while 12 m of ground under the camera is many pixels and 12 m of
# it by the horizon is a fraction of one. MapLibre has no per-vertex line width
# and no metres unit on `line-width`, so no expression can fix this -- which is
# why the fix is the same one the paths got: buffer the centreline by half its
# real width at bake time and draw a POLYGON, which gets the true perspective
# for free at every pitch and every distance.
#
# WHAT IT COSTS, MEASURED, and it is the reason the far-field armature is
# excluded below. These polygons ship in data/ground.geojson, which is NOT
# tiled -- it downloads whole. The near network (everything inside the flyable
# area) is +1.7 MB raw / +373 KB gzipped on a 1.58 MB / 293 KB file. The
# far-field arterials are another +727 KB raw for roads five to thirty km out
# that no camera in this app can approach, and drawn at their true width they
# would be a third of a pixel across and effectively erased -- which would undo
# the establishing-shot armature they exist for. So `far` stays a line, and
# js/ground.js keeps one line layer for it and one only.
ROADAREA = {
    "on": True,
    "include_far": False,       # see the note above; `far:1` stays a line
    "simplify_m": 0.15,         # same tolerance as the paths: under a pixel
    "min_area_m2": 2.0,         # drop slivers the union leaves behind
    # SIX decimal places, deliberately, even though five would save 81 KB
    # gzipped. Five is 1.1 m here, and a kerb quantised to 1.1 m is a visibly
    # ragged edge from street level -- the altitude this whole pass is about.
    "coord_dp": 6,
}


# ------------------------------------------------ a mall is not a road ------
#
# "some asphalt roads bleed into speedway"
#
# PHOTOGRAPHED before it was changed (shots/speedway/swB_zoom.png, nadir over
# Speedway at 26th): E 26th is severed by the mall, so OSM carries it as two
# stubs whose centrelines run PAST the kerb and end on the brick. Buffered with
# a flat cap, each stub becomes a grey rectangle lying on the herringbone with a
# square blunt end -- one from the east, one from the west, at slightly
# different latitudes so they do not even meet. Two more sit at 23rd. Measured
# on the shipped file: 3 carriageway polygons overlapping the mall, 23 m2.
#
# WHY THE LADDER MISSED IT. `_band` deliberately keeps `roadarea` out of the
# resolver -- the carriageway is the ladder's top rung, "because a sidewalk does
# not lie on a road" -- and the ONE cross-band cut runs the other way: the
# carriageway cuts the walk. That rule is right for a sidewalk and wrong for a
# mall. `highway=pedestrian` is OSM for a street CLOSED TO TRAFFIC. A car does
# not drive on Speedway, so the square metre is the mall's, and a road that
# merely ends on it has no claim at all.
#
# So the rule is one sentence, applied in both directions:
#   A PEDESTRIAN MALL OUTRANKS A CARRIAGEWAY. It is not cut by one, and one is
#   cut by it.
# Both halves are needed. Without the first the mall keeps the notch the
# resolver already took out of it and removing the asphalt just uncovers a hole;
# without the second the asphalt stays on top of the brick.
#
# EIGHT features carry `u:'pedestrian'` in the whole city and Speedway is one of
# them, so the blast radius is small and countable -- the stats below print it.
def is_pedestrian_mall(p):
    return p.get("k") == "patharea" and p.get("u") == "pedestrian"


def pedestrian_mall_union(feats, stats):
    """Every pedestrian mall in the scene, as ONE metric geometry, or None."""
    try:
        from shapely.ops import unary_union
    except ImportError:
        return None
    polys = []
    for f in feats:
        if f["geometry"]["type"] != "Polygon" or not is_pedestrian_mall(f["properties"]):
            continue
        q = _poly_m(f["geometry"])
        if q is not None and not q.is_empty:
            polys.append(q)
    stats["pedestrian_malls"] = len(polys)
    if not polys:
        return None
    m = unary_union(polys)
    stats["pedestrian_mall_m2"] = round(m.area)
    return m


def widen_roads(road_feats, stats, warnings, keep_out=None):
    """k:'road'/'cycle' LineStrings -> k:'roadarea'/'cyclearea' Polygons.

    Returns NEW features to append to data/ground.geojson. The LineStrings stay
    in data/roads.geojson exactly as they were: the lane markings, the stop bars
    and the bike lanes are drawn off the centreline and still need it, and
    keeping that file byte-identical means the PMTiles archive does not have to
    be rebuilt for this pass.
    """
    if not ROADAREA["on"]:
        return []
    try:
        from shapely.geometry import LineString
        from shapely.ops import unary_union
    except ImportError:
        warnings.append("shapely not installed: roads left as LineStrings, which "
                        "means they fan out with pitch (see road-fan.mjs)")
        return []

    dp = ROADAREA["coord_dp"]
    groups = {}
    for f in road_feats:
        p = f["properties"]
        kind = p.get("k")
        if kind not in ("road", "cycle"):
            continue
        if kind == "road" and p.get("far") and not ROADAREA["include_far"]:
            stats["roadarea_far_left_as_line"] += 1
            continue
        coords = f["geometry"]["coordinates"]
        if len(coords) < 2:
            continue
        w = float(p.get("w") or (9.0 if kind == "road" else 2.5))
        if w <= 0.2:
            continue
        # Mitre joins and flat caps, same as widen_paths: a round join spends a
        # dozen vertices per corner drawing a curve nobody can see at 200 m.
        try:
            poly = LineString(_line_m(coords)).buffer(
                w / 2.0, cap_style=2, join_style=2, mitre_limit=2.0)
        except Exception:
            stats["roadarea_buffer_failed"] += 1
            continue
        if poly.is_empty:
            continue
        # Grouped by everything that changes how it is DRAWN and nothing else.
        # `c` survives because js/ground.js fades service roads in by zoom and
        # `s` because the carriageway's colour is its surface. Name, lanes,
        # oneway and the bike tags are all centreline business and are dropped.
        key = ("roadarea", p.get("c") if kind == "road" else None, p.get("s"))
        groups.setdefault(key if kind == "road" else ("cyclearea", None, p.get("s")),
                          []).append(poly)
        stats["roadarea_widened_" + kind] += 1

    out = []
    for (k, cls, surf), polys in sorted(groups.items(), key=lambda kv: str(kv[0])):
        merged = unary_union(polys)
        # The mall takes its ground back. Done on the MERGED carriageway rather
        # than per-centreline so the subtraction runs once per drawn class, and
        # BEFORE simplify so the new edge is simplified with the same tolerance
        # as every other edge in the polygon -- a cut made afterwards would be
        # the one part of the road held to a different accuracy.
        if keep_out is not None and merged.intersects(keep_out):
            a0 = merged.area
            try:
                merged = merged.difference(keep_out)
            except Exception:
                warnings.append("mall difference failed on %s/%s; left uncut"
                                % (k, surf))
            else:
                stats["roadarea_mall_m2_returned"] += round(a0 - merged.area)
        if ROADAREA["simplify_m"]:
            merged = merged.simplify(ROADAREA["simplify_m"])
        parts = merged.geoms if merged.geom_type == "MultiPolygon" else [merged]
        for gm in parts:
            if gm.is_empty or gm.area < ROADAREA["min_area_m2"]:
                stats["roadarea_sliver_dropped"] += 1
                continue
            rings = [[[round(x / _KX, dp), round(y / M_LAT, dp)]
                      for x, y in gm.exterior.coords]]
            rings += [[[round(x / _KX, dp), round(y / M_LAT, dp)] for x, y in r.coords]
                      for r in gm.interiors]
            props = {"k": k, "s": surf}
            if cls:
                props["c"] = cls
            out.append({"type": "Feature",
                        "geometry": {"type": "Polygon", "coordinates": rings},
                        "properties": props})
            stats["roadarea_out_" + k + "_" + str(cls or surf)] += 1
    return out


# ----------------------------------------------------- coincident surfaces --
#
# "speedway and 24th keep glitching on motion and combine on still, find out
# other areas like this and fix"
#
# THE CAUSE, MEASURED. Two surfaces drawn at the same height over the same
# ground have no defined winner. Where the winner is decided per pixel by
# floating-point depth, it flips as the camera moves -- the "glitching" -- and
# when the camera stops it settles on whichever won that frame, which is the
# "combine". Speedway and 24th are two instances of it and there were 1,697:
#
#     337  patharea x patharea      1,791 m2   ALL at exactly 0.22 m in ONE
#                                              fill-extrusion layer -> a true
#                                              depth tie
#     184  area x area             90,433 m2   two flat fills in one layer:
#                                              no depth tie, but the loser is
#                                              composited THROUGH the winner at
#                                              fill-opacity 0.95
#   1,176  road x patharea         38,713 m2   a 2.4 m sidewalk polygon standing
#                                              0.22 m proud in the middle of a
#                                              15 m carriageway
#
# At 24th and Speedway specifically: a 55.3 m2 pedestrian/asphalt patch and a
# 51.4 m2 footway/concrete patch both sit on the brick mall at the same 0.22 m,
# and East 24th's carriageway runs under both. Three surfaces, one plane.
#
# THE RULE, and it is one rule: ONE SQUARE METRE OF GROUND BELONGS TO EXACTLY
# ONE DRAWN SURFACE. Every ground class has a rank; where two overlap, the
# higher rank keeps the ground and the lower one gives it up. Nothing is moved
# in z and no layer order changes -- the ambiguity is removed from the DATA, so
# it cannot come back at a camera angle nobody photographed.
#
# The ranks below are the whole taste surface of this pass: reorder two lines
# and the ground changes hands. They read as "the more specific, more built,
# more identifying thing wins" -- a flight of steps beats the walk it lands on,
# the brick mall beats the generic footway laid over it, water beats the wood
# band planted along it, and the carriageway beats everything, because a
# sidewalk does not lie on a road.
RANK = {
    # --- the 0.22 m band: k='patharea', one fill-extrusion layer -----------
    ("patharea", "steps"):      64,
    ("patharea", "pedestrian"): 60,
    ("patharea", "path"):       56,
    ("patharea", "footway"):    52,
    # --- the flat band: k='area', one fill layer --------------------------
    #
    # A CROSSING OUTRANKS THE CHANNEL IT CROSSES, and this is the top of the
    # ladder. Where a street meets the creek there is a culvert or a bridge, and
    # the square metre belongs to the structure -- so the trench, both banks and
    # all three planting zones give their footprint back and the road runs over
    # the top. Without this the channel is cut straight through the carriageway
    # and the walk beside it floats over the water on nothing, which is exactly
    # what was reported. See deck_creek_crossings.
    ("bank", "deck"):           95,
    # The cut channel outranks everything else flat. That is not a preference,
    # it is the mechanism: a `fill` drawn over the trench would paint straight
    # into it (PR #62's finding), so the trench only exists BECAUSE every lawn,
    # wood and park polygon gives up its footprint here. See cut_creek_channels.
    ("bank", "channel"):        90,
    # Same argument for the pond coping: it is a built rim standing 0.38 m
    # proud, so the lawn under it has to give way or the fill paints over the
    # kerb. It sits below the channel only because nothing ever asks them to
    # compete -- keeping the two adjacent makes the ladder readable.
    ("bank", "coping"):         88,
    # A planting bed and a specimen roundel are the most specific thing in a
    # garden, so they beat the garden turf they are cut out of. They are DERIVED
    # from the walks, so they must not beat the walks -- and they do not: those
    # are in the `path` band and this is the flat one.
    ("area", "bed"):            50,
    ("area", "fountain"):       46,
    ("area", "water"):          44,
    ("area", "endzone"):        40,   # derived; must stay on top of its pitch
    # Small and specific beats large and generic, which is why the sand sits
    # ABOVE the pitch: the five sand areas here are long-jump pits INSIDE a
    # pitch polygon, and the first cut of this ladder deleted all five.
    ("area", "sand"):           38,
    ("area", "playground"):     37,
    ("area", "pitch"):          36,
    ("area", "track"):          35,
    ("area", "plaza"):          30,
    ("area", "parking"):        28,
    ("area", "construction"):   26,
    ("area", "garden"):         24,
    ("area", "wood"):           20,
    ("area", "scrub"):          18,
    # A medallion is cut out of the median it sits in, and the star is cut out
    # of the medallion. Same argument as the planting bed above -- small and
    # specific beats large and generic -- and they sit low in the ladder on
    # purpose: both are DERIVED from the lawn, so anything that outranks the
    # lawn (a walk, a carriageway, a bed) must also take them, or a medallion
    # would end up floating across a crossing.
    ("area", "star"):           16,
    ("area", "medallion"):      14,
    # The stone base a flagpole stands on. Above the lawn for the same reason;
    # below the medallion only because nothing ever asks them to compete.
    ("area", "plinth"):         13,
    ("area", "lawn"):           12,
    ("area", "park"):           10,   # the biggest, most generic container
}
RANK_DEFAULT = 1                      # anything unranked loses to everything

# Within one class, the bigger polygon keeps its ground; a tie after that falls
# back to the feature's own index, so the result cannot depend on dict order.
#
# 0.5 m2 rather than widen_paths' 1.0: a subtraction leaves genuine narrow
# strips (the pavement either side of a driveway crossing) that a union never
# does, and 1.0 was eating them.
RESOLVE_MIN_M2 = 0.5

# How far inside the pavement edge the carriageway starts. bake_ground.py builds
# `w` as lanes*LANE_M + KERB_M and the 1.6 is the kerb-and-gutter allowance for
# BOTH sides, so half of it per side lands the cut on the travelled way. Same
# number and same argument as the road test in shape_trees.py.
CARRIAGEWAY_INSET_M = KERB_M / 2.0

# CROSSING THE BANDS, one direction only. Areas are flat and paths stand 0.22 m
# proud, so they cannot tie -- and cutting every lawn to the shape of the walks
# over it would put a few hundred path-shaped holes in the ground for a defect
# that does not exist. The ONE cross-band cut that earns itself is the
# carriageway against the paths, because that one is visible: a pale concrete
# slab standing across the middle of every junction.


def _rank(p):
    return RANK.get((p.get("k"), p.get("u")), RANK_DEFAULT)


def _band(p):
    """Which render band a feature is drawn in. Only same-band pairs can tie.

    `None` means the feature is not drawn as a surface at all, so it neither
    takes ground nor gives any up. Exactly one thing is in that state and it is
    deliberate: since the creek became a cut channel the `s:'creek'` polygon is
    no longer painted by `ground-areas` (js/ground.js filters it out) -- the
    extruded bed carries the water now. It stays in the file because it is the
    only record that this ground IS water, and shape_trees.py and bake_props.py
    both read it to keep a trunk or a bench out of the creek.
    """
    if p.get("k") == "area" and p.get("s") == "creek":
        return None
    # A crown is not ground. It stands 4-17 m in the air, so it neither takes a
    # square metre from the lawn under it nor gives one up -- and letting it into
    # the ladder would be actively wrong: `k:'cnp'` is unranked, so every lawn
    # and path in the corridor would cut a tree-shaped hole out of itself and
    # RANK_DEFAULT would then delete the crown that caused it.
    if p.get("k") == "cnp":
        return None
    # A slab region is not ground either. It is the scoring drawn ON a walk that
    # is already in the ladder, 20 mm above it, cut FROM the resolved walk (see
    # score_walks) -- so it can only ever cover ground the walk already won. Let
    # it into the band and every lawn would cut a walk-shaped hole out of itself
    # twice, and RANK_DEFAULT would then delete the scoring that caused it.
    if p.get("k") == "pathslab":
        return None
    # A carriageway polygon is not IN the ladder, it IS the ladder's top rung.
    # The resolver already cuts every path and lawn against the buffered
    # centrelines (carriageway_polys, below), so the drawn pavement is the one
    # surface that takes ground without ever giving any up. Letting it in would
    # have it cut against itself: RANK has no entry for `roadarea`, so
    # RANK_DEFAULT would hand every square metre to whatever else was there.
    if p.get("k") in ("roadarea", "cyclearea"):
        return None
    # THE WATER SHEEN IS NOT GROUND EITHER, and the first cut of it proved that
    # the hard way: it is the SAME footprint as the water prism at the SAME rank
    # in the SAME band, so the resolver handed the ground to whichever sorted
    # first and trimmed the other to nothing. All seven were emitted, all seven
    # were deleted, and the bake's own report still said `creek_water_sheen: 7`
    # because that count is taken at emit time. A stat that counts intent rather
    # than outcome is worse than no stat. It is a lid standing 0.10 m on the
    # water two metres below grade; it competes with nothing.
    if p.get("k") == "bank" and p.get("m") == "sheen":
        return None
    return "path" if p.get("k") == "patharea" else "flat"


# ONE metric frame for this whole pass. HANDOFF §32 records the trap: 1e-6 deg
# is 0.096 m east-west and 0.111 m north-south here, and every margin in this
# file is smaller than that difference, so nothing may be buffered, inset or
# area-tested in degrees.
_KX = math.cos(math.radians(LAT0)) * M_LAT


def _poly_m(geom):
    """A GeoJSON Polygon -> a shapely polygon in METRES, repaired if need be."""
    from shapely.geometry import Polygon
    rings = geom["coordinates"]
    try:
        q = Polygon([(x * _KX, y * M_LAT) for x, y in rings[0]],
                    [[(x * _KX, y * M_LAT) for x, y in r] for r in rings[1:]])
    except Exception:
        return None
    if not q.is_valid:
        q = q.buffer(0)
    return q


def _line_m(coords):
    return [(x * _KX, y * M_LAT) for x, y in coords]


def _rings_ll(gm):
    out = [[[round(x / _KX, 6), round(y / M_LAT, 6)] for x, y in gm.exterior.coords]]
    out += [[[round(x / _KX, 6), round(y / M_LAT, 6)] for x, y in r.coords]
            for r in gm.interiors]
    return out


def count_conflicts(feats, road_polys):
    """Every pair of ground polygons that share ground at the same height.

    THE PROBE LIVES IN THE BAKE on purpose. Four scripts write this file and
    each has silently broken another at least once; a number printed by the run
    that produced the data cannot go stale the way a separate script can.
    """
    try:
        from shapely.strtree import STRtree
    except ImportError:
        return None
    items = []
    for f in feats:
        if f["geometry"]["type"] != "Polygon":
            continue
        q = _poly_m(f["geometry"])
        if q is None or q.is_empty:
            continue
        items.append((f["properties"], q))
    n, a = 0, 0.0
    by_class = Counter()
    if items:
        tree = STRtree([q for _, q in items])
        for i, (p, q) in enumerate(items):
            for bi in tree.query(q):
                bi = int(bi)
                if bi <= i:
                    continue
                p2, q2 = items[bi]
                b1 = _band(p)
                if b1 is None or b1 != _band(p2):
                    continue
                inter = q.intersection(q2)
                if inter.area >= RESOLVE_MIN_M2:
                    n += 1
                    a += inter.area
                    by_class["/".join(sorted([str(p.get("u")), str(p2.get("u"))]))] += 1
    rn, ra = 0, 0.0
    # Pedestrian malls are excluded: they are exempt from the carriageway cut on
    # purpose now (see widen_roads), so counting them here would report a defect
    # the bake deliberately does not have.
    paths = [q for p, q in items
             if p.get("k") == "patharea" and not is_pedestrian_mall(p)]
    if road_polys and paths:
        ptree = STRtree(paths)
        for rq in road_polys:
            for bi in ptree.query(rq):
                inter = rq.intersection(paths[int(bi)])
                if inter.area >= RESOLVE_MIN_M2:
                    rn += 1
                    ra += inter.area
    return {"same_height_pairs": n, "same_height_m2": round(a),
            "carriageway_x_path_pairs": rn, "carriageway_x_path_m2": round(ra),
            "worst_same_height": dict(by_class.most_common(8))}


def carriageway_polys(road_feats):
    """Every travelled way in the detail area, as a metric polygon.

    `far` ways are excluded and the reason is measurable: their centrelines are
    simplified five times harder (6.0 m against 1.2 m), so cutting a 2.4 m
    campus sidewalk with one would remove pavement that is really there.
    """
    try:
        from shapely.geometry import LineString
    except ImportError:
        return []
    out = []
    for f in road_feats:
        p = f["properties"]
        if p.get("k") != "road" or p.get("far"):
            continue
        half = float(p.get("w") or 9.0) / 2.0 - CARRIAGEWAY_INSET_M
        if half <= 0.2:
            continue
        try:
            q = LineString(_line_m(f["geometry"]["coordinates"])).buffer(
                half, cap_style=2, join_style=2, mitre_limit=2.0)
        except Exception:
            continue
        if not q.is_empty:
            out.append(q)
    return out


def _road_bearing_index(road_feats):
    """(STRtree of road centreline segments, [bearing in degrees]) in metres.

    `far` ways are left out for the same reason carriageway_polys leaves them
    out: they are simplified five times harder and their bearing is not a claim
    about a campus kerb.
    """
    try:
        from shapely.geometry import LineString
        from shapely.strtree import STRtree
    except ImportError:
        return None, []
    segs, bear = [], []
    for f in road_feats:
        p = f["properties"]
        if p.get("k") not in ("road", "cycle") or p.get("far"):
            continue
        pts = _line_m(f["geometry"]["coordinates"])
        for i in range(len(pts) - 1):
            (ax, ay), (bx, by) = pts[i], pts[i + 1]
            if ax == bx and ay == by:
                continue
            segs.append(LineString([(ax, ay), (bx, by)]))
            bear.append(math.degrees(math.atan2(by - ay, bx - ax)) % 180.0)
    if not segs:
        return None, []
    return STRtree(segs), bear


def _alongside_runs(pts_m, tree, bear):
    """Split a metric centreline into the runs that are ALONGSIDE the nearest
    road and drop the ones that cross it. Returns a list of coordinate runs.

    With SIDEWALK_KEEP_PARALLEL_DEG at 90 every segment qualifies and the whole
    centreline comes back as one run, which is what the switch is for.
    """
    from shapely.geometry import Point
    runs, cur = [], []
    for i in range(len(pts_m) - 1):
        (ax, ay), (bx, by) = pts_m[i], pts_m[i + 1]
        if ax == bx and ay == by:
            continue
        ok = True
        if SIDEWALK_KEEP_PARALLEL_DEG < 90.0 and tree is not None:
            mid = Point((ax + bx) / 2.0, (ay + by) / 2.0)
            try:
                ni = int(tree.nearest(mid))
            except Exception:
                ni = None
            if ni is not None:
                d = abs(math.degrees(math.atan2(by - ay, bx - ax)) % 180.0 - bear[ni])
                ok = min(d, 180.0 - d) <= SIDEWALK_KEEP_PARALLEL_DEG
        if ok:
            if not cur:
                cur = [(ax, ay)]
            cur.append((bx, by))
        elif cur:
            runs.append(cur)
            cur = []
    if cur:
        runs.append(cur)
    return runs


def sidewalk_keep_polys(feats, stats, road_feats=(), kerb_band=None):
    """The core strip of every SURVEYED walking centreline, as metric polygons.

    Call it BEFORE widen_paths, while the walks are still LineStrings — the same
    ordering walk_direction_runs needs and for the same reason. Ways this bake
    derived itself (DERIVED_PATH_KEY) are excluded: an apron and a mall rim are
    extrapolations, and the carriageway cut is what keeps them honest.

    ONLY THE ALONGSIDE RUNS, and only within SIDEWALK_KEEP_DEPTH_M of the kerb:
    see SIDEWALK_KEEP_PARALLEL_DEG for why a walk that runs across a street has
    no claim on the exemption at all.
    """
    if SIDEWALK_KEEP_HALF_M <= 0:
        return []
    try:
        from shapely.geometry import LineString
    except ImportError:
        return []
    tree, bear = _road_bearing_index(road_feats)
    out = []
    for f in feats:
        p = f["properties"]
        if p.get("k") != "path" or f["geometry"]["type"] != "LineString":
            continue
        if p.get(DERIVED_PATH_KEY):
            stats["sidewalk_keep_skipped_derived"] += 1
            continue
        try:
            pts_m = _line_m(f["geometry"]["coordinates"])
            runs = _alongside_runs(pts_m, tree, bear)
        except Exception:
            continue
        if len(runs) != 1 or len(runs[0]) != len(pts_m):
            stats["sidewalk_keep_crossing_run_dropped"] += 1
        for run in runs:
            if len(run) < 2:
                continue
            try:
                q = LineString(run).buffer(
                    SIDEWALK_KEEP_HALF_M, cap_style=2, join_style=2, mitre_limit=2.0)
            except Exception:
                continue
            if q.is_empty:
                continue
            if kerb_band is not None:
                try:
                    q = q.intersection(kerb_band)
                except Exception:
                    stats["sidewalk_keep_depth_failed"] += 1
                if q.is_empty:
                    stats["sidewalk_keep_depth_dropped"] += 1
                    continue
            out.append(q)
            stats["sidewalk_keep_cores"] += 1
    return out


def kerb_band_polys(road_polys, stats):
    """The strip SIDEWALK_KEEP_DEPTH_M deep just inside every carriageway edge,
    plus everything outside the carriageways — i.e. every square metre a
    keep-core is allowed to occupy. None when the cap is switched off.

    Built as `world minus (carriageway eroded by the depth)` rather than as a
    buffered boundary, because a buffered boundary is a ring and the ground
    OUTSIDE the road has to stay keepable too.
    """
    if SIDEWALK_KEEP_DEPTH_M <= 0 or not road_polys:
        return None
    try:
        from shapely.geometry import box
        from shapely.ops import unary_union
    except ImportError:
        return None
    ru = unary_union(road_polys)
    core = ru.buffer(-SIDEWALK_KEEP_DEPTH_M)
    x0, y0, x1, y1 = ru.bounds
    world = box(x0 - 5000, y0 - 5000, x1 + 5000, y1 + 5000)
    band = world if core.is_empty else world.difference(core)
    # The deep interior of the carriageway: the ground no keep-core may enter.
    stats["sidewalk_keep_depth_m2_barred"] = 0 if core.is_empty else int(core.area)
    return band


def resolve_ground_conflicts(feats, road_polys, stats, warnings, keep_polys=()):
    """Give every square metre of ground to exactly one surface."""
    try:
        from shapely.strtree import STRtree
        from shapely.ops import unary_union
    except ImportError:
        warnings.append("shapely not installed: coincident surfaces NOT resolved "
                        "-- Speedway/24th and 1,697 other pairs will z-fight")
        return feats

    kept, work = [], []
    for i, f in enumerate(feats):
        if f["geometry"]["type"] != "Polygon":
            kept.append(f)
            continue
        band = _band(f["properties"])
        if band is None:
            kept.append(f)
            stats["resolve_not_a_surface"] += 1
            continue
        q = _poly_m(f["geometry"])
        if q is None or q.is_empty:
            stats["resolve_dropped_degenerate"] += 1
            continue
        work.append({"f": f, "q": q, "a0": q.area, "i": i,
                     "rank": _rank(f["properties"]), "band": band})

    # Highest rank first, then largest, then original order. Every term is
    # deterministic, so two runs of this bake hand the same ground to the same
    # feature -- which is what makes the file reproducible byte for byte.
    work.sort(key=lambda w: (-w["rank"], -w["a0"], w["i"]))

    road_tree = STRtree(road_polys) if road_polys else None
    keep_polys = list(keep_polys)
    keep_tree = STRtree(keep_polys) if keep_polys else None
    settled = []          # metric geometries already given their ground
    s_band = []
    s_tree = None
    REBUILD_EVERY = 64    # STRtree is immutable; rebuilding in blocks is the
                          # cheapest way to keep a growing index queryable
    pending = []

    out = []
    for w in work:
        cutters = []
        # Same band, higher rank: they have already taken their ground.
        if s_tree is not None:
            for bi in s_tree.query(w["q"]):
                bi = int(bi)
                if s_band[bi] == w["band"]:
                    cutters.append(settled[bi])
        for j, g in pending:
            if s_band[j] == w["band"] and g.intersects(w["q"]):
                cutters.append(g)
        # The ONE cross-band cut, and only this one -- and a pedestrian mall is
        # exempt from it, because a mall is not a sidewalk lying on a road. See
        # the note above widen_roads: this is the half of that rule that stops
        # the resolver notching the brick, and widen_roads' `keep_out` is the
        # half that stops the asphalt being painted over the notch.
        if w["band"] == "path" and road_tree is not None \
                and not is_pedestrian_mall(w["f"]["properties"]):
            rc = [road_polys[int(bi)] for bi in road_tree.query(w["q"])]
            # SIDEWALK_KEEP_HALF_M: the carriageway may take everything of this
            # slab EXCEPT the core of a surveyed centreline. Punching the keep
            # strips out of the CUTTER rather than adding them back afterwards
            # is what keeps the same-band cuts intact -- a walk that lost ground
            # to a higher-ranked walk must not get it back here, or the two
            # z-fight again.
            #
            # With nothing to keep, the cutters go in exactly as they always did
            # and are unioned exactly once, by the single difference() below.
            # Unioning them here as well would be the same set and a different
            # last digit, and this file is checked byte for byte.
            kl = []
            if rc and keep_tree is not None:
                kl = [keep_polys[int(j)] for j in keep_tree.query(w["q"])]
            if kl:
                try:
                    ru = unary_union(rc).difference(unary_union(kl))
                    stats["sidewalk_keep_applied"] += 1
                    if not ru.is_empty:
                        cutters.append(ru)
                except Exception:
                    warnings.append("sidewalk keep-core difference failed on a "
                                    "%s/%s; cut left whole"
                                    % (w["f"]["properties"].get("k"),
                                       w["f"]["properties"].get("u")))
                    cutters.extend(rc)
            else:
                cutters.extend(rc)
        g = w["q"]
        if cutters:
            try:
                g = g.difference(unary_union(cutters))
            except Exception:
                warnings.append("difference failed on a %s/%s; left uncut"
                                % (w["f"]["properties"].get("k"),
                                   w["f"]["properties"].get("u")))
                g = w["q"]
        # A feature claims the ground it ORIGINALLY covered, not the trimmed
        # remainder: otherwise two lower-ranked features could both take the
        # same square metre out of the middle of a third.
        settled.append(w["q"])
        s_band.append(w["band"])
        pending.append((len(settled) - 1, w["q"]))
        if len(pending) >= REBUILD_EVERY:
            s_tree = STRtree(settled)
            pending = []
        w["q"] = g
        if g.is_empty:
            stats["resolve_covered_" + str(w["f"]["properties"].get("u"))] += 1
            continue
        out.append(w)

    # Back to lon/lat. A subtraction can split one polygon into several, so a
    # MultiPolygon result becomes several Polygon features -- the schema in this
    # file is Polygon-only and three other bakes read it expecting that.
    #
    # A feature nothing touched is passed through UNCHANGED rather than
    # re-emitted through the transform: a round trip through metres and back
    # moves the last digit of a coordinate, and 1,100 features' worth of that
    # is noise in every future diff of this file.
    for w in out:
        if w["q"].area >= w["a0"] - 1e-6:
            kept.append(w["f"])
            continue
        stats["resolve_trimmed"] += 1
        g = w["q"]
        parts = list(g.geoms) if g.geom_type == "MultiPolygon" else [g]
        made = 0
        for gm in parts:
            if gm.geom_type != "Polygon" or gm.is_empty or gm.area < RESOLVE_MIN_M2:
                stats["resolve_sliver_dropped"] += 1
                continue
            kept.append({"type": "Feature",
                         "geometry": {"type": "Polygon", "coordinates": _rings_ll(gm)},
                         "properties": dict(w["f"]["properties"])})
            made += 1
        if made > 1:
            stats["resolve_split_into_parts"] += made - 1
        if made == 0:
            stats["resolve_trimmed_to_nothing"] += 1
    return kept


# ═══════════════════════════════════════════════════════════════════════════
# --walkaudit — IS THERE PAVEMENT UNDER THE WALKING ROUTE?
#
# The ground this file bakes is the ground the `?walk=1` ribbon is drawn on, so
# this bake is the right place to ask whether the two agree. It routes twenty
# real class-to-class pairs against data/walk_graph.json using js/wayfind.js's
# OWN cost model (read out of the graph's `tune` block, so the two can never
# disagree), samples the drawn ribbon every WALKAUDIT_SAMPLE_M, and asks which
# polygon of the file just baked each sample is standing on.
#
# It never bakes and never writes. `python scripts/bake_ground.py --walkaudit`.
#
# WHY IT SAMPLES THE DRAWN LINE RATHER THAN COUNTING EDGES. Counting graph edges
# answers "did the router use an OSM footway", and the answer to that has always
# been yes — 95.8 % of routed metres are ordinary footway edges. It does not
# answer the question a person asks looking at the city, which is whether the
# ribbon in front of them is lying on paving. Only the pixels-under-the-line
# test answers that, and the two answers are 9 points apart.
# ═══════════════════════════════════════════════════════════════════════════

# Twenty pairs. The nineteen scripts/bake_walk.py freezes as its route
# regression (so a number here can be compared with a number there without
# re-deriving the fixture), plus GDC>PCL, the walk a computer-science student
# makes most days.
WALKAUDIT_PAIRS = [
    ("JES", "GDC"), ("JES", "WEL"), ("PCL", "RLP"), ("GRE", "MAI"),
    ("BUR", "CBA"), ("STD", "MAI"), ("21 Rio", "WEL"),
    ("The Castilian", "GDC"), ("PCL", "JES"), ("GDC", "BIO"),
    ("WEL", "TSG"), ("GDC", "DMC"), ("GRE", "MNC"), ("GRE", "NEZ"),
    ("GRE", "TCP"), ("GRE", "AF2"), ("JES", "BMS"), ("JES", "BMK"),
    ("JES", "MCA"), ("GDC", "PCL"),
]

# THE HOUSE FIXTURE, added 2026-08-24. `scripts/verify/walk-pairs.json` is the
# twenty pairs the walk baseline (docs/walk-baseline.md) froze for every w-*
# lane, so a per-route percentage from here can be laid beside one from
# scripts/verify/walkmeter.mjs without re-deriving anything. It is a DIFFERENT
# twenty from the set above, which stays the default so this branch's own
# round-over-round deltas remain apples to apples.
#
#   python scripts/bake_ground.py --walkaudit --pairs house
#
WALKAUDIT_HOUSE_PAIRS_JSON = os.path.join("scripts", "verify", "walk-pairs.json")


def walkaudit_house_pairs():
    """The house twenty, or None if the fixture is not on this branch yet."""
    p = os.path.join(ROOT, WALKAUDIT_HOUSE_PAIRS_JSON)
    if not os.path.exists(p):
        return None
    with open(p, "r", encoding="utf-8") as fh:
        j = json.load(fh)
    return [(d["from"], d["to"]) for d in j.get("pairs", [])]


WALKAUDIT_SAMPLE_M = 1.0     # one reading per metre of ribbon
# MUST EQUAL js/wayfind.js's LINK_COST_MULT. A door link is charged this many
# pavement metres per real metre while the route is being chosen, so the router
# only spends one where there is no pavement to spend instead. If the two ever
# drift apart this audit is measuring a router the app does not have.
WALKAUDIT_LINK_COST_MULT = 4.0
# Ground classes that are a hard surface a person walks on, in the order a
# sample is credited to them when two overlap. `patharea` first because that is
# the answer the goal is phrased in: a drawn footway/steps/mall slab.
WALKAUDIT_PAVED = ["patharea", "pathslab", "cyclearea", "plaza", "roadarea"]
WALKAUDIT_GRID_M = 25.0      # spatial index cell; only affects speed


def _wa_paved_polys():
    """Every hard-surface polygon in the file just baked, in local metres."""
    with open(OUT, "r", encoding="utf-8") as fh:
        g = json.load(fh)
    out = []
    for f in g["features"]:
        p = f["properties"]
        k, u = p.get("k"), p.get("u")
        if k in ("patharea", "pathslab", "cyclearea", "roadarea"):
            lab = k
        elif k == "area" and u in ("plaza", "parking"):
            lab = "plaza"
        else:
            continue
        geom = f["geometry"]
        groups = ([geom["coordinates"]] if geom["type"] == "Polygon"
                  else geom["coordinates"] if geom["type"] == "MultiPolygon" else [])
        for poly in groups:
            rings = [[_wa_xy(c[0], c[1]) for c in r] for r in poly]
            if not rings or len(rings[0]) < 4:
                continue
            xs = [q[0] for q in rings[0]]
            ys = [q[1] for q in rings[0]]
            out.append((lab, rings, (min(xs), min(ys), max(xs), max(ys))))
    return out


def _wa_xy(lon, lat):
    # The same local frame bake_walk.py and js/wayfind.js use, so a metre here
    # is a metre there.
    return (lon * 96061.0, lat * 111195.0)


def _wa_index(polys):
    ix = {}
    for i, (_, _, bb) in enumerate(polys):
        for cx in range(int(bb[0] // WALKAUDIT_GRID_M), int(bb[2] // WALKAUDIT_GRID_M) + 1):
            for cy in range(int(bb[1] // WALKAUDIT_GRID_M), int(bb[3] // WALKAUDIT_GRID_M) + 1):
                ix.setdefault((cx, cy), []).append(i)
    return ix


def _wa_in_ring(ring, px, py):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > py) != (yj > py):
            if px < (xj - xi) * (py - yi) / (yj - yi) + xi:
                inside = not inside
        j = i
    return inside


def _wa_under(polys, ix, px, py):
    best = None
    for i in ix.get((int(px // WALKAUDIT_GRID_M), int(py // WALKAUDIT_GRID_M)), ()):
        lab, rings, bb = polys[i]
        if px < bb[0] or px > bb[2] or py < bb[1] or py > bb[3]:
            continue
        if not _wa_in_ring(rings[0], px, py):
            continue
        if any(_wa_in_ring(r, px, py) for r in rings[1:]):
            continue
        if best is None or WALKAUDIT_PAVED.index(lab) < WALKAUDIT_PAVED.index(best):
            best = lab
    return best


# ── the router, copied from js/wayfind.js and checked against it ────────────
# Verified 2026-08-23 against a browser dump of window.wayfindRoute over all
# twenty pairs: every distance agreed to within 0.5 m, and the drawn vertex
# lists were identical. If this ever disagrees with the app, the app is right
# and this is stale.

def _wa_load_graph():
    import heapq  # noqa: F401  (used by _wa_dijkstra)
    with open(os.path.join(ROOT, "data", "walk_graph.json"), "r", encoding="utf-8") as fh:
        g = json.load(fh)
    q = g["q"]
    n = len(g["n"]["x"])
    e = len(g["e"]["a"])
    X = [0.0] * n
    Y = [0.0] * n
    ax = ay = 0
    for i in range(n):
        ax += g["n"]["x"][i]
        ay += g["n"]["y"][i]
        X[i] = ax * q
        Y[i] = ay * q
    A = [0] * e
    B = [0] * e
    a = 0
    for i in range(e):
        a += g["e"]["a"][i]
        A[i] = a
        B[i] = a + g["e"]["b"][i]
    adj = [[] for _ in range(n)]
    for i in range(e):
        adj[A[i]].append((B[i], i))
        adj[B[i]].append((A[i], i))
    sw = {}
    for i in range(e):
        if g["e"]["s"][i] >= 0:
            sw[g["e"]["s"][i]] = sw.get(g["e"]["s"][i], 0) + 1
    return dict(raw=g, N=n, X=X, Y=Y, W=g["e"]["w"], F=g["e"]["f"],
                S=g["e"]["s"], adj=adj, sw=sw, q=q, doors=g["d"],
                code=g["code"], name=g["name"], wc=g["wc"], tune=g["tune"])


_WA_STEPS, _WA_CROSS = 1, 2
_WA_OFFMAIN = 128


def _wa_cost(G, i):
    m = G["W"][i] / 100.0
    t = G["tune"]
    if G["F"][i] & _WA_STEPS:
        n = G["sw"].get(G["S"][i], 1)
        return (m * (t["WALK_SPEED_LOW_MS"] / t["STAIR_SPEED_MPS"])
                + (t["STAIR_FIXED_S"] * t["WALK_SPEED_LOW_MS"]) / n)
    c = m
    if G["F"][i] & _WA_CROSS:
        c += t["CROSSING_PENALTY_M"]
    return c


def _wa_dijkstra(G, seeds, targets):
    import heapq
    INF = float("inf")
    dist = [INF] * G["N"]
    prevE = [-1] * G["N"]
    prevN = [-1] * G["N"]
    seedOf = [-1] * G["N"]
    tmap = {}
    for t in targets:
        p = tmap.get(t[0])
        if p is None or t[1] < p[1]:
            tmap[t[0]] = t
    h = []
    for k, s in enumerate(seeds):
        if s[1] < dist[s[0]]:
            dist[s[0]] = s[1]
            seedOf[s[0]] = k
            heapq.heappush(h, (s[1], s[0]))
    best = None
    left = len(tmap)
    while h:
        d, u = heapq.heappop(h)
        if d > dist[u]:
            continue
        if best and d > best[0]:
            break
        if u in tmap:
            t = tmap.pop(u)
            if best is None or d + t[1] < best[0]:
                best = (d + t[1], u, t)
            left -= 1
            if not left:
                break
        for v, ei in G["adj"][u]:
            if G["F"][ei] & _WA_OFFMAIN:
                continue
            nd = d + _wa_cost(G, ei)
            if nd < dist[v]:
                dist[v] = nd
                prevE[v] = ei
                prevN[v] = u
                seedOf[v] = seedOf[u]
                heapq.heappush(h, (nd, v))
    if best is None:
        return None
    nodes = [best[1]]
    n = best[1]
    while prevE[n] != -1:
        n = prevN[n]
        nodes.append(n)
    nodes.reverse()
    return nodes, seeds[seedOf[best[1]]], best[2]


def _wa_doors(G, key):
    """The same rule js/wayfind.js's doorSet() uses: a main door if there is
    one, every attached door otherwise."""
    if key in G["code"]:
        ds = G["code"][key]
    elif key in G["wc"]:
        ds = G["wc"][key]
    else:
        ds = G["code"].get(G["name"].get(key.lower(), ""), None)
    if not ds:
        return []
    ds = [d for d in ds if G["doors"][d][2]]
    mains = [d for d in ds if G["doors"][d][4] == "main"]
    return mains or ds


def _wa_route(G, a_key, b_key):
    def anchors(ds):
        out = []
        for di in ds:
            d = G["doors"][di]
            for k in range(len(d[2])):
                # The routing cost of a door link is its TRUE metres times
                # WALKAUDIT_LINK_COST_MULT -- js/wayfind.js's `anchors()` does
                # exactly this and Dijkstra spends the penalised number while
                # every printed distance keeps the true one. The two constants
                # must stay equal or this audit stops describing the app.
                out.append((d[2][k], d[3][k] / 100.0 * WALKAUDIT_LINK_COST_MULT, di))
        return out
    A, B = _wa_doors(G, a_key), _wa_doors(G, b_key)
    if not A or not B:
        return None
    r = _wa_dijkstra(G, anchors(A), anchors(B))
    if not r:
        return None
    nodes, seed, target = r
    line = []
    for n in nodes:
        p = (G["X"][n], G["Y"][n])
        if not line or line[-1] != p:
            line.append(p)
    q = G["q"]
    da = (G["doors"][seed[2]][0] * q, G["doors"][seed[2]][1] * q)
    db = (G["doors"][target[2]][0] * q, G["doors"][target[2]][1] * q)
    return dict(line=line, legs=[[da, line[0]], [line[-1], db]])


# ── --where: WHAT KIND of miss is a bare metre? ────────────────────────────
#
# "4.08 % of the ribbon is over bare ground" does not say whether the scene is
# missing a sidewalk or missing a hem, and those want completely different
# fixes. This bins every bare sample by its distance to the nearest paved
# polygon and names the polygon whose EDGE it is riding.
#
# The reading that produced PEDESTRIAN_RIM_IS_A_WALK, 2026-08-24, before it:
#
#   <5cm 395.8   <15cm 15.5   <30cm 3.1   <60cm 8.1   <1.2m 17.7   ...   >=10m 0.0
#   88 % of it on the boundary of a ('patharea','pedestrian')
#
# A missing sidewalk would have put metres in the far buckets. Not one metre of
# the walking graph is more than 5 m from pavement anywhere in the twenty
# routes, which is why this round painted a hem instead of hunting for a path.
WALKAUDIT_WHERE_BUCKETS = [0.05, 0.15, 0.30, 0.60, 1.20, 2.40, 5.0, 10.0, 1e9]
WALKAUDIT_WHERE_NAMES = ["<5cm", "<15cm", "<30cm", "<60cm", "<1.2m",
                         "<2.4m", "<5m", "<10m", ">=10m"]
# Half the drawn ribbon's width, `WAYFIND.routeWidthM` / 2 in js/wayfind.js.
# A centreline exactly on a seam is a coin flip; the RAILS are what a person
# sees hanging off the pavement, so --where grades those too.
WALKAUDIT_RIBBON_HALF_M = 0.8


def _wa_where(polys, ix, G, pairs):
    """The bucket table. Needs shapely; returns None without it."""
    try:
        from shapely.geometry import Polygon, Point
        from shapely.strtree import STRtree
    except ImportError:
        print("  (--where needs shapely)")
        return None
    shp, lab = [], []
    for k_u, rings, _bb in polys:
        try:
            q = Polygon(rings[0], rings[1:])
            if not q.is_valid:
                q = q.buffer(0)
            if q.is_empty:
                continue
        except Exception:
            continue
        shp.append(q)
        lab.append(k_u)
    tree = STRtree(shp)

    buck = Counter()
    owner = Counter()
    rail_off = rail_tot = 0.0
    for a, b in pairs:
        r = _wa_route(G, a, b)
        if r is None:
            continue
        for kind, co in [("path", r["line"])] + [("leg", L) for L in r["legs"]]:
            for i in range(len(co) - 1):
                ax, ay = _wa_xy(*co[i])
                bx, by = _wa_xy(*co[i + 1])
                L = math.hypot(bx - ax, by - ay)
                if L <= 0.001:
                    continue
                nx, ny = -(by - ay) / L, (bx - ax) / L
                n = max(1, int(round(L / WALKAUDIT_SAMPLE_M)))
                step = L / n
                for s in range(n):
                    t = (s + 0.5) / n
                    px, py = ax + (bx - ax) * t, ay + (by - ay) * t
                    for off in (-WALKAUDIT_RIBBON_HALF_M, WALKAUDIT_RIBBON_HALF_M):
                        rail_tot += step
                        if _wa_under(polys, ix, px + nx * off, py + ny * off) is None:
                            rail_off += step
                    if _wa_under(polys, ix, px, py) is not None:
                        continue
                    pt = Point(px, py)
                    cand = list(tree.query(pt.buffer(12.0)))
                    d = min([shp[j].distance(pt) for j in cand], default=1e9)
                    for k, lim in enumerate(WALKAUDIT_WHERE_BUCKETS):
                        if d < lim:
                            buck[(kind, WALKAUDIT_WHERE_NAMES[k])] += step
                            break
                    if kind == "path" and cand and d < 1.2:
                        j = min(cand, key=lambda j: shp[j].distance(pt))
                        owner[lab[j]] += step

    print("")
    print("  WHERE THE BARE METRES ARE — distance to the nearest paved polygon")
    print("  %-10s %10s %10s" % ("bucket", "graph m", "doorleg m"))
    gs = ls = 0.0
    for nm in WALKAUDIT_WHERE_NAMES:
        g, l = buck[("path", nm)], buck[("leg", nm)]
        gs += g
        ls += l
        if g or l:
            print("  %-10s %10.1f %10.1f" % (nm, g, l))
    print("  %-10s %10.1f %10.1f" % ("", gs, ls))
    near = sum(buck[("path", nm)] for nm in WALKAUDIT_WHERE_NAMES[:5])
    print("  seam (graph metres within 1.2 m of pavement)   %.1f of %.1f = %.0f %%"
          % (near, gs, 100.0 * near / gs if gs else 0.0))
    print("  whose edge is the seam on:")
    for kv, v in owner.most_common(8):
        print("     %-26s %7.1f m" % (str(kv), v))
    print("  RIBBON RAILS at +/- %.1f m off pavement   %.2f %%   (%.0f of %.0f m)"
          % (WALKAUDIT_RIBBON_HALF_M, 100.0 * rail_off / rail_tot if rail_tot else 0.0,
             rail_off, rail_tot))
    return True


# ── --prov: IS THIS METRE A REAL OSM FEATURE, OR DID WE INVENT IT? ─────────
#
# The pavement table above answers "is there paving under the ribbon". This
# answers the OTHER half of the goal, and they are not the same question: a
# metre can be over beautiful concrete and still be a line this project made up
# (a door link across a plaza), and a metre can be over bare ground and still be
# a surveyed OSM footway (a path nobody has drawn paint for yet). Round 3 closed
# the paint half to 99.03 %. Nothing had ever measured the provenance half PER
# ROUTE, which is the number the goal is actually phrased in.
#
# HOW IT DECIDES, and why it is not a guess. scripts/bake_walk.py's build_raw()
# ingests every way in data/osm_cache/footways.json and emits one graph edge per
# consecutive OSM NODE PAIR; road_access() does the same for the walkable
# classes of data/osm_cache/roads.json. So every honest graph edge is either a
# whole OSM segment or -- after the 578 anchor splits -- a sub-piece of one,
# and in both cases it lies exactly on that way's polyline. This walks the drawn
# ribbon at WALKAUDIT_SAMPLE_M and asks, for each sample, whether some OSM
# segment running the SAME WAY (within WALKAUDIT_PROV_BEARING_DEG) passes within
# WALKAUDIT_PROV_TOL_M of it. The tolerance is three times the 0.11 m the graph's
# q=1e-6 quantiser can move a node, and nothing else in the pipeline moves one.
#
# The bearing gate is what makes the answer mean something. Without it a straight
# invented leg gets credited the instant it TOUCHES a sidewalk it is crossing;
# with it, a metre only counts as a footway if it is running ALONG one.
WALKAUDIT_PROV_TOL_M = 0.30
WALKAUDIT_PROV_BEARING_DEG = 20.0
# The walkable road classes, mirroring scripts/bake_walk.py's ROAD_WALKABLE.
# Those legs are real surveyed OSM ways -- they are simply not footways, so they
# get their own column rather than being lumped in with either side.
WALKAUDIT_PROV_ROAD_WALKABLE = ("service", "residential", "living_street",
                                "unclassified")
# highway= values that count as "an actual footway feature". This is the whole
# set bake_walk.py routes on, not a hand-picked subset.
WALKAUDIT_PROV_FOOT = ("footway", "steps", "path", "pedestrian", "corridor",
                       "cycleway", "track", "elevator")
# Which label wins when two real ways both run under a sample.
WALKAUDIT_PROV_RANK = ("foot", "road", "other")


def _wa_prov_segments():
    """Every OSM way segment a route could legitimately be running along, in
    local metres, as (x1, y1, x2, y2, class)."""
    segs = []

    def eat(elements, road_only):
        for w in elements:
            if w.get("type") != "way":
                continue
            g = w.get("geometry") or []
            if len(g) < 2:
                continue
            hw = (w.get("tags", {}) or {}).get("highway", "")
            if road_only:
                if hw not in WALKAUDIT_PROV_ROAD_WALKABLE:
                    continue
                cls = "road"
            else:
                cls = "foot" if hw in WALKAUDIT_PROV_FOOT else "other"
            pts = [_wa_xy(c["lon"], c["lat"]) for c in g]
            for i in range(len(pts) - 1):
                (x1, y1), (x2, y2) = pts[i], pts[i + 1]
                if x1 == x2 and y1 == y2:
                    continue
                segs.append((x1, y1, x2, y2, cls))

    eat(load("footways"), False)
    eat(load("roads"), True)
    return segs


def _wa_prov_index(segs):
    ix = {}
    g = WALKAUDIT_GRID_M
    pad = WALKAUDIT_PROV_TOL_M
    for i, (x1, y1, x2, y2, _c) in enumerate(segs):
        for cx in range(int((min(x1, x2) - pad) // g), int((max(x1, x2) + pad) // g) + 1):
            for cy in range(int((min(y1, y2) - pad) // g), int((max(y1, y2) + pad) // g) + 1):
                ix.setdefault((cx, cy), []).append(i)
    return ix


def _wa_seg_dist(px, py, x1, y1, x2, y2):
    dx, dy = x2 - x1, y2 - y1
    L2 = dx * dx + dy * dy
    if L2 <= 0.0:
        return math.hypot(px - x1, py - y1)
    t = ((px - x1) * dx + (py - y1) * dy) / L2
    t = 0.0 if t < 0.0 else (1.0 if t > 1.0 else t)
    return math.hypot(px - (x1 + dx * t), py - (y1 + dy * t))


def _wa_prov_at(segs, ix, px, py, ux, uy):
    """Which class of real OSM way is this sample running along, or None.
    (ux, uy) is the drawn segment's unit direction; a way pointing some other
    way is not the thing this metre is on."""
    g = WALKAUDIT_GRID_M
    cosmin = math.cos(math.radians(WALKAUDIT_PROV_BEARING_DEG))
    best = None
    for i in ix.get((int(px // g), int(py // g)), ()):
        x1, y1, x2, y2, cls = segs[i]
        sx, sy = x2 - x1, y2 - y1
        sl = math.hypot(sx, sy)
        if sl <= 0.0:
            continue
        if abs((sx * ux + sy * uy) / sl) < cosmin:
            continue
        if _wa_seg_dist(px, py, x1, y1, x2, y2) > WALKAUDIT_PROV_TOL_M:
            continue
        # foot beats road beats other, so a sidewalk laid beside a service road
        # is reported as the sidewalk it is. Any class this ladder does not name
        # (--coverage indexes graph EDGES through here, labelled 'edge') simply
        # answers the yes/no question and never competes for the label.
        rank = WALKAUDIT_PROV_RANK
        if best is None or rank.index(cls if cls in rank else rank[-1]) < rank.index(best if best in rank else rank[-1]):
            best = cls
    return best


def _wa_prov(G, pairs):
    """Per-route: how much of the drawn ribbon is a real OSM feature."""
    segs = _wa_prov_segments()
    ix = _wa_prov_index(segs)
    print("")
    print("  PROVENANCE — REAL OSM FEATURE vs INVENTED EDGE")
    print("  %d OSM way segments (footways.json + walkable roads.json), "
          "tolerance %.2f m, bearing %.0f deg"
          % (len(segs), WALKAUDIT_PROV_TOL_M, WALKAUDIT_PROV_BEARING_DEG))
    print("")
    print("  %-22s %8s | %7s %6s | %8s %8s"
          % ("pair", "drawn m", "footway", "road", "INVENT m", "INVENT %"))

    tot = Counter()
    tot_len = 0.0
    rows = []
    for a, b in pairs:
        r = _wa_route(G, a, b)
        if r is None:
            continue
        c = Counter()
        drawn = 0.0
        for kind, co in [("path", r["line"])] + [("leg", L) for L in r["legs"]]:
            for i in range(len(co) - 1):
                ax, ay = _wa_xy(*co[i])
                bx, by = _wa_xy(*co[i + 1])
                L = math.hypot(bx - ax, by - ay)
                if L <= 0.001:
                    continue
                ux, uy = (bx - ax) / L, (by - ay) / L
                n = max(1, int(round(L / WALKAUDIT_SAMPLE_M)))
                step = L / n
                for s in range(n):
                    t = (s + 0.5) / n
                    cls = _wa_prov_at(segs, ix, ax + (bx - ax) * t,
                                      ay + (by - ay) * t, ux, uy)
                    if cls is None:
                        cls = "invent_leg" if kind == "leg" else "invent_graph"
                    c[cls] += step
                    drawn += step
        tot.update(c)
        tot_len += drawn
        inv = c["invent_leg"] + c["invent_graph"]
        rows.append((a + ">" + b, drawn,
                     100.0 * c["foot"] / drawn if drawn else 0.0,
                     100.0 * c["road"] / drawn if drawn else 0.0,
                     inv, 100.0 * inv / drawn if drawn else 0.0))
        print("  %-22s %8.0f | %6.1f%% %5.1f%% | %8.1f %7.1f%%" % rows[-1])

    def T(*k):
        return 100.0 * sum(tot[x] for x in k) / tot_len if tot_len else 0.0
    inv = tot["invent_leg"] + tot["invent_graph"]
    print("")
    print("  %-22s %8.0f | %6.1f%% %5.1f%% | %8.1f %7.1f%%"
          % ("ALL, weighted", tot_len, T("foot"), T("road"), inv, T("invent_leg", "invent_graph")))
    print("")
    print("  ON A REAL OSM FOOTWAY FEATURE   %6.2f %%" % T("foot"))
    print("  ON ANY REAL OSM WAY             %6.2f %%" % T("foot", "road", "other"))
    print("  INVENTED                        %6.2f %%   (%.0f m)"
          % (T("invent_leg", "invent_graph"), inv))
    print("     of which door legs           %8.0f m" % tot["invent_leg"])
    print("     of which inside the graph    %8.0f m" % tot["invent_graph"])
    print("")
    print("  MEAN PER-ROUTE footway share    %6.2f %%   (unweighted, %d routes)"
          % (sum(r[2] for r in rows) / len(rows) if rows else 0.0, len(rows)))
    print("  WORST ROUTE                     %6.2f %% invented   (%s)"
          % max(((r[5], r[0]) for r in rows), default=(0.0, "-")))
    print("  routes at or above %.0f %% real   %d of %d"
          % (WALKAUDIT_PROV_PASS_PCT,
             sum(1 for r in rows if 100.0 - r[5] >= WALKAUDIT_PROV_PASS_PCT), len(rows)))
    for nm, dr, ft, rd, im, ip in sorted(rows, key=lambda r: -r[5])[:5]:
        print("    worst: %-22s %6.1f %% invented  (%.0f m of %.0f)" % (nm, ip, im, dr))
    return rows


# The bar this lane holds itself to per route, not just in the weighted mean:
# a route where more than one metre in twenty is a line nobody surveyed is a
# route this feature should not be drawing with a straight face.
WALKAUDIT_PROV_PASS_PCT = 95.0


# ── --coverage: THE OTHER DIRECTION — IS EVERY SIDEWALK USABLE? ────────────
#
# --prov walks the ROUTE and asks what it is standing on. That can read 98.5 %
# while the router is quietly ignoring half the sidewalks on campus, because a
# route can only be graded on the ground it actually visits. The brief's actual
# sentence is the other direction — "so many sidewalks are not being utilized
# properly... at least make sure existing sidewalks are identified properly and
# used to the advantage" — and answering it means walking the SIDEWALKS and
# asking whether each one is (a) painted in this scene and (b) reachable by the
# router at all.
#
# The cell that matters is PAINTED BUT NOT ROUTABLE: a sidewalk a student can
# see in the 3D city and the router will never send them down. Those are not
# missing data. They are drawn, they are surveyed, and they are switched off.
WALKAUDIT_COV_TOL_M = 0.30           # same gate as --prov
WALKAUDIT_COV_MIN_RUN_M = 8.0        # report runs at least this long


def _wa_graph_segments(G, main_only):
    """Every walking-graph edge as (x1,y1,x2,y2), in local metres.
    `main_only` drops the edges dijkstra() refuses to traverse (F 128)."""
    out = []
    # rebuild A/B the same way _wa_load_graph did
    g = G["raw"]
    e = len(g["e"]["a"])
    a = 0
    for i in range(e):
        a += g["e"]["a"][i]
        b = a + g["e"]["b"][i]
        if main_only and (G["F"][i] & _WA_OFFMAIN):
            continue
        x1, y1 = _wa_xy(G["X"][a], G["Y"][a])
        x2, y2 = _wa_xy(G["X"][b], G["Y"][b])
        if x1 == x2 and y1 == y2:
            continue
        out.append((x1, y1, x2, y2, "edge"))
    return out


def _wa_coverage(G, polys, ix_paved):
    """Walk every OSM footway on campus and grade it: painted? routable?"""
    foot = [s for s in _wa_prov_segments() if s[4] == "foot"]
    routable = _wa_graph_segments(G, True)
    all_edges = _wa_graph_segments(G, False)
    ix_r = _wa_prov_index(routable)
    ix_a = _wa_prov_index(all_edges)
    # Where the DEAD sidewalk is, not just how much of it. A number without a
    # place cannot become a queue item, and this one is not this lane's to fix.
    dead = []          # (metres, x, y) samples of painted-but-unroutable
    unpainted = []     # (metres, x, y) samples of routable-but-unpainted

    cell = Counter()
    for (x1, y1, x2, y2, _c) in foot:
        L = math.hypot(x2 - x1, y2 - y1)
        if L <= 0.001:
            continue
        ux, uy = (x2 - x1) / L, (y2 - y1) / L
        n = max(1, int(round(L / WALKAUDIT_SAMPLE_M)))
        step = L / n
        for s in range(n):
            t = (s + 0.5) / n
            px, py = x1 + (x2 - x1) * t, y1 + (y2 - y1) * t
            paint = _wa_under(polys, ix_paved, px, py) is not None
            rout = _wa_prov_at(routable, ix_r, px, py, ux, uy) is not None
            ingraph = _wa_prov_at(all_edges, ix_a, px, py, ux, uy) is not None
            cell[(paint, rout, ingraph)] += step
            if paint and not rout:
                dead.append((step, px, py))
            elif rout and not paint:
                unpainted.append((step, px, py))

    tot = sum(cell.values())

    def S(paint=None, rout=None, ingraph=None):
        return sum(v for k, v in cell.items()
                   if (paint is None or k[0] == paint)
                   and (rout is None or k[1] == rout)
                   and (ingraph is None or k[2] == ingraph))

    print("")
    print("  SIDEWALK COVERAGE — every OSM footway on campus, not just the routes")
    print("  %.2f km of surveyed footway in data/osm_cache/footways.json" % (tot / 1000.0))
    print("")
    print("  %-42s %9s %7s" % ("", "km", "share"))
    print("  %-42s %9.2f %6.1f%%" % ("painted in this scene", S(paint=True) / 1000.0,
                                     100.0 * S(paint=True) / tot))
    print("  %-42s %9.2f %6.1f%%" % ("in the walking graph at all", S(ingraph=True) / 1000.0,
                                     100.0 * S(ingraph=True) / tot))
    print("  %-42s %9.2f %6.1f%%" % ("ROUTABLE (graph, main component)", S(rout=True) / 1000.0,
                                     100.0 * S(rout=True) / tot))
    print("")
    print("  %-42s %9.2f %6.1f%%" % ("PAINTED BUT NOT ROUTABLE",
                                     S(paint=True, rout=False) / 1000.0,
                                     100.0 * S(paint=True, rout=False) / tot))
    print("  %-42s %9.2f %6.1f%%" % ("   ...of which in the graph but off-main",
                                     S(paint=True, rout=False, ingraph=True) / 1000.0,
                                     100.0 * S(paint=True, rout=False, ingraph=True) / tot))
    print("  %-42s %9.2f %6.1f%%" % ("   ...of which not in the graph at all",
                                     S(paint=True, rout=False, ingraph=False) / 1000.0,
                                     100.0 * S(paint=True, rout=False, ingraph=False) / tot))
    print("  %-42s %9.2f %6.1f%%" % ("ROUTABLE BUT NOT PAINTED",
                                     S(paint=False, rout=True) / 1000.0,
                                     100.0 * S(paint=False, rout=True) / tot))
    _wa_clusters("DEAD SIDEWALK — painted, surveyed, and unroutable", dead, G)
    # The unpainted set is graded at a much smaller grain on purpose: this is
    # the half that IS this lane's file, so "no run big enough to see" has to be
    # a measurement rather than a threshold that hid it.
    _wa_clusters("ROUTABLE BUT UNPAINTED — this lane's own file", unpainted, G,
                 min_m=WALKAUDIT_CLUSTER_MIN_OWN_M)
    return cell


# A cluster is every sample within this of another one. 40 m keeps one stranded
# courtyard together and does not glue two neighbouring ones into one row.
WALKAUDIT_CLUSTER_M = 40.0
WALKAUDIT_CLUSTER_MIN_M = 60.0     # rows shorter than this are not worth a name
WALKAUDIT_CLUSTER_MIN_OWN_M = 10.0  # …but grade THIS lane's own file finely
WALKAUDIT_CLUSTER_SHOW = 10


def _wa_clusters(title, samples, G, min_m=None):
    """Group loose samples into places and name each by its nearest door."""
    if min_m is None:
        min_m = WALKAUDIT_CLUSTER_MIN_M
    if not samples:
        print("")
        print("  %s — nothing" % title)
        return
    g = WALKAUDIT_CLUSTER_M
    cellmap = {}
    for i, (m, x, y) in enumerate(samples):
        cellmap.setdefault((int(x // g), int(y // g)), []).append(i)
    seen = [False] * len(samples)
    groups = []
    for key in list(cellmap):
        for i in cellmap[key]:
            if seen[i]:
                continue
            stack, members = [i], []
            seen[i] = True
            while stack:
                j = stack.pop()
                members.append(j)
                _m, jx, jy = samples[j]
                cx, cy = int(jx // g), int(jy // g)
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        for k in cellmap.get((cx + dx, cy + dy), ()):
                            if not seen[k]:
                                seen[k] = True
                                stack.append(k)
            groups.append(members)

    q = G["q"]
    doors = [(d[0] * q, d[1] * q, d[7]) for d in G["doors"] if d[7]]
    rows = []
    for mem in groups:
        L = sum(samples[j][0] for j in mem)
        if L < min_m:
            continue
        cx = sum(samples[j][1] for j in mem) / len(mem)
        cy = sum(samples[j][2] for j in mem) / len(mem)
        lon, lat = cx / 96061.0, cy / 111195.0
        near, nd = "", 1e9
        for dl, dt, nm in doors:
            dx, dy = _wa_xy(dl, dt)
            d = math.hypot(dx - cx, dy - cy)
            if d < nd:
                nd, near = d, nm
        rows.append((L, lon, lat, near, nd))
    rows.sort(reverse=True)
    print("")
    print("  %s — %d places over %.0f m, %.2f km of the total"
          % (title, len(rows), min_m, sum(r[0] for r in rows) / 1000.0))
    for L, lon, lat, near, nd in rows[:WALKAUDIT_CLUSTER_SHOW]:
        print("    %7.0f m  %.5f,%.5f   nearest door: %s (%.0f m)"
              % (L, lon, lat, near[:44], nd))


# ── --surfaces: WHAT IS PAINTED UNDER EVERY SURVEYED SIDEWALK? ─────────────
#
# --coverage grades a sidewalk metre as "painted" if ANY hard surface is under
# it, and WALKAUDIT_PAVED includes `roadarea`. That is the right test for "is
# there a hole in the ground file" and the wrong one for "is this sidewalk drawn
# as a sidewalk": a surveyed walk with asphalt under it reads as covered, and
# the walking ribbon standing on it floats 22 cm (WAYFIND.routeBaseM is pinned
# to GROUND.pathRaise, and a road is a flat fill at zero).
#
# So this splits the same 160.78 km two ways: by whether the OSM way is a
# CROSSING — where carriageway paint is correct and deliberate, see
# CROSSING_APRON_M — and by what is actually drawn under it. The cell that
# matters is ALONGSIDE x roadarea: a non-crossing sidewalk painted as street.
def _wa_surfaces(polys, ix):
    cell = Counter()
    runs = []
    for w in load("footways"):
        if w.get("type") != "way":
            continue
        geo = w.get("geometry") or []
        if len(geo) < 2:
            continue
        t = w.get("tags", {}) or {}
        if t.get("highway", "") not in WALKAUDIT_PROV_FOOT:
            continue
        # the same test main() uses to decide whether to emit aprons instead of
        # a path, plus the cycleway spelling widen_roads' loop uses
        is_x = (t.get("footway") == "crossing" or t.get("cycleway") == "crossing"
                or t.get("crossing") is not None)
        kind = "crossing" if is_x else "alongside"
        pts = [_wa_xy(c["lon"], c["lat"]) for c in geo]
        for i in range(len(pts) - 1):
            (x1, y1), (x2, y2) = pts[i], pts[i + 1]
            L = math.hypot(x2 - x1, y2 - y1)
            if L <= 0.001:
                continue
            n = max(1, int(round(L / WALKAUDIT_SAMPLE_M)))
            step = L / n
            for s in range(n):
                u = (s + 0.5) / n
                px, py = x1 + (x2 - x1) * u, y1 + (y2 - y1) * u
                lab = _wa_under(polys, ix, px, py) or "BARE"
                cell[(kind, lab)] += step
                if kind == "alongside" and lab in ("roadarea", "cyclearea"):
                    runs.append((step, px, py))

    tot = sum(cell.values())
    print("")
    print("  WHAT IS PAINTED UNDER EVERY SURVEYED SIDEWALK")
    print("  %.2f km of surveyed footway, sampled every %.1f m"
          % (tot / 1000.0, WALKAUDIT_SAMPLE_M))
    for kind in ("alongside", "crossing"):
        sub = {k[1]: v for k, v in cell.items() if k[0] == kind}
        st = sum(sub.values())
        if not st:
            continue
        print("")
        print("  %-12s %8.2f km" % (kind.upper(), st / 1000.0))
        for k, v in sorted(sub.items(), key=lambda kv: -kv[1]):
            print("      %-12s %8.2f km  %5.1f%%" % (k, v / 1000.0, 100.0 * v / st))
    print("")
    # Split, because the two are not the same defect. A carriageway is a STREET
    # and a sidewalk drawn as one is wrong. A `cyclearea` is a drawn cycleway out
    # of data/roads.geojson, and a footway sharing ground with one is usually a
    # genuine shared-use path -- it is not a cutter here and this change does not
    # touch it, so it is reported separately rather than folded into the headline.
    print("  SURVEYED NON-CROSSING SIDEWALK PAINTED AS CARRIAGEWAY  %.2f km"
          % (cell[("alongside", "roadarea")] / 1000.0))
    print("  ...and as a drawn cycleway (shared path, not this change)  %.2f km"
          % (cell[("alongside", "cyclearea")] / 1000.0))
    print("  (SIDEWALK_KEEP_HALF_M = %.2f m)" % SIDEWALK_KEEP_HALF_M)
    return cell


# ── --islands: CAN THE STRANDED SIDEWALKS BE HONESTLY RECONNECTED? ─────────
#
# --coverage found 5.75 km of painted, surveyed, unroutable sidewalk and §21 of
# docs/walk-sidewalks.md asked the bake_walk lane to close the gaps: "a rule
# that closed gaps up to ~3 m would reconnect 175 m". THAT REQUEST WAS WRONG and
# this is the instrument that says so. A gap distance cannot tell an unmapped
# CONNECTION from an unmapped ROAD CROSSING, and the scene already knows which
# is which — it paints the ground. So classify every candidate connector by what
# is drawn under it, and only a connector that runs entirely on pedestrian
# pavement is a topology artefact this project may repair.
WALKAUDIT_ISLAND_MAX_GAP_M = 20.0     # candidates wider than this are not close
WALKAUDIT_ISLAND_MIN_RUN_M = 8.0      # components shorter than this are noise
WALKAUDIT_ISLAND_STEP_M = 0.25        # sampling along the connector


def _wa_islands(G, polys, ix):
    g = G["raw"]
    e = len(g["e"]["a"])
    A = [0] * e
    B = [0] * e
    a = 0
    for i in range(e):
        a += g["e"]["a"][i]
        A[i] = a
        B[i] = a + g["e"]["b"][i]
    N = G["N"]
    PX = [0.0] * N
    PY = [0.0] * N
    for i in range(N):
        PX[i], PY[i] = _wa_xy(G["X"][i], G["Y"][i])

    par = list(range(N))

    def find(x):
        while par[x] != x:
            par[x] = par[par[x]]
            x = par[x]
        return x

    off = [i for i in range(e) if G["F"][i] & _WA_OFFMAIN]
    for i in off:
        rx, ry = find(A[i]), find(B[i])
        if rx != ry:
            par[rx] = ry
    is_main = [False] * N
    for i in range(e):
        if not (G["F"][i] & _WA_OFFMAIN):
            is_main[A[i]] = True
            is_main[B[i]] = True

    grid = WALKAUDIT_GRID_M
    mix = {}
    for i in range(N):
        if is_main[i]:
            mix.setdefault((int(PX[i] // grid), int(PY[i] // grid)), []).append(i)

    def nearest_main(n):
        c = int(WALKAUDIT_ISLAND_MAX_GAP_M // grid) + 1
        cx, cy = int(PX[n] // grid), int(PY[n] // grid)
        best = (1e18, -1)
        for dx in range(-c, c + 1):
            for dy in range(-c, c + 1):
                for m in mix.get((cx + dx, cy + dy), ()):
                    d = math.hypot(PX[n] - PX[m], PY[n] - PY[m])
                    if d < best[0]:
                        best = (d, m)
        return best

    comp = {}
    for i in off:
        comp.setdefault(find(A[i]), []).append(i)

    rows = []
    for root, eds in comp.items():
        L = sum(G["W"][i] for i in eds) / 100.0
        if L < WALKAUDIT_ISLAND_MIN_RUN_M:
            continue
        nodes = set()
        for i in eds:
            nodes.add(A[i])
            nodes.add(B[i])
        best = (1e18, -1, -1)
        for n in nodes:
            d, m = nearest_main(n)
            if m >= 0 and d < best[0]:
                best = (d, n, m)
        if best[1] < 0 or best[0] > WALKAUDIT_ISLAND_MAX_GAP_M:
            continue
        gap, n, m = best
        k = max(4, int(gap / WALKAUDIT_ISLAND_STEP_M) + 1)
        c = Counter()
        for s in range(k + 1):
            t = s / k
            px = PX[n] + (PX[m] - PX[n]) * t
            py = PY[n] + (PY[m] - PY[n]) * t
            c[_wa_under(polys, ix, px, py) or "BARE"] += 1.0 / (k + 1)
        rows.append((gap, L, c, G["X"][n], G["Y"][n]))

    rows.sort()
    print("")
    print("  STRANDED SIDEWALK — WHAT WOULD A STITCH HAVE TO CROSS?")
    print("  %d components of >= %.0f m within %.0f m of the network"
          % (len(rows), WALKAUDIT_ISLAND_MIN_RUN_M, WALKAUDIT_ISLAND_MAX_GAP_M))
    print("")
    print("  %7s %9s %7s %7s %7s   %s"
          % ("gap m", "island m", "walk%", "road%", "bare%", "lon,lat"))
    for gap, L, c, lon, lat in rows:
        walk = 100.0 * (c["patharea"] + c["pathslab"] + c["plaza"])
        road = 100.0 * (c["roadarea"] + c["cyclearea"])
        bare = 100.0 * c["BARE"]
        print("  %7.2f %9.1f %6.0f%% %6.0f%% %6.0f%%   %.5f,%.5f"
              % (gap, L, walk, road, bare, lon, lat))

    print("")
    print("  IF A GAP RULE WERE APPLIED AT EACH THRESHOLD")
    print("  %7s %10s %8s | %10s %8s"
          % ("gap<=", "km back", "stitches", "km on PAVING", "stitches"))
    for lim in (2.0, 3.0, 4.0, 5.0, 8.0, 12.0, 20.0):
        blind = [r for r in rows if r[0] <= lim]
        pure = [r for r in blind
                if (r[2]["patharea"] + r[2]["pathslab"] + r[2]["plaza"]) >= 0.999]
        print("  %7.1f %10.3f %8d | %10.3f %8d"
              % (lim, sum(r[1] for r in blind) / 1000.0, len(blind),
                 sum(r[1] for r in pure) / 1000.0, len(pure)))
    return rows


def walkaudit(pairs=None, where=False, prov=False, coverage=False,
              surfaces=False, islands=False):
    """Print the pavement table. Bakes nothing."""
    if not os.path.exists(OUT):
        print("no %s — run the bake first" % OUT)
        return 2
    pairs = WALKAUDIT_PAIRS if pairs is None else pairs
    polys = _wa_paved_polys()
    ix = _wa_index(polys)
    G = _wa_load_graph()

    print("PAVEMENT UNDER THE WALKING ROUTE")
    print("  ground   %s (%d hard-surface polygons)" % (os.path.basename(OUT), len(polys)))
    print("  graph    data/walk_graph.json, as of %s" % G["raw"].get("as_of", "?"))
    print("  method   %s pairs, sampled every %.1f m of drawn ribbon"
          % (len(pairs), WALKAUDIT_SAMPLE_M))
    print("")
    head = ("pair", "drawn m", "leg m", "path", "mall", "road", "other", "BARE")
    print("  %-22s %8s %7s | %6s %6s %6s %6s | %7s" % head)

    grand = Counter()
    grand_len = 0.0
    rows = []
    for a, b in pairs:
        r = _wa_route(G, a, b)
        if r is None:
            print("  %-22s   NO ROUTE" % (a + ">" + b))
            continue
        c = Counter()
        legm = 0.0
        drawn = 0.0
        parts = [("path", r["line"])] + [("leg", L) for L in r["legs"]]
        for kind, co in parts:
            for i in range(len(co) - 1):
                ax, ay = _wa_xy(*co[i])
                bx, by = _wa_xy(*co[i + 1])
                L = math.hypot(bx - ax, by - ay)
                if L <= 0.001:
                    continue
                n = max(1, int(round(L / WALKAUDIT_SAMPLE_M)))
                step = L / n
                for s in range(n):
                    t = (s + 0.5) / n
                    lab = _wa_under(polys, ix, ax + (bx - ax) * t, ay + (by - ay) * t)
                    c[lab or "BARE"] += step
                    drawn += step
                    if kind == "leg":
                        legm += step
        grand.update(c)
        grand_len += drawn

        def P(*keys):
            return 100.0 * sum(c[k] for k in keys) / drawn if drawn else 0.0
        # `patharea` is split in the report because "mall" is the answer to a
        # different question: a mall slab is a walk, but it is the one the
        # router rides the OUTLINE of rather than crossing.
        rows.append((a + ">" + b, drawn, legm, P("patharea"), P("plaza"),
                     P("roadarea"), P("pathslab", "cyclearea"), P("BARE")))
        print("  %-22s %8.0f %7.0f | %5.1f%% %5.1f%% %5.1f%% %5.1f%% | %6.1f%%" % rows[-1])

    def T(*keys):
        return 100.0 * sum(grand[k] for k in keys) / grand_len if grand_len else 0.0
    print("")
    print("  %-22s %8.0f %7s | %5.1f%% %5.1f%% %5.1f%% %5.1f%% | %6.1f%%"
          % ("ALL, weighted", grand_len, "", T("patharea"), T("plaza"),
             T("roadarea"), T("pathslab", "cyclearea"), T("BARE")))
    print("")
    print("  ON A DRAWN SURFACE        %6.2f %%" % (100.0 - T("BARE")))
    print("  ON A DRAWN WALK (path)    %6.2f %%" % T("patharea"))
    print("  OVER BARE GROUND          %6.2f %%   (%.0f m)"
          % (T("BARE"), grand["BARE"]))
    print("")
    worst = sorted(rows, key=lambda r: -r[7])[:5]
    print("  worst five:")
    for w in worst:
        print("    %-22s %6.1f %% bare" % (w[0], w[7]))
    if where:
        _wa_where(polys, ix, G, pairs)
    if prov:
        _wa_prov(G, pairs)
    if coverage:
        _wa_coverage(G, polys, ix)
    if surfaces:
        _wa_surfaces(polys, ix)
    if islands:
        _wa_islands(G, polys, ix)
    return 0


def main():
    feats = []
    stats = Counter()
    measured_w = load_measured_widths()

    # ---- paths (lines) -------------------------------------------------
    for el in load("footways"):
        if el.get("type") != "way" or not el.get("geometry"):
            continue
        t = el.get("tags", {}) or {}
        hw = t.get("highway")
        # `cycleway` used to be drawn here as a pale footpath. It now belongs to
        # roads.geojson, which knows it is bike infrastructure and draws it as
        # such. Leaving it in both files drew the same 50 ways twice, at two
        # different widths, in two different colours.
        if hw not in ("footway", "steps", "path", "pedestrian"):
            continue
        # A pedestrian AREA is a plaza, not a line — handled with the areas.
        # Its RIM is both, though: bake_walk.py puts this same closed way into
        # the walking graph as a ring of edges and routes people along it, so
        # the walk's own width gets painted here or the ribbon hangs off the
        # side of the polygon. See PEDESTRIAN_RIM_IS_A_WALK.
        #
        # EXCEPT A STAIRCASE. `highway=steps area=yes` is a stepped terrace,
        # and it was falling between two stools: skipped here as an area, and
        # never picked up by the plaza pass, which reads a different Overpass
        # query. One such way exists on campus (147362093, off Speedway by
        # Jester) and the router happily sends people up it — a staircase the
        # walk graph charges for and the city drew nowhere. It is emitted as
        # the polygon it is; widen_paths takes it un-buffered.
        #
        # INTEGRATION NOTE (acer/w-integrate): acer/w-sidewalks and
        # acer/w-stairs both rewrote this one branch, and they do NOT
        # contradict each other — they key on different `highway` values. A
        # closed `highway=pedestrian` way is a mall whose RIM is a walk; a
        # closed `highway=steps` way is a stepped terrace that must be drawn
        # as a polygon. Both arms are kept, and anything that is neither still
        # falls through to `skipped_area_way` exactly as it did on main.
        if t.get("area") == "yes":
            coords = [[round(p["lon"], 6), round(p["lat"], 6)] for p in el["geometry"]]
            if (PEDESTRIAN_RIM_IS_A_WALK and hw == "pedestrian"
                    and len(coords) > 3 and coords[0] == coords[-1]):
                feats.append({
                    "type": "Feature",
                    "geometry": {"type": "LineString", "coordinates": coords},
                    "properties": {
                        "k": "path", "u": "footway",
                        # the mall's OWN surface, so the hem is the mall's own
                        # colour rather than a ring of a different concrete
                        "s": surface_of(t, "pedestrian")[0],
                        "w": PEDESTRIAN_RIM_WALK_M, "wt": 0,
                        # derived from a mall outline, not a surveyed walk
                        # centreline: the carriageway cut still applies to it,
                        # which is the third of the three things §13 of
                        # docs/walk-sidewalks.md says makes the rim safe.
                        DERIVED_PATH_KEY: 1,
                    },
                })
                stats["pedestrian_rim_walk"] += 1
            elif hw == "steps":
                r = ring_of(el.get("geometry"))
                if not r:
                    stats["steps_area_unringed"] += 1
                else:
                    surf, _tagged = surface_of(t, "steps")
                    feats.append({
                        "type": "Feature",
                        "geometry": {"type": "Polygon", "coordinates": [r]},
                        "properties": {
                            "k": "path", "u": "steps", "s": surf,
                            "w": DEFAULT_WIDTH.get("steps", 3.0), "wt": 0,
                            "_wid": el["id"], "_st": stair_tags(t),
                            **({"name": t["name"]} if t.get("name") else {}),
                        },
                    })
                    stats["path_steps_area"] += 1
            else:
                stats["skipped_area_way"] += 1
            continue
        # CURVES STAY CURVES, and a sidewalk is the worse case: it is never
        # RDP-simplified at all, so every facet in it is the mapper's own node
        # spacing and nothing but smoothing can take it out. Corners survive --
        # a kerb return turns 90 degrees and CURVE_CORNER_DEG protects it.
        coords = smooth_curves(
            [[round(p["lon"], 6), round(p["lat"], 6)] for p in el["geometry"]],
            stats, "curve_walk")
        if len(coords) < 2:
            continue
        # Skip crossings: they are road markings, and drawing them as paths
        # lays pale ribbons across every street. Their two KERB APRONS are not
        # road markings though -- they are the ramp the sidewalk is missing --
        # so those go in as ordinary footway. See CROSSING_APRON_M.
        if t.get("footway") == "crossing" or t.get("crossing"):
            stats["skipped_crossing"] += 1
            for ap in crossing_aprons(coords):
                feats.append({
                    "type": "Feature",
                    "geometry": {"type": "LineString", "coordinates": ap},
                    "properties": {"k": "path", "u": "footway",
                                   "s": CROSSING_APRON_SURFACE,
                                   "w": DEFAULT_WIDTH["footway"], "wt": 0,
                                   # an apron is this bake's own extrapolation
                                   # past the last surveyed node, so the
                                   # carriageway still trims it — that is the
                                   # guarantee in CROSSING_APRON_M's own note
                                   # that an overshoot cannot ship.
                                   DERIVED_PATH_KEY: 1},
                })
                stats["crossing_apron"] += 1
            continue
        use = "steps" if hw == "steps" else hw
        surf, tagged = surface_of(t, use)
        w = parse_width(t.get("width")) or parse_width(t.get("est_width"))
        extra = {}

        # A surveyed width beats the template. OSM's own `width` tag still
        # wins over it -- that is a surveyor's claim about THIS way, and the
        # measurement is a claim about the slab under it -- but there are
        # none on campus, so in practice this is the first real number any
        # of these walks has ever had.
        if w is None:
            mw = measured_w.get(str(el["id"]))
            if mw is not None:
                w = mw
                extra["src"] = MEASURED_WIDTH_SRC
                stats["path_width_measured"] += 1
                d = mw - DEFAULT_WIDTH.get(use, 2.0)
                if abs(d) > 0.5:
                    stats["path_width_off_template"] += 1
                    stats["path_width_wider" if d > 0 else "path_width_narrower"] += 1
            else:
                stats["path_width_default"] += 1

        # ---- Speedway Mall -------------------------------------------------
        # OSM tags the corridor in two halves: surface=paving_stones north of
        # ~23rd and surface=asphalt south of it. The asphalt half is a STALE tag.
        # PWP's project record says the whole corridor from Jester Circle to
        # Dean Keeton was reconstructed as a 30 ft brick mall, and the nadir
        # imagery agrees flatly -- the "asphalt" half samples rgb(200,176,142),
        # a warm tan, while a real asphalt control 100 m away samples
        # rgb(161,155,137). See scripts/sample_speedway_colour.py. The photo
        # beats the derived tag.
        if (t.get("name") or "") == "Speedway" and hw == "pedestrian":
            surf, tagged = "brickpave", False
            w = SPEEDWAY_W          # 30 ft, PWP; sourced, not measured by us
            extra["src"] = "pwp30ft"
            stats["speedway_mall_segments"] += 1
            if (t.get("surface") or "") == "asphalt":
                stats["speedway_stale_asphalt_overridden"] += 1

        # A stepped path carries its OSM identity through the union, so the
        # drawn staircase and the routed staircase can be matched by id
        # instead of by centroid. Only steps: attributing 1,300 footway slabs
        # back to their sources costs a lot and answers nothing anybody asks.
        if use in STAIR_ID_USES:
            extra["_wid"] = el["id"]
            extra["_st"] = stair_tags(t)

        feats.append({
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": coords},
            "properties": {
                "k": "path", "u": use, "s": surf,
                "w": round(w or DEFAULT_WIDTH.get(use, 2.0), 1),
                "wt": 1 if w else 0,
                **extra,
                **({"name": t["name"]} if t.get("name") else {}),
            },
        })
        stats["path_" + use] += 1

    # ---- plazas / pedestrian areas -------------------------------------
    for el in load("plazas"):
        t = el.get("tags", {}) or {}
        rings = []
        if el.get("type") == "way":
            r = ring_of(el.get("geometry"))
            if r:
                rings = [r]
        else:
            rings = rings_from_relation(el)
        if not rings:
            continue
        # A `highway=pedestrian` polygon is a MALL — a walk you step up onto —
        # and belongs in the path band with every other walk. Anything else in
        # this cache (traffic islands, stepped terraces tagged `area:highway`)
        # keeps the flat plaza treatment it has always had.
        mall = PEDESTRIAN_AREA_IS_A_WALK and t.get("highway") == "pedestrian"
        surf, _ = surface_of(t, "pedestrian" if mall else "plaza")
        for r in rings:
            if mall:
                feats.append({
                    "type": "Feature",
                    "geometry": {"type": "Polygon", "coordinates": [r]},
                    "properties": {"k": "patharea", "u": "pedestrian", "s": surf,
                                   **({"name": t["name"]} if t.get("name") else {})},
                })
                stats["pedestrian_mall_area"] += 1
                continue
            feats.append({
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [r]},
                "properties": {"k": "area", "u": "plaza", "s": surf,
                               **({"name": t["name"]} if t.get("name") else {})},
            })
            stats["plaza"] += 1

    # ---- landuse / natural / leisure areas ------------------------------
    for el in load("landuse"):
        t = el.get("tags", {}) or {}
        val = t.get("landuse") or t.get("natural") or t.get("leisure")
        if val in NOT_GROUND:
            stats["skipped_not_ground"] += 1
            continue
        use = AREA_USE.get(val)
        if not use:
            continue
        rings = [ring_of(el.get("geometry"))] if el.get("type") == "way" else rings_from_relation(el)
        rings = [r for r in rings if r]
        if not rings:
            continue
        surf, _ = surface_of(t, use)
        for r in rings:
            # Drop enormous polygons: a campus-wide landuse=education blanket
            # would repaint the entire ground plane one flat colour, which is
            # the exact defect this pass exists to remove.
            if area_m2(r) > 400000:
                stats["skipped_huge_area"] += 1
                continue
            feats.append({
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [r]},
                "properties": {"k": "area", "u": use, "s": surf,
                               **({"sport": t["sport"]} if t.get("sport") else {}),
                               **({"name": t["name"]} if t.get("name") else {})},
            })
            stats["area_" + use] += 1

    # ---- water, sport surfaces, parking ---------------------------------
    for key, default_use in (("water", "water"), ("sport", "track"), ("parking", "parking")):
        for el in load(key):
            t = el.get("tags", {}) or {}
            val = (t.get("natural") or t.get("amenity") or t.get("leisure")
                   or t.get("water") or t.get("sport"))
            if val in NOT_GROUND:
                stats["skipped_not_ground"] += 1
                continue
            use = AREA_USE.get(val, default_use)
            if el.get("type") == "way" and t.get("service") == "parking_aisle":
                continue                       # aisles are lines; the lot covers it
            rings = [ring_of(el.get("geometry"))] if el.get("type") == "way" else rings_from_relation(el)
            rings = [r for r in rings if r]
            surf, _ = surface_of(t, use)
            for r in rings:
                if area_m2(r) > 400000:
                    stats["skipped_huge_area"] += 1
                    continue
                feats.append({
                    "type": "Feature",
                    "geometry": {"type": "Polygon", "coordinates": [r]},
                    "properties": {"k": "area", "u": use, "s": surf,
                                   **({"sport": t["sport"]} if t.get("sport") else {}),
                                   **({"name": t["name"]} if t.get("name") else {})},
                })
                stats["area_" + use] += 1

    # ---- American football fields get their end zones ---------------------
    # A gridiron read from the air IS the identity of a stadium, and the end
    # zones are what make it read as one rather than as a green rectangle.
    # POSITION is factual: the pitch polygon is OSM's. The SPLIT is derived —
    # a regulation field is 120 yd long including two 10 yd end zones, so the
    # end zones are the outer 9.144/109.73 = 8.33% of the long axis at each
    # end. Applied to the polygon's own long axis, not to a guessed rectangle.
    END_ZONE_FRAC = 9.144 / 109.728
    extra = []
    for f in feats:
        pr = f["properties"]
        if pr.get("u") != "pitch" or pr.get("sport") != "american_football":
            continue
        ring = f["geometry"]["coordinates"][0]
        lat0 = sum(q[1] for q in ring) / len(ring)
        kx = math.cos(math.radians(lat0))
        xs = [q[0] * kx for q in ring]
        ys = [q[1] for q in ring]
        # Long axis of the bounding box decides which pair of ends to cut.
        w_m = (max(xs) - min(xs)) * M_LAT
        h_m = (max(ys) - min(ys)) * M_LAT
        along_x = w_m >= h_m
        lo, hi = (min(xs), max(xs)) if along_x else (min(ys), max(ys))
        cut = (hi - lo) * END_ZONE_FRAC
        for a, b in ((lo, lo + cut), (hi - cut, hi)):
            if along_x:
                box = [[a / kx, min(ys)], [b / kx, min(ys)],
                       [b / kx, max(ys)], [a / kx, max(ys)]]
            else:
                box = [[min(xs) / kx, a], [max(xs) / kx, a],
                       [max(xs) / kx, b], [min(xs) / kx, b]]
            box.append(list(box[0]))
            extra.append({
                "type": "Feature",
                "geometry": {"type": "Polygon",
                             "coordinates": [[[round(x, 6), round(y, 6)] for x, y in box]]},
                "properties": {"k": "area", "u": "endzone", "s": "endzone",
                               "name": pr.get("name", "")},
            })
        stats["endzones"] += 2
    feats.extend(extra)

    # The same polygon can arrive from several caches (a pitch is in landuse AND
    # sport AND surfaces), which stacked four copies of the DKR field. Key on
    # geometry + use and keep one.
    seen, deduped = set(), []
    for f in feats:
        if f["properties"]["k"] == "area":
            r = f["geometry"]["coordinates"][0]
            key = (f["properties"]["u"], round(sum(q[0] for q in r) / len(r), 6),
                   round(sum(q[1] for q in r) / len(r), 6), len(r))
            if key in seen:
                stats["deduped_area"] += 1
                continue
            seen.add(key)
        deduped.append(f)
    feats = deduped

    # Counted BEFORE widening, because after it there are no k:'path' features
    # left to count and the report would silently read zero.
    paths_tagged_w = sum(1 for f in feats if f["properties"].get("wt") == 1)
    paths_default_w = sum(1 for f in feats if f["properties"]["k"] == "path"
                          and f["properties"].get("wt") == 0)

    feats = classify_water(feats, stats)
    feats = cut_creek_channels(feats, stats, warnings)
    feats = grow_precinct_lawns(feats, stats, warnings)
    # BEFORE widen_paths, because widen_paths is what consumes the centrelines
    # and a direction is a property of a LINE, not of the union of a thousand of
    # them. Held until after the resolver; see score_walks.
    walk_runs = walk_direction_runs(feats, stats)
    # BEFORE widen_paths, for the same reason walk_direction_runs is: the walks
    # are still surveyed centrelines here, and after it they are one unioned
    # polygon per (use, surface) with no way left to tell a surveyed sidewalk
    # from an apron this bake extrapolated. See SIDEWALK_KEEP_HALF_M.
    # THE ROADS ARE BAKED HERE NOW, one step earlier than they used to be, and
    # the reason is SIDEWALK_KEEP_PARALLEL_DEG: deciding whether a walk runs
    # BESIDE a road or ACROSS it needs the road centrelines, and the keep-cores
    # have to be built while the walks are still LineStrings. bake_roads() is a
    # pure read of the OSM cache — it takes no `feats` and mutates nothing this
    # pass has touched — so moving the call cannot change what it returns, and
    # data/roads.geojson is written from it further down exactly as before.
    road_feats = bake_roads(stats, warnings)
    roads_m = carriageway_polys(road_feats)
    stats["carriageways_as_cutters"] = len(roads_m)
    keep_cores = sidewalk_keep_polys(feats, stats, road_feats,
                                     kerb_band_polys(roads_m, stats))
    feats = widen_paths(feats, stats, warnings)
    # AFTER widen_paths on purpose: a garden's beds are derived from the
    # walks around them and paths are still LineStrings until then. The
    # precinct-lawn pass learned the same lesson the hard way (see its
    # note about buffering the path lines by hand).
    feats = plant_gardens(feats, stats, warnings)

    # BOTH BEFORE THE RESOLVER, which is the point of them: a medallion is a
    # disc laid IN a median panel and a star is laid in the medallion, so the
    # rank ladder is what cuts the grass out from under the stone. Emit these
    # after the resolver and you get three coincident surfaces z-fighting in
    # the middle of a boulevard, which is the defect PR #78 exists to prevent.
    feats = lay_median_medallions(feats, stats, warnings)
    feats = lay_flagpole_plinths(feats, stats, warnings)

    # AFTER the roads are baked, because a crossing is defined by the way that
    # crosses; BEFORE the resolver, because the resolver is what actually takes
    # the ground back off the channel. Both halves matter -- run this after the
    # resolver and the decks are emitted into ground the trench still owns.
    feats = deck_creek_crossings(feats, road_feats, stats, warnings)

    before = count_conflicts(feats, roads_m)
    feats = resolve_ground_conflicts(feats, roads_m, stats, warnings,
                                     keep_polys=keep_cores)
    after = count_conflicts(feats, roads_m)

    # AFTER the resolver, deliberately. The planted zones are still the raw
    # buffered rings until it runs, and they overlap the carriageways and walks
    # that cross the corridor -- plant first and a crown ends up centred over
    # the middle of San Jacinto with no trunk under it. §32's rule is that the
    # TRUNK is the test, and a crown baked here has no trunk to test, so the
    # honest equivalent is to plant only in ground the corridor actually kept.
    feats = plant_creek_canopy(feats, stats, warnings)

    # AFTER the resolver too, and for the same shape of reason: the scoring is
    # cut from the walks the resolver KEPT, not from the raw buffered ones.
    feats = score_walks(feats, walk_runs, stats, warnings)

    # AFTER the resolver, and that is the whole point: the carriageway is the
    # top rung of the ladder, so it must not be a candidate for being cut. It
    # goes in as drawn geometry only, at its full tagged width -- the same width
    # the `line` layer used to paint -- while the resolver's own copy of it is
    # inset by half a kerb (CARRIAGEWAY_INSET_M) so the gutter stays with the
    # pavement it belongs to. Two uses, two widths, on purpose.
    # ...and the malls take theirs back off the carriageway on the way in. The
    # union is taken from the RESOLVED features, so it is the ground the malls
    # actually kept rather than the raw buffered corridor.
    feats += widen_roads(road_feats, stats, warnings,
                         keep_out=pedestrian_mall_union(feats, stats))

    # LAST, and only a colour: see tone_lawns' docstring for why it cannot run
    # earlier. Nothing downstream of here reads `s`.
    feats = tone_lawns(feats, stats)

    # Draw order: big areas first, then small areas on top of them, then paths
    # over everything. Without the size term a 30,000 m2 lawn painted over the
    # field it contains.
    def order(f):
        if f["properties"]["k"] != "area":
            return (2, 0)
        r = f["geometry"]["coordinates"][0]
        return (0 if f["properties"]["u"] != "endzone" else 1, -area_m2(r))
    feats.sort(key=order)

    fc = {"type": "FeatureCollection", "features": feats}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(fc, f, separators=(",", ":"))

    size_kb = os.path.getsize(OUT) / 1024
    # COUNTED OFF THE FILE THAT WAS JUST WRITTEN, not off the emit counters.
    # `creek_water_sheen: 7` was printed by a run in which all seven had been
    # deleted by the resolver forty lines later. Everything derived here is
    # measured on the output, so the report cannot describe a file that does
    # not exist -- the same argument bake_art.py's re-measure makes.
    shipped = Counter()
    for f in feats:
        p = f["properties"]
        shipped["shipped_" + str(p.get("k")) + "_" +
                str(p.get("m") or p.get("s") or p.get("u"))] += 1
    report = {
        "features": len(feats),
        "file_kb": round(size_kb, 1),
        "shipped": {k: v for k, v in sorted(shipped.items())
                    if k.startswith(("shipped_bank", "shipped_cnp",
                                     "shipped_roadarea", "shipped_cyclearea"))},
        "counts": dict(sorted(stats.items(), key=lambda kv: kv[0])),
        "paths_with_TAGGED_width": paths_tagged_w,
        "paths_with_DEFAULT_width": paths_default_w,
        "unmapped_surface_values": dict(unmapped_surface),
        "coincident_surfaces_BEFORE": before,
        "coincident_surfaces_AFTER": after,
        "warnings": warnings,
    }
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    import sys
    if "--walkaudit" in sys.argv:
        # AUDIT ONLY. Reads the ground already on disk and never writes it, so
        # it can be run against a shipped file to grade it.
        #   --pairs house   grade the twenty in scripts/verify/walk-pairs.json
        #                   instead, so a number here lines up with the ones
        #                   scripts/verify/walkmeter.mjs prints
        #   --where         bin the bare metres by distance to pavement, i.e.
        #                   "is this a missing sidewalk or a missing hem"
        #   --prov          the OTHER half of the goal: per route, how much of
        #                   the ribbon is a real OSM way and how much is a line
        #                   this project invented
        #   --surfaces      walk every surveyed sidewalk and say what is drawn
        #                   UNDER it — the cell that matters is a non-crossing
        #                   sidewalk painted as carriageway
        #   --islands       every stranded sidewalk component and what a stitch
        #                   to it would have to cross
        pairs = None
        if "--pairs" in sys.argv:
            which = sys.argv[sys.argv.index("--pairs") + 1]
            if which == "house":
                pairs = walkaudit_house_pairs()
                if pairs is None:
                    print("no %s on this branch" % WALKAUDIT_HOUSE_PAIRS_JSON)
                    sys.exit(2)
            elif which != "own":
                print("--pairs takes `house` or `own`")
                sys.exit(2)
        sys.exit(walkaudit(pairs=pairs, where="--where" in sys.argv,
                           prov="--prov" in sys.argv,
                           coverage="--coverage" in sys.argv,
                           surfaces="--surfaces" in sys.argv,
                           islands="--islands" in sys.argv))
    main()
