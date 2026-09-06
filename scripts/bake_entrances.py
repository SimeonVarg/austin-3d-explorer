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
import re
import sys
from collections import Counter, defaultdict

try:
    from shapely.geometry import Point, Polygon, LineString
    from shapely.ops import unary_union
    from shapely.strtree import STRtree
except ImportError:  # pragma: no cover
    sys.stderr.write("shapely is required: pip install shapely\n")
    raise

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# The footprint file the RENDERER extrudes, resolved exactly the way js/app.js
# resolves it: `data/manifest.json` -> `latest`.  This used to read a written
# date, `2026-08-04`, and QUEUE NB5 was opened because the app had rolled to
# `2026-08-16` and nobody had compared the two.  They are byte-identical, so
# the pin cost nothing this time — but a door placed against a footprint the
# renderer does not draw is a door in the wrong place, and the only reason to
# find that out by looking is that nothing was written down.  Now the date the
# bake used is stamped into `entrances.geojson` itself and
# `scripts/snapshot_parity.py` compares it against the manifest.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bake_facades  # noqa: E402

# ══════════════════════════════════════════════════════════════════════
#  ERA_BASELINE=1 — the before-number, produced by the after-instrument
#
#  The ERA PROVENANCE block at the bottom of this file is new, so a
#  before/after on it is only honest if BOTH numbers come out of the SAME
#  counter. `ERA_BASELINE=1 python scripts/bake_entrances.py` reverts exactly
#  the five 2026-08-27 sourcing changes and nothing else:
#
#    1. YEAR_UTDIRECT      the 22 years UT Direct has and ut_buildings.json
#                          does not
#    2. REG_ABBREV         the register's own abbreviations in reg_name_key()
#    3. OSM_CLASS          OSM's building=* filling an empty Overture class
#    4. split_ref()        multi-value `ref=A;B`
#    5. "thermal storage"  in NULL_NAME_PARTS
#
#  CEL_FAM_NEEDS_SRC is deliberately NOT reverted by it: all four
#  disagreements are cited, so it changes no family either way, and leaving
#  it on keeps the comparison to the five that actually moved doors. Write
#  the output somewhere else when using this — it changes data/entrances.geojson.
ERA_BASELINE = os.environ.get("ERA_BASELINE") == "1"

SNAP_SOURCE = "buildings.detailed.geojson"
# `SNAP_DATE=2026-08-16 python scripts/bake_entrances.py` pins the bake to a
# named snapshot instead of `manifest.latest`. It exists because a rebake for
# one reason must not smuggle in a second: on 2026-08-23 the manifest had
# rolled from 2026-08-16 (which the shipped data/entrances.geojson was built
# from) to 2026-08-23, and re-running the bake to add the UT entrance stage
# below would have shipped a whole snapshot roll — 0.3 MB of unrelated
# geometry change — inside a door-choice diff. Pin, ship the one change, and
# let the snapshot roll be its own pass with its own screenshots.
SNAP_DATE = os.environ.get("SNAP_DATE") or bake_facades.snapshot_date()
SNAP = os.path.join(ROOT, "data", "snapshots", SNAP_DATE, SNAP_SOURCE)
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

# ── SCOPE BY UT'S OWN REGISTER (docs/walk/the-78.md §3, §7) ───────────
# The rect above was drawn when this file was about DRAWING doorways on the
# historic core. It is now also the routing feature's only door source, and
# the-78.md measured what that costs: eleven of the sixteen buildings that
# have a good polygon and no door fail on the rect ALONE — Nursing, UT
# Administration (13 m south of a number somebody typed), the whole Dell Med
# block, Hargis, Nowotny, four garages. None of them is a data problem.
#
# the-78.md §7 Fix 1 proposed widening the rect to 30.2755/-97.7440. Measured
# here, that takes the in-scope count from 276 to 401 — plus 125 buildings
# whose doorways nobody has ever looked at, on the eve of a recording. So the
# rect is NOT widened. Instead the scope test gains a second, narrower door:
#
#   a footprint that carries a UT REGISTER CODE is in scope anywhere inside
#   SURVEY, whether or not it is inside CAMPUS.
#
# That is UT's own register agreeing with OSM's own `ref` tag — two
# independent sources naming the same building — and it admits ELEVEN
# buildings, not 125 [M]. Nothing about the derivation changes: the same
# stage 2 and stage 3 run over them, every door they produce is `derived`,
# and a building with no mapped approach still gets nothing (WAT is the test
# case and it is expected to stay empty).
REGISTER_SCOPE = True   # register code overrides the CAMPUS rect inside SURVEY
MIN_AREA_REF = 100.0    # m2; the size floor for a REGISTER-CODED building.
                        # 250 keeps doors off pump housings, and it also kept
                        # them off the Littlefield Carriage House (161 m2, 1894)
                        # and the Dobie House (162 m2). A code in UT's register
                        # is UT saying "this is a building"; the derivation
                        # still has to find an approach before it places
                        # anything. MIN_H is NOT relaxed with it — a 2.44 m
                        # leaf plus a 0.60 m transom does not fit honestly
                        # under a 3.1 m roof, which is why FC7 stays out.
REGISTER_NAME_JOIN = True  # a footprint whose name is letter-for-letter one
                        # register name, and the ONLY footprint with that name,
                        # carries that code. Checked against the spatial ref
                        # join wherever both fire: 6 agreements, 0 conflicts
                        # [M]. This is what recovers NUR (Nursing School) —
                        # graph.md §5's LAC/"austin" false positive came from
                        # TOKEN overlap, which this rule does not do.
E1_REF_EXEMPT = True    # a register-coded building keeps its own doors even
                        # when it hosts shopfronts (WMB, the West Mall Office
                        # Building, is the case: 11 places.geojson slots, and
                        # the whole-building veto is right for DRAWING and
                        # wrong for ROUTING). The double-draw is prevented per
                        # CANDIDATE instead, by the same claim test wc_place()
                        # already uses on Dobie's Guadalupe frontage.
E1_CLAIM_RUN = 6.0      # m of wall an entrance assembly is tested against
                        # before it may stand on a shopfront host
RECALL_FLOOR_8M = 0.65  # the derivation must still recover at least this share
                        # of the measured OSM entrance nodes within 8 m. 0.67
                        # measured, both before and after this pass [M]; the
                        # floor is two points under it so a data refresh has
                        # room to wobble and a bad placement rule does not.

# ── PLACEMENT (docs/entrances/placement.md §8) ────────────────────────
# ══════════════════════════════════════════════════════════════════════
#  UT'S OWN ANSWER, WHICH BEATS EVERY HEURISTIC IN THIS FILE
# ══════════════════════════════════════════════════════════════════════
# maps.utexas.edu is an Esri app over public, unauthenticated ArcGIS layers,
# and one of them is UT Facilities' hand-surveyed record of the real front
# door of 67 campus buildings, with a barrier-free and an auto-opener flag on
# each. It is the same standing as an OSM `entrance=main` node and it covers
# more of the academic core than OSM does: 97 doors, against 16 OSM nodes
# tagged `main` anywhere in the campus rectangle.
#
# Why this matters here specifically: stage 3's publicness field is a good
# ranking and it is still a ranking. Cross-checked against UT's survey, the
# door this bake labelled `main` was the right one on 16 of 55 routable
# buildings; on the other 39 the right door was already placed, correctly, and
# labelled `secondary`. `docs/walk-door.md` has the measurement.
#
#   CODE  latitude  longitude  side  barrier-free  auto-opener
#
# Fetched 2026-08-23, © The University of Texas at Austin. Re-pull with
# `python scripts/bake_entrances.py --refresh-ut`, which prints a fresh table
# for pasting rather than writing one silently.
UT_CELEBRATED_URL = (
    "https://services9.arcgis.com/w9x0fkENXvuWZY26/arcgis/rest/services/"
    "Celebrated_Entrances_view/FeatureServer/0/query"
    "?where=1%3D1&outFields=*&f=json&outSR=4326&resultRecordCount=2000")
UT_CELEBRATED = [
    'ASE 30.291253 -97.737547 W Y Y',
    'BAT 30.284753 -97.739088 SW Y Y',
    'BAT 30.284797 -97.738693 E Y Y',
    'BAT 30.284889 -97.738916 N N N',
    'BE1 30.391820 -97.726989 N Y Y',
    'BEG 30.391018 -97.725348 N Y Y',
    'BEN 30.283959 -97.738779 E Y Y',
    'BIO 30.287254 -97.740064 W Y Y',
    'BME 30.289405 -97.738721 NW Y Y',
    'BRB 30.285261 -97.736991 W Y Y',
    'BUR 30.288629 -97.738532 S Y Y',
    'BWY 30.290797 -97.738079 E Y N',
    'CAL 30.284460 -97.740360 S Y Y',
    'CCJ 30.288101 -97.730595 W Y Y',
    'CCJ 30.288205 -97.730582 NW N N',
    'CMA 30.289220 -97.740757 S Y Y',
    'CMB 30.289316 -97.741017 E Y Y',
    'CPE 30.290032 -97.736140 S Y N',
    'DMC 30.290125 -97.740480 S Y Y',
    'ECJ 30.288962 -97.735493 W Y Y',
    'ECJ 30.289034 -97.735890 W N N',
    'EER 30.288310 -97.735657 W Y Y',
    'EME 30.389588 -97.727334 E Y Y',
    'EPS 30.285686 -97.736684 S N N',
    'EPS 30.285800 -97.736936 W Y Y',
    'ETC 30.289814 -97.735485 W Y Y',
    'FAC 30.286071 -97.740009 SE Y Y',
    'FAC 30.286422 -97.740629 NW Y Y',
    'FAC 30.286556 -97.739980 NE Y N',
    'FNT 30.287846 -97.737779 E Y Y',
    'FS1 30.386885 -97.731999 E Y N',
    'FSL 30.387375 -97.731553 W N N',
    'GAR 30.285109 -97.738549 S Y Y',
    'GAR 30.285182 -97.738702 W Y Y',
    'GDC 30.285991 -97.736639 S Y Y',
    'GEA 30.287729 -97.739216 S N N',
    'GEA 30.287782 -97.738929 E Y Y',
    'GOL 30.285294 -97.741409 SW Y Y',
    'GOL 30.285689 -97.741284 NW Y N',
    'GWB 30.287829 -97.740064 W Y Y',
    'HLB 30.275597 -97.733208 N Y Y',
    'HRH 30.284097 -97.740421 SW Y Y',
    'HSM 30.288992 -97.740945 W Y N',
    'JES 30.283087 -97.737032 NW Y Y',
    'JGB 30.285622 -97.735839 SW Y Y',
    'JHH 30.278341 -97.731966 E Y Y',
    'JHH 30.278370 -97.732079 W Y Y',
    'JON 30.288525 -97.731347 S Y Y',
    'MAI 30.286023 -97.739757 W Y Y',
    'MBB 30.288237 -97.737147 SW Y Y',
    'MER 30.385289 -97.728277 SE Y N',
    'MER 30.385775 -97.727978 E Y Y',
    'MER 30.386410 -97.727796 NE Y N',
    'MEZ 30.284323 -97.739133 SW Y Y',
    'MEZ 30.284376 -97.738725 E Y Y',
    'MRH 30.287193 -97.730867 S Y N',
    'NHB 30.287474 -97.737253 E Y Y',
    'NHB 30.287493 -97.737785 SE N N',
    'NHB 30.287530 -97.738271 SW N Y',
    'NHB 30.287733 -97.737757 NE Y N',
    'PAI 30.286928 -97.738670 SW Y Y',
    'PAI 30.286948 -97.738468 E Y Y',
    'PAR 30.284894 -97.739866 E N N',
    'PAR 30.284934 -97.740339 W Y Y',
    'PAT 30.288162 -97.736508 N Y Y',
    'PCL 30.282994 -97.737865 N Y Y',
    'PHR 30.288100 -97.738786 W Y Y',
    'PHR 30.288351 -97.738902 N Y Y',
    'PMA 30.288903 -97.736342 S Y Y',
    'PMA 30.288912 -97.736006 NE Y Y',
    'PX3 30.387322 -97.729725 E Y N',
    'RLP 30.284868 -97.735765 W Y N',
    'RLP 30.285000 -97.734882 NE Y Y',
    'RLP 30.285186 -97.735451 N Y Y',
    'ROC 30.390533 -97.725667 W Y Y',
    'SEA 30.289739 -97.737745 SW Y Y',
    'SSW 30.280477 -97.732959 SW Y Y',
    'SSW 30.280797 -97.732860 NW N N',
    'SUT 30.285052 -97.740815 N Y Y',
    'SV1 30.382449 -97.725727 W Y N',
    'SZB 30.281923 -97.738584 E Y Y',
    'SZB 30.281936 -97.738864 NW Y Y',
    'TCB 30.387216 -97.727045 W Y Y',
    'UA9 30.290197 -97.738854 SW Y Y',
    'UTA 30.279248 -97.742629 E Y Y',
    'UTA 30.279461 -97.743022 W Y Y',
    'UTC 30.283339 -97.738594 NE Y N',
    'WAG 30.285273 -97.737505 NE Y Y',
    'WCH 30.286112 -97.738639 W Y Y',
    'WCH 30.286121 -97.738138 NE N Y',
    'WEL 30.286522 -97.737405 E Y Y',
    'WEL 30.286690 -97.738026 NW Y Y',
    'WEL 30.286888 -97.737452 NE Y N',
    'WIN 30.285663 -97.734532 S Y Y',
    'WMB 30.285617 -97.740594 N Y Y',
    'WWH 30.289196 -97.741842 S N N',
    'WWH 30.289354 -97.741895 W Y Y',
]
UT_MATCH_R = 12.0       # m; one of our doors IS this UT door within this far.
                        # Not a round number: of the 83 UT doors on buildings
                        # this build can route to, the distance to our nearest
                        # door piles up at 0-8 m (25 of them), thins out at
                        # 8-16 m (9), and piles up again at 16-28 m (25). The
                        # trough is the boundary between "same doorway,
                        # mislabelled" and "different doorway, different wall".
                        # js/wayfind.js WAYFIND.utDoorMatchM is the same number
                        # for the same reason; keep them together.

# ── `derived` WAS TWO DIFFERENT CLAIMS WEARING ONE WORD ───────────────
# This file's header promises that "`src` on every emitted piece says where its
# POSITION came from", and then two stages that know very different amounts
# both wrote `derived`:
#
#   stage2_paths  a real OSM footway physically CROSSES this wall here, or a
#                 real path dead-ends against it. Something in the world put a
#                 line on the ground leading to this exact spot. That is
#                 evidence about a door.
#   stage3_public a ranking. No path touches this wall at all; it merely scores
#                 well on the publicness field — it faces a walkable line
#                 within APPROACH_R and the building has budget left over. That
#                 is a GUESS, and a defensible one (the alternative is 168 of
#                 274 named campus buildings with no door at all), but it is not
#                 evidence and it should never have been able to hide behind the
#                 same word as a measured path crossing.
#
# Measured on the 2026-08-16 snapshot: 706 doors, of which 573 said `derived`.
# Splitting them is the whole reason a reader can now see, on any single door,
# whether the app is reporting something it found or something it inferred.
# Nothing in the repo branched on the string `derived` (only `westcampus`, in
# bake_walk.py), so this is a vocabulary change, not a behaviour change.
SRC_PATH = "path"     # a real footway crosses / dies at this wall  [M]
SRC_FIELD = "field"   # nothing touches this wall; the publicness field
                      # ranked it and the building had budget left      [A]

# ── A GUESS MAY SAY "THERE IS A DOOR". IT MAY NOT SAY "THERE ARE FIVE" ─
# Once the split above made the field doors countable, the shape of the problem
# was legible for the first time. On the 2026-08-16 snapshot: 707 doors on 295
# buildings, 333 of them from the field. 136 of those 295 buildings have NO
# evidenced door of any kind — no UT survey point, no OSM node, no footway
# reaching a wall — so removing the field outright would leave 46% of campus
# doorless, which is its own lie. The field has to stay.
#
# But look at how the 333 were spread: 141 buildings got exactly one, and then
# 55 got two, 15 got three, 5 got four, 2 got five, one unnamed footprint got
# SEVEN — seven doors, on a building about which nothing whatever is known. The
# second, third and seventh field door are not a second opinion; they are the
# same single guess ("this wall faces a walkway and the building is big") run
# again on the next-best-scoring sample, because `budget_for` sized the budget
# off PERIMETER LENGTH (P_PER_DOOR) and stage 3 spends whatever is left.
#
# That is the mechanism behind the worst numbers in the entrance scoreboard:
# the Seay Building's five field doors are what put drawn doors 80-98 m from
# UT's own surveyed Seay entrance.
#
# So: the field may assert EXISTENCE, once. Every door past the first on a
# building must be evidenced by something in the world. A building with four
# real doors still gets four — this cap never touches an `osm`, `path`, `ut`,
# `authored` or `westcampus` door.
FIELD_MAX = 1         # field-sourced doors per building.  TASTE-ADJACENT: if
                      # campus reads as under-doored on screen, raise this to 2
                      # here and nowhere else. It is deliberately one number.

# ── UT'S SURVEY SETS THE POSITION, NOT ONLY THE ROLE ──────────────────
# The stage below used to do one thing on a match and one thing only: relabel
# our door `main`. It kept OUR coordinate. So a building could carry UT's own
# survey flags on a door drawn 11.8 m from where UT says the door is, and the
# file would report it as a success — the header above says UT's answer "beats
# every heuristic in this file", and then the heuristic kept the geometry.
#
# Measured on the 2026-08-16 snapshot before this pass: of the 81 UT doors with
# a host in scope, 31 were RELABEL cases, and 7 of those sat 10.5-11.8 m from
# UT's point — inside UT_MATCH_R, so "the same doorway", and still drawn on the
# wrong part of the wall. The other 47 were PLACE cases, which already used
# UT's coordinate, and those score 44 of 47 within 10 m. The two halves of one
# stage disagreed about whether the survey was authoritative.
#
# So a matched door is now MOVED onto UT's surveyed point (projected onto the
# host wall by the same snap_to_edge the PLACE branch uses), and its `src`
# becomes `ut`, because `src` in this file means where the POSITION came from.
UT_SNAP = True          # move a matched door onto UT's own point   [A]
UT_SNAP_OVER = (SRC_PATH, SRC_FIELD)  # ...but only over these. An `osm`
                        # door is not a heuristic — it is a second independent
                        # survey that already sits 0.4 m (median) from its own
                        # node, and overwriting one survey with another is not
                        # an accuracy gain, it is a coin toss with extra steps.
                        # Add "osm" to this tuple in one line if
                        # a later round decides UT outranks OSM outright; the
                        # bake prints how many doors the choice affects.
UT_EDGE_SCAN = 24       # candidate footprint edges the UT stage ranks before
                        # choosing a wall. The old code snapped to the SINGLE
                        # nearest edge and threw the surveyed door away if that
                        # edge's outward normal pointed back into the mass —
                        # which is exactly what happens when UT's point lands in
                        # a re-entrant corner or a light well. UT says there is
                        # a door here; the right answer is to look at the next
                        # wall, not to discard a door a human physically stood
                        # in front of. 3 doors were being dropped this way
                        # (`normal test 3` on the bake's UT line); with the scan
                        # it is 0. 24 rather than 4 because Overture tessellates
                        # one real wall into many short edges.

# ── WHAT UT'S `Directional` COLUMN ACTUALLY MEANS. READ BEFORE REUSING ─
# Column 4 of every UT_CELEBRATED row is UT's own `Directional` field — W, SW,
# NE. It looked like the answer to the question a coordinate cannot settle
# (WHICH WALL), so this pass tried using it to pick the wall: rank the edges,
# keep the nearest one whose outward normal agrees with UT's compass point.
#
# IT MADE THE DATA WORSE AND THE A/B IS WHY IT IS NOT IN THE CODE. Baked both
# ways on the 2026-08-16 snapshot and compared per door, the rule moved ten
# doors and eight of them moved AWAY from UT's own surveyed coordinate:
#
#     ECJ W  17.8 -> 33.8 m      MBB SW  1.2 -> 13.1 m
#     PHR N   1.1 -> 11.1 m      WWH W  10.5 -> 20.4 m
#     JON S  12.3 -> 18.7 m      ECJ W   0.3 ->  4.3 m
#     JES NW  1.2 ->  3.9 m      FAC NW  2.2 ->  3.7 m
#   (only WEL NE 14.7 -> 13.4 and JHH W 11.6 -> 10.7 improved)
#
# UT doors with a drawn door within 10 m went 72 -> 70 of 81.
#
# The reason is that `Directional` is not a wall bearing. It says WHICH PART OF
# THE BUILDING YOU WALK TO — the south-west corner, the north end — and a door
# in a corner or a recessed entry court very often has a leaf facing a
# direction the corner is not named after. Moffett's SW entrance sits in a
# re-entrant corner whose leaf does not face south-west at all; obeying the
# column marched the door 13 m to a wall that does. So the column answers
# "where do I go", which is what UT wrote it for, and not "which way does the
# leaf face", which is what a renderer needs.
#
# It is kept as an AUDIT (see the side audit after clear_buried) because a door
# that ends up on the OPPOSITE wall is still definitely wrong, and that check
# costs nothing. It is not kept as a placement rule.
UT_SIDE_MIN = 0.35      # cos, audit only: below this the drawn door is not on
                        # any wall UT's compass point could reasonably name.
                        # ~70 deg — excludes the opposite wall (cos -1) and both
                        # perpendicular ones (cos 0), admits a wall up to 22.5
                        # deg off the named eight-point compass reading.

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

