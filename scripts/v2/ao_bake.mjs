// Ambient occlusion baked per vertex into a v2 tile (vertex attribute _AO, 0..1, one byte): how much of the sky and the bounce a
// point of a Blender model can see past the tile's own nearby geometry. The app multiplies it into the INDIRECT light only (sky and
// bounce, v2/look.js AO); the sun keeps the shadow map. It is part of the geometry, so it cannot flicker in motion (rule 15).
//
//   node scripts/v2/ao_bake.mjs v2/tiles [--jobs 4] [--only t_0_0,t_1_0]   bake into the tiles that are already built (lod0 only)
//   build_tiles.mjs calls bakeAO(doc) on every new near tile, before Meshopt.
//
// Method (bakeAO below): the AO is measured per FLAT FACE and written to its vertices. From each sample point, AO.RAYS rays over the
// hemisphere round the face's normal (cosine-weighted, a fixed Hammersley set turned by a hash of the position: the same answer on
// every run); a ray that meets the tile's geometry within AO.RADIUS_M counts as blocked, by 1 - (distance / radius)^FALLOFF. The flat
// ground is NOT an occluder: in the app's light the lower half of the sky already IS the ground's bounce. A sample point buried inside
// other geometry (builders overlap boxes: nearly every ray blocked within AO.BURIED_M) is not counted.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

export const AO = {
  RAYS: 24,               // per sample point and side
  RADIUS_M: 3.0,          // how far an occluder counts (a loggia, an arcade, an eave, a deep reveal)
  FALLOFF: 2,             // weight of a hit at distance t: 1 - (t / RADIUS_M)^FALLOFF (1 = linear; higher = nearer to "any hit blocks")
  BIAS_M: 0.01,           // ray start, off the surface along the normal
  BURIED_M: 0.3,
  BURIED_SHARE: 0.94,     // this share of the rays blocked within BURIED_M = buried
  FACE_DEG: 2,            // triangles that share a vertex and face within this of each other are one flat face
  SAMPLE_AREA_M2: 0.5,    // one sample point per this much face area...
  SAMPLES_MIN: 2,
  SIDE_SAMPLES: 2,        // samples measured on both sides of a face before the open side is chosen
  SAMPLES_MAX: 32,        // ...within these
  LEVELS: 256,            // AO steps stored in the byte (measured 2026-10-20: 64 or 32 steps save under 2 % of the file, not worth the steps)
  FAR_RADIUS_M: 3.0,      // the far AO (_AOF) is the AO averaged over this radius
  GROUND_M: 0.6,          // level faces lower than this are the site ground: not occluders (they still get their own AO)
};

