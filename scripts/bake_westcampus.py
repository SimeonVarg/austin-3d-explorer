# -*- coding: utf-8 -*-
"""The ten West Campus student high-rises, as STACKED GEOMETRY BANDS.

THE PROBLEM, measured. Ten towers between 55 and 82 m sit in the four blocks the
camera flies through most, and every one of them arrives from Overture as a
single prism extruded to `final_height` wearing ONE facade tile. A wall pattern
has no vertical anchor (see docs/PASS_COMMON.md section 3), so "nine levels of
parking with apartments on top" — which is literally what The Castilian is — can
not be said at all: whatever tile the base wants repeats to the roofline. Ten
buildings of the same generation, one texture each, is the largest remaining
area of "generic" in the scene.

WHAT THIS DOES. Each tower is emitted as a vertical STACK of features, the shape
`scripts/bake_stadium.py` uses for DKR:

    base     the ground floor. Double-height glazed lobby/retail on the modern
             ones, painted masonry with deep openings on Dobie. ALWAYS its own
             band, because a 5 m ground floor is 8% of a 60 m tower and the tile
             cannot reach it any other way.
    podium   structured parking, where the building actually has some ABOVE
             grade. Family `dk` — open horizontal decks with a bright spandrel
             edge, no glass.
    tower    the residential shaft.
    crown    parapet / mechanical screen / arcade. Family `sf` mostly: a
             near-solid band whose whole job is to STOP the window grid before
             the roofline.

plus, where the references show them: projecting per-floor BALCONY slabs, an
AMENITY DECK with a pool and a shade structure, a MECHANICAL PENTHOUSE, and a
crown SIGN. Those are `kind:"solid"` and carry a class in `s`, coloured by
js/westcampus.js off a day/golden/night trio — the same shape app.js uses for
the stadium seating.

THE THING THE BRIEF GOT WRONG, and it matters. The pass brief says "almost every
one of these is four to seven levels of structured PARKING at the base". That is
true of the OLD ones and false of the new ones, and the difference is Austin's
University Neighborhood Overlay: on these small lots the 2013-2020 towers put
their parking UNDERGROUND and their pool on the ROOF.

    The Castilian (1967)   levels 2-10 are the garage, amenities on 11  [sourced]
    Dobie (1972)           two-level mall + garage, pool deck on its roof [aerial]
    Moontower (2020)       "four floors of below-grade parking"          [sourced]
    Inspire on 22nd (2019) "four stories of underground private parking" [sourced]
    Cambridge (1965)       underground garage + porte-cochere            [sourced]

So `podium` is present on two of the ten, not nine, and the amenity deck is on
the ROOF for six of them. Sources are in docs/PASS_WESTCAMPUS.md, per building,
each marked sourced or generative.

Usage:  python scripts/bake_westcampus.py
"""
import json
import math
import os
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SNAP = os.path.join(ROOT, "data", "snapshots", "2026-07-30", "buildings.detailed.geojson")
OUT = os.path.join(ROOT, "data", "westcampus.geojson")
M_LAT = 111320.0

# ── Shared taste block. One line per axis of variation. ───────────────
BALC_PROJ = 1.40       # m a balcony slab projects past the wall face
BALC_THICK = 0.34      # m of slab. Below ~0.3 it stops reading at cruise.
BALC_BITE = 0.15       # m the slab starts INSIDE the wall, so there is no gap
BALC_MARGIN = 1.6      # m held back from each end of the elevation
DECK_SLAB = 0.30       # m the amenity deck slab stands above its band top
DECK_INSET = 1.6       # m the deck is held in from the parapet
DECK_ITEM = 0.10       # m thick: pool water, turf, sport court
SHADE_H = 3.2          # m to the underside of a shade structure
SHADE_T = 0.28
FURN_H = 0.75          # m of cabana / furniture cluster
# Anything standing on the amenity deck clamps to this far BELOW final_height,
# not to final_height itself. The mechanical penthouse is already drawn topping
# out at exactly final_height — that is deliberate, the LiDAR high point IS the
# penthouse — so a shade trellis or a crown sign clamped to the same number
# lands its top face exactly coplanar with the penthouse's. Two coplanar tops
# have no draw order and flicker as the camera moves. Moontower had three
# surfaces at 57.30 m: the penthouse, the trellis and the sign. The penthouse is
# the tallest thing on a real roof anyway. See docs/PASS_GLITCH.md.
ROOF_CLEAR = 0.35
SIGN_T = 0.5           # m thick crown sign plate

