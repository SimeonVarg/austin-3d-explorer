/**

 * verify-movement.mjs — assertion harness for the flythrough camera.

 *

 * Runs the REAL app and asserts measurable properties of the movement system.

 * Timing-independent: headless swiftshader runs ~20 fps, so every speed is

 * reported per second-of-effective-dt (the same min(delta,64) accumulation the
 * control loop uses) rather than per wall-clock second.

 *

 * Usage: node verify-movement.mjs            (assert; exit 1 on failure)

 *        node verify-movement.mjs --report   (print the table, never fail)

 */

import { chromium } from 'playwright-core';

// BASE honours VERIFY_URL so parallel worktrees can each test their own serve

// (chrome.mjs has exported it for this purpose all along). No assertion change.

import { chromePath, BASE, launch } from './chrome.mjs';

const EXE = chromePath();

const REPORT_ONLY = process.argv.includes('--report');

const browser = await launch(chromium);

const page = await browser.newPage({ viewport: { width: 800, height: 560 } });

const pageErrors = [];

page.on('pageerror', e => pageErrors.push(e.message));

await page.goto(`${BASE}/index.html?drift=0&intro=0`, { waitUntil: 'networkidle', timeout: 60000 });

await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });

await page.waitForTimeout(5000);

// suite-lint flags this file for never cancelling the probe, and it is right:
// the graphics auto-detect fires 11 s after load and rewrites every setting,
// inside a run that lasts seven minutes. Cancelling it is a CORRECTNESS
// measure, not a speed one (README).
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

await page.evaluate(() => {
  const m = window.__map;
  // README trap: a seeded jumpTo is OVERWRITTEN on the next frame while the
  // controller still owns the camera — and since the camera-feel pass the
  // ownership tail after keyup is ~8 s (bob/settle wind-down), not ~3 s.
  // Measured failure mode of the old sync reset: every leg's pose reset was
  // silently ignored, positions accumulated ~230 m per leg, and the diagonal
  // legs ran into the soft data fence, which crushed vel.n — a stable-looking
  // diagonal/cardinal of 0.73 that was really the fence, not the input math.
  // Returning a promise makes every page.evaluate(__reset) call wait it out.
  // The poll had NO DEADLINE — the one genuine hang shape in this file. It has
  // not fired in any recorded run, but a gate that can wait forever is a gate
  // that can be reported as "unknown" instead of red, which is exactly the
  // state five of these scripts were in. 60 s, then seed anyway and SAY SO.
  window.__reset = (b, z, p) => new Promise(res => {
    const t0 = performance.now();
    const seed = () => m.jumpTo({ center: [-97.7434, 30.2857],
                                  zoom: z ?? 16.5, pitch: p ?? 64, bearing: b ?? 90 });
    const tryIt = () => {
      if (!window.__fly.eye().driving) { seed(); res({ waitedMs: Math.round(performance.now() - t0), forced: false }); }
      else if (performance.now() - t0 > 60000) {
        console.warn('[movement] __reset gave up waiting for !driving after 60 s');
        seed(); res({ waitedMs: Math.round(performance.now() - t0), forced: true });
      } else setTimeout(tryIt, 120);
    };
    tryIt();
  });
  window.__idle = () => !window.__fly.eye().driving;
  window.__cam = () => {
    const c = m.getCenter();
    return { lng: c.lng, lat: c.lat, zoom: m.getZoom(), pitch: m.getPitch(), bearing: m.getBearing(),
             alt: m.transform.getCameraAltitude() };
  };
  window.__metres = (a, b) => Math.hypot((b.lat - a.lat) * 111320,
                                          (b.lng - a.lng) * 111320 * Math.cos(a.lat * Math.PI / 180));
  window.__startClock = () => {
    window.__dt = 0; window.__frames = 0; window.__clockOn = true;
    let last = null;
    const step = ts => { if (!window.__clockOn) return;
      if (last !== null) { window.__dt += Math.min(ts - last, 64); window.__frames++; }
      last = ts; requestAnimationFrame(step); };
    requestAnimationFrame(step);
  };
  window.__stopClock = () => { window.__clockOn = false; return { dt: window.__dt, frames: window.__frames }; };
});

