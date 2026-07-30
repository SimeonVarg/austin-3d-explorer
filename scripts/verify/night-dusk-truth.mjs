/**
 * night-dusk-truth.mjs — steady-state ground truth for one time-of-day value.
 *
 * Usage: node night-dusk-truth.mjs <p> <outname>
 *
 * Fresh page -> applyTimeOfDay(p, force) -> 20 s of settling with repeated
 * repaints -> screenshot + atlas byte sample. Exists because the 4 s settle in
 * shot.mjs turned out to be a RACE for facade-pattern propagation: the same
 * pose screenshotted dark in one run and day-tan in another depending on which
 * atlas generation the tiles were still holding.
 */
import { chromium } from 'playwright-core';
import { chromePath, GL_ARGS, BASE } from './chrome.mjs';
import path from 'node:path';

const P = parseFloat(process.argv[2] ?? '0.66');
const NAME = process.argv[3] || `truth-${P}`;

const browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: GL_ARGS });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto(`${BASE}/_harness.html?intro=0`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
await page.waitForTimeout(3000);
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

await page.evaluate((P) => {
  const m = window.__map;
  m.jumpTo({ center: [-97.7434, 30.2857], zoom: 16.5, pitch: 64, bearing: 90 });
  window.applyTimeOfDay(m, P, true);
}, P);

for (let i = 0; i < 10; i++) {
  await page.waitForTimeout(2000);
  await page.evaluate(() => window.__map.triggerRepaint());
}
const diag = await page.evaluate(() => {
  const m = window.__map;
  const im = m.style && m.style.imageManager ? m.style.imageManager.getImage('md00') : null;
  const d = im && im.data && im.data.data;
  const px = (x, y) => { const i = (y * 64 + x) * 4; return [d[i], d[i+1], d[i+2]]; };
  return { atlasMd00Wall: d ? px(1, 1) : null };
});
console.log('atlas md00 wall pixel:', JSON.stringify(diag.atlasMd00Wall));
const file = path.resolve('shots', `${NAME}.png`);
await page.screenshot({ path: file });
console.log('WROTE', file);
await browser.close();
