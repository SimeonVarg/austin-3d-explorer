/**
 * walkmeter.mjs — how far from the real front door does the walk actually end?
 *
 * Usage:
 *   python scripts/serve.py 8711                     # from the repo root
 *   VERIFY_URL=http://127.0.0.1:8711 node scripts/verify/walkmeter.mjs
 *     --json out.json      also write the full per-pair table
 *     --pairs other.json   score a different pair list
 *     --only shipped       skip the baseline pass (half the wall clock)
 *
 * WHAT IT MEASURES. Simeon's complaint about the walk feature was "many routes
 * if not most take you to a farther entrance than you have to go." That is a
 * measurable sentence, and this is the instrument for it:
 *
 *     extra metres = distance( the door the router picked ,
 *                              the nearest door UT PUBLISHES for that building )
 *
 * summed over both ends of every pair in walk-pairs.json. Zero means the walk
 * ends where maps.utexas.edu says the entrance is. It is deliberately NOT
 * "route length": a shorter route to the wrong door IS the bug, because the
 * metres you then walk round the building are real and simply go uncounted.
 * PAT->BIO gets ~94 m longer under the fix and is more correct for it.
 *
 * THE ORACLE. UT Facilities hand-surveyed the front door of 67 campus buildings
 * and publishes them (Celebrated_Entrances, the layer maps.utexas.edu draws).
 * js/wayfind.js ships that table, so this script asks the PAGE for it
 * (`window.wayfindUTDoors()`) rather than re-fetching ArcGIS or keeping its own
 * copy: the score is then against exactly the rows the router used, the harness
 * needs no network, and the list cannot go stale against the router in silence.
 *
 * WHY IT DRIVES THE REAL PAGE. There is no offline copy of the door choice. The
 * candidate set depends on the loaded graph, on doors created at RUN TIME for
 * UT points our bake never placed, and on the avoid-stairs state. Scoring a
 * reimplementation would score the reimplementation.
 *
 * THE TWO PASSES. `--baseline` is not an old checkout, it is the SAME page with
 * the three switches this round added turned off:
 *
 *     useUTSurvey:false   utVirtualDoors:false   widenSideDoors:false
 *
 * i.e. the router as it behaved before the door pass — one `role: main` door per
 * building, chosen by the bake's publicness score, no UT survey, no side doors.
 * Flipping switches on one page rather than checking out an old commit keeps the
 * graph, the data and the browser identical across the A/B, so the only thing
 * that differs is the rule.
 *
 * THE CACHE TRAP, and it cost a wrong number once. `virtualDoor()` memoises its
 * REFUSALS as well as its hits, so a pass that runs with utVirtualDoors off and
 * then flips it on in the same page keeps every refusal it already cached. Each
 * pass therefore gets its own page load. Do not "optimise" that away.
 */
import { chromium } from 'playwright-core';
import { launch, BASE } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i < 0 ? d : argv[i + 1]; };
const PAIRS_FILE = path.resolve(arg('--pairs', path.join(HERE, 'walk-pairs.json')));
const JSON_OUT = arg('--json', null);
const ONLY = arg('--only', null);
const PAIRS = JSON.parse(fs.readFileSync(PAIRS_FILE, 'utf8')).pairs;

/** A walk ending this far from UT's own door counts as "the right door". The
 *  same trough the router's utDoorMatchM sits in, rounded up: under ~15 m you
 *  are at the same doorway, over it you are on another wall. Reported, never
 *  asserted on — this script prints a number, it does not gate a merge. */
const AT_THE_DOOR_M = 15;

const URL = `${BASE}/index.html?walk=1&intro=0&drift=0`;
const SHIPPED = { useUTSurvey: true, utVirtualDoors: true, widenSideDoors: true };
const BASELINE = { useUTSurvey: false, utVirtualDoors: false, widenSideDoors: false };

const browser = await launch(chromium, { maxMs: 540000 });

