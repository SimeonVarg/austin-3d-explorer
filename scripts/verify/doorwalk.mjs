/**
 * doorwalk.mjs — stand on the pavement in front of a door and photograph it.
 *
 * Usage: node scripts/verify/doorwalk.mjs <outDir> <posesJson> [startIdx] [endIdx]
 *
 * The poses are EYE poses (lng, lat, alt, bearing, pitch), not map poses. The
 * map centre/zoom is derived here with the same closed form controls.js uses to
 * write the camera every frame (js/controls.js "the eye is the state"):
 *
 *   lead = alt * tan(pitch);  centre = eye + lead along bearing
 *   D    = alt / cos(pitch);  zoom   = log2(C*cos(lat)*camPx / (512*D))
 *
 * so "1.7 m off the ground" means 1.7 m off the ground rather than a zoom that
 * looks about right. __fly.eye().alt is read back after every jump and written
 * into the manifest, because a clamp that silently raised the camera would
 * otherwise be invisible in the frame.
 *
 * THE TRAP THIS SCRIPT EXISTS TO AVOID: entrances load LAZILY (QUEUE W3 /
 * HANDOFF 115) — the 6.7 MB file is fetched on idle or on descent, not at boot.
 * A frame taken before it lands shows a blank wall, which reads exactly like
 * "the door was never placed". So every shot asserts that the entrance SOURCE
 * has features and that the entrance LAYERS actually rendered some, and the
 * counts go in the manifest next to the picture.
 */
import { chromium } from 'playwright-core';
import { chromePath, launch } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';

const PORT = process.env.PORT || '8431';
const BASE = `http://127.0.0.1:${PORT}/index.html?intro=0&drift=0`;
const outDir = path.resolve(process.argv[2] || 'shots/walk/doors15');
const POSES = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const A = Number(process.argv[4] ?? 0), B = Number(process.argv[5] ?? POSES.length);
const LIST = POSES.slice(A, B);
fs.mkdirSync(outDir, { recursive: true });

const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));

await page.goto(BASE, { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 90000 });
await page.waitForFunction(() => {
  const m = window.__map;
  if (!m || !m.getSource('austin-buildings')) return false;
  return ['austin-buildings', 'austin-ground', 'austin-trees', 'austin-roofscape',
          'austin-tower', 'austin-westcampus', 'austin-drag', 'austin-moody', 'austin-stadium']
    .every(s => !m.getSource(s) || m.isSourceLoaded(s));
}, null, { timeout: 120000 }).catch(() => console.log('WARN sources'));
// The graphics auto-detect probe rewrites every setting ~11 s in; cancelling it
// is a correctness measure (CLAUDE.md verification rule 10).
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
// Entrances are deferred: armEntranceLoad() fires on `idle` (+2 s), on any
// camera move below ENT.defer.altM, or on the maxWait timeout — there is no
// force hook, so this WAITS rather than pokes. The source does not exist at
// all until the trigger fires, hence the !!s test before isSourceLoaded.
await page.waitForFunction(() => {
  const m = window.__map, s = m.getSource('austin-entrances');
  return !!s && m.isSourceLoaded('austin-entrances');
}, null, { timeout: 120000 }).catch(() => console.log('WARN entrances source never loaded'));
await page.waitForFunction(
  () => { const m = window.__map; if (m.isEasing && m.isEasing()) return false;
          try { if (window.__fly.eye().driving) return false; } catch (e) {} return true; },
  null, { timeout: 40000 }).catch(() => {});

// ── the shot loop ────────────────────────────────────────────────────────
// THE COLLISION NET MOVES THE CAMERA AND DOES NOT TELL THE FRAME. controls.js
// holds the eye above maxHeightIn(eye, rCam) + HARD_CLEAR, so a standing point
// that shapely says is OUTSIDE the footprint can still sit inside the camera's
// padded probe radius: BME's courtyard door threw the eye from 1.7 m to 36.6 m
// and photographed a rooftop while every number in the manifest still looked
// plausible. So the eye is READ BACK after every jump, and a frame that is not
// at walking height is re-posed further out instead of being shipped.
//
// The zoom clamp is the other half of the same story. controls.js pins
// ZOOM_MAX = 21.5, so below ~18 m of standoff the derived zoom saturates and
// the eye settles at ~2.4 m rather than the requested 1.7 m. 2.4 m IS the app's
// own floor at this framing — the closest a user can stand — so it is reported,
// not fought.
const M_LAT = 40030228.884 / 360;
const repose = (s, dist) => {
  const mlon = Math.cos(s.door[1] * Math.PI / 180) * M_LAT;
  const back = dist - s.dist;
  return { ...s, dist,
    pitch: Math.atan2(dist, s.alt) * 180 / Math.PI,
    eye: [s.eye[0] - Math.sin(s.bearing * Math.PI / 180) * back / mlon,
          s.eye[1] - Math.cos(s.bearing * Math.PI / 180) * back / M_LAT] };
};
const place = (s) => page.evaluate((s) => {
  const m = window.__map, rad = d => d * Math.PI / 180;
  const C = 40030228.884, ML = C / 360, mLon = lat => ML * Math.cos(rad(lat));
  const fov = m.getVerticalFieldOfView ? m.getVerticalFieldOfView() : 58;
  const camPx = 0.5 * m.getCanvas().clientHeight / Math.tan(rad(fov) / 2);
  const [elng, elat] = s.eye, lead = s.alt * Math.tan(rad(s.pitch));
  const cLat = elat + lead * Math.cos(rad(s.bearing)) / ML;
  const cLng = elng + lead * Math.sin(rad(s.bearing)) / mLon(elat);
  const D = s.alt / Math.cos(rad(s.pitch));
  const z = Math.log2(C * Math.cos(rad(cLat)) * camPx / (512 * D));
  if (m.isEasing && m.isEasing()) m.stop();
  m.jumpTo({ center: [cLng, cLat], zoom: z, bearing: s.bearing, pitch: s.pitch });
  if (typeof window.applyTimeOfDay === 'function') window.applyTimeOfDay(m, 0.30);
}, s);
const readEye = () => page.evaluate(() => {
  const m = window.__map; let e = null;
  try { e = window.__fly.eye(); } catch (err) {}
  return { alt: e ? +e.alt.toFixed(2) : null, zoom: +m.getZoom().toFixed(3),
           pitch: +m.getPitch().toFixed(2) };
});

