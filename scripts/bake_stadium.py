# -*- coding: utf-8 -*-
"""Build DKR from the photograph, not from a guess about what a stadium is like.

WHAT CHANGED, AND WHY IT MATTERS

v1 turned the footprint from a flat-topped mesa into an open bowl. That was the
right first move — DKR's ring is 82% of its footprint area, so 82% of the
stadium had been drawing as roof — but it stopped at "a bowl". Twelve seating
bands of flat silver read, from the air, as a smooth grey dish. A real stadium
does not look like that from the air even slightly, and this file now says why,
with numbers taken off a georeferenced 13 cm/px nadir photograph rather than off
an intuition.

`scripts/fetch_dkr_reference.py` fetches that photograph WITH its bbox recorded,
and `scripts/probe_dkr.py` inverts the projection so anything visible in it can
be read as a lon/lat and a size in metres. (The aerial already in the repo,
data/dkr_aerial.png, has no recorded bbox at all: projecting the stadium's own
footprint through the only bbox in the repo lands the building 1.5 km outside
the frame. It was a mood board, not a measurement.)

MEASURED OFF THE PHOTOGRAPH — every one of these is a `probe_dkr.py` reading:

  seat rows       0.74 m pitch. Thirteen-and-a-bit stripes per 10 m, which is
                  the 30-inch row spacing every bleacher in America uses.
  aisle pitch     ~14 m between the stairs that run up the rake.
  vomitories      ~5 x 3 m dark openings, sitting ON the aisles.
  bright deck     #99968b, luma mean 149.5 — the brightest large surface in the
                  frame, as v1 already knew.
  stained deck    #897968, luma 122.9. Large irregular blotches of warm brown
                  weathering across the aluminium, 2-8 m across.
  deck contrast   luma SD 51.6, p10/p90 79/228. THIS is the number v1 missed.
                  The deck is not "silver"; it is a violent fine stripe of lit
                  plank against shadowed riser. Painting its MEAN is why it read
                  as a smooth dish.
  ramp towers     four ~14 m circular pedestrian ramp towers, positions read off
                  the photograph to seven decimal places. The 2008 north-end
                  contractor's note that "radiused block walls on the pedestrian
                  ramps ... creates the angular expression seen from the
                  exterior" is these.

The stripe is answered with GEOMETRY, not paint: the band count goes from 12 to
~44, so each band is a real step about three rows deep and MapLibre's own side
faces become the risers. A texture could not have done it — a fill-extrusion
pattern is locked to the tile, not to the ring, so its stripes would run across
the bowl's curve instead of around it.

SOURCED, NOT MEASURED — the photograph is Esri World Imagery and PREDATES the
2021 south end zone (tested: only 2,170 scattered burnt-orange pixels in the
south structure, against 17,516 in the painted north end zone — there is no
Longhorn balcony in this picture). So the south end is built from published
dimensions instead, and is labelled generative in the provenance block:

  south end zone  2021, Populous / Hensel Phelps, $175M, 240,000 sq ft.
  Longhorn balcony  215 x 72 ft = 65.5 x 21.9 m, clad in custom UT Burnt Orange
                  ALUCOBOND PLUS — the first team logo ever carved into a
                  seating bowl, and explicitly designed to be seen from the air,
                  which makes it the single most valuable object in this file.
  entry towers    two seven-storey towers, "Rusted Metal" finish.
  video board     55.85 x 134.38 ft = 17.0 x 41.0 m, south end.
  field           FieldTurf; burnt orange end zones lettered TEXAS / LONGHORNS;
                  an orange border that runs only to the 20-yard lines, not
                  around the whole field; midfield Longhorn.

GENERATIVE, and declared as such: all deck ELEVATIONS (no public source gives
per-deck heights — they descend from the height already in the data), the light
mast positions, and the rake gamma.

Usage:  python scripts/bake_stadium.py
"""
import json
import math
import os
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SNAP = os.path.join(ROOT, "data", "snapshots", "2026-07-30", "buildings.detailed.geojson")
OUT = os.path.join(ROOT, "data", "stadium.geojson")
M_LAT = 111320.0

# ── Taste block. Every value here is a one-line override. ─────────────
WALL_THICK_M = 7.0       # depth of the perimeter wall band
DECK_TOP_FRAC = 0.93     # top of the upper deck, as a fraction of wall height
UPPER_FOOT_FRAC = 0.50   # where the upper deck starts, ditto
RAKE_GAMMA = 1.35        # >1 = steeper near the top, which is how a bowl rakes

