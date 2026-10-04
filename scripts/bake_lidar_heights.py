# -*- coding: utf-8 -*-
"""Roof heights read off the 2021 airborne laser scan.

OWNS ONE OUTPUT FILE: data/lidar_heights.json. Nothing else writes it, and this
script writes nothing else in the repo.

WHY
    The heights the app draws are second-hand: Overture and City footprints
    whose heights come from older surveys, a floor count times a guessed floor
    height, or a hand-typed override. For the Gates Dell Complex four sources
    say 28.14, 42.39, 29.5 and 16.8 m. A photograph cannot settle metres; a
    laser can. The 2021 StratMap scan of Travis County is public domain (CC0)
    and about 12 points per square metre.

WHAT IT DOES
    Reads the height-above-ground raster that scripts/lidar_raster.py builds
    (the raster is large and lives OUTSIDE the repo; name its folder with
    --raster or the LIDAR_RASTER_DIR environment variable), and for every
    building footprint in the latest snapshot measures:

      p90      the roof height: the 90th percentile of the surface above ground
               inside the footprint shrunk SHRINK_M, so wall edges and the
               overhang of the roof do not vote.
      max      the highest cell (a spire, a chimney, a mast).
      steps    the height classes inside the footprint with their area share,
               so a tower on a podium reads as two or three steps.
      roof     "flat" or "pitched", from the spread of heights inside the
               top class.
      flags    why a number should be distrusted (see FLAGS below).

    The surface is the BUILDING-CLASS points (class 6) wherever the scan has
    them, so a tree overhanging a low roof does not inflate it. Where the scan
    classified under MIN_BLDG_COVER of a footprint as building, the first
    returns of any class are used instead and the building is flagged.

THE KNOB
    js/app.js does NOT read this file unless the page URL carries
    ?lidarheights=1. Default OFF: the look of the city does not change until
    the owner has seen before/after pictures. See LIDAR_HEIGHTS in js/app.js.

USAGE
    python scripts/bake_lidar_heights.py --raster <dir>
    python scripts/bake_lidar_heights.py --raster <dir> --table-dir <dir>
        also writes heights_table.csv and heights_table.json there, with the
        app's height today beside each lidar number (the audit table).
"""
import argparse
import csv
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw
from shapely.geometry import Polygon, MultiPolygon, shape
from shapely.ops import transform as shp_transform

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import lidar_raster as LR  # noqa: E402

# ---- taste / accuracy values: one line each, change here and re-bake --------
SHRINK_M = 1.0              # footprint is shrunk this much before measuring
MIN_CELLS = 12              # fewer measured cells than this = no number (3 m2)
MIN_BLDG_COVER = 0.25       # share of the footprint the scan called "building"
SPARSE_COVER = 0.50         # under this the number is kept but flagged `sparse`
MIN_ROOF_M = 2.0            # cells lower than this are ground clutter, not roof
STEP_MIN_SHARE = 0.06       # a height class must hold this share to be a step
STEP_MERGE_M = 2.0          # classes closer than this are one step
FLAT_SPREAD_M = 1.2         # top-class p90 - p10 at or under this = flat roof
CANOPY_GAP_M = 2.0          # first-return p90 above class-6 p90 by this = trees
SKEW_GAP_M = 3.0            # p90 - median beyond this = a tall part dominates
YEAR = 2021
# ------------------------------------------------------------------------------

FLAGS = {
    'low_class6': 'the scan called under %d%% of the footprint building; first '
                  'returns used, so trees may inflate it' % int(MIN_BLDG_COVER * 100),
    'canopy': 'first-return p90 sits >%.0f m above the building-class p90: trees '
              'overhang this roof. INFORMATION, not a warning: the number already '
              'comes from the building class and ignores them' % CANOPY_GAP_M,
    'sparse': 'the scan called under %d%% of the footprint building: the roof is '
              'half hidden (trees, glass, water) so the number rests on what is left'
              % int(SPARSE_COVER * 100),
    'skewed': 'p90 and the median differ by >%.0f m: a tall part holds a small '
              'share of the footprint, so p90 is not the typical roof' % SKEW_GAP_M,
    'small': 'footprint under 4 m wide after shrinking; measured on the full ring',
    'few_cells': 'fewer than %d measured cells: no number' % MIN_CELLS,
    'off_raster': 'footprint is outside the lidar frame',
}


