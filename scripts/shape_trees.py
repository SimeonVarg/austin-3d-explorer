#!/usr/bin/env python3
"""
shape_trees.py — take the trees out of the surfaces they cannot stand in, and
give each species its own crown.

FOUR REPORTED DEFECTS, one pass over data/trees.geojson.

1. "Trees clip through buildings and appear on top of them - fix the
   ordering/placement rule, not individual trees." It is not ordering. A tree
   whose centre lands inside a building footprint is INSIDE the building, and no
   layer order fixes a trunk growing out of a roof. The city tree inventory and
   the imagery-detected crowns both place points that fall on buildings — a
   street tree recorded a few metres off, a crown blob that is really a rooftop
   planter — and nothing downstream ever checked. They are dropped here.

1b. "some trees are in roads. this is not a fix trees in roads pass its a more
   general pas" — and "get rid of big trees in the lawn in front of tower".

   Right, and they are one mechanism, not two: a trunk cannot be in a surface
   that has no room for a trunk. The building test above was the only one that
   had ever been written. It is now ONE TABLE — `SURFACES` — covering the
   carriageway, open water, the playing surfaces, and the named open lawns,
   with the ground and road bakes as the source of truth.

   THE TRUNK IS THE TEST, NOT THE CROWN. A live oak whose canopy hangs half way
   over Guadalupe is right and this campus is full of them; the tree is only
   wrong if the point it grows from is in the road. Everything below tests the
   feature's own centre, which is the surveyed or detected tree position, and
   never the crown's extent.

2. "instead of octagonal prisms, if they could like taper off near the top."
   A fill-extrusion cannot taper: it is a prism with one radius. What it CAN do
   is stack.

3. And then, having done (2) with two tiers: "i said taper them and u added like
   one smaller octagon on top make it a big smoother, more like round tree type
   cool things and different types."

   Fair. Two tiers is a cylinder wearing a hat, and every tree on campus was
   wearing the same one. This pass replaces it with a RADIUS PROFILE PER SPECIES,
   sampled to as many tiers as the tree is big enough to earn.

4. And then: "get rid of big trees in the lawn in front of tower." See
   OPEN_LAWNS. Handled by the same table, because it is the same claim: the
   South Mall panels are open grass in life and the canopy belongs on the
   flanking walks.

WHERE THE SPECIES COMES FROM. `data/trees.geojson` already carries `sp` on every
canopy — liveoak 5,986, elm 3,145, crape 2,470, magnolia 1,917, pecan 1,866,
cypress 989, cedar 796, oak 92, palm 2, and 793 "other". It is the City of
Austin's own inventory field and it has been sitting there unused: every one of
those was drawn as the same shape at the same colour.

WHAT A PROFILE IS. A list of (height fraction, radius fraction) control points
read off the silhouette of the real tree, interpolated and sampled to N tiers.
A live oak is broad and low and stays wide most of the way up; a cedar is a cone;
a crape myrtle is a small ball on a stick. Those three silhouettes are different
enough that you can tell them apart from the air, which is the whole ask.

IDEMPOTENCY, WHICH THIS FILE CLAIMED AND DID NOT HAVE. It MERGES every tier of a
crown back into a single crown before regenerating, which is the right idea and
was not enough. Two consecutive no-op runs measured 41,964 -> 41,487 -> 41,158
features with nothing dropped, because the merge inferred the crown's extent
from its widest TIER. Three separate leaks, all fixed here:

  * "the widest ring is the crown's true extent" is false for every species
    whose profile peaks below 1.0. A cedar's widest tier is 0.881 of its source
    ring, so every cedar and cypress on campus lost 12% per run and eventually
    fell under a TIERS_BY_RADIUS threshold. The source radius is carried on the
    features now, as `r0`, and restored exactly.
  * a tier carries TIER_TWIST_DEG * i of rotation and the merge did not undo
    it, so a crown rotated further every run and never reached a fixed point.
  * grouping on a centroid rounded to 1e-6 splits a crown in two when it sits
    near a cell boundary, and each half grew its own head.

Measured after the fix: run 1 drops what it should, runs 2 and 3 settle, and
runs 4-7 are exact no-ops — 39,580 features, 0 dropped, every time. Coordinates
still churn in the 7th decimal (1 cm) because the reconstruction round-trips
through a rounded ring; crown SIZE and tier count are frozen by `r0` and do not.

FEATURE COUNT IS THE COST MODEL. js/lod.js drops `trees-canopy` as one whole
draw pass at altitude, so what matters is how many features exist at street
level, and this file is the largest in the app. TIERS_BY_RADIUS is the knob:
small trees stay cheap, and only the crowns big enough to read get the tiers.

A data transform, not a re-bake: scripts/fetch_city_trees.py needs the network and
the imagery cache, and re-running it would rewrite positions, species and heights.
This touches geometry and nothing else.

    python scripts/shape_trees.py [--dry]

NOTE: trees are TILED. After running this, the PMTiles archive has to be rebuilt
or the app keeps serving the old shapes — `gh workflow run build-tiles.yml --ref
<branch>`, because tippecanoe has no usable Windows build. Verify locally with
`?tiles=0`, which forces the GeoJSON fallback.
"""
import hashlib
import json
import math
import os
import sys
from collections import Counter, defaultdict

