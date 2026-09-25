// CPU deployment-path regression for the real controller, loader and worker.
// Exact HTTP routes serve a tiny compiled fixture; all other URLs return 404.
// The worker/codec and ArrayBuffer transfer are real. Rendering uses a double.
// --break restores the old root-absolute default in an in-memory module only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Worker as NodeWorker } from 'node:worker_threads';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import * as T from '../buildings/node_modules/three/build/three.module.js';
import { encodeBuildingAsset } from '../../js/building-asset-codec.js';
import { fixtureAsset } from './building-fixtures.mjs';

const controllerURL = new URL('../../js/building-residency.js', import.meta.url);
let moduleURL = controllerURL;
if (process.argv.includes('--break')) {
  let source = await fs.readFile(controllerURL, 'utf8');
  const needle = "manifest:'./data/compiled-buildings/manifest.json'";
  assert.equal(source.split(needle).length, 2, 'negative control must alter the actual deployed default once');
  source = source.replace(needle, "manifest:'/data/compiled-buildings/manifest.json'");
  // Only relocate import specifiers for the in-memory module. Its dependencies
  // remain the unmodified production runtime and adapter.
  for (const name of ['building-asset-runtime.js', 'building-hero-adapter.js'])
    source = source.replaceAll("'./" + name + "'", JSON.stringify(new URL(name, controllerURL).href));
  moduleURL = new URL('data:text/javascript,' + encodeURIComponent(source));
}
const { createBuildingResidency } = await import(moduleURL);

const asset = fixtureAsset(), bytes = encodeBuildingAsset(asset);
const hash = createHash('sha256').update(bytes).digest('hex');
const entry = { id: asset.building.id, name: asset.building.name, key: 'fixture', hash,
  bytes: bytes.byteLength, file: asset.building.id + '.' + hash + '.fba', bounds: asset.building.bounds };
const manifest = { schemaVersion: 1, buildings: [entry] };
const manifestPath = 'data/compiled-buildings/manifest.json';
const projectURL = 'https://simeonvarg.github.io/austin-3d-explorer/';

const workerBridge = `
import { parentPort, workerData } from 'node:worker_threads';
import { webcrypto } from 'node:crypto';
Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
globalThis.fetch = async (url, options) => {
  const status = String(url) === workerData.assetURL ? workerData.assetStatus : 404;
  parentPort.postMessage({ kind: 'fetch', url: String(url), status, credentials: options.credentials });
  return new Response(status === 200 ? workerData.bytes : null, { status,
    headers: status === 200 ? { 'content-length': String(workerData.bytes.byteLength) } : {} });
};
globalThis.self = { postMessage(data, transfers = []) {
  parentPort.postMessage({ kind: 'terminal', data }, transfers);
} };
await import(workerData.moduleURL);
parentPort.on('message', async data => {
  try { await self.onmessage({ data }); }
  catch (error) { parentPort.postMessage({ kind: 'handler-error', error: String(error.stack || error) }); }
});
`;

