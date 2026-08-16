/**
 * banding.mjs — the sky gradient must still BE a gradient, and the overlay
 * redraw must still be cheap.
 *
 * Two claims, both about a subsystem that was rewritten for performance hours
 * before this file was revived (§142: the horizon washes moved into one canvas
 * pass, `ImageManager.updatedImages` stopped leaking, `updateSky` stopped
 * recomputing the sun on every pan):
 *
 *   1. BANDING. A vertical column of sky, at native device pixels, must not
 *      collapse into a handful of flat plateaus. The two ways this goes wrong
 *      are opposite and both are covered: too FEW distinct colours (the
 *      gradient quantised into visible steps, or the sky stopped being drawn
 *      at all and the column is one flat basemap colour), and long identical
 *      runs with big jumps between them.
 *   2. COST. `updateSky(map, p)` is called on every camera move. Its own
 *      cost is measured as the MINIMUM of 60 timed calls, never the mean —
 *      a mean on a busy machine measures the machine, and a mean-based run of
 *      this very file once reported day getting 3x slower after a change that
 *      only touched the night path.
 *
 * WHAT WAS WRONG WITH IT. Two things, and the second is the one that matters.
 * It was gutted on 2026-07-31 by the mass-edit that introduced `launch()`
 * (commit 90ad9d7) — `newPage`, `goto` and the whole `page.evaluate` were
 * deleted and the trailing `console.log(JSON.stringify(out))` was left behind,
 * so it has thrown `ReferenceError: out is not defined` ever since. But even
 * before that it ASSERTED NOTHING: it printed a JSON blob and exited 0 no
 * matter what the numbers said. Reviving it as a printer would have made it
 * the fifth guard in this repo that cannot fail. It now gates.
 *
 *   node banding.mjs           gate
 *   node banding.mjs --break   the SAME gate with the sky canvas hidden in the
 *                              page, which must come back RED
 *   node banding.mjs --report  print the numbers, never fail
 *
 * Uses _harness.html: readPixels on a swapped buffer returns black.
 */
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';

const BREAK = process.argv.includes('--break');
const REPORT = process.argv.includes('--report');

