/**
 * shot-fade-ab.mjs — one-off: before/after screenshots of GROUND.pitchFade,
 * on and off, at street-drag and eyelevel-lookout. Not part of the suite.
 */
import { chromium } from 'playwright-core';
import { BASE as SERVER, launch } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';

const outDir = path.resolve('shots/shimmer/ground/zoomfade');
fs.mkdirSync(outDir, { recursive: true });

const POSES = [
  { name: 'street-drag', center: [-97.7417, 30.288598], zoom: 19.017, pitch: 76, bearing: 180, p: 0.5 },
  { name: 'eyelevel-lookout', center: [-97.7417, 30.288598], zoom: 20.6, pitch: 78, bearing: 180, p: 0.5 },
  { name: 'eyelevel-drag', center: [-97.7417, 30.288598], zoom: 20.6, pitch: 55, bearing: 180, p: 0.5 },
];

const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.goto(SERVER + '/_harness.html?intro=0&drift=0', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
await page.waitForTimeout(5000);
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

for (const s of POSES) {
  for (const fadeOn of [true, false]) {
    await page.evaluate(({ s, fadeOn }) => {
      const m = window.__map;
      window.GROUND.pitchFade = fadeOn;
      window.applyGroundPitchFade && window.applyGroundPitchFade(true);
      window.applyTimeOfDay && window.applyTimeOfDay(m, s.p, true);
      m.jumpTo({ center: s.center, zoom: s.zoom, pitch: s.pitch, bearing: s.bearing });
    }, { s, fadeOn });
    await page.waitForTimeout(3500);
    await page.evaluate(() => window.__map.triggerRepaint());
    await page.waitForTimeout(600);
    const out = path.join(outDir, `${s.name}-fade${fadeOn ? 'ON' : 'OFF'}.png`);
    await page.screenshot({ path: out });
    console.log(s.name, 'fade=' + fadeOn, '->', out);
  }
}
await browser.close();
console.log('DONE');
