/**
 * walkwidth.mjs — is the walk on screen as wide as the survey says it is?
 *
 * WHY THIS EXISTS. `scripts/trace_walk_widths.py` measures each walk against
 * the City of Austin's planimetric paved-surface survey and writes
 * `data/walkway_widths.json`; `scripts/bake_ground.py` reads that and buffers
 * the centreline by half of it. Both of those are files. This is the step
 * that says the number reached the SCENE — the bake trap in this repo has
 * twice been "a real-looking diff that served the identical old city".
 *
 * HOW. Near-nadir camera, trees hidden, then for each target way: walk
 * outward from a station on its centreline in RENDER space, asking the map
 * at each screen pixel whether a `k:'patharea'` polygon is drawn there. The
 * drawn width is where that stops being true on both sides. That is the
 * geometry the renderer actually has tiled at that pixel, not a re-read of
 * the file it came from.
 *
 * WHAT IT DOES AND DOES NOT PROVE. It proves the ribbon in the scene is the
 * width the survey measured. It does NOT prove a particular pixel colour —
 * `banding.mjs` and `dusk.mjs` own that question, and a width is a geometry
 * question. It also cannot separate one walk from a walk it has been UNIONED
 * with: `widen_paths` merges every path into one surface, so a station near
 * a junction legitimately reads wider than its own way. Targets are chosen
 * mid-way for that reason and the tolerance says so.
 *
 * Usage:
 *   node walkwidth.mjs                 assert, exit 1 on failure
 *   node walkwidth.mjs --shots pfx     also screenshot each target's pose
 *   node walkwidth.mjs --break         hide the ground path layer; must go red
 */
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const BREAK = argv.includes('--break');
const SHOTS = argv.includes('--shots') ? argv[argv.indexOf('--shots') + 1] : null;

// ── the targets ───────────────────────────────────────────────────────────
// Four campus walks spanning the range the survey found, each measured at a
// station well away from a junction so the path union is not being asked
// about someone else's slab. `want` is NOT typed in here — it is read out of
// the served data/walkway_widths.json at run time, so this file cannot drift
// from the evidence, and a way that loses its row fails loudly.
const TARGETS = [
  { id: '1216105912', note: 'a narrow service walk' },
  { id: '1058218049', note: 'a narrow campus walk' },
  { id: '126328774', note: 'a wide South Mall approach' },
  { id: '1120921416', note: 'a wide walk on the west side' },
];
const TOL_M = 0.8;          // the union, and one screen pixel at this zoom
const NADIR_ZOOM = 19.5;
const PROBE_MAX_M = 12.0;
const PROBE_STEP_M = 0.10;

const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));

