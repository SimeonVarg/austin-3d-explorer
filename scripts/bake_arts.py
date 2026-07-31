# -*- coding: utf-8 -*-
"""The arts and presidential precinct, as stacked geometry instead of windows.

THE PROBLEM, in one sentence: four of these five buildings are essentially BLIND,
and the renderer's whole facade system is a window grid.

  LBJ Presidential Library   a travertine box on piers. Two 59 m elevations with
                             no windows at all, and a tenth floor that cantilevers
                             out over them. It was wearing an office-window tile.
  Ellsworth Kelly, "Austin"  18 x 22 m of white stone under a double barrel vault,
                             with fourteen coloured-glass openings the size of a
                             door. Baked tan (#b89f81) at 6.7 m.
  Blanton, Michener Gallery  an arcaded limestone base under a blind panelled
                             upper wall under a clay-tile roof. No window grid.
  Harry Ransom Center        a stone box whose upper two thirds are large etched
                             translucent GLASS PANELS - a solid-looking grid, not
                             openings. Baked warm tan; it is a neutral grey.
  Bass Concert Hall          a blind buff-brick auditorium with one glazed lobby
                             stuck on the south. The contrast is the building.

...plus the twelve Snohetta petals on the Blanton plaza, which arrive in the
snapshot as ten unnamed 9.2 m circles at a class-default 8.0 m in ten different
random colours (brown, blue-grey, brick). Two more are missing entirely.

WHAT THIS SCRIPT DOES. Emits every one of those as STACKED BANDS - separate
features with their own `base`, `h`, inset and colour. That is the only way to
put a plinth at the bottom and a cornice at the top in this renderer:
fill-extrusion-pattern has no vertical anchor, so anything keyed to the top of a
building repeats every ~40 m up the wall (docs/PASS_COMMON.md section 3). The
BANDS list in scripts/bake_stadium.py is the template and the geometry helpers
below are lifted from it.

THE INSET RULE, and it is the same for all five: **the snapshot footprint is the
WIDEST element of the building and every band below it is inset.** That was
checked, not assumed - scripts/overlay_arts_footprints.py draws each footprint on
its own z20 Esri nadir tile, and in all five cases the outline traces the topmost
projecting thing: LBJ's cantilevered tenth floor, the Ransom Center's cornice, the
Blanton's tile eave. So no band is ever grown past the data, which also keeps
collision.mjs ("never inside a building") honest.

PROVENANCE. Every colour below is a MEDIAN of a patch of pixels from a named
photograph, printed by scripts/sample_arts_colours.py; the hex is in the comment
next to the value. Heights are the snapshot's LiDAR-derived `final_height` except
where a comment says otherwise. Band fractions are generative - no public source
gives storey elevations for any of these - but every one is a fraction of a height
the data already carries, and every one is a single value on a single line here.

Usage:  python scripts/bake_arts.py
"""
import json
import math
import os
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SNAP = os.path.join(ROOT, "data", "snapshots", "2026-07-30", "buildings.detailed.geojson")
OUT = os.path.join(ROOT, "data", "arts.geojson")
M_LAT = 111320.0


