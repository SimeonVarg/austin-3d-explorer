/**
 * moire.mjs — how much of each frame is ALIAS, measured against a supersampled
 * truth of the same frame. One browser, the owner's screen, hardware GL.
 *
 * WHY THIS EXISTS. Owner, 2026-09-27: "main thing im noticing while flying is
 * the moire. its too noticeable." Moire is detail finer than a pixel (window
 * grids, mullions, storey courses, fins, paving, road markings) sampled once
 * per pixel: the missing frequencies fold back as wavy bands in a still frame
 * and crawl when the camera moves. Every earlier meter here scored a frame
 * against itself or its neighbour frame; neither knows what the frame SHOULD
 * look like. This one does.
 *
 * THE TRUTH. The same pose rendered again at SS times the pixel ratio (the
 * owner's 1.5 x SS) and box-filtered back down to his 1920 x 1020. A box of
 * SS x SS samples per pixel is an alias-free render to a very good
 * approximation for every feature larger than 1/SS of a pixel. The alias in
 * the normal frame is then the difference between the two:
 *
 *   alias  = mean |native - truth|              (all of it: jaggies included)
 *   moire  = mean |blur(native) - blur(truth)|  (what folds into LOW
 *            frequencies: the bands and the crawl. A gaussian of `blurPx`
 *            removes jaggies and single-pixel speckle, which do not read as
 *            moire at arm's length; a folded window grid survives it.)
 *
 * and, along a slow scripted flight (--flight), the TEMPORAL half:
 *
 *   shimmer = mean |native(t+1) - native(t)| - mean |truth(t+1) - truth(t)|
 *
 * the frame-to-frame change the truth does not have. Everything is written as
 * PNGs (native, truth, heat) for scripts/verify/moire-report.py to score by
 * region and crop.
 *
 * WHAT THE OWNER SEES. 1920x1080 at 150% scaling: a CSS viewport of about
 * 1280 x 680 at devicePixelRatio 1.5, Chrome on the NVIDIA GPU. That is the
 * default here. The renderer string is printed with every run; compare numbers
 * only within one renderer.
 *
 * Usage (serve the repo first: python scripts/serve.py <port>):
 *   VERIFY_URL=http://127.0.0.1:<port> node moire.mjs --out <dir> [options]
 *     --probe              print renderer, graphics, canvas and a layer inventory; no captures
 *     --poses a,b          named poses from POSES below (default: all)
 *     --ss <n>             supersample factor for the truth (default 3)
 *     --no-truth           native frames only
 *     --flight <name>      capture a scripted flight from FLIGHTS below instead of poses
 *     --frames <n>         frames of the flight (default: the flight's own)
 *     --screens            capture page screenshots (overlays included) instead of the map canvas
 *     --ref <git-ref>      serve js/*.js, *.html and *.css from <ref> (a BEFORE side
 *                          in the same machine state; data files are shared)
 *     --set k=v,...        runtime switches applied in the page before capturing:
 *                          any `window.<path>=<json>` (e.g. SLOPES.on=false)
 *     --p <0..1>           time of day (default: the app's own, sunset 0.50)
 *     --q k=v,...          extra URL query switches (e.g. namelabels=0)
 *     --eval <js>          a statement run in the page (map as `m`) before capturing,
 *                          for a one-off experiment (e.g. a paint property)
 *     --width/--height/--dpr   default 1280/680/1.5
 *     --own                also capture each system hidden in turn (authored, patterned,
 *                          extrusions, outer, trees, ground) for moire-report.py --own
 *     --gfx <json>         saved graphics settings before load, e.g. '{"msaa":true,"custom":true}'
 *     --hide-each <regex>  also capture each style layer whose id matches, hidden alone
 *                          (<pose>-hide-<id>.png): which ONE layer draws a defect
 *     --label <text>       document.title (BEFORE/AFTER) for a visible window
 *
 * Exit: 0 captured / 2 could not run.
 */
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const has = k => argv.includes(k);

