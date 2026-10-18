#!/usr/bin/env python3
"""v2 trees from sources a public product may use, replacing data/canopy_detected.json in v2.

    python3 scripts/v2/street_trees.py CITY_CACHE [--tiles TILE_CACHE] [--only-cell southmall] [--debug DIR]

data/canopy_detected.json was detected on Esri World Imagery, whose terms do not allow derived data in a public product (v1 still
uses it; that is a licence risk to fix later, not here). v2's trees now come from:

  1. City of Austin Tree Inventory (wrik-xasw, Public Domain): species and trunk diameter. Mostly street trees on City land.
  2. City of Austin Downtown Tree Inventory 2013 (7aq7-a66u, Public Domain): species, trunk diameter AND height.
  3. Crowns detected on the City of Austin 2025 aerial (the same detector, scripts/detect_canopy.py, pointed at the City's tiles
     instead of Esri's) where neither inventory has a tree: the UT campus is state land and no inventory covers it. Position and
     crown radius are measured; height is modelled from the radius. The photograph is January: evergreen crowns (live oaks, the
     commonest tree here) are found, bare deciduous crowns mostly are not.
  4. OpenStreetMap natural=tree (ODbL) where none of the above has a tree within OSM_GAP_M: written to its OWN file.

Writes v2/data/trees/city.json (sources 1-3: City of Austin data and a product of the City's imagery) and v2/data/trees/osm.json
(source 4, ODbL). Each tree: x, z (v2 metres), crown radius m, height m, species group (GROUPS), and a 0-255 shade jitter. Trees whose
trunk falls inside a building outline the app extrudes are dropped (a tree can't stand inside a building; the old canopy file
planted some on the DKR field and on roofs).
"""
import argparse, json, math, os, sys, random
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO, 'scripts'))
import detect_canopy as DC                       # noqa: E402

OUT = os.path.join(REPO, 'v2', 'data', 'trees')
CITY_TILES = 'https://maps.austintexas.gov/image/rest/services/MapTiled/AerialImagery_WebMercator/MapServer/tile/{z}/{y}/{x}'

# ── PARAMETERS ──────────────────────────────────────────────────────────
ORIGIN = {'lat': 30.28601, 'lon': -97.73932}
EARTH_R = 6378137.0
BOX = (-3200, 3200, -2700, 4900)                 # v2 metres kept
# the detection grid: the old canopy file's 8 x 7 cells over campus and West Campus, extended south to downtown's edge
GRID = {'w': -97.752312, 'e': -97.725688, 'n': 30.296269, 's': 30.262, 'dlon': 0.00325, 'dlat': 0.002857}
GAP_M = 3.0                                      # a detected crown within its radius + this of an inventory tree is that tree
OSM_GAP_M = 4.0
# trunk diameter (inches) -> crown radius and height (m), per group: open-grown urban habit, rough allometry
GROUPS = ['oak', 'broadleaf', 'small', 'conifer', 'palm']
SIZE = {  # (radius a, radius per inch, radius max, height a, height per inch, height max)
    'oak':       (1.2, 0.20, 11.0, 3.0, 0.32, 16.0),
    'broadleaf': (1.0, 0.16, 9.0, 3.5, 0.45, 22.0),
    'small':     (0.8, 0.14, 3.5, 2.5, 0.25, 7.0),
    'conifer':   (0.8, 0.10, 3.5, 3.0, 0.45, 14.0),
    'palm':      (1.2, 0.05, 2.5, 4.0, 0.60, 15.0),
}
DEFAULT_DBH_IN = 10.0

D2R = math.pi / 180
KX = EARTH_R * D2R * math.cos(ORIGIN['lat'] * D2R)
KZ = EARTH_R * D2R
loc = lambda lon, lat: ((lon - ORIGIN['lon']) * KX, -(lat - ORIGIN['lat']) * KZ)


def group_of(species):
    s = (species or '').lower()
    if not s:
        return 'broadleaf'
    if any(k in s for k in ('oak', 'quercus')):
        return 'oak'
    if any(k in s for k in ('crape', 'crepe', 'lagerstroemia', 'redbud', 'cercis', 'yaupon', 'ilex', 'holly', 'myrtle', 'vitex', 'mountain laurel',
                            'sophora', 'dermatophyllum', 'desert willow', 'chilopsis', 'plum', 'prunus', 'mexican buckeye', 'ungnadia',
                            'possumhaw', 'viburnum', 'loquat', 'eriobotrya', 'anacacho', 'bauhinia', 'redbud', 'pistache', 'pistacia')):
        return 'small'
    if any(k in s for k in ('cedar', 'juniper', 'juniperus', 'cypress', 'taxodium', 'pine', 'pinus', 'cupressus', 'arizona')):
        return 'conifer'
    if any(k in s for k in ('palm', 'sabal', 'washingtonia', 'phoenix', 'trachycarpus')):
        return 'palm'
    return 'broadleaf'


