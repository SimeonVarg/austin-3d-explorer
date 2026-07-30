# -*- coding: utf-8 -*-
"""Fill data/imagery_cache with the z19 nadir tiles bake_roofs.py needs.

WHY THIS EXISTS. `bake_roofs.py` decides WHICH buildings get a pitched roof by
reading terracotta tile off aerial imagery. It reported:

    no_imagery 1933   flat 295   tiled 26

— i.e. 86% of the campus was never scored at all, because the cache only held
the 176 tiles fetched for an unrelated research task (the Union-on-24th block).
Every unscored building silently fell through to a flat prism. The roofs did not
look flat because the rule was wrong; they looked flat because the rule was
never run on them.

The tile set is derived from the building footprints themselves, so this fetches
what the scene actually contains and nothing else. Tiles are cached under the
same `z_x_y.jpg` name `bake_roofs.py`/`probe_roofs.py` already read, and the
cache is gitignored — it is regenerable, and the imagery is reference input to a
bake, never shipped.

Usage:  python scripts/fetch_roof_imagery.py [--zoom 19] [--workers 8]
"""
import argparse
import io
import math
import json
import os
import sys
import threading
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SNAP = os.path.join(ROOT, "data", "snapshots", "2026-07-30", "buildings.detailed.geojson")
TILES = os.path.join(ROOT, "data", "imagery_cache")
ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
UA = {"User-Agent": "austin-3d-explorer/1.0 (reference imagery for a roof bake)"}
MIN_H = 4.0          # below this bake_roofs.py skips the building anyway


def tile_xy_f(lon, lat, z):
    n = 2.0 ** z
    return ((lon + 180.0) / 360.0 * n,
            (1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n)


def needed_tiles(z):
    feats = json.load(open(SNAP, encoding="utf-8"))["features"]
    need = set()
    for f in feats:
        if (f["properties"].get("final_height") or 0) < MIN_H:
            continue
        g = f["geometry"]
        rings = [g["coordinates"][0]] if g["type"] == "Polygon" else [p[0] for p in g["coordinates"]]
        for r in rings:
            lons = [p[0] for p in r]
            lats = [p[1] for p in r]
            x0, y0 = tile_xy_f(min(lons), max(lats), z)
            x1, y1 = tile_xy_f(max(lons), min(lats), z)
            for xt in range(int(x0), int(x1) + 1):
                for yt in range(int(y0), int(y1) + 1):
                    need.add((xt, yt))
    return sorted(need)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zoom", type=int, default=19)
    ap.add_argument("--workers", type=int, default=8)
    a = ap.parse_args()
    os.makedirs(TILES, exist_ok=True)

    want = needed_tiles(a.zoom)
    todo = [t for t in want
            if not os.path.exists(os.path.join(TILES, "%d_%d_%d.jpg" % (a.zoom, t[0], t[1])))]
    print("tiles needed %d, already cached %d, fetching %d"
          % (len(want), len(want) - len(todo), len(todo)), flush=True)

    lock = threading.Lock()
    state = {"ok": 0, "fail": 0}

    def get(t):
        xt, yt = t
        path = os.path.join(TILES, "%d_%d_%d.jpg" % (a.zoom, xt, yt))
        try:
            req = urllib.request.Request(ESRI.format(z=a.zoom, y=yt, x=xt), headers=UA)
            with urllib.request.urlopen(req, timeout=30) as r:
                body = r.read()
            if len(body) > 500:
                Image.open(io.BytesIO(body)).convert("RGB").save(path, quality=92)
                with lock:
                    state["ok"] += 1
                    n = state["ok"] + state["fail"]
                if n % 200 == 0:
                    print("  %d/%d" % (n, len(todo)), flush=True)
                return
        except Exception:
            pass
        with lock:
            state["fail"] += 1

    with ThreadPoolExecutor(max_workers=a.workers) as ex:
        list(ex.map(get, todo))

    print(json.dumps({"zoom": a.zoom, "fetched": state["ok"], "failed": state["fail"],
                      "cache_tiles": len([f for f in os.listdir(TILES)
                                          if f.startswith("%d_" % a.zoom)])}, indent=2))


if __name__ == "__main__":
    main()
