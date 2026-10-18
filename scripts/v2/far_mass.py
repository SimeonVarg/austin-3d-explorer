#!/usr/bin/env python3
"""v2 tiles, lod1: a building's FAR model as its MASS (scripts/gltf_far.py's far copy: outline and roof levels on a grid turned to the
building's own walls, walls in colour bands, no single window, no thin part), written as a plain .glb in the same frame as the near file.

    python3 scripts/v2/far_mass.py EXPORT_DIR slug [slug ...]      reads EXPORT_DIR/<slug>.near.glb, writes EXPORT_DIR/<slug>.mass.glb

Why the mass and not the near model with its small parts taken off: at the distance lod1 is drawn from, a storey is one or two pixels, so
any window grid, frame grid or rail line left in the model flickers in motion (repo rule 15). The mass has none; what it keeps of the
facade is its colour bands, and a band thinner than FAR_BAND_MIN_M takes its wall's mean colour.
GLASS: the v2 near files mark glass by extras.v2_kind; here it is the builders' standard glass (its mirror is the renderer's own). A band's
glass share g becomes a mirror of about the near glass's strength (F0 = GLASS_F0 x g) on the band's own mean diffuse colour, solved as
metal/rough PBR (see far_material). If the far copy cannot be made (no part left), no .mass.glb is written and the tiler falls back to
the near model with its small parts removed (<slug>.far.glb)."""
import sys, os, json, math, struct
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
import gltf_far as gf   # scripts/gltf_far.py

# ── PARAMETERS ──────────────────────────────────────────────────────────
FAR_BAND_MIN_M = 2.0      # a colour band lower than this is drawn in its wall's mean colour (it would be a pixel or two tall)
GLASS_F0 = 0.25           # the rig's glass (IOR 3) mirror strength, as in blender_export_v2.py
GLASS_ROUGH = 0.1
WALL_ROUGH = 1.0
METAL_MAX = 0.98


def read_v2(path):
    js, bin_ = gf.read_glb(path); out = []
    for node in js.get('nodes', []):
        if node.get('mesh') is None: continue
        for p in js['meshes'][node['mesh']]['primitives']:
            m = js['materials'][p['material']]; kind = (m.get('extras') or {}).get('v2_kind', 'plain'); at = p['attributes']
            pos = gf.accessor(js, bin_, at['POSITION']); nrm = gf.accessor(js, bin_, at['NORMAL'])
            idx = gf.accessor(js, bin_, p['indices']).astype(np.int64).reshape(-1, 3)
            pb = m.get('pbrMetallicRoughness', {}); base = np.array((pb.get('baseColorFactor') or [1, 1, 1, 1])[:3], float)
            glass = kind != 'plain'
            if kind == 'glass':                     # the export's metal stand-in: back to the pane's own dark diffuse
                base = base * (1 - float(pb.get('metallicFactor', 0)))
            out.append(dict(name=m.get('name', ''), pos=np.stack([pos[:, 0], -pos[:, 2], pos[:, 1]], 1), nrm=np.stack([nrm[:, 0], -nrm[:, 2], nrm[:, 1]], 1),
                            uv=None, idx=idx, base=base, paint=None, glass=glass, std=glass, mirror=np.zeros(3)))
    return out


def far_material(base, g):
    """(base colour, metallic, roughness) for a band with mean diffuse `base` and glass share g: F0 = 0.04 (1-m) + b m with b = base / (1-m)"""
    F = GLASS_F0 * g; D = float(np.dot(base, [0.2126, 0.7152, 0.0722]))
    if F <= 0.04 or D <= 0: return base, 0.0, WALL_ROUGH
    lo, hi = 0.0, METAL_MAX
    for _ in range(40):
        m = (lo + hi) / 2
        if D * m / (1 - m) + 0.04 * (1 - m) < F: lo = m
        else: hi = m
    m = (lo + hi) / 2
    return np.clip(base / (1 - m), 0, 1), m, WALL_ROUGH + (GLASS_ROUGH - WALL_ROUGH) * g


