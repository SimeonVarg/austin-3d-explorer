/**
 * pattern-scale.mjs — how does `fill-pattern` ACTUALLY scale?
 *
 * The brief warns that fill-pattern does not tile the way fill-extrusion-pattern
 * does and says to trust neither the docs nor the person asking. So measure it:
 * register a hard-edged stripe tile of a known period, paint it on the ground
 * areas, look straight down, and count the on-screen period at a series of
 * zooms. Two hypotheses, and they predict very different numbers:
 *
 *   A) anchored in TILE space, natural size at integer zoom
 *      -> period_px doubles across a zoom level, halving in METRES per level
 *   B) anchored in WORLD space (constant metres)
 *      -> period_px doubles per zoom level, constant in metres
 *
 * A and B differ by the RESET at each integer zoom: (A) snaps back, (B) does not.
 * Sampling z = 16.0, 16.5, 17.0, 17.5 separates them in one run.
 *
 * Also prints the same measurement at a flying pitch, because a texture is only
 * useful if its feature size survives the camera we actually ship.
 */
import { chromium } from 'playwright-core';
import { chromePath, BASE as SERVER, launch } from './chrome.mjs';

const PERIOD = 32;   // stripe period inside the 32x32 tile

const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: 1000, height: 800 }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('PAGEERR', e.message));

await page.goto(SERVER + '/_harness.html?intro=0&drift=0', { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 90000 });
await page.waitForTimeout(5000);
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

// A big, simple, unbroken area to read the stripes off: the DKR playing field.
// Everything else off, post stack off, flat colour underneath so the stripe
// contrast is the only thing in the frame.
await page.evaluate(async (PERIOD) => {
  const m = window.__map;
  Object.assign(window.GFX, { bloom: 0, godRays: 0, flare: 0, dof: 0, grain: 0, vignette: 0 });
  window.applyGraphics();
  for (const l of m.getStyle().layers) {
    const keep = l.id === 'ground-areas' || l.type === 'background' || /^sky|atmos|haze/.test(l.id);
    try { if (!keep) m.setLayoutProperty(l.id, 'visibility', 'none'); } catch (e) {}
  }
  // Hard black/white vertical stripes: unambiguous edges to count.
  const cv = document.createElement('canvas');
  cv.width = cv.height = PERIOD;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, PERIOD, PERIOD);
  cx.fillStyle = '#000000'; cx.fillRect(0, 0, PERIOD / 2, PERIOD);
  const img = cx.getImageData(0, 0, PERIOD, PERIOD);
  m.addImage('__stripe', { width: PERIOD, height: PERIOD, data: new Uint8Array(img.data.buffer.slice(0)) });
  m.setPaintProperty('ground-areas', 'fill-pattern', '__stripe');
  m.setPaintProperty('ground-areas', 'fill-opacity', 1);
}, PERIOD);

async function measure(zoom, pitch) {
  await page.evaluate(([zoom, pitch]) => {
    const m = window.__map;
    if (m.isEasing && m.isEasing()) m.stop();
    m.jumpTo({ center: [-97.7325, 30.2836], zoom, pitch, bearing: 0 });
  }, [zoom, pitch]);
  await page.waitForTimeout(1800);
  await page.evaluate(() => new Promise(r => {
    const m = window.__map; if (m.loaded()) return r(); m.once('idle', r); setTimeout(r, 12000);
  }));
  await page.evaluate(() => window.__map.triggerRepaint());
  await page.waitForTimeout(800);

  return await page.evaluate(() => {
    const cv = window.__map.getCanvas();
    const gl = cv.getContext('webgl2') || cv.getContext('webgl');
    const w = cv.width, h = cv.height;
    const buf = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    // Scan the middle row; count black<->white transitions and the run lengths.
    const y = Math.floor(h / 2);
    const runs = [];
    let prev = null, start = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const l = 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
      const bit = l < 60 ? 0 : (l > 195 ? 1 : null);
      if (bit === null) continue;
      if (prev === null) { prev = bit; start = x; continue; }
      if (bit !== prev) { runs.push(x - start); prev = bit; start = x; }
    }
    // Median run length x2 = period. Median resists the partial runs at the ends.
    const s = runs.slice(1, -1).sort((a, b) => a - b);
    const med = s.length ? s[Math.floor(s.length / 2)] : NaN;
    return { runs: runs.length, medianRun: med, periodPx: med * 2 };
  });
}

console.log('NADIR (pitch 0) — metresPerPx = 67546 / 2^zoom at Austin latitude');
console.log('zoom   periodPx   period_m   runs');
for (const z of [15.0, 15.5, 16.0, 16.5, 17.0, 17.5, 18.0]) {
  const r = await measure(z, 0);
  const mpp = 67546 / Math.pow(2, z);
  console.log('%s %s %s %s', z.toFixed(1).padStart(4),
    String(r.periodPx).padStart(9),
    (r.periodPx * mpp).toFixed(1).padStart(10), String(r.runs).padStart(6));
}

console.log('\nFLYING (pitch 70) — periodPx measured across the middle row');
for (const z of [16.0, 16.5, 17.0]) {
  const r = await measure(z, 70);
  console.log('zoom %s  periodPx %s  runs %s', z.toFixed(1), String(r.periodPx).padStart(5), r.runs);
}
await browser.__done();
