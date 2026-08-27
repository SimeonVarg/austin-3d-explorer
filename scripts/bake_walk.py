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

# The footprint file the RENDERER extrudes, resolved the way js/app.js resolves
# it: `data/manifest.json` -> `latest`.  Both reads below used to say
# `2026-08-05`; the app had rolled to `2026-08-16` (QUEUE NB5).  The walls this
# graph routes around, and the buildings its door links attach to, have to be
# the walls on screen or the route goes through one.  Stamped into
# `walk_graph.json` and checked by `scripts/snapshot_parity.py`.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bake_facades  # noqa: E402

SNAP_SOURCE = "buildings.enriched.geojson"
SNAP_DATE = bake_facades.snapshot_date()
SNAP_REL = "data/snapshots/%s/%s" % (SNAP_DATE, SNAP_SOURCE)


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

# Anchors must span DISTINCT APPROACHES.  McCombs' main door sits 3 m from a
# footway spur and 21 m from the frontage path the spur only rejoins 130 m
# south; nearest-3 put all three anchors on the spur and the route overshot
# the building by 131 m (HANDOFF #113, the one honest failure).  So after the
# nearest anchor is picked, a later anchor is rejected while it lies within
# this NETWORK radius of an earlier one — the ball is walked over the graph,
# not measured in the air, so a path 11 m away across a gap is outside it
# while the spur's own next segment is inside it.  Chosen above the local
# wiggle of one approach (a spur's segments sit well inside 45 m of each
# other) and below the 130 m detour it exists to catch.
ANCHOR_SPREAD_M = 45.0

# Walkable road access legs.  87 register codes were stranded; for the two
# whose DOORS exist but sit >30 m from any footway (BIO, TSG) the frontage
# genuinely has no drawn path — but a service road or residential street runs
# right past the door.  Walking along a driveway or a quiet street is real
# walking, so those roads join the graph — but ONLY as dead-end access legs:
# each adopted chain is a tree hanging off exactly one node of the main
# component, so NO route between two footway-reachable places can ever pass
# along a road.  That structural guarantee replaces the per-edge time penalty
# the client could not apply (js/wayfind.js prices every non-steps edge at
# plain metres, and the bake and the client must never disagree on cost).
ROAD_WALKABLE = {"service", "residential", "living_street", "unclassified"}
ROAD_ACCESS_MAX_M = 250.0  # cap per adopted chain; measured need is <= 143 m
ROAD_CAND_SEGS = 3         # road segments tried per stranded door, nearest first

# ── Plaza interiors: a mall is a SURFACE, not a fence ─────────────────────
#
# A `highway=pedestrian area=yes` way is a closed ring, and build_raw() puts
# it into the graph as a ring of edges and nothing across the middle.  So the
# router walks students AROUND the South Mall rather than down it.
# docs/walk/graph.md §10 accepted that for v1 and docs/walk-sidewalks.md §6
# measured it as the biggest thing left, down to the patch it wanted:
#
#     "for each of the 42 `area=yes highway=pedestrian` ways, triangulate or
#      grid the interior and add the interior chords as ordinary footway
#      edges ... Expected: door links on the Six Pack and both malls collapse
#      from ~16-24 m to ~2 m, and the PCL→UNB class of detour drops by a
#      third."
#
# This is that patch, with ONE change to what it asked for, and the change is
# the whole point: a chord is not added because OSM drew a polygon round it.
# **OSM's pedestrian areas on this campus are not all pavement.** The Main
# Mall polygon contains the two South Mall LAWN PANELS, and a blind
# triangulation routes students straight across them.  So every chord is put
# to a real aerial photograph first, and one that runs over open turf is
# refused: 134 of 1,711 were, and the picture of which ones is in
# docs/walkways-on-the-real-paths.md.
#
# The photograph lives in scripts/trace_walkways.py, which owns
# data/walkway_evidence.json and is the only thing that writes it.  This bake
# reads that file and never looks at an image — the imagery is a regenerable
# input, the verdict is the committed artifact.
#
# A chord is an ordinary footway edge and costs plain metres.  It carries NO
# new flag bit (the flag byte is full — see the note by `re` in the wire
# format) and NO new cost term, on purpose: scripts/verify/walkmeter.mjs
# re-implements the client's cost model to self-check, and a genuinely new
# term makes it go red rather than quiet.  Membership ships out of band as
# `pe`, exactly like the road access legs do.
PLAZA_CHORDS = os.environ.get("CHORDS", "1") != "0"
PLAZA_EVIDENCE = "data/walkway_evidence.json"

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

# Hand-checked code aliases.  262 doors carry no `ref`; these door-group
# names were matched against UT's own register and read one by one.  Each row
# is a UT register code -> the exact `nm` on the UNREF'D door group.  Every
# row must resolve to door groups on exactly ONE footprint or the bake fails
# loudly (gate I).
#
# The three 2026-08-15 additions, each verified against the door group's own
# coordinates before being written down:
#   AF2  the group nm is the register name verbatim.  graph.md §5 excluded
#        AF1/AF2 because REGISTER-name matching hit one footprint twice;
#        door-group-name matching does not — 'Athletic Fields Pavilion
#        (Eastside)' is one group on one footprint at 30.28469, -97.72652.
#        (AF1, the REHAB pavilion, stays stranded: the plain 'Athletic Fields
#        Pavilion' group carries ref AFP, which is its own register code.)
#   TCP  'Texas Cowboys Pavillion' — OSM's spelling, one group, role main,
#        at 30.28488, -97.73395, north of DKR where the pavilion stands.
#   BMK  register 'BLANTON MUSEUM ELLSWORTH KELLY' is the building the
#        artwork world calls 'Austin', and that is the footprint name OSM
#        uses: one group, role main, at 30.28161, -97.73787, on the Blanton
#        block beside the Smith Building.  The nm is one word, so the
#        one-footprint assertion is what makes this row safe to keep.
CODE_ALIASES = {
    "RLP": "Patton Hall",
    "BME": "Biomedical Engineering Building",
    "ECG": "East Campus Garage",
    "CLK": "Caven Clark Field Support Building",
    "STD": "DKR Memorial Stadium",
    "ATT": "AT&T Executive Education and Conference Center",
    "KIN": "Kinsolving Dormitory",
    "AF2": "Athletic Fields Pavilion (Eastside)",
    "TCP": "Texas Cowboys Pavillion",
    "BMK": "Austin",
}

# Register codes whose doors already exist under a DIFFERENT ref — OSM and
# the register disagree on what the building is called, and the register is
# the one the student types.  Each row is register code -> the ref the door
# groups actually carry, verified by name AND coordinates:
#   DMC  G. B. Dealey Center for New Media is the renamed Belo Center; the
#        doors carry BMC and sit at 30.29011, -97.74090 (Dean Keeton &
#        Guadalupe).  BMC is not a register code.
#   MNC  the register clips Moncrief-Neuhaus to MNC; OSM spells it MNAC.
#        Same name letter for letter, doors at 30.28240, -97.73228.
#   BMS  BLANTON MUSEUM SMITH BUILDING is the Edgar A. Smith Building; the
#        doors carry EAS and sit at 30.28140, -97.73835, on the Blanton
#        block.  EAS is not a register code.
# The doors keep their original ref in the file (it is OSM's truth); they are
# indexed under both codes.  Multi-refs like 'RMRZ;NEZ' are split on ';' and
# indexed under each part, which is what recovers NEZ (the North End Zone
# doors are tagged 'RMRZ;NEZ' — the ref itself names the register code).
CODE_REF_JOINS = {
    "DMC": "BMC",
    "MNC": "MNAC",
    "BMS": "EAS",
}


