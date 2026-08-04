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
descriptions and photographs and reduced to what fill-extrusion can express.

WHAT FILL-EXTRUSION CAN EXPRESS, and this paragraph is the whole of 2026-08-03.
Simeon: "i thought vectors could be like angled and stuff you could make the
actual thing? not like a paint tool with the biggest pixel brush setting?" The
honest answer is in two halves and this file used to get the first half wrong.
An extrusion is ALWAYS VERTICAL — MapLibre takes a polygon and pushes it
straight up — so a diagonal member does have to be approximated by a series of
prisms along its length, and a shape lying in a wall does have to be built out
of horizontal spans. That half is a real limit and there is no way round it.
But the polygon is ARBITRARY. A rotated rectangle is four points, and `box()`
has taken a `rot` for a long time, so every one of those prisms can be turned to
its member's own heading — and once each slab carries the member's real
cross-section they OVERLAP instead of abutting, and the staircase becomes a
member with a soft edge. See BEAM_OVERLAP and `Build.wall()`. The pieces he
named are all in the first category: Clock Knot, Monochrome for Austin, and
Kelly's glass.

THE OTHER THING THAT WAS ARBITRARY WAS THE HEADING. Every art footprint in
props.geojson is an axis-aligned square around an OSM node, so nothing here ever
carried a bearing and every recipe came out pointing east by default. See
HEADINGS.

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

# HOW A LEANING MEMBER IS SLICED — and the previous answer measured the wrong
# thing, which is why two passes of tuning did not fix it.
#
# Simeon, 2026-08-03: "alot o the art u did liek the glass, monochrome for
# austin, clock knot are like mini legos - i thought vectors could be like
# angled and stuff you could make the actual thing? not like a paint tool with
# the biggest pixel brush setting?"
#
# HE IS RIGHT, AND HERE IS THE HONEST ANSWER. A `fill-extrusion` is always
# VERTICAL: MapLibre takes a polygon and pushes it straight up. So the one thing
# it cannot do is tilt a face, and a diagonal member has to be approximated by a
# series of prisms along its length. What it CAN do — and what this file was not
# using — is extrude an ARBITRARY polygon, so each of those prisms can be a
# RECTANGLE ROTATED TO THE MEMBER'S OWN HEADING rather than an axis-aligned box.
# That is the difference between a leaning beam and a flight of stairs.
#
# §38 already derived the step count from the member's LENGTH (0.70 m of member
# per slab) and reported Monochrome "improved, not cured". Length is the wrong
# control variable, and that is the whole lesson: what you SEE is the vertical
# notch between one slab and the next, and that notch is set by the member's
# RISE over the step count, not by its length. A 12 m leg at 0.70 m per slab is
# 16 slabs with a 0.64 m notch — on a 0.68 m member, a literal staircase. So:
#
#   1. a VERTICAL member is exact — one prism, z0 to z1, no stepping at all;
#   2. a LEVEL member is exact — ONE rotated prism of the member's own depth.
#      It used to be sliced into a ramp of paper-thin ribbons, because beam()
#      spread z0..z1 along the axis and a level member has z1 = z0;
#   3. a LEANING member gets slabs that carry the member's FULL DEPTH and
#      therefore OVERLAP each other in z. Abutting slabs show every notch;
#      slabs that overlap by half their depth show a ripple on the edge and a
#      continuous member everywhere else.
#
# And the depth of the slab is the member's depth measured PERPENDICULAR to its
# own axis, divided by cos(inclination) — a vertical slab cutting a steep member
# has to be taller than the member is thick to cover it. That correction is what
# keeps the count down: Clock Knot's legs go from 16 slabs to 18, not to 34.
# AND THE NUMBER MEANS SOMETHING, which is what makes it tunable rather than
# fiddled with. Slabs step by BEAM_OVERLAP of their own vertical depth; that
# depth is the member's thickness over cos(inclination); so the ripple left on
# the member's edge, measured PERPENDICULAR to the member, is exactly
# thickness x BEAM_OVERLAP whatever the angle. 0.45 is a 45% ripple and looked
# like it. Measured over the whole file, everything else held: 0.45 -> 1,582
# parts / 442 KB, 0.30 -> 1,811 / 505, 0.20 -> 2,157 / 599, 0.14 -> 2,575 / 713.
# 0.20 taken. A fifth of the member's own depth is a soft edge at any distance
# this app is ever flown at, and the file is 56 KB gzipped against 33 before —
# which is what the wire actually carries, and is not a cost worth a staircase.
BEAM_OVERLAP = 0.20     # consecutive slabs step by this fraction of the slab's
                        # own vertical depth, so they overlap by the rest of it.
                        # Lower is smoother and costs features linearly.
BEAM_MAX_STEPS = 40     # a hard ceiling; nothing in the file reaches it
BEAM_MIN_SLAB = 0.03    # never slice below add()'s 2 cm floor — that is
                        # HANDOFF §51 with more steps, and it deletes the member
                        # instead of smoothing it
BEAM_THICK_MAX = 4.0    # cap on the 1/cos(incline) depth correction

# HOW FINELY A SHAPE THAT LIVES IN A WALL IS SLICED, in metres of height.
#
# The same limitation, one dimension down, and it is what "the glass" in his
# note is about. A motif on a vertical wall — a starburst ray, a tumbled square
# — is a polygon in the wall's own plane, and a prism standing proud of that
# wall always shows as an AXIS-ALIGNED RECTANGLE there, whatever its plan shape
# is. Kelly's twelve rays were three fat blocks each, which is exactly "the
# biggest pixel brush". `Build.wall()` rasterises the real polygon into thin
# horizontal spans instead, and merges spans that agree so a vertical bar still
# costs one feature.
WALL_SLICE_M = 0.055
WALL_MERGE_M = 0.02     # spans within this much are one prism, not two

# A GENERIC STATUE'S FIGURE, in metres — life size to heroic. The pedestal is
# whatever the piece's height leaves over. See generic() for why this is the
# right way round.
STATUE_FIGURE_M = (1.85, 2.35)
STATUE_PLINTH_MIN = 0.60


def to_m(lon, lat, lon0, lat0):
    return ((lon - lon0) * M_LAT * math.cos(math.radians(lat0)), (lat - lat0) * M_LAT)


def to_ll(x, y, lon0, lat0):
    return [round(lon0 + x / (M_LAT * math.cos(math.radians(lat0))), 7),
            round(lat0 + y / M_LAT, 7)]


