# -*- coding: utf-8 -*-
"""Bake the small things that give a place scale and identity: UT's Landmarks
public art, street furniture, planting, and current construction.

WHAT CHANGED IN THIS PASS. The first version asked OSM for five kinds of
furniture — bench, waste basket, drinking fountain, bike parking, street lamp —
and emitted 453 of them for an entire university. That is not a campus. Two
things fixed it:

  1. A WIDER QUESTION TO THE SAME SOURCE. scripts/fetch_street_furniture.py adds
     bollards, bus stops and shelters, bike share docks, emergency phones,
     flagpoles, information boards, picnic tables, planters, hedges, flowerbeds,
     fences and walls. All real, all positioned by OSM.
  2. PROCEDURAL FILL DRIVEN BY REAL GEOMETRY. Where no dataset covers a real
     thing that is obviously there — the lamps down the East Mall, the benches
     on the Six Pack, the bike racks outside every classroom building — objects
     are placed from data/ground.geojson's OSM path centrelines and the baked
     building footprints. Never scattered: a lamp sits 1.6 m off a real path at
     a fixed spacing, a bench faces a real lawn, a rack sits at the point of a
     real footprint nearest a real door-side path.

TRUTH — every feature carries `src` and, when procedural, `rule`:
  src=osm    POSITION factual, from OpenStreetMap. FORM generative.
  src=proc   POSITION generative, derived from the real geometry named in
             `rule`. FORM generative.
  Art: POSITION and NAME factual; the FORM IS NOT THE ARTWORK — each piece is a
  plinth-and-mass stand-in sized by its artwork_type, and the NAME is what
  carries the identity.

Historical-marker memorials (the ~60 "X House" plaques) stay EXCLUDED: they are
signs on buildings, invisible at any flying altitude.

Usage:  python scripts/bake_props.py
"""
import hashlib
import json
import math
import os
import sys
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
CACHE = os.path.join(DATA, "osm_cache")
GROUND = os.path.join(DATA, "ground.geojson")
MANIFEST = os.path.join(DATA, "manifest.json")
OUT = os.path.join(DATA, "props.geojson")
M_LAT = 111320.0
LAT0 = 30.286

# Drawn size per artwork_type: (half-width m, height m). GENERATIVE.
ART_FORM = {
    "statue":       (0.9, 4.2),
    "sculpture":    (1.6, 5.5),
    "installation": (2.4, 7.0),
    "mural":        (1.2, 3.0),
    "building":     (3.0, 8.0),
    None:           (1.2, 4.5),
}

# ── The furniture catalogue. FORM is generative; every entry exists to make
# one kind of object read differently from the next, because the whole point of
# a bench is that you can tell it is a bench and not a bin. ─────────────
#   kind: (length_m, width_m, height_m, colour_key, layer, orient_to_path)
# `layer`: 'mass' small solid things, 'pole' tall thin things (own layer so they
# can appear from further out — a lamp run is what draws a street), 'lit' adds a
# night glow point at the same position.
FORM = {
    # sitting, eating, drinking
    "bench":            (1.80, 0.60, 0.46, "wood",  "mass", True),
    "picnic_table":     (2.00, 1.45, 0.76, "wood",  "mass", True),
    "outdoor_seating":  (1.70, 0.70, 0.75, "wood",  "mass", True),
    "drinking_water":   (0.42, 0.42, 1.05, "steel", "mass", False),
    "bbq":              (0.80, 0.55, 0.95, "dark",  "mass", False),
    # bikes and scooters
    "bicycle_parking":  (2.60, 0.85, 0.82, "steel", "mass", True),
    "bicycle_rental":   (3.30, 1.05, 1.15, "steel", "mass", True),
    "bicycle_repair_station": (0.45, 0.45, 1.45, "sign", "pole", False),
    "scooter":          (1.10, 0.42, 1.05, "sign",  "mass", True),
    # bins and boxes
    "waste_basket":     (0.70, 0.70, 0.95, "dark",  "mass", False),
    "post_box":         (0.58, 0.48, 1.30, "sign",  "mass", False),
    "vending_machine":  (0.95, 0.72, 1.85, "steel", "mass", False),
    "street_cabinet":   (1.00, 0.55, 1.35, "steel", "mass", False),
    "atm":              (0.70, 0.50, 1.70, "steel", "mass", False),
    "charging_station": (0.55, 0.40, 1.50, "steel", "mass", False),
    "parking_meter":    (0.22, 0.22, 1.30, "dark",  "pole", False),
    "telephone":        (0.50, 0.40, 1.50, "steel", "mass", False),
    "toilets":          (2.40, 1.60, 2.60, "stone", "mass", True),
    "fitness_station":  (1.20, 1.20, 1.60, "steel", "mass", False),
    "defibrillator":    (0.35, 0.30, 1.40, "sign",  "mass", False),
    "fire_hydrant":     (0.34, 0.34, 0.85, "sign",  "mass", False),
    # things that stop cars
    "bollard":          (0.24, 0.24, 0.95, "dark",  "mass", False),
    "block":            (0.60, 0.45, 0.55, "stone", "mass", True),
    "gate":             (0.30, 0.30, 1.60, "dark",  "pole", False),
    "lift_gate":        (3.20, 0.16, 1.05, "sign",  "mass", True),
    "cycle_barrier":    (1.20, 0.20, 1.00, "dark",  "mass", True),
    # transit
    "shelter":          (4.20, 1.70, 2.60, "glass", "mass", True),
    "bus_stop":         (0.22, 0.22, 2.90, "sign",  "pole", False),
    # vertical punctuation
    "street_lamp":      (0.26, 0.26, 5.20, "dark",  "pole", "lit"),
    "flagpole":         (0.28, 0.28, 9.00, "steel", "pole", False),
    "mast":             (0.45, 0.45, 12.0, "dark",  "pole", False),
    "utility_pole":     (0.34, 0.34, 8.50, "wood",  "pole", False),
    "traffic_signals":  (0.32, 0.32, 6.00, "dark",  "pole", False),
    "information":      (1.10, 0.22, 2.20, "sign",  "mass", True),
    "advertising":      (3.00, 0.30, 4.00, "sign",  "mass", True),
    # UT's blue-light emergency phones. Their own colour: at night they are the
    # one thing on a campus path that is deliberately, permanently lit.
    "phone":            (0.30, 0.30, 2.60, "blue",  "pole", "lit"),
    # planting
    "planter":          (1.45, 1.45, 0.72, "stone", "mass", False),
}
COLOUR_KEYS = ("wood", "steel", "dark", "stone", "green", "glass", "sign", "blue")

# ── FURNITURE FORM ─────────────────────────────────────────────────────
# Every entry in FORM above is ONE CUBOID, and 2,635 of them are one cuboid
# each: a bench, a bin, a bike rack and a planter differ only in their colour
# and their proportions. The whole point of a bench is that you can tell it is a
# bench, so the common kinds are built out of parts below.
#
# TWO HARD LIMITS SHAPE THIS VOCABULARY, and both are properties of the
# pipeline rather than of taste. Neither is negotiable from inside this file.
#
#   1. NOTHING CAN FLOAT. js/props.js draws `props-furn` with
#      `fill-extrusion-base: 0`, a constant, so every part rises from the
#      ground. A hoop's top bar, a bin lid's overhang and a bus shelter's roof
#      are simply not drawable. Form is carried by the PLAN OUTLINE and the
#      HEIGHTS: a bench is a low seat mass with a taller blade behind it, a bin
#      is a round body under a narrower cap, a rack is a row of uprights. If
#      that layer ever reads `['coalesce', ['get','b'], 0]`, half of these
#      recipes get better in one line — the request is in this pass's PR.
#
#   2. NOTHING SURVIVES BELOW ~0.13 m. data/props.geojson is tiled by
#      scripts/tile.sh at --maximum-zoom=16 and tippecanoe's default detail of
#      12, so a z16 tile is 4096 units across ~528 m: ONE UNIT IS 0.129 m, and
#      the archive is over-zoomed all the way to z20+. A truthful 5 cm rack tube
#      is under half a unit and is a lottery, not a thin line. MIN_PART_M is the
#      floor, and it is why a bench here has no cast-iron ends and a bollard
#      stays a box rather than becoming a 0.24 m octagon.
MIN_PART_M   = 0.30   # thinnest member the z16 tile grid can hold (2.3 units)
MIN_PART_H   = 0.12   # shorter than this and it is not worth a feature
DISC_SEG     = 8      # an octagon reads round at every size furniture is drawn
RACK_HOOP_M  = 0.85   # target spacing of the uprights in a bike rack
COORD_DP     = 7      # 1e-7 deg = 1.1 cm. SIX would quantise a 0.30 m member.


