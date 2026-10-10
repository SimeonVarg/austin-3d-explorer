// How far can the vertex buffers shrink WITHOUT changing a single value the shader sees? Counts, on the real catalog's recorded builder
// stream, the distinct normals, tones and whole vertices (position + normal + tone + facet), and sizes the layouts in js/slopes.js's
// ?packverts=1 proposal. "Distinct" is by exact bits (f32 for position and normal).
//   node analysis/pack-layout.mjs <streamDir>
import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadStream } from '../js/stream.mjs';
import { instantiate, runWasm } from '../js/builder-wasm.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = process.argv[2]; if (!dir) throw new Error('usage: pack-layout.mjs <streamDir>');
const { stream, records, palette } = loadStream(dir);
const x = instantiate(new WebAssembly.Module(fs.readFileSync(path.join(here, '../../../wasm/meshkernel.wasm'))));
const o = runWasm(x, palette, stream, records, { reserve: 6523203 });
const V = o.position.length / 3, I = o.index.length;
const u32 = new Uint32Array(o.normal.buffer, o.normal.byteOffset, V * 3), p32 = new Uint32Array(o.position.buffer, o.position.byteOffset, V * 3);
function uniq64(h1, h2) { const k = new BigUint64Array(h1.length); for (let i = 0; i < k.length; i++) k[i] = (BigInt(h1[i]) << 32n) | BigInt(h2[i]); k.sort(); let n = 1; for (let i = 1; i < k.length; i++) if (k[i] !== k[i - 1]) n++; return n; }
const mix = (h, v) => { h = Math.imul(h ^ v, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); return (h ^ (h >>> 16)) >>> 0; };
// normals
const n1 = new Uint32Array(V), n2 = new Uint32Array(V), t1 = new Uint32Array(V), t2 = new Uint32Array(V), v1 = new Uint32Array(V), v2 = new Uint32Array(V);
for (let i = 0; i < V; i++) {
  let a = 0x1234567, b = 0x7654321;
  for (let k = 0; k < 3; k++) { a = mix(a, u32[i * 3 + k]); b = mix(b ^ 0x9e3779b9, u32[i * 3 + k] + k); }
  n1[i] = a; n2[i] = b;
  let c = 0x2468ace, d = 0x1357bdf;
  const cs = [o.cDay[i * 3], o.cDay[i * 3 + 1], o.cDay[i * 3 + 2], o.cGold[i * 3], o.cGold[i * 3 + 1], o.cGold[i * 3 + 2], o.cNight[i * 3], o.cNight[i * 3 + 1], o.cNight[i * 3 + 2], o.aFacet[i]];
  for (const q of cs) { c = mix(c, q); d = mix(d ^ 0x9e3779b9, q + 7); }
  const sf = new Uint32Array(o.aSurface.buffer, o.aSurface.byteOffset + i * 16, 4);
  for (const q of sf) { c = mix(c, q); d = mix(d ^ 0x9e3779b9, q + 3); }
  t1[i] = c; t2[i] = d;
  let e = a ^ c, f = b ^ d;
  for (let k = 0; k < 3; k++) { e = mix(e, p32[i * 3 + k]); f = mix(f ^ 0x85ebca6b, p32[i * 3 + k] + 1); }
  v1[i] = e; v2[i] = f;
}
const nN = uniq64(n1, n2), nT = uniq64(t1, t2), nV = uniq64(v1, v2);
console.log(`vertices ${V}, indices ${I}, triangles ${o.triangles}`);
console.log(`distinct normals ${nN}   distinct tone+surface+facet ${nT}   distinct whole vertices ${nV} (${(100 * nV / V).toFixed(1)}% of the vertices)`);
const MB = 1048576, mb = b => (b / MB).toFixed(1) + ' MB';
console.log('today: ', mb(V * 3 * 4 + V * 3 * 4 + V * 9 + V + V * 16 + I * 4), `(${((V * 55.7 + 0) / MB).toFixed(0)} by the study's rule)`);
const L = (name, perVertex, vertices = V) => console.log(`${name.padEnd(62)} ${mb(vertices * perVertex + I * 4)}  (${perVertex} B/vertex over ${vertices} vertices + ${mb(I * 4)} index)`);
L('A  position f32x3 (12) + one 32-bit word: normal id + tone id (4)', 16);
L('A+ the same, identical vertices merged', 16, nV);
L('B  position int16x4 (8) + one 32-bit word (4)  [position NOT exact]', 12);
L('B+ the same, identical vertices merged', 12, nV);
console.log('(tables for A: ' + mb(nN * 12) + ' of normals as RGB32F, ' + mb(nT * 13 * 4) + ' of tones)');
