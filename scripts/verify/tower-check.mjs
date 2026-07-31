/**
 * tower-check.mjs — assert the UT Tower is what docs/PASS_TOWER.md claims.
 *
 * The playbook's rule is to build the render -> pixel-sample -> assert harness
 * as coding step ONE. This is that harness. Everything below is measured off
 * the rendered framebuffer or off the live style, never off the source geojson,
 * because the failure this project keeps hitting is geometry that is correct on
 * disk and invisible on screen.
 *
 * The silhouette test is the important one. It isolates the tower layers, looks
 * at the shaft against the sky, and asserts the SETBACK PROFILE — that the
 * silhouette narrows going up, in the ratios the bake says it should. That is
 * the one thing that distinguishes "the Tower" from "a tower", and it is
 * exactly what a single fill-extrusion-pattern can never produce.
 *
 * Usage: node tower-check.mjs
 */
import { chromium } from 'playwright-core';
import { chromePath, BASE as SERVER, launch } from './chrome.mjs';

const C = [-97.739325, 30.286015];

let pass = 0, fail = 0;
function ok(cond, label, detail) {
  if (cond) { pass++; console.log('  ok   ' + label + (detail ? '   ' + detail : '')); }
  else { fail++; console.log('  FAIL ' + label + (detail ? '   ' + detail : '')); }
}
function near(v, want, tol, label) {
  ok(Math.abs(v - want) <= tol, label,
     `got ${(+v).toFixed(3)}, want ${want} +/- ${tol}`);
}

const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errs = [];
page.on('pageerror', e => errs.push(e.message));

await page.goto(SERVER + '/_harness.html?intro=0&drift=0', { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 90000 });
await page.waitForTimeout(6000);
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

// ── 1. the module is wired up at all ────────────────────────────────
console.log('\nregistration');
const reg = await page.evaluate(async () => {
  const m = window.__map;
  // Ask the DATA which images should exist rather than hard-coding a list that
  // goes stale the moment a band changes colour.
  const gj = await (await fetch('data/tower.geojson')).json();
  const want = new Set(), palettes = new Map();
  for (const f of gj.features) {
    const p = f.properties;
    if (!p.pat) continue;
    want.add(p.pat);
    const trio = [p.wd, p.wg, p.wn].join('|');
    if (!palettes.has(p.pat)) palettes.set(p.pat, new Set());
    palettes.get(p.pat).add(trio);
  }
  return {
    src: !!m.getSource('austin-tower'),
    layers: ['tower-wall', 'tower-solid', 'tower-detail'].filter(id => !!m.getLayer(id)),
    wantImages: [...want],
    images: [...want].filter(i => m.hasImage(i)),
    // A pattern image IS a colour, so an id carrying two palettes means one of
    // them is silently not drawn. This shipped once: seven bands shared the
    // plain-ashlar family, and the whole crown inherited the Main Building
    // trim's night colour and went dark under the floodlights.
    ambiguous: [...palettes].filter(([, s]) => s.size > 1).map(([k]) => k),
    api: ['initTower', 'applyTowerColors'].filter(k => typeof window[k] === 'function'),
    // Tested by BEHAVIOUR, not by the `__tower` marker this module puts on its
    // wrapper. Six modules wrap window.applyTimeOfDay and each one wraps
    // whatever it found, so the marker is only visible on whichever wrapped
    // LAST — this assertion passed or failed depending on module load order,
    // which is a property of the other five passes, not of this one. Driving
    // the global and watching this layer's paint change tests the thing that
    // actually matters.
    todHooked: (() => {
      try {
        window.applyTimeOfDay(m, 0.10, true);
        const day = JSON.stringify(m.getPaintProperty('tower-solid', 'fill-extrusion-color'));
        window.applyTimeOfDay(m, 0.95, true);
        const night = JSON.stringify(m.getPaintProperty('tower-solid', 'fill-extrusion-color'));
        window.applyTimeOfDay(m, 0.12, true);
        return day !== night;
      } catch (e) { return false; }
    })(),
    // The pattern layers must NOT have the vertical gradient: nine stacked bands
    // with it on draws a dark seam at every boundary and renders the 1.0 m
    // belfry plinth entirely inside its own gradient.
    grad: ['tower-wall', 'tower-solid', 'tower-detail'].map(id => {
      try { return m.getPaintProperty(id, 'fill-extrusion-vertical-gradient'); } catch (e) { return 'err'; }
    }),
  };
});
ok(reg.src, 'source austin-tower exists');
ok(reg.layers.length === 3, 'all three layers added', reg.layers.join(','));
ok(reg.images.length === reg.wantImages.length,
   'every pattern image the data asks for is registered',
   `${reg.images.length}/${reg.wantImages.length}: ${reg.images.join(',')}`);