async function ready(page) {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
  // Correctness, not speed: the auto-detect probe rewrites every graphics
  // setting ~11 s in (CLAUDE.md verification rule 10).
  await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
  await page.waitForFunction(() => !document.getElementById('veil'), null, { timeout: 120000 });
  await page.waitForFunction(
    () => typeof window.wayfindRoute === 'function' && typeof window.wayfindUTDoors === 'function',
    null, { timeout: 60000 });
}

async function pass(label, flags) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  await ready(page);

  const applied = await page.evaluate(f => {
    Object.assign(window.WAYFIND, f);
    const W = window.WAYFIND;
    return { useUTSurvey: W.useUTSurvey, utVirtualDoors: W.utVirtualDoors,
             widenSideDoors: W.widenSideDoors, utDoorMatchM: W.utDoorMatchM,
             utVirtualSnapM: W.utVirtualSnapM, sideDoorPenaltyM: W.sideDoorPenaltyM };
  }, flags);

  const out = await page.evaluate(async ({ pairs, AT }) => {
    // Equirectangular metres at campus latitude — the same approximation
    // js/wayfind.js routes with, so the score cannot disagree with the router
    // about what a metre is.
    const MPD_LAT = 111320, MPD_LON = 111320 * Math.cos(30.285 * Math.PI / 180);
    const m = (a, b) => Math.hypot((a[0] - b[0]) * MPD_LON, (a[1] - b[1]) * MPD_LAT);
    // wayfindUTDoors(code) respects WAYFIND.useUTSurvey and the BASELINE pass
    // turns that off — so the oracle would vanish exactly when it is needed.
    // Read it with the switch momentarily on. Nothing is routed inside here.
    const oracle = code => {
      const keep = window.WAYFIND.useUTSurvey;
      window.WAYFIND.useUTSurvey = true;
      const ut = window.wayfindUTDoors(code) || [];
      window.WAYFIND.useUTSurvey = keep;
      return ut;
    };
    const errTo = (ll, code) => {
      const ut = oracle(code);
      if (!ut.length) return null;
      let best = Infinity;
      for (const t of ut) best = Math.min(best, m(ll, [t.lon, t.lat]));
      return best;
    };

    const rows = [];
    for (const p of pairs) {
      const r = await window.wayfindRoute(p.from, p.to);
      if (!r || !r.ok) { rows.push({ from: p.from, to: p.to, ok: false, why: r ? r.why : 'null' }); continue; }
      const a = window.wayfindDoorAt(r.fromDoor), b = window.wayfindDoorAt(r.toDoor);
      const ea = errTo(a.ll, r.fromCode), eb = errTo(b.ll, r.toCode);
      rows.push({
        from: p.from, to: p.to, ok: true, distM: Math.round(r.distM),
        fromErrM: ea, toErrM: eb, extraM: (ea || 0) + (eb || 0),
        fromSrc: r.fromSrc, toSrc: r.toSrc, fromRole: r.fromRole, toRole: r.toRole,
        fromLinkM: r.fromLinkM, toLinkM: r.toLinkM, minutes: `${r.lo}-${r.hi}`,
        atDoor: (ea != null && ea <= AT ? 1 : 0) + (eb != null && eb <= AT ? 1 : 0),
      });
    }

    // The stronger test, because a pair list can be lucky: score the door
    // choice on EVERY building UT surveyed that this build can route to, not
    // only the forty ends the pairs happen to name.
    const all = [];
    for (const code of window.wayfindUTDoors().codes) {
      const d = await window.wayfindDoors(code);
      if (!d || !d.doors || !d.doors.length) { all.push({ code, routable: false }); continue; }
      const ut = oracle(code);
      if (!ut.length) { all.push({ code, routable: true, ut: 0 }); continue; }
      // WORST candidate, not best. doorSet() hands all of these to Dijkstra and
      // any one of them can be the door you are sent to, so the honest score
      // for a building is the worst door it might pick, not the best it holds.
      let worst = 0, bestOfSet = Infinity;
      for (const dd of d.doors) {
        let best = Infinity;
        for (const t of ut) best = Math.min(best, m(dd.ll, [t.lon, t.lat]));
        worst = Math.max(worst, best);
        bestOfSet = Math.min(bestOfSet, best);
      }
      all.push({ code, routable: true, ut: ut.length, worstM: worst, bestM: bestOfSet,
                 n: d.doors.length, ok: worst <= AT });
    }
    // ── the accessibility claim, which was asserted and never measured ─────
    // UT records BarrierFree per DOOR, and ten buildings have both kinds: Batts
    // Hall's north entrance is up a flight with no auto-opener while its east
    // and southwest entrances are barrier-free. The round claims "avoid stairs"
    // now drops the non-barrier-free doors from the candidate set. That is a
    // sentence with a truth value, so this checks it rather than repeating it:
    // with the toggle ON, no candidate door on those buildings may be nearer a
    // door UT marked BarrierFree=N than one it marked Y.
    const stairs = [];
    for (const code of window.wayfindUTDoors().codes) {
      const ut = oracle(code);
      if (ut.length < 2) continue;
      const hasY = ut.some(t => t.bf), hasN = ut.some(t => !t.bf);
      if (!hasY || !hasN) continue;                 // nothing to choose between
      const off = await window.wayfindDoors(code, false);
      const on = await window.wayfindDoors(code, true);
      if (!off || !on || !on.doors.length) { stairs.push({ code, routable: false }); continue; }
      // Which KIND of UT door is each candidate standing at?
      const kind = dd => {
        let best = null, bd = Infinity;
        for (const t of ut) { const d = m(dd.ll, [t.lon, t.lat]); if (d < bd) { bd = d; best = t; } }
        return { bf: !!(best && best.bf), d: bd };
      };
      const onKinds = on.doors.map(kind), offKinds = off.doors.map(kind);
      stairs.push({
        code, routable: true, utDoors: ut.length,
        offN: off.doors.length, onN: on.doors.length,
        offBad: offKinds.filter(k => !k.bf).length,
        onBad: onKinds.filter(k => !k.bf).length,
        pass: onKinds.every(k => k.bf),
      });
    }

    // ── can you GET there at all without stairs? ───────────────────────────
    // Choosing a barrier-free door is worthless if the walk to it is refused.
    // A door snapped to a walkable node can still sit on an island whose every
    // exit is a staircase — the Main Building's plinth reaches 37 nodes without
    // steps and 10,790 with them — so the router answered "we cannot take you
    // there" for the Tower with the toggle on. This routes from two step-free
    // hubs at opposite ends of campus to every UT building, both ways, so the
    // count cannot be an artefact of one origin.
    //
    // Measured BOTH WAYS on the same page: WAYFIND.utVirtualStepFree is the fix,
    // and turning it off reproduces the bug rather than describing it. Safe to
    // flip mid-page only because virtualDoor()'s cache key carries the mode.
    const HUBS = ['PCL', 'JES'];
    const reach = [];
    const keepSF = window.WAYFIND.utVirtualStepFree;
    for (const code of window.wayfindUTDoors().codes) {
      const d = await window.wayfindDoors(code, true);
      if (!d || !d.doors || !d.doors.length) continue;
      const probe = async () => {
        for (const h of HUBS) {
          if (h === code) return true;
          const r = await window.wayfindRoute(h, code, { avoidStairs: true });
          if (r && r.ok) return true;
        }
        return false;
      };
      window.WAYFIND.utVirtualStepFree = true;
      const on = await probe();
      window.WAYFIND.utVirtualStepFree = false;
      const off = await probe();
      window.WAYFIND.utVirtualStepFree = keepSF;
      let anyWay = false;
      for (const h of HUBS) {
        if (h === code) { anyWay = true; break; }
        const r = await window.wayfindRoute(h, code, { avoidStairs: false });
        if (r && r.ok) { anyWay = true; break; }
      }
      reach.push({ code, stepFree: on, stepFreeBefore: off, anyWay });
    }
    window.WAYFIND.utVirtualStepFree = keepSF;

    window.wayfindClear && window.wayfindClear();
    return { rows, all, stairs, reach };
  }, { pairs: PAIRS, AT: AT_THE_DOOR_M });

  await page.close();
  return { label, applied, rows: out.rows, all: out.all, stairs: out.stairs, reach: out.reach, errs };
}

