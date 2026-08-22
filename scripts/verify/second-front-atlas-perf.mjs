/**
 * second-front-atlas-perf.mjs — does the QUEUE F2 low-pass cost anything per
 * repaint, across all five newly-ported atlases at once?
 *
 * The verdict (docs/second-front-verdict.md) shipped all four fronts without
 * re-timing frame cost: "Frame/render cost of the combined build was not
 * independently re-timed in this pass." This script is that missing
 * measurement, generalizing tower-atlas-perf.mjs's method (interleaved,
 * counterbalanced, radius-0-vs-shipped, ONE page load) to every registry
 * QUEUE F2 touched: window.FACADE_SOFTEN, DRAG_SOFTEN, TOWER_SOFTEN,
 * MOODY_SOFTEN, ARTS_SOFTEN, PLACES_SOFTEN.
 *
 * WHAT THIS CANNOT COST, BY CONSTRUCTION (stated so a number near zero reads
 * as expected, not suspicious): every repaint function below runs at INIT and
 * on a TIME-OF-DAY TICK only, never inside the render loop
 * (docs/second-front-cost's own per-branch cost notes; verified again here by
 * reading every call site, not just cited) — `js/facades.js`'s own
 * `ATLAS.RELEASE` staleness system (the 46%->2-3% main-thread win, CLAUDE.md)
 * is untouched by any of this, since `PatternLowpass.blurWrap` never calls
 * `map.updateImage`/`addImage` itself. This script measures the ONE place a
 * per-family box blur COULD add cost: the repaint call itself.
 *
 * HEADED (swiftshader under --headless measures the software rasteriser, not
 * this atlas-generation code, which is plain JS/Canvas2D, not WebGL — same
 * rule every *-perf.mjs in this directory carries).
 *
 * Usage: node second-front-atlas-perf.mjs [reps]
 */
import { chromium } from 'playwright-core';
import { BASE as SERVER, launch } from './chrome.mjs';

const REPS = parseInt(process.argv[2] || '12', 10);

const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.bringToFront();
await page.goto(SERVER + '/index.html?intro=0&drift=0', { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 90000 });
await page.waitForTimeout(7000);
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

const result = await page.evaluate(async (reps) => {
  const m = window.__map;
  // { key, registry global, repaint fn, needs force arg }
  const DEFS = [
    { key: 'facade', S: 'FACADE_SOFTEN', fn: (p) => window.updateFacades && window.updateFacades(m, p) },
    { key: 'drag',   S: 'DRAG_SOFTEN',   fn: (p) => window.applyDragColors && window.applyDragColors(m, p) },
    { key: 'tower',  S: 'TOWER_SOFTEN',  fn: (p) => window.applyTowerColors && window.applyTowerColors(m, p, true) },
    { key: 'moody',  S: 'MOODY_SOFTEN',  fn: (p) => window.applyMoodyColors && window.applyMoodyColors(m, p) },
    { key: 'arts',   S: 'ARTS_SOFTEN',   fn: (p) => window.applyArtsColors && window.applyArtsColors(m, p, true) },
    { key: 'places', S: 'PLACES_SOFTEN', fn: (p) => window.applyPlacesColors && window.applyPlacesColors(m, p) },
  ];
  const out = {};
  for (const d of DEFS) {
    const S = window[d.S];
    if (!S) { out[d.key] = { error: 'registry not found: ' + d.S }; continue; }
    const fams = Object.keys(S.RADIUS);
    const shipped = {}; for (const f of fams) shipped[f] = S.RADIUS[f];
    // 'off' zeroes EVERY family (no blur anywhere). 'on' restores each
    // family's OWN shipped radius — NOT a single value broadcast to all of
    // them, which would be wrong the moment a registry's radii differ across
    // families (facades.js's five families, moody.js's seven materials) and
    // would silently measure "every family blurred at the largest family's
    // radius" instead of the real shipped configuration.
    const setZero = () => { for (const f of fams) S.RADIUS[f] = 0; };
    const setShipped = () => { for (const f of fams) S.RADIUS[f] = shipped[f]; };

    const off = [], on = [];
    for (let i = 0; i < reps; i++) {
      const p = 0.20 + 0.001 * i; // distinct p every rep so no repaint short-circuits on "unchanged"
      const offFirst = i % 2 === 0;
      const runOff = () => { setZero(); const t = performance.now(); d.fn(p); return performance.now() - t; };
      const runOn = () => { setShipped(); const t = performance.now(); d.fn(p); return performance.now() - t; };
      if (offFirst) { off.push(runOff()); await new Promise(r => requestAnimationFrame(r)); on.push(runOn()); }
      else { on.push(runOn()); await new Promise(r => requestAnimationFrame(r)); off.push(runOff()); }
      await new Promise(r => requestAnimationFrame(r));
    }
    setShipped(); // restore exactly
    const sorted = a => a.slice().sort((x, y) => x - y);
    out[d.key] = {
      offMin: Math.min(...off), offMed: sorted(off)[Math.floor(off.length / 2)],
      onMin: Math.min(...on), onMed: sorted(on)[Math.floor(on.length / 2)],
      deltaMin: Math.min(...on) - Math.min(...off),
    };
  }
  return out;
}, REPS);

console.log('SECOND-FRONT ATLAS REPAINT COST (reps=' + REPS + ')', JSON.stringify(result));
for (const [key, r] of Object.entries(result)) {
  if (r.error) { console.log(`${key}: ${r.error}`); continue; }
  console.log(`${key.padEnd(8)} off(min/med)=${r.offMin.toFixed(2)}/${r.offMed.toFixed(2)}ms  on(min/med)=${r.onMin.toFixed(2)}/${r.onMed.toFixed(2)}ms  delta(min)=${r.deltaMin.toFixed(2)}ms`);
}
await page.close();
await browser.__done();
