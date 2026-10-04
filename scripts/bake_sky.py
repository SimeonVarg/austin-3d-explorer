#!/usr/bin/env python3
"""bake_sky.py - the cloud panoramas for the GL sky (js/sky.js, SKY_COMP.mode = 'gl').

Owns ONE output folder, data/sky/, and nothing else writes it:

    data/sky/clouds-a.jpg    look A: a real photographed sky (a CC0 HDRI), reduced to the two
                             channels below. The photograph's colour is thrown away.
    data/sky/clouds-b.jpg    look B: generated, soft high thin cloud with a few scattered puffs
    data/sky/clouds.json     what the shader needs to know about the files

WHAT A FILE IS. An equirectangular strip of the sky as seen from the ground:
columns are azimuth 0..360 degrees (the left edge and the right edge are the SAME
direction, so it wraps), rows run from ELEV_MAX degrees at the top to the horizon at
the bottom. It is opaque RGB because a browser premultiplies an image that has an
alpha channel and that would wreck the data:

    R  coverage: how opaque the cloud is along this line of sight (0 = clear blue)
    G  self-shade: how much of the sky's light is blocked by cloud above this
       point (0 = bright top, 1 = deep in shadow). Not a colour: the shader
       relights it with the hour's lit and shade colours.
    B  always 0. (The generated look used to store a cloud height here; nothing read it,
       and an empty channel is free in a JPEG.)

LOOK A, FROM A PHOTOGRAPH. Needs the 4k .hdr on disk (it is NOT in the repo; see
PHOTO below) and only ever runs on the machine that has it:
  * the upper hemisphere's 0..ELEV_MAX band is cut out of the equirectangular image;
  * COVERAGE is how far a pixel is from clear-sky blue. Blue minus red falls to nothing
    in white cloud, so it is compared with the clear-sky value around it (a big running
    maximum, smoothed). That alone also picks up the haze around the sun, which is
    smooth, so a texture gate keeps only the neighbourhood of real cloud edges;
  * the sun disc and its glare are masked out (the app draws its own sun);
  * SELF-SHADE is how dark a cloud pixel is against the brightest cloud near it, which is
    the photograph's own bright-tops / grey-bases, with the colour discarded;
  * the columns are rolled so the photograph's sun lands on SUN_AZ_OUT. The shader also
    has a runtime rotation (SKY_TUNE.GL.ROT) for a one-line change.
  * the file wraps because the source is a full 360 degree image; the seam is verified
    below, not blurred.
  * the zenith pinch of an equirectangular map is not in the strip at all: the strip stops
    at ELEV_MAX, where a column is only 1/cos(45) = 1.41 times wider than at the horizon.

LOOK B, GENERATED. Real volume rendering, offline. A periodic 2D field says where the
cloud columns are and how tall each is; a periodic 3D noise erodes the edges into
billows; every pixel of the panorama marches a ray from the ground up through the
cloud slab and sums the density it meets. Perspective therefore comes for free:
the slab is seen edge-on near the horizon (clouds crowd together and shrink, with
flat bases) and from below overhead. The panorama wraps because the WORLD is the
same in every direction at azimuth 0 and 360; nothing is blended to hide a seam.

    python scripts/bake_sky.py                       # both looks, full size
    python scripts/bake_sky.py --look B              # only the generated look (no photo needed)
    python scripts/bake_sky.py --look A --sun-az 200 # rotate the photograph's sun to 200 degrees
    python scripts/bake_sky.py --look B --w 1024 --h 128 --preview DIR
"""
import argparse
import json
import math
import os
import sys
import time
from multiprocessing import Pool
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, map_coordinates

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'sky'

# ---- taste values: every look is a dict of numbers, nothing is buried below ------
ELEV_MAX = 45.0           # degrees from the horizon to the top row
DOMAIN_M = 48000.0        # the periodic world repeats every 48 km
MASK_N = 512              # columns-field resolution (94 m a texel)
ERO_N = 64                # 3D erosion tile
STEPS = 56                # ray samples through a slab, spaced by distance

