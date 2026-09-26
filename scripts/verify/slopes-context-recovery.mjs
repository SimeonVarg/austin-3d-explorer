// CPU lifecycle regression for the complete production slopes renderer.
// No DOM, network, browser, or WebGL driver is created. Real shared-context
// restoration and rendered reentry remain gates in compiled-hero-adapter.mjs.
// --break disables same-map scene retention and must fail the regression.
// --break-frames restores the old removal reset and must fail reveal readiness.
// --break-fresh-frames omits the fresh-scene reset and must fail map replacement.
import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { MercatorCoordinate } from '../buildings/runtime.mjs';

// Share the compiler's pinned r159 dependency; the repository root has no npm
// package and this regression must run without downloading another runtime.
const THREE = createRequire(new URL('../buildings/runtime.mjs', import.meta.url))('three');
let source = (await fs.readFile(new URL('../../js/slopes.js', import.meta.url), 'utf8')).replaceAll('\r\n', '\n');
if (process.argv.includes('--break')) {
  const retainedScene = '_map === map && scene && root && U';
  assert(source.includes(retainedScene), 'negative control must disable the actual retention branch');
  source = source.replace(retainedScene, 'false');
}
if (process.argv.includes('--break-frames')) {
  const removal = '      renderer = null;';
  assert(source.includes(removal), 'negative control must restore the actual removal reset');
  source = source.replace(removal, removal + ' _frames = 0;');
}
if (process.argv.includes('--break-fresh-frames')) {
  const creation = '    scene = new T.Scene();\n    _frames = 0;';
  assert(source.includes(creation), 'negative control must omit the actual fresh-scene reset');
  source = source.replace(creation, '    scene = new T.Scene();');
}

// Exercise the real reveal gate against retained scene frames. Other build,
// filter and source readiness dependencies are already settled in this fixture.
const apartments = await fs.readFile(new URL('../../js/slopes-apartments.js', import.meta.url), 'utf8');
const revealStart = apartments.indexOf('    readyToReveal() {');
const revealEnd = apartments.indexOf('\n    rebuild()', revealStart);
assert(revealStart >= 0 && revealEnd > revealStart, 'extract the production reveal predicate');
const revealMethod = apartments.slice(revealStart, revealEnd);
function revealReady(slopes, map, group, builtFrame = slopes.frames) {
  return vm.runInNewContext('({' + revealMethod + '}).readyToReveal', {
    window: { slopes }, _map: map, _group: group, _builtFrame: builtFrame,
    count: { done: true }, _building: null,
    mapStyleAvailable: () => !map.removed && map.isStyleLoaded() && !map.gl.lost,
    filtersMissing: () => [], rigsMissing: () => [], filterPlan: () => [],
  });
}

class TestMap extends EventEmitter {
  constructor() {
    super();
    this.style = { _loaded: true };
    this.layers = new Map([
      ['buildings-3d', { id: 'buildings-3d', type: 'fill-extrusion' }],
      ['labels', { id: 'labels', type: 'symbol' }],
    ]);
    this.canvas = new EventEmitter();
    this.canvas.addEventListener = this.canvas.on.bind(this.canvas);
    this.canvas.removeEventListener = this.canvas.off.bind(this.canvas);
    this.gl = { lost: false, isContextLost() { return this.lost; } };
    this.adds = 0; this.repaints = 0; this.removed = false;
  }
  getCanvas() { return this.canvas; }
  getZoom() { return 19; }
  isStyleLoaded() { return !!this.style?._loaded; }
  getLayer(id) { assert(this.style, 'do not query a missing style'); return this.layers.get(id); }
  getStyle() { assert(this.style, 'do not query a missing style'); return { layers: [...this.layers.values()] }; }
  addLayer(layer) {
    assert(this.style?._loaded && !this.removed && !this.gl.lost, 'only install into a live restored style');
    assert(!this.layers.has(layer.id), 'no duplicate custom layer');
    this.layers.set(layer.id, layer); this.adds++;
    layer.onAdd?.(this, this.gl);
  }
  removeLayer(id) {
    const layer = this.layers.get(id);
    this.layers.delete(id);
    layer?.onRemove?.(this, this.gl);
  }
  triggerRepaint() { assert(!this.removed, 'removed map must not schedule rendering'); this.repaints++; }
  lose() {
    this.gl.lost = true;
    this.canvas.emit('webglcontextlost', { preventDefault() {} });
  }
  restore({ styleReady = true } = {}) {
    // MapLibre rebuilds its style and drops custom layers on restoration.
    for (const [id, layer] of this.layers) if (layer.type === 'custom') this.removeLayer(id);
    this.style = styleReady ? { _loaded: true } : null;
    this.gl.lost = false;
    this.canvas.emit('webglcontextrestored', {});
  }
  finishStyle() { this.style = { _loaded: true }; this.emit('style.load'); }
  remove() {
    for (const [id, layer] of this.layers) if (layer.type === 'custom') this.removeLayer(id);
    this.removed = true; this.style = null;
    this.emit('remove');
  }
}

