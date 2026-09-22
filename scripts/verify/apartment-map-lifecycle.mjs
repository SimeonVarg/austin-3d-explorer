// Run the real apartment callbacks against a map whose style disappears during
// WebGL recovery. No renderer or synthetic replacement implementation needed.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
let source = fs.readFileSync(new URL('../../js/slopes-apartments.js', import.meta.url), 'utf8');
if (process.argv.includes('--break')) source = source.replace("(!('style' in map) || !!map.style)", 'true');
const at = source.lastIndexOf('})();');
const pending = new Map(); let nextTimer = 0;
const schedule = (fn, ms) => { const id = ++nextTimer; pending.set(id, {fn, ms}); return id; };
const cancel = id => pending.delete(id);
const tick = () => {
  const item = [...pending].find(([, t]) => t.ms === 500 || t.ms === 1000);
  assert.ok(item, 'late replacement poll remains scheduled');
  pending.delete(item[0]); item[1].fn();
};
let reads = 0, writes = 0, disposed = 0, removed = 0, repaints = 0;
const events = new Map(), switches = [];
const baseFilter = ['has', 'id'], baseLabel = ['get', 'name'];
const layers = {
  'buildings-3d': {filter: baseFilter},
  'buildings-labels': {field: baseLabel}
};
const map = {
  style: {},
  isStyleLoaded: () => false, // tile downloads must not suppress replacements
  getStyle() { throw Error('must not serialize the style'); },
  getLayer(id) { reads++; if (!this.style) throw Error('null.getLayer'); return layers[id]; },
  getFilter: id => layers[id].filter,
  setFilter(id, value) { writes++; layers[id].filter = value; },
  getLayoutProperty: id => layers[id].field,
  setLayoutProperty(id, key, value) { writes++; layers[id].field = value; },
  getSource: () => null,
  triggerRepaint() { repaints++; },
  once(name, fn) { assert.equal(events.has(name), false, 'one remove subscription'); events.set(name, fn); }
};
const group = {traverse(fn) { fn({geometry: {dispose() { disposed++; }}}); }};
const location = {search: '?slopes=0'};
const window = {location, __map: map, SLOPES: {on: true}, slopes: {
  root: {}, frames: 100, onSwitch(fn) { switches.push(fn); }, remove() { removed++; }
}};
const scope = vm.createContext({window, location, URLSearchParams, console,
  setTimeout: schedule, clearTimeout: cancel, setInterval: schedule, clearInterval: cancel});
vm.runInContext(source.slice(0, at) + `window.test = {
  boot, setLabels, setFilters, filtersMissing, fetchModel,
  setup(map, group) {
    _map = map; _group = group; _lastDetail = detailNow();
    _data = {buildings: [{id:'authored',name:'Authored',labelOverride:true}],
      replacedBuildingIds:['authored'],replacedNames:['Authored']};
  },
  bootTimer() { _bootTimer = setInterval(() => {throw Error('stale boot');},150); }
};` + source.slice(at), scope);
const api = window.test;
api.setup(map, group);
assert.equal(await api.boot(), true);
assert.ok(writes > 0, 'filters and authored labels install while sources are still loading');
assert.equal(window.slopesApartments.readyToReveal(), true);
const initialWrites = writes;
tick(); assert.equal(writes, initialWrites, 'ordinary poll does not rewrite stable layers');
map.style = null;
const beforeReads = reads;
for (let i = 0; i < 3; i++) tick();
api.setLabels(true); api.setFilters(true);
assert.deepEqual(Array.from(api.filtersMissing()), []);
assert.equal(window.slopesApartments.readyToReveal(), false, 'no readiness claim without style');
assert.equal(reads, beforeReads, 'lost style must never reach getLayer');
map.style = {};
layers['buildings-3d'].filter = baseFilter;
layers['buildings-labels'].field = baseLabel;
tick();
assert.notDeepEqual(layers['buildings-3d'].filter, baseFilter, 'restoration repairs replacement filters');
assert.notDeepEqual(layers['buildings-labels'].field, baseLabel, 'restoration repairs labels');
// Switching off during the unavailable interval must restore fallback once it returns.
map.style = null;
window.SLOPES.on = false;
window.applySlopesApartments(map);
map.style = {};
tick();
assert.deepEqual(layers['buildings-3d'].filter, baseFilter);
assert.deepEqual(layers['buildings-labels'].field, baseLabel);
assert.equal(disposed, 1);
// Actual remove cancels every owned timer, including pending model deadlines.
api.setup(map, group); // an attached mesh must also be removed exactly once
api.bootTimer();
let finishDownload;
const download = api.fetchModel({fetchJSON: () => new Promise(resolve => {finishDownload = resolve;})}, 'unused.json');
const queuedTick = [...pending.values()].find(t => t.ms === 500 || t.ms === 1000).fn;
const beforeRemoveReads = reads, beforeRemoveRepaints = repaints;
events.get('remove')(); map.style = null;
assert.equal(pending.size, 0, 'remove clears poll, boot and download deadline timers');
queuedTick(); switches.forEach(fn => fn());
assert.equal(await api.boot(), true, 'removed map cannot restart boot');
assert.equal(reads, beforeRemoveReads);
assert.equal(repaints, beforeRemoveRepaints);
assert.equal(removed, 2);
assert.equal(disposed, 2);
finishDownload({ok: true}); await download;
assert.equal(pending.size, 0);
// A catalog request that resolves after removal must not spawn new deadlines.
let finishIndex, onRemove, requests = 0;
const loadingMap = {once(name, fn) { onRemove = fn; }};
const loadingWindow = {location};
const loadingScope = vm.createContext({window: loadingWindow, location, URLSearchParams, console,
  setTimeout: schedule, clearTimeout: cancel, setInterval: schedule, clearInterval: cancel});
vm.runInContext(source.slice(0, at) + 'window.test={watchMapRemoval,startFetch};' + source.slice(at), loadingScope);
loadingWindow.test.watchMapRemoval(loadingMap);
const fetching = loadingWindow.test.startFetch({fetchJSON() {
  requests++; return new Promise(resolve => {finishIndex = resolve;});
}});
onRemove();
finishIndex({buildings:['one.json'],collections:['bundle.json']});
await fetching;
assert.equal(requests, 1, 'late catalog must not start fresh requests after removal');
assert.equal(pending.size, 0, 'late catalog must not create fresh timeout callbacks');
console.log('PASS: no style access during recovery; repair and off-state fallback resume; remove cancels timers and stale callbacks; no style serialization');
