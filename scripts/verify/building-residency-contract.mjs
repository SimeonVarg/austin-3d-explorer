// CPU contracts for the production loader/controller, using real Three 0.159.
// No WebGL context, browser, live map, or generated city is used here.
// --modules=<directory> can check a preserved pre-fix module snapshot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as T from '../buildings/node_modules/three/build/three.module.js';
import { WebGLAttributes } from '../buildings/node_modules/three/src/renderers/webgl/WebGLAttributes.js';
import { encodeBuildingAsset, decodeBuildingAsset } from '../../js/building-asset-codec.js';
import { fixtureAsset } from './building-fixtures.mjs';

const modulesArg = process.argv.find(arg => arg.startsWith('--modules='));
const modules = modulesArg ? pathToFileURL(path.resolve(modulesArg.slice(10)) + path.sep) : new URL('../../js/', import.meta.url);
const { buildingResources, canCastIntoDistrict, createBuildingResidency } = await import(new URL('building-residency.js', modules));
const { BuildingAssetLoader, createBuildingObject, uploadBuildingObject } = await import(new URL('building-asset-runtime.js', modules));
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate, message) {
  const end = performance.now() + 2000;
  while (!predicate()) { assert.ok(performance.now() < end, message); await tick(); }
}
function globals(t, replacements) {
  const descriptors = Object.fromEntries(Object.keys(replacements).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(replacements)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  return () => {
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  };
}
function versionedAsset(revision = 1, { id = 'fixture-a', x = 0 } = {}) {
  const source = fixtureAsset({ id }); source.source.hash = String(revision).repeat(64);
  if (x) {
    source.metadata.frame.O[0] += x; source.building.sphere.center[0] += x;
    for (const bounds of [source.building.bounds, ...source.parts.map(part => part.bounds)]) {
      bounds.min[0] += x; bounds.max[0] += x;
    }
    for (const part of source.parts) {
      const position = part.geometry.attributes.position.array;
      for (let i = 0; i < position.length; i += 3) position[i] += x;
    }
  }
  const bytes = encodeBuildingAsset(source), hash = createHash('sha256').update(bytes).digest('hex');
  const asset = decodeBuildingAsset(bytes);
  return { asset, bytes, entry: { id: asset.building.id, name: asset.building.name, key: 'fixture',
    hash, bytes: bytes.byteLength, file: asset.building.id + '.' + hash + '.fba', bounds: asset.building.bounds } };
}
function environment(t, { entries = [], catalog = [{ id: 'fixture-a', name: 'Fixture' }], compile: customCompile, manifest, fetchManifest, signal } = {}) {
  const workers = [], controllers = [], generated = [], materials = [], renders = [];
  class WorkerStub {
    constructor() { workers.push(this); this.messages = []; this.terminated = false; }
    postMessage(data) { assert.equal(this.terminated, false); this.messages.push(data); }
    terminate() { this.terminated = true; }
    deliver(data) { this.onmessage?.({ data }); }
    loads() { return this.messages.filter(m => m.type === 'load'); }
  }
  class MapStub extends EventEmitter {
    constructor() { super(); this.centre = { lng: 0, lat: 0 }; this.canvas = new EventEmitter();
      this.canvas.addEventListener = this.canvas.on.bind(this.canvas); this.canvas.removeEventListener = this.canvas.off.bind(this.canvas); }
    getCenter() { return this.centre; }
    getZoom() { return 18.5; }
    getCanvas() { return this.canvas; }
    triggerRepaint() {}
    moveTo(x, y) { this.centre = { lng: x, lat: y }; this.emit('move'); }
  }
  const map = new MapStub(), target = {}, renderer = {
    autoClear: true, target, lost: false, resets: 0, textures: [],
    getContext() { return { isContextLost: () => this.lost }; },
    getRenderTarget() { return this.target; }, setRenderTarget(value) { this.target = value; },
    resetState() { this.resets++; },
    render(scene) { for (const mesh of scene.children) { assert.equal(mesh.geometry.drawRange.count, 0); renders.push(mesh.geometry); } this.onRender?.(scene); },
    initTexture(texture) { this.textures.push(texture); },
  };
  const material = options => { const value = new T.MeshBasicMaterial(options); value.disposals = 0;
    value.addEventListener('dispose', () => value.disposals++); materials.push(value); return value; };
  const slopes = { renderer, toLocal: (x, y, z) => ({ x, y, z }), uniforms: () => ({ u_sunDirection: { value: { x: 0, y: 0, z: 1 } } }),
    material, facadeMaterial: () => material() };
  const generate = (spec, options) => {
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 1]), 3));
    if (spec.x) geometry.translate(spec.x, 0, 0);
    geometry.setIndex(new T.BufferAttribute(new Uint16Array([0, 1, 2]), 1));
    geometry.disposals = 0; geometry.addEventListener('dispose', () => geometry.disposals++);
    const group = new T.Group(); group.name = spec.id + (options.coarse ? '/coarse' : '/detailed');
    group.add(new T.Mesh(geometry, material()));
    const result = { group, metadata: { id: spec.id, name: spec.name }, counts: { generationMs: 0, finalizationMs: 0 }, triangles: 1 };
    generated.push(result); return result;
  };
  const compile = async (spec, options) => customCompile ? customCompile(spec, options, generate) : generate(spec, options);
  const restore = globals(t, { Worker: WorkerStub, location: { href: 'https://city.example/index.html' },
    SLOPES: undefined, BUILDING_RESIDENCY: undefined,
    fetch: fetchManifest || (async () => ({ ok: true, json: async () => manifest || { schemaVersion: 1, buildings: entries } })),
    requestAnimationFrame: callback => setImmediate(() => callback(performance.now())), cancelAnimationFrame: clearImmediate });
  t.after(async () => { for (const controller of controllers) await controller.dispose(); for (const worker of workers) worker.terminate(); restore(); });
  return { workers, generated, materials, renders, map, slopes, renderer,
    async open(config = {}) {
      const controller = await createBuildingResidency({ map, THREE: T, slopes, catalog, compile, signal,
        config: { buildSliceMs: 0, initialSliceMs: 0, ...config } });
      controllers.push(controller); return controller;
    } };
}

