/**
 * facadeatlas.mjs — what the facade atlas COSTS, and what one repaint costs.
 *
 * WHY THIS EXISTS. `js/facades.js`'s MEASURED_MUL gives the sixteen measured
 * campus buildings a tile `mul` times larger per axis, which is `mul*mul` times
 * the texels and `mul*mul` times the rectangles to draw. That is a real bill and
 * this repo has one hard-won number it must not give back: the atlas's
 * main-thread share went from ~46% to 2-3% on 2026-08-19. A change that spends
 * some of that has to say how much, measured, not estimated.
 *
 * WHAT IT MEASURES, both arms in ONE browser, alternating page loads so no
 * load-to-load drift lands on one side of the comparison (this directory's
 * README: an A/B across two runs measures the machine):
 *
 *   images        how many pattern images the atlas holds
 *   KB            their total RGBA bytes, summed off the registered images
 *   repaint ms    one full `updateFacades` at a new hour — every combo, every
 *                 tier, redrawn. This is the main-thread number.
 *   anchor ms     one zoom-anchor crossing (`facadeSetZoomAnchor`), which
 *                 redraws every tile whose row count changed.
 *
 * MINIMUM OF REPS, never a mean — a mean on a busy machine measures the
 * machine. Interleaved A/B/A/B/... so a machine that gets busier partway
 * through cannot hand the win to whichever arm ran first.
 *
 * The `mul1` arm is the SAME BUILD through `?facademul=1`, not a checkout.
 *
 * Usage:
 *   VERIFY_URL=http://127.0.0.1:8823 node facadeatlas.mjs [reps]
 *
 * Exit 0 always: this is a measurement, not a gate. The gate on the geometry it
 * buys is facadegrid.mjs.
 */
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';

const REPS = Number(process.argv[2] || 3);

/** One page load, one arm, one set of numbers. */
async function measure(browser, mul1) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    await page.goto(`${BASE}/index.html?intro=0&drift=0${mul1 ? '&facademul=1' : ''}`,
                    { waitUntil: 'load', timeout: 120000 });
    // Correctness measure, not a speed one — see CLAUDE.md's verification block.
    await page.evaluate(() => { try { window.cancelGraphicsAutoDetect(); } catch (e) {} });
    await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded()
      && window.facadeMeasured && window.updateFacades, null, { timeout: 120000 });
    // WAIT FOR THE ATLAS TO STOP GROWING, not for a fixed number of seconds.
    // Pattern images are registered lazily as tiles arrive, so a fixed settle
    // measures whichever arm happened to finish loading — the first cut of this
    // script reported 222 images against 445 for the same city and the
    // difference was entirely that.
    await page.waitForFunction(() => {
      const im = window.__map.style && window.__map.style.imageManager;
      const store = im && (im.images || im._images || {});
      const n = Object.keys(store).length;
      const prev = window.__atlasN;
      window.__atlasN = n;
      window.__atlasStable = (prev === n) ? (window.__atlasStable || 0) + 1 : 0;
      return n > 100 && window.__atlasStable >= 4;
    }, null, { timeout: 180000, polling: 900 });
    return await page.evaluate(() => {
      const map = window.__map;
      // Sum the bytes off the images MapLibre is actually holding. Reading the
      // manager rather than recomputing from the config on purpose: the claim
      // is about what is in the atlas, and a config can lie about that.
      const im = map.style && map.style.imageManager;
      const store = im && (im.images || im._images || {});
      let n = 0, bytes = 0, biggest = 0, measuredBytes = 0;
      for (const id of Object.keys(store)) {
        const img = store[id];
        const d = img && img.data;
        if (!d || !d.width) continue;
        const b = d.width * d.height * 4;
        n++; bytes += b;
        if (b > biggest) biggest = b;
        // `k?` is the namespace registerMeasuredGrids hands out.
        if (id[0] === 'k') measuredBytes += b;
      }
      // ONE FULL REPAINT. A new hour, quantised away from the one the atlas is
      // holding so nothing short-circuits on the signature cache.
      const p0 = window.facadeAtlasHour();
      const p1 = p0 > 0.5 ? p0 - 0.21 : p0 + 0.21;
      const t0 = performance.now();
      window.updateFacades(map, p1);
      const repaint = performance.now() - t0;
      // The same call again at the SAME hour: every combo's signature already
      // matches, so this is the cost of the walk itself with no drawing. It is
      // what the app actually pays on a frame that calls updateFacades without
      // the hour having moved.
      const t2 = performance.now();
      window.updateFacades(map, p1);
      const noop = performance.now() - t2;
      // ONE ANCHOR CROSSING. z18 -> z19 is inside the band where every measured
      // tile's row count actually changes, so this is not a no-op.
      window.facadeSetZoomAnchor(map, 18);
      const t1 = performance.now();
      window.facadeSetZoomAnchor(map, 19);
      const anchor = performance.now() - t1;
      window.facadeSetZoomAnchor(map, 16);
      window.updateFacades(map, p0);
      return {
        images: n,
        kb: Math.round(bytes / 1024),
        measuredKb: Math.round(measuredBytes / 1024),
        biggestKb: Math.round(biggest / 1024),
        mul: window.FACADE_MEASURED_MUL ? window.FACADE_MEASURED_MUL() : 1,
        families: Object.keys(window.facadeMeasured || {}).length,
        repaint, noop, anchor,
      };
    });
  } finally {
    await page.close();
  }
}