# ══ 1. MATERIALS ══════════════════════════════════════════════════════
# hex = the median of a patch, sampled by scripts/sample_arts_colours.py.
# `sd` is that patch's own standard deviation: under about 30 the patch is one
# material, over about 80 it straddled two and the number is not trustworthy.
# Where a value is authored rather than sampled it says GENERATIVE and why.
MAT = {
    # ── LBJ: cream Italian travertine (Bunshaft / SOM, dedicated 1971) ────
    # Cross-validated two ways, which is why this one is the most confident
    # colour in the file: the sunlit south wall in a street photo reads #f0e9dd
    # and the roof deck in the z20 nadir tile reads #f5eedc. Two different
    # photographs, two different surfaces, two different lighting conditions,
    # one answer. The long east and west walls in the same photo read #88888d
    # because they face away from the sun, which is shading, not material.
    "travertine":  "#f0e9dd",   # sd 64 (patch clips a shadow edge); nadir sd 49
    # The building genuinely stands on piers with a deep dark undercroft on its
    # two short elevations, sampled at #181a1d - which is the photograph's black
    # point. Entering that number MEASURED #2f2517 on screen: a black slot that
    # read as a hole punched under the building rather than as a shaded loggia.
    # This renderer applies its own face shading (a wall face here lands at
    # ~0.78/0.69/0.57 of its input), so a shadow has to be entered ALREADY LIT.
    "lbj_under":   "#78736b",   # GENERATIVE: entered to land near #6a5c48
    "lbj_reveal":  "#6b6154",   # from a sampled #524b3f, lifted the same way

    # ── Kelly's "Austin", 2015-18. Kelly's only building and his last work ──
    # Two samples that disagree because their light disagrees: the z20 nadir
    # crown is #dedccd (warm, direct sun) and a street elevation is #b9b4bb
    # (cool, blue-sky bounce, and a darker exposure). The material is a
    # near-neutral white stone, so this is their midpoint pulled to neutral. It
    # is deliberately the whitest and coolest thing in the precinct, because
    # standing next to the Blanton's warm limestone that contrast IS the object.
    #
    # ENTERED COOL, on purpose. Measured: this renderer's sun tint pushes an
    # input R/B of 1.03 out to 1.35 on screen, so a neutral stone lands warm and
    # Kelly stops being the cool object it is next to the Blanton. Same rule
    # docs/PASS_COMMON.md gives for roof colours, applied to a wall because this
    # building is almost all roof.
    "kelly_stone": "#dfe1e3",   # nadir #dedccd sd 39 / street #b9b4bb sd 12

    # ── Blanton, Michener Gallery Building (Kallmann McKinnell & Wood, 2006) ─
    "blanton_ls":  "#e8dac9",   # sd 30, sunlit upper wall
    "blanton_top": "#f0e4d5",   # GENERATIVE: the entablature band reads lighter
    # The ground floor is an arcaded loggia of round arches. At this altitude the
    # arches themselves are undrawable, so the band is modelled as what it
    # actually looks like from 400 m - a recessed line of shadow under the wall.
    "blanton_arc": "#4d4535",   # sampled #514a35, sd 124 (arch head vs pier)

    # ── The twelve Snohetta petals (2023), ~12 m tall perforated shells ──────
    # Measured on screen at #f5d4a4 before this correction - the discs came out
    # orange. Cooled by the same rule as Kelly, less far, because the shells are
    # genuinely a warm cream rather than white.
    "petal":       "#dcd7cf",   # sunlit outer shell #e4d9ca; nadir disc #95937e
    "petal_stem":  "#c8c2b6",   # GENERATIVE: the shaft is self-shaded

    # ── Harry Ransom Center (1972; facade Lake|Flato, 2003) ─────────────────
    # The panel field is DEAD NEUTRAL - three separate patches read H60 S1.8-2.5%
    # - while the concrete cornice on the same building reads H32 S10%. That
    # difference is the etched glass against the concrete and it is the single
    # most identifying fact about this facade. The snapshot has it as #cdc4b0,
    # a warm tan, which is the campus-limestone default and simply wrong here.
    "hrc_panel":   "#a4a4a1",   # sd 17, and two other patches within 11 units
    "hrc_joint":   "#312e2c",   # sd 90 (a 2 px feature), the dark panel joint
    "hrc_cornice": "#b2a99e",   # street #b2aaa1 sd 14, nadir rim #b2a38c sd 24
    "hrc_fin":     "#8f8a82",   # GENERATIVE: every patch of the louvre band was
                                # blocked by live oaks. Panel tone, 14% down.
    "hrc_base":    "#4a463f",   # GENERATIVE: recessed ground floor in shadow

    # ── Bass Concert Hall (1981; lobby Boora/CCS&H, 2008) ───────────────────
    "bass_brick":  "#dab596",   # sd 20, and two other patches within 4 units
    "bass_plinth": "#a98b73",   # GENERATIVE: brick base course, 22% down
    # Sampled at #738e9d (R/B 0.73). MEASURED going through this renderer, a wall
    # face comes out at roughly R x0.78, G x0.69, B x0.58 of its input, so an
    # input R/B of 0.73 lands at 0.99 - dead neutral, and the one cool material
    # in the pass rendered as grey. This is that sample divided back through the
    # measured ratio to land near 0.80: the glass has to be entered BLUER than
    # it is photographed for it to read blue. Same correction as the roof
    # colours in docs/PASS_COMMON.md section 3, just on a wall.
    "bass_glass":  "#6b93b6",   # from a sampled #738e9d, sd 53
    "bass_shade":  "#cfcac2",   # GENERATIVE: the white lobby sunshade
}


