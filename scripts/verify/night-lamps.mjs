/**
 * night-lamps.mjs — the four separate questions inside "night is a carpet of
 * cold blue-white bokeh", measured separately, in ONE page load.
 *
 * HANDOFF §35 item 6 reports one symptom and it is at least four defects:
 *
 *   1. COLOUR    — how much of the frame's light is blue-white rather than warm?
 *   2. SIZE      — how big is one lamp's glow, in METRES on the ground?
 *   3. PLACEMENT — what fraction of the glow is drawn over a ROOF rather than
 *                  over the street it belongs to?
 *   4. OWNERSHIP — night.js's road pools, or props.js's walkway lamps, or both?
 *
 * A count of pale pixels answers none of them, which is why night-pale.mjs has
 * been reporting on this defect for three sessions without moving it.
 *
 * Method is the magenta mask (roof-ring.mjs): repaint the suspects in flat
 * primaries, read the framebuffer, and every pixel that CHANGED to a primary is
 * a pixel that layer owns. A hand-picked screen box has been wrong three times
 * in this repo. Three frames out of one load:
 *
 *   BASE  as shipped                      -> the hot-pixel census (Q1)
 *   MARK  lamp layers in flat primaries   -> ownership + blob sizes (Q2, Q4)
 *   ROOF  lamps hidden, every building
 *         and roof layer flat magenta     -> the roof mask (Q3)
 *
 * Reads through `_harness.html`: index.html does not set preserveDrawingBuffer
 * and readPixels on a swapped buffer returns black. Run harness-drift.mjs first.
 *
 * Usage:
 *   VERIFY_URL=http://127.0.0.1:8154 node scripts/verify/night-lamps.mjs \
 *     --tag before [--pose aerial-wide|the-drag] [--tod 0.95]
 */
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';
import fs from 'node:fs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const TAG = opt('--tag', 'before');
const TOD = parseFloat(opt('--tod', '0.95'));            // tour.mjs's `night`
const EXTRA = opt('--extra', '');
const POSES = {
  // tour.mjs's own two, unchanged, so a number here is comparable to a tour frame.
  'aerial-wide': { center: [-97.7390, 30.2840], zoom: 14.4, pitch: 55, bearing: 20 },
  'the-drag':    { center: [-97.7418, 30.2865], zoom: 17.2, pitch: 70, bearing: 0 },
};
const POSE_NAME = opt('--pose', 'aerial-wide');
const POSE = POSES[POSE_NAME];
if (!POSE) { console.error('unknown pose ' + POSE_NAME); process.exit(2); }

// The four layers that draw light after dark. night.js owns the first two,
// props.js the second two — and which of them owns the carpet decides whose
// file the fix lives in, so both are marked.
const MARK = {
  'night-streetlight-pool': '#ff00ff',   // magenta — the road glow
  'night-streetlight-core': '#ffff00',   // yellow  — the road lamp head
  'props-lit':              '#00ff00',   // green   — the walkway glow
  'props-lit-core':         '#00ffff',   // cyan    — the walkway lamp head
};
// Anything a lamp's ground pool must never be painted on top of. Matched
// against every fill-extrusion layer the live style has, and the matched list
// is PRINTED — a regex that quietly matched nothing would report 0% on roofs.
const ROOF_RE = /^(buildings-3d|buildings-roof|roofs-|roofscape-|west-|drag-|tower-|moody-|arts-|stadium-|places-|outer-)/;

// `luma > PALE` is night-pale.mjs's constant and it is quoted here so the two
// numbers are comparable; the WARM/COOL split is the part that matters.
const PALE = 120;

fs.mkdirSync('shots/lamps', { recursive: true });

const browser = await launch(chromium, { gl: 'hardware' });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('pageerror', e => console.log('  [pageerror] ' + e.message));