ok(reg.ambiguous.length === 0,
   'no pattern id carries two different palettes',
   reg.ambiguous.length ? 'AMBIGUOUS: ' + reg.ambiguous.join(',') : 'all one-to-one');
ok(reg.api.length === 2, 'window.initTower + applyTowerColors exported');
ok(reg.todHooked, 'applyTimeOfDay is wrapped, so colours ride the day/night ramp');
ok(reg.grad.every(g => g === false), 'vertical gradient OFF on every layer', JSON.stringify(reg.grad));

// ── 2. the generic geometry has stopped drawing ─────────────────────
console.log('\nthe old geometry is gone');
const gone = await page.evaluate(async ({ C }) => {
  const m = window.__map;
  const s = JSON.stringify;
  m.jumpTo({ center: C, zoom: 16.5, pitch: 0, bearing: 0 });
  await new Promise(r => { if (m.loaded()) r(); else m.once('idle', r); setTimeout(r, 12000); });
  const inFilter = (id, needle) => { try { return s(m.getFilter(id) || '').includes(needle); } catch (e) { return false; } };
  // Count the two superseded parts in the DOCUMENT, over HTTP, not through
  // querySourceFeatures — which answers only for tiles the renderer currently
  // holds and came back 0 from two different camera poses, reading as "the
  // colour match has stopped identifying anything" when nothing was wrong. The
  // claim worth testing is about the data the filter keys on, and that is a
  // property of the file.
  let parts = -1;
  try {
    const date = (document.getElementById('date-select') || {}).value || '2026-07-30';
    const pj = await (await fetch(`data/snapshots/${date}/parts.detailed.geojson`)).json();
    parts = pj.features.filter(f => f.properties.wd === '#e5dbc2').length;
  } catch (e) {}
  return {
    partsInSource: parts,
    partsFiltered: inFilter('parts-3d', '#e5dbc2') && inFilter('parts-roof', '#e5dbc2'),
    buildingFiltered: inFilter('buildings-3d', 'a0af80df-5ca8-4408-ba74-2817533dae1a'),
  };
}, { C });
ok(gone.partsFiltered, 'parts-3d and parts-roof exclude the two superseded OSM parts');
ok(gone.buildingFiltered, 'buildings-3d excludes the replaced footprint id');
// The colour this pass filters on must still identify exactly the two parts it
// was chosen for. If a future snapshot recolours them, or gives that hex to a
// third part, the filter above keeps passing while silently matching the wrong
// thing — and this is the only line that would notice.
ok(gone.partsInSource === 2,
   'exactly two parts in the snapshot carry the wall colour the filter keys on',
   `${gone.partsInSource} found`);

// ── 3. night, on the REAL scene ─────────────────────────────────────
// Done before the isolation pass, and deliberately NOT isolated: the claim
// being tested is that the floodlit tower is the brightest object in a night
// frame of the city, which is only meaningful with the city in it.
console.log('\nnight (pixels, full scene)');
const night = await page.evaluate(async ({ C }) => {
  const m = window.__map;
  m.jumpTo({ center: C, zoom: 17.3, pitch: 60, bearing: 4 });
  window.applyTimeOfDay(m, 0.95, true);
  await new Promise(r => { if (m.loaded()) r(); else m.once('idle', r); setTimeout(r, 12000); });
  const cv = m.getCanvas();
  const gl = cv.getContext('webgl2') || cv.getContext('webgl');
  const W = cv.width, H = cv.height;
  const buf = new Uint8Array(W * H * 4);
  const sample = () => {
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    let orange = 0, bright = 0, maxL = 0, sumL = 0;
    for (let i = 0; i < buf.length; i += 4) {
      const r = buf[i], g = buf[i + 1], b = buf[i + 2];
      const L = 0.3 * r + 0.59 * g + 0.11 * b;
      if (r > 55 && r > b * 1.7 && r > g * 1.35) orange++;
      // BRIGHT, not bright-and-warm. The numeral cells are 1.4 x 2.2 m each and
      // the post-process blooms them toward neutral white, so a `r > b * 1.2`
      // test counted 19 of them in a frame where the numeral is plainly legible.
      // What is being claimed here is legibility, and that is luma.
      if (L > 150) bright++;
      maxL = Math.max(maxL, L); sumL += L;
    }
    return { orange, bright, maxL: Math.round(maxL),
             meanL: Math.round(sumL / (W * H)), px: W * H };
  };
  // Read TWICE and trust the second. Repainting the atlas for a new hour does
  // not land in the same frame as applyTimeOfDay, and it does not always land
  // within one settle either: one run of this test sampled a fully DAYLIT frame
  // at p=0.95 and reported 1 orange pixel and 11,311 bright-warm ones, which
  // reads as "the night state is broken" rather than "the harness was early".
  await new Promise(r => setTimeout(r, 5000));
  m.triggerRepaint();
  await new Promise(r => setTimeout(r, 1500));
  sample();
  m.triggerRepaint();
  await new Promise(r => setTimeout(r, 1500));
  return sample();
}, { C });
// Assert the frame IS night before asserting anything about it, so an early
// sample fails on the right line instead of quietly inverting the other two.
ok(night.meanL < 60, 'the sampled frame is actually a night frame',
   `mean luma ${night.meanL}`);
