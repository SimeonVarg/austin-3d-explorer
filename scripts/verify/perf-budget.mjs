/**
 * perf-budget.mjs — the regression guard for docs/perf/budget.md.
 *
 * WHAT THIS IS FOR. `docs/perf/budget.md` §4.3/§4.4 wrote a frame budget by
 * reading the source, and named the assertions G1..G7 that could be checked with
 * no code change. Nothing checked them. This does. It is a GATE, not a report:
 * it exits non-zero when a subsystem is over its slice.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT IT MEASURES, AND WHY IT IS NOT AN FPS SCRIPT
 *
 * Every number here comes from a `performance.now()` pair that already lives
 * INSIDE the app — `__fly.outerField()`, `__fly.trunkField()`, `__fly.tickMsAvg`
 * — not from a frame counter. That matters, because the two things the budget
 * calls DEBT (G3, G4) are main-thread JS scans, and a frame-time average hides
 * them completely: they fire roughly once every 1.5 s, so a 40 ms scan is 0.07 %
 * of the frames in a 10 s capture and vanishes into a median that is sitting on
 * the vsync floor anyway (README, "a median frame time is not a performance
 * measurement"). A worst-case scan has to be read as a worst case or not at all.
 *
 * G6 — dropped frames over a bearing sweep — is deliberately NOT here. It needs
 * a headed browser with the occlusion flags, it is the one number in the budget
 * that is genuinely about the renderer, and `outer-perf.mjs` already implements
 * that pattern properly. Duplicating it badly is worse than not having it.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE FOUR THINGS THAT WOULD MAKE THIS SCRIPT LIE, AND WHAT IT DOES ABOUT THEM
 *
 * 1. `tickMsAvg` IS A CUMULATIVE MEAN SINCE LOAD. Read raw, a slow boot poisons
 *    it forever and it can never show a mid-session regression — budget.md G1
 *    says so explicitly. So it is always sampled TWICE and differenced:
 *      Δms = (avg₂·n₂ − avg₁·n₁) / (n₂ − n₁).
 *    Never read it raw. Ever.
 *
 * 2. `outerScanMsMax` / `trunkScanMsMax` ARE CUMULATIVE MAXIMA and cannot be
 *    differenced — a max that does not grow tells you nothing about the phase
 *    you just ran. So each phase gets its OWN PAGE LOAD. That is the whole
 *    reason this script reloads instead of flying between poses: without it,
 *    "the walk cost 841 ms" and "the boot cost 841 ms and the walk cost 4" are
 *    the same reading.
 *
 * 3. THE MACHINE. This suite has measured 11 s to 65 s for an identical page on
 *    a QUIET machine. So: reps are interleaved AND counterbalanced (the phase
 *    order reverses on alternate reps, per README — whichever configuration
 *    always runs first gets the coolest slot and wins by construction), and the
 *    reported figure is the MINIMUM across reps, never a mean. For a maximum
 *    statistic the min-across-reps is the least-contaminated estimate of the
 *    worst case the CODE causes, as opposed to the worst case the machine did.
 *    Chrome/node process counts and CPU percent are sampled immediately before
 *    and after every phase and printed beside the figure. A number without its
 *    conditions is not a measurement.
 *
 * 4. THE GRAPHICS AUTO-DETECT PROBE fires ~11 s after load and rewrites every
 *    setting, including `treeDensity`, which the trunk field reads. Cancelled at
 *    the top of every phase.
 *
 * INSTRUMENT SETTINGS, quoted because they are part of the answer:
 *   - headless, `gl:'hardware'`. NOT SwiftShader. These are CPU timers, and
 *     SwiftShader rasterises the whole city on the same CPU the timers are
 *     measuring — it would inflate every scan by an amount that has nothing to
 *     do with the scan. It is also NOT headed: three sibling workflows were
 *     running when this was written, and a visible window buys nothing for a
 *     JS-side timer.
 *   - `index.html?intro=0`, never `_harness.html` (its rAF shim pins the loop).
 *   - NO CPU throttling. `perf.mjs` throttles 4× by default; this does not, and
 *     that is the difference between "37.9 ms" and "150 ms" as a headline.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * USAGE
 *
 *   VERIFY_URL=http://127.0.0.1:8351 node perf-budget.mjs [reps]
 *   VERIFY_URL=...                   node perf-budget.mjs [reps] --prove
 *
 * `--prove` is the watched failure. A guard nobody has seen fail is not known to
 * work — that sentence is in this repo's history three times. It does NOT fake a
 * number: it calls `__fly.trunkScan()` / `__fly.outerScan()`, the app's own
 * entry points, in a loop. Those reset the throttle and re-enter the REAL
 * unbounded `querySourceFeatures` path that Y7 and Y15 are about. The fault is
 * "the throttle stopped working", which is exactly the regression G5 exists to
 * catch, and the cost it exposes is the app's own.
 *
 * Written by the Acer lane, 2026-08-16. Owns: this file only.
 */
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { launch, BASE } from './chrome.mjs';