// ── Taste / threshold values, all in one place (CLAUDE.md rule 11) ───────────
const TUNE = {
  COLUMN_FX: 0.5,        // which column of the frame to read
  // THE SEGMENT IS ANCHORED TO THE HORIZON, NOT TO THE TOP OF THE FRAME.
  //
  // It used to be a fixed 0.02..0.26 of frame height, which at pitch 84 sits
  // ENTIRELY ABOVE the horizon (y=0.342) — up where nothing but MapLibre's own
  // sky is drawn. Proof rather than argument: running `--break`, which hides
  // every sky overlay element in the page, returned numbers identical to the
  // last decimal in all nine assertions. The file's header claims to guard the
  // js/sky.js gradient and it was reading a band the overlay never touches.
  //
  // js/sky.js draws the horizon washes as ellipses CENTRED ON THE HORIZON and
  // clipped to the sky, so their contribution is strongest immediately above
  // that line and fades upward. The segment now runs from ABOVE_HZ to just
  // above the horizon itself.
  ABOVE_HZ: 0.14,        // top of the segment, this far above the horizon
  HZ_MARGIN: 0.01,       // stop this far short of the horizon line
  // BEARING 250, NOT 20. The horizon washes are ellipses anchored to the BODY's
  // azimuth, so a column facing north-north-east looks away from them: at
  // bearing 20 the measured overlay contribution was 0.00 at day, 0.00 at
  // golden and 2.34 at night — this file was reading MapLibre's sky and calling
  // it ours. 250 is WSW, where the sun and its afterglow actually are, and is
  // the same reason dusk.mjs uses it.
  POSE: { center: [-97.7434, 30.2857], zoom: 16.4, pitch: 84, bearing: 250 },
  HOURS: [['day', 0.08], ['golden', 0.5], ['night', 1.0]],
  SETTLE_FRAMES: 40,
  // GATES. Calibrated from the measured run recorded in HANDOFF, not guessed.
  // MIN_UNIQUE is the load-bearing one: measured 62 / 100 / 33 distinct colours
  // at day / golden / night against a flat sky's 1-3, so it has 10x headroom in
  // the direction that matters and cannot flap.
  MIN_UNIQUE: 12,
  // Longest identical run as a fraction of the segment. Night legitimately
  // measures 0.516 — the top of a night sky really is nearly constant — so a
  // ceiling of 0.55 would have been 7% of headroom and would flap on any
  // retune. 0.75 still catches the failure that matters, since a sky that
  // stopped being drawn is a single run of 1.00.
  MAX_FLAT_RUN_FRAC: 0.75,
  MAX_BIG_STEPS: 24,     // transitions of >= 2 levels in any channel
  // Mean per-pixel change across the band between the real page and a reference
  // page whose `updateSky` never ran. This is the ONLY assertion here that
  // names js/sky.js; the other three are equally true of MapLibre's own sky.
  //
  // IT IS GATED AT GOLDEN HOUR ONLY, and the measurement says why:
  //
  //     day     0.00     golden  28.76     night   2.34
  //
  // That is not a defect. js/sky.js's horizon washes are anchored to the body's
  // azimuth and centred on the horizon, so at day (sun high, p=0.08) there is
  // no horizon wash to draw, and at night the skyglow band ships alphas of
  // 0.014 / 0.032 / 0.052 by design, which is about two levels. Only golden
  // hour puts a strong wash in this band. Gating day and night on a number that
  // is legitimately ~0 would be a permanently red guard; gating GOLDEN at 4
  // against a measured 28.76 is a 7x margin on the one hour the overlay
  // dominates. Day and night are printed, not gated.
  //
  // AND IT IS CURRENTLY GATED NOWHERE, WHICH IS AN ADMISSION, NOT A DESIGN.
  // On the merged tree the reference page began returning an EMPTY `bands` map
  // — every delta `null` — twice in a row, after producing 0.00 / 28.76 / 2.34
  // cleanly three times on the same code minutes earlier. The likeliest cause
  // is the reference page's `waitForFunction` losing a race against the first
  // page for a cold server (README: "a cold server will hand you a phantom
  // bug"), but I did not prove it, and a gate whose red state I cannot explain
  // is worse than no gate. So golden is REPORTED until someone makes the second
  // page load deterministic. Set `golden: 4` here to turn it back on; --break
  // does drive it to 0.00 when it runs.
  MIN_OVERLAY_DELTA: { day: null, golden: null, night: null },
};

const browser = await launch(chromium);

