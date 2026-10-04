/**
 * drawn-heights.mjs - what the renderer REALLY draws for every building.
 *
 * `final_height` on the `austin-buildings` footprint is only the height of the
 * plain prism. A lot of the city is drawn some other way and the prism is hidden
 * or buried: authored apartment and campus meshes (js/slopes-apartments.js),
 * stacked West Campus bands, hero designs, parts, pitched roofs, the Tower. So a
 * table that compares a measured roof with `final_height` compares it with
 * something that is not on screen. This loads the real app and dumps what IS:
 *
 *   - every fill-extrusion layer's source features that can be a building
 *     (centroid, ring, base, top, the id-ish properties), with the layer they
 *     are drawn by;
 *   - the authored meshes' own tops (window.slopesApartments.built);
 *   - the `buildings-3d` / `buildings-roof` filters as applied, which carry the
 *     hide list of footprints whose prism is not drawn.
 *
 * scripts/lidar_drawn.py joins that to the footprints. No screenshot is taken,
 * so the run does not depend on the compositor.
 *
 * Usage: node drawn-heights.mjs <out.json> [query]
 *   query: extra URL query, e.g. "lidarheights=1" (same contract as SHOT_Q).
 * Set VERIFY_GL=hardware for the real GPU (see chrome.mjs); software rendering
 * is far slower on a laptop that is doing anything else.
 */
import { chromium } from 'playwright-core';
import { chromePath, BASE as SERVER, launch } from './chrome.mjs';
import fs from 'node:fs';

const OUT = process.argv[2] || 'drawn.json';
const QUERY = process.argv[3] || process.env.SHOT_Q || '';
const BASE = SERVER + '/_harness.html?intro=0&drift=0' + (QUERY ? '&' + QUERY.replace(/^[?&]/, '') : '');

const t0 = Date.now();
const log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(0).padStart(4) + ' s', ...a);

const browser = await launch(chromium, { maxMs: 600000 });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const consoleLines = [];
page.on('console', m => { const t = m.text(); if (/lidar|\[scene\]|slopes-apartments\]/i.test(t)) consoleLines.push(t.slice(0, 200)); });
page.on('pageerror', e => consoleLines.push('PAGEERROR ' + e.message));

