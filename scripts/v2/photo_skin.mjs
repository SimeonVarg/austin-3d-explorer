// photo_skin.mjs: a building's surface taken from photographs.
//
// The builds so far carried one plain colour (or one small tiled texture) per material, so every wall was repainted by hand and the
// photograph's own detail was thrown away. A SKIN keeps it: every surface a photograph sees gets the photograph's pixels, laid flat
// (orthographic charts, one per wall plane) in one atlas image, with the photo's exposure divided out so the app's light can light it.
//
//   bake   (private, on the owner's machine: needs the photographs and their solved cameras; neither goes in the repo)
//          node scripts/v2/photo_skin.mjs bake <slug> <building.near.glb> <bake.json> [outDir]
//          writes v2/skins/<slug>/skin.json + albedo.jpg
//          (the atlas holds building surfaces only; skin.json holds chart rectangles and one colour factor: no camera, no place, no photo name)
//   apply  (tile build, public: reads only the files above) applyPhotoSkin(doc, slug, lod, repo): triangles whose chart rectangle
//          is in the atlas move to one textured material; the rest keep the material they had.
//
// Charts are a function of vertex positions alone (dominant axis in the building's own frame, a depth slab along it, a rectangle in
// that slab), so bake and apply agree by construction and a re-export of the same building needs no new bake. A triangle that no
// rectangle contains (new or moved geometry) simply keeps its material.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SKIN = {
  SLAB_M: 0.25,        // depth of one chart slab along its axis
  COARSE_M: 0.10,      // cell of the grid that groups a slab's triangles into rectangles
  SHARP: 0.5, TEXEL_MIN_M: 0.004, TEXEL_MAX_M: 0.03,      // each rectangle's texel: SHARP of its best photograph's own pixel size on that wall (a wall seen from near is kept finer than one seen from far); all grow together until the atlas fits
  MAX_SIDE: 4096,      // atlas width; height may be less
  PAD: 8,              // texels of padding round each rectangle (filled by edge extension)
  MIN_SEEN_M2: Infinity,      // (a bake may set min_seen_m2: keep a long wall of which a photograph saw this many square metres. Off by default: tried on a 60 m brick wall on 2026-11-10, the atlas cannot hold brick courses at that size and the wall read softer than its tiled texture)
  MIN_SEEN: 0.30,      // a rectangle goes in the atlas when this share of its surface was seen by a photograph, or by one of its twins
  ZS: 3,               // the occlusion depth buffer is the photograph's size / ZS
  GUARD: 3,            // depth-buffer pixels round a sample that must hold no nearer surface and no empty sky
  TAKE_OVER: 2.5,      // a later photograph takes a texel from an earlier one only when it sees it this much better (the list is in order of trust)
  MIN_COS: 0.35,       // a surface seen flatter than this is not taken from that photograph (it would smear)
  MIN_TEXELS: 4,       // a rectangle thinner than this keeps its plain material (rails, wires, glyph strokes)
  HOST_M: 1.0, RELIEF_THIN_M: 0.30, RELIEF_M: 0.08,      // a wall rectangle at least HOST_M both ways takes in the faces of its own material that are thinner than RELIEF_THIN_M and lie within RELIEF_M of it
  AO_KEEP: 0.3,        // how much of the tile's baked ambient shade a skinned surface keeps (a photograph under cloud already holds that shade)
  WITNESS: 0.30,       // a photograph gives a rectangle nothing when the mask (trees, cars, people) hides more than 1 - this of what it should see of it
  HUE_MAX: 1.1,        // the colour factor's tint against its own brightness, per channel
  OWN_M: 0.25,         // what the build draws itself (signs, lamps, rails: the left-out materials) is masked in each photograph with this margin: the photograph's own copy of it is not painted a second time on the wall behind
  LEAK_DARK: 0.62, LEAK_MIN: 200,      // a seen texel darker than this share of its material's median in the rectangle, joined to unseen surface, is a leak
  LINK_TEXELS: 3000,                    // two photographs' exposures are linked through a material both saw at least this much of
  MATCH_TEXELS: 150, MATCH_MAX: 2.2,    // in one rectangle a second photograph (or a twin's fill) takes the first one's tone, through a material both hold this much of
  TONE_TEXELS: 300, TONE_MAX: 2.0, TONE_FAR: 1.25,      // the fill of a material takes the seen tone of that material in the rectangle (seen at least this much; at most this ratio; TONE_FAR when only other materials were seen there)
  ROUGHNESS: 0.9,
  ANISO: 8, BIAS: -0.25,   // (measured 2026-11-10: at 0 the wall reads softer than the supersampled truth at 120 m; at -0.25 it does not, and the shimmer meter reads the same)
  TILE_SIDE: 2048,     // the atlas inside a tile is no wider than this; the full one is a file of its own
  JPEG_Q: 86,
};
const K = SKIN;

// ── geometry ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// every triangle of a document, in the building's own metres (glTF: y up)
function triangles(doc, { skip } = {}) {
  const P = [], N = [], src = [];
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    if (prim.getMode() !== 4) continue;
    const mt = prim.getMaterial(); if (skip && skip(mt, prim)) continue;
    const pos = prim.getAttribute('POSITION'); if (!pos) continue;
    const pa = pos.getArray(), ps = pos.getElementSize(), nrm = prim.getAttribute('NORMAL'), na = nrm ? nrm.getArray() : null;
    const scale = pos.getNormalized() ? 1 / 65535 : 1; if (scale !== 1) throw new Error('quantized positions: bake from the plain export');
    const idx = prim.getIndices() ? prim.getIndices().getArray() : null, n = idx ? idx.length : pos.getCount();
    for (let i = 0; i + 2 < n; i += 3) {
      const t = [idx ? idx[i] : i, idx ? idx[i + 1] : i + 1, idx ? idx[i + 2] : i + 2];
      for (const v of t) { P.push(pa[v * ps], pa[v * ps + 1], pa[v * ps + 2]); if (na) N.push(na[v * 3], na[v * 3 + 1], na[v * 3 + 2]); else N.push(0, 0, 0); }
      src.push({ prim, mesh, mt, i });
    }
  }
  return { P: new Float32Array(P), N: new Float32Array(N), src, n: src.length };
}
// the building's own horizontal frame: the angle its walls agree on (walls 90 degrees apart vote together)
function frameAngle(T) {
  let sx = 0, sy = 0;
  for (let t = 0; t < T.n; t++) {
    const p = T.P, o = t * 9, ax = p[o + 3] - p[o], ay = p[o + 4] - p[o + 1], az = p[o + 5] - p[o + 2], bx = p[o + 6] - p[o], by = p[o + 7] - p[o + 1], bz = p[o + 8] - p[o + 2];
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx, a2 = Math.hypot(nx, ny, nz); if (a2 < 1e-9) continue;
    if (Math.abs(ny) > 0.3 * a2) continue;
    const ph = Math.atan2(nz, nx); sx += a2 * Math.cos(4 * ph); sy += a2 * Math.sin(4 * ph);
  }
  return Math.atan2(sy, sx) / 4;
}
function frame(theta) { const c = Math.cos(theta), s = Math.sin(theta); return { c, s }; }
// chart of one triangle: axis (0, 1 = the two wall directions, 2 = up), slab along it, and the chart-plane coordinates of a point
function chartOf(F, p, o) {
  const ax = p[o + 3] - p[o], ay = p[o + 4] - p[o + 1], az = p[o + 5] - p[o + 2], bx = p[o + 6] - p[o], by = p[o + 7] - p[o + 1], bz = p[o + 8] - p[o + 2];
  const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx, a2 = Math.hypot(nx, ny, nz); if (a2 < 1e-10) return null;
  const n0 = Math.abs(nx * F.c + nz * F.s), n1 = Math.abs(-nx * F.s + nz * F.c), n2 = Math.abs(ny);
  const a = n2 >= n0 && n2 >= n1 ? 2 : n0 >= n1 ? 0 : 1;
  const cx = (p[o] + p[o + 3] + p[o + 6]) / 3, cy = (p[o + 1] + p[o + 4] + p[o + 7]) / 3, cz = (p[o + 2] + p[o + 5] + p[o + 8]) / 3;
  const d = a === 0 ? cx * F.c + cz * F.s : a === 1 ? -cx * F.s + cz * F.c : cy;
  return { a, s: Math.floor(d / K.SLAB_M), nx: nx / a2, ny: ny / a2, nz: nz / a2 };
}
function uvOf(F, a, x, y, z) { return a === 0 ? [-x * F.s + z * F.c, y] : a === 1 ? [x * F.c + z * F.s, y] : [x * F.c + z * F.s, -x * F.s + z * F.c]; }

