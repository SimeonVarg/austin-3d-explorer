/**
 * whoccludes.mjs — which layer is painting over the thing I am looking at?
 *
 * DKR renders correctly at a nadir and from the west and north, and vanishes
 * from an east-facing oblique, replaced by a flat dark oval at its own
 * footprint. isolate.mjs proves the stadium itself draws fine at that exact
 * pose, so something above it in the stack is covering it — and guessing which
 * has already burned two wrong hypotheses.
 *
 * This hides one layer at a time, samples a pixel, and reports every layer whose
 * removal changes it. That is the whole tool.
 *
 * Usage: node whoccludes.mjs <shots.json> <sampleX> <sampleY>
 */
import { chromium } from 'playwright-core';
import { chromePath, BASE as SERVER } from './chrome.mjs';
import fs from 'node:fs';

const SHOTS = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const SX = parseInt(process.argv[3] || '720', 10);
const SY = parseInt(process.argv[4] || '450', 10);

const browser = await chromium.launch({
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

const s = SHOTS[0];
await page.evaluate(async (s) => {
  const m = window.__map;
  if (s.gfx && window.GFX && window.GFX_PRESETS[s.gfx]) {
    Object.assign(window.GFX, window.GFX_PRESETS[s.gfx]); window.applyGraphics();
  }
  if (m.isEasing && m.isEasing()) m.stop();
  m.jumpTo({ center: s.center, zoom: s.zoom, pitch: s.pitch, bearing: s.bearing });
  if (typeof s.p === 'number') window.applyTimeOfDay(m, s.p);
}, s);
await page.waitForTimeout(4000);

// The harness keeps the drawing buffer, so the canvas can be read back directly.
const readPx = () => page.evaluate(({ x, y }) => {
  const c = window.__map.getCanvas();
  const g = document.createElement('canvas');
  g.width = c.width; g.height = c.height;
  g.getContext('2d').drawImage(c, 0, 0);
  const r = c.width / c.clientWidth;
  const d = g.getContext('2d').getImageData(Math.round(x * r), Math.round(y * r), 1, 1).data;
  return [d[0], d[1], d[2]];
}, { x: SX, y: SY });

const layers = await page.evaluate(() =>
  window.__map.getStyle().layers.map(l => ({ id: l.id, type: l.type })));
const stadiumAt = layers.findIndex(l => l.id.startsWith('stadium'));
const base = await readPx();
console.log('layers: %d   stadium first at index %d', layers.length, stadiumAt);
console.log('baseline pixel at (%d,%d): rgb(%s)', SX, SY, base.join(','));

const above = layers.slice(stadiumAt).filter(l => !l.id.startsWith('stadium'));
console.log('testing %d layers above the stadium\n', above.length);
const hits = [];
for (const l of above) {
  await page.evaluate(id => { try { window.__map.setLayoutProperty(id, 'visibility', 'none'); } catch (e) {} }, l.id);
  await page.waitForTimeout(260);
  await page.evaluate(() => window.__map.triggerRepaint());
  await page.waitForTimeout(240);
  const px = await readPx();
  const d = Math.abs(px[0] - base[0]) + Math.abs(px[1] - base[1]) + Math.abs(px[2] - base[2]);
  if (d > 24) { hits.push({ id: l.id, type: l.type, px, d }); console.log('  CHANGED  %-24s %-16s rgb(%s)  delta %d', l.id, l.type, px.join(','), d); }
  await page.evaluate(id => { try { window.__map.setLayoutProperty(id, 'visibility', 'visible'); } catch (e) {} }, l.id);
  await page.waitForTimeout(120);
}
console.log('\nculprits: %s', hits.length ? hits.map(h => h.id).join(', ') : '(none — nothing above it is covering that pixel)');
await browser.close();
