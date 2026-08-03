# -*- coding: utf-8 -*-
"""Bake the Texas Capitol Complex — the part of Austin the scene was missing.

THE PROBLEM. scripts/config.sh models 30.276..30.296. Its south edge falls one
block north of the Capitol grounds, so the scene held the BACK of the state
complex (the Bullock, the Bush and Jordan buildings, Travis, Stephen F. Austin)
and then stopped dead in an empty tan plain exactly where the Texas Capitol, its
22 acres of grounds and the Governor's Mansion belong. Worse, the state
buildings that *were* in frame carried Overture heights that read about half
their true size — the 14-storey Bush building was a 24.9 m box — so the complex
had no massing either.

WHAT THIS EMITS  (six files, each merged by js/capitol.js into a layer that
already exists, so nothing here needs its own palette or its own z-order):

  data/capitol.geojson         buildings for the strip south of the old edge,
                               in the snapshot's own schema  -> austin-buildings
  data/capitol_parts.geojson   OSM building:part volumes            -> austin-parts
  data/capitol_dome.geojson    the dome, drum, colonnade, mansard,
                               pavilion caps, Bullock rotunda   -> capitol-dome
  data/capitol_ground.geojson  grounds, the Great Walk, drives      -> austin-ground
  data/capitol_trees.geojson   the grounds' canopy                  -> austin-trees
  data/capitol_overrides.json  height/material fixes for buildings
                               ALREADY in the snapshot

PROVENANCE, in the project's usual terms:

  POSITION   factual, all of it. Every footprint, path, lawn and tree here is
             an OSM way or node from data/osm_cache/capitol_area.json.
  HEIGHT     factual where OSM records `height` or `building:levels`; the
             storey height used to turn levels into metres is generative and
             is stated below. The Capitol's own part heights (35 / 75 / 92)
             are OSM's, and 92 m agrees with the documented 302.6 ft to the top
             of the Goddess of Liberty's star — two independent sources.
  FORM       generative. fill-extrusion has one roof shape (flat), so the dome,
             the drum colonnade, the mansard skirt and the pavilion caps are
             stacked rings, exactly the trick bake_stadium.py uses for the
             seating bowl and bake_roofs.py uses for a hip.
  COLOUR     the Capitol's ROOF is measured — four clean samples off a z20
             nadir tile (#b7b8aa #aaaa9d #b5b6a7 #8d9085) agree on a pale
             grey-green metal, which is worth knowing because the campus roof
             pass would otherwise have put terracotta on it. The Sunset Red
             GRANITE of the walls is generative: a nadir tile shows roofs, not
             walls, and the few vertical strips it does show are either
             shadowed or one pixel wide. Guessing it off those would have been
             a measurement in name only.

Usage:  python scripts/bake_capitol.py [snapshot-date]
"""
import json
import math
import os
import sys
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATE = sys.argv[1] if len(sys.argv) > 1 else "2026-07-30"
CACHE = os.path.join(ROOT, "data", "osm_cache", "capitol_area.json")
NORTH_TAGS = os.path.join(ROOT, "data", "osm_cache", "capitol_north_tags.json")
SNAP = os.path.join(ROOT, "data", "snapshots", DATE, "buildings.detailed.geojson")
HERO = os.path.join(ROOT, "data", "hero_designs.json")
OUT_DIR = os.path.join(ROOT, "data")

M_LAT = 111320.0

# ── The area this pass owns ───────────────────────────────────────────
# North edge overlaps the existing bbox by ~22 m so the two meet without a
# gap; anything in the overlap that the snapshot already has is dropped.
SOUTH, NORTH = 30.2710, 30.2762
WEST, EAST = -97.7520, -97.7260

# ── Storey heights. GENERATIVE, and the one number worth arguing about. ──
# config.sh uses 3.2 m/level, which is a residential figure. State office
# buildings from the 1960s through 2022 run taller floor-to-floor, and 3.2
# leaves the 14-storey Bush building shorter than the 12-storey apartment
# blocks on Nueces. 3.6 for civic/office, 3.2 for everything else.
M_PER_LEVEL = 3.2
M_PER_LEVEL_CIVIC = 3.6
CIVIC = {"government", "public", "office", "civic", "courthouse", "hospital",
         "university", "college", "museum"}

# ── Measured off the aerial ───────────────────────────────────────────
CAP_ROOF = "#a8ab9d"        # pale grey-green standing-seam metal (4 samples)
BULLOCK_ROOF = "#98948a"    # the rotunda's copper, weathered, from above

# ── Materials. GENERATIVE where noted. ────────────────────────────────
GRANITE = "#bd8477"         # Sunset Red granite, Granite Mountain. Generative.
# THE DOME IS THE SAME STONE AS THE WALLS AND IT HAS TO READ THAT WAY.
# "the thing on the top of capitol buildings ... its not the right color."
#
# The previous value (#d2b0a3) was sampled off a z18/z20 NADIR tile, which sees
# the dome's sky-facing paint and cannot see a wall at all, so it could only
# ever answer half the question — and the half it could not see is the half the
# complaint is about. Two elevation photographs answer both halves, and the
# flat-overcast one is the honest instrument because the dome and the wall are
# lit the same in it:
#
#   ref_south.jpg (overcast)  dome #b89f8e #a28c7a   wall #857361 #987f66 #947f6a
#                             dome / wall = 1.20  1.21  1.30
#   ref_oblique.jpg (sunny)   the dome clips at 251+, so it is useless for a
#                             ratio — but it settles the HUE: one warm pink
#                             granite from the plinth to the lantern, no cream
#                             cap anywhere on the building.
#
# So: ~20 % lighter than the wall, same hue. A white lerp is the right operator
# because the measured ratio is largest in BLUE — it is a slight desaturation,
# not a hue shift.
DOME_LIFT = 0.22            # taste. 0 = literally the same stone as the wall.
GRANITE_DOME = "#cb9f95"    # lerp(GRANITE, #ffffff, DOME_LIFT); ratio 1.08/1.21/1.25
GRANITE_ATTIC = "#b57f71"   # the square attic block under the drum, a shade down
# The Goddess of Liberty is painted WHITE and she is the one bright point at
# the top of the whole silhouette. She goes through DOME_MATCH like everything
# else in this layer — a statue has no windows either — so her base value is
# lifted to land pale rather than putty after it.
GODDESS = "#f4efe2"
STAR = "#f8f0d8"
LIMESTONE = "#ddd2b8"       # Texas limestone: the mid-century state buildings
LIMESTONE_C = "#cfc4a8"     # a cooler cut, for variety between neighbours
MODERN_STONE = "#d8d4c6"    # Bush / Jordan, 2022: pale stone and glass
MANSION_WHITE = "#eae6dc"   # the Governor's Mansion, painted wood

