/**
 * shimmer.mjs — the windows crawl WHILE THE CAMERA MOVES. Measure that.
 *
 * Reported, with unusually good detail: "biomed building still SUPER glitchy.
 * it's glitchy whenever I move... sometimes the glitch is like a ton of diagonal
 * lines that go across the window that are lit and not lit... pressing wasd has
 * it glitch for 10-12 seconds before stopping but q and e only glitch for the
 * duration they're held". That last part is not a timer — WASD carries momentum
 * and Q/E does not, so both statements reduce to the same thing: it happens
 * exactly while the camera is moving, and stops when it stops.
 *
 * And the distance behaviour, which is the real fingerprint: on Biological
 * Laboratories' north face, far away almost the whole wall crawls; as the camera
 * closes the LEFT (nearer) side settles first and the right tenth holds out
 * longest. That is texture MINIFICATION talking. It is not a coincidence, and it
 * is not z-fighting, whose severity tracks depth precision rather than texel
 * density.
 *
 * WHY NOT zfight.mjs. That script looks for a pixel that goes A, B, A under a
 * monotonic camera step, and then gates every candidate on its 3x3 neighbourhood
 * in frame A being FLAT — deliberately, because a z-fight is a large flat surface
 * flickering and a one-pixel edge straddling two colours flips for ordinary
 * rasterisation reasons. That gate is correct for its job and it makes it
 * structurally blind to this one: a crawling window grid is the opposite of a
 * flat neighbourhood. Running it here and reading the null result as "clean"
 * would be the third wrong diagnosis on this defect.
 *
 * WHAT THIS MEASURES INSTEAD: temporal NON-MONOTONICITY. Step the camera in
 * equal increments along one axis and watch each pixel's luma across N frames.
 * Real geometry under a monotonic camera change moves monotonically — a surface
 * gets a little brighter, an edge creeps one pixel and then another. Aliasing
 * oscillates: the moire fringes sweep across the wall and a pixel goes
 * dark-light-dark-light with no relation to the direction of travel. So the
 * signal is the number of SIGN CHANGES in the temporal first difference, above
 * an amplitude floor, and the score is the share of wall pixels with two or more.
 *
 * The reduction happens in the page. Handing nine 1440x900 framebuffers back
 * through CDP is the twenty-minute, 2 GB mistake in this directory's README.
 *
 * Usage:
 *   node shimmer.mjs <shots.json> [outPrefix]
 *
 * Each shot: {name, center, zoom, pitch, bearing, p, mode?, box?}
 *   mode  'translate' (default, imitates WASD) | 'zoom' (imitates Q/E)
 *   box   [x0,y0,x1,y1] screen region to score; omit to score the whole frame
 *
 * Config knobs, as env vars, so the A/B is one variable at a time:
 *   SHIM_PATTERN=0   strip fill-extrusion-pattern and paint flat wall colour
 *   SHIM_SCALE=1     GFX.renderScale override
 *   SHIM_PRESET=...  apply a named graphics preset first
 */
import { chromium } from 'playwright-core';
import { BASE as SERVER, launch } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';

const SHOTS = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const OUT = process.argv[3] || 'shim';
const outDir = path.resolve('shots');
fs.mkdirSync(outDir, { recursive: true });

const CFG = {
  pattern: process.env.SHIM_PATTERN !== '0',
  scale: process.env.SHIM_SCALE ? Number(process.env.SHIM_SCALE) : null,
  preset: process.env.SHIM_PRESET || null,
  // MSAA cannot be toggled on a live WebGL context — app.js reads window.GFX_MSAA
  // at map CONSTRUCTION, so it has to be in localStorage before the page loads.
  // Only the `ultra` preset ships it on; performance/balanced/cinematic are all
  // msaa:false, and `performance` additionally renders at 0.75 and upscales.
  msaa: process.env.SHIM_MSAA === '1' ? true
      : process.env.SHIM_MSAA === '0' ? false : null,
  bootPreset: process.env.SHIM_BOOTPRESET || null,
  soften: process.env.SHIM_SOFTEN != null ? Number(process.env.SHIM_SOFTEN) : null,
  softenR: process.env.SHIM_SOFTEN_R != null ? Number(process.env.SHIM_SOFTEN_R) : 3,
  // Which SOFTEN-shaped registries the override touches. Default is both, for
  // a whole-city A/B. 'drag' alone isolates js/drag.js's own effect without
  // also perturbing facades.js's ALREADY-SHIPPED r3 default up or down —
  // sweeping a uniform override at r<3 across BOTH registries silently
  // regresses facades.js's own calibration for the low end of the sweep,
  // which would confound "did drag.js's fix work" with "did facades.js's
  // shipped fix get temporarily undone." QUEUE F2's own sweep hit this.
  softenTarget: (process.env.SHIM_SOFTEN_TARGET || 'facade,drag').split(','),
};