# `s` classes below are coloured by js/westcampus.js, NOT by the facade atlas.
# Anything drawn as a flat colour goes through there; anything with a texture is
# a `kind:"wall"` band and goes through quantiseStadiumFacades().


def wall_ramp(hex_col):
    """day -> (golden, night), the same relationship scripts/bake_detail.py uses.

    Carried here rather than snapped to the city's fourteen shared buckets for
    the reason bake_stadium.py documents: nearest-RGB against a palette that is
    mostly tan turns Callaway's red brick and Dobie's teal glass back into tan,
    which erases the only two buildings in the group with a different material.
    """
    c = [int(hex_col[i:i + 2], 16) for i in (1, 3, 5)]
    mixc = lambda a, b, t: [a[i] + (b[i] - a[i]) * t for i in range(3)]
    golden = mixc(c, [255, 190, 130], 0.16)
    night = mixc([v * 0.19 for v in c], [18, 22, 40], 0.42)
    hexify = lambda v: "#" + "".join("%02x" % max(0, min(255, int(round(x)))) for x in v)
    return hexify(golden), hexify(night)


# ── Shared material hexes. ───────────────────────────────────────────
# The atlas is repainted IN FULL on every time-of-day tick and the cost is per
# IMAGE, not per building (js/facades.js, above quantiseOuterFacades). The first
# cut of the table below authored a crown colour and a base colour per building
# and cost 32 new images. Nine of those crowns were pale greys within 9 RGB
# units of each other, which is invisible at any range this app flies at — so
# materials that really are the same material now share a hex, and only the
# things that genuinely differ get their own. 32 -> 19.
BASE_GLASS = "#454b51"      # two-storey dark glazed lobby/retail, six towers
BASE_CHAR = "#3c4247"       # Moontower's is a shade darker, and reads
MASONRY = "#cfc9be"         # pale painted masonry base: Dobie, Castilian, Cambridge
CROWN_WARM = "#aca79f"      # painted-metal / stucco mechanical screen
CROWN_COOL = "#9aa1a6"
CROWN_CREAM = "#c9c3b7"     # The Castilian, 1967 concrete
CROWN_GREY = "#6f7679"      # Moontower
CROWN_TEAL = "#4f6268"      # Dobie's dark spandrel, carried into the notched cap
PANEL_WARM = "#b8b1a5"      # warm off-white fibre-cement: 21 Rio, Inspire

