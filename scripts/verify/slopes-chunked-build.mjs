// CPU contract for js/slopes.js buildChunked (phones: js/mobile.js
// LITE.budget.geometryChunkTris). Split into chunks, the builder must emit the
// SAME triangles in the SAME order with the same per-vertex attributes as one
// build() — every triangle expanded to its three vertices and compared
// byte for byte — and no chunk may grow past its limit. No browser.
//   node slopes-chunked-build.mjs            exit 0 = identical
//   node slopes-chunked-build.mjs --break    drops the facet carry-over: exit 1
// Optional THREE_R159_MODULE=/local/three.module.js uses the actual pinned
// library, also checking the offline reference below. No network is used.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

let source = fs.readFileSync(new URL('../../js/slopes.js', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
if (process.argv.includes('--break')) {
  source = source.replace('cur = build();\n      cur.facet(facetOn);', 'cur = build();');
}
class BufferAttribute {
  constructor(array, itemSize, normalized = false) { Object.assign(this, { array, itemSize, normalized, count: array.length / itemSize }); }
}
class BufferGeometry {
  attributes = {};
  setAttribute(name, attribute) { this.attributes[name] = attribute; return this; }
  setIndex(index) { this.index = index; return this; }
  computeBoundingSphere() {}
}
class Vector2 { constructor(x, y) { Object.assign(this, { x, y }); } }
// three r159's shapes: Float16BufferAttribute copies into a Uint16Array of
// half-float BITS; DataUtils.toHalfFloat TRUNCATES the float32 mantissa.
class Float16BufferAttribute extends BufferAttribute {
  constructor(array, itemSize, normalized) { super(new Uint16Array(array), itemSize, normalized); this.isFloat16BufferAttribute = true; }
}
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
// The base/shift branches from three@0.159.0 src/extras/DataUtils.js, applied
// directly rather than precomputed in tables. Fixed r159 outputs below guard
// against substituting a generic half converter with different rounding.
function referenceHalf(v) {
  f32[0] = Math.max(-65504, Math.min(65504, v));
  const x = u32[0], sign = (x >>> 16) & 0x8000;
  const e = ((x >>> 23) & 0xff) - 127, m = x & 0x7fffff;
  if (e < -27) return sign;
  if (e < -14) return (sign | (0x0400 >> (-e - 14))) + (m >> (-e - 1));
  if (e <= 15) return (sign | ((e + 15) << 10)) + (m >> 13);
  return (sign | 0x7c00) + (e < 128 ? 0 : m >> 13);
}
const r159Cases = [[0, 0], [-0, 0x8000], [0.078, 0x2cfd], [-0.078, 0xacfd],
  [0.65, 0x3933], [1.00075, 0x3c00], [0.9999, 0x3bff], [2 ** -25, 0],
  [2 ** -24, 1], [2 ** -14, 0x400], [0.000061, 0x3ff], [1, 0x3c00],
  [2, 0x4000], [4, 0x4400], [2047, 0x67ff], [65504, 0x7bff], [-65504, 0xfbff]];
let toHalfFloat = referenceHalf;
if (process.env.THREE_R159_MODULE) {
  const actual = await import(pathToFileURL(process.env.THREE_R159_MODULE).href);
  assert.equal(actual.REVISION, '159', 'precision verification must match the app dependency');
  toHalfFloat = actual.DataUtils.toHalfFloat;
}
for (const [v, bits] of r159Cases) {
  assert.equal(referenceHalf(v), bits, 'offline r159 reference for ' + v);
  assert.equal(toHalfFloat(v), bits, 'r159 DataUtils for ' + v);
}
// Cover both signs, normal and subnormal exponents, and mantissa boundaries.
// When a module is supplied, this checks the reference against real r159.
for (let e = -28; e <= 15; e++) for (const m of [0, 1, 4095, 4096, 8191, 8192, 8380415]) {
  for (const s of [-1, 1]) {
    const v = s * Math.min(65504, 2 ** e * (1 + m / 2 ** 23));
    assert.equal(referenceHalf(v), toHalfFloat(v), 'r159 reference drift for ' + v);
  }
}
const fromHalf = h => { const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, m = h & 1023; return e === 0 ? s * m * 2 ** -24 : s * (1 + m / 1024) * 2 ** (e - 15); };
const THREE = { BufferAttribute, BufferGeometry, Vector2, Float16BufferAttribute, DataUtils: { toHalfFloat } };
const context = vm.createContext({ window: { THREE }, Float32Array, Uint8Array, Uint32Array, Int8Array, Uint16Array,
  hexToRgb01: hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255) });
const cut = (from, to) => {
  const a = source.indexOf(from), b = source.indexOf(to, a);
  assert.ok(a >= 0 && b > a, 'source markers moved: ' + from);
  return source.slice(a, b);
};
vm.runInContext(cut('  function build(', '\n  /**\n   * A wall frame'), context);
vm.runInContext(cut('  function buildChunked(', '\n  window.slopes = {'), context);

// A deterministic stream of every primitive the bulk generators use, with the
// facet run toggled across chunk boundaries and bent quads mixed in.
let seed = 7;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const tones = [['#123456', '#abcdef', '#fedcba'], ['#804020', '#406080', '#102030'], ['#ffffff', '#000000', '#7f7f7f']];
tones[1].surface = [4, 0.25, 0.5, 0.75];
tones[2].surface = [2, 0.25, 0.078, 0.65];   // brick, js/slopes-apartments.js APTS.materials: not exact in half
const script = [];
for (let i = 0; i < 9000; i++) {
  const x = rnd() * 100, y = rnd() * 100, z = rnd() * 30, col = tones[i % 3];
  const r = rnd();
  if (i % 97 === 0) script.push(['facet', rnd() < 0.5]);
  if (r < 0.55) script.push(['quad', [x, y, z], [x + 2, y, z], [x + 2, y + 3, z], [x, y + 3, z], col, [0, 0, 1]]);
  else if (r < 0.7) script.push(['quad', [x, y, z], [x + 2, y, z], [x + 2, y + 3, z + 0.5], [x, y + 3, z], col, [0, 0, -1]]);
  else if (r < 0.85) script.push(['tri', [x, y, z], [x + 1, y, z + 1], [x, y + 2, z], col, [0, 1, 0]]);
  else script.push(['triN', [x, y, z], [x + 1, y, z], [x, y + 1, z + 1], [0, 0, 1], [0.6, 0, 0.8], [0, 0.6, 0.8], col]);
}
const run = b => { for (const [m, ...a] of script) b[m](...a); return b; };

function expand(geoms) {
  const names = Object.keys(geoms[0].attributes);
  const out = Object.fromEntries(names.map(n => [n, []]));
  let tris = 0;
  for (const g of geoms) {
    assert.deepEqual(Object.keys(g.attributes), names);
    const idx = g.index.array;
    for (const v of idx) for (const n of names) {
      const a = g.attributes[n];
      for (let k = 0; k < a.itemSize; k++) out[n].push(a.array[v * a.itemSize + k]);
    }
    tris += idx.length / 3;
  }
  return { out, tris };
}

const one = run(context.build());
const whole = expand([one.geometry()]);
const LIMIT = 1500;
const chunked = run(context.buildChunked(LIMIT));
assert.equal(chunked.triangles, one.triangles, 'triangle count');
const parts = chunked.geometries();
assert.ok(parts.length > 3, `expected several chunks, got ${parts.length}`);
for (const g of parts) {
  const t = g.index.count / 3;
  // A chunk rolls over BEFORE the primitive that would start past the limit,
  // so it may end at most one primitive (<= 2 triangles here) beyond it.
  assert.ok(t <= LIMIT + 2, `chunk of ${t} triangles over the ${LIMIT} limit`);
}
const split = expand(parts);
assert.equal(split.tris, whole.tris);
for (const n of Object.keys(whole.out)) {
  assert.equal(split.out[n].length, whole.out[n].length, n + ' length');
  for (let i = 0; i < whole.out[n].length; i++) {
    if (split.out[n][i] !== whole.out[n][i]) assert.fail(`${n}[${i}] differs: ${split.out[n][i]} vs ${whole.out[n][i]} (triangle ${Math.floor(i / 3 / (n === 'aSurface' ? 4 : n === 'aFacet' ? 1 : 3))})`);
  }
}
// Packed (LITE.budget.packVertices): positions, colours and facets still
// identical; normals within half a byte step; aSurface within half-float
// truncation, material indices exact; 34 bytes a vertex instead of 50.
const packedParts = run(context.buildChunked(LIMIT, true)).geometries();
const packed = expand(packedParts);
assert.equal(packed.tris, whole.tris);
let normalErr = 0, surfaceErr = 0;
for (const n of Object.keys(whole.out)) {
  const A = whole.out[n], P = packed.out[n];
  assert.equal(P.length, n === 'normal' ? A.length / 3 * 4 : A.length, n + ' length (packed)');
  for (let i = 0; i < A.length; i++) {
    if (n === 'normal') normalErr = Math.max(normalErr, Math.abs(P[Math.floor(i / 3) * 4 + i % 3] / 127 - A[i]));
    else if (n === 'aSurface') {
      assert.equal(P[i], toHalfFloat(A[i]), 'surface bits must match r159 DataUtils');
      const v = fromHalf(P[i]), e = Math.abs(v - A[i]);
      if (i % 4 === 0) assert.equal(v, A[i], 'material index must be exact');
      surfaceErr = Math.max(surfaceErr, e / Math.max(Math.abs(A[i]), 1e-3));
    } else if (P[i] !== A[i]) assert.fail(`${n}[${i}] changed by packing`);
  }
}
assert.ok(normalErr <= 0.5 / 127 + 1e-7, 'normal error ' + normalErr);
assert.ok(surfaceErr <= 2 ** -10, 'aSurface relative error (r159 truncation) ' + surfaceErr);
const bytesOf = parts => parts.reduce((s, g) => s + Object.values(g.attributes).reduce((t, a) => t + a.array.byteLength, 0), 0);
const vtx = parts.reduce((s, g) => s + g.attributes.position.count, 0);
assert.equal(bytesOf(parts), vtx * 50);
assert.equal(bytesOf(packedParts), vtx * 34);
assert.equal(packedParts[0].attributes.normal.normalized, true);
assert.equal(packedParts[0].attributes.normal.itemSize, 4);
for (let i = 3; i < packed.out.normal.length; i += 4) assert.equal(packed.out.normal[i], 0);
assert.ok(packedParts[0].attributes.normal.array instanceof Int8Array && packedParts[0].attributes.aSurface.isFloat16BufferAttribute);

// An empty chunked builder still returns one (empty) geometry, like build().
assert.equal(context.buildChunked(LIMIT).geometries().length, 1);
console.log(`PASS: ${whole.tris} triangles in ${parts.length} chunks of <= ${LIMIT}, every expanded vertex attribute identical to one build(), facet runs carried across chunk boundaries; packed: 50 -> 34 bytes/vertex, normal error ${normalErr.toFixed(5)} (<= 1/254), aSurface relative error ${surfaceErr.toExponential(2)}, indices exact`);
