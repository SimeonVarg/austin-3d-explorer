// The shadow proxy is built in slices (js/city-lighting.js PROXY_PACE.budgetMs),
// so the still picture keeps drawing while it is rebuilt after a turn. This
// runs the real shadowProxy/proxyRebuild/proxyGeometry code (no browser)
// against a scripted map whose tile queries each cost 30 ms of the test clock,
// and checks that:
//   - a sliced build returns to the event loop between slices, and no slice
//     runs longer than one query past its budget;
//   - it makes exactly the triangles, byte for byte, of the one-piece build
//     (budgetMs 0, the behaviour before 2026-09-28);
//   - the camera moving mid-build pauses it; still again with the same tiles,
//     it resumes where it was (one proxy, no second start);
//   - tiles changing during the pause restart it, and the result has them;
//   - the proxy arrives with its bounding sphere, so three does not scan the
//     whole buffer inside the first shadow render after the commit;
//   - with slow frames between slices (250 ms each, as on a loaded machine)
//     the slices stretch (stretchMs / maxBudgetMs), so the build finishes in
//     a fraction of the time fixed 5 ms slices would take, and still makes
//     the same bytes.
//   node shadow-proxy-slices.mjs          must exit 0
//   node shadow-proxy-slices.mjs --break  builds in one piece: must exit 1
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const src = fs.readFileSync(new URL('../../js/city-lighting.js', import.meta.url), 'utf8');
const start = src.indexOf('  function shadowProxy(map) {'), end = src.indexOf('  function install(map)', start);
const code = src.slice(start, end);
const BREAK = process.argv.includes('--break');

function world({ localMs = 0, gapMs = 0, scale = 1 } = {}) {
  let now = 1e6, nextId = 0; const timers = new Map();
  let tasks = 0;
  const advance = ms => { const until = now + ms; for (;;) { let due = null; for (const [id, t] of timers) if (t.at <= until && (!due || t.at < due[1].at)) due = [id, t]; if (!due) break; timers.delete(due[0]); now = Math.max(now, due[1].at); tasks++; due[1].fn(); } now = until; };
  const handlers = {}; const emit = (n, e) => (handlers[n] || []).forEach(f => f(e));
  const square = (x, y, s = 1) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]];
  const tile = (key, n) => ({ key, index: {}, features: Array.from({ length: n }, (_, i) => ({ id: key + i, properties: { id: key + '-' + i, h: 20 + i }, geometry: { type: 'Polygon', coordinates: [square(i * 2, key.charCodeAt(0), 1)] } })) });
  const W = { tiles: [tile('a', 40 * scale), tile('b', 30 * scale), tile('c', 50 * scale)], moving: false, driving: false, queries: 0, sliceMax: 0 };
  // Three caster layers on one source: three indivisible queries per build.
  const layers = ['l1', 'l2', 'l3'].map((id, i) => ({ id, type: 'fill-extrusion', source: 'austin-outer', sourceLayer: undefined, filter: ['>', 'h', i], visibility: 'visible' }));
  const map = {
    on: (n, f) => (handlers[n] = handlers[n] || []).push(f), isMoving: () => W.moving, triggerRepaint() {},
    getSource: id => id === 'austin-outer' ? {} : null,
    getStyle: () => ({ layers: layers.map(l => ({ id: l.id, type: l.type, source: l.source, filter: l.filter })) }),
    getLayersOrder: () => ['buildings-3d', ...layers.map(l => l.id)],
    getLayer: id => layers.find(l => l.id === id) || (id === 'buildings-3d' ? { id, type: 'fill-extrusion', source: 'austin', filter: null } : null),
    // Each query costs 30 ms of the clock, as a real querySourceFeatures can.
    querySourceFeatures: (s, o) => { W.queries++; now += 30; const k = Number(o.filter[2]); return W.tiles.flatMap(t => t.features).filter(f => f.properties.h > 20 + k); },
    style: { _loaded: true, tileManagers: { 'austin-outer': { getRenderableIds: () => W.tiles.map(t => t.key), getTileByID: id => { const t = W.tiles.find(t => t.key === id); return t && { latestFeatureIndex: t.index }; } } } },
  };
  class Vector2 { constructor(x, y) { this.x = x; this.y = y; } }
  class Vector3 { constructor(x, y, z) { this.x = x; this.y = y; this.z = z; } }
  class Sphere { constructor(c, r) { this.center = c; this.radius = r; } }
  const built = [];
  class Geometry { constructor() { built.push(this); } setAttribute(n, a) { this.position = a.array; } dispose() {} }
  const THREE = { Vector2, Vector3, Sphere, BufferGeometry: Geometry, BufferAttribute: class { constructor(a) { this.array = a; } },
    Float32BufferAttribute: class { constructor(a) { this.array = Float32Array.from(a); } },
    Mesh: class { constructor(g, m) { this.geometry = g; this.material = m; } }, MeshBasicMaterial: class { dispose() {} },
    ShapeUtils: { triangulateShape: c => c.slice(2).map((_, i) => [0, i + 1, i + 2]) } };
  const window = { THREE, slopes: { toLocal: (x, y) => { now += localMs; return { x, y }; } }, __fly: { eye: () => ({ driving: W.driving }) } };
  const scope = vm.createContext({ window, stats: { failures: [] }, casterSources: ['austin-outer'], buildings: [], console,
    setTimeout: (fn, ms) => { timers.set(++nextId, { fn, at: now + (ms || 0) }); return nextId; }, clearTimeout: id => timers.delete(id) });
  vm.runInContext('Date.now=()=>globalThis.__now();', scope); scope.__now = () => now;
  vm.runInContext('let proxy=null,proxyMap=null,proxyDirty=true,proxyTimer=null,proxySigBuilt=null; const hiddenIds=()=>new Set();\n' + code +
    '\nglobalThis.build=shadowProxy;globalThis.pace=PROXY_PACE;globalThis.job=()=>proxyJob;', scope);
  if (BREAK) scope.pace.budgetMs = 0;
  // Every task the rebuild runs, timed on the test clock.
  const orig = scope.setTimeout;
  scope.setTimeout = (fn, ms) => orig(() => { const t0 = now; fn(); W.sliceMax = Math.max(W.sliceMax, now - t0); }, (ms || 0) + gapMs);
  return { W, map, scope, emit, advance, built, tile, stats: scope.stats, get tasks() { return tasks; }, get now() { return now; } };
}
const results = [];
const check = (name, fn) => { try { fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name + ': ' + e.message]); } };
const bytes = g => Buffer.from(g.position.buffer, g.position.byteOffset, g.position.byteLength);

