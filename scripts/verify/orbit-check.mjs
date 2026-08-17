/**
 * orbit-check.mjs — tap-a-landmark orbit, against the REAL page.
 *
 * Finds the Skyloft sign on screen (map.project of its known coordinates),
 * taps it, and asserts the camera glides to the landmark and circles it;
 * then asserts a wheel input ends the orbit immediately.
 */
import { chromium } from 'playwright-core';
import { chromePath, BASE as SERVER, launch } from './chrome.mjs';
import path from 'node:path';

const SKYLOFT = [-97.74356, 30.28615];

const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: 1000, height: 750 }, deviceScaleFactor: 1 });
let pass = 0, fail = 0;
const check = (ok, name, detail) => {
  console.log(`${ok ? ' PASS ' : '*FAIL '} ${name}${detail ? `\n         ${detail}` : ''}`);
  ok ? pass++ : fail++;
};

await page.goto(SERVER + '/index.html?intro=0&drift=0', { timeout: 90000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 90000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
await page.waitForTimeout(4000);

// A tap can only hit a RENDERED label (you tap a sign you can see), and glyph
// loading is timing-dependent under load — wait until the Skyloft label is
// actually on screen before tapping, like a human would.
await page.waitForFunction(() =>
  window.__map.queryRenderedFeatures({ layers: ['signs-label'] })
    .some(f => f.properties && f.properties.label === 'Skyloft'),
  null, { timeout: 60000 });

// Screen position of the sign's anchor at the spawn pose.
const pt = await page.evaluate((c) => {
  const q = window.__map.project(c);
  return { x: q.x, y: q.y };
}, SKYLOFT);
const inView = pt.x > 10 && pt.x < 990 && pt.y > 10 && pt.y < 740;
check(inView, 'Skyloft sign label is rendered and on screen at spawn', `(${pt.x.toFixed(0)}, ${pt.y.toFixed(0)})`);
if (!inView) { console.log('\ncannot tap off-screen; aborting'); await browser.__done(); process.exit(1); }

await page.mouse.click(pt.x, pt.y);
await page.waitForTimeout(3200);   // approach should have finished
const a = await page.evaluate(() => ({
  c: window.__map.getCenter(), b: window.__map.getBearing(), easing: window.__map.isEasing(),
}));
const distM = Math.hypot((a.c.lng - SKYLOFT[0]) * 96000, (a.c.lat - SKYLOFT[1]) * 111195);
check(distM < 25, 'tap glides the camera to the landmark', `centre ${distM.toFixed(1)} m from the sign`);

// THE ORBIT IS A CHAIN OF LEGS, SO `isEasing()` HAS SEAMS — DO NOT SAMPLE IT ONCE.
//
// `js/app.js`'s landmark orbit is a chain of 9000 ms, 40-degree `easeTo` legs
// re-armed by `setTimeout(leg, ORBIT.legMs + 50)`. Between legs there is a
// ~50 ms window in which `map.isEasing()` is legitimately false. The old
// assertion read that boolean at ONE instant, timed by wall-clock
// `waitForTimeout`s that take no account of how long the intervening
// `page.evaluate` round-trips take on a busy main thread — and when it failed
// it reported "bearing moved 39.5deg", which is one leg EXACTLY, i.e. the
// sample landed on the seam.
//
// §158 armed an in-page sampler before the tap so no CDP latency could move the
// sample time, and watched 110 degrees of continuous orbit over 30 s with
// **29 of 29 samples easing** and no stall anywhere. So the app is right and the
// instantaneous boolean was the ruler.
//
// The subject is "does the camera keep going round", and the honest form of it
// is that the bearing KEEPS ADVANCING — sampled repeatedly, in the page.
const orbit = await page.evaluate(async () => {
  const m = window.__map;
  const marks = [];
  const t0 = performance.now();
  for (let i = 0; i < 12; i++) {
    marks.push({ t: Math.round(performance.now() - t0), b: m.getBearing(), e: m.isEasing() });
    await new Promise(r => setTimeout(r, 500));
  }
  marks.push({ t: Math.round(performance.now() - t0), b: m.getBearing(), e: m.isEasing() });
  return marks;
});
// Unwrap across the +-180 seam so a legitimate wrap is not read as a 350 deg jump.
let travelled = 0;
for (let i = 1; i < orbit.length; i++) {
  let d = orbit[i].b - orbit[i - 1].b;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  travelled += Math.abs(d);
}
const easingShare = orbit.filter(s => s.e).length / orbit.length;
const b = orbit[orbit.length - 1];
check(travelled > 8 && easingShare >= 0.75, 'the camera circles the landmark',
  `bearing travelled ${travelled.toFixed(1)}deg over ${b.t} ms across ${orbit.length} in-page samples; ` +
  `easing on ${(easingShare * 100).toFixed(0)}% of them ` +
  `(the leg chain has a ~50 ms seam every 9 s, so a single sample of isEasing() is a coin flip — §158)`);
await page.screenshot({ path: path.resolve('shots/orbit-mid.png'), timeout: 120000 });

await page.mouse.move(500, 380);
await page.mouse.wheel(0, -100);
await page.waitForTimeout(1500);
const c1 = await page.evaluate(() => ({ b: window.__map.getBearing(), easing: window.__map.isEasing() }));
await page.waitForTimeout(4000);
const c2 = await page.evaluate(() => ({ b: window.__map.getBearing(), easing: window.__map.isEasing() }));
check(!c2.easing && Math.abs(c2.b - c1.b) < 0.5, 'input ends the orbit immediately',
  `easing ${c1.easing}->${c2.easing}, bearing ${c1.b.toFixed(1)}->${c2.b.toFixed(1)}`);

console.log(`\n${pass}/${pass + fail} passed`);
await browser.__done();
process.exit(fail ? 1 : 0);
