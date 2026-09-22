// Exercise the production geometry mask and filter lifecycle without a renderer.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../../js/slopes-apartments.js', import.meta.url), 'utf8');
const hook = `window.test = {
  setup(data, map) { _data = data; _map = map; },
  fail(id) { _failed.add(id); },
  hideGeometry, filterPlan, setFilters, filtersMissing
};`;
const at = source.lastIndexOf('})();');
assert.ok(at > 0);
const location = { search: '?slopes=0' };
const scope = vm.createContext({ window: { location }, location, URLSearchParams, console });
vm.runInContext(source.slice(0, at) + hook + source.slice(at), scope);
const api = scope.window.test;
const rect = (x, y, width = 20, depth = 20) => {
  const lng = -97.74, lat = 30.28, mx = 111320 * Math.cos(lat * Math.PI / 180), my = 110540;
  return [[x,y],[x+width,y],[x+width,y+depth],[x,y+depth],[x,y]].map(([a,b]) => [lng+a/mx,lat+b/my]);
};
const buildings = [
  { id: 'shop', name: 'Shop', replaceFrontage: true, preserveRoofscape: true, footprint: { ring: rect(0,0) }, hideRings: [rect(100,100)] },
  { id: 'campus', name: 'Campus', footprint: { ring: rect(200,0) } },
  { id: 'failed', name: 'Failed shop', replaceFrontage: true, footprint: { ring: rect(300,0) } }
];
const base = ['==', ['get', 'kind'], 'detail'];
const frontageBase = ['==', ['get', 'kind'], 'frontage'];
const layers = { 'drag-detail': { filter: base }, 'places-solid': { filter: frontageBase } };
let filterWrites = 0;
const map = {
  getLayer: id => layers[id],
  getFilter: id => layers[id]?.filter ?? null,
  setFilter: (id, filter) => { filterWrites++; layers[id].filter = filter; }
};
api.setup({ buildings, replacedBuildingIds: buildings.map(b => b.id), replacedNames: buildings.map(b => b.name) }, map);
api.fail('failed');
const plain = value => JSON.parse(JSON.stringify(value));
const plan = api.filterPlan();
assert.equal(new Set(plan.map(([id]) => id)).size, plan.length, 'each layer needs one combined clause');
const detail = plan.find(([id]) => id === 'drag-detail')[1];
assert.equal(detail[0], 'all');
assert.deepEqual(plain(detail[1][1][2][1]), ['shop', 'campus'], 'tagged campus details remain hidden; failed fallback stays');
const geo = detail[2][1][1];
assert.equal(geo.coordinates.length, 1, 'only successful frontage footprints belong in the mask, not campus or hideRings');
assert.strictEqual(api.hideGeometry(1, false, true), geo, 'geometry is cached');
const bounds = ring => [Math.min(...ring.map(p=>p[0])),Math.min(...ring.map(p=>p[1])),Math.max(...ring.map(p=>p[0])),Math.max(...ring.map(p=>p[1]))];
const own = bounds(buildings[0].footprint.ring), mask = bounds(geo.coordinates[0][0]);
assert.ok(mask[0] > own[0] && mask[1] > own[1] && mask[2] < own[2] && mask[3] < own[3], 'mask must stay inset');
const oldTrim = bounds(rect(-0.34,-0.34,20.68,20.68));
assert.ok(oldTrim[0] < mask[0] && oldTrim[2] > mask[2], 'filled old cornice overlaps its replacement mask');
const neighborTrim = bounds(rect(19.66,-0.34,20.68,20.68));
assert.ok(neighborTrim[0] > mask[2], 'adjacent proud cornice must stay clear');
api.setFilters(true);
assert.deepEqual(plain(layers['drag-detail'].filter), ['all', base, plain(detail)], 'both id and geometry clauses survive apply');
assert.deepEqual(plain(api.filtersMissing()), []);
const appliedWrites = filterWrites;
api.setFilters(true);
assert.deepEqual(plain(api.filtersMissing()), [], 'reapply must settle, not alternate clauses');
assert.equal(filterWrites, appliedWrites, 'unchanged successful plan must not write filters');
layers['drag-detail'].filter = base;
assert.deepEqual(plain(api.filtersMissing()), ['drag-detail']);
api.setFilters(true);
assert.deepEqual(plain(api.filtersMissing()), [], 'repair restores both clauses');
api.setFilters(false);
assert.deepEqual(plain(layers['drag-detail'].filter), base, 'switch-off restores the original detail filter');
assert.deepEqual(plain(layers['places-solid'].filter), frontageBase, 'switch-off restores the original frontage filter');
api.setFilters(true);
const otherPass = ['!=', ['get', 'retired'], true];
layers['places-solid'].filter = ['all', layers['places-solid'].filter, otherPass];
api.fail('shop');
api.setFilters(true);
const fallback = api.filterPlan().find(([id]) => id === 'drag-detail')[1];
assert.deepEqual(plain(fallback), ['!', ['in', ['get','bid'], ['literal',['campus']]]], 'failed frontage restores its tagged and untagged fallback');
assert.equal(api.hideGeometry(1, false, true), null);
assert.deepEqual(plain(layers['drag-detail'].filter), ['all', base, plain(fallback)], 'changed plan removes old geometry');
assert.ok(!api.filterPlan().some(([id]) => id === 'places-solid'), 'all failed frontages remove their layer from the plan');
assert.deepEqual(plain(layers['places-solid'].filter), ['all', frontageBase, otherPass], 'last frontage failure restores skins while preserving another pass');
assert.deepEqual(plain(api.filtersMissing()), []);
layers['drag-detail'].filter = ['all', layers['drag-detail'].filter, otherPass];
api.fail('campus');
api.setFilters(true);
assert.equal(api.filterPlan().length, 0, 'all model failures leave an empty replacement plan');
assert.deepEqual(plain(layers['drag-detail'].filter), ['all', base, otherPass], 'empty plan restores the final saved exclusion');
assert.deepEqual(plain(api.filtersMissing()), []);
const restoredWrites = filterWrites;
api.setFilters(true);
assert.equal(filterWrites, restoredWrites, 'restored empty plan must settle without filter writes');
api.setFilters(false);
assert.deepEqual(plain(layers['drag-detail'].filter), ['all', base, otherPass], 'switch-off preserves already restored filters');
console.log('PASS: frontage-only cached geometry, inset neighbor preservation, unique combined clauses, repair, all-frontages-failed and empty-plan fallback');
