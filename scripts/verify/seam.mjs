/**
 * seam.mjs — WHICH layer paints the hard line across the sky, and which
 * constant sets how hard it is. §48's magenta/knockout mask, with a dose.
 *
 * The dress rehearsal (`docs/aws/go-nogo.md` item 3) reported "a straight
 * horizontal seam running the full width of the frame" in the very wide. This
 * project has answered a complaint that shape twice before and both times the
 * culprit was a SCREEN-ROW element rather than the scene — `#fx-dof`, a CSS
 * blur band pinned to a fixed row, and the old `#haze` DOM bar
 * (`horizon-probe.mjs`). Both are gone now, so the first job is to find out what
 * paints those pixels TODAY. The answer is written up in `docs/aws/seam.md`.
 *
 * A knockout that changes nothing is the same shape as a fixed defect, so every
 * knockout here ALSO reports how many pixels of the whole frame it moved. The
 * DOM row is the one that matters: hiding the entire `#sky` stack moves ZERO
 * pixels at this pose, and the number is printed so nobody has to take that on
 * trust.
 *
 * The hypothesis the doses test: the sky at the horizon is `horizon-color`,
 * but the far GROUND fades to `fogColour()` = `mix(horizon-color, sky-color,
 * HAZE.SKY_MIX)` and only gets `HAZE.MAX` of the way there — deliberately, on
 * both counts ("a horizon band that matches the ground exactly reads as one
 * flat wall"). If that is right, both are doses: SKY_MIX 0 should shrink the
 * step and 0.5 grow it, and MAX 1.0 should close it outright.
 *
 * Usage: node seam.mjs [outDir] [--url=...] [--p=0.5] [--pose=wide]
 *        Defaults to the LIVE site, which is what the camera sees.
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
const P = parseFloat(flag('p', '0.5'));
const W = 1600, H = 1000;
fs.mkdirSync(outDir, { recursive: true });

const POSES = {
  wide:   { center: [-97.7400, 30.2960], zoom: 13.9, pitch: 79, bearing: 200 },
  spawn:  { center: [-97.7434, 30.2857], zoom: 16.5, pitch: 74, bearing: 250 },
  cruise: { center: [-97.7420, 30.2790], zoom: 15.2, pitch: 78, bearing: 178 },
};
const POSE = POSES[flag('pose', 'wide')];

function decodePNG(buf) {
  let off = 8, w = 0, h = 0, bd = 0, ct = 0; const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (bd !== 8) throw new Error('bit depth ' + bd);
  const ch = ct === 6 ? 4 : ct === 2 ? 3 : ct === 0 ? 1 : ct === 4 ? 2 : 0;
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
const rowMeans = ({ w, h, ch, data }) => {
  const rows = [];
  for (let y = 0; y < h; y++) { let r = 0, g = 0, b = 0;
    for (let x = 0; x < w; x++) { const i = (y * w + x) * ch; r += data[i]; g += data[i + 1]; b += data[i + 2]; }
    rows.push([r / w, g / w, b / w]); }
  return rows;
};
const deriv = rows => { const d = [0];
  for (let y = 1; y < rows.length; y++) d.push(Math.abs(rows[y][0] - rows[y - 1][0]) + Math.abs(rows[y][1] - rows[y - 1][1]) + Math.abs(rows[y][2] - rows[y - 1][2]));
  return d; };
function topSpikes(d, y0, y1, n = 5, sep = 4) {
  const c = []; for (let y = Math.max(1, y0); y < Math.min(d.length, y1); y++) c.push([y, d[y]]);
  c.sort((a, b) => b[1] - a[1]); const out = [];
  for (const [y, v] of c) { if (out.some(o => Math.abs(o.y - y) < sep)) continue; out.push({ y, v: +v.toFixed(2) }); if (out.length >= n) break; }
  return out;
}
function pxDiff(A, B, thr = 0) {
  let n = 0, mx = 0;
  for (let i = 0; i < A.data.length; i += A.ch) {
    const d = Math.max(Math.abs(A.data[i] - B.data[i]), Math.abs(A.data[i + 1] - B.data[i + 1]), Math.abs(A.data[i + 2] - B.data[i + 2]));
    if (d > thr) n++; if (d > mx) mx = d;
  }
  return { n, mx };
}
const hex = (img, x, y) => { const i = (y * img.w + x) * img.ch;
  return '#' + [img.data[i], img.data[i + 1], img.data[i + 2]].map(v => v.toString(16).padStart(2, '0')).join(''); };

const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const errs = []; page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
const url = `${URL_BASE}${URL_BASE.includes('?') ? '&' : '?'}clip=1&preset=cinematic&drift=0&intro=0`;
console.log('URL:', url, '\nchrome:', chromePath(), '\npose:', JSON.stringify(POSE), 'p=', P);
await page.goto(url, { waitUntil: 'networkidle', timeout: 180000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 180000 });
await page.waitForFunction(() => { const m = window.__map; return m && m.getSource('austin-buildings') && m.getSource('austin-outer'); }, null, { timeout: 180000 });

async function settle(ms = 6000) {
  await page.evaluate(a => {
    window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect();
    if (window.GFX) window.GFX.autoExposure = false;
    window.__map.jumpTo({ center: a.pose.center, zoom: a.pose.zoom, pitch: a.pose.pitch, bearing: a.pose.bearing });
    window.applyTimeOfDay(window.__map, a.p, true);
    window.updateSky && window.updateSky(window.__map, a.p);
    window.__map.triggerRepaint();
  }, { pose: POSE, p: P });
  await page.waitForFunction(() => window.__map.loaded() && window.__map.areTilesLoaded(), null, { timeout: 180000 }).catch(() => {});
  await page.waitForTimeout(ms);
}
async function shoot(tag) {
  await page.screenshot();
  const buf = await page.screenshot();
  fs.writeFileSync(path.join(outDir, tag + '.png'), buf);
  const img = decodePNG(buf), rows = rowMeans(img);
  return { img, rows, d: deriv(rows) };
}

await settle();
const R1 = await shoot('S2-ref-r1');
const R2 = await shoot('S2-ref-r2');
const band = [0, Math.round(H * 0.55)];
const floorPx = pxDiff(R1.img, R2.img);
const seamRow = topSpikes(R2.d, ...band, 1)[0].y;
console.log('\n== NOISE FLOOR: two captures, same page ==');
console.log('  pixels differing at all:', floorPx.n, ' max channel delta:', floorPx.mx);
console.log('  d[seam] r1 =', R2.d[seamRow].toFixed(2), ' r2 =', R1.d[seamRow].toFixed(2));
console.log('\nSEAM ROW', seamRow);
for (let y = seamRow - 3; y <= seamRow + 3; y++)
  console.log(`   row ${y}  mean ${R2.rows[y].map(v => v.toFixed(1)).join(',')}   x=200 ${hex(R2.img, 200, y)}  x=800 ${hex(R2.img, 800, y)}  x=1400 ${hex(R2.img, 1400, y)}`);
const REF = R2.d[seamRow];

const REDRAW = `window.applyTimeOfDay(window.__map, ${P}, true); window.updateSky && window.updateSky(window.__map, ${P}); window.__map.jumpTo({center:[${POSE.center}],zoom:${POSE.zoom},pitch:${POSE.pitch},bearing:${POSE.bearing}}); window.__map.triggerRepaint();`;

const KO = [
  ['K1-domsky-off',   `document.getElementById('sky').style.visibility='hidden';`,
                      `document.getElementById('sky').style.visibility='';`],
  ['K2-skymix-0',     `window.HAZE_TUNE.SKY_MIX=0; ${REDRAW}`,      `window.HAZE_TUNE.SKY_MIX=0.22; ${REDRAW}`],
  ['K3-skymix-0.5',   `window.HAZE_TUNE.SKY_MIX=0.5; ${REDRAW}`,    `window.HAZE_TUNE.SKY_MIX=0.22; ${REDRAW}`],
  ['K4-hazemax-1',    `window.HAZE_TUNE.MAX.golden=1.0; ${REDRAW}`, `window.HAZE_TUNE.MAX.golden=0.58; ${REDRAW}`],
  ['K5-mix0-max1',    `window.HAZE_TUNE.SKY_MIX=0; window.HAZE_TUNE.MAX.golden=1.0; ${REDRAW}`,
                      `window.HAZE_TUNE.SKY_MIX=0.22; window.HAZE_TUNE.MAX.golden=0.58; ${REDRAW}`],
  ['K6-fog-off',      `window.HAZE_TUNE.on=false; if(window.__map.getLayer('austin-fog')) window.__map.removeLayer('austin-fog'); ${REDRAW}`,
                      `window.HAZE_TUNE.on=true; ${REDRAW}`],
  ['K7-blend-0.3',    `window.__map.setSky(Object.assign({}, window.__map.getSky(), {'sky-horizon-blend':0.3}));`,
                      REDRAW],
];

const out = [];
for (const [tag, on, off] of KO) {
  try { await page.evaluate(`(()=>{${on}})()`); } catch (e) { console.log('SKIP', tag, e.message); continue; }
  await page.waitForTimeout(3000);
  const s = await shoot(tag);
  const moved = pxDiff(R2.img, s.img);
  const rec = { tag, dSeam: +s.d[seamRow].toFixed(2), ref: +REF.toFixed(2),
                pixelsMoved: moved.n, maxDelta: moved.mx,
                above: hex(s.img, 800, seamRow - 1), below: hex(s.img, 800, seamRow),
                top: topSpikes(s.d, ...band) };
  out.push(rec);
  console.log(`\n${tag}\n  d[${seamRow}] ${rec.dSeam}  (ref ${rec.ref})   pixels moved by the knockout: ${moved.n} (max ${moved.mx})` +
              `\n  x=800  above ${rec.above}  below ${rec.below}   top spikes ${JSON.stringify(rec.top)}`);
  try { await page.evaluate(`(()=>{${off}})()`); } catch (e) { console.log('  restore FAILED', e.message); }
  await page.waitForTimeout(3000);
  const back = await shoot('_restore-' + tag);
  const drift = pxDiff(R2.img, back.img);
  console.log(`  after restore: d[${seamRow}] ${back.d[seamRow].toFixed(2)}  drift vs ref ${drift.n} px`);
  rec.restoredD = +back.d[seamRow].toFixed(2); rec.restoreDriftPx = drift.n;
  fs.unlinkSync(path.join(outDir, '_restore-' + tag + '.png'));
}

fs.writeFileSync(path.join(outDir, 'seam2.json'), JSON.stringify(
  { url, pose: POSE, p: P, W, H, seamRow, refSpike: +REF.toFixed(2), noiseFloorPx: floorPx, knockouts: out, errors: errs }, null, 2));
console.log('\nerrors:', errs.length ? errs : 'none');
await browser.close();
