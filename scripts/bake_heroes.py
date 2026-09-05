# -*- coding: utf-8 -*-
"""Three modern campus buildings that arrive as boxes at HALF their real height.

QUEUE F4: *"also add some UT buildings too - some of them look really cool like
EER but rn theyre a block. DO those"*.

THE FINDING, and it is the same one three times. These three heights are not
LiDAR and they are not measurements -- they are a floor count multiplied by a
RESIDENTIAL floor height:

    Engineering Education and Research Center   8 floors x 2.84 = 22.7 m
    Bill and Melinda Gates Computer Science     6 floors x 2.80 = 16.8 m
    Norman Hackerman Building                   6 floors x 2.80 = 16.8 m

All three carry source_height:"overture". A university lab building's floor is
4.3-4.7 m, not 2.8 -- so every one of them is drawn at roughly 55% of its height,
and the floor COUNTS are short too. Against UT's own building records
(utdirect.utexas.edu/apps/campus/buildings) and the architects' published
descriptions:

    EER   9 floors, 454,393 GSF, 2017, Ennead        -> 40.5 m  (was 22.7)
    GDC   7 floors, 239,778 GSF, 2010, Pelli Clarke  -> 29.5 m  (was 16.8)
    NHB   7 storeys, 300,000 GSF, 2008, CO Architects-> 32.3 m  (was 16.8)

That is the single largest visual change in this pass and it needed no shape work
at all. The shape work is the rest of it.

WHAT EACH ONE ACTUALLY IS -- read off a photograph and a z20 nadir tile, not off
memory. Every number below has its derivation written next to it.

  EER  two nine-storey limestone BARS with a glass-roofed canyon between them and
       a black steel space-frame LATTICE closing the east end over the entrance.
       The snapshot has it as ONE solid 22.7 m prism -- and that prism also covers
       the paved courtyard north of the north bar, which is landscape, not
       building (cars are visible on it in the nadir tile). So this pass makes
       EER SHORTER in plan and nearly twice as tall.
  GDC  two bars joined at the east end by a seven-storey glass atrium, in UT's
       stack-bond Texas brick with terracotta screen bands, under a roof plane
       that oversails the walls on every side. The oversail is why the footprint
       is bigger than the floor plate: the data traces the CANOPY.
  NHB  one 149 m bar, a two-storey Cordova Cream limestone base under Acme brick,
       a four-storey recessed glass volume in the south face, and a perforated
       steel louvre plane floating over the middle 65 m of the roof.

METHOD. Each building gets a FRAME -- an origin at its own footprint centroid and
a bearing taken from its own longest edge -- and every dimension below is a
metre coordinate in that frame, read off `research`-style Esri z20 nadir mosaics
resampled into the same frame (0.10 m/px at this latitude). Nothing is eyeballed
in screen pixels and nothing is a fraction of a bounding box.

THE INSET RULE, same as scripts/bake_arts.py: the snapshot footprint is the
WIDEST element and every band is inset from it, never grown. One deliberate
exception, stated because it is an exception: EER's east notch. The footprint
traces the two bars' roofs, so the canyon between them is cut out of the ring --
but the nadir tile plainly shows the lattice cage standing in that notch, and the
street photograph shows it spanning between the towers. Filling a notch the data
cut for a roof outline is not the same as growing the building.

Provenance of every colour is in MAT. Usage:  python scripts/bake_heroes.py
"""
import json
import math
import os
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SNAP = os.path.join(ROOT, "data", "snapshots", "2026-08-03", "buildings.detailed.geojson")
OUT = os.path.join(ROOT, "data", "heroes.geojson")
M_LAT = 111320.0

