/**
 * downtown-preset.mjs — does the Performance preset stop far downtown buildings
 * from drawing while their name labels still draw?
 *
 *   VERIFY_URL=http://127.0.0.1:8442 node downtown-preset.mjs <outDir>
 *
 * The report was "downtown name labels float over flat empty ground; only near
 * buildings draw", from a browser pinned to Performance by an old automatic
 * downgrade. The suspect was `renderDistance: 350` (Performance) against 700
 * (Balanced). This loads the real page twice in ONE browser, once with each
 * preset saved (so each boot is the real boot, not a live switch), and from
 * three cameras shoots the same frame and measures what is drawn:
 *
 *   spawn         the camera the map is created at (app.js SPAWN)
 *   intro-end     where the opening flight lands, looking south over downtown
 *   campus-south  an eye over south campus looking at the downtown skyline
 *
 * What it records per frame:
 *   - layerPixels: the pixels each outer-ring layer (tower, mid-rise, low-rise)
 *     covers, read as the frame with the layer on against the frame with it
 *     off. Divide by renderScale^2 to compare presets (Performance renders at
 *     0.75, so its canvas has 0.5625 of the pixels).
 *   - towersDrawn / towersInFrame: downtown towers whose ground point is in the
 *     frame, and how many of those have layer-difference ink in a thin column
 *     standing on that point. Neighbours add ink equally in both presets, so
 *     the comparison between presets is what the number is for.
 *   - labelsByRule: every downtown apartment / landmark name that is in range at
 *     this eye and on screen, with the class of the building it names (nearest
 *     outer-ring building, within MATCH_M) and whether the preset's own rule
 *     draws that building (towers and mid-rise are never thinned; a low-rise
 *     prism is drawn when its importance rank `d` <= GFX.outerDensity).
 *   - lod: what render distance (js/lod.js) hides at that eye altitude: the
 *     tier flags and the list of layers it has hidden.
 *   - layerDiff: every style layer whose visibility, filter or opacity differs
 *     between the two presets at the same camera. This is the direct answer to
 *     "what does the preset change": it lists the layers and nothing else.
 *
 * (queryRenderedFeatures is not used for counts: it returns nothing for
 * fill-extrusion at these pitches, README.)
 *
 * The screenshot is taken twice and the second is kept. The auto-detect probe
 * is cancelled at the top of each load. A measurement, not a gate: exit 0.
 * Run through the GPU queue:
 *   node <astra-pipe>/tools/gpu-run.mjs --label downtown-preset -- node downtown-preset.mjs <outDir>
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { BASE, launch } from './chrome.mjs';

const OUT = process.argv[2];
if (!OUT) { console.error('usage: downtown-preset.mjs <outDir>'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });

const KEY = 'austin3d.gfx.v1';
// Measure values, one line each.
const DOWNTOWN = { lng: [-97.7525, -97.7330], lat: [30.2580, 30.2765] };
const MATCH_M = 60;          // a label's building = nearest outer-ring building within this
const RANGES = { apartment: [820, 1350], landmark: [1500, 2500] };  // js/name-labels.js TUNE.ranges
const COLUMN = { halfWidthPx: 3, riseOfFrame: 0.45, inkNeeded: 8 };  // the thin column a tower stands in
const SETTLE_CAP_MS = 40000, REST_MS = 4500;
const CAMERAS = {
  spawn:          { center: [-97.7434, 30.2857], zoom: 16.5, pitch: 74, bearing: 250 },
  'intro-end':    { center: [-97.7365, 30.2900], zoom: 16.45, pitch: 74, bearing: 202 },
  'campus-south': { center: [-97.7428, 30.2695], zoom: 15.1, pitch: 67, bearing: 195 },
};
// The saved value of a real desktop browser that was stuck on Performance, at the
// current rev so the one-time heal for old unstamped saves does not touch it.
const PERFORMANCE = { renderScale: 0.75, msaa: true, bloom: 0, godRays: 0, flare: 0, dof: 0,
  windowReflections: 1, exposure: 1.03, contrast: 1.06, saturation: 1, filmic: 0.65, vignette: 1,
  autoExposure: false, grain: 0, renderDistance: 350, ao: false, shadows: true, clouds: 0.4, stars: 0.5,
  fov: 58, treeDensity: 0.52, outerDensity: 0.45, preset: 'performance', custom: false,
  autoDetected: true, rev: 4 };
const PRESETS = { performance: PERFORMANCE, balanced: null };   // null = a clean profile (the default is balanced)

const browser = await launch(chromium, { gl: 'hardware', maxMs: 1500000 });
const report = { base: BASE, cameras: CAMERAS, frames: [], layerDiff: {} };
const states = {};

async function loadWith(name) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const raw = PRESETS[name] ? JSON.stringify(PRESETS[name]) : null;
  await ctx.addInitScript(([key, value]) => { try { if (value !== null) localStorage.setItem(key, value); } catch (e) {} }, [KEY, raw]);
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log(`  [${name}] pageerror ${e.message}`));
  await page.goto(BASE + '/_harness.html?intro=0&drift=0', { waitUntil: 'domcontentloaded', timeout: 240000 });
  await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded && window.__map.isStyleLoaded() && window.GFX,
    null, { timeout: 300000 });
  await page.waitForFunction(() => document.getElementById('fx-canvas'), null, { timeout: 120000 });
  await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
  const gfx = await page.evaluate(() => ({ preset: GFX.preset, renderDistance: GFX.renderDistance, outerDensity: GFX.outerDensity,
    renderScale: GFX.renderScale, autoDetected: GFX.autoDetected }));
  console.log(`  [${name}] loaded ${JSON.stringify(gfx)}`);
  if (gfx.preset !== name) throw new Error(`wanted preset ${name}, page has ${gfx.preset}`);
  // The catalog and the outer ring, once per load, for the label match.
  await page.evaluate(async (dt) => {
    const [labels, ring] = await Promise.all([
      fetch('data/labels.json').then(r => r.json()),
      fetch('data/outer_ring.geojson').then(r => r.json()),
    ]);
    const cen = f => { let c = f.geometry.coordinates; while (typeof c[0] !== 'number') c = c[0]; return c; };
    window.__lab = labels.labels.filter(l => ['apartment', 'landmark'].includes(l.kind)
      && l.lng > dt.lng[0] && l.lng < dt.lng[1] && l.lat > dt.lat[0] && l.lat < dt.lat[1]);
    window.__ring = ring.features.map(f => ({ c: cen(f), p: f.properties }))
      .filter(b => b.c[0] > dt.lng[0] && b.c[0] < dt.lng[1] && b.c[1] > dt.lat[0] && b.c[1] < dt.lat[1]);
  }, DOWNTOWN);
  return { ctx, page };
}

async function settle(page) {
  // Poll (the map may never go 'idle': the sky repaints), up to a cap, then a fixed rest.
  await page.evaluate(cap => new Promise(r => {
    const m = window.__map, t0 = Date.now();
    const go = () => { if ((m.loaded() && m.areTilesLoaded()) || Date.now() - t0 > cap) return r(); setTimeout(go, 500); };
    go();
  }), SETTLE_CAP_MS);
  await page.waitForTimeout(REST_MS);
}

// Every layer's visibility, filter and opacity right now: what the preset changed in the style.
async function layerState(page) {
  return page.evaluate(() => {
    const m = window.__map, out = {};
    for (const l of m.getStyle().layers) {
      const g = (f) => { try { return f(); } catch (e) { return null; } };
      out[l.id] = { type: l.type, vis: g(() => m.getLayoutProperty(l.id, 'visibility')),
        filter: g(() => JSON.stringify(m.getFilter(l.id) || null)),
        opacity: g(() => JSON.stringify(m.getPaintProperty(l.id, l.type === 'fill-extrusion' ? 'fill-extrusion-opacity' : l.type === 'fill' ? 'fill-opacity' : 'x') ?? null)),
        minzoom: l.minzoom ?? null, maxzoom: l.maxzoom ?? null };
    }
    return out;
  });
}

async function measure(page) {
  return page.evaluate(async ({ MATCH_M, RANGES, COLUMN }) => {
    const m = window.__map, canvas = m.getCanvas(), W = canvas.clientWidth, H = canvas.clientHeight;
    // The same eye the name labels use (js/name-labels.js eyePosition): the flight
    // controller re-syncs it after a jumpTo.
    const e = window.__fly.eye();
    const alt = e.alt, mx = 111320 * Math.cos(e.lat * Math.PI / 180), my = 111320;
    const gfx = window.GFX;
    // Render distance: re-evaluate it now (it also runs on every camera move) and record what it did.
    if (window.applyLOD) window.applyLOD(m);
    await new Promise(r => setTimeout(r, 600));
    const hid = id => (window.LOD_isHidden ? window.LOD_isHidden(id) : null);
    const lod = { altitude: Math.round(alt), renderDistance: gfx.renderDistance,
      fineHidden: hid('props-lit'), midHidden: hid('trees-canopy'),
      layersHidden: Object.keys(window.LOD_TIERS || {}).flatMap(t => window.LOD_TIERS[t]).filter(id => hid(id)) };
    // Which downtown labels are in range at this eye and on screen, and does the preset's rule draw their building?
    const rows = [];
    for (const l of window.__lab) {
      const dx = (l.lng - e.lng) * mx, dy = (l.lat - e.lat) * my, dz = alt - (l.height || 0);
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const [lo, hi] = RANGES[l.kind];
      if (dist < lo || dist > hi) continue;
      const p = m.project([l.lng, l.lat]);
      if (!(p.x > 0 && p.x < W && p.y > 0 && p.y < H)) continue;
      let best = null, bd = Infinity;
      for (const b of window.__ring) {
        const d = Math.hypot((b.c[0] - l.lng) * mx, (b.c[1] - l.lat) * my);
        if (d < bd && (b.p.h || 0) >= (l.height || 0) * 0.6) { bd = d; best = b; }
      }
      if (!best || bd > MATCH_M) { rows.push({ name: l.name, cls: 'unmatched' }); continue; }
      const cls = best.p.t === 1 ? 'tower' : best.p.t === 2 ? 'midrise' : 'lowrise';
      const drawn = cls !== 'lowrise' || (best.p.d || 0) <= gfx.outerDensity;
      rows.push({ name: l.name, cls, drawn, d: best.p.d ?? null });
    }
    // Pixels: the frame with a layer on against the frame with it off.
    const W2 = canvas.width, H2 = canvas.height, sx = W2 / W, sy = H2 / H;
    const px = async () => {
      m.triggerRepaint();
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      const a = new Uint8Array(W2 * H2 * 4);
      gl.readPixels(0, 0, W2, H2, gl.RGBA, gl.UNSIGNED_BYTE, a);
      return a;
    };
    const maskOf = async (layer) => {
      if (!m.getLayer(layer)) return null;
      const a = await px();
      m.setLayoutProperty(layer, 'visibility', 'none');
      await new Promise(r => setTimeout(r, 1200));
      const b = await px();
      m.setLayoutProperty(layer, 'visibility', 'visible');
      await new Promise(r => setTimeout(r, 1200));
      const mask = new Uint8Array(W2 * H2); let n = 0;
      for (let i = 0, k = 0; i < a.length; i += 4, k++)
        if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) >= 70) { mask[k] = 1; n++; }
      return { mask, n };
    };
    const towerM = await maskOf('outer-tower');
    let towersInFrame = 0, towersDrawn = 0;
    if (towerM) {
      for (const b of window.__ring) {
        if (b.p.t !== 1) continue;
        const g = m.project(b.c);
        if (g.x < 0 || g.x > W || g.y < 0 || g.y > H) continue;
        towersInFrame++;
        let ink = 0;
        const x0 = Math.max(0, Math.round(g.x * sx) - COLUMN.halfWidthPx), x1 = Math.min(W2 - 1, Math.round(g.x * sx) + COLUMN.halfWidthPx);
        const yTop = Math.max(0, Math.round((g.y - COLUMN.riseOfFrame * H) * sy)), yBot = Math.min(H2 - 1, Math.round(g.y * sy));
        for (let y = yTop; y <= yBot; y++) { const row = (H2 - 1 - y) * W2; for (let x = x0; x <= x1; x++) ink += towerM.mask[row + x]; }
        if (ink >= COLUMN.inkNeeded) towersDrawn++;
      }
    }
    const midM = await maskOf('outer-midrise'), lowM = await maskOf('outer-3d');
    const by = (cls) => rows.filter(r => r.cls === cls);
    return { eye: { lng: +e.lng.toFixed(5), lat: +e.lat.toFixed(5), alt: Math.round(alt) },
      canvas: [W2, H2], renderScale: gfx.renderScale, lod,
      layerPixels: { tower: towerM ? towerM.n : null, midrise: midM ? midM.n : null, lowrise: lowM ? lowM.n : null },
      towersInFrame, towersDrawn,
      labelsByRule: { onScreenInRange: rows.length, tower: by('tower').length, midrise: by('midrise').length, lowrise: by('lowrise').length,
        unmatched: by('unmatched').length, notDrawnByPreset: rows.filter(r => r.drawn === false).map(r => r.name) } };
  }, { MATCH_M, RANGES, COLUMN });
}

for (const name of Object.keys(PRESETS)) {
  const { ctx, page } = await loadWith(name);
  for (const [camName, cam] of Object.entries(CAMERAS)) {
    await page.evaluate(q => window.__map.jumpTo(q), cam);
    await settle(page);
    let result;
    try { result = await measure(page); }
    catch (e) { console.log(`  [${name} ${camName}] measure failed: ${String(e.message).split('\n')[0]}`); result = { error: String(e.message) }; }
    // Screenshot twice, trust the second.
    await page.screenshot({ path: path.join(OUT, `${name}-${camName}-first.png`) });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(OUT, `${name}-${camName}.png`) });
    states[`${name}|${camName}`] = await layerState(page);
    report.frames.push({ preset: name, camera: camName, ...result });
    if (!result.error) {
      const k = result.renderScale * result.renderScale;
      const px = Object.fromEntries(Object.entries(result.layerPixels).map(([a, v]) => [a, v == null ? null : Math.round(v / k)]));
      console.log(`  [${name} ${camName}] eye ${JSON.stringify(result.eye)} canvas ${result.canvas.join('x')} ` +
        `layer pixels at full scale ${JSON.stringify(px)} towers ${result.towersDrawn}/${result.towersInFrame} ` +
        `labels ${JSON.stringify(result.labelsByRule)} lod ${JSON.stringify(result.lod)}`);
    }
  }
  await ctx.close();
}
// What differs in the style between the two presets, per camera.
for (const camName of Object.keys(CAMERAS)) {
  const P = states[`performance|${camName}`] || {}, B = states[`balanced|${camName}`] || {};
  const diffs = [];
  for (const id of new Set([...Object.keys(P), ...Object.keys(B)])) {
    if (JSON.stringify(P[id]) !== JSON.stringify(B[id])) diffs.push({ id, performance: P[id], balanced: B[id] });
  }
  report.layerDiff[camName] = diffs;
  console.log(`  [layer diff ${camName}] ${diffs.length} layers differ: ${diffs.map(d => d.id).join(', ')}`);
}
fs.writeFileSync(path.join(OUT, 'downtown-preset.json'), JSON.stringify(report, null, 1));
await browser.close();
console.log('done');