function watchOpening(promise) {
  const state = { settled: false, value: null, error: null };
  // Observe rejections immediately: a broken implementation can reject before
  // the test reaches its restoration event, without becoming an unhandled error.
  promise.then(value => { state.value = value; state.settled = true; },
    error => { state.error = error; state.settled = true; });
  return state;
}
function assertContextListeners(env, count, message) {
  for (const event of ['webglcontextlost', 'webglcontextrestored'])
    assert.equal(env.map.canvas.listenerCount(event), count, event + ': ' + message);
}
const observePause = () => new Promise(resolve => setTimeout(resolve, 20));
async function finishOpening(env, opening, abort) {
  env.renderer.lost = false; env.map.canvas.emit('webglcontextrestored'); abort.abort();
  await until(() => opening.settled, 'initialization responds to restoration or cancellation during cleanup');
  await opening.value?.dispose();
}

test('the projected-shadow margin retains every sampled caster, including distant low-sun shadows', () => {
  const bounds = { min: [1000, -30, 0], max: [1040, 30, 100] };
  for (const sun of [{ x: 1, y: 0, z: 0.01 }, { x: -0.7, y: 0.3, z: 0.4 }, { x: 0, y: 0, z: 1 }]) {
    for (const x of [bounds.min[0], bounds.max[0]]) for (const y of [bounds.min[1], bounds.max[1]]) {
      for (const z of [0, 25, 50, 75, 100]) {
        const projected = { x: x - z * sun.x / sun.z, y: y - z * sun.y / sun.z };
        assert.equal(canCastIntoDistrict(bounds, projected, 0.01, sun), true, 'a projected point of the actual volume cannot be culled');
      }
    }
  }
  assert.equal(canCastIntoDistrict(bounds, { x: -8980, y: 0 }, 1, { x: 1, y: 0, z: 0.01 }), true, 'a valid shadow reaches almost nine kilometres away');
  assert.equal(canCastIntoDistrict(bounds, { x: 0, y: 5000 }, 100, { x: 1, y: 0, z: 1 }), false);
  assert.equal(canCastIntoDistrict(bounds, { x: 1020, y: 0 }, 100, { x: 1, y: 0, z: 0 }), false);
  assert.equal(canCastIntoDistrict(bounds, { x: 1020, y: 0 }, 100, { x: 1, y: 0, z: -1 }), false);
});

test('CPU owners and GPU attributes follow distinct identities, with exact array-texture mip bytes', () => {
  const owner = new ArrayBuffer(512), group = new T.Group();
  const position = new T.BufferAttribute(new Float32Array(owner, 0, 9), 3);
  const colour = new T.BufferAttribute(new Float32Array(owner, 36, 9), 3);
  const index = new T.BufferAttribute(new Uint16Array(owner, 72, 3), 1);
  const first = new T.BufferGeometry(); first.setAttribute('position', position); first.setIndex(index);
  first.setAttribute('cDay', colour); first.setAttribute('cGold', colour);
  first.setAttribute('cNight', new T.BufferAttribute(colour.array, 3));
  const second = new T.BufferGeometry(); second.setAttribute('position', position); second.setIndex(index);
  const interleaved = new T.InterleavedBuffer(new Float32Array(owner, 80, 18), 6);
  const third = new T.BufferGeometry(); third.setAttribute('position', new T.InterleavedBufferAttribute(interleaved, 3, 0));
  third.setAttribute('normal', new T.InterleavedBufferAttribute(interleaved, 3, 3));
  for (const geometry of [first, second, third]) group.add(new T.Mesh(geometry));
  const pixels = new Uint8Array(owner, 256, 96);
  const day = new T.DataArrayTexture(pixels, 3, 4, 2), night = new T.DataArrayTexture(pixels, 3, 4, 2);
  day.generateMipmaps = night.generateMipmaps = true;
  group.children[0].userData.facadeBatch = { textures: { day, gold: day, night } };
  let allocated = 0;
  const gpu = WebGLAttributes({ createBuffer: () => ({}), bindBuffer() {}, bufferData(target, array) { allocated += array.byteLength; } }, { isWebGL2: true });
  group.traverse(o => { if (o.geometry) for (const a of [...Object.values(o.geometry.attributes), o.geometry.index].filter(Boolean)) gpu.update(a, 0); });
  const bytes = buildingResources(group);
  assert.equal(bytes.cpuBytes, 512, 'one retained ArrayBuffer, regardless of aliases or view ranges');
  assert.equal(bytes.geometryBytes, allocated, 'GPU bytes must match the real Three attribute cache');
  assert.equal(bytes.textureBytes, 192, 'two textures share pixel storage but own two GPU textures');
  assert.equal(bytes.textureGpuBytes, 2 * (3 * 4 + 1 * 2 + 1) * 2 * 4, 'non-square array mips keep all array layers');
  assert.equal(bytes.gpuBytes, allocated + bytes.textureGpuBytes);
});