# ── The parameter table. Every building is the SAME system; only these
#    values differ. Provenance for each row is docs/PASS_WESTCAMPUS.md.
#
#    base    (height_m, family, colour)      the ground floor
#    podium  (levels, f2f_m, family, colour) ABOVE-GRADE parking, or None
#    tower   (family, colour)
#    crown   (height_m, family, colour)
#    mech    metres of mechanical penthouse above the parapet, or 0. The
#            building's `final_height` is a LiDAR high point, so the penthouse
#            is cut OUT of it rather than added on — same call union24.js makes
#            for its 94.4 m parapet under a baked 97.5.
#    deck    where the amenity deck sits: 'podium' | 'step' | 'roof' | None
#    balc    (faces, first_floor, floors) or None. faces: 'long' | 'both'
#    step    (fraction_of_long_axis, side, top_m) — a lower wing, or None
#    tplan   None, or (inset_m, du, dv, rot_deg, chamfer_m): a SEPARATE tower
#            footprint sitting on the podium, for the one building where the
#            source polygon is the podium and not the tower.
BUILDINGS = {
    # ── Dobie Twenty21, 1972, J. & G. Daverman. 27-storey tower on a two-level
    # mall + garage podium. The 1990 retrofit stripped the brick and left the
    # green vision glass, so this is the only curtain wall in the group — hence
    # family `tg` (51% glazing) where everything else is punched.
    # The source polygon is the WHOLE BLOCK (4,998 m2, 86 x 70 m). The tower is
    # a chamfered square rotated 45 deg to the grid, ~42 m across the diagonal,
    # measured off the z20 nadir against a 10 m grid — so it gets `tplan`.
    "Dobie Twenty21": dict(
        base=(6.0, "sp", MASONRY),
        podium=(3, 3.6, "dk", "#c8c2b7"),
        tower=("tg", "#5f7a80"),
        crown=(5.0, "sf", CROWN_TEAL),
        mech=4.5, deck="podium", balc=None, step=None,
        tplan=(0.0, 10.5, -2.0, 45.0, 6.0, 21.0),
        pool=(-17.0, 22.0, 11.0, 10.0),
        turf=(26.0, -2.0, 13.0, 22.0), court=(24.0, -20.0, 11.0, 8.0),
    ),
    # ── 21 Rio, 2009, 21 storeys, 158 units. Private balconies on every unit and
    # a rooftop pool are both in the leasing material. The nadir shows one roof
    # plane with a central mechanical penthouse and no podium setback, so the
    # parking is behind the facade or below grade: no `dk` band.
    "21 Rio": dict(
        base=(6.2, "sg", BASE_GLASS),
        podium=None,
        tower=("tr", PANEL_WARM),
        crown=(4.0, "sf", CROWN_WARM),
        mech=4.0, deck="roof", balc=("long", 2, 19), step=None, tplan=None,
        pool=(0.0, -9.0, 5.0, 11.0),
    ),
    # ── Signature 1909, 2018, 17 storeys. Stepped: a lower north wing carries
    # the pool deck and the shade trellis (both visible in the z20 nadir), the
    # tower runs on to 17. White panel with a dark spandrel at every floor, which
    # is family `sb` — deep horizontal bands with slim fins — not a punched grid.
    "Signature 1909": dict(
        base=(5.2, "sg", BASE_GLASS),
        podium=None,
        tower=("sb", "#a8a6a6"),
        crown=(3.6, "sf", CROWN_WARM),
        mech=3.5, deck="step", balc=None,
        step=(0.42, "n", 30.5), tplan=None,
        pool=(0.0, 8.0, 5.0, 12.0), shade=(0.0, -6.0, 9.0, 7.0),
    ),
    # ── The Callaway House Austin, 2014, American Campus Communities, 17
    # storeys. The one brick building in the group — the bake already carries
    # #a2614b for it, which is why protecting the colour from the city palette
    # matters. Family `sn` (brick veneer, punched windows, pier towers).
    # Footprint is a C around a courtyard; the courtyard deck is the amenity
    # space and it sits at podium level.
    "The Callaway House Austin": dict(
        base=(5.4, "sp", "#8f6552"),
        podium=None,
        tower=("sn", "#a2614b"),
        crown=(3.8, "sf", CROWN_WARM),
        mech=3.5, deck="roof", balc=None, step=None, tplan=None,
        pool=(-6.0, -4.0, 5.0, 11.0),
    ),
    # ── The Castilian, 1967, 22 storeys. THE podium case, and the reason this
    # pass exists: level 1 is retail, levels 2-10 are the parking garage, level
    # 11 is the amenity floor, 12-22 are rooms. Nine levels of open deck at the
    # bottom of a 60 m building is 45% of its elevation.
    # 1960s floor-to-floor: 22 floors in 60 m is 2.7 m, so the garage is 2.8 and
    # the rooms are 2.6 — entered, not averaged, because the two differ.
    "The Castilian": dict(
        base=(4.6, "sp", MASONRY),
        podium=(9, 2.80, "dk", "#c8c2b7"),
        tower=("mh", "#d5cfc2"),
        crown=(3.2, "sf", CROWN_CREAM),
        mech=3.0, deck="podium", balc=None, step=None, tplan=None,
        shade=(0.0, 0.0, 10.0, 8.0),
    ),
    # ── Ion Austin, 19 storeys, LEED Silver. Light panel with scattered
    # terracotta and blue-grey accent panels and a full-height glazed stair core
    # at the north corner; two-level glazed base. The pool sits on a setback
    # terrace at the SOUTH end, several floors below the roof (nadir).
    "Ion Austin": dict(
        base=(7.0, "sg", BASE_GLASS),
        podium=None,
        tower=("tr", "#b0aeaa"),
        crown=(3.8, "sf", CROWN_WARM),
        mech=3.5, deck="step", balc=None,
        step=(0.26, "s", 21.0), tplan=None,
        pool=(0.0, -4.0, 5.0, 13.0), shade=(0.0, 7.0, 8.0, 6.0),
    ),
    # ── Skyloft, 2018, 18 storeys, 442,000 sq ft. The source polygon has TWO
    # 63 m2 holes in it and they are real: the z20 nadir shows two light wells
    # cut clean through the roof plane. They are carried through every band, so
    # this is the only tower in West Campus with courtyards you can see down.
    # Pool on the main roof at the south end (nadir).
    "Skyloft Austin": dict(
        base=(6.2, "sg", BASE_GLASS),
        podium=None,
        tower=("tr", "#93a3ac"),
        crown=(4.0, "sf", CROWN_COOL),
        mech=3.8, deck="roof", balc=None, step=None, tplan=None,
        pool=(2.0, -22.0, 5.0, 12.0),
    ),
    # ── Moontower, 2020, Gensler. Seventeen residential floors over four levels
    # of BELOW-grade parking, so no `dk` band. Two-tone rainscreen: near-white
    # fibre-cement panel against a charcoal panel in broad vertical strips, over
    # a two-storey dark glazed base. A lit orange MOONTOWER sign stands on the
    # north parapet — modelled, and it is the only crown signage in the group.
    "Moontower": dict(
        base=(7.4, "sg", BASE_CHAR),
        podium=None,
        tower=("tr", "#7d8a8e"),
        crown=(3.8, "sf", CROWN_GREY),
        mech=3.4, deck="roof", balc=None, step=None, tplan=None,
        pool=(-8.0, 0.0, 5.0, 10.0), shade=(7.0, 0.0, 8.0, 9.0),
        sign=(0.0, 1.0, 13.0, 2.6),
    ),
    # ── Inspire on 22nd, 2019, 18 storeys, 439 beds, four levels of underground
    # parking. Rooftop pool and an 18th-floor entertainment room. The smallest
    # footprint of the ten (1,233 m2) — a near-square tower.
    "Inspire on 22nd": dict(
        base=(6.0, "sg", BASE_GLASS),
        podium=None,
        tower=("tr", PANEL_WARM),
        crown=(3.8, "sf", CROWN_WARM),
        mech=3.4, deck="roof", balc=None, step=None, tplan=None,
        pool=(0.0, -7.0, 5.0, 10.0),
    ),
    # ── Cambridge Tower, 1965, Thomas E. Stanley. New Formalism, on the National
    # Register since 2018 — and completely unlike the other nine. A 23 m thin
    # slab, 86 m long, with a CONTINUOUS balcony at every floor whose parapet is
    # Stanley's pierced "Solar Unit" breeze block, and thin columns that sweep
    # into an arcade of arches at the cornice.
    # The crown therefore uses `sp` — piers with deep openings between them,
    # which is what an arcade is — rather than the blank `sf` everything else
    # gets. The balconies are real geometry: fifteen slabs per long elevation.
    "Cambridge Tower": dict(
        base=(5.0, "sg", BASE_GLASS),
        podium=None,
        tower=("sb", "#cbc6ba"),
        crown=(4.6, "sp", MASONRY),
        mech=2.6, deck="roof", balc=("long", 1, 15), step=None, tplan=None,
        shade=(0.0, -26.0, 9.0, 10.0),
    ),
}

