/**
 * finder-core.mjs — the apartment finder's arithmetic, checked in node.
 *
 * No browser, no server. Two halves:
 *   A. HAND-COMPUTED CASES on a five-node graph built here, where every
 *      expected number is written out as the arithmetic a person would do
 *      (metres / speed + waits), never by calling the code under test.
 *   B. THE REAL DATA: js/finder-core.js's one-building trees against
 *      js/walkgraph.js's own pair router on real campus pairs, and the shipped
 *      tables in data/finder/ run through the scorer end to end.
 *
 * Usage: node scripts/verify/finder-core.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const core = await import(pathToFileURL(path.join(ROOT, 'js', 'finder-core.js')).href);
const wg = await import(pathToFileURL(path.join(ROOT, 'js', 'walkgraph.js')).href);
const readJSON = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };
const near = (a, b, tol, msg) => { assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, want ${b} ±${tol}`); pass++; };

const REAL = readJSON('data/walk_graph.json');
const TUNE = REAL.tune;

// ══════════════════════════════════════════════════════════════════════════
// A. HAND-COMPUTED CASES
// ══════════════════════════════════════════════════════════════════════════
//   n0 ──100 m── n1 ──100 m, signalled── n2 ──10 m of steps── n3 ··off-main·· n4
//   Home's door links to n0; BBB's door to n1; AAA's door to n3; CCC has no door.
const xs = [-97740000, -97739000, -97738000, -97737900, -97730000];
const raw = {
  q: 1e-6,
  n: { x: xs.map((x, i) => i ? x - xs[i - 1] : x), y: [30285000, 0, 0, 0, 0] },
  e: { a: [0, 1, 1, 1], b: [1, 1, 1, 1], w: [10000, 10000, 1000, 500], f: [0, 4, 1, 128], s: [-1, -1, 7, -1] },
  d: [
    [-97740020, 30285000, [0], [200], 'main', 'path', '', ''],
    [-97737880, 30285000, [3], [300], 'main', 'path', '', ''],
    [-97739000, 30285010, [1], [100], 'main', 'path', '', ''],
  ],
  code: { AAA: [1], BBB: [2], CCC: [] },
  wc: { Home: [0] },
  tune: TUNE,
};
const G = wg.decodeWalkGraph(raw); G.wc = raw.wc;
const T = TUNE;

// Home -> AAA: 100 m + 100 m flat (one signal), then 10 m of steps (one flight).
const aaaLo = 100 / T.WALK_SPEED_HIGH_MS + 100 / T.WALK_SPEED_HIGH_MS + T.SIGNAL_WAIT_LOW_S +
  10 / T.STAIR_SPEED_MPS + T.STAIR_FIXED_S;
const aaaHi = 100 / T.WALK_SPEED_LOW_MS + 100 / T.WALK_SPEED_LOW_MS + T.SIGNAL_WAIT_HIGH_S +
  10 * T.STAIR_UP_MULT / T.STAIR_SPEED_MPS + T.STAIR_FIXED_S;
// Home -> BBB: 100 m flat, no light.
const bbbLo = 100 / T.WALK_SPEED_HIGH_MS, bbbHi = 100 / T.WALK_SPEED_LOW_MS;
// Written out, so a changed tune shows up as a changed number here:
near(aaaLo, 166.857, 0.001, 'hand arithmetic, AAA fast end (s)');
near(aaaHi, 257.818, 0.001, 'hand arithmetic, AAA slow end (s)');

const home = { id: 'home', name: 'Home', wc: 'Home', p: [-97.74002, 30.285] };
const tA = core.buildingTree(G, 'AAA'), tB = core.buildingTree(G, 'BBB');
ok(tA && tB, 'trees exist for coded buildings');
ok(core.buildingTree(G, 'CCC') === null, 'a code with no door has no tree');
ok(tA.cost[4] === Infinity, 'the off-main island is never reached');
const hA = core.homeAnchors(G, home);
ok(hA.length === 1 && hA[0].node === 0 && hA[0].m === 0, 'a named home joins at its own door, link not timed');
const wA = core.walkFrom(G, tA, hA), wB = core.walkFrom(G, tB, hA);
near(wA.lo, aaaLo, 1e-3, 'Home->AAA fast end'); near(wA.hi, aaaHi, 1e-3, 'Home->AAA slow end');
near(wB.lo, bbbLo, 1e-3, 'Home->BBB fast end'); near(wB.hi, bbbHi, 1e-3, 'Home->BBB slow end');
const path0 = core.treePath(G, tA, hA[0]);
ok(path0.length === 6, 'path = home door, n0, n1, n2, n3, class door');
near(path0[path0.length - 1][0], -97.73788, 1e-9, 'path ends on the class door');

// A home with no mapped door snaps to the nearest node, and that link IS timed.
const snapM = 0.0003 * 111320;       // 0.0003 deg north of n1
const home2 = { id: 'h2', name: 'Snapped', p: [-97.739, 30.2853] };
const a2 = core.homeAnchors(G, home2);
ok(a2.length === 1 && a2[0].node === 1, 'snaps to n1');
near(a2[0].m, snapM, 0.05, 'snap distance');
const w2 = core.walkFrom(G, tA, a2);
near(w2.lo, 100 / T.WALK_SPEED_HIGH_MS + T.SIGNAL_WAIT_LOW_S + 10 / T.STAIR_SPEED_MPS + T.STAIR_FIXED_S +
  snapM / T.WALK_SPEED_HIGH_MS, 0.05, 'snapped home -> AAA fast end includes the walk out');
const home3 = { id: 'h3', name: 'Island', p: [-97.73, 30.285] };
ok(core.homeAnchors(G, home3).length === 0, 'a home only near the off-main island is not walkable');

// Targets: CCC is unroutable, so 0.6/0.2 renormalise to 0.75/0.25 and 20% is reported.
const routable = (c) => !!core.buildingTree(G, c);
const N = core.normaliseTargets([['AAA', 0.6], ['BBB', 0.2], ['ccc', 0.2]], routable);
near(N.targets[0].w, 0.75, 1e-12, 'AAA weight'); near(N.targets[1].w, 0.25, 1e-12, 'BBB weight');
near(N.droppedShare, 0.2, 1e-12, 'dropped share'); ok(N.dropped[0].code === 'CCC', 'dropped code named');

// Walk score = weighted range.
const legs = [
  { code: 'AAA', w: 0.75, walk: { lo: aaaLo / 60, hi: aaaHi / 60 }, bus: null },
  { code: 'BBB', w: 0.25, walk: { lo: bbbLo / 60, hi: bbbHi / 60 }, bus: null },
];
const sw = core.scoreHome(legs, 'walk');
near(sw.lo, (0.75 * 166.857 + 0.25 * 71.4286) / 60, 1e-4, 'walk score fast end (min)');
near(sw.hi, (0.75 * 257.818 + 0.25 * 90.9091) / 60, 1e-4, 'walk score slow end (min)');
ok(sw.how === 'walk', 'walk score is a walk');
ok(core.scoreHome(legs, 'bus') === null, 'no bus table = not ranked in bus mode');

// Bus: anchor X = 40 min (7.5 wait) + 1-2 min walk; Y = 30 min (5 wait) + 10-15 min walk.
// Midpoints 41.5 vs 42.5 -> X. lo = 40 - 7.5 + 1 = 33.5, hi = 40 + 7.5 + 2 = 49.5.
const bus = core.busTo({ X: { min: 40, wait: 7.5 }, Y: { min: 30, wait: 5 } },
  { X: { lo: 60, hi: 120 }, Y: { lo: 600, hi: 900 } });
ok(bus.via === 'X', 'bus picks the anchor with the smaller midpoint');
near(bus.lo, 33.5, 1e-9, 'bus fast end'); near(bus.hi, 49.5, 1e-9, 'bus slow end');
ok(core.busTo({ X: { min: 40, wait: 7.5 } }, { X: null }) === null, 'no walk from the stop = no bus answer');

// Either: per building, the smaller midpoint (walk 12 vs bus 14 -> walk; walk 30 vs bus 20 -> bus).
const se = core.scoreHome([
  { code: 'P', w: 0.5, walk: { lo: 10, hi: 14 }, bus: { lo: 8, hi: 20 } },
  { code: 'Q', w: 0.5, walk: { lo: 25, hi: 35 }, bus: { lo: 15, hi: 25 } },
], 'either');
ok(se.legs[0].how === 'walk' && se.legs[1].how === 'bus' && se.how === 'mixed', 'either picks per building');
near(se.lo, (10 + 15) / 2, 1e-12, 'either fast end'); near(se.hi, (14 + 25) / 2, 1e-12, 'either slow end');

// Schedule -> meetings per week per building, reading nothing but code and days.
const sched = { events: [
  { code: 'GDC', days: ['MO', 'WE', 'FR'], status: 'ok', title: 'PRIVATE TITLE', room: '2.216' },
  { code: 'wel', days: ['TU', 'TH'], status: 'ok' },
  { code: 'GDC', days: ['TU'], status: 'ok' },
  { code: 'XYZ', days: ['MO'], status: 'failed' },
] };
const st = core.scheduleTargets(sched);
assert.deepEqual(st, [['GDC', 4], ['WEL', 2]]); pass++;
ok(!JSON.stringify(st).includes('PRIVATE') && !JSON.stringify(st).includes('2.216'), 'no title or room survives');
assert.deepEqual(core.scheduleTargets({ classes: [{ code: 'MEZ', days: ['MO'] }, { code: 'BAD', unroutableWhy: 'x', days: ['MO'] }] }),
  [['MEZ', 1]]); pass++;
assert.deepEqual(core.scheduleTargets(null), []); pass++;

// Ranking: midpoint, then name. Unscored apart.
const R = core.rankHomes([
  { home: { name: 'B' }, score: { mid: 5 } }, { home: { name: 'A' }, score: { mid: 5 } },
  { home: { name: 'C' }, score: { mid: 3 } }, { home: { name: 'D' }, score: null },
]);
assert.deepEqual(R.ranked.map(r => r.home.name + r.rank), ['C1', 'A2', 'B3']); pass++;
ok(R.unranked.length === 1 && R.unranked[0].home.name === 'D', 'unscored homes kept apart');

// Heat helpers.
ok(core.rampColour([[0, '#000000'], [10, '#ffffff']], 5) === '#808080', 'ramp midpoint');
ok(core.rampColour([[0, '#000000'], [10, '#ffffff']], 99) === '#ffffff', 'ramp clamps high');
near(core.busMidAt([0, 0, 40, 7.5, null, null], ['X', 'Y'], [{ w: 1 }], [{ X: 2, Y: 1 }]), 42, 1e-12, 'bus cell');
near(core.walkMidAt([tA, tB], [{ w: 0.5 }, { w: 0.5 }], 0), 0.5 * (aaaLo + aaaHi) / 120 + 0.5 * (bbbLo + bbbHi) / 120,
  1e-3, 'walk cell at n0');
ok(core.walkMidAt([tA], [{ w: 1 }], 4) === null, 'no heat on the island');
console.log(`PASS A  hand-computed cases (${pass} checks)`);

// ══════════════════════════════════════════════════════════════════════════
// B. THE REAL DATA
// ══════════════════════════════════════════════════════════════════════════
const t0 = performance.now();
const RG = wg.decodeWalkGraph(REAL); RG.wc = REAL.wc;
const decodeMs = performance.now() - t0;
const codeAnchors = (G, c) => G.code[c].flatMap(di => {
  const d = G.doors[di];
  return d[2].map((n, k) => ({ node: n, c: d[3][k] / 100 * wg.WALKG.linkCostMult, m: 0 }));
});
const pairs = [['WEL', 'GDC'], ['MEZ', 'WEL'], ['PCL', 'GDC'], ['JES', 'UTC'], ['RLP', 'GSB'], ['BUR', 'PAR'], ['MAI', 'ECJ']];
const rows = [];
for (const [a, b] of pairs) {
  const ref = wg.routeBetween(RG, a, b);
  const mine = core.walkFrom(RG, core.buildingTree(RG, b), codeAnchors(RG, a));
  ok(ref && mine, `${a}->${b} routes in both`);
  const lo = Math.floor(mine.lo / 60), hi = Math.ceil(mine.hi / 60);
  rows.push(`${a}->${b} walkgraph ${ref.lo}-${ref.hi}  finder ${lo}-${hi}`);
  ok(Math.abs(lo - ref.lo) <= 1 && Math.abs(hi - ref.hi) <= 1, `${a}->${b}: finder ${lo}-${hi} vs walkgraph ${ref.lo}-${ref.hi}`);
}
console.log('    ' + rows.join('\n    '));

const homes = readJSON('data/finder/homes.json').homes;
const majors = readJSON('data/finder/major-buildings.json').majors;
const transit = readJSON('data/finder/transit.json');
ok(!!core.buildingTree(RG, 'MAI'), 'the default target (MAI) is routable');
for (const m of majors) {
  const n = core.normaliseTargets(m.b, (c) => !!core.buildingTree(RG, c));
  ok(n.droppedShare === 0, `${m.id}: every building routable (dropped ${n.dropped.map(d => d.code)})`);
}
for (const h of homes) {
  const an = core.homeAnchors(RG, h);
  if (h.bus) ok(an.length === 0 && transit.homes[h.id] && Object.keys(transit.homes[h.id]).length === 4,
    `${h.id}: a bus home has no walk and a transit row to every anchor`);
  else ok(an.length > 0, `${h.id}: walkable home joins the graph`);
}

// End to end, Computer Science, every mode — the same composition js/finder.js does.
function rankFor(major, mode) {
  const N = core.normaliseTargets(major.b, (c) => !!core.buildingTree(RG, c));
  const trees = N.targets.map(t => core.buildingTree(RG, t.code));
  const stopA = Object.fromEntries(transit.anchors.map(a => {
    const s = transit.stops[a.stop], n = core.nearestNode(RG, [s[0], s[1]]);
    return [a.id, n ? [{ node: n.node, c: n.m, m: n.m }] : []];
  }));
  const fromStop = N.targets.map((t, i) => Object.fromEntries(transit.anchors.map(a => [a.id, core.walkFrom(RG, trees[i], stopA[a.id])])));
  const toMin = (s) => s && { lo: s.lo / 60, hi: s.hi / 60 };
  const items = homes.map(h => {
    const an = core.homeAnchors(RG, h), row = transit.homes[h.id];
    const legs = N.targets.map((t, i) => ({ code: t.code, w: t.w, walk: an.length ? toMin(core.walkFrom(RG, trees[i], an)) : null,
      bus: row ? core.busTo(row, fromStop[i]) : null }));
    return { home: h, score: core.scoreHome(legs, mode) };
  });
  return { ...core.rankHomes(items), stopA, trees, N };
}
const cs = majors.find(m => m.id === 'computer-science');
const t1 = performance.now();
const either = rankFor(cs, 'either');
const rankMs = performance.now() - t1;
const walk = rankFor(cs, 'walk'), busR = rankFor(cs, 'bus');
ok(Object.values(either.stopA).every(a => a.length === 1), 'every campus anchor stop is on the walking graph');
ok(either.ranked.length === homes.length, 'either: every home ranked');
ok(walk.unranked.length === homes.filter(h => h.bus).length && walk.unranked.every(u => u.home.bus), 'walk: only the bus homes drop out');
ok(busR.ranked.length === homes.filter(h => h.bus).length, 'bus: only the bus homes rank');
const lastWalk = Math.max(...either.ranked.filter(r => !r.home.bus).map(r => r.rank));
const firstBus = Math.min(...either.ranked.filter(r => r.home.bus).map(r => r.rank));
ok(firstBus > lastWalk, 'CS: every walkable home ranks above East Riverside');
for (const r of either.ranked) {
  ok(r.score.lo > 0 && r.score.hi >= r.score.lo, `${r.home.id}: a real range`);
  if (r.home.bus) ok(r.score.mid > 30 && r.score.mid < 80, `${r.home.id}: bus commute ${r.score.mid.toFixed(1)} min is plausible`);
  else ok(r.score.mid > 2 && r.score.mid < 30, `${r.home.id}: walk commute ${r.score.mid.toFixed(1)} min is plausible`);
}
// Heat: the walking cells cover campus, and the bus grid gives Riverside colour.
const cells = core.walkCells(RG, 90);
const heatWalk = cells.map(c => core.walkMidAt(either.trees, either.N.targets, c.node)).filter(v => v != null);
const wm = either.N.targets.map((t, i) => Object.fromEntries(transit.anchors.map(a => {
  const w = core.walkFrom(RG, either.trees[i], either.stopA[a.id]); return [a.id, w ? (w.lo + w.hi) / 120 : null];
})));
const heatBus = transit.grid.cells.map(c => core.busMidAt(c, transit.anchors.map(a => a.id), either.N.targets, wm)).filter(v => v != null);
ok(heatWalk.length > 300, `walking heat has ${heatWalk.length} cells`);
ok(heatBus.length > 100, `bus heat has ${heatBus.length} cells`);
console.log(`    CS either top 5: ${either.ranked.slice(0, 5).map(r => `${r.rank}. ${r.home.name} ${r.score.lo.toFixed(1)}-${r.score.hi.toFixed(1)}`).join(' | ')}`);
console.log(`    CS either Riverside: ${either.ranked.filter(r => r.home.bus).map(r => `${r.rank}. ${r.home.name} ${r.score.lo.toFixed(1)}-${r.score.hi.toFixed(1)}`).join(' | ')}`);
console.log(`    decode ${decodeMs.toFixed(0)} ms; rank 49 homes x ${either.N.targets.length} buildings incl. trees ${rankMs.toFixed(0)} ms; heat ${heatWalk.length}+${heatBus.length} cells`);
console.log(`PASS B  real data (${pass} checks total)`);