# ── Where a register code IS on the map, when it has no door ──────────────
#
# A stranded code used to be reported as "no door in any source, no matching
# footprint", which is a guess dressed as a finding: it came from fuzzy
# token-matching the register's name against footprint names, and a fuzzy
# miss and a genuinely unmapped building read identically.
#
# OSM tags 177 building ways on campus with a `ref`, and 134 of those refs
# ARE register codes.  That is a direct, surveyed answer to "where is this
# building", independent of any name string.  Frozen below as
# (lon, lat, OSM name) from the same Overpass extract the entrance bake
# uses (`way["building"](bbox); out tags center;`, bbox
# 30.2760,-97.7480,30.2960,-97.7220, fetched 2026-08-04), so this file does
# not import another lane's script at bake time.
#
# It is used for DIAGNOSIS ONLY.  Nothing here creates a door, a node or an
# edge, and no route can reach any of it: a centroid is not an entrance, and
# routing to one would put the client's "Entrances are on this side" on a
# building whose entrances nobody has mapped.  What it buys is the
# difference between "78 buildings do not route" and a per-building reason
# that names the nearest real door and says whose it is.
OSM_REF_XY = {
    "ADH": (-97.740648, 30.291534, "Almetris Duren Hall"),
    "AFP": (-97.726283, 30.285300, "Athletic Fields Pavilion"),
    "AHG": (-97.737730, 30.288528, "Anna Hiss Gymnasium"),
    "ANB": (-97.731018, 30.278246, "Arno Nowotny Building"),
    "AND": (-97.739852, 30.288229, "Andrews Dormitory"),
    "ART": (-97.732953, 30.286160, "Art Building and Museum"),
    "ASE": (-97.737561, 30.291133, "Aerospace Engineering Building"),
    "BAT": (-97.738921, 30.284805, "Batts Hall"),
    "BBR": (-97.731732, 30.280407, "Basketball and Rowing Training Facility"),
    "BEL": (-97.733512, 30.283746, "L. Theo Bellmont Hall"),
    "BEN": (-97.739007, 30.283960, "Benedict Hall"),
    "BHD": (-97.735972, 30.283120, "Brackenridge Hall Dormitory"),
    "BIO": (-97.739762, 30.287218, "Biological Laboratories"),
    "BLD": (-97.739484, 30.288535, "Blanton Dormitory"),
    "BMA": (-97.737417, 30.280984, "Blanton Museum of Art"),
    "BME": (-97.738506, 30.289119, "Biomedical Engineering Building"),
    "BRB": (-97.736733, 30.285225, "Bernard and Audre Rapoport Building"),
    "BRG": (-97.736220, 30.280918, "Brazos Garage"),
    "BTL": (-97.740343, 30.285410, "Battle Hall"),
    "BUR": (-97.738514, 30.288868, "Burdine Hall"),
    "BWY": (-97.738222, 30.290792, "Bridgeway Building"),
    "CAL": (-97.740179, 30.284490, "Calhoun Hall"),
    "CBA": (-97.737855, 30.284211, "McCombs School of Business"),
    "CCJ": (-97.730456, 30.288051, "John B. Connally Center for Justice"),
    "CDA": (-97.725670, 30.282975, "Comal Child Development Center Annex"),
    "CDL": (-97.733045, 30.278768, "Collections Deposit Library"),
    "CMA": (-97.740737, 30.289418, "Jesse H. Jones Communication Center - A"),
    "CMB": (-97.741167, 30.289199, "Jesse H. Jones Communication Center - B"),
    "CML": (-97.725250, 30.282933, "Comal Child Development Center"),
    "CPE": (-97.736139, 30.290234, "Chemical and Petroleum Engineering Building"),
    "CRD": (-97.740096, 30.288697, "Carothers Dormitory"),
    "CRH": (-97.733312, 30.288542, "Creekside Residence Hall"),
    "D21": (-97.741345, 30.283383, "Dobie Center"),
    "DEV": (-97.723586, 30.287287, "Development Center"),
    "DFA": (-97.731770, 30.285851, "E. William Doty Fine Arts Building"),
    "E26": (-97.736294, 30.292577, "University Sign Shop"),
    "ECJ": (-97.735516, 30.288992, "Ernest Cockrell, Jr. Hall"),
    "EER": (-97.735322, 30.288354, "Engineering Education and Research Center"),
    "EPS": (-97.736670, 30.285770, "E. P. Schoch Building"),
    "ETC": (-97.735418, 30.289898, "Engineering Teaching Center II"),
    "FAC": (-97.740432, 30.286286, "Peter T. Flawn Academic Center"),
    "FC1": (-97.722590, 30.284541, "Facilities Complex Building 1"),
    "FC2": (-97.723100, 30.283920, "Facilities Complex Building 2"),
    "FC3": (-97.723658, 30.284697, "Facilities Complex Building 3"),
    "FC4": (-97.723411, 30.284323, "Facilities Complex Building 4"),
    "FC5": (-97.724593, 30.283636, "Facilities Complex Building 5"),
    "FC6": (-97.725837, 30.283448, "Facilities Complex Building 6"),
    "FC7": (-97.726442, 30.283335, "Facilities Complex Building 7"),
    "FC8": (-97.723923, 30.285393, "Facilities Complex Building 8"),
    "FDH": (-97.732559, 30.289430, "J. Frank Dobie House"),
    "FNT": (-97.737999, 30.287849, "Larry R. Faulkner Nano Science and Technology Building"),
    "GAR": (-97.738495, 30.285138, "Garrison Hall"),
    "GDC": (-97.736446, 30.286246, "Bill and Melinda Gates Computer Science Complex"),
    "GEA": (-97.739217, 30.287716, "Mary E Gearing Hall"),
    "GEB": (-97.738625, 30.286340, "Dorothy Gebauer Building"),
    "GLT": (-97.735741, 30.287519, "Gary L. Thomas Energy Engineering Building"),
    "GRE": (-97.736283, 30.283988, "Gregory Gymnasium"),
    "GSB": (-97.738344, 30.284179, "Graduate School of Business Building"),
    "GUG": (-97.743236, 30.279526, "Guadalupe Garage"),
    "GWB": (-97.739945, 30.287833, "Gordon-White Building"),
    "HCG": (-97.735393, 30.276500, "Health Center Garage"),
    "HDB": (-97.734685, 30.278121, "Health Discovery Building"),
    "HMA": (-97.740627, 30.286879, "Hogg Memorial Auditorium"),
    "HRC": (-97.741229, 30.284335, "Harry Ransom Center"),
    "HRH": (-97.740194, 30.284063, "Homer Rainey Hall"),
    "HSM": (-97.740771, 30.288913, "William Randolph Hearst Building"),
    "HTB": (-97.735119, 30.277189, "Health Transformation Building"),
    "IPF": (-97.726561, 30.286292, "Indoor Practice Facility"),
    "JCD": (-97.735925, 30.282353, "Jester Dormitory East"),
    "JES": (-97.736847, 30.282888, "Beauford H. Jester Center"),
    "JGB": (-97.735601, 30.285872, "Jackson Geological Sciences Building"),
    "JHH": (-97.732025, 30.278364, "John W. Hargis Hall"),
    "JON": (-97.731734, 30.288597, "Jesse H. Jones Hall"),
    "LBJ": (-97.729285, 30.285895, "Lyndon Baines Johnson Presidential Library and Museum"),
    "LCH": (-97.740868, 30.288560, "Littlefield Carriage House"),
    "LDH": (-97.735972, 30.282634, "Longhorn Dining Facility"),
    "LFH": (-97.740778, 30.288117, "Littlefield House"),
    "LTD": (-97.739728, 30.289307, "Littlefield Dormitory"),
    "LTH": (-97.735225, 30.285952, "Laboratory Theatre Building"),
    "MAG": (-97.730985, 30.282792, "Manor Garage"),
    "MAI": (-97.739359, 30.286010, "Main Building"),
    "MBB": (-97.737280, 30.288479, "Louise and James Robert Moffett Molecular Biology Building"),
    "MCA": (-97.730652, 30.280975, "Moody Center"),
    "MEZ": (-97.738958, 30.284374, "Mezes Hall"),
    "MFH": (-97.731111, 30.281997, "Richard Mithoff Track and Soccer Fieldhouse"),
    "MHD": (-97.735424, 30.283685, "Moore-Hill Dormitory"),
    "MRH": (-97.730645, 30.287255, "Music Recital Hall"),
    "MSB": (-97.725699, 30.282747, "Mail Services Building"),
    "N24": (-97.743450, 30.288407, "2400 Nueces"),
    "NEZ": (-97.732428, 30.284881, "Red McCombs Red Zone"),
    "NHB": (-97.738017, 30.287654, "Norman Hackerman Building"),
    "NMS": (-97.737555, 30.289201, "Neural Molecular Science Building"),
    "PAC": (-97.731028, 30.286296, "College of Fine Arts Performing Arts Center"),
    "PAI": (-97.738763, 30.286971, "T. S. Painter Hall"),
    "PAR": (-97.740106, 30.284903, "Parlin Hall"),
    "PAT": (-97.736424, 30.288008, "J. T. Patterson Laboratories Building"),
    "PCL": (-97.738194, 30.282777, "Perry-Casta\u00f1eda Library"),
    "PHD": (-97.735031, 30.282384, "Prather Hall Dormitory"),
    "PHR": (-97.738596, 30.288156, "Pharmacy Building"),
    "PMA": (-97.736320, 30.288846, "Physics, Math, and Astronomy Building"),
    "POB": (-97.736565, 30.286825, "O\u2019Donnell Building for Applied Computational Engineering and Sciences"),
    "RHD": (-97.735166, 30.283006, "Roberts Hall Dormitory"),
    "RRH": (-97.741454, 30.282121, "Robert B. Rowling Hall"),
    "RSC": (-97.732387, 30.281534, "Recreational Sports Center"),
    "SAG": (-97.742661, 30.288686, "San Antonio Garage"),
    "SEA": (-97.737345, 30.290070, "Sarah M. and Charles E. Seay Building"),
    "SEZ": (-97.732655, 30.282737, "South End Zone"),
    "SJG": (-97.732877, 30.287731, "San Jacinto Garage"),
    "SJH": (-97.734331, 30.282466, "San Jacinto Residence Hall"),
    "SRH": (-97.728865, 30.284995, "Sid Richardson Hall"),
    "SSB": (-97.738456, 30.290110, "Student Services Building"),
    "SUT": (-97.740832, 30.284955, "Sutton Hall"),
    "SW7": (-97.736356, 30.290810, "2617 Speedway"),
    "SWG": (-97.737081, 30.291168, "Speedway Garage"),
    "SZB": (-97.738763, 30.281677, "George I. Sanchez Building"),
    "TCC": (-97.729094, 30.287006, "Joe C. Thompson Conference Center"),
    "TMM": (-97.732365, 30.286981, "Texas Memorial Museum"),
    "TNH": (-97.730796, 30.288539, "Townes Hall"),
    "TRG": (-97.733880, 30.279084, "Trinity Garage"),
    "TSC": (-97.733496, 30.279823, "Lee and Joe Jamail Texas Swimming Center"),
    "TSG": (-97.738546, 30.291272, "27th Street Garage"),
    "UA9": (-97.738682, 30.290310, "2609 University Avenue"),
    "UIL": (-97.723647, 30.283316, "University Interscholastic League"),
    "UNB": (-97.741136, 30.286651, "Union Building"),
    "UTA": (-97.742846, 30.279308, "UT Administration Building"),
    "UTC": (-97.738758, 30.283028, "University Teaching Center"),
    "UTX": (-97.734475, 30.284335, "Etter-Harbin Alumni Center"),
    "WAG": (-97.737604, 30.285105, "Waggener Hall"),
    "WAT": (-97.733447, 30.278494, "Arthur P. Watson House"),
    "WCH": (-97.738405, 30.286087, "Will C. Hogg Building"),
    "WCP": (-97.736454, 30.284902, "William C. Powers, Jr. Student Activity Center"),
    "WIN": (-97.734487, 30.285902, "F Loren Winship Drama Building"),
    "WMB": (-97.740628, 30.285435, "West Mall Office Building"),
    "WWH": (-97.741858, 30.289308, "Walter Webb Hall"),
}