# Flat-coloured pieces. js/westcampus.js carries the day/golden/night trio for
# each of these `s` classes; nothing here enters the facade atlas.
SOLID_CLASSES = ("deck", "pool", "turf", "court", "shade", "furn", "mech", "balc", "sign")


# ── geometry helpers (the same ones bake_stadium.py uses) ─────────────
def signed_area(pts):
    a = 0.0
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        a += x0 * y1 - x1 * y0
    return a * 0.5


def ccw(pts):
    p = pts[:-1] if pts[0] == pts[-1] else pts[:]
    if signed_area(p + [p[0]]) < 0:
        p = p[::-1]
    return p


def offset(pts, d):
    """Offset a closed ring by d metres; POSITIVE grows it. None if degenerate."""
    p = ccw(pts)
    n = len(p)
    if n < 3:
        return None
    lines = []
    for i in range(n):
        x0, y0 = p[i]
        x1, y1 = p[(i + 1) % n]
        dx, dy = x1 - x0, y1 - y0
        L = math.hypot(dx, dy)
        if L < 1e-9:
            return None
        nx, ny = dy / L, -dx / L
        lines.append((x0 + nx * d, y0 + ny * d, dx, dy))
    out = []
    for i in range(n):
        ax, ay, adx, ady = lines[i - 1]
        bx, by, bdx, bdy = lines[i]
        den = adx * bdy - ady * bdx
        if abs(den) < 1e-9:
            return None
        t = ((bx - ax) * bdy - (by - ay) * bdx) / den
        out.append((ax + adx * t, ay + ady * t))
    ring = out + [out[0]]
    if signed_area(ring) <= 1.0:
        return None
    return ring


