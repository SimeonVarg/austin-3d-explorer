/**
 * perf.mjs — where does the frame time actually go?
 *
 * Two hard-won rules are baked into this script.
 *
 * 1. RUN ON A REAL GPU. The rest of the suite launches headless with
 *    `--use-angle=swiftshader`, which is correct for pixel assertions and
 *    useless for timing: software rasterisation shifts the entire cost profile
 *    onto fill-rate, so a full-screen blended overlay looks catastrophic and a
 *    texture upload looks free. This one launches HEADED so Chrome uses the
 *    machine's actual GPU.
 * 2. DON'T LOAD _harness.html. Its rAF shim replaces requestAnimationFrame with
 *    setTimeout(16), which pins the loop at ~60 Hz no matter how slow a frame
 *    really is — you would measure the shim, not the app.
 *
 * Reports per-configuration median/p95 frame time by toggling one subsystem at a
 * time, plus the JS self-time of the two per-frame overlays.
 */
import { chromium } from 'playwright-core';
import { chromePath, BASE, launch, HW_ARGS } from './chrome.mjs';

const FRAMES = 150;
const BUDGET_MS = Number(process.env.PERF_BUDGET_MS || 9000);

/**
 * RULE 1 OF THIS FILE'S OWN DOCBLOCK WAS INVERTED IN ITS OWN FIRST LINE OF CODE,
 * and chrome.mjs already had the autopsy written into it: "17 of the 21 *-perf
 * scripts were in exactly that state, INCLUDING perf.mjs, whose own header opens
 * '1. RUN ON A REAL GPU' and then calls `launch(chromium)` bare."
 *
 * `launch(chromium)` with no options takes `headless: true` and
 * `glArgsFor(null)`, which resolves to SwiftShader. So every frame time this
 * script has ever printed described a CPU rasteriser's fill rate — the exact
 * failure its own header warns about, where a full-screen blended overlay looks
 * catastrophic and a texture upload looks free.
 *
 * Fixed by ASKING for what the header describes, and then PROVING it below by
 * printing UNMASKED_RENDERER_WEBGL next to the numbers. A perf script that does
 * not name its renderer cannot be checked, and this one went unchecked.
 *
 * The anti-throttling flags come from the outer-perf.mjs incident (README):
 * Chrome throttles rAF in a window it believes occluded, which quantises every
 * reading to 20 Hz and makes two configurations read identically.
 */
const HEADED = process.env.PERF_HEADED !== '0';
const browser = await launch(chromium, HEADED ? {
  headless: false,
  gl: 'hardware',
  args: [
    ...HW_ARGS,
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    '--disable-features=CalculateNativeWinOcclusion',
  ],
} : {});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e => console.log('  [pageerror] ' + e.message));

// `drift=0` because js/app.js starts an idle attract loop after 25 s of input
// silence and flies the camera itself. This script presses W often enough to
// keep re-arming that timer, so it has probably never tripped it — but "probably
// never" is not a property a measurement should depend on, and warmup.mjs was
// destroyed by exactly this (a fake 3x regression that was the app flying away).
await page.goto(`${BASE}/index.html?intro=0&drift=0`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
if (HEADED) await page.bringToFront();

/**
 * CANCEL THE GRAPHICS AUTO-DETECT PROBE. It fires ~11 s after load and rewrites
 * every graphics setting. This script settled for 6 s and then measured for over
 * a minute, so the probe has always landed in the middle of the run and changed
 * the thing being measured partway through. README lists cancelling it as a
 * standing rule for every test; this file never obeyed it.
 */
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

const RENDERER = await page.evaluate(() => {
  try {
    const gl = window.__map.painter.context.gl;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      attrs: gl.getContextAttributes(),
    };
  } catch (e) { return { renderer: 'unknown: ' + e.message, attrs: null }; }
});
console.log('\nRENDERER  ' + RENDERER.renderer);
console.log('          antialias=' + (RENDERER.attrs && RENDERER.attrs.antialias) +
            '  headed=' + HEADED);
if (/swiftshader|software|llvmpipe/i.test(String(RENDERER.renderer))) {
  console.log('  !! SOFTWARE RASTERISER. These frame times are fill-rate on the CPU');
  console.log('     and say nothing about the GPU. Do not quote them as fps.');
}

/**
 * MEASURE A DRAWN CITY, NOT A LOADING ONE. This was a flat 6 s wait after
 * `isStyleLoaded`, and boot.mjs measures the last of our sources becoming usable
 * at ~8 s on localhost with no CPU throttle — longer with one. So the baseline
 * was taken while MapLibre was still tiling GeoJSON in the worker, and it showed:
 * the first run after this file was pointed at a real GPU reported med 468 ms
 * with a max of 19,903 ms. A 20-second frame is not a frame rate, it is a load.
 */
await page.waitForFunction(() => {
  const m = window.__map;
  const ids = Object.keys(m.getStyle().sources).filter(id => /^austin-/.test(id));
  return ids.length && ids.every(id => { try { return m.isSourceLoaded(id); } catch (e) { return false; } });
}, null, { timeout: 120000 })
  .catch(() => console.log('  WARN: city never fully loaded; frame times include tiling'));