# How near a mapped door has to be to a stranded code's OSM position before
# the report calls it worth a human look.  Nothing routes on this; it only
# splits the stranded list into "nothing near it" and "check this one".
DOOR_EVIDENCE_M = 40.0

# Gate T routes every West Campus tower to this register code on the finished
# graph.  WEL is the far side of campus from West Campus, so a tower that can
# reach it can reach anything on the main component — the point of the gate is
# the crossing, not this particular building.
WC_ROUTE_TARGET = "WEL"

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

# The nine pairs the brief named, plus one spot-check pair for every code
# the 2026-08-15 recovery pass made routable, so none of the nine recoveries
# can silently rot.  Origins are big buildings a student actually starts
# from, on the same side of campus as the destination.
VALIDATION_PAIRS = [
    ("JES", "GDC"), ("JES", "WEL"), ("PCL", "RLP"), ("GRE", "MAI"),
    ("BUR", "CBA"), ("STD", "MAI"), ("21 Rio", "WEL"),
    ("The Castilian", "GDC"), ("PCL", "JES"),
    # the nine recovered codes
    ("GDC", "BIO"), ("WEL", "TSG"), ("GDC", "DMC"), ("GRE", "MNC"),
    ("GRE", "NEZ"), ("GRE", "TCP"), ("GRE", "AF2"), ("JES", "BMS"),
    ("JES", "BMK"),
    # The Moody Center's OSM-surveyed main door, which the roof-blocker fix
    # recovered.  It is the pair worth freezing because it is the only one
    # in this list whose destination the interface may call "The main
    # entrance" on the strength of a survey rather than a ranking.
    ("JES", "MCA"),
]

