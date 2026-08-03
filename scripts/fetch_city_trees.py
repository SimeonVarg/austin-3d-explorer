# -*- coding: utf-8 -*-
"""Fetch the City of Austin Tree Inventory (Socrata wrik-xasw) for the app bbox
and merge it with the OSM trees into one data/trees.geojson.

WHY: OSM has 498 trees in the bbox and NONE on the UT malls. The city inventory
adds ~1,566 more with a SPECIES and a measured trunk DIAMETER each — which is
what lets a live oak be drawn as a live oak (wide, low) instead of a generic
blob. Coverage is city land: West Campus streets and the Drag, which is exactly
where the camera spawns and where the intro flies.

TRUTH:
  POSITION  — factual. Every trunk is at its surveyed lon/lat (city) or its
              mapped node (OSM). Nothing is scattered.
  SIZE      — derived from the measured trunk diameter by a published-style
              allometry, per species group. Real input, modelled output.
  FORM      — generative: the octagon canopy and the box trunk are our drawing,
              as they already were.

Stumps and diameter-0 records are dropped: they are not trees.

Usage:  python scripts/fetch_city_trees.py
"""
import hashlib
import json
import math
import os
import sys
from collections import defaultdict
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
CACHE = os.path.join(DATA, "osm_cache")
OUT = os.path.join(DATA, "trees.geojson")
CITY_CACHE = os.path.join(CACHE, "city_trees.json")
CANOPY_DETECTED = os.path.join(DATA, "canopy_detected.json")
GROUND = os.path.join(DATA, "ground.geojson")
MANIFEST = os.path.join(DATA, "manifest.json")

# ── Coverage. THE BOX IS THE DEFECT, and it was measurable. ────────────
#
# Reported as *"the canopy stops at the campus edge — West Campus, East Austin,
# everything south of the Capitol is bare tan. Austin reads as a dust bowl."*
# It is not a filter and it is not the city's own coverage: it is this box.
# Photographed before the fix in shots/tree-edge/northedge.png — a razor-straight
# horizontal line of canopy across the frame at lat 30.2964, dense green in front
# of it and flat tan behind, which is the north edge of the OLD box below:
#
#     old tree box     -97.7524..-97.7256   30.2757..30.2964    5.5 km²
#     modelled city    -97.7880..-97.7020   30.2400..30.3150   71.4 km²
#                      (data/outer_ring.geojson, the buildings you can see)
#
# Every tree source stopped at the small box while the buildings ran 13x wider,
# so the city was drawn and then the trees were cut out of it. The city's own
# inventory has plenty: 1,566 rows in the old box, 20,723 in the modelled-city
# box — measured against the live Socrata endpoint, not assumed.
#
# CORE_BBOX is the old box and it still means something: it is where the
# imagery-detected canopy exists (scripts/detect_canopy.py's grid covers exactly
# it) and where the camera spends its time. Inside it nothing about this file's
# behaviour changes. Outside it the trees are BACKDROP, and are built to a
# cheaper recipe — see OUTER_* below.
BBOX = (30.2400, -97.7880, 30.3150, -97.7020)      # s, w, n, e — modelled city
CORE_BBOX = (30.276, -97.752, 30.296, -97.726)     # campus + West Campus + Drag
SOCRATA = "https://data.austintexas.gov/resource/wrik-xasw.json"
M_LAT = 111320.0

# ── What a backdrop tree costs. ───────────────────────────────────────
# Widening the box 13x cannot cost 13x the features. Outside CORE_BBOX a tree is
# never closer to the camera than a couple of hundred metres in any pose the
# tour flies, so it is drawn as canopy only:
#
#   OUTER_TRUNKS      a trunk is a second feature per tree and is sub-pixel at
#                     that distance. Off.
#   OUTER_MIN_DBH_IN  a 2-inch sapling models to a 3 m crown that is a couple of
#                     pixels across from outside the core. Keep the street trees
#                     that read as a street, drop the rest.
# shape_trees.py reads CORE_BBOX from this file and caps the tier count out
# there for the same reason (OUTER_MAX_TIERS).
#
# 5.0 -> 3.0 on 2026-08-03, and the reason is a measurement, not a preference.
# The complaint was that the canopy stops dead at the campus edge. It is not the
# box and it is not the survey: the city inventory covers the wide box at 230
# trees/km2 inside CORE_BBOX and 224 outside — the SAME density. What makes
# campus lush is 17,483 imagery-detected crowns sitting on top of it in one
# 5.85 km2 block at 2,988/km2, THIRTEEN TIMES the survey. The edge of the green
# is the edge of the aerial-detection grid.
#
# So the only real trees available out there are the surveyed ones, and this
# threshold was discarding 4,359 of the 18,556 outside the core — 23% of them.
# Recovering those is the one honest lift available without inventing anything.
# 3.0 rather than the core's 2.0 keeps the true saplings out; they model to a
# ~3 m crown that is a couple of pixels from any pose the tour flies.
OUTER_TRUNKS = False
OUTER_MIN_DBH_IN = 3.0

