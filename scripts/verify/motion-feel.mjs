/**

 * motion-feel.mjs — assertions for the camera FEEL pass (bank roll, FOV kick,
 * hover bob, landing settle, and the arbitration hand-back).

 *

 * All timings are measured against window.__fly.simTime(), never the wall

 * clock (headless swiftshader runs 4–20 fps). Inputs are dispatched as

 * KeyboardEvent/PointerEvent inside the page so a whole gesture happens in

 * page-frame lockstep regardless of renderer speed.

 *

 * Usage: node motion-feel.mjs   (exit 1 on failure)

 */

import { chromium } from 'playwright-core';

const browser = await launch(chromium);

const page = await browser.newPage({ viewport: { width: 800, height: 560 } });

const pageErrors = [];

page.on('pageerror', e => pageErrors.push(e.message));

await page.goto(`${BASE}/index.html?intro=0`, { waitUntil: 'networkidle', timeout: 60000 });

await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });

await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

await page.waitForFunction(() => window.__fly && window.__fly.indexed(), null, { timeout: 30000 });

await page.waitForTimeout(3000);

const results = [];

const check = (name, pass, detail) => results.push({ name, pass, detail });

await page.evaluate(() => {
  window.__raf = () => new Promise(r => requestAnimationFrame(r));
  // Wait until the controller releases the camera — REQUIRED before any
  // external jumpTo, or the seed is overwritten next frame. The feel effects
  // (bob) can hold ownership up to BOB_TIMEOUT sim-seconds after the last
  // input, so the budget is generous.
  window.__settle = async (frames = 400) => {
    for (let i = 0; i < frames; i++) {
      if (!window.__fly.eye().driving) return true;
      await window.__raf();
    }
    return false;
  };
  window.__key = (code, down) => window.dispatchEvent(
    new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }));
  // A synthetic mouse look-drag on the canvas: n steps of dx,dy each.
  window.__dragStart = (x, y) => {
    const cv = window.__map.getCanvas();
    cv.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 77, pointerType: 'mouse',
      button: 0, clientX: x, clientY: y, bubbles: true, cancelable: true, isPrimary: true }));
    window.__dragXY = { x, y };
  };
  window.__dragMove = (dx, dy) => {
    const cv = window.__map.getCanvas();
    window.__dragXY.x += dx; window.__dragXY.y += dy;
    cv.dispatchEvent(new PointerEvent('pointermove', { pointerId: 77, pointerType: 'mouse',
      clientX: window.__dragXY.x, clientY: window.__dragXY.y,
      movementX: dx, movementY: dy, bubbles: true, cancelable: true, isPrimary: true }));
  };
  window.__dragEnd = () => {
    const cv = window.__map.getCanvas();
    cv.dispatchEvent(new PointerEvent('pointerup', { pointerId: 77, pointerType: 'mouse',
      clientX: window.__dragXY.x, clientY: window.__dragXY.y, bubbles: true, cancelable: true, isPrimary: true }));
  };
});

import { chromePath, GL_ARGS, BASE, launch } from './chrome.mjs';

const TUNE = await page.evaluate(() => window.__fly.tune);

console.log('TUNE:', JSON.stringify(TUNE));

// ── 1. BANK: roll rises with yaw rate, correct sign, clamped, returns to 0 ──

