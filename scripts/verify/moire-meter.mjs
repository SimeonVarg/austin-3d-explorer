/**
 * moire-meter.mjs - ONE NUMBER FOR MOIRE, no human judgement.
 *
 * Moire is detail finer than a pixel (window grids, brick courses, fins, floor
 * lines) sampled once per pixel: it shows as false bands in a still frame and as
 * crawl when the camera moves. This meter draws the real city headless from a
 * fixed list of cameras and scores each view two ways.
 *
 *  a. AGAINST GROUND TRUTH. The same view is drawn at 1x, and again at SS x the
 *     pixels (GFX.renderScale = SS: same page, same atlas, same camera, only the
 *     sampling density changes). The SS frame is box-filtered down to 1x. A box
 *     of SS*SS samples is the alias-free picture to a good approximation for any
 *     feature wider than 1/SS of a pixel. err = |1x - truth| per building pixel
 *     (mean over R,G,B, 0..255); reported as mean and 99th percentile. `band` is
 *     the same after a 3x3 box on both images: what survives is the low-frequency
 *     part (bands), jaggies and one-pixel speckle are averaged out.
 *  b. OVER MOTION. The camera moves FRAMES times by a fraction of a pixel
 *     (STEP_PX) and every step is drawn both ways. e_i = 1x_i - truth_i removes
 *     the true motion (truth moves identically). flicker = per-pixel standard
 *     deviation of e_i over the steps: the part of the picture that changes
 *     between frames and should not. A static false pattern does not flicker, so
 *     (a) and (b) are separate numbers.
 *
 * BUILDING PIXELS. The view is drawn a second time with the building layers
 * hidden; a pixel that differs is a building pixel. It is split in two so the
 * table says WHO draws it: A = the three.js authored buildings (layer
 * slopes-mesh), B = MapLibre fill-extrusion walls (patterns, solids). Pixels that
 * differ in both hidden-sets belong to whichever hides first (A), so A+B = mask.
 *
 * THE FLOOR. A flat-colour wall has nothing to alias, so what the meter reads
 * there is the instrument's own noise (lighting that depends on the pixel ratio,
 * rounding, MSAA edge resolve). floor = the same numbers over building pixels
 * whose TRUTH is flat (3x3 neighbourhood spread under FLAT_LEVELS). "Zero moire"
 * means err and flicker at or under FLOOR_SLACK x that floor. Edges are NOT in
 * the floor (a flat wall's silhouette is not flat in the truth); they are in the
 * view's numbers, so a view cannot reach the floor while its edges alias.
 *
 * Usage (serve the repo first: python3 scripts/serve.py <port>):
 *   VERIFY_URL=http://127.0.0.1:<port> node moire-meter.mjs --out <dir> [options]
 *     --views a,b    names from VIEWS (default all)
 *     --msaa 0|1     Smooth edges for the whole run (default 0: the worst case, which is
 *                    what an integrated chip, a phone and the CI harness draw)
 *     --q k=v,...    extra URL switches (e.g. moirefix=0 for the BEFORE side)

 *     --size WxH     viewport in CSS px (default 480x300)
 *     --ss N         supersample factor (default 4)
 *     --frames N     motion steps (default 8)
 *     --arms "a=js|b=js"  runtime variants run in the SAME page load (one load, every arm on every
 *                    view; `m` is the map). Default: one arm, "main", which runs nothing.
 *     --json file    write the table as JSON
 *     --from file    no browser: score a --json file from an earlier run (same table, same exit code)
 * Run it through the machine's one-browser queue (gpu-run.mjs); software GL is
 * enough, the aliasing comes from the shader maths, not the chip.
 */
import fs from 'node:fs';
import path from 'node:path';
import { statOver, settleWith, tableLines, verdict, f2 } from './moire-score.mjs';