const OUT = opt('--out', null);
if (!OUT && !has('--probe')) { console.error('usage: moire.mjs --out <dir> [--probe] [--poses a,b] [--ss 3] [--flight name] [--ref git-ref] [--set k=v]'); process.exit(2); }
if (OUT) fs.mkdirSync(OUT, { recursive: true });
const W = +opt('--width', '1280'), H = +opt('--height', '680'), DPR = +opt('--dpr', '1.5');
const SS = +opt('--ss', '3');
const TRUTH = !has('--no-truth');
const REF = opt('--ref', null);
const P = opt('--p', null);
const LABEL = opt('--label', null);
const EVAL = opt('--eval', null);
const QS = (opt('--q', '') || '').split(',').map(s => s.trim()).filter(Boolean);
const SETS = (opt('--set', '') || '').split(',').map(s => s.trim()).filter(Boolean);
const SCREENS = has('--screens');
const OWN = has('--own') ? ['authored', 'patterned', 'extrusions', 'outer', 'trees', 'ground'] : null;
const HIDE_EACH = opt('--hide-each', null);

// ── Poses: the app's own flyover cameras. center/zoom/pitch/bearing exactly as
// MapLibre takes them. `spawn` is js/app.js SPAWN; `intro-*` are INTRO.start /
// crest / end (the landing flight); the rest are the heights he flies at over
// campus, West Campus and downtown.
const POSES = {
  'spawn':        { center: [-97.7434, 30.2857], zoom: 16.5,  pitch: 74, bearing: 250 },
  'intro-start':  { center: [-97.7420, 30.2680], zoom: 16.2,  pitch: 78, bearing: 5 },
  'intro-crest':  { center: [-97.7404, 30.2748], zoom: 15.45, pitch: 71, bearing: 3 },
  'intro-end':    { center: [-97.7365, 30.2900], zoom: 16.45, pitch: 74, bearing: 202 },
  'west-campus':  { center: [-97.7445, 30.2880], zoom: 16.6,  pitch: 72, bearing: 300 },
  'downtown':     { center: [-97.7430, 30.2690], zoom: 16.4,  pitch: 70, bearing: 20 },
  'campus-low':   { center: [-97.7395, 30.2860], zoom: 17.2,  pitch: 72, bearing: 160 },
};

// ── Flights: slow and scripted, so the true image changes little per frame.
// `from`/`to` are poses; the camera is interpolated linearly in every field.
const FLIGHTS = {
  // a slow slide along the landing flight's last leg, into campus
  'intro-leg2': { from: { center: [-97.7392, 30.2830], zoom: 16.2, pitch: 73, bearing: 188 },
                  to:   { center: [-97.7372, 30.2885], zoom: 16.42, pitch: 74, bearing: 200 }, frames: 90 },
  // a slow orbit at the spawn height
  'spawn-orbit': { from: { ...POSES.spawn, bearing: 244 }, to: { ...POSES.spawn, bearing: 256 }, frames: 90 },
  // a slow pan over downtown
  'downtown-pan': { from: { center: [-97.7445, 30.2672], zoom: 16.3, pitch: 72, bearing: 25 },
                    to:   { center: [-97.7415, 30.2682], zoom: 16.3, pitch: 72, bearing: 25 }, frames: 90 },
  // the drift-probe micro step: the same as spawn-orbit but a tenth the arc, for shimmer only
  'spawn-micro': { from: { ...POSES.spawn, bearing: 249.4 }, to: { ...POSES.spawn, bearing: 250.6 }, frames: 24 },
  // the before/after reel: a glide north over downtown's towers toward campus,
  // the landing flight's opening (5 s at 30 fps)
  'reel': { from: { ...POSES['intro-start'] },
            to:   { center: [-97.7412, 30.2718], zoom: 16.0, pitch: 76, bearing: 8 }, frames: 150 },
};

const browser = await launch(chromium, { gl: 'hardware', maxMs: +(process.env.VERIFY_MAX_MS || 3600000) });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 300)); });

