# -*- coding: utf-8 -*-
"""Ground that is not flat: steps, terraces and basins.

"fountain in front of tower has stairs on both sides is that possible depth
throughout or did we already rule that out"

IT IS POSSIBLE AND IT WAS NEVER RULED OUT. A fill-extrusion takes a `base` and a
`height`, so a flight of steps is N thin extrusions at rising bases -- the same
trick bake_roofs.py uses to imply a hip and shape_trees.py uses to taper a crown.
Nothing new is needed. What was missing is that nothing in this project had ever
asked the GROUND to have a profile.

WHY EVERYTHING HERE GOES UP AND NOTHING GOES DOWN, which is the one real
constraint and is worth writing down before someone tries.

  1. Every building in this scene starts at z=0. There is no terrain. Raising a
     whole mall would leave the halls along it standing in a trench.
  2. A `fill` does not depth-test against a `fill-extrusion` in MapLibre -- that
     is the same fact behind DKR's field showing through its north wall. So a
     basin sunk below z=0 is painted straight over by the flat ground fill above
     it. Sinking ground needs a HOLE punched in the ground polygon first, which
     is a change to bake_ground.py and a separate job.

So the vocabulary here builds UP from the datum, and the eye reads a profile the
same either way: a fountain ringed by three descending courses reads as sunken
whichever direction the geometry actually went.

THE GENERATOR IS THE POINT, not the fountain. `terrace()` takes any ring and a
list of (offset in metres, height) and emits the concentric courses; the next
terrace costs one call. Waller Creek's banks (QUEUE B6) are the same function
with the offsets running inward and the heights falling, once the ground has a
hole to show them through.

Usage:  python scripts/bake_depth.py
"""
import json
import math
import os
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GROUND = os.path.join(ROOT, "data", "ground.geojson")
OUT = os.path.join(ROOT, "data", "depth.geojson")
M_LAT = 111195.08
LAT0 = 30.285

# ── Taste block ───────────────────────────────────────────────────────
#
# A course is one step of the surround: how far out from the pool it sits, and
# how high it stands. Read off photographs of the Littlefield Fountain, whose
# basin sits inside a broad ring of limestone courses with the mall walk running
# round the outside.
#
# HEIGHT ALONE DOES NOT MAKE A STEP READ, and the first cut proved it. Four
# courses at 0.14 / 0.28 / 0.44 / 0.62 m are geometrically correct and rendered
# as ONE FLAT TAN BLOB: from 200 m up, 140 mm of height difference is a fraction
# of a pixel, so four top faces of the same colour at four almost-identical
# heights are indistinguishable from one surface.
#
# What makes a flight read from the air is the LIGHT AND DARK BANDING of tread
# against riser. So each course alternates its material, and the total rise is
# opened up to 1.6 m -- roughly four times a real 150 mm riser. Declared
# over-scale, the same convention as the lane markings at 5x and the roof facets
# tinted as though tilted. Set COURSE_ALT False and the banding goes away, which
# is the fastest way to see that it is the banding doing the work.
COURSE_ALT = True
FOUNTAIN_COURSES = [
    (0.0,  1.60),      # the pool coping, standing proud of the water
    (2.2,  1.15),
    (4.0,  0.72),
    (5.6,  0.34),      # the last course, easing out to the mall paving
]
FOUNTAIN_WATER_Z = 1.02     # water surface, below the coping so the rim reads
FOUNTAIN_RIM_M = 0.55       # thickness of the coping wall itself

# The mall walk either side of the fountain steps up to meet the terrace. These
# are the "stairs on both sides" specifically: two straight flights running
# north-south along the flanks, which is where the real ones are.
FLIGHT_STEPS = 6
FLIGHT_RISE = 1.35          # total rise of a flank flight
FLIGHT_WIDTH = 9.0          # metres across
FLIGHT_LENGTH = 11.0        # metres along

