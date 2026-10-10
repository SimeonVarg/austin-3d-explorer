// END TO END, no browser: the REAL generator over the whole 198-building catalog, built in any of four ways, then checked against the sha256
// the unpacked JS build recorded in expected.json (profile/record-stream.mjs). A packed mesh is first decoded the way VERT decodes it.
//   THREE_JS=... [REAL_NIGHT=1] [WASM=<meshkernel.wasm>] [PACK=0] [RESERVE=<vertices>] [JSON=1] node profile/packed-end-to-end.mjs <streamDir with expected.json>
//     default                  JS vertex store, ?packverts=1                (what shipped before the Rust packed store)
//     WASM=wasm/meshkernel.wasm  the Rust store, ?rustbuilder=1&packverts=1  (WASM must point at the module; RESERVE is the vertex-count hint)
//     PACK=0                   the unpacked layout (with WASM: the Rust unpacked store)
//     JSON=1                   one JSON line (wall ms, cpu ms, peak RSS, tables, decode result) for profile/packed-bench.mjs
// Record the stream with the same REAL_NIGHT setting you run with: the stand-in night module makes 1,266 tones, the real one 14,719.
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
const PACKED = process.env.PACK !== '0', WASM = process.env.WASM || null;
if (PACKED) process.env.EXTRA_Q = (process.env.EXTRA_Q || '') + '&packverts=1';
const { loadApp } = await import('./app-env.mjs');
const out = (...a) => process.stdout.write(a.join(' ') + '\n');   // app-env.mjs mutes console.log
const dir = process.argv[2]; if (!dir) throw new Error('usage: packed-end-to-end.mjs <dir with expected.json>');
const expected = JSON.parse(fs.readFileSync(path.join(dir, 'expected.json'), 'utf8')).meshes[0].sha;
const { A, specs } = await loadApp({ wasm: WASM });
const cpuNow = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };
const t0 = performance.now(), c0 = cpuNow(), g = await A.build(specs), ms = performance.now() - t0, cpu = cpuNow() - c0;
const sha = a => crypto.createHash('sha256').update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest('hex');
const meshes = []; g.traverse(o => { if (o.isMesh) meshes.push(o); });
if (meshes.length !== 1) throw new Error('expected one mesh, got ' + meshes.length);
const geo = meshes[0].geometry;
let got, V, tables = null, ok = true, info = {};
if (PACKED) {
  const T = geo.userData.pack, w = geo.attributes.aPack.array; V = w.length / 2;
  if (!T) throw new Error('the mesh has no userData.pack: the build fell back to the unpacked layout (a table overflowed?)');
  const B = globalThis.slopes.packInfo().toneBits, TONES = 2 ** B, NLOW = 2 ** (15 - B), dec = { normal: new Float32Array(V * 3), cDay: new Uint8Array(V * 3), cGold: new Uint8Array(V * 3), cNight: new Uint8Array(V * 3), aFacet: new Uint8Array(V), aSurface: new Float32Array(V * 4) };
  for (let v = 0; v < V; v++) {
    const lo = w[v * 2], hi = w[v * 2 + 1], tone = lo % TONES, rest = Math.floor(lo / TONES), nid = hi * NLOW + (rest >> 1), t = tone * 16;
    dec.aFacet[v] = rest & 1;
    for (let k = 0; k < 3; k++) { dec.cDay[v * 3 + k] = Math.round(T.tones[t + k] * 255); dec.cGold[v * 3 + k] = Math.round(T.tones[t + 4 + k] * 255); dec.cNight[v * 3 + k] = Math.round(T.tones[t + 8 + k] * 255); dec.normal[v * 3 + k] = T.normals[nid * 4 + k]; }
    for (let k = 0; k < 4; k++) dec.aSurface[v * 4 + k] = T.tones[t + 12 + k];
  }
  got = { position: sha(geo.attributes.position.array), index: sha(geo.index.array), normal: sha(dec.normal), cDay: sha(dec.cDay), cGold: sha(dec.cGold), cNight: sha(dec.cNight), aFacet: sha(dec.aFacet), aSurface: sha(dec.aSurface) };
  tables = { nTones: T.nTones, nNormals: T.nNormals, tonesSha: sha(T.tones.subarray(0, T.nTones * 16)), normalsSha: sha(T.normals.subarray(0, T.nNormals * 4)), keysSha: crypto.createHash('sha256').update([...T.toneOf.entries()].map(([k, v]) => v + '=' + k).join('\n')).digest('hex'), wordsSha: sha(geo.attributes.aPack.array) };
} else {
  V = geo.attributes.position.count;
  got = { index: sha(geo.index.array) }; for (const k in geo.attributes) got[k] = sha(geo.attributes[k].array);
}
const lines = [];
// a Rust run that quietly fell back to the JS store would pass the sha check and prove nothing
const ri = WASM ? globalThis.slopes.rustInfo() : null;
if (ri && !(ri.state === 'ready' && ri.builds >= 1 && !ri.fellBack)) { ok = false; lines.push('MISMATCH the Rust builder was not used: ' + JSON.stringify(ri)); }
for (const k of Object.keys(got)) { const same = got[k] === expected[k]; if (!same) ok = false; lines.push(`${same ? 'MATCH   ' : 'MISMATCH'} ${k}`); }
const bytes = a => a.byteLength, geomBytes = Object.values(geo.attributes).reduce((s, a) => s + bytes(a.array), 0) + bytes(geo.index.array);
const store = (WASM ? 'rust' : 'js') + (PACKED ? '-packed' : '-unpacked');
const res = { store, ok, wallMs: Math.round(ms), cpuMs: Math.round(cpu), maxRssMB: Math.round(process.resourceUsage().maxRSS / 1024), vertices: V, geometryMiB: +(geomBytes / 1048576).toFixed(1), tables, rust: ri, load: (await import('node:os')).loadavg()[0], decode: got };
if (process.env.JSON) { out(JSON.stringify(res)); process.exit(ok ? 0 : 1); }
lines.forEach(l => out(l));
if (ri) out(`Rust builder: state ${ri.state}, ${ri.builds} module instance(s), compile ${ri.compileMs} ms, fell back ${ri.fellBack || 0} time(s)`);
out(`${store}: ${V} vertices` + (tables ? `, ${tables.nTones} tones, ${tables.nNormals} normals` : '') + `; geometry ${res.geometryMiB} MiB; build ${(ms / 1000).toFixed(1)} s wall, ${(cpu / 1000).toFixed(1)} s cpu; peak RSS ${res.maxRssMB} MB`);
out(ok ? (PACKED ? 'PASS: every packed vertex decodes to the byte the unpacked build produced' : 'PASS: identical to the recorded unpacked build') : 'FAIL');
process.exit(ok ? 0 : 1);
