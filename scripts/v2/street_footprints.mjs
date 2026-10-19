// Where every Blender model actually stands, as a grid, for scripts/v2/street_mask.py (the aerial's leaning-building mask).
//   node scripts/v2/street_footprints.mjs OUT.bin x0 z0 x1 z1 cell_m
// Reads every lod0 tile in v2/tiles/manifest.json, takes each triangle that is above 0.5 m (a roof, a wall, seating; not the
// ground the builders modelled round a building), and fills its ground projection into a Uint16 grid of building numbers
// (1-based, in the order of the manifest's buildings; 0 = none). Header: Int32 cols, rows, then Float32 x0, z0, cell, then the
// grid (row = z, from x0 / z0). A small sidecar OUT.json lists the building slugs and tops in that order.
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';

const [out, ...nums] = process.argv.slice(2);
const [X0, Z0, X1, Z1, CELL] = nums.map(Number);
const ABOVE_M = 0.5;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'v2');
const man = JSON.parse(fs.readFileSync(path.join(root, 'tiles', 'manifest.json'), 'utf8'));
const slugs = Object.keys(man.buildings), num = new Map(slugs.map((s, i) => [s, i + 1]));
const cols = Math.ceil((X1 - X0) / CELL), rows = Math.ceil((Z1 - Z0) / CELL);
const grid = new Uint16Array(cols * rows);
let tris = 0;
function fill(ax, az, bx, bz, cx, cz, id) {
  const minx = Math.max(0, Math.floor((Math.min(ax, bx, cx) - X0) / CELL)), maxx = Math.min(cols - 1, Math.floor((Math.max(ax, bx, cx) - X0) / CELL));
  const minz = Math.max(0, Math.floor((Math.min(az, bz, cz) - Z0) / CELL)), maxz = Math.min(rows - 1, Math.floor((Math.max(az, bz, cz) - Z0) / CELL));
  const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
  if (Math.abs(d) < 1e-9) {   // a wall seen from above: mark the cells its edge passes through
    for (const [px, pz] of [[ax, az], [bx, bz], [cx, cz]]) { const i = Math.floor((px - X0) / CELL), j = Math.floor((pz - Z0) / CELL); if (i >= 0 && j >= 0 && i < cols && j < rows) grid[j * cols + i] = id; }
    return;
  }
  for (let j = minz; j <= maxz; j++) for (let i = minx; i <= maxx; i++) {
    const px = X0 + (i + 0.5) * CELL, pz = Z0 + (j + 0.5) * CELL;
    const l1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / d, l2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / d;
    if (l1 >= -0.02 && l2 >= -0.02 && l1 + l2 <= 1.02) grid[j * cols + i] = id;
  }
}
for (const t of man.tiles) {
  const doc = await io.read(path.join(root, t.lod0));
  await doc.transform(dequantize());
  const tileSlugs = doc.getRoot().getExtras().buildings || t.buildings;
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    const M = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const P = prim.getAttribute('POSITION'), B = prim.getAttribute('_BUILDING') || prim.getAttribute('_FINE'), I = prim.getIndices();
      if (!P || !B || !I) continue;
      const p = P.getArray(), b = B.getArray(), idx = I.getArray();
      const w = (k) => { const x = p[k * 3], y = p[k * 3 + 1], z = p[k * 3 + 2]; return [M[0] * x + M[4] * y + M[8] * z + M[12], M[1] * x + M[5] * y + M[9] * z + M[13], M[2] * x + M[6] * y + M[10] * z + M[14]]; };
      for (let k = 0; k < idx.length; k += 3) {
        const A = w(idx[k]), Bv = w(idx[k + 1]), C = w(idx[k + 2]);
        if (Math.max(A[1], Bv[1], C[1]) < ABOVE_M) continue;
        const id = num.get(tileSlugs[Math.round(b[idx[k] * B.getElementSize()])]) || 0;
        if (!id) continue;
        fill(A[0], A[2], Bv[0], Bv[2], C[0], C[2], id); tris++;
      }
    }
  }
}
const head = Buffer.alloc(20); head.writeInt32LE(cols, 0); head.writeInt32LE(rows, 4); head.writeFloatLE(X0, 8); head.writeFloatLE(Z0, 12); head.writeFloatLE(CELL, 16);
fs.writeFileSync(out, Buffer.concat([head, Buffer.from(grid.buffer)]));
fs.writeFileSync(out.replace(/\.bin$/, '') + '.json', JSON.stringify({ slugs, tops: slugs.map((s) => man.buildings[s].top || 0) }));
console.log(`${tris} triangles from ${man.tiles.length} tiles -> ${cols}x${rows} cells of ${CELL} m`);
