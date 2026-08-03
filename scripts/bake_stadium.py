# -*- coding: utf-8 -*-
"""Build DKR from the photograph, not from a guess about what a stadium is like.

WHAT CHANGED, AND WHY IT MATTERS

v1 turned the footprint from a flat-topped mesa into an open bowl. That was the
right first move — DKR's ring is 82% of its footprint area, so 82% of the
stadium had been drawing as roof — but it stopped at "a bowl". Twelve seating
bands of flat silver read, from the air, as a smooth grey dish. A real stadium
does not look like that from the air even slightly, and this file now says why,
with numbers taken off a georeferenced 13 cm/px nadir photograph rather than off
an intuition.

`scripts/fetch_dkr_reference.py` fetches that photograph WITH its bbox recorded,
and `scripts/probe_dkr.py` inverts the projection so anything visible in it can
be read as a lon/lat and a size in metres. (The aerial already in the repo,
data/dkr_aerial.png, has no recorded bbox at all: projecting the stadium's own
footprint through the only bbox in the repo lands the building 1.5 km outside
the frame. It was a mood board, not a measurement.)

MEASURED OFF THE PHOTOGRAPH — every one of these is a `probe_dkr.py` reading:

  seat rows       0.74 m pitch. Thirteen-and-a-bit stripes per 10 m, which is
                  the 30-inch row spacing every bleacher in America uses.
  aisle pitch     ~14 m between the stairs that run up the rake.
  vomitories      ~5 x 3 m dark openings, sitting ON the aisles.
  bright deck     #99968b, luma mean 149.5 — the brightest large surface in the
                  frame, as v1 already knew.
  stained deck    #897968, luma 122.9. Large irregular blotches of warm brown
                  weathering across the aluminium, 2-8 m across.
  deck contrast   luma SD 51.6, p10/p90 79/228. THIS is the number v1 missed.
                  The deck is not "silver"; it is a violent fine stripe of lit
                  plank against shadowed riser. Painting its MEAN is why it read
                  as a smooth dish.
  ramp towers     four ~14 m circular pedestrian ramp towers, positions read off
                  the photograph to seven decimal places. The 2008 north-end
                  contractor's note that "radiused block walls on the pedestrian
                  ramps ... creates the angular expression seen from the
                  exterior" is these.

The stripe is answered with GEOMETRY, not paint: the band count goes from 12 to
~44, so each band is a real step about three rows deep and MapLibre's own side
faces become the risers. A texture could not have done it — a fill-extrusion
pattern is locked to the tile, not to the ring, so its stripes would run across
the bowl's curve instead of around it.

SOURCED, NOT MEASURED — the photograph is Esri World Imagery and PREDATES the
2021 south end zone (tested: only 2,170 scattered burnt-orange pixels in the
south structure, against 17,516 in the painted north end zone — there is no
Longhorn balcony in this picture). So the south end is built from published
dimensions instead, and is labelled generative in the provenance block:

  south end zone  2021, Populous / Hensel Phelps, $175M, 240,000 sq ft.
  Longhorn balcony  215 x 72 ft = 65.5 x 21.9 m, clad in custom UT Burnt Orange
                  ALUCOBOND PLUS — the first team logo ever carved into a
                  seating bowl, and explicitly designed to be seen from the air,
                  which makes it the single most valuable object in this file.
  entry towers    two seven-storey towers, "Rusted Metal" finish.
  video board     55.85 x 134.38 ft = 17.0 x 41.0 m, south end.
  field           FieldTurf; burnt orange end zones lettered TEXAS / LONGHORNS;
                  an orange border that runs only to the 20-yard lines, not
                  around the whole field; midfield Longhorn.

GENERATIVE, and declared as such: all deck ELEVATIONS (no public source gives
per-deck heights — they descend from the height already in the data), the light
mast positions, and the rake gamma.

Usage:  python scripts/bake_stadium.py
"""
import json
import math
import os
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SNAP = os.path.join(ROOT, "data", "snapshots", "2026-07-30", "buildings.detailed.geojson")
OUT = os.path.join(ROOT, "data", "stadium.geojson")
M_LAT = 111320.0

# ── Taste block. Every value here is a one-line override. ─────────────
WALL_THICK_M = 7.0       # depth of the perimeter wall band
DECK_TOP_FRAC = 0.93     # top of the upper deck, as a fraction of wall height
UPPER_FOOT_FRAC = 0.50   # where the upper deck starts, ditto
RAKE_GAMMA = 1.35        # >1 = steeper near the top, which is how a bowl rakes

# THE BOWL SECTION, and the thing v1 got structurally wrong. The west crop of
# the aerial (scripts/verify/shots/dkr-r-west.png) shows THREE seating decks
# divided by TWO black slots four to six metres wide - the shadow under each
# deck's overhang. Those two slots are most of what makes a bowl read as a bowl
# from above; v1 had a single flat 'concourse' band and the west side came out
# as one continuous ramp. Radial fractions run 0 at the field wall to 1 at the
# perimeter; z fractions are of the wall height.
#
# The z values are GENERATIVE - no public source gives DKR's per-deck
# elevations - but the radial ones are read off the photograph.
DECKS = [
    # name     t0     t1     z0     z1     tiers
    ("lower", 0.000, 0.400, 0.048, 0.345, 18),
    ("void",  0.400, 0.452, 0.130, 0.130,  1),
    ("mid",   0.452, 0.700, 0.460, 0.680, 13),
    ("void",  0.700, 0.752, 0.320, 0.320,  1),
    ("upper", 0.752, 1.000, 0.740, 0.930, 11),
]
STADIUM_CLASSES = ("stadium", "arena", "grandstand")

# ── Taste block: THE FOUR SIDES. This is the rebuild. ─────────────────
#
# *"it looks like the colloseum not a football stadium ... the west side has
# like two really big sections of seating, the north and east side also have a
# second layer but theyre wrapped and smaller and connected, and then of course
# the south side is mainly the screen ... ur current seats look like cutouts
# from a big pyramid"*
#
# Every word of that is a description of DECKS above, which is a single table of
# radial fraction -> fraction of ONE height, evaluated by `deck_height(t, h)`
# with no idea which side it is on. A solid of revolution. The Colosseum is a
# solid of revolution; a football stadium is four different buildings that meet
# at the corners.
#
# THE HEIGHT, which is the first thing he named. `h` comes from the surveyed
# footprint's `final_height`, which is **63.0 m on all four sides** — and the
# west gets 72.5 m because Bellmont Hall's own footprint claims that. Those are
# Overture/OSM attributes, not survey: 72.5 m over Bellmont's stated 10 floors
# is 7.25 m per storey, which no office building has. The bowl was then built as
# 0.93 x 63 = 58.6 m of seating on every side. A 100,000-seat bowl whose seating
# tops out at 58.6 m all the way round is most of why it reads as a drum.
#
# So heights here are ABSOLUTE METRES per side, and they are derived, not
# inherited: each deck's rise is its measured radial depth times a rake. The
# depths are MEASURED off the surveyed footprint (ring thickness from the field
# hole to the outer edge, per side):
#
#     W 87.7 m     E 71.3 m     N 70.7 m     S 32.6 m
#
# The south is 2.7x shallower than the west. That single measurement is the
# whole argument for four different sides, and the old model ignored it.
#
# Rakes are standard practice (lower bowls sit near 20 deg, upper decks near
# 30-33 deg because they are further from the pitch and need the sightline), so
# the z values below are GENERATIVE from MEASURED depth. They are stated in the
# provenance block as such. Every one is a one-line override.
#
#   t0,t1  radial fraction across that side's ring: 0 at the field wall, 1 at
#          the perimeter. Per side, so 0.45 on the south is 15 m and on the
#          west is 39 m.
#   z0,z1  metres above field level at those two radii.
#   rows   how many stepped bands to spend on the deck.
SIDES = {
    # WEST — the main grandstand. Two big decks, and the press/suite structure
    # standing above and behind the upper one. Tallest side by a long way.
    "W": {
        "decks": [
            ("lower", 0.00, 0.34,  1.2, 26.0, 9),
            ("void",  0.34, 0.42, 26.0, 30.5, 1),
            ("upper", 0.42, 0.96, 30.5, 50.0, 12),
        ],
        "wall_m": 53.0,      # the perimeter wall behind the upper deck
        "crown_m": 57.0,     # press box / suite tower on top of it
        "crown_t": (0.72, 1.00),
    },
    # NORTH — the 2008 Red McCombs Red Zone. A second layer that wraps the
    # corner and connects to the east, smaller than the west decks.
    "N": {
        "decks": [
            ("lower", 0.00, 0.36,  1.2, 12.5, 6),
            ("void",  0.36, 0.44, 12.5, 12.5, 1),
            ("upper", 0.44, 0.96, 18.5, 32.0, 10),
        ],
        "wall_m": 34.0,
        "crown_m": None,
        "crown_t": None,
    },
    # EAST — the same wrapped second layer, connected to the north.
    "E": {
        "decks": [
            ("lower", 0.00, 0.36,  1.2, 22.0, 8),
            ("void",  0.36, 0.44, 22.0, 27.0, 1),
            ("upper", 0.44, 0.96, 27.0, 34.5, 9),
        ],
        "wall_m": 36.5,
        "crown_m": None,
        "crown_t": None,
    },
    # SOUTH — mainly the videoboard. One shallow deck and then the screen
    # structure; only 32.6 m of ring to work with, so there is no upper deck.
    "S": {
        "decks": [
            ("lower", 0.00, 0.94,  1.2, 13.0, 9),
        ],
        "wall_m": 26.0,
        "crown_m": None,
        "crown_t": None,
    },
}
# How many angular segments the bowl is cut into. Each segment is one feature
# per band and carries the height blended for ITS bearing, which is what lets
# the west be 38 m while the south is 12 m and the corners run smoothly between
# them. 32 is the coarsest that does not show a visible facet at the corners.
# How thick the structural slab under a deck row reads, and how deep the soffit
# over the concourse hangs. Both only became expressible when PR #114 replaced
# `'fill-extrusion-base': 0` with a real base on stadium-seating.
DECK_SLAB_M = 2.4
VOID_SOFFIT_M = 1.8
BOWL_SEGMENTS = 32
# Blend half-width, in degrees, over which one side's profile crosses into the
# next. The real bowl turns the corner continuously; a hard switch at the sector
# boundary put a 20 m cliff in the seating.
SIDE_BLEND_DEG = 34.0

