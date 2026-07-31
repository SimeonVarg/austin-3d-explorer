/**
 * ground-luma.mjs — measure the luma separation between the ground classes.
 *
 * The trap this exists to guard: the paving tones are pale ON PURPOSE. The
 * first version of the ground layer had paths at ~luma 185 against a ground at
 * ~188.5 and the entire path network was invisible while rendering perfectly.
 * Darkening the roads is the exact edit that could reintroduce it, so the
 * separation is MEASURED before and after, never eyeballed.
 *
 * Method — positive identification, not inference. Two renders of the same
 * frame at the same pose:
 *   pass 1  the real colours          -> luma per pixel
 *   pass 2  each class painted a key  -> which class owns each pixel
 * Then average pass-1 luma inside each pass-2 mask. Buildings, trees, props and
 * post-processing are off, because this measures ground colour, not bloom.
 *
 * Usage: node ground-luma.mjs [p ...]      (default: 0.14 0.5 0.92)
 */
import { chromium } from 'playwright-core';
import { chromePath, BASE as SERVER } from './chrome.mjs';

const PS = process.argv.slice(2).length ? process.argv.slice(2).map(Number) : [0.14, 0.5, 0.92];

// A pose over the South Mall / Guadalupe corner: campus footpaths, lawns, a
// plaza, parking and an arterial all in one frame, at the pitch the camera
// actually flies at.
const POSE = { center: [-97.7405, 30.2848], zoom: 16.4, pitch: 68, bearing: 20 };

// Key colours for the mask pass. Chosen far apart in RGB so swiftshader's
// dithering cannot turn one into another.
const KEYS = {
  path:   [255, 0, 255],
  area:   [0, 255, 200],
  road:   [255, 128, 0],
  ground: [255, 255, 0],
};