ok(night.orange > 1500, 'the tower reads as floodlit orange at night',
   `${night.orange} orange px`);
ok(night.bright > 150, 'the lit numeral reads as light, not as tinted stone',
   `${night.bright} px over luma 150, peak ${night.maxL}, scene mean ${night.meanL}`);

// ── 4. the silhouette: the setbacks are the whole point ─────────────
// Everything else hidden, and the tower painted a KEY COLOUR rather than left
// in its own limestone — "to test WHERE something is, paint it magenta and take
// one render" (scripts/verify/README.md). The first version of this test keyed
// on "not sky" instead, and with every other layer hidden the basemap's tan
// `background` is not sky either: it reported the shaft as 1440 px wide, i.e.
// the whole viewport, and read as a broken renderer rather than a broken test.
console.log('\nsilhouette (isolated, key-coloured render)');
const prof = await page.evaluate(async ({ C }) => {
  const m = window.__map;
  if (!m.getLayer('tower-key')) {
    m.addLayer({
      id: 'tower-key', type: 'fill-extrusion', source: 'austin-tower',
      paint: {
        'fill-extrusion-color': '#ff00ff',
        'fill-extrusion-height': ['get', 'h'],
        'fill-extrusion-base': ['get', 'base'],
        'fill-extrusion-opacity': 1.0,
        'fill-extrusion-vertical-gradient': false,
      },
    });
  }
  for (const l of m.getStyle().layers) {
    try { m.setLayoutProperty(l.id, 'visibility', l.id === 'tower-key' ? 'visible' : 'none'); } catch (e) {}
  }
  m.jumpTo({ center: C, zoom: 17.3, pitch: 60, bearing: 4 });
  window.applyTimeOfDay(m, 0.12, true);
  await new Promise(r => { if (m.loaded()) r(); else m.once('idle', r); setTimeout(r, 12000); });
  await new Promise(r => setTimeout(r, 2500));
  m.triggerRepaint();
  await new Promise(r => setTimeout(r, 900));

  const cv = m.getCanvas();
  const gl = cv.getContext('webgl2') || cv.getContext('webgl');
  const W = cv.width, H = cv.height;
  const buf = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  // readPixels is bottom-up. Do the reduction IN the page — handing a 1440x900
  // framebuffer back through CDP once ran for twenty minutes at 2 GB of RSS.
  const rows = [];
  for (let y = 0; y < H; y++) {
    const sy = H - 1 - y;              // top-down
    let lo = -1, hi = -1, n = 0;
    for (let x = 0; x < W; x++) {
      const i = (sy * W + x) * 4;
      // Post-processing shifts the key a little, so this is "strongly magenta"
      // rather than an exact match.
      if (buf[i] > 120 && buf[i + 2] > 120 && buf[i + 1] < buf[i] * 0.65) {
        if (lo < 0) lo = x; hi = x; n++;
      }
    }
    rows.push([lo, hi, n]);
  }
  return { W, H, rows };
}, { C });

const runs = prof.rows.map(r => (r[0] < 0 ? 0 : r[1] - r[0] + 1));
const top = runs.findIndex(w => w > 3);
const shaftW = (() => {
  // the plain shaft: sample a band well below the cornice and above the roofs
  const start = top + Math.round((prof.H - top) * 0.30);
  const seg = runs.slice(start, start + 60).filter(w => w > 3).sort((a, b) => a - b);
  return seg.length ? seg[Math.floor(seg.length / 2)] : 0;
})();
const capW = (() => {
  const seg = runs.slice(top + 2, top + 12).filter(w => w > 3).sort((a, b) => a - b);
  return seg.length ? seg[Math.floor(seg.length / 2)] : 0;
})();
const belfryW = (() => {
  const seg = runs.slice(top + 20, top + 45).filter(w => w > 3).sort((a, b) => a - b);
  return seg.length ? seg[Math.floor(seg.length / 2)] : 0;
})();

