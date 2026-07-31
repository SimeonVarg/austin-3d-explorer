/**
 * peel.mjs — which layer group is responsible for what I am looking at?
 *
 * isolate.mjs answers "does this layer draw here" by showing ONLY that layer.
 * That is the right tool for a missing building and the wrong one for a defect
 * that is an INTERACTION between two layers — a deck z-fighting a parapet, or
 * clutter poking through an authored roof. Showing one of the pair alone makes
 * the defect disappear, which reads as "not this layer" for both of them.
 *
 * So this peels instead: render the full scene, then hide one group at a time
 * and measure what changed. A z-fight shows up as a large changed area when
 * EITHER member is removed. It also writes a PNG per state so the change can be
 * looked at rather than believed.
 *
 * Two things it does that the older scripts do not, both from README traps:
 *   - it re-reads `visibility` in a LATER JS turn and prints what actually
 *     stuck, because a module can put a layer back on its own map events (the
 *     roads flag bug, and an isolate.mjs run in this session that silently
 *     failed to hide anything);
 *   - the pixel reduction happens in the page. Handing a 1440x900 framebuffer
 *     back through CDP is the twenty-minute, 2 GB mistake in the README.
 *
 * Usage:
 *   node peel.mjs <outPrefix> <shots.json> <groupA> [groupB ...]
 * where a group is a comma-separated list of layer-id prefixes, e.g.
 *   node peel.mjs fac shots-fac.json roofscape roofs-pitched buildings-roof
 */
import { chromium } from 'playwright-core';
import { chromePath, BASE as SERVER, launch } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2] || 'peel';
const SHOTS = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const GROUPS = process.argv.slice(4);
if (!GROUPS.length) {
  console.error('need at least one layer-prefix group');
  process.exit(2);
}

const outDir = path.resolve('shots');
fs.mkdirSync(outDir, { recursive: true });

const browser = await launch(chromium, {
  executablePath: chromePath(), headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--ignore-gpu-blocklist', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('PAGEERR', e.message));

await page.goto(SERVER + '/_harness.html?intro=0&drift=0', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
await page.waitForTimeout(9000);
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

// One 2D context reused for every grab. Created with willReadFrequently so the
// drawImage off the WebGL canvas takes the CPU path (facades.js header: 22 ms
// against 230 ms for the GPU path on a readback like this).
await page.evaluate(() => {
  window.__peek = (function () {
    let cv = null, cx = null;
    const store = {};
    function grab(name) {
      const gl = window.__map.getCanvas();
      if (!cv) {
        cv = document.createElement('canvas');
        cv.width = Math.floor(gl.width / 2);
        cv.height = Math.floor(gl.height / 2);
        cx = cv.getContext('2d', { willReadFrequently: true });
      }
      cx.drawImage(gl, 0, 0, cv.width, cv.height);
      store[name] = cx.getImageData(0, 0, cv.width, cv.height).data;
      return [cv.width, cv.height];
    }
    // Aggregate in here, never hand the buffer back.
    function diff(a, b, thresh) {
      const A = store[a], B = store[b];
      if (!A || !B) return null;
      let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      const W = cv.width;
      for (let i = 0, px = 0; i < A.length; i += 4, px++) {
        const d = Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]);
        if (d <= thresh) continue;
        n++;
        const x = px % W, y = (px / W) | 0;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      return { n, total: A.length / 4, box: x1 < 0 ? null : [x0 * 2, y0 * 2, x1 * 2, y1 * 2] };
    }
    return { grab, diff };
  })();
});

async function settle(ms = 2500) {
  await page.waitForTimeout(ms);
  await page.evaluate(() => new Promise(r => {
    const m = window.__map; if (m.loaded()) return r(); m.once('idle', r); setTimeout(r, 12000);
  }));
  await page.evaluate(() => window.__map.triggerRepaint());
  await page.waitForTimeout(900);
}

for (const s of SHOTS) {
  await page.evaluate((s) => {
    const m = window.__map;
    if (s.gfx && window.GFX && window.GFX_PRESETS[s.gfx]) {
      Object.assign(window.GFX, window.GFX_PRESETS[s.gfx]); window.applyGraphics();
    }
    if (m.isEasing && m.isEasing()) m.stop();
    m.jumpTo({ center: s.center, zoom: s.zoom, pitch: s.pitch, bearing: s.bearing });
    if (typeof s.p === 'number') window.applyTimeOfDay(m, s.p, true);
  }, s);
  await settle(4000);

  await page.screenshot({ path: path.join(outDir, `${OUT}-${s.name}-all.png`) });
  await page.evaluate(() => window.__peek.grab('all'));

  console.log(`\n${s.name}  (zoom ${s.zoom} pitch ${s.pitch} bearing ${s.bearing} p=${s.p})`);
  console.log('  group                      layers hidden   px changed    changed bbox');

  for (const g of GROUPS) {
    const prefixes = g.split(',');
    const hidden = await page.evaluate((prefixes) => {
      const m = window.__map;
      const ids = m.getStyle().layers.map(l => l.id).filter(id => prefixes.some(p => id.startsWith(p)));
      for (const id of ids) { try { m.setLayoutProperty(id, 'visibility', 'none'); } catch (e) {} }
      return ids;
    }, prefixes);
    await settle();
    // A LATER turn, on purpose: a module that puts its layer back does it on a
    // map event, so a read in the same turn as the write reports success.
    const stuck = await page.evaluate((ids) => {
      const m = window.__map;
      return ids.filter(id => {
        try { return m.getLayoutProperty(id, 'visibility') !== 'none'; } catch (e) { return false; }
      });
    }, hidden);

    await page.screenshot({ path: path.join(outDir, `${OUT}-${s.name}-no-${g.replace(/[,]/g, '+')}.png`) });
    const d = await page.evaluate(() => { window.__peek.grab('cur'); return window.__peek.diff('all', 'cur', 12); });

    const pct = ((d.n / d.total) * 100).toFixed(2);
    console.log(
      '  ' + g.padEnd(26) + String(hidden.length).padStart(6) +
      String(pct + '%').padStart(14) +
      '    ' + (d.box ? d.box.join(',') : '(nothing changed)') +
      (stuck.length ? `   !! ${stuck.length} REFUSED TO HIDE: ${stuck.slice(0, 4).join(' ')}` : '')
    );

    await page.evaluate((ids) => {
      const m = window.__map;
      for (const id of ids) { try { m.setLayoutProperty(id, 'visibility', 'visible'); } catch (e) {} }
    }, hidden);
    await settle(1500);
  }
}

await browser.__done();
