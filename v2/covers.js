// Which plain extrusions a Blender model stands over (2026-10-19 demo walk: two blank grey slabs inside the DKR model. They were
// L. Theo Bellmont Hall and another stadium outline that the model replaces but its manifest entry does not list.)
//
// The rule, for every tile and every building: a plain extrusion whose outline is COVER.HIDE_SHARE or more under the model is
// hidden while the model shows, whatever the manifest lists. "Under the model" is measured, not listed: the model's triangles that
// rise above COVER.MIN_Y_M are drawn onto a COVER.CELL_M grid seen from above (keeping the highest point in each cell), and the
// extrusion's outline (the camera's collision outlines, flycam.js CollisionField) is sampled on the same grid.
// Runs once per tile load, in a worker (covers-worker.js), never per frame. Plain functions, no three.js: the worker, main.js and
// scripts/verify/v2-demo-checks.mjs share them.
export const COVER = {
  ON: true,               // ?cover=0 turns it off (the check's "before")
  CELL_M: 2,              // grid cell, metres
  MIN_Y_M: 3,             // model parts lower than this (ground plates, plazas, kerbs) do not count as covering
  HIDE_SHARE: 0.5,        // an extrusion this much under a model is hidden with the model's own buildings
  NEAR_M: 200,            // outlines this far outside the tile's square are looked at too (a stadium reaches past its tile)
};

// One mesh's position data as plain arrays (a three.js mesh in, transferable arrays out): array, offset and stride in elements,
// the normalised-integer scale, the world matrix, and the triangle index.
export function meshArrays(o) {
  const a = o.geometry.attributes.position, inter = !!a.isInterleavedBufferAttribute;
  const src = inter ? a.data.array : a.array, stride = inter ? a.data.stride : a.itemSize, offset = inter ? a.offset : 0;
  let k = 1;
  if (a.normalized) k = src instanceof Int16Array ? 1 / 32767 : src instanceof Uint16Array ? 1 / 65535 : src instanceof Int8Array ? 1 / 127 : src instanceof Uint8Array ? 1 / 255 : 1;
  return { pos: src.slice(0), offset, stride, count: a.count, k, signed: a.normalized && (src instanceof Int16Array || src instanceof Int8Array),
    m: Float64Array.from(o.matrixWorld.elements), idx: o.geometry.index ? o.geometry.index.array.slice(0) : null };
}
export function objectArrays(obj) {
  obj.updateMatrixWorld(true);
  const out = [];
  obj.traverse((o) => { if (o.isMesh && o.geometry?.attributes?.position) out.push(meshArrays(o)); });
  return out;
}

// The model seen from above: for each COVER.CELL_M cell, the highest point of the model there (whole metres, 0 = nothing above MIN_Y_M).
export function rasterOf(meshes, C = COVER.CELL_M, minY = COVER.MIN_Y_M) {
  const W = [];
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const M of meshes) {
    const { pos, offset, stride, count, k, signed, m: e } = M, w = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const b = offset + i * stride;
      let x = pos[b] * k, y = pos[b + 1] * k, z = pos[b + 2] * k;
      if (signed) { x = Math.max(-1, x); y = Math.max(-1, y); z = Math.max(-1, z); }
      const X = e[0] * x + e[4] * y + e[8] * z + e[12], Y = e[1] * x + e[5] * y + e[9] * z + e[13], Z = e[2] * x + e[6] * y + e[10] * z + e[14];
      w[i * 3] = X; w[i * 3 + 1] = Y; w[i * 3 + 2] = Z;
      if (Y > minY) { if (X < x0) x0 = X; if (X > x1) x1 = X; if (Z < z0) z0 = Z; if (Z > z1) z1 = Z; }
    }
    W.push({ w, idx: M.idx, n: count });
  }
  if (!(x1 > x0)) return null;
  x0 -= C; z0 -= C;
  const nx = Math.ceil((x1 - x0) / C) + 2, nz = Math.ceil((z1 - z0) / C) + 2, h = new Uint8Array(nx * nz);
  const put = (i, j, y) => { if (i >= 0 && j >= 0 && i < nx && j < nz) { const q = j * nx + i, v = Math.min(255, Math.max(1, Math.ceil(y))); if (v > h[q]) h[q] = v; } };
  const edge = (ax, az, bx, bz, y) => {
    const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L / (C * 0.5)));
    for (let s = 0; s <= n; s++) put(Math.floor((ax + (bx - ax) * s / n - x0) / C), Math.floor((az + (bz - az) * s / n - z0) / C), y);
  };
  for (const { w, idx, n } of W) {
    const T = idx ? idx.length : n;
    for (let t = 0; t + 2 < T; t += 3) {
      const a = idx ? idx[t] : t, b = idx ? idx[t + 1] : t + 1, c = idx ? idx[t + 2] : t + 2;
      const ay = w[a * 3 + 1], by = w[b * 3 + 1], cy = w[c * 3 + 1], y = Math.max(ay, by, cy);
      if (y <= minY) continue;
      const ax = w[a * 3], az = w[a * 3 + 2], bx = w[b * 3], bz = w[b * 3 + 2], cx = w[c * 3], cz = w[c * 3 + 2];
      const i0 = Math.floor((Math.min(ax, bx, cx) - x0) / C), i1 = Math.floor((Math.max(ax, bx, cx) - x0) / C);
      const j0 = Math.floor((Math.min(az, bz, cz) - z0) / C), j1 = Math.floor((Math.max(az, bz, cz) - z0) / C);
      if ((i1 - i0 + 1) * (j1 - j0 + 1) <= 4) { for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) put(i, j, y); continue; }
      edge(ax, az, bx, bz, y); edge(bx, bz, cx, cz, y); edge(cx, cz, ax, az, y);
      const area = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
      if (Math.abs(area) < 1e-6) continue;
      const sg = area > 0 ? 1 : -1;
      for (let j = j0; j <= j1; j++) {
        const pz = z0 + (j + 0.5) * C;
        for (let i = i0; i <= i1; i++) {
          const px = x0 + (i + 0.5) * C;
          if (((bx - ax) * (pz - az) - (bz - az) * (px - ax)) * sg >= 0 && ((cx - bx) * (pz - bz) - (cz - bz) * (px - bx)) * sg >= 0 &&
            ((ax - cx) * (pz - cz) - (az - cz) * (px - cx)) * sg >= 0) put(i, j, y);
        }
      }
    }
  }
  return { x0, z0, nx, nz, C, h };
}

