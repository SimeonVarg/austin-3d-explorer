// END TO END, no browser: the REAL generator over the whole 198-building catalog with ?packverts=1, then every packed vertex decoded the way
// VERT decodes it and compared (sha256, all 8 arrays) with the sha256 the unpacked build recorded in expected.json (profile/record-stream.mjs).
//   THREE_JS=... node profile/packed-end-to-end.mjs <streamDir with expected.json>
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
process.env.EXTRA_Q = '&packverts=1';
const { loadApp } = await import('./app-env.mjs');
const out = (...a) => process.stdout.write(a.join(' ') + '\n');   // app-env.mjs mutes console.log
const dir = process.argv[2]; if (!dir) throw new Error('usage: packed-end-to-end.mjs <dir with expected.json>');
const expected = JSON.parse(fs.readFileSync(path.join(dir, 'expected.json'), 'utf8')).meshes[0].sha;
const { A, specs } = await loadApp({});
const t0 = performance.now(), g = await A.build(specs), ms = performance.now() - t0;
const sha = a => crypto.createHash('sha256').update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest('hex');
const meshes = []; g.traverse(o => { if (o.isMesh) meshes.push(o); });
if (meshes.length !== 1) throw new Error('expected one mesh, got ' + meshes.length);
const geo = meshes[0].geometry, T = geo.userData.pack, w = geo.attributes.aPack.array, V = w.length / 2;
const TONES = 2 ** 13, NLOW = 4, dec = { normal: new Float32Array(V * 3), cDay: new Uint8Array(V * 3), cGold: new Uint8Array(V * 3), cNight: new Uint8Array(V * 3), aFacet: new Uint8Array(V), aSurface: new Float32Array(V * 4) };
for (let v = 0; v < V; v++) {
  const lo = w[v * 2], hi = w[v * 2 + 1], tone = lo % TONES, rest = Math.floor(lo / TONES), nid = hi * NLOW + (rest >> 1), t = tone * 16;
  dec.aFacet[v] = rest & 1;
  for (let k = 0; k < 3; k++) { dec.cDay[v * 3 + k] = Math.round(T.tones[t + k] * 255); dec.cGold[v * 3 + k] = Math.round(T.tones[t + 4 + k] * 255); dec.cNight[v * 3 + k] = Math.round(T.tones[t + 8 + k] * 255); dec.normal[v * 3 + k] = T.normals[nid * 4 + k]; }
  for (let k = 0; k < 4; k++) dec.aSurface[v * 4 + k] = T.tones[t + 12 + k];
}
const got = { position: sha(geo.attributes.position.array), index: sha(geo.index.array), normal: sha(dec.normal), cDay: sha(dec.cDay), cGold: sha(dec.cGold), cNight: sha(dec.cNight), aFacet: sha(dec.aFacet), aSurface: sha(dec.aSurface) };
let ok = true; for (const k of Object.keys(got)) { const same = got[k] === expected[k]; if (!same) ok = false; out(`${same ? 'MATCH   ' : 'MISMATCH'} ${k}`); }
const bytes = a => a.byteLength, packed = bytes(geo.attributes.position.array) + bytes(w) + bytes(geo.index.array), tables = T.nTones * 64 + T.nNormals * 16;
out(`${V} vertices, ${T.nTones} tones, ${T.nNormals} normals; geometry ${(packed / 1048576).toFixed(1)} MiB + tables ${(tables / 1048576).toFixed(2)} MiB (unpacked: 346.7 MiB); build ${(ms / 1000).toFixed(1)} s`);
out(ok ? 'PASS: every packed vertex decodes to the byte the unpacked build produced' : 'FAIL');
process.exit(ok ? 0 : 1);