await page.goto(BASE, { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
log('style loaded');
await page.waitForFunction(() => {
  const m = window.__map;
  if (!m || !m.getSource('austin-buildings')) return false;
  return ['austin-buildings', 'austin-ground', 'austin-trees', 'austin-roofscape', 'austin-tower',
          'austin-westcampus', 'austin-drag', 'austin-arts', 'austin-moody', 'austin-stadium']
    .every(s => !m.getSource(s) || m.isSourceLoaded(s));
}, null, { timeout: 150000 }).catch(() => log('WARN: sources not all loaded'));
// The authored meshes are built in time slices under the veil; their tops are
// only readable once the build has finished.
await page.waitForFunction(() => {
  const a = window.slopesApartments;
  return !a || (a.group && a.count && a.count.ms > 0 && a.built && a.built.length > 0 && a.readyToReveal && a.readyToReveal());
}, null, { timeout: 240000, polling: 500 }).catch(() => log('WARN: authored meshes not ready'));
await page.waitForFunction(() => !document.getElementById('veil'), null, { timeout: 120000, polling: 500 })
  .catch(() => log('WARN: veil still up'));
log('veil', await page.evaluate(() => JSON.stringify(window.__intro ? { reason: window.__intro.reason, waitedMs: window.__intro.waitedMs } : null)));
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
await page.waitForTimeout(3000);

const SKIP_LAYER = /^(buildings-3d|buildings-roof|buildings-ao|roofscape-)|tree|trunk|canopy|shrub|bush|grass|lawn|path|walk|road|curb|ground|garden|landscape|prop|lamp|bench|sign|door|entrance|fence|water|turf|plaza|stair|crossing|hedge/i;

const dump = await page.evaluate(async (skipSrc) => {
  const skip = new RegExp(skipSrc, 'i');
  const map = window.__map;
  const style = map.getStyle();
  const layers = [];
  const bySource = new Map();
  for (const l of style.layers) {
    if (l.type !== 'fill-extrusion') continue;
    const src = style.sources[l.source];
    const info = {
      id: l.id, source: l.source, vector: !!(src && src.type !== 'geojson'),
      h: JSON.stringify(l.paint && l.paint['fill-extrusion-height']),
      b: JSON.stringify(l.paint && l.paint['fill-extrusion-base']),
      filter: JSON.stringify(map.getFilter(l.id) || null),
      skipped: skip.test(l.id),
    };
    layers.push(info);
    if (!info.vector && !info.skipped) {
      if (!bySource.has(l.source)) bySource.set(l.source, []);
      bySource.get(l.source).push(layers.length - 1);
    }
  }
  const dataOf = async (sid) => {
    const s = map.getSource(sid);
    let d = null;
    try { d = s.serialize ? s.serialize().data : s._data; } catch (e) {}
    if (typeof d === 'string') d = await (await fetch(d)).json();
    return d;
  };
  const num = v => (typeof v === 'number' && isFinite(v)) ? v : null;
  const exprProps = (s) => {
    let m = /^\["get","(\w+)"\]$/.exec(s || '');
    if (m) return { kind: 'get', p: [m[1]] };
    m = /^\["\+",\["get","(\w+)"\],\["get","(\w+)"\]\]$/.exec(s || '');
    if (m) return { kind: 'sum', p: [m[1], m[2]] };
    return { kind: 'other', p: ['h', 'final_height', 'dh'] };
  };
  const feats = [];
  const sourceStats = {};
  for (const [sid, idxs] of bySource) {
    const data = await dataOf(sid);
    if (!data || !data.features) { sourceStats[sid] = 'no data'; continue; }
    sourceStats[sid] = data.features.length;
    const hps = idxs.map(li => exprProps(layers[li].h)), bps = idxs.map(li => exprProps(layers[li].b));
    for (const f of data.features) {
      const p = f.properties || {};
      // a feature drawn by several layers (wc-wall, wc-wall-cap, wc-solid ...) is
      // reported ONCE, by the layer that draws it highest
      let top = null, best = -1;
      for (let k = 0; k < idxs.length; k++) {
        const hp = hps[k];
        let t = null;
        if (hp.kind === 'sum') t = (num(p[hp.p[0]]) ?? 0) + (num(p[hp.p[1]]) ?? 0);
        else if (hp.kind === 'get') t = num(p[hp.p[0]]);
        else { for (const key of hp.p) { const v = num(p[key]); if (v != null && (t == null || v > t)) t = v; } }
        if (t != null && (top == null || t > top)) { top = t; best = k; }
      }
      if (top == null || top < 2.5) continue;
      const g = f.geometry;
      if (!g) continue;
      const poly = g.type === 'Polygon' ? g.coordinates : g.type === 'MultiPolygon' ? g.coordinates[0] : null;
      if (!poly || !poly[0] || poly[0].length < 4) continue;
      let ring = poly[0];
      let cx = 0, cy = 0;
      for (const c of ring) { cx += c[0]; cy += c[1]; }
      cx /= ring.length; cy /= ring.length;
      if (ring.length > 40) {   // keep the payload small: a long ring becomes its bounding box
        let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
        for (const c of ring) { if (c[0] < x0) x0 = c[0]; if (c[0] > x1) x1 = c[0]; if (c[1] < y0) y0 = c[1]; if (c[1] > y1) y1 = c[1]; }
        ring = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
      }
      const bp = bps[best];
      const base = bp.kind === 'get' ? (num(p[bp.p[0]]) ?? 0) : 0;
      const ids = {};
      for (const k of ['id', 'bid', 'pid', 'parent', 'b', 'host', 'name', 'kind', 'building_id']) if (p[k] != null) ids[k] = p[k];
      feats.push([idxs[best], +cx.toFixed(6), +cy.toFixed(6), +base.toFixed(2), +top.toFixed(2),
                  ring.map(c => [+c[0].toFixed(6), +c[1].toFixed(6)]), ids]);
    }
  }
  let built = [];
  try { built = window.slopesApartments ? window.slopesApartments.built.map(b => ({ name: b.name, id: b.id, top: b.top })) : []; } catch (e) {}
  const filters = {};
  for (const id of ['buildings-3d', 'buildings-roof']) { try { filters[id] = JSON.stringify(map.getFilter(id)); } catch (e) {} }
  // Footprints of the base layer, with the height each prism was given on load.
  const base = await dataOf('austin-buildings');
  const prisms = (base && base.features || []).map(f => {
    const p = f.properties || {};
    return { id: p.id, name: p.name || '', final_height: p.final_height, prior: p.final_height_prior ?? null,
             source: p.source_height || '', has_parts: !!p.has_parts };
  });
  window.__drawnFeats = feats;
  return { layers, nFeats: feats.length, built, filters, prisms, sourceStats,
           lidar: { on: !!(window.LIDAR_HEIGHTS && window.LIDAR_HEIGHTS.on), changed: window.LIDAR_HEIGHTS ? window.LIDAR_HEIGHTS.changed : null },
           intro: window.__intro ? { reason: window.__intro.reason, waitedMs: window.__intro.waitedMs } : null };
}, SKIP_LAYER.source);

// pull the features across in slices: one huge evaluate result can stall the protocol
dump.feats = [];
for (let i = 0; i < dump.nFeats; i += 15000) {
  dump.feats.push(...await page.evaluate((i) => window.__drawnFeats.slice(i, i + 15000), i));
}
dump.console = consoleLines;
fs.writeFileSync(OUT, JSON.stringify(dump));
log('layers', dump.layers.length, 'features', dump.feats.length, 'built meshes', dump.built.length, 'prisms', dump.prisms.length);
log('lidar knob', JSON.stringify(dump.lidar));
log('wrote', OUT);
await browser.__done();
