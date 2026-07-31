# -*- coding: utf-8 -*-
"""Sweep the WHOLE app bbox for tree crowns, not just the three patches that
were done by hand.

WHY THIS EXISTS. scripts/detect_canopy.py already reads crowns off nadir aerial
imagery and it works — but it had only ever been pointed at three hand-drawn
rectangles (southmall, corridor, westcampus), all of them west of -97.7375.
East campus — the PCL, the LBJ grounds, Waller Creek, Clark Field, San Jacinto,
the whole athletic precinct — had NO imagery coverage at all, which is the real
reason east campus reads bare: nobody had ever looked there. The City of Austin
inventory does not cover it either (UT is state land, the city surveys city
land) and OSM has almost nothing on it.

So this walks the entire bbox in chunks, prefetches the tiles in parallel
(sequential fetching of ~1,400 tiles is what made the full sweep look
impossible), and runs the same detector over every chunk. Same truth model as
detect_canopy.py:

  POSITION  factual, off the photograph
  RADIUS    measured from the detected blob
  HEIGHT    MODELLED from the radius
  FORM      generative octagon prism

Chunks overlap by OVERLAP_M so a crown sitting on a chunk seam is not clipped;
fetch_city_trees.py's 4 m dedupe collapses the duplicate.

Usage:
  python scripts/fetch_canopy_grid.py                 # the whole bbox
  python scripts/fetch_canopy_grid.py --bbox W,S,E,N  # one region
  python scripts/fetch_canopy_grid.py --workers 16
"""
import argparse
import json
import math
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import detect_canopy as dc                                        # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "canopy_detected.json")

# The app's full data bbox (scripts/config.sh), as W,S,E,N.
FULL_BBOX = (-97.752, 30.276, -97.726, 30.296)

CHUNK_DEG_LON = 0.0035      # ~5 tiles wide at z19; keeps each chunk's mosaic
CHUNK_DEG_LAT = 0.0030      # under ~40 tiles so the arrays stay small
OVERLAP_M = 30.0            # seam overlap, > 2x the max crown radius
M_LAT = 111320.0


def tile_span(bbox, z):
    """How many tiles a bbox needs at zoom z."""
    w, s, e, n = bbox
    x0, y0 = dc.tile_xy_f(w, n, z)
    x1, y1 = dc.tile_xy_f(e, s, z)
    return int(math.ceil(x1) - math.floor(x0)), int(math.ceil(y1) - math.floor(y0))


def prefetch(bbox, z, workers):
    """Pull every tile the chunk needs into the disk cache, in parallel.

    detect_canopy.fetch_tile is cache-first, so once this returns the detector's
    own sequential mosaic() is pure disk reads.
    """
    w, s, e, n = bbox
    x0f, y0f = dc.tile_xy_f(w, n, z)
    x1f, y1f = dc.tile_xy_f(e, s, z)
    x0, y0 = int(math.floor(x0f)), int(math.floor(y0f))
    x1, y1 = int(math.ceil(x1f)), int(math.ceil(y1f))
    want = [(z, xt, yt) for xt in range(x0, x1) for yt in range(y0, y1)
            if not os.path.exists(os.path.join(dc.TILE_CACHE, "%d_%d_%d.jpg" % (z, xt, yt)))]
    if not want:
        return 0
    os.makedirs(dc.TILE_CACHE, exist_ok=True)
    with ThreadPoolExecutor(max_workers=workers) as ex:
        list(ex.map(lambda t: dc.fetch_tile(*t), want))
    return len(want)


def chunks(bbox):
    w, s, e, n = bbox
    lat_mid = (s + n) / 2.0
    ov_lon = OVERLAP_M / (M_LAT * math.cos(math.radians(lat_mid)))
    ov_lat = OVERLAP_M / M_LAT
    nx = max(1, int(math.ceil((e - w) / CHUNK_DEG_LON)))
    ny = max(1, int(math.ceil((n - s) / CHUNK_DEG_LAT)))
    out = []
    for j in range(ny):
        for i in range(nx):
            cw = w + (e - w) * i / nx
            ce = w + (e - w) * (i + 1) / nx
            cs = s + (n - s) * j / ny
            cn = s + (n - s) * (j + 1) / ny
            out.append(("g%02d%02d" % (j, i),
                        (round(cw - ov_lon, 6), round(cs - ov_lat, 6),
                         round(ce + ov_lon, 6), round(cn + ov_lat, 6))))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bbox", default=None, help="W,S,E,N (default: the app bbox)")
    ap.add_argument("--zoom", type=int, default=19)
    ap.add_argument("--workers", type=int, default=12)
    ap.add_argument("--out", default=OUT)
    ap.add_argument("--prefix", default="grid", help="tag prefix written into the json")
    a = ap.parse_args()

    bbox = tuple(float(v) for v in a.bbox.split(",")) if a.bbox else FULL_BBOX
    todo = chunks(bbox)
    tw, th = tile_span(bbox, a.zoom)
    sys.stderr.write("sweep %s at z%d: %d chunks, ~%dx%d tiles total\n"
                     % (str(bbox), a.zoom, len(todo), tw, th))

    prev = {}
    if os.path.exists(a.out):
        with open(a.out, encoding="utf-8") as f:
            prev = json.load(f)

    total, t0 = 0, time.time()
    for idx, (tag, cb) in enumerate(todo, 1):
        key = "%s_%s" % (a.prefix, tag)
        if key in prev:
            total += prev[key]["count"]
            sys.stderr.write("[%d/%d] %s cached (%d)\n" % (idx, len(todo), key, prev[key]["count"]))
            continue
        got = prefetch(cb, a.zoom, a.workers)
        try:
            trees, mpp = dc.detect(cb, a.zoom, None)
        except Exception as err:                                   # noqa: BLE001
            sys.stderr.write("[%d/%d] %s FAILED: %s\n" % (idx, len(todo), key, err))
            continue
        prev[key] = {"bbox": list(cb), "zoom": a.zoom, "mpp": round(mpp, 3),
                     "count": len(trees), "trees": trees}
        total += len(trees)
        with open(a.out, "w", encoding="utf-8") as f:
            json.dump(prev, f, separators=(",", ":"))
        sys.stderr.write("[%d/%d] %s  %4d crowns  (+%d tiles)  %.0fs\n"
                         % (idx, len(todo), key, len(trees), got, time.time() - t0))

    print(json.dumps({
        "chunks": len(todo), "crowns_this_sweep": total,
        "tags_in_file": len(prev),
        "crowns_in_file": sum(v["count"] for v in prev.values()),
        "out": a.out,
    }, indent=2))


if __name__ == "__main__":
    main()
