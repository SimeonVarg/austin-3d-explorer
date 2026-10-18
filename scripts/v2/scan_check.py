"""v2 tiles, placement check 2: every build in the v2 tiles against the 2021 laser scan, independent of the map outlines (check_place.py). The scan raster is
private (~/Projects/astra-pipe/research/lidar-2021/raster) and stays outside the repo; only these numbers are written down.
    python3 scripts/v2/scan_check.py [slug ...]        (SCAN_FIRST=1: first returns, for a stadium the building class does not hold)
The model's plan (everything over 3 m, no ground materials), put where the v2 tile puts it, against the scan's building cells (hag_bldg > 3 m).
Prints IoU at the tile's own position, the shift (m east, m north) that would align it best, and the IoU there."""
import json, math, struct, sys, os, re
import numpy as np
from PIL import Image, ImageDraw
from scipy.signal import fftconvolve

RAS = os.path.expanduser('~/Projects/astra-pipe/research/lidar-2021/raster/')
G = json.load(open(RAS + 'grid.json')); X0, YT, RES = G['x0_m'], G['y_top_m'], G['res_m']
HAG = np.load(RAS + ('hag_first.f16.npy' if os.environ.get('SCAN_FIRST') else 'hag_bldg.f16.npy'), mmap_mode='r')
H = os.path.expanduser('~')
EX = os.environ.get('V2_CACHE', H + '/flyover-private/v2-tiles-cache') + '/export'
src = json.load(open(EX + '/../sources.json'))
GROUND = re.compile(r'^site_|street|sidewalk|pavement|road|kerb|curb|asphalt|crosswalk|lawn|grass|turf|ground|gutter|driveway|paving', re.I)

# Lambert conformal conic, NAD83(2011) Texas Central (EPSG:6578), metres
a = 6378137.0; f = 1 / 298.257222101; e = math.sqrt(2 * f - f * f)
p1, p2, p0, l0 = map(math.radians, (31 + 53 / 60, 30 + 7 / 60, 29 + 40 / 60, -100 - 20 / 60))
x_0, y_0 = 700000.0, 3000000.0
m_ = lambda p: math.cos(p) / math.sqrt(1 - e * e * math.sin(p) ** 2)
t_ = lambda p: math.tan(math.pi / 4 - p / 2) / ((1 - e * math.sin(p)) / (1 + e * math.sin(p))) ** (e / 2)
n = (math.log(m_(p1)) - math.log(m_(p2))) / (math.log(t_(p1)) - math.log(t_(p2)))
F = m_(p1) / (n * t_(p1) ** n); rho0 = a * F * t_(p0) ** n
def lcc(lon, lat):
    p = np.radians(lat); l = np.radians(lon)
    t = np.tan(np.pi / 4 - p / 2) / ((1 - e * np.sin(p)) / (1 + e * np.sin(p))) ** (e / 2)
    rho = a * F * t ** n; th = n * (l - l0)
    return x_0 + rho * np.sin(th), y_0 + rho0 - rho * np.cos(th)
R = 6378137.0; LAT0, LON0 = 30.28601, -97.73932
def app_to_lcc(x, z):
    lon = LON0 + np.degrees(x / (R * math.cos(math.radians(LAT0)))); lat = LAT0 - np.degrees(z / R)
    return lcc(lon, lat)


def tris(path):
    b = open(path, 'rb').read(); jl = struct.unpack('<I', b[12:16])[0]; j = json.loads(b[20:20 + jl]); bin0 = 20 + jl + 8; out = []
    def acc(i):
        a_ = j['accessors'][i]; v = j['bufferViews'][a_['bufferView']]; off = bin0 + v.get('byteOffset', 0) + a_.get('byteOffset', 0)
        dt = {5126: np.float32, 5125: np.uint32, 5123: np.uint16}[a_['componentType']]; k = {'VEC3': 3, 'SCALAR': 1}[a_['type']]
        arr = np.frombuffer(b, dt, a_['count'] * k, off); return arr.reshape(-1, k) if k > 1 else arr
    for m in j['meshes']:
        for pr in m['primitives']:
            if GROUND.search(j['materials'][pr['material']]['name']): continue
            P = acc(pr['attributes']['POSITION']); I = acc(pr['indices']); T = P[I.reshape(-1, 3)]
            T = T[T[..., 1].max(1) > 3.0]
            if len(T): out.append(T)
    return np.concatenate(out) if out else None