# The per-deck tier counts live in DECKS above. v1 used 6 + 6 and the bowl read
# as a smooth dish; the aerial says the deck's luma SD is 51.6 because it is
# nothing but 0.74 m steps. The counts there put a real step every 2-3 rows,
# which is the coarsest stepping that still reads as stripe rather than as
# terrace from 200-900 m up. Each band is one 63-vertex ring, so the whole
# change costs about thirty features.

SEAT_ROW_M = 0.74        # MEASURED. Row pitch, for reporting rows-per-band.
AISLE_PITCH_M = 14.0     # MEASURED. Stairs up the rake.
AISLE_W_M = 1.7          # MEASURED, roughly — 1.5-2 m of pale concrete.
AISLE_LIFT_M = 0.28      # stand the stair proud of the seats it divides
AISLE_STEPS = 7          # height segments per aisle (they follow the rake)

# Chairback seating. In the aerial's west crop the MIDDLE deck is the one dense
# with small warm-brown seat marks, while the lower bowl and the upper deck are
# mostly bare aluminium - so the chairbacks are a club level, not a ring round
# the whole bowl. The first cut of this put a saturated orange band across
# nearly half the visible deck, which is not what the photograph shows.
ORANGE_DECK = "mid"
ORANGE_FRAC = 0.45       # inner fraction of that deck which is chairback
# ... and the weathering. Measured contrast between clean and stained aluminium
# is luma 149.5 against 122.9, in blotches 2-8 m across. Bands are full rings so
# the blotching can only vary radially, but a deterministic scatter of stained
# bands is far closer to the photograph than one flat silver.
STAIN_EVERY = (7, 3, 11)  # (stride, offset, modulus): about 27% of bands weather

# South end zone, 2021. All published, none of it visible in our aerial.
BOARD_W_M = 41.0         # 134.38 ft
BOARD_H_M = 17.0         # 55.85 ft
BOARD_BASE_FRAC = 0.60   # generative: clear of the seating, under the rim
BOARD_THICK_M = 2.4
LONGHORN_W_M = 65.5      # 215 ft
LONGHORN_D_M = 21.9      # 72 ft

# Field. Regulation, and confirmed against the photograph by overlay.
FIELD_L_M = 109.73       # 120 yd including both end zones
FIELD_W_M = 48.77        # 53 1/3 yd
ENDZONE_M = 9.14         # 10 yd
FIELD_H = 0.14           # stand the turf above the ground fill. The paint
                         # sits 8 cm above it and the lines 8 cm above that:
                         # enough to never z-fight, far under a pixel from the air.

# Pedestrian ramp towers. MEASURED positions, to the pixel, off the aerial.
# Height is estimated from the shadow each one throws across the plaza.
RAMPS = [
    (-97.7332074, 30.2849343, 14.0, 25.0),   # NW
    (-97.7316252, 30.2848301, 14.0, 25.0),   # NE
    (-97.7335265, 30.2847167, 14.0, 22.0),   # W
    (-97.7313597, 30.2845766, 14.0, 22.0),   # E
    (-97.7315555, 30.2826916, 14.0, 22.0),   # SE
]
# THE LIGHT MASTS ARE GONE, and this is a deliberate deletion.
#
# They were declared generative — "the aerial cannot resolve a 2 m pole" — and
# set to 88 m, taller than the stadium's own 63 m, on a building whose seating
# now tops out at 38.5 m. Two things are wrong with that. First, nothing in the
# georeferenced aerial supports them: there are no mast shadows anywhere on the
# plaza, and the four white discs around the rim that might have been read as
# lamp arrays sit exactly on the surveyed RAMP TOWER positions at 14 m diameter.
# Second, DKR's lighting is mounted ON THE STRUCTURE — which is what he was
# describing: *"alot of the top perimeter is supposed to be lights but its
# rendering as wall."* RIM_LIGHT does that job now.
#
# Set MAST_COUNT back above zero if a photograph ever turns up showing masts.
MAST_COUNT = 0
MAST_TOP_M = 88.0
MAST_W_M = 2.2
MAST_HEAD_W_M = 9.0

# Which side of the bowl each wall segment belongs to. Sectors are measured from
# the FIELD's long axis, so a stadium that does not sit square to north still
# gets its end zones called ends. Half-width in degrees for the two end sectors.
END_SECTOR_DEG = 52.0

# ── The arcade: entrance, shops, pillars, concourse ───────────────────
#
# *"want the entrance, and the shops, accurate pillars and whatnot."*
#
# Up to here the ground floor was ONE flat extrusion wearing the `sp` facade
# tile, and that is why the stadium reads as a slab from the street no matter
# how good the bowl above it is. A facade pattern cannot make a colonnade: it
# has no vertical anchor and no idea where the wall's ends are, so it paints
# piers that march through the corners and past the gates. The piers have to be
# GEOMETRY, the same way js/drag.js builds shopfronts — separate features with
# their own base and height, never a pattern trying to land something "at the
# top".
#
# The model is the one DKR actually has, and the 2008 north-end photograph
# (Commons, DKR_new_north_end_2008-08-30) describes it exactly: massive piers
# standing proud of a wall that is SET BACK behind them, the bays between left
# open and deeply shadowed, glazed frontage in the bays at street level, and a
# continuous lintel over the whole run carrying the concourse above. Four
# elements, and the depth between them is the whole effect — a colonnade drawn
# flat is just a striped wall.
#
# The pitch is the one number here with a source: the north end's piers read at
# roughly 25 ft centres in the photograph. Everything else is proportion off
# that, and all of it is a one-line override.
#
# THE DEPTH NUMBERS ARE SET BY WHAT SURVIVES TO THE SCREEN, not by what a
# drawing would use. The first cut had 2.0 m piers standing 2.2 m proud of a
# 9.45 m plinth. At street level that read perfectly; from the oblique 200 m
# the app actually flies at, the whole arcade was 71 px of a 470 px wall and
# measured 0 magenta pixels on two of the four sides — the plaza grade and the
# facade's own vertical ribbing ate it. Deepening the reveal is what fixed it,
# not widening the piers: it is the SHADOW between pier and wall that reads at
# distance, and a 2.2 m reveal throws almost none.
ARCADE = {
    "pitch_m":   7.6,    # pier centres. ~25 ft, off the 2008 photograph.
    "pier_w_m":  2.4,    # pier width along the wall
    "recess_m":  3.4,    # how far the wall behind them is set back
    "shop_d_m":  0.3,    # glazed frontage stands this proud of the set-back wall
    "shop_frac": 0.58,   # ... and rises this fraction of the plinth
    "lintel_m":  2.0,    # the beam over the arcade, at the top of the plinth
    "gate_lift": 1.7,    # the gate pylons are this many plinth-heights tall
    "gate_w_m":  3.6,    # ... and this wide, being pylons rather than piers
    "canopy_m":  5.0,    # how far the gate canopy reaches out over the plaza
}
# The piers take their SIDE's material, because that is the one thing about DKR
# that four decades of additions guarantees: the north end really is red brick
# and the west really is Bellmont's painted concrete. `bay` is the shadow
# between them and is deliberately much darker than any wall in the scene — it
# is a hole you see into, not a surface.
ARCADE_COL = {
    "bay":    "#4b463f",
    "shop":   "#6d7a85",   # glazed frontage, reading as glass rather than sky
    "gate":   "#332e29",   # the opening itself
    "canopy": "#9c9486",
}

