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

BBOX = (30.276, -97.752, 30.296, -97.726)          # s, w, n, e
SOCRATA = "https://data.austintexas.gov/resource/wrik-xasw.json"
M_LAT = 111320.0

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


def fetch_city():
    if os.path.exists(CITY_CACHE):
        with open(CITY_CACHE, encoding="utf-8") as f:
            return json.load(f)
    s, w, n, e = BBOX
    where = ("latitude between %s and %s AND longtitude between %s and %s" % (s, n, w, e))
    url = SOCRATA + "?" + urllib.parse.urlencode({"$where": where, "$limit": "50000"})
    req = urllib.request.Request(url, headers={"User-Agent": "austin-3d-explorer/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        rows = json.loads(r.read().decode())
    with open(CITY_CACHE, "w", encoding="utf-8") as f:
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
        sys.stderr.write("city inventory unavailable (%s); OSM only\n" % e)
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
        if dbh < MIN_DBH_IN:
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
    order = []
    for i, (lon, lat, r_m, h_m, leaf, key, src, dbh) in enumerate(kept):
        size = max(0.0, min(1.0, (r_m - 1.8) / 9.0))
        order.append((-(0.68 * size + 0.32 * det01(lon, lat, "dens")), i))
    order.sort()
    rank = [0.0] * len(kept)
    n = max(1, len(kept) - 1)
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
        if base >= TRUNK_MIN_BASE_M:
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

    report = {
        "trees": len(canopies),
        "features": len(feats),
        "trunks": trunks,
        "by_zone": zones,
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
        "provenance": {
            "position": "city survey / OSM node / measured off nadir aerial imagery",
            "radius": "city+osm: modelled from measured trunk diameter; "
                      "imagery: measured from the detected crown",
            "height": "MODELLED in every case - no source here records tree height",
            "form": "generative octagon prism (unchanged)",
        },
    }
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