from shapely.geometry import LineString, Point, shape
from shapely.strtree import STRtree

# CORE_BBOX is defined once, in the file that fetches against it. Duplicating
# the numbers here is how the two halves of the tree pipeline would end up
# disagreeing about where the campus ends.
from fetch_city_trees import CORE_BBOX, in_box

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
DRY = "--dry" in sys.argv

# ── Taste block: WHERE A TRUNK CANNOT BE ──────────────────────────────
#
# One table, read against data/ground.geojson and data/roads.geojson. Each row
# is a ground class and a verdict:
#
#   drop     is a trunk standing here physically impossible?
#   inset_m  shrink the surface by this much before testing, so a trunk sitting
#            on the kerb line survives a centreline that is a metre out.
#
# THE `False` ROWS ARE THE INTERESTING HALF, and they are why this is a table
# and not a list of classes to delete. The city inventory's 869 trunks in this
# bbox are SURVEYED positions — factual, per fetch_city_trees.py — so what
# fraction of them land inside each surface is a direct measure of how much
# authority that surface's polygon has:
#
#     inside a road carriageway     18 / 869   2.1%    <- the error floor
#     inside a `footway` polygon   246 / 869  28.3%
#
# A quarter of Austin's surveyed street trees are not standing in the middle of
# the sidewalk. A `footway` polygon is a 2 m ribbon widened from a centreline by
# bake_ground.py, and it has less positional authority than the survey does —
# and a tree well cut into a sidewalk is a real thing, as is a planting island
# in a parking lot and a specimen tree in a plaza. Dropping footway + plaza +
# parking would delete 1,103 trees to fix an artefact that is not there, and
# would strip the Drag of the street trees that make it read as a street.
#
# So the drops are the surfaces where a tree well is impossible by definition:
# something drives, floats or is played on every square metre of them.
SURFACES = {
    # (k, u) in ground.geojson         drop   inset_m
    ("area", "water"):                (True,  0.0),
    ("area", "fountain"):             (True,  0.0),
    ("area", "pitch"):                (True,  0.0),
    ("area", "endzone"):              (True,  0.0),
    ("area", "track"):                (True,  0.0),
    ("patharea", "footway"):          (False, 0.0),
    ("patharea", "path"):             (False, 0.0),
    ("patharea", "steps"):            (False, 0.0),
    ("patharea", "pedestrian"):       (False, 0.0),
    ("area", "plaza"):                (False, 0.0),
    ("area", "parking"):              (False, 0.0),
    ("area", "playground"):           (False, 0.0),
    ("area", "construction"):         (False, 0.0),
    ("area", "garden"):               (False, 0.0),
    ("area", "lawn"):                 (False, 0.0),   # see OPEN_LAWNS
    ("area", "park"):                 (False, 0.0),
    ("area", "wood"):                 (False, 0.0),
    ("area", "scrub"):                (False, 0.0),
    ("area", "sand"):                 (False, 0.0),
}

# Roads and cycleways are LineStrings with a pavement width `w`, so they get
# their own row. bake_ground.py builds `w` as `lanes * 3.4 + 1.6`, where the
# 1.6 m is the kerb allowance for BOTH sides — so insetting by half of it puts
# the test on the travelled way, where a car actually is, and lets a kerbside
# tree well through.
ROAD_KINDS = ("road", "cycle")
ROAD_DROP = True
ROAD_INSET_M = 0.8

