# -*- coding: utf-8 -*-
"""Put a render next to the photograph it is supposed to be of.

A green build is not proof, and neither is a screenshot that looks plausible on
its own. The only useful question about a roofscape is "does this block read
like THAT block", and answering it means the same lon/lat box, side by side.

`scripts/verify/roofscape-shot.mjs` writes a `<shot>.bounds.json` next to every
frame, read back off the live map rather than off the shot list — so the box
stitched here is the box the camera actually saw. Use a pitch-0 shot: at a
flying pitch the frame is a trapezoid on the ground and no rectangular crop of a
nadir photo corresponds to it.

Usage:  python scripts/roofscape_sbs.py shots/after-N1-core-nadir.png [out.jpg]
"""
import json
import math
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TILES = os.path.join(ROOT, "data", "imagery_cache")
Z = 20


def txy(lon, lat, z):
    n = 2.0 ** z
    return ((lon + 180) / 360 * n,
            (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)


def aerial(w, s, e, n, size):
    x0, y0 = txy(w, n, Z)
    x1, y1 = txy(e, s, Z)
    xs = list(range(int(x0), int(x1) + 1))
    ys = list(range(int(y0), int(y1) + 1))
    im = Image.new("RGB", (len(xs) * 256, len(ys) * 256), (26, 26, 26))
    miss = 0
    for i, xt in enumerate(xs):
        for j, yt in enumerate(ys):
            p = os.path.join(TILES, "%d_%d_%d.jpg" % (Z, xt, yt))
            if os.path.exists(p):
                im.paste(Image.open(p), (i * 256, j * 256))
            else:
                miss += 1
    im = im.crop((int((x0 - xs[0]) * 256), int((y0 - ys[0]) * 256),
                  int((x1 - xs[0]) * 256), int((y1 - ys[0]) * 256)))
    if miss:
        print("  (%d tiles missing from the cache)" % miss)
    return im.resize(size, Image.LANCZOS)


def main():
    shot = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else shot.replace(".png", "-vs-aerial.jpg")
    b = json.load(open(os.path.splitext(shot)[0] + ".bounds.json", encoding="utf-8"))
    if abs(b.get("pitch", 0)) > 3:
        print("WARNING: pitch %.0f - a tilted frame is a trapezoid on the ground, "
              "so this comparison is only approximate." % b["pitch"])
    render = Image.open(shot).convert("RGB")
    photo = aerial(b["w"], b["s"], b["e"], b["n"], render.size)
    gap = 10
    canvas = Image.new("RGB", (render.width * 2 + gap, render.height), (14, 12, 10))
    canvas.paste(render, (0, 0))
    canvas.paste(photo, (render.width + gap, 0))
    canvas.save(out, quality=92)
    print("WROTE", out, canvas.size, "| left: render, right: Esri z20 nadir")


if __name__ == "__main__":
    main()
