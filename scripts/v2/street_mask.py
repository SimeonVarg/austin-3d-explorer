#!/usr/bin/env python3
"""v2 ground, step 2: where the January aerial has building shadows and leaning roofs, as one small mask for v2/ground.js.

    python3 scripts/v2/street_mask.py [--fit] [--preview DIR]

The City's 2025 aerial was flown in January, with the sun low in the south: every building throws a long shadow north in the
photograph's pixels, and v2 then draws its own afternoon shadow on top. The shader lifts a pixel back to sunlit brightness only where
BOTH this mask says "a building's shadow in the photograph" (R) AND the pixel is dark, so a dark roof or asphalt outside the shadows
stays as it is and a mask that is a metre off does not paint a bright ghost.

R: the photograph's shadows: every building (the same outlines and heights the app extrudes: the campus file with the 2021 lidar
   heights, and the downtown massing) swept away from the photograph's sun by height / tan(elevation).
G: round tall buildings (over LEAN_MIN_H m), the outline grown by LEAN_FRAC x height (capped): where the photograph shows a leaning
   roof beside the real footprint, the shader fades the ground to plain paving.

The photograph's sun is not in any metadata. It was read off the photograph (SUN_DEFAULT: Frost Bank Tower's shadow) and checked
against mid-January solar geometry. --fit searches (azimuth, elevation) for the best match of the shadow raster against the dark
pixels of the baked z16 aerial; on 2026-10-18 it did NOT converge to a believable sun (it ran to the edge of the grid, elevation 50+,
F1 0.26-0.31) because the photograph's roofs lean off their outlines and the dark north facades they show count as "shadow". It is
kept as a tool, not used for the bake.

Writes v2/data/aerial/mask.png (RGB, MASK_M metres a pixel) and adds { mask: {file, x0, z0, x1, z1} } to v2/data/aerial/index.json.
"""
import argparse, json, math, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA = os.path.join(REPO, 'data')
OUT = os.path.join(REPO, 'v2', 'data', 'aerial')

# ── PARAMETERS ──────────────────────────────────────────────────────────
ORIGIN = {'lat': 30.28601, 'lon': -97.73932}   # v2/geo.js
EARTH_R = 6378137.0
BOX = (-1800, 1400, -1500, 3700)               # x0, x1, z0, z1 in v2 metres: the baked z16 area (street_aerial.py LEVELS[16])
MASK_M = 3.0                                   # metres a mask pixel
# The photograph's sun by region (compass bearing the light comes FROM, elevation); None = SUN_DEFAULT. A region is a z band.
SUN = [
    {'name': 'campus and West Campus', 'z0': -1500, 'z1': 1200, 'az': None, 'el': None},
    {'name': 'downtown', 'z0': 1200, 'z1': 3700, 'az': None, 'el': None},
]
SUN_DEFAULT = (165.0, 35.0)                    # read off the photograph: Frost Bank Tower's shadow runs to bearing ~345 (light from ~165), and mid-January at that azimuth in Austin the sun is ~35 deg up (11:15 local)
MIN_H = 4.0                                    # lower outlines throw too little shadow to matter
# Leaning buildings (channel G). The photograph is not a true ortho: a building's upper floors are drawn displaced away from the
# photo's centre, beside the real footprint, and show as a ghost on the ground round the 3D model (owner's lane, 2026-10-18: DKR's
# seating outside the model's west wall). Read on three buildings on the City aerial with their outlines drawn on it (10 m grid):
# the UT Tower (97 m) under 2 m (0.02 x h: the frame's centre is near it), DKR's upper west deck (68 m) about 3 m (0.05 x h), Frost
# Bank Tower (157 m) 10-15 m (about 0.08 x h). So: every Blender model's own footprint (street_footprints.mjs: where its triangles
# stand) grown by LEAN_FRAC_MODEL x its top, at least LEAN_MIN_MODEL_M; every plain extrusion over LEAN_MIN_H by LEAN_FRAC x height.
LEAN_MIN_H = 20.0
LEAN_FRAC = 0.05
LEAN_MAX_M = 10.0
LEAN_FRAC_MODEL = 0.1
LEAN_MIN_MODEL_M = 2.0
LEAN_MAX_MODEL_M = 16.0
DARK_LIN = 0.06                                # the fit counts a z16 pixel as shadow below this linear luminance
FEATHER_PX = 1.0                               # a soft edge, so the mask's own pixels never show

