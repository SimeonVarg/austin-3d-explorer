/**
 * lod-within.mjs — does the `within` filter actually CULL fill-extrusion
 * polygons, or does MapLibre merely accept the expression and ignore it?
 *
 * setFilter accepting an expression proves nothing: queryRenderedFeatures
 * returns 0 for every fill-extrusion layer at a flying pitch (README), so the
 * usual counter cannot answer this. Pixels can. Render the same pose with a
 * shrinking `within` circle and measure how much of the frame the buildings
 * still occupy — by painting them a key colour, which is the README's own
 * "paint it magenta and take one render" trick.
 *
 * Usage: node lod-within.mjs
 */
import { chromium } from 'playwright-core';
import { BASE as SERVER, launch } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';

const POSE = { center: [-97.7434, 30.2857], zoom: 14.6, pitch: 74, bearing: 200 };
const RADII = [null, 4000, 2000, 1000, 500, 250];
const KEY = '#ff00ff';

const outDir = path.resolve('shots/lod');
fs.mkdirSync(outDir, { recursive: true });

const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: 1000, height: 640 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));

await page.goto(`${SERVER}/_harness.html?intro=0&drift=0`, { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
await page.waitForFunction(() => {
  const m = window.__map;
  return m && m.getSource('austin-buildings') && m.getSource('austin-outer');
}, null, { timeout: 120000 });
await page.evaluate(p => window.__map.jumpTo(p), POSE);
await page.waitForFunction(() => window.__map.loaded() && window.__map.areTilesLoaded(), null, { timeout: 120000 });
await page.waitForTimeout(5000);

// Paint the two bulk building layers a key colour and hide everything else that
// could occlude them, so the ink measurement is unambiguous.
await page.evaluate(key => {
  const m = window.__map;
  window.__lodBase = {};
  for (const id of ['buildings-3d', 'outer-3d', 'outer-tower']) {
    if (!m.getLayer(id)) continue;
    window.__lodBase[id] = m.getFilter(id) ?? null;
    m.setPaintProperty(id, 'fill-extrusion-color', key);
    m.setPaintProperty(id, 'fill-extrusion-pattern', null);
    m.setPaintProperty(id, 'fill-extrusion-opacity', 1);
  }
  for (const l of m.getStyle().layers) {
    if (['buildings-3d', 'outer-3d', 'outer-tower'].includes(l.id)) continue;
    if (l.type === 'fill-extrusion' || l.type === 'symbol') {
      try { m.setLayoutProperty(l.id, 'visibility', 'none'); } catch (e) {}
    }
  }
}, KEY);
await page.waitForTimeout(2500);

function circle(lng, lat, metres, n = 48) {
  const dLat = metres / 111320;
  const dLon = metres / (111320 * Math.cos(lat * Math.PI / 180));
  const ring = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    ring.push([lng + dLon * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } };
}

const rows = [];
for (const r of RADII) {
  const poly = r == null ? null : await page.evaluate(([r]) => {
    const c = window.__map.getCenter();
    return { lng: c.lng, lat: c.lat, r };
  }, [r]);
  const gj = poly ? circle(poly.lng, poly.lat, poly.r) : null;

  const ms = await page.evaluate(([gj]) => {
    const m = window.__map;
    for (const id of Object.keys(window.__lodBase)) {
      const base = window.__lodBase[id];
      m.setFilter(id, gj ? (base ? ['all', base, ['within', gj]] : ['within', gj]) : base);
    }
    // Time a forced redraw so the cost of evaluating `within` shows up.
    const t0 = performance.now();
    m.triggerRepaint();
    return performance.now() - t0;
  }, [gj]);

  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(outDir, '_t.png') });
  await page.waitForTimeout(500);
  const file = path.join(outDir, `within-${r == null ? 'off' : r}.png`);
  await page.screenshot({ path: file });

  const ink = await page.evaluate(() => {
    const gl = window.__map.getCanvas();
    const c = document.createElement('canvas');
    c.width = gl.width; c.height = gl.height;
    c.getContext('2d').drawImage(gl, 0, 0);
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] > 200 && d[i + 1] < 90 && d[i + 2] > 200) n++;
    }
    return +(100 * n / (c.width * c.height)).toFixed(3);
  });
  rows.push({ radius: r, inkPct: ink, repaintMs: +ms.toFixed(2) });
  console.log(`radius ${String(r ?? 'off').padStart(5)} m   buildings cover ${String(ink).padStart(7)}% of frame   repaint call ${ms.toFixed(2)} ms`);
}

fs.existsSync(path.join(outDir, '_t.png')) && fs.unlinkSync(path.join(outDir, '_t.png'));
fs.writeFileSync(path.join(outDir, 'within.json'), JSON.stringify(rows, null, 1));

const off = rows.find(r => r.radius === null).inkPct;
const near = rows.find(r => r.radius === 250).inkPct;
console.log('\nVERDICT:', near < off * 0.5
  ? `within CULLS — ink fell ${off}% -> ${near}% as the radius shrank`
  : `within DOES NOT CULL — ink barely moved (${off}% -> ${near}%). Do not build on it.`);
console.log('page errors:', errors.length ? errors.slice(0, 3).join(' | ') : 'none');
browser.__done();