# THE BOWL SECTION, and the thing v1 got structurally wrong. The west crop of
# the aerial (scripts/verify/shots/dkr-r-west.png) shows THREE seating decks
# divided by TWO black slots four to six metres wide - the shadow under each
# deck's overhang. Those two slots are most of what makes a bowl read as a bowl
# from above; v1 had a single flat 'concourse' band and the west side came out
# as one continuous ramp. Radial fractions run 0 at the field wall to 1 at the
# perimeter; z fractions are of the wall height.
#
# The z values are GENERATIVE - no public source gives DKR's per-deck
# elevations - but the radial ones are read off the photograph.
DECKS = [
    # name     t0     t1     z0     z1     tiers
    ("lower", 0.000, 0.400, 0.048, 0.345, 18),
    ("void",  0.400, 0.452, 0.130, 0.130,  1),
    ("mid",   0.452, 0.700, 0.460, 0.680, 13),
    ("void",  0.700, 0.752, 0.320, 0.320,  1),
    ("upper", 0.752, 1.000, 0.740, 0.930, 11),
]
STADIUM_CLASSES = ("stadium", "arena", "grandstand")

# The per-deck tier counts live in DECKS above. v1 used 6 + 6 and the bowl read
# as a smooth dish; the aerial says the deck's luma SD is 51.6 because it is
# nothing but 0.74 m steps. The counts there put a real step every 2-3 rows,
# which is the coarsest stepping that still reads as stripe rather than as
# terrace from 200-900 m up. Each band is one 63-vertex ring, so the whole
# change costs about thirty features.

SEAT_ROW_M = 0.74        # MEASURED. Row pitch, for reporting rows-per-band.
AISLE_PITCH_M = 14.0     # MEASURED. Stairs up the rake.
AISLE_W_M = 1.7          # MEASURED, roughly — 1.5-2 m of pale concrete.
AISLE_LIFT_M = 0.28      # stand the stair proud of the seats it divides
AISLE_STEPS = 7          # height segments per aisle (they follow the rake)

# Chairback seating. In the aerial's west crop the MIDDLE deck is the one dense
# with small warm-brown seat marks, while the lower bowl and the upper deck are
# mostly bare aluminium - so the chairbacks are a club level, not a ring round
# the whole bowl. The first cut of this put a saturated orange band across
# nearly half the visible deck, which is not what the photograph shows.
ORANGE_DECK = "mid"
ORANGE_FRAC = 0.45       # inner fraction of that deck which is chairback
# ... and the weathering. Measured contrast between clean and stained aluminium
# is luma 149.5 against 122.9, in blotches 2-8 m across. Bands are full rings so
# the blotching can only vary radially, but a deterministic scatter of stained
# bands is far closer to the photograph than one flat silver.
STAIN_EVERY = (7, 3, 11)  # (stride, offset, modulus): about 27% of bands weather

# South end zone, 2021. All published, none of it visible in our aerial.
BOARD_W_M = 41.0         # 134.38 ft
BOARD_H_M = 17.0         # 55.85 ft
BOARD_BASE_FRAC = 0.60   # generative: clear of the seating, under the rim
BOARD_THICK_M = 2.4
LONGHORN_W_M = 65.5      # 215 ft
LONGHORN_D_M = 21.9      # 72 ft

# Field. Regulation, and confirmed against the photograph by overlay.
FIELD_L_M = 109.73       # 120 yd including both end zones
FIELD_W_M = 48.77        # 53 1/3 yd
ENDZONE_M = 9.14         # 10 yd
FIELD_H = 0.14           # stand the turf above the ground fill. The paint
                         # sits 8 cm above it and the lines 8 cm above that:
                         # enough to never z-fight, far under a pixel from the air.

# Pedestrian ramp towers. MEASURED positions, to the pixel, off the aerial.
# Height is estimated from the shadow each one throws across the plaza.
RAMPS = [
    (-97.7332074, 30.2849343, 14.0, 25.0),   # NW
    (-97.7316252, 30.2848301, 14.0, 25.0),   # NE
    (-97.7335265, 30.2847167, 14.0, 22.0),   # W
    (-97.7313597, 30.2845766, 14.0, 22.0),   # E
    (-97.7315555, 30.2826916, 14.0, 22.0),   # SE
]
MAST_COUNT = 8           # generative. Slim masts on the west and east rims.
MAST_TOP_M = 88.0
MAST_W_M = 2.2
MAST_HEAD_W_M = 9.0

# Which side of the bowl each wall segment belongs to. Sectors are measured from
# the FIELD's long axis, so a stadium that does not sit square to north still
# gets its end zones called ends. Half-width in degrees for the two end sectors.
END_SECTOR_DEG = 52.0

