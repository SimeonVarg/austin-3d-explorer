/**
 * field-bleed.mjs — does the DKR turf paint over the grandstand, and where?
 *
 * THE REPORT, more than once and still open: "bug where field is visible
 * through north wall still there." It has been closed before and come back,
 * which is the signature of a fix that treated a symptom.
 *
 * WHY A DIFF AND NOT A COLOUR COUNT. The turf is green, the endzones are burnt
 * orange, and so are half the things around DKR — trees, ground fill, the
 * stadium's own night ramp. Counting "field-coloured" pixels measures the
 * neighbourhood as much as the field. So this photographs each pose TWICE, once
 * with `stadium-field` visible and once with it hidden, and calls the changed
 * pixels the field. Nothing else in the frame moves between the two captures,
 * so every changed pixel is turf by construction. That is the effect, not the
 * intention: it does not ask the layer whether it is hidden, it asks the frame
 * whether the layer painted.
 *
 * The poses are the two halves of the question:
 *
 *   OUTSIDE  — camera outside the bowl, side-on, looking at the stadium from
 *              each compass side. Between the eye and the turf is 63 m of
 *              grandstand. The honest render is ZERO changed pixels. Any pixel
 *              here is the bug.
 *   OVER     — camera above the rim looking down into the bowl. The turf is
 *              genuinely visible and the honest render is a LOT of changed
 *              pixels. This is the control: a "fix" that simply never draws the
 *              field passes the first half and fails here.
 *
 * Note the camera is placed by pose, then MEASURED: `__probeCam` reads the
 * transform back, because a jumpTo's pitch is honoured but its altitude is a
 * consequence of zoom and viewport, and quoting an intended altitude for a real
 * one is how the last camera-angle gate got its numbers.
 *
 * Usage:
 *   VERIFY_URL=http://127.0.0.1:8123 node scripts/verify/field-bleed.mjs
 *   ... node scripts/verify/field-bleed.mjs --shots     also write the frames
 */
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';
import fs from 'node:fs';
import zlib from 'node:zlib';

const OUT = 'shots/field-bleed';
const WRITE_SHOTS = process.argv.includes('--shots');
if (WRITE_SHOTS) fs.mkdirSync(OUT, { recursive: true });

// Field centre from data/stadium.geojson fieldCorners.
const F = [-97.7325465, 30.2836444];

// bearing is the direction the CAMERA LOOKS. Looking south (180) puts the eye
// north of the stadium, which is the reported case.
// WHICH POSES SHOULD SEE TURF, and why — this is arithmetic, not taste, and
// getting it wrong makes the test lie in whichever direction you guessed.
//
// At zoom 16.9 in a 1280x800 viewport the camera sits at 398 m altitude
// (measured, not assumed — it is printed on every row). A pose at pitch P puts
// the eye a horizontal 398*tan(P) from the field centre, looking down at 90-P.
// The near rim is 63 m tall and ~135 m from the centre on the north side, so
// the sight line clears it when  398 - (398*tan(P) - 135)*tan(90-P) > 63:
//
//   pitch 79   eye 2046 m out, line is 27 m up at the rim   BLOCKED
//   pitch 70   eye 1093 m out, line is 49 m up at the rim   BLOCKED
//   pitch 62   eye  748 m out, line is 72 m up at the rim   CLEARS  <- and the
//                                                  photograph agrees: you are
//                                                  looking into the bowl.
//
// So 62 is NOT a bleed case and an earlier version of this file wrongly called
// it one. Everything at 70 and above is: there is 63 m of grandstand in the way
// and the honest render is nothing.
//
// ── AND 70 WAS THE SAME MISTAKE ONE NOTCH DOWN. CORRECTED 2026-08-16. ──────
//
// `outside-north-70` was filed `'zero'` and had been red every time this gate
// got far enough to reach it: 2986 turf pixels, box 594,369-685,405. That looked
// like the find of the pass — `js/app.js:544` records the ORIGINAL raster defect
// as "3318 px at pitch 79, box 581,381-687,422", the same band of the frame, one
// pitch below the pose that was fixed.
//
// IT IS NOT THAT, AND THE PICTURE SETTLES IT.
// `shots/reds/field-bleed-70-magenta.png` paints this file's own mask: the
// magenta is INSIDE THE BOWL — the far half of the playing field seen over the
// near rim, with the near grandstand's top edge cutting cleanly across below it.
// Nothing paints on the outside face of the north wall.
//
// The arithmetic above agrees once it is applied to the right point. It is
// derived for the sight line to the FIELD CENTRE, and the field is 123 m long:
//
//   pitch 70, eye 1094.6 m out
//     line to CENTRE          398.4 * 135/1094.6            = 49.1 m at the rim  BLOCKED
//     line to the FAR EDGE    398.4 * (1 - 959.6/1156.1)    = 67.7 m at the rim  CLEARS by 4.7
//
// A one-point calculation was generalised to a 123 m field. The expectation is
// therefore `'some'`, and the reason it is not simply deleted is that a `'some'`
// pose is a CONTROL: it catches a "fix" that stops drawing the field at all.
// (The 63 m rim height and 135 m offset are this header's own numbers, so the
// exact break-even pitch is its; the photograph does not depend on them.)
const POSES = [
  // name,             zoom, pitch, bearing,   expectation
  ['outside-north',    16.9, 79, 180, 'zero'],
  ['outside-north-70', 16.9, 70, 180, 'some'],   // far half of the field clears the rim
  ['outside-northeast',16.9, 76, 225, 'zero'],   // "from top right looking down left"
  ['outside-east',     16.9, 79, 270, 'zero'],
  ['outside-south',    16.9, 79,   0, 'zero'],
  ['outside-west',     16.9, 79,  90, 'zero'],
  ['into-bowl-62',     16.9, 62, 180, 'some'],   // clears the rim, see above
  ['over-rim',         16.6, 40, 180, 'some'],
  ['nadir',            16.6,  0,   0, 'some'],
];

