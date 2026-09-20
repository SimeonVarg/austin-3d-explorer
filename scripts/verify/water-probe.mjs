/**
 * water-probe.mjs — load the harness, jump to a pose, run a page snippet, print
 * its JSON result (exploration aid for docs/water-flicker.md).
 *
 *   node water-probe.mjs <snippet.js> [--pose=lng,lat,zoom,pitch,bearing,p] [--q=...] [--shot=file.jpg]
 *
 * The snippet is the BODY of an async function (m) => { ... return value; }.
 */
import { chromium } from 'playwright-core';
import { BASE as SERVER, launch } from './chrome.mjs';
import fs from 'node:fs';

const SNIP = fs.readFileSync(process.argv[2], 'utf8');
const arg = k => (process.argv.find(a => a.startsWith('--' + k + '=')) || '').slice(k.length + 3);
const Q = arg('q'), POSE = arg('pose'), SHOT = arg('shot');

const browser = await launch(chromium, { gl: process.env.VERIFY_GL || 'hardware', maxMs: 20 * 60 * 1000 });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('PAGEERR', e.message));
await page.goto(SERVER + '/_harness.html?intro=0&drift=0' + (Q ? '&' + Q : ''), { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
await page.waitForFunction(() => { const v = document.getElementById('veil'); return !v || getComputedStyle(v).opacity === '0'; }, null, { timeout: 180000 }).catch(() => {});
await page.waitForTimeout(3000);
if (POSE) {
  const [lng, lat, zoom, pitch, bearing, p] = POSE.split(',').map(Number);
  await page.evaluate(({ lng, lat, zoom, pitch, bearing, p }) => {
    const m = window.__map; m.jumpTo({ center: [lng, lat], zoom, pitch, bearing });
    if (isFinite(p)) window.applyTimeOfDay(m, p, true);
  }, { lng, lat, zoom, pitch, bearing, p });
  await page.waitForTimeout(3000);
  await page.evaluate(() => new Promise(r => { const m = window.__map; if (m.loaded()) return r(); m.once('idle', r); setTimeout(r, 15000); }));
}
const out = await page.evaluate(async (src) => {
  const m = window.__map;
  const fn = (0, eval)('(async function(m){' + src + '})');
  return await fn(m);
}, SNIP);
console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 1));
if (SHOT) {
  await page.evaluate(() => new Promise(r => { const m = window.__map; m.once('render', () => setTimeout(r, 50)); m.triggerRepaint(); }));
  const u = await page.evaluate(() => window.__map.getCanvas().toDataURL('image/jpeg', 0.85));
  fs.writeFileSync(SHOT, Buffer.from(u.split(',')[1], 'base64'));
}
browser.__done();