function fixture() {
  const timers = new Map(), errors = [];
  let nextTimer = 0;
  const schedule = fn => { const id = ++nextTimer; timers.set(id, fn); return id; };
  const context = vm.createContext({
    // Use real r159 matrices, uniforms and scene objects while replacing only
    // the WebGL driver. Calling the production layer is what advances frames.
    THREE: { ...THREE, WebGLRenderer: class {
      constructor({ context }) { this.gl = context; this.disposed = false; this.renderCalls = 0; }
      getContext() { return this.gl; }
      resetState() { assert(!this.disposed, 'removed renderers must not be reused'); }
      render(scene, camera) {
        assert(!this.disposed && !this.gl.lost, 'only draw using a live renderer');
        assert(scene.isScene && camera.isCamera, 'draw the actual retained scene and camera');
        this.renderCalls++;
      }
      dispose() { this.disposed = true; }
    } },
    maplibregl: { MercatorCoordinate },
    URLSearchParams, performance, queueMicrotask,
    location: { search: '?intro=0&drift=0' },
    document: { readyState: 'loading', addEventListener() {} },
    CityLighting: { uniforms: '', glsl: '', frame() {} },
    GFX: { preset: 'balanced', shadows: false }, LITE_PROFILE: { on: false, budget: null },
    console: { log() {}, warn: (...args) => errors.push(args.join(' ')), error: (...args) => errors.push(args.join(' ')) },
    setTimeout: schedule, clearTimeout: id => timers.delete(id),
    requestAnimationFrame: schedule, cancelAnimationFrame: id => timers.delete(id),
  });
  context.window = context;
  vm.runInContext(source, context, { filename: 'js/slopes.js' });
  const map = new TestMap();
  context.initSlopes(map);
  const slopes = context.slopes, root = slopes.root, scene = slopes.scene, uniforms = slopes.uniforms();
  const group = new THREE.Group(); group.name = 'retained-building';
  const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
  const material = slopes.material();
  group.add(new THREE.Mesh(geometry, material));
  slopes.add(group);
  let disposed = 0;
  geometry.addEventListener('dispose', () => disposed++);
  material.addEventListener('dispose', () => disposed++);
  const holders = Object.fromEntries(Object.entries(uniforms));
  const renderArgs = { defaultProjectionData: { mainMatrix: new THREE.PerspectiveCamera(60, 1.6, 1, 100000).projectionMatrix.elements } };
  const draw = (targetMap = map, prepareOnly = false) => slopes.layer.render(targetMap.gl, renderArgs, prepareOnly);
  const assertRetained = () => {
    assert(slopes.root === root, 'restoration retains the populated root');
    assert(slopes.scene === scene, 'restoration retains the existing scene');
    assert(group.parent === root, 'restoration retains authored building groups');
    assert.equal(root.children.length, 1, 'restoration neither duplicates nor drops groups');
    assert(slopes.uniforms() === uniforms, 'restoration retains the shared uniform dictionary');
    for (const [name, holder] of Object.entries(holders)) assert(slopes.uniforms()[name] === holder, 'shared uniform ' + name);
    assert(material.uniforms === uniforms, 'existing materials remain bound to live lighting');
    assert.equal(disposed, 0, 'restoration does not dispose the retained scene');
  };
  const microtasks = async () => { await Promise.resolve(); await Promise.resolve(); };
  const tick = async () => {
    await microtasks();
    const pending = [...timers]; timers.clear();
    for (const [, fn] of pending) fn();
    await microtasks();
  };
  const settle = async () => {
    for (let i = 0; i < 20; i++) { await tick(); if (!timers.size) return; }
    throw Error('Recovery left an unbounded retry timer');
  };
  return { map, context, slopes, root, scene, uniforms, material, group, geometry, timers, errors, assertRetained, tick, settle, microtasks, draw };
}