# ── Allometry. GENERATIVE, from the FACTUAL measured diameter. ─────────
# Trunk diameter is recorded in inches (DBH). Crown spread and height are
# modelled per species group; live oaks are deliberately wide-and-low, which is
# most of what campus and West Campus actually look like from the air.
# LINEAR in DBH, not a power law: over the 2–58 inch range this inventory
# actually contains, a power law with a <1 exponent collapses everything toward
# its intercept — the first cut produced a mean canopy height of 5.3 m and a
# 14-inch live oak barely 4 m tall, which is nonsense. Linear reproduces the
# familiar numbers: a 14" live oak ≈ 9 m tall and 11 m across, a 30" one ≈ 14 m
# tall and 18 m across.
#   crown_radius_m = Ar * dbh_in + R0   (capped at maxR)
#   height_m       = Ah * dbh_in + H0   (capped at maxH)
SPECIES_GROUPS = [
    # (match substrings, key, Ar, R0, maxR, Ah, H0, maxH, leaf)
    (("oak, live", "live oak"),         "liveoak", 0.22, 2.6, 12.0, 0.30, 5.0, 17.0, "broadleaved"),
    (("oak",),                          "oak",     0.20, 2.2, 11.0, 0.38, 5.0, 22.0, "broadleaved"),
    (("pecan", "hickory"),              "pecan",   0.17, 2.0, 10.0, 0.42, 5.0, 26.0, "broadleaved"),
    (("elm", "sugarberry", "hackberry"),"elm",     0.19, 2.0, 10.0, 0.36, 4.5, 22.0, "broadleaved"),
    (("crapemyrtle", "crape myrtle"),   "crape",   0.12, 1.2,  4.5, 0.18, 2.5,  8.0, "broadleaved"),
    (("cedar", "juniper", "cypress"),   "cedar",   0.14, 1.6,  7.0, 0.36, 4.0, 18.0, "needleleaved"),
    (("pine",),                         "pine",    0.12, 1.5,  7.0, 0.45, 5.0, 28.0, "needleleaved"),
    (("magnolia",),                     "magnolia",0.16, 1.8,  8.0, 0.30, 4.0, 17.0, "broadleaved"),
    (("palm",),                         "palm",    0.05, 1.8,  3.5, 0.45, 4.0, 15.0, "broadleaved"),
]
DEFAULT_GROUP = ("other", 0.18, 2.0, 9.0, 0.33, 4.5, 20.0, "broadleaved")

SKIP_SPECIES = ("stump", "vacant", "removed", "dead", "empty", "planting site")
MIN_DBH_IN = 2.0        # below this it is a sapling, not something you see at 60 m
DEDUPE_M = 4.0          # a city tree and an OSM tree this close are one tree

# ── Imagery-detected crowns: what kind of tree is that blob? ───────────
# GENERATIVE, but not arbitrary. The detector measures a crown RADIUS off the
# photograph and nothing else, so the species has to be inferred — and the thing
# a nadir photo genuinely tells you about a Central Texas tree is its habit:
# a 9 m-radius crown on this campus is a live oak, a 2.5 m one is a crepe
# myrtle, and the ones standing in the Waller Creek corridor are bald cypress.
# So: bucket by measured radius, break ties with a deterministic hash against
# the real regional mix, and override near water. Each species then gets its own
# height-from-radius habit, which is what makes the canopy read as a mixed stand
# instead of one shrub cloned 8,000 times — the colour ramp in timeofday.js is
# driven by height, so species variety IS tonal variety here.
#   (key, leaf, Ah, H0, maxH, squash_lo, squash_hi)
HABIT = {
    "liveoak":  ("broadleaved", 1.00, 3.2, 17.0, 0.86, 1.14),   # wide and low
    "pecan":    ("broadleaved", 1.85, 3.0, 26.0, 0.80, 1.06),   # tall, open
    "elm":      ("broadleaved", 1.55, 2.8, 22.0, 0.82, 1.10),   # cedar elm
    "magnolia": ("broadleaved", 1.35, 3.0, 17.0, 0.90, 1.08),   # dense, conical
    "crape":    ("broadleaved", 1.30, 1.4,  8.0, 0.84, 1.16),   # multi-stem, low
    "cypress":  ("needleleaved", 2.10, 4.0, 28.0, 0.88, 1.04),  # bald cypress
    "cedar":    ("needleleaved", 1.70, 2.6, 18.0, 0.86, 1.08),  # Ashe juniper
}
# Radius bucket -> candidate species and their share of that bucket. Weights are
# the campus/West-Campus mix, not a state-wide inventory: live oak dominates
# everything with a big crown, the small stuff is overwhelmingly crepe myrtle.
RADIUS_MIX = [
    (7.0, (("liveoak", 0.62), ("pecan", 0.20), ("elm", 0.18))),
    (5.0, (("liveoak", 0.45), ("elm", 0.24), ("pecan", 0.16), ("magnolia", 0.15))),
    (3.4, (("liveoak", 0.30), ("elm", 0.22), ("magnolia", 0.20), ("crape", 0.20), ("cedar", 0.08))),
    (0.0, (("crape", 0.58), ("magnolia", 0.18), ("cedar", 0.14), ("elm", 0.10))),
]
WATER_SPECIES = "cypress"
WATER_NEAR_M = 26.0     # inside this of mapped water, a big crown is a cypress

