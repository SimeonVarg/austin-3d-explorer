/**
 * drag-perf.mjs — what does the Drag pass cost per frame?
 *
 * Same shape and the same rules as ground-tex-perf.mjs, every one of which this
 * repo learned by getting it wrong first:
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
 * WHAT `off` ACTUALLY MEASURES, stated because it is not quite "before". It
 * hides drag-wall and drag-cap on the SAME build, so the 24 buildings this pass
 * replaces stay filtered out of buildings-3d in both configurations. So the
 * number below is the gross cost of the 101 new extrusions, and the true net
 * against main is slightly cheaper than that, by whatever those 24 generic
 * extrusions and their roof caps used to cost.
 *
 * Usage: VERIFY_URL=http://127.0.0.1:8127 node drag-perf.mjs [reps]
 */
import { chromium } from 'playwright-core';
import { chromePath, BASE as SERVER, launch } from './chrome.mjs';

const REPS = parseInt(process.argv[2] || '4', 10);
const MS = 4200;
const CONFIGS = { off: false, on: true };
// Over the Drag, low enough that the streetwall and PCL are both in frame and
// the new geometry is a real share of the pixels rather than four pixels of it.
const POSE = { center: [-97.7405, 30.2855], zoom: 16.7, pitch: 72 };

const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.bringToFront();
await page.goto(SERVER + '/index.html?intro=0&drift=0', { timeout: 120000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
await page.waitForFunction(() => window.__map.getLayer('drag-wall'), null, { timeout: 60000 })
  .catch(() => console.log('WARN: drag-wall never appeared'));
await page.waitForTimeout(8000);
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

async function run(on, pose) {
  await page.evaluate(({ on, pose }) => {
    window.DRAG.on = on;
    window.applyDragSettings(window.__map);
    window.__map.jumpTo({ ...pose, bearing: 0 });
  }, { on, pose });
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

const results = { off: [], on: [] };
for (let r = 0; r < REPS; r++) {
  const order = Object.entries(CONFIGS);
  if (r % 2) order.reverse();
  for (const [k, on] of order) {
    const out = await run(on, POSE);
    // Echo the thing we think we set, next to the result. Four "different"
    // configurations once ran identically here while the report printed four
    // different numbers.
    const echo = await page.evaluate(() => {
      const m = window.__map;
      const vis = id => { try { return m.getLayer(id) ? (m.getLayoutProperty(id, 'visibility') || 'visible') : 'absent'; } catch (e) { return 'err'; } };
      return vis('drag-wall') + '/' + vis('drag-cap');
    });
    results[k].push({ ...out, echo });
  }
}

const pad = (v, n) => String(v).padStart(n);
const min = k => Math.min(...results[k].map(a => a.dropped));
const spread = k => Math.max(...results[k].map(a => a.dropped)) - min(k);
console.log('\nconfig   dropMIN   fpsBest   all reps           drag-wall/drag-cap');
for (const [k, arr] of Object.entries(results)) {
  console.log(k.padEnd(8) + pad(min(k), 7) +
    pad(Math.max(...arr.map(a => a.fps)).toFixed(1), 10) + '   ' +
    ('[' + arr.map(a => a.dropped).join(', ') + ']').padEnd(19) + arr[0].echo);
}
const d = min('on') - min('off');
console.log(`\ndelta (dropped frames over ${MS} ms, MIN of ${REPS} reps): ` +
            (d >= 0 ? '+' : '') + d);
console.log(`within-config spread: off ${spread('off')}, on ${spread('on')}`);
console.log('If the delta is smaller than the spread there is no result.');
await browser.__done();