# ══ 1. MATERIALS ══════════════════════════════════════════════════════
# Every hex is the median of a named patch of a named photograph. Where the
# photograph was overcast the value is normalised to a white point taken from the
# sky in the SAME frame, and the working is written out. GENERATIVE means no
# patch was clean enough and the value is derived from one that was.
MAT = {
    # ── EER (Ennead, 2017). Commons: "University of Texas at Austin August 2019
    #    17 (Engineering Education and Research Center)", CC BY-SA 4.0, and
    #    "Cockrell School of Engineering - UT Austin (54985040215)", CC BY 4.0.
    #
    # The Aug-2019 photograph is OVERCAST, which is the most useful light there
    # is for a material: no sun tint, no bounce. A 130x35 px patch of blind wall
    # between two floor lines reads #baae9f with sd 7.5 -- the tightest patch in
    # this file, one material and nothing else. The sky in the same frame reads
    # #e1e5ea, so normalising to white multiplies by 255/225, 255/229, 255/234
    # and gives #d3c2ad. That is entered here, pulled a little toward neutral
    # because EER's limestone is the COOL modern one on this campus and the point
    # of sampling it was to stop it landing on Battle Hall's cream (#e6dcc3).
    "eer_stone":   "#e2dacb",   # patch #baae9f sd 7.5, normalised #d3c2ad, then
                                # lifted to the RENDERER. Measured on a frame of
                                # this pass: a wall face lands at 0.67 of its
                                # input luma here, so #d3c2ad rendered at 133
                                # against neighbours at 123-125 -- the paler
                                # modern limestone was reading as the same brick.
                                # 218 in lands at ~150, which is the gap the
                                # photograph shows.
    "eer_base":    "#a89d8e",   # GENERATIVE: eer_stone 21% down. The canyon
                                # photograph shows the ground floor in shadow
                                # behind a recess; a base is never the same value
                                # as the wall above it.
    "eer_coping":  "#c9cac8",   # patch #c0c5c9 sd 19.7, same normalisation. A
                                # cool light metal coping, and it is the one
                                # thing on this building that is not warm.
    # The space frame is genuinely near-black steel. docs/PASS_ARTS.md's warning
    # about entering a joint colour too dark does not apply: that was a 2 px
    # shadow reveal being asked to read as a material, this IS the material.
    "eer_steel":   "#4b4f53",   # patch #6b7275 sd 80 (a 14 px member against
                                # sky), pulled down 12% for the sky bleed.
    "eer_soffit":  "#74756d",   # patch #666864 sd 17.3, normalised
    # Glass. Sampled at #6d7684 in the canyon and #bdb1a0 on the corner glazing
    # -- the second is the OPPOSITE TOWER reflected in it, which is what a canyon
    # curtain wall mostly shows. bake_arts.py measured this renderer landing a
    # wall face at about R x0.78 / G x0.69 / B x0.58 of its input, so a glass
    # entered at the photographed R/B lands neutral. Entered bluer to land blue,
    # the same correction and for the same reason as Bass's lobby.
    "eer_glass":   "#4d81ad",

    # ── GDC (Pelli Clarke Pelli, 2010). Commons: "Gates-Dell Complex - UT Austin
    #    (54984937843)", CC BY 4.0. Sunlit, November, low sun.
    # A 300x220 px patch of the sunlit facade splits cleanly by luminance: the
    # top 30% is #f9ddbf (sunlit cast-stone and brick pier), the bottom 30% is
    # #5e4330 (the terracotta screen and the window reveals), the median is
    # #937a78. The top decile is blown by the low sun, so the brick is entered
    # from the median of the light half rather than its median.
    "gdc_brick":   "#d8ccb6",   # light-half of #f9ddbf / #937a78, desaturated:
                                # measured, the first cut of this tile rendered
                                # #b86939 (R/B 3.23) -- a red brick, not the
                                # cream-and-terracotta this building is.
    "gdc_screen":  "#8a6a55",   # dark-half #5e4330, lifted -- a perforated
                                # terracotta screen is a shadow pattern, and a
                                # shadow has to be entered already lit here.
    "gdc_soffit":  "#d8cfbd",   # the painted soffit under the oversail. Pelli's
                                # own note is that it recalls the painted wood
                                # soffits of the campus core, so it is warm.
    "gdc_recess":  "#6b5b4e",   # patch #42342c (ground-floor recess), lifted
    "gdc_glass":   "#4f86b4",   # ribbon glazing #6d6d79. Entered MUCH bluer: at
                                # #7c8f9e it rendered #998a6d, R/B 1.40 -- tan.
                                # This face orientation warms R/B by about 1.75x.

    # ── NHB (CO Architects, 2008). Commons: "Norman Hackerman Building - UT
    #    Austin (54984998499)", CC BY 4.0.
    # The press description is unusually specific and the patches agree with it:
    # "the stories above the smooth Cordova Cream limestone are clad in one of
    # UT's traditional Acme brick blends".
    "nhb_stone":   "#cfc9ba",   # limestone base, patch median #828476 in shade,
                                # light-half #b2b2b8; entered at the sunlit value
                                # the campus limestone elsewhere in this repo uses
    "nhb_brick":   "#c9a37c",   # Acme tan blend, light-half of #fceddb/#7d7c7c
    # The four-storey recessed glass volume is the loudest thing on the building
    # and it is genuinely BLUE -- median #24497e over a 310x220 px patch, which is
    # the most saturated colour anywhere in this pass. Entered close to sampled:
    # it does not need the bluer correction because it is already far from
    # neutral, and over-correcting would make it cyan.
    "nhb_glass":   "#2f5c94",
    "nhb_steel":   "#8e969c",   # the perforated louvre plane, patch #73838d
                                # (steel plus the sky coming through it)
    "nhb_deck":    "#b6b3a8",   # GENERATIVE: roof membrane, from the nadir tile's
                                # bright roof runs (195-225 grey)
}