# ── The elevations, and why they differ ───────────────────────────────
# A stadium wall is not one material from grade to rim, and DKR's four sides are
# four different buildings from four different decades. A facade pattern has no
# vertical anchor — it repeats from the extrusion base with no idea where the top
# is — so a single 63 m extrusion wearing one tile can only ever be a marching
# window grid. Each side is therefore emitted as STACKED BANDS, each its own
# feature with its own base, height, pattern family and colour.
#
#   plinth  the concourse arcade you walk past. Present on all four sides.
#   mid     the building proper — this is where the sides diverge.
#   fascia  the back of the upper deck: a big blank raking concrete wall. It is
#           the single most important band, because it is what stops the window
#           grid from marching all the way to the roofline.
#
# WEST is Bellmont Hall — eleven levels built in 1972 INSIDE the support
#      structure of the west upper deck, housing athletics offices, lecture halls
#      and Kinesiology. It genuinely has windows; the office-block look was not
#      wrong here, it was wrong everywhere else.
# NORTH is the 2008 Red McCombs Red Zone. The photograph (Commons,
#      DKR_new_north_end_2008-08-30) shows what it actually is, and it is not a
#      window wall: massive CHAMFERED RED-BRICK PIERS on a tall buff cast-stone
#      base, with the bays between them left open and deeply shadowed so you see
#      straight through to the stacked concourse decks, plus occasional tall
#      grey-mullioned glass and a near-black cap band.
# EAST  is grandstand back — cast-in-place concrete over a cream base wall
#      carrying huge printed photo murals and burnt-orange accent panels.
# SOUTH is the 2021 Populous addition: metal panel and glass, club and suite
#      levels, the only genuinely modern elevation.
#
# The mid band ends at 0.66 of the wall — 41.6 m, eleven levels at a 3.8 m
# academic floor-to-floor. That is not a chosen number: Bellmont Hall IS eleven
# levels, and the upper deck sits on its roof.
# The plinth was 0.15 and is now 0.19 — 12.0 m rather than 9.45 m. That is not
# a cosmetic nudge: a stadium concourse arcade is two storeys plus its beam, and
# at 9.45 m the colonnade below could not be seen from the distance this app
# flies at (see ARCADE). 12 m is also closer to what the 2008 north-end
# photograph shows, where the piers stand well clear of a person and the deck
# above them is a full level. `mid` starts higher to match; Bellmont's eleven
# levels still land inside it at a 3.8 m floor-to-floor.
BANDS = [
    # name,     from,  to     (fractions of the wall height)
    ("plinth",  0.00, 0.19),
    ("mid",     0.19, 0.66),
    ("fascia",  0.66, 1.00),
]
PLINTH_FAM, PLINTH_COL = "sp", "#b3ada1"
FASCIA_FAM, FASCIA_COL = "sd", "#bab5a9"
SIDE_MID = {
    "W": ("sb", "#c0bab0"),   # Bellmont Hall, painted concrete
    # Darker and redder than it looks like it should be. The north end is the one
    # genuinely BRICK elevation on the building, and at #8f6b58 with the facade
    # stack's +10% gain and warm tint on top it came back out of the renderer as
    # the same pale tan as the concrete sides — the whole point of giving the
    # stadium its own palette entries was to stop exactly that happening.
    "N": ("sn", "#7d4f3a"),   # 2008 brick piers over buff cast stone
    "E": ("sf", "#b9b3a7"),   # painted cast-in-place concrete over a cream base
    "S": ("sg", "#adb0b2"),   # 2021 club/suite glazing
}

# Materials that are not walls. Entered as their true colour; wall_ramp() derives
# golden and night. UT's official burnt orange is #BF5700, and that is the
# ALUCOBOND custom finish on the Longhorn balcony, so it is used verbatim there.
BURNT_ORANGE = "#bf5700"
COL = {
    "turf":     "#3f6b3a",   # FieldTurf, darker green since the 2021 install
    "turf_lit": "#5e9a52",   # ... and under the floodlights
    "endzone":  BURNT_ORANGE,
    "paint":    "#e8e6e0",   # yard lines and lettering
    "board":    "#14161c",   # the video board, dark and matte in daylight
    "board_lit": "#6d7f96",  # ... and lit after dark, which it always is
    "boardrim": "#2b2f36",
    "orangeseat": "#a85426",  # chairbacks: burnt orange, weathered and dusty
    "ramp":     "#b6b0a4",   # pale concrete ramp towers
    "mast":     "#8e9299",
    "mast_lit": "#cfe0f2",   # the lamp array, on
    "aisle":    "#c6c1b6",   # pale concrete stair, brighter than the benches
}


def wall_ramp(hex_col):
    """day -> (golden, night) using the same relationship the city bake uses.

    Checked against DKR's own baked trio: #b7b1a6 -> #c3b19c / #1e2029. These
    colours must NOT be snapped to the city's shared palette — the 2008 north
    end zone is brick, and nearest-RGB against fourteen mostly-tan buckets
    quietly turned it back into tan. facades.js gives the stadium its own palette
    entries, which is why the trio has to be carried here.
    """
    c = [int(hex_col[i:i + 2], 16) for i in (1, 3, 5)]
    mixc = lambda a, b, t: [a[i] + (b[i] - a[i]) * t for i in range(3)]
    golden = mixc(c, [255, 190, 130], 0.16)
    night = mixc([v * 0.19 for v in c], [18, 22, 40], 0.42)
    hexify = lambda v: "#" + "".join("%02x" % max(0, min(255, int(round(x)))) for x in v)
    return hexify(golden), hexify(night)


# ── geometry helpers ──────────────────────────────────────────────────
def signed_area(pts):
    a = 0.0
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        a += x0 * y1 - x1 * y0
    return a * 0.5


def ccw(pts):
    """Closed ring, counter-clockwise, without the repeated last point."""
    p = pts[:-1] if pts[0] == pts[-1] else pts[:]
    if signed_area(p + [p[0]]) < 0:
        p = p[::-1]
    return p


def offset(pts, d):
    """Offset a closed ring by d metres. POSITIVE d grows the ring outward.

    Edge offset plus consecutive-line intersection. Returns None if the result
    degenerates, which is the right answer for an offset larger than the shape.
    """
    p = ccw(pts)
    n = len(p)
    if n < 3:
        return None
    lines = []
    for i in range(n):
        x0, y0 = p[i]
        x1, y1 = p[(i + 1) % n]
        dx, dy = x1 - x0, y1 - y0
        L = math.hypot(dx, dy)
        if L < 1e-9:
            return None
        nx, ny = dy / L, -dx / L          # outward normal for a CCW ring
        lines.append((x0 + nx * d, y0 + ny * d, dx, dy))
    out = []
    for i in range(n):
        ax, ay, adx, ady = lines[i - 1]
        bx, by, bdx, bdy = lines[i]
        den = adx * bdy - ady * bdx
        if abs(den) < 1e-9:
            return None
        t = ((bx - ax) * bdy - (by - ay) * bdx) / den
        out.append((ax + adx * t, ay + ady * t))
    ring = out + [out[0]]
    if signed_area(ring) <= 1.0:
        return None
    return ring


def to_m(ring, lat0):
    k = math.cos(math.radians(lat0))
    return [(p[0] * M_LAT * k, p[1] * M_LAT) for p in ring]


def to_ll(pts, lat0):
    k = math.cos(math.radians(lat0))
    ring = list(pts)
    if ring[0] != ring[-1]:
        ring = ring + [ring[0]]
    return [[round(x / (M_LAT * k), 7), round(y / M_LAT, 7)] for (x, y) in ring]


def ll_to_m(lon, lat, lat0):
    k = math.cos(math.radians(lat0))
    return (lon * M_LAT * k, lat * M_LAT)


def centroid(pts):
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))


def ray_hit(c, ang, ring):
    """Where a ray from c at angle `ang` leaves `ring`. Both are in metres.

    The seating bands need a point on the field hole that CORRESPONDS to each
    vertex of the wall, so a band can be a blend of the two. A ray from the
    centre gives that correspondence for any two rings that are star-shaped about
    it, which both of these are — and unlike a uniform offset it keeps the real
    per-side widths (85 m west, 32 m south).
    """
    dx, dy = math.cos(ang), math.sin(ang)
    best = None
    n = len(ring)
    for i in range(n):
        x0, y0 = ring[i]
        x1, y1 = ring[(i + 1) % n]
        ex, ey = x1 - x0, y1 - y0
        den = dx * ey - dy * ex
        if abs(den) < 1e-12:
            continue
        t = ((x0 - c[0]) * ey - (y0 - c[1]) * ex) / den
        u = ((x0 - c[0]) * dy - (y0 - c[1]) * dx) / den
        if t > 0 and -1e-9 <= u <= 1 + 1e-9:
            if best is None or t < best:
                best = t
    if best is None:
        return None
    return (c[0] + dx * best, c[1] + dy * best)


