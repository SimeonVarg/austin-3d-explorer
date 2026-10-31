"""Lawns and planting beds near the v2 buildings, read off the City's 2025 6-inch aerial at z19 -> data/ground_veg.json.

Why (whole-frame review of ten owner photos, 2026-10-31): in 9 of 10 his photo shows lawn, ground cover or mulch beds where the app
drew pale paving. In each of the four cases checked the ground was decided by the baked z16 aerial (about 2 m a pixel): either nothing
in data/ground.geojson names it (GDC's lawn under the oak, McCombs' east lawn, Painter's strip by the ramp) or only a guessed
"surface-default" courtyard does (Moffett's planting beds). At 2 m a pixel a 3 m lawn strip is one mixed pixel, an oak crown reads as
dark olive, and the January flight shows mulch and dormant grass brown, so the green test said "concrete". At z19 (~0.26 m here) the
same aerial resolves the strips and the beds.

Per pixel (linear RGB, l = luminance, gi = (g - max(r, b)) / l, warm = (min(r, g) - b) / l):
  crown   dark and green: l < CROWN_L and gi > CROWN_GI      (tree crowns and shade on lawn: the aerial cannot see the ground)
  lawn    gi > LAWN_GI and l >= CROWN_L
  bed     warm, mid-dark, not green: warm > BED_WARM, BED_L[0] <= l < BED_L[1], gi <= LAWN_GI   (mulch, soil, dormant planting)
  other   everything else (paving, roofs, cars, asphalt, shadow on paving)
then: a MODE_M majority filter per class; crown pixels take the class of the nearest seen ground within CROWN_FILL_M (the ground
under a crown continues what is around it; beyond that it stays unnamed and the app's aerial hint decides); lawn and bed are opened
by OPEN_M and closed by CLOSE_M, parts under MIN_M2 dropped, traced and simplified by SIMPLIFY_M.

Output: { about, classes, f: [[class, ring0, ring1...]...] } with rings flat [x, z, ...] in decimetres of the v2 frame, read by
scripts/v2/ground_near.py, which draws them over guessed surfaces and under everything mapped (sidewalk slabs, paths, plazas, lots).
Tiles are cached outside the repo (AERIAL19_CACHE, default ~/flyover-private/aerial-z19-cache); the output is committed.

  python3 scripts/v2/ground_veg.py                    (fetches missing tiles; needs numpy, scipy, Pillow, opencv)
  python3 scripts/v2/ground_veg.py --debug x0,z0,x1,z1 out.png   (class map of one box, v2 metres, for checking the rule)
"""
import json, math, os, sys, io, urllib.request
from concurrent.futures import ThreadPoolExecutor
import numpy as np
from PIL import Image
from scipy import ndimage
import cv2

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'data', 'ground_veg.json')
MANIFEST = os.path.join(ROOT, 'v2', 'tiles', 'manifest.json')
CACHE = os.path.expanduser(os.environ.get('AERIAL19_CACHE', '~/flyover-private/aerial-z19-cache'))
URL = 'https://maps.austintexas.gov/image/rest/services/MapTiled/AerialImagery_WebMercator/MapServer/tile/{z}/{y}/{x}'
ORIGIN = (30.28601, -97.73932)                 # v2/geo.js ORIGIN (lat, lon)
R = 6378137.0
KX = R * math.pi / 180 * math.cos(ORIGIN[0] * math.pi / 180)
KZ = R * math.pi / 180
Z = 19
NEAR_BUILDING_M = 160                          # tiles within this of a v2 building's centre are read
BLOCK = 8                                      # tiles a side per processing block
MARGIN = 96                                    # px of context around a block (fills and filters see across its edge)
# the rule (linear luminance; see the docstring). Read off the four review cameras' z19 crops (2026-10-31).
CROWN_L, CROWN_GI = 0.075, 0.0
LAWN_GI = 0.035
BED_WARM, BED_L, BED_RG = 0.22, (0.035, 0.16), 1.35   # BED_RG: max linear r/g (clay tile roofs are redder than mulch)
TEX_M, TEX_CROWN = 1.3, 0.32                   # local luminance std / mean over TEX_M: a crown's sun-and-shade texture (lawn is smooth)
# GREEN_CROWNS: an evergreen crown (live oak) is taken as planted ground under it. On campus the ground under the oaks is lawn, ground
# cover or mulch (GDC 0998, McCombs east), and anything paved there that is mapped (City sidewalk slabs, OSM paths and plazas,
# parking lots) is drawn over this layer. Only a bare (January) deciduous crown is unknown: it takes the nearest seen ground's class.
MODE_M = 0.8
CROWN_FILL_M = 10.0
OPEN_M, CLOSE_M = 0.8, 1.0
MIN_M2 = 10.0
SIMPLIFY_M = 0.4                               # 0.25 doubled the file (4.2 MB) for edges finer than the 0.25 m class window
LAWN, BED, OTHER, CROWN = 2, 3, 4, 9           # 2 / 3 = ground_near classes grass / bed


