/**
 * Lifecycle regression for the pinned MapLibre atlas CPU-buffer release, the
 * worker premultiply and the worker image cache. `--break` (a worker that tags
 * an atlas without premultiplying it) and `--break-img` (a held image that
 * went stale) must each exit 1.
 */
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
// ── ATLAS_WORKER_PM: the premultiply moved into MapLibre's tile workers ──
// The exact source text the page imports into each worker, captured from
// armWorkerPremultiply, run in a fresh realm standing in for a worker.
const BREAK = process.argv.includes('--break');          // the worker premultiply must catch it
const BREAK_IMG = process.argv.includes('--break-img');  // the worker image cache must catch it
const bytesDiffer = (a, b) => { if (a.length !== b.length) return Math.max(a.length, b.length); let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return n; };
const blobs = [], imported = [];
context.Blob = class { constructor(parts) { this.text = parts.join(''); } };
context.URL = { createObjectURL: (b) => { blobs.push(b.text); return 'blob:' + blobs.length; } };
window.maplibregl.importScriptInWorkers = (url) => { imported.push(url); return Promise.resolve([]); };
// A stand-in for MapLibre 5.24.0's Style / ImageManager, reduced to what the
// image cache touches: getImages -> imageManager.getImages -> (synchronously)
// _getImagesForIds, which clones every image it returns.
class FakeRGBA {
  constructor(w, h, data) { this.width = w; this.height = h; this.data = data; }
  clone() { return new FakeRGBA(this.width, this.height, this.data.slice()); }
}
class FakeImageManager {
  constructor() { this.images = {}; this.copies = 0; }
  getImage(id) { return this.images[id]; }
  _getImagesForIds(ids) {
    const r = {};
    for (const id of ids) { const im = this.getImage(id); if (im) { this.copies++; r[id] = { data: im.data.clone(), version: im.version, pixelRatio: 1 }; } }
    return r;
  }
  getImages(ids) { return new Promise((resolve) => resolve(this._getImagesForIds(ids))); }
}
class FakeStyle {
  constructor() { this.imageManager = new FakeImageManager(); this.deps = {}; }
  getImages(mapId, params) {
    return (async () => { const images = await this.imageManager.getImages(params.icons); this.deps[params.tileID] = params.icons.slice(); return images; })();
  }
}
const fakeStyle = new FakeStyle();
const fakeMap = { style: fakeStyle };
vm.runInContext('ATLAS_IMAGE_CACHE.maxBytesPerWorker = 40', context);   // room for two 2x2 images
context.__fakeMap = fakeMap;
vm.runInContext('armWorkers(__fakeMap); armWorkers(__fakeMap);', context);
assert.equal(imported.length, 1, 'workers armed once');
await new Promise((r) => setTimeout(r, 0));   // the import promise settles
assert.equal(window.facadeMemoryStats().workerPm, 'on');
assert.equal(window.facadeMemoryStats().imgCache, 'on');
const sent = [];
const workerSelf = { postMessage(msg, opts) { sent.push([msg, opts]); } };
const worker = vm.createContext({ self: workerSelf });
vm.runInContext(blobs[0], worker);
vm.runInContext(blobs[0], worker);            // a second import must not wrap twice
const tileResult = () => ({ type: '<response>', id: 'x', error: null,
  data: { buckets: [], imageAtlas: { $name: 'ImageAtlas', patternPositions: {},
    image: { $name: 'RGBAImage', width: 256, height: 256, data: raw.slice() } } } });
const msg = tileResult();
if (BREAK) msg.data.imageAtlas.__facadePm = 1;   // --break: a worker that tags without doing the work
workerSelf.postMessage(msg, { transfer: [] });
assert.equal(sent.length, 1, 'message passed through once');
assert.equal(sent[0][0], msg, 'the same message object, transfer list untouched');
assert.equal(msg.data.imageAtlas.__facadePm, 1, 'atlas tagged');
assert.equal(bytesDiffer(msg.data.imageAtlas.image.data, expected(raw)), 0, 'worker bytes === El(raw), every byte/alpha pair');
workerSelf.postMessage({ type: '<response>', data: { imageAtlas: { $name: 'ImageAtlas',
  image: { width: 2, height: 2, data: new Uint8Array(15) } } } });   // wrong shape: left alone
