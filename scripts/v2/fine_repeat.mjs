// Fine repeats: per palette entry of a tile part, how fine its surfaces are and what they average to with what lies round them.
//
// Why (rule 15, CLAUDE.md; #526 put the full Blender models at every distance): a tile is one palette material, so the app cannot
// tell a fin from a wall. Fins, mullions, window panes and the wall strips between them are geometry; once they are thinner than a
// pixel or two on screen they flicker as they cross the pixel grid. What a perfect (supersampled) picture shows there is their AREA
// AVERAGE with their surround. So the builder writes, per palette entry:
//   size_m  the entry's typical feature width (area-weighted median of its triangles' widths, width = 2 x area / longest edge);
//   mean    the area-weighted mean linear colour of ALL surfaces within RADIUS of that entry's surfaces (its surround, itself included).
// and the app (v2/tiles.js) moves each entry toward its mean by its own on-screen footprint: sharp while a feature spans a few
// pixels, its true average once it cannot be drawn steadily. A plain wall's mean is its own colour (nothing changes); a window
// pane's and the wall strips' between windows is the window-wall mix. No list of buildings and no names: geometry only.
//
// Stored in the tile mesh's extras (glTF) as { fine: { w, block, n, entries: [[size_m, r, g, b], ...] } }, entry i = palette block i
// (u = (i + 0.5) / n x (w - pad) / w, as glTF Transform's palette writes it). GPU cost: one 1-row texture per tile part.
import { getPixels } from 'ndarray-pixels';

// ── PARAMETERS ──
export const FINE = {
  RADIUS_K: 2.5,          // the surround is RADIUS_K x the entry's feature size ...
  RADIUS_MIN_M: 0.6,      // ... at least this ...
  RADIUS_MAX_M: 4.0,      // ... and at most this (a wall's surround is the windows next to it, not the whole block)
  SAMPLES: 1500,          // area-weighted sample triangles per entry for the surround mean
};

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