{
  const r = await page.evaluate(async () => {
    await window.__settle();
    const F = window.__fly, m = window.__map;
    const trace = [];
    // fly forward and sweep a long look-drag: right drag turns (bearing falls)
    window.__key('KeyW', true);
    window.__dragStart(400, 280);
    let maxAbsRoll = 0, rollAtPeakYaw = 0, peakYaw = 0, b0 = F.eye().bearing;
    for (let i = 0; i < 55; i++) {
      window.__dragMove(14, 0);                   // steady rightward drag
      await window.__raf();
      const fx = F.fx(), e = F.eye();
      trace.push({ t: +F.simTime().toFixed(3), roll: +fx.roll.toFixed(3),
                   yawRate: +fx.yawRate.toFixed(1), mapRoll: +m.getRoll().toFixed(3) });
      if (Math.abs(fx.roll) > maxAbsRoll) maxAbsRoll = Math.abs(fx.roll);
      if (Math.abs(fx.yawRate) > Math.abs(peakYaw)) { peakYaw = fx.yawRate; rollAtPeakYaw = fx.roll; }
    }
    const bearingDelta = ((F.eye().bearing - b0 + 540) % 360) - 180;
    const midShotRoll = m.getRoll();
    // stop the turn but keep flying; measure the sim-time for |roll| < 0.05
    window.__dragEnd();
    const tStop = F.simTime();
    let tLevel = null;
    for (let i = 0; i < 200; i++) {
      await window.__raf();
      if (Math.abs(m.getRoll()) < 0.05) { tLevel = F.simTime() - tStop; break; }
    }
    window.__key('KeyW', false);
    return { trace: trace.filter((_, i) => i % 6 === 0), maxAbsRoll, peakYaw, rollAtPeakYaw,
             bearingDelta, midShotRoll, tLevel };
  });
  console.log('bank trace (every 6th):', JSON.stringify(r.trace));
  check('roll rises with yaw rate (>=1.5 deg at sustained turn)',
    r.maxAbsRoll >= 1.5, `max |roll| ${r.maxAbsRoll.toFixed(2)} deg at peak yaw ${r.peakYaw.toFixed(0)} deg/s`);
  check('roll never exceeds TUNE.BANK_MAX',
    r.maxAbsRoll <= (await page.evaluate(() => window.__fly.tune.BANK_MAX)) + 0.05,
    `max |roll| ${r.maxAbsRoll.toFixed(2)} deg`);
  check('bank is INTO the turn (sign of roll matches sign of bearing rate)',
    r.peakYaw !== 0 && Math.sign(r.rollAtPeakYaw) === Math.sign(r.peakYaw),
    `yawRate ${r.peakYaw.toFixed(0)} deg/s -> roll ${r.rollAtPeakYaw.toFixed(2)} deg (bearing moved ${r.bearingDelta.toFixed(0)} deg)`);
  check('roll returns to |roll| < 0.05 deg within ~1 s of the turn stopping',
    r.tLevel !== null && r.tLevel <= 1.2, `levelled in ${r.tLevel == null ? '>budget' : r.tLevel.toFixed(2) + ' s'} (sim)`);
}

// ── 2. STRAFE LEAN: A/D lean opposite ways; level again after release ──

{
  const r = await page.evaluate(async () => {
    const F = window.__fly, m = window.__map;
    window.__key('KeyD', true);
    let rollD = 0;
    for (let i = 0; i < 30; i++) { await window.__raf(); rollD = F.fx().roll; }
    window.__key('KeyD', false);
    for (let i = 0; i < 90; i++) { await window.__raf(); if (m.getRoll() === 0) break; }
    window.__key('KeyA', true);
    let rollA = 0;
    for (let i = 0; i < 30; i++) { await window.__raf(); rollA = F.fx().roll; }
    window.__key('KeyA', false);
    const t0 = F.simTime();
    let tLevel = null;
    for (let i = 0; i < 200; i++) {
      await window.__raf();
      if (Math.abs(m.getRoll()) < 0.05) { tLevel = F.simTime() - t0; break; }
    }
    return { rollD, rollA, tLevel };
  });
  check('strafe D leans right (+roll) and A leans left (-roll)',
    r.rollD > 0.5 && r.rollA < -0.5 && Math.sign(r.rollD) === -Math.sign(r.rollA),
    `D: ${r.rollD.toFixed(2)} deg, A: ${r.rollA.toFixed(2)} deg`);
  check('strafe lean releases to level within ~1 s',
    r.tLevel !== null && r.tLevel <= 1.2, `levelled in ${r.tLevel == null ? '>budget' : r.tLevel.toFixed(2) + ' s'} (sim)`);
}

// ── 3. FOV KICK: rises with actual speed, restores base exactly ──

