/**
 * tour-check.mjs — the Forty Acres tour, against the REAL page.
 *
 * Starts the tour, screenshots each leg's midpoint (visual check: the Tower
 * must actually be in frame on the South Mall leg), asserts the final pose is
 * home, then asserts input cancels a fresh tour immediately.
 */
import { chromium } from 'playwright-core';
import { chromePath, BASE as SERVER } from './chrome.mjs';
import path from 'node:path';

const browser = await chromium.launch({
  executablePath: chromePath(),
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--ignore-gpu-blocklist', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 750 }, deviceScaleFactor: 1 });
let pass = 0, fail = 0;
const check = (ok, name, detail) => {
  console.log(`${ok ? ' PASS ' : '*FAIL '} ${name}${detail ? `\n         ${detail}` : ''}`);
  ok ? pass++ : fail++;
};

await page.goto(SERVER + '/index.html?intro=0&drift=0', { timeout: 90000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 90000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
await page.waitForTimeout(5000);

const t0 = Date.now();
await page.evaluate(() => window.__startTour());
// Dwell beats are sampled at their END (the held postcard), transit legs mid-way.
const MIDS = [['drag', 4000], ['southmall', 15300], ['dwell-tower', 19400], ['tower', 24000],
              ['dkr', 32000], ['dwell-dkr', 35900], ['home', 45000]];
for (const [name, at] of MIDS) {
  const wait = at - (Date.now() - t0);
  if (wait > 0) await page.waitForTimeout(wait);
  await page.screenshot({ path: path.resolve(`shots/tour-${name}.png`), timeout: 120000 });
  const pose = await page.evaluate(() => ({
    c: window.__map.getCenter(), b: +window.__map.getBearing().toFixed(1),
    z: +window.__map.getZoom().toFixed(2), p: +window.__map.getPitch().toFixed(1),
    easing: window.__map.isEasing(),
  }));
  console.log(`  ${name}: ${JSON.stringify(pose)}`);
}
await page.waitForTimeout(Math.max(0, 53000 - (Date.now() - t0)));
const end = await page.evaluate(() => ({
  c: window.__map.getCenter(), b: window.__map.getBearing(), easing: window.__map.isEasing(),
}));
const homeM = Math.hypot((end.c.lng - -97.7434) * 96000, (end.c.lat - 30.2857) * 111195);
check(homeM < 20 && !end.easing, 'tour ends back home at the sunset pose',
  `centre ${homeM.toFixed(1)} m from spawn, bearing ${end.b.toFixed(1)}, easing ${end.easing}`);

// Cancel test: fresh tour, then a wheel input 3 s in.
await page.evaluate(() => window.__startTour());
await page.waitForTimeout(3000);
await page.mouse.move(500, 380);
await page.mouse.wheel(0, -100);
await page.waitForTimeout(1500);
const c1 = await page.evaluate(() => ({ b: window.__map.getBearing(), easing: window.__map.isEasing() }));
await page.waitForTimeout(5000);
const c2 = await page.evaluate(() => ({ b: window.__map.getBearing(), easing: window.__map.isEasing() }));
check(!c2.easing && Math.abs(c2.b - c1.b) < 0.5, 'input ends the tour where it is',
  `easing ${c1.easing}->${c2.easing}, bearing ${c1.b.toFixed(1)}->${c2.b.toFixed(1)}`);

console.log(`\n${pass}/${pass + fail} passed`);
await browser.close();
process.exit(fail ? 1 : 0);
