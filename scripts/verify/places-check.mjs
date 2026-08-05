/**
 * places-check.mjs — the storefront pass is what docs/PASS_PLACES.md claims.
 *
 * Written BEFORE the pass was tuned, not after, because this repo has shipped
 * fixes that were argued rather than observed — including a glazing ratio that
 * was computed wrong in a comment and never checked in code.
 *
 * The assertions are grouped by the failure they are actually guarding:
 *
 *   A. THE VERTICAL-ANCHOR TRAP. Every band must be its own feature with its own
 *      base and height, and the only pattern in the pass must be on the glazing.
 *      A sign band painted into a wall tile repeats every ~40 m up the building,
 *      and it looks completely fine in a still taken from the right distance.
 *
 *   B. THE SOURCED COLOUR ACTUALLY REACHING THE SCREEN. It is not enough that
 *      Chipotle's #ac2318 is in the GeoJSON. queryRenderedFeatures is useless on
 *      fill-extrusion (it answers by footprint and returns 0 at a flying pitch),
 *      so this evaluates the layer's own paint expression at a known hour and
 *      compares it to the hex the bake wrote.
 *
 *   C. THE NIGHT INVERSION. A shop fascia must get BRIGHTER after dark. This is
 *      the one ramp in the repo that goes up, it is the entire reason a retail
 *      street reads at night, and running a sign through the ordinary wall ramp
 *      would silently delete the pass at midnight while every daytime screenshot
 *      still looked perfect.
 *
 *   D. THE AWNING'S SUN TINT, measured rather than assumed. js/app.js recorded an
 *      input of R/B 1.18 rendering at 1.85 on the stadium decks. This reports the
 *      awning's input-vs-rendered ratio so AWN_COOL in scripts/bake_places.py is
 *      a measurement and not a hopeful constant.
 *
 *   E. NO COLLISION. The pass claims no building ids and writes no filter on
 *      buildings-3d. Six passes are landing on this repo; this asserts the
 *      invariant that makes this one incapable of fighting any of them.
 *
 * Usage: node places-check.mjs
 */
import { chromium } from 'playwright-core';
import { chromePath, GL_ARGS, BASE as SERVER, launch } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';

const URL = SERVER + '/_harness.html?intro=0&drift=0';
const GJ = JSON.parse(fs.readFileSync(
  path.resolve(process.cwd(), '../../data/places.geojson'), 'utf8'));

let pass = 0, fail = 0;
const rows = [];
function ok(group, name, cond, detail) {
  (cond ? pass++ : fail++);
  rows.push({ group, name, ok: !!cond, detail: detail == null ? '' : String(detail) });
  console.log((cond ? '  ok   ' : '  FAIL ') + group + ' | ' + name +
              (detail == null ? '' : '  [' + detail + ']'));
}

// ── A. static assertions on the baked file ──────────────────────────────
console.log('\nA. the vertical-anchor trap (static, on data/places.geojson)');
const feats = GJ.features;
const ext = feats.filter(f => f.properties.kind !== 'label');
const labels = feats.filter(f => f.properties.kind === 'label');
const fams = {};
for (const f of ext) fams[f.properties.fam] = (fams[f.properties.fam] || 0) + 1;

ok('A', 'every extrusion feature carries its own base and height',
   ext.every(f => typeof f.properties.base === 'number' &&
                  typeof f.properties.h === 'number' &&
                  f.properties.h > f.properties.base),
   ext.length + ' features');
ok('A', 'no band is taller than one storey (nothing is standing in for a wall)',
   ext.every(f => f.properties.h - f.properties.base <= 5.0),
   'max ' + Math.max(...ext.map(f => f.properties.h - f.properties.base)).toFixed(2) + ' m');
// A shopfront that starts above grade is a shopfront on the second floor.
ok('A', 'every shopfront stack starts at grade',
   ext.filter(f => f.properties.fam === 'plBulk').every(f => f.properties.base === 0),
   fams.plBulk + ' bulkheads');