D2R = math.pi / 180
KX = EARTH_R * D2R * math.cos(ORIGIN['lat'] * D2R)
KZ = EARTH_R * D2R
to_local = lambda lon, lat: ((lon - ORIGIN['lon']) * KX, -(lat - ORIGIN['lat']) * KZ)


def rings_of(coords):
    """GeoJSON Polygon or MultiPolygon coordinates -> list of outer rings in local metres."""
    multi = isinstance(coords[0][0][0], (list, tuple))
    polys = coords if multi else [coords]
    return [[to_local(*p[:2]) for p in poly[0]] for poly in polys if poly and len(poly[0]) >= 3]


def buildings():
    """(outer rings, height m) for every outline the app extrudes (v2/city-worker.js: campus file + lidar, then downtown massing)."""
    campus = json.load(open(os.path.join(DATA, 'snapshots/2026-09-15/buildings.detailed.geojson')))
    lidar = json.load(open(os.path.join(DATA, 'lidar_heights.json'))).get('buildings', {})
    out, cents = [], []
    for f in campus['features']:
        p, g = f['properties'], f['geometry']
        if not g:
            continue
        h = p.get('final_height') or 9
        s = lidar.get(p['id'])
        if s and s.get('h') and not s.get('rv'):
            h = s['h']
        rings = rings_of(g['coordinates'])
        out.append((rings, h))
        cents += [np.mean(r, axis=0) for r in rings]
    down = json.load(open(os.path.join(DATA, 'outer/downtown_massing.json')))['rows']
    for r in down:
        if not r.get('g'):
            continue
        rings = rings_of(r['g'])
        if not rings:
            continue
        lv = r.get('lv')
        h = max((t for t, _ in lv), default=0) if lv else (r.get('p90') or r.get('osm_h') or r.get('city_h') or 9)
        out.append((rings, h))
    return out


def px(x, z):
    return ((x - BOX[0]) / MASK_M, (z - BOX[2]) / MASK_M)


def size():
    return int(math.ceil((BOX[1] - BOX[0]) / MASK_M)), int(math.ceil((BOX[3] - BOX[2]) / MASK_M))


def shadow_raster(blds, az, el, zband=None, step_px=1.0):
    """The shadows the photograph's sun throws: each outline swept along the shadow direction to height / tan(elevation)."""
    W, H = size()
    im = Image.new('L', (W, H), 0)
    d = ImageDraw.Draw(im)
    # light comes FROM compass bearing az; the shadow falls toward az + 180. In v2 metres: east = +x, north = -z.
    sx, sz = -math.sin(az * D2R), math.cos(az * D2R)
    k = 1 / math.tan(el * D2R)
    for rings, h in blds:
        if h < MIN_H:
            continue
        L = h * k
        n = max(1, int(L / (MASK_M * step_px)))
        for ring in rings:
            cz = sum(p[1] for p in ring) / len(ring)
            if zband and not (zband[0] <= cz < zband[1]):
                continue
            for i in range(n + 1):
                t = L * i / n
                d.polygon([px(x + sx * t, z + sz * t) for x, z in ring], fill=255)
    return im


def footprint_raster(blds, grow=None):
    W, H = size()
    im = Image.new('L', (W, H), 0)
    d = ImageDraw.Draw(im)
    for rings, h in blds:
        for ring in rings:
            d.polygon([px(x, z) for x, z in ring], fill=255)
    return im


