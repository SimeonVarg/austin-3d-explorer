# -*- coding: utf-8 -*-
"""UT's Landmarks collection, as geometry instead of grey boxes.

WHAT IS THERE NOW. data/props.geojson carries 34 `k:'art'` features, each with a
name, an artist, an `at` (artwork_type) and a height. js/props.js draws every one
of them as ONE extrusion of the footprint in ONE flat colour, so a 7 m burst of
welded aluminium canoes and a 4.2 m bronze armadillo are the same grey block.

Simeon, 2026-08-01: "an earlier pass was supposed to add monochrome for austin
but it added a gray box same for the clock knot ... where it says 'the west'
pretty sure thats supposed to be balls of texas add that its a gray box rn ...
diana the huntress is a gray box ... austin building by ellsworth has chromatic
circle of glass can you add that with the colors."

THE SHAPE OF THE ANSWER. Not 34 bespoke models -- a small vocabulary of forms
(plinth, post, beam, disc, dome, figure) plus a RULE keyed on `at`, plus a
per-piece override where the piece is famous enough that its silhouette is the
point. Ten overrides carry the pieces anyone would recognise; the other 24 get
a plinth and a form that at least says "statue" or "sculpture" rather than
"box". Every one of them is legible at 60 m, which is the distance that matters.

2026-08-02, AND THIS IS THE IMPORTANT PART OF THE FILE NOW. "make monochrome for
austin look better not like a silver tree. clock not looks like a fireplace and
not big enough. I don't even want to check out the other landmarks PLEASE make
them accurate to size and architecture."

Size before architecture, and he had the order right, because the size was the
thing no recipe could have fixed. Read the source and it is plain: EVERY
`at=statue` in props.geojson is 4.2 m on a 1.83 m footprint, EVERY `at=sculpture`
is 5.5 m on 3.17 m, EVERY `at=installation` is 7.0 m on 4.81 m. They are class
defaults on a buffered OSM node -- the same three numbers for the armadillo and
for the largest sculpture on campus. So `DIMS` below is the fix, and the recipes
are downstream of it. Monochrome for Austin was at 46% of its real height and
Clock Knot at 43%.

WHAT IS FACTUAL AND WHAT IS NOT. Positions, names and artists come from OSM and
the City of Austin's public-art inventory. SIZES now come from the published
dimension of the real work wherever one could be found, with the source written
next to it in DIMS; where none was found the entry says `est` and says what it
was reasoned from. The FORMS are still generative: they are read off published
descriptions and photographs and reduced to what fill-extrusion can express,
which is stacked horizontal slabs. A leaning I-beam becomes a short stack of
offset slabs; a sphere becomes stacked chords. Stated here rather than implied.

AND THE BAKE CHECKS ITSELF. main() re-measures the file it just wrote against
DIMS and exits non-zero on a disagreement, because a recipe that emits nothing,
or emits everything 2 cm tall, still runs to completion and still prints a happy
summary. art_lonestar did exactly that: three of a five-pointed star's five
points were never in the file, and nothing said so.

WHY A BAKE AND NOT A DRAW. Same reason as bake_tower.py: fill-extrusion has no
vertical anchor and no rotation, so anything that is not a prism has to arrive as
separate features carrying their own base, height and colour. Doing that in the
browser would mean generating a few hundred polygons on every load.

Usage:  python scripts/bake_art.py
"""
import json
import math
import os
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "data", "props.geojson")
OUT = os.path.join(ROOT, "data", "art.geojson")
M_LAT = 111320.0

# ── Taste block. Materials, as day / golden / night trios. ─────────────
#
# Read off photographs of the real works and dulled a little: a sculpture that
# out-saturates the buildings around it reads as a UI element, not as an object
# in the scene. Every one of these is a one-line override.
MAT = {
    "bronze":   ("#6d4a2c", "#7d5530", "#1b1518"),   # weathered cast bronze
    "bronzed":  ("#4a3722", "#57401f", "#161217"),   # darker patina, in shade
    "alum":     ("#b9bec6", "#c6b9a6", "#232630"),   # mill-finish aluminium
    "mirror":   ("#cdd8e0", "#dcc9b0", "#2a3038"),   # polished stainless
    "steelred": ("#a8351d", "#bb4423", "#241318"),   # di Suvero's minium red
    "corten":   ("#7a4326", "#8a4c26", "#1e1416"),   # weathering steel
    "limest":   ("#ded7c6", "#e6d2ad", "#242530"),   # Texas limestone plinth
    "white":    ("#eeeae1", "#f2e2c4", "#272833"),   # Kelly's white stone
    "granite":  ("#8e8b86", "#95877a", "#1e1f28"),   # dark plinth granite
    "steel":    ("#8d9198", "#8a7a68", "#1b1e26"),   # plain painted steel
    "wood":     ("#7a6046", "#7c583a", "#191b22"),
    # Ellsworth Kelly's coloured glass. The real "Austin" carries a colour
    # spectrum in its three window walls; these are the six that read from
    # outside. They are the ONLY saturated colours this bake emits.
    "gred":     ("#c8342c", "#d4452f", "#3a1418"),
    "gorange":  ("#dd7a1e", "#e88c22", "#3c2210"),
    "gyellow":  ("#e8c72a", "#f0d33a", "#3a3212"),
    "ggreen":   ("#2f9a58", "#3aa862", "#12301f"),
    "gblue":    ("#2b6fb5", "#3579bd", "#122238"),
    "gviolet":  ("#7b4ba8", "#8657b2", "#1f1430"),
}
GLASS_SPECTRUM = ["gviolet", "gblue", "ggreen", "gyellow", "gorange", "gred"]

PLINTH_H = 0.9          # a statue's own base, metres
PLINTH_INSET = 0.72     # plinth as a fraction of the footprint
SEG = 8                 # sides on anything round; 8 is where an octagon stops
                        # reading as an octagon at 60 m and costs half of 16


def to_m(lon, lat, lon0, lat0):
    return ((lon - lon0) * M_LAT * math.cos(math.radians(lat0)), (lat - lat0) * M_LAT)


def to_ll(x, y, lon0, lat0):
    return [round(lon0 + x / (M_LAT * math.cos(math.radians(lat0))), 7),
            round(lat0 + y / M_LAT, 7)]