// ── BVH over triangles (binned on centroids, leaves of up to 4) ─────────
function buildBVH(tri) {   // tri: Float32Array, 9 floats a triangle
  const n = tri.length / 9;
  const idx = new Uint32Array(n); for (let i = 0; i < n; i++) idx[i] = i;
  const cx = new Float32Array(n), cy = new Float32Array(n), cz = new Float32Array(n);
  for (let i = 0; i < n; i++) { const o = i * 9; cx[i] = (tri[o] + tri[o + 3] + tri[o + 6]) / 3; cy[i] = (tri[o + 1] + tri[o + 4] + tri[o + 7]) / 3; cz[i] = (tri[o + 2] + tri[o + 5] + tri[o + 8]) / 3; }
  const maxNodes = 2 * n + 1;
  const bb = new Float32Array(maxNodes * 6), left = new Int32Array(maxNodes), start = new Int32Array(maxNodes), count = new Int32Array(maxNodes), axisOf = new Int8Array(maxNodes);
  let nodes = 0;
  const stack = [[0, n, nodes++]];
  while (stack.length) {
    const [s, e, id] = stack.pop();
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    let a0 = Infinity, b0 = Infinity, c0 = Infinity, a1 = -Infinity, b1 = -Infinity, c1 = -Infinity;
    for (let k = s; k < e; k++) {
      const i = idx[k], o = i * 9;
      for (let v = 0; v < 9; v += 3) {
        const x = tri[o + v], y = tri[o + v + 1], z = tri[o + v + 2];
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
      }
      if (cx[i] < a0) a0 = cx[i]; if (cx[i] > a1) a1 = cx[i]; if (cy[i] < b0) b0 = cy[i]; if (cy[i] > b1) b1 = cy[i]; if (cz[i] < c0) c0 = cz[i]; if (cz[i] > c1) c1 = cz[i];
    }
    bb.set([x0, y0, z0, x1, y1, z1], id * 6);
    const cnt = e - s;
    if (cnt <= 4) { left[id] = -1; start[id] = s; count[id] = cnt; continue; }
    // binned surface-area split (12 bins on each axis); a split no cheaper than a leaf ends the node, up to 8 triangles
    const NB = 12, lo = [a0, b0, c0], ext = [a1 - a0, b1 - b0, c1 - c0], C = [cx, cy, cz];
    let bestCost = Infinity, bestAxis = -1, bestPos = 0;
    for (let ax = 0; ax < 3; ax++) {
      if (!(ext[ax] > 1e-6)) continue;
      const cnt2 = new Int32Array(NB), bx = new Float64Array(NB * 6).fill(0);
      for (let b = 0; b < NB; b++) { bx[b * 6] = bx[b * 6 + 1] = bx[b * 6 + 2] = Infinity; bx[b * 6 + 3] = bx[b * 6 + 4] = bx[b * 6 + 5] = -Infinity; }
      const cc = C[ax], k0 = lo[ax], kk = NB / ext[ax];
      for (let k = s; k < e; k++) {
        const ti = idx[k]; let b = Math.floor((cc[ti] - k0) * kk); if (b >= NB) b = NB - 1;
        cnt2[b]++; const o = ti * 9, q = b * 6;
        for (let v = 0; v < 9; v += 3) for (let d = 0; d < 3; d++) { const x = tri[o + v + d]; if (x < bx[q + d]) bx[q + d] = x; if (x > bx[q + 3 + d]) bx[q + 3 + d] = x; }
      }
      const area = (q, A) => { const dx = A[q + 3] - A[q], dy = A[q + 4] - A[q + 1], dz = A[q + 5] - A[q + 2]; return dx > -Infinity && dx >= 0 ? dx * dy + dy * dz + dz * dx : 0; };
      const rA = new Float64Array(NB), rN = new Int32Array(NB), acc = new Float64Array(6);
      acc[0] = acc[1] = acc[2] = Infinity; acc[3] = acc[4] = acc[5] = -Infinity; let n2 = 0;
      for (let b = NB - 1; b > 0; b--) { const q = b * 6; for (let d = 0; d < 3; d++) { if (bx[q + d] < acc[d]) acc[d] = bx[q + d]; if (bx[q + 3 + d] > acc[3 + d]) acc[3 + d] = bx[q + 3 + d]; } n2 += cnt2[b]; rA[b] = n2 ? area(0, acc) : 0; rN[b] = n2; }
      acc[0] = acc[1] = acc[2] = Infinity; acc[3] = acc[4] = acc[5] = -Infinity; let n1 = 0;
      for (let b = 0; b < NB - 1; b++) {
        const q = b * 6; for (let d = 0; d < 3; d++) { if (bx[q + d] < acc[d]) acc[d] = bx[q + d]; if (bx[q + 3 + d] > acc[3 + d]) acc[3 + d] = bx[q + 3 + d]; } n1 += cnt2[b];
        if (!n1 || !rN[b + 1]) continue;
        const cost = area(0, acc) * n1 + rA[b + 1] * rN[b + 1];
        if (cost < bestCost) { bestCost = cost; bestAxis = ax; bestPos = k0 + (b + 1) / kk; }
      }
    }
    const nodeArea = (x1 - x0) * (y1 - y0) + (y1 - y0) * (z1 - z0) + (z1 - z0) * (x1 - x0);
    if (bestAxis < 0 || (cnt <= 8 && bestCost >= nodeArea * cnt)) {
      if (cnt <= 16) { left[id] = -1; start[id] = s; count[id] = cnt; continue; }
    }
    let m;
    if (bestAxis >= 0) {
      const axis = C[bestAxis]; let i = s, j = e - 1;
      while (i <= j) { if (axis[idx[i]] < bestPos) i++; else { const t = idx[i]; idx[i] = idx[j]; idx[j] = t; j--; } }
      m = i;
    } else m = s;
    if (m === s || m === e) m = (s + e) >> 1;     // all centroids on one side (coincident): split by count
    const l = nodes++, r = nodes++;
    left[id] = l; count[id] = 0; axisOf[id] = bestAxis < 0 ? 0 : bestAxis;
    stack.push([s, m, l], [m, e, r]);
  }
  // triangles in leaf order, for memory locality
  const t2 = new Float32Array(n * 9);
  for (let k = 0; k < n; k++) t2.set(tri.subarray(idx[k] * 9, idx[k] * 9 + 9), k * 9);
  return { bb, left, start, count, axisOf, tri: t2 };
}

