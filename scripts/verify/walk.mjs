/**
 * walk.mjs — THE GATE ON THE HARNESS'S OWN ABILITY TO WALK (QUEUE Y16).
 *
 * The claim being gated: a scripted walk stays at walking height for EVERY
 * FRAME of the walk, not merely at its endpoint. Three passes have reported a
 * walk that never happened; the endpoint is the number that hid it.
 *
 * WHAT IT RUNS
 *   1. Three walks at named sites, steered, each printing the altitude series
 *      read back from `__fly.eye().alt` frame by frame. PASS requires
 *      `framesAboveCeiling === 0` and at least `MIN_M` metres covered.
 *   2. THE WATCHED FAILURE, and it is not synthetic: the same walker pointed at
 *      `perf-budget.mjs`'s hard-coded start with `noFind: true`, i.e. exactly
 *      what the suite did before tonight. It MUST come back lifted. A guard
 *      nobody has seen fail is not known to work — that sentence is in this
 *      repo's history four times, and every one of those four was a guard that
 *      passed because it could not see the thing it guarded.
 *
 * So the gate is watched in both directions inside one run, on the same code,
 * with the only difference being whether the start is checked for clearance.
 *
 * USAGE
 *   VERIFY_URL=http://127.0.0.1:8441 node walk.mjs [reps] [--quiet]
 *
 * INSTRUMENT: headless, `gl:'hardware'` (this is a CPU-side integrator; see
 * chrome.mjs), NO cpu throttle, `index.html?intro=0`, auto-detect cancelled,
 * one page load per walk so nothing cumulative leaks between them.
 *
 * Written by the Acer lane, 2026-08-16. Owns: this file only.
 */
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { launch, BASE } from './chrome.mjs';
import { installWalker } from './lib/walker.mjs';

const VW = 1440, VH = 900;
const QUIET = process.argv.includes('--quiet');
const REPS = Math.max(1, Number(process.argv.find(a => /^\d+$/.test(a))) || 1);

// Every threshold parameterised (CLAUDE.md rule 11).
const CEILING = Number(process.env.WALK_CEILING || 12);   // TRUNK_ALT
const MIN_M = Number(process.env.WALK_MIN_M || 120);      // 2x TRUNK_RESCAN_M
const TARGET_M = Number(process.env.WALK_M || 300);
const SECS = Number(process.env.WALK_SECONDS || 110);   // watchdog only; the phase is a DISTANCE

const SITES = [
  { id: 'drag',     lng: -97.74170, lat: 30.28950, bearing: 180, note: 'Guadalupe / the Drag, walking south' },
  { id: 'southmall',lng: -97.73940, lat: 30.28560, bearing: 90,  note: 'South Mall, walking east' },
  { id: 'wcampus',  lng: -97.74450, lat: 30.28680, bearing: 180, note: 'West Campus, walking south' },
];

function load() {
  try {
    const o = execFileSync('powershell', ['-NoProfile', '-Command',
      "$c=@(Get-Process chrome -EA SilentlyContinue).Count;" +
      "$n=@(Get-Process node -EA SilentlyContinue).Count;" +
      "$p=(Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor|" +
      "Where-Object {$_.Name -eq '_Total'}).PercentProcessorTime;\"$c $n $p\""],
      { encoding: 'utf8', timeout: 30000 }).trim().split(/\s+/);
    return `chrome ${o[0]} node ${o[1]} cpu ${o[2]}%`;
  } catch (e) { return 'load unknown'; }
}

