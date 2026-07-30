/**
 * idle.mjs — the camera must not move when nobody is touching it.
 *
 * This exists because "the bearing drifts on its own while idle" was reported
 * (2026-07-29) and turned out to be the 9-second cinematic intro `easeTo` in
 * app.js startIntro() still running: bearing 60 -> 90, ease-out cubic. The
 * report's own diagnostic read `__fly.eye().driving === false` and concluded the
 * flight controller was leaking a write. It was not. `driving` only answers "did
 * js/controls.js write the camera this frame" — it says nothing about an
 * EXTERNAL animation owning it, and during the intro the controller is correctly
 * standing aside. `map.isEasing()` was true the whole time.
 *
 * So this script asserts two separate things, and prints isEasing next to every
 * sample so the next person cannot make the same inference:
 *
 *   A. with the intro OFF, the pose is bit-exact stable over a long idle window
 *      at several seeded poses and after every kind of input has been released;
 *   B. with the intro ON, the bearing DOES move — and isEasing() explains it.
 *
 * Part B is asserted on purpose. If it ever stops moving, either the intro was
 * silently lost or `?intro=0` stopped being honoured, and part A becomes a test
 * that proves nothing.
 */
import { chromium } from 'playwright-core';
import { chromePath, GL_ARGS, BASE } from './chrome.mjs';