class Build:
    """Collects extrusion parts in local metres about a piece's own centre.

    THE FRAME HAS A HEADING NOW, and that is the fix for a whole class of
    defect rather than for one piece. Every `k:'art'` feature in props.geojson
    is an AXIS-ALIGNED SQUARE — a buffered OSM node — so the source carries no
    bearing at all, and every recipe below was therefore drawn in the north/east
    frame by default. Nothing chose east; east is just what you get when nobody
    chooses. Simeon, 2026-08-03: "balls of texas are rotated the wrong way LOL
    was funny but super embarrasing". The two buoys of Lipski's "The West" were
    laid out along local +x, which is due east, and they are not.

    So `head` is the compass bearing (degrees clockwise from north) that the
    recipe's own +x axis points along, taken from HEADINGS, and every ring is
    rotated by it on the way out. A recipe never has to know about it.
    """

    def __init__(self, name, lon0, lat0, head=None):
        self.name, self.lon0, self.lat0 = name, lon0, lat0
        self.parts = []
        # +x is east when nobody says otherwise, which is what every piece in
        # this file used to be.
        self.rot = 0.0 if head is None else math.radians(90.0 - head)

    def add(self, ring_m, z0, z1, mat):
        if z1 - z0 < 0.02 or len(ring_m) < 3:
            return
        if self.rot:
            c, s = math.cos(self.rot), math.sin(self.rot)
            ring_m = [(x * c - y * s, x * s + y * c) for x, y in ring_m]
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

    def beam(self, x0, y0, z0, x1, y1, z1, wide, mat, steps=2, deep=None, taper=0.0):
        """A member of given heading and inclination, as ROTATED PRISMS.

        `wide` is the member's width across its axis; `deep` its depth, which
        defaults to square section. Both are the member's REAL cross-section —
        the slab is sized from them, not from the slicing.

        Read the note on BEAM_OVERLAP for why this is shaped the way it is. In
        one line: a vertical member and a level member are drawn EXACTLY, with
        one prism each, and only a genuinely leaning member is sliced — into
        slabs that carry the member's own depth and therefore overlap, instead
        of abutting slabs that show every notch. `steps` survives as a FLOOR
        because a handful of callers want a minimum; nothing depends on it.
        """
        deep = wide if deep is None else deep
        dx, dy, dz = x1 - x0, y1 - y0, z1 - z0
        run, rise = math.hypot(dx, dy), abs(dz)
        L3 = math.hypot(run, rise)
        if L3 < 1e-6:
            return
        ang = math.atan2(dy, dx)
        cxm, cym = (x0 + x1) / 2.0, (y0 + y1) / 2.0

        # 1. VERTICAL. Exactly what a fill-extrusion is; one prism, no stepping.
        if run <= max(0.04, 0.10 * rise):
            self.box(cxm, cym, wide, wide, min(z0, z1), max(z0, z1), mat, rot=ang)
            return

        # The slab's vertical depth. A vertical cut through a member inclined at
        # `phi` has to be deep/cos(phi) tall to cover a member `deep` thick, and
        # not making that correction was half of why steep members looked thin
        # AND needed twice the slabs.
        vdeep = min(deep * BEAM_THICK_MAX, deep / max(0.25, run / L3))

        # 2. LEVEL. Also exact: ONE rotated prism with the member's own depth.
        #    It used to be sliced into a ramp of ribbons a few centimetres thick,
        #    because beam() spread z0..z1 along the axis and a level member has
        #    nothing to spread — every canoe hull in Monochrome hit this.
        if rise <= vdeep * 0.30:
            zc = (z0 + z1) / 2.0
            if taper <= 0:
                self.box(cxm, cym, run + wide, wide, zc - vdeep / 2,
                         zc + vdeep / 2, mat, rot=ang)
                return
            # A TAPERED level member — a boat hull, which is what most of
            # Monochrome is. The nadir aerial shows each hull as a long POINTED
            # leaf, and one prism is a plank; five with the width falling off
            # toward the ends is a hull, for four more features.
            for i in range(5):
                t = (i + 0.5) / 5
                self.box(x0 + dx * t, y0 + dy * t, run / 5 + wide * 0.6,
                         wide * (1.0 - taper * abs(2 * t - 1)),
                         zc - vdeep / 2, zc + vdeep / 2, mat, rot=ang)
            return

        # 3. LEANING. Slabs of the member's own depth, stepping by a fraction of
        #    it, so consecutive slabs overlap and the silhouette is a member
        #    with a rippled edge rather than a staircase.
        n = int(math.ceil(rise / max(BEAM_MIN_SLAB, vdeep * BEAM_OVERLAP)))
        n = max(2, steps, min(BEAM_MAX_STEPS, n))
        seglen = run / n
        for i in range(n):
            t = (i + 0.5) / n
            zc = z0 + dz * t
            self.box(x0 + dx * t, y0 + dy * t, seglen + wide * 0.9,
                     wide * (1.0 - taper * abs(2 * t - 1)),
                     zc - vdeep / 2, zc + vdeep / 2, mat, rot=ang)

    def wall(self, axis, pos, prd, poly, mat, slice_m=WALL_SLICE_M, out=1):
        """A polygon that lives IN A VERTICAL WALL, rasterised into thin spans.

        `axis` is the wall's normal, 'x' or 'y'; `pos` where that wall stands;
        `prd` how far the glass stands proud of the stone; `poly` a list of
        (u, v) in the wall's own plane, u across (y for an 'x' wall, x for a
        'y' wall) and v up. `out` is which side of the wall it sits on.

        WHY THIS EXISTS. A prism standing on a wall reads there as an
        axis-aligned rectangle, whatever else it is — so a diagonal streak or a
        square on the tilt has to be built out of horizontal spans. Kelly's
        twelve rays were three fat blocks each and looked like it. Here the ray
        is authored as the rotated rectangle it actually is and only the LAST
        step turns it into prisms, at 5.5 cm, with equal spans merged so an
        upright bar is still one feature.
        """
        vs = [v for _, v in poly]
        v0, v1 = min(vs), max(vs)
        if v1 - v0 < 0.02:
            return
        n = max(1, int(math.ceil((v1 - v0) / slice_m)))
        rows = []
        for i in range(n):
            va, vb = v0 + (v1 - v0) * i / n, v0 + (v1 - v0) * (i + 1) / n
            vm = (va + vb) / 2.0
            xs = []
            for k in range(len(poly)):
                (ua, pa), (ub, pb) = poly[k], poly[(k + 1) % len(poly)]
                if (pa <= vm < pb) or (pb <= vm < pa):
                    xs.append(ua + (ub - ua) * (vm - pa) / (pb - pa))
            xs.sort()
            spans = [(xs[j], xs[j + 1]) for j in range(0, len(xs) - 1, 2)]
            rows.append((va, vb, spans))
        # Merge vertically adjacent rows whose spans agree, so a rectangle
        # standing upright costs one prism and not forty.
        merged = []
        for va, vb, spans in rows:
            if merged and len(merged[-1][2]) == len(spans) and all(
                    abs(a0 - b0) < WALL_MERGE_M and abs(a1 - b1) < WALL_MERGE_M
                    for (a0, a1), (b0, b1) in zip(merged[-1][2], spans)):
                merged[-1][1] = vb
            else:
                merged.append([va, vb, spans])
        for va, vb, spans in merged:
            for u0, u1 in spans:
                if u1 - u0 < 0.03:
                    continue
                uc, uw = (u0 + u1) / 2.0, u1 - u0
                if axis == 'x':
                    self.box(pos + out * prd / 2.0, uc, prd, uw, va, vb, mat)
                else:
                    self.box(uc, pos + out * prd / 2.0, uw, prd, va, vb, mat)

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
    "The West":              ( 2.06,  5.00,  3.30,
        "the SPHERES are published — 'each sphere 60 inches in diameter', "
        "Landmarks UT; 12 ft 8 3/8 in overall for the pair, Metropolitan "
        "Museum. The rest is the SITE WORK, read off Landmarks' own photograph "
        "(photo Ben Aqua): a 0.34 m concrete slab on a base course, and steel "
        "cradle plates holding each buoy 0.20 m clear of it. 0.34 + 0.20 + "
        "1.524 = 2.06 m to the crown. The slab is scaled off the spheres in "
        "the same frame, at about 1.3 x the pair's span."),
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
    # THE NATURE'S NEIGHBORHOOD BRONZES, and this is HANDOFF 33's own finding
    # left half-done. Six small cast-bronze Texas natives by Lars Stanley and
    # Dylan Connor sit along Waller Creek; all six arrive as `at=statue` with the
    # props file's 4.2 m class default, and `generic()` draws a `statue` as a
    # STANDING HUMAN FIGURE. So the campus has an armadillo, a bat, a horned
    # lizard, a prickly pear and a bluebonnet each rendered as a 4.2 m person on
    # a plinth. §33 spotted exactly this, sized the Sea Turtle — "a bronze animal
    # is animal-sized" — and stopped there; the other five were never touched and
    # the contact sheet shows all five as the same 4.2 h x 1.2 w silhouette.
    #
    # Sizes are `est` and reasoned from the SUBJECT, which is the one measurement
    # nobody has to look up, with the usual public-art allowance of somewhat over
    # life size so the thing survives being outdoors.
    "Armadillo":             ( 0.80,  0.95,  0.55,
        "est — a nine-banded armadillo is ~0.75 m nose to tail and knee-high; "
        "same argument as Sea Turtle. Low block base included."),
    "Horned Lizard":         ( 0.58,  0.66,  0.46,
        "est — a Texas horned lizard is ~0.13 m; a bronze of one is a hand-sized "
        "animal on a low block, not a 4.2 m person"),
    "Bat":                   ( 1.40,  0.90,  0.42,
        "est — a Mexican free-tailed bat has a 0.30 m span; the piece reads as a "
        "bat mounted at eye height, so most of the height is its post"),
    "Prickly Pear":          ( 1.45,  1.15,  0.90,
        "est — a mature Opuntia pad cluster is about this tall and wide"),
    "Bluebonnet":            ( 0.90,  0.60,  0.60,
        "est — Lupinus texensis stands ~0.4 m; a bronze marker of one is a "
        "knee-high clump, and it is a PLANT, not a standing figure"),
    "Littlefield Fountain":  ( 6.90,  7.00,  9.40,
        "est, but DERIVED — see LITTLEFIELD below. The width is solved from the "
        "upper channel the group stands in (125.2 m2 over a 13.6 m run = 9.2 m "
        "clear, less the 0.6 m weir walls and a coping's clearance either side); "
        "the height is a heroic-scale figure (~1.5x life) on a prow deck 1.9 m "
        "over the water, with the torch above her head."),
}


