#!/usr/bin/env python3
"""far_coat.py <repo> <tile id> <out.glb>   (env: TEXEL VOX ERR SS VIS_MIN; needs open3d, scikit-image, scipy, xatlas, pillow)
The FAR COPY of a tile: for each building, a tight low-triangle shell of what can be seen from outside, and one picture (atlas)
of the full model's own colours laid on it. Every part smaller than a texel (frames, rails, fins) becomes paint on the shell,
averaged over the texel, so far away it is filtered like any texture instead of flickering as triangles under a pixel."""
import sys, json, struct, io, time, os, subprocess
import numpy as np
from PIL import Image
import open3d as o3d
from scipy import ndimage
from skimage import measure
import xatlas

HERE = os.path.dirname(os.path.abspath(__file__))
REPO, TILE, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
TEXEL = float(os.environ.get('TEXEL', 0.6)); VOX = float(os.environ.get('VOX', 0.5)); ERR = float(os.environ.get('ERR', 0.45))
SS = int(os.environ.get('SS', 6))            # rays per texel side (each moved at random inside its own cell: a regular grid of rays would beat with a regular facade)
RNG = np.random.default_rng(20261111)
D_OUT, D_IN = float(os.environ.get('D_OUT', 1.2)), float(os.environ.get('D_IN', 1.0))
SEE_PX_M = TEXEL * 1.5                       # the pixel size (m) at which the far copy takes over: coverage-fade parts are baked as they look there
MAX_VOX = 60e6
N_DIR, VIS_MIN = 96, float(os.environ.get('VIS_MIN', 0.025))   # a point is OUTSIDE when it sees out in this share of the directions (an open court seen only from steep above stays open; a room behind a crack does not)
DEEP_M, DEEP_K = 8.0, float(os.environ.get('DEEP_K', 0.35))   # seen through an opening, deeper than D_IN: that surface, this much darker
LUMA = np.array([0.2126, 0.7152, 0.0722])
DARK_MIN_SHARE, DARK_RATIO, DARK_GAP = 0.01, 2.0, 0.03   # a face has a dark part only if it is 1 to 99 % of the face and the bright part's mean is over RATIO x the dark part's + GAP
MODEL = 3                             # how the colours are held (v2/tiles.js FAR.MODEL)
VOID_M = 120.0                        # ...and past DEEP_M a ray looks on this far for the end of a void
MAN = json.load(open(os.path.join(REPO, 'v2/tiles/manifest.json')))
DEF = next(t for t in MAN['tiles'] if t['id'] == TILE)
RG = json.load(open(os.path.join(REPO, 'v2/data/roof_glass.json')))
CLAY_MEAN, CLAY_ROUGH = np.array([0.078, 0.035, 0.026], np.float32), 0.8      # v2/look.js LOOK.CLAY.MEAN / ROUGHNESS (far away the rows are their mean)
SRC = f'/tmp/farcoat_{os.getpid()}_{TILE}.plain.glb'
subprocess.check_output(['node', os.path.join(REPO, 'scripts/v2/decode_tile.mjs'), os.path.join(REPO, 'v2', DEF['lod0']), SRC], cwd=REPO, env={**os.environ, 'PATH': os.path.expanduser('~/miniforge3/envs/utx/bin') + ':' + os.environ['PATH']})
T0 = time.time()
def log(*a): print(f'[{time.time() - T0:6.1f}s]', *a, flush=True)

# ── read the plain glb ──────────────────────────────────────────────────
CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}
b = open(SRC, 'rb').read(); off = 12; ch = []
while off < len(b):
    n, t = struct.unpack('<I4s', b[off:off + 8]); ch.append(b[off + 8:off + 8 + n]); off += 8 + n
js, BIN = json.loads(ch[0]), ch[1]
os.remove(SRC)
def acc(i):
    a = js['accessors'][i]; bv = js['bufferViews'][a['bufferView']]; dt = np.dtype(CT[a['componentType']]); n = NC[a['type']]
    o = bv.get('byteOffset', 0) + a.get('byteOffset', 0); stride = bv.get('byteStride') or dt.itemsize * n
    if stride == dt.itemsize * n: arr = np.frombuffer(BIN, dt, a['count'] * n, o).reshape(a['count'], n)
    else:
        raw = np.frombuffer(BIN, np.uint8, stride * (a['count'] - 1) + dt.itemsize * n, o)
        arr = np.lib.stride_tricks.as_strided(raw, (a['count'], dt.itemsize * n), (stride, 1)).copy().view(dt).reshape(a['count'], n)
    if a.get('normalized'): arr = arr.astype(np.float32) / np.iinfo(dt).max
    return arr