# ── Turtle Pond ───────────────────────────────────────────────────────
#
# "add turtle pond and add turtles"
#
# The pond itself needed no geometry in the end. It was invisible because a
# 12,569 m2 OSM "garden" was baked as a raised prop slab over the whole block
# (PR #63), and it was the wrong blue because nothing classified it as a pond
# (PR #65). Both fixed elsewhere. What is left is the turtles.
#
# NO TERRACING HERE, and that is deliberate. `terrace()` is a BASIN tool and
# Turtle Pond is not a basin: 218 m2 of water on a 122 m perimeter, a winding
# ribbon under 4 m across for most of its length. A 1.6 m rim buffered in from
# both banks left almost no water at all, and narrowing the courses to
# 0.16-0.55 m over 1.1 m offsets put them near-coplanar with the ground fill and
# rendered a stripe of z-fighting slivers across the lawn. Measure the shape
# before choosing an offset.
#
# A DOZEN TURTLES. A handful reads as litter and fifty reads as a plague. They
# are 24-42 cm shells with a head, which is all a turtle is at any altitude this
# app flies, at mixed sizes and headings because a row of identical ones is a
# pattern and a pattern reads as decoration rather than as life.
TURTLE_N = 12
TURTLE_R = (0.24, 0.42)     # shell radius range, metres
TURTLE_SEED = 20260802      # deterministic: a bake must produce the same file twice
TURTLE_BANK_M = 1.1         # within this of the edge, a turtle is hauled out
TURTLE_FLOAT_Z = 0.05       # the lift that keeps a swimmer off the pond fill

MATERIALS = {
    # Texas limestone, the material the whole mall is faced in. Day / golden /
    # night, matching the trio shape every other pass uses.
    "stone": ("#d8cfb8", "#e0cca4", "#23242e"),
    "stonedk": ("#bdb298", "#c5ab84", "#1d1e28"),   # the riser face, in shade
    "water": ("#5f86a0", "#6d87a0", "#141a26"),
    # Wet dark olive. A turtle in Austin sun photographs almost black on top.
    "shell": ("#4a4a34", "#56502f", "#12131a"),
}


def to_m(lon, lat):
    return ((lon + 97.74) * M_LAT * math.cos(math.radians(LAT0)),
            (lat - LAT0) * M_LAT)


def to_ll(x, y):
    return [round(x / (M_LAT * math.cos(math.radians(LAT0))) - 97.74, 7),
            round(y / M_LAT + LAT0, 7)]


def _signed_area(ring):
    a = 0.0
    for (x0, y0), (x1, y1) in zip(ring, ring[1:]):
        a += x0 * y1 - x1 * y0
    return a / 2.0


def load_area(name):
    g = json.load(open(GROUND, encoding="utf-8"))
    for f in g["features"]:
        if f["properties"].get("name") == name:
            return f["geometry"]["coordinates"][0]
    return None


