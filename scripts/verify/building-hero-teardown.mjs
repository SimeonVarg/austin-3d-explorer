// CPU teardown contracts for the production GDC host and compiled adapter.
// --adapter=<file> runs the same cases against a preserved pre-fix module.
// TestMap.remove follows MapLibre 5.24: delete style, mark removed, emit remove.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter, getEventListeners } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createCompilerRuntime } from '../buildings/runtime.mjs';
import { loadSelectedSpecs } from '../buildings/catalog.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ID = '44e418d6-dd3a-48da-8e9d-c29e59593299';
const copy = value => JSON.parse(JSON.stringify(value));
const argument = process.argv.find(value => value.startsWith('--adapter='));
const adapterURL = argument ? pathToFileURL(path.resolve(argument.slice(10))) : new URL('../../js/building-hero-adapter.js', import.meta.url);
const { BuildingHeroAdapter } = await import(adapterURL.href);

class TestMap extends EventEmitter {
  constructor() {
    super(); this.setMaxListeners(30);
    this.style = { _loaded: true }; this.sources = new Map(); this.layers = new Map();
    this.order = []; this.changes = []; this.repaints = 0; this.afterRemovalReads = [];
    this.canvas = new EventEmitter();
    this.canvas.addEventListener = this.canvas.on.bind(this.canvas);
    this.canvas.removeEventListener = this.canvas.off.bind(this.canvas);
    this.addLayer({ id: 'buildings-3d', type: 'fill-extrusion', filter: ['==', ['get', 'base'], 0] });
    this.addLayer({ id: 'buildings-roof', type: 'fill-extrusion' });
    this.addLayer({ id: 'labels', type: 'symbol' });
  }
  requireStyle(method) {
    if (!this.style) this.afterRemovalReads.push(method);
    assert(this.style?._loaded, method + ' touched the destroyed MapLibre style');
  }
  change(method, ...args) { this.requireStyle(method); this.changes.push({ method, args: copy(args) }); }
  getCanvas() { return this.canvas; }
  getStyle() { this.requireStyle('getStyle'); return { layers: this.order.map(id => this.layers.get(id).serialize()) }; }
  getLayer(id) { this.requireStyle('getLayer'); return this.layers.get(id); }
  addLayer(spec, before) {
    this.change('addLayer', spec, before || null); assert(!this.layers.has(spec.id));
    const stored = copy(spec);
    stored.serialize = () => { const { serialize, ...value } = stored; return copy(value); };
    this.layers.set(spec.id, stored);
    const index = before ? this.order.indexOf(before) : -1;
    this.order.splice(index < 0 ? this.order.length : index, 0, spec.id);
  }
  removeLayer(id) { this.change('removeLayer', id); this.layers.delete(id); this.order = this.order.filter(value => value !== id); }
  getSource(id) { this.requireStyle('getSource'); return this.sources.get(id); }
  addSource(id, spec) {
    this.change('addSource', id); assert(!this.sources.has(id));
    this.sources.set(id, { data: spec.data, loaded: false });
  }
  removeSource(id) {
    this.change('removeSource', id);
    assert(![...this.layers.values()].some(layer => layer.source === id), 'remove layers before their source');
    this.sources.delete(id);
  }
  isSourceLoaded(id) { this.requireStyle('isSourceLoaded'); return !!this.sources.get(id)?.loaded; }
  sourceContent(id) {
    this.sources.get(id).loaded = true;
    this.emit('sourcedata', { sourceId: id, sourceDataType: 'content' });
  }
  triggerRepaint() { this.repaints++; }
  getPaintProperty(id, key) { this.requireStyle('getPaintProperty'); return this.layers.get(id)?.paint?.[key]; }
  setPaintProperty(id, key, value) { this.change('setPaintProperty', id, key, value); (this.layers.get(id).paint ||= {})[key] = copy(value); }
  setLayoutProperty(id, key, value) { this.change('setLayoutProperty', id, key, value); (this.layers.get(id).layout ||= {})[key] = copy(value); }
  getFilter(id) { this.requireStyle('getFilter'); return this.layers.get(id)?.filter; }
  setFilter(id, value) { this.change('setFilter', id, value); this.layers.get(id).filter = copy(value); }
  setLayerZoomRange(id, minzoom, maxzoom) { this.change('setLayerZoomRange', id, minzoom, maxzoom); Object.assign(this.layers.get(id), { minzoom, maxzoom }); }
  getZoom() { return 18; }
  isStyleLoaded() { return !!this.style?._loaded; }
  remove({ exposeRemovedFlag = true } = {}) {
    delete this.style; this.sources.clear(); this.layers.clear(); this.order.length = 0;
    if (exposeRemovedFlag) this._removed = true;
    this.emit('remove');
  }
}

