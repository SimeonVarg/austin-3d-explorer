# -*- coding: utf-8 -*-
"""The ground height grid that Google mode (v2/google.js) lays Google's 3D mesh flat with.

OWNS ONE OUTPUT PAIR: v2/google/ground-dem.bin + v2/google/ground-dem.json. Nothing else writes them.

WHY
    v2 draws a flat world: every layer and every Blender building stands on y = 0 (v2/main.js, ground note). Google's
    Photorealistic 3D Tiles carry the real terrain: Austin's ground falls about 40 m from the campus to the lake. To put
    the two together so nothing floats or sinks, Google mode lowers each point of Google's mesh by the real ground
    height there, measured from y = 0 at the origin. This grid is that ground height. It is NOT Google data: it is the
    public 2021 airborne laser scan's bare-earth model (StratMap Bexar & Travis Counties Lidar 2021, TxGIO, CC0-1.0),
    the same scan `scripts/lidar_raster.py` turns into the roof-height raster.

INPUT
    The 2 m bare-earth raster `dtm2.f32.npy` + `grid.json` that `scripts/lidar_raster.py` writes OUTSIDE the repo
    (metres NAVD88 / GEOID18, rows north to south, NAD83(2011) / Texas Central, EPSG:6578). Name the folder with
    --raster or LIDAR_RASTER_DIR.

OUTPUT
    ground-dem.bin   int16, little-endian, row-major, rows run SOUTH (+z) from z0, columns EAST (+x) from x0, one value
                     per cell centre: centimetres of (ground NAVD88 - ground NAVD88 at the origin). Cells outside the
                     scan carry the nearest scanned cell (so the grid has no cliff at its edge).
    ground-dem.json  the frame (x0, z0, cell, cols, rows, all in v2 local metres), the origin's ground height and the
                     datum constants Google mode needs (GEOID18 N at the origin, the NAD83(2011) -> ITRF ellipsoid
                     height difference), each with its source.

The projection is v2/geo.js's (equirectangular round 30.28601, -97.73932, R = 6378137). Texas Central is computed
here with the Lambert conformal conic formulas (Snyder 1987, eq. 15-1 to 15-10) on GRS80, so the script needs only
numpy. NAD83(2011) and WGS84 differ by about a metre across the ground; at an 8 m cell on Austin's slopes that moves a
ground height by a few centimetres, which is below what this grid resolves.

USAGE
    python scripts/v2/bake_ground_dem.py --raster ~/flyover-outer-work/lidar/raster [--cell 8]
"""
import argparse
import json
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT_DIR = os.path.join(REPO, 'v2', 'google')

# v2/geo.js
ORIGIN_LAT, ORIGIN_LON, EARTH_R = 30.28601, -97.73932, 6378137.0
# the area the grid covers, v2 local metres (x east, z south): the camera's bounds (v2/main.js VIEW.BOUNDS) + a margin
EXTENT = dict(x0=-4600.0, x1=4600.0, z0=-4000.0, z1=6400.0)

# EPSG:6578 NAD83(2011) / Texas Central, on GRS80, in metres (the raster's grid.json is in metres)
GRS80_A, GRS80_F = 6378137.0, 1 / 298.257222101
LAT0, LON0, LAT1, LAT2 = 29 + 40 / 60, -(100 + 20 / 60), 31 + 53 / 60, 30 + 7 / 60
FE, FN = 700000.0, 3000000.0

# GEOID18 at the origin, from the NGS geoid API (https://geodesy.noaa.gov/api/geoid/ght?lat=30.28601&lon=-97.73932),
# read 2026-10-18: -25.884 m, stated error 0.03 m. Across the grid it varies from -25.949 to -25.832 m (same API, four
# corners), so one constant is used.
GEOID18_N = -25.884
# ITRF2014 -> NAD83(2011) (NGS 2016 parameters, epoch 2010.0, rates applied to the epoch below). Google's mesh is taken
# to be in WGS84 ~ ITRF2014; this gives the ellipsoid height difference h_ITRF - h_NAD83 at the origin.
HELMERT = dict(t=(1.00530, -1.90921, -0.54157), dt=(0.00079, -0.00060, -0.00144),
               r_mas=(26.78138, -0.42027, 10.93206), dr_mas=(0.06667, -0.75744, -0.05133),
               s_ppb=0.36891, ds_ppb=-0.07201, t0=2010.0)
EPOCH = 2024.0   # an assumed epoch for Google's mesh (not published); 1 year moves the answer about 1 mm