async function walkOnce(browser, opts) {
  const page = await browser.newPage({ viewport: { width: VW, height: VH } });
  await page.goto(`${BASE}/index.html?intro=0`, { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
  await page.waitForFunction(() => window.__fly && window.__fly.indexed(), null, { timeout: 60000 });
  await page.evaluate(() => { try { window.cancelGraphicsAutoDetect(); } catch (e) {} });
  await page.evaluate(installWalker);
  await page.waitForTimeout(3000);
  const r = await page.evaluate(o => window.__walker.walk(o), opts);
  const extra = await page.evaluate(() => ({ trunk: window.__fly.trunkField(), consts: window.__fly.consts() }));
  await page.close();
  return { ...r, ...extra };
}

/** Print the series so a reader can see the walk, not a summary of it. */
function printSeries(r, ceiling) {
  if (!r.series || !r.series.length) return;
  const H = ['t', 'path', 'm', 'alt', 'altFloor', 'sp', 'bearing', 'roof'];
  const keep = new Set();
  const n = r.series.length;
  const worst = r.series.reduce((a, b, i) => (b.alt > r.series[a].alt ? i : a), 0);
  for (let i = 0; i < n; i++) {
    if (i < 3 || i >= n - 2) keep.add(i);
    if (Math.abs(i - worst) <= 2) keep.add(i);
    if (i > 0 && Math.abs(r.series[i].alt - r.series[i - 1].alt) > 0.02) { keep.add(i); keep.add(i - 1); }
    if (r.series[i].alt >= ceiling) keep.add(i);
    if (!QUIET && i % Math.max(1, Math.round(n / 14)) === 0) keep.add(i);
  }
  console.log('      ' + H.map(k => k.padStart(9)).join(''));
  let prev = -1;
  for (const i of [...keep].sort((a, b) => a - b)) {
    if (prev >= 0 && i > prev + 1) console.log(`      ${'...'.padStart(9)}   (${i - prev - 1} frames)`);
    const s = r.series[i];
    console.log('      ' + H.map(k => String(s[k]).padStart(9)).join('') +
                (i === worst ? '   <- highest' : '') +
                (s.alt >= ceiling ? '   *** ABOVE CEILING' : ''));
    prev = i;
  }
}

(async () => {
  const browser = await launch(chromium, { gl: 'hardware' });
  console.log('walk — can the harness walk? (QUEUE Y16)');
  console.log(`  ${BASE}  |  headless, gl=hardware, NO cpu throttle, index.html?intro=0`);
  console.log(`  ceiling ${CEILING} m (TRUNK_ALT)  |  target ${TARGET_M} m  |  PASS needs >= ${MIN_M} m and 0 frames above ceiling`);
  console.log(`  ${REPS} rep(s); the figure reported per site is the WORST rep, never the best`);
  console.log(`  machine: ${load()}`);
  console.log('');

  const results = [];
  for (const S of SITES) {
    const reps = [];
    for (let i = 0; i < REPS; i++) {
      reps.push(await walkOnce(browser, {
        lng: S.lng, lat: S.lat, bearing: S.bearing,
        metres: TARGET_M, ceiling: CEILING, seconds: SECS,
      }));
    }
    // WORST rep by frames-above-ceiling, then by distance. A gate that quotes
    // its best rep is quoting the machine.
    const r = reps.slice().sort((a, b) =>
      (b.framesAboveCeiling - a.framesAboveCeiling) || (a.metres - b.metres))[0];
    const pass = r.ok && r.framesAboveCeiling === 0 && r.metres >= MIN_M;
    results.push({ S, r, pass, reps });

    console.log(`── ${S.id}  (${S.note})`);
    if (!r.ok) { console.log(`   FAIL — ${r.why}`); console.log(''); continue; }
    console.log(`   start moved ${r.start.movedM} m from the asked point to reach roofAt(p, 7 m) = 0 (${r.start.tried} probes)`);
    console.log(`   ${r.frames} frames, ${r.wallS} s, WALKED ${r.metres} m (displacement ${r.displacement} m)` +
                `   alt min ${r.minAlt}  max ${r.maxAlt}  end ${r.endAlt}` +
                `   ${r.turns} turns / ${r.probes} steer probes`);
    printSeries(r, CEILING);
    console.log(`   trunk field: ${r.trunk.trunks} trunks, ${r.trunk.scans} scans, avg ${r.trunk.avgMs} ms, max ${r.trunk.maxMs} ms`);
    console.log(`   ${pass ? 'PASS' : 'FAIL'} — ${r.framesAboveCeiling} of ${r.frames} frames above ${CEILING} m; ${r.metres} m covered` +
                (r.stoppedEarly ? ` (stopped early${r.blocked ? ', blocked' : ''})` : ''));
    console.log('');
  }

  // ── THE WATCHED FAILURE ───────────────────────────────────────────────────
  console.log('── watched failure: perf-budget.mjs\'s own hard-coded start, unchecked (noFind)');
  const bad = await walkOnce(browser, {
    lng: -97.74170, lat: 30.28950, bearing: 180, noFind: true, steer: false,
    metres: TARGET_M, ceiling: CEILING, seconds: SECS,
  });
  console.log(`   ${bad.frames} frames, walked ${bad.metres} m (displacement ${bad.displacement} m), alt max ${bad.maxAlt}, end ${bad.endAlt}`);
  printSeries(bad, CEILING);
  const brokeAsExpected = bad.framesAboveCeiling > 0;
  console.log(`   ${brokeAsExpected ? 'GOOD' : 'BAD'} — ${bad.framesAboveCeiling} of ${bad.frames} frames above ${CEILING} m` +
              `${brokeAsExpected ? '. The gate can go red; it is not stuck green.' : '. THE GATE DID NOT FAIL WHERE IT MUST. Do not trust the passes above.'}`);
  console.log('');

  const passes = results.filter(x => x.pass).length;
  const green = passes === SITES.length && brokeAsExpected;
  console.log(`machine at end: ${load()}`);
  console.log(green
    ? ` PASS  ${passes}/${SITES.length} sites walked at walking height for every frame, and the watched failure failed`
    : ` FAIL  ${passes}/${SITES.length} sites passed; watched failure ${brokeAsExpected ? 'ok' : 'DID NOT FAIL'}`);
  await browser.__done();
  process.exit(green ? 0 : 1);
})();