def lonlat_px(lon, lat):
    n = 2 ** Z * 256
    return (lon + 180) / 360 * n, (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n


def px_lonlat(gx, gy):
    n = 2 ** Z * 256
    lon = gx / n * 360 - 180
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * gy / n))))
    return lon, lat


def v2_px(x, z): return lonlat_px(ORIGIN[1] + x / KX, ORIGIN[0] - z / KZ)


M_PER_PX = 156543.03392 / 2 ** Z * math.cos(math.radians(ORIGIN[0]))


def tile_path(tx, ty): return os.path.join(CACHE, str(Z), str(ty), '%d.jpg' % tx)


def fetch(t):
    tx, ty = t; f = tile_path(tx, ty)
    if os.path.exists(f): return True
    os.makedirs(os.path.dirname(f), exist_ok=True)
    for _ in range(3):
        try:
            req = urllib.request.Request(URL.format(z=Z, x=tx, y=ty), headers={'User-Agent': 'austin-3d-explorer ground bake'})
            b = urllib.request.urlopen(req, timeout=30).read(); Image.open(io.BytesIO(b)).verify()
            open(f, 'wb').write(b); return True
        except Exception: pass
    return False


def mosaic(tx0, ty0, tx1, ty1):
    """RGB float32 linear mosaic of tiles [tx0, tx1) x [ty0, ty1); missing tiles are NaN."""
    a = np.full(((ty1 - ty0) * 256, (tx1 - tx0) * 256, 3), np.nan, np.float32)
    for ty in range(ty0, ty1):
        for tx in range(tx0, tx1):
            f = tile_path(tx, ty)
            if os.path.exists(f):
                a[(ty - ty0) * 256:(ty - ty0 + 1) * 256, (tx - tx0) * 256:(tx - tx0 + 1) * 256] = (np.asarray(Image.open(f).convert('RGB'), np.float32) / 255) ** 2.2
    return a


def disk(m):
    r = max(1, int(round(m / M_PER_PX / 2)))
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))


def classify(a):
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    l = 0.2126 * r + 0.7152 * g + 0.0722 * b; ls = np.maximum(l, 1e-3)
    gi = (g - np.maximum(r, b)) / ls; warm = (np.minimum(r, g) - b) / ls
    kt = max(3, int(round(TEX_M / M_PER_PX)) | 1); l0 = np.nan_to_num(l)
    mu = cv2.blur(l0, (kt, kt)); sd = np.sqrt(np.maximum(cv2.blur(l0 * l0, (kt, kt)) - mu * mu, 0)); tex = sd / np.maximum(mu, 1e-3)
    c = np.full(l.shape, OTHER, np.uint8)
    c[(gi > LAWN_GI) & (l >= CROWN_L)] = LAWN
    c[(warm > BED_WARM) & (l >= BED_L[0]) & (l < BED_L[1]) & (gi <= LAWN_GI) & (r < BED_RG * g)] = BED
    c[(l < CROWN_L) & (gi > CROWN_GI)] = LAWN                       # a green crown or green shade: planted ground (see GREEN_CROWNS)
    c[(tex > TEX_CROWN) & (warm > BED_WARM) & (gi <= LAWN_GI)] = CROWN  # a bare winter crown: unknown ground
    c[np.isnan(l)] = 0
    # majority over MODE_M: per-class box means, argmax
    k = max(3, int(round(MODE_M / M_PER_PX)) | 1)
    cls = [LAWN, BED, OTHER, CROWN]
    votes = np.stack([cv2.blur((c == v).astype(np.float32), (k, k)) for v in cls])
    out = np.array(cls, np.uint8)[votes.argmax(0)]; out[c == 0] = 0
    # crowns take the nearest seen ground's class, within CROWN_FILL_M
    seen = (out != CROWN) & (out != 0)
    d, (iy, ix) = ndimage.distance_transform_edt(~seen, return_indices=True)
    fill = out[iy, ix]
    cr = out == CROWN
    out[cr & (d * M_PER_PX <= CROWN_FILL_M)] = fill[cr & (d * M_PER_PX <= CROWN_FILL_M)]
    out[out == CROWN] = 0
    for v in (LAWN, BED):
        m = (out == v).astype(np.uint8)
        m = cv2.morphologyEx(cv2.morphologyEx(m, cv2.MORPH_OPEN, disk(OPEN_M)), cv2.MORPH_CLOSE, disk(CLOSE_M))
        out[(out == v) & (m == 0)] = OTHER
        out[(m == 1) & (out != LAWN) & (out != BED)] = v
    return out