def to_m(ring, lon0, lat0):
    k = math.cos(math.radians(lat0))
    return [((p[0] - lon0) * M_LAT * k, (p[1] - lat0) * M_LAT) for p in ring]


def to_ll(pts, lon0, lat0):
    k = math.cos(math.radians(lat0))
    ring = list(pts)
    if ring[0] != ring[-1]:
        ring = ring + [ring[0]]
    return [[round(lon0 + x / (M_LAT * k), 7), round(lat0 + y / M_LAT, 7)] for (x, y) in ring]


def obb(pts):
    """Minimum-area rectangle: (angle_rad, u0, u1, v0, v1) in the ring's frame.

    Rotating calipers over the ring's own edge directions. This is what gives
    every building a LOCAL (u, v) frame, so 'the long elevations' and 'the north
    40% of the plan' mean the same thing on a block that does not sit square to
    north — the same reason bake_stadium.py measures its sectors from the field's
    own long axis instead of from the compass.
    """
    best = None
    n = len(pts)
    for i in range(n):
        dx = pts[(i + 1) % n][0] - pts[i][0]
        dy = pts[(i + 1) % n][1] - pts[i][1]
        L = math.hypot(dx, dy)
        if L < 1e-6:
            continue
        c, s = dx / L, dy / L
        us = [x * c + y * s for x, y in pts]
        vs = [-x * s + y * c for x, y in pts]
        w, h = max(us) - min(us), max(vs) - min(vs)
        if best is None or w * h < best[0]:
            best = (w * h, math.atan2(dy, dx), min(us), max(us), min(vs), max(vs))
    _, ang, u0, u1, v0, v1 = best
    # Point the long axis along +u so 'long elevation' is unambiguous.
    if (u1 - u0) < (v1 - v0):
        ang += math.pi / 2
        u0, u1, v0, v1 = v0, v1, -u1, -u0
    return ang, u0, u1, v0, v1


def uv_to_xy(ang, u, v):
    c, s = math.cos(ang), math.sin(ang)
    return (u * c - v * s, u * s + v * c)


def rect_uv(ang, u0, v0, u1, v1):
    return [uv_to_xy(ang, u0, v0), uv_to_xy(ang, u1, v0),
            uv_to_xy(ang, u1, v1), uv_to_xy(ang, u0, v1)]


def clip_halfplane(ring, nx, ny, d):
    """Sutherland-Hodgman against {p : p.n <= d}. Ring is open (no repeat)."""
    out = []
    n = len(ring)
    for i in range(n):
        a, b = ring[i], ring[(i + 1) % n]
        da = a[0] * nx + a[1] * ny - d
        db = b[0] * nx + b[1] * ny - d
        if da <= 0:
            out.append(a)
        if (da <= 0) != (db <= 0):
            t = da / (da - db)
            out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    return out if len(out) >= 3 else None


def chamfered_square(half, chamfer, rot, du, dv):
    """The Dobie tower plan: a square rotated `rot` degrees off the block grid
    with its four corners cut. Measured off the z20 nadir; see the doc."""
    r = math.radians(rot)
    pts = []
    for sx, sy in ((1, 1), (-1, 1), (-1, -1), (1, -1)):
        # two points per corner, the chamfer between them
        a = (sx * half, sy * (half - chamfer))
        b = (sx * (half - chamfer), sy * half)
        pts += [a, b] if sx * sy > 0 else [b, a]
    c, s = math.cos(r), math.sin(r)
    return [(x * c - y * s + du, x * s + y * c + dv) for x, y in pts]


# ── emit ──────────────────────────────────────────────────────────────
# js/app.js's parapet rule, restated here because the bake has to know where the
# top of the cap IS: a roof deck placed at the parapet is BURIED by it. The cap
# is a solid extrusion of the whole footprint from h to h+lift, not a ring, so
# anything standing on the roof has to start above it.
cap_lift = lambda h: max(1.0, 0.015 * h)

# A parapet coping is not the wall it sits on. Reusing the wall colour is what
# js/outer.js calls "a cap you cannot see is a draw call you are paying for", so
# the coping is pulled toward a cool light grey — cool because an extrusion's TOP
# face picks up the sun tint and renders far warmer than the value entered.
COPING = [188, 192, 196]
COPING_MIX = 0.34


