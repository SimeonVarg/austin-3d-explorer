import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

const source = fs.readFileSync(new URL('../../js/image-memory.js', import.meta.url), 'utf8');
const hash = '45a9b07a9189ce56054c620a947ccf41e291e58c95e9b61533b740aaa65ee5cb';
const distribution = process.env.MAPLIBRE_DIST ? fs.readFileSync(process.env.MAPLIBRE_DIST, 'utf8') : null;
if (distribution) assert.equal(createHash('sha256').update(distribution).digest('hex'), hash);
function method(start, next, last = false) {
  const begin = last ? distribution.lastIndexOf(start) : distribution.indexOf(start);
  const end = distribution.indexOf(next, begin + start.length);
  assert.ok(begin >= 0 && end > begin, `pinned boundary ${start}`);
  return distribution.slice(begin, end);
}
function fixture(options = {}, native = false) {
  const scope = vm.createContext({ options });
  vm.runInContext(`
    const refs = [];
    class WeakRef { constructor(value) { this.value = value; refs.push(this); } deref() { return this.value; } }
    class RGBA { constructor(size, data) { this.width = size.width; this.height = size.height; this.data = data; } clone() { return new RGBA(this, new Uint8Array(this.data)); } replace(data) { this.data.set(data); } }
    const t = { R: RGBA, b: () => false, l: class {}, n: class {}, w() {} }, n = { getImageData: input => input };
    class HTMLImageElement {}
    function manager() { return {
      images: {}, patterns: {}, updatedImages: {}, requestors: [], loaded: false,
      fire() { return this; }, isLoaded() { return this.loaded; },
      setLoaded(value) { this.loaded = value; if (value) { for (const request of this.requestors) request.promiseResolve(this._getImagesForIds(request.ids)); this.requestors = []; } },
      getImage(id) { return this.images[id]; }, _validate() { return !options.failed; },
      addImage(id, image) { if (this.images[id]) throw new Error('duplicate'); if (this._validate(id, image)) this.images[id] = image; },
      updateImage(id, image) { image.version = this.images[id].version + 1; this.images[id] = image; this.updatedImages[id] = true; },
      removeImage(id) { const image = this.images[id]; delete this.images[id]; delete this.patterns[id]; if (image.userImage?.onRemove) image.userImage.onRemove(); },
      getImages(ids) { return new Promise(resolve => { if (this.loaded || ids.every(id => this.images[id])) resolve(this._getImagesForIds(ids)); else this.requestors.push({ ids, promiseResolve: resolve }); }); },
      _getImagesForIds(ids) { const reply = {}; for (const id of ids) { const image = this.images[id]; if (image) reply[id] = { data: image.data.clone(), version: image.version, hasRenderCallback: Boolean(image.userImage?.render) }; } return reply; },
      cloneImages() { const result = {}; for (const id in this.images) result[id] = { ...this.images[id], data: this.images[id].data.clone() }; return result; }
    }; }
    const map = { style: { imageManager: manager(), addImage(id, image) { this.imageManager.addImage(id, image); }, getImage(id) { return this.imageManager.getImage(id); }, updateImage(id, image) { this.imageManager.updateImage(id, image); }, removeImage(id) { this.imageManager.removeImage(id); } },
      fire() { return this; }, _lazyInitEmptyStyle() {},
      addImage(id, input) { this.style.addImage(id, { data: new RGBA(input, new Uint8Array(input.data)), userImage: input, version: 0 }); if (input.onAdd) input.onAdd(this, id); return this; },
      updateImage(id, input) { const image = this.style.getImage(id); image.data.replace(input.data); this.style.updateImage(id, image); return this; }, removeImage(id) { this.style.removeImage(id); } };
    const window = { location: { search: options.off ? '?imagememory=0' : '' }, LITE_PROFILE: { on: !!options.phone }, maplibregl: { getVersion: () => options.version || '5.24.0' },
      initFacades(target, entries) { for (const [id, input] of entries) target.addImage(id, input); return target; }, registerFacadeBuckets(target, entries) { for (const [id, input] of entries) target.addImage(id, input); return entries.length; } };
    function input(kind = 'plain') {
      const image = { width: 2, height: 1, data: Uint8Array.from([0,1,127,255,254,128,2,0]) };
      if (kind === 'clamped') image.data = new Uint8ClampedArray(image.data);
      if (kind === 'null') Object.setPrototypeOf(image, null);
      if (kind === 'inherited') Object.setPrototypeOf(image, { render() {} });
      if (kind.startsWith('inherited-')) Object.defineProperty(Object.prototype, kind.slice(10), { configurable: true, value() {} });
      if (['render','onAdd','onRemove'].includes(kind)) image[kind] = function () { this.calls = (this.calls || 0) + 1; return false; };
      if (kind === 'extra') image.unknown = true;
      if (kind === 'symbol') image[Symbol('extra')] = true;
      if (kind === 'getter') Object.defineProperty(image, 'width', { enumerable: true, get() { return 2; } });
      if (kind === 'class') Object.setPrototypeOf(image, RGBA.prototype);
      if (kind === 'subarray') image.data = new Uint8Array(new ArrayBuffer(12),4,8);
      if (kind === 'short') image.data = new Uint8Array(4);
      if (kind === 'shared') image.data = new Uint8Array(new SharedArrayBuffer(8));
      return image;
    }
    globalThis.fixture = { window, map, input, refs, manager };
  `, scope);
  if (native) {
    for (const [start,next] of [['addImage(e,t){','_validate(e,i){'],['updateImage(e,t,i=!0){','removeImage(e){'],['removeImage(e){','listImages(){'],['setLoaded(e){','getImage(e){'],['getImage(e){','addImage(e,t){'],['getImages(e){','_getImagesForIds(e){'],['_getImagesForIds(e){','getPixelSize(){']]) vm.runInContext('Object.assign(map.style.imageManager, ({'+method(start,next)+'}));',scope);
    vm.runInContext('Object.assign(map.style.imageManager, ({'+method('cloneImages(){','}}const v=')+'}}));',scope);
    for (const [start,next] of [['addImage(e,i,o={}){','updateImage(e,i){'],['updateImage(e,i){','getImage(e){']]) vm.runInContext('Object.assign(map, ({'+method(start,next,true)+'}));',scope);
  }
  vm.runInContext(source, scope, { filename: 'js/image-memory.js' });
  return scope.fixture;
}
const bytes = image => Array.from(image.data?.data || image.data);
let passed = 0;
async function check(name, callback) { await callback(); passed++; console.log('PASS '+name); }
for (const native of distribution ? [false,true] : [false]) {
  const mode = native ? 'pinned distribution' : 'simulated 5.24.0';
  for (const entry of ['initFacades','registerFacadeBuckets']) {
    await check(`${mode}: ${entry} lifecycle`, async () => {
      const test = fixture({},native), { window,map } = test, original = test.input();
      const expected = bytes(original), manager = map.style.imageManager;
      const pending = manager.getImages(['facade']);
      assert.equal(window[entry](map,[['facade',original]]),entry === 'initFacades' ? map : 1);
      const image = manager.images.facade, primary = image.data;
      assert.equal(image.userImage,undefined);
      assert.notEqual(primary.data.buffer,original.data.buffer);
      assert.deepEqual(bytes(image),expected);
      assert.deepEqual(bytes(original),expected);
      manager.setLoaded(true);
      const reply = await pending;
      assert.deepEqual(bytes(reply.facade),expected);
      assert.equal(reply.facade.hasRenderCallback,false);
      assert.notEqual(reply.facade.data.data.buffer,primary.data.buffer);
      const updated = test.input(); updated.data[0] = 99;
      assert.equal(map.updateImage('facade',updated),map);
      assert.equal(image.data,primary);
      assert.deepEqual(bytes(image),bytes(updated));
      assert.deepEqual(bytes(original),expected);
      assert.equal(image.version,1);
      const current = await manager.getImages(['facade']);
      assert.deepEqual(bytes(current.facade),bytes(updated));
      assert.equal(current.facade.version,1);
      const snapshot = manager.cloneImages();
      assert.equal(snapshot.facade.userImage,undefined);
      assert.deepEqual(bytes(snapshot.facade),bytes(updated));
      assert.notEqual(snapshot.facade.data.data.buffer,primary.data.buffer);
      map.removeImage('facade');
      assert.equal(manager.images.facade,undefined);
      const restored = test.manager();
      restored.addImage('facade',snapshot.facade);
      map.style.imageManager = restored;
      assert.deepEqual(bytes((await restored.getImages(['facade'])).facade),bytes(updated));
      map.updateImage('facade',original);
      assert.deepEqual(bytes(restored.images.facade),expected);
      map.removeImage('facade');
      window[entry](map,[['facade',original]]);
      assert.equal(restored.images.facade.userImage,undefined);
      assert.deepEqual(bytes(restored.images.facade),expected);
      assert.deepEqual(bytes(original),expected);
      assert.equal(window.ImageMemory.stats(map).releasedImages,2);
      assert.equal(window.ImageMemory.stats(map).releasedBytes,16);
    });
  }
  await check(`${mode}: eligibility and dynamic hooks`, () => {
    for (const kind of ['plain','null','clamped','render','onAdd','onRemove','inherited','inherited-render','inherited-onAdd','inherited-onRemove','getter','extra','symbol','class','subarray','short','shared']) {
      const test = fixture({},native), input = test.input(kind), before = bytes(input);
      test.window.registerFacadeBuckets(test.map,[[kind,input]]);
      const eligible = ['plain','null','clamped'].includes(kind);
      assert.equal(test.map.style.imageManager.images[kind].userImage,eligible ? undefined : input,kind);
      assert.equal(test.window.ImageMemory.stats(test.map).releasedBytes,eligible ? 8 : 0,kind);
      assert.deepEqual(bytes(input),before,kind);
      if (kind === 'onAdd') assert.equal(input.calls,1);
      test.map.removeImage(kind);
      if (kind === 'onRemove') assert.equal(input.calls,1);
    }
  });
  await check(`${mode}: external ownership and unsupported configurations`, () => {
    const test = fixture({},native), input = test.input();
    test.window.initFacades(test.map,[]);
    test.map.addImage('external',input);
    assert.equal(test.window.ImageMemory.reclaim(test.map),0);
    assert.equal(test.map.style.imageManager.images.external.userImage,input);
    for (const options of [{phone:true},{version:'5.23.0'},{version:'5.24.1'}]) {
      const excluded = fixture(options,native), original = excluded.input();
      excluded.window.initFacades(excluded.map,[['excluded',original]]);
      assert.equal(excluded.map.style.imageManager.images.excluded.userImage,original);
      assert.equal(excluded.window.ImageMemory.stats(excluded.map).supported,false);
      assert.equal(excluded.window.ImageMemory.stats(excluded.map).pendingImages,0);
    }
  });
  await check(`${mode}: reentrant external additions`, () => {
    const test = fixture({},native), external = test.input(), callback = test.input();
    callback.onAdd = function () { test.map.addImage('external',external); };
    test.window.initFacades(test.map,[['callback',callback]]);
    assert.equal(test.map.style.imageManager.images.callback.userImage,callback);
    assert.equal(test.map.style.imageManager.images.external.userImage,external);
    assert.equal(test.window.ImageMemory.stats(test.map).releasedImages,0);
  });
  await check(`${mode}: toggle-off weak candidates and idempotent reclaim`, () => {
    const test = fixture({off:true},native), input = test.input(), before = bytes(input);
    test.window.initFacades(test.map,[['pending',input]]);
    assert.equal(test.window.ImageMemory.stats(test.map).pendingImages,1);
    assert.equal(test.refs.length,2);
    assert.ok(test.refs.some(reference => reference.deref() === input));
    assert.equal(test.window.ImageMemory.reclaim(test.map),0);
    assert.equal(test.map.style.imageManager.images.pending.userImage,input);
    test.window.ImageMemory.tune.on = true;
    assert.equal(test.window.ImageMemory.reclaim(test.map),8);
    assert.equal(test.window.ImageMemory.reclaim(test.map),0);
    assert.equal(test.window.ImageMemory.stats(test.map).pendingImages,0);
    assert.deepEqual(bytes(input),before);
  });
  await check(`${mode}: stale/dead/replaced candidates`, () => {
    for (const change of ['dead','removed','replaced','mutated','userImage']) {
      const test = fixture({off:true},native), input = test.input();
      test.window.initFacades(test.map,[['pending',input]]);
      const manager = test.map.style.imageManager;
      if (change === 'dead') for (const reference of test.refs) reference.value = undefined;
      if (change === 'removed') test.map.removeImage('pending');
      if (change === 'replaced') { test.map.removeImage('pending'); test.map.addImage('pending',test.input()); }
      if (change === 'mutated') input.extra = true;
      if (change === 'userImage') manager.images.pending.userImage = test.input();
      test.window.ImageMemory.tune.on = true;
      assert.equal(test.window.ImageMemory.reclaim(test.map),0,change);
      assert.equal(test.window.ImageMemory.stats(test.map).pendingImages,0,change);
      if (manager.images.pending) assert.ok(manager.images.pending.userImage,change);
    }
  });
  await check(`${mode}: failed add and exception scope unwind`, () => {
    const failed = fixture({failed:true},native), rejected = failed.input(), before = bytes(rejected);
    failed.window.initFacades(failed.map,[['failed',rejected]]);
    assert.equal(failed.map.style.imageManager.images.failed,undefined);
    assert.equal(failed.window.ImageMemory.stats(failed.map).releasedImages,0);
    assert.deepEqual(bytes(rejected),before);
    const test = fixture({},native), original = test.input();
    test.map.addImage('duplicate',original);
    assert.throws(() => test.window.initFacades(test.map,[['duplicate',test.input()]]));
    assert.equal(test.map.style.imageManager.images.duplicate.userImage,original);
    const external = test.input(); test.map.addImage('external',external);
    assert.equal(test.map.style.imageManager.images.external.userImage,external);
    assert.equal(test.window.ImageMemory.stats(test.map).releasedImages,0);
  });
}
console.log(`PASS image-memory lifecycle: ${passed} groups; no browser/download/Git writes`);
if (!distribution) console.log('SKIP pinned distribution: set MAPLIBRE_DIST to existing audited local bundle');