const median = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

const results = [];

function check(name, pass, detail) { results.push({ name, pass, detail }); }

// ── THE HEADLINE ASSERTIONS WERE A COIN FLIP UNTIL 2026-08-16 ───────────────
//
// `speedOnce` honoured the README's rule for its DENOMINATOR — `dtSim =
// __fly.simTime()` — and broke it for its WINDOW BOUNDARIES:
//
//     for (const k of keys) await page.keyboard.down(k);
//     await page.waitForTimeout(1500);      // "spend the acceleration ramp first"
//     const before = await page.evaluate(...);
//     await page.waitForTimeout(ms);        // 2500 ms — WALL CLOCK
//
// `TAU_ACCEL` is 0.2 s of SIM time and `simTime` accumulates `min(delta, 64)`
// per frame, so at 4 fps a 1500 ms wall-clock ramp is six frames — 0.38 s of
// sim — and the camera is still accelerating when the window opens. Each leg
// then captures a different fraction of the ramp and the assertion is the ratio
// of two shortfalls.
//
// THE SIGNATURE IS IN THE GATE'S OWN OUTPUT. Terminal speed is 56.65 m/s and
// every reading this file produced was BELOW it — 55.6 and 50.3 in one rep,
// 49.1 and 53.6 in another — and `east/north` came in at 0.905, then passed,
// then 1.092 (§159). A directional asymmetry in the movement code cannot change
// sign. Measured with the ramp and the window paced by sim time instead, over
// eight interleaved and counterbalanced legs: **east/north 1.000, 56.65 m/s
// both ways, zero spread to five significant figures**.
//
// Two hypotheses were ruled out by measurement rather than argument: the soft
// data fence (`FENCE_SOFT` is 250 m and the start pose is 3508-5332 m from its
// own fence edges, against a 224 m leg) and collision (velocity loss was 0.00 %
// on all eight legs).
//
// So the boundaries are now sim-time too, and the whole measurement happens
// inside ONE page.evaluate so no CDP round trip can land mid-window.
// Every leg, printed at the end. A ratio of two numbers is not a measurement
// until you can see both of them and their spread. Declared BEFORE speedOnce so
// suite-lint's use-before-declare rule has nothing to say about it.
const legLog = [];

const RAMP_SIM = 2.0;      // seconds of SIM time to spend accelerating. TAU_ACCEL is 0.2 s; 10x is terminal.
const WINDOW_SIM = 2.5;    // seconds of SIM time the measurement window covers
const LEG_WALL_MAX = 90000; // hard wall-clock ceiling per leg, so a stalled page cannot hang the gate

