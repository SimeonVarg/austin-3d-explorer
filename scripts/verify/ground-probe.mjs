/**
 * ground-probe.mjs — is the ground layer actually rendering, and where?
 *
 * Playbook rule: to test WHERE something is, paint it magenta and take one
 * render. Also reports how many ground features the source really holds and
 * the luma separation between the paths and the ground they sit on, because
 * "I can't see it" and "it isn't there" are different bugs.
 */
import { chromium } from 'playwright-core';
import { chromePath, BASE as SERVER, launch } from './chrome.mjs';
import path from 'node:path';

const P = parseFloat(process.argv[2] ?? '0.5');
const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('PAGEERROR', e.message));

await page.goto(SERVER + '/_harness.html?drift=0&intro=0', { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 90000 });
await page.waitForTimeout(4000);
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

const pose = { center: [-97.73955, 30.2844], zoom: 18.1, pitch: 78, bearing: 0 };
await page.evaluate(([s, p]) => {
  window.__map.jumpTo(s);
  window.applyTimeOfDay(window.__map, p, true);
  // Post FX off: this measures geometry and colour, not bloom.
  Object.assign(window.GFX, { bloom: 0, godRays: 0, flare: 0, dof: 0, grain: 0, vignette: 0 });
  window.applyGraphics();
}, [pose, P]);
await page.waitForTimeout(4500);

const info = await page.evaluate(() => {
  const m = window.__map;
  const src = m.getSource('austin-ground');
  const q = id => { try { return m.queryRenderedFeatures({ layers: [id] }).length; } catch (e) { return -1; } };
  const layers = m.getStyle().layers.map(l => l.id);
  return {
    sourceExists: !!src,
    loaded: src ? m.isSourceLoaded('austin-ground') : false,
    renderedAreas: q('ground-areas'),
    renderedPaths: q('ground-paths'),
    order: layers.filter(id => /ground|buildings-(ao|3d|shadow)/.test(id)),
  };
});
console.log('GROUND', JSON.stringify(info, null, 1));

// Magenta pass: where exactly do the paths land?
await page.evaluate(() => {
  window.__map.setPaintProperty('ground-paths', 'line-color', '#ff00ff');
  window.__map.setPaintProperty('ground-paths', 'line-opacity', 1);
  window.__map.setPaintProperty('ground-areas', 'fill-color', '#00ffcc');
  window.__map.triggerRepaint();
});
await page.waitForTimeout(2500);
const f1 = path.resolve('shots/probe-magenta.png');
await page.screenshot({ path: f1, timeout: 120000 });
await page.waitForTimeout(600);
await page.screenshot({ path: f1, timeout: 120000 });
console.log('WROTE', f1);

// Count magenta pixels — proof of presence independent of my eyes.
const px = await page.evaluate(() => {
  const cv = window.__map.getCanvas();
  const gl = cv.getContext('webgl2') || cv.getContext('webgl');
  const w = cv.width, h = cv.height;
  const buf = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  let mag = 0, teal = 0;
  for (let i = 0; i < buf.length; i += 4) {
    const r = buf[i], g = buf[i + 1], b = buf[i + 2];
    if (r > 180 && g < 90 && b > 180) mag++;
    if (r < 90 && g > 170 && b > 140) teal++;
  }
  return { total: w * h, magentaPx: mag, tealPx: teal,
           magentaPct: +(100 * mag / (w * h)).toFixed(2), tealPct: +(100 * teal / (w * h)).toFixed(2) };
});
console.log('PIXELS', JSON.stringify(px));
await browser.__done();