def image(tex):
    if tex is None: return None
    im = js['images'][js['textures'][tex['index']]['source']]; bv = js['bufferViews'][im['bufferView']]
    return np.asarray(Image.open(io.BytesIO(BIN[bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']])).convert('RGBA'), np.float32) / 255
srgb2lin = lambda c: np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
lin2srgb = lambda c: np.where(c <= 0.0031308, c * 12.92, 1.055 * np.clip(c, 0, None) ** (1 / 2.4) - 0.055)

mats = []
for m in js['materials']:
    pbr = m.get('pbrMetallicRoughness', {}); ex = m.get('extras') or {}
    base = image(pbr.get('baseColorTexture')); mr = image(pbr.get('metallicRoughnessTexture'))
    M = dict(name=m.get('name', ''), kind=ex.get('v2_kind', ''), bf=np.array(pbr.get('baseColorFactor', [1, 1, 1, 1]), np.float32),
             mf=float(pbr.get('metallicFactor', 1)), rf=float(pbr.get('roughnessFactor', 1)), photo=bool(ex.get('photo_material')),
             fade_to=ex.get('v2_fade_to'), fade_m=float(ex.get('v2_fade_m', 0.3)), base=None, base8=None if base is None else (base * 255 + 0.5).astype(np.uint8), mr=mr, mips=None)
    if base is not None:
        lin = np.concatenate([srgb2lin(base[..., :3]), base[..., 3:]], -1)
        M['base'] = lin
        if M['photo']:                       # a mip chain (box), so a photo texture is read at about the bake's own sample spacing
            chain = [lin]; im = lin
            while min(im.shape[:2]) > 1:
                h, w = im.shape[0] // 2 * 2, im.shape[1] // 2 * 2
                im = im[:h, :w].reshape(h // 2, 2, w // 2, 2, 4).mean((1, 3)); chain.append(im)
            M['mips'] = chain
    mats.append(M)
P, UV, BID, TRI, TMAT = [], [], [], [], []
base_v = 0
for mesh in js['meshes']:
    for pr in mesh['primitives']:
        a = pr['attributes']; p = acc(a['POSITION']).astype(np.float64); n = len(p)
        uv = acc(a['TEXCOORD_0']).astype(np.float64) if 'TEXCOORD_0' in a else np.zeros((n, 2))
        bid = acc(a['_BUILDING'])[:, 0].astype(np.int32) if '_BUILDING' in a else np.zeros(n, np.int32)
        idx = acc(pr['indices'])[:, 0].astype(np.int64).reshape(-1, 3) if 'indices' in pr else np.arange(n).reshape(-1, 3)
        P.append(p); UV.append(uv); BID.append(bid); TRI.append(idx + base_v); TMAT.append(np.full(len(idx), pr['material'], np.int32)); base_v += n
P, UV, BID, TRI, TMAT = np.concatenate(P), np.concatenate(UV), np.concatenate(BID), np.concatenate(TRI), np.concatenate(TMAT)
TBID = BID[TRI[:, 0]]
# clay tile roofs (v2/clay.js): a palette triangle of a listed building whose palette colour is one of that building's clay colours
TCLAY = np.zeros(len(TRI), bool)
for bi, slug in enumerate(DEF.get('buildings', [])):
    cs = (RG.get('clay') or {}).get(slug)
    if not cs: continue
    for mi, M in enumerate(mats):
        if M['base8'] is None or not M['name'].startswith('Palette') or M['kind'] == 'glass': continue
        sel = np.nonzero((TBID == bi) & (TMAT == mi))[0]
        if not len(sel): continue
        img = M['base8']; h, w = img.shape[:2]; uv = UV[TRI[sel, 0]]
        px = img[np.clip(np.floor(uv[:, 1] * h).astype(int), 0, h - 1), np.clip(np.floor(uv[:, 0] * w).astype(int), 0, w - 1), :3].astype(int)
        hit = np.zeros(len(sel), bool)
        for c in cs: hit |= np.all(np.abs(px - np.array(c[:3])) <= 2, 1)
        TCLAY[sel[hit]] = True
log(f'{TILE}: {len(TRI)} triangles, clay {int(TCLAY.sum())}, {len(mats)} materials, buildings {sorted(set(TBID.tolist()))}')

def tri_colour(tri_ids, bary):
    """linear base colour (n,3), roughness (n), metalness (n) of the full model at points on its triangles"""
    n = len(tri_ids); col = np.zeros((n, 3), np.float32); rough = np.ones(n, np.float32); metal = np.zeros(n, np.float32)
    t = TRI[tri_ids]; uv = UV[t[:, 0]] * (1 - bary[:, :1] - bary[:, 1:2]) + UV[t[:, 1]] * bary[:, :1] + UV[t[:, 2]] * bary[:, 1:2]
    tm = TMAT[tri_ids]
    for mi in np.unique(tm):
        M = mats[mi]; s = tm == mi; u = uv[s]
        c = np.broadcast_to(M['bf'][:3], (s.sum(), 3)).astype(np.float32).copy()
        if M['base'] is not None:
            img = M['base']
            if M['mips'] is not None:      # the level whose texel is about the sample spacing (world metres per uv unit from the triangle)
                tt = TRI[tri_ids[s]]; e1, e2 = P[tt[:, 1]] - P[tt[:, 0]], P[tt[:, 2]] - P[tt[:, 0]]
                u1, u2 = UV[tt[:, 1]] - UV[tt[:, 0]], UV[tt[:, 2]] - UV[tt[:, 0]]
                a3 = np.linalg.norm(np.cross(e1, e2), axis=1); a2 = np.abs(u1[:, 0] * u2[:, 1] - u1[:, 1] * u2[:, 0])
                dens = np.sqrt(np.maximum(a2, 1e-12) / np.maximum(a3, 1e-12)) * img.shape[1]      # source texels per metre
                lvl = int(np.clip(np.round(np.log2(max(np.median(dens) * TEXEL / SS, 1))), 0, len(M['mips']) - 1)); img = M['mips'][lvl]
            h, w = img.shape[:2]
            x = np.floor((u[:, 0] % 1) * w).astype(int) % w; y = np.floor((u[:, 1] % 1) * h).astype(int) % h
            c = c * img[y, x, :3]
        r = np.full(s.sum(), M['rf'], np.float32); me = np.full(s.sum(), M['mf'], np.float32)
        if M['mr'] is not None:
            h, w = M['mr'].shape[:2]; x = np.floor((u[:, 0] % 1) * w).astype(int) % w; y = np.floor((u[:, 1] % 1) * h).astype(int) % h
            r = r * M['mr'][y, x, 1]; me = me * M['mr'][y, x, 2]
        if M['fade_to'] is not None:       # a coverage-fade part, as the app shows it at the pixel size where the skin takes over
            k = np.clip((SEE_PX_M - M['fade_m'] * 0.25) / max(M['fade_m'] * 0.35, 1e-6), 0, 1); k = k * k * (3 - 2 * k)
            c = c * (1 - k) + np.array(M['fade_to'], np.float32) * k
        col[s], rough[s], metal[s] = c, r, me
    cl = TCLAY[tri_ids]
    col[cl] = CLAY_MEAN; rough[cl] = CLAY_ROUGH; metal[cl] = 0
    return col, rough, metal

def scene_of(tris):
    sc = o3d.t.geometry.RaycastingScene()
    v, inv = np.unique(tris.reshape(-1), return_inverse=True)
    sc.add_triangles(o3d.core.Tensor(P[v].astype(np.float32)), o3d.core.Tensor(inv.reshape(-1, 3).astype(np.uint32)))
    return sc

def shell_of(tri_ids, sc, tag):
    """voxel wrap of the outside surface -> marching cubes of the offset surface -> pulled back onto the model -> error-bounded collapse"""
    T = P[TRI[tri_ids]]                                    # (m,3,3)
    lo, hi = T.reshape(-1, 3).min(0), T.reshape(-1, 3).max(0)
    lo[1] = min(lo[1], 0.0)
    v = VOX
    ext = hi - lo
    while np.prod(np.ceil(ext / v) + 8) > MAX_VOX: v *= 1.15
    tau = 0.9 * v
    org = lo - 4 * v; org[1] = -2 * v                      # voxel centres at org + i*v; everything under the ground is solid
    dims = (np.ceil((hi - org) / v).astype(int) + 5)
    S = np.zeros(dims, bool)
    e = np.maximum.reduce([np.linalg.norm(T[:, 1] - T[:, 0], axis=1), np.linalg.norm(T[:, 2] - T[:, 1], axis=1), np.linalg.norm(T[:, 0] - T[:, 2], axis=1)])
    nsub = np.maximum(1, np.ceil(e / (v / 3))).astype(int)
    for nq in np.unique(nsub):
        s = nsub == nq
        i, j = np.meshgrid(np.arange(nq + 1), np.arange(nq + 1), indexing='ij'); k = (i + j) <= nq
        u, w = i[k] / nq, j[k] / nq
        for c0 in range(0, int(s.sum()), max(1, 4_000_000 // len(u))):
            Tt = T[s][c0:c0 + max(1, 4_000_000 // len(u))]
            pts = Tt[:, None, 0] + u[None, :, None] * (Tt[:, None, 1] - Tt[:, None, 0]) + w[None, :, None] * (Tt[:, None, 2] - Tt[:, None, 0])
            ijk = np.round((pts.reshape(-1, 3) - org) / v).astype(int)
            ok = np.all((ijk >= 0) & (ijk < dims), 1); ijk = ijk[ok]
            S[ijk[:, 0], ijk[:, 1], ijk[:, 2]] = True
    # OUTSIDE = what a far camera can see into: a coarse grid of points, each looks out in N_DIR directions (level to straight up);
    # a point that sees out in fewer than VIS_MIN of them is closed off (rooms, the inside of a garage past its openings, a hollow shell)
    vc = 4 * v; cd = np.ceil(dims * v / vc).astype(int) + 1
    ci = np.stack(np.meshgrid(*[np.arange(n) for n in cd], indexing='ij'), -1).reshape(-1, 3)
    cpts = (org + ci * vc).astype(np.float32)
    k = np.arange(N_DIR) + 0.5; el = np.arcsin(np.sin(np.radians(2)) + (1 - np.sin(np.radians(2))) * k / N_DIR); az = k * 2.399963
    dirs = np.stack([np.cos(el) * np.cos(az), np.sin(el), np.cos(el) * np.sin(az)], 1).astype(np.float32)
    seen = np.zeros(len(cpts), np.float32)
    for dvec in dirs:
        t = sc.cast_rays(o3d.core.Tensor(np.concatenate([cpts, np.broadcast_to(dvec, cpts.shape)], 1)))['t_hit'].numpy()
        seen += ~np.isfinite(t)
    seen = seen.reshape(cd) / N_DIR
    S[:, :2, :] = True                                     # the ground (y <= 0): closed
    lab, _ = ndimage.label(~S)
    E0 = lab == lab[0, dims[1] - 1, 0]                     # reached from the open air without crossing a surface
    del lab
    # the share of sky a point sees, smooth, from the coarse points that stand in the open air only (a point inside a wall says nothing)
    ni = [np.minimum(np.round(np.arange(n) * vc / v).astype(int), dims[a_] - 1) for a_, n in enumerate(cd)]
    free = E0[np.ix_(*ni)].astype(np.float32)
    vis = ndimage.gaussian_filter(seen * free, 1.0) / np.maximum(ndimage.gaussian_filter(free, 1.0), 1e-3)
    fi = np.stack(np.meshgrid(*[np.arange(n, dtype=np.float32) for n in dims], indexing='ij'), 0) * (v / vc)
    g2 = np.clip((ndimage.map_coordinates(vis, fi, order=1, mode='nearest') - VIS_MIN) / VIS_MIN, -1, 2) * v
    del fi
    band = ndimage.binary_dilation(S, iterations=4) | S
    g = np.where(E0, 2 * v, -v).astype(np.float32)
    bi = np.argwhere(band & E0)
    d = sc.compute_distance(o3d.core.Tensor((org + bi * v).astype(np.float32))).numpy()
    g[bi[:, 0], bi[:, 1], bi[:, 2]] = np.minimum(d - tau, 2 * v)
    g = np.where(E0, np.minimum(g, g2), g).astype(np.float32)
    del g2
    g[:, :2, :] = -v                                       # the ground (y <= 0): closed
    verts, faces, _, _ = measure.marching_cubes(g, level=0.0, spacing=(v, v, v), gradient_direction='descent')
    # outward = toward higher g; check on the field itself
    fn = np.cross(verts[faces[:, 1]] - verts[faces[:, 0]], verts[faces[:, 2]] - verts[faces[:, 0]])
    fc = verts[faces].mean(1); fnn = fn / np.maximum(np.linalg.norm(fn, axis=1, keepdims=True), 1e-12)
    sel = np.random.default_rng(1).choice(len(faces), min(len(faces), 20000), replace=False)
    up = ndimage.map_coordinates(g, ((fc[sel] + fnn[sel] * v) / v).T, order=1, mode='nearest') - ndimage.map_coordinates(g, ((fc[sel] - fnn[sel] * v) / v).T, order=1, mode='nearest')
    outward = float((up > 0).mean())
    if outward < 0.5: faces = faces[:, ::-1]
    verts = verts + org
    del g, S, band, E0
    # pull every vertex that lies on the offset of a real surface back onto that surface (a vertex closing an opening stays)
    cpq = sc.compute_closest_points(o3d.core.Tensor(verts.astype(np.float32)))['points'].numpy().astype(np.float64)
    dq = np.linalg.norm(cpq - verts, axis=1); near = dq <= 1.6 * tau
    cp = np.where(near[:, None], cpq, verts)
    key = np.round(cp / 0.002).astype(np.int64)
    _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    V = cp[first]; F = inv.reshape(-1)[faces]
    F = F[(F[:, 0] != F[:, 1]) & (F[:, 1] != F[:, 2]) & (F[:, 0] != F[:, 2])]
    area = np.linalg.norm(np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]]), axis=1)
    F = F[area > 1e-8]
    F = F[V[F].mean(1)[:, 1] > 0.02]                        # nothing on the ground plane itself (the shell's closed bottom)
    pre = f'/tmp/farskin_{os.getpid()}_{tag}'
    V.astype(np.float32).tofile(pre + '.pos.f32'); F.astype(np.uint32).tofile(pre + '.idx.u32')
    r = json.loads(subprocess.check_output(['node', os.path.join(HERE, 'far_coat_simplify.mjs'), pre, str(ERR)], cwd=HERE).decode().strip().splitlines()[-1])
    F2 = np.fromfile(pre + '.out.u32', np.uint32).reshape(-1, 3).astype(np.int64)
    for x in ('.pos.f32', '.idx.u32', '.out.u32'): os.remove(pre + x)
    used, inv2 = np.unique(F2.reshape(-1), return_inverse=True)
    V2, F2 = V[used], inv2.reshape(-1, 3)
    return V2, F2, dict(voxel=round(v, 3), grid=dims.tolist(), mc=len(faces), wrapped=len(F), shell=len(F2), err=round(r['error'], 3), outward=round(float(outward), 2), membrane=int((~near).sum()))

shells = []
for bid in sorted(set(TBID.tolist())):
    tri_ids = np.nonzero(TBID == bid)[0]
    sc = scene_of(TRI[tri_ids])
    V, F, info = shell_of(tri_ids, sc, bid)
    area = 0.5 * np.linalg.norm(np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]]), axis=1).sum()
    log(f'building {bid}: {len(tri_ids)} triangles -> shell {len(F)} ({100 * len(F) / len(tri_ids):.1f} %), area {area:.0f} m2', info)
    shells.append(dict(bid=bid, V=V, F=F, sc=sc, tri_ids=tri_ids))

# ── one atlas for the tile ───────────────────────────────────────────────
atlas = xatlas.Atlas()
for s in shells: atlas.add_mesh(s['V'].astype(np.float32), s['F'].astype(np.uint32))
co, po = xatlas.ChartOptions(), xatlas.PackOptions()
co.max_cost = float(os.environ.get('CHART_COST', 2.0)); co.normal_deviation_weight = float(os.environ.get('CHART_NDW', 2.0))
po.texels_per_unit = 1.0 / TEXEL; po.padding = 2; po.resolution = 0; po.bilinear = True; po.rotate_charts = True
atlas.generate(co, po)
W, H = atlas.width, atlas.height
log(f'atlas {W} x {H} = {W * H / 1e6:.2f} M texels, {atlas.chart_count} charts, utilization {atlas.utilization}')
acc_col = np.zeros((H, W, 3), np.float64); acc_b = np.zeros((H, W), np.float64); acc_n = np.zeros((H, W), np.float64)   # bright colour, bright weight, all weight
out_meshes = []
for si, s in enumerate(shells):
    vmap, idx, uvs = atlas[si]
    V = s['V'][vmap]; F = idx.astype(np.int64); uvp = uvs.astype(np.float64) * [W, H]
    fn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]]); fl = np.linalg.norm(fn, axis=1); fnn = fn / np.maximum(fl[:, None], 1e-12)
    # samples: every texel a triangle touches (plus a margin), SS x SS points in it
    pts, nrm, tex, fid = [], [], [], []
    sub = (np.arange(SS) + 0.5) / SS
    for f in range(len(F)):
        a, b_, c = uvp[F[f]]
        x0, x1 = int(np.floor(min(a[0], b_[0], c[0]) - 1)), int(np.ceil(max(a[0], b_[0], c[0]) + 1))
        y0, y1 = int(np.floor(min(a[1], b_[1], c[1]) - 1)), int(np.ceil(max(a[1], b_[1], c[1]) + 1))
        x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, W), min(y1, H)
        if x1 <= x0 or y1 <= y0: continue
        den = (b_[1] - c[1]) * (a[0] - c[0]) + (c[0] - b_[0]) * (a[1] - c[1])
        if abs(den) < 1e-9: continue
        gx, gy = np.meshgrid(np.arange(x0, x1), np.arange(y0, y1))
        shp = gx.shape + (SS, SS)
        sx = (np.broadcast_to(gx[..., None, None] + sub[None, None, :, None], shp) + (RNG.random(shp) - 0.5) / SS).reshape(-1)
        sy = (np.broadcast_to(gy[..., None, None] + sub[None, None, None, :], shp) + (RNG.random(shp) - 0.5) / SS).reshape(-1)
        l0 = ((b_[1] - c[1]) * (sx - c[0]) + (c[0] - b_[0]) * (sy - c[1])) / den
        l1 = ((c[1] - a[1]) * (sx - c[0]) + (a[0] - c[0]) * (sy - c[1])) / den
        l2 = 1 - l0 - l1
        # inside, or within about one texel of an edge (the gutter gets real colour, not a smear)
        tol = 1.0 / max(np.sqrt(abs(den)), 1e-6)
        ok = (l0 >= -tol) & (l1 >= -tol) & (l2 >= -tol)
        if not ok.any(): continue
        inside = (l0 >= 0) & (l1 >= 0) & (l2 >= 0)
        l0, l1, l2, sx, sy, inside = l0[ok], l1[ok], l2[ok], sx[ok], sy[ok], inside[ok]
        p = l0[:, None] * V[F[f, 0]] + l1[:, None] * V[F[f, 1]] + l2[:, None] * V[F[f, 2]]
        fid.append(np.full(len(p), f, np.int64)); pts.append(p); nrm.append(np.broadcast_to(fnn[f], p.shape)); tex.append(np.stack([np.floor(sy).astype(np.int64) * W + np.floor(sx).astype(np.int64), inside.astype(np.int64)], 1))
    pts, nrm, tex, fid = np.concatenate(pts), np.concatenate(nrm), np.concatenate(tex), np.concatenate(fid)
    # rays from outside in. The start is D_OUT off the shell, or half way to the next shell surface in front if that is nearer
    # (a wall across a corner or a gap paints itself, not this face); small parts in front are not in the shell, so they are caught.
    ssc = o3d.t.geometry.RaycastingScene(); ssc.add_triangles(o3d.core.Tensor(s['V'].astype(np.float32)), o3d.core.Tensor(s['F'].astype(np.uint32)))
    def look(nrm):
        tf = ssc.cast_rays(o3d.core.Tensor(np.concatenate([(pts + nrm * 0.02).astype(np.float32), nrm.astype(np.float32)], 1)))['t_hit'].numpy()
        dout = np.minimum(D_OUT, 0.5 * (tf + 0.02)).astype(np.float32)
        o = (pts + nrm * dout[:, None]).astype(np.float32); dvec = (-nrm).astype(np.float32)
        tri = np.full(len(pts), -1, np.int64); bary = np.zeros((len(pts), 2), np.float32)
        r = s['sc'].cast_rays(o3d.core.Tensor(np.concatenate([o, dvec], 1)))
        th = r['t_hit'].numpy(); hit = np.isfinite(th) & (th <= dout + D_IN)
        tri[hit] = r['primitive_ids'].numpy().astype(np.int64)[hit]; bary[hit] = r['primitive_uvs'].numpy()[hit]
        hn = r['primitive_normals'].numpy(); hn = np.where(((hn * dvec).sum(1) > 0)[:, None], -hn, hn); hn[~hit] = 0
        miss = tri < 0
        deep = np.zeros(len(pts), bool)
        if miss.any():                                         # through an opening: the first surface further in, darker
            mi = np.nonzero(miss)[0]
            r = s['sc'].cast_rays(o3d.core.Tensor(np.concatenate([(pts[mi] - nrm[mi] * D_IN).astype(np.float32), dvec[mi]], 1)))
            th = r['t_hit'].numpy(); ok = np.isfinite(th) & (th <= DEEP_M)
            tri[mi[ok]] = r['primitive_ids'].numpy().astype(np.int64)[ok]; bary[mi[ok]] = r['primitive_uvs'].numpy()[ok]; deep[mi[ok]] = True
        miss2 = tri < 0
        if miss2.any():                                        # a cap over a void (a light well, a slot between wings): what stands at the far end of the ray, or else
            mi = np.nonzero(miss2)[0]                          # the nearest surface; both in the void's shade (the cap itself is flat and would take the full sun and sky)
            r = s['sc'].cast_rays(o3d.core.Tensor(np.concatenate([(pts[mi] - nrm[mi] * (D_IN + DEEP_M)).astype(np.float32), dvec[mi]], 1)))
            th = r['t_hit'].numpy(); ok = np.isfinite(th) & (th <= VOID_M)
            tri[mi[ok]] = r['primitive_ids'].numpy().astype(np.int64)[ok]; bary[mi[ok]] = r['primitive_uvs'].numpy()[ok]
            rest = mi[~ok]
            if len(rest):
                c = s['sc'].compute_closest_points(o3d.core.Tensor(pts[rest].astype(np.float32)))
                tri[rest] = c['primitive_ids'].numpy().astype(np.int64); bary[rest] = c['primitive_uvs'].numpy()
            deep[mi] = True
        return tri, bary, hit, hn, deep, miss2
    tri, bary, hit, hn, deep, miss2 = look(nrm)
    # each face is lit by the mean normal of what it shows (the real wall or roof under it), not by the shell's own small tilts
    # ...and of those normals the one most of the face shows (a wall with windows: the wall's, the same for every face of that wall)
    inside = (tex[:, 1] == 1) & hit
    qn = np.round(hn[inside] * 8).astype(np.int64); qk = (qn[:, 0] + 8) * 289 + (qn[:, 1] + 8) * 17 + (qn[:, 2] + 8)
    pk = fid[inside] * 4913 + qk
    upk, inv_pk, cnt = np.unique(pk, return_inverse=True, return_counts=True)
    sums = np.stack([np.bincount(inv_pk, hn[inside, k], len(upk)) for k in range(3)], 1)
    uf = upk // 4913; order = np.lexsort((cnt, uf)); lastof = np.r_[uf[order][1:] != uf[order][:-1], True]
    best = order[lastof]                                   # per face: its most frequent normal bin
    bn_ = np.zeros((len(F), 3)); bn_[uf[best]] = sums[best]
    bl = np.linalg.norm(bn_, axis=1); good = (bl > 1e-6) & ((bn_ * fnn).sum(1) > 0.5 * bl)
    fnorm = np.where(good[:, None], bn_ / np.maximum(bl[:, None], 1e-12), fnn)
    # ...and the colours are read ALONG that normal, not along the shell's own. The shell is a skin pulled over fins, frames and
    # balcony fronts, so its triangles tilt (measured on a tower with a frame grid: a wall of dark panes baked as a blank white wall,
    # because the tilted rays met the sides of the frames). Looking square at the wall under the face gets the panes back.
    tilt = np.degrees(np.arccos(np.clip((fnorm[fid] * nrm).sum(1), -1, 1)))
    tri, bary, hit, hn, deep, miss2 = look(fnorm[fid])
    col, rough, metal = tri_colour(s['tri_ids'][tri], bary)
    col[deep] *= DEEP_K    # (metal and roughness stay: every pane in a tile is a mirror metal, and a pane behind a balcony baked as paint is lit grey by the sun and the sky where the real pane mirrors the dark ground)
    f0 = 0.04 * (1 - metal[:, None]) + col * metal[:, None]
    q = np.clip((0.6 - rough) / 0.3, 0, 1); q = q * q * (3 - 2 * q)          # 1 = smooth (mirror glass, polished metal), 0 = rough
    pane = (metal > 0.5) & (q > 0.5)                                         # a mirror pane (every pane in a tile is a smooth metal)
    col = col * (1 - metal[:, None])                                         # the diffuse colour (a mirror pane has none)
    f0q = f0 * q[:, None]                                                    # the mirror strength looking straight at it, x how smooth it is
    ins = tex[:, 1] == 1
    # BRIGHT and DARK (model 3). A far texel holds wall and pane together, and the app's screen clips bright light, so the app must
    # send the two to the screen apart (v2/tiles.js farMaterial). Each sample of a face goes to the face's bright part or to its dark
    # part by its diffuse brightness, at the level that parts the face's samples best (Otsu), and only where the face clearly has two
    # groups. A mirror pane is always of the dark part (a face that is all glass has one group, and it must keep its mirror). The texel
    # keeps the bright part's mean colour and the dark part's SHARE; the dark part's colour and mirror are one value a face.
    lum = (col @ LUMA).astype(np.float64); dark = pane.copy()
    order = np.argsort(fid, kind='stable'); fs = fid[order]; cuts = np.r_[0, np.nonzero(fs[1:] != fs[:-1])[0] + 1, len(fs)]
    for a_, b_ in zip(cuts[:-1], cuts[1:]):
        idx = order[a_:b_]; li = lum[idx]; use = (ins[idx] if ins[idx].any() else np.ones(len(idx), bool)) & ~pane[idx]; lu = li[use]   # (the level is found among what is not a pane)
        if len(lu) < 16: continue
        hi_ = float(lu.max())
        if hi_ < 1e-4: continue
        h_, edges = np.histogram(lu, bins=48, range=(0.0, hi_)); w0 = np.cumsum(h_); m0 = np.cumsum(h_ * 0.5 * (edges[:-1] + edges[1:]))
        wt, mt = w0[-1], m0[-1]; w1 = wt - w0; ok_ = (w0 > 0) & (w1 > 0)
        if not ok_.any(): continue
        mu0 = m0 / np.maximum(w0, 1); mu1 = (mt - m0) / np.maximum(w1, 1); var = np.where(ok_, w0 * w1 * (mu0 - mu1) ** 2, -1.0)
        k_ = int(np.argmax(var)); share = w0[k_] / wt
        if share < DARK_MIN_SHARE or share > 1 - DARK_MIN_SHARE or mu1[k_] < DARK_RATIO * mu0[k_] + DARK_GAP: continue
        dark[idx] = pane[idx] | (li <= edges[k_ + 1])
    # per shell face, over its dark part: how many samples, its mirror colour, roughness and smooth share, its diffuse colour
    dk = ins & dark
    fsum = np.stack([np.bincount(fid[dk], w_[dk], len(F)) for w_ in (np.ones(len(fid)), f0q[:, 0], f0q[:, 1], f0q[:, 2], rough * q, q, col[:, 0], col[:, 1], col[:, 2])], 1)
    # texels a triangle really covers take only inside samples; gutter texels take what they get
    wgt = np.where(ins, 1.0, 1e-3); wb = wgt * ~dark
    for ch_ in range(3): acc_col[..., ch_] += np.bincount(tex[:, 0], col[:, ch_] * wb, W * H).reshape(H, W)
    acc_b += np.bincount(tex[:, 0], wb, W * H).reshape(H, W); acc_n += np.bincount(tex[:, 0], wgt, W * H).reshape(H, W)
    # one vertex per (atlas vertex, normal): faces of one wall share a normal (snapped to about 1.5 degrees), so they share vertices
    sn = np.round(fnorm * 40).astype(np.int64); nid = np.unique(sn, axis=0, return_inverse=True)[1].reshape(-1)
    pair = F.astype(np.int64) * (int(nid.max()) + 1) + nid[:, None]
    uq, first, inv = np.unique(pair.reshape(-1), return_index=True, return_inverse=True)
    vsel = F.reshape(-1)[first]; nsel = np.repeat(sn, 3, 0)[first].astype(np.float64); nsel /= np.maximum(np.linalg.norm(nsel, axis=1, keepdims=True), 1e-12)
    # per vertex (the faces around it), all of the DARK part: _gloss = its mirror strength straight on (rgb) and the mirror's roughness;
    # _gloss2 = its smooth share (the mirror's strength at a low angle), and the square root of its diffuse colour (fine steps near black)
    Fn = inv.reshape(-1, 3); vs = np.zeros((len(uq), 9))
    for k in range(3): np.add.at(vs, Fn[:, k], fsum)
    has = vs[:, 0] > 0.5; nd = np.maximum(vs[:, :1], 1e-9)
    gl = np.column_stack([np.where(has[:, None], np.clip(vs[:, 1:4] / nd, 0, 1), 0.0), np.where(has & (vs[:, 5] > 1e-9), vs[:, 4] / np.maximum(vs[:, 5], 1e-9), 1.0)])
    gl2 = np.column_stack([np.where(has, np.clip(vs[:, 5] / nd[:, 0], 0, 1), 0.0), np.where(has[:, None], np.sqrt(np.clip(vs[:, 6:9] / nd, 0, 1)), 0.0)])
    out_meshes.append(dict(V=V[vsel], N=nsel, UV=uvs.astype(np.float32)[vsel], F=Fn, bid=s['bid'], gloss=gl, gloss2=gl2))
    log(f'building {s["bid"]}: baked {len(pts)} rays, {100 * deep.mean():.1f} % seen through an opening, {100 * miss2.mean():.1f} % over a void, shell tilted over 20 degrees on {100 * (tilt > 20).mean():.1f} % (median {np.median(tilt):.1f})')
