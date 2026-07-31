/**
 * moody-check.mjs — the modern east precinct is what docs/PASS_MOODY.md claims.
 *
 * Assertions are on PIXELS wherever a pixel can answer the question, because
 * this project has repeatedly shipped fixes that were argued rather than
 * observed. Where a style property is checked instead, it is because the
 * property IS the claim (a layer existing, an image being registered).
 *
 * Two of the checks here are measurements rather than assertions, and they
 * exist because the repo's own documentation contradicts itself about them:
 *
 *   SCALE   js/facades.js's header once said `fill-extrusion-pattern` tiles in
 *           world space and "keeps a constant physical size as you fly". It does
 *           not. This counts the window rows on one wall at three zooms and
 *           prints how the pattern's world size actually moves.
 *   ANCHOR  the same file says a pattern has no vertical anchor, while
 *           docs/PASS_COMMON.md says it "repeats from the extrusion base". Those
 *           are different claims and they imply different tile designs. This
 *           swaps in a tile that is white across its bottom eighth and black
 *           everywhere else, and looks at where the white lands on a 27 m band.
 *
 * Usage: node moody-check.mjs
 */
import { chromium } from 'playwright-core';
import { chromePath, BASE as SERVER, launch } from './chrome.mjs';

const MOODY = [-97.730624, 30.280934];
const HDB = [-97.734702, 30.277917];

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra !== undefined ? '   ' + JSON.stringify(extra) : '')); }
};

const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));

await page.goto(SERVER + '/_harness.html?intro=0&drift=0', { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 90000 });
await page.waitForFunction(() => window.__map.getSource('austin-moody'), null, { timeout: 60000 })
  .catch(() => {});
await page.waitForTimeout(4000);
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

// ── 1. wiring ──────────────────────────────────────────────────────
console.log('\nWIRING');
const wiring = await page.evaluate(async () => {
  const m = window.__map;
  const layers = ['moody-wall', 'moody-roof', 'moody-cap', 'moody-plant'].filter(id => m.getLayer(id));
  // Derive the expected image list from the DATA rather than restating it here.
  // A hardcoded list of eight silently became wrong the moment the attic tone
  // was split per building, and a check that has to be edited alongside the
  // thing it checks is not a check.
  //
  // Read it from the FILE, not from querySourceFeatures. The latter only sees
  // features in currently-loaded tiles, and at boot the camera is at the West
  // Campus spawn with the precinct 1.5 km away — so it returned an empty set and
  // the check cheerfully reported "0 tiles, all registered".
  const gj = await (await fetch('data/moody.geojson')).json();
  const want = new Set();
  for (const f of gj.features) {
    if (f.properties.kind === 'wall' && f.properties.tile) want.add(f.properties.tile);
  }
  const wanted = [...want];
  const imgs = wanted.filter(id => m.hasImage(id));
  const missingImgs = wanted.filter(id => !m.hasImage(id));
  const src = m.getSource('austin-moody');
  const counts = {};
  for (const id of layers) {
    try { counts[id] = m.querySourceFeatures('austin-moody', { filter: m.getFilter(id) }).length; }
    catch (e) { counts[id] = -1; }
  }
  // The three replaced ids must no longer pass buildings-3d's filter. Reading
  // the filter is the right test here, NOT queryRenderedFeatures: on a
  // fill-extrusion that answers by FOOTPRINT and it returns 0 at a flying pitch
  // anyway, which cost someone an hour once.
  const f = JSON.stringify(m.getFilter('buildings-3d') || []);
  const ids = ['d8b0698a-4208-4cb3-a233-8be9c247c5ee',
               '866e9c84-7564-4b01-8805-35088be79cd9',
               'f1ca81ce-4c4b-4add-bb77-e63238bbea1c'];
  return { layers, imgs, wanted, missingImgs, hasSrc: !!src, counts,
           excluded: ids.map(i => f.includes(i)),
           audit: window.moodyGridAudit ? window.moodyGridAudit() : null,
           total: m.querySourceFeatures('austin-moody').length };
});
ok(wiring.hasSrc, 'austin-moody source exists');
ok(wiring.layers.length === 4, 'all four layers added', wiring.layers);
ok(wiring.wanted.length > 0 && wiring.missingImgs.length === 0,
   'every tile the data asks for is registered (' + wiring.wanted.length + ')',
   wiring.missingImgs);