# ── BURIED DOORS (QUEUE W7 / PART L's L1) ─────────────────────────────
# This pass places doors on the OVERTURE footprint. Seven other passes rebuild
# whole buildings out of authored masses, and where an authored mass stands
# outboard of the footprint it swallows the door: Gates-Dell's measured OSM
# `entrance=main` node ends up 0.21 m INSIDE the atrium's glass slab, so the
# door renders 0 pixels from every bearing tried. A door nobody can ever see is
# worse than no door, because it is a silent lie in the feature count.
#
# So: the door's LEAF PLANE is tested against every opaque ground-level mass in
# the repo, and a buried one is relocated to the nearest point on that mass's
# own exterior that has real open space in front of it — or dropped, loudly,
# with the reason printed. The count prints on every run, so the day a new pass
# grows a mass over somebody's front door it is one line of bake output, not a
# 16-bearing photo hunt.
#
# ── THE RULE WAS NAMED AFTER THE WRONG THING (QUEUE NB2) ──────────────
# It was written for authored masses because that is where the first case came
# from, and `BURIED_MASS_FILES` below is the whole of what it looked at. But
# the invariant the rule is really enforcing is
#
#       NOTHING THE RENDERER EXTRUDES MAY STAND OVER A DOOR
#
# and the single largest thing the renderer extrudes is not in that list at
# all: `austin-buildings`, whose source is the footprint snapshot. So a door
# swallowed by an ORDINARY NEIGHBOURING BUILDING passed every test.
#
# That is the Moody Center. Its five doors sit on footprint
# d8b0698a (Moody Center, which `moody` claims, so the buildings layer does NOT
# draw it) and all five leaf planes are inside 2b0f20a0 — an unnamed 21.3 m
# Overture ring over the same arena that NOBODY claims, so the buildings layer
# draws it in full. A 21.3 m building stands in front of a 6.0 m door and the
# audit could not see it, because it was reading the nine authored files and
# not the one the renderer actually extrudes. Every numeric check passed: sane
# height, real elevation, facing outward, counted in every total.
#
# TWO THINGS MAKE A FOOTPRINT COUNT, and both matter:
#   * it must be DRAWN. Seven passes CLAIM ids via `replacedBuildingIds` and
#     the buildings layer filters those out. A claimed ring is not evidence of
#     anything — and including Moody's own claimed host ring would bury every
#     door on it.
#   * it must not be the door's OWN host, tested by BID rather than by the
#     IoU self-block, because an id match is exact and an overlap ratio is a
#     threshold.
BURIED_MASS_FILES = ("heroes", "stadium", "moody", "arts", "drag",
                     "capitol", "tower", "westcampus", "parts")   # [M]
BURIED_OWN_BLOCKS_FRONT = True   # NB8. Test the 4 m of clear space in front
                        # of a RELOCATED leaf against the host building too,
                        # not only against everyone else's masses. False
                        # restores the state that put three visible doors
                        # inside their own building. See clear_buried().
BURIED_DRAWN_FOOTPRINTS = True   # include the footprints `austin-buildings`
                        # extrudes, minus every id an authored pass claims.
                        # False restores the pre-NB2 rule in one line.
# ── QUEUE R3: A RELOCATION MUST NOT TAKE OVER SOMEBODY ELSE'S DOORWAY ──
# The march walks the exterior of whatever mass buried the door and never asked
# what was already standing there. eid 345 (South End Zone, secondary) was
# carried 5.96 m onto the Moncrief-Neuhaus Athletic Center and came to rest
# 1.71 m from eid 621, MNAC's MAIN door: canopy on canopy at 100 % shared area,
# two complete portals in one opening, and the reason `coplanar --gate` reads
# 1627 -> 1655 on main (QUEUE Y24, HANDOFF §161, shots/close/y24/).
#
# THE OBVIOUS RULE IS THE WRONG ONE, AND IT WAS MEASURED BEFORE IT WAS WRITTEN.
# "A relocated door must stay on its own building" sounds right and is refuted
# by the bake's own log: 21 of 27 relocations come to rest against a NEIGHBOUR'S
# drawn footprint, and relocated.md photographed most of them as good — the
# Moody Center's five doors are the headline of that page and every one of them
# lands on 2b0f20a0, which is not Moody's ring. Refusing foreign walls would
# delete twenty-one working doors to fix seven.
#
# What separates them is not WHOSE wall, it is WHAT IS ALREADY ON IT:
#
#   good landings -> 2b0f20a0, d51aba3f, eddfc577, 78a70444 ... BLANK masses,
#                    not one door group between them
#   bad  landings -> 3fb4507f, 6671852e, 568a1f55 ... every one already carries
#                    its own doors, and that is where all seven cross-building
#                    collisions on `main` are
#
# So the rule is a CLAIM rule, not an ownership rule: a relocated leaf bank may
# not come to rest on a doorway a DIFFERENT building is already using. Two doors
# on one building at 2.8 m are an authored bank (BMA 366/367) and are none of
# this rule's business; two buildings' front doors in one hole are the defect.
#
# IT IS OFF, AND THAT IS A DELIBERATE JUDGEMENT, NOT AN UNFINISHED FIX.
# Turned on it does exactly what it says — measured, not asserted:
#
#   coplanar entrances.geojson   1655 -> 1623   (gate GREEN, 4 UNDER the 1627
#                                                baseline, exit 0)
#   every one of the 32 removed pairs is a CROSS-BUILDING door collision,
#   resolved by id with `coplanar.mjs --dump-pairs`:
#       (345,621) 25   (128,587) 4   (179,621) 1   (164,287) 1   (179,345) 1
#   656 groups on 295 buildings, ZERO eid identity drift, 0 floating sills,
#   0 detached pieces, OSM recall unchanged. Six door groups move.
#
# It is off because of what the CAMERA said, at 1.70 m, five bearings, both
# arms. The doubling is gone — 345 is no longer a subset of 621's rectangle at
# any bearing — and three of the four usable bearings read cleaner afterwards.
# But eid 621, Moncrief-Neuhaus's MAIN door, travels 6.70 m and its opening
# narrows from `hinged-quad` n=4 to `single` n=1, and at bearing 249.9 that
# reads as a thin armature where a glazed portal used to be
# (shots/lastfix/before-345-621/ vs after-345-621/, B250-both.png).
#
# And the defect this removes is INVISIBLE: the front portal hides the back
# one, `zfight.mjs` found no flicker at twelve poses (HANDOFF §161 §6), and
# nobody looking at the city can see it. So switching this on the night before
# a recording trades an invisible defect for a visible change across SIX door
# groups of which ONE PAIR has been photographed. `relocated.md`'s own standard
# is two bearings per moved door and there was not time to meet it.
#
# TO TURN IT ON: set this True, re-bake, and photograph eids 128, 164, 179,
# 287, 345, 346 and 621 from two opposing bearings each. Everything else is
# already measured above.
BURIED_DOOR_CLAIM = False  # True enables the R3 rule. See the note above.
BURIED_DOOR_CLEAR_M = 3.2  # m between a relocated door's centre and another
                        # BUILDING's door centre. Defaults to BURIED_SPAN_M
                        # because that is the width this file already calls a
                        # door bank — closer than one bank width and the two
                        # openings are in each other. Measured on `main`, the
                        # cross-building pairs sit at 0.00, 0.00, 0.89, 1.08,
                        # 1.79, 2.15 and 2.86 m and the next pair is past 4 m,
                        # so this constant is in a real gap and not on top of
                        # a cluster.
BURIED_LANDED_PROBE_M = 0.25   # m INWARD from the landing wall, for the
                        # diagnostic that names whose wall a door came to rest
                        # against. The wall point itself is on a boundary by
                        # construction and a point-on-boundary test is a coin
                        # flip.
BURIED_CLAIM_FILES = ("heroes", "stadium", "moody", "arts", "drag",
                     "capitol", "tower", "westcampus", "parts", "art",
                     "roofs", "places")   # whose replacedBuildingIds remove a
                        # footprint from the DRAWN set. Wider than
                        # BURIED_MASS_FILES on purpose: a pass can claim a
                        # building without contributing a ground-level mass,
                        # and claiming is what decides whether it is drawn.
BURIED_BASE_MAX = 2.0   # m; a mass starting above this is a canopy, not a wall
BURIED_TOP_MIN = 3.0    # m; below this it cannot hide a 2.4 m leaf
BURIED_TEST_OUT = 0.25  # m along the normal — where the LEAF actually is, not
                        # the wall point, which is on the boundary by design
BURIED_CLEAR_M = 4.0    # m of free space a relocated door needs in front of it.
                        # Gates-Dell's nearest free wall is 0.2 m away and faces
                        # a 2 m slot; without this test the "fix" moves the door
                        # 20 cm and it is still invisible.
BURIED_STEP_M = 1.0     # m; how finely the mass exterior is sampled
BURIED_MOVE_MAX = 35.0  # m; further than this and it is a different elevation
BURIED_PROUD = 0.35     # m the relocated door stands off the mass it was in
BURIED_SPAN_M = 3.2     # m of wall the test sweeps, centred on the door. A
                        # POINT test is not enough: the Red Zone's door centre
                        # is outside the stadium ramp and its LEAVES are inside.
BURIED_RUN_MIN = 3.0    # m of continuously free wall a relocation must find.
                        # Also not enough to test one point: assemble() slides
                        # an opening ALONG its run to fit between the corners,
                        # so the first attempt validated the spot the door
                        # landed on and the door then slid 3 m back into the
                        # Gates-Dell atrium it had just been lifted out of.
# ── THE SELF-BLOCK (QUEUE X4) ─────────────────────────────────────────
# Some passes re-draw a whole building from its own footprint ring
# (westcampus does it for all 24 towers, tower for MAI, drag and moody for
# their hosts). To the buried-door audit such a mass is indistinguishable
# from a wall built OVER the building — so a door in a re-entrant notch of
# its own plan was tested against its own building and failed: Cambridge
# Tower's measured march re-enters CAMBRIDGE'S OWN ring in six of twelve
# directions within 3 m, while every other footprint is 107 m away. A door
# on a wall always has its own building behind it; the building itself can
# neither bury its own door nor block its own approach.
#
# A mass counts as "the host itself" when IoU(mass, host footprint) >=
# SELF_IOU. Measured over all 1,456 qualifying masses vs the 2026-08-04
# snapshot: 1,391 score < 0.5, six sit between 0.5 and 0.9, and 57 score
# >= 0.9 — the distribution is bimodal and the 57 are exactly the
# footprint-re-draw class. 0.90 sits in the empty gap.
SELF_IOU = 0.90         # [M] intersection-over-union; see histogram above

# ── THE WALL PLANE A DOOR SITS ON (2026-09-05) ────────────────────────
# A door belongs on the wall the RENDERER DRAWS, and for six buildings on
# campus that is not the footprint ring. `scripts/bake_heroes.py` insets every
# GDC and NHB wall band by its own `_OVERSAIL` (2.5 m on both) because the
# Overture ring traces the ROOF CANOPY and not the wall; this pass placed the
# doors on the ring. Measured against the shipped files, before this rule:
#
#     GDC  eids 166-171   2.63 m outboard of the brick the hero bake draws
#     NHB  eids 581-586   2.63 m outboard of the same
#     EER  eids 333-337   0.13-0.17 m  (EER's bands are at inset 0 — correct)
#
# 2.63 = GDC_OVERSAIL 2.50 + the 0.13 m the door bank already stands proud of
# its own wall reference. Twelve doors floating a metre and a half clear of the
# building, which is exactly what a hovering door looks like from the plaza.
#
# THE RULE, and it is a rule and not twelve numbers: march inward from the
# candidate along its own wall normal and seat it on the first surface THIS
# HOST actually draws. It is a no-op wherever the footprint IS the wall — every
# ordinary building (no authored mass at all), EER, Moody, the stadium — so it
# cannot regress them; it is exactly `_OVERSAIL` wherever a pass insets its
# walls; and the day somebody adds a seventh inset building it is already
# right. The candidate carries the metres it moved so the served file can hand
# the pre-seat position back to `?wallplane=0`.
WALL_SEAT = True        # the switch's bake half; js/entrances.js has the other
WALL_SEAT_MAX = 6.0     # m; a surface further in than this is not this
                        # doorway's wall — it is the far side of a light well
WALL_SEAT_MIN = 0.80    # m; below this the door is ON the wall and nothing
                        # moves. Two reasons for 0.80 and not 0.15:
                        #   * EER's doors measure 0.13-0.17 m off their bands,
                        #     which is the bank's own PROUD_DOOR standoff, and
                        #     must survive untouched;
                        #   * a sub-metre gap between the footprint ring and an
                        #     authored re-draw is not an OVERSAIL, it is that
                        #     re-draw's own modelling slack -- a balcony
                        #     return, a podium edge -- and closing it buys
                        #     nothing anyone can see while risking a burial.
                        #     Measured: at 0.15 the rule seated 29 doors and
                        #     put Block on 25th East's leaf 0.64 m INSIDE a
                        #     neighbouring West Campus mass (assemble() slides
                        #     an opening along its run, so the leaf does not
                        #     end up where the candidate was tested). At 0.80
                        #     it seats the doors that were genuinely floating
                        #     and buries none. The defect this rule exists for
                        #     is 2.50 m.
WALL_SEAT_OWN = 0.50    # fraction of an authored mass that has to lie inside
                        # the host ring before it counts as that host's wall.
                        # GDC's atrium is OUTBOARD of the ring and scores 0, so
                        # it can never seat a door — clear_buried still owns
                        # that case, and runs after this.
WALL_SEAT_STEP = 0.05   # m; the march, then one bisection to 0.01 m
WALL_SEAT_SPAN = BURIED_SPAN_M   # m of bank swept; the door seats on the
                        # NEAREST plane its leaves touch, never the deepest

# ── A CELEBRATED PORTAL KEEPS ITS OWN WALL (QUEUE W9) ─────────────────
# The Main Building's south portal sits in the middle of a 38 m recessed bay
# and the generic pipeline had put THREE more doors on that same wall, the
# nearest 8.9 m away, each with its own limestone surround and its own flight.
# The most-photographed portal on campus read as one of four identical doors.
# celebrated.md §5.1 enumerates MAI's entrances from OSM exhaustively — one
# main plus two `entrance=yes` at the north ends of the wings — so a derived
# door on the portal's wall is not evidence, it is noise. General rule: where a
# building carries an AUTHORED main portal coordinate, no DERIVED candidate may
# share that portal's wall.
PORTAL_CLEAR_R = 20.0   # m along the wall, either side of an authored portal
PORTAL_WALL_T = 3.0     # m; perpendicular offset within which two candidates
                        # are on the SAME wall rather than on a return

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
VICT_LEAF_W = 0.80      # m, 19th-century leaf                          [A]
VICT_LEAF_H = 2.70      # m [M]/[D] The ASPECT is the measurement and the
                        # width is the anchor. Measured off
                        # File:Arno_nowotny_building.jpg: the pair spans
                        # x 861..937 px and the leaves run y 812..947 px, so
                        # each leaf is 38 x 135 px = 3.55 : 1 (the two leaves
                        # are 3.4 : 1 after the meeting stile). At an anchor
                        # width of 0.80 m that is 2.70 m, which the same
                        # frame's whole-elevation scale (1 px ~ 0.021 m at the
                        # wall plane) independently puts at 2.8 m. TALL AND
                        # NARROW is the whole read; a 0.914 x 2.134 commercial
                        # leaf here is what makes it look like a shed door.
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
# The property every one of those chords carries — and nothing else does — so
# js/slopes-arches.js can hide exactly the pieces that exist only because
# ARCH_TIERS is finite, and put them back untouched when it is off.
ARC_CHORD = {"arc": 1}
# THE ARCADE. Where a photograph says the door is one bay of a ground-floor
# arcade, the CELEBRATED row carries `arcade=True` and the door's `arches`
# entry grows an `arcade` member: the wall's extent in the door's own frame,
# the bay pitch, and where the bays fall. js/slopes-arches.js draws the other
# bays as the same arch as the door -- band, spandrel, the dark of a loggia
# behind them -- with the stone continuing between them and a string course
# over the lot. The fill-extrusion file is untouched: nothing here is a chord.
#
# THE PITCH IS DERIVED, NOT TYPED. The narrowest an arcade bay can be is the
# opening plus its two surround bands plus a pier (ARCADE_PIER_M): 2.60 +
# 0.90 + 0.50 = 4.00 m on family A. Where the same wall carries a second
# arched door, both doors sit on one bay grid, so the pitch is that nominal
# snapped to divide the distance between them: Sutton Hall's two north doors
# are 27.86 m apart, 7 bays of 3.98 m. (The other reading of Sutton --
# campus_truth.json: "4 round arches at grade (1 door, 3 windows), 4 window
# bays above" -- is one arch per bay, which is what this draws.)
ARCADE_PIER_M = 0.50    # [D] the bare pier between two bands, at its narrowest
ARCADE_STRING_M = 0.35  # [U] the string course over the arcade: one course of stone
ARCADE_DARK_V = (0.02, 0.05)   # m; the loggia's shadow, a hair off the wall, behind the band
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
CANOPY_SIDE_D = 0.60    # was 1.20, "family D, whose canopy is the identity".
                        # That identity was never in a photograph and is gone
                        # (see WHAT STANDS OVER THE DOOR below); the wider
                        # overhang went with the claim that justified it.  [A]
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

# ── FAMILY V, THE 19th-CENTURY PORCH (eras.md §4 family V). Two of its four
#    members were PHOTOGRAPHED for this pass and these two hexes are sampled
#    off one of them: File:Arno_nowotny_building.jpg on Wikimedia Commons,
#    CC BY-SA, the axial front elevation of the 1857 Abner Cook asylum block.
#    Pixel windows and medians are written into docs/entrances/eras.md §4V so
#    the sample can be re-taken. Both are then entered through the repo's own
#    measured transfers, the same way BRONZE and BRICK were — nothing here is
#    a colour somebody liked the look of.
VICT_LEAF = "#9e3d21"    # [M]/[D] the door pair, sampled #6a2916 (median over
                         # 780 px, sd 6.5) IN PORCH SHADE, lifted through the
                         # repo's measured x0.67 luma transfer exactly as
                         # BRONZE was: a shadow is entered ALREADY LIT or it
                         # reads as a hole punched in the building.
PORCH_HOST_DARKEN = 0.88 # a porch is the host's own wall in shadow, 12% down —
                         # the number eras.md §3.8 already publishes for the
                         # canopies that are meant to belong to their building.
VICT_TRIM = "#d98c59"    # [M]/[D] the painted timber porch trim and quoin
                         # bands, sampled #e4935e SUNLIT (median over 3,300 px,
                         # sd 4.7), less 5% — the same treatment bake_drag.py
                         # gave the UT-blend brick it sampled at #c28e64.
VICT_GLASS_MIX = 0.52    # V: the saturated blue taken FURTHER toward iron than
                         # family A's leaded 0.35. An 1850s fanlight sits at the
                         # back of a 2.4 m porch and photographs near-black
                         # (#26221e in the same frame); family A's arcade does
                         # not. Derived from a sampled primary by a stated
                         # channel operation, like every other glass here.
VICT_RISER = 0.170       # m [M] FIVE risers are visible in the ANB frame and
                         # the flight measures 0.85 m; 0.85/5 = 0.17, which is
                         # also FLIGHT_RISER. Named separately so the count
                         # stays 5 if somebody retunes the utility flight.
VICT_ARCH_RISE_FRAC = 0.55  # [M]/[D] the fanlight is SEGMENTAL, not
                         # semicircular: measured rise 27 px over a half-span
                         # of 38 px = 0.71 of the half-span of the DOOR
                         # opening (1.70 m). The bake draws the arch across the
                         # whole 2.20 m bank, so restated against `half`:
                         # 0.71 x 0.85/1.10 = 0.55. A semicircle would be 1.00
                         # and would be wrong by 0.4 m of glass.
VICT_HEAD_GAP = 0.08     # m [M] frame between the door head and the springing
                         # of the fanlight — 4 px in the same frame.
VICT_PORCH_OVER = 2.35   # m [M] from the door head to the TOP of the porch
                         # deck (112 px). Derived from the head rather than
                         # authored as an absolute height, so a building whose
                         # flight comes out of OSM steps evidence still gets its
                         # porch over its own door instead of through it.
VICT_PORCH_T = 0.94      # m [M] the porch entablature + balcony deck, head to
                         # soffit 1.41 m, so 2.35 - 1.41. Four times family C's
                         # canopy: this is a masonry-and-timber PORCH carrying a
                         # first-floor balcony, not a blade.
CANOPY_SIDE_V = 1.80     # m [S]/[A] "a wide first-story portico extends to both
                         # sides of the main entry" (Wikipedia, Little Campus).
                         # WIDE is sourced; 1.80 m is the number and is [A].

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
GLASS_VICT = mix(GLASS_SAT, IRON, VICT_GLASS_MIX)
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
    # ── V — 19th-century masonry porch, 1857-1909. The family the four-family
    #        hypothesis did not have, and the campus is older than the
    #        hypothesis: UT's own register dates FIVE buildings before Cass
    #        Gilbert arrived, the oldest by half a century. Before this they
    #        wore the E5 null door — a flush aluminium storefront on antebellum
    #        limestone.
    #
    #        The identifying feature is the PORCH, not the door. On a
    #        two-storey 1850s-1890s masonry block the entrance is a doorway at
    #        the back of a one-storey portico whose roof is the first-floor
    #        balcony: 2.4 m of permanent shade, a deck 2.35 m over the door
    #        head, and a deep warm shadow. That is also the surface the camera
    #        can see (eras.md §2.1 — at 70 deg of pitch a horizontal face is
    #        seen at nearly full size and a vertical one at a third), so the
    #        part that is loudest is also the part that is true.
    #
    #        The leaf is TALL AND NARROW and that is measured, not styled: the
    #        photographed pair is 3.4 : 1, against family B's monumental 2.44
    #        at 2.44 : 1. Getting that ratio wrong is what makes a 19th-century
    #        door look like a shed door.
    "V": dict(
        era="victorian", arched=True,
        open_w=2.20, open_w_sec=2.20,        # [D] pair 1.70 + 0.25 jamb a side
        leaf_w=VICT_LEAF_W, leaf_h=VICT_LEAF_H, max_pairs=1,
        spring_h=0.0, arch_rise=0.0,         # DERIVED from the head, below
        arch_from_head=True, arch_rise_frac=VICT_ARCH_RISE_FRAC,
        transom=True, transom_h=0.0,         # ... and so is the fanlight
        surround_w=0.26, surround_proj=0.08, # [M] moulded architrave
        cornice=0.0, sign_band=False,
        reveal_d=2.40, reveal_col=REVEAL_WARM,   # the PORCH is the reveal
        rise=0.85, riser=VICT_RISER, tread=FLIGHT_TREAD,
        cheek=False, rail=True, rail_col=IRON,   # [M] iron pipe, not bright
        canopy=dict(proj=2.40, t=VICT_PORCH_T, top=0.0,
                    over_head=VICT_PORCH_OVER, side=CANOPY_SIDE_V,
                    host=True, mat="stone", col=None, soffit=ARCH_SHADOW),
        leaf_mat="timber", leaf_col=VICT_LEAF, glaz_frac=0.58,
        sur_mat="limestone", sur_col=LIMESTONE, glass_col=GLASS_VICT,
        dt="arched-pair", accent=VICT_TRIM, accent_h=0.22,
    ),
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