def wall_ramp(hex_col):
    """day -> (golden, night). Lifted verbatim from scripts/bake_stadium.py.

    Same reason it exists there: these materials are NOT in the city's fourteen
    colour buckets. Kelly's cool white and the Ransom Center's neutral grey both
    snap to tan against a palette that is mostly tan, which would quietly undo
    the entire point of sampling them.
    """
    c = [int(hex_col[i:i + 2], 16) for i in (1, 3, 5)]
    mixc = lambda a, b, t: [a[i] + (b[i] - a[i]) * t for i in range(3)]
    golden = mixc(c, [255, 190, 130], 0.16)
    night = mixc([v * 0.19 for v in c], [18, 22, 40], 0.42)
    hexify = lambda v: "#" + "".join("%02x" % max(0, min(255, int(round(x)))) for x in v)
    return hexify(golden), hexify(night)


# ══ 2. THE BAND STACKS ════════════════════════════════════════════════
# (name, base_frac, top_frac, inset_m, material, layer, cap)
#   base/top   fractions of the building's height, so a height correction moves
#              the whole stack and nothing has to be re-derived
#   inset      metres in from the snapshot footprint. Always >= 0 - see the
#              inset rule in the module docstring.
#   layer      'solid' flat colour | 'panel' the Ransom Center tile | 'glass'
#              the Bass lobby curtain wall. Both tiles are drawn and registered
#              by js/arts.js; see the taste block there for why the lobby does
#              NOT borrow the shared facade atlas.
#   cap        1 = give this band a parapet lip, using app.js's CAP_GEOM rule
SOLID, PANEL, GLASS = "solid", "panel", "glass"

BANDS = {
    # LBJ. The photographed massing, bottom to top: a deep dark undercroft, a
    # blind travertine wall that BATTERS (leans outward as it rises - Wikipedia:
    # the east and west walls "curve gently upward to the underside walls of the
    # tenth floor"), a shadow reveal, then the tenth floor cantilevering 15 ft
    # out over all four sides. fill-extrusion has no sloped faces, so the batter
    # is three steps: 6.4 -> 5.5 -> 4.6 m of inset. 1.8 m of taper over 20 m of
    # wall, which is ~4 px of silhouette at cruise - small, but it is the
    # difference between a wedge and a shoebox.
    "lbj": [
        ("undercroft", 0.000, 0.150, 6.9, "lbj_under",  SOLID, 0),
        ("batterA",    0.150, 0.420, 6.4, "travertine", SOLID, 0),
        ("batterB",    0.420, 0.640, 5.5, "travertine", SOLID, 0),
        ("batterC",    0.640, 0.812, 4.6, "travertine", SOLID, 0),
        ("reveal",     0.812, 0.876, 7.2, "lbj_reveal", SOLID, 0),
        ("cantilever", 0.876, 1.000, 0.0, "travertine", SOLID, 1),
    ],
    # Kelly's Austin. Only the wall is a plain band; the vault is built by
    # kelly_vault() below, because a uniform inward offset is the WRONG erosion
    # for a barrel vault and, on this footprint, is not even a legal one.
    #
    # Wrong: a barrel vault narrows across its span and keeps its ridge full
    # length, ending in a vertical gable - which on this building is the arched
    # south front with the nine-square colour grid in it. A uniform offset
    # shortens the arms too and turns two crossing barrels into a mound.
    #
    # Illegal: the plan is a cross, so every inward offset of it has four reflex
    # corners, and the offset-each-edge-then-intersect method in offset() spikes
    # at reflex corners and self-intersects. The first run of this bake reported
    # `inset_collapsed: 3` - all three vault steps, at insets as small as 1.3 m -
    # and would have rendered Kelly as a flat white box. Worth stating because
    # the fallback there is silent-looking: the band still draws, just at the
    # wrong size, and only the counter says so.
    "kelly": [
        ("wall", 0.000, 0.575, 0.0, "kelly_stone", SOLID, 0),
    ],
    # Blanton. NOTE the missing band: there is no roof here on purpose. The
    # snapshot already carries 28 pitched clay-tile features for this building in
    # data/roofs.geojson, rising from base 15.3 to 20.5 in #c85f3c, and app.js's
    # addRoofLayers draws them from a source this module never touches. Baking a
    # second hip roof would have put one inside the other. The walls being inset
    # 1.5 m is what turns that existing roof into the DEEP EAVE the building
    # actually has - a correction that costs nothing because someone else already
    # did the expensive half.
    "blanton": [
        ("arcade",  0.000, 0.345, 2.6, "blanton_arc", SOLID, 0),
        ("wall",    0.345, 0.930, 1.5, "blanton_ls",  SOLID, 0),
        ("frieze",  0.930, 1.000, 1.2, "blanton_top", SOLID, 1),
    ],
    # Harry Ransom Center. The panel field is 64% of the height and it is the
    # facade; everything else is there to stop it running to the ground and to
    # the sky. Cornice at inset 0 because the footprint IS the cornice.
    "ransom": [
        ("base",    0.000, 0.163, 2.4, "hrc_base",    SOLID, 0),
        # Flush with the panel field above it ON PURPOSE. At 1.2 m the fins left a
        # 0.3 m ledge under the panels, and a sub-metre horizontal sliver at this
        # camera distance does not read as a string course - it aliases into a
        # dashed white line, which looks like a rendering fault. A ledge is either
        # worth a metre or it is worth nothing.
        ("fins",    0.163, 0.269, 1.5, "hrc_fin",     SOLID, 0),
        ("panels",  0.269, 0.906, 1.5, "hrc_panel",   PANEL, 0),
        ("cornice", 0.906, 1.000, 0.0, "hrc_cornice", SOLID, 1),
    ],
    # Bass / the Performing Arts Center. The 105 x 119 m footprint is the whole
    # complex at 14.6 m; the auditorium and the lobby are added separately below.
    # The base height is deliberately NOT raised even though the photograph says
    # the south mass is over 20 m: data/roofscape.geojson puts this building's
    # roof deck at 15.85 m and 42 clutter items at 16.9-17.9 m, and raising the
    # mass would bury all of them. The tall part of the photograph is the
    # auditorium block, which is modelled as its own volume instead.
    # Two bands, not three. A separate "parapet" band was tried at the same
    # colour and the same inset as the body, which makes it a coplanar
    # continuation of the wall - a feature that costs a draw and cannot be seen.
    # The parapet LIP is the cap layer's job (app.js's CAP_GEOM), so the body
    # simply carries cap=1.
    "bass": [
        ("plinth",  0.000, 0.300, 1.2, "bass_plinth", SOLID, 0),
        ("body",    0.300, 1.000, 0.0, "bass_brick",  SOLID, 1),
    ],
}