const browser = await launch(chromium);
const arms = { mul: [], mul1: [] };
try {
  for (let r = 0; r < REPS; r++) {
    // Alternate which arm goes first, so neither is always warm.
    const order = r % 2 ? ['mul1', 'mul'] : ['mul', 'mul1'];
    for (const a of order) arms[a].push(await measure(browser, a === 'mul1'));
  }
} finally {
  browser.__done();
}

const min = (rows, k) => Math.min.apply(null, rows.map(x => x[k]));
const row = (label, rows) => {
  const f = rows[0];
  console.log('  ' + label.padEnd(10)
    + String(f.mul + 'x').padStart(5)
    + String(f.images).padStart(9)
    + String(f.kb).padStart(10)
    + String(f.measuredKb).padStart(12)
    + String(f.biggestKb).padStart(11)
    + min(rows, 'repaint').toFixed(1).padStart(12)
    + min(rows, 'noop').toFixed(1).padStart(10)
    + min(rows, 'anchor').toFixed(1).padStart(11));
};

console.log('\n  FACADE ATLAS COST — minimum of ' + REPS + ' interleaved reps, ' + BASE);
console.log('  arm          mul   images   total KB   measured KB   biggest KB   repaint ms   no-op ms   anchor ms');
console.log('  ' + '-'.repeat(106));
row('measured', arms.mul);
row('?mul=1', arms.mul1);
const dk = min(arms.mul, 'kb') - min(arms.mul1, 'kb');
const dr = min(arms.mul, 'repaint') - min(arms.mul1, 'repaint');
console.log('  ' + '-'.repeat(106));
console.log('  delta      ' + ' '.repeat(3) + String('').padStart(9)
  + ('+' + dk).padStart(10) + ' '.repeat(23)
  + ('+' + dr.toFixed(1)).padStart(12));
console.log('\n  `measured KB` is the share belonging to the `k?` families — the sixteen');
console.log('  photographed buildings. Everything else in the atlas is unchanged by');
console.log('  MEASURED_MUL and the two arms should agree on it to the byte.');
console.log('  repaint = one full updateFacades at a NEW hour (every combo, every tier redrawn).');
console.log('  no-op   = the same call again at the same hour: every signature already matches,');
console.log('            so it is the walk with no drawing — what a frame pays when nothing moved.');
console.log('  anchor  = one z18->z19 zoom-anchor crossing.');
console.log('  Headless swiftshader: these are MAIN-THREAD canvas numbers, not GPU ones,');
console.log('  which is what the atlas budget is about. Real-GPU frame cost is facade-perf.mjs.');