def wall_ramp(hex_col):
    """day -> (golden, night). Lifted verbatim from scripts/bake_arts.py, which
    lifted it from bake_stadium.py. Same reason all three need it: none of these
    materials is in the city's fourteen facade colour buckets, and nearest-RGB
    over a palette that is almost all tan turns blue glass into brick."""
    c = [int(hex_col[i:i + 2], 16) for i in (1, 3, 5)]
    mixc = lambda a, b, t: [a[i] + (b[i] - a[i]) * t for i in range(3)]
    golden = mixc(c, [255, 190, 130], 0.16)
    night = mixc([v * 0.19 for v in c], [18, 22, 40], 0.42)
    hexify = lambda v: "#" + "".join("%02x" % max(0, min(255, int(round(x)))) for x in v)
    return hexify(golden), hexify(night)


# ══ 2. THE THREE FRAMES ═══════════════════════════════════════════════
# origin  = the snapshot footprint's own centroid
# bearing = the footprint's own longest edge, degrees anticlockwise from east
# Both are printed by the frame builder that resampled each nadir mosaic, so the
# u,v numbers below are exactly the numbers that were read off those images.
# `glassb` is a second curtain-wall image, and it exists for one measured
# reason: NHB's recessed volume samples at #24497e, the most saturated colour in
# this pass, while EER's canyon glass and GDC's atrium both sample near-neutral
# grey-blue. One image cannot be both, and a pattern takes no per-feature colour.
SOLID, GLASS, GLASSB, LATTICE, LIME, BRICK, NBRICK = \
    "solid", "glass", "glassb", "lattice", "lime", "brick", "nbrick"

FRAMES = {
    "eer": dict(origin=(-97.7353983, 30.2884073), bearing=-5.432),
    "gdc": dict(origin=(-97.7365678, 30.2862887), bearing=175.116),
    "nhb": dict(origin=(-97.7378270, 30.2876315), bearing=-4.725),
}