// nearest hit distance along the ray within tmax, or Infinity
function trace(B, ox, oy, oz, dx, dy, dz, tmax, stack) {
  const { bb, left, start, count, axisOf, tri } = B;
  const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
  let best = tmax, sp = 0;
  stack[sp++] = 0;
  while (sp) {
    const id = stack[--sp], o = id * 6;
    let t0 = (bb[o] - ox) * ix, t1 = (bb[o + 3] - ox) * ix; if (t0 > t1) { const t = t0; t0 = t1; t1 = t; }
    let u0 = (bb[o + 1] - oy) * iy, u1 = (bb[o + 4] - oy) * iy; if (u0 > u1) { const t = u0; u0 = u1; u1 = t; }
    if (u0 > t0) t0 = u0; if (u1 < t1) t1 = u1;
    let w0 = (bb[o + 2] - oz) * iz, w1 = (bb[o + 5] - oz) * iz; if (w0 > w1) { const t = w0; w0 = w1; w1 = t; }
    if (w0 > t0) t0 = w0; if (w1 < t1) t1 = w1;
    if (t0 > t1 || t1 < 0 || t0 > best) continue;
    const L = left[id];
    if (L >= 0) { const ax = axisOf[id], dpos = ax === 0 ? dx >= 0 : ax === 1 ? dy >= 0 : dz >= 0; if (dpos) { stack[sp++] = L + 1; stack[sp++] = L; } else { stack[sp++] = L; stack[sp++] = L + 1; } continue; }   // near child first
    for (let k = start[id], e = k + count[id]; k < e; k++) {
      const q = k * 9;
      const e1x = tri[q + 3] - tri[q], e1y = tri[q + 4] - tri[q + 1], e1z = tri[q + 5] - tri[q + 2];
      const e2x = tri[q + 6] - tri[q], e2y = tri[q + 7] - tri[q + 1], e2z = tri[q + 8] - tri[q + 2];
      const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (det > -1e-12 && det < 1e-12) continue;
      const inv = 1 / det, sx = ox - tri[q], sy = oy - tri[q + 1], sz = oz - tri[q + 2];
      const u = (sx * px + sy * py + sz * pz) * inv; if (u < 0 || u > 1) continue;
      const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
      const v = (dx * qx + dy * qy + dz * qz) * inv; if (v < 0 || u + v > 1) continue;
      const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (t > 1e-4 && t < best) best = t;
    }
  }
  return best;
}