def check(slug, v, glb):
    T = tris(glb)
    if T is None: return None
    X = T[..., 0] + v['x']; Z = T[..., 2] + v['z']
    ex, ny = app_to_lcc(X, Z)
    col = (ex - X0) / RES; row = (YT - ny) / RES
    pad = 30 / RES
    c0, c1 = int(col.min() - pad), int(col.max() + pad); r0, r1 = int(row.min() - pad), int(row.max() + pad)
    if r0 < 0 or c0 < 0 or r1 > HAG.shape[0] or c1 > HAG.shape[1]: return {'error': 'outside the 2021 scan raster'}
    W, H = c1 - c0, r1 - r0
    if W > 2400 or H > 2400: return {'error': 'window too large'}
    scan = (np.asarray(HAG[r0:r1, c0:c1], dtype=np.float32) > 3.0)
    img = Image.new('1', (W, H)); d = ImageDraw.Draw(img)
    for k in range(len(T)):
        d.polygon([(col[k, i] - c0, row[k, i] - r0) for i in range(3)], fill=1)
    mod = np.array(img)
    iou0 = float((mod & scan).sum() / max((mod | scan).sum(), 1)); cov = float((mod & scan).sum() / max(mod.sum(), 1))
    # best shift on a 1 m grid, within 30 m
    ds = 2
    m2 = mod[::ds, ::ds].astype(np.float32); s2 = scan[::ds, ::ds].astype(np.float32)
    cc = fftconvolve(s2, m2[::-1, ::-1], mode='full')
    # mask correlation -> IoU needs the union: use normalized overlap, restrict to +-30 m
    cy, cx = m2.shape[0] - 1, m2.shape[1] - 1
    lim = int(30 / (RES * ds)); best = (-1, 0, 0)
    sub = cc[max(cy - lim, 0): cy + lim + 1, max(cx - lim, 0): cx + lim + 1]
    oy, ox = max(cy - lim, 0), max(cx - lim, 0)
    iy, ix = np.unravel_index(np.argmax(sub), sub.shape)
    dy = (oy + iy - cy) * ds * RES; dx = (ox + ix - cx) * ds * RES          # shift of the scan relative to the model, in grid cells * m
    # scan moved by (dy rows, dx cols) -> model should move by the same in image; image rows go south: north shift = -dy
    shift_e = dx; shift_n = -dy
    ov0 = sub[lim, lim] if sub.shape[0] > lim and sub.shape[1] > lim else 0
    return {'iou0': round(iou0, 3), 'cover0': round(cov, 3), 'model_m2': round(float(mod.sum()) * RES * RES), 'scan_m2': round(float(scan.sum()) * RES * RES),
            'best_shift_e_m': round(shift_e, 1), 'best_shift_n_m': round(shift_n, 1), 'overlap_gain': round(float(sub.max() / max(ov0, 1)), 2)}


if __name__ == '__main__':
    only = sys.argv[1:]
    res = {}
    for s, v in src.items():
        if 'skip' in v or (only and s not in only): continue
        glb = EX + ('/app/' if s == 'dkr-memorial-stadium' else '/') + s + '.near.glb'
        if not os.path.exists(glb): continue
        try: r = check(s, v, glb)
        except Exception as ex_: r = {'error': repr(ex_)[:100]}
        res[s] = r
        if only or (r and 'iou0' in r and (r['iou0'] < 0.5 or math.hypot(r['best_shift_e_m'], r['best_shift_n_m']) > 5)): print(s, r)
    json.dump(res, open(os.environ.get('SCAN_OUT', '/tmp/v2_scan_check.json'), 'w'))
    ok = [r for r in res.values() if r and 'iou0' in r]
    print('checked', len(ok), 'of', len(res), '; IoU>=0.6:', sum(1 for r in ok if r['iou0'] >= 0.6), '; shift<=3 m:', sum(1 for r in ok if math.hypot(r['best_shift_e_m'], r['best_shift_n_m']) <= 3))
