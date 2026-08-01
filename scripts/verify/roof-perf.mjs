/**
 * roof-perf.mjs — what do the pitched roofs cost?
 *
 * The roof bake went from 146 ring polygons to ~4,300 per-edge facets so each
 * slope could be shaded for the direction it faces. That is a real increase in
 * extruded geometry over the busiest part of the scene, and this project does
 * not get to claim a perf cost it has not measured (HANDOFF §8).
 *
 * Same methodology as ground-perf.mjs, and for the same reasons: headed (a
 * software rasteriser measures the rasteriser), no screenshots during timing,
 * a scripted bearing sweep so every run renders identical content, interleaved
 * configurations, and the MINIMUM of the reps — a mean measures the machine.
 * Dropped frames, not median frame time: the median sits on the vsync floor
 * even while half the frames are being missed.
 */
import { chromium } from 'playwright-core';
import { chromePath, BASE as SERVER, launch } from './chrome.mjs';

const REPS = 3;
const MS = 4200;

const CONFIGS = {
  roofsOn:  {},
  roofsOff: { roofs: false },
};

const browser = await launch(chromium, { gl: 'hardware' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.goto(SERVER + '/index.html?intro=0&drift=0', { timeout: 90000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 90000 });
await page.waitForTimeout(6000);
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

async function run(cfg) {
  await page.evaluate((c) => {
    const m = window.__map;
    try {
      if (m.getLayer('roofs-pitched')) {
        m.setLayoutProperty('roofs-pitched', 'visibility', c.roofs !== false ? 'visible' : 'none');
      }
    } catch (e) {}
    // Over the historic halls, where every pitched roof in the scene lives.
    m.jumpTo({ center: [-97.7390, 30.2850], zoom: 17.2, pitch: 74, bearing: 0 });
  }, cfg);
  await page.waitForTimeout(1200);
  return await page.evaluate(async (ms) => {
    const m = window.__map;
    const dts = [];
    let last = performance.now(), t0 = last, b = 0;
    await new Promise(res => {
      const step = () => {
        const now = performance.now();
        dts.push(now - last); last = now;
        b += 0.9; m.jumpTo({ center: [-97.7390, 30.2850], zoom: 17.2, pitch: 74, bearing: b });
        if (now - t0 < ms) requestAnimationFrame(step); else res();
      };
      requestAnimationFrame(step);
    });
    const drop = dts.slice(3).reduce((a, d) => a + Math.max(0, Math.round(d / 16.67) - 1), 0);
    return { dropped: drop, frames: dts.length,
             fps: +(1000 * dts.length / (performance.now() - t0)).toFixed(1) };
  }, MS);
}

const results = {};
for (const k of Object.keys(CONFIGS)) results[k] = [];
for (let r = 0; r < REPS; r++) {
  for (const [k, cfg] of Object.entries(CONFIGS)) results[k].push(await run(cfg));
}
console.log('config      dropped(min)   fps(best)   [all reps dropped]');
for (const [k, arr] of Object.entries(results)) {
  const drops = arr.map(a => a.dropped);
  const fps = arr.map(a => a.fps);
  // Node's console.log has no width/precision specifiers — pad by hand or the
  // header and the rows do not line up (and %-11s prints literally).
  console.log(k.padEnd(11) + String(Math.min(...drops)).padStart(7)
    + Math.max(...fps).toFixed(1).padStart(13) + '      [' + drops.join(', ') + ']');
}
await browser.__done();