ok(wiring.excluded.every(Boolean), 'all three generic extrusions filtered out of buildings-3d', wiring.excluded);
ok(wiring.audit && wiring.audit.ok, 'glazing grid within spec of the measured 19.8%', wiring.audit);
console.log('       grid audit:', JSON.stringify(wiring.audit));

// ── 2. the precinct in isolation ───────────────────────────────────
// Positive identification: hide everything except this pass, so any pixel that
// is not the background belongs to us. queryRenderedFeatures cannot answer
// "which layer owns this pixel" on a fill-extrusion, and guessing from a full
// scene is how a terracotta band was once attributed to the wrong building.
//
// THE BACKGROUND LAYER IS HIDDEN TOO, AND THAT IS THE WHOLE POINT. The first
// version of this file kept it (`|| l.type === 'background'`, copied from
// isolate.mjs, which keeps it for screenshots where you want to SEE something).
// Every measurement then came back with n = 1,023,994 on a 1280x800 canvas —
// the entire frame — and the roof-brightness assertion passed at luma 160.9 by
// measuring the basemap's own fill. It would have passed with this pass deleted.
// That is precisely the failure docs/PASS_COMMON.md records: a session spent
// "fixing" the basemap's grey buildings because our own layer had silently
// failed to load. With no background layer MapLibre clears to transparent, so
// alpha alone identifies our geometry and nothing else can be mistaken for it.
async function isolate(keep) {
  await page.evaluate((keep) => {
    const m = window.__map;
    Object.assign(window.GFX, { bloom: 0, godRays: 0, flare: 0, dof: 0, grain: 0, vignette: 0 });
    window.applyGraphics();
    for (const l of m.getStyle().layers) {
      const on = keep.some(k => l.id.startsWith(k));
      try { m.setLayoutProperty(l.id, 'visibility', on ? 'visible' : 'none'); } catch (e) {}
    }
  }, keep);
}

// WAIT FOR THE GEOMETRY, not for m.loaded(). m.loaded() can return true in the
// gap between a jumpTo and the tile requests it triggers, and an under-settled
// frame does not fail loudly — it quietly measures a fraction of the building.
// That is not hypothetical here: the Moody roof measured 17,358 px and mean
// luma 208.2 on one run and 143,149 px at 142.6 on the next, from the same code
// and the same pose, because the first run sampled a bright sliver of a roof
// that had not finished arriving. The 208.2 was written into a doc before the
// second run caught it.
async function settle(pose, p) {
  await page.evaluate(([pose, p]) => {
    const m = window.__map;
    if (m.isEasing && m.isEasing()) m.stop();
    m.jumpTo(pose);
    if (typeof p === 'number') window.applyTimeOfDay(m, p, true);
  }, [pose, p]);
  await page.waitForTimeout(2500);
  await page.evaluate(async () => {
    const m = window.__map;
    const t0 = performance.now();
    while (performance.now() - t0 < 40000) {
      try { if (m.areTilesLoaded() && m.querySourceFeatures('austin-moody').length >= 10) break; }
      catch (e) {}
      await new Promise(r => setTimeout(r, 400));
    }
  });
  await page.evaluate(() => window.__map.triggerRepaint());
  await page.waitForTimeout(1200);
}

/** Reduce the framebuffer IN THE PAGE. Handing 4M numbers back through CDP once
 *  ran for twenty minutes at 2 GB of RSS before it was killed.
 *  Counts only OPAQUE pixels, which after isolate() means only our geometry. */
async function lumaStats() {
  return page.evaluate(() => {
    const cv = window.__map.getCanvas();
    const gl = cv.getContext('webgl2') || cv.getContext('webgl');
    const w = cv.width, h = cv.height;
    const buf = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    let n = 0, sum = 0, max = 0, bright = 0;
    for (let i = 0; i < buf.length; i += 4) {
      if (buf[i + 3] < 128) continue;
      const l = 0.30 * buf[i] + 0.59 * buf[i + 1] + 0.11 * buf[i + 2];
      n++; sum += l; if (l > max) max = l;
      if (l > 190) bright++;
    }
    return { n, mean: n ? sum / n : 0, max, brightShare: n ? bright / n : 0,
             coverage: n / (w * h), w, h };
  });
}

