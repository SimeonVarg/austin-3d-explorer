# -*- coding: utf-8 -*-
"""Entrances: every door on the Forty Acres, placed from evidence and assembled
from an era vocabulary, as proud geometry that claims no building.

    python scripts/bake_entrances.py            # bake
    python scripts/bake_entrances.py --refresh  # re-query Overpass, print new tables

WHY THIS EXISTS
---------------
Simeon: "just add the entrances to the buildings on campus... make entrances
extremely accurate with accurate text and design, some of these are celebrated
entrances. Do all entrances and exits, correct types of doors, amount of doors +
stairs, rails, glass, and material."

"Some of these are celebrated" is the whole difficulty. UT is a Cass Gilbert /
Paul Cret campus: Battle Hall, Sutton Hall, the Main Building, the Texas Union
and Gregory Gym are genuinely significant architecture. One generic rectangle of
glass applied 614 times puts the same door on Battle Hall's east portal and on a
chiller plant, and the Battle Hall one is the one people will look at. So this
file is deliberately three things stacked in order of decreasing confidence:

  1. a PLACEMENT pipeline that is measured against 91 known OSM entrance nodes
     and prints its recovery rate on every single run (docs/entrances/placement.md);
  2. an ERA VOCABULARY of nine primitives whose parameters — and only whose
     parameters — differ between five families (docs/entrances/eras.md);
  3. an explicit CELEBRATED override table keyed on the building's three-letter
     ref, in the same spirit as capitol_overrides, so it is obvious at a glance
     which portals are authored and which are inferred (docs/entrances/celebrated.md).

Everything in (1) is measured. Roughly half of (2) and (3) is marked `[A]`/`[U]`
in those docs — an authoring default, not a claim about the world — and this file
does not launder that. `src` on every emitted piece says where its POSITION came
from, and membership of CELEBRATED says whether its ASSEMBLY was authored.

THE PROUD-GEOMETRY CONTRACT, copied from scripts/bake_places.py
---------------------------------------------------------------
Every piece stands PROUD of the host wall and this pass claims NO building ids.
`replacedBuildingIds` is empty, on purpose and permanently. Seven passes already
claim ids (arts, drag, heroes, moody, capitol, westcampus, the stadium block in
app.js). A pass that only ever ADDS geometry in front of a wall can never collide
with any of them, in either order, whether or not they have already rebuilt the
wall behind it. Do not "improve" this by rewriting a host building.

A consequence with teeth: this renderer has no CSG, so a reveal is not a hole. A
recess is drawn as a dark slab standing 0.02 m proud whose COLOUR is the shadow,
plus jamb returns that give the only real 3D depth. Depth is read from value, not
from geometry — exactly as bake_arts.py does for the Blanton arcade. For the same
reason GLAZING STANDS PROUD OF ITS LEAF (see GLASS_PROUD): a light recessed
inside a solid leaf is a light nobody can see.

`h` IS A THICKNESS, NOT A TOP. READ THIS BEFORE WRITING THE RENDERER.
---------------------------------------------------------------------
data/places.geojson stores `h` as the ABSOLUTE TOP of a band (base 4.30, h 5.35
for a 1.05 m sign). This file follows the schema Simeon fixed for it, which says
"`h` height of this piece in metres". So here:

    fill-extrusion-base   = base
    fill-extrusion-height = base + h        <- NOT h

Every piece in this file obeys that. It disagrees with places.geojson on purpose
and it is the single most likely thing for the renderer to get wrong.

ONE FILE, ONE WRITER
--------------------
This script owns data/entrances.geojson and nothing else writes it (CLAUDE.md
lane rule 1). It writes no other file. In particular it does NOT write
data/osm_cache/ — the OSM tables it needs are frozen into this file below, with
their fetch date and query, and `--refresh` regenerates them.

Sources: docs/entrances/placement.md (placement + validation),
docs/entrances/eras.md (the vocabulary), docs/entrances/celebrated.md (the
authored portals). Read all three before changing a number here.
"""
from __future__ import print_function

import json
import math
import os
import sys
from collections import Counter, defaultdict

try:
    from shapely.geometry import Point, Polygon, LineString
    from shapely.strtree import STRtree
except ImportError:  # pragma: no cover
    sys.stderr.write("shapely is required: pip install shapely\n")
    raise

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SNAP = os.path.join(ROOT, "data", "snapshots", "2026-08-04",
                    "buildings.detailed.geojson")
CACHE = os.path.join(ROOT, "data", "osm_cache")
FOOTWAYS = os.path.join(CACHE, "footways.json")
PLAZAS = os.path.join(CACHE, "plazas.json")
SURFACES = os.path.join(CACHE, "surfaces.json")
PLACES = os.path.join(ROOT, "data", "places.geojson")
OUT = os.path.join(ROOT, "data", "entrances.geojson")

# An optional refresh of the frozen tables below. If another lane ever caches
# entrance nodes properly this file will prefer the cache without an edit.
CACHED_ENTRANCES = os.path.join(CACHE, "entrances.json")
CACHED_BLDG_TAGS = os.path.join(CACHE, "campus_buildings.json")


# ══════════════════════════════════════════════════════════════════════
#  TASTE BLOCK — CLAUDE.md rule 11.
#  Every aesthetic value in this pass is here. None is buried in a
#  function body. Each line is a one-line override.
#  Numbers carry the confidence marks used in the docs:
#    [M] measured in-repo   [S] sourced   [C] building code
#    [D] derived from one of the above   [A] authoring default, argue with it
# ══════════════════════════════════════════════════════════════════════

# ── SCOPE ─────────────────────────────────────────────────────────────
# The rect bounded by Guadalupe, I-35, MLK and the Dean Keeton blocks. NOT the
# OSM campus relation, which runs to the Pickle Research Campus 7 km north.
CAMPUS = (30.2795, -97.7420, 30.2930, -97.7255)   # s, w, n, e   [M]
SURVEY = (30.2760, -97.7480, 30.2960, -97.7220)   # the queried bbox   [M]
MIN_AREA = 250.0        # m2 of footprint to be worth a door   [A]
MIN_H = 4.0             # m; under this it is a shed   [A]
SKIP_CLASSES = ("roof",)  # 33 of these in the bbox and they are canopies   [M]

# ── PLACEMENT (docs/entrances/placement.md §8) ────────────────────────
TERM_R = 8.0            # m; how far a dead-end path may sit off a wall
CLUSTER_R = 5.0         # m; two candidates this close are one entrance
NORMAL_MIN = 0.25       # cos; how squarely a path must face the wall
NORMAL_HALF = 0.20      # cos; outward half-plane test in the publicness field
NORMAL_PROBE = 0.5      # m; the outside-probe distance of THE NORMAL TEST
APPROACH_R = 22.0       # m; publicness reach
SAMPLE = 2.0            # m; perimeter scoring step
MIN_SEP = 14.0          # m between two entrances on one building
P_PER_DOOR = 100.0      # m of facade per entrance
NMAX = 8                # cap, even on Jester
GARAGE_CAP = 2          # pedestrian doors on a parking structure
OSM_MAX_SNAP = 25.0     # m; further than this and Overture has no building there
EDGE_MARGIN = 0.8       # m of wall kept clear either side of an opening
W_FOOT, W_STEPS, W_PLAZA, W_STREET, W_SERVICE = 1.0, 1.4, 1.2, 0.7, -1.0
MIN_SCORE = 0.0         # a wall that scores at or below this gets no door
FACADE_BONUS = 0.45     # score added to a sample on a celebrated building's
                        # documented facade side, so a [C] compass direction
                        # biases selection without fabricating a coordinate

# ── VERTICAL (placement.md §7) ────────────────────────────────────────
GROUND_Z = 0.22         # NOT taste. = GROUND.pathRaise (js/ground.js:53)
                        # = FLIGHT_BASE (bake_depth.py:163). Start below this
                        # and the bottom treads are swallowed by the path slab.
FLOOR_RISE = 0.55       # m; ground floor over the path. TASTE, and the loudest
                        # number in the pass: it decides how many steps every
                        # generic entrance gets. Set to 0 for a flat campus.
DEFAULT_RISERS = 5      # when an adjacent OSM steps way has no step_count  [M]
STEPS_R = 12.0          # m; a steps way this close means a real flight  [M]
MONUMENTAL_RISE_MAX = 1.60   # m; cap on an AUTHORED family A/B rise      [A]
# ── A RAISED SILL NEEDS EVIDENCE, and the evidence has to be geometry this
#    repo actually draws. The first cut authored PCL's threshold one storey up
#    ("the entrance is on the second floor, off a plaza" [S], eras.md §C) and
#    trusted the ground pass to build the plaza. It does not. The result was
#    four doors hanging 3.68 m in the air over a blank wall — a table, not an
#    entrance. So: an authored `plaza_z` is now a REQUEST, granted only if a
#    raised deck of about that height really exists near the door in
#    data/depth.geojson or data/ground.geojson. With no evidence the sill goes
#    to ground and the flight goes with it. A door nobody can reach is a worse
#    drawing than a flight that is slightly wrong.
PLAZA_EVIDENCE_R = 30.0      # m; how far from the door a raised deck may sit
PLAZA_EVIDENCE_FRAC = 0.60   # ... and how much of the wanted rise it must reach
FLOAT_TOL = 0.12             # m; a sill this far over its own support floats
WALL_TOUCH = 0.05            # m; a piece whose inner face is within this of the
                             # wall is carried BY the wall and cannot float
TOUCH = 0.035                # m; two pieces this close are touching, for the
                             # connectivity audit. Bigger than GLASS_PROUD 0.02
                             # so a light counts as glued to its own leaf.
FLIGHT_RISE_MAX = 1.10       # m; cap on a DERIVED rise. bake_depth.py's guard,
                             # which already stopped one pass shipping a 3 m
                             # staircase. Two caps because family B's authored
                             # 1.35 m is deliberate and a step_count of 21 is not.

# ── STAIR PROFILE — reused verbatim from scripts/bake_depth.py ────────
# Do NOT invent a second stair look. One course = a dark slab with a light slab
# set back on top; from the air you read the nosing, obliquely you read the
# riser, at tour altitude you read a thin dark line.
STEP_NOSING = 0.35       # [M] bake_depth.py:108
STEP_NOSING_FRAC = 0.35  # [M] bake_depth.py:109 — cap on a narrow tread
STEP_LIFT = 0.03         # [M] bake_depth.py:110
FLIGHT_RISER = 0.17      # [M] bake_depth.py:160 — utility flights
FLIGHT_TREAD = 0.42      # [M] bake_depth.py:161
MONUMENTAL_RISER = 0.15  # [D] bake_depth's own note: "a real monumental stair
                         #     is ~0.15", and inside IBC's 4"-7" band
UTILITY_TREAD = 0.30     # [C] IBC 1011.5.2 minimum tread 0.279 m
FLIGHT_SIDE = 1.20       # m the flight runs past the opening either side  [A]

# ── THE ASSEMBLY — every one of these is a one-line override ──────────
DOOR_H = 2.44           # m, monumental leaf height (8'-0")            [A]
DOOR_W = 1.00           # m, monumental leaf width                     [A]
COMM_DOOR_H = 2.134     # m, commercial leaf (84")                     [C]
COMM_DOOR_W = 0.914     # m, commercial leaf (36")                     [C]
LOBBY_DOOR_W = 1.067    # m, modern wide-stile lobby leaf (3'-6")      [A]
LEAF_T = 0.10           # m; how thick a leaf slab is drawn
MEET_STILE = 0.10       # m; the meeting stile of a pair               [A]
MULLION = 0.12          # m; the mullion between two pairs             [A]
FRAME_W = 0.09          # m; stile/rail width — the frame margin around a light
GLASS_PROUD = 0.02      # m the light stands PROUD of its leaf. See the header:
                        # there is no CSG, and a recessed light is invisible.
                        # placement.md's GLASS_INSET 0.04 was a recess; this is
                        # the same idea drawn the only way this renderer allows.
REVEAL_PROUD = 0.02     # m the shadow slab stands off the wall (z-fight guard)
REVEAL_T = 0.06         # m; its own thickness
JAMB_T = 0.15           # m; WIDTH of a jamb return along the wall       [A]
# ── A REVEAL IS A SIDE WALL, NOT A POST. The first cut projected the jamb
#    return by the family's full `reveal_d` — 1.20 m on Gilbert, 1.50 m on
#    mid-century — which put two full-height bars a metre and a half OUT IN
#    FRONT of the doors. On Battle Hall and Sutton Hall they read as two dark
#    free-standing poles planted across the portal. A reveal is the recessed
#    side of the opening: it lives BETWEEN the wall face and the door plane and
#    it is bounded by the door plane. So the projection is capped there, and the
#    return sits flush INSIDE the opening rather than straddling its edge.
#    The notional depth still does its work — it is read from VALUE, exactly as
#    the reveal slab itself is, and exactly as bake_arts.py reads the Blanton
#    arcade. Depth in this renderer is a colour, not a distance.
JAMB_PROJ_MIN = 0.02    # m; the jamb starts at the wall face
JAMB_PROJ_MAX = 0.34    # m; and may never pass this, whatever `reveal_d` says
JAMB_SHADE = 0.86       # the return is this much darker than the reveal slab
REVEAL_DEPTH_MIX = 0.30 # how far a maximally deep reveal is mixed toward
REVEAL_DEPTH_REF = 1.50 # ... ARCH_SHADOW; `reveal_d` at or over this is full
KEYSTONE_W = 0.55       # m; the accent keystone at an arch crown          [A]
PROUD_DOOR = 0.08       # m; the door bank's face offset from the wall
SIDELIGHT_MIN = 0.60    # m; leftover narrower than this is absorbed    [A]
COLLINEAR_COS = 0.985   # cos ~10 deg; two footprint edges this parallel are one
                        # wall as far as an opening is concerned           [A]
COLLINEAR_HOPS = 6      # how many neighbours the walk may cross
TRANSOM_GAP = 0.04      # m of frame between head and transom
ARCH_TIERS = 5          # horizontal chords an arch head is drawn with
RAIL_H = 0.90           # m over the nosing                             [C] IBC 1014.3
RAIL_D = 0.10           # m; DRAWN diameter. A true 38 mm tube is sub-pixel at
                        # cruise altitude. Deliberate, parameterised over-scale
                        # — do NOT "fix" this back to 0.038.            [D]
RAIL_SEGS = 3           # slabs a sloping rail is approximated with
RAIL_POST_D = 0.08      # m; a handrail needs something holding it up. The
                        # connectivity audit found 264 rail slabs hanging in
                        # mid air over their own flights — every tube rail in
                        # the file. Cheap to fix, +2.6% of pieces.        [A]
RAIL_MIN_RISERS = 2     # [A] IBC wants rails at 4+; 2 so the rail reads
CHEEK_W = 0.42          # m; solid limestone cheek instead of a tube rail [A]
CHEEK_H = 0.60          # m over the nosing                              [A]
CANOPY_SIDE = 0.60      # m the canopy runs past the bank either side    [A]
CANOPY_SIDE_D = 1.20    # ... on family D, whose canopy is the identity  [A]
RAMP_SLOPE = 1.0 / 12.0 # [C] ADA
RAMP_W = 1.50           # m                                             [A]
RAMP_SEGS = 4           # slabs a ramp is approximated with
RAMP_MIN_RISERS = 4     # below this the threshold is close enough to grade,
                        # and a 6 m ramp beside every three-riser stoop is
                        # visual noise: at 3 it fired on 228 of 584.        [A]
SIGN_H = 1.10           # m; the inscription / frieze band              [A]
COLUMN_W = 0.90         # m; a pilaster's face width                    [A]
COLUMN_D = 0.28         # m; how far it stands proud                    [A]

# ── COLOURS — every hex is already in this repo, sampled and checked ──
# against this renderer, or derived from one by the repo's own measured
# transfer (a wall face lands at ~R*0.78 / G*0.69 / B*0.58 of its input).
# Two consequences that have each cost a round: a SHADOW must be entered
# ALREADY LIT or it reads as a hole punched in the building, and GLASS must be
# entered BLUER than photographed or it lands dead neutral grey.
LIMESTONE = "#e5dbc2"    # [S] bake_tower.py PART_WD — Main Building parts
LIMESTONE_ALT = "#e6dcc3"  # [S] Battle Hall cream, cited in bake_heroes.py
ASHLAR = "#e6ded0"       # [S] bake_drag.py MATERIALS["ashlar"] — Texas Union
CASTSTONE = "#b3ab9c"    # [S] bake_drag.py MATERIALS["cstone"] — Gregory base
BRICK = "#b98a62"        # [S] bake_drag.py MATERIALS["brick"] — the UT blend
TERRACOTTA = "#ad5833"   # [S] bake_roofs.py — owns 9,543 px at rgb(173,88,51)
BRONZE = "#6b5540"       # [D] a dark bronze lifted through the luma transfer
WOOD = "#5f4a35"         # [A] dark stained wood, same treatment
ALUMINIUM = "#9aa0a4"    # [D] from bake_heroes.py nhb_steel, 6% up
STEEL = "#8e969c"        # [S] bake_heroes.py nhb_steel
STEEL_DK = "#4b4f53"     # [S] bake_heroes.py eer_steel
CONCRETE = "#a8a49c"     # [D] cast stone cooled — mid-century concrete
GLASS = "#4f86b4"        # [S] bake_heroes.py gdc_glass — already entered bluer
GLASS_COOL = "#4d81ad"   # [S] bake_heroes.py eer_glass
GLASS_SAT = "#2f5c94"    # [S] bake_heroes.py nhb_glass
GLASS_WARM = "#6b93b6"   # [S] bake_arts.py bass_glass
REVEAL_WARM = "#9a9082"  # [D] limestone x 0.66, entered ALREADY LIT
REVEAL_COOL = "#74756d"  # [S] bake_heroes.py eer_soffit
ARCH_SHADOW = "#4d4535"  # [S] bake_arts.py blanton_arc
SOFFIT_DK = "#6b6f72"    # [D] eer_soffit cooled 5%
IRON = "#3f4145"         # [A] wrought iron / a garage's dark vehicle opening

# Where the repo has ALREADY sampled a building's glass, the entrance uses that
# value. An entrance in a different blue from the curtain wall three metres above
# it is a visible defect.
GLASS_BY_REF = {
    "EER": "#4d81ad",    # [S] bake_heroes.py eer_glass
    "GDC": "#4f86b4",    # [S] bake_heroes.py gdc_glass
    "NHB": "#2f5c94",    # [S] bake_heroes.py nhb_glass
    "PAC": "#6b93b6",    # [S] bake_arts.py bass_glass
}

STEP_DARK_MIX = 0.72     # the nosing course is the tread colour x this  [A]
LAMP_NIGHT = "#ffc25a"   # a lit lamp fixture — Battle's and Sutton's iron
                         # lanterns. Pre-compensated like the glazing below,
                         # for the same blue night light.                [D]
HRC_NIGHT_GLOW = "#ffd07a"     # the HRC ground floor is called "a beacon for
                               # the campus" [C]; it gets the brightest night
                               # value of any facade in this pass. The old
                               # #e8d9ae was cream, and cream times a blue
                               # light is grey: it measured (123,122,125) on
                               # screen, a beacon that was not warm at all. [D]

# ══════════════════════════════════════════════════════════════════════
#  GLAZING BY FAMILY — the fix for "97% of the glass on the Forty Acres is
#  one cornflower blue". eras.md §3.5 publishes exactly four glass hexes,
#  all sampled off this renderer, and it repeats the default in every
#  family table; taken literally that is what produced the monotone. The
#  four sampled values stay the ONLY glass primaries in the file and every
#  family value below is DERIVED from one of them by a stated channel
#  operation, so nothing here is an invented colour.
#
#  A period read, in one line each:
#    A  Gilbert  — small leaded lights in a wooden door: dark, iron-edged
#    B  Cret     — a large light in a BRONZE frame: the frame warms the glass
#    C  midcent. — 1960s-70s tinted plate reads GREEN because the tint eats
#                  blue; B is pulled down and the blue-green survives
#    D  modern   — big low-e lites: paler, flatter, far less saturated
#    E2 dorms    — the warm-lobby blue
#    E4 church   — the leaded dark
#    E5 null     — the default, and it should be dull
# ══════════════════════════════════════════════════════════════════════
GLASS_LEADED = None      # filled below (mix/chan are defined after this block)
GLASS_BRONZED = None
GLASS_PLATE = None
GLASS_LOWE = None
GLASS_LEAD_MIX = 0.35    # A: how far the saturated blue goes toward IRON
GLASS_BRONZE_MIX = 0.18  # B: ... the saturated blue toward BRONZE
GLASS_PLATE_B = 0.72     # C: the blue channel a green tint leaves standing
GLASS_LOWE_GAIN = (1.12, 1.14, 1.03)   # D: the cool blue opened up

# THE ONE THAT HAD TO BE MEASURED. The first cut derived B from the DEFAULT
# blue and mixed 30% of bronze into it, which is the reasonable-sounding thing
# and is wrong: it landed #577791, and on the Main Building's sunlit south
# front that renders rgb(103,102,96) — dead neutral grey, spread 7. That is the
# same defect as the night one, in daylight, on the most photographed portal on
# campus. What warms a Cret light is the BRONZE FRAME around it, which is
# already the leaf colour; the glass itself has to stay glass. Re-derived from
# the SATURATED blue with a much smaller bronze, and re-measured on screen.

# Two entrances on two different buildings in the identical blue is the other
# half of the monotone. A deterministic per-BUILDING tint (never per piece, or
# one door's two leaves disagree) off the family value. Set GLASS_VARY = 1 to
# turn the whole thing off in one line.
GLASS_VARY = 3
GLASS_VARY_STEP = 0.07   # +/- this much of the family value

# ── NIGHT. THIS IS THE CAPITOL DEFECT'S SIGNATURE AND IT MUST NOT RECUR ──
# The first cut wrote glass `wn` at #4f493e: luma 74, channels within 17 of
# each other. That is not a colour anybody chose, it is what falls out of
# ramping a blue to night and nudging it 34% toward a lamp — a near-neutral
# mid grey, which is exactly the Capitol pale-band tell. Measured on screen it
# came back rgb(134,121,118) against a frame median of 45: a pale panel, not a
# lit vestibule.
#
# THE REASON IT LANDS NEUTRAL IS THE NIGHT LIGHT, and it is arithmetic. At
# tod 0.92 `map.setLight` is `{color:'#9aa6da', intensity:0.066}` (js/tower.js
# §6 documents the same cap), and MapLibre multiplies a fill-extrusion's colour
# by that light — a BLUE light, which lifts B and holds R down. Measured
# end-to-end by the review pass: input #ffd9a4 arrived as (134,121,118), i.e.
# a per-channel transfer of about R 0.53 / G 0.56 / B 0.72. Anything warm you
# enter comes back a third less warm.
#
# So lit glazing is entered PRE-COMPENSATED — R railed, G and B pulled down —
# for the same reason the day palette enters glass bluer than photographed.
# Three tones keyed on `eid` so 584 entrances are not one flat value, and a
# whole entrance lights as one unit.
GLASS_NIGHT_LIT = ["#ffaa3c", "#ffc06a", "#f09a35"]   # [D] from the transfer
NIGHT_SPREAD_MAX = 14    # channels within this of each other = "never set"
NIGHT_NEUTRAL_LUMA = 40  # ... and at or over this luma it is the pale band
GLASS_LIT_LUMA_MIN = 150 # a lit pane must be entered at least this bright
GLASS_DARK_LUMA_MAX = 30 # ... or genuinely dark. Nothing in between.


def wall_ramp(hex_col):
    """day -> (golden, night). Lifted verbatim from bake_heroes.py, which lifted
    it from bake_arts.py, which lifted it from bake_stadium.py. Four files share
    it; do not invent a fifth dusk."""
    c = [int(hex_col[i:i + 2], 16) for i in (1, 3, 5)]
    mixc = lambda a, b, t: [a[i] + (b[i] - a[i]) * t for i in range(3)]
    golden = mixc(c, [255, 190, 130], 0.16)
    night = mixc([v * 0.19 for v in c], [18, 22, 40], 0.42)
    hexify = lambda v: "#" + "".join("%02x" % max(0, min(255, int(round(x))))
                                     for x in v)
    return hexify(golden), hexify(night)


def mix(hex_col, other, t):
    a = [int(hex_col[i:i + 2], 16) for i in (1, 3, 5)]
    b = [int(other[i:i + 2], 16) for i in (1, 3, 5)]
    return "#" + "".join("%02x" % max(0, min(255, int(round(a[i] + (b[i] - a[i]) * t))))
                         for i in range(3))


def scale(hex_col, f):
    c = [int(hex_col[i:i + 2], 16) for i in (1, 3, 5)]
    return "#" + "".join("%02x" % max(0, min(255, int(round(v * f)))) for v in c)


def chan(hex_col, fr, fg, fb):
    """Per-channel gain. A tint that eats one channel is a channel operation,
    not a mix toward some other colour that happens to look right."""
    c = [int(hex_col[i:i + 2], 16) for i in (1, 3, 5)]
    return "#" + "".join("%02x" % max(0, min(255, int(round(v * f))))
                         for v, f in zip(c, (fr, fg, fb)))


def rgb_of(hex_col):
    return [int(hex_col[i:i + 2], 16) for i in (1, 3, 5)]


def luma_of(hex_col):
    r, g, b = rgb_of(hex_col)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def spread_of(hex_col):
    c = rgb_of(hex_col)
    return max(c) - min(c)


# The four sampled blues are the only glass primaries; these are the derivations
# named in the GLAZING BY FAMILY block above.
GLASS_LEADED = mix(GLASS_SAT, IRON, GLASS_LEAD_MIX)
GLASS_BRONZED = mix(GLASS_SAT, BRONZE, GLASS_BRONZE_MIX)
GLASS_PLATE = chan(GLASS_COOL, 1.0, 1.0, GLASS_PLATE_B)
GLASS_LOWE = chan(GLASS_COOL, *GLASS_LOWE_GAIN)


# ══════════════════════════════════════════════════════════════════════
#  WEST CAMPUS LOBBIES — docs/entrances/westcampus.md, and the
#  do-not-double-draw audit in docs/entrances/groundfloor-existing.md.
#
#  A student high-rise lobby is NOT family D and the four differences are
#  checkable (westcampus.md §1): a thick signboard canopy instead of a
#  steel blade, the NAME as the loudest element, a leasing window in the
#  same storefront run, and a garage gate. So it is a fifth family, `W`,
#  era "highrise", built from the same nine parts as everything else.
#
#  WHAT THIS COSTS THE ATLAS: nothing. Zero new fill-extrusion-pattern
#  images, zero new style layers, zero new `k` values — the mullion grid
#  is thin geometry (7-11 slabs) rather than a tile, because a tile has
#  no vertical anchor and this one would have to line up with a door.
#  js/entrances.js registers 0 atlas images today and still does.
#
#  Every offset below is either REUSED from the entrances alphabet (the
#  0.18/0.20 door and glass planes) or lands in one of the two intervals
#  groundfloor-existing.md §4 measured to be EMPTY across all four
#  ground-floor systems: 0.32-0.41 m and 0.46-1.29 m. Nothing here
#  shares a plane with a places `front` (0.30/0.31) or an entrances
#  `surround`/`sign` (0.42/0.45).
# ══════════════════════════════════════════════════════════════════════
WC_PITCH = 1.524         # m; the 5'-0" storefront module (§3.2)         [A]
WC_MULL_W = 0.10         # m DRAWN. The true face is 0.044 [S] and is sub-pixel
                         # at cruise, exactly like RAIL_D. Do not "fix" it.
WC_MIN_BAYS = 4          # under this the wall cannot carry a lobby       [A]
WC_BAYS_LADDER = ((45.0, 6), (80.0, 8), (1e9, 10))   # §3.2 — elevation length
                         # to bay count. A ladder, not a fraction: a 96 m block
                         # and a 44 m tower have nearly the same front door.
WC_QUAD_BAYS_MIN = 10    # at this many bays the doors become a vestibule quad
WC_DOOR_BAYS = 2         # whole bays a hinged pair occupies              [D]
WC_QUAD_BAYS = 3         # ... and a quad                                 [D]
WC_DOOR_MARGIN = 0.10    # m of slack so leaf_plan() can seat the pairs   [D]
WC_HEAD_DROP = 0.45      # m of spandrel over the storefront head (§3.1)  [A]
WC_TWO_STOREY = 5.50     # m; at or over this the run gets a mezzanine rail [D]
WC_MEZZ_FRAC = 0.52      # ... and that is where in the run it sits       [A]
WC_RAIL_T = 0.14         # m; head and mezzanine rail thickness           [A]
WC_BULK_H = 0.45         # m; the bulkhead under the glazing              [A]
WC_GLASS_V0 = 0.18       # m — REUSED from PROUD_DOOR + LEAF_T. There is one
WC_GLASS_V1 = 0.20       # m — door plane in this repo and this is it.    [M]
WC_FRAME_PROUD = 0.36    # m; mullion face. Free band 0.32-0.41           [M]
WC_SILL_PROUD = 0.40     # m; the bulkhead nib, top of the same band      [M]
WC_SIGN_V0 = 0.36        # m; the name band hangs off the mullion plane   [D]
WC_SIGN_PROUD = 0.40     # m                                              [D]
WC_CAN_PROJ = 2.60       # m                                              [A]
WC_CAN_T = 0.30          # m — thicker than family D's 0.18 ON PURPOSE. That
                         #     difference IS the family read (§3.4).      [A]
