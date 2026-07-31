# -*- coding: utf-8 -*-
"""Fetch the City of Austin's OWN inventories of ground furniture — the ones
that are not in OpenStreetMap and were not being used.

WHAT THIS ADDS, and why it matters more than the count suggests. Bike racks were
the single biggest procedural guess in scripts/bake_props.py: "the façade vertex
nearest a real path" is a reasonable rule, but it is still a rule. The city
surveys its own racks, with a TYPE and a CAPACITY each, and 335 of them fall in
this bbox. Those are FACTS, and a fact beats a good rule every time.

  Bike_Parking_VL   ArcGIS FeatureServer, City of Austin Transportation.
                    335 racks in the bbox. TYPE ('U-Shaped', 'Staple', corral…),
                    CAPACITY, NUMBER_OF_ASSETS, ROW_LOCATION.
  bcycle_kiosks     21 MetroBike (formerly B-cycle) docking stations, with
                    NUMBER_OF_DOCKS — which sets how long the dock run is drawn.
  uuk6-933w         City of Austin Public Art Collection (Socrata). 328 pieces
                    city-wide, 4 of them inside this bbox, each with a real
                    title and artist. UT's own Landmarks collection comes from
                    OSM and is separate.

CHECKED AND NOT AVAILABLE, so nobody repeats the search: the city publishes no
bench, bin, planter or street-lamp inventory (searched the Socrata catalogue for
"street furniture", "bench", "light pole" — zero results), and UT's campus GIS
(maps.utexas.edu/data/utm.json) is building footprints only. Everything else on
the ground comes from OSM or from a rule.

Usage:  python scripts/fetch_city_props.py [--refresh]
"""
import json
import os
import sys
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "data", "osm_cache")
BBOX = (-97.752, 30.276, -97.726, 30.296)          # W, S, E, N
UA = {"User-Agent": "austin-3d-explorer/1.0 (educational low-poly map)"}

ARCGIS = ("https://services.arcgis.com/0L95CJ0VTaxqcmED/ArcGIS/rest/services/"
          "%s/FeatureServer/0/query")
SOCRATA_ART = "https://data.austintexas.gov/resource/uuk6-933w.json"

# cache key -> ArcGIS service name
LAYERS = {
    "city_bike_parking": "Bike_Parking_VL",
    "city_bikeshare": "bcycle_kiosks",
}


def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=90).read().decode()


def fetch_arcgis(service):
    p = {"where": "1=1",
         "geometry": ",".join(str(v) for v in BBOX),
         "geometryType": "esriGeometryEnvelope", "inSR": "4326",
         "spatialRel": "esriSpatialRelIntersects", "outFields": "*",
         "returnGeometry": "true", "outSR": "4326", "f": "json",
         "resultRecordCount": "4000"}
    d = json.loads(get(ARCGIS % service + "?" + urllib.parse.urlencode(p)))
    if "error" in d:
        raise RuntimeError(d["error"].get("message", "arcgis error"))
    out = []
    for f in d.get("features", []):
        g = f.get("geometry") or {}
        if g.get("x") is None or g.get("y") is None:
            continue
        out.append({"lon": round(float(g["x"]), 6), "lat": round(float(g["y"]), 6),
                    "attrs": f.get("attributes", {})})
    return out


def fetch_art():
    rows = json.loads(get(SOCRATA_ART + "?$limit=5000"))
    w, s, e, n = BBOX
    out = []
    for r in rows:
        try:
            lon = float(r.get("location_longitude"))
            lat = float(r.get("location_latitude"))
        except (TypeError, ValueError):
            continue
        if not (w <= lon <= e and s <= lat <= n):
            continue
        out.append({"lon": round(lon, 6), "lat": round(lat, 6),
                    "name": (r.get("artwork_title") or "").strip().strip('"'),
                    "artist": " ".join((r.get("artist") or "").split()),
                    "material": r.get("material", "")})
    return out


def main():
    refresh = "--refresh" in sys.argv
    os.makedirs(CACHE, exist_ok=True)
    report = {}
    jobs = [(k, lambda s=v: fetch_arcgis(s)) for k, v in LAYERS.items()]
    jobs.append(("city_art", fetch_art))
    for key, fn in jobs:
        path = os.path.join(CACHE, key + ".json")
        if os.path.exists(path) and not refresh:
            with open(path, encoding="utf-8") as f:
                rows = json.load(f)
            src = "cached"
        else:
            sys.stderr.write("fetching %s...\n" % key)
            try:
                rows = fn()
            except Exception as e:                                # noqa: BLE001
                sys.stderr.write("  FAILED: %s\n" % e)
                report[key] = {"source": "failed", "rows": 0, "error": str(e)}
                continue
            with open(path, "w", encoding="utf-8") as f:
                json.dump(rows, f, separators=(",", ":"))
            src = "fetched"
        report[key] = {"source": src, "rows": len(rows)}
        print("%-20s %-8s %4d rows" % (key, src, len(rows)))
        if rows and "attrs" in rows[0]:
            tally = {}
            for r in rows:
                t = r["attrs"].get("TYPE") or r["attrs"].get("KIOSK_STATUS") or "?"
                tally[t] = tally.get(t, 0) + 1
            report[key]["kinds"] = tally
            print("    ", ", ".join("%s=%d" % kv for kv in sorted(tally.items(), key=lambda kv: -kv[1])[:10]))
    print(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