// The oracle's own size, read off the shipped table.
const boot = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await ready(boot);
const ORACLE = await boot.evaluate(() => {
  const o = window.wayfindUTDoors();
  return { doors: o.doors, buildings: o.buildings };
});
await boot.close();

const before = ONLY === 'shipped' ? null : await pass('BASELINE', BASELINE);
const after = await pass('SHIPPED', SHIPPED);
await browser.__done();

// ── report ────────────────────────────────────────────────────────────────
const sum = a => a.reduce((x, y) => x + y, 0);
function score(p) {
  if (!p) return null;
  const ok = p.rows.filter(r => r.ok);
  const extra = ok.map(r => r.extraM);
  const routable = p.all.filter(a => a.routable && a.ut);
  const worst = routable.map(a => a.worstM);
  return {
    pairsOk: ok.length, pairsFail: p.rows.length - ok.length,
    totalExtraM: sum(extra), meanExtraM: extra.length ? sum(extra) / extra.length : 0,
    worstPairM: extra.length ? Math.max(...extra) : 0,
    atDoor: sum(ok.map(r => r.atDoor)), ends: ok.length * 2,
    meanRouteM: ok.length ? sum(ok.map(r => r.distM)) / ok.length : 0,
    buildings: routable.length,
    meanWorstDoorM: worst.length ? sum(worst) / worst.length : 0,
    allInside: routable.filter(a => a.ok).length,
  };
}
const A = score(before), B = score(after);
const f1 = n => (n == null ? '   —' : n.toFixed(1));
const col = (a, b, unit = ' m') =>
  `${(A ? f1(a) : '   —').padStart(9)}${unit} ${f1(b).padStart(11)}${unit}`;

