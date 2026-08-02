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

THE GENERATOR IS THE POINT, not the fountain.

  * `step()` is the whole idea in a dozen lines: a course is a DARK slab with a
    LIGHT slab set back on top of it. The dark ring left showing round the rim
    is the nosing; the dark vertical face below it is the riser.
  * `terrace()` buffers a ring into a list of courses and calls `step()` on each.
  * `flight()` does the same along a straight run.

----------------------------------------------------------------------------
2026-08-02, second pass: A STRIPE IS NOT A STAIR.

"stairs next to foundtain looks like a yoga mat. If this needs a broader depth
fix do that - but make them accurate"

He is right, and the defect was in the generator -- exactly where the first pass
claimed the value was. `terrace()` emitted ONE slab per course and ALTERNATED
its material light/dark by course index. That paints concentric bands of colour,
which is a rug. The geometry had risers in it all along; nothing MARKED them,
because a riser face and the tread above it were the same colour, and the next
course out was a different colour for no reason the eye can attach to the form.

What makes a flight read is a RISER FACE IN SHADOW under every tread, and the
z20 nadir of the real fountain shows exactly that: two dark arcs, each about
0.43 m wide seen from above, one under each weir. So:

    every course = dark slab (riser + nosing) + light slab inset on top (tread)

and the alternation by index is gone. Set STEP_PROFILE False and the whole
scene collapses back to flat courses, which is the fastest way to see that the
nosing is what does the work.

WHAT THE REFERENCE ACTUALLY SHOWS, because the brief's guess was half right.
Read: an ESRI z20 nadir stitched at 0.043 m/px, and four ground photographs
(Wikimedia -- two of the cascade from the south, two from the south-west with
Benedict Hall behind).

  * THE FOUNTAIN'S OWN POOL IS CURVED, and it is three tiers, not one basin.
    Wikipedia: "a three-tiered semicircular granite pool". The nadir shows both
    weirs and their scrolled ends. THAT is the curve.
  * THE FLANKING FLIGHTS ARE STRAIGHT. Both the nadir and the Benedict Hall
    photograph show plain straight runs of six-ish steps rising to the upper
    plaza. Nothing curved about them. They are no longer invented here: they
    are built on the `patharea/steps` polygons OSM already maps, so they are
    where the real ones are rather than where a constant put them.
  * THE FOUR CONCENTRIC COURSES STEPPING OUTWARD FROM THE POOL WERE FICTION.
    Outside the coping there is lawn, then paving -- no limestone terrace at
    all. They are deleted. What replaces them is the real profile going INWARD.

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
# THE STEP PROFILE. These decide whether anything here reads as a stair, and
# they are the only aesthetic knobs the generator has.
#
# STEP_NOSING is the width of the dark band left showing along the leading edge
# of every tread, seen from straight above. A real nosing is a 20 mm arris; this
# is 0.35 m, declared over-scale for the same reason the lane markings are at
# 5x -- at 20 mm it is a hundredth of a pixel from any altitude this app flies.
# It also happens to be close to the reference: the weir shadows on the z20
# nadir are 0.43 m of dark.
#
# STEP_LIFT is the clearance the light tread is raised above the dark slab it
# sits on. Two coplanar top faces z-fight; 30 mm settles it and is far too
# small to read as a second step.
#
# STEP_NOSING_FRAC caps the nosing on a narrow course: no more than this share
# of the depth available. A stair tread is 0.42 m, so a flat 0.35 m nosing would
# eat the whole step.
STEP_NOSING = 0.35
STEP_NOSING_FRAC = 0.35
STEP_LIFT = 0.03
STEP_PROFILE = True     # False -> one flat slab per course, the old behaviour