class Depth:
    def __init__(self):
        self.feats = []
        self.stats = Counter()

    def add(self, ring_m, z0, z1, mat, name, hole_m=None):
        """One extrusion. `hole_m` makes it an ANNULUS rather than a plug.

        The coping has to be a ring: emitted as a filled polygon at 1.60 m it is
        a solid plug over the whole basin, and the water surface at 1.02 m
        inside it is simply buried. That was the second thing this pass got
        wrong and the render caught.
        """
        if z1 - z0 < 0.02 or len(ring_m) < 3:
            return
        ring = [to_ll(x, y) for x, y in ring_m]
        if ring[0] != ring[-1]:
            ring.append(ring[0])
        # GeoJSON winding: exterior counter-clockwise, holes clockwise. Shapely
        # hands back whatever the source had, and a hole wound the same way as
        # its exterior is a coin flip on whether a renderer treats it as a hole
        # or as a second solid island. Normalise both rather than hope.
        if _signed_area(ring) < 0:
            ring.reverse()
        rings = [ring]
        if hole_m and len(hole_m) >= 3:
            h = [to_ll(x, y) for x, y in hole_m]
            if h[0] != h[-1]:
                h.append(h[0])
            if _signed_area(h) > 0:
                h.reverse()
            rings.append(h)
        self.feats.append({
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": rings},
            "properties": {"k": "depth", "m": mat, "name": name,
                           "b": round(z0, 2), "h": round(z1, 2)},
        })
        self.stats["parts"] += 1

    # ── the generator ─────────────────────────────────────────────────
    def terrace(self, ring_m, courses, mat, name, riser_mat=None, hole_m=None):
        """Concentric courses around a ring: (offset in metres, height).

        Emitted OUTERMOST FIRST so that when two courses overlap in plan -- and
        they always do, because each is the whole buffered polygon rather than a
        ring band -- the taller inner one draws last and wins. Cutting true
        annular bands instead would need a hole per course and would z-fight
        along every seam for a shape nobody can see the underside of.
        """
        from shapely.geometry import Polygon
        poly = Polygon(ring_m)
        if not poly.is_valid:
            poly = poly.buffer(0)
        ordered = sorted(courses, key=lambda c: -c[0])
        for i, (off, z) in enumerate(ordered):
            p = poly.buffer(off, join_style=2, mitre_limit=2.0) if off else poly
            if p.is_empty:
                continue
            # Alternate light and dark so the courses read as a flight rather
            # than as one surface. See COURSE_ALT.
            m = mat if (not COURSE_ALT or i % 2 == 0) else (riser_mat or mat)
            parts = p.geoms if p.geom_type == "MultiPolygon" else [p]
            # EVERY course carries the hole, not just the innermost, and that is
            # the third thing this pass got wrong. Each course is the whole
            # buffered polygon, so the second course out -- 1.15 m tall against
            # the water at 1.02 -- was a solid plug straight over the basin.
            # Colouring the water magenta rendered ZERO pixels even with the
            # coping hidden, which is what finally located it: the feature was
            # in the source, in queryRenderedFeatures, and under a taller
            # neighbour the whole time.
            for gm in parts:
                self.add(list(gm.exterior.coords), 0.0, z, m, name, hole_m)
        self.stats["terraces"] += 1

    def dome(self, cx, cy, r, z0, h, mat, name, tiers=3, seg=8):
        """Stacked chords of a hemisphere — the only curved top there is."""
        for i in range(tiers):
            t0, t1 = i / tiers, (i + 1) / tiers
            rr = r * math.sqrt(max(0.0, 1.0 - ((t0 + t1) / 2) ** 2))
            self.add([(cx + rr * math.cos(2 * math.pi * k / seg),
                       cy + rr * math.sin(2 * math.pi * k / seg)) for k in range(seg)],
                     z0 + h * t0, z0 + h * t1, mat, name)

    def turtle(self, cx, cy, r, z, facing, name):
        """A shell and a head. That is a turtle at sixty metres."""
        self.dome(cx, cy, r, z, r * 0.78, "shell", name, tiers=3, seg=8)
        hx, hy = cx + math.cos(facing) * r * 1.05, cy + math.sin(facing) * r * 1.05
        self.add([(hx + r * 0.3 * math.cos(a), hy + r * 0.3 * math.sin(a))
                  for a in (0.0, 1.571, 3.142, 4.712)], z, z + r * 0.42, "shell", name)
        self.stats["turtles"] += 1

    def flight(self, cx, cy, along_deg, length, width, z0, z1, n, mat, name):
        """A straight run of n steps, each a slab at its own rising base."""
        a = math.radians(along_deg)
        ca, sa = math.cos(a), math.sin(a)
        for i in range(n):
            t = (i + 0.5) / n
            step_mat = mat if (not COURSE_ALT or i % 2 == 0) else "stonedk"
            # Each tread is the FULL width and one step deep, centred along the
            # run. Overlapping them by a third stops a hairline of ground
            # showing between treads when the camera is low.
            d = (t - 0.5) * length
            L = length / n * 1.34
            px, py = cx + d * ca, cy + d * sa
            hw, hl = width / 2, L / 2
            pts = [(-hl, -hw), (hl, -hw), (hl, hw), (-hl, hw)]
            self.add([(px + x * ca - y * sa, py + x * sa + y * ca) for x, y in pts],
                     0.0, z0 + (z1 - z0) * (i + 1) / n, step_mat, name)
        self.stats["flights"] += 1


