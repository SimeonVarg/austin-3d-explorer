#!/usr/bin/env python3
"""The FAR COPY of a Blender building: a few hundred triangles that stand for it where its windows are a pixel or two wide, and
while its full file is not loaded (js/gltf-look.js "THE FAR COPY"). Made by rule from the building's own look file, right after
scripts/blender_export_look.py writes it. No hand work, no number per building.

    python3 scripts/gltf_far.py data/gltf/<slug>-look.glb [more look files ...]      ->  data/gltf/<slug>-look-far.json each

WHAT IT KEEPS
  the outline and the roof levels   every face is sampled; the highest sample in each cell of a grid is the building's height there.
                                    The grid is turned to the building's own main wall direction and shifted so that its lines lie
                                    on the main walls. Rails, parapet lines and masts thinner than THIN_M are taken off (they are
                                    not a part of the mass); the cells are then grouped into LEVELS, and a level's connected cells
                                    are a PART (a tower, a set-back, a wing round a court). A part smaller than MIN_PART_M2 joins
                                    the neighbour it shares the longest edge with.
  the colours                       a roof part has the area-weighted mean colour of what is seen from above on it. A wall has the
                                    area-weighted mean of what is seen from in front of it (the front-most face in each half metre,
                                    so a balcony front hides the wall behind it as it does in the picture), in ROWS of BAND_M:
                                    neighbouring rows of nearly one colour are merged into BANDS, so a storey's window strip is one
                                    darker, glassier band and the spandrel under it a paler one. Windows are not drawn one by one.
                                    Each band also carries its wall's mean, which the page shows where a band is thinner than a
                                    pixel or two (a band that thin would flicker).
  glass                             a band's mirror colour is the mean of (glass ? mirror colour : 0) and its glass share is the
                                    share of glass in it, so the far copy mirrors as much sky as its windows do together.
  sky light in recesses             the mean of the look file's sky-light map over the same faces (one number a band).
WHAT IT DROPS   everything under a part (an arcade is filled, in the colour of what is seen in it), every single window, every
                thin part, lettering.
The file: plain numbers (shapes and colours), no image. Frame: the look file's own (x, y in the model's ground plane, z up, metres).
"""
import sys, os, json, struct, math
import numpy as np

# ── PARAMETERS ──────────────────────────────────────────────────────────
CELL_M = 0.5          # the height grid
SAMPLE_M = 0.25       # spacing of the samples laid on every face
MIN_HEIGHT_M = 1.5    # lower than this is ground (steps, kerbs, planters)
THIN_M = 2.5          # what sticks up and is narrower than this is not a part (rails, parapet lines, masts, balcony slabs)
LEVEL_STEP_M = 2.5    # heights within this of a level's lowest height are one level
MIN_PART_M2 = 30.0    # a part smaller than this joins a neighbour (or goes, when it stands alone)
TOP_PERCENTILE = 80   # a part's height: this percentile of its cells' true heights (so a parapet's top counts)...
TOP_OVER_M = 1.6      # ...but no more than this above its roof slab
STEP_MIN_M = 0.3      # a wall between two parts is drawn when their heights differ by more than this
WALL_BEHIND_M = 3.0   # a wall's colour comes from faces up to this far behind its plane...
WALL_FRONT_M = 2.0    # ...and this far in front of it
FACING = 0.5          # ...whose normal is within 60 degrees of the wall's
BAND_M = 0.5          # a row of a wall
BAND_WALL_MIN_M = (3.0, 5.0)   # a wall narrower or lower than this is one colour
BAND_TOL = 0.10       # rows merge while their brightness is within this share of each other...
BAND_GLASS_TOL = 0.15 # ...and their glass share within this
MAX_TRIANGLES = 900   # over this the bands are merged more coarsely (the tolerance doubles, three times at most), then the grid is made twice as coarse, once
MIN_SEEN = 0.15       # a wall with less than this share of faces seen in front of it takes its part's roof colour (a step in a sloping roof)

CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}
NORM = {5120: 127.0, 5121: 255.0, 5122: 32767.0, 5123: 65535.0}