class Raster:
    def __init__(self, folder):
        self.grid = LR.load_grid(folder)
        self.hag_b = np.load(os.path.join(folder, 'hag_bldg.f16.npy'), mmap_mode='r')
        self.hag_f = np.load(os.path.join(folder, 'hag_first.f16.npy'), mmap_mode='r')
        self.dtm = np.load(os.path.join(folder, 'dtm_2m.f32.npy'))
        self.nr, self.nc = self.grid['nrows'], self.grid['ncols']
        self.x0, self.yt, self.res = self.grid['x0_m'], self.grid['y_top_m'], self.grid['res_m']
        self.tr = LR.transformer()

    def to_metres(self, geom, dx=0.0, dy=0.0):
        """lon/lat geometry -> the raster's metre frame (optionally nudged)."""
        def f(x, y, z=None):
            X, Y = self.tr.transform(np.asarray(x), np.asarray(y))
            return (np.asarray(X) * LR.FT + dx, np.asarray(Y) * LR.FT + dy)
        return shp_transform(f, geom)

    def mask(self, poly):
        """Boolean mask of the cells whose centre is inside `poly`, plus its
        window (r0, r1, c0, c1) in the raster. None when entirely off-frame."""
        minx, miny, maxx, maxy = poly.bounds
        c0 = int(np.floor((minx - self.x0) / self.res)) - 1
        c1 = int(np.ceil((maxx - self.x0) / self.res)) + 1
        r0 = int(np.floor((self.yt - maxy) / self.res)) - 1
        r1 = int(np.ceil((self.yt - miny) / self.res)) + 1
        if c1 <= 0 or r1 <= 0 or c0 >= self.nc or r0 >= self.nr:
            return None
        w, h = c1 - c0, r1 - r0
        img = Image.new('L', (w, h), 0)
        dr = ImageDraw.Draw(img)
        polys = list(poly.geoms) if isinstance(poly, MultiPolygon) else [poly]
        for p in polys:
            ext = [((x - self.x0) / self.res - c0, (self.yt - y) / self.res - r0) for x, y in p.exterior.coords]
            dr.polygon(ext, fill=1)
            for hole in p.interiors:
                dr.polygon([((x - self.x0) / self.res - c0, (self.yt - y) / self.res - r0) for x, y in hole.coords], fill=0)
        m = np.array(img, bool)
        # clip the window to the raster
        rr0, rr1 = max(r0, 0), min(r1, self.nr)
        cc0, cc1 = max(c0, 0), min(c1, self.nc)
        m = m[rr0 - r0:rr1 - r0, cc0 - c0:cc1 - c0]
        return m, (rr0, rr1, cc0, cc1)


def steps_of(h):
    """Height classes of a roof: [(height_m, share, member_cell_indices), ...]
    tallest first."""
    n = len(h)
    top = float(h.max())
    bins = np.arange(0.0, top + 1.0, 0.5)
    cnt, edges = np.histogram(h, bins=bins)
    if cnt.size < 3:
        return [(round(float(np.median(h)), 1), 1.0, np.arange(n))]
    sm = np.convolve(cnt.astype(float), [0.25, 0.5, 0.25], mode='same')
    sm = np.convolve(sm, [0.25, 0.5, 0.25], mode='same')
    peaks = [i for i in range(len(sm)) if sm[i] > 0
             and sm[i] >= (sm[i - 1] if i else 0) and sm[i] > (sm[i + 1] if i + 1 < len(sm) else 0)]
    peaks = [i for i in peaks if sm[i] >= max(0.02 * n, 6)]
    if not peaks:
        return [(round(float(np.median(h)), 1), 1.0, np.arange(n))]
    centres = [(edges[i] + edges[i + 1]) / 2 for i in peaks]
    # merge peaks closer than STEP_MERGE_M, keep the bigger one's position
    order = sorted(range(len(peaks)), key=lambda i: -sm[peaks[i]])
    kept = []
    for i in order:
        if all(abs(centres[i] - centres[j]) >= STEP_MERGE_M for j in kept):
            kept.append(i)
    kept.sort(key=lambda i: centres[i])
    pc = np.array([centres[i] for i in kept])
    cls = np.argmin(np.abs(h[:, None] - pc[None, :]), axis=1)
    out = []
    for k in range(len(pc)):
        idx = np.nonzero(cls == k)[0]
        sel = h[idx]
        if sel.size / n >= STEP_MIN_SHARE:
            out.append((round(float(np.median(sel)), 1), round(sel.size / n, 3), idx))
    if not out:
        return [(round(float(np.median(h)), 1), 1.0, np.arange(n))]
    out.sort(key=lambda t: -t[0])
    return out