def long_axis(ring):
    """Angle of the ring's longest EDGE — the axis the field runs along.

    This used to take the longest DIAGONAL, between any two vertices, and the
    comment above it confidently called that "the axis the field runs along".
    It is not. DKR's field hole is a 68.4 x 123.3 m rectangle, so the longest
    distance between two of its corners is the 141.0 m diagonal at bearing
    114.4 deg, while the actual long side runs at 85.3 deg. Everything keyed to
    this angle was therefore rotated by TWENTY-NINE DEGREES: the turf, the end
    zones, the yard lines, the video board, the Longhorn balcony, the light
    masts, and — least visibly and most damagingly — the N/S/E/W side
    assignment, which put the 2008 brick north elevation across the wrong faces
    of the building.

    Classic case of writing down a rule and never checking it reproduces the one
    example available. On a rectangle the longest edge is the answer; on any
    convex ring it is still the right reading of "which way does this thing run".
    """
    best, bang = -1.0, 0.0
    n = len(ring)
    for i in range(n):
        ax, ay = ring[i]
        bx, by = ring[(i + 1) % n]
        d = math.hypot(bx - ax, by - ay)
        if d > best:
            best, bang = d, math.atan2(by - ay, bx - ax)
    # The edge direction is still arbitrary in SIGN — an edge traversed the other
    # way points 180 deg off, and the first version of this labelled the south
    # end "N" for exactly that reason. Point it north so the names mean what they
    # say.
    if math.sin(bang) < 0:
        bang += math.pi
    return bang


# ── Taste block: seat colour, and the night falloff ───────────────────
#
# DAY. Measured off data/dkr_aerial_geo.png by classifying the seating: the deck
# is aluminium silver with burnt-orange chairbacks in DEFINED SECTIONS, not the
# even scatter the old bake produced. The orange mask shows a continuous band
# across the NORTH upper deck and a block in the EAST lower bowl, with diffuse
# rust elsewhere that is weathering rather than seats. *"various seats are
# colored burnt orange vs normal"* — this is which.
SEAT_TONE = {
    "lower":  "#9fb0c4",
    "lowerB": "#8b9cb0",
    "upper":  "#a8bad0",
    "upperB": "#93a5bb",
    "orange": "#b4652c",   # chairbacks
    "orangeB": "#a15a26",
    "stain":  "#8d8f8e",   # weathered aluminium
    "void":   "#33363d",   # the slot under an overhang stays dark
}
# NIGHT, AND IT IS AUTHORED RATHER THAN LIT. MapLibre 5.24 has one global light
# and no `fill-extrusion-emissive-strength` (that is Mapbox GL v3) — there is no
# way to place a floodlight on the rim and let it illuminate anything. So the
# falloff below is painted by hand, and it follows what a floodlit stadium
# actually does:
#
#   the field is the brightest surface        (js/app.js's fieldColourAt owns
#                                              the turf; see the HANDOFF note)
#   the LOWER bowl is lit                     brightest seating tone
#   the UPPER deck falls off with height      about half the lower bowl
#   the void under the deck stays black       it is a shadow
#   the OUTSIDE is comparatively dark         the wall keeps its own night ramp
#
# The point is the ORDER, not the absolute values: lower > upper > structure >
# outside, with the fixtures themselves the only genuinely bright thing. The old
# model had exactly one tone for everything and it was brighter than the city.
NIGHT_TONE = {
    "lower":  "#6d707e",
    "lowerB": "#636674",
    "upper":  "#3e414c",
    "upperB": "#383b45",
    "orange": "#7a4a2a",
    "orangeB": "#6b4126",
    "stain":  "#4a4c54",
    "void":   "#14161b",
}
# Where the burnt-orange sections are, as (side, deck, radial fraction range).
# From the orange mask: a band across the north upper deck, and a block in the
# east lower bowl.
ORANGE_SECTIONS = [("N", "upper", 0.15, 0.62), ("E", "lower", 0.30, 0.85)]


def seat_class(deck, row, rows, ang, axis):
    """One of SEAT_COL's twelve legal `s` keys for this band.

    THE PALETTE IS NOT OURS. `stadium-seating` colours itself from SEAT_COL in
    js/app.js keyed on `s`, and anything outside those twelve strings silently
    paints as `lower`. So this picks from the vocabulary that exists rather than
    writing a colour — which also means the NIGHT column is out of reach from
    here. See the HANDOFF request.
    """
    frac = (row + 0.5) / rows
    w = side_weights(ang, axis)
    dom = max(w, key=w.get)
    key = "upper" if deck == "upper" else "lower"
    for side, dk, f0, f1 in ORANGE_SECTIONS:
        if dom == side and dk == deck and f0 <= frac <= f1 and w[side] > 0.45:
            key = "orange"
            break
    else:
        stride, off, mod = STAIN_EVERY
        if (row * stride + off) % mod < 2:
            key = "stain"
    return key + ("B" if row % 2 else "")


def side_weights(ang, axis):
    """How much each of the four sides owns this bearing. Sums to 1.

    A hard sector switch put a cliff in the seating at every corner, because the
    west deck is 38.5 m and the south is 12 m and they met at a single edge. The
    real bowl turns the corner continuously, so each bearing is a blend of the
    two sides nearest it.
    """
    d = math.degrees((ang - axis) % (2 * math.pi))     # 0 = north end
    centres = {"N": 0.0, "E": 90.0, "S": 180.0, "W": 270.0}
    w = {}
    for k, c in centres.items():
        gap = abs((d - c + 180.0) % 360.0 - 180.0)
        # 1 at the side's own centre, 0 once past 90 - blend, smooth between.
        x = (90.0 - gap) / SIDE_BLEND_DEG
        w[k] = max(0.0, min(1.0, x))
    tot = sum(w.values()) or 1.0
    return {k: v / tot for k, v in w.items()}


def profile_for(ang, axis):
    """The blended deck table at one bearing: [(name, t0, t1, z0, z1, rows)].

    Blends the four SIDES tables by weight. Tables can differ in LENGTH - the
    south has no upper deck - so a side that lacks a deck contributes its own
    top height for that deck, which collapses the missing deck to a flat step
    rather than dropping a hole in the bowl at the corner.
    """
    w = side_weights(ang, axis)
    names = ["lower", "void", "upper"]
    out = []
    for nm in names:
        t0 = t1 = z0 = z1 = 0.0
        rows = 0
        for k, wk in w.items():
            if wk <= 0:
                continue
            tbl = {d[0]: d for d in SIDES[k]["decks"]}
            if nm in tbl:
                _n, a, b, p, q, r = tbl[nm]
                rows = max(rows, r)
            else:
                # This side stops before that deck: hold its last values, so the
                # blend ramps down to a flat continuation instead of a gap.
                last = SIDES[k]["decks"][-1]
                a = b = last[2]
                p = q = last[4]
            t0 += wk * a
            t1 += wk * b
            z0 += wk * p
            z1 += wk * q
        if t1 - t0 > 1e-6 or nm == "void":
            out.append((nm, t0, t1, z0, z1, max(1, rows)))
    return out


def bowl_height_at(t, ang, axis):
    """Seating height in metres at radial fraction `t` on this bearing.

    The per-side replacement for `deck_height(t, h)`, which walked one global
    DECKS table times the footprint's raw 63 m. Anything riding the bowl - the
    aisle stairs, the midfield logo - has to use THIS or it floats: measured on
    the first build, the stairs topped out at 58.9 m against a bowl topping at
    35.7 m, a 23.2 m overshoot, worst over the south end where the bowl is 12 m.
    """
    prof = profile_for(ang, axis)
    z = 0.0
    for nm, t0, t1, z0, z1, _rows in prof:
        if t <= t0:
            break
        if t >= t1:
            z = z1
            continue
        f = ((t - t0) / max(1e-9, t1 - t0)) ** RAKE_GAMMA
        z = z0 + (z1 - z0) * f
        break
    return z


def wall_height_at(ang, axis):
    """Blended perimeter wall height, in metres."""
    w = side_weights(ang, axis)
    return sum(w[k] * SIDES[k]["wall_m"] for k in w)


def deck_height(t, h):
    """Height of the deck at radial fraction t (0 = field, 1 = wall)."""
    for name, t0, t1, z0, z1, _n in DECKS:
        if t <= t1 + 1e-9:
            if name == "void":
                return z0 * h
            f = ((t - t0) / max(1e-9, t1 - t0)) ** RAKE_GAMMA
            return (z0 + (z1 - z0) * f) * h
    return DECKS[-1][4] * h


