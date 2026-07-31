/**
 * roads-luma.mjs — ground-luma.mjs, extended for what this pass added.
 *
 * ground-luma.mjs is the guard on the trap: the paving tones are pale ON
 * PURPOSE, and the first version of the ground layer had paths at ~luma 185
 * against a ground at ~188.5 and the entire path network was invisible while
 * rendering perfectly. Darkening or re-toning the roads is the exact edit that
 * could bring it back, so the separation is MEASURED, never eyeballed.
 *
 * Two reasons this exists alongside it rather than editing it:
 *   1. ground-luma.mjs classifies `ground-paths`, `ground-areas` and anything
 *      whose id starts with `ground-road`. `ground-bike-*`, `ground-cycleway`,
 *      `ground-stopbar` and `ground-speedway-brick` match none of those, so they
 *      fall into "unclassified" and the new surfaces cannot be checked at all.
 *   2. it settles on a fixed timer. With roads.geojson (2.5 MB) added, that timer
 *      is no longer long enough: a run of it against this branch came back with
 *      0.0% path and 0.0% area — the ground source had not finished — and the
 *      table looked perfectly plausible. So this waits on RENDERED FEATURES,
 *      not on a clock, and refuses to report if the frame is empty.
 *
 * Method is otherwise identical, and it is positive identification rather than
 * inference: two renders of the same frame, one for real luma, one with every
 * class painted a key colour, then average pass-1 luma inside each pass-2 mask.
 *
 * Usage: node roads-luma.mjs [p ...]      (default: 0.14 0.5 0.92)
 */
import { chromium } from 'playwright-core';
import { chromePath, GL_ARGS, BASE as SERVER } from './chrome.mjs';

const PS = process.argv.slice(2).length ? process.argv.slice(2).map(Number) : [0.14, 0.5, 0.92];

// Same pose ground-luma.mjs uses, so the numbers are comparable to the ones in
// docs/GROUND_TEXTURE.md: South Mall / Guadalupe, with campus footpaths, lawns,
// a plaza, parking and an arterial in one frame, at the pitch the camera flies.
const POSE = { center: [-97.7405, 30.2848], zoom: 16.4, pitch: 68, bearing: 20 };
// A second pose that actually contains the Speedway brick and a bike lane, so
// the two things this pass added can be measured rather than asserted.
const POSE2 = { center: [-97.7390, 30.2858], zoom: 16.8, pitch: 66, bearing: 355 };

const KEYS = {
  path:   [255, 0, 255],
  area:   [0, 255, 200],
  road:   [255, 128, 0],
  bike:   [0, 128, 255],
  brick:  [255, 255, 255],
  ground: [255, 255, 0],
};

const browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: GL_ARGS });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('PAGEERR', e.message));

await page.goto(SERVER + '/_harness.html?intro=0&drift=0', { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });

// Wait on RENDERED FEATURES. `isSourceLoaded` goes true before the worker has
// tiled everything, and a fixed sleep after it is how the 0.0%-path run happened.
await page.waitForFunction(() => {
  const m = window.__map;
  if (!m.getLayer('ground-paths') || !m.getLayer('ground-road')) return false;
  try {
    return m.querySourceFeatures('austin-ground').length > 500
        && m.querySourceFeatures('austin-roads').length > 500;
  } catch (e) { return false; }
}, null, { timeout: 180000 }).catch(() => console.log('WARN sources never produced features'));
await page.waitForTimeout(4000);
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

await page.evaluate((pose) => {
  const m = window.__map;
  if (m.isEasing && m.isEasing()) m.stop();
  m.jumpTo(pose);
  Object.assign(window.GFX, { bloom: 0, godRays: 0, flare: 0, dof: 0, grain: 0, vignette: 0 });
  window.applyGraphics();
  for (const l of m.getStyle().layers) {
    const keepAlways = l.type === 'background' || /^sky|atmos|haze/.test(l.id);
    const keepGround = l.id.startsWith('ground-');
    if (keepAlways || keepGround) continue;
    try {
      if ((l.layout && l.layout.visibility) !== 'none') m.setLayoutProperty(l.id, 'visibility', 'none');
    } catch (e) {}
  }
}, POSE);
await page.waitForTimeout(3000);

