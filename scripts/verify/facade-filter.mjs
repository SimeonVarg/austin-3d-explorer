// Area integration and lifecycle invariants for authored facade textures.
// --break substitutes point sampling; it must fail the fractional-area case.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../../js/facade-filter.js', import.meta.url), 'utf8');
const window = {};
vm.runInNewContext(process.argv.includes('--break') ? source.replace(
  'const area = dy * (Math.min(x + 1, x1) - Math.max(x, x0));',
  'const area = x + .5 >= x0 && x + .5 < x1 && y + .5 >= y0 && y + .5 < y1 ? 1 : 0;') : source, { window });
const F = window.FacadeFilter;
const red = ['#ff0000', '#00ff00', '#0000ff']; red.surface = [4, 1, 1, .5];
const blue = ['#0000ff', '#000000', '#000000'];
const shop = ['#000000', '#000000', '#000000']; shop.surface = [6, 1, 1, .2];
const base = { len: 1, z0: 10, z1: 11, options: { texelMetres: .5, maxDimension: 2 } };
const raster = F.rasterizeFace({ ...base, rects: [[0, .3, 10, 11, red], [.3, 1, 10, 11, blue]] });
assert.equal(raster.width, 2); assert.equal(raster.height, 2);
// The first half-metre texel contains 60% red; the next contains only blue.
assert.deepEqual(Array.from(raster.day.slice(0, 8)), [153, 0, 102, 77, 0, 0, 255, 0]);
assert.deepEqual(Array.from(raster.gold.slice(0, 8)), [0, 153, 0, 153, 0, 0, 0, 0]);
assert.deepEqual(Array.from(raster.night.slice(0, 8)), [0, 0, 153, 0, 0, 0, 0, 0]);
assert.equal(raster.bytes, (4 + 1) * 4 * 3);
// Row zero is the bottom of the face; both axes integrate fractional edges.
const rows = F.rasterizeFace({ ...base, rects: [[0, 1, 10, 10.3, red], [0, 1, 10.3, 11, blue]] });
assert.deepEqual(Array.from(rows.day.slice(0, 4)), [153, 0, 102, 77]);
assert.deepEqual(Array.from(rows.day.slice(8, 12)), [0, 0, 255, 0]);
const one = { ...base, options: { maxDimension: 1 } };
assert.equal(F.rasterizeFace({ ...one, rects: [[0, 1, 10, 11, shop]] }).day[3], 255);
for (const rects of [[], [[0, .5, 10, 11, red]], [[0, 1, 10, 11, red], [0, 1, 10, 11, blue]],
  [[0, 1, 10, 11, ['bad', '#000000', '#000000']]], [[0, NaN, 10, 11, red]]]) {
  assert.equal(F.rasterizeFace({ ...base, rects }), null);
}
assert.equal(F.rasterizeFace({ ...base, len: 0, rects: [[0, 1, 10, 11, red]] }), null);
for (const coverageTolerance of [NaN, Infinity, -1, 1]) {
  assert.equal(F.rasterizeFace({ ...base, options: { ...base.options, coverageTolerance },
    rects: [[0, 1, 10, 11, red]] }), null);
}
const capped = F.rasterizeFace({ ...base, len: 1000,
  options: { maxDimension: 4096, texelMetres: 1 }, rects: [[0, 1000, 10, 11, red]] });
assert.equal(capped.width, 512); assert.equal(capped.height, 1);

let created = 0, disposed = 0;
const THREE = { DataTexture: class {
  constructor(data, width, height) { this.image = { data, width, height }; this.colorSpace = 'wrong'; created++; }
  dispose() { disposed++; }
}, RGBAFormat: 1, UnsignedByteType: 2, LinearFilter: 3, LinearMipmapLinearFilter: 4,
  ClampToEdgeWrapping: 5, NoColorSpace: '' };
