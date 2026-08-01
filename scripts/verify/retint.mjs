/**
 * retint.mjs — does dragging the sun actually retint EVERY pass?
 *
 * "the tower just became orange after having night on for like 5 minutes",
 * "the Ransom Center just became dark (didn't do anything, night just took that
 * long to render)", "the black roofs took 2 minutes to correct".
 *
 * Nothing was slow. js/timeofday.js's slider handler and auto-play loop called
 * the IIFE-LOCAL `applyTimeOfDay`, while five pass modules (tower, arts, drag,
 * moody, places) wrap `window.applyTimeOfDay` at boot to retint their own bands
 * and atlases. So the UI drove the unwrapped original and those buildings held
 * whatever hour app.js last gave them, snapping only when some unrelated event
 * happened to call the window property.
 *
 * The test therefore has to go through the REAL UI PATH — dispatch an `input`
 * event on the slider — and not call applyTimeOfDay itself, or it proves nothing.
 * It then samples pixels at buildings owned by different passes and asserts each
 * one actually changed between day and night within a short settle.
 *
 * Usage: node retint.mjs
 */
import { chromium } from 'playwright-core';
import { BASE as SERVER, launch } from './chrome.mjs';

// One probe per pass, so a regression names the module that broke.
// [name, lng, lat, zoom, pitch, bearing, owning pass]
const PROBES = [
  ['UT Tower',            -97.73932, 30.28601, 17.0, 66, 180, 'tower.js'],
  ['Harry Ransom Center', -97.74019, 30.28425, 17.3, 66,  90, 'arts.js'],
  ['The Drag',            -97.74140, 30.28560, 17.2, 66,  90, 'drag.js'],
  ['Moody College',       -97.74140, 30.28870, 17.2, 66, 180, 'moody.js'],
  ['generic campus',      -97.73760, 30.28514, 17.2, 66, 180, 'app.js (control)'],
];

// How long the UI is given to land the change. The whole point is that this is
// SHORT: the reported failure took minutes, so anything that needs more than a
// couple of seconds is still broken.
const SETTLE_MS = 2500;

const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));

await page.goto(SERVER + '/_harness.html?intro=0&drift=0', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
await page.waitForFunction(() => {
  const m = window.__map;
  return ['austin-tower', 'austin-arts', 'austin-drag', 'austin-moody']
    .filter(s => m.getSource(s)).length >= 4;
}, null, { timeout: 90000 }).catch(() => console.log('WARN: not every pass source appeared'));
await page.waitForTimeout(6000);
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

/** Drive the SLIDER, the way a person does. Never call applyTimeOfDay here. */
async function setSun(p) {
  const ok = await page.evaluate((p) => {
    const s = document.getElementById('tod-slider');
    if (!s) return false;
    s.value = String(p);
    s.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }, p);
  if (!ok) throw new Error('no #tod-slider in the page — the UI path cannot be tested');
  await page.waitForTimeout(SETTLE_MS);
  await page.evaluate(() => window.__map.triggerRepaint());
  await page.waitForTimeout(400);
}

async function meanLuma(probe) {
  const [, lng, lat, zoom, pitch, bearing] = probe;
  await page.evaluate(({ lng, lat, zoom, pitch, bearing }) => {
    const m = window.__map;
    if (m.isEasing && m.isEasing()) m.stop();
    m.jumpTo({ center: [lng, lat], zoom, pitch, bearing });
  }, { lng, lat, zoom, pitch, bearing });
  await page.waitForTimeout(1200);
  // Reduce in the page: handing a framebuffer back through CDP is this
  // directory's twenty-minute, 2 GB mistake.
  return page.evaluate(() => {
    const gl = window.__map.getCanvas();
    const cv = document.createElement('canvas');
    cv.width = gl.width; cv.height = gl.height;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(gl, 0, 0);
    // Middle band only: sky at the top and HUD at the bottom would both dilute it.
    const y0 = (cv.height * 0.35) | 0, y1 = (cv.height * 0.85) | 0;
    const d = cx.getImageData(0, y0, cv.width, y1 - y0).data;
    let s = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      s += (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000; n++;
    }
    return s / n;
  });
}

const results = [];
for (const probe of PROBES) {
  await setSun(0.0);
  const day = await meanLuma(probe);
  await setSun(1.0);
  const night = await meanLuma(probe);
  await setSun(0.0);
  const back = await meanLuma(probe);
  results.push({ name: probe[0], pass: probe[6], day, night, back });
}

console.log(`\n${'probe'.padEnd(22)}${'pass'.padEnd(20)}${'day'.padStart(8)}${'night'.padStart(8)}${'back'.padStart(8)}   verdict`);
let fails = 0;
for (const r of results) {
  // THE ASSERTION IS ON THE NIGHT VALUE, not on the size of the drop, and that
  // distinction is the whole test. The first cut asserted only "night is more
  // than 12 luma darker than day" and PASSED on the broken build — because the
  // sky, the ground and the roads always did retint through the local function,
  // and they dominate a frame mean. It proved nothing.
  //
  // What actually broke was that the pass-owned BUILDINGS stayed at their day
  // colour while everything around them went dark, so the frame was still much
  // darker at night, just not dark enough. Measured on the same poses:
  //
  //   probe                 broken   fixed
  //   UT Tower                42.2    30.1
  //   Harry Ransom Center     45.0    30.3
  //   The Drag                59.0    32.0
  //   generic campus          46.9    29.8
  //
  // Fixed readings land 29.8-32.0 and broken ones 42.2-67.3, so 38 separates
  // them with margin on both sides.
  const NIGHT_MAX = 38;
  const drop = r.day - r.night;
  const restored = Math.abs(r.back - r.day);
  const ok = r.night < NIGHT_MAX && drop > 12 && restored < Math.max(6, drop * 0.25);
  if (!ok) fails++;
  console.log(
    `${r.name.padEnd(22)}${r.pass.padEnd(20)}${r.day.toFixed(1).padStart(8)}${r.night.toFixed(1).padStart(8)}` +
    `${r.back.toFixed(1).padStart(8)}   ${ok ? 'ok' : `FAIL (drop ${drop.toFixed(1)}, return err ${restored.toFixed(1)})`}`);
}
if (errors.length) console.log('\nPAGE ERRORS', errors.slice(0, 6));
console.log(`\n${results.length - fails}/${results.length} passes retint within ${SETTLE_MS} ms of moving the slider`);
await browser.__done();
process.exit(fails ? 1 : 0);