class Build:
    """Collects extrusion parts in local metres about a piece's own centre."""

    def __init__(self, name, lon0, lat0):
        self.name, self.lon0, self.lat0 = name, lon0, lat0
        self.parts = []

    def add(self, ring_m, z0, z1, mat):
        if z1 - z0 < 0.02 or len(ring_m) < 3:
            return
        ring = [to_ll(x, y, self.lon0, self.lat0) for x, y in ring_m]
        if ring[0] != ring[-1]:
            ring.append(ring[0])
        self.parts.append({
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": [ring]},
            "properties": {"k": "artpart", "name": self.name, "m": mat,
                           "b": round(z0, 2), "h": round(z1, 2)},
        })

    # ── the vocabulary ────────────────────────────────────────────────
    def box(self, cx, cy, w, d, z0, z1, mat, rot=0.0):
        c, s = math.cos(rot), math.sin(rot)
        pts = [(-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2)]
        self.add([(cx + x * c - y * s, cy + x * s + y * c) for x, y in pts], z0, z1, mat)

    def disc(self, cx, cy, r, z0, z1, mat, seg=SEG):
        self.add([(cx + r * math.cos(2 * math.pi * i / seg),
                   cy + r * math.sin(2 * math.pi * i / seg)) for i in range(seg)],
                 z0, z1, mat)

    def dome(self, cx, cy, r, z0, h, mat, tiers=4, seg=SEG):
        """Stacked chords of a hemisphere. The only sphere fill-extrusion has."""
        for i in range(tiers):
            t0, t1 = i / tiers, (i + 1) / tiers
            rr = r * math.sqrt(max(0.0, 1.0 - ((t0 + t1) / 2) ** 2))
            self.disc(cx, cy, rr, z0 + h * t0, z0 + h * t1, mat, seg)

    def ball(self, cx, cy, r, zc, mat, tiers=6, seg=SEG):
        """A full sphere, centred at zc."""
        for i in range(tiers):
            t0 = -1.0 + 2.0 * i / tiers
            t1 = -1.0 + 2.0 * (i + 1) / tiers
            rr = r * math.sqrt(max(0.0, 1.0 - ((t0 + t1) / 2) ** 2))
            self.disc(cx, cy, rr, zc + t0 * r, zc + t1 * r, mat, seg)

    def beam(self, x0, y0, z0, x1, y1, z1, wide, mat, steps=6):
        """A LEANING member, as a short stack of offset slabs.

        fill-extrusion cannot tilt a face, so a diagonal is a staircase. Six
        steps is where the staircase stops reading as steps from the air and
        starts reading as a line, which is the whole job of a di Suvero beam.
        """
        for i in range(steps):
            t0, t1 = i / steps, (i + 1) / steps
            xm = x0 + (x1 - x0) * (t0 + t1) / 2
            ym = y0 + (y1 - y0) * (t0 + t1) / 2
            ang = math.atan2(y1 - y0, x1 - x0)
            seglen = math.hypot(x1 - x0, y1 - y0) / steps
            self.box(xm, ym, max(seglen * 1.35, wide), wide,
                     z0 + (z1 - z0) * t0, z0 + (z1 - z0) * t1, mat, rot=ang)

    def figure(self, cx, cy, z0, h, mat, wide=0.55):
        """A standing human figure, reduced to five stacked masses.

        Legs, hips, torso, shoulders, head. It is a person-shaped silhouette and
        nothing more, which at 60 m is all a statue is.
        """
        self.box(cx, cy, wide * 0.9, wide * 0.7, z0, z0 + h * 0.46, mat)
        self.box(cx, cy, wide * 1.05, wide * 0.8, z0 + h * 0.46, z0 + h * 0.56, mat)
        self.box(cx, cy, wide * 1.15, wide * 0.85, z0 + h * 0.56, z0 + h * 0.80, mat)
        self.box(cx, cy, wide * 1.45, wide * 0.8, z0 + h * 0.80, z0 + h * 0.86, mat)
        self.disc(cx, cy, wide * 0.42, z0 + h * 0.88, z0 + h * 1.0, mat)

    def plinth(self, w, d, mat="granite", h=PLINTH_H):
        self.box(0, 0, w, d, 0.0, h, mat)
        self.box(0, 0, w * 1.12, d * 1.12, 0.0, h * 0.22, mat)   # a base course
        return h


# ── THE SIZE TABLE ────────────────────────────────────────────────────
#
# THIS IS THE ROOT-CAUSE FIX AND IT IS WORTH READING BEFORE THE RECIPES.
#
# Simeon, 2026-08-02: "make monochrome for austin look better not like a silver
# tree. clock not looks like a fireplace and not big enough. I don't even want to
# check out the other landmarks PLEASE make them accurate to size and
# architecture." Size first, and he is right that it is first.
#
# Every recipe below used to scale off `hw`, `hd` and `H` handed in from
# props.geojson. Those three numbers carry NO information about the artwork.
# Print the source and it is obvious: every `at=statue` is 4.2 m on a 1.83 m
# footprint, every `at=sculpture` is 5.5 m on 3.17 m, every `at=installation` is
# 7.0 m on 4.81 m. They are CLASS DEFAULTS applied to a buffered OSM node -- the
# same shape for the armadillo and for the largest sculpture on campus. So no
# amount of care in a recipe could have produced a correct size, and ten
# hand-tuned multipliers would have been ten guesses at the same missing fact.
#
# Hence one table, consulted before any recipe runs, of published dimensions with
# their source. metres: (height, width, depth, provenance). `est` in the
# provenance means the figure is REASONED, not published, and says from what.
#
# The two he named are the two that were furthest out:
#   Monochrome for Austin   baked  7.0 m   real 15.24 m   —  46%
#   Clock Knot              baked  5.5 m   real 12.65 m   —  43%
DIMS = {
    "Monochrome for Austin": (15.24, 15.85, 12.50,
        "50 x 52 x 41 ft — Landmarks UT / CultureMap, the largest in the collection"),
    "Clock Knot":            (12.65,  6.60, 10.67,
        "498 x 260 x 420 in — Landmarks UT / Wikipedia"),
    "The West":              ( 1.52,  3.87,  1.52,
        "two 5 ft spheres, 12 ft 8 3/8 in overall — Metropolitan Museum"),
    "Circle with Towers":    ( 4.27,  7.82,  7.82,
        "14 ft towers, 25 ft 8 in ring — Landmarks UT / news.utexas.edu"),
    "Austin":                ( 8.03, 18.29, 22.25,
        "60 x 73 x 26 ft 4 in, 2,715 sq ft — Wikipedia / Blanton"),
    "Mustangs":              ( 4.30, 11.00,  4.40,
        "est — seven LIFE-SIZE horses; 9 tons of bronze cast hollow is ~100 m2 "
        "of surface and one life-size horse is ~10, so the count and the weight "
        "agree on life size. Plinth is estimated."),
    "The Torchbearers":      ( 4.60,  3.90,  2.40,
        "est — 'larger than life' is the only published scale note; two figures "
        "with a torch passed between them cannot fit a 1.83 m buffered node"),
    "Diana the Huntress":    ( 4.40,  1.90,  1.90,
        "est — Huntington's 'Diana of the Chase', a LIFE-SIZE figure balanced on "
        "a globe with a hound; pedestal estimated from courtyard photographs"),
    "Sea Turtle":            ( 1.00,  1.80,  1.60,
        "est — a bronze animal is animal-sized. It was baked at the props file's "
        "4.2 m statue default, which is a turtle the size of a minibus."),
    "Lone Star":             ( 3.50,  2.70,  0.60,
        "est — no published dimension found; a standing star marker, sized so a "
        "person reads as two thirds of it"),
}