assert.equal(sent[1][0].data.imageAtlas.__facadePm, undefined, 'odd-shaped atlas not tagged');
const other = { type: 'getImages', data: { imageAtlas: { $name: 'ImageAtlas', image: { width: 1, height: 1, data: new Uint8Array([9, 9, 9, 9]) } } } };
workerSelf.postMessage(other);
assert.deepEqual(Array.from(other.data.imageAtlas.image.data), [9, 9, 9, 9], 'only tile RESPONSES are touched');

// The main thread: a tagged atlas is uploaded as it arrived, premultiply off,
// with MapLibre's Texture class read off a one-pixel probe before any tile.
class FakeTexture {
  constructor(ctx, image, format, opts) {
    const pm = !(opts && opts.premultiply === false);
    this.pixels = pm ? expected(image.data) : image.data; this.opts = opts; this.texture = {};
  }
  update() {} bind() {} destroy() { this.destroyed = true; }
}
let mlUploads = 0, probeTextures = [];
function mlUpload(context) {       // MapLibre 5.24.0 Tile.upload, reduced to what it does
  for (const id in this.buckets) { /* bucket uploads */ }
  if (this.imageAtlas && !this.imageAtlas.uploaded) {
    this.imageAtlasTexture = new FakeTexture(context, this.imageAtlas.image, 6408);
    this.imageAtlas.uploaded = true; mlUploads++;
    if (!this.upload) probeTextures.push(this.imageAtlasTexture);
  }
}
const pmGl = { RGBA: 6408, isContextLost: () => false };
const pmTile = { buckets: {}, upload: mlUpload,
  imageAtlas: { uploaded: false, patternPositions: {}, __facadePm: 1, __facadePmSrc: raw.slice(),
    image: { width: 256, height: 256, data: msg.data.imageAtlas.image.data } } };
vm.runInContext('_TextureCtor = null', context);
watch(pmTile);
const st0 = window.facadeMemoryStats();
pmTile.upload({ gl: pmGl });
assert.equal(probeTextures.length, 1, 'Texture class read off one probe');
assert.equal(probeTextures[0].destroyed, true, 'probe texture destroyed');
assert.equal(mlUploads, 1, 'the tagged atlas itself never reached MapLibre\'s upload');
assert(pmTile.imageAtlasTexture instanceof FakeTexture);
assert.equal(pmTile.imageAtlasTexture.opts.premultiply, false, 'uploaded with premultiply off');
assert.equal(bytesDiffer(pmTile.imageAtlasTexture.pixels, expected(raw)), 0, 'not premultiplied twice');
const st1 = window.facadeMemoryStats();
assert.equal(st1.workerPmUploads - st0.workerPmUploads, 1);
assert.equal(st1.workerPmChecked - st0.workerPmChecked, 1, '?atlaspmcheck bytes compared');
assert.equal(st1.workerPmMismatch, 0, 'check found 0 differing bytes');
assert.equal(pmTile.imageAtlas.image.data, null, 'CPU copy released after upload, as before');
// An untagged atlas on the same page still takes the main-thread table.
const plainTile = { buckets: {}, upload: mlUpload,
  imageAtlas: { uploaded: false, patternPositions: {}, image: { width: 256, height: 256, data: raw.slice() } } };
watch(plainTile);
plainTile.upload({ gl: pmGl });
assert.equal(mlUploads, 1, 'untagged atlas uploaded by the table path, not MapLibre\'s');
assert.equal(bytesDiffer(plainTile.imageAtlasTexture.pixels, expected(raw)), 0, 'untagged atlas premultiplied once');
assert.equal(window.facadeMemoryStats().workerPmUploads, st1.workerPmUploads, 'untagged not counted as worker');

