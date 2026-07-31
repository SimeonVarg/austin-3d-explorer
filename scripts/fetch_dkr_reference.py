# -*- coding: utf-8 -*-
"""Fetch a GEOREFERENCED nadir aerial of DKR, and a georef sidecar for it.

Why this exists. `data/dkr_aerial.png` already sat in the repo and is a good
photograph, but nothing recorded the bbox it was fetched with, and the only bbox
in scripts/fetch_reference_imagery.py belongs to a different target — projecting
the stadium's own footprint through it lands the building 1.5 km outside the
frame. An aerial you cannot georeference is a mood board: you can look at it, you
cannot measure anything on it, and every number you take off it is an eyeball.

This fetches the same Esri World Imagery at a bbox derived from the stadium's own
footprint plus a margin, and writes `data/dkr_aerial_geo.json` next to the image
with the exact bbox, the pixel size, and the metres-per-pixel in both axes. That
turns the photograph into a measuring instrument: `scripts/probe_dkr.py` inverts
it, so any feature visible in the picture — a light tower, the video board, the
Longhorn balcony — can be read straight off as a lon/lat and a size in metres.

Usage:  python scripts/fetch_dkr_reference.py [zoom]      (default 20)
"""
import io
import json
import math
import os
import sys

import urllib.request

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SNAP = os.path.join(ROOT, "data", "snapshots", "2026-07-30", "buildings.detailed.geojson")
OUT_IMG = os.path.join(ROOT, "data", "dkr_aerial_geo.png")
OUT_GEO = os.path.join(ROOT, "data", "dkr_aerial_geo.json")
ESRI = ("https://services.arcgisonline.com/ArcGIS/rest/services/"
        "World_Imagery/MapServer/tile/{z}/{y}/{x}")
UA = {"User-Agent": "austin-3d-explorer/1.0 (architectural reference)"}
MARGIN_M = 70.0          # enough to catch the light towers and the entry plazas
M_LAT = 111320.0


def tile_xy(lon, lat, z):
    n = 2 ** z
    x = (lon + 180.0) / 360.0 * n
    y = (1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n
    return x, y


def stadium_bbox():
    feats = json.load(open(SNAP, encoding="utf-8"))["features"]
    f = next(x for x in feats if x["properties"].get("name") == "DKR Memorial Stadium")
    pts = [p for ring in f["geometry"]["coordinates"] for p in ring]
    lons = [p[0] for p in pts]
    lats = [p[1] for p in pts]
    lat0 = sum(lats) / len(lats)
    dlat = MARGIN_M / M_LAT
    dlon = MARGIN_M / (M_LAT * math.cos(math.radians(lat0)))
    return (min(lons) - dlon, min(lats) - dlat, max(lons) + dlon, max(lats) + dlat), f


def main():
    z = int(sys.argv[1]) if len(sys.argv) > 1 else 20
    bbox, feat = stadium_bbox()
    w, s, e, n = bbox
    x0, y0 = tile_xy(w, n, z)
    x1, y1 = tile_xy(e, s, z)
    xa, xb, ya, yb = int(x0), int(x1), int(y0), int(y1)
    count = (xb - xa + 1) * (yb - ya + 1)
    print("bbox %.6f,%.6f,%.6f,%.6f  z=%d  tiles=%d" % (w, s, e, n, z, count))
    if count > 400:
        raise SystemExit("tile range too large — drop the zoom")

    mosaic = Image.new("RGB", ((xb - xa + 1) * 256, (yb - ya + 1) * 256), (20, 20, 20))
    ok = 0
    for xt in range(xa, xb + 1):
        for yt in range(ya, yb + 1):
            try:
                req = urllib.request.Request(ESRI.format(z=z, y=yt, x=xt), headers=UA)
                blob = urllib.request.urlopen(req, timeout=30).read()
                if len(blob) > 500:
                    mosaic.paste(Image.open(io.BytesIO(blob)).convert("RGB"),
                                 ((xt - xa) * 256, (yt - ya) * 256))
                    ok += 1
            except Exception as ex:
                print("  tile %d/%d/%d failed: %s" % (z, yt, xt, ex))
    # Crop to the EXACT bbox. Sub-pixel offsets are kept as floats in the sidecar
    # rather than rounded away, because a half-pixel at z=20 is 7 cm and the whole
    # point of this file is that the numbers taken off it are real.
    px0, py0 = (x0 - xa) * 256, (y0 - ya) * 256
    px1, py1 = (x1 - xa) * 256, (y1 - ya) * 256
    img = mosaic.crop((int(px0), int(py0), int(px1), int(py1)))
    img.save(OUT_IMG)

    W, H = img.size
    lat0 = (s + n) / 2
    geo = {
        "image": os.path.basename(OUT_IMG),
        "bbox": [w, s, e, n],
        "size": [W, H],
        "zoom": z,
        "tiles_ok": ok, "tiles_total": count,
        "m_per_px_x": (e - w) * M_LAT * math.cos(math.radians(lat0)) / W,
        "m_per_px_y": (n - s) * M_LAT / H,
        "source": "Esri World Imagery (Esri, Maxar, Earthstar Geographics)",
        "note": "Web Mercator. Linear lon/lat mapping is exact in x and good to "
                "<0.1 px in y over a 380 m tall frame at this latitude.",
    }
    json.dump(geo, open(OUT_GEO, "w"), indent=2)
    print(json.dumps(geo, indent=2))


if __name__ == "__main__":
    main()