const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('  [pageerror] ' + e.message));

await page.goto(BASE + '/index.html?intro=0&drift=0', { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
await page.evaluate(() => new Promise(r => {
  const m = window.__map;
  if (m.loaded()) return r();
  m.once('idle', r); setTimeout(r, 60000);
}));

/** Decode a PNG screenshot to raw RGBA without a dependency. */
function decodePNG(buf) {
  let pos = 8, w = 0, h = 0, bitDepth = 0, colour = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colour = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bitDepth !== 8 || (colour !== 6 && colour !== 2)) {
    throw new Error(`unsupported PNG: depth ${bitDepth} colour ${colour}`);
  }
  const ch = colour === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(w * h * ch);
  let rp = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[rp++];
    const row = y * w * ch, prev = row - w * ch;
    for (let x = 0; x < w * ch; x++) {
      const a = x >= ch ? out[row + x - ch] : 0;
      const b = y > 0 ? out[prev + x] : 0;
      const c = (x >= ch && y > 0) ? out[prev + x - ch] : 0;
      let v = raw[rp++];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      out[row + x] = v & 0xff;
    }
  }
  return { w, h, ch, data: out };
}

/**
 * Pixels that differ by more than `tol` on any channel, plus the bounding box
 * and the vertical centre of mass. A bleed through a wall and a legitimate view
 * into the bowl paint different SHAPES, and the box is what tells them apart in
 * a log line.
 */
