/**
 * places-glass-tile-shots.mjs — render the ACTUAL registered `pl-glass`
 * MapLibre atlas image at several PLACES_SOFTEN radii, scaled up, so the
 * mullion pattern can be read by eye directly rather than hunted for in a
 * full 3D scene where trees/occlusion make a 1.9 m-spaced mullion band hard
 * to spot at all. Same source of truth as places-glass-variance.mjs (reads
 * map.style.imageManager.images['pl-glass'] directly, the actual bytes the
 * fragment shader samples), just rendered instead of just measured.
 *
 * Usage: VERIFY_URL=http://127.0.0.1:PORT node places-glass-tile-shots.mjs
 */
import { chromium } from 'playwright-core';
import { BASE as SERVER, launch } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';

const outDir = path.resolve('shots');
fs.mkdirSync(outDir, { recursive: true });

const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.goto(SERVER + '/_harness.html?intro=0&drift=0', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
await page.waitForFunction(() => typeof window.placesTileSample === 'function' && window.PLACES_SOFTEN, null, { timeout: 30000 });
await page.waitForTimeout(3000);

const SCALE = 10; // 64px tile -> 640px PNG, nearest-neighbour (no interpolation added)

for (const r of [0, 1, 2, 3, 6]) {
  const dataUrl = await page.evaluate(({ r, SCALE }) => {
    const p0 = window.__todCurrentP != null ? window.__todCurrentP : 0.3;
    window.PLACES_SOFTEN.RADIUS.plGlass = r;
    window.PLACES_SOFTEN.AMOUNT.plGlass = 1.0;
    window.applyPlacesColors(window.__map, p0);
    const im = window.__map.style.imageManager;
    const img = im.images['pl-glass'];
    const rgba = img.data.data, w = img.data.width, h = img.data.height;
    const src = document.createElement('canvas');
    src.width = w; src.height = h;
    const sctx = src.getContext('2d');
    const id = sctx.createImageData(w, h);
    id.data.set(rgba);
    sctx.putImageData(id, 0, 0);
    const dst = document.createElement('canvas');
    dst.width = w * SCALE; dst.height = h * SCALE;
    const dctx = dst.getContext('2d');
    dctx.imageSmoothingEnabled = false;
    dctx.drawImage(src, 0, 0, dst.width, dst.height);
    return dst.toDataURL('image/png');
  }, { r, SCALE });
  const file = path.join(outDir, `places-glass-tile-r${r}.png`);
  fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log('WROTE', file);
}

await browser.__done();