const browser = await chromium.launch({
  executablePath: chromePath(), headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--ignore-gpu-blocklist', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('PAGEERR', e.message));

await page.goto(SERVER + '/_harness.html?intro=0&drift=0', { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 90000 });
await page.waitForFunction(() => {
  const m = window.__map;
  return m && m.getSource('austin-ground') && m.isSourceLoaded('austin-ground');
}, null, { timeout: 90000 }).catch(() => console.log('WARN ground source not loaded'));
await page.waitForTimeout(4000);
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

// Hide everything that is not the ground, and switch the post stack off. A
// building in front of a lawn is not a measurement of the lawn.
await page.evaluate((pose) => {
  const m = window.__map;
  if (m.isEasing && m.isEasing()) m.stop();
  m.jumpTo(pose);
  Object.assign(window.GFX, { bloom: 0, godRays: 0, flare: 0, dof: 0, grain: 0, vignette: 0 });
  window.applyGraphics();
  window.__hidden = [];
  for (const l of m.getStyle().layers) {
    const keepAlways = l.type === 'background' || /^sky|atmos|haze/.test(l.id);
    const keepGround = l.id.startsWith('ground-');
    // The basemap's own road lines are part of "the ground" until this pass
    // takes them over, so they must be measurable too.
    const keepRoad = (l['source-layer'] || '') === 'transportation' && l.type === 'line';
    if (keepAlways || keepGround || keepRoad) continue;
    try {
      if ((l.layout && l.layout.visibility) !== 'none') {
        m.setLayoutProperty(l.id, 'visibility', 'none');
        window.__hidden.push(l.id);
      }
    } catch (e) {}
  }
}, POSE);
await page.waitForTimeout(2500);

const rows = [];
for (const p of PS) {
  await page.evaluate((p) => window.applyTimeOfDay(window.__map, p, true), p);
  await page.waitForTimeout(2500);
  await page.evaluate(() => new Promise(r => {
    const m = window.__map; if (m.loaded()) return r(); m.once('idle', r); setTimeout(r, 12000);
  }));
  await page.evaluate(() => window.__map.triggerRepaint());
  await page.waitForTimeout(900);

  // Keep the pixels IN the page. Handing 4M numbers back over CDP took twenty
  // minutes and 2 GB of RSS; the classification is a loop, so run it where the
  // data already is and return only the aggregate.
  await page.evaluate(() => {
    const cv = window.__map.getCanvas();
    const gl = cv.getContext('webgl2') || cv.getContext('webgl');
    const buf = new Uint8Array(cv.width * cv.height * 4);
    gl.readPixels(0, 0, cv.width, cv.height, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    const n = cv.width * cv.height;
    const L = new Float32Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      L[i] = 0.2126 * buf[j] + 0.7152 * buf[j+1] + 0.0722 * buf[j+2];
    }
    window.__realLuma = L;
    return { w: cv.width, h: cv.height };
  });

  // Mask pass. Everything that draws ground gets a key colour; the background
  // (which IS the catch-all ground under everything OSM does not classify)
  // gets its own key so it is identified positively rather than by exclusion.
  await page.evaluate((KEYS) => {
    const m = window.__map;
    const set = (id, prop, v) => { try { m.setPaintProperty(id, prop, v); } catch (e) {} };
    const css = c => `rgb(${c[0]},${c[1]},${c[2]})`;
    for (const l of m.getStyle().layers) {
      if (l.type === 'background') set(l.id, 'background-color', css(KEYS.ground));
    }
    set('ground-areas', 'fill-color', css(KEYS.area));
    for (const id of ['ground-paths', 'ground-paths-casing']) set(id, 'line-color', css(KEYS.path));
    for (const l of m.getStyle().layers) {
      if ((l['source-layer'] || '') === 'transportation' && l.type === 'line') {
        set(l.id, 'line-color', css(KEYS.road));
        set(l.id, 'line-opacity', 1);
      }
      if (l.id.startsWith('ground-road')) { set(l.id, 'line-color', css(KEYS.road)); set(l.id, 'line-opacity', 1); }
    }
    // The texture overlay would tint the key colours; take it out of the mask.
    try { if (m.getLayer('ground-texture')) m.setLayoutProperty('ground-texture', 'visibility', 'none'); } catch (e) {}
    m.triggerRepaint();
  }, KEYS);
  await page.waitForTimeout(2200);

  // Classify in-page: nearest key within a tolerance, else unclassified (sky).
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
      const r = buf[j], g = buf[j+1], b = buf[j+2];
      let best = -1, bestD = 3600;      // 60 units of RGB distance, squared
      for (let c = 0; c < cols.length; c++) {
        const d = (r - cols[c][0]) ** 2 + (g - cols[c][1]) ** 2 + (b - cols[c][2]) ** 2;
        if (d < bestD) { bestD = d; best = c; }
      }
      if (best < 0) { unclassified++; continue; }
      const a = out[names[best]];
      a.n++; a.sum += L[i];
    }
    return { out, unclassified, total: n };
  }, KEYS);

  const mean = k => acc.out[k].n ? acc.out[k].sum / acc.out[k].n : NaN;
  const pct = k => (100 * acc.out[k].n / acc.total);
  const row = {
    p,
    path: mean('path'), area: mean('area'), road: mean('road'), ground: mean('ground'),
    pathPct: pct('path'), roadPct: pct('road'), areaPct: pct('area'), groundPct: pct('ground'),
    unclassifiedPct: 100 * acc.unclassified / acc.total,
  };
  row.pathVsGround = Math.abs(row.path - row.ground);
  row.roadVsPath = Math.abs(row.road - row.path);
  row.roadVsGround = Math.abs(row.road - row.ground);
  rows.push(row);

  // Restore real colours for the next p.
  await page.evaluate(() => {
    const m = window.__map;
    window.applyGroundColors(m, window.__todCurrentP);
    try { if (m.getLayer('ground-texture')) m.setLayoutProperty('ground-texture', 'visibility', 'visible'); } catch (e) {}
  });
}

const f = (v) => (Number.isFinite(v) ? v.toFixed(1).padStart(6) : '   n/a');
console.log('\np      path   area   road  ground | path-ground  road-path  road-ground | %path %road %area %bg');
for (const r of rows) {
  console.log('%s %s %s %s %s |%s      %s     %s | %s %s %s %s',
    r.p.toFixed(2), f(r.path), f(r.area), f(r.road), f(r.ground),
    f(r.pathVsGround), f(r.roadVsPath), f(r.roadVsGround),
    r.pathPct.toFixed(1).padStart(5), r.roadPct.toFixed(1).padStart(5),
    r.areaPct.toFixed(1).padStart(5), r.groundPct.toFixed(1).padStart(5));
}
console.log('\n(luma = Rec.709 on the real render; class = nearest key colour in the mask render)');
await browser.close();
