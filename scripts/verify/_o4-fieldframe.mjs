/**
 * _o4-fieldframe.mjs — photograph the one pose `field-bleed.mjs` calls red.
 *
 * The o4 pass ran `field-bleed.mjs` at a raised ceiling. Its FIRST red is
 *
 *   *FAIL day outside-north-70  pitch 70  alt 398.4m  field pixels 2986 (0.29%)
 *              mean rgb 121,123,63   box 594,369,685,405
 *
 * and `js/app.js:544` records what the ORIGINAL raster defect measured before
 * the turf was made geometry: *"3318 px at pitch 79, box 581,381-687,422"*.
 * Same band of the frame, same order of magnitude. The fix cured pitch 79 (this
 * run: 0 px) and this pose was never seen, because eighteen poses at ~135 s
 * each cannot finish inside a 300 s watchdog.
 *
 * This writes two frames of that single pose so the defect can be looked at
 * rather than argued about:
 *
 *   shots/reds/field-bleed-70-plain.png     what a visitor sees
 *   shots/reds/field-bleed-70-magenta.png   the same frame with every pixel the
 *                                           turf layer painted forced to magenta
 *
 * The mask is field-bleed's own: changed by hiding `stadium-field`, AND stable
 * across two field-ON grabs, so drifting cloud and canopy cannot be credited to
 * the turf. Nothing here re-derives the verdict; it only draws the mask
 * field-bleed already computes.
 *
 * Usage: VERIFY_URL=http://127.0.0.1:8512 node scripts/verify/_o4-fieldframe.mjs
 */
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';
import fs from 'node:fs';
import zlib from 'node:zlib';

const OUT = 'shots/reds';
fs.mkdirSync(OUT, { recursive: true });

const F = [-97.7325465, 30.2836444];                    // field centre
const POSE = { zoom: 16.9, pitch: 70, bearing: 180 };   // field-bleed's outside-north-70
const TOD = 0.30;                                       // field-bleed's `day`

// ── PNG in and out, no dependency ───────────────────────────────────────────
function decodePNG(buf) {
  let pos = 8, w = 0, h = 0, bitDepth = 0, colour = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colour = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bitDepth !== 8 || (colour !== 6 && colour !== 2)) throw new Error(`unsupported PNG ${bitDepth}/${colour}`);
  const ch = colour === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(w * h * ch);
  let rp = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[rp++], row = y * w * ch, prev = row - w * ch;
    for (let x = 0; x < w * ch; x++) {
      const a = x >= ch ? out[row + x - ch] : 0;
      const b = y > 0 ? out[prev + x] : 0;
      const c = (x >= ch && y > 0) ? out[prev + x - ch] : 0;
      let v = raw[rp++];
      if (filter === 1) v += a; else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      out[row + x] = v & 0xff;
    }
  }
  return { w, h, ch, data: out };
}

const crcTable = (() => { const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t; })();
const crc32 = b => { let c = -1; for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const cc = Buffer.alloc(4); cc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, cc]);
}
/** Filter-0 rows only. Bigger file, zero chance of an encoder bug in the evidence. */
function encodePNG(img) {
  const { w, h, ch, data } = img;
  const raw = Buffer.alloc(h * (1 + w * ch));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * ch)] = 0;
    data.copy(raw, y * (1 + w * ch) + 1, y * w * ch, (y + 1) * w * ch);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = ch === 4 ? 6 : 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const browser = await launch(chromium, { maxMs: 900000 });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('  [pageerror] ' + e.message));
await page.goto(BASE + '/index.html?intro=0&drift=0', { waitUntil: 'networkidle', timeout: 180000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 180000 });
await page.evaluate(() => { try { window.cancelGraphicsAutoDetect(); } catch (e) {} });
await page.evaluate(() => new Promise(r => { const m = window.__map; if (m.loaded()) return r(); m.once('idle', r); setTimeout(r, 60000); }));

// field-bleed's own setTimeOfDay: drive the slider AND applyTimeOfDay, then
// confirm the map agrees before measuring anything.
for (let a = 1; a <= 3; a++) {
  await page.evaluate(v => {
    const el = document.getElementById('tod-slider');
    if (el) { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
    if (typeof window.applyTimeOfDay === 'function') window.applyTimeOfDay(window.__map, v, true);
  }, TOD);
  await page.waitForTimeout(3200);
  const got = await page.evaluate(() => window.__todCurrentP);
  if (typeof got === 'number' && Math.abs(got - TOD) < 0.02) break;
  console.log(`  time-of-day did not take (got ${got}); retry ${a}`);
}

await page.evaluate(q => window.__map.jumpTo(q), { center: F, ...POSE });
await page.evaluate(() => new Promise(r => { const m = window.__map; if (m.loaded() && m.areTilesLoaded()) return r(); m.once('idle', r); setTimeout(r, 4000); }));
await page.waitForTimeout(700);

const cam = await page.evaluate(() => {
  const m = window.__map, t = m.transform;
  return { alt: +(t.cameraToCenterDistance / t.pixelsPerMeter).toFixed(1), pitch: +m.getPitch().toFixed(1),
           kind: m.getLayer('stadium-field') ? m.getLayer('stadium-field').type : 'NO LAYER' };
});

async function shoot() {
  await page.screenshot({ type: 'png' });      // first frame is a half-draw
  await page.waitForTimeout(280);
  const buf = await page.screenshot({ type: 'png' });
  return { buf, img: decodePNG(buf) };
}

const on = await shoot();
await page.evaluate(() => window.__map.setLayoutProperty('stadium-field', 'visibility', 'none'));
await page.waitForTimeout(450);
const off = await shoot();
await page.evaluate(() => window.__map.setLayoutProperty('stadium-field', 'visibility', 'visible'));
await page.waitForTimeout(450);
const on2 = await shoot();

const a = on.img, b = off.img, a2 = on2.img, tol = 6;
const far = (p, q, i) => Math.abs(p.data[i] - q.data[i]) > tol || Math.abs(p.data[i + 1] - q.data[i + 1]) > tol || Math.abs(p.data[i + 2] - q.data[i + 2]) > tol;
const paint = Buffer.from(a2.data);
let n = 0, x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1, sr = 0, sg = 0, sb = 0;
for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) {
  const i = (y * a.w + x) * a.ch;
  if (far(a, b, i) && far(a2, b, i) && !far(a, a2, i)) {
    n++; sr += a.data[i]; sg += a.data[i + 1]; sb += a.data[i + 2];
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    paint[i] = 255; paint[i + 1] = 0; paint[i + 2] = 255;
  }
}
fs.writeFileSync(`${OUT}/field-bleed-70-plain.png`, on2.buf);
fs.writeFileSync(`${OUT}/field-bleed-70-magenta.png`,
  encodePNG({ w: a2.w, h: a2.h, ch: a2.ch, data: paint }));

console.log(`\npose outside-north-70  pitch ${cam.pitch}  alt ${cam.alt} m  stadium-field is a ${cam.kind}`);
console.log(`turf pixels outside the bowl: ${n} (${(100 * n / (a.w * a.h)).toFixed(2)}% of frame)`);
if (n) {
  console.log(`box ${x0},${y0},${x1},${y1}   mean rgb ${Math.round(sr / n)},${Math.round(sg / n)},${Math.round(sb / n)}`);
  console.log(`js/app.js:544 records the ORIGINAL raster defect as 3318 px at pitch 79, box 581,381-687,422.`);
}
console.log(`wrote ${OUT}/field-bleed-70-plain.png and ${OUT}/field-bleed-70-magenta.png`);
await browser.__done();
