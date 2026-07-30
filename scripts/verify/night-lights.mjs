/**
 * night-lights.mjs — streetlight system sanity (6 assertions).
 *
 * Asserts from real state, not from having called the API: point counts from
 * the generated source data, opacities read back off the style, buildings
 * present so the occlusion order means something.
 */
import { chromium } from 'playwright-core';
import { chromePath, GL_ARGS, BASE } from './chrome.mjs';

const browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: GL_ARGS });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e => console.log('PAGEERROR', e.message));
page.on('console', m => { if (/\[night\]/.test(m.text())) console.log(' ', m.text()); });
await page.goto(`${BASE}/index.html?intro=0`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
// Streetlight generation waits for idle; give it a real chance.
await page.waitForFunction(() => !!window.__nightLights, null, { timeout: 45000 }).catch(() => {});

const r = await page.evaluate(async () => {
  const m = window.__map;
  const out = { gen: window.__nightLights || null };
  const layerOrder = m.getStyle().layers.map(l => l.id);
  out.poolIdx = layerOrder.indexOf('night-streetlight-pool');
  out.buildingsIdx = layerOrder.indexOf('buildings-3d');
  window.applyTimeOfDay(m, 0.95, true);
  await new Promise(res => setTimeout(res, 300));
  out.opacityNight = m.getPaintProperty('night-streetlight-core', 'circle-opacity');
  window.applyTimeOfDay(m, 0.12, true);
  await new Promise(res => setTimeout(res, 300));
  out.opacityDay = m.getPaintProperty('night-streetlight-core', 'circle-opacity');
  return out;
});

const checks = [
  ['points generated', r.gen && r.gen.count > 0],
  ['point count sane (200..9000)', r.gen && r.gen.count >= 200 && r.gen.count <= 9000],
  ['fenced to the buildings bbox', r.gen && r.gen.fenced === true],
  ['not trimmed at cap', r.gen && !r.gen.trimmed],
  ['both tiers present', r.gen && r.gen.major > 0 && r.gen.count - r.gen.major > 0],
  ['pool layer sits before buildings-3d', r.poolIdx >= 0 && r.buildingsIdx > r.poolIdx],
  ['core opacity: >0.5 at night, 0 by day', r.opacityNight > 0.5 && r.opacityDay === 0],
];
console.log(JSON.stringify(r));
let fail = 0;
for (const [name, ok] of checks) { console.log(`${ok ? ' PASS' : '*FAIL'}  ${name}`); if (!ok) fail++; }
await browser.close();
process.exit(fail ? 1 : 0);