def read_glb(path):
    buf = open(path if os.path.exists(path) else path + '.gz', 'rb').read()      # a look file is kept packed in the repo (<name>.glb.gz)
    if buf[:2] == b'\x1f\x8b':
        import gzip; buf = gzip.decompress(buf)
    magic, ver, _ = struct.unpack_from('<III', buf, 0)
    assert magic == 0x46546C67 and ver == 2, 'not a glTF 2.0 binary'
    jl, _ = struct.unpack_from('<II', buf, 12); js = json.loads(buf[20:20 + jl]); bo = 20 + jl
    bl, _ = struct.unpack_from('<II', buf, bo)
    return js, buf[bo + 8: bo + 8 + bl]


def accessor(js, bin_, i):
    """any accessor as float64 (count, n); whole numbers marked `normalized` become 0..1 or -1..1"""
    a = js['accessors'][i]; bv = js['bufferViews'][a['bufferView']]; dt = np.dtype(CT[a['componentType']]); n = NC[a['type']]
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0); size = dt.itemsize * n; stride = bv.get('byteStride') or size
    if stride == size: arr = np.frombuffer(bin_, dt, a['count'] * n, off).reshape(a['count'], n)
    else:
        raw = np.frombuffer(bin_, np.uint8, (a['count'] - 1) * stride + size, off)
        raw = np.concatenate([raw, np.zeros(stride - size, np.uint8)]).reshape(a['count'], stride)[:, :size]
        arr = np.ascontiguousarray(raw).view(dt).reshape(a['count'], n)
    arr = arr.astype(np.float64)
    if a.get('normalized'): arr = np.maximum(arr / NORM[a['componentType']], -1.0)
    return arr


def read_look(path):
    """the look file's primitives: positions and normals in the MODEL frame (x, y ground, z up), per material its colours"""
    js, bin_ = read_glb(path); out = []
    for node in js.get('nodes', []):
        if node.get('mesh') is None: continue
        for p in js['meshes'][node['mesh']]['primitives']:
            m = js['materials'][p['material']]; ex = m.get('extras', {}); at = p['attributes']
            pos = accessor(js, bin_, at['POSITION']); nrm = accessor(js, bin_, at['NORMAL'])
            q = (p.get('extras') or {}).get('look_q')                # a lean file: positions are whole numbers, times a step plus a start
            if q: pos = pos * np.array(q[3:6]) + np.array(q[0:3])
            uvk = 'TEXCOORD_1' if 'TEXCOORD_1' in at else 'TEXCOORD_0'
            uv = accessor(js, bin_, at[uvk]) if uvk in at else None
            idx = accessor(js, bin_, p['indices']).astype(np.int64).reshape(-1, 3)
            base = np.array((m.get('pbrMetallicRoughness', {}).get('baseColorFactor') or [1, 1, 1, 1])[:3], float)
            paint = accessor(js, bin_, at['COLOR_0'])[:, :3] if ('COLOR_0' in at and ex.get('look_painted')) else None
            glass = ex.get('look_kind') == 'glass'
            out.append(dict(name=m.get('name', ''), pos=np.stack([pos[:, 0], -pos[:, 2], pos[:, 1]], 1), nrm=np.stack([nrm[:, 0], -nrm[:, 2], nrm[:, 1]], 1), uv=uv, idx=idx, base=base, paint=paint,
                            glass=glass, mirror=np.array(ex.get('look_glossy') or [0, 0, 0], float) if glass else np.zeros(3)))
    return out


def minmax_filter(a, k, fn):
    """a k x k square minimum or maximum filter (separable), edges padded with the ground (0)"""
    r = k // 2; w = np.lib.stride_tricks.sliding_window_view
    a = fn(w(np.pad(a, ((r, r), (0, 0))), k, axis=0), axis=-1)
    return fn(w(np.pad(a, ((0, 0), (r, r))), k, axis=1), axis=-1)


def label_parts(level):
    """connected cells of one level (4 neighbours) get one number each, from 1; 0 stays ground"""
    nu, nv = level.shape; lab = np.zeros((nu, nv), np.int32); n = 0
    for i0, j0 in zip(*np.nonzero(level)):
        if lab[i0, j0]: continue
        n += 1; lv = level[i0, j0]; lab[i0, j0] = n; stack = [(i0, j0)]
        while stack:
            i, j = stack.pop()
            for a, b in ((i + 1, j), (i - 1, j), (i, j + 1), (i, j - 1)):
                if 0 <= a < nu and 0 <= b < nv and not lab[a, b] and level[a, b] == lv: lab[a, b] = n; stack.append((a, b))
    return lab, n