# ════════════════════════════════════════════════════════════════════
#  WHAT STANDS OVER THE DOOR - docs/entrances/shelter.md
#
#  THE DEFECT THIS FIXES, in one sentence: family D's own comment above used
#  to read "the canopy is the identifying feature", and NOBODY HAD EVER
#  CHECKED THAT AGAINST A PHOTOGRAPH. It was an era rule - built after 1990,
#  therefore a 3.20 m steel blade over the door - and it painted one on 335
#  of 591 doors. The round that named family D's win, the Tom & Cinda Hicks
#  North Gate (NEZ), cites a photograph of that exact door with NO CANOPY IN
#  IT. The identity was invented.
#
#  THE MEASUREMENT. 343 of UT's own building photographs (utdirect.utexas.edu
#  /apps/campus/buildings/information/nlogon/..., no login, fetched and
#  VIEWED 2026-08-27) across all 148 codes that carry a drawn door. 98 of
#  them show the entrance well enough to say what is over it. Counted by eye,
#  one call per building, each cited below:
#
#      canopy  15    a roof/blade/marquee/porte-cochere STANDS OVER the doors,
#                    cantilevered or on its own posts, separate from the mass
#      arcade  15    a colonnade or covered walk runs in front and the doors
#                    open off it - the shelter is the building's own piers
#      recess  19    the doors sit back under the building's own upper floors
#      flush   49    a plain opening in the wall plane; nothing over it
#
#  THE RULE THAT FALLS OUT, and it is not the one the file had. A projecting
#  canopy is on 15 of 98 entrances - 15% - and IT DOES NOT TRACK THE ERA at
#  all: family C (1950-89) 6 of 40, family D (1990-2026) 4 of 24. Those are
#  the same rate. Cret (family B) is 0 of 20 and Gilbert (family A) 0 of 3,
#  which the file already had right. So the canopy is a PER-BUILDING FACT,
#  not an era fact, and the honest default is the one this file already
#  applies to families themselves: OPT IN BY EVIDENCE, NULL OTHERWISE.
#
#      old rule (canopy iff era in C/D/E2):     41% right on the 98 photos
#      new rule (canopy iff a photo shows one): 100% where a photo exists,
#                                               and its DEFAULT alone - "no
#                                               canopy" - is 85% right
#
#  THE SHAPE WAS RIGHT; THE ASSIGNMENT WAS THE LIE. Scaled off the doors in
#  the photographs (a leaf is 2.13 m), the canopies on the Forty Acres proper
#  have a MEDIAN projection of 2.40 m, top 3.60 m, thickness 0.25 m - which
#  is family C's canopy exactly. Family D's 3.20 / 4.20 / 0.18 matches
#  nothing measured. So the fallback below is the measured median, and every
#  building that has one carries its own numbers.
#
#  WHAT THIS DOES NOT DO, said plainly: `recess` and `arcade` are RECORDED
#  and they darken the reveal, but neither is drawn as geometry - the
#  entrance wall is an extruded footprint and this bake cannot cut into it.
#  34 of 98 entrances are sheltered by something real that the city still
#  does not show. That is the next round's job, not a claim of this one.
# ════════════════════════════════════════════════════════════════════

# -- the doctrine, in one line each so it can be overruled in one line ------
SHELTER_CANOPY_BY_DEFAULT = False   # a canopy nobody photographed is invented
SHELTER_APPLIES_TO = ("main",)      # a photo of the front door evidences the
                                    # FRONT DOOR. It says nothing about the
                                    # service door round the back, so the back
                                    # door keeps the default.          [rule]
SHELTER_FALLBACK_NO_MAIN = True     # ... unless the bake never called ANY
                                    # door on this building `main`. Every
                                    # parking garage is in that state: its
                                    # entrance is a vehicle lane and role
                                    # assignment gives it `service`. Then the
                                    # row applies to the door the bake itself
                                    # ranks first, which is the one it would
                                    # have called main if it named one. [rule]

# The measured median of the canopies on the Forty Acres. Any building that
# gives its own proj/t/top below overrides this; this is what a photographed
# canopy with no legible dimensions falls back to.
CANOPY_MEDIAN = dict(proj=2.40, t=0.25, top=3.60, mat="steel")   # [M]

# Reveal depth by what the photograph says shelters the door. `reveal_d` in
# this file drives the DARKENING of the reveal panel, not real depth (the
# wall is an extruded footprint), so these are shading values: a door under
# an arcade is in deeper shade than one flush on a sunlit wall.
SHELTER_REVEAL_D = dict(canopy=None,    # keep the family's own
                        arcade=1.90,    # [A] deepest - a covered walk
                        recess=1.60,    # [A] under the mass above
                        flush=0.15)     # [A] nothing over it at all

# -- THE OBSERVATIONS. `k` is the call; `src` is the photograph. Photographs
#    are NOT committed - UT Direct states no licence on them, so this repo
#    keeps the measurement and cites the page, the way it already treats
#    other UT-sourced material. Every row was opened and looked at on
#    2026-08-27 at SHELTER_PHOTO_PAGE % ref.
#    A row here is TRAINING DATA. The held-out third lives in
#    scripts/verify/campusmeter-fixtures/door-shelter.blind.json and this
#    table may never contain a code that file names - campusmeter self-checks
#    the two are disjoint and exits 1 if they are not.
SHELTER_PHOTO_PAGE = ("https://utdirect.utexas.edu/apps/campus/buildings/"
                      "information/nlogon/maps/UTM/%s/")

SHELTER_OBS = {
    # -- CANOPY. Eight on the Forty Acres proper, one on a plant building,
    #    two toll canopies over garage lanes, and one 19th-century porch that
    #    family V already draws. (Four more canopies were observed and are
    #    NOT here: they fell in the held-out third and this table may not see
    #    them.)
    "ATT": dict(k="canopy", proj=2.60, t=0.20, top=5.20, mat="steel",
                src="[M] AT&T Conference Center: a glass-and-steel canopy on "
                    "outrigger struts runs the whole arcade elevation over "
                    "the walk, well above the arched openings."),
    "ETC": dict(k="canopy", proj=3.00, t=0.20, top=4.00, mat="steel",
                src="[M] Engineering Teaching Center: a flat metal canopy on "
                    "two round columns over the doors, signage on the "
                    "fascia. This is the one building family C's canopy fits."),
    "LTH": dict(k="canopy", proj=3.20, t=0.30, top=3.50, mat="steel",
                src="[M] LTH: a ribbed metal canopy on posts over the ticket "
                    "windows and the door bank."),
    "NMS": dict(k="canopy", proj=1.60, t=0.25, top=3.40, mat="steel",
                src="[M] NMS: a flat dark marquee over the doors, between "
                    "the limestone piers at the head of the entrance steps."),
    "CS6": dict(k="canopy", proj=1.40, t=0.18, top=3.10, mat="steel",
                src="[M] CS6: a small dark sloping metal canopy over a single "
                    "service door - the one canopy found on an E5 building, "
                    "and the reason the default is a default and not a law."),
    "FNT": dict(k="canopy", proj=2.00, t=0.25, top=3.60, mat="steel",
                src="[M] FNT: a CURVED brushed-metal canopy over one door at "
                    "the head of a stair. Drawn as a rectangle - the "
                    "primitive has no curve and inventing one is the failure "
                    "this table exists to stop."),
    "GSB": dict(k="canopy", proj=2.20, t=0.25, top=4.50, mat="steel",
                src="[M] Graduate School of Business: a glazed marquee over "
                    "the entrance where the mirrored wall meets the plaza."),
    "UTX": dict(k="canopy", proj=2.40, t=0.35, top=3.30, mat="stone",
                src="[M] UTX: a tiled porch roof carried on posts over the "
                    "entrance of a low pavilion."),
    "MAG": dict(k="canopy", proj=6.00, t=0.30, top=4.60, mat="steel",
                src="[M] Manor Garage: a wide flat canopy over the toll lanes "
                    "at the vehicle entrance. A garage entrance is a vehicle "
                    "opening and this is what shelters it."),
    "SAG": dict(k="canopy", proj=6.00, t=0.30, top=4.60, mat="steel",
                src="[M] San Antonio Garage: the same toll canopy over the "
                    "entrance lane, signed 'San Antonio Garage'."),
    "ANB": dict(k="canopy",
                src="[M] Neill-Cochran House: a two-storey columned portico "
                    "over the entrance. Family V already draws this as its "
                    "PORCH - no dimensions here, the family owns them."),

    # -- ARCADE. The shelter is the building's own colonnade.
    "BMA": dict(k="arcade", src="[M] Blanton: the doors open off a vaulted "
                "arcade on the plaza, under the petal roofs."),
    "SEA": dict(k="arcade", src="[M] Seay: a two-storey column arcade runs "
                "the elevation; the entrance is behind it."),
    "JES": dict(k="arcade", src="[M] Jester: the low block's entrance sits "
                "behind a run of arched openings."),
    "HSM": dict(k="arcade", src="[M] HSM: a two-storey colonnade across the "
                "whole entrance front on the plaza."),
    "CDL": dict(k="arcade", src="[M] CDL: a hipped-roof pavilion carried on "
                "columns - the roof over the walk IS the shelter."),
    "CCJ": dict(k="arcade", src="[M] Connally Center: a classical columned "
                "portico across the entrance bay."),
    "GEA": dict(k="arcade", src="[M] GEA: the doors open off a covered loggia "
                "round the courtyard."),
    "HMA": dict(k="arcade", src="[M] Hogg Memorial Auditorium: a pilastered "
                "portico over the door bank."),
    "LTD": dict(k="arcade", src="[M] Littlefield Dormitory: the entrance is "
                "behind a run of round arches at the head of the terrace."),
    "SRH": dict(k="arcade", src="[M] Sid Richardson Hall: the whole building "
                "stands on a colonnade and every door opens off it."),

    # -- RECESS. The doors sit back under the building's own mass.
    "SJH": dict(k="recess", src="[M] San Jacinto Hall: the entrance is set "
                "into the base under the wings, at the head of a fan stair."),
    "RLP": dict(k="recess", src="[M] Patton Hall: a glazed ground floor set "
                "back under the deeply overhanging upper floors."),
    "SEZ": dict(k="recess", src="[M] South End Zone: a glazed storefront "
                "under the overhanging deck above."),
    "NHB": dict(k="recess", src="[M] Hackerman: the ground entrance is behind "
                "the piers; the big projecting element is a sunshade five "
                "storeys up, not a door canopy."),
    "WIN": dict(k="recess", src="[M] Winship: the doors are under the "
                "cantilevered upper mass, lit by a soffit of downlights."),
    "UTC": dict(k="recess", src="[M] University Teaching Center: the entrance "
                "is deep under the overhanging concrete mass."),
    "PAT": dict(k="recess", src="[M] Patterson: the ground floor is recessed "
                "the full length under the brick block above."),
    "CMA": dict(k="recess", src="[M] Jesse Jones Communication A: the whole "
                "ground floor steps back under the upper floors."),
    "MRH": dict(k="recess", src="[M] Music Building: the entrance is under a "
                "wide bridge of building with the stair rising through it."),
    "JGB": dict(k="recess", src="[M] Jackson Geosciences: the doors are set "
                "back under the overhanging floor above."),
    "JON": dict(k="recess", src="[M] Jones: the entrance is under the "
                "cantilevered upper block."),
    "WWH": dict(k="recess", src="[M] WWH: a recessed dark ground floor under "
                "the brick mass."),
    "COM": dict(k="recess", src="[M] COM: a recessed portal cut into the "
                "limestone block."),
    "NUR": dict(k="recess", src="[M] Nursing: the entrance is behind the "
                "brise-soleil, set back from the wall line."),
    "DFA": dict(k="recess", src="[M] DFA: the entrance is under the "
                "overhanging building above the lawn."),
    "MBB": dict(k="recess", src="[M] MBB: the entrance is a deep arched "
                "masonry passage through the building."),
    "TSC": dict(k="recess", src="[M] TSC: the doors are set back in a "
                "columned portal in the flat mass."),

    # -- FLUSH. Nothing over the door. The biggest class, and the one the old
    #    rule got wrong most often.
    "RSC": dict(k="flush", src="[M] Recreational Sports Center: banks of red "
                "aluminium doors flush in a flat masonry wall."),
    "ECJ": dict(k="flush", src="[M] Civil Engineering: doors at the head of a "
                "stair in a flat wall under the incised building name."),
    "BWY": dict(k="flush", src="[M] BWY: one door flush in a rusticated stone "
                "wall."),
    "WMB": dict(k="flush", src="[M] WMB: a flush door in a limestone wall."),
    "WEL": dict(k="flush", src="[M] Welch: a monumental limestone portal at "
                "the head of the steps - carved surround, no projection."),
    "BEN": dict(k="flush", src="[M] Benedict: an arched portal at the head of "
                "a straight flight, flush in the wall."),
    "MEZ": dict(k="flush", src="[M] Mezes: a limestone door surround flush in "
                "the wall."),
    "TNH": dict(k="flush", src="[M] Townes: a carved limestone door surround "
                "at the head of the steps."),
    "PHR": dict(k="flush", src="[M] Pharmacy: a balustraded limestone stair "
                "to a carved door surround with an oculus over it - the "
                "photograph the last round cited AGAINST family C's awning."),
    "CS3": dict(k="flush", src="[M] CS3: a plain opening in a brick utility "
                "wall."),
    "PPL": dict(k="flush", src="[M] Power Plant: a big arched opening flush "
                "in the brick."),
    "PPE": dict(k="flush", src="[M] PPE: a full-height overhead door flush in "
                "the wall."),
    "PPA": dict(k="flush", src="[M] PPA: a flat brick utility elevation."),
    "LCH": dict(k="flush", src="[M] Littlefield Carriage House: an arched "
                "opening in red brick, nothing over it."),
    "MFH": dict(k="flush", src="[M] Mithoff Field House: a flat limestone "
                "base under the brick, signed, no projection."),
    "BME": dict(k="flush", src="[M] Biomedical Engineering: a dark recessed "
                "opening in a flat limestone base, no canopy."),
    "POB": dict(k="flush", src="[M] O'Donnell: punched openings in a flat "
                "limestone base."),
    "GWB": dict(k="flush", src="[M] GWB: an open TRELLIS runs the terrace - "
                "open timber, not a solid canopy, and the doors are flush in "
                "the wall behind it."),
    "AHG": dict(k="flush", src="[M] AHG: arched openings flush in the brick."),
    "AND": dict(k="flush", src="[M] AND: a flush entrance in the limestone "
                "base."),
    "BHD": dict(k="flush", src="[M] BHD: a flush arched entrance."),
    "CRD": dict(k="flush", src="[M] Carothers: a round-arched portal flush in "
                "the wall."),
    "EPS": dict(k="flush", src="[M] EPS: a small square portal flush in the "
                "brick-and-limestone wall."),
    "GAR": dict(k="flush", src="[M] Garrison: a carved round-arched portal, "
                "lanterns either side, no projection."),
    "GOL": dict(k="flush", src="[M] Goldsmith: a portal flush in the wall on "
                "the court side."),
    "GRE": dict(k="flush", src="[M] Gregory Gym: three great arched doors at "
                "the head of the steps, flush in the brick."),
    "HRH": dict(k="flush", src="[M] Homer Rainey: a carved door surround at "
                "the head of the steps."),
    "PAI": dict(k="flush", src="[M] Painter: a carved portal flush in the "
                "limestone."),
    "PHD": dict(k="flush", src="[M] PHD: a flush entrance off the court."),
    "RHD": dict(k="flush", src="[M] Roberts: a flush arched entrance."),
    "UNB": dict(k="flush", src="[M] Texas Union: a round-arched portal flush "
                "in the wall on the West Mall front."),
    "BIO": dict(k="flush", src="[M] Biological Labs: a flush opening under "
                "the Gilbert arcade band."),
    "BTL": dict(k="flush", src="[M] Battle Hall: a flush entrance under the "
                "arcaded wall."),
    "SUT": dict(k="flush", src="[M] Sutton Hall: THE reference door - a round "
                "arch with a leaded fanlight and a pair of green bronze "
                "leaves, flush in the limestone. Nothing over it."),
    "GEB": dict(k="flush", src="[M] GEB: a flush opening in the limestone "
                "base."),
    "BRG": dict(k="flush", src="[M] Brazos Garage: a plain vehicle opening."),
    "GUG": dict(k="flush", src="[M] Guadalupe Garage: a plain vehicle "
                "opening."),
    "TRG": dict(k="flush", src="[M] Trinity Garage: a signed vehicle opening, "
                "flush in the concrete frame."),
}


SHELTER_USED = set()   # (ref, role) pairs an observation actually reached