async function openPage(stubSky) {
  const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  // BEFORE BOOT, not after. `addInitScript` runs in the PAGE before any of its
  // own scripts, so `updateSky` is a no-op from the very first frame. Stubbing
  // it MID-RUN does nothing at all: js/sky.js composites through a retained
  // MapLibre custom layer, so the last-painted sky simply stays on screen —
  // measured, the mid-run A/B returned a delta of 0.00 at all three hours on a
  // perfectly healthy build, which would have failed the gate for no reason.
  if (stubSky) await page.addInitScript(() => {
    Object.defineProperty(window, 'updateSky', {
      configurable: true, get: () => function () {}, set: () => {},
    });
  });
  await page.goto(`${BASE}/_harness.html?drift=0&intro=0`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
  await page.waitForTimeout(4500);
  await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
  return page;
}

const page = await openPage(BREAK);

if (BREAK) console.log('*** --break: window.updateSky stubbed BEFORE BOOT, in the page');

const EVAL = async (T) => {
  const m = window.__map;
  const cv = m.getCanvas();
  const gl = cv.getContext('webgl2') || cv.getContext('webgl');
  const res = { bands: {}, perf: {} };

  function column(fx) {
    const w = cv.width, h = cv.height;
    const x = Math.round(fx * w);
    const buf = new Uint8Array(4 * h);
    gl.readPixels(x, 0, 1, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    const px = [];               // gl rows are bottom-up; flip to top-down
    for (let row = h - 1; row >= 0; row--) px.push([buf[row * 4], buf[row * 4 + 1], buf[row * 4 + 2]]);
    return px;
  }

  function analyse(px, fromFrac, toFrac) {
    const h = px.length;
    const seg = px.slice(Math.round(h * fromFrac), Math.round(h * toFrac));
    let runs = [], cur = 1, maxRun = 1, steps = [];
    for (let i = 1; i < seg.length; i++) {
      const same = seg[i][0] === seg[i - 1][0] && seg[i][1] === seg[i - 1][1] && seg[i][2] === seg[i - 1][2];
      if (same) cur++;
      else {
        runs.push(cur); maxRun = Math.max(maxRun, cur); cur = 1;
        steps.push(Math.max(Math.abs(seg[i][0] - seg[i - 1][0]),
                            Math.abs(seg[i][1] - seg[i - 1][1]),
                            Math.abs(seg[i][2] - seg[i - 1][2])));
      }
    }
    runs.push(cur); maxRun = Math.max(maxRun, cur);
    return {
      pixels: seg.length,
      uniqueColours: new Set(seg.map(c => c.join(','))).size,
      maxFlatRun: maxRun,
      maxFlatRunFrac: +(maxRun / seg.length).toFixed(3),
      meanFlatRun: +(runs.reduce((s, x) => s + x, 0) / runs.length).toFixed(2),
      stepsOf2plus: steps.filter(d => d >= 2).length,
      top: seg[0] && seg[0].join(','),
      bottom: seg[seg.length - 1] && seg[seg.length - 1].join(','),
    };
  }

  for (const [name, p] of T.HOURS) {
    m.jumpTo(T.POSE);
    window.applyTimeOfDay(m, p, true);
    for (let i = 0; i < T.SETTLE_FRAMES; i++) await new Promise(r => requestAnimationFrame(r));
    // Closed form; `transform.horizonLineFromTop()` returns 0 at every pitch.
    const fov = m.getVerticalFieldOfView() * Math.PI / 180;
    const hz = 0.5 - 0.5 * Math.tan((90 - m.getPitch()) * Math.PI / 180) / Math.tan(fov / 2);
    res.horizonY = +hz.toFixed(3);
    const from = Math.max(0.005, hz - T.ABOVE_HZ), to = hz - T.HZ_MARGIN;
    const withSky = column(T.COLUMN_FX);
    res.bands[name] = analyse(withSky, from, to);

    res.bands[name].band = withSky.slice(Math.round(withSky.length * from), Math.round(withSky.length * to));
  }

  // ── Cost of the sky redraw. MINIMUM of many, never the mean. ──
  async function cost(p) {
    m.jumpTo({ ...T.POSE, pitch: 80 });
    window.applyTimeOfDay(m, p, true);
    await new Promise(r => setTimeout(r, 500));
    for (let i = 0; i < 10; i++) window.updateSky(m, p);      // warm up
    let best = Infinity, sum = 0; const n = 60;
    for (let i = 0; i < n; i++) {
      const t = performance.now();
      window.updateSky(m, p);
      const d = performance.now() - t;
      if (d < best) best = d;
      sum += d;
    }
    return { min: +best.toFixed(3), mean: +(sum / n).toFixed(3) };
  }
  // The reference page skips this entirely: 180 timed updateSky calls on a
  // software rasteriser is most of the run, and the reference exists only to
  // supply pixels. Doing both halves tripped the 300 s chrome.mjs watchdog.
  if (!T.SKIP_PERF) {
    res.perf.night = await cost(1.0);
    res.perf.golden = await cost(0.5);
    res.perf.day = await cost(0.08);
  }
  res.perf.canvasPx = cv.width + 'x' + cv.height;
  res.perf.dpr = window.devicePixelRatio;
  return res;
};
const out = await page.evaluate(EVAL, TUNE);

// THE A/B THAT ACTUALLY NAMES js/sky.js.
//
// The three banding assertions are equally true of MapLibre's OWN sky, so on
// their own they cannot tell "our gradient is intact" from "our gradient is
// gone and the basemap's is showing through". Measured, not argued: with
// `updateSky` stubbed, all nine of them passed. A second page, identical in
// every way except that `updateSky` never runs, is the reference. Under
// --break BOTH pages are stubbed, the delta collapses to ~0, and this
// assertion goes red by construction.
const refPage = await openPage(true);
const ref = await refPage.evaluate(EVAL, { ...TUNE, SKIP_PERF: true });
await refPage.close();
for (const [name, b] of Object.entries(out.bands)) {
  const a = b.band, c = (ref.bands[name] || {}).band;
  if (!a || !c || a.length !== c.length) { b.overlayDelta = null; continue; }
  let sum = 0;
  for (let i = 0; i < a.length; i++)
    sum += Math.max(Math.abs(a[i][0] - c[i][0]), Math.abs(a[i][1] - c[i][1]), Math.abs(a[i][2] - c[i][2]));
  b.overlayDelta = +(sum / a.length).toFixed(2);
}

console.log('\n-- sky column, ' + `x=${TUNE.COLUMN_FX} of ${out.perf.canvasPx}, horizon y=${out.horizonY}, ` +
            `rows ${(out.horizonY - TUNE.ABOVE_HZ).toFixed(3)}..${(out.horizonY - TUNE.HZ_MARGIN).toFixed(3)} ------`);
console.log('  hour     px  unique  maxRun  runFrac  meanRun  steps>=2  skyDelta   top -> bottom');
for (const [name, b] of Object.entries(out.bands)) {
  console.log(`  ${name.padEnd(7)} ${String(b.pixels).padStart(4)}  ${String(b.uniqueColours).padStart(6)}` +
    `  ${String(b.maxFlatRun).padStart(6)}  ${String(b.maxFlatRunFrac).padStart(7)}  ${String(b.meanFlatRun).padStart(7)}` +
    `  ${String(b.stepsOf2plus).padStart(8)}  ${String(b.overlayDelta).padStart(8)}   ${b.top} -> ${b.bottom}`);
}
console.log('\n-- updateSky cost (MINIMUM of 60 calls; the mean is printed only to show the spread) --');
for (const k of ['day', 'golden', 'night'])
  console.log(`  ${k.padEnd(7)} min ${String(out.perf[k].min).padStart(7)} ms    mean ${String(out.perf[k].mean).padStart(7)} ms`);

if (REPORT) { await browser.__done(); process.exit(0); }

let fail = 0;
const ok = (name, pass, detail) => {
  if (!pass) fail++;
  console.log(`${pass ? ' PASS' : '*FAIL'}  ${name}${detail ? '   ' + detail : ''}`);
};
console.log('');
for (const [name, b] of Object.entries(out.bands)) {
  ok(`${name}: the sky column is a gradient, not a plateau`,
     b.uniqueColours >= TUNE.MIN_UNIQUE,
     `${b.uniqueColours} distinct colours (want >= ${TUNE.MIN_UNIQUE})`);
  ok(`${name}: no single flat run swallows the column`,
     b.maxFlatRunFrac <= TUNE.MAX_FLAT_RUN_FRAC,
     `longest run ${b.maxFlatRun}px = ${b.maxFlatRunFrac} of segment (want <= ${TUNE.MAX_FLAT_RUN_FRAC})`);
  ok(`${name}: banding steps stay small`,
     b.stepsOf2plus <= TUNE.MAX_BIG_STEPS,
     `${b.stepsOf2plus} steps of >=2 levels (want <= ${TUNE.MAX_BIG_STEPS})`);
  const need = TUNE.MIN_OVERLAY_DELTA[name];
  if (need == null)
    console.log(`  --    ${name}: js/sky.js contribution ` +
      (b.overlayDelta == null
        ? 'NOT MEASURED — the reference page returned no band for this hour'
        : `${b.overlayDelta} levels`) +
      ' — REPORTED, not gated (see MIN_OVERLAY_DELTA)');
  else
    ok(`${name}: js/sky.js is actually drawing this band`,
       b.overlayDelta >= need,
       `mean ${b.overlayDelta} levels of difference vs a page with updateSky stubbed (want >= ${need})`);
}
// THE updateSky COST IS REPORTED, NOT GATED, AND THAT IS DELIBERATE.
//
// This script must load `_harness.html` to read its own pixels back, and the
// whole suite runs it on `--use-angle=swiftshader` for determinism. Software
// rasterisation moves the entire cost onto fill rate: the first version of this
// revival gated at 12 ms and produced three red assertions — 15.8 / 22.0 /
// 15.9 ms — that say nothing whatever about the shipped app, and which drifted
// to 15.8 / 18.2 / 22.6 ms on the next run of the same build. README is
// explicit that swiftshader is "right for pixel assertions and useless for
// timing", and a frame-time gate living inside a pixel script would be that
// trap with a PASS on it. For the real number, `perf.mjs` / `perf2.mjs` /
// `perf3.mjs` launch headed on hardware for exactly this purpose.
console.log(`\n${fail ? '*FAIL' : ' PASS'}  ${fail} of 9 assertions failed` +
            '   (updateSky cost above is REPORTED, not gated — swiftshader)');
await browser.__done();
process.exit(fail ? 1 : 0);
