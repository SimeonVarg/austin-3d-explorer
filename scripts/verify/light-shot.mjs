/**
 * light-shot.mjs — shot.mjs, but honouring VERIFY_URL (shot.mjs hardcodes
 * port 8099, which with several worktrees live means screenshotting someone
 * else's build). Same shots-json format, same settle/repaint/double-shot
 * discipline. Added for the LIGHT workstream beauty pass, July 30 2026.
 *
 * Usage: node light-shot.mjs <outPrefix> [shotsJson]
 */
import { chromium } from 'playwright-core';
import { chromePath, BASE, launch } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';

const EXE = chromePath();
const OUT = process.argv[2] || 'shot';
const SHOTS = process.argv[3]
  ? JSON.parse(fs.readFileSync(process.argv[3], 'utf8'))
  : [{ name: 'day', p: 0.12 }];

const outDir = path.resolve('shots');
fs.mkdirSync(outDir, { recursive: true });

const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));

// intro=0: without it the intro easeTo is still flying during the first shots
// and a jumpTo pose gets overridden mid-settle (caught by an A/B pair whose
// two frames were at visibly different camera states).
await page.goto(`${BASE}/_harness.html?drift=0&intro=0`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
await page.waitForTimeout(4000);
// The graphics auto-detect probe rewrites every setting 11 s after load, which
// would silently change the look halfway through a shot list.
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

for (const s of SHOTS) {
  await page.evaluate(async (s) => {
    const m = window.__map;
    if (s.gfx && window.GFX) {
      if (typeof s.gfx === 'string' && window.GFX_PRESETS[s.gfx]) Object.assign(window.GFX, window.GFX_PRESETS[s.gfx]);
      else if (typeof s.gfx === 'object') Object.assign(window.GFX, s.gfx);
      window.applyGraphics();
    }
    // `tune` patches window.FX_TUNE (rays/ghost taste values) for A/B shots.
    if (s.tune && window.FX_TUNE) {
      for (const [grp, vals] of Object.entries(s.tune))
        if (window.FX_TUNE[grp]) Object.assign(window.FX_TUNE[grp], vals);
    }
    if (s.center) m.jumpTo({ center: s.center, zoom: s.zoom ?? 16.5, pitch: s.pitch ?? 64, bearing: s.bearing ?? 90 });
    if (typeof s.p === 'number') {
      const sl = document.getElementById('tod-slider'); if (sl) sl.value = String(s.p);
      window.applyTimeOfDay(m, s.p, true);
    }
  }, s);
  // Data-driven paint and the facade atlas don't land in the same frame.
  // Settle, wait for genuine idle (the FIRST shot after load once rendered
  // with the near-field building tiles simply absent), repaint, shoot twice,
  // keep the second.
  await page.waitForTimeout(4000);
  await page.evaluate(() => new Promise(res => {
    const m = window.__map;
    let done = false;
    const onIdle = () => { if (!done) { done = true; m.off('idle', onIdle); res(); } };
    m.on('idle', onIdle);
    m.triggerRepaint();
    setTimeout(onIdle, 8000);
  }));
  await page.evaluate(() => window.__map.triggerRepaint());
  await page.waitForTimeout(1500);
  const file = path.join(outDir, `${OUT}-${s.name}.png`);
  await page.screenshot({ path: file });
  await page.waitForTimeout(600);
  await page.screenshot({ path: file });
  console.log('WROTE', file);
}
if (errors.length) console.log('ERRORS', errors.slice(0, 12));
await browser.__done();
