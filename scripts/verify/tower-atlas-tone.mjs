/**
 * tower-atlas-tone.mjs — read the ACTUAL atlas tile for each downtown tower
 * bucket, so "the palette is blue-grey but the towers render warm" stops being
 * arithmetic and becomes a measurement.
 *
 * There are three places the colour can be lost between the bake and the frame:
 *   1. the baked `wd` on the feature            (bake_outer_facades.py --check)
 *   2. the atlas TILE drawn from it             (this script)
 *   3. the lit + graded pixel on screen         (downtown-tone.mjs)
 * Measuring only 1 and 3 leaves the middle one a guess, and §45 is a whole
 * entry about a probe that guessed and reported zero.
 *
 *   VERIFY_URL=http://127.0.0.1:8161 node scripts/verify/tower-atlas-tone.mjs
 */
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const TOD = parseFloat(opt('--tod', '0.30'));

const browser = await launch(chromium, { gl: 'hardware' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', e => console.log('  [pageerror] ' + e.message));
await page.goto(BASE + '/_harness.html?intro=0&drift=0', { waitUntil: 'networkidle', timeout: 180000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
await page.evaluate(v => {
  if (typeof window.applyTimeOfDay === 'function') window.applyTimeOfDay(window.__map, v, true);
}, TOD);
await page.waitForTimeout(3000);

const r = await page.evaluate(async () => {
  const m = window.__map;
  const pal = (window.facadePalette && window.facadePalette()) || [];
  const out = { tod: window.__todCurrentP, rows: [] };
  // Every registered image id, so we can find the tower family's without
  // assuming which palette indices it landed on.
  const ids = [];
  for (let i = 0; i < pal.length; i++) {
    const id = 'tg' + String(i).padStart(2, '0');
    if (m.hasImage && m.hasImage(id)) ids.push({ id, i });
  }
  const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
  for (const { id, i } of ids) {
    const img = m.getImage ? m.getImage(id) : null;
    const d = img && (img.data || (img.userImage && img.userImage.data));
    if (!d || !d.data) { out.rows.push({ id, i, err: 'no pixel data' }); continue; }
    const px = d.data, n = px.length / 4;
    let R = 0, G = 0, B = 0;
    for (let p = 0; p < n; p++) { R += px[p * 4]; G += px[p * 4 + 1]; B += px[p * 4 + 2]; }
    R /= n; G /= n; B /= n;
    out.rows.push({
      id, i, w: d.width, h: d.height,
      paletteWd: pal[i] && pal[i].wd,
      tileRgb: [Math.round(R), Math.round(G), Math.round(B)],
      tileLuma: +lum(R, G, B).toFixed(1),
      tileBminusR: +(B - R).toFixed(1),
    });
  }
  return out;
});

console.log(`tod ${r.tod}`);
console.log('the ATLAS TILE actually drawn for each downtown tower bucket:');
let sR = 0, sG = 0, sB = 0, k = 0;
for (const row of r.rows) {
  if (row.err) { console.log(`  ${row.id}  ${row.err}`); continue; }
  const p = row.paletteWd || '?';
  const pr = parseInt(p.slice(1, 3), 16), pb = parseInt(p.slice(5, 7), 16);
  console.log(`  ${row.id} ${String(row.w) + 'x' + row.h}  palette ${p} (B-R ${(pb - pr >= 0 ? '+' : '') + (pb - pr)})` +
              `  ->  tile rgb ${row.tileRgb.join(',')}  luma ${row.tileLuma}` +
              `  B-R ${row.tileBminusR >= 0 ? '+' : ''}${row.tileBminusR}`);
  sR += row.tileRgb[0]; sG += row.tileRgb[1]; sB += row.tileRgb[2]; k++;
}
if (k) {
  const L = (0.299 * sR + 0.587 * sG + 0.114 * sB) / k;
  console.log(`\n  unweighted mean tile: rgb ${Math.round(sR / k)},${Math.round(sG / k)},${Math.round(sB / k)}` +
              `  luma ${L.toFixed(1)}  B-R ${((sB - sR) / k).toFixed(1)}`);
  console.log('  (downtown-tone.mjs measures the SCREEN; the gap between them is lighting + grading)');
}
await browser.close();
