# -*- coding: utf-8 -*-
"""Detect tree crowns from current nadir aerial imagery, for the areas where no
survey exists.

WHY THIS EXISTS. Trees are most of what you see of the ground from 60 m, and on
the UT malls there is no tree data at all: OpenStreetMap has 498 trees in the
bbox and none on the malls; the City of Austin inventory has 1,566 and none on
the malls either (the city surveys city land — UT is state property). Rather
than scatter decorative trees, this reads their positions off the same imagery a
mapper would digitise from. Photo-interpretation is a legitimate source; it is
how OSM itself is made.

WHAT IS FACT AND WHAT IS MODEL
  POSITION  — factual, from the imagery. A crown is only emitted where the
              picture actually shows a crown.
  RADIUS    — measured from the detected blob, in metres.
  HEIGHT    — MODELLED from that radius (no height information exists in a
              nadir RGB photo). Reported as modelled.
  FORM      — generative, as before: an octagon prism.

HOW IT DISCRIMINATES TREES FROM LAWN. Both are green, so greenness alone is
useless — the discriminators are that a crown is DARKER than mown grass (it
shadows itself) and far more TEXTURED at 0.26 m/px, and that it is a compact
blob rather than a field. Score = vegetation x darkness x texture, blurred, then
peak-picked with non-maximum suppression at the minimum crown spacing.

Every threshold is a named constant at the top; --debug writes an overlay PNG so
the detections can be checked against the photograph by eye.

Usage:
  python scripts/detect_canopy.py --bbox W,S,E,N [--zoom 19] [--debug] [--out FILE]
"""
import argparse
import io
import json
import math
import os
import sys
import time
import urllib.request

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TILE_CACHE = os.path.join(ROOT, "data", "imagery_cache")
ESRI = ("https://server.arcgisonline.com/ArcGIS/rest/services/"
        "World_Imagery/MapServer/tile/{z}/{y}/{x}")
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"}

# ── Detection constants. Deliberately conservative: a missed tree is a gap, a
# false tree is a lie, and the brief says a wrong campus is worse than a bare
# one. ────────────────────────────────────────────────────────────────────
EXG_MIN        = 0.030   # excess-green over the local mean before a pixel is "vegetation"
DARK_MAX       = 0.72    # canopy is darker than mown lawn; reject brighter than this
TEXTURE_WIN_M  = 1.6     # window for the local-variance texture measure
TEXTURE_MIN    = 0.006   # below this it is a smooth surface (lawn, a green roof)
BLUR_M         = 1.7     # smoothing of the score before peak-picking
PEAK_MIN       = 0.055   # minimum blurred score at a crown centre
MIN_SPACING_M  = 5.0     # non-max suppression radius; crowns closer than this merge
MIN_RADIUS_M   = 2.0     # smaller blobs are shrubs, not something you see at 60 m
MAX_RADIUS_M   = 14.0    # cap: bigger blobs are a canopy mass, not one crown
VEG_FRAC_MIN   = 0.55    # a crown's disc must be this green to be kept

# Height is MODELLED from the measured crown radius. Open-grown urban broadleaf
# habit: roughly as tall as it is wide for a young tree, relatively wider with
# age (live oaks especially). h = HEIGHT_A * r + HEIGHT_B, capped.
HEIGHT_A, HEIGHT_B, HEIGHT_MAX = 1.15, 3.2, 22.0


def tile_xy_f(lon, lat, z):
    n = 2.0 ** z
    x = (lon + 180.0) / 360.0 * n
    lr = math.radians(lat)
    y = (1.0 - math.asinh(math.tan(lr)) / math.pi) / 2.0 * n
    return x, y


def xy_to_lonlat(x, y, z):
    n = 2.0 ** z
    lon = x / n * 360.0 - 180.0
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    return lon, lat