class Parts(object):
    """Parts of ONE furniture object, in local metres about its own centre,
    with +x along the object's length axis and +y across it.

    `h` is always measured from the ground, because the layer's base is 0.
    """

    def __init__(self):
        self.out = []       # (ring_in_local_metres, height_m, colour_key)

    def box(self, cx, cy, w, d, h, col, rot=0.0):
        w, d = max(w, MIN_PART_M), max(d, MIN_PART_M)
        if h < MIN_PART_H:
            return
        c, s = math.cos(rot), math.sin(rot)
        pts = ((-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2))
        self.out.append(([(cx + x * c - y * s, cy + x * s + y * c) for x, y in pts],
                         h, col))

    def disc(self, cx, cy, r, h, col, seg=DISC_SEG):
        r = max(r, MIN_PART_M)
        if h < MIN_PART_H:
            return
        self.out.append(([(cx + r * math.cos(2 * math.pi * i / seg),
                           cy + r * math.sin(2 * math.pi * i / seg))
                          for i in range(seg)], h, col))


# Each recipe gets the object's own envelope — length, width (already carrying
# the per-object size wobble) and `s`, the height scale — and draws into `P`.
def _bench(P, L, W, s, col):
    """Seat and back. The back is what tells you which way it faces and is the
    entire reason a bench stops reading as a kerbstone; at MIN_PART_M the two
    members fill the 0.60 m depth exactly, so there is no room for the
    cast-iron ends a real one has."""
    P.box(0.0, -W * 0.25, L, W * 0.50, 0.45 * s, col)
    P.box(0.0,  W * 0.25, L, W * 0.50, 0.87 * s, col)


def _picnic_table(P, L, W, s, col):
    P.box(0.0, 0.0, L, W * 0.52, 0.74 * s, col)                    # the top
    for sy in (-1.0, 1.0):
        P.box(0.0, sy * W * 0.42, L * 0.94, W * 0.21, 0.46 * s, col)


def _waste_basket(P, L, W, s, col):
    """A bin is round, and that alone separates it from every box on the path."""
    r = min(L, W) * 0.46
    P.disc(0.0, 0.0, r, 0.84 * s, col)
    P.disc(0.0, 0.0, r * 0.76, 0.99 * s, "steel")   # the hood, narrower: see (1)


def _bicycle_parking(P, L, W, s, col):
    """A row of hoops. Drawn as uprights across the rack line — the top bar is
    the part that cannot exist (1) — and each upright is MIN_PART_M thick
    rather than a truthful 5 cm, because 5 cm is under half a tile unit (2)."""
    n = max(2, int(round(L / RACK_HOOP_M)))
    span = L - MIN_PART_M
    for i in range(n):
        x = -span / 2.0 + span * i / (n - 1.0)
        P.box(x, 0.0, MIN_PART_M, W * 0.86, 0.86 * s, col)


def _bicycle_rental(P, L, W, s, col):
    n = max(2, int(round((L - 0.6) / 0.75)))
    span = L - 1.0
    for i in range(n):
        x = -span / 2.0 + span * i / (n - 1.0)
        P.box(x, 0.0, MIN_PART_M, W * 0.52, 0.95 * s, col)
    P.box(L / 2.0 - 0.24, 0.0, 0.48, W * 0.62, 1.55 * s, "sign")   # the kiosk


def _planter(P, L, W, s, col):
    """A box with something in it. The something is the point: 408 planters put
    green back on a plaza that is otherwise stone."""
    r = min(L, W) * 0.5
    P.box(0.0, 0.0, L, W, 0.52 * s, col)
    P.disc(0.0, 0.0, r * 0.72, 1.02 * s, "green")
    P.disc(0.0, 0.0, r * 0.44, 1.24 * s, "green")


def _scooter(P, L, W, s, col):
    P.box(-L * 0.06, 0.0, L * 0.86, W * 0.72, 0.24 * s, col)       # the deck
    P.box(L * 0.40, 0.0, MIN_PART_M, W, 1.05 * s, "dark")          # stem + bar


def _shelter(P, L, W, s, col):
    """Back, two ends and a front eave; the roof between them is (1)."""
    P.box(0.0, -W * 0.42, L, W * 0.16, 2.35 * s, col)
    for sx in (-1.0, 1.0):
        P.box(sx * (L / 2.0 - 0.15), 0.0, MIN_PART_M, W * 0.92, 2.45 * s, col)
    P.box(0.0, W * 0.42, L, W * 0.16, 2.60 * s, "dark")


# Kinds NOT in here are drawn as the single cuboid they always were, and that is
# a decision per kind, not an oversight: an ATM, a post box, a vending machine
# and a street cabinet ARE boxes, and a bollard is 0.24 m across — under two
# tile units (2), where an octagon comes out worse than the square.
FURN_SHAPE = {
    "bench": _bench,
    "picnic_table": _picnic_table,
    "outdoor_seating": _bench,
    "waste_basket": _waste_basket,
    "bicycle_parking": _bicycle_parking,
    "bicycle_rental": _bicycle_rental,
    "planter": _planter,
    "scooter": _scooter,
    "shelter": _shelter,
}

# Line barriers drawn as thin ribbons along their real geometry.
#   tag value: (width_m, height_m, colour_key)
LINE_BARRIER = {
    "fence": (0.10, 1.90, "dark"),
    "wall":  (0.32, 1.05, "stone"),
    "hedge": (0.85, 1.10, "green"),
}
# Planting areas drawn from their real polygon, low.
AREA_PLANTING = {
    "flowerbed": 0.35,
    "garden":    0.55,
}

# ── Procedural placement. Every constant here is a spacing or an offset, and
# every rule is anchored to geometry that came from OSM. ────────────────
LAMP_SPACING_M      = 38.0   # campus walkway lamp run
LAMP_OFFSET_M       = 1.7    # to the side of the path centreline
LAMP_MIN_PATH_W     = 2.4    # a 1.5 m desire line does not get lamp posts
LAMP_CLEAR_M        = 16.0   # never this close to another lamp (OSM or ours)
BENCH_SPACING_M     = 62.0
BENCH_OFFSET_M      = 2.0
BENCH_CLEAR_M       = 18.0
BIN_PER_BENCHES     = 2      # a bin next to every Nth bench
RACK_MIN_AREA_M2    = 550.0  # buildings that are actually destinations
RACK_MAX_PER_BLDG   = 2
RACK_PATH_MAX_M     = 20.0   # a rack must be near a real path to be a rack
RACK_CLEAR_M        = 25.0
BOLLARD_ROW         = 3      # bollards across a walkway where it meets asphalt
BOLLARD_STEP_M      = 1.6
BOLLARD_CLEAR_M     = 9.0
PLANTER_SPACING_M   = 14.0   # around a plaza edge
PLANTER_CLEAR_M     = 10.0
SCOOTER_PER_RACK    = 3      # e-scooters really do pile up at the bike racks
SCOOTER_RACK_FRAC   = 0.18   # …at about this share of them
PLAZA_SURFACES      = ("paving", "concrete", "brick", "limestone")
SIT_SURFACES        = ("grass", "paving", "concrete", "brick", "limestone", "sand")
WALK_SURFACES       = ("concrete", "paving", "brick", "limestone")
NO_LAMP_ON          = ("steps",)

