/**
 * seam-where.mjs — WHERE the horizon step shows, so the avoidance can be a rule
 * rather than a feeling. Companion to `seam.mjs`; see `docs/aws/seam.md`.
 *
 * TWO THINGS ARE MEASURED, and only the second one varies.
 *
 * 1. The step is the same size at every framing — 13.5 to 15 luma across
 *    pitches 60-84 and zooms 13.9-16.5 — and it lands on the row the CAMERA
 *    puts the horizon at, not on a fixed screen row. That is the whole reason
 *    the row is PREDICTED here from the pitch rather than hunted for: the
 *    predicted row and the found row agreed to within 1 px at every pitch
 *    tried, which is what rules out the `#fx-dof` family of defect.
 *
 * 2. What actually changes between "there is a line drawn across the sky" and
 *    "that is just the horizon" is whether the rows below it are the same
 *    colour all the way across. So the spread (standard deviation of luma over
 *    the full width, averaged over the six rows under the seam) is reported
 *    next to the step. Low spread = an empty far field and a visible line;
 *    high spread = city, and the identical step disappears into it.
 *
 * Usage: node seam-where.mjs [outDir] [--url=...]
 */
import { chromium } from 'playwright-core';
import { chromePath, launch } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const args = process.argv.slice(2);
const flag = (k, d) => { const a = args.find(s => s.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const URL_BASE = flag('url', 'https://flyover-utx.vercel.app/');
const outDir = path.resolve(args.find(a => !a.startsWith('--')) || 'shots/seam');
const W = 1600, H = 1000;
fs.mkdirSync(outDir, { recursive: true });

// Focal length in px at H=1000, solved from seven independent readings taken at
// pitches 60/66/70/72/74/76/79: every seam row those found solves to 708 +/-
// 1.2 px. It also agrees with the app's own horizon formula — banding.mjs
// computes `hz = 0.5 - 0.5*tan(90-pitch)/tan(fov/2)`, which at pitch 79 gives
// row 362.4 against the 362 measured here. Two independent derivations of the
// same line is why the row is PREDICTED below rather than hunted for.
const FOCAL = 708.2;

const CASES = [
  ['Q-z13.9-p79', { center: [-97.7400, 30.2960], zoom: 13.9, pitch: 79, bearing: 200 }, 0.50],
  ['Q-z14.6-p79', { center: [-97.7400, 30.2960], zoom: 14.6, pitch: 79, bearing: 200 }, 0.50],
  ['Q-z15.3-p79', { center: [-97.7400, 30.2960], zoom: 15.3, pitch: 79, bearing: 200 }, 0.50],
  ['Q-z16.0-p79', { center: [-97.7400, 30.2960], zoom: 16.0, pitch: 79, bearing: 200 }, 0.50],
  ['Q-z16.5-p74', { center: [-97.7434, 30.2857], zoom: 16.5, pitch: 74, bearing: 250 }, 0.50],
  ['Q-z13.9-p84', { center: [-97.7400, 30.2960], zoom: 13.9, pitch: 84, bearing: 200 }, 0.50],
];

function decodePNG(buf) {
  let off = 8, w = 0, h = 0, bd = 0, ct = 0; const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9]; }
    else if (type === 'IDAT') idat.push(data); else if (type === 'IEND') break;
    off += 12 + len;
  }
  const ch = ct === 6 ? 4 : ct === 2 ? 3 : ct === 0 ? 1 : 2;
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * ch, out = Buffer.alloc(w * h * ch);
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[pos++], line = raw.subarray(pos, pos + stride); pos += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, b = prev ? prev[i] : 0, c = (prev && i >= ch) ? prev[i - ch] : 0;
      let v = line[i];
      if (ft === 1) v += a; else if (ft === 2) v += b; else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
      cur[i] = v & 255;
    }
  }
  return { w, h, ch, data: out };
}
const L = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const errs = []; page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
const url = `${URL_BASE}${URL_BASE.includes('?') ? '&' : '?'}clip=1&preset=cinematic&drift=0&intro=0`;
await page.goto(url, { waitUntil: 'networkidle', timeout: 180000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 180000 });
await page.waitForFunction(() => { const m = window.__map; return m && m.getSource('austin-buildings') && m.getSource('austin-outer'); }, null, { timeout: 180000 });
console.log('chrome:', chromePath(), '\n');
console.log('case            pitch  zoom   predicted-hz  found-hz  step(luma)  spread-below(luma sd)');

const rows = [];
for (const [tag, pose, p] of CASES) {
  await page.evaluate(a => {
    window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect();
    if (window.GFX) window.GFX.autoExposure = false;
    window.__map.jumpTo({ center: a.pose.center, zoom: a.pose.zoom, pitch: a.pose.pitch, bearing: a.pose.bearing });
    window.applyTimeOfDay(window.__map, a.p, true);
  }, { pose, p });
  await page.waitForFunction(() => window.__map.loaded() && window.__map.areTilesLoaded(), null, { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(5000);
  await page.screenshot();
  const buf = await page.screenshot();
  fs.writeFileSync(path.join(outDir, tag + '.png'), buf);
  const img = decodePNG(buf);

  const rm = [];
  for (let y = 0; y < H; y++) { let r = 0, g = 0, b = 0;
    for (let x = 0; x < W; x++) { const i = (y * W + x) * img.ch; r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; }
    rm.push(L(r / W, g / W, b / W)); }

  const predicted = H / 2 - FOCAL * Math.tan((90 - pose.pitch) * Math.PI / 180);
  let best = { y: -1, d: -1 };
  for (let y = Math.max(2, Math.round(predicted) - 10); y <= Math.min(H - 8, Math.round(predicted) + 10); y++) {
    const d = Math.abs(rm[y] - rm[y - 1]); if (d > best.d) best = { y, d };
  }
  // spread of luma across the width, averaged over the six rows below the seam
  let sd = 0;
  for (let y = best.y; y < best.y + 6; y++) {
    let m = 0; for (let x = 0; x < W; x++) { const i = (y * W + x) * img.ch; m += L(img.data[i], img.data[i + 1], img.data[i + 2]); }
    m /= W;
    let v = 0; for (let x = 0; x < W; x++) { const i = (y * W + x) * img.ch; const d = L(img.data[i], img.data[i + 1], img.data[i + 2]) - m; v += d * d; }
    sd += Math.sqrt(v / W);
  }
  sd /= 6;
  const rec = { tag, pitch: pose.pitch, zoom: pose.zoom, predictedRow: +predicted.toFixed(1),
                foundRow: best.y, stepLuma: +best.d.toFixed(2), spreadBelow: +sd.toFixed(2) };
  rows.push(rec);
  console.log(`${tag.padEnd(15)} ${String(pose.pitch).padStart(3)}  ${String(pose.zoom).padStart(5)}  ` +
              `${String(rec.predictedRow).padStart(11)}  ${String(rec.foundRow).padStart(8)}  ${String(rec.stepLuma).padStart(10)}  ${String(rec.spreadBelow).padStart(10)}`);
}
fs.writeFileSync(path.join(outDir, 'seam4.json'), JSON.stringify({ url, W, H, focalPx: FOCAL, cases: rows, errors: errs }, null, 2));
console.log('\nerrors:', errs.length ? errs : 'none');
await browser.close();