def fetch_tile(z, xt, yt, tries=3):
    os.makedirs(TILE_CACHE, exist_ok=True)
    p = os.path.join(TILE_CACHE, "%d_%d_%d.jpg" % (z, xt, yt))
    if os.path.exists(p):
        return Image.open(p).convert("RGB")
    url = ESRI.format(z=z, x=xt, y=yt)
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            b = urllib.request.urlopen(req, timeout=45).read()
            if len(b) < 500:
                raise IOError("tiny tile")
            with open(p, "wb") as f:
                f.write(b)
            return Image.open(io.BytesIO(b)).convert("RGB")
        except Exception as e:                                    # noqa: BLE001
            if i == tries - 1:
                sys.stderr.write("tile %d/%d/%d failed: %s\n" % (z, xt, yt, e))
                return None
            time.sleep(2 + 2 * i)
    return None


def mosaic(bbox, z):
    """Return (RGB float array HxWx3 in 0..1, origin tile x/y, tilesize)."""
    w, s, e, n = bbox
    x0f, y0f = tile_xy_f(w, n, z)          # NW corner
    x1f, y1f = tile_xy_f(e, s, z)          # SE corner
    x0, y0 = int(math.floor(x0f)), int(math.floor(y0f))
    x1, y1 = int(math.ceil(x1f)), int(math.ceil(y1f))
    nx, ny = x1 - x0, y1 - y0
    if nx * ny > 400:
        raise SystemExit("refusing to fetch %d tiles; use a smaller bbox or zoom" % (nx * ny))
    T = 256
    img = Image.new("RGB", (nx * T, ny * T))
    got = 0
    for i in range(nx):
        for j in range(ny):
            t = fetch_tile(z, x0 + i, y0 + j)
            if t is not None:
                img.paste(t, (i * T, j * T))
                got += 1
    sys.stderr.write("mosaic %dx%d tiles (%d fetched) at z%d\n" % (nx, ny, got, z))
    a = np.asarray(img, dtype=np.float32) / 255.0
    return a, x0, y0, T


def box_mean(a, r):
    """Fast separable box mean with radius r (pixels)."""
    if r < 1:
        return a
    k = 2 * int(r) + 1
    return ndimage.uniform_filter(a, size=k, mode="nearest")