LOOKS = {
    'B': {
        'seed': 20261005,
        'layers': [
            dict(                              # the high thin layer, drawn first (behind)
                kind='sheet',
                z0=7500.0, thick=700.0,
                cover=0.40, feature_km=6.5, beta=2.5, soft=0.65,
                stretch=2.6,                   # streaks along the wind
                erosion=0.40, ero_km=2.2,
                kappa=0.00075, dens=1.0, far_km=240.0,
            ),
            dict(                              # a few scattered puffs in front
                kind='cumulus',
                z0=2100.0, thick=1100.0,
                cover=0.07, feature_km=9.0, beta=2.8, soft=0.08,
                top_pow=0.8, top_jitter=0.3, base_ramp=0.08, top_start=0.5,
                erosion=0.45, ero_km=0.8, kappa=0.0105, dens=1.0, far_km=60.0,
                seam_cloud=True,
            ),
        ],
    },
}

# ---- look A: the photograph ---------------------------------------------------------
# Polyhaven "kloofendal_48d_partly_cloudy_puresky", 4k, CC0. Kept OUT of the repo; the bake
# reads it from --hdr or $SKY_HDR.
PHOTO = {
    'env': 'SKY_HDR',
    'sun_az_out': 180.0,          # where the photograph's sun is rolled to, compass degrees (180 = due south)
    'sun_mask_deg': (7.0, 13.0),  # coverage is zero inside the first radius, full outside the second
    'chroma_lo': 0.16, 'chroma_hi': 0.62,   # blue-minus-red against the clear sky, remapped to coverage
    'clear_win_deg': (2.7, 56.0), # running-maximum window for the clear-sky reference: (rows, columns) as degrees
    'gate_lo': 0.012, 'gate_hi': 0.045,     # texture (log-luminance high pass) that counts as cloud edge
    'gate_grow_px': 19,           # how far from a textured edge cloud interior may reach
    'shade_win_px': 41,           # window for "the brightest cloud near this pixel"
    'shade_gain': 1.0 / 0.70,     # contrast on the self-shade
    'shade_floor': 0.5,           # shade written where there is no cloud at all
}


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def uniform_field(n, rng, beta, feature_cells, stretch=1.0):
    """A periodic n x n field with power ~ k^-beta, mapped to a uniform [0,1] distribution
    (so a threshold IS a coverage fraction). `feature_cells` is the wavelength of the lowest
    kept frequency, in texels."""
    kx = np.fft.fftfreq(n) * n
    ky = np.fft.rfftfreq(n) * n
    KX, KY = np.meshgrid(kx, ky, indexing='ij')
    k = np.sqrt((KX / stretch) ** 2 + KY ** 2)
    k[0, 0] = 1.0
    amp = k ** (-beta / 2.0)
    klo = n / max(feature_cells, 2.0) * 0.55
    amp *= smoothstep(klo * 0.5, klo, k)                 # no scales bigger than a cell
    amp *= 1.0 - smoothstep(n * 0.3, n * 0.5, k)         # no pixel-level noise
    amp[0, 0] = 0.0
    spec = np.fft.rfft2(rng.standard_normal((n, n))) * amp
    f = np.fft.irfft2(spec, s=(n, n))
    order = np.argsort(f.ravel())
    u = np.empty(f.size)
    u[order] = (np.arange(f.size) + 0.5) / f.size
    return u.reshape(n, n).astype(np.float32)


def erosion_volume(n, rng, beta=2.1):
    """Periodic 3D noise in [0,1], for billowy edges."""
    k1 = np.fft.fftfreq(n) * n
    k2 = np.fft.rfftfreq(n) * n
    KX, KY, KZ = np.meshgrid(k1, k1, k2, indexing='ij')
    k = np.sqrt(KX ** 2 + KY ** 2 + KZ ** 2)
    k[0, 0, 0] = 1.0
    amp = k ** (-beta / 2.0)
    amp[0, 0, 0] = 0.0
    amp *= 1.0 - smoothstep(n * 0.3, n * 0.5, k)
    f = np.fft.irfftn(np.fft.rfftn(rng.standard_normal((n, n, n))) * amp, s=(n, n, n))
    f = (f - f.mean()) / (f.std() + 1e-9)
    return np.clip(0.5 + 0.28 * f, 0.0, 1.0).astype(np.float32)


