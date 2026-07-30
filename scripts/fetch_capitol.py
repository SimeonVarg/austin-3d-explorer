# -*- coding: utf-8 -*-
"""Fetch the OSM source data for the Texas Capitol Complex, south of the
existing modelled area.

WHY THIS EXISTS. scripts/config.sh models 30.276..30.296 — its south edge cuts
through the Capitol Complex about a block north of the Capitol grounds. So the
scene contains the *back* of the complex (the Bullock, the Bush and Jordan
buildings, the Travis and Stephen F. Austin buildings) and then stops dead in a
flat plain exactly where the Texas Capitol, its 22 acres of grounds and the
Governor's Mansion should be. This fetches the missing strip.

Everything here is a CACHE step. It writes one raw file and never interprets it;
scripts/bake_capitol.py is what turns it into render-ready geometry. Re-running
is safe and idempotent — pass --force to bypass the cache.

  data/osm_cache/capitol_area.json    raw Overpass response, with geometry

Usage:  python scripts/fetch_capitol.py [--force]
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "data", "osm_cache")
OUT = os.path.join(CACHE, "capitol_area.json")

# The strip south of scripts/config.sh's BBOX_MIN_LAT (30.276), across the same
# longitude span so the two areas join without a seam. The south edge at
# 30.2685 clears 10th Street, which puts the whole Capitol square (11th to
# Martin Luther King) and the Governor's Mansion block inside.
S, W, N, E = 30.2685, -97.7520, 30.2762, -97.7260

# overpass-api.de rate-limits and 504s under load; the kumi mirror has been the
# reliable one from this machine. Try both, slowly, rather than hammering one.
ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]

BBOX = "%f,%f,%f,%f" % (S, W, N, E)

# One query for everything, because each round trip is a rate-limit risk.
#   building / building:part  the massing
#   natural=tree              the Capitol grounds' live oaks and pecans
#   the ground set            grounds, walks, drives, parking — same tag
#                             vocabulary scripts/bake_ground.py already reads
#   historic / tourism=artwork the monuments on the south lawn
QUERY = """[out:json][timeout:180];
(
  way[building](%(b)s);
  relation[building](%(b)s);
  way["building:part"](%(b)s);
  relation["building:part"](%(b)s);
  node[natural=tree](%(b)s);
  way[leisure](%(b)s);
  way[landuse](%(b)s);
  way[natural](%(b)s);
  way[amenity=parking](%(b)s);
  way[highway=footway](%(b)s);
  way[highway=path](%(b)s);
  way[highway=steps](%(b)s);
  way[highway=pedestrian](%(b)s);
  way[highway=service](%(b)s);
  way["area:highway"](%(b)s);
  node[historic](%(b)s);
  way[historic](%(b)s);
  node[tourism=artwork](%(b)s);
  node[memorial](%(b)s);
);
out tags geom;
""" % {"b": BBOX}
# Two traps, both of which cost a 600 s round trip of retries on a 400:
#   * `out` takes verbosity BEFORE geometry — `out tags geom`, never `out geom
#     tags`. The reversed form is a syntax error, not a warning.
#   * a tag key containing a colon must be quoted: `way["area:highway"]`.


def overpass(query):
    body = urllib.parse.urlencode({"data": query}).encode("utf-8")
    last = None
    # Two passes over the mirrors, with a real backoff. A 504 here means the
    # server is busy, not that the query is wrong — retrying works.
    for attempt in range(2):
        for ep in ENDPOINTS:
            try:
                sys.stderr.write("  querying %s ...\n" % ep)
                req = urllib.request.Request(
                    ep, data=body,
                    headers={"User-Agent": "austin-3d-explorer/0.1 (capitol complex)"})
                with urllib.request.urlopen(req, timeout=300) as resp:
                    return json.load(resp)
            except urllib.error.HTTPError as e:
                # 400 is a malformed query. Every mirror will reject it
                # identically, so failing fast beats six minutes of backoff.
                if e.code == 400:
                    raise RuntimeError(
                        "Overpass rejected the query (400). Read the QL error "
                        "above; retrying mirrors will not help.") from e
                last = e
                sys.stderr.write("    failed: %s\n" % e)
                time.sleep(8 + attempt * 20)
            except Exception as e:  # noqa: BLE001
                last = e
                sys.stderr.write("    failed: %s\n" % e)
                time.sleep(8 + attempt * 20)
    raise last


def main():
    force = "--force" in sys.argv
    os.makedirs(CACHE, exist_ok=True)
    if os.path.exists(OUT) and not force:
        n = len(json.load(open(OUT, encoding="utf-8"))["elements"])
        print("cached: %s (%d elements). --force to refetch." % (OUT, n))
        return

    data = overpass(QUERY)
    els = data.get("elements", [])
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(data, fh)

    kinds = {}
    for e in els:
        t = e.get("tags", {})
        for k in ("building", "building:part", "natural", "leisure", "landuse",
                  "highway", "historic", "amenity", "memorial", "tourism"):
            if k in t:
                kinds[k] = kinds.get(k, 0) + 1
                break
    print(json.dumps({
        "bbox": {"s": S, "w": W, "n": N, "e": E},
        "elements": len(els),
        "by_tag": dict(sorted(kinds.items(), key=lambda kv: -kv[1])),
        "file_kb": round(os.path.getsize(OUT) / 1024, 1),
    }, indent=2))


if __name__ == "__main__":
    main()