def detect(bbox, z, debug_path=None):
    rgb, x0, y0, T = mosaic(bbox, z)
    H, W, _ = rgb.shape
    lat_mid = (bbox[1] + bbox[3]) / 2.0
    mpp = 156543.03392 * math.cos(math.radians(lat_mid)) / (2 ** z)

    R, G, B = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    tot = R + G + B + 1e-6
    exg = (2 * G - R - B) / tot                     # excess green, normalised
    luma = 0.2126 * R + 0.7152 * G + 0.0722 * B

    # Vegetation: greener than its own neighbourhood (kills global colour cast).
    exg_local = exg - box_mean(exg, max(1, int(round(9.0 / mpp))))
    veg = (exg > 0.02) & (exg_local > EXG_MIN - 0.02)

    # Texture: local variance of luma over a small window.
    win = max(1, int(round(TEXTURE_WIN_M / mpp)))
    m1 = box_mean(luma, win)
    m2 = box_mean(luma * luma, win)
    var = np.clip(m2 - m1 * m1, 0, None)

    # Darkness: crowns self-shadow; mown lawn is bright.
    lawn_ref = box_mean(luma, max(1, int(round(14.0 / mpp))))
    dark = np.clip(1.0 - (luma / (lawn_ref + 1e-6)) / DARK_MAX, 0, 1)

    score = np.where(veg, np.clip(var / TEXTURE_MIN, 0, 3.0) * dark, 0.0).astype(np.float32)
    score = ndimage.gaussian_filter(score, sigma=max(1.0, BLUR_M / mpp))

    # Peak-pick with non-max suppression at the minimum crown spacing.
    nms = max(2, int(round(MIN_SPACING_M / mpp)))
    mx = ndimage.maximum_filter(score, size=2 * nms + 1, mode="nearest")
    peaks = (score >= mx - 1e-9) & (score > PEAK_MIN)
    ys, xs = np.nonzero(peaks)

    # Measure each crown: grow a disc while it stays vegetated.
    out = []
    radii_px = np.arange(int(MIN_RADIUS_M / mpp), int(MAX_RADIUS_M / mpp) + 1)
    yy, xx = np.mgrid[-int(MAX_RADIUS_M / mpp):int(MAX_RADIUS_M / mpp) + 1,
                      -int(MAX_RADIUS_M / mpp):int(MAX_RADIUS_M / mpp) + 1]
    dist = np.hypot(yy, xx)
    for py, px in zip(ys, xs):
        best_r = None
        for rp in radii_px:
            y1, y2 = py - rp, py + rp + 1
            x1, x2 = px - rp, px + rp + 1
            if y1 < 0 or x1 < 0 or y2 > H or x2 > W:
                break
            c = dist[int(MAX_RADIUS_M / mpp) - rp:int(MAX_RADIUS_M / mpp) + rp + 1,
                     int(MAX_RADIUS_M / mpp) - rp:int(MAX_RADIUS_M / mpp) + rp + 1] <= rp
            frac = veg[y1:y2, x1:x2][c].mean()
            if frac >= VEG_FRAC_MIN:
                best_r = rp
            else:
                break
        if best_r is None:
            continue
        r_m = best_r * mpp
        if r_m < MIN_RADIUS_M:
            continue
        lon, lat = xy_to_lonlat(x0 + px / T, y0 + py / T, z)
        if not (bbox[0] <= lon <= bbox[2] and bbox[1] <= lat <= bbox[3]):
            continue
        out.append({"lon": round(lon, 6), "lat": round(lat, 6),
                    "r": round(float(r_m), 2),
                    "h": round(min(HEIGHT_MAX, HEIGHT_A * r_m + HEIGHT_B), 2),
                    "score": round(float(score[py, px]), 4)})

    if debug_path:
        im = Image.fromarray((rgb * 255).astype(np.uint8))
        d = ImageDraw.Draw(im)
        for t in out:
            xf, yf = tile_xy_f(t["lon"], t["lat"], z)
            px_, py_ = (xf - x0) * T, (yf - y0) * T
            rp = t["r"] / mpp
            d.ellipse([px_ - rp, py_ - rp, px_ + rp, py_ + rp], outline=(255, 0, 255), width=2)
            d.point((px_, py_), fill=(255, 255, 0))
        im.save(debug_path)
        sys.stderr.write("debug overlay -> %s\n" % debug_path)

    return out, mpp


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bbox", required=True, help="W,S,E,N")
    ap.add_argument("--zoom", type=int, default=19)
    ap.add_argument("--debug", action="store_true")
    ap.add_argument("--out", default=os.path.join(ROOT, "data", "canopy_detected.json"))
    ap.add_argument("--tag", default="corridor")
    a = ap.parse_args()
    bbox = tuple(float(v) for v in a.bbox.split(","))
    dbg = os.path.join(ROOT, "data", "canopy_debug_%s.png" % a.tag) if a.debug else None
    trees, mpp = detect(bbox, a.zoom, dbg)
    prev = {}
    if os.path.exists(a.out):
        with open(a.out, encoding="utf-8") as f:
            prev = json.load(f)
    prev[a.tag] = {"bbox": list(bbox), "zoom": a.zoom, "mpp": round(mpp, 3),
                   "count": len(trees), "trees": trees}
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(prev, f, separators=(",", ":"))
    rs = [t["r"] for t in trees]
    print(json.dumps({
        "tag": a.tag, "detected": len(trees), "m_per_px": round(mpp, 3),
        "radius_m": {"min": round(min(rs), 1), "max": round(max(rs), 1),
                     "mean": round(sum(rs) / len(rs), 1)} if rs else None,
        "out": a.out, "debug": dbg,
    }, indent=2))


if __name__ == "__main__":
    main()