if (REF) {
  const cache = new Map();
  const want = p => /^\/(js\/[^?]+\.js|[^/?]+\.html|[^/?]+\.css)$/.test(p);
  await page.route(url => want(new URL(url).pathname), (route, req) => {
    const p = new URL(req.url()).pathname.slice(1);
    let body = cache.get(p);
    if (body === undefined) {
      try { body = execFileSync('git', ['show', `${REF}:${p}`], { cwd: REPO, maxBuffer: 64 << 20 }); } catch (e) { body = null; }
      cache.set(p, body);
    }
    if (body == null) return route.continue();
    const type = p.endsWith('.js') ? 'application/javascript' : p.endsWith('.css') ? 'text/css' : 'text/html';
    route.fulfill({ status: 200, contentType: type, body });
  });
}

const GFXSET = opt('--gfx', null);
await page.addInitScript((gfx) => {
  if (gfx) try {
    const KEY = 'austin3d.gfx.v1';
    const cur = Object.assign(JSON.parse(localStorage.getItem(KEY) || '{}'), { preset: 'balanced', rev: 3, autoDetected: true }, JSON.parse(gfx));
    localStorage.setItem(KEY, JSON.stringify(cur));
  } catch (e) {}
  const t = setInterval(() => { if (window.cancelGraphicsAutoDetect) { window.cancelGraphicsAutoDetect(); clearInterval(t); } }, 20);
}, GFXSET);
// name labels are drawn into the map canvas (js/name-labels.js); they are not
// facades, and at SS they are set at a different pixel size. Kept for --screens,
// which is what the owner sees.
const qs = ['intro=0', 'drift=0'].concat(SCREENS ? [] : ['namelabels=0']).concat(P != null ? ['p=' + P] : []).concat(QS).join('&');
await page.goto(`${BASE}/_harness.html?${qs}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => window.slopesApartments?.count.done && window.slopesApartments.count.buildings > 0 &&
  window.slopesApartments.readyToReveal(), null, { timeout: 300000, polling: 500 });
await page.waitForFunction(() => !window.__fly?.eye().driving, null, { timeout: 30000 }).catch(() => {});
await page.waitForFunction(({ w, h }) => !document.getElementById('veil') &&
  window.__map.getCanvas().width >= w && window.__map.getCanvas().height >= h, { w: Math.floor(W * DPR), h: Math.floor(H * DPR) }, { timeout: 120000, polling: 250 });
if (LABEL) await page.evaluate(t => { document.title = t; }, LABEL);

const info = await page.evaluate(({ sets, evalSrc }) => {
  window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect();
  const m = window.__map;
  // Hold exposure: auto-exposure meters each frame and would grade the truth
  // (a different pixel count, a different histogram) differently from native.
  if (window.GFX) { window.GFX.autoExposure = false; window.applyGraphics && window.applyGraphics(); }
  const applied = [];
  for (const s of sets) {
    const i = s.indexOf('='); if (i < 0) continue;
    const pathS = s.slice(0, i), val = JSON.parse(s.slice(i + 1));
    const parts = pathS.split('.'); let o = window;
    for (let k = 0; k < parts.length - 1; k++) o = o[parts[k]];
    o[parts[parts.length - 1]] = val; applied.push(pathS + '=' + JSON.stringify(val));
  }
  if (evalSrc) { new Function('m', evalSrc)(m); applied.push('eval'); }
  const gl = m.getCanvas().getContext('webgl2');
  const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
  const layers = m.getStyle().layers.map(l => {
    const vis = m.getLayoutProperty(l.id, 'visibility') !== 'none';
    const pat = l.paint && (l.paint['fill-extrusion-pattern'] || l.paint['fill-pattern'] || l.paint['line-pattern']);
    return { id: l.id, type: l.type, source: l.source || '', vis, pattern: !!pat,
      outline: l.type === 'fill' && m.getPaintProperty(l.id, 'fill-antialias') !== false };
  });
  return {
    renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown',
    antialias: gl ? gl.getContextAttributes().antialias : null,
    samples: gl ? gl.getParameter(gl.SAMPLES) : null,
    maxAniso: (() => { const e = gl && (gl.getExtension('EXT_texture_filter_anisotropic')); return e ? gl.getParameter(e.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : 0; })(),
    canvas: m.getCanvas().width + 'x' + m.getCanvas().height, pixelRatio: m.getPixelRatio(),
    maxCanvasSize: m._maxCanvasSize || null,
    gfx: window.GFX ? { preset: window.GFX.preset, renderScale: window.GFX.renderScale, msaa: window.GFX.msaa, autoExposure: window.GFX.autoExposure } : null,
    p: window.__todCurrentP,
    buildings: window.slopesApartments.count.buildings,
    applied, layers,
  };
}, { sets: SETS, evalSrc: EVAL });
console.log(`renderer: ${info.renderer}`);
console.log(`canvas ${info.canvas} @ pixelRatio ${info.pixelRatio}  antialias=${info.antialias} samples=${info.samples} maxAniso=${info.maxAniso}  maxCanvas=${JSON.stringify(info.maxCanvasSize)}`);
console.log(`gfx ${JSON.stringify(info.gfx)}  p=${info.p}  authored=${info.buildings}  set=${JSON.stringify(info.applied)}  q=${QS.join('&')}`);
console.log(`fill layers ${info.layers.filter(l => l.type === 'fill').length}, with MapLibre's outline pass on: ${info.layers.filter(l => l.outline).length}`);

if (has('--probe')) {
  const vis = info.layers.filter(l => l.vis);
  const byType = {};
  for (const l of vis) byType[l.type] = (byType[l.type] || 0) + 1;
  console.log('visible layers by type', JSON.stringify(byType));
  for (const l of vis) if (l.type !== 'symbol') console.log(`  ${l.type.padEnd(15)} ${l.pattern ? 'PATTERN ' : '        '} ${l.id}  [${l.source}]`);
  if (errors.length) console.log('page errors:', errors.slice(0, 10));
  await browser.close();
  process.exit(0);
}

// ── page helpers: settle, capture (native, or supersampled + box-filtered) ──
await page.evaluate(({ SS, DPR, SCREENS }) => {
  const m = window.__map;
  // the truth needs a canvas SS times the owner's; MapLibre clamps the pixel
  // ratio to maxCanvasSize (4096 by default), so raise the ceiling for the run
  if (m._maxCanvasSize) m._maxCanvasSize = [16384, 16384];
  // labels are not facades, and their collision placement differs between
  // pixel ratios: at SS they would be a difference that is not alias
  if (!SCREENS) for (const l of m.getStyle().layers) if (l.type === 'symbol') m.setLayoutProperty(l.id, 'visibility', 'none');
  const frames = n => new Promise(res => {
    let k = 0;
    const f = () => { if (++k >= n) { m.off('render', f); setTimeout(res, 0); } else m.triggerRepaint(); };
    m.on('render', f); m.triggerRepaint();
  });
  let cv = null, cx = null;
  function grab(ss) {
    const c = m.getCanvas();
    if (!cv || cv.width !== c.width || cv.height !== c.height) {
      cv = document.createElement('canvas'); cv.width = c.width; cv.height = c.height;
      cx = cv.getContext('2d', { willReadFrequently: true });
    }
    cx.drawImage(c, 0, 0);
    const src = cx.getImageData(0, 0, c.width, c.height).data;
    const w = Math.floor(c.width / ss), h = Math.floor(c.height / ss);
    const out = new Uint8ClampedArray(w * h * 4);
    if (ss === 1) out.set(src.subarray(0, out.length));
    else {
      const n = ss * ss, sw = c.width;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let r = 0, g = 0, b = 0;
        for (let j = 0; j < ss; j++) { let i = ((y * ss + j) * sw + x * ss) * 4; for (let k = 0; k < ss; k++, i += 4) { r += src[i]; g += src[i + 1]; b += src[i + 2]; } }
        const o = (y * w + x) * 4; out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
      }
    }
    const oc = document.createElement('canvas'); oc.width = w; oc.height = h;
    oc.getContext('2d').putImageData(new ImageData(out, w, h), 0, 0);
    return oc.toDataURL('image/png');
  }
  async function settle(maxMs) {
    const t0 = performance.now();
    await new Promise(r => { if (m.loaded() && m.areTilesLoaded()) r(); else m.once('idle', r); setTimeout(r, maxMs); });
    // the facade atlas and data-driven paint land a frame or more later
    await new Promise(r => setTimeout(r, 900));
    await frames(4);
    return performance.now() - t0;
  }
  async function setRatio(r) {
    if (Math.abs(m.getPixelRatio() - r) < 1e-3) return;
    m.setPixelRatio(r);
    await frames(3);
  }
  window.__moire = {
    jump(pose) { m.jumpTo(pose); },
    settle,
    async capture(truth) {
      await setRatio(DPR);
      await frames(2);
      const native = grab(1);
      let tr = null;
      if (truth) { await setRatio(DPR * SS); await frames(3); tr = grab(SS); await setRatio(DPR); }
      return { native, truth: tr, ratio: m.getPixelRatio() };
    },
    frames,
    // OWNERSHIP: which system draws each pixel. A group is hidden, the frame
    // re-rendered, and the pixels that change are that group's. The authored
    // (three.js) layer is hidden by skipping its draw, NOT by SLOPES.on, which
    // would also put the legacy prisms back under it.
    async hide(group, on) {
      const st = m.style, ids = st._order;
      const L = window.SLOPES && st._layers[window.SLOPES.layerId];
      const isGround = id => /^(ground-|capitol-ground)/.test(id);
      const pick = {
        authored: () => [],
        patterned: () => ids.filter(id => { const l = st._layers[id]; return l.type === 'fill-extrusion' && !isGround(id) && !/^outer-/.test(id) && l.paint.get && l.getPaintProperty && l.getPaintProperty('fill-extrusion-pattern'); }),
        extrusions: () => ids.filter(id => { const l = st._layers[id]; return l.type === 'fill-extrusion' && !isGround(id) && !/^(outer-|trees-)/.test(id) && !(l.getPaintProperty && l.getPaintProperty('fill-extrusion-pattern')); }),
        outer: () => ids.filter(id => /^outer-/.test(id)),
        trees: () => ids.filter(id => /^trees-/.test(id)),
        ground: () => ids.filter(id => { const l = st._layers[id]; return ['fill', 'line', 'background', 'circle', 'raster'].includes(l.type) || (l.type === 'fill-extrusion' && isGround(id)); }),
      }[group];
      if (!pick) throw new Error('unknown group ' + group);
      if (group === 'authored') {
        const impl = L && L.implementation;
        if (impl) { if (!on) { impl.__r = impl.render; impl.render = () => {}; } else if (impl.__r) { impl.render = impl.__r; delete impl.__r; } }
      } else {
        if (!window.__moireVis) window.__moireVis = {};
        for (const id of pick()) {
          if (!on) { window.__moireVis[id] = m.getLayoutProperty(id, 'visibility') || 'visible'; m.setLayoutProperty(id, 'visibility', 'none'); }
          else if (window.__moireVis[id]) { m.setLayoutProperty(id, 'visibility', window.__moireVis[id]); delete window.__moireVis[id]; }
        }
      }
      await frames(4);
    },
  };
}, { SS, DPR, SCREENS });