# A trunk inside a building footprint is inside the building. No inset: the
# footprint is the wall.
BUILDING_DROP = True

# ── The open lawns (the Tower ask) ────────────────────────────────────
#
# A lawn is not a surface a tree cannot be in — most of campus is trees on
# grass, and 599 trees stand in a mapped lawn. These specific panels are the
# exception: the South Mall and the Main Mall in front of the Main Building are
# open grass in life, with the live oaks lining the flanking walks. Each entry
# is a SEED POINT; the lawn polygon containing it is the one that gets cleared,
# so the rule survives a ground re-bake that changes the polygon. A seed that
# matches nothing is reported loudly rather than passing silently.
OPEN_LAWNS = [
    (-97.73955, 30.28453, "South Mall panel, fountain to the Main Building"),
    (-97.73909, 30.28532, "Main Mall, east of the Main Building"),
    (-97.73986, 30.28538, "Main Mall, west of the Main Building"),
]

# ── Taste block: crown shape ──────────────────────────────────────────
#
# CROWN PROFILES, as (height fraction from the crown's base, radius fraction of
# the source ring). Read off photographs of each species on this campus and
# reduced to five control points, which is as much shape as a stack of octagons
# can carry.
#
# The radius fractions run over 1.0 on the spreading species on purpose: the
# detected ring is the crown's widest measured extent, and a live oak's widest
# point is well above its lowest branches, so holding the base narrower and
# bulging past 1.0 in the middle is what makes it read as a canopy rather than
# as a drum.
PROFILES = {
    # Broad, low, spreading — the campus default and the tree the South Mall is
    # made of. Stays wide to two-thirds height, then falls away fast.
    "liveoak":  [(0.00, 0.82), (0.25, 1.00), (0.50, 1.02), (0.78, 0.80), (1.00, 0.34)],
    "oak":      [(0.00, 0.82), (0.25, 1.00), (0.50, 1.02), (0.78, 0.80), (1.00, 0.34)],
    # Taller, narrower, vase-shaped: a high crown carried on a clear trunk, so
    # it starts narrow and opens out above.
    "elm":      [(0.00, 0.58), (0.28, 0.92), (0.58, 1.00), (0.82, 0.78), (1.00, 0.30)],
    "pecan":    [(0.00, 0.52), (0.30, 0.88), (0.60, 1.00), (0.84, 0.74), (1.00, 0.26)],
    # Conifers: a cone. Widest at the bottom, straight to a point.
    "cedar":    [(0.00, 1.00), (0.28, 0.80), (0.55, 0.58), (0.80, 0.34), (1.00, 0.12)],
    "cypress":  [(0.00, 1.00), (0.30, 0.84), (0.58, 0.62), (0.82, 0.38), (1.00, 0.14)],
    # Small ornamentals: a ball. Crape myrtle and magnolia both read as a round
    # mass low to the ground.
    "crape":    [(0.00, 0.72), (0.25, 0.98), (0.50, 1.00), (0.75, 0.88), (1.00, 0.42)],
    "magnolia": [(0.00, 0.80), (0.25, 0.98), (0.52, 1.00), (0.78, 0.86), (1.00, 0.40)],
    # A palm is a tuft on a pole: nearly nothing until the very top.
    "palm":     [(0.00, 0.30), (0.45, 0.36), (0.72, 0.90), (0.88, 1.00), (1.00, 0.55)],
    # Everything unlabelled. A generic rounded crown — deliberately between the
    # oak and the ornamental so an unknown tree never stands out as a shape.
    "other":    [(0.00, 0.78), (0.27, 0.98), (0.55, 1.00), (0.80, 0.82), (1.00, 0.36)],
}
DEFAULT_PROFILE = "other"

# HOW MANY TIERS A CROWN EARNS, by its radius in metres. This is the cost knob.
# A 3 m sapling is a dozen pixels from a flying camera and a second tier on it
# buys nothing; a 12 m live oak over the South Mall is the thing you are looking
# at. Thresholds are the measured quartiles of this dataset (p25 3.72, p50 4.95,
# p75 6.81, p90 8.98, max 14.46).
TIERS_BY_RADIUS = [(3.9, 1), (6.8, 3), (9.0, 4), (float("inf"), 5)]