def lcc_forward(lat, lon):
    a, f = GRS80_A, GRS80_F
    e = math.sqrt(f * (2 - f))
    D = math.pi / 180

    def m(p):
        return np.cos(p) / np.sqrt(1 - (e * np.sin(p)) ** 2)

    def t(p):
        return np.tan(math.pi / 4 - p / 2) / ((1 - e * np.sin(p)) / (1 + e * np.sin(p))) ** (e / 2)

    p1, p2, p0 = LAT1 * D, LAT2 * D, LAT0 * D
    n = (math.log(m(p1)) - math.log(m(p2))) / (math.log(t(p1)) - math.log(t(p2)))
    F = m(p1) / (n * t(p1) ** n)
    rho0 = a * F * t(p0) ** n
    rho = a * F * t(np.asarray(lat) * D) ** n
    theta = n * (np.asarray(lon) - LON0) * D
    return FE + rho * np.sin(theta), FN + rho0 - rho * np.cos(theta)


def to_lonlat(x, z):
    D = math.pi / 180
    kx = EARTH_R * D * math.cos(ORIGIN_LAT * D)
    kz = EARTH_R * D
    return ORIGIN_LON + x / kx, ORIGIN_LAT - z / kz


def ecef(lat, lon, h, a=6378137.0, f=1 / 298.257222101):
    e2 = f * (2 - f)
    D = math.pi / 180
    p, l = lat * D, lon * D
    N = a / math.sqrt(1 - e2 * math.sin(p) ** 2)
    return np.array([(N + h) * math.cos(p) * math.cos(l), (N + h) * math.cos(p) * math.sin(l), (N * (1 - e2) + h) * math.sin(p)])


def geodetic_h(X, a=6378137.0, f=1 / 298.257222101):
    e2 = f * (2 - f)
    x, y, z = X
    p = math.hypot(x, y)
    lat = math.atan2(z, p * (1 - e2))
    for _ in range(10):
        N = a / math.sqrt(1 - e2 * math.sin(lat) ** 2)
        h = p / math.cos(lat) - N
        lat = math.atan2(z, p * (1 - e2 * N / (N + h)))
    return h


