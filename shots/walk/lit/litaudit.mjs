/**
 * litaudit.mjs — does the lighting claim match the scene, measured over a
 * SAMPLE rather than at six hand-picked places?
 *
 * Round 1 of this lane verified its claim at six sites it chose by eye and by
 * extremes (the pin furthest from a lamp, the pin nearest one). Six frames is
 * an anecdote. The judged question is whether the lit/unlit claim matches the
 * lamps actually present in the 3D scene AT THAT LOCATION, and the only honest
 * form of that answer is a confusion matrix over sites the script picked, not
 * the author.
 *
 * TWO PARTS, ONE PAGE LOAD.
 *
 * A. INVENTORY. `data/walk_lamps.json` is republished from `data/props.geojson`,
 *    but the page does not read that GeoJSON — it streams `data/tiles/props.
 *    pmtiles`. Those are two files, baked at two times, and nothing in this repo
 *    checks that they agree. If the tiles are stale the scene draws lamps the
 *    index never heard of (a claim that reads "none mapped" while a pole stands
 *    in frame) or misses lamps the index counts. Part A grids the render bbox,
 *    reads the props SOURCE (not the screen), and matches every drawn `k:lit`
 *    point against the index by coordinate.
 *
 * B. SITE AUDIT. Sample sites off REAL routes, half where the index says a
 *    mapped lamp covers the walk and half where it says none does, and go and
 *    look at each one at night. Per site, three reads:
 *      - queryRenderedFeatures  — what the renderer will admit to drawing
 *      - a BASE framebuffer     — what is actually lit on screen
 *      - a MASK framebuffer     — night-lamps.mjs's method: repaint the four
 *        light layers in flat primaries and diff, which separates a SURVEYED
 *        lamp (props-lit / props-lit-core) from js/night.js's DECORATIVE road
 *        pool (night-streetlight-pool / -core). Those two look identical to a
 *        walker and only one of them is a fact.
 *    That separation is the point. Round 1 found the decorative pools at one
 *    site, called it "not a defect in this lane's claim", and moved on. Whether
 *    that is a footnote or the headline depends on a number nobody had.
 *
 * TRAPS THIS SCRIPT IS BUILT AROUND, all previously paid for in this repo:
 *   - `queryRenderedFeatures` returns nothing for props above ~70° pitch, at
 *     every zoom (docs/walk-lit.md §4). Every pose here is pitch <= 62.
 *   - `page.evaluate(ll => window.__map.jumpTo({...}), ll)` with an
 *     expression-bodied arrow returns the Map and hangs CDP forever. Braces.
 *   - triggerRepaint SCHEDULES a frame; readPixels straight after returns the
 *     previous one. Two rAFs before every read.
 *   - the time-of-day is ASSERTED after setting it, never assumed.
 *
 * Usage:
 *   VERIFY_URL=http://127.0.0.1:8714 node shots/walk/lit/litaudit.mjs \
 *     [--sites 24] [--shots 12] [--tod 0.92] [--tag r2]
 */
// This file lives outside scripts/verify (lane ownership), so node's resolver
// will not find that directory's node_modules. Reach for the package by path
// rather than moving the script into a directory this lane does not own.
import { chromium } from '../../../scripts/verify/node_modules/playwright-core/index.mjs';
import { BASE, launch } from '../../../scripts/verify/chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const N_SITES = parseInt(opt('--sites', '24'), 10);   // per class, so 2x this
const N_SHOTS = parseInt(opt('--shots', '12'), 10);   // frames kept on disk
const TOD = parseFloat(opt('--tod', '0.92'));
const TAG = opt('--tag', 'r2');
const OUT = 'shots/walk/lit';

// ── taste/measurement constants, all named (CLAUDE.md rule 11) ───────────
// THE FRAME IS THE CLAIM. The first cut of this posed a camera at pitch 55 and
// counted lights in the whole frame — which at that pitch sees several hundred
// metres up the street, so two sites came back "said none mapped, a lamp IS on
// screen" when the lamp was 300 m away and had nothing to do with the claim.
// A claim about a 25 m disc has to be measured on that disc. So: plan view,
// site dead centre, and a zoom chosen so the disc is a circle of a known pixel
// radius about the frame centre — which also makes the flip between WebGL's
// bottom-left origin and screen coordinates irrelevant, because a circle about
// the centre is the same circle either way up.
const SITE_ZOOM = 19.8;      // the 25 m disc lands at ~338 px of an 800 px frame:
                             // big enough to mean something, inside the frame at
                             // every edge. Asserted below, not assumed.
const SITE_PITCH = 0;        // plan. also well under the ~70 deg above which
                             // queryRenderedFeatures stops seeing props at all