def sized(g, dbh_in, h_m=None):
    a, b, rmax, ha, hb, hmax = SIZE[g]
    d = dbh_in if dbh_in and dbh_in > 0 else DEFAULT_DBH_IN
    r = min(rmax, a + b * d)
    h = h_m if h_m and h_m > 1.5 else min(hmax, ha + hb * d)
    return r, max(h, 2 * r * 0.8 if g != 'palm' else h)


# crown packing on the City aerial: the canopy mask (DC's vegetation, darkness and texture tests) filled with crowns, biggest first
CANOPY_DARK_MIN = 0.12        # DC's darkness score (0 = as bright as the lawn round it)
CANOPY_TEXTURE_K = 0.5        # x DC.TEXTURE_MIN
CANOPY_EXG_MIN = 0.03         # normalised excess green
CANOPY_LUMA_MAX = 0.40        # sRGB luminance: crowns self-shadow, mown lawn is brighter
CANOPY_BLUR_M = 1.2           # the speckled pixel tests are averaged over this ...
CANOPY_SHARE = 0.32           # ... and a point is canopy when this share of its neighbourhood passes them
CROWN_MIN_R_M = 1.8
CROWN_MAX_R_M = 8.0
CROWN_OVERLAP = 0.75          # two crowns may overlap this much of the smaller radius (groves are continuous)