# Outside CORE_BBOX (see fetch_city_trees.py) a tree is backdrop. The tiers are
# a silhouette you read from thirty metres; from the far side of downtown they
# are three extra features per tree buying sub-pixel differences. Capped, and
# capped as a NUMBER so it is one edit to spend more on them.
OUTER_MAX_TIERS = 2

# ── Taste block: the value gradient down a crown ──────────────────────
#
# Reported as *"every tier is the same flat colour, so from above a crown reads
# as a wedding cake rather than as foliage."* True, and the shape work in PR #59
# is what exposed it: `trees-canopy` is painted
# `interpolate ['get','h'] 6 -> #93ad70, 15 -> #5f7d4a`, i.e. purely off the
# tier's own top height, which does three unhelpful things at once — 34% of all
# tiers sit outside the 6..15 m window and clamp to one flat endpoint (measured:
# 8,489 below, 2,464 above, of 32,651), the stops are a SIZE ramp so two tiers of
# one crown differ by a fraction of it, and the direction is inverted: higher
# tier top = closer to the DARK end, so the lit top of the canopy is drawn
# darker than the shaded underside.
#
# `tf` is the fix's data half: the tier's own centre as a fraction of the crown,
# 0 at the base and 1 at the top, so a paint expression can ramp a value
# gradient over it regardless of whether the crown has 1 tier or 5.
# `j` is a per-TREE hue jitter bucket in 0..1, constant down a crown, so 39,580
# trees can stop being one green.
#
# NEITHER IS READ YET. The paint lives in js/app.js:1075 and js/timeofday.js:409
# and both are outside this pass's remit; baked here so that change is a one
# liner. Cost of carrying them is in the PR.
TIER_FRACTION_DP = 2      # tf rounding; ~13 distinct values, dictionary-cheap
HUE_JITTER_STEPS = 8      # j buckets; 0, 1/7 ... 1

# Each tier is rotated a little against the one below it. Two octagons stacked
# in phase read as one octagonal prism with a step in it; out of phase, the
# silhouette gains corners and reads round. Free — the ring already exists.
TIER_TWIST_DEG = 14.0

MIN_SPLIT_H = 0.9     # do not tier a crown shorter than this, in metres


def rings(g):
    t = g.get("type")
    if t == "Polygon":
        return g["coordinates"]
    if t == "MultiPolygon":
        return [r for poly in g["coordinates"] for r in poly]
    return []


def centroid(ring):
    n = len(ring)
    return (sum(p[0] for p in ring) / n, sum(p[1] for p in ring) / n)


# ── The forbidden-surface index ───────────────────────────────────────
#
# Everything below works in METRES on a local equirectangular projection about
# the campus, the same one bake_ground.py uses. A buffer or an inset in degrees
# is 14% narrower east-west than north-south at this latitude, which is exactly
# the size of the margins being argued over.
LON0, LAT0 = -97.74, 30.285
M_LAT = 111320.0
M_LON = 111320.0 * math.cos(math.radians(LAT0))


def to_m(lon, lat):
    return ((lon - LON0) * M_LON, (lat - LAT0) * M_LAT)


def poly_m(geom):
    """A shapely geometry from GeoJSON, reprojected to metres. Keeps holes:
    a building with a courtyard is not solid, and a footway loop round a block
    encloses the block rather than covering it."""
    g = shape(geom)
    if g.is_empty:
        return None
    from shapely.ops import transform
    return transform(lambda x, y, z=None: to_m(x, y), g)


class Surfaces(object):
    """Named groups of metric polygons, each answering `hit(lon, lat)`."""

    def __init__(self):
        self.groups = []          # (label, drop, [polys], STRtree)

    def add(self, label, drop, polys, inset_m=0.0):
        polys = [p for p in polys if p is not None and not p.is_empty]
        if inset_m:
            polys = [q for q in (p.buffer(-inset_m) for p in polys)
                     if not q.is_empty]
        if not polys:
            return
        self.groups.append((label, drop, polys, STRtree(polys)))

    def hits(self, lon, lat):
        """Every label whose surface contains this point, drops first."""
        p = Point(*to_m(lon, lat))
        out = []
        for label, drop, polys, tree in self.groups:
            for i in tree.query(p):
                if polys[i].contains(p):
                    out.append((label, drop))
                    break
        return out


