/**
 * tour.mjs — fly the city and photograph it, so somebody can just LOOK.
 *
 * WHY. Simeon, 2026-08-01: "i just wanna see whats wrong with the site yk - im a
 * manager who gives feedback not micromanages." Every other script in here
 * answers a question you already knew to ask — is this pixel the right hex, did
 * that roof move. None of them find a defect nobody has noticed yet, because
 * none of them show you the city.
 *
 * So this is deliberately dumb: a fixed set of poses over the landmarks and the
 * places past passes have gone wrong, day and night, two frames each, written to
 * shots/tour/ with names you can read. No assertions. The eye is the assertion.
 *
 * ONE BROWSER, MANY POSES, and that is the whole performance argument. Loading
 * the city costs 10-17 s and every script in this suite pays it separately;
 * fifteen poses in one session pay it once. This is the shape the rest of the
 * suite should eventually take.
 *
 * SCREENSHOT TWICE, KEEP THE SECOND. scripts/verify/README.md records why: the
 * first capture after a camera move regularly catches a half-drawn frame, and a
 * half-drawn frame read as a defect has cost this project hours.
 *
 * Usage:
 *   VERIFY_URL=http://127.0.0.1:8123 node scripts/verify/tour.mjs
 *   VERIFY_URL=... node scripts/verify/tour.mjs night
 */
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';
import fs from 'node:fs';

const OUT = 'shots/tour';
fs.mkdirSync(OUT, { recursive: true });

const only = process.argv[2];              // 'day' | 'night' | undefined = both

// Landmarks first, then the places this project has drawn wrong before. The
// second group is not padding — a defect that was fixed once is the likeliest
// place for the next one.
const POSES = [
  ['tower-south-mall',  { center: [-97.7395, 30.2845], zoom: 16.6, pitch: 68, bearing: 8 }],
  ['tower-close',       { center: [-97.7392, 30.2860], zoom: 17.4, pitch: 72, bearing: 20 }],
  ['dkr-stadium',       { center: [-97.7325, 30.2835], zoom: 16.2, pitch: 62, bearing: 300 }],
  ['dkr-field',         { center: [-97.7325, 30.2835], zoom: 17.0, pitch: 45, bearing: 340 }],
  ['downtown-skyline',  { center: [-97.7420, 30.2760], zoom: 15.2, pitch: 74, bearing: 200 }],
  ['capitol',           { center: [-97.7404, 30.2747], zoom: 16.4, pitch: 62, bearing: 20 }],
  ['west-campus',       { center: [-97.7455, 30.2880], zoom: 16.0, pitch: 66, bearing: 120 }],
  ['the-drag',          { center: [-97.7418, 30.2865], zoom: 17.2, pitch: 70, bearing: 0 }],
  ['moody-arena',       { center: [-97.7325, 30.2795], zoom: 16.6, pitch: 60, bearing: 45 }],
  // THE OLD POSE DID NOT CONTAIN THE CREEK. It sat at -97.7330 looking south
  // with the channel 130 m off to the west, so the one tour frame named after
  // the corridor photographed San Jacinto instead — and HANDOFF §35 records
  // the cost: a pass whose result no tour frame contains is a pass nobody will
  // notice regressing. This centres ON the water at the Alumni Center reach and
  // looks north up the channel, so Patton Hall, the Etter-Harbin Alumni Center
  // and the two named stretches are all in one frame.
  ['waller-creek',      { center: [-97.7344, 30.2845], zoom: 17.2, pitch: 62, bearing: 8 }],
  ['blanton-arts',      { center: [-97.7375, 30.2805], zoom: 16.8, pitch: 66, bearing: 340 }],
  ['aerial-wide',       { center: [-97.7390, 30.2840], zoom: 14.4, pitch: 55, bearing: 20 }],
];

// The time-of-day slider is 0..1. These are the two a visitor is most likely to
// land on, plus dusk, which is where colour bugs hide — a palette that works at
// noon and at midnight can still be wrong in between.
const TIMES = { day: 0.30, dusk: 0.62, night: 0.95 };

const browser = await launch(chromium, { gl: 'hardware' });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('pageerror', e => console.log('  [pageerror] ' + e.message));

await page.goto(BASE + '/index.html?intro=0&drift=0', { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
await page.evaluate(() => new Promise(r => {
  const m = window.__map;
  if (m.loaded()) return r();
  m.once('idle', r); setTimeout(r, 60000);
}));
console.log('loaded\n');

const times = only ? { [only]: TIMES[only] } : TIMES;

for (const [tname, p] of Object.entries(times)) {
  // Drive the SLIDER, not applyTimeOfDay directly. js/timeofday.js line 470:
  // "ALWAYS retint through window.applyTimeOfDay, never the local one" —
  // several passes WRAP it at boot to retint their own bands and atlases, and
  // the slider path is the one the app itself uses, so it picks up every
  // wrapper. Calling the function by hand can leave a pass un-retinted and
  // photograph a bug that only this script has.
  const applied = await page.evaluate(v => {
    const el = document.getElementById('tod-slider');
    if (el) {
      el.value = String(v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return 'slider';
    }
    if (typeof window.applyTimeOfDay === 'function') {
      window.applyTimeOfDay(window.__map, v, true);
      return 'applyTimeOfDay (fallback)';
    }
    return null;
  }, p);
  if (!applied) {
    console.log(`  WARNING: could not set time of day; "${tname}" shots are whatever was on screen`);
  }
  // The retint is animated. retint.mjs asserts it completes inside 2500 ms, so
  // this waits past that rather than guessing.
  await page.waitForTimeout(3200);

  for (const [name, pose] of POSES) {
    await page.evaluate(q => window.__map.jumpTo(q), pose);
    await page.evaluate(() => new Promise(r => {
      const m = window.__map;
      if (m.loaded() && m.areTilesLoaded()) return r();
      m.once('idle', r); setTimeout(r, 20000);
    }));
    await page.waitForTimeout(900);
    const file = `${OUT}/${tname}-${name}.png`;
    await page.screenshot({ path: file.replace('.png', '.tmp.png') });
    await page.waitForTimeout(700);
    await page.screenshot({ path: file });
    fs.unlinkSync(file.replace('.png', '.tmp.png'));
    console.log('  ' + file);
  }
}

console.log('\n' + Object.keys(times).length * POSES.length + ' frames in ' + OUT);
await browser.__done();
