/**
 * roofscape-shot.mjs — screenshot the app with the roofscape layer ON or OFF.
 *
 * Same as shot.mjs, with one addition: js/roofs.js is injected into the page
 * with `addScriptTag` instead of being read from a <script> tag in index.html.
 * app.js and index.html belong to another pass, so the roofscape self-installs
 * (see the autoInstall block at the bottom of js/roofs.js) and this proves that
 * path works against the REAL index.html rather than a special harness copy.
 *
 * Usage: node roofscape-shot.mjs <outPrefix> <shotsJson> [--off] [--detail 0.45]
 *   --off       do not inject the module at all — the true "before"
 *   --detail v  set the density knob before shooting
 */
import { chromium } from 'playwright-core';
import { chromePath, BASE as SERVER } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';

const EXE = chromePath();
const BASE = SERVER + '/_harness.html?intro=0&drift=0';
const OUT = process.argv[2] || 'roofscape';
const SHOTS = JSON.parse(fs.readFileSync(process.argv[3] || 'shots-roofscape.json', 'utf8'));
const OFF = process.argv.includes('--off');
const di = process.argv.indexOf('--detail');
const DETAIL = di > 0 ? parseFloat(process.argv[di + 1]) : null;

const outDir = path.resolve('shots');
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: EXE, headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--ignore-gpu-blocklist', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));

await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
await page.waitForFunction(() => {
  const m = window.__map;
  if (!m || !m.getSource('austin-buildings')) return false;
  return ['austin-buildings', 'austin-ground', 'austin-trees']
    .every(s => !m.getSource(s) || m.isSourceLoaded(s));
}, null, { timeout: 90000 }).catch(() => console.log('WARN: sources not all loaded'));
await page.waitForTimeout(3000);
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

if (!OFF) {
  await page.addScriptTag({ path: path.resolve('../../js/roofs.js') });
  // The module installs itself on a 100 ms poll once buildings-3d exists, and
  // then a GeoJSON source has to be fetched and tiled in a worker. Wait for the
  // source to actually be loaded, not for a clock — sampling early is how a
  // "the layer did nothing" result gets reported for a layer that was fine.
  await page.waitForFunction(() => {
    const m = window.__map;
    return m.getSource('austin-roofscape') && m.isSourceLoaded('austin-roofscape');
  }, null, { timeout: 60000 }).catch(() => console.log('WARN: roofscape source not loaded'));
  if (DETAIL != null) await page.evaluate(d => window.setRoofDetail(d), DETAIL);
}

await page.waitForFunction(() => {
  const m = window.__map;
  if (m.isEasing && m.isEasing()) return false;
  try { if (window.__fly.eye().driving) return false; } catch (e) {}
  return true;
}, null, { timeout: 40000 }).catch(() => {});

for (const s of SHOTS) {
  await page.evaluate(async (s) => {
    const m = window.__map;
    if (s.gfx && window.GFX) {
      if (typeof s.gfx === 'string' && window.GFX_PRESETS[s.gfx]) Object.assign(window.GFX, window.GFX_PRESETS[s.gfx]);
      else if (typeof s.gfx === 'object') Object.assign(window.GFX, s.gfx);
      window.applyGraphics();
    }
    if (s.center) {
      if (m.isEasing && m.isEasing()) m.stop();
      m.jumpTo({ center: s.center, zoom: s.zoom ?? 16.5, pitch: s.pitch ?? 64, bearing: s.bearing ?? 90 });
    }
    if (typeof s.p === 'number') {
      const sl = document.getElementById('tod-slider'); if (sl) sl.value = String(s.p);
      window.applyTimeOfDay(m, s.p);
    }
  }, s);
  await page.waitForTimeout(4000);
  await page.evaluate(() => new Promise(r => {
    const m = window.__map;
    if (m.loaded()) return r();
    m.once('idle', r);
    setTimeout(r, 15000);
  }));
  await page.evaluate(() => window.__map.triggerRepaint());
  await page.waitForTimeout(1500);
  const file = path.join(outDir, `${OUT}-${s.name}.png`);
  await page.screenshot({ path: file });
  await page.waitForTimeout(600);
  await page.screenshot({ path: file });
  // The camera's own bounds, dumped next to the frame, are what let
  // scripts/roofscape_sbs.py stitch the SAME lon/lat box out of the z20 tiles.
  // Reading the pose back off the map rather than trusting the shot list is the
  // difference between a real side-by-side and two pictures of different places.
  const b = await page.evaluate(() => {
    const m = window.__map, bb = m.getBounds();
    return { w: bb.getWest(), s: bb.getSouth(), e: bb.getEast(), n: bb.getNorth(),
             center: m.getCenter().toArray(), zoom: m.getZoom(),
             pitch: m.getPitch(), bearing: m.getBearing() };
  });
  fs.writeFileSync(file.replace(/\.png$/, '.bounds.json'), JSON.stringify(b));
  console.log('WROTE', file);
}

const diag = await page.evaluate(() => {
  const m = window.__map;
  const q = id => { try { return m.queryRenderedFeatures({ layers: [id] }).length; } catch (e) { return -1; } };
  const src = id => { try { return m.querySourceFeatures(id).length; } catch (e) { return -1; } };
  return {
    injected: !!m.getSource('austin-roofscape'),
    detail: window.ROOFSCAPE ? (window.ROOFSCAPE.detail) : null,
    srcBase: src('austin-roofscape'),
    detailLoaded: !!m.getSource('austin-roofscape-detail'),
    srcDetail: m.getSource('austin-roofscape-detail') ? src('austin-roofscape-detail') : 0,
    deck: q('roofscape-deck'), major: q('roofscape-major'), minor: q('roofscape-minor'),
    buildings: q('buildings-3d'), pitched: q('roofs-pitched'),
  };
});
console.log('DIAG', JSON.stringify(diag));
if (errors.length) console.log('ERRORS', errors.slice(0, 12));
await browser.close();