function replaceGlobals(values) {
  const descriptors = Object.fromEntries(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  return () => { for (const [key, descriptor] of Object.entries(descriptors)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  } };
}

function environment(t, { documentURL, expectedManifest, config = {}, manifestStatus = 200, assetStatus = 200 }) {
  const expectedAsset = new URL(entry.file, new URL('.', expectedManifest)).href;
  const workers = [], manifestFetches = [], assetFetches = [], warnings = [], generated = [], uploads = [], workerErrors = [];
  let controller;
  class BrowserWorker {
    constructor(url) {
      this.messages = []; this.terminated = false;
      this.thread = new NodeWorker(new URL('data:text/javascript,' + encodeURIComponent(workerBridge)), {
        workerData: { moduleURL: String(url), assetURL: expectedAsset, assetStatus, bytes },
      });
      this.exited = new Promise(resolve => this.thread.once('exit', resolve));
      this.thread.on('message', message => {
        if (this.terminated) return;
        if (message.kind === 'fetch') assetFetches.push(message);
        else if (message.kind === 'terminal') this.onmessage?.({ data: message.data });
        else { workerErrors.push(message.error); this.onerror?.({ message: message.error, preventDefault() {} }); }
      });
      this.thread.on('error', error => {
        workerErrors.push(error.message); this.onerror?.({ message: error.message, preventDefault() {} });
      });
      workers.push(this);
    }
    postMessage(data) { assert.equal(this.terminated, false); this.messages.push(structuredClone(data)); this.thread.postMessage(data); }
    terminate() { if (!this.terminated) { this.terminated = true; void this.thread.terminate(); } }
  }
  class MapDouble extends EventEmitter {
    constructor() {
      super(); this.canvas = new EventEmitter();
      this.canvas.addEventListener = this.canvas.on.bind(this.canvas);
      this.canvas.removeEventListener = this.canvas.off.bind(this.canvas);
    }
    getCanvas() { return this.canvas; }
    getCenter() { return { lng: 0.5, lat: 0.5 }; }
    getZoom() { return 18.5; }
    triggerRepaint() {}
  }
  const map = new MapDouble(), renderer = {
    autoClear: true, target: null,
    getContext: () => ({ isContextLost: () => false }),
    getRenderTarget() { return this.target; }, setRenderTarget(value) { this.target = value; }, resetState() {},
    render(scene) { for (const mesh of scene.children) { assert.equal(mesh.geometry.drawRange.count, 0); uploads.push(mesh.geometry); } },
    initTexture() { assert.fail('the URL fixture has no textures'); },
  };
  const material = options => new T.MeshBasicMaterial(options);
  const slopes = { renderer, toLocal: (x, y, z) => ({ x, y, z }), material,
    uniforms: () => ({ u_sunDirection: { value: { x: 0, y: 0, z: 1 } } }) };
  const compile = async (spec, options) => {
    generated.push({ id: spec.id, coarse: !!options.coarse });
    const geometry = new T.BoxGeometry(1, 1, 0.25); geometry.translate(0.5, 0.5, 0.125);
    const group = new T.Group(); group.name = spec.id + (options.coarse ? '/coarse' : '/generated');
    group.add(new T.Mesh(geometry, material()));
    return { group, metadata: { id: spec.id, name: spec.name }, counts: { generationMs: 0, finalizationMs: 0 } };
  };
  const harnessConsole = Object.create(console);
  harnessConsole.warn = (...args) => warnings.push(args.join(' '));
  const restore = replaceGlobals({ Worker: BrowserWorker, location: { href: documentURL },
    BUILDING_RESIDENCY: undefined, SLOPES: undefined, console: harnessConsole,
    requestAnimationFrame: fn => setImmediate(() => fn(performance.now())), cancelAnimationFrame: clearImmediate,
    fetch: async url => {
      const status = String(url) === expectedManifest ? manifestStatus : 404;
      manifestFetches.push({ url: String(url), status });
      return new Response(status === 200 ? JSON.stringify(manifest) : null, { status });
    },
  });
  t.after(async () => {
    const state = controller?.snapshot();
    t.diagnostic(JSON.stringify({ documentURL, manifestFetches,
      workerRequests: workers.flatMap(worker => worker.messages.filter(message => message.type === 'load').map(message => message.url)),
      assetFetches, active: state?.records[0]?.active, compiled: state?.records[0]?.compiled,
      activeAssetHash: state?.records[0]?.activeAssetHash,
      failures: state?.events.filter(event => /failed|error/.test(event.type)).map(event => ({ type: event.type, error: event.error })) }));
    try {
      await controller?.dispose();
      for (const worker of workers) worker.terminate();
      await Promise.all(workers.map(worker => worker.exited));
      assert.equal(map.canvas.listenerCount('webglcontextlost'), 0);
      assert.equal(map.canvas.listenerCount('webglcontextrestored'), 0);
      assert.equal(map.listenerCount('move'), 0); assert.equal(map.listenerCount('render'), 0);
    } finally { restore(); }
  });
  return { expectedManifest, expectedAsset, workers, manifestFetches, assetFetches, warnings, generated, uploads, workerErrors,
    async open() {
      controller = await createBuildingResidency({ map, THREE: T, slopes, catalog: [{ id: entry.id, name: entry.name }], compile,
        config: { initialSliceMs: 0, buildSliceMs: 0, ...config } });
      return controller;
    },
  };
}

function assertRequests(env, status = 200) {
  assert.deepEqual(env.manifestFetches, [{ url: env.expectedManifest, status: 200 }], 'manifest must load from the deployed directory');
  const loads = env.workers.flatMap(worker => worker.messages.filter(message => message.type === 'load'));
  assert.equal(loads.length, 1, 'successful manifest resolution must reach the worker, not a generated fallback');
  assert.equal(loads[0].url, env.expectedAsset, 'asset paths resolve against the manifest directory');
  assert.equal(loads[0].expectedHash, hash); assert.equal(loads[0].expectedId, entry.id);
  assert.deepEqual(env.assetFetches, [{ kind: 'fetch', url: env.expectedAsset, status, credentials: 'same-origin' }],
    'the actual worker must fetch the same resolved asset URL');
  assert.deepEqual(env.workerErrors, []);
}

const successful = [
  { name: 'domain-root default', documentURL: 'https://city.example/', expectedManifest: 'https://city.example/' + manifestPath },
  { name: 'domain-root index with query/hash', documentURL: 'https://city.example/index.html?buildings=compiled#map', expectedManifest: 'https://city.example/' + manifestPath },
  { name: 'GitHub Pages project default', documentURL: projectURL, expectedManifest: projectURL + manifestPath },
  { name: 'project index with query/hash', documentURL: projectURL + 'index.html?buildings=compiled#map', expectedManifest: projectURL + manifestPath },
  { name: 'explicit relative manifest override', documentURL: projectURL, config: { manifest: './versions/v2/custom.json?revision=2' },
    expectedManifest: projectURL + 'versions/v2/custom.json?revision=2' },
  { name: 'explicit absolute manifest override', documentURL: projectURL, config: { manifest: 'https://assets.example/buildings/v2/custom.json' },
    expectedManifest: 'https://assets.example/buildings/v2/custom.json' },
  { name: 'explicit root-path manifest override', documentURL: projectURL, config: { manifest: '/shared/buildings/custom.json' },
    expectedManifest: 'https://simeonvarg.github.io/shared/buildings/custom.json' },
];
for (const scenario of successful) test(scenario.name, { concurrency: false }, async t => {
  const env = environment(t, scenario), controller = await env.open();
  if (scenario.config) assert.equal(controller.config.manifest, scenario.config.manifest, 'an explicit override remains authoritative');
  controller.start(); const state = await controller.settled({ timeoutMs: 10000 });
  assertRequests(env);
  assert.equal(state.records[0].active, true); assert.equal(state.records[0].compiled, true);
  assert.equal(state.records[0].activeAssetHash, hash, 'a usable fallback cannot stand in for the compiled payload');
  assert.equal(controller.group.children.length, 1); assert.equal(controller.group.children[0].userData.compiled, true);
  assert.equal(state.commits, 1); assert.equal(state.pending, null); assert.equal(state.stagingCpuBytes, 0);
  assert.deepEqual(env.generated, [{ id: entry.id, coarse: true }], 'successful deployments never invoke detailed fallback generation');
  assert.ok(env.uploads.length > 0, 'the decoded object reaches the real upload adapter');
  assert.equal(state.events.filter(event => event.type === 'decoded').length, 1);
  assert.deepEqual(state.events.filter(event => /failed|error/.test(event.type)), []);
  assert.deepEqual(env.warnings, []);
});

test('manifest 404 remains observable even when the generated fallback is usable', { concurrency: false }, async t => {
  const env = environment(t, { documentURL: projectURL, expectedManifest: projectURL + manifestPath, manifestStatus: 404 });
  const controller = await env.open(); controller.start(); const state = await controller.settled({ timeoutMs: 10000 });
  assert.deepEqual(env.manifestFetches, [{ url: env.expectedManifest, status: 404 }]);
  assert.equal(state.records[0].active, true, 'preserve the existing usable generated fallback');
  assert.equal(state.records[0].compiled, false); assert.equal(state.records[0].activeAssetHash, null);
  assert.ok(state.events.some(event => event.type === 'manifest-failed' && event.error === 'Compiled manifest HTTP 404'));
  assert.deepEqual(state.events.filter(event => event.type === 'committed').map(event => event.compiled), [false]);
  assert.deepEqual(env.generated.map(item => item.coarse), [true, false]);
  assert.equal(env.assetFetches.length, 0); assert.equal(env.workers.flatMap(worker => worker.messages).length, 0);
  assert.equal(state.pending, null); assert.equal(state.stagingCpuBytes, 0);
});

test('asset 404 preserves coarse geometry and cannot count as a compiled commit', { concurrency: false }, async t => {
  const env = environment(t, { documentURL: projectURL, expectedManifest: projectURL + manifestPath, assetStatus: 404 });
  const controller = await env.open(), coarse = controller.group.children[0];
  controller.start(); const state = await controller.settled({ timeoutMs: 10000 });
  assertRequests(env, 404);
  assert.equal(state.records[0].compiled, true); assert.equal(state.records[0].active, false);
  assert.equal(state.records[0].activeAssetHash, null); assert.equal(state.records[0].error, 'HTTP 404');
  assert.equal(controller.group.children.length, 1); assert.strictEqual(controller.group.children[0], coarse);
  assert.equal(state.commits, 0); assert.ok(state.events.some(event => event.type === 'failed' && event.error === 'HTTP 404'));
  assert.deepEqual(env.generated, [{ id: entry.id, coarse: true }]);
  assert.equal(env.warnings.length, 1); assert.match(env.warnings[0], /HTTP 404/);
  assert.equal(state.pending, null); assert.equal(state.stagingCpuBytes, 0);
});