const IDLE_MS = Number(process.env.IDLE_MS || 12000);
const M_LAT = 111195.08;
const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${msg}`); if (!cond) fails.push(msg); };

async function open(url) {
  const browser = await chromium.launch({ executablePath: chromePath(), args: GL_ARGS });
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
  // The probe fires 11 s in and rewrites every setting; left running it lands
  // mid-test. It does not touch the camera, but cancel it anyway so a failure
  // here is never blamed on it.
  await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
  return { browser, page };
}

/** Wait for BOTH owners to let go, then watch the pose for `ms` with no input. */
function idleProbe() {
  return async function (page, ms) {
    return page.evaluate(async (ms) => {
      const map = window.__map;
      for (let i = 0; i < 1200; i++) {
        if (!window.__fly.eye().driving && !map.isEasing()) break;
        await new Promise(r => requestAnimationFrame(r));
      }
      const snap = () => ({ b: map.getBearing(), p: map.getPitch(), z: map.getZoom(),
                            lng: map.getCenter().lng, lat: map.getCenter().lat,
                            easing: map.isEasing(), moving: map.isMoving(),
                            ...window.__fly.eye() });
      const a = snap();
      let drivingFrames = 0, easingFrames = 0, frames = 0, maxB = -Infinity, minB = Infinity;
      const t0 = performance.now();
      await new Promise(res => {
        const step = () => {
          frames++;
          const bb = map.getBearing();
          if (bb > maxB) maxB = bb;
          if (bb < minB) minB = bb;
          if (window.__fly.eye().driving) drivingFrames++;
          if (map.isEasing()) easingFrames++;
          if (performance.now() - t0 < ms) requestAnimationFrame(step); else res();
        };
        requestAnimationFrame(step);
      });
      return { a, b: snap(), frames, drivingFrames, easingFrames, spanB: maxB - minB };
    }, ms);
  };
}
const probe = idleProbe();

function report(label, r) {
  const dB = r.b.b - r.a.b, dP = r.b.p - r.a.p, dZ = r.b.z - r.a.z;
  const dM = Math.hypot((r.b.lat - r.a.lat) * M_LAT,
                        (r.b.lng - r.a.lng) * M_LAT * Math.cos(r.a.lat * Math.PI / 180));
  // Tolerances are far below anything visible; the observed value is exactly 0.
  const still = Math.abs(dB) <= 0.01 && Math.abs(dP) <= 0.01 && Math.abs(dZ) <= 0.001 && dM <= 0.5;
  ok(still, `${label.padEnd(26)} dBearing ${dB.toFixed(4)}  dPitch ${dP.toFixed(4)}  ` +
            `dZoom ${dZ.toFixed(5)}  dCentre ${dM.toFixed(2)} m  ` +
            `(bearing span ${r.spanB.toFixed(4)}, driving ${r.drivingFrames}/${r.frames}, ` +
            `easing ${r.easingFrames}/${r.frames})`);
  return still;
}

// ── A. intro off: nothing may move ───────────────────────────────────
{
  const { browser, page } = await open(`${BASE}/index.html?intro=0`);
  await page.waitForTimeout(3000);

  ok(await page.evaluate(() => window.__map.getBearing()) === 90,
     'intro=0 leaves the camera on the exact spawn bearing (90)');

  const POSES = [
    ['spawn',              { center: [-97.7434, 30.2857], zoom: 16.5, pitch: 64, bearing: 90 }],
    // pitch 84 with maxPitch 85 — where a transform renormalisation would show up
    ['high pitch 84',      { center: [-97.7434, 30.2857], zoom: 16.5, pitch: 84, bearing: 137.5 }],
    // near ZOOM_MIN and a high pitch, so altCeiling() binds hard
    ['zoomed out + pitch',  { center: [-97.7434, 30.2857], zoom: 14.6, pitch: 80, bearing: 212.3 }],
    ['low over street',    { center: [-97.7429, 30.2861], zoom: 18.6, pitch: 70, bearing: 311.7 }],
    // the exact bearing from the original report
    ['odd bearing 84.85',  { center: [-97.7434, 30.2857], zoom: 16.5, pitch: 64, bearing: 84.8535 }],
  ];
  for (const [name, pose] of POSES) {
    await page.evaluate(async (pose) => {
      const map = window.__map;
      for (let i = 0; i < 600; i++) {                 // the controller owns the camera while flying
        if (!window.__fly.eye().driving && !map.isEasing()) break;
        await new Promise(r => requestAnimationFrame(r));
      }
      map.stop();
      map.jumpTo(pose);
      await new Promise(r => setTimeout(r, 700));
    }, pose);
    report(`idle @ ${name}`, await probe(page, IDLE_MS));
  }

  // ── Post-input release edges. A stable idle window proves nothing if the
  // input before it was a no-op, so each one is measured for effect first.
  const eye = () => page.evaluate(() => window.__fly.eye());
  const key = (type, code) => page.evaluate(({ type, code }) =>
    window.dispatchEvent(new KeyboardEvent(type, { code, key: code, bubbles: true })), { type, code });

  const before = await eye();
  await key('keydown', 'KeyW');
  await page.waitForTimeout(1800);
  await key('keyup', 'KeyW');
  await page.waitForTimeout(1200);
  const after = await eye();
  const flew = Math.hypot((after.lat - before.lat) * M_LAT,
                          (after.lng - before.lng) * M_LAT * Math.cos(before.lat * Math.PI / 180));
  ok(flew > 5, `W burst actually drove the camera (${flew.toFixed(1)} m)`);
  report('idle after W burst', await probe(page, IDLE_MS));

  const bDrag = (await eye()).bearing;
  await page.mouse.move(450, 350);
  await page.mouse.down();
  for (let i = 0; i < 12; i++) await page.mouse.move(450 + i * 14, 350 + i * 3);
  await page.mouse.up();
  await page.waitForTimeout(600);
  ok(Math.abs((await eye()).bearing - bDrag) > 1, 'look drag actually rotated the camera');
  report('idle after look drag', await probe(page, IDLE_MS));

  // Rooftop floor engaged: the arbitration comment warns that testing
  // `altFloor > 0` here would pin `driving` true forever.
  const roof = await page.evaluate(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'KeyW', bubbles: true }));
    for (let i = 0; i < 900; i++) {
      if (window.__fly.eye().altFloor > 5) break;
      await new Promise(r => requestAnimationFrame(r));
    }
    const f = window.__fly.eye().altFloor;
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', key: 'KeyW', bubbles: true }));
    return f;
  });
  ok(roof > 5, `flight reached a rooftop floor (${roof.toFixed(1)} m)`);
  report('idle after rooftop flight', await probe(page, IDLE_MS));

  const aWheel = (await eye()).altUser;
  await page.mouse.move(450, 350);
  await page.mouse.wheel(0, -600);
  await page.waitForTimeout(1200);
  ok(Math.abs((await eye()).altUser - aWheel) > 1, 'wheel actually changed altitude');
  report('idle after wheel climb', await probe(page, IDLE_MS));

  await browser.close();
}

// ── B. intro on: the bearing moves, and isEasing says why ────────────
{
  const { browser, page } = await open(`${BASE}/index.html`);
  const sample = () => page.evaluate(() => ({
    b: window.__map.getBearing(), easing: window.__map.isEasing(),
    driving: window.__fly ? window.__fly.eye().driving : null,
  }));
  await page.waitForTimeout(4000);
  const a = await sample();
  await page.waitForTimeout(1600);
  const b = await sample();
  await browser.close();

  console.log(`      intro tween: bearing ${a.b.toFixed(4)} -> ${b.b.toFixed(4)} ` +
              `(easing ${a.easing}/${b.easing}, driving ${a.driving}/${b.driving})`);
  ok(Math.abs(b.b - a.b) > 1, 'intro ON: the bearing moves during the 9 s tween');
  ok(a.easing && b.easing, 'intro ON: isEasing() is true throughout — the mover is MapLibre, not controls.js');
  ok(a.driving === false && b.driving === false,
     'intro ON: the flight controller correctly stands aside (driving stays false)');
}

console.log(fails.length ? `\n${fails.length} FAILED` : `\nall idle assertions passed`);
process.exit(fails.length ? 1 : 0);