# ── A CONSTRUCTION SITE IS A FENCE, NOT A POST. ────────────────────────
#
# Simeon, 2026-08-04, on the University Catholic Center: "Its a very important
# building idk why it was just a stub before. I think an earlier pass didn't
# have data on it and put construction around it."
#
# Half of that read is right and the half that is wrong matters more. Nothing
# was invented for want of data: the site is OSM way 1315431488, `landuse=
# construction`, `name=Miriam and James J. Mulva Hall`, `opening_date=2028`,
# `check_date=2024-09-13`, and the Catholic Center's footprint really does sit
# inside it. bake_ground.py paints that polygon as bare dirt, which is correct.
#
# What was wrong is what THIS file did with it. Until now every construction
# site in the city — all 17 of them — was emitted as a 2 m x 2 m rectangle at
# the site's CENTROID, 12 m tall. A whole city block became one yellow
# toothpick standing in a dirt field, and the real building next to it read as
# an abandoned stub. That is one decision repeated 17 times, so it is worth
# fixing once here rather than seventeen times by hand.
#
# So a site is now drawn the way a site actually reads from the air: HOARDING
# along its real perimeter. Panels rather than one long ribbon, because `rect`
# gives each panel its own heading and a mitred ribbon round a 20-vertex ring
# self-intersects at every reflex corner.
#
# AND THE HOARDING STOPS AT A STANDING BUILDING. A fence drawn straight through
# the Catholic Center's street frontage would be a second wrong answer with a
# nicer texture; real hoarding goes round what is still standing. Any panel
# whose midpoint is inside — or within CONS_CLEAR_M of — a baked building
# footprint is dropped, which opens the fence exactly along the frontages of
# whatever the site polygon happens to swallow.
CONS_HOARD_H        = 2.45   # site hoarding is chest-and-a-half; 12 m was a mast
CONS_HOARD_W        = 0.36   # plywood panel plus its posts, drawn thick to read
CONS_PANEL_M        = 7.0    # one drawn panel per this much of perimeter
CONS_CLEAR_M        = 5.0    # no hoarding this close to a standing building
CONS_MIN_SIDE_M     = 1.2    # skip a ring edge shorter than this
CONS_MARKER_H       = 12.0   # fallback mast where a site has no ring at all


# ── geometry helpers ───────────────────────────────────────────────────
def mlon(lat):
    return M_LAT * math.cos(math.radians(lat))


def det01(lon, lat, salt):
    k = "%.6f:%.6f:%s" % (lon, lat, salt)
    return int.from_bytes(hashlib.md5(k.encode()).digest()[:4], "big") / 0xFFFFFFFF


def centre(el):
    if el.get("type") == "node":
        return el["lon"], el["lat"]
    g = el.get("geometry") or []
    if not g:
        b = el.get("bounds")
        if b:
            return (b["minlon"] + b["maxlon"]) / 2, (b["minlat"] + b["maxlat"]) / 2
        return None
    return sum(p["lon"] for p in g) / len(g), sum(p["lat"] for p in g) / len(g)


def rect(lon, lat, length_m, width_m, ang_rad):
    """An oriented rectangle. `ang_rad` is the heading of the LENGTH axis,
    measured in metric space (0 = east), so a bench really does sit along its
    path instead of always facing north."""
    hl, hw = length_m / 2.0, width_m / 2.0
    ca, sa = math.cos(ang_rad), math.sin(ang_rad)
    mx = mlon(lat)
    ring = []
    for dx, dy in ((-hl, -hw), (hl, -hw), (hl, hw), (-hl, hw)):
        ex = dx * ca - dy * sa
        ey = dx * sa + dy * ca
        ring.append([round(lon + ex / mx, 6), round(lat + ey / M_LAT, 6)])
    ring.append(list(ring[0]))
    return [ring]


def ribbon(coords, width_m):
    """Thin polygon along a line — a fence or a wall, drawn where it really is.
    Offsets each side by half the width using the segment normal; good enough at
    0.1–0.9 m widths, where a proper mitre would be invisible."""
    if len(coords) < 2:
        return None
    lat0 = coords[0][1]
    mx = mlon(lat0)
    pts = [((c[0]) * mx, (c[1]) * M_LAT) for c in coords]
    left, right = [], []
    for i in range(len(pts)):
        a = pts[max(0, i - 1)]
        b = pts[min(len(pts) - 1, i + 1)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        n = math.hypot(dx, dy) or 1.0
        nx, ny = -dy / n * width_m / 2.0, dx / n * width_m / 2.0
        left.append((pts[i][0] + nx, pts[i][1] + ny))
        right.append((pts[i][0] - nx, pts[i][1] - ny))
    ring = left + right[::-1]
    ring.append(ring[0])
    return [[[round(x / mx, 6), round(y / M_LAT, 6)] for x, y in ring]]


def simplify_ring(ring, tol_m=0.6):
    """Douglas-Peucker, so a 300-vertex OSM flowerbed does not ship 300
    vertices for a 0.35 m-high strip of planting."""
    if len(ring) < 4:
        return ring
    mx = mlon(ring[0][1])
    pts = [(c[0] * mx, c[1] * M_LAT) for c in ring]

    def dp(lo, hi, keep):
        if hi <= lo + 1:
            return
        ax, ay = pts[lo]
        bx, by = pts[hi]
        dx, dy = bx - ax, by - ay
        den = math.hypot(dx, dy) or 1e-9
        worst, wi = 0.0, lo
        for i in range(lo + 1, hi):
            d = abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / den
            if d > worst:
                worst, wi = d, i
        if worst > tol_m:
            keep.add(wi)
            dp(lo, wi, keep)
            dp(wi, hi, keep)

    keep = {0, len(pts) - 1}
    sys.setrecursionlimit(10000)
    dp(0, len(pts) - 1, keep)
    out = [ring[i] for i in sorted(keep)]
    if out[0] != out[-1]:
        out.append(list(out[0]))
    return out if len(out) >= 4 else ring


class Spacing(object):
    """A metric grid that answers 'is anything of this class within R metres?'.
    Every procedural rule runs through one so nothing is ever placed on top of
    something already there — including the OSM objects, which are inserted
    first and therefore always win."""

    def __init__(self, cell_m=12.0):
        self.cell = cell_m
        self.g = {}

    def _key(self, lon, lat):
        return (int(lon * mlon(lat) / self.cell), int(lat * M_LAT / self.cell))

    def free(self, lon, lat, radius_m):
        span = int(radius_m / self.cell) + 1
        ci, cj = self._key(lon, lat)
        mx = mlon(lat)
        for di in range(-span, span + 1):
            for dj in range(-span, span + 1):
                for (olon, olat) in self.g.get((ci + di, cj + dj), ()):
                    dxm = (lon - olon) * mx
                    dym = (lat - olat) * M_LAT
                    if dxm * dxm + dym * dym < radius_m * radius_m:
                        return False
        return True

    def add(self, lon, lat):
        self.g.setdefault(self._key(lon, lat), []).append((lon, lat))


class RoadTest(object):
    """Is this point inside a mapped carriageway? Nothing we place procedurally
    may stand in a traffic lane — measured: the first cut put 13 lamp posts and
    10 planters in one, which is precisely the kind of detail a viewer catches
    before they catch anything we got right."""

    CELL = 0.0005

    def __init__(self, paths):
        self.segs = []
        self.grid = {}
        for pr, coords in paths:
            if pr.get("s") != "asphalt":
                continue
            hw = (pr.get("w") or 4.0) / 2.0 + 0.4      # + a little kerb margin
            for i in range(len(coords) - 1):
                idx = len(self.segs)
                self.segs.append((coords[i], coords[i + 1], hw))
                for c in (coords[i], coords[i + 1]):
                    self.grid.setdefault((int(c[0] / self.CELL), int(c[1] / self.CELL)), set()).add(idx)

    def hit(self, lon, lat):
        mx = mlon(lat)
        px, py = lon * mx, lat * M_LAT
        ci, cj = int(lon / self.CELL), int(lat / self.CELL)
        cand = set()
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                cand |= self.grid.get((ci + di, cj + dj), set())
        for i in cand:
            a, b, hw = self.segs[i]
            ax, ay, bx, by = a[0] * mx, a[1] * M_LAT, b[0] * mx, b[1] * M_LAT
            dx, dy = bx - ax, by - ay
            L = dx * dx + dy * dy
            t = 0.0 if L == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L))
            if math.hypot(px - (ax + t * dx), py - (ay + t * dy)) < hw:
                return True
        return False


def walk_line(coords, spacing, phase=0.5):
    """Yield (lon, lat, heading_rad) every `spacing` metres along a line."""
    rem = spacing * phase
    for i in range(1, len(coords)):
        x0, y0 = coords[i - 1][0], coords[i - 1][1]
        x1, y1 = coords[i][0], coords[i][1]
        mx = mlon(y0)
        dxm, dym = (x1 - x0) * mx, (y1 - y0) * M_LAT
        seg = math.hypot(dxm, dym)
        if seg <= 0:
            continue
        ang = math.atan2(dym, dxm)
        d = rem
        while d < seg:
            t = d / seg
            yield x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, ang
            d += spacing
        rem = d - seg