# ── EER ───────────────────────────────────────────────────────────────
# HEIGHT, and this is the one number the whole building hangs on.
#
# UT's building record says 9 floors (EER-0223, 454,393 GSF, 2017). The Aug-2019
# elevation photograph shows the floor lines directly: scanned as a brightness
# profile down a blind column of the east gable they sit at image rows 494, 559,
# 626, 695, 766, and the spacing GROWS 65, 67, 69, 71 px because the camera was
# tilted up. That growth is the scale, not noise. Fitting a projective scale
# s(y) = 13.9 + (y-450)*3.0/620 px/m -- anchored on the gable being 23.2 m wide
# (its own footprint depth) at the top of the wall -- turns those five rows into
# floor heights of 4.56, 4.59, 4.63, 4.66, 4.68 m. Nine nearly-identical numbers
# out of a model with two free parameters is the model verifying itself.
#
# Integrating that scale from the parapet (row 450) to the extrapolated grade
# (row 1070) gives 40.4 m. Entered as 40.5.
EER_H = 40.5
EER_FLOOR = 4.65          # measured, above. 2.84 m is what the snapshot implies.
# Plan, in the frame, straight off the snapshot ring (which is rectilinear in
# this frame to within 0.5 m -- the frame is the building's own):
EER_NBAR = (-33.30, 47.20, -4.95, 17.80)    # u0,u1,v0,v1  80.5 x 22.75
EER_SBAR = (-33.30, 47.70, -49.50, -26.30)  #              81.0 x 23.20
# The canyon is the ring's own two notches joined: v -26.3..-4.95, 21.35 m wide.
# The glass roof over it runs u -18.0..+37.0 -- measured as a bright run in a
# u-profile of the nadir tile across v -18..-8, with the open west porch
# (u -22.6..-18.0) reading dark in the same profile.
EER_ATRIUM_U = (-18.0, 38.0)
EER_CANYON_V = (-26.30, -4.95)
# The atrium roof sits 10.5 m below the tower parapets. Cross-check, and it is
# the reason this number is 30 and not 33: in the nadir tile the south bar casts
# a 4.9 m shadow ACROSS the atrium roof (a hard edge, 8-40 grey against 200-234
# either side, at v -23.7 to -18.8). 4.9 m of shadow for 10.5 m of height is a
# sun elevation of 65 degrees, which is what Austin gets at midday most of the
# year. At 33 m it would need 74 degrees and the shadow would be 2.9 m.
EER_ATRIUM_H = 30.0
# The lattice fills the east notch, u 38.0..47.5 -- the notch's own width. Top
# and bottom read off the same photograph through the same projective scale:
# the cage's top rail at image row 588 -> 30.7 m, its bottom where it meets the
# terrace band at rows 904-932 -> 10.1-8.3 m.
EER_CAGE = (38.0, 47.50)
EER_CAGE_BASE = 9.6
EER_CAGE_TOP = 30.70

# ── GDC ───────────────────────────────────────────────────────────────
# 7 floors (UT record GDC-0152, 239,778 GSF, 2010). No photograph here gives a
# frontal face to measure a floor off, so the floor height is the campus figure
# this pass measured on EER, minus the difference between a wet-lab building and
# an office/teaching building: 4.10 m. 7 x 4.10 = 28.7, plus a 0.8 m roof plane.
GDC_H = 29.5
# THE OVERSAIL. Pelli's roof plane hangs past the wall on every side and the
# footprint traces the ROOF, not the wall -- so the wall bands inset and the roof
# band does not, and the cantilever falls out for free. 2.5 m, from two readings
# that agree: a v-profile across the south bar's south edge puts the roof edge
# 1.7 m outside the ring and a recessed line 1.6 m inside it; and 239,778 GSF
# over 7 floors needs a 3,182 m2 plate against a 3,886 m2 footprint, which is a
# 2.0-2.5 m inset all round.
GDC_OVERSAIL = 2.5
# The seven-storey glass atrium is the link between the two bars, u 10.6..32.5,
# v -1.0..11.7 in the frame -- the ring's own vertices, i.e. the NOTCH the ring
# cuts between the two bars.
GDC_ATRIUM = (10.60, 32.50, -1.00, 11.70)
# THE ATRIUM'S PLANE. Until 2026-09-05 the atrium was emitted at inset 0 while
# every brick band around it was inset GDC_OVERSAIL, and the comment on that
# line called it deliberate: "it stands 2.5 m proud of the brick, which is
# exactly what it does." It is not what it does. Two nadir mosaics resampled
# into this frame at 0.06 m/px disagree with it, and so does Google Earth's
# mesh from the west (the Speedway side, which is +u here -- bearing 175.116
# puts +u at 175 degrees anticlockwise from east, i.e. very nearly due west):
#
#   Esri World Imagery z20   the notch mouth is in the south bar's shadow and
#                            the only edge it offers slopes 0.35 m of u per
#                            metre of v -- a shadow line, not a wall. Unusable,
#                            and the first read off it (a 3.4 m recess) was
#                            this shadow being measured three times.
#   Google z20               the same frame, a different overpass, no shadow in
#                            the notch: the atrium's own roof runs from the
#                            link out to u 26.9, a lighter strip follows, and a
#                            hard dark line stands at u 29.00 across the full
#                            width of the notch. Both providers put the bars'
#                            roof canopy end at u 34.0 +/- 0.1, so the two
#                            frames agree in u to a tenth of a metre.
#   Google Earth 3D          from 30.28629,-97.73657 at 190 m, heading 90,
#                            tilt 72: the two brick ends stand FORWARD and the
#                            slot between them recedes. Nothing stands proud.
#
# The brick end wall this bake draws is at 32.50 - GDC_OVERSAIL = 30.00 (the
# ring's own two end vertices are 32.37 and 32.57). The line the shadow-free
# frame puts at 29.00 is therefore 0.90 m behind the brick.
GDC_ATRIUM_RECESS = 0.90  # m the glass sits behind the brick end wall
# IN v THE ATRIUM KEEPS THE RING'S OWN NOTCH, and that is a decision, not an
# omission. The oversail moves each bar's notch-facing brick 2.5 m further out,
# so glass left at the ring's notch width sits 2.5 m INSIDE the brick on both
# flanks -- a deep reveal, which is what Google Earth's mesh shows from the west
# (the slot recedes; nothing stands forward). Growing it to meet those flanks
# was tried and rejected on two counts: the shadow-free Google nadir reads the
# atrium's roof NARROWER than the ring notch, not wider, so the growth has no
# measurement behind it; and a 17.7 m-wide glass slab swallows the door on the
# south flank, which is GDC's Speedway entrance -- it came out of the bake
# 29 m away on the courtyard wall. One measured change, in u.

