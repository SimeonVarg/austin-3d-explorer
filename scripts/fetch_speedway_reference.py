# -*- coding: utf-8 -*-
"""Pull nadir aerial imagery over the Speedway Mall and SAMPLE the brick colour
off its pixels, instead of guessing "golden brick is about #d0a060".

PLAYBOOK RULE 3: sample exact colours, never guess. At z20 over Austin one pixel
is 0.129 m, so the 30 ft (9.14 m) corridor is ~71 px wide -- the individual 4x8"
pavers are sub-pixel and invisible, but the MASSED colour of the brick is exactly
what the flying camera sees, and that is the number this pass needs.

It also samples the asphalt of San Jacinto and the concrete of the West Mall in
the same image, under the same sun and the same imagery processing, so the three
tones are comparable rather than three separately-guessed hexes.

Output: research/speedway/{mall_z20.jpg, samples.json}. The full-size
mosaic is 13 MB and is NOT committed -- a quarter-scale copy is kept for the
record and this script regenerates the original on demand.

Usage:  python scripts/fetch_speedway_reference.py
"""
import io
import json
import math
import os
import urllib.request
from collections import Counter

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "research", "speedway")
ESRI = ("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery"
        "/MapServer/tile/{z}/{y}/{x}")
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"}
Z = 20
# The mall corridor plus enough either side to catch San Jacinto and the malls.
BBOX = (-97.7400, 30.2818, -97.7350, 30.2890)   # w, s, e, n

# Points to sample, each with a radius in metres. Coordinates read off the OSM
# geometry of the way that IS the thing named, so a sample cannot drift onto a
# roof or a tree.
SAMPLES = [
    # Speedway Mall, brick section (OSM surface=paving_stones), three points
    # spread along it so one shaded stretch cannot decide the colour.
    ("speedway_brick_n", -97.73700, 30.28790, 3.0),
    ("speedway_brick_m", -97.73718, 30.28650, 3.0),
    ("speedway_brick_s", -97.73730, 30.28510, 3.0),
    # Speedway south of 23rd, which OSM still tags surface=asphalt. If this
    # samples the same colour as the three above, the tag is stale and the whole
    # corridor is brick -- which is what the built project says.
    ("speedway_south_tagged_asphalt", -97.73745, 30.28380, 3.0),
    ("speedway_south_tagged_asphalt2", -97.73755, 30.28280, 3.0),
    # Controls, in the same image under the same sun.
    ("sanjacinto_asphalt", -97.73340, 30.28640, 3.0),
    ("eastmall_paving", -97.73830, 30.28640, 3.0),
]

M_PER_DEG_LAT = 111320.0


def tile_xy(lon, lat, z):
    n = 2 ** z
    x = (lon + 180.0) / 360.0 * n
    y = (1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n
    return x, y


def fetch_tile(z, xt, yt):
    try:
        req = urllib.request.Request(ESRI.format(z=z, x=xt, y=yt), headers=UA)
        with urllib.request.urlopen(req, timeout=40) as r:
            d = r.read()
        if len(d) > 500:
            return Image.open(io.BytesIO(d)).convert("RGB")
    except Exception as e:                                         # noqa: BLE001
        print("  tile %d/%d/%d failed: %s" % (z, yt, xt, e))
    return None


def main():
    os.makedirs(OUT, exist_ok=True)
    w, s, e, n = BBOX
    x0, y0 = tile_xy(w, n, Z)
    x1, y1 = tile_xy(e, s, Z)
    xa, xb, ya, yb = int(x0), int(x1), int(y0), int(y1)
    cols, rows = xb - xa + 1, yb - ya + 1
    print("stitching %d x %d tiles at z%d" % (cols, rows, Z))
    mosaic = Image.new("RGB", (cols * 256, rows * 256), (0, 0, 0))
    ok = 0
    for xt in range(xa, xb + 1):
        for yt in range(ya, yb + 1):
            t = fetch_tile(Z, xt, yt)
            if t:
                mosaic.paste(t, ((xt - xa) * 256, (yt - ya) * 256))
                ok += 1
    print("  %d/%d tiles" % (ok, cols * rows))
    mosaic.save(os.path.join(OUT, "mall_z20.jpg"), quality=92)

    # metres per pixel at this latitude and zoom
    lat0 = (s + n) / 2
    mpp = 156543.03392 * math.cos(math.radians(lat0)) / (2 ** Z)

    px = mosaic.load()
    out = {"zoom": Z, "m_per_px": round(mpp, 4), "tiles_ok": ok,
           "source": "Esri World Imagery (ArcGIS Online), nadir",
           "samples": {}}
    for name, lon, lat, rad_m in SAMPLES:
        fx, fy = tile_xy(lon, lat, Z)
        cx = int((fx - xa) * 256)
        cy = int((fy - ya) * 256)
        r = max(1, int(round(rad_m / mpp)))
        acc, cnt = [0, 0, 0], 0
        hexes = Counter()
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                if dx * dx + dy * dy > r * r:
                    continue
                X, Y = cx + dx, cy + dy
                if not (0 <= X < mosaic.width and 0 <= Y < mosaic.height):
                    continue
                p = px[X, Y]
                acc[0] += p[0]; acc[1] += p[1]; acc[2] += p[2]
                cnt += 1
                hexes["#%02x%02x%02x" % p] += 1
        if not cnt:
            out["samples"][name] = {"error": "outside mosaic"}
            continue
        mean = tuple(round(a / cnt) for a in acc)
        luma = 0.2126 * mean[0] + 0.7152 * mean[1] + 0.0722 * mean[2]
        out["samples"][name] = {
            "lonlat": [lon, lat], "px": [cx, cy], "radius_px": r, "n": cnt,
            "mean_hex": "#%02x%02x%02x" % mean, "mean_rgb": list(mean),
            "luma": round(luma, 1),
            "modal_hexes": [h for h, _ in hexes.most_common(5)],
        }
        print("%-32s %s  rgb=%s  luma=%5.1f  (n=%d px)"
              % (name, out["samples"][name]["mean_hex"], mean, luma, cnt))

    with open(os.path.join(OUT, "samples.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    print("\nwrote %s" % os.path.join(OUT, "samples.json"))


if __name__ == "__main__":
    main()