WC_CAN_TOP_MAX = 4.20    # m                                              [A]
WC_CAN_HEAD_CLEAR = 0.80 # m below the storefront head (§3.4)             [D]
WC_CAN_SIDE = 1.20       # m past the run each side                       [A]
WC_CAN_CLEAR = 0.35      # m of daylight between door head and soffit     [A]
WC_NAME_FRAC = 0.62      # share of the run the name band spans (§4.6)    [A]
WC_NAME_CAP_MAX = 0.55   # m cap height                                   [A]
WC_NAME_CAP_FRAC = 0.55  # ... of the spandrel it sits in                 [D]
WC_NAME_MIN_SPAN = 0.30  # m; below this there is no spandrel, no band    [D]
# WHERE THE NAME GOES, and this was decided by looking rather than by reading
# the spec. westcampus.md §4.6 puts the band on the spandrel between the canopy
# top and the storefront head. Rendered, that is INVISIBLE on seventeen of the
# twenty-four: the canopy projects 2.60 m and the app cruises at 60-75 deg of
# pitch, so a point on the wall is hidden unless it clears the canopy top by
# 2.60 * tan(24 deg) = 1.16 m — and only the seven genuinely two-storey lobbies
# have that much spandrel. Measured on shots/wclobby-castilian-day.png, whose
# spandrel is 0.80 m: the band was drawn, and nothing of it reached the frame.
# So the name goes on the canopy FASCIA, which is the same citation read the
# other way — §1's whole point is that this canopy "is a signboard with a
# soffit, not a blade". Set WC_NAME_PLACE = "spandrel" to put it back.
WC_NAME_PLACE = "fascia"
WC_NAME_INSET = 0.05     # m of fascia left above and below the band       [A]
WC_NAME_T = 0.10         # m the band is recessed into the fascia          [A]
WC_NAME_PROUD_F = 0.03   # m it stands off the fascia face                 [A]
WC_REVEAL_D = 0.30       # m. C 1.50 > A 1.20 > B 0.65 > D 0.35 > W 0.30: `W`
                         # is the flattest family in the city, on purpose (§3.5)
WC_LEASE_BAYS = 2        # the leasing office window (§4.7)               [A]
WC_GATE_W = 5.50         # m; two lanes of passenger car (§5)             [A]
WC_GATE_H_MAX = 2.90     # m                                              [A]
WC_GATE_HEAD = 0.60      # m of base band kept over the clear opening     [A]
WC_GATE_HEAD_H = 0.35    # m; the head housing that makes it read as a gate [A]
WC_GATE_SEP = 22.0       # m a gate must keep from the lobby              [A]
WC_ROAD_R = 26.0         # m; a named road centreline this close to an elevation
                         # midpoint means that elevation FRONTS it        [A]
WC_PLANE_TOL = 1.6       # m. A STOREFRONT IS A PLANE, NOT A WALL-FOLLOWER, and
                         # this is the whole reason West Campus needs its own
                         # run measurement. wall_run() walks NEARLY COLLINEAR
                         # edges, which is right for a Cret portal in a solid
                         # limestone wall and wrong here: these podia are
                         # tessellated into pier and balcony returns every few
                         # metres, so the collinear walk stops at the first
                         # 0.5 m jog. Measured, it reported a 3.5 m elevation on
                         # The Quarters Sterling House, whose north front is
                         # 71 m, and 4.3 m on The Nine at West Campus, whose
                         # east front is 68 m. So the run is measured in the
                         # wall's own PLANE instead: keep walking while the
                         # vertices stay within this depth of it. A return
                         # shallower than this is behind the glass and invisible
                         # at 200 m; a real corner runs away in depth at once.
WC_RUN_DIST_W = 1.0      # THE ADDRESS NAMES A STREET, NOT A JOG. Overture
                         # tessellates these footprints into balcony returns and
                         # step-backs, and the nearest edge to an address point
                         # is often a 3.5 m stub: measured, SIX of the 24 snapped
                         # onto one (The Nine at West Campus 4.3 m against a 68 m
                         # elevation, Sterling House 3.5 m against 71 m) and a
                         # ten-bay storefront cannot stand on it. So the
                         # elevation is chosen by RUN LENGTH first and distance
                         # second, and this is the exchange rate: one metre of
                         # straight wall is worth one metre of proximity.  [A]
WC_CLAIM_TRIES = 11      # how many WC_CLAIM_SHIFT steps along the wall
WC_CLAIM_R = 1.0         # m — groundfloor-existing.md §5a measured the claimed
                         # perimeter at exactly this radius, so the 142 m it
                         # reports is directly the metres this pass must skip
WC_CLAIM_SHIFT = 3.0     # m per attempt when sliding clear of a claim    [A]
WC_SPEC_AGREE_R = 25.0   # m; a footpath candidate this close to the address
                         # point AND on the address wall is better provenance
WC_BUDGET = 2            # entrances per West Campus building             [A]

# The two name-band trios. BOTH are [S], read off named photographs by an
# earlier pass and already surviving this renderer's transfer at all three
# times of day (js/westcampus.js). NO THIRD COLOUR IS ADDED, and no wordmark
# is drawn: 21 of the 24 lettering treatments are unverified, so what is drawn
# is a lit BAND and the feature carries `nmv: false` so a later pass can find
# them (westcampus.md §8 rule 2).
WC_SIGNW = ("#e6e5e0", "#efe6d6", "#cdd6e4")       # [S] brushed white, backlit
WC_SIGN_WARM = ("#8a4a22", "#b4622c", "#ff8a3c")   # [S] Moontower, lit orange
WC_MULL_DK = STEEL_DK    # where the base band is `sg` — dark anodised
WC_MULL_LT = ALUMINIUM   # where it is `sp`/`sn` — mill finish (§4.5)


# ══════════════════════════════════════════════════════════════════════
#  THE ERA VOCABULARY (docs/entrances/eras.md §3, §4)
#
#  Uniform primitives are the null hypothesis. Every entrance in every
#  family is composed from the same nine parts; the families differ ONLY
#  in which parts are present and in the values below — never in the
#  parts themselves. That is what makes each correction a one-line edit.
#
#  Families are OPT-IN by evidence and E5/NULL is the default. A four-
#  family scheme with no null case gives Chipotle a Paul Cret portal.
# ══════════════════════════════════════════════════════════════════════
FAMILIES = {
    # ── A — Cass Gilbert Spanish Renaissance arcade, 1910-1922. TWO members.
    "A": dict(
        era="gilbert", arched=True,
        open_w=2.60, open_w_sec=2.60,        # [A] clears a pair plus jambs
        leaf_w=DOOR_W, leaf_h=DOOR_H, max_pairs=2,
        spring_h=2.90, arch_rise=1.30,       # [A]/[D] semicircular: rise = w/2
        transom=True, transom_h=1.30,        # arched fanlight fills the head
        surround_w=0.45, surround_proj=0.12, # archivolt band          [A]
        cornice=0.0, sign_band=False,
        reveal_d=1.20, reveal_col=REVEAL_WARM,
        rise=1.00, riser=MONUMENTAL_RISER, tread=FLIGHT_TREAD,   # [A]/[D]
        cheek=True, rail=False,
        canopy=None,                          # the arch IS the canopy   [S]
        leaf_mat="wood", leaf_col=WOOD, glaz_frac=0.40,
        sur_mat="limestone", sur_col=LIMESTONE, glass_col=GLASS_LEADED,
        dt="arched-pair", accent=TERRACOTTA, accent_h=0.30,
    ),
    # ── B — Cret / Greene monumental portal, 1926-1942. The big one.
    "B": dict(
        era="cret", arched=False,
        open_w=7.20, open_w_sec=3.20,        # [A] 3 pairs + stiles + jambs
        leaf_w=DOOR_W, leaf_h=DOOR_H, max_pairs=3,
        spring_h=4.10, arch_rise=0.0,
        transom=True, transom_h=0.90,
        surround_w=0.55, surround_proj=0.15,
        cornice=0.30, sign_band=True,        # architrave + frieze + cornice [A]
        reveal_d=0.65, reveal_col=REVEAL_WARM,
        rise=1.35, riser=MONUMENTAL_RISER, tread=FLIGHT_TREAD,
        cheek=True, rail=False,
        canopy=None,
        leaf_mat="bronze", leaf_col=BRONZE, glaz_frac=0.60,
        sur_mat="limestone", sur_col=LIMESTONE, glass_col=GLASS_BRONZED,
        dt="hinged-quad", accent=None, accent_h=0.0,
    ),
    # ── C — mid-century punched storefront, 1950-1989. The deepest reveal on
    #        campus, and it is sun-shading, not ceremony: PCL's "large windows
    #        purposely inlaid to be well-shaded from the hot Texas sun" [S].
    "C": dict(
        era="midcentury", arched=False,
        open_w=6.00, open_w_sec=3.00,
        leaf_w=COMM_DOOR_W, leaf_h=COMM_DOOR_H, max_pairs=2,
        spring_h=3.05, arch_rise=0.0,        # [A] 10'-0" storefront head
        transom=True, transom_h=0.87,        # [D] 3.05 - 2.134 - 0.044
        surround_w=0.0, surround_proj=0.0,
        cornice=0.0, sign_band=False,
        reveal_d=1.50, reveal_col=REVEAL_COOL,
        rise=0.51, riser=FLIGHT_RISER, tread=UTILITY_TREAD,
        cheek=False, rail=True,
        canopy=dict(proj=2.40, t=0.25, top=3.60, mat="concrete", col=CONCRETE),
        leaf_mat="aluminium", leaf_col=ALUMINIUM, glaz_frac=0.86,
        sur_mat="concrete", sur_col=CONCRETE, glass_col=GLASS_PLATE,
        dt="hinged-quad", accent=None, accent_h=0.0,
        sidelight=1.20,
    ),
    # ── D — modern glazed bay, 1990-2026. The canopy is the identifying
    #        feature and its 0.18 m thickness against C's 0.25 IS the read.
    "D": dict(
        era="modern", arched=False,
        open_w=7.00, open_w_sec=3.40,
        leaf_w=LOBBY_DOOR_W, leaf_h=DOOR_H, max_pairs=2,
        spring_h=6.00, arch_rise=0.0,
        transom=True, transom_h=3.00,        # the curtain wall continues above
        surround_w=0.30, surround_proj=0.25,
        cornice=0.0, sign_band=False,
        reveal_d=0.35, reveal_col=REVEAL_COOL,
        rise=0.34, riser=FLIGHT_RISER, tread=UTILITY_TREAD,
        cheek=False, rail=True,
        canopy=dict(proj=3.20, t=0.18, top=4.20, mat="steel", col=STEEL),
        leaf_mat="glass", leaf_col=STEEL, glaz_frac=0.92,
        sur_mat="steel", sur_col=STEEL, glass_col=GLASS_LOWE,
        dt="hinged-quad", accent=None, accent_h=0.0,
    ),
    # ── E2 — apartments / dormitories outside the Forty Acres.
    "E2": dict(
        era="utility", arched=False,
        open_w=2.20, open_w_sec=2.20,
        leaf_w=COMM_DOOR_W, leaf_h=COMM_DOOR_H, max_pairs=1,
        spring_h=2.40, arch_rise=0.0,
        transom=False, transom_h=0.0,
        surround_w=0.0, surround_proj=0.0,
        cornice=0.0, sign_band=False,
        reveal_d=0.25, reveal_col=REVEAL_COOL,
        rise=FLOOR_RISE, riser=FLIGHT_RISER, tread=UTILITY_TREAD,
        cheek=False, rail=False,
        canopy=dict(proj=1.80, t=0.22, top=3.20, mat="concrete", col=CONCRETE),
        leaf_mat="aluminium", leaf_col=ALUMINIUM, glaz_frac=0.70,
        sur_mat="concrete", sur_col=CONCRETE, glass_col=GLASS_WARM,
        dt="hinged-pair", accent=None, accent_h=0.0,
    ),
    # ── E3 — parking. A ramp is a vehicle entrance, not a door.
    "E3": dict(
        era="utility", arched=False,
        open_w=6.00, open_w_sec=1.10,        # [A] 6.00 x 4.30 vehicle opening
        leaf_w=COMM_DOOR_W, leaf_h=COMM_DOOR_H, max_pairs=1,
        spring_h=4.30, arch_rise=0.0,
        transom=False, transom_h=0.0,
        surround_w=0.0, surround_proj=0.0,
        cornice=0.0, sign_band=False,
        reveal_d=0.80, reveal_col=IRON,
        rise=0.0, riser=FLIGHT_RISER, tread=UTILITY_TREAD,
        cheek=False, rail=False,
        canopy=None,
        leaf_mat="steel", leaf_col=IRON, glaz_frac=0.0,
        sur_mat="concrete", sur_col=CONCRETE, glass_col=GLASS,
        dt="overhead", accent=None, accent_h=0.0,
    ),
    # ── E4 — church / mosque.
    "E4": dict(
        era="utility", arched=True,
        open_w=2.40, open_w_sec=2.40,
        leaf_w=0.95, leaf_h=2.60, max_pairs=1,
        spring_h=2.80, arch_rise=1.20,
        transom=True, transom_h=1.20,
        surround_w=0.30, surround_proj=0.10,
        cornice=0.0, sign_band=False,
        reveal_d=0.60, reveal_col=REVEAL_WARM,
        rise=0.60, riser=MONUMENTAL_RISER, tread=FLIGHT_TREAD,
        cheek=False, rail=True,
        canopy=None,
        leaf_mat="wood", leaf_col=WOOD, glaz_frac=0.25,
        sur_mat="limestone", sur_col=LIMESTONE, glass_col=GLASS_LEADED,
        dt="arched-pair", accent=None, accent_h=0.0,
    ),
    # ── W — West Campus student high-rise lobby, 1965-2023. The one family
    #        whose bay count, glazing height, canopy top and door count are ALL
    #        derived per building and none of which is authored. Its own
    #        assembler (assemble_w) draws the storefront run; everything here
    #        that the generic assembler would also draw is switched off, so no
    #        piece is emitted twice.
    "W": dict(
        era="highrise", arched=False,
        open_w=None, open_w_sec=None,        # DERIVED per building — §3.2
        leaf_w=LOBBY_DOOR_W, leaf_h=DOOR_H, max_pairs=2,
        spring_h=None, arch_rise=0.0,        # DERIVED: the base band, §3.1
        transom=False, transom_h=0.0,        # the storefront bay IS the transom
        surround_w=0.0, surround_proj=0.0,   # no surround: the storefront IS
        cornice=0.0, sign_band=True,         # the frame
        reveal_d=WC_REVEAL_D, reveal_col=REVEAL_COOL,
        rise=0.0, riser=FLIGHT_RISER, tread=UTILITY_TREAD,
        cheek=False, rail=False,             # rail ONLY where rise > 0. A
                                             # handrail on a flat threshold is a
                                             # defect you can see (§3.6)
        canopy=None,                         # drawn by assemble_w over the RUN,
                                             # not over the door bank
        leaf_mat="glass", leaf_col=STEEL_DK, glaz_frac=0.92,
        sur_mat="aluminium", sur_col=ALUMINIUM, glass_col=GLASS_LOWE,
        dt="hinged-pair", accent=None, accent_h=0.0,
    ),
    # ── E5 — NULL. Everything else, and every unknown. Deliberately dull.
    #        A dull correct door on an unknown building is honest; a Cret portal
    #        on an unknown building is a lie you can see from 400 m.
    "E5": dict(
        era="utility", arched=False,
        open_w=2.20, open_w_sec=1.20,
        leaf_w=COMM_DOOR_W, leaf_h=COMM_DOOR_H, max_pairs=1,
        spring_h=2.30, arch_rise=0.0,
        transom=False, transom_h=0.0,
        surround_w=0.0, surround_proj=0.0,
        cornice=0.0, sign_band=False,
        reveal_d=0.15, reveal_col=REVEAL_COOL,
        rise=FLOOR_RISE, riser=FLIGHT_RISER, tread=UTILITY_TREAD,
        cheek=False, rail=False,
        canopy=None,
        leaf_mat="aluminium", leaf_col=ALUMINIUM, glaz_frac=0.75,
        sur_mat="concrete", sur_col=CONCRETE, glass_col=GLASS,
        dt="hinged-pair", accent=None, accent_h=0.0,
    ),
}


# ══════════════════════════════════════════════════════════════════════
#  THE CELEBRATED OVERRIDE TABLE — docs/entrances/celebrated.md
#
#  Keyed on the building's three-letter ref, in the same spirit as
#  capitol_overrides: one glance tells you which portals are authored.
#  `at` is an explicit portal position and is ONLY present where a source
#  gives coordinates. Where the doc gives a compass direction but no
#  coordinate, `facade` biases the generic selection toward that side
#  instead of fabricating a point — see FACADE_BONUS.
#
#  Confidence marks are kept verbatim from the doc. Do not strip them:
#  roughly 45% of the per-portal fields are [U] authoring defaults, and
#  knowing which half is real is half the value of the table.
# ══════════════════════════════════════════════════════════════════════
CELEBRATED = {
    # ── Tier 1 — hand-authored ────────────────────────────────────────
    "MAI": dict(
        fam="B", tier=1,
        at=[(-97.739416, 30.285759, "main"),    # [M] OSM entrance=main
            (-97.739743, 30.285955, "secondary"),  # [M] entrance=yes, west wing
            (-97.738982, 30.285980, "secondary")], # [M] entrance=yes, east wing
        open_w=7.20, n=4, dt="hinged-quad", mat="bronze",  # [U] leaves/material
        risers=5, rail=False, cheek=True,       # [U]
        sur_col=LIMESTONE,                      # [C] Texas shell stone surround
        columns=2,                              # [C] pilasters, NOT a colonnade
        sign=True,                              # [C] the inscription band
        note="Portal sits in a RECESSED centre bay between two projecting "
             "wings [M]. Inscription in two clauses either side of the seal [C].",
    ),
    "BTL": dict(
        fam="A", tier=1, facade="E",            # [C] and strongly so
        at=[(-97.74015, 30.28541, "main")],     # [D] centre of the east wall
        open_w=2.60, n=2, dt="arched-pair", mat="wood",   # [U]
        risers=3, rail=False, cheek=True,       # [U]
        sur_col=LIMESTONE_ALT,                  # [C] Cordova Creme, Featherlite
        lanterns=2,                             # [C] Gilbert's own spec, $800
        note="Two wrought-iron lanterns flank the main door [C] — the single "
             "most recognisable thing about this entrance. NO inscription: two "
             "sources explicitly record none [M]. Carve nothing.",
    ),
    "SUT": dict(
        fam="A", tier=1, facade="N",            # [C] the 1982 renovation moved it
        at=[(-97.74083, 30.28509, "main")],     # [D] centre of the north wall
        open_w=2.60, n=2, dt="arched-pair", mat="wood",   # [U] 1982 insertion:
                                                # aluminium is at least as likely
        risers=3, rail=False, cheek=True,       # [U]
        sur_col=LIMESTONE,                      # [C] limestone to the 1st floor
        lanterns=2,                             # [C] custom iron lanterns
        note="NORTH is a trap: the present main entrance was CREATED on the "
             "north facade by the 1982 renovation [C]. The vaulted arcade's "
             "side is unresolved — not drawn. No inscription found.",
    ),
    "GRE": dict(
        fam="B", tier=1, facade="W",
        at=[(-97.736834, 30.284010, "main")],   # [M] OSM entrance=main
        arched=True,                            # [S] "a set of grand arches"
        open_w=6.40, n=4, dt="arched-pair", mat="wood",   # [U]
        risers=7, rail=False, cheek=True,       # [U] "ornate stone staircases"
        wall_col=BRICK, sur_col=CASTSTONE,      # [S] UT-blend brick, cast stone
        note="The stone staircase is called out as part of the entrance [S] — "
             "the one building on the list where the stair is the feature. "
             "Generous width. Arched opening in family B, per-building override.",
    ),
    "GAR": dict(
        fam="B", tier=1,
        open_w=3.60, n=2, dt="hinged-pair", mat="wood",   # [U]
        risers=3, rail=False, cheek=True,       # [U]
        sign=True, accent=TERRACOTTA,
        note="THE lettering building. Carved founders of the Republic below the "
             "eaves: HOUSTON AUSTIN BURNET JONES TRAVIS LAMAR [C], 'among them' "
             "so six is a floor not a total. 32 terra-cotta cattle brands [C] — "
             "the individual brand shapes are documented nowhere, so abstract "
             "medallions or none. Limestone longhorn skulls and terracotta cacti "
             "AT THE ENTRANCES [C]: the accent band is that.",
    ),
    "HMA": dict(
        fam="B", tier=2,                        # DEMOTED: zero sources on the portal
        open_w=5.40, n=4, dt="hinged-quad", mat="bronze",  # [U] all of it
        risers=5, rail=False, cheek=True,
        note="Demoted from tier 1 by celebrated.md's own recommendation: no "
             "description of the entrance, doors, surround or lettering was "
             "found. Hand-authoring from zero sources is how you get a "
             "confident wrong answer. Family B generic, no inscription.",
    ),
    "GOL": dict(
        fam="B", tier=2,
        open_w=4.20, n=4, dt="hinged-quad", mat="bronze",  # [U]
        risers=3, rail=False, cheek=True,
        courtyard=True,
        note="Wraps a courtyard, so it has an INWARD-facing entrance as well as "
             "street ones [D]. A pass that only ever puts doors on the outer "
             "hull misses the door people actually use.",
    ),
    "LFH": dict(
        fam="E5", tier=2,                       # Littlefield HOUSE, 1894
        open_w=2.00, n=2, dt="hinged-pair", mat="wood",
        risers=4, rail=True, cheek=False,
        note="1894 Victorian. The ROOF is the identity here, not the door [D] — "
             "multicoloured slate and two mismatched towers. Deliberately given "
             "the NULL door. Do not confuse with Littlefield Dormitory (LTD) or "
             "the Carriage House (LCH): three different buildings.",
    ),
    "LBJ": dict(
        fam="D", tier=1,
        open_w=5.00, n=4, dt="hinged-quad", mat="glass",   # [U]
        risers=0, rail=False, cheek=False, canopy=False,
        note="The opposite problem to everyone else: it barely has a door. An "
             "unadorned ten-storey travertine monolith [C], east and west walls "
             "eight feet thick at the base. DO NOT put a shopfront-style glazed "
             "band on a windowless travertine wall — that is the specific "
             "failure mode here. Canopy suppressed; one modest opening only. "
             "The 90,000 sq ft plaza is not in the building file at all.",
    ),
    "BMA": dict(
        fam="D", tier=1,
        open_w=4.60, n=4, dt="hinged-quad", mat="glass",
        risers=0, rail=False, cheek=False,
        reveal_col=ARCH_SHADOW, arched=True,    # [C] inverted arch over the door
        note="Entrance is in the MIDDLE of a loggia [C], a void in a painted "
             "colonnade, not a glass box on a blank wall. Changed in 2023 "
             "(Snohetta); any pre-2023 reference is wrong. Petals NOT drawn: no "
             "petal count was established and a wrong number is instantly "
             "visible. Two-building campus — Michener and Smith.",
    ),
    "HRC": dict(
        fam="D", tier=1, facade="S",
        at=[(-97.740931, 30.284281, "main")],   # [M] OSM entrance=main, SE
        open_w=6.00, n=4, dt="sliding", mat="glass",       # [U] 2003 accessible
        risers=0, rail=False, cheek=False,
        night=HRC_NIGHT_GLOW,
        note="Ground floor = etched glass, everything above = the original blank "
             "stone box; that contrast IS the building [D]. The glass walls "
             "'serve as a beacon for the campus' at night [C], so this gets the "
             "brightest wn in the pass. Etched imagery modelled as translucent "
             "frit, never as legible pictures.",
    ),
    "TMM": dict(
        fam="B", tier=1, facade="W",            # [C] "bronze west doors"
        open_w=4.20, n=4, dt="hinged-quad", mat="bronze",
        risers=5, rail=False, cheek=True,
        note="THE BRONZE REFERENCE. The only entrance in the whole document "
             "whose door material is STATED in a source rather than assumed "
             "[C]. Every other bronze in this file is an analogy to this one.",
    ),
    "UNB": dict(
        fam="B", tier=2,                        # facade unverified — see note
        open_w=5.40, n=4, dt="hinged-quad", mat="bronze",
        risers=3, rail=False, cheek=True,
        wall_col=ASHLAR,
        note="THE BIGGEST HOLE IN THE SPEC. No source states which elevation "
             "the main door is on and OSM has no node, so NO coordinate is "
             "authored here — the generic pass places it and family B dresses "
             "it. Simeon says the Union carries carved inscriptions; that may "
             "well be true and it could not be sourced. CARVE NOTHING.",
    ),
    # ── Tier 2 — correct facade and leaf count, generic surround ──────
    "PCL": dict(
        fam="C", tier=2,
        open_w=6.00, n=4, dt="sliding", mat="aluminium",   # [U] leaf count
        risers=0, plaza_z=3.46,                 # [S] entrance is on the 2nd floor
        rail=False, cheek=False,
        note="THE PLAZA EXCEPTION [S]: 'the entrance to the library is on the "
             "SECOND FLOOR, accessible from a plaza'. So NO flight at the door "
             "— the rise is taken by the plaza, which is ground-pass geometry. "
             "Any generator that puts a 4 m flight on PCL's ground-floor wall "
             "has drawn a door that does not exist. The Texas-shaped-plan story "
             "is false; the University calls it a rhomboid.",
    ),
    "GDC": dict(
        fam="D", tier=2, facade="W",            # [M] main faces Speedway
        open_w=7.00, n=4, dt="hinged-quad", mat="glass",
        risers=0, rail=False, cheek=False,
        note="Six measured OSM nodes — the best-documented building on the list "
             "[M]. Two staircase entrances are a real feature, not noise. "
             "Neighbour warning: POB has five more nodes including an exit — "
             "different building, do not merge.",
    ),
    "PAC": dict(
        fam="D", tier=2,
        open_w=8.00, n=6, dt="hinged-quad", mat="glass",   # [U] genre, not fact
        risers=2, rail=True, cheek=False,
        note="Bass Concert Hall, named 'College of Fine Arts Performing Arts "
             "Center' in the snapshot [M]. No architectural description found; "
             "a wide glazed lobby band under a canopy is genre knowledge.",
    ),
    "PAI": dict(
        fam="B", tier=2,
        open_w=3.60, n=2, dt="hinged-pair", mat="bronze",
        risers=4, rail=False, cheek=True,
        note="No OSM node, no description. Everything [U]. Kept only because it "
             "sits next to Welch and the Tower and will be seen.",
    ),
    "WAG": dict(
        fam="B", tier=2,
        open_w=3.20, n=2, dt="hinged-pair", mat="bronze",
        risers=3, rail=False, cheek=True,
        note="THE REGRESSION FIXTURE. Five measured OSM entrance nodes on four "
             "sides [M], more than any celebrated building. Use it to test the "
             "generic pass against ground truth before trusting it on 355 more.",
    ),
    # ── Tier 3 with a leaf-count override only ────────────────────────
    "JES": dict(fam="C", tier=3, open_w=6.00, n=4, dt="hinged-quad",
                mat="aluminium", risers=1, rail=True, cheek=False,
                note="Biggest doorway count on campus; its interest is VOLUME, "
                     "not design. Plain recessed glass under concrete."),
    "WEL": dict(fam="C", tier=3, open_w=6.00, n=4, dt="hinged-quad",
                mat="aluminium", risers=2, rail=True, cheek=False,
                note="Demoted out of tier 1: the public face is dominated by "
                     "the later addition and no celebrated portal was found."),
}

# Inscriptions. THE SCHEMA HAS NO TEXT FIELD, so a `sign` piece carries the
# BAND and this table carries the words. A renderer that wants to letter them
# reads them from here by ref. Nothing is invented: celebrated.md carves nothing
# it could not cite, and neither does this.
INSCRIPTIONS = {
    # [C] John 8:32 KJV, chosen by the Faculty Building Committee under
    # Dr William Battle, approved by the Board of Regents 28 September 1935.
    # Two clauses either side of the University seal; twelve words; a length
    # limit of 108 letters and spaces. Sources DISAGREE on the comma — the
    # Alcalde prints one, Nicar does not. Carved here WITHOUT it, and flagged.
    "MAI": ["YE SHALL KNOW THE TRUTH", "AND THE TRUTH SHALL MAKE YOU FREE"],
    # [C] founders of the Republic of Texas, carved below the eaves and at the
    # corner windows. The source says "among them", so this is a FLOOR, not a
    # total, and the window carvings may be full names — unresolved.
    "GAR": ["HOUSTON", "AUSTIN", "BURNET", "JONES", "TRAVIS", "LAMAR"],
}

