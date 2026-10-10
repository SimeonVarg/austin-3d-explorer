// "Best effort" JS: the same algorithm as js/slopes.js build(), but fed straight from the Float64Array stream with
// no per-call arrays, no closures per vertex, one inlined push. This is the honest competitor for the Rust
// module: it shows how much of the win is "stop allocating" (available in plain JS today) and how much is Rust.
import { REC } from './common.mjs';
const SQ = Math.sqrt;

/**
 * initialCapacity: starting size (the app uses 65536 and doubles). trim: true copies each array to its exact length like geometry()
 * does (slice); false returns views (subarray). A caller that knows the vertex count in advance can pass it and skip every growth copy.
 */
export function runTyped(tonesBytes, stream, records, initialCapacity = 1 << 16, trim = true) {
  let cap = initialCapacity, nV = 0, nI = 0, tris = 0, facet = 0;
  let P = new Float32Array(cap * 3), NM = new Float32Array(cap * 3), CD = new Uint8Array(cap * 3), CG = new Uint8Array(cap * 3), CN = new Uint8Array(cap * 3);
  let FC = new Uint8Array(cap), SF = new Float32Array(cap * 4), icap = cap * 2, IDX = new Uint32Array(icap);
  const grow = () => {
    cap *= 2;
    const f = (a, k) => { const b = new Float32Array(cap * k); b.set(a); return b; }, u = (a, k) => { const b = new Uint8Array(cap * k); b.set(a); return b; };
    P = f(P, 3); NM = f(NM, 3); CD = u(CD, 3); CG = u(CG, 3); CN = u(CN, 3); FC = u(FC, 1); SF = f(SF, 4);
  };
  const igrow = () => { icap *= 2; const b = new Uint32Array(icap); b.set(IDX); IDX = b; };
  const { bytes, surf } = tonesBytes;   // bytes: Uint8Array(9 * n), surf: Float32Array(4 * n)
  // V8's Math.hypot (Kahan-summed), inlined so the result is bit-identical
  let nx = 0, ny = 0, nz = 0;
  const hyp = (x, y, z) => {
    x = Math.abs(x); y = Math.abs(y); z = Math.abs(z);
    const m = Math.max(x, y, z); if (m === 0) return 0;
    let sum = 0, comp = 0, n, s, p;
    n = x / m; s = n * n - comp; p = sum + s; comp = (p - sum) - s; sum = p;
    n = y / m; s = n * n - comp; p = sum + s; comp = (p - sum) - s; sum = p;
    n = z / m; s = n * n - comp; p = sum + s; comp = (p - sum) - s; sum = p;
    return SQ(sum) * m;
  };
  // normal of (a,b,c) -> nx,ny,nz ; returns false if degenerate
  const faceN = (ax, ay, az, bx, by, bz, cx, cy, cz) => {
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
    const L = hyp(x, y, z); if (L < 1e-9) return false;
    nx = x / L; ny = y / L; nz = z / L; return true;
  };
  const push = (x, y, z, ax, ay, az, col) => {
    if (nV >= cap) grow();
    const i3 = nV * 3, i4 = nV * 4, t = col * 9;
    P[i3] = x; P[i3 + 1] = y; P[i3 + 2] = z; NM[i3] = ax; NM[i3 + 1] = ay; NM[i3 + 2] = az;
    CD[i3] = bytes[t]; CD[i3 + 1] = bytes[t + 1]; CD[i3 + 2] = bytes[t + 2];
    CG[i3] = bytes[t + 3]; CG[i3 + 1] = bytes[t + 4]; CG[i3 + 2] = bytes[t + 5];
    CN[i3] = bytes[t + 6]; CN[i3 + 1] = bytes[t + 7]; CN[i3 + 2] = bytes[t + 8];
    FC[nV] = facet;
    const s = col * 4; SF[i4] = surf[s]; SF[i4 + 1] = surf[s + 1]; SF[i4 + 2] = surf[s + 2]; SF[i4 + 3] = surf[s + 3];
    return nV++;
  };
  const emit = (a, b, c) => { while (nI + 3 > icap) igrow(); IDX[nI++] = a; IDX[nI++] = b; IDX[nI++] = c; tris++; };
  const tri = (ax, ay, az, bx, by, bz, cx, cy, cz, col, hw, wx, wy, wz) => {
    if (!faceN(ax, ay, az, bx, by, bz, cx, cy, cz)) return;
    let x = nx, y = ny, z = nz;
    if (hw && x * wx + y * wy + z * wz < 0) { let t = bx; bx = cx; cx = t; t = by; by = cy; cy = t; t = bz; bz = cz; cz = t; x = -x; y = -y; z = -z; }
    const i = push(ax, ay, az, x, y, z, col), j = push(bx, by, bz, x, y, z, col), k = push(cx, cy, cz, x, y, z, col); emit(i, j, k);
  };
  for (let r = 0, o = 0; r < records; r++, o += REC) {
    const op = stream[o];
    if (op === 3) { facet = stream[o + 27] !== 0 ? 1 : 0; continue; }
    const col = stream[o + 1], hw = stream[o + 2] !== 0, wx = stream[o + 3], wy = stream[o + 4], wz = stream[o + 5];
    const ax = stream[o + 6], ay = stream[o + 7], az = stream[o + 8], bx = stream[o + 9], by = stream[o + 10], bz = stream[o + 11], cx = stream[o + 12], cy = stream[o + 13], cz = stream[o + 14];
    if (op === 0) { tri(ax, ay, az, bx, by, bz, cx, cy, cz, col, hw, wx, wy, wz); continue; }
    if (op === 1) {
      const dx = stream[o + 15], dy = stream[o + 16], dz = stream[o + 17];
      const ok1 = faceN(ax, ay, az, bx, by, bz, cx, cy, cz); const n1x = nx, n1y = ny, n1z = nz;
      const ok2 = ok1 && faceN(ax, ay, az, cx, cy, cz, dx, dy, dz);
      if (!ok1 || !ok2 || (n1x * nx + n1y * ny + n1z * nz) < 1 - 1e-12) {
        tri(ax, ay, az, bx, by, bz, cx, cy, cz, col, hw, wx, wy, wz); tri(ax, ay, az, cx, cy, cz, dx, dy, dz, col, hw, wx, wy, wz); continue;
      }
      let x = n1x, y = n1y, z = n1z, flip = false;
      if (hw && x * wx + y * wy + z * wz < 0) { x = -x; y = -y; z = -z; flip = true; }
      const i = push(ax, ay, az, x, y, z, col), j = push(bx, by, bz, x, y, z, col), k = push(cx, cy, cz, x, y, z, col), l = push(dx, dy, dz, x, y, z, col);
      if (flip) { emit(i, k, j); emit(i, l, k); } else { emit(i, j, k); emit(i, k, l); }
      continue;
    }
    // triN
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    let x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
    const L = hyp(x, y, z); if (L < 1e-9) continue;
    x /= L; y /= L; z /= L;
    let nax = stream[o + 18], nay = stream[o + 19], naz = stream[o + 20], nbx = stream[o + 21], nby = stream[o + 22], nbz = stream[o + 23], ncx = stream[o + 24], ncy = stream[o + 25], ncz = stream[o + 26];
    const avx = nax + nbx + ncx, avy = nay + nby + ncy, avz = naz + nbz + ncz;
    let b0x = bx, b0y = by, b0z = bz, c0x = cx, c0y = cy, c0z = cz;
    if (x * avx + y * avy + z * avz < 0) { b0x = cx; b0y = cy; b0z = cz; c0x = bx; c0y = by; c0z = bz; let t = nbx; nbx = ncx; ncx = t; t = nby; nby = ncy; ncy = t; t = nbz; nbz = ncz; ncz = t; }
    const i = push(ax, ay, az, nax, nay, naz, col), j = push(b0x, b0y, b0z, nbx, nby, nbz, col), k = push(c0x, c0y, c0z, ncx, ncy, ncz, col); emit(i, j, k);
  }
  const cut = trim ? (a, n) => a.slice(0, n) : (a, n) => a.subarray(0, n);
  return { position: cut(P, nV * 3), normal: cut(NM, nV * 3), cDay: cut(CD, nV * 3), cGold: cut(CG, nV * 3), cNight: cut(CN, nV * 3),
    aFacet: cut(FC, nV), aSurface: cut(SF, nV * 4), index: cut(IDX, nI), triangles: tris };
}
