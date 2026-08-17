/**
 * seam-tour.mjs — does the 60-second tour ever hold a framing that shows the
 * horizon step? Companion to `seam.mjs` / `seam-where.mjs`; see
 * `docs/aws/seam.md`.
 *
 * The tour is the clip most likely to carry the video, and it flies itself, so
 * "don't hold a high wide" is advice nobody can follow while it is running. The
 * only honest way to know is to watch what the camera does.
 *
 * `seam-where.mjs` found the threshold: the line reads as a drawn line while the
 * ground under it is uniform, which happens above roughly z14.6, and disappears
 * into the city from about z15.3 down. So this samples the live camera twice a
 * second for the whole tour and reports every second the tour spends above each
 * of those zooms — and, because a number is not a picture, it grabs a frame at
 * the highest point it saw and measures the step there the same way
 * `seam-where.mjs` does.
 *
 * Usage: node seam-tour.mjs [outDir] [--url=...] [--secs=75]
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
const SECS = parseInt(flag('secs', '75'), 10);
const W = 1600, H = 1000, FOCAL = 708.2;
fs.mkdirSync(outDir, { recursive: true });

function decodePNG(buf) {
  let off = 8, w = 0, h = 0, ct = 0; const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; }
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
const url = `${URL_BASE}${URL_BASE.includes('?') ? '&' : '?'}clip=1&tour=1&preset=cinematic&drift=0`;
console.log('URL:', url, '\nchrome:', chromePath());

// THE POLLER GOES IN BEFORE THE PAGE DOES, and this is not a detail. The first
// cut of this file navigated with `waitUntil: networkidle`, waited for the
// sources, and only then started sampling — by which time `performance.now()`
// read 136 s and the 60-second tour had been over for more than a minute. It
// dutifully reported a camera that never moved, which is exactly what a tour
// that already finished looks like. An init script starts polling at document
// start, so t=0 is the page's own t=0.
await page.addInitScript(() => {
  window.__seamTrace = [];
  window.__seamTimer = setInterval(() => {
    const m = window.__map;
    if (!m || !m.getZoom) return;
    window.__seamTrace.push({ t: +(performance.now() / 1000).toFixed(2), z: +m.getZoom().toFixed(3),
                              pitch: +m.getPitch().toFixed(2), bearing: +m.getBearing().toFixed(1) });
  }, 500);
});
await page.goto(url, { waitUntil: 'commit', timeout: 180000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 180000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
console.log(`watching the tour for ${SECS}s from the page's own t=0...`);
await page.waitForTimeout(SECS * 1000);
const trace = await page.evaluate(() => { clearInterval(window.__seamTimer); return window.__seamTrace; });
if (!trace.length) throw new Error('no camera samples — the poller never saw window.__map');

// THE CADENCE IS NOT 500 ms AND THE REPORT MUST NOT PRETEND IT IS. The tour
// pins the main thread, so the timer starves: a real run produced 21 samples
// spread unevenly over 123 s, with gaps of up to 10 s. Counting samples and
// multiplying by the nominal interval would invent a duration. So what is
// reported is the sample COUNT, the span they actually cover, and the extremes
// — which is all this measurement can honestly support.
const n = trace.length;
const zs = trace.map(s => s.z);
const hi = trace.reduce((a, b) => (b.z < a.z ? b : a), trace[0]);
const overT = trace.filter(s => s.z < 14.6).length, doubtT = trace.filter(s => s.z < 15.3).length;
let maxGap = 0;
for (let i = 1; i < n; i++) maxGap = Math.max(maxGap, trace[i].t - trace[i - 1].t);
console.log(`\n${n} camera samples spanning t=${trace[0].t}s .. ${trace[n - 1].t}s ` +
            `(nominal interval 500 ms, largest actual gap ${maxGap.toFixed(1)} s — the tour starves the timer)`);
console.log(`zoom range: ${Math.min(...zs).toFixed(2)} (highest camera) .. ${Math.max(...zs).toFixed(2)} (lowest)`);
console.log(`samples above z14.6 (where the line reads as a line):  ${overT} of ${n}`);
console.log(`samples above z15.3 (the doubtful band):               ${doubtT} of ${n}`);
console.log(`highest point seen: t=${hi.t}s  z${hi.z}  pitch ${hi.pitch}  bearing ${hi.bearing}`);

// Go and look at that pose rather than trusting the number.
await page.evaluate(h => {
  window.__map.stop();
  window.__map.jumpTo({ zoom: h.z, pitch: h.pitch, bearing: h.bearing });
}, hi);
await page.waitForFunction(() => window.__map.loaded() && window.__map.areTilesLoaded(), null, { timeout: 120000 }).catch(() => {});
await page.waitForTimeout(5000);
await page.screenshot();
const buf = await page.screenshot();
fs.writeFileSync(path.join(outDir, 'tour-highest.png'), buf);
const img = decodePNG(buf);
const rm = [];
for (let y = 0; y < H; y++) { let r = 0, g = 0, b = 0;
  for (let x = 0; x < W; x++) { const i = (y * W + x) * img.ch; r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; }
  rm.push(L(r / W, g / W, b / W)); }
const predicted = H / 2 - FOCAL * Math.tan((90 - hi.pitch) * Math.PI / 180);
let best = { y: -1, d: -1 };
for (let y = Math.max(2, Math.round(predicted) - 10); y <= Math.min(H - 8, Math.round(predicted) + 10); y++) {
  const d = Math.abs(rm[y] - rm[y - 1]); if (d > best.d) best = { y, d };
}
let sd = 0;
for (let y = best.y; y < best.y + 6; y++) {
  let m = 0; for (let x = 0; x < W; x++) { const i = (y * W + x) * img.ch; m += L(img.data[i], img.data[i + 1], img.data[i + 2]); }
  m /= W;
  let v = 0; for (let x = 0; x < W; x++) { const i = (y * W + x) * img.ch; const d = L(img.data[i], img.data[i + 1], img.data[i + 2]) - m; v += d * d; }
  sd += Math.sqrt(v / W);
}
sd /= 6;
console.log(`\nat the tour's highest pose: horizon row predicted ${predicted.toFixed(1)}, found ${best.y}, ` +
            `step ${best.d.toFixed(2)} luma, spread below ${sd.toFixed(2)}`);

fs.writeFileSync(path.join(outDir, 'seam-tour.json'), JSON.stringify(
  { url, secs: SECS, samples: n, spanS: [trace[0].t, trace[n - 1].t], largestGapS: +maxGap.toFixed(1),
    minZoom: Math.min(...zs), maxZoom: Math.max(...zs),
    samplesAboveZ14_6: overT, samplesAboveZ15_3: doubtT, highest: hi,
    highestPose: { predictedRow: +predicted.toFixed(1), foundRow: best.y, stepLuma: +best.d.toFixed(2), spreadBelow: +sd.toFixed(2) },
    trace, errors: errs }, null, 2));
console.log('\nerrors:', errs.length ? errs : 'none');
await browser.close();