def offset_point(lon, lat, ang, dist_m):
    """Move `dist_m` perpendicular-left of heading `ang`."""
    mx = mlon(lat)
    return lon + (-math.sin(ang) * dist_m) / mx, lat + (math.cos(ang) * dist_m) / M_LAT


def poly_area_m2(ring):
    mx = mlon(ring[0][1])
    a = 0.0
    for i in range(len(ring) - 1):
        x0, y0 = ring[i][0] * mx, ring[i][1] * M_LAT
        x1, y1 = ring[i + 1][0] * mx, ring[i + 1][1] * M_LAT
        a += x0 * y1 - x1 * y0
    return abs(a) / 2.0


# ── loading ────────────────────────────────────────────────────────────
# The largest a tagged planting area may be and still be drawn as a raised
# prop. See the note at the call site: three features in the whole city exceed
# it and every one of them is a landscape block mis-tagged as a garden.
AREA_PLANTING_MAX_M2 = 150.0


def ring_area_m2(ring):
    if len(ring) < 4:
        return 0.0
    lat = sum(q[1] for q in ring) / len(ring)
    kx = 111320.0 * math.cos(math.radians(lat))
    a = 0.0
    for (x0, y0), (x1, y1) in zip(ring, ring[1:]):
        a += (x0 * kx) * (y1 * 111320.0) - (x1 * kx) * (y0 * 111320.0)
    return abs(a) / 2.0


def load(key):
    p = os.path.join(CACHE, key + ".json")
    if not os.path.exists(p):
        sys.stderr.write("  (no cache for %s)\n" % key)
        return []
    with open(p, encoding="utf-8") as f:
        return json.load(f).get("elements", [])


def load_ground():
    paths, areas = [], []
    if not os.path.exists(GROUND):
        return paths, areas
    with open(GROUND, encoding="utf-8") as f:
        for feat in json.load(f)["features"]:
            pr = feat["properties"]
            g = feat["geometry"]
            if pr.get("k") == "path" and g["type"] == "LineString":
                paths.append((pr, g["coordinates"]))
            elif pr.get("k") == "area" and g["type"] == "Polygon" and g["coordinates"]:
                areas.append((pr, g["coordinates"][0]))
    return paths, areas


def load_buildings():
    try:
        with open(MANIFEST, encoding="utf-8") as f:
            date = json.load(f)["latest"]
        p = os.path.join(DATA, "snapshots", date, "buildings.geojson")
        with open(p, encoding="utf-8") as f:
            data = json.load(f)
    except Exception:                                             # noqa: BLE001
        return []
    out = []
    for feat in data.get("features", []):
        g = feat.get("geometry") or {}
        rings = []
        if g.get("type") == "Polygon" and g.get("coordinates"):
            rings = [g["coordinates"][0]]
        elif g.get("type") == "MultiPolygon":
            rings = [p[0] for p in g["coordinates"] if p]
        for r in rings:
            if len(r) >= 4:
                out.append(r)
    return out


class SiteBuildings:
    """Is this point standing on, or right beside, a real building?

    A grid over the baked footprints, so a hoarding run round a city block asks
    about a handful of rings rather than about 2,453. `near` answers inside-OR-
    within, because a fence that stops exactly at the wall still cuts the
    pavement in front of the door.
    """

    CELL = 0.0007   # ~68 m, the same cell the surface index uses

    def __init__(self, rings):
        self.grid = {}
        for r in rings:
            xs = [c[0] for c in r]
            ys = [c[1] for c in r]
            box = (min(xs), min(ys), max(xs), max(ys))
            for i in range(int(box[0] / self.CELL), int(box[2] / self.CELL) + 1):
                for j in range(int(box[1] / self.CELL), int(box[3] / self.CELL) + 1):
                    self.grid.setdefault((i, j), []).append((r, box))

    def near(self, lon, lat, clear_m):
        pad_x = clear_m / mlon(lat)
        pad_y = clear_m / M_LAT
        for r, box in self.grid.get((int(lon / self.CELL), int(lat / self.CELL)), ()):
            if lon < box[0] - pad_x or lon > box[2] + pad_x:
                continue
            if lat < box[1] - pad_y or lat > box[3] + pad_y:
                continue
            inside = False
            n = len(r)
            j = n - 1
            for i in range(n):
                xi, yi = r[i][0], r[i][1]
                xj, yj = r[j][0], r[j][1]
                if (yi > lat) != (yj > lat) and \
                        lon < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi:
                    inside = not inside
                j = i
            if inside:
                return True
            mx = mlon(lat)
            for i in range(n - 1):
                x0, y0 = r[i][0] * mx, r[i][1] * M_LAT
                x1, y1 = r[i + 1][0] * mx, r[i + 1][1] * M_LAT
                dx, dy = x1 - x0, y1 - y0
                L2 = dx * dx + dy * dy or 1e-9
                t = max(0.0, min(1.0, ((lon * mx - x0) * dx + (lat * M_LAT - y0) * dy) / L2))
                if math.hypot(lon * mx - x0 - t * dx, lat * M_LAT - y0 - t * dy) <= clear_m:
                    return True
        return False


def hoarding_panels(ring, index):
    """Walk a site's perimeter and return (lon, lat, length_m, heading) panels.

    Panels, not one ribbon: `rect` orients each panel to its own edge, and a
    mitred ribbon round a real 20-vertex site ring folds through itself at every
    reflex corner. Any panel standing on a building is dropped — see the note on
    CONS_HOARD_H.
    """
    out = []
    for i in range(len(ring) - 1):
        (x0, y0), (x1, y1) = ring[i], ring[i + 1]
        mx = mlon(y0)
        dx, dy = (x1 - x0) * mx, (y1 - y0) * M_LAT
        L = math.hypot(dx, dy)
        if L < CONS_MIN_SIDE_M:
            continue
        ang = math.atan2(dy, dx)
        n = max(1, int(round(L / CONS_PANEL_M)))
        step = L / n
        for k in range(n):
            t = (k + 0.5) / n
            lon, lat = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
            if index.near(lon, lat, CONS_CLEAR_M):
                continue
            out.append((lon, lat, step, ang))
    return out


# ── emit helpers ───────────────────────────────────────────────────────
def gid_of(kind, lon, lat):
    """One id per OBJECT, shared by all of its parts. The density quantile is
    assigned per gid, never per feature — otherwise `d <= 0.7` draws a bench's
    seat and throws its back away, and the thing stops being a bench at exactly
    the moment the quality preset moves."""
    return "%s%s" % (kind[:2], hashlib.md5(("%.6f:%.6f:%s" % (lon, lat, kind))
                                           .encode()).hexdigest()[:8])


def shaped(kind, lon, lat, ang, length, width, s, col, props):
    """The polygons for one furniture object: its recipe if it has one, and
    the single cuboid it always was if it does not."""
    fn = FURN_SHAPE.get(kind)
    if fn is None:
        return [(rect(lon, lat, length, width, ang), props["h"], col)]
    P = Parts()
    fn(P, length, width, s, col)
    if not P.out:
        return [(rect(lon, lat, length, width, ang), props["h"], col)]
    ca, sa = math.cos(ang), math.sin(ang)
    mx = mlon(lat)
    out = []
    for ring_m, h, c in P.out:
        ring = [[round(lon + (x * ca - y * sa) / mx, COORD_DP),
                 round(lat + (x * sa + y * ca) / M_LAT, COORD_DP)]
                for x, y in ring_m]
        ring.append(list(ring[0]))
        out.append(([ring], round(h, 2), c))
    return out


