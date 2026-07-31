#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Fetch the OSM tag layer for the outer ring, and cache it COMPACTLY.

Overture is the geometry source for the outer ring (scripts/extract_outer.py),
and for most of the box it is also a fine height source. It is not enough on its
own for two reasons, both measured against this exact extract:

  1. 95% of the 47,238 footprints come back with `class = NULL`, so there is
     almost no material signal - every house, church, warehouse and parking
     deck would wear the same tone. OSM's `building=*` value is populated for
     ~2,300 of them and is exactly the distinction that matters from the air.

  2. Overture's LiDAR heights are WRONG for several downtown towers, and wrong
     in the worst possible direction - they return the podium. Sixth and
     Guadalupe, the tallest completed building in Austin at 267 m, comes back
     as 18.7 m. Fairmont Austin 20.6 m against 180. The Northshore 19.9 against
     129. One American Center 24.1 against 102. At flyover altitude a wrong
     height is the ONLY thing anyone can see, so this is not a detail.
     In every one of those cases Overture's own `num_floors` was correct, which
     is what the fallback in scripts/bake_outer.py leans on.

The cache is deliberately not the raw Overpass response: most of the 47,827
elements are a bare `building=yes` with nothing else, and keeping them would put
7 MB of nothing in the repo. Only elements carrying a class, a height, a level
count or a name are kept.

  data/osm_cache/outer_tags.json   [{x, y, b, h, lv, n}, ...]

Usage:  python scripts/fetch_outer_osm.py [--force]
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "osm_cache", "outer_tags.json")

S, W, N, E = 30.2400, -97.7880, 30.3150, -97.7020

ENDPOINTS = [
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
]

QUERY = """[out:json][timeout:240];
(way["building"](%(b)s);
 relation["building"](%(b)s););
out tags center;
""" % {"b": "%f,%f,%f,%f" % (S, W, N, E)}

# `building` values that say nothing a renderer can use.
NOISE = {"yes", "no", None, ""}


def fetch():
    last = None
    for ep in ENDPOINTS:
        try:
            req = urllib.request.Request(
                ep, data=b"data=" + urllib.parse.quote(QUERY).encode(),
                headers={"Content-Type": "application/x-www-form-urlencoded"})
            with urllib.request.urlopen(req, timeout=420) as r:
                return json.load(r)
        except Exception as exc:  # noqa: BLE001
            print(f"  {ep} failed: {exc}", file=sys.stderr)
            last = exc
            time.sleep(4)
    raise SystemExit(f"every Overpass endpoint failed: {last}")


def num(v):
    try:
        return float(str(v).split()[0])
    except Exception:  # noqa: BLE001
        return None


def main():
    if os.path.exists(OUT) and "--force" not in sys.argv:
        print(f"{OUT} exists; pass --force to refetch")
        return
    data = fetch()
    els = data.get("elements", [])
    rows = []
    for e in els:
        c = e.get("center") or {}
        if "lat" not in c:
            continue
        t = e.get("tags", {})
        b = t.get("building")
        h = num(t.get("height")) or num(t.get("building:height"))
        lv = num(t.get("building:levels"))
        n = t.get("name")
        if (b in NOISE) and h is None and lv is None and not n:
            continue
        row = {"x": round(c["lon"], 6), "y": round(c["lat"], 6)}
        if b not in NOISE:
            row["b"] = b
        if h is not None:
            row["h"] = round(h, 1)
        if lv is not None:
            row["lv"] = lv
        if n:
            row["n"] = n
        rows.append(row)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(rows, f, separators=(",", ":"))
    print(f"{len(els)} OSM buildings -> {len(rows)} with a usable tag "
          f"-> {OUT} ({os.path.getsize(OUT) // 1024} KB)")


if __name__ == "__main__":
    main()
