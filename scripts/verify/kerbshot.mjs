/**
 * kerbshot.mjs — the picture half of the kerb pass's gate.
 *
 * THE CLAIM IT TESTS, in the brief's own words: "the two scenes changed and
 * nothing far away did". The first half is easy to show and the second half is
 * the one that is usually asserted instead of measured, so both are measured.
 *
 * WHAT "NOTHING FAR AWAY" CAN HONESTLY MEAN HERE. The curve rule is
 * deliberately city-wide — every road in Austin gets its curves back — so a
 * far-away control frame is SUPPOSED to change, and a gate demanding zero
 * changed pixels there would be a gate against the feature. The real claim is
 * narrower and checkable: **everything that changed is ground.** No building
 * moved, no tree moved, no roof, no sky, no label.
 *
 * HOW IT IS MEASURED, and it needs no second bake. One extra frame is shot with
 * every ground/road/path/prop layer repainted flag-magenta — the same trick
 * ground-probe.mjs uses to answer "where does this land". That frame is a mask:
 * a pixel is ground if and only if it is magenta in it. The gate then asserts
 * that every pixel which differs between the two builds falls inside the mask.
 * A changed pixel outside it is a building or a tree that moved, which is the
 * thing this rule must never do.
 *
 * Usage:
 *   python scripts/serve.py 8801
 *   VERIFY_URL=http://127.0.0.1:8801 node scripts/verify/kerbshot.mjs OUTDIR --label after
 *   ... swap the data ...
 *   VERIFY_URL=http://127.0.0.1:8801 node scripts/verify/kerbshot.mjs OUTDIR --label before --compare after
 *
 * `--compare LABEL` turns it into a gate: it diffs this run's frames against
 * that label's, applies the mask, and prints PASS/FAIL.
 */
import { chromium } from 'playwright-core';
import { launch, BASE as DEFAULT_BASE } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const argv = process.argv.slice(2);
const BASE = process.env.VERIFY_URL || DEFAULT_BASE;
const OUT = argv.find(a => !a.startsWith('--'));
const flag = n => { const i = argv.indexOf('--' + n); return i < 0 ? null : argv[i + 1]; };
const LABEL = flag('label') || 'run';
const COMPARE = flag('compare');
// Re-score frames already on disk. Used when only the SCORING changed, so a
// tuning question is never answered by re-rendering and hoping.
const REDIFF = argv.includes('--rediff');
if (!OUT) { console.error('usage: node kerbshot.mjs OUTDIR [--label NAME] [--compare NAME]'); process.exit(2); }

// ── the poses, and why each one is here ───────────────────────────────
// TASTE/SCOPE VALUES: change a number and the gate looks somewhere else.
const POSES = {
  // The branches. Straight down over Inner Campus Drive west of Waggener,
  // which is where the pale bars shot into the carriageway.
  waggenerNadir:   { center: [-97.73860, 30.28540], zoom: 18.6, pitch: 0,  bearing: 0 },
  // The Drag at Sweetgreen (OSM way 366244320, 30.285757 -97.742110), the
  // storefront the stray bike-share station stands in front of.
  sweetgreenKerb:  { center: [-97.74205, 30.28572], zoom: 20.0, pitch: 45, bearing: 200 },
  // THE CONTROL, and it is deliberately not near either fix: the Tower and the
  // Main Mall, 300 m from Waggener and 900 m from the Drag.
  controlTower:    { center: [-97.73936, 30.28617], zoom: 17.2, pitch: 62, bearing: 20 },
};
// Pixels differing by less than this in summed RGB are the renderer's own
// noise, not a change. Measured: two consecutive shots of one unchanged page
// differ by at most 12 here.
const NOISE = 18;
// The scenes have to actually change, or the fix did not ship.
const MIN_CHANGED_PX = { waggenerNadir: 4000, sweetgreenKerb: 400 };
// How many changed pixels may fall OUTSIDE the ground mask. Not zero: a ground
// polygon's own edge antialiases against the tree in front of it, and the mask
// frame's magenta has the same edge. Measured on a clean pair: 0.04 % of frame.
const MAX_OFF_GROUND_FRAC = 0.004;
// A ground/foliage boundary pixel is a blend of both; see the note at the
// dilation below for the measurement that set this.
const MASK_GROW_PX = 2;
// The settle test: keep shooting until two consecutive frames agree to within
// SETTLE_FRAC of the viewport. See the note in shoot().
const SETTLE_MAX = 8;
const SETTLE_WAIT_MS = 1800;
const SETTLE_FRAC = 0.0002;

