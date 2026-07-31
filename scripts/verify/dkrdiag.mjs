/**
 * dkrdiag.mjs — is the stadium in the source, in the tiles, and in the frame?
 *
 * The stadium renders from a nadir and from the west and north, and does not
 * render from an east-facing oblique — yet isolate.mjs draws it fine at that
 * same pose, and whoccludes.mjs proves nothing above it is covering the pixel.
 * So the question is no longer "what is on top of it" but "is it being drawn at
 * all", and this asks the map directly instead of inferring from a screenshot.
 */
import { chromium } from 'playwright-core';
import { chromePath, BASE as SERVER, launch } from './chrome.mjs';
import fs from 'node:fs';

const SHOTS = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('PAGEERR', e.message));
page.on('console', m => { if (/error|stadium|image/i.test(m.text())) console.log('CONSOLE:', m.text()); });
await page.goto(SERVER + '/_harness.html?intro=0&drift=0', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
await page.waitForTimeout(9000);
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

for (const s of SHOTS) {
  await page.evaluate(async (s) => {
    const m = window.__map;
    if (s.gfx && window.GFX && window.GFX_PRESETS[s.gfx]) {
      Object.assign(window.GFX, window.GFX_PRESETS[s.gfx]); window.applyGraphics();
    }
    if (m.isEasing && m.isEasing()) m.stop();
    m.jumpTo({ center: s.center, zoom: s.zoom, pitch: s.pitch, bearing: s.bearing });
    if (typeof s.p === 'number') window.applyTimeOfDay(m, s.p);
  }, s);
  await page.waitForTimeout(5000);
  const info = await page.evaluate(() => {
    const m = window.__map;
    const out = { zoom: +m.getZoom().toFixed(2), pitch: m.getPitch(), bearing: m.getBearing() };
    out.source = !!m.getSource('austin-stadium');
    try { out.srcFeatures = m.querySourceFeatures('austin-stadium').length; } catch (e) { out.srcFeatures = 'ERR ' + e.message; }
    out.layers = {};
    for (const id of ['stadium-wall', 'stadium-wall-roof', 'stadium-seating', 'stadium-detail']) {
      const l = m.getLayer(id);
      if (!l) { out.layers[id] = 'MISSING'; continue; }
      out.layers[id] = {
        vis: m.getLayoutProperty(id, 'visibility') || 'visible',
        minzoom: l.minzoom, maxzoom: l.maxzoom,
        rendered: m.queryRenderedFeatures({ layers: [id] }).length,
      };
    }
    return out;
  });
  console.log(JSON.stringify(info, null, 2));
}
await browser.__done();