have = acc_n > 0; lit = acc_b > 1e-9
col = np.zeros((H, W, 3)); col[lit] = acc_col[lit] / acc_b[lit][:, None]
ds = np.zeros((H, W, 1)); ds[have, 0] = 1 - acc_b[have] / acc_n[have]          # the dark share of each texel
def spread(arr, known, rounds):                            # fill what is not known from the neighbours that are
    known = known.copy(); k = np.ones((3, 3))
    for it in range(rounds):
        if known.all(): break
        cnt = ndimage.convolve(known.astype(float), k, mode='constant'); new = (~known) & (cnt > 0)
        for c_ in range(arr.shape[2]): arr[..., c_][new] = (ndimage.convolve(arr[..., c_] * known, k, mode='constant') / np.maximum(cnt, 1))[new]
        known = known | new
spread(col, lit, 24)                                       # a texel that is all dark (and the gutters) takes its neighbours' bright colour, so filtering never pulls a wall to black
spread(ds, have, 8)
# one picture: rgb = the colour of the texel's bright part, alpha = 1 - its dark share (a plain wall is alpha 1; a share is a plain average, so mip maps keep it exact)
METAL = float(ds[..., 0].mean())
albedo = Image.fromarray((np.dstack([np.clip(lin2srgb(col), 0, 1), 1 - np.clip(ds[..., 0], 0, 1)]) * 255 + 0.5).astype(np.uint8), 'RGBA')
def webp(im, q): bio = io.BytesIO(); im.save(bio, 'WEBP', quality=q, method=6, exact=True); return bio.getvalue()
# ── write the skin glb (plain: positions, normals, uv, one material with the two pictures) ─────────────────
Vall = np.concatenate([m['V'] for m in out_meshes]).astype(np.float32); Nall = np.concatenate([m['N'] for m in out_meshes]).astype(np.float32)
UVall = np.concatenate([m['UV'] for m in out_meshes]).astype(np.float32); Ball = np.concatenate([np.full(len(m['V']), m['bid'], np.uint16) for m in out_meshes])
Gall = np.concatenate([(np.clip(m['gloss'], 0, 1) * 255 + 0.5).astype(np.uint8) for m in out_meshes])
G2all = np.concatenate([(np.clip(m['gloss2'], 0, 1) * 255 + 0.5).astype(np.uint8) for m in out_meshes])
offs = np.cumsum([0] + [len(m['V']) for m in out_meshes]); Fall = np.concatenate([m['F'] + offs[i] for i, m in enumerate(out_meshes)]).astype(np.uint32)
blobs = [Vall.tobytes(), Nall.tobytes(), UVall.tobytes(), Ball.tobytes() + b'\0' * ((4 - Ball.nbytes % 4) % 4), Fall.tobytes(), webp(albedo, int(os.environ.get('WEBP_Q', 80))), Gall.tobytes(), G2all.tobytes()]
views, buf = [], b''
for bl in blobs:
    views.append(dict(buffer=0, byteOffset=len(buf), byteLength=len(bl))); buf += bl + b'\0' * ((4 - len(bl) % 4) % 4)