def wall_feature(rings_m, base, top, fam, col, band, name, cap, lon0, lat0, stack="main"):
    wg, wn = wall_ramp(col)
    extra = {}
    if cap:
        c = [int(col[i:i + 2], 16) for i in (1, 3, 5)]
        rd = "#" + "".join("%02x" % int(round(c[i] + (COPING[i] - c[i]) * COPING_MIX))
                           for i in range(3))
        rg, rn = wall_ramp(rd)
        extra = {"rd": rd, "rg": rg, "rn": rn}
    return {
        "type": "Feature",
        "geometry": {"type": "Polygon",
                     "coordinates": [to_ll(r, lon0, lat0) for r in rings_m]},
        "properties": {
            "kind": "wall", "band": band, "fam": fam,
            "wd": col, "wg": wg, "wn": wn,
            "base": round(base, 2), "h": round(top, 2),
            "name": name, "cap": 1 if cap else 0, "stack": stack, **extra,
        },
    }


def solid_feature(ring_m, base, top, cls, name, lon0, lat0):
    return {
        "type": "Feature",
        "geometry": {"type": "Polygon", "coordinates": [to_ll(ring_m, lon0, lat0)]},
        "properties": {"kind": "solid", "s": cls,
                       "base": round(base, 2), "h": round(top, 2), "name": name},
    }


