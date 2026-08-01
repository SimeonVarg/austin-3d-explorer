/**
 * stadium-perf.mjs — what does the DKR bowl actually cost?
 *
 * The bowl replaced one 63-vertex extrusion with twenty-five features and one
 * extra patterned fill-extrusion layer. That should be free next to 2,443
 * buildings, but "should be" is not a measurement, and ground-perf.mjs cannot
 * answer it: its sweep is over the corridor and its own reps spread 12..50
 * dropped frames, which is wider than anything this could cost.
 *
 * Same discipline as the other perf scripts: headed Chrome (swiftshader would
 * measure the software rasteriser), no screenshots during timing, a scripted
 * sweep so both configs render identical content, configs INTERLEAVED, and the
 * MINIMUM of the reps — a mean measures the machine.
 */
import { chromium } from 'playwright-core';
import { chromePath, BASE as SERVER, launch } from './chrome.mjs';

const REPS = 4, MS = 3600;
const STADIUM_LAYERS = ['stadium-wall', 'stadium-wall-roof', 'stadium-seating'];

const browser = await launch(chromium, { gl: 'hardware' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(SERVER + '/_harness.html?intro=0&drift=0', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
await page.waitForTimeout(9000);
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

async function run(on) {
  return page.evaluate(async ({ on, MS, STADIUM_LAYERS }) => {
    const m = window.__map;
    for (const id of STADIUM_LAYERS) {
      try { m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'); } catch (e) {}
    }
    m.jumpTo({ center: [-97.7332, 30.2836], zoom: 16.8, pitch: 66, bearing: 0 });
    await new Promise(r => setTimeout(r, 1200));
    const dts = [];
    let last = null, b = 0;
    const t0 = performance.now();
    await new Promise(res => {
      const step = ts => {
        if (last !== null) dts.push(ts - last);
        last = ts;
        m.jumpTo({ center: [-97.7332, 30.2836], zoom: 16.8, pitch: 66, bearing: (b += 1.5) % 360 });
        if (performance.now() - t0 < MS) return requestAnimationFrame(step);
        res();
      };
      requestAnimationFrame(step);
    });
    // Dropped frames, not median frame time: the median sits on the vsync floor
    // even while half the frames are being dropped.
    const dropped = dts.reduce((a, d) => a + Math.max(0, Math.round(d / 16.67) - 1), 0);
    return { dropped, fps: Math.round(1000 / (dts.reduce((a, d) => a + d, 0) / dts.length) * 10) / 10 };
  }, { on, MS, STADIUM_LAYERS });
}

const res = { on: [], off: [] };
for (let i = 0; i < REPS; i++) {           // interleaved
  res.on.push(await run(true));
  res.off.push(await run(false));
}
const min = a => Math.min(...a.map(r => r.dropped));
const best = a => Math.max(...a.map(r => r.fps));
console.log('config        dropped(min)  fps(best)   [all reps]');
for (const k of ['on', 'off']) {
  console.log(`stadium ${k.padEnd(4)} ${String(min(res[k])).padStart(10)} ${String(best(res[k])).padStart(10)}   ` +
              res[k].map(r => r.dropped).join(', '));
}
console.log(`\ncost of the bowl: ${min(res.on) - min(res.off)} dropped frames, ` +
            `${(best(res.off) - best(res.on)).toFixed(1)} fps`);
await browser.__done();
