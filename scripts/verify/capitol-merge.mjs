/**
 * capitol-merge.mjs — the Capitol's grounds, walks and trees are really in the
 * scene, counted in the sources the app actually uses.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * REWRITTEN 2026-08-16. THIS FILE WAS RED FOR THIRTEEN DAYS BECAUSE IT WAS
 * ASKING ABOUT A DESIGN THAT NO LONGER EXISTS.
 *
 * It used to ask two questions:
 *
 *   1. did the console print `appended to`   — the log line of the
 *      `updateData({ add })` path;
 *   2. how many `austin-trees` / `austin-ground` features are inside the
 *      Capitol box.
 *
 * `js/capitol.js` now gives the Capitol grounds and trees THEIR OWN SOURCES —
 * `austin-capitol-ground` and `austin-trees-capitol` — drawn by their own and
 * cloned layers. So the old file greped for a line the app no longer prints and
 * counted features in sources the Capitol no longer writes to, and reported:
 *
 *      path taken            NEITHER - merge never ran
 *      trees in Capitol box  0        (need >= 100)
 *
 * Counted against the sources that exist, at this same pose and inside this
 * same box, the scene holds 1483 trees and 2722 ground features and looks
 * exactly right (`shots/reds/capitol-grounds.png`, §158). **The zero was the
 * app telling the gate, correctly, that it was reading the wrong source.**
 * HANDOFF §49 wrote this diagnosis down on Aug 3 and it sat unclaimed; §158
 * found it again independently. This is the fifth guard in this repo shown to
 * be blind to the thing it guards, so the rewrite is built not to rot the same
 * way:
 *
 *   - IT READS `window.__capitolMerge`, the record `js/capitol.js` keeps of
 *     what it actually did, instead of grepping console text. A console string
 *     is prose; that object is the app's own answer and changes with it.
 *   - IT ASKS THE STYLE WHICH SOURCES THE CAPITOL DREW INTO rather than
 *     hardcoding names, and counts features in every one of them. A future bake
 *     that renames or splits a source is then in scope automatically.
 *   - IT FAILS ON AN UNRECOGNISED SHAPE instead of counting 0. The way this
 *     family of checker fails is by looking somewhere empty and calling the
 *     scene clean, so "no Capitol sources at all" is red, loudly, and not a
 *     count of zero that reads like a defect in the city.
 *
 * IT STILL ASSERTS ON THE SOURCE, NOT THE RENDER. HANDOFF §2:
 * `queryRenderedFeatures` is view-dependent and returns 0 for fill-extrusion
 * layers at poses that demonstrably draw. `querySourceFeatures` reads the tiles
 * the worker built. Note that it needs `{ sourceLayer }` for a VECTOR source
 * and these are GeoJSON — the helper handles both, because `austin-trees` is
 * vector now and reading it without one is the identical bug in `night-luma`.
 *
 * The counts are lower bounds, not a census: `querySourceFeatures` only sees
 * tiles loaded for the current camera and returns a seam-crossing feature once
 * per tile. Thresholds are set well under the file totals on purpose.
 *
 * Usage:  VERIFY_URL=http://127.0.0.1:8123 node scripts/verify/capitol-merge.mjs
 *         node scripts/verify/capitol-merge.mjs --selftest   (see the bottom)
 */
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';
import fs from 'node:fs';

fs.mkdirSync('shots', { recursive: true });

// Bounds of the two Capitol files, from their own coordinates. Anything inside
// these came from capitol_*.geojson: the city files stop well north of here.
const BOX = { w: -97.7530, s: 30.2690, e: -97.7230, n: 30.2770 };
const POSE = { center: [-97.7404, 30.2747], zoom: 16.4, pitch: 62, bearing: 20 };

// Lower bounds, chosen under the measured counts (1483 trees / 2722 ground in
// this box at this pose, §158) with room for tile-loading variation.
const MIN_TREES = 100;
const MIN_GROUND = 200;

// --selftest breaks the thing this file guards and requires the gate to go red.
// Three gates in this repo were exiting 0 while failing; a guard that has never
// been watched fail is a guard nobody has tested.
const SELFTEST = process.argv.includes('--selftest');

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
// js/capitol.js loads its two files asynchronously after style load, so wait on
// its own record rather than on a fixed sleep. A timeout here is the honest
// answer "the Capitol never merged", which is the defect this file is for.
await page.waitForFunction(
  () => window.__capitolMerge && Object.keys(window.__capitolMerge).length >= 2,
  null, { timeout: 40000 }).catch(() => {});
await page.waitForTimeout(3000);

if (SELFTEST) {
  // Take the Capitol's own sources out from under the gate. If it still passes,
  // it is not reading them — which is precisely the failure this file just had.
  await page.evaluate(() => {
    const m = window.__map;
    for (const L of m.getStyle().layers.slice())
      if (/capitol/i.test(L.source || '')) { try { m.removeLayer(L.id); } catch (e) {} }
    for (const id of ['austin-capitol-ground', 'austin-trees-capitol'])
      { try { m.removeSource(id); } catch (e) {} }
    window.__capitolMerge = {};
  });
  await page.waitForTimeout(1500);
}

