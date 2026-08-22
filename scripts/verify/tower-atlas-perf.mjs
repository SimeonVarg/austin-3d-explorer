/**
 * tower-atlas-perf.mjs — does TOWER_SOFTEN's low-pass cost anything per repaint?
 *
 * QUEUE F2 (docs/facade-atlas-map.md §2, docs/shimmer-mechanism.md): the
 * shim-lowpass fix ported to js/tower.js the same way it was ported to
 * js/drag.js — a box blur inside `tileData`, called from `registerPatterns`
 * (init) and `repaintPatterns` (time-of-day change) only, never from the
 * render loop. Structurally this cannot cost a flying frame anything; this
 * script checks the one place it COULD cost something — the repaint itself
 * — by timing `applyTowerColors(map, p, true)` (which calls repaintPatterns)
 * with TOWER_SOFTEN.RADIUS forced to 0 vs the shipped default, INTERLEAVED
 * in one page load per CLAUDE.md rule 10 (a mean/single-config run measures
 * the machine, not the change).
 *
 * HEADED (swiftshader under --headless measures the software rasteriser, not
 * the app — same rule facade-perf.mjs and tower-perf.mjs both carry).
 *
 * Usage: node tower-atlas-perf.mjs [reps]
 */
import { chromium } from 'playwright-core';
import { BASE as SERVER, launch } from './chrome.mjs';

const REPS = parseInt(process.argv[2] || '12', 10);

const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.bringToFront();
await page.goto(SERVER + '/index.html?intro=0&drift=0', { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 90000 });
await page.waitForTimeout(6000);
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
await page.evaluate(() => window.__map.jumpTo({ center: [-97.73937, 30.28627], zoom: 18.5, pitch: 68, bearing: 200 }));
await page.waitForTimeout(2000);

const result = await page.evaluate(async (reps) => {
  const m = window.__map;
  if (!window.TOWER_SOFTEN) return { error: 'window.TOWER_SOFTEN not found' };
  const fams = Object.keys(window.TOWER_SOFTEN.RADIUS);
  const shipped = {}; for (const f of fams) shipped[f] = window.TOWER_SOFTEN.RADIUS[f];
  const setR = r => { for (const f of fams) window.TOWER_SOFTEN.RADIUS[f] = r; };

  const off = [], on = [];
  // Interleaved and counterbalanced: alternate which config goes first each
  // rep so machine drift across the run cannot favour either arm.
  for (let i = 0; i < reps; i++) {
    const offFirst = i % 2 === 0;
    const runOff = () => { setR(0); const t = performance.now(); window.applyTowerColors(m, 0.20 + 0.02 * i, true); return performance.now() - t; };
    const runOn = () => { setR(shipped.twplain); window.TOWER_SOFTEN.RADIUS = { ...shipped }; const t = performance.now(); window.applyTowerColors(m, 0.20 + 0.02 * i, true); return performance.now() - t; };
    if (offFirst) { off.push(runOff()); await new Promise(r => requestAnimationFrame(r)); on.push(runOn()); }
    else { on.push(runOn()); await new Promise(r => requestAnimationFrame(r)); off.push(runOff()); }
    await new Promise(r => requestAnimationFrame(r));
  }
  setR(shipped.twplain); window.TOWER_SOFTEN.RADIUS = { ...shipped }; // restore
  const n = Object.keys(window.__towerPats || {}).length || (window.__towerPats && window.__towerPats.length) || 'unknown';
  return { n, offMin: Math.min(...off), offMed: off.slice().sort((a,b)=>a-b)[Math.floor(off.length/2)],
           onMin: Math.min(...on), onMed: on.slice().sort((a,b)=>a-b)[Math.floor(on.length/2)], reps };
}, REPS);

console.log('TOWER ATLAS REPAINT COST', JSON.stringify(result));
if (!result.error) {
  console.log(`radius=0 (no blur):  ${result.offMin.toFixed(2)} ms best, ${result.offMed.toFixed(2)} ms median`);
  console.log(`shipped radius:      ${result.onMin.toFixed(2)} ms best, ${result.onMed.toFixed(2)} ms median`);
  console.log(`delta (best):   ${(result.onMin - result.offMin).toFixed(2)} ms`);
}
await page.close();
await browser.__done();