# ── The Littlefield Fountain ──────────────────────────────────────────
#
# Pompeo Coppini, dedicated 29 April 1933, at the foot of the South Mall. A
# bronze group -- Columbia on the prow of the Boat of America, drawn by
# hippocampi -- standing in the TOP basin of a three-tiered semicircular granite
# pool, backed by a limestone wall between two pylons.
#
# MEASURED, not recalled. The footprint is OSM's (28 vertices, 28.1 x 32.6 m,
# 571 m2) and it is the OUTER FACE OF THE COPING, not the water line. The rest
# was read off a stitched ESRI z20 nadir at 0.043 m/px:
#
#   coping width      0.54 m   (the pale ring round the whole basin)
#   weir arc          a circle through the two scrolled ends and its apex:
#                     centre 7.09 m down-mall from the head of the channel,
#                     radius 12.31 m. NOT a buffer of the footprint -- fitted.
#   middle crescent   4.1 m deep on the axis, tapering into the scrolls
#   weir shadow       0.43 m of dark from above, twice, one per weir
#
# The heights are GENERATIVE and the ground photographs are the source: the
# cascade stands about chest-high from the plaza over its whole depth, and the
# two weirs are visibly equal. 0.56 m each, on a 0.50 m coping.
FOUNTAIN_NAME = "Littlefield Fountain"
FOUNTAIN_COPING_W = 0.55        # granite rim; measured 0.54 off the nadir
FOUNTAIN_COPING_Z = 0.50        # rim top above the plaza
FOUNTAIN_WEIR_W = 0.60          # thickness of a weir wall between two basins
FOUNTAIN_WEIR_U = 7.09          # weir arc centre, metres down-mall from the head
FOUNTAIN_WEIR_R = 12.31         # weir arc radius
FOUNTAIN_MOUTH_U = 13.60        # middle/top basin boundary, metres down-mall
# (crest of this basin's wall, water surface inside it), lowest tier first.
FOUNTAIN_TIERS = [
    (FOUNTAIN_COPING_Z, 0.34),  # the big D-shaped bottom basin
    (1.06, 0.92),               # the crescent between the two weirs
    (1.62, 1.48),               # the channel with the bronze group
]

# ── The flanking flights ──────────────────────────────────────────────
#
# "stairs on both sides" -- and they are STRAIGHT: six-ish risers rising north
# to the upper plaza behind the fountain. OSM maps both as `highway=steps`, and
# bake_ground.py buffers those into `patharea/steps` polygons which the app
# already draws as a FLAT 0.22 m slab. So the POSITIONS are data and only the
# profile is generated here.
#
# FLIGHT_BASE has to clear that 0.22 m slab or the bottom treads are swallowed
# by it, and FLIGHT_INSET keeps the flight's vertical faces off the slab's.
FLIGHT_NEAR_M = 45.0            # only step areas this close to the fountain
FLIGHT_MIN_AREA = 4.0           # m2 -- below this it is a kerb, not a flight
FLIGHT_RISER = 0.17             # per step. A real monumental stair is ~0.15.
FLIGHT_TREAD = 0.42             # per step, along the run
FLIGHT_RISE_MAX = 1.10          # the mall's level change here. SEE BELOW.
FLIGHT_BASE = 0.22              # = GROUND.pathRaise in js/ground.js
FLIGHT_INSET = 0.10             # keep the sides off the path slab's own faces
FLIGHT_LANDING_M = 0.6          # how much of a long mapped run is drawn as landing
#
# FLIGHT_RISE_MAX is the guard that stopped this pass shipping a 3 m staircase
# in a flat plaza, and it is the same class of error as HANDOFF 51 ("a level run
# has no height"). The step COUNT was being derived from the run length: the
# west step area is 7.5 m long, which at a 0.42 m tread is eighteen steps and
# 3.06 m of climb. A mapped `highway=steps` way is drawn bottom-of-stair to
# top-of-walk, so most of that length is LANDING. Cap the rise at the level
# change the photographs show -- six or seven steps -- and let the nesting in
# flight() turn the remainder of the run into the top landing for free.

