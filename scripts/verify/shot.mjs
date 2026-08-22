/**
 * shot.mjs — render the REAL Austin 3D Explorer app headless and screenshot it.
 *
 * Usage: node shot.mjs <outPrefix> [shotsJson]
 *   shotsJson: [{name, p, center:[lng,lat], zoom, pitch, bearing}]
 */
import { chromium } from 'playwright-core';
import { chromePath, BASE as SERVER, launch } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';

const EXE = chromePath();
// ?intro=0 matters more than it looks. The intro easeTo does not START until a
// couple of seconds in, so a "wait until not easing" check passes BEFORE it has
// begun — the script then places the camera and the intro immediately flies it
// away. Every shot list's FIRST frame came back at the intro's end pose (a DKR
// list returned West Campus) while shots 2..n were correct, which reads exactly
// like a bad pose rather than a harness bug. ?drift=0 stops the idle cinematic
// from stealing the camera back on a long list.
const BASE = SERVER + '/_harness.html?intro=0&drift=0';
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

// `?intro=0` skips the 9 s opening flight. Without it the FIRST shot in every
// list is unreliable: the intro is a map.flyTo, not the flight controller, so
// `__fly.eye().driving` stays FALSE throughout and there is nothing to wait on
// — the jumpTo lands and is overwritten a frame later. Two Capitol runs
// screenshotted West Campus and read as "the buildings are missing".
await page.goto(BASE + (BASE.includes('?') ? '&' : '?') + 'intro=0',
                { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
// The scene is several MB of GeoJSON across four sources and each one tiles in
// a worker. Wait for the sources, not for a clock.
//
// The list below MUST include the self-booting building passes. It used to be
// the three core sources only, and that is not enough: every pass module polls
// for the map, fetches its own document and adds its source some seconds after
// the three core ones are done, so a shot taken at that moment is a real render
// of a scene that is missing whole buildings. A `g2` FAC shot in the
// building-pass-defect session came back with no UT Tower and no roofscape at
// all and was briefly read as a regression that the fix had caused.
//
// `!m.getSource(s)` is deliberately treated as "fine" — a pass whose module is
// disabled must not hang the run — so this is a wait, not an assertion. That is
// why the sceneReady() count in zfight.mjs exists as well.
await page.waitForFunction(() => {
  const m = window.__map;
  if (!m || !m.getSource('austin-buildings')) return false;
  return ['austin-buildings', 'austin-ground', 'austin-trees',
          'austin-roofscape', 'austin-tower', 'austin-westcampus',
          'austin-drag', 'austin-arts', 'austin-moody', 'austin-stadium']
    .every(s => !m.getSource(s) || m.isSourceLoaded(s));
}, null, { timeout: 90000 }).catch(() => console.log('WARN: sources not all loaded'));
// ...and the sources have to EXIST before "is it loaded" means anything. A
// module that has not added its source yet passes the test above vacuously.
await page.waitForFunction(() => {
  const m = window.__map;
  return ['austin-roofscape', 'austin-tower', 'austin-westcampus',
          'austin-drag', 'austin-arts'].filter(s => m.getSource(s)).length >= 5;
}, null, { timeout: 60000 }).catch(() => console.log('WARN: some pass sources never appeared'));
await page.waitForTimeout(4000);
// The graphics auto-detect probe rewrites every setting 11 s after load, which
// would silently change the look halfway through a shot list.
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
// Same SHIM_SOFTEN/SHIM_SOFTEN_R contract as shimmer.mjs, so a before/after
// screenshot pair uses the identical override the meter was swept with, not a
// second, independently-typed one. Whole-run, not per-shot: this is an A/B of
// the atlas, not a per-pose setting.
if (process.env.SHIM_SOFTEN != null) {
  // TARGET narrows the override to one atlas — 'drag' alone, for a Drag-only
  // before/after pair that does not also perturb facades.js's own already-
  // shipped calibration in the same frame. Defaults to both, matching
  // shimmer.mjs, for a whole-city A/B.
  const targetList = (process.env.SHIM_SOFTEN_TARGET || 'facade,drag').split(',');
  const softenApplied = await page.evaluate(({ soften, softenR, targetList }) => {
    const p0 = window.__todCurrentP != null ? window.__todCurrentP : 0.25;
    const targets = [
      { key: 'facade', S: window.FACADE_SOFTEN, repaint: () => window.updateFacades && window.updateFacades(window.__map, p0) },
      { key: 'drag', S: window.DRAG_SOFTEN, repaint: () => window.applyDragColors && window.applyDragColors(window.__map, p0) },
    ];
    const hit = [];
    for (const t of targets) {
      if (!t.S || !targetList.includes(t.key)) continue;
      for (const f of Object.keys(t.S.RADIUS)) t.S.RADIUS[f] = softenR;
      for (const f of Object.keys(t.S.AMOUNT)) t.S.AMOUNT[f] = soften;
      t.repaint();
      hit.push(t.key);
    }
    return { r: softenR, a: soften, hit };
  }, { soften: Number(process.env.SHIM_SOFTEN), softenR: Number(process.env.SHIM_SOFTEN_R || 3), targetList });
  console.log('SOFTEN', JSON.stringify(softenApplied));
}
// The intro flythrough owns the camera for ~9 s and overwrites jumpTo on the very
// next frame. Without this wait the FIRST shot in every list was taken mid-intro,
// pointing wherever the intro happened to be — which is how a DKR shot list came
// back showing West Campus. Shots 2..n looked fine, so it read as a bad pose
// rather than a harness bug.
await page.waitForFunction(
  () => {
    const m = window.__map;
    if (m.isEasing && m.isEasing()) return false;
    try { if (window.__fly.eye().driving) return false; } catch (e) {}
    return true;
  },
  null, { timeout: 40000 },
).catch(() => {});
await page.waitForTimeout(500);

for (const s of SHOTS) {
  await page.evaluate(async (s) => {
    const m = window.__map;
    // `gfx` is either a preset name or an object of overrides, so a shot list can
    // compare quality levels side by side.
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
      window.applyTimeOfDay(m, s.p);
    }
  }, s);
  // Data-driven paint expressions (roof colours) and the regenerated facade
  // atlas do not land in the same frame as the call. Settle, repaint, and take
  // a throwaway shot first — the first frame after a big time-of-day jump can
  // still be showing the previous state.
  await page.waitForTimeout(4000);
  // A GeoJSON source re-tiles in a worker after a camera move, and a fixed
  // sleep is not long enough for a source that was still being fetched. Without
  // this, a nadir shot of the stadium came back showing the GROUND layer's flat
  // fill where the seating bowl should be — a missing layer that reads exactly
  // like a broken one.
  await page.evaluate(() => new Promise(r => {
    const m = window.__map;
    if (m.loaded()) return r();
    m.once('idle', r);
    setTimeout(r, 15000);
  }));
  await page.evaluate(() => window.__map.triggerRepaint());
  await page.waitForTimeout(1500);
  const file = path.join(outDir, `${OUT}-${s.name}.png`);
  await page.screenshot({ path: file });
  await page.waitForTimeout(600);
  await page.screenshot({ path: file });
  console.log('WROTE', file);
}

const diag = await page.evaluate(() => {
  const m = window.__map;
  const q = id => { try { return m.queryRenderedFeatures({ layers: [id] }).length; } catch (e) { return -1; } };
  const srcFeat = id => { try { return m.querySourceFeatures(id).length; } catch (e) { return -1; } };
  return {
    buildings: q('buildings-3d'), roofs: q('buildings-roof'), parts: q('parts-3d'),
    trees: q('trees-canopy'), signs: q('signs-label'), labels: q('buildings-labels'),
    srcBuildings: srcFeat('austin-buildings'),
    layers: m.getStyle().layers.filter(l => l.layout?.visibility !== 'none').map(l => l.id),
  };
});
console.log('DIAG', JSON.stringify(diag, null, 1));
if (errors.length) console.log('ERRORS', errors.slice(0, 12));
await browser.__done();