# Curated per-landmark materials. Keys are normalised names. Each entry is the
# same shape hero_designs.json uses, so the colour maths below is shared with
# scripts/bake_detail.py rather than reinvented.
CURATED = {
    "texas state capitol":              {"wall": GRANITE, "roof": CAP_ROOF},
    "governor's mansion":               {"wall": MANSION_WHITE, "roof": "#8a8d80"},
    "governor's carriage house":        {"wall": MANSION_WHITE, "roof": "#8a8d80"},
    # Names are OSM's, verified against the cache — not the names the buildings
    # are colloquially given. "Lorenzo de Zavala State Archive and Library" and
    # "State Insurance Building" both missed on the first pass because the
    # obvious spelling was wrong.
    "texas supreme court building":     {"wall": LIMESTONE, "roof": "#9a9483"},
    "tom c. clark building":            {"wall": LIMESTONE, "roof": "#9a9483"},
    "lorenzo de zavala state archive and library":
                                        {"wall": LIMESTONE, "roof": "#9a9483"},
    "sam houston building":             {"wall": LIMESTONE, "roof": "#9a9483"},
    "thomas jefferson rusk building":   {"wall": LIMESTONE, "roof": "#9a9483"},
    "state insurance building":         {"wall": LIMESTONE, "roof": "#9a9483"},
    "state insurance building annex":   {"wall": LIMESTONE, "roof": "#9a9483"},
    "dewitt c. greer building":         {"wall": LIMESTONE_C, "roof": "#948e7d"},
    "ernest o. thompson building":      {"wall": LIMESTONE_C, "roof": "#948e7d"},
    "james earl rudder building":       {"wall": LIMESTONE, "roof": "#9a9483"},
    "texas workforce commission":       {"wall": LIMESTONE_C, "roof": "#948e7d"},
    "texas workforce commission annex": {"wall": LIMESTONE_C, "roof": "#948e7d"},
    "capitol extention":                {"wall": LIMESTONE, "roof": "#b0a992"},
    # The 1857 General Land Office: rough-cut stone, Norman Revival, and the
    # oldest state office building in Texas. Not granite, not limestone-smooth.
    "capitol complex visitor center":   {"wall": "#c4ac8b", "roof": "#8f6a52"},
    "old bakery and emporium":          {"wall": "#a9705a", "roof": "#7d6350"},
    "1876 jeremiah hamilton building":  {"wall": "#a9705a", "roof": "#7d6350"},
    "heman marion sweatt travis county courthouse":
                                        {"wall": LIMESTONE_C, "roof": "#948e7d"},
    "ned granger travis county admin building":
                                        {"wall": LIMESTONE_C, "roof": "#948e7d"},
    "blackwell thurman criminal justice center":
                                        {"wall": LIMESTONE_C, "roof": "#948e7d"},
}

# The window the overrides pass is allowed to touch: the Capitol Complex north
# of the old bbox edge, and nothing else. The first cut had no box and matched
# any snapshot building whose name OSM also knew, which quietly raised Dobie
# Twenty21 from its curated 82 m hero height to 99.2 m and The Linden to 89.6 —
# a West Campus edit made by a pass that has no business there.
COMPLEX_BOX = (-97.7445, 30.2758, -97.7345, 30.2812)

# The same table, for buildings ALREADY in the snapshot (the overrides pass).
# Membership here is also the PERMISSION to override: nothing outside this list
# is touched, so the pass cannot have collateral effects on the rest of the city.
CURATED_NORTH = {
    "texas state history museum":       {"wall": "#d9cdb2", "roof": BULLOCK_ROOF},
    "george h.w. bush state office building":  {"wall": MODERN_STONE, "roof": "#7d7f84"},
    "barbara jordan state office building":    {"wall": MODERN_STONE, "roof": "#c8c8b8"},
    "william b. travis building":       {"wall": LIMESTONE, "roof": "#9a9483"},
    "stephen f. austin state office building": {"wall": LIMESTONE_C, "roof": "#948e7d"},
    "lyndon b. johnson building":       {"wall": LIMESTONE, "roof": "#9a9483"},
    "john h. reagan building":          {"wall": LIMESTONE, "roof": "#9a9483"},
    "robert e. johnson state legislative office building":
                                        {"wall": LIMESTONE_C, "roof": "#948e7d"},
    "william p. clements, jr. building": {"wall": LIMESTONE, "roof": "#9a9483"},
    "daniel price sr. state office building": {"wall": LIMESTONE, "roof": "#9a9483"},
    "texas law center":                 {"wall": LIMESTONE_C, "roof": "#948e7d"},
    "employees retirement system of texas": {"wall": LIMESTONE, "roof": "#9a9483"},
}

# OSM building=* -> the class vocabulary hero_designs.json already keys on.
CLASS_MAP = {
    "government": "public", "public": "public", "civic": "public",
    "office": "office", "commercial": "commercial", "retail": "retail",
    "apartments": "apartments", "residential": "residential",
    "house": "house", "detached": "detached", "dormitory": "dormitory",
    "hotel": "commercial", "church": "church", "chapel": "church",
    "cathedral": "church", "parking": "parking", "garage": "parking",
    "garages": "parking", "school": "school", "university": "university",
    "college": "college", "hospital": "public", "museum": "public",
    "roof": "roof", "shed": "shed", "greenhouse": "greenhouse",
    "industrial": "commercial", "warehouse": "commercial",
    "service": "shed", "construction": "shed", "yes": None,
}

# ── Ground vocabulary. Copied, deliberately, from scripts/bake_ground.py ──
# Copied rather than imported: bake_ground.py owns the campus ground pass and
# is edited independently, and an import would make this bake fail whenever
# that file is mid-edit. The tables are small and the duplication is stated.
SURFACE_MAP = {
    "concrete": "concrete", "concrete:plates": "concrete", "concrete:lanes": "concrete",
    "paved": "paving", "paving_stones": "paving", "sett": "paving",
    "cobblestone": "paving", "unhewn_cobblestone": "paving",
    "brick": "brick", "bricks": "brick", "paving_stones:brick": "brick",
    "asphalt": "asphalt", "chipseal": "asphalt",
    "grass": "grass", "grass_paver": "grass", "ground": "dirt", "dirt": "dirt",
    "earth": "dirt", "mud": "dirt", "unpaved": "gravel", "compacted": "gravel",
    "gravel": "gravel", "fine_gravel": "gravel", "pebblestone": "gravel",
    "sand": "sand", "wood": "wood", "metal": "concrete",
    "limestone": "limestone", "stone": "limestone", "rock": "limestone",
    "artificial_turf": "turf", "synthetic": "turf",
}
DEFAULT_SURFACE = {
    "footway": "concrete", "steps": "concrete", "path": "gravel",
    "pedestrian": "paving", "plaza": "paving", "lawn": "grass", "park": "grass",
    "garden": "grass", "wood": "wood", "scrub": "grass", "pitch": "grass",
    "parking": "asphalt", "water": "water", "fountain": "water",
    "service": "asphalt", "construction": "dirt", "playground": "sand",
}
DEFAULT_WIDTH = {"footway": 2.4, "steps": 3.0, "path": 1.5,
                 "pedestrian": 6.0, "service": 5.0}
AREA_USE = {
    "grass": "lawn", "meadow": "lawn", "village_green": "lawn",
    "recreation_ground": "lawn", "grassland": "lawn", "forest": "wood",
    "wood": "wood", "scrub": "scrub", "park": "park", "garden": "garden",
    "pitch": "pitch", "playground": "playground", "common": "lawn",
    "water": "water", "basin": "water", "fountain": "fountain",
    "parking": "parking", "construction": "construction", "sand": "sand",
}
NOT_GROUND = {"stadium", "sports_centre", "grandstand", "pavilion", "building"}

