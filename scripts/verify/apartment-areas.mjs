// apartment-areas.mjs — on-demand areas in js/slopes-apartments.js (APARTMENTS.areas).
//
// No browser, no server. The real module runs in a sandbox against a stub map
// and a stub slopes layer; only the per-building geometry (buildingOne) and
// the geometry builder are stubbed, so boot(), build(specs, area), the filter
// plan, the catalog and the area state machine are the shipped code.
//
// Claims, each asserted:
//   1. the start fetches the core only: no area file is requested, and the
//      core builds and reports ready without it;
//   2. a camera within loadM of an area's box fetches, builds and attaches it
//      as its own group: its buildings join the catalog, the counts grow by
//      exactly its triangles, and the outer ring's boxes on its footprints are
//      hidden only once its mesh is in;
//   3. a desktop keeps a built area when the camera leaves; a phone drops it
//      past unloadM, the boxes come back, the counts return to the core's and
//      the parsed files are forgotten;
//   4. ensureAt([lng, lat]) builds an area before the camera arrives, and a
//      phone does not drop it on the way there;
//   5. a core rebuild (a detail change) takes the areas down with it and
//      brings a near one back afterwards, with no double counting;
//   6. an area dropped in the middle of its build stops and takes back what
//      it had counted;
//   7. ?areas=eager puts every area in the core at start (the old behaviour).
//
// --break makes every area eager, i.e. loads Riverside at start again; claim 1
// must then fail.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

let source = fs.readFileSync(new URL('../../js/slopes-apartments.js', import.meta.url), 'utf8');
if (process.argv.includes('--break')) {
  const a = "eager: q.get('areas') === 'eager',";
  assert.ok(source.includes(a), '--break anchor');
  source = source.replace(a, 'eager: true,');
}
const at = source.lastIndexOf('})();');
const idleTicks = async (n = 40) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };

const CAMPUS = [-97.7393, 30.2861];
const BBOX = [-97.7320, 30.2350, -97.7090, 30.2426];
const NEAR = [-97.7205, 30.2300];          // ~560 m south of the box
const FAR = [-97.7400, 30.2700];           // ~3.4 km away: past every unload distance
const ring = (lng, lat, d = 0.0002) => [[lng, lat], [lng + d, lat], [lng + d, lat + d], [lng, lat + d], [lng, lat]];
const FILES = {
  'data/apartments/index.json': {
    buildings: ['core-a.json'], collections: ['data/core-bundle.json'],
    areas: { riverside: { bbox: BBOX, collections: ['data/apartments/r1.json', 'data/apartments/r2.json'] } },
  },
  'data/apartments/core-a.json': { id: 'core-a', name: 'Core A', footprint: { ring: ring(-97.742, 30.288) } },
  'data/core-bundle.json': { buildings: [{ id: 'core-b', name: 'Core B', footprint: { ring: ring(-97.741, 30.287) } }] },
  'data/apartments/r1.json': { buildings: [
    { id: 'way/1', name: 'River One', replaceOuter: true, footprint: { ring: ring(-97.720, 30.238) } },
    { id: 'way/2', name: 'River Two', replaceOuter: true, footprint: { ring: ring(-97.715, 30.239) } }] },
  'data/apartments/r2.json': { buildings: [{ id: 'way/3', name: 'River Site', footprint: { ring: ring(-97.712, 30.237) } }] },
};
const TRIS = 100;                         // stub triangles per building