// Frames per sweep, and how far the camera travels IN TOTAL across them.
// Small on purpose: the whole point is a step that barely moves the geometry but
// does move the texture sample positions. 3 m over 8 steps at z17 is roughly
// one screen pixel per frame.
const FRAMES = 9;
const TRAVEL_M = 3.0;
const TRAVEL_ZOOM = 0.10;

const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('PAGEERR', e.message));

// Anything the map reads at CONSTRUCTION has to be in localStorage before the
// document loads — msaa and the boot preset both are. addInitScript runs in the
// PAGE, so the config is passed as an argument, not closed over: getting that
// wrong installs nothing and every arm of the A/B silently runs identically
// while the report prints different labels (README, timing traps).
await page.addInitScript((cfg) => {
  try {
    const KEY = 'austin3d.gfx.v1';
    const cur = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (cfg.bootPreset) cur.preset = cfg.bootPreset;
    if (cfg.msaa != null) cur.msaa = cfg.msaa;
    if (cfg.scale != null) cur.renderScale = cfg.scale;
    // autoDetected stops the 11 s probe rewriting all of this mid-run.
    cur.autoDetected = true;
    localStorage.setItem(KEY, JSON.stringify(cur));
  } catch (e) {}
}, CFG);

// _harness.html forces preserveDrawingBuffer, which is the only way drawImage of
// the map canvas returns anything but black.
await page.goto(SERVER + '/_harness.html?intro=0&drift=0', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
await page.waitForFunction(() => {
  const m = window.__map;
  if (!m || !m.getSource('austin-buildings')) return false;
  return ['austin-buildings', 'austin-roofscape', 'austin-tower', 'austin-drag']
    .every(s => !m.getSource(s) || m.isSourceLoaded(s));
}, null, { timeout: 90000 }).catch(() => console.log('WARN: sources not all loaded'));
await page.waitForTimeout(6000);
// 11 s after load the auto-detect probe rewrites every setting, which would land
// mid-sweep and read as the lever under test.
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

const applied = await page.evaluate((cfg) => {
  const m = window.__map;
  const out = {};
  if (cfg.preset && window.GFX_PRESETS && window.GFX_PRESETS[cfg.preset]) {
    Object.assign(window.GFX, window.GFX_PRESETS[cfg.preset]);
  }
  if (cfg.scale != null && window.GFX) window.GFX.renderScale = cfg.scale;
  if ((cfg.preset || cfg.scale != null) && window.applyGraphics) window.applyGraphics();
  out.renderScale = window.GFX && window.GFX.renderScale;
  out.msaa = window.GFX && window.GFX.msaa;
  out.preset = window.GFX && window.GFX.preset;
  // Echo what the CONTEXT actually got, not what the settings object says it
  // wanted. Requesting antialias is a hint; the driver may refuse. A whole A/B
  // once ran four identical configurations while printing four labels.
  try {
    const gl = m.getCanvas().getContext('webgl2') || m.getCanvas().getContext('webgl');
    const a = gl && gl.getContextAttributes && gl.getContextAttributes();
    out.ctxAntialias = a ? a.antialias : 'unknown';
    out.samples = gl ? gl.getParameter(gl.SAMPLES) : 'unknown';
    out.depthBits = gl ? gl.getParameter(gl.DEPTH_BITS) : 'unknown';
    out.canvasPx = m.getCanvas().width + 'x' + m.getCanvas().height;
  } catch (e) { out.ctxErr = String(e.message || e); }

  // Strip the pattern and fall back to the baked flat wall colour. This is the
  // whole A/B: if the crawl collapses without the pattern, the defect is texture
  // sampling and no amount of geometry work will touch it.
  // Sweep the low-pass strength. The point of an EXTREME arm is to find out
  // whether blur is the right lever at all: if radius 6 / amount 1.0 does not
  // approach the pattern-off floor, then sharpness is not what is crawling and
  // no amount of softening will fix it.
  if (cfg.soften != null) {
    const p0 = window.__todCurrentP != null ? window.__todCurrentP : 0.25;
    // Every atlas that carries a SOFTEN-shaped config (RADIUS/AMOUNT keyed by
    // family) and a repaint function gets the SAME override — this is what
    // lets ONE env-var sweep move facades.js AND js/drag.js in one run.
    // js/drag.js is the QUEUE F2 addition (docs/facade-atlas-map.md §2's
    // six-file table); more entries here are how the next file in that list
    // joins the same sweep without a new script.
    const targets = [
      { key: 'facade', S: window.FACADE_SOFTEN, repaint: () => window.updateFacades && window.updateFacades(m, p0) },
      { key: 'drag', S: window.DRAG_SOFTEN, repaint: () => window.applyDragColors && window.applyDragColors(m, p0) },
      // js/places.js (QUEUE F2 front 2): one image (GLASS_IMG/'pl-glass'), so
      // this registry has a single family key (plGlass) rather than a table,
      // but it is the same SOFTEN shape and the loop below needs no special
      // case for that. NOTE: js/westcampus.js is deliberately NOT a target
      // here — its wall layer (`wc-wall`) reads window.FACADE_PATTERN_EXPR
      // directly and every wall feature is registered into facades.js's own
      // `combos`/SOFTEN registry via quantiseStadiumFacades (confirmed by
      // reading js/westcampus.js:1025 and js/facades.js:1047 — see the
      // acer/f2-wcplaces commit message) — the 'facade' target above already
      // reaches it, and a second entry here would double-apply the same
      // override to the same pixels.
      { key: 'places', S: window.PLACES_SOFTEN, repaint: () => window.applyPlacesColors && window.applyPlacesColors(m, p0) },
    ];
    const hit = [];
    for (const t of targets) {
      if (!t.S || !cfg.softenTarget.includes(t.key)) continue;
      for (const f of Object.keys(t.S.RADIUS)) t.S.RADIUS[f] = cfg.softenR;
      for (const f of Object.keys(t.S.AMOUNT)) t.S.AMOUNT[f] = cfg.soften;
      // The atlas is generated once at init, so it has to be redrawn in place.
      t.repaint();
      hit.push(t.key);
    }
    out.softenApplied = { r: cfg.softenR, a: cfg.soften, hit };
  }

  if (!cfg.pattern) {
    // 'places-solid' was here already and is the WRONG layer for this control
    // — it is places.js's flat-colour tier (L_SOLID), which never carried a
    // pattern to strip. 'places-glass' (L_GLASS) is the one that does
    // (GLASS_IMG) and was missing entirely, so SHIM_PATTERN=0 silently left
    // every shopfront's glazing pattern ON while claiming to be the
    // pattern-off floor. Left 'places-solid' in place (harmless no-op: it has
    // no 'fill-extrusion-pattern' paint property to clear) rather than remove
    // it, so nothing else that already depends on this exact array shrinks.
    for (const id of ['buildings-3d', 'parts-3d', 'wc-wall', 'drag-wall', 'moody-wall',
                      'arts-panel', 'places-solid', 'places-glass', 'tower-wall', 'stadium-wall']) {
      if (!m.getLayer(id)) continue;
      try {
        m.setPaintProperty(id, 'fill-extrusion-pattern', null);
        m.setPaintProperty(id, 'fill-extrusion-color', ['to-color', ['get', 'wd'], '#b9ac93']);
      } catch (e) { out['err_' + id] = String(e.message || e); }
    }
  }
  return out;
}, CFG);
console.log('CONFIG', JSON.stringify({ ...CFG, ...applied }));

await page.evaluate(() => {
  window.__shim = (function () {
    let cv = null, cx = null;
    const luma = [];
    function grab(i) {
      const gl = window.__map.getCanvas();
      if (!cv) {
        cv = document.createElement('canvas');
        cv.width = gl.width; cv.height = gl.height;
        cx = cv.getContext('2d', { willReadFrequently: true });
      }
      cx.drawImage(gl, 0, 0);
      const d = cx.getImageData(0, 0, cv.width, cv.height).data;
      const n = cv.width * cv.height;
      const L = new Float32Array(n);
      for (let p = 0, j = 0; p < n; p++, j += 4) {
        L[p] = (d[j] * 299 + d[j + 1] * 587 + d[j + 2] * 114) / 1000;
      }
      luma[i] = L;
      if (i === 0) window.__shimFrame0 = cx.getImageData(0, 0, cv.width, cv.height);
    }
    /**
     * amp    a first difference smaller than this is noise, not a flip
     * minFlips  how many sign changes make a pixel "crawling"
     * box    [x0,y0,x1,y1] or null for the whole frame
     */
    function scan(amp, minFlips, box) {
      const W = cv.width, H = cv.height, F = luma.length;
      const [x0, y0, x1, y1] = box || [0, 0, W - 1, H - 1];
      const flag = new Uint8Array(W * H);
      let inBox = 0, crawling = 0, movedAtAll = 0, totalFlips = 0;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const p = y * W + x;
          inBox++;
          let flips = 0, prevSign = 0, maxSwing = 0, lo = 1e9, hi = -1e9;
          for (let f = 1; f < F; f++) {
            const d = luma[f][p] - luma[f - 1][p];
            if (luma[f][p] < lo) lo = luma[f][p];
            if (luma[f][p] > hi) hi = luma[f][p];
            if (Math.abs(d) < amp) continue;
            const s = d > 0 ? 1 : -1;
            if (prevSign !== 0 && s !== prevSign) { flips++; maxSwing = Math.max(maxSwing, Math.abs(d)); }
            prevSign = s;
          }
          if (hi - lo >= amp) movedAtAll++;
          totalFlips += flips;
          if (flips >= minFlips) { flag[p] = 1; crawling++; }
        }
      }
      // Cluster so the answer is "this wall" rather than 30,000 loose pixels.
      const seen = new Uint8Array(W * H), out = [], stack = [];
      for (let p0 = 0; p0 < W * H; p0++) {
        if (!flag[p0] || seen[p0]) continue;
        stack.length = 0; stack.push(p0); seen[p0] = 1;
        let cnt = 0, ax0 = 1e9, ay0 = 1e9, ax1 = -1, ay1 = -1;
        while (stack.length) {
          const p = stack.pop(); cnt++;
          const x = p % W, y = (p / W) | 0;
          if (x < ax0) ax0 = x; if (x > ax1) ax1 = x;
          if (y < ay0) ay0 = y; if (y > ay1) ay1 = y;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            const q = ny * W + nx;
            if (flag[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
          }
        }
        if (cnt >= 400) out.push({ n: cnt, box: [ax0, ay0, ax1, ay1] });
      }
      out.sort((u, v) => v.n - u.n);
      // Paint the mask over frame 0 so a human can look at it rather than
      // believe a percentage.
      const img = window.__shimFrame0;
      for (let p = 0, i = 0; p < W * H; p++, i += 4) {
        if (flag[p]) { img.data[i] = 255; img.data[i + 1] = 0; img.data[i + 2] = 255; }
        else { img.data[i] >>= 2; img.data[i + 1] >>= 2; img.data[i + 2] >>= 2; }
      }
      cx.putImageData(img, 0, 0);
      return {
        inBox, crawling,
        crawlPct: (crawling / inBox) * 100,
        movedPct: (movedAtAll / inBox) * 100,
        flipsPerPixel: totalFlips / inBox,
        clusters: out.slice(0, 8),
        mask: cv.toDataURL('image/png'),
      };
    }
    return { grab, scan };
  })();
});