# ── The walks. WIDTH LIVES IN THE GEOMETRY, and this bake was left behind ──
#
# THIS IS WHERE THE CAPITOL'S WALKWAYS WENT, and it was not the rank ladder
# (PR #78) and not the precinct lawns (PR #93). Both were suspected; neither
# ever reads this file.
#
# On 2026-08-02, `Speedway fanned out because a line-width is pixels and the
# ground is not` changed the contract for every walk in the city. A MapLibre
# `line-width` is a number of SCREEN PIXELS and it is the same number for the
# whole line, so a path drawn as a line fans out under perspective —
# scripts/verify/road-fan.mjs measured 3.69x at pitch 86. bake_ground.py was
# changed to buffer each centreline by half its real width and emit
# `k:'patharea'` POLYGONS, and js/ground.js dropped every `k == 'path'` filter
# in the same pass.
#
# bake_capitol.py was not changed with it, and nothing failed loudly, because
# a source feature that no layer's filter matches is not an error. Measured on
# merged main: `data/ground.geojson` holds 0 features with `k:'path'`;
# `data/capitol_ground.geojson` holds 1,480, and js/ground.js has 0 layers that
# would draw one. The lawns survived only because they are `k:'area'`, which
# still has a layer — which is exactly the shape of the complaint: the grass is
# there and the walks are gone.
#
# The buffer below is copied from bake_ground.widen_paths rather than imported,
# for the reason given at the head of the ground vocabulary above.
PATH_SIMPLIFY_M = 0.15      # post-union tolerance; well under a pixel
PATH_MIN_AREA_M2 = 1.0      # drop slivers the union leaves behind
# One square metre of ground belongs to exactly one drawn surface (PR #78's
# rule, applied here to this file's own features, which that pass never sees).
# Copied from bake_ground.RANK and extended by ONE entry: `service`. On this
# campus bake_ground never meets a service way as a path — it is a road there —
# but on the Capitol grounds the service ways ARE the carriage drives, 5 m of
# asphalt looping the building, and they are the most legible thing in the
# aerial after the Great Walk. They sit above the footways for the same reason
# bake_ground puts the carriageway on top ("a sidewalk does not lie on a road")
# and below the pedestrian plazas, so the Great Walk keeps the ground where it
# crosses the drive at the south steps.
PATH_RANK = {"steps": 64, "pedestrian": 60, "service": 58, "path": 56,
             "footway": 52}
PATH_RANK_DEFAULT = 1

# ── The Capitol, by OSM id ────────────────────────────────────────────
CAPITOL_WAY = 25758443
# Its dome, from the same OSM relation. The drum carries roof:shape=dome and
# height=75; the lantern above it carries height=92. 92 m is 302 ft — the
# documented 302.64 ft to the tip of the Goddess of Liberty's star, arrived at
# from a completely different direction. Two sources agreeing is the reason
# this profile is trusted rather than invented.
DRUM_PART = 516187625
LANTERN_PART = 1364720761
# Levels along the profile, metres above ground.
# The 57 m between the cornice and the star, divided. The first cut gave the
# drum 11 m and the dome 23 m, and the silhouette came back a cone: a dome
# twice as tall as the drum it stands on cannot read as a dome. The colonnaded
# drum is the tallest single element of the real thing, and the dome above it
# rises about one radius.
Z_MAIN_ROOF = 35.0       # the central block's cornice; OSM part height
Z_COLLAR_TOP = 37.6      # top of the LOW hipped roof where the four arms cross
Z_ATTIC_TOP = 42.0       # top of the square granite attic the drum stands on
Z_DRUM_TOP = 60.0        # springing of the dome; top of the colonnade
Z_DOME_TOP = 75.0        # OSM height on the drum part
Z_LANTERN_TOP = 83.0
Z_CUPOLA_TOP = 88.0
Z_STATUE_TOP = 92.24     # 302.64 ft
DOME_STEPS = 18
COLUMNS = 24

# THE DOME WAS STANDING ON A SEVEN-METRE STEPPED PYRAMID AND THE REAL ONE IS
# NOT. "the thing on the top of capitol buildings looks like its angled."
#
# Measured first: the dome's axis is NOT leaning. Every disc in
# data/capitol_dome.geojson is coaxial to within 0.27 m — under a quarter of a
# pixel at any zoom this app flies — and the isolated layer, magenta, at frame
# centre, reads an axis drift of 0.0 px over the whole 57 m stack at bearing 0
# and 90. So "angled" is not a rotation and not an offset: it is a SLOPE that
# should not be there.
#
# What is actually between the roof and the drum, from ref_oblique.jpg and
# ref_south.jpg: a LOW hipped roof over the crossing of the four arms, and then
# a SQUARE GRANITE ATTIC WITH VERTICAL WALLS carrying the six seals and the
# south pediment, and the drum rises straight out of that. The old
# `SKIRT_STEPS`/`SKIRT_HALF` mansard — 9 steps, 44 m across at the base,
# resolving a square into a circle as it climbed — is a 7 m tall cone wrapped
# round the drum, and from anywhere south of the building it is the single
# biggest thing on the roof. Nothing in either photograph has that shape.
#
# The aerial is not in conflict with this: the four pale hips radiating from
# the dome base in data/capitol_aerial.png ARE a pitched roof, but they sit at
# roof level and they are shallow. That is COLLAR_STEPS, 2.6 m of it.
COLLAR_STEPS = 3
COLLAR_HALF = 22.0       # the crossing's roof mass, off the aerial
ATTIC_HALF = 15.4        # 30.7 m across in ref_oblique.jpg, scaled on the
                         # building's own 167.7 m footprint width

# THE DOME MUST NOT OVERHANG ITS OWN DRUM. It sprang at 0.98 of the drum
# radius, which is 30.0 m across against a colonnade 29.7 m across — a dome
# fractionally WIDER than the thing holding it up, which is what makes a stack
# of discs read as top-heavy. In ref_oblique.jpg the springing is 24.6 m across
# against a 26.5 m colonnade: it is set back inside, with the attic ring
# visible between them.
DOME_SPRING = 0.82

# AND THE DRUM ITSELF IS TOO WIDE, which is what made the dome look like a cone
# sitting inside a hat. `dR` is the mean vertex radius of OSM's drum PART, and
# that part is the whole rotunda footprint, not the colonnade. Scaled on the
# building's own 167.7 m footprint width, ref_oblique.jpg puts the colonnade at
# 26.5 m across and the springing at 24.6 m — a dome 0.93 of the colonnade.
# Unscaled this bake draws 29.7 m and 25.1 m, i.e. 0.84, and the cornice at
# dR*1.05 came out 32.2 m, WIDER than the 30.7 m attic block underneath it.
DRUM_SCALE = 0.87
# The dome's profile, as a fraction of the drum radius:
#   r(t) = R · (DOME_SHOULDER + (1 − DOME_SHOULDER) · cos(t·π/2)^DOME_POWER)
# DOME_SHOULDER is the reason this is not a spike. The first cut tapered to
# r ≈ 0.09 R and then sat a WIDER lantern on top of it, so the silhouette
# pinched to a point and flared again — it read as a rocket. A real dome stops
# at a shoulder that the lantern then stands on.
DOME_SHOULDER = 0.30
DOME_POWER = 0.85


# ══════════════════════════════════════════════════════════ colour utils ══
# Same formulas as scripts/bake_detail.py, so a building baked here is
# indistinguishable in style from one baked there.
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


