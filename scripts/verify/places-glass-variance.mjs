/**
 * places-glass-variance.mjs — direct pixel diagnostic on the registered
 * `pl-glass` MapLibre image itself, independent of the whole-frame crawl%
 * meter. Same reasoning as the acer/f2-helper commit's drag.js diagnostic:
 * a box blur preserves the MEAN by construction, so a mean-based check
 * proves nothing; VARIANCE is what a blur removes, and this reads it
 * straight off the actual registered texture MapLibre samples, with no
 * camera, no scan, no whole-frame contamination from other layers.
 *
 * Usage: VERIFY_URL=http://127.0.0.1:PORT node places-glass-variance.mjs
 */
import { chromium } from 'playwright-core';
import { BASE as SERVER, launch } from './chrome.mjs';

const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.goto(SERVER + '/_harness.html?intro=0&drift=0', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
await page.waitForFunction(() => typeof window.placesTileSample === 'function' && window.PLACES_SOFTEN, null, { timeout: 30000 });
await page.waitForTimeout(3000);

const result = await page.evaluate(() => {
  // glassTile isn't exported directly, but placesTileSample's own mean/luma
  // read is derived from the SAME buffer this needs variance on -- so read
  // the registered atlas image straight from the map's own imageManager
  // instead, which is the actual bytes the fragment shader samples.
  function readRegisteredVariance() {
    const im = window.__map.style && window.__map.style.imageManager;
    const img = im && im.images && im.images['pl-glass'];
    if (!img || !img.data) return null;
    const d = img.data.data; // RGBAImage -> data is a Uint8ClampedArray/Uint8Array
    let n = 0, sum = 0, sumSq = 0;
    for (let i = 0; i < d.length; i += 4) {
      // luma per texel, variance of THAT (matches what the eye reads as
      // "windowed vs flat" far more directly than a per-channel variance)
      const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      n++; sum += l; sumSq += l * l;
    }
    const mean = sum / n;
    const variance = sumSq / n - mean * mean;
    return { n, mean: +mean.toFixed(2), variance: +variance.toFixed(2) };
  }

  const p0 = window.__todCurrentP != null ? window.__todCurrentP : 0.3;
  const out = {};
  for (const r of [0, 1, 2, 3, 4, 6]) {
    window.PLACES_SOFTEN.RADIUS.plGlass = r;
    window.PLACES_SOFTEN.AMOUNT.plGlass = 1.0;
    // Force a repaint so the registered image reflects this radius.
    window.applyPlacesColors(window.__map, p0);
    out['r' + r] = readRegisteredVariance();
  }
  return out;
});

console.log('places pl-glass texel-luma variance by radius (mean preserved by construction, variance is what the blur removes):');
console.log(JSON.stringify(result, null, 2));
if (result.r0 && result.r0.variance) {
  for (const r of [1, 2, 3, 4, 6]) {
    const cur = result['r' + r];
    if (cur) {
      const pct = 100 * (1 - cur.variance / result.r0.variance);
      console.log(`r${r}: variance ${cur.variance} (${pct.toFixed(0)}% reduction from r0's ${result.r0.variance})`);
    }
  }
}

await browser.__done();
