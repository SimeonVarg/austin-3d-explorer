/**
 * walk-lift.mjs — WHY a scripted walk leaves walking height. The diagnosis, not
 * the fix.
 *
 * QUEUE Y16 / HANDOFF §132 record the symptom in the strongest possible form:
 * every `perf-budget.mjs` walk rep travelled its 120 m and **ended at 23.8 m,
 * the same digit every rep**, and three separate passes then wrote "Y15 could
 * not be measured" because above `TRUNK_ALT` (12 m) the trunk field is switched
 * off. A constant that precise reads like something resolving altitude to a
 * fixed value, and §132 named three candidates (the step-up floor, the rooftop
 * floor, `HARD_CLEAR`) without separating them.
 *
 * THIS SCRIPT SEPARATES THEM, and it does it the only way that settles it: it
 * reads `__fly.eye()` EVERY FRAME and prints the series. §105 is the precedent —
 * four of twelve wall runs "ended high" and looked like a ladder in the summary
 * table; the frame-by-frame trace showed `alt` never changed after frame one and
 * it was the hard net ejecting correctly. A summary row cannot tell a ladder
 * from a single step, and this suite has already been fooled by that once.
 *
 * Every frame it records, beside the altitude:
 *   - `roofAt(eye, rCam())`  — what the collision field says is under the eye
 *   - `roofAt(eye, 6)`       — the same at the flying probe radius
 *   - `trunkAt(eye)`         — whether a tree is claiming the cell
 *   - the LIVE derived constants (`groundMix`, `rCam`, `skinV`, `stepUp`,
 *     `altFloorMin`), which is why `__fly.consts()` was made a function
 *
 * and then attributes the first departure from walking height to the mechanism
 * whose arithmetic reproduces the observed altitude to 0.05 m. The four
 * candidates are all in `js/controls.js` and all read the same `maxHeightIn`:
 *
 *   hard net       alt = roof + HARD_CLEAR            (tick, after the floor)
 *   rooftop floor  alt = roof + skinV()               (want, gated by stepUp())
 *   step-up        alt = hObs + skinV()               (stepFloor, in the substep)
 *   pitch floor    alt = dMin * cos(pitch)            (altFloorMin)
 *
 * USAGE
 *   VERIFY_URL=http://127.0.0.1:8441 node walk-lift.mjs [site ...]
 *
 * With no arguments it runs SITES.perfbudget — the exact start pose, bearing and
 * sprint state `perf-budget.mjs` uses — because reproducing 23.8 m is the point.
 *
 * INSTRUMENT: headless, `gl:'hardware'` (the walk is a CPU-side integrator and
 * SwiftShader would rasterise the city on the same cores), NO cpu throttle,
 * `index.html?intro=0`, auto-detect cancelled. It asserts NOTHING about timing;
 * it is a trace.
 *
 * Written by the Acer lane, 2026-08-16. Owns: this file only.
 */
import { chromium } from 'playwright-core';
import { launch, BASE } from './chrome.mjs';

const VW = 1440, VH = 900;

// The six sites §132 probed, plus perf-budget's own. Parameterised so a bearing
// or a start can be moved in one line (CLAUDE.md rule 11).
const SITES = {
  perfbudget: { lng: -97.74170, lat: 30.28950, bearing: 180, note: "perf-budget.mjs's own walk phase" },
  dragS:      { lng: -97.74170, lat: 30.28950, bearing: 180, note: 'Guadalupe, south' },
  dragN:      { lng: -97.74170, lat: 30.28500, bearing: 0,   note: 'Guadalupe, north' },
  speedway:   { lng: -97.73760, lat: 30.28800, bearing: 180, note: 'Speedway, south' },
  wc24th:     { lng: -97.74300, lat: 30.28680, bearing: 270, note: 'West Campus, 24th west' },
};

const WALK = { alt: 1.7, pitch: 85, sprint: true, metres: 200, maxSeconds: 120 };

const asked = process.argv.slice(2).filter(a => !a.startsWith('--'));
const sites = (asked.length ? asked : ['perfbudget']).filter(s => {
  if (SITES[s]) return true;
  console.error(`unknown site "${s}" — known: ${Object.keys(SITES).join(', ')}`);
  return false;
});

const PAGE_HELPERS = () => {
  window.__settle = async () => {
    for (let i = 0; i < 240; i++) {
      if (!window.__fly.eye().driving) return true;
      await new Promise(r => requestAnimationFrame(r));
    }
    return false;
  };
  window.__placeEye = (lng, lat, alt, bearing, pitch) => {
    const m = window.__map, C = 40030228.884, M_LAT = C / 360;
    const camPx = 0.5 * m.getCanvas().clientHeight / Math.tan(58 * Math.PI / 360);
    const D = alt / Math.cos(pitch * Math.PI / 180);
    const lead = alt * Math.tan(pitch * Math.PI / 180);
    const cLat = lat + lead * Math.cos(bearing * Math.PI / 180) / M_LAT;
    const cLng = lng + lead * Math.sin(bearing * Math.PI / 180) /
                       (M_LAT * Math.cos(lat * Math.PI / 180));
    const z = Math.log2(C * Math.cos(cLat * Math.PI / 180) * camPx / (512 * D));
    m.jumpTo({ center: [cLng, cLat], zoom: z, bearing, pitch });
  };
};