def adjust_light(h, dl):
    import colorsys
    r, g, b = (v / 255 for v in hex_to_rgb(h))
    hh, ll, ss = colorsys.rgb_to_hls(r, g, b)
    ll = max(0.05, min(0.95, ll + dl))
    r, g, b = colorsys.hls_to_rgb(hh, ll, ss)
    return rgb_to_hex(r * 255, g * 255, b * 255)


def stable01(key):
    import hashlib
    return int(hashlib.md5(key.encode()).hexdigest()[:8], 16) / 0xFFFFFFFF


GOLDEN_TINT = "#ffb26a"


def night_wall(day_hex):
    r, g, b = hex_to_rgb(day_hex)
    dark = (r * 0.24, g * 0.24, b * 0.24)
    cool = (17, 22, 42)
    return rgb_to_hex(*(dark[i] + (cool[i] - dark[i]) * 0.5 for i in range(3)))


def wall_tod(day_hex):
    return day_hex, lerp_hex(day_hex, GOLDEN_TINT, 0.16), night_wall(day_hex)


def roof_tod(roof_hex):
    return (roof_hex,
            lerp_hex(roof_hex, GOLDEN_TINT, 0.22),
            lerp_hex(adjust_light(roof_hex, -0.38), "#10152a", 0.6))


def colours(wall, roof):
    wd, wg, wn = wall_tod(wall)
    rd, rg, rn = roof_tod(roof)
    return dict(wd=wd, wg=wg, wn=wn, rd=rd, rg=rg, rn=rn)


# THE DOME LAYER SKIPS THE WINDOW ATLAS AND THE WALLS DO NOT. That one fact is
# why the Capitol reads as a pale pink cap on a dark brown building while BOTH
# carry the identical protected hex #bd8477 in the data — so "is FACADE_PROTECTED
# still honoured" (it is; palette[0] is #bd8477 and the Capitol is stamped to it)
# and "is the Capitol the right colour" are different questions, and answering
# the first one yes is what hid the second for a week.
#
# `buildings-3d` multiplies the wall by the facade atlas; `capitol-dome` paints
# `wd` flat. Measured in ONE frame, one light, at tod 0.30, with each surface
# masked by repainting it green and reading the clean frame underneath:
#
#     Capitol walls   #815744        dome  #b5846a
#     dome / wall      1.403  1.517  1.559
#     ref_south.jpg    1.20   1.21   1.30       <- what it should be
#
# So every colour in the dome layer has to carry the atlas's mean darkening
# itself: 1.20 / (1.403, 1.517, 1.559). This is not a fudge — the atlas stands
# in for punched openings and shadow lines, the dome genuinely has far fewer of
# them, and the photograph is what says how much fewer.
#
# It is ONE triple on purpose. If the atlas ever changes, this is the single
# number to re-measure, and scripts/verify/... re-measures it on demand.
DOME_MATCH = (0.855, 0.791, 0.770)


def atlas_match(h):
    """A dome-layer colour, brought down to where the atlas puts a wall."""
    r, g, b = hex_to_rgb(h)
    return rgb_to_hex(r * DOME_MATCH[0], g * DOME_MATCH[1], b * DOME_MATCH[2])


def norm_name(s):
    s = (s or "").casefold().strip()
    for ch in ".,–—-":
        s = s.replace(ch, " ")
    s = " ".join(s.split())
    if s.startswith("the "):
        s = s[4:]
    if s.endswith(" austin"):
        s = s[:-7]
    return s


# ═══════════════════════════════════════════════════════════════ geometry ══
def to_m(ring, lat0):
    k = math.cos(math.radians(lat0))
    return [(p[0] * M_LAT * k, p[1] * M_LAT) for p in ring]


def to_ll(pts, lat0):
    k = math.cos(math.radians(lat0))
    return [[round(x / (M_LAT * k), 7), round(y / M_LAT, 7)] for (x, y) in pts]


def ring_of(el):
    """[(lon,lat)] for a way; [] for anything without its own geometry."""
    g = el.get("geometry")
    if not g:
        return []
    return [(p["lon"], p["lat"]) for p in g if p and "lon" in p]


def relation_rings(el):
    """Outer rings of a multipolygon relation, stitched from its members.

    `out geom` gives each member way's points but not a closed ring, so the
    outer members have to be walked end-to-end. Members whose ends don't meet
    are dropped rather than force-closed — a half-stitched ring is a garbage
    footprint, and a missing one is at least honest.
    """
    outers = [[(p["lon"], p["lat"]) for p in m.get("geometry") or [] if p]
              for m in el.get("members", []) if m.get("role") in ("outer", "")]
    outers = [o for o in outers if len(o) >= 2]
    rings, pool = [], list(outers)
    while pool:
        chain = pool.pop(0)
        changed = True
        while changed and chain[0] != chain[-1]:
            changed = False
            for i, seg in enumerate(pool):
                if seg[0] == chain[-1]:
                    chain = chain + seg[1:]
                elif seg[-1] == chain[-1]:
                    chain = chain + seg[::-1][1:]
                elif seg[-1] == chain[0]:
                    chain = seg[:-1] + chain
                elif seg[0] == chain[0]:
                    chain = seg[::-1][:-1] + chain
                else:
                    continue
                pool.pop(i)
                changed = True
                break
        if chain[0] == chain[-1] and len(chain) >= 4:
            rings.append(chain)
    return rings


def centroid(ring):
    return (sum(p[0] for p in ring) / len(ring),
            sum(p[1] for p in ring) / len(ring))


def area_m2(ring):
    a = 0.0
    for i in range(len(ring) - 1):
        a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
    k = math.cos(math.radians(sum(p[1] for p in ring) / len(ring)))
    return abs(a) / 2 * (M_LAT ** 2) * k


def closed(ring):
    return ring if ring and ring[0] == ring[-1] else ring + [ring[0]]


def circle(cx_m, cy_m, r, lat0, n=40):
    pts = [(cx_m + r * math.cos(2 * math.pi * i / n),
            cy_m + r * math.sin(2 * math.pi * i / n)) for i in range(n)]
    return to_ll(pts + [pts[0]], lat0)


def square(cx_m, cy_m, half, lat0, rot=0.0):
    pts = []
    for i in range(4):
        a = rot + math.pi / 4 + i * math.pi / 2
        pts.append((cx_m + half * math.sqrt(2) * math.cos(a),
                    cy_m + half * math.sqrt(2) * math.sin(a)))
    return to_ll(pts + [pts[0]], lat0)


def shrink_ring(ring_ll, frac, lat0):
    """Scale a ring toward its own centroid. Used for the stepped caps —
    an inset is what makes a stack of prisms read as a pitch (bake_roofs.py)."""
    m = to_m(ring_ll, lat0)
    cx = sum(p[0] for p in m) / len(m)
    cy = sum(p[1] for p in m) / len(m)
    return to_ll([(cx + (x - cx) * frac, cy + (y - cy) * frac) for x, y in m], lat0)


def ring_centre_radius(ring_ll):
    lat0 = sum(p[1] for p in ring_ll) / len(ring_ll)
    m = to_m(ring_ll, lat0)
    cx = sum(p[0] for p in m) / len(m)
    cy = sum(p[1] for p in m) / len(m)
    r = sum(math.hypot(x - cx, y - cy) for x, y in m) / len(m)
    return cx, cy, r, lat0


