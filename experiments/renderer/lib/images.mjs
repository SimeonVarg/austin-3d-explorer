/** Image comparison for compare.mjs: PNG in, numbers and a side-by-side picture out. No dependencies. */
import fs from 'node:fs';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { VERIFY } from './app.mjs';

const { decodePNG } = await import(pathToFileURL(path.join(VERIFY, 'lib/png.mjs')).href);
export { decodePNG };

const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return buf => { let c = -1; for (const b of buf) c = t[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }; })();
export function encodePNG(width, height, rgb) {
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (width * 3 + 1)] = 0; Buffer.from(rgb.buffer, rgb.byteOffset + y * width * 3, width * 3).copy(raw, y * (width * 3 + 1) + 1); }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

export const LOOK = {
  tolerance: 12,            // same as ci/pictures.mjs: a pixel "moved" if any channel moved more than this (0-255)
  bg: [255, 0, 255],        // the clear colour both sides use; anything else is a building pixel
  bgTol: 6,
  minBuildingPct: 0.4,      // a view "shows the buildings" if more than this % of its pixels are not background in either picture
  ssimBlock: 8,
};

export function rgbOf(png) {
  const n = png.width * png.height, o = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) { o[i * 3] = png.data[i * png.bpp]; o[i * 3 + 1] = png.data[i * png.bpp + 1]; o[i * 3 + 2] = png.data[i * png.bpp + 2]; }
  return { width: png.width, height: png.height, rgb: o };
}

/** The per-view numbers. a = the app, b = the prototype (both {width,height,rgb}). */
export function compareImages(a, b, { saveTo = null, labelA = 'app', labelB = 'prototype' } = {}) {
  if (a.width !== b.width || a.height !== b.height) throw new Error(`size mismatch ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  const n = a.width * a.height, W = a.width, H = a.height;
  const isBg = (img, i) => Math.abs(img.rgb[i * 3] - LOOK.bg[0]) <= LOOK.bgTol && Math.abs(img.rgb[i * 3 + 1] - LOOK.bg[1]) <= LOOK.bgTol && Math.abs(img.rgb[i * 3 + 2] - LOOK.bg[2]) <= LOOK.bgTol;
  let ma = 0, mb = 0, both = 0, uni = 0, over = 0, overUnion = 0, sumAbs = 0, sumAbsBoth = 0, maxd = 0, onlyA = 0, onlyB = 0;
  const luma = (img, i) => 0.2126 * img.rgb[i * 3] + 0.7152 * img.rgb[i * 3 + 1] + 0.0722 * img.rgb[i * 3 + 2];
  const diffImg = saveTo ? new Uint8Array(n * 3) : null;
  for (let i = 0; i < n; i++) {
    const ba = !isBg(a, i), bb = !isBg(b, i);
    if (ba) ma++; if (bb) mb++; if (ba && bb) both++; if (ba || bb) uni++; if (ba && !bb) onlyA++; if (!ba && bb) onlyB++;
    let d = 0; for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(a.rgb[i * 3 + c] - b.rgb[i * 3 + c]));
    if (d > maxd) maxd = d;
    const hit = d > LOOK.tolerance;
    if (hit) { over++; if (ba || bb) overUnion++; }
    if (ba || bb) { let s = 0; for (let c = 0; c < 3; c++) s += Math.abs(a.rgb[i * 3 + c] - b.rgb[i * 3 + c]); sumAbs += s / 3; if (ba && bb) sumAbsBoth += s / 3; }
    if (diffImg) { if (hit) { diffImg[i * 3] = 255; diffImg[i * 3 + 1] = 0; diffImg[i * 3 + 2] = 255; } else for (let c = 0; c < 3; c++) diffImg[i * 3 + c] = Math.round(b.rgb[i * 3 + c] * 0.25); }
  }
  // structural similarity on 8x8 luma blocks that touch a building pixel (mean SSIM; 1 = identical structure)
  const B = LOOK.ssimBlock, C1 = (0.01 * 255) ** 2, C2 = (0.03 * 255) ** 2;
  let ssimSum = 0, ssimN = 0;
  for (let by = 0; by + B <= H; by += B) for (let bx = 0; bx + B <= W; bx += B) {
    let touch = false, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
    for (let y = 0; y < B; y++) for (let x = 0; x < B; x++) {
      const i = (by + y) * W + bx + x;
      if (!isBg(a, i) || !isBg(b, i)) touch = true;
      const la = luma(a, i), lb = luma(b, i); sa += la; sb += lb; saa += la * la; sbb += lb * lb; sab += la * lb;
    }
    if (!touch) continue;
    const m = B * B, mua = sa / m, mub = sb / m, va = saa / m - mua * mua, vb = sbb / m - mub * mub, cov = sab / m - mua * mub;
    ssimSum += ((2 * mua * mub + C1) * (2 * cov + C2)) / ((mua * mua + mub * mub + C1) * (va + vb + C2)); ssimN++;
  }
  const r = {
    buildingPctApp: +(100 * ma / n).toFixed(3), buildingPctProto: +(100 * mb / n).toFixed(3),
    showsBuildings: 100 * uni / n > LOOK.minBuildingPct,
    pctOverWholeFrame: +(100 * over / n).toFixed(4),                       // the CI definition (diluted by the empty background)
    pctOverOnBuildings: uni ? +(100 * overUnion / uni).toFixed(2) : null,  // of pixels that are a building in either picture
    silhouetteIoU: uni ? +(both / uni).toFixed(4) : null,
    meanAbsDiffOnBuildings: uni ? +(sumAbs / uni).toFixed(2) : null,       // 0-255, per channel, over the union mask
    meanAbsDiffBothCovered: both ? +(sumAbsBoth / both).toFixed(2) : null,
    ssim: ssimN ? +(ssimSum / ssimN).toFixed(4) : null, maxChannelDiff: maxd,
  };
  if (saveTo) fs.writeFileSync(saveTo, encodePNG(W, H, diffImg));
  return r;
}

/** before | after | moved pixels, one PNG, panels at `scale` (nearest neighbour). No captions: the filename and the JSON name the sides. */
export function sideBySide(a, b, diffPath, outPath, scale = 0.5) {
  const d = decodePNG(diffPath); const D = rgbOf(d);
  const w = Math.floor(a.width * scale), h = Math.floor(a.height * scale), gap = 4;
  const out = new Uint8Array((w * 3 + gap * 2) * h * 3).fill(30); const OW = w * 3 + gap * 2;
  const put = (img, ox) => { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const sx = Math.min(img.width - 1, Math.floor(x / scale)), sy = Math.min(img.height - 1, Math.floor(y / scale)); for (let c = 0; c < 3; c++) out[(y * OW + ox + x) * 3 + c] = img.rgb[(sy * img.width + sx) * 3 + c]; } };
  put(a, 0); put(b, w + gap); put(D, 2 * (w + gap));
  fs.writeFileSync(outPath, encodePNG(OW, h, out));
}
