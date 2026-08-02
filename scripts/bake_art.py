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
point. Nine overrides carry the pieces anyone would recognise; the other 25 get
a plinth and a form that at least says "statue" or "sculpture" rather than
"box". Every one of them is legible at 60 m, which is the distance that matters.

NONE OF THIS IS A CLAIM TO ACCURACY. The positions, names, artists and heights
are factual and come from OSM and the City of Austin's public-art inventory. The
FORMS are generative: they are read off photographs of the real works and
reduced to what fill-extrusion can express, which is stacked horizontal slabs.
A leaning I-beam becomes a short stack of offset slabs; a sphere becomes stacked
chords. Stated here rather than implied.

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


# ── per-piece recipes ─────────────────────────────────────────────────
#
# Each takes the builder, the footprint half-size in metres and the feature's own
# height, and is free to ignore both. Keyed on the exact `name` in props.geojson.

def art_monochrome(b, hw, hd, H):
    """Nancy Rubins, "Monochrome for Austin" — a burst of welded aluminium canoes.

    Fourteen long thin slabs radiating from one point above a short mast. The
    real thing is a chaotic sphere of boats; what survives reduction is the
    radiating silhouette, so that is what this draws.
    """
    b.disc(0, 0, 0.55, 0.0, H * 0.34, "steel")
    origin_z = H * 0.34
    n = 14
    for i in range(n):
        ang = 2 * math.pi * i / n + 0.21
        # Alternate lengths and rise so the burst is not a flat daisy.
        L = hw * (1.55 if i % 3 else 1.15)
        rise = H * (0.62 if i % 2 else 0.40)
        b.beam(0, 0, origin_z,
               L * math.cos(ang), L * math.sin(ang), origin_z + rise,
               0.34, "alum", steps=4)


def art_clockknot(b, hw, hd, H):
    """Mark di Suvero, "Clock Knot" — three leaning minium-red I-beams."""
    z = 0.0
    b.box(0, 0, hw * 0.9, hd * 0.9, 0.0, 0.35, "granite")
    legs = [(0.0, 1.0), (2.6, 1.0), (4.2, 1.0)]
    for i, (ang_off, _) in enumerate(legs):
        a = ang_off
        b.beam(hw * 0.85 * math.cos(a), hd * 0.85 * math.sin(a), 0.3,
               hw * 0.12 * math.cos(a + 2.0), hd * 0.12 * math.sin(a + 2.0), H,
               0.34, "steelred", steps=6)
    # The knot itself: a short horizontal member across the top.
    b.beam(-hw * 0.5, -hd * 0.2, H * 0.78, hw * 0.5, hd * 0.35, H * 0.9,
           0.36, "steelred", steps=3)


def art_thewest(b, hw, hd, H):
    """Donald Lipski, "The West" — a polished sphere held in a ring.

    The first cut made a 6-tier octagonal ball barely wider than its own post
    and it rendered as a mushroom. A sphere needs enough tiers that the
    silhouette curves and enough radius that it is obviously the subject: 9
    tiers, 12 sides, and it takes the whole footprint.
    """
    b.disc(0, 0, hw * 0.5, 0.0, 0.45, "granite", seg=12)
    r = min(hw, hd) * 0.95
    zc = 0.7 + r
    b.disc(0, 0, 0.22, 0.45, zc - r * 0.55, "steel")            # the stem
    b.ball(0, 0, r, zc, "mirror", tiers=9, seg=12)
    # The ring, standing PROUD of the sphere so it reads as holding it rather
    # than as a stripe painted on it: three thin discs a little wider than the
    # ball, around its equator.
    for dz, rr in ((-0.16, 1.10), (0.0, 1.16), (0.16, 1.10)):
        b.disc(0, 0, r * rr, zc + dz * r - 0.07, zc + dz * r + 0.07, "steel", seg=14)


def art_diana(b, hw, hd, H):
    """Anna Hyatt Huntington, "Diana the Huntress" — a bronze figure with a bow."""
    ph = b.plinth(hw * 1.1, hd * 1.1, "limest", 1.15)
    b.figure(0, 0, ph, H - ph, "bronze", wide=0.6)
    # The drawn bow: a tall thin arc beside her, and the raised arm to it.
    b.beam(-hw * 0.55, 0.0, ph + (H - ph) * 0.28,
           -hw * 0.55, 0.0, ph + (H - ph) * 0.95, 0.16, "bronze", steps=3)
    b.beam(0.0, 0.0, ph + (H - ph) * 0.72,
           -hw * 0.5, 0.0, ph + (H - ph) * 0.78, 0.22, "bronze", steps=3)


