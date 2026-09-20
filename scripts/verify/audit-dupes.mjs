/**
 * audit-dupes.mjs — is anything else still drawn where an authored building
 * stands? (a legacy prism through or beside the mesh; two versions at once)
 *
 *   VERIFY_URL=http://127.0.0.1:8671 node audit-dupes.mjs <outDir> [--zooms 18,16]
 *
 * For every authored building (js/slopes-apartments.js data, the footprint
 * ring and any `hideRings`), look STRAIGHT DOWN at it (pitch 0 — the one
 * angle where queryRenderedFeatures answers for fill-extrusion; at a flying
 * pitch it returns nothing either way, see js/lod.js's header) and ask every
 * building-like fill-extrusion layer what it drew at a 5x5 grid of points
 * inside the footprint, inset 1.5 m. The mesh is a custom layer and never
 * answers, so any hit is an OLD extrusion inside the new building's outline.
 * A control point on an ordinary building must hit, or the probe is blind.
 *
 * Done at two zooms, because the tiled outer ring changes its features with
 * zoom and a filter that holds at one can miss at the other.
 * Writes <outDir>/dupes.json and a top-down pair (mesh on | mesh hidden) for
 * the worst offenders.
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { BASE, launch } from './chrome.mjs';
import { applySwaps } from './audit-lib.mjs';

const OUT = process.argv[2];
if (!OUT) { console.error('usage: audit-dupes.mjs <outDir> [--zooms 18,16]'); process.exit(2); }
const zi = process.argv.indexOf('--zooms');
const ZOOMS = (zi > 0 ? process.argv[zi + 1] : '18,16').split(',').map(Number);
fs.mkdirSync(OUT, { recursive: true });

const browser = await launch(chromium, { gl: 'hardware', maxMs: 3600000 });
const page = await browser.newPage({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await applySwaps(page);
await page.goto(BASE + '/?intro=0&drift=0&clip=1', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded() && !document.getElementById('veil'), null, { timeout: 400000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
await page.waitForFunction(() => window.slopesApartments && window.slopesApartments.readyToReveal() && window.slopesApartments.count.done, null, { timeout: 400000 });

// js/app.js drops the authored buildings for the whole visit when they are not
// ready 90 s into the load (INTRO.authoredCeilingMs) — which happens on this
// laptop whenever other lanes' browsers are running. Measuring duplicates or
// lighting on the legacy fallback would measure the wrong scene, so switch
// them back on and wait for the mesh, and say so.
const handoff = await page.evaluate(() => ({ on: !!(window.APARTMENTS && window.APARTMENTS.on), group: !!(window.slopesApartments && window.slopesApartments.group), fallback: window.__intro && window.__intro.modelFallback || null }));
if (!handoff.on || !handoff.group) {
  console.log('[audit] authored buildings were not in the scene (' + JSON.stringify(handoff) + ') - re-enabling and waiting');
  await page.evaluate(() => { window.APARTMENTS.on = true; window.applySlopesApartments(window.__map); });
  await page.waitForFunction(() => window.slopesApartments.group && window.slopesApartments.readyToReveal(), null, { timeout: 900000 });
}

const buildings = await page.evaluate(() => (window.slopesApartments.data.buildings || [])
  .filter(b => b.footprint && b.footprint.ring)
  .map(b => ({ name: b.name, id: b.id, ring: b.footprint.ring, hideRings: b.hideRings || [], preserveRoof: !!b.preserveRoof })));
const built = await page.evaluate(() => window.slopesApartments.built.map(b => b.name));
console.log(`${buildings.length} authored footprints, ${built.length} built`);

// building-like layers: every fill-extrusion except the obvious non-buildings
const LAYERS = await page.evaluate(() => window.__map.getStyle().layers
  .filter(l => l.type === 'fill-extrusion' && !/^(trees|props|ground|water|stadium-field|campus-landscape|entrances-|signs|places-label|walk)/.test(l.id))
  .map(l => l.id));

const results = [];
for (const z of ZOOMS) {
  let n = 0;
  for (const b of buildings) {
    n++;
    const r = await page.evaluate(async ({ b, z, LAYERS }) => {
      const m = window.__map;
      const ring = b.ring;
      let cx = 0, cy = 0; for (const p of ring) { cx += p[0] / ring.length; cy += p[1] / ring.length; }
      m.jumpTo({ center: [cx, cy], zoom: z, pitch: 0, bearing: 0 });
      // `idle` rarely fires here (the sky repaints every frame): wait for the
      // tiles, bounded, then two frames so the query sees this pose's buckets.
      const t0 = performance.now();
      while (!m.areTilesLoaded() && performance.now() - t0 < 4000) await new Promise(r => setTimeout(r, 100));
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const inside = (p, r) => { let y = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i][1] > p[1]) !== (r[j][1] > p[1]) && p[0] < (r[j][0] - r[i][0]) * (p[1] - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) y = !y; return y; };
      // distance (m) from p to the ring's edges, for the inset
      const cos = Math.cos(cy * Math.PI / 180);
      const edgeDist = p => { let best = 1e9; for (let i = 0; i < ring.length - 1; i++) { const a = ring[i], c = ring[i + 1]; const ax = (a[0] - p[0]) * 111320 * cos, ay = (a[1] - p[1]) * 110540, bx = (c[0] - p[0]) * 111320 * cos, by = (c[1] - p[1]) * 110540; const dx = bx - ax, dy = by - ay; const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1))); best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy)); } return best; };
      let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
      for (const p of ring) { minx = Math.min(minx, p[0]); maxx = Math.max(maxx, p[0]); miny = Math.min(miny, p[1]); maxy = Math.max(maxy, p[1]); }
      const hits = {}, pts = [];
      for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
        const p = [minx + (maxx - minx) * (i + 0.5) / 5, miny + (maxy - miny) * (j + 0.5) / 5];
        if (!inside(p, ring) || edgeDist(p) < 1.5) continue;
        pts.push(p);
        const px = m.project(p);
        const fs = m.queryRenderedFeatures([px.x, px.y], { layers: LAYERS.filter(id => m.getLayer(id)) });
        for (const f of fs) {
          const k = f.layer.id + '|' + (f.properties.id ?? f.properties.bid ?? f.properties.name ?? f.id ?? '?');
          hits[k] = hits[k] || { layer: f.layer.id, fid: f.properties.id ?? f.properties.bid ?? f.id ?? null, name: f.properties.name ?? null, h: f.properties.h ?? f.properties.height ?? f.properties.final_height ?? null, points: 0 };
          hits[k].points++;
        }
      }
      return { points: pts.length, centre: [cx, cy], hits: Object.values(hits) };
    }, { b, z, LAYERS });
    results.push({ zoom: z, name: b.name, id: b.id, built: built.includes(b.name), ...r });
    if (r.hits.length) console.log(`z${z} ${b.name}: ${r.points} pts, ${r.hits.map(h => `${h.layer}(${h.fid ?? h.name ?? '?'}, h ${h.h}) x${h.points}`).join('; ')}`);
    if (n % 40 === 0) console.log(`  z${z}: ${n}/${buildings.length}`);
  }
}
// control: a plain campus building (Gregory Gym area is authored elsewhere;
// use the Main Building's neighbour, Batts Hall) must hit buildings-3d.
const control = await page.evaluate(async () => {
  const m = window.__map; m.jumpTo({ center: [-97.73878, 30.28527], zoom: 18, pitch: 0, bearing: 0 });
  await new Promise(res => { let d = false; const f = () => { if (!d) { d = true; res(); } }; m.once('idle', f); setTimeout(f, 5000); });
  const c = m.project([-97.73878, 30.28527]);
  return m.queryRenderedFeatures([c.x, c.y]).filter(f => f.layer.type === 'fill-extrusion').map(f => f.layer.id);
});
console.log('control hits:', control);

// Pictures of the worst offenders at the first zoom: mesh on | mesh hidden.
const worst = results.filter(r => r.zoom === ZOOMS[0] && r.hits.some(h => h.points >= 3)).sort((a, b) => b.hits.reduce((s, h) => s + h.points, 0) - a.hits.reduce((s, h) => s + h.points, 0)).slice(0, 6);
for (const w of worst) {
  const slug = String(w.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
  await page.evaluate(async (c) => { const m = window.__map; m.jumpTo({ center: c, zoom: 18.3, pitch: 0, bearing: 0 }); await new Promise(res => { let d = false; const f = () => { if (!d) { d = true; res(); } }; m.once('idle', f); setTimeout(f, 6000); }); }, w.centre);
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, `dupe-${slug}-mesh.jpg`), type: 'jpeg', quality: 82 });
  await page.evaluate(() => { const g = window.slopesApartments.group; if (g) g.visible = false; window.__map.triggerRepaint(); });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, `dupe-${slug}-nomesh.jpg`), type: 'jpeg', quality: 82 });
  await page.evaluate(() => { const g = window.slopesApartments.group; if (g) g.visible = true; window.__map.triggerRepaint(); });
}
const summary = {};
for (const r of results) for (const h of r.hits) { const k = `z${r.zoom} ${h.layer}`; summary[k] = (summary[k] || 0) + 1; }
fs.writeFileSync(path.join(OUT, 'dupes.json'), JSON.stringify({ zooms: ZOOMS, layers: LAYERS, control, summary, results }, null, 1));
console.log('summary (buildings with a hit, by layer):', JSON.stringify(summary, null, 1));
await browser.__done();
