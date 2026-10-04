# -*- coding: utf-8 -*-
"""Turn the public 2021 airborne laser scan into a height-above-ground raster.

This is the raster half of the lidar roof-height work. `bake_lidar_heights.py`
is the measuring half: it reads the raster this script writes. Nothing here
touches a file inside the repo -- the raw point clouds and the raster are large
and stay outside it, in whatever folder you name on the command line.

THE SOURCE
    Texas Strategic Mapping (StratMap) "Bexar & Travis Counties Lidar", flown
    January 26 - March 7 2021, published by TxGIO (formerly TNRIS). Licence
    Creative Commons Zero v1.0 (public domain). Classified LAZ point clouds,
    about 12 points per square metre inside Austin city limits.
    Coordinates are NAD83(2011) / Texas Central, **US survey feet**, and the
    heights are NAVD88 (Geoid18), also **US survey feet**. Every length is
    converted to metres here, once, in FT.

WHAT IT WRITES  (all in --out, nothing in the repo)
    grid.json            the raster's frame: origin, cell size, size, CRS.
    hag_bldg.f16.npy     height above ground, metres, from the building-class
                         points only (class 6). Rows run north to south.
    hag_first.f16.npy    the same from every FIRST return of any class except
                         noise (so trees count). Used only to flag canopy.
    bldg_cells.u8.npy    how many building-class points fell in each cell.
    dtm_2m.f32.npy       bare-earth elevation, metres NAVD88, 2 m cells.
    dsm_bldg.f32.npy / dsm_first.f32.npy are NOT kept: they are HAG + DTM.

METHOD
    surface  : the maximum z per 0.5 m cell.
    ground   : the mean z of class-2 points per 0.5 m cell, the median of those
               over each 2 m cell, then holes (under buildings, trees) filled
               by linear interpolation between the ground that surrounds them (along rows and along columns, averaged).
    height   : surface minus ground, per cell.
    noise    : classes 7 (low point) and 18 (high noise) are dropped.

USAGE
    python scripts/lidar_raster.py grid  --buildings <geojson> --out <dir>
    python scripts/lidar_raster.py tile  --out <dir> --laz <file.laz>
    python scripts/lidar_raster.py merge --out <dir>
"""
import argparse
import json
import os
import sys
import time

import numpy as np

FT = 1200.0 / 3937.0          # one US survey foot in metres
RES = 0.5                     # raster cell, metres
DTM_RES = 2.0                 # bare-earth cell, metres
CRS = 'EPSG:6578'             # NAD83(2011) / Texas Central (ftUS)
NOISE = (7, 18)
ZBASE = 150.0                 # metres; subtracted before float32 sums


def transformer():
    from pyproj import Transformer
    return Transformer.from_crs('EPSG:4326', CRS, always_xy=True)


def lonlat_to_m(tr, lon, lat):
    x, y = tr.transform(lon, lat)
    return np.asarray(x) * FT, np.asarray(y) * FT


def _rings(geom):
    if geom['type'] == 'Polygon':
        polys = [geom['coordinates']]
    else:
        polys = geom['coordinates']
    for poly in polys:
        for ring in poly:
            yield ring


def make_grid(buildings_geojson, margin_m=100.0):
    """The raster frame: the buildings' bounding box plus a margin, in metres."""
    tr = transformer()
    d = json.load(open(buildings_geojson, encoding='utf-8'))
    lons, lats = [], []
    for f in d['features']:
        for ring in _rings(f['geometry']):
            for p in ring:
                lons.append(p[0]); lats.append(p[1])
    x, y = lonlat_to_m(tr, np.array(lons), np.array(lats))
    x0 = np.floor((x.min() - margin_m) / DTM_RES) * DTM_RES
    x1 = np.ceil((x.max() + margin_m) / DTM_RES) * DTM_RES
    y1 = np.ceil((y.max() + margin_m) / DTM_RES) * DTM_RES
    y0 = np.floor((y.min() - margin_m) / DTM_RES) * DTM_RES
    return {
        'crs': CRS, 'units': 'metres (US survey feet x %.10f)' % FT,
        'res_m': RES, 'dtm_res_m': DTM_RES,
        'x0_m': float(x0), 'y_top_m': float(y1),
        'ncols': int(round((x1 - x0) / RES)), 'nrows': int(round((y1 - y0) / RES)),
        'zbase_m': ZBASE,
        'note': 'row 0 is the NORTH edge; column 0 is the WEST edge. The frame '
                'is the Texas Central grid, so it is rotated about 1.3 degrees '
                'from true north.',
    }


