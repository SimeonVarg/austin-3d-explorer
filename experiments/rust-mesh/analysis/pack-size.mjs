// Question (b): if the browser built nothing and just received baked meshes, how many bytes would that be, against
// the JSON recipes it downloads today? Measured on the real 3.1 M triangle catalog (the recorded stream, built by
// the wasm builder, which is byte-identical to the app's own).
//   node pack-size.mjs <streamDir>
// Layouts compared (bytes are exact; "compressed" = Node's zlib gzip level 9 and brotli quality 9 / 11):
//   today-recipes   data/apartments/*.json + the 5 collections the page fetches (what goes over the wire now)
//   today-buffers   the 8 attribute arrays the app holds in memory and uploads (what a phone has to hold)
//   packed          int16 positions in a per-chunk frame, octahedral int8x2 normals, u16 tone id, quads kept as quads
//   packed+shuffle  the same, with byte-planes split and positions delta-coded (the idea behind meshopt's vertex codec)
import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib'; import { fileURLToPath } from 'node:url';
import { loadStream } from '../js/stream.mjs'; import { runWasm } from '../js/builder-wasm.mjs';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const dir = process.argv[2];
const mb = n => (n / 1048576).toFixed(2) + ' MB';
const gz = b => zlib.gzipSync(b, { level: 9 }).length, br = (b, q = 9) => zlib.brotliCompressSync(b, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: q, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: b.length, [zlib.constants.BROTLI_PARAM_LGWIN]: 24 } }).length;
const Q11 = process.env.BROTLI11 === '1';
const row = (label, raw, g, b9, b11) => console.log(`${label.padEnd(34)} raw ${mb(raw).padStart(10)}   gzip ${mb(g).padStart(9)}   brotli9 ${mb(b9).padStart(9)}` + (b11 ? `   brotli11 ${mb(b11).padStart(9)}` : ''));

// ── today's wire: the recipes
const idx = JSON.parse(fs.readFileSync(path.join(repo, 'data/apartments/index.json'), 'utf8'));
const files = ['data/apartments/index.json', ...idx.buildings.map(f => 'data/apartments/' + f), ...idx.collections];
const recipes = Buffer.concat(files.map(f => fs.readFileSync(path.join(repo, f))));
// minified, since a build step could do that for free
const mini = Buffer.concat(files.map(f => Buffer.from(JSON.stringify(JSON.parse(fs.readFileSync(path.join(repo, f), 'utf8'))))));
console.log(`catalog files fetched at load: ${files.length}`);
row('today-recipes (as committed)', recipes.length, gz(recipes), br(recipes), (Q11 ? br(recipes, 11) : 0));
row('today-recipes (minified JSON)', mini.length, gz(mini), br(mini), (Q11 ? br(mini, 11) : 0));

// ── the buffers
const { stream, records, palette } = loadStream(dir);
const mod = new WebAssembly.Module(fs.readFileSync(path.join(here, '../dist/meshkernel.wasm')));
const V = runWasm(new WebAssembly.Instance(mod, {}).exports, palette, stream, records);
const nV = V.position.length / 3, nI = V.index.length;
let todayBytes = 0; for (const k of Object.keys(V)) if (V[k].byteLength) todayBytes += V[k].byteLength;
console.log(`\nvertices ${nV}, indices ${nI}, triangles ${V.triangles}, distinct tones ${palette.length}`);
console.log(`today-buffers: position ${mb(V.position.byteLength)}, normal ${mb(V.normal.byteLength)}, colours ${mb(V.cDay.byteLength * 3)}, facet ${mb(V.aFacet.byteLength)}, surface ${mb(V.aSurface.byteLength)}, index ${mb(V.index.byteLength)} = ${mb(todayBytes)}  (${(todayBytes / nV).toFixed(1)} bytes per vertex)`);