// Count the distinct width plateaus between the cap and the shaft. A single
// prism gives none; the Tower should give three — cap -> belfry, belfry ->
// clock stage, clock stage -> cornice.
//
// The window is anchored to the geometry, not to a guessed fraction of the
// frame: scan down from the first tower row until the silhouette first reaches
// the shaft's own width. Keying it to "the top 32% of what is below `top`" the
// first time round measured 32% of the whole viewport — most of which is the
// ground under the building — and stopped before the cornice.
// Both ends of the window are known in METRES, so convert once and use them.
// Two earlier attempts got this wrong in ways worth recording: "the top 32% of
// the frame below `top`" measured 32% of the viewport, most of which is ground;
// and "down to the first row as wide as the shaft" stopped at the CORNICE,
// which is 2.6% wider than the shaft and therefore satisfies that test one band
// early — silently discarding the clock-stage -> cornice step and reporting 2
// where the building has 3.
const PX_PER_M = shaftW / 22.56;          // the shaft's 22.56 m, from OSM
const CROWN_M = 94.0 - 66.3;              // the crown, from the bake
const shaftRow = Math.min(prof.H, top + Math.round(CROWN_M * PX_PER_M * 1.05));
//
// Compare PLATEAU medians, not adjacent rows. Row-to-row differencing counted
// only 2 of the 3 steps: a setback is spread over several scanlines by
// antialiasing and by the cornice that projects at it, so each individual row
// grows by 1-2 px and only the belfry -> clock stage jump is abrupt enough to
// clear any sensible per-row threshold. Ten-row blocks put each band in its
// own bucket and the steps between them become obvious.
const BLK = 10;
const blocks = [];
for (let i = top; i <= shaftRow - BLK; i += BLK) {
  const seg = runs.slice(i, i + BLK).filter(w => w > 3).sort((a, b) => a - b);
  if (seg.length >= BLK / 2) blocks.push(seg[Math.floor(seg.length / 2)]);
}
let steps = 0;
for (let i = 1; i < blocks.length; i++) {
  if (blocks[i] - blocks[i - 1] > Math.max(3, blocks[i - 1] * 0.06)) steps++;
}
console.log('  ..   silhouette width profile, crown to shaft (px):', blocks.join(' '));
ok(shaftW > 30, 'the tower renders at all', `shaft ${shaftW} px wide`);
// TWO, not three, and the third one's absence is a real finding rather than a
// slack threshold. The measured profile is
//   76 80 81 82 | 95 99 … 117 | 165 170 … 189
// — cap, belfry, clock stage — with two abrupt setbacks between them. The
// fourth band, the bracketed cornice, projects 0.3 m past the clock stage; at
// ~0.12 m per pixel that is under three pixels, and it is swamped by the
// perspective growth WITHIN each band (the clock stage alone ramps 165 -> 189
// simply because its lower edge is nearer the camera). So the cornice is real
// geometry that does not survive as a silhouette step from a flying camera,
// which is the same conclusion docs/PASS_TOWER.md reaches about it.
ok(steps >= 2, 'the silhouette steps OUT at least twice below the cap',
   `${steps} abrupt widenings — a single prism would give 0`);
ok(blocks.length > 4 && blocks[blocks.length - 1] / blocks[0] > 1.8,
   'the crown is far narrower than the shaft it sits on',
   `shaft/cap = ${(blocks[blocks.length - 1] / blocks[0]).toFixed(2)}x — a single prism would give 1.00`);
// Ratios from the bake: belfry 0.491, cap 0.449 of the shaft. Perspective at
// pitch 60 makes the higher, nearer-to-camera bands read a little wide, so the
// tolerance is generous; the point is that they are roughly HALF, not equal.
near(belfryW / shaftW, 0.49, 0.13, 'belfry width / shaft width');
near(capW / shaftW, 0.45, 0.16, 'cap width / shaft width');

console.log('\npage errors:', errs.length ? errs.slice(0, 5) : 'none');
console.log(`\n${pass} passed, ${fail} failed`);
await browser.__done();
process.exit(fail ? 1 : 0);
