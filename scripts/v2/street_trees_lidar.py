#!/usr/bin/env python3
"""v2 trees where the 2021 laser scan saw them: one tree per crown, at the crown's real place, height and width.

    python3 scripts/v2/street_trees_lidar.py [--work ~/flyover-outer-work] [--only X0,Z0,X1,Z1] [--debug DIR]
    then: python3 scripts/v2/street_tree_safety.py --names lidar     (keeps trunks out of the carriageway, as for the other files)

Needs numpy, scipy and pyproj (~/flyover-outer-work/venv has them) and the scan raster that scripts/lidar_raster.py /
fetch_outer_homes_inputs.py write OUTSIDE the repo (<work>/lidar/raster, 3.8 GB).

WHY. v2's trees came from the City's inventories (trunk points, size modelled from trunk diameter) plus crowns found by colour on
the City's January aerial. At the owner's photographs that put trees where there are none and missed ones that are there (the
2026-10-25 exact-photo pilot, IMG_1778: a 20 m tree in front of the camera, his photo shows low dark crowns at the corners). The
scan measures every crown from above, on any land, with its height: it is the better source for WHERE and HOW BIG.

SOURCE. StratMap "Bexar & Travis Counties Lidar" 2021 (TxGIO, CC0 1.0), flown 2021-01-26..03-07, classes 3-5 (vegetation),
0.5 m cells (scripts/lidar_raster.py). The City inventories (Public Domain) still give each crown its SPECIES GROUP where one of
their trunks stands under it (v2/data/trees/city.json, the first downtown_2013 + inventory rows).

METHOD (individual tree detection, the usual way):
  canopy height  = highest vegetation return - bare earth, per 0.5 m cell; small leaf-off gaps closed (grey closing), lightly smoothed
  tree tops      = local maxima of that surface over a window that grows with the height (a tall crown is wide; one top per crown)
  crowns         = watershed from the tops over the canopy (>= MIN_H); each crown's area gives its radius, its top its height
  position       = the crown's centre (the middle of its cells, weighted by height): what a person sees is the crown
  group          = the inventory tree under the crown (its trunk within the crown), else by shape (a wide low crown: oak)
Trees inside a building outline the app extrudes are dropped, as in street_trees.py.

Writes v2/data/trees/lidar.json in street_trees.py's format (x, z, crown radius, height, group, shade), plus counts.
"""
import argparse, json, math, os, sys, random, time
import numpy as np
from scipy import ndimage

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO, 'scripts'))
sys.path.insert(0, os.path.join(REPO, 'scripts', 'v2'))
from outer_homes_lib import Scan, to_ll, to_m      # noqa: E402

OUT = os.path.join(REPO, 'v2', 'data', 'trees', 'lidar.json')

