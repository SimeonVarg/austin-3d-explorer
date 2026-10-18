#!/usr/bin/env python3
"""v2 street layers: how well every layer lines up with the City's 2025 aerial, in metres, at named places.

    python3 scripts/v2/street_align.py CITY_CACHE [--tiles TILE_CACHE] [--out report.json] [--sheet DIR]

The question (owner, 2026-10-18: "I need accuracy"): is the aerial where the app's roads, the Blender buildings, the City's curbs,
crosswalks and stop lines and the trees say it is? Each answer is a measured shift, not a picture.

Method, the same for every layer: around a place, the aerial (z19, 0.30 m a pixel here) is resampled onto a 0.25 m grid in the v2
frame through EXACTLY the app's maths (v2/geo.js: local equirectangular round ORIGIN; the tile's Web Mercator rows), the layer is drawn
on the same grid, and the shift of the layer that best matches a picture feature is found by cross-correlation over +-SEARCH_M:

  layer                         drawn as                             matched to the aerial's
  City crosswalks, stop lines   bands 3.0 m / 0.6 m wide             paint: brightness above its 3 m surroundings
  City sidewalks                bands of their surveyed width        concrete: brightness above its 8 m surroundings
  roads (data/roads.geojson)    bands of their kerb-to-kerb width     pavement: darkness, minus the paint
  building outlines             their edges                          edges (gradient)

The reported shift (east, north) is where the layer would have to MOVE to sit on the photograph; "sharp" is the peak's height over
the correlation surface's spread (below about 4 the place has too little signal and its number is not used). Trees: each City tree
point against the centre of the green crown within 5 m of it.

Where a shift is over 1 m, the cause is read from the pattern: a shift shared by all layers at a place = the aerial's own placement or
the frame; a shift in one layer only = that layer's source data.
"""
import argparse, json, math, os, sys, urllib.request
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
URL = 'https://maps.austintexas.gov/image/rest/services/MapTiled/AerialImagery_WebMercator/MapServer/tile/{z}/{y}/{x}'

# ── PARAMETERS ──────────────────────────────────────────────────────────
ORIGIN = {'lat': 30.28601, 'lon': -97.73932}   # v2/geo.js
EARTH_R = 6378137.0
ZOOM = 19
RES = 0.25                                      # metres a grid pixel
HALF = 36.0                                     # half the window, metres
SEARCH_M = 6.0
SHARP_MIN = 4.0
# road crossings (named as in data/roads.geojson), found by intersecting their centrelines
PLACES = [
    ('Rio Grande St at W 24th St', 'Rio Grande Street', 'West 24th Street'),
    ('Nueces St at W 24th St', 'Nueces Street', 'West 24th Street'),
    ('Guadalupe St at W 24th St', 'Guadalupe Street', 'West 24th Street'),
    ('Guadalupe St at W 21st St', 'Guadalupe Street', 'West 21st Street'),
    ('Guadalupe St at W 26th St', 'Guadalupe Street', 'West 26th Street'),
    ('Rio Grande St at W 21st St', 'Rio Grande Street', 'West 21st Street'),
    ('Lavaca St at W 15th St', 'Lavaca Street', 'West 15th Street'),
    ('Congress Ave at 6th St', 'Congress Avenue', 'West 6th Street'),
    ('San Jacinto Blvd at E 21st St', 'San Jacinto Boulevard', 'East 21st Street'),
    ('Speedway at E 21st St', 'Speedway', 'East 21st Street'),
]
# low buildings (little roof lean) whose outline is checked; v2 frame point near each, and the Blender slug when there is one
OUTLINE_PLACES = [
    ('UT Main Building (the Tower base block)', 0, 0, 'ut-tower-main-building'),
    ('Texas Memorial Museum', None, None, 'texas-memorial-museum'),
    ('Littlefield House', None, None, 'littlefield-house'),
    ('Gordon-White Building', None, None, 'gordon-white-building'),
    ('Andrews Dormitory', None, None, 'andrews-dormitory'),
]
CROSSWALK_W, STOPLINE_W = 3.0, 0.6
TREE_SAMPLE = 200
TREE_R = 5.0