def nad83_to_itrf_dh(lat, lon, h):
    """h(ITRF2014) - h(NAD83(2011)) at one point (inverse of the ITRF2014 -> NAD83(2011) Helmert, to first order)."""
    H = HELMERT
    dt = EPOCH - H['t0']
    T = np.array(H['t']) + dt * np.array(H['dt'])
    mas = math.pi / 180 / 3600 / 1000
    rx, ry, rz = [(r + dt * dr) * mas for r, dr in zip(H['r_mas'], H['dr_mas'])]
    s = (H['s_ppb'] + dt * H['ds_ppb']) * 1e-9
    Xn = ecef(lat, lon, h)            # a NAD83 point
    # ITRF -> NAD83:  Xn = T + (1 + s) Xi + R x Xi  with the small-angle rotation (IERS sign convention)
    Rm = np.array([[0, -rz, ry], [rz, 0, -rx], [-ry, rx, 0]])
    Xi = np.linalg.solve(np.eye(3) * (1 + s) + Rm, Xn - T)
    return geodetic_h(Xi, f=1 / 298.257222101) - h


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--raster', default=os.environ.get('LIDAR_RASTER_DIR'))
    ap.add_argument('--cell', type=float, default=8.0)
    args = ap.parse_args()
    if not args.raster:
        sys.exit('name the raster folder with --raster or LIDAR_RASTER_DIR')
    grid = json.load(open(os.path.join(args.raster, 'grid.json')))
    dtm = np.load(os.path.join(args.raster, 'dtm2.f32.npy') if os.path.exists(os.path.join(args.raster, 'dtm2.f32.npy'))
                  else os.path.join(args.raster, 'dtm_2m.f32.npy'), mmap_mode='r')
    gres = grid.get('gres_m') or grid.get('dtm_res_m') or 2.0
    gx0, gytop = grid['x0_m'], grid['y_top_m']
    rows, cols = dtm.shape

    c = args.cell
    xs = np.arange(EXTENT['x0'] + c / 2, EXTENT['x1'], c)
    zs = np.arange(EXTENT['z0'] + c / 2, EXTENT['z1'], c)
    X, Z = np.meshgrid(xs, zs)
    lon, lat = to_lonlat(X, Z)
    E, N = lcc_forward(lat, lon)
    # fractional raster index of each cell centre (cell centres of the raster at (i + 0.5) * gres)
    fc = (E - gx0) / gres - 0.5
    fr = (gytop - N) / gres - 0.5
    inside = (fc >= 0) & (fc <= cols - 1) & (fr >= 0) & (fr <= rows - 1)
    # the mean of the 2 m cells under each 8 m cell (a box filter, so the grid does not alias the scan), by sampling a
    # k x k stencil round the centre with bilinear reads
    k = max(1, int(round(c / gres)))
    acc = np.zeros(X.shape)
    for dy in range(k):
        for dx in range(k):
            oc = fc + (dx - (k - 1) / 2)
            orr = fr + (dy - (k - 1) / 2)
            oc = np.clip(oc, 0, cols - 1.001)
            orr = np.clip(orr, 0, rows - 1.001)
            c0 = np.floor(oc).astype(int)
            r0 = np.floor(orr).astype(int)
            tx, ty = oc - c0, orr - r0
            v = (dtm[r0, c0] * (1 - tx) * (1 - ty) + dtm[r0, c0 + 1] * tx * (1 - ty)
                 + dtm[r0 + 1, c0] * (1 - tx) * ty + dtm[r0 + 1, c0 + 1] * tx * ty)
            acc += v
    H = acc / (k * k)
    H[~inside] = np.nan
    # outside the scan: the nearest scanned cell (along rows, then along columns), so the grid has no cliff
    for axis in (1, 0):
        A = H if axis == 1 else H.T
        for line in A:
            ok = ~np.isnan(line)
            if ok.any() and not ok.all():
                idx = np.where(ok, np.arange(line.size), 0)
                np.maximum.accumulate(idx, out=idx)
                first = np.argmax(ok)
                idx[:first] = first
                line[:] = line[idx]
    if np.isnan(H).any():
        sys.exit('the raster does not reach this grid at all')

    # the origin's ground: bilinear in the raster at the origin
    oe, on = lcc_forward(np.array(ORIGIN_LAT), np.array(ORIGIN_LON))
    ofc, ofr = (oe - gx0) / gres - 0.5, (gytop - on) / gres - 0.5
    # the mean over a 16 m square at the origin, like the cells (one 2 m cell can be a kerb)
    win = dtm[int(ofr) - 4:int(ofr) + 5, int(ofc) - 4:int(ofc) + 5]
    h_origin = float(np.mean(win))
    rel_cm = np.round((H - h_origin) * 100).astype('<i2')

    dh = nad83_to_itrf_dh(ORIGIN_LAT, ORIGIN_LON, h_origin + GEOID18_N)
    os.makedirs(OUT_DIR, exist_ok=True)
    rel_cm.tofile(os.path.join(OUT_DIR, 'ground-dem.bin'))
    meta = {
        'about': 'Ground height for Google mode (v2/google.js): centimetres of bare-earth ground above the ground at the '
                 'v2 origin, int16 little-endian, row-major, rows run south (+z) from z0, columns east (+x) from x0, one '
                 'value per cell centre. NOT Google data. Written by scripts/v2/bake_ground_dem.py.',
        'source': grid.get('source', 'StratMap Bexar & Travis Counties Lidar 2021, TxGIO, CC0-1.0'),
        'licence': 'CC0-1.0 (public domain)',
        'x0': EXTENT['x0'], 'z0': EXTENT['z0'], 'cell': c, 'cols': int(xs.size), 'rows': int(zs.size),
        'scanned_share': round(float(inside.mean()), 4),
        'origin': {'lat': ORIGIN_LAT, 'lon': ORIGIN_LON,
                   'ground_navd88_m': round(h_origin, 3),
                   'geoid18_n_m': GEOID18_N,
                   'nad83_to_itrf_dh_m': round(float(dh), 3),
                   'ground_ellipsoid_itrf_m': round(h_origin + GEOID18_N + float(dh), 3)},
        'datum_notes': 'ground_ellipsoid_itrf_m = NAVD88 ground + GEOID18 N (NAD83(2011) ellipsoid height) + the '
                       'NAD83(2011) -> ITRF2014 height change (NGS 2016 Helmert, epoch %.1f). Google tiles are in '
                       'WGS84 ~ ITRF; this is the height Google mode puts at y = 0 before its own ground check.' % EPOCH,
        'range_cm': [int(rel_cm.min()), int(rel_cm.max())],
    }
    json.dump(meta, open(os.path.join(OUT_DIR, 'ground-dem.json'), 'w'), indent=1)
    print(json.dumps(meta, indent=1))
    # a few named places, for the record
    for name, (x, z) in {'origin': (0, 0), 'DKR field': (350, 550), 'Guadalupe & 24th': (-500, -150),
                         'Congress & 6th': (-60, 3500), 'Lady Bird Lake, Congress bridge': (-80, 4150)}.items():
        i = int((z - EXTENT['z0']) // c)
        j = int((x - EXTENT['x0']) // c)
        print('%-32s %+7.2f m' % (name, rel_cm[i, j] / 100))


if __name__ == '__main__':
    main()
