/**
 * places-perf.mjs — what does the storefront pass cost per frame?
 *
 * Same shape and the same rules as drag-perf.mjs and ground-tex-perf.mjs, every
 * one of which this repo learned by getting it wrong first:
 *   - HEADED. swiftshader measures the software rasteriser, not the app.
 *   - index.html, never _harness.html, whose rAF shim pins the loop at 60 Hz.
 *   - a scripted bearing sweep, so every run renders identical content.
 *   - configurations INTERLEAVED and counterbalanced (the machine drifts upward
 *     across a run, so whichever config always goes first wins by construction).
 *   - report the MINIMUM of the reps. A mean measures the machine, and a
 *     mean-based run in this repo already produced one false regression report.
 *   - count DROPPED frames, not median frame time: the median sits on the
 *     16.7 ms vsync floor while half the frames are being dropped.
 *   - the occlusion/backgrounding flags, or Chrome throttles rAF to 20 Hz in a
 *     window it thinks is hidden and both configurations come back identical.
 *
 * WHAT `off` MEASURES HERE, and this pass is the clean case. It hides
 * places-solid, places-glass and places-label on the SAME build. Because this
 * pass replaces NO buildings and writes no filter on buildings-3d, nothing else
 * in the scene changes between the two configurations — so unlike drag-perf.mjs,
 * where `off` still had 24 buildings filtered out in both arms, the delta below
 * IS the net cost against main.
 *
 * THE LABEL LAYER IS MEASURED SEPARATELY, on purpose. It is the one part of this
 * pass that is not a fill-extrusion: 133 symbols with collision detection, which
 * MapLibre re-runs on every camera change, and a bearing sweep is the worst case
 * for exactly that. Rolling it into one number would hide which half is the
 * expensive one and leave nothing to trade away if the pass ever needs to get
 * cheaper.
 *
 * Usage: VERIFY_URL=http://127.0.0.1:8127 node places-perf.mjs [reps]
 */
import { chromium } from 'playwright-core';
import { chromePath, BASE as SERVER, launch } from './chrome.mjs';

const REPS = parseInt(process.argv[2] || '4', 10);
const MS = 4200;
// off        — the pass entirely absent
// geom       — shopfronts drawn, labels suppressed
// on         — everything
const CONFIGS = { off: { on: false, labels: false },
                  geom: { on: true, labels: false },
                  on: { on: true, labels: true } };
// Over the Drag at 24th, low enough that a long run of storefronts is a real
// share of the pixels rather than four pixels of it, and high enough to be a
// pose the flying camera actually reaches.
const POSE = { center: [-97.7418, 30.2866], zoom: 16.4, pitch: 71 };

const browser = await launch(chromium, {
  gl: 'hardware',
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
await page.waitForFunction(() => window.__map.getLayer('places-solid'), null, { timeout: 60000 })
  .catch(() => console.log('WARN: places-solid never appeared'));
await page.waitForTimeout(8000);
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

async function run(cfg, pose) {
  await page.evaluate(({ cfg, pose }) => {
    window.PLACES.on = cfg.on;
    window.PLACES.labels = cfg.labels;
    window.applyPlacesSettings(window.__map);
    window.__map.jumpTo({ ...pose, bearing: 0 });
  }, { cfg, pose });
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
  }, { ms: MS, pose });
}

const results = { off: [], geom: [], on: [] };
for (let r = 0; r < REPS; r++) {
  const order = Object.entries(CONFIGS);
  if (r % 2) order.reverse();
  for (const [k, cfg] of order) {
    const out = await run(cfg, POSE);
    // Echo the thing we think we set, next to the result. Four "different"
    // configurations once ran identically in this repo while the report printed
    // four different numbers.
    const echo = await page.evaluate(() => {
      const m = window.__map;
      const vis = id => { try { return m.getLayer(id) ? (m.getLayoutProperty(id, 'visibility') || 'visible') : 'absent'; } catch (e) { return 'err'; } };
      return vis('places-solid').slice(0, 4) + '/' + vis('places-glass').slice(0, 4) +
             '/' + vis('places-label').slice(0, 4);
    });
    results[k].push({ ...out, echo });
  }
}

const pad = (v, n) => String(v).padStart(n);
const min = k => Math.min(...results[k].map(a => a.dropped));
const spread = k => Math.max(...results[k].map(a => a.dropped)) - min(k);
console.log('\nconfig   dropMIN   fpsBest   all reps            solid/glass/label');
for (const [k, arr] of Object.entries(results)) {
  console.log(k.padEnd(8) + pad(min(k), 7) +
    pad(Math.max(...arr.map(a => a.fps)).toFixed(1), 10) + '   ' +
    ('[' + arr.map(a => a.dropped).join(', ') + ']').padEnd(20) + arr[0].echo);
}
const dGeom = min('geom') - min('off');
const dLab = min('on') - min('geom');
console.log(`\ndropped frames over ${MS} ms, MIN of ${REPS} reps:`);
console.log(`  shopfront geometry  ${dGeom >= 0 ? '+' : ''}${dGeom}`);
console.log(`  labels on top       ${dLab >= 0 ? '+' : ''}${dLab}`);
console.log(`  whole pass          ${min('on') - min('off') >= 0 ? '+' : ''}${min('on') - min('off')}`);
console.log('within-config spread: ' +
  Object.keys(results).map(k => k + ' ' + spread(k)).join(', '));
console.log('If a delta is smaller than the spread there is no result.');
await browser.__done();