# ── NHB ───────────────────────────────────────────────────────────────
# 7 storeys (CO Architects / Architizer; UT's record says 9 floors and NHB is
# built into the 24th Street slope with vibration-isolated basement labs, so two
# of those nine are below grade -- 300,000 GSF over a 3,901 m2 footprint needs
# more than seven plates). 7 x 4.30 = 30.1 for a chemistry lab building.
NHB_H = 30.10
NHB_OVERSAIL = 2.5
NHB_BASE_H = 9.00         # "the stories above the smooth Cordova Cream
                          # limestone are clad in Acme brick" -- two storeys.
# The louvre plane. In the nadir tile it is unmistakable: a dark regular grid
# over u -35..+30, v -12..+8, i.e. the middle 65 m of a 149 m building, which is
# exactly the "expansive perforated-steel roof overhang ... providing shade to
# the entire south facade" the architects describe. It is INSIDE the ring, so it
# is drawn at the ring and floats 0.8 m over the roof deck.
NHB_LOUVRE = (-35.0, 30.0)
NHB_LOUVRE_H = 1.50
# The four-storey recessed glass volume in the south face. Levels 4-7.
NHB_GLASS_U = (5.0, 45.0)
NHB_GLASS_BASE = 12.90


# (name, base_m, top_m, inset_m, material, layer, cap)
BANDS = {
    "eer_bar": [
        # No separate ground band on the long faces: the nadir tile shows the
        # bars meeting grade flush and the only photograph of a base is of the
        # canyon, which is a different face. Two bands, and the top one is the
        # blind parapet zone the photograph measures at 3.15 m.
        ("body",    0.0,        EER_H - 3.15, 0.0, "eer_stone", LIME,  0),
        ("parapet", EER_H - 3.15, EER_H,      0.0, "eer_stone", SOLID, 1),
    ],
    "gdc": [
        ("ground",  0.0,  4.60,   GDC_OVERSAIL, "gdc_recess", SOLID, 0),
        ("body",    4.60, 28.70,  GDC_OVERSAIL, "gdc_brick",  BRICK, 0),
        ("roof",    28.70, GDC_H, 0.0,          "gdc_soffit", SOLID, 1),
    ],
    "nhb": [
        ("base",    0.0,   NHB_BASE_H, NHB_OVERSAIL, "nhb_stone", SOLID, 0),
        ("body",    NHB_BASE_H, 28.60, NHB_OVERSAIL, "nhb_brick", NBRICK, 0),
        ("parapet", 28.60, NHB_H,      NHB_OVERSAIL, "nhb_stone", SOLID, 0),
        ("deck",    NHB_H, NHB_H + 0.7, 0.0,         "nhb_deck",  SOLID, 1),
    ],
}