const probe = await page.evaluate(box => {
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
  // Count without assuming the source's TYPE. querySourceFeatures returns []
  // for a VECTOR source given no sourceLayer — that is exactly how night-luma
  // came to read 0 trees on a frame holding 31,723 — so the layer is asked.
  const layers = m.getStyle().layers || [];
  const count = id => {
    if (!m.getSource(id)) return -1;
    let sl = null;
    for (const L of layers) if (L.source === id && L['source-layer']) { sl = L['source-layer']; break; }
    try {
      const found = sl ? m.querySourceFeatures(id, { sourceLayer: sl })
                       : m.querySourceFeatures(id);
      return found.filter(inBox).length;
    } catch (e) { return -2; }
  };
  const rec = window.__capitolMerge || {};
  const claimed = Object.keys(rec);
  const drawn = {}, counts = {};
  for (const id of claimed) {
    drawn[id] = layers.filter(L => L.source === id &&
      (m.getLayoutProperty(L.id, 'visibility') || 'visible') !== 'none').length;
    counts[id] = count(id);
  }
  // The two sources the OLD version of this file counted, kept in the report so
  // a reader can see why its zero was the app answering correctly.
  return { rec, claimed, drawn, counts,
           legacy: { 'austin-trees': count('austin-trees'),
                     'austin-ground': count('austin-ground') } };
}, BOX);

// Screenshot twice and keep the second: scripts/verify/README.md records that
// the first capture after a camera move regularly catches a half-drawn frame.
await page.screenshot({ path: 'shots/_capitol-merge-1.png' });
await page.waitForTimeout(1200);
await page.screenshot({ path: 'shots/capitol-merge.png' });

const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok });
  console.log((ok ? ' PASS  ' : '*FAIL  ') + name + (detail ? '\n       ' + detail : ''));
};

console.log('\ncapitol console:');
for (const t of capitolLog) console.log('  ' + t);

console.log('\n  window.__capitolMerge — the app’s own record of what it did:');
for (const id of probe.claimed)
  console.log('    ' + id.padEnd(24) + JSON.stringify(probe.rec[id]));
if (!probe.claimed.length) console.log('    {} — EMPTY');

console.log('\n  features inside the Capitol box, per source the app claims:');
for (const id of probe.claimed)
  console.log('    ' + id.padEnd(24) + String(probe.counts[id]).padStart(6)
              + '   drawn by ' + probe.drawn[id] + ' visible layer(s)');
console.log('  the two sources this file used to count, for the record:');
for (const [id, n] of Object.entries(probe.legacy))
  console.log('    ' + id.padEnd(24) + String(n).padStart(6));

// ── the assertions ────────────────────────────────────────────────────────
//
// Named by SUBJECT — grounds, trees — and resolved through __capitolMerge, so a
// rename in js/capitol.js changes one string in THAT file and none in this one.
const groundIds = probe.claimed.filter(id => /ground/.test(id));
const treeIds = probe.claimed.filter(id => /tree/.test(id));

check('js/capitol.js recorded what it did for both the grounds and the trees',
  groundIds.length >= 1 && treeIds.length >= 1,
  'ground sources ' + JSON.stringify(groundIds) + ', tree sources ' + JSON.stringify(treeIds)
  + '  — an empty record means the merge never ran, which is the defect this file is for');

const treeN = treeIds.reduce((s, id) => s + Math.max(0, probe.counts[id]), 0);
const groundN = groundIds.reduce((s, id) => s + Math.max(0, probe.counts[id]), 0);

check('the Capitol grove is in the tiles under this camera',
  treeN >= MIN_TREES, treeN + ' tree features in the box (need >= ' + MIN_TREES + ')');
check('the Capitol lawns and walks are in the tiles under this camera',
  groundN >= MIN_GROUND, groundN + ' ground features in the box (need >= ' + MIN_GROUND + ')');
check('every source the Capitol claims is drawn by at least one visible layer',
  probe.claimed.length > 0 && probe.claimed.every(id => probe.drawn[id] > 0),
  probe.claimed.map(id => id + ':' + probe.drawn[id]).join('  ')
  + '  — a source with no visible layer is data nobody can see');

const pass = checks.every(c => c.ok);
console.log('\n' + (pass ? ' PASS' : '*FAIL') + '  capitol-merge: '
            + checks.filter(c => c.ok).length + '/' + checks.length
            + '   shots/capitol-merge.png'
            + (SELFTEST ? '   [--selftest: RED IS THE CORRECT RESULT]' : ''));

await browser.__done();
if (SELFTEST) {
  console.log(pass ? '\n  SELFTEST FAILED: the gate passed with the Capitol sources removed.'
                   : '\n  selftest ok: the gate goes red when the thing it guards is removed.');
  process.exitCode = pass ? 1 : 0;
} else {
  process.exitCode = pass ? 0 : 1;
}
