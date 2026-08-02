#!/usr/bin/env python3
"""
shape_trees.py — take the trees out of the buildings, and give each species its
own crown.

THREE REPORTED DEFECTS, one pass over data/trees.geojson.

1. "Trees clip through buildings and appear on top of them - fix the
   ordering/placement rule, not individual trees." It is not ordering. A tree
   whose centre lands inside a building footprint is INSIDE the building, and no
   layer order fixes a trunk growing out of a roof. The city tree inventory and
   the imagery-detected crowns both place points that fall on buildings — a
   street tree recorded a few metres off, a crown blob that is really a rooftop
   planter — and nothing downstream ever checked. They are dropped here.

2. "instead of octagonal prisms, if they could like taper off near the top."
   A fill-extrusion cannot taper: it is a prism with one radius. What it CAN do
   is stack.

3. And then, having done (2) with two tiers: "i said taper them and u added like
   one smaller octagon on top make it a big smoother, more like round tree type
   cool things and different types."

   Fair. Two tiers is a cylinder wearing a hat, and every tree on campus was
   wearing the same one. This pass replaces it with a RADIUS PROFILE PER SPECIES,
   sampled to as many tiers as the tree is big enough to earn.

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

WHY IT IS IDEMPOTENT NOW, and it was not before. The old version split crowns in
place and wrote the file back, so running it twice split the split ones again.
This one MERGES every tier of a crown back into a single crown first (same
centroid, same species: take the outermost ring and the full base..h span) and
regenerates from there. Run it as often as you like.

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
import json
import math
import os
import sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
DRY = "--dry" in sys.argv

# ── Taste block ───────────────────────────────────────────────────────
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


def inside(pt, ring):
    x, y = pt
    c = False
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i][:2]
        x2, y2 = ring[(i + 1) % n][:2]
        if ((y1 > y) != (y2 > y)) and (x < (x2 - x1) * (y - y1) / ((y2 - y1) or 1e-12) + x1):
            c = not c
    return c


def shaped(ring, k, twist_deg=0.0, lat=30.285):
    """Scale a ring about its own centroid, optionally twisting it.

    The twist has to happen in METRES, not degrees, or a rotation at this
    latitude squashes the ring by cos(lat) — 13% at Austin, which is visible as
    an oval crown.
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
        out.append([round(cx + x / kx, 7), round(cy + y, 7)])
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


def tiers_for(r):
    for lim, n in TIERS_BY_RADIUS:
        if r < lim:
            return n
    return TIERS_BY_RADIUS[-1][1]


def main():
    snap = os.path.join(DATA, "snapshots")
    latest = sorted(d for d in os.listdir(snap) if os.path.isdir(os.path.join(snap, d)))[-1]
    B = json.load(open(os.path.join(snap, latest, "buildings.detailed.geojson"),
                       encoding="utf-8"))["features"]

    # Grid the footprints so this is not 19,440 x 2,453 point-in-polygon tests.
    grid = {}
    for f in B:
        for r in rings(f["geometry"]):
            los = [p[0] for p in r]
            las = [p[1] for p in r]
            for cx in range(int(min(los) * 2000), int(max(los) * 2000) + 1):
                for cy in range(int(min(las) * 2000), int(max(las) * 2000) + 1):
                    grid.setdefault((cx, cy), []).append(r)

    def in_building(pt):
        for r in grid.get((int(pt[0] * 2000), int(pt[1] * 2000)), []):
            if inside(pt, r):
                return True
        return False

    path = os.path.join(DATA, "trees.geojson")
    gj = json.load(open(path, encoding="utf-8"))
    feats = gj["features"]
    print("trees.geojson: %d features" % len(feats))

    # 1. Drop anything standing inside a building.
    keep, dropped = [], 0
    for f in feats:
        rs = rings(f["geometry"])
        if rs and in_building(centroid(rs[0])):
            dropped += 1
            continue
        keep.append(f)
    print("  dropped inside a building footprint: %d" % dropped)

    # 2. MERGE existing tiers back into one crown each. Without this the pass is
    #    not idempotent: the previous version's two-tier crowns would each be
    #    re-tiered independently and the tree would grow a second head.
    others = [f for f in keep if f["properties"].get("kind") != "canopy"]
    canopies = [f for f in keep if f["properties"].get("kind") == "canopy"]
    if not canopies:
        print("  no canopies found - nothing to shape")
        return
    lat0 = centroid(rings(canopies[0]["geometry"])[0])[1]

    groups = defaultdict(list)
    for f in canopies:
        c = centroid(rings(f["geometry"])[0])
        groups[(round(c[0], 6), round(c[1], 6), f["properties"].get("sp"))].append(f)
    merged = []
    for key, group in groups.items():
        # The widest ring is the crown's true extent; the others are its tiers.
        base = min(float(f["properties"].get("base") or 0) for f in group)
        top = max(float(f["properties"].get("h") or 0) for f in group)
        widest = max(group, key=lambda f: radius_m(rings(f["geometry"])[0], lat0))
        f = json.loads(json.dumps(widest))
        f["properties"]["base"] = round(base, 2)
        f["properties"]["h"] = round(top, 2)
        merged.append(f)
    print("  %d canopy features merged back to %d crowns" % (len(canopies), len(merged)))

    # 3. Re-tier each crown against its species profile.
    out = list(others)
    made = Counter()
    span_skipped = 0
    for f in merged:
        p = f["properties"]
        ring = rings(f["geometry"])[0]
        base = float(p.get("base") or 0)
        top = float(p.get("h") or 0)
        span = top - base
        r = radius_m(ring, lat0)
        n = tiers_for(r)
        if span < MIN_SPLIT_H or n <= 1:
            if span < MIN_SPLIT_H and n > 1:
                span_skipped += 1
            out.append(f)
            made[1] += 1
            continue
        prof = PROFILES.get(p.get("sp") or DEFAULT_PROFILE, PROFILES[DEFAULT_PROFILE])
        for i in range(n):
            t0, t1 = i / n, (i + 1) / n
            # Sample the profile at the MIDDLE of the tier: sampling at its base
            # makes every crown one tier too wide, and at its top, one too thin.
            k = profile_at(prof, (t0 + t1) / 2)
            tier = json.loads(json.dumps(f))
            tier["properties"]["base"] = round(base + span * t0, 2)
            tier["properties"]["h"] = round(base + span * t1, 2)
            tier["geometry"]["coordinates"] = [
                shaped(ring, k, TIER_TWIST_DEG * i, lat0)]
            out.append(tier)
        made[n] += 1

    print("  crowns by tier count: %s" % dict(sorted(made.items())))
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