def make(kind, lon, lat, ang, src, rule=None, extra=None, size=None):
    """`size` is (length_m, width_m) and overrides FORM's default footprint for
    the objects whose real extent is in the data — a surveyed rack, a station
    sized by its dock count.

    IT IS AN ARGUMENT AND NOT A POST-HOC PATCH, and that matters now. Both call
    sites used to rewrite `fs[0]["geometry"]` after the fact, which was fine
    while an object was one feature and is a silent corruption the moment it is
    several: `fs[0]` became the FIRST HOOP, so a 15.8 m bike-share station would
    have come out as a 3.3 m default with one dock post stretched to 15.8 m
    across it. The reshape path never saw this — it reads a footprint that was
    already the right length — so only the re-bake would have carried it.
    """
    length, width, h, col, layer, lit = FORM[kind]
    # A deterministic wobble on size and heading. Real furniture is not stamped:
    # benches sit a few degrees off, bins are not all the same bin.
    s = 0.90 + det01(lon, lat, kind) * 0.20
    jitter = (det01(lon, lat, "ang") - 0.5) * 0.20
    fp = (length * s, width * s)
    if size:
        fp = size          # a surveyed extent is not wobbled — it is measured
    p = {"k": "lamp" if layer == "pole" else "furn",
         "u": kind, "h": round(h * s, 2), "c": col, "src": src}
    if rule:
        p["rule"] = rule
    if extra:
        p.update(extra)
    parts = shaped(kind, lon, lat, ang + jitter, fp[0], fp[1], s, col, p)
    if len(parts) == 1:
        feats = [{"type": "Feature",
                  "geometry": {"type": "Polygon", "coordinates": parts[0][0]},
                  "properties": p}]
    else:
        g = gid_of(kind, lon, lat)
        feats = []
        for coords, ph, pc in parts:
            pp = dict(p)
            pp["h"], pp["c"], pp["g"] = ph, pc, g
            feats.append({"type": "Feature",
                          "geometry": {"type": "Polygon", "coordinates": coords},
                          "properties": pp})
    if lit == "lit":
        # A Point at the lamp head. js/props.js draws these as the warm pool the
        # lamp throws, so anything we add participates in night instead of going
        # flat black next to night.js's street lamps.
        feats.append({"type": "Feature",
                      "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
                      "properties": {"k": "lit", "u": kind, "h": round(h * s, 2),
                                     "c": "blue" if col == "blue" else "warm", "src": src,
                                     **({"rule": rule} if rule else {})}})
    return feats