def build_surfaces(buildings):
    """Read ground.geojson + roads.geojson + the snapshot and index every class
    named in SURFACES, dropped or not. The kept classes are indexed on purpose:
    the per-class report is the only way to see what a verdict flip would cost.
    """
    S = Surfaces()
    if BUILDING_DROP:
        S.add("building", True, [poly_m(f["geometry"]) for f in buildings])
        # The snapshot's detailed footprints stop at the campus box, and the
        # trees no longer do. Outside it the only footprints that exist are the
        # outer ring's — without them a surveyed street tree in East Austin that
        # lands on a house is kept, and the rule "a trunk is not inside a
        # building" would quietly hold on campus only.
        outer = os.path.join(DATA, "outer_ring.geojson")
        if os.path.exists(outer):
            of = json.load(open(outer, encoding="utf-8"))["features"]
            S.add("outer building", True, [poly_m(f["geometry"]) for f in of])

    ground = json.load(open(os.path.join(DATA, "ground.geojson"),
                            encoding="utf-8"))["features"]
    by_class = defaultdict(list)
    open_lawn = []
    seeds = [(Point(*to_m(lo, la)), name) for lo, la, name in OPEN_LAWNS]
    found = [False] * len(seeds)
    for f in ground:
        p = f["properties"]
        key = (p.get("k"), p.get("u"))
        if key not in SURFACES:
            continue
        g = poly_m(f["geometry"])
        if g is None:
            continue
        if key == ("area", "lawn"):
            for i, (pt, _name) in enumerate(seeds):
                if g.contains(pt):
                    found[i] = True
                    open_lawn.append(g)
                    break
            else:
                by_class[key].append(g)
            continue
        by_class[key].append(g)
    for i, ok in enumerate(found):
        if not ok:
            print("  !! OPEN_LAWNS seed %d (%s) is in no lawn polygon — the "
                  "ground bake moved it" % (i, seeds[i][1]))
    S.add("open lawn", True, open_lawn)
    for key, polys in sorted(by_class.items(), key=lambda kv: str(kv[0])):
        drop, inset = SURFACES[key]
        S.add("%s/%s" % key, drop, polys, inset)

    roads = json.load(open(os.path.join(DATA, "roads.geojson"),
                           encoding="utf-8"))["features"]
    lanes = []
    for f in roads:
        p = f["properties"]
        w = p.get("w")
        if p.get("k") not in ROAD_KINDS or not w or \
                f["geometry"]["type"] != "LineString":
            continue
        half = w / 2.0 - ROAD_INSET_M
        if half <= 0:
            continue
        cs = [to_m(x, y) for x, y in f["geometry"]["coordinates"]]
        if len(cs) < 2:
            continue
        lanes.append(LineString(cs).buffer(half, cap_style=2, join_style=2))
    S.add("road carriageway", ROAD_DROP, lanes)
    return S


def shaped(ring, k, twist_deg=0.0, lat=30.285, dp=7):
    """Scale a ring about its own centroid, optionally twisting it.

    The twist has to happen in METRES, not degrees, or a rotation at this
    latitude squashes the ring by cos(lat) — 13% at Austin, which is visible as
    an oval crown.

    `dp` IS THE FIXED POINT, and it is why this pass is now byte-stable rather
    than only count-stable. Reconstructing a crown from a tier is lossy: the
    tier was rounded, so scaling it back out lands ~1e-7 from where it started,
    and the next run's tier lands 1e-7 from THAT. Measured before this argument
    existed: seven consecutive runs held 57,543 features but wrote seven
    different files, and on one of them a crown drifted across an inset kerb
    line and a tree was deleted for nothing. The merge reconstructs at dp=6,
    which is the grid fetch_city_trees.octagon() already emits on — so the
    reconstruction snaps back onto the source grid and run N+1 reproduces run N
    exactly. 1e-6 is 11 cm; a crown is metres across.
    """
    cx, cy = centroid(ring)
    kx = math.cos(math.radians(lat))
    a = math.radians(twist_deg)
    ca, sa = math.cos(a), math.sin(a)
    out = []
    for px, py in ring:
        # to local metres-ish, scale + rotate, back again
        x = (px - cx) * kx
        y = (py - cy)
        x, y = x * k, y * k
        x, y = x * ca - y * sa, x * sa + y * ca
        # ROUND, and this is not cosmetic. The source rings carry 7 decimal
        # places; leaving the scaled ones at float64 took trees.geojson from
        # 9.58 MB to 19.59 MB on a feature count that only rose 66%. Seven
        # places is 11 mm at this latitude, which is four orders of magnitude
        # finer than anything this scene can draw.
        out.append([round(cx + x / kx, dp), round(cy + y, dp)])
    return out


