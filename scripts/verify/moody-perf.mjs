/**
 * moody-perf.mjs — what does the modern east precinct cost?
 *
 * Same rules as ground-tex-perf.mjs and outer-perf.mjs, all of which this repo
 * learned the hard way:
 *   - HEADED. swiftshader measures the software rasteriser, not the app.
 *   - index.html, never _harness.html, whose rAF shim pins the loop at 60 Hz.
 *   - a scripted bearing sweep, so every run renders identical content. Flying
 *     with W held down was once a bigger noise source than the setting under test.
 *   - configurations INTERLEAVED and counterbalanced, never blocked. The machine
 *     drifts upward across a run, so whichever config always goes first gets the
 *     coolest slot and wins by construction.
 *   - report the MINIMUM of the reps. A mean measures the machine, and a
 *     mean-based run in this repo already produced one false regression report.
 *   - count DROPPED frames. A median frame time sits on the vsync floor while
 *     half the frames are being dropped, and every delta then reads as 0.0 ms.
 *   - the occlusion/backgrounding flags, or Chrome throttles rAF to 20 Hz in a
 *     window it thinks is hidden and both configurations come back identical.
 *
 * There are TWO costs here and they land in different places, so both are
 * measured:
 *   DRAW      four extra fill-extrusion layers over 17 features. Expected to be
 *             noise; measured anyway, because "expected to be noise" is how the
 *             ground AO layer got to 3.6 fps.
 *   REPAINT   eight more 64x64 tiles regenerated on every time-of-day step. This
 *             is the one that could actually hurt: it lands on the hour slider,
 *             which quantises to 1/128, so dragging it end to end pays this cost
 *             128 times. js/facades.js has a whole comment about a 230 ms
 *             version of exactly this path.
 *
 * Usage: node moody-perf.mjs [reps]
 */
import { chromium } from 'playwright-core';
import { chromePath, BASE as SERVER } from './chrome.mjs';

const REPS = parseInt(process.argv[2] || '3', 10);
const MS = 4200;
// Over the precinct, looking north-west across Moody and the Dell Med block, so
// the geometry under test is actually on screen for every frame counted.
const POSE = { center: [-97.7304, 30.27726], zoom: 15.9, pitch: 70 };

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
await page.waitForFunction(() => window.__map.getLayer('moody-wall'), null, { timeout: 60000 })
  .catch(() => console.log('WARN: moody-wall never appeared — measuring nothing'));
await page.waitForTimeout(8000);
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

async function run(on) {
  await page.evaluate(([on, POSE]) => {
    window.MOODY.on = on;
    window.applyMoodySettings(window.__map);
    window.__map.jumpTo({ ...POSE, bearing: 0 });
  }, [on, POSE]);
  await page.waitForTimeout(1600);
  return await page.evaluate(async ([ms, POSE]) => {
    const m = window.__map;
    const dts = [];
    let last = performance.now(), t0 = last, b = 0;
    await new Promise(res => {
      const step = () => {
        const now = performance.now();
        dts.push(now - last); last = now;
        b += 0.9; m.jumpTo({ ...POSE, bearing: b });
        if (now - t0 < ms) requestAnimationFrame(step); else res();
      };
      requestAnimationFrame(step);
    });
    const drop = dts.slice(3).reduce((a, d) => a + Math.max(0, Math.round(d / 16.67) - 1), 0);
    return { dropped: drop, frames: dts.length,
             fps: +(1000 * dts.length / (performance.now() - t0)).toFixed(1) };
  }, [MS, POSE]);
}

const results = { off: [], on: [] };
for (let r = 0; r < REPS; r++) {
  const order = r % 2 ? [true, false] : [false, true];
  for (const on of order) {
    const out = await run(on);
    // Echo the thing we think we set, next to the result. Four "different"
    // configurations once ran identically in this repo while the report printed
    // four different numbers.
    const echo = await page.evaluate(() => {
      const m = window.__map;
      const vis = id => { try { return m.getLayer(id) ? (m.getLayoutProperty(id, 'visibility') || 'visible') : 'absent'; } catch (e) { return 'err'; } };
      return { wall: vis('moody-wall'), roof: vis('moody-roof'), cap: vis('moody-cap') };
    });
    results[on ? 'on' : 'off'].push({ ...out, echo });
  }
}

const pad = (v, n) => String(v).padStart(n);
console.log('\nDRAW COST — dropped frames over ' + MS + ' ms, bearing sweep over the precinct');
console.log('config   dropMIN   fpsBest   all reps         layers actually set');
for (const [k, arr] of Object.entries(results)) {
  const drops = arr.map(a => a.dropped);
  const e = arr[0].echo;
  console.log(k.padEnd(8) + pad(Math.min(...drops), 7) +
    pad(Math.max(...arr.map(a => a.fps)).toFixed(1), 10) + '   ' +
    ('[' + drops.join(', ') + ']').padEnd(17) +
    'wall=' + e.wall + ' roof=' + e.roof + ' cap=' + e.cap);
}
const min = k => Math.min(...results[k].map(a => a.dropped));
const spread = k => Math.max(...results[k].map(a => a.dropped)) - min(k);
const delta = min('on') - min('off');
console.log('\ndelta (MIN of ' + REPS + ' reps): ' + (delta >= 0 ? '+' : '') + delta +
            ' dropped frames.  within-config spread: off ' + spread('off') +
            ', on ' + spread('on'));
console.log('If the delta is smaller than the spread there is no result, and saying ' +
            'otherwise is how a false regression gets reported.');

// ── the repaint path ───────────────────────────────────────────────
console.log('\nREPAINT COST — one time-of-day step, milliseconds, MIN of 9');
const repaint = await page.evaluate(async () => {
  const m = window.__map;
  const timeIt = (fn) => {
    const runs = [];
    for (let i = 0; i < 9; i++) {
      const p = 0.2 + (i % 5) * 0.12;
      const t = performance.now();
      fn(p);
      runs.push(performance.now() - t);
    }
    return +Math.min(...runs).toFixed(2);
  };
  const moody = timeIt(p => window.applyMoodyColors(m, p));
  // The whole hook, including js/facades.js's own ~30-40 image atlas, so the
  // share this pass adds is readable rather than asserted.
  const all = timeIt(p => window.applyTimeOfDay(m, p, true));
  return { moody, all };
});
console.log('  applyMoodyColors (8 tiles)      ' + repaint.moody.toFixed(2) + ' ms');
console.log('  applyTimeOfDay  (whole hook)    ' + repaint.all.toFixed(2) + ' ms');
console.log('  this pass is ' + (100 * repaint.moody / Math.max(repaint.all, 0.01)).toFixed(0) +
            '% of the time-of-day step.');

await browser.close();