// The outlines near a tile, from the collision field, as plain data: [{ id, rings: [[x, z, x, z, ...], ...] }] (outer ring first)
export function outlinesNear(field, bounds, near = COVER.NEAR_M) {
  const [bx0, bz0, bx1, bz1] = bounds, C = field.coords, out = [], seen = new Set();
  // (a campus outline is listed under its full id and its eight-hex prefix, flycam.js: each outline once, under the first)
  for (const [id, polys] of field.byId) for (const e of polys) {
    if (seen.has(e)) continue; seen.add(e);
    if (e.maxX < bx0 - near || e.minX > bx1 + near || e.maxZ < bz0 - near || e.minZ > bz1 + near) continue;
    out.push({ id, rings: e.rings.map(([a, b]) => Float64Array.from(C.subarray(a * 2, b * 2))) });
  }
  return out;
}

// Every outline id under the raster: [{ id, share, top }], share = part of the outline under the model, top = the model's highest
// point over it. The WHOLE outline is sampled on the raster's cell centres (cells outside the raster count as not covered); a big
// outline is sampled with a coarser stride so one call stays cheap.
export function coveredBy(raster, outlines) {
  if (!raster) return [];
  const { x0, z0, nx, nz, C, h } = raster, X1 = x0 + nx * C, Z1 = z0 + nz * C;
  const acc = new Map();
  for (const o of outlines) {
    const R = o.rings[0];
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < R.length; i += 2) { minX = Math.min(minX, R[i]); maxX = Math.max(maxX, R[i]); minZ = Math.min(minZ, R[i + 1]); maxZ = Math.max(maxZ, R[i + 1]); }
    if (maxX < x0 || minX > X1 || maxZ < z0 || minZ > Z1) continue;
    const flat = o.rings;
    const i0 = Math.floor((minX - x0) / C), i1 = Math.floor((maxX - x0) / C), j0 = Math.floor((minZ - z0) / C), j1 = Math.floor((maxZ - z0) / C);
    const st = Math.max(1, Math.ceil(Math.sqrt(((i1 - i0 + 1) * (j1 - j0 + 1)) / 20000)));
    let n = 0, u = 0, top = 0;
    for (let j = j0; j <= j1; j += st) for (let i = i0; i <= i1; i += st) {
      const x = x0 + (i + 0.5) * C, z = z0 + (j + 0.5) * C;
      let inside = true;
      for (let k = 0; k < flat.length && inside; k++) {
        const r = flat[k]; let c = false;
        for (let a = 0, b = r.length - 2; a < r.length; b = a, a += 2) {
          const px = r[a], pz = r[a + 1], qx = r[b], qz = r[b + 1];
          if ((pz > z) !== (qz > z) && x < (qx - px) * (z - pz) / (qz - pz) + px) c = !c;
        }
        inside = k === 0 ? c : !c;
      }
      if (!inside) continue;
      n++;
      const v = i >= 0 && j >= 0 && i < nx && j < nz ? h[j * nx + i] : 0;
      if (v) { u++; if (v > top) top = v; }
    }
    if (!n) { n = 1; const i = Math.floor(((minX + maxX) / 2 - x0) / C), j = Math.floor(((minZ + maxZ) / 2 - z0) / C), v = i >= 0 && j >= 0 && i < nx && j < nz ? h[j * nx + i] : 0; if (v) { u = 1; top = v; } }
    const a = acc.get(o.id) || acc.set(o.id, { n: 0, u: 0, top: 0 }).get(o.id);
    a.n += n; a.u += u; a.top = Math.max(a.top, top);
  }
  const out = [];
  for (const [id, a] of acc) if (a.u) out.push({ id, share: a.u / a.n, top: a.top });
  return out;
}

// main-thread helpers (the verify script; main.js uses the worker)
export function modelRaster(obj) { return rasterOf(objectArrays(obj)); }
export function coveredIds(raster, field) {
  if (!raster || !field?.ready) return [];
  const b = [raster.x0, raster.z0, raster.x0 + raster.nx * raster.C, raster.z0 + raster.nz * raster.C];
  return coveredBy(raster, outlinesNear(field, b, 0));
}
