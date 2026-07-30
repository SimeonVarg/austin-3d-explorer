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
import { chromePath, BASE } from './chrome.mjs';

const FRAMES = 150;

const browser = await chromium.launch({
  executablePath: chromePath(),
  headless: false,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e => console.log('  [pageerror] ' + e.message));

await page.goto(`${BASE}/index.html?intro=0`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
await page.waitForTimeout(6000);

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

/** Hold W and record `n` real animation frames. */
async function measure(label) {
  await page.evaluate(() => window.__profReset && window.__profReset());
  await page.keyboard.down('w');
  await page.waitForTimeout(700);                     // let speed ramp settle
  const out = await page.evaluate(async (n) => {
    const dts = [];
    await new Promise(res => {
      let last = null;
      const step = ts => {
        if (last !== null) dts.push(ts - last);
        last = ts;
        if (dts.length >= n) return res();
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
    const p95 = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length * 0.95)] : 0; };
    return {
      med: med(dts), p95: p95(dts), max: Math.max(...dts),
      skyMed: med(window.__prof.sky), skyN: window.__prof.sky.length,
    };
  }, FRAMES);
  await page.keyboard.up('w');
  await page.waitForTimeout(400);
  const fps = 1000 / out.med;
  console.log(
    label.padEnd(34) +
    ' med ' + out.med.toFixed(1).padStart(5) + ' ms' +
    ' (' + fps.toFixed(0).padStart(3) + ' fps)' +
    '  p95 ' + out.p95.toFixed(1).padStart(5) +
    '  max ' + out.max.toFixed(0).padStart(4) +
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
  haze:      `document.getElementById('haze').style.display=V`,
  vignette:  `document.getElementById('vignette').style.display=V`,
};

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

// Canvas resolution — the map's own render scale.
console.log('\n=== device pixel ratio (render scale) ===');
await page.evaluate(() => { for (const id of window.__hid) window.__map.setLayoutProperty(id, 'visibility', 'visible'); });
await page.waitForTimeout(500);
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

await browser.close();
