/**
 * isolate.mjs — screenshot a pose with ONLY the named layers visible.
 *
 * Judging one building inside a dense city is guesswork: a terracotta band that
 * looked like it sat on DKR's rim turned out to belong to a building behind it,
 * and `queryRenderedFeatures` on a fill-extrusion answers by footprint, so it
 * confirmed the wrong thing. Hiding everything else answers it in one frame.
 *
 * Usage: node isolate.mjs <outPrefix> <shots.json> [layerPrefix ...]
 *   default layer prefixes: stadium
 */
import { chromium } from 'playwright-core';
import { chromePath, BASE as SERVER, launch } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2] || 'iso';
const SHOTS = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const KEEP = process.argv.slice(4).length ? process.argv.slice(4) : ['stadium'];

const outDir = path.resolve('shots');
fs.mkdirSync(outDir, { recursive: true });

const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('PAGEERR', e.message));

await page.goto(SERVER + '/_harness.html?intro=0&drift=0', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
await page.waitForTimeout(7000);
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

for (const s of SHOTS) {
  await page.evaluate(async ({ s, KEEP }) => {
    const m = window.__map;
    if (s.gfx && window.GFX && window.GFX_PRESETS[s.gfx]) {
      Object.assign(window.GFX, window.GFX_PRESETS[s.gfx]); window.applyGraphics();
    }
    if (m.isEasing && m.isEasing()) m.stop();
    m.jumpTo({ center: s.center, zoom: s.zoom, pitch: s.pitch, bearing: s.bearing });
    if (typeof s.p === 'number') window.applyTimeOfDay(m, s.p);
    for (const l of m.getStyle().layers) {
      const keep = KEEP.some(k => l.id.startsWith(k)) || l.id === 'background' || /sky|atmos/.test(l.id);
      try { m.setLayoutProperty(l.id, 'visibility', keep ? 'visible' : 'none'); } catch (e) {}
    }
  }, { s, KEEP });
  await page.waitForTimeout(3000);
  await page.evaluate(() => new Promise(r => {
    const m = window.__map; if (m.loaded()) return r(); m.once('idle', r); setTimeout(r, 15000);
  }));
  await page.evaluate(() => window.__map.triggerRepaint());
  await page.waitForTimeout(1200);
  const file = path.join(outDir, `${OUT}-${s.name}.png`);
  await page.screenshot({ path: file });
  await page.waitForTimeout(500);
  await page.screenshot({ path: file });
  console.log('WROTE', file);
}
await browser.__done();