# ── PARAMETERS ──────────────────────────────────────────────────────────
ORIGIN = {'lat': 30.28601, 'lon': -97.73932}
EARTH_R = 6378137.0
BOX = (-3200, 3200, -2700, 4900)            # v2 metres kept (street_trees.py's box)
TILE_M = 800.0                              # worked in squares this size ...
PAD_M = 40.0                                # ... with this much overlap (a crown is kept by the square its top falls in)
MIN_H = 2.5                                 # m: lower is a shrub or a hedge
MAX_H = 40.0                                # m: taller is a crane, a wire or a bird
CLOSE_M = 1.0                               # leaf-off gaps inside a crown closed over this (grey closing)
OPEN_M = 2.2                                # then everything narrower than this removed (grey opening, a disc)
SMOOTH_M = 0.5                              # then a gaussian of this (sigma), so one crown has one top
WIN = lambda h: np.clip(2.0 + 0.22 * h, 2.4, 7.0)   # local-max window RADIUS (m) for a top of height h
DENSE_M = 2.5                               # a canopy cell needs DENSE_MIN of the cells in this square round it to carry a
DENSE_MIN = 0.4                             # vegetation return (power lines, wires and scattered noise do not)
THIN_LEN_M = 12.0                           # a canopy patch longer than this ...
THIN_WIDTH_M = 3.2                          # ... and on average narrower than this is a structure (arch, wires), not trees
MIN_CROWN_M2 = 4.0                          # a crown smaller than this (about 1.1 m radius) is a shrub top or a lamp
MAX_ELONG = 2.6                             # a crown longer than this x its width is a bridge arch, a wire or a hedge row, not a tree
MIN_FILL = 0.45                             # share of a crown's cells with a return of their own (gaps closed only by the smoothing)
ROOF_H = 2.5                                # m: a building return this high under a crown ...
MAX_ROOF = 0.6                              # ... in more than this share of it: a roof garden (the app has no roof trees) or an overhang
MAX_R = 13.0                                # m: a crown radius is capped here (an oak grove that the watershed kept as one)
MATCH_K = 0.85                              # an inventory trunk within this x the crown radius of the centre is that crown's tree
INV_LOOK_M = 1.5                            # a surveyed tree with no crown of its own is kept if the scan has vegetation within this
INV_CLEAR_M = 1.0                           # ... and it is not under (a crown's radius + this) of a scan crown
INV_OPEN_M = 1.6                            # m: vegetation narrower than this does not count for that (grey opening, a disc)
INV_MAX_R = 2.5                             # m: such a tree's crown radius at most (it was too small for the crown finder)
# Where a newer photograph shows the 2021 scan's vegetation is gone (photo wins over derived data), v2 metres x0, z0, x1, z1 + why:
STALE = [
    (-1084.0, 2194.0, -1068.0, 2211.0, 'IMG_1778 (2026-10-24): the Shoal Creek footbridge site at 2nd St; the scan (Jan-Mar 2021) has '
                                         '8-11 m vegetation here, the photo shows the arch and open sky'),
]
SHADE_SEED = 7
DIAG = None
GROUPS = ['oak', 'broadleaf', 'small', 'conifer', 'palm']

D2R = math.pi / 180
KX = EARTH_R * D2R * math.cos(ORIGIN['lat'] * D2R)
KZ = EARTH_R * D2R
loc = lambda lon, lat: ((lon - ORIGIN['lon']) * KX, -(lat - ORIGIN['lat']) * KZ)
unloc = lambda x, z: (x / KX + ORIGIN['lon'], -z / KZ + ORIGIN['lat'])


def chm_tile(S, x0, y0, x1, y1):
    """canopy height (m) over a window of the scan frame (metres, Texas Central), rows north to south"""
    r0, r1, c0, c1 = S.window(x0, y0, x1, y1)
    zv = np.asarray(S.arr('zv_max.f32.npy')[r0:r1, c0:c1], np.float32)
    g = S.ground(r0, r1, c0, c1)
    with np.errstate(invalid='ignore'):
        h = np.where(np.isfinite(zv), zv - g, 0.0).astype(np.float32)
    h[(h < 0) | (h > MAX_H)] = 0
    zb = np.asarray(S.arr('zb_max.f32.npy')[r0:r1, c0:c1], np.float32)
    with np.errstate(invalid='ignore'):
        hb = np.where(np.isfinite(zb), zb - g, 0.0).astype(np.float32)
    return h, hb, (r0, r1, c0, c1)


def _disc(k):
    n = k // 2; yy, xx = np.mgrid[-n:n + 1, -n:n + 1]; return (xx * xx + yy * yy) <= n * n + n


