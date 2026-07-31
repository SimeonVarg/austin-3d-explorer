/**
 * arts-shots.mjs — before/after screenshots at identical poses.
 *
 * shot.mjs cannot do this: it hard-codes its query string, and the whole point
 * of `?arts=0` is that BEFORE and AFTER are the same build, the same data on
 * disk and the same camera — not two checkouts, where any difference could be
 * anything. Same reason js/outer.js carries `?outer=0`.
 *
 * Usage:  node arts-shots.mjs <prefix> <on|off> [shots.json]
 */
import { chromium } from 'playwright-core';
import { chromePath, GL_ARGS, BASE, launch } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2] || 'arts';
const ON = (process.argv[3] || 'on') !== 'off';
const SHOTS = JSON.parse(fs.readFileSync(process.argv[4] || 'shots-arts.json', 'utf8'));

const outDir = path.resolve('shots');
fs.mkdirSync(outDir, { recursive: true });

const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));

// ?intro=0 matters more than it looks: the intro flyTo does not START for a
// couple of seconds, so a "wait until not easing" check passes before it has
// begun and the first pose in every list comes back at the intro's end pose.
await page.goto(BASE + '/_harness.html?intro=0&drift=0' + (ON ? '' : '&arts=0'),
                { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 90000 });
if (ON) {
  await page.waitForFunction(() => window.__map.getLayer('arts-solid'), null, { timeout: 120000 });
} else {
  await page.waitForTimeout(12000);
  const leaked = await page.evaluate(() => !!window.__map.getLayer('arts-solid'));
  if (leaked) console.log('WARNING: ?arts=0 did not switch the pass off — the BEFORE is not a before');
}
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
await page.waitForTimeout(4000);

for (const s of SHOTS) {
  await page.evaluate((s) => {
    const m = window.__map;
    if (m.isEasing && m.isEasing()) m.stop();
    m.jumpTo({ center: s.center, zoom: s.zoom ?? 16.5, pitch: s.pitch ?? 64, bearing: s.bearing ?? 90 });
    if (typeof s.p === 'number') window.applyTimeOfDay(m, s.p, true);
  }, s);
  await page.waitForTimeout(3500);
  // `map.loaded()` alone is not enough after a jump of several hundred metres:
  // it returned true while `austin-ground` and `austin-arts` were still tiling,
  // and one LBJ frame came back with no roads and the building's roof deck
  // hanging in the air with no walls under it — which reads exactly like a
  // broken layer rather than a half-loaded one. Wait for the SOURCES.
  await page.waitForFunction(() => {
    const m = window.__map;
    return ['austin-buildings', 'austin-ground', 'austin-arts', 'austin-roofs', 'austin-trees']
      .every(s => !m.getSource(s) || m.isSourceLoaded(s));
  }, null, { timeout: 40000 }).catch(() => console.log('  (sources not all loaded)'));
  await page.evaluate(() => new Promise(r => {
    const m = window.__map; if (m.loaded()) return r(); m.once('idle', r); setTimeout(r, 15000);
  }));
  await page.evaluate(() => window.__map.triggerRepaint());
  await page.waitForTimeout(2200);
  const file = path.join(outDir, `${OUT}-${s.name}.png`);
  // Twice: data-driven paint and a regenerated atlas do not land in the same
  // frame as the call, so the first shot can still show the previous state.
  await page.screenshot({ path: file });
  await page.waitForTimeout(700);
  await page.screenshot({ path: file });
  console.log('WROTE', path.basename(file));
}
if (errors.length) console.log('ERRORS', errors.slice(0, 6));
await browser.__done();
