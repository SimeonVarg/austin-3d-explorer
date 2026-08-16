/**
 * dusk.mjs — THE DUSK HANDOVER MUST BE CONTINUOUS, measured in pixels.
 *
 * The claim. Twilight runs on two independent schedules (js/sky.js: the sun's
 * afterglow decays over its own elevation while the moon's glow rises over
 * its own). Before that, a single-body switch flipped in ONE frame at p=0.5925
 * and teleported the horizon glow 176.6 degrees across the sky. This file is
 * the guard on that never coming back.
 *
 * WHY IT WAS REWRITTEN, and it is the reason it is worth reading. The version
 * that shipped until today RE-IMPLEMENTED sky.js's alpha schedule inside the
 * test — `(0.26 + 0.40 * golden) * wSun` copied out of the source — and swept
 * that copy. A guard that recomputes the thing it guards cannot see the thing
 * it guards change: sky.js could have moved the whole horizon wash into a
 * canvas pass (it has: §142, the washes are `ctx` draws now, not DOM alpha)
 * and this file would have gone on sweeping a formula and reporting continuity
 * for a sky it never looked at. So it now READS PIXELS off the real frame at
 * every step, and the only thing it knows about sky.js is the name of the
 * function that sets the hour.
 *
 * It could not have run either way. It was gutted on 2026-07-31 by the
 * mass-edit that introduced `launch()` (commit 90ad9d7): the edit removed
 * `newPage`, `goto` and the whole `page.evaluate` and left the `console.log`
 * that reads `r`. It has thrown `ReferenceError: r is not defined` on every
 * invocation since — through the entire sky rewrite it was supposed to guard.
 *
 *   node dusk.mjs              sweep and gate
 *   node dusk.mjs --break      the SAME gate against a deliberately
 *                              discontinuous sky, which must come back RED
 *   node dusk.mjs --report     print the curve, never fail
 *   node dusk.mjs --strict     ignore the KNOWN allowance below (goes red on
 *                              the open sky.js defect this file found)
 *
 * `--break` monkey-patches `window.skyBodies` IN THE PAGE ONLY — it teleports
 * the sun 180 degrees at `TUNE.BREAK_AT`. No file on disk changes. It exists
 * because a guard that has only ever been watched passing is not evidence of
 * anything. Measured: 42 levels at p=0.55, exit 1.
 */
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';

const BREAK = process.argv.includes('--break');
const REPORT = process.argv.includes('--report');

// ── The taste/threshold values, all in one place (CLAUDE.md rule 11) ─────────
const TUNE = {
  P_FROM: 0.50,      // start of the sweep — mid-afternoon, sun still up
  P_TO: 0.80,        // end — full night
  P_STEP: 0.005,     // 61 samples. Finer than any screenshot could resolve.
  SETTLE_FRAMES: 3,  // rAFs to let the canvas pass land after applyTimeOfDay
  // The gate. A per-step jump larger than this in ANY sampled sky pixel is a
  // discontinuity. Calibrated from the measured curve, not guessed — see the
  // HANDOFF section for the run this number came from.
  MAX_STEP: 26,
  // == THE ONE KNOWN, ACCEPTED DISCONTINUITY ================================
  //
  // The first run this file has ever completed found a REAL one-frame jump of
  // 83 levels in the blue channel of the sky just above the western horizon at
  // p=0.595, reproduced identically in three reps while its neighbours moved 5
  // and 6. It is `js/sky.js:1420`:
  //
  //     const useMoon = !B.sunUp && B.moon.elev > -2;
  //
  // The moon crosses -2 degrees between p=0.590 (elev -2.24) and p=0.595
  // (-1.76), so the DISC and its halo switch body in one step: `haloCol` goes
  // from the warm `sunColour(elev)` to the cool `[150,172,226]` and `bloomA0`
  // from `0.26+0.22*golden` to a flat `0.30`. THE TWO HORIZON WASHES ARE
  // CONTINUOUS — that was the two-schedule rewrite, and it holds. The disc was
  // never given the same treatment, and sky.js's own comment about the old
  // switch "flipping in one frame at p=0.5925" describes a sibling of a bug
  // that is still in the file.
  //
  // js/sky.js is not this lane's to write, so this is RECORDED, not fixed —
  // QUEUE Y20. The allowance follows `coplanar.mjs --gate` and its baseline
  // file: a guard that is permanently red is a guard nobody reads, so the one
  // measured defect is named with a ceiling and everything else gates normally.
  // If this jump GROWS past the ceiling, or a second one appears anywhere, the
  // gate goes red. `--strict` ignores the allowance entirely.
  KNOWN: [{ p: 0.595, upTo: 90, why: 'js/sky.js:1420 useMoon disc switch - QUEUE Y20' }],
  POSE: { center: [-97.7434, 30.2857], zoom: 16.4, pitch: 78, bearing: 250 },
  // Where `--break` teleports the sun. 0.55, not later: the wash has to be at
  // full strength for a body swap to move pixels at all. See the note in the
  // --break block — at p=0.65 the same swap moved the sky by TWENTY-TWO levels,
  // under the gate, because by then the sun sits at -8.5 deg and its wash is
  // nearly spent. That is a real blind spot of this instrument at that hour and
  // it is written down rather than tuned away.
  BREAK_AT: 0.55,
};

