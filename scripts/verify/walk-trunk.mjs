/**
 * walk-trunk.mjs — QUEUE Y15 measured from a WALK at last.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 *
 * Y15 — "the trunk field's worst incremental scan" — has been quoted twice and
 * both figures came from a regime nobody walks:
 *
 *   §109  841.5 ms   from a run that TELEPORTED across West Campus ten times
 *   §133  149.8 ms   from a single 60 m hop, after 841.5 failed to reproduce
 *
 * and §132 wrote down why it could not be done properly: every scripted walk was
 * ejected to 23.8 m in the first second (see `lib/walker.mjs` for the mechanism),
 * and above `TRUNK_ALT` (12 m) the trunk field is switched off entirely, so the
 * walk measured a subsystem that was not running. Three passes reported "could
 * not measure".
 *
 * `lib/walker.mjs` walks now, and this is the cash-in.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT IS COMPARED, AND WHY THERE IS A CONTROL
 *
 * Two conditions, INTERLEAVED and COUNTERBALANCED (the machine drifts upward
 * across a run, so whichever condition always goes first gets the coolest slot
 * and wins by construction — README's own trap list):
 *
 *   WALK  steered, 1.7 m, held W+Shift, every frame under `TRUNK_ALT`, proved by
 *         the returned altitude series and not by its endpoint.
 *   HOP   the regime the old numbers came from: `TRUNK_RESCAN_M`-sized teleports
 *         at walking height, no walking between them. It is here so the walk's
 *         number has something to be read against, and so the claim "the old
 *         figure came from a regime nobody walks" is measured rather than
 *         asserted.
 *
 * Each rep is its OWN PAGE LOAD. `trunkField().maxMs` and `.avgMs` are
 * cumulative since load and cannot be differenced into a per-phase maximum, so
 * the only honest attribution is a fresh page plus a recorded pre-phase baseline
 * plus "did the max GROW" — the same discipline `perf-budget.mjs` uses.
 *
 * REPORTED FIGURE: the MINIMUM across reps of each rep's maximum scan. A mean on
 * a busy machine measures the machine; the minimum of the maxima is the tightest
 * upper bound the run supports. Every figure is printed beside the chrome/node
 * process counts and CPU percent sampled at that moment.
 *
 * USAGE
 *   VERIFY_URL=http://127.0.0.1:8441 node walk-trunk.mjs [reps]
 *
 * INSTRUMENT: headless, `gl:'hardware'` (CPU-side timers; SwiftShader would
 * rasterise the city on the same cores), NO cpu throttle, `index.html?intro=0`,
 * auto-detect cancelled, viewport 1440x900.
 *
 * WHAT IT DOES NOT MEASURE, said plainly: the steering probes call
 * `__fly.roofAt()` from the harness's own rAF callback. They do not run inside
 * `trunkStamp()`, so they cannot inflate the scan timer directly, but they do
 * compete for the same core. `--nosteer` runs the same walk with steering off
 * for anyone who wants that contribution bounded.
 *
 * Written by the Acer lane, 2026-08-16. Owns: this file only.
 */
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { launch, BASE } from './chrome.mjs';
import { installWalker } from './lib/walker.mjs';

const VW = 1440, VH = 900;
const REPS = Math.max(2, Number(process.argv.find(a => /^\d+$/.test(a))) || 3);
const NOSTEER = process.argv.includes('--nosteer');
const BUDGET_MS = Number(process.env.PB_TRUNK_MS || 8);   // docs/perf/budget.md §4.3
const TARGET_M = Number(process.env.WALK_M || 220);
const SECS = Number(process.env.WALK_SECONDS || 85);

const SITES = [
  { id: 'drag',      lng: -97.74170, lat: 30.28950, bearing: 180, note: 'Guadalupe, the pose perf-budget.mjs has always used' },
  { id: 'southmall', lng: -97.73940, lat: 30.28560, bearing: 90,  note: 'South Mall — the densest live-oak canopy in the data' },
];

function load() {
  try {
    const o = execFileSync('powershell', ['-NoProfile', '-Command',
      "$c=@(Get-Process chrome -EA SilentlyContinue).Count;" +
      "$n=@(Get-Process node -EA SilentlyContinue).Count;" +
      "$p=(Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor|" +
      "Where-Object {$_.Name -eq '_Total'}).PercentProcessorTime;\"$c $n $p\""],
      { encoding: 'utf8', timeout: 30000 }).trim().split(/\s+/);
    return { chrome: +o[0] || 0, node: +o[1] || 0, cpu: +o[2] || 0 };
  } catch (e) { return { chrome: -1, node: -1, cpu: -1 }; }
}
const ls = l => `chrome ${String(l.chrome).padStart(2)} node ${String(l.node).padStart(2)} cpu ${String(l.cpu).padStart(3)}%`;

