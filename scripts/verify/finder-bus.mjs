/**
 * finder-bus.mjs — the bus in the apartment finder's ranking and on its map (js/finder-bus.js), checked in node.
 *
 * No browser, no network. Three parts:
 *   A. HAND-COMPUTED CASES on a two-route slice built here (the same geometry as transit-route.mjs, latitude 30): the
 *      margin a bus must win by, the walk-too-short prune, the caller's walking-graph answers, the cache, and the trip as
 *      map features (every coordinate written out).
 *   B. THE REAL DATA: all 42 majors x the 45 walkable homes x their buildings, against the real walking graph and the real
 *      baked slice. Every bus trip the ranking offers beats the walk by the margin; the pruning (a short walk is never
 *      searched, no change of bus) gives the SAME trips as searching everything; the shipped data really does give some homes
 *      a bus; the East Riverside homes keep their baked table; the scorer only ever picks a bus that is faster.
 *   C. TIME: the ranking before (walking only) and after (walking + the timetable bus), cold graph and cold bus index,
 *      minimum of 3 repeats, under BUS.budgetMs for the biggest schedule. Quoted with its settings, because an instrument's
 *      defaults are part of its answer (CLAUDE.md rule 10).
 *
 * Usage: node scripts/verify/finder-bus.mjs [--break | --break=prune]
 *   --break          the bus search ignores the margin (every bus that is even slightly faster is offered): must fail
 *   --break=prune    the prune is switched off by a typo (skipWalkMin = 99, which prunes everything): the "same trips" check must fail
 * VERIFY_ROOT=<dir> runs the same file against another checkout (used to show it fails on a tree without the feature).
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = process.env.VERIFY_ROOT ? path.resolve(process.env.VERIFY_ROOT) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const FB = await imp('js/finder-bus.js');
const TR = await imp('js/transit-route.js');
const core = await imp('js/finder-core.js');
const wg = await imp('js/walkgraph.js');
const readJSON = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const BREAK = process.argv.find((a) => a.startsWith('--break'));
const DEFAULTS = { skipWalkMin: FB.BUS.skipWalkMin, transfers: FB.BUS.transfers, beatsWalkS: FB.BUS.beatsWalkS };
if (BREAK === '--break') FB.BUS.beatsWalkS = -1e9;
if (BREAK === '--break=prune') FB.BUS.skipWalkMin = 99;

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };
const near = (a, b, tol, msg) => { assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, want ${b} ±${tol}`); pass++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); pass++; };

// ══════════════════════════════════════════════════════════════════════════
// A. HAND-COMPUTED CASES
// ══════════════════════════════════════════════════════════════════════════
// R1, direction 0:  A --700 m--> B --800 m--> C     minutes from A: 0, 4, 10     a bus every 10 min, 06:00-22:00   colour #111111
// R2, direction 0:  D ---------2000 m-------> E     minutes from D: 0, 6         a bus every 20 min, 06:00-22:00   colour #222222
// D stands 100 m north of C. One degree of latitude is 111320 m; at latitude 30 one degree of longitude is 111320 x cos(30).
const LAT = 30, MY = 111320, MX = 111320 * Math.cos(30 * Math.PI / 180);
const at = (eastM, northM) => [LAT + northM / MY, eastM / MX];              // [lat, lon]
const ll = (eastM, northM) => { const p = at(eastM, northM); return [p[1], p[0]]; };   // [lon, lat], as the map wants it
const stop = (name, eastM, northM) => { const p = at(eastM, northM); return [name, p[0], p[1]]; };
const svc = (h) => ({ first: '06:00', last: '22:00', headway: [[6, h]] });
const slice = () => ({
  version: 1,
  stops: { A: stop('A', 0, 0), B: stop('B', 700, 0), C: stop('C', 1500, 0), D: stop('D', 1500, 100), E: stop('E', 3500, 100) },
  routes: {
    R1: { short: '1', name: 'One', color: '#111111', dirs: [{ dir: 0, headsign: 'East', stops: ['A', 'B', 'C'], runMin: [0, 4, 10],
          shape: [[0, LAT], [700 / MX, LAT], [1500 / MX, LAT]], ...svc(10) }] },
    R2: { short: '2', name: 'Two', color: '#222222', dirs: [{ dir: 0, headsign: 'Far east', stops: ['D', 'E'], runMin: [0, 6],
          shape: [[1500 / MX, LAT + 100 / MY], [3500 / MX, LAT + 100 / MY]], ...svc(20) }] },
  },
});
const HOME = at(0, 200), DEST = at(1500, -150);

// 1. The trip of transit-route.mjs section 1, in minutes: 925.000 s .. 1613.637 s, midpoint 1269.3185 s. The caller's walk the
//    whole way is 1500 .. 2400 s (midpoint 1950 s), so the bus is 680.7 s faster: more than the 180 s margin.
{
  const leg = FB.busLeg(slice(), HOME, DEST, { walkAll: [1500, 2400] });
  ok(leg && leg.src === 'timetable', 'a bus 11 minutes faster than the walk is offered, marked as the timetable');
  near(leg.lo, 925.000 / 60, 1e-4, 'lo, minutes'); near(leg.hi, 1613.637 / 60, 1e-4, 'hi, minutes'); near(leg.mid, 1269.3185 / 60, 1e-4, 'mid, minutes');
  ok(leg.option && leg.option.legs.map((l) => l.kind).join() === 'walk,wait,bus,walk', 'transit-route\'s whole answer travels with it: walk, wait, bus, walk');
  ok(leg.hi > leg.lo, 'a range, not one number');
  ok(leg.option.legs[1].live === false && !leg.option.live, 'by the timetable: not live');
}
// 2. The margin. Walk 1200 .. 1350 s (mid 1275): the bus is 5.7 s faster, which is not a bus. A walk of 1900 .. 2000 s (mid 1950): 680 s.
{
  ok(FB.busLeg(slice(), HOME, DEST, { walkAll: [1200, 1350] }) === null, 'a bus 6 seconds faster than the walk is not offered');
  ok(FB.busLeg(slice(), HOME, DEST, { walkAll: [1900, 2000] }) !== null, 'one 680 seconds faster is');
  const was = FB.BUS.beatsWalkS;
  FB.BUS.beatsWalkS = 700;                                                 // the margin is a named value: 700 > 680.7
  const strict = FB.busLeg(slice(), HOME, DEST, { walkAll: [1500, 2400] });
  FB.BUS.beatsWalkS = 600;                                                 // 600 < 680.7
  const loose = FB.busLeg(slice(), HOME, DEST, { walkAll: [1500, 2400] });
  FB.BUS.beatsWalkS = was;
  ok(strict === null && loose !== null, 'BUS.beatsWalkS = 700 withholds the 680 s gain, 600 offers it');
}
// 3. A walk this short is never searched for a bus: the slice is not even read. (walk 300 .. 420 s: midpoint 6 min < 12.)
{
  let reads = 0;
  const watched = new Proxy(slice(), { get(t, k) { reads++; return t[k]; } });
  ok(FB.busLeg(watched, HOME, DEST, { walkAll: [300, 420] }) === null && reads === 0, 'a 6 minute walk: no bus, and no search (the slice was not read)');
  FB.busLeg(watched, HOME, DEST, { walkAll: [1500, 2400] });
  ok(reads > 0, 'a 25 minute walk is searched');
  ok(FB.busLeg(slice(), HOME, DEST, {}) !== null, 'no walking answer from the caller: the straight-line model stands in (walk 1430 .. 1820 s) and the bus still wins by 356 s');
}
// 4. The caller's walking-graph answer for the last stretch replaces the straight-line model: stop C -> the door is 60 .. 90 s.
//    lo 185.714 + 0 + 600 + 60 = 845.714      hi 236.364 + 600 + 600 + 90 = 1526.364
{
  const asked = [];
  const leg = FB.busLeg(slice(), HOME, DEST, { walkAll: [1500, 2400], endWalk: (p) => { asked.push(p); return [60, 90]; } });
  near(leg.lo, 845.714 / 60, 1e-4, 'endWalk lo'); near(leg.hi, 1526.364 / 60, 1e-4, 'endWalk hi');
  ok(asked.length > 0 && asked.every((p) => Math.abs(p[0] - at(1500, 0)[0]) < 1e-9 && Math.abs(p[1] - at(1500, 0)[1]) < 1e-9), 'it was asked for stop C only, as [lat, lon]: ' + JSON.stringify(asked[0]));
  const none = FB.busLeg(slice(), HOME, DEST, { walkAll: [1500, 2400], endWalk: () => null });
  near(none.lo, 925.000 / 60, 1e-4, 'endWalk returning null falls back to the straight-line model');
}
// 4b. The walk from the home to the first stop comes from the walking graph too: home -> A is 60 .. 90 s (not 185.7 .. 236.4).
//    lo 60 + 0 + 600 + 139.286 = 799.286      hi 90 + 600 + 600 + 177.273 = 1467.273
//    with the end walk 60 .. 90 as well:  lo 60 + 600 + 60 = 720      hi 90 + 600 + 600 + 90 = 1380
{
  const asked = [];
  const only = FB.busLeg(slice(), HOME, DEST, { walkAll: [1500, 2400], startWalk: (p) => { asked.push(p); return p[1] === at(0, 0)[1] ? [60, 90] : null; } });
  near(only.lo, 799.286 / 60, 1e-4, 'startWalk lo'); near(only.hi, 1467.273 / 60, 1e-4, 'startWalk hi');
  ok(asked.length > 0 && asked.every((p) => ['A', 'B'].some((id) => Math.abs(p[0] - slice().stops[id][1]) < 1e-9 && Math.abs(p[1] - slice().stops[id][2]) < 1e-9)), 'it was asked for stops only, as [lat, lon]: ' + asked.length + ' asks');
  const both = FB.busLeg(slice(), HOME, DEST, { walkAll: [1500, 2400], startWalk: (p) => (p[1] === at(0, 0)[1] ? [60, 90] : null), endWalk: () => [60, 90] });
  near(both.lo, 720 / 60, 1e-4, 'both walks from the graph: lo'); near(both.hi, 1380 / 60, 1e-4, 'both walks from the graph: hi');
  near(FB.busLeg(slice(), HOME, DEST, { walkAll: [1500, 2400], startWalk: () => null }).lo, 925.000 / 60, 1e-4, 'startWalk returning null falls back to the straight-line model');
  const wholeWalk = [];
  FB.busLeg(slice(), HOME, DEST, { walkAll: [1500, 2400], startWalk: (p) => { wholeWalk.push(p); return null; }, endWalk: (p) => { wholeWalk.push('end'); return null; } });
  ok(wholeWalk.includes('end') && wholeWalk.length > 1, 'startWalk and endWalk are separate questions');
}
// 5. Every home x every building, with a cache and a tally. h2 is skipped (its own baked table), building Y has no door.
{
  const homes = [{ id: 'h1', from: HOME }, { id: 'h2', from: HOME }, { id: 'h3', from: HOME }];
  const targets = [{ code: 'X', to: DEST }, { code: 'Y', to: null }];
  const homesAsked = new Set();
  const cb = { skip: (i) => i === 1, walkAll: () => [1500, 2400], endWalk: () => null, startWalk: (hi) => { homesAsked.add(hi); return null; } };
  let clock = 0;
  const cache = new Map();
  const r1 = FB.busLegs(slice(), homes, targets, cb, cache, () => (clock += 5));
  ok(r1.legs.length === 3 && r1.legs[0][0] && r1.legs[2][0], 'h1 and h3 get a bus to X');
  ok(r1.legs[0][1] === null && r1.legs[1][0] === null && r1.legs[1][1] === null, 'no door: null; skipped home: null');
  eq([r1.searches, r1.cached, r1.ms], [2, 0, 5], 'two searches, nothing cached, the injected clock\'s 5 ms');
  eq([...homesAsked].sort(), [0, 2], 'startWalk is asked with the home\'s own index, and never for a skipped home');
  const s = slice();
  const r2 = FB.busLegs(s, homes, targets, cb, cache, () => (clock += 5));
  eq([r2.searches, r2.cached], [0, 2], 'the same question again: no search, two answers from the cache');
  ok(r2.legs[0][0] === r1.legs[0][0], 'the cached answer is the same object');
  const r3 = FB.busLegs(s, homes, [{ code: 'X', to: at(1500, -160) }], cb, cache, () => (clock += 5));
  eq([r3.searches, r3.cached], [2, 0], 'a different door for the same code is a different question');
  const r4 = FB.busLegs(s, homes, targets, cb, null, () => (clock += 5));
  eq([r4.searches, r4.cached], [2, 0], 'no cache: always searches');
}
// 6. The trip as map features. Home 200 m north of A; bus A -> C along the real line; the door 150 m south of C.
{
  const s = slice(), leg = FB.busLeg(s, HOME, DEST, { walkAll: [1500, 2400] });
  const f = FB.tripFeatures(s, leg.option, HOME, DEST);
  eq(f.feats.map((x) => x.properties.k), ['link', 'bus', 'link', 'stop', 'stop'], 'link, bus, link, then the two stops');
  eq(f.feats[0].geometry.coordinates, [ll(0, 200), ll(0, 0)], 'the walk to the stop: home -> A');
  eq(f.feats[1].geometry.coordinates, [ll(0, 0), ll(0, 0), [700 / MX, LAT], [1500 / MX, LAT], ll(1500, 0)], 'the bus: A, then the route\'s own line, then C');
  eq(f.feats[1].properties, { k: 'bus', c: '#111111', r: '1' }, 'the bus leg carries the route\'s colour and its short name');
  eq(f.feats[2].geometry.coordinates, [ll(1500, 0), ll(1500, -150)], 'the walk from the stop: C -> the door');
  eq(f.stops.map((x) => [x.role, x.route, x.name, x.c]), [['board', '1', 'A', '#111111'], ['alight', '1', 'C', '#111111']], 'board A, get off C');
  eq(f.stops.map((x) => x.p), [ll(0, 0), ll(1500, 0)], 'the stops sit at the stops');
  eq(f.feats[3].properties, { k: 'stop', role: 'board', c: '#111111', r: '1' }, 'a stop feature knows its role');
  ok(f.pts.length === 11, 'every coordinate is listed for fitting a camera: 2 + 5 + 2 + 2 = ' + f.pts.length);
  // the last walk along the walking graph's own path, as finder.js passes it: [stop, node, node, door]
  const seen = [];
  const g = FB.tripFeatures(s, leg.option, HOME, DEST, { endPath: (p) => { seen.push(p); return [ll(1500, 0), [1500 / MX, LAT - 40 / MY], [1500 / MX + 1e-4, LAT - 40 / MY], ll(1500, -150)]; } });
  eq(g.feats.map((x) => x.properties.k), ['link', 'bus', 'link', 'walk', 'link', 'stop', 'stop'], 'with a mapped path: link, walk along it, link');
  eq(seen, [ll(1500, 0)], 'endPath was asked from the alight stop, as [lon, lat]');
  eq(g.feats[3].geometry.coordinates, [[1500 / MX, LAT - 40 / MY], [1500 / MX + 1e-4, LAT - 40 / MY]], 'the walk is the middle of the path');
  const sa = [];
  const sp = FB.tripFeatures(s, leg.option, HOME, DEST, { startPath: (p) => { sa.push(p); return [ll(0, 200), [10 / MX, LAT + 150 / MY], [10 / MX, LAT + 20 / MY], ll(0, 0)]; } });
  eq(sp.feats.map((x) => x.properties.k), ['link', 'walk', 'link', 'bus', 'link', 'stop', 'stop'], 'with a mapped start path: link, walk along it, link, then the bus');
  eq(sa, [ll(0, 0)], 'startPath was asked for the first stop, as [lon, lat]');
  eq(sp.feats[1].geometry.coordinates, [[10 / MX, LAT + 150 / MY], [10 / MX, LAT + 20 / MY]], 'the start walk is the middle of the path');
  eq(FB.tripFeatures(s, leg.option, HOME, DEST, { startPath: () => null }).feats.map((x) => x.properties.k), ['link', 'bus', 'link', 'stop', 'stop'], 'no path: the straight link');
  const bad = FB.tripFeatures(s, leg.option, HOME, DEST, { endPath: () => [ll(1500, 0)] });
  eq(bad.feats.map((x) => x.properties.k), ['link', 'bus', 'link', 'stop', 'stop'], 'a path too short to use: the straight link instead');
  // nothing to draw is nothing, never a throw
  for (const [name, o] of [['null option', null], ['no legs', {}], ['walk only', { legs: [{ kind: 'walk' }] }]]) {
    const e = FB.tripFeatures(s, o, HOME, DEST);
    ok(e.feats.length === 0 && e.stops.length === 0 && e.pts.length === 0, `tripFeatures(${name}): empty`);
  }
  ok(FB.tripFeatures(null, leg.option, HOME, DEST).feats.length === 0, 'no slice: empty');
  const lost = JSON.parse(JSON.stringify(leg.option)); lost.legs[2].board = 'ZZ';
  ok(FB.tripFeatures(s, lost, HOME, DEST).feats.filter((x) => x.properties.k === 'bus').length === 0, 'a stop that is not in the slice: that bus leg is skipped, no throw');
  eq(FB.tripRoutes(leg.option), ['1'], 'tripRoutes: the one route'); eq(FB.tripRoutes(null), [], 'tripRoutes(null)');
}
// 7. A trip with a change: R1 to C, walk to D, R2 to E.
{
  const s = slice();
  const r = TR.plan(s, HOME, at(3500, 200), { when: { day: 3, minute: 510 }, transfers: 1 });
  const o = r.options[0];
  ok(o && o.transfers === 1, 'the slice has a trip with one change');
  const f = FB.tripFeatures(s, o, HOME, at(3500, 200));
  eq(f.feats.map((x) => x.properties.k), ['link', 'bus', 'link', 'bus', 'link', 'stop', 'stop', 'stop'], 'walk, bus, change walk, bus, walk, three stops');
  eq(f.feats[1].properties.c, '#111111', 'first bus in route 1\'s colour'); eq(f.feats[3].properties.c, '#222222', 'second bus in route 2\'s colour');
  eq(f.feats[2].geometry.coordinates, [ll(1500, 0), ll(1500, 100)], 'the change: C -> D');
  eq(f.stops.map((x) => [x.role, x.route, x.name]), [['board', '1', 'A'], ['change', '2', 'D'], ['alight', '2', 'E']], 'board A, change to 2 at D, get off E');
  eq(FB.tripRoutes(o), ['1', '2'], 'both routes'); eq(FB.tripSig(o), 'R1/0:A>C|R2/0:D>E', 'the signature names the legs, not the minutes');
  const live = JSON.parse(JSON.stringify(o)); live.legs[1].inMin = 7; live.lo += 60;
  eq(FB.tripSig(live), FB.tripSig(o), 'the signature does not change when only the minutes do (no redraw)');
  eq(FB.busLeg(s, HOME, at(3500, 200), { walkAll: [4000, 5000] }), null, 'ranking is direct only: BUS.transfers = 0 finds nothing here');
}

// 8. Which buildings get a route: the top few, and the heaviest bus building if it is not among them.
{
  const L = (code, w, how) => ({ code, w, how });
  const legs = [L('A', 0.4, 'walk'), L('B', 0.3, 'walk'), L('C', 0.2, 'walk'), L('D', 0.07, 'bus'), L('E', 0.03, 'bus')];
  eq(FB.drawLegs(legs, 3).map((l) => l.code), ['A', 'B', 'C', 'D'], 'three walks and the heaviest bus building (D, not E)');
  eq(FB.drawLegs([L('A', 0.5, 'bus'), L('B', 0.3, 'walk'), L('C', 0.2, 'walk'), L('D', 0.1, 'walk')], 3).map((l) => l.code), ['A', 'B', 'C'], 'a bus building already in the top three is not added twice');
  eq(FB.drawLegs([L('A', 0.5, 'walk'), L('B', 0.5, 'walk')], 3).map((l) => l.code), ['A', 'B'], 'no bus building: just the top');
  eq(FB.drawLegs([], 3), [], 'no legs');
  const given = [L('B', 0.2, 'walk'), L('A', 0.8, 'bus')]; FB.drawLegs(given, 1);
  eq(given.map((l) => l.code), ['B', 'A'], 'the caller\'s list is not reordered');
}

console.log(`PASS A  hand-computed cases (${pass} checks)`);

// ══════════════════════════════════════════════════════════════════════════
// B. THE REAL DATA
// ══════════════════════════════════════════════════════════════════════════
const RAW = readJSON('data/walk_graph.json');
const homes = readJSON('data/finder/homes.json').homes;
const majors = readJSON('data/finder/major-buildings.json').majors;
const transit = readJSON('data/finder/transit.json');
const SLICE_TEXT = fs.readFileSync(path.join(ROOT, 'data', 'transit-live.json'), 'utf8');

/** What js/finder.js's recompute() does, for one major: the walking numbers, then the timetable bus for the other homes. */
let hold = { hi: -1, tree: null };
function setup(major, G, sl) {
  const N = core.normaliseTargets(major.b, (c) => !!core.buildingTree(G, c));
  const trees = N.targets.map((t) => core.buildingTree(G, t.code));
  const anchors = homes.map((h) => core.homeAnchors(G, h));
  const items = homes.map((h, hi) => ({ home: h, legs: N.targets.map((t, i) => ({ code: t.code, w: t.w,
    walk: anchors[hi].length ? { lo: core.walkFrom(G, trees[i], anchors[hi]).lo / 60, hi: core.walkFrom(G, trees[i], anchors[hi]).hi / 60 } : null, bus: null })) }));
  const out = { N, trees, items, G, sl };
  out.targets = N.targets.map((t) => { const n = G.doors[G.code[t.code][0]][2][0]; return { code: t.code, to: [G.Y[n], G.X[n]] }; });
  out.hs = homes.map((h) => ({ id: h.id, from: [h.p[1], h.p[0]] }));
  out.cb = {
    skip: (hi) => !!transit.homes[homes[hi].id],
    walkAll: (hi, ti) => { const w = items[hi].legs[ti].walk; return w ? [w.lo * 60, w.hi * 60] : null; },
    endWalk: (ti, p) => { const n = core.nearestNode(G, [p[1], p[0]]); const w = n && core.walkFrom(G, trees[ti], [{ node: n.node, c: n.m, m: n.m }]); return w ? [w.lo, w.hi] : null; },
    // one home's tree at a time, as js/finder.js does: the walk from the home to a stop is a lookup in it
    startWalk: (hi, p) => { if (hold.hi !== hi) hold = { hi, tree: core.homeTree(G, anchors[hi]) }; return core.walkToPoint(G, hold.tree, [p[1], p[0]]); },
  };
  return out;
}
const sig = (r, S) => r.legs.flatMap((row, hi) => row.map((l, ti) => l ? `${homes[hi].id}>${S.targets[ti].code}:${l.lo.toFixed(3)}-${l.hi.toFixed(3)}` : null).filter(Boolean));