# ── WHICH WAY EACH PIECE FACES ────────────────────────────────────────
#
# "balls of texas are rotated the wrong way LOL was funny but super embarrasing"
# (2026-08-03), and the brief's guess that "a wrong rotation is rarely alone"
# was right — but not because two recipes each got a number wrong. Print the
# source and the mechanism is plain: EVERY `k:'art'` feature in props.geojson is
# an axis-aligned SQUARE in lon/lat, a buffered OSM node, so nothing anywhere in
# this pipeline carries a bearing. Every recipe was drawn in the north/east
# frame because that is what you get when nobody chooses. The West's two buoys
# came out due east; Clock Knot's long axis came out due north.
#
# So the fix is a bearing per piece, sourced, with the source written down —
# `Build` rotates the whole recipe and no recipe has to know. Degrees clockwise
# from north, naming where the recipe's own +x axis points.
#
# ONLY PIECES WHOSE ORIENTATION IS BOTH VISIBLE AND SOURCED ARE IN HERE. A
# guessed bearing is worth no more than the accidental one it replaces, and an
# 8-fold ring (Circle with Towers) or a near-isotropic cloud (Monochrome) does
# not have a legible one to get wrong.
HEADINGS = {
    "The West": (27.0,
        "TWO PHOTOGRAPHS AGREE. Landmarks' own hero shot (photo Ben Aqua) is "
        "square-on to a symmetrical wall-and-twin-stair backdrop, so the pair's "
        "axis is perpendicular to that camera; the Flickr view that frames the "
        "work against the UT Tower puts the camera on the bearing from the "
        "sculpture to the Tower, which is 299 deg, and the pair again lies "
        "across it. 299 - 90 = 209, i.e. 29 deg, and the two readings land "
        "within a few degrees of each other. It was drawn at 90 (due east)."),
    "Clock Knot": (193.0,
        "MEASURED OFF A NADIR AERIAL, and the piece is unmistakable from above "
        "— painted minium red on a green berm (Esri World Imagery z20, "
        "0.0258 m/px, centred on Landmarks' published 30.289671,-97.736162). "
        "The long plan axis runs 103/283 deg, near east-west, over 12.1 m, with "
        "the short axis 6.2 m across — against the published plan of 10.67 x "
        "6.60 m. This file put the 10.67 m axis due NORTH, so the piece stood "
        "90 deg out. Setting +x to 193 puts the long axis on 103; two separate "
        "members then reproduce: the leg raking back lands on 282 against a "
        "measured 283, and one foot of the inverted V on 194.5 against 193."),
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
        # A HULL IS NOT A PLANK. The nadir aerial (Esri z20, 0.0258 m/px, over
        # Landmarks' 30.28746,-97.73713) shows a cluster 14.4 x 13.2 m across —
        # the published 15.85 x 12.50 — of long POINTED leaf shapes, each about
        # 0.8 m in the beam and half that deep. So: `deep` under `wide`, and a
        # taper, rather than the square section a beam gets by default.
        b.beam(px - dx, py - dy, z0, px + dx, py + dy, z1,
               0.80, "mirror" if i % 4 == 0 else "alum",
               deep=0.50, taper=0.55)

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
        b.beam(x0, y0, z0, x1, y1, z1, 0.80, "alum", deep=0.50, taper=0.55)


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
    # The clock face is a RING, not a pancake. Landmarks' own detail photograph
    # (taken from underneath) shows a broad rolled steel BAND with the beams
    # passing through the hole in it; a solid 3.2 m disc reads as a plate, and
    # on the contact sheet it was the blob at the top of the tripod. Sixteen
    # tangential prisms, each rotated to the ring, which is what `box(rot=)`
    # was always able to do.
    knot_r, knot_t = 1.75, 0.34
    for i in range(16):
        t = 2 * math.pi * (i + 0.5) / 16
        b.box(ax + knot_r * math.cos(t), ay + knot_r * math.sin(t),
              (2 * math.pi * knot_r / 16) * 1.30, knot_t,
              az - 0.62, az + 0.62, "steelred", rot=t + math.pi / 2)
    # The hand: a long near-level member reaching out at high level. Written
    # low-end-first so beam() gets z0 < z1.
    b.beam(ax - 0.10, hd * 0.98, az - 2.55, ax + 0.15, ay + 0.55, az - 1.45,
           0.58, "steelred", steps=6)


def art_thewest(b, hw, hd, H):
    """Donald Lipski, "The West", 1987 — two spherical steel buoys skinned in
    corroded copper pennies, lent by the Metropolitan Museum.

    "balls of texas are rotated the wrong way LOL was funny but super
    embarrasing" (2026-08-03). He is right, and looking at the two photographs
    rather than at the dimension line fixed four things, not one.

    1. THE ORIENTATION. See HEADINGS — the source has no bearing at all, so the
       pair came out due east. It runs about 27 deg.
    2. IT STANDS ON A CONCRETE SLAB, not on the grass. Landmarks' own
       photograph shows a broad low plinth with a base course under it, and the
       piece reads as a museum object placed on a pad rather than as two balls
       dropped on a lawn — which is most of why the render was funny.
    3. EACH BUOY IS CRADLED ON STEEL PLATES, clear of the slab. That gap is why
       a buoy on land looks like a buoy on land.
    4. THE COLOUR IS NOT BROWN. Both photographs show pale weathered grey-white
       steel with rust runs down it and the pennies as dark speckle; `corten` is
       chocolate. `alum` is the pale grey in this palette. (The palette itself
       lives in js/props.js, which this lane may not write — the names here have
       to be ones that file already knows, or the layer falls back to grey.)

    Each sphere is 5 ft (1.524 m); the pair measures 12 ft 8 3/8 in overall, and
    the shackle between them is what makes up the difference.
    """
    r = 1.524 / 2
    sep = 3.871 / 2 - r          # the offset that reproduces the published span
    slab = 0.34                  # top of the concrete pad
    cradle = 0.20                # steel plates the buoys sit on, clear of it
    b.box(0, 0, 5.00, 3.30, 0.0, slab, "granite")
    b.box(0, 0, 5.45, 3.70, 0.0, slab * 0.42, "granite")       # base course
    for s in (-1, 1):
        # The cradle: two flat plates under each sphere, and they are visible.
        for t in (-0.42, 0.42):
            b.box(s * sep + t, 0.0, 0.10, 0.90, slab, slab + cradle, "steel")
        # 12 tiers of 16, not 9 of 14: at 1.52 m across, a coarse ball is a
        # barrel with a flat cap, and the flat cap is what you see first.
        b.ball(s * sep, 0.0, r, slab + cradle + r, "alum", tiers=12, seg=16)
        # The lifting eye each buoy still carries on its outboard side.
        b.box(s * (sep + r + 0.16), 0.0, 0.34, 0.12,
              slab + cradle + r - 0.17, slab + cradle + r + 0.17, "corten")
    # "the two buoys are shackled uselessly to each other" — the shackle is the
    # subject of the work, and it was not in the file.
    b.box(0, 0, 2 * (sep - r) + 0.30, 0.16,
          slab + cradle + r - 0.13, slab + cradle + r + 0.13, "corten")


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

    2026-08-03 — "austin building with the circle class still looks horrible",
    and the starburst had by then been drawn twice. This pass finally went and
    MEASURED it. `File:Austin Building West Elevation 2018.jpg` and
    `...East Elevation 2018.jpg` (Wikimedia Commons, CC BY 4.0) are both near
    fronto-parallel to the wall that carries the motif, so a scanline over the
    dark glass gives the rule instead of a guess. Four things came out of it and
    three of them were wrong in the file:

    WEST, THE STARBURST — 13,926 dark pixels, twelve angular runs of ~1,100 px
    each, centres 30.0 deg apart on average, and the four cardinal ones land on
    90.5, 185.1, 269.1 and 353.9. So there is a ray STRAIGHT UP, one straight
    down and two dead level: the rays are at k*30 deg. This file had them at
    k*30 + 15, i.e. the whole motif rotated half a step, with no ray upright.
    Radii 36.6 -> 148 px, ray width a flat 10 px measured across the two
    vertical rays. As fractions of the outer radius: inner 0.247, width 0.068.
    The ring spans 0.73 of the gable, and the gable is ARM wide, so the outer
    radius is 2.85 m. It was 2.30 with a 0.30 ray — a third too fat and a fifth
    too small.

    EAST, THE TUMBLING SQUARES — twelve blobs of 1,870 px each, side 43.2 px,
    at 30 deg spacing. Their bounding boxes give |cos t| + |sin t| for each
    square's own rotation, and the sequence around the ring is HIGH, low, low,
    HIGH, low, low — period THREE, values 1.40 and 1.21. t = i*30 gives
    1.0/1.37/1.37, which is the wrong phase; t = 45 + i*30 gives
    1.414/1.225/1.225, which is what was measured. So each square is rotated 45
    deg PLUS its own position angle: the top square is a diamond, and that is
    exactly what the photograph shows. Side 0.315 of the ring radius.

    THE PLAN IS NOT A SYMMETRIC CROSS. The nadir (Esri z20, 0.0322 m/px) shows
    the two vaults meeting in a clean 45-deg groin — so they are the same
    height, which is the one thing this file had right — but the crossing sits
    0.366 of the way down from the north end, not halfway. The transept is
    ~3.0 m NORTH of the plan centre, which means both glass walls were 3 m from
    where they belong.

    AND THE SOUTH FACE HAS A DOOR, a big recessed timber double door under the
    colour grid, which is the second most recognisable thing about the building
    after the glass and was not in the file at all.

    fill-extrusion cannot glaze a wall and cannot tilt a face — a prism on a
    wall always reads there as an upright rectangle. So the motifs are authored
    as the polygons they really are and `Build.wall()` does the rasterising, at
    5.5 cm, merging spans that agree. That is what takes a ray from three fat
    blocks to a clean rotated bar.
    """
    W, Dp = 18.29, 22.25                 # E–W overall, N–S overall
    ARM = 7.72                           # solved from the 2,715 sq ft floor area
    H = 8.03
    wall_h = 5.35                        # springing of the vault — taste knob
    TY = 3.00                            # transept centre, metres north of the
                                         # plan centre; measured off the nadir
    hx, hy = W / 2, Dp / 2

    # The cross, as two solid stone volumes. They interpenetrate; both are the
    # same material, so the shared interior faces cannot show a seam.
    b.box(0, 0, ARM, Dp, 0.0, wall_h, "white")
    b.box(0, TY, W, ARM, 0.0, wall_h, "white")
    # TWO barrel vaults, one along each arm, crossing over the transept. Chords
    # of a circle: each tier keeps its arm's LENGTH and loses width, which is
    # what makes it a barrel rather than a dome. 16 tiers, not 7 — at 7 the
    # crown is a visible flight of steps in every oblique frame, and a tier
    # costs one prism.
    rise, tiers = H - wall_h, 22
    for i in range(tiers):
        f0, f1 = i / tiers, (i + 1) / tiers
        k = math.sqrt(max(0.0, 1.0 - ((f0 + f1) / 2) ** 2))
        b.box(0, 0, ARM * k, Dp, wall_h + rise * f0, wall_h + rise * f1, "white")
        b.box(0, TY, W, ARM * k, wall_h + rise * f0, wall_h + rise * f1, "white")

    prd = 0.30                           # how far a panel stands proud of stone

    # ── the measured motif constants, all one-line overridable ──
    GRID_SQ, GRID_PITCH, GRID_Z = 0.80, 1.45, 4.85
    RING_R, RING_SQ = 2.60, 0.82
    STAR_ROUT, STAR_RIN, STAR_W = 2.85, 0.70, 0.20
    # Both round windows are centred on their OWN gable, and that gable belongs
    # to the transept — so their across-wall centre is TY, not 0. Getting this
    # wrong puts a 5.7 m window 3 m off the middle of a 7.7 m wall.
    GLASS_U = TY
    GLASS_Z = 4.67                       # 0.58 of the gable height, measured
                                         # off the west elevation photograph
    DOOR_W, DOOR_H = 2.70, 2.60

    def sq_poly(uc, vc, s, t):
        """A square of side `s` centred at (uc, vc) and rotated by `t`."""
        c, sn = math.cos(t), math.sin(t)
        return [(uc + (du * c - dv * sn), vc + (du * sn + dv * c))
                for du, dv in ((-s / 2, -s / 2), (s / 2, -s / 2),
                               (s / 2, s / 2), (-s / 2, s / 2))]

    # SOUTH — THE COLOUR GRID. Three by three upright squares. Upright means
    # wall() merges each one back into a single prism, so this costs 9 features.
    for r in range(3):
        for c in range(3):
            b.wall('y', -hy, prd,
                   sq_poly((c - 1) * GRID_PITCH,
                           GRID_Z + (r - 1) * GRID_PITCH, GRID_SQ, 0.0),
                   GLASS_SPECTRUM[(r * 3 + c) % len(GLASS_SPECTRUM)], out=-1)

    # SOUTH — THE DOOR. A deep reveal in the stone with the timber leaves set
    # back in it, which is what makes it read as an opening and not a decal.
    b.box(0, -hy - 0.05, DOOR_W + 0.34, 0.34, 0.0, DOOR_H + 0.30, "granite")
    b.box(0, -hy - 0.16, DOOR_W, 0.16, 0.0, DOOR_H, "wood")

    # EAST — TUMBLING SQUARES, at 30 deg round the ring, each rotated 45 deg
    # plus its own position angle. See the measurement above.
    for i in range(12):
        a = math.pi / 2 + 2 * math.pi * i / 12
        b.wall('x', hx, prd,
               sq_poly(GLASS_U + RING_R * math.cos(a), GLASS_Z + RING_R * math.sin(a),
                       RING_SQ, math.radians(45.0) + 2 * math.pi * i / 12),
               GLASS_SPECTRUM[i % len(GLASS_SPECTRUM)], out=1)

    # WEST — THE STARBURST. Twelve narrow bars of constant width radiating from
    # a stone boss, one of them straight up. Each is authored as the rotated
    # rectangle it is; wall() turns it into spans.
    for i in range(12):
        a = 2 * math.pi * i / 12                     # 0 = straight up
        ux, uy = math.sin(a), math.cos(a)            # along the ray, in (u, v)
        px, py = uy, -ux                             # across it
        ray = []
        for sr, sw in ((STAR_RIN, -1), (STAR_ROUT, -1), (STAR_ROUT, 1), (STAR_RIN, 1)):
            ray.append((GLASS_U + ux * sr + px * sw * STAR_W / 2,
                        GLASS_Z + uy * sr + py * sw * STAR_W / 2))
        b.wall('x', -hx, prd, ray,
               GLASS_SPECTRUM[i % len(GLASS_SPECTRUM)], out=-1)


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


def _creature(kind):
    """The Nature's Neighborhood bronzes: an animal or a plant, animal-sized.

    Three forms rather than five recipes, because at 0.6-1.5 m nobody is reading
    a species off the silhouette — what has to be true is that the thing is
    SMALL, LOW and NOT A PERSON, which is the entire defect. `hw`, `hd` and `H`
    arrive from DIMS, so the size is the table's and this only spends it.
    """
    def draw(b, hw, hd, H):
        L, W = hw * 2, hd * 2
        if kind == "plant":
            bh = min(0.22, H * 0.20)
            b.disc(0, 0, max(L, W) * 0.46, 0.0, bh, "limest", seg=8)
            # A clump: three or four rounded masses at mixed heights, leaning
            # out. One cylinder is a bollard; three at different heights is a
            # plant, and that is as far as an extrusion can take it.
            for i in range(4):
                a = 2 * math.pi * (i + 0.2) / 4
                d = max(L, W) * (0.10 + 0.16 * hash01(kind, 10 + i))
                top = bh + (H - bh) * (0.55 + 0.45 * hash01(kind, 20 + i))
                b.disc(d * math.cos(a), d * math.sin(a),
                       max(L, W) * (0.13 + 0.07 * hash01(kind, 30 + i)),
                       bh, top, "bronze", seg=6)
            b.dome(0, 0, max(L, W) * 0.20, H * 0.72, H * 0.28, "bronze", tiers=2, seg=6)
            return
        if kind == "bat":
            post = H * 0.62
            b.disc(0, 0, 0.26, 0.0, 0.16, "limest", seg=8)
            b.disc(0, 0, 0.10, 0.0, post, "steel", seg=6)
            b.box(0, 0, 0.22, 0.30, post, H * 0.92, "bronze")            # the body
            b.disc(0, 0.13, 0.09, H * 0.86, H, "bronze", seg=6)          # the head
            for s in (1, -1):                                            # the wings
                b.beam(0.06 * s, 0.0, post + 0.04, (L / 2) * s, -0.10, H * 0.90,
                       0.16, "bronze", steps=3)
            return
        # a quadruped: a low body, a head forward, four short legs, a tail.
        bh = min(0.26, H * 0.34)
        b.box(0, 0, L * 1.05, W * 1.15, 0.0, bh, "limest")
        body_t = bh + (H - bh) * 0.80
        b.dome(0, 0, L * 0.34, bh, body_t - bh, "bronze", tiers=3, seg=10)
        b.disc(0, W * 0.42, L * 0.15, bh + (body_t - bh) * 0.25, body_t, "bronze", seg=8)
        b.disc(0, W * 0.56, L * 0.10, body_t * 0.86, H, "bronze", seg=6)   # the head
        for sx in (1, -1):
            for sy in (0.62, -0.62):
                b.box(sx * L * 0.24, sy * W * 0.30, L * 0.10, L * 0.10,
                      bh, bh + (body_t - bh) * 0.45, "bronze")
        b.beam(0.0, -W * 0.34, bh + 0.03, 0.0, -W * 0.78, bh + (body_t - bh) * 0.55,
               L * 0.09, "bronze", steps=3)
    return draw


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
    "Armadillo": _creature("quadruped"),
    "Horned Lizard": _creature("quadruped"),
    "Bat": _creature("bat"),
    "Prickly Pear": _creature("plant"),
    "Bluebonnet": _creature("plant"),
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
        # A PORTRAIT BRONZE IS A FIGURE ON A PEDESTAL, AND THE PEDESTAL TAKES
        # WHATEVER THE FIGURE DOES NOT NEED.
        #
        # The old rule was the other way round: a plinth of 0.85-1.15 m and then
        # the WHOLE REMAINDER of the props file's 4.2 m class default handed to
        # the figure — so all nine generic statues on this campus were drawn as
        # people 3.05 to 3.35 m tall. That is half again over heroic scale, and
        # on the contact sheet every one of them reads as a bare brown stick with
        # nothing under it (George Washington and the Barbara Jordan statue are
        # the two anyone would look at). A bronze is life size to heroic, 1.85 to
        # 2.35 m; the pedestal is the rest, and a pale block half the height is
        # also what makes the piece legible at 60 m in the first place.
        fig = STATUE_FIGURE_M[0] + (STATUE_FIGURE_M[1] - STATUE_FIGURE_M[0]) * r2
        ph = b.plinth(hw * 1.15, hd * 1.15, "granite", max(STATUE_PLINTH_MIN, H - fig))
        b.figure(0, 0, ph, max(1.20, H - ph), "bronze", wide=0.48 + 0.16 * r2)
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


# ── The Littlefield Fountain memorial ─────────────────────────────────
#
# "the Littlefield Fountain has no memorial at all — two flat puddles and one
# six-step nub"
#
# He is right and it is the worst omission in the scene, because after the Tower
# this is the most photographed object on campus. bake_depth.py built the POOL
# correctly — three curved tiers off a measured nadir, PR #75 gave the flights a
# riser — and then the pass never came back for the thing the pool exists to
# hold. Pompeo Coppini's bronze group, dedicated 29 April 1933, is the memorial;
# without it the fountain is a puddle with a kerb.
#
# WHAT IS THERE, from the published description of the work rather than from a
# glance at a photograph. The Goddess of Liberty — Columbia — stands on the prow
# of the Ship of State bearing a torch; the ship is drawn by THREE hippocampi
# (sea horses, forequarters of a horse and a fish's tail) breaking out of the
# cascade ahead of her; TWO male figures, the Army and the Navy, flank the hull
# in the water. The whole group stands on a masonry pedestal in the upper basin.
# Five figures, three horses, one hull. That inventory is the accuracy test: a
# recipe that emits a statue on a block has not drawn this.
#
# SIZE FIRST, and it is DERIVED rather than guessed — the same move as Kelly's
# cruciform plan. No published dimension for the bronze could be found, so:
#
#   WIDTH is solved from the basin. bake_depth.py measures the top channel at
#   125.2 m2 over a 13.60 m run = 9.2 m clear. Photographs show the group filling
#   that channel with the flanking figures just inside the copings, so 7.0 m
#   overall — 9.2 less the two 0.6 m weir walls, less a hand's clearance.
#   HEIGHT is a heroic-scale figure, which is how Coppini worked: ~1.5x life is
#   2.75 m. She stands on a deck 1.9 m above the water (itself 1.48 m over the
#   plaza, from FOUNTAIN_TIERS) and holds the torch above her head. 6.9 m.
#   LENGTH follows from the parts: stern to the lead horse's nose is 9.4 m.
#
# Two of those three are measurements off geometry this repo already has, which
# is why they are in DIMS with the derivation written out rather than an `est`
# and a shrug. main() re-measures the emitted file against them.
#
# WHERE IT GOES is not a constant either. bake_depth.py already derives the
# fountain's own axis from its footprint — the South Mall runs about 6 degrees
# east of north and assuming north puts the group a metre out — so this imports
# `mall_frame` and the tier geometry from that file instead of restating them.
# One source of truth for the axis; if the footprint changes, both move together.
LITTLEFIELD = "Littlefield Fountain"
# ── taste block, all of it overridable in one line ──
LF_ALONG_OF_MOUTH = 1.6   # group centre, metres UP-mall of the channel mouth
LF_PLINTH_Z       = 2.05  # top of the masonry pedestal, above the plaza
LF_PLINTH_L       = 5.20  # pedestal, along-mall x across-mall
LF_PLINTH_W       = 3.30
LF_HULL_Z         = 0.95  # depth of the hull's own side, above the pedestal
LF_DECK_Z         = 3.55  # the prow deck Columbia stands on
LF_COLUMBIA_H     = 2.75  # heroic scale: about 1.5x life
LF_TORCH_TOP      = 6.90  # the flame, and the top of the whole group
LF_FLANK_H        = 2.45  # the Army and the Navy, half-submerged, so shorter
LF_FLANK_ACROSS   = 3.20  # how far off the axis they stand
LF_HORSE_Z        = 0.95  # where a sea horse breaks the water
LF_HORSE_HEAD_Z   = 3.10  # and how high its head rears — BELOW the deck, so the
                          # team reads as a team and not as three columns
LF_HORSE_ACROSS   = 2.55  # the flankers' offset. See the note in the recipe.
LF_PLINTH_MAT     = "limest"   # matches bake_depth's `stone` coping, not granite
LF_BRONZE         = "bronze"


def _mall_frame_from_ground():
    """(head, down-mall unit vector, mouth offset) in bake_depth's metre frame.

    Imported rather than restated. bake_depth.mall_frame() finds the footprint's
    northernmost EDGE and takes its perpendicular toward the centroid, which is
    the only definition that survives the mall not running due north.
    """
    import sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import bake_depth as bd
    from shapely.geometry import Polygon
    gpath = os.path.join(ROOT, "data", "ground.geojson")
    ring = None
    for f in json.load(open(gpath, encoding="utf-8"))["features"]:
        if f["properties"].get("name") == bd.FOUNTAIN_NAME:
            ring = f["geometry"]["coordinates"][0]
            break
    if ring is None:
        return None
    ring_m = [bd.to_m(x, y) for x, y in ring]
    foot = Polygon(ring_m)
    if not foot.is_valid:
        foot = foot.buffer(0)
    head, axis = bd.mall_frame(ring_m, foot)
    return bd, head, axis


def bake_littlefield(stats):
    """Coppini's group: hull, Columbia, three hippocampi, two flanking figures.

    THE FRAME. `a` is metres DOWN-mall (south, toward MLK — the way the group
    faces, and the way the water falls); `s` is metres across it, starboard
    positive. Every number below is in that frame, so the whole group rotates
    with the mall for free and no part carries a compass bearing of its own.

    WHAT IS GENERATIVE. The inventory and the arrangement are from the published
    description. The individual forms are this file's usual reduction — a figure
    is five stacked masses, a leaning member is a short stack of offset slabs —
    because fill-extrusion has no vertical anchor and no rotation. Nobody will
    recognise Columbia's face at 60 m; they will recognise a standing figure on a
    prow with three horses in front of it, and that is the whole job.
    """
    fr = _mall_frame_from_ground()
    if fr is None:
        stats["littlefield_SKIPPED"] += 1
        return []
    bd, head, (ux, uy) = fr
    # Origin: on the axis, just up-mall of the channel mouth, so the hull sits in
    # the top basin and the horses lead out over the weir into the crescent.
    u0 = bd.FOUNTAIN_MOUTH_U - LF_ALONG_OF_MOUTH
    lon0, lat0 = bd.to_ll(head[0] + ux * u0, head[1] + uy * u0)
    b = Build(LITTLEFIELD, lon0, lat0)
    nx, ny = -uy, ux
    rot = math.atan2(uy, ux)

    def P(a, s=0.0):
        return (ux * a + nx * s, uy * a + ny * s)

    # 1. THE PEDESTAL. Limestone, not granite: it has to read as one thing with
    #    the pool's own coping, and `granite` here is the dark plinth grey used
    #    under the free-standing bronzes.
    b.box(*P(-0.4), LF_PLINTH_L, LF_PLINTH_W, 0.0, LF_PLINTH_Z, LF_PLINTH_MAT, rot=rot)
    b.box(*P(-0.4), LF_PLINTH_L + 0.85, LF_PLINTH_W + 0.75, 0.0, 0.42, LF_PLINTH_MAT, rot=rot)

    # 2. THE HULL, and its prow. THREE strakes, each shorter and narrower than
    #    the one under it, so the mass tapers instead of standing as one slab —
    #    the first cut was two equal boxes and read as a shed. Then the stem,
    #    rising clear of the deck ahead of the figure: that is what makes it a
    #    boat rather than a bench, and it has to be visible ABOVE the horses.
    b.box(*P(-0.20), 6.30, 2.55, LF_PLINTH_Z, LF_PLINTH_Z + 0.55, LF_BRONZE, rot=rot)
    b.box(*P(0.05), 5.60, 2.05, LF_PLINTH_Z + 0.55, LF_PLINTH_Z + LF_HULL_Z, LF_BRONZE, rot=rot)
    b.box(*P(0.45), 4.60, 1.55, LF_PLINTH_Z + LF_HULL_Z, LF_DECK_Z, LF_BRONZE, rot=rot)
    b.beam(*P(2.55), LF_PLINTH_Z + 0.80, *P(4.10), 4.05, 0.90, LF_BRONZE, steps=5)
    # The STERNPOST, rising aft. The first cut put a 1.15 x 1.60 box up to
    # DECK+0.55 back there and it read as a shipping container on the transom —
    # a deckhouse this work does not have. A post curving up out of the stern is
    # both the classical silhouette and half of what makes the thing read as a
    # ship at 300 m: prow up, waist low, stern up.
    b.beam(*P(-2.30), LF_PLINTH_Z + 0.70, *P(-3.35), 4.30, 0.66, LF_BRONZE, steps=5)

    # 3. COLUMBIA, standing on the prow — FORWARD on the deck, not amidships,
    #    which is both what the description says and what stops her merging into
    #    the stern. The raised arm is written low-end-first: beam() needs z0 < z1.
    fz, fa = LF_DECK_Z + 0.22, 2.05
    b.box(*P(fa), 1.60, 1.30, LF_DECK_Z, fz, LF_BRONZE, rot=rot)     # the prow deck
    b.figure(*P(fa), fz, LF_COLUMBIA_H, LF_BRONZE, wide=0.80)
    sh = fz + LF_COLUMBIA_H * 0.80                     # shoulder
    b.beam(*P(fa, 0.10), sh, *P(fa - 0.35, 0.60), fz + LF_COLUMBIA_H + 0.30,
           0.28, LF_BRONZE, steps=3)                   # the arm, up and out
    b.box(*P(fa - 0.35, 0.60), 0.28, 0.28,
          fz + LF_COLUMBIA_H + 0.30, LF_TORCH_TOP - 0.44, LF_BRONZE, rot=rot)
    b.dome(*P(fa - 0.35, 0.60), 0.44, LF_TORCH_TOP - 0.44, 0.44, LF_BRONZE, tiers=3, seg=8)
    # The other arm, held low and out — it is what stops her reading as a post.
    b.beam(*P(fa, -0.10), fz + LF_COLUMBIA_H * 0.58,
           *P(fa + 0.60, -0.66), fz + LF_COLUMBIA_H * 0.74, 0.24, LF_BRONZE, steps=3)

    # 4. THREE HIPPOCAMPI, drawing the ship. Forequarters out of the water, neck
    #    raking forward, forelegs pawing, a fish tail curling back under.
    #
    #    THE FIRST CUT READ AS THREE LEGS UNDER THE SHIP and the picture said so
    #    plainly: the chests were 1.55 x 1.05 boxes standing 1.15 m tall directly
    #    beneath the hull, and three vertical blocks under a mass is a table. Two
    #    things fix it and both are about SEPARATION, not detail. The team is
    #    pushed forward past the weir so it stands in the lower crescent with
    #    water between it and the hull, and its heads rear to 3.10 m — BELOW the
    #    3.55 m deck — so the silhouette is a low team drawing a high ship
    #    instead of one lump. Chests are slimmer for the same reason.
    for a0, s0, side in ((4.75, 0.0, 0.0),
                         (4.00, LF_HORSE_ACROSS, 1.0),
                         (4.00, -LF_HORSE_ACROSS, -1.0)):
        b.box(*P(a0, s0), 1.35, 0.90, LF_HORSE_Z, LF_HORSE_Z + 0.95, LF_BRONZE, rot=rot)
        # THE TEAM FANS. Heads splayed 0.55 m outboard rather than 0.16, and the
        # head box turned with them: parallel heads are three identical blocks
        # from dead ahead — which is the view from MLK, the one everybody has —
        # and a fanned team shows a profile from every direction. Same argument
        # as the Mustangs' headings.
        b.beam(*P(a0 + 0.20, s0), LF_HORSE_Z + 0.75,
               *P(a0 + 0.95, s0 + 0.35 * side), LF_HORSE_HEAD_Z - 0.34,
               0.52, LF_BRONZE, steps=4)                              # the neck
        b.box(*P(a0 + 1.24, s0 + 0.55 * side), 0.95, 0.44,
              LF_HORSE_HEAD_Z - 0.44, LF_HORSE_HEAD_Z, LF_BRONZE,
              rot=rot + 0.42 * side)                                  # head
        b.disc(*P(a0 + 0.72, s0 + 0.22 * side), 0.30,
               LF_HORSE_HEAD_Z - 0.58, LF_HORSE_HEAD_Z - 0.12, LF_BRONZE, seg=6)  # mane
        # A foreleg pawing the air. Written low-end-first; a hippocampus with no
        # legs is a fish, and the legs are half of what says "horse" in plan.
        b.beam(*P(a0 + 1.35, s0 - 0.30 * side), LF_HORSE_Z + 0.10,
               *P(a0 + 0.75, s0 - 0.14 * side), LF_HORSE_Z + 0.90,
               0.26, LF_BRONZE, steps=3)
        b.beam(*P(a0 - 0.75, s0), LF_HORSE_Z + 0.05,
               *P(a0 - 1.90, s0 - 0.42 * side), LF_HORSE_Z + 1.20,
               0.48, LF_BRONZE, steps=4)                              # the tail
        b.box(*P(a0 - 2.20, s0 - 0.56 * side), 0.85, 0.28,
              LF_HORSE_Z + 1.00, LF_HORSE_Z + 1.38, LF_BRONZE,
              rot=rot + 0.7 * side)                                   # the fluke

    # 5. THE ARMY AND THE NAVY, one each side of the hull, half out of the water.
    #    A LOW wave mass under each, not a plinth: the first cut used a 0.95 m
    #    disc standing 1.62 m and the pair read as two capped bollards. The wave
    #    only has to say "the water does not stop here", so it is under a metre
    #    and the figure's own torso does the rest.
    for side in (1.0, -1.0):
        b.disc(*P(-0.10, LF_FLANK_ACROSS * side), 0.78, 0.0, 1.28, LF_BRONZE, seg=8)
        b.figure(*P(-0.10, LF_FLANK_ACROSS * side), 1.28, LF_FLANK_H, LF_BRONZE, wide=0.70)
        b.beam(*P(-0.10, LF_FLANK_ACROSS * side), 1.28 + LF_FLANK_H * 0.62,
               *P(0.65, (LF_FLANK_ACROSS - 1.05) * side), 1.28 + LF_FLANK_H * 0.88,
               0.26, LF_BRONZE, steps=3)                              # arm to the hull

    stats["littlefield_parts"] += len(b.parts)
    return b.parts


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


# ── The Caven-Clark Courts, between Jester and the garage ─────────────
#
# "add the tennis / volleyball court between the buildings"
#
# THEY ARE ALREADY THERE AND THAT IS THE PROBLEM. `data/ground.geojson` carries
# four `k:'area', u:'pitch', sport:'basketball'` polygons here, tagged
# `s:'grass'` — so the app draws a plain green rectangle and nothing says it is
# a court. What makes a court read is not its surface, it is the WHITE LINES on
# it, the fence round it and the hoops at the ends, and none of those are a
# surface, so none of them are in the ground file.
#
# WHAT IS ACTUALLY THERE, off the z19 nadir tile and OSM way 1488977196: a
# fenced compound named **Caven-Clark Courts**, 36.7 x 54.4 m, holding four
# courts of 14.2 x 22.1 m in a 2x2 grid, each marked for basketball with a net
# post on the centre line — which is exactly the "tennis / volleyball" reading:
# they are multi-use, and the net across the middle is what you see from the
# air. The four court rings below are OSM ways 137469387, 1234456851/2/3,
# copied rather than fetched because a bake must not need the network.
#
# THE LINES ARE DRAWN 7x OVER-SCALE, and that is declared, not hidden. A real
# court line is 50 mm; at 50 mm it is far under a pixel from any altitude this
# app flies and the court would go back to being a green rectangle. 0.35 m is
# the same argument the road lane markings and the fountain risers already
# make in this repo.
#
# WHY IT LIVES IN bake_art.py: file ownership, and it is the same reason the
# chilled-water plant above does. This is authored scene geometry drawn by
# `props-artpart` out of the same material palette; it is not a sculpture, and
# when the ground lane can take it, `s:'pitch_hard'` plus these markings belong
# there. Written down so the next pass does not have to guess.
COURT_MARK_M   = 0.35    # over-scale line width, in metres
COURT_MARK_Z   = (0.06, 0.16)   # clear of the ground fill, low enough to read flat
COURT_FENCE_H  = 3.6
COURT_POST_EV  = 4.0     # metres between fence posts
COURT_NET_H    = 2.45    # volleyball net posts
COURT_RIM_H    = 3.05    # a basketball rim is 10 ft, and that is not negotiable
COURTS = [
    [(-97.735707, 30.281209), (-97.735560, 30.281198), (-97.735540, 30.281396), (-97.735686, 30.281407)],
    [(-97.735518, 30.281195), (-97.735371, 30.281184), (-97.735351, 30.281382), (-97.735498, 30.281393)],
    [(-97.735542, 30.280956), (-97.735395, 30.280945), (-97.735375, 30.281143), (-97.735522, 30.281154)],
    [(-97.735729, 30.280970), (-97.735582, 30.280959), (-97.735562, 30.281156), (-97.735709, 30.281168)],
]
COURT_FENCE = [(-97.735710, 30.281430), (-97.735330, 30.281401),
               (-97.735378, 30.280914), (-97.735761, 30.280945)]


# ── THE TWO FOOD TRUCKS, and why only two. ─────────────────────────────
#
# Simeon, 2026-08-04, three claims in one breath and he flagged his own
# uncertainty on the first two: "theres what looks like (not sure) a parking
# garage diagonall across in that same block. pretty sure there are food trucks
# in front of that parking garage almost on 21st ... add the food truck that is
# always in front of jester, and always in the PCL area".
#
# CHECKED, and the check is why this table has two rows and not three:
#
#   * The garage is REAL — Dobie Twenty21 Parking Garage, 2005 Whitis Ave,
#     the unnamed 12.4 m footprint at (-97.7412, 30.2828), diagonally
#     south-west of the Catholic Center. It is also permanently closed, and
#     NOTHING — not OSM, not UT's own food-truck list — puts a truck in front
#     of it. So no truck goes there. He asked to be checked; this is the check.
#   * "in front of jester" is LA FONDA, and it is already in OpenStreetMap:
#     node 2100 Speedway, `operator=University Housing and Dining`,
#     `opening_hours=Mo-Th 07:00-15:00`. Its POSITION IS FACTUAL.
#   * "the PCL area" is GUATEMALA LOVE, which UT's University Unions lists at
#     21st and Speedway in front of the PCL. There is no node for it, so its
#     position is generative — placed on the paving of the Speedway mall by the
#     corner named in that listing, checked against data/ground.geojson for
#     surface and against the baked footprints for clearance.
#
# The FORM is generative in both cases: a concession trailer, not a portrait of
# either truck. What identifies them is where they stand and the awning colour.
#
# `head` is the compass bearing the truck's LENGTH points along, so the serving
# side (local +y) faces the walkway: La Fonda serves west into the Speedway
# mall with Jester behind it, Guatemala Love serves east into the same mall
# with the PCL behind it.
TRUCK_L      = 6.20     # a 20 ft concession trailer, body only
TRUCK_W      = 2.35
TRUCK_WHEEL  = 0.62     # chassis clearance / wheel diameter
TRUCK_BODY   = 3.05     # roof line
TRUCK_VENT   = 0.42     # the air-conditioner on the roof, above that
TRUCK_WIN    = (1.55, 2.35, 3.30)   # sill, head, width of the serving hatch
TRUCK_AWN    = (2.60, 0.13, 1.05)   # underside, thickness, projection
TRUCK_BAND   = (0.70, 1.18)         # the livery stripe along the body sides
TRUCKS = [
    # name, lon, lat, head, awning material, provenance
    ("La Fonda", -97.737228, 30.2833029, 0.0, "gred",
     "osm node 2100 Speedway, University Housing and Dining"),
    # Pulled 18 m south of the 21st Street corner and hard against the library
    # side of the mall: the first placing put it mid-plaza, 39 m off any wall,
    # and a truck standing in open paving reads as abandoned. This spot is
    # 20 m off the PCL, on `s:'paving'` in data/ground.geojson.
    ("Guatemala Love", -97.737800, 30.283160, 180.0, "ggreen",
     "UT University Unions: 21st and Speedway in front of the PCL"),
]


def bake_food_trucks(stats):
    """Two campus food trucks, as concession trailers on the Speedway mall."""
    out = []
    for name, lon, lat, head, awn, _prov in TRUCKS:
        b = Build(name, lon, lat, head=head)
        hw, hd = TRUCK_L / 2, TRUCK_W / 2
        # chassis and wheels — the body has to sit ON something or it reads as
        # a shipping container lying on the paving
        b.box(0, 0, TRUCK_L - 1.1, TRUCK_W - 0.75, 0.14, TRUCK_WHEEL, "granite")
        for sx in (-1, 1):
            for sy in (-1, 1):
                b.box(sx * 1.75, sy * (hd - 0.16), 0.66, 0.26, 0.0, TRUCK_WHEEL, "granite")
        b.box(-hw - 0.55, 0, 1.10, 0.18, 0.30, 0.42, "steel")        # the hitch
        # the body
        b.box(0, 0, TRUCK_L, TRUCK_W, TRUCK_WHEEL, TRUCK_BODY, "white")
        b.box(0, 0, TRUCK_L + 0.14, TRUCK_W + 0.14, TRUCK_BODY, TRUCK_BODY + 0.13, "alum")
        b.box(0.9, 0, 0.85, 0.85, TRUCK_BODY + 0.13, TRUCK_BODY + 0.13 + TRUCK_VENT, "alum")
        # the livery stripe, both long sides, standing proud so it is not
        # z-fighting the body it is painted on
        z0, z1 = TRUCK_BAND
        for sy in (-1, 1):
            b.box(0, sy * (hd + 0.03), TRUCK_L - 0.10, 0.10, z0, z1, awn)
        # the serving hatch, its counter and its awning — all on +y
        sill, head_z, win_w = TRUCK_WIN
        b.box(0.35, hd + 0.04, win_w, 0.12, sill, head_z, "mirror")
        b.box(0.35, hd + 0.26, win_w + 0.30, 0.36, sill - 0.14, sill, "alum")
        a0, at, ap = TRUCK_AWN
        b.box(0.35, hd + ap / 2, win_w + 0.55, ap, a0, a0 + at, awn)
        for sx in (-1, 1):
            b.box(0.35 + sx * (win_w / 2 + 0.2), hd + ap - 0.06, 0.08, 0.08, sill, a0, "steel")
        out.extend(b.parts)
        stats["truck_" + name.replace(" ", "_")] += len(b.parts)
    return out


def _axes(pm):
    """Centre, long-axis unit vector, and the two half-extents of a quad."""
    cx = sum(x for x, _ in pm) / len(pm)
    cy = sum(y for _, y in pm) / len(pm)
    best, ax, ay = 0.0, 1.0, 0.0
    for i in range(len(pm)):
        x0, y0 = pm[i]
        x1, y1 = pm[(i + 1) % len(pm)]
        L = math.hypot(x1 - x0, y1 - y0)
        if L > best:
            best, ax, ay = L, (x1 - x0) / L, (y1 - y0) / L
    along = [(x - cx) * ax + (y - cy) * ay for x, y in pm]
    across = [-(x - cx) * ay + (y - cy) * ax for x, y in pm]
    return cx, cy, ax, ay, (max(along) - min(along)) / 2, (max(across) - min(across)) / 2


def bake_courts(stats):
    """White lines, hoops, net posts and a perimeter fence."""
    out = []
    z0, z1 = COURT_MARK_Z
    lon0, lat0 = COURTS[0][0]
    for ci, ring in enumerate(COURTS):
        b = Build("Caven-Clark Courts", lon0, lat0)
        pm = [to_m(x, y, lon0, lat0) for x, y in ring]
        cx, cy, ax, ay, hl, hw = _axes(pm)
        rot = math.atan2(ay, ax)
        # `hl` is along the court's long axis; the markings are all built in
        # that frame so a court that is not axis-aligned — none of these are —
        # gets its lines square to itself rather than square to the compass.
        def at(u, v):
            return cx + u * ax - v * ay, cy + u * ay + v * ax
        inset = 0.45
        L, Wd = hl - inset, hw - inset
        # the boundary
        for s in (1, -1):
            x, y = at(0, s * Wd)
            b.box(x, y, L * 2, COURT_MARK_M, z0, z1, "white", rot=rot)
            x, y = at(s * L, 0)
            b.box(x, y, COURT_MARK_M, Wd * 2, z0, z1, "white", rot=rot)
        # the centre line — the half-court line AND the line the net stands on
        x, y = at(0, 0)
        b.box(x, y, COURT_MARK_M, Wd * 2, z0, z1, "white", rot=rot)
        # the centre circle, as eight tangential segments rather than a filled
        # disc: a disc here would be a white plate, not a circle
        R = min(1.9, Wd * 0.35)
        SEGN = 8
        for i in range(SEGN):
            a = 2 * math.pi * (i + 0.5) / SEGN
            x, y = at(R * math.cos(a), R * math.sin(a))
            b.box(x, y, 2 * math.pi * R / SEGN * 1.15, COURT_MARK_M, z0, z1,
                  "white", rot=rot + a + math.pi / 2)
        # the key at each end: two side lines and the free-throw line
        keyw, keyd = min(2.45, Wd * 0.45), min(5.8, L * 0.5)
        for s in (1, -1):
            for t in (1, -1):
                x, y = at(s * (L - keyd / 2), t * keyw)
                b.box(x, y, keyd, COURT_MARK_M, z0, z1, "white", rot=rot)
            x, y = at(s * (L - keyd), 0)
            b.box(x, y, COURT_MARK_M, keyw * 2, z0, z1, "white", rot=rot)
        # the hoops. The pole stands OUTSIDE the baseline and the backboard
        # overhangs in, which is what makes a goal read as a goal from above.
        for s in (1, -1):
            px, py = at(s * (hl + 0.9), 0)
            b.box(px, py, 0.30, 0.30, 0.0, COURT_RIM_H + 1.0, "steel", rot=rot)
            bx, by = at(s * (hl - 0.35), 0)
            b.box(bx, by, 0.16, 1.80, COURT_RIM_H - 0.15, COURT_RIM_H + 0.95,
                  "white", rot=rot)
            rx, ry = at(s * (hl - 0.85), 0)
            b.disc(rx, ry, 0.42, COURT_RIM_H, COURT_RIM_H + 0.12, "gorange", seg=8)
        # the net across the middle
        for s in (1, -1):
            x, y = at(0, s * (hw + 0.25))
            b.box(x, y, 0.22, 0.22, 0.0, COURT_NET_H, "steel", rot=rot)
        x, y = at(0, 0)
        b.box(x, y, 0.10, hw * 2 + 0.5, COURT_NET_H - 1.05, COURT_NET_H,
              "steel", rot=rot)
        out.extend(b.parts)
        stats["court_%d" % ci] += len(b.parts)

    # the compound fence: posts and a top rail. NOT a mesh panel — a solid
    # 3.6 m slab round four courts would read as a windowless building, and
    # `fill-extrusion` has no way to be see-through.
    b = Build("Caven-Clark Courts", lon0, lat0)
    fm = [to_m(x, y, lon0, lat0) for x, y in COURT_FENCE]
    for i in range(len(fm)):
        x0, y0 = fm[i]
        x1, y1 = fm[(i + 1) % len(fm)]
        L = math.hypot(x1 - x0, y1 - y0)
        if L < 0.5:
            continue
        ang = math.atan2(y1 - y0, x1 - x0)
        n = max(2, int(round(L / COURT_POST_EV)))
        for k in range(n + 1):
            t = k / float(n)
            b.box(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 0.18, 0.18,
                  0.0, COURT_FENCE_H, "steel", rot=ang)
        b.box((x0 + x1) / 2, (y0 + y1) / 2, L, 0.10,
              COURT_FENCE_H - 0.22, COURT_FENCE_H, "steel", rot=ang)
    out.extend(b.parts)
    stats["court_fence"] += len(b.parts)
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

        head = HEADINGS.get(name)
        if head:
            stats["headed"] += 1
        b = Build(name, lon0, lat0, head=head[0] if head else None)
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

    # The Littlefield Fountain's memorial rides here too. It is not a `k:'art'`
    # feature in props.geojson — OSM maps the fountain as a water AREA, so there
    # is no node for the bronze to hang off — but it is authored artwork drawn by
    # the same layer with the same materials, and the alternative is a fifth
    # material palette in a file that already has one.
    feats.extend(bake_littlefield(stats))

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

    # ...and so do the Caven-Clark Courts, for the same reason.
    feats.extend(bake_courts(stats))

    # ...and the two campus food trucks. Read the note on TRUCKS for which
    # claims were checked and which one did not survive the check.
    feats.extend(bake_food_trucks(stats))

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
        # The measurement is an axis-aligned bbox and the piece may be turned,
        # so compare against the bbox the TABLE's rectangle would have at that
        # heading. Without this a correctly-rotated piece fails for being
        # rotated — The West at 27 deg reads 7.28 against a 5.60 m slab.
        want = max(dw, dd)
        head = HEADINGS.get(nm)
        if head:
            c, s = abs(math.cos(math.radians(head[0]))), abs(math.sin(math.radians(head[0])))
            want = max(dw * s + dd * c, dw * c + dd * s)
        if not (dh * 0.85 <= e[0] <= dh * 1.12):
            bad.append("%s: height %.2f, table says %.2f" % (nm, e[0], dh))
        if not (want * 0.72 <= w <= want * 1.25):
            bad.append("%s: span %.2f, table+heading say %.2f" % (nm, w, want))

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
            "form": "GENERATIVE - read off published descriptions and "
                    "photographs, and reduced to what a fill-extrusion can "
                    "express: prisms of ARBITRARY plan rotated to their own "
                    "member's heading, sliced only along the one axis the "
                    "extrusion forces (vertical for a beam, horizontal for a "
                    "shape lying in a wall)",
            "heading": "SOURCED where HEADINGS has an entry; the OSM footprint "
                       "is an axis-aligned buffered node and carries none",
        },
    }, indent=2))
    if bad:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