// 1. The one-piece reference.
const ref = world(); ref.scope.pace.budgetMs = 0;
ref.scope.build(ref.map); ref.advance(1000);
const refGeom = ref.built.at(-1);
check('reference: one-piece build made a proxy', () => assert.ok(refGeom && refGeom.position.length > 0));

// 2. Sliced, camera still.
const a = world();
a.scope.build(a.map); const t0 = a.tasks; a.advance(1000);
const aGeom = a.built.at(-1);
check('sliced: several tasks, not one', () => assert.ok(a.stats.shadowProxyLastSlices >= 3, `slices ${a.stats.shadowProxyLastSlices}`));
check('sliced: no slice longer than one query past the budget', () => assert.ok(a.W.sliceMax <= a.scope.pace.budgetMs + 30, `max slice ${a.W.sliceMax} ms`));
check('sliced: exactly one proxy', () => assert.equal(a.stats.shadowProxyRebuilds, 1));
check('sliced: identical bytes to the one-piece build', () => assert.ok(bytes(aGeom).equals(bytes(refGeom))));
check('sliced: the bounding sphere arrives with the proxy', () => {
  const g = aGeom, s = g.boundingSphere; assert.ok(s, 'no sphere');
  const p = g.position; let mn = [1 / 0, 1 / 0, 1 / 0], mx = [-1 / 0, -1 / 0, -1 / 0];
  for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[i + k]); mx[k] = Math.max(mx[k], p[i + k]); }
  const c = mn.map((v, k) => (v + mx[k]) / 2); let r = 0;
  for (let i = 0; i < p.length; i += 3) r = Math.max(r, Math.hypot(p[i] - c[0], p[i + 1] - c[1], p[i + 2] - c[2]));
  assert.deepEqual([s.center.x, s.center.y, s.center.z], c); assert.ok(Math.abs(s.radius - r) < 1e-9, `${s.radius} vs ${r}`);
});