# ══ 3. TARGETS ════════════════════════════════════════════════════════
# id8 -> (slug, band stack, height override or None)
TARGETS = {
    "d997136f": ("lbj",     "lbj",     None),   # LBJ Presidential Library, 28.3 m
    # 26 ft 4 in = 8.03 m is Kelly's own published dimension (60 x 73 x 26'4").
    # The snapshot's 6.7 m is 17% short, which on an 8 m object is the whole
    # vault. This is the one height override in the file and it is SOURCED.
    "a5ec01b5": ("kelly",   "kelly",   8.03),
    "8a27170d": ("blanton", "blanton", None),   # Michener Gallery Building, 14.3 m
    "8ceb5fdd": ("smith",   "blanton", None),   # Edgar A. Smith Building, 14.2 m
    "4f12c48f": ("ransom",  "ransom",  None),   # Harry Ransom Center, 32.0 m
    "31901788": ("bass",    "bass",    None),   # PAC / Bass Concert Hall, 14.6 m
}

# The ten petals that ARE in the snapshot, as unnamed 9.2 m circles at a
# class_default 8.0 m. Their footprints are real survey data and are kept
# exactly; only the height and the colour are replaced.
PETAL_IDS = [
    "f6fbb1e7", "8dcd88b6", "4a7b9425", "b8d14732", "bab781de",
    "15499cfe", "476da41f", "fe5816e6", "6939670a", "44e5078e",
]
# ...and the two that are NOT. Architectural Record and Snohetta both say twelve;
# the snapshot has ten. The missing pair sits at the museum's south-east corner
# and both are plainly visible in the z20 Esri nadir tile. These centres were
# digitised off that tile (aerial px 752,807 and 824,805 in tile 239607/431670 at
# z20) and the digitising was CHECKED before it was trusted: the same transform
# reprojects all ten known petal footprints onto their own discs to within a few
# pixels. Radius measured off the same image; this pair is smaller than the ten.
PETALS_EXTRA = [(-97.7371430, 30.2806676, 4.0), (-97.7370465, 30.2806699, 4.0)]

# Kelly's vault steps: (metres narrowed off EACH side of the arm, base, top),
# as fractions of the 8.03 m height. Four steps rather than three because the
# object is only ~20 m across and the silhouette is all it has.
KELLY_VAULT = [
    (0.0, 0.575, 0.700),
    (1.1, 0.700, 0.810),
    (2.1, 0.810, 0.910),
    (3.1, 0.910, 1.000),
]

PETAL_H = 12.2          # "nearly 40 feet tall" - Architectural Record, 2023
# radius fraction, base fraction, top fraction, material. A trumpet: a thin shaft
# that flares into a wide shallow canopy. From directly overhead - which is most
# of how this app sees them - what reads is the canopy disc and the small bright
# hub at its centre, which is exactly what the nadir tile shows.
PETAL_STEPS = [
    (0.155, 0.00, 0.62, "petal_stem"),
    (0.340, 0.62, 0.79, "petal_stem"),
    (0.650, 0.79, 0.90, "petal"),
    (1.000, 0.90, 1.00, "petal"),
]

