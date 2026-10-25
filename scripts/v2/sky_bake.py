"""Real captured skies for v2 (?sky=NAME, and the sky of a moment): CC0 HDRIs from Poly Haven -> v2/data/sky/.

  python scripts/v2/sky_bake.py HDR_DIR OUT_DIR [WIDTH]

For each sky in SKIES (key -> Poly Haven id), from HDR_DIR/<id>_4k.hdr:
  1. the SUN is found (pixels far brighter than the sky round them), its direction (column u, elevation) and its energy (normal
     irradiance, rgb, in the HDRI's own units) are measured, and its disc is painted out: the app draws its own sun (a light with
     shadows); leaving the disc in the sky would light every surface twice;
  2. the sky's light on a level surface (rgb, the HDRI's units, upper half) is measured;
  3. the upper half (horizon to zenith) is written as an sRGB WebP, WIDTH x WIDTH/4, linear radiance / WHITE (WHITE = a high
     percentile of the sky, so cloud detail keeps its 8 bits; brighter than WHITE clips, only round the sun);
  4. skies.json: per sky the file, the sun (u, elevation, energy), WHITE, the level irradiance, the source and its licence.
The app (v2/sky-real.js) turns these into the visible dome, the mirror environment and the diffuse light, in Light B's units.
"""
import json, os, sys
import numpy as np
import cv2

# key -> (Poly Haven id, what it is[, the sun's elevation, degrees, for a sky with no sun disc: where the app's light stands with
# ?sky=NAME and no moment; its azimuth is the sky's brightest part]). All CC0 (polyhaven.com/license).
SKIES = {
    'clear_afternoon': ('qwantani_afternoon_puresky', 'clear afternoon'),
    'cumulus': ('kloofendal_48d_partly_cloudy_puresky', 'scattered cumulus, sun 48 degrees up'),
    'cirrus': ('rocky_ridge_puresky', 'high cirrus streaks'),
    'golden_hour': ('qwantani_late_afternoon_puresky', 'golden hour, clear'),
    'sunset_veil': ('belfast_sunset_puresky', 'sunset under a grey cloud veil', 1.0),
    'sunset_streaks': ('evening_road_01_puresky', 'sunset, cirrus streaks and altocumulus', 2.0),
    'blue_hour': ('qwantani_dusk_2_puresky', 'blue hour, after sunset', -4.0),
    'night_city': ('kloppenheim_07_puresky', 'night, overcast, lit by a town', -15.0),
}
SUN_K = 30.0       # a pixel is sun when it is this many times brighter than the 99th percentile of the sky
WHITE_PCT = 99.9   # the texture's white = this percentile of the sky's luminance (sun removed) ...
WHITE_MAX_X_MEDIAN = 24.0   # ... but at most this many times the sky's median (so the blue keeps its precision)
LUM = np.array([0.0722, 0.7152, 0.2126], np.float32)   # BGR