async function measure(pose, p) {
  await page.evaluate((a) => {
    const m = window.__map;
    m.jumpTo(a.pose);
    window.applyTimeOfDay(m, a.p, true);
  }, { pose, p });
  await page.waitForTimeout(2500);
  await page.evaluate(() => new Promise(r => {
    const m = window.__map; if (m.loaded()) return r(); m.once('idle', r); setTimeout(r, 15000);
  }));
  await page.evaluate(() => window.__map.triggerRepaint());
  await page.waitForTimeout(900);

  // Keep the pixels IN the page — handing 4M numbers back over CDP once took
  // twenty minutes and 2 GB of RSS.
  await page.evaluate(() => {
    const cv = window.__map.getCanvas();
    const gl = cv.getContext('webgl2') || cv.getContext('webgl');
    const buf = new Uint8Array(cv.width * cv.height * 4);
    gl.readPixels(0, 0, cv.width, cv.height, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    const n = cv.width * cv.height;
    const L = new Float32Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      L[i] = 0.2126 * buf[j] + 0.7152 * buf[j + 1] + 0.0722 * buf[j + 2];
    }
    window.__realLuma = L;
  });

  await page.evaluate((KEYS) => {
    const m = window.__map;
    const set = (id, prop, v) => { try { m.setPaintProperty(id, prop, v); } catch (e) {} };
    const css = c => `rgb(${c[0]},${c[1]},${c[2]})`;
    // Snapshot EXACTLY what is about to be overwritten. Restoring via
    // applyGroundColors/applyGroundSettings is not enough: neither of them
    // rewrites the road layers' `line-opacity`, so the mask pass's opacity:1
    // survived into the next row's real-luma pass and the road share climbed
    // 2.4% -> 16.3% -> 1.4% -> 16.3% across one run. The path columns were
    // stable throughout, which is exactly why it looked like data.
    window.__lumaSaved = [];
    for (const id of ['ground-areas', 'ground-paths', 'ground-paths-casing',
                      'ground-road', 'ground-road-casing', 'ground-road-lane',
                      'ground-stopbar', 'ground-bike-left', 'ground-bike-right',
                      'ground-cycleway']) {
      if (!m.getLayer(id)) continue;
      const prop = m.getLayer(id).type === 'fill' ? 'fill-color' : 'line-color';
      const op = m.getLayer(id).type === 'fill' ? 'fill-opacity' : 'line-opacity';
      window.__lumaSaved.push([id, prop, m.getPaintProperty(id, prop),
                                    op, m.getPaintProperty(id, op)]);
    }
    for (const l of m.getStyle().layers) {
      if (l.type === 'background') set(l.id, 'background-color', css(KEYS.ground));
    }
    set('ground-areas', 'fill-color', css(KEYS.area));
    // Speedway is a PATH feature, so it has to be keyed off `s` inside the path
    // layer or it counts as ordinary paving and the brick cannot be measured.
    for (const id of ['ground-paths', 'ground-paths-casing']) {
      set(id, 'line-color', ['case', ['==', ['get', 's'], 'brickpave'],
                             css(KEYS.brick), css(KEYS.path)]);
    }
    for (const id of ['ground-road', 'ground-road-casing', 'ground-road-lane', 'ground-stopbar']) {
      set(id, 'line-color', css(KEYS.road)); set(id, 'line-opacity', 1);
    }
    for (const id of ['ground-bike-left', 'ground-bike-right', 'ground-cycleway']) {
      set(id, 'line-color', css(KEYS.bike)); set(id, 'line-opacity', 1);
    }
    for (const id of ['ground-texture', 'ground-speedway-brick']) {
      try { m.setLayoutProperty(id, 'visibility', 'none'); } catch (e) {}
    }
    m.triggerRepaint();
  }, KEYS);
  await page.waitForTimeout(2200);

  const acc = await page.evaluate((KEYS) => {
    const cv = window.__map.getCanvas();
    const gl = cv.getContext('webgl2') || cv.getContext('webgl');
    const n = cv.width * cv.height;
    const buf = new Uint8Array(n * 4);
    gl.readPixels(0, 0, cv.width, cv.height, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    const L = window.__realLuma;
    const names = Object.keys(KEYS), cols = names.map(k => KEYS[k]);
    const out = {}; for (const k of names) out[k] = { n: 0, sum: 0 };
    let unclassified = 0;
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const r = buf[j], g = buf[j + 1], b = buf[j + 2];
      let best = -1, bestD = 2500;      // 50 units of RGB distance, squared
      for (let c = 0; c < cols.length; c++) {
        const d = (r - cols[c][0]) ** 2 + (g - cols[c][1]) ** 2 + (b - cols[c][2]) ** 2;
        if (d < bestD) { bestD = d; best = c; }
      }
      if (best < 0) { unclassified++; continue; }
      const a = out[names[best]]; a.n++; a.sum += L[i];
    }
    return { out, unclassified, total: n };
  }, KEYS);

  await page.evaluate(() => {
    const m = window.__map;
    for (const [id, prop, val, op, opval] of (window.__lumaSaved || [])) {
      try { m.setPaintProperty(id, prop, val); } catch (e) {}
      try { m.setPaintProperty(id, op, opval); } catch (e) {}
    }
    for (const id of ['ground-texture', 'ground-speedway-brick']) {
      try { m.setLayoutProperty(id, 'visibility', 'visible'); } catch (e) {}
    }
  });

  const mean = k => (acc.out[k].n ? acc.out[k].sum / acc.out[k].n : NaN);
  const pct = k => 100 * acc.out[k].n / acc.total;
  return { p,
    path: mean('path'), area: mean('area'), road: mean('road'),
    bike: mean('bike'), brick: mean('brick'), ground: mean('ground'),
    pathPct: pct('path'), roadPct: pct('road'), areaPct: pct('area'),
    bikePct: pct('bike'), brickPct: pct('brick'), groundPct: pct('ground') };
}