def art_austin(b, hw, hd, H):
    """Ellsworth Kelly, "Austin" — the white stone chapel with coloured glass.

    "austin building by ellsworth has chromatic circle of glass can you add that
    with the colors."

    THE FOOTPRINT IS IGNORED HERE, deliberately. OSM carries this as a 6 x 6 m
    square because it is a buffered NODE, and the building is 2,715 sq ft --
    18.3 x 8.2 m, with a 8.0 m ridge. Drawing Kelly's chapel at 6 x 6 would be
    drawing a different building, and this is the one piece on campus somebody
    would notice, so the real dimensions win over the footprint. Every other
    recipe in this file respects its footprint.

    THE COLOUR IS THE POINT, and it goes on ALL THREE glazed walls -- the colour
    grid on the south, the spectrum on the east, the chromatic circle on the
    west -- because from a flying camera you cannot choose which face you get,
    and a chapel whose colour is on the one wall you happen not to see is the
    grey box again. fill-extrusion cannot glaze a wall, so each panel is its own
    prism standing proud of the stone, the same trick as the Tower's window
    slots.
    """
    W, D = 18.3, 8.2                    # sourced: 2,715 sq ft, long axis N-S
    hw, hd = W / 2, D / 2
    H = 8.0
    wall_h = 5.6
    t = 0.6
    # Four stone walls rather than one solid mass, so the vault reads as a roof
    # sitting ON something instead of as a lid on a block.
    b.box(0,  hd - t / 2, W, t, 0.0, wall_h, "white")
    b.box(0, -hd + t / 2, W, t, 0.0, wall_h, "white")
    b.box( hw - t / 2, 0, t, D - t * 2, 0.0, wall_h, "white")
    b.box(-hw + t / 2, 0, t, D - t * 2, 0.0, wall_h, "white")
    # ONE barrel vault, running the LONG axis. The first cut stacked chords that
    # shrank in x while staying full depth in y, which crossed the walls and
    # rendered as a plus sign from the air.
    tiers = 6
    for i in range(tiers):
        f0, f1 = i / tiers, (i + 1) / tiers
        dd = D * math.sqrt(max(0.0, 1.0 - ((f0 + f1) / 2) ** 2))
        b.box(0, 0, W, dd, wall_h + (H - wall_h) * f0, wall_h + (H - wall_h) * f1, "white")

    prd = 0.34                          # how far a panel stands proud of the stone
    # SOUTH: the colour grid, 3 rows of 4.
    for r in range(3):
        for c in range(4):
            mat = GLASS_SPECTRUM[(r * 4 + c) % len(GLASS_SPECTRUM)]
            x = -W * 0.34 + (W * 0.68) * c / 3
            z = 1.0 + 3.6 * r / 3
            b.box(x, -hd - prd / 2, W * 0.13, prd, z, z + 1.05, mat)
    # EAST: the spectrum, six tall thin lights.
    for i, mat in enumerate(GLASS_SPECTRUM):
        y = -D * 0.32 + (D * 0.64) * i / (len(GLASS_SPECTRUM) - 1)
        b.box(hw + prd / 2, y, prd, D * 0.075, 1.1, wall_h - 0.9, mat)
    # WEST: the chromatic circle, twelve blocks round a ring.
    rc, n = 1.9, 12
    for i in range(n):
        a = 2 * math.pi * i / n
        b.box(-hw - prd / 2, rc * math.sin(a), prd, 0.72,
              wall_h * 0.55 + rc * math.cos(a) - 0.36,
              wall_h * 0.55 + rc * math.cos(a) + 0.36,
              GLASS_SPECTRUM[i % len(GLASS_SPECTRUM)])