def model_lean(path, W, H):
    """Channel G from the Blender models' real footprints, grown by their lean, max-pooled onto the mask grid."""
    from scipy import ndimage
    raw = open(path, 'rb').read()
    cols, rows = np.frombuffer(raw[:8], np.int32)
    x0, z0, cell = np.frombuffer(raw[8:20], np.float32)
    ids = np.frombuffer(raw[20:], np.uint16).reshape(rows, cols)
    meta = json.load(open(path[:-4] + '.json'))
    out = np.zeros((rows, cols), np.uint8)
    objs = ndimage.find_objects(ids)
    for k, sl in enumerate(objs):
        if sl is None:
            continue
        top = meta['tops'][k] or 10
        r = min(LEAN_MAX_MODEL_M, max(LEAN_MIN_MODEL_M, LEAN_FRAC_MODEL * top))
        pad = int(np.ceil(r / cell)) + 1
        j0, j1 = max(0, sl[0].start - pad), min(rows, sl[0].stop + pad)
        i0, i1 = max(0, sl[1].start - pad), min(cols, sl[1].stop + pad)
        sub = ids[j0:j1, i0:i1] == (k + 1)
        sub = ndimage.binary_closing(sub, iterations=2)
        dist = ndimage.distance_transform_edt(~sub) * cell
        out[j0:j1, i0:i1] = np.maximum(out[j0:j1, i0:i1], (dist <= r).astype(np.uint8) * 255)
    # onto the mask grid (same origin; MASK_M is a whole multiple of the footprint cell)
    f = int(round(MASK_M / float(cell)))
    hh, ww = min(H * f, rows), min(W * f, cols)
    g = out[:hh - hh % f, :ww - ww % f].reshape(hh // f, f, ww // f, f).max(axis=(1, 3))
    res = np.zeros((H, W), np.uint8)
    res[:g.shape[0], :g.shape[1]] = g
    return res


def lean_raster(blds):
    W, H = size()
    im = Image.new('L', (W, H), 0)
    d = ImageDraw.Draw(im)
    for rings, h in blds:
        if h < LEAN_MIN_H:
            continue
        r = min(LEAN_MAX_M, LEAN_FRAC * h) / MASK_M
        for ring in rings:
            pts = [px(x, z) for x, z in ring]
            d.polygon(pts, fill=255)
            d.line(pts + [pts[0]], fill=255, width=max(1, int(2 * r)), joint='curve')
    return im


def aerial_dark():
    """Dark pixels of the baked z16 aerial resampled onto the mask grid (1 = dark), for the fit."""
    idx = json.load(open(os.path.join(OUT, 'index.json')))['levels']['16']
    n = 2 ** 16
    W, H = size()
    lon2tx = lambda lon: (lon + 180) / 360 * n * 256
    lat2ty = lambda lat: (1 - math.log(math.tan(lat * D2R) + 1 / math.cos(lat * D2R)) / math.pi) / 2 * n * 256
    mos = np.zeros(((idx['y1'] - idx['y0'] + 1) * 256, (idx['x1'] - idx['x0'] + 1) * 256), np.float32)
    for y in range(idx['y0'], idx['y1'] + 1):
        for x in range(idx['x0'], idx['x1'] + 1):
            a = np.asarray(Image.open(os.path.join(OUT, '16', str(y), f'{x}.jpg')).convert('L'), np.float32) / 255
            mos[(y - idx['y0']) * 256:(y - idx['y0'] + 1) * 256, (x - idx['x0']) * 256:(x - idx['x0'] + 1) * 256] = a
    out = np.zeros((H, W), np.float32)
    for j in range(H):
        z = BOX[2] + (j + 0.5) * MASK_M
        lat = ORIGIN['lat'] - z / KZ
        ty = lat2ty(lat) - idx['y0'] * 256
        xs = BOX[0] + (np.arange(W) + 0.5) * MASK_M
        tx = lon2tx(ORIGIN['lon'] + xs / KX) - idx['x0'] * 256
        ok = (tx >= 0) & (tx < mos.shape[1] - 1) & (ty >= 0) & (ty < mos.shape[0] - 1)
        out[j, ok] = mos[int(ty), tx[ok].astype(int)]
    lin = out ** 2.2
    return (lin < DARK_LIN).astype(np.float32)


def fit(blds):
    dark = aerial_dark()
    foot = np.asarray(footprint_raster(blds), np.float32) / 255
    W, H = size()
    for reg in SUN:
        j0, j1 = int((reg['z0'] - BOX[2]) / MASK_M), int((reg['z1'] - BOX[2]) / MASK_M)
        tall = [(r, h) for r, h in blds if h >= 15]
        best = None
        for az in range(135, 205, 4):
            for el in range(22, 52, 4):
                s = np.asarray(shadow_raster(tall, az, el, zband=(reg['z0'], reg['z1']), step_px=2), np.float32)[j0:j1] / 255
                s = s * (1 - foot[j0:j1])
                dk = dark[j0:j1] * (1 - foot[j0:j1])
                # F1 of "shadow raster" against "dark pixels"
                tp = (s * dk).sum(); prec = tp / max(1, s.sum()); rec = tp / max(1, dk.sum())
                f1 = 2 * prec * rec / max(1e-9, prec + rec)
                if not best or f1 > best[0]:
                    best = (f1, az, el, prec, rec)
        print(f"{reg['name']}: best az {best[1]} el {best[2]}  F1 {best[0]:.3f} (precision {best[3]:.2f}, recall {best[4]:.2f})")
        # refine round the best
        f0, a0, e0 = best[0], best[1], best[2]
        for az in np.arange(a0 - 3, a0 + 3.1, 1):
            for el in np.arange(e0 - 3, e0 + 3.1, 1):
                s = np.asarray(shadow_raster(tall, az, el, zband=(reg['z0'], reg['z1']), step_px=2), np.float32)[j0:j1] / 255
                s = s * (1 - foot[j0:j1]); dk = dark[j0:j1] * (1 - foot[j0:j1])
                tp = (s * dk).sum(); prec = tp / max(1, s.sum()); rec = tp / max(1, dk.sum())
                f1 = 2 * prec * rec / max(1e-9, prec + rec)
                if f1 > best[0]:
                    best = (f1, float(az), float(el), prec, rec)
        print(f"   refined: az {best[1]} el {best[2]}  F1 {best[0]:.3f} (precision {best[3]:.2f}, recall {best[4]:.2f})")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--fit', action='store_true')
    ap.add_argument('--preview', default=None)
    ap.add_argument('--footprints', default=None, help='street_footprints.mjs output (.bin), same origin as BOX')
    a = ap.parse_args()
    blds = buildings()
    print(len(blds), 'outlines')
    if a.fit:
        fit(blds)
        return
    W, H = size()
    R = np.zeros((H, W), np.uint8)
    for reg in SUN:
        az, el = (reg['az'], reg['el']) if reg['az'] is not None else SUN_DEFAULT
        s = np.asarray(shadow_raster(blds, az, el, zband=(reg['z0'], reg['z1'])), np.uint8)
        R = np.maximum(R, s)
    G = np.asarray(lean_raster(blds), np.uint8)
    if a.footprints:
        G = np.maximum(G, model_lean(a.footprints, W, H))
    img = Image.merge('RGB', [Image.fromarray(R).filter(ImageFilter.GaussianBlur(FEATHER_PX)),
                              Image.fromarray(G).filter(ImageFilter.GaussianBlur(FEATHER_PX)), Image.new('L', (W, H), 0)])
    # the mask's border must be empty (the shader clamps at the edge)
    arr = np.asarray(img).copy(); arr[0, :] = 0; arr[-1, :] = 0; arr[:, 0] = 0; arr[:, -1] = 0
    img = Image.fromarray(arr)
    path = os.path.join(OUT, 'mask.png')
    img.save(path, optimize=True)
    idx_p = os.path.join(OUT, 'index.json')
    idx = json.load(open(idx_p))
    idx['mask'] = {'file': 'mask.png', 'x0': BOX[0], 'z0': BOX[2], 'x1': BOX[0] + W * MASK_M, 'z1': BOX[2] + H * MASK_M,
                   'about': 'R = the photograph\'s building shadows, G = round tall buildings (leaning roofs); scripts/v2/street_mask.py'}
    json.dump(idx, open(idx_p, 'w'), indent=1)
    print(path, img.size, os.path.getsize(path), 'bytes')
    if a.preview:
        os.makedirs(a.preview, exist_ok=True)
        img.save(os.path.join(a.preview, 'mask_preview.png'))


if __name__ == '__main__':
    main()