# ── Bass: the two volumes the footprint does not contain ────────────────
# Both digitised off the z20 nadir tile (tile 239625/431652), both re-checked by
# scripts/overlay_arts_footprints.py. Given as centre + half-extents in the
# COMPLEX'S OWN frame rather than as corners, because the whole PAC is rotated
# 3.6 deg off north and an axis-aligned box would sit visibly skew on the roof.
BASS_AXIS_DEG = 3.6
# The auditorium. Measured 297 x 272 px axis-aligned, de-rotated to 38.3 x 35.1 m.
BASS_HALL = dict(lon=-97.7312616, lat=30.2861199, w=38.3, d=35.1, h=23.0, base=0.0)
# The 2008 glazed lobby, which post-dates the footprint entirely - it is the
# "extended one structural bay" of the Boora renovation and it is the only glass
# on the building. 33.5 x 13.0 m off the tile; 15.8 m tall by scaling the
# entrance doors in a street photograph (~35 px/m), which is GENERATIVE.
BASS_LOBBY = dict(lon=-97.7313042, lat=30.2857520, w=33.5, d=13.0, h=15.8, base=0.0)
BASS_SHADE_OUT = 1.8    # the white sunshade oversails the glass on every side
BASS_SHADE_H = 0.9


# ══ 4. geometry helpers (from scripts/bake_stadium.py) ════════════════
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
    """Offset a closed ring by d metres. POSITIVE d grows it outward.

    Returns None when the result degenerates, which is the right answer for an
    offset larger than the shape - Kelly's vault steps rely on that guard,
    because the third step insets 3.5 m into arms that are only 9 m wide.
    """
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
    if signed_area(ring) <= 4.0:
        return None
    # An offset that turns the ring inside out still has positive area, so area
    # alone does not catch it. A self-intersected ring renders as a bow tie.
    if not same_orientation(ring, ccw(pts) + [ccw(pts)[0]]):
        return None
    return ring


def same_orientation(a, b):
    return (signed_area(a) > 0) == (signed_area(b) > 0)


def to_m(ring, lat0):
    k = math.cos(math.radians(lat0))
    return [(p[0] * M_LAT * k, p[1] * M_LAT) for p in ring]


def to_ll(pts, lat0):
    k = math.cos(math.radians(lat0))
    ring = list(pts)
    if ring[0] != ring[-1]:
        ring = ring + [ring[0]]
    return [[round(x / (M_LAT * k), 7), round(y / M_LAT, 7)] for (x, y) in ring]


def circle(lon, lat, r_m, n=20):
    k = math.cos(math.radians(lat))
    return [[round(lon + r_m * math.cos(2 * math.pi * i / n) / (M_LAT * k), 7),
             round(lat + r_m * math.sin(2 * math.pi * i / n) / M_LAT, 7)]
            for i in range(n)] + [None]


def rect(lon, lat, w, d, bearing_deg):
    """A w x d rectangle centred on lon/lat, its w axis rotated `bearing` off east."""
    a = math.radians(bearing_deg)
    k = math.cos(math.radians(lat))
    ring = []
    for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        ex, ey = sx * w / 2, sy * d / 2
        rx = ex * math.cos(a) - ey * math.sin(a)
        ry = ex * math.sin(a) + ey * math.cos(a)
        ring.append([round(lon + rx / (M_LAT * k), 7), round(lat + ry / M_LAT, 7)])
    return ring + [ring[0]]


# 4 cm. Ellsworth Kelly's "Austin" is 20 x 23 m and about 8 m tall, so from the
# flying camera one pixel of it is roughly half a metre: this is a twelfth of a
# pixel, far below anything the viewer can see, and far above what the depth
# buffer needs to pick a winner and keep picking it.
KELLY_ARM_EPS = 0.04