def measure(raster, geom_ll):
    """Everything the audit table and the bake need for one footprint."""
    flags = []
    g = raster.to_metres(shape(geom_ll))
    if g.is_empty:
        return {'flags': ['off_raster']}
    area = g.area
    shr = g.buffer(-SHRINK_M)
    if shr.is_empty or shr.area < 0.25 * area:
        shr = g.buffer(-0.3)
        if shr.is_empty:
            shr = g
        flags.append('small')
    m = raster.mask(shr)
    if m is None:
        return {'flags': ['off_raster'], 'area_m2': round(area, 1)}
    mask, (r0, r1, c0, c1) = m
    n_cells = int(mask.sum())
    if n_cells == 0:
        return {'flags': ['few_cells'], 'area_m2': round(area, 1)}
    wb = np.asarray(raster.hag_b[r0:r1, c0:c1], dtype=np.float32)[mask]
    wf = np.asarray(raster.hag_f[r0:r1, c0:c1], dtype=np.float32)[mask]
    # bare earth under each cell (2 m cells), to turn a height back into a level
    rr, cc = np.nonzero(mask)
    ground = raster.dtm[np.minimum((rr + r0) // 4, raster.dtm.shape[0] - 1),
                        np.minimum((cc + c0) // 4, raster.dtm.shape[1] - 1)]
    keep_b = np.isfinite(wb) & (wb >= MIN_ROOF_M)
    keep_f = np.isfinite(wf) & (wf >= MIN_ROOF_M)
    vb, zb = wb[keep_b], (wb + ground)[keep_b]
    vf, zf = wf[keep_f], (wf + ground)[keep_f]
    cover_b = float(np.isfinite(wb).sum()) / n_cells
    cover_f = float(np.isfinite(wf).sum()) / n_cells
    if cover_b >= MIN_BLDG_COVER and vb.size >= MIN_CELLS:
        v, z, src = vb, zb, 'bldg_class'
        if cover_b < SPARSE_COVER:
            flags.append('sparse')
    else:
        v, z, src = vf, zf, 'first_return'
        flags.append('low_class6')
    out = {'area_m2': round(area, 1), 'cells': n_cells, 'cover_class6': round(cover_b, 2),
           'cover_first': round(cover_f, 2), 'surface': src}
    if v.size < MIN_CELLS:
        flags.append('few_cells')
        out['flags'] = flags
        return out
    p90 = float(np.percentile(v, 90))
    med = float(np.median(v))
    out.update(p90=round(p90, 2), max=round(float(v.max()), 2), median=round(med, 2),
               p10=round(float(np.percentile(v, 10)), 2))
    if vf.size >= MIN_CELLS:
        p90f = float(np.percentile(vf, 90))
        out['p90_first'] = round(p90f, 2)
        if src == 'bldg_class' and p90f - p90 > CANOPY_GAP_M:
            flags.append('canopy')
    if p90 - med > SKEW_GAP_M:
        flags.append('skewed')
    st = steps_of(v)
    top = st[0]
    # Flat or pitched is a question about the roof surface, so it is asked of
    # the ABSOLUTE level of the top class's cells. Asked of the height above
    # ground it would call a flat roof on a hillside "pitched".
    spread = float(np.percentile(z[top[2]], 90) - np.percentile(z[top[2]], 10))
    out['steps'] = [[s[0], s[1]] for s in st]
    out['top_spread_m'] = round(spread, 2)
    out['roof'] = 'flat' if spread <= FLAT_SPREAD_M else 'pitched'
    out['flags'] = flags
    return out


def load_app_buildings(snapshot_dir):
    d = json.load(open(os.path.join(snapshot_dir, 'buildings.detailed.geojson'), encoding='utf-8'))
    return d['features']


def latest_snapshot():
    man = json.load(open(os.path.join(ROOT, 'data', 'manifest.json'), encoding='utf-8'))
    return os.path.join(ROOT, 'data', 'snapshots', man['latest']), man['latest']


def hero_heights():
    d = json.load(open(os.path.join(ROOT, 'data', 'heroes.geojson'), encoding='utf-8'))
    return d.get('heroHeights', {})


def scene_sets():
    """Which footprints the scene draws differently: removed outright
    (building_overrides.json `exclude`), replaced by a hand-built campus model
    (campus_buildings.json), or drawn from parts instead of as one extrusion."""
    ov = json.load(open(os.path.join(ROOT, 'data', 'building_overrides.json'), encoding='utf-8')).get('buildings', {})
    excluded = {k for k, v in ov.items() if v.get('exclude') is True}
    camp = json.load(open(os.path.join(ROOT, 'data', 'campus_buildings.json'), encoding='utf-8')).get('buildings', [])
    return excluded, {b['id'] for b in camp}


def drawn_otherwise(r):
    """Why the extrusion of this footprint's `final_height` is NOT what the
    scene shows for it. The number is still measured and kept (it is the
    audit's answer for that building); `x` tells the renderer's knob to leave
    the footprint alone, because changing `final_height` there would move a
    block nobody sees or double up with the real drawing."""
    if r.get('campus_model'):
        return 'model'      # a hand-built model from campus_buildings.json
    if r.get('has_parts'):
        return 'parts'      # drawn from parts.detailed.geojson
    if r.get('hero_height') is not None:
        return 'hero'       # a landmark with an authored height (heroes.geojson)
    return ''


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--raster', default=os.environ.get('LIDAR_RASTER_DIR'))
    ap.add_argument('--out', default=os.path.join(ROOT, 'data', 'lidar_heights.json'))
    ap.add_argument('--table-dir', help='also write the audit table (csv + json) here')
    ap.add_argument('--no-bake', action='store_true', help='measure only; do not write data/lidar_heights.json')
    a = ap.parse_args()
    if not a.raster:
        sys.exit('name the raster folder: --raster <dir> or LIDAR_RASTER_DIR')
    snap_dir, snap = latest_snapshot()
    feats = load_app_buildings(snap_dir)
    heroes = hero_heights()
    excluded, campus = scene_sets()
    raster = Raster(a.raster)
    rows = []
    for i, f in enumerate(feats):
        p = f['properties']
        r = measure(raster, f['geometry'])
        app_h = p.get('final_height')
        hh = heroes.get(p['id'])
        row = {
            'id': p['id'], 'name': p.get('name') or '', 'class': p.get('building_class') or '',
            'source_height': p.get('source_height'), 'app_height': app_h,
            'hero_height': hh,
            'excluded': p['id'] in excluded, 'campus_model': p['id'] in campus,
            'has_parts': bool(p.get('has_parts')),
        }
        row.update(r)
        if 'p90' in r and app_h is not None:
            row['diff'] = round(r['p90'] - (hh if hh is not None else app_h), 2)
        ring = f['geometry']['coordinates'][0] if f['geometry']['type'] == 'Polygon' else f['geometry']['coordinates'][0][0]
        row['lon'] = round(sum(c[0] for c in ring) / len(ring), 6)
        row['lat'] = round(sum(c[1] for c in ring) / len(ring), 6)
        rows.append(row)
        if (i + 1) % 400 == 0:
            print('  measured %d / %d' % (i + 1, len(feats)), flush=True)
    if a.table_dir:
        os.makedirs(a.table_dir, exist_ok=True)
        json.dump({'snapshot': snap, 'year': YEAR, 'rows': rows},
                  open(os.path.join(a.table_dir, 'heights_table.json'), 'w'), indent=0)
        cols = ['id', 'name', 'class', 'source_height', 'app_height', 'hero_height', 'p90', 'max', 'median', 'p90_first',
                'steps', 'roof', 'top_spread_m', 'diff', 'surface', 'cover_class6', 'area_m2', 'flags',
                'excluded', 'campus_model', 'has_parts', 'lon', 'lat']
        with open(os.path.join(a.table_dir, 'heights_table.csv'), 'w', newline='', encoding='utf-8') as fh:
            w = csv.writer(fh)
            w.writerow(cols)
            for r in rows:
                w.writerow([(json.dumps(r['steps']) if 'steps' in r else '') if c == 'steps' else
                            (';'.join(r.get('flags', [])) if c == 'flags' else r.get(c, '')) for c in cols])
    if not a.no_bake:
        out = {}
        for r in rows:
            if 'p90' not in r or 'few_cells' in r.get('flags', []) or r['excluded']:
                continue
            out[r['id']] = {'h': round(r['p90'], 1), 'max': round(r['max'], 1),
                            'steps': r['steps'], 'roof': r['roof'], 'q': ','.join(r.get('flags', []))}
            x = drawn_otherwise(r)
            if x:
                out[r['id']]['x'] = x
        doc = {
            '_what': 'Roof heights measured from the 2021 airborne laser scan. Read only '
                     'when the page URL carries ?lidarheights=1 (default OFF).',
            '_source': 'StratMap 2021 Bexar & Travis Counties Lidar, flown Jan-Mar 2021, '
                       'published by TxGIO. Licence CC0-1.0.',
            '_method': 'p90 of surface above bare earth inside the footprint shrunk %.1f m; '
                       'surface = building-class points (class 6); see scripts/bake_lidar_heights.py.' % SHRINK_M,
            '_snapshot': snap, 'year': YEAR,
            'buildings': out,
        }
        with open(a.out, 'w', encoding='utf-8') as fh:
            json.dump(doc, fh, separators=(',', ':'))
        print('wrote %s: %d buildings' % (a.out, len(out)))
    print('measured %d buildings, %d with a lidar number' % (len(rows), sum(1 for r in rows if 'p90' in r)))


if __name__ == '__main__':
    main()