async function fixture(t) {
  const runtime = await createCompilerRuntime(ROOT);
  const [{ spec }] = await loadSelectedSpecs(ROOT, ['gdc']);
  const compiled = await runtime.compile(spec), context = runtime.context, root = new runtime.THREE.Group();
  const raw = JSON.parse(await fs.readFile(path.join(ROOT, 'data/heroes.geojson'), 'utf8'));
  context.slopes = { ...context.slopes, root, add: group => root.add(group), remove: group => root.remove(group), onSwitch() {} };
  context.fetch = async () => ({ ok: true, json: async () => copy(raw) });
  context.__flyRebuildCollision = () => {};
  context.CAP_GEOM = { height: height => ['+', height, .15], base: height => height };
  context.SLOPES.on = true;
  const map = new TestMap();
  await context.initHeroes(map);
  const host = context.HeroesAssetHost.get(map), adapters = [], states = [];
  assert(host, 'the production initHeroes installs its host');
  assert.equal(compiled.maplibre.featureCollection.features.length, 3881);
  const fallback = root.children[0], fallbackGdc = fallback.children.find(group => group.name === 'heroes-gdc-roof-undersides');
  const calls = { select: 0, removeSource: 0, attach: 0, detach: 0, fallbackDisposals: 0 };
  for (const method of ['select', 'removeSource']) {
    const original = host[method];
    host[method] = (...args) => { calls[method]++; return original(...args); };
  }
  fallback.traverse(object => object.geometry?.addEventListener('dispose', () => calls.fallbackDisposals++));
  const make = () => {
    const adapter = new BuildingHeroAdapter({ map, id: ID, host, onState: (state, detail) => states.push({ state, detail }) });
    adapters.push(adapter); return adapter;
  };
  const callbacks = {
    attach() { calls.attach++; root.add(compiled.group); },
    detach() { calls.detach++; root.remove(compiled.group); },
  };
  async function active() {
    const adapter = make(), preparation = adapter.prepare(compiled.maplibre.featureCollection);
    map.sourceContent(adapter.stats.sourceId); map.emit('render'); await preparation;
    adapter.commit(callbacks); return adapter;
  }
  // Cleanup also runs for the intentionally broken module; do not let a leaked
  // readiness timer conceal its assertion failure by keeping Node alive.
  t.after(() => {
    for (const adapter of adapters) {
      if (adapter.pending) clearTimeout(adapter.pending.timer);
      adapter.clearAbort?.(); adapter.unobserve?.();
    }
    map.removeAllListeners(); map.canvas.removeAllListeners();
    runtime.dispose(compiled);
    fallback.traverse(object => { object.geometry?.dispose(); object.material?.dispose(); });
  });
  return { runtime, context, map, host, root, fallback, fallbackGdc, compiled, calls, states, make, callbacks, active };
}

function cleanRemoval(f, adapter, before) {
  assert.equal(adapter.state, 'disposed'); assert.equal(adapter.disposed, true);
  assert.equal(adapter.record, null); assert.equal(adapter.callbacks, null); assert.equal(adapter.pending, null);
  assert.equal(adapter.payloadBytes, 0); assert.equal(adapter.ready, false);
  assert.equal(f.calls.select, before.select, 'map teardown must not select or restore a hero source');
  assert.equal(f.calls.removeSource, before.removeSource, 'the host owns already-destroyed style cleanup');
  assert.deepEqual(f.map.afterRemovalReads, [], 'teardown must not read the destroyed style');
  assert.equal(f.host.current, null); assert.equal(f.context.HeroesAssetHost.get(f.map), undefined);
  assert.equal(f.root.children.length, 0, 'both compiled and original groups detach');
  assert.equal(f.calls.fallbackDisposals, 2, 'GDC and NHB fallback geometry each dispose once');
  for (const type of ['sourcedata', 'render', 'error', 'styledata', 'style.load']) assert.equal(f.map.listenerCount(type), 0, type + ' listeners released');
  for (const type of ['webglcontextlost', 'webglcontextrestored']) assert.equal(f.map.canvas.listenerCount(type), 0, type + ' listeners released');
}