async function trace(browser, site) {
  const S = SITES[site];
  const page = await browser.newPage({ viewport: { width: VW, height: VH } });
  await page.goto(`${BASE}/index.html?intro=0`, { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
  await page.waitForFunction(() => window.__fly && window.__fly.indexed(), null, { timeout: 60000 });
  await page.evaluate(() => { try { window.cancelGraphicsAutoDetect(); } catch (e) {} });
  await page.evaluate(PAGE_HELPERS);
  await page.waitForTimeout(3000);

  const out = await page.evaluate(async ({ S, W }) => {
    const F = window.__fly, M_LAT = 40030228.884 / 360;
    // The shift state must ride on the SAME event — see perf-budget.mjs.
    const key = (code, down, shift) => window.dispatchEvent(
      new KeyboardEvent(down ? 'keydown' : 'keyup', { code, shiftKey: !!shift, bubbles: true }));

    await window.__settle();
    window.__placeEye(S.lng, S.lat, W.alt, S.bearing, W.pitch);
    await new Promise(r => requestAnimationFrame(r));
    await new Promise(r => requestAnimationFrame(r));
    await new Promise(r => setTimeout(r, 2500));

    const e0 = F.eye(), cosLat = Math.cos(e0.lat * Math.PI / 180);
    const covered = e => Math.hypot((e.lng - e0.lng) * M_LAT * cosLat, (e.lat - e0.lat) * M_LAT);
    const t0 = performance.now();
    const series = [];

    // A frame's row is read BEFORE the next rAF, so `alt` and the probes it is
    // being attributed to come from the same tick.
    const row = () => {
      const e = F.eye(), c = F.consts();
      return {
        t: +((performance.now() - t0) / 1000).toFixed(2),
        m: +covered(e).toFixed(1),
        alt: +e.alt.toFixed(3), altUser: +e.altUser.toFixed(3), altFloor: +e.altFloor.toFixed(3),
        sp: +Math.hypot(e.vE, e.vN).toFixed(2), bearing: +e.bearing.toFixed(1),
        roofR: +F.roofAt(e.lng, e.lat, c.rCam).toFixed(2),
        roof6: +F.roofAt(e.lng, e.lat, 6).toFixed(2),
        roof1: +F.roofAt(e.lng, e.lat, 1).toFixed(2),
        trunk: !!F.trunkAt(e.lng, e.lat, e.alt),
        mix: +c.groundMix.toFixed(3), rCam: +c.rCam.toFixed(2),
        skinV: +c.skinV.toFixed(2), stepUp: +c.stepUp.toFixed(2),
        altFloorMin: +c.altFloorMin.toFixed(3),
      };
    };

    series.push(row());
    key('KeyW', true, W.sprint);
    const cap = W.maxSeconds * 1000;
    while (series[series.length - 1].m < W.metres && performance.now() - t0 < cap) {
      await new Promise(r => requestAnimationFrame(r));
      series.push(row());
    }
    key('KeyW', false, false);

    return { series, consts: F.consts(), trunkField: F.trunkField() };
  }, { S, W: WALK });

  await page.close();
  return out;
}

// ── attribution ─────────────────────────────────────────────────────────────
// Each candidate is the arithmetic straight out of js/controls.js. A row is
// attributed to whichever candidates reproduce its altitude to EPS; if more
// than one does, they are all printed, because claiming one of two mechanisms
// that predict the same number is exactly the kind of confident wrong answer
// this file exists to avoid.
const EPS = 0.06;
const HARD_CLEAR = 4;   // controls.js:162 — echoed from consts() at runtime below

function attribute(r, C) {
  const hits = [];
  const near = (a, b) => Math.abs(a - b) <= EPS;
  if (r.roofR > 0 && near(r.alt, r.roofR + C.HARD_CLEAR)) hits.push(`hard net (roof ${r.roofR} + HARD_CLEAR ${C.HARD_CLEAR})`);
  if (r.roofR > 0 && near(r.alt, r.roofR + r.skinV))      hits.push(`rooftop floor / step-up (roof ${r.roofR} + skinV ${r.skinV})`);
  if (r.roof6 > 0 && near(r.alt, r.roof6 + C.HARD_CLEAR)) hits.push(`hard net at r=6 (roof6 ${r.roof6} + 4)`);
  if (near(r.alt, r.altFloorMin) && r.altFloorMin > C.ALT_MIN + EPS) hits.push(`pitch floor (dMin*cos(pitch) = ${r.altFloorMin})`);
  if (near(r.alt, r.altFloor)) hits.push(`altFloor state = ${r.altFloor}`);
  if (near(r.alt, C.ALT_MIN)) hits.push('ALT_MIN');
  return hits;
}

const H = ['t', 'm', 'alt', 'altUser', 'altFloor', 'sp', 'roofR', 'roof6', 'mix', 'rCam', 'skinV', 'stepUp'];
const fmt = r => H.map(k => String(r[k]).padStart(k === 't' || k === 'm' ? 7 : 8)).join(' ');

(async () => {
  const browser = await launch(chromium, { gl: 'hardware' });
  console.log('walk-lift — why a scripted walk leaves walking height (QUEUE Y16)');
  console.log(`  ${BASE}  |  headless, gl=hardware, no cpu throttle, index.html?intro=0`);
  console.log(`  hold W${WALK.sprint ? '+Shift' : ''} from ${WALK.alt} m, pitch ${WALK.pitch}, until ${WALK.metres} m or ${WALK.maxSeconds} s`);
  console.log('');

  let anyLift = false;
  for (const site of sites) {
    const S = SITES[site];
    const { series, consts, trunkField } = await trace(browser, site);
    const C = consts;
    const last = series[series.length - 1];
    console.log(`── ${site}  (${S.note})  bearing ${S.bearing}`);
    console.log(`   ${series.length} frames, ${last.m} m travelled, ended at ${last.alt} m`);
    console.log(`   ALT_MIN ${C.ALT_MIN}  ALT_GROUND ${C.ALT_GROUND}  TRUNK_ALT ${C.TRUNK_ALT}  HARD_CLEAR ${C.HARD_CLEAR}  SKIN ${C.SKIN}`);
    console.log('');
    console.log('   ' + H.map(k => k.padStart(k === 't' || k === 'm' ? 7 : 8)).join(' '));

    // Print every frame up to the first departure, then every frame whose
    // altitude moved by more than 1 cm, then the last three. A compressed trace
    // that drops the moment of departure would be the same mistake as a summary.
    const liftAt = series.findIndex(r => r.alt > C.ALT_MIN + 0.05);
    const keep = new Set();
    for (let i = 0; i < series.length; i++) {
      if (i < 6) keep.add(i);
      if (liftAt >= 0 && Math.abs(i - liftAt) <= 6) keep.add(i);
      if (i > 0 && Math.abs(series[i].alt - series[i - 1].alt) > 0.01) { keep.add(i); keep.add(i - 1); }
      if (i >= series.length - 3) keep.add(i);
    }
    let prev = -1;
    for (const i of [...keep].sort((a, b) => a - b)) {
      if (prev >= 0 && i > prev + 1) console.log(`   ${'...'.padStart(7)}  (${i - prev - 1} frames)`);
      console.log(`   ${fmt(series[i])}${i === liftAt ? '   <<< FIRST DEPARTURE' : ''}`);
      prev = i;
    }
    console.log('');

    if (liftAt < 0) {
      console.log(`   NO LIFT. alt stayed within 0.05 m of ALT_MIN for all ${series.length} frames.`);
      console.log(`   The walk ${last.m >= WALK.metres ? 'completed' : 'was STOPPED BY GEOMETRY'} at ${last.m} m.`);
    } else {
      anyLift = true;
      const r = series[liftAt], p = series[liftAt - 1] || r;
      console.log(`   FIRST DEPARTURE at t=${r.t}s, ${r.m} m: ${p.alt} -> ${r.alt} m`);
      console.log(`     probes at that frame: roofAt(r=${r.rCam})=${r.roofR}  roofAt(6)=${r.roof6}  roofAt(1)=${r.roof1}  trunk=${r.trunk}`);
      const a0 = attribute(r, C);
      console.log(`     attribution: ${a0.length ? a0.join(' | ') : 'NONE of the four candidates reproduces this altitude'}`);
      const aN = attribute(last, C);
      console.log(`   FINAL altitude ${last.alt} m at ${last.m} m travelled`);
      console.log(`     probes: roofAt(r=${last.rCam})=${last.roofR}  roofAt(6)=${last.roof6}  trunk=${last.trunk}`);
      console.log(`     attribution: ${aN.length ? aN.join(' | ') : 'NONE of the four candidates reproduces this altitude'}`);
      const above = series.filter(r2 => r2.alt >= C.TRUNK_ALT).length;
      console.log(`   ${above} of ${series.length} frames (${(100 * above / series.length).toFixed(0)} %) were at or above TRUNK_ALT ${C.TRUNK_ALT} — the trunk field is OFF for those.`);
    }
    console.log(`   trunk field at end: ${trunkField.trunks} trunks, ${trunkField.scans} scans, max ${trunkField.maxMs} ms`);
    console.log('');
  }

  console.log(anyLift
    ? 'A held-W walk left walking height. The mechanism is named above, per frame.'
    : 'No held-W walk left walking height in this run.');
  await browser.__done();
})();
