// CPU contract for the actual hero host, generator, and compiled adapter.
// --gpu --out <outside-repo> additionally verifies the real full-city map.
// --break deliberately leaves the original selected at commit and must fail.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { createCompilerRuntime } from '../buildings/runtime.mjs';
import { loadSelectedSpecs } from '../buildings/catalog.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ID = '44e418d6-dd3a-48da-8e9d-c29e59593299';
const copy = value => JSON.parse(JSON.stringify(value));
const adapterURL = new URL('../../js/building-hero-adapter.js', import.meta.url);
let adapterModule = adapterURL.href;
if (process.argv.includes('--break')) {
  const source = await fs.readFile(adapterURL, 'utf8');
  assert(source.includes('this.host.select(this.record);'));
  adapterModule = 'data:text/javascript;base64,' + Buffer.from(source.replace('this.host.select(this.record);', 'this.host.select(null);')).toString('base64');
}
const { BuildingHeroAdapter } = await import(adapterModule);

class TestMap extends EventEmitter {
  constructor() {
    super(); this.setMaxListeners(30);
    this.style = { _loaded: true }; this.layers = new Map(); this.sources = new Map();
    this.order = []; this.changes = []; this.canvas = new EventEmitter(); this.images = new Set();
    this.canvas.addEventListener = this.canvas.on.bind(this.canvas);
    this.canvas.removeEventListener = this.canvas.off.bind(this.canvas);
    this.addLayer({ id: 'buildings-3d', type: 'fill-extrusion', filter: ['==', ['get', 'base'], 0] });
    this.addLayer({ id: 'buildings-roof', type: 'fill-extrusion' });
    this.addLayer({ id: 'labels', type: 'symbol' });
    this.repaints = 0;
  }
  change(method, ...args) {
    assert(this.style?._loaded, 'no mutation while the style is unavailable');
    this.changes.push({ method, args: copy(args) });
    if (this.failWhen?.(method, ...args)) { this.failWhen = null; throw Error('injected style failure'); }
  }
  getCanvas() { return this.canvas; }
  getStyle() { return { layers: this.order.map(id => this.layers.get(id).serialize()) }; }
  getLayer(id) { assert(this.style, 'no layer read while style is null'); return this.layers.get(id); }
  addLayer(spec, before) {
    this.change('addLayer', spec, before || null); assert(!this.layers.has(spec.id));
    const stored = copy(spec); stored.serialize = () => { const { serialize, ...value } = stored; return copy(value); };
    this.layers.set(spec.id, stored);
    const index = before ? this.order.indexOf(before) : -1;
    this.order.splice(index < 0 ? this.order.length : index, 0, spec.id);
  }
  removeLayer(id) { this.change('removeLayer', id); this.layers.delete(id); this.order = this.order.filter(v => v !== id); }
  getSource(id) { assert(this.style, 'no source read while style is null'); return this.sources.get(id); }
  addSource(id, spec) {
    this.change('addSource', id, { type: spec.type }); assert(!this.sources.has(id));
    this.sources.set(id, { _data: spec.data, loaded: false, serialize: () => ({ ...spec, data: spec.data }) });
  }
  removeSource(id) {
    this.change('removeSource', id);
    assert(![...this.layers.values()].some(l => l.source === id), 'remove layers before their source');
    this.sources.delete(id);
  }
  isSourceLoaded(id) { return !!this.sources.get(id)?.loaded; }
  sourceContent(id, loaded = true) { this.sources.get(id).loaded = loaded; this.emit('sourcedata', { sourceId: id, sourceDataType: 'content' }); }
  triggerRepaint() { this.repaints++; }
  getPaintProperty(id, key) { return this.layers.get(id)?.paint?.[key]; }
  setPaintProperty(id, key, value) { this.change('setPaintProperty', id, key, value); (this.layers.get(id).paint ||= {})[key] = copy(value); }
  setLayoutProperty(id, key, value) { this.change('setLayoutProperty', id, key, value); (this.layers.get(id).layout ||= {})[key] = copy(value); }
  getFilter(id) { return this.layers.get(id)?.filter; }
  setFilter(id, filter) { this.change('setFilter', id, filter); this.layers.get(id).filter = copy(filter); }
  setLayerZoomRange(id, minzoom, maxzoom) { this.change('setLayerZoomRange', id, minzoom, maxzoom); Object.assign(this.layers.get(id), { minzoom, maxzoom }); }
  getZoom() { return 18; }
  isStyleLoaded() { return !!this.style?._loaded; }
}

async function fixture() {
  const runtime = await createCompilerRuntime(ROOT);
  const [{ spec }] = await loadSelectedSpecs(ROOT, ['gdc']);
  const compiled = await runtime.compile(spec), context = runtime.context;
  const root = new runtime.THREE.Group(), hooks = [], collisions = [];
  context.slopes = { ...context.slopes, root, add: group => root.add(group), remove: group => root.remove(group), onSwitch: fn => hooks.push(fn) };
  const raw = JSON.parse(await fs.readFile(path.join(ROOT, 'data/heroes.geojson'), 'utf8'));
  context.fetch = async () => ({ ok: true, json: async () => copy(raw) });
  context.__flyRebuildCollision = value => collisions.push(value);
  context.CAP_GEOM = { height: h => ['+', h, .15], base: h => h };
  context.SLOPES.on = true;
  const map = new TestMap();
  const ring = [[-97.74, 30.29], [-97.7399, 30.29], [-97.7399, 30.2901], [-97.74, 30.29]];
  const apartment = { type: 'Feature', properties: { id: 'apartment', name: 'Apartment', h: 12 }, geometry: { type: 'Polygon', coordinates: [ring] } };
  map.addSource('austin-buildings', { type: 'geojson', data: { type: 'FeatureCollection', features: [apartment] } });
  context.slopesApartments = { built: [{ id: 'apartment', name: 'Apartment', top: 60 }], data: { buildings: [{ id: 'apartment', footprint: { ring } }] } };
  await context.initHeroes(map);
  const host = context.HeroesAssetHost.get(map);
  assert(host, 'real initHeroes installs the asset host');
  const states = [];
  const make = () => new BuildingHeroAdapter({ map, id: ID, host, onState: (state, detail) => states.push({ state, detail }) });
  return { runtime, compiled, context, map, host, root, hooks, collisions, states, make, fc: compiled.maplibre.featureCollection };
}