# ── The elevations, and why they differ ───────────────────────────────
# A stadium wall is not one material from grade to rim, and DKR's four sides are
# four different buildings from four different decades. A facade pattern has no
# vertical anchor — it repeats from the extrusion base with no idea where the top
# is — so a single 63 m extrusion wearing one tile can only ever be a marching
# window grid. Each side is therefore emitted as STACKED BANDS, each its own
# feature with its own base, height, pattern family and colour.
#
#   plinth  the concourse arcade you walk past. Present on all four sides.
#   mid     the building proper — this is where the sides diverge.
#   fascia  the back of the upper deck: a big blank raking concrete wall. It is
#           the single most important band, because it is what stops the window
#           grid from marching all the way to the roofline.
#
# WEST is Bellmont Hall — eleven levels built in 1972 INSIDE the support
#      structure of the west upper deck, housing athletics offices, lecture halls
#      and Kinesiology. It genuinely has windows; the office-block look was not
#      wrong here, it was wrong everywhere else.
# NORTH is the 2008 Red McCombs Red Zone. The photograph (Commons,
#      DKR_new_north_end_2008-08-30) shows what it actually is, and it is not a
#      window wall: massive CHAMFERED RED-BRICK PIERS on a tall buff cast-stone
#      base, with the bays between them left open and deeply shadowed so you see
#      straight through to the stacked concourse decks, plus occasional tall
#      grey-mullioned glass and a near-black cap band.
# EAST  is grandstand back — cast-in-place concrete over a cream base wall
#      carrying huge printed photo murals and burnt-orange accent panels.
# SOUTH is the 2021 Populous addition: metal panel and glass, club and suite
#      levels, the only genuinely modern elevation.
#
# The mid band ends at 0.66 of the wall — 41.6 m, eleven levels at a 3.8 m
# academic floor-to-floor. That is not a chosen number: Bellmont Hall IS eleven
# levels, and the upper deck sits on its roof.
BANDS = [
    # name,     from,  to     (fractions of the wall height)
    ("plinth",  0.00, 0.15),
    ("mid",     0.15, 0.66),
    ("fascia",  0.66, 1.00),
]
PLINTH_FAM, PLINTH_COL = "sp", "#b3ada1"
FASCIA_FAM, FASCIA_COL = "sd", "#bab5a9"
SIDE_MID = {
    "W": ("sb", "#c0bab0"),   # Bellmont Hall, painted concrete
    # Darker and redder than it looks like it should be. The north end is the one
    # genuinely BRICK elevation on the building, and at #8f6b58 with the facade
    # stack's +10% gain and warm tint on top it came back out of the renderer as
    # the same pale tan as the concrete sides — the whole point of giving the
    # stadium its own palette entries was to stop exactly that happening.
    "N": ("sn", "#7d4f3a"),   # 2008 brick piers over buff cast stone
    "E": ("sf", "#b9b3a7"),   # painted cast-in-place concrete over a cream base
    "S": ("sg", "#adb0b2"),   # 2021 club/suite glazing
}

# Materials that are not walls. Entered as their true colour; wall_ramp() derives
# golden and night. UT's official burnt orange is #BF5700, and that is the
# ALUCOBOND custom finish on the Longhorn balcony, so it is used verbatim there.
BURNT_ORANGE = "#bf5700"
COL = {
    "turf":     "#3f6b3a",   # FieldTurf, darker green since the 2021 install
    "turf_lit": "#5e9a52",   # ... and under the floodlights
    "endzone":  BURNT_ORANGE,
    "paint":    "#e8e6e0",   # yard lines and lettering
    "board":    "#14161c",   # the video board, dark and matte in daylight
    "board_lit": "#6d7f96",  # ... and lit after dark, which it always is
    "boardrim": "#2b2f36",
    "orangeseat": "#a85426",  # chairbacks: burnt orange, weathered and dusty
    "ramp":     "#b6b0a4",   # pale concrete ramp towers
    "mast":     "#8e9299",
    "mast_lit": "#cfe0f2",   # the lamp array, on
    "aisle":    "#c6c1b6",   # pale concrete stair, brighter than the benches
}


def wall_ramp(hex_col):
    """day -> (golden, night) using the same relationship the city bake uses.

    Checked against DKR's own baked trio: #b7b1a6 -> #c3b19c / #1e2029. These
    colours must NOT be snapped to the city's shared palette — the 2008 north
    end zone is brick, and nearest-RGB against fourteen mostly-tan buckets
    quietly turned it back into tan. facades.js gives the stadium its own palette
    entries, which is why the trio has to be carried here.
    """
    c = [int(hex_col[i:i + 2], 16) for i in (1, 3, 5)]
    mixc = lambda a, b, t: [a[i] + (b[i] - a[i]) * t for i in range(3)]
    golden = mixc(c, [255, 190, 130], 0.16)
    night = mixc([v * 0.19 for v in c], [18, 22, 40], 0.42)
    hexify = lambda v: "#" + "".join("%02x" % max(0, min(255, int(round(x)))) for x in v)
    return hexify(golden), hexify(night)


# ── geometry helpers ──────────────────────────────────────────────────
def signed_area(pts):
    a = 0.0
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        a += x0 * y1 - x1 * y0
    return a * 0.5