# id8 -> (slug, stack) for the buildings whose bands come from the RING.
RING_TARGETS = {
    "44e418d6": ("gdc", "gdc"),   # Bill and Melinda Gates Computer Science Complex
    "f8a072d5": ("nhb", "nhb"),   # Norman Hackerman Building
}
EER_ID8 = "8f0abac0"

# A cap is a ROOF surface and a top face barely dims in this renderer: measured
# on a frame of this pass, #dadbdb went in at luma 218 and came out at 207 while
# the neighbouring roofs in the same frame sat at 145-175. A cap entered at a
# street elevation's value is the brightest object in the picture, which is
# exactly defect D9. Entered ~25% down so they land in the roofscape's range.
CAP_MAT = {"gdc": "#aaa69c", "nhb": "#a5a298", "eer": "#a9aaa8"}

# Authored heights, handed to js/heroes.js so the flight collision field knows
# the buildings got taller. Without this you fly straight through the top 18 m
# of EER -- js/controls.js builds its height field from `final_height`, and
# these three features keep theirs (the pass never edits the snapshot).
HERO_HEIGHTS = {}


# ══ 3. geometry (from scripts/bake_arts.py) ═══════════════════════════
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


def same_orientation(a, b):
    return (signed_area(a) > 0) == (signed_area(b) > 0)


def offset(pts, d):
    """Offset a closed ring by d metres; POSITIVE grows. None if it degenerates."""
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
    if not same_orientation(ring, ccw(pts) + [ccw(pts)[0]]):
        return None
    return ring


def to_m(ring, lat0):
    k = math.cos(math.radians(lat0))
    return [(p[0] * M_LAT * k, p[1] * M_LAT) for p in ring]


def to_ll(pts, lat0):
    k = math.cos(math.radians(lat0))
    ring = list(pts)
    if ring[0] != ring[-1]:
        ring = ring + [ring[0]]
    return [[round(x / (M_LAT * k), 7), round(y / M_LAT, 7)] for (x, y) in ring]


def frame_rect(slug, u0, u1, v0, v1):
    """A rectangle given in a building's own frame, back in lon/lat."""
    F = FRAMES[slug]
    lon0, lat0 = F["origin"]
    a = math.radians(F["bearing"])
    ca, sa = math.cos(a), math.sin(a)
    k = math.cos(math.radians(lat0))
    ring = []
    for u, v in ((u0, v0), (u1, v0), (u1, v1), (u0, v1)):
        x = u * ca - v * sa
        y = u * sa + v * ca
        ring.append([round(lon0 + x / (M_LAT * k), 7), round(lat0 + y / M_LAT, 7)])
    return ring + [ring[0]]


def feat(ring_or_rings, props):
    rings = ring_or_rings if isinstance(ring_or_rings[0][0], list) else [ring_or_rings]
    return {"type": "Feature", "properties": props,
            "geometry": {"type": "Polygon", "coordinates": rings}}


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