def trace(cls, v, gx0, gy0, core):
    """polygons of class v (rings in v2 metres) whose pixels lie in the core box [cx0, cy0, cx1, cy1] (mosaic px)."""
    m = (cls == v).astype(np.uint8)
    cx0, cy0, cx1, cy1 = core
    keep = np.zeros_like(m); keep[cy0:cy1, cx0:cx1] = 1; m &= keep
    cs, hier = cv2.findContours(m, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    if hier is None: return []
    hier = hier[0]; out = []; eps = SIMPLIFY_M / M_PER_PX
    def ring(cnt):
        cnt = cv2.approxPolyDP(cnt, eps, True).reshape(-1, 2)
        if len(cnt) < 3: return None
        pts = []
        for u, w in cnt:
            lon, lat = px_lonlat(gx0 + u + 0.5, gy0 + w + 0.5)
            pts += [round((lon - ORIGIN[1]) * KX * 10), round(-(lat - ORIGIN[0]) * KZ * 10)]
        return pts
    for i, cnt in enumerate(cs):
        if hier[i][3] != -1: continue                        # holes handled with their parent
        area = cv2.contourArea(cnt) * M_PER_PX ** 2
        if area < MIN_M2: continue
        r0 = ring(cnt)
        if r0 is None: continue
        rings = [r0]; j = hier[i][2]
        while j != -1:
            if cv2.contourArea(cs[j]) * M_PER_PX ** 2 >= MIN_M2:
                h = ring(cs[j])
                if h: rings.append(h)
            j = hier[j][0]
        out.append([v] + rings)
    return out


def tiles_needed():
    man = json.load(open(MANIFEST))['buildings']
    need = set(); rad = NEAR_BUILDING_M / M_PER_PX / 256
    for b in man.values():
        gx, gy = v2_px(b['x'], b['z']); tx, ty = gx / 256, gy / 256
        for y in range(int(ty - rad), int(ty + rad) + 1):
            for x in range(int(tx - rad), int(tx + rad) + 1):
                if (x + 0.5 - tx) ** 2 + (y + 0.5 - ty) ** 2 <= (rad + 0.71) ** 2: need.add((x, y))
    return need


def debug(box, png):
    x0, z0, x1, z1 = box
    gxa, gya = v2_px(x0, z0); gxb, gyb = v2_px(x1, z1)
    tx0, ty0 = int(min(gxa, gxb) // 256), int(min(gya, gyb) // 256); tx1, ty1 = int(max(gxa, gxb) // 256) + 1, int(max(gya, gyb) // 256) + 1
    with ThreadPoolExecutor(16) as ex: list(ex.map(fetch, [(x, y) for y in range(ty0, ty1) for x in range(tx0, tx1)]))
    a = mosaic(tx0, ty0, tx1, ty1); c = classify(a)
    rgb = (np.nan_to_num(a) ** (1 / 2.2) * 255).astype(np.uint8)
    col = {LAWN: (60, 230, 60), BED: (150, 80, 20), OTHER: (128, 128, 128), 0: (255, 0, 255)}
    m = np.zeros_like(rgb)
    for k, v in col.items(): m[c == k] = v
    Image.fromarray(np.concatenate([rgb, (0.45 * rgb + 0.55 * m).astype(np.uint8)], 1)).save(png)
    print('debug', png, a.shape)


def main():
    if '--debug' in sys.argv:
        i = sys.argv.index('--debug'); return debug([float(v) for v in sys.argv[i + 1].split(',')], sys.argv[i + 2])
    need = tiles_needed()
    miss = [t for t in need if not os.path.exists(tile_path(*t))]
    print('tiles', len(need), 'to fetch', len(miss), flush=True)
    with ThreadPoolExecutor(16) as ex: ok = list(ex.map(fetch, miss))
    if miss and not all(ok): print('WARNING: %d tiles failed to fetch' % ok.count(False))
    blocks = sorted({(x // BLOCK, y // BLOCK) for x, y in need})
    feats = []; mt = (MARGIN + 255) // 256
    for bx, by in blocks:
        tx0, ty0 = bx * BLOCK - mt, by * BLOCK - mt
        tx1, ty1 = (bx + 1) * BLOCK + mt, (by + 1) * BLOCK + mt
        if not any((x, y) in need for x in range(bx * BLOCK, (bx + 1) * BLOCK) for y in range(by * BLOCK, (by + 1) * BLOCK)): continue
        a = mosaic(tx0, ty0, tx1, ty1)
        c = classify(a)
        # only pixels of needed tiles in this block's core are traced
        core_mask = np.zeros(c.shape, bool)
        for y in range(by * BLOCK, (by + 1) * BLOCK):
            for x in range(bx * BLOCK, (bx + 1) * BLOCK):
                if (x, y) in need: core_mask[(y - ty0) * 256:(y - ty0 + 1) * 256, (x - tx0) * 256:(x - tx0 + 1) * 256] = True
        c[~core_mask] = 0
        o = mt * 256
        for v in (LAWN, BED):
            feats += trace(c, v, tx0 * 256, ty0 * 256, (o - 1, o - 1, o + BLOCK * 256 + 1, o + BLOCK * 256 + 1))
    doc = {'about': 'Lawns (2) and planting beds (3) near the v2 buildings, classified from the City of Austin 2025 aerial imagery at z19 '
                    '(scripts/v2/ground_veg.py). Rings in decimetres of the v2 frame (x east, z south).',
           'classes': {'2': 'grass', '3': 'bed'}, 'unit_m': 0.1, 'f': feats}
    with open(OUT, 'w') as fh: json.dump(doc, fh, separators=(',', ':'))
    print('features', len(feats), 'lawn', sum(f[0] == LAWN for f in feats), 'bed', sum(f[0] == BED for f in feats), 'bytes', os.path.getsize(OUT))


if __name__ == '__main__':
    main()