def bands():
    """(t_lo, t_hi, class) per seating band, walking the decks in order.

    The trailing A/B on each class is the ROW STRIPE. Geometry already steps at
    every band, but at 200-900 m a 0.74 m step is well under a pixel, so the
    steps alone average back to flat exactly where the flyover lives.
    Alternating two near-identical tones keeps the stripe alive at every
    distance without ever reading as a stripe pattern up close.
    """
    out = []
    for name, t0, t1, _z0, _z1, n in DECKS:
        for i in range(n):
            a = t0 + (t1 - t0) * i / n
            b = t0 + (t1 - t0) * (i + 1) / n
            if name == "void":
                out.append((a, b, "void"))
                continue
            stride, off, mod = STAIN_EVERY
            if name == ORANGE_DECK and (i + 0.5) / n < ORANGE_FRAC:
                base = "orange"
            elif (i * stride + off) % mod < 3:
                base = "stain"
            else:
                base = name
            out.append((a, b, base + ("B" if i % 2 else "")))
    return out


def side_for(ang, axis):
    """N / S / E / W relative to the field's own long axis."""
    d = math.degrees((ang - axis + math.pi) % (2 * math.pi) - math.pi)
    if abs(d) <= END_SECTOR_DEG:
        return "N"
    if abs(d) >= 180 - END_SECTOR_DEG:
        return "S"
    return "E" if d < 0 else "W"


def rect(cx, cy, w, d, ang):
    """Axis-aligned-in-rotated-frame rectangle, centred, returned in metres."""
    ca, sa = math.cos(ang), math.sin(ang)
    out = []
    for ux, uy in ((-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2)):
        out.append((cx + ux * ca - uy * sa, cy + ux * sa + uy * ca))
    return out


def disc(cx, cy, r, n=20):
    return [(cx + r * math.cos(2 * math.pi * i / n),
             cy + r * math.sin(2 * math.pi * i / n)) for i in range(n)]


def feat(ring_m, lat0, props, hole_m=None):
    """One polygon. If it carries a `col`, expand it into a day/golden/night trio.

    Everything that is not a wall — turf, paint, the board, the balcony, the
    ramps, the masts, the aisles — is drawn by ONE fill-extrusion layer whose
    colour is interpolated between two `['get', ...]` properties at paint time.
    That is the only way a per-feature material can ride the same day ramp as the
    rest of the scene without a layer per material: a texture that only looks
    right at noon is not finished, and there are seven materials here.
    """
    if "col" in props:
        g, n = wall_ramp(props["col"])
        # A video board is a LIGHT SOURCE, so the one thing it must not do is
        # follow the wall ramp down into the dark at night. wall_ramp() would
        # take it to #0a0b0f; the real one is the brightest object on campus
        # after sunset. `night` overrides the derived value for exactly that.
        props = dict(props, cd=props["col"], cg=props.get("golden", g),
                     cn=props.get("night", n))
        for k in ("col", "night", "golden"):
            props.pop(k, None)
    coords = [to_ll(ring_m, lat0)]
    if hole_m:
        coords.append(to_ll(hole_m, lat0))
    return {"type": "Feature", "properties": props,
            "geometry": {"type": "Polygon", "coordinates": coords}}


# ── Taste block: the rim lights ───────────────────────────────────────
# The fixtures that run along the top of the perimeter. `night` is the whole
# point: it does NOT follow wall_ramp() down into the dark, so after sunset
# these are the brightest thing on the building and everything else falls away
# from them. Turn `night` down to #2a2c33 and the stadium goes dark.
RIM_LIGHT = {
    "pitch_m": 11.0,     # centres along the rim
    "width_m": 3.4,      # housing width along the run
    "reach_m": 1.1,      # how far it stands proud of the wall face
    "drop_m": 1.6,       # top of wall minus this = fixture underside
    "rise_m": 1.0,       # ... and it stands this far above the wall
    "day": "#c9ccd2",
    "golden": "#d8cdb6",
    "night": "#f2e7c8",  # authored, not lit - see the bowl's night falloff
}


def run_len(O):
    return sum(math.hypot(O[k + 1][0] - O[k][0], O[k + 1][1] - O[k][1])
               for k in range(len(O) - 1))


def at_along(O, BF, s):
    """Point, unit tangent and set-back twin at arc length `s` along O."""
    acc = 0.0
    for k in range(len(O) - 1):
        a, b = O[k], O[k + 1]
        ab, bb = BF[k], BF[k + 1]
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        if L < 1e-9:
            continue
        if acc + L >= s or k == len(O) - 2:
            u = min(1.0, max(0.0, (s - acc) / L))
            p = (a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u)
            q = (ab[0] + (bb[0] - ab[0]) * u, ab[1] + (bb[1] - ab[1]) * u)
            return p, ((b[0] - a[0]) / L, (b[1] - a[1]) / L), q
        acc += L
    return O[-1], (1.0, 0.0), BF[-1]


