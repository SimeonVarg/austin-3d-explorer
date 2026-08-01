/**
 * lod-capability.mjs — what can MapLibre 5.24 ACTUALLY do for distance culling?
 *
 * Before designing a render-distance mode, settle by experiment which of the
 * candidate mechanisms exist and work on THIS version with THESE layers. Every
 * answer here is read off a running map, not off documentation or memory.
 *
 * Questions:
 *  1. Does the `within` filter expression exist, and does it work on the
 *     fill-extrusion POLYGON layers (buildings, outer ring) as well as on the
 *     POINT layers (trees, props)? `within` is documented for points and lines;
 *     if it silently drops polygons, a whole design is dead.
 *  2. What does setFilter COST? If a distance filter has to be rewritten on
 *     every camera move, the rewrite must be cheap enough to run at 60 Hz.
 *     Does it force a re-tile (the README records that setData does)?
 *  3. Do the heavy layers actually cost anything to draw? Measure frame time
 *     with each candidate group hidden, so the mode targets what is expensive
 *     rather than what is numerous.
 *  4. Is `queryRenderedFeatures` usable to count what is on screen? (README:
 *     it returns 0 for fill-extrusion at a flying pitch — confirm.)
 *
 * Usage: node lod-capability.mjs
 */
import { chromium } from 'playwright-core';
import { BASE as SERVER, launch } from './chrome.mjs';
import fs from 'node:fs';

const POSE = { center: [-97.7434, 30.2857], zoom: 15.0, pitch: 74, bearing: 200 };

const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));

await page.goto(`${SERVER}/_harness.html?intro=0&drift=0`, { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
await page.waitForFunction(() => {
  const m = window.__map;
  return m && m.getSource('austin-buildings') && m.getSource('austin-outer') && m.getSource('austin-trees');
}, null, { timeout: 120000 });
await page.evaluate(p => window.__map.jumpTo(p), POSE);
await page.waitForFunction(() => window.__map.loaded() && window.__map.areTilesLoaded(), null, { timeout: 120000 });
await page.waitForTimeout(5000);

const out = await page.evaluate(async () => {
  const m = window.__map;
  const R = {};

  // ── inventory ────────────────────────────────────────────────────
  const layers = m.getStyle().layers.filter(l => l.source && !String(l.source).startsWith('openmaptiles')
    && l.source !== 'maptiler_planet' && String(l.source).startsWith('austin'));
  R.ourLayers = layers.map(l => ({ id: l.id, source: l.source, type: l.type, minzoom: l.minzoom }));

  // ── Q1: does `within` work, and on which geometry types? ─────────
  // A square ~600 m on a side around the camera centre.
  const c = m.getCenter();
  const dLat = 0.0027, dLon = 0.0031;
  const poly = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[
    [c.lng - dLon, c.lat - dLat], [c.lng + dLon, c.lat - dLat],
    [c.lng + dLon, c.lat + dLat], [c.lng - dLon, c.lat + dLat],
    [c.lng - dLon, c.lat - dLat]]] } };

  const probe = (id) => {
    if (!m.getLayer(id)) return { id, present: false };
    const before = m.getFilter(id) ?? null;
    let accepted = false, threw = null, counted = null;
    try {
      m.setFilter(id, before ? ['all', before, ['within', poly]] : ['within', poly]);
      accepted = true;
      // querySourceFeatures ignores the layer filter, so count via
      // queryRenderedFeatures which does honour it.
      counted = m.queryRenderedFeatures({ layers: [id] }).length;
    } catch (e) { threw = String(e.message || e); }
    try { m.setFilter(id, before); } catch (e) {}
    return { id, present: true, accepted, threw, renderedWithFilter: counted };
  };

  R.within = {
    polygonLayers: ['buildings-3d', 'outer-3d', 'outer-tower'].map(probe),
    pointLayers: ['trees-canopy', 'trees-trunk'].map(probe),
  };

  // ── Q4: is queryRenderedFeatures usable as a counter here? ───────
  R.qrf = {};
  for (const id of ['buildings-3d', 'outer-3d', 'trees-canopy']) {
    if (!m.getLayer(id)) continue;
    R.qrf[id] = { rendered: m.queryRenderedFeatures({ layers: [id] }).length };
  }
  R.qsf = {};
  for (const s of ['austin-buildings', 'austin-outer', 'austin-trees']) {
    if (!m.getSource(s)) continue;
    try { R.qsf[s] = m.querySourceFeatures(s).length; } catch (e) { R.qsf[s] = 'threw: ' + e.message; }
  }

  // ── Q2: what does setFilter cost, and does it re-tile? ───────────
  const t0 = performance.now();
  const N = 20;
  const base = m.getFilter('outer-3d') ?? null;
  for (let i = 0; i < N; i++) {
    const k = 0.002 + i * 0.0001;
    const p2 = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[
      [c.lng - k, c.lat - k], [c.lng + k, c.lat - k],
      [c.lng + k, c.lat + k], [c.lng - k, c.lat + k], [c.lng - k, c.lat - k]]] } };
    m.setFilter('outer-3d', base ? ['all', base, ['within', p2]] : ['within', p2]);
  }
  const t1 = performance.now();
  m.setFilter('outer-3d', base);
  R.setFilterMsPerCall = +((t1 - t0) / N).toFixed(3);

  // Does setFilter mark the source as re-tiling? areTilesLoaded going false
  // right after the call would mean a worker round trip per camera move.
  m.setFilter('outer-3d', base ? ['all', base, ['within', poly]] : ['within', poly]);
  R.tilesLoadedImmediatelyAfterSetFilter = m.areTilesLoaded();
  m.setFilter('outer-3d', base);

  return R;
});

fs.writeFileSync('shots/lod-capability.json', JSON.stringify(out, null, 1));
const brief = { within: out.within, qrf: out.qrf, qsf: out.qsf,
  setFilterMsPerCall: out.setFilterMsPerCall,
  tilesLoadedImmediatelyAfterSetFilter: out.tilesLoadedImmediatelyAfterSetFilter,
  ourLayerCount: out.ourLayers.length,
  fillExtrusionLayerCount: out.ourLayers.filter(l => l.type === 'fill-extrusion').length };
console.log(JSON.stringify(brief, null, 1));
console.log('page errors:', errors.length ? errors.slice(0, 3).join(' | ') : 'none');
browser.__done();
