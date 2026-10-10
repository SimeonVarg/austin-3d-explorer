// Compare harness: replay a recorded stream through the app's own JS builder, the tuned-JS builder and the Rust/wasm
// builder, and demand IDENTICAL BYTES from all three (sha256 of every attribute array, and for the full catalog
// also the sha256 of what the real build produced inside the app, recorded in expected.json).
//
//   node compare.mjs [streamDir]            default: ./fixtures/moontower  (committed, 2 MB: the Moontower alone)
//   node compare.mjs <dir> --break          flips one bit in one input coordinate: must report MISMATCH and exit 1
//   WASM=path/to/other.wasm node compare.mjs ...
import crypto from 'node:crypto'; import path from 'node:path'; import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadStream, hexBytes } from './js/stream.mjs';
import { makeBuild, toneObjects, runApp } from './js/builder-app.mjs';
import { runTyped } from './js/builder-typed.mjs';
import { runWasm } from './js/builder-wasm.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(here, 'fixtures/moontower');
const wasmPath = process.env.WASM || path.join(here, 'dist/meshkernel.wasm');
const wasmModule = new WebAssembly.Module(fs.readFileSync(wasmPath));
function instantiateWithMemory() { return new WebAssembly.Instance(wasmModule, {}).exports; }
const slopesSource = fs.readFileSync(path.join(here, '../../js/slopes.js'), 'utf8');
const sha = a => crypto.createHash('sha256').update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest('hex');
const { stream, records, palette, expected } = loadStream(dir);
if (process.argv.includes('--break')) { const k = Math.floor(records / 2) * 28 + 6; stream[k] = stream[k] + 1e-9 * Math.max(1, Math.abs(stream[k])); console.log('(--break) nudged one coordinate of record', Math.floor(records / 2)); }

const tonesBytes = { bytes: new Uint8Array(palette.length * 9), surf: new Float32Array(palette.length * 4) };
palette.forEach((p, i) => { tonesBytes.bytes.set([...hexBytes(p.hex[0]), ...hexBytes(p.hex[1]), ...hexBytes(p.hex[2])], i * 9); if (p.surface) tonesBytes.surf.set(p.surface, i * 4); });

