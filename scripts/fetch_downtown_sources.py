#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""fetch_downtown_sources.py -- the public reference data for downtown Austin.

Downtown is measured against outside sources (scripts/verify/downtown-accuracy.py)
and its buildings are generated from them (scripts/bake_downtown_massing.py).
This script fetches those sources and writes them COMPACT, one file each:

    data/osm_cache/downtown_buildings.json   OpenStreetMap building outlines + tags
    data/osm_cache/downtown_pois.json        OpenStreetMap shops, bars, hotels, doors
    data/outer/downtown_city_structures.json City of Austin structure outlines (2023)
    data/outer/downtown_districts.json       the City's nine downtown plan districts

SOURCES AND LICENCES
    OpenStreetMap, (c) OpenStreetMap contributors, ODbL 1.0. Fetched through the
        public Overpass API. The app already credits OpenStreetMap.
    City of Austin open data (public ArcGIS FeatureServer, no sign-in):
        impervious_cover_2023, FEATURE = 'Structure': outlines drawn by hand from
        aerial imagery (latest update early 2023), with a photogrammetric
        MAX_HEIGHT in feet. City of Austin open data is public domain (CC0 1.0).
        Downtown_Austin_Plan_Districts: the nine districts of the Downtown Austin
        Plan (Lamar to I-35, the lake to MLK). Their union is "downtown" here.

None of these files is fetched by the app. They are bake inputs.

    Usage:  python scripts/fetch_downtown_sources.py [--raw DIR]
            --raw DIR   read already-downloaded raw responses from DIR instead of
                        the network (osm_buildings.json, osm_pois.json,
                        city_structures_2023.geojson,
                        city_Downtown_Austin_Plan_Districts.geojson)
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request

from shapely.geometry import LineString, Point, Polygon, shape, mapping
from shapely.ops import polygonize, unary_union

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# The frame: the City's downtown districts plus a block of margin on every side.
FRAME = dict(minlon=-97.7590, minlat=30.2555, maxlon=-97.7335, maxlat=30.2815)
FT = 0.3048
# About 120 m: a block of context around the districts, so a building that
# straddles Lamar, MLK or the I-35 frontage is still measured whole.
KEEP_MARGIN_DEG = 0.0012

OVERPASS = "https://overpass-api.de/api/interpreter"
CITY = "https://services.arcgis.com/0L95CJ0VTaxqcmED/ArcGIS/rest/services"
UA = "austin-3d-explorer bake (github.com/SimeonVarg/austin-3d-explorer)"

# Tags that say something about how a building looks or what it is. Addresses,
# phone numbers and opening hours are not kept.
KEEP_TAGS = ("name", "building", "building:part", "height", "min_height",
             "building:levels", "building:min_level", "roof:shape", "roof:levels",
             "start_date", "amenity", "tourism", "shop", "office", "parking",
             "building:material", "building:colour", "roof:colour",
             "roof:material", "wikidata", "wikipedia", "historic", "religion",
             "addr:housenumber", "addr:street", "layer", "location")
POI_TAGS = ("name", "shop", "amenity", "tourism", "office", "entrance", "cuisine",
            "outdoor_seating", "brand")


def bbox_str():
    return "%s,%s,%s,%s" % (FRAME["minlat"], FRAME["minlon"],
                            FRAME["maxlat"], FRAME["maxlon"])


def overpass(query):
    data = urllib.parse.urlencode({"data": query}).encode()
    for attempt in range(5):
        try:
            req = urllib.request.Request(OVERPASS, data=data,
                                         headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=240) as r:
                body = r.read()
            return json.loads(body)
        except Exception as exc:  # noqa: BLE001 -- busy server answers HTML
            print("  overpass retry %d (%s)" % (attempt + 1, exc))
            time.sleep(10 * (attempt + 1))
    sys.exit("overpass did not answer")


def city_layer(service, where="1=1"):
    feats, off = [], 0
    env = dict(geometry="%s,%s,%s,%s" % (FRAME["minlon"], FRAME["minlat"],
                                         FRAME["maxlon"], FRAME["maxlat"]),
               geometryType="esriGeometryEnvelope", inSR=4326,
               spatialRel="esriSpatialRelIntersects", outSR=4326,
               outFields="*", f="geojson", orderByFields="OBJECTID")
    while True:
        q = dict(env, where=where, resultOffset=off, resultRecordCount=1000)
        url = "%s/%s/FeatureServer/0/query?%s" % (CITY, service,
                                                  urllib.parse.urlencode(q))
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=180) as r:
            page = json.loads(r.read()).get("features", [])
        feats += page
        off += len(page)
        if len(page) < 1000:
            return {"type": "FeatureCollection", "features": feats}


def r6(ring):
    """Seven decimals is about a centimetre; OSM stores no more than that."""
    out = [[round(float(x), 7), round(float(y), 7)] for x, y in ring]
    if out and out[0] != out[-1]:
        out.append(out[0])
    return out


def poly_rings(poly):
    return [r6(poly.exterior.coords)] + [r6(i.coords) for i in poly.interiors]


def osm_polygons(el):
    """An OSM way or multipolygon relation -> list of shapely Polygons."""
    if el["type"] == "way":
        pts = [(p["lon"], p["lat"]) for p in el.get("geometry") or []]
        if len(pts) >= 4 and pts[0] == pts[-1]:
            return [Polygon(pts)]
        return []
    outers, inners = [], []
    for m in el.get("members") or []:
        pts = [(p["lon"], p["lat"]) for p in m.get("geometry") or []]
        if len(pts) < 2:
            continue
        (inners if m.get("role") == "inner" else outers).append(LineString(pts))
    polys = list(polygonize(unary_union(outers))) if outers else []
    holes = list(polygonize(unary_union(inners))) if inners else []
    out = []
    for p in polys:
        cut = [h for h in holes if p.contains(h.representative_point())]
        out.append(Polygon(p.exterior.coords, [h.exterior.coords for h in cut]))
    return out


