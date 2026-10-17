#!/usr/bin/env python3
"""A browserless picture of plain .glb files (a decoded tile, or a building's export): a small numpy rasteriser, sun + sky shading.
    python3 scripts/v2/render_glb.py OUT.png A.glb [B.glb ...] [--az 225] [--el 30] [--w 900] [--h 600] [--fov 40] [--dist 1.6]
          [--at x,y,z] [--side]   (--side: every file in its own panel, same camera, left to right)
For checking shapes, placement and colours only; the app's light is not reproduced. Colours are on the Blender rig's scale (white
paint 0.17), so EXPOSURE lifts them."""
import json, struct, sys, io, math
import numpy as np
from PIL import Image

EXPOSURE = 4.2
SUN = np.array([0.45, 0.75, 0.35]); SUN /= np.linalg.norm(SUN)
SUN_K, SKY_K = 0.75, 0.55
BG = (205, 214, 222)


def load(path):
    b = open(path, 'rb').read(); jl = struct.unpack('<I', b[12:16])[0]; j = json.loads(b[20:20 + jl]); off = 20 + jl
    bl = struct.unpack('<I', b[off:off + 4])[0]; bin_ = b[off + 8: off + 8 + bl]
    CT = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8}; NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}
    def acc(i):
        a = j['accessors'][i]; v = j['bufferViews'][a['bufferView']]; dt = np.dtype(CT[a['componentType']]); n = NC[a['type']]
        o = v.get('byteOffset', 0) + a.get('byteOffset', 0); st = v.get('byteStride') or dt.itemsize * n
        if st == dt.itemsize * n: return np.frombuffer(bin_, dt, a['count'] * n, o).reshape(a['count'], n).astype(np.float64)
        raw = np.frombuffer(bin_, np.uint8, (a['count'] - 1) * st + dt.itemsize * n, o)
        return np.stack([np.frombuffer(raw[k * st: k * st + dt.itemsize * n].tobytes(), dt) for k in range(a['count'])]).astype(np.float64)
    imgs = []
    for im in j.get('images', []):
        v = j['bufferViews'][im['bufferView']]; o = v.get('byteOffset', 0)
        imgs.append(np.asarray(Image.open(io.BytesIO(bin_[o:o + v['byteLength']])).convert('RGB'), np.float64) / 255)
    P, C = [], []
    for m in j['meshes']:
        for pr in m['primitives']:
            pos = acc(pr['attributes']['POSITION']); idx = acc(pr['indices']).astype(int).reshape(-1, 3)
            mat = j['materials'][pr['material']] if 'material' in pr else {}
            pb = mat.get('pbrMetallicRoughness', {}); base = np.array(pb.get('baseColorFactor', [1, 1, 1, 1])[:3])
            T = pos[idx]
            if 'baseColorTexture' in pb and 'TEXCOORD_0' in pr['attributes']:
                uv = acc(pr['attributes']['TEXCOORD_0'])[idx].mean(1); tex = imgs[j['textures'][pb['baseColorTexture']['index']]['source']]
                h, w, _ = tex.shape; s = tex[np.clip((uv[:, 1] * h).astype(int), 0, h - 1), np.clip((uv[:, 0] * w).astype(int), 0, w - 1)]
                col = np.where(s <= 0.04045, s / 12.92, ((s + 0.055) / 1.055) ** 2.4) * base
            else: col = np.repeat(base[None], len(T), 0)
            met = pb.get('metallicFactor', 0)
            if met > 0.5 and 'metallicRoughnessTexture' not in pb: col = col * 0.0 + np.array([0.06, 0.075, 0.09])   # a mirror shows sky: a stand-in
            P.append(T); C.append(col)
    return np.concatenate(P), np.concatenate(C)