test('runtime retains exact transferred Float16 views and disposes owned resources once', t => {
  const env = environment(t), asset = decodeBuildingAsset(encodeBuildingAsset(fixtureAsset({ packed: true })));
  asset.parts.push({ ...asset.parts[0], id: 'fixture-a/opaque/0001' });
  const object = createBuildingObject(asset, { THREE: T, slopes: env.slopes });
  const geometries = object.group.children.map(mesh => mesh.geometry), disposed = new Map();
  for (const geometry of geometries) {
    disposed.set(geometry, 0); geometry.addEventListener('dispose', () => disposed.set(geometry, disposed.get(geometry) + 1));
    for (const [name, source] of Object.entries(asset.parts[0].geometry.attributes)) {
      const target = geometry.getAttribute(name);
      assert.strictEqual(target.array, source.array, name + ' must use the transferred typed view');
      assert.equal(target.count, source.array.length / source.itemSize);
      assert.equal(!!target.isFloat16BufferAttribute, source.isFloat16);
    }
    assert.equal(geometry.getAttribute('aSurface').getX(0), 1, 'real Float16 getters still interpret the retained bits');
  }
  assert.equal(env.materials.length, 1, 'opaque parts share one owned material for the same side');
  object.dispose(); object.dispose();
  assert.ok([...disposed.values()].every(n => n === 1)); assert.equal(env.materials[0].disposals, 1); assert.equal(object.group.children.length, 0);
});

test('upload cancellation restores draw ranges and renderer state before disposing its temporary material', async t => {
  const env = environment(t), object = createBuildingObject(fixtureAsset({ filtered: true }), { THREE: T, slopes: env.slopes });
  const geometry = object.group.children[0].geometry, controller = new AbortController();
  geometry.setDrawRange(3, 3); const target = env.renderer.target;
  env.renderer.onRender = () => controller.abort();
  await assert.rejects(uploadBuildingObject(object, { THREE: T, slopes: env.slopes, map: env.map, signal: controller.signal }), { name: 'AbortError' });
  assert.deepEqual(geometry.drawRange, { start: 3, count: 3 });
  assert.strictEqual(env.renderer.target, target); assert.equal(env.renderer.autoClear, true);
  assert.equal(env.renderer.textures.length, 0, 'cancelled geometry slice never proceeds to its textures');
  assert.ok(env.renderer.resets >= 2); object.dispose();
});

test('production upload waits for renderer recovery, supports cancellation during the wait and has a bounded timeout', async t => {
  const env = environment(t), object = createBuildingObject(fixtureAsset(), { THREE: T, slopes: env.slopes });
  t.after(() => object.dispose());
  const geometry = object.group.children[0].geometry, drawRange = { ...geometry.drawRange };
  let repaintRequests = 0;
  env.slopes.renderer = null;
  env.map.triggerRepaint = () => { if (++repaintRequests === 2) env.slopes.renderer = env.renderer; };
  env.renderer.onRender = () => assert.ok(repaintRequests >= 2, 'rendering starts only after the live renderer arrives');
  await uploadBuildingObject(object, { THREE: T, slopes: env.slopes, map: env.map, rendererTimeoutMs: 2000 });
  assert.equal(env.renders.length, 1); assert.strictEqual(env.renders[0], geometry);
  assert.deepEqual(geometry.drawRange, drawRange);
  const rendered = env.renders.length, resets = env.renderer.resets, abort = new AbortController();
  env.renderer.lost = true; repaintRequests = 0;
  env.map.triggerRepaint = () => { repaintRequests++; queueMicrotask(() => abort.abort()); };
  await assert.rejects(uploadBuildingObject(object, { THREE: T, slopes: env.slopes, map: env.map,
    signal: abort.signal, rendererTimeoutMs: 2000 }), { name: 'AbortError' });
  assert.equal(repaintRequests, 1, 'abort occurs after waiting starts, before another render request');
  assert.equal(env.renders.length, rendered); assert.equal(env.renderer.resets, resets);
  env.renderer.lost = false; env.slopes.renderer = null; env.map.triggerRepaint = () => {};
  await assert.rejects(uploadBuildingObject(object, { THREE: T, slopes: env.slopes, map: env.map,
    rendererTimeoutMs: 20 }), /Building renderer did not recover/);
  assert.equal(env.renders.length, rendered); assert.equal(env.renderer.resets, resets);
  assert.deepEqual(geometry.drawRange, drawRange, 'unavailable-renderer paths leave the real geometry untouched');
});