async function speedOnce(keys, bearing) {
  await page.evaluate(b => window.__reset(b), bearing);
  await page.waitForTimeout(500);
  // Measure the EYE (__fly.eye()), not map.getCenter(): center = eye +
  // alt*tan(pitch) along the bearing, and since the camera-feel pass the
  // rendered pitch carries dynamic output offsets (speed pitch, bob), so the
  // lead length breathes during a run. Measured: center-based speed read a
  // stable diagonal/cardinal of 0.73 while the eye moved at exactly 56.71 m/s
  // on BOTH headings — the old ruler was measuring the feel offsets, not the
  // movement. The eye is the movement system's state; measure that.
  for (const k of keys) await page.keyboard.down(k);
  const r = await page.evaluate(async ({ ramp, win, wallMax }) => {
    const F = window.__fly;
    const wall0 = performance.now();
    const waitSim = async (from, need) => {
      while (F.simTime() - from < need) {
        if (performance.now() - wall0 > wallMax) return false;
        await new Promise(res => requestAnimationFrame(res));
      }
      return true;
    };
    const tStart = F.simTime();
    const rampOk = await waitSim(tStart, ramp);          // spend the ramp in SIM time
    const before = { e: F.eye(), t: F.simTime() };
    // Sample |vel| every frame across the window as well as the endpoints, so a
    // leg that is still accelerating is visible in the SPREAD and not only in
    // the mean. §159's discriminator did exactly this and read zero spread.
    const speeds = [];
    let winOk = true;
    while (F.simTime() - before.t < win) {
      if (performance.now() - wall0 > wallMax) { winOk = false; break; }
      // `eye()` exposes the velocity as vE/vN (js/controls.js:1795), NOT as a
      // `vel` object. Reading the wrong field name here would have produced an
      // empty `speeds` array and a silent NaN spread, which is how an
      // instrument stops measuring without saying so.
      const e = F.eye();
      if (isFinite(e.vE) && isFinite(e.vN)) speeds.push(Math.hypot(e.vE, e.vN));
      await new Promise(res => requestAnimationFrame(res));
    }
    const after = { e: F.eye(), t: F.simTime() };
    const sorted = speeds.slice().sort((a, b) => a - b);
    return {
      before: before.e, after: after.e, dtSim: after.t - before.t,
      rampOk, winOk, frames: speeds.length,
      velMed: sorted.length ? sorted[Math.floor(sorted.length / 2)] : NaN,
      velMin: sorted.length ? sorted[0] : NaN,
      velMax: sorted.length ? sorted[sorted.length - 1] : NaN,
      wallMs: Math.round(performance.now() - wall0),
    };
  }, { ramp: RAMP_SIM, win: WINDOW_SIM, wallMax: LEG_WALL_MAX });
  for (const k of keys) await page.keyboard.up(k);
  await page.waitForTimeout(900);
  if (!r.rampOk || !r.winOk) {
    console.log(`  WARN  leg hit the ${LEG_WALL_MAX / 1000}s wall ceiling ` +
                `(ramp ok ${r.rampOk}, window ok ${r.winOk}) — leg discarded, not counted as slow`);
    return NaN;
  }
  const m = await page.evaluate(([a, b]) => window.__metres(a, b), [r.before, r.after]);
  legLog.push({ keys: keys.join('+'), bearing, dtSim: +r.dtSim.toFixed(3),
                disp: +(m / r.dtSim).toFixed(2), velMed: +r.velMed.toFixed(2),
                spread: +(r.velMax - r.velMin).toFixed(3), frames: r.frames, wallMs: r.wallMs });
  return r.dtSim < 0.3 ? NaN : m / r.dtSim;   // too few ticks to be meaningful
}

const speed = async (keys, bearing, n = 3) => {
  const rs = [];
  for (let i = 0; i < n; i++) rs.push(await speedOnce(keys, bearing));
  const ok = rs.filter(x => isFinite(x));
  // A discarded leg must not be silently averaged in as a zero or a NaN; if
  // every leg was discarded the caller gets NaN and the assertion goes red.
  return ok.length ? median(ok) : NaN;
};

// ── 1. Directional symmetry ────────────────────────────────────────

const north = await speed(['w'], 0);

const east  = await speed(['w'], 90);

const diag  = await speed(['w', 'd'], 0);

check('east/west speed matches north/south (cos-latitude corrected)',
  Math.abs(east / north - 1) <= 0.04, `east/north = ${(east / north).toFixed(3)} (want 1.00 ±0.04)`);

check('diagonal speed matches cardinal (input normalised)',
  Math.abs(diag / north - 1) <= 0.05, `diagonal/cardinal = ${(diag / north).toFixed(3)} (want 1.00 ±0.05)`);

check('forward ground speed is in a sane flythrough range',
  north > 8 && north < 80, `${north.toFixed(1)} m/s at zoom 16.5`);

// ── 2. Vertical control ────────────────────────────────────────────

