/**
 * capitol-merge.mjs — the Capitol's trees and paths are still there after the
 * merge stopped re-downloading the whole city.
 *
 * WHAT CHANGED AND WHY THIS GUARDS IT. js/capitol.js used to add the Capitol's
 * features with `setData`, which replaces a source wholesale — so appending 612
 * trees meant re-fetching all 25,341 of the city's first. That was 9.94 MB of a
 * 39.73 MB load (scripts/verify/payload.mjs, 2026-08-01). It now uses
 * `updateData({ add })`, which appends a diff in the worker.
 *
 * The failure mode of that swap is SILENT. If `updateData` is missing, rejects
 * the diff, or lands before the base source finishes loading, the Capitol
 * grounds simply do not appear — and from campus, which is where every other
 * script points the camera, you cannot tell. Hence a check that flies south and
 * counts.
 *
 * IT ASSERTS ON THE SOURCE, NOT THE RENDER. HANDOFF §2: queryRenderedFeatures is
 * view-dependent and lies for 3D — capitol-probe.mjs was written because it
 * reported 0 for extrusions that were plainly on screen. `querySourceFeatures`
 * reads the tiles the worker actually built, which is exactly the thing being
 * changed here.
 *
 * The counts are lower bounds, not the file totals: querySourceFeatures only
 * sees tiles loaded for the current camera, and a feature crossing a tile seam
 * is returned once per tile. So the thresholds are deliberately far below 612
 * and 1802 — this is a did-the-append-happen check, not a census.
 *
 * Usage:  VERIFY_URL=http://127.0.0.1:8123 node scripts/verify/capitol-merge.mjs
 */
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';
import fs from 'node:fs';

fs.mkdirSync('shots', { recursive: true });

// Bounds of the two Capitol files, from their own coordinates. Anything inside
// these came from capitol_*.geojson: the city files stop well north of here.
const BOX = { w: -97.7530, s: 30.2690, e: -97.7230, n: 30.2770 };
const POSE = { center: [-97.7404, 30.2747], zoom: 16.4, pitch: 62, bearing: 20 };

const MIN_TREES = 100;
const MIN_GROUND = 200;

const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const capitolLog = [];
page.on('console', m => {
  const t = m.text();
  if (t.includes('[capitol]')) capitolLog.push(t);
});
page.on('pageerror', e => console.log('PAGEERR', e.message));

await page.goto(BASE + '/_harness.html?intro=0&drift=0', { waitUntil: 'networkidle', timeout: 90000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 90000 });

await page.evaluate(p => window.__map.jumpTo(p), POSE);
await page.evaluate(() => new Promise(r => {
  const m = window.__map;
  if (m.loaded()) return r();
  m.once('idle', r); setTimeout(r, 25000);
}));
await page.waitForTimeout(3000);

const counts = await page.evaluate(box => {
  const m = window.__map;
  const inBox = f => {
    // Any vertex inside the box is enough; these are small features.
    const stack = [f.geometry && f.geometry.coordinates];
    while (stack.length) {
      const c = stack.pop();
      if (!c) continue;
      if (typeof c[0] === 'number') {
        if (c[0] >= box.w && c[0] <= box.e && c[1] >= box.s && c[1] <= box.n) return true;
      } else for (const k of c) stack.push(k);
    }
    return false;
  };
  const count = id => {
    if (!m.getSource(id)) return -1;
    try { return m.querySourceFeatures(id).filter(inBox).length; } catch (e) { return -2; }
  };
  return { trees: count('austin-trees'), ground: count('austin-ground') };
}, BOX);

// Screenshot twice and keep the second: scripts/verify/README.md records that
// the first capture after a camera move regularly catches a half-drawn frame.
await page.screenshot({ path: 'shots/_capitol-merge-1.png' });
await page.waitForTimeout(1200);
await page.screenshot({ path: 'shots/capitol-merge.png' });

const usedAppend = capitolLog.some(t => /appended to/.test(t));
const usedRefetch = capitolLog.some(t => /refetched/.test(t));

console.log('\ncapitol console:');
for (const t of capitolLog) console.log('  ' + t);
console.log('\n  path taken            ' + (usedAppend ? 'updateData (no refetch)'
                                          : usedRefetch ? 'FALLBACK setData + refetch'
                                          : 'NEITHER - merge never ran'));
console.log('  trees in Capitol box  ' + counts.trees + '   (need >= ' + MIN_TREES + ')');
console.log('  ground in Capitol box ' + counts.ground + '   (need >= ' + MIN_GROUND + ')');

const pass = usedAppend && counts.trees >= MIN_TREES && counts.ground >= MIN_GROUND;
console.log('\n' + (pass ? 'PASS' : 'FAIL') + '  shots/capitol-merge.png');

await browser.__done();
process.exitCode = pass ? 0 : 1;