console.log('\nMOODY ROOF vs MOODY WALL');
// The assertion here is RELATIVE, and that is the point. An absolute luma
// threshold on the roof was the first version, and it encoded a claim that
// turned out to be false — that this pass rescues a dark roof. It does not; the
// roof was already pale before the pass touched it (see docs/PASS_MOODY.md
// §4a). What the pass genuinely owes is that the membrane and apron read as a
// bright cap against a dark bronze wall, and a ratio says that without also
// depending on the scene's exposure, the hour, or the post-process stack.
await isolate(['moody-']);
await settle({ center: MOODY, zoom: 16.4, pitch: 55, bearing: 210 }, 0.25);

async function onlyLayers(show, hide) {
  await page.evaluate(([show, hide]) => {
    const m = window.__map;
    for (const id of hide) { try { m.setLayoutProperty(id, 'visibility', 'none'); } catch (e) {} }
    for (const id of show) { try { m.setLayoutProperty(id, 'visibility', 'visible'); } catch (e) {} }
  }, [show, hide]);
  await page.evaluate(() => window.__map.triggerRepaint());
  await page.waitForTimeout(1400);
  return lumaStats();
}

const roof = await onlyLayers(['moody-roof', 'moody-cap'], ['moody-wall', 'moody-plant']);
const wall = await onlyLayers(['moody-wall'], ['moody-roof', 'moody-cap', 'moody-plant']);
await onlyLayers(['moody-wall', 'moody-roof', 'moody-cap', 'moody-plant'], []);

console.log('       roof planes: ' + roof.n + ' px (' + (roof.coverage * 100).toFixed(1) +
            '% of frame), mean luma ' + roof.mean.toFixed(1));
console.log('       wall bands : ' + wall.n + ' px (' + (wall.coverage * 100).toFixed(1) +
            '% of frame), mean luma ' + wall.mean.toFixed(1));
ok(roof.n > 3000 && wall.n > 3000, 'both roof and wall cover a meaningful area',
   { roof: roof.n, wall: wall.n });
// A COVERAGE CEILING, not decoration. This is the guard on the bug that made
// every assertion in the first run of this file meaningless: if the sample ever
// approaches the whole frame, something other than our geometry is being
// measured and every number beside it is about that something.
ok(roof.coverage < 0.45 && wall.coverage < 0.45,
   'the samples are our geometry and not the whole frame',
   { roof: +(roof.coverage * 100).toFixed(1), wall: +(wall.coverage * 100).toFixed(1) });
// WHAT THIS ASSERTS, AND WHY IT IS NOT THE OBVIOUS THING.
//
// The obvious assertion is roof > wall by a wide margin: the roof planes go in
// at luma ~220 and the bronze fascia at 68, a 3.3x difference. Measured from a
// 55-degree pitch they come out at 142.5 and 136.4 — a ratio of 1.05. That is
// not a harness artifact and it is not tuned away here: at this pitch almost all
// of BOTH samples is TOP FACES, and this renderer lifts a dark top face and
// pulls down a bright one until they very nearly meet. So the intended dark rim
// around a pale roof does not read from directly above, and that limitation is
// written down in docs/PASS_MOODY.md rather than papered over with a threshold
// chosen to pass. What the pass does still owe is that the roof is not DARKER
// than the wall it caps, which is the minimum for the step to read at all.
const ratio = roof.mean / Math.max(wall.mean, 1);
console.log('       roof/wall luma ratio ' + ratio.toFixed(2) +
            '  (inputs differ 3.3x; top faces compress it — see PASS_MOODY.md §5)');
ok(ratio >= 1.0, 'the roof is not darker than the wall it caps',
   { roof: +roof.mean.toFixed(1), wall: +wall.mean.toFixed(1), ratio: +ratio.toFixed(2) });