def ccw(pts):
    """Closed ring, counter-clockwise, without the repeated last point."""
    p = pts[:-1] if pts[0] == pts[-1] else pts[:]
    if signed_area(p + [p[0]]) < 0:
        p = p[::-1]
    return p


def offset(pts, d):
    """Offset a closed ring by d metres. POSITIVE d grows the ring outward.

    Edge offset plus consecutive-line intersection. Returns None if the result
    degenerates, which is the right answer for an offset larger than the shape.
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
        nx, ny = dy / L, -dx / L          # outward normal for a CCW ring
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


def to_m(ring, lat0):
    k = math.cos(math.radians(lat0))
    return [(p[0] * M_LAT * k, p[1] * M_LAT) for p in ring]


def to_ll(pts, lat0):
    k = math.cos(math.radians(lat0))
    ring = list(pts)
    if ring[0] != ring[-1]:
        ring = ring + [ring[0]]
    return [[round(x / (M_LAT * k), 7), round(y / M_LAT, 7)] for (x, y) in ring]


def ll_to_m(lon, lat, lat0):
    k = math.cos(math.radians(lat0))
    return (lon * M_LAT * k, lat * M_LAT)


def centroid(pts):
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))


def ray_hit(c, ang, ring):
    """Where a ray from c at angle `ang` leaves `ring`. Both are in metres.

    The seating bands need a point on the field hole that CORRESPONDS to each
    vertex of the wall, so a band can be a blend of the two. A ray from the
    centre gives that correspondence for any two rings that are star-shaped about
    it, which both of these are — and unlike a uniform offset it keeps the real
    per-side widths (85 m west, 32 m south).
    """
    dx, dy = math.cos(ang), math.sin(ang)
    best = None
    n = len(ring)
    for i in range(n):
        x0, y0 = ring[i]
        x1, y1 = ring[(i + 1) % n]
        ex, ey = x1 - x0, y1 - y0
        den = dx * ey - dy * ex
        if abs(den) < 1e-12:
            continue
        t = ((x0 - c[0]) * ey - (y0 - c[1]) * ex) / den
        u = ((x0 - c[0]) * dy - (y0 - c[1]) * dx) / den
        if t > 0 and -1e-9 <= u <= 1 + 1e-9:
            if best is None or t < best:
                best = t
    if best is None:
        return None
    return (c[0] + dx * best, c[1] + dy * best)


def long_axis(ring):
    """Angle of the ring's longest EDGE — the axis the field runs along.

    This used to take the longest DIAGONAL, between any two vertices, and the
    comment above it confidently called that "the axis the field runs along".
    It is not. DKR's field hole is a 68.4 x 123.3 m rectangle, so the longest
    distance between two of its corners is the 141.0 m diagonal at bearing
    114.4 deg, while the actual long side runs at 85.3 deg. Everything keyed to
    this angle was therefore rotated by TWENTY-NINE DEGREES: the turf, the end
    zones, the yard lines, the video board, the Longhorn balcony, the light
    masts, and — least visibly and most damagingly — the N/S/E/W side
    assignment, which put the 2008 brick north elevation across the wrong faces
    of the building.

    Classic case of writing down a rule and never checking it reproduces the one
    example available. On a rectangle the longest edge is the answer; on any
    convex ring it is still the right reading of "which way does this thing run".
    """
    best, bang = -1.0, 0.0
    n = len(ring)
    for i in range(n):
        ax, ay = ring[i]
        bx, by = ring[(i + 1) % n]
        d = math.hypot(bx - ax, by - ay)
        if d > best:
            best, bang = d, math.atan2(by - ay, bx - ax)
    # The edge direction is still arbitrary in SIGN — an edge traversed the other
    # way points 180 deg off, and the first version of this labelled the south
    # end "N" for exactly that reason. Point it north so the names mean what they
    # say.
    if math.sin(bang) < 0:
        bang += math.pi
    return bang


def deck_height(t, h):
    """Height of the deck at radial fraction t (0 = field, 1 = wall)."""
    for name, t0, t1, z0, z1, _n in DECKS:
        if t <= t1 + 1e-9:
            if name == "void":
                return z0 * h
            f = ((t - t0) / max(1e-9, t1 - t0)) ** RAKE_GAMMA
            return (z0 + (z1 - z0) * f) * h
    return DECKS[-1][4] * h


def bands():
    """(t_lo, t_hi, class) per seating band, walking the decks in order.

    The trailing A/B on each class is the ROW STRIPE. Geometry already steps at
    every band, but at 200-900 m a 0.74 m step is well under a pixel, so the
    steps alone average back to flat exactly where the flyover lives.
    Alternating two near-identical tones keeps the stripe alive at every
    distance without ever reading as a stripe pattern up close.
    """
    out = []
    for name, t0, t1, _z0, _z1, n in DECKS:
        for i in range(n):
            a = t0 + (t1 - t0) * i / n
            b = t0 + (t1 - t0) * (i + 1) / n
            if name == "void":
                out.append((a, b, "void"))
                continue
            stride, off, mod = STAIN_EVERY
            if name == ORANGE_DECK and (i + 0.5) / n < ORANGE_FRAC:
                base = "orange"
            elif (i * stride + off) % mod < 3:
                base = "stain"
            else:
                base = name
            out.append((a, b, base + ("B" if i % 2 else "")))
    return out


def side_for(ang, axis):
    """N / S / E / W relative to the field's own long axis."""
    d = math.degrees((ang - axis + math.pi) % (2 * math.pi) - math.pi)
    if abs(d) <= END_SECTOR_DEG:
        return "N"
    if abs(d) >= 180 - END_SECTOR_DEG:
        return "S"
    return "E" if d < 0 else "W"