// _harness.html for the same reason every pixel script in here uses it.
await page.goto(`${BASE}/_harness.html?drift=0&intro=0`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
await page.waitForTimeout(4000);
// README law: the auto-detect probe rewrites every graphics setting 11 s in.
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

const hidden = await page.evaluate(() => {
  const m = window.__map;
  const ids = m.getStyle().layers.map(l => l.id);
  const t = ids.filter(id => /tree|canopy|cnp|foliage/i.test(id));
  t.forEach(id => { try { m.setLayoutProperty(id, 'visibility', 'none'); } catch (e) {} });
  return t.length;
});
console.log(`walkwidth  ${BASE}   trees hidden: ${hidden} layer(s)`);

// The evidence and the geometry, fetched from the SAME server the page loads
// from — never read off disk, which is how a lane ends up grading a file the
// city does not serve.
const data = await page.evaluate(async () => {
  const w = await (await fetch('data/walkway_widths.json')).json();
  const f = await (await fetch('data/osm_cache/footways.json')).json();
  const g = {};
  for (const e of f.elements) if (e.geometry && e.geometry.length >= 2) g[String(e.id)] = e.geometry;
  return { widths: w.widths, gen: w.generated, src: w.source, geom: g };
});
console.log(`  evidence   data/walkway_widths.json, ${Object.keys(data.widths).length} ways, `
  + `generated ${data.gen}, from ${data.src.layer}`);

if (BREAK) {
  const n = await page.evaluate(() => {
    const m = window.__map;
    const ids = m.getStyle().layers.map(l => l.id).filter(id => /ground|path|surface/i.test(id));
    ids.forEach(id => { try { m.setLayoutProperty(id, 'visibility', 'none'); } catch (e) {} });
    return ids.length;
  });
  console.log(`  --break: ${n} ground layer(s) hidden; every assertion must go red`);
}

const outDir = path.resolve('shots');
if (SHOTS) fs.mkdirSync(outDir, { recursive: true });

let bad = 0;
const rows = [];
for (const t of TARGETS) {
  const row = await page.evaluate(async ({ t, data, NADIR_ZOOM, PROBE_MAX_M, PROBE_STEP_M }) => {
    const m = window.__map;
    const g = data.geom[t.id];
    if (!g) return { err: 'way not in footways.json' };
    const want = data.widths[t.id] && data.widths[t.id].w;
    if (want == null) return { err: 'way has no row in walkway_widths.json' };

    // a station at the way's midpoint, and the local bearing there
    const i = Math.max(1, Math.floor(g.length / 2));
    const a = g[i - 1], b = g[i];
    const lat0 = (a.lat + b.lat) / 2, lon0 = (a.lon + b.lon) / 2;
    const MPD_LAT = 110574, MPD_LON = 111320 * Math.cos(lat0 * Math.PI / 180);
    const dx = (b.lon - a.lon) * MPD_LON, dy = (b.lat - a.lat) * MPD_LAT;
    const L = Math.hypot(dx, dy) || 1;
    const nx = -dy / L, ny = dx / L;                    // unit normal, metres

    if (m.isEasing && m.isEasing()) m.stop();
    m.jumpTo({ center: [lon0, lat0], zoom: NADIR_ZOOM, pitch: 0, bearing: 0 });
    await new Promise(r => (m.loaded() ? r() : m.once('idle', r), setTimeout(r, 12000)));
    m.triggerRepaint();
    await new Promise(r => setTimeout(r, 1200));

    const off = d => [lon0 + nx * d / MPD_LON, lat0 + ny * d / MPD_LAT];
    const isWalk = ll => {
      const p = m.project(ll);
      const fs = m.queryRenderedFeatures([p.x, p.y]);
      return fs.some(f => f.properties && f.properties.k === 'patharea');
    };
    if (!isWalk([lon0, lat0])) return { err: 'no drawn walk at the centreline itself', want };
    const edge = sign => {
      let d = 0;
      while (d + PROBE_STEP_M <= PROBE_MAX_M && isWalk(off(sign * (d + PROBE_STEP_M)))) d += PROBE_STEP_M;
      return d;
    };
    const l = edge(1), r = edge(-1);
    return { want, drawn: l + r, l, r, lon0, lat0, capped: (l + r) >= PROBE_MAX_M - 1e-6 };
  }, { t, data, NADIR_ZOOM, PROBE_MAX_M, PROBE_STEP_M });

  if (SHOTS && !row.err) {
    const f = path.join(outDir, `${SHOTS}-${t.id}.png`);
    await page.screenshot({ path: f });
    await page.waitForTimeout(500);
    await page.screenshot({ path: f });
  }

  const ok = !row.err && !row.capped && Math.abs(row.drawn - row.want) <= TOL_M;
  if (!ok) bad++;
  rows.push({ t, row, ok });
  console.log(`  way ${t.id.padEnd(12)} ${t.note.padEnd(28)} `
    + (row.err ? `ERROR ${row.err}`
      : `survey ${row.want.toFixed(2)} m   drawn ${row.drawn.toFixed(2)} m   `
        + `(${row.l.toFixed(2)}/${row.r.toFixed(2)})   ${ok ? 'ok' : 'FAIL'}`));
}

// One frame a person can recognise, for the same reason CLAUDE.md rule 3
// exists: he is looking at the city, not at the table above.
const CONTEXT = [
  { name: 'southmall', center: [-97.739400, 30.284600], zoom: 17.6, pitch: 55, bearing: 0 },
  { name: 'southmall-nadir', center: [-97.739400, 30.284900], zoom: 18.2, pitch: 0, bearing: 0 },
];
if (SHOTS) {
  for (const c of CONTEXT) {
    await page.evaluate(async (c) => {
      const m = window.__map;
      if (m.isEasing && m.isEasing()) m.stop();
      m.jumpTo({ center: c.center, zoom: c.zoom, pitch: c.pitch, bearing: c.bearing });
      await new Promise(r => (m.loaded() ? r() : m.once('idle', r), setTimeout(r, 12000)));
      m.triggerRepaint();
    }, c);
    await page.waitForTimeout(2500);
    const f = path.join(outDir, `${SHOTS}-${c.name}.png`);
    await page.screenshot({ path: f });
    await page.waitForTimeout(600);
    await page.screenshot({ path: f });
    console.log(`  WROTE ${f}`);
  }
}

console.log(`\n  tolerance ${TOL_M} m — the path union merges neighbours, so this is`
  + `\n  "the ribbon in the scene is the surveyed width", not a centimetre claim.`);
if (errors.length) console.log('  ERRORS', errors.slice(0, 6));

if (BREAK) {
  console.log(`  --break: ${bad} of ${rows.length} assertions went red, as they must`);
  await browser.__done();
  process.exit(bad > 0 ? 0 : 1);
}
console.log(bad === 0 ? '  PASS' : `  FAIL — ${bad} of ${rows.length}`);
await browser.__done();
process.exit(bad === 0 ? 0 : 1);