async function cpu() {
  const f = await fixture(), { map, host, root, context, fc } = f;
  const baseline = map.getSource(host.originalSourceId), originalLayers = host.originalLayerIds;
  const originalGroup = root.children[0], originalGdc = originalGroup.children.find(g => g.name === 'heroes-gdc-roof-undersides');
  const originalOther = originalGroup.children.find(g => g !== originalGdc);
  assert.equal(fc.features.length, 3881, 'real authored GDC fixture');
  assert.deepEqual(copy(baseline._data), copy(fc), 'the independent original source equals the compiled source');
  assert(map.getSource('austin-heroes')._data.features.every(v => v.properties.b !== 'gdc'), 'GDC is not duplicated in the shared hero source');
  assert.equal(originalLayers.length, 4, 'solid, clear glass, brick, caps in the current authored GDC');
  assert.equal(context.__heroes.roofUndersides.roofs, 4, 'NHB deck and all three GDC underside planes');
  assert.equal(host.fallbackStats.roofs, 3);
  assert(host.fallbackStats.geometryCpuBytes > 0);
  assert.equal(host.fallbackStats.maplibreGpuBytes, null);
  assert.equal(originalGroup.userData.retainGeometryCpu, true);
  const originalGeometry = originalGdc.children[0].geometry, compiledGeometry = f.compiled.group.children[0].geometry;
  for (const [key, attr] of Object.entries(originalGeometry.attributes)) {
    assert.deepEqual(Array.from(attr.array), Array.from(compiledGeometry.attributes[key].array), 'compiled underside attribute ' + key);
  }
  assert.deepEqual(Array.from(originalGeometry.index.array), Array.from(compiledGeometry.index.array));
  function opacity(ids, expected) { for (const id of ids) assert.equal(map.getPaintProperty(id, 'fill-extrusion-opacity'), expected, id); }
  const adapter = f.make();
  const badCases = [
    data => { data.features[0].properties.b = 'nhb'; },
    data => { data.features[0].geometry.coordinates[0][0][0] = NaN; },
    data => { data.features[0].properties.cap = 4; },
    data => { data.features[0].properties.wd = 'transparent'; },
    data => { data.replacedBuildingIds.push('foreign'); },
    data => { data.features[0].geometry.coordinates[0].pop(); },
  ];
  for (const corrupt of badCases) {
    const data = copy(fc); corrupt(data); const before = map.changes.length;
    await assert.rejects(adapter.prepare(data), /Invalid compiled hero/);
    assert.equal(map.changes.length, before, 'reject invalid assets before any mutation');
  }
  const pending = adapter.prepare(fc);
  const sourceId = adapter.stats.sourceId, layerIds = adapter.stats.layerIds;
  opacity(layerIds, 0); opacity(originalLayers, 1);
  assert.equal(adapter.state, 'preparing'); assert.equal(adapter.ready, false);
  map.sourceContent(sourceId, false); map.emit('render'); assert.equal(adapter.state, 'preparing');
  map.sourceContent(sourceId); assert.equal(adapter.ready, false, 'source content is not a render fence');
  map.emit('render'); await pending; assert.equal(adapter.state, 'ready'); assert.equal(adapter.ready, true);
  assert.equal(adapter.stats.maplibreGpuBytes, null, 'do not invent MapLibre GPU-byte counts');
  assert.equal(adapter.stats.sources, 1); assert.equal(adapter.stats.layers, 4);
  assert(adapter.stats.fallback.serializedGeoJsonBytes > 0, 'retained fallback is reported separately');
  for (const id of layerIds) {
    const layer = map.getLayer(id), original = map.getLayer(layer.metadata['flyover:hero-layer']);
    assert.deepEqual(layer.filter, original.filter);
    for (const [key, value] of Object.entries(original.paint)) if (key !== 'fill-extrusion-opacity') assert.deepEqual(layer.paint[key], value);
    assert.equal(layer.layout?.visibility ?? 'visible', 'visible', 'prepared layers participate in source work');
    assert.deepEqual(layer.paint['fill-extrusion-opacity-transition'], { duration: 0, delay: 0 });
  }
  let attached = false, failDetach = false;
  const callbacks = { attach: () => { attached = true; }, detach: () => { if (failDetach) { failDetach = false; throw Error('detach rejected'); } attached = false; } };
  map.failWhen = (method, id, key, value) => method === 'setPaintProperty' && layerIds.includes(id) && key === 'fill-extrusion-opacity' && value === 1;
  assert.throws(() => adapter.commit(callbacks), /injected style failure/);
  assert.equal(attached, false); assert.equal(host.current, null); assert.equal(adapter.state, 'ready');
  opacity(originalLayers, 1); opacity(layerIds, 0); assert.equal(originalGdc.visible, true);
  const beforeCommit = map.changes.length;
  adapter.commit(callbacks);
  assert.equal(attached, true); assert.equal(host.current.sourceId, sourceId); opacity(originalLayers, 0); opacity(layerIds, 1);
  assert.equal(originalGdc.visible, false); assert.equal(originalOther.visible, true);
  assert.equal(adapter.state, 'active'); assert.equal(adapter.ready, true);
  assert(map.changes.slice(beforeCommit).every(v => v.method === 'setPaintProperty'), 'commit cannot trigger asynchronous source/filter rebuilding');
  assert(f.collisions.at(-1).parts.features.some(v => v.properties.h === 60), 'hero replacement preserves authored apartment collision height');
  assert.deepEqual(copy(host.shadowSources()), [sourceId]);
  const goodState = adapter.state, beforeInvalid = map.changes.length;
  await assert.rejects(adapter.prepare({}), /Invalid compiled hero/);
  assert.equal(adapter.state, goodState); assert.equal(map.changes.length, beforeInvalid);

  map.setPaintProperty('heroes-gdc-glass', 'fill-extrusion-color', '#f08020');
  map.setLayoutProperty('heroes-brick', 'visibility', 'none'); host.sync();
  assert.equal(map.getPaintProperty(layerIds.find(id => id.startsWith('heroes-gdc-glass-')), 'fill-extrusion-color'), '#f08020');
  assert.equal(map.getLayer(layerIds.find(id => id.startsWith('heroes-brick-'))).layout.visibility, 'none');
  context.applyHeroColors(map, .82, true);
  assert.deepEqual(map.getPaintProperty(layerIds[0], 'fill-extrusion-color'), map.getPaintProperty('heroes-solid', 'fill-extrusion-color'), 'time-of-day updates every clone');
  map.setLayoutProperty('heroes-brick', 'visibility', 'visible'); host.sync();
  failDetach = true;
  assert.throws(() => adapter.restore(), /detach rejected/);
  assert.equal(attached, true); assert.equal(host.current.sourceId, sourceId); opacity(originalLayers, 0); opacity(layerIds, 1);

  // A second source prepares while the first remains resident; failed swap
  // rolls back to that resident, never to the original or an empty building.
  const next = f.make(), pendingNext = next.prepare(fc);
  map.sourceContent(next.stats.sourceId); map.emit('render'); await pendingNext;
  opacity(layerIds, 1); opacity(next.stats.layerIds, 0); assert.equal(host.current.sourceId, sourceId);
  let nextAttached = false;
  const nextCallbacks = { attach: () => { attached = false; nextAttached = true; }, detach: () => { nextAttached = false; } };
  map.failWhen = (method, id, key, value) => method === 'setPaintProperty' && next.stats.layerIds.includes(id) && key === 'fill-extrusion-opacity' && value === 1;
  assert.throws(() => next.commit(nextCallbacks), /injected style failure/);
  assert.equal(attached, true); assert.equal(nextAttached, false); assert.equal(host.current.sourceId, sourceId);
  next.commit(nextCallbacks);
  assert.equal(adapter.state, 'superseded'); assert.equal(attached, false); assert.equal(nextAttached, true);
  const nextId = next.stats.sourceId, nextLayers = next.stats.layerIds;
  adapter.dispose(); assert.equal(nextAttached, true); assert.equal(host.current.sourceId, nextId);
  opacity(originalLayers, 0); opacity(nextLayers, 1); assert(!map.getSource(sourceId));
  next.restore(); assert.equal(nextAttached, false); assert.equal(host.current, null); assert.equal(originalGdc.visible, true);
  assert.equal(map.getSource(host.originalSourceId), baseline, 'eviction reuses the same retained original');
  assert(!map.getSource(nextId)); opacity(originalLayers, 1);

  const controller = new AbortController(), cancelled = f.make();
  const cancellation = cancelled.prepare(fc, { signal: controller.signal });
  const rejectedCancellation = assert.rejects(cancellation, e => e.name === 'AbortError');
  const cancelledId = cancelled.stats.sourceId; controller.abort(); await rejectedCancellation;
  assert(!map.getSource(cancelledId)); assert.equal(cancelled.state, 'restored');
  map.emit('sourcedata', { sourceId: cancelledId, sourceDataType: 'content' }); map.emit('render');
  assert.equal(cancelled.ready, false); opacity(originalLayers, 1); cancelled.dispose();
  const timed = f.make(); await assert.rejects(timed.prepare(fc, { timeoutMs: 5 }), /timed out/);
  assert.equal(timed.state, 'error'); assert.equal(timed.stats.sources, 0); timed.dispose();
  const failure = f.make(), failPrepare = failure.prepare(fc);
  const rejectedFailure = assert.rejects(failPrepare, /worker failed/);
  map.emit('error', { sourceId: failure.stats.sourceId, error: Error('worker failed') }); await rejectedFailure;
  assert.equal(failure.stats.sources, 0); opacity(originalLayers, 1); failure.dispose();

  const reentry = next.prepare(fc); map.sourceContent(next.stats.sourceId); map.emit('render'); await reentry; next.commit(nextCallbacks);
  const lostId = next.stats.sourceId;
  map.canvas.emit('webglcontextlost'); map.style = null; map.emit('styledata'); await Promise.resolve();
  assert.equal(next.state, 'restored'); assert.equal(nextAttached, false); assert.equal(next.ready, false);
  assert(f.states.some(e => e.state === 'restored' && e.detail.reason === 'context-lost'));
  map.style = { _loaded: true }; map.canvas.emit('webglcontextrestored'); await Promise.resolve();
  assert(!map.getSource(lostId)); opacity(originalLayers, 1); assert.equal(originalGdc.visible, true);
  const afterRecovery = next.prepare(fc); map.sourceContent(next.stats.sourceId); map.emit('render'); await afterRecovery; next.commit(nextCallbacks);
  // Replace the whole style, including losing its sources and custom layers.
  for (const id of [...map.layers.keys()]) if (id.startsWith('heroes-')) map.removeLayer(id);
  for (const id of [...map.sources.keys()]) if (id.startsWith('austin-heroes')) map.removeSource(id);
  map.style = { _loaded: true }; map.emit('styledata'); await Promise.resolve();
  assert.equal(next.state, 'restored'); assert.equal(nextAttached, false);
  assert(f.states.some(e => e.state === 'restored' && e.detail.reason === 'style-reset'));
  opacity(originalLayers, 1); assert.equal(map.getSource(host.originalSourceId)._data.features.length, 3881);
  assert.equal(map.getSource('austin-heroes')._data.features.filter(v => v.properties.b === 'gdc').length, 0);
  // A normal diffed setStyle keeps the Style object but can remove a source or
  // a clone layer. Its old readiness fence is equally invalid.
  const diffed = next.prepare(fc); map.sourceContent(next.stats.sourceId); map.emit('render'); await diffed; next.commit(nextCallbacks);
  const styleIdentity = map.style, lostLayer = next.stats.layerIds[0];
  map.removeLayer(lostLayer); map.emit('styledata'); await Promise.resolve();
  assert.equal(map.style, styleIdentity); assert.equal(next.state, 'restored');
  assert.equal(nextAttached, false); opacity(originalLayers, 1);
  const expectedRoots = root.children.length;
  for (let i = 0; i < 3; i++) {
    context.SLOPES.on = false; f.hooks.forEach(fn => fn(false)); assert.equal(root.children.length, 0);
    context.SLOPES.on = true; f.hooks.forEach(fn => fn(true)); assert.equal(root.children.length, expectedRoots); assert.equal(root.children[0], originalGroup);
  }
  let disposedGeometry = 0;
  originalGroup.traverse(o => o.geometry?.addEventListener('dispose', () => disposedGeometry++));
  next.dispose(); assert.equal(map.listenerCount('sourcedata'), 0); assert.equal(map.listenerCount('render'), 0);
  map.emit('remove'); assert.equal(root.children.length, 0); assert.equal(disposedGeometry, 2);
  assert.equal(context.HeroesAssetHost.get(map), undefined); assert.equal(map.canvas.listenerCount('webglcontextlost'), 0);
  f.runtime.dispose(f.compiled);
  console.log('PASS: exact GDC source/undersides; matching layers; source/render readiness; atomic replace/rollback; invalid/cancelled/failed assets; retained fallback; same-ID supersession; TOD/style/context recovery; collision preservation; disposal');
}

