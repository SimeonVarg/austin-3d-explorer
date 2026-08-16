/**
 * _o4-treecount.mjs — WHY does night-luma.mjs report "0 trees" on a frame full
 * of trees, at four poses, on every retry?
 *
 * `night-luma.mjs`'s settle predicate is
 *
 *     ok = drift !== null && trees > 300 && bld > 300
 *
 * and the o4 pass measured, at all four poses:
 *
 *     *** NEVER SETTLED (0 trees, 4222 buildings, drift 0) ***
 *
 * `drift 0` means the frame was PERFECTLY stable — the strided luma probe moved
 * 0.0000 between rounds, against a bar of 0.05. `bld 4222` clears its bar
 * fourteen-fold. The entire red, and the 8 extra full-pose settles the retry
 * ladder then runs, come from `trees > 300` alone.
 *
 * THE HYPOTHESIS. `js/app.js:1376` now builds `austin-trees` from
 * `window.tileSource('trees')` — a **vector** source over pmtiles — falling back
 * to GeoJSON only when the archives are missing. `map.querySourceFeatures(id)`
 * called with no options returns [] for a vector source: MapLibre needs the
 * `sourceLayer`, which for a GeoJSON source is implicit and for a vector source
 * is not. `austin-buildings` still answers because it is still GeoJSON.
 *
 * If that is right, night-luma has been reading 0 trees since the tree layer was
 * tiled, regardless of what is on screen — the same shape as `capitol-merge`
 * (the-twelve.md #1): a checker keyed on a source shape the app stopped using.
 *
 * The discriminator prints, at night-luma's own `core` pose and settle:
 *   - the source TYPE for austin-trees and austin-buildings,
 *   - querySourceFeatures with NO options (what night-luma calls),
 *   - querySourceFeatures WITH the source-layer the app's own layers carry,
 *   - and the count of tree features actually rendered.
 *
 * Usage: VERIFY_URL=http://127.0.0.1:8512 node scripts/verify/_o4-treecount.mjs
 */
import { chromium } from 'playwright-core';
import { chromePath, GL_ARGS, BASE, launch } from './chrome.mjs';

// night-luma's own `core` pose, verbatim.
const POSE = { center: [-97.7395, 30.2860], zoom: 16.0, pitch: 68, bearing: 200 };

const browser = await launch(chromium, { executablePath: chromePath(), headless: true, args: GL_ARGS, maxMs: 900000 });
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
page.on('pageerror', e => console.log('PAGEERROR', e.message));
// night-luma loads _harness.html; so does this, so nothing differs but the query.
await page.goto(`${BASE}/_harness.html?intro=0&drift=0`, { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
await page.evaluate(() => { try { window.cancelGraphicsAutoDetect(); } catch (e) {} });
await page.waitForTimeout(4000);

const out = await page.evaluate(async POSE => {
  const m = window.__map;
  m.jumpTo(POSE);
  for (let i = 0; i < 60; i++) await new Promise(r => requestAnimationFrame(r));
  await new Promise(r => { if (m.loaded()) return r(); m.once('idle', r); setTimeout(r, 20000); });
  for (let i = 0; i < 120; i++) await new Promise(r => requestAnimationFrame(r));

  const style = m.getStyle();
  const srcIds = Object.keys(style.sources);
  const q = (id, sl) => {
    try { return m.querySourceFeatures(id, sl ? { sourceLayer: sl } : undefined).length; }
    catch (e) { return 'THREW: ' + e.message.slice(0, 60); }
  };
  // The source-layer the app's OWN layers carry for each source — the value
  // querySourceFeatures needs and night-luma never passes.
  const slOf = id => {
    const l = style.layers.find(x => x.source === id && x['source-layer']);
    return l ? l['source-layer'] : null;
  };
  const rows = [];
  for (const id of srcIds.filter(s => /trees|buildings|ground/.test(s))) {
    const sl = slOf(id);
    rows.push({
      id, type: style.sources[id].type, sourceLayer: sl,
      loaded: (() => { try { return m.isSourceLoaded(id); } catch (e) { return '?'; } })(),
      noOpts: q(id), withLayer: sl ? q(id, sl) : '(none declared)',
      layers: style.layers.filter(x => x.source === id).map(x => x.id),
    });
  }
  return {
    tilesOn: !!(window.TILES && window.TILES.on) ||
             (window.tileSource ? !!window.tileSource('trees') : null),
    treeSourceSpec: style.sources['austin-trees'],
    rows,
    zoom: +m.getZoom().toFixed(2),
  };
}, POSE);

console.log('\npmtiles archives present (tileSource("trees") non-null): ' + out.tilesOn);
console.log('austin-trees source spec: ' + JSON.stringify(out.treeSourceSpec));
console.log('map zoom at night-luma\'s core pose: ' + out.zoom);
console.log('');
console.log('source                     type      source-layer     loaded   qSF(no opts)   qSF(with layer)');
for (const r of out.rows) {
  console.log(
    r.id.padEnd(26) + String(r.type).padEnd(10) + String(r.sourceLayer).padEnd(17) +
    String(r.loaded).padEnd(9) + String(r.noOpts).padStart(12) + String(r.withLayer).padStart(18));
}
console.log('');
console.log('night-luma asserts `trees > 300 && bld > 300` on the qSF(no opts) column.');
console.log('If austin-trees is `vector` and its no-opts count is 0 while its');
console.log('with-layer count is large, the 0 is the QUERY, not the scene.');
await browser.__done();