{
  const r = await page.evaluate(async () => {
    const F = window.__fly, m = window.__map;
    await window.__settle();
    const base = window.GFX.fov;
    const fovRest = m.getVerticalFieldOfView();
    // Climb above the rooftops first: at spawn altitude the brake probes keep
    // shaving actual speed over downtown, and the kick (correctly) tracks
    // ACTUAL speed, so a low sprint measures the brakes, not the kick.
    window.__key('KeyQ', true);
    for (let i = 0; i < 30; i++) await window.__raf();
    window.__key('KeyQ', false);
    // full sprint until the kick settles; track the sustained maximum
    window.__key('ShiftLeft', true);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', shiftKey: true, bubbles: true }));
    let fovSprint = 0, spPeak = 0, kick = 0;
    for (let i = 0; i < 60; i++) {
      await window.__raf();
      const e = F.eye();
      spPeak = Math.max(spPeak, Math.hypot(e.vE, e.vN));
      fovSprint = Math.max(fovSprint, m.getVerticalFieldOfView());
      kick = Math.max(kick, F.fx().fovKick);
    }
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true }));
    window.__key('ShiftLeft', false);
    // glide out; fov must come back to base exactly once idle
    const ok = await window.__settle(600);
    const fovAfter = m.getVerticalFieldOfView();
    return { base, fovRest, fovSprint, kick, spPeak, settled: ok, fovAfter };
  });
  check('FOV at rest equals the graphics-menu base',
    Math.abs(r.fovRest - r.base) < 0.01, `rest ${r.fovRest.toFixed(2)} vs base ${r.base}`);
  check('sustained sprint kicks the FOV up by 2.5–4.5 deg',
    r.fovSprint - r.base >= 2.5 && r.fovSprint - r.base <= 4.5,
    `sprint FOV ${r.fovSprint.toFixed(2)} (base ${r.base}, kick ${r.kick.toFixed(2)}, peak speed ${r.spPeak.toFixed(0)} m/s)`);
  check('FOV restores exactly to base after stopping',
    r.settled && Math.abs(r.fovAfter - r.base) < 0.01,
    `after: ${r.fovAfter.toFixed(3)} (settled=${r.settled})`);
}

// ── 4. HOVER BOB: breathes while hovering, wound down by BOB_TIMEOUT ──

{
  const r = await page.evaluate(async () => {
    const F = window.__fly, m = window.__map, T = F.tune;
    // a short flight, then hands off the sticks
    window.__key('KeyW', true);
    for (let i = 0; i < 25; i++) await window.__raf();
    window.__key('KeyW', false);
    const tInput = F.simTime();
    // sample the RENDERED altitude (state + bob offset) across the hover window
    let lo = Infinity, hi = -Infinity, altOffMax = 0, sawBob = false;
    let released = null, releasedRoll = null;
    for (let i = 0; i < 900; i++) {
      await window.__raf();
      const t = F.simTime() - tInput;
      const fx = F.fx();
      altOffMax = Math.max(altOffMax, fx.altOff);
      if (fx.altOff > 0.05) sawBob = true;
      if (!F.eye().driving) { released = t; releasedRoll = m.getRoll(); break; }
      if (t > T.BOB_TIMEOUT + 4) break;
    }
    // once released, the camera must be perfectly still (no writes at all)
    const c0 = m.getCenter(), z0 = m.getZoom(), p0 = m.getPitch();
    for (let i = 0; i < 40; i++) await window.__raf();
    const c1 = m.getCenter();
    const still = Math.abs(c1.lng - c0.lng) < 1e-12 && Math.abs(c1.lat - c0.lat) < 1e-12 &&
                  Math.abs(m.getZoom() - z0) < 1e-9 && Math.abs(m.getPitch() - p0) < 1e-9;
    return { altOffMax, sawBob, released, releasedRoll, still, timeout: T.BOB_TIMEOUT };
  });
  check('hover bob breathes (altitude offset > 0.05 m seen, <= amplitude)',
    r.sawBob && r.altOffMax <= 0.5, `max bob offset ${r.altOffMax.toFixed(3)} m`);
  check('ownership releases within BOB_TIMEOUT (+2 s slack) of the last input',
    r.released !== null && r.released <= r.timeout + 2,
    `released ${r.released == null ? 'never' : r.released.toFixed(1) + ' s'} after input (timeout ${r.timeout} s)`);
  check('roll is exactly 0 at hand-back',
    r.releasedRoll === 0, `roll at release: ${r.releasedRoll}`);
  check('after release the controller writes nothing (camera perfectly still)',
    r.still === true, `still=${r.still}`);
}

// ── 5. LANDING SETTLE: a one-shot dip on arriving from speed ──

{
  const r = await page.evaluate(async () => {
    const F = window.__fly;
    // sprint to build real speed, then release and watch the arrival
    window.__key('ShiftLeft', true);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', shiftKey: true, bubbles: true }));
    for (let i = 0; i < 60; i++) await window.__raf();
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true }));
    window.__key('ShiftLeft', false);
    let minOff = 0;
    for (let i = 0; i < 400; i++) {
      await window.__raf();
      minOff = Math.min(minOff, F.fx().altOff);
      if (!F.eye().driving) break;
    }
    return { minOff };
  });
  check('landing settle dips the camera (negative altitude offset, <= SETTLE_AMP)',
    r.minOff < -0.2 && r.minOff >= -(TUNE.SETTLE_AMP + 0.05),
    `deepest settle offset ${r.minOff.toFixed(3)} m (amp ${TUNE.SETTLE_AMP})`);
}