def radius_m(ring, lat):
    cx, cy = centroid(ring)
    kx = 111320 * math.cos(math.radians(lat))
    return max(math.hypot((p[0] - cx) * kx, (p[1] - cy) * 111320) for p in ring)


def profile_at(prof, t):
    """Radius fraction at height fraction t, linearly between control points."""
    if t <= prof[0][0]:
        return prof[0][1]
    for (t0, r0), (t1, r1) in zip(prof, prof[1:]):
        if t <= t1:
            f = (t - t0) / (t1 - t0) if t1 > t0 else 0.0
            return r0 + (r1 - r0) * f
    return prof[-1][1]


def tiers_for(r, outer=False):
    n = TIERS_BY_RADIUS[-1][1]
    for lim, k in TIERS_BY_RADIUS:
        if r < lim:
            n = k
            break
    return min(n, OUTER_MAX_TIERS) if outer else n


def jitter(lon, lat):
    """A per-tree bucket in 0..1, stable across runs.

    Keyed on the centroid rounded to 5 dp (~1 m), never on the raw one: every
    tier is rebuilt through a 7-dp round trip and the centroid drifts by
    millimetres, which is enough to flip a hash and repaint a tree on every
    re-run for no reason.
    """
    k = "%.5f:%.5f" % (lon, lat)
    u = int.from_bytes(hashlib.md5(k.encode()).digest()[:4], "big") / 0xFFFFFFFF
    return round(min(HUE_JITTER_STEPS - 1, int(u * HUE_JITTER_STEPS))
                 / (HUE_JITTER_STEPS - 1.0), 3)