// ── charts ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// (axis, slab) -> rectangles of triangles whose coarse boxes touch. Bake and apply both call this on the same triangles, so a rectangle
// is the same set of triangles in both, and apply finds its place in the atlas by the rectangle's exact box.
function chartRects(T, F, left) {
  const ch = new Array(T.n), groups = new Map(), G = K.COARSE_M;
  for (let t = 0; t < T.n; t++) {
    const o = t * 9, c = left(T.src[t].mt) ? null : chartOf(F, T.P, o); ch[t] = c; if (!c) continue;      // (left-out materials still hide what is behind them: the depth buffers hold every triangle)
    c.uv = [0, 1, 2].map((k) => uvOf(F, c.a, T.P[o + k * 3], T.P[o + k * 3 + 1], T.P[o + k * 3 + 2]));
    const us = c.uv.map((p) => p[0]), vs = c.uv.map((p) => p[1]);
    c.cell = [Math.floor(Math.min(...us) / G) - 1, Math.floor(Math.min(...vs) / G) - 1, Math.floor(Math.max(...us) / G) + 1, Math.floor(Math.max(...vs) / G) + 1];
    const k = c.a + ':' + c.s; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t);
  }
  const rects = [];
  for (const [key, ts] of groups) {
    const [a, s] = key.split(':').map(Number);
    const par = ts.map((_, i) => i), find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
    const order = ts.map((t, i) => i).sort((p, q) => ch[ts[p]].cell[0] - ch[ts[q]].cell[0]);
    for (let p = 0; p < order.length; p++) { const A = ch[ts[order[p]]].cell; for (let q = p + 1; q < order.length; q++) { const B = ch[ts[order[q]]].cell; if (B[0] > A[2]) break; if (B[1] <= A[3] && B[3] >= A[1]) par[find(order[p])] = find(order[q]); } }
    const comp = new Map();
    ts.forEach((t, i) => { const r = find(i), c = ch[t].cell, uv = ch[t].uv; if (!comp.has(r)) comp.set(r, { i0: c[0], j0: c[1], i1: c[2], j1: c[3], tu0: 1e9, tv0: 1e9, tu1: -1e9, tv1: -1e9, tris: [], mats: new Map() }); const R = comp.get(r);
      R.i0 = Math.min(R.i0, c[0]); R.j0 = Math.min(R.j0, c[1]); R.i1 = Math.max(R.i1, c[2]); R.j1 = Math.max(R.j1, c[3]); R.tris.push(t);
      for (const p of uv) { R.tu0 = Math.min(R.tu0, p[0]); R.tv0 = Math.min(R.tv0, p[1]); R.tu1 = Math.max(R.tu1, p[0]); R.tv1 = Math.max(R.tv1, p[1]); }
      const nm = baseName(T.src[t].mt); R.mats.set(nm, (R.mats.get(nm) || 0) + 1); });
    for (const R of comp.values()) rects.push({ a, s, u0: R.i0 * G, v0: R.j0 * G, u1: (R.i1 + 1) * G, v1: (R.j1 + 1) * G, tu0: R.tu0, tv0: R.tv0, tu1: R.tu1, tv1: R.tv1, tris: R.tris, mats: R.mats,
      sig: a + '|' + Math.round((R.tu1 - R.tu0) / 0.04) + '|' + Math.round((R.tv1 - R.tv0) / 0.04) + '|' + R.tris.length + '|' + [...R.mats.keys()].sort().join(',') });
  }
  // relief: the small faces of a wall's own material that lie in or within RELIEF_M of a big wall rectangle (the beds and sides of joints,
  // the steps of a moulding) are drawn with that wall's chart and its normal. A photograph holds a wall's joints where they really are;
  // modelled joints in other places would show as a second set.
  const P = T.P, depth = (a, x, y, z) => a === 0 ? x * F.c + z * F.s : a === 1 ? -x * F.s + z * F.c : y;
  for (const R of rects) {
    let d0 = 1e9, d1 = -1e9, nx = 0, ny = 0, nz = 0;
    for (const t of R.tris) { const o = t * 9, c = ch[t]; nx += c.nx; ny += c.ny; nz += c.nz; for (let k = 0; k < 3; k++) { const d = depth(R.a, P[o + k * 3], P[o + k * 3 + 1], P[o + k * 3 + 2]); if (d < d0) d0 = d; if (d > d1) d1 = d; } }
    const nl = Math.hypot(nx, ny, nz) || 1; R.d0 = d0; R.d1 = d1; R.n = [nx / nl, ny / nl, nz / nl];
    R.host = R.a !== 2 && R.tu1 - R.tu0 >= K.HOST_M && R.tv1 - R.tv0 >= K.HOST_M && nl > 0.9 * R.tris.length;      // (one facing: a wall, not a box seen from both sides)
    R.thin = Math.min(R.tu1 - R.tu0, R.tv1 - R.tv0) < K.RELIEF_THIN_M;
  }
  const hosts = rects.filter((R) => R.host); let moved = 0;
  if (hosts.length) for (const R of rects) {
    if (R.host || !R.thin) continue;
    const stay = [];
    for (const t of R.tris) {
      const o = t * 9, nm = baseName(T.src[t].mt); let to = null;
      for (const H of hosts) {
        if (!H.mats.has(nm)) continue; let ok = true, lo = 1e9, hi = -1e9; const uv = [];
        for (let k = 0; k < 3 && ok; k++) { const x = P[o + k * 3], y = P[o + k * 3 + 1], z = P[o + k * 3 + 2], d = depth(H.a, x, y, z), q = uvOf(F, H.a, x, y, z); uv.push(q); if (d < lo) lo = d; if (d > hi) hi = d;
          if (d < H.d0 - K.RELIEF_M || d > H.d1 + K.RELIEF_M || q[0] < H.tu0 - 0.01 || q[0] > H.tu1 + 0.01 || q[1] < H.tv0 - 0.01 || q[1] > H.tv1 + 0.01) ok = false; }
        if (!ok || hi - lo > K.RELIEF_M) continue;
        to = H; ch[t] = { a: H.a, s: H.s, nx: H.n[0], ny: H.n[1], nz: H.n[2], uv, relief: 1 }; break;
      }
      if (to) { to.tris.push(t); moved++; } else stay.push(t);
    }
    R.tris = stay;
  }
  return { ch, rects: rects.filter((R) => R.tris.length), slabs: groups.size, relief: moved };
}
const baseName = (mt) => mt.getName().replace(/_(fade|photo)$/, '');
const leftOut = (ex) => (mt) => !mt || mt.getAlphaMode() === 'BLEND' || !!(mt.getExtras() || {}).v2_fade_to || (ex ? ex.test(baseName(mt)) : false);
const rectKey = (r) => [r.a, r.s, r.u0.toFixed(3), r.v0.toFixed(3), r.u1.toFixed(3), r.v1.toFixed(3)].join(':');