const save = (file, dataUrl) => fs.writeFileSync(path.join(OUT, file), Buffer.from(dataUrl.split(',')[1], 'base64'));
const lerp = (a, b, t) => a + (b - a) * t;
const poseAt = (f, t) => ({ center: [lerp(f.from.center[0], f.to.center[0], t), lerp(f.from.center[1], f.to.center[1], t)],
  zoom: lerp(f.from.zoom, f.to.zoom, t), pitch: lerp(f.from.pitch, f.to.pitch, t), bearing: lerp(f.from.bearing, f.to.bearing, t) });

const meta = { info: { ...info, layers: undefined }, ss: SS, w: W, h: H, dpr: DPR, ref: REF, sets: SETS, captures: [] };
const FL = opt('--flight', null);
if (FL) {
  const f = FLIGHTS[FL];
  if (!f) { console.error('unknown flight ' + FL); process.exit(2); }
  const n = +opt('--frames', String(f.frames));
  // prewarm: fly it once so every tile on the path is loaded before frame 0
  for (let k = 0; k <= 4; k++) { await page.evaluate(p => window.__moire.jump(p), poseAt(f, k / 4)); await page.evaluate(() => window.__moire.settle(20000)); }
  await page.evaluate(p => window.__moire.jump(p), poseAt(f, 0));
  await page.evaluate(() => window.__moire.settle(20000));
  for (let k = 0; k < n; k++) {
    const pose = poseAt(f, n > 1 ? k / (n - 1) : 0);
    await page.evaluate(p => window.__moire.jump(p), pose);
    let c;
    if (SCREENS) {
      await page.evaluate(() => window.__moire.frames(3));
      const buf = await page.screenshot({ type: 'png' });
      fs.writeFileSync(path.join(OUT, `f${String(k).padStart(4, '0')}.png`), buf);
      c = {};
    } else {
      c = await page.evaluate(t => window.__moire.capture(t), TRUTH);
      save(`f${String(k).padStart(4, '0')}-native.png`, c.native);
      if (c.truth) save(`f${String(k).padStart(4, '0')}-truth.png`, c.truth);
    }
    meta.captures.push({ k, pose });
    if (k % 10 === 0) console.log(`  frame ${k}/${n}`);
  }
} else {
  const names = (opt('--poses', '') || Object.keys(POSES).join(',')).split(',').map(s => s.trim()).filter(Boolean);
  for (const name of names) {
    const pose = POSES[name];
    if (!pose) { console.error('unknown pose ' + name); continue; }
    await page.evaluate(p => window.__moire.jump(p), pose);
    const ms = await page.evaluate(() => window.__moire.settle(25000));
    // screenshot twice, trust the second: a second settle after the first capture
    await page.evaluate(() => window.__moire.settle(4000));
    const c = await page.evaluate(t => window.__moire.capture(t), TRUTH);
    save(`${name}-native.png`, c.native);
    if (c.truth) save(`${name}-truth.png`, c.truth);
    if (OWN) for (const g of OWN) {
      await page.evaluate(g => window.__moire.hide(g, false), g);
      const o = await page.evaluate(() => window.__moire.capture(false));
      save(`${name}-own-${g}.png`, o.native);
      await page.evaluate(g => window.__moire.hide(g, true), g);
    }
    if (HIDE_EACH) {
      const ids = await page.evaluate(re => window.__map.style._order.filter(id => new RegExp(re).test(id) &&
        (window.__map.getLayoutProperty(id, 'visibility') || 'visible') !== 'none'), HIDE_EACH);
      for (const id of ids) {
        await page.evaluate(async id => { window.__map.setLayoutProperty(id, 'visibility', 'none'); await window.__moire.frames(4); }, id);
        const o = await page.evaluate(() => window.__moire.capture(false));
        save(`${name}-hide-${id.replace(/[^\w.-]+/g, '_')}.png`, o.native);
        await page.evaluate(async id => { window.__map.setLayoutProperty(id, 'visibility', 'visible'); await window.__moire.frames(4); }, id);
      }
      console.log(`  ${name}: hid ${ids.length} layers one at a time`);
    }
    meta.captures.push({ name, pose, settleMs: Math.round(ms) });
    console.log(`  ${name}: settled ${Math.round(ms)} ms`);
  }
}
meta.errors = errors.slice(0, 20);
fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta, null, 1));
if (errors.length) console.log('page errors:', errors.slice(0, 5));
await browser.close();
process.exit(0);
