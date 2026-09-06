/**
 * _aptsweep.mjs — one oblique per authored building, for the floating-detail sweep.
 *   OUT=<dir> TAG=<before|after> POSEFILE=<json> node _aptsweep.mjs [extraQuery]
 */
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { launch } from './chrome.mjs';
const BASE = process.env.VERIFY_URL || 'http://127.0.0.1:8137';
const OUT = process.env.OUT, TAG = process.env.TAG || 'shot';
const POSES = JSON.parse(fs.readFileSync(process.env.POSEFILE, 'utf8'));
const EXTRA = process.argv[2] || '';
fs.mkdirSync(OUT, { recursive: true });
const browser = await launch(chromium, { gl: 'hardware', maxMs: 2400000 });
const pg = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.goto(`${BASE}/index.html?intro=0&drift=0${EXTRA}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await pg.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 240000 });
await pg.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
await pg.evaluate(() => { if (window.GFX) window.GFX.autoExposure = false; });
await pg.waitForTimeout(25000);
await pg.evaluate(() => window.applyTimeOfDay(window.__map, 0.30, true));
console.log('hidden:', JSON.stringify(await pg.evaluate(() => window.slopesApartments && window.slopesApartments.hidden)));
for (const p of POSES) {
  await pg.evaluate(o => window.__map.jumpTo(o), { center: p.center, zoom: p.zoom, pitch: p.pitch, bearing: p.bearing });
  await pg.waitForTimeout(5500);
  await pg.evaluate(() => new Promise(r => { const m = window.__map; const t = setTimeout(r, 9000); m.once('idle', () => { clearTimeout(t); r(); }); }));
  await pg.screenshot({ path: `${OUT}/${p.name}-${TAG}.png` });
  await pg.waitForTimeout(900);
  await pg.screenshot({ path: `${OUT}/${p.name}-${TAG}.png` });
  console.log('shot', p.name);
}
if (errs.length) console.log('PAGE ERRORS:', errs.slice(0, 6).join(' | '));
browser.__done();
