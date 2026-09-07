/**
 * aptfloat.mjs — the floating-detail sweep, over EVERY authored building.
 *
 * The instrument. A NADIR POINT query, at points at least 2.5 m INSIDE the
 * authored ring. Nadir because an oblique query answers along the view ray
 * and would hand back the tower's own strips from over a five-storey wing.
 * A point rather than a box because a box takes the ring's bounding
 * RECTANGLE, and every neighbour that falls in that rectangle answers — the
 * first cut of this script read Prather Hall, Torchy's Tacos and The Venue on
 * Guadalupe as defects on three different buildings. Inside by a margin for
 * the same reason: a party wall cannot reach 2.5 m into our plan.
 *
 * The assertion. Over an authored footprint, a layer in the generator's hide
 * plan must return NOTHING — not "nothing tall", nothing. Those layers draw
 * the building this file has replaced, and it is replaced whole. Everything
 * else answering there is reported with its height, so a pass nobody has
 * hidden yet shows up as itself (that is how moody-wall was found).
 *
 *   PTS=<aptpts.json> OUT=<dir> TAG=<on|off> node aptfloat.mjs [extraQuery]
 */
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { launch } from './chrome.mjs';
const BASE = process.env.VERIFY_URL || 'http://127.0.0.1:8153';
const OUT = process.env.OUT; if (OUT) fs.mkdirSync(OUT, { recursive: true });
const PTS = JSON.parse(fs.readFileSync(process.env.PTS, 'utf8'));
const TAG = process.env.TAG || 'on';
const EXTRA = process.argv[2] || '';
// The hide plan's layers, by the group they belong to in js/slopes-apartments.js.
// Nothing in here may answer over an authored footprint while the generator draws.
const OURS = ['buildings-3d', 'buildings-roof', 'wc-wall', 'wc-wall-cap', 'wc-solid', 'wc-detail',
              'campus-storeys', 'roofscape-deck', 'roofscape-major', 'roofscape-minor',
              'roofs-pitched', 'parts-3d', 'parts-roof', 'moody-wall', 'moody-roof', 'moody-plant', 'moody-cap'];
const browser = await launch(chromium, { gl: 'hardware', maxMs: 2400000 });
const pg = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.goto(`${BASE}/index.html?intro=0&drift=0${EXTRA}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await pg.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 240000 });
await pg.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
await pg.evaluate(() => { if (window.GFX) window.GFX.autoExposure = false; });
await pg.waitForTimeout(30000);
await pg.evaluate(() => window.applyTimeOfDay(window.__map, 0.30, true));
console.log('hidden:', JSON.stringify(await pg.evaluate(() => window.slopesApartments && window.slopesApartments.hidden)));
const tops = Object.fromEntries((await pg.evaluate(() => (window.slopesApartments.built || []).map(b => [b.name, b.top]))));
const rows = [];
for (const b of PTS) {
  const c = [b.pts.reduce((s, p) => s + p[0], 0) / b.pts.length, b.pts.reduce((s, p) => s + p[1], 0) / b.pts.length];
  await pg.evaluate(o => window.__map.jumpTo(o), { center: c, zoom: 18.5, pitch: 0, bearing: 0 });
  await pg.waitForTimeout(1500);
  await pg.evaluate(() => new Promise(r => { const m = window.__map; const t = setTimeout(r, 4500); m.once('idle', () => { clearTimeout(t); r(); }); }));
  const hit = await pg.evaluate(({ pts, ours, top }) => {
    const m = window.__map, mine = {}, other = {};
    // THE ASSERTION, at every interior point, restricted to the layers it is
    // about. An unrestricted query asks every layer in the style at every
    // pixel: that is 45 s per building, and the first run of this sweep never
    // finished inside the browser's own cap.
    const live = ours.filter(id => m.getLayer(id));
    for (const c of pts) {
      const p = m.project(c);
      if (p.x < 0 || p.y < 0 || p.x > m.getCanvas().clientWidth || p.y > m.getCanvas().clientHeight) continue;
      for (const f of m.queryRenderedFeatures([p.x, p.y], { layers: live })) {
        const id = f.layer && f.layer.id;
        if (!id) continue;
        const q = f.properties || {}, h = +(q.h ?? q.height ?? q.final_height ?? NaN);
        if (!mine[id]) mine[id] = { n: 0, maxH: null, eg: null };
        mine[id].n++;
        if (!Number.isNaN(h) && (mine[id].maxH === null || h > mine[id].maxH)) {
          mine[id].maxH = h;
          mine[id].eg = { b: q.b, h, name: q.name, id: q.id, host: q.host, f: q.f, kind: q.kind };
        }
      }
    }
    // DISCOVERY, at a handful of points only. The bucket above is restricted
    // to the hide plan; this one is how a pass NOBODY hides gets found in the
    // first place (it is how moody-wall was), so it has to ask every layer —
    // which is expensive, so it asks at eight points rather than eighty.
    const step = Math.max(1, Math.ceil(pts.length / 8));
    for (let i = 0; i < pts.length; i += step) {
      const p = m.project(pts[i]);
      if (p.x < 0 || p.y < 0 || p.x > m.getCanvas().clientWidth || p.y > m.getCanvas().clientHeight) continue;
      for (const f of m.queryRenderedFeatures([p.x, p.y])) {
        const id = f.layer && f.layer.id;
        if (!id || f.layer.type !== 'fill-extrusion' || ours.indexOf(id) >= 0) continue;
        const q = f.properties || {}, h = +(q.h ?? q.height ?? q.final_height ?? NaN);
        if (!other[id]) other[id] = { n: 0, maxH: null, eg: null };
        other[id].n++;
        if (!Number.isNaN(h) && (other[id].maxH === null || h > other[id].maxH)) { other[id].maxH = h; other[id].eg = { b: q.b, h, name: q.name, id: q.id, kind: q.kind }; }
      }
    }
    // what stands ABOVE this building's own top and is nobody's hide plan yet
    const above = {};
    if (top != null) for (const [id, v] of Object.entries(other)) if (v.maxH != null && v.maxH > top + 0.5) above[id] = v;
    return { mine, other: above };
  }, { pts: b.pts, ours: OURS, top: tops[b.name] ?? null });
  rows.push({ name: b.name, top: tops[b.name] ?? null, ...hit });
  const m = Object.keys(hit.mine), o = Object.keys(hit.other);
  const flag = m.length ? 'HIDE-PLAN LEAK' : (o.length ? 'ABOVE TOP    ' : 'ok           ');
  console.log(`${flag} ${b.name.padEnd(34)} top ${String(tops[b.name] ?? '-').padStart(6)}  ${m.length ? JSON.stringify(hit.mine) : ''}${o.length ? ' | ' + JSON.stringify(hit.other) : ''}`);
}
if (OUT) fs.writeFileSync(`${OUT}/float-${TAG}.json`, JSON.stringify(rows, null, 1));
console.log('SUMMARY leaks:', rows.filter(r => Object.keys(r.mine).length).map(r => r.name).join(', ') || 'none');
console.log('SUMMARY above-top:', rows.filter(r => Object.keys(r.other).length).map(r => r.name).join(', ') || 'none');
if (errs.length) console.log('PAGE ERRORS:', errs.slice(0, 6).join(' | '));
browser.__done();
