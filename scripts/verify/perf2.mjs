/**
 * perf2.mjs — the four questions whose answers change what gets built.
 *
 * perf.mjs measured medians under 4x CPU throttling, which pins every result to
 * a multiple of the 16.7 ms vsync interval and exaggerates CPU work against GPU
 * work. This runs at full speed on a big viewport and counts DROPPED FRAMES,
 * which is what "super laggy" actually is — the desktop baseline already sits at
 * a 60 fps median while dropping frames at p95.
 *
 *   Q1  Does a render-scale lever exist (map.setPixelRatio)?
 *   Q2  What does antialias:true cost at 2560x1440?
 *   Q3  What does the OpenFreeMap basemap cost, unthrottled?
 *   Q4  How much of the sky canvas is empty (i.e. free to reclaim)?
 */
import { chromium } from 'playwright-core';
import { chromePath, BASE, launch } from './chrome.mjs';

const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: 2560, height: 1400 } });
page.on('pageerror', e => console.log('  [pageerror] ' + e.message));

await page.goto(`${BASE}/index.html?drift=0&intro=0`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
await page.waitForTimeout(6000);

/** Fly for `ms` and count how many 16.7 ms frame slots were missed. */
async function run(label, ms = 4000) {
  await page.keyboard.down('w');
  await page.waitForTimeout(600);
  const r = await page.evaluate(async (ms) => {
    const dts = [];
    const t0 = performance.now();
    await new Promise(res => {
      let last = null;
      const step = ts => {
        if (last !== null) dts.push(ts - last);
        last = ts;
        if (performance.now() - t0 > ms) return res();
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    const s = [...dts].sort((a, b) => a - b);
    const q = f => s[Math.min(s.length - 1, Math.floor(s.length * f))] || 0;
    // A frame that took longer than 1.5 vsync intervals dropped at least one.
    const dropped = dts.reduce((a, d) => a + Math.max(0, Math.round(d / 16.67) - 1), 0);
    const elapsed = dts.reduce((a, d) => a + d, 0);
    return {
      frames: dts.length, fps: 1000 * dts.length / elapsed,
      p50: q(0.5), p95: q(0.95), p99: q(0.99), max: s[s.length - 1] || 0,
      dropped, dropPct: 100 * dropped / (dropped + dts.length),
    };
  }, ms);
  await page.keyboard.up('w');
  await page.waitForTimeout(400);
  console.log(label.padEnd(30) +
    ' ' + r.fps.toFixed(1).padStart(5) + ' fps' +
    '  p50 ' + r.p50.toFixed(1).padStart(5) +
    '  p95 ' + r.p95.toFixed(1).padStart(6) +
    '  p99 ' + r.p99.toFixed(0).padStart(4) +
    '  max ' + r.max.toFixed(0).padStart(4) +
    '  dropped ' + r.dropped.toString().padStart(4) + ' (' + r.dropPct.toFixed(1) + '%)');
  return r;
}

// ── Q1 ────────────────────────────────────────────────────────────────
const api = await page.evaluate(() => {
  const m = window.__map;
  const names = ['setPixelRatio', 'getPixelRatio', 'setVerticalFieldOfView', 'setMaxPitch', 'setLight', 'setSky', 'setTerrain'];
  const out = {};
  for (const n of names) out[n] = typeof m[n];
  out._pixelRatio = m._pixelRatio;
  out.canvasBuffer = m.getCanvas().width + 'x' + m.getCanvas().height;
  out.cssSize = m.getCanvas().clientWidth + 'x' + m.getCanvas().clientHeight;
  out.dpr = window.devicePixelRatio;
  return out;
});
console.log('\n=== Q1  render-scale + camera API on MapLibre ' +
  await page.evaluate(() => maplibregl.getVersion ? maplibregl.getVersion() : 'unknown') + ' ===');
console.log(JSON.stringify(api, null, 2));

// ── Q4 ────────────────────────────────────────────────────────────────
const sky = await page.evaluate(() => {
  const c = document.getElementById('sky-canvas');
  if (!c) return null;
  const t = window.__map.transform;
  const hz = (t && t.horizonLineFromTop) ? t.horizonLineFromTop() : null;
  const H = window.__map.getCanvas().clientHeight;
  return { w: c.width, h: c.height, cssH: H, horizonPx: hz, pitch: window.__map.getPitch() };
});
console.log('\n=== Q4  sky canvas occupancy ===');
if (sky) {
  const used = (sky.horizonPx || 0) + 0.018 * sky.cssH;
  console.log(`  buffer ${sky.w}x${sky.h} = ${(sky.w * sky.h * 4 / 1048576).toFixed(1)} MB/frame`);
  console.log(`  horizon at y=${(sky.horizonPx || 0).toFixed(0)} of ${sky.cssH} css px (pitch ${sky.pitch.toFixed(0)})`);
  console.log(`  the clip in sky.js keeps only the top ${used.toFixed(0)} px => ` +
    `${(100 * used / sky.cssH).toFixed(1)}% used, ${(100 - 100 * used / sky.cssH).toFixed(1)}% is uploaded empty every frame`);
}

console.log('\n=== frame timing at 2560x1400, no CPU throttle ===');
const base = await run('baseline');

// ── Q3 ────────────────────────────────────────────────────────────────
await page.evaluate(() => {
  const m = window.__map; window.__hid = [];
  for (const l of m.getStyle().layers) {
    if (/^(buildings|parts|trees|landscape|signs)-/.test(l.id)) continue;
    if (m.getLayoutProperty(l.id, 'visibility') === 'none') continue;
    try { m.setLayoutProperty(l.id, 'visibility', 'none'); window.__hid.push(l.id); } catch (e) {}
  }
});
const nb = await run('minus basemap');
console.log('   dropped frames: ' + base.dropped + ' -> ' + nb.dropped +
            ',  fps ' + base.fps.toFixed(1) + ' -> ' + nb.fps.toFixed(1));

// Roads only — they were deliberately widened to 17-40 px, which is a lot of fill.
await page.evaluate(() => {
  const m = window.__map;
  for (const id of window.__hid) m.setLayoutProperty(id, 'visibility', 'visible');
});
await page.waitForTimeout(800);
const roadInfo = await page.evaluate(() => {
  const m = window.__map; const out = [];
  for (const l of m.getStyle().layers) {
    if (l.type !== 'line') continue;
    if (m.getLayoutProperty(l.id, 'visibility') === 'none') continue;
    out.push(l.id);
  }
  window.__roads = out;
  for (const id of out) m.setLayoutProperty(id, 'visibility', 'none');
  return out.length;
});
const nr = await run(`minus ${roadInfo} road lines`);
console.log('   dropped frames: ' + base.dropped + ' -> ' + nr.dropped);
await page.evaluate(() => { for (const id of window.__roads) window.__map.setLayoutProperty(id, 'visibility', 'visible'); });
await page.waitForTimeout(800);

// ── DOM overlay stack ─────────────────────────────────────────────────
await page.evaluate(() => {
  for (const id of ['sky', 'vignette']) {
    const e = document.getElementById(id); if (e) e.style.display = 'none';
  }
});
const no = await run('minus all DOM overlays');
console.log('   dropped frames: ' + base.dropped + ' -> ' + no.dropped);
await page.evaluate(() => {
  for (const id of ['sky', 'vignette']) {
    const e = document.getElementById(id); if (e) e.style.display = '';
  }
});
await page.waitForTimeout(800);

// ── Q2  antialias ─────────────────────────────────────────────────────
console.log('\n=== Q2  antialias:false (fresh page) ===');
await page.evaluate(() => { localStorage.setItem('__perfNoAA', '1'); });
await page.addInitScript(() => {
  const R = window.__origMapCtor;
  document.addEventListener('DOMContentLoaded', () => {});
});
// Patch the constructor before app.js runs.
const page2 = await browser.newPage({ viewport: { width: 2560, height: 1400 } });
await page2.addInitScript(() => {
  Object.defineProperty(window, 'maplibregl', {
    configurable: true,
    set(v) {
      const Real = v.Map;
      function Hooked(opts) {
        opts = opts || {};
        opts.canvasContextAttributes = Object.assign({}, opts.canvasContextAttributes, { antialias: false });
        const m = Reflect.construct(Real, [opts]);
        window.__map = m;
        return m;
      }
      Hooked.prototype = Real.prototype;
      Object.setPrototypeOf(Hooked, Real);
      v.Map = Hooked;
      Object.defineProperty(window, 'maplibregl', { value: v, configurable: true, writable: true });
    },
  });
});
await page2.goto(`${BASE}/index.html?drift=0&intro=0`, { waitUntil: 'networkidle', timeout: 60000 });
await page2.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
await page2.waitForTimeout(6000);
const aaOff = await (async () => {
  const saved = page;
  // reuse run() against page2 by swapping the binding
  const r = await (async function () {
    await page2.keyboard.down('w');
    await page2.waitForTimeout(600);
    const out = await page2.evaluate(async (ms) => {
      const dts = []; const t0 = performance.now();
      await new Promise(res => {
        let last = null;
        const step = ts => { if (last !== null) dts.push(ts - last); last = ts;
          if (performance.now() - t0 > ms) return res(); requestAnimationFrame(step); };
        requestAnimationFrame(step);
      });
      const s = [...dts].sort((a, b) => a - b);
      const q = f => s[Math.min(s.length - 1, Math.floor(s.length * f))] || 0;
      const dropped = dts.reduce((a, d) => a + Math.max(0, Math.round(d / 16.67) - 1), 0);
      const el = dts.reduce((a, d) => a + d, 0);
      return { fps: 1000 * dts.length / el, p50: q(0.5), p95: q(0.95), max: s[s.length - 1] || 0, dropped };
    }, 4000);
    await page2.keyboard.up('w');
    return out;
  })();
  console.log('antialias:false'.padEnd(30) + ' ' + r.fps.toFixed(1).padStart(5) + ' fps  p50 ' +
    r.p50.toFixed(1) + '  p95 ' + r.p95.toFixed(1) + '  max ' + r.max.toFixed(0) + '  dropped ' + r.dropped);
  return r;
})();
console.log('   dropped frames: AA on ' + base.dropped + ' -> AA off ' + aaOff.dropped);

await browser.__done();
