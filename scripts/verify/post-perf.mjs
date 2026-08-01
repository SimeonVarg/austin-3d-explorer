/**
 * post-perf.mjs — does throttling the two per-frame WebGL readbacks help?
 *
 * The app does drawImage(mapCanvas) twice a frame: once to meter auto-exposure
 * (graphics.js aeMeter) and once to build the bloom source. drawImage FROM a
 * WebGL canvas forces a pipeline flush regardless of destination size, and
 * MapLibre only repaints while the camera moves — which is exactly why the app
 * felt smooth idle and stuttery in motion.
 *
 * Same discipline as every other perf script here: headed Chrome (swiftshader
 * measures the software rasteriser), no screenshots during timing, one scripted
 * sweep so both configs render identical content, configs INTERLEAVED, and the
 * MINIMUM of the reps reported — a mean measures the machine.
 */
import { chromium } from 'playwright-core';
import { chromePath, BASE as SERVER, launch } from './chrome.mjs';

const REPS = 3, MS = 3200;
// Isolate each candidate inside the post stack, not the stack as a whole.
const CONFIGS = {
  'balanced-full': {},
  'no-bloom':      { bloom: 0 },
  'no-autoexp':    { autoExposure: false },
  'no-grade':      { filmic: 0, contrast: 1, saturation: 1, vignette: 0, grain: 0 },
  'no-rays-flare': { godRays: 0, flare: 0, dof: 0 },
  'post-all-off':  { bloom: 0, autoExposure: false, filmic: 0, contrast: 1, saturation: 1,
                     vignette: 0, grain: 0, godRays: 0, flare: 0, dof: 0 },
};

const browser = await launch(chromium, { gl: 'hardware' });

async function run(over) {
  return page.evaluate(async ({ over, MS }) => {
    Object.assign(window.GFX, window.GFX_PRESETS.balanced, over);
    window.applyGraphics();
    const m = window.__map;
    m.jumpTo({ center: [-97.7420, 30.2860], zoom: 16.1, pitch: 68, bearing: 0 });
    await new Promise(r => setTimeout(r, 1400));
    const dts = []; let last = null, b = 0;
    const t0 = performance.now();
    await new Promise(res => {
      const step = ts => {
        if (last !== null) dts.push(ts - last);
        last = ts;
        // Move every frame: MapLibre only repaints on change, and the stall
        // being measured only happens on a repaint.
        m.jumpTo({ center: [-97.7420, 30.2860], zoom: 16.1, pitch: 68, bearing: (b += 1.2) % 360 });
        if (performance.now() - t0 < MS) return requestAnimationFrame(step);
        res();
      };
      requestAnimationFrame(step);
    });
    const dropped = dts.reduce((a, d) => a + Math.max(0, Math.round(d / 16.67) - 1), 0);
    const mean = dts.reduce((a, d) => a + d, 0) / dts.length;
    return { dropped, fps: Math.round(1000 / mean * 10) / 10 };
  }, { over, MS });
}

const res = {}; for (const k of Object.keys(CONFIGS)) res[k] = [];
for (let i = 0; i < REPS; i++) for (const [k, v] of Object.entries(CONFIGS)) res[k].push(await run(v));

console.log('config         dropped(min)  fps(best)   [all reps dropped]');
for (const k of Object.keys(CONFIGS)) {
  const d = Math.min(...res[k].map(r => r.dropped)), f = Math.max(...res[k].map(r => r.fps));
  console.log(k.padEnd(14), String(d).padStart(8), String(f).padStart(11), '   ', res[k].map(r => r.dropped).join(', '));
}
const dOld = Math.min(...res['every-frame'].map(r => r.dropped));
const dNew = Math.min(...res['throttled'].map(r => r.dropped));
const fOld = Math.max(...res['every-frame'].map(r => r.fps));
const fNew = Math.max(...res['throttled'].map(r => r.fps));
console.log(`\nthrottling the two readbacks: ${dOld - dNew} fewer dropped frames, ${(fNew - fOld).toFixed(1)} fps`);
await browser.__done();