// ── 3. the bands actually read as bands ────────────────────────────
// Stacked geometry is the whole technique of this pass. If the bands do not
// produce distinct values on the wall then the extra features bought nothing
// and a single extrusion would have done.
console.log('\nSTACKED BANDS');
await settle({ center: [HDB[0], HDB[1] - 0.0011], zoom: 17.0, pitch: 72, bearing: 2 }, 0.25);
const bands = await page.evaluate(() => {
  const cv = window.__map.getCanvas();
  const gl = cv.getContext('webgl2') || cv.getContext('webgl');
  const w = cv.width, h = cv.height;
  const buf = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  // Mean luma per screen row over the middle third of the frame, bottom-up
  // (readPixels row 0 is the bottom). A banded wall shows as steps in this.
  const x0 = (w / 3) | 0, x1 = ((2 * w) / 3) | 0;
  const rows = [];
  for (let y = 0; y < h; y++) {
    let n = 0, s = 0;
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4;
      if (buf[i + 3] < 128) continue;          // transparent = not our geometry
      n++; s += 0.30 * buf[i] + 0.59 * buf[i + 1] + 0.11 * buf[i + 2];
    }
    if (n > (x1 - x0) * 0.25) rows.push({ y, l: s / n });
  }
  if (rows.length < 40) return { rows: rows.length, levels: 0, spread: 0 };
  // Distinct levels = how many 12-luma buckets the wall occupies. A single
  // untextured extrusion lands in one or two; a banded one in several.
  const seen = new Set();
  for (const r of rows) seen.add(Math.round(r.l / 12));
  const ls = rows.map(r => r.l).sort((a, b) => a - b);
  return { rows: rows.length, levels: seen.size,
           spread: ls[ls.length - 1] - ls[0],
           p10: ls[(ls.length * 0.1) | 0], p90: ls[(ls.length * 0.9) | 0] };
});
// Node's console.log does NOT understand a precision specifier: '%.1f' is left
// as literal text and every later argument shifts into the wrong slot. The first
// run of this file printed "mean luma %.1f, max %.1f 160.9 163.2" for exactly
// that reason, and the README already records the same bug producing an A/B
// table that claimed a layer was hidden in the run that had just switched it on.
// Concatenate with toFixed instead.
console.log('       ' + bands.rows + ' wall rows, ' + bands.levels +
            ' distinct luma levels, p10 ' + (bands.p10 || 0).toFixed(0) +
            ' -> p90 ' + (bands.p90 || 0).toFixed(0));
ok(bands.rows > 40, 'the Dell Med wall fills enough of the frame to judge', bands.rows);
ok(bands.levels >= 3, 'the wall shows at least three distinct value bands', bands);
ok((bands.p90 - bands.p10) > 25, 'podium-to-attic value range is visible from the air',
   { p10: bands.p10, p90: bands.p90 });

// ── 4. SCALE. Measured, not taken from any doc in this repo. ───────
console.log('\nPATTERN SCALE — rows of windows down one wall, at three zooms');
console.log('  zoom   rowCycles   metresPerTile(implied)');
const scale = [];
for (const z of [15.6, 16.6, 17.6]) {
  await settle({ center: [HDB[0], HDB[1] - 0.0011 * Math.pow(2, 16.6 - z)], zoom: z, pitch: 72, bearing: 2 }, 0.25);
  const r = await page.evaluate(() => {
    const cv = window.__map.getCanvas();
    const gl = cv.getContext('webgl2') || cv.getContext('webgl');
    const w = cv.width, h = cv.height;
    const buf = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    // One column through the middle of the wall; count luma zero-crossings
    // about a running mean. Each window row is one cycle.
    const x = (w / 2) | 0;
    const col = [];
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 4;
      if (buf[i + 3] < 128) { col.push(null); continue; }
      col.push(0.30 * buf[i] + 0.59 * buf[i + 1] + 0.11 * buf[i + 2]);
    }
    const vals = col.filter(v => v !== null);
    if (vals.length < 30) return { cycles: 0, px: vals.length };
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    let cross = 0, prev = null;
    for (const v of vals) {
      const s = v > mean + 2 ? 1 : (v < mean - 2 ? -1 : 0);
      if (s === 0) continue;
      if (prev !== null && s !== prev) cross++;
      prev = s;
    }
    return { cycles: cross / 2, px: vals.length };
  });
  scale.push({ z, ...r });
  console.log('  ' + z.toFixed(1) + String(r.cycles).padStart(11) +
              '   ' + String(r.px).padStart(4) + ' px of wall in the column' +
              (r.cycles ? '' : '   <- no wall found'));
}
// Tile-locked means the world size of one repeat HALVES per zoom out, so the
// number of window rows on a fixed piece of wall roughly halves per zoom in.
// World-locked would hold it constant. Report the ratio and let it speak.
const nz = scale.filter(s => s.cycles > 0);
if (nz.length >= 2) {
  const lo = nz[0], hi = nz[nz.length - 1];
  console.log('       z' + lo.z.toFixed(1) + ' -> z' + hi.z.toFixed(1) + ' : ' +
              lo.cycles.toFixed(1) + ' -> ' + hi.cycles.toFixed(1) + ' cycles on the ' +
              'same wall (ratio ' + (hi.cycles / lo.cycles).toFixed(2) + ').');
  console.log('       WORLD-locked would predict 1.00; TILE-locked would predict ' +
              Math.pow(2, hi.z - lo.z).toFixed(2) + '. Anything above 1 means the ' +
              'pattern is NOT world-locked, so a tile sized for one zoom is wrong ' +
              'at every other one.');
}
ok(nz.length >= 2, 'the scale probe found wall at more than one zoom', scale);