# ── Taste block: planting Waller Creek. GENERATIVE, and labelled as such. ──
#
# *"the creek behind patton and alumni is a very vibrant in depth creek, samd
# with the area behind san jacinto and the rec center and the track that area
# also very lush. Hope you will add more detail there and not the bare minimum"*
#
# The Acer cut the channel and authored the planting zones and then never grew
# anything in them: `data/ground.geojson` carries 33 areas tagged
# `src:'creek_canopy'`, 34 `creek_under` and 49 `creek_scrub` — 33.5 ha in total
# — and the surveys do not cover a creek bed, so nothing has ever stood in them.
#
# THIS IS THE ONLY GENERATIVE POSITION SOURCE IN THIS FILE. City rows and OSM
# nodes are surveyed and the imagery crowns are measured off a photograph; these
# are invented, and they are emitted LAST so the dedupe below always resolves in
# favour of a real tree that is already there. `src:'creek'` marks them in the
# data and the provenance block names them.
#
# Spacing is centre-to-centre on a jittered grid, and it is the number to turn.
# A riparian canopy at 12 m reads as a closed gallery from the air without
# becoming a solid mat; understorey and scrub are progressively tighter and
# smaller, which is what makes the three zones read as three things rather than
# as one green stripe. Radii are the crown radius range each zone draws from.
CREEK_ZONES = {
    "creek_canopy": {
        "spacing_m": 12.0, "jitter": 0.40, "radius_m": (5.4, 9.2),
        # Waller Creek's gallery: pecan and hackberry over the channel, bald
        # cypress at the water, live oak where the bank climbs out of it.
        "species": (("pecan", 0.32), ("elm", 0.24), ("liveoak", 0.22),
                    ("cypress", 0.14), ("oak", 0.08)),
    },
    "creek_under": {
        "spacing_m": 8.0, "jitter": 0.45, "radius_m": (2.4, 4.2),
        "species": (("crape", 0.38), ("elm", 0.24), ("magnolia", 0.20),
                    ("other", 0.18)),
    },
    "creek_scrub": {
        "spacing_m": 6.0, "jitter": 0.50, "radius_m": (1.3, 2.3),
        "species": (("crape", 0.52), ("other", 0.30), ("cedar", 0.18)),
    },
}
# Set False to plant nothing and get the old file back in one line.
CREEK_PLANTING = True

# A crown detected on top of a building footprint is a green roof, a courtyard
# tree read one wall too far, or a shadow — never a tree standing on a roof.
REJECT_ON_BUILDINGS = True
# Canopy `base` is where the crown starts up the trunk. Below this there is no
# visible trunk to draw: a crepe myrtle branches from the ground, and a 5-point
# box 0.3 m across is invisible at every zoom this scene is flown at. Skipping
# those trunks is most of what keeps the feature count affordable.
TRUNK_MIN_BASE_M = 2.4


def group_for(species):
    s = (species or "").strip().lower()
    for subs, key, Ar, R0, mR, Ah, H0, mH, leaf in SPECIES_GROUPS:
        if any(x in s for x in subs):
            return key, Ar, R0, mR, Ah, H0, mH, leaf
    return DEFAULT_GROUP


def size_from_dbh(dbh_in, g):
    key, Ar, R0, mR, Ah, H0, mH, leaf = g
    r = min(mR, Ar * dbh_in + R0)
    h = min(mH, Ah * dbh_in + H0)
    return max(1.8, r), max(4.0, h), leaf, key


def det01(lon, lat, salt):
    k = "%.6f:%.6f:%s" % (lon, lat, salt)
    return int.from_bytes(hashlib.md5(k.encode()).digest()[:4], "big") / 0xFFFFFFFF


def m_to_deg(m, lat):
    return m / (M_LAT * math.cos(math.radians(lat))), m / M_LAT


def octagon(lon, lat, r_m, squash, rot):
    dlon, dlat = m_to_deg(r_m, lat)
    ring = []
    for i in range(8):
        a = math.radians(rot + 22.5 + i * 45.0)
        ring.append([round(lon + dlon * math.cos(a), 6),
                     round(lat + dlat * squash * math.sin(a), 6)])
    ring.append(list(ring[0]))
    return ring