# ── per-piece recipes ─────────────────────────────────────────────────
#
# Each takes the builder, the footprint half-size in metres and the piece's
# height. When DIMS has an entry those three are the REAL work's, not the
# buffered node's. Keyed on the exact `name` in props.geojson.

def art_monochrome(b, hw, hd, H):
    """Nancy Rubins, "Monochrome for Austin", 2015 — 70 aluminium canoes and
    small boats bolted to a steel armature, at 24th and Speedway.

    TWO THINGS WERE WRONG AND ONLY ONE OF THEM WAS SIZE.

    Size: 50 x 52 x 41 ft is 15.24 m tall and 15.85 m wide, and it is the
    largest sculpture in the Landmarks collection. It was baked 7 m tall on a
    4.8 m footprint — under half — so in `shots/art/monochrome-close.png` it
    stands shorter than the live oaks either side of it. That alone is most of
    why it did not read as the thing you are meant to be looking at.

    Shape: the old recipe put fourteen slabs on ONE ORIGIN at even angles with
    alternating lengths. A single origin plus even angles is a daisy, and a
    daisy on a post is a tree — which is exactly the word he used. The real work
    is a LOPSIDED mass CANTILEVERED off its mast: the hulls cluster to one side
    and above, they share no common origin, and the armature leans back against
    the load. So the cloud here has a centre that is not the mast, thirty hulls
    each with their own position and heading, and a back-stay that exists only
    on the light side. Nothing about it is symmetrical, which is the point.

    A hull is 3.4–5.3 m long and 0.82 m in the beam — canoe and small-boat
    dimensions rather than a chosen slab size.
    """
    W, D = hw * 2, hd * 2
    b.disc(0, 0, 1.30, 0.0, 0.55, "granite", seg=10)
    mast_top = H * 0.46
    b.box(0, 0, 0.85, 0.85, 0.0, mast_top, "steel")
    b.beam(0, 0, mast_top * 0.55, -W * 0.20, -D * 0.17, mast_top * 1.05,
           0.40, "steel", steps=4)                       # the back-stay
    b.beam(0, 0, mast_top, W * 0.13, D * 0.04, H * 0.74,
           0.46, "steel", steps=4)                       # the cantilever arm

    # The cloud. Centre is offset from the mast in +x, which is what makes the
    # mass lopsided rather than merely irregular.
    cx, cy, cz = W * 0.24, D * 0.02, H * 0.60
    ex, ey, ez = W * 0.34, D * 0.44, H * 0.36
    for i in range(32):
        u, v, w = hash01("rubins", 3 * i + 1), hash01("rubins", 3 * i + 2), hash01("rubins", 3 * i + 3)
        rr = 0.42 + 0.58 * u                 # biased outward: a shell of hulls
        th, ph = 2 * math.pi * v, math.acos(1 - 2 * w)
        px = cx + ex * rr * math.sin(ph) * math.cos(th)
        py = cy + ey * rr * math.sin(ph) * math.sin(th)
        pz = cz + ez * rr * math.cos(ph)

        a = 2 * math.pi * hash01("hull", 2 * i + 1)
        el = (hash01("hull", 2 * i + 2) - 0.45) * 1.6
        L = 3.4 + 1.9 * hash01("hulllen", i)
        dx = L * 0.5 * math.cos(el) * math.cos(a)
        dy = L * 0.5 * math.cos(el) * math.sin(a)
        dz = L * 0.5 * math.sin(el)
        if dz < 0:                                       # beam() needs z0 < z1
            dx, dy, dz = -dx, -dy, -dz
        # A LEVEL HULL HAS NO HEIGHT and add() drops a zero-height slab without
        # a word — the same trap that reported 0 features for the plant pipe run
        # (HANDOFF §51). A hull is 0.55 m deep, so that is the floor.
        z0, z1 = pz - dz, pz + dz
        if z1 - z0 < 0.55:
            z0, z1 = pz - 0.28, pz + 0.28
        if z0 < 0.7:
            z1 += 0.7 - z0
            z0 = 0.7
        b.beam(px - dx, py - dy, z0, px + dx, py + dy, z1,
               0.82, "mirror" if i % 4 == 0 else "alum", steps=3)

    # Five OUTRIGGERS, placed rather than sampled. A cloud of 32 random hulls
    # almost never reaches its own envelope — measured, it came back 12.8 m wide
    # against the published 15.85 — and the real work is spiky: individual hulls
    # jut clear of the mass, which is what makes the silhouette read as boats
    # rather than as a lump. These are the ones that set the outline.
    for x0, y0, z0, x1, y1, z1 in (
            (cx + 1.4, cy - 1.0, cz - 1.4, W * 0.52, -D * 0.20, cz + 2.2),
            (cx - 1.0, cy + 0.8, cz - 0.6, -W * 0.24, D * 0.40, cz + 3.1),
            (cx + 0.4, cy - 0.6, cz + 1.0, cx + 2.6, -D * 0.46, cz + 4.3),
            (cx - 0.2, cy + 0.5, cz + 1.6, cx + 1.1, D * 0.44, H - 0.25),
            (cx + 1.8, cy + 0.2, cz - 2.6, cx + 3.4, cy - 1.6, cz + 0.4)):
        b.beam(x0, y0, z0, x1, y1, z1, 0.82, "alum", steps=4)


def art_clockknot(b, hw, hd, H):
    """Mark di Suvero, "Clock Knot", 2007 — painted steel, on Dean Keeton.

    498 x 260 x 420 in = 12.65 m tall. It was baked at 5.5 m, so "not big
    enough" was an understatement: it stood at 43% of height.

    THE ARCHITECTURE, from Landmarks' own description rather than from a glance
    at a photograph: crossed I-beams and a circular knotted centre reading as a
    clock face, with beams running 11:00–5:00, 12:00–6:00 and 1:00–7:00 and a
    horizontal clock hand extending to the left — and, crucially, "as one moves
    round the work what had been read as a vertical beam from 12:00 to 6:00
    shows itself to be one leg of an INVERTED V". That last clause is the whole
    silhouette: an acute apex high up, legs splaying wide to the ground.

    The old recipe was three legs at even angles meeting low, with a horizontal
    member across the top, standing on a slab the width of the footprint. That
    is a mantel over a hearth on a hearthstone, and "fireplace" is a fair
    description of it. Three things change: the apex goes to 10.4 m and gets
    acute, the hearthstone becomes three small pads under three feet, and the
    top member stops being horizontal-across and becomes the ring plus the hand.
    """
    ax, ay, az = 0.30, 0.10, H * 0.82        # the apex
    # 0.68 m members, not 0.52. A 12.65 m di Suvero I-beam is 0.6-0.75 m deep,
    # and at 0.52 the contact sheet read it as a spindly tripod rather than as
    # steel. Measured on the sheet before changing it.
    feet = [(-hw * 0.97, -0.60, 0.68),       # the inverted V, splayed in x
            ( hw * 0.95,  0.75, 0.68),
            ( 0.10, -hd * 0.79, 0.60)]       # the third leg, raking back in y
    for fx, fy, wide in feet:
        b.box(fx, fy, 1.05, 1.05, 0.0, 0.28, "granite")
        b.beam(fx, fy, 0.20, ax, ay, az, wide, "steelred", steps=7)
    # The beam that carries on THROUGH the knot to full height — this is what
    # makes the apex acute instead of a tripod's blunt top.
    b.beam(ax, ay, az, ax - 1.15, ay + 0.70, H, 0.58, "steelred", steps=3)
    # The knot: three short members crossing at the apex, plus the disc that
    # reads as the clock face from the air.
    for i in range(3):
        t = math.pi * i / 3
        b.beam(ax - 1.5 * math.cos(t), ay - 1.5 * math.sin(t), az - 0.9,
               ax + 1.5 * math.cos(t), ay + 1.5 * math.sin(t), az + 0.9,
               0.48, "steelred", steps=3)
    b.disc(ax, ay, 1.60, az - 0.30, az + 0.30, "steelred", seg=12)
    # The hand: a long near-level member reaching out at high level. Written
    # low-end-first so beam() gets z0 < z1.
    b.beam(ax - 0.10, hd * 0.98, az - 2.55, ax + 0.15, ay + 0.55, az - 1.45,
           0.58, "steelred", steps=6)