test('loader cancellation retains its slot until ownership acknowledgement and ignores late responses', async t => {
  const env = environment(t), one = versionedAsset(1), two = versionedAsset(2);
  const events = [], loader = new BuildingAssetLoader({ concurrency: 1, onEvent: e => events.push(e) });
  t.after(() => loader.close()); const worker = env.workers[0], abort = new AbortController();
  const first = loader.load(one.entry, 'https://city.example/data/', { signal: abort.signal });
  const firstRejected = assert.rejects(first, { name: 'AbortError' });
  const second = loader.load(two.entry, 'https://city.example/data/');
  let firstSettled = false; first.catch(() => { firstSettled = true; });
  assert.equal(worker.loads().length, 1); abort.abort(); await Promise.resolve();
  assert.equal(firstSettled, false, 'active cancellation cannot release its reservation before the worker owner');
  assert.equal(loader.pending.size, 1); assert.equal(worker.loads().length, 1);
  assert.equal(worker.messages[1].type, 'cancel');
  worker.deliver({ type: 'cancelled', requestId: worker.loads()[0].requestId });
  await firstRejected; assert.equal(worker.loads().length, 2);
  worker.deliver({ type: 'loaded', requestId: worker.loads()[0].requestId, asset: one.asset, bytes: one.bytes.byteLength });
  worker.deliver({ type: 'loaded', requestId: worker.loads()[1].requestId, asset: two.asset, bytes: two.bytes.byteLength });
  assert.strictEqual((await second).asset, two.asset); assert.equal(events.filter(e => e.type === 'decoded').length, 1);
  const third = loader.load(one.entry, 'https://city.example/data/'); const thirdRejected = assert.rejects(third, { name: 'AbortError' });
  const thirdId = worker.loads().at(-1).requestId; loader.close(); await thirdRejected;
  worker.deliver({ type: 'loaded', requestId: thirdId, asset: one.asset });
  assert.equal(events.filter(e => e.type === 'decoded').length, 1); assert.equal(worker.terminated, true);
});

test('invalid loader declarations reject before they occupy a fetch slot', async t => {
  const env = environment(t), asset = versionedAsset(), loader = new BuildingAssetLoader({ concurrency: 1 });
  t.after(() => loader.close());
  for (const change of [{ bytes: -1 }, { bytes: NaN }, { bytes: 1.5 }, { hash: 'wrong' }, { id: '' }, { file: '' }]) {
    await assert.rejects(loader.load({ ...asset.entry, ...change }, 'https://city.example/data/'), /Invalid compiled building manifest entry/);
  }
  assert.equal(loader.pending.size, 0); assert.equal(loader.queue.length, 0); assert.equal(env.workers[0].loads().length, 0);
});

test('a malformed asset URL cannot poison the next valid fetch slot', async t => {
  const env = environment(t), fixture = versionedAsset(), loader = new BuildingAssetLoader({ concurrency: 1 });
  t.after(() => loader.close());
  await assert.rejects(loader.load({ ...fixture.entry, file: 'http://[' }, 'https://city.example/data/'));
  assert.equal(loader.pending.size, 0, 'rejected URL declarations cannot retain a pending slot');
  assert.equal(loader.queue.length, 0);
  const loaded = loader.load(fixture.entry, 'https://city.example/data/'), worker = env.workers[0];
  assert.equal(worker.loads().length, 1, 'a following valid request starts immediately');
  worker.deliver({ type: 'loaded', requestId: worker.loads()[0].requestId, asset: fixture.asset, bytes: fixture.bytes.byteLength });
  assert.strictEqual((await loaded).asset, fixture.asset);
});

test('real worker rejects oversized or truncated streams and transfers the authenticated owner exactly once', async t => {
  const fixture = versionedAsset(), posts = []; let cancelled = false, bodyMode = 'valid';
  const self = { postMessage(data, transfers) { posts.push({ data, transfers }); } };
  const restore = globals(t, { self, fetch: async () => {
    const data = bodyMode === 'oversized' ? new Uint8Array(fixture.bytes.length + 1) : fixture.bytes;
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(data.subarray(0, bodyMode === 'truncated' ? data.length - 1 : data.length));
      if (bodyMode !== 'oversized') controller.close();
    }, cancel() { cancelled = true; } }));
  } });
  t.after(restore);
  await import(new URL('building-asset-worker.js?cpu-contract=1', modules));
  const request = { type: 'load', requestId: 1, url: 'https://city.example/a.fba', expectedId: fixture.entry.id, expectedHash: fixture.entry.hash, maxBytes: fixture.bytes.length };
  await self.onmessage({ data: request });
  assert.equal(posts[0].data.type, 'loaded'); assert.equal(posts[0].transfers.length, 1);
  assert.strictEqual(posts[0].data.asset.parts[0].geometry.attributes.position.array.buffer, posts[0].transfers[0]);
  bodyMode = 'oversized'; await self.onmessage({ data: { ...request, requestId: 2 } });
  assert.equal(posts[1].data.type, 'error'); assert.match(posts[1].data.error, /byte limit/); assert.equal(cancelled, true);
  bodyMode = 'truncated'; await self.onmessage({ data: { ...request, requestId: 3 } });
  assert.equal(posts[2].data.type, 'error'); assert.match(posts[2].data.error, /byte length/);
  bodyMode = 'valid'; await self.onmessage({ data: { ...request, requestId: 4, expectedHash: '0'.repeat(64) } });
  assert.equal(posts[3].data.type, 'error'); assert.match(posts[3].data.error, /SHA-256 mismatch/);
});

