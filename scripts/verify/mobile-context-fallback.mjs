// CPU regression for released geometry and the phone's one-reload policy.
// Run: node scripts/verify/mobile-context-fallback.mjs
// --break removes the production switch-off; the restored-render gate fails.
// Browser verification must still check MapLibre filters, pixels and controls.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

let slopes = fs.readFileSync(new URL('../../js/slopes.js', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const mobile = fs.readFileSync(new URL('../../js/mobile.js', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
if (process.argv.includes('--break')) slopes = slopes.replace('    SLOPES.on = false;', '    // broken: leave released meshes enabled');
function cut(source, from, to) {
  const a = source.indexOf(from), b = source.indexOf(to, a);
  assert.ok(a >= 0 && b > a, 'source markers moved: ' + from);
  return source.slice(a, b);
}
const switches = cut(slopes, '  const _switchHooks = [];', '  // ── The shader:');
const upload = cut(slopes, '  const FREE_CPU =', '  // ── The builder:');
const render = cut(slopes, '    render(gl, args, prepareOnly=false) {', '\n  };');
const settings = cut(mobile, '  const LITE = {', '  function isSmallTouchDevice()');
const reload = cut(mobile, '  const lsGet =', '  // ── The boot record');
const recovery = cut(mobile, '  // ── WebGL context loss', '  // ── The profile,');

const storage = (data = new Map(), blocked = false) => ({
  getItem(key) { if (blocked) throw Error('storage unavailable'); return data.get(key) ?? null; },
  setItem(key, value) { if (blocked) throw Error('storage unavailable'); data.set(key, String(value)); },
});
function fixture({ local = storage(), session = storage(), hidden = false, on = true, boot = false } = {}) {
  const state = { reloads: 0, notices: [], strikes: 0, hooks: [], repaints: 0, bounds: 0 };
  const listeners = new Map(), timers = new Map();
  let nextTimer = 0;
  const window = { SLOPES: { on }, LITE_PROFILE: { budget: { freeGeometryCpu: true } },
    addEventListener(type, fn, capture) {
      assert.equal(capture, true, 'context events must be captured before target restoration');
      listeners.set(type, fn);
    } };
  const document = { visibilityState: hidden ? 'hidden' : 'visible',
    addEventListener(type, fn) { listeners.set(type, fn); } };
  const trapped = new Proxy({}, { get() { throw Error('restored render touched the invalid scene'); } });
  const scope = vm.createContext({ window, document, SLOPES: window.SLOPES,
    scene: {}, root: trapped, _map: { triggerRepaint() { state.repaints++; } },
    localStorage: local, sessionStorage: session, location: { reload() { state.reloads++; } },
    Date: { now: () => 123456789 }, console: { warn() {}, error: (...args) => assert.fail(args.join(' ')) },
    setTimeout(fn, ms) { const id = ++nextTimer; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    B: { revealed: !boot }, st: { tier: 0 }, introFlying: () => false,
    strike() { state.strikes++; scope.st.tier++; return true; },
    showNotice(reason) { state.notices.push(reason); },
  });
  vm.runInContext(switches + upload + settings + reload, scope);
  window.slopes = { useContextFallback: scope.useContextFallback };
  scope.onSwitch(value => state.hooks.push(value));
  vm.runInContext(recovery, scope);
  const layer = vm.runInContext('({' + render + '})', scope);
  const attribute = values => ({ array: new Float32Array(values), count: values.length / 3,
    isBufferAttribute: true, onUpload(fn) { this.onUploadCallback = fn; } });
  const geometry = { isBufferGeometry: true, attributes: { position: attribute([0, 0, 0, 1, 0, 0, 0, 1, 0]) },
    index: attribute([0, 1, 2]), computeBoundingSphere() { state.bounds++; this.boundingSphere = { radius: 1 }; } };
  scope.freeOnUpload({ traverse(fn) { fn({ geometry }); } });
  assert.equal(state.bounds, 1, 'culling bounds must exist before CPU data is released');
  geometry.attributes.position.onUploadCallback();
  geometry.index.onUploadCallback();
  assert.equal(geometry.attributes.position.array, null);
  assert.equal(geometry.index.array, null);
  assert.equal(geometry.attributes.position.count, 3, 'release must retain attribute metadata');
  const event = isMap => ({ target: { classList: { contains: name => isMap && name === 'maplibregl-canvas' } } });
  return { state, window, scope, timers,
    lose(isMap = true) { listeners.get('webglcontextlost')(event(isMap)); },
    restore() { listeners.get('webglcontextrestored')(event(true)); },
    renderRestored() { layer.render({ isContextLost: () => false }, {}); },
    reveal() { document.visibilityState = 'visible'; listeners.get('visibilitychange')(); },
    flush() { for (const [id, { fn }] of [...timers]) { timers.delete(id); fn(); } },
  };
}

function assertSuspended(f) {
  assert.equal(f.window.SLOPES.on, false, 'loss must disable released meshes before any timer or restored frame');
  assert.deepEqual(f.state.hooks, [false], 'switch hooks must restore the map stand-ins once');
  assert.equal(f.window.LITE_PROFILE.contextFallback, true);
  assert.doesNotThrow(() => f.renderRestored(), 'a restored frame must not reach the released buffers');
  f.window.SLOPES.on = true;
  assert.equal(f.window.SLOPES.on, false, 'a settings change cannot revive the invalid scene');
}

const sharedLocal = storage(), sharedSession = storage();
const first = fixture({ local: sharedLocal, session: sharedSession, boot: true });
first.lose();
assert.equal(first.state.strikes, 1, 'record the boot loss before disabling slopes');
assertSuspended(first);
first.restore();
assertSuspended(first); // restoration happens before the zero-delay reload timer
first.flush();
assert.equal(first.state.reloads, 1, 'the first loss still gets its automatic reload');
assert.deepEqual(first.state.notices, []);

// A fresh page after that reload gets fresh geometry but shares the reload cap.
const second = fixture({ local: sharedLocal, session: sharedSession });
second.lose(); second.restore(); assertSuspended(second); second.flush();
assert.equal(second.state.reloads, 0, 'a second loss must not create a reload loop');
assert.deepEqual(second.state.notices, ['ctx']);
second.lose(); second.restore(); second.flush(); second.renderRestored();
assert.equal(second.state.reloads, 0, 'further losses restore only the fallback map');
assert.deepEqual(second.state.notices, ['ctx'], 'a handled loss is not retried on later visibility changes');
second.reveal(); second.flush();
assert.deepEqual(second.state.notices, ['ctx']);

const hidden = fixture({ local: sharedLocal, hidden: true });
hidden.lose(); hidden.restore(); assertSuspended(hidden);
assert.equal(hidden.timers.size, 0, 'do not reload a backgrounded page');
hidden.reveal(); hidden.flush();
assert.equal(hidden.state.reloads, 0);
assert.deepEqual(hidden.state.notices, ['ctx']);

const blocked = fixture({ local: storage(new Map(), true), session: storage(new Map(), true) });
blocked.lose(); blocked.restore(); assertSuspended(blocked); blocked.flush();
assert.equal(blocked.state.reloads, 0, 'unrecordable reloads are never attempted');
assert.deepEqual(blocked.state.notices, ['ctx']);

const sessionOnly = storage();
for (const expectedReloads of [1, 0]) {
  const f = fixture({ local: storage(new Map(), true), session: sessionOnly });
  f.lose(); assertSuspended(f); f.flush(); // loss timeout without a restore event
  assert.equal(f.state.reloads, expectedReloads, 'session storage also preserves the cap');
}
const safe = fixture({ on: false });
safe.lose(); safe.restore(); safe.flush(); safe.renderRestored();
assert.equal(safe.state.reloads, 0);
assert.deepEqual(safe.state.notices, []);
assert.deepEqual(safe.state.hooks, []);
const otherCanvas = fixture();
otherCanvas.lose(false); otherCanvas.flush();
assert.equal(otherCanvas.window.SLOPES.on, true, 'unrelated canvases must not disable the city');
assert.equal(otherCanvas.state.reloads, 0);

// A compiled group's owner may retain arrays for re-upload instead. Honour it
// both when added directly and when nested in a larger legacy group.
const retainedRoot = { userData: { retainGeometryCpu: true },
  traverse() { assert.fail('a retained root must bypass legacy release traversal'); } };
otherCanvas.scope.freeOnUpload(retainedRoot);
const makeMesh = parent => ({ parent, geometry: { isBufferGeometry: true, boundingSphere: {}, attributes: {
  position: { isBufferAttribute: true, array: new Float32Array([1, 2, 3]), onUpload(fn) { this.callback = fn; } },
} } });
const retained = makeMesh({ parent: retainedRoot }), legacy = makeMesh(null);
otherCanvas.scope.freeOnUpload({ traverse(fn) { fn(retained); fn(legacy); } });
assert.equal(retained.geometry.attributes.position.callback, undefined, 'nested owned geometry keeps its CPU array');
assert.equal(typeof legacy.geometry.attributes.position.callback, 'function', 'unowned geometry still releases its CPU copy');

// Filtering proxies can now be below a per-building group, not direct children.
const filteredSource = cut(slopes, '      const filtered=[];', '      try {\n        scene.overrideMaterial');
const nestedFace = { userData: { disposeFacade() {} }, visible: true };
const hiddenFace = { userData: { disposeFacade() {} }, visible: false };
const shell = { userData: {}, visible: true };
const shadowScope = vm.createContext({ window: { slopesApartments: { group: {
  traverse(fn) { for (const o of [{ children: [nestedFace] }, nestedFace, hiddenFace, shell]) fn(o); },
} } } });
vm.runInContext(filteredSource, shadowScope);
assert.equal(nestedFace.visible, false, 'nested filtered facade must be excluded from the shadow pass');
assert.equal(hiddenFace.visible, false);
assert.equal(shell.visible, true, 'building geometry still casts a shadow');
assert.equal(vm.runInContext('filtered.length', shadowScope), 1);

console.log('PASS: released geometry stays suspended before restored frames; one reload survives; capped, hidden and storage-blocked recovery keeps fallback; retained groups keep CPU data; nested facade proxies leave the shadow pass');