def main():
    snap = os.path.join(DATA, "snapshots")
    latest = sorted(d for d in os.listdir(snap) if os.path.isdir(os.path.join(snap, d)))[-1]
    B = json.load(open(os.path.join(snap, latest, "buildings.detailed.geojson"),
                       encoding="utf-8"))["features"]

    path = os.path.join(DATA, "trees.geojson")
    gj = json.load(open(path, encoding="utf-8"))
    feats = gj["features"]
    print("trees.geojson: %d features" % len(feats))

    # 1. Drop anything whose TRUNK stands in a surface that cannot hold one.
    #    Verdicts are cached per position, because a five-tier crown asks the
    #    same question five times.
    S = build_surfaces(B)
    verdict = {}
    keep, dropped = [], 0
    # The report counts TREES, not features: a crown is up to five stacked
    # canopy features plus a trunk, and charging a surface six times for one
    # tree is how a count of 1,320 gets reported for 782 trees. One canopy
    # feature per position at the same 6 dp the merge below groups on.
    per_class = defaultdict(set)
    charged = {}
    for f in feats:
        rs = rings(f["geometry"])
        if not rs:
            keep.append(f)
            continue
        c = centroid(rs[0])
        key = (round(c[0], 7), round(c[1], 7))
        if key not in verdict:
            verdict[key] = S.hits(c[0], c[1])
        hits = verdict[key]
        if f["properties"].get("kind") == "canopy":
            tree = (round(c[0], 6), round(c[1], 6))
            for label, _drop in hits:
                per_class[label].add(tree)
            for label, drop in hits:
                if drop:
                    charged.setdefault(tree, label)
                    break
        if any(drop for _label, drop in hits):
            dropped += 1
            continue
        keep.append(f)
    dropped_by = Counter(charged.values())

    print("  --- trees standing in each ground surface ---")
    for label, drop, _polys, _t in S.groups:
        n = len(per_class[label])
        # Every DROPPED class prints even at zero. A class that quietly stops
        # matching — a renamed `u`, a ground re-bake — reads as "fixed" if the
        # row just vanishes, and that is the failure this whole file exists to
        # stop happening to trees.
        if n or drop:
            print("      %-22s %5d  %s" % (label, n, "DROPPED" if drop else "kept"))
    print("  dropped %d trees (%s) = %d features"
          % (sum(dropped_by.values()),
             ", ".join("%s %d" % kv for kv in dropped_by.most_common()), dropped))

    # 2. MERGE existing tiers back into one crown each. Without this the pass is
    #    not idempotent: the previous version's two-tier crowns would each be
    #    re-tiered independently and the tree would grow a second head.
    others = [f for f in keep if f["properties"].get("kind") != "canopy"]
    canopies = [f for f in keep if f["properties"].get("kind") == "canopy"]
    if not canopies:
        print("  no canopies found - nothing to shape")
        return
    lat0 = centroid(rings(canopies[0]["geometry"])[0])[1]

    # GROUPING HAS TO TOLERATE A ROUNDED CENTROID. `shaped()` rounds every
    # vertex to 7 dp, so a tier's mean lands a few millimetres off its parent's
    # — and a crown whose centroid sits near a 1e-6 boundary splits into two
    # groups, each re-tiered as its own tree. That is the second half of the
    # non-idempotency: crowns went 11,255 -> 11,280 -> 11,354 over three runs
    # with nothing dropped, growing a duplicate head each time. So the key is
    # claimed over its 3x3 neighbourhood of 1e-6 cells: +-0.11 m, which is far
    # under the smallest gap between two real trees and far over the drift.
    anchors = {}
    groups = defaultdict(list)
    for f in canopies:
        c = centroid(rings(f["geometry"])[0])
        sp = f["properties"].get("sp")
        ix, iy = int(round(c[0] * 1e6)), int(round(c[1] * 1e6))
        key = anchors.get((ix, iy, sp))
        if key is None:
            key = (ix, iy, sp)
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    anchors.setdefault((ix + dx, iy + dy, sp), key)
        groups[key].append(f)
    merged = []
    recovered = 0
    shrink = []
    for key, group in groups.items():
        base = min(float(f["properties"].get("base") or 0) for f in group)
        top = max(float(f["properties"].get("h") or 0) for f in group)
        # Tiers are emitted bottom-up and tier i carries TIER_TWIST_DEG * i of
        # rotation, so the twist is recoverable from where the tier sits in the
        # stack. It HAS to be undone here or the crown rotates a little further
        # every run, never reaches a fixed point, and its centroid keeps
        # wandering by a few millimetres — which is enough to walk one tree per
        # run across a kerb line and delete it.
        order = sorted(group, key=lambda f: float(f["properties"].get("base") or 0))
        widest = max(group, key=lambda f: radius_m(rings(f["geometry"])[0], lat0))
        untwist = -TIER_TWIST_DEG * order.index(widest)
        f = json.loads(json.dumps(widest))
        p = f["properties"]
        ring = rings(f["geometry"])[0]
        r_wide = radius_m(ring, lat0)

        # THE SOURCE RADIUS HAS TO BE CARRIED, NOT INFERRED, and this is the
        # bug that made the file quietly non-idempotent for as long as it has
        # existed. "The widest ring is the crown's true extent" is false for
        # every species whose profile peaks below 1.0 — a cedar's widest TIER
        # is 0.881 of its source ring, so each re-run shrank every cedar and
        # cypress on campus by 12%, dropped some of them under a
        # TIERS_BY_RADIUS threshold, and emitted fewer features. Measured: two
        # consecutive no-op runs went 41,964 -> 41,487 -> 41,158 features with
        # nothing dropped. `r0` is the source radius in metres, stamped on
        # every tier, so the merge restores the ring EXACTLY.
        r0 = float(p.get("r0") or 0)
        if not r0:
            # No stamp yet: undo the last run's shrink by dividing out the
            # widest profile sample this crown's own tier count would have
            # used. Exact for one run; earlier runs' shrink is not recoverable.
            n_grp = len(group)
            if n_grp > 1:
                prof = PROFILES.get(p.get("sp") or DEFAULT_PROFILE,
                                    PROFILES[DEFAULT_PROFILE])
                kmax = max(profile_at(prof, (i + 0.5) / n_grp)
                           for i in range(n_grp))
            else:
                kmax = 1.0
            r0 = r_wide / kmax
            recovered += 1
            if abs(kmax - 1.0) > 0.02:
                shrink.append(kmax)
        if r_wide > 0 and (abs(r0 / r_wide - 1.0) > 1e-6 or untwist):
            f["geometry"]["coordinates"] = [
                shaped(ring, r0 / r_wide, untwist, lat0, dp=6)]
        else:
            # Untouched crowns have to sit on the same grid as reconstructed
            # ones or a single-tier crown that later earns a second tier starts
            # the drift all over again.
            f["geometry"]["coordinates"] = [
                [[round(x, 6), round(y, 6)] for x, y in ring]]
        p["base"] = round(base, 2)
        p["h"] = round(top, 2)
        p["r0"] = round(r0, 2)
        merged.append(f)
    print("  %d canopy features merged back to %d crowns" % (len(canopies), len(merged)))
    if recovered:
        print("  %d crowns had no r0 and were rescaled from their tier count"
              " (%d of them by more than 2%%)" % (recovered, len(shrink)))

    # 3. Re-tier each crown against its species profile.
    out = list(others)
    made = Counter()
    span_skipped = 0
    outer_capped = 0
    for f in merged:
        p = f["properties"]
        ring = rings(f["geometry"])[0]
        c = centroid(ring)
        base = float(p.get("base") or 0)
        top = float(p.get("h") or 0)
        span = top - base
        p["j"] = jitter(c[0], c[1])
        # Tier off the carried source radius, not off a re-measurement of a
        # ring whose coordinates were rounded to 7 dp: the measurement wobbles
        # by ~11 mm and crowns sitting on a TIERS_BY_RADIUS threshold flip
        # between runs because of it.
        r_src = float(p.get("r0") or radius_m(ring, lat0))
        outside = not in_box(c[0], c[1], CORE_BBOX)
        n = tiers_for(r_src, outside)
        if outside and n < tiers_for(r_src):
            outer_capped += 1
        if span < MIN_SPLIT_H or n <= 1:
            if span < MIN_SPLIT_H and n > 1:
                span_skipped += 1
            p["tf"] = 0.5
            out.append(f)
            made[1] += 1
            continue
        prof = PROFILES.get(p.get("sp") or DEFAULT_PROFILE, PROFILES[DEFAULT_PROFILE])
        for i in range(n):
            t0, t1 = i / n, (i + 1) / n
            # Sample the profile at the MIDDLE of the tier: sampling at its base
            # makes every crown one tier too wide, and at its top, one too thin.
            mid = (t0 + t1) / 2
            k = profile_at(prof, mid)
            tier = json.loads(json.dumps(f))
            tier["properties"]["base"] = round(base + span * t0, 2)
            tier["properties"]["h"] = round(base + span * t1, 2)
            # Where this tier sits in its own crown, 0 at the base and 1 at the
            # top. The ONLY handle a paint expression has on "which tier is
            # this" — `h` cannot serve, it is the geometry.
            tier["properties"]["tf"] = round(mid, TIER_FRACTION_DP)
            tier["geometry"]["coordinates"] = [
                shaped(ring, k, TIER_TWIST_DEG * i, lat0)]
            out.append(tier)
        made[n] += 1

    print("  crowns by tier count: %s" % dict(sorted(made.items())))
    inside = sum(1 for f in merged
                 if in_box(*centroid(rings(f["geometry"])[0]), box=CORE_BBOX))
    print("  crowns: %d inside the core box, %d backdrop (%d tier-capped at %d)"
          % (inside, len(merged) - inside, outer_capped, OUTER_MAX_TIERS))
    if span_skipped:
        print("  %d crowns too short to tier (< %.1f m of crown)" % (span_skipped, MIN_SPLIT_H))
    sp = Counter(f["properties"].get("sp") for f in merged)
    print("  species: %s" % dict(sp.most_common()))
    print("  features: %d -> %d" % (len(feats), len(out)))
    if not DRY:
        gj["features"] = out
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(gj, fh, separators=(",", ":"))
        print("  written  (%.2f MB)" % (os.path.getsize(path) / 1e6))
        print("  REMEMBER: trees are tiled. Rebuild the archive or the app keeps")
        print("  serving the old shapes:  gh workflow run build-tiles.yml --ref <branch>")


main()