const HOT_LUMA = 120;        // night-pale.mjs's own PALE, quoted so numbers compare
// FIVE classes, not four, and the fifth is the one the first run got wrong.
// `props-lit` carries BOTH the warm OSM street lamps and the blue emergency
// phones, and the card counts those separately on purpose — a call box is a
// thing you run to, not a thing that lights the pavement. Painting the whole
// layer one colour made three sites report "said none is mapped, a lamp IS on
// screen" when what was on screen was a blue phone the card had already
// counted, correctly, in its own sentence. So the mask splits on `c` too.
const MASK = {
  'props-lit':              ['match', ['get', 'c'], 'blue', '#0000ff', '#00ff00'],
  'props-lit-core':         ['match', ['get', 'c'], 'blue', '#0000ff', '#00ffff'],
  'night-streetlight-pool': '#ff00ff',   // magenta — js/night.js decoration
  'night-streetlight-core': '#ffff00',   // yellow  — its head
};
const MASK_MIN_PX = 40;      // fewer lit pixels than this in a 1280x800 frame is
                             // a stray edge, not a light standing at this site
// A decorative pool counts as "reads like a streetlight" only when it puts down
// at least this share of the footprint a REAL surveyed lamp puts down at the
// same zoom, measured on this run's own lit sites. Calibrating against the
// scene's own lamps rather than a hand-picked pixel count is the difference
// between "there is some glow here" — true almost everywhere — and "a walker
// would take this for a street light", which is the thing that would make the
// card look wrong.
const DECOR_READS_AS_LAMP_FRAC = 0.5;
const SITE_SPACING_M = 40;   // one sample per this much of a classified stretch,
                             // so a 600 m dark run is not one site and a 9 m lit
                             // one is not thirty
const WAYFIND_LIT_RADIUS_M = 25;   // must equal WAYFIND.litRadiusM; asserted below
const DARK_CLEARANCE_M = 60; // an "unmapped" site this far from the nearest
                             // counted lamp, so the sample tests the claim and
                             // not the arithmetic either side of the boundary

// Route pairs. Campus-to-campus and campus-to-West-Campus (the walk home), a
// fixed list so a rerun is comparable. Codes resolve through wayfindRoute.
const PAIRS = [
  ['ANB', 'ETC'], ['KIN', 'LTH'], ['PMA', 'JES'], ['GDC', 'JES'],
  ['UTC', 'DKR'], ['MAI', 'SZB'], ['WEL', 'BUR'], ['CLA', 'PAI'],
  ['GRE', 'JGB'], ['BAT', 'ETC'], ['UNB', 'PCL'], ['NHB', 'ECJ'],
];