def shelter_for(ref, role, b=None, c=None):
    """What the photograph says stands over THIS door, or None if nobody
    looked. Returns (kind, row) so a caller can cite the row it obeyed.

    A photograph of a front door evidences the front door only
    (SHELTER_APPLIES_TO). Every other door on the same building falls back to
    the default, which is the whole point: the file may not generalise one
    picture across a building it never saw the back of."""
    row = SHELTER_OBS.get(ref or "")
    if not row:
        return None, None
    if role not in SHELTER_APPLIES_TO:
        if not (SHELTER_FALLBACK_NO_MAIN and b is not None and c is not None
                and not any(e.role == "main" for e in b.ents)
                and c is max(b.ents, key=lambda e: (e.score, -e.x, -e.y))):
            return None, None
    return row["k"], row


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
        arcade=True,                            # [C] campus_truth.json, off the
                                                # north+west photograph: "4 round
                                                # arches at grade (1 door, 3
                                                # windows)" on the north front,
                                                # the arcade continuing round
                                                # the west. The other bays are
                                                # drawn by js/slopes-arches.js
                                                # from the `arcade` member.
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
        fam="V", tier=2,                        # Littlefield HOUSE, 1894
        open_w=2.00, n=2, dt="arched-pair", mat="timber",
        risers=4, rail=True, cheek=False,
        note="1894 Victorian, James Wahrenberger. The ROOF is still the "
             "identity here, not the door [D] — multicoloured slate and two "
             "mismatched towers — and celebrated.md is right that the budget "
             "belongs there. It was given the NULL door because there was no "
             "19th-century vocabulary; there is one now, so it takes family V "
             "rather than a flush aluminium storefront on an 1894 mansion. "
             "celebrated.md §5.9 records porch/columns/doors as [U]; this pass "
             "read a photograph (Commons, Littlefield House - UT Austin, "
             "54984939058) and can now say the entrance is a doorway RECESSED "
             "behind polished stone Corinthian columns under a two-storey iron "
             "veranda, over a stone flight of about five risers with a thin "
             "retrofitted pipe rail. That is family V's shape exactly. The "
             "authored open_w / n / risers / rail are unchanged. Do not confuse "
             "with Littlefield Dormitory (LTD) or the Carriage House (LCH): "
             "three different buildings.",
    ),
    "LBJ": dict(
        fam="D", tier=1,
        fam_src="[M] UT Direct's own building photograph (LBJ, fetched "
                "2026-08-27): a windowless ten-storey travertine block on a "
                "raised plaza. The register dates it 1971, which the date test "
                "reads as family C — a 3.05 m aluminium storefront under a "
                "concrete awning. That is the ONE thing this building's own "
                "note says never to draw on it. D is the monumental-modern "
                "family and is kept deliberately, not by inertia.",
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
        fam_src="[M] UT Direct's own building photograph (HRC, fetched "
                "2026-08-27): a travertine box carried on a colonnade with a "
                "FULL-HEIGHT GLAZED ground floor running the length of the "
                "elevation behind the columns. The register's 1972 reads as "
                "family C, whose storefront head is 3.05 m; the photographed "
                "glazing is a whole storey and keeps going. D.",
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
        fam_src="[M] UT Direct's own building photograph (PAC, fetched "
                "2026-08-27): a multi-storey glass curtain-wall lobby with a "
                "visible structural mullion grid, hung with the venue's "
                "banners. The register's 1980 reads as family C. The "
                "photograph is family D and settles the note below, which had "
                "called the glazed band 'genre knowledge'.",
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
                fam_src="[M]/[C] MEASURED THIS ROUND, because C on a 1930 "
                        "building looks exactly like the defect this branch "
                        "exists to remove and it is not one. Welch is THREE "
                        "buildings under one Overture footprint: the 1929 "
                        "Herbert M. Greene / Laroche & Dahl Chemistry "
                        "Building, a 1959 wing by Preston M. Geren and a 1974 "
                        "wing by Wyatt C. Hedrick [C], en.wikipedia.org/wiki/"
                        "Welch_Hall_(University_of_Texas_at_Austin). UT's own "
                        "register dates the building 1930, which the date test "
                        "reads as family B. But plotting UT Facilities' three "
                        "surveyed WEL doors (E, NE, NW) on USGS NAIP "
                        "orthoimagery [M] puts ALL THREE on the flat "
                        "pale-roofed later wings, not on either of the "
                        "red-tile-roofed 1929 blocks — so every door this file "
                        "actually draws on WEL is on post-war fabric, and C is "
                        "the correct family FOR THOSE DOORS. The 1929 portal "
                        "is real and is documented "
                        "(commons.wikimedia.org/wiki/File:Welch_Hall_UT_Austin_"
                        "Texas_2024.jpg, CC BY 4.0, Larry D. Moore, 2024-08-06: "
                        "semicircular arch, wrought-iron fanlight grille, "
                        "CHEMISTRY carved in limestone, two lanterns, a "
                        "monumental stair with stone cheeks and pipe rails) — "
                        "it is simply not at any coordinate this pass has, so "
                        "it is NOT drawn. Placing it on a guessed wall would "
                        "be inventing structure.",
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
REG_NAME_JOINED = []    # (ref, footprint name) rows the register name join made
NAME_TO_REF = {
    "Goldsmith Hall": "GOL",
    "Robert A. Welch Hall": "WEL",
    "Welch Hall": "WEL",
}

# ── ERAS FROM MEASURED YEARS ──────────────────────────────────────────
# data/ut_buildings.json is UT's own register: ref -> the year the
# building was first occupied. eras.md §5.2 always wanted a DATE TEST
# (rule 6) and fell back to the hand-maintained named list below only
# because no dated source existed. One does now, so the cascade runs
# §5.2's date test on the measured year, with §5.2's own boundaries, and
# the named list survives only for refs the register does not carry.
# Authored overrides still win: the WC table, the NULL refs and the
# CELEBRATED families all sit above the date test, exactly as §5.2
# orders it — a name is evidence where a date is a proxy, but a MEASURED
# date beats a hand-guessed family.
def reg_name_key(s):
    """Case, punctuation and the one abbreviation the register actually uses.

    Deliberately NOT a fuzzy matcher. Two names collapse to the same key only
    when they are the same words in the same order; no token-overlap, no
    Jaccard, no substring. graph.md §5 rejected an automatic name join because
    a 0.5-Jaccard hit on the token "austin" would have put the Lake Austin
    Centre on top of the Blanton — that failure mode needs partial matching
    and this function cannot produce one."""
    s = (s or "").lower().replace("&", " and ")
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return " ".join(REG_ABBREV.get(t, t) for t in s.split())


# The register's OWN abbreviations, read off the register's own name column and
# nothing else — every key below is a token that literally appears in
# data/ut_buildings.json, and every value is the long form the same register
# spells out in another row. This is a NORMALISATION, not a similarity score:
# after it runs the two names either are the same words in the same order or
# they are not, and reg_name_key() still cannot produce a partial match. The
# failure graph.md §5 rejected (a 0.5-Jaccard hit on "austin" putting the Lake
# Austin Centre on top of the Blanton) needs partial matching and is still
# impossible here. `bldg` was already in this function; the rest are its
# siblings, found by tokenising all 198 register names and reading out every
# token that is short or ends in a period (the audit that produced them is in
# docs/entrances/doors-in-the-right-clothes.md §3).
#
# WHAT IT ACTUALLY BUYS, MEASURED, and it is small: 3 doors, on one building —
# "AT&T Executive Education and Conference Center" (the footprint) against
# "AT&T EXECUTIVE EDUC & CONF CENTER" (the register), which is ATT, occupied
# 2008. Every join it makes is printed by name every run, so a wrong one is a
# line in the log rather than a silent relabel.  [S] data/ut_buildings.json
REG_ABBREV = {
    "bldg": "building", "ctr": "center", "engr": "engineering",
    "disc": "discovery", "educ": "education", "conf": "conference",
    "comm": "communication", "equip": "equipment", "maint": "maintenance",
    "univ": "university", "tx": "texas", "sci": "science",
    "rec": "recreational", "tech": "technology", "math": "mathematics",
    "rehab": "rehabilitation", "trk": "track", "labs": "laboratories",
    "ofc": "office", "jr": "junior",
}
if ERA_BASELINE:                      # keep only the one that was always here
    REG_ABBREV = {"bldg": "building"}


UT_REGISTER = os.path.join(ROOT, "data", "ut_buildings.json")
YEAR_BY_REF = {}
REG_CODES = set()
REG_NAME_TO_REF = {}
if os.path.exists(UT_REGISTER):
    _rows = json.load(open(UT_REGISTER, encoding="utf-8"))["buildings"]
    for _e in _rows:
        if _e.get("ref") and isinstance(_e.get("occupied"), int):
            YEAR_BY_REF[_e["ref"]] = _e["occupied"]
        if _e.get("ref"):
            REG_CODES.add(_e["ref"])
    # The register writes its names in caps and abbreviates ("AUTRY C.
    # STEPHENS ENGR DISC BLDG"), so this normalisation is what makes an
    # EXACT comparison possible at all — it is not a fuzzy match and it must
    # never become one. A register name shared by two codes is dropped here,
    # and a name carried by two footprints is dropped at join time.
    _seen = {}
    for _e in _rows:
        if not _e.get("ref") or not _e.get("name"):
            continue
        _k = reg_name_key(_e["name"])
        if _k in _seen and _seen[_k] != _e["ref"]:
            REG_NAME_TO_REF.pop(_k, None)
            continue
        _seen[_k] = _e["ref"]
        REG_NAME_TO_REF[_k] = _e["ref"]

# ══════════════════════════════════════════════════════════════════════
#  THE REGISTER IS NOT THE WHOLE REGISTER — 23 codes carry a drawn door and
#  no year
#
#  data/ut_buildings.json has 198 rows and every one of them has a year, which
#  reads like full coverage and is not: sweeping every building code that
#  actually carries a door in data/entrances.geojson found 23 with no row in
#  it at all, and those doors were falling all the way through the cascade to
#  the E5 null door.
#
#  UT publishes the missing years itself, per code, with NO LOGIN, at
#      https://utdirect.utexas.edu/apps/campus/buildings/information/nlogon/
#          maps/UTM/<CODE>/
#  which serves "UT Building Since: <year>" alongside the address, the floor
#  count and the gross square footage. Fetched 2026-08-27, one request per
#  code, for EVERY code with a door and no register row — not a hand-picked
#  few, so the table cannot be accused of cherry-picking the flattering ones.
#  Nine of the 23 have no page at all (LLA/LLB/LLC/LLD/LLE/LLF, MBE, EAS,
#  and the non-UT hotel AUSUAHX / BMC / MNAC) and are recorded here as None so
#  the next sweep does not re-fetch them hoping for a different answer.
#
#  FROZEN rather than fetched at bake time for the same reason _ENTRANCE_ROWS
#  and _BUILDING_ROWS are: a live query the bake depends on is a live query
#  the bake can silently lose. It is also NOT written into
#  data/ut_buildings.json — that file is another bake's output and this lane
#  writes exactly one file (CLAUDE.md lane rule).
#
#  Most of these are plant, and NULL_NAME_PARTS still beats a year, so most of
#  them change nothing — that is deliberate. A cooling tower with a measured
#  2014 on it must still get the null door, and the year is recorded so the
#  NEXT reader does not have to re-derive that it was checked. The four that
#  actually move a door are marked.                        [S] utdirect.utexas.edu
YEAR_UTDIRECT_URL = ("https://utdirect.utexas.edu/apps/campus/buildings/"
                     "information/nlogon/maps/UTM/%s/")
YEAR_UTDIRECT_DATE = "2026-08-27"
YEAR_UTDIRECT = {
    "COM": 1961,    # COMPUTATION CENTER          — MOVES 5 doors E5 -> C
    "UPB": 1960,    # UNIVERSITY POLICE BUILDING  — MOVES 3 doors E5 -> C
    "ARC": 1977,    # ANIMAL RESOURCES CENTER     — MOVES 2 doors E5 -> C
    "NEZ": 2008,    # NORTH END ZONE BUILDING     — MOVES 6 doors, with REF_SPLIT
    "WCH": 1932,    # WILL C. HOGG BLDG.
    "STD": 1988,    # DARRELL K ROYAL TX MEMORIAL STADIUM
    "TCP": 2004,    # TEXAS COWBOYS PAVILION
    "ATT": 2008,    # AT&T EXECUTIVE EDUC & CONF CENTER — reached by REG_ABBREV
    "ACS": 2026,    # AUTRY C. STEPHENS ENGR DISC BLDG
    "JES": 1969,    # BEAUFORD H. JESTER CENTER
    "JCD": 1969,    # JESTER RESIDENCE HALL
    "KIN": 1958,    # KINSOLVING RESIDENCE HALL
    # ── plant. Dated, and still E5 by NULL_NAME_PARTS. Recorded, not used.
    "PPL": 1927,    # HAL C. WEAVER POWER PLANT
    "PPA": 1968,    # HAL C. WEAVER POWER PLANT ANNEX
    "PPE": 1988,    # HAL C WEAVER POWER PLANT EXPANSION
    "CS3": 1970,    # CENTRAL CHILLING STATION NO. 3
    "CS5": 1986,    # CENTRAL CHILLING STATION NO. 5
    "CS6": 2009,    # CENTRAL CHILLING STATION NO. 6
    "CT2": 2017,    # UTM COOLING TOWER 2
    "CT7": 2014,    # UTM COOLING TOWER 7
    "TS1": 2011,    # UTM THERMAL STORAGE 1 — see NULL_NAME_PARTS below
    "TS2": 2014,    # UTM THERMAL STORAGE 2
}
# ── PLANT BY CODE, because the name test cannot reach a nameless footprint.
#
#  CAUGHT BY THE ERA PROVENANCE AUDIT ON ITS FIRST RUN, and written down
#  because the near-miss is the whole argument for building the audit first.
#  Adding "thermal storage" to NULL_NAME_PARTS was supposed to stop UTM Thermal
#  Storage 1 and 2 taking family D's seven-metre glazed lobby once YEAR_UTDIRECT
#  gave them a 2011/2014 date. It did not, and the diff said so: TS1, TS2 and
#  CT7 went E5 -> D. Their footprints carry NO NAME AT ALL — only the code — so
#  a name test can never fire on them, and the year sailed straight through into
#  a curtain-wall entrance on a chilled-water tank.
#
#  The rule is fixed at the level the rule was wrong: plant is identified by the
#  thing these footprints actually carry, which is the code. Every code here is
#  one whose UT Direct page names it plant in its own title (CENTRAL CHILLING
#  STATION, UTM COOLING TOWER, UTM THERMAL STORAGE, HAL C. WEAVER POWER PLANT).
#  This is not a second guess about their age — the dates above stay, and stay
#  correct. It is a statement that a cooling tower does not have a front door,
#  which was always NULL_NAME_PARTS's intent.                     [M] utdirect
PLANT_REFS = frozenset((
    "TS1", "TS2",                     # UTM THERMAL STORAGE 1 / 2
    "CT2", "CT7",                     # UTM COOLING TOWER 2 / 7
    "CS3", "CS5", "CS6",              # CENTRAL CHILLING STATION 3 / 5 / 6
    "PPL", "PPA", "PPE",              # HAL C. WEAVER POWER PLANT (+ annex, exp)
))

# Codes swept on 2026-08-27 that UT Direct itself has no page for. Kept so the
# sweep is reproducible and the next reader can see it was actually asked.
YEAR_UTDIRECT_NOPAGE = ("LLA", "LLB", "LLC", "LLD", "LLE", "LLF", "MBE",
                        "EAS", "BMC", "MNAC", "AUSUAHX", "RMRZ", "SRD", "DKR")
# YEAR ONLY. Deliberately NOT added to REG_CODES: that set is the
# REGISTER_SCOPE admission list, and putting the stadium (STD) or a conference
# hotel (ATT) into it would pull whole new footprints into the pass through a
# side door. This table answers "how old is it", never "is it in scope".
if ERA_BASELINE:
    YEAR_UTDIRECT = {}
for _c, _y in YEAR_UTDIRECT.items():
    YEAR_BY_REF.setdefault(_c, _y)      # the register still wins where it has one

# eras.md §5.2 rule 6, boundaries verbatim. Parameterised per CLAUDE.md
# rule 11: each pair is (last year of the family, family).
#
# THE 1909 BOUNDARY IS THE REGISTER'S, NOT MINE. eras.md §5.2 rule 6 had no
# family below 1925 because the hypothesis had none, and the bake happily
# handed a 1904 building a Cass Gilbert arcade and a 1859 one the null door.
# Sorting data/ut_buildings.json by year: the five oldest are 1859, 1888,
# 1894, 1894, 1904, and then it jumps to BTL 1911 — Battle Hall, Gilbert's
# own first building. So the gap in the data IS the boundary, and 1909 is
# just the last year inside it.
ERA_BOUNDS = ((1909, "V"), (1925, "A"), (1949, "B"), (1989, "C"))
ERA_AFTER = "D"

# A CELEBRATED row whose hand-typed `fam` disagrees with the measured year must
# carry `fam_src`. With this False the old behaviour comes back in one line
# (CLAUDE.md rule 11) — the flag exists so the change is reversible and
# testable, not because the old behaviour is defensible.
CEL_FAM_NEEDS_SRC = True




def era_family_from_year(year):
    for last, fam in ERA_BOUNDS:
        if year <= last:
            return fam
    return ERA_AFTER


# eras.md §6 — the fallback named list, keyed on ref. Since the register
# landed this list only decides refs WITHOUT a measured year; it is kept
# because a name is still evidence where no measurement exists.
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
#
# THREE OF THE FOUR CAME OFF THIS LIST WHEN FAMILY V LANDED. They were null
# because there was no vocabulary for them, which is a budget decision
# masquerading as a judgement — eras.md §1 said so out loud ("writing a fifth
# monumental vocabulary for two buildings ... is not worth it IN THIS PASS").
# There is a vocabulary now, it is measured off one of those very buildings,
# and it covers four of the five the register dates before Gilbert.
#
# LCH STAYS NULL, and this is not an oversight. The Littlefield Carriage House
# is an 1894 OUTBUILDING: what it has is a carriage bay, not a portico with a
# fanlight, and NO photograph and NO description of it was found. Family V's
# porch on a coach house would be a confident lie. A dull correct door on a
# building nobody has looked at is the honest answer (eras.md §4E5).
NULL_REFS = frozenset(("LCH",))
# `thermal storage` joined this list the day YEAR_UTDIRECT landed and for
# exactly that reason: UT Direct dates UTM THERMAL STORAGE 1 and 2 to 2011 and
# 2014, and with a year in hand the cascade would have handed two chilled-water
# tanks family D's 7 m glazed lobby. A measured date is evidence about AGE, not
# about whether the thing has a front door. Plant was always meant to be null;
# the list just never had to say this word before.
NULL_NAME_PARTS = ("chilling station", "cooling tower", "power plant",
                   "facilities complex", "sign shop", "field support",
                   "carriage house", "thermal storage")
if ERA_BASELINE:
    NULL_NAME_PARTS = NULL_NAME_PARTS[:-1]
# The two lists AS THEY STOOD before family V, frozen, so that
# classify_pre_register() keeps telling the truth about what moved. It is a
# historical record and it must not drift when the live list is edited.
NULL_REFS_PRE = frozenset(("LFH", "LCH", "JHH", "ANB"))
NULL_NAME_PARTS_PRE = ("chilling station", "cooling tower", "power plant",
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

# ══════════════════════════════════════════════════════════════════════
#  OSM'S OWN `building=*`, WHICH THIS FILE WAS ALREADY FETCHING AND THROWING
#  AWAY
#
#  join_refs() has always read the OSM tag block — that is where `ref` and the
#  OSM `name` come from — and it has always used exactly ONE field out of it:
#  `building=garage|parking` (plus `amenity=parking`) to set cls="parking".
#  The other 69 class-bearing tags in the same 384 rows went in the bin, so an
#  Overture footprint that carries no building_class of its own fell to E5 even
#  when OSM was sitting right there saying `building=church`.
#
#  Measured on this data, that cost TEN CHURCH DOORS — All Saints' Episcopal,
#  University Christian, University Avenue Church of Christ, University United
#  Methodist, the University Catholic Center — every one of them drawn with
#  E5's flush 2.20 m aluminium door when family E4 (arched head, wood leaves,
#  leaded glass, limestone surround) exists in this very file and was never
#  reaching them. Plus 15 apartment doors, 5 dormitory and 2 detached.
#
#  The trust argument is that there is no new trust: this is the same table,
#  the same spatial join, and the same `not tgt.cls` guard the parking branch
#  has used since the pass was written. It only ever FILLS a class Overture
#  left empty; it can never overwrite one. Every value below is a value
#  CLASS_FAMILY already understands — this map exists so the two lists cannot
#  drift apart silently, and so the whole behaviour is one editable table
#  (CLAUDE.md rule 11) rather than a condition buried in the join.
#
#  `university`, `office`, `commercial`, `public`, `hospital`, `college`,
#  `school`, `retail`, `stadium`, `yes` are deliberately ABSENT. E5 is the
#  honest answer for a building whose only claim is that it is a building, and
#  a four-family scheme with no null case gives Chipotle a Paul Cret portal.
OSM_CLASS = {
    "garage": "parking", "parking": "parking",
    "church": "church", "chapel": "church", "cathedral": "church",
    "mosque": "mosque", "synagogue": "church",
    "apartments": "apartments", "residential": "residential",
    "house": "house", "detached": "detached", "dormitory": "dormitory",
}
if ERA_BASELINE:                      # the two the parking branch always had
    OSM_CLASS = {"garage": "parking", "parking": "parking"}
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
                 "cx", "cy", "wc", "reg", "famwhy")


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
        b.reg = False          # carries a UT register code inside SURVEY
        b.ents = []
        b.fam = "E5"
        b.famwhy = "default"
        b.budget = 0
        out.append(b)
    return out


OSM_CLASS_FILLED = []    # (class, who) rows the OSM class fill actually made
REF_SPLIT_ROWS = []      # (raw, chosen) rows the multi-value ref split made


def split_ref(raw):
    """An OSM `ref` may be MULTI-VALUED, and one on this campus is.

    OSM's convention for a tag that legitimately holds several values is to
    join them with a semicolon, and the Red McCombs Red Zone footprint carries
    `ref=RMRZ;NEZ` — two real UT codes on one structure. Compared whole, that
    string equals no code at all, so the footprint matched nothing, took no
    year, and its SIX doors came out as E5 null doors even though NEZ (North
    End Zone Building) is dated 2008 by UT's own register page.

    The rule is the narrowest one that fixes it and it is not a fuzzy match:
    split on `;`, and prefer the first token the register actually knows. If
    the register knows none of them, take the first token, which is exactly
    what a single-valued ref would have given. A ref with no semicolon in it
    goes through this function unchanged, so it cannot disturb the other 176.
    Every split is printed by run so a wrong pick is a line in the log."""
    if ERA_BASELINE or not raw or ";" not in raw:
        return raw
    parts = [p.strip() for p in raw.split(";") if p.strip()]
    if not parts:
        return raw
    pick = next((p for p in parts if p in YEAR_BY_REF), parts[0])
    REF_SPLIT_ROWS.append((raw, pick))
    return pick


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
        ref = split_ref(ref)
        if ref and not tgt.ref:          # a ref beats a bare name
            tgt.ref = ref
            hit += 1
        if name and not tgt.osm_name:
            tgt.osm_name = name
        # OSM's own class, but only ever INTO an empty one. See OSM_CLASS.
        cls = OSM_CLASS.get(bt) or ("parking" if am == "parking" else None)
        if cls and not tgt.cls:
            tgt.cls = cls
            OSM_CLASS_FILLED.append((cls, ref or name or "(unnamed)"))
    for b in blds:                       # authored codes OSM does not carry
        if not b.ref:
            nm = b.name or b.osm_name
            if nm and nm in NAME_TO_REF:
                b.ref = NAME_TO_REF[nm]
    # ── THE REGISTER NAME JOIN. A footprint whose name is letter-for-letter
    #    one of UT's own register names, and the only footprint carrying that
    #    name, takes that code. Two gates, both hard: the register name must
    #    belong to exactly one code (enforced when REG_NAME_TO_REF is built)
    #    and the footprint name must belong to exactly one footprint. A code
    #    the spatial join already found is never overwritten.
    if REGISTER_NAME_JOIN:
        pool = defaultdict(list)
        for b in blds:
            for nm in (b.name, b.osm_name):
                if nm:
                    pool[reg_name_key(nm)].append(b)
        for key, ref in sorted(REG_NAME_TO_REF.items()):
            cands = pool.get(key) or []
            if len(cands) != 1:
                continue
            b = cands[0]
            if b.ref:
                continue                 # measured tag beats a name every time
            b.ref = ref
            REG_NAME_JOINED.append((ref, b.name or b.osm_name))
    return hit


def is_parking(b):
    nm = ((b.name or "") + " " + (b.osm_name or "")).lower()
    return b.cls == "parking" or "garage" in nm or "parking" in nm


# ══════════════════════════════════════════════════════════════════════
#  ERA PROVENANCE — the instrument, and it is the reason this round exists
#
#  classify() used to return a bare family letter, which meant the file could
#  not answer the only question that matters about it: WHERE DID THIS DOOR'S
#  ERA COME FROM, and was that a measurement or a guess. Nothing printed it,
#  nothing asserted it, and so nobody could see that 225 of 591 drawn doors —
#  38% of the campus — were wearing a family that came from no source at all.
#
#  Every rule in the cascade is now labelled with one of four grades:
#
#    MEASURED  a dated, first-party, checkable record said so — UT's own
#              register (data/ut_buildings.json), UT Direct's own building
#              page (YEAR_UTDIRECT), or OSM's own building=* tag.
#    AUTHORED  a human typed it into a table in this file WITH its evidence.
#              CELEBRATED rows and the West Campus lobby table. Trustworthy
#              in proportion to the citation, which is why `fam_src` is now
#              mandatory on every CELEBRATED row (see the assertion below).
#    GUESSED   a human typed it with no evidence recorded. The
#              hand-maintained FAMILY_BY_REF list is the whole of this grade
#              and it is meant to shrink.
#    NONE      nothing is known. E5 — a dull correct door on a building
#              nobody has looked at. This is an HONEST answer, not a failure,
#              and it must never be inflated into a confident wrong one.
#
#  The grade is written onto the building and printed every run. It is also
#  written onto every emitted piece as `fam`, so a verification script can ask
#  the served file the same question without re-deriving this cascade.
ERA_GRADE = {
    "wc-table":      ("AUTHORED", "West Campus lobby table, westcampus.md"),
    "null-ref":      ("NONE",     "explicit NULL_REFS"),
    "null-name":     ("NONE",     "plant/outbuilding by name"),
    "celebrated":    ("AUTHORED", "CELEBRATED row, fam_src cited"),
    "parking":       ("MEASURED", "OSM building=garage / amenity=parking"),
    "worship":       ("MEASURED", "OSM building=church|mosque"),
    "register-year": ("MEASURED", "UT register / UT Direct occupied year"),
    "named-list":    ("GUESSED",  "hand-maintained FAMILY_BY_REF"),
    "osm-class":     ("MEASURED", "OSM building=* class"),
    "wc-secondary":  ("AUTHORED", "W tower's side/service door -> E2, "
                                  "westcampus.md"),
    "default":       ("NONE",     "nothing known — E5"),
}


def classify_why(b):
    """The cascade, docs/entrances/eras.md §5.2, WITH its rule-6 date test,
    running on the measured year in data/ut_buildings.json and (since
    2026-08-27) on UT Direct's own page for the 23 codes that file does not
    carry. First match wins, and the ORDER is §5.2's: authored evidence (WC
    table, NULL list, CELEBRATED) first, then the classes that no date can
    overrule (a 2003 garage is a garage, not a family-D glazed bay), then the
    measured year, then the hand-maintained named list for undated refs, then
    the residential class, and the LAST rule is NULL, not "C". Families are
    OPT-IN — but a measured year IS evidence, so a dated dormitory now gets
    its era's doorway rather than the E2 shrug, exactly as §5.2 rule 6 always
    specified for a present start_date.

    Returns (family, rule) — see ERA_GRADE for what each rule is worth."""
    if b.wc:
        return "W", "wc-table"          # the named list beats everything, here too
    nm = ((b.name or "") + " " + (b.osm_name or "")).lower()
    if b.ref in NULL_REFS or (not ERA_BASELINE and b.ref in PLANT_REFS):
        return "E5", "null-ref"
    for w in NULL_NAME_PARTS:
        if w in nm:
            return "E5", "null-name"
    if b.ref and b.ref in CELEBRATED:
        cel = CELEBRATED[b.ref]
        yr = YEAR_BY_REF.get(b.ref)
        # A HAND-TYPED FAMILY MAY OUTRANK A MEASURED YEAR ONLY IF IT SAYS WHY.
        # This is the rule the round was built around. Before it, CELEBRATED
        # sat above the date test unconditionally, and four of the twenty rows
        # disagreed with UT's own register with nothing written down either
        # way — so a 1930 limestone-and-brick building could wear a 1970s
        # aluminium storefront and the bake had no opinion about it. All four
        # are now cited (LBJ/HRC/PAC off UT Direct's own photographs, WEL off
        # NAIP + Wikipedia), and any FUTURE uncited disagreement loses to the
        # measurement instead of quietly winning.
        if (CEL_FAM_NEEDS_SRC and yr is not None
                and era_family_from_year(yr) != cel["fam"]
                and not cel.get("fam_src")):
            return era_family_from_year(yr), "register-year"
        return cel["fam"], "celebrated"
    if is_parking(b):
        return "E3", "parking"
    if b.cls in ("church", "mosque"):
        return "E4", "worship"
    year = YEAR_BY_REF.get(b.ref or "")
    if year is not None:
        return era_family_from_year(year), "register-year"
    if b.ref and b.ref in FAMILY_BY_REF:
        return FAMILY_BY_REF[b.ref], "named-list"
    if b.cls in CLASS_FAMILY:
        return CLASS_FAMILY[b.cls], "osm-class"
    return "E5", "default"


def classify(b):
    fam, why = classify_why(b)
    b.famwhy = why
    return fam


def classify_pre_register(b):
    """The cascade as it stood BEFORE the register (2026-08-05..14), kept
    verbatim so the bake can print exactly which buildings the measured
    years moved between families. Not used for placement."""
    if b.wc:
        return "W"
    nm = ((b.name or "") + " " + (b.osm_name or "")).lower()
    if b.ref in NULL_REFS_PRE:
        return "E5"
    for w in NULL_NAME_PARTS_PRE:
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


def snap_to_edge_ranked(bldg, px, py, limit):
    """snap_to_edge, but the `limit` nearest edges in order instead of one.

    Only the UT stage uses this, and only because a surveyed door is worth a
    second look: UT's point is a coordinate inside the doorway, so on a
    building with a re-entrant corner, a light well or a recessed entry court
    the nearest EDGE can be a wall whose outward normal points back into the
    mass. The single-edge snap then failed normal_test and the door — which a
    human at UT physically stood in front of — was dropped. Returning a short
    ranked list lets the caller keep walking outward until a wall actually
    faces the street."""
    out = []
    for ri, ring in enumerate(bldg.rings):
        for i in range(len(ring) - 1):
            a, bb = ring[i], ring[i + 1]
            qx, qy, t = _seg_closest(px, py, a[0], a[1], bb[0], bb[1])
            d = math.hypot(qx - px, qy - py)
            elen = math.hypot(bb[0] - a[0], bb[1] - a[1])
            out.append((d, qx, qy) + _norm(bb[0] - a[0], bb[1] - a[1]) +
                       edge_normal(a, bb, ri) + (elen, t * elen, ri, i))
    out.sort(key=lambda r: r[0])
    return out[:max(1, int(limit))]


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
                 "ri", "ei", "wcrole", "wcmeth", "run", "ut", "seat")

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
        self.ut = None            # (side, barrier-free, auto-opener) when UT's
                                  # own survey says this is the front door
        self.wcrole = None        # "lobby" | "gate" on a West Campus building
        self.wcmeth = None        # which method placed it, for the audit
        # (left, right) metres of straight wall, when the wall the door ended
        # up on is NOT an edge of the host footprint — i.e. after clear_buried()
        # relocated it onto another pass's mass. wall_run() walks b.rings and
        # would be answering a question about the wrong wall.
        self.run = None
        # (dlon, dlat) BACK to where the footprint ring would have put this
        # door, when seat_on_drawn_wall() pulled it onto an inset wall. Rides
        # every piece of the entrance as `wp` so ?wallplane=0 can undo it.
        self.seat = None


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


