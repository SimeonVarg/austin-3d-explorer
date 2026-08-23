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
 * K7 (2026-08-22): THE SPAWN-POSE HORIZON SHEET, AND THE FIVE WAYS THIS
 * SCRIPT WAS BLIND TO IT. sw-H1-spawn-night.png shows a day-pale sheet of far
 * terrain on the night horizon at the pose every visitor sees first, and this
 * script — written to police exactly that class — could not see it:
 *   1. REGION. It counted the bottom two-thirds of the screen; the sheet sits
 *      at screen y = 0.28-0.33h, inside the top third this script skips as
 *      "sky". Far terrain at a 74-degree pitch lives AT the horizon, which is
 *      precisely the skipped band.
 *   2. LAYER SCOPE. It probed fill-extrusion layers only. A terrain sheet is a
 *      fill / background / raster — a class of layer the probe never touched.
 *   3. THRESHOLD. PALE=120, but the sheet measures luma ~88 peak in the
 *      committed frame against a ~20-luma far field. Glaring to the eye,
 *      invisible to the count.
 *   4. PRESET. It measured whichever graphics preset the browser held, and
 *      cinematic (the sweep's preset) draws 1100 m of far scene against the
 *      default's 700 m. See the POSES note.
 *   5. CUSTOM LAYERS. getStyle().layers omits custom layers — the depth fog
 *      and the sky compositor, the passes that paint the horizon band. The
 *      probe walks map.style._order instead.
 * So: poses are named and each carries its own count BAND, THRESHOLD, preset
 * and hour, and the probe hides every visible layer of every type, grouped
 * by pass. There turned out to be a SIXTH blindness — the scene itself can
 * still be converging when the count runs (the K7 sheet WAS that: the outer
 * ring's async per-tile retint, frozen by a capture) — closed by the
 * convergence gate below. Full isolation record: docs/k7-nighthorizon.md.
 *
 * Usage:  VERIFY_URL=http://127.0.0.1:8123 node scripts/verify/night-pale.mjs [pose]
 *         pose = 'default' (the original DKR-side calibration pose) or
 *                'spawn'   (herowhere.mjs's committed SPAWN, horizon band)
 */
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';
import fs from 'node:fs';

fs.mkdirSync('shots', { recursive: true });

const P_NIGHT = 0.95;

// Named poses. Each carries the whole instrument calibration, because the
// question "is this pixel suspiciously pale" has a different answer at a
// different pose:
//   pose   — camera
//   band   — [topFrac, botFrac] of SCREEN height to count. default counts the
//            bottom two-thirds (the original behaviour); spawn counts the
//            horizon strip where far terrain actually draws at pitch 74.
//   pale   — luma above which a counted pixel is "pale for a night frame".
//            120 for the ground band (streetlight cores sit above it, hence
//            small counts are noise); 60 for the horizon strip, where nothing
//            legitimate is brighter than the ~25-luma sky glow and the K7
//            sheet measures ~88.
//   gate   — meanCounted above this is not a night frame; abort. 70 separates
//            night (~35) from dusk (~111) in the ground band, and night
//            (~25-45) from dusk (150+) at the horizon.
//   gfx    — graphics preset to pin before measuring, or null to leave the
//            page's default alone. THE FOURTH BLINDNESS (K7): the first spawn
//            run measured a defect-free scene and named the lit downtown
//            windows, because cinematic's renderDistance is 1100 m against
//            balanced's 700 m and the pale far terrain simply was not drawn
//            at the default. An instrument that does not pin the preset
//            measures whichever preset the browser happens to hold.
//   p      — time-of-day for the measurement. The committed defect frame
//            (sw-H1-spawn-night.png) is p=0.92, so spawn reproduces that
//            exactly rather than the script's historical 0.95.
const POSES = {
  default: {
    pose: { center: [-97.7325, 30.2835], zoom: 16.2, pitch: 62, bearing: 300 },
    band: [1 / 3, 1], pale: 120, gate: 70, gfx: null, p: 0.95,
  },
  spawn: {
    // herowhere.mjs's committed SPAWN constant == sweep pose H1.
    pose: { center: [-97.7434, 30.2857], zoom: 16.5, pitch: 74, bearing: 250 },
    band: [0.22, 0.40], pale: 60, gate: 70, gfx: 'cinematic', p: 0.92,
  },
};
const POSE_NAME = process.argv[2] || process.env.NP_POSE || 'default';
const CAL = POSES[POSE_NAME];
if (!CAL) {
  console.error('unknown pose "' + POSE_NAME + '" — poses: ' + Object.keys(POSES).join(', '));
  process.exit(2);
}
const { pose: POSE, band: BAND, pale: PALE, gate: GATE } = CAL;
console.log('pose "' + POSE_NAME + '"  band ' + BAND.map(v => v.toFixed(2)).join('-')
            + ' of screen height  pale>' + PALE + '  night-gate<' + GATE);

const browser = await launch(chromium, { gl: 'hardware' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', e => console.log('  [pageerror] ' + e.message));

await page.goto(BASE + '/_harness.html?intro=0&drift=0', { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

// Pin the pose's graphics preset (shot.mjs's own recipe), BEFORE any pixel is
// read. See the POSES note: renderDistance decides whether the far scene this
// instrument polices exists at all.
if (CAL.gfx) {
  await page.evaluate(name => {
    if (window.GFX && window.GFX_PRESETS && window.GFX_PRESETS[name]) {
      Object.assign(window.GFX, window.GFX_PRESETS[name]);
      window.applyGraphics();
    }
  }, CAL.gfx);
  await page.waitForTimeout(1000);
}

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
await goNight(CAL.p != null ? CAL.p : P_NIGHT);

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
 * So: convert the pose's SCREEN band to buffer rows explicitly. A screen band
 * [t, b] (fractions of height, top-down) is buffer rows (1-b)h .. (1-t)h.
 * The default pose's [1/3, 1] is buffer rows 0 .. 2h/3 — the original count.
 *
 * NOTE THE OTHER HALF OF THE INSTRUMENT, which is not a bug but is a limit.
 * This reads the GL canvas, so it sees the scene BEFORE js/graphics.js's CSS
 * grade composites over it. A surface can be acceptable here and too pale on
 * screen, or the reverse. It is the right buffer for "which layer paints this
 * pixel" and the wrong one for "how bright does it look" — for the second, look
 * at the frame it writes.
 */
const countPale = () => page.evaluate(([thr, band]) => {
  const m = window.__map;
  m.triggerRepaint();
  const c = m.getCanvas();
  const gl = c.getContext('webgl2') || c.getContext('webgl');
  const w = c.width, h = c.height;
  const px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const luma = i => 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
  const from = Math.floor((1 - band[1]) * h) * w * 4;   // buffer row of band bottom
  const to   = Math.floor((1 - band[0]) * h) * w * 4;   // buffer row of band top
  let n = 0;
  for (let i = from; i < to; i += 4) if (luma(i) > thr) n++;
  // Reported once, as the guard against the region inverting again: the mean
  // inside the band against the mean outside it. For the default ground band
  // the outside is the sky and must be the BRIGHTER of the two at every hour;
  // for a horizon band no such rule holds, so it is reported, not asserted.
  let sIn = 0, sOut = 0;
  for (let i = from; i < to; i += 4) sIn += luma(i);
  for (let i = 0; i < from; i += 4) sOut += luma(i);
  for (let i = to; i < px.length; i += 4) sOut += luma(i);
  const nIn = (to - from) / 4, nOut = (px.length - (to - from)) / 4;
  return { n, meanCounted: +(sIn / nIn).toFixed(1),
           meanSkipped: +(sOut / nOut).toFixed(1) };
}, [PALE, BAND]);

// EVERY visible layer, not just fill-extrusion. The K7 horizon sheet is not an
// extrusion; restricting the probe to one layer type is how a "which layer
// paints this" instrument stays blind to a whole class of paint. Hiding via
// the visibility layout property works uniformly across fill, line, raster,
// background, symbol, fill-extrusion AND custom layers.
//
// ...and the list must come from `map.style._order`, not `getStyle().layers`:
// getStyle() OMITS custom layers entirely (js/sky.js probed this: 189 layers
// before and after adding one), and the two custom layers in this app are the
// depth fog and the sky compositor — the exact passes that paint the horizon
// band this instrument polices. An enumeration that cannot see them is blind
// to the likeliest suspect. Falls back to getStyle() if the private field
// ever disappears; the fallback is the old, custom-blind list.
const layerInfo = await page.evaluate(() => {
  const m = window.__map;
  const order = (m.style && Array.isArray(m.style._order)) ? m.style._order
    : m.getStyle().layers.map(l => l.id);
  return order.filter(id => {
    try { return m.getLayoutProperty(id, 'visibility') !== 'none'; }
    catch (e) { return false; }
  }).map(id => {
    let type = '?';
    try { type = (m.getLayer(id) || {}).type || '?'; } catch (e) {}
    return { id, type };
  });
});
const layers = layerInfo.map(l => l.id);
const typeOf = new Map(layerInfo.map(l => [l.id, l.type]));
// A symbol layer scoring high is usually LABEL TEXT, which is bright on
// purpose; the annotation is so nobody reads "buildings-labels 78%" as an
// indictment of the buildings.
const tag = id => { const t = typeOf.get(id); return t && t !== 'fill-extrusion' ? '  [' + t + ']' : ''; };

/**
 * THE CONVERGENCE GATE (added closing K7 #1). A retint is not one event: the
 * data-driven passes (outer ring, roofs, crowns) rebuild per-tile paint
 * buffers asynchronously AFTER applyTimeOfDay returns, and under SwiftShader
 * that convergence takes seconds — reproduced at this exact pose as
 * shots/k7/nighthorizon/repro-midretint-defect-PRESENT.png, which is the K7
 * sweep defect to the pixel. `__todCurrentP` matching (goNight's check) only
 * asserts the INTENTION; `areTilesLoaded()` is true throughout, which is how
 * shot.mjs's settle captured the stale frame. So: measure nothing until two
 * counts, a beat apart, agree. A steady-state instrument that reads a
 * converging scene reports a transient as a defect — or a defect as noise.
 */
const STABLE_TRIES = 10;      // give a contended renderer ~10 s to converge
const STABLE_GAP_MS = 900;    // one beat between the two agreeing counts
const STABLE_TOL_N = 25;      // symbol fade / AA flicker allowance, in pixels
const STABLE_TOL_MEAN = 0.5;  // and in band mean luma
let converged = false;
{
  let a = await countPale();
  for (let t = 1; t <= STABLE_TRIES; t++) {
    await page.waitForTimeout(STABLE_GAP_MS);
    const b = await countPale();
    if (Math.abs(a.n - b.n) <= STABLE_TOL_N
        && Math.abs(a.meanCounted - b.meanCounted) <= STABLE_TOL_MEAN) { converged = true; break; }
    console.log('  scene still converging (pale ' + a.n + ' -> ' + b.n
                + ', mean ' + a.meanCounted + ' -> ' + b.meanCounted + '); waiting');
    a = b;
  }
}
if (!converged) {
  console.log('*FAIL — the scene never stopped changing; every count would be a');
  console.log('        snapshot of a transition, not a measurement. See the K7');
  console.log('        record: docs/k7-nighthorizon.md.');
  process.exitCode = 1;
  await browser.__done();
  process.exit(1);
}

const SHOT = 'shots/night-pale-' + POSE_NAME + '-before.png';
await page.screenshot({ path: SHOT });
const first = await countPale();
const base = first.n;
console.log('\npale pixels in the counted band, all layers on: ' + base);
console.log('(' + layers.length + ' visible layers, all types)');
console.log('mean luma  counted ' + first.meanCounted + '   skipped '
            + first.meanSkipped
            + ((POSE_NAME !== 'default' || first.meanSkipped > first.meanCounted)
               ? '' : '   <- REGION LOOKS INVERTED'));
console.log('');

// The last gate, and the one that would have caught the 260x disagreement on
// its own: a night frame's ground is dark. The gate is per-pose (see POSES) —
// for the default ground band, 70 is comfortably above the 35 this scene
// measures at p=0.95 and far below the 111 a dusk frame gives.
if (first.meanCounted > GATE) {
  console.log('*FAIL — mean luma ' + first.meanCounted + ' is not a night frame.');
  console.log('        Every count below would be a share of the wrong scene.');
  console.log('        Look at ' + SHOT + '.');
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
              + '   ' + (100 * r.drop / base).toFixed(1) + '%' + tag(r.id));
}
const top = rows[0];
if (!top) {
  console.log('\nno layer moved the count — either nothing is pale (read ' + SHOT + ')');
  console.log('or the pale thing is not a style layer (CSS grade, veil, DOM).');
  await browser.__done();
  process.exit(0);
}
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
console.log('before blaming it. ' + SHOT);

await browser.__done();