const create = options => F.createFace({ ...one, THREE, rects: [[0, 1, 10, 11, red]], options: { ...one.options, ...options } });
assert.equal(create({ maxBytes: 11 }), null); assert.equal(created, 0);
const face = create({ maxBytes: 24 });
assert.equal(F.bytes, 12); assert.equal(F.count, 1);
assert.equal(face.textures.day.colorSpace, ''); assert.equal(face.textures.day.flipY, false);
assert.equal(face.textures.day.minFilter, THREE.LinearMipmapLinearFilter);
assert.equal(face.textures.day.generateMipmaps, true);
assert.equal(create({ maxBytes: 23 }), null); // the caller budget includes existing allocations
const other = create({ maxBytes: 24 }); assert.equal(F.bytes, 24);
face.dispose(); face.dispose(); assert.equal(disposed, 3); assert.equal(F.bytes, 12);
F.reset(); other.dispose(); assert.equal(disposed, 6); assert.equal(F.bytes, 0); assert.equal(F.count, 0);
// Failure midway through texture setup releases everything already constructed.
let attempts = 0;
const broken = { ...THREE, DataTexture: class extends THREE.DataTexture {
  constructor(...args) { if (++attempts === 2) throw new Error('allocation failed'); super(...args); }
} };
assert.throws(() => F.createFace({ ...one, THREE: broken, rects: [[0, 1, 10, 11, red]] }), /allocation failed/);
assert.equal(disposed, 7); assert.equal(F.bytes, 0); assert.equal(F.count, 0);
// Batch real face data by dimensions. Layers preserve input order and retain
// separate images without atlas-edge bleed or duplicate CPU pixel buffers.
const arrayTHREE = { ...THREE, DataArrayTexture: class extends THREE.DataTexture {
  constructor(data, width, height, depth) { super(data, width, height); this.image.depth = depth; }
} };
const smallA = create(), smallB = F.createFace({ ...one, THREE, rects: [[0, 1, 10, 11, blue]] });
const large = F.createFace({ ...base, THREE, rects: [[0, 1, 10, 11, red]] });
const originalA = smallA.textures;
const beforeBatch = { bytes: F.bytes, disposed };
const groups = F.createBatch({ THREE: arrayTHREE, faces: [smallB, large, smallA] });
assert.equal(groups.length, 2);
assert.equal(groups[0].faces[0], smallB); assert.equal(groups[0].faces[1], smallA);
assert.equal(groups[1].faces[0], large);
assert.equal(groups[0].textures.day.image.depth, 2);
assert.deepEqual(Array.from(groups[0].textures.day.image.data), [0, 0, 255, 0, 255, 0, 0, 128]);
assert.equal(groups[0].textures.day.generateMipmaps, true);
assert.equal(groups[0].textures.day.minFilter, THREE.LinearMipmapLinearFilter);
assert.equal(groups[0].textures.day.colorSpace, '');
assert.equal(smallA.data.day.buffer, groups[0].textures.day.image.data.buffer);
assert.equal(smallA.data.day.byteOffset, 4);
assert.notEqual(smallA.textures, originalA);
assert.equal(disposed - beforeBatch.disposed, 9); // old textures all released
assert.equal(F.bytes, beforeBatch.bytes); assert.equal(F.count, 3);
assert.throws(() => F.createBatch({ THREE: arrayTHREE, faces: [smallA] }), /unbatched/);
smallA.dispose(); assert.equal(F.bytes, beforeBatch.bytes); // shared array still lives
assert.equal(F.count, 2);
groups[0].dispose(); groups[0].dispose();
assert.equal(F.bytes, large.bytes); assert.equal(F.count, 1);
F.reset(); groups[1].dispose(); assert.equal(F.bytes, 0); assert.equal(F.count, 0);
// Failed array allocation releases only new arrays, preserving original
// textures, CPU data and live budget so the caller can keep its old meshes.
const retry = create(), retryTextures = retry.textures, retryPixels = retry.data.day;
let arrayAttempts = 0;
const badArrayTHREE = { ...arrayTHREE, DataArrayTexture: class extends arrayTHREE.DataArrayTexture {
  constructor(...args) { if (++arrayAttempts === 2) throw new Error('forced array failure'); super(...args); }
} };
const beforeArrayFailure = disposed;
assert.throws(() => F.createBatch({ THREE: badArrayTHREE, faces: [retry] }), /forced array failure/);
assert.equal(disposed - beforeArrayFailure, 1);
assert.equal(retry.textures, retryTextures); assert.equal(retry.data.day, retryPixels);
assert.equal(F.bytes, retry.bytes); assert.equal(F.count, 1);
assert.throws(() => F.createBatch({ THREE: arrayTHREE, faces: [retry, retry] }), /distinct/);
F.reset(); assert.equal(F.bytes, 0);
// Exercise the actual apartment tiler with only the renderer boundary stubbed.
// Expose its private entry point at the IIFE boundary; its implementation is
// executed unchanged. A valid authored skin need not define palette.wall.
const apartments = fs.readFileSync(new URL('../../js/slopes-apartments.js', import.meta.url), 'utf8');
// Evaluate the real module's startup configuration on each device/override.
// No renderer is booted; this checks defaults without duplicating the rule.
for (const [label, phone, query, expected] of [
  ['desktop default', false, '', true],
  ['phone default', true, '', false],
  ['desktop explicit off', false, '&facadefilter=0', false],
  ['phone explicit on', true, '&facadefilter=1', true]
]) {
  const deviceWindow = { location: { search: '?slopes=0' + query }, LITE_PROFILE: { on: phone } };
  vm.runInNewContext(apartments, { window: deviceWindow, location: deviceWindow.location, URLSearchParams });
  assert.equal(deviceWindow.APARTMENTS.facadeFilter.on, expected, label);
}
const close = apartments.lastIndexOf('})();');
assert.ok(close > 0, 'apartment module IIFE boundary exists');
let materialDisposals = 0, geometryDisposals = 0;
function builder(allowFilter = false) {
  const quads = [], polygons = [];
  const validColour = col => assert.ok(Array.isArray(col) && col.length >= 3 &&
    col.slice(0, 3).every(c => /^#[0-9a-f]{6}$/i.test(c)), 'geometry requires a colour triple');
  return { allowFilter, filtered: [], quads, polygons,
    quad(a, b, c, d, col) { validColour(col); quads.push({ positions: [a, b, c, d], col }); },
    polygon(points, col) { validColour(col); polygons.push(points); },
    geometry() { return { quads,
      attributes: { position: { array: Float32Array.from(quads.flatMap(q => q.positions.flat())), itemSize: 3, count: quads.length * 4 } },
      index: { array: Uint16Array.from(quads.flatMap((q, i) => [0, 1, 2, 0, 2, 3].map(v => v + i * 4))) },
      dispose() { geometryDisposals++; },
      setAttribute(name, value) { this.attributes[name] = value; } }; }
  };
}
window.location = { search: '?slopes=0' }; // avoid asynchronous city boot
window.THREE = { ...THREE,
  Float32BufferAttribute: class { constructor(array, itemSize) { this.array = Float32Array.from(array); this.itemSize = itemSize; } },
  Mesh: class { constructor(geometry, material) { this.geometry = geometry; this.material = material; this.userData = {}; } }
};
window.slopes = { build: builder, facadeMaterial: face => ({ face, dispose() { materialDisposals++; } }) };
vm.runInNewContext(apartments.slice(0, close) +
  'window.testTileFace = tileFace; window.testBatchFiltered = batchFiltered; window.testEmptyBuild = () => { _data = {buildings: []}; return build(); };\n' + apartments.slice(close),
  { window, location: window.location, URLSearchParams, performance });
window.APARTMENTS.facadeFilter.minArea = 0;
window.APARTMENTS.facadeFilter.maxDimension = 2;
window.APARTMENTS.reveals = false;
const wallFrame = { at: (s, depth, z) => [s, depth, z], N: [0, 1, 0], T: [1, 0, 0] };
const faceSpec = { W: wallFrame, len: 1, z0: 10, z1: 11 };
const opening = { s0: .3, s1: 1, z0: 10, z1: 11 };
const skin = { rows: () => [], cols: () => [], tone: () => blue, windows: [opening] };
const palette = { glass: red }; // regression: no palette.wall
const enabled = builder(true);
window.testTileFace(enabled, faceSpec, skin, palette);
assert.equal(enabled.quads.length, 2);
assert.equal(enabled.filtered.length, 1);
const proxy = enabled.filtered[0];
assert.equal(proxy.geometry.quads.length, 1);
assert.deepEqual(Array.from(proxy.geometry.attributes.uv.array), [0, 0, 1, 0, 1, 1, 0, 1]);
assert.equal(proxy.geometry.attributes.uv.itemSize, 2);
assert.deepEqual(Array.from(proxy.material.face.data.day.slice(0, 4)), [102, 0, 153, 51]);
assert.equal(F.count, 1);
proxy.userData.disposeFacade();
assert.equal(F.count, 0); assert.equal(materialDisposals, 1);
for (const [allow, face, currentSkin] of [
  [false, faceSpec, skin],
  [true, faceSpec, { ...skin, windows: [{ ...opening, arch: { rise: .2 } }] }],
  [true, { ...faceSpec, cut: { a: 1, b: 0, c: -.1 } }, skin]
]) {
  const target = builder(allow);
  window.testTileFace(target, face, currentSkin, palette);
  assert.ok(target.quads.length + target.polygons.length > 0, 'original geometry remains');
  assert.equal(target.filtered.length, 0); assert.equal(F.count, 0);
}
// Actual batch integration joins proxy attributes/indices without changing
// layer order, UVs, physical face dimensions or texture ownership.
window.THREE.DataArrayTexture = arrayTHREE.DataArrayTexture;
window.THREE.BufferAttribute = class {
  constructor(array, itemSize, normalized) { Object.assign(this, { array, itemSize, normalized, count: array.length / itemSize }); }
};
window.THREE.BufferGeometry = class {
  constructor() { this.attributes = {}; }
  setAttribute(name, value) { this.attributes[name] = value; }
  setIndex(array) { this.index = { array: Uint32Array.from(array) }; }
  dispose() { geometryDisposals++; }
};
const tiled = builder(true);
window.testTileFace(tiled, faceSpec, skin, palette);
window.testTileFace(tiled, { ...faceSpec, len: 2 }, skin, palette);
const beforeMerge = { bytes: F.bytes, geometries: geometryDisposals, materials: materialDisposals };
const merged = window.testBatchFiltered(tiled.filtered);
assert.equal(merged.length, 1);
assert.equal(geometryDisposals - beforeMerge.geometries, 2);
assert.equal(materialDisposals - beforeMerge.materials, 2);
assert.equal(F.bytes, beforeMerge.bytes);
assert.deepEqual(Array.from(merged[0].geometry.attributes.faceLayer.array), [0, 0, 0, 0, 1, 1, 1, 1]);
assert.deepEqual(Array.from(merged[0].geometry.attributes.faceSize.array), [1, 1, 1, 1, 1, 1, 1, 1, 2, 1, 2, 1, 2, 1, 2, 1]);
assert.deepEqual(Array.from(merged[0].geometry.index.array), [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
assert.deepEqual(Array.from(merged[0].geometry.attributes.uv.array), [0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1]);
merged[0].geometry.dispose(); merged[0].userData.disposeFacade();
assert.equal(F.count, 0); assert.equal(F.bytes, 0);
// Fail after texture registration at two distinct renderer boundaries. Both
// exceptions must propagate without retaining textures or a budget charge.
const goodMesh = window.THREE.Mesh, goodMaterial = window.slopes.facadeMaterial;
for (const stage of ['material', 'mesh']) {
  const before = { textures: disposed, geometries: geometryDisposals, materials: materialDisposals };
  if (stage === 'material') window.slopes.facadeMaterial = () => { throw new Error('forced material failure'); };
  else window.THREE.Mesh = class { constructor() { throw new Error('forced mesh failure'); } };
  const target = builder(true);
  assert.throws(() => window.testTileFace(target, faceSpec, skin, palette), /forced .* failure/);
  assert.equal(target.filtered.length, 0); assert.equal(F.count, 0); assert.equal(F.bytes, 0);
  assert.equal(disposed - before.textures, 3);
  assert.equal(geometryDisposals - before.geometries, 1);
  assert.equal(materialDisposals - before.materials, stage === 'mesh' ? 1 : 0);
  window.THREE.Mesh = goodMesh; window.slopes.facadeMaterial = goodMaterial;
}
// The city's final group constructor can fail even with valid mesh geometry.
// Its shared slopes material is owned by the scene and must remain alive.
window.slopes.material = () => ({ dispose() { assert.fail('shared material was disposed'); } });
window.THREE.Group = class { constructor() { throw new Error('forced group failure'); } };
const beforeGroup = geometryDisposals;
await assert.rejects(window.testEmptyBuild(), /forced group failure/);
assert.equal(geometryDisposals - beforeGroup, 1);
assert.equal(F.count, 0); assert.equal(F.bytes, 0);
console.log('Facade filter: area, masks, coverage, budget, disposal and actual tiler integration pass.');