test('active GDC disposal before the host remove listener skips destroyed-style restoration', async t => {
  const f = await fixture(t), adapter = await f.active(), before = { ...f.calls };
  let laterCleanup = false;
  f.map.prependOnceListener('remove', () => adapter.dispose());
  f.map.once('remove', () => { laterCleanup = true; });
  assert.doesNotThrow(() => f.map.remove(), 'MapLibre removal must finish after style has been deleted');
  await Promise.resolve();
  cleanRemoval(f, adapter, before);
  assert.equal(f.calls.detach, 1); assert.equal(laterCleanup, true, 'adapter errors cannot strand later map owners');
  const after = { ...f.calls }; adapter.dispose(); assert.deepEqual(f.calls, after, 'disposal is idempotent');
});

test('host removal notification disposes an active GDC without relying on a map private flag', async t => {
  const f = await fixture(t), adapter = await f.active(), before = { ...f.calls };
  assert.doesNotThrow(() => f.map.remove({ exposeRemovedFlag: false }));
  await Promise.resolve(); cleanRemoval(f, adapter, before);
  assert.equal(f.calls.detach, 1);
  assert(!f.states.slice(-2).some(item => item.state === 'restored'), 'terminal removal is not fallback restoration');
});

test('map teardown rejects pending preparation and releases its abort listener and timer', async t => {
  const f = await fixture(t), adapter = f.make(), controller = new AbortController();
  const pending = adapter.prepare(f.compiled.maplibre.featureCollection, { signal: controller.signal });
  const rejected = assert.rejects(pending, error => error.name === 'AbortError');
  const timer = adapter.pending.timer, before = { ...f.calls };
  assert.equal(getEventListeners(controller.signal, 'abort').length, 1);
  f.map.prependOnceListener('remove', () => adapter.dispose());
  assert.doesNotThrow(() => f.map.remove()); await rejected;
  cleanRemoval(f, adapter, before);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  assert.equal(timer._destroyed, true, 'no readiness timeout survives map removal');
  assert.equal(f.calls.attach, 0); assert.equal(f.calls.detach, 0);
});

test('ordinary live-map disposal restores the retained original source and underside', async t => {
  const f = await fixture(t), baseline = f.map.getSource(f.host.originalSourceId), adapter = await f.active();
  const sourceId = adapter.record.sourceId, before = { ...f.calls };
  adapter.dispose();
  assert.equal(adapter.state, 'disposed'); assert.equal(f.host.current, null);
  assert.equal(f.map.getSource(f.host.originalSourceId), baseline, 'reuse the original rather than rebuilding it');
  assert.equal(f.fallbackGdc.visible, true); assert.equal(f.calls.detach, 1);
  assert.equal(f.calls.select, before.select + 1); assert.equal(f.calls.removeSource, before.removeSource + 1);
  assert.equal(f.calls.fallbackDisposals, 0); assert(!f.map.getSource(sourceId));
  for (const id of f.host.originalLayerIds) assert.equal(f.map.getPaintProperty(id, 'fill-extrusion-opacity'), 1);
  const next = await f.active(); next.dispose();
  assert.equal(f.map.getSource(f.host.originalSourceId), baseline, 'eviction and reentry keep the same fallback');
  f.map.remove();
});

test('temporary style unavailability still restores fallback ownership and defers source deletion', async t => {
  const f = await fixture(t), adapter = await f.active(), sourceId = adapter.record.sourceId;
  const before = { ...f.calls }, style = f.map.style;
  f.map.style = null;
  assert.doesNotThrow(() => adapter.dispose());
  assert.equal(f.host.current, null); assert.equal(f.fallbackGdc.visible, true);
  assert.equal(f.calls.select, before.select + 1); assert.equal(f.calls.removeSource, before.removeSource + 1);
  assert.deepEqual(f.map.afterRemovalReads, []); assert(f.map.sources.has(sourceId), 'style removal is deferred');
  f.map.style = style; f.map.emit('styledata'); await Promise.resolve();
  assert(!f.map.getSource(sourceId));
  for (const id of f.host.originalLayerIds) assert.equal(f.map.getPaintProperty(id, 'fill-extrusion-opacity'), 1);
  f.map.remove();
});

test('terminal detach failure still releases the adapter and allows other map cleanup', async t => {
  const f = await fixture(t), adapter = await f.active(), before = { ...f.calls };
  adapter.callbacks.detach = () => { f.callbacks.detach(); throw new Error('injected owner detach failure'); };
  let laterCleanup = false;
  f.map.prependOnceListener('remove', () => adapter.dispose());
  f.map.once('remove', () => { laterCleanup = true; });
  assert.doesNotThrow(() => f.map.remove());
  cleanRemoval(f, adapter, before);
  assert.equal(laterCleanup, true); assert.match(adapter.lastError, /injected owner detach failure/);
});