def art_thewest(b, hw, hd, H):
    """Donald Lipski, "The West" — TWO spherical buoys skinned in corroded
    copper pennies, lent by the Metropolitan Museum, east of the COM building.

    Each sphere is 5 ft across and the pair measures 12 ft 8 3/8 in overall, so
    the work stands 1.52 m and SITS ON THE GRASS. The bake had it as one
    mirror-polished 4.5 m ball on a stem inside a steel ring: three times too
    tall, the wrong count, the wrong material, and a ring the work does not
    have. Simeon's own note — "pretty sure thats supposed to be balls of texas"
    — was a better reading of it than this file's was.

    Pennies corrode brown and green, so `corten` rather than `mirror`. Twelve
    sides and eight tiers because at 1.5 m a coarse ball is visibly a barrel.
    """
    r = 1.524 / 2
    sep = 3.871 / 2 - r          # the offset that reproduces the published span
    for s in (-1, 1):
        b.ball(s * sep, 0.0, r, r, "corten", tiers=8, seg=12)


def art_diana(b, hw, hd, H):
    """Anna Hyatt Huntington, "Diana of the Chase" (1922), in a UT courtyard.

    The published description is specific and the old recipe matched none of it:
    a life-size figure BALANCED ON AN EARTHLY GLOBE, bow held ALOFT in the left
    hand, right arm bent as though the arrow has just gone, and a HOUND SPRINGING
    UP beside her with its forelegs in the air. What was baked was a figure on a
    slab with a vertical bar beside it at shoulder height — the bow at the wrong
    height, in the wrong hand's place, and no globe and no hound at all.

    4.4 m overall is estimated: 1.5 m pedestal + 0.85 m globe + a 1.72 m figure
    + the bow above her head. Only the pedestal is a guess.
    """
    ped = 1.50
    b.box(0, 0, 1.30, 1.30, 0.0, ped, "granite")
    b.box(0, 0, 1.55, 1.55, 0.0, 0.22, "granite")            # base course
    gr = 0.42
    b.ball(0, 0, gr, ped + gr, "bronze", tiers=6, seg=12)    # the earthly globe
    fz = ped + gr * 2
    b.figure(0, 0, fz, 1.72, "bronze", wide=0.52)
    # The bow, held ALOFT: an arc above and left of her head, drawn as a stack
    # rather than a bar so it curves.
    for i in range(5):
        t = -0.9 + 0.45 * i
        b.box(-0.34 - 0.16 * math.cos(t), 0.0, 0.16, 0.14,
              fz + 0.95 + 0.22 * i, fz + 0.95 + 0.22 * (i + 1), "bronze")
    b.beam(0.0, 0.0, fz + 1.22, -0.36, 0.0, fz + 1.38, 0.17, "bronze", steps=2)
    # The hound, forelegs in the air beside her.
    b.beam(0.62, -0.30, ped * 0.30, 0.30, 0.10, ped * 0.30 + 0.95,
           0.30, "bronze", steps=4)
    b.box(0.72, -0.42, 0.30, 0.26, 0.0, ped * 0.32, "bronze")


