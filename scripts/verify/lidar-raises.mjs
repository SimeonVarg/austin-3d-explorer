/**
 * lidar-raises.mjs - the laser scan's raises: the knob, the function and the list.
 * No browser.
 *
 * The app raises about a hundred buildings on every load from
 * data/lidar_raises.json (scripts/bake_lidar_raises.py). This check holds three
 * things that must not drift:
 *   1. the knob: default 'raise', `?lidarheights=0` off, `?lidarheights=all` all;
 *   2. applyLidarRaises only ever RAISES, and leaves alone a hand-set height, a
 *      building the snapshot already has taller, and an absurd difference;
 *   3. the list on disk obeys the bake's rule against the whole measurement
 *      (data/lidar_heights.json): plain prisms only, nothing from the review
 *      list, no distrusted or `small` reading, never above the scan's own p90,
 *      and at least `min_top_share` of the roof reaches the height.
 * The list's validator is proved first on three poisoned copies: a validator
 * that cannot fail proves nothing.
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);
const text = p => fs.readFileSync(new URL(p, root), 'utf8');
const read = p => JSON.parse(text(p));
const app = text('js/app.js');
let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; console.log('ok   ' + msg); };

// 1. The knob.
const k0 = app.indexOf('  const LIDAR_HEIGHTS = {');
const k1 = app.indexOf('  window.LIDAR_HEIGHTS = LIDAR_HEIGHTS;', k0);
assert.ok(k0 >= 0 && k1 > k0, 'the LIDAR_HEIGHTS block was not found in js/app.js');
const knob = search => vm.runInNewContext(app.slice(k0, k1) + '\nLIDAR_HEIGHTS', { location: { search } });
ok(knob('').mode === 'raise', "no flag: mode 'raise'");
ok(knob('?lidarheights=0').mode === 'off', "?lidarheights=0: mode 'off'");
ok(knob('?intro=0&lidarheights=0&drift=0').mode === 'off', 'the flag is found among other flags');
ok(knob('?lidarheights=all').mode === 'all', "?lidarheights=all: mode 'all'");

// 2. The function.
const f0 = app.indexOf('  function applyLidarRaises(buildings, raises) {');
const f1 = app.indexOf('  // The small lowerings', f0);
assert.ok(f0 >= 0 && f1 > f0, 'applyLidarRaises was not found in js/app.js');
const K = knob('');
const feat = (id, final_height, source_height = 'overture') => ({ properties: { id, final_height, source_height } });
const scene = { features: [
  feat('low', 7.3), feat('taller-already', 80), feat('hero', 10, 'hero_override'),
  feat('absurd', 5), feat('noise', 20), feat('not-listed', 9), { properties: { id: 'no-height' } },
] };
const table = { buildings: { low: 63.1, 'taller-already': 60, hero: 50, absurd: 5 + K.maxAbsDiff + 1, noise: 20 + K.minAbsDiff / 2, 'no-height': 30 } };
const changed = vm.runInNewContext(app.slice(f0, f1) + '\napplyLidarRaises(buildings, raises)',
  { LIDAR_HEIGHTS: K, buildings: scene, raises: table });
const P = Object.fromEntries(scene.features.map(f => [f.properties.id, f.properties]));
ok(changed === 1, 'one of the seven test buildings is raised (got ' + changed + ')');
ok(P.low.final_height === 63.1 && P.low.final_height_prior === 7.3 && P.low.source_height === 'lidar_2021', 'the low building takes the scan height and keeps its old one');
ok(P['taller-already'].final_height === 80, 'a building the snapshot already has taller is NOT lowered');
ok(P.hero.final_height === 10, 'a hand-set (hero) height is left alone');
ok(P.absurd.final_height === 5, 'a difference over maxAbsDiff is refused');
ok(P.noise.final_height === 20, 'a difference under minAbsDiff is ignored');
ok(P['not-listed'].final_height === 9 && P['no-height'].final_height === undefined, 'a building off the list, or with no height, is untouched');
const off = vm.runInNewContext(app.slice(f0, f1) + '\napplyLidarRaises(buildings, null)', { LIDAR_HEIGHTS: K, buildings: { features: [feat('low', 7.3)] } });
ok(off === 0, 'a missing list raises nothing and does not throw');

// 3. The list against the whole measurement.
const DISTRUST = ['sparse', 'low_class6', 'few_cells', 'off_raster', 'small'];
function problems(list, full) {
  const out = [];
  const share = list.min_top_share;
  for (const [id, t] of Object.entries(list.buildings)) {
    const m = full.buildings[id];
    if (!m) { out.push(id + ': not in the measurement'); continue; }
    if (m.x) out.push(id + ': drawn another way (x)');
    if (m.rv) out.push(id + ': in the review list (rv)');
    if (String(m.q || '').split(',').some(q => DISTRUST.includes(q))) out.push(id + ': distrusted reading (' + m.q + ')');
    if (typeof t !== 'number' || !(t <= m.h + 0.05)) out.push(id + ': ' + t + ' is above the scan p90 ' + m.h);
    if (!(t - m.d >= 0.5)) out.push(id + ': ' + t + ' does not raise the drawn ' + m.d);
    const steps = m.steps || [];
    const reach = steps.filter(s => s[0] >= t - 0.05).reduce((a, s) => a + s[1], 0);
    if (steps.length > 1 && steps[0][1] < share && reach < share - 0.001) out.push(id + ': only ' + reach.toFixed(2) + ' of the roof reaches ' + t);
  }
  return out;
}
const list = read('data/lidar_raises.json');
const full = read('data/lidar_heights.json');
const poison = (id, patch) => ({ ...full, buildings: { ...full.buildings, [id]: { ...full.buildings[id], ...patch } } });
const anyId = Object.keys(list.buildings)[0];
ok(problems(list, poison(anyId, { x: 1 })).length === 1, 'the validator catches a building drawn another way');
ok(problems(list, poison(anyId, { rv: 'unclear' })).length === 1, 'the validator catches a review-list building');
ok(problems({ ...list, buildings: { ...list.buildings, [anyId]: full.buildings[anyId].h + 5 } }, full).length >= 1, 'the validator catches a height above the scan');
const stepped = Object.keys(list.buildings).find(id => (full.buildings[id].steps || []).length > 1 && full.buildings[id].steps[0][1] < list.min_top_share);
ok(!!stepped && problems({ ...list, buildings: { [stepped]: full.buildings[stepped].h } }, full).length === 1,
  'the validator catches a podium tower raised to its tower height');
const found = problems(list, full);
ok(found.length === 0, 'every raise on disk obeys the rule' + (found.length ? ': ' + found.slice(0, 5).join('; ') : ''));
const n = Object.keys(list.buildings).length;
ok(n >= 40 && n <= 300, 'the list is a short list (' + n + ' buildings)');
const bytes = fs.statSync(new URL('data/lidar_raises.json', root)).size;
ok(bytes < 20000, 'the list is small enough to load on every visit (' + bytes + ' bytes)');
ok(list._snapshot === full._snapshot, 'the list was cut from the measurement on disk (snapshot ' + list._snapshot + ')');

console.log(`PASS ${passed} checks: lidar raises (knob, function, ${n} buildings on the list)`);
