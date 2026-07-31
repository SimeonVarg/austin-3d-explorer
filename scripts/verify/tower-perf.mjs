/**
 * tower-perf.mjs — what does the UT Tower pass cost?
 *
 * Copied from ground-tex-perf.mjs, including every rule it carries, all of
 * which this repo learned the hard way:
 *   - HEADED. swiftshader measures the software rasteriser, not the app.
 *   - index.html, never _harness.html, whose rAF shim pins the loop at 60 Hz.
 *   - a scripted bearing sweep, so every run renders identical content.
 *   - configurations INTERLEAVED, and counterbalanced on alternate reps, because
 *     the machine drifts upward across a run and whichever config always goes
 *     first gets the coolest slot and wins by construction.
 *   - report the MINIMUM of the reps. A mean measures the machine, and a
 *     mean-based run in this repo has already produced one false regression.
 *   - count DROPPED frames. A median frame time sits on the vsync floor while
 *     half the frames are being dropped and every delta reads as exactly 0.
 *   - the occlusion/backgrounding flags, or Chrome throttles rAF to 20 Hz.
 *
 * Three configurations, because this pass has two separable costs: 16 banded
 * walls + 9 roof facets (cheap, always on), and 200 sub-2 m detail prisms —
 * slots, windows, belfry columns, clock slabs — which are the ones worth
 * questioning. `detail` is switched by moving that layer's minzoom above the
 * camera rather than by hiding it, so the source still tiles and only the draw
 * goes away.
 *
 * Usage: node tower-perf.mjs [reps]
 */
import { chromium } from 'playwright-core';
import { chromePath, BASE as SERVER } from './chrome.mjs';

const REPS = parseInt(process.argv[2] || '4', 10);
const MS = 4200;
const POSE = { center: [-97.739325, 30.285000], zoom: 16.6, pitch: 66 };

const CONFIGS = {
  before: 'off',       // ?tower=0 equivalent: every tower layer hidden
  noDetail: 'bands',   // bands + roofs only
  after: 'on',
};

const browser = await chromium.launch({
  executablePath: chromePath(), headless: false,
  args: ['--no-sandbox',
         '--disable-backgrounding-occluded-windows',
         '--disable-renderer-backgrounding',
         '--disable-background-timer-throttling',
         '--disable-features=CalculateNativeWinOcclusion'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.bringToFront();
await page.goto(SERVER + '/index.html?intro=0&drift=0', { timeout: 120000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
await page.waitForTimeout(9000);
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

async function run(mode, pose, ms) {
  await page.evaluate(({ mode, pose }) => {
    const m = window.__map;
    const vis = (id, on) => { try { if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'); } catch (e) {} };
    vis('tower-wall', mode !== 'off');
    vis('tower-solid', mode !== 'off');
    vis('tower-detail', mode === 'on');
    m.jumpTo({ ...pose, bearing: 0 });
  }, { mode, pose });
  await page.waitForTimeout(1600);
  return await page.evaluate(async ({ ms, pose }) => {
    const m = window.__map;
    const dts = [];
    let last = performance.now(), t0 = last, b = 0;
    await new Promise(res => {
      const step = () => {
        const now = performance.now();
        dts.push(now - last); last = now;
        b += 0.9; m.jumpTo({ ...pose, bearing: b });
        if (now - t0 < ms) requestAnimationFrame(step); else res();
      };
      requestAnimationFrame(step);
    });
    const drop = dts.slice(3).reduce((a, d) => a + Math.max(0, Math.round(d / 16.67) - 1), 0);
    return { dropped: drop, frames: dts.length,
             fps: +(1000 * dts.length / (performance.now() - t0)).toFixed(1) };
  }, { ms, pose });
}

const results = {};
for (const k of Object.keys(CONFIGS)) results[k] = [];
for (let r = 0; r < REPS; r++) {
  const order = Object.entries(CONFIGS);
  if (r % 2) order.reverse();
  for (const [k, mode] of order) {
    const out = await run(mode, POSE, MS);
    // Echo what we think we set, next to the result. Four "different"
    // configurations once ran identically in this repo while the report
    // printed four different numbers.
    const echo = await page.evaluate(() => {
      const m = window.__map;
      const vis = id => { try { const l = m.getLayer(id); return l ? (m.getLayoutProperty(id, 'visibility') || 'visible') : 'absent'; } catch (e) { return 'err'; } };
      return { wall: vis('tower-wall'), solid: vis('tower-solid'), detail: vis('tower-detail') };
    });
    results[k].push({ ...out, echo });
  }
}

const pad = (v, n) => String(v).padStart(n);
console.log('\nconfig      dropMIN   fpsBest   all reps             layers actually set');
for (const [k, arr] of Object.entries(results)) {
  const drops = arr.map(a => a.dropped);
  const e = arr[0].echo;
  console.log(k.padEnd(11) + pad(Math.min(...drops), 7) +
    pad(Math.max(...arr.map(a => a.fps)).toFixed(1), 10) + '   ' +
    ('[' + drops.join(', ') + ']').padEnd(21) +
    `wall=${e.wall} solid=${e.solid} detail=${e.detail}`);
}
const min = k => Math.min(...results[k].map(a => a.dropped));
const spread = k => Math.max(...results[k].map(a => a.dropped)) - min(k);
console.log(`\ndelta vs before (dropped frames over ${MS} ms, MIN of ${REPS} reps):`);
for (const k of ['noDetail', 'after']) {
  console.log('  ' + k.padEnd(10) + pad((min(k) - min('before') >= 0 ? '+' : '') +
    (min(k) - min('before')), 5) + '    (within-config spread: before ' +
    spread('before') + ', ' + k + ' ' + spread(k) + ')');
}
console.log('\nIf a delta is smaller than the within-config spread there is no result.');

// Turn the layers back ON before counting. A GeoJSON source stops keeping tiles
// for a layer nobody is drawing, so asking straight after the last rep — which
// is `before`, because the order reverses on odd reps — reported 0 features and
// read as "the tower never loaded" rather than "nothing was asking for it".
const n = await page.evaluate(async () => {
  const m = window.__map;
  for (const id of ['tower-wall', 'tower-solid', 'tower-detail']) {
    try { if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', 'visible'); } catch (e) {}
  }
  await new Promise(r => { if (m.loaded()) r(); else m.once('idle', r); setTimeout(r, 8000); });
  try { return m.querySourceFeatures('austin-tower').length; } catch (e) { return -1; }
});
console.log('tower source features tiled into the current viewport:', n);
console.log('NOTE: absolute fps here is worthless if anything else is using the GPU.\n' +
            'The A/B is still valid — same machine, interleaved, counterbalanced — but\n' +
            'read the DELTA against the within-config spread, never the fps column.');
await browser.close();