await page.waitForTimeout(4000);

// Instrument the two overlays that run every frame so their JS self-time is
// separable from GPU/compositor cost.
await page.evaluate(() => {
  window.__prof = { sky: [], haze: [] };
  const wrap = (name, key) => {
    const orig = window[name];
    if (typeof orig !== 'function') return;
    window[name] = function () {
      const t = performance.now();
      const r = orig.apply(this, arguments);
      window.__prof[key].push(performance.now() - t);
      return r;
    };
  };
  wrap('updateSky', 'sky');
  window.__profReset = () => { window.__prof.sky = []; window.__prof.haze = []; };
});

/**
 * THE POSE EVERY CONFIGURATION IS MEASURED FROM.
 *
 * This script held `W` down for the whole run and NEVER PUT THE CAMERA BACK.
 * Ten configurations, ~10 s of flight each: by the basemap A/B the camera was
 * kilometres from where the baseline was taken, over completely different
 * geometry. So every "delta vs baseline" it has ever printed compared two
 * different views of the city and blamed the whole difference on the subsystem
 * being toggled. The 2026-08-04 run made it obvious — removing labels, roofs and
 * the vignette each read as costing 90 to 162 ms LESS than baseline, i.e. every
 * toggle appeared to make the app faster to leave switched on.
 *
 * README says it outright: "Hold nothing down. Flying with W makes every run
 * cover different buildings; that was a bigger noise source than any setting
 * being compared."
 */
let HOME = null;
async function goHome() {
  if (!HOME) return;
  await page.evaluate(p => {
    window.__map.jumpTo({ center: [p.lng, p.lat], zoom: p.zoom, bearing: p.bearing, pitch: p.pitch });
  }, HOME);
  await page.waitForTimeout(1200);   // let the viewport's tiles come back
}

/** Hold W and record `n` real animation frames, always from the same pose. */
async function measure(label) {
  await goHome();
  await page.evaluate(() => window.__profReset && window.__profReset());
  await page.keyboard.down('w');
  await page.waitForTimeout(700);                     // let speed ramp settle
  const out = await page.evaluate(async ({ n, budgetMs }) => {
    const dts = [];
    await new Promise(res => {
      let last = null;
      const t0 = performance.now();
      const step = ts => {
        if (last !== null) dts.push(ts - last);
        last = ts;
        // BOUND BY TIME AS WELL AS BY COUNT. A fixed 150-frame capture is fine
        // at 60 fps (2.5 s) and ruinous at 2 fps (75 s): with ten
        // configurations the run blew chrome.mjs's 300 s watchdog and printed
        // one line before dying. Whichever limit comes first wins, and `n` is
        // reported so a short sample is visible rather than implied.
        if (dts.length >= n || performance.now() - t0 > budgetMs) return res();
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
    const p95 = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length * 0.95)] : 0; };
    return {
      med: med(dts), p95: p95(dts), max: Math.max(...dts), n: dts.length,
      skyMed: med(window.__prof.sky), skyN: window.__prof.sky.length,
    };
  }, { n: FRAMES, budgetMs: BUDGET_MS });
  await page.keyboard.up('w');
  await page.waitForTimeout(400);
  const fps = 1000 / out.med;
  console.log(
    label.padEnd(34) +
    ' med ' + out.med.toFixed(1).padStart(6) + ' ms' +
    ' (' + fps.toFixed(0).padStart(3) + ' fps)' +
    '  p95 ' + out.p95.toFixed(1).padStart(6) +
    '  max ' + out.max.toFixed(0).padStart(5) +
    '  n=' + String(out.n).padStart(3) +
    '  updateSky ' + out.skyMed.toFixed(2) + 'ms x' + out.skyN
  );
  return out;
}

// A weak laptop GPU/CPU is the target, not this machine. Without throttling
// everything sits on the 16.7 ms vsync floor and every delta reads as 0.0 —
// which says "nothing costs anything", the exact wrong conclusion.
const THROTTLE = Number(process.env.CPU_THROTTLE || 4);
const cdp = await page.context().newCDPSession(page);
if (THROTTLE > 1) {
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  console.log(`\n(CPU throttled ${THROTTLE}x to emulate a weaker machine)`);
}

const T = {
  skyCanvas: `document.getElementById('sky-canvas').style.display=V`,
  skyAll:    `document.getElementById('sky').style.display=V`,
  vignette:  `document.getElementById('vignette').style.display=V`,
};

// Capture the home pose AFTER the controller has stopped driving — README: "a
// seeded test must wait for `!__fly.eye().driving` before placing the camera, or
// its jumpTo is overwritten on the next frame."
await page.waitForFunction(() => window.__fly && !window.__fly.eye().driving, null, { timeout: 60000 })
  .catch(() => console.log('  WARN: controller still driving; pose may drift'));