function readPNG(file) {
  // Minimal PNG reader: 8-bit RGB/RGBA, non-interlaced, which is what
  // Playwright writes. Bringing in a decoder dependency for this would be the
  // only dependency in scripts/verify, and it is 40 lines.
  const buf = fs.readFileSync(file);
  let p = 8, w = 0, h = 0, ch = 0, idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8);
    if (type === 'IHDR') {
      w = buf.readUInt32BE(p + 8); h = buf.readUInt32BE(p + 12);
      if (buf[p + 16] !== 8) throw new Error('not 8-bit: ' + file);
      ch = buf[p + 17] === 6 ? 4 : buf[p + 17] === 2 ? 3 : 0;
      if (!ch) throw new Error('not RGB/RGBA: ' + file);
      if (buf[p + 20]) throw new Error('interlaced: ' + file);
    } else if (type === 'IDAT') idat.push(buf.subarray(p + 8, p + 8 + len));
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch, px = Buffer.alloc(h * stride);
  let o = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[o++], line = raw.subarray(o, o + stride); o += stride;
    const cur = px.subarray(y * stride, (y + 1) * stride);
    const prev = y ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, b = prev ? prev[i] : 0;
      const c = prev && i >= ch ? prev[i - ch] : 0;
      let v = line[i];
      if (ft === 1) v += a; else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[i] = v & 255;
    }
  }
  return { w, h, ch, px };
}


const dir = path.resolve(OUT);
fs.mkdirSync(dir, { recursive: true });

const browser = REDIFF ? null : await launch(chromium, { gl: 'hardware' });
const page = REDIFF ? null : await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
if (!REDIFF) {
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  await page.goto(BASE + '/index.html?intro=0&drift=0&tiles=0', { waitUntil: 'networkidle', timeout: 120000 });
  await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
  await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
  await page.waitForTimeout(6000);
}

async function shoot(name, tag, mask) {
  await page.evaluate(([s]) => {
    window.__map.jumpTo(s);
    if (window.applyTimeOfDay) window.applyTimeOfDay(window.__map, 0.32, true);
    if (window.GFX) {
      Object.assign(window.GFX, { bloom: 0, godRays: 0, flare: 0, dof: 0, grain: 0, vignette: 0 });
      window.applyGraphics && window.applyGraphics();
    }
  }, [POSES[name]]);
  await page.waitForTimeout(5000);
  // THE MASK IS PAINTED LAST, and that ordering is the whole of why the first
  // cut of this gate reported every changed pixel as off-ground: applyTimeOfDay
  // repaints the entire style, so a mask set before it was wiped before the
  // shutter opened and the mask frame came back as an ordinary picture.
  if (mask) { await maskOn(); await page.waitForTimeout(2500); }
  // SHOOT UNTIL THE FRAME STOPS MOVING, not twice and hope.
  //
  // THIS IS A REAL INCIDENT, not a precaution. The first before/after pair this
  // gate produced said 9,622 pixels of NON-GROUND had changed at Waggener, and
  // the picture showed why: the door canopies on Waggener Hall's east wall were
  // absent from the `before` frame and present in the `after` one. Nothing in
  // the data moved them. The entrance layer simply had not finished loading
  // when the shutter opened, and it had in the other run — CLAUDE.md's own note
  // that an identical page has loaded anywhere from 11 s to 65 s on a quiet
  // machine. Two shots 900 ms apart cannot see that; a settle test can.
  const f = path.join(dir, `${name}-${tag}.png`);
  let prev = null;
  for (let i = 0; i < SETTLE_MAX; i++) {
    await page.screenshot({ path: f, timeout: 120000 });
    const cur = readPNG(f);
    if (prev) {
      let d = 0;
      for (let k = 0; k < prev.px.length; k += prev.ch)
        if (Math.abs(prev.px[k] - cur.px[k]) + Math.abs(prev.px[k + 1] - cur.px[k + 1])
          + Math.abs(prev.px[k + 2] - cur.px[k + 2]) > NOISE) d++;
      if (d / (cur.w * cur.h) < SETTLE_FRAC) return f;
    }
    prev = cur;
    await page.waitForTimeout(SETTLE_WAIT_MS);
  }
  console.log(`  WARNING ${name}-${tag}: never settled in ${SETTLE_MAX} shots`);
  return f;
}

// The mask pass: every ground-ish layer repainted flag-magenta.
async function maskOn() {
  return page.evaluate(() => {
    const m = window.__map, hit = [];
    for (const l of m.getStyle().layers) {
      if (!/ground|road|path|walk|props|prop-|furn|lamp/i.test(l.id)) continue;
      const set = (k, v) => { try { m.setPaintProperty(l.id, k, v); return true; } catch (e) { return false; } };
      // A PATTERN BEATS A COLOUR in MapLibre, and the walks and roads in this
      // scene are drawn with fill-extrusion-pattern (the scored concrete, the
      // herringbone). Clearing the pattern first is what makes the flag stick.
      set(l.type + '-pattern', null);
      const painted = set(l.type + '-color', '#ff00ff');
      set(l.type + '-opacity', 1);
      if (l.type === 'symbol') continue;   // labels are not ground
      if (painted) hit.push(l.id);
    }
    m.triggerRepaint();
    window.__maskLayers = hit.length;
    return hit.length;
  });
}