// ── apply (tile build) ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const SPEC = {};
function loadSkin(slug, repo) {
  if (slug in SPEC) return SPEC[slug];
  const dir = path.join(repo || path.join(HERE, '..', '..'), 'v2', 'skins', slug), f = path.join(dir, 'skin.json');
  if (!fs.existsSync(f)) return (SPEC[slug] = null);
  const sk = JSON.parse(fs.readFileSync(f, 'utf8')); sk.dir = dir; sk.by = new Map();
  for (const r of sk.rects) sk.by.set(rectKey(r), r);
  return (SPEC[slug] = sk);
}
export function photoSkinKey(slug, repo) {
  const sk = loadSkin(slug, repo); if (!sk) return '';
  return 'skin:' + fs.statSync(path.join(sk.dir, 'skin.json')).size + ':' + fs.statSync(path.join(sk.dir, 'albedo.jpg')).size + ':' + sk.stamp + ':' + [K.AO_KEEP, K.HOST_M, K.RELIEF_THIN_M, K.RELIEF_M, K.TILE_SIDE].join(',');
}
export async function applyPhotoSkin(doc, slug, lod, repo) {
  const sk = loadSkin(slug, repo); if (!sk) return 0;
  // plain materials the photographs saw enough of take the colour they have there (so a wall no photograph saw matches the walls one did)
  for (const mt of doc.getRoot().listMaterials()) { const c = sk.colors && sk.colors[baseName(mt)]; if (c && !mt.getBaseColorTexture()) mt.setBaseColorFactor([...c, mt.getBaseColorFactor()[3]]); }
  if (lod !== 0) return 0;
  const sharp = (await import('sharp')).default;
  const F = frame(sk.theta), [W, H] = sk.atlas, tx = sk.texel, PAD = sk.pad;
  const root = doc.getRoot(), buf = root.listBuffers()[0];
  const T = triangles(doc), { ch, rects } = chartRects(T, F, leftOut(sk.exclude ? new RegExp(sk.exclude) : null));
  const take = new Map();                              // prim -> Set of first-index offsets that move to the skin
  const oP = [], oN = [], oU = [];
  for (const R of rects) {
    const q = sk.by.get(rectKey(R)); if (!q) continue;                                           // not in the atlas (or the building changed there): keeps its material
    for (const t of R.tris) {
      const o = t * 9, c = ch[t], s = T.src[t]; if (!take.has(s.prim)) take.set(s.prim, new Set()); take.get(s.prim).add(s.i);
      for (let k = 0; k < 3; k++) {
        const uv = uvOf(F, c.a, T.P[o + k * 3], T.P[o + k * 3 + 1], T.P[o + k * 3 + 2]);
        oP.push(T.P[o + k * 3], T.P[o + k * 3 + 1], T.P[o + k * 3 + 2]);
        if (c.relief) oN.push(c.nx, c.ny, c.nz); else oN.push(T.N[o + k * 3], T.N[o + k * 3 + 1], T.N[o + k * 3 + 2]);
        const rt = q.t || tx; oU.push((q.x + PAD + (uv[0] - q.u0) / rt) / W, (q.y + PAD + (uv[1] - q.v0) / rt) / H);
      }
    }
  }
  if (!oP.length) return 0;
  // the triangles that moved leave their primitive (its vertex arrays are rebuilt, so nothing unused stays in the tile)
  for (const [prim, gone] of take) {
    const idx = prim.getIndices() ? prim.getIndices().getArray() : null, n = idx ? idx.length : prim.getAttribute('POSITION').getCount(), keep = [];
    for (let i = 0; i + 2 < n; i += 3) if (!gone.has(i)) keep.push(idx ? idx[i] : i, idx ? idx[i + 1] : i + 1, idx ? idx[i + 2] : i + 2);
    if (!keep.length) { for (const m of root.listMeshes()) if (m.listPrimitives().includes(prim)) m.removePrimitive(prim); prim.dispose(); continue; }
    const remap = new Map(); for (const v of keep) if (!remap.has(v)) remap.set(v, remap.size);
    for (const sem of prim.listSemantics()) {
      const a = prim.getAttribute(sem), es = a.getElementSize(), src = a.getArray(), dst = new src.constructor(remap.size * es);
      for (const [v, w] of remap) for (let k = 0; k < es; k++) dst[w * es + k] = src[v * es + k];
      prim.setAttribute(sem, doc.createAccessor().setType(a.getType()).setArray(dst).setNormalized(a.getNormalized()).setBuffer(buf));
    }
    const ni = new Uint32Array(keep.length); for (let i = 0; i < keep.length; i++) ni[i] = remap.get(keep[i]);
    prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(ni).setBuffer(buf));
  }
  // the tile carries the atlas at TILE_SIDE; the app loads the full one (v2/skins/<slug>/albedo.jpg) for near buildings on a desktop
  const full = path.join(sk.dir, 'albedo.jpg'), sc = Math.min(1, K.TILE_SIDE / W);
  const img = sc < 1 ? await sharp(full).resize(Math.round(W * sc), Math.round(H * sc), { kernel: 'lanczos3' }).jpeg({ quality: K.JPEG_Q, mozjpeg: true }).toBuffer() : fs.readFileSync(full);
  const tex = doc.createTexture('photo_skin_' + slug).setImage(img).setMimeType('image/jpeg');
  const mat = doc.createMaterial('photo_skin').setBaseColorTexture(tex).setBaseColorFactor([...sk.factor, 1]).setRoughnessFactor(K.ROUGHNESS).setMetallicFactor(0)
    .setExtras({ v2_kind: 'plain', photo_material: 'photo skin', photo_skin: slug, photo_skin_full: sc < 1 ? 1 : 0, v2_photo_aniso: K.ANISO, v2_photo_bias: typeof sk.bias === 'number' ? sk.bias : K.BIAS });      // (a bake may set its own bias: a wall of fine dark and light strips is steadier at 0)
  // corners that are the same point with the same normal and the same place in the atlas are one vertex (per-vertex values such as the
  // tile's ambient occlusion are then one value there, as they were before the triangles moved)
  const wP = [], wN = [], wU = [], wI = new Uint32Array(oP.length / 3), seen = new Map();
  for (let i = 0; i < wI.length; i++) {
    const k = [oP[i * 3], oP[i * 3 + 1], oP[i * 3 + 2]].map((v) => Math.round(v * 2000)).join(',') + '|' + [oN[i * 3], oN[i * 3 + 1], oN[i * 3 + 2]].map((v) => Math.round(v * 100)).join(',') + '|' + Math.round(oU[i * 2] * W * 4) + ',' + Math.round(oU[i * 2 + 1] * H * 4);
    let j = seen.get(k); if (j === undefined) { j = seen.size; seen.set(k, j); wP.push(oP[i * 3], oP[i * 3 + 1], oP[i * 3 + 2]); wN.push(oN[i * 3], oN[i * 3 + 1], oN[i * 3 + 2]); wU.push(oU[i * 2], oU[i * 2 + 1]); }
    wI[i] = j;
  }
  const prim = doc.createPrimitive().setMaterial(mat)
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(wI).setBuffer(buf))
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(wP)).setBuffer(buf))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(wN)).setBuffer(buf))
    .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(wU)).setBuffer(buf));
  root.listMeshes()[0].addPrimitive(prim);
  return oP.length / 9;
}

// after the tile's ambient occlusion bake: a skinned surface keeps AO_KEEP of it (its photograph already holds the shade of its joints,
// its cornice and its porch; all of the tile's on top would shade them twice)
export function skinAO(doc) {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const mt = prim.getMaterial(), ao = prim.getAttribute('_AO'); if (!mt || !ao || !(mt.getExtras() || {}).photo_skin) continue;
    const a = ao.getArray().slice(); for (let i = 0; i < a.length; i++) a[i] = Math.round(255 - (255 - a[i]) * K.AO_KEEP);
    ao.setArray(a); n += a.length / 2;
  }
  return n;
}

// ── bake (private) ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
const s2l = new Float32Array(256); for (let i = 0; i < 256; i++) { const c = i / 255; s2l[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
const l2s = (v) => Math.max(0, Math.min(255, Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055))));

async function loadPhoto(sharp, ph) {
  const cam = JSON.parse(fs.readFileSync(ph.camera.replace(/^~/, process.env.HOME), 'utf8'));
  const file = ph.file.replace(/^~/, process.env.HOME), levels = [];
  const base = sharp(file).rotate().removeAlpha().toColourspace('srgb');
  const m0 = await base.clone().raw().toBuffer({ resolveWithObject: true });
  levels.push({ w: m0.info.width, h: m0.info.height, d: m0.data });
  for (let l = 1; l < 4; l++) { const w = Math.round(m0.info.width / 2 ** l), h = Math.round(m0.info.height / 2 ** l); const m = await base.clone().resize(w, h, { kernel: 'lanczos3' }).raw().toBuffer({ resolveWithObject: true }); levels.push({ w, h, d: m.data }); }
  const s = m0.info.width / cam.standard_size[0];
  if (Math.abs(m0.info.height / cam.standard_size[1] - s) > 0.01 * s) throw new Error('photo and camera have different shapes: ' + file);
  return { levels, W: m0.info.width, H: m0.info.height, fx: cam.K[0][0] * s, fy: cam.K[1][1] * s, cx: cam.K[0][2] * s, cy: cam.K[1][2] * s, R: cam.R_world_to_cam, C: cam.position_m, weight: ph.weight || 1 };
}
// glTF point (y up) -> the camera file's frame (z up) -> pixel; returns depth
function project(ph, x, y, z, out) {
  const dx = x - ph.C[0], dy = -z - ph.C[1], dz = y - ph.C[2], R = ph.R;
  const zc = R[2][0] * dx + R[2][1] * dy + R[2][2] * dz; if (zc < 0.3) return 0;
  out[0] = ph.fx * (R[0][0] * dx + R[0][1] * dy + R[0][2] * dz) / zc + ph.cx; out[1] = ph.fy * (R[1][0] * dx + R[1][1] * dy + R[1][2] * dz) / zc + ph.cy;
  return zc;
}
function depthBuffer(ph, T) {
  const w = Math.ceil(ph.W / K.ZS), h = Math.ceil(ph.H / K.ZS), zb = new Float32Array(w * h).fill(Infinity), a = [0, 0], b = [0, 0], c = [0, 0];
  for (let t = 0; t < T.n; t++) {
    const o = t * 9, p = T.P;
    const za = project(ph, p[o], p[o + 1], p[o + 2], a), zb1 = project(ph, p[o + 3], p[o + 4], p[o + 5], b), zc = project(ph, p[o + 6], p[o + 7], p[o + 8], c);
    if (!za || !zb1 || !zc) continue;
    const ax = a[0] / K.ZS, ay = a[1] / K.ZS, bx = b[0] / K.ZS, by = b[1] / K.ZS, cx = c[0] / K.ZS, cy = c[1] / K.ZS;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx, cx))), y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by, cy)));
    if (x0 > x1 || y0 > y1) continue;
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy); if (Math.abs(den) < 1e-9) continue;
    const ia = 1 / za, ib = 1 / zb1, ic = 1 / zc;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5, l0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / den, l1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / den, l2 = 1 - l0 - l1;
      if (l0 < -0.02 || l1 < -0.02 || l2 < -0.02) continue;
      const z = 1 / (l0 * ia + l1 * ib + l2 * ic), k = y * w + x; if (z < zb[k]) zb[k] = z;
    }
  }
  return { w, h, zb };
}
function sample(ph, px, py, lvl, out) {
  const L = ph.levels[lvl], sc = L.w / ph.W, x = px * sc - 0.5, y = py * sc - 0.5, x0 = Math.floor(x), y0 = Math.floor(y);
  if (x0 < 0 || y0 < 0 || x0 + 1 >= L.w || y0 + 1 >= L.h) return false;
  const fx = x - x0, fy = y - y0, i = (y0 * L.w + x0) * 3, j = i + L.w * 3, d = L.d;
  for (let k = 0; k < 3; k++) out[k] = (d[i + k] * (1 - fx) + d[i + 3 + k] * fx) * (1 - fy) + (d[j + k] * (1 - fx) + d[j + 3 + k] * fx) * fy;
  return true;
}

