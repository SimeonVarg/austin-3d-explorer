/**
 * transit-route.mjs — js/transit-route.js (walk + bus + walk), checked in node.
 *
 * No browser, no network. HAND-COMPUTED CASES on a slice built here: two routes on a grid at latitude 30, where
 * every expected number is written out as the arithmetic a person would do, never by calling the code under test.
 *
 *   R1, direction 0:  A --700 m--> B --800 m--> C     minutes from A: 0, 4, 10     a bus every 10 min, 06:00-22:00
 *   R2, direction 0:  D ---------2000 m-------> E     minutes from D: 0, 6         a bus every 20 min, 06:00-22:00
 *   D stands 100 m north of C (the transfer). No Sunday service on either.
 *
 * Usage: node scripts/verify/transit-route.mjs [--break]     (--break sets the detour factor to 1: it must fail)
 */
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const T = await import(pathToFileURL(path.join(ROOT, 'js', 'transit-route.js')).href);
if (process.argv.includes('--break')) T.ROUTE.detour = 1;

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };
const near = (a, b, tol, msg) => { assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, want ${b} ±${tol}`); pass++; };

// One degree of latitude is 111320 m; at latitude 30 one degree of longitude is 111320 x cos(30 deg) = 96405.95 m.
const LAT = 30, MY = 111320, MX = 111320 * Math.cos(30 * Math.PI / 180);
const at = (eastM, northM) => [LAT + northM / MY, eastM / MX];              // [lat, lon]
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
const HOME = at(0, 200);            // 200 m north of A
const WED_0830 = { day: 3, minute: 510 };

// ── 1. direct, by the timetable ─────────────────────────────────────────────
// walk to A   200 m x 1.3 = 260 m      brisk 260 / 1.4 = 185.714 s     slow 260 / 1.1 = 236.364 s
// wait        0 .. one headway = 600 s
// ride A->C   10 min = 600 s
// walk        150 m x 1.3 = 195 m      brisk 139.286 s                 slow 177.273 s
// total       185.714 + 0 + 600 + 139.286 = 925.000        236.364 + 600 + 600 + 177.273 = 1613.637
{
  const r = T.plan(slice(), HOME, at(1500, -150), { when: WED_0830 });
  const o = r.options[0];
  ok(o && o.transfers === 0, 'direct: an answer with no transfer');
  near(o.lo, 925.000, 0.01, 'direct lo'); near(o.hi, 1613.637, 0.01, 'direct hi');
  ok(o.legs.map((l) => l.kind).join() === 'walk,wait,bus,walk', 'direct: four legs in order');
  ok(o.legs[2].board === 'A' && o.legs[2].alight === 'C' && o.legs[2].stops === 2, 'direct: A to C, two stops');
  ok(o.legs[1].live === false && o.legs[1].headway === 10, 'direct: the wait is by the timetable, headway 10');
  near(o.walkM, 350, 0.01, 'direct: 200 + 150 m of walking, straight line');
  ok(!o.live, 'direct: not marked live');
  ok(T.rangeText(o.lo, o.hi) === '15-27 min', 'range text: 925 s -> 15, 1613.6 s -> 27');
  // boarding at B instead: walk hypot(700, 200) = 728.011 m x 1.3 -> 676.01 / 860.38 s, ride 6 min:
  //   mid = (676.01 + 0 + 360 + 139.29 + 860.38 + 600 + 360 + 177.27) / 2 = 1586.5 > 1269.3. A must win.
  ok(r.options.filter((x) => x.legs.some((l) => l.routeId === 'R1')).length === 1, 'one answer per route chain');
}

// ── 2. the same trip with a live feed ────────────────────────────────────────
// The feed says buses at A in 1 and 9 minutes. A slow walker needs 236.364 s = 3.94 min: the 1 min bus is gone,
// the 9 min bus (540 s) is the one. walk + wait = 540 s for both walkers.
// total       540 + 600 + 139.286 = 1279.286        540 + 600 + 177.273 = 1317.273
{
  const calls = [];
  const r = T.plan(slice(), HOME, at(1500, -150), { when: WED_0830, live: (sid, rid, dir) => { calls.push([sid, rid, dir]); return sid === 'A' ? [1, 9] : null; } });
  const o = r.options[0];
  near(o.lo, 1279.286, 0.01, 'live lo'); near(o.hi, 1317.273, 0.01, 'live hi');
  ok(o.live && o.legs[1].live && o.legs[1].inMin === 9, 'live: marked live, the 9 minute bus');
  near(o.legs[0].lo + o.legs[1].lo, 540, 0.01, 'live: brisk walk + wait is the bus time');
  near(o.legs[0].hi + o.legs[1].hi, 540, 0.01, 'live: slow walk + wait is the bus time');
  ok(calls.some((c) => c.join() === 'A,R1,0'), 'live: asked for stop A, route R1, direction 0');
}

// ── 3. one transfer ─────────────────────────────────────────────────────────
// to a point 100 m north of E. Only R2 reaches E, only R1 is near home.
// walk to A   185.714 / 236.364      wait 0 / 600      ride A->C 600
// C to D      100 m x 1.3 = 130 m    92.857 / 118.182
// wait for R2 at least 120 s  ..  its headway 20 min = 1200 s
// ride D->E   6 min = 360            walk 100 m x 1.3 = 130 m    92.857 / 118.182
// total       185.714 + 0 + 600 + 92.857 + 120 + 360 + 92.857 = 1451.428
//             236.364 + 600 + 600 + 118.182 + 1200 + 360 + 118.182 = 3232.728
{
  const r = T.plan(slice(), HOME, at(3500, 200), { when: WED_0830 });
  const o = r.options[0];
  ok(o && o.transfers === 1, 'transfer: an answer with one transfer');
  near(o.lo, 1451.428, 0.01, 'transfer lo'); near(o.hi, 3232.728, 0.01, 'transfer hi');
  ok(o.legs.map((l) => l.kind).join() === 'walk,wait,bus,walk,wait,bus,walk', 'transfer: seven legs in order');
  ok(o.legs[2].alight === 'C' && o.legs[5].board === 'D' && o.legs[5].alight === 'E', 'transfer: off at C, on at D, off at E');
  ok(o.legs[3].transfer === true, 'transfer: the middle walk is marked');
  ok(T.plan(slice(), HOME, at(3500, 200), { when: WED_0830, transfers: 0 }).options.length === 0, 'transfers: 0 finds nothing here');
}

// ── 4. when the buses do not run ─────────────────────────────────────────────
{
  const late = T.plan(slice(), HOME, at(1500, -150), { when: { day: 3, minute: 23 * 60 + 30 } });
  ok(late.options.length === 0 && late.skipped > 0 && /not? .*running|no bus is running/.test(late.reason), 'after the last bus: nothing, and it says why');
  const sun = T.plan(slice(), HOME, at(1500, -150), { when: { day: 0, minute: 510 } });
  ok(sun.options.length === 0 && sun.skipped > 0, 'Sunday, no service block: nothing');
  const s = slice(); s.routes.R1.dirs[0].sun = { first: '08:00', last: '20:00', headway: [[8, 30]] };
  const sun2 = T.plan(s, HOME, at(1500, -150), { when: { day: 0, minute: 510 } });
  near(sun2.options[0].hi - sun2.options[0].lo, (236.364 - 185.714) + 1800 + (177.273 - 139.286), 0.01, 'Sunday block: the wait is 0 .. 30 min');
  // B sees the 06:00 bus at 06:04. At 06:01 a walker 10 m from B cannot have a bus at A's 06:00 headway window yet... but
  // the window at B opens at 06:04 - walk. Leaving at 05:50 from next to B: reach B about 05:50, before 06:04: no bus.
  const early = T.plan(slice(), at(700, 10), at(1500, -150), { when: { day: 3, minute: 5 * 60 + 50 } });
  ok(!early.options.some((o) => o.legs[2].board === 'B'), 'before the first bus reaches B: B is not offered');
  ok(T.headwayAt(slice().routes.R1.dirs[0], 3, 510) === 10 && T.headwayAt(slice().routes.R1.dirs[0], 3, 359) === null, 'headwayAt: 10 at 08:30, none at 05:59');
}

// ── 5. nothing near ──────────────────────────────────────────────────────────
{
  const far = T.plan(slice(), at(0, 5000), at(1500, -150), { when: WED_0830 });
  ok(far.options.length === 0 && far.reason === 'no stop near the start', 'no stop within 800 m of the start');
  const far2 = T.plan(slice(), HOME, at(9000, 0), { when: WED_0830 });
  ok(far2.options.length === 0 && far2.reason === 'no stop near the end', 'no stop within 800 m of the end');
}

// ── 6. the caller's own walking times, and the line to draw ─────────────────
{
  const r = T.plan(slice(), HOME, at(1500, -150), { when: WED_0830, walkSec: (a, b, m) => [m, 2 * m] });   // 1 s and 2 s a metre
  near(r.options[0].lo, 200 + 0 + 600 + 150, 0.01, 'walkSec lo'); near(r.options[0].hi, 400 + 600 + 600 + 300, 0.01, 'walkSec hi');
  const s = slice(), line = T.shapeBetween(s, s.routes.R1.dirs[0], 1, 2);
  near(T.metres([line[0][1], line[0][0]], [s.stops.B[1], s.stops.B[2]]), 0, 0.01, 'shape starts at B');
  near(T.metres([line.at(-1)[1], line.at(-1)[0]], [s.stops.C[1], s.stops.C[2]]), 0, 0.01, 'shape ends at C');
  near(T.metres(at(0, 0), at(300, 400)), 500, 0.05, 'metres: a 3-4-5 triangle');
}

console.log(`PASS  transit-route: walk + bus + walk, direct, live, one transfer, service hours (${pass} checks)`);