test('a replacement requested during fetch cannot commit or cache the superseded asset', async t => {
  const before = versionedAsset(1), after = versionedAsset(2), env = environment(t, { entries: [before.entry] });
  const runtime = await env.open(), worker = env.workers[0]; runtime.start();
  await until(() => worker.loads().length === 1, 'first compiled fetch starts');
  const oldRequest = worker.loads()[0]; runtime.retry(before.entry.id, after.entry);
  worker.deliver({ type: 'loaded', requestId: oldRequest.requestId, asset: before.asset, bytes: before.bytes.byteLength });
  await until(() => worker.loads().length === 2 || runtime.snapshot().commits > 0, 'replacement progresses');
  assert.equal(runtime.snapshot().commits, 0, 'superseded request must not commit');
  assert.equal(worker.loads().length, 2, 'replacement hash must receive its own request');
  const next = worker.loads()[1]; assert.equal(next.expectedHash, after.entry.hash);
  worker.deliver({ type: 'loaded', requestId: next.requestId, asset: after.asset, bytes: after.bytes.byteLength });
  await runtime.settled({ timeoutMs: 2000 });
  assert.equal(runtime.snapshot().commits, 1); assert.equal(runtime.group.children.length, 1);
  assert.equal(runtime.group.children[0].userData.sourceHash, after.asset.source.hash);
  assert.ok(worker.messages.some(m => m.type === 'cancel' && m.requestId === oldRequest.requestId));
  env.map.moveTo(10000, 10000); await runtime.settled({ timeoutMs: 2000 });
  assert.equal(runtime.snapshot().records[0].active, false); assert.equal(runtime.snapshot().cachedIds.length, 1);
  env.map.moveTo(0, 0); await runtime.settled({ timeoutMs: 2000 });
  assert.equal(worker.loads().length, 2, 'return visit reuses only the current cached version');
  assert.equal(runtime.group.children[0].userData.sourceHash, after.asset.source.hash);
});

test('leaving the district cancels an in-flight asset and retains the coarse building', async t => {
  const fixture = versionedAsset(), env = environment(t, { entries: [fixture.entry] });
  const runtime = await env.open(), worker = env.workers[0], coarse = runtime.group.children[0]; runtime.start();
  await until(() => worker.loads().length === 1, 'asset fetch starts'); const requestId = worker.loads()[0].requestId;
  env.map.moveTo(10000, 10000);
  await until(() => worker.messages.some(m => m.type === 'cancel' && m.requestId === requestId), 'district departure cancels the active owner');
  assert.equal(runtime.snapshot().pending, fixture.entry.id, 'cancellation retains ownership until the worker acknowledges release');
  worker.deliver({ type: 'cancelled', requestId });
  await runtime.settled({ timeoutMs: 2000 });
  worker.deliver({ type: 'loaded', requestId, asset: fixture.asset, bytes: fixture.bytes.byteLength });
  assert.equal(runtime.snapshot().commits, 0); assert.equal(runtime.snapshot().pending, null);
  assert.strictEqual(runtime.group.children[0], coarse); assert.equal(runtime.group.children.length, 1);
  assert.ok(worker.messages.some(m => m.type === 'cancel' && m.requestId === requestId));
  await runtime.dispose(); assert.equal(worker.terminated, true); assert.equal(env.map.listenerCount('move'), 0);
  assert.equal(env.map.canvas.listenerCount('webglcontextlost'), 0); assert.equal(env.materials[0].disposals, 1);
});