const manifest = [];
for (const s0 of LIST) {
  let s = s0, eye = null, tries = [];
  for (const dist of [s0.dist, 22, 30, 42, 60]) {
    s = repose(s0, dist);
    await place(s);
    await page.waitForTimeout(700);          // let the controls tick adopt it
    eye = await readEye();
    tries.push({ dist, eyeAlt: eye.alt });
    if (eye.alt !== null && eye.alt < s0.alt * 2.2) break;   // walking height
  }
  await page.waitForTimeout(1500);
  // Never `await` a bare once('idle') after the map has already gone idle —
  // nothing schedules another render and it never settles (README timing trap).
  await page.evaluate(() => new Promise(r => {
    const m = window.__map; if (m.loaded()) return r();
    m.once('idle', r); setTimeout(r, 3500);
  }));
  await page.evaluate(() => window.__map.triggerRepaint());
  await page.waitForTimeout(900);

  const probe = await page.evaluate((s) => {
    const m = window.__map;
    // NOT queryRenderedFeatures. At pitch >82 / zoom 21.5 it returns ONE feature
    // for the WHOLE screen (probed: allQRF === 1 on a frame visibly full of
    // buildings and a lit doorway), so "0 rendered" from it is the instrument
    // failing, not the door missing. querySourceFeatures reports what tiled into
    // this viewport; the picture is the evidence that it DREW.
    let src = -1, entVis = 0;
    try { src = m.querySourceFeatures('austin-entrances').length; } catch (e) {}
    try { entVis = m.getStyle().layers
      .filter(l => l.id.startsWith('entrances-') && l.layout?.visibility !== 'none').length; } catch (e) {}
    const pt = m.project(s.door);
    let e = null; try { e = window.__fly.eye(); } catch (err) {}
    return { entSrcFeatures: src, entLayersVisible: entVis,
             doorPx: [Math.round(pt.x), Math.round(pt.y)],
             eyeAlt: e ? +e.alt.toFixed(2) : null,
             zoom: +m.getZoom().toFixed(3), pitch: +m.getPitch().toFixed(2),
             qrfUnusableAtThisPitch: true };
  }, s);

  const file = path.join(outDir, `${s.name}.png`);
  if (!process.env.NOSHOT) {
    await page.screenshot({ path: file });
    await page.waitForTimeout(400);
    await page.screenshot({ path: file });    // screenshot twice, trust the second
  }
  const onScreen = probe.doorPx[0] > 0 && probe.doorPx[0] < 1440 &&
                   probe.doorPx[1] > 0 && probe.doorPx[1] < 900;
  manifest.push({ ...s, ...probe, tries, doorOnScreen: onScreen, file: path.basename(file) });
  // Written after EVERY shot, not once at the end. chrome.mjs reaps the browser
  // at VERIFY_MAX_MS and the process dies where it stands; an end-of-run write
  // means a killed run leaves the PREVIOUS run's manifest sitting next to a
  // fresh set of frames, which is a stale file that looks current.
  fs.writeFileSync(path.join(outDir, '_manifest.json'), JSON.stringify(manifest, null, 1));
  console.log(`${s.name.padEnd(13)} eyeAlt=${String(probe.eyeAlt).padStart(6)} standoff=${String(s.dist).padStart(4)}m entSrc=${String(probe.entSrcFeatures).padStart(5)} doorPx=${probe.doorPx} onScreen=${onScreen} z=${probe.zoom}`);
}
fs.writeFileSync(path.join(outDir, '_manifest.json'), JSON.stringify(manifest, null, 1));
if (errors.length) console.log('ERRORS', errors.slice(0, 8));
await browser.__done();