// fixed cosine-weighted hemisphere directions (z up), Hammersley
function hemisphere(n) {
  const d = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    let b = i, r = 0, f = 0.5; while (b) { if (b & 1) r += f; b >>= 1; f /= 2; }
    const u = (i + 0.5) / n, v = r, s = Math.sqrt(u), ph = 2 * Math.PI * v;
    d[i * 3] = s * Math.cos(ph); d[i * 3 + 1] = s * Math.sin(ph); d[i * 3 + 2] = Math.sqrt(Math.max(0, 1 - u));
  }
  return d;
}


// AO at one point with a unit normal: 0..1 (1 = nothing in the way), or -1 when the point is buried inside other geometry
function aoAt(B, H, rays, stack, P, px, py, pz, nx, ny, nz) {
  if (!(nx * nx + ny * ny + nz * nz > 0.25)) return 1;     // no normal (a degenerate triangle): a NaN ray would visit the whole tree
  // tangent frame, turned by a hash of the position (decorrelates neighbours, same on every run)
  let tx, ty, tz; if (Math.abs(nx) < 0.9) { tx = 0; ty = -nz; tz = ny; } else { tx = nz; ty = 0; tz = -nx; }
  const l = Math.hypot(tx, ty, tz); tx /= l; ty /= l; tz /= l;
  let bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
  const h = Math.sin(px * 12.9898 + py * 78.233 + pz * 37.719) * 43758.5453;
  const a = 2 * Math.PI * (h - Math.floor(h)), ca = Math.cos(a), sa = Math.sin(a);
  const t2x = ca * tx + sa * bx, t2y = ca * ty + sa * by, t2z = ca * tz + sa * bz;
  bx = -sa * tx + ca * bx; by = -sa * ty + ca * by; bz = -sa * tz + ca * bz;
  const ox = px + nx * P.BIAS_M, oy = py + ny * P.BIAS_M, oz = pz + nz * P.BIAS_M;
  let occ = 0, near = 0;
  for (let r = 0; r < rays; r++) {
    const hx = H[r * 3], hy = H[r * 3 + 1], hz = H[r * 3 + 2];
    const dx = hx * t2x + hy * bx + hz * nx, dy = hx * t2y + hy * by + hz * ny, dz = hx * t2z + hy * bz + hz * nz;
    const t = trace(B, ox, oy, oz, dx, dy, dz, P.RADIUS_M, stack);
    if (t < P.RADIUS_M) { occ += 1 - Math.pow(t / P.RADIUS_M, P.FALLOFF); if (t < P.BURIED_M) near++; }
  }
  return near >= P.BURIED_SHARE * rays ? -1 : 1 - occ / rays;
}

