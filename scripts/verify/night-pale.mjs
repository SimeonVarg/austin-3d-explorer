/**
 * night-pale.mjs — which layer is still bright after dark?
 *
 * THE DEFECT IT WAS WRITTEN FOR. In shots/tour/night-dkr-stadium.png two
 * building-shaped patches sit pale grey while the whole city around them is
 * dark. An unlit surface that stays pale after sunset is the "inverted
 * silhouette" failure, and it is the most visible class of bug this scene has:
 * one wrong building in a night frame draws the eye before anything else.
 *
 * WHY A NEW SCRIPT. `night-silhouette.mjs` exists for this and could not run —
 * it throws `ReferenceError: r is not defined` before doing any work, one of the
 * dead scripts the other lane is repairing. It also asks a narrower question:
 * is the ROOFLINE dark against the sky. That cannot see a pale wall in the
 * middle of the frame.
 *
 * HOW IT FINDS THE CULPRIT WITHOUT GUESSING. Counting bright pixels tells you
 * there is a problem, not where it lives. So: count them, then hide one
 * fill-extrusion layer at a time and count again. The layer whose removal drops
 * the pale count is the layer painting them. No reasoning about paint
 * expressions, no reading the data — the renderer answers directly.
 *
 * It reads pixels through `_harness.html`, which forces preserveDrawingBuffer;
 * index.html does not, and readPixels on a swapped buffer returns black.
 *
 * A LAYER CAN BE INNOCENT AND STILL SCORE. Hiding a layer reveals whatever is
 * behind it, so a dark layer in front of a pale one will also change the count.
 * The report gives the delta per layer and leaves the judgement to a person
 * looking at the two frames it writes.
 *
 * Usage:  VERIFY_URL=http://127.0.0.1:8123 node scripts/verify/night-pale.mjs
 */
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';
import fs from 'node:fs';

fs.mkdirSync('shots', { recursive: true });

// Luma above which a pixel is "pale for a night frame". The night city sits
// well under 40; streetlight cores and lit windows are legitimately above this
// and are why the SMALL counts are noise, not signal.
const PALE = 120;
const P_NIGHT = 0.95;
const POSE = { center: [-97.7325, 30.2835], zoom: 16.2, pitch: 62, bearing: 300 };

