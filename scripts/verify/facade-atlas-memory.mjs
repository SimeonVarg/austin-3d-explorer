/** Lifecycle regression for the pinned MapLibre atlas CPU-buffer release. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../../js/facades.js', import.meta.url), 'utf8');
const start = source.indexOf('  const ATLAS_MEMORY =');
const end = source.indexOf('  const imageManagerOf =', start);
assert(start >= 0 && end > start, 'atlas memory implementation exists');
const window = { maplibregl: { getVersion: () => '5.24.0' } };
const context = vm.createContext({ window });
vm.runInContext(source.slice(start, end), context);
const watch = vm.runInContext('watchAtlasUpload', context);
const gl = { isContextLost: () => false };
const atlas = () => ({
  uploaded: false,
  image: { width: 2, height: 2, data: Uint8Array.from({ length: 16 }, (_, i) => i * 13) },
  patternPositions: { facade: { version: 1 } },
});
let calls = 0;
const tile = {
  imageAtlas: atlas(),
  upload(arg, sentinel) {
    assert.equal(this, tile);
    assert.equal(arg.gl, gl);
    assert.equal(sentinel, 'sentinel');
    if (!this.imageAtlas.uploaded) {
      assert.equal(this.imageAtlas.image.data.length, 16, 'pixels available to upload');
      this.imageAtlas.uploaded = true;
      this.imageAtlasTexture = { texture: {} };
    }
    calls++;
    return 'original return';
  },
};
watch(tile);
const wrapped = tile.upload;
watch(tile);
assert.equal(tile.upload, wrapped, 'one wrapper per tile');
const metadata = tile.imageAtlas.patternPositions;
assert.equal(tile.upload({ gl }, 'sentinel'), 'original return');
assert.equal(tile.imageAtlas.image.data, null);
assert.equal(tile.imageAtlas.patternPositions, metadata);
assert.equal(tile.imageAtlas.image.width, 2);
tile.upload({ gl }, 'sentinel');
assert.equal(window.facadeMemoryStats().atlasesReleased, 1, 'no double counting');
tile.imageAtlas = atlas();
tile.upload({ gl }, 'sentinel');
assert.equal(tile.imageAtlas.image.data, null, 'replacement atlas released');
assert.equal(window.facadeMemoryStats().bytesReleased, 32);
assert.equal(calls, 3);

for (const kind of ['throw', 'not-uploaded', 'lost-context', 'no-texture']) {
  const candidate = {
    imageAtlas: atlas(), imageAtlasTexture: { texture: {} },
    upload() {
      if (kind === 'throw') throw new Error('upload failed');
      this.imageAtlas.uploaded = kind !== 'not-uploaded';
      if (kind === 'no-texture') this.imageAtlasTexture.texture = null;
    },
  };
  watch(candidate);
  const arg = { gl: { isContextLost: () => kind === 'lost-context' } };
  if (kind === 'throw') assert.throws(() => candidate.upload(arg), /upload failed/);
  else candidate.upload(arg);
  assert.equal(candidate.imageAtlas.image.data.length, 16, kind + ' retains pixels');
}

// Exercise every byte/alpha pair, including fully transparent colored pixels.
const raw = new Uint8Array(256 * 256 * 4);
for (let alpha = 0; alpha < 256; alpha++) {
  for (let color = 0; color < 256; color++) {
    const i = (alpha * 256 + color) * 4;
    raw.set([color, 255 - color, (color + 83) % 256, alpha], i);
  }
}
const expected = data => Uint8Array.from(data, (v, i) =>
  i % 4 === 3 ? v : Math.round(v * data[i - i % 4 + 3] / 255));
const originalPixels = raw.slice();
const styleImage = { version: 7, data: { width: 256, height: 256, data: raw } };
let fallbackCalls = 0;
const patchAtlas = {
  patchUpdatedImage(position, image, texture) {
    fallbackCalls++;
    if (!position || !image || position.version === image.version) return;
    position.version = image.version;
    const [x, y] = position.tl;
    texture.update(image.data, undefined, { x, y });
  },
};
const texture = {
  context: { gl: { RGBA: 6408 } }, format: 6408,
  update(image, options, xy) {
    this.pixels = options?.premultiply === false ? image.data : expected(image.data);
    this.xy = xy;
  },
};
vm.runInContext('watchAtlasPatches', context)(patchAtlas);
const position = () => ({ version: 6, tl: [21, 37] });
const firstPosition = position();
patchAtlas.patchUpdatedImage(firstPosition, styleImage, texture);
assert.deepEqual(Array.from(texture.pixels), Array.from(expected(raw)), 'all byte/alpha pairs exact');
assert.equal(firstPosition.version, 7);
assert.deepEqual({ ...texture.xy }, { x: 21, y: 37 });
const firstConversion = texture.pixels;
patchAtlas.patchUpdatedImage(position(), styleImage, texture);
assert.equal(texture.pixels, firstConversion, 'same image/version reused across tiles');
assert.deepEqual(raw, originalPixels, 'style pixels unchanged');
raw[0] = 255; raw[3] = 255; styleImage.version++;
patchAtlas.patchUpdatedImage(position(), styleImage, texture);
assert.notEqual(texture.pixels, firstConversion, 'in-place source update invalidated by version');
assert.equal(texture.pixels[0], 255);
const beforeClear = texture.pixels;
vm.runInContext('clearPremultiplyFrame()', context);
assert.equal(window.facadeMemoryStats().premultiplyCacheBytes, 0);
patchAtlas.patchUpdatedImage(position(), styleImage, texture);
assert.notEqual(texture.pixels, beforeClear, 'frame clear discards cached pixels');
const otherFormat = { ...texture, format: 6406 };
patchAtlas.patchUpdatedImage(position(), styleImage, otherFormat);
assert.equal(fallbackCalls, 1, 'unrecognized texture format uses original method');
for (let n = 0; n < 4; n++) {
  const large = { version: 7, data: { width: 1280, height: 1024, data: new Uint8Array(1280 * 1024 * 4) } };
  patchAtlas.patchUpdatedImage(position(), large, texture);
  const stats = window.facadeMemoryStats();
  assert(stats.premultiplyCacheBytes <= stats.premultiplyCacheLimit, 'cache remains bounded');
}
const oversize = { version: 7, data: { width: 2048, height: 2049, data: new Uint8Array(2048 * 2049 * 4) } };
patchAtlas.patchUpdatedImage(position(), oversize, { ...texture, update() {} });
assert.equal(fallbackCalls, 2, 'oversize images use original method');
vm.runInContext('clearPremultiplyFrame()', context);
window.maplibregl.getVersion = () => 'future';
const future = { upload() {} };
const original = future.upload;
watch(future);
assert.equal(future.upload, original, 'unknown MapLibre version untouched');
assert.equal(window.facadeMemoryStats().supported, false);
delete window.maplibregl.getVersion;
watch(future);
assert.equal(future.upload, original, 'absent version API untouched');
assert.equal(window.facadeMemoryStats().supported, false);
window.maplibregl = undefined;
watch(future);
assert.equal(future.upload, original, 'absent MapLibre untouched');
assert.equal(window.facadeMemoryStats().supported, false);
console.log('PASS: atlas lifecycle, exact premultiplication, reuse/invalidation, bounded cache, and fallback guards');