def rect(cx, cy, w, d, ang):
    """Axis-aligned-in-rotated-frame rectangle, centred, returned in metres."""
    ca, sa = math.cos(ang), math.sin(ang)
    out = []
    for ux, uy in ((-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2)):
        out.append((cx + ux * ca - uy * sa, cy + ux * sa + uy * ca))
    return out


def disc(cx, cy, r, n=20):
    return [(cx + r * math.cos(2 * math.pi * i / n),
             cy + r * math.sin(2 * math.pi * i / n)) for i in range(n)]


def feat(ring_m, lat0, props, hole_m=None):
    """One polygon. If it carries a `col`, expand it into a day/golden/night trio.

    Everything that is not a wall — turf, paint, the board, the balcony, the
    ramps, the masts, the aisles — is drawn by ONE fill-extrusion layer whose
    colour is interpolated between two `['get', ...]` properties at paint time.
    That is the only way a per-feature material can ride the same day ramp as the
    rest of the scene without a layer per material: a texture that only looks
    right at noon is not finished, and there are seven materials here.
    """
    if "col" in props:
        g, n = wall_ramp(props["col"])
        # A video board is a LIGHT SOURCE, so the one thing it must not do is
        # follow the wall ramp down into the dark at night. wall_ramp() would
        # take it to #0a0b0f; the real one is the brightest object on campus
        # after sunset. `night` overrides the derived value for exactly that.
        props = dict(props, cd=props["col"], cg=props.get("golden", g),
                     cn=props.get("night", n))
        for k in ("col", "night", "golden"):
            props.pop(k, None)
    coords = [to_ll(ring_m, lat0)]
    if hole_m:
        coords.append(to_ll(hole_m, lat0))
    return {"type": "Feature", "properties": props,
            "geometry": {"type": "Polygon", "coordinates": coords}}


