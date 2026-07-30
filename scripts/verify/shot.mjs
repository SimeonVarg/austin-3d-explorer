/**
 * shot.mjs — render the REAL Austin 3D Explorer app headless and screenshot it.
 *
 * Usage: node shot.mjs <outPrefix> [shotsJson]
 *   shotsJson: [{name, p, center:[lng,lat], zoom, pitch, bearing}]
 */
import { chromium } from 'playwright-core';
import { chromePath } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';

const EXE = chromePath();
const BASE = 'http://127.0.0.1:8099/_harness.html';
const OUT = process.argv[2] || 'shot';
const SHOTS = process.argv[3]
  ? JSON.parse(fs.readFileSync(process.argv[3], 'utf8'))
  : [{ name: 'day', p: 0.12 }];

const outDir = path.resolve('shots');
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: EXE,
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--ignore-gpu-blocklist', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));

await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
await page.waitForTimeout(4000);
// The graphics auto-detect probe rewrites every setting 11 s after load, which
// would silently change the look halfway through a shot list.
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

for (const s of SHOTS) {
  await page.evaluate(async (s) => {
    const m = window.__map;
    // `gfx` is either a preset name or an object of overrides, so a shot list can
    // compare quality levels side by side.
    if (s.gfx && window.GFX) {
      if (typeof s.gfx === 'string' && window.GFX_PRESETS[s.gfx]) Object.assign(window.GFX, window.GFX_PRESETS[s.gfx]);
      else if (typeof s.gfx === 'object') Object.assign(window.GFX, s.gfx);
      window.applyGraphics();
    }
    if (s.center) m.jumpTo({ center: s.center, zoom: s.zoom ?? 16.5, pitch: s.pitch ?? 64, bearing: s.bearing ?? 90 });
    if (typeof s.p === 'number') {
      const sl = document.getElementById('tod-slider'); if (sl) sl.value = String(s.p);
      window.applyTimeOfDay(m, s.p);
    }
  }, s);
  // Data-driven paint expressions (roof colours) and the regenerated facade
  // atlas do not land in the same frame as the call. Settle, repaint, and take
  // a throwaway shot first — the first frame after a big time-of-day jump can
  // still be showing the previous state.
  await page.waitForTimeout(4000);
  await page.evaluate(() => window.__map.triggerRepaint());
  await page.waitForTimeout(1500);
  const file = path.join(outDir, `${OUT}-${s.name}.png`);
  await page.screenshot({ path: file });
  await page.waitForTimeout(600);
  await page.screenshot({ path: file });
  console.log('WROTE', file);
}

const diag = await page.evaluate(() => {
  const m = window.__map;
  const q = id => { try { return m.queryRenderedFeatures({ layers: [id] }).length; } catch (e) { return -1; } };
  const srcFeat = id => { try { return m.querySourceFeatures(id).length; } catch (e) { return -1; } };
  return {
    buildings: q('buildings-3d'), roofs: q('buildings-roof'), parts: q('parts-3d'),
    trees: q('trees-canopy'), signs: q('signs-label'), labels: q('buildings-labels'),
    srcBuildings: srcFeat('austin-buildings'),
    layers: m.getStyle().layers.filter(l => l.layout?.visibility !== 'none').map(l => l.id),
  };
});
console.log('DIAG', JSON.stringify(diag, null, 1));
if (errors.length) console.log('ERRORS', errors.slice(0, 12));
await browser.close();