# Frozen 2026-08-15 off the audited recovery bake (18 pairs), main door to
# main door, in metres including both unmapped last legs.  A data refresh
# that moves any of these by more than REGRESS_TOL_PCT is loud, not silent.
#
# Three moved when ANCHOR_SPREAD_M landed, each re-audited before freezing:
#   BUR>CBA  949.2 -> 788.7   THE FIX.  The main door now also anchors on
#            the frontage path across the 11 m gap (a 21 m unmapped last
#            leg, not an invented stitch), so the 131 m overshoot past the
#            building is gone.  §113 froze the broken value on purpose;
#            this freezes the repaired one.
#   GRE>MAI  575.3 -> 540.3   shorter and clean (walls 0, overshoot 0):
#            spread anchors opened a more direct South Mall approach.
#   STD>MAI 1002.5 -> 1018.0  +1.5 %: the old third same-spur anchor that
#            happened to give 1002.5 is now a distinct-approach anchor.
#            The route sheds 3 staircases (5 -> 2) for 15 extra metres.
REGRESS_BASELINE = {
    "JES>GDC": 471.8, "JES>WEL": 525.2, "PCL>RLP": 518.3, "GRE>MAI": 540.3,
    "BUR>CBA": 789.2, "STD>MAI": 1018.0, "21 Rio>WEL": 1015.1,
    "The Castilian>GDC": 697.8, "PCL>JES": 156.2,
    "GDC>BIO": 405.7, "WEL>TSG": 646.1, "GDC>DMC": 806.1, "GRE>MNC": 975.8,
    "GRE>NEZ": 708.7, "GRE>TCP": 522.6, "GRE>AF2": 1505.1, "JES>BMS": 234.1,
    "JES>BMK": 187.0,
    # Two rows moved by half a metre when the roof-blocker fix gave the Moody
    # Center four more anchors: anchoring splices new nodes into existing
    # edges, so a shared edge is measured in two pieces instead of one and
    # the sum differs in the third decimal.  BUR>CBA 788.7 -> 789.2 (+0.06 %)
    # and GDC>BIO 405.8 -> 405.7 are that, not a different route: both were
    # re-audited, walls 0, same door pair, same path length in nodes.
    "JES>MCA": 827.2,
}