def kelly_vault(ring_ll, H, out, stats):
    """The double barrel vault, as two crossing ridges rather than one mound.

    The plan is a cross of two barrels. Each barrel narrows across its SPAN as it
    rises and keeps its ridge full length, so this fits an oriented frame to the
    footprint, measures each arm's width in that frame, and emits one rectangle
    per arm per step, narrowed only across the arm. The two rectangles overlap at
    the crossing, which is correct — but "fill-extrusion handles it for free",
    which this comment used to claim, is only true of the VOLUME. The union
    reads as one vault; the two TOP FACES in the shared crossing are exactly
    coplanar, and coplanar tops have no draw order, so the crossing flickered
    as the camera moved. `KELLY_ARM_EPS` below is the fix.

    Nothing here is a magic number: the frame comes from the footprint's own
    longest edge and the arm widths are measured at the footprint's own extremes.
    Fitting a shape rather than hard-coding one is what stops this from silently
    becoming wrong if the snapshot's polygon is ever re-cut.
    """
    pts = ring_ll[:-1] if ring_ll[0] == ring_ll[-1] else ring_ll[:]
    lat0 = sum(q[1] for q in pts) / len(pts)
    m = to_m(pts, lat0)
    # frame: the longest edge's direction
    best, ang = -1.0, 0.0
    for i in range(len(m)):
        ax, ay = m[i]
        bx, by = m[(i + 1) % len(m)]
        d = (bx - ax) ** 2 + (by - ay) ** 2
        if d > best:
            best, ang = d, math.atan2(by - ay, bx - ax)
    ca, sa = math.cos(-ang), math.sin(-ang)
    rot = [(x * ca - y * sa, x * sa + y * ca) for x, y in m]
    xs = [q[0] for q in rot]
    ys = [q[1] for q in rot]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    W, D = x1 - x0, y1 - y0
    # Each arm's width, measured at the OTHER axis's extreme - that is where a
    # cross is only one arm wide. 0.12 of the span is enough to catch the end
    # vertices and not enough to reach the crossing.
    ex = [q for q in rot if q[0] > x1 - 0.12 * W or q[0] < x0 + 0.12 * W]
    ey = [q for q in rot if q[1] > y1 - 0.12 * D or q[1] < y0 + 0.12 * D]
    armY = (min(q[1] for q in ex), max(q[1] for q in ex))   # E-W barrel's span
    armX = (min(q[0] for q in ey), max(q[0] for q in ey))   # N-S barrel's span

    def emit(ax0, ax1, ay0, ay1, b, h, tag):
        if ax1 - ax0 < 0.8 or ay1 - ay0 < 0.8:
            stats["kelly_step_too_thin"] += 1
            return
        r = [(ax0, ay0), (ax1, ay0), (ax1, ay1), (ax0, ay1)]
        cb, sb = math.cos(ang), math.sin(ang)
        back = [(x * cb - y * sb, x * sb + y * cb) for x, y in r]
        out.append(feat(to_ll(back, lat0),
                        band_props("kelly", tag, "kelly_stone", SOLID, b, h, 0)))
        stats["bands"] += 1

    for step, (narrow, f0, f1) in enumerate(KELLY_VAULT):
        b, h = H * f0, H * f1
        emit(armX[0] + narrow, armX[1] - narrow, y0, y1, b, h, "vaultN%d" % step)
        # The E-W barrel's steps are lifted by KELLY_ARM_EPS so no step of it
        # is ever coplanar with the step of the N-S barrel it crosses. Only the
        # TOP moves: raising the base too would open a 4 cm ring of sky between
        # this step and the one below it, and a gap is a worse defect than the
        # one being fixed. Overlapping by 4 cm is invisible and safe.
        emit(x0, x1, armY[0] + narrow, armY[1] - narrow,
             b, h + KELLY_ARM_EPS, "vaultE%d" % step)
    return dict(W=round(W, 1), D=round(D, 1),
                armX=round(armX[1] - armX[0], 1), armY=round(armY[1] - armY[0], 1))


def scale_ring(ring_ll, f):
    """Scale a ring about its own centroid. Exact for the petal circles, and
    unlike offset() it cannot fail on a 20-gon."""
    pts = ring_ll[:-1] if ring_ll[0] == ring_ll[-1] else ring_ll[:]
    cx = sum(p[0] for p in pts) / len(pts)
    cy = sum(p[1] for p in pts) / len(pts)
    out = [[round(cx + (p[0] - cx) * f, 7), round(cy + (p[1] - cy) * f, 7)] for p in pts]
    return out + [out[0]]


# ══ 5. emit ═══════════════════════════════════════════════════════════
def feat(ring_or_rings, props):
    rings = ring_or_rings if isinstance(ring_or_rings[0][0], list) else [ring_or_rings]
    return {"type": "Feature", "properties": props,
            "geometry": {"type": "Polygon", "coordinates": rings}}


