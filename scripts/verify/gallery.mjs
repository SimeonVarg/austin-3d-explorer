/**
 * gallery.mjs — high-quality stills of the REAL app at named poses, in either
 * orientation. This is the tool that renders the morning gallery, and the
 * before/after evidence for every visual change tonight.
 *
 * Usage: node gallery.mjs <outPrefix> <shotsJson> [portrait|landscape] [clip]
 *   shotsJson: [{name, p, center:[lng,lat], zoom, pitch, bearing, gfx}]
 *   clip: render with ?clip=1 — no chrome, what filmed footage looks like
 *
 * portrait  = 390x844 @3x (an iPhone 14/15 class buffer)
 * landscape = 1600x1000 @2x
 *
 * Same traps as shot.mjs: cancel the graphics auto-detect probe, settle after
 * every time-of-day jump, repaint, screenshot twice and keep the second.
 */
import { chromium } from 'playwright-core';
import { chromePath, BASE as SERVER, launch } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';

const EXE = chromePath();
const CLIP = process.argv.includes('clip');
const BASE = SERVER + '/_harness.html?intro=0' + (CLIP ? '&clip=1' : '');
const OUT = process.argv[2] || 'gallery';
const SHOTS = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const MODE = process.argv[4] === 'portrait' ? 'portrait' : 'landscape';

const VIEW = MODE === 'portrait'
  ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 }
  : { viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 };

const outDir = path.resolve('shots');
fs.mkdirSync(outDir, { recursive: true });

const browser = await launch(chromium);
const page = await browser.newPage(VIEW);
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));

await page.goto(BASE, { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 90000 });
await page.waitForTimeout(4000);
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

for (const s of SHOTS) {
  await page.evaluate((s) => {
    const m = window.__map;
    if (s.gfx && window.GFX) {
      if (typeof s.gfx === 'string' && window.GFX_PRESETS[s.gfx]) Object.assign(window.GFX, window.GFX_PRESETS[s.gfx]);
      else if (typeof s.gfx === 'object') Object.assign(window.GFX, s.gfx);
      window.applyGraphics();
    }
    if (s.center) m.jumpTo({ center: s.center, zoom: s.zoom ?? 16.5, pitch: s.pitch ?? 64, bearing: s.bearing ?? 90 });
    if (typeof s.p === 'number') {
      const sl = document.getElementById('tod-slider'); if (sl) sl.value = String(s.p);
      window.applyTimeOfDay(m, s.p, true);
    }
  }, s);
  await page.waitForTimeout(4500);
  await page.evaluate(() => window.__map.triggerRepaint());
  await page.waitForTimeout(1500);
  const file = path.join(outDir, `${OUT}-${s.name}-${MODE}${CLIP ? '-clip' : ''}.png`);
  await page.screenshot({ path: file, timeout: 120000 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: file, timeout: 120000 });
  console.log('WROTE', file);
}
if (errors.length) console.log('ERRORS', errors.slice(0, 8));
await browser.__done();
