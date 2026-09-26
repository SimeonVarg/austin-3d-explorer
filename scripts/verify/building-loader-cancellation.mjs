// CPU-only ownership regressions. The browser Worker bridge below runs the
// unmodified production worker/codec modules in a real Node worker thread.
// Only fetch and crypto completion timing are controlled; transfers are real.
// --modules=<dir> selects a preserved module snapshot for a pre-fix negative.
// --repo=<dir> lets an external copy of this test use the repo's test fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker as NodeWorker } from 'node:worker_threads';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const option = name => process.argv.find(arg => arg.startsWith('--' + name + '='))?.slice(name.length + 3);
const repo = option('repo') || fileURLToPath(new URL('../../', import.meta.url));
const modules = pathToFileURL(path.resolve(option('modules') || path.join(repo, 'js')) + path.sep);
const { BuildingAssetLoader } = await import(new URL('building-asset-runtime.js', modules));
const { createBuildingResidency } = await import(new URL('building-residency.js', modules));
const { encodeBuildingAsset } = await import(new URL('building-asset-codec.js', modules));
const { fixtureAsset } = await import(pathToFileURL(path.join(repo, 'scripts/verify/building-fixtures.mjs')));
const T = await import(pathToFileURL(path.join(repo, 'scripts/buildings/node_modules/three/build/three.module.js')));
const baseURL = 'https://city.example/data/';
const pause = () => new Promise(resolve => setTimeout(resolve, 10));
async function until(predicate, message) {
  const deadline = performance.now() + 5000;
  while (!predicate()) { assert.ok(performance.now() < deadline, message); await pause(); }
}
function observe(promise) {
  const state = { settled: false, count: 0 };
  promise.then(value => Object.assign(state, { value, settled: true, count: state.count + 1 }),
    error => Object.assign(state, { error, settled: true, count: state.count + 1 }));
  return state;
}
function replaceGlobals(values) {
  const old = Object.fromEntries(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  return () => { for (const [key, descriptor] of Object.entries(old)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  } };
}
function fixture() {
  const asset = fixtureAsset(), bytes = encodeBuildingAsset(asset), hash = createHash('sha256').update(bytes).digest('hex');
  return { bytes, entry: { id: asset.building.id, name: asset.building.name, key: 'fixture', hash,
    bytes: bytes.byteLength, file: asset.building.id + '.' + hash + '.fba', bounds: asset.building.bounds } };
}

const threadSource = `
import { parentPort, workerData } from 'node:worker_threads';
import { webcrypto } from 'node:crypto';
const hashes = new Map(); let serial = 0, peak = 0;
const control = data => parentPort.postMessage({ kind: 'control', ...data });
Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { subtle: {
  async digest(algorithm, input) {
    const number = ++serial; let release;
    const gate = new Promise(resolve => { release = resolve; });
    hashes.set(number, release); peak = Math.max(peak, hashes.size);
    control({ type: 'hash-start', number, active: hashes.size, peak, bytes: input.byteLength });
    try { await gate; return await webcrypto.subtle.digest(algorithm, input); }
    finally { input = null; hashes.delete(number); control({ type: 'hash-end', number, active: hashes.size, peak }); }
  }
} } });
globalThis.fetch = async (url, { signal }) => {
  control({ type: 'fetch-start', url });
  if (workerData.mode === 'fetch') {
    await new Promise((resolve, reject) => signal.addEventListener('abort',
      () => reject(new DOMException('Cancelled', 'AbortError')), { once: true }));
  }
  return new Response(new ReadableStream({
    start(controller) {
      if (workerData.mode === 'stream') {
        controller.enqueue(workerData.bytes.subarray(0, 8));
        signal.addEventListener('abort', () => controller.error(new DOMException('Cancelled', 'AbortError')), { once: true });
        control({ type: 'stream-wait' });
      } else { controller.enqueue(workerData.bytes); controller.close(); }
    },
    cancel() { control({ type: 'stream-cancelled' }); }
  }));
};
globalThis.self = { postMessage(data, transfers = []) {
  const lengths = transfers.map(buffer => buffer.byteLength);
  parentPort.postMessage({ kind: 'terminal', data }, transfers);
  if (transfers.length) control({ type: 'transferred', lengths, remaining: transfers.map(buffer => buffer.byteLength) });
} };
await import(workerData.moduleURL);
parentPort.on('message', async message => {
  if (message.kind === 'release') { hashes.get(message.number)?.(); return; }
  if (message.kind === 'release-all') { for (const release of hashes.values()) release(); return; }
  try { await self.onmessage({ data: message.data }); }
  catch (error) { control({ type: 'handler-error', error: String(error.stack || error) }); }
});
control({ type: 'ready' });
`;

function environment(t, { mode = 'hash', holdTerminal = false } = {}) {
  const asset = fixture(), workers = [], loaders = [];
  class BrowserWorker {
    constructor(url) {
      this.messages = []; this.controls = []; this.terminals = []; this.held = [];
      this.holdTerminal = holdTerminal; this.terminated = false;
      this.thread = new NodeWorker(new URL('data:text/javascript,' + encodeURIComponent(threadSource)), {
        workerData: { moduleURL: String(url), bytes: asset.bytes, mode },
      });
      this.exited = new Promise(resolve => this.thread.once('exit', resolve));
      this.thread.on('message', message => {
        if (this.terminated) return;
        if (message.kind === 'control') this.controls.push(message);
        else {
          this.terminals.push({ type: message.data.type, requestId: message.data.requestId });
          if (this.holdTerminal) this.held.push(message.data); else this.deliver(message.data);
        }
      });
      this.thread.on('error', error => this.onerror?.({ message: error.message, preventDefault() {} }));
      workers.push(this);
    }
    postMessage(data) { assert.equal(this.terminated, false); this.messages.push(structuredClone(data)); this.thread.postMessage({ kind: 'request', data }); }
    terminate() { if (this.terminated) return; this.terminated = true; this.held.length = 0; void this.thread.terminate(); }
    deliver(data) { this.onmessage?.({ data }); }
    deliverNext() { const data = this.held.shift(); assert.ok(data, 'a terminal packet is waiting'); this.deliver(data); return data; }
    release(number) { this.thread.postMessage({ kind: 'release', number }); }
    loads() { return this.messages.filter(message => message.type === 'load'); }
    hashes() { return this.controls.filter(message => message.type === 'hash-start'); }
  }
  const restore = replaceGlobals({ Worker: BrowserWorker });
  t.after(async () => {
    for (const loader of loaders) loader.close();
    for (const worker of workers) worker.terminate();
    await Promise.all(workers.map(worker => worker.exited)); restore();
  });
  return { asset, workers, open(options = {}) {
    const loader = new BuildingAssetLoader({ concurrency: 1, ...options }); loaders.push(loader); return loader;
  } };
}

test('repeated active aborts retain the single hash owner, while queued aborts release immediately', async t => {
  const env = environment(t), events = [], loader = env.open({ onEvent: event => events.push(event) }), worker = env.workers[0];
  const aborts = Array.from({ length: 6 }, () => new AbortController());
  const loads = aborts.map(abort => observe(loader.load(env.asset.entry, baseURL, { signal: abort.signal })));
  const survivor = observe(loader.load(env.asset.entry, baseURL));
  const queuedAbort = new AbortController(), queued = observe(loader.load(env.asset.entry, baseURL, { signal: queuedAbort.signal }));
  queuedAbort.abort(); await until(() => queued.settled, 'queued cancellation completes without worker acknowledgement');
  assert.equal(queued.error.name, 'AbortError'); assert.equal(worker.loads().length, 1);
  for (let i = 0; i < aborts.length; i++) {
    await until(() => worker.hashes().length === i + 1, 'the next admitted request reaches hashing');
    aborts[i].abort(); aborts[i].abort(); await pause();
    assert.equal(loads[i].settled, false, 'active cancellation cannot release its reservation before hashing completes');
    assert.equal(loader.pending.size, 1, 'cancelled hash still occupies the concurrency slot');
    assert.equal(worker.loads().length, i + 1, 'queued requests must not pass the retiring hash');
    worker.release(i + 1); await until(() => loads[i].settled, 'worker cancellation acknowledgement settles the caller');
    assert.equal(loads[i].error.name, 'AbortError'); assert.equal(loads[i].count, 1);
  }
  await until(() => worker.hashes().length === 7, 'survivor begins after all retiring owners finish');
  worker.release(7); await until(() => survivor.settled, 'survivor receives its decoded asset');
  assert.equal(survivor.error, undefined); assert.equal(survivor.value.asset.building.id, env.asset.entry.id);
  await until(() => worker.controls.some(event => event.type === 'transferred'), 'real transfer diagnostic arrived');
  assert.equal(Math.max(...worker.hashes().map(event => event.peak)), 1, 'actual worker hash ownership respects concurrency: 1');
  assert.equal(worker.terminals.filter(event => event.type === 'cancelled').length, 6);
  assert.equal(worker.messages.filter(event => event.type === 'cancel').length, 6, 'duplicate aborts never duplicate cancellation');
  assert.equal(events.filter(event => event.type === 'cancelled').length, 7);
  assert.equal(events.filter(event => event.type === 'decoded').length, 1);
  const transfer = worker.controls.find(event => event.type === 'transferred');
  assert.deepEqual(transfer.lengths, [env.asset.bytes.byteLength]); assert.deepEqual(transfer.remaining, [0]);
  assert.equal(loader.pending.size, 0); assert.equal(loader.queue.length, 0);
});

test('retiring hashes continue to count against multiple worker slots', async t => {
  const env = environment(t), loader = env.open({ concurrency: 2 }), worker = env.workers[0];
  const aborts = [new AbortController(), new AbortController()];
  const first = aborts.map(abort => observe(loader.load(env.asset.entry, baseURL, { signal: abort.signal })));
  const queued = observe(loader.load(env.asset.entry, baseURL));
  await until(() => worker.hashes().length === 2, 'both slots hold real hashes');
  for (const abort of aborts) abort.abort(); await pause();
  assert.equal(loader.pending.size, 2); assert.equal(worker.loads().length, 2);
  assert.ok(first.every(state => !state.settled), 'neither reservation retires early');
  worker.release(1); await until(() => first[0].settled && worker.hashes().length === 3, 'one acknowledgement admits exactly one request');
  assert.equal(first[1].settled, false); worker.release(2); worker.release(3);
  await until(() => first[1].settled && queued.settled, 'remaining work completes');
  assert.equal(queued.error, undefined); assert.equal(Math.max(...worker.hashes().map(event => event.peak)), 2);
});

for (const terminal of ['loaded', 'error']) test(terminal + ' response racing an abort releases once without publishing stale data', async t => {
  const env = environment(t, { holdTerminal: true }), events = [], loader = env.open({ onEvent: event => events.push(event) });
  const worker = env.workers[0], abort = new AbortController();
  const entry = terminal === 'error' ? { ...env.asset.entry, hash: '0'.repeat(64) } : env.asset.entry;
  const first = observe(loader.load(entry, baseURL, { signal: abort.signal }));
  const next = observe(loader.load(env.asset.entry, baseURL));
  await until(() => worker.hashes().length === 1, 'first response awaits hashing'); worker.release(1);
  await until(() => worker.held.length === 1, 'terminal response is in transit to the main thread');
  assert.equal(worker.held[0].type, terminal);
  if (terminal === 'loaded') assert.equal(worker.held[0].asset.parts[0].geometry.attributes.position.array.buffer.byteLength, env.asset.bytes.byteLength);
  abort.abort(); await pause();
  assert.equal(first.settled, false, 'an in-flight terminal packet still owns the reservation');
  assert.equal(worker.loads().length, 1);
  const packet = worker.deliverNext(); await until(() => first.settled, 'raced terminal acknowledges cancellation');
  assert.equal(first.error.name, 'AbortError'); assert.equal(packet.asset, null, 'stale transferred owner is discarded');
  worker.deliver(packet); worker.deliver({ type: 'cancelled', requestId: packet.requestId });
  await until(() => worker.hashes().length === 2, 'next request begins'); worker.release(2);
  await until(() => worker.held.length === 1, 'next valid terminal packet arrives'); worker.deliverNext();
  await until(() => next.settled, 'next request is unaffected by duplicate stale responses');
  assert.equal(first.count, 1); assert.equal(next.error, undefined);
  assert.equal(events.filter(event => event.type === 'cancelled').length, 1);
  assert.equal(events.filter(event => event.type === 'decoded').length, 1);
});

test('a cancelled hash failure acknowledges retirement instead of surfacing a content error', async t => {
  const env = environment(t), loader = env.open(), worker = env.workers[0], abort = new AbortController();
  const first = observe(loader.load({ ...env.asset.entry, hash: '0'.repeat(64) }, baseURL, { signal: abort.signal }));
  await until(() => worker.hashes().length === 1, 'bad hash remains nonabortable'); abort.abort(); await pause();
  assert.equal(first.settled, false); worker.release(1);
  await until(() => first.settled, 'failed hash owner retires'); assert.equal(first.error.name, 'AbortError');
  assert.deepEqual(worker.terminals.map(event => event.type), ['cancelled']); assert.equal(loader.pending.size, 0);
});

for (const mode of ['fetch', 'stream']) test('cancellation during ' + mode + ' returns one terminal acknowledgement', async t => {
  const env = environment(t, { mode }), loader = env.open(), worker = env.workers[0], abort = new AbortController();
  const state = observe(loader.load(env.asset.entry, baseURL, { signal: abort.signal }));
  await until(() => worker.controls.some(event => event.type === (mode === 'fetch' ? 'fetch-start' : 'stream-wait')), 'worker has begun the controlled response');
  abort.abort(); await until(() => state.settled, 'abort releases the fetch/stream owner');
  assert.equal(state.error.name, 'AbortError'); assert.equal(state.count, 1);
  assert.deepEqual(worker.terminals.map(event => event.type), ['cancelled']); assert.equal(worker.hashes().length, 0);
  assert.equal(loader.pending.size, 0); assert.equal(worker.controls.some(event => event.type === 'handler-error'), false);
});

for (const reason of ['close', 'error', 'messageerror']) test(reason + ' terminates hash owners before draining active and queued reservations', async t => {
  const env = environment(t), loader = env.open({ concurrency: 2 }), worker = env.workers[0], abort = new AbortController();
  const first = observe(loader.load(env.asset.entry, baseURL, { signal: abort.signal }));
  const second = observe(loader.load(env.asset.entry, baseURL)), queued = observe(loader.load(env.asset.entry, baseURL));
  await until(() => worker.hashes().length === 2, 'two active buffers are held by hashing'); abort.abort(); await pause();
  assert.equal(first.settled, false);
  if (reason === 'close') loader.close();
  else worker['on' + reason]({ message: 'deliberate worker failure', preventDefault() {} });
  assert.equal(worker.terminated, true, 'termination precedes promise rejection handlers');
  await until(() => [first, second, queued].every(state => state.settled), 'all reservations drain');
  assert.equal(first.error.name, 'AbortError');
  for (const state of [second, queued]) assert.match(state.error.message, reason === 'close' ? /Closed/ : /deliberate worker failure/);
  assert.equal(loader.closed, true); assert.equal(loader.pending.size, 0); assert.equal(loader.queue.length, 0);
  loader.close(); worker.deliver({ type: 'loaded', requestId: 1, asset: { forbidden: true } });
  assert.ok([first, second, queued].every(state => state.count === 1));
  await assert.rejects(loader.load(env.asset.entry, baseURL), /closed/);
});

test('real residency retains cancelled asset bytes until acknowledgement, and disposal terminates a later hash', async t => {
  const env = environment(t), canvas = new EventEmitter(), map = new EventEmitter();
  canvas.addEventListener = canvas.on.bind(canvas); canvas.removeEventListener = canvas.off.bind(canvas);
  map.getCanvas = () => canvas; map.getCenter = () => ({ lng: 0, lat: 0 }); map.getZoom = () => 18.5; map.triggerRepaint = () => {};
  const renderer = { autoClear: true, getContext: () => ({ isContextLost: () => false }),
    getRenderTarget: () => null, setRenderTarget() {}, resetState() {}, render() {}, initTexture() {} };
  const slopes = { renderer, material: options => new T.MeshBasicMaterial(options),
    toLocal: (x, y, z) => ({ x, y, z }), uniforms: () => ({ u_sunDirection: { value: { x: 0, y: 0, z: 1 } } }) };
  const restore = replaceGlobals({ location: { href: 'https://city.example/index.html' }, BUILDING_RESIDENCY: undefined,
    fetch: async () => ({ ok: true, json: async () => ({ schemaVersion: 1, buildings: [env.asset.entry] }) }),
    requestAnimationFrame: callback => setImmediate(() => callback(performance.now())) });
  let residency;
  t.after(async () => { await residency?.dispose(); restore(); });
  residency = await createBuildingResidency({ map, THREE: T, slopes, catalog: [{ id: env.asset.entry.id, name: 'Fixture' }],
    config: { initialSliceMs: 0, buildSliceMs: 0 }, compile: async spec => {
      const group = new T.Group(), geometry = new T.BufferGeometry();
      geometry.setAttribute('position', new T.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 1]), 3));
      group.add(new T.Mesh(geometry, new T.MeshBasicMaterial()));
      return { group, metadata: { id: spec.id }, counts: { generationMs: 0, finalizationMs: 0 }, triangles: 1 };
    } });
  residency.start(); const worker = env.workers[0];
  await until(() => worker.hashes().length === 1, 'residency owns a compiled asset hash');
  const initial = residency.snapshot(); assert.equal(initial.stagingCpuBytes, env.asset.bytes.byteLength);
  residency.evict(env.asset.entry.id, { forget: true }); await pause();
  const cancelled = residency.snapshot();
  assert.equal(cancelled.stagingCpuBytes, env.asset.bytes.byteLength, 'cancelled decode bytes remain reserved until actual worker completion');
  assert.equal(cancelled.cpuBytes, initial.cpuBytes); assert.equal(cancelled.pending, env.asset.entry.id);
  assert.equal(cancelled.busy, true); assert.equal(cancelled.records[0].active, false);
  worker.release(1); const settled = await residency.settled({ timeoutMs: 5000 });
  assert.equal(settled.stagingCpuBytes, 0); assert.equal(settled.pending, null); assert.equal(settled.inactiveBytes, 0);
  assert.equal(settled.cpuBytes, initial.cpuBytes - env.asset.bytes.byteLength); assert.equal(settled.records[0].coarse, true);
  residency.retry(env.asset.entry.id); await until(() => worker.hashes().length === 2, 'a later residency request begins');
  const disposed = residency.dispose(); assert.equal(worker.terminated, true); await disposed;
  const final = residency.snapshot(); assert.equal(final.closed, true); assert.equal(final.pending, null);
  assert.equal(final.cpuBytes, 0); assert.equal(final.stagingCpuBytes, 0);
});