# ─────────────────────────────────────────────────────── walks → polygons ──
GROUNDS_LAT0 = 30.2747        # the Capitol's own latitude; the metric anchor


def widen_paths(feats, stats, warnings):
    """`k:'path'` LineStrings -> unioned, disjoint `k:'patharea'` Polygons.

    ONE metric frame for the whole function. HANDOFF §32 records the trap:
    1e-6 deg is 0.096 m east-west and 0.111 m north-south here, so nothing may
    be buffered, unioned or area-tested in degrees.

    Union per (use, surface) is NOT an optimisation. `ground-paths` draws at
    `pathOpacity` 0.92 and two overlapping translucent polygons in one layer
    composite twice, so every junction where two walks meet would show as a
    darker patch. Union dissolves it inside a group; PATH_RANK dissolves it
    between groups.
    """
    try:
        from shapely.geometry import LineString
        from shapely.ops import unary_union
    except ImportError:
        warnings.append("shapely not installed: the Capitol's walks stay "
                        "LineStrings, which NO layer in js/ground.js draws")
        return feats

    mlat = M_LAT
    mlon = mlat * math.cos(math.radians(GROUNDS_LAT0))
    fwd = lambda cs: [((x + 97.74) * mlon, (y - GROUNDS_LAT0) * mlat) for x, y in cs]
    inv = lambda cs: [[round(x / mlon - 97.74, 7), round(y / mlat + GROUNDS_LAT0, 7)]
                      for x, y in cs]

    kept, groups = [], {}
    for f in feats:
        p = f["properties"]
        if p.get("k") != "path" or f["geometry"]["type"] != "LineString":
            kept.append(f)
            continue
        cs = f["geometry"]["coordinates"]
        if len(cs) < 2:
            continue
        w = float(p.get("w") or 2.0)
        # Mitre joins and flat caps: a round join on a 2 m footpath adds a dozen
        # vertices per corner to draw a curve nobody can see at 200 m.
        poly = LineString(fwd(cs)).buffer(w / 2.0, cap_style=2, join_style=2,
                                          mitre_limit=2.0)
        if poly.is_empty:
            continue
        groups.setdefault((p.get("u"), p.get("s")), []).append(poly)
        stats["path_widened"] += 1

    # Highest rank first, and each group gives up whatever a higher one already
    # took. Ties inside a rank fall back to the sorted key, so the result cannot
    # depend on dict order.
    order = sorted(groups.items(),
                   key=lambda kv: (-PATH_RANK.get(kv[0][0], PATH_RANK_DEFAULT),
                                   str(kv[0])))
    taken = None
    for (use, surf), polys in order:
        merged = unary_union(polys)
        if taken is not None:
            before = merged.area
            merged = merged.difference(taken)
            stats["patharea_m2_yielded"] += int(round(before - merged.area))
        if merged.is_empty:
            stats["patharea_group_emptied"] += 1
            continue
        taken = merged if taken is None else unary_union([taken, merged])
        if PATH_SIMPLIFY_M:
            merged = merged.simplify(PATH_SIMPLIFY_M)
        parts = merged.geoms if merged.geom_type == "MultiPolygon" else [merged]
        for gm in parts:
            if gm.is_empty or gm.geom_type != "Polygon" or gm.area < PATH_MIN_AREA_M2:
                stats["path_sliver_dropped"] += 1
                continue
            rings = [inv(list(gm.exterior.coords))]
            rings += [inv(list(r.coords)) for r in gm.interiors]
            kept.append({"type": "Feature",
                         "geometry": {"type": "Polygon", "coordinates": rings},
                         "properties": {"k": "patharea", "u": use, "s": surf}})
            stats["patharea_" + str(use)] += 1
    return kept


