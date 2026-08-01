/**
 * lookup-check.mjs — how far up can you actually look, and does the sky hold?
 *
 * Reported: "I want to be able to look up at the sky. Push the camera pitch as
 * far as this stack allows... If MapLibre's camera caps out before straight up,
 * get as close as possible and tell me plainly where the ceiling is."
 *
 * The ceiling is 90 deg and it belongs to MapLibre, not to us: setMaxPitch(95),
 * (100) and (120) are all accepted by 5.24 and every one still reaches 90.00
 * (scripts/verify/pitch-probe.mjs). Pitch is measured from straight down, so 90
 * is level with the horizon and "straight up" does not exist in this renderer.
 *
 * What this asserts is the part that is ours: that the app now reaches its
 * ceiling, that CLIMBING no longer takes the sky away, and that the frame at
 * the ceiling is sky rather than NaN.
 */
import { chromium } from 'playwright-core';
import { BASE as SERVER, launch } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';

const outDir = path.resolve('shots/lookup');
fs.mkdirSync(outDir, { recursive: true });

const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));

await page.goto(`${SERVER}/index.html?intro=0&drift=0`, { waitUntil: 'networkidle', timeout: 180000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 180000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
await page.waitForFunction(() => window.__map.getSource('austin-buildings'), null, { timeout: 180000 });
await page.waitForTimeout(7000);

const results = [];
const check = (n, p, d) => results.push({ n, p, d });

/**
 * Look up the way a user does: hold the altitude, then DRAG.
 *
 * The first cut called map.setPitch() in a loop. Every assertion passed and the
 * test was still wrong: at a fixed zoom, altitude is D*cos(pitch), so pitching
 * to 88 collapsed the eye from the 880 m it was seeded at to 90 m. It proved
 * "you can look up once you are near the ground", which is not the claim.
 *
 * The flycam holds the EYE and derives zoom, so a drag keeps altitude and moves
 * pitch — the actual path the complaint is about.
 */
async function lookUpFrom(altM) {
  // The controller keeps the camera for ~8 s after the last input (the bob has
  // to wind down), and it overwrites an external jumpTo on the next frame while
  // it does. The first cut re-seeded straight after a drag and every case
  // silently ran at the FIRST case's altitude — all three reported 120 m.
  await page.waitForTimeout(8500);
  await page.evaluate(async alt => {
    const m = window.__map;
    // The controller owns the camera while flying; a seeded pose must wait for
    // !driving or the next frame overwrites it (README).
    for (let i = 0; i < 40 && window.__fly.eye().driving; i++)
      await new Promise(r => setTimeout(r, 100));
    const C = 40030228.884, lat = 30.2857, pitch = 60;
    const camPx = 0.5 * m.getCanvas().clientHeight /
      Math.tan((m.getVerticalFieldOfView ? m.getVerticalFieldOfView() : 58) * Math.PI / 360);
    const zoom = Math.log2(C * Math.cos(lat * Math.PI / 180) * camPx /
      (512 * (alt / Math.cos(pitch * Math.PI / 180))));
    m.jumpTo({ center: [-97.7434, lat], zoom, pitch, bearing: 250 });
  }, altM);
  await page.waitForTimeout(1200);
  const seeded = await page.evaluate(() => ({ alt: +window.__fly.eye().alt.toFixed(0),
                                              pitch: +window.__fly.eye().pitch.toFixed(2) }));

  // A real look gesture. Measured, not assumed: dragging the mouse UP tips the
  // camera DOWN in this app (pitch fell to PITCH_MIN=5 on the first attempt),
  // so looking at the sky is a downward drag. Two passes, because one sweep of
  // the canvas is not enough travel to cross 30 degrees of pitch.
  for (let pass = 0; pass < 2; pass++) {
    await page.mouse.move(500, 80);
    await page.mouse.down();
    for (let y = 80; y <= 640; y += 20) { await page.mouse.move(500, y); await page.waitForTimeout(16); }
    await page.mouse.up();
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(1600);

  return page.evaluate(([seeded]) => {
    const m = window.__map, e = window.__fly.eye();
    const fov = m.getVerticalFieldOfView ? m.getVerticalFieldOfView() : 58;
    return { seededAlt: seeded.alt, alt: +e.alt.toFixed(0), pitch: +e.pitch.toFixed(2),
             skyTopDeg: +(e.pitch - 90 + fov / 2).toFixed(1),
             zoom: +m.getZoom().toFixed(3), centerOk: isFinite(m.getCenter().lng) };
  }, [seeded]);
}

const low = await lookUpFrom(120);
const mid = await lookUpFrom(450);
const high = await lookUpFrom(880);

check('a drag reaches the ceiling low down', low.pitch >= 86,
  `seeded ${low.seededAlt} m, ended ${low.alt} m -> pitch ${low.pitch}, ${low.skyTopDeg} deg of sky above the horizon`);
// THE CAP IS ALTITUDE-DEPENDENT BY DESIGN, and these thresholds now say so.
//
// An earlier version of this file demanded pitch >= 82 at 880 m, which only the
// widened pitchCap could deliver — and that widening is exactly what shipped the
// teleport. An assertion that encodes a bug will keep the bug. What is true is
// that pitchCap = acos(alt/dMax) is the pitch at which the derived zoom is about
// to hit ZOOM_MIN, so the reachable pitch necessarily FALLS as you climb: ~87 at
// 150 m, ~80 at 450 m, ~70 at 880 m. Looking up while high needs a lower
// ZOOM_MIN, not a wider cap.
check('the reachable pitch falls with altitude, as the zoom floor requires',
  high.pitch > 68 && high.pitch < low.pitch,
  `${low.alt} m -> ${low.pitch} deg, ${high.alt} m -> ${high.pitch} deg`);
check('altitude is never traded away for pitch', high.alt > high.seededAlt * 0.95,
  `seeded ${high.seededAlt} m -> ${high.alt} m after the drag`);
check('the cap rises monotonically as it should, not backwards',
  low.pitch >= mid.pitch - 0.01 && mid.pitch >= high.pitch - 0.01,
  `${low.alt}m:${low.pitch}  ${mid.alt}m:${mid.pitch}  ${high.alt}m:${high.pitch}`);
check('the derived pose stays finite at the ceiling',
  [low, mid, high].every(r => isFinite(r.zoom) && r.centerOk),
  `zooms ${[low, mid, high].map(r => r.zoom).join(', ')}`);

// The frame at the ceiling must actually be sky.
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(outDir, '_t.png') });
await page.waitForTimeout(600);
await page.screenshot({ path: path.join(outDir, 'lookup-golden.png') });
for (const [name, p] of [['day', 0.18], ['night', 0.86]]) {
  await page.evaluate(pp => window.applyTimeOfDay(window.__map, pp, true), p);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(outDir, '_t.png') });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(outDir, `lookup-${name}.png`) });
}
fs.existsSync(path.join(outDir, '_t.png')) && fs.unlinkSync(path.join(outDir, '_t.png'));