// the place in one photograph of the triangles the build draws itself, grown by OWN_M (at the depth buffer's size)
function ownMask(ph, T, own) {
  const w = ph.z.w, h = ph.z.h, m = new Uint8Array(w * h), a = [0, 0], b = [0, 0], c = [0, 0], Z = K.ZS;
  const seg = (px, py, x0, y0, x1, y1) => { const dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / l2)) : 0; return Math.hypot(px - x0 - t * dx, py - y0 - t * dy); };
  for (let t = 0; t < T.n; t++) {
    if (!own(T.src[t].mt)) continue;
    const o = t * 9, p = T.P, za = project(ph, p[o], p[o + 1], p[o + 2], a), zb = project(ph, p[o + 3], p[o + 4], p[o + 5], b), zc = project(ph, p[o + 6], p[o + 7], p[o + 8], c); if (!za || !zb || !zc) continue;
    const ax = a[0] / Z, ay = a[1] / Z, bx = b[0] / Z, by = b[1] / Z, cx = c[0] / Z, cy = c[1] / Z, zmin = Math.min(za, zb, zc), r = K.OWN_M * ph.fx / zmin / Z;
    const mx = Math.floor((ax + bx + cx) / 3), my = Math.floor((ay + by + cy) / 3);
    if (mx >= 0 && my >= 0 && mx < w && my < h && ph.z.zb[my * w + mx] < zmin - 0.5) continue;      // behind the building from here: it hides nothing
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx) - r)), x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx, cx) + r)), y0 = Math.max(0, Math.floor(Math.min(ay, by, cy) - r)), y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by, cy) + r));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const k = y * w + x; if (m[k]) continue; const px = x + 0.5, py = y + 0.5;
      if (Math.min(seg(px, py, ax, ay, bx, by), seg(px, py, bx, by, cx, cy), seg(px, py, cx, cy, ax, ay)) <= r) m[k] = 1; }
  }
  return m;
}
async function loadMask(sharp, ph, f) {       // white = do not use this pixel (trees, people, cars, sky in front of or beside the building)
  const m = await sharp(f.replace(/^~/, process.env.HOME)).extractChannel(0).raw().toBuffer({ resolveWithObject: true });
  ph.mask = { w: m.info.width, h: m.info.height, d: m.data };
}
const masked = (ph, px, py) => { if (ph.own && ph.own[Math.floor(py / K.ZS) * ph.z.w + Math.floor(px / K.ZS)]) return true; const M = ph.mask; if (!M) return false; const x = Math.floor(px * M.w / ph.W), y = Math.floor(py * M.h / ph.H); return M.d[y * M.w + x] > 127; };