{
  await page.evaluate(() => window.__reset(90));
  await page.waitForTimeout(400);
  const a0 = await page.evaluate(() => window.__cam());
  await page.keyboard.down('q'); await page.waitForTimeout(600); await page.keyboard.up('q');
  await page.waitForTimeout(600);
  const a1 = await page.evaluate(() => window.__cam());
  await page.keyboard.down('q'); await page.waitForTimeout(600); await page.keyboard.up('q');
  await page.waitForTimeout(600);
  const a2 = await page.evaluate(() => window.__cam());
  await page.keyboard.down('e'); await page.waitForTimeout(600); await page.keyboard.up('e');
  await page.waitForTimeout(600);
  const a3 = await page.evaluate(() => window.__cam());

  check('Q does not teleport the camera',
    Math.abs(a1.zoom - a0.zoom) < 1.0, `zoom ${a0.zoom.toFixed(2)} -> ${a1.zoom.toFixed(2)} (want <1.0 change)`);
  check('Q keeps working on a second press',
    Math.abs(a2.alt - a1.alt) > 1, `alt ${a1.alt.toFixed(1)} -> ${a2.alt.toFixed(1)} m`);
  check('Q and E move altitude in opposite directions',
    Math.sign(a1.alt - a0.alt) === -Math.sign(a3.alt - a2.alt) && a1.alt !== a0.alt,
    `Q: ${a0.alt.toFixed(0)}->${a1.alt.toFixed(0)}m, E: ${a2.alt.toFixed(0)}->${a3.alt.toFixed(0)}m`);
}

// ── 3. Looking around must not change how high you are ─────────────

{
  await page.evaluate(() => window.__reset(90, 16.5, 55));
  await page.waitForFunction(() => window.__idle(), null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(400);
  const b = await page.evaluate(() => window.__cam());
  const box = await page.evaluate(() => window.__map.getCanvas().getBoundingClientRect());
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + i * 10);
    await page.waitForTimeout(30);
  }
  await page.mouse.up();
  await page.waitForTimeout(800);
  const a = await page.evaluate(() => window.__cam());
  check('drag-to-look holds altitude steady',
    Math.abs(a.alt / b.alt - 1) <= 0.06,
    `pitch ${b.pitch.toFixed(0)}->${a.pitch.toFixed(0)}, alt ${b.alt.toFixed(0)}->${a.alt.toFixed(0)} m (want <6% change)`);
  check('drag-to-look actually changed the pitch',
    Math.abs(a.pitch - b.pitch) > 5, `pitch delta ${(a.pitch - b.pitch).toFixed(1)}°`);
}

// ── 4. A focused widget owns its OWN keys, and nothing else ────────
//
// This assertion used to read "camera stays put while a UI control has focus"
// and it was wrong — it encoded the defect. `controls.js` swallowed every key
// for any INPUT/SELECT/TEXTAREA/BUTTON, and the only form controls this app has
// are a checkbox, the time-of-day slider and the play button, none of which does
// anything with W. So clicking the daylight slider killed WASD until you clicked
// the canvas again, this test asserted that it should, and it passed for months.
//
// It only ever bit on Windows: macOS does not focus a button or a slider on
// click. That is why it was reported as an Acer-only hardware fault.
//
// The real contract: the slider owns the ARROW keys, the camera owns the
// letters. scripts/verify/focus-move.mjs covers every case; this keeps the
// headline one where the movement suite will see it.

{
  await page.evaluate(() => window.__reset(0));
  await page.waitForTimeout(300);
  const b = await page.evaluate(() => window.__cam());
  await page.focus('#tod-slider');
  await page.keyboard.down('d'); await page.waitForTimeout(700); await page.keyboard.up('d');
  await page.waitForTimeout(500);
  const a = await page.evaluate(() => window.__cam());
  const m = await page.evaluate(([x, y]) => window.__metres(x, y), [b, a]);
  check('camera still flies while the daylight slider has focus', m > 3, `moved ${m.toFixed(1)} m (want >3)`);
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
}

