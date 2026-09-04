/**
 * png.mjs — decode a Playwright screenshot and count the pixels that differ
 * between two of them. No dependency, on purpose: the suite has none beyond
 * playwright-core and a diff that needs `npm install` is a diff nobody runs.
 *
 * Handles exactly what Playwright writes — 8-bit RGB/RGBA, non-interlaced —
 * and throws on anything else rather than guessing. Written for
 * slopes-layer.mjs, whose "off is pixel-identical to today" claim is a count
 * of differing pixels between two page loads, not a hash that says "no".
 *
 *   import { decodePNG, diffPNG } from './lib/png.mjs';
 *   diffPNG(a, b)         -> { pixels, total, pct, maxChannelDiff, bbox }
 *   node lib/png.mjs a.png b.png [tolerance]
 */
import fs from 'node:fs';
import zlib from 'node:zlib';

export function decodePNG(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG: ' + file);
  let off = 8, width = 0, height = 0, depth = 0, ctype = 0, interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off); const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; ctype = data[9]; interlace = data[12]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (depth !== 8 || interlace !== 0 || (ctype !== 6 && ctype !== 2)) throw new Error(`unsupported PNG (depth ${depth} ctype ${ctype} interlace ${interlace}): ${file}`);
  const bpp = ctype === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = new Uint8Array(width * height * bpp);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v;
      switch (f) {
        case 0: v = line[i]; break;
        case 1: v = line[i] + a; break;
        case 2: v = line[i] + b; break;
        case 3: v = line[i] + ((a + b) >> 1); break;
        case 4: { const p = a + b - c; const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); break; }
        default: throw new Error('bad filter ' + f);
      }
      cur[i] = v & 255;
    }
    out.set(cur, y * stride); prev = cur;
  }
  return { width, height, bpp, data: out };
}

/** Differing pixels (any RGB channel differs by more than `tol`), max channel diff, and a bbox. */
export function diffPNG(a, b, tol = 0) {
  const A = decodePNG(a), B = decodePNG(b);
  if (A.width !== B.width || A.height !== B.height) throw new Error('size mismatch');
  let n = 0, max = 0, minx = 1e9, miny = 1e9, maxx = -1, maxy = -1;
  for (let y = 0; y < A.height; y++) for (let x = 0; x < A.width; x++) {
    const i = (y * A.width + x) * A.bpp, j = (y * B.width + x) * B.bpp;
    let d = 0;
    for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(A.data[i + c] - B.data[j + c]));
    if (d > tol) { n++; if (x < minx) minx = x; if (y < miny) miny = y; if (x > maxx) maxx = x; if (y > maxy) maxy = y; }
    if (d > max) max = d;
  }
  return { pixels: n, total: A.width * A.height, pct: +(100 * n / (A.width * A.height)).toFixed(4), maxChannelDiff: max, bbox: n ? [minx, miny, maxx, maxy] : null };
}

if (process.argv[1] && process.argv[1].endsWith('png.mjs') && process.argv.length >= 4) {
  console.log(JSON.stringify(diffPNG(process.argv[2], process.argv[3], +(process.argv[4] || 0))));
}