class Layer:
    """One cloud slab: its column field, its erosion, and a way to march a ray through it."""

    def __init__(self, cfg, seed):
        self.c = cfg
        rng = np.random.default_rng(seed)
        cell = cfg['feature_km'] * 1000.0 / (DOMAIN_M / MASK_N)
        self.mask = uniform_field(MASK_N, rng, cfg['beta'], cell * 2.0, cfg.get('stretch', 1.0))
        self.mask2 = uniform_field(MASK_N, rng, 2.4, cell * 1.0)
        self.ero = erosion_volume(ERO_N, rng)
        if cfg.get('seam_cloud'):
            # Plant a firm cloud on the wrap line (north, 12 km out) so the seam is tested
            # on cloud, and so the file's two edges visibly continue each other.
            self._plant(0.0, 16000.0, 1700.0)
            self._plant(0.0, 32000.0, 2800.0)
        self.thr = 1.0 - cfg['cover']
        # Heights come from a smoothed copy so tops are domes, not spikes.
        self.smooth = gaussian_filter(self.mask, sigma=cfg.get('dome_sigma', 3.0), mode='wrap')
        lo, hi = np.percentile(self.smooth, [100 * self.thr, 99.5])
        self.smooth_lo, self.smooth_hi = float(lo), float(hi)

    def _plant(self, x_m, y_m, r_m):
        n = MASK_N
        px = (x_m % DOMAIN_M) / DOMAIN_M * n
        py = (y_m % DOMAIN_M) / DOMAIN_M * n
        gx = (np.arange(n)[:, None] - px + n / 2) % n - n / 2
        gy = (np.arange(n)[None, :] - py + n / 2) % n - n / 2
        r = r_m / (DOMAIN_M / n)
        bump = np.exp(-(gx * gx + gy * gy) / (2 * (r * 0.55) ** 2))
        self.mask = np.maximum(self.mask, (0.80 + 0.2 * self.mask2) * bump).astype(np.float32)

    def march(self, az, el, jit):
        """Rays given by azimuth/elevation arrays (radians); returns alpha, shade, height."""
        c = self.c
        z0, thick = c['z0'], c['thick']
        ztop = z0 + thick
        n = az.size
        sin_e, cos_e = np.sin(el), np.cos(el)
        sa, ca = np.sin(az), np.cos(az)
        lr = math.log(ztop / z0)
        T = np.ones(n, np.float32)
        shade = np.zeros(n, np.float32)
        hh = np.zeros(n, np.float32)
        wsum = np.zeros(n, np.float32)
        kappa, dens = c['kappa'], c['dens']
        far = c['far_km'] * 1000.0
        sc = MASK_N / DOMAIN_M
        for i in range(STEPS):
            u = (i + jit) / STEPS
            z = (z0 * np.exp(lr * u)).astype(np.float32)
            t = z / sin_e
            dt = t * lr / STEPS
            dh = t * cos_e                                      # horizontal distance
            x = dh * sa
            y = dh * ca
            col = map_coordinates(self.mask, [x * sc, y * sc], order=1, mode='grid-wrap')
            if c['kind'] == 'cumulus':
                cov = smoothstep(self.thr - c['soft'] * 0.5, self.thr + c['soft'] * 0.5, col)
                col2 = map_coordinates(self.mask2, [x * sc, y * sc], order=1, mode='grid-wrap')
                cs = map_coordinates(self.smooth, [x * sc, y * sc], order=1, mode='grid-wrap')
                tcore = np.clip((cs - self.smooth_lo) / (self.smooth_hi - self.smooth_lo), 0.0, 1.0) ** c['top_pow']
                height = thick * (0.06 + 0.94 * tcore) * (1.0 - c['top_jitter'] + c['top_jitter'] * col2 * 2.0).clip(0.2, 1.2)
                top = z0 + np.maximum(height, 1.0)
                h = (z - z0) / np.maximum(top - z0, 1.0)
                inside = (h > 0.0) & (h < 1.0) & (cov > 0.0)
                shape = smoothstep(0.0, c['base_ramp'], h) * (1.0 - smoothstep(c['top_start'], 1.0, h) ** 1.4)
                rho0 = shape * cov
                col_tau = kappa * dens * np.maximum(top - z0, 0.0) * 0.55
            else:                                               # a thin sheet, symmetric profile
                cov = smoothstep(self.thr - c['soft'] * 0.5, self.thr + c['soft'] * 0.5, col)
                h = ((z - z0) / thick).astype(np.float32)
                shape = smoothstep(0.0, 0.5, h) * (1.0 - smoothstep(0.5, 1.0, h))
                inside = cov > 0.0
                rho0 = shape * cov
                col_tau = kappa * dens * thick * 0.5 * cov
            ec = (x / (c['ero_km'] * 1000.0) % 1.0) * ERO_N
            ey = (y / (c['ero_km'] * 1000.0) % 1.0) * ERO_N
            ez = (z / (c['ero_km'] * 1000.0 * 0.7) % 1.0) * ERO_N
            e3 = map_coordinates(self.ero, [ec, ey, ez], order=1, mode='grid-wrap')
            er = c['erosion']
            rho = np.clip((rho0 - er * (1.0 - e3) * 1.0 + 0.0) / (1.0 - er * 0.55), 0.0, 1.0) * dens
            rho = np.where(inside, rho, 0.0)
            # clouds thin into haze with distance
            rho = rho * np.exp(-(dh / far) ** 2)
            dtau = kappa * rho * dt
            w = T * (1.0 - np.exp(-dtau))
            T = T * np.exp(-dtau)
            # Light from above: how much of the column's own cloud lies above this point.
            above = col_tau * np.clip(1.0 - np.clip(h, 0.0, 1.0), 0.0, 1.0)
            sh = 1.0 - np.exp(-c.get('shade_k', 0.18) * above)
            shade += w * sh
            hh += w * np.clip(h, 0.0, 1.0)
            wsum += w
        alpha = 1.0 - T
        ok = wsum > 1e-6
        shade = np.where(ok, shade / np.maximum(wsum, 1e-6), 0.0)
        hh = np.where(ok, hh / np.maximum(wsum, 1e-6), 0.0)
        return alpha, shade, hh


