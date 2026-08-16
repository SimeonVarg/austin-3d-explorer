/**
 * drag-shot.mjs — shot.mjs, but with the URL query under my control.
 *
 * Exists for exactly one reason: the BEFORE half of a before/after pair. The
 * only honest "before" for this pass is `?drag=0`, which makes js/drag.js
 * return before it adds a layer OR touches `buildings-3d`'s filter — so the 24
 * replaced buildings are drawn by the generic path again, on the same build,
 * from the same camera, at the same hour. Hiding the drag layers instead would
 * leave those 24 filtered out and the "before" would be 24 holes in the city.
 *
 * Usage: node drag-shot.mjs <outPrefix> <shots.json> [extraQuery]
 *   node drag-shot.mjs before shots-drag.json 'drag=0'
 *   node drag-shot.mjs after  shots-drag.json
 */
/*
 * ONE MORE THING THIS DOES THAT shot.mjs DOES NOT: it survives losing the
 * browser. Six agents are running their own harnesses on this machine and a
 * fourteen-shot list reliably died partway through with "Target page, context
 * or browser has been closed" — with 28 Chrome processes up, that is memory
 * pressure, not a bug in the page. A long list that dies at shot 5 and leaves
 * shots 1-4 on disk is the worst outcome, because the ones that landed look
 * fine. So each shot is retried in a FRESH browser, and the run reports at the
 * end which poses it never got.
 */
import { chromium } from 'playwright-core';
import { chromePath, BASE as SERVER, launch } from './chrome.mjs';
import fs from 'node:fs';
import { requireShots } from './lib/args.mjs';
import path from 'node:path';

const OUT = process.argv[2] || 'drag';
const SHOTS = requireShots(process.argv[3], 'node drag-shot.mjs <outPrefix> <shots.json> [extraQuery]');
const EXTRA = process.argv[4] ? '&' + process.argv[4] : '';
const PER_SESSION = 4;   // shots before the browser is recycled
// ?intro=0 is not optional. The intro easeTo does not start for a couple of
// seconds, so a "wait until not easing" check passes BEFORE it begins, the
// script places the camera, and the intro immediately flies it away — every
// shot list's FIRST frame came back at the intro's end pose. ?drift=0 stops the
// idle cinematic stealing the camera back on a long list.
const URL = SERVER + '/_harness.html?intro=0&drift=0' + EXTRA;

const outDir = path.resolve('shots');
fs.mkdirSync(outDir, { recursive: true });

async function openSession() {
  const browser = await launch(chromium);
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const m = window.__map;
    if (!m || !m.getSource('austin-buildings')) return false;
    return ['austin-buildings', 'austin-ground', 'austin-trees']
      .every(s => !m.getSource(s) || m.isSourceLoaded(s));
  }, null, { timeout: 90000 }).catch(() => console.log('WARN: sources not all loaded'));
  await page.waitForTimeout(4000);
  // Fires 11 s after load and rewrites every graphics setting; left running it
  // lands mid-list and half the shots come back at a different quality preset.
  await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
  // The intro owns the camera for ~9 s and overwrites jumpTo on the next frame.
  await page.waitForFunction(() => {
    const m = window.__map;
    if (m.isEasing && m.isEasing()) return false;
    try { if (window.__fly.eye().driving) return false; } catch (e) {}
    return true;
  }, null, { timeout: 40000 }).catch(() => {});
  const hasDrag = await page.evaluate(() => !!window.__map.getLayer('drag-wall'));
  console.log('session up |', URL, '| drag-wall present:', hasDrag);
  return { browser, page, used: 0 };
}

async function shoot(page, s) {
  await page.evaluate((s) => {
    const m = window.__map;
    if (m.isEasing && m.isEasing()) m.stop();
    m.jumpTo({ center: s.center, zoom: s.zoom ?? 16.5, pitch: s.pitch ?? 64, bearing: s.bearing ?? 90 });
    if (typeof s.p === 'number') {
      const sl = document.getElementById('tod-slider'); if (sl) sl.value = String(s.p);
      window.applyTimeOfDay(m, s.p, true);
    }
  }, s);
  // Data-driven paint and a regenerated pattern atlas do not land in the same
  // frame as the call, and a GeoJSON source re-tiles in a worker after a camera
  // move. Settle, wait for idle, repaint, and trust the SECOND screenshot.
  await page.waitForTimeout(4000);
  await page.evaluate(() => new Promise(r => {
    const m = window.__map; if (m.loaded()) return r(); m.once('idle', r); setTimeout(r, 15000);
  }));
  await page.evaluate(() => window.__map.triggerRepaint());
  await page.waitForTimeout(1500);
  const file = path.join(outDir, `${OUT}-${s.name}.png`);
  await page.screenshot({ path: file });
  await page.waitForTimeout(600);
  await page.screenshot({ path: file });
  return file;
}

// Opened lazily and inside the try, so a session that fails to come up at all —
// which on a machine running six of these at once is most of the failures — is
// retried like any other, instead of taking the whole run down before shot 1.
let sess = null;
const failed = [];
for (const s of SHOTS) {
  let done = false;
  for (let attempt = 0; attempt < 3 && !done; attempt++) {
    if (sess && sess.used >= PER_SESSION) {
      await sess.browser.close().catch(() => {});
      sess = null;
    }
    try {
      if (!sess) sess = await openSession();
      const file = await shoot(sess.page, s);
      sess.used++;
      console.log('WROTE', file);
      done = true;
    } catch (e) {
      console.log('RETRY', s.name, '-', String(e.message).split(/\r?\n/)[0]);
      try { await sess.browser.__done(); } catch (e2) {}
      sess = null;
    }
  }
  if (!done) failed.push(s.name);
}
if (sess) await sess.browser.close().catch(() => {});
console.log(failed.length ? 'NEVER RENDERED: ' + failed.join(', ') : 'all poses rendered');
process.exit(failed.length ? 1 : 0);