async function gpu() {
  const argv = process.argv.slice(2), outAt = argv.indexOf('--out');
  if (outAt < 0 || !argv[outAt + 1] || !process.env.VERIFY_URL) throw Error('--out and VERIFY_URL are required for --gpu');
  const out = path.resolve(argv[outAt + 1]);
  if (out === ROOT || out.startsWith(ROOT + path.sep)) throw Error('Screenshots must stay outside the repo');
  await fs.mkdir(out, { recursive: true });
  const { chromium } = await import('playwright-core');
  const { launch, HW_ARGS } = await import('./chrome.mjs');
  const report = { started: new Date().toISOString(), viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1, cpuThrottle: 1, checks: [], shots: [], pixels: {}, errors: [], mapErrors: [] };
  const save = () => fs.writeFile(path.join(out, 'hero-adapter.json'), JSON.stringify(report, null, 2));
  const stage = async name => { report.stage = name; console.log('[GDC]', name); await save(); };
  const browser = await launch(chromium, { gl: 'hardware', maxMs: 420000, args: [...HW_ARGS,
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'] });
  let page;
  const shot = async name => {
    // A changed data-driven paint expression rebuilds tile buffers. A fixed
    // screenshot delay can capture the old daytime buffers in a night scene.
    await page.waitForFunction(() => {
      const p = window.__heroProbe;
      return p.map.loaded() && p.map.areTilesLoaded() && !p.map.isMoving() &&
        [p.host.originalSourceId, p.host.current?.sourceId].filter(Boolean).every(id => p.map.isSourceLoaded(id));
    }, null, { timeout: 60000 });
    await page.evaluate(async () => {
      const p = window.__heroProbe;
      if (p.host.current) p.verifyLayers(p.items.find(item => item.adapter.stats.sourceId === p.host.current.sourceId));
      await new Promise(resolve => { p.map.once('render', resolve); p.map.triggerRepaint(); });
    });
    await page.screenshot(); await page.waitForTimeout(650);
    await page.screenshot({ path: path.join(out, name + '.png') });
    report.shots.push({ file: name + '.png', state: await page.evaluate(() => window.__heroProbe.snapshot()) });
    await save();
  };
  const compareShots = async (left, right) => {
    const images = await Promise.all([left, right].map(async name =>
      'data:image/png;base64,' + (await fs.readFile(path.join(out, name + '.png'))).toString('base64')));
    return page.evaluate(async urls => {
      const pixels = await Promise.all(urls.map(async url => {
        const image = new Image(); image.src = url; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0);
        return ctx.getImageData(0, 0, image.width, image.height).data;
      }));
      if (pixels[0].length !== pixels[1].length) throw Error('Screenshot dimensions changed');
      let changed = 0, changedOver8 = 0, absolute = 0, maximum = 0;
      for (let at = 0; at < pixels[0].length; at += 4) {
        let delta = 0;
        for (let k = 0; k < 3; k++) { const d = Math.abs(pixels[0][at + k] - pixels[1][at + k]); absolute += d; delta = Math.max(delta, d); }
        if (delta) changed++; if (delta > 8) changedOver8++; maximum = Math.max(maximum, delta);
      }
      const total = pixels[0].length / 4;
      return { total, changed, changedOver8, changedOver8Fraction: changedOver8 / total, meanAbsoluteRgb: absolute / (3 * total), maximum };
    }, images);
  };
  const pixelGate = async (hour, controlLeft, controlRight, compared) => {
    const control = await compareShots(controlLeft, controlRight), swap = await compareShots(controlLeft, compared);
    report.pixels[hour] = { control, swap, allowance: { meanAbsoluteRgb: .05, changedOver8Fraction: .001 } };
    await save();
    assert(swap.meanAbsoluteRgb <= control.meanAbsoluteRgb + .05 && swap.changedOver8Fraction <= control.changedOver8Fraction + .001,
      `Settled ${hour} GDC pixels differ from the original: ${JSON.stringify({ control, swap })}`);
  };
  try {
    const context = await browser.newContext({ viewport: report.viewport, deviceScaleFactor: 1 });
    page = await context.newPage();
    page.on('pageerror', error => report.errors.push(String(error)));
    await page.addInitScript(() => {
      const timer = setInterval(() => {
        if (window.cancelGraphicsAutoDetect) { window.cancelGraphicsAutoDetect(); clearInterval(timer); }
      }, 10);
    });
    await stage('full-city boot');
    await page.goto(process.env.VERIFY_URL.replace(/\/$/, '') + '/index.html?intro=0&drift=0&preset=balanced&clip=1&buildings=legacy',
      { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.slopesApartments?.readyToReveal() && window.slopesApartments?.group &&
      window.HeroesAssetHost?.get(window.__map) && !document.getElementById('veil') && !window.__fly?.eye().driving,
    null, { timeout: 180000 });
    report.initial = await page.evaluate(async id => {
      const map = window.__map, T = window.THREE, S = window.slopes, host = window.HeroesAssetHost.get(map);
      const check = (condition, message) => { if (!condition) throw Error(message); };
      window.cancelGraphicsAutoDetect(); window.GFX.autoExposure = false; window.GFX.stars = 0; window.GFX.grain = 0; window.applyGraphics();
      if (window.WAYFIND) window.WAYFIND.on = false;
      check(window.slopesApartments.count.buildings === 196, 'The full 196-building city is required');
      check(!window.LITE_PROFILE?.budget?.freeGeometryCpu, 'This desktop context test requires retained legacy CPU arrays');
      map.jumpTo({ center: [-97.73645, 30.28625], zoom: 19, pitch: 60, bearing: -27 });
      window.applyTimeOfDay(map, .3, true);
      const runtime = await import('/js/building-asset-runtime.js');
      const { BuildingHeroAdapter } = await import('/js/building-hero-adapter.js');
      const base = new URL('/data/compiled-buildings/', location.href).href;
      const manifest = await (await fetch(base + 'manifest.json')).json();
      const entry = manifest.buildings.find(building => building.id === id);
      check(entry, 'The compiled GDC asset is missing');
      const events = [], states = [], errors = [], loader = new runtime.BuildingAssetLoader({ onEvent: event => events.push(event) });
      const loaded = await loader.load(entry, base), fc = loaded.asset.maplibre.featureCollection;
      const original = map.getSource(host.originalSourceId), originalGroup = S.root.getObjectByName('heroes-gdc-roof-undersides');
      const stable = value => value && typeof value === 'object'
        ? Array.isArray(value) ? value.map(stable) : Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])])) : value;
      const serialized = original.serialize?.().data;
      const originalData = [original._data, serialized].find(data => data?.features?.length);
      const differences = [];
      const compare = (a, b, path = '') => {
        if (a === b || differences.length >= 20) return;
        if (a && b && typeof a === 'object' && typeof b === 'object') {
          for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) compare(a[key], b[key], path + '/' + key);
        } else differences.push({ path, compiled: a, original: b });
      };
      compare(fc, originalData);
      window.__heroInitial = { originalDataKeys: Object.keys(original._data || {}), serializedKeys: Object.keys(serialized || {}),
        compiledKeys: Object.keys(fc), compiledFeatures: fc.features.length, originalFeatures: originalData?.features?.length,
        differences, pose: { center: map.getCenter().toArray(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() } };
      check(JSON.stringify(stable(fc)) === JSON.stringify(stable(originalData)), 'Decoded GDC source differs from the original: ' + JSON.stringify(differences));
      const referenceObject = runtime.createBuildingObject(loaded.asset, { THREE: T, slopes: S, pickId: 197 });
      const originalMeshes = [], compiledMeshes = [];
      originalGroup.traverse(mesh => { if (mesh.geometry) originalMeshes.push(mesh); });
      referenceObject.group.traverse(mesh => { if (mesh.geometry) compiledMeshes.push(mesh); });
      check(originalMeshes.length === compiledMeshes.length, 'Underside mesh count changed');
      const compared = [];
      for (let i = 0; i < originalMeshes.length; i++) {
        const a = originalMeshes[i].geometry, b = compiledMeshes[i].geometry;
        for (const name of [...Object.keys(a.attributes), 'index']) {
          const x = name === 'index' ? a.index : a.attributes[name], y = name === 'index' ? b.index : b.attributes[name];
          check(y && x.itemSize === y.itemSize && x.normalized === y.normalized && x.array.constructor === y.array.constructor, 'Underside descriptor changed: ' + name);
          const xb = new Uint8Array(x.array.buffer, x.array.byteOffset, x.array.byteLength), yb = new Uint8Array(y.array.buffer, y.array.byteOffset, y.array.byteLength);
          check(xb.length === yb.length && xb.every((value, at) => value === yb[at]), 'Underside bytes changed: ' + name);
          compared.push({ name, bytes: xb.length });
        }
        check(originalMeshes[i].material.vertexShader === compiledMeshes[i].material.vertexShader &&
          originalMeshes[i].material.fragmentShader === compiledMeshes[i].material.fragmentShader &&
          compiledMeshes[i].material.uniforms === S.uniforms(), 'Underside production material changed');
      }
      referenceObject.dispose();
      const items = [], warm = [];
      const source = sourceId => {
        const cache = (map.style?.tileManagers || map.style?._sourceCaches || map.style?.sourceCaches)?.[sourceId];
        // The pinned MapLibre 5.24 renamed SourceCache to TileManager and
        // moved its tile dictionary. Use the same renderable-tile accessors
        // that the production shadow pass uses, rather than guessing a store.
        const tiles = cache?.getRenderableIds && cache?.getTileByID
          ? cache.getRenderableIds().map(id => cache.getTileByID(id)).filter(Boolean) : [];
        const buckets = [...new Set(tiles.flatMap(tile => Object.values(tile.buckets || {})))];
        const layers = (map.getStyle()?.layers || []).filter(layer => layer.source === sourceId);
        return { id: sourceId, exists: !!map.getSource(sourceId), loaded: !!map.getSource(sourceId) && map.isSourceLoaded(sourceId),
          cacheFound: !!cache, cacheKeys: Object.keys(cache || {}), used: cache?.used, tiles: tiles.length,
          tileStates: tiles.map(tile => tile.state), buckets: buckets.length,
          uploadedBuckets: buckets.filter(bucket => bucket.uploaded).length,
          bucketState: buckets.slice(0, 8).map(bucket => ({ uploaded: bucket.uploaded, keys: Object.keys(bucket).filter(k => /upload|buffer|vertices|indices/i.test(k)) })),
          queryFeatures: map.getSource(sourceId) ? map.querySourceFeatures(sourceId).length : 0,
          renderedFeatures: layers.length ? map.queryRenderedFeatures({ layers: layers.map(layer => layer.id) }).length : 0,
          layers: layers.map(layer => ({ id: layer.id, opacity: map.getPaintProperty(layer.id, 'fill-extrusion-opacity') ?? 1,
            visibility: layer.layout?.visibility ?? 'visible', alias: layer.metadata?.['flyover:hero-layer'] })) };
      };
      const probe = window.__heroProbe = { map, T, S, host, fc, original, originalGroup, runtime, loaded, loader,
        check, stable, source, items, events, states, warm, errors, frames: 0, losses: 0, restores: 0,
        snapshot() {
          const live = window.slopes, layer = map.getLayer(window.SLOPES.layerId);
          const ids = [host.originalSourceId, ...items.map(item => item.adapter.stats.sourceId).filter(Boolean)];
          return { frames: this.frames, losses: this.losses, restores: this.restores, tilesLoaded: map.areTilesLoaded(),
            mapLoaded: map.loaded(), hour: window.__todCurrentP, slopesFrames: live.frames, rendererReady: !!live.renderer,
            slopesLayer: layer ? { id: layer.id, type: layer.type, hasRender: typeof layer.implementation?.render === 'function' || typeof layer.render === 'function' } : null,
            current: host.current?.sourceId || null, originalUndersideVisible: originalGroup.visible,
            pose: { center: map.getCenter().toArray(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() },
            fallback: host.fallbackStats, sources: ids.map(source), adapters: items.map(item => ({ key: item.key, attached: item.object.group.parent === live.root, ...item.adapter.stats })) };
        },
        async prepare(key) {
          const live = window.slopes;
          const object = runtime.createBuildingObject(loaded.asset, { THREE: T, slopes: live, pickId: 197 });
          await runtime.uploadBuildingObject(object, { THREE: T, slopes: live, map, onEvent: event => events.push(event) });
          const adapter = new BuildingHeroAdapter({ map, id, onState: (state, detail) => states.push({ key, state, reason: detail.reason, at: performance.now() }) });
          const item = { key, object, adapter, callbacks: { attach: () => window.slopes.add(object.group), detach: () => window.slopes.remove(object.group) } };
          items.push(item);
          await adapter.prepare(fc);
          const before = source(adapter.stats.sourceId);
          warm.push({ key, ...before });
          check(before.cacheFound && before.tiles > 0 && before.queryFeatures > 0 && before.buckets > 0, 'Prepared invisible GDC has no live tile buckets');
          check(before.uploadedBuckets === before.buckets, 'Prepared GDC tile buckets have not uploaded');
          check(before.layers.every(layer => layer.opacity === 0 && layer.visibility === 'visible'), 'Staging must remain invisible while participating in source work');
          return item;
        },
        activate(key) { const item = items.find(item => item.key === key); item.adapter.commit(item.callbacks); return this.snapshot(); },
        restore(key) { const item = items.find(item => item.key === key); item.adapter.restore(); return this.snapshot(); },
        verifyLayers(item) {
          for (const id of item.adapter.stats.layerIds) {
            const layer = map.getLayer(id).serialize(), template = map.getLayer(layer.metadata['flyover:hero-layer']).serialize();
            check(JSON.stringify(stable(layer.filter)) === JSON.stringify(stable(template.filter)), 'Hero layer filter changed');
            for (const [key, value] of Object.entries(template.paint)) if (!key.startsWith('fill-extrusion-opacity')) {
              check(JSON.stringify(stable(layer.paint[key])) === JSON.stringify(stable(value)), 'Hero layer paint differs: ' + key);
            }
          }
        },
      };
      map.on('error', event => errors.push(String(event.error || event)));
      map.on('render', () => { probe.frames++; });
      map.getCanvas().addEventListener('webglcontextlost', () => probe.losses++);
      map.getCanvas().addEventListener('webglcontextrestored', () => probe.restores++);
      const gl = S.renderer.getContext(), debug = gl.getExtension('WEBGL_debug_renderer_info');
      return { count: window.slopesApartments.count.buildings, sourceFeatures: fc.features.length, compared,
        entry: { file: entry.file, hash: entry.hash, compilerHash: entry.compilerHash },
        renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
    }, ID);
    await page.waitForFunction(() => window.__map.areTilesLoaded() && window.__heroProbe.source(window.__heroProbe.host.originalSourceId).renderedFeatures > 0,
      null, { timeout: 60000 });
    await shot('gdc-day-original');
    await shot('gdc-day-original-control');
    await stage('prepared source and first atomic commit');
    report.prepared = await page.evaluate(async () => { const p = window.__heroProbe; await p.prepare('first'); return p.snapshot(); });
    report.firstCommit = await page.evaluate(() => window.__heroProbe.activate('first'));
    await shot('gdc-day-compiled');
    await pixelGate('day', 'gdc-day-original', 'gdc-day-original-control', 'gdc-day-compiled');
    report.checks.push('Exact authored GeoJSON and Three underside bytes; live tile buckets uploaded before the synchronous swap');
    await stage('time-of-day and matching material layers');
    await page.evaluate(() => { window.applyTimeOfDay(window.__map, .82, true); window.__heroProbe.verifyLayers(window.__heroProbe.items[0]); });
    await shot('gdc-night-compiled');
    await shot('gdc-night-compiled-control');
    await page.evaluate(() => window.__heroProbe.restore('first'));
    await shot('gdc-night-original');
    await pixelGate('night', 'gdc-night-compiled', 'gdc-night-compiled-control', 'gdc-night-original');
    report.checks.push('Settled day and night captures match the retained original within measured unchanged-frame noise');
    await page.evaluate(async () => { const p = window.__heroProbe; window.applyTimeOfDay(p.map, .3, true); await p.items[0].adapter.prepare(p.fc); p.activate('first'); });
    await stage('invalid asset, failed swap, same-ID replacement, superseded disposal');
    report.transactions = await page.evaluate(async () => {
      const p = window.__heroProbe, first = p.items[0], before = p.host.current, sourceIdentity = p.map.getSource(before.sourceId);
      const bad = JSON.parse(JSON.stringify(p.fc)); bad.features[0].properties.b = 'nhb';
      let invalid = false;
      try { await first.adapter.prepare(bad); } catch { invalid = true; }
      p.check(invalid && p.host.current === before && first.adapter.state === 'active', 'Invalid asset disturbed the current GDC');
      const second = await p.prepare('second'), secondId = second.adapter.stats.sourceId;
      p.check(p.host.current === before && p.map.getSource(before.sourceId) === sourceIdentity, 'Preparation disturbed the current source');
      const setPaint = p.map.setPaintProperty;
      let injected = false, rejected = false;
      p.map.setPaintProperty = function(id, key, value, ...rest) {
        if (!injected && second.adapter.stats.layerIds.includes(id) && key === 'fill-extrusion-opacity' && value === 1) {
          injected = true; throw Error('deliberate commit paint failure');
        }
        return setPaint.call(this, id, key, value, ...rest);
      };
      try { second.adapter.commit(second.callbacks); } catch (error) { rejected = /deliberate commit/.test(error.message); }
      finally { p.map.setPaintProperty = setPaint; }
      p.check(injected && rejected && p.host.current === before && first.object.group.parent === p.S.root && !second.object.group.parent, 'Failed replacement did not roll back');
      p.check(!p.originalGroup.visible && p.source(before.sourceId).layers.every(layer => layer.opacity === 1), 'Rollback selected the wrong fallback');
      second.adapter.commit(second.callbacks);
      p.check(first.adapter.state === 'superseded', 'Old adapter was not superseded');
      first.adapter.dispose(); first.object.dispose();
      p.check(p.host.current?.sourceId === secondId && second.object.group.parent === p.S.root && !p.originalGroup.visible, 'Old disposal disturbed the replacement');
      p.check(!p.map.getSource(before.sourceId), 'Superseded source leaked');
      const controller = new AbortController(), cancelled = new window.BuildingHeroAdapter({ map: p.map, id: p.host.id });
      const work = cancelled.prepare(p.fc, { signal: controller.signal }).then(() => false, error => error.name === 'AbortError');
      const cancelledId = cancelled.stats.sourceId; controller.abort();
      p.check(await work, 'Cancellation did not reject');
      p.check(!p.map.getSource(cancelledId) && p.host.current?.sourceId === secondId, 'Cancellation disturbed the resident or leaked a source');
      cancelled.dispose();
      return { invalid, rollback: injected && rejected, cancelled: true, ...p.snapshot() };
    });
    await shot('gdc-day-replaced');
    report.checks.push('Invalid input is pre-mutation; failed commit rolls back; cancelled preparation preserves current GDC; disposing superseded source preserves replacement');
    await stage('real MapLibre style interruption');
    report.beforeStyle = await page.evaluate(() => window.__heroProbe.snapshot());
    report.styleInterrupted = await page.evaluate(async () => {
      const p = window.__heroProbe, item = p.items[1], style = p.map.style, ids = item.adapter.stats.layerIds, sourceId = item.adapter.stats.sourceId;
      // Exercise the actual MapLibre mutation/events used by a diffed style.
      // The rest of the city and its custom Three layer remain installed.
      for (const id of ids) p.map.removeLayer(id);
      p.map.removeSource(sourceId); p.map.triggerRepaint();
      await new Promise(resolve => p.map.once('render', resolve));
      p.check(p.map.style === style, 'The style-diff identity check was not exercised');
      p.check(item.adapter.state === 'restored' && !item.object.group.parent && !p.host.current, 'Style interruption did not restore the original');
      p.check(p.states.some(event => event.key === 'second' && event.reason === 'style-reset'), 'Style interruption did not notify the owner');
      p.check(p.map.getSource(p.host.originalSourceId) === p.original && p.originalGroup.visible, 'Retained fallback was not restored');
      return p.snapshot();
    });
    await page.waitForFunction(() => window.__heroProbe.source(window.__heroProbe.host.originalSourceId).renderedFeatures > 0,
      null, { timeout: 30000 });
    await shot('gdc-style-restored');
    await stage('actual shared WebGL context loss');
    await page.evaluate(async () => { const p = window.__heroProbe; await p.prepare('context'); p.activate('context'); });
    report.beforeLoss = await page.evaluate(() => {
      const p = window.__heroProbe, gl = p.S.renderer.getContext();
      p.ext = gl.getExtension('WEBGL_lose_context'); p.check(p.ext, 'WEBGL_lose_context is unavailable');
      const state = p.snapshot(); p.ext.loseContext(); return state;
    });
    await page.waitForFunction(() => window.__heroProbe.losses === 1 && window.__heroProbe.items[2].adapter.state === 'restored', null, { timeout: 10000 });
    await page.waitForTimeout(400);
    await page.evaluate(() => window.__heroProbe.ext.restoreContext());
    await page.waitForFunction(() => window.__heroProbe.restores === 1 && window.__heroProbe.host.usable &&
      window.__map.areTilesLoaded() && window.__heroProbe.source(window.__heroProbe.host.originalSourceId).renderedFeatures > 0,
      null, { timeout: 60000 });
    report.afterLoss = await page.evaluate(() => {
      const p = window.__heroProbe;
      p.check(!p.host.current && p.originalGroup.visible && p.items[2].adapter.state === 'restored', 'Context recovery did not select the original');
      p.check(p.states.some(event => event.key === 'context' && event.reason === 'context-lost'), 'Context interruption did not notify the owner');
      p.check(!p.items[2].object.group.parent && window.SLOPES.on && !p.S.contextFallback, 'Desktop context recovery is incomplete');
      return p.snapshot();
    });
    await shot('gdc-context-restored');
    // A shared-context restore must reinstall the custom Three layer itself.
    // Never call initSlopes here: doing so would hide a production lifecycle
    // failure and can replace the retained scene with an empty one.
    await page.waitForFunction(() => {
      window.__map.triggerRepaint();
      return !!window.slopes.renderer && !!window.__map.getLayer(window.SLOPES.layerId) && window.slopes.frames > 0;
    }, null, { timeout: 15000 });
    await page.evaluate(async () => { const p = window.__heroProbe; await p.prepare('reentry'); p.activate('reentry'); });
    await shot('gdc-context-reentry');
    report.checks.push('Actual MapLibre style loss restores original source and underside; shared context loss/restoration draws original and permits compiled reentry');
    report.final = await page.evaluate(() => {
      const p = window.__heroProbe;
      const evidence = { snapshot: p.snapshot(), warm: p.warm, states: p.states, events: p.events, errors: p.errors };
      for (const item of p.items) { item.adapter.dispose(); item.object.dispose(); }
      p.loader.close();
      evidence.afterDispose = p.snapshot();
      p.check(!p.host.current && p.originalGroup.visible && p.map.getSource(p.host.originalSourceId), 'Final disposal lost the fallback');
      p.check(!Object.keys(p.map.getStyle().sources).some(id => id.startsWith('austin-heroes-gdc-compiled-')), 'Compiled sources leaked after disposal');
      return evidence;
    });
    report.mapErrors = report.final.errors;
    assert.equal(report.errors.length, 0, 'Unexpected page errors');
    assert.equal(report.mapErrors.length, 0, 'Unexpected MapLibre errors');
    assert.equal(report.afterLoss.losses, 1); assert.equal(report.afterLoss.restores, 1);
    assert(report.final.snapshot.frames > report.beforeLoss.frames, 'Rendering did not resume');
    report.pass = true; report.finished = new Date().toISOString(); await save();
    console.log('PASS: real-city GDC prepared tile/GPU readiness, exact source/undersides, atomic swap/rollback/disposal, style/context fallback and reentry');
  } catch (error) {
    report.pass = false; report.fatal = String(error.stack || error);
    if (page && !page.isClosed()) {
      try { report.failure = await page.evaluate(() => ({ initial: window.__heroInitial, state: window.__heroProbe?.snapshot(), warm: window.__heroProbe?.warm,
        events: window.__heroProbe?.events, states: window.__heroProbe?.states, errors: window.__heroProbe?.errors })); } catch {}
      try { await page.screenshot(); await page.waitForTimeout(650); await page.screenshot({ path: path.join(out, 'failure.png') }); } catch {}
    }
    await save(); console.error(error); process.exitCode = 1;
  } finally {
    await browser.close(); browser.__done?.(); await save();
  }
}

await cpu();
if (process.argv.includes('--gpu')) await gpu();
