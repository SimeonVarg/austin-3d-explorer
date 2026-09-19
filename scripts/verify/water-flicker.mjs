/**
 * water-flicker.mjs — does the WATER flicker while the camera moves? Measure it.
 *
 * "The water flickers during movement" cannot be seen in a still, and it cannot
 * be judged from the whole frame either: a moving camera changes most of the
 * frame on every step. So this instrument looks ONLY at water pixels and asks
 * the one question a flicker answers differently from ordinary motion:
 *
 *   FLIP  — over three consecutive frames of a small, monotonic camera step, a
 *           pixel's luma goes up then down (or down then up) by >= AMP both
 *           times. Real geometry under a small monotonic step changes
 *           monotonically; a depth tie, a shadow-map texel swim or an aliasing
 *           pattern does not. flip% = flipped pixel-triplets / eligible ones.
 *   JUMP  — |luma(i) - luma(i-1)| >= JUMP on a water pixel. A flat water
 *           surface under a sub-metre step barely changes; this is the raw
 *           "something on the water changed between frames" rate.
 *   STOPGO — the SAME poses are rendered twice: once in flight (one frame per
 *           pose, no waiting, exactly how js/controls.js drives the camera with
 *           one jumpTo per frame) and once stopped (idle + settle at each pose).
 *           |moving - stopped| >= JUMP on a water pixel means the picture
 *           depends on whether the camera is moving at all — the fingerprint of
 *           anything cached against camera travel (shadow maps, proxies, LOD).
 *
 * Every metric is reported for the MOVING sequence and for the STOPPED
 * sequence at the same poses. The stopped sequence is the control: whatever
 * pure geometry change the step itself causes is in both.
 *
 * WHICH PIXELS ARE WATER is not guessed from colour (the lake is tan at
 * sunset and near-black at night). A separate MASK pass replays the exact
 * same poses with every water surface keyed to magenta — the basemap water
 * fill, the ground areas classed water/pond, the creek channel's water prisms
 * — with the translucent overlays that sit on water hidden. The mask is eroded
 * by ERODE px so a shoreline creeping one pixel is not scored as flicker.
 *
 * ARMS are hypothesis toggles run in the SAME browser session, interleaved,
 * each with an `on` and an `off` snippet (evaluated in the page with `m` =
 * the map). One variable per arm.
 *
 * Usage:
 *   node water-flicker.mjs <plan.json> <outDir> [--q=lite=1] [--save] [--reps=N]
 *
 * plan.json:
 *   { "viewport": [1280, 800],
 *     "arms": [ {"name": "base"}, {"name": "nosheen", "on": "...", "off": "..."} ],
 *     "trajectories": [ { "name": "waller-translate", "p": 0.5, "frames": 24,
 *        "a": {center, zoom, pitch, bearing}, "b": {center, zoom, pitch, bearing},
 *        "box": [x0,y0,x1,y1]?, "mask": "water"|"box"?, "arms": ["base", ...]?,
 *        "stopMs": 900?, "stopped": false? } ] }
 *
 *   mask "box" scores every pixel in `box` instead of keyed water (crossings).
 *   arms  restricts that trajectory to the named arms.
 *
 * Exit codes: 0 ran; 2 could not run (no water in the mask, camera did not move).
 * This is a measuring instrument, not a gate — thresholds live in the doc.
 */
import { chromium } from 'playwright-core';
import { BASE as SERVER, launch } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';

const PLAN = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const OUT = path.resolve(process.argv[3] || 'water-flicker-out');
const Q = (process.argv.find(a => a.startsWith('--q=')) || '').slice(4);
const SAVE = process.argv.includes('--save');
const REPS = +((process.argv.find(a => a.startsWith('--reps=')) || '--reps=1').slice(7));
fs.mkdirSync(OUT, { recursive: true });

const AMP = +(process.env.WF_AMP || 6);      // luma units, flip amplitude floor
const JUMP = +(process.env.WF_JUMP || 12);   // luma units, jump threshold
const ERODE = +(process.env.WF_ERODE || 2);  // px
const [VW, VH] = PLAN.viewport || [1280, 800];