# ══ 4. the three builds ═══════════════════════════════════════════════
def build_eer(out, stats):
    """Two bars, a glazed canyon, and the lattice that closes its east end."""
    for tag, (u0, u1, v0, v1) in (("nbar", EER_NBAR), ("sbar", EER_SBAR)):
        for name, b, h, inset, mat, layer, cap in BANDS["eer_bar"]:
            r = frame_rect("eer", u0 + inset, u1 - inset, v0 + inset, v1 - inset)
            out.append(feat(r, band_props("eer", tag + "_" + name, mat, layer, b, h, cap)))
            stats["eer_bands"] += 1

    au0, au1 = EER_ATRIUM_U
    cv0, cv1 = EER_CANYON_V
    # The two canyon walls. 0.7 m slabs standing INSIDE the canyon against each
    # bar, so the slot keeps its depth: filling the canyon solid with glass would
    # read as a third bar from every angle except straight down.
    for tag, (v0, v1) in (("nwall", (cv1 - 0.70, cv1)), ("swall", (cv0, cv0 + 0.70))):
        out.append(feat(frame_rect("eer", au0, au1, v0, v1),
                        band_props("eer", tag, "eer_glass", GLASS, 0.0, EER_ATRIUM_H - 1.2, 0)))
        stats["eer_bands"] += 1
    # The glass roof: a 1.2 m slab, not a full-height volume, for the same reason.
    out.append(feat(frame_rect("eer", au0, au1, cv0, cv1),
                    band_props("eer", "atrium_roof", "eer_glass", GLASS,
                               EER_ATRIUM_H - 1.2, EER_ATRIUM_H, 0)))
    stats["eer_bands"] += 1

    gu0, gu1 = EER_CAGE
    out.append(feat(frame_rect("eer", gu0, gu1, cv0, cv1),
                    band_props("eer", "entrance", "eer_soffit", SOLID, 0.0, EER_CAGE_BASE, 0)))
    out.append(feat(frame_rect("eer", gu0, gu1, cv0, cv1),
                    band_props("eer", "cage", "eer_steel", LATTICE,
                               EER_CAGE_BASE, EER_CAGE_TOP, 0)))
    out.append(feat(frame_rect("eer", gu0, gu1, cv0, cv1),
                    band_props("eer", "cage_rail", "eer_steel", SOLID,
                               EER_CAGE_TOP, EER_CAGE_TOP + 0.80, 0)))
    stats["eer_bands"] += 3
    HERO_HEIGHTS["eer"] = EER_H


def build_ring(f, slug, stack, out, stats):
    p = f["properties"]
    g = f["geometry"]
    rings = g["coordinates"] if g["type"] == "Polygon" else g["coordinates"][0]
    outer_ll = rings[0]
    lat0 = sum(q[1] for q in outer_ll) / len(outer_ll)
    outer = ccw(to_m(outer_ll, lat0))
    cache = {}
    for name, b, h, inset, mat, layer, cap in BANDS[stack]:
        if inset <= 0.001:
            ring = to_ll(outer, lat0)
        else:
            key = round(inset, 3)
            if key not in cache:
                cache[key] = offset(outer + [outer[0]], -inset)
            r = cache[key]
            if r is None:
                stats["inset_collapsed"] += 1
                ring = to_ll(outer, lat0)
            else:
                ring = to_ll(ccw(r), lat0)
        out.append(feat(ring, band_props(slug, name, mat, layer, b, h, cap)))
        stats[slug + "_bands"] += 1

    if slug == "gdc":
        # The atrium on the plane the building actually has: its outer face
        # 0.90 m behind the brick end wall instead of GDC_OVERSAIL proud of
        # it, and the ring's own notch kept in v. See GDC_ATRIUM_RECESS.
        u0, u1, v0, v1 = GDC_ATRIUM
        au1 = u1 - GDC_OVERSAIL - GDC_ATRIUM_RECESS
        av0, av1 = v0, v1
        pr = band_props("gdc", "atrium", "gdc_glass", GLASS, 0.0, 28.70, 0)
        # ?wallplane=0 puts the atrium back where main draws it. The shape
        # changes here, not just the position, so the switch carries the whole
        # ring rather than an offset the way the entrances bake does.
        pr["wp0"] = frame_rect("gdc", u0, u1, v0, v1)
        # And the same move as a VECTOR, for the doors: the outer face
        # travelled GDC_OVERSAIL + GDC_ATRIUM_RECESS along +u, and any door
        # standing on that face travelled with it.
        o = frame_rect("gdc", 0.0, GDC_OVERSAIL + GDC_ATRIUM_RECESS, 0.0, 0.01)
        pr["wpd"] = [round(o[1][0] - o[0][0], 7), round(o[1][1] - o[0][1], 7)]
        out.append(feat(frame_rect("gdc", u0, au1, av0, av1), pr))
        stats["gdc_bands"] += 1
        HERO_HEIGHTS["gdc"] = GDC_H
    if slug == "nhb":
        lu0, lu1 = NHB_LOUVRE
        # The louvre plane needs clipping to the ring in u. On this building the
        # ring IS a clean 149 x 26.7 box in its own frame (7 vertices, the only
        # departure a 0.4 m jog at the east end), so the frame rectangle is the
        # clip and no polygon intersection is needed. Stated because it would NOT
        # be true of the other two.
        out.append(feat(frame_rect("nhb", lu0, lu1, -13.60, 12.30),
                        band_props("nhb", "louvre", "nhb_steel", SOLID,
                                   NHB_H + 0.7, NHB_H + 0.7 + NHB_LOUVRE_H, 0)))
        gu0, gu1 = NHB_GLASS_U
        # 0.35 m proud of the brick so the recessed volume reads as a volume and
        # not as a repaint. Still 2.15 m inside the footprint.
        sv = -13.91 + NHB_OVERSAIL
        out.append(feat(frame_rect("nhb", gu0, gu1, sv - 0.35, sv + 0.90),
                        band_props("nhb", "glassvol", "nhb_glass", GLASSB,
                                   NHB_GLASS_BASE, 28.60, 0)))
        stats["nhb_bands"] += 2
        HERO_HEIGHTS["nhb"] = NHB_H + 0.7 + NHB_LOUVRE_H