// distinct flat normals / tones, counted with numeric hashes (millions of string keys were the slow part of a first version)
const u32 = new Uint32Array(V.normal.buffer, V.normal.byteOffset, V.normal.length);
const nrm = new Set(); for (let i = 0; i < nV; i++) nrm.add((Math.imul(u32[i * 3], 0x9e3779b1) ^ Math.imul(u32[i * 3 + 1], 0x85ebca6b) ^ Math.imul(u32[i * 3 + 2], 0xc2b2ae35)) >>> 0);
console.log(`distinct flat normals: about ${nrm.size} (hash-counted, of ${nV} vertices)`);
const surfIds = new Map(), toneL1 = new Map(); let nTones = 0; const toneOf = new Uint16Array(nV);
for (let i = 0; i < nV; i++) {
  const d = (V.cDay[i * 3] << 16) | (V.cDay[i * 3 + 1] << 8) | V.cDay[i * 3 + 2], g = (V.cGold[i * 3] << 16) | (V.cGold[i * 3 + 1] << 8) | V.cGold[i * 3 + 2], n = (V.cNight[i * 3] << 16) | (V.cNight[i * 3 + 1] << 8) | V.cNight[i * 3 + 2];
  const sk = V.aSurface[i * 4] + ',' + V.aSurface[i * 4 + 1] + ',' + V.aSurface[i * 4 + 2] + ',' + V.aSurface[i * 4 + 3];
  let sid = surfIds.get(sk); if (sid === undefined) { sid = surfIds.size; surfIds.set(sk, sid); }
  const k1 = d * 16777216 + g, k2 = (n * 64 + sid) * 2 + V.aFacet[i];
  let m = toneL1.get(k1); if (!m) { m = new Map(); toneL1.set(k1, m); }
  let id = m.get(k2); if (id === undefined) { id = nTones++; m.set(k2, id); }
  toneOf[i] = id;
}
const toneKey = { size: nTones, keys: () => [] };
console.log(`distinct (day,golden,night,surface,facet) tones actually used: ${nTones}  -> one u16 per vertex replaces ${V.cDay.byteLength / nV * 3 + 1 + 16} bytes per vertex`);