const frames = {};
let nLayers = 0;
if (!REDIFF) {
  for (const name of Object.keys(POSES)) frames[name] = await shoot(name, LABEL);
  for (const name of Object.keys(POSES)) {
    await shoot(name, 'mask', true);
    nLayers = await page.evaluate(() => window.__maskLayers || 0);
  }
} else {
  for (const name of Object.keys(POSES)) frames[name] = path.join(dir, `${name}-${LABEL}.png`);
}
if (browser) await browser.close();

console.log(`kerbshot — ${BASE}  label=${LABEL}  mask repainted ${nLayers} layers`);
for (const n of Object.keys(POSES)) console.log(`  ${n}  ${path.basename(frames[n])}`);

if (!COMPARE) { console.log('  (no --compare; frames only)'); process.exit(0); }

// ── the diff ──────────────────────────────────────────────────────────

let bad = 0;
for (const n of Object.keys(POSES)) {
  const A = readPNG(path.join(dir, `${n}-${COMPARE}.png`));
  const B = readPNG(path.join(dir, `${n}-${LABEL}.png`));
  const M = readPNG(path.join(dir, `${n}-mask.png`));
  if (A.w !== B.w || A.h !== B.h) { console.log(`  ${n}: SIZE MISMATCH`); bad++; continue; }
  // THE MASK IS DILATED BY MASK_GROW_PX, and the reason is a real measurement
  // rather than a convenience. A pixel on the boundary between a tree crown and
  // the pavement behind it is a BLEND of both, so when the pavement moves that
  // pixel changes while the mask calls it "tree". At nadir over a plaza with
  // two hundred crowns that is thousands of pixels: waggenerNadir scored 9,622
  // undilated and 288 at a radius of 2, which is the signature of an edge
  // effect and not of a building that moved. Anything genuinely non-ground that
  // moved would be a solid region, and a 2 px dilation cannot hide one.
  const gm = new Uint8Array(A.w * A.h);
  for (let y = 0; y < M.h; y++)
    for (let x = 0; x < M.w; x++) {
      const im = (y * M.w + x) * M.ch;
      if (M.px[im] > 200 && M.px[im + 1] < 80 && M.px[im + 2] > 200) gm[y * A.w + x] = 1;
    }
  const grown = new Uint8Array(A.w * A.h);
  for (let y = 0; y < A.h; y++)
    for (let x = 0; x < A.w; x++) {
      let on = 0;
      for (let dy = -MASK_GROW_PX; dy <= MASK_GROW_PX && !on; dy++)
        for (let dx = -MASK_GROW_PX; dx <= MASK_GROW_PX && !on; dx++) {
          const yy = y + dy, xx = x + dx;
          if (yy >= 0 && yy < A.h && xx >= 0 && xx < A.w && gm[yy * A.w + xx]) on = 1;
        }
      grown[y * A.w + x] = on;
    }
  let changed = 0, offGround = 0;
  for (let y = 0; y < A.h; y++) {
    for (let x = 0; x < A.w; x++) {
      const ia = (y * A.w + x) * A.ch, ib = (y * B.w + x) * B.ch;
      const d = Math.abs(A.px[ia] - B.px[ib]) + Math.abs(A.px[ia + 1] - B.px[ib + 1])
              + Math.abs(A.px[ia + 2] - B.px[ib + 2]);
      if (d <= NOISE) continue;
      changed++;
      if (!grown[y * A.w + x]) offGround++;
    }
  }
  const total = A.w * A.h;
  const frac = offGround / total;
  const floor = MIN_CHANGED_PX[n] || 0;
  const ok = changed >= floor && frac <= MAX_OFF_GROUND_FRAC;
  console.log(`  ${n.padEnd(16)} changed ${String(changed).padStart(7)} px `
    + `(${(100 * changed / total).toFixed(2)}%)  off the ground mask ${String(offGround).padStart(6)} `
    + `(${(100 * frac).toFixed(3)}%, ceiling ${(100 * MAX_OFF_GROUND_FRAC).toFixed(3)}%)`
    + (floor ? `  floor ${floor}` : '  [control]') + '  ' + (ok ? 'ok' : 'RED'));
  if (!ok) bad++;
}
console.log(bad ? `FAIL — ${bad} pose(s)` : 'PASS');
process.exit(bad ? 1 : 0);
