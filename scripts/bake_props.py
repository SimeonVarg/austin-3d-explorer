# -*- coding: utf-8 -*-
"""Bake the small things that give a place scale and identity:
UT's Landmarks public art, street furniture, and current construction.

Reads the cached Overpass responses (data/osm_cache/) written by
survey_ground.py and emits data/props.geojson.

TRUTH
  POSITION — factual, straight from OSM. Nothing is placed for composition.
  NAME/ARTIST — factual, from OSM tags.
  FORM — generative. We do not model Nancy Rubins' aluminium boats or di
         Suvero's steel; each piece is a plinth-and-mass stand-in sized by its
         `artwork_type`, and the NAME is what carries the identity. Called out
         in the report, and in the layer comment in js/props.js.

Historical-marker memorials (the ~60 "X House" plaques) are deliberately
EXCLUDED: they are signs on buildings, invisible at any flying altitude, and
labelling them would bury the campus in text.

Usage:  python scripts/bake_props.py
"""
import json
import math
import os
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "data", "osm_cache")
OUT = os.path.join(ROOT, "data", "props.geojson")
M_LAT = 111320.0

# Drawn size per artwork_type: (half-width m, height m). GENERATIVE.
ART_FORM = {
    "statue":       (0.9, 4.2),
    "sculpture":    (1.6, 5.5),
    "installation": (2.4, 7.0),
    "mural":        (1.2, 3.0),
    "building":     (3.0, 8.0),
    None:           (1.2, 4.5),
}
FURNITURE_FORM = {          # (half-width m, height m)
    "bench":            (0.7, 0.5),
    "waste_basket":     (0.35, 0.9),
    "drinking_water":   (0.3, 1.0),
    "bicycle_parking":  (1.0, 0.9),
    "street_lamp":      (0.18, 5.0),
}


def load(key):
    p = os.path.join(CACHE, key + ".json")
    if not os.path.exists(p):
        return []
    with open(p, encoding="utf-8") as f:
        return json.load(f).get("elements", [])


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


def square(lon, lat, half_m):
    dlat = half_m / M_LAT
    dlon = half_m / (M_LAT * math.cos(math.radians(lat)))
    r = [[lon - dlon, lat - dlat], [lon + dlon, lat - dlat],
         [lon + dlon, lat + dlat], [lon - dlon, lat + dlat]]
    r.append(list(r[0]))
    return [[round(x, 6) for x in p] for p in r]


def main():
    feats = []
    stats = Counter()

    # ---- public art -----------------------------------------------------
    for el in load("artwork"):
        t = el.get("tags", {}) or {}
        # Artworks only. A `historic=memorial` with no artwork tag is a plaque.
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
            "geometry": {"type": "Polygon", "coordinates": [square(c[0], c[1], half)]},
            "properties": {
                "k": "art", "name": name, "h": h,
                "at": at or "", "artist": t.get("artist_name", ""),
            },
        })
        stats["art"] += 1

    # ---- street furniture ------------------------------------------------
    for el in load("furniture"):
        t = el.get("tags", {}) or {}
        kind = t.get("amenity") or ("street_lamp" if t.get("highway") == "street_lamp" else None)
        if kind not in FURNITURE_FORM:
            continue
        c = centre(el)
        if not c:
            continue
        half, h = FURNITURE_FORM[kind]
        feats.append({
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": [square(c[0], c[1], half)]},
            "properties": {"k": "furn", "u": kind, "h": h},
        })
        stats["furn_" + kind] += 1

    # ---- current construction -------------------------------------------
    # Only named sites and explicit construction landuse: a fenced car park is
    # not a story, "Mulva Hall going up" is.
    for el in load("construction"):
        t = el.get("tags", {}) or {}
        is_site = (t.get("landuse") == "construction" or t.get("building") == "construction")
        if not is_site:
            continue
        c = centre(el)
        if not c:
            continue
        feats.append({
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": [square(c[0], c[1], 1.0)]},
            "properties": {"k": "cons", "name": t.get("name", ""), "h": 12.0},
        })
        stats["construction"] += 1

    fc = {"type": "FeatureCollection", "features": feats}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(fc, f, separators=(",", ":"))

    art_names = sorted(f["properties"]["name"] for f in feats if f["properties"]["k"] == "art")
    print(json.dumps({
        "features": len(feats),
        "file_kb": round(os.path.getsize(OUT) / 1024, 1),
        "counts": dict(sorted(stats.items())),
        "art_named": art_names,
        "provenance": {"position": "OSM, factual",
                       "name/artist": "OSM tags, factual",
                       "form": "GENERATIVE plinth sized by artwork_type - the "
                               "sculptures themselves are not modelled"},
    }, indent=2))


if __name__ == "__main__":
    main()