def ut_celebrated_rows():
    """The table above, parsed, grouped by building code."""
    out = defaultdict(list)
    for row in UT_CELEBRATED:
        p = row.split(" ")
        out[p[0]].append((float(p[1]), float(p[2]), p[3], p[4] == "Y",
                          p[5] == "Y"))
    return out


def stage_ut(blds, stats):
    """UT's surveyed front doors, applied last and applied hard.

    Two outcomes per UT door, and which one happens is measured, not assumed:

      RELABEL — a door we already placed sits within UT_MATCH_R of UT's point.
        It IS that door; the only thing wrong with it was the role. Promote it
        to `main`, demote whatever else on that building was calling itself
        main, and hang UT's own flags on it.

      PLACE — nothing of ours is within UT_MATCH_R. Then our data does not have
        that door at all (Biological Laboratories' west entrance is 62 m from
        our nearest), and it is placed here, snapped to the host wall through
        the same snap_to_edge / normal_test the OSM stage uses. `src` says
        `ut`, so the provenance is never laundered into `derived`.

    It runs AFTER stage 3 and before the two audits, so a UT door still has to
    survive the buried-door test like any other. It deliberately ignores
    `budget_for` — this file's stated rule is that truth is never deleted to
    satisfy a budget, and this is the most direct truth it has.
    """
    by_ref = defaultdict(list)
    for b in blds:
        if b.ref and b.budget >= 0:
            by_ref[b.ref].append(b)
    rows = ut_celebrated_rows()
    for code, doors in sorted(rows.items()):
        hosts = by_ref.get(code)
        if not hosts:
            stats["ut_no_host"] += 1
            continue
        claimed = []
        for lat, lon, side, bf, ao in doors:
            x, y = to_m(lon, lat)
            best, bd, bb = None, UT_MATCH_R, None
            for b in hosts:
                for c in b.ents:
                    d = math.hypot(c.x - x, c.y - y)
                    if d < bd:
                        best, bd, bb = c, d, b
            if best is not None:
                best.role = "main"
                best.ut = (side, bf, ao)
                # UT_SNAP: the survey owns the POSITION too, not just the role.
                # Only over a provenance in UT_SNAP_OVER — see the constant.
                if UT_SNAP and best.src in UT_SNAP_OVER:
                    sn = ut_pick_edge(bb, x, y, stats)
                    if sn is not None:
                        moved = math.hypot(sn[1] - best.x, sn[2] - best.y)
                        (_d, best.x, best.y, best.tx, best.ty, best.nx,
                         best.ny, best.elen, best.s, best.ri, best.ei) = sn
                        best.src = "ut"
                        best.run = None   # the wall it sits on has changed
                        stats["ut_moved"] += 1
                        stats["ut_moved_m"] += moved
                    else:
                        stats["ut_move_no_wall"] += 1
                elif UT_SNAP:
                    stats["ut_kept_own_survey"] += 1
                claimed.append((bb, best))
                stats["ut_relabelled"] += 1
                continue
            # nothing of ours is there: place it.
            host, hd = None, 1e9
            for b in hosts:
                d = b.poly.exterior.distance(Point(x, y))
                if d < hd:
                    host, hd = b, d
            if host is None or hd > OSM_MAX_SNAP:
                stats["ut_unplaceable"] += 1
                continue
            sn = ut_pick_edge(host, x, y, stats)
            if sn is None:
                stats["normal_fail_ut"] += 1
                continue
            d, qx, qy, tx, ty, nx, ny, elen, sa, ri, ei = sn
            c = Cand(qx, qy, tx, ty, nx, ny, elen, sa, "main", "ut",
                     11.0, 0, None, None, ri, ei)
            c.ut = (side, bf, ao)
            host.ents.append(c)
            claimed.append((host, c))
            stats["ut_placed"] += 1
        # One building, one front door per UT row and no others. Any OTHER
        # candidate still calling itself main is our own ranking disagreeing
        # with a survey, and the survey wins.
        for b, keep in claimed:
            for c in b.ents:
                if c.role == "main" and not any(c is k for _, k in claimed):
                    c.role = "secondary"
                    stats["ut_demoted"] += 1


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
                                SRC_PATH, 2.0 if hw == "steps" else 1.0, gen,
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
        # FIELD_MAX: the field may assert that this building HAS a door. It may
        # not assert how many. Anything past the first is the same guess spent
        # again on the next-best sample of the same wall-facing-a-walkway rule.
        placed_here = 0
        for sc, px, py, tx, ty, nx, ny, elen, d, ei in samples:
            if len(b.ents) >= b.budget:
                break
            if placed_here >= FIELD_MAX:
                stats["field_capped_bldgs"] += 1
                break
            if sc <= MIN_SCORE:
                break
            if any(math.hypot(px - o.x, py - o.y) < MIN_SEP for o in b.ents):
                continue
            if not normal_test(b, px, py, nx, ny):
                stats["normal_fail_stage3"] += 1
                continue
            b.ents.append(Cand(px, py, tx, ty, nx, ny, elen, d, None,
                               SRC_FIELD, sc, 3, None, None, 0, ei))
            DERIVED_ALL.append((px, py))
            placed_here += 1
            stats["stage3_placed"] += 1


def _side_ok(side, nx, ny):
    return {"E": nx > 0.5, "W": nx < -0.5,
            "N": ny > 0.5, "S": ny < -0.5}.get(side, False)


# UT's `Directional` column, as a unit vector in the bake's own (east, north)
# metric frame. Eight points, because that is what the survey actually uses —
# the 97 frozen rows contain exactly N/S/E/W/NE/NW/SE/SW and nothing else.
_UT_SIDE_VEC = {
    "N": (0.0, 1.0), "S": (0.0, -1.0), "E": (1.0, 0.0), "W": (-1.0, 0.0),
    "NE": (0.70710678, 0.70710678), "NW": (-0.70710678, 0.70710678),
    "SE": (0.70710678, -0.70710678), "SW": (-0.70710678, -0.70710678),
}


def ut_side_cos(side, nx, ny):
    """How well a wall's outward normal agrees with UT's published side.

    Returns None when the side is not one this file knows, so a caller can tell
    "UT disagrees" apart from "UT did not say" — the two must not collapse into
    the same falsy value, which is how a missing field silently becomes a
    finding."""
    v = _UT_SIDE_VEC.get((side or "").strip().upper())
    if v is None:
        return None
    return v[0] * nx + v[1] * ny


def ut_pick_edge(host, x, y, stats):
    """The wall a UT-surveyed door belongs on: the NEAREST wall to UT's own
    point that actually faces outward.

    Not the nearest wall full stop — that is what used to drop three surveyed
    doors a bake, because UT's coordinate sits inside the doorway and the
    nearest edge to a point in a re-entrant corner can be a wall whose outward
    normal points back into the mass. Not the wall UT's `Directional` column
    names either; the block above records the A/B that ruled that out."""
    for c in snap_to_edge_ranked(host, x, y, UT_EDGE_SCAN):
        if normal_test(host, c[1], c[2], c[5], c[6]):
            return c
    stats["ut_no_outward_wall"] += 1
    return None


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

# THE ARCHES, AS CURVES. Every arched head below is drawn as ARCH_TIERS flat
# chords because a fill-extrusion cannot slope or curve, and 448 of the 509
# arch pieces in the served file exist only because of that. js/slopes-arches.js
# draws the same head as one continuous quarter-ellipse in a three.js layer,
# and hides those chords while it does. So the numbers the chords are sampled
# from — the opening's frame on the wall, `half`, `spring_h`, `arch_rise`, and
# each tier's own depth and colour — are written here, once per entrance, as
# the `arches` foreign member of the FeatureCollection, keyed by `eid`. The
# reader restates no constant: the frame is in degrees per metre, the depths
# are the ones the chords were boxed at, the colours the ones they carry.
ARCHES = {}
# bid -> bay count actually drawn, so the West Campus audit can print the bay
# mix without re-deriving it from the geometry.
WC_AUDIT = {}