def main():
    feats = json.load(open(SNAP, encoding="utf-8"))["features"]
    byid = {f["properties"]["id"][:8]: f for f in feats}
    out, replaced = [], []
    stats = Counter()
    heights = {}

    f = byid.get(EER_ID8)
    if not f:
        raise SystemExit("EER not in snapshot")
    build_eer(out, stats)
    replaced.append(f["properties"]["id"])
    heights[f["properties"]["id"]] = EER_H
    print("  %-5s %-46s %5.1f -> %5.1f m, %d features"
          % ("eer", f["properties"]["name"][:46], f["properties"]["final_height"],
             EER_H, stats["eer_bands"]))

    for i8, (slug, stack) in RING_TARGETS.items():
        f = byid.get(i8)
        if not f:
            print("  !! %s not in snapshot" % i8)
            stats["target_missing"] += 1
            continue
        n0 = len(out)
        build_ring(f, slug, stack, out, stats)
        replaced.append(f["properties"]["id"])
        heights[f["properties"]["id"]] = HERO_HEIGHTS[slug]
        print("  %-5s %-46s %5.1f -> %5.1f m, %d features"
              % (slug, (f["properties"].get("name") or "?")[:46],
                 f["properties"]["final_height"], HERO_HEIGHTS[slug], len(out) - n0))

    fc = {"type": "FeatureCollection", "features": out,
          "replacedBuildingIds": replaced,
          # Every one of the three is drawn taller than the snapshot says, so the
          # generic roof decks and mechanical clutter for all three now sit
          # metres down inside authored geometry. Declared here so the next
          # scripts/bake_roofscape.py run drops them (it scans data/*.geojson for
          # this key); until then they are simply invisible, not wrong.
          "authoredRoofIds": replaced,
          # js/heroes.js hands these to window.__flyRebuildCollision.
          "heroHeights": heights}
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(fc, fh, separators=(",", ":"))

    print(json.dumps({
        "features": len(out),
        "replaced_building_ids": len(replaced),
        "file_kb": round(os.path.getsize(OUT) / 1024, 1),
        "counts": dict(sorted(stats.items())),
        "heights_m": {k[:8]: v for k, v in heights.items()},
        "provenance": {
            "plans": "FACTUAL - EER from its own snapshot ring read in the "
                     "building's frame (the ring is rectilinear there to 0.5 m); "
                     "GDC and NHB from the ring itself, inset only",
            "heights": "SOURCED - floor counts from UT's building records and the "
                       "architects' published descriptions; EER's 40.5 m measured "
                       "off a dated photograph through a fitted projective scale "
                       "and cross-checked against a shadow in the z20 nadir tile",
            "colours": "SOURCED - median of a named patch of a named Commons "
                       "photograph, normalised to a white point in the same frame "
                       "where the light was overcast; see MAT",
            "band_splits": "GENERATIVE - no public source gives storey elevations; "
                           "every split is one number on one line here",
        },
    }, indent=2))


if __name__ == "__main__":
    main()