def main():
    d = Depth()

    ring = load_area("Littlefield Fountain")
    if ring is None:
        print("Littlefield Fountain not found in ground.geojson - nothing to do")
        return
    ring_m = [to_m(x, y) for x, y in ring]
    cx = sum(x for x, _ in ring_m) / len(ring_m)
    cy = sum(y for _, y in ring_m) / len(ring_m)

    # The pool, and the hole the coping needs so the water can be seen.
    from shapely.geometry import Polygon, Point
    pool = Polygon(ring_m).buffer(-FOUNTAIN_RIM_M, join_style=2)
    pool_ring = None
    if not pool.is_empty:
        gm = max(pool.geoms, key=lambda q: q.area) if pool.geom_type == "MultiPolygon" else pool
        pool_ring = list(gm.exterior.coords)

    # The surround: four courses stepping down and out to the mall paving, the
    # innermost one cut as a ring so the basin is open.
    d.terrace(ring_m, FOUNTAIN_COURSES, "stone", "Littlefield Fountain",
              riser_mat="stonedk", hole_m=pool_ring)

    if pool_ring:
        # Pulled 0.12 m inside the hole it sits in. Coincident vertical faces
        # z-fight, and a fountain that flickers along its own rim is worse than
        # one with a hairline of shadow there.
        inner = Polygon(pool_ring).buffer(-0.12, join_style=2)
        if not inner.is_empty:
            gm2 = max(inner.geoms, key=lambda q: q.area) if inner.geom_type == "MultiPolygon" else inner
            d.add(list(gm2.exterior.coords), 0.0, FOUNTAIN_WATER_Z, "water",
                  "Littlefield Fountain")

    # "stairs on both sides" — the two flank flights, east and west of the pool,
    # running north-south up the mall.
    span = max(x for x, _ in ring_m) - min(x for x, _ in ring_m)
    for side in (-1, 1):
        d.flight(cx + side * (span / 2 + FLIGHT_WIDTH * 0.62), cy + 6.0,
                 90.0, FLIGHT_LENGTH, FLIGHT_WIDTH,
                 0.0, FLIGHT_RISE, FLIGHT_STEPS, "stone", "South Mall steps")

    # ── The turtles ───────────────────────────────────────────────────
    pring = load_area("Turtle Pond")
    if pring is None:
        print("  Turtle Pond not found - no turtles")
    else:
        wp = Polygon([to_m(x, y) for x, y in pring])
        if not wp.is_valid:
            wp = wp.buffer(0)
        minx, miny, maxx, maxy = wp.bounds
        rng, placed, tries = TURTLE_SEED, 0, 0
        while placed < TURTLE_N and tries < 6000:
            tries += 1
            vals = []
            for _ in range(3):
                rng = (rng * 1103515245 + 12345) & 0x7FFFFFFF
                vals.append(((rng >> 7) % 10000) / 10000.0)
            fx, fy, fr = vals
            x, y = minx + (maxx - minx) * fx, miny + (maxy - miny) * fy
            if not wp.contains(Point(x, y)):
                continue
            r = TURTLE_R[0] + (TURTLE_R[1] - TURTLE_R[0]) * fr
            # Hauled out on the edge, or floating. Both sit just above the flat
            # pond fill; the lift is what stops a turtle z-fighting the water.
            on_bank = wp.exterior.distance(Point(x, y)) < TURTLE_BANK_M
            d.turtle(x, y, r, TURTLE_FLOAT_Z + (0.06 if on_bank else 0.0),
                     fr * 6.283, "Turtle Pond")
            placed += 1
        if placed < TURTLE_N:
            print("  only %d of %d turtles placed" % (placed, TURTLE_N))

    fc = {"type": "FeatureCollection", "features": d.feats}
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(fc, fh, separators=(",", ":"))
    print(json.dumps({
        "features": len(d.feats),
        "file_kb": round(os.path.getsize(OUT) / 1024, 1),
        "counts": dict(sorted(d.stats.items())),
        "provenance": {
            "position and extent": "factual - the fountain's own footprint from OSM",
            "course heights": "GENERATIVE - read off photographs and drawn at "
                              "roughly twice scale, because a 150 mm riser is a "
                              "third of a pixel from flying altitude",
        },
    }, indent=2))


if __name__ == "__main__":
    main()
