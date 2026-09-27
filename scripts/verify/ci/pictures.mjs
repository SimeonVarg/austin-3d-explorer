/**
 * ci/pictures.mjs — the same views of the city, before and after a change,
 * side by side, with the pixels that moved painted in.
 *
 * WHY. The checks in this directory each guard one claim; a colour change on a
 * building nobody wrote a check for sails through all of them. This is the
 * catch-all: photograph a fixed set of views (poses.json) from two served
 * checkouts, count the pixels that differ, and hand a person the pictures.
 * It NEVER fails the run: in this repo a visible change is usually the point
 * of the pull request. It reports, and the report is the PR comment.
 *
 * NOISE. Every side is shot with the same harness (this checkout's shot.mjs)
 * and the same software renderer. The BEFORE side is shot a second time
 * ("again"), and the difference between those two is printed as each view's
 * noise floor, so a "changed" can be read against how much the page moves on
 * its own. In CI the three shoots run on three machines at once (one frame
 * takes seconds in software); "again" being on its own machine means the
 * noise floor includes the machine-to-machine difference too.
 *
 * Usage:
 *   one machine, all of it:
 *     node scripts/verify/ci/pictures.mjs --before URL --after URL --out DIR [--label main]
 *   or split, as the workflow does:
 *     node scripts/verify/ci/pictures.mjs --shoot before|after|again --url URL --out DIR
 *     node scripts/verify/ci/pictures.mjs --compare --out DIR [--label main]
 *   [--poses scripts/verify/ci/poses.json] [--no-again]
 *
 * Writes <out>/pictures.json, <out>/index.html and per view
 * <view>-compare.jpg (before | after | moved pixels) plus the raw PNGs.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { chromium } from 'playwright-core';
import { launch } from '../chrome.mjs';
import { decodePNG } from '../lib/png.mjs';
import { CI_DIR, VERIFY, slowMachineEnv } from './plan.mjs';

// ---- every look-and-threshold value, in one place ----------------------
export const LOOK = {
  tolerance: 12,          // a pixel "moved" if any RGB channel moved more than this (0-255)
  minPct: 0.05,           // a view "changed" if more than this % of its pixels moved...
  noiseFactor: 3,         // ...and more than this many times its own before/before noise
  highlight: [255, 0, 255],   // colour of a moved pixel in the diff panel
  dimTo: 0.25,            // the unchanged picture under the highlight, as a share of its brightness
  panelScale: 0.5,        // each panel in the side-by-side, relative to the 1440x900 shot
  labelBg: '#111',        // caption strip above each panel
  labelFg: '#fff',
  labelPx: 20,
  jpegQuality: 88,
};

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const BEFORE = opt('--before');
const AFTER = opt('--after');
const SHOOT = opt('--shoot');
const COMPARE = argv.includes('--compare');
const OUT = path.resolve(opt('--out', 'ci-out/pictures'));
const LABEL = opt('--label', 'main');
const POSES = path.resolve(opt('--poses', path.join(CI_DIR, 'poses.json')));
const AGAIN = !argv.includes('--no-again');
const SIDES = ['before', 'after', 'again'];
if (!(BEFORE && AFTER) && !(SHOOT && opt('--url')) && !COMPARE) {
  console.error('usage: pictures.mjs --before URL --after URL --out DIR\n' +
                '       pictures.mjs --shoot before|after|again --url URL --out DIR\n' +
                '       pictures.mjs --compare --out DIR');
  process.exit(2);
}
if (SHOOT && !SIDES.includes(SHOOT)) { console.error('--shoot takes ' + SIDES.join('|')); process.exit(2); }

fs.mkdirSync(OUT, { recursive: true });
const poses = JSON.parse(fs.readFileSync(POSES, 'utf8'));
const report = { beforeLabel: LABEL, tolerance: LOOK.tolerance, minPct: LOOK.minPct,
                 noiseFactor: LOOK.noiseFactor, poses: [] };
const save = () => fs.writeFileSync(path.join(OUT, 'pictures.json'), JSON.stringify(report, null, 1));

/** Run shot.mjs against one server; its PNGs land in <OUT>/<side>/shots/. */
function shoot(side, url) {
  const cwd = path.join(OUT, side);
  fs.mkdirSync(cwd, { recursive: true });
  return new Promise(resolve => {
    const t0 = Date.now();
    const child = spawn(process.execPath, [path.join(VERIFY, 'shot.mjs'), side, POSES], {
      cwd, env: { ...process.env, ...slowMachineEnv(), VERIFY_URL: url, VERIFY_MAX_MS: String(40 * 60 * 1000) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    child.stdout.on('data', d => { log += d; process.stdout.write(d); });
    child.stderr.on('data', d => { log += d; process.stderr.write(d); });
    child.on('close', code => {
      const run = { side, url, code, secs: Math.round((Date.now() - t0) / 1000), os: process.platform };
      fs.writeFileSync(path.join(OUT, `${side}.log`), log);
      fs.writeFileSync(path.join(OUT, side, 'run.json'), JSON.stringify(run));
      resolve(run);
    });
  });
}
const shotPath = (side, name) => path.join(OUT, side, 'shots', `${side}-${name}.png`);

// ---- a PNG writer, because the harness has a reader and no dependencies ----
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return buf => { let c = -1; for (const b of buf) c = t[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
})();
function encodePNG(width, height, rgb) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + y * width * 3, width * 3).copy(raw, y * (width * 3 + 1) + 1);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

/** Moved-pixel count and a picture of where: the AFTER frame dimmed, moved pixels painted. */
function compare(a, b, writeTo) {
  const A = decodePNG(a), B = decodePNG(b);
  if (A.width !== B.width || A.height !== B.height) throw new Error('size mismatch');
  const n = A.width * A.height;
  const img = writeTo ? new Uint8Array(n * 3) : null;
  let moved = 0, max = 0;
  for (let i = 0; i < n; i++) {
    const ia = i * A.bpp, ib = i * B.bpp;
    let d = 0;
    for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(A.data[ia + c] - B.data[ib + c]));
    if (d > max) max = d;
    const hit = d > LOOK.tolerance;
    if (hit) moved++;
    if (img) for (let c = 0; c < 3; c++) img[i * 3 + c] = hit ? LOOK.highlight[c] : Math.round(B.data[ib + c] * LOOK.dimTo);
  }
  if (img) fs.writeFileSync(writeTo, encodePNG(A.width, A.height, img));
  return { pct: +(100 * moved / n).toFixed(4), maxChannelDiff: max };
}

// ---- shoot -------------------------------------------------------------
if (SHOOT) {
  const r = await shoot(SHOOT, opt('--url'));
  console.log(`shot ${SHOOT}: exit ${r.code} after ${r.secs}s`);
  process.exit(0);   // a failed shoot shows up as missing views in --compare
}
if (BEFORE && AFTER) {
  console.log(`before ${BEFORE} (${LABEL})  after ${AFTER}  ${poses.length} views${AGAIN ? ', before shot twice' : ''}`);
  await shoot('before', BEFORE);
  await shoot('after', AFTER);
  if (AGAIN) await shoot('again', BEFORE);
}

// ---- compare -----------------------------------------------------------
report.runs = {};
for (const side of SIDES) {
  try { report.runs[side] = JSON.parse(fs.readFileSync(path.join(OUT, side, 'run.json'), 'utf8')); } catch (e) {}
}
for (const p of poses) {
  const row = { name: p.name };
  try {
    const b = shotPath('before', p.name), a = shotPath('after', p.name);
    if (!fs.existsSync(b) || !fs.existsSync(a)) {
      throw new Error(`no ${!fs.existsSync(b) ? 'before' : 'after'} picture (its shoot did not reach this view)`);
    }
    Object.assign(row, compare(b, a, path.join(OUT, `${p.name}-diff.png`)));
    if (fs.existsSync(shotPath('again', p.name))) {
      row.noisePct = compare(b, shotPath('again', p.name), null).pct;
    }
    row.changed = row.pct > LOOK.minPct && row.pct > LOOK.noiseFactor * (row.noisePct || 0);
  } catch (e) {
    row.error = e.message;
  }
  report.poses.push(row);
  save();
  console.log(`${(row.changed ? 'CHANGED' : row.error ? 'ERROR' : 'same').padEnd(8)} ${p.name.padEnd(20)} ${row.pct ?? ''}%  noise ${row.noisePct ?? '-'}%  max ${row.maxChannelDiff ?? ''}`);
}

// ---- side by side, labelled, drawn by the browser (it has the fonts) ------
const browser = await launch(chromium);
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const url = f => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
  for (const row of report.poses) {
    if (row.error) continue;
    const panels = [
      [`BEFORE: ${LABEL}`, shotPath('before', row.name)],
      ['AFTER: this change', shotPath('after', row.name)],
      [`MOVED: ${row.pct}% of pixels${row.noisePct != null ? ` (noise ${row.noisePct}%)` : ''}`, path.join(OUT, `${row.name}-diff.png`)],
    ];
    const w = Math.round(1440 * LOOK.panelScale), h = Math.round(900 * LOOK.panelScale);
    await page.setViewportSize({ width: w * 3, height: h + LOOK.labelPx + 16 });
    await page.setContent(`<body style="margin:0;display:flex;background:${LOOK.labelBg}">${panels.map(([t, f]) =>
      `<figure style="margin:0;width:${w}px"><figcaption style="height:${LOOK.labelPx + 16}px;line-height:${LOOK.labelPx + 16}px;` +
      `padding:0 8px;font:600 ${LOOK.labelPx}px system-ui,sans-serif;color:${LOOK.labelFg};background:${LOOK.labelBg};white-space:nowrap;overflow:hidden">` +
      `${row.name} - ${t}</figcaption><img src="${url(f)}" style="display:block;width:${w}px;height:${h}px"></figure>`).join('')}</body>`);
    await page.screenshot({ path: path.join(OUT, `${row.name}-compare.jpg`), type: 'jpeg', quality: LOOK.jpegQuality });
  }
} finally {
  await browser.__done();
}

fs.writeFileSync(path.join(OUT, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Before and after</title>
<body style="font:15px system-ui,sans-serif;background:#1a1a1a;color:#eee;margin:16px">
<h1 style="font-size:20px">Before (${LABEL}) and after, ${report.poses.filter(p => p.changed).length} of ${report.poses.length} views changed</h1>
${report.poses.map(p => `<h2 style="font-size:16px">${p.changed ? 'CHANGED' : 'same'}: ${p.name} ${p.error ? '(' + p.error + ')' : `(${p.pct}% of pixels moved, noise ${p.noisePct ?? '-'}%)`}</h2>
${p.error ? '' : `<img src="${p.name}-compare.jpg" style="max-width:100%">`}`).join('\n')}
</body>`);
save();
console.log(`\n${report.poses.filter(p => p.changed).length} of ${report.poses.length} views changed; report in ${OUT}`);
