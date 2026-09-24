// CPU contract for lossless builder storage. Browser pixel/context-recovery
// checks remain necessary: this does not claim to exercise the WebGL driver.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

let source = fs.readFileSync(new URL('../../js/slopes.js', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
if (process.argv.includes('--break')) {
  source = source.replaceAll('mat.defaultAttributeValues.aGrad = [0, 0];', 'mat.defaultAttributeValues.aGrad = [0, 1];');
}
if (process.argv.includes('--break-small')) {
  source = source.replace('let cap = initialCapacity, nV = 0;', 'let cap = 1 << 16, nV = 0;');
}
let convenienceCopyBytes = 0, stagingAllocationBytes = 0;
const trackedArray = Type => new Proxy(Type, { construct(target, args) {
  const array = new target(...args);
  stagingAllocationBytes += array.byteLength;
  return array;
} });
class BufferAttribute {
  constructor(array, itemSize, normalized = false) {
    Object.assign(this, { array, itemSize, normalized, count: array.length / itemSize });
  }
  getZ(i) { return this.array[i * this.itemSize + 2]; }
}
class Float32BufferAttribute extends BufferAttribute {
  constructor(array, itemSize, normalized = false) {
    const copy = new Float32Array(array);
    convenienceCopyBytes += copy.byteLength;
    super(copy, itemSize, normalized);
  }
}
class BufferGeometry {
  attributes = {};
  setAttribute(name, attribute) { this.attributes[name] = attribute; return this; }
  setIndex(index) { this.index = index; return this; }
  computeBoundingSphere() {}
}
class ShaderMaterial {
  defaultAttributeValues = { color: [1, 1, 1], uv: [0, 0] };
  constructor(options) { Object.assign(this, options); }
}
const THREE = { BufferAttribute, Float32BufferAttribute, BufferGeometry, ShaderMaterial,
  Vector2: class { constructor(x, y) { Object.assign(this, { x, y }); } }, FrontSide: 0, NoBlending: 0 };
const context = vm.createContext({ window: { THREE }, U: {}, VERT: '', FRAG: '',
  Float32Array: trackedArray(Float32Array), Uint8Array: trackedArray(Uint8Array), Uint32Array: trackedArray(Uint32Array),
  hexToRgb01: hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255) });
const start = source.indexOf('  function build(');
const end = source.indexOf('\n  /**\n   * A wall frame', start);
assert.ok(start >= 0 && end > start);
vm.runInContext(source.slice(start, end), context);
const helpersStart = source.indexOf('  function material(opts) {');
const helpersEnd = source.indexOf('  function add(obj)', helpersStart);
vm.runInContext(source.slice(helpersStart, helpersEnd), context);

const colour = ['#123456', '#abcdef', '#fedcba'];
colour.surface = [4, 0.25, 0.5, 0.75];
const beforeBulk = stagingAllocationBytes;
const b = context.build();
assert.equal(stagingAllocationBytes - beforeBulk, 65536 * 58);
b.quad([0, 0, 0], [2, 0, 0], [2, 3, 0], [0, 3, 0], colour);
b.facet(true);
b.triN([0, 0, 1], [2, 0, 1], [0, 3, 1], [0, 0, 1], [0.6, 0, 0.8], [0, 0.6, 0.8], colour);
const geometry = b.geometry(), attrs = geometry.attributes;
assert.equal(attrs.position.count, 7);
assert.deepEqual([...geometry.index.array], [0, 1, 2, 0, 2, 3, 4, 5, 6]);
assert.deepEqual([...attrs.position.array], [0, 0, 0, 2, 0, 0, 2, 3, 0, 0, 3, 0, 0, 0, 1, 2, 0, 1, 0, 3, 1]);
assert.deepEqual([...attrs.normal.array], [...new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, .6, 0, .8, 0, .6, .8])]);
assert.deepEqual([...attrs.aFacet.array], [0, 0, 0, 0, 1, 1, 1]);
assert.deepEqual([...attrs.cDay.array], Array.from({ length: 7 }, () => [0x12, 0x34, 0x56]).flat());
assert.equal(attrs.cDay.normalized, true);
assert.deepEqual([...attrs.aSurface.array], Array.from({ length: 7 }, () => colour.surface).flat());
// A one-face builder allocates 232 staging bytes, not 3.8 MB. Also grow it
// beyond its initial capacity and compare every output byte to the bulk path.
const beforeTiny = stagingAllocationBytes;
const tiny = context.build(4);
assert.equal(stagingAllocationBytes - beforeTiny, 232);
tiny.quad([0, 0, 0], [2, 0, 0], [2, 3, 0], [0, 3, 0], colour);
tiny.facet(true);
tiny.triN([0, 0, 1], [2, 0, 1], [0, 3, 1], [0, 0, 1], [0.6, 0, 0.8], [0, 0.6, 0.8], colour);
const tinyGeometry = tiny.geometry();
assert.deepEqual(Object.keys(tinyGeometry.attributes), Object.keys(attrs));
for (const name of Object.keys(attrs)) {
  assert.deepEqual([...tinyGeometry.attributes[name].array], [...attrs[name].array]);
}
assert.deepEqual([...tinyGeometry.index.array], [...geometry.index.array]);
assert.equal(attrs.aGrad, undefined);
assert.deepEqual([...context.material().defaultAttributeValues.aGrad], [0, 0]);
const facade = context.facadeMaterial({ textures: {}, len: 2, z0: 0, z1: 3 }, {});
assert.deepEqual([...facade.defaultAttributeValues.aGrad], [0, 0]);
// A colour()-authored wall still overrides the material constant per vertex.
const wall = new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 10, 0, 0, 20]), 3));
context.colour(wall, colour, { base: 10, top: 20 });
assert.deepEqual([...wall.attributes.aGrad.array], [10, 20, 11, 20]);

// Cross the builder growth boundary; final buffers must be trimmed and retain
// all positions, normals, index and material data required after context loss.
const big = context.build();
for (let i = 0; i < 17000; i++) big.quad([i, 0, 0], [i + 1, 0, 0], [i + 1, 1, 0], [i, 1, 0], colour);
const large = big.geometry(), n = large.attributes.position.count;
assert.equal(n, 68000);
assert.equal(large.index.count, 102000);
for (const attr of [...Object.values(large.attributes), large.index]) {
  assert.equal(attr.array.byteOffset, 0);
  assert.equal(attr.array.byteLength, attr.array.buffer.byteLength);
}
assert.equal(large.attributes.position.array.at(-3), 16999);
assert.equal(large.index.array.at(-1), 67999);
assert.equal(convenienceCopyBytes, 0, 'already typed output arrays must not be copied by convenience constructors');
const bytes = Object.values(large.attributes).reduce((sum, attr) => sum + attr.array.byteLength, 0);
assert.equal(bytes, n * 50, 'unchanged attributes occupy 50 bytes/vertex instead of 58');
console.log(`PASS: exact positions/normals/indices/colours; constant gradient and real wall override; ${n * 8} CPU/GPU bytes saved at ${n} vertices; tiny staging 3801088 -> 232 bytes with identical output after growth; no convenience copies; restoration data retained`);