const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
page.on('pageerror', e => console.log('PAGEERROR', e.message));

// _harness.html, not index.html: readPixels on a swapped buffer returns black
// and only the harness forces preserveDrawingBuffer. harness-drift.mjs is what
// keeps that page honest about being the same city.
await page.goto(`${BASE}/_harness.html?intro=0`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
await page.waitForTimeout(4500);
// README law: the auto-detect probe fires 11 s after load and rewrites every
// graphics setting. Left running it lands mid-sweep and reads as a jump.
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

if (BREAK) {
  await page.evaluate((BREAK_AT) => {
    const real = window.skyBodies;
    window.skyBodies = function (p) {
      const B = real(p);
      // Teleport the SUN 180 degrees. This is not a caricature — it
      // is the historical defect verbatim: sky.js's own comment records the
      // old single-body switch "teleporting the horizon glow 176.6 deg from
      // the western to the eastern horizon" in one frame at p=0.5925.
      //
      // A weaker break was tried first and is worth knowing about: stepping
      // `golden` from 0.341 to 0.048 at p=0.65 moved the sampled sky by NINE
      // levels, under the gate. The golden term barely reaches these pixels at
      // that hour. If you want to prove this gate fires, move the body, not
      // the weights.
      if (p < BREAK_AT) return B;
      return { ...B, sun: { ...B.sun, az: (B.sun.az + 180) % 360 } };
    };
  }, TUNE.BREAK_AT);
  console.log(`*** --break: window.skyBodies patched IN THE PAGE — sun azimuth +180 deg from p=${TUNE.BREAK_AT}`);
}

const r = await page.evaluate(async (T) => {
  const m = window.__map, cv = m.getCanvas();
  const gl = cv.getContext('webgl2') || cv.getContext('webgl');
  m.jumpTo(T.POSE);

  // The horizon line, closed form. `transform.horizonLineFromTop()` returns 0
  // at every pitch (README) and collapses the column onto row 0.
  const fov = m.getVerticalFieldOfView() * Math.PI / 180;
  const hz = 0.5 - 0.5 * Math.tan((90 - m.getPitch()) * Math.PI / 180) / Math.tan(fov / 2);

  // Sample a GRID of sky, not one pixel. The failure being guarded is the wash
  // moving from one horizon to the other, so the samples have to span the
  // frame horizontally; and it fades with height, so they span vertically too.
  const pts = [];
  for (const fx of [0.10, 0.25, 0.40, 0.55, 0.70, 0.85])
    for (const dy of [0.03, 0.09, 0.17])
      pts.push([fx, Math.max(0.005, hz - dy)]);

  const readAll = () => {
    const out = [];
    for (const [fx, fy] of pts) {
      const b = new Uint8Array(4);
      gl.readPixels(Math.round(fx * cv.width), Math.round((1 - fy) * cv.height),
                    1, 1, gl.RGBA, gl.UNSIGNED_BYTE, b);
      out.push(b[0], b[1], b[2]);
    }
    return out;
  };

  const samples = [];
  for (let p = T.P_FROM; p <= T.P_TO + 1e-9; p += T.P_STEP) {
    const pp = +p.toFixed(4);
    // force:true bypasses the 1/128 quantisation of the expensive path, which
    // would otherwise round a 0.005 step to nothing and print a flat curve.
    window.applyTimeOfDay(m, pp, true);
    for (let i = 0; i < T.SETTLE_FRAMES; i++) await new Promise(res => requestAnimationFrame(res));
    const B = window.skyBodies(pp);
    samples.push({ p: pp, px: readAll(), sunElev: +B.sun.elev.toFixed(2),
                   moonElev: +B.moon.elev.toFixed(2), sunAz: +B.sun.az.toFixed(1),
                   moonAz: +B.moon.az.toFixed(1), golden: +B.golden.toFixed(3) });
  }

  const steps = [];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1].px, b = samples[i].px;
    let worst = 0, at = -1;
    for (let k = 0; k < a.length; k++) {
      const d = Math.abs(b[k] - a[k]);
      if (d > worst) { worst = d; at = k; }
    }
    steps.push({ p: samples[i].p, worst, channel: at });
  }
  const horizonY = +hz.toFixed(3);
  return { horizonY, pts: pts.map(p => [+p[0].toFixed(3), +p[1].toFixed(3)]), nPoints: pts.length, samples: samples.map(s => {
    const { px, ...rest } = s; return rest;
  }), steps, canvas: cv.width + 'x' + cv.height };
}, TUNE);