// ---- everything you may want to change is in this block -------------------
let VIEW_W = 480, VIEW_H = 300;         // CSS px (--size WxH); the SS frame is SS x this
const STEP_PX = 0.3;                    // camera step per frame, in 1x pixels
const FLAT_LEVELS = 2.5;                // truth 3x3 spread (0..255) that counts as flat
const MASK_LEVELS = 8;                  // |hidden - shown| that counts as a building pixel
const FLOOR_SLACK = 1.5;                // "at the floor" = at or under this x floor (+FLOOR_ABS)
const FLOOR_ABS = 0.15;                 // and never stricter than this many levels
const SUN_P = 0.5;                      // time of day (app default, sunset)
// Building layers hidden to find building pixels. Anything else stays: sky, ground,
// roads, shadows, trees, signs. (ids are matched against MapLibre fill-extrusion layers)
const NOT_BUILDING = /^(ground|props|capitol-ground|stadium-field|roofscape)/;
const AUTHORED = 'slopes-mesh';         // the three.js layer that draws the authored buildings
const VIEWS = [
  // name, group, camera. West Campus towers, the Drag, campus halls, downtown; far / middle / near.
  { name: 'west-far',      grp: 'west',     center: [-97.7445, 30.2880],  zoom: 16.6,  pitch: 72, bearing: 300 },
  { name: 'west-mid',      grp: 'west',     center: [-97.74495, 30.2866], zoom: 17.9,  pitch: 70, bearing: 205 },
  { name: 'west-near',     grp: 'west',     center: [-97.74525, 30.287604], zoom: 18.1, pitch: 55, bearing: 45 },
  { name: 'drag-mid',      grp: 'drag',     center: [-97.74155, 30.2876], zoom: 17.8,  pitch: 70, bearing: 180 },
  { name: 'drag-low',      grp: 'drag',     center: [-97.7422, 30.2903],  zoom: 18.0,  pitch: 65, bearing: 0 },
  { name: 'campus-far',    grp: 'campus',   center: [-97.7393, 30.2874],  zoom: 16.85, pitch: 74, bearing: 197.4 },
  { name: 'campus-low',    grp: 'campus',   center: [-97.7395, 30.2860],  zoom: 17.2,  pitch: 72, bearing: 160 },
  { name: 'campus-near',   grp: 'campus',   center: [-97.73932, 30.28637], zoom: 18.0, pitch: 64, bearing: 180 },
  { name: 'downtown-far',  grp: 'downtown', center: [-97.7430, 30.2690],  zoom: 16.4,  pitch: 70, bearing: 20 },
  { name: 'downtown-near', grp: 'downtown', center: [-97.7432, 30.2688],  zoom: 18.4,  pitch: 70, bearing: 20 },
];
// ----------------------------------------------------------------------------

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const OUT = opt('--out', null);
const FROM = opt('--from', null);
if (!OUT && !FROM) { console.error('usage: moire-meter.mjs --out <dir> [--views a,b] [--msaa 0|1] [--q k=v] [--ss 4] [--frames 8] [--json f]   |   --from <json>'); process.exit(2); }
if (OUT) fs.mkdirSync(OUT, { recursive: true });
{ const sz = opt('--size', null); if (sz) [VIEW_W, VIEW_H] = sz.split('x').map(Number); }
let SS = +opt('--ss', '4'), FRAMES = +opt('--frames', '8');
if (!FROM && !(Number.isInteger(FRAMES) && FRAMES >= 2)) { console.error(`--frames ${opt('--frames', '8')}: flicker is a spread over camera steps and needs at least 2 frames (a single frame would report flicker 0 as if it were a pass)`); process.exit(2); }
let MSAA = opt('--msaa', '0') === '1';
let QS = (opt('--q', '') || '').split(',').map(s => s.trim()).filter(Boolean);
const ARMS = (opt('--arms', 'main=') || 'main=').split('|').map(a => { const i = a.indexOf('='); return { name: a.slice(0, i), js: a.slice(i + 1) }; });
const want = (opt('--views', '') || '').split(',').filter(Boolean);
const list = want.length ? VIEWS.filter(v => want.includes(v.name)) : VIEWS;

