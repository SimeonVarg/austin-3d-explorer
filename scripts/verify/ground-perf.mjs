/**
 * ground-perf.mjs — what do the ground + trees actually cost?
 *
 * Headed on purpose (swiftshader measures the software rasteriser, not the
 * app), no screenshots during timing (they block ~250 ms), a scripted bearing
 * sweep so every run renders identical content, configurations interleaved,
 * and the MINIMUM of the reps reported — a mean measures the machine.
 *
 * Counts dropped frames, not median frame time: the median sits on the vsync
 * floor even while half the frames are being dropped.
 */
import { chromium } from 'playwright-core';
import { chromePath, BASE as SERVER } from './chrome.mjs';

const REPS = 3;
const MS = 4200;

const CONFIGS = {
  all:      {},                                    // everything on
  noTrees:  { trees: false },
  noGround: { ground: false },
  neither:  { trees: false, ground: false },
};

const browser = await chromium.launch({
  executablePath: chromePath(), headless: false,
  args: ['--no-sandbox', '--disable-features=CalculateNativeWinOcclusion'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.goto(SERVER + '/index.html?intro=0&drift=0', { timeout: 90000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 90000 });
await page.waitForTimeout(6000);
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

async function run(cfg) {
  await page.evaluate((c) => {
    const m = window.__map;
    const vis = (ids, on) => ids.forEach(id => {
      try { if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'); } catch (e) {}
    });
    vis(['trees-canopy', 'trees-trunk'], c.trees !== false);
    vis(['ground-areas', 'ground-paths', 'ground-paths-casing'], c.ground !== false);
    m.jumpTo({ center: [-97.7396, 30.2852], zoom: 17.0, pitch: 74, bearing: 0 });
  }, cfg);
  await page.waitForTimeout(1200);
  // Scripted sweep: identical content every run, and it forces real redraws.
  const dropped = await page.evaluate(async (ms) => {
    const m = window.__map;
    const dts = [];
    let last = performance.now(), t0 = last, b = 0;
    await new Promise(res => {
      const step = () => {
        const now = performance.now();
        dts.push(now - last); last = now;
        b += 0.9; m.jumpTo({ center: [-97.7396, 30.2852], zoom: 17.0, pitch: 74, bearing: b });
        if (now - t0 < ms) requestAnimationFrame(step); else res();
      };
      requestAnimationFrame(step);
    });
    const drop = dts.slice(3).reduce((a, d) => a + Math.max(0, Math.round(d / 16.67) - 1), 0);
    return { dropped: drop, frames: dts.length,
             fps: +(1000 * dts.length / (performance.now() - t0)).toFixed(1) };
  }, MS);
  return dropped;
}

const results = {};
for (const k of Object.keys(CONFIGS)) results[k] = [];
for (let r = 0; r < REPS; r++) {
  for (const [k, cfg] of Object.entries(CONFIGS)) {
    results[k].push(await run(cfg));
  }
}
console.log('config      dropped(min)   fps(best)   [all reps dropped]');
for (const [k, arr] of Object.entries(results)) {
  const drops = arr.map(a => a.dropped);
  const fps = arr.map(a => a.fps);
  console.log('%-11s %6d        %6.1f      [%s]',
    k, Math.min(...drops), Math.max(...fps), drops.join(', '));
}
await browser.close();