# ── Turtle Pond ───────────────────────────────────────────────────────
#
# "turtle pond too many turtiles"
#
# It was twelve on 218 m2 of water, and he is right that that is a plague. Six,
# over a much wider size range so they read as animals of different ages rather
# than as a repeated motif: a couple of big adults and several small ones. The
# SPREAD is what stops a repeated primitive reading as decoration -- a dozen
# near-identical shells is a pattern, and a pattern reads as wallpaper.
#
# NO TERRACING HERE, and that is deliberate. `terrace()` is a BASIN tool and
# Turtle Pond is not a basin: 218 m2 of water on a 122 m perimeter, a winding
# ribbon under 4 m across for most of its length. A 1.6 m rim buffered in from
# both banks left almost no water at all, and narrowing the courses to
# 0.16-0.55 m over 1.1 m offsets put them near-coplanar with the ground fill and
# rendered a stripe of z-fighting slivers across the lawn. Measure the shape
# before choosing an offset.
TURTLE_N = 6
TURTLE_R = (0.16, 0.52)     # shell radius range, metres
TURTLE_BIAS = 1.7           # >1 makes small turtles commoner than big ones
TURTLE_SEED = 20260802      # deterministic: a bake must produce the same file twice
TURTLE_BANK_M = 1.1         # within this of the edge, a turtle is hauled out
TURTLE_FLOAT_Z = 0.05       # the lift that keeps a swimmer off the pond fill

# js/ground.js knows FOUR materials and falls back to `stone` for anything it
# does not recognise, so this is the whole palette until that file gains a fifth.
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


def load_ground():
    return json.load(open(GROUND, encoding="utf-8"))


def load_area(g, name):
    for f in g["features"]:
        if f["properties"].get("name") == name:
            return f["geometry"]["coordinates"][0]
    return None


def biggest(p):
    """Shapely hands back a Polygon, a MultiPolygon or nothing. Pick one."""
    if p is None or p.is_empty:
        return None
    if p.geom_type == "MultiPolygon":
        return max(p.geoms, key=lambda q: q.area)
    return p if p.geom_type == "Polygon" else None


def _parts(p):
    if p is None or p.is_empty:
        return []
    return list(p.geoms) if p.geom_type == "MultiPolygon" else [p]