// ── packed layout. Chunks of 16384 quads' worth of vertices share an origin + scale (so int16 position suffices and
// indices fit u16). Position error is reported, not assumed.
const CH = 65536 - 4; let maxErr = 0;
const chunks = []; for (let s = 0; s < nV; s += CH) chunks.push([s, Math.min(nV, s + CH - ((s + CH) % 4 === 0 ? 0 : (s + CH) % 4))]);
// make chunk boundaries multiples of 4 so a quad never straddles (quads are 4 consecutive vertices; lone tris are 3: handled by the 'quad' mask below)
const pos16 = new Int16Array(nV * 3), oct = new Int8Array(nV * 2), origins = [];
const q16 = []; let cursor = 0;
while (cursor < nV) {
  const end = Math.min(nV, cursor + 60000); let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
  for (let i = cursor; i < end; i++) { const x = V.position[i * 3], y = V.position[i * 3 + 1], z = V.position[i * 3 + 2]; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const ext = Math.max(x1 - x0, y1 - y0, z1 - z0, 1e-6), sc = 65534 / ext;
  for (let i = cursor; i < end; i++) for (let a = 0; a < 3; a++) { const o = [x0, y0, z0][a], v = V.position[i * 3 + a], q = Math.round((v - o) * sc) - 32767; pos16[i * 3 + a] = q; maxErr = Math.max(maxErr, Math.abs((q + 32767) / sc + o - v)); }
  origins.push([x0, y0, z0, ext]); cursor = end;
}
for (let i = 0; i < nV; i++) {   // octahedral normal, 8 bits per axis
  const x = V.normal[i * 3], y = V.normal[i * 3 + 1], z = V.normal[i * 3 + 2], l = Math.abs(x) + Math.abs(y) + Math.abs(z);
  let u = x / l, v = y / l; if (z < 0) { const ou = u, ov = v; u = (1 - Math.abs(ov)) * (ou >= 0 ? 1 : -1); v = (1 - Math.abs(ou)) * (ov >= 0 ? 1 : -1); }
  oct[i * 2] = Math.round(u * 127); oct[i * 2 + 1] = Math.round(v * 127);
}
const packedVertexBytes = nV * (6 + 2 + 2);
const tonesTable = nTones * (9 + 16 + 1);
// index: a mesh made of quads (4 consecutive vertices, pattern 0,1,2 / 0,2,3) and lone triangles (3 vertices). Keep one flag per primitive.
const isQuad = []; for (let t = 0; t < V.index.length;) { const a = V.index[t], b = V.index[t + 1], c = V.index[t + 2]; const a2 = V.index[t + 3], c2 = V.index[t + 5]; const quad = t + 5 < V.index.length && a2 === a && c2 === a + 3 && b === a + 1 && c === a + 2 && V.index[t + 4] === a + 2; isQuad.push(quad ? 1 : 0); t += quad ? 6 : 3; }
const quadMask = Uint8Array.from(isQuad); const quads = quadMask.reduce((s, x) => s + x, 0);
console.log(`primitives: ${quads} quads + ${quadMask.length - quads} lone triangles; every index in the buffer is reproducible from one flag per primitive`);
const packed = Buffer.concat([Buffer.from(pos16.buffer), Buffer.from(oct.buffer), Buffer.from(toneOf.buffer), Buffer.from(quadMask), Buffer.from(JSON.stringify({ origins, tones: nTones }))]);
console.log(`packed per-vertex ${(packedVertexBytes / nV).toFixed(1)} B; position max error ${(maxErr * 100).toFixed(3)} cm (int16 per ${origins.length} chunk(s) of up to 60k vertices)`);
row('packed (int16/oct8/tone16)', packed.length, gz(packed), br(packed), (Q11 ? br(packed, 11) : 0));

// shuffle: positions delta vs the previous vertex of the same quad corner pattern, byte planes
const dpos = new Int16Array(nV * 3); for (let i = 0; i < nV; i++) for (let a = 0; a < 3; a++) dpos[i * 3 + a] = (pos16[i * 3 + a] - (i ? pos16[(i - 1) * 3 + a] : 0)) | 0;
const planes = (typed, w) => { const b = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength), out = Buffer.alloc(b.length), n = b.length / w; for (let i = 0; i < n; i++) for (let k = 0; k < w; k++) out[k * n + i] = b[i * w + k]; return out; };
const shuffled = Buffer.concat([planes(dpos, 2), planes(oct, 1), planes(toneOf, 2), Buffer.from(quadMask), Buffer.from(JSON.stringify({ origins, tones: nTones }))]);
row('packed + delta + byte-planes', shuffled.length, gz(shuffled), br(shuffled), (Q11 ? br(shuffled, 11) : 0));
// ── meshoptimizer's real codec (npm `meshoptimizer`, the encoder/decoder three.js and glTF use; installed OUTSIDE the repo:
//    MESHOPT=/path/to/node_modules/meshoptimizer). One 12-byte vertex: int16 x3 position, int8 x2 octahedral normal, u16 tone id, 2 pad.
if (process.env.MESHOPT) {
  const { MeshoptEncoder, MeshoptDecoder } = await import(path.join(process.env.MESHOPT, 'index.js'));
  await MeshoptEncoder.ready; await MeshoptDecoder.ready;
  const vb = new Uint8Array(nV * 12), dv = new DataView(vb.buffer);
  for (let i = 0; i < nV; i++) { const o = i * 12; dv.setInt16(o, pos16[i * 3], true); dv.setInt16(o + 2, pos16[i * 3 + 1], true); dv.setInt16(o + 4, pos16[i * 3 + 2], true); dv.setInt8(o + 6, oct[i * 2]); dv.setInt8(o + 7, oct[i * 2 + 1]); dv.setUint16(o + 8, toneOf[i], true); }
  const encV = MeshoptEncoder.encodeVertexBuffer(vb, nV, 12);
  const idx32 = V.index; const encI = MeshoptEncoder.encodeIndexBuffer(new Uint8Array(idx32.buffer, idx32.byteOffset, idx32.byteLength), idx32.length, 4);
  const both = Buffer.concat([Buffer.from(encV), Buffer.from(encI)]);
  row('meshopt vertex(12B) + index codec', both.length, gz(both), br(both), br(both, 11));
  console.log(`   of which vertex stream ${mb(encV.length)} (raw ${mb(vb.length)}) and index stream ${mb(encI.length)} (raw ${mb(idx32.byteLength)})`);
  const out = new Uint8Array(nV * 12), outI = new Uint8Array(idx32.byteLength);
  const times = []; for (let r = 0; r < 5; r++) { const t = performance.now(); MeshoptDecoder.decodeVertexBuffer(out, nV, 12, encV); MeshoptDecoder.decodeIndexBuffer(outI, idx32.length, 4, encI); times.push(performance.now() - t); }
  console.log(`   decode (Wasm, ${MeshoptDecoder.supported ? 'supported' : 'unsupported'}) of the whole city, 5 runs: min ${Math.min(...times).toFixed(0)} ms, max ${Math.max(...times).toFixed(0)} ms (Node, loaded machine)`);
  console.log(`   round trip identical: ${Buffer.compare(Buffer.from(out), Buffer.from(vb)) === 0}`);
}

console.log(JSON.stringify({ todayBytes, nV, nI, packedRaw: packed.length, distinctNormals: nrm.size, distinctTones: nTones, maxPosErrCm: maxErr * 100 }));
fs.writeFileSync(path.join(process.env.OUT || '/tmp', 'packed-shuffled.bin'), shuffled);