const live = fixture();
const originalLayer = live.slopes.layer;
assert.equal(live.map.getLayer(originalLayer.id), originalLayer);
assert(live.map.canvas.listenerCount('webglcontextrestored') > 0, 'production must observe shared context restoration');
live.assertRetained();
const installedListeners = live.map.canvas.listenerCount('webglcontextrestored');
for (let i = 0; i < 3; i++) live.context.initSlopes(live.map);
assert.equal(live.map.adds, 1, 'idempotent initialization never duplicates the custom layer');
assert.equal(live.map.canvas.listenerCount('webglcontextrestored'), installedListeners, 'idempotent initialization never duplicates recovery listeners');

// Same-map reattachment through the public entry point must reuse the scene,
// including material holders copied by the facade filter and roof generators.
live.map.removeLayer(originalLayer.id);
live.context.initSlopes(live.map);
assert.equal(live.map.getLayer(originalLayer.id), originalLayer);
live.assertRetained();

// A retained building's completion marker is an absolute scene-frame number.
// Simulate the real failure: the build finishes late in a scene's lifetime,
// then context loss removes the layer before its two reveal frames have run.
for (let i = 0; i < 120; i++) live.draw();
await live.settle();
const builtFrame = live.slopes.frames;
assert.equal(builtFrame, 120, 'the production layer advances one frame per draw');
const ready = revealReady(live.slopes, live.map, live.group, builtFrame);
assert.equal(ready(), false, 'a completed build still needs rendered frames');
const oldRenderer = live.slopes.renderer;
live.map.lose(); live.draw();
assert.equal(live.slopes.frames, builtFrame, 'lost-context render calls do not advance readiness');
live.map.restore();
await live.settle();
assert(oldRenderer.disposed, 'restoration releases the old renderer');
assert.equal(live.slopes.renderer, null, 'the new renderer is created lazily on rendering');
live.draw(live.map, true);
assert.equal(ready(), false, 'preparing a restored renderer is not a rendered frame');
assert.notEqual(live.slopes.renderer, oldRenderer, 'restoration uses a replacement renderer');
live.draw();
assert.equal(ready(), false, 'the first post-build draw is not enough to reveal');
live.draw();
assert.equal(ready(), true, 'two restored draws satisfy the retained build frame threshold');
assert.equal(live.slopes.frames, builtFrame + 2, 'same-scene frame count remains monotonic across removal');
assert.equal(live.slopes.renderer.renderCalls, 2, 'only completed draws advance the replacement renderer');
live.assertRetained();

for (const styleReady of [true, false, true]) {
  const before = live.map.adds;
  const beforeFrames = live.slopes.frames;
  live.map.lose();
  live.map.emit('style.load');
  await live.tick();
  assert.equal(live.map.adds, before, 'loss alone never installs another layer');
  live.map.restore({ styleReady });
  if (!styleReady) {
    await live.tick();
    assert.equal(live.map.adds, before, 'restoration waits while MapLibre has no style');
    live.map.finishStyle();
  }
  await live.settle();
  assert.equal(live.map.getLayer(originalLayer.id), originalLayer, 'restored map automatically reinstalls the real custom callbacks');
  assert.equal(live.map.adds, before + 1, 'one reinstall per context rebuild');
  live.draw();
  assert.equal(live.slopes.frames, beforeFrames + 1, 'repeated restoration retains the scene frame clock');
  assert.equal(ready(), true, 'an already revealed build does not wait for its lifetime frame count again');
  live.assertRetained();
  live.context.applySlopesTime(live.map, .82);
  assert.equal(live.material.uniforms.u_p.value, live.slopes.uniforms().u_p.value, 'existing building material still receives time changes');
}