def detect(h, res, hb=None):
    k = max(1, int(round(CLOSE_M / res))) | 1
    hc = ndimage.grey_closing(h, size=(k, k))
    # anything narrower than OPEN_M is not a crown: a bridge arch, a wire, a pole or a sign the scan called vegetation (2026-10-25,
    # IMG_1778: the Shoal Creek footbridge's arch came out as a 13 m tree in front of the camera)
    ko = max(1, int(round(OPEN_M / res))) | 1
    hc = ndimage.grey_opening(hc, footprint=_disc(ko))
    h = np.minimum(h, hc)                 # the crown heights from the opened surface too (an arch beside a crown does not raise it)
    hs = ndimage.gaussian_filter(hc, SMOOTH_M / res)
    # a crown is solid: most cells round a point carry a return. Wires and sparse noise above the street are a line or a scatter
    dens = ndimage.uniform_filter((h >= MIN_H).astype(np.float32), int(round(DENSE_M / res)) | 1)
    canopy = (hs >= MIN_H) & (ndimage.grey_dilation(dens, size=(3, 3)) >= DENSE_MIN)
    # a whole patch of canopy that is long and narrow is a structure (a bridge arch, a wire run), not trees: its tops would split it
    # into short round pieces that pass every per-crown test (2026-10-25: the Shoal Creek footbridge arch in front of IMG_1778)
    cl, ncl = ndimage.label(canopy)
    if ncl:
        Lc = cl.ravel(); mk = Lc > 0; Lc = Lc[mk]; r_, c_ = np.divmod(np.nonzero(mk)[0], canopy.shape[1])
        cn = np.bincount(Lc, minlength=ncl + 1).astype(np.float64); cn[0] = 1
        mr, mc = np.bincount(Lc, r_, ncl + 1) / cn, np.bincount(Lc, c_, ncl + 1) / cn
        vr = np.bincount(Lc, r_ * r_, ncl + 1) / cn - mr * mr; vc = np.bincount(Lc, c_ * c_, ncl + 1) / cn - mc * mc; vrc = np.bincount(Lc, r_ * c_, ncl + 1) / cn - mr * mc
        lam = (vr + vc) / 2 + np.sqrt(np.maximum(0, (vr - vc) ** 2 / 4 + vrc * vrc))
        length = np.sqrt(12 * np.maximum(lam, 0)) * res; width = cn * res * res / np.maximum(length, 1e-3)
        thin = (length > THIN_LEN_M) & (width < THIN_WIDTH_M); thin[0] = False
        canopy &= ~thin[cl]
    # tops: a cell is a top when it is the highest within WIN(its height); a few window sizes, each cell takes its own
    top = np.zeros(h.shape, bool)
    edges = np.arange(MIN_H, MAX_H + 4, 4.0)
    for lo, hi in zip(edges[:-1], edges[1:]):
        rw = float(WIN((lo + hi) / 2))
        n = int(round(rw / res))
        mx = ndimage.maximum_filter(hs, size=2 * n + 1)      # a square window (separable: fast); the disc found the same tops
        top |= (hs >= mx - 1e-4) & (hs >= lo) & (hs < hi) & canopy
    lab, nt = ndimage.label(top)          # a flat top of several cells is one top
    if nt == 0:
        return [], hs
    # watershed over the inverted surface, from the tops; non-canopy is the background marker
    q = np.clip((MAX_H - hs) / MAX_H * 65000, 0, 65000).astype(np.uint16)
    markers = lab.astype(np.int32)
    markers[~canopy] = -1
    ws = ndimage.watershed_ift(q, markers)
    ws[~canopy] = 0
    # per-crown sums with bincount (ndimage's label statistics sort the whole square: 10x slower)
    L = ws.ravel(); W = hs.ravel(); m = L > 0; L, W = L[m], W[m]
    rr, cc = np.divmod(np.nonzero(m)[0], hs.shape[1])
    cnt = np.bincount(L, minlength=nt + 1)[1:].astype(np.float64)
    wsum = np.bincount(L, W, minlength=nt + 1)[1:]
    with np.errstate(invalid='ignore', divide='ignore'):
        cy = np.bincount(L, W * rr, minlength=nt + 1)[1:] / wsum; cx = np.bincount(L, W * cc, minlength=nt + 1)[1:] / wsum
    area = cnt * res * res
    hmax = np.zeros(nt + 1, np.float32); np.maximum.at(hmax, L, h.ravel()[m]); hmax = hmax[1:]
    hp = np.zeros(nt + 1, np.float32); np.maximum.at(hp, L, W); hp = hp[1:]
    # shape: a crown is round and solid. A bridge arch, a wire or a pole the scan called vegetation is long and thin, or hollow
    one = np.ones_like(W)
    sr, sc = np.bincount(L, rr, minlength=nt + 1)[1:], np.bincount(L, cc, minlength=nt + 1)[1:]
    srr, scc, src = (np.bincount(L, rr * rr, minlength=nt + 1)[1:], np.bincount(L, cc * cc, minlength=nt + 1)[1:], np.bincount(L, rr * cc, minlength=nt + 1)[1:])
    with np.errstate(invalid='ignore', divide='ignore'):
        mr, mc = sr / cnt, sc / cnt; vr, vc, vrc = srr / cnt - mr * mr, scc / cnt - mc * mc, src / cnt - mr * mc
        tr_, det = vr + vc, vr * vc - vrc * vrc; disc = np.sqrt(np.maximum(0, tr_ * tr_ / 4 - det))
        elong = np.sqrt((tr_ / 2 + disc) / np.maximum(1e-6, tr_ / 2 - disc))
        fill = np.bincount(L, (h.ravel()[m] >= MIN_H).astype(np.float64), minlength=nt + 1)[1:] / cnt
        roof = np.bincount(L, (hb.ravel()[m] >= ROOF_H).astype(np.float64), minlength=nt + 1)[1:] / cnt if hb is not None else np.zeros(nt)
    out = []
    for i in range(nt):
        if area[i] < MIN_CROWN_M2 or not np.isfinite(cy[i]):
            continue
        out.append((cx[i], cy[i], cx[i], cy[i], math.sqrt(area[i] / math.pi), float(min(hmax[i], hp[i] + 1.5)), area[i], elong[i], fill[i], roof[i]))
    return out, hs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--work', default=os.path.expanduser('~/flyover-outer-work'))
    ap.add_argument('--only', default=None, help='x0,z0,x1,z1 in v2 metres (a test square); writes nothing to the repo')
    ap.add_argument('--debug', default=None)
    ap.add_argument('--out', default=None)
    ap.add_argument('--diag', default=None)
    a = ap.parse_args()
    global DIAG
    DIAG = [] if a.diag else None
    S = Scan(a.work)
    box = tuple(map(float, a.only.split(','))) if a.only else (BOX[0], BOX[2], BOX[1], BOX[3])
    # inventory trunks (species group) from the raw City file: street_trees.py writes downtown_2013, then inventory, then detections
    city = json.load(open(os.path.join(REPO, 'v2', 'data', 'trees', 'city.json')))
    ninv = city['counts']['downtown_2013'] + city['counts']['inventory']
    inv = np.array(city['trees'][:ninv * 6], np.float32).reshape(-1, 6)
    from scipy.spatial import cKDTree
    invtree = cKDTree(inv[:, :2])
    from street_trees import outlines, inside
    grid = outlines()
    rnd = random.Random(SHADE_SEED)
    trees, n = [], {'lidar_crowns': 0, 'dropped_inside_buildings': 0, 'dropped_long_thin': 0, 'dropped_hollow': 0, 'dropped_on_a_roof': 0, 'dropped_stale_by_photo': 0, 'group_from_inventory': 0, 'group_from_shape': 0,
                    'inventory_trees_matched': 0, 'inventory_trees_in_box': 0, 'inventory_small_kept': 0, 'inventory_gone_in_scan': 0}
    matched_inv = set()
    t0 = time.time()
    xs = np.arange(box[0], box[2], TILE_M)
    zs = np.arange(box[1], box[3], TILE_M)
    for tz in zs:
        for tx in xs:
            core = (tx, tz, min(tx + TILE_M, box[2]), min(tz + TILE_M, box[3]))
            # the square's corners in the scan frame (a small rotation: take the bounding box, padded)
            lons, lats = zip(*[unloc(x, z) for x in (core[0] - PAD_M, core[2] + PAD_M) for z in (core[1] - PAD_M, core[3] + PAD_M)])
            mx, my = to_m(np.array(lons), np.array(lats))
            h, hb, (r0, r1, c0, c1) = chm_tile(S, mx.min(), my.min(), mx.max(), my.max())
            if h.size == 0 or h.max() < MIN_H:
                continue
            found, _ = detect(h, S.RES, hb)
            if not found:
                continue
            F = np.array(found); n0 = len(trees)
            # cell (col, row) -> scan metres -> lon/lat -> v2
            X = S.X0 + (c0 + F[:, 0] + 0.5) * S.RES; Y = S.YT - (r0 + F[:, 1] + 0.5) * S.RES
            lon, lat = to_ll(X, Y)
            vx, vz = loc(np.asarray(lon), np.asarray(lat))
            keep = (vx >= core[0]) & (vx < core[2]) & (vz >= core[1]) & (vz < core[3])
            for j in np.nonzero(keep)[0]:
                x, z, r, hh = float(vx[j]), float(vz[j]), float(min(MAX_R, F[j, 4])), float(F[j, 5])
                if F[j, 7] > MAX_ELONG and r < 6.0:
                    n['dropped_long_thin'] += 1; continue
                if F[j, 8] < MIN_FILL:
                    n['dropped_hollow'] += 1; continue
                if F[j, 9] > MAX_ROOF:
                    n['dropped_on_a_roof'] += 1; continue
                if DIAG is not None: DIAG.append([round(x, 1), round(z, 1), round(r, 1), round(hh, 1), round(float(F[j, 7]), 2), round(float(F[j, 8]), 2), round(float(F[j, 9]), 2)])
                if inside(grid, x, z):
                    n['dropped_inside_buildings'] += 1; continue
                if any(b[0] <= x <= b[2] and b[1] <= z <= b[3] for b in STALE):
                    n['dropped_stale_by_photo'] += 1; continue
                near = invtree.query_ball_point([x, z], max(1.5, r * MATCH_K))
                if near:
                    best = min(near, key=lambda i: (inv[i, 0] - x) ** 2 + (inv[i, 1] - z) ** 2)
                    g = int(inv[best, 4]); n['group_from_inventory'] += 1
                    matched_inv.update(near)
                else:
                    # no survey under it: a wide low crown is a live oak (the commonest tree here), a narrow tall one a broadleaf
                    g = GROUPS.index('oak') if r >= 0.42 * hh and r >= 3.0 else (GROUPS.index('small') if hh < 5.0 else GROUPS.index('broadleaf'))
                    n['group_from_shape'] += 1
                trees.append([round(x, 1), round(z, 1), round(r, 1), round(hh, 1), g, rnd.randrange(256)])
                n['lidar_crowns'] += 1
            # surveyed trees the crown finder could not see as a crown of their own (young street trees: a crown under ~2 m across
            # or under 4 m2): kept where the scan shows vegetation at least MIN_H high at the trunk, sized from the survey, no taller than
            # the scan says. Where the scan shows nothing there, the tree was gone or a sapling in 2021 and is not drawn.
            tile_trees = np.array([t[:3] for t in trees[n0:]], np.float64).reshape(-1, 3)
            from scipy.spatial import cKDTree as KD
            tt = KD(tile_trees[:, :2]) if len(tile_trees) else None
            # the scan's vegetation with anything narrower than INV_OPEN_M taken out first (a bridge arch or a wire beside a surveyed
            # trunk is not that tree: 2026-10-25, two surveyed trees by the Shoal Creek footbridge came back 8-11 m tall from its arch)
            hv = ndimage.grey_opening(ndimage.grey_closing(h, size=(3, 3)), footprint=_disc(max(1, int(round(INV_OPEN_M / S.RES))) | 1))
            hmx = ndimage.maximum_filter(hv, size=int(round(2 * INV_LOOK_M / S.RES)) | 1)
            sel = np.nonzero((inv[:, 0] >= core[0]) & (inv[:, 0] < core[2]) & (inv[:, 1] >= core[1]) & (inv[:, 1] < core[3]))[0]
            for i in sel:
                if i in matched_inv:
                    continue
                x, z = float(inv[i, 0]), float(inv[i, 1])
                if tt is not None:
                    dd, jj = tt.query([x, z])
                    if dd < tile_trees[jj, 2] + INV_CLEAR_M:
                        continue                  # under a crown the scan already gives
                lon, lat = unloc(x, z); mx_, my_ = to_m(lon, lat)
                rr_, cc_ = int((S.YT - my_) / S.RES) - r0, int((mx_ - S.X0) / S.RES) - c0
                if not (0 <= rr_ < h.shape[0] and 0 <= cc_ < h.shape[1]) or hmx[rr_, cc_] < MIN_H:
                    n['inventory_gone_in_scan'] += 1; continue
                if inside(grid, x, z) or any(b[0] <= x <= b[2] and b[1] <= z <= b[3] for b in STALE):
                    continue
                hh = float(min(inv[i, 3], hmx[rr_, cc_])); r = float(min(inv[i, 2], INV_MAX_R, 0.5 * hh))
                trees.append([round(x, 1), round(z, 1), round(r, 1), round(hh, 1), int(inv[i, 4]), rnd.randrange(256)])
                n['inventory_small_kept'] += 1
            sys.stderr.write(f'tile {tx:.0f},{tz:.0f}: {int(keep.sum())} crowns, total {len(trees)}, {time.time() - t0:.0f}s\n')
    inbox = (inv[:, 0] >= box[0]) & (inv[:, 0] < box[2]) & (inv[:, 1] >= box[1]) & (inv[:, 1] < box[3])
    n['inventory_trees_in_box'] = int(inbox.sum())
    n['inventory_trees_matched'] = int(sum(1 for i in matched_inv if inbox[i]))
    hs = np.array([t[3] for t in trees]); rs = np.array([t[2] for t in trees])
    n['height_m_p10_p50_p90'] = [round(float(np.percentile(hs, p)), 1) for p in (10, 50, 90)] if len(trees) else None
    n['radius_m_p10_p50_p90'] = [round(float(np.percentile(rs, p)), 1) for p in (10, 50, 90)] if len(trees) else None
    out = {
        'about': 'v2 trees (scripts/v2/street_trees_lidar.py): one tree per crown found in the StratMap Bexar & Travis Counties Lidar 2021 '
                 '(TxGIO, CC0 1.0): position = the crown centre, height = its highest vegetation return above bare earth, crown radius = '
                 'from its area. Species group from the City of Austin Tree Inventory (wrik-xasw) and Downtown Tree Inventory 2013 '
                 '(7aq7-a66u), Public Domain, where one of their trunks stands under the crown. Not endorsed by the City of Austin or TxGIO.',
        'groups': GROUPS,
        'fields': ['x', 'z', 'crown radius m', 'height m', 'group', 'shade 0-255'],
        'frame': 'v2/geo.js: x metres east, z metres south of 30.28601, -97.73932',
        'counts': n,
        'params': {'MIN_H': MIN_H, 'CLOSE_M': CLOSE_M, 'OPEN_M': OPEN_M, 'SMOOTH_M': SMOOTH_M, 'WIN': '2.0 + 0.22 h, 2.4..7.0', 'MIN_CROWN_M2': MIN_CROWN_M2, 'DENSE_M': DENSE_M, 'DENSE_MIN': DENSE_MIN, 'MAX_ELONG': MAX_ELONG, 'MIN_FILL': MIN_FILL, 'MAX_ROOF': MAX_ROOF, 'THIN_LEN_M': THIN_LEN_M, 'THIN_WIDTH_M': THIN_WIDTH_M, 'STALE': STALE, 'MAX_R': MAX_R},
        'trees': [v for t in trees for v in t],
    }
    if a.diag: json.dump(DIAG, open(a.diag, 'w'))
    path = a.out or (None if a.only else OUT)
    if path:
        json.dump(out, open(path, 'w'), separators=(',', ':'))
    print(json.dumps(n))


if __name__ == '__main__':
    main()