# UT building codes for buildings OSM does not carry a `ref` on. These are the
# real codes, matched on the snapshot's exact `name` string. Authored, and
# marked as such so nobody mistakes them for an OSM tag.
NAME_TO_REF = {
    "Goldsmith Hall": "GOL",
    "Robert A. Welch Hall": "WEL",
    "Welch Hall": "WEL",
}

# eras.md §6 — the fallback named list, keyed on ref. The named list beats any
# date test, because a date is a proxy and a name is evidence.
FAMILY_BY_REF = {}
for _r in ("BTL", "SUT"):
    FAMILY_BY_REF[_r] = "A"
for _r in ("MAI", "GAR", "GRE", "WAG", "GOL", "GEA", "WCH", "PAI", "UNB",
           "HMA", "HRH", "GEB", "EPS", "AHG", "TMM", "MEZ", "BEN", "BAT",
           "PAR", "CAL"):
    FAMILY_BY_REF[_r] = "B"
for _r in ("JES", "JCD", "PCL", "WEL", "BUR", "SRH", "BEL", "FAC", "JON",
           "ECJ", "HRC", "ART", "RLM", "GRG", "MEZ"):
    FAMILY_BY_REF.setdefault(_r, "C")
for _r in ("GDC", "EER", "NHB", "BMA", "RRH", "WCP", "BMC", "HDB", "HTB",
           "GLT", "NMS", "MBB", "SSB", "CBA", "RAP", "LBJ", "PAC", "POB",
           "MNAC", "DFA"):
    FAMILY_BY_REF[_r] = "D"
# Explicitly NULL — do not give these a family. 1850s Greek Revival, a Victorian
# house, and plant. Writing a fifth monumental vocabulary for two buildings that
# sit 700 m south of the Forty Acres is not worth it in this pass.
NULL_REFS = set(("LFH", "LCH", "JHH", "ANB"))
NULL_NAME_PARTS = ("chilling station", "cooling tower", "power plant",
                   "facilities complex", "sign shop", "field support",
                   "arno nowotny", "hargis hall", "carriage house")

# ══════════════════════════════════════════════════════════════════════
#  THE 24 WEST CAMPUS BUILDINGS — westcampus.md §6, keyed on the exact
#  `name` string in the Overture snapshot (all 24 match, checked every
#  bake by the assertion in main()).
#
#  Only THREE things here are typed per building and each is [S]:
#    `side` — the compass of the elevation the STREET ADDRESS is on.
#             22 of 24 are a looked-up address cross-checked against the
#             repo's own road centrelines; the other two (The Block, The
#             G) rest on the footprint-vs-address reconciliation argued
#             in westcampus.md §0.
#    `at`   — (lon, lat) on that elevation, snapped to an OSM footway
#             dead-end where one exists within 6 m.
#    `band` — the measured ground-floor band height, retyped from
#             scripts/bake_westcampus.py's BUILDINGS[name]["base"][0],
#             with its facade family. That file is another lane's and is
#             read-only here; the numbers are asserted against the doc.
#
#  EVERYTHING ELSE IS DERIVED IN THE BAKE — bay count from the measured
#  wall run, glazing height from `band`, leaf count from the bays, canopy
#  top from the glazing height, mullion colour from the base family. If a
#  building comes out with the wrong number of doors the wall run is
#  wrong, not the count.
#
#  `steps` is [M] on all three: The G has four OSM `steps`/`footway` ends
#  on its Guadalupe wall, Crest at Pearl five footway ends on MLK, and
#  The Castilian sits above San Antonio. Nobody else gets a rise and
#  nobody else gets a rail.
#
#  `gate` is the WEAKEST column in the document — 2 of 24 sourced. It is
#  therefore not typed except where it is sourced: "auto" asks the bake
#  to apply westcampus.md §8's rule (a gate only on a footprint that
#  fronts more than one named road, on the shortest non-address
#  elevation) and every such gate carries `gtv: false`. A generator that
#  puts a confident garage door on all 24 has fabricated 22 of them.
# ══════════════════════════════════════════════════════════════════════
WC_LOBBIES = {
    # ── the towers ────────────────────────────────────────────────────
    "21 Rio": dict(side="W", at=(-97.74495, 30.28414), band=(6.20, "sg"),),  # 2101 Rio Grande St [S]
    "Dobie Twenty21": dict(side="E", at=(-97.74090, 30.28364), band=(6.00, "sp"),
                           gate="E"),                  # garage 2005 Whitis [S]
    "The Castilian": dict(side="W", at=(-97.74264, 30.28762), band=(4.60, "sp"),
                          steps=True, gate="W"),       # levels 2-10 are deck [S]
    "The Callaway House Austin": dict(side="N", at=(-97.74385, 30.28506),
                                      band=(5.40, "sp")),
    "Ion Austin": dict(side="E", at=(-97.74305, 30.28405), band=(7.00, "sg"),
                       gate="auto"),                   # 260-car garage [S]
    "Skyloft Austin": dict(side="N", at=(-97.74372, 30.28650), band=(6.20, "sg"),),
    "Moontower": dict(side="E", at=(-97.74295, 30.28567), band=(7.40, "sg"),
                      sign="warm", gate="auto"),       # lit orange wordmark [S]
    "Inspire on 22nd": dict(side="E", at=(-97.74399, 30.28530), band=(6.00, "sg"),
                            gate="auto"),
    "Signature 1909": dict(side="W", at=(-97.74498, 30.28390), band=(5.20, "sg"),),  # Cambridge Tower is the odd one out and is flagged rather than averaged
    # away: a 1964-65 Thomas E. Stanley New Formalism condominium on the
    # National Register with 24-hour concierge and an ATTENDED garage [S] —
    # which means a porte-cochere, not a flat 2.60 m canopy. No leasing office
    # and no lit name band. Every number in its entry is [A].
    "Cambridge Tower": dict(side="W", at=(-97.74052, 30.28075), band=(5.00, "sg"),
                            sign=None, lease=0, gate="auto",
                            canopy=(6.50, 0.40, 4.60)),
    # ── the mid-rise blocks ───────────────────────────────────────────
    "The Standard": dict(side="N", at=(-97.74620, 30.28724), band=(7.00, "sg"),),
    "Rambler": dict(side="E", at=(-97.74295, 30.29045), band=(4.60, "sn"),),  # Institutional, not retail: ~10,000 sf of academic space including the UT
    # International Office [S]. A second storefront entrance, and NO name band.
    "2400 Nueces": dict(side="E", at=(-97.74310, 30.28805), band=(5.00, "sp"),
                        sign=None),
    "The Quarters Grayson House": dict(side="S", at=(-97.74640, 30.28538),
                                       band=(5.00, "sn")),
    "The Quarters Sterling House": dict(side="N", at=(-97.74645, 30.28525),
                                        band=(5.00, "sn")),
    "The Nine at Rio": dict(side="E", at=(-97.74511, 30.28416), band=(4.40, "sg"),),  # shallowest band in the set: a
                                            # two-storey lobby does NOT fit here
    "The Nine at West Campus": dict(side="E", at=(-97.74905, 30.29089),
                                    band=(4.60, "sg")),
    "The Block": dict(side="E", at=(-97.74922, 30.29058), band=(5.40, "sg"),),  # 2510 Leon St, §0
    "Block on 25th East": dict(side="S", at=(-97.74595, 30.28941),
                               band=(5.00, "sp")),
    "Crest at Pearl": dict(side="S", at=(-97.74607, 30.28300), band=(4.60, "sg"),
                           steps=True),
    "Pointe on Rio": dict(side="W", at=(-97.74509, 30.28274), band=(5.00, "sg"),),  # 1901 Rio Grande St, §0
    "Twenty Two 15": dict(side="W", at=(-97.74476, 30.28630), band=(5.20, "sp"),),
    "The Venue on Guadalupe": dict(side="W", at=(-97.74216, 30.29434),
                                   band=(5.00, "sg")),
    # The strongest placement evidence in the whole set: four `steps`/`footway`
    # ends on the Guadalupe (west) wall [M]. The shipped file's main door for
    # this building is on W 18th (north) and is WRONG — westcampus.md §2.2. The
    # authored point wins clustering, so the swap happens by construction.
    "The G": dict(side="W", at=(-97.74202, 30.28031), band=(5.20, "sp"),
                  steps=True),
}

# Overture building_class -> family, when nothing better is known.
CLASS_FAMILY = {
    "parking": "E3",
    "church": "E4",
    "mosque": "E4",
    "apartments": "E2",
    "residential": "E2",
    "house": "E2",
    "detached": "E2",
    "dormitory": "E2",
}
# E1 — draw nothing. bake_places.py and js/drag.js already own these frontages
# with their own SHOP_DATUM / SIGN_H / BULKHEAD / PROUD; a second entrance on top
# is a double-draw. Only the RETAIL hosts are excluded: a POI inside a dining
# hall must not disqualify the dining hall's own doors.
PLACES_EXCLUDE_CLASSES = (None, "commercial", "retail", "office", "post_office")


# ══════════════════════════════════════════════════════════════════════
#  FROZEN OSM TABLES
#
#  Fetched 2026-08-04 from https://overpass.kumi.systems/api/interpreter
#  (overpass-api.de rate-limits after two queries; the mirror answers).
#  bbox 30.2760,-97.7480,30.2960,-97.7220.
#
#      node["entrance"](bbox);           out body;   -> 91 nodes
#      way["building"](bbox);            out tags center;  -> 2,442 ways,
#          of which 384 carry ref or name, 177 carry ref, 5 carry start_date
#          and ZERO carry building:material.
#
#  They live here rather than in data/osm_cache/ for one reason: this pass owns
#  exactly one output file and writing a second would break the lane rule. If a
#  later pass caches them properly, this file prefers the cache automatically —
#  see load_osm(). `--refresh` re-queries and prints replacement tables.
#
#  `mat` and `era` CANNOT be derived from any of this: zero building:material
#  and five start_date across 2,442 ways. They are the authored tables above,
#  or nothing. Do not let a generator guess them.
# ══════════════════════════════════════════════════════════════════════
OSM_FETCH_DATE = "2026-08-04"
OSM_ENTRANCES = None        # filled from _tables below
OSM_BUILDING_TAGS = None

# (lon, lat, entrance, door, wheelchair)
_ENTRANCE_ROWS = [
    (-97.7381384, 30.2761092, 'yes', None, None),
    (-97.7390969, 30.2761718, 'yes', None, 'yes'),
    (-97.7476280, 30.2761926, 'yes', None, None),
    (-97.7385652, 30.2762220, 'yes', None, None),
    (-97.7473994, 30.2764474, 'main', None, None),
    (-97.7404292, 30.2765262, 'yes', None, 'yes'),
    (-97.7415183, 30.2766873, 'staircase', None, None),
    (-97.7474078, 30.2767723, 'yes', None, None),
    (-97.7478101, 30.2768806, 'yes', None, None),
    (-97.7473312, 30.2769750, 'yes', None, None),
    (-97.7394069, 30.2777802, 'yes', None, None),
    (-97.7394921, 30.2780864, 'main', None, None),
    (-97.7387642, 30.2783364, 'yes', 'hinged', None),
    (-97.7387542, 30.2784325, 'yes', 'hinged', None),
    (-97.7384362, 30.2792199, 'staircase', 'hinged', None),
    (-97.7390011, 30.2792472, 'main', None, None),
    (-97.7384307, 30.2792896, 'parking', 'hinged', 'yes'),
    (-97.7396854, 30.2794368, 'yes', None, None),
    (-97.7392138, 30.2795662, 'yes', None, None),
    (-97.7275370, 30.2795769, 'yes', None, None),
    (-97.7381308, 30.2797245, 'yes', None, None),
    (-97.7382263, 30.2798152, 'staircase', 'hinged', None),
    (-97.7387624, 30.2798757, 'staircase', 'hinged', None),
    (-97.7381961, 30.2799461, 'yes', 'hinged', None),
    (-97.7421107, 30.2799470, 'main', None, None),
    (-97.7395687, 30.2803476, 'emergency', 'hinged', None),
    (-97.7395463, 30.2804084, 'emergency', 'hinged', None),
    (-97.7394972, 30.2805421, 'emergency', 'hinged', None),
    (-97.7394692, 30.2806182, 'emergency', 'hinged', None),
    (-97.7311630, 30.2814021, 'main', None, None),
    (-97.7329307, 30.2814386, 'main', None, None),
    (-97.7339747, 30.2820200, 'yes', None, None),
    (-97.7369646, 30.2820939, 'yes', None, None),
    (-97.7322756, 30.2824885, 'main', None, None),
    (-97.7356819, 30.2835970, 'main', None, None),
    (-97.7354541, 30.2836182, 'main', None, None),
    (-97.7312983, 30.2838653, 'yes', None, None),
    (-97.7338097, 30.2839189, 'yes', None, None),
    (-97.7368337, 30.2840096, 'main', None, None),
    (-97.7409309, 30.2842813, 'main', None, None),
    (-97.7387168, 30.2843682, 'yes', None, None),
    (-97.7398544, 30.2848797, 'yes', None, None),
    (-97.7323084, 30.2849276, 'yes', None, None),
    (-97.7324158, 30.2849346, 'main', None, None),
    (-97.7375159, 30.2849381, 'yes', None, None),
    (-97.7325256, 30.2849418, 'yes', None, None),
    (-97.7377244, 30.2849456, 'yes', None, None),
    (-97.7377075, 30.2851141, 'yes', None, None),
    (-97.7374830, 30.2852660, 'yes', None, None),
    (-97.7376909, 30.2852800, 'yes', None, None),
    (-97.7359535, 30.2856022, 'yes', None, None),
    (-97.7376535, 30.2857477, 'yes', None, None),
    (-97.7394161, 30.2857591, 'main', None, None),
    (-97.7315884, 30.2858228, 'yes', None, None),
    (-97.7360358, 30.2859323, 'yes', None, None),
    (-97.7315748, 30.2859458, 'yes', None, None),
    (-97.7397431, 30.2859549, 'yes', None, None),
    (-97.7389819, 30.2859798, 'yes', None, None),
    (-97.7366457, 30.2859821, 'yes', None, None),
    (-97.7368425, 30.2859976, 'staircase', None, None),
    (-97.7357880, 30.2860865, 'exit', None, None),
    (-97.7364767, 30.2862017, 'yes', None, None),
    (-97.7364723, 30.2862470, 'yes', None, None),
    (-97.7366828, 30.2862556, 'main', None, None),
    (-97.7373899, 30.2862733, 'yes', None, None),
    (-97.7367912, 30.2865290, 'staircase', None, None),
    (-97.7365561, 30.2865704, 'yes', None, None),
    (-97.7366951, 30.2865885, 'yes', None, None),
    (-97.7362684, 30.2868494, 'exit', None, None),
    (-97.7368594, 30.2869001, 'yes', None, None),
    (-97.7361794, 30.2870921, 'yes', None, None),
    (-97.7365386, 30.2871335, 'main', None, None),
    (-97.7360406, 30.2874224, 'yes', None, None),
    (-97.7372597, 30.2874939, 'yes', None, None),
    (-97.7324657, 30.2875084, 'staircase', None, None),
    (-97.7333252, 30.2875301, 'staircase', None, None),
    (-97.7359240, 30.2876250, 'yes', None, None),
    (-97.7364137, 30.2876272, 'yes', None, None),
    (-97.7350987, 30.2879360, 'yes', None, None),
    (-97.7356463, 30.2883076, 'yes', None, None),
    (-97.7400149, 30.2886966, 'yes', None, None),
    (-97.7401766, 30.2887123, 'main', None, None),
    (-97.7355877, 30.2887801, 'yes', None, None),
    (-97.7356340, 30.2897560, 'yes', None, None),
    (-97.7355931, 30.2898318, 'yes', None, None),
    (-97.7392699, 30.2899436, 'emergency', None, None),
    (-97.7361592, 30.2899888, 'yes', None, None),
    (-97.7357692, 30.2903575, 'yes', None, None),
    (-97.7364841, 30.2904183, 'yes', None, None),
    (-97.7402497, 30.2915233, 'main', None, None),
    (-97.7402574, 30.2916535, 'emergency', None, None),
]