class Ent(object):
    """One entrance. Emits its own pieces, all of them proud of the wall."""

    def __init__(self, feats, eid, b, c, fam, cel, role, n, dt, mat, src,
                 famkey=None, famwhy=None):
        self.feats, self.eid = feats, eid
        self.bid, self.ref = b.bid, b.ref
        self.nm = b.name or b.osm_name
        self.role, self.era, self.n, self.dt, self.mat = role, fam["era"], n, dt, mat
        # `fam` and `famsrc` are the ERA PROVENANCE fields (see ERA_GRADE).
        # `era` alone cannot answer "what kind of door is this" — E2, E3, E4
        # and E5 all report era="utility", so a church's arched wood leaf and a
        # loading dock's roll shutter come out of the served file wearing the
        # same word, and neither a verification script nor a human can tell
        # them apart. The family letter and the rule that chose it are cheap
        # (two short strings on a piece that already carries eleven) and they
        # make the question answerable from the file the app actually fetches.
        # THE LETTER THE DOOR WAS ACTUALLY ASSEMBLED WITH, not the building's.
        # These are not always the same and the difference is deliberate: a
        # West Campus tower is family W, but only its ONE leasing lobby is
        # assembled as W — its side and service doors drop to E2, because a
        # second two-storey glazed storefront on the back of the same tower is
        # the double-draw this pass exists to avoid. Writing b.fam here would
        # have told the served file those back doors were W, which is the
        # instrument lying about the thing it was built to measure.
        self.fam = famkey or b.fam
        self.famsrc = famwhy or b.famwhy
        self._srcdone = False
        self.src = src
        self.cx, self.cy = c.x, c.y
        self.tx, self.ty, self.nx, self.ny = c.tx, c.ty, c.nx, c.ny
        self.night = (cel or {}).get("night")
        # `wp` — the degrees back to the footprint ring, when this door was
        # seated on an inset wall. See WALL_SEAT.
        self.seat = getattr(c, "seat", None)

    def pt(self, u, v):
        return to_ll(self.cx + u * self.tx + v * self.nx,
                     self.cy + u * self.ty + v * self.ny)

    def arch(self, kind, half, spring, rise, wd, wn, v0, v1, sw=None):
        """One curved piece of this entrance's head, for ARCHES (see there).

        `kind` is `tr` (the fanlight), `band` (the surround) or `sp` (the
        spandrel). `sw` is the band's horizontal width — the chords step
        OUTWARD by it, not along the curve's normal, and the mesh does the
        same so the two are the same shape. Colours are exactly what `box`
        would have written on the chords."""
        wg, wn_auto = wall_ramp(wd)
        ent = ARCHES.setdefault(self.eid, {
            "ref": self.ref, "bid": self.bid, "fam": self.fam,
            "o": list(to_ll(self.cx, self.cy)),
            "t": [round(self.tx / KX, 11), round(self.ty / M_LAT, 11)],
            "n": [round(self.nx / KX, 11), round(self.ny / M_LAT, 11)],
            "half": round(half, 3), "spring": round(spring, 3), "rise": round(rise, 3),
            **({"wp": self.seat} if self.seat else {}),
        })
        piece = {"v": [round(v0, 3), round(v1, 3)], "c": [wd, wg, wn or wn_auto]}
        if sw is not None:
            piece["sw"] = round(sw, 3)
        ent[kind] = piece

    def arcade_wall(self, left, right, sur_col, proj):
        """This door is one bay of an arcade: record the wall it can run along.

        `left`/`right` are wall_run()'s metres of straight wall either side of
        the door; the bays themselves are laid out in finish_arcades() once
        every door on the wall is known, because the pitch depends on where
        the other doors are."""
        ent = ARCHES.get(self.eid)
        if not ent:
            return
        wg, wn = wall_ramp(sur_col)
        dg, dn = wall_ramp(ARCH_SHADOW)
        ent["_wall"] = [round(-left, 3), round(right, 3)]
        ent["_xy"] = [self.cx, self.cy, self.tx, self.ty, self.nx, self.ny]
        ent["_role"] = self.role
        ent["_skin"] = {"v": [0.0, round(proj, 3)], "c": [sur_col, wg, wn]}
        ent["_dark"] = {"v": [ARCADE_DARK_V[0], ARCADE_DARK_V[1]], "c": [ARCH_SHADOW, dg, dn]}

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
            "fam": self.fam,
            "base": round(z0, 3), "h": round(z1 - z0, 3),
            "wd": wd, "wg": wg, "wn": wn or wn_auto, "src": self.src,
        }
        if self.seat:
            props["wp"] = self.seat
        # `famsrc` RIDES THE FIRST PIECE OF EACH ENTRANCE ONLY, and that is a
        # payload decision with a measured reason. It is one value per DOOR, but
        # a GeoJSON FeatureCollection has no per-door container, so writing it on
        # all 14,720 pieces cost 0.65 MB on a file the app already defers because
        # it is 6.7 MB (see the js/entrances.js header on ENT.defer). `fam` is
        # one or two characters and rides everything; `famsrc` is a word and
        # rides the reveal. The contract for a reader is therefore: GROUP BY
        # `eid` AND TAKE THE PIECE THAT CARRIES IT — which is what
        # scripts/verify/campusmeter.mjs does, and what any per-door question has
        # to do anyway.
        if not self._srcdone:
            props["famsrc"] = self.famsrc
            self._srcdone = True
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
                c.src, famkey="W", famwhy="wc-table")
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

    e = Ent(feats, eid, b, c, fam, None, "main", n_leaf, dt, "glass", c.src,
            famkey="W", famwhy="wc-table")
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
    # `csrc` on every canopy in the file, so "how many canopies are sourced"
    # is one query rather than an archaeology project. This one is
    # westcampus.md §1's signboard canopy, cited there.
    e.box("canopy", "steel", STEEL, -(half + WC_CAN_SIDE), half + WC_CAN_SIDE,
          0.0, cp, ctop - ct_, ctop, None,
          dict(ex or {}, csrc="westcampus"))
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

    # ── WHAT STANDS OVER THIS DOOR. Families A, B, E3, E4 and E5 already
    #    say `canopy=None` and the photographs agree with all of them (0 of
    #    23 observed). Families C, D and E2 asserted one on every door they
    #    touched and no photograph was ever consulted; V's porch and W's
    #    signboard are cited in eras.md/westcampus.md and stay. So the gate
    #    runs on exactly the three unevidenced families, and it runs the same
    #    way every time: obey the photograph, and where there is no
    #    photograph, draw nothing.
    #
    #    `fam_src`-style provenance rides out on the piece as `csrc`, so a
    #    later pass can find every canopy in the file and read why it is
    #    there without re-deriving this table.
    shelter, sh_row = shelter_for(b.ref, role, b, c)
    fam["shelter"] = shelter or "unknown"
    fam["canopy_src"] = None
    if fam_key not in ("V", "W"):
        # OBEY THE PHOTOGRAPH BOTH WAYS. A canopy the picture shows gets drawn
        # whatever family the building is in — the one canopy found on a plant
        # building (CS6) and the two toll canopies over garage lanes are the
        # reason this is not restricted to the three families that used to
        # assert one. And a canopy no picture shows is dropped, which only
        # ever bites C / D / E2, because they are the only families that had
        # one to drop.
        if shelter == "canopy":
            base = dict(CANOPY_MEDIAN)
            for k in ("proj", "t", "top", "mat"):
                if sh_row.get(k) is not None:
                    base[k] = sh_row[k]
            base["col"] = {"steel": STEEL, "concrete": CONCRETE,
                           "stone": LIMESTONE}.get(base["mat"], STEEL)
            fam["canopy"] = base
            fam["canopy_src"] = "photo"
            stats["canopy_photographed"] += 1
        else:
            if fam["canopy"]:
                stats["canopy_unevidenced_dropped"] += 1
                if not SHELTER_CANOPY_BY_DEFAULT:
                    fam["canopy"] = None
    elif fam["canopy"]:
        # V's porch, W's signboard: both cited in their own docs.
        fam["canopy_src"] = "family"

    # The shelter also sets how deep the reveal reads. This is a SHADE, not a
    # depth — see SHELTER_REVEAL_D — and it is the only part of `recess` and
    # `arcade` that reaches the screen at all.
    if shelter and SHELTER_REVEAL_D.get(shelter) is not None:
        fam["reveal_d"] = SHELTER_REVEAL_D[shelter]
        stats["shelter_reveal_" + shelter] += 1
    if shelter:
        # "reached a door" means the row actually applied, not merely that the
        # building has a door somewhere. MAG and SAG are the reason: both have
        # a photographed toll canopy and neither has a door the bake calls
        # `main`, so both rows sit idle and this line is what says so.
        SHELTER_USED.add((b.ref, role))
    src = c.src

    # ── the opening, clamped to the wall it sits on and slid clear of the
    #    corners. A 7.2 m Cret portal on a 4 m wall segment is a defect you can
    #    see; shrinking it is not.
    want_w = (cel or {}).get("open_w") if cel and role == "main" else None
    if want_w is None:
        want_w = fam["open_w"] if role == "main" else fam["open_w_sec"]
    left, right = c.run if c.run else wall_run(b, c.ri, c.ei, c.s)
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
                "glass": STEEL, "steel": IRON,
                "timber": VICT_LEAF}.get(mat, fam["leaf_col"])

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

    # Family V's fanlight is SPRUNG OFF ITS OWN DOOR HEAD, not off an authored
    # absolute height, and it is a SEGMENT rather than a semicircle. Both
    # matter. Family A's spring_h is an absolute 2.90 m while its own head sits
    # at 3.44 m, so its fanlight is drawn through the top of its doors — that
    # is a real defect in the oldest family here and this branch exists so the
    # new one does not inherit it. And a semicircular head on a 2.20 m bank
    # would put 1.10 m of glass over the door where the photograph shows 0.60.
    if fam.get("arch_from_head"):
        fam["spring_h"] = head + VICT_HEAD_GAP
        fam["arch_rise"] = half * fam["arch_rise_frac"]
        fam["transom_h"] = fam["arch_rise"]

    # ── 1. REVEAL. There is no CSG, so this is not a hole: it is a dark slab
    #       standing REVEAL_PROUD off the wall whose COLOUR is the shadow, plus
    #       two jamb returns that are the only real 3D depth in the assembly.
    #       Depth is read from value, not from geometry.
    e = Ent(feats, eid, b, c, fam, cel, role, n_leaf, dt, mat, src,
            famkey=fam_key,
            famwhy=("wc-secondary" if (b.wc and fam_key == "E2")
                    else b.famwhy))
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
                      sp + rr * t0, sp + rr * t1, gnight, extra=ARC_CHORD)
            e.arch("tr", half, sp, rr, gcol, gnight, PROUD_DOOR, PROUD_DOOR + LEAF_T)
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
                          0.0, sp_, spr + rr * t0, spr + rr * t1, extra=ARC_CHORD)
            e.arch("band", half, spr, rr, sur_col, None, 0.0, sp_, sw)
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
                          spr + rr * t0, spr + rr * t1, extra=ARC_CHORD)
            e.arch("sp", half, spr, rr, fam["accent"], None, 0.0, sp_ + 0.04, sw)
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

    # ── 4b. THE ARCADE this door is one bay of (see ARCADE_PIER_M).
    if fam["arched"] and (cel or {}).get("arcade") and sw > 0.01:
        e.arcade_wall(left, right, sur_col, sp_)
        stats["arcade_doors"] += 1

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
                    # A 19th-century flight carries a thin DARK iron pipe, not
                    # a bright mill-finish tube — both photographs this pass
                    # read show one. Every other family omits `rail_col` and
                    # gets STEEL exactly as before.
                    rcol = fam.get("rail_col", STEEL)
                    u = sgn * (flight_w / 2 - RAIL_D / 2)
                    e.box("rail", "steel", rcol, u - RAIL_D / 2,
                          u + RAIL_D / 2, v0, v1, ztop + RAIL_H - RAIL_D,
                          ztop + RAIL_H)
                    vm = (v0 + v1) / 2.0
                    e.box("rail", "steel", rcol,
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
        side = can.get("side", CANOPY_SIDE_D if fam_key == "D" else CANOPY_SIDE)
        # A canopy read off a photograph gets that photograph's projection, so
        # it also gets the plain side overhang — the wide one only ever
        # existed to make family D's invented blade legible.
        if fam.get("canopy_src") == "photo":
            side = CANOPY_SIDE
        # A PORCH is measured from the door it shelters, a blade from the
        # ground. Family V is the only one that gives `over_head`, and it does
        # so because its flight height can come out of OSM steps evidence — an
        # absolute top would then sit through its own fanlight.
        ct = (head + can["over_head"]) if can.get("over_head") else can["top"]
        if b.h and ct + 0.2 > b.h:
            ct = max(head + 0.4, b.h - 0.4)
        # A PORCH IS PART OF ITS BUILDING; AN AWNING IS NOT. §3.4 — family sets
        # geometry, HOST sets material — and the first cut of family V broke it
        # by painting all four porches in the terracotta sampled off ANB's own
        # trim. Photographed at walking height that landed a BRIGHT ORANGE SLAB
        # on Littlefield's deep red brick and on Hargis's tan brick: it read as
        # a shopfront awning, which is precisely the "looks like a shed door"
        # failure this family exists to fix. So the porch takes the host wall,
        # darkened. Only family V asks for `host`; every other canopy is
        # unchanged.
        ccol = (scale(b.wd, PORCH_HOST_DARKEN) if can.get("host")
                else can["col"])
        e.box("canopy", can["mat"], ccol, -(half + side), half + side,
              0.0, can["proj"], ct - can["t"], ct,
              extra={"csrc": fam.get("canopy_src") or "family"})
        e.box("canopy", can["mat"], can.get("soffit", SOFFIT_DK),
              -(half + side), half + side,
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


# ══════════════════════════════════════════════════════════════════════
#  TWO AUDITS THAT DELETE OR MOVE DOORS, run after all four placement
#  stages and before roles are assigned.
#
#  Both exist because a door can be WRONG in a way no placement rule can
#  see from the footprint alone: the footprint is not what gets rendered.
#  Seven other passes rebuild whole buildings out of authored masses, and
#  celebrated.md enumerates some buildings' doors exhaustively. Neither
#  fact is visible to a scoring loop over an Overture ring.
# ══════════════════════════════════════════════════════════════════════
def claimed_building_ids():
    """Every footprint id an authored pass has taken over, so `austin-buildings`
    does NOT extrude it. A claimed ring is drawn by that pass's own geometry
    (which is already in BURIED_MASS_FILES) and must not be counted twice."""
    out = set()
    for fn in BURIED_CLAIM_FILES:
        path = os.path.join(ROOT, "data", fn + ".geojson")
        if not os.path.exists(path):
            continue
        try:
            doc = json.load(open(path, encoding="utf-8"))
        except Exception:
            continue
        for bid in (doc.get("replacedBuildingIds") or []):
            out.add(str(bid))
    return out


def load_masses():
    """Everything the RENDERER EXTRUDES at ground level, in the metric frame.

    Returns (polys, owners): `owners[i]` is the footprint id a polygon belongs
    to, or None for an authored mass. The caller uses it to skip a door's own
    host exactly, by id, instead of inferring it from an overlap ratio.

    Two sources, because the renderer has two:

      1. the authored masses in BURIED_MASS_FILES. Only a mass that starts at
         grade and rises past a door head can hide a door, so the filter
         happens once here rather than 600 times below. `h` is an absolute top
         in every one of these files (heroes, stadium, moody, arts, drag,
         tower, westcampus); capitol carries whole buildings with
         `final_height` and no base; parts uses OSM's min_height_m/height_m.

      2. THE FOOTPRINTS `austin-buildings` DRAWS — the thing this rule was
         blind to until QUEUE NB2, and the reason the Moody Center's five doors
         rendered zero pixels while passing every numeric check. Minus every id
         an authored pass claims, because a claimed ring is not drawn.
    """
    out, owner = [], []
    for fn in BURIED_MASS_FILES:
        path = os.path.join(ROOT, "data", fn + ".geojson")
        if not os.path.exists(path):
            continue
        doc = json.load(open(path, encoding="utf-8"))
        for f in doc.get("features") or []:
            pr = f.get("properties") or {}
            base = pr.get("base")
            if base is None:
                base = pr.get("min_height_m") or 0.0
            top = pr.get("h")
            if top is None:
                top = pr.get("final_height") or pr.get("height_m") or 0.0
            if base > BURIED_BASE_MAX or top < BURIED_TOP_MIN:
                continue
            g = f.get("geometry") or {}
            if g.get("type") == "Polygon":
                rings = [g["coordinates"]]
            elif g.get("type") == "MultiPolygon":
                rings = g["coordinates"]
            else:
                continue
            for cr in rings:
                if not cr or len(cr[0]) < 4:
                    continue
                try:
                    p = Polygon([to_m(x, y) for x, y in cr[0]])
                except Exception:
                    continue
                if p.is_valid and not p.is_empty and p.area > 1.0:
                    out.append(p)
                    owner.append(None)

    if BURIED_DRAWN_FOOTPRINTS:
        claimed = claimed_building_ids()
        doc = json.load(open(SNAP, encoding="utf-8"))
        for f in doc.get("features") or []:
            pr = f.get("properties") or {}
            bid = str(pr.get("id"))
            if bid in claimed:
                continue                     # another pass draws this one
            top = pr.get("final_height") or pr.get("height") or 0.0
            if top < BURIED_TOP_MIN:
                continue                     # too low to hide a 2.4 m leaf
            g = f.get("geometry") or {}
            if g.get("type") == "Polygon":
                rings = [g["coordinates"]]
            elif g.get("type") == "MultiPolygon":
                rings = g["coordinates"]
            else:
                continue
            for cr in rings:
                if not cr or len(cr[0]) < 4:
                    continue
                try:
                    p = Polygon([to_m(x, y) for x, y in cr[0]])
                except Exception:
                    continue
                if not p.is_valid:
                    p = p.buffer(0)
                    if p.geom_type == "MultiPolygon":
                        p = max(p.geoms, key=lambda q: q.area)
                if p.is_valid and not p.is_empty and p.area > 1.0:
                    out.append(p)
                    owner.append(bid)
    return out, owner


def _mass_free(union, x, y, nx, ny, reach):
    """Outside every mass at (x,y), AND with `reach` metres of open space along
    the outward normal. The reach test is the whole point: Gates-Dell's nearest
    free wall is 0.21 m from the buried door and looks out into a 2 m slot, so a
    rule that only asks "am I outside" moves the door 20 cm and it is still
    invisible."""
    if union.intersects(Point(x + nx * 0.05, y + ny * 0.05)):
        return False
    d = BURIED_PROUD
    while d <= reach + 1e-6:
        if union.intersects(Point(x + nx * d, y + ny * d)):
            return False
        d += 1.0
    return True


def _span_free(union, x, y, tx, ty, nx, ny, reach):
    """_mass_free swept across BURIED_SPAN_M of wall, centred on (x,y)."""
    h = BURIED_SPAN_M / 2.0
    for u in (-h, 0.0, h):
        if not _mass_free(union, x + tx * u, y + ty * u, nx, ny, reach):
            return False
    return True


def _door_taken(claims, qx, qy):
    """QUEUE R3. Is another BUILDING's door already standing here? `claims` is
    the live list of door centres belonging to every building except this one.

    A centre-to-centre test rather than an overlap test, because the opening's
    real width is not chosen until assemble(), which then slides it along its
    run. One bank width between centres is the honest approximation and it is
    the constant the burial sweep already uses. The consequence is worth
    writing down: two doors whose CENTRES clear this but whose slid openings do
    not can still end up close, which is why PAC's 2.15 m neighbour survives
    some arms of this fix and not others."""
    if not claims:
        return False
    r = BURIED_DOOR_CLEAR_M
    for (cx, cy) in claims:
        if abs(cx - qx) <= r and abs(cy - qy) <= r and \
                math.hypot(cx - qx, cy - qy) <= r:
            return True
    return False


def _free_wall(union, host, px, py, front=None, claims=None):
    """Nearest point on `host`'s own exterior with a RUN of free wall around it.

    Returns (dist, x, y, tx, ty, nx, ny, elen, left, right) or None. `left` and
    `right` are the measured free run either side, which becomes the
    candidate's `run` — assemble() slides an opening along its run, and a run
    taken from the mass edge's full length would slide the door straight back
    into the mass it was lifted out of."""
    ring = list(host.exterior.coords)
    # `front` is the union the OUTWARD clearance is tested against; it is
    # `union` plus the host building's own masses (NB8). The wall walk below
    # still uses `union`, so a door may still stand in its own notch.
    if front is None:
        front = union
    best = None
    for i in range(len(ring) - 1):
        ax, ay = ring[i]
        bx, by = ring[i + 1]
        elen = math.hypot(bx - ax, by - ay)
        if elen < BURIED_RUN_MIN:
            continue
        tx, ty = _norm(bx - ax, by - ay)
        n = max(1, int(elen // BURIED_STEP_M))
        for k in range(n + 1):
            s = elen * k / float(n)
            qx, qy = ax + tx * s, ay + ty * s
            d = math.hypot(qx - px, qy - py)
            if d > BURIED_MOVE_MAX or (best is not None and d >= best[0]):
                continue
            # R3: is somebody else's doorway already here? Asked before the
            # geometry, because it is the cheapest test in the loop and it is
            # the question the march never asked. Outside the `sg` loop
            # because a doorway is taken from either side of the wall.
            if _door_taken(claims, qx, qy):
                continue
            for sg in (1, -1):
                nx, ny = sg * ty, -sg * tx
                if not _span_free(front, qx, qy, tx, ty, nx, ny,
                                  BURIED_CLEAR_M):
                    continue
                # How far the free run reaches either way, bounded by the edge
                # AND by other people's doors (R3): assemble() slides an
                # opening along its run, so a run that reaches into a
                # neighbour's doorway is a door that can slide into it — the
                # same trap BURIED_RUN_MIN's own note records for Gates-Dell.
                left = right = 0.0
                while left + BURIED_STEP_M <= s and _span_free(
                        front, qx - tx * (left + BURIED_STEP_M),
                        qy - ty * (left + BURIED_STEP_M),
                        tx, ty, nx, ny, BURIED_CLEAR_M) and not _door_taken(
                        claims, qx - tx * (left + BURIED_STEP_M),
                        qy - ty * (left + BURIED_STEP_M)):
                    left += BURIED_STEP_M
                while right + BURIED_STEP_M <= elen - s and _span_free(
                        front, qx + tx * (right + BURIED_STEP_M),
                        qy + ty * (right + BURIED_STEP_M),
                        tx, ty, nx, ny, BURIED_CLEAR_M) and not _door_taken(
                        claims, qx + tx * (right + BURIED_STEP_M),
                        qy + ty * (right + BURIED_STEP_M)):
                    right += BURIED_STEP_M
                if left + right < BURIED_RUN_MIN:
                    continue
                best = (d, qx + nx * BURIED_PROUD, qy + ny * BURIED_PROUD,
                        tx, ty, nx, ny, elen, left, right)
                break
    return best


def load_authored_walls():
    """The authored masses that ARE a building's walls, per host footprint id.

    Only the files in BURIED_MASS_FILES — the passes that draw whole buildings
    — and only the pieces that stand at grade, the same filter load_masses()
    uses for burial. A file's `replacedBuildingIds` says which footprints its
    geometry stands in for, so a mass is attributed to a host by GEOMETRY
    (WALL_SEAT_OWN of the mass inside that ring) and the host is only ever one
    of the ids that file claims. Nothing can seat a door onto a neighbour.
    """
    per_file = []
    for fn_ in BURIED_MASS_FILES:
        path = os.path.join(ROOT, "data", fn_ + ".geojson")
        if not os.path.exists(path):
            continue
        try:
            doc = json.load(open(path, encoding="utf-8"))
        except Exception:
            continue
        claims = [str(b) for b in (doc.get("replacedBuildingIds") or [])]
        if not claims:
            continue                     # a pass that claims nothing has no host
        polys = []
        for f in doc.get("features") or []:
            pr = f.get("properties") or {}
            base = pr.get("base")
            if base is None:
                base = pr.get("min_height_m") or 0.0
            top = pr.get("h")
            if top is None:
                top = pr.get("final_height") or pr.get("height_m") or 0.0
            if base > BURIED_BASE_MAX or top < BURIED_TOP_MIN:
                continue
            g = f.get("geometry") or {}
            if g.get("type") == "Polygon":
                rings = [g["coordinates"]]
            elif g.get("type") == "MultiPolygon":
                rings = g["coordinates"]
            else:
                continue
            for cr in rings:
                if not cr or len(cr[0]) < 4:
                    continue
                try:
                    q = Polygon([to_m(x, y) for x, y in cr[0]])
                except Exception:
                    continue
                if q.is_valid and not q.is_empty and q.area > 1.0:
                    polys.append(q)
        if polys:
            per_file.append((set(claims), polys))
    return per_file


def seat_on_drawn_wall(scope, stats):
    """Move every candidate onto the wall plane its own building actually draws.

    See WALL_SEAT above for why. One march per door, inward along its own
    normal, swept across WALL_SEAT_SPAN of bank, and the door takes the
    NEAREST plane any part of the bank touches. Runs BEFORE clear_buried(), so
    a door is judged buried at the place it will finally stand.

    ORDER: AFTER clear_buried(), and that is the whole difference between a
    27-door change and a 27-door change plus four doors thrown 15-57 m across
    their own building. Seating first moves the burial test's input, so three
    GDC doors and one at DKR came out of clear_buried()'s march on completely
    different walls -- and then `wp` no longer describes the move, because the
    door did not travel the vector this function recorded. Seating last leaves
    every other stage byte-for-byte what main bakes, and makes `wp` exact.
    """
    if not WALL_SEAT:
        return
    per_file = load_authored_walls()
    if not per_file:
        stats["seat_no_masses"] += 1
        return
    # EVERYTHING THE RENDERER EXTRUDES, for the burial refusal below. The same
    # set clear_buried() judges against, because "did I just push this door
    # inside something" is the same question it asks -- and the thing that
    # buries a seated door is not always the host: Block on 25th East's leaf
    # goes into a NEIGHBOURING West Campus mass, which a host-only test cannot
    # see.
    all_masses, all_owner = load_masses()
    all_tree = STRtree(all_masses) if all_masses else None
    for b in scope:
        if not b.ents:
            continue
        own = []
        for claims, polys in per_file:
            if str(b.bid) not in claims:
                continue
            for q in polys:
                try:
                    inter = q.intersection(b.poly).area
                except Exception:
                    continue
                if inter / q.area >= WALL_SEAT_OWN:
                    own.append(q)
        if not own:
            continue
        stats["seat_hosts_with_walls"] += 1
        wall = unary_union(own)
        # This host's own geometry inside the full mass list, so the refusal
        # below does not read the wall the door was just seated ON as a burial.
        own_all = set()
        if all_tree is not None:
            for i in all_tree.query(b.poly):
                i = int(i)
                if all_owner[i] is not None:
                    if all_owner[i] == str(b.bid):
                        own_all.add(i)
                    continue
                try:
                    inter = all_masses[i].intersection(b.poly).area
                except Exception:
                    continue
                if inter and inter / all_masses[i].area >= WALL_SEAT_OWN:
                    own_all.add(i)
        for c in b.ents:
            # ALREADY TOUCHING IT? Then it is on a wall and this rule has
            # nothing to say. Measured cost of not asking: Block on 25th East's
            # door sat 0.14 m off a westcampus return, the march found a
            # DIFFERENT face of the same tower 0.78 m further in, and the seat
            # put the leaf 0.64 m INSIDE the building -- the exact defect
            # clear_buried() exists to prevent, introduced by its cure.
            if wall.distance(Point(c.x, c.y)) < WALL_SEAT_MIN:
                stats["seat_already_on_wall"] += 1
                continue
            offs = (-WALL_SEAT_SPAN / 2.0, 0.0, WALL_SEAT_SPAN / 2.0)
            best = None
            for u in offs:
                bx = c.x + c.tx * u
                by = c.y + c.ty * u
                if wall.covers(Point(bx, by)):
                    best = 0.0           # already on or inside the wall
                    break
                d = None
                steps = int(WALL_SEAT_MAX / WALL_SEAT_STEP) + 1
                for k in range(1, steps + 1):
                    t = k * WALL_SEAT_STEP
                    if wall.covers(Point(bx - c.nx * t, by - c.ny * t)):
                        lo, hi = t - WALL_SEAT_STEP, t
                        for _ in range(4):
                            mid = (lo + hi) / 2.0
                            if wall.covers(Point(bx - c.nx * mid,
                                                 by - c.ny * mid)):
                                hi = mid
                            else:
                                lo = mid
                        d = hi
                        break
                if d is None:
                    continue
                best = d if best is None else min(best, d)
            if best is None or best < WALL_SEAT_MIN:
                stats["seat_already_on_wall"] += 1
                continue
            # AND THE LEAF MUST STILL BE OUTSIDE. Seating puts the door's own
            # reference on the wall, so its leaf lands PROUD_DOOR out along the
            # normal -- unless a RETURN wall beside the door covers it, and
            # then the cure is the disease: Block on 25th East's leaf sat
            # 0.14 m off a westcampus return, the march found another face of
            # the same tower 0.78 m further in, and the seat buried the leaf
            # 0.64 m inside the building. Tested where the leaf actually is,
            # swept across the bank, and a burial cancels the move outright
            # rather than shortening it -- a half-seated door is a door on no
            # plane at all.
            lv = PROUD_DOOR + LEAF_T / 2.0
            buried = False
            for u in offs:
                lp = Point(c.x + c.tx * u - c.nx * (best - lv),
                           c.y + c.ty * u - c.ny * (best - lv))
                if wall.covers(lp):
                    buried = True
                    break
                if all_tree is None:
                    continue
                for i in all_tree.query(lp):
                    if int(i) in own_all:
                        continue
                    if all_masses[int(i)].contains(lp):
                        buried = True
                        break
                if buried:
                    break
            if buried:
                stats["seat_would_bury"] += 1
                continue
            c.x -= c.nx * best
            c.y -= c.ny * best
            # the vector BACK, in degrees, for ?wallplane=0
            c.seat = [round(c.nx * best / KX, 7), round(c.ny * best / M_LAT, 7)]
            stats["seat_moved"] += 1
            stats["seat_moved_m"] += best
            SEATED.append((b.ref or b.name or b.osm_name or str(b.bid))[:28]
                          + " %.2f m" % best)


def adopt_moved_wall(scope, stats):
    """A door that clear_buried() relocated onto a wall THIS ROUND MOVED must
    carry that wall's move, or ?wallplane=0 leaves it behind.

    GDC's Speedway door is the whole case: it is buried inside the atrium at
    every plane the atrium has ever had, so the march puts it on the atrium's
    outer face -- and that face travelled 3.40 m when bake_heroes.py took the
    atrium off the roof canopy line. The bake that moved the wall stamps the
    vector on the feature as `wpd`; this reads it back and hands it to the door
    it moved, so one switch restores both.
    """
    moved = []
    for fn_ in BURIED_MASS_FILES:
        path = os.path.join(ROOT, "data", fn_ + ".geojson")
        if not os.path.exists(path):
            continue
        try:
            doc = json.load(open(path, encoding="utf-8"))
        except Exception:
            continue
        for f in doc.get("features") or []:
            pr = f.get("properties") or {}
            wpd = pr.get("wpd")
            g = f.get("geometry") or {}
            if not wpd or g.get("type") != "Polygon":
                continue
            try:
                q = Polygon([to_m(x, y) for x, y in g["coordinates"][0]])
            except Exception:
                continue
            if q.is_valid and not q.is_empty:
                moved.append((q, [round(wpd[0], 7), round(wpd[1], 7)]))
    if not moved:
        return
    for b in scope:
        for c in b.ents:
            if c.seat:
                continue
            pt = Point(c.x - c.nx * ADOPT_IN, c.y - c.ny * ADOPT_IN)
            for q, wpd in moved:
                if q.covers(pt):
                    c.seat = wpd
                    stats["seat_adopted"] += 1
                    break


ADOPT_IN = BURIED_PROUD + 0.10   # m. NOT 0.10: a RELOCATED door does not
                        # stand on the mass, it stands BURIED_PROUD (0.35 m)
                        # off it, which is the whole point of that constant.
                        # A step of 0.10 m inward from the door lands in the
                        # 0.35 m of air between the two and adopts nothing —
                        # measured, 0 doors, on the one door this exists for.


SEATED = []


def clear_buried(scope, stats):
    """QUEUE W7. Relocate or drop every door that another pass has walled in.

    QUEUE X4, THE SELF-BLOCK: a mass that is just the host building's own
    footprint re-drawn by another pass (IoU >= SELF_IOU against the host
    ring) is EXCLUDED from that building's burial test and from its
    clear-space march. A door on a wall always has its own building behind
    it; treating the building itself as a blocker fails every door that
    sits in a re-entrant notch of its own plan — Cambridge Tower's measured
    march re-entered CAMBRIDGE'S OWN ring in six of twelve directions
    within 3 m while the nearest other footprint was 107 m away. Gates-Dell
    is NOT this case and stays fixed: the atrium slab that swallowed its
    door is authored OUTBOARD geometry, IoU far below the gate.

    QUEUE NB2: the mass set now also carries the footprints `austin-buildings`
    extrudes, so a door can be buried by an ordinary neighbouring BUILDING and
    not only by an authored slab. The door's own host is skipped by BID as well
    as by the IoU self-block — an id match is exact, a ratio is a threshold."""
    masses, owner = load_masses()
    if not masses:
        stats["buried_no_masses"] += 1
        return
    mtree = STRtree(masses)
    # bid -> something a person can read, so the R3 diagnostic can say
    # "onto BUILDING MNAC" instead of "onto ec129b99".
    names = {}
    for b in scope:
        names[str(b.bid)] = (b.ref or b.name or b.osm_name
                             or str(b.bid)[:8])[:28]
    # R3, THE DOOR CLAIM REGISTER. Every candidate on every building, at its
    # position RIGHT NOW, so a relocation can be refused a doorway another
    # building is already using. Kept LIVE: a door's claim travels with it, so
    # nothing is blocked by where it used to be and a vacated spot is released.
    # Keyed by identity because candidates carry no id at this point in the
    # bake — assemble() hands out eids later, which is also why the move log
    # below keys on coordinates.
    claim_at, claim_bid = {}, {}
    for b in scope:
        for c in b.ents:
            claim_at[id(c)] = (c.x, c.y)
            claim_bid[id(c)] = str(b.bid)

    def self_mass_ids(b):
        """Indices of masses that ARE b's own footprint — by id where the mass
        is a footprint, by IoU where it is an authored re-draw with no id."""
        own = set()
        for i in mtree.query(b.poly):
            i = int(i)
            if owner[i] is not None:
                if owner[i] == str(b.bid):
                    own.add(i)
                continue
            m = masses[i]
            try:
                inter = m.intersection(b.poly).area
            except Exception:
                continue
            if inter <= 0.0:
                continue
            if inter / (m.area + b.poly.area - inter) >= SELF_IOU:
                own.add(i)
        return own

    for b in scope:
        if not b.ents:
            continue
        own = self_mass_ids(b)
        if own:
            stats["self_mass_hosts"] += 1
            stats["self_masses"] += len(own)
        keep = []
        for c in b.ents:
            # A POINT test misses the Red Zone, whose door centre is clear of
            # the stadium ramp and whose leaves are not. Sweep the bank.
            host, hit_pt = None, None
            for u in (-BURIED_SPAN_M / 2.0, 0.0, BURIED_SPAN_M / 2.0):
                pt = Point(c.x + c.tx * u + c.nx * BURIED_TEST_OUT,
                           c.y + c.ty * u + c.ny * BURIED_TEST_OUT)
                for i in mtree.query(pt):
                    if int(i) in own:
                        continue      # X4: its own building cannot bury it
                    if masses[int(i)].contains(pt):
                        host, hit_pt = masses[int(i)], pt
                        break
                if host is not None:
                    break
            if host is None:
                keep.append(c)
                continue
            stats["buried_found"] += 1
            who = (b.ref or b.name or b.osm_name or str(b.bid))[:28]
            # The union the march tests is built here, per buried door,
            # because it depends on the door's HOST BUILDING: every mass in
            # marching range EXCEPT the ones that are b's own footprint. The
            # merged part containing the hit keeps the old behaviour where
            # touching masses offered their fused exterior to _free_wall.
            zone = Point(c.x, c.y).buffer(
                BURIED_MOVE_MAX + BURIED_CLEAR_M + BURIED_SPAN_M)
            others = [masses[int(i)] for i in mtree.query(zone)
                      if int(i) not in own]
            union = unary_union(others)
            parts = (list(union.geoms) if union.geom_type == "MultiPolygon"
                     else [union])
            for p in parts:
                if p.contains(hit_pt):
                    host = p
                    break
            # ── QUEUE NB8: THE CLEAR-SPACE TEST COULD NOT SEE THE HOST ──
            # `union` deliberately omits b's own masses (X4), and _free_wall
            # uses it for BOTH jobs: walking a neighbour's wall edge, and
            # asking whether there is BURIED_CLEAR_M of open space in front
            # of the leaf. The second job is wrong with the host missing —
            # space that is solid host building reads as free, so the march
            # can park a door on a neighbour's wall facing INTO its own
            # building. Measured: eids 172 (Engineering Discovery), 285
            # (Brackenridge Hall) and 194 went from 5,432 / 10,376 / 15,351
            # changed pixels to ZERO from both bearings when NB2 turned the
            # drawn footprints on (docs/entrances/relocated.md §4).
            #
            # So the edge walk keeps `union` — a door in its own re-entrant
            # notch must still be allowed, which is all X4 ever claimed —
            # and the FRONT clearance is tested against everything, host
            # included.
            # ONLY the own-masses that are real DRAWN FOOTPRINTS join `front`
            # (`owner[i] is not None`), never the IoU-matched authored
            # re-draws. buried.md §4 already draws that line — "an id match is
            # exact; a ratio is a threshold" — and it is load-bearing here.
            # Measured: blocking against the IoU matches as well DROPS one of
            # the Main Building's door groups, because js/tower.js does not
            # fill MAI's ring, it draws the recessed centre bay set back, and
            # the ring-shaped IoU match says "solid" where the render shows
            # open air. A ratio cannot be trusted to say where a wall IS.
            front = union
            if BURIED_OWN_BLOCKS_FRONT and own:
                mine = [masses[i] for i in own if owner[i] is not None]
                if mine:
                    front = unary_union(others + mine)
            # ── QUEUE R3: THE MARCH NEVER ASKED WHAT WAS ALREADY THERE ──
            # NB8 made this half worse rather than better: once the host's own
            # mass correctly blocked the FRONT test, the only clear space left
            # for a door in a tight complex was off its own building entirely,
            # and nothing then stopped it parking in a doorway somebody else
            # was using. Ten of the eleven NB8 movers were fine; eid 345 is the
            # difference. See the constant block for why the tempting rule
            # ("stay on your own building") is refuted by this bake's own log.
            #
            # Trimmed to marching range before it goes in, because _free_wall
            # probes this list at every sampled wall point and the register is
            # 650-odd doors campus-wide.
            claims = None
            if BURIED_DOOR_CLAIM:
                mine_bid = str(b.bid)
                reach = BURIED_MOVE_MAX + BURIED_DOOR_CLEAR_M
                claims = [xy for k, xy in claim_at.items()
                          if claim_bid[k] != mine_bid
                          and abs(xy[0] - c.x) <= reach
                          and abs(xy[1] - c.y) <= reach]
            got = _free_wall(union, host, c.x, c.y, front, claims)
            if got is None:
                stats["buried_dropped"] += 1
                # A drop line WITHOUT A COORDINATE cannot be walked to, and
                # walking to it is the only way to tell a genuinely tight wall
                # from a wrong constant. It also collapsed two distinct doors
                # into one "DROPPED 2 on <bid>" line, which hid that they are
                # 30 m apart. Key on the position so each drop is its own line.
                stats["burieddrop|%s at %.6f,%.6f (%s %s)"
                      % ((who,) + to_ll(c.x, c.y) + (c.role, c.src))] += 1
                claim_at.pop(id(c), None)   # R3: a dropped door claims nothing
                continue
            d, qx, qy, tx, ty, nx, ny, elen, left, right = got
            # R3 DIAGNOSTIC. "moved 6 m" never said WHERE TO, which is why a
            # door standing in another building's doorway read as a healthy
            # relocation for a week and was caught by a coplanar count rather
            # than by this log. Every move now names the wall it came to rest
            # against, and the counts are printed because six doors landing on
            # one wall point used to collapse into a single line.
            landed = "an authored mass"
            probe = Point(qx - nx * (BURIED_PROUD + BURIED_LANDED_PROBE_M),
                          qy - ny * (BURIED_PROUD + BURIED_LANDED_PROBE_M))
            for i in mtree.query(probe):
                i = int(i)
                if owner[i] is None or not masses[i].contains(probe):
                    continue
                landed = ("ITS OWN footprint" if owner[i] == str(b.bid)
                          else "BUILDING %s" % names.get(owner[i],
                                                        owner[i][:8]))
                break
            c.x, c.y = qx, qy
            claim_at[id(c)] = (qx, qy)   # R3: the claim travels with the door
            c.tx, c.ty, c.nx, c.ny = tx, ty, nx, ny
            c.elen, c.s = elen, left
            # wall_run() walks the HOST FOOTPRINT and the door is no longer on
            # it, so the run is the MEASURED free run on the mass edge instead.
            c.run = (left, right)
            stats["buried_moved"] += 1
            # Keyed on the LANDING COORDINATE — eids are handed out by
            # assemble(), not here, which is the same reason the drop lines
            # carry one.
            stats["buriedmove|%s %.2f m to %.6f,%.6f -> onto %s"
                  % ((who, d) + to_ll(qx, qy) + (landed,))] += 1
            keep.append(c)
        b.ents = keep


def clear_portal_wall(scope, stats):
    """QUEUE W9. Where celebrated.md gives an authored portal COORDINATE, the
    doc has enumerated that building's entrances from OSM and a derived door on
    the portal's own wall is noise, not evidence. Three of them were sharing the
    Main Building's 38 m recessed south bay with the portal at the head of the
    South Mall, the nearest 8.9 m away, each with its own limestone surround and
    its own flight — so the most-photographed portal on campus read as one of
    four identical doors. OSM and authored candidates are never touched."""
    for b in scope:
        cel = CELEBRATED.get(b.ref or "")
        if not cel or not cel.get("at"):
            continue
        portals = [c for c in b.ents
                   if c.role == "main" and c.src in ("osm", "authored")]
        if not portals:
            continue
        keep = []
        for c in b.ents:
            if c.src in ("osm", "authored"):
                keep.append(c)
                continue
            hit = False
            for p in portals:
                dx, dy = c.x - p.x, c.y - p.y
                if (abs(dx * p.nx + dy * p.ny) <= PORTAL_WALL_T
                        and abs(dx * p.tx + dy * p.ty) <= PORTAL_CLEAR_R):
                    hit = True
                    break
            if hit:
                stats["portal_wall_cleared"] += 1
                stats["portalwall|" + (b.ref or "?")] += 1
            else:
                keep.append(c)
        b.ents = keep


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


# ── WHICH OF UT'S TWO COORDINATES IS THE DOOR ─────────────────────────────
#
# Every row of `Celebrated_Entrances_view` carries the entrance position TWICE
# and the two do not agree:
#
#   * a `Longitude`/`Latitude` ATTRIBUTE PAIR — two ordinary columns, and null
#     on 29 of the 98 rows;
#   * the row's own point GEOMETRY (`geometry.x`/`geometry.y`) — present on all
#     98.
#
# Measured 2026-08-24 over the 69 rows that carry both: they are a median 2.7 m
# apart, 15 buildings are 10 m+ apart, and MBB is 39.1 m apart. Rounds 1-6 of
# this lane read the attribute pair, and a critic was right to call that out.
#
# THE GEOMETRY IS THE ONE THE MAP DRAWS, and that is not a judgement call. An
# ArcGIS feature layer renders `geometry`; `Longitude`/`Latitude` are attribute
# columns and are drawn by nothing. The proof is in the layer itself — 29 rows
# have NO attribute pair at all and still appear on maps.utexas.edu, so the
# geometry is the field the map depends on and the pair is bookkeeping beside
# it. One of the three things this lane is judged on is agreement with the door
# maps.utexas.edu presents, so the ground truth has to be the drawn point.
#
# IT IS NOT A QUALITY UPGRADE, AND SAYING SO WOULD BE A LIE. Both fields were
# scored against a referee neither of them controls: distance to the exterior
# wall of the footprint carrying that building's own code, signed so a pin
# dropped in the middle of a lobby is told apart from one dropped in a car park.
# Over the 66 rows with both a pair and a joined footprint —
#
#     geometry nearer a wall 18, attribute nearer 23, tie (<0.5 m) 25
#     mean |distance to wall|   geometry 2.37 m   attribute 2.58 m
#
# — a dead heat. UT's `Directional` column was tried as a second referee and is
# too blunt to break it: on a long or L-shaped building the bearing from the
# centroid is 45 deg off for a perfectly good door (PCL, UTA and PMA all read
# 45+ deg with the two fields at the SAME point), so it disagrees with the wall
# referee as often as it agrees, 9 to 7. Neither field is the better survey.
# The geometry wins because it is the published one, not because it is nearer a
# door.
#
# So switching source changes WHICH point the router aims at on ~15 buildings by
# 10-39 m; it does not promise a smaller residual, and `walkmeter.mjs` is the
# only thing allowed to say what it did.
UT_COORD_SOURCE = "geometry"   # "geometry" = the point maps.utexas.edu draws;
                        # "attribute" = the Longitude/Latitude columns, which is
                        # what rounds 1-6 read. Kept switchable so the next
                        # person can reproduce the old table in one edit rather
                        # than from a commit hash.
UT_AUDIT_WALL_M = 6.0   # a published door further than this from the wall of
                        # its own coded footprint is printed by --refresh-ut as
                        # a data note. It is a REPORT, not a filter: nothing is
                        # dropped on it. Measured, 7 rows of 82 trip it and 6 of
                        # those 7 are pins deep INSIDE a big building (Welch,
                        # ECJ, the UTC) rather than doors in the wrong place —
                        # a lobby, not an error. JON is the one genuinely
                        # outside, 15.9 m, in BOTH fields.


def refresh_ut():
    """Re-pull UT's celebrated entrances and PRINT a table to paste.

    It prints rather than writes for the same reason `--refresh` does: a table
    in the file is reviewable in a diff and cannot half-apply when the fetch
    times out. Paste the result over UT_CELEBRATED here AND over the identical
    table in js/wayfind.js — the router reads its own copy so that the door
    choice keeps working on a checkout whose data/walk_graph.json is older than
    this bake's output.

    It also prints how far the two coordinate fields disagree, per row, because
    the disagreement is invisible in the finished table and cost this lane six
    rounds of scoring itself against a point the campus map does not draw.
    """
    try:
        from urllib.request import urlopen
    except ImportError:                                   # pragma: no cover
        from urllib2 import urlopen                       # noqa: F401
    side = {"North": "N", "South": "S", "East": "E", "West": "W",
            "Northeast": "NE", "Northwest": "NW", "Southeast": "SE",
            "Southwest": "SW", "SW": "SW", "W": "W", "": "-"}
    j = json.loads(urlopen(UT_CELEBRATED_URL, timeout=90).read().decode("utf-8"))
    rows = set()
    apart = []          # (code, metres between the two fields)
    only_geom = 0
    for f in j.get("features", []):
        a = f["attributes"]
        g = f.get("geometry") or {}
        code = (a.get("Bldg_Abbr") or "").strip().upper()
        a_lo, a_la = a.get("Longitude"), a.get("Latitude")
        g_lo, g_la = g.get("x"), g.get("y")
        # THE ORDER OF PREFERENCE IS THE WHOLE FIX. Whichever field is named by
        # UT_COORD_SOURCE is taken first and the other is a fallback for a null,
        # so a row that carries only one coordinate is still published rather
        # than silently dropped.
        if UT_COORD_SOURCE == "geometry":
            lo, la = g_lo, g_la
            if lo is None or la is None:
                lo, la = a_lo, a_la
        else:
            lo, la = a_lo, a_la
            if lo is None or la is None:
                lo, la = g_lo, g_la
        if la is None or lo is None:
            continue
        if a_lo is None or a_la is None or g_lo is None or g_la is None:
            only_geom += 1
        else:
            ax, ay = to_m(a_lo, a_la)
            gx, gy = to_m(g_lo, g_la)
            apart.append((code, math.hypot(gx - ax, gy - ay)))
        rows.add("    '%s %.6f %.6f %s %s %s'," % (
            code, la, lo,
            side.get((a.get("Directional") or "").strip(), "-"),
            "Y" if (a.get("BarrierFree") or "").strip().upper() == "Y" else "N",
            "Y" if (a.get("AutoOpener") or "").strip().upper() == "Y" else "N"))
    print("UT_CELEBRATED = [")
    for r in sorted(rows):
        print(r)
    print("]")
    print("# %d doors on %d buildings"
          % (len(rows), len({r.split("'")[1].split(" ")[0] for r in rows})))
    print()
    print("# source: %s (%s)" % (
        UT_COORD_SOURCE,
        "the point maps.utexas.edu draws" if UT_COORD_SOURCE == "geometry"
        else "the Longitude/Latitude attribute columns"))
    print("# rows carrying only one of the two coordinates: %d" % only_geom)
    if apart:
        d = sorted(x[1] for x in apart)
        print("# the two fields disagree on %d rows: median %.1f m, max %.1f m,"
              " %d of them 10 m+"
              % (len(d), d[len(d) // 2], d[-1], sum(1 for x in d if x >= 10)))
        for code, m in sorted(apart, key=lambda r: -r[1])[:15]:
            if m >= 10.0:
                print("#     %-5s %5.1f m" % (code, m))


def finish_arcades():
    """Lay out every recorded arcade wall: the pitch from the doors on it, the
    bays where a band fits, all in the MAIN door's frame. Runs once, after
    every door is placed."""
    walls = [e for e in ARCHES.values() if "_wall" in e]
    by_bid = {}
    for e in walls:
        by_bid.setdefault(e["bid"], []).append(e)
    made = 0
    for bid, ents in by_bid.items():
        ents.sort(key=lambda e: (e.get("_role") != "main", -abs(e["_wall"][1] - e["_wall"][0])))
        lead = ents[0]
        cx, cy, tx, ty, nx, ny = lead["_xy"]
        others = []
        for e in ents[1:]:
            ox, oy, otx, oty = e["_xy"][0], e["_xy"][1], e["_xy"][2], e["_xy"][3]
            if otx * tx + oty * ty < 0.995:
                continue                      # a different wall
            u = (ox - cx) * tx + (oy - cy) * ty
            v = (ox - cx) * nx + (oy - cy) * ny
            if abs(v) > 0.5:
                continue                      # a parallel wall, not this one
            others.append(round(u, 3))
        half, sw = lead["half"], lead["band"]["sw"]
        nominal = 2 * half + 2 * sw + ARCADE_PIER_M
        pitch = nominal
        if others:
            D = min(abs(u) for u in others)
            k = max(1, int(round(D / nominal)))
            pitch = D / k
        u0, u1 = lead["_wall"]
        reach = half + sw
        k0 = int(math.ceil((u0 + reach) / pitch))
        k1 = int(math.floor((u1 - reach) / pitch))
        bays = [round(k * pitch, 3) for k in range(k0, k1 + 1)]
        crown = lead["spring"] + lead["rise"]
        lead["arcade"] = {
            "wall": [u0, u1], "pitch": round(pitch, 3), "bays": bays,
            "doors": [0.0] + sorted(others),
            "string": [round(crown + sw, 3), round(crown + sw + ARCADE_STRING_M, 3)],
            "skin": lead["_skin"], "dark": lead["_dark"],
        }
        made += 1
    for e in walls:
        for k in ("_wall", "_xy", "_role", "_skin", "_dark"):
            e.pop(k, None)
    return made


def main():
    if "--refresh" in sys.argv:
        refresh()
        return
    if "--refresh-ut" in sys.argv:
        refresh_ut()
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
    reg_admitted, reg_area, reg_e1 = [], [], []
    for b in blds:
        lon, lat = to_ll(b.cx, b.cy)
        b.budget = -1
        # A UT REGISTER CODE IS A SECOND DOOR INTO SCOPE. See the constant
        # block: the rect stays exactly where it was, and a footprint that
        # OSM and UT's register both name gets the derivation run over it
        # anywhere inside the surveyed bbox.
        b.reg = bool(REGISTER_SCOPE and b.ref and b.ref in REG_CODES
                     and in_rect(lat, lon, SURVEY))
        if not b.wc and not in_rect(lat, lon, CAMPUS):
            if not b.reg:
                continue
            reg_admitted.append(b)
        floor = MIN_AREA_REF if b.reg else MIN_AREA
        if b.area < MIN_AREA and b.area >= floor and b not in reg_admitted:
            reg_area.append(b)
        if b.area < floor or (b.h or 0) < MIN_H or b.cls in SKIP_CLASSES:
            if b in reg_admitted:
                reg_admitted.remove(b)
            if b in reg_area:
                reg_area.remove(b)
            continue
        # E1 keeps its veto everywhere EXCEPT the 24. Dobie Twenty21 is the
        # case: its `building_class` is null and places.geojson genuinely owns
        # 108 m of its Guadalupe frontage, so E1 fired correctly and it got
        # zero doors — but its RESIDENTIAL lobby is on Whitis, 60 m away on the
        # other elevation. The claim test in wc_place() is what keeps this pass
        # off the Target, not the whole-building veto.
        # ...and EXCEPT a building on UT's own register, for the same reason
        # and by the same mechanism. The West Mall Office Building hosts the
        # campus post office and copy shop, so E1 vetoed the whole building
        # and it got zero doors — correct for drawing, wrong for routing,
        # because the walk bake only ever reads this file. Admitted here, and
        # every candidate on it is then tested against the shopfront claims
        # below so the door cannot land on a frontage bake_places already owns.
        if b.bid in place_hosts and b.cls in PLACES_EXCLUDE_CLASSES and not b.wc:
            if not (E1_REF_EXEMPT and b.reg):
                stats["e1_places_excluded"] += 1
                continue
            reg_e1.append(b)
        b.fam = classify(b)
        b.budget = budget_for(b)
        scope.append(b)
    print("in scope           : %d buildings  (E1 excluded %d)"
          % (len(scope), stats["e1_places_excluded"]))
    print("register scope     : %d admitted by a UT register code outside the"
          " CAMPUS rect, %d by MIN_AREA_REF %.0f m2, %d past the E1 veto"
          % (len(reg_admitted), len(reg_area), MIN_AREA_REF, len(reg_e1)))
    for b in sorted(reg_admitted + reg_area + reg_e1,
                    key=lambda b: (b.ref or "")):
        lon, lat = to_ll(b.cx, b.cy)
        why = "outside CAMPUS" if b in reg_admitted else (
            "area %.0f < %.0f" % (b.area, MIN_AREA) if b in reg_area
            else "E1 shopfront host")
        print("                     %-4s %-38s %6.0f m2  %5.1f m   %s"
              % (b.ref, (b.name or b.osm_name or "?")[:38], b.area, b.h or 0,
                 why))
    if REG_NAME_JOINED:
        print("register name join : %d footprints took a code from a"
              " letter-for-letter register name match" % len(REG_NAME_JOINED))
        for ref, nm in REG_NAME_JOINED:
            print("                     %-4s <- '%s'" % (ref, nm))
    print("families           : %s" % dict(Counter(b.fam for b in scope)))

    # ── ERAS FROM MEASURED YEARS: print exactly what the register changed,
    #    because the change is visual and judging it belongs to a human.
    dated = sum(1 for b in scope if (b.ref or "") in YEAR_BY_REF)
    changed = []
    for b in scope:
        old = classify_pre_register(b)
        if old != b.fam:
            changed.append((b.ref or (b.name or b.osm_name or "?")[:14],
                            old, b.fam, YEAR_BY_REF.get(b.ref or "")))
    _ut_new = sum(1 for c in YEAR_UTDIRECT if c not in REG_CODES)
    print("eras from register : %d of %d in-scope buildings carry a measured"
          " year (%d refs = %d in data/ut_buildings.json + %d that file does"
          " NOT carry, fetched from UT Direct %s);"
          % (dated, len(scope), len(YEAR_BY_REF),
             len(YEAR_BY_REF) - _ut_new, _ut_new, YEAR_UTDIRECT_DATE))
    print("                     %d changed family vs the hand-maintained list:"
          % len(changed))
    for ref, old, new, yr in sorted(changed, key=lambda t: (t[1], t[2], t[0])):
        print("                     %-14s %-2s -> %-2s  (%s)"
              % (ref, old, new, yr if yr is not None else "no year"))
    if REF_SPLIT_ROWS:
        print("multi-value osm ref: %d split on ';'" % len(REF_SPLIT_ROWS))
        for raw, pick in REF_SPLIT_ROWS:
            print("                     %-14s -> %s" % (raw, pick))
    if OSM_CLASS_FILLED:
        print("osm class fill     : %d footprints took a class from OSM's own"
              " building=* where Overture had none  %s"
              % (len(OSM_CLASS_FILLED),
                 dict(Counter(c for c, _ in OSM_CLASS_FILLED))))

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
    print("stage 3 publicness : %d placed  (normal test %d);"
          " FIELD_MAX=%d stopped %d buildings from spending the rest of a"
          " perimeter budget on further guesses"
          % (stats["stage3_placed"], stats["normal_fail_stage3"],
             FIELD_MAX, stats["field_capped_bldgs"]))

    # ── E1, PER CANDIDATE INSTEAD OF PER BUILDING. Only the register-coded
    #    shopfront hosts admitted above are tested; every other place host is
    #    still vetoed whole, so nothing that E1 protects today moves. A door
    #    that would stand on a run bake_places.py has already claimed is
    #    dropped here — not slid, not narrowed: on a host whose frontage is
    #    spoken for, silence is the honest answer and the building simply
    #    keeps whatever doors its other elevations earned.
    if reg_e1:
        ctree = STRtree(claims) if claims else None
        for b in reg_e1:
            keep = []
            for c in b.ents:
                if ctree is not None and not claim_free(
                        ctree, claims, c.x, c.y, c.tx, c.ty, c.nx, c.ny,
                        E1_CLAIM_RUN):
                    stats["e1_claim_dropped"] += 1
                    continue
                keep.append(c)
            b.ents = keep
        print("E1 per-candidate   : %d register-coded shopfront hosts admitted"
              " (%s); %d doors dropped for standing on a claimed run"
              % (len(reg_e1),
                 ", ".join(sorted(b.ref or "-" for b in reg_e1)),
                 stats["e1_claim_dropped"]))

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

    # `UT_STAGE=0` turns the whole stage off. It is here so the stage can be
    # A/B'd against the previous bake byte for byte, which is how the claim
    # "this diff is UT's doors and nothing else" was checked rather than
    # asserted (docs/walk-door.md).
    if os.environ.get("UT_STAGE") != "0":
        stage_ut(scope, stats)
    print("UT celebrated      : %d of our doors relabelled `main` from UT's own"
          " survey, %d doors placed that we never had, %d of our `main` labels"
          " demoted  (no host %d, unplaceable %d, normal test %d)"
          % (stats["ut_relabelled"], stats["ut_placed"], stats["ut_demoted"],
             stats["ut_no_host"], stats["ut_unplaceable"],
             stats["normal_fail_ut"]))
    print("  UT_SNAP          : %d of those %d relabelled doors MOVED onto UT's"
          " own coordinate (mean %.1f m, over src in %s); %d left where a second"
          " survey had already put them; %d found no outward-facing wall within"
          " %d ranked edges"
          % (stats["ut_moved"], stats["ut_relabelled"],
             stats["ut_moved_m"] / max(1, stats["ut_moved"]),
             "/".join(UT_SNAP_OVER), stats["ut_kept_own_survey"],
             stats["ut_move_no_wall"], UT_EDGE_SCAN))

    # ── THE TWO AUDITS. After every placement stage, before roles: a door
    #    that is about to be deleted must not first have been promoted to main.
    clear_buried(scope, stats)
    print("buried doors       : %d walled in by another pass's mass"
          " (%d relocated to a free wall, %d dropped)"
          % (stats["buried_found"], stats["buried_moved"],
             stats["buried_dropped"]))
    print("  self-block (X4)  : %d masses on %d buildings are the host's own"
          " footprint re-drawn (IoU >= %.2f) and are excluded from that"
          " host's burial test and march"
          % (stats["self_masses"], stats["self_mass_hosts"], SELF_IOU))

    seat_on_drawn_wall(scope, stats)
    from collections import Counter as _C
    print("wall plane         : %d doors seated on the wall their building"
          " actually draws (mean %.2f m inward), %d already on it, over %d"
          " hosts whose walls are authored geometry"
          % (stats["seat_moved"], stats["seat_moved_m"] / max(1, stats["seat_moved"]),
             stats["seat_already_on_wall"], stats["seat_hosts_with_walls"]))
    for row, n in sorted(_C(SEATED).items()):
        print("                     %s  x%d" % (row, n))
    adopt_moved_wall(scope, stats)
    print("                     %d more took the move of a wall another bake"
          " shifted this round (`wpd`)" % stats["seat_adopted"])
    print("                     %d refused because the seat would have put the"
          " leaf inside a return wall" % stats["seat_would_bury"])

    # THE SIDE AUDIT. Not the same claim as "how many did the side filter
    # choose" — that counts what the RULE did. This counts what the DATA ends
    # up saying, over every door carrying UT's survey flags, after every later
    # stage (clear_buried can and does move a door to another wall). A door
    # whose outward normal disagrees with UT's own compass column is on the
    # wrong elevation no matter how close its coordinate is.
    _side_hit = _side_miss = _side_unknown = 0
    _side_bad = []
    for b in scope:
        for c in b.ents:
            if not c.ut:
                continue
            k = ut_side_cos(c.ut[0], c.nx, c.ny)
            if k is None:
                _side_unknown += 1
            elif k >= UT_SIDE_MIN:
                _side_hit += 1
            else:
                _side_miss += 1
                _side_bad.append("%s/%s" % (b.ref or "-", c.ut[0]))
    print("  side audit       : %d of %d drawn UT doors face the side UT itself"
          " publishes (cos >= %.2f); %d face another wall%s%s"
          % (_side_hit, _side_hit + _side_miss, UT_SIDE_MIN, _side_miss,
             "; %d rows name no side" % _side_unknown if _side_unknown else "",
             "  " + " ".join(sorted(_side_bad)) if _side_bad else ""))
    for k in sorted(stats):
        if k.startswith("buriedmove|"):
            print("                     moved   %dx %s"
                  % (stats[k], k.split("|", 1)[1]))
        elif k.startswith("burieddrop|"):
            print("                     DROPPED %d on %s  (no wall within"
                  " %.0f m carrying %.0f m of free run with %.0f m of open"
                  " space in front of it)"
                  % (stats[k], k.split("|", 1)[1], BURIED_MOVE_MAX,
                     BURIED_RUN_MIN, BURIED_CLEAR_M))

    clear_portal_wall(scope, stats)
    print("celebrated portals : %d derived doors cleared off an authored"
          " portal's own wall (%.0f m either side, %.0f m off the plane)"
          % (stats["portal_wall_cleared"], PORTAL_CLEAR_R, PORTAL_WALL_T))
    for k in sorted(stats):
        if k.startswith("portalwall|"):
            print("                     %s: %d"
                  % (k.split("|", 1)[1], stats[k]))

    # Both audits delete candidates, so the headline count is re-derived here
    # rather than reused from the steps block above it.
    tot_ents = sum(len(b.ents) for b in scope)

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
    # ── AUTHORED DOORS, PRINTED ON EVERY RUN AND NEVER FOLDED INTO A TOTAL.
    #    `src` is the only thing that tells a measured door from an inferred
    #    one, and `authored` is the only value that means A HUMAN PUT IT
    #    THERE. If this number ever grows, it must grow in a commit message
    #    that says which building and on what evidence.
    auth = [(b.ref or b.name or "?", c.role) for b in scope for c in b.ents
            if c.src == "authored"]
    print("  AUTHORED BY HAND : %d  %s" % (len(auth), sorted(auth)))
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

    # ── FAMILY V CENSUS — docs/entrances/eras.md §4V. The register is the
    #    whole authority for this family, so the roll call is printed FROM THE
    #    REGISTER rather than from the scope: a building the register dates
    #    before Gilbert that this bake never saw is a hole, and a silent hole
    #    is the failure mode. Every row says which family it actually got and,
    #    where that is not V, why.
    print("")
    pre = sorted(((r, y) for r, y in YEAR_BY_REF.items()
                  if y <= ERA_BOUNDS[0][0]), key=lambda t: t[1])
    byref = {}
    for b in scope:
        byref.setdefault(b.ref or "", b)
    seen = [r for r, _ in pre if r in byref]
    vv = [b for b in scope if b.fam == "V"]
    vdoors = sum(len(b.ents) for b in vv)
    print("FAMILY V (pre-%d)  : the register dates %d buildings before the"
          " Gilbert era, %d of" % (ERA_BOUNDS[0][0] + 1, len(pre), len(seen)))
    print("                     them in scope this bake; %d wear family V and"
          " carry %d door(s)." % (len(vv), vdoors))
    for r, y in pre:
        b = byref.get(r)
        got = b.fam if b else "--"
        why = ("" if got == "V" else
               ("   NULL by hand: an outbuilding, no photograph or description"
                " found" if r in NULL_REFS else "   NOT IN SCOPE this bake"))
        print("    %-4s %-34s %4d  fam %-2s  %d door(s)%s"
              % (r, ((b.name or b.osm_name or "?") if b else "(no footprint)")[:34],
                 y, got, len(b.ents) if b else 0, why))
    for b in vv:
        if (b.ref or "") not in dict(pre):
            print("    %-4s %-34s   ??  fam V   <- NOT dated pre-%d by the"
                  " register" % (b.ref or "?",
                                 (b.name or b.osm_name or "?")[:34],
                                 ERA_BOUNDS[0][0] + 1))

    # ── WHAT THE REGISTER SCOPE ACTUALLY BOUGHT, per building, including the
    #    ones it bought nothing on. A building admitted and left empty is the
    #    rule working, not the rule failing: the derivation looked and found
    #    no approach. That row is the honest answer and it must be visible.
    print("")
    print("REGISTER SCOPE     : doors placed on each building this pass"
          " admitted")
    for b in sorted(reg_admitted + reg_area + reg_e1,
                    key=lambda b: (-len(b.ents), b.ref or "")):
        print("    %-4s %-40s %d door(s)  %s"
              % (b.ref, (b.name or b.osm_name or "?")[:40], len(b.ents),
                 dict(Counter(c.src for c in b.ents)) if b.ents
                 else "*** NONE - no approach the derivation could see ***"))
    codes_with_doors = sorted(set(
        b.ref for b in scope if b.ref and b.ref in REG_CODES and b.ents))
    print("    UT register codes carrying at least one door: %d of %d"
          % (len(codes_with_doors), len(REG_CODES)))

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
        # ── THE HONESTY CHECK, MADE A GATE. Recall against the 91 measured
        #    OSM entrance nodes is the only external check this pass has on
        #    where it puts doors. Any change to scope or placement that makes
        #    the derivation more generous shows up HERE first: if it starts
        #    putting doors where real ones are not, recall against the nodes
        #    it can be tested on falls. Measured 67% at 8 m on 2026-08-16,
        #    before and after the register-scope rule, unchanged to the door.
        r8 = hits[8.0] / float(max(1, tot))
        print("    recall floor     : %.0f%% at 8 m, floor %.0f%%  %s"
              % (100 * r8, 100 * RECALL_FLOOR_8M,
                 "OK" if r8 >= RECALL_FLOOR_8M else "*** BELOW FLOOR ***"))
        assert r8 >= RECALL_FLOOR_8M, (
            "OSM recovery fell to %.1f%% at 8 m (floor %.0f%%): the placement "
            "rule just changed is putting doors where measured ones are not"
            % (100 * r8, 100 * RECALL_FLOOR_8M))

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
    # ══════════════════════════════════════════════════════════════════
    #  ERA PROVENANCE — the headline of this pass, printed every run
    #
    #  Not "how many doors", not "how far from UT's door" — WHERE DID EACH
    #  DOOR'S FAMILY COME FROM, and is that source a measurement or a shrug.
    #  Before this block existed the answer was unknowable from the outside
    #  and nobody had asked; the first run of it said 265 of 591 doors, 45%,
    #  and 225 of them had no era at all.
    #
    #  It cannot be gamed by deleting doors: deleting a MEASURED one lowers
    #  the numerator, deleting an unsourced one lowers the denominator, and
    #  the percentage of the CITY that is honestly known does not move up by
    #  drawing less of it. The complement is printed next to it for the same
    #  reason.
    # ══════════════════════════════════════════════════════════════════
    doors = {}
    for f in feats:
        pr = f["properties"]
        if "famsrc" in pr:
            doors[pr["eid"]] = pr
    by_rule = Counter(p.get("famsrc") for p in doors.values())
    by_grade = Counter(ERA_GRADE.get(p.get("famsrc"), ("?", ""))[0]
                       for p in doors.values())
    by_fam = Counter(p.get("fam") for p in doors.values())
    nd = max(1, len(doors))
    print("ERA PROVENANCE     : %d doors; %d MEASURED (%.0f%%), %d AUTHORED,"
          " %d GUESSED, %d with no era known at all"
          % (nd, by_grade["MEASURED"], 100.0 * by_grade["MEASURED"] / nd,
             by_grade["AUTHORED"], by_grade["GUESSED"], by_grade["NONE"]))
    for rule, n in sorted(by_rule.items(), key=lambda kv: -kv[1]):
        grade, what = ERA_GRADE.get(rule, ("?", "unknown rule"))
        print("      %-8s %4d doors  %-8s %s" % (grade, n, rule, what))
    print("  by family        : %s"
          % dict(sorted(by_fam.items(), key=lambda kv: -kv[1])))

    # THE DISAGREEMENT LIST. A hand-typed CELEBRATED family against UT's own
    # measured year, every run, cited or not — this is the audit that found
    # the round's defect and it stays so the class of error cannot hide again.
    dis = []
    for ref, cel in sorted(CELEBRATED.items()):
        yr = YEAR_BY_REF.get(ref)
        if yr is None or era_family_from_year(yr) == cel["fam"]:
            continue
        dis.append((ref, cel["fam"], era_family_from_year(yr), yr,
                    bool(cel.get("fam_src"))))
    print("  hand-typed family vs measured year: %d of %d CELEBRATED rows"
          " disagree" % (len(dis), len(CELEBRATED)))
    for ref, fam, yfam, yr, cited in dis:
        print("      %-4s authored %-2s   year %d says %-2s   %s"
              % (ref, fam, yr, yfam,
                 "CITED, authored wins" if cited
                 else "UNCITED -> the year wins (CEL_FAM_NEEDS_SRC)"))
    uncited = [r for r, _, _, _, c in dis if not c]
    if uncited:
        print("      ^^ %d uncited disagreement(s): %s"
              % (len(uncited), ", ".join(uncited)))

    print("pieces             : %d   kinds %s"
          % (len(feats), dict(Counter(f["properties"]["k"] for f in feats))))
    print("  bad base/h/colour: %d %s" % (len(bad), bad[:5]))
    print("  ramps %d   sign bands %d   arch spandrel sets %d"
          % (stats["ramps"], stats["sign_bands"], stats["arch_spandrels"]))

    # ── WHAT STANDS OVER THE DOOR. Printed loudly because the whole point of
    #    the change is that a canopy is now a claim with a source, and a
    #    table row that reaches no door is a row quietly doing nothing.
    reached = {r for r, _ in SHELTER_USED}
    idle = sorted(set(SHELTER_OBS) - reached)
    print("SHELTER            : %d canopies drawn from a photograph, "
          "%d unevidenced canopies dropped"
          % (stats["canopy_photographed"], stats["canopy_unevidenced_dropped"]))
    print("                     reveal deepened: arcade %d, recess %d, "
          "flush %d"
          % (stats["shelter_reveal_arcade"], stats["shelter_reveal_recess"],
             stats["shelter_reveal_flush"]))
    print("  observations idle: %d of %d rows reached no door on their "
          "building %s"
          % (len(idle), len(SHELTER_OBS), idle[:8]))
    idle_canopy = [r for r in idle if SHELTER_OBS[r]["k"] == "canopy"]
    if idle_canopy:
        print("      ^^ %d of those is a photographed CANOPY that is still "
              "not drawn: %s" % (len(idle_canopy), ", ".join(idle_canopy)))

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

    stats["arcades"] = finish_arcades()
    out = {"type": "FeatureCollection",
           # Provenance, not decoration. Every door below is placed against one
           # named footprint file; this records which, so a check can compare
           # it with what the app draws instead of someone remembering.
           "snapshot": SNAP_DATE,
           "snapshot_source": SNAP_SOURCE,
           "features": feats,
           # PROUD GEOMETRY ONLY. This pass claims no building ids, on purpose
           # and permanently, so it can never collide with facades/drag/heroes/
           # westcampus/capitol in either order.
           "replacedBuildingIds": [],
           # The curves the chords are sampled from — see ARCHES at the top.
           "arches": ARCHES}
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, separators=(",", ":"))
    mb = os.path.getsize(OUT) / 1048576.0
    print("  wrote %s  %.2f MB  (snapshot %s)"
          % (os.path.relpath(OUT, ROOT), mb, SNAP_DATE))
    if mb > 8.0:
        print("  NOTE: this is large enough that it may want tiling later.")


if __name__ == "__main__":
    main()