def lin2srgb(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def bake(src, out_dir, key, width):
    hdr = cv2.imread(src, cv2.IMREAD_ANYDEPTH | cv2.IMREAD_COLOR).astype(np.float32)   # BGR linear
    H, W = hdr.shape[:2]
    up = hdr[: H // 2].copy()
    h = up.shape[0]
    el = (90.0 - (np.arange(h) + 0.5) / H * 180.0) * np.pi / 180      # elevation of each row
    dOmega = (np.cos(el) * (np.pi / H) * (2 * np.pi / W))[:, None]
    L = up @ LUM
    p99 = float(np.percentile(L, 99))
    sun = L > SUN_K * p99
    info = {'sun': None}
    if sun.sum() > 0:
        n, lab, stats, cent = cv2.connectedComponentsWithStats(sun.astype(np.uint8))
        big = 1 + int(np.argmax([(L[lab == i]).sum() for i in range(1, n)]))
        m = (lab == big)
        m = cv2.dilate(m.astype(np.uint8), np.ones((7, 7), np.uint8)).astype(bool)
        ring = cv2.dilate(m.astype(np.uint8), np.ones((15, 15), np.uint8)).astype(bool) & ~m
        base = up[ring].mean(0)
        ys, xs = np.nonzero(m)
        w = np.clip(L[m] - base @ LUM, 0, None)
        E = ((up[m] - base) * dOmega[ys]).sum(0)
        cy, cx = (ys * w).sum() / w.sum(), (xs * w).sum() / w.sum()
        info['sun'] = {'u': float((cx + 0.5) / W), 'el_deg': float(90.0 - (cy + 0.5) / H * 180.0),
                       'E_rgb': [float(E[2]), float(E[1]), float(E[0])], 'px': int(m.sum())}
        # paint the disc out (per channel, in log space, on a crop round it)
        y0, y1, x0, x1 = max(0, ys.min() - 40), min(h, ys.max() + 41), max(0, xs.min() - 40), min(W, xs.max() + 41)
        mm = m[y0:y1, x0:x1].astype(np.uint8)
        for c in range(3):
            crop = np.log(np.maximum(up[y0:y1, x0:x1, c], 1e-6)).astype(np.float32)
            up[y0:y1, x0:x1, c] = np.exp(cv2.inpaint(crop, mm, 5, cv2.INPAINT_TELEA))
        L = up @ LUM
    if info['sun'] is None:
        # no disc (the sun is set, veiled or below): the brightest part of the sky (heavily smoothed) stands for its azimuth
        sm = cv2.GaussianBlur(L, (0, 0), W / 200)
        cy, cx = np.unravel_index(int(np.argmax(sm)), sm.shape)
        info['glow'] = {'u': float((cx + 0.5) / W), 'el_deg': float(90.0 - (cy + 0.5) / H * 180.0)}
    Es = (up * (np.sin(el)[:, None, None] * dOmega[:, :, None])).sum((0, 1))
    med = float(np.median(L))
    white = float(min(np.percentile(L, WHITE_PCT), WHITE_MAX_X_MEDIAN * med))
    img = cv2.resize(up, (width, width // 4), interpolation=cv2.INTER_AREA)
    enc = (lin2srgb(img / white) * 255 + 0.5).astype(np.uint8)
    fn = key + '.webp'
    cv2.imwrite(os.path.join(out_dir, fn), enc, [cv2.IMWRITE_WEBP_QUALITY, 92])
    clip = float((L > white).mean())
    info.update({'file': fn, 'size': [width, width // 4], 'white': white, 'median': med,
                 'E_sky_level_rgb': [float(Es[2]), float(Es[1]), float(Es[0])], 'clipped_share': round(clip, 5),
                 'bytes': os.path.getsize(os.path.join(out_dir, fn))})
    return info


if __name__ == '__main__':
    hdr_dir, out_dir = sys.argv[1], sys.argv[2]
    width = int(sys.argv[3]) if len(sys.argv) > 3 else 4096
    os.makedirs(out_dir, exist_ok=True)
    out = {'note': 'Real captured skies (v2/sky-real.js). Upper half of each HDRI (horizon to zenith), sRGB WebP of linear radiance / white, '
                   'sun painted out and measured (u = its column, 0..1, in the image; el_deg; E_rgb = its normal irradiance in the HDRI units). '
                   'Source: Poly Haven, CC0. Baked by scripts/v2/sky_bake.py.',
           'skies': {}}
    for key, (pid, what, *guess) in SKIES.items():
        src = os.path.join(hdr_dir, pid + '_4k.hdr')
        info = bake(src, out_dir, key, width)
        info.update({'what': what, 'source': 'https://polyhaven.com/a/' + pid, 'licence': 'CC0'})
        if guess and 'glow' in info: info['glow']['sun_el_deg'] = guess[0]
        out['skies'][key] = info
        s = info['sun']
        if not s: s = info.get('glow')
        print(key, pid, 'sun' if info['sun'] else 'glow', s and ('u %.3f el %.1f E %.1f px %d' % (s['u'], s['el_deg'], s.get('E_rgb', [0, 0, 0])[1], s.get('px', 0))),
              'Esky %.2f' % info['E_sky_level_rgb'][1], 'white %.2f med %.3f clip %.4f' % (info['white'], info['median'], info['clipped_share']),
              '%.2f MB' % (info['bytes'] / 1e6))
    json.dump(out, open(os.path.join(out_dir, 'skies.json'), 'w'), indent=1)