def render(P, C, eye, at, w, h, fov):
    f = at - eye; f /= np.linalg.norm(f); r = np.cross(f, [0, 1, 0]); r /= np.linalg.norm(r); u = np.cross(r, f)
    n = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0]); n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
    view = (P - eye) @ np.stack([r, u, f], 1)              # x right, y up, z forward
    k = 0.5 * h / math.tan(math.radians(fov) / 2)
    z = view[..., 2]; ok = (z > 0.5).all(1)
    nn = np.where(((n * (eye - P[:, 0])).sum(1) < 0)[:, None], -n, n)
    shade = SUN_K * np.clip(nn @ SUN, 0, 1) + SKY_K * (0.6 + 0.4 * nn[:, 1])
    rgb = np.clip(C * shade[:, None] * EXPOSURE, 0, 1)
    rgb = np.where(rgb <= 0.0031308, rgb * 12.92, 1.055 * rgb ** (1 / 2.4) - 0.055)
    sx = w / 2 + k * view[..., 0] / np.maximum(z, 1e-6); sy = h / 2 - k * view[..., 1] / np.maximum(z, 1e-6)
    img = np.empty((h, w, 3)); img[:] = np.array(BG) / 255; zb = np.full((h, w), np.inf)
    for t in np.nonzero(ok)[0]:
        x0, x1 = int(max(0, sx[t].min())), int(min(w - 1, sx[t].max() + 1)); y0, y1 = int(max(0, sy[t].min())), int(min(h - 1, sy[t].max() + 1))
        if x0 > x1 or y0 > y1: continue
        yy, xx = np.mgrid[y0:y1 + 1, x0:x1 + 1] + 0.5
        (ax, bx, cx), (ay, by, cy) = sx[t], sy[t]
        d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(d) < 1e-9: continue
        l1 = ((by - cy) * (xx - cx) + (cx - bx) * (yy - cy)) / d; l2 = ((cy - ay) * (xx - cx) + (ax - cx) * (yy - cy)) / d; l3 = 1 - l1 - l2
        ins = (l1 >= 0) & (l2 >= 0) & (l3 >= 0)
        if not ins.any(): continue
        zz = 1 / (l1 / z[t, 0] + l2 / z[t, 1] + l3 / z[t, 2])
        sub = zb[y0:y1 + 1, x0:x1 + 1]; m = ins & (zz < sub)
        sub[m] = zz[m]; img[y0:y1 + 1, x0:x1 + 1][m] = rgb[t]
    return (img * 255).astype(np.uint8)


def main():
    a = sys.argv[1:]; opts = {}; files = []
    i = 1
    while i < len(a):
        if a[i].startswith('--'):
            if a[i] == '--side': opts['side'] = True; i += 1; continue
            opts[a[i][2:]] = a[i + 1]; i += 2
        else: files.append(a[i]); i += 1
    out = a[0]
    w, h = int(opts.get('w', 900)), int(opts.get('h', 600)); fov = float(opts.get('fov', 40))
    loaded = [load(f) for f in files]
    allP = np.concatenate([p for p, _ in loaded]).reshape(-1, 3)
    lo, hi = allP.min(0), allP.max(0)
    at = np.array([float(v) for v in opts['at'].split(',')]) if 'at' in opts else (lo + hi) / 2
    rad = np.linalg.norm(hi - lo) / 2 * float(opts.get('dist', 1.6)) / math.tan(math.radians(fov) / 2)
    az, el = math.radians(float(opts.get('az', 225))), math.radians(float(opts.get('el', 30)))
    eye = at + rad * np.array([math.sin(az) * math.cos(el), math.sin(el), math.cos(az) * math.cos(el)])
    if opts.get('side'): panels = [render(p, c, eye, at, w, h, fov) for p, c in loaded]
    else: panels = [render(allP.reshape(-1, 3, 3), np.concatenate([c for _, c in loaded]), eye, at, w, h, fov)]
    Image.fromarray(np.concatenate(panels, 1)).save(out)
    print('RENDER', out, 'eye', np.round(eye, 1).tolist(), 'at', np.round(at, 1).tolist(), 'triangles', len(allP) // 3)


if __name__ == '__main__':
    main()
