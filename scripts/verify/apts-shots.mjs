/**
 * apts-shots.mjs — the cited before/after frames for docs/apartments-pass.md.
 *   VERIFY_URL=<base> OUT=<dir> TAG=<after|before> node apts-shots.mjs apts-poses.json [extraQuery]
 * One headless Chrome, hardware GL, graphics auto-detect cancelled, shot twice,
 * second kept — scripts/verify/README.md's rule.
 */
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';

const POSES = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const EXTRA = process.argv[3] || '';
const OUT = process.env.OUT, TAG = process.env.TAG || 'shot';
fs.mkdirSync(OUT, { recursive: true });
const W = 1440, H = 900;

const browser = await launch(chromium, { gl: 'hardware', maxMs: 1800000 });
const pg = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const errs = [];
pg.on('pageerror', e => errs.push(e.message));
await pg.goto(`${BASE}/index.html?intro=0&drift=0${EXTRA}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await pg.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 240000 });
await pg.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
await pg.evaluate(() => { if (window.GFX) window.GFX.autoExposure = false; });
await pg.waitForTimeout(20000);          // let every source and the generators land

for (const p of POSES) {
  await pg.evaluate(o => window.__map.jumpTo(o), { center: p.center, zoom: p.zoom, pitch: p.pitch, bearing: p.bearing });
  if (p.tod != null) await pg.evaluate(t => window.applyTimeOfDay(window.__map, t, true), p.tod);
  await pg.waitForTimeout(9000);
  await pg.evaluate(() => new Promise(r => { const m = window.__map; const t = setTimeout(r, 9000); m.once('idle', () => { clearTimeout(t); r(); }); }));
  await pg.screenshot({ path: `${OUT}/${p.name}-${TAG}.png` });
  await pg.waitForTimeout(1200);
  await pg.screenshot({ path: `${OUT}/${p.name}-${TAG}.png` });    // twice, trust the second
  console.log('shot', p.name, TAG);
}
if (errs.length) console.log('PAGE ERRORS:', errs.slice(0, 5).join(' | '));
browser.__done();
