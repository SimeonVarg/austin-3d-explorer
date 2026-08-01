/**
 * roofscape-perf.mjs — what does the roofscape cost, and does the knob work?
 *
 * Roof clutter is a per-building cost multiplied by ~1,700 buildings, on an app
 * that has ALREADY auto-detected ~30 fps and dropped itself into the
 * `performance` preset. This pass is the one most likely to destroy the frame
 * rate, so it does not get to claim a cost it has not measured (HANDOFF §8).
 *
 * Same methodology as roof-perf.mjs and ground-perf.mjs, and for the same
 * reasons: HEADED (a software rasteriser measures the rasteriser), index.html
 * not _harness.html (whose rAF shim pins the loop at 60 Hz no matter how slow a
 * frame really is), no screenshots during timing, a scripted bearing sweep so
 * every run renders identical content, interleaved configurations, and the
 * MINIMUM of the reps — a mean measures the machine.
 *
 * Dropped frames, not median frame time. The median sits on the 16.7 ms vsync
 * floor even while half the frames are being missed, and every subsystem delta
 * then reads as exactly 0.0 ms.
 *
 * Usage: node roofscape-perf.mjs [--zoom 16.4] [--reps 4]
 */
import { chromium } from 'playwright-core';
import { chromePath, BASE as SERVER, launch } from './chrome.mjs';
import path from 'node:path';

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? parseFloat(process.argv[i + 1]) : d;
};
const REPS = arg('--reps', 4);
const MS = 4200;
// Flyover altitude over West Campus — the densest roofscape in the scene, and
// the pose the "before" screenshots were taken at. Timing over the historic
// halls would measure the pitched roofs, which this pass did not touch.
const POSE = { center: [-97.7462, 30.2872], zoom: arg('--zoom', 16.4), pitch: 58 };

// off      = the layer never installed at all: the true baseline
// full     = every feature (cinematic / ultra)
// balanced = the default preset's density
// perf     = the performance preset's density
// major    = tier 0 only, i.e. what actually draws from flying altitude
const ONLY = process.argv.includes('--ab');
const CONFIGS = ONLY ? {
  off: { install: false },
  balanced: { detail: 0.75 },
} : {
  off: { install: false },
  full: { detail: 1.0 },
  balanced: { detail: 0.75 },
  perf: { detail: 0.45 },
  major: { detail: 0.45, minorOff: true },
};

const browser = await launch(chromium, { gl: 'hardware' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.goto(SERVER + '/index.html?intro=0&drift=0', { timeout: 90000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 90000 });
await page.waitForTimeout(6000);
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

// Install once and toggle visibility per config. Re-injecting per rep would put
// a fresh GeoJSON fetch and a worker re-tile inside the timed window, which
// measures the loader rather than the layer.
await page.addScriptTag({ path: path.resolve('../../js/roofs.js') });
// Both tiers. The detail tier is lazy — it only installs once the camera is
// within 0.45 of minorMinZoom — so timing without waiting for it would measure
// a configuration that has not finished arriving and report it as cheap.
await page.evaluate(() => window.__map.jumpTo({ center: [-97.7462, 30.2872], zoom: 16.8, pitch: 0 }));
await page.waitForFunction(() => {
  const m = window.__map;
  return ['austin-roofscape', 'austin-roofscape-detail']
    .every(s => m.getSource(s) && m.isSourceLoaded(s));
}, null, { timeout: 90000 });

const counts = await page.evaluate(() => {
  const m = window.__map;
  const q = id => { try { return m.queryRenderedFeatures({ layers: [id] }).length; } catch (e) { return -1; } };
  return { base: m.querySourceFeatures('austin-roofscape').length,
           detail: m.querySourceFeatures('austin-roofscape-detail').length,
           deck: q('roofscape-deck'), major: q('roofscape-major'), minor: q('roofscape-minor') };
});

async function run(cfg) {
  await page.evaluate((c) => {
    window.setRoofscapeVisible(c.install !== false);
    if (c.install !== false) {
      window.setRoofDetail(c.detail);
      if (c.minorOff) {
        try { window.__map.setLayoutProperty('roofscape-minor', 'visibility', 'none'); } catch (e) {}
      }
    }
  }, cfg);
  await page.evaluate((P) => window.__map.jumpTo({ ...P, bearing: 0 }), POSE);
  // SETTING A FILTER RE-TILES THE WHOLE SOURCE IN A WORKER. The first version of
  // this script timed 1.4 s after `setRoofDetail`, so every density config was
  // measuring its own re-tile and `full` came back CHEAPER than `off` — an
  // impossible ordering that reads as noise but is a methodology bug. Wait for
  // idle, then settle, then time.
  await page.evaluate(() => new Promise(r => {
    const m = window.__map;
    if (m.loaded()) return r();
    m.once('idle', r);
    setTimeout(r, 20000);
  }));
  await page.waitForTimeout(2500);
  return await page.evaluate(async ([ms, P]) => {
    const m = window.__map;
    const dts = [];
    let last = performance.now(), t0 = last, b = 0;
    await new Promise(res => {
      const step = () => {
        const now = performance.now();
        dts.push(now - last); last = now;
        b += 0.9; m.jumpTo({ ...P, bearing: b });
        if (now - t0 < ms) requestAnimationFrame(step); else res();
      };
      requestAnimationFrame(step);
    });
    const drop = dts.slice(3).reduce((a, d) => a + Math.max(0, Math.round(d / 16.67) - 1), 0);
    return { dropped: drop, frames: dts.length,
             fps: +(1000 * dts.length / (performance.now() - t0)).toFixed(1) };
  }, [MS, POSE]);
}

const results = {};
for (const k of Object.keys(CONFIGS)) results[k] = [];
for (let r = 0; r < REPS; r++) {
  for (const [k, cfg] of Object.entries(CONFIGS)) results[k].push(await run(cfg));
}
console.log('source features', JSON.stringify(counts));
console.log('pose', JSON.stringify(POSE), 'reps', REPS);
console.log('');
console.log('config      dropped(min)   fps(best)   [all reps dropped]');
for (const [k, arr] of Object.entries(results)) {
  const drops = arr.map(a => a.dropped);
  const fps = arr.map(a => a.fps);
  console.log(k.padEnd(11) + String(Math.min(...drops)).padStart(7)
    + Math.max(...fps).toFixed(1).padStart(13) + '      [' + drops.join(', ') + ']');
}
await browser.__done();