class Depth:
    def __init__(self):
        self.feats = []
        self.stats = Counter()

    def add(self, ring_m, z0, z1, mat, name, holes_m=None):
        """One extrusion. `holes_m` (a list of rings) makes it an ANNULUS.

        The coping has to be a ring: emitted as a filled polygon at 0.50 m it is
        a solid plug over the whole basin, and the water surface at 0.34 m
        inside it is simply buried. That was the second thing the first pass got
        wrong and the render caught -- painting the water magenta gave ZERO
        pixels even with the coping hidden.
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
        for h in (holes_m or []):
            if len(h) < 3:
                continue
            hh = [to_ll(x, y) for x, y in h]
            if hh[0] != hh[-1]:
                hh.append(hh[0])
            if _signed_area(hh) > 0:
                hh.reverse()
            rings.append(hh)
        self.feats.append({
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": rings},
            "properties": {"k": "depth", "m": mat, "name": name,
                           "b": round(z0, 2), "h": round(z1, 2)},
        })
        self.stats["parts"] += 1

    # ── the generator ─────────────────────────────────────────────────
    def step(self, poly, z, name, hole=None, nosing=None):
        """ONE COURSE = A DARK SLAB WITH A LIGHT SLAB SET BACK ON TOP.

        This is the whole fix for "looks like a yoga mat", and it is worth being
        precise about why it works, because the previous version had the same
        geometry and read as a rug.

        A course is a solid slab from the datum to `z`. Where the course inside
        it stands taller, the difference is a vertical face -- the RISER -- and
        that face was already being drawn. What was missing is that it was the
        same colour as the tread above it, so nothing marked the edge. Painting
        the slab `stonedk` and setting a `stone` tread back from its rim by
        STEP_NOSING leaves a dark band along every edge in plan AND makes the
        riser dark in elevation. From above you read the nosing; from an oblique
        camera you read the riser; from tour altitude you read a thin dark line,
        which is what a distant flight of steps looks like.

        The hole shrinks the course from the inside too, so the INNER rim of a
        ring gets its dark band as well. That is not decoration: it is what the
        wet granite lip of a weir looks like from the air, and it is the pair of
        dark arcs visible on the nadir of the real fountain.

        THE NOSING IS SHRUNK UNTIL IT FITS, and this is the whole reason the
        first render of this pass came back with the fountain as one solid tan
        plug and no water anywhere. The tread was built as
        `outer.buffer(-nos)` with a hole of `inner.buffer(+nos)`. The coping
        ring is only 0.55 m wide, the nosing is 0.35, so the grown hole came out
        LARGER THAN THE SHRUNK EXTERIOR -- a polygon whose hole contains its own
        exterior. MapLibre does not reject that; it drops the hole and paints the
        whole basin at 0.53 m, burying the water exactly as HANDOFF 42(d)
        describes. Buffering the course as ONE polygon-with-holes cannot produce
        that shape: shapely returns empty instead. The retry loop keeps a
        proportional nosing on narrow rings rather than losing the tread.
        """
        poly = biggest(poly)
        if poly is None:
            return
        course = poly if hole is None else poly.difference(hole)
        course = biggest(course)
        if course is None:
            return
        nos = STEP_NOSING if nosing is None else nosing
        self.emit(course, 0.0, z, "stonedk" if STEP_PROFILE else "stone", name)
        self.stats["courses"] += 1
        if not STEP_PROFILE or nos <= 0:
            return
        for k in (1.0, 0.5, 0.25, 0.12):
            tread = course.buffer(-nos * k, join_style=2, mitre_limit=2.0)
            if not tread.is_empty:
                for part in _parts(tread):
                    self.emit(part, 0.0, z + STEP_LIFT, "stone", name)
                if k < 1.0:
                    self.stats["nosing_shrunk"] += 1
                return

    def emit(self, p, z0, z1, mat, name):
        """A shapely polygon, holes and all."""
        self.add(list(p.exterior.coords), z0, z1, mat, name,
                 [list(r.coords) for r in p.interiors])

    def terrace(self, ring_m, courses, name, hole_m=None):
        """Concentric courses around a ring: (offset in metres, height).

        Emitted OUTERMOST FIRST so that when two courses overlap in plan -- and
        they always do, because each is the whole buffered polygon rather than a
        ring band -- the taller inner one draws last and wins. Cutting true
        annular bands instead would need a hole per course and would z-fight
        along every seam of a shape nobody can see the underside of.

        EVERY course carries the hole, not just the innermost. Each course is
        the whole buffered polygon, so a course 1.15 m tall was once a solid
        plug straight over a basin whose water sat at 1.02 m.

        Nothing calls this at the fountain any more -- the real tiers are not
        buffers, see fountain() -- but it is the tool Waller Creek's banks want
        (QUEUE A7) once the ground has a hole to show them through, so it stays
        and it now emits the tread/riser profile like everything else.
        """
        from shapely.geometry import Polygon
        poly = Polygon(ring_m)
        if not poly.is_valid:
            poly = poly.buffer(0)
        hole = Polygon(hole_m) if hole_m else None
        for off, z in sorted(courses, key=lambda c: -c[0]):
            p = poly.buffer(off, join_style=2, mitre_limit=2.0) if off else poly
            self.step(p, z, name, hole)
        self.stats["terraces"] += 1

    def flight(self, centre, run, length, width, n, tread, base, riser, name):
        """A straight run of n steps: centre, unit run direction, size.

        Each step is a slab spanning from its own leading edge to the TOP of the
        run, so the slabs NEST and each one shows exactly one tread. The first
        cut drew every tread as its own rectangle and had to overlap them by a
        third to stop a hairline of ground showing between them; nesting removes
        the failure mode instead of padding it.

        The nosing goes on the LEADING edge only -- a stair has no riser along
        its flanks -- so `step()` is called with nosing 0 and the tread is
        trimmed here.

        AND THE NOSING IS A FRACTION OF THE TREAD, not the flat STEP_NOSING. On
        a terrace whose courses are metres wide, 0.35 m of dark is a rim. On a
        0.42 m stair tread it is the whole step, and the first cut of this
        emitted no light tread at all because `tread > STEP_NOSING * 1.2` came
        out 0.42 > 0.42000000000000004 and the guard silently swallowed every
        one of them. A stair photographed from above shows roughly a third dark
        to two thirds light, so that is the rule.
        """
        from shapely.geometry import Polygon
        cx, cy = centre
        ux, uy = run
        px, py = -uy, ux
        nos = min(STEP_NOSING, tread * STEP_NOSING_FRAC)

        def rect(d0):
            c = [(d0, -width / 2), (length / 2, -width / 2),
                 (length / 2, width / 2), (d0, width / 2)]
            return Polygon([(cx + a * ux + b * px, cy + a * uy + b * py)
                            for a, b in c])

        for i in range(n):
            d0 = -length / 2 + i * tread
            z = base + (i + 1) * riser
            self.step(rect(d0), z, name, None, nosing=0.0)
            if STEP_PROFILE and nos > 0.02:
                self.emit(rect(d0 + nos), 0.0, z + STEP_LIFT, "stone", name)
        self.stats["flights"] += 1

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


# ── the fountain ──────────────────────────────────────────────────────
def mall_frame(ring_m, foot):
    """The fountain's own axis, derived rather than assumed.

    The South Mall does not run due north -- it is about 6 degrees east of it --
    and every measurement in the taste block is "metres down-mall". Assuming
    north would put the weir arc a metre out at the scrolls and rotate the
    channel mouth across the basin. The head of the fountain is the footprint's
    northernmost EDGE (the closed end of the sculpture channel); the axis is its
    perpendicular, pointing at the centroid.
    """
    pts = ring_m[:-1] if ring_m[0] == ring_m[-1] else ring_m
    i = max(range(len(pts)), key=lambda k: pts[k][1])
    a = pts[i]
    # its neighbour along the head edge: whichever of the two adjacent vertices
    # is more nearly level with it.
    cands = [pts[(i - 1) % len(pts)], pts[(i + 1) % len(pts)]]
    b = min(cands, key=lambda p: abs(p[1] - a[1]))
    head = ((a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0)
    ex, ey = b[0] - a[0], b[1] - a[1]
    L = math.hypot(ex, ey) or 1.0
    ux, uy = ey / L, -ex / L
    c = foot.centroid
    if (c.x - head[0]) * ux + (c.y - head[1]) * uy < 0:
        ux, uy = -ux, -uy
    return head, (ux, uy)


def fountain(d, g):
    """The Littlefield Fountain: three curved tiers, from its own footprint.

    THE TIER BOUNDARIES ARE NOT BUFFERS, and that is the accuracy point. A
    buffer of the footprint runs parallel to the outer wall everywhere and gives
    a crescent of even width. The real weir is a circular arc struck about a
    centre on the mall axis: it meets the outer wall at two scrolled ends and
    bulges downhill between them, so the crescent TAPERS into its ends. That is
    the shape the nadir shows and a buffer cannot produce it.
    """
    from shapely.geometry import Polygon, Point
    ring = load_area(g, FOUNTAIN_NAME)
    if ring is None:
        print("  %s not found in ground.geojson" % FOUNTAIN_NAME)
        return None
    ring_m = [to_m(x, y) for x, y in ring]
    foot = Polygon(ring_m)
    if not foot.is_valid:
        foot = foot.buffer(0)
    head, (ux, uy) = mall_frame(ring_m, foot)

    pool = biggest(foot.buffer(-FOUNTAIN_COPING_W, join_style=2))
    if pool is None:
        print("  the coping ate the whole pool")
        return None

    # The weir arc, struck from a centre on the axis. Everything on the uphill
    # side of it is inside this disc.
    wc = Point(head[0] + ux * FOUNTAIN_WEIR_U, head[1] + uy * FOUNTAIN_WEIR_U)
    disc = wc.buffer(FOUNTAIN_WEIR_R, resolution=64)
    # The channel mouth: a half-plane cut square across the mall.
    mx, my = head[0] + ux * FOUNTAIN_MOUTH_U, head[1] + uy * FOUNTAIN_MOUTH_U
    px, py = -uy, ux
    BIG = 400.0
    upstream = Polygon([
        (mx + px * BIG, my + py * BIG),
        (mx - px * BIG, my - py * BIG),
        (mx - px * BIG - ux * BIG, my - py * BIG - uy * BIG),
        (mx + px * BIG - ux * BIG, my + py * BIG - uy * BIG)])

    top = biggest(pool.intersection(upstream))
    middle = biggest(pool.intersection(disc).difference(upstream))
    report = []
    for i, (crest, water) in enumerate(FOUNTAIN_TIERS):
        if i == 0:
            outer, inner = foot, pool          # the coping ring
        else:
            outer = middle if i == 1 else top
            inner = (biggest(outer.buffer(-FOUNTAIN_WEIR_W, join_style=2))
                     if outer is not None else None)
        if outer is None:
            print("  fountain tier %d came out empty" % i)
            continue
        d.step(outer, crest, FOUNTAIN_NAME, inner)
        if inner is not None:
            d.add(list(inner.exterior.coords), 0.0, water, "water", FOUNTAIN_NAME)
        report.append({"tier": i, "m2": round(outer.area, 1),
                       "crest": crest, "water": water})
    d.stats["fountain_tiers"] = len(report)
    return {
        "footprint_m2": round(foot.area, 1),
        "extent_m": [round(foot.bounds[2] - foot.bounds[0], 1),
                     round(foot.bounds[3] - foot.bounds[1], 1)],
        "mall_bearing_deg": round(math.degrees(math.atan2(ux, uy)), 1),
        "tiers": report,
        "centre": to_ll(foot.centroid.x, foot.centroid.y),
    }


# ── the flanking flights ──────────────────────────────────────────────
def _run_axis(poly, up):
    """Centre, run direction, extent along the run, extent across it.

    THE RUN DIRECTION IS THE MALL'S, NOT THE POLYGON'S LONG AXIS, and the first
    cut got this exactly backwards. A monumental stair is WIDER THAN IT IS DEEP
    -- the east flight here is a 1.6 m run 3.1 m wide -- so taking the longer
    side of `minimum_rotated_rectangle` as the direction of travel turned the
    stair through ninety degrees and made a seven-step flight out of its width.
    Sister error to HANDOFF 50: the rectangle was right, the assumption about
    which of its sides meant what was not.

    These flights all climb the South Mall, so the mall axis IS the answer and
    it is already derived from the fountain's own footprint.
    """
    ux, uy = up
    px, py = -uy, ux
    pts = list(poly.exterior.coords)
    a = [x * ux + y * uy for x, y in pts]
    b = [x * px + y * py for x, y in pts]
    L, W = max(a) - min(a), max(b) - min(b)
    if L < 1e-6 or W < 1e-6:
        return None
    ca, cb = (max(a) + min(a)) / 2, (max(b) + min(b)) / 2
    return (ca * ux + cb * px, ca * uy + cb * py), (ux, uy), L, W


def flights(d, g, centre_ll, down):
    """Real steps on the mapped step areas, not two invented rectangles.

    `down` is the fountain's own down-mall vector; the stairs climb the other
    way, toward the Main Building.
    """
    from shapely.geometry import Polygon
    cx, cy = to_m(*centre_ll)
    ux, uy = -down[0], -down[1]
    out = []
    for f in g["features"]:
        p = f["properties"]
        if p.get("k") != "patharea" or p.get("u") != "steps":
            continue
        geom = f["geometry"]
        rings = ([geom["coordinates"][0]] if geom["type"] == "Polygon"
                 else [c[0] for c in geom["coordinates"]])
        for r in rings:
            poly = biggest(Polygon([to_m(x, y) for x, y in r]).buffer(0))
            if poly is None or poly.area < FLIGHT_MIN_AREA:
                continue
            if math.hypot(poly.centroid.x - cx, poly.centroid.y - cy) > FLIGHT_NEAR_M:
                continue
            axis = _run_axis(poly, (ux, uy))
            if axis is None:
                continue
            (mx, my), (rx, ry), full, W = axis
            full = max(0.6, full - 2 * FLIGHT_INSET)
            W = max(0.6, W - 2 * FLIGHT_INSET)
            # Steps enough to climb the level change, or as many as fit.
            n = max(2, min(int(round(FLIGHT_RISE_MAX / FLIGHT_RISER)),
                           int(full / FLIGHT_TREAD)))
            # TRIM THE RUN TO THE STAIR. Draw the whole 7.4 m of a mapped way
            # and its top slab is a 3 x 5 m block standing 1.2 m proud with a
            # cliff at its far end, because there is no terrain up there for it
            # to meet. Cropped to the treads plus a short landing it reads as
            # what it is. The crop keeps the DOWNHILL end fixed.
            L = min(full, n * FLIGHT_TREAD + FLIGHT_LANDING_M)
            shift = (full - L) / 2.0
            cx2, cy2 = mx - rx * shift, my - ry * shift
            d.flight((cx2, cy2), (rx, ry), L, W, n, FLIGHT_TREAD,
                     FLIGHT_BASE, FLIGHT_RISER, "South Mall steps")
            out.append({"m2": round(poly.area, 1), "mapped_run_m": round(full, 1),
                        "drawn_run_m": round(L, 1),
                        "width_m": round(W, 1), "steps": n,
                        "tread_m": FLIGHT_TREAD,
                        "rise_m": round(n * FLIGHT_RISER, 2),
                        "at": to_ll(cx2, cy2)})
    return out


# ── the turtles ───────────────────────────────────────────────────────
def turtles(d, g):
    from shapely.geometry import Polygon, Point
    pring = load_area(g, "Turtle Pond")
    if pring is None:
        print("  Turtle Pond not found - no turtles")
        return None
    wp = biggest(Polygon([to_m(x, y) for x, y in pring]).buffer(0))
    if wp is None:
        return None
    minx, miny, maxx, maxy = wp.bounds
    rng, placed, tries, sizes = TURTLE_SEED, 0, 0, []
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
        r = TURTLE_R[0] + (TURTLE_R[1] - TURTLE_R[0]) * (fr ** TURTLE_BIAS)
        # Hauled out on the edge, or floating. Both sit just above the flat
        # pond fill; the lift is what stops a turtle z-fighting the water.
        on_bank = wp.exterior.distance(Point(x, y)) < TURTLE_BANK_M
        d.turtle(x, y, r, TURTLE_FLOAT_Z + (0.06 if on_bank else 0.0),
                 fr * 6.283, "Turtle Pond")
        sizes.append(round(r, 2))
        placed += 1
    if placed < TURTLE_N:
        print("  only %d of %d turtles placed" % (placed, TURTLE_N))
    return {"water_m2": round(wp.area, 1), "turtles": placed,
            "shell_radii_m": sorted(sizes)}


def main():
    d = Depth()
    g = load_ground()

    f = fountain(d, g)
    fl = []
    if f:
        ring_m = [to_m(x, y) for x, y in load_area(g, FOUNTAIN_NAME)]
        from shapely.geometry import Polygon
        _, down = mall_frame(ring_m, Polygon(ring_m).buffer(0))
        fl = flights(d, g, f["centre"], down)
    t = turtles(d, g)

    fc = {"type": "FeatureCollection", "features": d.feats}
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(fc, fh, separators=(",", ":"))
    print(json.dumps({
        "features": len(d.feats),
        "file_kb": round(os.path.getsize(OUT) / 1024, 1),
        "counts": dict(sorted(d.stats.items())),
        "fountain": f,
        "flights": fl,
        "turtle_pond": t,
        "provenance": {
            "fountain footprint":
                "factual - OSM, and it is the outer face of the coping",
            "coping width / weir arc / crescent depth":
                "MEASURED off a stitched ESRI z20 nadir at 0.043 m/px",
            "tier heights":
                "GENERATIVE - read off ground photographs; the two weirs are "
                "visibly equal and the cascade stands about chest-high",
            "flight positions":
                "factual - OSM highway=steps, via ground.geojson patharea/steps",
            "nosing width":
                "GENERATIVE and over-scale at 0.35 m, the same declared "
                "convention as the 5x lane markings",
        },
    }, indent=2))


if __name__ == "__main__":
    main()