def art_austin(b, hw, hd, H):
    """Ellsworth Kelly, "Austin", 2018 — the Blanton's stone chapel.

    "check if the glass u added to the ellsworth building matches it irl". It
    did not, and neither did the building under it.

    THE MASSING IS A CROSS, and that is a DERIVATION, not a guess. The published
    figures are 60 x 73 x 26 ft 4 in with 2,715 sq ft of floor. Those three
    numbers only agree with each other if the plan is cruciform: 18.29 x 22.25 m
    as a rectangle is 407 m2 = 4,380 sq ft, half again too much, while a cross
    of the same overall size with 7.72 m arms is 254 m2 = 2,733 sq ft — the
    published figure to within 0.7%. So the arm width is not chosen, it is
    solved for. And a cross plan is what produces the DOUBLE barrel vault the
    building is known for: one vault per arm, crossing over the middle. The old
    bake drew a single 18.3 x 8.2 m box under a single vault, having read the
    8.03 m HEIGHT as a depth.

    THE THREE WINDOWS, AND TWO OF THEM WERE ON THE WRONG WALL. Kelly's motifs
    are the "colour grid" (a three-by-three lattice of squares), "tumbling
    squares" (the same squares rotated around a circle) and the "starburst"
    (the tumbling squares elongated into narrow streaks), and they are on the
    SOUTH, EAST and WEST walls in that order. The bake had six tall spectrum
    lights on the east — a window this building does not have — and the ring of
    squares on the west, where the streaks belong.

    THE CHECK THAT THIS READING IS RIGHT RATHER THAN MERELY PLAUSIBLE:
    3x3 + 12 + 12 = 33, and 33 is the published count of mouth-blown Franz Mayer
    windows. A reading that lands on the total by accident is unlikely; one that
    does not land on it is wrong. This one lands on it.

    fill-extrusion cannot glaze a wall and cannot tilt a face, so every panel is
    its own prism standing proud of the stone, and anything diagonal inside a
    wall plane — a starburst ray, a tumbled square — is a short stack that steps
    across and up together.
    """
    W, Dp = 18.29, 22.25                 # E–W overall, N–S overall
    ARM = 7.72                           # solved from the 2,715 sq ft floor area
    H = 8.03
    wall_h = 5.35
    hx, hy = W / 2, Dp / 2

    # The cross, as two solid stone volumes. They interpenetrate; both are the
    # same material, so the shared interior faces cannot show a seam.
    b.box(0, 0, ARM, Dp, 0.0, wall_h, "white")
    b.box(0, 0, W, ARM, 0.0, wall_h, "white")
    # TWO barrel vaults, one along each arm, crossing over the middle. Chords of
    # a circle: each tier keeps its arm's LENGTH and loses width, which is what
    # makes it a barrel rather than a dome.
    rise, tiers = H - wall_h, 7
    for i in range(tiers):
        f0, f1 = i / tiers, (i + 1) / tiers
        k = math.sqrt(max(0.0, 1.0 - ((f0 + f1) / 2) ** 2))
        b.box(0, 0, ARM * k, Dp, wall_h + rise * f0, wall_h + rise * f1, "white")
        b.box(0, 0, W, ARM * k, wall_h + rise * f0, wall_h + rise * f1, "white")

    prd = 0.34                           # how far a panel stands proud of stone

    # SOUTH — THE COLOUR GRID. Three by three, upright squares, evenly spaced.
    sq, gap, z0 = 1.25, 1.72, 1.15
    for r in range(3):
        for c in range(3):
            b.box((c - 1) * gap, -hy - prd / 2, sq, prd,
                  z0 + r * (sq + 0.20), z0 + r * (sq + 0.20) + sq,
                  GLASS_SPECTRUM[(r * 3 + c) % len(GLASS_SPECTRUM)])

    # EAST — TUMBLING SQUARES. The same squares, rotated around a circle. A
    # square rotated by t in a VERTICAL plane cannot be rotated by
    # fill-extrusion, so each one is three stacked bars following the exact
    # width profile of a rotated square: full width across the middle band,
    # tapering to the vertex above and below. At t=0 that is a square; at 45
    # degrees it is a diamond; the ring runs through every angle between.
    # Sized so the whole motif stays on the STONE: the ring's outer reach is
    # ring_r + the rotated square's half-diagonal, and that has to clear 0 below
    # and wall_h above or squares float in the vault and sink into the plaza.
    ring_r, s2, zc = 1.72, 0.90, 2.85
    for i in range(12):
        a = 2 * math.pi * i / 12
        y = ring_r * math.sin(a)
        z = zc + ring_r * math.cos(a)
        c_, d_ = abs(math.cos(a)), abs(math.sin(a))
        hh = (s2 / 2) * (c_ + d_)                    # half-height AND half-width
        flat = (s2 / 2) * abs(c_ - d_)               # the full-width band
        mat = GLASS_SPECTRUM[i % len(GLASS_SPECTRUM)]
        for t in (-hh * 0.66, 0.0, hh * 0.66):
            w = hh if abs(t) <= flat else max(0.12, hh - (abs(t) - flat))
            b.box(hx + prd / 2, y, prd, w * 2, z + t - hh / 3, z + t + hh / 3, mat)

    # WEST — THE STARBURST. Twelve narrow streaks radiating from a centre. Each
    # ray steps outward in y and z together, which is the only way a diagonal
    # exists on a wall made of prisms.
    r0, r1, wide, zc2 = 0.45, 2.30, 0.30, 2.85
    for i in range(12):
        a = 2 * math.pi * i / 12 + math.pi / 12
        mat = GLASS_SPECTRUM[i % len(GLASS_SPECTRUM)]
        for s in range(3):
            t0 = r0 + (r1 - r0) * s / 3
            t1 = r0 + (r1 - r0) * (s + 1) / 3
            y0, z0r = t0 * math.sin(a), t0 * math.cos(a)
            y1, z1r = t1 * math.sin(a), t1 * math.cos(a)
            ym, zm = (y0 + y1) / 2, (z0r + z1r) / 2
            dy = max(abs(y1 - y0) + wide * 0.5, wide)
            dz = max(abs(z1r - z0r) + wide * 0.5, wide)
            b.box(-hx - prd / 2, ym, prd, dy, zc2 + zm - dz / 2, zc2 + zm + dz / 2, mat)


def art_turtle(b, hw, hd, H):
    """"Sea Turtle" — a bronze animal, and an animal is animal-sized.

    Baked at 4.2 m, which is the props file's class default for `at=statue` and
    is a turtle the size of a minibus standing on a 2 m plinth. No published
    dimension was found, so 1.6 m of carapace on a 0.4 m limestone base is
    ESTIMATED — from the animal, which is the one measurement nobody has to
    look up. Flippers rather than four boxes at the corners: a turtle's are
    long, forward-swept and are most of its plan silhouette.
    """
    ph = 0.40
    b.box(0, 0, 1.50, 1.30, 0.0, ph, "limest")
    b.box(0, 0, 1.70, 1.50, 0.0, 0.12, "limest")
    r = 0.66
    b.dome(0, 0, r, ph, 0.60, "bronze", tiers=3, seg=12)          # the carapace
    b.disc(0, r * 0.95, r * 0.30, ph + 0.06, ph + 0.34, "bronze", seg=8)   # head
    for sx, sy, ang in ((1, 0.55, 0.75), (-1, 0.55, -0.75), (1, -0.62, -0.7), (-1, -0.62, 0.7)):
        b.box(sx * r * 0.82, sy * r, 0.72, 0.26, ph + 0.02, ph + 0.18, "bronze",
              rot=ang * sx)


def art_mustangs(b, hw, hd, H):
    """A. Phimister Proctor, "The Seven Mustangs", 1948 — nine tons of bronze in
    front of the Texas Memorial Museum.

    SEVEN horses, not the three the bake drew, and LIFE-SIZE. The overall
    dimensions are not published, but the weight settles the scale: nine tons of
    bronze cast hollow at a normal wall thickness is on the order of a hundred
    square metres of surface, and one life-size horse is about ten. Seven of
    them is the answer, and the count is in the title. The plinth (11.0 x 4.4 x
    1.05) is estimated.

    A horse is legs, a barrel, a raking neck and a head — nine parts. The old
    recipe gave each of three horses a body box, two legs and a lump, which from
    any angle was three tables.
    """
    ph = 1.05
    b.box(0, 0, 11.0, 4.40, 0.0, ph, "granite")
    b.box(0, 0, 11.4, 4.75, 0.0, 0.22, "granite")

    def horse(x, y, rot, s):
        c, sn = math.cos(rot), math.sin(rot)
        def P(u, v):
            return (x + u * s * c - v * s * sn, y + u * s * sn + v * s * c)
        leg = 1.30 * s
        for u, v in ((0.80, 0.30), (0.80, -0.30), (-0.74, 0.30), (-0.74, -0.30)):
            px, py = P(u, v)
            b.box(px, py, 0.26 * s, 0.26 * s, ph, ph + leg, "bronze", rot=rot)
        bx, by = P(0, 0)
        b.box(bx, by, 2.15 * s, 0.74 * s, ph + leg, ph + leg + 0.95 * s, "bronze", rot=rot)
        nx, ny = P(1.08, 0)
        b.beam(bx + (nx - bx) * 0.25, by + (ny - by) * 0.25, ph + leg + 0.68 * s,
               nx, ny, ph + leg + 1.52 * s, 0.44 * s, "bronze", steps=2)
        hx, hy = P(1.36, 0)
        b.box(hx, hy, 0.64 * s, 0.32 * s,
              ph + leg + 1.40 * s, ph + leg + 1.78 * s, "bronze", rot=rot)
        tx, ty = P(-1.22, 0)
        b.box(tx, ty, 0.32 * s, 0.24 * s,
              ph + leg + 0.28 * s, ph + leg + 0.95 * s, "bronze", rot=rot)

    # A herd, not a rank: the headings fan and the colt is small.
    for x, y, rot, s in ((-4.30, -0.55, 0.16, 1.00), (-2.65, 0.62, -0.10, 1.05),
                         (-0.95, -0.45, 0.24, 0.98), (0.55, 0.70, -0.06, 1.06),
                         (2.05, -0.60, 0.18, 1.00), (3.55, 0.45, -0.14, 0.96),
                         (4.75, -0.75, 0.30, 0.72)):
        horse(x, y, rot, s)


