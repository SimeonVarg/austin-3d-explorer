#!/usr/bin/env python3
"""v2 tiles, step 3: does each exported model stand on its surveyed outline?

    python3 scripts/v2/check_place.py SOURCES.json EXPORT_DIR OUT.json [slug ...]

For every exported model (EXPORT_DIR/<slug>.near.glb, in the model's own metres): everything higher than MIN_Z_M above the ground is
projected onto the ground (a RES_M raster) and compared with the map outline the package names (sources.json rings_local):
  area ratio      the model's ground-plan area / the outline's
  centre offset   metres between the two plans' centres
  covered         share of the outline the model covers; outside: share of the model outside the outline
Flags (FLAG_*): centre more than FLAG_OFFSET_M off, or area off by more than FLAG_AREA (a share), or a base that is not on the ground.
Prints the placement table and writes it as json."""
import json, math, struct, sys, os
import numpy as np
from PIL import Image, ImageDraw

# ── PARAMETERS ──────────────────────────────────────────────────────────
RES_M = 0.25
MIN_Z_M = 1.0          # what lies lower is paving, steps and kerbs, not the building's plan
FLAG_OFFSET_M = 2.0
FLAG_AREA = 0.10
FLAG_BASE_M = 1.0      # the model's lowest point should be within this of the ground (y = 0)
HIDE_COVER = 0.5       # a map/massing outline whose area the model's footprint covers by more than this share is hidden by the app


def tris(p):
    skip_site = os.path.basename(os.path.dirname(os.path.abspath(p))) == 'app'
    b = open(p, 'rb').read(); jl = struct.unpack('<I', b[12:16])[0]; j = json.loads(b[20:20 + jl]); bin0 = 20 + jl + 8; out = []
    def acc(i):
        a = j['accessors'][i]; v = j['bufferViews'][a['bufferView']]; off = bin0 + v.get('byteOffset', 0) + a.get('byteOffset', 0)
        dt = {5126: np.float32, 5125: np.uint32, 5123: np.uint16}[a['componentType']]; k = {'VEC3': 3, 'SCALAR': 1}[a['type']]
        sz = np.dtype(dt).itemsize * k; st = v.get('byteStride') or sz      # (the app copy is written interleaved: honour the stride)
        if st == sz:
            arr = np.frombuffer(b, dt, a['count'] * k, off)
        else:
            raw = np.frombuffer(b, np.uint8, (a['count'] - 1) * st + sz, off)
            arr = np.stack([np.frombuffer(raw[q * st: q * st + sz].tobytes(), dt) for q in range(a['count'])]).reshape(-1) if a['count'] < 20000 else \
                np.ascontiguousarray(np.lib.stride_tricks.as_strided(raw, shape=(a['count'], sz), strides=(st, 1))).view(dt).reshape(-1)
        return arr.reshape(-1, k) if k > 1 else arr
    for m in j['meshes']:
        for pr in m['primitives']:
            if skip_site and j['materials'][pr['material']]['name'].startswith('site_'): continue     # an app copy's graded ground is not the building
            P = acc(pr['attributes']['POSITION']); I = acc(pr['indices']); out.append(P[I.reshape(-1, 3)])
    return np.concatenate(out) if out else np.zeros((0, 3, 3), np.float32)


def check(row, glb):
    T = tris(glb)
    if not len(T): return {'error': 'empty model'}
    ymin = float(T[..., 1].min()); ymax = float(T[..., 1].max())
    T2 = T[T[..., 1].max(1) > MIN_Z_M]
    xy = np.stack([T2[..., 0], -T2[..., 2]], -1)            # east, north
    rings = row.get('rings_package') or row['rings_local']     # the outline the builder followed (scan trace where the map was off)
    allp = np.concatenate([xy.reshape(-1, 2), np.array([p for g in rings + [o[1] for o in row.get('nearby_outlines', [])] for p in g])])
    lo = allp.min(0) - 2; hi = allp.max(0) + 2
    sz = np.ceil((hi - lo) / RES_M).astype(int) + 1
    px = lambda q: [((x - lo[0]) / RES_M, (hi[1] - y) / RES_M) for x, y in q]
    A = Image.new('1', tuple(sz)); dA = ImageDraw.Draw(A)
    for t in xy:
        if abs((t[1][0] - t[0][0]) * (t[2][1] - t[0][1]) - (t[2][0] - t[0][0]) * (t[1][1] - t[0][1])) > 1e-6: dA.polygon(px(t), fill=1)
    O = Image.new('1', tuple(sz)); dO = ImageDraw.Draw(O)
    for g in rings: dO.polygon(px(g), fill=1)
    a = np.array(A); o = np.array(O)
    yy, xx = np.mgrid[0:a.shape[0], 0:a.shape[1]]
    def centre(m):
        n = m.sum(); return np.array([xx[m].sum() / n, yy[m].sum() / n]) * RES_M if n else np.array([np.nan, np.nan])
    off = float(np.linalg.norm(centre(a) - centre(o)))
    am, om = a.sum() * RES_M ** 2, o.sum() * RES_M ** 2
    # other outlines the model stands on (rasterised on the same grid; parts off the grid count as not covered)
    hides = []
    for oid, ring in row.get('nearby_outlines', []):
        Q = Image.new('1', tuple(sz)); ImageDraw.Draw(Q).polygon(px(ring), fill=1); q = np.array(Q)
        if q.sum() and (a & q).sum() / q.sum() > HIDE_COVER: hides.append(oid)
    r = {'hides': hides, 'height_m': round(ymax, 1), 'base_m': round(ymin, 2), 'model_m2': round(float(am)), 'outline_m2': round(float(om)),
         'area_ratio': round(float(am / max(om, 1e-6)), 3), 'centre_off_m': round(off, 2),
         'covered': round(float((a & o).sum() / max(o.sum(), 1)), 3), 'outside': round(float((a & ~o).sum() / max(a.sum(), 1)), 3)}
    flags = []
    if off > FLAG_OFFSET_M: flags.append('centre %.1f m off' % off)
    if abs(r['area_ratio'] - 1) > FLAG_AREA: flags.append('area x%.2f' % r['area_ratio'])
    if abs(ymin) > FLAG_BASE_M: flags.append('base at %.1f m' % ymin)
    r['flags'] = flags
    return r


def main():
    src = json.load(open(sys.argv[1])); ex = sys.argv[2]; outp = sys.argv[3]; only = set(sys.argv[4:])
    old = json.load(open(outp)) if os.path.exists(outp) else {}
    for s, row in src.items():
        if 'skip' in row or (only and s not in only): continue
        glb = '%s/%s.near.glb' % (ex, s)
        if not os.path.exists(glb): continue
        r = check(row, glb); r.update({'x': row['x'], 'z': row['z'], 'outline': row.get('package_outline', 'map')}); old[s] = r
    tmp = outp + '.tmp'; json.dump(old, open(tmp, 'w'), indent=1); os.replace(tmp, outp)
    print('%-44s %9s %9s %6s %8s %8s %6s %6s  %s' % ('slug', 'x', 'z', 'top', 'model', 'outline', 'ratio', 'off', 'flags'))
    for s in sorted(old):
        if only and s not in only: continue
        r = old[s]
        if 'error' in r: print('%-44s %s' % (s, r['error'])); continue
        print('%-44s %9.1f %9.1f %6.1f %8d %8d %6.2f %6.1f  %s' % (s[:44], r['x'], r['z'], r['height_m'], r['model_m2'], r['outline_m2'], r['area_ratio'], r['centre_off_m'], '; '.join(r['flags'])))


if __name__ == '__main__':
    main()