test('context loss pauses queued fetch and generation work until restoration without an asset-error backoff', async t => {
  const fixture = versionedAsset(), env = environment(t, { entries: [fixture.entry], catalog: [
    { id: fixture.entry.id, name: 'Compiled', x: 0 }, { id: 'generated-b', name: 'Generated', x: 300 },
  ] });
  const runtime = await env.open({ retryMs: 60000 }), worker = env.workers[0]; runtime.start();
  await until(() => worker.loads().length === 1, 'first compiled fetch starts');
  const requestId = worker.loads()[0].requestId, generatedBeforeLoss = env.generated.length;
  // Queue a nearer local-generator candidate before the loss event. Cancelling
  // only the current fetch would let that queued refresh start fresh work.
  env.map.moveTo(300, 0); env.renderer.lost = true; env.map.canvas.emit('webglcontextlost');
  worker.deliver({ type: 'loaded', requestId, asset: fixture.asset, bytes: fixture.bytes.byteLength });
  await until(() => !runtime.snapshot().busy || env.generated.length > generatedBeforeLoss || worker.loads().length > 1,
    'context loss drains the current work without starting another candidate');
  assert.equal(env.generated.length, generatedBeforeLoss, 'queued local detail must not generate while the context is lost');
  assert.equal(worker.loads().length, 1, 'queued compiled detail must not fetch while the context is lost');
  assert.equal(runtime.snapshot().commits, 0); assert.equal(runtime.snapshot().contextLost, true);
  assert.ok(worker.messages.some(m => m.type === 'cancel' && m.requestId === requestId));
  runtime.refresh(); env.map.emit('render'); env.map.moveTo(0, 0);
  await tick(); await tick();
  assert.equal(env.generated.length, generatedBeforeLoss); assert.equal(worker.loads().length, 1);
  assert.equal(runtime.snapshot().pending, null, 'refresh and render callbacks cannot restart a paused request');
  const postMessage = worker.postMessage.bind(worker);
  worker.postMessage = data => {
    postMessage(data);
    if (data.type === 'load') queueMicrotask(() => worker.deliver({ type: 'loaded', requestId: data.requestId,
      asset: fixture.asset, bytes: fixture.bytes.byteLength }));
  };
  env.renderer.lost = false; env.map.canvas.emit('webglcontextrestored');
  await runtime.settled({ timeoutMs: 2000 });
  const snapshot = runtime.snapshot();
  assert.equal(snapshot.contextLost, false); assert.equal(snapshot.commits, 2);
  assert.ok(snapshot.records.every(r => r.active), 'both still-requested kinds resume without the 60-second retry delay');
  assert.equal(worker.loads().length, 2); assert.equal(env.generated.length, generatedBeforeLoss + 1);
  assert.ok(snapshot.events.every(e => e.type !== 'failed'), 'context interruption is not an asset failure');
  await runtime.dispose();
  assert.equal(env.map.canvas.listenerCount('webglcontextlost'), 0);
  assert.equal(env.map.canvas.listenerCount('webglcontextrestored'), 0);
});

test('malformed manifest entries keep the coarse fallback and release the owned worker on disposal', async t => {
  const env = environment(t, { manifest: { schemaVersion: 1, buildings: [null] } });
  let runtime;
  await assert.doesNotReject(async () => { runtime = await env.open(); },
    'a null manifest entry must use the coarse fallback instead of abandoning its worker');
  const coarse = env.generated[0].group, geometry = coarse.children[0].geometry;
  assert.strictEqual(runtime.group.children[0], coarse);
  assert.equal(runtime.snapshot().records[0].compiled, false);
  assert.equal(env.workers[0].loads().length, 0);
  await runtime.dispose();
  assert.equal(env.workers[0].terminated, true, 'the fallback controller retains and closes its worker');
  assert.equal(geometry.disposals, 1); assert.equal(env.materials[0].disposals, 1);
  assertContextListeners(env, 0, 'disposed fallback releases initialization listeners');
});

test('initialization observes context loss before the manifest await and resumes without generating while lost', async t => {
  const abort = new AbortController(); let resolveManifest;
  const response = new Promise(resolve => { resolveManifest = resolve; });
  const env = environment(t, { signal: abort.signal, fetchManifest: () => response });
  const opening = watchOpening(env.open({ retryMs: 60000 }));
  const releaseManifest = () => resolveManifest({ ok: true, json: async () => ({ schemaVersion: 1, buildings: [] }) });
  try {
    assertContextListeners(env, 1, 'loss must be observable before the first asynchronous boundary');
    env.renderer.lost = true; env.map.canvas.emit('webglcontextlost'); releaseManifest();
    await observePause();
    assert.equal(opening.settled, false, 'initialization waits for restoration instead of failing or completing while lost');
    assert.equal(env.generated.length, 0, 'the first coarse building cannot begin while the context is lost');
    assert.equal(env.workers[0].loads().length, 0);
    env.renderer.lost = false; env.map.canvas.emit('webglcontextrestored');
    await until(() => opening.settled, 'initialization resumes after restoring the manifest-wait loss');
    assert.ifError(opening.error);
    const runtime = opening.value; runtime.start(); await runtime.settled({ timeoutMs: 2000 });
    assert.equal(runtime.snapshot().commits, 1);
    assert.equal(env.generated.length, 2, 'one coarse and one detailed result are generated after restoration');
    assert.ok(runtime.snapshot().events.every(event => event.type !== 'failed'));
    await runtime.dispose(); assertContextListeners(env, 0, 'disposal releases both early listeners');
  } finally { releaseManifest(); await finishOpening(env, opening, abort); }
});

