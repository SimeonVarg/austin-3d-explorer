/**
 * night-variety.mjs — measure lit-window colour variety in a screenshot.
 *
 * Usage: node night-variety.mjs <shot.png> [more.png ...]
 *
 * For each PNG: crops a fixed building band (skips sky, HUD, slider), keeps
 * pixels bright enough to be lit panes (luma > LIT_LUMA), bins their hue, and
 * prints: lit-pixel share, distinct hue bins holding >= MIN_SHARE of the lit
 * pixels, the hue histogram, and the mean luma of the whole crop (the
 * luminance-parity guard — variety was the goal, not brightness).
 *
 * The same crop + thresholds on before/after shots of the SAME pose makes the
 * "more colour temperatures now" claim a number instead of an impression.
 */
import { chromium } from 'playwright-core';
import { chromePath, launch } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';

const CROP = { x: 60, y: 200, w: 1280, h: 630 };  // building band in a 1440x900 shot
const LIT_LUMA = 60;      // below this a pixel is wall/road/shadow, not a lit pane
const HUE_BINS = 24;      // 15° per bin
const MIN_SHARE = 0.005;  // a bin must hold >= 0.5% of lit pixels to count

const files = process.argv.slice(2);
if (!files.length) { console.error('usage: node night-variety.mjs <shot.png> ...'); process.exit(1); }

const browser = await launch(chromium);
const page = await browser.newPage();

for (const f of files) {
  const b64 = fs.readFileSync(path.resolve(f)).toString('base64');
  const r = await page.evaluate(async ({ b64, CROP, LIT_LUMA, HUE_BINS }) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = CROP.w; cv.height = CROP.h;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, CROP.x, CROP.y, CROP.w, CROP.h, 0, 0, CROP.w, CROP.h);
    const d = ctx.getImageData(0, 0, CROP.w, CROP.h).data;
    const bins = new Array(HUE_BINS).fill(0);
    let lit = 0, total = 0, lumaSum = 0;
    for (let i = 0; i < d.length; i += 4) {
      const R = d[i], G = d[i+1], B = d[i+2];
      const luma = 0.2126*R + 0.7152*G + 0.0722*B;
      total++; lumaSum += luma;
      if (luma <= LIT_LUMA) continue;
      lit++;
      const mx = Math.max(R,G,B), mn = Math.min(R,G,B);
      if (mx === mn) { bins[0]++; continue; }  // greys land in bin 0 with reds; rare
      const dd = mx - mn;
      let h;
      if (mx === R)      h = ((G-B)/dd + (G < B ? 6 : 0));
      else if (mx === G) h = (B-R)/dd + 2;
      else               h = (R-G)/dd + 4;
      bins[Math.min(HUE_BINS-1, Math.floor(h/6 * HUE_BINS))]++;
    }
    return { bins, lit, total, meanLuma: lumaSum/total };
  }, { b64, CROP, LIT_LUMA, HUE_BINS });

  const shares = r.bins.map(n => n / Math.max(1, r.lit));
  const distinct = shares.filter(s => s >= MIN_SHARE).length;
  const hist = r.bins.map((n, i) => shares[i] >= MIN_SHARE ? `${i*15}°:${(shares[i]*100).toFixed(1)}%` : null)
    .filter(Boolean).join('  ');
  console.log(path.basename(f));
  console.log(`  lit pixels ${(100*r.lit/r.total).toFixed(2)}% of crop | crop mean luma ${r.meanLuma.toFixed(1)}`);
  console.log(`  distinct hue bins (>=0.5% of lit): ${distinct}`);
  console.log(`  ${hist}`);
}
await browser.__done();