# (lon, lat, ref, name, building, amenity, start_date)
_BUILDING_ROWS = [
    (-97.741141, 30.275853, None, 'Texas Supreme Court Building', 'yes', 'courthouse', None),
    (-97.741555, 30.275877, None, 'Tom C. Clark Building', 'yes', None, None),
    (-97.744569, 30.275907, None, 'Executive Office Building', 'yes', None, None),
    (-97.744106, 30.275933, None, 'Penthouse Condos', 'yes', None, None),
    (-97.737847, 30.275975, None, 'Texas Workforce Commission Annex', 'public', None, None),
    (-97.745291, 30.276120, None, 'Texas Association of Counties', 'yes', None, None),
    (-97.733023, 30.276177, 'DCP', 'Denton A. Cooley Pavillion', 'university', None, None),
    (-97.738956, 30.276210, None, 'Texas Workforce Commission', 'yes', None, None),
    (-97.742031, 30.276224, None, 'Daniel Price Sr. State Office Building', 'yes', None, None),
    (-97.743905, 30.276361, None, 'Cornerstone Building', 'yes', None, None),
    (-97.734145, 30.276392, 'DSMC', 'Dell Seton Medical Center at the University of Texas', 'hospital', None, None),
    (-97.744402, 30.276499, None, "St David's Foundation", 'yes', None, None),
    (-97.735393, 30.276500, 'HCG', 'Health Center Garage', 'parking', 'parking', None),
    (-97.739657, 30.276532, None, 'Capitol Checkpoint North', 'yes', None, None),
    (-97.747709, 30.276535, None, 'Rio Grande Campus 1000 Building', 'college', None, None),
    (-97.737297, 30.276604, None, 'Megabus', 'yes', 'bus_station', None),
    (-97.740402, 30.276672, None, 'John H. Reagan Building', 'yes', None, None),
    (-97.729611, 30.276691, None, "Denny's", 'yes', 'restaurant', None),
    (-97.742044, 30.276738, None, 'PostNet', 'yes', 'post_office', None),
    (-97.722178, 30.276761, None, 'Corinth Baptist Church', 'church', 'place_of_worship', None),
    (-97.741869, 30.276817, None, 'Wahrenberger House', 'yes', None, None),
    (-97.742009, 30.276835, None, 'William Paul Floral Design', 'yes', None, None),
    (-97.732201, 30.276940, 'ERC', 'Permanently CLOSED: Frank Erwin Center', 'ruins', None, None),
    (-97.741966, 30.276954, None, 'Texas Chili Parlor', 'yes', 'restaurant', None),
    (-97.742718, 30.277111, None, 'South by Southwest', 'office', None, None),
    (-97.747513, 30.277113, None, 'Rio Grande Campus Annex', 'college', None, None),
    (-97.741368, 30.277113, None, 'Texas Law Center', 'public', None, None),
    (-97.737504, 30.277115, None, 'State Parking Garage P', 'yes', 'parking', None),
    (-97.738317, 30.277124, None, 'Robert E. Johnson State Legislative Office Building', 'yes', None, None),
    (-97.729246, 30.277179, 'AUSIMDT', 'DoubleTree by Hilton Austin - University Area', 'yes', None, None),
    (-97.735119, 30.277189, 'HTB', 'Health Transformation Building', 'hospital', None, None),
    (-97.738139, 30.277274, None, 'Robert E. Johnson Conference Center', 'yes', None, None),
    (-97.742530, 30.277371, 'AUSFLDT', 'DoubleTree Suites by Hilton Austin Downtown Capitol', 'yes', None, None),
    (-97.744080, 30.277522, None, 'Mauthe Myrick Building', 'yes', None, None),
    (-97.736333, 30.277680, None, 'Scholz Garten', 'yes', 'pub', None),
    (-97.736919, 30.277694, None, 'State Parking Garage Q', 'yes', 'parking', None),
    (-97.743474, 30.277725, None, 'Texas Medical Association', 'yes', None, None),
    (-97.739518, 30.277814, None, 'Gethsemane Church', 'church', None, None),
    (-97.739829, 30.277848, None, 'Luther Hall', 'yes', None, None),
    (-97.737702, 30.277956, None, 'Lyndon B. Johnson Building', 'public', None, None),
    (-97.744478, 30.277967, None, 'uBreakiFix', 'yes', None, None),
    (-97.740289, 30.277997, None, 'Carrington–Covert House', 'yes', None, None),
    (-97.744434, 30.278087, '14916', 'Starbucks', 'yes', 'cafe', None),
    (-97.742234, 30.278087, None, 'William P. Clements, Jr. Building', 'public', None, None),
    (-97.734685, 30.278121, 'HDB', 'Health Discovery Building', 'hospital', None, None),
    (-97.738526, 30.278137, None, 'Barbara Jordan State Office Building', 'yes', None, None),
    (-97.739449, 30.278217, None, 'Diocese of Austin Chancery', 'church', 'place_of_worship', None),
    (-97.731018, 30.278246, 'ANB', 'Arno Nowotny Building', 'university', None, None),
    (-97.738789, 30.278275, None, 'Gulf Coast Portal', 'yes', None, None),
    (-97.745481, 30.278307, None, 'Wells Fargo', 'yes', 'bank', None),
    (-97.743273, 30.278329, None, 'Moody Bank Tower', 'office', None, None),
    (-97.732025, 30.278364, 'JHH', 'John W. Hargis Hall', 'university', None, None),
    (-97.738735, 30.278428, None, 'Big Bend Country Portal', 'yes', None, None),
    (-97.733447, 30.278494, 'WAT', 'Arthur P. Watson House', 'yes', None, None),
    (-97.736821, 30.278657, None, 'State Parking Garage R', 'yes', 'parking', None),
    (-97.733045, 30.278768, 'CDL', 'Collections Deposit Library', 'university', 'library', None),
    (-97.740030, 30.278788, None, 'Capitol Complex North Central Utility Plant', 'yes', None, None),
    (-97.737928, 30.279049, None, 'William B. Travis Building', 'yes', None, None),
    (-97.733880, 30.279084, 'TRG', 'Trinity Garage', 'garage', 'parking', None),
    (-97.745376, 30.279099, None, "St. Martin's Ev. Lutheran Church", 'church', 'place_of_worship', None),
    (-97.738454, 30.279173, None, 'Hill Country Portal', 'yes', None, None),
    (-97.741651, 30.279213, None, 'Enchanted Florist', 'yes', None, None),
    (-97.722747, 30.279232, None, 'Magnolia', 'apartments', None, None),
    (-97.722407, 30.279256, None, 'Taylor Law', 'yes', None, None),
    (-97.738408, 30.279295, None, 'South Texas Plains Portal', 'yes', None, None),
    (-97.742846, 30.279308, 'UTA', 'UT Administration Building', 'university', None, None),
    (-97.725699, 30.279335, None, 'J. Dan Brown Family Player Development Center', 'yes', None, None),
    (-97.741628, 30.279339, 'AUSAUGI', 'Hilton Garden Inn', 'yes', None, '2021-08-27'),
    (-97.739342, 30.279343, None, 'Stephen F. Austin State Office Building', 'yes', None, None),
    (-97.725003, 30.279345, 'FPC', 'OFPC Field Staff Office', 'office', None, None),
    (-97.740335, 30.279425, None, 'Spectrum News', 'yes', 'studio', None),
    (-97.742086, 30.279435, None, 'The Linden', 'construction', None, None),
    (-97.743236, 30.279526, 'GUG', 'Guadalupe Garage', 'garage', 'parking', None),
    (-97.736239, 30.279535, None, '1836 San Jacinto', 'office', None, None),
    (-97.740830, 30.279567, 'AUSUAHX', 'Hampton Inn & Suites Austin at The University/Capitol', 'yes', None, None),
    (-97.731662, 30.279642, 'TS2', None, 'yes', None, None),
    (-97.736669, 30.279695, None, 'Employees Retirement System of Texas', 'yes', None, None),
    (-97.727938, 30.279698, None, 'East Campus Parking Garage', 'yes', 'parking', None),
    (-97.738244, 30.279764, None, 'Panhandle Plains Portal', 'yes', None, None),
    (-97.733496, 30.279823, 'TSC', 'Lee and Joe Jamail Texas Swimming Center', 'yes', None, None),
    (-97.737580, 30.279881, None, 'George H.W. Bush State Office Building', 'office', None, None),
    (-97.738179, 30.279936, None, 'Prairies and Lakes Portal', 'yes', None, None),
    (-97.740667, 30.279948, None, 'Turner Hall', 'yes', None, None),
    (-97.731200, 30.280109, 'CT7', None, 'yes', None, None),
    (-97.741235, 30.280167, None, 'Capitol Credit Union', 'yes', 'bank', None),
    (-97.741786, 30.280252, None, 'The G', 'apartments', None, None),
    (-97.731457, 30.280262, 'CS7', None, 'yes', None, None),
    (-97.739160, 30.280292, None, 'Texas State History Museum', 'yes', None, None),
    (-97.742695, 30.280328, None, 'Travis County Civil and Family Courts Facility', 'yes', 'courthouse', None),
    (-97.731732, 30.280407, 'BBR', 'Basketball and Rowing Training Facility', 'university', None, None),
    (-97.737983, 30.280418, None, 'Piney Woods Portal', 'yes', None, None),
    (-97.741255, 30.280573, None, 'Greenwood Towers', 'yes', None, None),
    (-97.738937, 30.280581, None, 'Bob Bullock IMAX', 'no', 'cinema', None),
    (-97.735563, 30.280678, 'CS3', 'Chilling Station No. 3', 'university', None, None),
    (-97.740406, 30.280729, None, 'Cambridge Tower', 'apartments', None, '1965'),
    (-97.745082, 30.280759, None, 'Rio House Apartments', 'apartments', None, None),
    (-97.736220, 30.280918, 'BRG', 'Brazos Garage', 'yes', 'parking', None),
    (-97.730652, 30.280975, 'MCA', 'Moody Center', 'stadium', None, '2022-04-18'),
    (-97.737417, 30.280984, 'BMA', 'Blanton Museum of Art', 'yes', None, None),
    (-97.738205, 30.281114, 'EAS', 'Edgar A. Smith Building', 'university', None, None),
    (-97.742146, 30.281298, None, '7-Eleven', 'yes', None, None),
    (-97.739462, 30.281392, None, 'University Avenue Church of Christ', 'church', 'place_of_worship', None),
    (-97.742481, 30.281527, None, "Raising Cane's", 'yes', 'fast_food', None),
    (-97.732387, 30.281534, 'RSC', 'Recreational Sports Center', 'university', None, None),
    (-97.742048, 30.281552, None, '7-Eleven', 'roof', 'fuel', None),
    (-97.734886, 30.281671, None, 'Caven Clark Field Support Building', 'yes', None, None),
    (-97.738763, 30.281677, 'SZB', 'George I. Sanchez Building', 'university', None, None),
    (-97.737820, 30.281678, None, 'Austin', 'yes', None, None),
    (-97.743116, 30.281714, '02992', 'Chick-fil-A', 'yes', 'fast_food', None),
    (-97.744125, 30.281865, None, "Tiff's Treats", 'yes', None, None),
    (-97.743550, 30.281895, None, "P. Terry's", 'yes', 'fast_food', None),
    (-97.731111, 30.281997, 'MFH', 'Richard Mithoff Track and Soccer Fieldhouse', 'university', None, None),
    (-97.741454, 30.282121, 'RRH', 'Robert B. Rowling Hall', 'university', None, None),
    (-97.726481, 30.282128, 'CRB', 'Computational Resource Building', 'university', None, None),
    (-97.742430, 30.282130, '6601', "Domino's", 'yes', 'fast_food', None),
    (-97.743997, 30.282133, None, "Jimmy John's", 'yes', 'fast_food', None),
    (-97.739322, 30.282165, None, 'Longhorns for Christ Campus Center', 'yes', 'place_of_worship', None),
    (-97.742426, 30.282300, None, 'Monkies Vintage & Thrift', 'yes', None, None),
    (-97.735925, 30.282353, 'JCD', 'Jester Dormitory East', 'dormitory', None, None),
    (-97.735031, 30.282384, 'PHD', 'Prather Hall Dormitory', 'dormitory', None, None),
    (-97.742357, 30.282424, None, 'Tapioca House', 'yes', 'cafe', None),
    (-97.732675, 30.282458, 'MNAC', 'Moncrief-Neuhaus Athletic Center', 'university', None, None),
    (-97.742859, 30.282462, None, 'The Otis Hotel, Autograph Collection', 'yes', None, None),
    (-97.734331, 30.282466, 'SJH', 'San Jacinto Residence Hall', 'dormitory', None, None),
    (-97.742351, 30.282497, None, 'Phở Tháisơn', 'yes', 'restaurant', None),
    (-97.743803, 30.282550, None, 'Austin Fire Department Station 2', 'yes', 'fire_station', None),
    (-97.742345, 30.282567, None, "CoCo's Cafe", 'yes', 'cafe', None),
    (-97.742335, 30.282631, None, '1914 Noodles & More', 'yes', 'restaurant', None),
    (-97.735972, 30.282634, 'LDH', 'Longhorn Dining Facility', 'university', None, None),
    (-97.742444, 30.282638, None, '1914 Poke Bowl', 'yes', 'restaurant', None),
    (-97.742546, 30.282645, None, 'China Family', 'yes', 'restaurant', None),
    (-97.732655, 30.282737, 'SEZ', 'South End Zone', 'university', None, None),
    (-97.725699, 30.282747, 'MSB', 'Mail Services Building', 'university', None, None),
    (-97.739345, 30.282749, None, 'Kappa Kappa Gamma', 'yes', 'social_centre', None),
    (-97.738194, 30.282777, 'PCL', 'Perry-Castañeda Library', 'university', 'library', None),
    (-97.730985, 30.282792, 'MAG', 'Manor Garage', 'yes', 'parking', None),
    (-97.742343, 30.282817, None, 'Möge Tee', 'yes', 'cafe', None),
    (-97.736847, 30.282888, 'JES', 'Beauford H. Jester Center', 'university', None, None),
    (-97.742338, 30.282896, None, 'K-Bop', 'yes', 'restaurant', None),
    (-97.747129, 30.282910, None, 'Pearl Street Inn', 'yes', None, None),
    (-97.725250, 30.282933, 'CML', 'Comal Child Development Center', 'university', None, None),
    (-97.742303, 30.282948, None, '1Up Repairs', 'yes', None, None),
    (-97.725670, 30.282975, 'CDA', 'Comal Child Development Center Annex', 'university', None, None),
    (-97.735166, 30.283006, 'RHD', 'Roberts Hall Dormitory', 'dormitory', None, None),
    (-97.739288, 30.283009, None, 'Texas Alpha Phi', 'yes', 'social_centre', None),
    (-97.738758, 30.283028, 'UTC', 'University Teaching Center', 'university', None, None),
    (-97.745551, 30.283054, None, 'Goodall Wooten House', 'yes', None, None),
    (-97.735972, 30.283120, 'BHD', 'Brackenridge Hall Dormitory', 'dormitory', None, None),
    (-97.742368, 30.283133, None, 'Saint Austin Catholic Church', 'church', 'place_of_worship', None),
    (-97.744345, 30.283198, None, 'Nueces Mosque', 'mosque', 'place_of_worship', None),
    (-97.742811, 30.283304, None, 'Union on San Antonio', 'apartments', None, None),
    (-97.739273, 30.283313, None, 'University Christian Church', 'church', 'place_of_worship', None),
    (-97.723647, 30.283316, 'UIL', 'University Interscholastic League', 'university', None, None),
    (-97.726442, 30.283335, 'FC7', 'Facilities Complex Building 7', 'university', None, None),
    (-97.741345, 30.283383, 'D21', 'Dobie Center', 'yes', None, '1972'),
    (-97.740060, 30.283391, None, 'University Catholic Center', 'church', 'place_of_worship', None),
    (-97.725837, 30.283448, 'FC6', 'Facilities Complex Building 6', 'university', None, None),
    (-97.722568, 30.283540, None, 'El Chile Cafe Y Cantina', 'yes', 'restaurant', None),
    (-97.742328, 30.283589, None, 'Saint Austin Catholic School', 'school', 'school', None),
    (-97.744354, 30.283610, None, 'Torre Student Living', 'apartments', None, None),
    (-97.743358, 30.283617, None, 'The Church of Jesus Christ of Latter-day Saints', 'yes', 'place_of_worship', None),
    (-97.724593, 30.283636, 'FC5', 'Facilities Complex Building 5', 'university', None, None),
    (-97.747615, 30.283662, None, 'KXAN Building (CW)', 'commercial', None, None),
    (-97.735424, 30.283685, 'MHD', 'Moore-Hill Dormitory', 'dormitory', None, None),
    (-97.744784, 30.283688, None, 'Signature 1909', 'apartments', None, None),
    (-97.733512, 30.283746, 'BEL', 'L. Theo Bellmont Hall', 'university', None, None),
    (-97.745878, 30.283816, None, '21st Street Co-op', 'residential', None, None),
    (-97.723977, 30.283822, None, 'Custodial Services Training Fac', 'university', None, None),
    (-97.723100, 30.283920, 'FC2', 'Facilities Complex Building 2', 'university', None, None),
    (-97.739007, 30.283960, 'BEN', 'Benedict Hall', 'university', None, None),
    (-97.736283, 30.283988, 'GRE', 'Gregory Gymnasium', 'university', None, None),
    (-97.740194, 30.284063, 'HRH', 'Homer Rainey Hall', 'university', None, None),
    (-97.730437, 30.284073, 'UPB', 'University Police Building', 'university', 'police', None),
    (-97.743744, 30.284131, None, 'Chabad House', 'yes', 'place_of_worship', None),
    (-97.742713, 30.284175, None, 'Texas Hillel Foundation', 'church', 'place_of_worship', None),
    (-97.738344, 30.284179, 'GSB', 'Graduate School of Business Building', 'university', None, None),
    (-97.737855, 30.284211, 'CBA', 'McCombs School of Business', 'university', None, None),
    (-97.743264, 30.284273, None, 'Ion Austin', 'apartments', None, None),
    (-97.744722, 30.284284, None, '21 Rio', 'apartments', None, None),
    (-97.723411, 30.284323, 'FC4', 'Facilities Complex Building 4', 'university', None, None),
    (-97.741229, 30.284335, 'HRC', 'Harry Ransom Center', 'university', None, None),
    (-97.734475, 30.284335, 'UTX', 'Etter-Harbin Alumni Center', 'university', None, None),
    (-97.738958, 30.284374, 'MEZ', 'Mezes Hall', 'university', None, None),
    (-97.740179, 30.284490, 'CAL', 'Calhoun Hall', 'university', None, None),
    (-97.747897, 30.284513, None, 'Diplomat West Campus', 'apartments', None, None),
    (-97.722590, 30.284541, 'FC1', 'Facilities Complex Building 1', 'university', None, None),
    (-97.747197, 30.284545, None, '21 Pearl West Campus', 'apartments', None, None),
    (-97.723658, 30.284697, 'FC3', 'Facilities Complex Building 3', 'university', None, None),
    (-97.742629, 30.284757, None, 'University Baptist Church', 'church', 'place_of_worship', None),
    (-97.744683, 30.284796, None, 'Villas on Rio', 'apartments', None, None),
    (-97.738921, 30.284805, 'BAT', 'Batts Hall', 'university', None, None),
    (-97.726541, 30.284832, None, 'Athletic Fields Pavilion (Eastside)', 'university', None, None),
    (-97.732428, 30.284881, 'RMRZ;NEZ', 'Red McCombs Red Zone', 'university', None, None),
    (-97.736454, 30.284902, 'WCP', 'William C. Powers, Jr. Student Activity Center', 'university', None, None),
    (-97.740106, 30.284903, 'PAR', 'Parlin Hall', 'university', None, None),
    (-97.746114, 30.284953, None, 'The Quarters Sterling House', 'apartments', None, None),
    (-97.740832, 30.284955, 'SUT', 'Sutton Hall', 'university', None, None),
    (-97.728865, 30.284995, 'SRH', 'Sid Richardson Hall', 'university', None, None),
    (-97.744726, 30.285016, None, 'Kenney–Lomax House', 'yes', None, None),
    (-97.737604, 30.285105, 'WAG', 'Waggener Hall', 'university', None, None),
    (-97.738495, 30.285138, 'GAR', 'Garrison Hall', 'university', None, None),
    (-97.736733, 30.285225, 'BRB', 'Bernard and Audre Rapoport Building', 'university', None, None),
    (-97.743288, 30.285263, None, 'Intervarsity Christian Church', 'church', 'place_of_worship', None),
    (-97.742177, 30.285263, None, 'Church of Scientology Texas', 'yes', 'place_of_worship', None),
    (-97.726283, 30.285300, 'AFP', 'Athletic Fields Pavilion', 'university', None, None),
    (-97.743714, 30.285316, None, 'Austin Folk House', 'yes', None, None),
    (-97.723923, 30.285393, 'FC8', 'Facilities Complex Building 8', 'university', None, None),
    (-97.740343, 30.285410, 'BTL', 'Battle Hall', 'university', None, None),
    (-97.744185, 30.285412, None, 'Inspire on 22nd', 'apartments', None, None),
    (-97.740628, 30.285435, 'WMB', 'West Mall Office Building', 'office', None, None),
    (-97.742576, 30.285511, None, 'University Presbyterian Church', 'church', 'place_of_worship', None),
    (-97.746170, 30.285568, None, 'The Quarters Grayson House', 'apartments', None, None),
    (-97.738531, 30.285637, 'COM', 'Computation Center', 'university', None, None),
    (-97.742082, 30.285656, None, 'Chipotle', 'yes', 'fast_food', None),
    (-97.743149, 30.285666, None, 'Moontower', 'apartments', None, None),
    (-97.742110, 30.285757, None, 'Sweetgreen', 'yes', 'fast_food', None),
    (-97.736670, 30.285770, 'EPS', 'E. P. Schoch Building', 'university', None, None),
    (-97.731770, 30.285851, 'DFA', 'E. William Doty Fine Arts Building', 'university', None, None),
    (-97.744142, 30.285865, None, 'Rise at West Campus', 'apartments', None, None),
    (-97.735601, 30.285872, 'JGB', 'Jackson Geological Sciences Building', 'university', None, None),
    (-97.744558, 30.285885, None, 'The Quarters at Hardin House', 'yes', None, None),
    (-97.729285, 30.285895, 'LBJ', 'Lyndon Baines Johnson Presidential Library and Museum', 'yes', 'library', None),
    (-97.734487, 30.285902, 'WIN', 'F Loren Winship Drama Building', 'university', None, None),
    (-97.735225, 30.285952, 'LTH', 'Laboratory Theatre Building', 'university', None, None),
    (-97.739359, 30.286010, 'MAI', 'Main Building', 'university', None, None),
    (-97.738405, 30.286087, 'WCH', 'Will C. Hogg Building', 'university', None, None),
    (-97.732953, 30.286160, 'ART', 'Art Building and Museum', 'university', 'arts_centre', None),
    (-97.742077, 30.286175, None, 'The Co-op', 'yes', None, None),
    (-97.736446, 30.286246, 'GDC', 'Bill and Melinda Gates Computer Science Complex', 'university', None, None),
    (-97.740432, 30.286286, 'FAC', 'Peter T. Flawn Academic Center', 'university', None, None),
    (-97.726561, 30.286292, 'IPF', 'Indoor Practice Facility', 'university', None, None),
    (-97.731028, 30.286296, 'PAC', 'College of Fine Arts Performing Arts Center', 'university', 'theatre', None),
    (-97.744536, 30.286297, None, 'Twenty Two 15', 'apartments', None, None),
    (-97.741949, 30.286302, None, 'Foxtrot', 'yes', None, None),
    (-97.738625, 30.286340, 'GEB', 'Dorothy Gebauer Building', 'university', None, None),
    (-97.735770, 30.286401, 'CS6', 'Chilling Station No. 6', 'university', None, None),
    (-97.734418, 30.286421, 'CT2', 'UTM Cooling Tower 2', 'yes', None, None),
    (-97.735262, 30.286547, 'PPL', 'Hal C. Weaver Power Plant', 'university', None, None),
    (-97.734760, 30.286607, 'CT1', 'Cooling Tower 1', 'yes', None, None),
    (-97.725983, 30.286631, None, 'Athletic Fields Pavilion (Rehab)', 'university', None, None),
    (-97.741136, 30.286651, 'UNB', 'Union Building', 'university', None, None),
    (-97.742420, 30.286673, None, 'Congregational Church of Austin', 'yes', 'place_of_worship', None),
    (-97.741958, 30.286822, None, 'Potbelly', 'yes', 'fast_food', None),
    (-97.736565, 30.286825, 'POB', 'O’Donnell Building for Applied Computational Engineering and Sciences', 'university', None, None),
    (-97.743499, 30.286857, None, 'New Guild Cooperative', 'yes', None, None),
    (-97.734402, 30.286876, 'PPA', 'Hal C. Weaver Power Plant Annex', 'university', None, None),
    (-97.735868, 30.286878, 'PPE', 'Hal C. Weaver Power Plant Expansion', 'university', None, None),
    (-97.740627, 30.286879, 'HMA', 'Hogg Memorial Auditorium', 'university', None, None),
    (-97.741951, 30.286892, None, 'Wingstop', 'yes', 'fast_food', None),
    (-97.743040, 30.286903, None, 'Pi Beta Phi', 'yes', None, None),
    (-97.738763, 30.286971, 'PAI', 'T. S. Painter Hall', 'university', None, None),
    (-97.732365, 30.286981, 'TMM', 'Texas Memorial Museum', 'university', None, None),
    (-97.745783, 30.286991, None, 'The Standard', 'apartments', None, None),
    (-97.729094, 30.287006, 'TCC', 'Joe C. Thompson Conference Center', 'university', None, None),
    (-97.741939, 30.287068, None, '7-Eleven', 'yes', None, None),
    (-97.743491, 30.287150, None, 'Seneca Falls Cooperative', 'yes', None, None),
    (-97.739762, 30.287218, 'BIO', 'Biological Laboratories', 'university', None, None),
    (-97.741955, 30.287220, None, 'Wukasch Building', 'commercial', None, None),
    (-97.730645, 30.287255, 'MRH', 'Music Recital Hall', 'university', None, None),
    (-97.725033, 30.287265, None, "Aster's Ethiopian Restaurant", 'yes', 'restaurant', '1991'),
    (-97.723586, 30.287287, 'DEV', 'Development Center', 'university', None, None),
    (-97.742410, 30.287313, None, 'The Castilian', 'apartments', None, None),
    (-97.731341, 30.287347, 'MBE', 'Music Building East', 'university', None, None),
    (-97.741914, 30.287444, None, 'Rise at West Campus', 'commercial', None, None),
    (-97.735741, 30.287519, 'GLT', 'Gary L. Thomas Energy Engineering Building', 'university', None, None),
    (-97.741950, 30.287550, None, 'Shoe Palace', 'yes', None, None),
    (-97.743368, 30.287581, None, 'Kappa Delta', 'yes', None, None),
    (-97.745250, 30.287636, None, 'Union on 24th', 'apartments', None, None),
    (-97.738017, 30.287654, 'NHB', 'Norman Hackerman Building', 'university', None, None),
    (-97.724980, 30.287654, 'TX191', 'Rodeway Inn University / Downtown', 'yes', None, None),
    (-97.744415, 30.287666, None, 'Villas on 24th', 'construction', None, None),
    (-97.739217, 30.287716, 'GEA', 'Mary E Gearing Hall', 'university', None, None),
    (-97.732877, 30.287731, 'SJG', 'San Jacinto Garage', 'garage', 'parking', None),
    (-97.727007, 30.287734, None, 'Tower View Apartments', 'yes', None, None),
    (-97.739945, 30.287833, 'GWB', 'Gordon-White Building', 'university', None, None),
    (-97.737999, 30.287849, 'FNT', 'Larry R. Faulkner Nano Science and Technology Building', 'university', None, None),
    (-97.747371, 30.287908, None, "Cain & Abel's", 'yes', 'bar', None),
    (-97.746982, 30.287923, None, 'Arab Cowboy', 'yes', 'cafe', None),
    (-97.741219, 30.287931, None, 'University United Methodist Church', 'church', 'place_of_worship', None),
    (-97.742598, 30.287955, '16692', 'Starbucks', 'yes', 'cafe', None),
    (-97.742695, 30.287961, None, 'Victory Lap', 'yes', 'bar', None),
    (-97.736424, 30.288008, 'PAT', 'J. T. Patterson Laboratories Building', 'university', None, None),
    (-97.730456, 30.288051, 'CCJ', 'John B. Connally Center for Justice', 'university', None, None),
    (-97.744929, 30.288062, None, 'Shell', 'roof', None, None),
    (-97.740778, 30.288117, 'LFH', 'Littlefield House', 'detached', None, None),
    (-97.738596, 30.288156, 'PHR', 'Pharmacy Building', 'university', None, None),
    (-97.733104, 30.288200, 'TS1', None, 'yes', None, None),
    (-97.742893, 30.288211, None, 'The Diner at Victory Lap', 'yes', 'restaurant', None),
    (-97.739852, 30.288229, 'AND', 'Andrews Dormitory', 'dormitory', None, None),
    (-97.744121, 30.288244, None, 'Yugo Austin Waterloo', 'apartments', None, None),
    (-97.744419, 30.288261, None, 'The Ruckus on Rio', 'apartments', None, None),
    (-97.741187, 30.288265, None, 'University United Methodist Church Early Childhood Center', 'yes', 'kindergarten', None),
    (-97.735322, 30.288354, 'EER', 'Engineering Education and Research Center', 'university', None, None),
    (-97.745087, 30.288387, None, 'ΦΚΣ', 'yes', None, None),
    (-97.743450, 30.288407, 'N24', '2400 Nueces', 'apartments', None, None),
    (-97.737280, 30.288479, 'MBB', 'Louise and James Robert Moffett Molecular Biology Building', 'university', None, None),
    (-97.737730, 30.288528, 'AHG', 'Anna Hiss Gymnasium', 'university', None, None),
    (-97.739484, 30.288535, 'BLD', 'Blanton Dormitory', 'dormitory', None, None),
    (-97.730796, 30.288539, 'TNH', 'Townes Hall', 'university', None, None),
    (-97.741783, 30.288541, None, 'CAVA', 'yes', 'restaurant', None),
    (-97.733312, 30.288542, 'CRH', 'Creekside Residence Hall', 'dormitory', None, None),
    (-97.740868, 30.288560, 'LCH', 'Littlefield Carriage House', 'university', None, None),
    (-97.731734, 30.288597, 'JON', 'Jesse H. Jones Hall', 'university', None, None),
    (-97.732464, 30.288670, 'CS4', 'Chilling Station No. 4', 'university', None, None),
    (-97.742661, 30.288686, 'SAG', 'San Antonio Garage', 'garage', 'parking', None),
    (-97.740096, 30.288697, 'CRD', 'Carothers Dormitory', 'dormitory', None, None),
    (-97.736320, 30.288846, 'PMA', 'Physics, Math, and Astronomy Building', 'university', None, None),
    (-97.738514, 30.288868, 'BUR', 'Burdine Hall', 'university', None, None),
    (-97.729230, 30.288884, None, 'GoPuff Market', 'yes', None, None),
    (-97.740771, 30.288913, 'HSM', 'William Randolph Hearst Building', 'university', None, None),
    (-97.744226, 30.288941, None, 'Delta Gamma', 'yes', None, None),
    (-97.743347, 30.288991, None, 'Alpha Chi Omega', 'detached', None, None),
    (-97.735516, 30.288992, 'ECJ', 'Ernest Cockrell, Jr. Hall', 'university', None, None),
    (-97.723953, 30.289016, None, 'Austin Lakes Hospital', 'hospital', None, None),
    (-97.738506, 30.289119, 'BME', 'Biomedical Engineering Building', 'university', None, None),
    (-97.741167, 30.289199, 'CMB', 'Jesse H. Jones Communication Center - B', 'university', None, None),
    (-97.737555, 30.289201, 'NMS', 'Neural Molecular Science Building', 'university', None, None),
    (-97.739728, 30.289307, 'LTD', 'Littlefield Dormitory', 'dormitory', None, None),
    (-97.741858, 30.289308, 'WWH', 'Walter Webb Hall', 'university', None, None),
    (-97.743324, 30.289375, None, 'Whitehall Cooperative', 'house', None, None),
    (-97.740737, 30.289418, 'CMA', 'Jesse H. Jones Communication Center - A', 'university', None, None),
    (-97.732559, 30.289430, 'FDH', 'J. Frank Dobie House', 'detached', None, None),
    (-97.741697, 30.289456, None, 'iVape ATX Austin', 'commercial', None, None),
    (-97.741696, 30.289507, None, 'Eclectic Eyewear', 'commercial', None, None),
    (-97.741679, 30.289551, None, 'iClips', 'commercial', None, None),
    (-97.745567, 30.289604, None, 'Block on 25th East', 'apartments', None, None),
    (-97.741653, 30.289635, None, 'Chase', 'yes', 'bank', None),
    (-97.741666, 30.289731, None, "Jenn's Copy & Binding", 'yes', None, None),
    (-97.741659, 30.289799, None, 'Snag', 'retail', None, None),
    (-97.735418, 30.289898, 'ETC', 'Engineering Teaching Center II', 'university', None, None),
    (-97.741626, 30.289900, None, '1972 Pub', 'yes', 'restaurant', None),
    (-97.737345, 30.290070, 'SEA', 'Sarah M. and Charles E. Seay Building', 'university', None, None),
    (-97.738456, 30.290110, 'SSB', 'Student Services Building', 'university', None, None),
    (-97.740764, 30.290171, 'BMC', 'Belo Center for New Media', 'university', None, None),
    (-97.736139, 30.290234, 'CPE', 'Chemical and Petroleum Engineering Building', 'university', None, None),
    (-97.741758, 30.290259, None, 'Moxy Austin - University', 'yes', None, None),
    (-97.738682, 30.290310, 'UA9', '2609 University Avenue', 'university', None, None),
    (-97.744762, 30.290538, None, 'Rancho Rio Eatery', 'yes', 'food_court', None),
    (-97.725436, 30.290598, None, "St David's Occupational Health Services", 'yes', None, None),
    (-97.740517, 30.290623, 'LLA', 'Whitis Court Residence Hall', 'dormitory', None, None),
    (-97.736440, 30.290640, 'CEE', 'Continuing Engineering Education', 'university', None, None),
    (-97.740904, 30.290641, 'LLD', 'Whitis Court Residence Hall', 'dormitory', None, None),
    (-97.748237, 30.290658, None, 'Texan26', 'apartments', None, None),
    (-97.735477, 30.290663, 'CS5', 'Chilling Station No. 5', 'university', None, None),
    (-97.741526, 30.290704, None, '7-Eleven', 'roof', 'fuel', None),
    (-97.741835, 30.290738, None, '7-Eleven', 'yes', None, None),
    (-97.738222, 30.290792, 'BWY', 'Bridgeway Building', 'university', None, None),
    (-97.736356, 30.290810, 'SW7', '2617 Speedway', 'university', None, None),
    (-97.740496, 30.290864, 'LLB', 'Whitis Court Residence Hall', 'dormitory', None, None),
    (-97.741024, 30.290906, 'LLE', 'Whitis Court Residence Hall', 'dormitory', None, None),
    (-97.741548, 30.290999, None, "Roppolo's Pizzeria", 'yes', 'restaurant', None),
    (-97.736258, 30.291054, 'CPB', None, 'yes', None, None),
    (-97.741498, 30.291083, None, 'Diablo Rojo Tattoos & Piercing', 'yes', None, None),
    (-97.740477, 30.291110, 'LLC', 'Whitis Court Residence Hall', 'dormitory', None, None),
    (-97.737561, 30.291133, 'ASE', 'Aerospace Engineering Building', 'office', None, None),
    (-97.740854, 30.291144, 'LLF', 'Whitis Court Residence Hall', 'dormitory', None, None),
    (-97.746951, 30.291161, None, 'Barranca Square Student Apartments', 'apartments', None, None),
    (-97.737081, 30.291168, 'SWG', 'Speedway Garage', 'garage', 'parking', None),
    (-97.741530, 30.291206, None, 'Kerbey Lane Cafe', 'yes', 'restaurant', None),
    (-97.738546, 30.291272, 'TSG', '27th Street Garage', 'garage', 'parking', None),
    (-97.739238, 30.291441, None, 'All Saints Episcopal Day School', 'school', 'school', None),
    (-97.740648, 30.291534, 'ADH', 'Almetris Duren Hall', 'dormitory', None, None),
    (-97.736075, 30.291611, 'ARC', 'Animal Resource Center', 'university', None, None),
    (-97.739733, 30.291670, None, "All Saints' Episcopal Church", 'church', 'place_of_worship', None),
    (-97.734121, 30.291670, None, 'Kola Family and Cosmetic Dentistry', 'commercial', 'dentist', None),
    (-97.737743, 30.292012, None, 'Shelton Chapel', 'yes', 'place_of_worship', None),
    (-97.741651, 30.292215, '319', 'In-N-Out Burger', 'yes', 'fast_food', None),
    (-97.732214, 30.292338, None, 'Harrison Library', 'yes', 'library', None),
    (-97.739437, 30.292440, None, 'Scottish Rite Dormitory', 'yes', None, None),
    (-97.732782, 30.292530, None, 'Episcopal Diocese of Austin', 'yes', 'place_of_worship', None),
    (-97.735623, 30.292549, None, 'Crown and Anchor Pub', 'yes', 'pub', None),
    (-97.736294, 30.292577, 'E26', 'University Sign Shop', 'university', None, None),
    (-97.742171, 30.293457, None, 'Whataburger', 'yes', 'fast_food', None),
    (-97.744401, 30.293721, None, 'Rio Grande Square Student Housing', 'apartments', None, None),
    (-97.723875, 30.293951, None, 'Saint Paul Lutheran Church', 'church', 'place_of_worship', None),
    (-97.742352, 30.293998, None, "Dirty Martin's", 'yes', 'fast_food', None),
    (-97.741852, 30.294199, None, 'The Venue on Guadalupe', 'apartments', None, None),
    (-97.744430, 30.294560, None, 'Montage Apartments West Campus', 'apartments', None, None),
    (-97.738749, 30.294650, None, 'Austin Fire Station Number 3', 'yes', 'fire_station', None),
    (-97.742030, 30.295369, None, 'The Ballroom @ Spiderhouse', 'yes', 'events_venue', None),
    (-97.738863, 30.295427, None, 'First English Lutheran Church', 'church', 'place_of_worship', None),
    (-97.741749, 30.295527, None, "Tweedy's Bar", 'yes', 'pub', None),
    (-97.742890, 30.295860, None, 'Buffalo Exchange', 'yes', None, None),
    (-97.741967, 30.296103, None, 'Out of the Closet', 'retail', None, None),
]


# ══════════════════════════════════════════════════════════════════════
#  PROJECTION
#  ONE reference latitude for the whole bbox, not per-feature — the same
#  choice bake_places.py made and for the same reason: this file measures
#  footprint-to-path distances across a 2.5 km bbox, and a per-feature
#  projection makes those disagree by metres.
# ══════════════════════════════════════════════════════════════════════
M_LAT = 111320.0
LAT0 = 30.2862
KX = math.cos(math.radians(LAT0)) * M_LAT


def to_m(lon, lat):
    return (lon * KX, lat * M_LAT)


def to_ll(x, y):
    return (round(x / KX, 7), round(y / M_LAT, 7))


def _norm(dx, dy):
    d = math.hypot(dx, dy)
    return (0.0, 0.0) if d < 1e-9 else (dx / d, dy / d)


def _seg_closest(px, py, ax, ay, bx, by):
    """Closest point on segment ab to p, plus the parameter t along it."""
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy
    if L2 < 1e-12:
        return ax, ay, 0.0
    t = ((px - ax) * dx + (py - ay) * dy) / L2
    t = max(0.0, min(1.0, t))
    return ax + t * dx, ay + t * dy, t


# ══════════════════════════════════════════════════════════════════════
#  OSM TABLES: a cache if a later pass ever writes one, else the frozen rows
# ══════════════════════════════════════════════════════════════════════
def load_osm():
    global OSM_ENTRANCES, OSM_BUILDING_TAGS
    src_e = src_b = "frozen " + OSM_FETCH_DATE
    ents = list(_ENTRANCE_ROWS)
    blds = list(_BUILDING_ROWS)
    if os.path.exists(CACHED_ENTRANCES):
        j = json.load(open(CACHED_ENTRANCES, encoding="utf-8"))
        rows = []
        for e in j.get("elements", []):
            t = e.get("tags", {})
            if e.get("type") == "node" and "entrance" in t:
                rows.append((e["lon"], e["lat"], t["entrance"],
                             t.get("door"), t.get("wheelchair")))
        if rows:
            ents, src_e = rows, os.path.basename(CACHED_ENTRANCES)
    if os.path.exists(CACHED_BLDG_TAGS):
        j = json.load(open(CACHED_BLDG_TAGS, encoding="utf-8"))
        rows = []
        for e in j.get("elements", []):
            t = e.get("tags", {})
            c = e.get("center")
            if c and ("ref" in t or "name" in t):
                rows.append((c["lon"], c["lat"], t.get("ref"), t.get("name"),
                             t.get("building"), t.get("amenity"),
                             t.get("start_date")))
        if rows:
            blds, src_b = rows, os.path.basename(CACHED_BLDG_TAGS)
    OSM_ENTRANCES, OSM_BUILDING_TAGS = ents, blds
    return src_e, src_b