async function settle(ms) {
  await page.waitForTimeout(ms);
  await page.evaluate(() => new Promise(r => {
    const m = window.__map; if (m.loaded()) return r(); m.once('idle', r); setTimeout(r, 12000);
  }));
  await page.evaluate(() => window.__map.triggerRepaint());
  await page.waitForTimeout(350);
}

const rows = [];
for (const s of SHOTS) {
  const mode = s.mode || 'translate';
  // Place the camera and let everything land BEFORE the sweep starts, so the
  // first frame is not still tiling. A scan of a half-loaded scene is not a scan.
  await page.evaluate((s) => {
    const m = window.__map;
    if (m.isEasing && m.isEasing()) m.stop();
    m.jumpTo({ center: s.center, zoom: s.zoom, pitch: s.pitch, bearing: s.bearing });
    if (typeof s.p === 'number') window.applyTimeOfDay(m, s.p, true);
    // Optional: {"hideLayers": ["buildings-3d"]} isolates one layer's own
    // contribution to a pose's crawl% by hiding everything else that could
    // also be painting pattern pixels in the same box — e.g. confirming
    // js/westcampus.js's wc-wall crawl is really coming from wc-wall and not
    // from a core buildings-3d facade standing behind/beside it in frame.
    // One-way (not restored): each shot in a list gets a fresh jumpTo, but
    // layer visibility is style state, not camera state, so a later shot in
    // the SAME list that needs the layer back must say so with its own
    // (possibly empty) hideLayers, not rely on a prior shot's absence of one.
    if (Array.isArray(s.hideLayers)) {
      for (const id of s.hideLayers) {
        try { if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', 'none'); } catch (e) {}
      }
    }
  }, s);
  await settle(4500);

  for (let f = 0; f < FRAMES; f++) {
    await page.evaluate(({ s, f, mode, FRAMES, TRAVEL_M, TRAVEL_ZOOM }) => {
      const m = window.__map;
      const t = f / (FRAMES - 1);
      if (mode === 'zoom') {
        m.jumpTo({ center: s.center, zoom: s.zoom + TRAVEL_ZOOM * t,
                   pitch: s.pitch, bearing: s.bearing });
      } else {
        // Translate ALONG the camera's own bearing — the WASD case. Metres to
        // degrees at Austin's latitude.
        const d = TRAVEL_M * t;
        const rad = s.bearing * Math.PI / 180;
        const dLat = (d * Math.cos(rad)) / 111320;
        const dLng = (d * Math.sin(rad)) / (111320 * Math.cos(s.center[1] * Math.PI / 180));
        m.jumpTo({ center: [s.center[0] + dLng, s.center[1] + dLat], zoom: s.zoom,
                   pitch: s.pitch, bearing: s.bearing });
      }
      m.triggerRepaint();
    }, { s, f, mode, FRAMES, TRAVEL_M, TRAVEL_ZOOM });
    // No idle wait inside the sweep: this is a jump of a few metres with every
    // tile already resident, and waiting on `idle` here would let the facade
    // atlas repaint between frames and pollute the very signal being measured.
    await page.waitForTimeout(450);
    await page.evaluate((f) => window.__shim.grab(f), f);
  }

  const r = await page.evaluate(({ box }) => window.__shim.scan(4, 2, box || null), { box: s.box });
  const file = path.join(outDir, `${OUT}-${s.name}.png`);
  fs.writeFileSync(file, Buffer.from(r.mask.split(',')[1], 'base64'));
  rows.push({ name: s.name, mode, ...r });
  console.log(
    `${s.name.padEnd(22)} mode=${mode.padEnd(9)} crawling ${r.crawlPct.toFixed(2).padStart(6)}%  ` +
    `moved ${r.movedPct.toFixed(1).padStart(5)}%  flips/px ${r.flipsPerPixel.toFixed(3)}  -> ${path.basename(file)}`);
  for (const c of r.clusters.slice(0, 3)) {
    console.log(`    cluster ${String(c.n).padStart(7)} px  box ${c.box.join(',')}`);
  }
}

// A run where nothing moved measures nothing. Say so rather than reporting 0%.
const dead = rows.filter(r => r.movedPct < 5);
if (dead.length) {
  console.log('\nWARNING: the camera barely changed the frame in these — the result is vacuous:');
  for (const r of dead) console.log(`  ${r.name}  moved ${r.movedPct.toFixed(1)}%`);
}
console.log('\nSUMMARY ' + JSON.stringify(rows.map(r => ({
  name: r.name, crawlPct: +r.crawlPct.toFixed(2), movedPct: +r.movedPct.toFixed(1),
}))));

await browser.__done();
