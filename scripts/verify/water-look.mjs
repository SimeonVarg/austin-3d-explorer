/**
 * water-look.mjs — stills of the water bodies at named poses (exploration aid
 * for water-flicker.mjs; see docs/water-flicker.md).
 *
 *   node water-look.mjs <poses.json> <outDir> [--q=lite=1] [--vp=430x932]
 *
 * Each pose: {name, center, zoom, pitch, bearing, p}
 * Writes <outDir>/<name>.jpg and prints the style's water-ish layers once.
 */
import { chromium } from 'playwright-core';
import { BASE as SERVER, launch } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';

const POSES = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const OUT = path.resolve(process.argv[3] || 'water-look');
const Q = (process.argv.find(a => a.startsWith('--q=')) || '').slice(4);
const [VW, VH] = ((process.argv.find(a => a.startsWith('--vp=')) || '--vp=1280x800').slice(5)).split('x').map(Number);
fs.mkdirSync(OUT, { recursive: true });

const browser = await launch(chromium, { gl: process.env.VERIFY_GL || 'hardware', maxMs: 900000 });
const page = await browser.newPage({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('PAGEERR', e.message));
await page.goto(SERVER + '/_harness.html?intro=0&drift=0' + (Q ? '&' + Q : ''), { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
await page.waitForFunction(() => !document.getElementById('veil') || getComputedStyle(document.getElementById('veil')).opacity === '0', null, { timeout: 180000 }).catch(() => console.log('WARN veil'));
await page.waitForFunction(() => !window.slopesApartments || window.slopesApartments.readyToReveal(), null, { timeout: 120000 }).catch(() => console.log('WARN authored buildings not ready'));
await page.waitForTimeout(4000);

const info = await page.evaluate(() => {
  const m = window.__map;
  const L = m.getStyle().layers;
  const gl = m.getCanvas().getContext('webgl2');
  return {
    renderer: (() => { try { const e = gl.getExtension('WEBGL_debug_renderer_info'); return gl.getParameter(e.UNMASKED_RENDERER_WEBGL); } catch (e) { return '?'; } })(),
    depthBits: gl.getParameter(gl.DEPTH_BITS), samples: gl.getParameter(gl.SAMPLES),
    canvas: m.getCanvas().width + 'x' + m.getCanvas().height,
    water: L.map((l, i) => ({ i, id: l.id, type: l.type, src: l.source, sl: l['source-layer'], vis: (l.layout || {}).visibility }))
      .filter(l => /water|creek|sheen|channel|pond|ground-base|ground-areas|ground-texture|background/i.test(l.id + ' ' + (l.sl || ''))),
    n: L.length,
    gfx: window.GFX && { preset: window.GFX.preset, scale: window.GFX.renderScale, msaa: window.GFX.msaa },
  };
});
console.log(JSON.stringify(info, null, 1));

for (const s of POSES) {
  await page.evaluate((s) => {
    const m = window.__map;
    m.stop();
    m.jumpTo({ center: s.center, zoom: s.zoom, pitch: s.pitch, bearing: s.bearing });
    if (typeof s.p === 'number') window.applyTimeOfDay(m, s.p, true);
  }, s);
  await page.waitForTimeout(3000);
  await page.evaluate(() => new Promise(r => { const m = window.__map; if (m.loaded()) return r(); m.once('idle', r); setTimeout(r, 15000); }));
  for (let k = 0; k < 2; k++) {   // screenshot twice, trust the second
    await page.evaluate(() => window.__map.triggerRepaint());
    await page.waitForTimeout(600);
  }
  const url = await page.evaluate(() => window.__map.getCanvas().toDataURL('image/jpeg', 0.85));
  fs.writeFileSync(path.join(OUT, s.name + '.jpg'), Buffer.from(url.split(',')[1], 'base64'));
  console.log('shot', s.name);
}
browser.__done();