# ═════════════════════════════════════════════════════════════════ inputs ══
def load(p, default=None):
    if not os.path.exists(p):
        print("  [skip] %s not found" % os.path.relpath(p, ROOT))
        return default
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def main():
    osm = load(CACHE)
    if not osm:
        sys.exit("run scripts/fetch_capitol.py first")
    els = osm["elements"]
    by_id = {(e["type"], e["id"]): e for e in els}
    snap = load(SNAP, {"features": []})
    heroes = load(HERO, {"classes": {}})
    classes = heroes.get("classes", {})
    stats = Counter()
    warn = []

    # ---- what the snapshot already has, so the overlap band isn't doubled --
    snap_pts = []
    for f in snap["features"]:
        g = f["geometry"]
        cs = g["coordinates"]
        while isinstance(cs[0][0], list):
            cs = cs[0]
        snap_pts.append((sum(p[0] for p in cs) / len(cs),
                         sum(p[1] for p in cs) / len(cs), f))

    def snapshot_has(pt):
        for x, y, _ in snap_pts:
            if abs(x - pt[0]) < 1.6e-4 and abs(y - pt[1]) < 1.4e-4:
                return True
        return False

    # ══════════════════════════════════════════════════ 1. buildings ══
    # Normalise the curated keys the same way the OSM names are normalised, or
    # every key with a full stop in it ("dewitt c. greer building") silently
    # misses and the landmark falls through to a class palette.
    curated_south = {norm_name(k): v for k, v in CURATED.items()}
    buildings, parts_out = [], []
    capitol_ring = None
    for e in els:
        t = e.get("tags") or {}
        if "building" not in t:
            continue
        if e["type"] == "relation":
            rings = relation_rings(e)
            if not rings:
                stats["relation_unstitched"] += 1
                continue
        else:
            r = ring_of(e)
            if len(r) < 4:
                continue
            rings = [closed(r)]
        outer = rings[0]
        c = centroid(outer)
        if not (SOUTH <= c[1] <= NORTH and WEST <= c[0] <= EAST):
            continue
        if snapshot_has(c):
            stats["dropped_already_in_snapshot"] += 1
            continue
        a = area_m2(outer)
        if a < 18:
            stats["dropped_tiny"] += 1
            continue

        name = t.get("name")
        nn = norm_name(name)
        btype = (t.get("building") or "yes").lower()
        cls = CLASS_MAP.get(btype)
        civic = btype in CIVIC or "state office" in nn or "county" in nn

        # -- height ladder: OSM height > OSM levels > class default ----------
        h, src = None, None
        try:
            if t.get("height"):
                h = float(str(t["height"]).replace("m", "").strip())
                src = "osm_height"
        except ValueError:
            warn.append("unparsable height %r on %s" % (t.get("height"), name))
        if h is None and t.get("building:levels"):
            try:
                lv = float(t["building:levels"])
                h = lv * (M_PER_LEVEL_CIVIC if civic else M_PER_LEVEL)
                src = "osm_levels"
            except ValueError:
                pass
        if h is None:
            # Nothing recorded. Footprint area is the only signal left, and a
            # default is a default — it is counted and reported, not hidden.
            h = 4.5 if a < 150 else (7.5 if a < 600 else 11.0)
            src = "default_by_area"
        stats["h_" + src] += 1

        if e["id"] == CAPITOL_WAY:
            capitol_ring = outer

        cur = curated_south.get(nn)
        if cur:
            col = colours(cur["wall"], cur["roof"])
            stats["curated"] += 1
        else:
            cd = classes.get(cls or "default") or classes.get("default") or {}
            pals = cd.get("palettes") or [{"wall": "#d8c09a", "roof": "#a08868"}]
            key = "osm:%s%d" % (e["type"][0], e["id"])
            pal = pals[int(stable01(key + ":v") * len(pals)) % len(pals)]
            jitter = (stable01(key) - 0.5) * 0.14
            wall = adjust_light(pal["wall"], jitter)
            roof = adjust_light(pal.get("roof") or adjust_light(wall, -0.12),
                                jitter * 0.6)
            col = colours(wall, roof)
            stats["class_palette"] += 1

        props = {
            "id": "osm:%s%d" % (e["type"][0], e["id"]),
            "name": name, "num_floors": None, "building_class": cls,
            "final_height": round(h, 1), "source_height": src,
        }
        props.update(col)
        if e["id"] == CAPITOL_WAY:
            # Its own parts carry the massing; the base prism would be a
            # 35 m block swallowing the wings.
            props["has_parts"] = 1
        geom = ({"type": "Polygon", "coordinates": [outer]} if len(rings) == 1
                else {"type": "MultiPolygon",
                      "coordinates": [[r] for r in rings]})
        buildings.append({"type": "Feature", "geometry": geom, "properties": props})
        stats["buildings"] += 1

    # ══════════════════════════════════════ 2. the Capitol's own parts ══
    if capitol_ring is None:
        sys.exit("the Texas Capitol (way %d) is not in the cache" % CAPITOL_WAY)
    cxs = [p[0] for p in capitol_ring]
    cys = [p[1] for p in capitol_ring]
    cap_box = (min(cxs), min(cys), max(cxs), max(cys))
    granite = colours(GRANITE, CAP_ROOF)
    # Same reasoning as the dome: the whole building is floodlit, so its walls
    # keep their colour after dark instead of dropping to the city's night wall.
    granite["wn"] = adjust_light(lerp_hex(GRANITE, "#ffcf94", 0.5), -0.10)
    granite["rn"] = adjust_light(lerp_hex(CAP_ROOF, "#ffcf94", 0.45), -0.12)
    pavilion_caps = []
    for e in els:
        t = e.get("tags") or {}
        if not t.get("building:part"):
            continue
        r = ring_of(e)
        if len(r) < 4:
            continue
        r = closed(r)
        c = centroid(r)
        if not (cap_box[0] - 2e-4 < c[0] < cap_box[2] + 2e-4
                and cap_box[1] - 2e-4 < c[1] < cap_box[3] + 2e-4):
            continue
        if e["id"] in (DRUM_PART, LANTERN_PART):
            continue          # replaced by the dome stack below
        try:
            h = float(t.get("height"))
        except (TypeError, ValueError):
            continue
        p = {"h": round(h, 1), "base": 0.0}
        p.update(granite)
        parts_out.append({"type": "Feature",
                          "geometry": {"type": "Polygon", "coordinates": [r]},
                          "properties": p})
        stats["capitol_parts"] += 1
        # The four corner pavilions (h=32) carry a hipped metal roof in the
        # aerial. OSM tags them roof:shape=onion; the photograph wins.
        if abs(h - 32.0) < 0.6 and 350 < area_m2(r) < 700:
            pavilion_caps.append((r, h))

    # ══════════════════════════════════════════════════════ 3. the dome ══
    dome = []

    def emit(ring_ll, base, top, wall, roof, tag):
        # atlas_match, not the raw tone: every feature in this list ends up in
        # `capitol-dome`, the one extrusion layer in the scene with no facade
        # pattern over it. See DOME_MATCH.
        c = colours(atlas_match(wall), atlas_match(roof))
        # The Capitol is floodlit every night of the year, and a dome that goes
        # dark with the rest of the city is the one thing that would read as
        # wrong to anyone who has driven past it. night_wall() is right for a
        # building; it is not right for this one, so the dome's night colour is
        # the day granite pushed toward the floodlights instead of away.
        c["wn"] = adjust_light(lerp_hex(wall, "#ffcf94", 0.5), -0.10)
        c["rn"] = adjust_light(lerp_hex(roof, "#ffcf94", 0.45), -0.12)
        c.update(h=round(top, 2), base=round(base, 2), part=tag)
        dome.append({"type": "Feature",
                     "geometry": {"type": "Polygon", "coordinates": [ring_ll]},
                     "properties": c})

    drum = by_id.get(("way", DRUM_PART))
    dcx, dcy, dR, lat0 = ring_centre_radius(closed(ring_of(drum)))

    # -- the roof collar: a LOW hipped mass where the four arms cross -------
    # Roof metal, not granite: in the aerial these planes are the same
    # standing-seam sheet as the wings' roofs, and they are continuous with
    # them. The square's CORNERS point NE/NW/SE/SW into the four re-entrant
    # angles of the cross plan, which is what puts the hips on the diagonals.
    for i in range(COLLAR_STEPS):
        t0, t1 = i / COLLAR_STEPS, (i + 1) / COLLAR_STEPS
        z0 = Z_MAIN_ROOF + (Z_COLLAR_TOP - Z_MAIN_ROOF) * t0
        z1 = Z_MAIN_ROOF + (Z_COLLAR_TOP - Z_MAIN_ROOF) * t1
        half = COLLAR_HALF + (ATTIC_HALF - COLLAR_HALF) * t0
        emit(square(dcx, dcy, half, lat0), z0, z1, CAP_ROOF, CAP_ROOF, "collar")

    # -- the attic: a square granite block with VERTICAL walls --------------
    # This is the band with the six seals and the south pediment. One prism,
    # one height, no taper — the whole point of it is that it does not slope.
    emit(square(dcx, dcy, ATTIC_HALF, lat0), Z_COLLAR_TOP, Z_ATTIC_TOP,
         GRANITE_ATTIC, GRANITE_ATTIC, "attic")

    # -- drum: a cylinder, ringed by its colonnade ------------------------
    # The colonnade is the detail that makes this the Texas Capitol rather than
    # a generic dome, so the columns stand proud of the wall behind them and
    # are wide enough to survive being 500 m from the camera.
    emit(circle(dcx, dcy, dR * DRUM_SCALE * 0.86, lat0), Z_ATTIC_TOP, Z_DRUM_TOP,
         GRANITE, CAP_ROOF, "drum")
    for i in range(COLUMNS):
        a = 2 * math.pi * i / COLUMNS
        px = dcx + dR * DRUM_SCALE * 0.97 * math.cos(a)
        py = dcy + dR * DRUM_SCALE * 0.97 * math.sin(a)
        emit(square(px, py, 0.85, lat0, rot=a), Z_ATTIC_TOP + 1.5,
             Z_DRUM_TOP - 1.6, GRANITE_DOME, GRANITE_DOME, "column")
    emit(circle(dcx, dcy, dR * DRUM_SCALE * 1.05, lat0), Z_DRUM_TOP - 1.6, Z_DRUM_TOP,
         GRANITE_DOME, CAP_ROOF, "cornice")

    # -- the dome itself: stacked discs on a raised profile ----------------
    # Fuller than a hemisphere, which is what the Texas dome is, and stopping
    # at a shoulder wide enough for the lantern to stand on. Each disc is
    # solid, so the silhouette is the stack.
    for i in range(DOME_STEPS):
        t0 = i / DOME_STEPS
        t1 = (i + 1) / DOME_STEPS
        z0 = Z_DRUM_TOP + (Z_DOME_TOP - Z_DRUM_TOP) * t0
        z1 = Z_DRUM_TOP + (Z_DOME_TOP - Z_DRUM_TOP) * t1
        r = dR * DOME_SPRING * (DOME_SHOULDER + (1 - DOME_SHOULDER)
                                * math.cos(t0 * math.pi / 2) ** DOME_POWER)
        emit(circle(dcx, dcy, r, lat0, 36), z0, z1, GRANITE_DOME, CAP_ROOF, "dome")

    # -- lantern, cupola, and the Goddess of Liberty -----------------------
    emit(circle(dcx, dcy, 3.1, lat0, 24), Z_DOME_TOP, Z_LANTERN_TOP,
         GRANITE_DOME, CAP_ROOF, "lantern")
    for i in range(12):
        a = 2 * math.pi * i / 12
        emit(square(dcx + 3.3 * math.cos(a), dcy + 3.3 * math.sin(a), 0.34,
                    lat0, rot=a), Z_DOME_TOP + 0.8, Z_LANTERN_TOP - 0.6,
             GRANITE_DOME, GRANITE_DOME, "lantern-column")
    # The cupola was CAP_ROOF — grey-green sheet metal, on the one part of the
    # building where every photograph shows granite-coloured paint. Only the
    # WINGS' roofs are that metal.
    for i in range(4):
        t0, t1 = i / 4, (i + 1) / 4
        emit(circle(dcx, dcy, 3.1 * (1 - 0.72 * t0), lat0, 20),
             Z_LANTERN_TOP + (Z_CUPOLA_TOP - Z_LANTERN_TOP) * t0,
             Z_LANTERN_TOP + (Z_CUPOLA_TOP - Z_LANTERN_TOP) * t1,
             GRANITE_DOME, GRANITE_DOME, "cupola")
    # 302.64 ft to the tip of her star.
    emit(circle(dcx, dcy, 0.75, lat0, 12), Z_CUPOLA_TOP, Z_STATUE_TOP - 1.2,
         GODDESS, GODDESS, "goddess")
    emit(circle(dcx, dcy, 1.15, lat0, 10), Z_STATUE_TOP - 1.2, Z_STATUE_TOP,
         STAR, STAR, "star")
    stats["dome_rings"] = len([d for d in dome])

    # -- stepped hip caps on the four corner pavilions ---------------------
    for r, h in pavilion_caps:
        for i in range(4):
            f0 = 1.0 - i * 0.21
            emit(shrink_ring(r, f0, centroid(r)[1]), h + i * 1.7,
                 h + (i + 1) * 1.7, CAP_ROOF, CAP_ROOF, "pavilion")
        stats["pavilion_caps"] += 1

    # -- the Bullock's rotunda --------------------------------------------
    # Centre and radius measured off the z20 nadir tile (22 m across); the
    # museum's own footprint is in the snapshot and keeps its walls.
    bx, by, br = -97.73889, 30.28029, 11.0
    blat = by
    bmx = bx * M_LAT * math.cos(math.radians(blat))
    bmy = by * M_LAT
    emit(circle(bmx, bmy, br, blat, 32), 19.0, 27.0, "#d9cdb2", BULLOCK_ROOF, "bullock-drum")
    for i in range(7):
        t0, t1 = i / 7, (i + 1) / 7
        r = br * math.cos(t0 * math.pi / 2) ** 0.7
        emit(circle(bmx, bmy, max(r, 1.0), blat, 28),
             27.0 + 9.0 * t0, 27.0 + 9.0 * t1, BULLOCK_ROOF, BULLOCK_ROOF,
             "bullock-dome")

    # ══════════════════════════════════════════════════ 4. the grounds ══
    ground = []
    for e in els:
        t = e.get("tags") or {}
        r = ring_of(e)
        if len(r) < 2:
            continue
        c = centroid(r)
        if not (SOUTH <= c[1] <= NORTH and WEST <= c[0] <= EAST):
            continue
        hw = t.get("highway")
        is_area = t.get("area") == "yes" or r[0] == r[-1]
        use = None
        if hw in ("footway", "path", "steps", "pedestrian", "service"):
            use = hw
        else:
            for k in ("leisure", "landuse", "natural", "amenity"):
                v = t.get(k)
                if v in NOT_GROUND:
                    use = None
                    break
                if v and v in AREA_USE:
                    use = AREA_USE[v]
                    break
        if not use:
            continue
        surf = SURFACE_MAP.get(t.get("surface")) or DEFAULT_SURFACE.get(use)
        if not surf:
            continue
        if use in ("footway", "path", "steps", "pedestrian", "service") and not is_area:
            w, wt = DEFAULT_WIDTH.get(use, 2.4), 0
            try:
                if t.get("width"):
                    w, wt = float(str(t["width"]).split()[0]), 1
            except ValueError:
                pass
            ground.append({"type": "Feature",
                           "geometry": {"type": "LineString",
                                        "coordinates": [[round(p[0], 7), round(p[1], 7)] for p in r]},
                           "properties": {"k": "path", "s": surf, "u": use,
                                          "w": round(w, 2), "wt": wt}})
            stats["ground_paths"] += 1
        elif is_area and len(r) >= 4:
            pr = {"k": "area", "s": surf, "u": use}
            if t.get("name"):
                pr["name"] = t["name"]
            ground.append({"type": "Feature",
                           "geometry": {"type": "Polygon",
                                        "coordinates": [[[round(p[0], 7), round(p[1], 7)] for p in closed(r)]]},
                           "properties": pr})
            stats["ground_areas"] += 1

    # The walks have to arrive as polygons or nothing draws them at all. This
    # runs LAST so the count above still reports what OSM had, and the count
    # below reports what the app will actually receive.
    ground = widen_paths(ground, stats, warn)
    stats["ground_path_lines_left"] = sum(
        1 for f in ground if f["properties"].get("k") == "path")
    stats["ground_patharea_total"] = sum(
        1 for f in ground if f["properties"].get("k") == "patharea")

    # ══════════════════════════════════════════════════════ 5. the trees ══
    # The Capitol grounds are a forest — 22 acres of live oak and pecan, and
    # the single biggest reason the complex reads as a place rather than a
    # plaza. trees.geojson stops at 30.27597, so none of it was in the scene.
    raw = []
    for e in els:
        t = e.get("tags") or {}
        if e["type"] != "node" or t.get("natural") != "tree":
            continue
        lon, lat = e.get("lon"), e.get("lat")
        if lon is None or not (SOUTH <= lat <= NORTH and WEST <= lon <= EAST):
            continue
        d_crown = None
        for k in ("diameter_crown", "canopy:diameter"):
            try:
                d_crown = float(str(t[k]).replace("m", "").strip())
                break
            except (KeyError, TypeError, ValueError):
                pass
        try:
            h = float(str(t["height"]).replace("m", "").strip())
        except (KeyError, TypeError, ValueError):
            h = None
        # GENERATIVE defaults, and the reason for them: an untagged tree on the
        # Capitol grounds is a mature live oak or pecan, not a sapling — 13 m
        # tall with a 12 m crown is the middle of that population.
        #
        # The SPREAD around that middle matters as much as the middle. The
        # first cut gave every untagged tree the identical 13 m / 12 m and the
        # grounds came back reading as an orchard: two hundred identical
        # cylinders on a grid. The variation is a stable hash of the node id, so
        # it is deterministic across bakes — position stays factual, size was
        # already a default, and a varied default is a better default.
        v = stable01("tree:%d" % e["id"])
        if h is None:
            h = 10.5 + v * 8.5                      # 10.5 .. 19 m
        if d_crown is None:
            d_crown = max(6.0, h * (0.85 + stable01("crown:%d" % e["id"]) * 0.50))
        raw.append((lon, lat, h, d_crown, t.get("species") or t.get("genus")))

    # `d` is a keep-ORDER, not a random number: thinning must drop the small
    # trees first and keep the big ones, because the big ones are what you see
    # from 60 m up. Biggest crown -> d ≈ 0 -> survives every density setting.
    raw.sort(key=lambda r: -r[3])
    trees = []
    n = max(1, len(raw) - 1)
    for i, (lon, lat, h, dc, sp) in enumerate(raw):
        d = round(i / n, 4)
        k = math.cos(math.radians(lat))
        cx, cy = lon * M_LAT * k, lat * M_LAT
        base = round(h * 0.34, 2)
        trees.append({"type": "Feature",
                      "geometry": {"type": "Polygon",
                                   "coordinates": [square(cx, cy, 0.28, lat)]},
                      "properties": {"kind": "trunk", "h": round(h * 0.4, 2),
                                     "base": 0, "d": d}})
        pr = {"kind": "canopy", "h": round(h, 2), "base": base, "d": d,
              "leaf": "broadleaved", "src": "osm"}
        if sp:
            pr["sp"] = sp
        trees.append({"type": "Feature",
                      "geometry": {"type": "Polygon",
                                   "coordinates": [circle(cx, cy, dc / 2, lat, 9)]},
                      "properties": pr})
    stats["trees"] = len(raw)

    # ═══════════════════════════════════════════════════ 6. overrides ══
    # The state buildings already in the snapshot. Two things are wrong with
    # them: Overture heights that read about half true (the 14-storey Bush
    # building at 24.9 m), and generic tan walls on what is limestone and
    # granite. Emitted as a runtime patch rather than rewritten into the
    # snapshot, so a re-bake of the snapshot cannot silently undo it.
    north = load(NORTH_TAGS, {"elements": []})
    osm_levels = {}
    for e in north.get("elements", []):
        t = e.get("tags") or {}
        c = e.get("center")
        if not c or not t.get("name"):
            continue
        try:
            lv = float(t["building:levels"])
        except (KeyError, TypeError, ValueError):
            continue
        osm_levels[norm_name(t["name"])] = (lv, c["lon"], c["lat"],
                                            (t.get("building") or "yes").lower())

    curated_north = {norm_name(k): v for k, v in CURATED_NORTH.items()}
    overrides = {}
    seen_curated = set()
    for x, y, f in snap_pts:
        p = f["properties"]
        nn = norm_name(p.get("name"))
        if not nn:
            continue
        if not (COMPLEX_BOX[0] <= x <= COMPLEX_BOX[2]
                and COMPLEX_BOX[1] <= y <= COMPLEX_BOX[3]):
            continue
        cur = curated_north.get(nn)
        if not cur:
            continue                       # the list IS the permission
        seen_curated.add(nn)
        entry = dict(colours(cur["wall"], cur["roof"]))
        stats["overrides_recoloured"] += 1
        lv = osm_levels.get(nn)
        if lv:
            _, ox, oy, btype = lv
            if abs(ox - x) < 3e-4 and abs(oy - y) < 3e-4:
                civic = btype in CIVIC or "state office" in nn or "county" in nn
                h = lv[0] * (M_PER_LEVEL_CIVIC if civic else M_PER_LEVEL)
                cur_h = p.get("final_height") or 0
                # Only ever RAISE. Overture measured some of these correctly
                # (Clements at 73 m); a levels-times-storeys estimate must not
                # be allowed to shrink a real measurement.
                if h > cur_h + 2.0:
                    entry["final_height"] = round(h, 1)
                    entry["source_height"] = "osm_levels"
                    entry["was_height"] = round(cur_h, 1)
                    stats["overrides_raised"] += 1
        overrides[p["id"]] = entry
    for miss in sorted(set(curated_north) - seen_curated):
        warn.append("curated northern building not found in the snapshot: %s" % miss)
    have_south = {norm_name(b["properties"].get("name")) for b in buildings}
    for miss in sorted(set(curated_south) - have_south - {""}):
        warn.append("curated southern building not found in OSM: %s" % miss)

    # ════════════════════════════════════════════════════════ 7. write ══
    def write(name, obj):
        path = os.path.join(OUT_DIR, name)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(obj, fh, separators=(",", ":"))
        return "%s (%.0f KB)" % (name, os.path.getsize(path) / 1024)

    fc = lambda fs: {"type": "FeatureCollection", "features": fs}
    # A GeoJSON foreign member: the wall tones js/facades.js must NOT fold into
    # the city's 14-bucket palette. Only the day and golden values come from the
    # Capitol's own colours — its night value here is the ordinary dark wall,
    # not the floodlit one, because this bucket is shared with any neighbour
    # that lands in the same hue cell and they are not floodlit.
    parts_fc = fc(parts_out)
    gr_d, gr_g, _ = wall_tod(GRANITE)
    parts_fc["facade_protect"] = [{"wd": gr_d, "wg": gr_g, "wn": night_wall(GRANITE)}]
    written = [
        write("capitol.geojson", fc(buildings)),
        write("capitol_parts.geojson", parts_fc),
        write("capitol_dome.geojson", fc(dome)),
        write("capitol_ground.geojson", fc(ground)),
        write("capitol_trees.geojson", fc(trees)),
        write("capitol_overrides.json", overrides),
    ]

    print(json.dumps({
        "area": {"south": SOUTH, "north": NORTH, "west": WEST, "east": EAST},
        "counts": dict(sorted(stats.items())),
        "capitol": {"top_m": Z_STATUE_TOP, "drum_radius_m": round(dR, 2),
                    "dome_pieces": len(dome)},
        "written": written,
        "warnings": warn[:8],
        "provenance": {
            "position": "factual - OSM ways/nodes",
            "height": "factual where OSM records it; %.1f m/level civic, %.1f m "
                      "otherwise, is GENERATIVE" % (M_PER_LEVEL_CIVIC, M_PER_LEVEL),
            "dome form": "GENERATIVE - stacked rings; the 92.24 m top is "
                         "factual, and the roof collar / vertical attic / dome "
                         "springing are read off two elevation photographs",
            "capitol roof colour": "measured off a z20 nadir tile",
            "granite colour": "GENERATIVE - nadir imagery cannot show a wall",
            "dome vs wall": "MEASURED - 1.20/1.21/1.30 off ref_south.jpg, and "
                            "DOME_MATCH carries the facade atlas's darkening "
                            "so the flat dome layer lands where a wall does",
            "walk width": "factual where OSM records it, DEFAULT_WIDTH "
                          "otherwise; buffered into the geometry because a "
                          "line-width is screen pixels (see widen_paths)",
        },
    }, indent=2))


if __name__ == "__main__":
    main()
