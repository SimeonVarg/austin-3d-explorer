# -*- coding: utf-8 -*-
"""Measure things on the georeferenced DKR aerial, in metres and lon/lat.

`scripts/fetch_dkr_reference.py` turns the photograph into a measuring
instrument; this is the instrument's dial. Everything the stadium bake needs to
be FACTUAL rather than invented — where the light towers stand and how big their
heads are, how wide the video board is, where the Longhorn balcony sits, how deep
each seating tier is — is visible in a 13 cm/px nadir photo, and can therefore be
read rather than guessed. Guessed values always cost a correction round.

Commands
  overlay              draw the footprint rings + a labelled metre grid, save a
                       viewable PNG, and report the reprojection error
  crop  X0 Y0 X1 Y1    crop by IMAGE pixel, upsampled, with a metre ruler
  at    LON LAT        -> pixel
  px    X Y            -> lon/lat
  box   X0 Y0 X1 Y1    -> lon/lat corners, size in metres, mean colour, luma
  swatch X Y R         -> mean/median hex in an R-pixel box, and the spread

Usage:  python scripts/probe_dkr.py <command> [args]
"""
import json
import math
import os
import sys

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEO = json.load(open(os.path.join(ROOT, "data", "dkr_aerial_geo.json")))
IMG = os.path.join(ROOT, "data", GEO["image"])
SNAP = os.path.join(ROOT, "data", "snapshots", "2026-07-30", "buildings.detailed.geojson")
SHOTS = os.path.join(ROOT, "scripts", "verify", "shots")
W_, S_, E_, N_ = GEO["bbox"]
W, H = GEO["size"]
MPP = GEO["m_per_px_x"]


def to_px(lon, lat):
    return ((lon - W_) / (E_ - W_) * W, (N_ - lat) / (N_ - S_) * H)


def to_ll(x, y):
    return (W_ + x / W * (E_ - W_), N_ - y / H * (N_ - S_))


def stadium():
    feats = json.load(open(SNAP, encoding="utf-8"))["features"]
    return next(x for x in feats if x["properties"].get("name") == "DKR Memorial Stadium")


def cmd_overlay():
    im = Image.open(IMG).convert("RGB")
    d = ImageDraw.Draw(im)
    f = stadium()
    for ring, col in zip(f["geometry"]["coordinates"], [(255, 0, 255), (0, 255, 255)]):
        pts = [to_px(*p[:2]) for p in ring]
        d.line(pts + [pts[0]], fill=col, width=6)
    # 50 m grid, labelled in metres from the image's north-west corner
    step = int(round(50.0 / MPP))
    for gx in range(0, W, step):
        d.line([(gx, 0), (gx, H)], fill=(255, 255, 0), width=1)
        d.text((gx + 4, 4), "%dm" % round(gx * MPP), fill=(255, 255, 0))
    for gy in range(0, H, step):
        d.line([(0, gy), (W, gy)], fill=(255, 255, 0), width=1)
        d.text((4, gy + 4), "%dm" % round(gy * MPP), fill=(255, 255, 0))
    out = os.path.join(SHOTS, "ref-dkr-georef.png")
    im.resize((1200, int(1200 * H / W)), Image.LANCZOS).save(out)
    xs = [to_px(*p[:2])[0] for p in f["geometry"]["coordinates"][0]]
    ys = [to_px(*p[:2])[1] for p in f["geometry"]["coordinates"][0]]
    print("footprint in image px: x %.0f..%.0f (%.1f m)  y %.0f..%.0f (%.1f m)"
          % (min(xs), max(xs), (max(xs) - min(xs)) * MPP,
             min(ys), max(ys), (max(ys) - min(ys)) * MPP))
    print("image %dx%d  %.4f m/px  ->  %s" % (W, H, MPP, out))


def cmd_crop(x0, y0, x1, y1, name="ref-dkr-crop"):
    x0, y0, x1, y1 = int(x0), int(y0), int(x1), int(y1)
    im = Image.open(IMG).convert("RGB").crop((x0, y0, x1, y1))
    sc = max(1, min(3, 1400 // max(1, x1 - x0)))
    im = im.resize(((x1 - x0) * sc, (y1 - y0) * sc), Image.LANCZOS)
    d = ImageDraw.Draw(im)
    step = 10.0 / MPP * sc                    # 10 m ticks
    i = 0
    while i * step < im.size[0]:
        d.line([(i * step, 0), (i * step, 14)], fill=(255, 255, 0), width=2)
        d.text((i * step + 3, 2), "%dm" % (i * 10), fill=(255, 255, 0))
        i += 1
    i = 0
    while i * step < im.size[1]:
        d.line([(0, i * step), (14, i * step)], fill=(255, 255, 0), width=2)
        i += 1
    out = os.path.join(SHOTS, name + ".png")
    im.save(out)
    print("%s  crop px (%d,%d)-(%d,%d)  = %.1f x %.1f m  scale x%d"
          % (out, x0, y0, x1, y1, (x1 - x0) * MPP, (y1 - y0) * MPP, sc))


def cmd_box(x0, y0, x1, y1):
    import statistics
    x0, y0, x1, y1 = int(x0), int(y0), int(x1), int(y1)
    im = Image.open(IMG).convert("RGB").crop((x0, y0, x1, y1))
    px = list(im.getdata())
    r = sum(p[0] for p in px) / len(px)
    g = sum(p[1] for p in px) / len(px)
    b = sum(p[2] for p in px) / len(px)
    lum = [0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2] for p in px]
    a, bll = to_ll(x0, y0), to_ll(x1, y1)
    print(json.dumps({
        "px": [x0, y0, x1, y1],
        "nw_lonlat": [round(a[0], 7), round(a[1], 7)],
        "se_lonlat": [round(bll[0], 7), round(bll[1], 7)],
        "size_m": [round((x1 - x0) * MPP, 2), round((y1 - y0) * MPP, 2)],
        "mean_hex": "#%02x%02x%02x" % (round(r), round(g), round(b)),
        "mean_rgb": [round(r, 1), round(g, 1), round(b, 1)],
        "luma_mean": round(sum(lum) / len(lum), 1),
        "luma_sd": round(statistics.pstdev(lum), 1),
        "luma_p10_p90": [round(sorted(lum)[len(lum) // 10], 1),
                         round(sorted(lum)[len(lum) * 9 // 10], 1)],
    }, indent=2))


def cmd_swatch(x, y, r):
    cmd_box(int(x) - int(r), int(y) - int(r), int(x) + int(r), int(y) + int(r))


if __name__ == "__main__":
    c = sys.argv[1] if len(sys.argv) > 1 else "overlay"
    a = sys.argv[2:]
    if c == "overlay":
        cmd_overlay()
    elif c == "crop":
        cmd_crop(*a)
    elif c == "box":
        cmd_box(*a)
    elif c == "swatch":
        cmd_swatch(*a)
    elif c == "at":
        print("%.1f %.1f" % to_px(float(a[0]), float(a[1])))
    elif c == "px":
        print("%.7f %.7f" % to_ll(float(a[0]), float(a[1])))
    else:
        print(__doc__)