// ── 6. ARBITRATION: external easeTo ~2 s after input stops runs untouched ──

{
  const r = await page.evaluate(async () => {
    const F = window.__fly, m = window.__map;
    // A turn-only gesture: no translation, so no momentum glide — the ONLY
    // thing that could be holding ownership 2 s later is the feel effects.
    // (With W held, the pre-existing 3 s decel glide legitimately owns the
    // camera at t+2 s — that arbitration is unchanged and not under test.)
    window.__dragStart(400, 280);
    for (let i = 0; i < 25; i++) { window.__dragMove(12, 0); await window.__raf(); }
    window.__dragEnd();
    const tStop = F.simTime();
    while (F.simTime() - tStop < 2) await window.__raf();      // ~2 s of sim later…
    const rollBeforeEase = m.getRoll();
    const c = m.getCenter();
    const target = { lng: c.lng + 0.004, lat: c.lat + 0.002 };
    let done = false;
    m.once('moveend', () => { done = true; });
    m.easeTo({ center: [target.lng, target.lat], duration: 800, bearing: 45, pitch: 60 });
    const t0 = Date.now();
    while (!done && Date.now() - t0 < 15000) await window.__raf();
    const end = m.getCenter();
    const err = Math.hypot((end.lng - target.lng) * 92000, (end.lat - target.lat) * 111000);
    return { rollBeforeEase, done, err, endBearing: m.getBearing(), endPitch: m.getPitch(),
             endRoll: m.getRoll(), driving: F.eye().driving };
  });
  check('roll is 0 before the external animation starts (~2 s after input)',
    r.rollBeforeEase === 0, `roll ${r.rollBeforeEase}`);
  check('external easeTo runs to completion, uninterrupted, and lands on target',
    r.done && r.err < 2 && Math.abs(r.endBearing - 45) < 0.5 && Math.abs(r.endPitch - 60) < 0.5,
    `moveend=${r.done}, center error ${r.err.toFixed(2)} m, bearing ${r.endBearing.toFixed(1)}, pitch ${r.endPitch.toFixed(1)}`);
  check('roll still 0 after the external animation', r.endRoll === 0, `roll ${r.endRoll}`);
}

// ── 7. YIELD: an easeTo started DURING the bob-hold window still wins ──

{
  const r = await page.evaluate(async () => {
    const F = window.__fly, m = window.__map;
    window.__key('KeyW', true);
    for (let i = 0; i < 20; i++) await window.__raf();
    window.__key('KeyW', false);
    // wait only until the glide ends and the bob is HOLDING ownership
    for (let i = 0; i < 300; i++) {
      await window.__raf();
      const e = F.eye();
      if (Math.hypot(e.vE, e.vN) < 0.05) break;
    }
    const wasDrivingAtEase = F.eye().driving;
    const c = m.getCenter();
    const target = { lng: c.lng - 0.003, lat: c.lat + 0.001 };
    let done = false;
    m.once('moveend', () => { done = true; });
    m.easeTo({ center: [target.lng, target.lat], duration: 700 });
    const t0 = Date.now();
    while (!done && Date.now() - t0 < 15000) await window.__raf();
    const end = m.getCenter();
    const err = Math.hypot((end.lng - target.lng) * 92000, (end.lat - target.lat) * 111000);
    return { wasDrivingAtEase, done, err, endRoll: m.getRoll() };
  });
  check('easeTo started while effects hold ownership: controller yields, ease completes on target',
    r.done && r.err < 2 && r.endRoll === 0,
    `driving at ease start=${r.wasDrivingAtEase}, err ${r.err.toFixed(2)} m, roll ${r.endRoll}`);
}

check('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | ') || 'none');

console.log('');

for (const r of results) console.log(`${r.pass ? ' PASS' : '*FAIL'}  ${r.name}\n         ${r.detail}`);

const pass = results.filter(r => r.pass).length;

console.log(`\n${pass}/${results.length} passed`);

await browser.__done();

if (pass !== results.length) process.exit(1);
