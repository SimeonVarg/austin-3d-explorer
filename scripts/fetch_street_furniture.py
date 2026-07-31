# -*- coding: utf-8 -*-
"""Fetch every kind of street furniture OSM actually holds in the bbox — not
just the five kinds the first pass asked for.

survey_ground.py's `furniture` query asked for bench / waste_basket /
drinking_water / bicycle_parking / street_lamp and nothing else. That is why
data/props.geojson had 453 furniture features for an entire university: most of
what is really on a campus was never requested. This asks for the rest —
bollards, bus shelters and stops, bike share docks, picnic tables, planters,
flagpoles, emergency phones, information boards, post boxes, hedges — and
caches each response separately under data/osm_cache/ like the original survey.

Nothing here invents anything. It is a wider question to the same source.

Usage:  python scripts/fetch_street_furniture.py [--refresh]
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request

BBOX = "30.276,-97.752,30.296,-97.726"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "data", "osm_cache")

MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]

QUERIES = {
    # Things that stop cars and guide people. Bollards line every campus mall.
    "furn_barrier": '(node["barrier"~"^(bollard|gate|lift_gate|cycle_barrier|block|kerb)$"]({b});'
                    'way["barrier"~"^(bollard|hedge|fence|wall|handrail)$"]({b});)',
    # Transit: CapMetro stops, shelters, and the UT shuttle.
    "furn_transit": '(node["highway"="bus_stop"]({b});node["public_transport"="platform"]({b});'
                    'way["public_transport"="platform"]({b});node["amenity"="shelter"]({b});'
                    'way["amenity"="shelter"]({b});node["amenity"="bicycle_rental"]({b});'
                    'way["amenity"="bicycle_rental"]({b});node["amenity"="car_sharing"]({b});)',
    # Sitting, eating, drinking, charging — the things people stop at.
    "furn_seating": '(node["amenity"~"^(picnic_table|bbq|charging_station|vending_machine|'
                    'parking_meter|post_box|telephone|atm|toilets|bicycle_repair_station)$"]({b});'
                    'way["amenity"~"^(picnic_table|shelter|toilets)$"]({b});'
                    'node["leisure"~"^(picnic_table|fitness_station|outdoor_seating)$"]({b});'
                    'way["leisure"~"^(garden|outdoor_seating)$"]({b});)',
    # Vertical punctuation: flagpoles, poles, masts, signs, information boards.
    "furn_vertical": '(node["man_made"~"^(flagpole|mast|utility_pole|street_cabinet|monitoring_station|'
                     'surveillance)$"]({b});way["man_made"="flagpole"]({b});'
                     'node["tourism"="information"]({b});way["tourism"="information"]({b});'
                     'node["emergency"~"^(phone|siren|fire_hydrant|defibrillator)$"]({b});'
                     'node["advertising"~"^(column|board|billboard)$"]({b});'
                     'node["highway"~"^(street_lamp|traffic_signals)$"]({b});)',
    # Planted structure: planters, hedges, flower beds, and mapped tree rows.
    "furn_planting": '(node["amenity"="planter"]({b});way["amenity"="planter"]({b});'
                     'way["barrier"="hedge"]({b});way["natural"="tree_row"]({b});'
                     'way["landuse"="flowerbed"]({b});way["leisure"="garden"]({b});)',
}


def fetch(body, tries=8):
    """Same politeness contract as survey_ground.fetch — Overpass punishes loops."""
    q = "[out:json][timeout:120];%s;\nout body geom;" % body.format(b=BBOX)
    payload = urllib.parse.urlencode({"data": q}).encode()
    last = None
    for attempt in range(tries):
        url = MIRRORS[attempt % len(MIRRORS)]
        try:
            req = urllib.request.Request(url, data=payload, headers={
                "User-Agent": "austin-3d-explorer/1.0 (educational low-poly map)"})
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.loads(r.read().decode())
        except Exception as e:                                    # noqa: BLE001
            code = getattr(e, "code", None)
            last = "%s: %s" % (type(e).__name__, e)
            sys.stderr.write("  attempt %d (%s) failed: %s\n"
                             % (attempt + 1, url.split("/")[2], last))
            if attempt < tries - 1:
                time.sleep(45 if code == 429 else min(90, 10 * (attempt + 1)))
    raise RuntimeError("all attempts failed: %s" % last)


def main():
    refresh = "--refresh" in sys.argv
    os.makedirs(CACHE, exist_ok=True)
    report = {}
    for key, body in QUERIES.items():
        path = os.path.join(CACHE, key + ".json")
        if os.path.exists(path) and not refresh:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
            src = "cached"
        else:
            sys.stderr.write("fetching %s...\n" % key)
            data = fetch(body)
            with open(path, "w", encoding="utf-8") as f:
                json.dump(data, f, separators=(",", ":"))
            src = "fetched"
            time.sleep(12)
        els = data.get("elements", [])
        tally = {}
        for el in els:
            t = el.get("tags", {}) or {}
            for k in ("amenity", "barrier", "highway", "man_made", "public_transport",
                      "tourism", "emergency", "advertising", "leisure", "natural", "landuse"):
                if k in t:
                    tally.setdefault(k, {}).setdefault(t[k], 0)
                    tally[k][t[k]] += 1
        report[key] = {"source": src, "elements": len(els), "tags": tally}
        print("%-16s %-8s %5d elements" % (key, src, len(els)))
        for k, vals in sorted(tally.items()):
            top = sorted(vals.items(), key=lambda kv: -kv[1])[:14]
            print("    %-14s %s" % (k, ", ".join("%s=%d" % (v, n) for v, n in top)))
    with open(os.path.join(CACHE, "_furniture_summary.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, indent=1)


if __name__ == "__main__":
    main()