const G0 = wg.decodeWalkGraph(RAW); G0.wc = RAW.wc;
const SL = JSON.parse(SLICE_TEXT);
let total = 0, withBus = 0;
const everything = [], pruned = [], sampleMajors = majors.filter((_, i) => i % 5 === 0);   // 9 majors for the slow "search everything" run
for (const m of majors) {
  const S = setup(m, G0, SL);
  FB.BUS.skipWalkMin = DEFAULTS.skipWalkMin; FB.BUS.transfers = DEFAULTS.transfers; if (BREAK === '--break=prune') FB.BUS.skipWalkMin = 99;
  const r = FB.busLegs(SL, S.hs, S.targets, S.cb, null);
  r.legs.forEach((row, hi) => row.forEach((l, ti) => {
    if (!l) return;
    total++;
    const w = S.items[hi].legs[ti].walk;
    ok(!transit.homes[homes[hi].id], `${m.id}: ${homes[hi].id} is a walkable home (East Riverside keeps its baked table)`);
    ok(l.mid <= (w.lo + w.hi) / 2 - DEFAULTS.beatsWalkS / 60 + 1e-9, `${m.id} ${homes[hi].id}>${S.targets[ti].code}: the bus (${l.lo.toFixed(1)}-${l.hi.toFixed(1)}) beats the walk (${w.lo.toFixed(1)}-${w.hi.toFixed(1)}) by 3 minutes`);
    ok(l.hi > l.lo && l.lo > 0 && l.src === 'timetable', `${m.id}: a real range, from the timetable`);
  }));
  ok(r.legs.every((row, hi) => !transit.homes[homes[hi].id] || row.every((l) => l === null)), `${m.id}: the East Riverside homes have no timetable leg`);
  withBus += r.legs.flat().filter(Boolean).length > 0 ? 1 : 0;
  pruned.push(sig(r, S));
  if (sampleMajors.includes(m)) {
    FB.BUS.skipWalkMin = 0; FB.BUS.transfers = 1;                       // search everything, change of bus included
    everything.push(sig(FB.busLegs(SL, S.hs, S.targets, S.cb, null), S));
    FB.BUS.skipWalkMin = DEFAULTS.skipWalkMin; FB.BUS.transfers = DEFAULTS.transfers;
    if (BREAK === '--break=prune') FB.BUS.skipWalkMin = 99;
  }
}
ok(total >= 100 && withBus >= 20, `the shipped data gives real bus trips: ${total} of them, in ${withBus} of ${majors.length} majors`);
const prunedSample = pruned.filter((_, i) => i % 5 === 0);
eq(prunedSample, everything, 'the prune (walks under 12 min never searched, no change of bus) gives exactly the trips that searching everything gives, for 9 majors');
console.log(`    ${total} bus trips over ${majors.length} majors; the pruned search and the search-everything search agree on all of them for ${everything.length} majors (${everything.flat().length} trips)`);