async function newPage(browser) {
  const page = await browser.newPage({ viewport: { width: VW, height: VH } });
  await page.goto(`${BASE}/index.html?intro=0`, { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
  await page.waitForFunction(() => window.__fly && window.__fly.indexed(), null, { timeout: 60000 });
  await page.evaluate(() => { try { window.cancelGraphicsAutoDetect(); } catch (e) {} });
  await page.evaluate(installWalker);
  await page.waitForTimeout(3000);
  return page;
}

/** The walk condition. */
async function repWalk(browser, S, opts) {
  const page = await newPage(browser);
  const r = await page.evaluate(async ({ S, o }) => {
    const w = await window.__walker.walk({ ...o, lng: S.lng, lat: S.lat, bearing: S.bearing });
    if (!w.ok) return w;
    // THE BASELINE IS THE WALKER'S OWN `pre` MARK — taken after the placement
    // and its settle, at the instant W went down. Sampling before `walk()` would
    // charge the field's first FULL BUILD for the new position to the walk and
    // report a ~1.5 s boot scan as a worst-case incremental one. That is not
    // hypothetical: the first run of this file did exactly that and read
    // 1504.8 ms.
    const a = w.pre, b = w.post;
    const dScans = b.trunk.scans - a.trunk.scans;
    const dSum = b.trunk.avgMs * b.trunk.scans - a.trunk.avgMs * a.trunk.scans;
    const dTicks = b.ticks - a.ticks;
    return {
      ok: true, metres: w.metres, displacement: w.displacement, frames: w.frames,
      wallS: w.phaseS, minAlt: w.minAlt, maxAlt: w.maxAlt, endAlt: w.endAlt,
      framesAboveCeiling: w.framesAboveCeiling, stayedDown: w.stayedDown,
      start: w.start, turns: w.turns,
      trunks: b.trunk.trunks, scans: dScans,
      // Cumulative max, plus whether THIS phase set it. A max that did not grow
      // says nothing about the phase that just ran.
      maxMs: b.trunk.maxMs, grew: b.trunk.maxMs > a.trunk.maxMs + 1e-9, baseMax: a.trunk.maxMs,
      avgMs: dScans > 0 ? +(dSum / dScans).toFixed(2) : null,
      dutyPct: w.phaseS > 0 && dScans > 0 ? +(100 * dSum / (w.phaseS * 1000)).toFixed(3) : null,
      tickMs: dTicks > 0 ? +((b.tickAvg * b.ticks - a.tickAvg * a.ticks) / dTicks).toFixed(3) : null,
    };
  }, { S, o: { metres: TARGET_M, seconds: SECS, ceiling: 12, steer: !NOSTEER } });
  await page.close();
  return r;
}

/**
 * The hop condition — the old regime, reproduced deliberately. Same site, same
 * altitude, same number of rescan triggers, but the camera is TELEPORTED
 * TRUNK_RESCAN_M at a time instead of walking. This is what §109 and §133
 * measured.
 */
async function repHop(browser, S, opts) {
  const page = await newPage(browser);
  const r = await page.evaluate(async ({ S, hops, hopM }) => {
    const F = window.__fly, M_LAT = 40030228.884 / 360;
    const rad = d => d * Math.PI / 180;
    await window.__walker.settle();
    const st = window.__walker.findStart({ lng: S.lng, lat: S.lat, alt: 1.7 }) || { lng: S.lng, lat: S.lat, movedM: -1 };
    window.__walker.placeEye(st.lng, st.lat, 1.7, S.bearing, 85);
    await new Promise(r2 => setTimeout(r2, 2500));
    const base = { max: F.trunkField().maxMs, scans: F.trunkField().scans,
                   sum: F.trunkField().avgMs * F.trunkField().scans };
    const t0 = performance.now();
    const alts = [];
    for (let i = 1; i <= hops; i++) {
      const d = hopM * i;
      const lng = st.lng + Math.sin(rad(S.bearing)) * d / (M_LAT * Math.cos(rad(st.lat)));
      const lat = st.lat + Math.cos(rad(S.bearing)) * d / M_LAT;
      window.__walker.placeEye(lng, lat, 1.7, S.bearing, 85);
      for (let k = 0; k < 14; k++) await new Promise(r2 => requestAnimationFrame(r2));
      alts.push(+F.eye().alt.toFixed(2));
    }
    const wallS = (performance.now() - t0) / 1000;
    const t = F.trunkField(), dScans = t.scans - base.scans;
    return {
      ok: true, start: st, hops, hopM, metres: hops * hopM, wallS: +wallS.toFixed(2),
      alts, maxAlt: Math.max(...alts), trunks: t.trunks, scans: dScans,
      maxMs: t.maxMs, grew: t.maxMs > base.max + 1e-9, baseMax: base.max,
      avgMs: dScans > 0 ? +((t.avgMs * t.scans - base.sum) / dScans).toFixed(2) : null,
    };
  }, { S, hops: Math.round(TARGET_M / 60), hopM: 60 });
  await page.close();
  return r;
}

const nm = v => (v == null ? '   --' : String(v));

(async () => {
  const browser = await launch(chromium, { gl: 'hardware' });
  console.log('walk-trunk — QUEUE Y15, measured from a walk (see lib/walker.mjs for why it could not be before)');
  console.log(`  ${BASE}  |  headless, gl=hardware, NO cpu throttle, index.html?intro=0, ${VW}x${VH}`);
  console.log(`  ${REPS} reps, interleaved + counterbalanced, one page load each; figure = MIN across reps`);
  console.log(`  walk target ${TARGET_M} m of PATH, watchdog ${SECS} s, steering ${NOSTEER ? 'OFF' : 'ON'}`);
  console.log(`  budget: ${BUDGET_MS} ms per scan (docs/perf/budget.md §4.3, PB_TRUNK_MS)`);
  console.log(`  machine at start: ${ls(load())}`);
  console.log('');

  const out = {};
  for (const S of SITES) {
    out[S.id] = { walk: [], hop: [] };
    for (let r = 0; r < REPS; r++) {
      const order = r % 2 === 0 ? ['walk', 'hop'] : ['hop', 'walk'];
      for (const cond of order) {
        const before = load();
        const res = cond === 'walk' ? await repWalk(browser, S) : await repHop(browser, S);
        const after = load();
        out[S.id][cond].push({ ...res, before, after });
        const valid = cond === 'hop' || (res.ok && res.stayedDown && res.metres >= 120);
        console.log(`  ${S.id.padEnd(10)} rep ${r + 1} ${cond.padEnd(4)}` +
          `  ${String(res.metres).padStart(6)} m` +
          `  maxAlt ${String(res.maxAlt).padStart(6)}` +
          `  scans ${String(res.scans).padStart(3)}` +
          `  avg ${String(nm(res.avgMs)).padStart(6)} ms` +
          `  MAX ${String(res.maxMs).padStart(7)} ms${res.grew ? ' (this phase set it)' : ' (not set here)'}` +
          `  ${valid ? '' : '  INVALID'}  | ${ls(after)}`);
      }
    }
    console.log('');
  }

  console.log('── the figures');
  console.log('   site        cond   valid reps   walked   worst scan (MIN of the reps\' maxima)   avg scan   duty');
  const verdicts = [];
  for (const S of SITES) {
    for (const cond of ['walk', 'hop']) {
      const reps = out[S.id][cond].filter(r =>
        cond === 'hop' ? r.grew : (r.ok && r.stayedDown && r.metres >= 120 && r.grew));
      if (!reps.length) {
        console.log(`   ${S.id.padEnd(11)} ${cond.padEnd(6)} 0            —        INVALID — no rep both walked and set the maximum`);
        continue;
      }
      const worst = Math.min(...reps.map(r => r.maxMs));
      const avg = Math.min(...reps.map(r => r.avgMs ?? Infinity));
      const m = Math.round(reps.reduce((a, r) => a + r.metres, 0) / reps.length);
      const duty = reps.map(r => r.dutyPct).filter(x => x != null);
      console.log(`   ${S.id.padEnd(11)} ${cond.padEnd(6)} ${String(reps.length).padStart(2)}/${REPS}` +
                  `        ${String(m).padStart(5)} m   ${String(worst.toFixed(1)).padStart(8)} ms` +
                  `                        ${String(isFinite(avg) ? avg.toFixed(2) : '--').padStart(6)} ms` +
                  `   ${duty.length ? Math.min(...duty).toFixed(2) + ' %' : '--'}`);
      if (cond === 'walk') verdicts.push({ site: S.id, worst, over: worst > BUDGET_MS });
    }
  }
  console.log('');
  for (const v of verdicts) {
    console.log(`   Y15 @ ${v.site}: worst scan on a real walk is ${v.worst.toFixed(1)} ms against an ${BUDGET_MS} ms budget` +
                ` — ${v.over ? `OVER by ${(v.worst / BUDGET_MS).toFixed(1)}x, about ${Math.round(v.worst / 16.7)} dropped frames at 60 fps` : 'WITHIN BUDGET'}`);
  }
  console.log(`   machine at end: ${ls(load())}`);
  console.log('');
  const anyOver = verdicts.some(v => v.over);
  console.log(anyOver
    ? ' Y15 IS REAL ON A WALK. The figure above replaces the hop-regime numbers in §109 and §133.'
    : ' Y15 does not reproduce on a walk at any site measured here.');
  await browser.__done();
})();