test('initialization retains completed coarse work across a later loss and resumes the current generator', async t => {
  const abort = new AbortController(); let paused = false, resumed = false, detailWhileLost = 0;
  const coarseCalls = [];
  const env = environment(t, { signal: abort.signal, catalog: [
    { id: 'fixture-a', name: 'First' }, { id: 'fixture-b', name: 'Second', x: 100 },
  ], compile: async (spec, options, generate) => {
    if (options.coarse) coarseCalls.push(spec.id); else if (env.renderer.lost) detailWhileLost++;
    const result = generate(spec, options);
    if (options.coarse && spec.id === 'fixture-b') {
      env.renderer.lost = true; env.map.canvas.emit('webglcontextlost'); paused = true;
      await options.pause(); resumed = true;
    }
    return result;
  } });
  const opening = watchOpening(env.open({ retryMs: 60000 }));
  try {
    await until(() => paused || opening.settled, 'second coarse generation reaches its controlled loss');
    assert.ifError(opening.error); assert.equal(paused, true);
    const first = env.generated[0].group, firstGeometry = first.children[0].geometry;
    assert.ok(first.parent, 'the earlier coarse building already belongs to the initializing scene');
    await observePause();
    // This mirrors the integration calling start as soon as construction ends.
    // A broken constructor would begin detail even though restoration never fired.
    opening.value?.start(); await observePause();
    assert.equal(resumed, false, 'the current coarse generator must stay paused until restoration');
    assert.equal(detailWhileLost, 0, 'completing construction must not start detail generation while lost');
    assert.equal(firstGeometry.disposals, 0, 'completed coarse work stays owned during the pause');
    env.renderer.lost = false; env.map.canvas.emit('webglcontextrestored');
    await until(() => opening.settled, 'the paused coarse generator resumes after restoration');
    assert.ifError(opening.error); assert.equal(resumed, true);
    const runtime = opening.value;
    assert.ok(runtime.group.children.includes(first), 'restoration retains the exact earlier coarse object');
    assert.deepEqual(coarseCalls, ['fixture-a', 'fixture-b'], 'restoration does not restart completed coarse generation');
    runtime.start(); await runtime.settled({ timeoutMs: 2000 });
    assert.equal(runtime.snapshot().commits, 2); assert.equal(detailWhileLost, 0);
    assert.ok(runtime.snapshot().events.every(event => event.type !== 'failed'));
    await runtime.dispose(); assert.equal(firstGeometry.disposals, 1);
    assertContextListeners(env, 0, 'resumed construction releases its listeners on disposal');
  } finally { await finishOpening(env, opening, abort); }
});

test('initialization detects an already-lost renderer without needing another loss event', async t => {
  const abort = new AbortController(), env = environment(t, { signal: abort.signal });
  env.renderer.lost = true;
  const opening = watchOpening(env.open());
  try {
    await observePause();
    assert.equal(env.generated.length, 0, 'an already-lost context cannot start coarse generation');
    assert.equal(opening.settled, false, 'initialization waits for the existing loss to restore');
    assertContextListeners(env, 1, 'the pending constructor owns restoration listeners');
    env.renderer.lost = false; env.map.canvas.emit('webglcontextrestored');
    await until(() => opening.settled, 'an initially lost renderer resumes on its restoration event');
    assert.ifError(opening.error);
    const runtime = opening.value; runtime.start(); await runtime.settled({ timeoutMs: 2000 });
    assert.equal(runtime.snapshot().commits, 1); assert.equal(runtime.snapshot().contextLost, false);
    await runtime.dispose(); assertContextListeners(env, 0, 'initially lost controller releases listeners');
  } finally { await finishOpening(env, opening, abort); }
});

test('failed initialization releases listeners, workers and completed coarse resources, including abort while lost', async t => {
  const abort = new AbortController(), env = environment(t, { signal: abort.signal });
  await assert.rejects(env.open({ cpuBytes: 1, gpuBytes: 1 }), /Coarse city exceeds/);
  assertContextListeners(env, 0, 'a budget failure removes early listeners');
  assert.equal(env.workers[0].terminated, true);
  assert.ok(env.materials.every(material => material.disposals === 1));
  const generatedBefore = env.generated.length;
  env.renderer.lost = true;
  const opening = watchOpening(env.open());
  try {
    await observePause();
    assertContextListeners(env, 1, 'a paused constructor owns listeners until it is cancelled');
    assert.equal(env.generated.length, generatedBefore);
    abort.abort(); await until(() => opening.settled, 'parent cancellation ends an initialization paused by context loss');
    assert.equal(opening.error?.name, 'AbortError');
    assert.equal(env.workers.at(-1).terminated, true, 'aborted initialization closes its worker');
    assertContextListeners(env, 0, 'aborted initialization removes both listeners');
    assert.ok(env.materials.every(material => material.disposals === 1));
  } finally { await finishOpening(env, opening, abort); }
});

test('staging and coarse budgets reject allocations while preserving or releasing their owned fallback', async t => {
  const fixture = versionedAsset(), env = environment(t, { entries: [fixture.entry] });
  const runtime = await env.open({ stagingBytes: fixture.bytes.byteLength - 1 }); runtime.start();
  await runtime.settled({ timeoutMs: 2000 });
  const snapshot = runtime.snapshot(); assert.match(snapshot.records[0].error, /staging budget/);
  assert.ok(snapshot.events.some(event => event.type === 'failed'), 'a declaration larger than the staging cap is a real rejection');
  assert.ok(snapshot.events.every(event => event.type !== 'budget-deferred'), 'hard staging limits cannot become a silent capacity deferral');
  assert.equal(snapshot.records[0].active, false); assert.equal(runtime.group.children.length, 1);
  assert.equal(env.workers[0].loads().length, 0, 'oversized staging declarations never fetch');
  assert.ok(snapshot.cpuBytes <= snapshot.limits.cpuBytes && snapshot.gpuBytes <= snapshot.limits.gpuBytes);
  await runtime.dispose();
  await assert.rejects(env.open({ cpuBytes: 1, gpuBytes: 1 }), /Coarse city exceeds/);
  assert.equal(env.workers.at(-1).terminated, true); assert.ok(env.materials.every(m => m.disposals === 1));
});

