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

    // MAGNIFICATION IS PER TEXEL, NOT PER TILE, and it has to be.
    // A measured family's image is `mul` times larger per axis than its
    // template's (js/facades.js MEASURED_MUL) and covers `mul` times more WALL,
    // so drawing both into the same square would show a 4x tile's windows at a
    // quarter size and the sheet would say the openings shrank when they did
    // not. Same texels per screen pixel for every tile: the measured tile comes
    // out physically bigger on the sheet, which is what it is.
    const Z = 6;                              // screen px per TEXEL
    const COLS = 2, PAD = 46;
    const items = [];
    for (const m of doc.buildings) {
      const props = byId.get(m.id);
      if (!props) continue;
      items.push({ ref: m.ref, wp: props.wp, twin: m.base + props.wp.slice(-2) });
    }
    // Measure every tile first — cells are no longer a fixed size.
    for (const it of items) {
      const a = map.getImage(it.wp), b = map.getImage(it.twin);
      it.aw = a ? a.data.width * Z : 0; it.ah = a ? a.data.height * Z : 0;
      it.bw = b ? b.data.width * Z : 0; it.bh = b ? b.data.height * Z : 0;
      it.cw = it.aw + it.bw; it.ch = Math.max(it.ah, it.bh);
    }
    const colW = [];
    const rowH = [];
    items.forEach((it, i) => {
      const c = i % COLS, r = Math.floor(i / COLS);
      colW[c] = Math.max(colW[c] || 0, it.cw);
      rowH[r] = Math.max(rowH[r] || 0, it.ch);
    });
    const colX = []; let ax = PAD;
    for (let c = 0; c < COLS; c++) { colX[c] = ax; ax += colW[c] + PAD; }
    const rowY = []; let ay = PAD;
    for (let r = 0; r < rowH.length; r++) { rowY[r] = ay; ay += rowH[r] + PAD * 2; }
    const cv = document.createElement('canvas');
    cv.width = ax;
    cv.height = ay;
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#101014'; g.fillRect(0, 0, cv.width, cv.height);
    g.font = '20px monospace'; g.textBaseline = 'top';

    const put = (img, x, y) => {
      const { width: W, height: H, data } = img.data;
      const id = new ImageData(new Uint8ClampedArray(data), W, H);
      const tmp = document.createElement('canvas'); tmp.width = W; tmp.height = H;
      tmp.getContext('2d').putImageData(id, 0, 0);
      g.drawImage(tmp, 0, 0, W, H, x, y, W * Z, H * Z);
    };

    items.forEach((it, i) => {
      const cx = colX[i % COLS];
      const cy = rowY[Math.floor(i / COLS)];
      const a = map.getImage(it.wp), b = map.getImage(it.twin);
      // LEFT = the measured tile, RIGHT = the template tile it replaced, same
      // colour bucket. Side by side is the whole point: a claim that a tile
      // changed is checkable in one glance.
      if (a) put(a, cx, cy + 26);
      if (b) put(b, cx + it.aw, cy + 26);
      g.fillStyle = '#ffcc55';
      g.fillText(`${it.ref}  ${it.wp}  ${a ? a.data.width + 'px' : '-'}`, cx, cy);
      g.fillStyle = '#8899aa';
      g.fillText(`was ${it.twin}  ${b ? b.data.width + 'px' : '-'}`, cx + it.aw, cy);
      g.strokeStyle = '#ffcc55'; g.lineWidth = 2;
      g.strokeRect(cx, cy + 26, it.aw, it.ah);
      g.strokeStyle = '#556'; g.strokeRect(cx + it.aw, cy + 26, it.bw, it.bh);
    });
    return cv.toDataURL('image/png');
  }, P);

  const file = path.join(OUT, `measured-vs-template-p${P}.png`);
  fs.writeFileSync(file, Buffer.from(sheet.split(',')[1], 'base64'));
  console.log('wrote', file);
} finally {
  browser.__done();
}
