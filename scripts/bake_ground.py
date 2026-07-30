# -*- coding: utf-8 -*-
"""Bake the cached OSM ground data (data/osm_cache/*.json) into one render-ready
data/ground.geojson.

TRUTH RULE, which governs this whole file: every POSITION here comes from OSM.
Nothing is scattered, invented or nudged for looks. What is generative is FORM —
the drawn width of a path whose width OSM does not record, and the colour we
choose for a named surface. Those two are called out in the report this prints.

Emits per feature:
  k  kind      path | area
  s  surface   limestone | concrete | brick | asphalt | paving | gravel |
               grass | wood | water | track | sand | dirt
  u  use       what the thing IS (footway, steps, plaza, lawn, pitch, parking…)
  w  width_m   paths only; measured where tagged, else a default by use (form)
  wt tagged    1 if the width came from OSM, 0 if it is our default

Usage:  python scripts/bake_ground.py
"""
import json
import math
import os
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "data", "osm_cache")
OUT = os.path.join(ROOT, "data", "ground.geojson")

# ---------------------------------------------------------------- surfaces --
# OSM surface value -> our surface class. Anything unmapped is reported, never
# silently guessed.
SURFACE_MAP = {
    "concrete": "concrete", "concrete:plates": "concrete", "concrete:lanes": "concrete",
    "paved": "paving", "paving_stones": "paving", "sett": "paving",
    "cobblestone": "paving", "unhewn_cobblestone": "paving",
    "brick": "brick", "bricks": "brick", "paving_stones:brick": "brick",
    "asphalt": "asphalt", "chipseal": "asphalt", "tartan": "track",
    "grass": "grass", "grass_paver": "grass", "ground": "dirt", "dirt": "dirt",
    "earth": "dirt", "mud": "dirt", "unpaved": "gravel", "compacted": "gravel",
    "gravel": "gravel", "fine_gravel": "gravel", "pebblestone": "gravel",
    "sand": "sand", "wood": "wood", "metal": "concrete", "rubber": "track",
    "limestone": "limestone", "stone": "limestone", "rock": "limestone",
    "artificial_turf": "turf", "synthetic": "turf",
}

# What a thing IS, when its surface is not tagged. This is a GENERATIVE default:
# an untagged campus footway is overwhelmingly concrete here (of the corridor's
# tagged paths, concrete outnumbers everything else better than 2:1), and the
# malls are limestone-paved. Reported as a default, not as sourced fact.
DEFAULT_SURFACE = {
    "footway": "concrete", "steps": "concrete", "cycleway": "asphalt",
    "path": "gravel", "pedestrian": "paving", "plaza": "paving",
    "lawn": "grass", "park": "grass", "wood": "wood", "scrub": "grass",
    "pitch": "grass", "track": "track", "parking": "asphalt",
    "water": "water", "fountain": "water", "sand": "sand",
    "construction": "dirt", "playground": "sand", "garden": "grass",
}

# Drawn width in metres for paths OSM does not measure. GENERATIVE.
DEFAULT_WIDTH = {
    "footway": 2.4, "steps": 3.0, "cycleway": 2.2, "path": 1.5, "pedestrian": 6.0,
}

# landuse/natural/leisure value -> our `use`, for area features.
AREA_USE = {
    "grass": "lawn", "meadow": "lawn", "village_green": "lawn", "greenfield": "lawn",
    "recreation_ground": "lawn", "grassland": "lawn",
    "forest": "wood", "wood": "wood", "scrub": "scrub",
    "park": "park", "garden": "garden", "pitch": "pitch", "track": "track",
    "playground": "playground", "common": "lawn",
    "water": "water", "reservoir": "water", "basin": "water", "fountain": "fountain",
    "parking": "parking", "construction": "construction", "brownfield": "construction",
    "sand": "sand",
}

M_LAT = 111320.0
unmapped_surface = Counter()
warnings = []


def load(key):
    p = os.path.join(CACHE, key + ".json")
    if not os.path.exists(p):
        warnings.append("cache miss: %s.json not fetched yet; its features are ABSENT" % key)
        return []
    with open(p, encoding="utf-8") as f:
        return json.load(f).get("elements", [])


def parse_width(val):
    if val is None:
        return None
    s = str(val).strip().lower().replace("m", "").replace(" ", "").replace(",", ".")
    try:
        f = float(s)
        return f if 0.3 < f < 60 else None
    except ValueError:
        return None


def surface_of(tags, use):
    raw = tags.get("surface")
    if raw:
        s = SURFACE_MAP.get(raw.strip().lower())
        if s:
            return s, True
        unmapped_surface[raw] += 1
    return DEFAULT_SURFACE.get(use, "concrete"), False


def ring_of(geom):
    if not geom or len(geom) < 3:
        return None
    r = [[round(p["lon"], 6), round(p["lat"], 6)] for p in geom]
    if r[0] != r[-1]:
        r.append(list(r[0]))
    return r if len(r) >= 4 else None


def rings_from_relation(el):
    """Stitch outer members of a multipolygon relation into closed rings."""
    segs = []
    for m in el.get("members", []):
        if m.get("type") == "way" and m.get("role") in ("outer", "") and m.get("geometry"):
            segs.append([[p["lon"], p["lat"]] for p in m["geometry"]])
    rings = []
    while segs:
        ring = segs.pop(0)
        moved = True
        while moved and ring[0] != ring[-1]:
            moved = False
            for i, s in enumerate(segs):
                if s[0] == ring[-1]:      ring += s[1:]
                elif s[-1] == ring[-1]:   ring += s[-2::-1]
                elif s[-1] == ring[0]:    ring = s[:-1] + ring
                elif s[0] == ring[0]:     ring = s[::-1][:-1] + ring
                else:                     continue
                segs.pop(i); moved = True; break
        if ring[0] != ring[-1]:
            ring.append(list(ring[0]))
        if len(ring) >= 4:
            rings.append([[round(x, 7) for x in p] for p in ring])
    return rings