const phone = fixture();
phone.map.lose();
phone.slopes.useContextFallback();
phone.geometry.attributes.position.array = null; // CPU arrays were released on the phone.
phone.context.SLOPES.on = true;
assert.equal(phone.context.SLOPES.on, false, 'fallback is a permanent latch for the current page');
assert.equal(phone.slopes.contextFallback, true);
phone.map.restore(); phone.map.emit('style.load');
await phone.settle();
phone.context.initSlopes(phone.map);
await phone.settle();
assert.equal(phone.map.getLayer(phone.slopes.layer.id), undefined, 'restoration must never revive released phone arrays');
assert.equal(phone.map.adds, 1);
assert.equal(phone.geometry.attributes.position.array, null);

// A removed map must release both DOM and style listeners, including a retry
// queued while restoration was waiting for MapLibre's replacement style.
const removed = fixture();
removed.map.lose(); removed.map.restore({ styleReady: false });
await removed.microtasks();
const staleCallbacks = [...removed.timers.values()];
removed.map.remove();
await removed.settle();
assert.equal(removed.map.canvas.eventNames().reduce((n, name) => n + removed.map.canvas.listenerCount(name), 0), 0, 'map removal detaches canvas recovery listeners');
assert.equal(removed.map.eventNames().reduce((n, name) => n + removed.map.listenerCount(name), 0), 0, 'map removal detaches style and removal listeners');
assert.equal(removed.timers.size, 0, 'map removal clears pending recovery timers');
const beforeRemoval = removed.map.adds;
for (const fn of staleCallbacks) fn();
removed.map.canvas.emit('webglcontextrestored', {}); removed.map.emit('style.load');
await removed.settle();
assert.equal(removed.map.adds, beforeRemoval, 'already queued callbacks cannot revive a removed map');

// Switching maps must leave no listener or queued callback attached to the
// previous map, even if it was midway through restoring its style.
const switched = fixture();
for (let i = 0; i < 7; i++) switched.draw();
await switched.settle();
switched.map.lose(); switched.map.restore({ styleReady: false });
await switched.microtasks();
const previousCallbacks = [...switched.timers.values()];
const nextMap = new TestMap();
switched.context.initSlopes(nextMap);
const nextRoot = switched.slopes.root, nextUniforms = switched.slopes.uniforms();
assert.notEqual(nextRoot, switched.root, 'a different map creates a fresh scene');
assert.equal(switched.slopes.frames, 0, 'a fresh scene starts its own frame clock');
const freshReady = revealReady(switched.slopes, nextMap, nextRoot);
assert.equal(freshReady(), false, 'a fresh scene is not ready before its first draw');
switched.draw(nextMap);
assert.equal(switched.slopes.frames, 1);
assert.equal(freshReady(), false, 'a fresh scene still requires its second draw');
switched.draw(nextMap);
assert.equal(switched.slopes.frames, 2);
assert.equal(freshReady(), true, 'a fresh scene becomes ready after its two draws');
assert.equal(switched.map.canvas.listenerCount('webglcontextrestored'), 0);
assert.equal(switched.map.eventNames().reduce((n, name) => n + switched.map.listenerCount(name), 0), 0);
assert.equal(switched.timers.size, 0, 'switching maps cancels the previous recovery timer');
const previousAdds = switched.map.adds;
for (const fn of previousCallbacks) fn();
switched.map.canvas.emit('webglcontextrestored', {}); switched.map.emit('style.load');
await switched.settle();
assert.equal(switched.map.adds, previousAdds, 'stale recovery cannot reinstall on the previous map');
assert.equal(nextMap.adds, 1);
nextMap.lose(); nextMap.restore();
await switched.settle();
assert.equal(nextMap.adds, 2, 'the replacement map has its own working recovery listeners');
assert.equal(switched.slopes.root, nextRoot);
assert.equal(switched.slopes.uniforms(), nextUniforms);
switched.map.remove(); nextMap.remove();

live.map.remove(); phone.map.remove();
assert.deepEqual([...live.errors, ...phone.errors, ...removed.errors, ...switched.errors], [], 'lifecycle must not hide failures in console warnings');
console.log('PASS: same-map recovery retains scene, groups, uniforms and reveal-frame readiness; fresh-map frame reset; delayed style readiness; repeated restoration; permanent phone fallback; removed/replaced map listener and pending-callback cleanup');