let rows = [], browser = null, page = null;
const errs = [];
if (FROM) {
  const j = JSON.parse(fs.readFileSync(FROM, 'utf8'));
  rows = j.rows; if (j.size) [VIEW_W, VIEW_H] = j.size;
  MSAA = !!j.msaa; QS = j.q || []; SS = j.ss ?? SS; FRAMES = j.frames ?? FRAMES;
} else {
const { chromium } = await import('playwright-core');
const { BASE, launch } = await import('./chrome.mjs');
browser = await launch(chromium, { maxMs: +(process.env.VERIFY_MAX_MS || 3000000) });
page = await browser.newPage({ viewport: { width: VIEW_W, height: VIEW_H }, deviceScaleFactor: 1 });
page.on('pageerror', e => errs.push(e.message));
// MSAA and "already auto-detected" must be in storage before the map is built.
await page.addInitScript(cfg => {
  try {
    const K = 'austin3d.gfx.v1', cur = JSON.parse(localStorage.getItem(K) || '{}');
    cur.msaa = cfg.msaa; cur.autoDetected = true; cur.autoExposure = false;
    localStorage.setItem(K, JSON.stringify(cur));
  } catch (e) {}
}, { msaa: MSAA });
const t0 = Date.now(), T = () => ((Date.now() - t0) / 1000).toFixed(0) + 's';
await page.goto(`${BASE}/_harness.html?intro=0&drift=0${QS.length ? '&' + QS.join('&') : ''}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 420000 }).catch(async e => {
  console.error('[meter] style did not load:', await page.evaluate(() => ({ map: !!window.__map, loaded: window.__map && window.__map.isStyleLoaded(), errs: (window.__errs || []) })).catch(x => String(x)), [...new Set(errs)].slice(0, 6));
  throw e;
});
await page.evaluate(() => { window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect(); if (window.GFX) window.GFX.autoExposure = false; });
console.error(`[meter] style loaded ${T()}`);

// ---- the in-page instrument ------------------------------------------------
await page.evaluate(`window.__moireScore = { statOver: ${statOver}, settleWith: ${settleWith} };`);
await page.evaluate(({ SS, FLAT_LEVELS, MASK_LEVELS, NOT_BUILDING, AUTHORED, STEP_PX, SUN_P }) => {
  const m = window.__map;
  const quiet = () => { const P = window.__facadePace, A = window.slopesApartments && window.slopesApartments.count; return !(P && P.busy) && !(A && !A.done); };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const { statOver, settleWith } = window.__moireScore;
  // walls stamped, buildings built, map idle - twice (moire-score.mjs)
  const settle = () => settleWith({ quiet, sleep, now: Date.now, quietMaxMs: 120000, idleMaxMs: 60000,
    waitIdle: ms => new Promise(r => { const to = setTimeout(() => r(false), ms); m.once('idle', () => { clearTimeout(to); r(true); }); m.triggerRepaint(); }) });
  async function setScale(s) { window.GFX.renderScale = s; window.applyGraphics(); await settle(); }
  const cv2 = document.createElement('canvas'), cx2 = cv2.getContext('2d', { willReadFrequently: true });
  function grab() {
    const c = m.getCanvas(); cv2.width = c.width; cv2.height = c.height;
    cx2.drawImage(c, 0, 0);
    return { w: c.width, h: c.height, d: cx2.getImageData(0, 0, c.width, c.height).data };
  }
  function box(big, w, h) {                       // SS x SS box filter -> Float32 RGB at w x h
    const out = new Float32Array(w * h * 3), W = big.w, k = 1 / (SS * SS);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0;
      for (let j = 0; j < SS; j++) { let i = ((y * SS + j) * W + x * SS) * 4; for (let q = 0; q < SS; q++, i += 4) { r += big.d[i]; g += big.d[i + 1]; b += big.d[i + 2]; } }
      const o = (y * w + x) * 3; out[o] = r * k; out[o + 1] = g * k; out[o + 2] = b * k;
    }
    return out;
  }
  const hideIds = () => m.getLayersOrder().filter(id => { const l = m.getLayer(id); return l && l.type === 'fill-extrusion' && !new RegExp(NOT_BUILDING).test(id); });
  async function withHidden(ids, fn) {
    const prev = ids.map(id => [id, m.getLayoutProperty(id, 'visibility')]);
    for (const id of ids) m.setLayoutProperty(id, 'visibility', 'none');
    await settle();
    try { return await fn(); } finally { for (const [id, v] of prev) m.setLayoutProperty(id, 'visibility', v || 'visible'); await settle(); }
  }
  const png = (rgb3, w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); const im = x.createImageData(w, h);
    for (let p = 0, o = 0, i = 0; p < w * h; p++, o += 3, i += 4) { im.data[i] = rgb3[o]; im.data[i + 1] = rgb3[o + 1]; im.data[i + 2] = rgb3[o + 2]; im.data[i + 3] = 255; } x.putImageData(im, 0, 0); return c.toDataURL('image/png'); };

  window.__meter = async function (v, frames) {
    m.stop(); m.jumpTo({ center: v.center, zoom: v.zoom, pitch: v.pitch, bearing: v.bearing });
    if (window.applyTimeOfDay) window.applyTimeOfDay(m, SUN_P, true);
    await setScale(1);
    const W = m.getCanvas().width, H = m.getCanvas().height, N = W * H;
    // -- which pixels are buildings, and whose --
    const shown = grab().d;
    const diffMask = hid => { const f = new Uint8Array(N); for (let p = 0, i = 0; p < N; p++, i += 4) f[p] = (Math.abs(hid[i] - shown[i]) + Math.abs(hid[i + 1] - shown[i + 1]) + Math.abs(hid[i + 2] - shown[i + 2])) / 3 > MASK_LEVELS ? 1 : 0; return f; };
    // the mask depends on the view, not on the arm: find it once per view
    const cache = (window.__maskCache = window.__maskCache || {});
    if (!cache[v.name]) {
      const hasAuthored = !!m.getLayer(AUTHORED);
      const mA = hasAuthored ? await withHidden([AUTHORED], async () => diffMask(grab().d)) : new Uint8Array(N);
      const mB = await withHidden(hideIds(), async () => diffMask(grab().d));
      const mk = new Uint8Array(N), sr = new Uint8Array(N);   // sr 1 = authored, 2 = maplibre
      for (let p = 0; p < N; p++) { if (mA[p]) { mk[p] = 1; sr[p] = 1; } else if (mB[p]) { mk[p] = 1; sr[p] = 2; } }
      cache[v.name] = { mask: mk, src: sr };
    }
    const mask = cache[v.name].mask, src = cache[v.name].src;
    let nMask = 0, nA = 0, nB = 0;
    for (let p = 0; p < N; p++) { if (mask[p]) nMask++; if (src[p] === 1) nA++; else if (src[p] === 2) nB++; }
    // -- frames: 1x and truth at each step --
    const c0 = m.project(v.center), e = [], truth0 = [], one0 = [];
    for (let f = 0; f < frames; f++) {
      const ctr = m.unproject([c0.x + f * STEP_PX, c0.y]);
      m.jumpTo({ center: ctr, zoom: v.zoom, pitch: v.pitch, bearing: v.bearing });
      await setScale(1); const one = grab();
      await setScale(SS); const big = grab();
      if (big.w !== W * SS || big.h !== H * SS) throw new Error(`truth canvas ${big.w}x${big.h}, wanted ${W * SS}x${H * SS}`);
      const tr = box(big, W, H);
      const E = new Float32Array(N * 3);                // signed 1x - truth, RGB
      for (let p = 0, i = 0, o = 0; p < N; p++, i += 4, o += 3) { E[o] = one.d[i] - tr[o]; E[o + 1] = one.d[i + 1] - tr[o + 1]; E[o + 2] = one.d[i + 2] - tr[o + 2]; }
      e.push(E);
      if (f === 0) { truth0.push(tr); one0.push(Uint8ClampedArray.from(one.d)); }
    }
    await setScale(1);
    const tr = truth0[0], one = one0[0];
    // -- flat truth (floor pixels) --
    const flat = new Uint8Array(N);
    const Lt = new Float32Array(N); for (let p = 0, o = 0; p < N; p++, o += 3) Lt[p] = (tr[o] + tr[o + 1] + tr[o + 2]) / 3;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      let lo = 1e9, hi = -1e9; for (let j = -1; j <= 1; j++) for (let q = -1; q <= 1; q++) { const l = Lt[(y + j) * W + x + q]; if (l < lo) lo = l; if (l > hi) hi = l; }
      flat[y * W + x] = hi - lo < FLAT_LEVELS ? 1 : 0;
    }
    // -- per-frame errors, pooled --
    const stat = sel => statOver(sel, { e, N, W, frames });
    const res = {
      name: v.name, canvas: [W, H], mask: nMask / N, authored: nA / N, maplibre: nB / N,
      all: stat(p => mask[p]), apt: stat(p => src[p] === 1), mpl: stat(p => src[p] === 2),
      floor: stat(p => mask[p] && flat[p]), flatShare: (() => { let a = 0, b = 0; for (let p = 0; p < N; p++) if (mask[p]) { a++; if (flat[p]) b++; } return a ? b / a : 0; })(),
      pngOne: png((() => { const o = new Uint8ClampedArray(N * 3); for (let p = 0, i = 0, k = 0; p < N; p++, i += 4, k += 3) { o[k] = one[i]; o[k + 1] = one[i + 1]; o[k + 2] = one[i + 2]; } return o; })(), W, H),
      pngTruth: png(Uint8ClampedArray.from(tr, x => x), W, H),
      pngMask: png((() => { const o = new Uint8ClampedArray(N * 3); for (let p = 0, k = 0; p < N; p++, k += 3) { o[k] = src[p] === 1 ? 255 : 0; o[k + 1] = src[p] === 2 ? 255 : 0; o[k + 2] = mask[p] ? 0 : 60; } return o; })(), W, H),
    };
    return res;
  };
}, { SS, FLAT_LEVELS, MASK_LEVELS, NOT_BUILDING: NOT_BUILDING.source, AUTHORED, STEP_PX, SUN_P });

for (const v of list) for (const arm of ARMS) {
  const tv = Date.now();
  await page.evaluate(js => { const m = window.__map; if (js) new Function('m', js)(m); }, arm.js);
  const r = await page.evaluate(([v, n]) => window.__meter(v, n), [v, FRAMES]);
  const b64 = k => Buffer.from(r[k].split(',')[1], 'base64');
  const tag = ARMS.length > 1 ? `${v.name}.${arm.name}` : v.name;
  fs.writeFileSync(path.join(OUT, `${tag}-1x.png`), b64('pngOne'));
  fs.writeFileSync(path.join(OUT, `${tag}-truth.png`), b64('pngTruth'));
  fs.writeFileSync(path.join(OUT, `${tag}-mask.png`), b64('pngMask'));
  delete r.pngOne; delete r.pngTruth; delete r.pngMask;
  r.grp = v.grp; r.arm = arm.name; r.name = tag; rows.push(r);
  console.error(`[meter] ${tag} ${((Date.now() - tv) / 1000).toFixed(0)}s mask ${(r.mask * 100).toFixed(1)}% err ${f2(r.all.err)} flick ${f2(r.all.flick)}${r.all.n ? '' : '  EMPTY MASK'}`);
}

}

// ---- the table ---------------------------------------------------------------
console.log(`moire-meter  msaa=${MSAA ? 'on' : 'off'}  q=[${QS.join(',')}]  ${VIEW_W}x${VIEW_H} ss=${SS} frames=${FRAMES} step=${STEP_PX}px  floor rule: <= ${FLOOR_SLACK} x floor + ${FLOOR_ABS}`);
for (const line of tableLines(rows, { FLOOR_SLACK, FLOOR_ABS })) console.log(line);
if (page) { const h = await page.evaluate(() => ({ compiled: !!(window.CityLighting && window.CityLighting.patternFilter.compiled), failures: (window.CityLighting && window.CityLighting.stats.failures) || [], vertex: window.CityLighting && window.CityLighting.stats.vertexShaders, fragment: window.CityLighting && window.CityLighting.stats.fragmentShaders }));
  console.log(`city-lighting: pattern filter compiled=${h.compiled}, shader failures=${h.failures.length}${h.failures.length ? ' ' + JSON.stringify(h.failures).slice(0, 300) : ''}`); }
if (errs.length) console.error('PAGE ERRORS:', [...new Set(errs)].slice(0, 5).join(' | '));
const jf = opt('--json', null);
if (jf) fs.writeFileSync(jf, JSON.stringify({ msaa: MSAA, q: QS, ss: SS, frames: FRAMES, size: [VIEW_W, VIEW_H], rows }, null, 1));
const failures = verdict(rows, { FLOOR_SLACK, FLOOR_ABS, FRAMES });
for (const f of failures) console.error('[meter] FAIL: ' + f);
if (failures.length) process.exitCode = 1;
if (browser) await browser.__done();