def main():
    feats = []
    stats = Counter()
    taken = {}          # kind-class -> Spacing

    def space(cls):
        return taken.setdefault(cls, Spacing())

    # ── 1. public art (unchanged: position + name factual) ──────────────
    for el in load("artwork"):
        t = el.get("tags", {}) or {}
        if t.get("tourism") != "artwork":
            stats["skipped_marker"] += 1
            continue
        name = t.get("name")
        if not name:
            stats["skipped_unnamed_art"] += 1
            continue
        c = centre(el)
        if not c:
            continue
        at = t.get("artwork_type")
        half, h = ART_FORM.get(at, ART_FORM[None])
        feats.append({
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": rect(c[0], c[1], half * 2, half * 2, 0.0)},
            "properties": {"k": "art", "name": name, "h": h, "at": at or "",
                           "artist": t.get("artist_name", ""), "src": "osm"},
        })
        stats["art"] += 1

    # ── 2. every furniture node OSM actually holds ──────────────────────
    # Order matters: the real objects go in first, so the procedural rules below
    # see them through `space()` and never place a lamp on top of a real lamp.
    TAG_TO_KIND = [
        ("amenity", {k: k for k in (
            "bench", "waste_basket", "drinking_water", "bicycle_parking", "bicycle_rental",
            "bicycle_repair_station", "picnic_table", "bbq", "charging_station",
            "vending_machine", "parking_meter", "post_box", "telephone", "atm", "toilets",
            "shelter", "planter")}),
        ("leisure", {"picnic_table": "picnic_table", "fitness_station": "fitness_station",
                     "outdoor_seating": "outdoor_seating"}),
        ("barrier", {"bollard": "bollard", "gate": "gate", "lift_gate": "lift_gate",
                     "cycle_barrier": "cycle_barrier", "block": "block"}),
        ("highway", {"street_lamp": "street_lamp", "bus_stop": "bus_stop",
                     "traffic_signals": "traffic_signals"}),
        ("public_transport", {"platform": "bus_stop"}),
        ("man_made", {"flagpole": "flagpole", "mast": "mast", "utility_pole": "utility_pole",
                      "street_cabinet": "street_cabinet"}),
        ("emergency", {"phone": "phone", "defibrillator": "defibrillator",
                       "fire_hydrant": "fire_hydrant"}),
        ("tourism", {"information": "information"}),
        ("advertising", {"column": "advertising", "board": "advertising",
                         "billboard": "advertising"}),
    ]
    # Dedupe is PER KIND, and per kind at a radius that suits it. The first cut
    # deduped every kind against every other at 4 m and quietly ate real
    # objects: a bin standing next to a bench is two things, and a row of
    # bollards is 8 posts 1.2 m apart, not one. What actually needs collapsing
    # is the same pole mapped twice — a stop tagged both highway=bus_stop and
    # public_transport=platform, or a shelter returned by two of the queries.
    DUP_R = {"bollard": 0.9, "gate": 1.2, "block": 1.2, "cycle_barrier": 1.2,
             "bench": 2.0, "waste_basket": 1.5, "planter": 1.5,
             "bicycle_parking": 3.0, "street_lamp": 5.0, "bus_stop": 12.0,
             "shelter": 12.0, "phone": 4.0}
    seen_osm = {}
    for key in ("furniture", "furn_barrier", "furn_transit", "furn_seating",
                "furn_vertical", "furn_planting"):
        for el in load(key):
            t = el.get("tags", {}) or {}
            kind = None
            for tag, table in TAG_TO_KIND:
                v = t.get(tag)
                if v in table:
                    kind = table[v]
                    break
            if kind is None or kind not in FORM:
                continue
            c = centre(el)
            if not c:
                continue
            sp = seen_osm.setdefault(kind, Spacing(6.0))
            r = DUP_R.get(kind, 2.5)
            if not sp.free(c[0], c[1], r):
                stats["osm_dup"] += 1
                continue
            sp.add(c[0], c[1])
            ang = det01(c[0], c[1], "a") * math.pi
            feats.extend(make(kind, c[0], c[1], ang, "osm"))
            space(kind).add(c[0], c[1])
            if kind == "street_lamp":
                space("lamp").add(c[0], c[1])
            stats["osm_" + kind] += 1

    # ── 2b. the City of Austin's OWN inventories ───────────────────────
    # (scripts/fetch_city_props.py). These go in BEFORE the procedural rules,
    # so a surveyed rack always beats a guessed one: `entrance_bike` runs
    # through the same `space('bicycle_parking')` grid and simply will not
    # place inside RACK_CLEAR_M of a real one.
    def load_city(key):
        p = os.path.join(CACHE, key + ".json")
        if not os.path.exists(p):
            sys.stderr.write("  (no cache for %s — run fetch_city_props.py)\n" % key)
            return []
        with open(p, encoding="utf-8") as f:
            return json.load(f)

    # Rack TYPE -> drawn length. A U-shaped hoop is ONE hoop; a corral is a
    # whole bay of them, and drawing both as the same 2.6 m box would throw away
    # the one thing the survey actually tells us.
    RACK_LEN = {"U-Shaped": 1.0, "W-Shaped": 1.8, "Artistic": 1.4,
                "Bike Corral": 6.5, "Micromobility Station": 5.0, "Other": 1.6}
    rack_space = space("bicycle_parking")
    for r in load_city("city_bike_parking"):
        a = r.get("attrs", {})
        if (a.get("STATUS") or "").lower() in ("removed", "destroyed"):
            continue
        lon, lat = r["lon"], r["lat"]
        if not rack_space.free(lon, lat, 3.0):
            stats["city_rack_dup"] += 1
            continue
        rack_space.add(lon, lat)
        n_assets = a.get("NUMBER_OF_ASSETS") or 1
        length = RACK_LEN.get(a.get("TYPE"), 1.4) * (1.0 + 0.55 * (min(int(n_assets or 1), 8) - 1))
        ang = det01(lon, lat, "a") * math.pi
        # Drawn at the surveyed size, keeping its real centre.
        fs = make("bicycle_parking", lon, lat, ang, "city",
                  extra={"cap": a.get("CAPACITY") or 0}, size=(length, 0.62))
        feats.extend(fs)
        stats["city_bike_rack"] += 1

    for r in load_city("city_bikeshare"):
        a = r.get("attrs", {})
        if (a.get("KIOSK_STATUS") or "").lower() != "active":
            stats["city_bikeshare_inactive"] += 1
            continue
        lon, lat = r["lon"], r["lat"]
        docks = int(a.get("NUMBER_OF_DOCKS") or 11)
        ang = det01(lon, lat, "a") * math.pi
        # ~0.72 m of dock run per bike — a 15-dock station is 11 m of hardware
        # and reads as the substantial object it is.
        fs = make("bicycle_rental", lon, lat, ang, "city",
                  extra={"name": a.get("KIOSK_NAME") or "", "docks": docks},
                  size=(max(3.0, docks * 0.72), 1.05))
        feats.extend(fs)
        space("bicycle_rental").add(lon, lat)
        stats["city_bikeshare"] += 1

    art_space = Spacing(20.0)
    for f in feats:
        if f["properties"].get("k") == "art":
            art_space.add(*f["geometry"]["coordinates"][0][0])
    for r in load_city("city_art"):
        if not r.get("name"):
            continue
        lon, lat = r["lon"], r["lat"]
        if not art_space.free(lon, lat, 25.0):
            stats["city_art_dup"] += 1
            continue
        art_space.add(lon, lat)
        half, h = ART_FORM["sculpture"]
        feats.append({
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": rect(lon, lat, half * 2, half * 2, 0.0)},
            "properties": {"k": "art", "name": r["name"], "h": h, "at": "sculpture",
                           "artist": r.get("artist", ""), "src": "city"},
        })
        stats["city_art"] += 1

    # ── 3. real line barriers and planting areas, drawn where they are ──
    for key in ("furn_barrier", "furn_planting", "construction"):
        for el in load(key):
            t = el.get("tags", {}) or {}
            g = el.get("geometry") or []
            if len(g) < 2:
                continue
            coords = [[p["lon"], p["lat"]] for p in g]
            bar = t.get("barrier")
            if bar in LINE_BARRIER:
                w, h, col = LINE_BARRIER[bar]
                poly = ribbon(simplify_ring(coords, 1.2), w)
                if not poly:
                    continue
                feats.append({"type": "Feature",
                              "geometry": {"type": "Polygon", "coordinates": poly},
                              "properties": {"k": "line", "u": bar, "h": h, "c": col,
                                             "src": "osm"}})
                stats["osm_line_" + bar] += 1
                continue
            plant = t.get("landuse") if t.get("landuse") in AREA_PLANTING else (
                t.get("leisure") if t.get("leisure") in AREA_PLANTING else None)
            if plant and coords[0] == coords[-1] and len(coords) >= 4:
                ring = simplify_ring(coords, 0.8)
                # A PLANTER IS SMALL. This branch draws a tagged planting AREA
                # as a solid raised mass, and OSM tags whole landscape blocks
                # `leisure=garden` -- so a 12,569 m2 garden came through as a
                # 0.55 m green slab over 1.25 hectares of campus, and one of the
                # three of them was sitting on top of Turtle Pond. The pond was
                # in the source, was returned by queryRenderedFeatures, and was
                # painted grass; hiding one layer at a time is what found it.
                #
                # The threshold is not a guess. Measured over all 142 line props:
                # median 10 m2, p90 29 m2, then a gap to 457, 2,406 and 12,569 --
                # all three `garden`. 150 m2 drops exactly those three and
                # nothing else. Anything that big is landscape and belongs to
                # ground.geojson, which already draws it as grass.
                if ring_area_m2(ring) > AREA_PLANTING_MAX_M2:
                    stats["planting_area_too_big"] += 1
                    continue
                feats.append({"type": "Feature",
                              "geometry": {"type": "Polygon", "coordinates": [ring]},
                              "properties": {"k": "line", "u": plant,
                                             "h": AREA_PLANTING[plant], "c": "green",
                                             "src": "osm"}})
                stats["osm_area_" + plant] += 1

    # ── 4. current construction — hoarding round the real site ─────────
    # Read the note on CONS_HOARD_H for why this is a fence now. `buildings` is
    # loaded here rather than in section 5 because the hoarding has to know what
    # is still standing inside the site.
    buildings = load_buildings()
    cons_index = SiteBuildings(buildings)
    for el in load("construction"):
        t = el.get("tags", {}) or {}
        if not (t.get("landuse") == "construction" or t.get("building") == "construction"):
            continue
        ring = [[p["lon"], p["lat"]] for p in (el.get("geometry") or [])]
        if len(ring) >= 4:
            if ring[0] != ring[-1]:
                ring.append(list(ring[0]))
            ring = simplify_ring(ring, 1.6)
        panels = hoarding_panels(ring, cons_index) if len(ring) >= 4 else []
        if panels:
            for lon, lat, length, ang in panels:
                feats.append({
                    "type": "Feature",
                    "geometry": {"type": "Polygon",
                                 "coordinates": rect(lon, lat, length, CONS_HOARD_W, ang)},
                    "properties": {"k": "cons", "name": t.get("name", ""),
                                   "h": CONS_HOARD_H, "src": "osm"},
                })
            stats["cons_hoarding_panels"] += len(panels)
            stats["construction"] += 1
            continue
        # No usable ring (a construction node, or a site entirely occupied by a
        # standing building). Keep the old mast so the site does not silently
        # vanish — a missing layer makes every metric look better.
        c = centre(el)
        if not c:
            continue
        feats.append({
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": rect(c[0], c[1], 2.0, 2.0, 0.0)},
            "properties": {"k": "cons", "name": t.get("name", ""),
                           "h": CONS_MARKER_H, "src": "osm"},
        })
        stats["cons_marker_fallback"] += 1
        stats["construction"] += 1

    # ── 5. procedural fill, driven by the real ground ──────────────────
    paths, areas = load_ground()
    road = RoadTest(paths)
    sys.stderr.write("ground: %d paths, %d areas; %d building rings\n"
                     % (len(paths), len(areas), len(buildings)))

    # Which surface is next to a point — used so a bench faces something.
    area_grid = {}
    CELL = 0.0007
    for pr, ring in areas:
        xs = [c[0] for c in ring]
        ys = [c[1] for c in ring]
        for i in range(int(min(xs) / CELL), int(max(xs) / CELL) + 1):
            for j in range(int(min(ys) / CELL), int(max(ys) / CELL) + 1):
                area_grid.setdefault((i, j), []).append((pr, ring, (min(xs), min(ys), max(xs), max(ys))))

    def surface_at(lon, lat):
        for pr, ring, box in area_grid.get((int(lon / CELL), int(lat / CELL)), ()):
            if lon < box[0] or lon > box[2] or lat < box[1] or lat > box[3]:
                continue
            inside = False
            n = len(ring)
            j = n - 1
            for i in range(n):
                xi, yi = ring[i][0], ring[i][1]
                xj, yj = ring[j][0], ring[j][1]
                if (yi > lat) != (yj > lat) and \
                        lon < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi:
                    inside = not inside
                j = i
            if inside:
                return pr.get("s")
        return None

    # R1 — LAMPS down every real walkway. This is the rule that does the most
    # work: it draws the malls at night and gives every path a scale.
    lamp_space = space("lamp")
    n_bench = 0
    for pr, coords in paths:
        if pr.get("u") in NO_LAMP_ON or (pr.get("w") or 0) < LAMP_MIN_PATH_W:
            continue
        # WALKWAY surfaces only. The first cut included asphalt, which put a
        # pole run down every service road and parking aisle — and those are
        # exactly the lines js/night.js already lights from the basemap's road
        # geometry, so it was double-lighting the streets and starving the
        # malls of the budget.
        if pr.get("s") not in WALK_SURFACES:
            continue
        side = 1.0 if det01(coords[0][0], coords[0][1], "side") > 0.5 else -1.0
        off = LAMP_OFFSET_M + (pr.get("w") or 2.4) / 2.0
        for k, (lon, lat, ang) in enumerate(walk_line(coords, LAMP_SPACING_M)):
            # Alternate sides along the run, the way a real lamp run staggers.
            s = side * (1.0 if k % 2 == 0 else -1.0)
            plon, plat = offset_point(lon, lat, ang, off * s)
            in_road = road.hit(plon, plat)
            if in_road:
                stats["proc_skip_in_road"] += 1
            if in_road or not lamp_space.free(plon, plat, LAMP_CLEAR_M):
                continue
            lamp_space.add(plon, plat)
            feats.extend(make("street_lamp", plon, plat, ang, "proc", "walk_lamp"))
            stats["proc_street_lamp"] += 1

    # R2 — BENCHES beside a walkway, facing something worth facing, plus a bin
    # next to every other one. A bench is the object that tells you how big the
    # building behind it is, so these matter more than their count suggests.
    bench_space = space("bench")
    bin_space = space("waste_basket")
    for pr, coords in paths:
        if pr.get("u") in NO_LAMP_ON or pr.get("s") not in WALK_SURFACES:
            continue
        if (pr.get("w") or 0) < 2.0:
            continue
        for lon, lat, ang in walk_line(coords, BENCH_SPACING_M, 0.33):
            off = 1.0 + (pr.get("w") or 2.4) / 2.0 + BENCH_OFFSET_M
            # Try BOTH sides and take the one that is actually a lawn or a
            # plaza. Probing one random side threw away most of the candidates
            # for no reason — a path along the edge of the Six Pack has grass on
            # exactly one side, and half the time we looked at the building.
            pref = 1.0 if det01(lon, lat, "bside") > 0.5 else -1.0
            hit = None
            for s in (pref, -pref):
                blon, blat = offset_point(lon, lat, ang, off * s)
                if surface_at(blon, blat) in SIT_SURFACES:
                    hit = (blon, blat, s)
                    break
            if hit is None:
                continue
            blon, blat, s = hit
            in_road = road.hit(blon, blat)
            if in_road:
                stats["proc_skip_in_road"] += 1
            if in_road or not bench_space.free(blon, blat, BENCH_CLEAR_M):
                continue
            bench_space.add(blon, blat)
            feats.extend(make("bench", blon, blat, ang, "proc", "path_bench"))
            stats["proc_bench"] += 1
            n_bench += 1
            if n_bench % BIN_PER_BENCHES == 0:
                nlon, nlat = offset_point(lon, lat, ang, off * s)
                nlon += (2.2 * math.cos(ang)) / mlon(nlat)
                if bin_space.free(nlon, nlat, 9.0):
                    bin_space.add(nlon, nlat)
                    feats.extend(make("waste_basket", nlon, nlat, ang, "proc", "path_bench"))
                    stats["proc_waste_basket"] += 1

    # R3 — BIKE RACKS at building entrances. "Entrance" is inferred, honestly:
    # the point on a real footprint that is closest to a real path, pushed out
    # onto the path side. On this campus that is where the racks are.
    rack_space = space("bicycle_parking")
    path_pts = []
    for pr, coords in paths:
        if pr.get("s") in WALK_SURFACES:
            for i in range(0, len(coords)):
                path_pts.append((coords[i][0], coords[i][1]))
    pgrid = {}
    PCELL = 0.0004
    for lon, lat in path_pts:
        pgrid.setdefault((int(lon / PCELL), int(lat / PCELL)), []).append((lon, lat))

    def nearest_path_pt(lon, lat, max_m):
        span = int(max_m / (PCELL * mlon(lat))) + 1
        ci, cj = int(lon / PCELL), int(lat / PCELL)
        best, bd = None, max_m * max_m
        mx = mlon(lat)
        for di in range(-span, span + 1):
            for dj in range(-span, span + 1):
                for (olon, olat) in pgrid.get((ci + di, cj + dj), ()):
                    dxm, dym = (olon - lon) * mx, (olat - lat) * M_LAT
                    d2 = dxm * dxm + dym * dym
                    if d2 < bd:
                        bd, best = d2, (olon, olat)
        return best, math.sqrt(bd) if best else None

    scooter_n = 0
    for ring in buildings:
        if poly_area_m2(ring) < RACK_MIN_AREA_M2:
            continue
        placed = 0
        # Walk the footprint's own vertices; each is a candidate façade point.
        step = max(1, len(ring) // 14)
        for i in range(0, len(ring) - 1, step):
            if placed >= RACK_MAX_PER_BLDG:
                break
            vlon, vlat = ring[i][0], ring[i][1]
            tgt, dist = nearest_path_pt(vlon, vlat, RACK_PATH_MAX_M)
            if not tgt or dist < 3.0:
                continue
            mx = mlon(vlat)
            dxm, dym = (tgt[0] - vlon) * mx, (tgt[1] - vlat) * M_LAT
            n = math.hypot(dxm, dym) or 1.0
            # 3 m out from the wall, toward the path: the strip racks live on.
            rlon = vlon + (dxm / n * 3.2) / mx
            rlat = vlat + (dym / n * 3.2) / M_LAT
            in_road = road.hit(rlon, rlat)
            if in_road:
                stats["proc_skip_in_road"] += 1
            if in_road or not rack_space.free(rlon, rlat, RACK_CLEAR_M):
                continue
            rack_space.add(rlon, rlat)
            ang = math.atan2(dym, dxm) + math.pi / 2
            feats.extend(make("bicycle_parking", rlon, rlat, ang, "proc", "entrance_bike"))
            stats["proc_bicycle_parking"] += 1
            placed += 1
            # Scooters really do pile up beside the racks near the Drag.
            if det01(rlon, rlat, "scoot") < SCOOTER_RACK_FRAC:
                for s in range(SCOOTER_PER_RACK):
                    slon = rlon + (math.cos(ang) * (1.9 + 0.7 * s)) / mx
                    slat = rlat + (math.sin(ang) * (1.9 + 0.7 * s)) / M_LAT
                    feats.extend(make("scooter", slon, slat, ang + math.pi / 2, "proc",
                                      "scooter_at_rack"))
                    scooter_n += 1
    stats["proc_scooter"] = scooter_n

    # R4 — BOLLARDS where a walkway runs into asphalt. Every campus does this:
    # the row of posts that stops a car entering the mall.
    boll_space = space("bollard")
    for pr, coords in paths:
        if pr.get("s") not in WALK_SURFACES or (pr.get("w") or 0) < 2.4:
            continue
        for end, nb in ((coords[0], coords[1]), (coords[-1], coords[-2])):
            lon, lat = end
            if surface_at(lon, lat) != "asphalt":
                continue
            if not boll_space.free(lon, lat, BOLLARD_CLEAR_M):
                continue
            mx = mlon(lat)
            ang = math.atan2((nb[1] - lat) * M_LAT, (nb[0] - lon) * mx)
            boll_space.add(lon, lat)
            for b in range(BOLLARD_ROW):
                d = (b - (BOLLARD_ROW - 1) / 2.0) * BOLLARD_STEP_M
                blon, blat = offset_point(lon, lat, ang, d)
                feats.extend(make("bollard", blon, blat, ang, "proc", "crossing_bollard"))
                stats["proc_bollard"] += 1

    # R5 — PLANTERS around the edge of a real plaza.
    plant_space = space("planter")
    for pr, ring in areas:
        if pr.get("s") not in PLAZA_SURFACES:
            continue
        if poly_area_m2(ring) < 400.0:
            continue
        for lon, lat, ang in walk_line(ring, PLANTER_SPACING_M):
            # Just inside the edge, not on it.
            plon, plat = offset_point(lon, lat, ang, 1.4)
            if surface_at(plon, plat) not in PLAZA_SURFACES:
                plon, plat = offset_point(lon, lat, ang, -1.4)
                if surface_at(plon, plat) not in PLAZA_SURFACES:
                    continue
            in_road = road.hit(plon, plat)
            if in_road:
                stats["proc_skip_in_road"] += 1
            if in_road or not plant_space.free(plon, plat, PLANTER_CLEAR_M):
                continue
            plant_space.add(plon, plat)
            feats.extend(make("planter", plon, plat, ang, "proc", "plaza_planter"))
            stats["proc_planter"] += 1

    # ── 6. density keep-order ──────────────────────────────────────────
    # Same contract as the trees: `d` is a QUANTILE in 0..1 and js/props.js
    # filters `d <= density`, so 0.6 always draws 60% of them whatever the file
    # holds. Ranked by how much an object is worth keeping: a lamp run reads
    # from the air and a bin does not, so bins thin out first.
    WEIGHT = {"street_lamp": 1.00, "phone": 0.94, "shelter": 0.92, "flagpole": 0.90,
              "mast": 0.88, "utility_pole": 0.86, "traffic_signals": 0.84,
              "bus_stop": 0.80, "bicycle_parking": 0.72, "bicycle_rental": 0.72,
              "bench": 0.66, "planter": 0.58, "picnic_table": 0.56, "toilets": 0.56,
              "information": 0.50, "bollard": 0.44, "waste_basket": 0.36,
              "scooter": 0.30}
    #
    # RANKED PER OBJECT, NOT PER FEATURE. A shaped bench is two features and a
    # bike rack is three, and if each part took its own quantile then every
    # setting of the knob below 1.0 would draw some benches with no back and
    # some racks with a hoop missing. Parts share the `g` written by make().
    ranked = [f for f in feats if f["properties"]["k"] in ("furn", "lamp", "lit")]
    order, seen = [], {}
    for i, f in enumerate(ranked):
        p = f["properties"]
        w = WEIGHT.get(p.get("u"), 0.5)
        c = f["geometry"]["coordinates"]
        pt = c if f["geometry"]["type"] == "Point" else c[0][0]
        key = p.get("g") or ("_%d" % i)
        if key not in seen:
            seen[key] = len(order)
            order.append([-(0.78 * w + 0.22 * det01(pt[0], pt[1], "pd")), key])
    order.sort()
    n = max(1, len(order) - 1)
    quant = {key: round(pos / n, 4) for pos, (_, key) in enumerate(order)}
    for i, f in enumerate(ranked):
        p = f["properties"]
        p["d"] = quant[p.get("g") or ("_%d" % i)]

    # ── 7. emit + report ───────────────────────────────────────────────
    fc = {"type": "FeatureCollection", "features": feats}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(fc, f, separators=(",", ":"))

    def zone_of(f):
        g = f["geometry"]
        lon = g["coordinates"][0] if g["type"] == "Point" else g["coordinates"][0][0][0]
        return "west" if lon < -97.741 else ("mid" if lon <= -97.734 else "east")

    by_kind = Counter()
    by_zone_kind = {}
    for f in feats:
        p = f["properties"]
        u = p.get("u") or p.get("k")
        by_kind[u] += 1
        by_zone_kind.setdefault(u, Counter())[zone_of(f)] += 1

    print(json.dumps({
        "features": len(feats),
        "file_kb": round(os.path.getsize(OUT) / 1024, 1),
        "by_layer": dict(Counter(f["properties"]["k"] for f in feats)),
        "by_kind": dict(sorted(by_kind.items())),
        "by_zone": {k: dict(v) for k, v in sorted(by_zone_kind.items())},
        "zone_totals": dict(Counter(zone_of(f) for f in feats)),
        "by_source": dict(Counter(f["properties"].get("src", "?") for f in feats)),
        "by_rule": dict(Counter(f["properties"]["rule"] for f in feats
                                if "rule" in f["properties"])),
        "draws_at_density": {str(v): sum(1 for f in ranked if f["properties"]["d"] <= v)
                             for v in (0.4, 0.6, 0.8, 1.0)},
        "counts": dict(sorted(stats.items())),
        "provenance": {
            "src=osm":  "POSITION factual, from OpenStreetMap; FORM generative",
            "src=proc": "POSITION generative from the geometry named in `rule`; "
                        "walk_lamp/path_bench/crossing_bollard ride OSM path "
                        "centrelines in data/ground.geojson, entrance_bike rides "
                        "the baked building footprints, plaza_planter rides OSM "
                        "plaza polygons",
            "art":      "POSITION + NAME factual; the sculptures are NOT modelled",
        },
    }, indent=2))


def reshape():
    """Apply FURN_SHAPE to the SHIPPED data/props.geojson, in place.

    WHY THIS EXISTS AND WHY IT IS NOT A RE-BAKE. HANDOFF §44: a full
    `bake_props.py` run on the Acer emits 2,244 features against the shipped
    9,019, because the city inventory feeds behind `load_city()` are not in the
    local cache — lamps collapse 3,245 -> 532 and lit 2,949 -> 236. Committing
    that would delete two thirds of the street furniture in exchange for a
    prettier bench. So the rule goes into the bake for whoever next runs it with
    the data, and is applied SURGICALLY here, exactly as PR #63 did.

    It reads back what it wrote, IN THE OBJECT'S OWN FRAME: every part vertex
    has to sit inside the cuboid it replaced, plus RESHAPE_MARGIN_M. The first
    version of this check compared centroids and failed at 0.37 m, which was
    not a bug — a scooter's stem is deliberately at one end and a dock's kiosk
    at the other, so the mean of the vertices is not the object's centre. A
    containment test says the thing that actually matters: nothing has moved off
    its own footprint and nothing has grown.

    Idempotent — a feature that already carries `g` is a part and is left alone.
    """
    RESHAPE_MARGIN_M = 0.25
    with open(OUT, encoding="utf-8") as f:
        gj = json.load(f)
    before = list(gj["features"])
    out, stats = [], Counter()
    worst, worst_u = 0.0, None
    tall = {}
    for feat in before:
        p = feat["properties"]
        u = p.get("u")
        if (p.get("k") != "furn" or "g" in p or u not in FURN_SHAPE
                or feat["geometry"]["type"] != "Polygon"):
            out.append(feat)
            stats["kept"] += 1
            continue
        ring = feat["geometry"]["coordinates"][0]
        if len(ring) < 5:
            out.append(feat)
            stats["kept"] += 1
            continue
        # Recover the object's own frame from the cuboid rect() drew: the ring
        # is (-hl,-hw) (hl,-hw) (hl,hw) (-hl,hw) rotated, so edge 0->1 is the
        # length axis and 1->2 is the width.
        lat0 = sum(c[1] for c in ring[:4]) / 4.0
        mx = mlon(lat0)
        xy = [(c[0] * mx, c[1] * M_LAT) for c in ring[:4]]
        cx = sum(q[0] for q in xy) / 4.0
        cy = sum(q[1] for q in xy) / 4.0
        L = math.hypot(xy[1][0] - xy[0][0], xy[1][1] - xy[0][1])
        W = math.hypot(xy[2][0] - xy[1][0], xy[2][1] - xy[1][1])
        ang = math.atan2(xy[1][1] - xy[0][1], xy[1][0] - xy[0][0])
        lon0, lat0 = cx / mx, cy / M_LAT
        s = p["h"] / FORM[u][2]
        parts = shaped(u, lon0, lat0, ang, L, W, s, p["c"], p)
        g = gid_of(u, lon0, lat0)
        for coords, ph, pc in parts:
            pp = dict(p)
            pp["h"], pp["c"], pp["g"] = ph, pc, g
            out.append({"type": "Feature",
                        "geometry": {"type": "Polygon", "coordinates": coords},
                        "properties": pp})
        stats["objects_" + u] += 1
        stats["parts"] += len(parts)
        tall[u] = max(tall.get(u, 0.0), max(ph for _, ph, _ in parts))
        # Read it back, in the object's own frame: every vertex inside the
        # cuboid it replaced, plus the margin.
        ca, sa = math.cos(-ang), math.sin(-ang)
        for coords, _, _ in parts:
            for lo, la in coords[0][:-1]:
                dx, dy = lo * mx - cx, la * M_LAT - cy
                lx, ly = dx * ca - dy * sa, dx * sa + dy * ca
                over = max(abs(lx) - L / 2.0, abs(ly) - W / 2.0)
                if over > worst:
                    worst, worst_u = over, u
    if worst > RESHAPE_MARGIN_M:
        raise SystemExit("reshape put a %s part %.3f m outside its own footprint"
                         % (worst_u, worst))

    n_other = sum(1 for f in before if f["properties"].get("k") != "furn")
    n_other_after = sum(1 for f in out if f["properties"].get("k") != "furn")
    if n_other != n_other_after:
        raise SystemExit("reshape touched a non-furniture feature")

    gj["features"] = out
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(gj, f, separators=(",", ":"))
    print(json.dumps({
        "mode": "reshape (surgical — see HANDOFF §44)",
        "features_before": len(before), "features_after": len(out),
        "furn_before": sum(1 for f in before if f["properties"].get("k") == "furn"),
        "furn_after": sum(1 for f in out if f["properties"].get("k") == "furn"),
        "non_furn_unchanged": n_other == n_other_after,
        "worst_overhang_m": round(worst, 3), "worst_overhang_kind": worst_u,
        "tallest_part_m": {k: round(v, 2) for k, v in sorted(tall.items())},
        "file_kb": round(os.path.getsize(OUT) / 1024, 1),
        "counts": dict(sorted(stats.items())),
    }, indent=2))


if __name__ == "__main__":
    if "--reshape" in sys.argv:
        reshape()
    else:
        main()