const browser = await launch(chromium, { gl: process.env.VERIFY_GL || 'hardware', maxMs: 60 * 60 * 1000 });
const page = await browser.newPage({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('PAGEERR', e.message));
page.on('console', msg => { if (msg.type() === 'error' && /city-lighting|WebGL/.test(msg.text())) console.log('CONSOLE', msg.text()); });

const url = SERVER + '/_harness.html?intro=0&drift=0' + (Q ? '&' + Q : '');
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
await page.waitForFunction(() => {
  const v = document.getElementById('veil');
  return !v || getComputedStyle(v).opacity === '0' || v.style.display === 'none';
}, null, { timeout: 180000 }).catch(() => console.log('WARN: veil did not lift'));
await page.waitForFunction(() => !window.slopesApartments || window.slopesApartments.readyToReveal(), null, { timeout: 120000 })
  .catch(() => console.log('WARN: authored buildings not ready'));
await page.waitForTimeout(3000);

const env = await page.evaluate(() => {
  const m = window.__map, gl = m.getCanvas().getContext('webgl2');
  let renderer = '?';
  try { const e = gl.getExtension('WEBGL_debug_renderer_info'); renderer = gl.getParameter(e.UNMASKED_RENDERER_WEBGL); } catch (e) {}
  return {
    url: location.search, renderer,
    depthBits: gl.getParameter(gl.DEPTH_BITS), stencilBits: gl.getParameter(gl.STENCIL_BITS),
    samples: gl.getParameter(gl.SAMPLES), canvas: m.getCanvas().width + 'x' + m.getCanvas().height,
    gfx: window.GFX && { preset: window.GFX.preset, renderScale: window.GFX.renderScale, msaa: window.GFX.msaa, shadows: window.GFX.shadows },
    lite: !!(window.MOBILE && window.MOBILE.lite) || /lite=1/.test(location.search),
    sunlight: window.SLOPES && { on: window.SLOPES.sunlight.on, shadows: window.SLOPES.sunlight.shadows },
    // THE CAUSE, read back off the compiled programs rather than remembered:
    // MapLibre clamps fill-extrusion base/height at zero, so the creek's
    // below-grade prisms all draw at z=0. If this ever reads false the creek
    // really is sunk and GROUND.creekSheenLift/creekDeckLift must be revisited.
    extrusionClampsAtZero: (() => {
      const gl2 = m.painter.context.gl; let seen = 0, clamped = 0;
      for (const [k, prog] of Object.entries(m.painter.cache || {})) {
        if (!/^fillExtrusion/.test(k)) continue;
        for (const sh of gl2.getAttachedShaders(prog.program) || []) {
          if (gl2.getShaderParameter(sh, gl2.SHADER_TYPE) !== gl2.VERTEX_SHADER) continue;
          seen++; if (/base\s*=\s*max\(0\.0,\s*base\)/.test(gl2.getShaderSource(sh))) clamped++;
        }
      }
      return seen ? clamped === seen : 'no extrusion program compiled yet';
    })(),
    sheenPaint: m.getLayer('ground-creek-sheen') ? { base: m.getPaintProperty('ground-creek-sheen', 'fill-extrusion-base'), height: m.getPaintProperty('ground-creek-sheen', 'fill-extrusion-height') } : null,
    layers: m.getStyle().layers.filter(l => /water|creek|sheen|channel|ground-base-texture|ground-texture|ground-areas/.test(l.id + ' ' + (l['source-layer'] || '')))
      .map(l => l.id + (l['source-layer'] ? '<' + l['source-layer'] + '>' : '') + ':' + l.type + ((l.layout || {}).visibility === 'none' ? '(hidden)' : '')),
  };
});
console.log('ENV', JSON.stringify(env));

// ── in-page instrument ────────────────────────────────────────────────────
await page.evaluate(({ AMP, JUMP, ERODE }) => {
  const m = window.__map;
  let cv = null, cx = null;
  function ensure() {
    const gl = m.getCanvas();
    if (!cv || cv.width !== gl.width || cv.height !== gl.height) {
      cv = document.createElement('canvas'); cv.width = gl.width; cv.height = gl.height;
      cx = cv.getContext('2d', { willReadFrequently: true });
    }
  }
  function grabRGBA() { ensure(); cx.drawImage(m.getCanvas(), 0, 0); return cx.getImageData(0, 0, cv.width, cv.height); }
  function luma(img) {
    const d = img.data, n = cv.width * cv.height, L = new Uint8Array(n);
    for (let p = 0, j = 0; p < n; p++, j += 4) L[p] = (d[j] * 299 + d[j + 1] * 587 + d[j + 2] * 114) / 1000;
    return L;
  }
  function keyMask(img) {
    const d = img.data, W = cv.width, H = cv.height, K = new Uint8Array(W * H);
    for (let p = 0, j = 0; p < W * H; p++, j += 4) {
      const r = d[j], g = d[j + 1], b = d[j + 2];
      if (g < 50 && r > 60 && b > 60 && Math.abs(r - b) < 110) K[p] = 1;
    }
    // erode ERODE px (square) so shoreline motion is not flicker
    let cur = K;
    for (let e = 0; e < ERODE; e++) {
      const nx = new Uint8Array(W * H);
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const p = y * W + x;
        if (cur[p] && cur[p - 1] && cur[p + 1] && cur[p - W] && cur[p + W]) nx[p] = 1;
      }
      cur = nx;
    }
    return cur;
  }

  // ── keying the water ──
  const saved = {};
  function waterIds() {
    return m.getStyle().layers.filter(l => l['source-layer'] === 'water' && l.type === 'fill').map(l => l.id);
  }
  function key(on) {
    const hideWhenKeyed = ['ground-base-texture', 'ground-texture', 'ground-creek-sheen', 'ground-close-area-grain'];
    if (on) {
      saved.vis = {}; saved.paint = {};
      for (const id of hideWhenKeyed) if (m.getLayer(id)) {
        saved.vis[id] = m.getLayoutProperty(id, 'visibility') || 'visible';
        m.setLayoutProperty(id, 'visibility', 'none');
      }
      for (const id of waterIds()) {
        saved.paint[id] = { 'fill-color': m.getPaintProperty(id, 'fill-color'), 'fill-opacity': m.getPaintProperty(id, 'fill-opacity') };
        m.setPaintProperty(id, 'fill-color', '#ff00ff'); m.setPaintProperty(id, 'fill-opacity', 1);
      }
      if (m.getLayer('ground-areas')) {
        const c = m.getPaintProperty('ground-areas', 'fill-color');
        saved.paint['ground-areas'] = { 'fill-color': c, 'fill-opacity': m.getPaintProperty('ground-areas', 'fill-opacity') };
        m.setPaintProperty('ground-areas', 'fill-color', ['case', ['in', ['get', 's'], ['literal', ['water', 'pond']]], '#ff00ff', c]);
        m.setPaintProperty('ground-areas', 'fill-opacity', 1);
      }
      if (m.getLayer('ground-channel')) {
        const c = m.getPaintProperty('ground-channel', 'fill-extrusion-color');
        saved.paint['ground-channel'] = { 'fill-extrusion-color': c };
        m.setPaintProperty('ground-channel', 'fill-extrusion-color', ['case', ['==', ['get', 'm'], 'water'], '#ff00ff', c]);
      }
    } else {
      for (const [id, v] of Object.entries(saved.vis || {})) m.setLayoutProperty(id, 'visibility', v);
      for (const [id, props] of Object.entries(saved.paint || {})) for (const [k, v] of Object.entries(props)) m.setPaintProperty(id, k, v);
    }
  }

  function nextFrame() {
    return new Promise(r => { m.once('render', () => setTimeout(r, 0)); m.triggerRepaint(); });
  }
  async function settle(ms) {
    await new Promise(r => setTimeout(r, ms));
    await new Promise(r => { if (m.loaded()) return r(); m.once('idle', r); setTimeout(r, 15000); });
    // screenshot twice, trust the second
    await nextFrame(); await new Promise(r => setTimeout(r, 120)); await nextFrame();
  }
  function lerpPose(a, b, t) {
    const L = (x, y) => x + (y - x) * t;
    let db = ((b.bearing - a.bearing + 540) % 360) - 180;
    return { center: [L(a.center[0], b.center[0]), L(a.center[1], b.center[1])], zoom: L(a.zoom, b.zoom),
             pitch: L(a.pitch, b.pitch), bearing: a.bearing + db * t };
  }

  const store = { masks: [], moving: [], stopped: [] };
  function score(A, B, masks, box) {
    // A-B-A flips and jumps over the sequence A (luma arrays) inside masks.
    const W = cv.width, H = cv.height, N = A.length;
    const [x0, y0, x1, y1] = box || [0, 0, W - 1, H - 1];
    let flips = 0, flipElig = 0, jumps = 0, jumpElig = 0, maskPx = 0;
    const heat = new Uint16Array(W * H);
    for (let i = 0; i < N; i++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (masks[i][y * W + x]) maskPx++;
    for (let i = 1; i < N; i++) {
      const a = A[i - 1], b = A[i], ka = masks[i - 1], kb = masks[i];
      const c = i + 1 < N ? A[i + 1] : null, kc = i + 1 < N ? masks[i + 1] : null;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const p = y * W + x;
        if (!(ka[p] && kb[p])) continue;
        const d1 = b[p] - a[p];
        jumpElig++; if (Math.abs(d1) >= JUMP) jumps++;
        if (c && kc[p]) {
          flipElig++;
          const d2 = c[p] - b[p];
          if (Math.abs(d1) >= AMP && Math.abs(d2) >= AMP && (d1 > 0) !== (d2 > 0)) { flips++; heat[p]++; }
        }
      }
    }
    return { flipPct: 100 * flips / Math.max(1, flipElig), jumpPct: 100 * jumps / Math.max(1, jumpElig),
             maskPxPerFrame: maskPx / N, flipElig, heat };
  }
  function stopgo(M, S, masks, box) {
    const W = cv.width, H = cv.height;
    const [x0, y0, x1, y1] = box || [0, 0, W - 1, H - 1];
    let n = 0, e = 0, sum = 0;
    for (let i = 0; i < M.length; i++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const p = y * W + x; if (!masks[i][p]) continue;
      e++; const d = Math.abs(M[i][p] - S[i][p]); sum += d; if (d >= JUMP) n++;
    }
    return { stopgoPct: 100 * n / Math.max(1, e), stopgoMean: sum / Math.max(1, e) };
  }
  function heatImage(heat, baseImg) {
    const img = new ImageData(new Uint8ClampedArray(baseImg.data), cv.width, cv.height);
    for (let p = 0, i = 0; p < heat.length; p++, i += 4) {
      if (heat[p]) { img.data[i] = 255; img.data[i + 1] = 0; img.data[i + 2] = 255; }
      else { img.data[i] >>= 1; img.data[i + 1] >>= 1; img.data[i + 2] >>= 1; }
    }
    cx.putImageData(img, 0, 0); return cv.toDataURL('image/jpeg', 0.8);
  }

  window.__wf = {
    key, settle, nextFrame, lerpPose, store, score, stopgo,
    async maskPass(tr) {
      store.masks = [];
      if (tr.mask === 'box') {
        // No keying: score every pixel inside tr.box (for crossings, where the
        // question is which surface wins, not whether the water is water).
        ensure();
        const W = cv.width, H = cv.height, [x0, y0, x1, y1] = tr.box, K = new Uint8Array(W * H);
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) K[y * W + x] = 1;
        for (let i = 0; i < tr.frames; i++) store.masks.push(K);
        return { maskPx: (x1 - x0 + 1) * (y1 - y0 + 1) };
      }
      key(true); await settle(1500);
      for (let i = 0; i < tr.frames; i++) {
        m.jumpTo(lerpPose(tr.a, tr.b, i / (tr.frames - 1)));
        await nextFrame(); await nextFrame();
        store.masks.push(keyMask(grabRGBA()));
      }
      key(false); await settle(1500);
      const px = store.masks.reduce((s, k) => s + k.reduce((a, v) => a + v, 0), 0) / tr.frames;
      return { maskPx: px };
    },
    async movingPass(tr, save) {
      store.moving = []; const jpgs = [];
      m.jumpTo(lerpPose(tr.a, tr.b, 0)); await settle(2500);
      for (let i = 0; i < tr.frames; i++) {
        m.jumpTo(lerpPose(tr.a, tr.b, i / (tr.frames - 1)));
        await nextFrame();
        const img = grabRGBA(); store.moving.push(luma(img));
        if (save) { cx.putImageData(img, 0, 0); jpgs.push(cv.toDataURL('image/jpeg', 0.8)); }
        if (i === Math.floor(tr.frames / 2)) store.midImg = img;
      }
      return jpgs;
    },
    async stoppedPass(tr, save) {
      store.stopped = []; const jpgs = [];
      for (let i = 0; i < tr.frames; i++) {
        m.jumpTo(lerpPose(tr.a, tr.b, i / (tr.frames - 1)));
        await settle(tr.stopMs ?? 900);
        const img = grabRGBA(); store.stopped.push(luma(img));
        if (save) { cx.putImageData(img, 0, 0); jpgs.push(cv.toDataURL('image/jpeg', 0.8)); }
      }
      return jpgs;
    },
    report(tr) {
      const box = tr.box || null;
      const mv = score(store.moving, null, store.masks, box);
      const st = store.stopped.length ? score(store.stopped, null, store.masks, box) : null;
      const sg = store.stopped.length ? stopgo(store.moving, store.stopped, store.masks, box) : null;
      const heat = heatImage(mv.heat, store.midImg);
      const heatS = st ? heatImage(st.heat, store.midImg) : null;
      delete mv.heat; if (st) delete st.heat;
      return { moving: mv, stopped: st, stopgo: sg, heat, heatS };
    },
  };
}, { AMP, JUMP, ERODE });

