/**
 * moire-off.mjs - IS "OFF" EXACT? The moire fix set off must draw main's picture, pixel for pixel.
 *
 * Page A loads with `?moirefix=0` (no face recorded, no shader define: main's own program). Each page B (--b name=query) loads with the fix compiled
 * in (`moirefix=1`) and then set off inside the page (MoireFix.set('off')). The same six cameras are drawn in each (the moire bar's views) and
 * the canvases compared pixel for pixel. A picture tool, not a verdict: it prints the table and exits 0 (--gate: exit 1 unless every view has
 * at most --max-px differing pixels, default 0, outside what the control moved when there is a control).
 *
 *   VERIFY_URL=http://127.0.0.1:<port> node moire-off.mjs --out dir [--views a,b] [--b name=query ...] [--size WxH] [--max-px N] [--gate]
 *     --b name=query   one page B to compare with A (repeatable; default `compiled=`). `query` is extra URL switches; `control=moirefix=0` loads
 *                      main's program a second time: what two loads of the SAME program move on their own (the noise to read the others against)
 *     --b-js js        page state run before every picture of every B (default MoireFix.set("off")); `window.MoireFix.set("on")` compares main with the fix
 *     --save           also write main.<view>.png and <variant>.<view>.png (the two pictures)
 *     --poses file     use the cameras of a poses file (scripts/verify/ci/poses.json) instead of the six
 * Writes <out>/off.txt, off.json and <name>.<view>.diff.png (differing pixels white, the rest black) for a view that differs.
 */
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const DAY = 0.2, NIGHT = 1.0;
const VIEWS = [
  { name: 'campus-far',        p: DAY,   center: [-97.7393, 30.2874],   zoom: 16.85, pitch: 74, bearing: 197.4 },
  { name: 'west-mid',          p: DAY,   center: [-97.7445, 30.2880],   zoom: 16.6,  pitch: 72, bearing: 300 },
  { name: 'guad-street',       p: DAY,   center: [-97.74175, 30.28700], zoom: 18.6,  pitch: 82, bearing: 356 },
  { name: 'downtown-far',      p: DAY,   center: [-97.7430, 30.2690],   zoom: 16.4,  pitch: 70, bearing: 20 },
  { name: 'campus-far-night',  p: NIGHT, center: [-97.7393, 30.2874],   zoom: 16.85, pitch: 74, bearing: 197.4 },
  { name: 'guad-street-night', p: NIGHT, center: [-97.74175, 30.28700], zoom: 18.6,  pitch: 82, bearing: 356 },
];
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const all = k => argv.map((a, i) => a === k ? argv[i + 1] : null).filter(Boolean);
const OUT = opt('--out', process.env.VERIFY_OUT || null);
if (!OUT) { console.error('usage: moire-off.mjs --out <dir> [--views a,b] [--b name=query ...] [--b-js js] [--size WxH]'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
let [VW, VH] = opt('--size', '960x600').split('x').map(Number);
const MAXPX = +opt('--max-px', '0'), GATE = argv.includes('--gate'), SAVE = argv.includes('--save');
const want = (opt('--views', '') || '').split(',').filter(Boolean);
const POSES = opt('--poses', null);   // a poses file (ci/poses.json: the ten cameras of the pictures job) instead of the bar's six
const list = POSES ? JSON.parse(fs.readFileSync(path.resolve(POSES), 'utf8')) : want.length ? want.map(n => VIEWS.find(v => v.name === n) || (console.error('unknown view ' + n), process.exit(2))) : VIEWS;
const B_JS = opt('--b-js', 'window.MoireFix && window.MoireFix.set("off")');
const Bs = (all('--b').length ? all('--b') : ['compiled=']).map(s => { const i = s.indexOf('='); return { name: s.slice(0, i), q: s.slice(i + 1) }; });
const FROZEN = ['intro=0', 'drift=0', 'namelabels=0', 'facadepace=0', 'timeofdaypace=0', 'smooth=0'];

const browser = await launch(chromium, { maxMs: +(opt('--max-min', '50')) * 60000 });
const errs = [];

// One page load, one picture per view: RGBA bytes as base64.
async function shoot(query, js) {
  const page = await browser.newPage({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 });
  page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript(() => { try { const K = 'austin3d.gfx.v1', c = JSON.parse(localStorage.getItem(K) || '{}'); c.msaa = false; c.autoDetected = true; c.autoExposure = false; localStorage.setItem(K, JSON.stringify(c)); } catch (e) {} });
  const qk = new Set(query.split('&').map(x => x.split('=')[0]));   // a variant's own switch replaces the frozen one of that name
  await page.goto(`${BASE}/_harness.html?${FROZEN.filter(x => !qk.has(x.split('=')[0])).concat(query ? [query] : []).join('&')}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 420000 });
  await page.waitForFunction(() => !document.getElementById('veil'), null, { timeout: 420000, polling: 500 });
  await page.waitForFunction(() => { const A = window.slopesApartments; return !A || !!(A.count.done && A.group); }, null, { timeout: 420000, polling: 500 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => { window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect(); if (window.GFX) window.GFX.autoExposure = false; });
  const info = await page.evaluate(() => { const gl = window.__map.painter.context.gl; const e = gl.getExtension('WEBGL_debug_renderer_info'); return { renderer: e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?', samples: gl.getParameter(gl.SAMPLES), fix: !!window.MoireFix, samples: gl.getParameter(gl.SAMPLES) }; });
  const shots = await page.evaluate(async ({ views, js }) => {
    const m = window.__map, sleep = ms => new Promise(r => setTimeout(r, ms));
    const quiet = () => { const P = window.__facadePace, A = window.slopesApartments && window.slopesApartments.count, L = window.CityLighting && window.CityLighting.stats; return !(P && P.busy) && !(A && !A.done) && !(L && L.shadowProxyBuilding); };
    async function settle(extra) {
      if (extra) await sleep(extra);
      for (let k = 0; k < 2; k++) {
        const t = Date.now(); while (!quiet() && Date.now() - t < 120000) await sleep(100);
        await new Promise(r => { const to = setTimeout(r, 20000); m.once('idle', () => { clearTimeout(to); r(); }); m.triggerRepaint(); });
        await sleep(60);
      }
    }
    const cv = document.createElement('canvas'), cx = cv.getContext('2d', { willReadFrequently: true });
    const out = {};
    for (const v of views) {
      m.stop(); m.jumpTo({ center: v.center, zoom: v.zoom, pitch: v.pitch, bearing: v.bearing });
      if (window.applyTimeOfDay) window.applyTimeOfDay(m, v.p, true);
      for (const id of m.getLayersOrder()) { const l = m.getLayer(id); if (l && l.type === 'symbol' && m.getLayoutProperty(id, 'visibility') !== 'none') m.setLayoutProperty(id, 'visibility', 'none'); }
      if (js) await new (Object.getPrototypeOf(async function () {}).constructor)(js)();
      await settle(800);
      const c = m.getCanvas(); cv.width = c.width; cv.height = c.height; cx.drawImage(c, 0, 0);
      const d = cx.getImageData(0, 0, c.width, c.height).data;
      let s = ''; const CH = 1 << 15; for (let i = 0; i < d.length; i += CH) s += String.fromCharCode.apply(null, d.subarray(i, i + CH));
      out[v.name] = { w: c.width, h: c.height, b64: btoa(s) };
    }
    return out;
  }, { views: list, js });
  await page.close();
  const dec = {}; for (const k in shots) dec[k] = { w: shots[k].w, h: shots[k].h, d: Buffer.from(shots[k].b64, 'base64') };
  return { shots: dec, info };
}
function png(w, h, gray) {   // 8-bit grey PNG
  const raw = Buffer.alloc((w + 1) * h); for (let y = 0; y < h; y++) { raw[y * (w + 1)] = 0; gray.copy(raw, y * (w + 1) + 1, y * w, (y + 1) * w); }
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = b => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (t, b) => { const l = Buffer.alloc(4); l.writeUInt32BE(b.length); const td = Buffer.concat([Buffer.from(t), b]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function rgbPng({ w, h, d }) {   // RGBA bytes -> an RGB PNG
  const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4, o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = d[i]; raw[o + 1] = d[i + 1]; raw[o + 2] = d[i + 2]; }
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = b => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (t, b) => { const l = Buffer.alloc(4); l.writeUInt32BE(b.length); const td = Buffer.concat([Buffer.from(t), b]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const t0 = Date.now(), T = () => ((Date.now() - t0) / 1000).toFixed(0) + 's';
const A = await shoot('moirefix=0', null);
console.error(`[off] A (moirefix=0) drawn ${T()}  ${A.info.renderer}`);
const rows = [], masks = {};
for (const b of Bs) {
  const B = await shoot((b.q.includes('moirefix=') ? '' : 'moirefix=1&') + b.q, B_JS);
  console.error(`[off] B ${b.name} drawn ${T()}  fix present: ${B.info.fix}  context samples ${B.info.samples}`);
  if (SAVE) for (const v of list) { fs.writeFileSync(path.join(OUT, `${b.name}.${v.name}.png`), rgbPng(B.shots[v.name])); fs.writeFileSync(path.join(OUT, `main.${v.name}.png`), rgbPng(A.shots[v.name])); }
  for (const v of list) {
    const a = A.shots[v.name], c = B.shots[v.name], N = a.w * a.h;
    if (a.w !== c.w || a.h !== c.h) { rows.push({ b: b.name, view: v.name, failed: `canvas ${a.w}x${a.h} against ${c.w}x${c.h}` }); continue; }
    let n = 0, n2 = 0, n8 = 0, sum = 0, max = 0; const g = Buffer.alloc(N);
    for (let p = 0, i = 0; p < N; p++, i += 4) {
      const d = Math.max(Math.abs(a.d[i] - c.d[i]), Math.abs(a.d[i + 1] - c.d[i + 1]), Math.abs(a.d[i + 2] - c.d[i + 2]));
      if (d) { n++; sum += d; if (d > max) max = d; if (d > 1) n2++; if (d > 8) n8++; g[p] = 255; }
    }
    masks[b.name + '/' + v.name] = { g, w: a.w, h: a.h };
    rows.push({ b: b.name, view: v.name, differ: n, pct: 100 * n / N, over1: n2, over8: n8, pct8: 100 * n8 / N, mean: n ? sum / n : 0, max, total: N });
    if (n) fs.writeFileSync(path.join(OUT, `${b.name}.${v.name}.diff.png`), png(a.w, a.h, g));
  }
}
// pixels that differ outside what the control moved (the sky's stars and moon move between page loads: the control shows it), a pixel's neighbours included
for (const r of rows) {
  const m = masks[r.b + '/' + r.view], c = masks['control/' + r.view];
  if (!m || !c || r.b === 'control') continue;
  let k = 0; for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) { const p = y * m.w + x; if (!m.g[p]) continue; let near = false;
    for (let dy = -8; dy <= 8 && !near; dy++) for (let dx = -8; dx <= 8; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && yy < m.h && xx >= 0 && xx < m.w && c.g[yy * m.w + xx]) { near = true; break; } }
    if (!near) k++; }
  r.outside = k;
}
const lines = [`moire-off  ${VW}x${VH}  renderer=${A.info.renderer}  samples A ${A.info.samples}`, 'A = ?moirefix=0; B = ?moirefix=1 + MoireFix.set("off") (+ the variant\'s switches). differing pixel = any channel differs.',
  'variant'.padEnd(22) + 'view'.padEnd(20) + 'differ'.padStart(9) + '%'.padStart(8) + '>1 level'.padStart(10) + '%>8'.padStart(8) + 'mean|d|'.padStart(9) + 'max'.padStart(5) + 'outside control'.padStart(17)];
for (const r of rows) lines.push(r.failed ? `${r.b.padEnd(22)}${r.view.padEnd(20)} FAILED ${r.failed}` : r.b.padEnd(22) + r.view.padEnd(20) + String(r.differ).padStart(9) + r.pct.toFixed(3).padStart(8) + String(r.over1).padStart(10) + r.pct8.toFixed(3).padStart(8) + r.mean.toFixed(2).padStart(9) + String(r.max).padStart(5) + (r.outside == null ? '-' : String(r.outside)).padStart(17));
if (errs.length) lines.push('PAGE ERRORS: ' + [...new Set(errs)].slice(0, 6).join(' | '));
const text = lines.join('\n'); console.log(text);
fs.writeFileSync(path.join(OUT, 'off.txt'), text + '\n'); fs.writeFileSync(path.join(OUT, 'off.json'), JSON.stringify(rows, null, 1));
await browser.__done();
process.exit(GATE && rows.some(r => r.failed || (r.outside ?? r.differ) > MAXPX) ? 1 : 0);