# The parapet lip on a capped band gets its own colour, because a cap painted
# the same hex as the wall it sits on is a draw call you cannot see - the exact
# mistake js/outer.js documents having made on the downtown towers. These are the
# z20 NADIR samples: the top of a parapet is a roof surface, so the aerial is the
# right photograph to read it off, not a street elevation.
# All four are the sampled hex with R x0.94 and B x1.06 - a partial correction
# for the sun tint, which on a TOP face is much stronger than on a wall: the
# Ransom Center cornice was measured going in at R/B 1.27 and landing at 1.80.
# Partial rather than full because a complete correction needs an input around
# R/B 0.7, and that is a blue roof at golden hour and at night, when the same
# wall_ramp() carries it through. The residue is logged in docs/PASS_ARTS.md.
CAP_MAT = {
    "lbj":     "#dee4e1",   # from nadir roof deck #f5eedc, sd 49
    "blanton": "#d0d0c8",   # GENERATIVE: limestone, and hidden under the tile roof
    "smith":   "#d0d0c8",
    "ransom":  "#a7a394",   # from nadir cornice rim #b2a38c, sd 24
    "bass":    "#9f9d91",   # from nadir roof deck #a99d89, sd 24
}


def band_props(slug, band, mat, layer, base, h, cap):
    wd = MAT[mat]
    wg, wn = wall_ramp(wd)
    pr = {"b": slug, "band": band, "lyr": layer, "cap": cap,
          "wd": wd, "wg": wg, "wn": wn, "base": round(base, 2), "h": round(h, 2)}
    if cap:
        rd = CAP_MAT.get(slug, wd)
        rg, rn = wall_ramp(rd)
        pr.update({"rd": rd, "rg": rg, "rn": rn})
    return pr


def build_banded(f, slug, stack, h_override, stats, out):
    p = f["properties"]
    g = f["geometry"]
    rings = g["coordinates"] if g["type"] == "Polygon" else g["coordinates"][0]
    outer_ll = rings[0]
    lat0 = sum(q[1] for q in outer_ll) / len(outer_ll)
    outer = ccw(to_m(outer_ll, lat0))
    H = h_override if h_override else (p.get("final_height") or 0)
    if H <= 0:
        stats["no_height"] += 1
        return
    cache = {}
    for name, f0, f1, inset, mat, layer, cap in BANDS[stack]:
        if inset <= 0.001:
            ring = to_ll(outer, lat0)
        else:
            key = round(inset, 3)
            if key not in cache:
                cache[key] = offset(outer + [outer[0]], -inset)
            r = cache[key]
            if r is None:
                # The band would collapse. Dropping it silently is how a hole
                # appears in a wall, so fall back to the uninset ring and count it.
                stats["inset_collapsed"] += 1
                ring = to_ll(outer, lat0)
            else:
                ring = to_ll(ccw(r), lat0)
        out.append(feat(ring, band_props(slug, name, mat, layer,
                                         H * f0, H * f1, cap)))
        stats["bands"] += 1


def build_petals(feats_by_id, stats, out):
    discs = []
    for i8 in PETAL_IDS:
        f = feats_by_id.get(i8)
        if not f:
            stats["petal_missing"] += 1
            continue
        ring = f["geometry"]["coordinates"][0]
        discs.append(("snapshot", ring))
    for lon, lat, r in PETALS_EXTRA:
        discs.append(("aerial", circle(lon, lat, r)[:-1] + [None]))
    for src, ring in discs:
        ring = [q for q in ring if q]
        if ring[0] != ring[-1]:
            ring = ring + [ring[0]]
        for rf, f0, f1, mat in PETAL_STEPS:
            out.append(feat(scale_ring(ring, rf),
                            dict(band_props("petal", "%.2f" % rf, mat, SOLID,
                                            PETAL_H * f0, PETAL_H * f1, 0), src=src)))
            stats["petal_bands"] += 1
        stats["petals"] += 1


def build_bass_extras(stats, out):
    # The auditorium: blind brick, and the reason the photographs show a mass
    # twice the height of the footprint's 14.6 m.
    r = rect(BASS_HALL["lon"], BASS_HALL["lat"], BASS_HALL["w"], BASS_HALL["d"],
             BASS_AXIS_DEG)
    H = BASS_HALL["h"]
    out.append(feat(r, band_props("bass", "hall", "bass_brick", SOLID, 0.0, H * 0.955, 0)))
    out.append(feat(r, band_props("bass", "hallcap", "bass_plinth", SOLID,
                                  H * 0.955, H, 1)))
    stats["bass_hall"] += 2

    # The 2008 lobby. `glass` rather than `solid`: js/arts.js hands this one
    # feature to the renderer's existing curtain-wall atlas, which costs zero new
    # texture uploads and rides the day/night ramp for free. It is the ONLY
    # glazed thing this pass emits, and that is the point - one glass box against
    # 105 m of blind brick is the building.
    L = BASS_LOBBY
    lr = rect(L["lon"], L["lat"], L["w"], L["d"], BASS_AXIS_DEG)
    out.append(feat(lr, band_props("bass", "lobby", "bass_glass", GLASS, 0.0, L["h"], 0)))
    sr = rect(L["lon"], L["lat"], L["w"] + 2 * BASS_SHADE_OUT,
              L["d"] + 2 * BASS_SHADE_OUT, BASS_AXIS_DEG)
    out.append(feat(sr, band_props("bass", "sunshade", "bass_shade", SOLID,
                                   L["h"], L["h"] + BASS_SHADE_H, 0)))
    stats["bass_lobby"] += 2