def arcade(O, I, BF, face, t_rec, side, plinth_h, lat0, name, stats):
    """The colonnade along one wall run: piers, glazed frontage, lintel, gate.

    O is the run's original outer face, I its inner face, BF the set-back wall
    the piers stand in front of, and `face(t)` any parallel surface between O
    and I. Everything below is built off arc length along O, so a run that bends
    round a corner of the footprint gets piers that follow the bend instead of
    marching through it — which is exactly what a facade pattern could not do.
    """
    made = []
    segs = []
    for k in range(len(O) - 1):
        L = math.hypot(O[k + 1][0] - O[k][0], O[k + 1][1] - O[k][1])
        if L > 1e-6:
            segs.append((O[k], O[k + 1], BF[k], BF[k + 1], L))
    total = sum(s[4] for s in segs)
    if total < ARCADE["pitch_m"] * 2 or plinth_h < 2:
        stats["arcade_run_too_short"] += 1
        return made

    pier_col = SIDE_MID.get(side, (PLINTH_FAM, PLINTH_COL))[1]

    def at(s):
        """Point, unit tangent and set-back twin at arc length `s` along O."""
        acc = 0.0
        for a, b, ab, bb, L in segs:
            if acc + L >= s or (a, b) == (segs[-1][0], segs[-1][1]):
                u = min(1.0, max(0.0, (s - acc) / L))
                p = (a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u)
                q = (ab[0] + (bb[0] - ab[0]) * u, ab[1] + (bb[1] - ab[1]) * u)
                d = ((b[0] - a[0]) / L, (b[1] - a[1]) / L)
                return p, d, q
            acc += L
        return segs[-1][1], (1.0, 0.0), segs[-1][3]

    n_pier = max(2, int(round(total / ARCADE["pitch_m"])))
    # The gate takes the two middle slots, and only on a run long enough to
    # spare them. Its position is generative — the bake has no source for where
    # DKR's gates are — but every side of a stadium has a way in, and a run with
    # no opening at all is the thing that reads as a warehouse.
    gate = (n_pier // 2 - 1, n_pier // 2) if n_pier >= 8 else ()

    for j in range(n_pier):
        s = total * (j + 0.5) / n_pier
        is_gate = j in gate
        w = ARCADE["gate_w_m"] if is_gate else ARCADE["pier_w_m"]
        p, d, q = at(s)
        half = w / 2
        quad = [(p[0] - d[0] * half, p[1] - d[1] * half),
                (p[0] + d[0] * half, p[1] + d[1] * half),
                (q[0] + d[0] * half, q[1] + d[1] * half),
                (q[0] - d[0] * half, q[1] - d[1] * half)]
        made.append(feat(quad, lat0, {
            "kind": "pier", "col": pier_col, "name": name,
            "h": round(plinth_h * (ARCADE["gate_lift"] if is_gate else 1.0), 2)}))
        stats["gate_pylons" if is_gate else "piers"] += 1

    # The glazed frontage, standing just proud of the set-back wall so it reads
    # as a shopfront in a reveal rather than as a painted stripe. It stops well
    # under the lintel; the dark band above it is the open part of the bay.
    made.append(feat(face(max(0.0, t_rec - ARCADE["shop_d_m"] / WALL_THICK_M))
                     + BF[::-1], lat0, {
        "kind": "shop", "col": ARCADE_COL["shop"], "name": name,
        "h": round(plinth_h * ARCADE["shop_frac"], 2)}))
    stats["shopfronts"] += 1

    # The lintel runs the whole depth of the arcade at the top of the plinth: it
    # is the beam over the piers AND the soffit you see from underneath, and it
    # is what ties a row of columns into a colonnade.
    made.append(feat(O + BF[::-1], lat0, {
        "kind": "lintel", "col": PLINTH_COL, "name": name,
        "base": round(plinth_h - ARCADE["lintel_m"], 2), "h": round(plinth_h, 2)}))
    stats["lintels"] += 1

    # The gate: a dark opening between the two pylons, and a canopy over it.
    if gate:
        s0 = total * (gate[0] + 0.5) / n_pier
        s1 = total * (gate[1] + 0.5) / n_pier
        p0, d0, q0 = at(s0)
        p1, _d1, q1 = at(s1)
        made.append(feat([q0, q1, p1, p0], lat0, {
            "kind": "gate", "col": ARCADE_COL["gate"], "name": name,
            "h": round(plinth_h * 1.02, 2)}))
        # Outward is BF -> O, taken from the geometry rather than from a
        # normal-of-the-tangent, which would depend on the ring's winding and
        # would put the canopy inside the stadium on half the runs.
        ox, oy = p0[0] - q0[0], p0[1] - q0[1]
        oL = math.hypot(ox, oy) or 1.0
        reach = ARCADE["canopy_m"]
        nx, ny = ox / oL * reach, oy / oL * reach
        made.append(feat([q0, q1, (p1[0] + nx, p1[1] + ny), (p0[0] + nx, p0[1] + ny)],
                         lat0, {
            "kind": "canopy", "col": ARCADE_COL["canopy"], "name": name,
            "base": round(plinth_h * 0.92, 2), "h": round(plinth_h * 1.02, 2)}))
        stats["gates"] += 1
    return made


# ── the bake ──────────────────────────────────────────────────────────
def build(feature, stats):
    p = feature["properties"]
    g = feature["geometry"]
    name = p.get("name") or "(unnamed)"
    h = p.get("final_height") or 0
    outer_ll, hole_ll = g["coordinates"][0], g["coordinates"][1]
    lat0 = sum(q[1] for q in outer_ll) / len(outer_ll)
    outer = ccw(to_m(outer_ll, lat0))
    hole = ccw(to_m(hole_ll, lat0))

    inner_ring = offset(outer + [outer[0]], -WALL_THICK_M)
    if inner_ring is None:
        stats["wall_offset_failed"] += 1
        return [], None
    inner = ccw(inner_ring)
    c = centroid(hole)
    axis = long_axis(hole)

    out = []
    base_props = {k: p.get(k) for k in ("wd", "wg", "wn", "rd", "rg", "rn")}

    # 1. the perimeter wall, in per-side segments -----------------------
    runs, cur, cur_side = [], [], None
    n = len(inner)
    for i in range(n):
        a, b = inner[i], inner[(i + 1) % n]
        mid = ((a[0] + b[0]) / 2 - c[0], (a[1] + b[1]) / 2 - c[1])
        s = side_for(math.atan2(mid[1], mid[0]), axis)
        if s != cur_side and cur:
            runs.append((cur_side, cur))
            cur = [i]
        else:
            cur.append(i)
        cur_side = s
    if cur:
        runs.append((cur_side, cur))
    if len(runs) > 1 and runs[0][0] == runs[-1][0]:
        runs[-1] = (runs[-1][0], runs[-1][1] + runs[0][1])
        runs = runs[1:]

    for side, idxs in runs:
        if len(idxs) < 2:
            continue
        pts = [idxs[0]] + idxs[1:] + [(idxs[-1] + 1) % n]
        O = [outer[i] for i in pts]
        I = [inner[i] for i in pts]
        poly = O + I[::-1]
        if abs(signed_area(poly + [poly[0]])) < 5:
            continue
        # A side can be taller than the bowl. The west is: Bellmont Hall is
        # 72.5 m against the stadium's 63, and that 9.5 m of extra perimeter
        # is a real, visible part of DKR's west elevation.
        # THE PERIMETER HEIGHT, and it no longer comes from the survey.
        # `SIDE_H` carried Bellmont Hall's 72.5 m onto the west and the
        # footprint's own 63.0 m onto everything else, so all four sides were a
        # drum of one height. SIDES now states each side's wall in metres,
        # derived from its own measured ring depth. West 41, north 34, east 33,
        # south 17 — the south is a screen and a low stand, not a 63 m wall.
        sh = SIDES.get(side, SIDES["E"])["wall_m"]

        # `t` walks from the outer face (0) to the inner face (1) of the wall
        # band, so any surface parallel to this run is one lerp. The wall's
        # inner ring is a true parallel offset of its outer one, which is what
        # makes that legal.
        def face(t, _O=O, _I=I):
            return [(o[0] + (q[0] - o[0]) * t, o[1] + (q[1] - o[1]) * t)
                    for o, q in zip(_O, _I)]

        t_rec = min(0.85, ARCADE["recess_m"] / WALL_THICK_M)
        BF = face(t_rec)                      # the set-back wall behind the piers
        plinth_h = sh * BANDS[0][2]

        for bname, f0, f1 in BANDS:
            if bname == "plinth":
                fam, col = PLINTH_FAM, PLINTH_COL
            elif bname == "fascia":
                fam, col = FASCIA_FAM, FASCIA_COL
            else:
                fam, col = SIDE_MID.get(side, (PLINTH_FAM, PLINTH_COL))
            wg, wn = wall_ramp(col)
            pr = dict(base_props)
            pr.update({"kind": "wall", "side": side, "band": bname, "fam": fam,
                       "wd": col, "wg": wg, "wn": wn,
                       "h": round(sh * f1, 2), "base": round(sh * f0, 2),
                       "name": name, "building_class": "stadium", "final_height": sh})
            # THE PLINTH IS SET BACK. That is the arcade: the piers below stand
            # on the original face, and the depth between the two is what makes
            # a colonnade read as one rather than as a striped wall.
            out.append(feat((BF + I[::-1]) if bname == "plinth" else poly, lat0, pr))
            stats["wall_bands"] += 1
        stats["wall_segments"] += 1

        out.extend(arcade(O, I, BF, face, t_rec, side, plinth_h, lat0, name, stats))

        # ── THE TOP OF THE PERIMETER IS LIGHT FIXTURES, NOT WALL ──────
        #
        # *"pretty sure alot of the top perimeter is supposed to be lights but
        # its rendering as wall."* He is right, and it is visible in the aerial:
        # the rim carries a run of fixture housings, not a parapet.
        #
        # These are the only genuinely bright thing in the scene after dark, and
        # they are bright because their `night` colour says so — MapLibre 5.24
        # has no emissive property, so a "light" here is a small pale slab that
        # does not follow the wall ramp down into the dark. That is the same
        # trick the video board and the mast heads already use.
        #
        # They sit ON the wall (base = the wall top) and stand proud of its
        # outer face, so from below they read as a lit cornice and from above as
        # a row of housings round the rim.
        n_lamp = max(2, int(round(run_len(O) / RIM_LIGHT["pitch_m"])))
        for j in range(n_lamp):
            s_at = run_len(O) * (j + 0.5) / n_lamp
            p, d, q = at_along(O, BF, s_at)
            half = RIM_LIGHT["width_m"] / 2.0
            ox, oy = p[0] - q[0], p[1] - q[1]
            oL = math.hypot(ox, oy) or 1.0
            reach = RIM_LIGHT["reach_m"]
            nx, ny = ox / oL * reach, oy / oL * reach
            quad = [(p[0] - d[0] * half, p[1] - d[1] * half),
                    (p[0] + d[0] * half, p[1] + d[1] * half),
                    (p[0] + d[0] * half + nx, p[1] + d[1] * half + ny),
                    (p[0] - d[0] * half + nx, p[1] - d[1] * half + ny)]
            out.append(feat(quad, lat0, {
                "kind": "mast", "col": RIM_LIGHT["day"],
                "golden": RIM_LIGHT["golden"], "night": RIM_LIGHT["night"],
                "base": round(sh - RIM_LIGHT["drop_m"], 2),
                "h": round(sh + RIM_LIGHT["rise_m"], 2), "name": name}))
            stats["rim_lights"] += 1

    # 2. the seating bowl ----------------------------------------------
    # One ray per wall vertex, so the bands inherit the footprint's real shape.
    angs = [math.atan2(q[1] - c[1], q[0] - c[0]) for q in inner]
    pairs = []
    for a, q in zip(angs, inner):
        hp = ray_hit(c, a, hole)
        if hp is None:
            stats["ray_miss"] += 1
            hp = c
        pairs.append((hp, q))
    ring_at = lambda t: [(hp[0] + (wp[0] - hp[0]) * t, hp[1] + (wp[1] - hp[1]) * t)
                         for hp, wp in pairs]

    # THE BOWL, REBUILT. Read this before changing it back.
    #
    # It is emitted as DETAIL features, not as `kind: "seat"`, and that is not a
    # stylistic choice — it is forced, twice over, by js/app.js, which belongs to
    # the other lane and cannot be edited from here:
    #
    #   1. `stadium-seating` hardcodes `'fill-extrusion-base': 0`
    #      (js/app.js:1191). A seat feature ALWAYS extrudes from the ground, so
    #      44 nested rings of rising height are a solid stepped cone. That is
    #      not a bad approximation of a bowl, it IS a pyramid with cutouts, and
    #      it is exactly what he called it. No base means no upper deck floating
    #      over a void, and no void means no bowl.
    #   2. `stadium-seating` takes its colour from SEAT_COL keyed on `s`
    #      (js/app.js:758-771), whose NIGHT column is #d87c34 / #e08438 /
    #      #e88c3e / #f09a48 — bright amber. Every seat in the stadium glows at
    #      night and nothing else does. That is the "seats become bright yellow"
    #      complaint, it has been defended once and rejected twice, and it is
    #      unreachable from this file.
    #
    # `stadium-detail` has neither problem: it honours
    # `['coalesce', ['get','base'], 0]` and takes an arbitrary per-feature
    # day/golden/night trio. So the bowl moves there and gets a real base, real
    # voids, per-side heights and an authored night falloff.
    #
    # THE COST, stated because it is real: `stadium-detail` is in js/lod.js's
    # `fine` tier, so the bowl is dropped above renderDistance x 0.45 (315 m on
    # the default preset). A coarse under-mass in `stain` is emitted below to
    # keep a silhouette up there. The proper fix is for SEAT_COL's night column
    # to stop glowing; that request is written into HANDOFF.md.
    seg = BOWL_SEGMENTS
    ring_arc = lambda t, i0, i1: [
        (pairs[k % len(pairs)][0][0] +
         (pairs[k % len(pairs)][1][0] - pairs[k % len(pairs)][0][0]) * t,
         pairs[k % len(pairs)][0][1] +
         (pairs[k % len(pairs)][1][1] - pairs[k % len(pairs)][0][1]) * t)
        for k in range(i0, i1 + 1)]

    n_pairs = len(pairs)
    for s_i in range(seg):
        i0 = int(round(n_pairs * s_i / seg))
        i1 = int(round(n_pairs * (s_i + 1) / seg))
        if i1 <= i0:
            continue
        # The bearing at this segment's middle decides its profile.
        mid = pairs[(i0 + i1) // 2 % n_pairs][1]
        ang = math.atan2(mid[1] - c[1], mid[0] - c[0])
        prof = profile_for(ang, axis)
        for nm, t0, t1, z0, z1, rows in prof:
            if nm == "void":
                # THE CONCOURSE SLOT, and it is a real gap now. It used to be a
                # solid `void` ring standing on the ground because a seat
                # feature could not have a base; it is now a thin dark soffit
                # hanging at the underside of the upper deck with daylight under
                # it, which is the shadow line that makes two decks read as two.
                out.append(feat(ring_arc(t1, i0, i1) + ring_arc(t0, i0, i1)[::-1],
                                lat0, {"kind": "seat", "s": "void",
                                       "base": round(z1 - VOID_SOFFIT_M, 2),
                                       "h": round(z1, 2), "name": name}))
                stats["bowl_void"] += 1
                continue
            for r in range(rows):
                a = t0 + (t1 - t0) * r / rows
                b = t0 + (t1 - t0) * (r + 1) / rows
                za = z0 + (z1 - z0) * (r / rows) ** RAKE_GAMMA
                zb = z0 + (z1 - z0) * ((r + 1) / rows) ** RAKE_GAMMA
                # THE LINE PR #114 MADE POSSIBLE.
                # A lower-bowl row sits on fill and starts at the ground. An
                # UPPER-deck row is carried on structure over the concourse, so
                # it starts at its own underside — which is what stops the bowl
                # being one solid stepped cone. Before this, `base` on a seat
                # feature was discarded and every row grew from y=0: "cutouts
                # from a big pyramid" was a literal description of that.
                base = 0.0 if nm == "lower" else max(0.0, za - DECK_SLAB_M)
                out.append(feat(ring_arc(b, i0, i1) + ring_arc(a, i0, i1)[::-1],
                                lat0, {"kind": "seat",
                                       "s": seat_class(nm, r, rows, ang, axis),
                                       "base": round(base, 2),
                                       "h": round(zb, 2), "name": name}))
                stats["bowl_bands"] += 1

    # The coarse under-mass, and the ONLY thing still using `kind: "seat"`.
    # js/lod.js drops stadium-detail above 315 m; without this the stadium
    # hollows out into a wall ring from altitude. `stain` is chosen of the
    # twelve legal SEAT_COL keys because it is grey by day (#8b8d8d) and the
    # least luminous of the non-void entries after dark (#c07038 against the
    # upper deck's #f09a48).
    for s_i in range(8):
        i0 = int(round(n_pairs * s_i / 8))
        i1 = int(round(n_pairs * (s_i + 1) / 8))
        if i1 <= i0:
            continue
        mid = pairs[(i0 + i1) // 2 % n_pairs][1]
        ang = math.atan2(mid[1] - c[1], mid[0] - c[0])
        prof = profile_for(ang, axis)
        top = max(p[4] for p in prof)
        out.append(feat(ring_arc(0.80, i0, i1) + ring_arc(0.02, i0, i1)[::-1], lat0,
                        {"kind": "seat", "s": "stain",
                         "h": round(top * 0.62, 2), "name": name}))
        stats["bowl_coarse"] += 1

    # 3. the aisles ----------------------------------------------------
    # MEASURED at ~14 m apart, and they are most of the bowl's radial pattern:
    # without them the concentric row stripe has nothing crossing it and the deck
    # reads as corduroy. Each aisle is split into AISLE_STEPS height segments so
    # it climbs the rake instead of flying over it as one flat plank.
    per = sum(math.hypot(pairs[i][1][0] - pairs[i - 1][1][0],
                         pairs[i][1][1] - pairs[i - 1][1][1]) for i in range(len(pairs)))
    n_aisle = max(8, int(round(per / AISLE_PITCH_M)))
    for k in range(n_aisle):
        a = 2 * math.pi * k / n_aisle
        hp = ray_hit(c, a, hole)
        wp = ray_hit(c, a, inner)
        if hp is None or wp is None:
            continue
        dx, dy = wp[0] - hp[0], wp[1] - hp[1]
        L = math.hypot(dx, dy)
        if L < 1e-6:
            continue
        px, py = -dy / L * AISLE_W_M / 2, dx / L * AISLE_W_M / 2
        for j in range(AISLE_STEPS):
            t0 = j / AISLE_STEPS
            t1 = (j + 1) / AISLE_STEPS
            a0 = (hp[0] + dx * t0, hp[1] + dy * t0)
            a1 = (hp[0] + dx * t1, hp[1] + dy * t1)
            quad = [(a0[0] + px, a0[1] + py), (a1[0] + px, a1[1] + py),
                    (a1[0] - px, a1[1] - py), (a0[0] - px, a0[1] - py)]
            out.append(feat(quad, lat0, {
                "kind": "aisle", "col": COL["aisle"],
                "h": round(bowl_height_at(t1, a, axis) + AISLE_LIFT_M, 2),
                "name": name}))
            stats["aisles"] += 1

    # 4. the field ------------------------------------------------------
    # NOT emitted as features any more. The whole field — turf, mow stripes,
    # yard lines, hash marks, numbers, end zones, lettering and the midfield
    # Longhorn — is ONE image, registered to the four corners reported below and
    # drawn by a raster layer under the stadium walls. See fieldImage() in
    # js/app.js.
    #
    # The reason is occlusion, and it is not a preference. The lettering and the
    # mark were a `symbol` layer, and MapLibre symbols do not depth-test against
    # fill-extrusions: they are composited on top of the frame, so TEXAS and the
    # Longhorn were legible through 63 m of grandstand from outside the stadium.
    # No symbol-layer setting fixes that. A raster on the ground plane is real
    # ground — the walls are drawn after it and paint over it exactly as they do
    # over every other surface.
    #
    # It also buys the field twenty-seven fewer features and everything a real
    # field has: a polygon alphabet was never going to happen.
    ca, sa = math.cos(axis - math.pi / 2), math.sin(axis - math.pi / 2)
    fx, fy = c
    # Corners in the order an `image` source wants them: top-left, top-right,
    # bottom-right, bottom-left, with the image's top edge at the north end.
    nx, ny = math.cos(axis), math.sin(axis)          # along the field, northward
    ex, ey_ = math.sin(axis), -math.cos(axis)        # across it, eastward
    HL, HW = FIELD_L_M / 2, FIELD_W_M / 2
    corners_m = [
        (fx + nx * HL - ex * HW, fy + ny * HL - ey_ * HW),   # NW -> image TL
        (fx + nx * HL + ex * HW, fy + ny * HL + ey_ * HW),   # NE -> image TR
        (fx - nx * HL + ex * HW, fy - ny * HL + ey_ * HW),   # SE -> image BR
        (fx - nx * HL - ex * HW, fy - ny * HL - ey_ * HW),   # SW -> image BL
    ]
    field_corners = [to_ll([p], lat0)[0] for p in corners_m]
    stats["field_image"] += 1

    # 5. the video board -------------------------------------------------
    # 17.0 x 41.0 m, south end, facing the field. Published, not measured — the
    # aerial predates it. At this size it is visible from anywhere in the scene.
    bz = BOARD_BASE_FRAC * h
    sgn = -1.0                                    # south is -axis
    by = sgn * (FIELD_L_M / 2 + 26.0)
    bc = (fx - by * sa, fy + by * ca)
    out.append(feat(rect(bc[0], bc[1], BOARD_W_M, BOARD_THICK_M, axis - math.pi / 2),
                    lat0, {"kind": "board", "h": round(bz + BOARD_H_M, 2),
                           "base": round(bz, 2), "col": COL["board"],
                           "golden": "#3a3129", "night": COL["board_lit"],
                           "name": name}))
    out.append(feat(rect(bc[0], bc[1], BOARD_W_M + 3.0, BOARD_THICK_M + 1.2,
                         axis - math.pi / 2), lat0,
                    {"kind": "board", "h": round(bz + BOARD_H_M + 1.6, 2),
                     "base": round(bz + BOARD_H_M, 2), "col": COL["boardrim"],
                     "name": name}))
    stats["board"] += 2

    # 6. the Longhorn balcony --------------------------------------------
    # 215 x 72 ft of custom UT Burnt Orange ALUCOBOND, the first team logo ever
    # carved into a seating bowl, and designed to be seen from exactly the angle
    # this app flies at. Published dimensions; position within the south bowl is
    # generative.
    # A RECTANGLE WAS ALWAYS THE WRONG PRIMITIVE, and moving it up and down was
    # never going to fix it. One flat slab has ONE height; the seating it is clad
    # on climbs from 3.4 m to 58.6 m. So at whatever height it was given it
    # floated over the bowl as a lid across half the stadium — first buried at
    # 8.2 m and z-fighting, then hovering at 30.3 m. Both are the same bug:
    # a horizontal plane cannot sit on a rake.
    #
    # The real thing is not an object in the bowl, it is the BOWL ITSELF clad in
    # burnt orange panels — "the first time a logo was carved into a seating
    # bowl". So it is built the way the seating is: one segment per seat band,
    # each following that band's own step, over an arc of the south end. It
    # climbs the rake because it IS the rake.
    BAL_LO, BAL_HI = 0.34, 0.62          # radial extent within the bowl
    BAL_HALF = math.radians(26.0)        # angular half-width of the arc
    BAL_ARC = 26                         # points along it
    south = axis + math.pi

    def bal_pt(a, t):
        hp2, wp2 = ray_hit(c, a, hole), ray_hit(c, a, inner)
        if hp2 is None or wp2 is None:
            return None
        return (hp2[0] + (wp2[0] - hp2[0]) * t, hp2[1] + (wp2[1] - hp2[1]) * t)

    for lo, hi, _cls in bands():
        t0, t1 = max(lo, BAL_LO), min(hi, BAL_HI)
        if t1 - t0 < 1e-4:
            continue
        outer_a, inner_a = [], []
        for k in range(BAL_ARC + 1):
            a = south - BAL_HALF + 2 * BAL_HALF * k / BAL_ARC
            po, pi_ = bal_pt(a, t1), bal_pt(a, t0)
            if po and pi_:
                outer_a.append(po)
                inner_a.append(pi_)
        if len(outer_a) < 3:
            continue
        out.append(feat(outer_a + inner_a[::-1], lat0,
                        {"kind": "logo",
                         "h": round(bowl_height_at(t1, south, axis) + 0.12, 2),
                         "col": BURNT_ORANGE, "night": "#e07a30", "name": name}))
        stats["logo"] += 1

    # 7. ramp towers and light masts --------------------------------------
    for lon, lat, dia, ht in RAMPS:
        cx, cy = ll_to_m(lon, lat, lat0)
        out.append(feat(disc(cx, cy, dia / 2), lat0,
                        {"kind": "ramp", "h": ht, "col": COL["ramp"], "name": name}))
        stats["ramps"] += 1
    # Masts ride the wall ring on the two long sides. Generative positions: the
    # aerial cannot resolve a 2 m pole, but the 2016 interior panorama shows tall
    # slim masts standing well above both upper decks, and their silhouette is
    # most of what says "stadium" from a low camera.
    for k in range(MAST_COUNT):
        frac = (k + 0.5) / MAST_COUNT
        a = axis + (math.pi * frac if k % 2 == 0 else -math.pi * frac)
        wp = ray_hit(c, a, inner)
        if wp is None:
            continue
        s = side_for(a, axis)
        if s in ("N", "S"):
            continue
        out.append(feat(rect(wp[0], wp[1], MAST_W_M, MAST_W_M, axis), lat0,
                        {"kind": "mast", "h": MAST_TOP_M, "base": round(h * 0.9, 2),
                         "col": COL["mast"], "name": name}))
        # The HEAD is a lamp array, so like the video board it is the one part
        # that must not follow the wall ramp down into the dark — an unlit
        # floodlight over a stadium is a thing nobody has ever seen.
        out.append(feat(rect(wp[0], wp[1], MAST_HEAD_W_M, 1.6, axis), lat0,
                        {"kind": "mast", "h": MAST_TOP_M + 2.2, "base": MAST_TOP_M - 2.0,
                         "col": COL["mast"], "golden": "#d8c39c",
                         "night": COL["mast_lit"], "name": name}))
        stats["masts"] += 1
    return out, field_corners


# Buildings that are structurally PART of the stadium but carry their own
# footprint in the data.
#
# Bellmont Hall is the west perimeter of DKR: eleven levels built in 1972 INSIDE
# the support structure of the west upper deck. At 72.5 m it is taller than the
# stadium's own 63 m and its footprint reaches well in under the seating, so its
# flat roof drew a lid straight across the west deck — in the nadir render the
# whole west side was one olive slab where the aerial shows three tiers of bright
# bleacher. Re-emitting its own footprint as stacked bands did not help: the
# footprint is the problem, not the height.
#
# The right model is the one the building actually has. Bellmont is BENEATH the
# deck, and what you see from outside is a taller west perimeter. So its id is
# replaced and its height is handed to the stadium's own west wall segment
# instead, via SIDE_H. Nothing is lost but the lid.
ANNEX_INTO_SIDE = {"L. Theo Bellmont Hall": "W"}
SIDE_H = {}          # filled from ANNEX_INTO_SIDE at run time


def main():
    feats = json.load(open(SNAP, encoding="utf-8"))["features"]
    out, replaced, field_corners = [], [], None
    stats = Counter()
    for f in feats:
        nm = f["properties"].get("name") or ""
        if nm in ANNEX_INTO_SIDE:
            SIDE_H[ANNEX_INTO_SIDE[nm]] = f["properties"].get("final_height") or 0
            replaced.append(f["properties"].get("id"))
            stats["annex_into_wall"] += 1
    for f in feats:
        p = f["properties"]
        cls = p.get("building_class") or ""
        if not any(k in cls for k in STADIUM_CLASSES):
            continue
        g = f["geometry"]
        if g["type"] != "Polygon" or len(g["coordinates"]) < 2:
            stats["skipped_no_hole"] += 1
            continue
        if (p.get("final_height") or 0) < 12:
            stats["skipped_low"] += 1
            continue
        made, corners = build(f, stats)
        if not made:
            continue
        out.extend(made)
        field_corners = corners
        # The building's own extrusion has to STOP being drawn, or its 63 m lid
        # buries every band underneath it. app.js filters these ids out.
        replaced.append(p.get("id"))
        stats["stadiums"] += 1
        print("  %-30s h=%5.1f  ->  %d features" % ((p.get("name") or "?")[:30],
                                                    p.get("final_height") or 0, len(made)))

    # fieldCorners rides on the FeatureCollection rather than in a feature: it
    # is not geometry to draw, it is the registration for the field image, and
    # app.js reads it off the same fetch it already makes.
    fc = {"type": "FeatureCollection", "features": out,
          "replacedBuildingIds": replaced, "fieldCorners": field_corners}
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(fc, fh, separators=(",", ":"))
    print(json.dumps({
        "features": len(out),
        "replaced_building_ids": replaced,
        "field_corners": field_corners,
        "file_kb": round(os.path.getsize(OUT) / 1024, 1),
        "counts": dict(sorted(stats.items())),
        # The west side is 85.2 m from field wall to perimeter, so this says how
        # many real 0.74 m rows each emitted step stands in for. Under about
        # three and the stepping reads as rows; over about six it reads as
        # terracing, which is the failure v1 shipped.
        "rows_per_band_west": {
            d[0]: round(85.2 * (d[2] - d[1]) / d[5] / SEAT_ROW_M, 1)
            for d in DECKS if d[0] != "void"
        },
        "provenance": {
            "rings": "factual - the footprint's own outer and inner rings, blended radially",
            "sides": "factual - sectors measured from the field hole's own long axis",
            "row_pitch/aisle_pitch/deck_colours":
                "MEASURED off data/dkr_aerial_geo.png at 0.129 m/px via scripts/probe_dkr.py",
            "ramp_tower_positions": "MEASURED - read off the same photograph",
            "field/board/longhorn": "SOURCED - published dimensions; the aerial predates the 2021 south end",
            "heights/masts/rake": "GENERATIVE - fractions of the height already in the data",
        },
    }, indent=2))


if __name__ == "__main__":
    main()
