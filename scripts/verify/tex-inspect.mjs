/**
 * tex-inspect.mjs — look at ONE surface, with the texture on and off, at the
 * scale the camera actually flies at.
 *
 * The README's rule for "which layer owns this pixel" is: hide layers one at a
 * time and diff. This does that in a single browser session so iterating on a
 * tile costs one render, not four browser starts. It also dumps the raw tile
 * images at 4x so a defect in the TILE is not diagnosed as a defect in the MAP.
 *
 * Usage: node tex-inspect.mjs <outPrefix> <shots.json>
 *   Each shot renders three frames: -areas (fill only), -tex (pattern only),
 *   -both (what ships).
 */
import { chromium } from 'playwright-core';
import { chromePath, BASE as SERVER } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2] || 'tex';
const SHOTS = JSON.parse(fs.readFileSync(process.argv[3] || 'shots-tex.json', 'utf8'));
const outDir = path.resolve('shots');
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: chromePath(), headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--ignore-gpu-blocklist', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 820 }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('PAGEERR', e.message));

await page.goto(SERVER + '/_harness.html?intro=0&drift=0', { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 90000 });
await page.waitForTimeout(6000);
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

// Ground only, post stack off. A texture judged through bloom is a judgement
// about bloom.
await page.evaluate(() => {
  const m = window.__map;
  Object.assign(window.GFX, { bloom: 0, godRays: 0, flare: 0, dof: 0, grain: 0, vignette: 0 });
  window.applyGraphics();
  for (const l of m.getStyle().layers) {
    const keep = l.id.startsWith('ground-') || l.type === 'background' || /^sky|atmos|haze/.test(l.id);
    try { if (!keep) m.setLayoutProperty(l.id, 'visibility', 'none'); } catch (e) {}
  }
});

const MODES = {
  areas: ['ground-areas'],
  tex:   ['ground-texture'],
  both:  ['ground-areas', 'ground-texture', 'ground-road-casing', 'ground-road',
          'ground-road-lane', 'ground-paths-casing', 'ground-paths'],
};

for (const s of SHOTS) {
  for (const [mode, on] of Object.entries(MODES)) {
    await page.evaluate(({ s, on }) => {
      const m = window.__map;
      if (m.isEasing && m.isEasing()) m.stop();
      m.jumpTo({ center: s.center, zoom: s.zoom, pitch: s.pitch ?? 68, bearing: s.bearing ?? 0 });
      if (typeof s.p === 'number') window.applyTimeOfDay(m, s.p, true);
      for (const id of ['ground-areas', 'ground-texture', 'ground-road-casing', 'ground-road',
                        'ground-road-lane', 'ground-paths-casing', 'ground-paths']) {
        try { if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', on.includes(id) ? 'visible' : 'none'); } catch (e) {}
      }
    }, { s, on });
    await page.waitForTimeout(2200);
    await page.evaluate(() => new Promise(r => {
      const m = window.__map; if (m.loaded()) return r(); m.once('idle', r); setTimeout(r, 12000);
    }));
    await page.evaluate(() => window.__map.triggerRepaint());
    await page.waitForTimeout(900);
    const f = path.join(outDir, `${OUT}-${s.name}-${mode}.png`);
    await page.screenshot({ path: f });
    await page.waitForTimeout(450);
    await page.screenshot({ path: f });
    console.log('WROTE', f);
  }
}

// The tiles themselves, 4x nearest-neighbour, on a mid grey. If a tile has a
// seam or a motif, it is visible here and nowhere else.
const sheet = await page.evaluate(() => {
  const ids = ['gnd-tex-grass', 'gnd-tex-asphalt', 'gnd-tex-water', 'gnd-tex-paving'];
  const m = window.__map;
  const T = window.GROUND.texTile, S = 3, REP = 2;   // 3x zoom, tiled 2x2
  const cv = document.createElement('canvas');
  cv.width = ids.length * T * S * REP; cv.height = T * S * REP;
  const cx = cv.getContext('2d');
  cx.imageSmoothingEnabled = false;
  cx.fillStyle = '#8a8578'; cx.fillRect(0, 0, cv.width, cv.height);
  ids.forEach((id, i) => {
    const img = m.getImage ? m.getImage(id) : null;
    const data = img && (img.data || (img.sdf === false && img));
    if (!data) return;
    const tmp = document.createElement('canvas'); tmp.width = tmp.height = T;
    const tctx = tmp.getContext('2d');
    tctx.putImageData(new ImageData(new Uint8ClampedArray(data.data), T, T), 0, 0);
    for (let rx = 0; rx < REP; rx++) for (let ry = 0; ry < REP; ry++) {
      cx.drawImage(tmp, i * T * S * REP + rx * T * S, ry * T * S, T * S, T * S);
    }
  });
  return cv.toDataURL('image/png');
});
if (sheet && sheet.startsWith('data:image/png')) {
  fs.writeFileSync(path.join(outDir, `${OUT}-tiles.png`),
                   Buffer.from(sheet.split(',')[1], 'base64'));
  console.log('WROTE', path.join(outDir, `${OUT}-tiles.png`));
}
await browser.close();