def build(feature, spec, stats):
    p = feature["properties"]
    name = p["name"]
    H = p["final_height"]
    rings_ll = feature["geometry"]["coordinates"]
    lon0 = sum(q[0] for q in rings_ll[0][:-1]) / (len(rings_ll[0]) - 1)
    lat0 = sum(q[1] for q in rings_ll[0][:-1]) / (len(rings_ll[0]) - 1)
    rings = [ccw(to_m(r, lon0, lat0)) for r in rings_ll]
    outer = rings[0]
    holes = rings[1:]
    ang, u0, u1, v0, v1 = obb(outer)

    out = []
    # ── vertical stack ------------------------------------------------
    bh, bfam, bcol = spec["base"]
    z = bh
    stack = [("base", 0.0, bh, bfam, bcol)]
    if spec["podium"]:
        lv, f2f, pfam, pcol = spec["podium"]
        top = z + lv * f2f
        stack.append(("podium", z, top, pfam, pcol))
        z = top
    crown_h, cfam, ccol = spec["crown"]
    mech_h = spec.get("mech") or 0.0
    parapet = H - mech_h
    tower_top = parapet - crown_h
    if tower_top <= z + 2.0:
        stats["stack_too_short"] += 1
        tower_top = z + 2.0
    # Where anything standing ON the roof has to start: on top of the parapet
    # coping, not at the parapet. wc-wall-cap extrudes the WHOLE footprint from
    # h to h + cap_lift(h), so a deck at the parapet is inside it and invisible.
    roof_z = parapet + cap_lift(parapet)
    tfam, tcol = spec["tower"]
    stack.append(("tower", z, tower_top, tfam, tcol))
    stack.append(("crown", tower_top, parapet, cfam, ccol))
    podium_top = z

    # ── the plan each band stands on ---------------------------------
    # `tplan` splits podium from tower: the source polygon IS the podium, and
    # the shaft is a separate, smaller footprint sitting on it. Only Dobie needs
    # this, and without it Dobie draws a 4,998 m2 82 m mesa over half a block.
    tplan = spec.get("tplan")
    if tplan:
        _, du, dv, rot, cham, half = tplan
        tower_rings = [chamfered_square(half, cham, rot + math.degrees(ang), du, dv)]
    else:
        tower_rings = [outer] + holes

    # `step` clips a lower wing off one end of the long axis. Its bands stop at
    # `top` and the amenity deck sits on it.
    step = spec.get("step")
    step_rings = step_top = None
    if step:
        frac, side, step_top = step
        cut = u0 + (u1 - u0) * frac if side in ("s", "w") else u1 - (u1 - u0) * frac
        nx, ny = math.cos(ang), math.sin(ang)
        keep_low = clip_halfplane(outer, nx, ny, cut) if side in ("s", "w") \
            else clip_halfplane(outer, -nx, -ny, -cut)
        keep_high = clip_halfplane(outer, -nx, -ny, -cut) if side in ("s", "w") \
            else clip_halfplane(outer, nx, ny, cut)
        if keep_low and keep_high:
            step_rings = [keep_low]
            tower_rings = [keep_high]
        else:
            stats["step_clip_failed"] += 1
            step = None

    for band, b, t, fam, col in stack:
        if t - b < 0.4:
            continue
        if band in ("base", "podium") or not (tplan or step):
            rr = [outer] + holes
        else:
            rr = tower_rings
        out.append(wall_feature(rr, b, t, fam, col, band, name,
                                band == "crown", lon0, lat0))
        stats["band_" + band] += 1
        # The lower wing repeats tower + crown at its own height.
        if step_rings and band == "tower":
            wing_crown = step_top - crown_h
            out.append(wall_feature(step_rings, b, wing_crown, fam, col,
                                    "tower", name, False, lon0, lat0, "step"))
            out.append(wall_feature(step_rings, wing_crown, step_top, cfam, ccol,
                                    "crown", name, True, lon0, lat0, "step"))
            stats["band_step"] += 2

    # ── balconies: one slab per floor, on the two long elevations -----
    balc = spec.get("balc")
    if balc:
        faces, first, count = balc
        span = tower_top - podium_top
        f2f = span / max(1, count)
        for i in range(count):
            zb = podium_top + (i + first * 0) * f2f + f2f * 0.62
            if zb + BALC_THICK > tower_top:
                break
            for sgn in (1, -1):
                vf = v1 if sgn > 0 else v0
                a = vf - BALC_BITE if sgn > 0 else vf + BALC_BITE
                b = vf + BALC_PROJ if sgn > 0 else vf - BALC_PROJ
                r = rect_uv(ang, u0 + BALC_MARGIN, min(a, b), u1 - BALC_MARGIN, max(a, b))
                out.append(solid_feature(r, zb, zb + BALC_THICK, "balc", name, lon0, lat0))
                stats["balcony"] += 1

    # ── amenity deck --------------------------------------------------
    where = spec.get("deck")
    if where:
        # The podium top carries no cap, so the deck sits straight on it. The
        # step top and the main parapet DO, and a deck at the same z vanishes
        # inside the cap slab — which is how the first render came back with
        # nine amenity decks and none of them visible.
        if where == "podium":
            dz, dring = podium_top, outer
        elif where == "step" and step_rings:
            dz, dring = step_top + cap_lift(step_top), step_rings[0]
        else:
            dz, dring = roof_z, (tower_rings[0] if (tplan or step) else outer)
        slab = offset(dring + [dring[0]], -DECK_INSET) or (dring + [dring[0]])
        out.append(solid_feature(ccw(slab), dz, dz + DECK_SLAB, "deck", name, lon0, lat0))
        stats["deck"] += 1
        top = dz + DECK_SLAB
        for cls, key in (("pool", "pool"), ("turf", "turf"), ("court", "court")):
            if spec.get(key):
                du, dv, w, l = spec[key]
                r = rect_uv(ang, du - w / 2, dv - l / 2, du + w / 2, dv + l / 2)
                out.append(solid_feature(r, top, top + DECK_ITEM, cls, name, lon0, lat0))
                stats[cls] += 1
        if spec.get("shade"):
            du, dv, w, l = spec["shade"]
            r = rect_uv(ang, du - w / 2, dv - l / 2, du + w / 2, dv + l / 2)
            # Clamped to the building's own LiDAR high point. A pergola on a roof
            # deck IS in the point cloud, so anything of ours standing above
            # `final_height` is this bake inventing height the data does not have.
            sh1 = min(top + SHADE_H + SHADE_T, H - ROOF_CLEAR)
            out.append(solid_feature(r, max(top + 0.4, sh1 - SHADE_T), sh1,
                                     "shade", name, lon0, lat0))
            # a cabana / furniture cluster under it, so the shade has something
            # to shade — a floating plate on its own reads as an error
            r2 = rect_uv(ang, du - w / 4, dv - l / 4, du + w / 4, dv + l / 4)
            out.append(solid_feature(r2, top, top + FURN_H, "furn", name, lon0, lat0))
            stats["shade"] += 2

    # ── mechanical penthouse -----------------------------------------
    if mech_h > 0.2 and H - roof_z > 0.6:
        core = tower_rings[0] if (tplan or step) else outer
        pen = offset(core + [core[0]], -max(4.0, min(12.0, (v1 - v0) * 0.26)))
        if pen:
            # Tops out at EXACTLY final_height. That is the whole point of
            # cutting the penthouse out of the LiDAR high point rather than
            # stacking it on: the high point in the point cloud IS the
            # penthouse. The first cut set the base to parapet + cap_lift and
            # the height to mech_h, which put every one of the ten a metre
            # taller than the data says it is.
            out.append(solid_feature(ccw(pen), roof_z, H, "mech", name, lon0, lat0))
            stats["mech"] += 1

    # ── crown sign ----------------------------------------------------
    if spec.get("sign"):
        du, dv, w, h = spec["sign"]
        vf = v1 + dv
        r = rect_uv(ang, du - w / 2, vf - SIGN_T / 2, du + w / 2, vf + SIGN_T / 2)
        out.append(solid_feature(r, roof_z, min(roof_z + h, H - ROOF_CLEAR),
                                 "sign", name, lon0, lat0))
        stats["sign"] += 1

    return out