console.log('');
console.log('walkmeter — extra metres to the door UT itself publishes');
console.log(`  page      ${URL}`);
console.log(`  pairs     ${PAIRS.length} from ${path.basename(PAIRS_FILE)}`);
console.log(`  oracle    ${ORACLE.doors} celebrated-entrance rows on ${ORACLE.buildings} buildings, shipped in js/wayfind.js`);
console.log(`  "at the door" = within ${AT_THE_DOOR_M} m of a UT door`);
console.log('');
console.log('  THE TWENTY PAIRS                        baseline       shipped');
console.log(`    total extra metres, 20 pairs        ${col(A && A.totalExtraM, B.totalExtraM)}`);
console.log(`    mean extra metres per pair          ${col(A && A.meanExtraM, B.meanExtraM)}`);
console.log(`    worst single pair                   ${col(A && A.worstPairM, B.worstPairM)}`);
console.log(`    ends at the right door              ${(A ? A.atDoor + '/' + A.ends : '—').padStart(11)} ${(B.atDoor + '/' + B.ends).padStart(13)}`);
console.log(`    mean route length                   ${col(A && A.meanRouteM, B.meanRouteM)}`);
console.log('');
console.log('  EVERY BUILDING UT SURVEYED (a pair list can be lucky)');
console.log(`    routable buildings scored           ${(A ? String(A.buildings) : '—').padStart(11)} ${String(B.buildings).padStart(13)}`);
console.log(`    mean WORST-case door error          ${col(A && A.meanWorstDoorM, B.meanWorstDoorM)}`);
console.log(`    every candidate inside ${AT_THE_DOOR_M} m         ${(A ? A.allInside + '/' + A.buildings : '—').padStart(11)} ${(B.allInside + '/' + B.buildings).padStart(13)}`);
console.log('');
console.log('  per pair (extra metres to UT\'s door: baseline -> shipped)');
for (let i = 0; i < PAIRS.length; i++) {
  const a = before && before.rows[i], b = after.rows[i];
  const nm = `${PAIRS[i].from}->${PAIRS[i].to}`.padEnd(10);
  if (!b || !b.ok) { console.log(`    ${nm}  NO ROUTE  (${b ? b.why : 'null'})`); continue; }
  if (!before) { console.log(`    ${nm} ${f1(b.extraM).padStart(7)} m            route ${String(b.distM).padStart(4)} m   doors ${b.fromSrc}/${b.toSrc}`); continue; }
  if (!a.ok) { console.log(`    ${nm} ${'no route'.padStart(9)}  ->  ${f1(b.extraM).padStart(7)} m  gained    route ${String(b.distM).padStart(4)} m   doors ${b.fromSrc}/${b.toSrc}`); continue; }
  const mark = b.extraM < a.extraM - 0.5 ? 'better' : (b.extraM > a.extraM + 0.5 ? 'WORSE ' : '  =   ');
  console.log(`    ${nm} ${f1(a.extraM).padStart(7)} m  ->  ${f1(b.extraM).padStart(7)} m  ${mark}    route ${String(a.distM).padStart(4)} -> ${String(b.distM).padStart(4)} m   doors ${b.fromSrc}/${b.toSrc}`);
}
console.log('');
console.log('  "AVOID STAIRS" AT THE DOOR (buildings where UT records both kinds)');
const st = after.stairs.filter(s => s.routable);
for (const s of st) {
  console.log(`    ${s.code.padEnd(5)} UT doors ${s.utDoors}   candidates ${s.offN} -> ${s.onN}` +
    `   non-barrier-free among them ${s.offBad} -> ${s.onBad}   ${s.pass ? 'ok' : 'STILL SENDS YOU UP THE STEPS'}`);
}
console.log(`    ${st.filter(s => s.pass).length}/${st.length} clean; ` +
  `${st.filter(s => s.offBad > 0).length} of them would have offered a stepped door with the toggle off`);
