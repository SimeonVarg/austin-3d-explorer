/**
 * moire-bar.mjs - THE MOIRE BAR: every view against its flat-wall floor, with the meter's own noise.
 *
 * "Zero moire" is stated so it can be failed. For each view the camera makes FRAMES steps of STEP px
 * (consecutive frames one pixel of camera travel apart) and three pictures of the city are compared:
 *
 *   main   the city as `main` draws it (?moirefix=0)
 *   fix    the city with the moire fix on
 *   flat   THE FLOOR: every window cell drawn in its wall's mean colour. A wall with no window grid has
 *          nothing periodic to alias, so what the meter still reads is silhouette aliasing (roof lines,
 *          building edges, thin parts), which no window fix can remove.
 *
 * Two numbers per arm, in levels of 255, over BUILDING pixels only:
 *   err      mean |1x - truth|. truth = SS x SS pictures of the same camera at the SAME resolution, the lens
 *            shifted a fraction of a pixel each time (map padding: an exact sub-pixel translation), averaged:
 *            a 4x4 supersample whose shading reads the same pixel size as the 1x picture. (A frame drawn at
 *            SS x the pixels, --truth scale, is NOT that: the roof tiles, the brick joints and every other
 *            fade that reads the pixel size draw MORE detail in it, and the meter then scores the 1x
 *            picture's deliberate smoothness as error.) `main` and `fix` are both held to the truth of MAIN
 *            (a fix cannot move its own target); `flat` is held to its own truth.
 *   flicker  mean |e(f+1) - e(f)| between consecutive frames, e = 1x - truth (the truth moves the same
 *            way, so real motion cancels and what is left changes between frames and should not).
 *   bias     signed mean of (1x - truth): a fix that darkens or lightens far walls shows here.
 *
 * NOISE. Every frame of `main` is shot a second time after the whole pass (camera put back, same
 * switches). noise = |score(second) - score(first)| per view; `px` is the mean |1x(second) - 1x(first)|.
 * A claim is only made against that. AT THE FLOOR means: fix <= flat + noise + SLACK, for err and flicker.
 *
 * Everything is ONE page load: arms are flipped inside the page (window.MoireFix.set), nothing reloads.
 * The page is frozen: ?namelabels=0&facadepace=0&timeofdaypace=0&drift=0&intro=0, auto-detect cancelled,
 * auto-exposure off.
 *
 *   VERIFY_URL=http://127.0.0.1:<port> node moire-bar.mjs [--out dir] [options]
 *     --views a,b      names from VIEWS (default: the bar's six)
 *     --arms a,b       from ARMS (default main,fix,flat). On a branch without the fix: --arms main
 *     --msaa 0|1       Smooth edges (real MSAA, ?smooth=) for the whole run (default 0)
 *     --size WxH       viewport in CSS px (default 960x600)
 *     --ss N           supersample factor of the truth (default 4)
 *     --frames N       motion steps (default 6)
 *     --step PX        camera travel per frame in 1x pixels (default 1)
 *     --q k=v,...      extra URL switches
 *     --frames-out     also save every 1x frame of every arm (for an animation)
 *     --gate           exit 1 unless every view is at the floor (default: a tool, always exit 0)
 * Writes <out>/bar.json, bar.txt and per view: <view>.<arm>.png (frame 0), <view>.truth.png, <view>.mask.png.
 * Needs a real GPU for a 3840x2400 truth frame (VERIFY_GL=hardware); see scripts/verify/README.md.
 */
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';

