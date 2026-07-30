/**
 * capitol-probe.mjs — why are the extrusions missing from one camera pose?
 *
 * The A1 approach shot renders ground, trees and shadows but no buildings,
 * while the same block from 300 m away renders everything. queryRenderedFeatures
 * reports 0 for layers that are visibly on screen, so it cannot answer this
 * (HANDOFF §2: `view:` is view-dependent and lies for 3D). This paints the
 * layer magenta instead — one render settles it.
 */
import { chromium } from 'playwright-core';
import { chromePath, BASE as SERVER } from './chrome.mjs';
import path from 'node:path';
import fs from 'node:fs';

const outDir = path.resolve('shots');
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: chromePath(), headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
// `?intro=0` is the only reliable way to own the camera. The 9 s intro is a
// map.flyTo, NOT the flight controller, so `__fly.eye().driving` stays FALSE
// for its whole duration — waiting on `!driving` returns immediately and the
// jumpTo that follows is overwritten a frame later. Two runs of this probe
// screenshotted campus and were nearly read as "the buildings are missing at
// the Capitol"; they were missing because the camera was never there.
await page.goto(SERVER + '/_harness.html?intro=0', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
// The scene is ~4 MB of GeoJSON and js/capitol.js setData()s two more sources
// after it; every one of those re-tiles in a worker. Wait for the sources to
// actually be there rather than for a clock.
await page.waitForFunction(() => {
  const m = window.__map;
  if (!m || !m.getSource('austin-buildings')) return false;
  return ['austin-buildings', 'austin-ground', 'austin-trees', 'austin-capitol-dome']
    .every(s => m.getSource(s) && m.isSourceLoaded(s));
}, null, { timeout: 90000 }).catch(() => console.log('WARN: sources not all loaded'));
await page.waitForTimeout(3000);
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

const POSE = { center: [-97.74032, 30.27460], zoom: 16.5, pitch: 72, bearing: 0 };

async function shot(name, fn) {
  await page.evaluate(([pose, body]) => {
    const m = window.__map;
    m.jumpTo(pose);
    // eslint-disable-next-line no-new-func
    new Function('m', body)(m);
  }, [POSE, fn]);
  // A GeoJSON source re-tiles in a worker after a camera move, so a fixed
  // sleep samples whatever happens to be ready. Wait for `idle`.
  await page.evaluate(() => new Promise(res => {
    const m = window.__map;
    if (m.loaded() && m.areTilesLoaded()) return res();
    const t = setTimeout(res, 20000);
    m.once('idle', () => { clearTimeout(t); res(); });
  }));
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.__map.triggerRepaint());
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(outDir, `probe-${name}.png`) });
  console.log('WROTE probe-' + name);
}

await shot('0-day', 'window.applyTimeOfDay(m, 0.25, true);');
await shot('1-golden', 'window.applyTimeOfDay(m, 0.50, true);');
await shot('2-night', 'window.applyTimeOfDay(m, 0.88, true);');

const facts = await page.evaluate(() => {
  const m = window.__map;
  const t = m.transform;
  const src = m.getSource('austin-buildings');
  const data = { };
  try {
    const f = m.querySourceFeatures('austin-buildings', { sourceLayer: undefined });
    let south = 0, capitol = 0;
    for (const x of f) {
      const p = x.properties || {};
      if (String(p.id || '').startsWith('osm:')) south++;
      if (p.name === 'Texas State Capitol') capitol++;
    }
    data.sourceFeatures = f.length;
    data.southFeatures = south;
    data.capitolFeatures = capitol;
  } catch (e) { data.err = e.message; }
  data.pitch = t.pitch;
  data.zoom = +t.zoom.toFixed(2);
  data.camAlt = t.getCameraAltitude ? +t.getCameraAltitude().toFixed(1) : null;
  data.camLngLat = t.getCameraLngLat ? t.getCameraLngLat().toArray().map(v => +v.toFixed(5)) : null;
  data.buildings3dVisible = m.getLayoutProperty('buildings-3d', 'visibility');
  data.buildings3dMinzoom = m.getLayer('buildings-3d').minzoom;
  data.buildings3dFilter = JSON.stringify(m.getFilter('buildings-3d'));
  data.gfx = window.GFX ? { renderScale: window.GFX.renderScale, treeDensity: window.GFX.treeDensity } : null;
  return data;
});
console.log('FACTS', JSON.stringify(facts, null, 1));
if (errors.length) console.log('ERRORS', errors.slice(0, 10));
await browser.close();