export async function fineData(doc) {
  const out = [];
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial(), tex = mat && mat.getBaseColorTexture();
      const uvA = prim.getAttribute('TEXCOORD_0');
      if (!tex || !uvA) continue;                             // one colour only (no palette): nothing to fade between
      const px = await getPixels(tex.getImage(), tex.getMimeType());
      const [w, h] = px.shape; const block = h;               // palette blocks are square, h = blockSize (power of two)
      const P = prim.getAttribute('POSITION').getArray(), UV = uvA.getArray();
      const I = prim.getIndices() ? prim.getIndices().getArray() : null;
      const nTri = (I ? I.length : P.length / 3) / 3;
      // how many entries: the largest block index used + 1 (n = keyCount); u = (i + .5)/n * (w-pad)/w  =>  i = floor(u * w / block)
      const tri = { e: new Int32Array(nTri), a: new Float32Array(nTri), wd: new Float32Array(nTri), c: new Float32Array(nTri * 3) };
      let n = 0;
      for (let t = 0; t < nTri; t++) {
        const ia = I ? I[t * 3] : t * 3, ib = I ? I[t * 3 + 1] : t * 3 + 1, ic = I ? I[t * 3 + 2] : t * 3 + 2;
        const e = Math.floor((UV[ia * 2] * w) / block); tri.e[t] = e; n = Math.max(n, e + 1);
        const ax = P[ia * 3], ay = P[ia * 3 + 1], az = P[ia * 3 + 2], bx = P[ib * 3], by = P[ib * 3 + 1], bz = P[ib * 3 + 2], cx = P[ic * 3], cy = P[ic * 3 + 1], cz = P[ic * 3 + 2];
        const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
        const area = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
        const L = Math.max(Math.hypot(ux, uy, uz), Math.hypot(vx, vy, vz), Math.hypot(cx - bx, cy - by, cz - bz));
        tri.a[t] = area; tri.wd[t] = L > 0 ? (2 * area) / L : 0;
        tri.c[t * 3] = (ax + bx + cx) / 3; tri.c[t * 3 + 1] = (ay + by + cy) / 3; tri.c[t * 3 + 2] = (az + bz + cz) / 3;
      }
      // entry colours (linear) from the palette image
      const col = [];
      for (let e = 0; e < n; e++) { const x = e * block + (block >> 1), y = block >> 1; col.push([0, 1, 2].map((k) => srgbToLinear(px.get(x, y, k) / 255))); }
      // feature size per entry: area-weighted median of triangle widths
      const byE = Array.from({ length: n }, () => []);
      for (let t = 0; t < nTri; t++) if (tri.a[t] > 0) byE[tri.e[t]].push(t);
      const size = byE.map((ts) => {
        if (!ts.length) return 0;
        const s = ts.slice().sort((p, q) => tri.wd[p] - tri.wd[q]); const tot = s.reduce((acc, t) => acc + tri.a[t], 0);
        let acc = 0; for (const t of s) { acc += tri.a[t]; if (acc >= tot / 2) return tri.wd[t]; } return tri.wd[s[s.length - 1]];
      });
      // a hash grid of triangle centroids (cell = RADIUS_MAX_M)
      const C = FINE.RADIUS_MAX_M, grid = new Map(), key = (x, y, z) => `${x},${y},${z}`;
      for (let t = 0; t < nTri; t++) { if (!(tri.a[t] > 0)) continue; const k = key(Math.floor(tri.c[t * 3] / C), Math.floor(tri.c[t * 3 + 1] / C), Math.floor(tri.c[t * 3 + 2] / C)); (grid.get(k) || grid.set(k, []).get(k)).push(t); }
      // surround mean per entry: area-weighted sample of its triangles, each gathers the area x colour of every triangle centroid within R
      let seed = 12345; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
      const entries = [];
      for (let e = 0; e < n; e++) {
        const ts = byE[e];
        if (!ts.length) { entries.push([0, ...col[e] || [0, 0, 0]]); continue; }
        const R = Math.min(FINE.RADIUS_MAX_M, Math.max(FINE.RADIUS_MIN_M, FINE.RADIUS_K * size[e])), R2 = R * R;
        const cum = new Float64Array(ts.length); let tot = 0; for (let i = 0; i < ts.length; i++) { tot += tri.a[ts[i]]; cum[i] = tot; }
        const m = [0, 0, 0]; let wsum = 0;
        const S = Math.min(FINE.SAMPLES, ts.length);
        for (let s = 0; s < S; s++) {
          let lo = 0, hi = ts.length - 1; const r = rnd() * tot; while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < r) lo = mid + 1; else hi = mid; }
          const t0 = ts[lo]; const x = tri.c[t0 * 3], y = tri.c[t0 * 3 + 1], z = tri.c[t0 * 3 + 2];
          const gx = Math.floor(x / C), gy = Math.floor(y / C), gz = Math.floor(z / C);
          const acc = [0, 0, 0]; let aw = 0;
          for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
            const cell = grid.get(key(gx + dx, gy + dy, gz + dz)); if (!cell) continue;
            for (const t of cell) { const ddx = tri.c[t * 3] - x, ddy = tri.c[t * 3 + 1] - y, ddz = tri.c[t * 3 + 2] - z; if (ddx * ddx + ddy * ddy + ddz * ddz > R2) continue;
              const a = Math.min(tri.a[t], R2 * Math.PI), c = col[tri.e[t]]; acc[0] += a * c[0]; acc[1] += a * c[1]; acc[2] += a * c[2]; aw += a; }
          }
          if (aw > 0) { for (let k = 0; k < 3; k++) m[k] += acc[k] / aw; wsum++; }
        }
        entries.push([+size[e].toFixed(4), ...(wsum ? m.map((v) => +(v / wsum).toFixed(5)) : col[e])]);
      }
      const fine = { w, block, n, entries };
      mesh.setExtras({ ...(mesh.getExtras() || {}), fine });
      out.push({ mesh: mesh.getName(), n, changed: entries.filter((en, i) => Math.hypot(en[1] - col[i][0], en[2] - col[i][1], en[3] - col[i][2]) > 0.01).length });
    }
  }
  return out;
}