def refresh():
    """Re-query Overpass and PRINT replacement tables. Writes no file."""
    from urllib.request import urlopen
    from urllib.parse import urlencode
    bb = "%.4f,%.4f,%.4f,%.4f" % SURVEY
    url = "https://overpass.kumi.systems/api/interpreter"   # the mirror answers
    qa = '[out:json][timeout:180];node["entrance"](%s);out body;' % bb
    qb = '[out:json][timeout:240];way["building"](%s);out tags center;' % bb
    ja = json.loads(urlopen(url, urlencode({"data": qa}).encode(),
                            timeout=200).read().decode("utf-8"))
    jb = json.loads(urlopen(url, urlencode({"data": qb}).encode(),
                            timeout=260).read().decode("utf-8"))
    ns = sorted((e for e in ja["elements"]
                 if e["type"] == "node" and "entrance" in e.get("tags", {})),
                key=lambda n: (n["lat"], n["lon"]))
    print("_ENTRANCE_ROWS = [")
    for n in ns:
        t = n["tags"]
        print("    (%.7f, %.7f, %r, %r, %r)," % (
            n["lon"], n["lat"], str(t["entrance"]),
            str(t["door"]) if "door" in t else None,
            str(t["wheelchair"]) if "wheelchair" in t else None))
    print("]")
    ws = [e for e in jb["elements"]
          if "ref" in e.get("tags", {}) or "name" in e.get("tags", {})]
    ws.sort(key=lambda e: (e["center"]["lat"], e["center"]["lon"]))
    print("_BUILDING_ROWS = [")
    for e in ws:
        t = e["tags"]
        print("    (%.6f, %.6f, %r, %r, %r, %r, %r)," % (
            e["center"]["lon"], e["center"]["lat"], t.get("ref"), t.get("name"),
            t.get("building"), t.get("amenity"), t.get("start_date")))
    print("]")
    print("# entrance nodes: %d   ref-or-name ways: %d" % (len(ns), len(ws)))


# ══════════════════════════════════════════════════════════════════════
#  BUILDINGS
# ══════════════════════════════════════════════════════════════════════
class Bldg(object):
    __slots__ = ("bid", "name", "cls", "h", "wd", "rings", "poly", "area",
                 "perim", "ref", "osm_name", "fam", "budget", "ents",
                 "cx", "cy", "wc")


def load_buildings():
    j = json.load(open(SNAP, encoding="utf-8"))
    out = []
    for f in j["features"]:
        g, p = f["geometry"], f["properties"]
        if g["type"] == "Polygon":
            rings = g["coordinates"]
        elif g["type"] == "MultiPolygon":
            rings = max(g["coordinates"], key=lambda r: len(r[0]))
        else:
            continue
        b = Bldg()
        b.bid = p["id"]
        b.name = p.get("name")
        b.cls = p.get("building_class")
        b.h = p.get("final_height") or 0.0
        b.wd = p.get("wd") or LIMESTONE
        b.rings = [[to_m(c[0], c[1]) for c in r] for r in rings]
        try:
            poly = Polygon(b.rings[0], b.rings[1:])
            if not poly.is_valid:
                poly = poly.buffer(0)
            if poly.is_empty:
                continue
            if poly.geom_type == "MultiPolygon":
                poly = max(poly.geoms, key=lambda q: q.area)
        except Exception:
            continue
        b.poly = poly
        b.area = poly.area
        b.perim = poly.exterior.length
        b.cx, b.cy = poly.centroid.x, poly.centroid.y
        b.ref = None
        b.osm_name = None
        b.wc = None            # the West Campus lobby spec, if this is one
        b.ents = []
        b.fam = "E5"
        b.budget = 0
        out.append(b)
    return out


def join_refs(blds, tree):
    """`ref` and `nm` come from a SPATIAL JOIN to OSM, because the Overture
    snapshot's id is a UUID, it carries no ref at all, and only 384 of its 2,453
    features carry a name. Centroid-in-polygon first, then nearest centroid
    under JOIN_R. Measured on this data: 337 of the 379 OSM ways that carry
    ref-or-name find a footprint (89%), and the buildings with codes are exactly
    the buildings that join — which is the number that matters."""
    JOIN_R = 20.0
    hit = 0
    for lon, lat, ref, name, bt, am, sd in OSM_BUILDING_TAGS:
        x, y = to_m(lon, lat)
        pt = Point(x, y)
        # ALL containing footprints, then the best of them — not the first.
        # Overture nests small rooftop structures inside their host, and taking
        # the first hit put `ref=PAI` on a 20 m2 GREENHOUSE sitting on top of
        # T. S. Painter Hall, which then failed the 250 m2 scope test and
        # dropped a tier-2 celebrated building out of the pass entirely. An
        # exact name match wins; otherwise the largest footprint wins.
        inside = [blds[int(i)] for i in tree.query(pt)
                  if blds[int(i)].poly.contains(pt)]
        tgt = None
        if inside:
            named = [b for b in inside if name and b.name == name]
            tgt = max(named or inside, key=lambda b: b.area)
        if tgt is None:
            # Same trap on the fallback: the OSM centroid of Painter Hall lands
            # 2.3 m from a 20 m2 greenhouse's centroid and 7.5 m from Painter's
            # own, so NEAREST alone hands the ref to the greenhouse. An exact
            # name match beats distance.
            near = [blds[int(i)] for i in tree.query(pt.buffer(JOIN_R))
                    if math.hypot(blds[int(i)].cx - x,
                                  blds[int(i)].cy - y) < JOIN_R]
            named = [b for b in near if name and b.name == name]
            pool = named or near
            tgt = min(pool, key=lambda b: math.hypot(b.cx - x, b.cy - y)) \
                if pool else None
        if tgt is None:
            continue
        if ref and not tgt.ref:          # a ref beats a bare name
            tgt.ref = ref
            hit += 1
        if name and not tgt.osm_name:
            tgt.osm_name = name
        if (bt in ("garage", "parking") or am == "parking") and not tgt.cls:
            tgt.cls = "parking"
    for b in blds:                       # authored codes OSM does not carry
        if not b.ref:
            nm = b.name or b.osm_name
            if nm and nm in NAME_TO_REF:
                b.ref = NAME_TO_REF[nm]
    return hit


def is_parking(b):
    nm = ((b.name or "") + " " + (b.osm_name or "")).lower()
    return b.cls == "parking" or "garage" in nm or "parking" in nm


def classify(b):
    """The cascade, docs/entrances/eras.md §5.2. First match wins, and the ORDER
    is deliberate: the named list beats the class test, because a class is a
    proxy and a name is evidence — and the LAST rule is NULL, not "C". The
    temptation is to default unknown campus buildings to mid-century because
    mid-century is numerically dominant, and that is exactly how a wrong
    entrance gets onto eighty buildings at once. Families are OPT-IN."""
    if b.wc:
        return "W"          # the named list beats everything, here too
    nm = ((b.name or "") + " " + (b.osm_name or "")).lower()
    if b.ref in NULL_REFS:
        return "E5"
    for w in NULL_NAME_PARTS:
        if w in nm:
            return "E5"
    if b.ref and b.ref in CELEBRATED:
        return CELEBRATED[b.ref]["fam"]
    if b.ref and b.ref in FAMILY_BY_REF:
        return FAMILY_BY_REF[b.ref]
    if is_parking(b):
        return "E3"
    if b.cls in CLASS_FAMILY:
        return CLASS_FAMILY[b.cls]
    return "E5"


def in_rect(lat, lon, r):
    return r[0] <= lat <= r[2] and r[1] <= lon <= r[3]


# ══════════════════════════════════════════════════════════════════════
#  THE FRAME, AND THE TEST THAT IT IS NOT BACKWARDS
#
#  Every piece is placed in the frame (t, n) of the host edge, where t is
#  the edge direction and n points OUT of the building. Get n backwards and
#  the steps are inside the lobby.
#
#  All 2,455 rings in this snapshot are wound counter-clockwise, so for an
#  edge a->b the interior is on the LEFT and n = (dy, -dx)/|e| on ring 0,
#  negated on a hole ring. DO NOT TRUST THAT — assert it, every run, per
#  candidate: step NORMAL_PROBE along +n and a point-in-polygon must come out
#  OUTSIDE. 2.24% of stage-2 candidates fail and they are NOT winding errors:
#  they land within half a metre of a concave corner, or on a sub-metre edge,
#  where the probe re-enters the polygon. REJECT the candidate. Never flip
#  the normal.
# ══════════════════════════════════════════════════════════════════════
def edge_normal(a, b, ring_idx):
    nx, ny = _norm(b[1] - a[1], -(b[0] - a[0]))
    if ring_idx > 0:
        nx, ny = -nx, -ny
    return nx, ny


def normal_test(bldg, px, py, nx, ny):
    return not bldg.poly.contains(Point(px + nx * NORMAL_PROBE,
                                        py + ny * NORMAL_PROBE))


def snap_to_edge(bldg, px, py):
    """Nearest point on the footprint boundary, with the edge's own frame:
    (distance, x, y, tx, ty, nx, ny, edge_length, distance_along_edge).

    The last two are what stop a 7.2 m Cret portal hanging off the end of a 4 m
    wall segment: the assembly clamps its half-width to the edge and then slides
    its CENTRE until the whole opening fits between the corners."""
    best = None
    for ri, ring in enumerate(bldg.rings):
        for i in range(len(ring) - 1):
            a, bb = ring[i], ring[i + 1]
            qx, qy, t = _seg_closest(px, py, a[0], a[1], bb[0], bb[1])
            d = math.hypot(qx - px, qy - py)
            if best is None or d < best[0]:
                elen = math.hypot(bb[0] - a[0], bb[1] - a[1])
                best = (d, qx, qy) + _norm(bb[0] - a[0], bb[1] - a[1]) + \
                    edge_normal(a, bb, ri) + (elen, t * elen, ri, i)
    return best


def wall_run(b, ri, ei, s):
    """How much STRAIGHT WALL an opening actually has, walking through nearly
    collinear neighbouring edges.

    This matters more than it looks. Overture tessellates a curved or stepped
    wall into many short edges, so clamping an opening to the ONE edge it landed
    on turns a 7.2 m Cret portal into a single leaf on a 2 m stub — a third of
    the file came out `single` before this existed. Walking the neighbours is
    the rule-not-patch fix: the OPENING WIDTH was wrong, not the count."""
    ring = b.rings[ri]
    m = len(ring) - 1
    if m < 1 or ei >= m:
        return 0.0, 0.0
    a, bb = ring[ei], ring[ei + 1]
    tx, ty = _norm(bb[0] - a[0], bb[1] - a[1])
    elen = math.hypot(bb[0] - a[0], bb[1] - a[1])
    left, right = s, max(0.0, elen - s)
    j = ei
    for _ in range(COLLINEAR_HOPS):
        j = (j + 1) % m
        p, q = ring[j], ring[j + 1]
        ux, uy = _norm(q[0] - p[0], q[1] - p[1])
        if ux * tx + uy * ty < COLLINEAR_COS:
            break
        right += math.hypot(q[0] - p[0], q[1] - p[1])
    j = ei
    for _ in range(COLLINEAR_HOPS):
        j = (j - 1) % m
        p, q = ring[j], ring[j + 1]
        ux, uy = _norm(q[0] - p[0], q[1] - p[1])
        if ux * tx + uy * ty < COLLINEAR_COS:
            break
        left += math.hypot(q[0] - p[0], q[1] - p[1])
    return left, right


# ══════════════════════════════════════════════════════════════════════
#  THE WALKABLE NETWORK
# ══════════════════════════════════════════════════════════════════════
def _ways(path):
    j = json.load(open(path, encoding="utf-8"))
    return j["elements"] if isinstance(j, dict) else j


def load_network():
    """Two products from the same files:
      paths  — the ways stage 2 derives doors from, with their node ids so a
               dead end can be told from a path junction;
      segs   — the weighted segment set stage 3 scores a perimeter against."""
    paths, segs = [], []
    fw = _ways(FOOTWAYS)
    for w in fw:
        t = w.get("tags", {})
        hw = t.get("highway")
        # Row B of the ablation: crossings are not doors and a cycleway is not a
        # pedestrian approach. -28 doors, no measurable recall cost.
        if hw == "cycleway" or t.get("footway") == "crossing":
            continue
        g = w.get("geometry") or []
        if len(g) < 2:
            continue
        pts = [to_m(p["lon"], p["lat"]) for p in g]
        paths.append((w.get("nodes") or [], pts, hw, t))
        wt = W_STEPS if hw == "steps" else W_FOOT
        for i in range(len(pts) - 1):
            segs.append((pts[i], pts[i + 1], wt))
    for w in _ways(PLAZAS):
        g = w.get("geometry") or []
        pts = [to_m(p["lon"], p["lat"]) for p in g]
        for i in range(len(pts) - 1):
            segs.append((pts[i], pts[i + 1], W_PLAZA))
    STREET = ("primary", "secondary", "tertiary", "residential", "unclassified",
              "living_street", "pedestrian", "primary_link", "secondary_link",
              "tertiary_link")
    for w in _ways(SURFACES):
        hw = w.get("tags", {}).get("highway")
        if hw in STREET:
            wt = W_STREET
        elif hw == "service":
            wt = W_SERVICE        # a loading drive is evidence AGAINST a door
        else:
            continue
        g = w.get("geometry") or []
        pts = [to_m(p["lon"], p["lat"]) for p in g]
        for i in range(len(pts) - 1):
            segs.append((pts[i], pts[i + 1], wt))
    return paths, segs


