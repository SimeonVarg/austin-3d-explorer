/**
 * ladder.mjs — WHERE does the downtown tearing show, and where does it not?
 *
 * smear3 proved the band is a property of the POSE, not of load time. The only
 * thing that matters on a shoot day is therefore: which framings carry it. This
 * walks a settled page through the poses he will actually record from and a
 * ladder around the offending one, and shoots each.
 */
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';
import fs from 'node:fs'; import path from 'node:path';
const OUT = path.resolve(process.argv[2] || 'shots/smear');
fs.mkdirSync(OUT, { recursive: true });

const POSES = [
  // the offending one, as the control
  { n: 'X-offender',   center: [-97.742, 30.268],   zoom: 16.2,  pitch: 78, bearing: 5 },
  // the pose the plain flight lands on (go-nogo: zoom 16.9, bearing 2, pitch 72)
  { n: 'X-flight-end', center: [-97.7395, 30.2820], zoom: 16.9,  pitch: 72, bearing: 2 },
  // R home — the postcard
  { n: 'R-home',       center: [-97.7434, 30.2857], zoom: 16.5,  pitch: 74, bearing: -110 },
  // ladder around the offender: same place, changed one axis at a time
  { n: 'L-pitch60',    center: [-97.742, 30.268],   zoom: 16.2,  pitch: 60, bearing: 5 },
  { n: 'L-pitch70',    center: [-97.742, 30.268],   zoom: 16.2,  pitch: 70, bearing: 5 },
  { n: 'L-zoom15.6',   center: [-97.742, 30.268],   zoom: 15.6,  pitch: 78, bearing: 5 },
  { n: 'L-zoom16.9',   center: [-97.742, 30.268],   zoom: 16.9,  pitch: 78, bearing: 5 },
  { n: 'L-bear-60',    center: [-97.742, 30.268],   zoom: 16.2,  pitch: 78, bearing: -60 },
  { n: 'L-bear180',    center: [-97.742, 30.268],   zoom: 16.2,  pitch: 78, bearing: 180 },
];

const browser = await launch(chromium, { headless: false });
const page = await (await browser.newContext({ viewport: { width: 1920, height: 965 }, deviceScaleFactor: 1 })).newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto(BASE + '/?intro=0&drift=0', { timeout: 180000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 180000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
await page.waitForTimeout(25000);
await page.waitForFunction(() => !(window.__fly && window.__fly.eye && window.__fly.eye().driving), null, { timeout: 30000 }).catch(() => {});

for (const P of POSES) {
  await page.evaluate(P => { const m = window.__map; m.stop(); m.jumpTo({ center: P.center, zoom: P.zoom, pitch: P.pitch, bearing: P.bearing }); }, P);
  await page.waitForTimeout(3500);
  await page.evaluate(() => new Promise(r => { const m = window.__map; if (m.loaded()) return r(); m.once('idle', r); setTimeout(r, 15000); }));
  await page.evaluate(() => window.__map.triggerRepaint());
  await page.waitForTimeout(900);
  const f = path.join(OUT, `L-${P.n}.jpg`);
  await page.screenshot({ path: f, type: 'jpeg', quality: 92 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: f, type: 'jpeg', quality: 92 });
  console.log('WROTE', P.n);
}
console.log('errors:', errs.length ? errs : 'none');
await browser.__done();
