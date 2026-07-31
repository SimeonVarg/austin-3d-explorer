/**
 * srcprobe.mjs — did every pass actually boot, and is its source tiled?
 *
 * "The building is missing from the frame" has three completely different
 * causes in this app and they are indistinguishable in a screenshot: the module
 * never booted, the source never loaded, or the source loaded but nothing is
 * tiled at this camera. Guessing between them has cost this repo several
 * sessions. This prints all three per pass.
 *
 * Usage: node srcprobe.mjs [shots.json]   (uses the FIRST pose if given)
 */
import { chromium } from 'playwright-core';
import { chromePath, BASE as SERVER } from './chrome.mjs';
import fs from 'node:fs';

const POSE = process.argv[2] ? JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))[0] : null;

const browser = await chromium.launch({
  executablePath: chromePath(), headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--ignore-gpu-blocklist', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', m => logs.push(`${m.type()}: ${m.text()}`.slice(0, 220)));
page.on('pageerror', e => logs.push('PAGEERROR ' + e.message.slice(0, 220)));
page.on('requestfailed', r => logs.push('REQFAIL ' + r.url().slice(-60) + ' ' + (r.failure() || {}).errorText));
page.on('response', r => { if (r.status() >= 400) logs.push(`HTTP ${r.status()} ${r.url().slice(-60)}`); });

await page.goto(SERVER + '/_harness.html?intro=0&drift=0', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
await page.waitForTimeout(20000);
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

if (POSE) {
  await page.evaluate((s) => {
    const m = window.__map;
    if (s.gfx && window.GFX && window.GFX_PRESETS[s.gfx]) {
      Object.assign(window.GFX, window.GFX_PRESETS[s.gfx]); window.applyGraphics();
    }
    if (m.isEasing && m.isEasing()) m.stop();
    m.jumpTo({ center: s.center, zoom: s.zoom, pitch: s.pitch, bearing: s.bearing });
    if (typeof s.p === 'number') window.applyTimeOfDay(m, s.p, true);
  }, POSE);
  await page.waitForTimeout(6000);
  await page.evaluate(() => new Promise(r => {
    const m = window.__map; if (m.loaded()) return r(); m.once('idle', r); setTimeout(r, 15000);
  }));
}

const r = await page.evaluate(() => {
  const m = window.__map;
  const SRC = ['austin-buildings', 'austin-roofscape', 'austin-roofscape-detail', 'austin-tower',
               'austin-westcampus', 'austin-drag', 'austin-arts', 'austin-moody',
               'austin-stadium', 'austin-outer'];
  const out = { zoom: +m.getZoom().toFixed(2), sources: {}, layers: {} };
  for (const s of SRC) {
    if (!m.getSource(s)) { out.sources[s] = 'ABSENT (module never added it)'; continue; }
    let n = -1;
    try { n = m.querySourceFeatures(s).length; } catch (e) {}
    out.sources[s] = `${m.isSourceLoaded(s) ? 'loaded' : 'LOADING'}, ${n} tiled here`;
  }
  for (const l of m.getStyle().layers) {
    if (!/^(roofscape|tower|wc-|drag-|arts-|moody|stadium|roofs-)/.test(l.id)) continue;
    let vis = '?';
    try { vis = m.getLayoutProperty(l.id, 'visibility') || 'visible'; } catch (e) {}
    out.layers[l.id] = `${vis}  minzoom=${l.minzoom == null ? '-' : l.minzoom}`;
  }
  return out;
});

console.log('zoom', r.zoom);
console.log('\nSOURCES');
for (const [k, v] of Object.entries(r.sources)) console.log('  ' + k.padEnd(26) + v);
console.log('\nPASS LAYERS');
const ls = Object.entries(r.layers);
if (!ls.length) console.log('  NONE — no pass added a layer at all');
for (const [k, v] of ls) console.log('  ' + k.padEnd(26) + v);
console.log('\nCONSOLE (pass-related / errors)');
for (const l of logs.filter(x => /error|fail|warn|\[(roofscape|tower|westcampus|drag|arts|moody)\]/i.test(x)).slice(0, 40)) {
  console.log('  ' + l);
}
await browser.close();