def main():
    raw = None
    if "--raw" in sys.argv:
        raw = sys.argv[sys.argv.index("--raw") + 1]

    def raw_json(name):
        with open(os.path.join(raw, name), encoding="utf-8") as f:
            return json.load(f)

    # ── the downtown districts (first: they decide what else is kept) ──
    dist = raw_json("city_Downtown_Austin_Plan_Districts.geojson") if raw else \
        city_layer("Downtown_Austin_Plan_Districts")
    rows = []
    for ft in dist["features"]:
        g = shape(ft["geometry"]).buffer(0).simplify(0.00001)
        rows.append({"name": ft["properties"]["DOWNTOWN_DISTRICTS"],
                     "g": mapping(g)})
    rows.sort(key=lambda r: r["name"])
    out = os.path.join(ROOT, "data", "outer", "downtown_districts.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"source": "City of Austin open data, "
                             "Downtown_Austin_Plan_Districts (public domain, CC0 1.0)",
                   "rows": rows}, f, separators=(",", ":"))
    print("  %d districts -> %s (%d KB)" % (len(rows), out,
                                            os.path.getsize(out) // 1024))
    # Everything else is kept only where it touches downtown plus KEEP_MARGIN.
    keep = unary_union([shape(r["g"]) for r in rows]).buffer(KEEP_MARGIN_DEG)

    # ── OpenStreetMap buildings ──────────────────────────────────────
    if raw:
        osm = raw_json("osm_buildings.json")
    else:
        b = bbox_str()
        osm = overpass('[out:json][timeout:180];(way["building"](%s);'
                       'relation["building"](%s);way["building:part"](%s);'
                       'relation["building:part"](%s););out tags geom;'
                       % (b, b, b, b))
    rows = []
    for el in osm["elements"]:
        tags = el.get("tags") or {}
        polys = [p.buffer(0) for p in osm_polygons(el)]
        polys = [p for p in polys if p.geom_type == "Polygon" and not p.is_empty
                 and p.intersects(keep)]
        if not polys:
            continue
        t = {k: tags[k] for k in KEEP_TAGS if k in tags}
        for i, p in enumerate(polys):
            rows.append({"id": "%s%d%s" % (el["type"][0], el["id"],
                                           "" if len(polys) == 1 else ".%d" % i),
                         "t": t, "g": poly_rings(p)})
    rows.sort(key=lambda r: r["id"])
    out = os.path.join(ROOT, "data", "osm_cache", "downtown_buildings.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"source": "OpenStreetMap contributors, ODbL 1.0",
                   "fetched": osm.get("osm3s", {}).get("timestamp_osm_base"),
                   "frame": FRAME, "rows": rows}, f, separators=(",", ":"),
                  ensure_ascii=False)
    print("  %d OSM outlines -> %s (%d KB)" % (len(rows), out,
                                               os.path.getsize(out) // 1024))

    # ── OpenStreetMap places at street level ─────────────────────────
    if raw:
        po = raw_json("osm_pois.json")
    else:
        b = bbox_str()
        po = overpass('[out:json][timeout:120];(node["shop"](%s);'
                      'node["amenity"~"restaurant|bar|pub|cafe|fast_food|nightclub'
                      '|bank|theatre|cinema"](%s);'
                      'node["tourism"~"hotel|museum|gallery"](%s);'
                      'node["entrance"](%s);node["office"](%s););out qt;'
                      % (b, b, b, b, b))
    pois = []
    for el in po["elements"]:
        tags = el.get("tags") or {}
        t = {k: tags[k] for k in POI_TAGS if k in tags}
        if t and keep.contains(Point(el["lon"], el["lat"])):
            pois.append({"x": round(el["lon"], 7), "y": round(el["lat"], 7), "t": t})
    pois.sort(key=lambda r: (r["x"], r["y"]))
    out = os.path.join(ROOT, "data", "osm_cache", "downtown_pois.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"source": "OpenStreetMap contributors, ODbL 1.0",
                   "rows": pois}, f, separators=(",", ":"), ensure_ascii=False)
    print("  %d OSM places -> %s (%d KB)" % (len(pois), out,
                                             os.path.getsize(out) // 1024))

    # ── City of Austin structures, 2023 ──────────────────────────────
    city = raw_json("city_structures_2023.geojson") if raw else \
        city_layer("impervious_cover_2023", "FEATURE = 'Structure'")
    rows = []
    for ft in city["features"]:
        p = ft["properties"]
        g = shape(ft["geometry"]).buffer(0)
        parts = [g] if g.geom_type == "Polygon" else list(getattr(g, "geoms", []))
        for q in parts:
            if q.geom_type != "Polygon" or q.is_empty or not q.intersects(keep):
                continue
            rows.append({"o": p["OBJECTID"],
                         "s": (p.get("SOURCE") or "").replace("Imagery ", ""),
                         "h": (round(p["MAX_HEIGHT"] * FT, 1)
                               if p.get("MAX_HEIGHT") else None),
                         "g": poly_rings(q)})
    rows.sort(key=lambda r: (r["o"], r["g"][0][0]))
    out = os.path.join(ROOT, "data", "outer", "downtown_city_structures.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"source": "City of Austin open data, impervious_cover_2023, "
                             "FEATURE='Structure' (public domain, CC0 1.0)",
                   "height": "MAX_HEIGHT, feet converted to metres",
                   "rows": rows}, f, separators=(",", ":"))
    print("  %d City structures -> %s (%d KB)" % (len(rows), out,
                                                  os.path.getsize(out) // 1024))


if __name__ == "__main__":
    main()