// ── part 2: the calls the apartment generator never makes but the shared builder serves to other generators
// (triN, facet runs, bent quads, degenerate triangles, wound-the-wrong-way quads). No in-app sha exists for
// these, so the app's own build() is the reference.
function synthetic() {
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const recs = []; const R = (op, col, want, a, b, c, d, na, nb, nc, flag) => { const r = new Float64Array(28); r[0] = op; r[1] = col; if (want) { r[2] = 1; r.set(want, 3); } for (const [o, v] of [[6, a], [9, b], [12, c], [15, d], [18, na], [21, nb], [24, nc]]) if (v) r.set(v, o); if (flag) r[27] = 1; recs.push(r); };
  for (let i = 0; i < 6000; i++) {
    const x = rnd() * 100, y = rnd() * 100, z = rnd() * 30, col = i % 5, k = rnd(), want = rnd() < 0.5 ? [0, 0, rnd() < 0.5 ? 1 : -1] : null;
    if (i % 97 === 0) R(3, 0, null, null, null, null, null, null, null, null, rnd() < 0.5);
    if (k < 0.35) R(1, col, want, [x, y, z], [x + 2, y, z], [x + 2, y + 3, z], [x, y + 3, z]);
    else if (k < 0.5) R(1, col, want, [x, y, z], [x + 2, y, z], [x + 2, y + 3, z + 0.5], [x, y + 3, z]);          // bent: takes the two-triangle path
    else if (k < 0.6) R(1, col, want, [x, y, z], [x + 2, y, z], [x + 2, y, z], [x, y + 3, z]);                       // degenerate half
    else if (k < 0.75) R(0, col, want, [x, y, z], [x + 1, y, z + 1], [x, y + 2, z]);
    else if (k < 0.8) R(0, col, want, [x, y, z], [x + 1, y, z], [x + 2, y, z]);                                      // collinear: dropped
    else R(2, col, null, [x, y, z], [x + 1, y, z], [x, y + 1, z + 1], null, [0, 0, 1], [0.6, 0, 0.8], [0, 0.6, 0.8]);
  }
  const s = new Float64Array(recs.length * 28); recs.forEach((r, i) => s.set(r, i * 28));
  const pal = [0, 1, 2, 3, 4].map(i => ({ hex: ['#' + (0x123456 + i * 0x0a1b2c).toString(16).padStart(6, '0'), '#abcdef', '#102030'], surface: i % 2 ? [4, 0.25 + i / 10, 0.5, 0.75] : null }));
  return { stream: s, records: recs.length, palette: pal };
}
{
  const syn = synthetic();
  const tb = { bytes: new Uint8Array(5 * 9), surf: new Float32Array(20) };
  syn.palette.forEach((p, i) => { tb.bytes.set([...hexBytes(p.hex[0]), ...hexBytes(p.hex[1]), ...hexBytes(p.hex[2])], i * 9); if (p.surface) tb.surf.set(p.surface, i * 4); });
  const A = runApp(makeBuild(slopesSource), toneObjects(syn.palette), syn.stream, syn.records, 1 << 16), T = runTyped(tb, syn.stream, syn.records), W = runWasm(instantiateWithMemory(), syn.palette, syn.stream, syn.records, { batchRecords: 1000 });
  const nm = ['position', 'normal', 'cDay', 'cGold', 'cNight', 'aFacet', 'aSurface', 'index'];
  const diff = (X) => nm.filter(n => sha(X[n]) !== sha(A[n]));
  const dT = diff(T), dW = diff(W);
  console.log(`synthetic edge cases (${syn.records} records: bent/degenerate quads, triN, facet runs, flipped winding): js-typed ${dT.length ? 'MISMATCH ' + dT : 'MATCH'}, rust-wasm ${dW.length ? 'MISMATCH ' + dW : 'MATCH'}  (${A.triangles} triangles)`);
  if (dT.length || dW.length) process.exitCode = 1;
}
const results = {
  'js-app (js/slopes.js build() verbatim)': runApp(makeBuild(slopesSource), toneObjects(palette), stream, records, 1 << 16),
  'js-typed (tuned JS, no allocations)': runTyped(tonesBytes, stream, records),
  'rust-wasm (meshkernel.wasm)': runWasm(instantiateWithMemory(), palette, stream, records),
};
const names = ['position', 'normal', 'cDay', 'cGold', 'cNight', 'aFacet', 'aSurface', 'index'];
const keyOf = { position: 'position', normal: 'normal', cDay: 'cDay', cGold: 'cGold', cNight: 'cNight', aFacet: 'aFacet', aSurface: 'aSurface', index: 'index' };
let bad = 0;
const ref = results[Object.keys(results)[0]];
console.log(`stream: ${records} records -> ${ref.triangles} triangles, ${ref.position.length / 3} vertices (${dir})`);
for (const [label, r] of Object.entries(results)) {
  const row = names.map(n => sha(r[keyOf[n]]));
  const sameAsRef = names.map((n, i) => row[i] === sha(ref[keyOf[n]]));
  const exp = expected.meshes.length === 1 ? expected.meshes[0].sha : null;
  const sameAsApp = exp ? names.map((n, i) => row[i] === exp[n === 'index' ? 'index' : n]) : null;
  const ok = sameAsRef.every(Boolean) && r.triangles === ref.triangles && (!sameAsApp || sameAsApp.every(Boolean));
  if (!ok) bad++;
  console.log(`${ok ? 'MATCH   ' : 'MISMATCH'} ${label}: triangles=${r.triangles}` + (sameAsApp && sameAsApp.every(Boolean) ? ' (equals the in-app build, sha256 in expected.json)' : '') + (ok ? '' : '  differing: ' + names.filter((n, i) => !sameAsRef[i] || (sameAsApp && !sameAsApp[i])).join(',')));
}
console.log(bad ? `FAIL: ${bad} builder(s) differ` : 'PASS: all builders produce byte-identical buffers');
process.exit(bad ? 1 : 0);
