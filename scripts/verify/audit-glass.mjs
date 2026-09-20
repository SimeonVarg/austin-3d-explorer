/**
 * audit-glass.mjs — the glass mask in the facade atlases (alpha 191 = glass,
 * 255 = wall; js/city-lighting.js), read two ways.
 *
 *   VERIFY_URL=http://127.0.0.1:8671 node audit-glass.mjs <outDir>
 *
 * 1. THE DATA. Every image in the style: how much of it is marked glass
 *    (alpha < 250), how much of that "glass" is the tile's own WALL colour
 *    (masonry that will be drawn as a mirror), and how much alpha is neither
 *    191 nor 255 (anything below 255 is partly glass to the shader:
 *    glass = clamp((1 - a) * 255 / 64, 0, 1)). Pattern images only are
 *    affected; the scan says which ids a fill-extrusion-pattern layer uses.
 *
 * 2. THE RENDER, as an A/B on the same frame: shoot, then write every image
 *    back with its glass alpha raised to 255 (RGB untouched), shoot again.
 *    At NIGHT the sunlight term is off (u_sunPresence 0) and cityShade()
 *    returns MapLibre's own colour, so the ONLY thing the mask can change
 *    there is the RGB the shader reads. MapLibre premultiplies a raw
 *    RGBAImage on upload (Texture._uploadRawData -> premultiplyAlpha), so a
 *    glass texel reaches the shader as rgb * 191/255 = 0.749 rgb. If the
 *    shader treated it as straight colour, B/A over the changed pixels is
 *    ~1.33 at night. By DAY the same A/B maps where reflections land.
 *
 * Note map.updateImage is wrapped by city-lighting (bandGlassImage), so the
 * Drag/Places band atlases get their mask re-applied and stay masked in B;
 * the scan reports them separately.
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { BASE, launch } from './chrome.mjs';
import { applySwaps } from './audit-lib.mjs';
import zlib from 'node:zlib';
import { decodePNG } from './lib/png.mjs';

// A minimal RGBA PNG writer (filter 0), so the diff map needs no dependency.
function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
function encodePNG(w, h, rgba) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const OUT = process.argv[2];
if (!OUT) { console.error('usage: audit-glass.mjs <outDir>'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });

const browser = await launch(chromium, { gl: 'hardware', maxMs: 900000 });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await applySwaps(page);
await page.goto(BASE + '/?intro=0&drift=0&clip=1&apartments=0', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded() && !document.getElementById('veil'), null, { timeout: 300000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
await page.waitForTimeout(4000);

// ── 1. the data ─────────────────────────────────────────────────────
const scan = await page.evaluate(() => {
  const m = window.__map;
  const used = new Set();
  const pat = [];
  for (const l of m.getStyle().layers) {
    if (l.type !== 'fill-extrusion') continue;
    const p = m.getPaintProperty(l.id, 'fill-extrusion-pattern');
    if (p != null) pat.push({ id: l.id, pattern: JSON.stringify(p).slice(0, 120) });
  }
  const out = [];
  for (const id of m.listImages()) {
    const im = m.style.getImage(id);
    if (!im || !im.data || !im.data.data) continue;
    const d = im.data.data, n = d.length / 4;
    let a255 = 0, a191 = 0, a0 = 0, other = 0, glass = 0;
    const opaque = new Map();
    // The alpha the SHADER reads, bucketed: glass = clamp((1-a)*255/64, 0, 1),
    // so 255 is wall, <=191 is full glass and everything between is partial.
    // A mask that is meant to be binary should be empty in the two middles.
    const hist = { a255: 0, a254_250: 0, a249_192: 0, a191: 0, a190_1: 0, a0: 0 };
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3];
      if (a === 255) { a255++; const k = (d[i] >> 3) + ',' + (d[i + 1] >> 3) + ',' + (d[i + 2] >> 3); opaque.set(k, (opaque.get(k) || 0) + 1); }
      else if (Math.abs(a - 191) <= 4) a191++;
      else if (a === 0) a0++;
      else other++;
      if (a < 250) glass++;
      if (a === 255) hist.a255++; else if (a >= 250) hist.a254_250++; else if (a >= 192) hist.a249_192++;
      else if (a >= 187) hist.a191++; else if (a > 0) hist.a190_1++; else hist.a0++;
    }
    // modal opaque colour = the wall
    let wall = null, best = 0;
    for (const [k, c] of opaque) if (c > best) { best = c; wall = k.split(',').map(v => (+v << 3) + 4); }
    let wallAsGlass = 0;
    if (wall && glass) for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] >= 250) continue;
      if (Math.max(Math.abs(d[i] - wall[0]), Math.abs(d[i + 1] - wall[1]), Math.abs(d[i + 2] - wall[2])) <= 10) wallAsGlass++;
    }
    out.push({ id, w: im.data.width, h: im.data.height, n, a255, a191, a0, other, glass, wall, wallAsGlass, hist,
               glassShare: +(glass / n).toFixed(4), wallAsGlassShare: glass ? +(wallAsGlass / glass).toFixed(3) : 0,
               otherShare: +(other / n).toFixed(4) });
  }
  return { patternLayers: pat, images: out, stats: { ...window.CityLighting.stats, failures: window.CityLighting.stats.failures.length } };
});

const withGlass = scan.images.filter(i => i.glass > 0);
const families = {};
for (const i of scan.images) {
  const fam = i.id.replace(/[-_][0-9a-z]{1,4}$/i, '').replace(/[-_]\d+$/, '');
  const f = families[fam] || (families[fam] = { images: 0, withGlass: 0, glassPx: 0, px: 0, wallAsGlassPx: 0, zeroAlphaPx: 0, otherAlphaPx: 0, hist: { a255: 0, a254_250: 0, a249_192: 0, a191: 0, a190_1: 0, a0: 0 } });
  f.images++; if (i.glass) f.withGlass++; f.glassPx += i.glass; f.px += i.n; f.wallAsGlassPx += i.wallAsGlass; f.zeroAlphaPx += i.a0; f.otherAlphaPx += i.other;
  for (const k in f.hist) f.hist[k] += i.hist[k];
}
// The bulk building facades (js/facades.js: lo/mr/mh/tr/tg/dk/st + the k**
// authored-tier tiles) are what FACADE_PATTERN_EXPR puts on buildings-3d and
// outer-3d, so their alpha is what "is this masonry a mirror?" comes down to.
const FACADE = /^(lo|mr|mh|tr|tg|dk|st)\d/;
const fac = { images: 0, px: 0, glassPx: 0, wallAsGlassPx: 0, hist: { a255: 0, a254_250: 0, a249_192: 0, a191: 0, a190_1: 0, a0: 0 } };
for (const i of scan.images) if (FACADE.test(i.id)) { fac.images++; fac.px += i.n; fac.glassPx += i.glass; fac.wallAsGlassPx += i.wallAsGlass; for (const k in fac.hist) fac.hist[k] += i.hist[k]; }
console.log('[facade atlases] ' + JSON.stringify({ ...fac, hist: Object.fromEntries(Object.entries(fac.hist).map(([k, v]) => [k, +(100 * v / Math.max(1, fac.px)).toFixed(2) + '%'])) }));
console.log(`images ${scan.images.length}, with any glass alpha ${withGlass.length}; pattern layers ${scan.patternLayers.length}; stats ${JSON.stringify(scan.stats)}`);
const famRows = Object.entries(families).filter(([, f]) => f.glassPx).sort((a, b) => b[1].glassPx - a[1].glassPx);
for (const [k, f] of famRows)
  console.log(`  ${k.padEnd(28)} imgs ${String(f.images).padStart(4)} glass ${(100 * f.glassPx / f.px).toFixed(1).padStart(5)}%  wall-coloured glass ${(100 * f.wallAsGlassPx / Math.max(1, f.glassPx)).toFixed(1).padStart(5)}%  a=0 ${(100 * f.zeroAlphaPx / f.px).toFixed(1)}%  a other ${(100 * f.otherAlphaPx / f.px).toFixed(1)}%`);

// Mask pictures of the worst offenders: original | glass tinted cyan.
const worst = withGlass.filter(i => i.wallAsGlassShare > 0.2 || i.a0 > 0).sort((a, b) => b.wallAsGlass - a.wallAsGlass).slice(0, 6).map(i => i.id);
if (worst.length) {
  const url = await page.evaluate((ids) => {
    const m = window.__map, S = 4, pad = 8;
    const ims = ids.map(id => m.style.getImage(id).data);
    const W = ims.reduce((s, d) => s + d.width * S * 2 + pad * 3, 0), H = Math.max(...ims.map(d => d.height * S)) + 24;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'); g.fillStyle = '#222'; g.fillRect(0, 0, W, H);
    g.imageSmoothingEnabled = false;
    let x = pad;
    ims.forEach((d, k) => {
      const a = document.createElement('canvas'); a.width = d.width; a.height = d.height;
      const b = document.createElement('canvas'); b.width = d.width; b.height = d.height;
      const ia = new ImageData(new Uint8ClampedArray(d.data), d.width, d.height);
      const ib = new ImageData(new Uint8ClampedArray(d.data), d.width, d.height);
      for (let i = 0; i < ia.data.length; i += 4) {
        ia.data[i + 3] = 255;
        const gl = Math.max(0, Math.min(1, (255 - ib.data[i + 3]) / 64));
        ib.data[i] = ib.data[i] * (1 - gl); ib.data[i + 1] = ib.data[i + 1] * (1 - gl) + 255 * gl; ib.data[i + 2] = ib.data[i + 2] * (1 - gl) + 255 * gl; ib.data[i + 3] = 255;
      }
      a.getContext('2d').putImageData(ia, 0, 0); b.getContext('2d').putImageData(ib, 0, 0);
      g.drawImage(a, x, 20, d.width * S, d.height * S); x += d.width * S + pad;
      g.drawImage(b, x, 20, d.width * S, d.height * S); x += d.width * S + pad * 2;
      g.fillStyle = '#fff'; g.font = '11px sans-serif'; g.fillText(ids[k], x - d.width * S * 2 - pad * 3, 13);
    });
    return c.toDataURL('image/png');
  }, worst);
  fs.writeFileSync(path.join(OUT, 'glass-mask-worst.png'), Buffer.from(url.split(',')[1], 'base64'));
}

// ── 2. the render A/B ───────────────────────────────────────────────
const POSES = [
  // campus: Main Mall west side, looking north-east over window grids
  { id: 'mall', center: [-97.7397, 30.2852], zoom: 17.6, pitch: 70, bearing: 35 },
  // the Drag at Guadalupe and 23rd: shopfronts + Union
  { id: 'drag', center: [-97.7418, 30.2869], zoom: 17.9, pitch: 72, bearing: 100 },
];
async function shoot(file) {
  await page.evaluate(() => new Promise(r => { const m = window.__map; m.triggerRepaint(); m.once('idle', r); setTimeout(r, 8000); }));
  await page.waitForTimeout(800);
  await page.screenshot({ path: file, type: 'png' });
  await page.waitForTimeout(600);
  await page.screenshot({ path: file, type: 'png' });
  return decodePNG(file);
}
async function setMask(on) {
  return page.evaluate((on) => {
    const m = window.__map;
    window.__glassSaved = window.__glassSaved || {};
    let n = 0;
    for (const id of m.listImages()) {
      const im = m.style.getImage(id);
      if (!im || !im.data || !im.data.data) continue;
      if (on) {
        if (!window.__glassSaved[id]) continue;
        m.updateImage(id, { width: im.data.width, height: im.data.height, data: window.__glassSaved[id] }); n++;
        continue;
      }
      const d = im.data.data;
      let has = false;
      for (let i = 3; i < d.length; i += 4) if (d[i] < 250) { has = true; break; }
      if (!has) continue;
      window.__glassSaved[id] = new Uint8Array(d);
      const e = new Uint8Array(d); for (let i = 3; i < e.length; i += 4) e[i] = 255;
      m.updateImage(id, { width: im.data.width, height: im.data.height, data: e }); n++;
    }
    m.triggerRepaint();
    return n;
  }, on);
}
const lum = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
const ab = {};
for (const pose of POSES) {
  for (const [hour, p] of [['night', 0.95], ['day', 0.2]]) {
    await page.evaluate(({ pose, p }) => {
      const m = window.__map;
      m.jumpTo({ center: pose.center, zoom: pose.zoom, pitch: pose.pitch, bearing: pose.bearing });
      const sl = document.getElementById('tod-slider'); if (sl) sl.value = String(p);
      window.applyTimeOfDay(m, p, true);
    }, { pose, p });
    await page.waitForTimeout(3000);
    const A = await shoot(path.join(OUT, `${pose.id}-${hour}-A.png`));
    const nImgs = await setMask(false);
    await page.waitForTimeout(1500);
    const B = await shoot(path.join(OUT, `${pose.id}-${hour}-B-nomask.png`));
    await setMask(true);
    // stats over pixels that changed
    const ratios = []; let changed = 0, brighter = 0;
    const diff = Buffer.alloc(A.width * A.height * 4);
    const bp = A.bpp;
    for (let px = 0, i = 0; px < A.width * A.height; px++, i += bp) {
      const la = lum(A.data, i), lb = lum(B.data, i);
      const dd = Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2]);
      if (dd > 12) { changed++; if (la > 4) ratios.push(lb / la); if (lb > la) brighter++; }
      const v = Math.min(255, dd * 3), o = px * 4;
      diff[o] = v; diff[o + 1] = v; diff[o + 2] = v; diff[o + 3] = 255;
    }
    ratios.sort((a, b) => a - b);
    const q = f => ratios.length ? +ratios[Math.floor(f * (ratios.length - 1))].toFixed(3) : null;
    ab[`${pose.id}-${hour}`] = { imagesUnmasked: nImgs, changedPx: changed, changedShare: +(changed / (A.width * A.height)).toFixed(4),
      brighterWithoutMask: +(brighter / Math.max(1, changed)).toFixed(3), ratioBoverA: { p10: q(0.1), p50: q(0.5), p90: q(0.9) } };
    console.log(`A/B ${pose.id} ${hour}: ${JSON.stringify(ab[`${pose.id}-${hour}`])}`);
    fs.writeFileSync(path.join(OUT, `${pose.id}-${hour}-diff.png`), encodePNG(A.width, A.height, diff));
  }
}

fs.writeFileSync(path.join(OUT, 'glass.json'), JSON.stringify({ scan: { ...scan, images: scan.images.filter(i => i.glass || i.other) }, families, facadeAtlases: fac, ab }, null, 1));
await browser.__done();