D2R = math.pi / 180
KX = EARTH_R * D2R * math.cos(ORIGIN['lat'] * D2R)
KZ = EARTH_R * D2R
to_local = lambda lon, lat: ((lon - ORIGIN['lon']) * KX, -(lat - ORIGIN['lat']) * KZ)
to_ll = lambda x, z: (ORIGIN['lon'] + x / KX, ORIGIN['lat'] - z / KZ)


def merc(lon, lat, z):
    n = 2 ** z
    return (lon + 180) / 360 * n * 256, (1 - np.log(np.tan(lat * D2R) + 1 / np.cos(lat * D2R)) / np.pi) / 2 * n * 256


class Aerial:
    def __init__(self, cache):
        self.cache = cache
        os.makedirs(cache, exist_ok=True)

    def tile(self, z, x, y):
        p = os.path.join(self.cache, f'{z}_{x}_{y}.jpg')
        if not os.path.exists(p):
            req = urllib.request.Request(URL.format(z=z, x=x, y=y), headers={'User-Agent': 'flyover-v2-align/1'})
            open(p, 'wb').write(urllib.request.urlopen(req, timeout=60).read())
        return np.asarray(Image.open(p).convert('RGB'), np.float32) / 255

    def grid(self, cx, cz, half=HALF):
        """The aerial resampled (bilinear) onto the v2-frame grid: rows = z (north to south), columns = x (west to east)."""
        n = int(round(2 * half / RES))
        xs = cx - half + (np.arange(n) + 0.5) * RES
        zs = cz - half + (np.arange(n) + 0.5) * RES
        X, Z = np.meshgrid(xs, zs)
        lon, lat = to_ll(X, Z)
        px, py = merc(lon, lat, ZOOM)
        tx0, ty0 = int(px.min() // 256), int(py.min() // 256)
        tx1, ty1 = int(px.max() // 256), int(py.max() // 256)
        mos = np.zeros(((ty1 - ty0 + 1) * 256, (tx1 - tx0 + 1) * 256, 3), np.float32)
        for ty in range(ty0, ty1 + 1):
            for tx in range(tx0, tx1 + 1):
                mos[(ty - ty0) * 256:(ty - ty0 + 1) * 256, (tx - tx0) * 256:(tx - tx0 + 1) * 256] = self.tile(ZOOM, tx, ty)
        u, v = px - tx0 * 256 - 0.5, py - ty0 * 256 - 0.5     # pixel centres
        u0, v0 = np.floor(u).astype(int), np.floor(v).astype(int)
        fu, fv = (u - u0)[..., None], (v - v0)[..., None]
        u0 = np.clip(u0, 0, mos.shape[1] - 2); v0 = np.clip(v0, 0, mos.shape[0] - 2)
        a = mos[v0, u0] * (1 - fu) + mos[v0, u0 + 1] * fu
        b = mos[v0 + 1, u0] * (1 - fu) + mos[v0 + 1, u0 + 1] * fu
        return a * (1 - fv) + b * fv


    def sample(self, X, Z):
        """Bilinear aerial colour at any v2-frame points (arrays of any shape)."""
        lon, lat = to_ll(X, Z)
        px, py = merc(lon, lat, ZOOM)
        u, v = px - 0.5, py - 0.5
        u0, v0 = np.floor(u).astype(np.int64), np.floor(v).astype(np.int64)
        fu, fv = (u - u0)[..., None], (v - v0)[..., None]
        if not hasattr(self, 'mem'):
            self.mem = {}
        def at(uu, vv):
            tx, ty = uu // 256, vv // 256
            out = np.zeros(uu.shape + (3,), np.float32)
            for key in set(zip(tx.ravel().tolist(), ty.ravel().tolist())):
                if key not in self.mem:
                    self.mem[key] = self.tile(ZOOM, key[0], key[1])
                m = (tx == key[0]) & (ty == key[1])
                out[m] = self.mem[key][vv[m] - key[1] * 256, uu[m] - key[0] * 256]
            return out
        a = at(u0, v0) * (1 - fu) + at(u0 + 1, v0) * fu
        b = at(u0, v0 + 1) * (1 - fu) + at(u0 + 1, v0 + 1) * fu
        return a * (1 - fv) + b * fv


def resample(pts, step=0.5):
    """Points every `step` m along a polyline, with the unit normal (left of travel) at each."""
    P, N = [], []
    for (x0, z0), (x1, z1) in zip(pts[:-1], pts[1:]):
        L = math.hypot(x1 - x0, z1 - z0)
        if L < 1e-6:
            continue
        nx, nz = -(z1 - z0) / L, (x1 - x0) / L
        for t in np.arange(0, L, step):
            P.append((x0 + (x1 - x0) * t / L, z0 + (z1 - z0) * t / L)); N.append((nx, nz))
    return np.array(P), np.array(N)


def profile(A, P, N, R, step=0.1):
    """Median aerial luminance across the line, at offsets -R..R along the normal (the median ignores cars and single blemishes)."""
    s = np.arange(-R, R + 1e-9, step)
    X = P[:, 0, None] + N[:, 0, None] * s
    Z = P[:, 1, None] + N[:, 1, None] * s
    return s, np.median(lum(A.sample(X, Z)), axis=0)


def band_centre(s, prof, width, search):
    """Where a bright band `width` m wide sits across the profile (box filter minus its 1.5 m surroundings), within +-search."""
    step = s[1] - s[0]
    k = max(1, int(round(width / step))); g = max(1, int(round(1.5 / step)))
    c = np.convolve(prof, np.ones(k) / k, 'same') - np.convolve(prof, np.ones(k + 2 * g) / (k + 2 * g), 'same')
    m = np.abs(s) <= search
    i = np.argmax(np.where(m, c, -1e9))
    return float(s[i]), float((c[i] - np.median(c[m])) / (np.std(c[m]) + 1e-9))


def symmetry_centre(s, prof, half, search):
    """The axis about which the street's cross-section is most nearly a mirror image (kerbs, sidewalks, building lines)."""
    step = s[1] - s[0]
    best = (-2, 0.0)
    for c in np.arange(-search, search + 1e-9, step):
        t = np.arange(0.5, half, step)
        a = np.interp(c + t, s, prof); b = np.interp(c - t, s, prof)
        if a.std() < 1e-6 or b.std() < 1e-6:
            continue
        r = float(np.corrcoef(a, b)[0, 1])
        if r > best[0]:
            best = (r, float(c))
    return best[1], best[0]


def solve2d(items):
    """Least-squares 2-D shift d from 1-D measurements: n_i . d = o_i (n in v2 frame), returned as (east, north, rms, count)."""
    if len(items) < 2:
        return None
    Nm = np.array([n for n, o in items]); O = np.array([o for n, o in items])
    if np.linalg.matrix_rank(Nm) < 2:
        return None
    d, *_ = np.linalg.lstsq(Nm, O, rcond=None)
    rms = float(np.sqrt(np.mean((Nm @ d - O) ** 2)))
    return {'east_m': round(float(d[0]), 2), 'north_m': round(float(-d[1]), 2), 'size_m': round(float(np.hypot(*d)), 2),
            'rms_m': round(rms, 2), 'n': len(items)}


def draw(cx, cz, lines=(), polys=(), half=HALF):
    """Rasterise local-metre lines [(pts, width_m)] and polygon edges [(pts, width_m)] onto the grid."""
    n = int(round(2 * half / RES))
    im = Image.new('L', (n, n), 0)
    d = ImageDraw.Draw(im)
    P = lambda p: ((p[0] - (cx - half)) / RES, (p[1] - (cz - half)) / RES)
    for pts, w in lines:
        d.line([P(p) for p in pts], fill=255, width=max(1, int(round(w / RES))), joint='curve')
    for pts, w in polys:
        q = [P(p) for p in pts]
        d.line(q + [q[0]], fill=255, width=max(1, int(round(w / RES))))
    return np.asarray(im, np.float32) / 255


def blur(a, m):
    from scipy.ndimage import gaussian_filter
    return gaussian_filter(a.astype(np.float32), m / RES)


def lum(rgb):
    return rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32)


def shift(template, feature):
    """Best shift (east m, north m) to move `template` onto `feature`, and the peak's sharpness."""
    T = template - template.mean(); F = feature - feature.mean()
    if T.std() < 1e-6 or F.std() < 1e-6:
        return None
    C = np.real(np.fft.ifft2(np.fft.fft2(F) * np.conj(np.fft.fft2(T))))
    C = np.fft.fftshift(C)
    n = C.shape[0]; c = n // 2; s = int(SEARCH_M / RES)
    win = C[c - s:c + s + 1, c - s:c + s + 1]
    j, i = np.unravel_index(np.argmax(win), win.shape)
    def para(m1, m0, p1):
        d = m1 - 2 * m0 + p1
        return 0.0 if d == 0 else 0.5 * (m1 - p1) / d
    di = para(win[j, i - 1], win[j, i], win[j, i + 1]) if 0 < i < win.shape[1] - 1 else 0
    dj = para(win[j - 1, i], win[j, i], win[j + 1, i]) if 0 < j < win.shape[0] - 1 else 0
    dx = (i - s + di) * RES
    dz = (j - s + dj) * RES
    sharp = (win.max() - win.mean()) / (win.std() + 1e-9)
    edge = i in (0, win.shape[1] - 1) or j in (0, win.shape[0] - 1)
    return {'east_m': round(dx, 2), 'north_m': round(-dz, 2), 'size_m': round(math.hypot(dx, dz), 2), 'sharp': round(float(sharp), 1),
            'at_search_edge': bool(edge)}


def lines_of(geom):
    if geom is None:
        return []
    t, c = geom['type'], geom['coordinates']
    if t == 'LineString':
        return [[to_local(*p[:2]) for p in c]]
    if t == 'MultiLineString':
        return [[to_local(*p[:2]) for p in l] for l in c]
    return []


def near(pts, cx, cz, r):
    return any(abs(p[0] - cx) < r and abs(p[1] - cz) < r for p in pts)


def crossing(roads, a, b):
    def segs(name):
        out = []
        for f in roads:
            if f['properties'].get('name', '').lower() == name.lower():
                for l in lines_of(f['geometry']):
                    out += list(zip(l[:-1], l[1:]))
        return out
    hits = []
    for (p1, p2) in segs(a):
        for (p3, p4) in segs(b):
            d = (p1[0] - p2[0]) * (p3[1] - p4[1]) - (p1[1] - p2[1]) * (p3[0] - p4[0])
            if abs(d) < 1e-9:
                continue
            t = ((p1[0] - p3[0]) * (p3[1] - p4[1]) - (p1[1] - p3[1]) * (p3[0] - p4[0])) / d
            u = -((p1[0] - p2[0]) * (p1[1] - p3[1]) - (p1[1] - p2[1]) * (p1[0] - p3[0])) / d
            if 0 <= t <= 1 and 0 <= u <= 1:
                hits.append((p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])))
    if not hits:
        return None
    return (sum(h[0] for h in hits) / len(hits), sum(h[1] for h in hits) / len(hits))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('city')
    ap.add_argument('--tiles', default=os.path.join(os.path.expanduser('~'), '.cache', 'flyover-aerial-z19'))
    ap.add_argument('--out', default=None)
    ap.add_argument('--sheet', default=None, help='write one overlay picture per place here')
    a = ap.parse_args()
    A = Aerial(a.tiles)
    roads = json.load(open(os.path.join(REPO, 'data', 'roads.geojson')))['features']
    mk = json.load(open(os.path.join(a.city, 'markings.geojson')))['features']
    sw = json.load(open(os.path.join(a.city, 'sidewalks.geojson')))['features']
    marks = [(l, CROSSWALK_W if f['properties'].get('short_line_type') == 'CROSSWALK' else STOPLINE_W)
             for f in mk if f['properties'].get('short_line_type') in ('CROSSWALK', 'STOP_LINE', 'YIELD_LINE') for l in lines_of(f['geometry'])]
    walks = [(l, max(0.9, float(f['properties'].get('width') or 5) * 0.3048)) for f in sw
             if f['properties'].get('pedestrian_facility_type') == 'EXISTING_SIDEWALK' for l in lines_of(f['geometry'])]
    road_bands = [(l, float(f['properties'].get('w') or 7)) for f in roads if f['properties'].get('k') == 'road' for l in lines_of(f['geometry'])]
    report = {'frame': 'v2/geo.js (local equirectangular, R 6378137, origin 30.28601, -97.73932)', 'aerial': f'City of Austin 2025, z{ZOOM}',
              'grid_m': RES, 'search_m': SEARCH_M, 'places': [], 'outlines': [], 'trees': None}
    if a.sheet:
        os.makedirs(a.sheet, exist_ok=True)
    for name, ra, rb in PLACES:
        c = crossing(roads, ra, rb)
        if not c:
            report['places'].append({'place': name, 'error': 'no crossing in roads.geojson'}); continue
        cx, cz = c
        row = {'place': name, 'v2_xz': [round(cx, 1), round(cz, 1)]}

        def stretch(pts, r0, r1, step=0.5):
            P, N = resample(pts, step)
            if not len(P):
                return P, N
            d = np.hypot(P[:, 0] - cx, P[:, 1] - cz)
            k = (d >= r0) & (d <= r1)
            return P[k], N[k]

        items = {'roads': [], 'markings': [], 'sidewalks': []}   # markings = City stop lines
        for f in roads:
            pr = f['properties']
            if pr.get('k') != 'road' or pr.get('name', '').lower() not in (ra.lower(), rb.lower()):
                continue
            for l in lines_of(f['geometry']):
                P, N = stretch(l, 14, 50)
                if len(P) < 20:
                    continue
                w = float(pr.get('w') or 10)
                sx, prof = profile(A, P, N, w / 2 + 8)
                o, q = symmetry_centre(sx, prof, w / 2 + 6, 5.0)
                if q >= 0.5:
                    items['roads'].append((tuple(N.mean(0)), o))
        for l, w in marks:
            # stop lines only: a crosswalk record is one EDGE of the ladder (seen on the close sheets), not a band to centre on
            if w != STOPLINE_W or not near(l, cx, cz, 30):
                continue
            P, N = resample(l, 0.25)
            if len(P) < 6:
                continue
            P, N = P[2:-2], N[2:-2]
            sx, prof = profile(A, P, N, 5.0, 0.05)
            o, q = band_centre(sx, prof, w, 2.0)
            if q >= 3.0:
                items['markings'].append((tuple(N.mean(0)), o))
        for l, w in walks:
            P, N = stretch(l, 8, 40)
            if len(P) < 16:
                continue
            sx, prof = profile(A, P, N, 6.0)
            o, q = band_centre(sx, prof, w, 3.0)
            if q >= 2.5:
                items['sidewalks'].append((tuple(N.mean(0)), o))
        for k, v in items.items():
            row[k] = solve2d(v)
            row[k + '_median_abs_m'] = round(float(np.median([abs(o) for n, o in v])), 2) if v else None
        report['places'].append(row)
        print(json.dumps(row))
        if a.sheet:
            SH, SR = 22.0, 0.08          # a close sheet: 44 m square at 8 cm a pixel, a 1 m scale in the corner
            n = int(2 * SH / SR)
            xs = cx - SH + (np.arange(n) + 0.5) * SR; zs = cz - SH + (np.arange(n) + 0.5) * SR
            X, Z = np.meshgrid(xs, zs)
            img = Image.fromarray((np.clip(A.sample(X, Z), 0, 1) * 255).astype(np.uint8))
            d = ImageDraw.Draw(img)
            P = lambda p: ((p[0] - (cx - SH)) / SR, (p[1] - (cz - SH)) / SR)
            for k in range(0, 6):
                d.line([(10 + k * 12.5, n - 12), (10 + (k + 1) * 12.5, n - 12)], fill=(255, 255, 255) if k % 2 else (0, 0, 0), width=5)
            for pts, w in [r for r in road_bands if near(r[0], cx, cz, HALF)]:
                d.line([P(p) for p in pts], fill=(0, 255, 255), width=1)
            for pts, w in [m for m in marks if near(m[0], cx, cz, HALF)]:
                d.line([P(p) for p in pts], fill=(255, 0, 255), width=1)
            for pts, w in [s for s in walks if near(s[0], cx, cz, HALF)]:
                d.line([P(p) for p in pts], fill=(255, 210, 0), width=1)
            img.save(os.path.join(a.sheet, 'align-' + name.lower().replace(' ', '-') + '.png'))
    # building outlines (the Blender models stand on these: each model's origin is the mean of its map outline's points)
    man = json.load(open(os.path.join(REPO, 'v2', 'tiles', 'manifest.json')))
    camp = json.load(open(os.path.join(REPO, 'data', 'snapshots', '2026-09-15', 'buildings.detailed.geojson')))['features']
    byid = {}
    for f in camp:
        g = f['geometry']
        if not g:
            continue
        polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
        byid[f['properties']['id'][:8]] = [[to_local(*p[:2]) for p in poly[0]] for poly in polys]
    for name, _, _, slug in OUTLINE_PLACES:
        b = man['buildings'].get(slug)
        if not b:
            continue
        rings = [r for mid in b['map_ids'] for r in byid.get(mid, [])]
        if not rings:
            report['outlines'].append({'building': name, 'error': 'no map outline'}); continue
        cx, cz = b['x'], b['z']
        half = max(HALF, max(max(abs(p[0] - cx), abs(p[1] - cz)) for r in rings for p in r) + 12)
        rgb = A.grid(cx, cz, half)
        L = lum(rgb)
        gy, gx = np.gradient(blur(L, 0.4))
        edge = blur(np.hypot(gx, gy), 0.3)
        T = blur(draw(cx, cz, polys=[(r, 0.5) for r in rings], half=half), 0.3)
        row = {'building': name, 'slug': slug, 'outline': shift(T, edge)}
        report['outlines'].append(row)
        print(json.dumps(row))
    # trees: each City tree point against the centre of the green crown within TREE_R of it (live oaks keep their leaves in January)
    tr = json.load(open(os.path.join(a.city, 'trees.geojson')))['features']
    pts = [to_local(*f['geometry']['coordinates'][:2]) for f in tr if f.get('geometry')]
    pts = [p for p in pts if -900 < p[0] < 700 and -900 < p[1] < 900]
    rng = np.random.default_rng(7)
    sample = [pts[i] for i in rng.choice(len(pts), min(TREE_SAMPLE, len(pts)), replace=False)]
    offs = []
    for (x, z) in sample:
        rgb = A.grid(x, z, TREE_R + 3)
        r, g, bb = rgb[..., 0], rgb[..., 1], rgb[..., 2]
        exg = np.clip(2 * g - r - bb, 0, None) * (lum(rgb) < 0.45)
        n = exg.shape[0]
        yy, xx = np.mgrid[0:n, 0:n]
        cxp = (xx + 0.5) * RES - (TREE_R + 3); czp = (yy + 0.5) * RES - (TREE_R + 3)
        inside = np.hypot(cxp, czp) <= TREE_R
        w = exg * inside
        if w.sum() < 0.02 * inside.sum() * 0.1:
            continue
        thr = np.quantile(w[inside], 0.7)
        w = np.where(w >= thr, w, 0)
        offs.append((float((w * cxp).sum() / w.sum()), float(-(w * czp).sum() / w.sum())))
    if offs:
        O = np.array(offs)
        report['trees'] = {'sampled': len(sample), 'with_green_crown': len(offs), 'median_east_m': round(float(np.median(O[:, 0])), 2),
                           'median_north_m': round(float(np.median(O[:, 1])), 2), 'median_distance_m': round(float(np.median(np.hypot(O[:, 0], O[:, 1]))), 2),
                           'p80_distance_m': round(float(np.quantile(np.hypot(O[:, 0], O[:, 1]), 0.8)), 2)}
        print(json.dumps(report['trees']))
    if a.out:
        json.dump(report, open(a.out, 'w'), indent=1)


if __name__ == '__main__':
    main()