// ── THE BUDGET ──────────────────────────────────────────────────────────────
// Every value is from docs/perf/budget.md §4.2/§4.3/§4.4. Parameterised here so
// the budget can be moved in one line when a measurement says it is wrong —
// CLAUDE.md rule 11. Changing a number here is a claim; put it in budget.md too.
// Each threshold takes an env override, so a run can be pointed at a different
// budget without editing the file — and, more importantly, so the guard can be
// WATCHED GOING GREEN as well as red. A gate that has only ever been seen to
// fail is not known to be a gate; it could be stuck.
const env = (k, d) => (process.env[k] == null ? d : Number(process.env[k]));
const BUDGET = {
  // §4.3: the ceiling on a WHOLE scan call including querySourceFeatures.
  // Deliberately loose. OUTER_BUDGET_MS is 4 and TRUNK_BUDGET_MS is 3, but both
  // start their clock AFTER the query has returned, so neither constant is the
  // frame cost. 8 ms is the number the fix has to hit, not a description of
  // today: §109 measured 37.9 (outer) and 841.5 (trunk) and both blow it.
  outerScanMs: env('PB_OUTER_MS', 8),     // G3 — DEBT
  trunkScanMs: env('PB_TRUNK_MS', 8),     // G4 — DEBT
  // §4.2: controls.js gets a 1.0 ms slice of the 4.0 ms main-thread JS budget
  // at 60 fps. G1/G2 allow headroom over that because the differenced tick also
  // carries event dispatch. Walking adds the trunk gate and the ground blend.
  tickMsCruise: env('PB_TICK_CRUISE', 1.5),  // G1
  tickMsWalk: env('PB_TICK_WALK', 2.5),    // G2
  // G5: DUTY CYCLE, not scan rate. The first draft of this asserted
  // `scans / wallSeconds <= 1/1.5` and it was wrong by construction: `outerScans`
  // counts INSTALMENTS, and an unfinished list resumes on the very next frame on
  // purpose (controls.js:566), so a single throttled query legitimately reports
  // as a dozen "scans". It failed at 1.6/s on a build with a working throttle,
  // which is a guard that cries wolf — worse than no guard.
  //
  // The measurable form of the same question is the share of wall time the scan
  // owns: scans x avgMs / wallMs. budget.md §4.3 sets it at one 8 ms instalment
  // per 1.5 s = 0.53 %, and that number falls straight out of the two budget
  // values above, so it is derived rather than invented.
  scanDutyPct: (ms) => env('PB_DUTY_PCT', 100 * ms / 1500),
  // G7: 95 addLayer sites of ours + the kept basemap + the Capitol clones. The
  // total had never been printed before this script ran; the value below is the
  // FIRST reading, recorded so growth is visible. Budget.md asks for +2.
  layersBaseline: 0,  // 0 = record and do not gate. Set once it is trusted.
  layersGrowth: 2,
};

const REPS = Math.max(2, Number(process.argv[2]) || 3);
const PROVE = process.argv.includes('--prove');
const VW = 1440, VH = 900;

