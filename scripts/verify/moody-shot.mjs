/**
 * moody-shot.mjs — matched before/after frames for this pass, in ONE session.
 *
 * WHY NOT shot.mjs. Two reasons, both learned by getting it wrong here first.
 *
 * 1. THE FIRST SHOT IN A LIST IS NOT TRUSTWORTHY. shot.mjs already documents
 *    this and works around the intro flight, but a `before` run and an `after`
 *    run of the same list still came back with visibly different framing on shot
 *    one — close and low in one, wide and high in the other — which reads as "the
 *    building changed size" rather than "the camera had not settled". A
 *    throwaway warm-up pose at the head of the list removes it. Nothing is
 *    asserted from the warm-up and its file is overwritten by the next shot.
 *
 * 2. A BEFORE/AFTER PAIR MUST COME FROM ONE BUILD. Reverting the branch to
 *    screenshot `before` compares two checkouts, so any unrelated drift between
 *    them lands in the diff and gets attributed to this pass. js/moody.js takes
 *    ?moody=0, so both halves of the pair are the same bytes, the same browser
 *    session and the same tile cache, differing only in whether this pass drew.
 *
 * Usage: node moody-shot.mjs [shots.json]
 *   writes shots/moody-before-<name>.png and shots/moody-after-<name>.png
 */
import { chromium } from 'playwright-core';
import { chromePath, BASE as SERVER, launch } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';

const SHOTS = JSON.parse(fs.readFileSync(process.argv[2] || 'moody-shots.json', 'utf8'));
const outDir = path.resolve('shots');
fs.mkdirSync(outDir, { recursive: true });

// Deliberately somewhere else on campus, so the warm-up cannot be mistaken for
// one of the real frames if it ever does get written.
const WARMUP = { name: '00-warmup', p: 0.25, gfx: 'cinematic',
                 center: [-97.7434, 30.2857], zoom: 16.5, pitch: 74, bearing: 250 };

