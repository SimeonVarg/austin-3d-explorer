# -*- coding: utf-8 -*-
"""Stitch a nadir aerial of the Texas Capitol Complex for colour sampling.

WHY. The Capitol is Sunset Red granite and everyone "knows" what colour that
is — which is exactly the kind of knowledge that costs a correction round.
VISUAL_REFERENCE_PLAYBOOK rule 3: sample the pixels, never guess. This writes
one stitched image of the complex so the granite, the copper, the limestone and
the lawns can be read off real photography instead of recalled.

Tiles land in the shared, gitignored data/imagery_cache under the same
`z_x_y.jpg` name the roof bake uses. The stitched PNG is reference input to a
bake and is never shipped in the app.

Usage:  python scripts/fetch_capitol_aerial.py [--zoom 18]
"""
import argparse
import io
import math
import os
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TILES = os.path.join(ROOT, "data", "imagery_cache")
OUT = os.path.join(ROOT, "data", "capitol_aerial.png")
ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
UA = {"User-Agent": "austin-3d-explorer/1.0 (reference imagery for the capitol bake)"}

# The Capitol square and its grounds, plus the Texas Mall running north.
W, S, E, N = -97.7450, 30.2710, -97.7350, 30.2810


def tile_xy_f(lon, lat, z):
    n = 2.0 ** z
    return ((lon + 180.0) / 360.0 * n,
            (1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n)


def get(z, xt, yt):
    p = os.path.join(TILES, "%d_%d_%d.jpg" % (z, xt, yt))
    if os.path.exists(p):
        try:
            return Image.open(p).convert("RGB")
        except Exception:  # noqa: BLE001
            pass
    try:
        req = urllib.request.Request(ESRI.format(z=z, x=xt, y=yt), headers=UA)
        with urllib.request.urlopen(req, timeout=45) as r:
            b = r.read()
        if len(b) < 500:
            return None
        with open(p, "wb") as fh:
            fh.write(b)
        return Image.open(io.BytesIO(b)).convert("RGB")
    except Exception as e:  # noqa: BLE001
        sys.stderr.write("  tile %d/%d/%d: %s\n" % (z, xt, yt, e))
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zoom", type=int, default=18)
    a = ap.parse_args()
    z = a.zoom
    os.makedirs(TILES, exist_ok=True)

    x0, y0 = tile_xy_f(W, N, z)
    x1, y1 = tile_xy_f(E, S, z)
    xa, xb, ya, yb = int(x0), int(x1), int(y0), int(y1)
    coords = [(xt, yt) for xt in range(xa, xb + 1) for yt in range(ya, yb + 1)]
    print("stitching %d x %d tiles at z%d" % (xb - xa + 1, yb - ya + 1, z), flush=True)

    with ThreadPoolExecutor(max_workers=8) as ex:
        imgs = list(ex.map(lambda c: (c, get(z, c[0], c[1])), coords))

    canvas = Image.new("RGB", ((xb - xa + 1) * 256, (yb - ya + 1) * 256), (30, 30, 30))
    got = 0
    for (xt, yt), im in imgs:
        if im is None:
            continue
        canvas.paste(im, ((xt - xa) * 256, (yt - ya) * 256))
        got += 1
    canvas.save(OUT)
    # The georeference of the stitched canvas, so a bake can convert a pixel
    # back to a lon/lat without re-deriving the tile maths.
    n = 2.0 ** z
    print({
        "out": OUT, "tiles": "%d/%d" % (got, len(coords)),
        "size_px": canvas.size,
        "nw_lonlat": [xa / n * 360.0 - 180.0,
                      math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * ya / n))))],
        "se_lonlat": [(xb + 1) / n * 360.0 - 180.0,
                      math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (yb + 1) / n))))],
    })


if __name__ == "__main__":
    main()