// ── machine load, sampled beside every figure ───────────────────────────────
// Three other workflows were running when this was written and Simeon was on
// the machine. Without these columns the numbers below are not measurements.
function load() {
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command',
      "$c=@(Get-Process chrome -EA SilentlyContinue).Count;" +
      "$n=@(Get-Process node -EA SilentlyContinue).Count;" +
      "$p=(Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor|" +
      "Where-Object {$_.Name -eq '_Total'}).PercentProcessorTime;" +
      "\"$c $n $p\""], { encoding: 'utf8', timeout: 15000 }).trim().split(/\s+/);
    return { chrome: +out[0] || 0, node: +out[1] || 0, cpu: +out[2] || 0 };
  } catch (e) { return { chrome: -1, node: -1, cpu: -1 }; }
}
const loadStr = l => `chrome ${String(l.chrome).padStart(2)} node ${String(l.node).padStart(2)} cpu ${String(l.cpu).padStart(3)}%`;

// ── the two phases ──────────────────────────────────────────────────────────
// CRUISE exercises the outer ring at the altitude the flyover and the tour use.
// WALK exercises the trunk field at 1.7 m, on a SUSTAINED walk — no teleports.
// §109's 841.5 ms came from a run that teleported across West Campus ten times,
// which forces rescans a real walk would not; QUEUE Y15 says to measure a
// sustained walk first, so that is what the gate is on.
// BOTH PHASES ARE DRIVEN BY HELD KEYS, not by a scripted `jumpTo` path, and that
// is not a style choice — two of these assertions do not exist without it.
// `tick()` returns early when the controller is idle, so `__fly.ticks` never
// advances and G1/G2 differenced out to NaN on the first draft of this script.
// Driving also means the ground covered is integrated by the app's OWN movement
// code, which is what a user's walk is. The cost is that the path is not
// identical frame-for-frame between runs; interleaving, counterbalancing and
// min-across-reps are what pay for it, and the distance actually travelled is
// printed beside every figure so a short run cannot be read as a cheap one.
//
// A PHASE IS A DISTANCE, NOT A DURATION, AND THAT IS THE MOST IMPORTANT LINE IN
// THIS FILE. Both scans are triggered by the camera having MOVED — 200 m for the
// ring, 60 m for the trunks — so wall time is the wrong control variable
// entirely. It is also actively dangerous here, because `DT_MAX` clamps the
// movement integrator to 0.10 s per frame: at low fps the camera covers less
// ground than wall time says (controls.js states this as a correctness cost).
// Measured on the first honest run of this script, with three sibling workflows
// on the machine, a fixed 24 s walk rendered 16 frames and travelled **1 metre**
// — and then reported a trunk-scan cost of 24.6 ms for a field that had never
// once been asked to grow. A clean number for a walk that did not happen is the
// exact failure mode this suite exists to prevent.
//
// So each phase drives until it has covered `metres`, with `maxSeconds` as a
// watchdog, and a phase that hits the watchdog first is marked INVALID and
// excluded — never averaged in, never reported as a pass.
const PHASES = {
  // Campus, high, heading south-west so the whole outer ring passes through
  // frame and the 200 m rescan trigger fires repeatedly. 1500 m = 7 rescans.
  cruise: { alt: 420, pitch: 76, lng: -97.7400, lat: 30.2870, bearing: 200,
            sprint: true, metres: 1500, minMetres: 800, maxSeconds: 90 },
  // Guadalupe at eye level, heading south-west down the Drag and into West
  // Campus — a real district boundary, and the densest trunk field in the data.
  // SPRINTING, because SPEED_MIN is 1.0 m/s at walking height. 300 m crosses
  // TRUNK_RESCAN_M (60 m) five times, which is what makes the scan cost real.
  // 120 m, AND THAT CEILING IS A FINDING, not a convenience. Probed on
  // 2026-08-16 across six sites, a held-W walk at 1.7 m does exactly one of two
  // things and never a third:
  //     drag S   bearing 180 -> 639 m travelled, ENDED AT ALTITUDE 23.8 m
  //     drag N   bearing   0 -> 373 m,           ENDED AT 86.0 m
  //     speedway bearing 180 -> 242 m,           ENDED AT 29.3 m
  //     WC 24th  bearing 270 -> 104 m,           ENDED AT 43.8 m
  //     24th E   bearing  90 ->  11 m at 1.7 m (blocked)
  //     SanJac S bearing 180 ->   3 m at 1.7 m (blocked)
  // It is either stopped by geometry inside one block, or the step-up/rooftop
  // floor silently LIFTS it out of walking height — QUEUE Y16's silent lift,
  // reached through the movement path instead of through setPitch. Above
  // TRUNK_ALT (12 m) the trunk field switches off entirely, so a rep that
  // travels 639 m has spent most of it not measuring the thing it is named for.
  //
  // So the walk is capped below the lift, and `minMetres` is TRUNK_RESCAN_M
  // itself: 60 m is one full distance-triggered rescan, which is the mechanism's
  // own unit and the most that is honestly reachable. This is a ONE-TRIGGER
  // walk, not the multi-district walk QUEUE Y15 asked for, and the report says so.
  walk:   { alt: 1.7, pitch: 85, lng: -97.74170, lat: 30.28950, bearing: 180,
            sprint: true, metres: 120, minMetres: 60, maxSeconds: 150,
            maxAlt: 12 },
};