# ── the bake ──────────────────────────────────────────────────────────
def build(feature, stats):
    p = feature["properties"]
    g = feature["geometry"]
    name = p.get("name") or "(unnamed)"
    h = p.get("final_height") or 0
    outer_ll, hole_ll = g["coordinates"][0], g["coordinates"][1]
    lat0 = sum(q[1] for q in outer_ll) / len(outer_ll)
    outer = ccw(to_m(outer_ll, lat0))
    hole = ccw(to_m(hole_ll, lat0))

    inner_ring = offset(outer + [outer[0]], -WALL_THICK_M)
    if inner_ring is None:
        stats["wall_offset_failed"] += 1
        return [], None
    inner = ccw(inner_ring)
    c = centroid(hole)
    axis = long_axis(hole)

    out = []
    base_props = {k: p.get(k) for k in ("wd", "wg", "wn", "rd", "rg", "rn")}

    # 1. the perimeter wall, in per-side segments -----------------------
    runs, cur, cur_side = [], [], None
    n = len(inner)
    for i in range(n):
        a, b = inner[i], inner[(i + 1) % n]
        mid = ((a[0] + b[0]) / 2 - c[0], (a[1] + b[1]) / 2 - c[1])
        s = side_for(math.atan2(mid[1], mid[0]), axis)
        if s != cur_side and cur:
            runs.append((cur_side, cur))
            cur = [i]
        else:
            cur.append(i)
        cur_side = s
    if cur:
        runs.append((cur_side, cur))
    if len(runs) > 1 and runs[0][0] == runs[-1][0]:
        runs[-1] = (runs[-1][0], runs[-1][1] + runs[0][1])
        runs = runs[1:]

    for side, idxs in runs:
        if len(idxs) < 2:
            continue
        pts = [idxs[0]] + idxs[1:] + [(idxs[-1] + 1) % n]
        poly = [outer[i] for i in pts] + [inner[i] for i in pts][::-1]
        if abs(signed_area(poly + [poly[0]])) < 5:
            continue
        for bname, f0, f1 in BANDS:
            if bname == "plinth":
                fam, col = PLINTH_FAM, PLINTH_COL
            elif bname == "fascia":
                fam, col = FASCIA_FAM, FASCIA_COL
            else:
                fam, col = SIDE_MID.get(side, (PLINTH_FAM, PLINTH_COL))
            wg, wn = wall_ramp(col)
            # A side can be taller than the bowl. The west is: Bellmont Hall is
            # 72.5 m against the stadium's 63, and that 9.5 m of extra perimeter
            # is a real, visible part of DKR's west elevation.
            sh = SIDE_H.get(side, h)
            pr = dict(base_props)
            pr.update({"kind": "wall", "side": side, "band": bname, "fam": fam,
                       "wd": col, "wg": wg, "wn": wn,
                       "h": round(sh * f1, 2), "base": round(sh * f0, 2),
                       "name": name, "building_class": "stadium", "final_height": sh})
            out.append(feat(poly, lat0, pr))
            stats["wall_bands"] += 1
        stats["wall_segments"] += 1

    # 2. the seating bowl ----------------------------------------------
    # One ray per wall vertex, so the bands inherit the footprint's real shape.
    angs = [math.atan2(q[1] - c[1], q[0] - c[0]) for q in inner]
    pairs = []
    for a, q in zip(angs, inner):
        hp = ray_hit(c, a, hole)
        if hp is None:
            stats["ray_miss"] += 1
            hp = c
        pairs.append((hp, q))
    ring_at = lambda t: [(hp[0] + (wp[0] - hp[0]) * t, hp[1] + (wp[1] - hp[1]) * t)
                         for hp, wp in pairs]

    for lo, hi, cls in bands():
        if hi - lo < 1e-4:
            continue
        # ALWAYS punch the inner ring, including for the first band where it is
        # the field hole itself. Omitting it there makes band 0 a solid slab over
        # the turf — the field vanishes under the lowest row of seats and the
        # bowl reads as a filled dish. (v1 of this script had that bug.)
        out.append(feat(ring_at(hi), lat0,
                        {"kind": "seat", "s": cls,
                         "h": round(deck_height(hi, h), 2), "name": name},
                        hole_m=ring_at(lo)))
        stats["seat_bands"] += 1

    # 3. the aisles ----------------------------------------------------
    # MEASURED at ~14 m apart, and they are most of the bowl's radial pattern:
    # without them the concentric row stripe has nothing crossing it and the deck
    # reads as corduroy. Each aisle is split into AISLE_STEPS height segments so
    # it climbs the rake instead of flying over it as one flat plank.
    per = sum(math.hypot(pairs[i][1][0] - pairs[i - 1][1][0],
                         pairs[i][1][1] - pairs[i - 1][1][1]) for i in range(len(pairs)))
    n_aisle = max(8, int(round(per / AISLE_PITCH_M)))
    for k in range(n_aisle):
        a = 2 * math.pi * k / n_aisle
        hp = ray_hit(c, a, hole)
        wp = ray_hit(c, a, inner)
        if hp is None or wp is None:
            continue
        dx, dy = wp[0] - hp[0], wp[1] - hp[1]
        L = math.hypot(dx, dy)
        if L < 1e-6:
            continue
        px, py = -dy / L * AISLE_W_M / 2, dx / L * AISLE_W_M / 2
        for j in range(AISLE_STEPS):
            t0 = j / AISLE_STEPS
            t1 = (j + 1) / AISLE_STEPS
            a0 = (hp[0] + dx * t0, hp[1] + dy * t0)
            a1 = (hp[0] + dx * t1, hp[1] + dy * t1)
            quad = [(a0[0] + px, a0[1] + py), (a1[0] + px, a1[1] + py),
                    (a1[0] - px, a1[1] - py), (a0[0] - px, a0[1] - py)]
            out.append(feat(quad, lat0, {
                "kind": "aisle", "col": COL["aisle"],
                "h": round(deck_height(t1, h) + AISLE_LIFT_M, 2), "name": name}))
            stats["aisles"] += 1

    # 4. the field ------------------------------------------------------
    # NOT emitted as features any more. The whole field — turf, mow stripes,
    # yard lines, hash marks, numbers, end zones, lettering and the midfield
    # Longhorn — is ONE image, registered to the four corners reported below and
    # drawn by a raster layer under the stadium walls. See fieldImage() in
    # js/app.js.
    #
    # The reason is occlusion, and it is not a preference. The lettering and the
    # mark were a `symbol` layer, and MapLibre symbols do not depth-test against
    # fill-extrusions: they are composited on top of the frame, so TEXAS and the
    # Longhorn were legible through 63 m of grandstand from outside the stadium.
    # No symbol-layer setting fixes that. A raster on the ground plane is real
    # ground — the walls are drawn after it and paint over it exactly as they do
    # over every other surface.
    #
    # It also buys the field twenty-seven fewer features and everything a real
    # field has: a polygon alphabet was never going to happen.
    ca, sa = math.cos(axis - math.pi / 2), math.sin(axis - math.pi / 2)
    fx, fy = c
    # Corners in the order an `image` source wants them: top-left, top-right,
    # bottom-right, bottom-left, with the image's top edge at the north end.
    nx, ny = math.cos(axis), math.sin(axis)          # along the field, northward
    ex, ey_ = math.sin(axis), -math.cos(axis)        # across it, eastward
    HL, HW = FIELD_L_M / 2, FIELD_W_M / 2
    corners_m = [
        (fx + nx * HL - ex * HW, fy + ny * HL - ey_ * HW),   # NW -> image TL
        (fx + nx * HL + ex * HW, fy + ny * HL + ey_ * HW),   # NE -> image TR
        (fx - nx * HL + ex * HW, fy - ny * HL + ey_ * HW),   # SE -> image BR
        (fx - nx * HL - ex * HW, fy - ny * HL - ey_ * HW),   # SW -> image BL
    ]
    field_corners = [to_ll([p], lat0)[0] for p in corners_m]
    stats["field_image"] += 1

    # 5. the video board -------------------------------------------------
    # 17.0 x 41.0 m, south end, facing the field. Published, not measured — the
    # aerial predates it. At this size it is visible from anywhere in the scene.
    bz = BOARD_BASE_FRAC * h
    sgn = -1.0                                    # south is -axis
    by = sgn * (FIELD_L_M / 2 + 26.0)
    bc = (fx - by * sa, fy + by * ca)
    out.append(feat(rect(bc[0], bc[1], BOARD_W_M, BOARD_THICK_M, axis - math.pi / 2),
                    lat0, {"kind": "board", "h": round(bz + BOARD_H_M, 2),
                           "base": round(bz, 2), "col": COL["board"],
                           "golden": "#3a3129", "night": COL["board_lit"],
                           "name": name}))
    out.append(feat(rect(bc[0], bc[1], BOARD_W_M + 3.0, BOARD_THICK_M + 1.2,
                         axis - math.pi / 2), lat0,
                    {"kind": "board", "h": round(bz + BOARD_H_M + 1.6, 2),
                     "base": round(bz + BOARD_H_M, 2), "col": COL["boardrim"],
                     "name": name}))
    stats["board"] += 2

    # 6. the Longhorn balcony --------------------------------------------
    # 215 x 72 ft of custom UT Burnt Orange ALUCOBOND, the first team logo ever
    # carved into a seating bowl, and designed to be seen from exactly the angle
    # this app flies at. Published dimensions; position within the south bowl is
    # generative.
    ly = sgn * (FIELD_L_M / 2 + 20.0)
    lc = (fx - ly * sa, fy + ly * ca)
    # Its height must be the height of the SEATING IT IS CLAD ON, plus a little.
    # A hard-coded deck_height(0.42) put it at 8.2 m — well below the south bowl
    # around it — so a 65 x 22 m slab sat buried inside the seating, punching out
    # through the deck and z-fighting with every band it intersected. That is the
    # "huge block that appears and disappears" — coplanar surfaces flickering as
    # the camera moves. Measure its own radial position and sit ON the bowl.
    lang = math.atan2(lc[1] - c[1], lc[0] - c[0])
    hp, wp = ray_hit(c, lang, hole), ray_hit(c, lang, inner)
    lt = 0.42
    if hp and wp:
        span = math.hypot(wp[0] - hp[0], wp[1] - hp[1])
        if span > 1e-6:
            lt = min(0.98, math.hypot(lc[0] - hp[0], lc[1] - hp[1]) / span)
    out.append(feat(rect(lc[0], lc[1], LONGHORN_W_M, LONGHORN_D_M, axis - math.pi / 2),
                    lat0, {"kind": "logo", "h": round(deck_height(lt, h) + 0.45, 2),
                           "col": BURNT_ORANGE, "night": "#e07a30", "name": name}))
    stats["logo"] += 1

    # 7. ramp towers and light masts --------------------------------------
    for lon, lat, dia, ht in RAMPS:
        cx, cy = ll_to_m(lon, lat, lat0)
        out.append(feat(disc(cx, cy, dia / 2), lat0,
                        {"kind": "ramp", "h": ht, "col": COL["ramp"], "name": name}))
        stats["ramps"] += 1
    # Masts ride the wall ring on the two long sides. Generative positions: the
    # aerial cannot resolve a 2 m pole, but the 2016 interior panorama shows tall
    # slim masts standing well above both upper decks, and their silhouette is
    # most of what says "stadium" from a low camera.
    for k in range(MAST_COUNT):
        frac = (k + 0.5) / MAST_COUNT
        a = axis + (math.pi * frac if k % 2 == 0 else -math.pi * frac)
        wp = ray_hit(c, a, inner)
        if wp is None:
            continue
        s = side_for(a, axis)
        if s in ("N", "S"):
            continue
        out.append(feat(rect(wp[0], wp[1], MAST_W_M, MAST_W_M, axis), lat0,
                        {"kind": "mast", "h": MAST_TOP_M, "base": round(h * 0.9, 2),
                         "col": COL["mast"], "name": name}))
        # The HEAD is a lamp array, so like the video board it is the one part
        # that must not follow the wall ramp down into the dark — an unlit
        # floodlight over a stadium is a thing nobody has ever seen.
        out.append(feat(rect(wp[0], wp[1], MAST_HEAD_W_M, 1.6, axis), lat0,
                        {"kind": "mast", "h": MAST_TOP_M + 2.2, "base": MAST_TOP_M - 2.0,
                         "col": COL["mast"], "golden": "#d8c39c",
                         "night": COL["mast_lit"], "name": name}))
        stats["masts"] += 1
    return out, field_corners