# ---- worker plumbing (Windows spawns, so each worker rebuilds the same fields) --------
_G = {}


def _init(look, seed_off):
    cfg = LOOKS[look]
    _G['layers'] = [Layer(l, cfg['seed'] + 101 * i + seed_off) for i, l in enumerate(cfg['layers'])]


def _render_rows(job):
    j0, j1, w, h, ss = job
    # supersample in azimuth, average back down
    ws = w * ss
    cols = (np.arange(ws) + 0.5) / ws * 2 * math.pi
    rows = np.arange(j0, j1)
    el = (1.0 - (rows + 0.5) / h) * math.radians(ELEV_MAX)
    el = np.maximum(el, math.radians(0.12))
    AZ, EL = np.meshgrid(cols, el)
    rng = np.random.default_rng(1234 + j0)
    jit = rng.random(AZ.shape).astype(np.float32).ravel()
    az, e = AZ.ravel().astype(np.float32), EL.ravel().astype(np.float32)
    # back layers first
    A = np.zeros(az.size, np.float32)
    S = np.zeros(az.size, np.float32)
    B = np.zeros(az.size, np.float32)
    for layer in _G['layers']:
        # march in blocks to bound memory
        a = np.empty_like(A)
        s = np.empty_like(A)
        b = np.empty_like(A)
        blk = 200000
        for k in range(0, az.size, blk):
            a[k:k + blk], s[k:k + blk], b[k:k + blk] = layer.march(az[k:k + blk], e[k:k + blk], jit[k:k + blk])
        # front layer over what is already there
        wnew = a * (1.0 - A)
        tot = A + wnew
        S = np.where(tot > 1e-6, (S * A + s * wnew) / np.maximum(tot, 1e-6), 0.0)
        B = np.where(tot > 1e-6, (B * A + b * wnew) / np.maximum(tot, 1e-6), 0.0)
        A = tot
    shp = (len(rows), ws)
    out = np.stack([A.reshape(shp), S.reshape(shp), B.reshape(shp)], axis=-1)
    out = out.reshape(len(rows), w, ss, 3).mean(axis=2)
    return j0, out.astype(np.float32)