def art_turtle(b, hw, hd, H):
    """Dylan Connor, "Sea Turtle" — a bronze turtle on a low base."""
    ph = b.plinth(hw * 1.2, hd * 1.2, "limest", 0.7)
    r = min(hw, hd) * 0.85
    b.dome(0, 0, r, ph, r * 0.8, "bronze", tiers=3, seg=10)      # the shell
    b.box(0, r * 0.95, ph + r * 0.1, ph + r * 0.42, 0, 0, "bronze") if False else None
    b.disc(0, r * 0.9, r * 0.3, ph + r * 0.05, ph + r * 0.4, "bronze")   # head
    for sx, sy in ((0.8, 0.55), (-0.8, 0.55), (0.75, -0.6), (-0.75, -0.6)):
        b.box(r * sx, r * sy, r * 0.55, r * 0.3, ph, ph + r * 0.18, "bronze",
              rot=math.atan2(sy, sx))


def art_mustangs(b, hw, hd, H):
    """A. P. Proctor, "Mustangs" — a herd of bronze horses on a long plinth."""
    ph = b.plinth(hw * 1.6, hd * 1.1, "limest", 0.85)
    for i, (dx, dy, s) in enumerate(((-0.62, 0.1, 1.0), (0.0, -0.15, 1.1), (0.66, 0.12, 0.95))):
        x, y = hw * dx, hd * dy
        bodyz = ph + (H - ph) * 0.36
        b.box(x, y, hw * 0.62 * s, hd * 0.26 * s, bodyz, ph + (H - ph) * 0.78, "bronze",
              rot=0.12 * i)
        for lx in (-0.24, 0.24):
            b.box(x + hw * lx * s, y, hw * 0.1, hd * 0.1, ph, bodyz, "bronze")
        b.box(x + hw * 0.3 * s, y, hw * 0.2, hd * 0.18, ph + (H - ph) * 0.7, H, "bronze")


def art_circletowers(b, hw, hd, H):
    """Sol LeWitt, "Circle with Towers" — a concrete-block ring with towers."""
    r = min(hw, hd) * 0.92
    n = 16
    for i in range(n):
        a = 2 * math.pi * i / n
        b.box(r * math.cos(a), r * math.sin(a), 0.5, 0.5, 0.0, H * 0.42, "limest", rot=a)
    for i in range(8):
        a = 2 * math.pi * i / 8 + math.pi / 8
        b.box(r * math.cos(a), r * math.sin(a), 0.62, 0.62, 0.0, H, "limest", rot=a)


def art_torchbearers(b, hw, hd, H):
    """Charles Umlauf, "The Torchbearers" — two bronze figures passing a torch."""
    ph = b.plinth(hw * 1.25, hd * 1.25, "granite", 1.0)
    b.figure(-hw * 0.32, 0.0, ph, (H - ph) * 0.98, "bronze", wide=0.5)
    b.figure(hw * 0.34, hd * 0.1, ph, (H - ph) * 0.9, "bronze", wide=0.5)
    b.beam(-hw * 0.32, 0.0, ph + (H - ph) * 0.85,
           hw * 0.34, hd * 0.1, ph + (H - ph) * 0.9, 0.14, "bronze", steps=3)


def art_lonestar(b, hw, hd, H):
    """A five-pointed Texas star, standing on edge."""
    b.box(0, 0, hw * 0.5, hd * 0.5, 0.0, H * 0.3, "granite")
    R, r = min(hw, hd) * 1.0, min(hw, hd) * 0.42
    cz = H * 0.3 + R
    for i in range(5):
        a = math.pi / 2 + 2 * math.pi * i / 5
        b.beam(0, 0, cz, 0.0, 0.0, cz, 0.3, "bronze", steps=1)
        b.box(0, 0, 0.34, r * 2, cz + R * math.sin(a) * 0.0, cz, "bronze")
    # the star arms, as slabs radiating in the vertical plane
    for i in range(5):
        a = math.pi / 2 + 2 * math.pi * i / 5
        b.beam(0, 0, cz, 0.0, R * math.cos(a), cz + R * math.sin(a), 0.34, "bronze", steps=3)


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

    print(json.dumps({
        "pieces": len(authored),
        "parts": len(feats),
        "file_kb": round(os.path.getsize(OUT) / 1024, 1),
        "counts": dict(sorted(stats.items())),
        "provenance": {
            "position, name, artist, height": "factual - OSM and the City of Austin inventory",
            "form": "GENERATIVE - read off photographs and reduced to stacked "
                    "horizontal slabs, which is all fill-extrusion can express",
        },
    }, indent=2))


if __name__ == "__main__":
    main()