// glTF Transform: bake _AO into every primitive of the doc. Positions go through each node's world matrix (the tiles' node transforms
// are translations and uniform quantization scales, so normals turn by the 3x3 and are renormalised).
//
// Per vertex AO interpolated over the builders' triangulation makes wedges and blotches (a wall triangle fanned from one dark corner;
// tried 2026-10-20 and rejected on the pictures). So the AO is measured per FLAT FACE instead: the triangles of a primitive that share
// vertices and face the same way (within FACE_DEG) are one face (a wall between its edges, a reveal, a soffit, a loggia's back wall), and
// the face gets the mean AO of SAMPLES points spread over its area (one per SAMPLE_AREA_M2, between SAMPLES_MIN and SAMPLES_MAX). A
// vertex takes the area-weighted mean of the faces it belongs to: on a flat face that is the face's own value (uniform: no gradient,
// no wedge, no noise); on a smooth-shaded curve (a column) it blends from facet to facet. Buried sample points do not count.
export function bakeAO(doc, P = AO) {
  // one byte, on LEVELS steps (fewer distinct values: the Meshopt vertex codec packs them tighter)
  const q8 = (a) => Math.round(Math.round(Math.min(1, Math.max(0, a)) * (P.LEVELS - 1)) * 255 / (P.LEVELS - 1));
  const items = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    const M = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const pa = prim.getAttribute('POSITION'), na = prim.getAttribute('NORMAL'), ia = prim.getIndices();
      if (!pa || !na || !ia) continue;
      const n = pa.getCount(), pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), el = [0, 0, 0], nl = [0, 0, 0];
      for (let i = 0; i < n; i++) {
        pa.getElement(i, el); na.getElement(i, nl);
        pos[i * 3] = M[0] * el[0] + M[4] * el[1] + M[8] * el[2] + M[12];
        pos[i * 3 + 1] = M[1] * el[0] + M[5] * el[1] + M[9] * el[2] + M[13];
        pos[i * 3 + 2] = M[2] * el[0] + M[6] * el[1] + M[10] * el[2] + M[14];
        const x = M[0] * nl[0] + M[4] * nl[1] + M[8] * nl[2], y = M[1] * nl[0] + M[5] * nl[1] + M[9] * nl[2], z = M[2] * nl[0] + M[6] * nl[1] + M[10] * nl[2];
        const l = Math.hypot(x, y, z) || 1; nrm[i * 3] = x / l; nrm[i * 3 + 1] = y / l; nrm[i * 3 + 2] = z / l;
      }
      items.push({ prim, pos, nrm, index: Uint32Array.from(ia.getArray()) });
    }
  }
  let nt = 0; for (const p of items) nt += p.index.length / 3;
  // occluders: every triangle except the builds' own site ground (level, within GROUND_M of the app's ground): the ground is the bounce
  const occ = [];
  for (const p of items) for (let t = 0; t < p.index.length; t += 3) {
    const a = p.index[t] * 3, b = p.index[t + 1] * 3, c = p.index[t + 2] * 3;
    if (Math.max(p.pos[a + 1], p.pos[b + 1], p.pos[c + 1]) < P.GROUND_M) {
      const ux = p.pos[b] - p.pos[a], uy = p.pos[b + 1] - p.pos[a + 1], uz = p.pos[b + 2] - p.pos[a + 2], vx = p.pos[c] - p.pos[a], vy = p.pos[c + 1] - p.pos[a + 1], vz = p.pos[c + 2] - p.pos[a + 2];
      const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
      if (Math.abs(gy) > 0.95 * Math.hypot(gx, gy, gz)) continue;
    }
    for (const v of [a, b, c]) occ.push(p.pos[v], p.pos[v + 1], p.pos[v + 2]);
  }
  const B = buildBVH(Float32Array.from(occ)), H = hemisphere(P.RAYS), stack = new Int32Array(256);
  const cosMax = Math.cos(P.FACE_DEG * Math.PI / 180);
  const buf = doc.getRoot().listBuffers()[0];
  let sum = 0, cnt = 0, faces = 0, samples = 0;
  for (const p of items) {
    const I = p.index, T = I.length / 3, nv = p.pos.length / 3;
    // face normal and area of every triangle
    const fn = new Float32Array(T * 3), area = new Float32Array(T);
    for (let t = 0; t < T; t++) {
      const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
      const ux = p.pos[b] - p.pos[a], uy = p.pos[b + 1] - p.pos[a + 1], uz = p.pos[b + 2] - p.pos[a + 2];
      const vx = p.pos[c] - p.pos[a], vy = p.pos[c + 1] - p.pos[a + 1], vz = p.pos[c + 2] - p.pos[a + 2];
      let gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx; const l = Math.hypot(gx, gy, gz);
      area[t] = l / 2; if (l > 0) { gx /= l; gy /= l; gz /= l; }
      // (the winding may be either way: take the side the vertex normals face)
      const s = gx * (p.nrm[a] + p.nrm[b] + p.nrm[c]) + gy * (p.nrm[a + 1] + p.nrm[b + 1] + p.nrm[c + 1]) + gz * (p.nrm[a + 2] + p.nrm[b + 2] + p.nrm[c + 2]) < 0 ? -1 : 1;
      fn[t * 3] = gx * s; fn[t * 3 + 1] = gy * s; fn[t * 3 + 2] = gz * s;
    }
    // faces: union-find over triangles that share a vertex and face the same way
    const parent = new Int32Array(T); for (let t = 0; t < T; t++) parent[t] = t;
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    const firstAt = new Int32Array(nv).fill(-1);
    for (let t = 0; t < T; t++) for (let k = 0; k < 3; k++) {
      const v = I[t * 3 + k], f = firstAt[v];
      if (f < 0) { firstAt[v] = t; continue; }
      if (fn[t * 3] * fn[f * 3] + fn[t * 3 + 1] * fn[f * 3 + 1] + fn[t * 3 + 2] * fn[f * 3 + 2] >= cosMax) { const ra = find(t), rb = find(f); if (ra !== rb) parent[ra] = rb; }
    }
    const faceOf = new Int32Array(T), faceArea = new Map(), members = new Map();
    for (let t = 0; t < T; t++) { const r = find(t); faceOf[t] = r; faceArea.set(r, (faceArea.get(r) || 0) + area[t]); if (!members.has(r)) members.set(r, []); members.get(r).push(t); }
    // AO of each face: sample points spread over its triangles by area (a fixed sequence: same on every run)
    const faceAO = new Map();
    for (const [r, tris] of members) {
      const A = faceArea.get(r);
      if (!(A > 1e-6)) { faceAO.set(r, 1); continue; }     // degenerate (a zero-area sliver: it has no normal, and draws nothing)
      const ns = Math.max(P.SAMPLES_MIN, Math.min(P.SAMPLES_MAX, Math.ceil(A / P.SAMPLE_AREA_M2)));
      let acc = 0, got = 0, acc2 = 0, got2 = 0, side = 0;
      // cumulative area for choosing triangles
      let cum = 0; const cuts = tris.map((t) => (cum += area[t]));
      for (let s = 0; s < ns; s++) {
        const target = ((s + 0.5) / ns) * cum;
        let lo = 0, hi = cuts.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cuts[m] < target) lo = m + 1; else hi = m; }
        const t = tris[lo];
        // a point inside the triangle (R2 sequence, folded)
        let u = (s * 0.7548776662466927 + 0.5) % 1, w = (s * 0.5698402909980532 + 0.5) % 1; if (u + w > 1) { u = 1 - u; w = 1 - w; }
        const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
        const px = p.pos[a] + u * (p.pos[b] - p.pos[a]) + w * (p.pos[c] - p.pos[a]);
        const py = p.pos[a + 1] + u * (p.pos[b + 1] - p.pos[a + 1]) + w * (p.pos[c + 1] - p.pos[a + 1]);
        const pz = p.pos[a + 2] + u * (p.pos[b + 2] - p.pos[a + 2]) + w * (p.pos[c + 2] - p.pos[a + 2]);
        // both sides: the builders' faces are wound either way and the app draws the side the camera sees (tiles are double-sided),
        // so the side that faces into the solid would read black. The open side is the seen one: both sides are measured until
        // SIDE_SAMPLES samples have told them apart, then only the open side.
        const both = s < P.SIDE_SAMPLES;
        if (both || side > 0) { const v = aoAt(B, H, P.RAYS, stack, P, px, py, pz, fn[t * 3], fn[t * 3 + 1], fn[t * 3 + 2]); if (v >= 0) { acc += v; got++; } }
        if (both || side < 0) { const v = aoAt(B, H, P.RAYS, stack, P, px, py, pz, -fn[t * 3], -fn[t * 3 + 1], -fn[t * 3 + 2]); if (v >= 0) { acc2 += v; got2++; } }
        if (s === P.SIDE_SAMPLES - 1) side = (got ? acc / got : -1) >= (got2 ? acc2 / got2 : -1) ? 1 : -1;
        samples++;
      }
      // (a side buried in every sample is pressed against other geometry, as a layer laid on a wall: the other side is the seen one)
      faceAO.set(r, got || got2 ? Math.max(got ? acc / got : 0, got2 ? acc2 / got2 : 0) : 1);
      faces++;
    }
    // per vertex: area-weighted mean of the faces it belongs to
    const vs = new Float64Array(nv), vw = new Float64Array(nv);
    for (let t = 0; t < T; t++) { const f = faceAO.get(faceOf[t]), w = area[t] + 1e-9; for (let k = 0; k < 3; k++) { const v = I[t * 3 + k]; vs[v] += f * w; vw[v] += w; } }
    const u8 = new Uint8Array(nv);
    for (let v = 0; v < nv; v++) { const a = vw[v] > 0 ? vs[v] / vw[v] : 1; u8[v] = q8(a); sum += a; cnt++; }
    p.prim.setAttribute('_AO', doc.createAccessor().setType('SCALAR').setArray(u8).setNormalized(true).setBuffer(buf));
    // _AOF, the FAR AO: the same AO averaged over FAR_RADIUS_M round the vertex (by area, weight falling to 0 at the radius). Seen from
    // far, a pixel covers several fins or slots, and per-face AO makes their sub-pixel contrast flicker in motion (measured: DKR fins
    // at 1800 m, shimmer 0.63 -> 0.80). The app moves from _AO to _AOF as a pixel grows (LOOK.AO.FAR_PX_M): the far AO is the near
    // one box-filtered over a few metres, so the building keeps its darker loggias and courts without the fine stripes.
    const R = P.FAR_RADIUS_M, cell = R, grid = new Map(), cen = new Float64Array(T * 3), tao = new Float64Array(T);
    for (let t = 0; t < T; t++) {
      for (let d = 0; d < 3; d++) cen[t * 3 + d] = (p.pos[I[t * 3] * 3 + d] + p.pos[I[t * 3 + 1] * 3 + d] + p.pos[I[t * 3 + 2] * 3 + d]) / 3;
      tao[t] = faceAO.get(faceOf[t]);
      if (!(area[t] > 0)) continue;
      const k = `${Math.floor(cen[t * 3] / cell)},${Math.floor(cen[t * 3 + 1] / cell)},${Math.floor(cen[t * 3 + 2] / cell)}`;
      let l = grid.get(k); if (!l) grid.set(k, (l = [])); l.push(t);
    }
    const fs = new Float64Array(nv), fw = new Float64Array(nv);
    for (let t = 0; t < T; t++) { const w = area[t] + 1e-9; for (let k = 0; k < 3; k++) { const v = I[t * 3 + k]; fs[v] += tao[t] * w; fw[v] += w; } }   // its own faces, always
    const f8 = new Uint8Array(nv);
    for (let v = 0; v < nv; v++) {
      const x = p.pos[v * 3], y = p.pos[v * 3 + 1], z = p.pos[v * 3 + 2], gx = Math.floor(x / cell), gy = Math.floor(y / cell), gz = Math.floor(z / cell);
      let s = fs[v], w = fw[v];
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
        const l = grid.get(`${gx + a},${gy + b},${gz + c}`); if (!l) continue;
        for (const t of l) { const d = Math.hypot(cen[t * 3] - x, cen[t * 3 + 1] - y, cen[t * 3 + 2] - z); if (d < R) { const ww = area[t] * (1 - d / R); s += tao[t] * ww; w += ww; } }
      }
      f8[v] = q8(w > 0 ? s / w : 1);
    }
    p.prim.setAttribute('_AOF', doc.createAccessor().setType('SCALAR').setArray(f8).setNormalized(true).setBuffer(buf));
  }
  return { vertices: cnt, triangles: nt, triangles_before: nt, faces, samples, meanAO: cnt ? sum / cnt : 1 };
}