// ── 5. ANCHOR. The claim the two docs disagree on. ────────────────
console.log('\nPATTERN VERTICAL ANCHOR — where does the tile start on a band?');
const anchor = await page.evaluate(() => {
  const m = window.__map;
  // A tile that is white across its bottom eighth and black elsewhere. If the
  // pattern is anchored to the extrusion base there is exactly ONE white stripe
  // per band, at its foot. If it simply repeats, there are several, evenly.
  const T = 64, d = new Uint8Array(T * T * 4);
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const i = (y * T + x) * 4;
      const white = y >= T - 8;
      d[i] = d[i + 1] = d[i + 2] = white ? 255 : 0;
      d[i + 3] = 255;
    }
  }
  try { m.updateImage('health-body-grey', { width: T, height: T, data: d }); }
  catch (e) { return { error: String(e) }; }
  return { installed: true };
});
if (anchor.installed) {
  await page.evaluate(() => window.__map.triggerRepaint());
  await page.waitForTimeout(1500);
  const stripes = await page.evaluate(() => {
    const cv = window.__map.getCanvas();
    const gl = cv.getContext('webgl2') || cv.getContext('webgl');
    const w = cv.width, h = cv.height;
    const buf = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    const x = (w / 2) | 0;
    let runs = 0, inRun = false, lit = 0;
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 4;
      const on = buf[i] > 150 && buf[i + 1] > 150 && buf[i + 2] > 150;
      if (on) { lit++; if (!inRun) { runs++; inRun = true; } } else inRun = false;
    }
    return { runs, lit };
  });
  console.log('       white stripes down the HDB body band: ' + stripes.runs +
              ' (lit rows ' + stripes.lit + ')');
  console.log('       ' + (stripes.runs <= 1
    ? '-> ANCHORED to the extrusion base: one stripe per band.'
    : '-> NOT anchored: the tile repeats ' + stripes.runs + ' times up a 27 m band, so a '
      + 'feature drawn "at the top" of a tile appears that many times. Vertical '
      + 'hierarchy must come from band boundaries, which is what this pass does.'));
}

// ── 6. night must not invert the silhouette ───────────────────────
console.log('\nNIGHT');
await page.evaluate(() => {
  const m = window.__map;
  for (const l of m.getStyle().layers) {
    try { m.setLayoutProperty(l.id, 'visibility', 'visible'); } catch (e) {}
  }
});
await settle({ center: MOODY, zoom: 16.4, pitch: 68, bearing: 210 }, 0.25);
await isolate(['moody-']);
await settle({ center: MOODY, zoom: 16.4, pitch: 68, bearing: 210 }, 0.25);
const dayL = await lumaStats();
await settle({ center: MOODY, zoom: 16.4, pitch: 68, bearing: 210 }, 0.92);
const nightL = await lumaStats();
console.log('       precinct mean luma  day ' + dayL.mean.toFixed(1) +
            '   night ' + nightL.mean.toFixed(1) +
            '   (coverage ' + (dayL.coverage * 100).toFixed(1) + '% / ' +
            (nightL.coverage * 100).toFixed(1) + '%)');
ok(dayL.coverage < 0.35 && dayL.n > 3000,
   'the day/night sample is the precinct and not the whole frame',
   +(dayL.coverage * 100).toFixed(1));
// The failure this guards is real and has a script of its own
// (night-silhouette.mjs): DKR's first seating bake left the bowl at luma ~70
// against a city at ~30, so the stadium glowed as the brightest thing on the
// east side of campus. A lit arena SHOULD carry some light, but not more than
// it carries at noon.
ok(nightL.mean < dayL.mean * 0.75, 'the precinct goes properly dark at night',
   { day: +dayL.mean.toFixed(1), night: +nightL.mean.toFixed(1) });
ok(nightL.mean > 4, 'but it is not pitch black — the concourse ribbon still reads',
   +nightL.mean.toFixed(1));

console.log('\nCONSOLE');
const real = errors.filter(e => !/Failed to load resource|favicon/i.test(e));
ok(real.length === 0, 'no console errors', real.slice(0, 6));

console.log('\n%d passed, %d failed', pass, fail);
await browser.__done();
process.exit(fail ? 1 : 0);
