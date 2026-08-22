/**
 * places-lowpass-cost.mjs — does PLACES_SOFTEN's blur cost anything worth
 * measuring? One image (`pl-glass`, TILE=64), one blurWrap call per repaint,
 * not in the render loop, no new addImage/updateImage call site (js/places.js
 * already called `map.addImage`/`updateImage(GLASS_IMG, glassTile(p))` before
 * this change — QUEUE F2 front 2, acer/f2-wcplaces).
 *
 * This is a MICROBENCHMARK of glassTile(p) itself (structurally the only
 * thing that changed), not an interleaved cruise-fps A/B: the blur runs at
 * atlas-generation time, not per rendered frame, so there is no frame-time
 * axis for a cruise fps test to find a difference on, and vsync noise would
 * swamp a sub-millisecond microbenchmark long before a real regression could
 * be seen in it. Direct timing is the sharper instrument for this specific
 * question. What this does NOT do: re-measure the whole places.js pass's
 * per-frame cost (places-perf.mjs already exists for that, and this change
 * touches nothing that pass reads).
 *
 * Usage: VERIFY_URL=http://127.0.0.1:PORT node places-lowpass-cost.mjs
 */
import { chromium } from 'playwright-core';
import { BASE as SERVER, launch } from './chrome.mjs';

const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.goto(SERVER + '/_harness.html?intro=0&drift=0', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
await page.waitForFunction(() => typeof window.placesTileSample === 'function', null, { timeout: 30000 });
await page.waitForTimeout(3000);

const result = await page.evaluate(() => {
  // placesTileSample already calls glassTile(p) once and reads it back --
  // reuse it so this measures the EXACT function the app calls, not a stand-in.
  const N = 500;
  // Warm up (JIT) before timing, same reason any microbenchmark does.
  for (let i = 0; i < 20; i++) window.placesTileSample(0.3);
  const softenOn = window.PLACES_SOFTEN ? JSON.parse(JSON.stringify(window.PLACES_SOFTEN)) : null;

  function timeN(radius) {
    if (window.PLACES_SOFTEN) {
      window.PLACES_SOFTEN.RADIUS.plGlass = radius;
      window.PLACES_SOFTEN.AMOUNT.plGlass = radius ? 1.0 : 1.0; // amount irrelevant when radius=0 (no-op)
    }
    const t0 = performance.now();
    for (let i = 0; i < N; i++) window.placesTileSample((i % 100) / 100);
    const t1 = performance.now();
    return (t1 - t0) / N;
  }

  const withBlurR3 = timeN(3);
  const withBlurR6 = timeN(6);
  const noBlurR0 = timeN(0);

  // restore
  if (window.PLACES_SOFTEN && softenOn) {
    window.PLACES_SOFTEN.RADIUS.plGlass = softenOn.RADIUS.plGlass;
    window.PLACES_SOFTEN.AMOUNT.plGlass = softenOn.AMOUNT.plGlass;
  }

  return { N, msPerCall_r0_noBlur: noBlurR0, msPerCall_r3_shipped: withBlurR3, msPerCall_r6: withBlurR6 };
});

console.log('RESULT', JSON.stringify(result, null, 2));
console.log(`\nper-call cost of the shipped r3 blur vs no blur: +${(result.msPerCall_r3_shipped - result.msPerCall_r0_noBlur).toFixed(4)} ms/call`);
console.log(`(this runs ONCE per repaint -- init + every time-of-day change -- never per rendered frame)`);

await browser.__done();
