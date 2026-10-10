// A building whose recipe draws its OWN shop front (PLACES.ownFront in js/places.js; Raising Cane's) loses the generic
// shop front only while that recipe is really drawn. No browser: js/places.js runs in a vm with a stub map, and the
// stand-in for js/slopes-apartments.js (window.slopesApartments) is flipped between the cases.
//
//   node places-ownfront.mjs                      the check
//   node places-ownfront.mjs --break              puts the old rule back (hide whenever listed): must exit 1
//   node places-ownfront.mjs --source <file>      run it against another copy of places.js (e.g. `git show main:js/places.js`)
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const argv = process.argv.slice(2);
const srcArg = argv.indexOf('--source');
let code = fs.readFileSync(srcArg >= 0 ? argv[srcArg + 1] : new URL('../../js/places.js', import.meta.url), 'utf8');
if (argv.includes('--break')) {
  const head = 'function ownFrontDrawn() {';
  assert(code.includes(head), 'negative control targets ownFrontDrawn');
  code = code.replace(head, head + ' return new Set(PLACES.ownFront);');
}

const CANES = 'b32544f3-3221-480b-86bd-236b0eeb7be1', OTHER = 'aaaaaaaa-0000-4000-8000-000000000001';
const feature = (bid, fam, kind) => ({ type: 'Feature', properties: { bid, fam, kind, nm: 'x' }, geometry: { type: 'Polygon', coordinates: [] } });
const GEOJSON = { type: 'FeatureCollection', features: [
  feature(CANES, 'plBand'), feature(CANES, 'plGlass'), feature(CANES, 'plLabel', 'label'),
  feature(OTHER, 'plBand'), feature(OTHER, 'plGlass'), feature(OTHER, 'plLabel', 'label'),
] };

// Runs places.js fresh; returns the window, the stub map's log and a way to run the polling timers.
function load({ recipe }) {
  const timers = [];
  const win = { location: { search: '' }, slopesApartments: recipe, __todCurrentP: 0.3 };
  const ctx = vm.createContext({
    window: win, URLSearchParams, console: { log() {}, warn() {}, error() {} }, document: {},
    fetch: async () => ({ ok: true, json: async () => JSON.parse(JSON.stringify(GEOJSON)) }),
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {},
    Math, Set, Array, Object, JSON, Promise, Map, Number, String, Error, parseInt, parseFloat, isNaN,
  });
  vm.runInContext(code, ctx, { filename: 'places.js' });
  const sets = [];                       // every data push to the source: [{bid, kind}]
  let data = null;
  const map = {
    getSource: () => data ? { setData: d => { data = d; sets.push(d.features); } } : null,
    addSource: (id, o) => { data = o.data; sets.push(o.data.features); },
    addImage() {}, getLayer: () => null, addLayer() {}, once() {},
    getStyle: () => ({ layers: [{ id: 'buildings-3d', type: 'fill-extrusion' }] }),
  };
  return { win, map, sets, tick() { const due = timers.splice(0); for (const t of due) t.fn(); } };
}
const has = (features, bid, kind) => features.some(f => f.properties.bid === bid && (kind ? f.properties.kind === kind : f.properties.kind !== 'label'));
const drawn = id => ({ group: {}, built: [{ id }] });

async function run(name, fn) {
  try { await fn(); console.log('ok   ', name); return 0; } catch (e) { console.log('FAIL ', name, '-', e.message.split('\n')[0]); return 1; }
}
let bad = 0;

// the recipe never loaded: no slopesApartments at all (its script failed, ?slopes=0 leaves the layer unbuilt)
bad += await run('recipe not loaded: the generic Cane\'s shop front is drawn', async () => {
  const t = load({ recipe: undefined });
  await t.win.initPlaces(t.map);
  assert(has(t.sets[0], CANES), 'the Cane\'s shop front was removed although no recipe is drawn');
  assert(has(t.sets[0], CANES, 'label'), 'the name label must stay');
  assert(has(t.sets[0], OTHER), 'other shops are untouched');
});
// the recipe's data fetched but the mesh group is not in the scene (download failed, still building, switched off)
bad += await run('no mesh group in the scene: the generic shop front is drawn', async () => {
  const t = load({ recipe: { group: null, built: [] } });
  await t.win.initPlaces(t.map);
  assert(has(t.sets[0], CANES), 'the Cane\'s shop front was removed with no group built');
});
// built lists the building but the group was dropped afterwards (js/slopes-apartments.js does not clear `built` on a drop)
bad += await run('stale list after the group was dropped: the generic shop front is drawn', async () => {
  const t = load({ recipe: { group: null, built: [{ id: CANES }] } });
  await t.win.initPlaces(t.map);
  assert(has(t.sets[0], CANES), 'the Cane\'s shop front was removed on a stale list');
});
// another building drawn does not hide Cane's
bad += await run('a different recipe drawn: Cane\'s shop front stays', async () => {
  const t = load({ recipe: drawn(OTHER) });
  await t.win.initPlaces(t.map);
  assert(has(t.sets[0], CANES), 'the Cane\'s shop front was removed for another building\'s recipe');
});
// the recipe is drawn at load
bad += await run('recipe drawn at load: its generic shop front is gone, label and others stay', async () => {
  const t = load({ recipe: drawn(CANES) });
  await t.win.initPlaces(t.map);
  assert(!has(t.sets[0], CANES), 'the generic Cane\'s shop front is still drawn over the recipe');
  assert(has(t.sets[0], CANES, 'label'), 'the name label must stay');
  assert(has(t.sets[0], OTHER), 'other shops are untouched');
});
// the recipe lands after places: front drawn first, then removed; dropped later: front comes back
bad += await run('recipe lands late, then is dropped: the front follows it', async () => {
  const recipe = { group: null, built: [] };
  const t = load({ recipe });
  await t.win.initPlaces(t.map);
  assert(has(t.sets[0], CANES), 'front missing before the recipe is drawn');
  t.tick();
  assert.equal(t.sets.length, 1, 'no data push while nothing changed');
  recipe.group = {}; recipe.built = [{ id: CANES }];
  t.tick();
  assert.equal(t.sets.length, 2, 'one data push when the recipe lands');
  assert(!has(t.sets[1], CANES), 'front still drawn after the recipe landed');
  assert(has(t.sets[1], CANES, 'label'), 'label lost');
  recipe.group = null;                    // dropGroup(): built stays stale
  t.tick();
  assert.equal(t.sets.length, 3, 'one data push when the recipe is dropped');
  assert(has(t.sets[2], CANES), 'front not restored after the recipe was dropped');
});

console.log(bad ? bad + ' case(s) failed' : 'all cases pass');
process.exit(bad ? 1 : 0);