const writeJpg = (file, dataUrl) => fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
const arms = PLAN.arms && PLAN.arms.length ? PLAN.arms : [{ name: 'base' }];
const results = [];
let bad = 0;

for (const tr of PLAN.trajectories) {
  await page.evaluate((p) => { if (typeof p === 'number') window.applyTimeOfDay(window.__map, p, true); }, tr.p);
  const mk = await page.evaluate((tr) => window.__wf.maskPass(tr), tr);
  console.log(`\n== ${tr.name}  p=${tr.p}  frames=${tr.frames}  water px/frame (eroded)=${Math.round(mk.maskPx)}`);
  if (mk.maskPx < 500) { console.log('   NO WATER IN FRAME — trajectory is not measuring water'); bad++; continue; }
  for (let rep = 0; rep < REPS; rep++) {
    for (const arm of (tr.arms ? arms.filter(a => tr.arms.includes(a.name)) : arms)) {
      if (arm.on) await page.evaluate((js) => { const m = window.__map; return (0, eval)('(function(m){' + js + '})')(m); }, arm.on);
      await page.evaluate((p) => { if (typeof p === 'number') window.applyTimeOfDay(window.__map, p, true); }, tr.p);
      const mj = await page.evaluate(({ tr, save }) => window.__wf.movingPass(tr, save), { tr, save: SAVE });
      const sj = tr.stopped === false ? [] : await page.evaluate(({ tr, save }) => window.__wf.stoppedPass(tr, save), { tr, save: SAVE });
      const r = await page.evaluate((tr) => window.__wf.report(tr), tr);
      if (arm.off) await page.evaluate((js) => { const m = window.__map; return (0, eval)('(function(m){' + js + '})')(m); }, arm.off);
      const tag = `${tr.name}__${arm.name}${REPS > 1 ? '__r' + rep : ''}`;
      writeJpg(path.join(OUT, tag + '__heat-moving.jpg'), r.heat);
      if (r.heatS) writeJpg(path.join(OUT, tag + '__heat-stopped.jpg'), r.heatS);
      if (SAVE) {
        const d = path.join(OUT, tag); fs.mkdirSync(d, { recursive: true });
        mj.forEach((u, i) => writeJpg(path.join(d, `m${String(i).padStart(3, '0')}.jpg`), u));
        sj.forEach((u, i) => writeJpg(path.join(d, `s${String(i).padStart(3, '0')}.jpg`), u));
      }
      const row = { trajectory: tr.name, arm: arm.name, rep, p: tr.p, moving: r.moving, stopped: r.stopped, stopgo: r.stopgo };
      results.push(row);
      console.log(`   ${arm.name.padEnd(14)} MOVING flip ${r.moving.flipPct.toFixed(3).padStart(7)}%  jump ${r.moving.jumpPct.toFixed(3).padStart(7)}%` +
        (r.stopped ? `   STOPPED flip ${r.stopped.flipPct.toFixed(3).padStart(7)}%  jump ${r.stopped.jumpPct.toFixed(3).padStart(7)}%` : '') +
        (r.stopgo ? `   STOP-GO ${r.stopgo.stopgoPct.toFixed(3).padStart(7)}% (mean ${r.stopgo.stopgoMean.toFixed(2)})` : ''));
    }
  }
}
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ env, AMP, JUMP, ERODE, plan: PLAN, results }, null, 1));
console.log('\nwrote', path.join(OUT, 'results.json'));
browser.__done();
process.exit(bad && !results.length ? 2 : 0);