def mass_glb(out, dst):
    th = math.radians(out['turnDeg']); c, s = math.cos(th), math.sin(th)
    back = lambda u, v: (u * c - v * s, u * s + v * c)
    col = np.array(out['colours'], float).reshape(-1, 8)
    quads = {}                                   # colour index -> list of (4 corners (east, north, up), normal)
    R = np.array(out['roofs'], float).reshape(-1, 6)
    for u0, u1, v0, v1, z, ci in R:
        u0, u1, v0, v1, z = u0 / 100, u1 / 100, v0 / 100, v1 / 100, z / 100
        q = [(*back(u0, v0), z), (*back(u1, v0), z), (*back(u1, v1), z), (*back(u0, v1), z)]
        quads.setdefault(int(ci), []).append((q, (0.0, 0.0, 1.0)))
    W = np.array(out['walls'], float).reshape(-1, 10)
    for d, plane, a0, a1, z0, z1, band, wallc, nx, ny in W:
        d = int(d); plane, a0, a1, z0, z1 = plane / 100, a0 / 100, a1 / 100, z0 / 100, z1 / 100
        if z1 - z0 < 1e-3 or a1 - a0 < 1e-3: continue
        ci = int(band) if (z1 - z0) >= FAR_BAND_MIN_M else int(wallc)
        if d < 2:   # plane is u = const, along v
            p = [(plane, a0), (plane, a1)]
        else:       # plane is v = const, along u
            p = [(a0, plane), (a1, plane)]
        (x0, y0), (x1, y1) = back(*p[0]), back(*p[1])
        q = [(x0, y0, z0), (x1, y1, z0), (x1, y1, z1), (x0, y0, z1)]
        n = back(nx / 1000, ny / 1000)
        # wind the quad so that it faces its normal
        e1 = np.subtract(q[1], q[0]); e2 = np.subtract(q[3], q[0]); fn = np.cross(e1, e2)
        if fn[0] * n[0] + fn[1] * n[1] < 0: q = [q[1], q[0], q[3], q[2]]
        quads.setdefault(ci, []).append((q, (n[0], n[1], 0.0)))
    js = {'asset': {'version': '2.0', 'generator': 'flyover scripts/v2/far_mass.py'}, 'scenes': [{'nodes': [0]}], 'scene': 0,
          'nodes': [{'mesh': 0, 'name': 'building'}], 'meshes': [{'primitives': [], 'name': 'building'}], 'materials': [], 'accessors': [], 'bufferViews': [], 'buffers': []}
    blob = bytearray()

    def add(arr, target, comp, typ, mm=False):
        nonlocal blob
        b = arr.tobytes(); off = len(blob); blob += b; blob += b'\0' * ((4 - len(blob) % 4) % 4)
        js['bufferViews'].append({'buffer': 0, 'byteOffset': off, 'byteLength': len(b), 'target': target})
        a = {'bufferView': len(js['bufferViews']) - 1, 'componentType': comp, 'count': int(arr.shape[0]), 'type': typ}
        if mm: a['min'] = [float(v) for v in arr.min(0)]; a['max'] = [float(v) for v in arr.max(0)]
        js['accessors'].append(a); return len(js['accessors']) - 1
    tris = 0
    for ci in sorted(quads):
        V, N, I = [], [], []
        for q, n in quads[ci]:
            k = len(V); V += q; N += [n] * 4; I += [k, k + 1, k + 2, k, k + 2, k + 3]
        V = np.array(V); N = np.array(N); N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9)
        Vg = np.stack([V[:, 0], V[:, 2], -V[:, 1]], 1).astype(np.float32); Ng = np.stack([N[:, 0], N[:, 2], -N[:, 1]], 1).astype(np.float32)
        base = col[ci, 0:3] / 10000; g = col[ci, 6] / 1000
        b, m, r = far_material(base, g)
        js['materials'].append({'name': 'far_%d' % ci, 'pbrMetallicRoughness': {'baseColorFactor': [round(float(x), 5) for x in b] + [1.0], 'metallicFactor': round(float(m), 4),
                                'roughnessFactor': round(float(r), 4)}, 'extras': {'v2_kind': 'plain', 'glass_share': round(float(g), 3)}})
        a_p = add(Vg, 34962, 5126, 'VEC3', True); a_n = add(Ng, 34962, 5126, 'VEC3'); a_i = add(np.array(I, np.uint32), 34963, 5125, 'SCALAR')
        js['meshes'][0]['primitives'].append({'attributes': {'POSITION': a_p, 'NORMAL': a_n}, 'indices': a_i, 'material': len(js['materials']) - 1})
        tris += len(I) // 3
    js['buffers'].append({'byteLength': len(blob)})
    t = json.dumps(js, separators=(',', ':')).encode(); t += b' ' * ((4 - len(t) % 4) % 4)
    data = b'glTF' + struct.pack('<II', 2, 12 + 8 + len(t) + 8 + len(blob)) + struct.pack('<I', len(t)) + b'JSON' + t + struct.pack('<I', len(blob)) + b'BIN\0' + bytes(blob)
    tmp = dst + '.tmp'; open(tmp, 'wb').write(data); os.replace(tmp, dst)
    return tris


def main():
    ex = sys.argv[1]; gf.read_look = read_v2
    for slug in sys.argv[2:]:
        src = os.path.join(ex, slug + '.near.glb'); dst = os.path.join(ex, slug + '.mass.glb')
        try:
            out, info = gf.far_copy(src)
            n = mass_glb(out, dst)
            print('MASS', slug, n, 'triangles', info['parts'], 'parts', 'top', info['top'])
        except Exception as e:
            if os.path.exists(dst): os.remove(dst)
            print('MASS-FAILED', slug, repr(e)[:200])


if __name__ == '__main__':
    main()
