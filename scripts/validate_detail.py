# -*- coding: utf-8 -*-
"""Sanity-check raw Overpass counts and validate the emitted GeoJSON files."""
import json
import urllib.parse
import urllib.request

BBOX = "30.276,-97.752,30.296,-97.726"
DATA_DIR = "C:/Users/simip/Projects/austin-3d-explorer/data"


def overpass(query, ep="https://overpass-api.de/api/interpreter"):
    body = urllib.parse.urlencode({"data": query}).encode("utf-8")
    req = urllib.request.Request(
        ep, data=body,
        headers={"User-Agent": "austin-3d-explorer/0.1 (contact: local dev)"})
    with urllib.request.urlopen(req, timeout=180) as resp:
        return json.load(resp)


q = """
[out:json][timeout:60];
(
  way["building:part"]({bbox});
  relation["building:part"]({bbox});
);
out count;
""".format(bbox=BBOX)
d = overpass(q)
print("raw building:part elements in bbox:", d["elements"][0]["tags"])

q2 = """
[out:json][timeout:60];
(
  way["building"]["building:colour"]({bbox});
  way["building"]["building:material"]({bbox});
  way["building"]["roof:colour"]({bbox});
  way["building"]["roof:shape"]({bbox});
  relation["building"]["building:colour"]({bbox});
  relation["building"]["building:material"]({bbox});
  relation["building"]["roof:colour"]({bbox});
  relation["building"]["roof:shape"]({bbox});
);
out count;
""".format(bbox=BBOX)
d2 = overpass(q2)
print("raw tagged-building elements in bbox:", d2["elements"][0]["tags"])

print()
for name in ("parts.geojson", "building_tags.geojson"):
    path = DATA_DIR + "/" + name
    with open(path) as f:
        fc = json.load(f)
    feats = fc["features"]
    print("=== %s: %d features ===" % (name, len(feats)))
    # structural checks
    bad_rings = 0
    for ft in feats:
        g = ft["geometry"]
        if g["type"] == "Polygon":
            for ring in g["coordinates"]:
                if ring[0] != ring[-1] or len(ring) < 4:
                    bad_rings += 1
        elif g["type"] == "MultiPolygon":
            for poly in g["coordinates"]:
                for ring in poly:
                    if ring[0] != ring[-1] or len(ring) < 4:
                        bad_rings += 1
        elif g["type"] == "Point":
            lon, lat = g["coordinates"]
            if not (-97.76 < lon < -97.72 and 30.27 < lat < 30.30):
                bad_rings += 1
    print("unclosed/short rings or out-of-bbox points:", bad_rings)
    for ft in feats[:2]:
        g = ft["geometry"]
        preview = dict(ft)
        if g["type"] != "Point":
            preview = {
                "type": "Feature",
                "geometry": {"type": g["type"],
                             "coordinates": "<%d ring(s), first ring %d pts, first pt %s>" % (
                                 len(g["coordinates"]),
                                 len(g["coordinates"][0]) if g["type"] == "Polygon" else len(g["coordinates"][0][0]),
                                 g["coordinates"][0][0] if g["type"] == "Polygon" else g["coordinates"][0][0][0])},
                "properties": ft["properties"],
            }
        print(json.dumps(preview, indent=1))
    print()

with open(DATA_DIR + "/parts.geojson") as f:
    fc = json.load(f)
n_min = sum(1 for ft in fc["features"] if ft["properties"]["min_height_m"] > 0)
n_h = sum(1 for ft in fc["features"] if ft["properties"]["height_m"] is not None)
print("parts with min_height_m>0:", n_min, "| parts with height_m set:", n_h)
