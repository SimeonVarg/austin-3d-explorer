# -*- coding: utf-8 -*-
"""Survey what OSM actually holds for GROUND detail in the UT campus bbox, and
cache every raw response under data/osm_cache/ so the rest of the pipeline never
depends on Overpass being up twice.

This exists because the ground pass must be TRUE: we only draw what we can
source. Knowing the real inventory (and its gaps) before designing any render is
the whole point — see VISUAL_REFERENCE_PLAYBOOK rule 1.

Usage:  python scripts/survey_ground.py [--refresh]
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BBOX = "30.276,-97.752,30.296,-97.726"          # the app's full data bbox
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "data", "osm_cache")

MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]

# Each entry: (cache_key, overpass body). Kept as separate small queries rather
# than one giant one: a single 180 s query that times out loses everything,
# whereas these each cache independently and can be re-run piecemeal.
QUERIES = {
    # Paths people actually walk, plus their surface/width where tagged.
    "footways": '(way["highway"~"^(footway|path|steps|pedestrian|cycleway)$"]({b});)',
    # Plazas, squares and shared-surface areas (area:highway / highway=pedestrian
    # with area=yes are how plazas get mapped).
    "plazas": '(way["area:highway"]({b});way["highway"="pedestrian"]["area"="yes"]({b});'
              'relation["highway"="pedestrian"]["area"="yes"]({b});)',
    # What the ground IS: lawn, scrub, wood, parking, school grounds…
    "landuse": '(way["landuse"]({b});relation["landuse"]({b});'
               'way["natural"~"^(grassland|scrub|wood|water|sand)$"]({b});'
               'relation["natural"~"^(grassland|scrub|wood|water)$"]({b});'
               'way["leisure"~"^(park|garden|pitch|track|playground|common)$"]({b});'
               'relation["leisure"~"^(park|garden|pitch|track|playground)$"]({b});)',
    # Any explicit surface tag on an area — limestone/brick/asphalt/concrete.
    "surfaces": '(way["surface"]({b});relation["surface"]({b});)',
    # Trees: individual nodes carry species/height/crown where surveyed.
    "trees": '(node["natural"="tree"]({b});way["natural"="tree_row"]({b});)',
    # Public art — the Landmarks collection (Monochrome for Austin, Clock Knot).
    "artwork": '(node["tourism"="artwork"]({b});way["tourism"="artwork"]({b});'
               'node["historic"="memorial"]({b});way["historic"="memorial"]({b});)',
    # Street furniture and scale-givers: benches, lamps, bins, bike parking.
    "furniture": '(node["amenity"~"^(bench|waste_basket|drinking_water|bicycle_parking)$"]({b});'
                 'node["highway"="street_lamp"]({b});way["amenity"="bicycle_parking"]({b});)',
    # Food: carts, trailers, cafes, fast food — half of what makes this Austin.
    "food": '(node["amenity"~"^(fast_food|cafe|restaurant|ice_cream)$"]({b});'
            'way["amenity"~"^(fast_food|cafe|restaurant)$"]({b});)',
    # Construction, current: sites, fenced areas, cranes.
    "construction": '(way["landuse"="construction"]({b});way["building"="construction"]({b});'
                    'way["highway"="construction"]({b});node["man_made"="crane"]({b});'
                    'way["barrier"="fence"]({b});)',
    # Parking: lots (areas) and aisles, so cars can sit where cars actually sit.
    "parking": '(way["amenity"="parking"]({b});relation["amenity"="parking"]({b});'
               'way["service"="parking_aisle"]({b});)',
    # Water features and fountains.
    "water": '(way["natural"="water"]({b});way["amenity"="fountain"]({b});'
             'way["water"]({b});relation["natural"="water"]({b});)',
    # Sports: running tracks and field markings live here.
    "sport": '(way["leisure"="track"]({b});way["sport"]({b});relation["leisure"="track"]({b});)',
    # Roof shape/height/angle/direction wherever tagged, for the roof question.
    "roofs": '(way["building"]["roof:shape"]({b});relation["building"]["roof:shape"]({b});'
             'way["building"]["roof:height"]({b});way["building"]["roof:angle"]({b});'
             'way["building"]["roof:direction"]({b});way["building"]["roof:orientation"]({b});)',
    # Steps and retaining walls give vertical relief on the malls.
    "relief": '(way["highway"="steps"]({b});way["barrier"="retaining_wall"]({b});'
              'way["man_made"="embankment"]({b});way["barrier"="wall"]({b});)',
}


def fetch(body, tries=8):
    """One cached query, politely.

    Overpass is a shared free service and it WILL punish a tight loop: running
    these queries back to back earned 429 Too Many Requests, then a cascade of
    504s across every mirror that looks exactly like the network being down.
    So: rotate mirrors, back off hard, and back off much harder on an explicit
    429 (that one is the server asking for a rest, not a failure).
    """
    # NOTE the ';' after the union group — Overpass answers 400 Bad Request
    # without it, on every mirror, which reads exactly like a network problem.
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
        except Exception as e:                                   # noqa: BLE001
            code = getattr(e, "code", None)
            last = "%s: %s" % (type(e).__name__, e)
            sys.stderr.write("  attempt %d (%s) failed: %s\n" % (attempt + 1, url.split("/")[2], last))
            if attempt < tries - 1:
                time.sleep(45 if code == 429 else min(90, 10 * (attempt + 1)))
    raise RuntimeError("all attempts failed: %s" % last)


def main():
    refresh = "--refresh" in sys.argv
    os.makedirs(CACHE, exist_ok=True)
    summary = {}
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
            time.sleep(12)      # be a good citizen between queries
        els = data.get("elements", [])
        # Tally the tag values that decide how a thing gets drawn.
        tally = {}
        for el in els:
            t = el.get("tags", {}) or {}
            for k in ("highway", "landuse", "natural", "leisure", "surface", "amenity",
                      "tourism", "roof:shape", "barrier", "man_made", "sport", "historic"):
                if k in t:
                    tally.setdefault(k, {}).setdefault(t[k], 0)
                    tally[k][t[k]] += 1
        summary[key] = {"source": src, "elements": len(els), "tags": tally}
        print("%-14s %-8s %5d elements" % (key, src, len(els)))
        for k, vals in sorted(tally.items()):
            top = sorted(vals.items(), key=lambda kv: -kv[1])[:12]
            print("    %-12s %s" % (k, ", ".join("%s=%d" % (v, n) for v, n in top)))
    with open(os.path.join(CACHE, "_summary.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=1)


if __name__ == "__main__":
    main()