def art_circletowers(b, hw, hd, H):
    """Sol LeWitt, "Circle with Towers", 2012 — concrete block, at the Gates
    Computer Science complex.

    A low circular WALL 25 ft 8 in across (7.82 m) punctuated by EIGHT towers
    14 ft high (4.27 m). The bake had a 3 m ring — under half the diameter —
    with sixteen extra posts between the towers, and sixteen posts turn a wall
    into a colonnade, which is the opposite of what LeWitt built. The ring is
    now 32 short tangential segments that overlap into a continuous wall.

    The wall height is the one figure not published: 1.35 m is read off the
    photographs against the 4.27 m towers, and is generative.

    `granite` and not `limest`, because concrete masonry is grey and the pale
    cream read as a limestone folly.
    """
    R, seg = 7.82 / 2, 32
    wall_h, wall_t = 1.35, 0.40
    for i in range(seg):
        a = 2 * math.pi * (i + 0.5) / seg
        b.box(R * math.cos(a), R * math.sin(a),
              (2 * math.pi * R / seg) * 1.30, wall_t, 0.0, wall_h, "granite",
              rot=a + math.pi / 2)
    for i in range(8):
        a = 2 * math.pi * i / 8
        b.box(R * math.cos(a), R * math.sin(a), 0.84, 0.84, 0.0, 4.27, "granite", rot=a)


def art_torchbearers(b, hw, hd, H):
    """Charles Umlauf, "The Torchbearers", 1962 — two larger-than-life bronze
    runners passing a torch, outside the Flawn Academic Center.

    "Larger than life" is the only published scale note, so 4.6 m over a 1.35 m
    base with the figures 2.7 m apart is ESTIMATED — but two figures with a
    torch handed between them cannot occupy the 1.83 m buffered node the props
    file carries, whatever the exact figure is. The torch gets a flame, which is
    the one detail that makes the gesture legible from above.
    """
    ph = 1.35
    b.box(0, 0, 3.90, 2.40, 0.0, ph, "granite")
    b.box(0, 0, 4.25, 2.75, 0.0, 0.24, "granite")
    b.figure(-1.35, -0.15, ph, 2.90, "bronze", wide=0.60)
    b.figure(1.35, 0.20, ph, 2.75, "bronze", wide=0.58)
    # The arms, reaching toward each other, and the torch between them.
    b.beam(-1.35, -0.15, ph + 2.20, -0.30, 0.0, ph + 2.62, 0.20, "bronze", steps=3)
    b.beam(1.35, 0.20, ph + 2.10, 0.28, 0.05, ph + 2.55, 0.20, "bronze", steps=3)
    b.box(0.0, 0.02, 0.22, 0.22, ph + 2.55, ph + 3.05, "bronze")
    b.disc(0.0, 0.02, 0.30, ph + 3.05, ph + 3.25, "bronze", seg=8)


def art_lonestar(b, hw, hd, H):
    """A five-pointed Texas star, standing on edge.

    THE OLD RECIPE DREW ALMOST NOTHING AND SAID SO TO NOBODY. Of its fifteen
    calls, five were `beam(0,0,cz -> 0,0,cz)` — no length and no height — five
    were boxes from `cz` to `cz`, and of the five arms only the two with a
    positive vertical component survived, because `beam()` spreads z0..z1 across
    its steps and `add()` silently drops anything under 2 cm tall. Three of the
    five points of a five-pointed star were never in the file. Same failure as
    the plant pipe run in HANDOFF §51, and it is invisible in a screenshot
    because what is left still looks like a shape.

    Drawn properly: each arm is a stack stepping outward and up or DOWN, with
    the width tapering to the tip, and the core is a disc. 3.5 m overall is
    estimated — no dimension was found for this piece.
    """
    base = 0.95
    b.box(0, 0, 1.35, 1.10, 0.0, base, "granite")
    R, cz, wide = 1.30, base + 1.30, 0.62
    b.disc(0, 0, 0.52, cz - 0.52, cz + 0.52, "bronze", seg=10)
    for i in range(5):
        a = math.pi / 2 + 2 * math.pi * i / 5      # a point straight up
        for s in range(3):
            t0, t1 = R * s / 3, R * (s + 1) / 3
            # The star plane runs EAST-WEST. It ran north-south, which is
            # edge-on from the direction this app is usually flown, and a star
            # seen edge-on is a post -- which is what the contact sheet showed.
            x0, z0 = t0 * math.cos(a), t0 * math.sin(a)
            x1, z1 = t1 * math.cos(a), t1 * math.sin(a)
            xm, zm = (x0 + x1) / 2, (z0 + z1) / 2
            w = wide * (1.0 - 0.75 * (s + 0.5) / 3)
            dx = max(abs(x1 - x0) + w * 0.5, w)
            dz = max(abs(z1 - z0) + w * 0.5, w)
            b.box(xm, 0.0, dx, 0.34, cz + zm - dz / 2, cz + zm + dz / 2, "bronze")


RECIPES = {
    "Monochrome for Austin": art_monochrome,
    "Clock Knot": art_clockknot,
    "The West": art_thewest,
    "Diana the Huntress": art_diana,
    "Austin": art_austin,
    "Sea Turtle": art_turtle,
    "Mustangs": art_mustangs,
    "Circle with Towers": art_circletowers,
    "The Torchbearers": art_torchbearers,
    "Lone Star": art_lonestar,
}


# ── the rule, for everything without a recipe ─────────────────────────
#
# 24 of the 34 pieces are not famous enough that anyone would notice their exact
# silhouette, and inventing one for each would be 24 fictions. What they DO need
# is to stop being identical. So the `at` tag drives a form, and the name drives
# a deterministic seed so two neighbouring sculptures are not twins.
def hash01(s, salt=0):
    x = salt * 2654435761 + 2166136261
    for ch in s:
        x = ((x ^ ord(ch)) * 16777619) & 0xFFFFFFFF
    return ((x ^ (x >> 15)) & 0xFFFFFFFF) / 0xFFFFFFFF