def square(lon, lat, half_m):
    dlon, dlat = m_to_deg(half_m, lat)
    r = [[lon - dlon, lat - dlat], [lon + dlon, lat - dlat],
         [lon + dlon, lat + dlat], [lon - dlon, lat + dlat]]
    r.append(list(r[0]))
    return [[round(x, 6) for x in p] for p in r]


# ── A tiny polygon index, so 12,000 crowns can be tested against 2,400
# footprints without 29 million point-in-polygon calls. ────────────────
class PolyIndex(object):
    CELL = 0.0006          # ~60 m; a campus building spans a few cells

    def __init__(self):
        self.cells = {}
        self.n = 0

    @staticmethod
    def _rings(geom):
        if not geom:
            return []
        t = geom.get("type")
        if t == "Polygon":
            return [geom["coordinates"][0]] if geom["coordinates"] else []
        if t == "MultiPolygon":
            return [p[0] for p in geom["coordinates"] if p]
        return []

    def add(self, geom):
        for ring in self._rings(geom):
            if len(ring) < 4:
                continue
            xs = [c[0] for c in ring]
            ys = [c[1] for c in ring]
            box = (min(xs), min(ys), max(xs), max(ys))
            self.n += 1
            i0, i1 = int(box[0] / self.CELL), int(box[2] / self.CELL)
            j0, j1 = int(box[1] / self.CELL), int(box[3] / self.CELL)
            for i in range(i0, i1 + 1):
                for j in range(j0, j1 + 1):
                    self.cells.setdefault((i, j), []).append((box, ring))

    def contains(self, lon, lat):
        for box, ring in self.cells.get((int(lon / self.CELL), int(lat / self.CELL)), ()):
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
                return True
        return False

    def near(self, lon, lat, radius_m):
        """True if any indexed ring has a vertex within radius_m."""
        rlon = radius_m / (M_LAT * math.cos(math.radians(lat)))
        rlat = radius_m / M_LAT
        span = int(max(rlon, rlat) / self.CELL) + 1
        ci, cj = int(lon / self.CELL), int(lat / self.CELL)
        for di in range(-span, span + 1):
            for dj in range(-span, span + 1):
                for box, ring in self.cells.get((ci + di, cj + dj), ()):
                    if lon < box[0] - rlon or lon > box[2] + rlon or \
                            lat < box[1] - rlat or lat > box[3] + rlat:
                        continue
                    for c in ring:
                        dxm = (c[0] - lon) * M_LAT * math.cos(math.radians(lat))
                        dym = (c[1] - lat) * M_LAT
                        if dxm * dxm + dym * dym <= radius_m * radius_m:
                            return True
        return False


def latest_buildings():
    """The newest snapshot's footprints. Read-only — the buildings bake is not
    ours; we only ask it where the roofs are."""
    try:
        with open(MANIFEST, encoding="utf-8") as f:
            date = json.load(f)["latest"]
    except Exception:                                             # noqa: BLE001
        return None
    p = os.path.join(DATA, "snapshots", date, "buildings.geojson")
    if not os.path.exists(p):
        return None
    idx = PolyIndex()
    with open(p, encoding="utf-8") as f:
        for feat in json.load(f).get("features", []):
            idx.add(feat.get("geometry"))
    return idx


def water_index():
    idx = PolyIndex()
    if not os.path.exists(GROUND):
        return idx
    with open(GROUND, encoding="utf-8") as f:
        for feat in json.load(f).get("features", []):
            if (feat.get("properties") or {}).get("s") == "water":
                idx.add(feat.get("geometry"))
    return idx


def creek_zones():
    """The Acer's three planting corridors, one polygon index per zone tag.

    Read-only use of data/ground.geojson — that file belongs to the other lane
    and the three `src` tags are a frozen contract (MAC_QUEUE). A tag that stops
    matching prints a zero below rather than silently planting nothing, because
    "the creek is empty again" is exactly the failure this consumes.
    """
    idx = {k: PolyIndex() for k in CREEK_ZONES}
    if not os.path.exists(GROUND):
        return idx
    with open(GROUND, encoding="utf-8") as f:
        for feat in json.load(f).get("features", []):
            src = (feat.get("properties") or {}).get("src")
            if src in idx:
                idx[src].add(feat.get("geometry"))
    return idx