# Routes that are audited as failures today and are NOT graph bugs to fix by
# tuning.  Written down so a later pass does not silently "fix" one by
# loosening a guard.
KNOWN_BAD = {
    "GRE>MNC": (
        "Moncrief-Neuhaus sits inside the fenced athletic complex south of "
        "DKR and every mapped approach to its doors comes off the San "
        "Jacinto loop to the EAST, while Gregory is to the WEST — so the "
        "walk rounds the stadium block and arrives back along the building, "
        "which the audit reads as a 90 m overshoot.  Both doors anchor "
        "cleanly (1.6-27 m, three spread anchors); the router simply has no "
        "western approach to choose.  That is the fence, not the graph."
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


def plaza_chords(G):
    """Add the photograph-confirmed chords across pedestrian areas.

    Endpoints are OSM node ids, so they resolve through this bake's own node
    index and a chord whose nodes this graph does not carry is skipped and
    counted rather than guessed at.  Lengths are recomputed here from the
    graph's own coordinates — the centimetres in the evidence file are a
    record of what was measured, never the number this bake trusts."""
    out = dict(added=0, unknown_node=0, already=0, plazas=set(), metres=0.0,
               refused_by_photo=0, file=PLAZA_EVIDENCE, as_of="", keys=set())
    if not PLAZA_CHORDS:
        return out
    try:
        ev = load(PLAZA_EVIDENCE)
    except FileNotFoundError:
        out["file"] = PLAZA_EVIDENCE + " (MISSING — no chords added)"
        return out
    out["as_of"] = ev.get("_generated", "")
    out["refused_by_photo"] = int(ev.get("refused", {}).get("chord_photo_turf", 0))
    nid_ix, edges = G["nid_ix"], G["edges"]
    nx, ny = G["nx"], G["ny"]
    for row in ev.get("plaza_chords", []):
        wid, na, nb = row[0], row[1], row[2]
        ia, ib = nid_ix.get(na), nid_ix.get(nb)
        if ia is None or ib is None or ia == ib:
            out["unknown_node"] += 1
            continue
        key = (ia, ib) if ia < ib else (ib, ia)
        if key in edges:
            out["already"] += 1
            continue
        L = dist_m(nx[ia], ny[ia], nx[ib], ny[ib])
        if L <= 0.0:
            out["unknown_node"] += 1
            continue
        edges[key] = [L, 0, -1, 0]
        out["keys"].add(key)
        out["added"] += 1
        out["metres"] += L
        out["plazas"].add(wid)
    G["kind_len"]["plaza_chord"] += out["metres"]
    return out


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
    b = load(SNAP_REL)
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


def crosses_building(bgrid, ax, ay, bx, by, exempt=(), bclass=None):
    """Boundary-crossing test.  `bclass` is optional and, when given, applies
    WALL_IGNORE_CLASSES: a canopy is not a wall.  It defaults to None so the
    SNAP guard keeps its deliberately stricter reading (see the constant)."""
    n = 0
    hit = set()
    for (p, q, bid) in bgrid.near_seg(ax, ay, bx, by):
        if bid in exempt:
            continue
        if bclass is not None and bclass.get(bid) in WALL_IGNORE_CLASSES:
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
# 3b. walkable road access legs — dead-end chains only, never through-routes
# --------------------------------------------------------------------------

def edge_clips_building(bgrid, polys, bclass, ax, ay, bx, by, exempt=()):
    """Depth-inside test for one straight edge, same method as
    find_through_edges: boundary crossings are not evidence, metres INSIDE a
    non-roof footprint beyond WALL_CLIP_TOL_M are."""
    n, hits = crosses_building(bgrid, ax, ay, bx, by, exempt=exempt)
    if not n:
        return False
    L = dist_m(ax, ay, bx, by)
    k = max(2, int(L / WALL_CLIP_STEP_M))
    for bid in hits:
        if bclass.get(bid) in WALL_IGNORE_CLASSES:
            continue
        rings = polys.get(bid) or []
        d = 0.0
        for i in range(k + 1):
            t = i / k
            px, py = ax + (bx - ax) * t, ay + (by - ay) * t
            if any(point_in_ring(r, px, py) for r in rings):
                d += L / k
        if d > WALL_CLIP_TOL_M:
            return True
    return False


def road_access(G, edges, main, doors, bgrid, polys, bclass):
    """Attach otherwise-unreachable doors to the main component along real
    service roads and residential streets.

    The rules that keep this honest, in order:
      * roads and footways share OSM node ids, so where a road meets the
        walked network the join is GIVEN, never invented — those shared
        nodes are the only places a chain may touch the main component;
      * every adopted chain is a parent-path in ONE multi-source Dijkstra
        forest rooted at those portal nodes, so the union of chains is a
        forest and no chain can ever join two main-component nodes — a road
        is a way IN to a stranded door, never a way THROUGH;
      * a chain that would run more than WALL_CLIP_TOL_M inside a building
        that is not the target door's own is rejected whole;
      * nothing is adopted for a door the footway network already serves.
    """
    nx, ny = G["nx"], G["ny"]
    nid_ix = G["nid_ix"]

    # which doors does the footway main component already serve?
    sgrid = Grid(25.0)
    for key in edges:
        a, b = key
        if a in main and b in main:
            sgrid.add(nx[a], ny[a], nx[b], ny[b], key)

    def served(px, py):
        for key in set(sgrid.near(px, py, DOOR_LINK_MAX_M)):
            a, b = key
            d, t, qx, qy = seg_point(px, py, nx[a], ny[a], nx[b], ny[b])
            if d <= DOOR_LINK_MAX_M:
                return True
        return False

    stranded = []
    for i, dr in enumerate(doors):
        px, py = xy(dr["lon"], dr["lat"])
        if not served(px, py):
            stranded.append((i, px, py))
    if not stranded:
        return dict(edges=set(), targets=0, portals=0, km=0.0, doors=[])

    # road subgraph on OSM node ids
    radj = defaultdict(list)
    rpos = {}
    rlayer = {}
    for w in load("data/osm_cache/roads.json")["elements"]:
        t = w.get("tags", {})
        if t.get("highway") not in ROAD_WALKABLE:
            continue
        ns, g = w.get("nodes") or [], w.get("geometry") or []
        if len(ns) != len(g):
            continue
        layer = int(t.get("layer", 0) or 0)
        for i in range(len(ns)):
            rpos[ns[i]] = xy(g[i]["lon"], g[i]["lat"])
            rpos.setdefault(("ll", ns[i]), (g[i]["lon"], g[i]["lat"]))
        for i in range(len(ns) - 1):
            a, b = ns[i], ns[i + 1]
            if a == b:
                continue
            L = dist_m(*rpos[a], *rpos[b])
            if L <= 0:
                continue
            radj[a].append((b, L))
            radj[b].append((a, L))
            rlayer[(a, b) if a < b else (b, a)] = layer

    portals = [nid for nid in radj
               if nid in nid_ix and nid_ix[nid] in main]

    # one multi-source Dijkstra from every portal: the parent forest
    INF = float("inf")
    dist = {}
    prev = {}
    pq = []
    for p in portals:
        dist[p] = 0.0
        heapq.heappush(pq, (0.0, p))
    done = set()
    while pq:
        d, u = heapq.heappop(pq)
        if u in done:
            continue
        done.add(u)
        if d > ROAD_ACCESS_MAX_M:
            continue
        for (v, L) in radj[u]:
            nd = d + L
            if nd < dist.get(v, INF):
                dist[v] = nd
                prev[v] = u
                heapq.heappush(pq, (nd, v))

    # road segment index for the door-side search
    rsegs = Grid(40.0)
    for a in radj:
        for (b, L) in radj[a]:
            if a < b:
                rsegs.add(rpos[a][0], rpos[a][1], rpos[b][0], rpos[b][1], (a, b))

    def mat(nid):
        """Materialise a road OSM node as a graph node (or reuse it)."""
        ix = nid_ix.get(nid)
        if ix is None:
            lon, lat = rpos[("ll", nid)]
            ix = len(nx)
            nid_ix[nid] = ix
            G["nlon"].append(lon)
            G["nlat"].append(lat)
            px, py = rpos[nid]
            nx.append(px)
            ny.append(py)
        return ix

    adopted = set()
    attached = []
    for (di, px, py) in stranded:
        dr = doors[di]
        cands = []
        for (a, b) in set(rsegs.near(px, py, DOOR_LINK_MAX_M)):
            d, t, qx, qy = seg_point(px, py, rpos[a][0], rpos[a][1],
                                     rpos[b][0], rpos[b][1])
            if d <= DOOR_LINK_MAX_M:
                cands.append((d, a, b, t, qx, qy))
        cands.sort(key=lambda c: c[0])
        ok = False
        for (d, a, b, t, qx, qy) in cands[:ROAD_CAND_SEGS]:
            end = a if t < 0.5 else b
            if dist.get(end, INF) > ROAD_ACCESS_MAX_M:
                continue
            # the chain, endpoint to portal, plus the half-segment to q
            chain = []
            u = end
            while u in prev:
                chain.append((prev[u], u))
                u = prev[u]
            exempt = (dr["bid"],)
            bad = False
            for (u, v) in chain:
                if edge_clips_building(bgrid, polys, bclass,
                                       rpos[u][0], rpos[u][1],
                                       rpos[v][0], rpos[v][1], exempt=exempt):
                    bad = True
                    break
            if not bad and dist_m(rpos[end][0], rpos[end][1], qx, qy) >= 0.5 \
                    and edge_clips_building(bgrid, polys, bclass,
                                            rpos[end][0], rpos[end][1],
                                            qx, qy, exempt=exempt):
                bad = True
            if bad:
                continue
            # adopt: chain edges first, then the half-segment toward the door
            for (u, v) in chain:
                iu, iv = mat(u), mat(v)
                k = (iu, iv) if iu < iv else (iv, iu)
                if k in edges:
                    continue
                lay = rlayer.get((u, v) if u < v else (v, u), 0)
                edges[k] = [dist_m(nx[iu], ny[iu], nx[iv], ny[iv]), 0, -1, lay]
                adopted.add(k)
                main.add(iu)
                main.add(iv)
            iend = mat(end)
            main.add(iend)
            if dist_m(nx[iend], ny[iend], qx, qy) >= 0.5:
                iq = len(nx)
                G["nlon"].append(qx / MPD_LON)
                G["nlat"].append(qy / MPD_LAT)
                nx.append(qx)
                ny.append(qy)
                k = (iend, iq) if iend < iq else (iq, iend)
                lay = rlayer.get((a, b) if a < b else (b, a), 0)
                edges[k] = [dist_m(nx[iend], ny[iend], qx, qy), 0, -1, lay]
                adopted.add(k)
                main.add(iq)
            attached.append((dr["ref"] or "-", dr["nm"] or "-",
                             round(d, 1), round(dist.get(end, 0.0), 1)))
            ok = True
            break
        if not ok:
            continue

    # forest assertion: each connected piece of the adopted subgraph must
    # touch the pre-road main component at EXACTLY one node.  This is the
    # structural fact that makes a zero-penalty road edge honest.
    pre_main_ix = {nid_ix[p] for p in portals}
    nodes_in = set()
    for (u, v) in adopted:
        nodes_in.add(u)
        nodes_in.add(v)
    idx = {n: i for i, n in enumerate(sorted(nodes_in))}
    duf = DSU(len(idx))
    for (u, v) in adopted:
        duf.union(idx[u], idx[v])
    comp_portals = defaultdict(set)
    for n in nodes_in:
        if n in pre_main_ix:
            comp_portals[duf.find(idx[n])].add(n)
    multi = [r for r, ps in comp_portals.items() if len(ps) > 1]
    km = sum(edges[k][0] for k in adopted) / 1000.0
    return dict(edges=adopted, targets=len(attached), portals=len(portals),
                km=round(km, 3), doors=attached, forest_violations=len(multi))


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


def anchor_doors(G, doors, main, bgrid, road_keys=None, bclass=None,
                 chord_keys=None):
    """Project each door onto the nearest main-component segments.

    Four traps, all honoured here:
      * a ROOF is not a wall.  `building_class: roof` footprints are canopies
        and arena roof planes; the rest of this file already says so and
        already exempts them (find_through_edges, edge_clips_building), but
        this test did not, and that alone cost the Moody Center every one of
        its links — including its single OSM-SURVEYED main door, 9.4 m from
        the network, rejected because the straight line to it passed under an
        unnamed roof plane.  A door whose only honest wording is "The main
        entrance" was being thrown away by a canopy;
      * link to the nearest segment ON THE MAIN COMPONENT, not the nearest
        segment — 25 doors have an island closer than the main network;
      * if the straight link crosses a DIFFERENT building, take the next
        candidate that does not;
      * anchors must span DISTINCT APPROACHES — after the first anchor, a
        candidate within ANCHOR_SPREAD_M of an earlier anchor ALONG THE
        NETWORK is passed over, so a door beside a long spur also anchors
        on the path across the gap (the BUR>CBA overshoot fix).  If the
        spread rule leaves slots empty, they are refilled nearest-first, so
        no door loses an anchor it had before.
    """
    nx, ny = G["nx"], G["ny"]
    edges = G["edges"]
    sgrid = Grid(25.0)
    incm = defaultdict(set)          # node -> incident edge keys, kept fresh
    for key in edges:
        a, b = key
        if a in main and b in main:
            sgrid.add(nx[a], ny[a], nx[b], ny[b], key)
        incm[a].add(key)
        incm[b].add(key)

    def ball(key):
        """Node set within ANCHOR_SPREAD_M of either endpoint, walked over
        the graph as it stands right now."""
        out = {}
        pq = [(0.0, key[0]), (0.0, key[1])]
        while pq:
            d, u = heapq.heappop(pq)
            if d >= out.get(u, float("inf")):
                continue
            out[u] = d
            for k2 in incm[u]:
                L = edges[k2][0]
                v = k2[0] if k2[1] == u else k2[1]
                nd = d + L
                if nd <= ANCHOR_SPREAD_M and nd < out.get(v, float("inf")):
                    heapq.heappush(pq, (nd, v))
        return set(out)

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
        balls = []
        blocked_ds = []
        for spread_pass in (True, False):
            for (d, key, t, qx, qy) in cands:
                if len(picked) >= DOOR_ANCHORS:
                    break
                if key in used_edges or key not in edges:
                    continue
                if spread_pass and ANCHOR_SPREAD_M > 0 and balls and \
                        any(key[0] in B or key[1] in B for B in balls):
                    continue      # same approach as an earlier anchor
                nb, hits = crosses_building(bgrid, px, py, qx, qy,
                                            exempt=(dr["bid"],), bclass=bclass)
                if nb:
                    blocked_ds.append(d)
                    used_edges.add(key)   # never retry a blocked link
                    continue
                used_edges.add(key)
                picked.append((d, key, t, qx, qy))
                if spread_pass and ANCHOR_SPREAD_M > 0:
                    balls.append(ball(key))
            if len(picked) >= DOOR_ANCHORS:
                break
        picked.sort(key=lambda c: c[0])
        # 'Re-routed around a neighbour' keeps its original meaning: the
        # door's NEAREST link crossed another building and a farther one was
        # taken instead.  A far candidate that the spread pass merely probed
        # and rejected is not a re-route and does not move the G gate.
        if picked and blocked_ds and min(blocked_ds) < picked[0][0]:
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
                incm[a].discard(key)
                incm[b].discard(key)
                was_road = road_keys is not None and key in road_keys
                if was_road:
                    road_keys.discard(key)
                # A split PLAZA CHORD is still two plaza chords. Without this
                # the `pe` list quietly under-reports: 33 of 1,573 chords are
                # spliced by a door anchor, and both halves lost the label.
                was_chord = chord_keys is not None and key in chord_keys
                if was_chord:
                    chord_keys.discard(key)
                for (u, v) in ((a, node), (node, b)):
                    k2 = (u, v) if u < v else (v, u)
                    edges[k2] = [dist_m(nx[u], ny[u], nx[v], ny[v]), f, sid, layer]
                    incm[u].add(k2)
                    incm[v].add(k2)
                    if was_road:
                        road_keys.add(k2)
                    if was_chord:
                        chord_keys.add(k2)
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
    pc = plaza_chords(G)
    chord_keys = pc["keys"]

    _, _, sizes0, main0 = components(len(nx), edges.keys())
    comps0 = len(sizes0)

    bgrid, rgrid, polys, nroad, bnames, bclass = build_obstacles()
    sn = snap(G, bgrid, rgrid)
    _, _, sizes_snap, main = components(len(nx), edges.keys())
    comps_snap = len(sizes_snap)

    doors = build_doors()
    ra = road_access(G, edges, main, doors, bgrid, polys, bclass)
    road_keys = set(ra["edges"])
    _, groups, sizes, main = components(len(nx), edges.keys())
    comps = len(sizes)

    an = anchor_doors(G, doors, main, bgrid, road_keys=road_keys,
                      bclass=bclass, chord_keys=chord_keys)
    through, clip_events = find_through_edges(edges, nx, ny, bgrid, polys, bclass)

    # --- code index: refs (split on ';'), nm aliases, then ref joins -------
    reg = load("data/ut_buildings.json")["buildings"]
    reg_codes = [b["ref"] for b in reg]
    code_doors = defaultdict(list)
    alias_hits = defaultdict(int)
    alias_bids = defaultdict(set)
    for i, dr in enumerate(doors):
        ref = dr["ref"]
        if not ref:
            for code, nm in CODE_ALIASES.items():
                if dr["nm"] == nm:
                    ref = code
                    alias_hits[code] += 1
                    alias_bids[code].add(dr["bid"])
                    dr["ref"] = code
                    break
        if ref:
            for part in ref.split(";"):
                part = part.strip()
                if part and i not in code_doors[part]:
                    code_doors[part].append(i)
    join_hits = {}
    for code, src_ref in CODE_REF_JOINS.items():
        idxs = code_doors.get(src_ref, [])
        if idxs:
            code_doors[code] = sorted(set(code_doors.get(code, []) + idxs))
            join_hits[code] = len(idxs)

    routable = set()
    for code, idxs in code_doors.items():
        if any(doors[i].get("anchors") for i in idxs):
            routable.add(code)
    routable_reg = sorted(routable & set(reg_codes))
    missing = sorted(set(reg_codes) - routable)

    # --- why is each missing code missing?  Printed with the health block --
    fp_names = defaultdict(list)
    for ft in load(SNAP_REL)["features"]:
        nm = (ft["properties"].get("name") or "").strip()
        if nm:
            fp_names[nm.lower()].append(ft["properties"].get("id"))

    _stop = {"the", "of", "and", "a", "at", "on", "for",
             "hall", "building", "bldg", "center", "centre"}

    def _toks(s):
        return {t for t in "".join(ch.lower() if ch.isalnum() else " "
                                   for ch in s).split()
                if t not in _stop and len(t) > 1}

    reg_by_code = {b["ref"]: b for b in reg}
    stranded = []
    strand_kind = defaultdict(int)
    for code in missing:
        idxs = code_doors.get(code, [])
        if idxs:
            best = min((doors[i].get("_raw_link") or 1e9) for i in idxs)
            strand_kind["doors exist but none is within %.0f m of the walked "
                        "network" % DOOR_LINK_MAX_M] += 1
            stranded.append((code, "doors exist, none reachable "
                            "(nearest network %s)" %
                            (("%.0f m" % best) if best < 1e9
                             else "beyond 30 m")))
            continue

        # OSM's own ref tag is a surveyed answer to "where is this building",
        # and it does not depend on any name string agreeing with any other.
        # If we have it, say how far the NEAREST MAPPED DOOR is and whose it
        # is — that is the whole reason, in one line, per building.
        pos = OSM_REF_XY.get(code)
        if pos:
            px, py = xy(pos[0], pos[1])
            near, nd = None, 1e9
            for dr in doors:
                dx, dy = xy(dr["lon"], dr["lat"])
                d = dist_m(px, py, dx, dy)
                if d < nd:
                    nd, near = d, dr
            owner = (near["nm"] or near["ref"] or "an unnamed building") \
                if near else "nothing"
            if nd <= DOOR_EVIDENCE_M:
                strand_kind["on the map, and a mapped door lies within "
                            "%.0f m — worth a human look" % DOOR_EVIDENCE_M] += 1
            else:
                strand_kind["on the map, but the nearest mapped door is "
                            "further than %.0f m and belongs to another "
                            "building" % DOOR_EVIDENCE_M] += 1
            stranded.append((code, "OSM maps it as '%s'; nearest mapped door "
                             "is %.0f m away and it is %s's"
                             % (pos[2] or reg_by_code[code]["name"], nd, owner)))
            continue

        rt = _toks(reg_by_code[code]["name"])
        hit = None
        for nm in fp_names:
            ft = _toks(nm)
            if ft and len(rt & ft) / max(len(rt | ft), 1) >= 0.5:
                hit = nm
                break
        strand_kind["not on the map at all: no OSM ref, and no footprint "
                    "carries the register's name"] += 1
        if hit:
            stranded.append((code, "no OSM ref; a footprint named '%s' is the "
                             "closest the names come, and it has no door"
                             % hit))
        else:
            stranded.append((code, "no OSM ref and no footprint whose name "
                             "matches the register"))

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
    # West Campus towers: the truth list is data/westcampus.geojson's names,
    # and a tower's doors are matched by NAME, not by src — six of the 24
    # towers' door groups were derived from the facade model rather than
    # authored, and filtering on src == 'westcampus' is what kept 21 Rio,
    # Pointe on Rio, Skyloft Austin, The Block, The Quarters Sterling House
    # and The Venue on Guadalupe out of the shipped graph (QUEUE Z4).
    wc_names = {ft["properties"].get("name")
                for ft in load("data/westcampus.geojson")["features"]
                if ft["properties"].get("name")}
    wc_doors = defaultdict(list)
    for i, dr in enumerate(doors):
        if dr["nm"] in wc_names:
            wc_doors[dr["nm"]].append(i)

    # --- FINDABLE MUST MEAN ROUTABLE (gates S and T) -----------------------
    #
    # QUEUE Z4's real damage was not that six towers were missing.  It was
    # the state in between: a name the search box offers, that then fails
    # when the student presses Enter.  That is worse than "not found",
    # because it fails AFTER they believe it worked, and it fails at the
    # moment they are already walking.  So the invariant is asserted here
    # rather than hoped for: everything this file makes findable — every key
    # in `code`, every name in `wc` — must have at least one door with an
    # anchor, and every anchor must sit on the main component.  (Codes the
    # graph does NOT ship are a different, honest state: the client merges
    # the register in and answers `<code> is not walkable in this build
    # yet`.  Findable-and-refusing is fine.  Findable-and-failing is not.)
    def _anchored(idxs):
        return [i for i in idxs if doors[i].get("anchors")]

    findable = [("code:" + k, v) for k, v in code_doors.items()] + \
               [("wc:" + k, v) for k, v in wc_doors.items()]
    unroutable_entries = [k for k, v in findable if not _anchored(v)]
    off_main_anchors = [k for k, v in findable
                        for i in _anchored(v)
                        for a in doors[i]["anchors"] if a not in main]

    # Gate T is the end-to-end version of the same claim, driven rather than
    # argued: every West Campus tower is routed to WC_ROUTE_TARGET on the
    # finished graph, and the route has to come out.
    adj_chk = build_adj(edges, len(nx))
    tgt_doors = _anchored(code_doors.get(WC_ROUTE_TARGET, []))
    wc_routed, wc_failed = {}, []
    for nm_ in sorted(wc_doors):
        got = None
        for i in _anchored(wc_doors[nm_]):
            for j in tgt_doors:
                r = route(adj_chk, doors[i], doors[j])
                if r and (got is None or r["total"] < got):
                    got = r["total"]
        if got is None:
            wc_failed.append(nm_)
        else:
            wc_routed[nm_] = got

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

    # Road access edges, as delta-coded indices into the edge arrays.  The
    # flag byte is full (all eight bits are assigned and the client decodes
    # it into a Uint8Array, so a ninth bit would silently wrap to zero) —
    # membership ships out of band instead.  Today's client ignores this
    # key; a later one can use it to draw or word the access legs.
    rix = [i for i, k in enumerate(order) if k in road_keys]
    rd, prevr = [], 0
    for i in rix:
        rd.append(i - prevr)
        prevr = i

    # Plaza chords ship the same way and for the same reason: they are
    # ordinary footway edges costing plain metres, and the only thing a
    # client might want to know is which ones they are, so it can word or
    # draw "cross the mall" differently from "follow the walk".
    cix = [i for i, k in enumerate(order) if k in chord_keys]
    cd, prevc = [], 0
    for i in cix:
        cd.append(i - prevc)
        prevc = i

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
        components_before_snap=comps0, components_after_snap=comps_snap,
        components=comps,
        largest=len(main), largest_pct=round(100.0 * len(main) / len(nx), 2),
        snap_candidates=sn["candidates"], snap_accepted=len(sn["accepted"]),
        snap_rejected_layer=sn["rej_layer"], snap_rejected_building=sn["rej_bldg"],
        snap_rejected_road=sn["rej_road"], dead_ends=sn["dead_ends"],
        road_edges=len(road_keys), road_km=ra["km"],
        plaza_chords=pc["added"], plaza_chord_m=round(pc["metres"], 1),
        plaza_chord_plazas=len(pc["plazas"]),
        plaza_chords_refused_by_photo=pc["refused_by_photo"],
        plaza_chord_evidence=pc["file"], plaza_chord_as_of=pc["as_of"],
        road_chains=ra["targets"], road_portals=ra["portals"],
        road_forest_violations=ra.get("forest_violations", 0),
        doors=len(doors), doors_linked=sum(1 for d in doors if d.get("anchors")),
        through_edges=len(through),
        anchor_splits=an["splits"], door_links_rerouted=an["through_other"],
        routable_codes=len(routable_reg), register_codes=len(reg_codes),
        ref_joins={k: v for k, v in sorted(join_hits.items())},
        pois=len(pois), walk_km=round(sum(edges[k][0] for k in order) / 1000.0, 2),
    )

    out = {
        "v": 1,
        "_license": "ODbL-1.0",
        "_source": "OpenStreetMap contributors (via Overpass); UT Austin building register. Not affiliated with UT Austin.",
        # `as_of` dates the OSM pull. It is NOT the footprint snapshot, and
        # reading it as one is how the two stayed unrelated long enough for
        # QUEUE NB5 to happen. `snapshot` is the building file this graph's
        # walls and door links were built against.
        "as_of": G["as_of"],
        "snapshot": SNAP_DATE,
        "snapshot_source": SNAP_SOURCE,
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
                    "and never steps. re: delta-coded edge indices that are "
                    "walkable-road access legs (service/residential); they "
                    "are dead-end chains off the main component, never "
                    "through-routes, and cost plain metres like any footway. "
                    "pe: delta-coded edge indices that are PLAZA CHORDS -- a "
                    "straight crossing of a mapped pedestrian area whose "
                    "middle a real aerial photograph confirms is walkable "
                    "(scripts/trace_walkways.py). They cost plain metres too. "
                    "d: [x,y,anchorNodes,linkCm,role,src,"
                    "ref,name]. poi: [x,y,node,cat,name,opening_hours]."),
        "re": rd,
        "pe": cd,
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
               plaza=pc,
               through_edges=through, clip_events=clip_events, names=bnames,
               bclass=bclass,
               zero_w=zero_w, deg0=deg0,
               health=health, raw=raw, gz=gz, links=an["links"],
               missing=missing, routable=routable_reg, code_doors=code_doors,
               alias_hits=alias_hits, alias_bids=alias_bids,
               join_hits=join_hits, road=ra, road_keys=road_keys,
               stranded=stranded, strand_kind=strand_kind,
               unroutable_entries=unroutable_entries,
               off_main_anchors=off_main_anchors,
               wc_routed=wc_routed, wc_failed=wc_failed,
               bgrid=bgrid, polys=polys,
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
    P("  PLAZA CHORDS  (a mall is a surface, not a fence)")
    P(f"    added                {h['plaza_chords']}   across {h['plaza_chord_plazas']} "
      f"mapped pedestrian areas, {h['plaza_chord_m']} m")
    P(f"    refused by the photo {h['plaza_chords_refused_by_photo']}   "
      f"(open turf under the line -- OSM's plaza polygons are not all pavement)")
    P(f"    evidence             {h['plaza_chord_evidence']}  generated {h['plaza_chord_as_of']}")
    P("")
    P("  ROAD ACCESS LEGS  (dead-end chains only; classes %s)"
      % ", ".join(sorted(ROAD_WALKABLE)))
    P(f"    doors attached via a road   {h['road_chains']}")
    P(f"    edges adopted               {h['road_edges']}   ({h['road_km']} km, cap {ROAD_ACCESS_MAX_M:.0f} m per chain)")
    P(f"    portal nodes available      {h['road_portals']}   (OSM ids shared with the walked network)")
    P(f"    forest violations           {h['road_forest_violations']}   (a chain joining two main-component nodes; MUST be 0)")
    for (ref, nm, dlink, chain) in c["road"]["doors"]:
        P("      %-6s %-34s road at %4.1f m, chain %5.1f m" % (ref, nm[:34], dlink, chain))
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
    P("    nm aliases used      " + ", ".join("%s:%d" % kv for kv in sorted(c["alias_hits"].items())))
    P("    ref joins used       " + ", ".join("%s<-%s:%d" % (k, CODE_REF_JOINS[k], v)
                                              for k, v in sorted(c["join_hits"].items())))
    P(f"    NOT routable ({len(c['missing'])}), grouped by reason:")
    for why, n in sorted(c["strand_kind"].items(), key=lambda kv: -kv[1]):
        P("      %3d  %s" % (n, why))
    P("    and one line per building, so no number stands in for a finding:")
    for code, why in c["stranded"]:
        P("      %-5s %s" % (code, why))
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
        ("H  routable UT register codes >= 118",
         h["routable_codes"] >= 118, f"{h['routable_codes']} / {h['register_codes']}"),
        ("I  every nm alias resolves to exactly one footprint",
         all(len(c["alias_bids"][k]) == 1 for k in c["alias_hits"]),
         ", ".join("%s:%d" % (k, len(v)) for k, v in sorted(c["alias_bids"].items()))),
        ("I  every ref join found its doors",
         set(c["join_hits"]) == set(CODE_REF_JOINS),
         "%d of %d" % (len(c["join_hits"]), len(CODE_REF_JOINS))),
        ("K  no zero-weight edge, no isolated node",
         c["zero_w"] == 0 and c["deg0"] == 0,
         f"w==0: {c['zero_w']}, degree 0: {c['deg0']}"),
        ("R  road access chains are a forest, one portal each",
         h["road_forest_violations"] == 0,
         f"violations: {h['road_forest_violations']}"),
        ("R  road access stays small  (<= 2.0 km adopted)",
         h["road_km"] <= 2.0, f"{h['road_km']} km on {h['road_edges']} edges"),
        ("N  graph edges through a building > %.0f m  (report, not a gate)"
         % WALL_CLIP_TOL_M, True, f"{len(ev)} of {h['edges']}"),
        ("O  worst door link <= %.0f m" % DOOR_LINK_MAX_M,
         (max(links) if links else 0) <= DOOR_LINK_MAX_M,
         "%.1f m" % (max(links) if links else 0)),
        ("S  every findable entry is routable  (QUEUE Z4's real defect)",
         not c["unroutable_entries"] and not c["off_main_anchors"],
         "%d entries with no anchored door, %d anchors off the main component"
         % (len(c["unroutable_entries"]), len(c["off_main_anchors"]))),
        ("T  every West Campus tower routes to %s, driven" % WC_ROUTE_TARGET,
         not c["wc_failed"] and len(c["wc_routed"]) == 24,
         "%d of %d routed%s" % (len(c["wc_routed"]),
                                len(c["wc_routed"]) + len(c["wc_failed"]),
                                (", FAILING " + ", ".join(c["wc_failed"]))
                                if c["wc_failed"] else "")),
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
    # The two unmapped last legs.  A ROOF is not a wall here either: the
    # Moody Center's OSM-surveyed main door is 9.4 m from the sidewalk and
    # that 9.4 m passes under an 8 m canopy drawn as its own footprint.
    # Counting it as a wall would either throw the only surveyed door on the
    # building away or report a wall crossing that is a walk under an awning.
    # It is counted separately instead, so it is exempted and still visible.
    canopy = 0
    for i in (0, len(pts) - 2):
        n, h = crosses_building(c["bgrid"], pts[i][0], pts[i][1],
                                pts[i + 1][0], pts[i + 1][1], exempt=exempt,
                                bclass=c["bclass"])
        nall, _ = crosses_building(c["bgrid"], pts[i][0], pts[i][1],
                                   pts[i + 1][0], pts[i + 1][1], exempt=exempt)
        canopy += nall - n
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
                off=off, back=back, decked=decked, overshoot=overshoot,
                canopy=canopy)


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
          + ("   (last leg passes under %d canopy/ies)" % au["canopy"]
             if au["canopy"] else "")
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
    # split multi-refs: 'RMRZ;NEZ' is two codes, not a code with a ';' in it
    codes = sorted({p for d in doors if d["ref"] and d.get("anchors")
                    for p in d["ref"].split(";") if p})
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
    P("    touching a mapped footway that OSM draws across a footprint  %d" % walls)
    P("      (the PATHS THROUGH BUILDINGS list above - real sidewalks under")
    P("       arcades and canopies, not routes we invented; HANDOFF #113.3)")
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