def generic(b, name, at, hw, hd, H):
    r1, r2, r3 = hash01(name, 1), hash01(name, 2), hash01(name, 3)
    if at == "mural":
        # A mural is a wall, not an object: a thin tall panel on its long axis.
        b.box(0, 0, hw * 1.9, 0.35, 0.0, H, "limest")
        return "mural"
    if at == "statue":
        ph = b.plinth(hw * 1.15, hd * 1.15, "granite", 0.85 + 0.3 * r1)
        b.figure(0, 0, ph, H - ph, "bronze", wide=0.46 + 0.16 * r2)
        return "statue"
    if at == "installation":
        # A cluster of masts at mixed heights — the generic "an installation
        # happens here" that reads as deliberate rather than as a box.
        for i in range(5):
            a = 2 * math.pi * (i + r1) / 5
            d = min(hw, hd) * (0.35 + 0.5 * hash01(name, 10 + i))
            b.disc(d * math.cos(a), d * math.sin(a), 0.26,
                   0.0, H * (0.45 + 0.55 * hash01(name, 20 + i)), "steel")
        b.disc(0, 0, min(hw, hd) * 0.9, 0.0, 0.3, "granite", seg=10)
        return "installation"
    # sculpture, building, or untagged: an abstract standing form. A tapered
    # stack with an offset upper mass reads as "an object somebody made".
    mat = ["corten", "steel", "bronzed", "alum"][int(r3 * 4) % 4]
    ph = b.plinth(hw * 1.05, hd * 1.05, "granite", 0.5 + 0.35 * r1)
    lean = (r2 - 0.5) * hw * 0.5
    b.box(0, 0, hw * (0.9 + 0.3 * r1), hd * 0.55, ph, ph + (H - ph) * 0.55, mat)
    b.box(lean, hd * 0.12, hw * (0.55 + 0.3 * r2), hd * 0.42,
          ph + (H - ph) * 0.55, ph + (H - ph) * 0.9, mat)
    b.disc(lean * 1.4, hd * 0.2, min(hw, hd) * (0.22 + 0.16 * r3),
           ph + (H - ph) * 0.9, H, mat)
    return "sculpture"


# ── The power plant yard behind the Drama Building ────────────────────
#
# "the area that looks like it has construction behind drama building that
# circular area has stuff find it and add it"
#
# WHAT IT ACTUALLY IS, worked out before modelling anything. Directly north of
# the F. Loren Winship Drama Building the snapshot carries `Hal C. Weaver Power
# Plant` (3,169 m2, 21.4 m), its Annex, `Cooling Tower 1` (714 m2, 11.6 m) and
# `UTM Cooling Tower 2` (400 m2, 16.0 m). That is UT's chilled-water plant. It
# renders as four plain boxes on a large bare tan yard, which is exactly what
# "looks like it has construction" describes -- and the circular things are the
# FAN STACKS on top of the cooling towers, which is what a cooling tower is from
# the air: a rectangular cell with two or three big round fan decks on its roof.
#
# So this is not a construction site to be cleared. It is working plant that was
# never drawn. Fan stacks, the handrail band round each roof, storage tanks and
# a pipe run between them.
#
# The stacks are drawn TALLER than they are, and darker than the roof they stand
# on. At true proportions a 2.5 m fan deck on a 16 m tower is a few pixels from
# any altitude this app flies, and grey-on-grey it registered as nothing at all
# in the first render. Same declared over-scale as the lane markings and the
# fountain risers: the thing that has to survive is that you can tell there is
# plant up there.
PLANT = {
    # name in the snapshot -> (roof height, n fan stacks, stack radius, rise)
    "Cooling Tower 1":     (11.6, 3, 2.8, 3.6),
    "UTM Cooling Tower 2": (16.0, 2, 3.0, 4.0),
}
PLANT_TANKS = [
    # (lon, lat, radius, height) — in the yard between the plant and the towers
    (-97.734620, 30.286600, 3.4, 7.5),
    (-97.734480, 30.286530, 2.6, 6.0),
    (-97.734740, 30.286480, 2.2, 5.2),
]
PLANT_RAIL_H = 1.1       # the handrail band that tops every industrial roof


def bake_plant(b_for, snap_feats, stats):
    """Fan stacks, tanks and pipework for the chilled-water plant."""
    out = []
    for f in snap_feats:
        nm = str(f["properties"].get("name") or "")
        if nm not in PLANT:
            continue
        roof, n, r, rise = PLANT[nm]
        gm = f["geometry"]
        ring = gm["coordinates"][0] if gm["type"] == "Polygon" else gm["coordinates"][0][0]
        lon0 = sum(x for x, _ in ring[:-1]) / max(1, len(ring) - 1)
        lat0 = sum(y for _, y in ring[:-1]) / max(1, len(ring) - 1)
        pm = [to_m(x, y, lon0, lat0) for x, y in ring]

        # THE FOOTPRINT'S OWN AXIS, not its bounding box. Both cooling towers
        # are long thin rectangles rotated about 20 degrees, and sizing from an
        # axis-aligned bbox put the handrail as a box visibly larger than the
        # building and threw the fan stacks clean off the roof into the yard.
        # A bbox is only the shape when the shape is axis-aligned.
        best, ax, ay = 0.0, 1.0, 0.0
        for (x0, y0), (x1, y1) in zip(pm, pm[1:]):
            L = math.hypot(x1 - x0, y1 - y0)
            if L > best:
                best, ax, ay = L, (x1 - x0) / L, (y1 - y0) / L
        cx0 = sum(x for x, _ in pm[:-1]) / max(1, len(pm) - 1)
        cy0 = sum(y for _, y in pm[:-1]) / max(1, len(pm) - 1)
        # Extent along that axis and across it, measured on the ring itself.
        along = [(x - cx0) * ax + (y - cy0) * ay for x, y in pm]
        across = [-(x - cx0) * ay + (y - cy0) * ax for x, y in pm]
        halfL = (max(along) - min(along)) / 2
        halfW = (max(across) - min(across)) / 2
        rr = min(r, halfW * 0.82)          # a stack cannot be wider than the cell

        b = Build(nm, lon0, lat0)
        for i in range(n):
            t = (i + 0.5) / n - 0.5
            d = t * (halfL * 2 * 0.78)
            cx, cy = cx0 + d * ax, cy0 + d * ay
            b.disc(cx, cy, rr, roof, roof + rise, "bronzed", seg=12)
            b.disc(cx, cy, rr * 0.78, roof + rise, roof + rise + 0.5, "alum", seg=12)
        # The handrail: four slabs laid along the footprint's OWN edges, so it
        # sits on the roof it belongs to whatever angle that roof is at.
        for sgn in (1, -1):
            b.box(cx0 + sgn * (halfW - 0.2) * -ay, cy0 + sgn * (halfW - 0.2) * ax,
                  halfL * 2, 0.4, roof, roof + PLANT_RAIL_H, "steel",
                  rot=math.atan2(ay, ax))
            b.box(cx0 + sgn * (halfL - 0.2) * ax, cy0 + sgn * (halfL - 0.2) * ay,
                  0.4, halfW * 2, roof, roof + PLANT_RAIL_H, "steel",
                  rot=math.atan2(ay, ax))
        out.extend(b.parts)
        stats["plant_" + nm.replace(" ", "_")] += len(b.parts)

    for lon, lat, r, h in PLANT_TANKS:
        b = Build("Chilled Water Plant", lon, lat)
        b.disc(0, 0, r, 0.0, h, "alum", seg=12)
        b.disc(0, 0, r * 1.06, 0.0, 0.5, "granite", seg=12)      # the plinth
        b.disc(0, 0, r * 0.55, h, h + 0.6, "steel", seg=10)      # the top vent
        out.extend(b.parts)
        stats["plant_tank"] += len(b.parts)

    # A pipe run linking the tanks, at gantry height. Industrial sites read by
    # their pipework more than by their vessels.
    if len(PLANT_TANKS) >= 2:
        b = Build("Chilled Water Plant", PLANT_TANKS[0][0], PLANT_TANKS[0][1])
        for (l0, a0, _, _), (l1, a1, _, _) in zip(PLANT_TANKS, PLANT_TANKS[1:]):
            x0, y0 = to_m(l0, a0, PLANT_TANKS[0][0], PLANT_TANKS[0][1])
            x1, y1 = to_m(l1, a1, PLANT_TANKS[0][0], PLANT_TANKS[0][1])
            # A LEVEL run still needs thickness: beam() spreads z0..z1 across
            # its steps, so a pipe from 4.6 to 4.6 is a stack of zero-height
            # slabs and add() drops every one of them. It reported 0 features.
            b.beam(x0, y0, 4.6, x1, y1, 5.15, 0.55, "steel", steps=3)
        out.extend(b.parts)
        stats["plant_pipes"] += len(b.parts)
    return out