await page.goto(BASE + '/_harness.html?intro=0&drift=0' + EXTRA, { waitUntil: 'networkidle', timeout: 180000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

// Both paths, always — an element existing is not a handler running.
await page.evaluate(v => {
  const el = document.getElementById('tod-slider');
  if (el) {
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  if (typeof window.applyTimeOfDay === 'function') window.applyTimeOfDay(window.__map, v, true);
}, TOD);
await page.waitForTimeout(2500);

await page.evaluate(q => window.__map.jumpTo(q), POSE);
await page.evaluate(() => new Promise(r => {
  const m = window.__map;
  if (m.loaded() && m.areTilesLoaded()) return r();
  m.once('idle', r); setTimeout(r, 40000);
}));
await page.waitForTimeout(2500);

await page.evaluate(() => {
  window.__nl = {
    // triggerRepaint SCHEDULES a frame; readPixels straight after returns the
    // PREVIOUS one. Two rAFs, and the caller re-reads until two agree.
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
    settle() {
      return new Promise(r => {
        const m = window.__map;
        m.triggerRepaint();
        if (m.loaded() && m.areTilesLoaded()) return setTimeout(r, 600);
        m.once('idle', r); setTimeout(r, 25000);
      });
    },
  };
});

await page.evaluate(async () => { window.__nl.base = await window.__nl.read(); });
await page.screenshot({ path: `shots/lamps/${TAG}-${POSE_NAME}.png` });

// What night.js says it generated. `worstBlueMinusRed` is the assertion that
// matters: it is the bluest colour in the whole lamp file, and if it is ever
// >= 0 a lamp somewhere in the city is blue.
const gen = await page.evaluate(() => window.__nightLights || null);
console.log('night.js reports:', JSON.stringify(gen));
if (gen && gen.worstBlueMinusRed >= 0) console.log('  *** a lamp colour is BLUE ***');

// ── Q1. The hot-pixel census, on the frame as shipped ────────────────────
// Only pixels BELOW the horizon: the sky's own gradient and the stars are not
// street lighting, and counting them once made a night frame look 40% lit.
const census = await page.evaluate(pale => {
  const b = window.__nl.base, W = b.w, H = b.h;
  let hot = 0, warm = 0, cool = 0, neutral = 0, sum = 0, n = 0;
  const y0 = Math.floor(H * 0.28);   // below the skyline in both poses
  for (let y = y0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = (y * W + x) * 4;
    const R = b.px[k], G = b.px[k + 1], B = b.px[k + 2];
    const L = 0.2126 * R + 0.7152 * G + 0.0722 * B;
    sum += L; n++;
    if (L <= pale) continue;
    hot++;
    // b-r is the axis HANDOFF §36 settled on: the authored hex is not what
    // lands, but the RELATIVE channel gap survives the grade.
    if (B - R > 12) cool++; else if (R - B > 12) warm++; else neutral++;
  }
  return { belowHorizon: n, meanLuma: +(sum / n).toFixed(1), hot, warm, cool, neutral };
}, PALE);

// ── Q2/Q4. Mark the lamp layers ──────────────────────────────────────────
const present = await page.evaluate(m => Object.keys(m).filter(id => !!window.__map.getLayer(id)), MARK);
console.log('lamp layers present:', present.join(', ') || 'NONE');
if (!present.length) { console.error('FAIL: no lamp layer in the style'); await browser.close(); process.exit(1); }

await page.evaluate(([ids, mark]) => {
  const m = window.__map;
  for (const id of ids) {
    // Both layers are `circle`; keep the blur and the opacity so the mask is
    // the same SHAPE the glow is, not a hard disc.
    m.setPaintProperty(id, 'circle-color', mark[id]);
  }
}, [present, MARK]);
await page.evaluate(() => window.__nl.settle());
await page.waitForTimeout(1500);

const measureOwn = () => page.evaluate(([ids, mark]) => {
  const nl = window.__nl, base = nl.base;
  return nl.read().then(shot => {
    const W = base.w, H = base.h, n = W * H;
    const own = new Int8Array(n).fill(-1);
    const hex = s => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
    const want = ids.map(id => hex(mark[id]));
    const acc = ids.map(() => ({ n: 0, r: 0, g: 0, b: 0 }));
    for (let p = 0; p < n; p++) {
      const k = p * 4;
      if (shot.px[k] === base.px[k] && shot.px[k + 1] === base.px[k + 1] && shot.px[k + 2] === base.px[k + 2]) continue;
      // A blurred circle composites its primary over a near-black city, so the
      // test is on the SHAPE of the channel ratio, not on nearness to the pure
      // primary: which channels are up, and which are down.
      const R = shot.px[k], G = shot.px[k + 1], B = shot.px[k + 2];
      const mx = Math.max(R, G, B);
      if (mx < 24) continue;                      // too faint to attribute
      let best = -1, bestErr = 1e9;
      for (let i = 0; i < want.length; i++) {
        const [wr, wg, wb] = want[i];
        const s = (wr + wg + wb) / 255;           // channels this primary lights
        const er = Math.abs(R / mx - wr / 255) + Math.abs(G / mx - wg / 255) + Math.abs(B / mx - wb / 255);
        if (er / s < bestErr) { bestErr = er / s; best = i; }
      }
      if (bestErr > 0.30) continue;
      own[p] = best; acc[best].n++;
      acc[best].r += base.px[k]; acc[best].g += base.px[k + 1]; acc[best].b += base.px[k + 2];
    }
    window.__nl.own = own;
    return {
      layers: ids.map((id, i) => ({
        id, px: acc[i].n,
        mean: [Math.round(acc[i].r / Math.max(1, acc[i].n)),
               Math.round(acc[i].g / Math.max(1, acc[i].n)),
               Math.round(acc[i].b / Math.max(1, acc[i].n))],
      })),
      total: n,
    };
  });
}, [present, MARK]);

// An under-settled read after setPaintProperty is not a null result, it is a
// wrong one (HANDOFF §37) — read until two consecutive reads agree within 2%.
const t0 = Date.now();
const lap = s => console.log(`  [${((Date.now() - t0) / 1000).toFixed(0)}s] ${s}`);
let own = await measureOwn();
lap('ownership read 1');
for (let i = 0; i < 4; i++) {
  const again = await measureOwn();
  const ok = own.layers.every((l, j) => {
    const a = l.px, b = again.layers[j].px;
    return Math.abs(a - b) <= Math.max(40, 0.02 * Math.max(a, b));
  });
  own = again;
  lap('ownership read ' + (i + 2));
  if (ok) break;
  console.log('  (re-reading: layer counts still moving)');
  await page.waitForTimeout(1500);
}

// ── Q2 continued. How big is one glow, in metres? ────────────────────────
// Connected components over the union of the two POOL layers. The ground scale
// is taken from the map itself at the blob's own screen row, so a near-field
// blob is not measured with the far field's metres-per-pixel.
const blobs = await page.evaluate(ids => {
  const nl = window.__nl, own = nl.own, base = nl.base, W = base.w, H = base.h;
  const poolIdx = ids.map((id, i) => (/pool$|^props-lit$/.test(id) ? i : -1)).filter(i => i >= 0);
  const isPool = p => poolIdx.indexOf(own[p]) >= 0;
  const seen = new Uint8Array(W * H);
  const out = [];
  const stack = new Int32Array(1 << 20);
  for (let p = 0; p < W * H; p++) {
    if (seen[p] || !isPool(p)) continue;
    let sp = 0; stack[sp++] = p; seen[p] = 1;
    let area = 0, minx = 1e9, maxx = -1, sy = 0;
    while (sp) {
      const q = stack[--sp];
      const x = q % W, y = (q / W) | 0;
      area++; sy += y;
      if (x < minx) minx = x; if (x > maxx) maxx = x;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const r = ny * W + nx;
        if (seen[r] || !isPool(r)) continue;
        seen[r] = 1; if (sp < stack.length) stack[sp++] = r;
      }
    }
    if (area >= 12) out.push({ area, wpx: maxx - minx + 1, y: Math.round(sy / area) });
  }
  // Screen width -> ground metres at that row, asked of the map's own unproject
  // so the pitch is in it. The canvas is devicePixelRatio-scaled; unproject
  // takes CSS px.
  const m = window.__map, dpr = m.getCanvas().width / m.getCanvas().clientWidth;
  const widthM = (b) => {
    const y = b.y / dpr;
    const a = m.unproject([(m.getCanvas().clientWidth - b.wpx / dpr) / 2, y]);
    const c = m.unproject([(m.getCanvas().clientWidth + b.wpx / dpr) / 2, y]);
    const mLon = 111320 * Math.cos(a.lat * Math.PI / 180);
    return Math.hypot((c.lng - a.lng) * mLon, (c.lat - a.lat) * 110540);
  };
  const ms = out.map(b => ({ ...b, m: widthM(b) })).filter(b => isFinite(b.m) && b.m > 0);
  ms.sort((a, b) => a.m - b.m);
  const q = f => ms.length ? +ms[Math.min(ms.length - 1, Math.floor(f * ms.length))].m.toFixed(1) : 0;
  return { count: ms.length, p10: q(0.10), median: q(0.50), p90: q(0.90), max: q(0.999) };
}, present);
lap('blob sizes');

// ── Q3. Is the glow on the street or on a roof? ──────────────────────────
const roofLayers = await page.evaluate(re => window.__map.getStyle().layers
  .filter(l => l.type === 'fill-extrusion' && new RegExp(re).test(l.id))
  .map(l => l.id), ROOF_RE.source);
console.log(`roof/building layers marked: ${roofLayers.length}`, roofLayers.slice(0, 12).join(', ') + (roofLayers.length > 12 ? ' …' : ''));

const overRoof = await page.evaluate(async ([ids, roofIds]) => {
  const m = window.__map, nl = window.__nl;
  for (const id of ids) m.setPaintProperty(id, 'circle-opacity', 0);
  for (const id of roofIds) {
    m.setPaintProperty(id, 'fill-extrusion-color', '#ff00ff');
    try { m.setPaintProperty(id, 'fill-extrusion-pattern', null); } catch (e) { /* not patterned */ }
    m.setPaintProperty(id, 'fill-extrusion-opacity', 1);
  }
  await nl.settle();
  await new Promise(r => setTimeout(r, 2000));
  const shot = await nl.read();
  const own = nl.own, W = nl.base.w, H = nl.base.h;
  const roof = new Uint8Array(W * H);
  let roofPx = 0;
  for (let p = 0; p < W * H; p++) {
    const k = p * 4;
    if (shot.px[k] > 90 && shot.px[k + 2] > 90 && shot.px[k + 1] < shot.px[k] - 40) { roof[p] = 1; roofPx++; }
  }
  const per = ids.map(() => ({ n: 0, on: 0 }));
  for (let p = 0; p < W * H; p++) {
    const i = own[p];
    if (i < 0) continue;
    per[i].n++; if (roof[p]) per[i].on++;
  }
  return { roofPx, per: ids.map((id, i) => ({ id, px: per[i].n, onRoof: per[i].on })) };
}, [present, roofLayers]);
lap('roof mask');

// ── report ───────────────────────────────────────────────────────────────
const pct = (a, b) => (100 * a / Math.max(1, b)).toFixed(2) + '%';
console.log(`\n=== night lamps — ${TAG} — ${POSE_NAME} @ tod ${TOD} ===`);
console.log(`below-horizon pixels ${census.belowHorizon}   mean luma ${census.meanLuma}`);
console.log(`Q1 COLOUR   hot (luma>${PALE}) ${census.hot}  ${pct(census.hot, census.belowHorizon)} of the frame`);
console.log(`            of those:  WARM ${pct(census.warm, census.hot)}   BLUE-WHITE ${pct(census.cool, census.hot)}   neutral ${pct(census.neutral, census.hot)}`);
console.log(`Q2 SIZE     ${blobs.count} separate glows   ground width p10 ${blobs.p10} m / median ${blobs.median} m / p90 ${blobs.p90} m / max ${blobs.max} m`);
console.log(`Q3 PLACEMENT  roof+building mask ${overRoof.roofPx} px`);
for (const r of overRoof.per) {
  if (!r.px) continue;
  console.log(`            ${r.id.padEnd(24)} ${String(r.px).padStart(7)} px   on a roof ${String(r.onRoof).padStart(7)}  ${pct(r.onRoof, r.px)}`);
}
console.log('Q4 OWNERSHIP');
for (const l of own.layers) {
  console.log(`            ${l.id.padEnd(24)} ${String(l.px).padStart(7)} px  ${pct(l.px, own.total).padStart(7)} of frame   as-shipped mean rgb(${l.mean.join(',')})  b-r ${l.mean[2] - l.mean[0]}`);
}
console.log(`frame -> shots/lamps/${TAG}-${POSE_NAME}.png\n`);

fs.writeFileSync(`shots/lamps/${TAG}-${POSE_NAME}.json`,
  JSON.stringify({ tag: TAG, pose: POSE_NAME, tod: TOD, census, blobs, overRoof, own }, null, 2));

await browser.close();