const rc = after.reach || [];
const stranded = rc.filter(r => r.anyWay && !r.stepFree);
const strandedBefore = rc.filter(r => r.anyWay && !r.stepFreeBefore);
console.log(`    reachable step-free from a hub   ${String(rc.filter(r => r.stepFreeBefore).length + '/' + rc.length).padStart(11)} ${String(rc.filter(r => r.stepFree).length + '/' + rc.length).padStart(13)}   (utVirtualStepFree off -> on)`);
console.log(`    stranded before: ${strandedBefore.map(r => r.code).join(' ') || 'none'}   after: ${stranded.map(r => r.code).join(' ') || 'none'}`);

const regress = after.all.filter(a => a.routable && a.ut && !a.ok);
console.log('');
console.log(`  buildings still outside ${AT_THE_DOOR_M} m: ${regress.length ? regress.map(r => `${r.code} ${f1(r.worstM)} m`).join(', ') : 'none'}`);
const notRoutable = after.all.filter(a => !a.routable).map(a => a.code);
console.log(`  UT buildings this build cannot route to at all (${notRoutable.length}): ${notRoutable.join(' ') || 'none'}`);
// Not a shortfall, and checked rather than assumed (docs/walk-door.md round 3
// §4): ten of these are at the J.J. Pickle Research Campus, latitude 30.38-30.39,
// about 11 km north of the Forty Acres and outside everything this app draws.
// The eleventh, SSW, is absent from UT's own 198-code Main Campus register too.
console.log('    (10 of those are 11 km north at the Pickle campus, off this map; SSW is not in UT\'s own register)');
const allErrs = [...(before ? before.errs : []), ...after.errs];
if (allErrs.length) console.log('\n  PAGE ERRORS:\n    ' + allErrs.slice(0, 8).join('\n    '));

if (JSON_OUT) {
  fs.writeFileSync(JSON_OUT, JSON.stringify({
    url: URL, at: new Date().toISOString(), atDoorM: AT_THE_DOOR_M, oracle: ORACLE,
    baseline: A && { ...A, flags: before.applied, rows: before.rows, all: before.all },
    shipped: { ...B, flags: after.applied, rows: after.rows, all: after.all },
  }, null, 2));
  console.log(`\n  wrote ${JSON_OUT}`);
}

process.exit(after.rows.filter(r => !r.ok).length ? 1 : 0);