// The scorer: a timetable leg is picked only when its midpoint is smaller, per building and so overall.
{
  const cs = majors.find((m) => m.id === 'computer-science');
  const S = setup(cs, G0, SL);
  FB.BUS.skipWalkMin = DEFAULTS.skipWalkMin; FB.BUS.transfers = DEFAULTS.transfers; if (BREAK === '--break=prune') FB.BUS.skipWalkMin = 99;
  const r = FB.busLegs(SL, S.hs, S.targets, S.cb, null);
  const walkOnly = S.items.map((it) => core.scoreHome(it.legs, 'either'));
  const busItems = S.items.map((it, hi) => ({ ...it, legs: it.legs.map((l, ti) => ({ ...l, bus: l.bus || r.legs[hi][ti] })) }));
  let changed = 0;
  busItems.forEach((it, hi) => {
    const a = walkOnly[hi], b = core.scoreHome(it.legs, 'either');
    ok(!!a === !transit.homes[it.home.id], `${it.home.id}: only the East Riverside homes have no walking score`);
    if (!a) return;
    ok(b.mid <= a.mid + 1e-9, `${it.home.id}: with the bus the average is never worse (${b.mid.toFixed(2)} <= ${a.mid.toFixed(2)})`);
    if (b.mid < a.mid - 1e-9) { changed++; ok(b.legs.some((l) => l.how === 'bus' && l.bus.src === 'timetable') && b.how !== 'walk', `${it.home.id}: it got faster because a leg went by timetable bus`); }
    const w = core.scoreHome(it.legs, 'walk'), w0 = core.scoreHome(S.items[hi].legs, 'walk');
    eq([w.lo, w.hi], [w0.lo, w0.hi], `${it.home.id}: walk mode numbers are the walking numbers, bus or no bus`);
  });
  ok(changed >= 1, `for Computer Science, ${changed} homes rank better because of a bus`);
  const busMode = busItems.map((it) => ({ home: it.home, score: core.scoreHome(it.legs, 'bus') })).filter((x) => x.score && !transit.homes[x.home.id]);
  ok(busMode.every((x) => x.score.how === 'bus'), 'bus mode: a walkable home ranks only if every building has a bus');
  const rows = busItems.filter((it) => !transit.homes[it.home.id]).map((it) => core.scoreHome(it.legs, 'either'));
  const names = busItems.filter((it, hi) => walkOnly[hi] && core.scoreHome(it.legs, 'either').legs.some((l) => l.how === 'bus')).map((it) => it.home.name);
  console.log(`    Computer Science, either: ${names.length} homes use a bus for at least one building: ${names.join(', ')}`);
  ok(names.length >= 1 && rows.length > 0, 'at least one West Campus home goes by bus for some building');
}