// ---- everything you may want to change is in this block -------------------
let VIEW_W = 960, VIEW_H = 600;         // CSS px (--size); the truth frame is SS x this
const MASK_LEVELS = 8;                  // |hidden - shown| that counts as a building pixel
const SLACK = 0.05;                     // levels allowed over floor + noise (rounding of an 8-bit frame)
const NOT_BUILDING = /^(ground|props|capitol-ground|stadium-field|roofscape)/;
const AUTHORED = 'slopes-mesh';         // the three.js layer that draws the authored buildings
const DAY = 0.2, NIGHT = 1.0;           // time of day (js/timeofday.js: 0 day .. 0.5 sunset .. 1 night)
// name, time of day, camera, and the direction of travel in screen pixels (a sideways drag, or forward along a street)
const VIEWS = [
  { name: 'campus-far',       p: DAY,   center: [-97.7393, 30.2874],   zoom: 16.85, pitch: 74, bearing: 197.4, dir: [1, 0] },
  { name: 'west-mid',         p: DAY,   center: [-97.7445, 30.2880],   zoom: 16.6,  pitch: 72, bearing: 300,   dir: [1, 0] },
  { name: 'guad-street',      p: DAY,   center: [-97.74175, 30.28700], zoom: 18.6,  pitch: 82, bearing: 356,   dir: [0, 1] },
  { name: 'downtown-far',     p: DAY,   center: [-97.7430, 30.2690],   zoom: 16.4,  pitch: 70, bearing: 20,    dir: [1, 0] },
  { name: 'campus-far-night', p: NIGHT, center: [-97.7393, 30.2874],   zoom: 16.85, pitch: 74, bearing: 197.4, dir: [1, 0] },
  { name: 'guad-street-night', p: NIGHT, center: [-97.74175, 30.28700], zoom: 18.6, pitch: 82, bearing: 356,   dir: [0, 1] },
  // not in the bar; kept for looking further (--views)
  { name: 'west-near',        p: DAY,   center: [-97.74525, 30.287604], zoom: 18.1, pitch: 55, bearing: 45,    dir: [1, 0] },
  { name: 'drag-mid',         p: DAY,   center: [-97.74155, 30.2876],  zoom: 17.8,  pitch: 70, bearing: 180,   dir: [1, 0] },
  { name: 'west-tower',       p: DAY,   center: [-97.74495, 30.2866],  zoom: 17.9,  pitch: 70, bearing: 205,   dir: [1, 0] },
  { name: 'downtown-night',   p: NIGHT, center: [-97.7430, 30.2690],   zoom: 16.4,  pitch: 70, bearing: 20,    dir: [1, 0] },
  { name: 'spawn-day',        p: 0.12,  center: [-97.7434, 30.2857],   zoom: 16.5,  pitch: 64, bearing: 90,    dir: [1, 0] },
];
const BAR = ['campus-far', 'west-mid', 'guad-street', 'downtown-far', 'campus-far-night', 'guad-street-night'];
// An arm: the page state (run before every picture of that arm) and whose truth it is held to.
const ARMS = {
  main: { js: 'window.MoireFix && (window.MoireFix.reset(), window.MoireFix.set("off"))', truth: 'main' },
  fix:  { js: 'window.MoireFix.reset(); window.MoireFix.set("on")',  truth: 'main' },
  flat: { js: 'window.MoireFix.reset(); window.MoireFix.set("flat")', truth: 'flat' },
};
// ----------------------------------------------------------------------------

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const OUT = opt('--out', process.env.VERIFY_OUT || null);
if (!OUT) { console.error('usage: moire-bar.mjs --out <dir> [--views a,b] [--arms main,fix,flat] [--msaa 0|1] [--size WxH] [--ss 4] [--frames 6]'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
{ const sz = opt('--size', null); if (sz) [VIEW_W, VIEW_H] = sz.split('x').map(Number); }
const SS = +opt('--ss', '4'), FRAMES = +opt('--frames', '6'), STEP_PX = +opt('--step', '1');
const MSAA = opt('--msaa', '0') === '1';
const TRUTH = opt('--truth', 'jitter');   // 'jitter' (default) or 'scale' (one frame at SS x the pixels: shader fades that read the pixel size then differ from the 1x picture)
const FRAMES_OUT = argv.includes('--frames-out'), GATE = argv.includes('--gate');
const QS = ['intro=0', 'drift=0', 'namelabels=0', 'facadepace=0', 'timeofdaypace=0', 'moirefix=1', 'smooth=' + (MSAA ? 1 : 0)]   // moirefix=1: the fix is compiled in, the arms flip it (a later --q moirefix=0 wins: main's own program)
  .concat((opt('--q', '') || '').split(',').map(s => s.trim()).filter(Boolean));
// --xarm "name=js" (repeatable): one more arm, held to main's truth, whose page state is that JavaScript (for tuning a parameter inside one page load)
for (let i = 0; i < argv.length; i++) if (argv[i] === '--xarm') { const a = argv[i + 1], k = a.indexOf('='); ARMS[a.slice(0, k)] = { js: a.slice(k + 1), truth: 'main', extra: true }; }
const armNames = (opt('--arms', 'main,fix,flat')).split(',').filter(Boolean).concat(Object.keys(ARMS).filter(k => ARMS[k].extra));
const REPEAT = !argv.includes('--no-repeat');   // the second shot of main (the noise); off only for a tuning run
for (const a of armNames) if (!ARMS[a]) { console.error('unknown arm ' + a); process.exit(2); }
if (!armNames.includes('main')) { console.error('the main arm is the reference; it must be in --arms'); process.exit(2); }
const want = (opt('--views', '') || '').split(',').filter(Boolean);
const list = (want.length ? want : BAR).map(n => { const v = VIEWS.find(v => v.name === n); if (!v) { console.error('unknown view ' + n); process.exit(2); } return v; });

const browser = await launch(chromium, { maxMs: +(opt('--max-min', '55')) * 60000 });
const page = await browser.newPage({ viewport: { width: VIEW_W, height: VIEW_H }, deviceScaleFactor: 1 });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.addInitScript(cfg => {
  try {
    const K = 'austin3d.gfx.v1', cur = JSON.parse(localStorage.getItem(K) || '{}');
    cur.msaa = cfg.msaa; cur.autoDetected = true; cur.autoExposure = false;
    localStorage.setItem(K, JSON.stringify(cur));
  } catch (e) {}
}, { msaa: MSAA });
const t0 = Date.now(), T = () => ((Date.now() - t0) / 1000).toFixed(0) + 's';
await page.goto(`${BASE}/_harness.html?${QS.join('&')}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 420000 });
// The style being loaded is not the page being ready: the app is still booting (it sets its own time of day, adds the buildings' name layers,
// builds the authored buildings) and a meter that starts now races it. Measured: a warm second load started 2 s in and scored a SUNSET city
// with labels as "campus by day". Wait for the veil to go and the authored buildings to be built, then one more quiet second.
await page.waitForFunction(() => !document.getElementById('veil'), null, { timeout: 420000, polling: 500 });
await page.waitForFunction(() => { const A = window.slopesApartments; return !A || !!(A.count.done && A.group); }, null, { timeout: 420000, polling: 500 });
await page.waitForTimeout(1500);
await page.evaluate(() => { window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect(); if (window.GFX) window.GFX.autoExposure = false; });
console.error(`[bar] style loaded ${T()}`);

// ---- the in-page instrument ------------------------------------------------
await page.evaluate(({ SS, MASK_LEVELS, NOT_BUILDING, AUTHORED, STEP_PX, TRUTH }) => {
  const m = window.__map;
  const quiet = () => {
    const P = window.__facadePace, A = window.slopesApartments && window.slopesApartments.count, L = window.CityLighting && window.CityLighting.stats;
    return !(P && P.busy) && !(A && !A.done) && !(L && L.shadowProxyBuilding);
  };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let slow = 0;
  async function settle(extra) {                    // walls stamped, buildings built, shadows built, map idle - twice
    if (extra) await sleep(extra);
    for (let k = 0; k < 2; k++) {
      const t = Date.now();
      while (!quiet() && Date.now() - t < 120000) await sleep(100);
      await new Promise(r => { const to = setTimeout(() => { slow++; r(); }, 20000); m.once('idle', () => { clearTimeout(to); r(); }); m.triggerRepaint(); });
      await sleep(60);
    }
  }
  async function setScale(s) { if (window.GFX.renderScale !== s) { window.GFX.renderScale = s; window.applyGraphics(); } await settle(); }
  const cv2 = document.createElement('canvas'), cx2 = cv2.getContext('2d', { willReadFrequently: true });
  function grab() {
    const c = m.getCanvas(); cv2.width = c.width; cv2.height = c.height;
    cx2.drawImage(c, 0, 0);
    return { w: c.width, h: c.height, d: cx2.getImageData(0, 0, c.width, c.height).data };
  }
  function rgb(g) { const N = g.w * g.h, o = new Float32Array(N * 3); for (let p = 0, i = 0, k = 0; p < N; p++, i += 4, k += 3) { o[k] = g.d[i]; o[k + 1] = g.d[i + 1]; o[k + 2] = g.d[i + 2]; } return o; }
  function box(big, w, h) {                         // SS x SS box filter -> Float32 RGB at w x h
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
    await settle(300);
    try { return await fn(); } finally { for (const [id, v] of prev) m.setLayoutProperty(id, 'visibility', v || 'visible'); await settle(300); }
  }
  const png = (rgb3, w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); const im = x.createImageData(w, h);
    for (let p = 0, o = 0, i = 0; p < w * h; p++, o += 3, i += 4) { im.data[i] = rgb3[o]; im.data[i + 1] = rgb3[o + 1]; im.data[i + 2] = rgb3[o + 2]; im.data[i + 3] = 255; } x.putImageData(im, 0, 0); return c.toDataURL('image/png'); };
  const run = async js => { if (js) await new (Object.getPrototypeOf(async function () {}).constructor)('m', js)(m); };

  window.__bar = async function (v, frames, arms, framesOut, repeat) {
    m.stop(); m.jumpTo({ center: v.center, zoom: v.zoom, pitch: v.pitch, bearing: v.bearing });
    if (window.applyTimeOfDay) window.applyTimeOfDay(m, v.p, true);
    // Text is not a wall: a label over a building is "building pixels" to the mask, its letters would be scored as error, and labels fade in and
    // out as the camera moves. Hide every symbol layer, at every view (the building generators add theirs after the style has loaded).
    for (const id of m.getLayersOrder()) { const l = m.getLayer(id); if (l && l.type === 'symbol' && m.getLayoutProperty(id, 'visibility') !== 'none') m.setLayoutProperty(id, 'visibility', 'none'); }
    await run(arms[0].js);
    await setScale(1); await settle(800);
    const W = m.getCanvas().width, H = m.getCanvas().height, N = W * H;
    // -- which pixels are buildings, and whose --
    const shown = grab().d;
    const diffMask = hid => { const f = new Uint8Array(N); for (let p = 0, i = 0; p < N; p++, i += 4) f[p] = (Math.abs(hid[i] - shown[i]) + Math.abs(hid[i + 1] - shown[i + 1]) + Math.abs(hid[i + 2] - shown[i + 2])) / 3 > MASK_LEVELS ? 1 : 0; return f; };
    const mA = m.getLayer(AUTHORED) ? await withHidden([AUTHORED], async () => diffMask(grab().d)) : new Uint8Array(N);
    const mB = await withHidden(hideIds(), async () => diffMask(grab().d));
    const src = new Uint8Array(N);                  // 1 = authored, 2 = maplibre walls, 0 = not a building
    // one pixel of margin: the camera moves `frames` pixels, and a pixel must be a building in every frame's neighbourhood to be worth scoring
    for (let p = 0; p < N; p++) src[p] = mA[p] ? 1 : mB[p] ? 2 : 0;
    // every camera position is worked out NOW, from the view's own centre: unproject() answers for the camera of the moment
    m.jumpTo({ center: v.center, zoom: v.zoom, pitch: v.pitch, bearing: v.bearing });
    const c0 = m.project(v.center), cams = [];
    for (let f = 0; f < frames; f++) cams.push(m.unproject([c0.x + f * STEP_PX * v.dir[0], c0.y + f * STEP_PX * v.dir[1]]));
    const camAt = f => cams[f];
    // -- the pictures: [arm][frame] 1x, and the truth of every arm that is somebody's truth --
    const truthOf = [...new Set(arms.map(a => a.truth))];
    const one = {}, tru = {}, shots = {};
    for (const a of arms) one[a.name] = [];
    for (const t of truthOf) tru[t] = [];
    const armBy = Object.fromEntries(arms.map(a => [a.name, a]));
    async function pass(list1, listT, into1, intoT) {
      for (let f = 0; f < frames; f++) {
        m.jumpTo({ center: camAt(f), zoom: v.zoom, pitch: v.pitch, bearing: v.bearing });
        await setScale(1); await settle(350);
        for (const a of list1) { await run(armBy[a].js); await settle(); into1[a].push(rgb(grab())); }
        if (TRUTH === 'scale') {
          await setScale(SS);
          for (const t of listT) { await run(armBy[t].js); await settle(); const big = grab(); if (big.w !== W * SS || big.h !== H * SS) throw new Error(`truth canvas ${big.w}x${big.h}, wanted ${W * SS}x${H * SS}`); intoT[t].push(box(big, W, H)); }
        } else {
          // SS x SS pictures at THIS resolution, the lens shifted by a fraction of a pixel each time (map padding moves the principal point:
          // an exact translation of the picture at every depth), and averaged. The samples sit where a SS-times-larger frame's pixel centres sit.
          for (const t of listT) {
            await run(armBy[t].js);
            const acc = new Float32Array(N * 3);
            for (let j = 0; j < SS; j++) for (let i = 0; i < SS; i++) {
              const dx = (i + 0.5) / SS - 0.5, dy = (j + 0.5) / SS - 0.5;
              m.setPadding({ left: dx > 0 ? 2 * dx : 0, right: dx < 0 ? -2 * dx : 0, top: dy > 0 ? 2 * dy : 0, bottom: dy < 0 ? -2 * dy : 0 });
              await settle();
              const g = grab().d; for (let p = 0, q = 0, o = 0; p < N; p++, q += 4, o += 3) { acc[o] += g[q]; acc[o + 1] += g[q + 1]; acc[o + 2] += g[q + 2]; }
            }
            m.setPadding({ left: 0, right: 0, top: 0, bottom: 0 }); await settle();
            const k = 1 / (SS * SS); for (let o = 0; o < acc.length; o++) acc[o] *= k;
            intoT[t].push(acc);
          }
        }
        await run(arms[0].js);
      }
      await setScale(1);
    }
    await pass(arms.map(a => a.name), truthOf, one, tru);
    // -- the second shot of main, for the noise --
    let one2 = { main: [] }, tru2 = { main: [] };
    if (repeat) await pass(['main'], ['main'], one2, tru2); else { one2 = one; tru2 = tru; }
    const st = window.slopes && window.slopes.stats ? window.slopes.stats() : null;
    // -- scores --
    const inner = p => { const x = p % W; return x >= 1 && x <= W - 2 && p >= W && p < N - W; };
    function score(O, Tr, sel) {
      let n = 0, sErr = 0, sFl = 0, sBias = 0;
      for (let p = 0; p < N; p++) {
        if (!sel(p) || !inner(p)) continue;
        n++; const o = p * 3;
        let pe0 = 0, pe1 = 0, pe2 = 0;
        for (let f = 0; f < frames; f++) {
          const e0 = O[f][o] - Tr[f][o], e1 = O[f][o + 1] - Tr[f][o + 1], e2 = O[f][o + 2] - Tr[f][o + 2];
          sErr += (Math.abs(e0) + Math.abs(e1) + Math.abs(e2)) / 3; sBias += (e0 + e1 + e2) / 3;
          if (f) sFl += (Math.abs(e0 - pe0) + Math.abs(e1 - pe1) + Math.abs(e2 - pe2)) / 3;
          pe0 = e0; pe1 = e1; pe2 = e2;
        }
      }
      return { n, err: n ? sErr / (n * frames) : 0, flicker: n && frames > 1 ? sFl / (n * (frames - 1)) : 0, bias: n ? sBias / (n * frames) : 0 };
    }
    const diffPx = (A, B, sel) => { let n = 0, s = 0; for (let p = 0; p < N; p++) { if (!sel(p) || !inner(p)) continue; n++; const o = p * 3; for (let f = 0; f < frames; f++) s += (Math.abs(A[f][o] - B[f][o]) + Math.abs(A[f][o + 1] - B[f][o + 1]) + Math.abs(A[f][o + 2] - B[f][o + 2])) / 3; } return n ? s / (n * frames) : 0; };
    const sels = { all: p => src[p] > 0, apt: p => src[p] === 1, mpl: p => src[p] === 2 };
    const res = { name: v.name, canvas: [W, H], slow, draw: st ? { tris: st.triangles, calls: st.calls } : null, share: {}, arms: {}, noise: {}, png: {} };
    for (const k in sels) { let n = 0; for (let p = 0; p < N; p++) if (sels[k](p)) n++; res.share[k] = n / N; }
    for (const a of arms) { res.arms[a.name] = {}; for (const k in sels) res.arms[a.name][k] = score(one[a.name], tru[a.truth], sels[k]); }
    for (const k in sels) {
      const a = score(one.main, tru.main, sels[k]), b = score(one2.main, tru2.main, sels[k]);
      res.noise[k] = { err: Math.abs(a.err - b.err), flicker: Math.abs(a.flicker - b.flicker), bias: Math.abs(a.bias - b.bias), px: diffPx(one.main, one2.main, sels[k]), truthPx: diffPx(tru.main, tru2.main, sels[k]), second: b };
    }
    // -- mean colour of the building pixels, per arm (frame 0): the far-mean check --
    for (const a of arms) { let n = 0, s = 0; const O = one[a.name][0]; for (let p = 0; p < N; p++) if (src[p] && inner(p)) { n++; s += (O[p * 3] + O[p * 3 + 1] + O[p * 3 + 2]) / 3; } res.arms[a.name].meanLevel = n ? s / n : 0; }
    { let n = 0, s = 0; const O = tru.main[0]; for (let p = 0; p < N; p++) if (src[p] && inner(p)) { n++; s += (O[p * 3] + O[p * 3 + 1] + O[p * 3 + 2]) / 3; } res.truthMeanLevel = n ? s / n : 0; }
    for (const a of arms) res.png[a.name] = framesOut ? one[a.name].map(o => png(o, W, H)) : [png(one[a.name][0], W, H)];
    for (const t of truthOf) res.png['truth-' + t] = [png(tru[t][0], W, H)];
    res.png.mask = [png((() => { const o = new Uint8ClampedArray(N * 3); for (let p = 0, k = 0; p < N; p++, k += 3) { o[k] = src[p] === 1 ? 255 : 0; o[k + 1] = src[p] === 2 ? 255 : 0; o[k + 2] = src[p] ? 0 : 60; } return o; })(), W, H)];
    return res;
  };
}, { SS, MASK_LEVELS, NOT_BUILDING: NOT_BUILDING.source, AUTHORED, STEP_PX, TRUTH });

const arms = armNames.map(n => ({ name: n, ...ARMS[n] }));
const rows = [];
for (const v of list) {
  const tv = Date.now();
  let r;
  try { r = await page.evaluate(([v, n, arms, fo, rp]) => window.__bar(v, n, arms, fo, rp), [v, FRAMES, arms, FRAMES_OUT, REPEAT]); }
  catch (e) { console.error(`[bar] ${v.name} FAILED: ${String(e.message || e).slice(0, 400)}`); rows.push({ name: v.name, failed: String(e.message || e).slice(0, 400) }); continue; }
  for (const k in r.png) r.png[k].forEach((u, i) => fs.writeFileSync(path.join(OUT, `${v.name}.${k}${r.png[k].length > 1 ? '.' + String(i).padStart(2, '0') : ''}.png`), Buffer.from(u.split(',')[1], 'base64')));
  delete r.png; rows.push(r);
  const s = a => r.arms[a] ? `${a} ${r.arms[a].all.err.toFixed(2)}/${r.arms[a].all.flicker.toFixed(2)}` : '';
  console.error(`[bar] ${v.name} ${((Date.now() - tv) / 1000).toFixed(0)}s bldg ${(r.share.all * 100).toFixed(0)}% (authored ${(r.share.apt * 100).toFixed(0)}%)  ${armNames.map(s).join('  ')}  noise ${r.noise.all.err.toFixed(3)}/${r.noise.all.flicker.toFixed(3)} px ${r.noise.all.px.toFixed(3)}${r.slow ? '  SLOW-IDLE x' + r.slow : ''}`);
}

// ---- the table ---------------------------------------------------------------
const f2 = x => x.toFixed(2), f3 = x => x.toFixed(3), pad = (s, n) => String(s).padEnd(n), lp = (s, n) => String(s).padStart(n);
const ctx = await page.evaluate(() => { const gl = window.__map.painter.context.gl; const e = gl.getExtension('WEBGL_debug_renderer_info'); return { samples: gl.getParameter(gl.SAMPLES), renderer: e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?', fix: window.MoireFix ? window.MoireFix.info() : null, failures: (window.CityLighting && window.CityLighting.stats.failures) || [] }; });
const lines = [];
lines.push(`moire-bar  msaa=${MSAA ? 'on' : 'off'} (context samples ${ctx.samples})  ${VIEW_W}x${VIEW_H} truth=${TRUTH} ss=${SS} frames=${FRAMES} step=${STEP_PX}px  arms=${armNames.join(',')}  renderer=${ctx.renderer}`);
lines.push(`levels of 255 over building pixels. err = mean |1x - 4x4 truth|; flicker = mean |e(f+1) - e(f)|; noise = second shot of main against the first. AT FLOOR: fix <= flat + noise + ${SLACK}`);
let allAt = true;
for (const who of ['all', 'apt', 'mpl']) {
  lines.push('');
  lines.push(who === 'all' ? 'ALL BUILDING PIXELS' : who === 'apt' ? 'AUTHORED BUILDINGS ONLY (three.js)' : 'MAPLIBRE PATTERN WALLS ONLY');
  lines.push(pad('view', 20) + lp('px%', 5) + ' |' + lp('floor', 7) + lp('main', 7) + lp('fixed', 7) + lp('noise', 7) + ' |' + lp('floor', 7) + lp('main', 7) + lp('fixed', 7) + lp('noise', 7) + ' |' + lp('bias m', 7) + lp('bias f', 7) + ' | at floor (err/flicker)');
  lines.push(pad('', 20) + lp('', 5) + ' |' + pad('  ERROR', 28) + ' |' + pad('  FLICKER', 28) + ' |');
  for (const r of rows) {
    if (r.failed) { lines.push(pad(r.name, 20) + ' FAILED ' + r.failed); allAt = false; continue; }
    const g = (a, k) => r.arms[a] ? r.arms[a][who][k] : NaN, nz = r.noise[who];
    const has = r.arms.fix && r.arms.flat;
    const okE = has && g('fix', 'err') <= g('flat', 'err') + nz.err + SLACK, okF = has && g('fix', 'flicker') <= g('flat', 'flicker') + nz.flicker + SLACK;
    if (who === 'all' && has && !(okE && okF)) allAt = false;
    const c = x => Number.isNaN(x) ? lp('-', 7) : lp(f2(x), 7);
    lines.push(pad(r.name, 20) + lp((r.share[who] * 100).toFixed(0), 5) + ' |' + c(g('flat', 'err')) + c(g('main', 'err')) + c(g('fix', 'err')) + lp(f3(nz.err), 7) + ' |' + c(g('flat', 'flicker')) + c(g('main', 'flicker')) + c(g('fix', 'flicker')) + lp(f3(nz.flicker), 7) + ' |' + c(g('main', 'bias')) + c(g('fix', 'bias')) + ' | ' + (has ? (okE ? 'YES' : 'no') + ' / ' + (okF ? 'YES' : 'no') : '-'));
  }
}
const extra = armNames.filter(a => ARMS[a].extra);
if (extra.length) { lines.push(''); lines.push('EXTRA ARMS, all building pixels: err / flicker / bias   (authored only: err / flicker)');
  for (const r of rows) if (!r.failed) lines.push(pad(r.name, 20) + ['main', 'fix', 'flat'].concat(extra).filter(a => r.arms[a]).map(a => ` ${a} ${f2(r.arms[a].all.err)}/${f2(r.arms[a].all.flicker)}/${f2(r.arms[a].all.bias)} (${f2(r.arms[a].apt.err)}/${f2(r.arms[a].apt.flicker)})`).join(' |')); }
lines.push('');
lines.push('NOISE DETAIL (all building pixels): px = mean |1x second - 1x first|, truthPx the same for the truth; meanLevel = mean brightness of building pixels at frame 0');
for (const r of rows) if (!r.failed) lines.push(pad(r.name, 20) + ` px ${f3(r.noise.all.px)}  truthPx ${f3(r.noise.all.truthPx)}  second main ${f2(r.noise.all.second.err)}/${f2(r.noise.all.second.flicker)}  meanLevel truth ${f2(r.truthMeanLevel)} ${armNames.map(a => a + ' ' + f2(r.arms[a].meanLevel)).join(' ')}  tris ${r.draw ? r.draw.tris : '-'}${r.slow ? '  slow-idle ' + r.slow : ''}`);
if (ctx.fix) lines.push('fix: ' + JSON.stringify(ctx.fix));
if (ctx.failures.length) lines.push('SHADER FAILURES: ' + JSON.stringify(ctx.failures).slice(0, 600));
if (errs.length) lines.push('PAGE ERRORS: ' + [...new Set(errs)].slice(0, 6).join(' | '));
const text = lines.join('\n');
console.log(text);
fs.writeFileSync(path.join(OUT, 'bar.txt'), text + '\n');
fs.writeFileSync(path.join(OUT, 'bar.json'), JSON.stringify({ msaa: MSAA, samples: ctx.samples, renderer: ctx.renderer, size: [VIEW_W, VIEW_H], ss: SS, frames: FRAMES, step: STEP_PX, q: QS, arms: armNames, fix: ctx.fix, rows }, null, 1));
await browser.__done();
process.exit(GATE && !allAt ? 1 : 0);
