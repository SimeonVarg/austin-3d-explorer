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
    if os.path.exists(CANOPY_DETECTED):
        with open(CANOPY_DETECTED, encoding="utf-8") as f:
            det = json.load(f)
        for tag, blk in sorted(det.items()):
            for t in blk.get("trees", []):
                stats["imagery_rows"] += 1
                r_m = float(t["r"])
                h_m = float(t["h"])
                # A detected blob wider than a real single crown is a canopy
                # mass; keep it but cap the drawn crown so it cannot become a
                # 28 m green dome over the mall.
                r_m = min(r_m, 11.0)
                trees.append((float(t["lon"]), float(t["lat"]), r_m, h_m,
                              "broadleaved", "detected", "imagery", None))
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

    # ---- emit -----------------------------------------------------------
    feats = []
    for lon, lat, r_m, h_m, leaf, key, src, dbh in kept:
        # Deterministic per-tree variation so a row of the same species does not
        # look stamped. FORM only — never position.
        squash = 0.82 + det01(lon, lat, "sq") * 0.30
        rot = det01(lon, lat, "rot") * 45.0
        base = round(h_m * (0.30 + det01(lon, lat, "b") * 0.10), 2)
        d_trunk = round(0.62 * max(0.0, min(1.0, 1.0 - (r_m - 1.8) / 10.0))
                        + 0.38 * det01(lon, lat, "dens"), 4)
        feats.append({
            "type": "Feature",
            "properties": {"kind": "trunk", "h": round(base + 0.4, 2), "base": 0,
                           "d": d_trunk},
            "geometry": {"type": "Polygon",
                         "coordinates": [square(lon, lat, max(0.25, r_m * 0.075))]},
        })
        # `d` is a keep-order in 0..1 for the density control (GFX.treeDensity
        # filters `d <= density`). Biased by size so thinning drops small trees
        # first — the big live oaks are what you actually see from 60 m — with
        # a deterministic jitter so the survivors never form visible bands.
        d = round(0.62 * max(0.0, min(1.0, 1.0 - (r_m - 1.8) / 10.0))
                  + 0.38 * det01(lon, lat, "dens"), 4)
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
    report = {
        "trees": len(canopies),
        "features": len(feats),
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