const f = v => (Number.isFinite(v) ? v.toFixed(1).padStart(6) : '   n/a');
for (const [label, pose] of [['SOUTH MALL / GUADALUPE', POSE], ['SPEEDWAY / EAST MALL', POSE2]]) {
  console.log('\n%s   %s', label, JSON.stringify(pose));
  console.log('p      path   area   road   bike  brick ground | path-gnd road-path brick-gnd brick-path | %path %road %bike %brick %bg');
  for (const p of PS) {
    const r = await measure(pose, p);
    if (!(r.pathPct > 0.2)) console.log('  (p=%s) WARNING: no path pixels — the frame is not loaded, ignore this row', p);
    console.log('%s %s %s %s %s %s %s |%s %s %s %s | %s %s %s %s %s',
      r.p.toFixed(2), f(r.path), f(r.area), f(r.road), f(r.bike), f(r.brick), f(r.ground),
      f(Math.abs(r.path - r.ground)), f(Math.abs(r.road - r.path)),
      f(Math.abs(r.brick - r.ground)), f(Math.abs(r.brick - r.path)),
      r.pathPct.toFixed(1).padStart(5), r.roadPct.toFixed(1).padStart(5),
      r.bikePct.toFixed(2).padStart(5), r.brickPct.toFixed(2).padStart(6),
      r.groundPct.toFixed(1).padStart(5));
  }
}
console.log('\nGUARD: path-gnd must stay near the pre-pass 42.0 / 47.2 / 21.0 (day/golden/night).');
console.log('brick-path is the NEW separation: Speedway must not read as another concrete walk.');
await browser.close();