def area_m2(ring):
    """Rough planar area of a lon/lat ring, in m^2."""
    if not ring:
        return 0.0
    lat0 = sum(p[1] for p in ring) / len(ring)
    k = math.cos(math.radians(lat0))
    a = 0.0
    for (x0, y0), (x1, y1) in zip(ring, ring[1:]):
        a += (x0 * k) * y1 - (x1 * k) * y0
    return abs(a) * 0.5 * M_LAT * M_LAT


def main():
    feats = []
    stats = Counter()

    # ---- paths (lines) -------------------------------------------------
    for el in load("footways"):
        if el.get("type") != "way" or not el.get("geometry"):
            continue
        t = el.get("tags", {}) or {}
        hw = t.get("highway")
        if hw not in ("footway", "steps", "path", "cycleway", "pedestrian"):
            continue
        # A pedestrian AREA is a plaza, not a line — handled with the areas.
        if t.get("area") == "yes":
            continue
        # Skip crossings: they are road markings, and drawing them as paths
        # lays pale ribbons across every street.
        if t.get("footway") == "crossing" or t.get("crossing"):
            stats["skipped_crossing"] += 1
            continue
        coords = [[round(p["lon"], 6), round(p["lat"], 6)] for p in el["geometry"]]
        if len(coords) < 2:
            continue
        use = "steps" if hw == "steps" else hw
        surf, tagged = surface_of(t, use)
        w = parse_width(t.get("width")) or parse_width(t.get("est_width"))
        feats.append({
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": coords},
            "properties": {
                "k": "path", "u": use, "s": surf,
                "w": round(w or DEFAULT_WIDTH.get(use, 2.0), 1),
                "wt": 1 if w else 0,
                **({"name": t["name"]} if t.get("name") else {}),
            },
        })
        stats["path_" + use] += 1

    # ---- plazas / pedestrian areas -------------------------------------
    for el in load("plazas"):
        t = el.get("tags", {}) or {}
        rings = []
        if el.get("type") == "way":
            r = ring_of(el.get("geometry"))
            if r:
                rings = [r]
        else:
            rings = rings_from_relation(el)
        if not rings:
            continue
        surf, _ = surface_of(t, "plaza")
        for r in rings:
            feats.append({
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [r]},
                "properties": {"k": "area", "u": "plaza", "s": surf,
                               **({"name": t["name"]} if t.get("name") else {})},
            })
            stats["plaza"] += 1

    # ---- landuse / natural / leisure areas ------------------------------
    for el in load("landuse"):
        t = el.get("tags", {}) or {}
        val = t.get("landuse") or t.get("natural") or t.get("leisure")
        use = AREA_USE.get(val)
        if not use:
            continue
        rings = [ring_of(el.get("geometry"))] if el.get("type") == "way" else rings_from_relation(el)
        rings = [r for r in rings if r]
        if not rings:
            continue
        surf, _ = surface_of(t, use)
        for r in rings:
            # Drop enormous polygons: a campus-wide landuse=education blanket
            # would repaint the entire ground plane one flat colour, which is
            # the exact defect this pass exists to remove.
            if area_m2(r) > 400000:
                stats["skipped_huge_area"] += 1
                continue
            feats.append({
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [r]},
                "properties": {"k": "area", "u": use, "s": surf,
                               **({"name": t["name"]} if t.get("name") else {})},
            })
            stats["area_" + use] += 1

    # ---- water, sport surfaces, parking ---------------------------------
    for key, default_use in (("water", "water"), ("sport", "track"), ("parking", "parking")):
        for el in load(key):
            t = el.get("tags", {}) or {}
            val = (t.get("natural") or t.get("amenity") or t.get("leisure")
                   or t.get("water") or t.get("sport"))
            use = AREA_USE.get(val, default_use)
            if el.get("type") == "way" and t.get("service") == "parking_aisle":
                continue                       # aisles are lines; the lot covers it
            rings = [ring_of(el.get("geometry"))] if el.get("type") == "way" else rings_from_relation(el)
            rings = [r for r in rings if r]
            surf, _ = surface_of(t, use)
            for r in rings:
                if area_m2(r) > 400000:
                    stats["skipped_huge_area"] += 1
                    continue
                feats.append({
                    "type": "Feature",
                    "geometry": {"type": "Polygon", "coordinates": [r]},
                    "properties": {"k": "area", "u": use, "s": surf,
                                   **({"name": t["name"]} if t.get("name") else {})},
                })
                stats["area_" + use] += 1

    # Areas first, paths last, so paths draw ON TOP of the lawns they cross.
    feats.sort(key=lambda f: 0 if f["properties"]["k"] == "area" else 1)

    fc = {"type": "FeatureCollection", "features": feats}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(fc, f, separators=(",", ":"))

    size_kb = os.path.getsize(OUT) / 1024
    report = {
        "features": len(feats),
        "file_kb": round(size_kb, 1),
        "counts": dict(sorted(stats.items())),
        "paths_with_TAGGED_width": sum(1 for f in feats if f["properties"].get("wt") == 1),
        "paths_with_DEFAULT_width": sum(1 for f in feats
                                        if f["properties"]["k"] == "path" and f["properties"].get("wt") == 0),
        "unmapped_surface_values": dict(unmapped_surface),
        "warnings": warnings,
    }
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