def far_copy(path, tol_scale=1.0, cell=CELL_M):
    prims = read_look(path)
    sky = None
    try:
        from PIL import Image
        sp = path[:-4] + '-sky.png'
        if os.path.exists(sp): sky = np.asarray(Image.open(sp).convert('L'), np.float64) / 255.0
    except Exception: sky = None
    # every triangle: corners, colour, mirror colour (0 for a wall), glass or not, the sky-light map's place of each corner
    T, TB, TM, TG, TUV = [], [], [], [], []
    for p in prims:
        if not len(p['idx']): continue
        tri = p['pos'][p['idx']]; T.append(tri); n = len(tri)
        TB.append(p['base'][None, :] * (p['paint'][p['idx']].mean(1) if p['paint'] is not None else np.ones((n, 3))))
        TM.append(np.tile(p['mirror'], (n, 1))); TG.append(np.full(n, 1.0 if p['glass'] else 0.0))
        TUV.append(p['uv'][p['idx']] if p['uv'] is not None else np.zeros((n, 3, 2)))
    T = np.concatenate(T); TB = np.concatenate(TB); TM = np.concatenate(TM); TG = np.concatenate(TG); TUV = np.concatenate(TUV)
    cr = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]); area = 0.5 * np.linalg.norm(cr, axis=1); ok = area > 1e-8
    T, TB, TM, TG, TUV, cr, area = T[ok], TB[ok], TM[ok], TG[ok], TUV[ok], cr[ok], area[ok]
    N = cr / (2 * area[:, None])
    # the building's own main wall direction (walls only; the angle is taken four times round, so that all four sides agree)
    wall = np.abs(N[:, 2]) < 0.3; ph = np.arctan2(N[wall, 1], N[wall, 0])
    th = math.atan2(float((area[wall] * np.sin(4 * ph)).sum()), float((area[wall] * np.cos(4 * ph)).sum())) / 4 if wall.any() else 0.0
    c, s = math.cos(th), math.sin(th)
    turn = lambda a: np.stack([a[..., 0] * c + a[..., 1] * s, -a[..., 0] * s + a[..., 1] * c, a[..., 2]], -1)
    T = turn(T); N = turn(N)
    # samples on every face, evenly: a face of area A gets about A / SAMPLE_M^2 of them, each standing for an equal share of it
    ns = np.maximum(1, np.ceil(area / SAMPLE_M ** 2)).astype(np.int64); ti = np.repeat(np.arange(len(T)), ns)
    k = np.arange(len(ti)) - np.repeat(np.cumsum(ns) - ns, ns)
    r1 = (0.5 + k * 0.7548776662466927) % 1.0; r2 = (0.5 + k * 0.5698402909980532) % 1.0; sq = np.sqrt(r1)
    b0, b1, b2 = 1 - sq, sq * (1 - r2), sq * r2
    P = T[ti, 0] * b0[:, None] + T[ti, 1] * b1[:, None] + T[ti, 2] * b2[:, None]; W = (area / ns)[ti]
    UV = TUV[ti, 0] * b0[:, None] + TUV[ti, 1] * b1[:, None] + TUV[ti, 2] * b2[:, None]
    if sky is not None:
        H_, W_ = sky.shape; OPEN = sky[np.clip((UV[:, 1] * H_).astype(int), 0, H_ - 1), np.clip((UV[:, 0] * W_).astype(int), 0, W_ - 1)]
    else: OPEN = np.ones(len(ti))
    SN = N[ti]
    # the grid: its lines on the main walls (the commonest wall position, counted round one cell), two cells of margin
    g = cell; org = []
    for ax in (0, 1):
        m = wall & (np.abs(N[:, ax]) > 0.9); cen = T[m, :, ax].mean(1)
        phase = (math.atan2(float((area[m] * np.sin(2 * math.pi * cen / g)).sum()), float((area[m] * np.cos(2 * math.pi * cen / g)).sum())) / (2 * math.pi) * g) if m.any() else 0.0
        lo = P[:, ax].min() - 2 * g; org.append(phase + g * math.floor((lo - phase) / g))
    iu = np.floor((P[:, 0] - org[0]) / g).astype(np.int64); iv = np.floor((P[:, 1] - org[1]) / g).astype(np.int64)
    nu, nv = int(iu.max()) + 3, int(iv.max()) + 3
    H = np.zeros((nu, nv)); np.maximum.at(H, (iu, iv), P[:, 2])
    # the highest sample of each cell: what is seen from above there
    cid = iu * nv + iv; order = np.lexsort((P[:, 2], cid)); last = np.r_[cid[order][1:] != cid[order][:-1], True]; top = order[last]
    topi = np.full(nu * nv, -1, np.int64); topi[cid[top]] = top; topi = topi.reshape(nu, nv)
    # thin things off (an opening: the highest level at which a THIN_M square still fits under the height surface)
    kk = int(round(THIN_M / g)) | 1
    Hop = minmax_filter(minmax_filter(H, kk, np.min), kk, np.max)
    M = Hop > MIN_HEIGHT_M
    if not M.any(): raise RuntimeError('nothing stands higher than %.1f m' % MIN_HEIGHT_M)
    # levels: sorted heights, a new level where a height is more than LEVEL_STEP_M above the level's lowest
    hs = np.unique(np.round(Hop[M] * 4) / 4); lev_of = {}; start = None; li = 0
    for h in hs:
        if start is None or h - start > LEVEL_STEP_M: li += 1; start = h
        lev_of[h] = li
    level = np.zeros((nu, nv), np.int32); level[M] = [lev_of[h] for h in np.round(Hop[M] * 4) / 4]
    lab, n = label_parts(level)
    # small parts join the neighbour with the longest shared edge; alone, they go
    for _ in range(12):
        cnt = np.bincount(lab.ravel(), minlength=n + 1) * g * g; small = [r for r in range(1, n + 1) if 0 < cnt[r] < MIN_PART_M2]
        if not small: break
        pairs = {}
        for A, B in ((lab[1:, :], lab[:-1, :]), (lab[:, 1:], lab[:, :-1])):
            d = (A != B) & (A > 0) & (B > 0)
            for a, b in zip(A[d].tolist(), B[d].tolist()): pairs[(a, b)] = pairs.get((a, b), 0) + 1; pairs[(b, a)] = pairs.get((b, a), 0) + 1
        small.sort(key=lambda r: cnt[r]); done = set()
        for r in small:
            if r in done: continue
            nb = [(v, b) for (a, b), v in pairs.items() if a == r and b not in done]
            lab[lab == r] = max(nb)[1] if nb else 0
            if nb: done.add(max(nb)[1])
            done.add(r)
    ids = [r for r in np.unique(lab) if r > 0]
    if not ids: raise RuntimeError('no part is left')
    # a part's height, and its roof colour (what is seen from above on its cells)
    height = {0: 0.0}; roofc = {}; colours = []; cidx = {}

    def colour(base, mirror, glass, open_):
        key = tuple(int(round(max(0.0, min(1.0, v)) * 10000)) for v in list(base) + list(mirror)) + (int(round(glass * 1000)), int(round(open_ * 1000)))
        if key not in cidx: cidx[key] = len(colours); colours.append(key)
        return cidx[key]

    def mean_of(sel, w):
        ws = w.sum(); tb = TB[ti[sel]]; tg = TG[ti[sel]]; lum = tb @ np.array([0.2126, 0.7152, 0.0722])
        base = (tb * w[:, None]).sum(0) / ws; mirror = (TM[ti[sel]] * (tg * w)[:, None]).sum(0) / ws; glass = float((tg * w).sum() / ws)
        # the sky light a recess gets, as ONE number that gives the same brightness as the faces' own numbers do: weighted by brightness
        open_ = float((OPEN[sel] * lum * w).sum() / max(1e-9, (lum * w).sum()))
        return base, mirror, glass, open_

    for r in ids:
        m = lab == r; hop = float(np.median(Hop[m])); height[r] = round(min(float(np.percentile(H[m], TOP_PERCENTILE)), hop + TOP_OVER_M), 2)
        sel = topi[m]; sel = sel[sel >= 0]
        roofc[r] = mean_of(sel, np.ones(len(sel))) if len(sel) else (np.array([0.1, 0.1, 0.1]), np.zeros(3), 0.0, 1.0)
    hgt = np.zeros(max(ids) + 1);
    for r in ids: hgt[r] = height[r]
    # roofs: each part cut into rectangles (greedy: as wide as it goes, then as long as it goes)
    roofs = []; used = np.zeros((nu, nv), bool)
    for i in range(nu):
        for j in range(nv):
            r = lab[i, j]
            if not r or used[i, j]: continue
            j1 = j
            while j1 + 1 < nv and lab[i, j1 + 1] == r and not used[i, j1 + 1]: j1 += 1
            i1 = i
            while i1 + 1 < nu and (lab[i1 + 1, j:j1 + 1] == r).all() and not used[i1 + 1, j:j1 + 1].any(): i1 += 1
            used[i:i1 + 1, j:j1 + 1] = True
            roofs.append((org[0] + i * g, org[0] + (i1 + 1) * g, org[1] + j * g, org[1] + (j1 + 1) * g, height[r], colour(*roofc[r])))
    # walls: where a part stands higher than its neighbour cell; runs along the grid line with the same two parts
    L = np.pad(lab, 1); runs = []            # (dir, plane, along0, along1, z0, z1, part)
    for d, (di, dj) in enumerate(((1, 0), (-1, 0), (0, 1), (0, -1))):
        hi = L[1:-1, 1:-1]; lo = L[1 + di: L.shape[0] - 1 + di, 1 + dj: L.shape[1] - 1 + dj]
        face = (hi > 0) & (hgt[hi] > hgt[lo] + STEP_MIN_M)
        if d < 2:
            for i in range(nu):
                js = np.nonzero(face[i])[0]
                if not len(js): continue
                keyv = hi[i, js] * 100000 + lo[i, js]; brk = np.nonzero((np.diff(js) != 1) | (np.diff(keyv) != 0))[0] + 1
                for seg in np.split(np.arange(len(js)), brk):
                    j0, j1 = js[seg[0]], js[seg[-1]]
                    runs.append((d, org[0] + (i + (1 if d == 0 else 0)) * g, org[1] + j0 * g, org[1] + (j1 + 1) * g, hgt[lo[i, j0]], hgt[hi[i, j0]], int(hi[i, j0])))
        else:
            for j in range(nv):
                is_ = np.nonzero(face[:, j])[0]
                if not len(is_): continue
                keyv = hi[is_, j] * 100000 + lo[is_, j]; brk = np.nonzero((np.diff(is_) != 1) | (np.diff(keyv) != 0))[0] + 1
                for seg in np.split(np.arange(len(is_)), brk):
                    i0, i1 = is_[seg[0]], is_[seg[-1]]
                    runs.append((d, org[1] + (j + (1 if d == 2 else 0)) * g, org[0] + i0 * g, org[0] + (i1 + 1) * g, hgt[lo[i0, j]], hgt[hi[i0, j]], int(hi[i0, j])))
    # what is seen from in front of each wall: the samples that face its way, sorted along the wall's normal once for each direction
    DIRS = (np.array([1.0, 0, 0]), np.array([-1.0, 0, 0]), np.array([0, 1.0, 0]), np.array([0, -1.0, 0])); facing = []
    for d in range(4):
        sel = np.nonzero(SN @ DIRS[d] > FACING)[0]; depth = P[sel, d // 2] * (1 if d % 2 == 0 else -1); o = np.argsort(depth); facing.append((sel[o], depth[o]))
    walls = []                                 # (dir, plane, a0, a1, z0, z1, band colour, wall colour, nx, ny)
    tol = BAND_TOL * tol_scale; gtol = BAND_GLASS_TOL * tol_scale
    for d, plane, a0, a1, z0, z1, part in runs:
        sel, depth = facing[d]; pd = plane * (1 if d % 2 == 0 else -1)
        lo_, hi_ = np.searchsorted(depth, pd - WALL_BEHIND_M), np.searchsorted(depth, pd + WALL_FRONT_M)
        s_ = sel[lo_:hi_]; dp = depth[lo_:hi_]; al = P[s_, 1 - d // 2]; zz = P[s_, 2]
        m = (al >= a0) & (al <= a1) & (zz >= z0) & (zz <= z1); s_, dp, al, zz = s_[m], dp[m], al[m], zz[m]
        nx = (1.0, -1.0, 0.0, 0.0)[d]; ny = (0.0, 0.0, 1.0, -1.0)[d]
        if len(s_):
            # the front-most sample of every half metre square of the wall
            b = np.floor((al - a0) / BAND_M).astype(np.int64) * 100000 + np.floor((zz - z0) / BAND_M).astype(np.int64)
            o = np.lexsort((-dp, b)); first = np.r_[True, b[o][1:] != b[o][:-1]]; s_ = s_[o][first]; zz = zz[o][first]
        seen = len(s_) * BAND_M * BAND_M / max(1e-6, (a1 - a0) * (z1 - z0))
        if seen < MIN_SEEN:
            ci = colour(*roofc[part]); walls.append((d, plane, a0, a1, z0, z1, ci, ci, nx, ny)); continue
        w = np.ones(len(s_)); whole = mean_of(s_, w); wi = colour(*whole)
        mn = (SN[s_] * 1.0).sum(0); hn = math.hypot(mn[0], mn[1])
        if hn > 1e-6: nx, ny = mn[0] / hn, mn[1] / hn           # the wall's true direction (a slanted or curved wall is drawn as small steps)
        if (a1 - a0) < BAND_WALL_MIN_M[0] or (z1 - z0) < BAND_WALL_MIN_M[1] or tol_scale > 4:
            walls.append((d, plane, a0, a1, z0, z1, wi, wi, nx, ny)); continue
        rows = np.floor((zz - z0) / BAND_M).astype(np.int64); nr = int(math.ceil((z1 - z0) / BAND_M - 1e-6)); lumw = np.array([0.2126, 0.7152, 0.0722])
        bands = []                             # [row0, row1 (exclusive), sample indices]
        for r in range(nr):
            rs = s_[rows == r]
            if not len(rs):
                if bands: bands[-1][1] = r + 1
                else: bands.append([0, r + 1, rs])
                continue
            mb = mean_of(rs, np.ones(len(rs)))
            if bands and len(bands[-1][2]):
                pb = mean_of(bands[-1][2], np.ones(len(bands[-1][2]))); l0 = float(pb[0] @ lumw + 0.3 * (pb[1] @ lumw)); l1 = float(mb[0] @ lumw + 0.3 * (mb[1] @ lumw))
                if abs(l1 - l0) <= tol * max(l0, l1, 0.01) and abs(mb[2] - pb[2]) <= gtol: bands[-1][1] = r + 1; bands[-1][2] = np.concatenate([bands[-1][2], rs]); continue
            elif bands: bands[-1][1] = r + 1; bands[-1][2] = rs; continue
            bands.append([r, r + 1, rs])
        for r0, r1, rs in bands:
            ci = colour(*mean_of(rs, np.ones(len(rs)))) if len(rs) else wi
            walls.append((d, plane, a0, a1, z0 + r0 * BAND_M, min(z1, z0 + r1 * BAND_M), ci, wi, nx, ny))
    tris = 2 * (len(roofs) + len(walls))
    if tris > MAX_TRIANGLES and tol_scale <= 4: return far_copy(path, tol_scale * 2, cell)
    if tris > MAX_TRIANGLES and cell < 2 * CELL_M: return far_copy(path, 1.0, cell * 2)        # a building with slanted or curved walls: a coarser grid, and the bands again
    cm = lambda v: int(round(v * 100))
    out = {'v': 1, 'from': os.path.basename(path), 'turnDeg': round(math.degrees(th), 4), 'triangles': tris, 'parts': len(ids), 'top': max(height.values()),
           'note': 'roofs: u0 u1 v0 v1 z colour (cm). walls: dir(0 +u, 1 -u, 2 +v, 3 -v) plane a0 a1 z0 z1 (cm) band-colour wall-colour nx ny (x1000). colours: base rgb, mirror rgb (x10000), glass share, sky light (x1000). u, v = x, y turned by -turnDeg.',
           'roofs': [x for r in roofs for x in (cm(r[0]), cm(r[1]), cm(r[2]), cm(r[3]), cm(r[4]), r[5])],
           'walls': [x for w_ in walls for x in (w_[0], cm(w_[1]), cm(w_[2]), cm(w_[3]), cm(w_[4]), cm(w_[5]), w_[6], w_[7], int(round(w_[8] * 1000)), int(round(w_[9] * 1000)))],
           'colours': [x for c_ in colours for x in c_]}
    return out, dict(triangles=tris, roofs=len(roofs), walls=len(walls), parts=len(ids), colours=len(colours), top=max(height.values()), turn=round(math.degrees(th), 2), source_triangles=int(len(T)), samples=int(len(ti)), tol=tol_scale, cell=cell, sky=sky is not None)


if __name__ == '__main__':
    for path in sys.argv[1:]:
        if path.endswith('.gz'): path = path[:-3]
        out, info = far_copy(path); dst = path[:-4] + '-far.json'
        with open(dst, 'w') as f: json.dump(out, f, separators=(',', ':'))
        print('FAR', os.path.basename(dst), os.path.getsize(dst), 'bytes', json.dumps(info))