class Grid(object):
    """A cell hash over the segment set. 13k segments x 30k perimeter samples is
    too many for an all-pairs loop and shapely's STRtree cannot carry a weight."""

    def __init__(self, segs, cell):
        self.cell = cell
        self.g = defaultdict(list)
        for s in segs:
            (ax, ay), (bx, by), w = s
            x0, x1 = sorted((ax, bx))
            y0, y1 = sorted((ay, by))
            for cx in range(int(x0 // cell), int(x1 // cell) + 1):
                for cy in range(int(y0 // cell), int(y1 // cell) + 1):
                    self.g[(cx, cy)].append(s)

    def near(self, x, y, r):
        c = self.cell
        out = []
        for cx in range(int((x - r) // c), int((x + r) // c) + 1):
            for cy in range(int((y - r) // c), int((y + r) // c) + 1):
                out.extend(self.g.get((cx, cy), ()))
        return out


# ══════════════════════════════════════════════════════════════════════
#  PLACEMENT — three stages, in order of confidence. Truth is never
#  deleted to satisfy a budget: stage 1 runs first and is never overwritten.
# ══════════════════════════════════════════════════════════════════════
# Every candidate the DERIVATION produced, before clustering merged it with an
# OSM node. Recall must be measured against THIS, not against the shipped file:
# clustering deletes a derived candidate that landed on top of an OSM node,
# which is precisely a hit, so measuring the shipped file scores every success
# as a miss. That mistake produced a 0% first reading of this number.
DERIVED_ALL = []

ROLE_FROM_TAG = {"main": "main", "yes": "secondary", "staircase": "secondary",
                 "emergency": "emergency", "exit": "exit", "parking": "service"}


class Cand(object):
    __slots__ = ("x", "y", "tx", "ty", "nx", "ny", "elen", "s", "role", "src",
                 "score", "wheel", "door", "prio", "risers", "handrail",
                 "ri", "ei", "wcrole", "wcmeth")

    def __init__(self, x, y, tx, ty, nx, ny, elen, s, role, src, score, prio,
                 wheel=None, door=None, ri=0, ei=0):
        self.x, self.y = x, y
        self.tx, self.ty = tx, ty
        self.nx, self.ny = nx, ny
        self.elen, self.s = elen, s
        self.role, self.src, self.score, self.prio = role, src, score, prio
        self.wheel, self.door = wheel, door
        self.risers = None        # from an adjacent OSM steps way, if any
        self.handrail = False
        self.ri, self.ei = ri, ei
        self.wcrole = None        # "lobby" | "gate" on a West Campus building
        self.wcmeth = None        # which method placed it, for the audit


def stage1_osm(blds, tree, stats):
    """OSM entrance nodes are truth. They already sit on the rendered wall:
    the distance from an entrance node to the nearest OVERTURE footprint edge is
    median 0.00 m, p90 0.00, and the nearest edge belongs to the OSM host for 77
    of the 81 where both are known. Overture's campus footprints ARE OSM's
    footprints; the snap is free. The five nodes further than 5 m are buildings
    Overture simply does not have."""
    placed = 0
    for lon, lat, ev, door, wheel in OSM_ENTRANCES:
        x, y = to_m(lon, lat)
        pt = Point(x, y)
        best, bd = None, OSM_MAX_SNAP
        for i in tree.query(pt.buffer(OSM_MAX_SNAP)):
            b = blds[int(i)]
            d = b.poly.exterior.distance(pt)
            if d < bd:
                best, bd = b, d
        if best is None:
            stats["osm_unplaceable"] += 1
            continue
        if not in_rect(lat, lon, CAMPUS):
            stats["osm_off_campus"] += 1
            continue
        if best.budget < 0:              # out of scope host
            stats["osm_host_out_of_scope"] += 1
            continue
        s = snap_to_edge(best, x, y)
        if s is None:
            continue
        d, qx, qy, tx, ty, nx, ny, elen, sa, ri, ei = s
        if not normal_test(best, qx, qy, nx, ny):
            stats["normal_fail_osm"] += 1
            continue
        best.ents.append(Cand(qx, qy, tx, ty, nx, ny, elen, sa,
                              ROLE_FROM_TAG.get(ev, "secondary"), "osm",
                              9.0, 0, wheel, door, ri, ei))
        placed += 1
    return placed


def stage1b_authored(blds, tree, stats):
    """Authored portal positions from the CELEBRATED table.

    Only the entries whose source gives an actual coordinate get one. Where
    celebrated.md gives a compass direction but no coordinate — the Texas
    Union's main facade, Garrison, Hogg, Goldsmith, TMM — NOTHING is authored
    here; a `facade` hint biases the publicness field instead. Fabricating a
    coordinate to fill a hole in a source is exactly the lie this pass exists
    not to tell.

    An authored point that lands within CLUSTER_R of an OSM node loses to the
    node and keeps `src: osm`, which is the more honest provenance of the two.
    """
    placed = 0
    for ref, cel in sorted(CELEBRATED.items()):
        for lon, lat, role in (cel.get("at") or []):
            x, y = to_m(lon, lat)
            pt = Point(x, y)
            best, bd = None, OSM_MAX_SNAP
            for i in tree.query(pt.buffer(OSM_MAX_SNAP)):
                b = blds[int(i)]
                if b.budget < 0 or b.ref != ref:
                    continue
                d = b.poly.exterior.distance(pt)
                if d < bd:
                    best, bd = b, d
            if best is None:
                stats["authored_no_host"] += 1
                continue
            sn = snap_to_edge(best, x, y)
            if sn is None:
                continue
            d, qx, qy, tx, ty, nx, ny, elen, sa, ri, ei = sn
            if not normal_test(best, qx, qy, nx, ny):
                stats["normal_fail_authored"] += 1
                continue
            if any(math.hypot(qx - o.x, qy - o.y) < CLUSTER_R
                   for o in best.ents):
                stats["authored_already_osm"] += 1
                continue
            best.ents.append(Cand(qx, qy, tx, ty, nx, ny, elen, sa, role,
                                  "authored", 10.0, 0, None, None, ri, ei))
            placed += 1
    return placed


def stage2_paths(blds, tree, paths, stats):
    """Two generators, and the ablation in placement.md §2 is why they are these
    two and not others.

      CROSSING — a footway segment that intersects a footprint edge. The
        intersection point is the door. This is the generator that does the work.
      DEAD-END TERMINUS — a way's first or last vertex, projected onto the
        nearest footprint edge within TERM_R, but ONLY if that vertex is a dead
        end in the footway graph. A terminus shared with another way is a path
        junction, not a door. Requiring degree 1 drops 1,830 junction candidates
        — HALF the output — for ONE point of recall. That is the good trade.

    Then the outward-normal approach gate: before it, only 60% of raw candidates
    agree with the wall they landed on; the other 40% are paths running ALONG a
    wall and dying near it, which is a sidewalk, not a door. The gate costs
    three points of recall for 132 doors' worth of precision, and it ships
    because a door facing the wrong way is a visible defect and a missing door
    is not. TERM_R 6 -> 12 m moves recall by under one node: it is not a knob.
    """
    deg = Counter()
    for nodes, pts, hw, t in paths:
        for nid in nodes:
            deg[nid] += 1
    raw = []
    for nodes, pts, hw, t in paths:
        for i in range(len(pts) - 1):
            ax, ay = pts[i]
            bx, by = pts[i + 1]
            ln = LineString([(ax, ay), (bx, by)])
            for k in tree.query(ln):
                b = blds[int(k)]
                if b.budget < 0:
                    continue
                inter = ln.intersection(b.poly.exterior)
                if inter.is_empty:
                    continue
                for g in (inter.geoms if hasattr(inter, "geoms") else [inter]):
                    if g.geom_type != "Point":
                        continue
                    # THE APPROACH COMES FROM WHICHEVER END IS OUTSIDE, and it
                    # has to be an end far enough away to give a direction at
                    # all. A path that dies ON the wall has |out - door| ~ 0,
                    # _norm returns (0,0), the dot product is 0 and the gate
                    # rejects the single best candidate there is.
                    out = (bx, by) if not b.poly.contains(Point(bx, by)) \
                        else (ax, ay)
                    if math.hypot(out[0] - g.x, out[1] - g.y) < 0.5:
                        ux, uy = _norm(bx - ax, by - ay)
                        if b.poly.contains(Point(bx, by)):
                            ux, uy = -ux, -uy
                        out = (g.x + ux * 5.0, g.y + uy * 5.0)
                    raw.append((b, g.x, g.y, out, 1, hw))
        for endi, nid in ((0, nodes[0] if nodes else None),
                          (-1, nodes[-1] if nodes else None)):
            if nid is None or deg[nid] != 1:
                continue                       # a junction, not a dead end
            ex, ey = pts[endi]
            pt = Point(ex, ey)
            best, bd = None, TERM_R
            for k in tree.query(pt.buffer(TERM_R)):
                b = blds[int(k)]
                if b.budget < 0:
                    continue
                d = b.poly.exterior.distance(pt)
                if d < bd:
                    best, bd = b, d
            if best is None:
                continue
            s = snap_to_edge(best, ex, ey)
            if s:
                # THE SAME TRAP AS THE CROSSING BRANCH: a dead end sitting
                # exactly on the wall gives no direction, _norm returns (0,0),
                # the dot product is 0 and the gate rejects the single best
                # candidate there is. Fall back to the way's own last segment,
                # which is also the right answer for the case the gate exists
                # to reject — a path running ALONG a wall and dying near it.
                out = (ex, ey)
                if math.hypot(ex - s[1], ey - s[2]) < 0.5 and len(pts) > 1:
                    px2, py2 = pts[1] if endi == 0 else pts[-2]
                    ux, uy = _norm(ex - px2, ey - py2)
                    out = (s[1] - ux * 5.0, s[2] - uy * 5.0)
                raw.append((best, s[1], s[2], out, 2, hw))
    stats["stage2_raw"] = len(raw)
    kept = defaultdict(list)
    nkept = 0
    for b, qx, qy, out, gen, hw in raw:
        s = snap_to_edge(b, qx, qy)
        if s is None:
            continue
        d, sx, sy, tx, ty, nx, ny, elen, sa, ri, ei = s
        if not normal_test(b, sx, sy, nx, ny):
            stats["normal_fail_stage2"] += 1
            continue
        vx, vy = _norm(out[0] - sx, out[1] - sy)
        if nx * vx + ny * vy < NORMAL_MIN:
            stats["approach_gate_reject"] += 1
            continue
        kept[b.bid].append(Cand(sx, sy, tx, ty, nx, ny, elen, sa, None,
                                "derived", 2.0 if hw == "steps" else 1.0, gen,
                                None, None, ri, ei))
        nkept += 1
        DERIVED_ALL.append((sx, sy))
    stats["stage2_gated"] = nkept
    return kept


def cluster(cands, r):
    """Two candidates within r are one entrance. Higher priority wins."""
    out = []
    for c in sorted(cands, key=lambda c: (c.prio, -c.score)):
        if all(math.hypot(c.x - o.x, c.y - o.y) >= r for o in out):
            out.append(c)
    return out


def stage3_public(blds, grid, stats):
    """THE PUBLICNESS FIELD, and it is the part that most needs review: it
    supplies most of the file. Path evidence alone produces doors on 167 of
    1,961 footprints and leaves 168 of the 274 named footprints over 400 m2 with
    ZERO, and no tuning of its thresholds changes that — recall is flat from
    TERM_R 6 m to 12 m. So for every in-scope building that has not filled its
    budget, score the perimeter against every line a person can legitimately
    walk on and take the best remaining points.

    Two tests do the work of not putting a door where there is none:

      THE SERVICE-ROAD SIGN TEST. highway=service enters at weight -1.0, so a
      wall whose only company is a loading drive scores below zero and is never
      selected. 80 of 749 buildings in the wide bbox have nothing else in front
      of them.

      THE OUTWARD HALF-PLANE TEST. A sample point only sees segments with
      n . v >= NORMAL_HALF. A path on the FAR side of the building, or one
      running parallel to this wall, contributes nothing. This is what kills
      blank walls facing alleys: they score 0 and there is nothing to select.

    And the pipeline is ALLOWED to output a building with no entrance. 18 of the
    290 do, and that list is the test passing: chillers, cooling towers and
    fourteen unnamed sheds. If a review finds a real building in it, the
    publicness weights are wrong — that is the failure mode to watch.
    """
    for b in blds:
        if b.budget <= 0 or len(b.ents) >= b.budget:
            continue
        cel = CELEBRATED.get(b.ref or "")
        want_side = cel.get("facade") if cel else None
        ring = b.rings[0]
        samples = []
        for i in range(len(ring) - 1):
            a, bb = ring[i], ring[i + 1]
            elen = math.hypot(bb[0] - a[0], bb[1] - a[1])
            if elen < 1.0:
                continue
            tx, ty = _norm(bb[0] - a[0], bb[1] - a[1])
            nx, ny = edge_normal(a, bb, 0)
            k = max(1, int(elen / SAMPLE))
            for s in range(k):
                d = (s + 0.5) * elen / k
                px, py = a[0] + tx * d, a[1] + ty * d
                best = None
                for (ax, ay), (bx, by), w in grid.near(px, py, APPROACH_R):
                    qx, qy, _t = _seg_closest(px, py, ax, ay, bx, by)
                    dd = math.hypot(qx - px, qy - py)
                    if dd > APPROACH_R:
                        continue
                    vx, vy = _norm(qx - px, qy - py)
                    if nx * vx + ny * vy < NORMAL_HALF:
                        continue
                    sc = w * (1.0 - dd / APPROACH_R)
                    if best is None or sc > best:
                        best = sc
                if best is None:
                    continue
                if want_side and _side_ok(want_side, nx, ny):
                    best += FACADE_BONUS
                samples.append((best, px, py, tx, ty, nx, ny, elen, d, i))
        samples.sort(key=lambda s: -s[0])
        for sc, px, py, tx, ty, nx, ny, elen, d, ei in samples:
            if len(b.ents) >= b.budget:
                break
            if sc <= MIN_SCORE:
                break
            if any(math.hypot(px - o.x, py - o.y) < MIN_SEP for o in b.ents):
                continue
            if not normal_test(b, px, py, nx, ny):
                stats["normal_fail_stage3"] += 1
                continue
            b.ents.append(Cand(px, py, tx, ty, nx, ny, elen, d, None,
                               "derived", sc, 3, None, None, 0, ei))
            DERIVED_ALL.append((px, py))
            stats["stage3_placed"] += 1


def _side_ok(side, nx, ny):
    return {"E": nx > 0.5, "W": nx < -0.5,
            "N": ny > 0.5, "S": ny < -0.5}.get(side, False)


def budget_for(b):
    """How many entrances a building gets. OSM's own mapping cannot answer this
    — binned by perimeter its 400-700 m bucket FALLS, which is not architecture,
    it is mapping fatigue (that bucket is Gregory Gym at 1, Moody at 1, Bellmont
    at 1 and the garages). Fitting a curve to that data encodes the fatigue. So:
    a flat metres-of-facade-per-door rule, chosen to match the well-mapped
    middle of the range and then held constant."""
    if b.wc:
        # A West Campus tower has ONE front door and, at most, one more thing:
        # the garage gate or the secondary these two already carry. The
        # perimeter rule would give 2400 Nueces three and Rambler four, all of
        # them invented, on the buildings where the evidence is thinnest.
        return WC_BUDGET
    n = int(round(b.perim / P_PER_DOOR))
    n = max(1, min(NMAX, n))
    if is_parking(b):
        n = min(n, GARAGE_CAP)   # a garage ramp is a vehicle entrance, not a door
    return n


# ══════════════════════════════════════════════════════════════════════
#  WEST CAMPUS — placement, and the measurement that chose the method
#
#  THE CAMPUS METHOD WAS TESTED HERE FIRST AND IT DOES NOT CARRY THIS
#  NEIGHBOURHOOD. Run over the 24 footprints alone, stage 2 produces 28
#  gated candidates on 17 of them — but only SEVEN land on the elevation
#  the street address is on. Ten buildings get a candidate on the wrong
#  wall and seven get none at all. That is not a tuning failure, it is
#  what the geometry says: on the Forty Acres a footway runs UP TO a
#  door, and in West Campus the sidewalk runs ALONG the street past
#  twenty of them, so the dead-end that survives the approach gate is
#  usually a service walk or a cut-through at the back.
#
#  The G is the clean example and it is already in the shipped file: the
#  derivation put its main door on the W 18th (north) wall, and the
#  address (1715 Guadalupe) plus four tagged OSM `steps` ways say west.
#
#  So the ADDRESS picks the wall and the FOOTPATH picks the point on it:
#  a stage-2 candidate is promoted only when it agrees with the address
#  wall and sits within WC_SPEC_AGREE_R of the address point. Everything
#  else falls back to the authored point, and the per-building method is
#  printed every bake.
# ══════════════════════════════════════════════════════════════════════
def side_of(nx, ny):
    """Compass of an outward normal. Four boxes, no diagonals: every one of
    the 24 addresses names one of N/S/E/W."""
    if nx > abs(ny):
        return "E"
    if -nx > abs(ny):
        return "W"
    return "N" if ny > 0 else "S"


def load_place_claims():
    """The wall runs data/places.geojson has already claimed, as plan polygons.

    bake_places.py stands every `front` slab 0.30 m PROUD of its host wall and
    claims NO building ids, which is exactly why six passes can land on the same
    building without colliding — and it only works if each pass refuses to
    overlap the last one. Not "avoids the building": avoids the SEGMENT. All
    four of Dobie / 21 Rio / Pointe on Rio / the Venue need both a lobby and
    their existing shops."""
    claims = []
    if not os.path.exists(PLACES):
        return claims
    pj = json.load(open(PLACES, encoding="utf-8"))
    for f in pj["features"]:
        if f["properties"].get("kind") not in ("front", "awning"):
            continue
        g = f["geometry"]
        rings = g["coordinates"] if g["type"] == "Polygon" else \
            (g["coordinates"][0] if g["type"] == "MultiPolygon" else None)
        if not rings:
            continue
        try:
            p = Polygon([to_m(c[0], c[1]) for c in rings[0]])
            if p.is_valid and not p.is_empty:
                claims.append(p)
        except Exception:
            continue
    return claims


def run_rect(cx, cy, tx, ty, nx, ny, run_w, depth=1.6):
    """The plan footprint of a storefront run, for the claim test."""
    a = (cx - tx * run_w / 2.0, cy - ty * run_w / 2.0)
    b = (cx + tx * run_w / 2.0, cy + ty * run_w / 2.0)
    return Polygon([a, b,
                    (b[0] + nx * depth, b[1] + ny * depth),
                    (a[0] + nx * depth, a[1] + ny * depth)])


def claim_free(tree, claims, cx, cy, tx, ty, nx, ny, run_w):
    r = run_rect(cx, cy, tx, ty, nx, ny, run_w)
    for i in tree.query(r.buffer(WC_CLAIM_R)):
        if claims[int(i)].distance(r) < WC_CLAIM_R:
            return False
    return True


def wc_plane_run(b, ri, ei, s):
    """How much wall a storefront PLANE has, in the frame of edge `ei`.

    Same contract as wall_run() — (metres available backwards, forwards) — and
    the same use, but the walk continues past a jog instead of stopping at it.
    See WC_PLANE_TOL for the measurement that made this necessary. The walk also
    stops if the ring doubles back on itself, so a re-entrant courtyard cannot
    be counted as frontage."""
    ring = b.rings[ri]
    m = len(ring) - 1
    if m < 1 or ei >= m:
        return 0.0, 0.0
    a, bb = ring[ei], ring[ei + 1]
    tx, ty = _norm(bb[0] - a[0], bb[1] - a[1])
    nx, ny = edge_normal(a, bb, ri)
    ox, oy = a[0], a[1]

    def proj(p):
        return ((p[0] - ox) * tx + (p[1] - oy) * ty,
                (p[0] - ox) * nx + (p[1] - oy) * ny)

    lo, hi = proj(a)[0], proj(bb)[0]
    j = ei
    for _ in range(m):
        j = (j + 1) % m
        tq, dq = proj(ring[j + 1])
        if abs(dq) > WC_PLANE_TOL or tq <= hi - WC_PLANE_TOL:
            break
        hi = max(hi, tq)
    j = ei
    for _ in range(m):
        j = (j - 1) % m
        tp, dp = proj(ring[j])
        if abs(dp) > WC_PLANE_TOL or tp >= lo + WC_PLANE_TOL:
            break
        lo = min(lo, tp)
    here = s
    return max(0.0, here - lo), max(0.0, hi - here)


def wc_bays(run_len):
    """Bay count from the measured wall run — a three-step ladder, never a
    fraction of the elevation. A linear rule was tried in the spec first and it
    clamped 16 of 24 buildings to the same value, which means the clamp was
    doing all the work and the rule was fiction."""
    for lim, n in WC_BAYS_LADDER:
        if run_len < lim:
            return n
    return WC_BAYS_LADDER[-1][1]


def wc_elevations(b):
    """Every straight elevation of a footprint, as
    (side, midx, midy, tx, ty, nx, ny, length, ri, ei, s). Collinear edges are
    walked together by wall_run(), so a tessellated wall is one elevation."""
    out, seen = [], set()
    for ri, ring in enumerate(b.rings):
        for ei in range(len(ring) - 1):
            a, bb = ring[ei], ring[ei + 1]
            elen = math.hypot(bb[0] - a[0], bb[1] - a[1])
            if elen < 1.0:
                continue
            tx, ty = _norm(bb[0] - a[0], bb[1] - a[1])
            nx, ny = edge_normal(a, bb, ri)
            left, right = wc_plane_run(b, ri, ei, elen / 2.0)
            mx = a[0] + tx * (elen / 2.0) + (right - left) / 2.0 * tx
            my = a[1] + ty * (elen / 2.0) + (right - left) / 2.0 * ty
            key = (round(mx, 1), round(my, 1))
            if key in seen:
                continue
            seen.add(key)
            out.append((side_of(nx, ny), mx, my, tx, ty, nx, ny,
                        left + right, ri, ei, elen / 2.0))
    return out


def wc_best_elevation(b, want, sx, sy):
    """Every elevation facing the street the address names, best first — run
    length minus distance to the address, see WC_RUN_DIST_W for the incident
    this exists for. A LIST, not one answer: the best elevation can turn out to
    be fully claimed by a shopfront (Dobie Twenty21's Whitis front is), and the
    right response is the next wall on the same street, not no lobby."""
    out = []
    for e in wc_elevations(b):
        if e[0] != want:
            continue
        out.append((e[7] - WC_RUN_DIST_W * math.hypot(e[1] - sx, e[2] - sy), e))
    out.sort(key=lambda r: -r[0])
    return [e for _s, e in out]


def wc_cand_on(b, e, sx, sy, role, src):
    """A candidate at the point of elevation `e` nearest the address point,
    kept EDGE_MARGIN clear of both corners."""
    along = (sx - e[1]) * e[3] + (sy - e[2]) * e[4]
    lim = max(0.0, e[7] / 2.0 - EDGE_MARGIN)
    along = max(-lim, min(lim, along))
    px, py = e[1] + e[3] * along, e[2] + e[4] * along
    sn = snap_to_edge(b, px, py)
    if sn is None:
        return None
    d, qx, qy, tx, ty, nx, ny, elen, sa, ri, ei = sn
    if side_of(nx, ny) != e[0] or not normal_test(b, qx, qy, nx, ny):
        return None
    return Cand(qx, qy, tx, ty, nx, ny, elen, sa, role, src, 8.0, 0,
                None, None, ri, ei)


def load_named_roads():
    """Named road centrelines in metres — used ONLY to answer "does this
    footprint front more than one street", which is westcampus.md §8's gate
    condition. Not used to place anything."""
    path = os.path.join(CACHE, "roads.json")
    if not os.path.exists(path):
        return []
    j = json.load(open(path, encoding="utf-8"))
    out = []
    for e in j.get("elements", []):
        nm = (e.get("tags") or {}).get("name")
        geo = e.get("geometry")
        if not nm or not geo or len(geo) < 2:
            continue
        try:
            out.append((nm, LineString([to_m(p["lon"], p["lat"]) for p in geo])))
        except Exception:
            continue
    return out


def wc_fronting_roads(b, roads, rtree, ev):
    """Which named road, if any, an elevation fronts: the nearest centreline to
    a point WC_ROAD_R/2 out from its midpoint."""
    px = ev[1] + ev[5] * (WC_ROAD_R / 2.0)
    py = ev[2] + ev[6] * (WC_ROAD_R / 2.0)
    pt = Point(px, py)
    best, bd = None, WC_ROAD_R
    for i in rtree.query(pt.buffer(WC_ROAD_R)):
        nm, ln = roads[int(i)]
        d = ln.distance(pt)
        if d < bd:
            best, bd = nm, d
    return best


def wc_place(scope, s2, claims, stats):
    """One lobby per building, and a gate only where §8's rule fires.

    Returns per-building audit rows. Runs BEFORE stage 3 and appends at
    priority 0, so the lobby wins clustering against any derived candidate that
    lands on top of it — which is how Cambridge Tower's existing E2 door gets
    UPGRADED in place rather than duplicated, and how The G's wrong main
    demotes itself to the secondary it always was."""
    ctree = STRtree(claims) if claims else None
    roads = load_named_roads()
    rtree = STRtree([r[1] for r in roads]) if roads else None
    rows = []
    min_run = WC_MIN_BAYS * WC_PITCH + 2 * EDGE_MARGIN

    def seat(pick, meth):
        """Seat a storefront run at `pick`: measure the wall in its own plane,
        slide the run clear of any places `front` it overlaps, narrow it if
        sliding is not enough, and give up on THIS wall if a four-bay run has
        nowhere to stand. Returns (bays, moved) or None."""
        left, right = wc_plane_run(b, pick.ri, pick.ei, pick.s)
        if left + right < min_run:
            return None
        bays = wc_bays(left + right)
        if ctree is None:
            return bays, 0
        while bays >= WC_MIN_BAYS:
            run_w = bays * WC_PITCH
            for k in range(0, WC_CLAIM_TRIES):
                off = (0.0 if k == 0 else
                       ((k + 1) // 2) * WC_CLAIM_SHIFT * (1 if k % 2 else -1))
                if not (-(left - EDGE_MARGIN - run_w / 2) <= off
                        <= (right - EDGE_MARGIN - run_w / 2)):
                    continue
                qx, qy = pick.x + pick.tx * off, pick.y + pick.ty * off
                if claim_free(ctree, claims, qx, qy, pick.tx, pick.ty,
                              pick.nx, pick.ny, run_w):
                    pick.x, pick.y, pick.s = qx, qy, pick.s + off
                    return bays, k
            bays -= 2
            stats["wc_claim_narrowed"] += 1
        return None

    for b in sorted(scope, key=lambda b: b.name or ""):
        if not b.wc:
            continue
        spec = b.wc
        want = spec["side"]
        sx, sy = to_m(spec["at"][0], spec["at"][1])
        evs = wc_best_elevation(b, want, sx, sy)
        if not evs:
            stats["wc_unplaced"] += 1
            rows.append((b.name, want, "NO WALL FACES THE ADDRESS STREET", 0))
            continue

        # ── 1. a footpath candidate, but ONLY on the address wall and only
        #       near the address. Anything else the derivation offers here is a
        #       sidewalk running past the building, which is the West Campus
        #       failure mode measured at the top of this section.
        got, pick, meth = None, None, None
        for c in sorted(s2.get(b.bid) or [], key=lambda c: -c.score):
            if side_of(c.nx, c.ny) != want:
                continue
            if math.hypot(c.x - sx, c.y - sy) > WC_SPEC_AGREE_R:
                continue
            got = seat(c, "path")
            if got is None:
                stats["wc_path_run_too_short"] += 1
                continue
            pick, meth = c, "path"
            break
        # ── 2. the address point, projected onto each wall on the address
        #       street in turn, best first. Never a different street: the
        #       street is the one thing in this table that is [S].
        if pick is None:
            for ev in evs:
                cand = wc_cand_on(b, ev, sx, sy, "main", "westcampus")
                if cand is None:
                    continue
                got = seat(cand, "spec")
                if got is None:
                    continue
                pick, meth = cand, "spec"
                break
        # ── 3. the midpoint of the best wall on that street, if projecting the
        #       address point onto it did not land anywhere legal.
        if pick is None:
            for ev in evs:
                cand = wc_cand_on(b, ev, ev[1], ev[2], "main", "westcampus")
                if cand is None:
                    continue
                got = seat(cand, "default")
                if got is None:
                    continue
                pick, meth = cand, "default"
                break
        if pick is None:
            stats["wc_unplaced"] += 1
            rows.append((b.name, want, "NO WALL ON THAT STREET IS FREE", 0))
            continue

        bays, moved = got
        if moved:
            stats["wc_claim_moved"] += 1
        pick.role = "main"
        pick.wcrole = "lobby"
        pick.wcmeth = meth
        if pick not in b.ents:
            b.ents.append(pick)
        stats["wc_lobby_" + meth] += 1
        rows.append((b.name, want, meth, bays))
    return rows


def wc_gates(scope, claims, stats):
    """The garage gate, and it is the WEAKEST column in the document: 2 of the
    24 garages are sourced with a street, 4 more are sourced as existing with an
    unverified street, and eighteen buildings have no garage evidence at all.

    So a gate is drawn only where the GARAGE ITSELF is sourced. Where its street
    is not, westcampus.md §8's rule picks it — the shortest non-address
    elevation on a footprint that fronts more than one named road — and the
    feature carries `gtv: false` so all four are one query away. Eighteen
    buildings get nothing, on purpose: "usually has one" is how a wrong door
    gets onto twenty-two buildings at once.

    Runs AFTER stage 3 so a gate never spends the pedestrian budget."""
    ctree = STRtree(claims) if claims else None
    roads = load_named_roads()
    rtree = STRtree([r[1] for r in roads]) if roads else None
    for b in sorted(scope, key=lambda b: b.name or ""):
        if not b.wc or not b.wc.get("gate"):
            continue
        want = b.wc["side"]
        lob = [c for c in b.ents if c.wcrole == "lobby"]
        if not lob:
            continue
        evs = wc_elevations(b)
        side, gtv = b.wc["gate"], True
        if side == "auto":
            gtv, side = False, None
            fronted = {}
            for e in evs:
                nm = wc_fronting_roads(b, roads, rtree, e) if rtree else None
                if nm:
                    fronted.setdefault(nm, []).append(e)
            if len(fronted) >= 2:
                pool = [e for es in fronted.values() for e in es
                        if e[0] != want and e[7] >= WC_GATE_W + 2 * EDGE_MARGIN]
                if pool:
                    side = min(pool, key=lambda e: e[7])[0]
        if not side:
            stats["wc_gate_no_side_street"] += 1
            continue
        for e in sorted([e for e in evs if e[0] == side], key=lambda e: -e[7]):
            if e[7] < WC_GATE_W + 2 * EDGE_MARGIN:
                continue
            if math.hypot(e[1] - lob[0].x, e[2] - lob[0].y) < WC_GATE_SEP:
                continue
            if not normal_test(b, e[1], e[2], e[5], e[6]):
                continue
            if ctree is not None and not claim_free(
                    ctree, claims, e[1], e[2], e[3], e[4], e[5], e[6],
                    WC_GATE_W):
                continue
            g = wc_cand_on(b, e, e[1], e[2], "service", "westcampus")
            if g is None:
                continue
            g.wcrole = "gate"
            g.wcmeth = "sourced" if gtv else "sidestreet"
            b.ents.append(g)
            stats["wc_gate_" + g.wcmeth] += 1
            break
        else:
            stats["wc_gate_no_room"] += 1


# ══════════════════════════════════════════════════════════════════════
#  THE ASSEMBLY
#
#  Nine primitives and nothing else: LEAF, STILE, TRANSOM, SIDELIGHT,
#  SURROUND, REVEAL, FLIGHT, RAIL/CHEEK, CANOPY. The families differ only
#  in which are present and in their parameter values.
#
#  Local frame: u across the wall (m from the entrance centre), v out from
#  the wall face (positive = away from the building), z above grade.
# ══════════════════════════════════════════════════════════════════════
# ══════════════════════════════════════════════════════════════════════
#  RAISED-DECK EVIDENCE — the general rule behind the PCL fix.
#
#  A sill may only sit above local grade if something the repo ACTUALLY
#  DRAWS holds it up there. The two files that carry raised ground are
#  data/depth.geojson (the South Mall flights, the Littlefield basin) and
#  data/ground.geojson (banks). Neither is written by this pass, both are
#  read-only here, and if a later pass builds PCL's plaza the evidence
#  appears and the exception grants itself with no edit in this file.
#
#  Measured on 2026-08-04: the tallest raised deck anywhere in the repo is
#  1.27 m, on the South Mall. There is no 3.46 m plaza in this city.
# ══════════════════════════════════════════════════════════════════════
DECKS = None            # [(x, y, top_m)] sampled at polygon vertices


def load_decks():
    global DECKS
    if DECKS is not None:
        return DECKS
    DECKS = []
    # ONLY ground-plane deck geometry counts, and the filter is not cosmetic.
    # The first cut read every `h` in ground.geojson and reported the tallest
    # deck in Austin at 27.44 m — that is `cnp`, a LIVE OAK. A canopy is not a
    # plaza, and a building wall is not one either, which is why no building
    # file is listed here: a wall beside a door would "support" any sill you
    # like. This is §36's wrong-layer trap in its ground-plane costume.
    for name, top_of in (("depth.geojson",
                          lambda p: (p.get("b") or 0.0) + (p.get("h") or 0.0)),
                         ("ground.geojson",
                          lambda p: (p.get("h") or 0.0)
                          if p.get("k") == "bank" else 0.0)):
        path = os.path.join(ROOT, "data", name)
        if not os.path.exists(path):
            continue
        try:
            doc = json.load(open(path, encoding="utf-8"))
        except Exception:
            continue
        for f in doc.get("features") or []:
            p = f.get("properties") or {}
            try:
                top = float(top_of(p))
            except (TypeError, ValueError):
                continue
            if top < 0.30:
                continue
            g = f.get("geometry") or {}
            rings = []
            if g.get("type") == "Polygon":
                rings = g.get("coordinates") or []
            elif g.get("type") == "MultiPolygon":
                for poly in g.get("coordinates") or []:
                    rings.extend(poly)
            for ring in rings[:1]:
                for lon, lat in ring:
                    x, y = to_m(lon, lat)
                    DECKS.append((x, y, top))
    return DECKS


def deck_support(x, y, want):
    """The best raised top within PLAZA_EVIDENCE_R that reaches enough of
    `want`, or None. Returns the DECK's own height, never the wanted one —
    a 1.2 m terrace does not become a storey because somebody asked."""
    need = want * PLAZA_EVIDENCE_FRAC
    best = None
    for dx, dy, top in load_decks():
        if top < need:
            continue
        if (dx - x) ** 2 + (dy - y) ** 2 <= PLAZA_EVIDENCE_R ** 2:
            if best is None or top > best:
                best = top
    return best


# Local-frame copy of every emitted piece, for the support audits in main().
# (eid, k, u0, u1, v0, v1, z0, z1) — the geojson itself is lon/lat by then and
# a support test in lon/lat is a test nobody can read.
LOCAL = []
# bid -> bay count actually drawn, so the West Campus audit can print the bay
# mix without re-deriving it from the geometry.
WC_AUDIT = {}


class Ent(object):
    """One entrance. Emits its own pieces, all of them proud of the wall."""

    def __init__(self, feats, eid, b, c, fam, cel, role, n, dt, mat, src):
        self.feats, self.eid = feats, eid
        self.bid, self.ref = b.bid, b.ref
        self.nm = b.name or b.osm_name
        self.role, self.era, self.n, self.dt, self.mat = role, fam["era"], n, dt, mat
        self.src = src
        self.cx, self.cy = c.x, c.y
        self.tx, self.ty, self.nx, self.ny = c.tx, c.ty, c.nx, c.ny
        self.night = (cel or {}).get("night")

    def pt(self, u, v):
        return to_ll(self.cx + u * self.tx + v * self.nx,
                     self.cy + u * self.ty + v * self.ny)

    def box(self, k, mat, wd, u0, u1, v0, v1, z0, z1, wn=None, extra=None):
        """ONE piece. `base` is the bottom, `h` is the THICKNESS — see the
        module header; this file disagrees with places.geojson on purpose."""
        if z1 - z0 < 0.015 or abs(u1 - u0) < 0.015 or abs(v1 - v0) < 0.004:
            return
        ring = [self.pt(u0, v0), self.pt(u1, v0),
                self.pt(u1, v1), self.pt(u0, v1)]
        area = 0.0
        for i in range(4):
            ax, ay = ring[i]
            bx, by = ring[(i + 1) % 4]
            area += ax * by - bx * ay
        if area < 0:
            ring.reverse()
        ring.append(ring[0])
        wg, wn_auto = wall_ramp(wd)
        LOCAL.append((self.eid, k, min(u0, u1), max(u0, u1),
                      min(v0, v1), max(v0, v1), z0, z1))
        props = {
            "k": k, "eid": self.eid, "bid": self.bid, "ref": self.ref,
            "nm": self.nm, "role": self.role, "era": self.era,
            "n": self.n, "dt": self.dt, "mat": mat,
            "base": round(z0, 3), "h": round(z1 - z0, 3),
            "wd": wd, "wg": wg, "wn": wn or wn_auto, "src": self.src,
        }
        if extra:
            # `nmv` / `gtv`: "how much of West Campus is guessed" has to be a
            # query, not an archaeology project (westcampus.md §8 rule 3).
            props.update(extra)
        self.feats.append({
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": [ring]},
            "properties": props,
        })


def leaf_plan(bank_w, leaf_w, max_pairs):
    """Leaf count is DERIVED, never authored (eras.md §3.9). If one building
    comes out with the wrong number of doors the OPENING WIDTH is wrong, not the
    count — fix the rule, never patch the cell."""
    pair_w = 2 * leaf_w + MEET_STILE
    if bank_w < pair_w:
        return 1, max(0.0, bank_w - leaf_w)
    pairs = int((bank_w + MULLION) // (pair_w + MULLION))
    pairs = max(1, min(max_pairs, pairs))
    leftover = bank_w - (pairs * pair_w + (pairs - 1) * MULLION)
    return 2 * pairs, max(0.0, leftover)


def glass_for(ref, fam, bid=None):
    """Family first, then the per-building sample, then a per-building tint.

    Order matters and it is the one thing in here that is not taste: where the
    repo has already SAMPLED a building's glass that value wins outright and
    takes no tint, because an entrance in a different blue from the curtain
    wall three metres above it is a visible defect (eras.md §3.5). Everything
    else gets its family's glazing, nudged by a deterministic per-building
    step so that two neighbours are not the identical pane.
    """
    if (ref or "") in GLASS_BY_REF:
        return GLASS_BY_REF[ref]
    base = fam.get("glass_col") or GLASS
    if GLASS_VARY <= 1 or bid is None:
        return base
    i = (hash_bid(bid) % GLASS_VARY) - (GLASS_VARY - 1) / 2.0
    return scale(base, 1.0 + i * GLASS_VARY_STEP)


def hash_bid(bid):
    """A stable small integer for a building id. Python's own hash() is salted
    per process, so a bake would produce a different file every run — which is
    the sort of thing that turns a diff into an unreadable 4 MB churn."""
    h = 2166136261
    for ch in str(bid):
        h = ((h ^ ord(ch)) * 16777619) & 0xFFFFFFFF
    return h


def night_glass(eid, override=None):
    """Lit, warm and pre-compensated — see the NIGHT block at the top. This no
    longer derives the night value from the day value: a blue ramped to night
    and nudged toward a lamp is a near-neutral mid grey, which is precisely the
    defect. A lit vestibule is not a dark pane with a hint of lamp in it."""
    if override:
        return override
    return GLASS_NIGHT_LIT[eid % len(GLASS_NIGHT_LIT)]


def assemble_w(feats, b, c, eid, stats):
    """A West Campus lobby, or its garage gate.

    Family `W` gets its own assembler for one reason: the storefront RUN and
    the door BANK are two different widths, and the generic assembler has one.
    The run is 6/8/10 bays of glass with a leasing office in it and a canopy
    over all of it; the doors are two or three of those bays. Everything else —
    Ent, box(), leaf_plan(), glass_for(), night_glass(), the stair profile and
    every colour — is the same alphabet the other five families use, and the
    piece kinds are the eleven that already exist, so js/entrances.js needs no
    edit and the atlas grows by nothing.
    """
    fam = dict(FAMILIES["W"])
    wc = b.wc
    band_h, band_fam = wc["band"]
    mull = WC_MULL_DK if band_fam == "sg" else WC_MULL_LT

    # ── THE GATE, and it is a different thing from a door. eras.md E3's
    #    6.00 x 4.30 vehicle opening is a PUBLIC DECK opening and on a 4.4 m
    #    base band it does not physically fit. Slats are not drawn — a 60 mm
    #    slat is a tenth of a pixel at cruise — so the head housing is what
    #    makes it read as a gate rather than a hole in the wall.
    if c.wcrole == "gate":
        gtv = (c.wcmeth == "sourced")
        e = Ent(feats, eid, b, c, fam, None, "service", 1, "roll", "steel",
                c.src)
        gh = min(WC_GATE_H_MAX, band_h - WC_GATE_HEAD)
        half = WC_GATE_W / 2.0
        ex = {"gtv": gtv}
        e.box("reveal", "concrete", mix(REVEAL_COOL, ARCH_SHADOW, 0.30),
              -half, half, REVEAL_PROUD, REVEAL_PROUD + REVEAL_T,
              GROUND_Z, GROUND_Z + gh, None, ex)
        e.box("door", "steel", IRON, -half, half, PROUD_DOOR,
              PROUD_DOOR + LEAF_T, GROUND_Z, GROUND_Z + gh, None, ex)
        e.box("surround", "aluminium", mull, -(half + 0.20), half + 0.20,
              0.0, WC_FRAME_PROUD, GROUND_Z + gh,
              GROUND_Z + gh + WC_GATE_HEAD_H, None, ex)
        stats["wc_gates_drawn"] += 1
        return e

    # ── THE RUN. Bays come off the MEASURED wall, then are clamped to what
    #    the wall between the corners can actually carry. A ten-bay lobby on a
    #    wall that fits six is the same defect as a 7.2 m Cret portal on a 4 m
    #    segment, and shrinking it is not.
    left, right = wc_plane_run(b, c.ri, c.ei, c.s)
    usable = max(WC_MIN_BAYS * WC_PITCH, left + right - 2 * EDGE_MARGIN)
    bays = min(wc_bays(left + right), int(usable // WC_PITCH))
    bays = max(WC_MIN_BAYS, bays)
    run_w = bays * WC_PITCH
    WC_AUDIT[b.bid] = bays
    half = run_w / 2.0
    lo = -(left - EDGE_MARGIN - half)
    hi = right - EDGE_MARGIN - half
    shift = 0.0 if lo <= 0.0 <= hi else (lo if lo > 0 else hi)
    c.x += c.tx * shift
    c.y += c.ty * shift
    stats["wc_bays_%d" % bays] += 1

    # ── the doors. Leaf count is DERIVED from the bays and never authored: a
    #    ten-bay run gets a vestibule quad, everything else a hinged pair.
    #    Nobody gets a slider and nobody gets a revolving door — not one of
    #    the 24 was found described with either, and a revolving drum on a
    #    158-unit student tower is exactly the confident fabrication this
    #    family exists not to commit.
    n_leaf = 4 if bays >= WC_QUAD_BAYS_MIN else 2
    door_bays = WC_QUAD_BAYS if n_leaf == 4 else WC_DOOR_BAYS
    door_bays = min(door_bays, bays - 1)
    lease_bays = min(wc.get("lease", WC_LEASE_BAYS), bays - door_bays - 1)
    # The leasing office goes on the quieter half — the end of the run further
    # from the nearest corner, which is the end further INTO the elevation and
    # away from the street corner. Derived from the wall run, not chosen.
    lease_hi = right >= left
    if lease_hi:
        lease = set(range(bays - lease_bays, bays))
        free0, free1 = 0, bays - lease_bays
    else:
        lease = set(range(lease_bays))
        free0, free1 = lease_bays, bays
    d0 = free0 + max(0, (free1 - free0 - door_bays) // 2)
    doors = set(range(d0, d0 + door_bays))

    door_w = n_leaf * fam["leaf_w"] + (n_leaf - 1) * MEET_STILE + WC_DOOR_MARGIN
    n_leaf, leftover = leaf_plan(door_w, fam["leaf_w"], fam["max_pairs"])
    dt = "hinged-quad" if n_leaf >= 4 else "hinged-pair"
    u_door = -half + (d0 + door_bays / 2.0) * WC_PITCH

    # ── the vertical dimensions, all four derived from the ONE measured
    #    number this building brings: its own base band.
    lobby_h = band_h - WC_HEAD_DROP
    rise = FLOOR_RISE if wc.get("steps") else 0.0
    risers = int(round(rise / FLIGHT_RISER)) if rise > 0 else 0
    riser = (rise / risers) if risers else 0.0
    if risers <= 0:
        rise = 0.0
    z_thr = GROUND_Z + rise
    head = z_thr + fam["leaf_h"]
    z_top = GROUND_Z + lobby_h
    if z_top < head + WC_CAN_CLEAR + WC_RAIL_T:
        # The Nine at Rio's 4.4 m band is the shallowest in the set and this is
        # the guard that keeps a two-storey lobby off it rather than a comment
        # hoping nobody tries.
        z_top = head + WC_CAN_CLEAR + WC_RAIL_T
        stats["wc_head_clamped"] += 1

    e = Ent(feats, eid, b, c, fam, None, "main", n_leaf, dt, "glass", c.src)
    gcol = glass_for(b.ref, fam, b.bid)
    gnight = night_glass(eid)
    lease_night = GLASS_NIGHT_LIT[1 % len(GLASS_NIGHT_LIT)]
    nmv = wc.get("sign") is not None and wc.get("sign") == "warm"
    ex = {"nmv": nmv}

    # ── 1. REVEAL across the door bank. No CSG, so this is a dark slab whose
    #       COLOUR is the shadow — the same trick as every other family, and
    #       at reveal_d 0.30 it is the flattest one in the city.
    dhalf = door_bays * WC_PITCH / 2.0
    rev = mix(fam["reveal_col"], ARCH_SHADOW,
              REVEAL_DEPTH_MIX * min(1.0, fam["reveal_d"] / REVEAL_DEPTH_REF))
    e.box("reveal", "concrete", rev, u_door - dhalf, u_door + dhalf,
          REVEAL_PROUD, REVEAL_PROUD + REVEAL_T, z_thr, head, None, ex)

    # ── 2. THE STOREFRONT, bay by bay. Uniform primitives are the null
    #       hypothesis: every bay is the same size and the same internal
    #       composition, and what varies is only WHICH of the three it is.
    mw = WC_MULL_W
    for i in range(bays):
        u0 = -half + i * WC_PITCH
        u1 = u0 + WC_PITCH
        a0, a1 = u0 + mw / 2.0, u1 - mw / 2.0
        if i in doors:
            # over the doors: the head glazing that in every other family is
            # called a transom. Same thing, drawn as part of the run.
            e.box("glass", "glass", gcol, a0, a1, WC_GLASS_V0, WC_GLASS_V1,
                  head + TRANSOM_GAP, z_top - WC_RAIL_T, gnight, ex)
            continue
        lease_bay = i in lease
        e.box("surround", "aluminium", mull, a0, a1,
              WC_GLASS_V0, WC_SILL_PROUD, z_thr, z_thr + WC_BULK_H, None, ex)
        e.box("glass", "glass", GLASS_WARM if lease_bay else gcol, a0, a1,
              WC_GLASS_V0, WC_GLASS_V1, z_thr + WC_BULK_H, z_top - WC_RAIL_T,
              lease_night if lease_bay else gnight,
              {"nmv": nmv, "lease": True} if lease_bay else ex)

    # ── 3. THE MULLION GRID. Geometry, not a tile: a tile has no vertical
    #       anchor and this one has to line up with a door. bays+1 verticals
    #       plus a head rail plus, on the seven runs that are genuinely two
    #       storeys, one mezzanine rail.
    for i in range(bays + 1):
        u = -half + i * WC_PITCH
        e.box("surround", "aluminium", mull, u - mw / 2.0, u + mw / 2.0,
              WC_GLASS_V1, WC_FRAME_PROUD, z_thr, z_top, None, ex)
    e.box("surround", "aluminium", mull, -half, half,
          WC_GLASS_V1, WC_FRAME_PROUD, z_top - WC_RAIL_T, z_top, None, ex)
    if lobby_h >= WC_TWO_STOREY:
        zm = z_thr + (z_top - z_thr) * WC_MEZZ_FRAC
        e.box("surround", "aluminium", mull, -half, half,
              WC_GLASS_V1, WC_FRAME_PROUD, zm, zm + WC_RAIL_T, None, ex)
        stats["wc_two_storey"] += 1

    # ── 4. LEAVES and their lights.
    span = n_leaf * fam["leaf_w"] + (n_leaf - 1) * MEET_STILE
    u = u_door - span / 2.0
    for i in range(n_leaf):
        e.box("door", "glass", fam["leaf_col"], u, u + fam["leaf_w"],
              PROUD_DOOR, PROUD_DOOR + LEAF_T, z_thr, head, None, ex)
        gh = fam["leaf_h"] * fam["glaz_frac"]
        e.box("glass", "glass", gcol, u + FRAME_W, u + fam["leaf_w"] - FRAME_W,
              PROUD_DOOR + LEAF_T, PROUD_DOOR + LEAF_T + GLASS_PROUD,
              head - gh + FRAME_W, head - FRAME_W, gnight, ex)
        u += fam["leaf_w"] + MEET_STILE

    # ── 5. FLIGHT and RAIL — three buildings, all [M]. bake_depth.py's
    #       vocabulary and constants, not a second stair look: one course is a
    #       dark slab with a light slab set back on top, and the slabs nest.
    if risers > 0:
        flight_w = door_bays * WC_PITCH + 2 * FLIGHT_SIDE
        tread = fam["tread"]
        run = risers * tread
        step_light = mix(CONCRETE, LIMESTONE, 0.25)
        step_dark = scale(step_light, STEP_DARK_MIX)
        nos = min(STEP_NOSING, tread * STEP_NOSING_FRAC)
        for j in range(1, risers + 1):
            vlead = (risers - j + 1) * tread
            ztop = GROUND_Z + j * riser
            e.box("step", "limestone", step_dark, u_door - flight_w / 2,
                  u_door + flight_w / 2, 0.0, vlead, 0.0, ztop, None, ex)
            if nos > 0.02 and vlead - nos > 0.05:
                e.box("step", "limestone", step_light, u_door - flight_w / 2,
                      u_door + flight_w / 2, 0.0, vlead - nos, 0.0,
                      ztop + STEP_LIFT, None, ex)
        if risers >= RAIL_MIN_RISERS:
            for si in range(RAIL_SEGS):
                v0 = run * si / RAIL_SEGS
                v1 = run * (si + 1) / RAIL_SEGS
                j = max(1, min(risers,
                               int(round((run - (v0 + v1) / 2) / tread)) + 1))
                ztop = GROUND_Z + j * riser
                for sgn in (-1, 1):
                    uu = u_door + sgn * (flight_w / 2 - RAIL_D / 2)
                    e.box("rail", "steel", STEEL, uu - RAIL_D / 2,
                          uu + RAIL_D / 2, v0, v1, ztop + RAIL_H - RAIL_D,
                          ztop + RAIL_H, None, ex)
                    vm = (v0 + v1) / 2.0
                    e.box("rail", "steel", STEEL, uu - RAIL_POST_D / 2,
                          uu + RAIL_POST_D / 2, vm - RAIL_POST_D / 2,
                          vm + RAIL_POST_D / 2, 0.0, ztop + RAIL_H - RAIL_D,
                          None, ex)

    # ── 6. THE CANOPY, over the whole run. It is a SIGNBOARD WITH A SOFFIT,
    #       not family D's blade, and the 0.30 m against D's 0.18 is the read.
    cp, ct_, ctop = wc.get("canopy") or (WC_CAN_PROJ, WC_CAN_T, None)
    if ctop is None:
        ctop = GROUND_Z + min(WC_CAN_TOP_MAX, lobby_h - WC_CAN_HEAD_CLEAR)
    ctop = max(ctop, head + WC_CAN_CLEAR + ct_)
    ctop = min(ctop, z_top - WC_RAIL_T)
    e.box("canopy", "steel", STEEL, -(half + WC_CAN_SIDE), half + WC_CAN_SIDE,
          0.0, cp, ctop - ct_, ctop, None, ex)
    e.box("canopy", "steel", SOFFIT_DK, -(half + WC_CAN_SIDE),
          half + WC_CAN_SIDE, 0.0, cp, ctop - ct_ - 0.06, ctop - ct_, None, ex)

    # ── 7. THE NAME BAND — the field most likely to be fabricated, so it is
    #       the most constrained thing in the family. 21 of 24 wordmarks are
    #       unverified, and at 200-900 m a 0.55 m cap height is about one
    #       pixel, so what is drawn is a LIT BAND and not a wordmark. The
    #       feature carries `nmv` so all 21 are one query away.
    tone = wc.get("sign", "white")
    if tone is not None:
        trio = WC_SIGN_WARM if tone == "warm" else WC_SIGNW
        if WC_NAME_PLACE == "fascia":
            nw = WC_NAME_FRAC * (half + WC_CAN_SIDE)
            e.box("sign", "steel", trio[0], -nw, nw,
                  cp - WC_NAME_T, cp + WC_NAME_PROUD_F,
                  ctop - ct_ + WC_NAME_INSET, ctop - WC_NAME_INSET,
                  trio[2], ex)
            stats["wc_name_bands"] += 1
        else:
            gap = z_top - ctop
            if gap >= WC_NAME_MIN_SPAN:
                cap = min(WC_NAME_CAP_MAX, gap * WC_NAME_CAP_FRAC)
                zb = ctop + (gap - cap) / 2.0
                nw = WC_NAME_FRAC * run_w / 2.0
                e.box("sign", "steel", trio[0], -nw, nw,
                      WC_SIGN_V0, WC_SIGN_PROUD, zb, zb + cap, trio[2], ex)
                stats["wc_name_bands"] += 1
            else:
                stats["wc_name_no_room"] += 1
    return e


def assemble(feats, b, c, eid, stats):
    fam_key = b.fam
    if fam_key == "W" and b.wc:
        if c.wcrole:
            return assemble_w(feats, b, c, eid, stats)
        # A West Campus building gets ONE leasing lobby. Its other doors are
        # side and service doors, and the honest vocabulary for those is the
        # one the apartment fallback already has — drawing a second two-storey
        # glazed storefront on the back of the same tower would be exactly the
        # double-draw this pass exists to avoid.
        fam_key = "E2"
        stats["wc_secondary_e2"] += 1
    fam = dict(FAMILIES[fam_key])
    cel = CELEBRATED.get(b.ref or "")
    if cel:
        for k in ("arched", "reveal_col", "sur_col", "accent"):
            if k in cel:
                fam[k] = cel[k]
        if cel.get("accent"):
            fam["accent_h"] = max(fam["accent_h"], 0.30)
        if cel.get("canopy") is False:
            fam["canopy"] = None

    role = c.role or "secondary"
    src = c.src

    # ── the opening, clamped to the wall it sits on and slid clear of the
    #    corners. A 7.2 m Cret portal on a 4 m wall segment is a defect you can
    #    see; shrinking it is not.
    want_w = (cel or {}).get("open_w") if cel and role == "main" else None
    if want_w is None:
        want_w = fam["open_w"] if role == "main" else fam["open_w_sec"]
    left, right = wall_run(b, c.ri, c.ei, c.s)
    usable = max(1.0, left + right - 2 * EDGE_MARGIN)
    bank_w = min(want_w, usable)
    half = bank_w / 2.0
    lo = -(left - EDGE_MARGIN - half)
    hi = right - EDGE_MARGIN - half
    shift = 0.0 if lo <= 0.0 <= hi else (lo if lo > 0 else hi)
    c.x += c.tx * shift
    c.y += c.ty * shift

    # ── leaves
    leaf_w, leaf_h = fam["leaf_w"], fam["leaf_h"]
    n_leaf, leftover = leaf_plan(bank_w, leaf_w, fam["max_pairs"])
    if cel and cel.get("n") and role == "main":
        n_leaf = cel["n"]
        leftover = max(0.0, bank_w - n_leaf * leaf_w - (n_leaf - 1) * MEET_STILE)
    dt = (cel or {}).get("dt") if cel and role == "main" else None
    if dt is None:
        dt = fam["dt"]
        if dt not in ("revolving", "sliding", "overhead"):
            if n_leaf == 1:
                dt = "single"
            elif fam["arched"]:
                dt = "arched-pair"
            elif n_leaf >= 4:
                dt = "hinged-quad"
            else:
                dt = "hinged-pair"
    mat = (cel or {}).get("mat") if cel and role == "main" else None
    if mat is None:
        mat = fam["leaf_mat"]
    leaf_col = {"bronze": BRONZE, "wood": WOOD, "aluminium": ALUMINIUM,
                "glass": STEEL, "steel": IRON}.get(mat, fam["leaf_col"])

    # ── the flight. Riser count is derived, never authored, and then the riser
    #    is re-sized so the flight lands EXACTLY on the threshold.
    on_deck = False
    if cel and cel.get("risers") is not None:
        risers = int(cel["risers"])
        riser = fam["riser"]
        rise = min(risers * riser, MONUMENTAL_RISE_MAX if fam_key in ("A", "B")
                   else FLIGHT_RISE_MAX)
        riser = rise / risers if risers else 0.0
    elif c.risers:
        risers = max(1, min(12, int(c.risers)))
        rise = min(risers * fam["riser"], FLIGHT_RISE_MAX)
        riser = rise / risers
    else:
        rise = fam["rise"]
        cap = MONUMENTAL_RISE_MAX if fam_key in ("A", "B") else FLIGHT_RISE_MAX
        rise = min(rise, cap)
        risers = max(0, int(round(rise / fam["riser"])))
        riser = (rise / risers) if risers else 0.0
    if cel and cel.get("plaza_z"):
        # PCL: the entrance is on the SECOND FLOOR off a plaza [S], so the rise
        # ought to be taken by the plaza rather than by a 4 m flight on the
        # ground-floor wall. That reasoning is right and the assumption behind
        # it was never checked: NO PASS BUILDS THE PLAZA. Shipping it anyway put
        # four doors 3.68 m up a blank wall on a tan slab — a table. So the
        # request is granted only against evidence, and refused loudly.
        want = float(cel["plaza_z"])
        stats["plaza_requested"] += 1
        got = deck_support(c.x, c.y, want)
        if got is None:
            stats["plaza_refused"] += 1
            stats["plaza_refused_" + (b.ref or "?")] += 1
        else:
            risers, rise = 0, min(want, got)
            on_deck = True
            stats["plaza_exception"] += 1
    if risers <= 0 and not on_deck:
        # No flight means no rise. A sill lifted by a rounding remainder with
        # nothing under it is the same bug as PCL's, three centimetres tall.
        rise, riser = 0.0, 0.0
    tread = fam["tread"]
    z0 = GROUND_Z + rise                     # the threshold
    head = z0 + leaf_h

    # A per-building ARCHED override on a square-headed family (Gregory Gym's
    # "set of grand arches" on an otherwise Cret portal [S]) has no arch
    # geometry of its own, so give it the semicircular one the alphabet already
    # defines: rise = half the clear span, springing just over the door head.
    # Without this the arch silently drew nothing — spring_h/arch_rise were
    # family B's 4.10/0.00.
    if fam["arched"] and fam["arch_rise"] < 0.01:
        fam["spring_h"] = head + 0.25
        fam["arch_rise"] = half
        fam["transom_h"] = half

    # ── 1. REVEAL. There is no CSG, so this is not a hole: it is a dark slab
    #       standing REVEAL_PROUD off the wall whose COLOUR is the shadow, plus
    #       two jamb returns that are the only real 3D depth in the assembly.
    #       Depth is read from value, not from geometry.
    e = Ent(feats, eid, b, c, fam, cel, role, n_leaf, dt, mat, src)
    # DEPTH IS A COLOUR HERE. The deeper the family's notional reveal, the
    # further the slab goes toward the arcade shadow the repo already sampled.
    # This is the whole of the depth read now; the jamb below is a return, not
    # a measuring stick.
    depth_t = REVEAL_DEPTH_MIX * min(1.0, fam["reveal_d"] / REVEAL_DEPTH_REF)
    rev = mix(fam["reveal_col"], ARCH_SHADOW, depth_t)
    rev_top = head + (fam["transom_h"] if fam["transom"] else 0.0)
    if fam["arched"]:
        rev_top = fam["spring_h"] + fam["arch_rise"]
    e.box("reveal", "concrete", rev, -half, half,
          REVEAL_PROUD, REVEAL_PROUD + REVEAL_T, GROUND_Z, rev_top)
    # The jamb return: the side of the opening, between the wall face and the
    # door plane, sitting FLUSH INSIDE the opening. It stops at the door plane
    # (plus a hair, so the leaf reads as sitting back inside it) and it can
    # never become a post. See JAMB_PROJ_MAX at the top for the incident.
    door_plane = PROUD_DOOR + LEAF_T
    jproj = max(door_plane + 0.02, fam["surround_proj"])
    jproj = min(jproj, JAMB_PROJ_MAX)
    jw = min(JAMB_T, max(0.05, half * 0.35))
    for sgn in (-1, 1):
        u_out = sgn * half
        u_in = sgn * (half - jw)
        e.box("reveal", "concrete", scale(rev, JAMB_SHADE),
              min(u_in, u_out), max(u_in, u_out), JAMB_PROJ_MIN, jproj,
              GROUND_Z, rev_top)

    # ── 2. LEAVES + their lights. The light stands GLASS_PROUD of the leaf: a
    #       light recessed inside a solid leaf is a light nobody can see.
    gcol = glass_for(b.ref, fam, b.bid)
    gnight = night_glass(eid, e.night)
    if fam_key == "E3" and role == "service":
        e.box("door", "steel", IRON, -half, half, PROUD_DOOR,
              PROUD_DOOR + LEAF_T, GROUND_Z, GROUND_Z + fam["spring_h"])
    else:
        span = n_leaf * leaf_w + (n_leaf - 1) * MEET_STILE
        u = -span / 2.0
        gfrac = fam["glaz_frac"]
        for i in range(n_leaf):
            e.box("door", mat, leaf_col, u, u + leaf_w,
                  PROUD_DOOR, PROUD_DOOR + LEAF_T, z0, head)
            gh = leaf_h * gfrac
            if gh > 2 * FRAME_W + 0.05:
                e.box("glass", "glass", gcol, u + FRAME_W, u + leaf_w - FRAME_W,
                      PROUD_DOOR + LEAF_T, PROUD_DOOR + LEAF_T + GLASS_PROUD,
                      head - gh + FRAME_W, head - FRAME_W, gnight)
            u += leaf_w + MEET_STILE
        # sidelights out of the leftover; below SIDELIGHT_MIN it is absorbed
        side = leftover / 2.0
        if side >= SIDELIGHT_MIN:
            for sgn in (-1, 1):
                a0 = sgn * (span / 2.0 + 0.02)
                a1 = sgn * (span / 2.0 + side - 0.02)
                e.box("glass", "glass", gcol, min(a0, a1), max(a0, a1),
                      PROUD_DOOR, PROUD_DOOR + LEAF_T - GLASS_PROUD,
                      z0 + 0.10, head, gnight)

    # ── 3. TRANSOM. Arched families fill the arch head with a radial fanlight,
    #       drawn as narrowing chords because a true tracery is undrawable here.
    if fam["transom"]:
        if fam["arched"]:
            sp, rr = fam["spring_h"], fam["arch_rise"]
            for i in range(ARCH_TIERS):
                t0, t1 = i / float(ARCH_TIERS), (i + 1) / float(ARCH_TIERS)
                w = half * math.sqrt(max(0.0, 1.0 - ((t0 + t1) / 2) ** 2))
                e.box("transom", "glass", gcol, -w, w,
                      PROUD_DOOR, PROUD_DOOR + LEAF_T,
                      sp + rr * t0, sp + rr * t1, gnight)
        else:
            th = min(fam["transom_h"], max(0.0, (b.h or 99.0) - head - 0.4))
            e.box("transom", "glass", gcol, -half + 0.05, half - 0.05,
                  PROUD_DOOR, PROUD_DOOR + LEAF_T,
                  head + TRANSOM_GAP, head + TRANSOM_GAP + th, gnight)

    # ── 4. SURROUND. Family sets geometry, HOST sets material: the portal
    #       surround is limestone on every UT building in families A and B,
    #       INCLUDING the brick ones. That is why this never restates the wall
    #       colour — it only adds a surround that is supposed to differ from it.
    sw, sp_ = fam["surround_w"], fam["surround_proj"]
    sur_col = (cel or {}).get("sur_col") or fam["sur_col"]
    sur_mat = fam["sur_mat"]
    top = rev_top
    if sw > 0.01:
        if fam["arched"]:
            spr, rr = fam["spring_h"], fam["arch_rise"]
            for sgn in (-1, 1):
                e.box("surround", sur_mat, sur_col,
                      sgn * half, sgn * (half + sw), 0.0, sp_, GROUND_Z, spr)
            for i in range(ARCH_TIERS):
                t0, t1 = i / float(ARCH_TIERS), (i + 1) / float(ARCH_TIERS)
                w = half * math.sqrt(max(0.0, 1.0 - ((t0 + t1) / 2) ** 2))
                for sgn in (-1, 1):
                    e.box("surround", sur_mat, sur_col, sgn * w, sgn * (w + sw),
                          0.0, sp_, spr + rr * t0, spr + rr * t1)
            top = spr + rr
        else:
            for sgn in (-1, 1):
                e.box("surround", sur_mat, sur_col, sgn * half,
                      sgn * (half + sw), 0.0, sp_, GROUND_Z, top + sw)
            e.box("surround", sur_mat, sur_col, -(half + sw), half + sw,
                  0.0, sp_, top, top + sw)
            top = top + sw
        if fam["cornice"] > 0.01:
            e.box("surround", sur_mat, sur_col, -(half + sw + 0.25),
                  half + sw + 0.25, 0.0, sp_ + 0.30, top, top + fam["cornice"])
            top += fam["cornice"]
    if fam["accent"] and fam["accent_h"] > 0.01:
        if fam["arched"]:
            # ON AN ARCH THERE IS NOTHING TO PUT A BAND ON. `top` is the
            # CROWN, a single point, and a full-width plank laid across it is
            # supported only where the arch happens to reach — which is how
            # Battle Hall ended up with a terracotta plank floating over its
            # portal with a gap under one end. What is actually there is
            # "terracotta concentrated at door and window surrounds" [S], i.e.
            # the SPANDRELS: the two corners between the arch and the square
            # the arch is set into. Fill those instead. They stand on the
            # springing, they can never float, and they are the same citation.
            spr, rr = fam["spring_h"], fam["arch_rise"]
            for i in range(ARCH_TIERS):
                t0, t1 = i / float(ARCH_TIERS), (i + 1) / float(ARCH_TIERS)
                w = half * math.sqrt(max(0.0, 1.0 - ((t0 + t1) / 2) ** 2))
                for sgn in (-1, 1):
                    e.box("surround", "terracotta", fam["accent"],
                          sgn * (w + sw), sgn * (half + sw), 0.0, sp_ + 0.04,
                          spr + rr * t0, spr + rr * t1)
            # ... and the keystone, which is the other half of the citation and
            # is the one place on an arch where a block genuinely sits.
            e.box("surround", "terracotta", fam["accent"],
                  -KEYSTONE_W / 2, KEYSTONE_W / 2, 0.0, sp_ + 0.06,
                  spr + rr - fam["accent_h"], spr + rr + fam["accent_h"] * 0.5)
            stats["arch_spandrels"] += 1
        else:
            e.box("surround", "terracotta", fam["accent"],
                  -(half + sw), half + sw,
                  0.0, sp_ + 0.04, top, top + fam["accent_h"])
            top += fam["accent_h"]

    # ── 5. SIGN. The schema carries no text, so this is the BAND; the words are
    #       in INSCRIPTIONS above, cited, and nothing uncited is carved.
    # ON THE MAIN PORTAL ONLY. The first cut dropped the role test and carved
    # the Main Building's inscription band across all TEN of its entrances,
    # including the two service doors into the courtyards.
    if cel and cel.get("sign") and role == "main":
        e.box("sign", "limestone", mix(sur_col, "#ffffff", 0.10),
              -(half + sw), half + sw, 0.0, max(sp_, 0.06) + 0.02,
              top, top + SIGN_H)
        top += SIGN_H
        stats["sign_bands"] += 1

    # ── 6. PILASTERS. Cret's south front is pilasters with Ionic capitals, NOT
    #       a free-standing colonnade [C]. Two, flanking the portal.
    if cel and cel.get("columns") and role == "main":
        for sgn in (-1, 1):
            u = sgn * (half + sw + COLUMN_W / 2 + 0.20)
            e.box("column", sur_mat, sur_col, u - COLUMN_W / 2,
                  u + COLUMN_W / 2, 0.0, COLUMN_D, GROUND_Z, top)

    # ── 7. LANTERNS. Battle Hall's are from Gilbert's own specification, which
    #       allowed $800 for them [C]; Sutton has the same motif [C]. They are
    #       the single most recognisable thing about those two portals, so they
    #       are drawn — and they carry a warm night colour so they read as lit.
    if cel and cel.get("lanterns") and role == "main":
        for sgn in (-1, 1):
            u = sgn * (half + sw + 0.30)
            # The lozenge is bracketed back to the wall, or it is a dark
            # lump hanging in mid-air a door-width off the portal.
            e.box("sign", "steel", IRON, u - 0.05, u + 0.05, 0.0, 0.18,
                  2.86, 3.00)
            e.box("sign", "steel", IRON, u - 0.14, u + 0.14, 0.10, 0.42,
                  2.20, 3.05, LAMP_NIGHT)

    # ── 8. FLIGHT. bake_depth.py's vocabulary, reused, not reinvented: one
    #       course = a dark slab with a light slab set back on top. From above
    #       you read the nosing, obliquely the riser, at tour altitude a thin
    #       dark line. The slabs NEST — each spans from its own leading edge to
    #       the top of the run — which removes the hairline-gap failure mode
    #       rather than padding it.
    flight_w = bank_w + 2 * FLIGHT_SIDE
    run = risers * tread
    step_light = mix(sur_col, LIMESTONE, 0.25)
    step_dark = scale(step_light, STEP_DARK_MIX)
    nos = min(STEP_NOSING, tread * STEP_NOSING_FRAC)
    for j in range(1, risers + 1):
        vlead = (risers - j + 1) * tread
        ztop = GROUND_Z + j * riser
        e.box("step", "limestone", step_dark, -flight_w / 2, flight_w / 2,
              0.0, vlead, 0.0, ztop)
        if nos > 0.02 and vlead - nos > 0.05:
            e.box("step", "limestone", step_light, -flight_w / 2, flight_w / 2,
                  0.0, vlead - nos, 0.0, ztop + STEP_LIFT)

    # ── 9. RAIL or CHEEK. A 38 mm tube is sub-pixel at cruise altitude, so the
    #       rail is DRAWN at RAIL_D 0.10 m — a deliberate, parameterised
    #       over-scale, exactly as bake_places.py over-scales a sign band. Do
    #       not "fix" it back to 0.038. Historic monumental limestone flights on
    #       this campus have solid CHEEKS, not tube rails.
    want_cheek = fam["cheek"] if not cel else cel.get("cheek", fam["cheek"])
    want_rail = fam["rail"] if not cel else cel.get("rail", fam["rail"])
    if risers >= RAIL_MIN_RISERS and (want_cheek or want_rail or c.handrail):
        for si in range(RAIL_SEGS):
            v0 = run * si / RAIL_SEGS
            v1 = run * (si + 1) / RAIL_SEGS
            j = max(1, min(risers, int(round((run - (v0 + v1) / 2) / tread)) + 1))
            ztop = GROUND_Z + j * riser
            for sgn in (-1, 1):
                if want_cheek:
                    u = sgn * (flight_w / 2 - CHEEK_W / 2)
                    e.box("rail", "limestone", step_light, u - CHEEK_W / 2,
                          u + CHEEK_W / 2, v0, v1, 0.0, ztop + CHEEK_H)
                else:
                    u = sgn * (flight_w / 2 - RAIL_D / 2)
                    e.box("rail", "steel", STEEL, u - RAIL_D / 2,
                          u + RAIL_D / 2, v0, v1, ztop + RAIL_H - RAIL_D,
                          ztop + RAIL_H)
                    vm = (v0 + v1) / 2.0
                    e.box("rail", "steel", STEEL,
                          u - RAIL_POST_D / 2, u + RAIL_POST_D / 2,
                          vm - RAIL_POST_D / 2, vm + RAIL_POST_D / 2,
                          0.0, ztop + RAIL_H - RAIL_D)

    # ── 10. RAMP.
    if risers >= RAMP_MIN_RISERS and (role == "main" or c.wheel == "yes"):
        rlen = rise / RAMP_SLOPE
        u0 = flight_w / 2 + 0.20
        for si in range(RAMP_SEGS):
            v0 = rlen * si / RAMP_SEGS
            v1 = rlen * (si + 1) / RAMP_SEGS
            z = GROUND_Z + rise * (1.0 - (v0 + v1) / (2 * rlen))
            e.box("ramp", "concrete", CONCRETE, u0, u0 + RAMP_W, v0, v1, 0.0, z)
        stats["ramps"] += 1

    # ── 11. CANOPY. At 70 degrees of pitch a vertical surface is foreshortened
    #        to a third of its height and a horizontal one is seen at nearly
    #        full size, so a canopy's TOP FACE is the loudest surface an
    #        entrance has. Family D's 0.18 m against family C's 0.25 IS the read.
    can = fam["canopy"]
    if can:
        side = CANOPY_SIDE_D if fam_key == "D" else CANOPY_SIDE
        ct = can["top"]
        if b.h and ct + 0.2 > b.h:
            ct = max(head + 0.4, b.h - 0.4)
        e.box("canopy", can["mat"], can["col"], -(half + side), half + side,
              0.0, can["proj"], ct - can["t"], ct)
        e.box("canopy", can["mat"], SOFFIT_DK, -(half + side), half + side,
              0.0, can["proj"], ct - can["t"] - 0.06, ct - can["t"])
    return e


# ══════════════════════════════════════════════════════════════════════
#  STEPS EVIDENCE — which entrances actually get a real flight, from data
#  rather than from taste. Of OSM's 189 highway=steps ways, 87 (46%) end
#  within 12 m of a derived door; 60 carry handrail=yes and 9 carry
#  step_count, values 3,3,4,4,5,7,12,21,21, median 5. So an entrance with a
#  steps way at its foot gets a real flight sized by step_count where
#  present and by DEFAULT_RISERS where not, and a rail if that way says so.
#  46% of entrances having a flight is a plausible campus, not a guess.
# ══════════════════════════════════════════════════════════════════════
def steps_evidence():
    out = []
    for w in _ways(FOOTWAYS):
        t = w.get("tags", {})
        if t.get("highway") != "steps":
            continue
        g = w.get("geometry") or []
        if len(g) < 2:
            continue
        try:
            sc = int(str(t.get("step_count", "")).strip())
        except (TypeError, ValueError):
            sc = None
        hr = t.get("handrail") == "yes"
        for p in (g[0], g[-1]):
            x, y = to_m(p["lon"], p["lat"])
            out.append((x, y, sc, hr))
    return out


def attach_steps(blds, steps):
    grid = defaultdict(list)
    for x, y, sc, hr in steps:
        grid[(int(x // STEPS_R), int(y // STEPS_R))].append((x, y, sc, hr))
    hit = 0
    for b in blds:
        for c in b.ents:
            best, bd = None, STEPS_R
            for cx in range(int((c.x - STEPS_R) // STEPS_R),
                            int((c.x + STEPS_R) // STEPS_R) + 1):
                for cy in range(int((c.y - STEPS_R) // STEPS_R),
                                int((c.y + STEPS_R) // STEPS_R) + 1):
                    for x, y, sc, hr in grid.get((cx, cy), ()):
                        d = math.hypot(x - c.x, y - c.y)
                        if d < bd:
                            best, bd = (sc, hr), d
            if best:
                c.risers = best[0] or DEFAULT_RISERS
                c.handrail = best[1]
                hit += 1
    return hit


def assign_roles(b):
    """OSM roles are kept verbatim. Otherwise the best-scoring entrance on a
    building that has no main yet becomes the main and everything else is
    secondary. `emergency` and `exit` only ever come from OSM — inventing an
    emergency exit would be inventing a fact."""
    has_main = any(c.role == "main" for c in b.ents)
    rest = [c for c in b.ents if c.role is None]
    rest.sort(key=lambda c: (c.prio, -c.score))
    for i, c in enumerate(rest):
        if i == 0 and not has_main:
            c.role = "main"
            has_main = True
        else:
            c.role = "secondary"
    if not has_main and b.ents:
        # Waggener carries FIVE OSM nodes and every one of them is tagged
        # `entrance=yes`, so the building came out with no main at all. `yes`
        # does not mean "not the main door", it means the mapper did not say;
        # promoting the best-placed secondary is the honest reading, and
        # `src` still records that the POSITION came from OSM.
        cands = [c for c in b.ents if c.role in ("secondary", None)]
        if cands:
            max(cands, key=lambda c: -c.prio * 100 + c.score).role = "main"
    if b.fam == "E3":
        # A garage's ramp is a vehicle entrance, not a door. One service opening
        # plus one stair-tower door; never a family-scale pedestrian portal.
        for i, c in enumerate(sorted(b.ents, key=lambda c: -c.score)):
            c.role = "service" if i == 0 else "secondary"


# ══════════════════════════════════════════════════════════════════════
#  VALIDATION — re-run every bake. A number that silently regresses is
#  the failure mode this repo keeps hitting.
# ══════════════════════════════════════════════════════════════════════
def median(xs):
    if not xs:
        return float("nan")
    s = sorted(xs)
    n = len(s)
    return s[n // 2] if n % 2 else 0.5 * (s[n // 2 - 1] + s[n // 2])


def validate_recall(blds):
    """Recall of the OSM entrance nodes by the DERIVATION ALONE — stage 1's own
    nodes are excluded from the answer set, or the number would be 100% and
    would measure nothing.

    THE BUG THIS GUARDS AGAINST, because it already happened once: the first
    recall run reported 20% and it was a `nearest(...) or 1e9` treating an exact
    hit — distance 0.0, which is FALSY in Python — as "no candidate". The
    by-role breakdown printed 80% in the same run and the disagreement is what
    caught it. Two independent statistics over the same data are worth the eight
    lines they cost, so both are printed."""
    derived = DERIVED_ALL
    if not derived:
        return None
    hits, errs, by_role = Counter(), [], defaultdict(lambda: [0, 0])
    tot = reach = 0
    rhits = Counter()
    for lon, lat, ev, door, wheel in OSM_ENTRANCES:
        if not in_rect(lat, lon, CAMPUS):
            continue
        x, y = to_m(lon, lat)
        # THE SECOND DENOMINATOR, and it is not a flattering trick: stage 2 only
        # ever runs on in-scope buildings, so a node on a shed, a canopy or a
        # Drag frontage cannot be recovered by construction. Both numbers are
        # printed; the first is the honest headline and the second is the
        # ceiling the method could reach.
        on_scope = any(b.poly.exterior.distance(Point(x, y)) < OSM_MAX_SNAP
                       for b in blds)
        best = None
        for dx, dy in derived:
            d = math.hypot(dx - x, dy - y)
            if best is None or d < best:
                best = d
        tot += 1
        errs.append(best)
        by_role[ev][1] += 1
        if best <= 8.0:
            by_role[ev][0] += 1
        if on_scope:
            reach += 1
        for th in (3.0, 5.0, 8.0, 12.0):
            if best <= th:
                hits[th] += 1
                if on_scope:
                    rhits[th] += 1
    return tot, hits, errs, by_role, reach, rhits


def main():
    if "--refresh" in sys.argv:
        refresh()
        return
    src_e, src_b = load_osm()
    stats = Counter()
    print("== bake_entrances ==")
    print("osm entrance nodes : %d  (%s)" % (len(OSM_ENTRANCES), src_e))
    print("osm ref/name ways  : %d  (%s)" % (len(OSM_BUILDING_TAGS), src_b))

    blds = load_buildings()
    tree = STRtree([b.poly for b in blds])
    refs = join_refs(blds, tree)
    print("footprints         : %d   joined a ref: %d" % (len(blds), refs))

    # E1 — the Drag frontages already belong to bake_places.py / js/drag.js and
    # a second entrance on top is a double-draw. ONLY the retail hosts are
    # excluded: a coffee POI inside a dining hall must not disqualify the dining
    # hall's own doors.
    place_hosts = set()
    if os.path.exists(PLACES):
        pj = json.load(open(PLACES, encoding="utf-8"))
        for f in pj["features"]:
            bid = f["properties"].get("bid")
            if bid:
                place_hosts.add(bid)

    # ── WEST CAMPUS IS OUTSIDE THE CAMPUS RECT AND ALWAYS WAS. Measured:
    #    only 3 of the 24 named footprints fall inside CAMPUS (Cambridge
    #    Tower, Dobie Twenty21, The G) and the other 21 were never in scope,
    #    which is why entrances skipped the neighbourhood. It is not a
    #    placement failure, it is a bbox. The 24 join by exact `name`, the
    #    same key bake_westcampus.py uses, and the join is asserted here so a
    #    renamed footprint is a loud failure rather than a missing lobby.
    wc_hit = 0
    for b in blds:
        if b.name in WC_LOBBIES:
            b.wc = WC_LOBBIES[b.name]
            wc_hit += 1
    print("west campus        : %d of %d named footprints joined"
          % (wc_hit, len(WC_LOBBIES)))
    assert wc_hit == len(WC_LOBBIES), (
        "West Campus names that did not join the snapshot: %s"
        % sorted(set(WC_LOBBIES) - set(b.name for b in blds if b.wc)))

    scope = []
    for b in blds:
        lon, lat = to_ll(b.cx, b.cy)
        b.budget = -1
        if not b.wc and not in_rect(lat, lon, CAMPUS):
            continue
        if b.area < MIN_AREA or (b.h or 0) < MIN_H or b.cls in SKIP_CLASSES:
            continue
        # E1 keeps its veto everywhere EXCEPT the 24. Dobie Twenty21 is the
        # case: its `building_class` is null and places.geojson genuinely owns
        # 108 m of its Guadalupe frontage, so E1 fired correctly and it got
        # zero doors — but its RESIDENTIAL lobby is on Whitis, 60 m away on the
        # other elevation. The claim test in wc_place() is what keeps this pass
        # off the Target, not the whole-building veto.
        if b.bid in place_hosts and b.cls in PLACES_EXCLUDE_CLASSES and not b.wc:
            stats["e1_places_excluded"] += 1
            continue
        b.fam = classify(b)
        b.budget = budget_for(b)
        scope.append(b)
    print("in scope           : %d buildings  (E1 excluded %d)"
          % (len(scope), stats["e1_places_excluded"]))
    print("families           : %s" % dict(Counter(b.fam for b in scope)))

    n1 = stage1_osm(blds, tree, stats)
    print("stage 1 osm        : %d placed  (unplaceable %d, off-campus %d,"
          " host out of scope %d, normal test %d)"
          % (n1, stats["osm_unplaceable"], stats["osm_off_campus"],
             stats["osm_host_out_of_scope"], stats["normal_fail_osm"]))

    na = stage1b_authored(blds, tree, stats)
    print("stage 1b authored  : %d placed  (already an OSM node %d, no host %d,"
          " normal test %d)" % (na, stats["authored_already_osm"],
                                stats["authored_no_host"],
                                stats["normal_fail_authored"]))

    paths, segs = load_network()
    print("network            : %d walkable ways, %d weighted segments"
          % (len(paths), len(segs)))

    s2 = stage2_paths(blds, tree, paths, stats)

    # ── WEST CAMPUS, between stage 2 and the clustering, so a lobby wins
    #    against any derived candidate that lands on top of it.
    claims = load_place_claims()
    wc_rows = wc_place(scope, s2, claims, stats)
    print("west campus lobbies: %d placed  (footpath %d, address point %d,"
          " elevation midpoint %d; unplaced %d)"
          % (stats["wc_lobby_path"] + stats["wc_lobby_spec"]
             + stats["wc_lobby_default"], stats["wc_lobby_path"],
             stats["wc_lobby_spec"], stats["wc_lobby_default"],
             stats["wc_unplaced"] + stats["wc_claim_blocked"]))
    print("                     shopfront runs: %d slid clear, %d narrowed,"
          " %d blocked outright; %d footpath candidates sat on a wall too"
          " short to carry a storefront"
          % (stats["wc_claim_moved"], stats["wc_claim_narrowed"],
             stats["wc_claim_blocked"], stats["wc_path_run_too_short"]))

    n2 = 0
    for b in scope:
        got = s2.get(b.bid) or []
        keep = cluster(list(b.ents) + got, CLUSTER_R)
        # truth is never deleted to satisfy a budget: OSM first, then path.
        new = [c for c in keep if c not in b.ents]
        b.ents.extend(new)
        n2 += len(new)
    print("stage 2 paths      : %d raw, %d past the gate, %d after clustering"
          "  (normal test %d, approach gate %d)"
          % (stats["stage2_raw"], stats["stage2_gated"], n2,
             stats["normal_fail_stage2"], stats["approach_gate_reject"]))

    grid = Grid(segs, 25.0)
    stage3_public(scope, grid, stats)
    print("stage 3 publicness : %d placed  (normal test %d)"
          % (stats["stage3_placed"], stats["normal_fail_stage3"]))

    # AFTER stage 3, so a garage gate never spends a building's pedestrian
    # budget — the gate is extra evidence, not a door taken off the front.
    wc_gates(scope, claims, stats)
    print("west campus gates  : %d sourced street, %d side-street rule,"
          " %d no side street, %d no wall with room  (18 of the 24 have no"
          " garage evidence at all and get nothing)"
          % (stats["wc_gate_sourced"], stats["wc_gate_sidestreet"],
             stats["wc_gate_no_side_street"], stats["wc_gate_no_room"]))

    ev = steps_evidence()
    hit = attach_steps(scope, ev)
    tot_ents = sum(len(b.ents) for b in scope)
    # TWO statistics over the same data, because they answer different
    # questions and because a disagreement between two is what caught the one
    # real bug in this pass's validation. placement.md measured the second one
    # (87 of 189 steps ways, 46%); the first is what the bake actually acts on.
    near = 0
    ends = set()
    for x, y, sc, hr in ev:
        for b in scope:
            if any(math.hypot(x - c.x, y - c.y) <= STEPS_R for c in b.ents):
                near += 1
                break
    print("steps evidence     : %d of %d entrances have an OSM steps way within"
          " %.0f m (%.0f%%);" % (hit, tot_ents, STEPS_R,
                                 100.0 * hit / max(1, tot_ents)))
    print("                     %d of %d steps-way ends land within %.0f m of a"
          " placed door (%.0f%%)"
          % (near, len(ev), STEPS_R, 100.0 * near / max(1, len(ev))))

    for b in scope:
        assign_roles(b)

    feats = []
    eid = 0
    for b in sorted(scope, key=lambda b: b.bid):
        for c in sorted(b.ents, key=lambda c: (-c.score, c.x, c.y)):
            eid += 1
            assemble(feats, b, c, eid, stats)

    # ── SANITY, and the numbers go in the commit message ───────────────
    print("")
    print("entrances          : %d on %d buildings"
          % (tot_ents, sum(1 for b in scope if b.ents)))
    print("  by src           : %s"
          % dict(Counter(c.src for b in scope for c in b.ents)))
    print("  by role          : %s"
          % dict(Counter(c.role for b in scope for c in b.ents)))
    print("  by era           : %s"
          % dict(Counter(FAMILIES[b.fam]["era"] for b in scope
                         for c in b.ents)))
    print("  by dt            : %s"
          % dict(Counter(f["properties"]["dt"] for f in feats
                         if f["properties"]["k"] == "door")))
    counts = [len(b.ents) for b in scope if b.ents]
    print("  per building     : min %d  median %.0f  mean %.2f  p90 %d  max %d"
          % (min(counts), median(counts), sum(counts) / float(len(counts)),
             sorted(counts)[int(0.9 * len(counts))], max(counts)))
    top = sorted(scope, key=lambda b: -len(b.ents))[:8]
    for b in top:
        print("      %-3s %-46s perim %5.0f m  budget %d  placed %d"
              % (b.ref or "-", (b.name or b.osm_name or "(unnamed)")[:46],
                 b.perim, b.budget, len(b.ents)))
    nod = [b for b in scope if not b.ents]
    print("  no entrance      : %d buildings" % len(nod))
    for b in nod[:6]:
        print("      %-46s %5.0f m2  %.1f m"
              % ((b.name or b.osm_name or "(unnamed)")[:46], b.area, b.h))

    # ── THE CELEBRATED SET, checked by name every run. "Some of these are
    #    celebrated entrances" is the bar for this pass, so a celebrated
    #    building that quietly got zero doors — or got them without a main — is
    #    a failure the summary has to say out loud rather than average away.
    print("")
    print("CELEBRATED PORTALS  (tier - ref - entrances - src mix - main?)")
    byref = {}
    for b in scope:
        if b.ref:
            byref.setdefault(b.ref, b)
    for ref in sorted(CELEBRATED, key=lambda r: (CELEBRATED[r]["tier"], r)):
        cel = CELEBRATED[ref]
        b = byref.get(ref)
        if b is None:
            print("    T%d %-4s  *** NOT IN SCOPE - no footprint matched "
                  "this ref ***" % (cel["tier"], ref))
            stats["celebrated_missing"] += 1
            continue
        mix_ = dict(Counter(c.src for c in b.ents))
        has_main = any(c.role == "main" for c in b.ents)
        print("    T%d %-4s %-40s fam %-2s  %d  %-34s %s"
              % (cel["tier"], ref, (b.name or b.osm_name or "")[:40],
                 b.fam, len(b.ents), str(mix_), "main" if has_main else
                 "*** NO MAIN ***"))
        if not b.ents or not has_main:
            stats["celebrated_defect"] += 1

    # ── WEST CAMPUS, checked by name every run for the same reason the
    #    celebrated set is: a building that quietly got no lobby has to be said
    #    out loud rather than averaged into a total.
    wcb = [b for b in scope if b.wc]
    print("")
    print("WEST CAMPUS LOBBIES  (building - address wall - method - bays -"
          " gate - pieces)")
    wcp = Counter()
    for b in sorted(wcb, key=lambda b: b.name):
        lob = [c for c in b.ents if c.wcrole == "lobby"]
        gat = [c for c in b.ents if c.wcrole == "gate"]
        npieces = sum(1 for f in feats if f["properties"]["bid"] == b.bid)
        print("    %-28s %-2s  %-9s %-2s  %-10s %3d %s"
              % (b.name[:28], b.wc["side"],
                 (lob[0].wcmeth if lob else "-"),
                 str(WC_AUDIT.get(b.bid, "-")),
                 (gat[0].wcmeth if gat else "none"), npieces,
                 "" if lob else "*** NO LOBBY ***"))
        wcp[lob[0].wcmeth if lob else "none"] += 1
        if not lob:
            stats["wc_defect"] += 1
    wl = [len(b.ents) for b in wcb]
    print("    lobbies placed   : %d of %d expected   %s"
          % (sum(1 for b in wcb for c in b.ents if c.wcrole == "lobby"),
             len(WC_LOBBIES), dict(wcp)))
    print("    gates            : %d sourced street, %d side-street rule,"
          " %d buildings with no garage evidence"
          % (stats["wc_gate_sourced"], stats["wc_gate_sidestreet"],
             len(WC_LOBBIES) - sum(1 for s_ in WC_LOBBIES.values()
                                   if s_.get("gate"))))
    print("    bay mix          : %s   (the spec predicted 3 six / 14 eight /"
          " 7 ten from its own elevation lengths)"
          % {int(k[8:]): v0 for k, v0 in sorted(stats.items())
             if k.startswith("wc_bays_")})
    print("    two-storey runs  : %d of 24 (spec: 7)   head clamped %d"
          % (stats["wc_two_storey"], stats["wc_head_clamped"]))
    print("    name bands       : %d drawn, %d had no spandrel to sit in;"
          " secondary doors on W buildings fell back to E2: %d"
          % (stats["wc_name_bands"], stats["wc_name_no_room"],
             stats["wc_secondary_e2"]))
    print("    entrances/bldg   : min %d  median %.0f  max %d"
          % (min(wl), median(wl), max(wl)))
    wcg = Counter(f["properties"]["wd"] for f in feats
                  if f["properties"]["k"] in ("glass", "transom")
                  and f["properties"]["era"] == "highrise")
    print("    glass values     : %d pieces, %d distinct  %s"
          % (sum(wcg.values()), len(wcg), dict(wcg.most_common(8))))
    wcn = Counter(f["properties"]["wn"] for f in feats
                  if f["properties"]["k"] in ("glass", "transom")
                  and f["properties"]["era"] == "highrise")
    print("    night values     : %s" % dict(wcn.most_common(6)))
    unver = sum(1 for f in feats if f["properties"].get("nmv") is False
                and f["properties"]["k"] == "sign")
    print("    name bands whose lettering is UNVERIFIED (nmv=false): %d"
          % unver)

    v = validate_recall(scope)
    if v:
        tot, hits, errs, by_role, reach, rhits = v
        print("")
        print("OSM RECOVERY by the DERIVATION alone (stage 1's own nodes are")
        print("excluded from the answer set or the number would be 100 pct):")
        print("    %d in-campus nodes, of which %d sit on an in-scope building"
              % (tot, reach))
        for th in (3.0, 5.0, 8.0, 12.0):
            print("    <= %4.0f m   %3d / %3d = %3.0f%%    of in-scope hosts:"
                  "  %3d / %3d = %3.0f%%"
                  % (th, hits[th], tot, 100.0 * hits[th] / max(1, tot),
                     rhits[th], reach, 100.0 * rhits[th] / max(1, reach)))
        print("    median position error %.2f m   p75 %.2f m"
              % (median(errs), sorted(errs)[int(0.75 * len(errs))]))
        print("    by role: %s" % ", ".join(
            "%s %d/%d" % (k, v0[0], v0[1]) for k, v0 in sorted(by_role.items())))
        print("    (precision is NOT reported: measured against a source whose")
        print("     median building carries ONE mapped entrance, it measures OSM)")

    bad = []
    for f in feats:
        p = f["properties"]
        for key in ("base", "h"):
            val = p[key]
            if val != val or val < -0.001 or val > 60.0:
                bad.append((p["k"], key, val, p["ref"]))
        for key in ("wd", "wg", "wn"):
            if not p.get(key) or len(p[key]) != 7:
                bad.append((p["k"], key, p.get(key), p["ref"]))
    print("")
    print("pieces             : %d   kinds %s"
          % (len(feats), dict(Counter(f["properties"]["k"] for f in feats))))
    print("  bad base/h/colour: %d %s" % (len(bad), bad[:5]))
    print("  ramps %d   sign bands %d   arch spandrel sets %d"
          % (stats["ramps"], stats["sign_bands"], stats["arch_spandrels"]))

    # ── NOTHING FLOATS. Two audits over the LOCAL frame, because the whole
    #    PCL defect is a support question and a support test in lon/lat is a
    #    test nobody can read. The first is the sill; the second is every
    #    other piece, which is what would have caught Battle's plank.
    print("")
    print("RAISED SILLS       : %d requested, %d kept on real deck evidence,"
          " %d dropped to ground"
          % (stats["plaza_requested"], stats["plaza_exception"],
             stats["plaza_refused"]))
    decks = load_decks()
    print("                     deck evidence: %d sampled points, tallest"
          " %.2f m, radius %.0f m, needs %.0f%% of the ask"
          % (len(decks), max([d[2] for d in decks] or [0.0]),
             PLAZA_EVIDENCE_R, 100 * PLAZA_EVIDENCE_FRAC))

    byeid = {}
    for row in LOCAL:
        byeid.setdefault(row[0], []).append(row)
    ref_of = {}
    for f in feats:
        ref_of.setdefault(f["properties"]["eid"],
                          (f["properties"]["ref"], f["properties"]["nm"]))
    float_sills, detached = [], []
    for e_id, rows in byeid.items():
        sills = [r[6] for r in rows if r[1] == "door"]
        if not sills:
            sills = [r[6] for r in rows if r[1] in ("glass", "transom")]
        support = max([r[7] for r in rows if r[1] in ("step", "ramp")]
                      + [GROUND_Z])
        if sills and min(sills) - support > FLOAT_TOL:
            float_sills.append((e_id, ref_of.get(e_id, ("-", ""))[0],
                                min(sills) - support))
        # Connectivity, not "is something directly underneath". A canopy is
        # cantilevered off the wall and a door light is glued to its leaf;
        # neither has anything below it and neither floats. So: seed with
        # every piece that touches the wall or stands on the ground, then
        # flood along touching faces. Whatever the flood cannot reach is
        # hanging in the air — which is what Battle Hall's terracotta plank
        # and the two unattached lanterns actually were.
        seed = [i for i, r in enumerate(rows)
                if r[4] <= WALL_TOUCH or r[6] <= GROUND_Z + FLOAT_TOL]
        seen = set(seed)
        stack = list(seed)
        while stack:
            i = stack.pop()
            a = rows[i]
            for j, q in enumerate(rows):
                if j in seen:
                    continue
                if (min(a[3], q[3]) - max(a[2], q[2]) > -TOUCH and
                        min(a[5], q[5]) - max(a[4], q[4]) > -TOUCH and
                        min(a[7], q[7]) - max(a[6], q[6]) > -TOUCH):
                    seen.add(j)
                    stack.append(j)
        for i, r in enumerate(rows):
            if i not in seen:
                detached.append((e_id, ref_of.get(e_id, ("-", ""))[0],
                                 r[1], r[6]))
    print("  floating sills   : %d of %d entrances  %s"
          % (len(float_sills), len(byeid),
             ["%s +%.2fm" % (r or "-", d) for _i, r, d in float_sills[:6]]))
    print("  detached pieces  : %d of %d  %s"
          % (len(detached), len(LOCAL),
             ["%s %s @%.2f" % (r or "-", k, z) for _i, r, k, z in detached[:6]]))

    # ── GLASS HISTOGRAM. Printed every run so the monotone can never come
    #    back silently: it is the only defect of the five that a total hides.
    ghist = Counter(f["properties"]["wd"] for f in feats
                    if f["properties"]["k"] in ("glass", "transom"))
    gtot = sum(ghist.values())
    print("")
    print("GLASS BY DAY VALUE : %d pieces, %d distinct, top share %.0f%%"
          % (gtot, len(ghist), 100.0 * ghist.most_common(1)[0][1] / max(1, gtot)))
    for hexv, n in ghist.most_common(12):
        print("    %s  %5d  %4.1f%%" % (hexv, n, 100.0 * n / max(1, gtot)))
    nhist = Counter(f["properties"]["wn"] for f in feats
                    if f["properties"]["k"] in ("glass", "transom"))
    print("  by night value   : %s" % dict(nhist.most_common(8)))

    # ── THE CAPITOL PALE BAND, ASSERTED. A night colour whose channels are
    #    within a few points of each other AND whose luma is mid-range is the
    #    signature of a value nobody ever set. Glazing gets the stricter test:
    #    lit or dark, never the grey in between.
    pale, mid_glass = [], []
    for f in feats:
        p = f["properties"]
        wn = p["wn"]
        if spread_of(wn) <= NIGHT_SPREAD_MAX and luma_of(wn) >= NIGHT_NEUTRAL_LUMA:
            pale.append((p["k"], wn, round(luma_of(wn))))
        if p["k"] in ("glass", "transom"):
            L = luma_of(wn)
            if GLASS_DARK_LUMA_MAX < L < GLASS_LIT_LUMA_MIN:
                mid_glass.append((p["ref"], wn, round(L)))
    print("  pale-neutral wn  : %d  (spread <= %d and luma >= %d)  %s"
          % (len(pale), NIGHT_SPREAD_MAX, NIGHT_NEUTRAL_LUMA,
             list(dict.fromkeys(pale))[:4]))
    print("  glazing neither lit nor dark : %d  (luma outside <=%d or >=%d) %s"
          % (len(mid_glass), GLASS_DARK_LUMA_MAX, GLASS_LIT_LUMA_MIN,
             list(dict.fromkeys(mid_glass))[:4]))
    assert not pale, "pale-neutral night colour: %s" % pale[:5]
    assert not mid_glass, "glazing neither lit nor dark: %s" % mid_glass[:5]
    assert not float_sills, "floating sills: %s" % float_sills[:5]

    out = {"type": "FeatureCollection", "features": feats,
           # PROUD GEOMETRY ONLY. This pass claims no building ids, on purpose
           # and permanently, so it can never collide with facades/drag/heroes/
           # westcampus/capitol in either order.
           "replacedBuildingIds": []}
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, separators=(",", ":"))
    mb = os.path.getsize(OUT) / 1048576.0
    print("  wrote %s  %.2f MB" % (os.path.relpath(OUT, ROOT), mb))
    if mb > 8.0:
        print("  NOTE: this is large enough that it may want tiling later.")


if __name__ == "__main__":
    main()