function sandbox({ phone = false, search = '?slopes=0' } = {}) {
  const requested = [], added = [], removedGroups = [];
  const handlers = {};
  const layers = { 'buildings-3d': { filter: ['has', 'id'] }, 'buildings-labels': { field: ['get', 'name'] }, 'outer-3d': { filter: ['==', 't', 0] } };
  const cam = { center: CAMPUS, eye: CAMPUS };
  const map = {
    style: {},
    getLayer: id => layers[id],
    getFilter: id => layers[id].filter,
    setFilter(id, v) { layers[id].filter = v; },
    getLayoutProperty: id => layers[id].field,
    setLayoutProperty(id, k, v) { layers[id].field = v; },
    getSource: () => null, isSourceLoaded: () => true,
    triggerRepaint() {},
    getCenter: () => ({ lng: cam.center[0], lat: cam.center[1] }),
    getFreeCameraOptions: () => ({ position: { toLngLat: () => ({ lng: cam.eye[0], lat: cam.eye[1] }) } }),
    on(n, fn) { (handlers[n] = handlers[n] || []).push(fn); },
    once(n, fn) { (handlers['once:' + n] = handlers['once:' + n] || []).push(fn); },
  };
  const THREE = {
    DoubleSide: 2, FrontSide: 0,
    Mesh: class { constructor(g, m) { this.geometry = g; this.material = m; this.userData = {}; } },
    Group: class { constructor() { this.children = []; this.userData = {}; } add(o) { this.children.push(o); } traverse(fn) { fn(this); this.children.forEach(fn); } },
  };
  const slopes = {
    root: {}, frames: 1000,
    onSwitch() {},
    fetchJSON(url) { requested.push(url); const d = FILES[url]; return d ? Promise.resolve(JSON.parse(JSON.stringify(d))) : Promise.reject(new Error('404 ' + url)); },
    build() { return { triangles: 0, geometry: () => ({ dispose() {} }) }; },
    material: () => ({}),
    add(g) { added.push(g.name); },
    remove(g) { removedGroups.push(g.name); },
  };
  const location = { search };
  const window = {
    location, __map: map, THREE, slopes, SLOPES: { on: true }, GFX: { preset: 'balanced' },
    LITE_PROFILE: phone ? { on: true } : undefined,
  };
  const document = { getElementById: () => null, hidden: false };
  const ctx = vm.createContext({ window, location, document, URLSearchParams, console: { log() {}, warn() {}, error: console.error, info() {} },
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, performance, MessageChannel, Promise });
  // Stub only the geometry: one yield per building, TRIS triangles each.
  const stub = `
    buildingOne = function* (B, spec) {
      if (window.__onBuilding) window.__onBuilding(spec);
      count.buildings++; count.names.push(spec.name); B.triangles += ${TRIS};
      yield;
      return { name: spec.name, id: spec.id, top: 10 };
    };
    window.test = { boot, get core() { return _core; }, get building() { return _building; }, APTS };`;
  vm.runInContext(source.slice(0, at) + stub + source.slice(at), ctx);
  const emit = n => (handlers[n] || []).forEach(fn => fn());
  const moveTo = async (p, eye = p) => { cam.center = p; cam.eye = eye; emit('moveend'); await idleTicks(); };
  return { window, map, layers, requested, added, removedGroups, moveTo, api: window.test, A: () => window.slopesApartments };
}
async function booted(s) {
  assert.equal(await s.api.boot(), true, 'boot completes');
  for (let i = 0; i < 200 && (!s.A().group || s.api.building); i++) await idleTicks(5);
  assert.ok(s.A().group, 'core group attached');
}
const areaFiles = s => s.requested.filter(u => /\/r[12]\.json$/.test(u));
const outerClause = s => JSON.stringify(s.layers['outer-3d'].filter).includes('distance');
const area = s => s.A().areas.list[0];

// ── 1-3: desktop ───────────────────────────────────────────────────────
{
  const s = sandbox();
  await booted(s);
  assert.deepEqual(areaFiles(s), [], '1: the start requests no area file');
  assert.equal(s.A().count.buildings, 2, '1: core only');
  assert.equal(s.A().count.triangles, 2 * TRIS);
  s.window.slopes.frames += 5;            // a few frames drawn since the build
  assert.equal(s.A().readyToReveal(), true, '1: the core alone is ready');
  assert.equal(area(s).state, 'idle');
  assert.equal(outerClause(s), false, '1: no outer box is hidden before its model exists');

  await s.moveTo(NEAR);
  for (let i = 0; i < 50 && area(s).state !== 'on'; i++) await idleTicks(5);
  assert.equal(area(s).state, 'on', '2: a near camera builds the area');
  assert.deepEqual(areaFiles(s).sort(), ['data/apartments/r1.json', 'data/apartments/r2.json'], '2: its files, once each');
  assert.ok(s.added.includes('slopes-apartments-riverside'), '2: its own group');
  assert.equal(s.A().count.buildings, 5);
  assert.equal(s.A().count.triangles, 5 * TRIS, '2: counts grow by exactly its triangles');
  assert.equal(area(s).triangles, 3 * TRIS);
  assert.ok(s.A().data.buildings.some(b => b.name === 'River One'), '2: its buildings join the catalog');
  assert.ok(outerClause(s), '2: its replaceOuter footprints hide the outer boxes');
  assert.ok(JSON.stringify(s.layers['buildings-3d'].filter).includes('way/1'), '2: its ids join the prism clause');

  await s.moveTo(FAR);
  assert.equal(area(s).state, 'on', '3: a desktop keeps a built area');
  await s.moveTo(NEAR);
  assert.equal(areaFiles(s).length, 2, '3: and never fetches it twice');

  // 5: a detail change rebuilds the core; the area goes and comes back.
  s.window.GFX.preset = 'performance';
  s.window.applySlopesApartments(s.map);
  assert.ok(s.removedGroups.includes('slopes-apartments-riverside'), '5: the area goes with the core');
  for (let i = 0; i < 200 && (s.api.building || area(s).state !== 'on'); i++) await idleTicks(5);
  assert.equal(area(s).state, 'on', '5: and comes back after it');
  assert.equal(s.A().count.buildings, 5, '5: no double counting');
  assert.equal(s.A().count.triangles, 5 * TRIS);
  assert.equal(areaFiles(s).length, 2, '5: from the parsed files, not a new download');
}