// ══════════════════════════════════════════════════════════════════════════
// C. TIME
// ══════════════════════════════════════════════════════════════════════════
// Cold graph and cold bus index each repeat (decode and JSON.parse are outside the timer). "Before" is what js/finder.js
// did: one tree per building, the walk from every home, the score, the rank. "After" is the same plus the timetable bus.
// Minimum of 3 repeats, as CLAUDE.md rule 10 asks; Node, one thread, no CPU throttling. A phone is 3 to 5 times slower.
{
  FB.BUS.skipWalkMin = DEFAULTS.skipWalkMin; FB.BUS.transfers = DEFAULTS.transfers; if (BREAK === '--break=prune') FB.BUS.skipWalkMin = 99;
  const biggest = majors.map((m) => ({ m, n: core.normaliseTargets(m.b, (c) => !!core.buildingTree(G0, c)).targets.length })).sort((a, b) => b.n - a.n)[0];
  const cs = majors.find((m) => m.id === 'computer-science');
  const rows = [];
  for (const [label, major] of [['Computer Science', cs], ['biggest schedule (' + biggest.m.id + ')', biggest.m]]) {
    const before = [], after = [], busOnly = [];
    let stats = null;
    for (let rep = 0; rep < 3; rep++) {
      const G = wg.decodeWalkGraph(RAW); G.wc = RAW.wc;
      const sl = JSON.parse(SLICE_TEXT);
      let t = performance.now();
      const S = setup(major, G, sl);
      const scored = S.items.map((it) => ({ home: it.home, legs: it.legs, score: core.scoreHome(it.legs, 'either') }));
      core.rankHomes(scored);
      before.push(performance.now() - t);
      t = performance.now();
      const r = FB.busLegs(sl, S.hs, S.targets, S.cb, new Map(), () => performance.now());
      const items2 = S.items.map((it, hi) => ({ home: it.home, legs: it.legs.map((l, ti) => ({ ...l, bus: l.bus || r.legs[hi][ti] })) }));
      core.rankHomes(items2.map((it) => ({ ...it, score: core.scoreHome(it.legs, 'either') })));
      busOnly.push(performance.now() - t);
      after.push(before[before.length - 1] + busOnly[busOnly.length - 1]);
      stats = { searches: r.searches, targets: S.targets.length };
    }
    const b = Math.min(...before), a = Math.min(...after);
    rows.push({ label, b, a, extra: Math.min(...busOnly), ...stats });
    if (major === biggest.m) ok(a <= FB.BUS.budgetMs, `ranking with the timetable bus, ${label}: ${a.toFixed(0)} ms <= the ${FB.BUS.budgetMs} ms budget`);
  }
  for (const r of rows) console.log(`    ranking ${r.label}, ${r.targets} buildings x ${homes.length} homes (${r.searches} bus searches): walking only ${r.b.toFixed(1)} ms, with the timetable bus ${r.a.toFixed(1)} ms (the bus adds ${r.extra.toFixed(1)} ms); min of 3, cold graph and cold bus index, Node ${process.version}, no CPU throttle, budget ${FB.BUS.budgetMs} ms`);
  ok(rows[0].a <= FB.BUS.budgetMs, `Computer Science stays under the budget too: ${rows[0].a.toFixed(0)} ms`);
  // the cache: a second ranking of the same schedule (a mode switch, a re-open) costs nothing
  const G = wg.decodeWalkGraph(RAW); G.wc = RAW.wc; const sl = JSON.parse(SLICE_TEXT);
  const S = setup(cs, G, sl), cache = new Map();
  const first = FB.busLegs(sl, S.hs, S.targets, S.cb, cache);
  const again = FB.busLegs(sl, S.hs, S.targets, S.cb, cache);
  ok(first.searches > 100 && again.searches === 0 && again.cached === first.searches, `a second ranking of the same schedule searches nothing (${first.searches} searches, then ${again.cached} cached)`);
}
console.log(`PASS  finder-bus: the bus in the ranking and on the map (${pass} checks)`);
