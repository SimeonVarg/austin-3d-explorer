/**
 * westcampus-shot.mjs — screenshots at named poses, with the pass ON or OFF.
 *
 * This is scripts/verify/shot.mjs with one thing added: `?westcampus=0`, which
 * js/westcampus.js reads at load to skip itself entirely. That gives a true
 * BEFORE from the same build at the same pose, rather than from a second
 * checkout — the shape js/outer.js uses for `?outer=0`.
 *
 * Usage: node westcampus-shot.mjs <outPrefix> [shotsJson] [off]
 */
import { chromium } from 'playwright-core';
import { chromePath, GL_ARGS, BASE as SERVER, launch } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2] || 'westcampus';
const SHOTS = JSON.parse(fs.readFileSync(process.argv[3] || 'shots-westcampus.json', 'utf8'));
const OFF = process.argv[4] === 'off';
// ?intro=0 matters more than it looks: without it the FIRST shot of every list
// comes back at the intro flight's end pose. ?drift=0 stops the idle cinematic
// stealing the camera back on a long list. Both cost this repo real sessions.
const BASE = SERVER + '/_harness.html?intro=0&drift=0' + (OFF ? '&westcampus=0' : '');

const outDir = path.resolve('../../shots');
fs.mkdirSync(outDir, { recursive: true });

// ── `look` + `dist`, instead of `center` ──────────────────────────────
//
// A shot list that names a `center` does NOT frame that point at the distance
// you expect: MapLibre puts the centre on the view axis, and at a flying pitch
// the camera sits a very long way behind it. Measured, at 1440x900 and the
// app's 58 deg vertical FOV: z17.5 / pitch 70 puts the camera 556 m from the
// centre point. So a shot list that centres on a 60 m tower renders that tower
// as a speck, which is exactly how the first nine shots of this pass came back
// — and it reads as "the buildings did not load", not as a camera error.
//
// So a shot may instead say `look` (the point to frame) and `dist` (how far in
// front of the camera to put it). The centre is then pushed further along the
// bearing by however much the projection needs.
const FOV_DEG = 58;
const VIEW_H = 900;
function centerFor(s) {
  if (!s.look) return s.center;
  const lat = s.look[1], zoom = s.zoom ?? 16.5, pitch = s.pitch ?? 64;
  const mpp = 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, zoom);
  const dPx = (VIEW_H / 2) / Math.tan(FOV_DEG * Math.PI / 360);
  const ground = dPx * mpp * Math.sin(pitch * Math.PI / 180);   // camera -> centre, metres
  const push = ground - (s.dist ?? 200);
  const b = (s.bearing ?? 0) * Math.PI / 180;
  return [s.look[0] + (push * Math.sin(b)) / (111320 * Math.cos(lat * Math.PI / 180)),
          s.look[1] + (push * Math.cos(b)) / 111320];
}

const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));

await page.goto(BASE, { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
await page.waitForFunction(() => {
  const m = window.__map;
  if (!m || !m.getSource('austin-buildings')) return false;
  return ['austin-buildings', 'austin-ground', 'austin-trees']
    .every(s => !m.getSource(s) || m.isSourceLoaded(s));
}, null, { timeout: 90000 }).catch(() => console.log('WARN: sources not all loaded'));
await page.waitForTimeout(4000);
// The graphics auto-detect probe rewrites every setting 11 s after load.
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
await page.waitForFunction(() => {
  const m = window.__map;
  if (m.isEasing && m.isEasing()) return false;
  try { if (window.__fly.eye().driving) return false; } catch (e) {}
  return true;
}, null, { timeout: 40000 }).catch(() => {});

const present = await page.evaluate(() => !!window.__map.getSource('austin-westcampus'));
console.log('westcampus source present:', present, '(expected', !OFF, ')');

for (const s of SHOTS) {
  s.center = centerFor(s);
  await page.evaluate(async (s) => {
    const m = window.__map;
    if (m.isEasing && m.isEasing()) m.stop();
    m.jumpTo({ center: s.center, zoom: s.zoom ?? 16.5, pitch: s.pitch ?? 64, bearing: s.bearing ?? 0 });
    if (typeof s.p === 'number') {
      const sl = document.getElementById('tod-slider'); if (sl) sl.value = String(s.p);
      window.applyTimeOfDay(m, s.p, true);
    }
  }, s);
  // SETTLE TWICE, with an idle wait after each. This is not belt-and-braces.
  //
  // applyTimeOfDay regenerates EVERY image in the facade atlas, and this pass
  // adds 19 to it. Rewriting an image invalidates the per-tile ImageAtlas, so
  // every loaded tile re-uploads its texture — and a fill-extrusion whose
  // pattern is mid-flight is drawn TRANSPARENT, not stale. At z17.6, where
  // there are a lot of tiles, one 4 s settle was not enough: whole blocks of
  // the city came back missing and it read exactly like this pass deleting
  // buildings. It was the shutter, not the scene. (Confirmed by rendering the
  // identical pose without a time-of-day call, which came back full.)
  const settle = async (ms, cap) => {
    await page.waitForTimeout(ms);
    await page.evaluate((cap) => new Promise(r => {
      const m = window.__map;
      if (m.loaded()) return r();
      m.once('idle', r); setTimeout(r, cap);
    }), cap);
  };
  await settle(3500, 12000);
  await page.evaluate(() => window.__map.triggerRepaint());
  await settle(2500, 6000);
  // Echo the camera we ACTUALLY have, immediately before the shutter. Two
  // different pose lists once produced byte-identical frames here and it read as
  // the renderer being broken; without this line there is nothing to check the
  // pose against, and "the shot looks wrong" and "the camera went somewhere
  // else" are indistinguishable.
  const cam = await page.evaluate(() => {
    const m = window.__map, c = m.getCenter();
    let driving = null; try { driving = window.__fly.eye().driving; } catch (e) {}
    return { c: [+c.lng.toFixed(5), +c.lat.toFixed(5)], z: +m.getZoom().toFixed(2),
             p: +m.getPitch().toFixed(1), b: +m.getBearing().toFixed(1), driving };
  });
  const want = { c: s.center, z: s.zoom, p: s.pitch, b: s.bearing };
  const off = Math.abs(cam.z - want.z) > 0.02 ||
              Math.abs(cam.c[0] - want.c[0]) > 0.0002 ||
              Math.abs(cam.c[1] - want.c[1]) > 0.0002;
  const file = path.join(outDir, `${OUT}-${s.name}.png`);
  await page.screenshot({ path: file });
  await page.waitForTimeout(600);
  await page.screenshot({ path: file });
  console.log('WROTE', file, off ? '  *** CAMERA DRIFTED ***' : '',
              'cam=' + JSON.stringify(cam));
}
if (errors.length) console.log('ERRORS', errors.slice(0, 10));
await browser.__done();
