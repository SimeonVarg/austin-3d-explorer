/**
 * _o4-seedlag.mjs — WHY do all three of lookup-check.mjs's altitude cases run
 * at the FIRST case's altitude?
 *
 * The o4 pass ran `lookup-check.mjs` at a raised ceiling (448 s, 8/9) and it
 * printed:
 *
 *     PASS  a drag reaches the ceiling low down
 *           seeded 120 m, ended 120 m -> pitch 87.36
 *    *FAIL  the reachable pitch falls with altitude
 *           120 m -> 87.36 deg, 120 m -> 87.36 deg      <- low AND high are 120
 *     PASS  the cap rises monotonically
 *           120m:87.36  120m:87.36  120m:87.36          <- all three
 *     PASS  looking up from 880 m does not move the camera
 *           altitude 150 -> 150                          <- not 880
 *
 * `lookUpFrom(450)` and `lookUpFrom(880)` both produced an eye at 120 m, and
 * all three drift cases produced 150 m. The file's own comment (lines 88-93)
 * describes this exact defect as ALREADY FIXED:
 *
 *   "The first cut re-seeded straight after a drag and every case silently ran
 *    at the FIRST case's altitude — all three reported 120 m."
 *
 * THE HYPOTHESIS. The fix is `settled(page)`, which polls the eye and gives up
 * at a HARD `timeoutMs = 8500` whether or not the camera stopped, followed by
 * an in-page `for (i < 40 && driving) sleep 100` — another 4 s ceiling. Both
 * then seed regardless. If the flycam's ownership tail after a two-pass look
 * drag is longer than 12.5 s on this machine, the `jumpTo` lands while the
 * controller is still driving and is overwritten on the next frame (README:
 * "a seeded test must wait for !__fly.eye().driving BEFORE placing the camera,
 * or its jumpTo is overwritten"). The guard is a deadline, not a wait.
 *
 * WHAT THIS MEASURES. After the same two-pass look drag lookup-check performs,
 * how long until `driving` is false — and does a `jumpTo` issued at each of
 * lookup-check's two deadlines survive? Reported as the altitude the eye
 * actually holds 1.2 s later, which is what lookup-check reads.
 *
 * A second arm seeds only AFTER `driving` has genuinely gone false. If that arm
 * lands on 450 and 880 while the deadline arm lands on 120, the red is the
 * gate's deadline and not the app.
 *
 * Usage: VERIFY_URL=http://127.0.0.1:8512 node scripts/verify/_o4-seedlag.mjs
 */
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';

const browser = await launch(chromium, { maxMs: 900000 });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto(`${BASE}/index.html?intro=0&drift=0`, { waitUntil: 'networkidle', timeout: 180000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 180000 });
await page.evaluate(() => { try { window.cancelGraphicsAutoDetect(); } catch (e) {} });
await page.waitForFunction(() => window.__map.getSource('austin-buildings'), null, { timeout: 180000 });
await page.waitForTimeout(7000);

const consts = await page.evaluate(() => {
  const c = window.__fly.consts();
  return { ZOOM_MIN: c.ZOOM_MIN, ZOOM_MAX: c.ZOOM_MAX, ALT_MAX: c.ALT_MAX, PITCH_MAX: c.PITCH_MAX };
});
console.log('constants: ' + JSON.stringify(consts));

/** lookup-check's look gesture, verbatim: two downward sweeps of the canvas. */
async function lookDrag() {
  for (let pass = 0; pass < 2; pass++) {
    await page.mouse.move(500, 80);
    await page.mouse.down();
    for (let y = 80; y <= 640; y += 20) { await page.mouse.move(500, y); await page.waitForTimeout(16); }
    await page.mouse.up();
    await page.waitForTimeout(400);
  }
}

/** How long after the gesture does `driving` actually go false? */
async function drivingTail() {
  return page.evaluate(async () => {
    const t0 = performance.now();
    for (let i = 0; i < 600; i++) {
      if (!window.__fly.eye().driving) return +(performance.now() - t0).toFixed(0);
      await new Promise(r => setTimeout(r, 50));
    }
    return null;   // still driving after 30 s
  });
}

/** lookup-check's own placement, then what the eye is holding 1.2 s later. */
async function seed(altM) {
  await page.evaluate(alt => {
    const m = window.__map, C = 40030228.884, lat = 30.2857, pitch = 60;
    const camPx = 0.5 * m.getCanvas().clientHeight /
      Math.tan((m.getVerticalFieldOfView ? m.getVerticalFieldOfView() : 58) * Math.PI / 360);
    const zoom = Math.log2(C * Math.cos(lat * Math.PI / 180) * camPx /
      (512 * (alt / Math.cos(pitch * Math.PI / 180))));
    window.__o4wantZoom = +zoom.toFixed(3);
    m.jumpTo({ center: [-97.7434, lat], zoom, pitch, bearing: 250 });
  }, altM);
  await page.waitForTimeout(1200);
  return page.evaluate(() => ({
    alt: +window.__fly.eye().alt.toFixed(0),
    pitch: +window.__fly.eye().pitch.toFixed(2),
    wantZoom: window.__o4wantZoom,
    gotZoom: +window.__map.getZoom().toFixed(3),
    driving: window.__fly.eye().driving,
  }));
}

console.log('\nARM A — seed at lookup-check\'s own deadlines (8500 ms settled() + 4000 ms in-page)');
console.log('alt want   driving at seed   alt held   pitch    zoom want -> got');
for (const alt of [120, 450, 880]) {
  await lookDrag();
  // lookup-check's settled(): a HARD 8500 ms ceiling, then seed regardless.
  await page.waitForTimeout(8500);
  const drivingAtSeed = await page.evaluate(() => window.__fly.eye().driving);
  const r = await seed(alt);
  console.log(String(alt).padStart(8) + String(drivingAtSeed).padStart(17) +
    String(r.alt).padStart(11) + String(r.pitch).padStart(9) +
    ('   ' + r.wantZoom + ' -> ' + r.gotZoom).padStart(22));
}

console.log('\nARM B — seed only after `driving` has genuinely gone false');
console.log('alt want   driving tail ms   alt held   pitch    zoom want -> got');
for (const alt of [120, 450, 880]) {
  await lookDrag();
  const tail = await drivingTail();
  const r = await seed(alt);
  console.log(String(alt).padStart(8) + String(tail === null ? '>30000' : tail).padStart(17) +
    String(r.alt).padStart(11) + String(r.pitch).padStart(9) +
    ('   ' + r.wantZoom + ' -> ' + r.gotZoom).padStart(22));
}

console.log('\nREAD IT LIKE THIS:');
console.log('  ARM A lands on 120 for all three and ARM B lands on 120/450/880');
console.log('     -> the red is lookup-check\'s DEADLINE, not the app. The gate seeds');
console.log('        while the controller still owns the camera and is overwritten.');
console.log('  BOTH arms land on 120 and `zoom want -> got` shows a clamp');
console.log('     -> ZOOM_MIN is the ceiling and the gate\'s altitudes are unreachable.');
console.log('  ARM B\'s tail is > 12500 ms -> that is exactly the margin the gate lacks.');
await browser.__done();