const worst = r.steps.reduce((a, b) => (b.worst > a.worst ? b : a), r.steps[0]);
const sorted = [...r.steps].map(s => s.worst).sort((a, b) => a - b);
const median = sorted[Math.floor(sorted.length / 2)];
const p95 = sorted[Math.floor(sorted.length * 0.95)];

console.log(`\ncanvas ${r.canvas}, horizon at y=${r.horizonY}, ${r.nPoints} sky points x 3 channels`);
console.log(`sweep p ${TUNE.P_FROM} -> ${TUNE.P_TO} step ${TUNE.P_STEP}  (${r.samples.length} samples, ${r.steps.length} transitions)\n`);
console.log('    p    golden  sunElev moonElev   sunAz  moonAz   worst step');
for (let i = 0; i < r.samples.length; i++) {
  const s = r.samples[i];
  const st = i === 0 ? null : r.steps[i - 1];
  console.log(
    `  ${s.p.toFixed(3)}  ${String(s.golden).padStart(6)}  ${String(s.sunElev).padStart(7)} ` +
    `${String(s.moonElev).padStart(8)}  ${String(s.sunAz).padStart(6)} ${String(s.moonAz).padStart(7)}   ` +
    (st ? String(st.worst).padStart(4) + (st.worst > TUNE.MAX_STEP ? '  <-- OVER' : '') : '   -'));
}

console.log(`\nframe-to-frame worst channel step:  median ${median}   p95 ${p95}   MAX ${worst.worst} at p=${worst.p}`);
const where = (ch) => {
  const p = r.pts[Math.floor(ch / 3)] || [NaN, NaN];
  return `point ${Math.floor(ch / 3)} at (${p[0]}, ${p[1]}) channel ${'RGB'[ch % 3]}`;
};
console.log(`worst is at ${where(worst.channel)}`);
console.log(`gate: MAX_STEP = ${TUNE.MAX_STEP}`);

if (REPORT) { await browser.__done(); process.exit(0); }

const STRICT = process.argv.includes('--strict');
const allowanceFor = (p) => STRICT ? null : TUNE.KNOWN.find(k => Math.abs(k.p - p) < 1e-6);

const over = [], excused = [];
for (const st of r.steps) {
  if (st.worst <= TUNE.MAX_STEP) continue;
  const k = allowanceFor(st.p);
  if (k && st.worst <= k.upTo) { excused.push({ ...st, k }); continue; }
  over.push(st);
}
for (const e of excused)
  console.log(` KNOWN  p=${e.p} step ${e.worst} (ceiling ${e.k.upTo}) - ${e.k.why}`);
// An allowance that stopped firing is a fix nobody recorded. Say so, loudly,
// rather than letting it quietly outlive the defect it was written for.
for (const k of (STRICT ? [] : TUNE.KNOWN))
  if (!excused.some(e => e.p === k.p))
    console.log(`  note  the KNOWN discontinuity at p=${k.p} did NOT fire - if it is fixed, delete the entry`);
const ok = over.length === 0;
console.log(`\n${ok ? ' PASS' : '*FAIL'}  the dusk handover is continuous: ${over.length} unexcused of ${r.steps.length} transitions exceed ${TUNE.MAX_STEP}` +
            (over.length ? ' -> ' + over.slice(0, 8).map(x => `p=${x.p}:${x.worst}`).join(' ') : '') +
            (STRICT ? '   [--strict: no allowances]' : ''));

await browser.__done();
// Exit code IS the verdict. HANDOFF §142 recorded that exit codes here "read as
// verdicts only"; a suite is not automatable until a non-zero exit means
// something failed.
process.exit(ok ? 0 : 1);
