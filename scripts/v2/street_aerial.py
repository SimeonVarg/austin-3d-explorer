#!/usr/bin/env python3
"""v2 ground, step 1: bake the low-zoom aerial that v2/ground.js always has, even when the City's tile server is slow or down.

    python3 scripts/v2/street_aerial.py [--cache DIR] [--dry]

Source: City of Austin 2025 aerial (6 inch, January 2025), the City's public Web Mercator tile cache
    https://maps.austintexas.gov/image/rest/services/MapTiled/AerialImagery_WebMercator/MapServer/tile/{z}/{y}/{x}
City of Austin Open Data Terms: "offered free and without restriction"; credit requested (v2/credits.html carries it).

Writes v2/data/aerial/{z}/{y}/{x}.jpg for the LEVELS below (the City's own JPEG bytes, not re-encoded) and v2/data/aerial/index.json
(the tile ranges per level, the live URL, the attribution). ground.js streams z17-z20 from the City near the camera and uses these
files for everything at or below z16, so the far ground never depends on the City's server.

The ranges are in the v2 frame (v2/geo.js: x metres east, z metres SOUTH of ORIGIN). Sizes: about 24 KB a tile.
"""
import argparse, json, math, os, sys, time, urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(REPO, 'v2', 'data', 'aerial')
URL = 'https://maps.austintexas.gov/image/rest/services/MapTiled/AerialImagery_WebMercator/MapServer/tile/{z}/{y}/{x}'

# ── PARAMETERS ──────────────────────────────────────────────────────────
ORIGIN = {'lat': 30.28601, 'lon': -97.73932}   # v2/geo.js
EARTH_R = 6378137.0
# level: (minX, maxX, minZ, maxZ) in v2 metres. z13 = 16.5 m a pixel (the far land under the fog), z15 = 4.1 m (everything the
# camera target can reach, VIEW.BOUNDS in main.js, plus a margin), z16 = 2.1 m (campus, West Campus, the Drag and downtown).
LEVELS = {
    13: (-12000, 12000, -11000, 13000),
    15: (-4200, 4200, -3600, 6000),
    16: (-1800, 1400, -1500, 3700),
}
PAUSE_S = 0.15                                 # between requests: one polite client, not a scraper
UA = 'flyover-v2-bake/1 (City of Austin open data; github.com/SimeonVarg/austin-3d-explorer)'

D2R = math.pi / 180
KX = EARTH_R * D2R * math.cos(ORIGIN['lat'] * D2R)
KZ = EARTH_R * D2R


def to_lonlat(x, z):
    return ORIGIN['lon'] + x / KX, ORIGIN['lat'] - z / KZ


def tile_xy(lon, lat, z):
    n = 2 ** z
    r = lat * D2R
    return (lon + 180) / 360 * n, (1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * n


def tile_range(z, box):
    x0, x1, z0, z1 = box
    lonW, latN = to_lonlat(x0, z0)
    lonE, latS = to_lonlat(x1, z1)
    ax, ay = tile_xy(lonW, latN, z)
    bx, by = tile_xy(lonE, latS, z)
    return int(math.floor(ax)), int(math.floor(bx)), int(math.floor(ay)), int(math.floor(by))


def fetch(z, x, y, cache):
    p = os.path.join(cache, f'{z}_{x}_{y}.jpg') if cache else None
    if p and os.path.exists(p):
        return open(p, 'rb').read()
    for attempt in range(4):
        try:
            req = urllib.request.Request(URL.format(z=z, x=x, y=y), headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                body = r.read()
                if r.headers.get('content-type', '').split(';')[0] != 'image/jpeg' or body[:2] != b'\xff\xd8':
                    raise ValueError('not a JPEG (%s)' % r.headers.get('content-type'))
            if p:
                open(p, 'wb').write(body)
            time.sleep(PAUSE_S)
            return body
        except Exception as e:
            print(f'  retry {z}/{y}/{x}: {e}', file=sys.stderr)
            time.sleep(2 * (attempt + 1))
    raise SystemExit(f'failed {z}/{y}/{x}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache', default=None, help='a folder outside the repo that keeps fetched tiles between runs')
    ap.add_argument('--dry', action='store_true')
    a = ap.parse_args()
    if a.cache:
        os.makedirs(a.cache, exist_ok=True)
    index = {
        'about': 'Low-zoom City of Austin 2025 aerial for the v2 ground (scripts/v2/street_aerial.py). Not endorsed by the City of Austin.',
        'source': 'City of Austin, Texas: 2025 aerial imagery (6 inch, January 2025)',
        'licence': 'City of Austin Open Data Terms of Use: free and without restriction; credit requested',
        'live': URL,
        'scheme': 'xyz web mercator, 256 px, files at {z}/{y}/{x}.jpg',
        'levels': {},
    }
    total = n = 0
    for z, box in sorted(LEVELS.items()):
        x0, x1, y0, y1 = tile_range(z, box)
        index['levels'][str(z)] = {'x0': x0, 'x1': x1, 'y0': y0, 'y1': y1}
        cnt = (x1 - x0 + 1) * (y1 - y0 + 1)
        print(f'z{z}: x {x0}..{x1}, y {y0}..{y1} = {cnt} tiles')
        if a.dry:
            continue
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                body = fetch(z, x, y, a.cache)
                d = os.path.join(OUT, str(z), str(y))
                os.makedirs(d, exist_ok=True)
                with open(os.path.join(d, f'{x}.jpg'), 'wb') as f:
                    f.write(body)
                total += len(body)
                n += 1
    if not a.dry:
        with open(os.path.join(OUT, 'index.json'), 'w') as f:
            json.dump(index, f, indent=1)
        print(f'{n} tiles, {total / 1e6:.2f} MB')


if __name__ == '__main__':
    main()
