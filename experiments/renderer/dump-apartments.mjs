/**
 * dump-apartments.mjs - load the real app once, wait for `slopesApartments.count.done`, and write the
 * built geometry of the authored apartment buildings (vertex arrays, index arrays, culling ranges, the
 * material's uniform values) to binary files OUTSIDE the repo.
 *
 *   node ~/Projects/astra-pipe/tools/gpu-run.mjs --label renderer -- node experiments/renderer/dump-apartments.mjs
 *
 * Output (RENDERER_OUT, default ~/flyover-private/renderer-2026-10-09/):
 *   apartments.bin   every array, 4-byte aligned, back to back
 *   apartments.json  the manifest: per mesh, per attribute { offset, bytes, type, itemSize, count, normalized }
 *
 * Flags used on the page, so the dump is the geometry and nothing else:
 *   aptcull=0        every building's triangles are in the index (no culling groups)
 *   facadefilter=0   no textured facade meshes (those use a second material the prototype does not draw)
 *   campuslandscape=0 / slopes extras stay on; only the apartments group is read.
 * Bytes leave the page by POST to a small node server started here (a 500 MB array through the
 * DevTools protocol would take minutes).
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { openApp, waitReady, PRIVATE } from './lib/app.mjs';

const PORT = 8476;
const BIN = path.join(PRIVATE, 'apartments.bin');
const fd = fs.openSync(BIN, 'w');
let written = 0;
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.end(); return; }
  const off = +new URL(req.url, 'http://x').searchParams.get('off');
  const chunks = [];
  req.on('data', d => chunks.push(d));
  req.on('end', () => { const b = Buffer.concat(chunks); fs.writeSync(fd, b, 0, b.length, off); written += b.length; res.end('ok'); });
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

const { browser, page, errors, t0 } = await openApp({ query: 'aptcull=0&facadefilter=0' });
try {
  const ms = await waitReady(page, t0);
  console.log('ready', JSON.stringify(ms));
  await page.waitForTimeout(3000);
  const manifest = await page.evaluate(async (port) => {
    const A = window.slopesApartments, S = window.slopes;
    const man = { when: new Date().toISOString(), three: window.THREE.REVISION, origin: S.origin, count: { ...A.count, names: A.count.names.length },
      meshes: [], skipped: [], uniforms: {}, buildings: A.built };
    let off = 0;
    const post = async (typed) => {
      const start = off, bytes = typed.byteLength;
      const u8 = new Uint8Array(typed.buffer, typed.byteOffset, bytes);
      const STEP = 32 * 1024 * 1024;
      for (let o = 0; o < bytes; o += STEP) {
        await fetch(`http://127.0.0.1:${port}/up?off=${start + o}`, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: u8.subarray(o, Math.min(bytes, o + STEP)) });
      }
      off += (bytes + 3) & ~3;
      return start;
    };
    const typeName = a => a.constructor.name;
    const meshes = [];
    A.group.traverse(o => { if (o.isMesh) meshes.push(o); });
    let first = true;
    for (const m of meshes) {
      const g = m.geometry, mat = Array.isArray(m.material) ? m.material[0] : m.material;
      if (mat.defines && mat.defines.FACADE_FILTER) { man.skipped.push({ name: m.name, why: 'facade filter material', tris: g.index ? g.index.count / 3 : 0 }); continue; }
      const rec = { name: m.name, parent: m.parent && m.parent.name, vertexCount: g.attributes.position.count, attrs: {}, index: null, cull: null,
        matrix: Array.from(m.matrixWorld.elements), side: mat.side, transparent: mat.transparent, depthWrite: mat.depthWrite, matName: mat.name, defines: mat.defines || null };
      for (const [k, v] of Object.entries(g.attributes)) {
        let arr = v.array; if (!arr && v.data) arr = v.data.array;
        if (!arr) { rec.attrs[k] = { missing: true }; continue; }
        const off0 = await post(arr);
        rec.attrs[k] = { offset: off0, bytes: arr.byteLength, type: typeName(arr), itemSize: v.itemSize, count: v.count, normalized: !!v.normalized, interleaved: !!v.isInterleavedBufferAttribute };
      }
      if (g.index) { const arr = g.index.array; const off0 = await post(arr); rec.index = { offset: off0, bytes: arr.byteLength, type: typeName(arr), count: g.index.count }; }
      const c = m.userData.cull;
      if (c) {
        rec.cull = { n: c.n, total: c.total };
        rec.cull.sph = { offset: await post(c.sph), bytes: c.sph.byteLength, type: typeName(c.sph) };
        rec.cull.start = { offset: await post(c.start), bytes: c.start.byteLength, type: typeName(c.start) };
        rec.cull.count = { offset: await post(c.count), bytes: c.count.byteLength, type: typeName(c.count) };
      }
      if (first) {
        first = false;
        for (const [k, u] of Object.entries(mat.uniforms || {})) {
          const v = u.value;
          if (typeof v === 'number') man.uniforms[k] = v;
          else if (v && typeof v === 'object' && 'x' in v) man.uniforms[k] = ['x', 'y', 'z', 'w'].filter(c => c in v).map(c => v[c]);
          else if (v && v.isColor) man.uniforms[k] = [v.r, v.g, v.b];
        }
      }
      man.meshes.push(rec);
    }
    man.totalBytes = off;
    return man;
  }, PORT);
  fs.writeFileSync(path.join(PRIVATE, 'apartments.json'), JSON.stringify(manifest, null, 1));
  let verts = 0, idx = 0;
  for (const m of manifest.meshes) { verts += m.vertexCount; idx += m.index ? m.index.count : 0; }
  console.log(`wrote ${BIN}: ${(written / 1048576).toFixed(1)} MB of arrays, ${manifest.meshes.length} meshes, ${verts} vertices, ${idx / 3} triangles; skipped ${manifest.skipped.length}`);
  console.log('attributes of mesh 0:', JSON.stringify(Object.fromEntries(Object.entries(manifest.meshes[0].attrs).map(([k, v]) => [k, `${v.type} x${v.itemSize}${v.normalized ? ' norm' : ''}`]))));
  console.log('errors', errors.slice(0, 5));
} finally { await browser.__done(); fs.closeSync(fd); server.close(); }