async function bake(slug, glb, specFile, outDir) {
  const sharp = (await import('sharp')).default;
  const { NodeIO } = await import('@gltf-transform/core');
  const spec = JSON.parse(fs.readFileSync(specFile, 'utf8'));
  const doc = await new NodeIO().read(glb);
  const T = triangles(doc), theta = frameAngle(T), F = frame(theta);
  const mats = [...new Set(T.src.map((s) => s.mt))], mi = new Map(mats.map((m, i) => [m, i]));
  console.log(`${slug}: ${T.n} triangles, ${mats.length} materials, frame ${(theta * 180 / Math.PI).toFixed(2)} deg`);
  const wallish = mats.map((m) => !/glass|pane|door|lobby|interior|blind|window|sign|metal|iron|roof|tile|trim|paint|frame|mullion|louver|grille|vent/.test(m.getName()));
  const photos = []; for (const p of spec.photos) { const ph = await loadPhoto(sharp, p); if (p.mask) await loadMask(sharp, ph, p.mask); photos.push(ph); }
  for (const ph of photos) ph.z = depthBuffer(ph, T);
  // 1. charts
  const fades = Object.keys(((JSON.parse(fs.readFileSync(path.join(HERE, 'photo_materials.json'), 'utf8'))[slug] || {}).fade) || {});
  const exclude = [spec.exclude, fades.length ? '^(' + fades.join('|') + ')$' : null].filter(Boolean).join('|') || null, ex = exclude ? new RegExp(exclude) : null;
  const { ch, rects, slabs, relief } = chartRects(T, F, leftOut(ex));
  { const own = (mt) => !!mt && mt.getAlphaMode() !== 'BLEND' && (!!(mt.getExtras() || {}).v2_fade_to || (ex ? ex.test(baseName(mt)) : false));
    for (const ph of photos) { ph.own = ownMask(ph, T, own); let n = 0; for (let i = 0; i < ph.own.length; i++) n += ph.own[i]; console.log(`  the build's own parts hide ${(100 * n / ph.own.length).toFixed(1)} % of a photograph`); } }
  console.log(`${rects.length} rectangles in ${slabs} slabs, ${relief} relief triangles drawn with their wall`);
  // 2. bake every rectangle at the texel size; grow the texel until what is kept fits the atlas
  // the texel each rectangle wants: what its best photograph can fill there (three quarters of the rectangle's triangles are seen no finer)
  { const px = [0, 0], P = T.P;
    for (const R of rects) { const seen = [];
      for (const t of R.tris) { const o = t * 9, c = ch[t], X = (P[o] + P[o + 3] + P[o + 6]) / 3, Y = (P[o + 1] + P[o + 4] + P[o + 7]) / 3, Z = (P[o + 2] + P[o + 5] + P[o + 8]) / 3; let best = 0;
        for (const ph of photos) { const z = project(ph, X, Y, Z, px); if (!z || px[0] < 2 || px[1] < 2 || px[0] > ph.W - 3 || px[1] > ph.H - 3) continue;
          const vx = X - ph.C[0], vy = -Z - ph.C[1], vz = Y - ph.C[2], cs = Math.abs(c.nx * vx + (-c.nz) * vy + c.ny * vz) / Math.hypot(vx, vy, vz); if (cs >= K.MIN_COS) best = Math.max(best, ph.fx / z * cs); }
        if (best) seen.push(best); }
      seen.sort((a, b) => a - b); const ppm = seen.length ? seen[Math.min(seen.length - 1, Math.floor(seen.length * 0.75))] : 0;
      R.want = ppm ? Math.min(K.TEXEL_MAX_M, Math.max(K.TEXEL_MIN_M, 1 / (ppm * K.SHARP))) : 0; }
    // twins share the finest size any of them wants: a part no photograph saw is filled texel for texel from its twins
    const fine = new Map(); for (const R of rects) if (R.want) fine.set(R.sig, Math.min(fine.get(R.sig) || 1, R.want));
    for (const R of rects) R.want = Math.max(fine.get(R.sig) || K.TEXEL_MAX_M, Math.max(R.u1 - R.u0, R.v1 - R.v0) / (K.MAX_SIDE - 2 * K.PAD - 2)); }      // (and no rectangle is wider than the atlas)
  let grow = spec.grow || 1, packed = null;      // (the loop only grows the texels: start fine)
  for (let round = 0; round < 24; round++) {
    const px = [0, 0], col = [0, 0, 0]; let seenAll = 0;
    const acc = mats.map(() => [0, 0, 0, 0]), pair = Array.from({ length: photos.length ** 2 }, () => new Float64Array(7));
    // two passes: the first only counts, for each rectangle and photograph, how much of what the model says is in view the mask hides
    // (trees, cars, people). A photograph that sees a rectangle mostly through a tree is a poor witness of it: it gives that rectangle nothing.
    for (const R of rects) R.ban = null;
    for (let pass = 0; pass < 2; pass++) for (const R of rects) {
      if (pass === 0) { R.vis = new Float64Array(photos.length); R.got = new Float64Array(photos.length); R.pow = new Float64Array(photos.length); }
      const texel = R.texel = R.want * grow;
      const w = Math.max(1, Math.ceil((R.u1 - R.u0) / texel)), h = Math.max(1, Math.ceil((R.v1 - R.v0) / texel));
      R.w = w; R.h = h; R.rgb = new Uint8Array(w * h * 3); R.best = new Float32Array(w * h); R.state = new Uint8Array(w * h); R.m = new Uint16Array(w * h); R.ph = new Uint8Array(w * h);    // state 0 no surface, 1 surface unseen, 2 seen, 3 filled
      for (const t of R.tris) {
        const o = t * 9, c = ch[t], uv = c.uv, P = T.P;
        const ax = (uv[0][0] - R.u0) / texel, ay = (uv[0][1] - R.v0) / texel, bx = (uv[1][0] - R.u0) / texel, by = (uv[1][1] - R.v0) / texel, cx = (uv[2][0] - R.u0) / texel, cy = (uv[2][1] - R.v0) / texel;
        const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy); if (Math.abs(den) < 1e-9) continue;
        // 0.75 texel past each edge, so shared edges leave no crack
        const t0 = 0.75 * Math.hypot(bx - cx, by - cy) / Math.abs(den), t1 = 0.75 * Math.hypot(ax - cx, ay - cy) / Math.abs(den), t2 = 0.75 * Math.hypot(ax - bx, ay - by) / Math.abs(den);
        const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx) - 1)), x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx, cx) + 1)), y0 = Math.max(0, Math.floor(Math.min(ay, by, cy) - 1)), y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by, cy) + 1));
        const m = mi.get(T.src[t].mt);
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const qx = x + 0.5, qy = y + 0.5; let l0 = ((by - cy) * (qx - cx) + (cx - bx) * (qy - cy)) / den, l1 = ((cy - ay) * (qx - cx) + (ax - cx) * (qy - cy)) / den, l2 = 1 - l0 - l1;
          if (l0 < -t0 || l1 < -t1 || l2 < -t2) continue;
          const inside = l0 >= 0 && l1 >= 0 && l2 >= 0; if (!inside) { l0 = Math.max(0, l0); l1 = Math.max(0, l1); l2 = Math.max(0, l2); const sm = l0 + l1 + l2; l0 /= sm; l1 /= sm; l2 /= sm; }
          const X = l0 * P[o] + l1 * P[o + 3] + l2 * P[o + 6], Y = l0 * P[o + 1] + l1 * P[o + 4] + l2 * P[o + 7], Z = l0 * P[o + 2] + l1 * P[o + 5] + l2 * P[o + 8], k = y * w + x;
          if (R.state[k] === 0 || (inside && R.state[k] === 1)) { R.state[k] = 1; R.m[k] = m; }
          for (let pi = 0; pi < photos.length; pi++) {
            if (R.ban && R.ban[pi]) continue;
            const ph = photos[pi], z = project(ph, X, Y, Z, px); if (!z || px[0] < 2 || px[1] < 2 || px[0] > ph.W - 3 || px[1] > ph.H - 3) continue;
            const vx = X - ph.C[0], vy = -Z - ph.C[1], vz = Y - ph.C[2], vl = Math.hypot(vx, vy, vz), cs = Math.abs(c.nx * vx + (-c.nz) * vy + c.ny * vz) / vl; if (cs < K.MIN_COS) continue;
            // in one rectangle the photograph that sees most of it best is trusted first; another one takes a texel from it only when it
            // sees that texel TAKE_OVER times better (two photographs side by side on one wall never agree to the pixel)
            const score = ph.weight * (ph.fx / z) * cs * (inside ? 1 : 0.5), held = R.state[k] === 2 && R.ph[k] !== pi;
            const wins = !pass || (!held ? score > R.best[k] : R.rank[pi] < R.rank[R.ph[k]] ? score * K.TAKE_OVER > R.best[k] : score > R.best[k] * K.TAKE_OVER);
            if (pass && !wins && !(held && inside && ((x + y) & 3) === 0)) continue;             // (a held texel is still sampled now and then: the two photographs' exposures are compared there)
            const zx = Math.floor(px[0] / K.ZS), zy = Math.floor(px[1] / K.ZS), zb = ph.z; let ok = true;
            for (let j = -K.GUARD; j <= K.GUARD && ok; j++) for (let i = -K.GUARD; i <= K.GUARD; i++) {
              const xx = zx + i, yy = zy + j; if (xx < 0 || yy < 0 || xx >= zb.w || yy >= zb.h) continue; const q = zb.zb[yy * zb.w + xx];
              if (q === Infinity || q < z - 0.35 - 0.01 * z) { ok = false; break; }
            }
            if (!ok) continue;
            if (!pass) { if (inside) { R.vis[pi]++; if (!masked(ph, px[0], px[1])) { R.got[pi]++; R.pow[pi] += score; } } continue; }
            if (masked(ph, px[0], px[1])) continue;
            const lvl = Math.max(0, Math.min(3, Math.round(Math.log2(Math.max(1, texel * ph.fx / z)))));
            if (!sample(ph, px[0], px[1], lvl, col)) continue;
            if (!ph.mask && 2 * col[1] - col[0] - col[2] > 28 && col[1] > col[0] * 1.08) continue;      // no mask given: leave out plain green foliage
            if (held) { const g = pair[R.ph[k] * photos.length + pi]; for (let c = 0; c < 3; c++) { g[c] += s2l[R.rgb[k * 3 + c]]; g[3 + c] += s2l[Math.round(col[c])]; } g[6]++; }      // both saw it: what their exposures are to each other
            if (!wins) continue;
            R.best[k] = score; R.rgb[k * 3] = col[0]; R.rgb[k * 3 + 1] = col[1]; R.rgb[k * 3 + 2] = col[2]; R.state[k] = 2; R.m[k] = m; R.ph[k] = pi;
          }
        }
      }
      if (!pass) { R.ban = photos.map((_, pi) => R.vis[pi] > 0 && R.got[pi] / R.vis[pi] < K.WITNESS);
        const order = photos.map((_, pi) => pi).sort((a, b) => (R.ban[a] ? 0 : R.pow[b]) < (R.ban[b] ? 0 : R.pow[a]) ? -1 : 1); R.rank = new Uint8Array(photos.length); order.forEach((pi, i) => { R.rank[pi] = i; }); continue; }
      dropLeaks(R, mats.length, wallish);
      let surf = 0, seen = 0; for (let k = 0; k < w * h; k++) { if (R.state[k]) surf++; if (R.state[k] === 2) { seen++; const a = acc[R.m[k]]; a[0] += s2l[R.rgb[k * 3]]; a[1] += s2l[R.rgb[k * 3 + 1]]; a[2] += s2l[R.rgb[k * 3 + 2]]; a[3]++; } }
      R.surf = surf; R.nseen = seen; R.seen = surf ? seen / surf : 0; seenAll += seen;
    }
    // one exposure for all: each later photograph is scaled to the first one it shares enough surface with (a later one can take a texel over
    // from an earlier one, or lose it: both orders count)
    const gain = photos.map(() => null); gain[0] = [1, 1, 1];
    // photographs that share no surface with an anchored one share materials with it: the same stone is the same colour on every face
    const pm = photos.map(() => mats.map(() => [0, 0, 0, 0])), flat = mats.map((m) => !/glass|pane|sign|door|shrub|metal|iron|roof|tile/.test(m.getName()));
    for (const R of rects) for (let k = 0; k < R.w * R.h; k += 3) { if (R.state[k] !== 2) continue; const a = pm[R.ph[k]][R.m[k]]; a[0] += s2l[R.rgb[k * 3]]; a[1] += s2l[R.rgb[k * 3 + 1]]; a[2] += s2l[R.rgb[k * 3 + 2]]; a[3]++; }
    const pairLinks = () => { for (let pass = 0; pass < photos.length; pass++) for (let j = 1; j < photos.length; j++) { if (gain[j]) continue;
      for (let i = 0; i < photos.length && !gain[j]; i++) { if (!gain[i] || i === j) continue; const a = pair[i * photos.length + j], b = pair[j * photos.length + i], n = a[6] + b[6]; if (n < 3000) continue;
        gain[j] = [0, 1, 2].map((c) => gain[i][c] * (a[c] + b[3 + c]) / Math.max(1e-6, a[3 + c] + b[c])); } } };
    pairLinks();
    for (let turn = 0; turn < photos.length; turn++) {
      let bestJ = -1, bestN = 0, bestG = null;
      for (let j = 1; j < photos.length; j++) { if (gain[j]) continue; const lg = [0, 0, 0]; let wsum = 0;
        for (let m = 0; m < mats.length; m++) { if (!flat[m] || pm[j][m][3] < K.LINK_TEXELS) continue; const A = [0, 0, 0, 0];
          for (let i = 0; i < photos.length; i++) { if (!gain[i]) continue; const a = pm[i][m]; for (let c = 0; c < 3; c++) A[c] += a[c] * gain[i][c]; A[3] += a[3]; }
          if (A[3] < K.LINK_TEXELS) continue; const wt = Math.min(A[3], pm[j][m][3]); for (let c = 0; c < 3; c++) lg[c] += wt * Math.log((A[c] / A[3]) / Math.max(1e-6, pm[j][m][c] / pm[j][m][3])); wsum += wt; }
        if (wsum > bestN) { bestN = wsum; bestJ = j; bestG = lg.map((v) => Math.exp(v / wsum)); } }
      if (bestJ < 0) break; gain[bestJ] = bestG; pairLinks();
    }
    for (let j = 0; j < photos.length; j++) if (!gain[j]) gain[j] = [1, 1, 1];
    console.log('  photo gains', gain.map((g) => g.map((v) => v.toFixed(2)).join('/')).join('  '));
    for (const R of rects) for (let k = 0; k < R.w * R.h; k++) { if (R.state[k] !== 2) continue; const g = gain[R.ph[k]]; if (g[0] === 1 && g[1] === 1 && g[2] === 1) continue; for (let c = 0; c < 3; c++) R.rgb[k * 3 + c] = l2s(s2l[R.rgb[k * 3 + c]] * g[c]); }
    for (const R of rects) toneTo(R, (k) => R.state[k] === 2 ? R.ph[k] : -1, R.rank.indexOf(0));
    for (const a of acc) a.fill(0);
    for (const R of rects) for (let k = 0; k < R.w * R.h; k++) if (R.state[k] === 2) { const a = acc[R.m[k]]; a[0] += s2l[R.rgb[k * 3]]; a[1] += s2l[R.rgb[k * 3 + 1]]; a[2] += s2l[R.rgb[k * 3 + 2]]; a[3]++; }
    // what a photograph did not see of one part, it saw of that part's twins (same shape, same materials, another place on the building)
    const sib = new Map(); for (const R of rects) { if (!sib.has(R.sig)) sib.set(R.sig, []); sib.get(R.sig).push(R); }
    let twinFilled = 0;
    for (const R of rects) {
      const tw = sib.get(R.sig).filter((Q) => Q !== R && Q.nseen > 0); if (!tw.length || R.nseen === R.surf) continue;
      for (let y = 0; y < R.h; y++) for (let x = 0; x < R.w; x++) {
        const k = y * R.w + x; if (R.state[k] !== 1) continue;
        const texel = R.texel, du = R.u0 + (x + 0.5) * texel - R.tu0, dv = R.v0 + (y + 0.5) * texel - R.tv0; let r = 0, g = 0, b = 0, n = 0;
        for (const Q of tw) { const qx = Math.floor((Q.tu0 + du - Q.u0) / texel), qy = Math.floor((Q.tv0 + dv - Q.v0) / texel); if (qx < 0 || qy < 0 || qx >= Q.w || qy >= Q.h) continue; const j = qy * Q.w + qx; if (Q.state[j] !== 2) continue; r += Q.rgb[j * 3]; g += Q.rgb[j * 3 + 1]; b += Q.rgb[j * 3 + 2]; n++; }
        if (n) { R.rgb[k * 3] = r / n; R.rgb[k * 3 + 1] = g / n; R.rgb[k * 3 + 2] = b / n; R.state[k] = 3; twinFilled++; }
      }
    }
    for (const R of rects) toneTo(R, (k) => R.state[k] === 3 ? 1 : R.state[k] === 2 ? 0 : -1, 0);
    for (const R of rects) { let kn = 0; for (let k = 0; k < R.w * R.h; k++) if (R.state[k] >= 2) kn++; R.known = R.surf ? kn / R.surf : 0; }
    // (a long wall of which a photograph saw one end is kept too, when that end is big: the rest of it takes the same material's sample)
    const keep = rects.filter((R) => (R.known >= K.MIN_SEEN || R.nseen * R.texel * R.texel >= (spec.min_seen_m2 || K.MIN_SEEN_M2)) && Math.min(R.w, R.h) >= K.MIN_TEXELS).sort((p, q) => q.h - p.h);
    const side = K.MAX_SIDE; let x = 0, y = 0, rowH = 0, fits = true;
    for (const R of keep) { const w = R.w + 2 * K.PAD, h = R.h + 2 * K.PAD; if (w > side) { fits = false; break; } if (x + w > side) { x = 0; y += rowH; rowH = 0; } R.x = x; R.y = y; x += w; rowH = Math.max(rowH, h); }
    const Hh = y + rowH, maxH = spec.max_height || 4096;
    const txs = keep.map((R) => R.texel).sort((a, b) => a - b);
    console.log(`texels ${txs.length ? (txs[0] * 100).toFixed(1) + ' to ' + (txs[txs.length - 1] * 100).toFixed(1) + ', median ' + (txs[txs.length >> 1] * 100).toFixed(1) : '-'} cm (x${grow.toFixed(2)}): ${keep.length} rectangles kept, ${(seenAll / 1e6).toFixed(2)} M texels seen + ${(twinFilled / 1e6).toFixed(2)} M from twins, atlas ${side} x ${Hh}`);
    if (fits && Hh <= maxH) { packed = { keep, W: side, H: Math.ceil(Hh / 4) * 4, acc }; break; }
    grow *= Math.max(1.03, Math.sqrt(Hh / maxH) * 1.01);
  }
  if (!packed) throw new Error('atlas did not fit');
  // 3. one colour factor: the photographs' exposure against the build's own calibrated wall colours (light-rig scale)
  const rows = mats.map((m, i) => ({ i, name: m.getName(), c: m.getBaseColorFactor(), n: packed.acc[i][3], p: packed.acc[i].slice(0, 3).map((v) => v / Math.max(1, packed.acc[i][3])) })).filter((r) => r.n > 0).sort((a, b) => b.n - a.n);
  // The photographs' exposure against the build's own colours (light-rig scale): what the build's walls sum to over what the photographs
  // show there. A sum, not a mean of each material's ratio: on 2026-11-10 one material the build had far too bright (fins in shade) pulled
  // a mean of ratios to 0.91 and washed a whole building out. Glass, lit rooms, doors, plants and ground are not walls and do not count.
  const tot = rows.reduce((s, r) => s + r.n, 0), wall = rows.filter((r) => r.n > 0.01 * tot && !/glass|pane|sign|door|lobby|interior|blind|shrub|leaf|agave|plant|bed_|paving|ground|roof|tile/.test(r.name));
  const factor = [0, 1, 2].map((k) => wall.reduce((s, r) => s + r.n * r.c[k], 0) / Math.max(1e-6, wall.reduce((s, r) => s + r.n * r.p[k], 0)));
  // one brightness, and a tint held within HUE_MAX of it: the photograph's own colours are the truth; a tint taken freely from the build's
  // colours turned a pale stone entrance blue when the build's brick was pinker than the photographed brick (2026-11-10)
  { const lum = 0.2126 * factor[0] + 0.7152 * factor[1] + 0.0722 * factor[2]; for (let k = 0; k < 3; k++) factor[k] = lum * Math.max(1 / K.HUE_MAX, Math.min(K.HUE_MAX, factor[k] / lum)); }
  if (spec.factor) factor.splice(0, 3, ...spec.factor);
  // a plain material takes its photographed colour only when that is near what the build had (0.7 to 1.4): farther off, one of the two is wrong
  const big = wall.filter((r) => r.n > 0.04 * tot && Math.max(...r.c.slice(0, 3)) > 0.05 && [0, 1, 2].every((k) => { const q = r.p[k] * factor[k] / Math.max(1e-6, r.c[k]); return q > 0.7 && q < 1.4; }));
  for (const r of rows.slice(0, 12)) console.log(`  ${r.name.padEnd(24)} ${String(r.n).padStart(8)} texels  build ${r.c.slice(0, 3).map((v) => v.toFixed(3))}  photo x factor ${r.p.map((v, k) => (v * factor[k]).toFixed(3))}${big.includes(r) ? '  *' : ''}`);
  console.log('factor', factor.map((v) => v.toFixed(3)).join(' '));
  // the colour a material shows where no photograph and no twin saw it: its own mean in the photographs when it was seen enough, else the build's colour
  const mean = mats.map((m, i) => { const a = packed.acc[i]; if (a[3] >= 1500) return [l2s(a[0] / a[3]), l2s(a[1] / a[3]), l2s(a[2] / a[3])]; const c = m.getBaseColorFactor(); return [l2s(c[0] / factor[0]), l2s(c[1] / factor[1]), l2s(c[2] / factor[2])]; });
  const colors = {}; for (const r of big) colors[r.name] = r.p.map((v, k) => +(v * factor[k]).toFixed(4));
  const gmean = mats.map((m, i) => { const a = packed.acc[i]; return a[3] >= 1500 ? [a[0] / a[3], a[1] / a[3], a[2] / a[3]] : null; });
  // a square sample of each material where a photograph saw all of it: what the material looks like where nothing saw it
  const { keep, W, H } = packed, at = new Uint8Array(W * H * 3), patches = new Array(mats.length).fill(null);
  for (const S of [320, 224, 160, 112, 80, 56, 40, 28]) for (const R of keep) {
    if (R.w < S || R.h < S) continue;
    for (let y = 0; y + S <= R.h; y += S >> 2) for (let x = 0; x + S <= R.w; x += S >> 2) {
      const m = R.m[y * R.w + x]; if (patches[m] || R.state[y * R.w + x] !== 2) continue;
      let ok = true; for (let j = 0; j < S && ok; j += 2) for (let i = 0; i < S; i += 2) { const k = (y + j) * R.w + x + i; if (R.state[k] !== 2 || R.m[k] !== m) { ok = false; break; } }
      if (!ok) continue;
      const d = new Uint8Array(S * S * 3); for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) { const k = ((y + j) * R.w + x + i) * 3, q = (j * S + i) * 3; d[q] = R.rgb[k]; d[q + 1] = R.rgb[k + 1]; d[q + 2] = R.rgb[k + 2]; }
      const pm = [0, 0, 0]; for (let q = 0; q < S * S; q++) for (let c = 0; c < 3; c++) pm[c] += s2l[d[q * 3 + c]];
      patches[m] = { S, d, mean: pm.map((v) => v / (S * S)), tx: R.texel };
    }
  }
  console.log('samples:', mats.map((m, i) => patches[i] ? m.getName() + ' ' + patches[i].S : null).filter(Boolean).join(', '));
  for (const R of keep) {
    finishRect(R, mean, patches, R.texel, gmean);
    for (let y = -K.PAD; y < R.h + K.PAD; y++) for (let x = -K.PAD; x < R.w + K.PAD; x++) {
      const sx = Math.max(0, Math.min(R.w - 1, x)), sy = Math.max(0, Math.min(R.h - 1, y)), k = (sy * R.w + sx) * 3, d = ((R.y + K.PAD + y) * W + R.x + K.PAD + x) * 3;
      at[d] = R.rgb[k]; at[d + 1] = R.rgb[k + 1]; at[d + 2] = R.rgb[k + 2];
    }
  }
  // the space between rectangles takes the colour of what is near it: far away the graphics card reads small copies of the atlas, where a
  // rectangle's neighbours mix into it. Empty black there made thin parts flicker dark at a distance (rule 15).
  const used = new Uint8Array(W * H);
  for (const R of keep) for (let y = 0; y < R.h + 2 * K.PAD; y++) used.fill(1, (R.y + y) * W + R.x, (R.y + y) * W + R.x + R.w + 2 * K.PAD);
  fillEmpty(at, used, W, H);
  fs.mkdirSync(outDir, { recursive: true });
  await sharp(Buffer.from(at.buffer), { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: K.JPEG_Q, mozjpeg: true }).toFile(path.join(outDir, 'albedo.jpg'));
  const out = { v: 3, stamp: Date.now().toString(36), theta, slab: K.SLAB_M, texel: +(keep.length ? keep.map((R) => R.texel).sort((a, b) => a - b)[keep.length >> 1] : 0).toFixed(5), pad: K.PAD, atlas: [W, H], factor: factor.map((v) => +v.toFixed(4)), colors, ...(typeof spec.bias === 'number' ? { bias: spec.bias } : {}), ...(exclude ? { exclude } : {}), photographs: photos.length,
    rects: keep.map((R) => ({ a: R.a, s: R.s, u0: +R.u0.toFixed(3), v0: +R.v0.toFixed(3), u1: +R.u1.toFixed(3), v1: +R.v1.toFixed(3), x: R.x, y: R.y, t: +R.texel.toFixed(6) })) };
  fs.writeFileSync(path.join(outDir, 'skin.json'), JSON.stringify(out));
  const skinned = keep.reduce((s, R) => s + R.tris.length, 0);
  console.log(`wrote ${outDir}: atlas ${W} x ${H}, ${(fs.statSync(path.join(outDir, 'albedo.jpg')).size / 1024).toFixed(0)} KB, ${keep.length} rectangles, ${skinned} of ${T.n} triangles`);
}
// push-pull: every texel that holds nothing takes the mean of the nearest texels that hold something
function fillEmpty(at, used, W, H) {
  const lv = []; let w = W, h = H, c = null, k = null;
  while (w > 1 || h > 1) {
    const w2 = Math.ceil(w / 2), h2 = Math.ceil(h / 2), c2 = new Float32Array(w2 * h2 * 3), k2 = new Float32Array(w2 * h2);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, wt = c ? k[i] : used[i]; if (!wt) continue; const j = (y >> 1) * w2 + (x >> 1);
      if (c) { c2[j * 3] += c[i * 3] * wt; c2[j * 3 + 1] += c[i * 3 + 1] * wt; c2[j * 3 + 2] += c[i * 3 + 2] * wt; } else { c2[j * 3] += at[i * 3]; c2[j * 3 + 1] += at[i * 3 + 1]; c2[j * 3 + 2] += at[i * 3 + 2]; }
      k2[j] += wt;
    }
    for (let j = 0; j < w2 * h2; j++) if (k2[j]) { c2[j * 3] /= k2[j]; c2[j * 3 + 1] /= k2[j]; c2[j * 3 + 2] /= k2[j]; k2[j] = 1; }
    lv.push({ w: w2, h: h2, c: c2, k: k2 }); w = w2; h = h2; c = c2; k = k2;
  }
  for (let l = lv.length - 2; l >= 0; l--) { const A = lv[l], B = lv[l + 1];
    for (let y = 0; y < A.h; y++) for (let x = 0; x < A.w; x++) { const i = y * A.w + x; if (A.k[i]) continue; const j = (y >> 1) * B.w + (x >> 1); A.c[i * 3] = B.c[j * 3]; A.c[i * 3 + 1] = B.c[j * 3 + 1]; A.c[i * 3 + 2] = B.c[j * 3 + 2]; A.k[i] = 1; } }
  const A = lv[0]; if (!A) return;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (used[i]) continue; const j = (y >> 1) * A.w + (x >> 1); at[i * 3] = A.c[j * 3]; at[i * 3 + 1] = A.c[j * 3 + 1]; at[i * 3 + 2] = A.c[j * 3 + 2]; }
}
// inside one rectangle: every group of texels (group(k) >= 0) takes the tone of group `first`, measured on the materials both hold
function toneTo(R, group, first) {
  const n = R.w * R.h, st = new Map();      // group -> material -> [r, g, b, n] linear
  for (let k = 0; k < n; k++) { const g = group(k); if (g < 0) continue; let a = st.get(g); if (!a) st.set(g, a = new Map()); let b = a.get(R.m[k]); if (!b) a.set(R.m[k], b = [0, 0, 0, 0]); b[0] += s2l[R.rgb[k * 3]]; b[1] += s2l[R.rgb[k * 3 + 1]]; b[2] += s2l[R.rgb[k * 3 + 2]]; b[3]++; }
  const A = st.get(first); if (!A || st.size < 2) return;
  const gain = new Map();
  for (const [g, B] of st) { if (g === first) continue; const lg = [0, 0, 0]; let ws = 0;
    for (const [m, b] of B) { const a = A.get(m); if (!a || a[3] < K.MATCH_TEXELS || b[3] < K.MATCH_TEXELS) continue; const wt = Math.min(a[3], b[3]); for (let c = 0; c < 3; c++) lg[c] += wt * Math.log(Math.max(1e-5, a[c] / a[3]) / Math.max(1e-5, b[c] / b[3])); ws += wt; }
    if (ws) gain.set(g, lg.map((v) => Math.max(1 / K.MATCH_MAX, Math.min(K.MATCH_MAX, Math.exp(v / ws))))); }
  if (!gain.size) return;
  for (let k = 0; k < n; k++) { const g = gain.get(group(k)); if (!g) continue; for (let c = 0; c < 3; c++) R.rgb[k * 3 + c] = l2s(s2l[R.rgb[k * 3 + c]] * g[c]); }
}
// what stood in front of a wall and the mask missed (a branch, a sign, the shade of an eave that is not where the model has it) is far darker
// than the wall's own material and touches surface that no photograph saw: those texels count as not seen
function dropLeaks(R, nm, wallish) {
  const w = R.w, h = R.h, n = w * h, lum = (k) => 0.3 * R.rgb[k * 3] + 0.59 * R.rgb[k * 3 + 1] + 0.11 * R.rgb[k * 3 + 2];
  const hist = new Map(); let unseen = 0;
  for (let k = 0; k < n; k++) { if (R.state[k] === 1) unseen++; if (R.state[k] !== 2) continue; let hh = hist.get(R.m[k]); if (!hh) hist.set(R.m[k], hh = new Uint32Array(257)); hh[Math.round(lum(k))]++; hh[256]++; }
  if (!unseen) return 0;
  const cut = new Float32Array(nm).fill(-1);
  // (glass, doors and what is seen through them are dark and light by nature: only wall materials are checked)
  for (const [m, hh] of hist) { if (hh[256] < K.LEAK_MIN || !wallish[m]) continue; let c = 0, v = 0; for (; v < 256; v++) { c += hh[v]; if (c * 2 >= hh[256]) break; } cut[m] = v * K.LEAK_DARK; }
  const stack = []; for (let k = 0; k < n; k++) if (R.state[k] === 1) stack.push(k);
  let dropped = 0;
  while (stack.length) { const k = stack.pop(), x = k % w, y = (k - x) / w;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const xx = x + i, yy = y + j; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const q = yy * w + xx;
      if (R.state[q] !== 2 || lum(q) >= cut[R.m[q]]) continue; R.state[q] = 1; R.best[q] = 0; dropped++; stack.push(q); } }
  return dropped;
}
// inside one rectangle: unseen surface takes its material's colour, feathered into what was seen; texels with no surface take their neighbours (for the mip levels)
function finishRect(R, mean, patches, texel, gmean) {
  const w = R.w, h = R.h, n = w * h, FE = 8, wrap = (t, S) => { t = ((t % (2 * S)) + 2 * S) % (2 * S); return t < S ? t : 2 * S - 1 - t; }, ring = new Uint8Array(n), pp = new Float32Array(n * 3), known = new Uint8Array(n);
  for (let k = 0; k < n; k++) if (R.state[k] >= 2) { known[k] = 1; pp[k * 3] = R.rgb[k * 3]; pp[k * 3 + 1] = R.rgb[k * 3 + 1]; pp[k * 3 + 2] = R.rgb[k * 3 + 2]; }
  let front = []; for (let k = 0; k < n; k++) if (!known[k]) front.push(k);
  for (let it = 1; it <= 255 && front.length; it++) {
    const next = [], done = [];
    for (const k of front) { const x = k % w, y = (k - x) / w; let r = 0, g = 0, b = 0, c = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const xx = x + i, yy = y + j; if ((!i && !j) || xx < 0 || yy < 0 || xx >= w || yy >= h || !known[yy * w + xx]) continue; const q = (yy * w + xx) * 3; r += pp[q]; g += pp[q + 1]; b += pp[q + 2]; c++; }
      if (c) done.push([k, r / c, g / c, b / c]); else next.push(k); }
    if (!done.length) break;
    for (const [k, r, g, b] of done) { pp[k * 3] = r; pp[k * 3 + 1] = g; pp[k * 3 + 2] = b; known[k] = 1; ring[k] = Math.min(255, it); }
    front = next;
  }
  // the fill takes the tone of what a photograph saw of the same material in this rectangle
  const here = new Map();
  for (let k = 0; k < n; k++) { if (R.state[k] !== 2) continue; let a = here.get(R.m[k]); if (!a) here.set(R.m[k], a = [0, 0, 0, 0]); a[0] += s2l[R.rgb[k * 3]]; a[1] += s2l[R.rgb[k * 3 + 1]]; a[2] += s2l[R.rgb[k * 3 + 2]]; a[3]++; }
  const tone = new Map(); for (const [m, a] of here) { const pt = patches[m]; if (!pt || a[3] < K.TONE_TEXELS) continue; tone.set(m, [0, 1, 2].map((c) => Math.max(1 / K.TONE_MAX, Math.min(K.TONE_MAX, (a[c] / a[3]) / Math.max(1e-6, pt.mean[c]))))); }
  // a material this rectangle holds but no photograph saw here: the rectangle's tone against the whole building's, on what it did see
  const lg = [0, 0, 0]; let ws = 0; for (const [m, a] of here) { const G = gmean[m]; if (!G || a[3] < K.TONE_TEXELS) continue; for (let c = 0; c < 3; c++) lg[c] += a[3] * Math.log(Math.max(1e-5, a[c] / a[3]) / Math.max(1e-5, G[c])); ws += a[3]; }
  const rectTone = ws ? lg.map((v) => Math.max(1 / K.TONE_FAR, Math.min(K.TONE_FAR, Math.exp(v / ws)))) : null;
  const toneOf = (m) => { let g = tone.get(m); if (g || !rectTone) return g; const pt = patches[m], G = gmean[m]; if (!pt || !G) return null; g = [0, 1, 2].map((c) => rectTone[c] * G[c] / Math.max(1e-6, pt.mean[c])); tone.set(m, g); return g; };
  for (let k = 0; k < n; k++) {
    if (R.state[k] >= 2) continue;
    if (R.state[k] === 1) {
      const pt = patches[R.m[k]]; let m = mean[R.m[k]];
      if (pt) { const x = k % w, y = (k - x) / w, q = (wrap(Math.floor((R.v0 + (y + 0.5) * texel) / pt.tx), pt.S) * pt.S + wrap(Math.floor((R.u0 + (x + 0.5) * texel) / pt.tx), pt.S)) * 3, g = toneOf(R.m[k]); m = [pt.d[q], pt.d[q + 1], pt.d[q + 2]]; if (g) m = m.map((v, c) => l2s(s2l[v] * g[c])); }      // mirrored tiles of the sample, continuous over the whole wall plane
      const f = ring[k] ? Math.min(1, ring[k] / FE) : 1; for (let c = 0; c < 3; c++) R.rgb[k * 3 + c] = pp[k * 3 + c] * (1 - f) + m[c] * f;
    }
    else if (known[k]) { for (let c = 0; c < 3; c++) R.rgb[k * 3 + c] = pp[k * 3 + c]; }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, slug, glb, spec, out] = process.argv.slice(2);
  if (cmd === 'bake') await bake(slug, glb, spec, out || path.join(HERE, '..', '..', 'v2', 'skins', slug));
  else if (cmd === 'apply') {      // a skinned copy of one building, for a look outside the tile build
    const { NodeIO } = await import('@gltf-transform/core'); const io = new NodeIO(); const doc = await io.read(glb);
    const n = await applyPhotoSkin(doc, slug, 0, out || path.join(HERE, '..', '..')); await io.write(spec, doc);      // (a 4th argument: another root that holds v2/skins/<slug>, for a look before anything goes in the repo) console.log(`${n} triangles took the skin -> ${spec}`);
  } else if (cmd === 'depth') {    // depth <near.glb> <camera.json> <W> <H> <out.f32>: the building's depth from one camera, as the bake sees it (float32, W/ZS x H/ZS, Infinity = nothing)
    const { NodeIO } = await import('@gltf-transform/core'); const T = triangles(await new NodeIO().read(slug));
    const cam = JSON.parse(fs.readFileSync(glb, 'utf8')), W = +spec, H = +out, sc = W / cam.standard_size[0];
    const z = depthBuffer({ W, H, fx: cam.K[0][0] * sc, fy: cam.K[1][1] * sc, cx: cam.K[0][2] * sc, cy: cam.K[1][2] * sc, R: cam.R_world_to_cam, C: cam.position_m }, T);
    fs.writeFileSync(process.argv[7], Buffer.from(z.zb.buffer)); console.log(JSON.stringify({ w: z.w, h: z.h, zs: K.ZS }));
  } else console.log('usage: photo_skin.mjs bake <slug> <near.glb> <bake.json> [outDir] | apply <slug> <near.glb> <out.glb> [root] | depth <near.glb> <camera.json> <W> <H> <out.f32>');
}
