# -*- coding: utf-8 -*-
"""West Campus: ten student high-rises and fourteen mid-rise blocks, as
STACKED GEOMETRY BANDS.

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

TIER TWO — the mid-rise blocks — was added afterwards and has its own header
above `MIDRISE` below, including the list of things it deliberately does not do
and why. Read that before adding a building to either table. In short: West
Campus is not made of towers, it is made of six-to-ten storey blocks, and those
were still single prisms wearing one tile.

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
COURT_Z = 0.45         # m: the floor of a ground-level courtyard, clear of the
                       # ground pass's own 0.22 m paths and 0.45 m ring pads

# ── TIER THREE's taste block: the four things a student apartment has that a
#    prism does not. Simeon named all four ("banded balconies, setback crowns,
#    coloured spandrel panels, podium parking in a different material"), and the
#    first three had no vocabulary in this bake at all.
RAIL_H = 1.05          # m of balustrade above a balcony slab. This is the real
                       # number — IBC 1015.3 wants 42 in on a residential
                       # balcony — and it is why the balconies did not read
                       # before: a 0.34 m slab with nothing on it is a SHELF.
                       # At 1.05 m the slab-and-rail pair is 1.39 m of relief,
                       # four times what the slab alone gave.
RAIL_T = 0.11          # m thick. Thinner stops resolving at cruise altitude.
BAY_MIN = 2.5          # m: a colour bay narrower than this is dropped rather
                       # than drawn, because a 1 m stripe is a seam, not a bay.
BAY_PAD = 60.0         # m the clipping strip overhangs the plan on both sides.
                       # Only has to exceed the half-diagonal of any footprint
                       # here (the largest is 2400 Nueces at 57 m).

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

# Tier two's shared materials. Same discipline: the BODY colour is per building —
# it is the whole point of the tier, see the MIDRISE header — and everything else
# is shared, so ten buildings cost ten atlas images and not forty.
BASE_BRICK = "#7d5747"      # dark brick / stained-timber ground floor
BASE_STONE = "#a09582"      # cast stone / painted masonry ground floor
BASE_STD = "#3f4348"        # The Standard's charcoal panel corner bay
CROWN_PALE = "#c4bfb3"      # warm pale parapet coping band
CROWN_STEEL = "#adb3b7"     # cool pale parapet coping band

# ══ TIER THREE — the COLOUR BAY palette ═══════════════════════════════
#
# Every hex below was READ OFF A NAMED PHOTOGRAPH, not remembered. The method is
# the same for all of them and it is spelled out because guessing one of these
# is exactly the failure this tier exists to stop:
#
#   1. crop a region of the photograph that is the material and NOTHING else,
#      then LOOK at the crop on a contact sheet before trusting any number —
#      three of the first nine crops turned out to be sky, foliage or a lit
#      window and their "measurements" were worthless;
#   2. k-means the crop into 4-6 clusters and take a cluster centre WITH its
#      share of the crop, so glass and shadow are separated out rather than
#      averaged in;
#   3. where the photograph's own exposure cannot be trusted as an absolute —
#      the Standard's is BLUE HOUR — express the cluster as its offset from that
#      crop's area-weighted mean and re-centre it on the body colour PR #113
#      already measured off imagery, at k = BAY_K.
#
# Step 3 is what makes this safe. A building's bays AVERAGE BACK to the colour
# the imagery measured, by construction, so tier three cannot silently repaint a
# building tier two got right — it can only decompose it.
BAY_K = 0.75
#
# ── Block on 25th East. American Campus Communities' own 671_01_exterior.jpg.
#    A five-storey burnt-orange stucco mass at one END of a 91 m cream bar.
#    Sunlit face, crop (300,240)-(356,292): 69.3% #d09452. Shaded return, crop
#    (120,185)-(152,330): 75.2% #bb7f51. Midday photograph, so no re-centring is
#    needed; the two faces area-weighted give the distant read:
BURNT_ORANGE = "#c68a52"
#    and its pale stair-tower stucco, crop (382,130)-(428,250): 67.8%
PALE_STUCCO = "#a9b8bd"
#
# ── 2400 Nueces. Architect Magazine's own photograph of the building at Nueces
#    and 24th. A honey Texas-limestone corner volume runs full height at one end
#    of a 99.6 m cool-grey panel block, with dark umber accent panels scattered
#    through the field. Limestone, crop (1250,180)-(1420,700): 37.7% #af925e,
#    27.2% #957740, 24.1% #c6ab7e, area-weighted:
TX_LIMESTONE = "#a58957"
#    umber accent panel, from the panel-field crop (1650,380)-(1980,660): 30.3%
UMBER_PANEL = "#6b5b4c"
#    the white/silver metal panel, crop (1000,80)-(1200,200): 54.8%
SILVER_PANEL = "#dbd9e2"


def bay_mix(cluster, crop_mean, body, k=None):
    """Step 3 above, as one function so no bay can skip it.

    Returns the hex a bay should be painted so that a building's bays average
    back to `body` — the colour the imagery measured — while carrying the
    CONTRAST the photograph measured between that cluster and its crop's mean.
    Additive about the mean, not multiplicative: a ratio against a blue-hour
    exposure clips every light material to white (the cream panel came out
    #fff8da on the first attempt, which is not a colour any building is).
    """
    k = BAY_K if k is None else k
    hx = lambda h: [int(h[i:i + 2], 16) for i in (1, 3, 5)]
    c, m, b = hx(cluster), hx(crop_mean), hx(body)
    return "#" + "".join("%02x" % max(0, min(255, int(round(b[i] + k * (c[i] - m[i])))))
                         for i in range(3))


def bay_ratio(cluster, crop_mean, body):
    """The same re-centring for a material that is NOT part of the field.

    `bay_mix` is additive about the crop mean, and it has to be: a ratio against
    a blue-hour exposure clips every light material to white (the cream panel
    came out #fff8da on the first attempt, which is not a colour any building
    is). But additive also COMPRESSES anything far from the mean, and The
    Standard's slate corner is far from it — bay_mix put it at #989c9f, 27 luma
    off the pale panel next to it, where the photograph has it at 0.57 of the
    cream's luminance. A dark corner bay that is not dark is not the feature.
    So: a material that belongs to the field averages back into it (bay_mix); a
    material that is a DIFFERENT material keeps its relative luminance (here).
    Multiplicative cannot clip in this direction, because these are all darker
    than the field they sit in.
    """
    hx = lambda h: [int(h[i:i + 2], 16) for i in (1, 3, 5)]
    c, m, b = hx(cluster), hx(crop_mean), hx(body)
    return "#" + "".join("%02x" % max(0, min(255, int(round(b[i] * c[i] / max(1, m[i])))))
                         for i in range(3))


# ── The Standard at Austin. Humphreys & Partners' own StandardAustin_Ext_14,
#    research/union24th-area/imagery/web/the-standard-at-austin/humphreys_00.jpg.
#    Tower panel field, crop (1450,60)-(1900,640), area-weighted mean #94978d:
#      27.7% #9ea39f    20.5% #d9d5be    19.6% #8e8674    20.6% #4c504a (glass)
#    Those three panel tones ARE the broken "pixel" field the elevation is known
#    for, and three vertical bays is how this renderer can say it. `STD_BODY` is
#    the value PR #113 measured and verified; the mix re-centres on it.
STD_BODY = "#b3b0a2"
STD_FIELD_MEAN = "#94978d"
STD_CREAM = bay_mix("#d9d5be", STD_FIELD_MEAN, STD_BODY)
STD_WARM = bay_mix("#8e8674", STD_FIELD_MEAN, STD_BODY)
STD_PALE = bay_mix("#9ea39f", STD_FIELD_MEAN, STD_BODY)
#    The corner bay is a different material — a dark slate ACM volume carrying
#    THE STANDARD in white letters, and the most recognisable thing about the
#    building. Crop (1090,700)-(1330,900): 62.0% #707d89 against that same field
#    mean. It is a DIFFERENT material from the panel field, so it re-centres by
#    ratio and not by offset — see bay_ratio for why that distinction is not
#    cosmetic.
STD_SLATE = bay_ratio("#707d89", STD_FIELD_MEAN, STD_BODY)


def two_tone(body, pale, w_pale):
    """The dark half of a two-tone rainscreen, given the pale half and its share.

    Solves `w*pale + (1-w)*dark = body` so a two-tone building keeps the wall
    colour the imagery measured. Used where the MATERIAL SPLIT is sourced but no
    photograph of it is in research/ — the split is real, the two hexes are a
    derivation, and the average is not a guess at all.
    """
    hx = lambda h: [int(h[i:i + 2], 16) for i in (1, 3, 5)]
    b, p = hx(body), hx(pale)
    return "#" + "".join("%02x" % max(0, min(255, int(round((b[i] - w_pale * p[i]) / (1 - w_pale)))))
                         for i in range(3))


# ── Moontower, Gensler. The bake has described this building as a "two-tone
#    rainscreen: near-white fibre-cement panel against a charcoal panel in broad
#    vertical strips" since the pass was written, and then drawn it as one flat
#    tone, because there was no way to say a vertical strip. There is now.
#    NO PHOTOGRAPH OF MOONTOWER IS IN research/ — the split is the sourced
#    description, the near-white is typed, and the charcoal is whatever makes
#    the pair average to the measured #7d8a8e. Marked GENERATIVE in provenance.
MT_PALE = "#e0e4e8"
MT_CHAR = two_tone("#7d8a8e", MT_PALE, 0.40)

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
#    tplan   None, or (inset_m, du, dv, rot_deg, chamfer_m, HALF_OF_SIDE_m): a
#            SEPARATE tower footprint sitting on the podium, for the one building
#            where the source polygon is the podium and not the tower.
#            The last element is HALF OF THE SIDE, because that is what
#            chamfered_square() puts its corners at. It is spelled out here, and
#            written through _half_from_diagonal() at the call site, because this
#            doc comment used to stop at `chamfer_m` and omit the sixth element
#            altogether — so half-of-DIAGONAL was entered where half-of-SIDE is
#            consumed, and Dobie's tower was baked at 1.95x its true plan area
#            for as long as the pass has existed.


def _shp(geom):
    """Footprint in metres for an area comparison. Local scale factors, not a
    projection: accurate to well under 1% over West Campus and dependency-free
    apart from shapely, which bake_outer.py and enrich.py already use."""
    from shapely.geometry import shape
    from shapely.ops import transform
    g = shape(geom)
    if not g.is_valid:
        g = g.buffer(0)
    kx = 111320.0 * math.cos(math.radians(30.288))
    return transform(lambda x, y, z=None: (x * kx, y * 111320.0), g)


def _balcony_mask(outer_m):
    """The footprint grown by the balcony projection, as a shapely polygon.

    Metres, in the building's own local frame — the same frame `rect_uv` works
    in — so no projection is involved and the clip is exact.
    """
    from shapely.geometry import Polygon
    g = Polygon(outer_m)
    if not g.is_valid:
        g = g.buffer(0)
    return g.buffer(BALC_PROJ + 0.05, join_style=2)


def _clip_to_g(rect_m, mask):
    """rect ∩ mask, as shapely polygons. Kept as geometry rather than as rings
    because the balcony RAIL is derived from the slab that survived this clip —
    see the note at its call site."""
    from shapely.geometry import Polygon
    g = Polygon(rect_m).intersection(mask)
    return [q for q in getattr(g, "geoms", [g])
            if q.geom_type == "Polygon" and q.area >= 1.0]


def _clip_to(rect_m, mask):
    """rect ∩ mask, as a list of rings in metres. Drops slivers."""
    from shapely.geometry import Polygon
    g = Polygon(rect_m).intersection(mask)
    if g.is_empty:
        return []
    parts = list(getattr(g, "geoms", [g]))
    out = []
    for q in parts:
        if q.geom_type != "Polygon" or q.area < 1.0:
            continue
        out.append(ccw([(x, y) for x, y in list(q.exterior.coords)[:-1]]))
    return out


def _poly(rings_m):
    """A shapely polygon from [outer, hole, hole, ...] in metres."""
    from shapely.geometry import Polygon
    g = Polygon(rings_m[0], rings_m[1:]) if len(rings_m) > 1 else Polygon(rings_m[0])
    if not g.is_valid:
        g = g.buffer(0)
    return g


def _rings_of(g, min_area):
    """A shapely result back to [[outer, hole, ...], ...], dropping slivers.

    A colour bay is a strip cut across a plan that may have light wells in it —
    Skyloft has two, The G one, Rambler a courtyard — so the cut has to carry
    interiors through. Clipping ring-by-ring with the half-plane clipper the
    step uses cannot: it takes ONE ring and knows nothing about holes, so a bay
    over a courtyard building would fill the courtyard in.
    """
    out = []
    for q in getattr(g, "geoms", [g]):
        if q.geom_type != "Polygon" or q.area < min_area:
            continue
        rings = [ccw([(x, y) for x, y in list(q.exterior.coords)[:-1]])]
        for r in q.interiors:
            if abs(signed_area(list(r.coords))) < 1.0:
                continue
            rings.append(ccw([(x, y) for x, y in list(r.coords)[:-1]]))
        out.append(rings)
    return out


def _half_from_diagonal(d):
    """Corner-to-corner across a square -> the `half` chamfered_square() wants.

    Facades are measured off a nadir tile corner to corner when the building is
    rotated to the street grid, so the diagonal is usually the number you have.
    Converting here keeps the unit visible at the call site.
    """
    return round(d / (2 * math.sqrt(2)), 2)


BUILDINGS = {
    # ── Dobie Twenty21, 1972, J. & G. Daverman. 27-storey tower on a two-level
    # mall + garage podium. The 1990 retrofit stripped the brick and left the
    # green vision glass, so this is the only curtain wall in the group — hence
    # family `tg` (51% glazing) where everything else is punched.
    # The source polygon is the WHOLE BLOCK (4,998 m2, 86 x 70 m). The tower is
    # a chamfered square rotated 45 deg to the grid, ~42 m across the diagonal,
    # measured off the z20 nadir against a 10 m grid — so it gets `tplan`.
    # That diagonal is corroborated by OSM's own building:part for the tower
    # (way/516187626), which is 100.0% inside this footprint and is therefore a
    # usable ground truth for the tower's plan: minimum rotated rectangle
    # 31.15 x 31.50 m, diagonal 44.3 m, area 867 m2, edges at 39.3 deg. Both
    # routes to `half` agree at 15.66.
    #
    # Two numbers here were wrong and the second was hidden by the first.
    #   half:  21.0 was half of the DIAGONAL, so the tower baked at 42 m on a
    #          SIDE — 1,692 m2 against a true ~880.
    #   du/dv: (10.5, -2.0) put the tower centre 18 m east of where it is. The
    #          true centre in this bake's own local frame (metres east/north of
    #          the vertex-mean origin the emitter uses) is (-7.53, -0.21).
    # Together they cantilevered 371 m2 of a 55.7 m tall band past the block
    # edge over open pavement. The rotation was always right: the footprint's
    # obb sits at 174.9 deg and rot=45 lands the tower at 39.9 deg against a
    # measured 39.3. None of this needs a render to check — see the overhang
    # assertion in main(), which is what caught the centre after the size was
    # fixed.
    "Dobie Twenty21": dict(
        base=(6.0, "sp", MASONRY),
        podium=(3, 3.6, "dk", "#c8c2b7"),
        tower=("tg", "#5f7a80"),
        crown=(5.0, "sf", CROWN_TEAL),
        mech=4.5, deck="podium", balc=None, step=None,
        tplan=(0.0, -7.53, -0.21, 45.0, 6.0, _half_from_diagonal(44.3)),
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
        rail="rail", crowninset=0.9,
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
        # The broad vertical strips its own description has always claimed. The
        # plan is only 45.6 m on its long axis, so three strips is the most that
        # resolves; 40% of the elevation is the pale panel (see two_tone above).
        bays=[(0.00, 0.22, MT_PALE), (0.22, 0.60, MT_CHAR),
              (0.60, 0.78, MT_PALE), (0.78, 1.00, MT_CHAR)],
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
        # Stanley's pierced "Solar Unit" breeze block IS the balcony parapet on
        # this building, and until now the balconies were bare 0.34 m shelves
        # with nothing standing on them. Pale, because the breeze block is
        # precast concrete, not the black steel every 2010s block uses. Not
        # segmented: the balcony runs the whole elevation, which is sourced.
        rail="raill",
    ),
}

# ══ TIER TWO — the West Campus MID-RISE BLOCKS ════════════════════════
#
# WHY THERE IS A SECOND TIER. Tier one is the ten things that read as TOWERS.
# But West Campus is not made of towers; it is made of six-to-ten storey blocks,
# and they are what you fly past. Simeon's note is about those:
#
#   "so many apartments in austin wampus have such cool designs but are
#    currently regular building blocks"
#
# He is right, and the reason turned out to be measurable rather than aesthetic.
#
# **The colour was already in the data and the renderer was throwing it away.**
# `bake_detail.py` measures a wall colour per building — Rambler #966753 brick
# red, 2400 Nueces #9ea8af cool grey, Pointe on Rio #99a4aa blue-grey — and then
# `quantiseFacades()` elects the FOURTEEN most populous tones city-wide and folds
# everything else into its nearest survivor. Rambler's brick comes out #af785d.
# Measured over the 284 West Campus buildings ≥12 m, that fold moves a wall by a
# median of 13.9 RGB and by up to 97.5 (Ion Austin's #54555b charcoal is painted
# terracotta). A feature in THIS file skips the election — `quantiseStadiumFacades`
# gives every (family, colour) its own atlas entry — so bringing a block in here
# is what lets it keep the colour the imagery measured off it.
#
# WHAT THIS TIER DELIBERATELY DOES NOT DO, and each is a defect avoided:
#   - **It never changes a building's HEIGHT.** The Standard is a 17-storey tower
#     (Humphreys & Partners: 17 floors, 287 units, 989 beds, 640 parking spaces,
#     1.34 acres) and the snapshot has it at 20.5 m, which is the old building's
#     LiDAR. Correcting that belongs in `scripts/hero_overrides.json` + a re-run
#     of `enrich.py`, because `js/controls.js` builds its collision field from
#     `final_height`, `js/shadows.js` reads it, and the labels sit on it. Raising
#     it HERE would draw a tower you can fly straight through. See HANDOFF.
#   - **It never puts anything on a roof that `bake_roofscape.py` already
#     furnished.** Measured: The Standard carries a generic roof deck at
#     b=21.50 h=21.75 and 16 detail-tier condensers; 2400 Nueces a deck at
#     22.20; Sterling, Twenty Two 15, Grayson, Block on 25th and The Nine the
#     same. Those ids are NOT in `authoredRoofIds`, and adding them there would
#     need `data/roofscape.geojson` re-baked, which this lane does not own. So
#     the roofs are left exactly as they are, and TIER TWO PUTS NOTHING ON A
#     ROOF AT ALL.
#
#     That last sentence cost The Standard its pool deck, and the reason is worth
#     writing down because it is not aesthetic. Its lap pool, spa, turf strip and
#     jumbotron are measurable — the z20 nadir post-dates the building and shows
#     all of them at the NW corner — and they were built here, placed off that
#     nadir in this bake's own (u,v) frame, and then removed. Every route to
#     drawing them fails on the SAME wall:
#       * on top of the generic deck (21.75 m) — breaks `westcampus-probe.mjs`'s
#         "nothing stands above final_height", which is 20.5 m for this building;
#       * on a lower stepped wing, which is what the real massing is — the
#         generic deck spans the whole footprint at 21.5 m and would then hover
#         over the wing with clear sky under it, the exact defect
#         docs/PASS_GLITCH.md exists for;
#       * at the parapet — `roof_z` is H + cap_lift, so still above H.
#     All three are downstream of ONE stale number: 20.5 m for a 17-storey
#     building. Fix the height in `scripts/hero_overrides.json` and the pool deck
#     lands 35 m clear of the stale roofscape and every route opens at once. Do
#     not re-add it before then.
#   - **It never cuts a courtyard the data does not have.** 2400 Nueces really
#     has two, and they are absent from its 8-node polygon — but the generic
#     roofscape deck spans the whole footprint, so a hole underneath it would be
#     invisible and the effort would buy nothing. Amenity goes only in courtyards
#     that are ALREADY holes (`court`), where it is visible from above.
#   - **It never touches a pitched roof.** Checked: none of the ten has a facet
#     in `data/roofs.geojson`. The Villas on Guadalupe is left out for exactly
#     this reason — the nadir shows grey hip roofs over a garden-apartment block
#     and a garage deck, and this tier has no vocabulary for either.
#
# `courtyard` index into the footprint's holes. The amenity deck, pool and shade
#           are placed from THAT RING'S OWN obb, so nothing is eyeballed: a
#           courtyard pool is a fraction of the courtyard, wherever it is.
MIDRISE = {
    # ── The Standard at Austin, 715 W 23rd, Humphreys & Partners, 2021.
    # Read off the architect's own exterior photographs, not from memory:
    # a two-storey glazed retail base under a CHARCOAL panel corner bay carrying
    # the name; above it a light field of cream / warm grey / charcoal panels
    # laid up in a broken "pixel" pattern with terracotta accents; projecting
    # balconies with black rails on every residential floor; a flat parapet.
    # The body hex is the AREA-WEIGHTED read of that pixel field (five clusters
    # over a 600x800 crop, glass excluded, lifted out of blue hour) — the same
    # call union24.js makes and for the same reason: this renderer gets one wall
    # colour per band and the honest value is the distant read.
    # No roof amenity — see the tier header. When the height is corrected, the
    # measured deck is: pool (51.8, -15.0, 4.4, 9.5), turf (46.0, -18.0, 5.0,
    # 8.0), jumbotron (46.0, -11.5, 11.0, 1.0) 4.2 m tall, pergola
    # (36.0, -19.0, 7.0, 6.0) — all in this bake's (u,v) frame, all read off the
    # z20 nadir and checked by drawing them back onto it.
    "The Standard": dict(
        base=(7.0, "sg", BASE_STD),
        podium=None,
        tower=("mh", STD_BODY),
        crown=(2.6, "sf", CROWN_STEEL),
        mech=0.0, deck=None, balc=("long", 1, 4), step=None, tplan=None,
        # ── TIER THREE. Everything below is read off humphreys_00.jpg.
        # The plan's long axis is 94.9 m and +u runs WEST (obb bearing 175.3
        # deg): u=0 is the Rio Grande end, u=1 is the corner of 23rd and PEARL,
        # which is the corner the photograph is taken of — the street sign in
        # frame reads 23rd / Pearl. So the slate corner bay goes at u=1. If it
        # is ever shown to be at the other end that is ONE number, which is why
        # bays are fractions of the obb and not coordinates.
        bays=[(0.00, 0.30, STD_WARM), (0.30, 0.58, STD_CREAM),
              (0.58, 0.86, STD_PALE), (0.86, 1.00, STD_SLATE, None, True)],
        # The slate volume oversails the parapet and carries THE STANDARD in
        # white. Cut OUT of final_height, never added to it: the parapet drops
        # by this much so the sign panel tops out at exactly H, the same call
        # `mech` makes. 13.3 m of 94.9 m, which is the width in the photograph.
        bayrise=2.2,
        # Individual projecting balconies with black steel rails, one per unit,
        # not the continuous shelf the bake drew. Measured off the photograph
        # against the panel module: the balconies sit about every second bay.
        balcseg=(3.4, 6.8), rail="rail",
        crowninset=0.9,
    ),
    # ── Rambler, 2513 Seton Ave. The nadir shows a cream perimeter block around
    # ONE courtyard — already a hole in the footprint — with a long lap pool and
    # cabana rows down it. Body colour is the imagery's own #966753: this is one
    # of the two brick buildings in West Campus and the fourteen-bucket election
    # was painting it #af785d, a 31.8 RGB move onto the same terracotta as the
    # churches.
    "Rambler": dict(
        base=(4.6, "sn", BASE_BRICK),
        podium=None,
        tower=("mh", "#966753"),
        crown=(2.2, "sf", CROWN_PALE),
        mech=0.0, deck=None, balc=("long", 1, 3), step=None, tplan=None,
        courtyard=0, courtpool=(0.34, 0.62), courtshade=(0.30, 0.16, 0.30, 0.72),
        rail="rail", balcseg=(3.6, 7.2), crowninset=0.8,
    ),
    # ── 2400 Nueces. A 99.6 x 56.1 m perimeter block, six storeys, in the cool
    # grey the imagery measures (#9ea8af). The nadir shows two internal
    # courtyards and two big roof fans; the courtyards are not in the polygon and
    # are left alone (see the header). OSM's building:levels=16 disagrees with a
    # 21.2 m building by a factor of three and is not used.
    "2400 Nueces": dict(
        base=(5.0, "sp", BASE_STONE),
        podium=None,
        tower=("mh", "#9ea8af"),
        crown=(2.4, "sf", CROWN_STEEL),
        mech=0.0, deck=None, balc=("long", 1, 4), step=None, tplan=None,
        # ── TIER THREE, off Architect Magazine's own photograph. #9ea8af is a
        # true reading of the panel field and a false reading of the BUILDING:
        # a honey Texas-limestone volume runs the full height at one end, and
        # there are dark umber accent panels through the field. The 99.6 m long
        # axis runs SOUTH (+u), so u=1 is the 24th Street end — the end the
        # "NUECES ST 2400" sign in the photograph is posted at, because Austin's
        # hundred-blocks are numbered from the south. Limestone goes there.
        # `sp` on the limestone bay: piers with deep openings, which is what a
        # coursed-stone volume with punched windows is; `mh` would put the
        # panel grid on it.
        bays=[(0.00, 0.30, "#9ea8af"), (0.30, 0.42, UMBER_PANEL),
              (0.42, 0.82, SILVER_PANEL), (0.82, 1.00, TX_LIMESTONE, "sp")],
        # White metal balustrades, not black — they are plainly white in the
        # photograph and it is what dates the building to 2011 rather than 2019.
        rail="raill", crowninset=0.7,
    ),
    # ── The Quarters Grayson House, 714 W 22nd. The nadir shows a clean U — a
    # deep light-well notch cut into the SOUTH elevation, already in the 20-node
    # footprint — a pale cream parapet band, and a warm brick storey below it.
    # The balcony slabs are clipped to the footprint here, which is what lets a
    # U-plan have them at all: an unclipped slab on the notched elevation bridges
    # the notch and hangs in mid air.
    "The Quarters Grayson House": dict(
        base=(5.0, "sn", BASE_BRICK),
        podium=None,
        tower=("mh", "#d5c6aa"),
        crown=(2.6, "sf", CROWN_PALE),
        mech=0.0, deck=None, balc=("long", 1, 6), step=None, tplan=None,
    ),
    # ── The Quarters Sterling House, 709 W 22nd. Same complex, same materials,
    # one storey shorter. Its courtyard carries a green sport court and a pergola
    # in the nadir — but the footprint has no hole there, so it stays a wall.
    "The Quarters Sterling House": dict(
        base=(5.0, "sn", BASE_BRICK),
        podium=None,
        tower=("mh", "#d5c6aa"),
        crown=(2.4, "sf", CROWN_PALE),
        mech=0.0, deck=None, balc=("long", 1, 5), step=None, tplan=None,
    ),
    # ── The Nine at West Campus, 2518 Leon St, five levels (OSM, and 14.4 m
    # agrees). White render over a glazed base; the nadir shows a central light
    # well with a spa and a pergola down inside it, and rows of condensers.
    "The Nine at West Campus": dict(
        base=(4.6, "sg", BASE_GLASS),
        podium=None,
        tower=("mh", "#afaba2"),
        crown=(2.2, "sf", CROWN_PALE),
        mech=0.0, deck=None, balc=("long", 1, 3), step=None, tplan=None,
    ),
    # ── Twenty Two 15, 2215 Rio Grande, eight levels and 156 flats (OSM).
    # Grey concrete roof, a light-well notch on the north side already in the
    # footprint, cast-stone base.
    "Twenty Two 15": dict(
        base=(5.2, "sp", BASE_STONE),
        podium=None,
        tower=("mh", "#cdba98"),
        crown=(2.6, "sf", CROWN_PALE),
        mech=0.0, deck=None, balc=("long", 1, 6), step=None, tplan=None,
    ),
    # ── The Block, 2504 Nueces. The tallest of the tier at 32.7 m, and a true
    # perimeter block: the nadir shows a large central courtyard, which IS a hole
    # in the footprint, and the roofscape put no deck on it — so this is one of
    # the three courtyards in this tier you can actually see into.
    "The Block": dict(
        base=(5.4, "sg", BASE_GLASS),
        podium=None,
        tower=("mh", "#a9a499"),
        crown=(2.8, "sf", CROWN_PALE),
        mech=0.0, deck=None, balc=("long", 1, 7), step=None, tplan=None,
        courtyard=0, courtshade=(0.0, 0.0, 0.34, 0.34),
    ),
    # ── Block on 25th East. A 91 m bar, cream, with a white roof.
    # CORRECTION to the note that used to sit here: the pitched roofs at the
    # ends are NOT neighbours. block-on-25th-east_nadir_z20.jpg shows grey
    # shingled hips running the whole PERIMETER of this footprint around a white
    # flat deck. This tier has no vocabulary for a hip roof (it is the reason
    # Block on 25th WEST is excluded), so the walls get tier three and the roof
    # stays as it is — recorded rather than quietly drawn flat. No `crowninset`
    # for the same reason: a setback under a hip roof would be a second error.
    "Block on 25th East": dict(
        base=(5.0, "sp", BASE_STONE),
        podium=None,
        tower=("mh", "#ded2bc"),
        crown=(2.6, "sf", CROWN_PALE),
        mech=0.0, deck=None, balc=("long", 1, 6), step=None, tplan=None,
        # A five-storey BURNT-ORANGE stucco mass at one end of a cream bar, over
        # a rough-cut Texas limestone ground floor — American Campus's own
        # 671_01_exterior.jpg, and the most UT-coloured building in West Campus.
        # WHICH end took two independent readings that agree: in the photograph
        # the long face is sunlit and the end return is in shade, and in the
        # nadir every shadow runs to the north-west. Both put the sun in the
        # south-east, so the camera is south of a bar that runs east-west and
        # the shaded end is the WEST one. +u runs west (obb 175.8 deg), so the
        # orange mass is at u=1.
        bays=[(0.00, 0.16, PALE_STUCCO), (0.16, 0.74, "#ded2bc"),
              (0.74, 1.00, BURNT_ORANGE)],
        rail="rail", balcseg=(3.2, 8.0), crowninset=0.0,
    ),
    # ── Pointe on Rio, 2101 Rio Grande. A narrow 90 x 37 m block in blue-grey
    # (#99a4aa measured) around a courtyard that the nadir shows holding a pool.
    # Two holes in the footprint; the pool is in the first.
    "Pointe on Rio": dict(
        base=(5.0, "sg", BASE_GLASS),
        podium=None,
        tower=("mh", "#99a4aa"),
        crown=(2.4, "sf", CROWN_STEEL),
        mech=0.0, deck=None, balc=("long", 1, 5), step=None, tplan=None,
        courtyard=0, courtpool=(0.40, 0.52),
    ),
    # ── The Venue on Guadalupe, six levels (OSM). Two parallel bars with a
    # terrace and a round pool between them — the pool is already in
    # data/roofscape.geojson (3 `pool` features inside this footprint) and is
    # deliberately not repeated here. Blue-grey #8d9ea9 measured.
    "The Venue on Guadalupe": dict(
        base=(5.0, "sg", BASE_GLASS),
        podium=None,
        tower=("mh", "#8d9ea9"),
        crown=(2.4, "sf", CROWN_STEEL),
        mech=0.0, deck=None, balc=("long", 1, 6), step=None, tplan=None,
    ),
    # ── The G, 2400 San Gabriel, eight levels (OSM). Clean pale flat roof with
    # one light-well slot from the north, which the 26-node footprint has.
    "The G": dict(
        base=(5.2, "sp", BASE_STONE),
        podium=None,
        tower=("mh", "#e5dbc2"),
        crown=(2.6, "sf", CROWN_PALE),
        mech=0.0, deck=None, balc=("long", 1, 6), step=None, tplan=None,
    ),
    # ── Crest at Pearl, seven levels (OSM). The nadir shows a long pool down the
    # middle of its courtyard, and the courtyard IS a hole in the footprint, and
    # bake_roofscape.py left this roof to plant only — so this is the clearest
    # courtyard in the tier: you look down a light well onto water.
    "Crest at Pearl": dict(
        base=(4.6, "sg", BASE_GLASS),
        podium=None,
        tower=("mh", "#b8b69f"),
        crown=(2.0, "sf", CROWN_PALE),
        mech=0.0, deck=None, balc=("long", 1, 3), step=None, tplan=None,
        courtyard=0, courtpool=(0.30, 0.66),
    ),
    # ── The Nine at Rio, 2222 Rio Grande. Low (12.2 m) and square, around a
    # central court that is a hole in the footprint. No roofscape at all here.
    "The Nine at Rio": dict(
        base=(4.4, "sg", BASE_GLASS),
        podium=None,
        tower=("mh", "#a7b4bc"),
        crown=(1.8, "sf", CROWN_STEEL),
        mech=0.0, deck=None, balc=("long", 1, 2), step=None, tplan=None,
        courtyard=0, courtshade=(0.0, 0.0, 0.36, 0.36),
    ),
    # NOT INCLUDED, and each for a reason a later pass should not have to
    # rediscover:
    #   Greenwood Towers   — the snapshot footprint does not sit on the building
    #                        in the z20 nadir; it outlines two roof areas 10 m
    #                        off. Banding a polygon that is in the wrong place
    #                        just makes the error legible.
    #   Block on 25th West — grey hipped roofs around its court. This tier has
    #                        no vocabulary for a pitched roof and claiming the
    #                        prism would say "flat" louder than it is said now.
    #   The Villas on Guadalupe — the same, plus an open parking deck at its
    #                        north end; 181 m of it, so getting it wrong is
    #                        expensive.
}

# ── Two tier-three values that are true of the WHOLE tier, so they are defaults
#    rather than fourteen copies of the same line. A row that names either one
#    wins, and two do: Block on 25th East sets `crowninset=0.0` because it has a
#    hip roof, and Cambridge Tower and 2400 Nueces set `rail="raill"` because
#    theirs are precast concrete and white metal rather than black steel.
#
#    THE RAIL IS THE BIGGEST SINGLE CHANGE IN THIS PASS and it is the cheapest.
#    Every one of these blocks has projecting balconies with a 1.05 m
#    balustrade, and the bake was drawing the 0.34 m slab and stopping. A shelf
#    reads as a ledge or a sunshade; a shelf with a rail on it reads as somebody
#    lives there, which is the entire point of the item.
MIDRISE_RAIL = "rail"          # black steel: every 2010s block in the tier
MIDRISE_CROWN_INSET = 0.8      # m the crown band steps in behind the wall face
for _spec in MIDRISE.values():
    if _spec.get("balc"):
        _spec.setdefault("rail", MIDRISE_RAIL)
    _spec.setdefault("crowninset", MIDRISE_CROWN_INSET)

BUILDINGS.update(MIDRISE)

# Flat-coloured pieces. js/westcampus.js carries the day/golden/night trio for
# each of these `s` classes; nothing here enters the facade atlas.
SOLID_CLASSES = ("deck", "pool", "turf", "court", "shade", "furn", "mech", "balc",
                 "rail", "raill", "sign")


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
    # `bayrise` is a colour bay that OVERSAILS the parapet — The Standard's slate
    # corner volume carrying its name, which is the thing you recognise the
    # building by from the street. Cut out of final_height exactly the way `mech`
    # is, never added to it: the parapet drops by this much so the raised bay
    # tops out at H and `westcampus-probe.mjs`'s "nothing stands above
    # final_height" still holds. Adding it on top instead was the first cut and
    # it put the sign panel 2.2 m into airspace the LiDAR says is empty.
    rise = spec.get("bayrise") or 0.0
    parapet = H - mech_h - rise
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

    # ── TIER THREE: vertical COLOUR BAYS on the tower band ------------
    #
    # THE ARGUMENT. A `fill-extrusion-pattern` has no vertical anchor, which is
    # why this bake stacks HORIZONTAL bands. It has no HORIZONTAL anchor either,
    # and that is the half nobody had used: the same trick works sideways. A
    # building whose elevation is a field of cream, warm-grey and charcoal panels
    # — which is most of what got built in West Campus after 2015 — can be said
    # as N prisms side by side, each carrying its own colour into the atlas,
    # instead of one prism carrying their average.
    #
    # The strip is cut in the building's OWN (u, v) frame, so "the west quarter
    # of the long elevation" means the same thing on a block that does not sit
    # square to north — the same reason `step` and the balconies work in that
    # frame. And the cut goes through shapely rather than through the half-plane
    # clipper `step` uses, because that clipper takes ONE ring: on a courtyard
    # building it would fill the courtyard in.
    bays = spec.get("bays")
    crown_inset = spec.get("crowninset") or 0.0
    W = u1 - u0
    for band, b, t, fam, col in stack:
        if t - b < 0.4:
            continue
        if band in ("base", "podium") or not (tplan or step):
            rr = [outer] + holes
        else:
            rr = tower_rings
        if band == "crown" and crown_inset > 0.02:
            # A setback crown: the top band steps in behind the wall face, so
            # the tower band's own roof shows as a ledge all the way round. Only
            # the outer ring moves — growing a light well by the same amount is
            # not what a setback is, and on The G's 26-node slot it self-
            # intersects. `offset` returns a CLOSED ring; wall_feature does not
            # care, but keep the shape consistent with everything else here.
            ins = offset(rr[0] + [rr[0][0]], -crown_inset)
            if ins:
                rr = [ccw(ins)] + rr[1:]
                stats["crown_setback"] += 1
            else:
                stats["crown_setback_failed"] += 1
        if band == "tower" and bays:
            plan = _poly(rr)
            drawn = 0
            for spec_bay in bays:
                f0, f1 = spec_bay[0], spec_bay[1]
                bcol2 = spec_bay[2]
                bfam2 = (spec_bay[3] if len(spec_bay) > 3 and spec_bay[3] else fam)
                if (f1 - f0) * W < BAY_MIN:
                    stats["bay_too_narrow"] += 1
                    continue
                strip = _poly([rect_uv(ang, u0 + f0 * W, v0 - BAY_PAD,
                                       u0 + f1 * W, v1 + BAY_PAD)])
                for piece in _rings_of(plan.intersection(strip), 3.0):
                    out.append(wall_feature(piece, b, t, bfam2, bcol2, band, name,
                                            False, lon0, lat0, "bay"))
                    stats["bay"] += 1
                    drawn += 1
                # The oversailing bay: same plan, carried on up past the crown
                # to the parapet the `rise` was cut out of. cap=0, because the
                # cap layer would then extrude it another cap_lift ABOVE H.
                if len(spec_bay) > 4 and spec_bay[4] and rise > 0.05:
                    up_b = parapet + cap_lift(parapet)
                    if H - up_b > 0.3:
                        for piece in _rings_of(plan.intersection(strip), 3.0):
                            out.append(wall_feature(piece, up_b, H, cfam, bcol2,
                                                    "crown", name, False,
                                                    lon0, lat0, "bayrise"))
                            stats["bay_rise"] += 1
            if drawn:
                continue          # the bays ARE the band; do not also draw it flat
            stats["bay_all_dropped"] += 1
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
    #
    # CLIPPED TO THE FOOTPRINT, and that clip is what lets a non-rectangular plan
    # have balconies at all. The slab is a rectangle across the whole elevation in
    # the obb frame; on a U-plan — The Quarters Grayson House has a light-well
    # notch cut 18 m into its south elevation, Twenty Two 15 one into its north —
    # that rectangle bridges the notch and leaves a 1.4 m slab hanging in mid air
    # over the gap, once per floor. Intersecting with the footprint grown by the
    # projection keeps the slab exactly where there is a wall behind it, and the
    # buffer is what lets a genuine balcony still project past the face.
    #
    # TIER THREE adds the two things that make a balcony read as a balcony
    # rather than as a ledge, and Simeon named the first of them ("banded
    # balconies"):
    #   `balcseg`  the slab is cut into ONE BALCONY PER UNIT — a width every
    #              pitch metres — instead of running the whole elevation. A
    #              continuous shelf is right for Cambridge Tower, whose balcony
    #              genuinely is continuous and is sourced as such, and wrong for
    #              every 2010s block, where it is a row of separate boxes.
    #   `rail`     a 1.05 m balustrade standing on the slab's OUTER edge. This
    #              is the whole reason the balconies did not read: 0.34 m of
    #              slab is 0.34 m of relief, and nothing about it says a person
    #              can stand there. It is the cheapest change in the pass and
    #              the most visible one.
    balc = spec.get("balc")
    if balc:
        faces, first, count = balc
        span = tower_top - podium_top
        f2f = span / max(1, count)
        keep = _balcony_mask(outer)
        rail_inner = _poly([outer]).buffer(BALC_PROJ - RAIL_T, join_style=2)
        seg = spec.get("balcseg")
        rail_cls = spec.get("rail")
        # The run of segment start positions, CENTRED on the elevation so a
        # partial unit is split between the two ends rather than dumped on one.
        if seg:
            sw, pitch = seg
            usable = (u1 - BALC_MARGIN) - (u0 + BALC_MARGIN)
            n_seg = max(1, int((usable + pitch - sw) // pitch))
            run = n_seg * pitch - (pitch - sw)
            s0 = u0 + BALC_MARGIN + (usable - run) / 2.0
            spans = [(s0 + k * pitch, s0 + k * pitch + sw) for k in range(n_seg)]
        else:
            spans = [(u0 + BALC_MARGIN, u1 - BALC_MARGIN)]
        for i in range(count):
            zb = podium_top + (i + first * 0) * f2f + f2f * 0.62
            if zb + BALC_THICK > tower_top:
                break
            for sgn in (1, -1):
                vf = v1 if sgn > 0 else v0
                a = vf - BALC_BITE if sgn > 0 else vf + BALC_BITE
                b = vf + BALC_PROJ if sgn > 0 else vf - BALC_PROJ
                for su, eu in spans:
                    r = rect_uv(ang, su, min(a, b), eu, max(a, b))
                    slabs = _clip_to_g(r, keep)
                    for g in slabs:
                        for piece in _rings_of(g, 0.5):
                            out.append(solid_feature(piece[0], zb, zb + BALC_THICK,
                                                     "balc", name, lon0, lat0))
                            stats["balcony"] += 1
                    if not rail_cls:
                        continue
                    rtop = min(zb + BALC_THICK + RAIL_H, H - 0.05)
                    if rtop - (zb + BALC_THICK) < 0.3:
                        continue
                    # THE RAIL IS CUT OUT OF THE SLAB THAT SURVIVED, not off a
                    # line at v1 ± BALC_PROJ. That was the first cut and it drew
                    # 142 rails for 498 slabs: v1 is the obb EXTREME, so on any
                    # plan whose wall is not exactly at the extreme — which is
                    # most of them — a 0.11 m strip out there lands entirely
                    # outside the balcony mask and vanishes, while the 1.55 m
                    # slab still catches the part near the wall. Differencing
                    # the slab against the footprint grown by (PROJ − RAIL_T)
                    # leaves exactly the outer lip of whatever slab is there,
                    # following the plan round every notch.
                    for g in slabs:
                        lip = g.difference(rail_inner)
                        if lip.is_empty:
                            continue
                        for piece in _rings_of(lip, 0.10):
                            out.append(solid_feature(piece[0], zb + BALC_THICK, rtop,
                                                     rail_cls, name, lon0, lat0))
                            stats["rail"] += 1

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

    # ── tier two: amenity in a COURTYARD the footprint already has -----
    #
    # Placed from the HOLE'S OWN obb, as fractions of it, so nothing about a
    # courtyard pool is eyeballed off an aerial: it is a fraction of whatever
    # courtyard is there, wherever it is, at whatever angle. `courtz` is ground
    # level — these are garden courts, not podium decks — so the pool sits at the
    # bottom of the light well and is seen down into from above, which is exactly
    # how the nadir shows Rambler's lap pool and Pointe on Rio's.
    ci = spec.get("courtyard")
    if ci is not None and ci < len(holes):
        hole = holes[ci]
        hang, hu0, hu1, hv0, hv1 = obb(hole)
        hcu, hcv = (hu0 + hu1) / 2.0, (hv0 + hv1) / 2.0
        hw, hl = hu1 - hu0, hv1 - hv0
        z = COURT_Z
        slab = offset(hole + [hole[0]], -0.6) or (hole + [hole[0]])
        out.append(solid_feature(ccw(slab), 0.0, z, "deck", name, lon0, lat0))
        stats["courtyard"] += 1
        if spec.get("courtpool"):
            fw, fl = spec["courtpool"]
            r = rect_uv(hang, hcu - hw * fw / 2, hcv - hl * fl / 2,
                        hcu + hw * fw / 2, hcv + hl * fl / 2)
            out.append(solid_feature(r, z, z + DECK_ITEM, "pool", name, lon0, lat0))
            stats["pool"] += 1
        if spec.get("courtshade"):
            ou, ov, fw, fl = spec["courtshade"]
            cu, cv = hcu + hw * ou, hcv + hl * ov
            r = rect_uv(hang, cu - hw * fw / 2, cv - hl * fl / 2,
                        cu + hw * fw / 2, cv + hl * fl / 2)
            out.append(solid_feature(r, z + SHADE_H, z + SHADE_H + SHADE_T,
                                     "shade", name, lon0, lat0))
            r2 = rect_uv(hang, cu - hw * fw / 4, cv - hl * fl / 4,
                         cu + hw * fw / 4, cv + hl * fl / 4)
            out.append(solid_feature(r2, z, z + FURN_H, "furn", name, lon0, lat0))
            stats["shade"] += 2

    return out


def main():
    feats = json.load(open(SNAP, encoding="utf-8"))["features"]
    by_name = {}
    for f in feats:
        n = (f["properties"].get("name") or "")
        if n in BUILDINGS:
            by_name[n] = f

    out, replaced, authored = [], [], []
    stats = Counter()
    rows = []
    made_by_building = []
    for name, spec in BUILDINGS.items():
        f = by_name.get(name)
        if not f:
            print("  MISSING from the snapshot:", name)
            stats["missing"] += 1
            continue
        made = build(f, spec, stats)
        out.extend(made)
        made_by_building.append((name, f["geometry"], made))
        replaced.append(f["properties"]["id"])
        if name not in MIDRISE:
            authored.append(f["properties"]["id"])
        rows.append((name, f["properties"]["final_height"], len(made)))
        stats["buildings"] += 1

    for n, h, c in sorted(rows, key=lambda r: -r[1]):
        print("  %-26s h=%5.1f  ->  %3d features" % (n[:26], h, c))

    # No authored band may hang off its own building. A `tplan` tower is the only
    # thing here whose plan is TYPED rather than derived from the source polygon,
    # so it is the only one that can be wrong in a way no other check catches —
    # and it was: Dobie's tower was entered at half-of-diagonal and baked 1.95x
    # too big, cantilevering a 55.7 m slab 10 m past the block edge over open
    # pavement. This is arithmetic, so it runs on every bake and needs no render.
    # 3% tolerance absorbs the chamfer and the balcony/step overhangs that are
    # meant to project.
    OVERHANG_MAX = 0.03
    bad_overhang = []
    for name, foot_geom, made in made_by_building:
        foot = _shp(foot_geom)
        for g in made:
            if g["properties"].get("kind") != "wall":
                continue          # balconies and shades are MEANT to project
            band = _shp(g["geometry"])
            if band.area <= 0:
                continue
            outside = band.difference(foot).area / band.area
            if outside > OVERHANG_MAX:
                bad_overhang.append(
                    "%s wall band base=%s h=%s: %.1f%% of its plan is outside the "
                    "building footprint" % (name, g["properties"].get("base"),
                                            g["properties"].get("h"), outside * 100))
    if bad_overhang:
        raise SystemExit("bake_westcampus: refusing to write overhanging geometry:\n  "
                         + "\n  ".join(bad_overhang))

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
    # IT IS A SUBSET NOW, and the subset is the point. Tier one authors its own
    # roof and must claim it. TIER TWO DELIBERATELY DOES NOT: those ten blocks
    # keep the deck, plant and condenser field `bake_roofscape.py` already gave
    # them, because that roofscape is good, because re-baking it is another
    # lane's file, and because tier two puts nothing on a roof at all — see the
    # MIDRISE header for what that cost. Claiming them here
    # would be a delayed-action bug: nothing changes until someone re-runs
    # bake_roofscape.py, and then ten roofs go bare in a pass that never touched
    # them. So the list is exactly the buildings whose roof this file draws.
    fc = {"type": "FeatureCollection", "features": out,
          "replacedBuildingIds": replaced, "authoredRoofIds": authored}
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(fc, fh, separators=(",", ":"))
    print(json.dumps({
        "features": len(out),
        "buildings": stats["buildings"],
        "replaced_building_ids": replaced,
        "authored_roof_ids": len(authored),
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