def main():
    feats = json.load(open(SNAP, encoding="utf-8"))["features"]
    byid = {f["properties"]["id"][:8]: f for f in feats}
    out, replaced = [], []
    stats = Counter()

    for i8, (slug, stack, h_over) in TARGETS.items():
        f = byid.get(i8)
        if not f:
            print("  !! %s not in snapshot" % i8)
            stats["target_missing"] += 1
            continue
        n0 = len(out)
        build_banded(f, slug, stack, h_over, stats, out)
        if slug == "kelly":
            fit = kelly_vault(f["geometry"]["coordinates"][0], h_over, out, stats)
            print("     kelly fit: %s" % fit)
        if len(out) > n0:
            replaced.append(f["properties"]["id"])
            print("  %-10s %-46s h=%5.1f -> %d bands"
                  % (slug, (f["properties"].get("name") or "?")[:46],
                     h_over or f["properties"].get("final_height") or 0, len(out) - n0))

    build_bass_extras(stats, out)
    build_petals(byid, stats, out)
    for i8 in PETAL_IDS:
        f = byid.get(i8)
        if f:
            replaced.append(f["properties"]["id"])
    print("  %-10s %-46s h=%5.1f -> %d features"
          % ("petals", "Snohetta plaza canopy (%d of 12 from snapshot)" % len(PETAL_IDS),
             PETAL_H, stats["petal_bands"]))

    # Which of these buildings' roofs does this pass author itself?
    #
    # Only the two that are drawn TALLER than the snapshot says. The LBJ, the
    # Blanton, the Smith and the Ransom are all redrawn at their snapshot
    # height and capped at h + the shared parapet lift, so bake_roofs.py's
    # pitched stack and bake_roofscape.py's deck land exactly on that cap —
    # correct, and in the Blanton's and the Smith's case it is where their tile
    # hip roofs come from. Do not take those away.
    #
    # The Bass/PAC is drawn to 24 m against a baked 14.6, and the ten Snohetta
    # petals to 12.2 m against a class-default 8.0, so the generic decks and
    # clutter for those sit several metres down inside the authored geometry:
    # invisible, and re-tiled and drawn on every frame for nothing.
    authored = [f["properties"]["id"] for i8, f in
                ((i8, byid.get(i8)) for i8 in ["31901788"] + PETAL_IDS) if f]
    fc = {"type": "FeatureCollection", "features": out,
          "replacedBuildingIds": replaced, "authoredRoofIds": authored}
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(fc, fh, separators=(",", ":"))

    print(json.dumps({
        "features": len(out),
        "replaced_building_ids": len(replaced),
        "authored_roof_ids": len(authored),
        "file_kb": round(os.path.getsize(OUT) / 1024, 1),
        "counts": dict(sorted(stats.items())),
        "provenance": {
            "footprints": "FACTUAL - the snapshot's own rings, never grown, only inset",
            "colours": "SOURCED - median of a named patch of a named photograph; "
                       "see MAT above, each with its sample and its sd",
            "heights": "SOURCED except Kelly (8.03 m = Kelly's published 26 ft 4 in, "
                       "replacing a 6.7 m LiDAR value) and the two Bass volumes "
                       "(23.0 m / 15.8 m, scaled off a street photograph)",
            "band_fractions": "GENERATIVE - no public source gives storey elevations "
                              "for any of these; every one is a fraction of a height "
                              "the data already carries",
            "petals": "10 of 12 footprints FACTUAL from the snapshot; 2 digitised off "
                      "z20 Esri nadir imagery and cross-checked against the other 10; "
                      "12.2 m height SOURCED (Architectural Record, 2023)",
            "not_baked": "the Blanton's clay tile roof - data/roofs.geojson already "
                         "carries 28 pitched features for it",
        },
    }, indent=2))


if __name__ == "__main__":
    main()