// ONE BROWSER PER PASS, not one for both. A single session driving thirty
// 1440x900 frames through swiftshader with preserveDrawingBuffer on died at
// shot four with "Target page, context or browser has been closed" — and
// because the failure came from page.evaluate it looked like a scene bug, not a
// renderer running out of room. Relaunching between the two halves also
// guarantees the `after` run cannot inherit any state the `before` run left.
async function runPass(label, extraQuery) {
  const browser = await launch(chromium);
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));

  // ?intro=0 matters more than it looks: the intro easeTo does not START until a
  // couple of seconds in, so a "wait until not easing" check passes BEFORE it has
  // begun and the scripted camera is then flown away on the next frame.
  await page.goto(SERVER + '/_harness.html?intro=0&drift=0' + extraQuery,
                  { waitUntil: "networkidle", timeout: 180000 });
  await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 180000 });
  await page.waitForFunction(() => {
    const m = window.__map;
    if (!m || !m.getSource('austin-buildings')) return false;
    return ['austin-buildings', 'austin-ground', 'austin-trees']
      .every(s => !m.getSource(s) || m.isSourceLoaded(s));
  }, null, { timeout: 120000 }).catch(() => console.log('  WARN: sources not all loaded'));
  await page.waitForTimeout(5000);
  // The graphics auto-detect probe rewrites every setting 11 s after load, which
  // would silently change the look halfway through a list.
  await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
  await page.waitForFunction(() => {
    const m = window.__map;
    if (m.isEasing && m.isEasing()) return false;
    try { if (window.__fly.eye().driving) return false; } catch (e) {}
    return true;
  }, null, { timeout: 40000 }).catch(() => {});

  const present = await page.evaluate(() => ({
    layer: !!window.__map.getLayer('moody-wall'),
    on: window.MOODY ? window.MOODY.on : null,
  }));
  console.log('  [' + label + '] moody-wall layer present:', present.layer, ' MOODY.on:', present.on);

  const missed = [];
  for (const s of [WARMUP, ...SHOTS]) {
   try {
    await page.evaluate(async (s) => {
      const m = window.__map;
      if (s.gfx && window.GFX) {
        if (typeof s.gfx === 'string' && window.GFX_PRESETS[s.gfx]) Object.assign(window.GFX, window.GFX_PRESETS[s.gfx]);
        else if (typeof s.gfx === 'object') Object.assign(window.GFX, s.gfx);
        window.applyGraphics();
      }
      if (s.center) {
        if (m.isEasing && m.isEasing()) m.stop();
        m.jumpTo({ center: s.center, zoom: s.zoom ?? 16.5, pitch: s.pitch ?? 64, bearing: s.bearing ?? 90 });
      }
      if (typeof s.p === 'number') {
        const sl = document.getElementById('tod-slider'); if (sl) sl.value = String(s.p);
        window.applyTimeOfDay(m, s.p, true);
      }
    }, s);
    // WAIT FOR THE BUILDINGS TO ACTUALLY BE THERE, not just for m.loaded().
    //
    // This is the bug that nearly produced a dishonest PR. `m.loaded()` can
    // return true in the gap between a jumpTo and the tile requests it triggers,
    // so the `before` half of the pair came back with most of the city missing —
    // empty ground where Moody Center and both Dell Med blocks should have been.
    // Set against a fully-loaded `after` frame that reads as "this pass built
    // three enormous buildings", which is not what it did. Count the features
    // under the camera and refuse to shoot until they are there.
    await page.waitForTimeout(2500);
    const loaded = await page.evaluate(async () => {
      const m = window.__map;
      const t0 = performance.now();
      const ready = () => {
        try {
          if (!m.areTilesLoaded()) return false;
          return m.querySourceFeatures('austin-buildings').length > 150;
        } catch (e) { return false; }
      };
      while (!ready() && performance.now() - t0 < 40000) {
        await new Promise(r => setTimeout(r, 400));
      }
      let n = -1;
      try { n = m.querySourceFeatures('austin-buildings').length; } catch (e) {}
      return { ok: ready(), buildings: n, waitedMs: Math.round(performance.now() - t0) };
    });
    if (!loaded.ok) {
      console.log('    (still not settled after ' + loaded.waitedMs + ' ms, ' +
                  loaded.buildings + ' buildings in source — frame may be incomplete)');
    }
    await page.evaluate(() => window.__map.triggerRepaint());
    await page.waitForTimeout(1500);
    const file = path.join(outDir, 'moody-' + label + '-' + s.name + '.png');
    await page.screenshot({ path: file });
    await page.waitForTimeout(700);
    await page.screenshot({ path: file });
    console.log('  WROTE ' + path.basename(file).padEnd(34) +
                loaded.buildings + ' buildings in source, settled in ' +
                loaded.waitedMs + ' ms');
   } catch (e) {
    // Keep going and SAY WHICH ONES ARE MISSING at the end. A shot list that
    // silently stops halfway leaves a directory that looks complete, and a
    // before/after pair with a hole in it is worse than no pair at all.
    missed.push(s.name);
    console.log('  MISSED', s.name, '-', String(e.message).split('\n')[0]);
   }
  }
  if (missed.length) console.log('  ' + missed.length + ' SHOT(S) MISSED:', missed.join(', '));
  if (errors.length) console.log('  ERRORS', errors.slice(0, 6));
  await page.close();
  await browser.__done();
  return missed;
}

console.log('BEFORE  (?moody=0 — this pass switched off in the same build)');
const missedBefore = await runPass('before', '&moody=0');
console.log('AFTER   (?moody=1)');
const missedAfter = await runPass('after', '&moody=1');

// A pair is only a pair if both halves exist. Report the intersection loudly
// rather than leaving it to whoever opens the directory.
const orphan = [...new Set([...missedBefore, ...missedAfter])];
console.log('\n' + (orphan.length
  ? orphan.length + ' pose(s) have no complete before/after pair: ' + orphan.join(', ')
  : 'every pose has a matched before/after pair.'));
process.exit(orphan.length ? 1 : 0);
