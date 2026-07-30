/**
 * intro-timeline.mjs — screenshot the REAL index.html intro at intervals.
 *
 * Visual verification only — screenshots block the page ~250 ms each, so this
 * script makes NO timing claims. It exists to LOOK at the veil, the departure,
 * the canyon run, and the settle.
 *
 * Usage: node intro-timeline.mjs [outPrefix] [portrait|landscape] [urlSuffix]
 */
import { chromium } from 'playwright-core';
import { chromePath, BASE as SERVER } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2] || 'intro';
const MODE = process.argv[3] === 'landscape' ? 'landscape' : 'portrait';
const SUFFIX = process.argv[4] || '';
const VIEW = MODE === 'portrait'
  ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }
  : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };

const TIMES_S = [0.4, 1.5, 3, 4.5, 6, 7.5, 9, 10.5, 12, 14, 16.5];

const outDir = path.resolve('shots');
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: chromePath(),
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--ignore-gpu-blocklist', '--no-sandbox'],
});
const page = await browser.newPage(VIEW);
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

const t0 = Date.now();
await page.goto(SERVER + '/index.html' + SUFFIX, { timeout: 90000 });
// The auto-detect probe (11 s) would stomp the flight's easeTo mid-run. The
// production fix makes the probe defer while map.isEasing(); this script
// verifies the FLIGHT, so it cancels the probe outright (non-blocking).
page.waitForFunction(() => typeof window.cancelGraphicsAutoDetect === 'function', null, { timeout: 60000 })
  .then(() => page.evaluate(() => window.cancelGraphicsAutoDetect()))
  .catch(() => {});
for (const t of TIMES_S) {
  const wait = t * 1000 - (Date.now() - t0);
  if (wait > 0) await page.waitForTimeout(wait);
  const file = path.join(outDir, `${OUT}-${String(t).padStart(4, '0')}s-${MODE}.png`);
  await page.screenshot({ path: file, timeout: 120000 });
  console.log('WROTE', file);
}
const pose = await page.evaluate(() => {
  const m = window.__map;
  return m ? { c: m.getCenter(), z: +m.getZoom().toFixed(3), p: +m.getPitch().toFixed(1),
               b: +m.getBearing().toFixed(1), easing: m.isEasing() } : null;
});
console.log('FINAL POSE', JSON.stringify(pose));
if (errors.length) console.log('ERRORS', errors.slice(0, 8));
await browser.close();
