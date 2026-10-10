/**
 * node/tap.mjs - run the REAL apartment generator over the REAL catalog in Node (no browser, no map; the loader is the rust study's, copied
 * from PR #436 experiments/rust-mesh/profile) and hand every wall piece the cell tiler cuts to a callback.
 *   const { totalTriangles, pieces } = await tapCatalog(piece => ...)
 * A piece: { spec, band, sk (the recipe skin), ctx, skin (the resolved skin: windows after the band's openings), len, z0, z1, cut, inset, tris, W }.
 * Needs THREE_JS = a three@0.159.0 three.min.js (the file index.html loads); default: the renderer study's cached copy.
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
process.env.THREE_JS ||= path.join(os.homedir(), 'flyover-private/renderer-2026-10-09/libs/three.min.js');
const { loadApp } = await import('./app-env.mjs');
export async function tapCatalog(fn, { only = null, quads = false, setup = null } = {}) {
  if (only) process.env.ONLY = only;
  globalThis.__TFQ = quads;
  const { A, specs, realError } = await loadApp({});
  if (setup) await setup({ A, specs });
  let n = 0;
  globalThis.__TF = rec => { n++; fn(rec); };
  const g = await A.build(specs);
  let tris = 0; g.traverse(o => { if (o.isMesh) tris += o.geometry.index.count / 3; });
  return { totalTriangles: tris, pieces: n, specs, counts: { ...A.count } };
}