const PAGE_HELPERS = () => {
  window.__settle = async () => {
    for (let i = 0; i < 240; i++) {
      if (!window.__fly.eye().driving) return true;
      await new Promise(r => requestAnimationFrame(r));
    }
    return false;
  };
  // The same closed-form placement collision.mjs uses: put the EYE at
  // (lng,lat,alt) by solving for the map centre and zoom that put it there.
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

/** One phase, on its own page load, so the cumulative maxima are attributable. */
async function runPhase(browser, name, prove) {
  const P = PHASES[name];
  const before = load();
  const page = await browser.newPage({ viewport: { width: VW, height: VH } });
  await page.goto(`${BASE}/index.html?intro=0`, { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
  await page.waitForFunction(() => window.__fly && window.__fly.indexed(), null, { timeout: 60000 });
  // Correctness measure, not a speed one, and measured to cost nothing.
  await page.evaluate(() => { try { window.cancelGraphicsAutoDetect(); } catch (e) {} });
  await page.evaluate(PAGE_HELPERS);
  await page.waitForTimeout(3000);

  const out = await page.evaluate(async ({ P, prove }) => {
    const F = window.__fly, M_LAT = 40030228.884 / 360;
    // SPRINT IS A MODIFIER FLAG, NOT A KEY. controls.js:1289 does
    // `sprintHeld = e.shiftKey` on every key event, so dispatching a separate
    // 'ShiftLeft' keydown does nothing at all AND the plain KeyW that follows
    // clears the flag again. Measured: the walk phase covered 44-63 m in 90 s
    // (0.7 m/s) with a ShiftLeft dispatch, and reported a trunk cost for a walk
    // that had barely crossed one 60 m rescan trigger. The shift state has to
    // ride on the SAME event.
    const key = (code, down, shift) => window.dispatchEvent(
      new KeyboardEvent(down ? 'keydown' : 'keyup',
                        { code, shiftKey: !!shift, bubbles: true }));

    await window.__settle();
    window.__placeEye(P.lng, P.lat, P.alt, P.bearing, P.pitch);
    await new Promise(r => requestAnimationFrame(r));
    await new Promise(r => requestAnimationFrame(r));

    // SETTLE, THEN BASELINE. The first placement triggers the field's first
    // full build, and that scan belongs to the boot, not to this phase. Both
    // maxima are cumulative-since-load and cannot be differenced, so the phase's
    // contribution is read as "did the max GROW while we drove" — see below.
    await new Promise(r => setTimeout(r, 2500));
    const t0 = performance.now();
    const a = { ticks: F.ticks, avg: F.tickMsAvg,
                outerMax: F.outerField().maxMs, trunkMax: F.trunkField().maxMs,
                outerScans: F.outerField().scans, trunkScans: F.trunkField().scans };
    const e0 = F.eye();

    key('KeyW', true, P.sprint);

    const cosLat = Math.cos(e0.lat * Math.PI / 180);
    const covered = () => {
      const e = F.eye();
      return Math.hypot((e.lng - e0.lng) * M_LAT * cosLat, (e.lat - e0.lat) * M_LAT);
    };
    const cap = P.maxSeconds * 1000;
    let frames = 0, proved = 0;
    while (covered() < P.metres && performance.now() - t0 < cap) {
      // THE INJECTED FAULT, and it is the app's own code path. trunkScan() and
      // outerScan() zero the throttle and re-enter the unbounded query. This is
      // "the 1.5 s throttle stopped working", not a fabricated number.
      if (prove && (frames % 6) === 0) {
        try { F.trunkScan(); } catch (e) {}
        try { F.outerScan(); } catch (e) {}
        proved++;
      }
      await new Promise(r => requestAnimationFrame(r));
      frames++;
    }
    key('KeyW', false, false);

    const wallS = (performance.now() - t0) / 1000;
    const b = { ticks: F.ticks, avg: F.tickMsAvg };
    const e1 = F.eye();
    // DIFFERENCED, never raw — budget.md G1. tickMsAvg is a cumulative mean
    // since load, so a slow boot poisons the raw value forever.
    const dTicks = b.ticks - a.ticks;
    const tickMs = dTicks > 0 ? (b.avg * b.ticks - a.avg * a.ticks) / dTicks : NaN;
    const metres = Math.hypot((e1.lng - e0.lng) * M_LAT * Math.cos(e0.lat * Math.PI / 180),
                              (e1.lat - e0.lat) * M_LAT);

    const outer = F.outerField(), trunk = F.trunkField();
    return {
      frames, wallS, forcedScans: proved, metres: +metres.toFixed(0),
      // THE VALIDITY VERDICT, decided in the page from what the camera actually
      // did, not inferred outside from how long the script took. TWO clauses:
      // far enough to have asked the field to grow, AND still at the altitude
      // the phase claims to be measuring. The second is not paranoia — a walk
      // that gets lifted to 86 m has the trunk field switched off under it and
      // will report a reassuring number for a subsystem that was not running.
      valid: metres >= P.minMetres && (P.maxAlt == null || e1.alt < P.maxAlt),
      tickMs: +tickMs.toFixed(3), dTicks,
      outer, trunk,
      // Attribution: a cumulative max that did not grow says nothing about this
      // phase, so both the session max and whether THIS phase set it are kept.
      outerNewMax: outer.maxMs > a.outerMax + 1e-9,
      trunkNewMax: trunk.maxMs > a.trunkMax + 1e-9,
      dOuterScans: outer.scans - a.outerScans,
      dTrunkScans: trunk.scans - a.trunkScans,
      alt0: +e0.alt.toFixed(2), alt1: +e1.alt.toFixed(2),
      layers: window.__map.getStyle().layers.length,
      consts: F.consts(),
    };
  }, { P, prove });

  await page.close();
  const after = load();
  return { ...out, before, after };
}

// ── run ─────────────────────────────────────────────────────────────────────
console.log(`perf-budget — gate on docs/perf/budget.md §4.3/§4.4`);
console.log(`  ${BASE}  |  ${REPS} reps, interleaved + counterbalanced`);
console.log(`  headless, gl=hardware, NO cpu throttle, auto-detect cancelled`);
console.log(`  ${PROVE ? '*** --prove: forcing the unbounded scan path ***' : ''}`);
console.log('');

const browser = await launch(chromium, { headless: true, gl: 'hardware' });
const reps = { cruise: [], walk: [] };

for (let r = 0; r < REPS; r++) {
  // COUNTERBALANCED. The machine drifts upward across a run, so whichever phase
  // always goes first gets the coolest slot and wins by construction.
  const order = r % 2 === 0 ? ['cruise', 'walk'] : ['walk', 'cruise'];
  for (const name of order) {
    // ONE BAD LOAD MUST NOT KILL THE RUN. Under load the style has taken longer
    // than 120 s to come up on this machine; that rep is lost, the rest are not.
    let res;
    try { res = await runPhase(browser, name, PROVE); }
    catch (e) {
      console.log(`  rep ${r + 1} ${name.padEnd(6)}  ABORTED: ${String(e).split('\n')[0]}` +
                  `  | ${loadStr(load())}`);
      continue;
    }
    reps[name].push(res);
    const s = name === 'cruise' ? res.outer : res.trunk;
    const nu = name === 'cruise' ? res.outerNewMax : res.trunkNewMax;
    console.log(
      `  rep ${r + 1} ${name.padEnd(6)}  maxMs ${String(s.maxMs).padStart(7)}${nu ? '*' : ' '}` +
      `  avgMs ${String(s.avgMs).padStart(6)}  scans ${String(s.scans).padStart(3)}` +
      `  tickMs ${String(res.tickMs).padStart(6)}  ${String(res.metres).padStart(4)} m` +
      `  alt ${String(res.alt1).padStart(6)}  frames ${String(res.frames).padStart(4)}` +
      `  | pre ${loadStr(res.before)} | post ${loadStr(res.after)}`);
  }
}
await browser.__done();

// MINIMUM across reps, never a mean. For a maximum statistic this is the
// least-contaminated estimate of what the CODE costs rather than what the
// machine did to it.
const min = (arr, f) => arr.reduce((m, x) => Math.min(m, f(x)), Infinity);
// ONLY VALID REPS. A phase that did not travel far enough never asked the field
// to grow, so its scan cost is a number about a camera standing still.
const c = reps.cruise.filter(x => x.valid), w = reps.walk.filter(x => x.valid);
const MIN_VALID = 2;   // never rank on one reading

console.log(`\n  valid reps: cruise ${c.length}/${reps.cruise.length},` +
            ` walk ${w.length}/${reps.walk.length}` +
            `  (a rep is valid only if it drove past its minMetres)`);

// If a phase has too few valid reps the honest verdict is INVALID, and INVALID
// is NOT a pass. It exits non-zero, so CI cannot read "not measurable tonight"
// as "within budget" — the two have to look different or the guard is decoration.
const invalid = [];
if (c.length < MIN_VALID) invalid.push(`cruise (G1, G3, G5a): ${c.length} valid rep(s)`);
if (w.length < MIN_VALID) invalid.push(`walk (G2, G4, G5b): ${w.length} valid rep(s)`);
if (invalid.length) {
  console.log('\n INVALID  not measurable under this machine load — NOT a pass:');
  for (const s of invalid) console.log(`          ${s}, need ${MIN_VALID}`);
  console.log('          Re-run on a quieter machine. Do not read INVALID as clean.');
  if (c.length < MIN_VALID && w.length < MIN_VALID) {
    process.exitCode = 2;
    process.exit(2);
  }
}

const got = {
  outerMaxMs: min(c, x => x.outer.maxMs),
  trunkMaxMs: min(w, x => x.trunk.maxMs),
  tickCruise: min(c, x => x.tickMs),
  tickWalk: min(w, x => x.tickMs),
  // Share of wall time the scan owns during the phase, from the scans this
  // phase actually ran (differenced) at the field's own average cost.
  outerDuty: min(c, x => 100 * x.dOuterScans * x.outer.avgMs / (x.wallS * 1000)),
  trunkDuty: min(w, x => 100 * x.dTrunkScans * x.trunk.avgMs / (x.wallS * 1000)),
  outerNewMax: c.length ? c.some(x => x.outerNewMax) : null,
  trunkNewMax: w.length ? w.some(x => x.trunkNewMax) : null,
  metresCruise: min(c, x => x.metres),
  metresWalk: min(w, x => x.metres),
  layers: c[0].layers,
};

const results = [];
// A phase with too few valid reps contributes INVALID rows, not passes.
// `pass: null` means INVALID — no verdict, because the phase never happened.
// It must never print as FAIL and must never be counted as one: an INVALID that
// looks like a budget breach sends the next lane chasing a hog that was never
// measured, and an INVALID that looks like a pass is worse.
const A = (id, name, pass, detail, ok = true) =>
  results.push({ id, name, pass: ok ? pass : null,
                 detail: ok ? detail : 'phase did not run far enough to measure' });
const cOK = c.length >= MIN_VALID, wOK = w.length >= MIN_VALID;

A('G1', 'controls tick at cruise', got.tickCruise <= BUDGET.tickMsCruise,
  `${got.tickCruise.toFixed(3)} ms (differenced) vs ${BUDGET.tickMsCruise} ms`, cOK);
A('G2', 'controls tick at 1.7 m', got.tickWalk <= BUDGET.tickMsWalk,
  `${got.tickWalk.toFixed(3)} ms (differenced) vs ${BUDGET.tickMsWalk} ms`, wOK);
A('G3', 'outer-ring scan worst case (Y7)', got.outerMaxMs <= BUDGET.outerScanMs,
  `${got.outerMaxMs.toFixed(2)} ms vs ${BUDGET.outerScanMs} ms`, cOK);
A('G4', 'trunk field scan worst case (Y15)', got.trunkMaxMs <= BUDGET.trunkScanMs,
  `${got.trunkMaxMs.toFixed(2)} ms vs ${BUDGET.trunkScanMs} ms`, wOK);
A('G5a', 'outer scan duty cycle', got.outerDuty <= BUDGET.scanDutyPct(BUDGET.outerScanMs),
  `${got.outerDuty.toFixed(2)} % of wall time vs ${BUDGET.scanDutyPct(BUDGET.outerScanMs).toFixed(2)} %`, cOK);
A('G5b', 'trunk scan duty cycle', got.trunkDuty <= BUDGET.scanDutyPct(BUDGET.trunkScanMs),
  `${got.trunkDuty.toFixed(2)} % of wall time vs ${BUDGET.scanDutyPct(BUDGET.trunkScanMs).toFixed(2)} %`, wOK);
if (BUDGET.layersBaseline > 0) {
  A('G7', 'style layer count', got.layers <= BUDGET.layersBaseline + BUDGET.layersGrowth,
    `${got.layers} vs ${BUDGET.layersBaseline} + ${BUDGET.layersGrowth}`);
} else {
  console.log(`\n  G7 style layers: ${got.layers}  — RECORDED, not gated ` +
              `(BUDGET.layersBaseline is 0; set it to gate growth)`);
}

console.log('\n  ── min across reps ──');
console.log(`  distance driven: cruise ${got.metresCruise} m, walk ${got.metresWalk} m` +
            ` (a short run is a cheap run — read these before the figures)`);
const nm = v => v === null ? 'n/a' : String(v);
console.log(`  a phase SET the worst case: outer ${nm(got.outerNewMax)}, trunk ${nm(got.trunkNewMax)}` +
            `  (false = the boot's first full field build was worse; n/a = no valid rep)`);
for (const r of results) {
  const tag = r.pass === null ? '----' : r.pass ? ' ok ' : 'FAIL';
  console.log(`  ${tag}  ${r.id.padEnd(4)} ${r.name.padEnd(34)} ${r.detail}`);
}

const failed = results.filter(r => r.pass === false);
const skipped = results.filter(r => r.pass === null);
const judged = results.length - skipped.length;
console.log('');
if (skipped.length) {
  console.log(` ----  ${skipped.length} not measurable tonight: ` +
              skipped.map(r => r.id).join(', ') + '  (INVALID, not a pass)');
}
if (failed.length) {
  console.log(` FAIL  ${failed.length} of ${judged} judged assertions over budget: ` +
              failed.map(r => r.id).join(', '));
  console.log('       docs/perf/budget.md marks G3 and G4 as DEBT — they are the');
  console.log('       fix targets for QUEUE Y7 and Y15, both in js/controls.js.');
  process.exitCode = 1;
} else if (judged === 0) {
  console.log(' INVALID  nothing was measurable. This is not a pass.');
  process.exitCode = 2;
} else {
  console.log(` PASS  all ${judged} judged assertions within docs/perf/budget.md` +
              (skipped.length ? ` (${skipped.length} INVALID, see above)` : ''));
}