// ── CLI: bake into tiles that are already built ──────────────────────────
const SELF = fileURLToPath(import.meta.url);
if (isMainThread && process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  const argv = process.argv.slice(2);
  const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  const dir = path.resolve(argv[0] || 'v2/tiles');
  const only = opt('--only') ? new Set(opt('--only').split(',')) : null;
  const jobs = +(opt('--jobs') || Math.max(1, os.cpus().length - 1));
  const files = fs.readdirSync(dir).filter((f) => /^t_-?\d+_-?\d+\.glb$/.test(f) && (!only || only.has(f.replace('.glb', ''))));
  const t0 = Date.now(); let next = 0; const res = {};
  await Promise.all(Array.from({ length: Math.min(jobs, files.length) }, () => new Promise((done) => {
    const w = new Worker(SELF, { workerData: { dir } });
    const feed = () => { if (next >= files.length) { w.postMessage(null); return; } w.postMessage(files[next++]); };
    w.on('message', (m) => { res[m.file] = m; console.log(`AO ${m.file} ${m.triangles} triangles, ${m.faces} faces, ${m.samples} samples, ${m.vertices} vertices, mean ${m.meanAO.toFixed(3)}, ${(m.before / 1e6).toFixed(2)} -> ${(m.after / 1e6).toFixed(2)} MB, ${(m.ms / 1000).toFixed(1)} s`); feed(); });
    w.on('exit', done); w.on('error', (e) => { console.error(e); done(); });
    feed();
  })));
  // the manifest's and inventory's byte counts follow the files
  const man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  for (const t of man.tiles) { const r = res[t.id + '.glb']; if (r && t.bytes) t.bytes[0] = r.after; }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(man, null, 1));
  const invF = path.join(dir, 'inventory.json');
  if (fs.existsSync(invF)) { const inv = JSON.parse(fs.readFileSync(invF, 'utf8')); for (const [f, r] of Object.entries(res)) { const t = inv.tiles?.[f.replace('.glb', '')]; if (t?.near) t.near.bytes = r.after; } fs.writeFileSync(invF, JSON.stringify(inv, null, 1)); }
  const b = Object.values(res).reduce((a, r) => a + r.before, 0), a = Object.values(res).reduce((s, r) => s + r.after, 0);
  console.log(`DONE ${Object.keys(res).length} tiles ${(b / 1e6).toFixed(2)} -> ${(a / 1e6).toFixed(2)} MB (+${(100 * (a - b) / b).toFixed(1)} %) in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
} else if (!isMainThread) {
  const { NodeIO } = await import('@gltf-transform/core');
  const { ALL_EXTENSIONS } = await import('@gltf-transform/extensions');
  const { dequantize, meshopt } = await import('@gltf-transform/functions');
  const { MeshoptDecoder, MeshoptEncoder } = await import('meshoptimizer');
  const { QUANT, MESHOPT_LEVEL } = await import('./tile_encoding.mjs');
  await MeshoptDecoder.ready; await MeshoptEncoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  parentPort.on('message', async (file) => {
    if (file === null) { process.exit(0); }
    const t0 = Date.now(), f = path.join(workerData.dir, file);
    const before = fs.statSync(f).size;
    const doc = await io.read(f);
    for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) { if (p.getAttribute('_AO')) p.setAttribute('_AO', null); if (p.getAttribute('_AOF')) p.setAttribute('_AOF', null); }
    await doc.transform(dequantize());
    const st = bakeAO(doc);
    await doc.transform(meshopt({ encoder: MeshoptEncoder, level: MESHOPT_LEVEL, ...QUANT }));
    const bin = await io.writeBinary(doc);
    fs.writeFileSync(f + '.tmp', bin); fs.renameSync(f + '.tmp', f);
    parentPort.postMessage({ file, before, after: bin.byteLength, ms: Date.now() - t0, ...st });
  });
}