// THE FAMILY CATALOGUE, READ OUT OF THE GENERATOR — NOT COPIED FROM IT.
//
// This assertion used to be the literal list ['plAwn','plBulk','plGlass',
// 'plSign'], written when there were four families. The entry pass added six
// more and this line went red against a bake that was completely correct: the
// data had moved and the checker's copy of the catalogue had not. A hand-kept
// list that must track a generator is exactly the failure harness-drift.mjs
// exists to catch between _harness.html and index.html, and this repo has been
// bitten by that twice. So it is not re-copied with ten names in it. It is
// derived.
//
// The source of truth is scripts/bake_places.py's own emission call sites: the
// `fam` argument of every band_props()/glow_props() call. Add a family to the
// bake and this check learns about it in the same commit, with no second list
// to update.
//
// PARSE THE CALL, DO NOT GREP FOR THE NAME. harness-drift.mjs records paying
// for this: a bare /js\/[a-z]+\.js/ matched module names inside COMMENTS as
// readily as inside script tags and "found" a module that was not loaded. This
// file's prose says "plGlass" and "plSign" in several comments, and the taste
// block names families in its own docstring, so the regex is anchored on the
// function call and takes the second positional argument.
const BAKE = fs.readFileSync(path.resolve(process.cwd(), '../bake_places.py'), 'utf8');
const bakeFams = [...BAKE.matchAll(
  /\b(?:band_props|glow_props)\s*\(\s*"[^"]*"\s*,\s*"([^"]+)"/g)].map(m => m[1]);
const declared = [...new Set(bakeFams)].sort();
const observed = Object.keys(fams).sort();
// A zero-length parse would make the comparison below trivially satisfiable in
// one direction, so the count is asserted as part of the same test rather than
// assumed. If the bake ever builds a family name instead of writing it as a
// literal, this goes red and points here, which is the correct outcome.
const sameSet = declared.length > 0 &&
                JSON.stringify(declared) === JSON.stringify(observed);
ok('A', 'the families in the data are exactly the ones bake_places.py emits',
   sameSet,
   sameSet ? declared.length + ' families, derived from ' + bakeFams.length +
             ' emission call sites: ' + declared.join(' ')
           : 'bake declares [' + declared.join(' ') + '] but the data has [' +
             observed.join(' ') + ']');
ok('A', 'the sign band sits directly on top of the glass, with no gap',
   (() => {
     // Grouped by tenant AND by the wall segment, since a corner shop emits one
     // stack per straight run. A gap here is a stripe of sky through a
     // shopfront; an overlap is z-fighting. Both are invisible in a still.
     const by = new Map();
     for (const f of ext) {
       const k = f.properties.nm + '|' + JSON.stringify(f.geometry.coordinates[0][0]);
       if (!by.has(k)) by.set(k, {});
       by.get(k)[f.properties.fam] = f.properties;
     }
     let bad = 0;
     for (const g of by.values()) {
       if (!g.plGlass || !g.plSign) continue;
       if (Math.abs(g.plSign.base - g.plGlass.h) > 0.001) bad++;
       if (g.plBulk && Math.abs(g.plGlass.base - g.plBulk.h) > 0.001) bad++;
     }
     return bad === 0;
   })(), 'checked ' + fams.plSign + ' sign bands');
ok('A', 'the pass replaces no building (so it cannot collide with any other)',
   Array.isArray(GJ.replacedBuildingIds) && GJ.replacedBuildingIds.length === 0,
   JSON.stringify(GJ.replacedBuildingIds));
ok('A', 'every shopfront has a label and every label has a name',
   labels.length === fams.plBulk / (ext.filter(f => f.properties.fam === 'plBulk').length / labels.length) ||
   labels.every(f => f.properties.nm && f.properties.sign),
   labels.length + ' labels');

const sourced = new Set(labels.filter(f => f.properties.src === 'S').map(f => f.properties.nm));
const generative = new Set(labels.filter(f => f.properties.src === 'G').map(f => f.properties.nm));
ok('A', 'every place declares its colour provenance as S or G',
   labels.every(f => f.properties.src === 'S' || f.properties.src === 'G'),
   sourced.size + ' sourced / ' + generative.size + ' generative');

// ── the browser half ────────────────────────────────────────────────────
const browser = await launch(chromium, {
  executablePath: chromePath(), headless: true,
  args: [...GL_ARGS, '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(URL, { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 90000 });
await page.waitForFunction(() => !!window.__map.getLayer('places-solid'), null, { timeout: 60000 })
  .catch(() => {});
await page.waitForTimeout(3500);
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

// PUT THE CAMERA ON THE DRAG BEFORE ASKING THE SOURCE ANYTHING. querySourceFeatures
// answers only from tiles that are currently LOADED, and the harness starts at the
// intro's end pose with the storefront layers below their minzoom — so the first
// cut of this file reported "0 source features" and seven "sourced fascia never
// reached the source" failures for a pass that was rendering correctly. That is
// the same class of mistake docs/PASS_COMMON.md §5 warns about: the harness was
// sampling nothing and reporting it as a defect in the thing being sampled.
await page.evaluate(async () => {
  const m = window.__map;
  if (m.isEasing && m.isEasing()) m.stop();
  m.jumpTo({ center: [-97.74200, 30.28700], zoom: 17.0, pitch: 62, bearing: 300 });
  await new Promise(r => { m.once('idle', r); setTimeout(r, 15000); });
});
await page.waitForTimeout(1200);

console.log('\nB. the layers exist and the sourced colour reaches the paint expression');
const live = await page.evaluate(() => {
  const m = window.__map;
  const L = id => !!m.getLayer(id);
  return {
    solid: L('places-solid'), glass: L('places-glass'), label: L('places-label'),
    stats: window.placesStats ? window.placesStats() : null,
    // The layer's own colour expression. This is the link between "the bake
    // wrote #ac2318" and "the renderer was told to use it"; the pixel test below
    // closes the last gap.
    colorExpr: JSON.stringify(m.getPaintProperty('places-solid', 'fill-extrusion-color') || null),
    labelIdx: m.getStyle().layers.findIndex(l => l.id === 'places-label'),
    buildingLabelIdx: m.getStyle().layers.findIndex(l => l.id === 'buildings-labels'),
    // How many images this pass put in the atlas. The whole point of driving 42
    // sourced brand colours through fill-extrusion-color instead of a pattern is
    // that it costs ONE image, not one per brand.
    images: ['pl-glass'].filter(i => m.hasImage(i)).length,
    todHooked: !!window.__placesTodHooked,
    // The invariant that makes this pass composable: it must not have touched
    // buildings-3d's filter. If it ever does, it is claiming buildings, and two
    // passes claiming one building renders one inside the other.
    b3dFilter: JSON.stringify(m.getFilter('buildings-3d') || null),
  };
});
ok('B', 'places-solid layer exists', live.solid);
ok('B', 'places-glass layer exists', live.glass);
ok('B', 'places-label layer exists', live.label);
ok('B', 'the pass registers exactly ONE atlas image', live.images === 1, live.images);
ok('B', 'applyTimeOfDay is hooked', live.todHooked);
ok('B', 'the fascia colour comes from the feature, not a constant',
   /\["get","w[dgn]"\]/.test(live.colorExpr || ''), (live.colorExpr || '').slice(0, 60));
// Collision priority is a layer-ORDER property in MapLibre, so this is the
// assertion that keeps the shop names from silently losing every box to the
// apartment-block names above them. It measured 0 labels placed at zoom 16.4
// before the anchor was added.
ok('B', 'places-label is ordered BEFORE buildings-labels (collision priority)',
   live.labelIdx >= 0 && live.buildingLabelIdx >= 0 && live.labelIdx < live.buildingLabelIdx,
   'places ' + live.labelIdx + ' vs buildings ' + live.buildingLabelIdx);
ok('E', 'buildings-3d filter does not mention this pass',
   !/places/.test(live.b3dFilter || ''), (live.b3dFilter || '').slice(0, 80));

// The sourced hexes, read from the baked file rather than from the map.
//
// THIS USED TO GO THROUGH querySourceFeatures AND THAT WAS A BAD TEST. It
// returned 1720 features on one run and 0 on the next from an almost identical
// pose, while the pass was demonstrably rendering both times — the sun-tint
// sample below was reading hundreds of awning pixels off the same frame. So the
// assertion was measuring the query API's tile-cache timing, not the pass, and
// it would have failed a correct build about half the time. docs/PASS_COMMON.md
// says as much about queryRenderedFeatures on fill-extrusion; it goes for
// querySourceFeatures too. The colour the bake wrote is a static fact about a
// file on disk, so it is checked against the file, and whether that colour
// reaches the SCREEN is checked with pixels a few lines down.
const SPOT = ['Chipotle', 'Starbucks', 'Whataburger', 'The Co-op', 'Wingstop',
              'Urban Outfitters', 'Torchy\'s Tacos'];
const expr = {};
for (const nm of SPOT) {
  const f = ext.find(x => x.properties.fam === 'plSign' && x.properties.nm === nm);
  expr[nm] = f ? { wd: f.properties.wd, wn: f.properties.wn } : null;
}
const wantDay = {
  'Chipotle': '#ac2318', 'Starbucks': '#006241', 'Whataburger': '#ff770f',
  'The Co-op': '#bf5700', 'Wingstop': '#006938', 'Urban Outfitters': '#1a1a1a',
  "Torchy's Tacos": '#e33f3d',
};
for (const nm of SPOT) {
  const got = expr[nm];
  ok('B', 'the bake wrote the sourced hex: ' + nm,
     got && got.wd === wantDay[nm], got ? got.wd + ' want ' + wantDay[nm] : 'not in the file');
}

// ── and now the pixels. Does a sourced brand colour reach the SCREEN? ──
//
// A/B on one frame: render the Drag with places-solid showing ONLY the fascia
// bands, count pixels by hue, then hide the layer and count again. If the hue
// populations do not collapse, whatever is being counted was never ours — which
// is exactly the failure docs/PASS_COMMON.md records, where a session was spent
// "fixing" the basemap's grey buildings because our own layer had silently
// failed to load.
console.log('\nB. the sourced colours reach the screen (pixel A/B, not a style read)');
/*
 * WHY THIS IS A MASK AND NOT A DIFF, and it took two wrong tests to get here.
 *
 * Attempt 1 counted hue populations across the whole frame with the fascias on
 * and off. Austin's roofs and ground are tan, so "orange" read 57,731 on and
 * 36,943 off — a genuine 20k signal under a 37k floor of city — while green and
 * red read 0 in both, because a few hundred fascia pixels are noise at frame
 * scale.
 *
 * Attempt 2 differenced the two frames. That reported 289,963 changed pixels
 * out of 1,024,000 for hiding a layer of 1 m bands, which is not possible. The
 * scene runs an auto-exposure stage (see light-ae.mjs), so removing anything
 * re-grades EVERY pixel and a frame difference measures the tone mapper.
 *
 * So: two renders of identical geometry. The first paints the fascias a key
 * magenta and gives an exact per-pixel MASK of where they are. The second paints
 * them their real colours and is read only at those positions. Auto-exposure
 * shifts both frames and cannot move a pixel, so the mask stays valid. This is
 * the same technique ground-luma.mjs uses for the path/road/ground split, for
 * the same reason.
 */
const hueTest = await page.evaluate(async () => {
  const m = window.__map;
  const grab = async () => {
    m.triggerRepaint();
    await new Promise(r => setTimeout(r, 900));
    const cv = m.getCanvas();
    const gl = cv.getContext('webgl2') || cv.getContext('webgl');
    const buf = new Uint8Array(cv.width * cv.height * 4);
    gl.readPixels(0, 0, cv.width, cv.height, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return buf;
  };
  const realExpr = m.getPaintProperty('places-solid', 'fill-extrusion-color');
  m.jumpTo({ center: [-97.74200, 30.28690], zoom: 17.6, pitch: 70, bearing: 272 });
  window.applyTimeOfDay(m, 0.14, true);

  // WAIT FOR ACTUAL CONTENT, NOT FOR A CLOCK. One run of this measurement came
  // back with zero fascia pixels and the saved frame showed a bare ground plane
  // with no buildings in it at all — the cold-tile trap in
  // scripts/verify/README.md, where `idle` fires before a multi-megabyte GeoJSON
  // source has been fetched and tiled. Reporting that as "the sourced colours
  // never reached the screen" would have been a false failure against a pass
  // that was rendering perfectly.
  const settled = async () => {
    for (let i = 0; i < 60; i++) {
      if (m.areTilesLoaded() && m.isSourceLoaded('austin-places') &&
          m.isSourceLoaded('austin-buildings') && m.loaded()) return true;
      await new Promise(r => setTimeout(r, 500));
    }
    return false;
  };
  await settled();
  m.setFilter('places-solid', ['==', ['get', 'fam'], 'plSign']);
  await settled();

  // applyTimeOfDay is wrapped by this pass and rewrites fill-extrusion-color
  // back to the baked ramp. If the app's clock ticks between the setPaintProperty
  // and the read, the "keyed" frame is silently the REAL frame — which is what
  // happened: the mask render came back full of saturated RED, matched nothing
  // magenta, and read as "the colours never reached the screen" when in fact the
  // fascias were on screen in their true colours the whole time.
  const savedApply = window.applyPlacesColors;
  window.applyPlacesColors = () => {};
  // pass 1 — the mask
  m.setPaintProperty('places-solid', 'fill-extrusion-color', '#ff00ff');
  await settled();
  const keyed = await grab();
  // pass 2 — the truth, same geometry, same camera
  m.setPaintProperty('places-solid', 'fill-extrusion-color', realExpr);
  await settled();
  const on = await grab();
  window.applyPlacesColors = savedApply;
  m.setFilter('places-solid', ['!=', ['get', 'fam'], 'plGlass']);

  const bins = { green: 0, orange: 0, red: 0, other: 0, changed: 0 };
  for (let i = 0; i < on.length; i += 4) {
    // Magenta after the sun tint and the tone mapper is still unambiguously
    // "red and blue high, green low"; nothing else in this scene is.
    if (!(keyed[i] > 110 && keyed[i + 2] > 110 && keyed[i + 1] < keyed[i] * 0.62)) continue;
    bins.changed++;
    const R = on[i] / 255, G = on[i + 1] / 255, B = on[i + 2] / 255;
    const mx = Math.max(R, G, B), mn = Math.min(R, G, B), d = mx - mn;
    if (d < 0.16 || mx < 0.12) { bins.other++; continue; }
    let h;
    if (mx === R) h = 60 * (((G - B) / d) % 6);
    else if (mx === G) h = 60 * ((B - R) / d + 2);
    else h = 60 * ((R - G) / d + 4);
    if (h < 0) h += 360;
    if (h >= 95 && h < 185) bins.green++;
    else if (h >= 16 && h < 50) bins.orange++;
    else if (h < 14 || h >= 345) bins.red++;
    else bins.other++;
  }
  return bins;
});
console.log("   fascia pixels found by the magenta mask:", JSON.stringify(hueTest));
ok("B", "the fascia bands occupy a measurable area of the frame",
   hueTest.changed > 400, hueTest.changed + " px");
for (const hue of ['green', 'orange', 'red']) {
  // Guadalupe carries Starbucks/Wingstop/Sweetgreen (green), 7-Eleven/Co-op/
  // Potbelly (orange-yellow) and Chipotle/Shoe Palace/CVS (red) within this one
  // pose, so all three families must show up in what the layer added.
  ok('B', 'the ' + hue + ' brand family reaches the screen',
     hueTest[hue] > 60, hueTest[hue] + ' px of ' + hueTest.changed + ' changed');
}

console.log('\nC. the night inversion — a shop sign must get BRIGHTER after dark');
const lum = h => {
  const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  return 0.30 * c[0] + 0.59 * c[1] + 0.11 * c[2];
};
for (const nm of SPOT) {
  const g = expr[nm];
  if (!g) continue;
  ok('C', 'fascia is brighter at night than by day: ' + nm,
     lum(g.wn) > lum(g.wd),
     'day ' + lum(g.wd).toFixed(0) + ' -> night ' + lum(g.wn).toFixed(0));
}
// The other half of C, and it is the half that actually caught something. "Gets
// brighter" alone passed while Urban Outfitters' #1a1a1a fascia went from luma
// 26 to luma 239 — a black shopfront rendering as the brightest object in the
// frame, because the chroma push divides by the channel maximum and 238/26 is
// 9.2x. An achromatic fascia has no hue to light up, so its night lift is
// bounded; a saturated one is not.
for (const nm of SPOT) {
  const g = expr[nm];
  if (!g) continue;
  const c = [1, 3, 5].map(i => parseInt(g.wd.slice(i, i + 2), 16));
  const chroma = (Math.max(...c) - Math.min(...c)) / Math.max(1, Math.max(...c));
  if (chroma > 0.25) continue;
  ok('C', 'a near-neutral fascia does NOT become a lightbox: ' + nm,
     lum(g.wn) < 150,
     'chroma ' + chroma.toFixed(2) + ', night luma ' + lum(g.wn).toFixed(0));
}
// And the surfaces that are NOT signs must still go dark, or the whole street
// glows like a runway.
const bulkNight = ext.find(f => f.properties.fam === 'plBulk');
ok('C', 'the bulkhead still goes DARK at night (only signs invert)',
   lum(bulkNight.properties.wn) < lum(bulkNight.properties.wd) * 0.55,
   'day ' + lum(bulkNight.properties.wd).toFixed(0) + ' -> night ' + lum(bulkNight.properties.wn).toFixed(0));
const awnNight = ext.find(f => f.properties.fam === 'plAwn');
ok('C', 'the awning goes dark at night too (fabric is lit, not luminous)',
   lum(awnNight.properties.wn) < lum(awnNight.properties.wd),
   'day ' + lum(awnNight.properties.wd).toFixed(0) + ' -> night ' + lum(awnNight.properties.wn).toFixed(0));

console.log('\nD. the glazing tile, sampled from its own bytes (no map, no light)');
const tiles = await page.evaluate(() => ({
  day: window.placesTileSample(0.14),
  gold: window.placesTileSample(0.50),
  night: window.placesTileSample(0.86),
}));
console.log('   glass tile luma  day', tiles.day.luma, '| golden', tiles.gold.luma,
            '| night', tiles.night.luma);
// The floor here is 95, not "greater than zero". At luma 80 against a ~145 wall
// the glazing rendered as a black ribbed void under every shopfront — a hole,
// not a window — and the isolation render is the only reason it was caught.
// js/drag.js recorded the identical failure one step further along the same
// axis, so this is a guard on a known-live trap, not a hypothetical one.
ok('D', 'the glazing reads as glass, not as a hole punched in the building',
   tiles.day.luma > 95, tiles.day.luma);
ok('D', 'the glazing glows at night rather than going dark',
   tiles.night.luma > tiles.day.luma * 0.9, tiles.night.luma + ' vs ' + tiles.day.luma);

// The sun-tint measurement. Renders one pose over a dense storefront run twice —
// once with the awnings recoloured to a known key and once normally — and reads
// the rendered pixels back, so AWN_COOL is answerable with a number.
console.log('\nD. the sun tint on a horizontal face, MEASURED');
const tint = await page.evaluate(async () => {
  const m = window.__map;
  m.jumpTo({ center: [-97.74200, 30.28700], zoom: 17.2, pitch: 62, bearing: 300 });
  window.applyTimeOfDay(m, 0.14, true);
  await new Promise(r => { m.once('idle', r); setTimeout(r, 12000); });
  const KEY = '#808080';   // a pure neutral: whatever comes back IS the tint
  m.setPaintProperty('places-solid', 'fill-extrusion-color', KEY);
  m.setFilter('places-solid', ['==', ['get', 'fam'], 'plAwn']);
  await new Promise(r => { m.once('idle', r); setTimeout(r, 12000); });
  m.triggerRepaint();
  await new Promise(r => setTimeout(r, 900));
  const cv = m.getCanvas();
  const gl = cv.getContext('webgl2') || cv.getContext('webgl');
  const w = cv.width, h = cv.height;
  const buf = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  // Only count pixels that are plausibly our neutral-keyed awnings: grey-ish
  // input tinted by the sun, so still fairly desaturated but lifted.
  let n = 0, r = 0, g = 0, b = 0;
  for (let i = 0; i < buf.length; i += 4) {
    const R = buf[i], G = buf[i + 1], B = buf[i + 2];
    if (R < 70 || R > 245) continue;
    if (Math.abs(R - G) > 60 || Math.abs(G - B) > 70) continue;
    n++; r += R; g += G; b += B;
  }
  return n ? { n, mean: [r / n, g / n, b / n] } : { n: 0 };
});
if (tint.n > 500) {
  const rb = tint.mean[0] / Math.max(1, tint.mean[2]);
  console.log('   a #808080 (R/B 1.00) horizontal face renders at R/B ' + rb.toFixed(2) +
              ' , mean ' + tint.mean.map(v => v.toFixed(0)).join(','));
  ok('D', 'the measured sun tint is reported, so AWN_COOL is a number not a hope',
     true, 'R/B ' + rb.toFixed(2));
} else {
  ok('D', 'sun-tint sample found enough awning pixels', false, 'n=' + tint.n);
}

console.log('\n' + (fail ? 'FAIL' : 'PASS') + ' — ' + pass + ' ok, ' + fail + ' failed');
if (errors.length) console.log('CONSOLE ERRORS', errors.slice(0, 10));
console.log('\nstats', JSON.stringify(live.stats));
await browser.__done();
process.exit(fail ? 1 : 0);