def plant_creek(zones, bld, wat):
    """Scatter trees through the creek corridors on a jittered grid.

    A plain grid reads as an orchard from the air, and pure noise clumps and
    leaves holes. A grid cell with a deterministic offset inside it gives an
    even density with no visible rows — the same trick `d` uses to thin trees
    without banding. Deterministic in position, so re-running plants the same
    forest; `det01` is the file's own hash.

    Emits (lon, lat, r_m, h_m, leaf, key, src, dbh) tuples like every other
    source here, with height modelled from radius through HABIT exactly the way
    the imagery crowns are — so a creek pecan and a photographed pecan of the
    same spread are the same tree.
    """
    out, stats = [], {}
    for tag, cfg in CREEK_ZONES.items():
        idx = zones.get(tag)
        placed = on_water = on_building = 0
        if idx is None or not idx.n:
            stats[tag] = {"areas": 0, "planted": 0}
            continue
        # Walk the grid over each zone's own bounding box rather than the whole
        # city: 33.5 ha of corridor inside a 9 km box is 99.9% empty cells.
        boxes = []
        for cells in idx.cells.values():
            for box, _ring in cells:
                boxes.append(box)
        if not boxes:
            stats[tag] = {"areas": 0, "planted": 0}
            continue
        w = min(b[0] for b in boxes); s = min(b[1] for b in boxes)
        e = max(b[2] for b in boxes); n = max(b[3] for b in boxes)
        dlon, dlat = m_to_deg(cfg["spacing_m"], (s + n) / 2.0)
        r_lo, r_hi = cfg["radius_m"]
        ny = int((n - s) / dlat) + 1
        nx = int((e - w) / dlon) + 1
        for iy in range(ny):
            for ix in range(nx):
                lon = w + (ix + 0.5) * dlon
                lat = s + (iy + 0.5) * dlat
                # Jitter inside the cell, up to `jitter` of a full spacing.
                lon += (det01(lon, lat, tag + "x") - 0.5) * 2 * cfg["jitter"] * dlon
                lat += (det01(lon, lat, tag + "y") - 0.5) * 2 * cfg["jitter"] * dlat
                if not idx.contains(lon, lat):
                    continue
                if wat is not None and wat.contains(lon, lat):
                    on_water += 1
                    continue
                if bld is not None and bld.contains(lon, lat):
                    on_building += 1
                    continue
                u = det01(lon, lat, tag + "r")
                r_m = r_lo + (r_hi - r_lo) * u
                # Species by weight, from the same deterministic draw family.
                v, key = det01(lon, lat, tag + "s"), cfg["species"][-1][0]
                acc = 0.0
                for name, share in cfg["species"]:
                    acc += share
                    if v <= acc:
                        key = name
                        break
                # `oak` and `other` are legal species keys downstream
                # (shape_trees PROFILES knows both) but HABIT does not carry a
                # height habit for them, so they borrow the nearest one that
                # shares their crown shape. Falling through to a default would
                # have made every unlabelled creek tree the same height.
                leaf, Ah, H0, mH = HABIT.get(
                    {"oak": "liveoak", "other": "elm"}.get(key, key),
                    HABIT["elm"])[:4]
                h_m = max(3.0, min(mH, Ah * r_m + H0))
                out.append((lon, lat, r_m, h_m, leaf, key, "creek", None))
                placed += 1
        stats[tag] = {"areas": idx.n, "planted": placed,
                      "rejected_water": on_water, "rejected_building": on_building,
                      "spacing_m": cfg["spacing_m"]}
    return out, stats


def species_for(lon, lat, r_m, near_water):
    """Pick a species for an imagery-detected crown. GENERATIVE — see HABIT."""
    if near_water and r_m >= 3.0:
        return WATER_SPECIES
    for lo, mix in RADIUS_MIX:
        if r_m >= lo:
            u = det01(lon, lat, "sp")
            acc = 0.0
            for key, w in mix:
                acc += w
                if u <= acc:
                    return key
            return mix[-1][0]
    return "crape"


def in_box(lon, lat, box):
    s, w, n, e = box
    return s <= lat <= n and w <= lon <= e


def fetch_city():
    # THE CACHE IS KEYED ON THE BOX. It was `city_trees.json` flat, and that is a
    # trap with teeth: widen BBOX with a cache on disk and this returns the OLD
    # box's 1,566 rows, the run "succeeds", the file is rewritten, and the map
    # looks exactly as broken as before with nothing to indicate why.
    s, w, n, e = BBOX
    cache = os.path.join(CACHE, "city_trees_%.4f_%.4f_%.4f_%.4f.json" % BBOX)
    if os.path.exists(cache):
        with open(cache, encoding="utf-8") as f:
            return json.load(f)
    if os.path.exists(CITY_CACHE) and BBOX == CORE_BBOX:
        with open(CITY_CACHE, encoding="utf-8") as f:
            return json.load(f)
    where = ("latitude between %s and %s AND longtitude between %s and %s" % (s, n, w, e))
    url = SOCRATA + "?" + urllib.parse.urlencode({"$where": where, "$limit": "50000"})
    req = urllib.request.Request(url, headers={"User-Agent": "austin-3d-explorer/1.0"})
    with urllib.request.urlopen(req, timeout=300) as r:
        rows = json.loads(r.read().decode())
    # 50,000 is the Socrata page limit. A silently truncated page would read as
    # "the city has no trees over there", which is the exact defect this widen
    # exists to fix, so say so rather than shipping a half-covered city.
    if len(rows) >= 50000:
        sys.stderr.write("!! city inventory hit the 50,000-row page limit — "
                         "coverage is TRUNCATED, page the query\n")
    with open(cache, "w", encoding="utf-8") as f:
        json.dump(rows, f, separators=(",", ":"))
    return rows