nv = len(Vall)
g = dict(asset=dict(version='2.0', generator='far_coat.py'), scene=0, scenes=[dict(nodes=[0])], nodes=[dict(mesh=0, name='far')],
    extensionsUsed=['EXT_texture_webp'], extensionsRequired=['EXT_texture_webp'],
    meshes=[dict(name='far', primitives=[dict(attributes=dict(POSITION=0, NORMAL=1, TEXCOORD_0=2, _BUILDING=3, _GLOSS=5, _GLOSS2=6), indices=4, material=0)])],
    materials=[dict(name='far_coat', doubleSided=False, pbrMetallicRoughness=dict(baseColorTexture=dict(index=0), metallicFactor=0, roughnessFactor=1), extras=dict(v2_kind='far', texel_m=TEXEL, err_m=ERR, dark_share=round(METAL, 4), model=MODEL))],
    textures=[dict(sampler=0, extensions=dict(EXT_texture_webp=dict(source=0)))], samplers=[dict(magFilter=9729, minFilter=9987, wrapS=33071, wrapT=33071)],
    images=[dict(bufferView=5, mimeType='image/webp')],
    accessors=[dict(bufferView=0, componentType=5126, count=nv, type='VEC3', min=Vall.min(0).tolist(), max=Vall.max(0).tolist()), dict(bufferView=1, componentType=5126, count=nv, type='VEC3'),
               dict(bufferView=2, componentType=5126, count=nv, type='VEC2'), dict(bufferView=3, componentType=5123, count=nv, type='SCALAR'), dict(bufferView=4, componentType=5125, count=int(Fall.size), type='SCALAR'), dict(bufferView=6, componentType=5121, normalized=True, count=nv, type='VEC4'), dict(bufferView=7, componentType=5121, normalized=True, count=nv, type='VEC4')],
    bufferViews=views, buffers=[dict(byteLength=len(buf))])
jb = json.dumps(g).encode(); jb += b' ' * ((4 - len(jb) % 4) % 4)
with open(OUT, 'wb') as f:
    f.write(struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(jb) + 8 + len(buf))); f.write(struct.pack('<I4s', len(jb), b'JSON')); f.write(jb); f.write(struct.pack('<I4s', len(buf), b'BIN\0')); f.write(buf)
if os.environ.get('KEEP_PNG'): albedo.convert('RGB').save(OUT.replace('.glb', '.albedo.png'))
log(f'DONE {TILE}: {len(Fall)} triangles (full {len(TRI)}), atlas {W}x{H} = {W * H / 1e6:.2f} M texels, dark share {METAL:.3f}, file {os.path.getsize(OUT) / 1e6:.2f} MB')
print('RESULT ' + json.dumps(dict(webp=len(blobs[5]), verts=int(nv), charts=int(atlas.chart_count), tile=TILE, full=int(len(TRI)), far=int(len(Fall)), w=int(W), h=int(H), mb=round(os.path.getsize(OUT) / 1e6, 3), dark=round(METAL, 4), model=MODEL)))