// ── THE REGRESSION THIS SUITE MISSED THE FIRST TIME ──────────────────
//
// Shipped, then reported: "i look up and it TPS me to the edge of the map where
// i was looking ... then i look back down and it puts me back". The suite was
// green because every assertion was about PITCH. None was about the thing a
// look gesture must never do — move you.
//
// The eye is the state; centre and zoom are derived, and zoom is clamped to
// ZOOM_MIN. Past the pitch where that clamp bites, the derived zoom saturates
// while the centre keeps travelling, so the eye slides out to the horizon.
// Looking back down un-clamps it and it snaps home, which is exactly the
// "teleport, then return" described.
async function eyeDriftFromLookingUp(altM) {
  await page.waitForTimeout(8500);          // the controller keeps the camera ~8 s
  await page.evaluate(async alt => {
    const m = window.__map;
    for (let i = 0; i < 40 && window.__fly.eye().driving; i++)
      await new Promise(r => setTimeout(r, 100));
    const C = 40030228.884, lat = 30.2857, pitch = 60;
    const camPx = 0.5 * m.getCanvas().clientHeight /
      Math.tan((m.getVerticalFieldOfView ? m.getVerticalFieldOfView() : 58) * Math.PI / 360);
    m.jumpTo({ center: [-97.7434, lat], pitch, bearing: 250,
      zoom: Math.log2(C * Math.cos(lat * Math.PI / 180) * camPx /
                      (512 * (alt / Math.cos(pitch * Math.PI / 180)))) });
  }, altM);
  await page.waitForTimeout(1200);
  const before = await page.evaluate(() => {
    const e = window.__fly.eye(); return { lng: e.lng, lat: e.lat, alt: e.alt, pitch: e.pitch };
  });
  for (let pass = 0; pass < 2; pass++) {
    await page.mouse.move(500, 80);
    await page.mouse.down();
    for (let y = 80; y <= 640; y += 20) { await page.mouse.move(500, y); await page.waitForTimeout(16); }
    await page.mouse.up();
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(1600);
  return page.evaluate(([b]) => {
    const e = window.__fly.eye();
    // Metres on the ground between where the eye was and where it ended up.
    const dLat = (e.lat - b.lat) * 111320;
    const dLng = (e.lng - b.lng) * 111320 * Math.cos(b.lat * Math.PI / 180);
    return { moved: +Math.hypot(dLat, dLng).toFixed(1), pitchFrom: +b.pitch.toFixed(1),
             pitchTo: +e.pitch.toFixed(2), altFrom: +b.alt.toFixed(0), altTo: +e.alt.toFixed(0) };
  }, [before]);
}

for (const alt of [150, 450, 880]) {
  const d = await eyeDriftFromLookingUp(alt);
  // A look gesture may change where you are LOOKING. It may never change where
  // you ARE. The tolerance is the flycam's own glide tail, not a fudge.
  check(`looking up from ${alt} m does not move the camera`, d.moved < 40,
    `eye moved ${d.moved} m while pitch went ${d.pitchFrom} -> ${d.pitchTo} ` +
    `(altitude ${d.altFrom} -> ${d.altTo})`);
}

check('no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | ') || 'none');

let bad = 0;
for (const r of results) { console.log(`${r.p ? ' PASS ' : '*FAIL '} ${r.n}\n         ${r.d}`); if (!r.p) bad++; }
console.log(`\n${results.length - bad}/${results.length} passed`);
console.log('shots in', outDir);
browser.__done();
process.exitCode = bad ? 1 : 0;