def detect_fill(bbox, z, debug_path=None):
    """Like DC.detect, but every canopy pixel is covered: greedy disc packing on the canopy mask's distance transform."""
    import numpy as np
    from scipy import ndimage
    from PIL import Image, ImageDraw
    from collections import defaultdict
    rgb, x0, y0, T = DC.mosaic(bbox, z)
    lat_mid = (bbox[1] + bbox[3]) / 2.0
    mpp = 156543.03392 * math.cos(math.radians(lat_mid)) / (2 ** z)
    R, G, B = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    exg = (2 * G - R - B) / (R + G + B + 1e-6)
    luma = 0.2126 * R + 0.7152 * G + 0.0722 * B
    exg_local = exg - DC.box_mean(exg, max(1, int(round(9.0 / mpp))))
    veg = (exg > 0.02) & (exg_local > DC.EXG_MIN - 0.02)
    win = max(1, int(round(DC.TEXTURE_WIN_M / mpp)))
    m1 = DC.box_mean(luma, win); m2 = DC.box_mean(luma * luma, win)
    var = np.clip(m2 - m1 * m1, 0, None)
    lawn_ref = DC.box_mean(luma, max(1, int(round(14.0 / mpp))))
    dark = np.clip(1.0 - (luma / (lawn_ref + 1e-6)) / DC.DARK_MAX, 0, 1)
    # the per-pixel tests are speckled at 0.26 m (leaves, gaps, shade): a crown is where MOST pixels round a point pass them
    # DC's tests are relative to the neighbourhood, which fails INSIDE a big grove (its neighbourhood is the grove): absolute tests
    # here: green, darker than mown lawn, and textured
    raw = ((exg > CANOPY_EXG_MIN) & (luma < CANOPY_LUMA_MAX) & (DC.box_mean(var, win) > DC.TEXTURE_MIN * CANOPY_TEXTURE_K)).astype(np.float32)
    canopy = ndimage.gaussian_filter(raw, CANOPY_BLUR_M / mpp) > CANOPY_SHARE
    canopy = ndimage.binary_opening(canopy, iterations=max(1, int(0.8 / mpp)))
    dt = ndimage.distance_transform_edt(canopy) * mpp
    mx = ndimage.maximum_filter(dt, size=max(3, int(2 * CROWN_MIN_R_M / mpp) | 1))
    ys, xs = np.nonzero((dt >= mx - 1e-6) & (dt >= CROWN_MIN_R_M))
    order = np.argsort(-dt[ys, xs])
    acc = []
    cell = int(CROWN_MAX_R_M * 2 / mpp) + 1
    bucket = defaultdict(list)
    for k in order:
        py, px = int(ys[k]), int(xs[k])
        r = min(CROWN_MAX_R_M, float(dt[py, px]))
        clash = any(math.hypot(qy - py, qx - px) * mpp < (r + qr) - CROWN_OVERLAP * min(r, qr)
                    for di in (-1, 0, 1) for dj in (-1, 0, 1) for (qy, qx, qr) in bucket[(py // cell + di, px // cell + dj)])
        if not clash:
            acc.append((py, px, r))
            bucket[(py // cell, px // cell)].append((py, px, r))
    out = []
    for py, px, r in acc:
        lon, lat = DC.xy_to_lonlat(x0 + px / T, y0 + py / T, z)
        if bbox[0] <= lon <= bbox[2] and bbox[1] <= lat <= bbox[3]:
            out.append({'lon': lon, 'lat': lat, 'r': r, 'h': min(DC.HEIGHT_MAX, DC.HEIGHT_A * r + DC.HEIGHT_B)})
    if debug_path:
        im = Image.fromarray((rgb * 255).astype(np.uint8))
        d = ImageDraw.Draw(im)
        for py, px, r in acc:
            rp = r / mpp
            d.ellipse([px - rp, py - rp, px + rp, py + rp], outline=(255, 0, 255), width=2)
        im.save(debug_path)
    return out, mpp


def outlines():
    """Every outline the app extrudes, as (bbox, ring) in v2 metres, in 50 m buckets."""
    from collections import defaultdict
    rings = []
    camp = json.load(open(os.path.join(REPO, 'data', 'snapshots', '2026-09-15', 'buildings.detailed.geojson')))['features']
    for f in camp:
        g = f['geometry']
        if g:
            for poly in (g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]):
                rings.append([loc(*p[:2]) for p in poly[0]])
    for r in json.load(open(os.path.join(REPO, 'data', 'outer', 'downtown_massing.json')))['rows']:
        if r.get('g'):
            c = r['g']
            for poly in (c if isinstance(c[0][0][0], list) else [c]):
                rings.append([loc(*p[:2]) for p in poly[0]])
    grid = defaultdict(list)
    for ring in rings:
        xs = [p[0] for p in ring]; zs = [p[1] for p in ring]
        bb = (min(xs), max(xs), min(zs), max(zs))
        for i in range(int(bb[0] // 50), int(bb[1] // 50) + 1):
            for j in range(int(bb[2] // 50), int(bb[3] // 50) + 1):
                grid[(i, j)].append((bb, ring))
    return grid


def inside(grid, x, z):
    for bb, ring in grid.get((int(x // 50), int(z // 50)), []):
        if not (bb[0] <= x <= bb[1] and bb[2] <= z <= bb[3]):
            continue
        c = False
        for i in range(len(ring)):
            a, b = ring[i], ring[i - 1]
            if (a[1] > z) != (b[1] > z) and x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]:
                c = not c
        if c:
            return True
    return False


class Near:
    def __init__(self, cell=20.0):
        from collections import defaultdict
        self.c = cell; self.g = defaultdict(list)

    def add(self, x, z, r):
        self.g[(int(x // self.c), int(z // self.c))].append((x, z, r))

    def any(self, x, z, d):
        i, j = int(x // self.c), int(z // self.c)
        k = int(d // self.c) + 1
        for di in range(-k, k + 1):
            for dj in range(-k, k + 1):
                for (a, b, r) in self.g.get((i + di, j + dj), []):
                    if math.hypot(a - x, b - z) < d + r:
                        return True
        return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('city')
    ap.add_argument('--tiles', default=os.path.join(os.path.expanduser('~'), '.cache', 'flyover-aerial-z19'))
    ap.add_argument('--only-cell', default=None)
    ap.add_argument('--debug', default=None)
    a = ap.parse_args()
    DC.ESRI = CITY_TILES
    DC.TILE_CACHE = a.tiles
    DC.UA = {'User-Agent': 'flyover-v2-bake/1 (City of Austin open data; github.com/SimeonVarg/austin-3d-explorer)'}
    rnd = random.Random(7)
    grid = outlines()
    trees, near = [], Near()
    n = {'inventory': 0, 'downtown_2013': 0, 'detected': 0, 'osm': 0, 'dropped_inside_buildings': 0, 'detected_dup': 0}

    def put(x, z, r, h, g, src):
        if not (BOX[0] <= x <= BOX[1] and BOX[2] <= z <= BOX[3]):
            return False
        if inside(grid, x, z):
            n['dropped_inside_buildings'] += 1; return False
        trees.append([round(x, 1), round(z, 1), round(r, 1), round(h, 1), GROUPS.index(g), rnd.randrange(256)])
        near.add(x, z, r); n[src] += 1
        return True

    dt = json.load(open(os.path.join(a.city, 'trees_dt.geojson')))['features']
    for f in dt:
        p, g = f['properties'], f.get('geometry')
        if not g:
            continue
        x, z = loc(*g['coordinates'][:2])
        grp = group_of((p.get('com_name') or '') + ' ' + (p.get('species') or ''))
        h = float(p['height']) * 0.3048 if p.get('height') else None
        r, h = sized(grp, float(p.get('dbh') or 0), h)
        put(x, z, r, h, grp, 'downtown_2013')
    for f in json.load(open(os.path.join(a.city, 'trees.geojson')))['features']:
        p, g = f['properties'], f.get('geometry')
        if not g:
            continue
        x, z = loc(*g['coordinates'][:2])
        if near.any(x, z, 1.5):            # the 2013 downtown survey already has it (with a height)
            continue
        grp = group_of(p.get('species'))
        r, h = sized(grp, float(p.get('diameter') or 0))
        put(x, z, r, h, grp, 'inventory')
    # detection on the City's 2025 aerial, cell by cell
    cells = []
    lat = GRID['n']; row = 0
    while lat - GRID['dlat'] >= GRID['s'] - 1e-9:
        lon = GRID['w']; col = 0
        while lon + GRID['dlon'] <= GRID['e'] + 1e-9:
            cells.append(('c%02d%02d' % (row, col), (lon, lat - GRID['dlat'], lon + GRID['dlon'], lat)))
            lon += GRID['dlon']; col += 1
        lat -= GRID['dlat']; row += 1
    if a.only_cell:
        cells = [('southmall', (-97.7412, 30.2838, -97.7375, 30.2866))] if a.only_cell == 'southmall' else [c for c in cells if c[0] == a.only_cell]
    for tag, bbox in cells:
        dbg = os.path.join(a.debug, tag + '.jpg') if a.debug else None
        found, mpp = detect_fill(bbox, 19, dbg)
        for t in found:
            x, z = loc(t['lon'], t['lat'])
            if near.any(x, z, GAP_M):
                n['detected_dup'] += 1; continue
            # a detected crown has no species: the January photograph shows evergreen crowns, mostly live oak
            put(x, z, t['r'], t['h'], 'oak' if t['r'] >= 3.5 else 'broadleaf', 'detected')
        sys.stderr.write(f'{tag}: {len(found)} found, total {len(trees)}\n')
    city_out = {
        'about': 'v2 trees (scripts/v2/street_trees.py): City of Austin Tree Inventory (wrik-xasw) and Downtown Tree Inventory 2013 (7aq7-a66u), '
                 'both Public Domain; plus crowns detected on the City of Austin 2025 aerial where neither inventory has a tree '
                 '(position and radius measured, height modelled). Not endorsed by the City of Austin.',
        'groups': GROUPS,
        'fields': ['x', 'z', 'crown radius m', 'height m', 'group', 'shade 0-255'],
        'frame': 'v2/geo.js: x metres east, z metres south of 30.28601, -97.73932',
        'counts': dict(n),
        'trees': [v for t in trees for v in t],
    }
    # OSM, separately (ODbL)
    osm = json.load(open(os.path.join(REPO, 'data', 'osm_cache', 'trees.json')))
    otrees = []
    for e in osm['elements']:
        if 'lat' not in e:
            continue
        x, z = loc(e['lon'], e['lat'])
        if near.any(x, z, OSM_GAP_M) or inside(grid, x, z) or not (BOX[0] <= x <= BOX[1] and BOX[2] <= z <= BOX[3]):
            continue
        grp = group_of((e.get('tags') or {}).get('species') or (e.get('tags') or {}).get('genus') or (e.get('tags') or {}).get('taxon'))
        r, h = sized(grp, 0)
        otrees.append([round(x, 1), round(z, 1), round(r, 1), round(h, 1), GROUPS.index(grp), rnd.randrange(256)])
    n['osm'] = len(otrees)
    os.makedirs(OUT, exist_ok=True)
    if not a.only_cell:
        json.dump(city_out, open(os.path.join(OUT, 'city.json'), 'w'), separators=(',', ':'))
        json.dump({'_license': '© OpenStreetMap contributors, ODbL 1.0 (https://opendatacommons.org/licenses/odbl/1-0/). A derivative database of '
                               'OpenStreetMap natural=tree nodes, offered under the ODbL.',
                   'source': 'Overpass extract ' + osm.get('osm3s', {}).get('timestamp_osm_base', ''),
                   'groups': GROUPS, 'fields': city_out['fields'], 'frame': city_out['frame'],
                   'trees': [v for t in otrees for v in t]}, open(os.path.join(OUT, 'osm.json'), 'w'), separators=(',', ':'))
    print(json.dumps(n))


if __name__ == '__main__':
    main()