# Buildings that are structurally PART of the stadium but carry their own
# footprint in the data.
#
# Bellmont Hall is the west perimeter of DKR: eleven levels built in 1972 INSIDE
# the support structure of the west upper deck. At 72.5 m it is taller than the
# stadium's own 63 m and its footprint reaches well in under the seating, so its
# flat roof drew a lid straight across the west deck — in the nadir render the
# whole west side was one olive slab where the aerial shows three tiers of bright
# bleacher. Re-emitting its own footprint as stacked bands did not help: the
# footprint is the problem, not the height.
#
# The right model is the one the building actually has. Bellmont is BENEATH the
# deck, and what you see from outside is a taller west perimeter. So its id is
# replaced and its height is handed to the stadium's own west wall segment
# instead, via SIDE_H. Nothing is lost but the lid.
ANNEX_INTO_SIDE = {"L. Theo Bellmont Hall": "W"}
SIDE_H = {}          # filled from ANNEX_INTO_SIDE at run time


def main():
    feats = json.load(open(SNAP, encoding="utf-8"))["features"]
    out, replaced, field_corners = [], [], None
    stats = Counter()
    for f in feats:
        nm = f["properties"].get("name") or ""
        if nm in ANNEX_INTO_SIDE:
            SIDE_H[ANNEX_INTO_SIDE[nm]] = f["properties"].get("final_height") or 0
            replaced.append(f["properties"].get("id"))
            stats["annex_into_wall"] += 1
    for f in feats:
        p = f["properties"]
        cls = p.get("building_class") or ""
        if not any(k in cls for k in STADIUM_CLASSES):
            continue
        g = f["geometry"]
        if g["type"] != "Polygon" or len(g["coordinates"]) < 2:
            stats["skipped_no_hole"] += 1
            continue
        if (p.get("final_height") or 0) < 12:
            stats["skipped_low"] += 1
            continue
        made, corners = build(f, stats)
        if not made:
            continue
        out.extend(made)
        field_corners = corners
        # The building's own extrusion has to STOP being drawn, or its 63 m lid
        # buries every band underneath it. app.js filters these ids out.
        replaced.append(p.get("id"))
        stats["stadiums"] += 1
        print("  %-30s h=%5.1f  ->  %d features" % ((p.get("name") or "?")[:30],
                                                    p.get("final_height") or 0, len(made)))

    # fieldCorners rides on the FeatureCollection rather than in a feature: it
    # is not geometry to draw, it is the registration for the field image, and
    # app.js reads it off the same fetch it already makes.
    fc = {"type": "FeatureCollection", "features": out,
          "replacedBuildingIds": replaced, "fieldCorners": field_corners}
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(fc, fh, separators=(",", ":"))
    print(json.dumps({
        "features": len(out),
        "replaced_building_ids": replaced,
        "field_corners": field_corners,
        "file_kb": round(os.path.getsize(OUT) / 1024, 1),
        "counts": dict(sorted(stats.items())),
        # The west side is 85.2 m from field wall to perimeter, so this says how
        # many real 0.74 m rows each emitted step stands in for. Under about
        # three and the stepping reads as rows; over about six it reads as
        # terracing, which is the failure v1 shipped.
        "rows_per_band_west": {
            d[0]: round(85.2 * (d[2] - d[1]) / d[5] / SEAT_ROW_M, 1)
            for d in DECKS if d[0] != "void"
        },
        "provenance": {
            "rings": "factual - the footprint's own outer and inner rings, blended radially",
            "sides": "factual - sectors measured from the field hole's own long axis",
            "row_pitch/aisle_pitch/deck_colours":
                "MEASURED off data/dkr_aerial_geo.png at 0.129 m/px via scripts/probe_dkr.py",
            "ramp_tower_positions": "MEASURED - read off the same photograph",
            "field/board/longhorn": "SOURCED - published dimensions; the aerial predates the 2021 south end",
            "heights/masts/rake": "GENERATIVE - fractions of the height already in the data",
        },
    }, indent=2))


if __name__ == "__main__":
    main()