def bake(look, w, h, ss, procs, preview=None, seed_off=0):
    t0 = time.time()
    chunk = max(4, h // (procs * 3))
    jobs = [(j, min(h, j + chunk), w, h, ss) for j in range(0, h, chunk)]
    img = np.zeros((h, w, 3), np.float32)
    with Pool(procs, initializer=_init, initargs=(look, seed_off)) as pool:
        for j0, part in pool.imap_unordered(_render_rows, jobs):
            img[j0:j0 + part.shape[0]] = part
    # A touch of blur near the horizon where one texel is many kilometres of cloud, so the
    # far field reads as haze instead of shimmer.
    for j in range(h):
        wgt = smoothstep(0.55, 1.0, j / h)
        if wgt > 0.01:
            s = 0.4 + 1.6 * wgt
            img[j] = gaussian_filter(img[j], sigma=(s, 0), mode='wrap')
    # contrast: alpha curve (tune in one place)
    a = img[..., 0]
    img[..., 0] = np.clip(a, 0, 1) ** 0.92
    print(f'look {look}: {w}x{h} ss{ss} in {time.time() - t0:.1f}s; coverage mean R {img[..., 0].mean():.3f}', flush=True)
    return img


def read_rgbe(path):
    """Radiance .hdr (new-style run-length) -> float32 (h, w, 3) linear RGB."""
    with open(path, 'rb') as f:
        data = f.read()
    pos = 0
    while True:
        e = data.index(b'\n', pos)
        line = data[pos:e]
        pos = e + 1
        if line.strip() == b'':
            break
    e = data.index(b'\n', pos)
    res = data[pos:e].split()
    pos = e + 1
    if res[0] != b'-Y' or res[2] != b'+X':
        raise SystemExit(f'unsupported HDR orientation {res}')
    h, w = int(res[1]), int(res[3])
    buf = np.frombuffer(data, dtype=np.uint8)
    out = np.zeros((h, w, 4), np.uint8)
    for y in range(h):
        if not (buf[pos] == 2 and buf[pos + 1] == 2 and ((int(buf[pos + 2]) << 8) | int(buf[pos + 3])) == w):
            raise SystemExit('unsupported HDR encoding (expected new-style run-length)')
        pos += 4
        for c in range(4):
            x = 0
            while x < w:
                n = int(buf[pos]); pos += 1
                if n > 128:
                    n -= 128
                    out[y, x:x + n, c] = buf[pos]; pos += 1
                else:
                    out[y, x:x + n, c] = buf[pos:pos + n]; pos += n
                x += n
    ex = out[..., 3].astype(np.int32)
    scale = np.where(ex == 0, 0.0, np.ldexp(1.0, ex - (128 + 8))).astype(np.float32)
    return out[..., :3].astype(np.float32) * scale[..., None]


def bake_photo(path, sun_az_out, w, h):
    """Look A: the HDR's 0..ELEV_MAX band reduced to coverage and self-shade. Returns img, info."""
    from scipy.ndimage import maximum_filter
    P = PHOTO
    t0 = time.time()
    rgb = read_rgbe(path)
    H0, W0 = rgb.shape[:2]
    lum_all = rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    up = lum_all[:H0 // 2]
    # the sun: the brightest spot of the upper hemisphere, found on a lightly smoothed copy
    sm = gaussian_filter(up, sigma=2.0, mode=('nearest', 'wrap'))
    iy, ix = np.unravel_index(int(np.argmax(sm)), sm.shape)
    sun_az_in = (ix + 0.5) / W0 * 360.0
    sun_el = 90.0 - (iy + 0.5) / H0 * 180.0
    # roll the columns so the sun sits at sun_az_out, then cut the band 0..ELEV_MAX
    shift = int(round((sun_az_out - sun_az_in) / 360.0 * W0))
    rgb = np.roll(rgb, shift, axis=1)
    r0 = int(round((90.0 - ELEV_MAX) / 180.0 * H0)); r1 = H0 // 2
    strip = rgb[r0:r1].copy()
    del rgb
    Hs, Ws = strip.shape[:2]
    r, b = strip[..., 0], strip[..., 2]
    lum = strip @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    wrap = ('nearest', 'wrap')
    # coverage
    D = b - r
    rows_px = max(3, int(round(P['clear_win_deg'][0] / ELEV_MAX * Hs))) | 1
    cols_px = max(3, int(round(P['clear_win_deg'][1] / 360.0 * Ws))) | 1
    ref = maximum_filter(D, size=(rows_px, cols_px), mode=wrap)
    ref = gaussian_filter(ref, sigma=(rows_px * 0.58, cols_px * 0.094), mode=wrap)
    raw = np.clip(1.0 - D / np.maximum(ref, 1e-3), 0.0, 1.0)
    cov = smoothstep(P['chroma_lo'], P['chroma_hi'], raw)
    # texture gate: keep what is within reach of a real cloud edge, drop the smooth haze
    lg = np.log(lum + 0.05)
    hp = np.abs(lg - gaussian_filter(lg, sigma=3.0, mode=wrap))
    hp = gaussian_filter(hp, sigma=5.0, mode=wrap)
    gate = smoothstep(P['gate_lo'], P['gate_hi'], hp)
    g = int(P['gate_grow_px']) | 1
    gate = gaussian_filter(maximum_filter(gate, size=(g, g), mode=wrap), sigma=5.0, mode=wrap)
    cov = cov * gate
    # the sun and its glare: the app draws the only sun
    az = (np.arange(Ws) + 0.5) / Ws * 360.0
    el = ELEV_MAX - (np.arange(Hs) + 0.5) / Hs * ELEV_MAX
    AZ, EL = np.meshgrid(az, el)
    def dv(a, e):
        a, e = np.radians(a), np.radians(e)
        return np.cos(e) * np.sin(a), np.cos(e) * np.cos(a), np.sin(e)
    x1, y1, z1 = dv(AZ, EL); x0, y0, z0 = dv(sun_az_out, sun_el)
    ang = np.degrees(np.arccos(np.clip(x1 * x0 + y1 * y0 + z1 * z0, -1, 1)))
    cov = cov * smoothstep(P['sun_mask_deg'][0], P['sun_mask_deg'][1], ang)
    # self-shade: how dark this pixel is against the brightest cloud near it
    k = int(P['shade_win_px']) | 1
    lref = maximum_filter(np.where(cov > 0.4, lum, 0.0).astype(np.float32), size=(k, k), mode=wrap)
    lref = gaussian_filter(lref, sigma=k / 4.5, mode=wrap)
    sh = np.clip(1.0 - lum / np.maximum(lref, 1e-3), 0.0, 1.0)
    sh = np.clip(sh * P['shade_gain'], 0.0, 1.0)
    wgt = smoothstep(0.2, 0.7, cov)
    num = gaussian_filter(sh * wgt, sigma=6.0, mode=wrap)
    den = gaussian_filter(wgt, sigma=6.0, mode=wrap)
    fill = num / np.maximum(den, 1e-3)
    sh = np.where(den > 1e-3, sh * wgt + fill * (1.0 - wgt), P['shade_floor'])
    img = np.stack([cov, sh, np.zeros_like(cov)], axis=-1).astype(np.float32)
    if (w, h) != (Ws, Hs):
        im = [np.asarray(Image.fromarray(img[..., c]).resize((w, h), Image.LANCZOS)) for c in range(3)]
        img = np.clip(np.stack(im, axis=-1), 0.0, 1.0)
    print(f'look A: photo {W0}x{H0} -> {w}x{h} in {time.time() - t0:.1f}s; sun found at az {sun_az_in:.1f} el {sun_el:.1f}, '
          f'rolled to az {sun_az_out:.1f}; coverage mean {img[..., 0].mean():.3f}', flush=True)
    return img, {'sunAzDeg': sun_az_out, 'sunElevDeg': round(float(sun_el), 1), 'sunAzInSource': round(float(sun_az_in), 1)}


def seam_report(img):
    """Last column against the first, as a multiple of a typical neighbouring-column step."""
    edge = np.abs(img[:, -1, :2] - img[:, 0, :2]).mean()
    typ = np.abs(img[:, 1:, :2] - img[:, :-1, :2]).mean()
    return float(edge), float(typ)


def save_jpeg(img, path, quality):
    rgb = np.clip(img * 255.0 + 0.5, 0, 255).astype(np.uint8)
    rgb[..., 2] = 0                      # blue is unused: an empty channel is free in a JPEG
    im = Image.fromarray(rgb)
    im.save(path, 'JPEG', quality=quality, subsampling=0, optimize=True)
    return os.path.getsize(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--look', default='AB')
    ap.add_argument('--w', type=int, default=4096)
    ap.add_argument('--h', type=int, default=512)
    ap.add_argument('--ss', type=int, default=2)
    ap.add_argument('--quality', type=int, default=88)
    ap.add_argument('--procs', type=int, default=max(2, (os.cpu_count() or 4) - 2))
    ap.add_argument('--preview', default=None, help='write a viewable preview png here instead of data/sky')
    ap.add_argument('--seed', type=int, default=0)
    ap.add_argument('--hdr', default=os.environ.get(PHOTO['env']), help='the photographed sky (.hdr) for look A; or set $' + PHOTO['env'])
    ap.add_argument('--sun-az', type=float, default=PHOTO['sun_az_out'], help="compass azimuth the photograph's sun is rolled to")
    a = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    meta = {
        'elevMax': ELEV_MAX, 'layout': 'rows: elevation ELEV_MAX at the top to 0 at the bottom; columns: azimuth 0..360, wraps',
        'channels': {'r': 'coverage', 'g': 'self-shade (0 lit .. 1 shaded)', 'b': 'unused, 0'},
        'looks': {}, 'bakedBy': 'scripts/bake_sky.py',
    }
    for look in a.look.upper():
        extra = {}
        if look == 'A':
            if not a.hdr or not os.path.exists(a.hdr):
                print('look A needs the photographed sky: pass --hdr FILE or set $' + PHOTO['env'] + '; skipped', flush=True)
                continue
            img, extra = bake_photo(a.hdr, a.sun_az, a.w, a.h)
        else:
            img = bake(look, a.w, a.h, a.ss, a.procs, seed_off=a.seed)
        edge, typ = seam_report(img)
        print(f'  wrap seam: last column vs first {edge:.4f}, typical neighbouring columns {typ:.4f} ({edge / max(typ, 1e-6):.2f}x)', flush=True)
        if a.preview:
            os.makedirs(a.preview, exist_ok=True)
            p = Path(a.preview) / f'clouds-{look.lower()}.jpg'
            size = save_jpeg(img, p, a.quality)
            # and a human-readable view: coverage as white over blue, shaded
            cov, sh = img[..., 0:1], img[..., 1:2]
            blue = np.array([0.36, 0.58, 0.85])
            lit = np.array([1.0, 1.0, 1.0]); dark = np.array([0.55, 0.60, 0.70])
            col = lit * (1 - sh) + dark * sh
            rgb = blue * (1 - cov) + col * cov
            Image.fromarray(np.clip(rgb * 255, 0, 255).astype(np.uint8)).save(Path(a.preview) / f'view-{look.lower()}.png')
        else:
            p = OUT / f'clouds-{look.lower()}.jpg'
            size = save_jpeg(img, p, a.quality)
            meta['looks'][look] = {'file': p.name, 'width': a.w, 'height': a.h, 'bytes': size, 'rotDeg': 0, **extra}
            if size > 600 * 1024:
                print(f'  WARNING: {p.name} is {size / 1024:.0f} KB, over the 600 KB budget; lower --quality or --w', flush=True)
        print(f'  wrote {p.name}: {size / 1024:.0f} KB', flush=True)
    if not a.preview:
        old = {}
        mp = OUT / 'clouds.json'
        if mp.exists():
            try:
                old = json.loads(mp.read_text()).get('looks', {})
            except Exception:
                old = {}
        old.update(meta['looks'])
        meta['looks'] = old
        mp.write_text(json.dumps(meta, indent=2) + '\n')


if __name__ == '__main__':
    main()