HOME = await page.evaluate(() => {
  const m = window.__map, c = m.getCenter();
  return { lng: c.lng, lat: c.lat, zoom: m.getZoom(), bearing: m.getBearing(), pitch: m.getPitch() };
});
console.log('HOME pose  ' + HOME.lng.toFixed(5) + ',' + HOME.lat.toFixed(5) +
            '  z' + HOME.zoom.toFixed(2) + '  bearing ' + HOME.bearing.toFixed(0) +
            '  pitch ' + HOME.pitch.toFixed(0));

console.log('\n=== baseline (everything on) ===');
const base = await measure('all on');

console.log('\n=== one subsystem removed at a time ===');
for (const [name, tmpl] of Object.entries(T)) {
  await page.evaluate(new Function('V', tmpl), 'none');
  const r = await measure('minus ' + name);
  console.log('   delta vs baseline: ' + (base.med - r.med).toFixed(1) + ' ms');
  await page.evaluate(new Function('V', tmpl), '');
  await page.waitForTimeout(300);
}

// Layer-level: what do our own fill-extrusion layers cost?
console.log('\n=== map layers ===');
const layerSets = {
  'buildings-roof + parts-roof': ['buildings-roof', 'parts-roof'],
  'labels': ['buildings-labels'],
  'trees': ['trees-trunk', 'trees-canopy'],
  'shadows': ['buildings-shadow'],
  'all our extrusions': ['buildings-3d', 'buildings-roof', 'parts-3d', 'parts-roof'],
};
for (const [name, ids] of Object.entries(layerSets)) {
  const n = await page.evaluate(ids => {
    let k = 0;
    for (const id of ids) if (window.__map.getLayer(id)) { window.__map.setLayoutProperty(id, 'visibility', 'none'); k++; }
    return k;
  }, ids);
  if (!n) { console.log('minus ' + name + ' — layer absent, skipped'); continue; }
  const r = await measure('minus ' + name);
  console.log('   delta vs baseline: ' + (base.med - r.med).toFixed(1) + ' ms');
  await page.evaluate(ids => {
    for (const id of ids) if (window.__map.getLayer(id)) window.__map.setLayoutProperty(id, 'visibility', 'visible');
  }, ids);
  await page.waitForTimeout(300);
}

// Basemap: how much is the OpenFreeMap Liberty style itself?
console.log('\n=== basemap ===');
const hidden = await page.evaluate(() => {
  const m = window.__map, ids = [];
  for (const l of m.getStyle().layers) {
    const ours = /^(buildings|parts|trees|landscape|signs)-/.test(l.id);
    if (ours) continue;
    if (m.getLayoutProperty(l.id, 'visibility') === 'none') continue;
    try { m.setLayoutProperty(l.id, 'visibility', 'none'); ids.push(l.id); } catch (e) {}
  }
  window.__hid = ids;
  return ids.length;
});
const rb = await measure(`minus basemap (${hidden} layers)`);
console.log('   delta vs baseline: ' + (base.med - rb.med).toFixed(1) + ' ms');

await page.evaluate(() => { for (const id of window.__hid) window.__map.setLayoutProperty(id, 'visibility', 'visible'); });
await page.waitForTimeout(500);

/**
 * THE DRIFT CHECK, and it is not optional. README: "the machine drifts upward
 * across a run, so whichever configuration always runs first gets the coolest
 * slot and wins by construction." Every configuration above is measured once, in
 * a fixed order, so the only defence is to measure the baseline AGAIN at the end
 * and see how far the machine moved underneath the run. If this second baseline
 * is far from the first, NO delta printed above is a result — it is drift, and
 * the run has to be repeated with the order reversed.
 */
console.log('\n=== baseline again, to size the drift ===');
const base2 = await measure('all on (repeat)');
const drift = base2.med - base.med;
console.log('   drift across the run: ' + drift.toFixed(1) + ' ms  ('
            + (base.med ? (100 * drift / base.med).toFixed(0) : '?') + '% of baseline)');
console.log('   Any delta above smaller than this is noise, not a measurement.');

// Canvas resolution — the map's own render scale.
console.log('\n=== device pixel ratio (render scale) ===');
const geom = await page.evaluate(() => ({
  dpr: window.devicePixelRatio,
  map: window.__map.getCanvas().width + 'x' + window.__map.getCanvas().height,
  sky: (() => { const c = document.getElementById('sky-canvas'); return c ? c.width + 'x' + c.height : 'none'; })(),
  css: window.__map.getCanvas().clientWidth + 'x' + window.__map.getCanvas().clientHeight,
}));
console.log('   devicePixelRatio ' + geom.dpr + '  css ' + geom.css +
            '  map buffer ' + geom.map + '  sky buffer ' + geom.sky);
// Bytes the sky canvas re-uploads to the GPU every single frame it is redrawn.
const [sw, sh] = geom.sky.split('x').map(Number);
if (sw) console.log('   sky canvas texture upload = ' +
  (sw * sh * 4 / 1048576).toFixed(1) + ' MB/frame  (' +
  (sw * sh * 4 * 60 / 1073741824).toFixed(2) + ' GB/s at 60 fps)');

await browser.__done();
