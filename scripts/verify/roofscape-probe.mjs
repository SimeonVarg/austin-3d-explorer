/**
 * roofscape-probe.mjs — what colour does a deck ACTUALLY come out on screen?
 *
 * "The roofs look too brown" is a claim about pixels, so read the pixels. This
 * pairs the hex the bake TYPED into `rd` for a deck with the RGB that deck
 * renders as, at the product's own default hour and graphics preset, and prints
 * the transfer between them.
 *
 * It exists because two separate things move a roof's colour between the bake
 * and the frame, and neither is guessable:
 *   1. an extrusion's top face picks up the sun tint, so it renders warmer than
 *      the value typed — the stadium bake measured a neutral #c9bdaa (R/B 1.18)
 *      coming back at R/B 1.85, and entered its tones COOL to land neutral;
 *   2. graphics.js runs a colour grade (exposure / contrast / saturation /
 *      filmic curve) over the finished frame.
 * The DECK_COOL and DST_LO/DST_HI constants in scripts/bake_roofscape.py are
 * set from what this prints, not from taste.
 *
 * Pairing is done with queryRenderedFeatures at each sample point rather than
 * by projecting a centroid: it needs no projection maths and it can never pair
 * a pixel with a feature that something else is drawn on top of.
 *
 * Usage: node roofscape-probe.mjs [--p 0.32] [--zoom 16.9]
 */
import { chromium } from 'playwright-core';
import { chromePath, BASE as SERVER } from './chrome.mjs';
import path from 'node:path';

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? parseFloat(process.argv[i + 1]) : d;
};
const P = arg('--p', 0.32);
const ZOOM = arg('--zoom', 16.9);

const browser = await chromium.launch({
  executablePath: chromePath(), headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--ignore-gpu-blocklist', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
// _harness.html forces preserveDrawingBuffer, which is the only way to read the
// GL canvas back out at all.
await page.goto(SERVER + '/_harness.html?intro=0&drift=0', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
await page.waitForTimeout(4000);
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
await page.addScriptTag({ path: path.resolve('../../js/roofs.js') });
await page.waitForFunction(() => {
  const m = window.__map;
  return m.getSource('austin-roofscape') && m.isSourceLoaded('austin-roofscape');
}, null, { timeout: 60000 });

const out = await page.evaluate(async ([p, zoom]) => {
  const m = window.__map;
  if (window.GFX && window.GFX_PRESETS) { Object.assign(window.GFX, window.GFX_PRESETS.cinematic); window.applyGraphics(); }
  m.jumpTo({ center: [-97.7464, 30.2872], zoom, pitch: 0, bearing: 0 });
  window.applyTimeOfDay(m, p);
  await new Promise(r => setTimeout(r, 3500));
  await new Promise(r => { if (m.loaded()) r(); else m.once('idle', r); });
  m.triggerRepaint();
  await new Promise(r => setTimeout(r, 1200));

  const c = m.getCanvas();
  const off = document.createElement('canvas');
  off.width = c.width; off.height = c.height;
  const g = off.getContext('2d');
  g.drawImage(c, 0, 0);
  const sx = c.width / c.clientWidth, sy = c.height / c.clientHeight;

  const rows = [];
  for (let x = 30; x < c.clientWidth - 30; x += 11) {
    for (let y = 30; y < c.clientHeight - 30; y += 11) {
      const f = m.queryRenderedFeatures([x, y], { layers: ['roofscape-deck'] });
      if (!f.length) continue;
      // Skip anything a clutter box or a tree is drawn over: we want the deck.
      if (m.queryRenderedFeatures([x, y], { layers: ['roofscape-major', 'roofscape-minor', 'trees-canopy'] }).length) continue;
      const d = g.getImageData(Math.round(x * sx), Math.round(y * sy), 1, 1).data;
      rows.push({ rd: f[0].properties.rd, r: d[0], g: d[1], b: d[2] });
    }
  }
  return rows;
}, [P, ZOOM]);

const hx = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const lum = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;
const med = a => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

console.log(`p=${P} zoom=${ZOOM} preset=cinematic   samples=${out.length}`);
if (!out.length) { console.log('NO DECK PIXELS — layer missing or camera wrong'); await browser.close(); process.exit(1); }

// Bucket by typed luma so the transfer curve is visible, not just an average.
const buckets = [[0, 100], [100, 125], [125, 150], [150, 175], [175, 255]];
console.log('');
console.log('typed luma   n     typed RGB        rendered RGB     lum in->out   R/B in->out');
for (const [lo, hi] of buckets) {
  const sel = out.filter(o => { const L = lum(hx(o.rd)); return L >= lo && L < hi; });
  if (sel.length < 4) continue;
  const ti = [0, 1, 2].map(i => med(sel.map(o => hx(o.rd)[i])));
  const ro = [med(sel.map(o => o.r)), med(sel.map(o => o.g)), med(sel.map(o => o.b))];
  console.log(
    `${String(lo).padStart(3)}-${String(hi).padEnd(4)} ${String(sel.length).padStart(5)}   ` +
    `(${ti.map(v => String(v).padStart(3)).join(',')})    (${ro.map(v => String(v).padStart(3)).join(',')})    ` +
    `${lum(ti).toFixed(0).padStart(3)} -> ${lum(ro).toFixed(0).padStart(3)}    ` +
    `${(ti[0] / Math.max(ti[2], 1)).toFixed(2)} -> ${(ro[0] / Math.max(ro[2], 1)).toFixed(2)}`);
}
const allT = [0, 1, 2].map(i => med(out.map(o => hx(o.rd)[i])));
const allR = [med(out.map(o => o.r)), med(out.map(o => o.g)), med(out.map(o => o.b))];
console.log('');
console.log(`OVERALL  typed (${allT})  ->  rendered (${allR})`);
console.log(`         luma  ${lum(allT).toFixed(1)} -> ${lum(allR).toFixed(1)}   ` +
            `(gain ${(lum(allR) / lum(allT)).toFixed(2)})`);
console.log(`         R/B   ${(allT[0] / allT[2]).toFixed(2)} -> ${(allR[0] / allR[2]).toFixed(2)}   ` +
            `(warm shift ${((allR[0] / allR[2]) / (allT[0] / allT[2])).toFixed(2)}x)`);
await browser.close();