const rnd = (() => { let s = 20260823; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
const MPD_LAT = 111320, MPD_LON = 96500;   // metres per degree at 30.28N
const distM = (a, b) => Math.hypot((a[0] - b[0]) * MPD_LON, (a[1] - b[1]) * MPD_LAT);

fs.mkdirSync(OUT, { recursive: true });
const log = [];
const say = (s) => { console.log(s); log.push(s); };

const browser = await launch(chromium, { gl: 'hardware' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', e => say('  [pageerror] ' + e.message));

say(`# litaudit ${TAG} — ${new Date().toISOString()}`);
say(`base=${BASE} sites=${N_SITES}/class tod=${TOD} zoom=${SITE_ZOOM} pitch=${SITE_PITCH}`);

await page.goto(BASE + '/_harness.html?intro=0&drift=0&walk=1', { waitUntil: 'networkidle', timeout: 180000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
await page.evaluate(() => { if (window.cancelGraphicsAutoDetect) window.cancelGraphicsAutoDetect(); });
await page.waitForFunction(() => !document.getElementById('veil'), null, { timeout: 120000 });

// night, then ASSERT it
await page.evaluate((v) => {
  const el = document.getElementById('tod-slider');
  if (el) {
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  if (typeof window.applyTimeOfDay === 'function') window.applyTimeOfDay(window.__map, v, true);
}, TOD);
await page.waitForTimeout(2000);
const gotP = await page.evaluate(() => window.__todCurrentP);
if (gotP == null || Math.abs(gotP - TOD) > 0.02) {
  say(`FAIL: asked for tod ${TOD}, scene is at ${gotP}`);
  await browser.close(); process.exit(1);
}
say(`tod asserted: ${gotP}`);

// The audit's own radius constant must BE the shipped one, not a copy of it
// that drifted. A confusion matrix built on 25 m while the card counts at 30 m
// would be a clean-looking table about a different feature.
const shippedR = await page.evaluate(() => (window.WAYFIND || {}).litRadiusM);
if (shippedR !== WAYFIND_LIT_RADIUS_M) {
  say(`FAIL: audit uses ${WAYFIND_LIT_RADIUS_M} m, the page ships ${shippedR} m`);
  await browser.close(); process.exit(1);
}
say(`radius asserted: ${shippedR} m`);

// framebuffer plumbing, lifted from night-lamps.mjs
await page.evaluate(() => {
  window.__la = {
    async read() {
      const m = window.__map;
      m.triggerRepaint();
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const c = m.getCanvas();
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      const w = c.width, h = c.height;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return { w, h, px };
    },
    settle(ms) {
      return new Promise(r => {
        const m = window.__map;
        m.triggerRepaint();
        if (m.loaded() && m.areTilesLoaded()) return setTimeout(r, ms || 500);
        m.once('idle', () => setTimeout(r, ms || 500));
        setTimeout(r, 20000);
      });
    },
    jump(q) { window.__map.jumpTo(q); },
  };
});

// ═══════════════════════════════════════════════════════════════════════
// PART A — inventory: every light the scene DRAWS vs every light the index
// CLAIMS. Read from the source, not the screen: querySourceFeatures returns
// what is decoded in the loaded tiles regardless of what is on camera.
// ═══════════════════════════════════════════════════════════════════════
say('');
say('## A. inventory — props tiles vs walk_lamps.json');

const idx = JSON.parse(fs.readFileSync('data/walk_lamps.json', 'utf8'));
const undelta = (o) => {
  const out = [];
  let x = 0, y = 0;
  for (let i = 0; i < o.x.length; i++) {
    x = i === 0 ? o.x[i] : x + o.x[i];
    y = i === 0 ? o.y[i] : y + o.y[i];
    out.push([x * idx.q, y * idx.q]);
  }
  return out;
};
const idxWarm = undelta(idx.warm), idxBlue = undelta(idx.blue);
say(`index: warm=${idxWarm.length} blue=${idxBlue.length} (file says ${idx.n_warm}/${idx.n_blue}), as_of ${idx.as_of}`);

// the render bbox, from the index's own extent, padded
const allIdx = idxWarm.concat(idxBlue);
let W = 180, S = 90, E = -180, N = -90;
for (const p of allIdx) { W = Math.min(W, p[0]); E = Math.max(E, p[0]); S = Math.min(S, p[1]); N = Math.max(N, p[1]); }
const PAD = 0.004;
W -= PAD; E += PAD; S -= PAD; N += PAD;
say(`index extent: ${W.toFixed(4)},${S.toFixed(4)} .. ${E.toFixed(4)},${N.toFixed(4)}`);

// A ZOOM LADDER, not a flat sweep. The first cut of this swept the whole bbox
// at one zoom and came back "137 of the index's lights are not in the tiles",
// which would have been a stale-tile scandal. It is not: `props.pmtiles` drops
// points at low zoom the way every vector tileset does, so the honest question
// is not "does the scene carry them" but "ABOVE WHICH ZOOM does it". The claim
// is made to somebody planning a walk, who may be at any of these.
//
// At each anchor and zoom: count the index points inside the map's OWN bounds,
// and the distinct `k:lit` points the source decodes there. Ratio = the share
// of the lights we count that the scene is drawing at that altitude.
const LADDER_Z = [15.0, 16.0, 17.0, 18.0, 19.4];
const ANCHORS = [
  { name: 'campus-core', at: [-97.7383, 30.2860] },
  { name: 'west-campus', at: [-97.7460, 30.2865] },
  { name: 'the-drag', at: [-97.7418, 30.2865] },
  { name: 'south-campus', at: [-97.7390, 30.2812] },
];
const ladder = [];
let stops = 0;
for (const a of ANCHORS) {
  for (const z of LADDER_Z) {
    await page.evaluate((q) => { window.__la.jump(q); }, { center: a.at, zoom: z, pitch: 0, bearing: 0 });
    await page.evaluate(() => window.__la.settle(350));
    const got = await page.evaluate(() => {
      const m = window.__map;
      if (!m.getSource('austin-props')) return { err: 'nosource' };
      let feats = [];
      try {
        feats = m.querySourceFeatures('austin-props', { sourceLayer: 'props', filter: ['==', ['get', 'k'], 'lit'] });
      } catch (e) {
        try { feats = m.querySourceFeatures('austin-props', { filter: ['==', ['get', 'k'], 'lit'] }); }
        catch (e2) { return { err: String(e2) }; }
      }
      const b = m.getBounds();
      return {
        bounds: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()],
        pts: feats.map(f => (f.geometry && f.geometry.coordinates) || null).filter(Boolean),
      };
    });
    stops++;
    if (got.err) { say(`  querySourceFeatures error: ${got.err}`); break; }
    const [bw, bs, be, bn] = got.bounds;
    const inView = allIdx.filter(p => p[0] >= bw && p[0] <= be && p[1] >= bs && p[1] <= bn);
    const seen = new Set(got.pts.map(p => p[0].toFixed(5) + ',' + p[1].toFixed(5)));
    // only count decoded points that are inside the same window
    const seenIn = got.pts.filter(p => p[0] >= bw && p[0] <= be && p[1] >= bs && p[1] <= bn);
    const seenInKeys = new Set(seenIn.map(p => p[0].toFixed(5) + ',' + p[1].toFixed(5)));
    // how many index points have a decoded point within MATCH_M
    const MATCH_M = 3;
    let hit = 0;
    for (const q of inView) {
      let bd = 1e9;
      for (const p of seenIn) { const d = distM(p, q); if (d < bd) bd = d; }
      if (bd <= MATCH_M) hit++;
    }
    ladder.push({
      anchor: a.name, zoom: z,
      indexInView: inView.length, drawnInView: seenInKeys.size, matched: hit,
      pctDrawn: inView.length ? Math.round(100 * hit / inView.length) : null,
      decodedAnywhere: seen.size,
    });
  }
}
console.table(ladder);
say('ladder: ' + JSON.stringify(ladder));
const atWalk = ladder.filter(r => r.zoom >= 18 && r.indexInView > 0);
const atAir = ladder.filter(r => r.zoom <= 16 && r.indexInView > 0);
const avg = (rows) => rows.length ? Math.round(rows.reduce((s, r) => s + r.pctDrawn, 0) / rows.length) : null;
say(`share of counted lights the tiles actually carry — at walking zoom (>=18): ${avg(atWalk)}% | at planning zoom (<=16): ${avg(atAir)}%`);

// The ladder's high-zoom rows are thin because a z19 viewport usually contains
// no lamp at all, so the walking-zoom answer above rests on a handful of rows.
// Fix it by anchoring ON the lights: fly to a random sample of the index's own
// points at the site zoom and ask whether the source decodes one there. This is
// the inventory question at the scale the claim is actually made.
const LAMP_PROBE_N = 30;
const probeIdx = (() => {
  const a = allIdx.map((p, i) => ({ p, i }));
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, LAMP_PROBE_N);
})();
let probeHit = 0;
const probeMiss = [];
for (const { p } of probeIdx) {
  await page.evaluate((q) => { window.__la.jump(q); }, { center: p, zoom: SITE_ZOOM, pitch: 0, bearing: 0 });
  await page.evaluate(() => window.__la.settle(350));
  const near = await page.evaluate((ll) => {
    const m = window.__map;
    let feats = [];
    try { feats = m.querySourceFeatures('austin-props', { sourceLayer: 'props', filter: ['==', ['get', 'k'], 'lit'] }); }
    catch (e) { return null; }
    let best = 1e9;
    for (const f of feats) {
      const c = f.geometry && f.geometry.coordinates;
      if (!c) continue;
      const d = Math.hypot((c[0] - ll[0]) * 96500, (c[1] - ll[1]) * 111320);
      if (d < best) best = d;
    }
    return best;
  }, p);
  if (near != null && near <= 3) probeHit++; else probeMiss.push({ at: p, nearestDrawnM: near == null ? null : +near.toFixed(1) });
  stops++;
}
say(`walking-zoom inventory: ${probeHit}/${LAMP_PROBE_N} of a random sample of counted lights are decoded from the tiles within 3 m at z${SITE_ZOOM}`);
if (probeMiss.length) say('  misses: ' + JSON.stringify(probeMiss).slice(0, 600));

// ═══════════════════════════════════════════════════════════════════════
// PART B — sites off real routes
// ═══════════════════════════════════════════════════════════════════════
say('');
say('## B. sites — the claim at a place, against that place on camera');

const claimedLit = [], claimedDark = [];
const routeRows = [];
for (const [a, b] of PAIRS) {
  const r = await page.evaluate(async ([f, t]) => {
    const res = await window.wayfindRoute(f, t, {});
    if (!res || !res.ok) return { ok: false, why: res && res.why, f, t };
    const lit = await window.wayfindLit();
    return { ok: true, f, t, distM: res.distM, lit };
  }, [a, b]);
  if (!r.ok) { say(`  route ${a}->${b}: ${r.why}`); continue; }
  // `runsAt` is litScan's own classified geometry — the same polyline, split by
  // the same rule, that the card counted its metres off. Sampling it means the
  // site a camera stands at IS a place the claim was made about, not a nearby
  // place a script re-derived and might have re-derived differently.
  const runs = r.lit.runsAt || [];
  const lampsAt = r.lit.lampsAt || [];
  let verts = 0;
  for (const run of runs) {
    verts += run.line.length;
    // one site per SITE_SPACING_M of a run, so a 600 m dark stretch is not one
    // sample and a 9 m lit one is not thirty
    const step = Math.max(1, Math.floor(SITE_SPACING_M / Math.max(1, run.m / Math.max(1, run.line.length - 1))));
    for (let i = 1; i < run.line.length; i += step) {
      const p0 = run.line[i - 1], p1 = run.line[i];
      const mid = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
      let near = 1e9;
      for (const q of lampsAt) near = Math.min(near, distM(mid, q));
      const bearing = Math.atan2(p1[0] - p0[0], p1[1] - p0[1]) * 180 / Math.PI;
      const site = { at: mid, pair: `${a}->${b}`, nearestLampM: +near.toFixed(1), bearing: +bearing.toFixed(0), runM: run.m };
      // Classify by the FEATURE's own flag, not by re-deriving the distance —
      // then keep only sites well clear of the 25 m boundary, because a site
      // 24.6 m from a lamp tests floating point, not the claim.
      if (run.lit && near <= WAYFIND_LIT_RADIUS_M) claimedLit.push(site);
      else if (!run.lit && near > DARK_CLEARANCE_M) claimedDark.push(site);
    }
  }
  routeRows.push({ pair: `${a}->${b}`, distM: Math.round(r.distM), lamps: r.lit.lamps, pct: r.lit.pct, runs: runs.length, verts });
}
console.table(routeRows);
say('routes: ' + JSON.stringify(routeRows));
say(`candidate sites: claimed-lit ${claimedLit.length}, claimed-unmapped ${claimedDark.length}`);

const pick = (arr, n) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n);
};
const sites = pick(claimedLit, N_SITES).map(s => ({ ...s, claim: 'lit' }))
  .concat(pick(claimedDark, N_SITES).map(s => ({ ...s, claim: 'unmapped' })));
say(`sampled ${sites.length} sites (${sites.filter(s => s.claim === 'lit').length} lit / ${sites.filter(s => s.claim === 'unmapped').length} unmapped)`);

// clear the route so the amber ribbon is not itself counted as light
await page.evaluate(() => { if (window.wayfindClear) window.wayfindClear(); });
await page.waitForTimeout(400);

const poseOf = (s) => ({ center: s.at, zoom: SITE_ZOOM, pitch: SITE_PITCH, bearing: 0 });

// The claim's disc, in device pixels about the frame centre. Measured through
// the map's own projection at the site rather than from the mpp formula, so it
// is right whatever the zoom, latitude and devicePixelRatio actually are.
const discPx = await page.evaluate(([ll, r, z]) => {
  const m = window.__map;
  m.jumpTo({ center: ll, zoom: z, pitch: 0, bearing: 0 });
  const a = m.project(ll);
  const dLon = r / (111320 * Math.cos(ll[1] * Math.PI / 180));
  const b = m.project([ll[0] + dLon, ll[1]]);
  const cssR = Math.hypot(b.x - a.x, b.y - a.y);
  const c = m.getCanvas();
  return { cssR, scale: c.width / c.clientWidth, devR: cssR * (c.width / c.clientWidth), w: c.width, h: c.height };
}, [sites[0].at, WAYFIND_LIT_RADIUS_M, SITE_ZOOM]);
say(`the claim's ${WAYFIND_LIT_RADIUS_M} m disc is ${discPx.devR.toFixed(0)} device px of a ${discPx.w}x${discPx.h} frame`);

// Draw the disc on the page so a saved frame SHOWS the region the numbers were
// taken from. A frame that does not show its own measurement window is a frame
// somebody has to take on trust, and this repo has been wrong about where a
// number came from before.
await page.evaluate((rCss) => {
  const d = document.createElement('div');
  d.id = '__la-disc';
  d.style.cssText = [
    'position:fixed', 'left:50%', 'top:50%', 'transform:translate(-50%,-50%)',
    `width:${rCss * 2}px`, `height:${rCss * 2}px`, 'border-radius:50%',
    'border:1.5px dashed rgba(255,255,255,.42)', 'pointer-events:none', 'z-index:9999',
  ].join(';');
  document.body.appendChild(d);
}, discPx.cssR);
if (discPx.devR < 60 || discPx.devR > discPx.h * 0.48) {
  say('FAIL: the disc does not fit the frame at this zoom — the measurement would be cropped or too small to mean anything');
  await browser.close(); process.exit(1);
}

// The four light layers, and their paint as shipped so the mask can be put
// back. A mask that is never restored turns every later frame into a lie.
const present = await page.evaluate((m) => Object.keys(m).filter(id => !!window.__map.getLayer(id)), MASK);
say('light layers present in the style: ' + (present.join(', ') || 'NONE'));
if (!present.length) { say('FAIL: no light layer in the style'); await browser.close(); process.exit(1); }
const shippedPaint = await page.evaluate((ids) => {
  const m = window.__map, out = {};
  for (const id of ids) out[id] = m.getPaintProperty(id, 'circle-color');
  return out;
}, present);
say('shipped circle-color: ' + JSON.stringify(shippedPaint));

// ── one pass per site: BASE frame, MASK frame, diff ─────────────────────
//
// WHY THE DIFF, AND WHY THE FIRST CUT WAS WRONG WITHOUT IT. Counting "green
// pixels" in the masked frame classified night tree canopy as a surveyed lamp:
// one site came back with 423 green pixels and zero props-lit features in the
// same disc. night-lamps.mjs already had the answer — only pixels that CHANGED
// between the two frames belong to the layers that were repainted. So the two
// frames are taken back to back at the same pose, and the mask is restored
// after every site.
const shotIdx = new Set(pick(sites.map((_, i) => i), N_SHOTS));
for (let i = 0; i < sites.length; i++) {
  const s = sites[i];
  await page.evaluate((q) => { window.__la.jump(q); }, poseOf(s));
  await page.evaluate(() => window.__la.settle(700));
  await page.waitForTimeout(200);

  // queryRenderedFeatures over the disc's bounding box only — the same
  // restriction the pixels get, so the two instruments answer one question.
  const qrf = await page.evaluate((rCss) => {
    const m = window.__map;
    const c = m.getCanvas();
    const cx = c.clientWidth / 2, cy = c.clientHeight / 2;
    const box = [[cx - rCss, cy - rCss], [cx + rCss, cy + rCss]];
    const ids = ['props-lit', 'props-lit-core', 'props-lamp', 'night-streetlight-pool', 'night-streetlight-core']
      .filter(id => m.getLayer(id));
    const out = {};
    for (const id of ids) { try { out[id] = m.queryRenderedFeatures(box, { layers: [id] }).length; } catch (e) { out[id] = -1; } }
    return out;
  }, discPx.cssR);

  // BASE — the scene as shipped, and the hot-pixel census inside the disc.
  const hot = await page.evaluate(async ([pale, R]) => {
    const b = await window.__la.read();
    window.__la.base = b;
    const cx = b.w / 2, cy = b.h / 2, R2 = R * R;
    let hot = 0, warm = 0, n = 0;
    for (let y = 0; y < b.h; y++) {
      const dy = y - cy;
      if (dy * dy > R2) continue;
      for (let x = 0; x < b.w; x++) {
        const dx = x - cx;
        if (dx * dx + dy * dy > R2) continue;
        const k = (y * b.w + x) * 4;
        const Rc = b.px[k], G = b.px[k + 1], B = b.px[k + 2];
        const L = 0.2126 * Rc + 0.7152 * G + 0.0722 * B;
        n++; if (L <= pale) continue; hot++; if (Rc - B > 12) warm++;
      }
    }
    return { inDisc: n, hot, warm };
  }, [HOT_LUMA, discPx.devR]);
  if (shotIdx.has(i)) {
    s.shot = `${TAG}-site-${String(i).padStart(2, '0')}-${s.claim}.png`;
    await page.screenshot({ path: path.join(OUT, s.shot) });
  }

  // MASK — repaint the four light layers in flat primaries, and count only the
  // pixels that CHANGED. A pixel that did not change is not theirs, whatever
  // colour it happens to be: night tree canopy is green-dominant and was being
  // read as a surveyed lamp before this diff went in.
  await page.evaluate(([ids, mark]) => {
    const m = window.__map;
    for (const id of ids) m.setPaintProperty(id, 'circle-color', mark[id]);
  }, [present, MASK]);
  await page.evaluate(() => window.__la.settle(450));
  const own = await page.evaluate(async (R) => {
    const shot = await window.__la.read();
    const base = window.__la.base;
    const cx = shot.w / 2, cy = shot.h / 2, R2 = R * R;
    let green = 0, cyan = 0, blue = 0, magenta = 0, yellow = 0, inDisc = 0, changed = 0;
    for (let y = 0; y < shot.h; y++) {
      const dy = y - cy;
      if (dy * dy > R2) continue;
      for (let x = 0; x < shot.w; x++) {
        const dx = x - cx;
        if (dx * dx + dy * dy > R2) continue;
        inDisc++;
        const k = (y * shot.w + x) * 4;
        if (shot.px[k] === base.px[k] && shot.px[k + 1] === base.px[k + 1] && shot.px[k + 2] === base.px[k + 2]) continue;
        changed++;
        // A blurred circle composites its primary over a near-black city, so
        // the test is the SHAPE of the channel ratio, not nearness to the pure
        // primary.
        const Rc = shot.px[k], G = shot.px[k + 1], B = shot.px[k + 2];
        const mx = Math.max(Rc, G, B);
        if (mx < 12) continue;
        const hiR = Rc > mx * 0.55, hiG = G > mx * 0.55, hiB = B > mx * 0.55;
        if (hiG && hiB && !hiR) cyan++;              // warm lamp's head
        else if (hiG && !hiB && !hiR) green++;       // warm lamp's pool
        else if (hiB && !hiG && !hiR) blue++;        // an emergency phone
        else if (hiR && hiB && !hiG) magenta++;      // decoration's pool
        else if (hiR && hiG && !hiB) yellow++;       // decoration's head
      }
    }
    return { green, cyan, blue, magenta, yellow, inDisc, changed };
  }, discPx.devR);
  if (s.shot) await page.screenshot({ path: path.join(OUT, s.shot.replace('.png', '-mask.png')) });

  // put the scene back before the next site, every time
  await page.evaluate(([ids, paint]) => {
    const m = window.__map;
    for (const id of ids) m.setPaintProperty(id, 'circle-color', paint[id]);
  }, [present, shippedPaint]);
  await page.evaluate(() => window.__la.settle(200));

  s.qrf = qrf; s.hot = hot; s.mask = own;
  s.surveyedPx = own.green + own.cyan;    // warm OSM street lamps only
  s.phonePx = own.blue;                   // blue call boxes, counted apart
  s.decorPx = own.magenta + own.yellow;   // js/night.js, not a survey of anything
  process.stdout.write(`\r  site ${i + 1}/${sites.length}   `);
}
process.stdout.write('\n');

// ── the matrix ──────────────────────────────────────────────────────────
//
// Calibrate what "a light is standing here" means against this run's own
// surveyed lamps, rather than against a pixel count somebody picked. The
// reference is the MEDIAN footprint a real mapped lamp puts inside the disc at
// this zoom; a decorative pool has to reach DECOR_READS_AS_LAMP_FRAC of it
// before it is called something a walker would take for a street light.
const litFootprints = sites.filter(s => s.claim === 'lit' && s.surveyedPx >= MASK_MIN_PX)
  .map(s => s.surveyedPx).sort((a, b) => a - b);
const LAMP_REF_PX = litFootprints.length
  ? litFootprints[Math.floor(litFootprints.length / 2)] : null;
const DECOR_LOUD_PX = LAMP_REF_PX ? Math.round(LAMP_REF_PX * DECOR_READS_AS_LAMP_FRAC) : MASK_MIN_PX;
say('');
say(`a surveyed lamp's median footprint inside the disc: ${LAMP_REF_PX} px (n=${litFootprints.length})`);
say(`so "decoration a walker would read as a street light" = >= ${DECOR_LOUD_PX} px`);

const tally = {
  lit: { n: 0, surveyedSeen: 0, phoneSeen: 0, decorAny: 0, decorLoud: 0, nothingSeen: 0 },
  unmapped: { n: 0, surveyedSeen: 0, phoneSeen: 0, decorAny: 0, decorLoud: 0, nothingSeen: 0 },
};
for (const s of sites) {
  const t = tally[s.claim];
  t.n++;
  // A warm lamp is present only when its POOL is — `props-lit` green. The core
  // alone is not enough: a blue phone's glow composited over green tree canopy
  // reads cyan, and cyan-without-green is exactly the two sites that looked
  // like "said none is mapped, a lamp IS visible" until this line went in.
  // Measured, the two populations do not overlap at all: every one of the 17
  // real lamps has green >= 1211 px, and both phone-only sites have green = 0.
  s.surveyedSeen = s.mask.green >= MASK_MIN_PX;
  s.phoneSeen = s.phonePx >= MASK_MIN_PX;
  s.decorAny = s.decorPx >= MASK_MIN_PX;
  s.decorLoud = s.decorPx >= DECOR_LOUD_PX;
  if (s.surveyedSeen) t.surveyedSeen++;
  if (s.phoneSeen) t.phoneSeen++;
  if (s.decorAny) t.decorAny++;
  if (s.decorLoud) t.decorLoud++;
  if (!s.surveyedSeen && !s.phoneSeen && !s.decorAny) t.nothingSeen++;
}
say('');
say('### the matrix — what is actually standing inside the claim\'s 25 m disc');
const rows = [
  {
    claim: 'a lamp within 25 m ("lit")', sites: tally.lit.n,
    'warm lamp on screen': tally.lit.surveyedSeen,
    'blue phone on screen': tally.lit.phoneSeen,
    'any decorative glow': tally.lit.decorAny,
    'decoration as bright as a lamp': tally.lit.decorLoud,
    'nothing lit at all': tally.lit.nothingSeen,
  },
  {
    claim: 'none within 60 m ("unmapped")', sites: tally.unmapped.n,
    'warm lamp on screen': tally.unmapped.surveyedSeen,
    'blue phone on screen': tally.unmapped.phoneSeen,
    'any decorative glow': tally.unmapped.decorAny,
    'decoration as bright as a lamp': tally.unmapped.decorLoud,
    'nothing lit at all': tally.unmapped.nothingSeen,
  },
];
console.table(rows);
say(JSON.stringify(rows, null, 1));

const falseLit = sites.filter(s => s.claim === 'lit' && !s.surveyedSeen);
const falseDark = sites.filter(s => s.claim === 'unmapped' && s.surveyedSeen);
say('');
say('CLAIM FAILURES — the thing being judged:');
say(`  said a lamp covers this walk, no surveyed lamp visible: ${falseLit.length}/${tally.lit.n}`);
say(`  said none is mapped, a surveyed lamp IS visible:        ${falseDark.length}/${tally.unmapped.n}`);
const brief = (s) => ({ at: s.at.map(v => +v.toFixed(6)), pair: s.pair, near: Math.round(Math.min(s.nearestLampM, 99999)), sv: s.surveyedPx, dec: s.decorPx, qrf: s.qrf });
if (falseLit.length) say('  ' + JSON.stringify(falseLit.map(brief)));
if (falseDark.length) say('  ' + JSON.stringify(falseDark.map(brief)));

say('');
say('THE CONTRADICTION A USER CAN SEE — not a claim failure, a scene one:');
const dq = sites.filter(s => s.claim === 'unmapped').map(s => s.decorPx).sort((a, b) => a - b);
const pct = (p) => dq.length ? dq[Math.min(dq.length - 1, Math.floor(dq.length * p))] : 0;
say(`  "unmapped" sites with ANY decorative glow in the disc:            ${tally.unmapped.decorAny}/${tally.unmapped.n}`);
say(`  ...with decoration as bright as a real lamp (>= ${DECOR_LOUD_PX} px):   ${tally.unmapped.decorLoud}/${tally.unmapped.n}`);
say(`  decorative footprint on unmapped sites, px: p25 ${pct(0.25)} · median ${pct(0.5)} · p75 ${pct(0.75)} · max ${dq[dq.length - 1] || 0}`);

// ── the occlusion probe ─────────────────────────────────────────────────
//
// A "lit" site where queryRenderedFeatures FINDS a props-lit feature in the
// disc and the mask finds none of its pixels is not the index being wrong. It
// is the lamp being covered — `props-lit` is inserted under the building
// extrusions on purpose, and tree canopies are drawn over it. Which of the two
// possibilities it is decides whether anything needs fixing, so ask: hide the
// trees and the buildings, mask again, and see whether the lamp appears.
const OCCLUDE_RE = /^(trees-|buildings-|roofs-|roofscape-|west-|drag-|tower-|moody-|arts-|stadium-|places-|outer-|ground-)/;
const hidden = await page.evaluate((reSrc) => {
  const re = new RegExp(reSrc);
  const m = window.__map;
  const ids = m.getStyle().layers.map(l => l.id).filter(id => re.test(id));
  return ids;
}, OCCLUDE_RE.source);
const suspects = sites.filter(s => s.claim === 'lit' && !s.surveyedSeen && (s.qrf['props-lit'] || 0) > 0);
say('');
say(`occlusion probe: ${suspects.length} site(s) where the renderer reports a lamp and no lamp pixel survived`);
for (const s of suspects) {
  await page.evaluate((q) => { window.__la.jump(q); }, poseOf(s));
  await page.evaluate(() => window.__la.settle(600));
  await page.evaluate(([ids, mark, hide]) => {
    const m = window.__map;
    for (const id of hide) m.setLayoutProperty(id, 'visibility', 'none');
    for (const id of ids) m.setPaintProperty(id, 'circle-color', mark[id]);
  }, [present, MASK, hidden]);
  await page.evaluate(() => window.__la.settle(700));
  const bare = await page.evaluate(async (R) => {
    const shot = await window.__la.read();
    const cx = shot.w / 2, cy = shot.h / 2, R2 = R * R;
    let lamp = 0;
    for (let y = 0; y < shot.h; y++) {
      const dy = y - cy; if (dy * dy > R2) continue;
      for (let x = 0; x < shot.w; x++) {
        const dx = x - cx; if (dx * dx + dy * dy > R2) continue;
        const k = (y * shot.w + x) * 4;
        const Rc = shot.px[k], G = shot.px[k + 1], B = shot.px[k + 2];
        const mx = Math.max(Rc, G, B); if (mx < 12) continue;
        const hiR = Rc > mx * 0.55, hiG = G > mx * 0.55, hiB = B > mx * 0.55;
        if (hiG && !hiR) lamp++;      // green or cyan: the warm lamp, uncovered
      }
    }
    return lamp;
  }, discPx.devR);
  s.uncoveredLampPx = bare;
  await page.screenshot({ path: path.join(OUT, `${TAG}-occl-${sites.indexOf(s)}.png`) });
  await page.evaluate(([ids, paint, hide]) => {
    const m = window.__map;
    for (const id of ids) m.setPaintProperty(id, 'circle-color', paint[id]);
    for (const id of hide) m.setLayoutProperty(id, 'visibility', 'visible');
  }, [present, shippedPaint, hidden]);
  await page.evaluate(() => window.__la.settle(400));
  say(`  ${JSON.stringify(s.at.map(v => +v.toFixed(6)))} — with trees and buildings hidden, lamp pixels in the disc: ${bare}`
    + (bare >= MASK_MIN_PX ? '  -> the lamp IS there, the scene was covering it' : '  -> still nothing: the index counts a lamp the scene does not show'));
}

// Every failure gets a frame, whether or not the random shot draw picked it.
// A failure nobody can look at is a number, and this house does not ship those.
const needShots = falseLit.concat(falseDark).concat(sites.filter(s => s.claim === 'unmapped' && s.decorLoud)).filter(s => !s.shot);
if (needShots.length) {
  say(`taking ${needShots.length} extra frames of the sites that failed or glowed`);
  for (let j = 0; j < needShots.length; j++) {
    const s = needShots[j];
    await page.evaluate((q) => { window.__la.jump(q); }, poseOf(s));
    await page.evaluate(() => window.__la.settle(700));
    await page.waitForTimeout(200);
    const why = !s.surveyedSeen && s.claim === 'lit' ? 'nolamp' : (s.surveyedSeen && s.claim === 'unmapped' ? 'stray' : 'decorloud');
    s.shot = `${TAG}-flag-${why}-${j}.png`;
    await page.screenshot({ path: path.join(OUT, s.shot) });
    await page.evaluate(([ids, mark]) => {
      const m = window.__map;
      for (const id of ids) m.setPaintProperty(id, 'circle-color', mark[id]);
    }, [present, MASK]);
    await page.evaluate(() => window.__la.settle(450));
    await page.screenshot({ path: path.join(OUT, s.shot.replace('.png', '-mask.png')) });
    await page.evaluate(([ids, paint]) => {
      const m = window.__map;
      for (const id of ids) m.setPaintProperty(id, 'circle-color', paint[id]);
    }, [present, shippedPaint]);
    await page.evaluate(() => window.__la.settle(200));
  }
}

fs.writeFileSync(path.join(OUT, `${TAG}-audit.json`), JSON.stringify({
  when: new Date().toISOString(), tod: gotP, zoom: SITE_ZOOM, pitch: SITE_PITCH,
  maskMinPx: MASK_MIN_PX, lampRefPx: LAMP_REF_PX, decorLoudPx: DECOR_LOUD_PX,
  discPx,
  inventory: {
    indexWarm: idxWarm.length, indexBlue: idxBlue.length, stops, ladder,
    lampProbe: { n: LAMP_PROBE_N, hit: probeHit, miss: probeMiss },
  },
  routes: routeRows, matrix: rows, sites,
}, null, 1));
fs.writeFileSync(path.join(OUT, `${TAG}-audit.log`), log.join('\n') + '\n');
say(`wrote ${OUT}/${TAG}-audit.json`);

await browser.close();