// 3. The camera moves mid-build, then stops with the same tiles: resume.
const b = world();
b.scope.build(b.map); b.advance(300);          // settle elapses, the first slice runs
b.advance(0);
check('pause: a build is under way', () => assert.ok(b.scope.job(), 'no job'));
const q0 = b.W.queries;
b.W.driving = true; b.emit('move'); b.advance(2000);
check('pause: nothing runs while the flycam drives', () => { assert.equal(b.W.queries, q0); assert.equal(b.stats.shadowProxyRebuilds || 0, 0); });
b.W.driving = false; b.emit('move'); b.emit('moveend'); b.advance(2000);
check('resume: one proxy, no restart', () => { assert.equal(b.stats.shadowProxyRebuilds, 1); assert.equal(b.stats.shadowProxyRestarts || 0, 0); });
check('resume: identical bytes to the one-piece build', () => assert.ok(bytes(b.built.at(-1)).equals(bytes(refGeom))));

// 4. The tiles change during the pause: restart, and the proxy has them.
const c = world();
c.scope.build(c.map); c.advance(300); c.advance(0);
c.W.driving = true; c.emit('move'); c.W.tiles.push(c.tile('d', 20)); c.emit('sourcedata', { sourceId: 'austin-outer' }); c.advance(1000);
c.W.driving = false; c.emit('move'); c.emit('moveend'); c.scope.build(c.map); c.advance(3000);
check('restart: counted once', () => assert.equal(c.stats.shadowProxyRestarts, 1));
check('restart: the proxy includes the tile that landed', () => assert.ok(c.built.at(-1).position.length > refGeom.position.length));

// 5. Slow frames: 250 ms between slices, triangle work that costs time.
const slow = (stretchMs) => {
  const w = world({ localMs: 0.1, gapMs: 250, scale: 10 }); w.scope.pace.stretchMs = stretchMs;
  if (BREAK) w.scope.pace.budgetMs = 0;
  const t = w.now; w.scope.build(w.map); for (let i = 0; i < 200 && !w.stats.shadowProxyRebuilds; i++) w.advance(1000);
  return { ms: w.stats.shadowProxyLastBuildMs, slices: w.stats.shadowProxyLastSlices, max: w.W.sliceMax, geom: w.built.at(-1), budget: w.scope.pace };
};
const fixed = slow(0), stretched = slow(1000);
console.log(`slow frames (250 ms between slices): fixed 5 ms slices ${Math.round(fixed.ms)} ms / ${fixed.slices} slices, stretched ${Math.round(stretched.ms)} ms / ${stretched.slices} slices, longest ${Math.round(stretched.max)} ms`);
const slowRef = world({ localMs: 0.1, scale: 10 }); slowRef.scope.pace.budgetMs = 0; slowRef.scope.build(slowRef.map); slowRef.advance(1000);
check('stretch: fixed 5 ms slices under slow frames take many seconds (the problem)', () => assert.ok(fixed.ms > 5000, `fixed ${Math.round(fixed.ms)} ms`));
check('stretch: stretched slices finish in under half that', () => assert.ok(stretched.ms < fixed.ms / 2, `stretched ${Math.round(stretched.ms)} ms vs fixed ${Math.round(fixed.ms)} ms`));
check('stretch: no slice past maxBudgetMs + one query', () => assert.ok(stretched.max <= stretched.budget.maxBudgetMs + 30, `max slice ${stretched.max} ms`));
check('stretch: identical bytes to the one-piece build', () => assert.ok(bytes(stretched.geom).equals(bytes(slowRef.built.at(-1)))));

for (const [s, n] of results) console.log(s.padEnd(5), n);
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(failed ? `FAIL: ${failed} of ${results.length}${BREAK ? ' (--break: expected)' : ''}` : `PASS: ${results.length} checks${BREAK ? ' -- but --break was supposed to fail' : ''}`);
process.exit(failed ? 1 : 0);