const browser = await launch(chromium, { gl: 'hardware' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', e => console.log('  [pageerror] ' + e.message));

await page.goto(BASE + '/_harness.html?intro=0&drift=0', { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

/**
 * Make it night, and DO NOT BELIEVE IT UNTIL THE SCENE IS DARK.
 *
 * What was here dispatched an `input` event at `#tod-slider` and, only if that
 * element was missing, fell back to `applyTimeOfDay`. So the else-branch never
 * ran in the harness — the element is always there — and when the slider's
 * handler was not yet attached the event went nowhere. This script then
 * measured a DUSK frame and reported 250,502 pale pixels at mean luma 111
 * against the 957 at 35 it gets at night, with no complaint at all. Two runs of
 * the same command, ten minutes apart, disagreeing by 260x.
 *
 * That is the "assert the effect, never the intention" rule exactly: an element
 * existing is not a handler running, and a handler running is not a dark scene.
 * So both paths fire every time, and the result is checked against the map's
 * own state and then against the pixels.
 */
async function goNight(p) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.evaluate(v => {
      const el = document.getElementById('tod-slider');
      if (el) {
        el.value = String(v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      // Always, not as a fallback. window.applyTimeOfDay IS the wrapped one —
      // every pass that retints replaces it — so calling it picks up every
      // wrapper, which is the reason tour.mjs says to drive the slider.
      if (typeof window.applyTimeOfDay === 'function') {
        window.applyTimeOfDay(window.__map, v, true);
      }
    }, p);
    await page.waitForTimeout(3500);
    const got = await page.evaluate(() => window.__todCurrentP);
    if (typeof got === 'number' && Math.abs(got - p) < 0.02) return;
    console.log(`  time-of-day did not take (got ${got}); retry ${attempt}`);
  }
  throw new Error('could not set time of day to ' + p);
}
await goNight(P_NIGHT);

await page.evaluate(q => window.__map.jumpTo(q), POSE);
await page.evaluate(() => new Promise(r => {
  const m = window.__map;
  if (m.loaded() && m.areTilesLoaded()) return r();
  m.once('idle', r); setTimeout(r, 25000);
}));
await page.waitForTimeout(1500);

/**
 * Count pale pixels below the horizon.
 *
 * READPIXELS IS BOTTOM-UP. Row 0 of the buffer is the BOTTOM row of the screen;
 * that is the GL spec, and it is visible in shots/readpixels-unflipped.png,
 * where writing the buffer straight out as PNG rows puts the sky at the bottom.
 * The first version of this skipped `h*4*w/3` bytes from the START and its
 * comment said it was skipping the top third — it was skipping the FOREGROUND
 * and counting all of the sky and horizon glow. Every percentage this script
 * has ever printed was a share of the wrong denominator, including the "16% of
 * the wrongly-bright pixels is stadium-*" that put MAC_QUEUE M1c on the list.
 *
 * So: count buffer rows 0 .. 2h/3, which is the bottom two-thirds of the SCREEN.
 *
 * NOTE THE OTHER HALF OF THE INSTRUMENT, which is not a bug but is a limit.
 * This reads the GL canvas, so it sees the scene BEFORE js/graphics.js's CSS
 * grade composites over it. A surface can be acceptable here and too pale on
 * screen, or the reverse. It is the right buffer for "which layer paints this
 * pixel" and the wrong one for "how bright does it look" — for the second, look
 * at the frame it writes.
 */
const countPale = () => page.evaluate(thr => {
  const m = window.__map;
  m.triggerRepaint();
  const c = m.getCanvas();
  const gl = c.getContext('webgl2') || c.getContext('webgl');
  const w = c.width, h = c.height;
  const px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const luma = i => 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
  const to = Math.floor(h * 2 / 3) * w * 4;
  let n = 0;
  for (let i = 0; i < to; i += 4) if (luma(i) > thr) n++;
  // Reported once, as the guard against this inverting again: the region we
  // skip is the sky, so it must be the BRIGHTER of the two at every hour.
  let sIn = 0, sOut = 0;
  for (let i = 0; i < to; i += 4) sIn += luma(i);
  for (let i = to; i < px.length; i += 4) sOut += luma(i);
  return { n, meanCounted: +(sIn / (to / 4)).toFixed(1),
           meanSkipped: +(sOut / ((px.length - to) / 4)).toFixed(1) };
}, PALE);

const layers = await page.evaluate(() => window.__map.getStyle().layers
  .filter(l => l.type === 'fill-extrusion'
    && window.__map.getLayoutProperty(l.id, 'visibility') !== 'none')
  .map(l => l.id));

await page.screenshot({ path: 'shots/night-pale-before.png' });
const first = await countPale();
const base = first.n;
console.log('\npale pixels below the horizon, all layers on: ' + base);
console.log('(' + layers.length + ' visible fill-extrusion layers)');
console.log('mean luma  counted ' + first.meanCounted + '   skipped (sky) '
            + first.meanSkipped
            + (first.meanSkipped > first.meanCounted ? '' : '   <- REGION LOOKS INVERTED'));
console.log('');

// The last gate, and the one that would have caught the 260x disagreement on
// its own: a night frame's ground is dark. 70 is comfortably above the 35 this
// scene measures at p=0.95 and far below the 111 a dusk frame gives.
if (first.meanCounted > 70) {
  console.log('*FAIL — mean luma ' + first.meanCounted + ' is not a night frame.');
  console.log('        Every count below would be a share of the wrong scene.');
  console.log('        Look at shots/night-pale-before.png.');
  process.exitCode = 1;
  await browser.__done();
  process.exit(1);
}

/**
 * GROUPS FIRST, THEN THE WINNING GROUP'S MEMBERS.
 *
 * One layer at a time over 41 layers blew a 560 s watchdog: each toggle forces a
 * full repaint of a dense scene and a 4 MB readPixels, and the waits add up. The
 * prefixes here are the passes that author geometry, so a group answers "which
 * pass is responsible" in a dozen probes instead of forty-one, and only the
 * guilty group pays for a second round.
 */
const groupOf = id => (id.match(/^([a-z0-9]+)-/) || [null, id])[1];
const groups = new Map();
for (const id of layers) {
  const g = groupOf(id);
  if (!groups.has(g)) groups.set(g, []);
  groups.get(g).push(id);
}

const setVis = (ids, v) => page.evaluate(([a, vis]) => {
  for (const i of a) { try { window.__map.setLayoutProperty(i, 'visibility', vis); } catch (e) {} }
}, [ids, v]);

const probe = async ids => {
  await setVis(ids, 'none');
  await page.waitForTimeout(420);
  const { n } = await countPale();
  await setVis(ids, 'visible');
  await page.waitForTimeout(180);
  return base - n;
};

console.log('by pass:');
const gRows = [];
for (const [g, ids] of groups) {
  gRows.push({ id: g + '-*  (' + ids.length + ')', drop: await probe(ids), ids });
}
gRows.sort((a, b) => b.drop - a.drop);
for (const r of gRows) {
  if (r.drop > 0) {
    console.log('  ' + r.id.padEnd(32) + String(r.drop).padStart(8)
                + '   ' + (100 * r.drop / base).toFixed(1) + '%');
  }
}

const rows = [];
const worst = gRows[0];
if (worst && worst.ids.length > 1) {
  console.log('\ninside ' + worst.id + ':');
  for (const id of worst.ids) rows.push({ id, drop: await probe([id]) });
} else if (worst) {
  rows.push({ id: worst.ids[0], drop: worst.drop });
}

rows.sort((a, b) => b.drop - a.drop);
console.log('layer hidden                      pale pixels removed');
for (const r of rows.slice(0, 12)) {
  if (r.drop <= 0) continue;
  console.log('  ' + r.id.padEnd(32) + String(r.drop).padStart(8)
              + '   ' + (100 * r.drop / base).toFixed(1) + '%');
}
const top = rows[0];
console.log('\nlargest single contributor: ' + top.id + '  (' + top.drop + ' px)');

/**
 * ...AND THEN BY `kind`, WHICH IS THE STEP THAT ACTUALLY ANSWERS THE QUESTION.
 *
 * A layer id is not a material. `stadium-detail` carries the aisles, the video
 * board, the ramp towers, the arcade AND the floodlight masts on one
 * fill-extrusion pass, so "stadium-detail is the largest contributor" reads as
 * an indictment of the stadium and is not one: every single pale pixel it
 * scored turned out to be the lamp arrays, which are supposed to be the
 * brightest thing in a night frame. Stopping at the layer would have had
 * somebody darkening a stadium that was already right.
 *
 * So if the guilty layer's features carry a `kind`, hide one kind at a time.
 * Cheap — the pass is already loaded — and it is the difference between a name
 * and a cause.
 */
if (top && top.drop > 0) {
  const kinds = await page.evaluate(id => {
    const src = (window.__map.getLayer(id) || {}).source;
    if (!src) return [];
    const seen = new Set();
    for (const f of window.__map.querySourceFeatures(src)) {
      if (f.properties && f.properties.kind) seen.add(f.properties.kind);
    }
    return [...seen];
  }, top.id);
  if (kinds.length > 1) {
    const base0 = await page.evaluate(id => window.__map.getFilter(id), top.id);
    console.log('\ninside ' + top.id + ', by kind:');
    const kRows = [];
    for (const k of kinds) {
      await page.evaluate(([id, f, kk]) => window.__map.setFilter(
        id, f ? ['all', f, ['!=', ['get', 'kind'], kk]] : ['!=', ['get', 'kind'], kk]),
        [top.id, base0, k]);
      await page.waitForTimeout(400);
      const { n } = await countPale();
      await page.evaluate(([id, f]) => window.__map.setFilter(id, f), [top.id, base0]);
      await page.waitForTimeout(160);
      kRows.push({ k, drop: base - n });
    }
    kRows.sort((a, b) => b.drop - a.drop);
    for (const r of kRows) {
      if (r.drop > 0) console.log('  ' + r.k.padEnd(32) + String(r.drop).padStart(8));
    }
    if (!kRows.some(r => r.drop > 0)) console.log('  (none — the layer is innocent)');
  }
}

console.log('\nHiding a layer also reveals what is behind it — read the two frames');
console.log('before blaming it. shots/night-pale-before.png');

await browser.__done();
