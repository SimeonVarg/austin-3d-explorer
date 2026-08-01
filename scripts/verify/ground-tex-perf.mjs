/**
 * ground-tex-perf.mjs — what do the roads and the ground textures cost?
 *
 * Same shape as ground-perf.mjs, and the same rules, all of which this repo
 * learned the hard way:
 *   - HEADED. swiftshader measures the software rasteriser, not the app.
 *   - index.html, never _harness.html, whose rAF shim pins the loop at 60 Hz.
 *   - a scripted bearing sweep, so every run renders identical content — flying
 *     with W was once a bigger noise source than the setting under test.
 *   - configurations INTERLEAVED (a,b,c,d,a,b,c,d…), never blocked.
 *   - report the MINIMUM of the reps. A mean measures the machine, and a
 *     mean-based run in this repo already produced one false regression.
 *   - count DROPPED frames. A median frame time sits on the vsync floor while
 *     half the frames are being dropped and every delta reads as exactly 0.
 *   - the occlusion/backgrounding flags, or Chrome throttles rAF to 20 Hz in a
 *     window it thinks is hidden and both configurations come back identical.
 *
 * Usage: node ground-tex-perf.mjs [reps]
 */
import { chromium } from 'playwright-core';
import { chromePath, BASE as SERVER, launch } from './chrome.mjs';

const REPS = parseInt(process.argv[2] || '3', 10);
const MS = 4200;

// `before` reproduces the state this branch started from: roads handed back to
// the basemap, no pattern layers, no per-feature jitter.
const CONFIGS = {
  before:  { roads: false, texture: false, jitter: false },
  roads:   { roads: true,  texture: false, jitter: false },
  noTex:   { roads: true,  texture: false, jitter: true  },
  after:   { roads: true,  texture: true,  jitter: true  },
};

const browser = await launch(chromium, { gl: 'hardware' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.bringToFront();
await page.goto(SERVER + '/index.html?intro=0&drift=0', { timeout: 120000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
await page.waitForTimeout(8000);
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

async function run(cfg) {
  await page.evaluate((c) => {
    const m = window.__map, G = window.GROUND;
    if (window.__saved === undefined) window.__saved = { j: G.jitter, pj: G.pathJitter };
    G.roads = c.roads;
    G.texture = c.texture;
    G.jitter = c.jitter ? window.__saved.j : 0;
    G.pathJitter = c.jitter ? window.__saved.pj : 0;
    window.applyGroundSettings(m);
    window.applyGroundColors(m, window.__todCurrentP != null ? window.__todCurrentP : 0.14);
    m.jumpTo({ center: [-97.7396, 30.2852], zoom: 17.0, pitch: 74, bearing: 0 });
  }, cfg);
  await page.waitForTimeout(1600);
  return await page.evaluate(async (ms) => {
    const m = window.__map;
    const dts = [];
    let last = performance.now(), t0 = last, b = 0;
    await new Promise(res => {
      const step = () => {
        const now = performance.now();
        dts.push(now - last); last = now;
        b += 0.9; m.jumpTo({ center: [-97.7396, 30.2852], zoom: 17.0, pitch: 74, bearing: b });
        if (now - t0 < ms) requestAnimationFrame(step); else res();
      };
      requestAnimationFrame(step);
    });
    const drop = dts.slice(3).reduce((a, d) => a + Math.max(0, Math.round(d / 16.67) - 1), 0);
    return { dropped: drop, frames: dts.length,
             fps: +(1000 * dts.length / (performance.now() - t0)).toFixed(1) };
  }, MS);
}

// Echo what we think we set, next to the result — four "different"
// configurations once ran identically while the report printed four numbers.
// Interleaving alone is not enough: the machine drifts UPWARD across a run
// (183 dropped in the first rep, 193 in the fourth), so whichever config always
// goes first in the rep gets the coolest slot and wins by construction. In one
// measured run that handed `before` its best number and every other config its
// worst. Counterbalance by reversing the order on alternate reps.
const results = {};
for (const k of Object.keys(CONFIGS)) results[k] = [];
for (let r = 0; r < REPS; r++) {
  const order = Object.entries(CONFIGS);
  if (r % 2) order.reverse();
  for (const [k, cfg] of order) {
    const out = await run(cfg);
    const echo = await page.evaluate(() => {
      const m = window.__map;
      const vis = id => { try { const l = m.getLayer(id); return l ? (m.getLayoutProperty(id, 'visibility') || 'visible') : 'absent'; } catch (e) { return 'err'; } };
      return { road: vis('ground-road'), tex: vis('ground-texture'),
               baseTex: vis('ground-base-texture'), jitter: window.GROUND.jitter };
    });
    results[k].push({ ...out, echo });
  }
}

// Plain concatenation, not printf. Node's console.log does not understand
// width specifiers like %8d — it leaves them as literal text and then shifts
// every remaining argument into the wrong slot, which produced one run of this
// table where the config echo appeared to say the roads layer was hidden in the
// configuration that had just turned it on.
const pad = (v, n) => String(v).padStart(n);
console.log('\nconfig    dropMIN   fpsBest   all reps            layers actually set');
for (const [k, arr] of Object.entries(results)) {
  const drops = arr.map(a => a.dropped);
  const e = arr[0].echo;
  console.log(k.padEnd(9) + pad(Math.min(...drops), 7) +
    pad(Math.max(...arr.map(a => a.fps)).toFixed(1), 10) + '   ' +
    ('[' + drops.join(', ') + ']').padEnd(20) +
    `road=${e.road} tex=${e.tex} baseTex=${e.baseTex} jitter=${e.jitter}`);
}
const min = k => Math.min(...results[k].map(a => a.dropped));
const spread = k => Math.max(...results[k].map(a => a.dropped)) - min(k);
console.log(`\ndelta vs before (dropped frames over ${MS} ms, MIN of ${REPS} reps):`);
for (const k of ['roads', 'noTex', 'after']) {
  console.log('  ' + k.padEnd(8) + pad((min(k) - min('before') >= 0 ? '+' : '') +
    (min(k) - min('before')), 5) + '    (within-config spread: before ' +
    spread('before') + ', ' + k + ' ' + spread(k) + ')');
}
console.log('\nIf a delta is smaller than the within-config spread there is no result.');
await browser.__done();
