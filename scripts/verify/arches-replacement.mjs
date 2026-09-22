// Exercise real arcade generation and replacement lifecycle without a GPU.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../../js/slopes-arches.js', import.meta.url), 'utf8');
const legacy = JSON.parse(fs.readFileSync(new URL('../../data/entrances.geojson', import.meta.url), 'utf8')).arches;
const sut = Object.values(legacy).find(a => a.ref === 'SUT' && a.arcade);
assert.ok(sut, 'fixture must include Sutton actual legacy arcade');
const arches = { sut, other: { ...sut, bid: 'other', ref: 'OTHER' } };

async function fixture(prebuilt = false) {
  let disposed = 0, scans = 0;
  class Group {
    constructor() { this.children = []; this.userData = {}; this.parent = null; }
    add(child) { child.parent = this; this.children.push(child); }
    traverse(fn) { fn(this); this.children.forEach(child => fn(child)); }
  }
  class Mesh { constructor(geometry) { this.geometry = geometry; } }
  const handlers = new Map(), filters = {};
  const map = {
    getLayer: () => ({}), getFilter: id => filters[id] || null,
    setFilter: (id, value) => { filters[id] = value; }, triggerRepaint() {},
    on: (name, fn) => handlers.set(name, fn),
  };
  const slopes = {
    root: new Group(), detail: () => 1, frame: () => ({}), material: () => ({}),
    build: () => ({ triangles: 0, extrude() { this.triangles++; }, geometry: () => ({ dispose() { disposed++; } }) }),
    add(g) { this.root.add(g); }, remove(g) { g.parent = null; }, onSwitch() {},
  };
  const apartments = {
    group: null, data: { buildings: [{ id: sut.bid, replaceArcades: true }, { id: 'other', replaceFrontage: true }] },
    successes: [], get built() { scans++; return this.successes.map(id => ({ id })); },
  };
  const attach = ids => { apartments.successes = ids; apartments.group = new Group(); slopes.add(apartments.group); };
  if (prebuilt) attach([sut.bid, 'other']);
  const location = { search: '?slopes=0' };
  const window = { location, __map: map, slopes, slopesApartments: apartments,
    SLOPES: { on: true }, APARTMENTS: { on: true }, THREE: { Group, Mesh },
    CityLighting: { glassColour: c => c }, entrancesGeoJSON: async () => ({ arches }) };
  const scope = vm.createContext({ window, location, URLSearchParams, console, performance });
  const end = source.lastIndexOf('})();');
  vm.runInContext(source.slice(0, end) + 'window.testBoot = boot;' + source.slice(end), scope);
  assert.equal(await window.testBoot(), true);
  return { window, apartments, slopes, attach, render: () => handlers.get('render')(),
    count: () => window.slopesArches.count.arches, scans: () => scans, disposed: () => disposed };
}

const f = await fixture();
assert.equal(f.count(), 2, 'downloaded replacement must retain old arcade before its mesh lands');
f.attach(['other']); f.render();
assert.equal(f.count(), 2, 'failed Sutton and non-opted-in other model keep their legacy arches');
f.attach([sut.bid, 'other']); f.render();
assert.equal(f.count(), 1, 'successful opted-in Sutton retires its entire legacy arcade');
const stableGroup = f.window.slopesArches.group, stableScans = f.scans();
for (let i = 0; i < 100; i++) f.render();
assert.equal(f.scans(), stableScans, 'steady render frames must not rescan buildings');
assert.equal(f.window.slopesArches.group, stableGroup, 'steady frames do not rebuild geometry');
f.window.APARTMENTS.on = false; f.render();
assert.equal(f.count(), 2, 'switching replacements off restores old arches');
f.window.APARTMENTS.on = true; f.render();
assert.equal(f.count(), 1);
f.apartments.group = null; f.render();
assert.equal(f.count(), 2, 'in-flight rebuild or failed replacement restores old arches');
f.attach([sut.bid]); f.render();
assert.equal(f.count(), 1);
f.slopes.root = new (f.slopes.root.constructor)(); f.render();
assert.equal(f.count(), 2, 'scene reset cannot retire against a detached old replacement');
assert.equal(f.window.slopesArches.group.parent, f.slopes.root, 'fallback attaches to the new scene');
f.attach([sut.bid]); f.render();
assert.equal(f.count(), 1, 'new scene successful replacement retires restored fallback');
assert.ok(f.disposed() >= 5, 'replaced arcade buffers must be disposed');
const late = await fixture(true);
assert.equal(late.count(), 1, 'arches booting after a successful replacement omit the old arcade immediately');
console.log('PASS: arcade opt-in, failed/not-ready fallback, late boot, toggles, rebuild, scene reset, buffer disposal and steady-frame cache');
