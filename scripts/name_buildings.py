#!/usr/bin/env python3
"""
name_buildings.py — recover building names already sitting in the OSM cache.

"a lot of buildings without names get names for those."

WHAT IS ACTUALLY RECOVERABLE, measured, so nobody re-runs this hoping for more.
2,069 of the 2,453 buildings carry no name. Every offline source in the repo was
checked — data/osm_cache/*.json, data/building_tags.geojson, data/places.geojson,
and the Overture fields in buildings.enriched.geojson — and the honest total is:

    named building-ish points in data/osm_cache      275
    of those, landing inside an UNNAMED footprint     32
    of those, at or above the 12 m label gate          6

Six. And most of those six are restaurants that js/places.js already labels from
its own storefront pass, so the visible gain is smaller still.

THE REST GENUINELY HAVE NO NAME OFFLINE. The unnamed set breaks down as 514
buildings under 6 m and 1,282 between 6 and 12 m — sheds, garages, houses and
West Campus infill that OSM has never named and that the label gate excludes
anyway. The ~273 unnamed buildings above 12 m are mostly West Campus apartment
blocks, and the ones that HAVE a name are already labelled through
data/places.geojson (Pointe on Rio, 2400 Nueces, Callaway House all appear in
renders today). Naming the remainder needs a live Overpass fetch, which is a
network pass, not this one.

Written to data/building_names.json rather than into the snapshot, because a
re-bake would silently wipe an edit to buildings.detailed.geojson — the same trap
HANDOFF records for hand-edited generated files. js/app.js applies it at load.

    python scripts/name_buildings.py [--dry]
"""
import glob
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
DRY = "--dry" in sys.argv
OUT = os.path.join(DATA, "building_names.json")


def rings(g):
    t = g.get("type")
    if t == "Polygon":
        return g["coordinates"]
    if t == "MultiPolygon":
        return [r for poly in g["coordinates"] for r in poly]
    return []


def inside(pt, ring):
    x, y = pt
    c = False
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i][:2]
        x2, y2 = ring[(i + 1) % n][:2]
        if ((y1 > y) != (y2 > y)) and (x < (x2 - x1) * (y - y1) / ((y2 - y1) or 1e-12) + x1):
            c = not c
    return c


def main():
    cands = {}
    for p in glob.glob(os.path.join(DATA, "osm_cache", "*.json")):
        try:
            d = json.load(open(p, encoding="utf-8"))
        except Exception:
            continue
        els = d.get("elements") if isinstance(d, dict) else (d if isinstance(d, list) else [])
        if not isinstance(els, list):
            continue
        for e in els:
            if not isinstance(e, dict):
                continue
            t = e.get("tags") or {}
            nm = t.get("name")
            if not nm:
                continue
            # A name on its own is not a building name — a bench and a bike rack
            # both carry one. Require something structural.
            if not (t.get("building") or t.get("amenity") or t.get("office")):
                continue
            lon = e.get("lon") or (e.get("center") or {}).get("lon")
            lat = e.get("lat") or (e.get("center") or {}).get("lat")
            if lon is None or lat is None:
                continue
            cands[(lon, lat)] = nm

    snap = os.path.join(DATA, "snapshots")
    latest = sorted(d for d in os.listdir(snap) if os.path.isdir(os.path.join(snap, d)))[-1]
    B = json.load(open(os.path.join(snap, latest, "buildings.detailed.geojson"),
                       encoding="utf-8"))["features"]
    unnamed = [f for f in B if not f["properties"].get("name")]

    grid = {}
    for f in unnamed:
        for r in rings(f["geometry"]):
            los = [p[0] for p in r]
            las = [p[1] for p in r]
            for gx in range(int(min(los) * 2000), int(max(los) * 2000) + 1):
                for gy in range(int(min(las) * 2000), int(max(las) * 2000) + 1):
                    grid.setdefault((gx, gy), []).append(f)

    found = {}
    for (lon, lat), nm in cands.items():
        for f in grid.get((int(lon * 2000), int(lat * 2000)), []):
            if any(inside((lon, lat), r) for r in rings(f["geometry"])):
                bid = f["properties"]["id"]
                if bid not in found:
                    found[bid] = nm
                break

    print("unnamed buildings: %d" % len(unnamed))
    print("named building-ish points in the OSM cache: %d" % len(cands))
    print("names recovered: %d" % len(found))
    if not DRY:
        with open(OUT, "w", encoding="utf-8") as fh:
            json.dump(found, fh, indent=1, sort_keys=True, ensure_ascii=False)
        print("  wrote %s" % os.path.relpath(OUT, ROOT))


main()
