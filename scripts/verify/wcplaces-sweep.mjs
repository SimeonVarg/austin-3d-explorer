/**
 * wcplaces-sweep.mjs — one browser session, many configs, for
 * acer/f2-wcplaces (QUEUE F2 front 2: js/westcampus.js + js/places.js).
 *
 * Reuses shimmer.mjs's EXACT grab/scan definition (copied verbatim, not
 * reimplemented) so every number here is directly comparable to a plain
 * `node shimmer.mjs` run — the trap in docs/shimmer-brief.md §7 was a
 * from-scratch meter rewrite that looked sound and gave the opposite
 * answer; this avoids that by not being a second meter, just a driver that
 * runs the same one multiple times in one page load instead of one process
 * per config (heavy sibling load makes repeated full page loads expensive
 * — scripts/verify/README.md's own load-time range is 11-65s; this pays
 * that ONCE per pose instead of once per (pose x radius)).
 *
 * For each pose, sweeps PLACES_SOFTEN.RADIUS.plGlass over RADII (amount
 * fixed at 1.0) and reports crawl%. Also reports the FACADE_SOFTEN-disabled
 * counterfactual at the same pose when `disableFacade: true` is set on a
 * pose, to test whether js/westcampus.js's wc-wall (which carries no code
 * of its own — see the acer/f2-wcplaces commit message) is really governed
 * by the SAME lever facades.js already ships.
 *
 * Usage: node wcplaces-sweep.mjs <shots.json> [outPrefix]
 */
import { chromium } from 'playwright-core';
import { BASE as SERVER, launch } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';

const SHOTS = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const OUT = process.argv[3] || 'wcp';
const RADII = process.env.SWEEP_RADII ? process.env.SWEEP_RADII.split(',').map(Number) : [0, 3, 6];
const outDir = path.resolve('shots');
fs.mkdirSync(outDir, { recursive: true });

const FRAMES = 9;
const TRAVEL_M = 3.0;

const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('PAGEERR', e.message));

await page.goto(SERVER + '/_harness.html?intro=0&drift=0', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
await page.waitForFunction(() => {
  const m = window.__map;
  if (!m || !m.getSource('austin-buildings')) return false;
  return ['austin-buildings', 'austin-roofscape', 'austin-tower', 'austin-drag',
          'austin-westcampus', 'austin-places']
    .every(s => !m.getSource(s) || m.isSourceLoaded(s));
}, null, { timeout: 90000 }).catch(() => console.log('WARN: sources not all loaded'));
await page.waitForTimeout(6000);
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

// Same grab/scan as shimmer.mjs, copied verbatim.
await page.evaluate(() => {
  window.__shim = (function () {
    let cv = null, cx = null;
    const luma = [];
    function grab(i) {
      const gl = window.__map.getCanvas();
      if (!cv) { cv = document.createElement('canvas'); cv.width = gl.width; cv.height = gl.height; cx = cv.getContext('2d', { willReadFrequently: true }); }
      cx.drawImage(gl, 0, 0);
      const d = cx.getImageData(0, 0, cv.width, cv.height).data;
      const n = cv.width * cv.height;
      const L = new Float32Array(n);
      for (let p = 0, j = 0; p < n; p++, j += 4) L[p] = (d[j] * 299 + d[j + 1] * 587 + d[j + 2] * 114) / 1000;
      luma[i] = L;
      if (i === 0) window.__shimFrame0 = cx.getImageData(0, 0, cv.width, cv.height);
    }
    function scan(amp, minFlips, box) {
      const W = cv.width, H = cv.height, F = luma.length;
      const [x0, y0, x1, y1] = box || [0, 0, W - 1, H - 1];
      let inBox = 0, crawling = 0, movedAtAll = 0;
      const flag = new Uint8Array(W * H);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const p = y * W + x; inBox++;
        let flips = 0, prevSign = 0, lo = 1e9, hi = -1e9;
        for (let f = 1; f < F; f++) {
          const d = luma[f][p] - luma[f - 1][p];
          if (luma[f][p] < lo) lo = luma[f][p]; if (luma[f][p] > hi) hi = luma[f][p];
          if (Math.abs(d) < amp) continue;
          const s = d > 0 ? 1 : -1;
          if (prevSign !== 0 && s !== prevSign) flips++;
          prevSign = s;
        }
        if (hi - lo >= amp) movedAtAll++;
        if (flips >= minFlips) { flag[p] = 1; crawling++; }
      }
      const img = window.__shimFrame0;
      for (let p = 0, i = 0; p < W * H; p++, i += 4) {
        if (flag[p]) { img.data[i] = 255; img.data[i + 1] = 0; img.data[i + 2] = 255; }
        else { img.data[i] >>= 2; img.data[i + 1] >>= 2; img.data[i + 2] >>= 2; }
      }
      cx.putImageData(img, 0, 0);
      luma.length = 0;
      return { inBox, crawling, crawlPct: (crawling / inBox) * 100, movedPct: (movedAtAll / inBox) * 100, mask: cv.toDataURL('image/png') };
    }
    return { grab, scan, reset: () => { luma.length = 0; } };
  })();
});

