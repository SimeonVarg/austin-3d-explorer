/**
 * facadetile.mjs — write the ACTUAL registered atlas tiles out as PNGs, one
 * labelled sheet, magnified, so a grid can be checked BY EYE before anything
 * is tiled across a city.
 *
 * This is playbook step 6: disambiguate with ONE labelled render rather than
 * arguing about a count. `facadegrid.mjs` counts these same bytes
 * automatically; when the two disagree, this is how you find out which one is
 * wrong — and the first time they disagreed, it was the counter.
 *
 * Usage:
 *   node facadetile.mjs [outDir] [p]
 *     outDir  default: the system temp dir (these are working frames, not
 *             deliverables — CLAUDE.md rule 12)
 *     p       time of day, default 0.35 (full day, no lit panes)
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { BASE, launch } from './chrome.mjs';

const OUT = process.argv[2] || path.join(process.env.TEMP || '/tmp', 'facadetiles');
const P = process.argv[3] ? Number(process.argv[3]) : 0.35;
fs.mkdirSync(OUT, { recursive: true });

const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
try {
  await page.goto(`${BASE}/index.html`, { waitUntil: 'load', timeout: 120000 });
  await page.evaluate(() => { try { window.cancelGraphicsAutoDetect(); } catch (e) {} });
  await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded()
    && window.facadeMeasured, null, { timeout: 120000 });

  const sheet = await page.evaluate(async (p) => {
    const map = window.__map;
    window.applyTimeOfDay(map, p, true);
    await new Promise(r => setTimeout(r, 400));
    const feats = (await map.getSource('austin-buildings').getData()).features;
    const byId = new Map();
    for (const f of feats) if (f.properties && f.properties.id) byId.set(f.properties.id, f.properties);
    const doc = await fetch('data/facade_grids.json').then(r => r.json());

    const Z = 6;                              // magnification
    const COLS = 4, PAD = 46, CELL = 64 * Z;
    const items = [];
    for (const m of doc.buildings) {
      const props = byId.get(m.id);
      if (!props) continue;
      items.push({ ref: m.ref, wp: props.wp, twin: m.base + props.wp.slice(-2) });
    }
    const rows = Math.ceil(items.length / COLS);
    const cv = document.createElement('canvas');
    cv.width = COLS * (CELL * 2 + PAD) + PAD;
    cv.height = rows * (CELL + PAD * 2) + PAD;
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#101014'; g.fillRect(0, 0, cv.width, cv.height);
    g.font = '20px monospace'; g.textBaseline = 'top';

    const put = (img, x, y) => {
      const { width: W, height: H, data } = img.data;
      const id = new ImageData(new Uint8ClampedArray(data), W, H);
      const tmp = document.createElement('canvas'); tmp.width = W; tmp.height = H;
      tmp.getContext('2d').putImageData(id, 0, 0);
      g.drawImage(tmp, 0, 0, W, H, x, y, CELL, CELL);
    };

    items.forEach((it, i) => {
      const cx = PAD + (i % COLS) * (CELL * 2 + PAD);
      const cy = PAD + Math.floor(i / COLS) * (CELL + PAD * 2);
      const a = map.getImage(it.wp), b = map.getImage(it.twin);
      // LEFT = the measured tile, RIGHT = the template tile it replaced, same
      // colour bucket. Side by side is the whole point: a claim that a tile
      // changed is checkable in one glance.
      if (a) put(a, cx, cy + 26);
      if (b) put(b, cx + CELL, cy + 26);
      g.fillStyle = '#ffcc55'; g.fillText(`${it.ref}  ${it.wp}`, cx, cy);
      g.fillStyle = '#8899aa'; g.fillText(`was ${it.twin}`, cx + CELL, cy);
      g.strokeStyle = '#ffcc55'; g.lineWidth = 2;
      g.strokeRect(cx, cy + 26, CELL, CELL);
      g.strokeStyle = '#556'; g.strokeRect(cx + CELL, cy + 26, CELL, CELL);
    });
    return cv.toDataURL('image/png');
  }, P);

  const file = path.join(OUT, `measured-vs-template-p${P}.png`);
  fs.writeFileSync(file, Buffer.from(sheet.split(',')[1], 'base64'));
  console.log('wrote', file);
} finally {
  browser.__done();
}