def main():
    src = json.load(open(SRC, encoding="utf-8"))
    feats, stats, authored = [], Counter(), []

    for f in src["features"]:
        p = f["properties"]
        if p.get("k") != "art":
            continue
        name = p.get("name") or ""
        ring = f["geometry"]["coordinates"][0]
        lon0 = sum(x for x, _ in ring[:-1]) / max(1, len(ring) - 1)
        lat0 = sum(y for _, y in ring[:-1]) / max(1, len(ring) - 1)
        xs = [to_m(x, y, lon0, lat0)[0] for x, y in ring]
        ys = [to_m(x, y, lon0, lat0)[1] for x, y in ring]
        hw = max(0.7, (max(xs) - min(xs)) / 2)
        hd = max(0.7, (max(ys) - min(ys)) / 2)
        H = float(p.get("h") or 4.2)
        # THE SIZE TABLE WINS OVER THE FOOTPRINT. props.geojson's `h` and its
        # ring are class defaults on a buffered node — 4.2 m for every statue,
        # 5.5 for every sculpture, 7.0 for every installation — so where a real
        # dimension is known it replaces both, and the recipe is handed the real
        # work's half-extents. See DIMS for the sources.
        if name in DIMS:
            dh, dw, dd, _prov = DIMS[name]
            stats["sized_from_DIMS"] += 1
            if abs(dh - H) > 0.3:
                stats["resized_h"] += 1
                print("  resize %-24s h %.1f -> %.2f  w %.1f -> %.2f"
                      % (name, H, dh, hw * 2, dw))
            hw, hd, H = dw / 2, dd / 2, dh

        b = Build(name, lon0, lat0)
        if name in RECIPES:
            RECIPES[name](b, hw, hd, H)
            stats["recipe_" + name.replace(" ", "_")] += 1
        else:
            stats["generic_" + generic(b, name, p.get("at") or "", hw, hd, H)] += 1
        if not b.parts:
            stats["EMPTY_" + name] += 1
            continue
        authored.append(name)
        feats.extend(b.parts)
        stats["parts"] += len(b.parts)

    # The chilled-water plant rides in the same file: it is authored scene
    # geometry drawn by the same layer, and it needs no source of its own.
    try:
        import glob
        snapdir = sorted(glob.glob(os.path.join(ROOT, "data", "snapshots", "*", "")))[-1]
        snap = json.load(open(os.path.join(snapdir, "buildings.detailed.geojson"),
                              encoding="utf-8"))["features"]
        feats.extend(bake_plant(None, snap, stats))
    except (IndexError, FileNotFoundError) as e:
        stats["plant_SKIPPED"] += 1

    fc = {"type": "FeatureCollection", "authored": sorted(set(authored)),
          "features": feats}
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(fc, fh, separators=(",", ":"))

    # ASSERT THE EFFECT, NOT THE INTENTION. A recipe that emits nothing at all,
    # or emits everything 2 cm tall, still runs to completion and still prints a
    # happy summary — art_lonestar did exactly that for five of its five arms.
    # So measure the file that was written and check every sized piece against
    # the table it was sized from.
    measured, bad = {}, []
    for f in feats:
        nm = f["properties"]["name"]
        e = measured.setdefault(nm, [0.0, 180.0, -180.0, 90.0, -90.0, 0])
        e[0] = max(e[0], f["properties"]["h"])
        for x, y in f["geometry"]["coordinates"][0]:
            e[1], e[2] = min(e[1], x), max(e[2], x)
            e[3], e[4] = min(e[3], y), max(e[4], y)
        e[5] += 1
    for nm, (dh, dw, dd, _p) in DIMS.items():
        e = measured.get(nm)
        if not e:
            bad.append(nm + ": NOTHING WAS EMITTED")
            continue
        lat = (e[3] + e[4]) / 2
        w = max((e[2] - e[1]) * M_LAT * math.cos(math.radians(lat)), (e[4] - e[3]) * M_LAT)
        if not (dh * 0.85 <= e[0] <= dh * 1.12):
            bad.append("%s: height %.2f, table says %.2f" % (nm, e[0], dh))
        if not (max(dw, dd) * 0.72 <= w <= max(dw, dd) * 1.25):
            bad.append("%s: span %.2f, table says %.2f" % (nm, w, max(dw, dd)))

    print(json.dumps({
        "pieces": len(authored),
        "parts": len(feats),
        "file_kb": round(os.path.getsize(OUT) / 1024, 1),
        "counts": dict(sorted(stats.items())),
        "measured_vs_DIMS": "PASS" if not bad else bad,
        "provenance": {
            "position, name, artist": "factual - OSM and the City of Austin inventory",
            "size": "PUBLISHED where DIMS carries a source; the props file's own "
                    "height is a class default and is overridden there",
            "form": "GENERATIVE - read off published descriptions and photographs "
                    "and reduced to stacked horizontal slabs, which is all "
                    "fill-extrusion can express",
        },
    }, indent=2))
    if bad:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