async function assertBudgetTravel(t, kind) {
  const first = versionedAsset(1), second = versionedAsset(1, { id: 'fixture-b', x: 300 });
  const env = environment(t, { entries: [first.entry, second.entry], catalog: [
    { id: first.entry.id, name: 'First', x: 0 }, { id: second.entry.id, name: 'Second', x: 300 },
  ] });
  // Two permanent coarse buffers plus exactly one detailed building fit.
  const bytes = 2 * (9 * 4 + 3 * 2) + (kind === 'gpu' ? first.asset.stats.geometryBytes : Math.max(first.entry.bytes, second.entry.bytes));
  const runtime = await env.open({ [kind + 'Bytes']: bytes, retryMs: 60000 }), worker = env.workers[0];
  const fixtures = new Map([[first.entry.id, first], [second.entry.id, second]]), postMessage = worker.postMessage.bind(worker);
  worker.postMessage = data => {
    postMessage(data);
    if (data.type === 'load') queueMicrotask(() => {
      const fixture = fixtures.get(data.expectedId);
      worker.deliver({ type: 'loaded', requestId: data.requestId, asset: fixture.asset, bytes: fixture.bytes.byteLength });
    });
  };
  const active = () => runtime.snapshot().records.filter(r => r.active).map(r => r.id);
  runtime.start(); await runtime.settled({ timeoutMs: 2000 });
  assert.deepEqual(active(), [first.entry.id]);
  assert.ok(runtime.snapshot().records.every(r => r.wanted), 'both candidates stay in the requested radius throughout travel');
  env.map.moveTo(300, 0); await runtime.settled({ timeoutMs: 2000 });
  assert.deepEqual(active(), [second.entry.id], 'nearer detail replaces farther resident detail despite the previous budget deferral');
  env.map.moveTo(0, 0); await runtime.settled({ timeoutMs: 2000 });
  assert.deepEqual(active(), [first.entry.id], 'returning detail does not wait for the 60-second asset-error backoff');
  const snapshot = runtime.snapshot();
  assert.ok(snapshot[kind === 'gpu' ? 'highWaterGpuBytes' : 'highWaterCpuBytes'] <= bytes, 'replacement staging stays within the ' + kind.toUpperCase() + ' budget');
  assert.ok(worker.loads().length <= 6, 'a stable camera cannot thrash between two requested buildings');
}

test('tight GPU budgets follow the nearer building and revisit deferred detail without the asset-error delay', t => assertBudgetTravel(t, 'gpu'));
test('temporary CPU preflight capacity defers without applying the asset-error delay', t => assertBudgetTravel(t, 'cpu'));

test('non-finite or non-positive primary budgets fail before creating a worker', async t => {
  const env = environment(t);
  for (const key of ['nearMetres', 'cpuBytes', 'gpuBytes', 'inactiveBytes', 'stagingBytes', 'chunkTriangles']) {
    for (const value of [0, -1, NaN, Infinity]) await assert.rejects(env.open({ [key]: value }), /Invalid building residency budget/);
  }
  assert.equal(env.workers.length, 0);
});

test('secondary controls reject invalid distances, scheduling and unbounded event history before allocation', async t => {
  const env = environment(t);
  for (const key of ['minNearMetres', 'maxNearMetres']) {
    for (const value of [0, -1, NaN, Infinity]) await assert.rejects(env.open({ [key]: value }), /Invalid building residency/);
  }
  for (const key of ['keepMarginMetres', 'buildSliceMs', 'initialSliceMs']) {
    for (const value of [-1, NaN, Infinity]) await assert.rejects(env.open({ [key]: value }), /Invalid building residency/);
  }
  for (const value of [0, -1, NaN, Infinity]) await assert.rejects(env.open({ retryMs: value }), /Invalid building residency/);
  for (const value of [NaN, Infinity, -Infinity]) await assert.rejects(env.open({ zoomReference: value }), /Invalid building residency/);
  for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(env.open({ eventLimit: value }), /Invalid building residency/);
  }
  await assert.rejects(env.open({ minNearMetres: 851, maxNearMetres: 850 }), /Invalid building residency/);
  assert.equal(env.workers.length, 0, 'invalid scheduling and radius declarations cannot start worker work');
  const runtime = await env.open({ keepMarginMetres: 0, buildSliceMs: 0, initialSliceMs: 0, retryMs: 1, zoomReference: 0, eventLimit: 1 });
  assert.equal(runtime.group.children.length, 1, 'finite zero slice durations and margins remain supported');
});