async function settle(ms) {
  await page.waitForTimeout(ms);
  await page.evaluate(() => new Promise(r => { const m = window.__map; if (m.loaded()) return r(); m.once('idle', r); setTimeout(r, 12000); }));
  await page.evaluate(() => window.__map.triggerRepaint());
  await page.waitForTimeout(350);
}

async function sweepOnce(s, label) {
  await page.evaluate((f) => window.__shim.reset(), null);
  for (let f = 0; f < FRAMES; f++) {
    await page.evaluate(({ s, f, FRAMES, TRAVEL_M }) => {
      const m = window.__map;
      const t = f / (FRAMES - 1), d = TRAVEL_M * t;
      const rad = s.bearing * Math.PI / 180;
      const dLat = (d * Math.cos(rad)) / 111320;
      const dLng = (d * Math.sin(rad)) / (111320 * Math.cos(s.center[1] * Math.PI / 180));
      m.jumpTo({ center: [s.center[0] + dLng, s.center[1] + dLat], zoom: s.zoom, pitch: s.pitch, bearing: s.bearing });
      m.triggerRepaint();
    }, { s, f, FRAMES, TRAVEL_M });
    await page.waitForTimeout(450);
    await page.evaluate((f) => window.__shim.grab(f), f);
  }
  const r = await page.evaluate(({ box }) => window.__shim.scan(4, 2, box || null), { box: s.box });
  const file = path.join(outDir, `${OUT}-${s.name}-${label}.png`);
  fs.writeFileSync(file, Buffer.from(r.mask.split(',')[1], 'base64'));
  console.log(`${s.name.padEnd(20)} ${label.padEnd(14)} crawl ${r.crawlPct.toFixed(2).padStart(6)}%  moved ${r.movedPct.toFixed(1).padStart(5)}%  -> ${path.basename(file)}`);
  return r;
}

for (const s of SHOTS) {
  await page.evaluate((s) => {
    const m = window.__map;
    if (m.isEasing && m.isEasing()) m.stop();
    m.jumpTo({ center: s.center, zoom: s.zoom, pitch: s.pitch, bearing: s.bearing });
    if (typeof s.p === 'number') window.applyTimeOfDay(m, s.p, true);
    if (Array.isArray(s.hideLayers)) for (const id of s.hideLayers) { try { if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', 'none'); } catch (e) {} }
  }, s);
  await settle(4500);

  for (const r of RADII) {
    await page.evaluate((radius) => {
      const p0 = window.__todCurrentP != null ? window.__todCurrentP : 0.25;
      if (window.PLACES_SOFTEN) {
        window.PLACES_SOFTEN.RADIUS.plGlass = radius;
        window.PLACES_SOFTEN.AMOUNT.plGlass = 1.0;
        window.applyPlacesColors && window.applyPlacesColors(window.__map, p0);
      }
    }, r);
    await page.waitForTimeout(300);
    await sweepOnce(s, `places-r${r}`);
  }

  if (s.disableFacade) {
    // p0 has to be read FROM THE PAGE and passed in -- `window` on the outer
    // (Node) side is not the browser's window, and a bare reference to it
    // here would throw ReferenceError.
    const savedFacade = await page.evaluate(() => JSON.parse(JSON.stringify(window.FACADE_SOFTEN)));
    const p0 = await page.evaluate(() => window.__todCurrentP != null ? window.__todCurrentP : 0.25);
    await page.evaluate((p0) => {
      const S = window.FACADE_SOFTEN;
      for (const f of Object.keys(S.RADIUS)) S.RADIUS[f] = 0;
      window.updateFacades && window.updateFacades(window.__map, p0);
    }, p0);
    await page.waitForTimeout(300);
    await sweepOnce(s, 'facade-r0');
    await page.evaluate((saved) => {
      Object.assign(window.FACADE_SOFTEN.RADIUS, saved.RADIUS);
      Object.assign(window.FACADE_SOFTEN.AMOUNT, saved.AMOUNT);
      window.updateFacades && window.updateFacades(window.__map, window.__todCurrentP);
    }, savedFacade);
    await page.waitForTimeout(300);
    await sweepOnce(s, 'facade-shipped');
  }
}

await browser.__done();