// ── 3-4: phone ─────────────────────────────────────────────────────────
{
  const s = sandbox({ phone: true });
  await booted(s);
  assert.deepEqual(areaFiles(s), [], '1 (phone): the start requests no area file');
  await s.moveTo(NEAR);
  for (let i = 0; i < 50 && area(s).state !== 'on'; i++) await idleTicks(5);
  assert.equal(area(s).state, 'on');
  await s.moveTo(FAR);
  assert.equal(area(s).state, 'idle', '3: a phone drops the area past unloadM');
  assert.ok(s.removedGroups.includes('slopes-apartments-riverside'), '3: its mesh is removed');
  assert.equal(outerClause(s), false, '3: the outer boxes come back');
  assert.equal(s.A().count.triangles, 2 * TRIS, '3: counts return to the core');
  assert.equal(s.A().count.buildings, 2);
  assert.ok(!s.A().data.buildings.some(b => b.name === 'River One'), '3: the catalog returns to the core');
  assert.equal(area(s).specs, 0, '3: and its parsed files are forgotten');

  // 4: ensureAt from far away; the camera has not arrived and the area stays.
  const done = s.A().areas.ensureAt([-97.7127, 30.2390]);
  await done;
  for (let i = 0; i < 50 && area(s).state !== 'on'; i++) await idleTicks(5);
  assert.equal(area(s).state, 'on', '4: ensureAt builds before the camera arrives');
  await s.moveTo(FAR);
  assert.equal(area(s).state, 'on', '4: a phone keeps it while the flight is on its way');
}

// ── 6: dropped mid-build ───────────────────────────────────────────────
{
  const s = sandbox({ phone: true });
  await booted(s);
  let during = null;
  // Drop the area while its second building is being built.
  s.window.__onBuilding = spec => { if (spec.id === 'way/2') { during = area(s).state; s.A().areas.unload('riverside'); } };
  s.A().areas.ensureAt(NEAR);
  for (let i = 0; i < 100; i++) await idleTicks(5);
  assert.equal(during, 'building', '6: the drop landed mid-build');
  assert.equal(area(s).state, 'idle', '6: a dropped build does not attach');
  assert.ok(!s.added.includes('slopes-apartments-riverside'), '6: its group never reaches the scene');
  assert.equal(s.A().count.buildings, 2, '6: and what it had counted is taken back');
  assert.equal(s.A().count.triangles, 2 * TRIS);
  assert.deepEqual(Array.from(s.A().count.names).sort(), ['Core A', 'Core B']);
}

// ── 7: eager ───────────────────────────────────────────────────────────
{
  const s = sandbox({ search: '?slopes=0&areas=eager' });
  await booted(s);
  assert.equal(areaFiles(s).length, 2, '7: ?areas=eager loads every area at start');
  assert.equal(s.A().areas.list.length, 0, '7: and registers no on-demand area');
  assert.equal(s.A().count.buildings, 5);
}

console.log('PASS: the start fetches the core only; a near camera builds an area as its own group and hides its boxes only once built; a desktop keeps it, a phone drops it past unloadM and forgets its files; ensureAt builds ahead of the camera; a core rebuild takes areas down and back without double counting; a dropped build takes back its counts; ?areas=eager is the old start');
process.exit(0);   // the module's own late-filter poll would keep the process alive for minutes
