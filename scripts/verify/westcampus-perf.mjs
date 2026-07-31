/**
 * westcampus-perf.mjs — what do the ten towers cost?
 *
 * Same shape as ground-tex-perf.mjs, and the same rules, every one of which this
 * repo learned by getting it wrong first:
 *   - HEADED. The rest of the suite runs --use-angle=swiftshader, which is right
 *     for pixel assertions and useless for timing: software rasterisation moves
 *     the whole cost onto fill rate.
 *   - index.html, never _harness.html, whose rAF shim pins the loop at ~60 Hz no
 *     matter how slow a frame really is.
 *   - a scripted bearing sweep, so every run renders identical content.
 *   - configurations INTERLEAVED and COUNTERBALANCED. The machine drifts upward
 *     across a run, so whichever config always goes first gets the coolest slot
 *     and wins by construction.
 *   - report the MINIMUM of the reps. A mean measures the machine.
 *   - count DROPPED frames, not median frame time — a median sits on the 16.7 ms
 *     vsync floor while half the frames are being dropped.
 *   - the occlusion/backgrounding flags, or Chrome throttles rAF to 20 Hz in a
 *     window it thinks is hidden and both configurations come back identical.
 *
 * `before` flips WESTCAMPUS.on, which swaps BOTH halves of the change in one
 * frame: the three wc-* layers go away AND the ten generic prisms come back. A
 * run that only hid our layers would be measuring a city with ten holes in it.
 *
 * Usage: node westcampus-perf.mjs [reps]
 */
import { chromium } from 'playwright-core';
import { chromePath, BASE as SERVER } from './chrome.mjs';

const REPS = parseInt(process.argv[2] || '4', 10);
const MS = 4200;
// Sits in the middle of the cluster, so the sweep passes every one of the ten.
const POSE = { center: [-97.74330, 30.28470], zoom: 16.5, pitch: 70 };

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
await page.waitForFunction(() => window.__map.getSource('austin-westcampus'), null, { timeout: 60000 })
  .catch(() => console.log('WARN: westcampus source never appeared'));
await page.waitForTimeout(8000);
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

async function run(on, pose) {
  await page.evaluate(([on, pose]) => {
    window.WESTCAMPUS.on = on;
    window.applyWestcampusSettings(window.__map);
    window.__map.jumpTo({ ...pose, bearing: 0 });
  }, [on, pose]);
  // A filter change re-tiles in a worker; measuring through that measures the
  // worker, not the frame.
  await page.waitForTimeout(2200);
  return await page.evaluate(async ([ms, pose]) => {
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
  }, [MS, pose]);
}

const results = { before: [], after: [] };
for (let r = 0; r < REPS; r++) {
  const order = r % 2 ? [['after', true], ['before', false]] : [['before', false], ['after', true]];
  for (const [k, on] of order) {
    const out = await run(on, POSE);
    // Echo what we THINK we set, next to the result. Four "different"
    // configurations once ran identically in this repo while the report printed
    // four different numbers.
    const echo = await page.evaluate(() => {
      const m = window.__map;
      const vis = id => { try { const l = m.getLayer(id); return l ? (m.getLayoutProperty(id, 'visibility') || 'visible') : 'absent'; } catch (e) { return 'err'; } };
      return { wall: vis('wc-wall'), solid: vis('wc-solid'),
               b3dFiltered: JSON.stringify(m.getFilter('buildings-3d') || '').includes('0e189df9') };
    });
    results[k].push({ ...out, echo });
  }
}

// Plain concatenation, not printf: Node's console.log leaves a width specifier
// like %8d as literal text and shifts every later argument into the wrong slot.
const pad = (v, n) => String(v).padStart(n);
console.log('\nconfig    dropMIN   fpsBest   all reps            layers actually set');
for (const [k, arr] of Object.entries(results)) {
  const drops = arr.map(a => a.dropped);
  const e = arr[0].echo;
  console.log(k.padEnd(9) + pad(Math.min(...drops), 7) +
    pad(Math.max(...arr.map(a => a.fps)).toFixed(1), 10) + '   ' +
    ('[' + drops.join(', ') + ']').padEnd(20) +
    `wc-wall=${e.wall} wc-solid=${e.solid} prismsFiltered=${e.b3dFiltered}`);
}
const min = k => Math.min(...results[k].map(a => a.dropped));
const spread = k => Math.max(...results[k].map(a => a.dropped)) - min(k);
const delta = min('after') - min('before');
console.log('\ndelta (dropped frames over ' + MS + ' ms, MIN of ' + REPS + ' reps): ' +
            (delta >= 0 ? '+' : '') + delta);
console.log('within-config spread: before ' + spread('before') + ', after ' + spread('after'));
console.log('\nIf the delta is smaller than the within-config spread there is no result.');
await browser.close();
