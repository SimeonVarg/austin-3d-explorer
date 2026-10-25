/**
 * v2-view-shots.mjs - the seven views of v2-aim-shots.mjs (the demo views + Calhoun's east face from the street), drawn by several
 * ARMS (a page path + query each), for "is the picture the same?" checks across versions or settings.
 *
 *   VERIFY_GL=hardware VERIFY_URL=http://127.0.0.1:8591 node scripts/verify/v2-view-shots.mjs OUT_DIR "v2/|v2-ref-base/|v2/?moment=IMG_1778" [view ...]
 *   An arm is a folder under the server ("v2/", or a v2-ref-<ref>/ folder extracted as v2-frame.mjs does) and an optional query.
 *   Writes OUT_DIR/<view>.<arm index>.png (1440x900 at device scale 2; tiles settled; drawn twice, the second kept) and prints, per
 *   view, the share of pixels that differ between arm 0 and each other arm (any channel > 2 levels) and their mean difference.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { chromium } from 'playwright-core';
import { launch, BASE } from './chrome.mjs';

const OUT = process.argv[2] || 'v2-view-shots';
const ARMS = (process.argv[3] || 'v2/').split('|');
const ONLY = process.argv.slice(4);
fs.mkdirSync(OUT, { recursive: true });
const VIEWS = [
  { name: 'opening', start: true },
  { name: 'dkr-near', xz: [621, 228], distance: 170, polar: 68, azimuth: 200 },
  { name: 'dkr-far', xz: [621, 228], distance: 380, polar: 58, azimuth: 235 },
  { name: 'tower-near', xz: [0, -0.5], distance: 150, polar: 74, azimuth: 185 },
  { name: 'tower-far', xz: [0, -0.5], distance: 330, polar: 62, azimuth: 200 },
  { name: 'speedway-eye', eye: [243.9, -424.5, 184.8, 1.8] },
  { name: 'calhoun-east-eye', eye: [-35, 166, 270, 1.8], pitchUp: 8 },
].filter((v) => !ONLY.length || ONLY.includes(v.name));

// a tiny PNG reader (8-bit RGBA / RGB, no interlace): enough for Chrome's screenshots
function readPng(f) {
  const b = fs.readFileSync(f); let o = 8, w = 0, h = 0, ct = 0; const idat = [];
  while (o < b.length) {
    const len = b.readUInt32BE(o), type = b.toString('ascii', o + 4, o + 8), d = b.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]; }
    else if (type === 'IDAT') idat.push(d);
    o += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)), bpp = ct === 6 ? 4 : 3, stride = w * bpp, px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f0 = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), row = px.subarray(y * stride, (y + 1) * stride), up = y ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? row[i - bpp] : 0, u = up ? up[i] : 0, c = up && i >= bpp ? up[i - bpp] : 0;
      let v = src[i];
      if (f0 === 1) v += a; else if (f0 === 2) v += u; else if (f0 === 3) v += (a + u) >> 1;
      else if (f0 === 4) { const p = a + u - c, pa = Math.abs(p - a), pb = Math.abs(p - u), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? u : c; }
      row[i] = v & 255;
    }
  }
  return { w, h, bpp, px };
}
function diff(a, b) {
  const A = readPng(a), B = readPng(b); let n = 0, sum = 0; const N = A.w * A.h;
  for (let i = 0; i < N; i++) {
    let m = 0; for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(A.px[i * A.bpp + c] - B.px[i * B.bpp + c]));
    if (m > 2) n++; sum += m;
  }
  return { changedPct: +(100 * n / N).toFixed(3), meanMax: +(sum / N).toFixed(3) };
}

const browser = await launch(chromium, { gl: process.env.VERIFY_GL || 'hardware', maxMs: 3600000 });
for (const v of VIEWS) {
  const row = { view: v.name, arms: [] };
  for (let k = 0; k < ARMS.length; k++) {
    const [dir, q = ''] = ARMS[k].split('?');
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(`${BASE.replace(/\/$/, '')}/${dir}?intro=0&fade=0${q ? '&' + q : ''}`, { waitUntil: 'load', timeout: 180000 });
    await page.waitForFunction(() => window.__v2 && window.__v2.ready, null, { timeout: 180000 });
    await page.evaluate(() => window.__v2.ready);
    await page.addStyleTag({ content: 'body > *:not(canvas) { visibility: hidden !important; } canvas { visibility: visible !important; }' });
    if (v.eye) {
      await page.evaluate(([x, z, hdg, h, up]) => {
        const { THREE, camera } = window.__v2, r = THREE.MathUtils.degToRad(hdg), ahead = 30;
        window.__v2.placeCamera({ target: [x + Math.sin(r) * ahead, 0, z - Math.cos(r) * ahead], distance: Math.hypot(ahead, h), polarDeg: 90 - Math.atan2(h, ahead) * 180 / Math.PI, azimuthDeg: hdg + 180 });
        if (up) { window.__v2.controls.update = () => false; camera.rotateX(THREE.MathUtils.degToRad(up + Math.atan2(h, ahead) * 180 / Math.PI)); camera.updateMatrixWorld(); }
        window.__v2.redraw();
      }, [...v.eye, v.pitchUp || 0]);
    } else if (v.xz) {
      await page.evaluate(([x, z, d, p, a]) => window.__v2.placeCamera({ target: [x, 0, z], distance: d, polarDeg: p, azimuthDeg: a }), [v.xz[0], v.xz[1], v.distance, v.polar, v.azimuth]);
    }
    let calm = 0; const t0 = Date.now();
    while (calm < 3 && Date.now() - t0 < 240000) { const s = await page.evaluate(() => window.__v2.tiles()); calm = s && s.planned && s.loading === 0 && !s.fading ? calm + 1 : 0; await page.waitForTimeout(700); }
    await page.evaluate(() => { const t = window.__v2.tileStreamer(); t && t.settle(); window.__v2.redraw(); });
    await page.waitForTimeout(1200);
    const f = path.join(OUT, `${v.name}.${k}.png`);
    await page.screenshot({ path: f + '.tmp.png' }); await page.evaluate(() => window.__v2.redraw()); await page.waitForTimeout(700);
    await page.screenshot({ path: f }); fs.rmSync(f + '.tmp.png', { force: true });
    row.arms.push({ arm: ARMS[k], errors: errs.slice(0, 2), ...(k ? diff(path.join(OUT, `${v.name}.0.png`), f) : {}) });
    await ctx.close();
  }
  console.log(JSON.stringify(row));
}
console.log(`instrument: 1440x900 @2, ${process.env.VERIFY_GL || 'hardware'} GL, ${BASE}; arms ${ARMS.join(' | ')}`);
await browser.close();