// ── ATLAS_IMAGE_CACHE: a worker keeps the pattern images it was sent ──
// The same imported source, in a realm that has MapLibre's worker actor; the
// "wire" is structuredClone both ways, as postMessage would do.
const px = (seed) => Uint8Array.from({ length: 16 }, (_, i) => (i * 29 + seed) & 255);
const im = fakeStyle.imageManager;
im.images.a = { version: 0, data: new FakeRGBA(2, 2, px(1)) };
im.images.b = { version: 0, data: new FakeRGBA(2, 2, px(2)) };
im.images.c = { version: 0, data: new FakeRGBA(2, 2, px(3)) };
im.images.cb = { version: 0, data: new FakeRGBA(2, 2, px(4)), userImage: { render() {} } };
const wire = [];
const cacheSelf = { postMessage(m) { wire.push(m); }, worker: { actor: {
  sendAsync(msg) {
    wire.push(msg);
    return fakeStyle.getImages(0, structuredClone(msg.data)).then((r) => structuredClone(r));
  },
} } };
const cacheWorker = vm.createContext({ self: cacheSelf });
vm.runInContext(blobs[0], cacheWorker);
vm.runInContext(blobs[0], cacheWorker);            // a second import must not wrap twice
const ask = (icons, type = 'patterns') => cacheSelf.worker.actor.sendAsync({ type: 'GI', targetMapId: 0,
  data: { icons, source: 's', tileID: icons.join(), type } });
const same = (got, id) => bytesDiffer(got[id].data.data, im.images[id].data.data) === 0;
const gs = () => vm.runInContext('self.__facadeImgCache', cacheWorker);
let r = await ask(['a', 'b']);
assert.equal(im.copies, 2, 'first request: both copied');
assert(same(r, 'a') && same(r, 'b'), 'first request: exact pixels');
assert.equal(gs().n, 2, 'worker kept both');
r = await ask(['a', 'b']);
assert.equal(im.copies, 2, 'second request: nothing copied');
assert.equal(wire[wire.length - 1].data.__facadeHave.a, '1:0', 'worker listed serial:version');
if (BREAK_IMG) r.a.data.data[0] ^= 255;              // --break-img: a held copy that went stale
assert(same(r, 'a') && same(r, 'b'), 'held copies have exact pixels');
assert.equal(window.facadeMemoryStats().imgCacheStubs, 2);
assert.deepEqual(fakeStyle.deps['a,b'], ['a', 'b'], 'the tile still depends on every image');
// An updated image (updateImage bumps the version) goes whole.
im.images.a.data.data = px(9); im.images.a.version++;
r = await ask(['a', 'b']);
assert.equal(im.copies, 3, 'changed image copied, unchanged one not');
assert(same(r, 'a') && same(r, 'b'), 'the NEW pixels arrive');
// Removed and added again (a new object, version back to 0) goes whole too.
im.images.b = { version: 0, data: new FakeRGBA(2, 2, px(7)) };
r = await ask(['a', 'b']);
assert.equal(im.copies, 4, 'a re-added image is a new serial');
assert(same(r, 'b'), 're-added pixels arrive');
// Icons are not touched; a render-callback image is never held.
const wireIcons = wire.length;
await ask(['a'], 'icons');
assert.equal(wire[wireIcons].data.__facadeHave, undefined, 'icons request unchanged');
await ask(['cb']); await ask(['cb']);
assert.equal(im.copies, 7, 'render-callback image copied every time');
// LRU cap (40 bytes = two images): c pushes out the least recently used.
await ask(['c']);                                   // held: b, c  (a was used before b)
r = await ask(['a']);
assert.equal(im.copies, 9, 'evicted image copied again');
assert(same(r, 'a'));
assert(gs().bytes <= 40, 'worker cache stays under its cap');
// ?atlaspmcheck=1: the full copy rides beside each stub and the worker compares.
vm.runInContext('ATLAS_WORKER_PM.check = true', context);
r = await ask(['a']);
assert.equal(gs().checked, 1, 'held copy compared with a fresh one');
assert.equal(gs().bad, 0, 'held copy === fresh copy');
cacheSelf.postMessage(tileResult());
const carried = wire[wire.length - 1].data.imageAtlas.__facadePmImg;
assert.deepEqual(Array.from(carried), [1, 0], 'check counts carried home on the next atlas');
vm.runInContext('ATLAS_WORKER_PM.check = false', context);

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
console.log('PASS: atlas lifecycle, exact premultiplication (main thread and in the tile worker, tagged atlas uploaded once), worker image cache (held copies exact, changed and re-added images sent whole, icons and render callbacks untouched, LRU cap, check path), reuse/invalidation, bounded cache, and fallback guards');