def load_grid(out):
    return json.load(open(os.path.join(out, 'grid.json')))


def rasterize_tile(laz_path, out):
    import laspy
    g = load_grid(out)
    nr, nc = g['nrows'], g['ncols']
    x0, yt = g['x0_m'], g['y_top_m']
    n = nr * nc
    dsm_first = np.full(n, -np.inf, np.float32)
    dsm_bldg = np.full(n, -np.inf, np.float32)
    bcnt = np.zeros(n, np.uint16)
    gsum = np.zeros(n, np.float32)
    gcnt = np.zeros(n, np.uint16)
    seen = 0
    kept = 0
    t0 = time.time()
    backend = laspy.LazBackend.LazrsParallel
    with laspy.open(laz_path, laz_backend=backend) as r:
        total = r.header.point_count
        for pts in r.chunk_iterator(4_000_000):
            seen += len(pts)
            X = np.asarray(pts.x) * FT
            Y = np.asarray(pts.y) * FT
            inside = (X >= x0) & (X < x0 + nc * RES) & (Y <= yt) & (Y > yt - nr * RES)
            sel = np.flatnonzero(inside)
            if sel.size == 0:
                continue
            kept += sel.size
            cls = np.asarray(pts.classification)[sel]
            rn = np.asarray(pts.return_number)[sel]
            z = np.asarray(pts.z)[sel] * FT
            col = ((X[sel] - x0) / RES).astype(np.int64)
            row = ((yt - Y[sel]) / RES).astype(np.int64)
            flat = row * nc + col
            ok = ~np.isin(cls, NOISE)
            m = ok & (rn == 1)
            np.maximum.at(dsm_first, flat[m], z[m].astype(np.float32))
            m = ok & (cls == 6)
            np.maximum.at(dsm_bldg, flat[m], z[m].astype(np.float32))
            np.add.at(bcnt, flat[m], 1)
            m = ok & (cls == 2)
            np.add.at(gsum, flat[m], (z[m] - ZBASE).astype(np.float32))
            np.add.at(gcnt, flat[m], 1)
            if (seen // 4_000_000) % 5 == 0:
                print('  %s %.0f%% of points, %.0f s' % (os.path.basename(laz_path), 100 * seen / total, time.time() - t0), flush=True)
    name = os.path.basename(laz_path).replace('.laz', '')
    dst = os.path.join(out, 'partial_%s.npz' % name)
    np.savez_compressed(dst, dsm_first=dsm_first, dsm_bldg=dsm_bldg, bcnt=bcnt, gsum=gsum, gcnt=gcnt)
    print('tile %s: %d points read, %d inside the frame, %.0f s -> %s' % (name, seen, kept, time.time() - t0, dst))


def merge(out):
    t0 = time.time()
    def lap(msg):
        print('  [%.0f s] %s' % (time.time() - t0, msg), flush=True)
    from scipy.ndimage import zoom
    g = load_grid(out)
    nr, nc = g['nrows'], g['ncols']
    n = nr * nc
    dsm_first = np.full(n, -np.inf, np.float32)
    dsm_bldg = np.full(n, -np.inf, np.float32)
    bcnt = np.zeros(n, np.uint32)
    gsum = np.zeros(n, np.float32)
    gcnt = np.zeros(n, np.uint32)
    parts = sorted(f for f in os.listdir(out) if f.startswith('partial_') and f.endswith('.npz'))
    print('merging', parts)
    for f in parts:
        z = np.load(os.path.join(out, f))
        np.maximum(dsm_first, z['dsm_first'], out=dsm_first)
        np.maximum(dsm_bldg, z['dsm_bldg'], out=dsm_bldg)
        bcnt += z['bcnt']; gsum += z['gsum']; gcnt += z['gcnt']
    lap('partials summed')
    dsm_first[np.isneginf(dsm_first)] = np.nan
    dsm_bldg[np.isneginf(dsm_bldg)] = np.nan
    dsm_first = dsm_first.reshape(nr, nc); dsm_bldg = dsm_bldg.reshape(nr, nc)
    with np.errstate(invalid='ignore', divide='ignore'):
        gmean = (gsum / np.maximum(gcnt, 1) + ZBASE).astype(np.float32)
    gmean[gcnt == 0] = np.nan
    gmean = gmean.reshape(nr, nc)
    # ground, 2 m cells: the median of the 0.5 m cell means in each 2 m block
    k = int(round(DTM_RES / RES))
    r2, c2 = nr // k, nc // k
    blocks = gmean[:r2 * k, :c2 * k].reshape(r2, k, c2, k).transpose(0, 2, 1, 3).reshape(r2, c2, k * k)
    # median of the finite values per block, by sorting (np.nanmedian is far slower here)
    fin = np.isfinite(blocks)
    cnt = fin.sum(axis=2)
    srt = np.where(fin, blocks, np.inf)
    srt.sort(axis=2)
    lo = np.take_along_axis(srt, np.clip((cnt - 1) // 2, 0, None)[..., None], 2)[..., 0]
    hi = np.take_along_axis(srt, np.clip(cnt // 2, 0, None)[..., None], 2)[..., 0]
    dtm = ((lo + hi) / 2).astype(np.float32)
    dtm[cnt == 0] = np.nan
    del srt, fin, blocks
    lap('2 m ground medians')
    have = np.isfinite(dtm)
    print('ground cells (2 m): %d of %d have a ground point (%.1f%%)' % (have.sum(), have.size, 100 * have.mean()))
    # Fill the holes (under buildings, trees, cars) by linear interpolation
    # between the ground that surrounds them: along every row, along every
    # column, and the mean of the two. A triangulation does the same job but on
    # a regular grid it took ten minutes; this takes seconds. Where a hole
    # reaches the frame of the raster the nearest ground is used.
    from scipy.ndimage import distance_transform_edt

    def fill_lines(a, ok):
        out = np.full(a.shape, np.nan, np.float32)
        x = np.arange(a.shape[1])
        for i in range(a.shape[0]):
            v = ok[i]
            if v.sum() >= 2:
                out[i] = np.interp(x, x[v], a[i][v])
        return out

    lap('filling holes')
    by_row = fill_lines(dtm, have)
    by_col = fill_lines(dtm.T.copy(), have.T.copy()).T
    both = np.isfinite(by_row) & np.isfinite(by_col)
    fill = np.where(both, (by_row + by_col) / 2, np.where(np.isfinite(by_row), by_row, by_col))
    _, (ir, ic) = distance_transform_edt(~have, return_indices=True)
    near = dtm[ir, ic]
    fill = np.where(np.isfinite(fill), fill, near)
    dtm = np.where(have, dtm, fill).astype(np.float32)
    lap('holes filled')
    np.save(os.path.join(out, 'dtm_2m.f32.npy'), dtm)
    # up to 0.5 m, cell-centre aligned
    dtm_fine = zoom(dtm, k, order=1, grid_mode=True, mode='nearest')
    full = np.full((nr, nc), np.nan, np.float32)
    full[:dtm_fine.shape[0], :dtm_fine.shape[1]] = dtm_fine
    full[dtm_fine.shape[0]:, :] = full[dtm_fine.shape[0] - 1:dtm_fine.shape[0], :]
    full[:, dtm_fine.shape[1]:] = full[:, dtm_fine.shape[1] - 1:dtm_fine.shape[1]]
    lap('upsampled to 0.5 m')
    hag_b = (dsm_bldg - full).astype(np.float16)
    hag_f = (dsm_first - full).astype(np.float16)
    np.save(os.path.join(out, 'hag_bldg.f16.npy'), hag_b)
    np.save(os.path.join(out, 'hag_first.f16.npy'), hag_f)
    np.save(os.path.join(out, 'bldg_cells.u8.npy'), np.minimum(bcnt, 255).astype(np.uint8).reshape(nr, nc))
    print('wrote rasters: building-class cells %d, first-return cells %d' % (np.isfinite(hag_b).sum(), np.isfinite(hag_f).sum()))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd', choices=['grid', 'tile', 'merge'])
    ap.add_argument('--out', required=True)
    ap.add_argument('--buildings')
    ap.add_argument('--laz')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    if a.cmd == 'grid':
        g = make_grid(a.buildings)
        json.dump(g, open(os.path.join(a.out, 'grid.json'), 'w'), indent=1)
        print(json.dumps(g, indent=1))
    elif a.cmd == 'tile':
        rasterize_tile(a.laz, a.out)
    else:
        merge(a.out)


if __name__ == '__main__':
    main()