function diff(a, b, a2, tol = 6) {
  const far = (p, q, i) => Math.abs(p.data[i] - q.data[i]) > tol ||
                           Math.abs(p.data[i + 1] - q.data[i + 1]) > tol ||
                           Math.abs(p.data[i + 2] - q.data[i + 2]) > tol;
  let n = 0, x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1, sy = 0, sr = 0, sg = 0, sb = 0;
  for (let y = 0; y < a.h; y++) {
    for (let x = 0; x < a.w; x++) {
      const i = (y * a.w + x) * a.ch;
      // Changed by the toggle AND stable across the two field-on frames. The
      // scene never fully stops — cloud drift and the tree canopy keep moving —
      // and a plain two-frame diff reported 5,694 "field" pixels in the bottom
      // corner of a frame where the field is not even visible, at a mean rgb of
      // 155,132,102, which is pavement. Anything genuinely painted by the layer
      // is identical in both on-frames; anything drifting is not.
      if (far(a, b, i) && far(a2, b, i) && !far(a, a2, i)) {
        n++; sy += y;
        // Mean colour of the turf AS RENDERED. An extrusion's top face picks up
        // the sun tint — SEAT_COL records a neutral #c9bdaa coming back at R/B
        // 1.85 from an input of 1.18 — so any replacement for the raster has to
        // be checked against what the raster actually put on screen, not
        // against the hex that was typed.
        sr += a.data[i]; sg += a.data[i + 1]; sb += a.data[i + 2];
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  return { n, pct: 100 * n / (a.w * a.h), box: n ? [x0, y0, x1, y1] : null,
           cy: n ? Math.round(sy / n) : null,
           rgb: n ? [Math.round(sr / n), Math.round(sg / n), Math.round(sb / n)] : null };
}

/**
 * Wait for the frame to be worth photographing.
 *
 * The idle fallback is 4 s, not the 20 s this suite usually uses. The scene
 * here never fully idles — the drift timer and the sky keep firing — so a 20 s
 * fallback is not a safety net, it is the actual cost of every settle, and it
 * took a nine-pose run past the watchdog. Tiles for this one square kilometre
 * are loaded after the first pose; every later pose is a camera move over data
 * that is already there.
 */
async function settle(ms = 700) {
  await page.evaluate(() => new Promise(r => {
    const m = window.__map;
    if (m.loaded() && m.areTilesLoaded()) return r();
    m.once('idle', r); setTimeout(r, 4000);
  }));
  await page.waitForTimeout(ms);
}

async function shoot() {
  await page.screenshot({ type: 'png' });          // first frame is a half-draw
  await page.waitForTimeout(280);
  const buf = await page.screenshot({ type: 'png' });
  return { buf, img: decodePNG(buf) };
}

const TIMES = { day: 0.30, night: 0.95 };
const rows = [];

/**
 * Set the hour, and check the map agrees before measuring anything.
 *
 * The pattern this replaces dispatched at `#tod-slider` and only fell back to
 * `applyTimeOfDay` if that element was MISSING — so when the element existed
 * but its handler was not yet attached, the event went nowhere and the fallback
 * never ran. night-pale.mjs had the identical code and silently measured a dusk
 * frame, reporting 250,502 pale pixels where night gives 957. An element
 * existing is not a handler running.
 */
async function setTimeOfDay(p) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.evaluate(v => {
      const el = document.getElementById('tod-slider');
      if (el) {
        el.value = String(v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (typeof window.applyTimeOfDay === 'function') {
        window.applyTimeOfDay(window.__map, v, true);
      }
    }, p);
    await page.waitForTimeout(3200);
    const got = await page.evaluate(() => window.__todCurrentP);
    if (typeof got === 'number' && Math.abs(got - p) < 0.02) return;
    console.log(`  time-of-day did not take (got ${got}); retry ${attempt}`);
  }
  throw new Error('could not set time of day to ' + p);
}

for (const [tname, tp] of Object.entries(TIMES)) {
  await setTimeOfDay(tp);

  for (const [name, zoom, pitch, bearing, expect] of POSES) {
    await page.evaluate(q => window.__map.jumpTo(q),
      { center: F, zoom, pitch, bearing });
    await settle();

    // What the camera ACTUALLY is, and what the gate actually decided.
    const cam = await page.evaluate(() => {
      const m = window.__map, t = m.transform;
      const alt = t.cameraToCenterDistance / t.pixelsPerMeter;
      const l = m.getLayer('stadium-field');
      return {
        alt: +alt.toFixed(1),
        pitch: +m.getPitch().toFixed(1),
        // Not a "was the gate on" reading — the gate is gone. This is here so a
        // run that silently lost the layer reads as NO LAYER rather than as a
        // clean pass, which is exactly how a missing layer flatters a metric.
        kind: l ? l.type : 'NO LAYER',
        vis: l ? (m.getLayoutProperty('stadium-field', 'visibility') || 'visible') : '-',
      };
    });

    const t0 = Date.now();
    const on = await shoot();
    await page.evaluate(() => window.__map.setLayoutProperty('stadium-field', 'visibility', 'none'));
    await page.waitForTimeout(450);                // a visibility flip loads nothing
    const off = await shoot();
    await page.evaluate(() => window.__map.setLayoutProperty('stadium-field', 'visibility', 'visible'));
    await page.waitForTimeout(450);
    const on2 = await shoot();

    const d = diff(on.img, off.img, on2.img);
    d.ms = Date.now() - t0;
    rows.push({ tname, name, expect, cam, d });

    if (WRITE_SHOTS) fs.writeFileSync(`${OUT}/${tname}-${name}.png`, on2.buf);

    const verdict = expect === 'zero'
      ? (d.n === 0 ? 'PASS' : '*FAIL')
      : (d.n > 500 ? 'PASS' : '*FAIL');
    console.log(
      `${verdict} ${tname.padEnd(5)} ${name.padEnd(18)} pitch ${String(cam.pitch).padStart(4)}  ` +
      `alt ${String(cam.alt).padStart(6)}m  layer ${String(cam.kind).padEnd(15)}  ` +
      `field pixels ${String(d.n).padStart(7)} (${d.pct.toFixed(2)}%)` +
      (d.rgb ? `  mean rgb ${d.rgb.join(',')}` : '') +
      (d.box ? `  box ${d.box.join(',')}` : '') + `  [${(d.ms / 1000).toFixed(1)}s]`);
  }
}

const bad = rows.filter(r => r.expect === 'zero' ? r.d.n > 0 : r.d.n <= 500);
console.log(`\n${bad.length === 0 ? 'PASS' : '*FAIL'} — ${bad.length} of ${rows.length} poses wrong`);
if (bad.length) {
  console.log('  outside-the-bowl poses that still paint turf:');
  for (const r of bad.filter(r => r.expect === 'zero')) {
    console.log(`    ${r.tname} ${r.name}: ${r.d.n} px, box ${r.d.box.join(',')}`);
  }
  for (const r of bad.filter(r => r.expect === 'some')) {
    console.log(`    ${r.tname} ${r.name}: only ${r.d.n} px — the field is not drawn where it SHOULD be`);
  }
}
process.exitCode = bad.length ? 1 : 0;
await browser.__done();