// ── 5. Losing window focus must not leave a key stuck down ─────────

{
  await page.evaluate(() => window.__reset(0));
  await page.waitForTimeout(300);
  await page.keyboard.down('w');
  await page.waitForTimeout(400);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.waitForTimeout(900);                   // glide should have ended
  const b = await page.evaluate(() => window.__cam());
  await page.waitForTimeout(1500);
  const a = await page.evaluate(() => window.__cam());
  await page.keyboard.up('w');
  const drift = await page.evaluate(([x, y]) => window.__metres(x, y), [b, a]);
  check('window blur releases held keys', drift < 1.0, `drifted ${drift.toFixed(1)} m after blur (want <1)`);
}

// ── 6. Momentum: ramp up, and glide to a stop ──────────────────────

{
  await page.evaluate(() => window.__reset(0));
  await page.waitForFunction(() => window.__idle(), null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);
  // Sample the controller's OWN velocity rather than differencing positions —
  // at these frame rates a 100 ms position window can contain zero ticks.
  const trace = await page.evaluate(async () => {
    const out = [];
    const t0 = window.__fly.simTime();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }));
    for (let i = 0; i < 40; i++) {
      await new Promise(r => requestAnimationFrame(r));
      const e = window.__fly.eye();
      out.push({ t: +(window.__fly.simTime() - t0).toFixed(3), sp: +Math.hypot(e.vE, e.vN).toFixed(2) });
    }
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true }));
    return out;
  });
  const cruise = Math.max(...trace.map(x => x.sp));
  const early = trace.find(x => x.t >= 0.08);
  check('movement eases in rather than snapping to full speed',
    !!early && early.sp < cruise * 0.75,
    early ? `at t=${early.t}s speed was ${early.sp} m/s, peak ${cruise.toFixed(1)} m/s`
          : 'no sample near t=0.08s');

  const glide = await page.evaluate(async () => {
    const before = window.__fly.eye();
    const t0 = window.__fly.simTime();
    let last = before;
    for (let i = 0; i < 60; i++) { await new Promise(r => requestAnimationFrame(r)); last = window.__fly.eye(); }
    return { sp0: Math.hypot(before.vE, before.vN), sp1: Math.hypot(last.vE, last.vN),
             dt: window.__fly.simTime() - t0 };
  });
  check('movement glides to a stop after key release',
    glide.sp0 > 1 && glide.sp1 < 0.1,
    `speed ${glide.sp0.toFixed(1)} -> ${glide.sp1.toFixed(2)} m/s over ${glide.dt.toFixed(2)}s of sim`);
}

// ── 7. Altitude floor: never end up inside a building ──────────────

{
  await page.evaluate(() => window.__reset(90));
  await page.waitForTimeout(300);
  await page.keyboard.down('e');          // dive
  await page.waitForTimeout(4000);
  await page.keyboard.up('e');
  await page.waitForTimeout(1200);
  const c = await page.evaluate(() => window.__cam());
  const roof = await page.evaluate(() => {
    const t = window.__map.transform, ll = t.getCameraLngLat();
    return (typeof window.__groundHeightAt === 'function') ? window.__groundHeightAt(ll.lng, ll.lat) : null;
  });
  check('diving bottoms out above the rooftops, not inside them',
    c.alt > (roof == null ? 0 : roof) + 2,
    `camera altitude ${c.alt.toFixed(1)} m, local max roof ${roof == null ? 'n/a' : roof.toFixed(1) + ' m'}`);
}

// ── 8. No runtime errors ───────────────────────────────────────────

check('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | ') || 'none');

const pass = results.filter(r => r.pass).length;

console.log('');

for (const r of results) console.log(`${r.pass ? ' PASS' : '*FAIL'}  ${r.name}\n         ${r.detail}`);

console.log(`\n${pass}/${results.length} passed`);

await browser.__done();

if (!REPORT_ONLY && pass !== results.length) process.exit(1);