def main():
    feats = json.load(open(SNAP, encoding="utf-8"))["features"]
    by_name = {}
    for f in feats:
        n = (f["properties"].get("name") or "")
        if n in BUILDINGS:
            by_name[n] = f

    out, replaced = [], []
    stats = Counter()
    rows = []
    for name, spec in BUILDINGS.items():
        f = by_name.get(name)
        if not f:
            print("  MISSING from the snapshot:", name)
            stats["missing"] += 1
            continue
        made = build(f, spec, stats)
        out.extend(made)
        replaced.append(f["properties"]["id"])
        rows.append((name, f["properties"]["final_height"], len(made)))
        stats["buildings"] += 1

    for n, h, c in sorted(rows, key=lambda r: -r[1]):
        print("  %-26s h=%5.1f  ->  %3d features" % (n[:26], h, c))

    # How many NEW facade atlas images this costs. The atlas is repainted on
    # every time-of-day tick and the cost is per IMAGE, so this number is the
    # one that decides whether the pass is affordable — see the note above
    # quantiseOuterFacades in js/facades.js.
    combos = sorted({(f["properties"]["fam"], f["properties"]["wd"])
                     for f in out if f["properties"]["kind"] == "wall"})

    # Every tower here authors its OWN roof — a deck, a mechanical penthouse, a
    # pool, shade structures, terrace furniture. bake_roofscape.py must not also
    # put a generic deck and a field of condensers up there, and until this list
    # existed it did: the generic deck is baked at `final_height + parapet lift`
    # while the pass's topmost element is the mech penthouse at final_height
    # exactly, so nine towers carried a 0.25 m slab and its clutter hovering
    # 1.0-1.1 m above the penthouse with clear sky under it. See
    # docs/PASS_GLITCH.md.
    #
    # This is the whole list, not a subset: there is no West Campus tower in
    # this bake whose roof is left to the generic bakes.
    fc = {"type": "FeatureCollection", "features": out,
          "replacedBuildingIds": replaced, "authoredRoofIds": replaced}
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(fc, fh, separators=(",", ":"))
    print(json.dumps({
        "features": len(out),
        "buildings": stats["buildings"],
        "replaced_building_ids": replaced,
        "authored_roof_ids": len(replaced),
        "new_atlas_images": len(combos),
        "atlas_combos": ["%s %s" % c for c in combos],
        "file_kb": round(os.path.getsize(OUT) / 1024, 1),
        "counts": dict(sorted(stats.items())),
        "provenance": {
            "footprints": "factual - the snapshot's own polygons, including "
                          "Skyloft's two light wells; only Dobie gets a separate "
                          "tower plan, measured off z20 nadir imagery",
            "floors_and_uses": "sourced per building - see docs/PASS_WESTCAMPUS.md",
            "podium_levels": "sourced for The Castilian (levels 2-10) and Dobie; "
                             "absent elsewhere because the 2013-2020 towers park "
                             "underground, which is also sourced",
            "amenity_decks": "position sourced from z20 nadir imagery for Dobie, "
                             "Signature, Skyloft, Ion and Cambridge; GENERATIVE "
                             "for 21 Rio, Callaway, Inspire and Moontower, where "
                             "only 'rooftop pool' is documented",
            "wall_colours": "sampled off reference photographs where one exists "
                            "(Dobie, Cambridge, Moontower, Signature); the "
                            "snapshot's own baked value where it agrees; "
                            "GENERATIVE for Ion and Inspire",
            "band_heights": "GENERATIVE - floor-to-floor derived from the floor "
                            "count and final_height, per building",
            "balconies": "sourced for Cambridge Tower (every floor, both long "
                         "elevations) and 21 Rio (private balconies documented); "
                         "projection depth is generative",
        },
    }, indent=2))


if __name__ == "__main__":
    main()