def load_osm_trees():
    p = os.path.join(CACHE, "trees.json")
    if not os.path.exists(p):
        return []
    with open(p, encoding="utf-8") as f:
        return json.load(f).get("elements", [])


def parse_m(v):
    if v is None:
        return None
    t = str(v).strip().lower().replace("m", "").replace(" ", "")
    try:
        f = float(t)
        return f if f > 0 else None
    except ValueError:
        return None


def main():
    trees = []            # (lon, lat, r_m, h_m, leaf, group, src, dbh)
    stats = {"city_rows": 0, "city_used": 0, "city_skip_species": 0, "city_skip_dbh": 0,
             "osm_nodes": 0, "osm_used": 0, "deduped": 0}

    # ---- city inventory ------------------------------------------------
    try:
        rows = fetch_city()
    except Exception as e:                                        # noqa: BLE001
        # REFUSE, do not degrade. Without the inventory this writes a
        # 498-tree file over a 23,000-tree one and prints a report that looks
        # like a successful run — the whole city goes bare and the only clue is
        # a line on stderr. The response is not cached, so the next run with a
        # network is a full recovery; there is nothing to salvage by continuing.
        sys.stderr.write("city inventory unavailable (%s)\n" % e)
        if os.path.exists(OUT):
            sys.stderr.write(
                "REFUSING to rewrite %s from OSM alone — it would drop the "
                "canopy to a few hundred trees. Delete it first if that is "
                "really what you want.\n" % OUT)
            sys.exit(2)
        rows = []
    stats["city_rows"] = len(rows)
    for r in rows:
        sp = (r.get("species") or "").strip()
        if any(x in sp.lower() for x in SKIP_SPECIES):
            stats["city_skip_species"] += 1
            continue
        try:
            lon = float(r["longtitude"]); lat = float(r["latitude"])
        except (KeyError, TypeError, ValueError):
            continue
        try:
            dbh = float(r.get("diameter"))
        except (TypeError, ValueError):
            dbh = 0.0
        if dbh < (MIN_DBH_IN if in_box(lon, lat, CORE_BBOX) else OUTER_MIN_DBH_IN):
            stats["city_skip_dbh"] += 1
            continue
        g = group_for(sp)
        r_m, h_m, leaf, key = size_from_dbh(dbh, g)
        trees.append((lon, lat, r_m, h_m, leaf, key, "city", dbh))
        stats["city_used"] += 1

    # ---- OSM nodes (kept: they cover places the city does not) ----------
    els = load_osm_trees()
    for el in els:
        if el.get("type") != "node":
            continue
        stats["osm_nodes"] += 1
        lon, lat = el["lon"], el["lat"]
        t = el.get("tags", {}) or {}
        # OSM sometimes carries real measurements; prefer them over the model.
        dc = parse_m(t.get("diameter_crown"))
        ht = parse_m(t.get("height"))
        sp = t.get("species") or t.get("genus") or ""
        g = group_for(sp)
        if dc or ht:
            r_m = (dc / 2.0) if dc else size_from_dbh(14.0, g)[0]
            h_m = ht if ht else size_from_dbh(14.0, g)[1]
            leaf = t.get("leaf_type") or g[7]
            key = g[0]
        else:
            # No measurement anywhere: use a mid-size default for the group.
            r_m, h_m, leaf, key = size_from_dbh(14.0, g)
            leaf = t.get("leaf_type") or leaf
        trees.append((lon, lat, r_m, h_m, leaf, key, "osm", None))
        stats["osm_used"] += 1

    # ---- imagery-detected crowns (scripts/detect_canopy.py) --------------
    # These cover the ground the surveys do not: the UT malls and the flight
    # corridor. POSITION and RADIUS are measured off the photograph; HEIGHT is
    # modelled from the radius. Listed last so a surveyed tree always wins the
    # dedupe below and keeps its species.
    stats["imagery_rows"] = 0
    stats["imagery_used"] = 0
    stats["imagery_on_building"] = 0
    stats["imagery_on_water"] = 0
    if os.path.exists(CANOPY_DETECTED):
        with open(CANOPY_DETECTED, encoding="utf-8") as f:
            det = json.load(f)
        bld = latest_buildings() if REJECT_ON_BUILDINGS else None
        wat = water_index()
        sys.stderr.write("indexed %s building rings, %d water rings\n"
                         % (bld.n if bld else "no", wat.n))
        for tag, blk in sorted(det.items()):
            for t in blk.get("trees", []):
                stats["imagery_rows"] += 1
                lon, lat = float(t["lon"]), float(t["lat"])
                # A detected blob wider than a real single crown is a canopy
                # mass; keep it but cap the drawn crown so it cannot become a
                # 28 m green dome over the mall.
                r_m = min(float(t["r"]), 11.0)
                if bld is not None and bld.contains(lon, lat):
                    stats["imagery_on_building"] += 1
                    continue
                if wat.contains(lon, lat):
                    stats["imagery_on_water"] += 1
                    continue
                key = species_for(lon, lat, r_m, wat.near(lon, lat, WATER_NEAR_M))
                leaf, Ah, H0, mH, _slo, _shi = HABIT[key]
                # HEIGHT is modelled from the measured radius by that species'
                # habit — a pecan of a given spread is far taller than a live
                # oak of the same spread, and that difference is most of what
                # makes a mixed stand read as mixed.
                h_m = max(4.0, min(mH, Ah * r_m + H0))
                trees.append((lon, lat, r_m, h_m, leaf, key, "imagery", None))
                stats["imagery_used"] += 1

    # ---- Waller Creek, planted into the Acer's three corridors ----------
    # Last, so the dedupe below always resolves in favour of a surveyed or
    # photographed tree that is already standing there.
    stats["creek_used"] = 0
    creek_report = {}
    if CREEK_PLANTING:
        zones = creek_zones()
        grown, creek_report = plant_creek(
            zones,
            latest_buildings() if REJECT_ON_BUILDINGS else None,
            water_index())
        trees.extend(grown)
        stats["creek_used"] = len(grown)
        for tag, r in sorted(creek_report.items()):
            sys.stderr.write("  %-14s %3d areas -> %5d trees at %s m\n"
                             % (tag, r.get("areas", 0), r.get("planted", 0),
                                r.get("spacing_m", "-")))
            if not r.get("areas"):
                sys.stderr.write("  [warn] %s matched NO areas in ground.geojson — "
                                 "has the tag been renamed?\n" % tag)

    # ---- dedupe: same tree in more than one source ----------------------
    kept = []
    cell = {}
    step_lon, step_lat = m_to_deg(DEDUPE_M, 30.286)
    for t in trees:
        lon, lat = t[0], t[1]
        cx, cy = int(lon / step_lon), int(lat / step_lat)
        hit = False
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for o in cell.get((cx + dx, cy + dy), ()):
                    dxm = (lon - o[0]) * M_LAT * math.cos(math.radians(lat))
                    dym = (lat - o[1]) * M_LAT
                    if dxm * dxm + dym * dym < DEDUPE_M * DEDUPE_M:
                        hit = True
                        break
                if hit:
                    break
            if hit:
                break
        if hit:
            stats["deduped"] += 1
            continue
        cell.setdefault((cx, cy), []).append(t)
        kept.append(t)

    # ---- keep-order --------------------------------------------------------
    # `d` drives GFX.treeDensity, which filters `d <= density`. The first
    # version computed it from a size formula, which meant the fraction of trees
    # a given density actually drew depended on the size DISTRIBUTION — at 2,572
    # trees the "balanced" 0.675 drew 1,544 (60%), and after this pass grew the
    # set 4x the same number would have drawn a wildly different share. So `d` is
    # now a QUANTILE: sort by importance, and d is the rank in 0..1. Density
    # 0.675 draws 67.5% of the trees, always, whatever the file contains.
    #
    # Importance is size-biased with a deterministic jitter — thinning drops
    # small trees first (the big live oaks are what you actually see from 60 m)
    # but never in bands, because the jitter breaks up any spatial run.
    #
    # THE QUANTILE IS PER ZONE, and it has to be, or widening the box silently
    # re-tunes every graphics preset. One global rank over core+outer would make
    # `d <= 0.52` mean "52% of a set 2.6x larger", i.e. 2.6x the trees drawn on
    # campus at the medium preset — a perf change nobody asked for, arriving as
    # a side effect of a coverage fix. Ranked inside each zone, 0.52 still draws
    # 52% of the campus AND 52% of the backdrop: the slider keeps its meaning
    # both globally and per zone, and the campus draws exactly what it did.
    order_by_zone = defaultdict(list)
    for i, (lon, lat, r_m, h_m, leaf, key, src, dbh) in enumerate(kept):
        size = max(0.0, min(1.0, (r_m - 1.8) / 9.0))
        z = "core" if in_box(lon, lat, CORE_BBOX) else "outer"
        order_by_zone[z].append((-(0.68 * size + 0.32 * det01(lon, lat, "dens")), i))
    rank = [0.0] * len(kept)
    for z, order in order_by_zone.items():
        order.sort()
        n = max(1, len(order) - 1)
        for pos, (_, i) in enumerate(order):
            rank[i] = pos / n

    # ---- emit -----------------------------------------------------------
    feats = []
    trunks = 0
    for i, (lon, lat, r_m, h_m, leaf, key, src, dbh) in enumerate(kept):
        # Deterministic per-tree variation so a row of the same species does not
        # look stamped. FORM only — never position. Squash range is per-habit:
        # a bald cypress is a narrow column, a live oak sprawls.
        slo, shi = HABIT.get(key, (None, 0, 0, 0, 0.82, 1.12))[4:6]
        squash = slo + det01(lon, lat, "sq") * (shi - slo)
        rot = det01(lon, lat, "rot") * 45.0
        # Where the crown starts up the trunk. Low-branching habits (crepe
        # myrtle, magnolia) carry their crown near the ground; an open-grown
        # pecan holds it high. Driven off the species, not a flat 30%.
        lift = 0.16 if key in ("crape", "magnolia") else (0.34 if key in ("pecan", "cypress") else 0.28)
        base = round(h_m * (lift + det01(lon, lat, "b") * 0.08), 2)
        d = round(rank[i], 4)
        # A trunk is only drawn where a missing one would read as a floating
        # blob. Below TRUNK_MIN_BASE_M the crown all but touches the ground and
        # the trunk is a 0.3 m box nobody can see — half the features in the
        # file, for nothing.
        if base >= TRUNK_MIN_BASE_M and (OUTER_TRUNKS or in_box(lon, lat, CORE_BBOX)):
            feats.append({
                "type": "Feature",
                "properties": {"kind": "trunk", "h": round(base + 0.4, 2), "base": 0,
                               "d": d},
                "geometry": {"type": "Polygon",
                             "coordinates": [square(lon, lat, max(0.25, r_m * 0.075))]},
            })
            trunks += 1
        p = {"kind": "canopy", "h": round(h_m, 2), "base": base, "d": d,
             "leaf": leaf, "sp": key, "src": src}
        if dbh:
            p["dbh"] = dbh
        feats.append({
            "type": "Feature", "properties": p,
            "geometry": {"type": "Polygon", "coordinates": [octagon(lon, lat, r_m, squash, rot)]},
        })

    fc = {"type": "FeatureCollection", "features": feats}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(fc, f, separators=(",", ":"))

    canopies = [f for f in feats if f["properties"]["kind"] == "canopy"]
    hs = [f["properties"]["h"] for f in canopies]

    # Zone split, the number the brief actually asks for. Longitudes are the
    # ones in the brief: West Campus / the malls and the Drag / east campus.
    def zone_of(f):
        lon = f["geometry"]["coordinates"][0][0][0]
        return "west" if lon < -97.741 else ("mid" if lon <= -97.734 else "east")
    zones = {"west": 0, "mid": 0, "east": 0}
    for f in canopies:
        zones[zone_of(f)] += 1
    # The number the DUST BOWL defect is about: how much of the modelled city
    # has trees on it at all. `core` is the old box; `outer` is everything the
    # buildings cover that the canopy used to stop short of.
    core_outer = {"core": 0, "outer": 0}
    for f in canopies:
        c = f["geometry"]["coordinates"][0][0]
        core_outer["core" if in_box(c[0], c[1], CORE_BBOX) else "outer"] += 1

    report = {
        "trees": len(canopies),
        "features": len(feats),
        "trunks": trunks,
        "by_zone": zones,
        "by_coverage": core_outer,
        "draws_at_density": {str(v): sum(1 for f in canopies if f["properties"]["d"] <= v)
                             for v in (0.35, 0.52, 0.675, 1.0)},
        "file_kb": round(os.path.getsize(OUT) / 1024, 1),
        "stats": stats,
        "height_m": {"min": round(min(hs), 1), "max": round(max(hs), 1),
                     "mean": round(sum(hs) / len(hs), 1)} if hs else None,
        "by_species_group": {k: sum(1 for f in canopies if f["properties"]["sp"] == k)
                             for k in sorted({f["properties"]["sp"] for f in canopies})},
        # POSITION provenance — the number that matters for truth.
        "by_source": {s: sum(1 for f in canopies if f["properties"]["src"] == s)
                      for s in ("city", "osm", "imagery")},
        "creek": creek_report,
        "provenance": {
            "position": "city survey / OSM node / measured off nadir aerial "
                        "imagery / GENERATIVE inside the creek corridors "
                        "(src:'creek' — nothing surveys a creek bed, so these "
                        "are invented on a jittered grid inside zones authored "
                        "in data/ground.geojson)",
            "radius": "city+osm: modelled from measured trunk diameter; "
                      "imagery: measured from the detected crown; "
                      "creek: GENERATIVE, drawn from the zone's radius range",
            "height": "MODELLED in every case - no source here records tree height",
            "form": "generative octagon prism (unchanged)",
        },
    }
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
