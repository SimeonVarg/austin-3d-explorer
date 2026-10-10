/**
 * night-eye.mjs - the night city as a person sees it: shimmer on far lights, stillness on near ones, glare,
 * and a night that holds still for the picture checks.  docs/night-eye-2026-10-10.md has the research.
 *
 *   node night-eye.mjs --only determinism   two loads of tower-night, frozen and not: how much did it move?
 *   node night-eye.mjs --only pictures      before/after at night (spawn, tower, two street-level cameras)
 *   node night-eye.mjs --only sequence      8 frames, 0.25 s apart: variance of far lights against near ones
 *   node night-eye.mjs --only cost          ms per frame with each part on/off (interleaved, minimum of reps)
 *   node night-eye.mjs --only live          the repaint ticker: frames per second on a parked night camera
 *   node night-eye.mjs                      all of them, one after the other
 *
 * Needs a graphics card for the cost numbers (the AWS runner: scripts/aws-gpu/README.md). The others work on any
 * renderer, slowly. Writes pictures and night-eye.json to $VERIFY_OUT (default ./night-eye-out). Exit 1 when a
 * claim fails. The claims are the PASS/FAIL lines; nothing here weakens another check.
 */
import { chromium } from 'playwright-core';
import { launch, BASE } from './chrome.mjs';
import { decodePNG } from './lib/png.mjs';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const ONLY = (opt('--only', 'determinism,pictures,sequence,live,cost')).split(',');
const OUT = path.resolve(process.env.VERIFY_OUT || opt('--out', 'night-eye-out'));
fs.mkdirSync(OUT, { recursive: true });

// ---- every number a claim rests on, in one place --------------------------------------------------
export const TUNE = {
  common: 'intro=0&drift=0&namelabels=0&facadepace=0&timeofdaypace=0',
  poses: {
    'spawn-night': { p: 0.90, center: [-97.7434, 30.2857], zoom: 16.5, pitch: 64, bearing: 90 },
    'tower-night': { p: 1.0, center: [-97.73932, 30.28601], zoom: 17.2, pitch: 66, bearing: 180 },
    // Street level: a person on the Drag, and a person on a West Campus roof looking east over the city.
    'drag-eye': { p: 0.95, center: [-97.74180, 30.28680], zoom: 19.6, pitch: 80, bearing: 356 },
    'west-far': { p: 0.95, center: [-97.74330, 30.28270], zoom: 17.0, pitch: 76, bearing: 90 },
    // A far skyline: downtown, one to three kilometres away, from a low camera south of campus.
    'skyline': { p: 0.95, center: [-97.74300, 30.27400], zoom: 15.4, pitch: 80, bearing: 5 },
  },
  determinism: { pose: 'tower-night', loads: 2, tolerance: 12 },
  sequence: { pose: 'west-far', frames: 8, stepMs: 250, nearM: 250, farM: 900, litLuma: 70,
              minFarOverNear: 3, minFarCv: 0.03, maxNearCv: 0.01, farMaxM: 6000, warmMargin: 8, offSdMax: 2.5 },
  cost: { pose: 'tower-night', reps: 7, frames: 24, maxExtraMs: 2.0 },
  live: { seconds: 3, minFps: 8, pose: 'tower-night' },
};

const results = []; // { name, ok, detail }
const report = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? ' PASS' : '*FAIL'}  ${name}${detail ? '  ' + detail : ''}`); };

// ---- a PNG writer (side-by-sides), because the harness has a reader and no dependencies -----------
const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return b => { let c = -1; for (const x of b) c = t[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }; })();
function encodePNG(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy ? rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3) : raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1); }
  const chunk = (type, data) => { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(type, 4, 'ascii'); data.copy(b, 8); b.writeUInt32BE(CRC(b.subarray(4, 8 + data.length)), 8 + data.length); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function rgbOf(img) { const o = Buffer.alloc(img.width * img.height * 3); for (let i = 0, j = 0; i < img.data.length; i += img.bpp, j += 3) { o[j] = img.data[i]; o[j + 1] = img.data[i + 1]; o[j + 2] = img.data[i + 2]; } return o; }
function sideBySide(files, outFile) {
  const imgs = files.map(f => decodePNG(f)); const w = imgs[0].width, h = imgs[0].height;
  const out = Buffer.alloc(w * imgs.length * h * 3);
  imgs.forEach((im, k) => { const rgb = rgbOf(im); for (let y = 0; y < h; y++) rgb.copy(out, (y * w * imgs.length + k * w) * 3, y * w * 3, (y + 1) * w * 3); });
  fs.writeFileSync(outFile, encodePNG(w * imgs.length, h, out));
}
const diff = (fa, fb, tol, outFile) => {
  const A = decodePNG(fa), B = decodePNG(fb); let n = 0, any = 0, max = 0;
  const vis = outFile ? Buffer.alloc(A.width * A.height * 3) : null, grid = new Array(8 * 5).fill(0);
  for (let i = 0, px = 0; i < A.data.length; i += A.bpp, px++) {
    const d = Math.max(Math.abs(A.data[i] - B.data[i]), Math.abs(A.data[i + 1] - B.data[i + 1]), Math.abs(A.data[i + 2] - B.data[i + 2]));
    if (d > tol) { n++; const x = px % A.width, y = (px / A.width) | 0; grid[Math.floor(y * 5 / A.height) * 8 + Math.floor(x * 8 / A.width)]++; }
    if (d > 0) any++; if (d > max) max = d;
    if (vis) { if (d > 0) { vis[px * 3] = 255; vis[px * 3 + 1] = 0; vis[px * 3 + 2] = 255; } else { vis[px * 3] = A.data[i] >> 2; vis[px * 3 + 1] = A.data[i + 1] >> 2; vis[px * 3 + 2] = A.data[i + 2] >> 2; } }
  }
  if (vis) fs.writeFileSync(outFile, encodePNG(A.width, A.height, vis));
  const total = A.width * A.height; return { pctOver: +(100 * n / total).toFixed(4), pctAny: +(100 * any / total).toFixed(4), max, gridPctOver: grid.map(c => +(100 * c / (total / 40)).toFixed(1)) };
};

// ---- the browser side of things ---------------------------------------------------------------------
const browser = await launch(chromium, { maxMs: Number(process.env.VERIFY_MAX_MS) || 40 * 60 * 1000 });
const errors = [];

async function open(query) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message.slice(0, 300)));
  await page.goto(`${BASE}/_harness.html?${TUNE.common}${query ? '&' + query : ''}`, { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const m = window.__map; if (!m || !m.getSource('austin-buildings')) return false;
    return ['austin-buildings', 'austin-ground', 'austin-trees', 'austin-roofscape', 'austin-tower', 'austin-westcampus', 'austin-drag', 'austin-arts', 'austin-moody', 'austin-stadium']
      .every(s => !m.getSource(s) || m.isSourceLoaded(s));
  }, null, { timeout: 120000 }).catch(() => console.log('WARN: sources not all loaded'));
  await page.waitForTimeout(4000);
  await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
  await page.waitForFunction(() => { const m = window.__map; if (m.isEasing && m.isEasing()) return false; try { if (window.__fly.eye().driving) return false; } catch (e) {} return true; }, null, { timeout: 40000 }).catch(() => {});
  return page;
}
/** Put the camera and the hour where a pose says, then wait the way shot.mjs waits (walls, apartments, shadows). */
async function settle(page, pose) {
  await page.evaluate(s => {
    const m = window.__map;
    if (m.isEasing && m.isEasing()) m.stop();
    m.jumpTo({ center: s.center, zoom: s.zoom, pitch: s.pitch, bearing: s.bearing });
    const sl = document.getElementById('tod-slider'); if (sl) sl.value = String(s.p);
    window.applyTimeOfDay(m, s.p);
  }, pose);
  await page.waitForTimeout(4000);
  await page.evaluate(() => new Promise(r => { const m = window.__map; if (m.loaded()) return r(); m.once('idle', () => r()); setTimeout(() => r(), 15000); }));
  await page.waitForFunction(() => !(window.CityLighting && window.CityLighting.stats && window.CityLighting.stats.shadowProxyBuilding), null, { timeout: 60000, polling: 100 }).catch(() => {});
  const t0 = Date.now(); let quiet = 0;
  while (quiet < 3 && Date.now() - t0 < 60000) {
    const b = await page.evaluate(() => { const P = window.__facadePace, A = window.slopesApartments && window.slopesApartments.count; return !!((P && P.busy) || (A && !A.done)); });
    quiet = b ? 0 : quiet + 1; await page.waitForTimeout(500);
  }
  // The lamp set follows the road tiles that are loaded; wait until its count has stopped changing (3 equal reads, 1.5 s apart).
  { let last = -1, same = 0; const t1 = Date.now();
    while (same < 3 && Date.now() - t1 < 90000) { const c = await page.evaluate(() => window.__nightLights && window.__nightLights.count); same = c === last ? same + 1 : 0; last = c; await page.waitForTimeout(1500); } }
  await page.evaluate(() => window.__map.triggerRepaint());
  await page.waitForTimeout(1500);
}
/** Wait until the picture itself has stopped changing: with the clock held and the shimmer off, two screenshots 2 s apart must be the same bytes.
 *  A scene still streaming in (far tiles, outer buildings) makes every "variance over time" number a lie, and on a slower machine it is. */
async function waitStable(page, maxMs = 150000) {
  await page.evaluate(() => { window.CityNight.eye.twinkle = 0; window.CityNight.eye.drift = false; window.CityNight.hold(1000); });
  const t0 = Date.now(); let tries = 0;
  for (;;) {
    await page.evaluate(() => new Promise(r => { window.__map.once('render', () => requestAnimationFrame(() => requestAnimationFrame(() => r()))); window.__map.triggerRepaint(); }));
    const a = await page.screenshot(); await page.waitForTimeout(2000); const b = await page.screenshot(); tries++;
    if (Buffer.compare(a, b) === 0) { console.log(`  scene stable after ${tries} tries, ${Math.round((Date.now() - t0) / 1000)} s`); return true; }
    if (Date.now() - t0 > maxMs) { console.log(`  WARN: scene still changing after ${Math.round(maxMs / 1000)} s`); return false; }
  }
}
async function shot(page, file) { await page.screenshot({ path: file }); await page.waitForTimeout(500); await page.screenshot({ path: file }); return file; }

const stage = async (name, fn) => {
  if (!ONLY.includes(name)) return;
  try { await fn(); } catch (e) { report(`stage ${name} ran to the end`, false, String(e && e.stack || e).slice(0, 600)); }
};
const data = { when: new Date().toISOString(), tune: TUNE };
const gpu = async page => page.evaluate(() => { const c = document.createElement('canvas'); const g = c.getContext('webgl'); const e = g && g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; });

// ======================================================================================================
// 1. DETERMINISM: two loads of the same page, same camera, same hour.
// ======================================================================================================
await stage('determinism', async () => {
  const D = TUNE.determinism, pose = TUNE.poses[D.pose], dir = path.join(OUT, 'determinism'); fs.mkdirSync(dir, { recursive: true });
  const ALL = { before: 'nighteye=0', after_unfrozen: '', after_frozen: 'nightfreeze=1', after_frozen_seed7: 'nightseed=7',
    // diagnosis arms: switch one part off at a time to find what still moves in a frozen night
    frozen_eye0: 'nightfreeze=1&nighteye=0', frozen_glare0: 'nightfreeze=1&glare=0', frozen_tw0: 'nightfreeze=1&twinkle=0',
    frozen_drift0: 'nightfreeze=1&nightdrift=0', frozen_colour0: 'nightfreeze=1&nightcolour=0', frozen_ae0: 'nightfreeze=1|ae0' };
  const want = (opt('--arms', 'before,after_unfrozen,after_frozen,after_frozen_seed7')).split(/[,&+]/);   // '&' or '+' so an arm list can ride in a comma-separated workflow input
  const arms = Object.fromEntries(want.map(k => [k, ALL[k]]));
  data.determinism = {};
  for (const [arm, q] of Object.entries(arms)) {
    const files = [], bare = [];
    for (let i = 0; i < D.loads; i++) {
      const [qq, flag] = String(q).split('|');
      const page = await open(qq); if (flag === 'ae0') await page.evaluate(() => { window.GFX.autoExposure = false; window.applyGraphics(); });
      await settle(page, pose);
      console.log(`  ${arm}-${i} exposure ${JSON.stringify(await page.evaluate(() => window.__ae && window.__ae()))} lamps ${await page.evaluate(() => window.__nightLights && window.__nightLights.count)}`);
      files.push(await shot(page, path.join(dir, `${arm}-${i}.png`)));
      // The same load again with the name labels and the page's own buttons hidden: they are separate systems with their own timing (labels
      // fade in at load-dependent moments), and what this claim is about is the night city under them.
      await page.evaluate(() => { for (const l of window.__map.getStyle().layers) if (l.type === 'symbol') window.__map.setLayoutProperty(l.id, 'visibility', 'none'); });
      await page.addStyleTag({ content: 'body > *:not(#map) { visibility: hidden !important; }' });
      await page.evaluate(() => new Promise(r => { window.__map.once('render', () => requestAnimationFrame(() => requestAnimationFrame(() => r()))); window.__map.triggerRepaint(); }));
      await page.waitForTimeout(1500);
      bare.push(await shot(page, path.join(dir, `${arm}-nolabels-${i}.png`)));
      if (i === 0 && arm === 'before') data.renderer = await gpu(page);
      await page.close();
    }
    const d = diff(files[0], files[1], D.tolerance, path.join(dir, `moved-${arm}.png`));
    const db = diff(bare[0], bare[1], D.tolerance, path.join(dir, `moved-${arm}-nolabels.png`));
    data.determinism[arm] = d; data.determinism[arm + '-nolabels'] = db;
    console.log(`determinism ${arm.padEnd(18)} moved ${d.pctOver}% of pixels by more than ${D.tolerance}; ${d.pctAny}% by any amount; biggest change ${d.max}/255; share moved per cell (8x5) ${JSON.stringify(d.gridPctOver)}`);
    console.log(`determinism ${(arm + ' (no labels)').padEnd(18)} moved ${db.pctOver}% over ${D.tolerance}; ${db.pctAny}% by any amount; biggest change ${db.max}/255`);
  }
  if (data.determinism.after_frozen) {
    report('determinism: the frozen night city moves 0% between two loads (labels and buttons hidden)', data.determinism['after_frozen-nolabels'].pctAny === 0, `${data.determinism['after_frozen-nolabels'].pctAny}% any, ${data.determinism['after_frozen-nolabels'].pctOver}% over ${D.tolerance}`);
    report('determinism: the frozen page as a person sees it, labels included (their timing is a separate system)', data.determinism.after_frozen.pctOver <= 0.1, `${data.determinism.after_frozen.pctAny}% any, ${data.determinism.after_frozen.pctOver}% over ${D.tolerance}`);
  }
  if (data.determinism.after_frozen_seed7) report('determinism: a different seed is a different night (the switch does something)', diff(path.join(dir, 'after_frozen-0.png'), path.join(dir, 'after_frozen_seed7-0.png'), 0).pctAny > 0);
});

// ======================================================================================================
// 2. PICTURES: before and after, frozen, from four cameras.
// ======================================================================================================
await stage('pictures', async () => {
  const dir = path.join(OUT, 'pictures'); fs.mkdirSync(dir, { recursive: true });
  data.pictures = {};
  const arms = { before: 'nighteye=0&nightfreeze=1', after: 'nightfreeze=1', 'after-t2': 'nightfreeze=1' };
  const pages = {};
  for (const arm of ['before', 'after']) pages[arm] = await open(arms[arm]);
  for (const [name, pose] of Object.entries(TUNE.poses)) {
    for (const arm of ['before', 'after']) { await settle(pages[arm], pose); await shot(pages[arm], path.join(dir, `${arm}-${name}.png`)); }
    const d = diff(path.join(dir, `before-${name}.png`), path.join(dir, `after-${name}.png`), 12);
    sideBySide([path.join(dir, `before-${name}.png`), path.join(dir, `after-${name}.png`)], path.join(dir, `side-${name}.png`));
    data.pictures[name] = d;
    console.log(`pictures ${name.padEnd(12)} changed ${d.pctOver}% of pixels (over 12), max ${d.max}`);
  }
  data.shaderFailures = await pages.after.evaluate(() => window.CityLighting && window.CityLighting.stats.failures);
  report('pictures: no shader failed to build', Array.isArray(data.shaderFailures) && data.shaderFailures.length === 0, JSON.stringify(data.shaderFailures));
  for (const p of Object.values(pages)) await p.close();
});

// ======================================================================================================
// 2b. COLOUR: the mean colour of the lit pixels over downtown (offices) and over West Campus (homes), old night against new.
// ======================================================================================================
await stage('colour', async () => {
  const dir = path.join(OUT, 'colour'); fs.mkdirSync(dir, { recursive: true });
  const POSES = { 'offices-downtown': { p: 0.95, center: [-97.74300, 30.26900], zoom: 16.2, pitch: 62, bearing: 20 },
                  'homes-westcampus': { p: 0.95, center: [-97.74330, 30.28270], zoom: 16.6, pitch: 62, bearing: 0 } };
  data.colour = {};
  const pages = { before: await open('nighteye=0&nightfreeze=1'), after: await open('nightfreeze=1') };
  for (const [name, pose] of Object.entries(POSES)) for (const arm of ['before', 'after']) {
    await settle(pages[arm], pose); const f = await shot(pages[arm], path.join(dir, `${arm}-${name}.png`));
    const im = decodePNG(f); let n = 0, r = 0, g = 0, b = 0;
    for (let i = 0; i < im.data.length; i += im.bpp) { const l = 0.2126 * im.data[i] + 0.7152 * im.data[i + 1] + 0.0722 * im.data[i + 2]; if (l >= 110) { n++; r += im.data[i]; g += im.data[i + 1]; b += im.data[i + 2]; } }
    const m = [r / n, g / n, b / n].map(v => +v.toFixed(1));
    (data.colour[name] ||= {})[arm] = { litPixels: n, meanRGB: m, blueOverRed: +(m[2] / m[0]).toFixed(3) };
    console.log(`colour ${name.padEnd(17)} ${arm.padEnd(6)} ${n} lit pixels, mean rgb(${m}), blue/red ${(m[2] / m[0]).toFixed(3)}`);
  }
  const d = k => data.colour['offices-downtown'][k].blueOverRed - data.colour['homes-westcampus'][k].blueOverRed;
  console.log(`colour: offices minus homes, blue/red: before ${d('before').toFixed(3)}, after ${d('after').toFixed(3)}`);
  report('colour: offices read cooler than homes by more after than before', d('after') > d('before') + 0.02, `${d('before').toFixed(3)} -> ${d('after').toFixed(3)}`);
  for (const p of Object.values(pages)) await p.close();
});

// ======================================================================================================
// 2c. MOVIE: the frames of an animated before | after (the owner judges motion from motion). 6 s at 15 fps, a hand-stepped clock.
//     The old night does not move, so it is one frame. Compose with scripts/verify/night-eye-movie.py.
// ======================================================================================================
await stage('movie', async () => {
  const M = { views: (opt('--views', 'skyline,west-far')).split(/[,&+]/), fps: 15, seconds: 6 };
  const dir = path.join(OUT, 'movie'); fs.mkdirSync(dir, { recursive: true });
  const before = await open('nighteye=0&nightfreeze=1'), after = await open('nightfreeze=1&twinkle=1');
  for (const v of M.views) {
    const pose = TUNE.poses[v];
    await settle(before, pose); await before.screenshot({ path: path.join(dir, `${v}-before.jpg`), type: 'jpeg', quality: 90 });
    await settle(after, pose); await waitStable(after);
    console.log('  graphics state', JSON.stringify(await after.evaluate(() => { const G = window.GFX || {}; const fx = document.getElementById('fx-canvas'); return { bloom: G.bloom, godRays: G.godRays, flare: G.flare, autoExposure: G.autoExposure, renderScale: G.renderScale, fxCanvas: !!fx, fxBlank: fx && fx.dataset.blank, preserve: (() => { try { return window.__map.painter.context.gl.getContextAttributes().preserveDrawingBuffer; } catch (e) { return null; } })() }; })));
    // the glare alone: the same frozen frame with the glare lobes off and on (lossless), so the skirt can be drawn and measured
    for (const g of [0, 1, 10]) {
      // The effects canvas (bloom and the glare lobes) is redrawn when the camera or the hour moves, not on every frame: nudge the bearing by a ten-thousandth of a degree.
      await after.evaluate(g => { window.CityNight.eye.glare = g; const m = window.__map; m.jumpTo({ bearing: m.getBearing() + (g ? 0.0001 : -0.0001) }); window.CityNight.hold(1000); }, g);
      await after.evaluate(() => new Promise(r => { window.__map.once('render', () => requestAnimationFrame(() => requestAnimationFrame(() => r()))); window.__map.triggerRepaint(); }));
      for (let rep = 0; rep < 3; rep++) { await after.waitForTimeout(500); await after.evaluate(() => window.__map.triggerRepaint()); }   // the effects canvas is redrawn on a later frame, not always the first
      await after.waitForTimeout(800); await after.screenshot({ path: path.join(dir, `${v}-glare${g}.png`) });
      const u = await after.evaluate(() => { const c = document.getElementById('fx-canvas'); return c ? c.toDataURL('image/png') : null; });
      if (u) fs.writeFileSync(path.join(dir, `${v}-glare${g}-fx.png`), Buffer.from(u.split(',')[1], 'base64'));
    }
    await after.evaluate(() => { window.CityNight.eye.twinkle = 1; window.CityNight.eye.glare = 1; });
    for (let k = 0; k < M.fps * M.seconds; k++) {
      await after.evaluate(ms => window.CityNight.hold(ms), 1000 + Math.round(k * 1000 / M.fps));
      await after.evaluate(() => new Promise(r => { window.__map.once('render', () => requestAnimationFrame(() => requestAnimationFrame(() => r()))); window.__map.triggerRepaint(); }));
      await after.waitForTimeout(120);
      await after.screenshot({ path: path.join(dir, `${v}-after-${String(k).padStart(3, '0')}.jpg`), type: 'jpeg', quality: 90 });
    }
    console.log(`movie ${v}: ${M.fps * M.seconds} frames written`);
  }
  data.movie = { views: M.views, fps: M.fps, seconds: M.seconds };
  await before.close(); await after.close();
});

// ======================================================================================================
// 2d. DEBUG: lit window texels painted by the path that draws them (CityNight.eye.debug), to see which lights the shimmer reaches.
// ======================================================================================================
await stage('debug', async () => {
  const dir = path.join(OUT, 'debug'); fs.mkdirSync(dir, { recursive: true });
  const page = await open('nightfreeze=1&twinkle=1'); data.debug = {};
  for (const name of (opt('--views', 'west-far,skyline,tower-night,spawn-night')).split(/[,&+]/)) {
    await settle(page, TUNE.poses[name]); await waitStable(page);
    await page.evaluate(() => { window.CityNight.eye.debug = true; window.CityNight.hold(1000); });
    await page.evaluate(() => new Promise(r => { window.__map.once('render', () => requestAnimationFrame(() => requestAnimationFrame(() => r()))); window.__map.triggerRepaint(); }));
    await page.waitForTimeout(800);
    const f = path.join(dir, `${name}.png`); await page.screenshot({ path: f });
    await page.evaluate(() => { window.CityNight.eye.debug = false; });
    const im = decodePNG(f); const c = { green: 0, red: 0, yellow: 0, cyan: 0 };
    for (let i = 0; i < im.data.length; i += im.bpp) { const r = im.data[i], g = im.data[i + 1], b = im.data[i + 2];
      if (g > 200 && r < 60 && b < 60) c.green++; else if (r > 200 && g < 60 && b < 60) c.red++; else if (r > 200 && g > 200 && b < 60) c.yellow++; else if (g > 200 && b > 200 && r < 60) c.cyan++; }
    data.debug[name] = c; console.log(`debug ${name.padEnd(12)} MapLibre glass ${c.green}, bright non-glass ${c.red}, authored ${c.yellow}, landmark ${c.cyan}`);
  }
  await page.close();
});

// ======================================================================================================
// 3. SEQUENCE: eight frames, 0.25 s apart, on a frozen clock that is stepped by hand.
// ======================================================================================================
await stage('sequence', async () => {
  const S = TUNE.sequence, pose = TUNE.poses[opt('--pose', S.pose)], dir = path.join(OUT, 'sequence'); fs.mkdirSync(dir, { recursive: true });
  const page = await open('nightfreeze=1&twinkle=1'); await settle(page, pose);
  // The name labels and the page's buttons fade in and out on their own timing and are the same warm-white as a lit window: they are not lights.
  await page.evaluate(() => { for (const l of window.__map.getStyle().layers) if (l.type === 'symbol') window.__map.setLayoutProperty(l.id, 'visibility', 'none'); });
  await page.addStyleTag({ content: 'body > *:not(#map) { visibility: hidden !important; }' });
  data.sceneStable = await waitStable(page);
  const eyeSet = opt('--eye', null);   // CityNight.eye overrides for an experiment, key=value joined by +, e.g. windowAmp=0.5+farM=1400
  if (eyeSet) await page.evaluate(o => Object.assign(window.CityNight.eye, o), Object.fromEntries(eyeSet.split(/[;+]/).map(kv => kv.split('=')).map(([k, v]) => [k, Number(v)])));   // --eye windowAmp=0.22+farM=1400
  data.sequenceEye = await page.evaluate(() => { const e = window.CityNight.eye; return { windowAmp: e.windowAmp, lampAmp: e.lampAmp, nearM: e.nearM, farM: e.farM, glare: e.glare }; });
  // Distance of each screen row to the camera, along the ground (an upper bound for a wall on that row).
  const rowDist = await page.evaluate(() => {
    // Camera = the map centre pulled back along the view by cameraToCenterDistance, at the pitch (this MapLibre has no getFreeCameraOptions here).
    const m = window.__map, tr = m.transform, c = m.getCenter(), dc = tr.cameraToCenterDistance / tr.pixelsPerMeter;
    const pitch = m.getPitch() * Math.PI / 180, brg = m.getBearing() * Math.PI / 180, back = dc * Math.sin(pitch), alt = dc * Math.cos(pitch);
    const cam = {};
    cam.lng = c.lng - (Math.sin(brg) * back) / (111320 * Math.cos(c.lat * Math.PI / 180)); cam.lat = c.lat - (Math.cos(brg) * back) / 110540;
    const H = m.getCanvas().clientHeight, W = m.getCanvas().clientWidth, out = [];
    const toM = (a, b) => Math.hypot((a.lng - b.lng) * 111320 * Math.cos(b.lat * Math.PI / 180), (a.lat - b.lat) * 110540);
    for (let y = 0; y < H; y++) { let d = null; try { const g = m.unproject([W / 2, y]); if (g && isFinite(g.lng)) d = Math.hypot(toM(g, cam), alt); } catch (e) {} out.push(d); }
    return out;
  });
  console.log('row distances (m) at rows 450 / 600 / 800 / 899:', [450, 600, 800, 899].map(y => rowDist[y] && Math.round(rowDist[y])));
  // Where the modulation can be lost, measured on the same frames: the map's own canvas (before the page's colour grade and bloom)
  // and the final picture as a person sees it. `--variants "default;windowAmp=0.22+farM=1400"` measures several settings on ONE
  // loaded page, one after another against one shimmer-off reference, so a comparison between them is not a comparison of two loads.
  const STAGES = { raw: 60, final: 70 };
  const grab = async (stage, file) => {
    if (stage === 'raw') { const u = await page.evaluate(() => window.__map.getCanvas().toDataURL('image/png')); fs.writeFileSync(file, Buffer.from(u.split(',')[1], 'base64')); }
    else await page.screenshot({ path: file });
  };
  const frames = [];
  const capture = async (label, apply) => {
    await page.evaluate(apply.fn, apply.arg);
    for (let k = 0; k < S.frames; k++) {
      await page.evaluate(ms => window.CityNight.hold(ms), 1000 + k * S.stepMs);
      await page.evaluate(() => new Promise(r => { window.__map.once('render', () => requestAnimationFrame(() => requestAnimationFrame(() => r()))); window.__map.triggerRepaint(); }));
      await page.waitForTimeout(400);
      for (const st of Object.keys(STAGES)) { const f = path.join(dir, `${st}-${label}-${k}.png`); await grab(st, f); frames.push([st, label, k, f]); }
    }
  };
  const base = { twinkle: 1, drift: false };
  const parseEye = str => str === 'default' ? {} : Object.fromEntries(str.split('+').map(kv => kv.split('=')).map(([k, v]) => [k, Number(v)]));
  const variants = opt('--variants', 'default').split(/[,;]/);
  const defaults = await page.evaluate(() => { const e = window.CityNight.eye; return { windowAmp: e.windowAmp, lampAmp: e.lampAmp, nearM: e.nearM, farM: e.farM, glare: e.glare }; });
  await capture('off', { fn: () => { window.CityNight.eye.twinkle = 0; window.CityNight.eye.drift = false; }, arg: null });
  for (const v of variants) await capture(v, { fn: ({ over, defs, base }) => { Object.assign(window.CityNight.eye, defs, over, base); }, arg: { over: parseEye(v), defs: defaults, base } });
  await capture('off-again', { fn: () => { window.CityNight.eye.twinkle = 0; }, arg: null });
  // per pixel: lit in the reference (shimmer off, frame 0) -> temporal mean and std of luma over the frames
  const stats = (st, label, mapFile) => {
    const pick = lb => frames.filter(f => f[0] === st && f[1] === lb).map(f => decodePNG(f[3]));
    const imgs = pick(label), ref = decodePNG(frames.find(f => f[0] === st && f[1] === 'off' && f[2] === 0)[3]);
    const offs = pick('off').concat(pick('off-again'));   // pixels that move a lot with the shimmer OFF (labels fading, stars) are not the shimmer: they are left out; the small noise that remains (a bloom update, one level) is measured as the floor
    const lumaSd = (set, i) => { const ls = set.map(im => 0.2126 * im.data[i] + 0.7152 * im.data[i + 1] + 0.0722 * im.data[i + 2]); const mu = ls.reduce((a, c) => a + c, 0) / ls.length; return Math.sqrt(ls.reduce((a, c) => a + (c - mu) * (c - mu), 0) / ls.length); };
    let excluded = 0;
    const W = ref.width, H = ref.height, hCss = rowDist.length, band = { near: { n: 0, s: 0, cv: 0, c2: 0, vary: 0 }, far: { n: 0, s: 0, cv: 0, c2: 0, vary: 0 } };
    const vis = mapFile ? Buffer.alloc(W * H * 3) : null;
    for (let y = 0; y < H; y++) {
      const d = rowDist[Math.min(hCss - 1, Math.floor(y * hCss / H))];
      const b = d == null ? null : d < S.nearM ? 'near' : (d > S.farM && d < S.farMaxM) ? 'far' : null;   // rows above the horizon give a huge distance: stars and sky are not lights
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * ref.bpp;
        const l0 = 0.2126 * ref.data[i] + 0.7152 * ref.data[i + 1] + 0.0722 * ref.data[i + 2];
        const lit = l0 >= STAGES[st] && ref.data[i] >= ref.data[i + 2] + S.warmMargin;   // warm: a window or a lamp, not a white star or a pale wall
        let mu = 0, ss = 0, sd = 0;
        if (lit && (b || vis) && lumaSd(offs, i) > S.offSdMax) { excluded++; if (vis) { const o = (y * W + x) * 3; vis[o] = 255; vis[o + 1] = 200; } continue; }
        if (lit && (b || vis)) { const ls = imgs.map(im => 0.2126 * im.data[i] + 0.7152 * im.data[i + 1] + 0.0722 * im.data[i + 2]); mu = ls.reduce((a, c) => a + c, 0) / ls.length; ls.forEach(v => ss += (v - mu) * (v - mu)); sd = Math.sqrt(ss / ls.length); }
        if (lit && b) { const B = band[b]; B.n++; B.s += sd * sd; const cv = sd / Math.max(1, mu); B.cv += cv; B.c2 += cv * cv; if (cv > 0.01) B.vary++; }
        if (vis) { const o = (y * W + x) * 3; if (!lit) { vis[o] = ref.data[i] >> 2; vis[o + 1] = ref.data[i + 1] >> 2; vis[o + 2] = ref.data[i + 2] >> 2; } else if (sd / Math.max(1, mu) > 0.01) { vis[o + 1] = 255; } else { vis[o] = 255; vis[o + 2] = 255; } }
      }
    }
    if (vis) fs.writeFileSync(mapFile, encodePNG(W, H, vis));
    for (const B of [band.near, band.far]) { B.variance = B.n ? +(B.s / B.n).toFixed(3) : null; B.cvMean = B.n ? +(B.cv / B.n).toFixed(4) : null; B.cvRms = B.n ? +Math.sqrt(B.c2 / B.n).toFixed(4) : null; B.shareVarying = B.n ? +(B.vary / B.n).toFixed(3) : null; delete B.s; delete B.cv; delete B.c2; delete B.vary; }
    band.leftOut = excluded;
    return band;
  };
  data.sequence = { frames: S.frames, stepMs: S.stepMs, nearM: S.nearM, farM: S.farM, farMaxM: S.farMaxM, defaults, variants: {} };
  for (const v of variants) {
    data.sequence.variants[v] = {};
    for (const st of Object.keys(STAGES)) {
      const on = stats(st, v, v === variants[0] && st === 'final' ? path.join(dir, 'where-it-moves.png') : null);
      data.sequence.variants[v][st] = on;
      console.log(`sequence [${v}] ${st.padEnd(5)} near cv ${on.near.cvMean} (n ${on.near.n}, share moving ${on.near.shareVarying})  far cv ${on.far.cvMean} rms ${on.far.cvRms} (n ${on.far.n}, share moving ${on.far.shareVarying})  left out ${on.leftOut}`);
    }
  }
  const off = stats('final', 'off'), offAgain = stats('final', 'off-again');
  data.sequence.floor = { final: { off, offAgain } };
  console.log(`sequence noise floor (shimmer off) near cv ${off.near.cvMean}, far cv ${off.far.cvMean} rms ${off.far.cvRms}`);
  const first = variants[0], on = data.sequence.variants[first].final;
  report('sequence: lit pixels were found in the far band (and the near band where the view has one)', on.far.n > 50 && (rowDist.some(d => d != null && d < S.nearM) ? on.near.n > 50 : true), `near ${on.near.n}, far ${on.far.n}`);
  report('sequence: with shimmer off nothing moves, at the start and again at the end (the measurement is clean)', (off.far.cvRms ?? 0) <= 0.02 && (off.near.cvRms ?? 0) <= 0.02 && (offAgain.far.cvRms ?? 0) <= 0.02, `far ${off.far.cvRms}/${offAgain.far.cvRms}, near ${off.near.cvRms}/${offAgain.near.cvRms} (coefficient of variation, rms)`);
  report(`sequence [${first}]: far lights shimmer in the final frame`, on.far.cvMean >= S.minFarCv, `mean coefficient of variation ${on.far.cvMean} (want >= ${S.minFarCv}); ${on.far.shareVarying} of lit pixels move`);
  report(`sequence [${first}]: near lights hold still in the final frame`, on.near.cvMean == null || on.near.cvMean <= S.maxNearCv, `coefficient of variation ${on.near.cvMean} (want <= ${S.maxNearCv})`);
  report(`sequence [${first}]: far varies much more than near`, on.near.variance == null || on.far.variance / Math.max(on.near.variance, 0.01) >= S.minFarOverNear, `variance ratio ${on.near.variance == null ? 'n/a' : (on.far.variance / Math.max(on.near.variance, 0.01)).toFixed(1)} (want >= ${S.minFarOverNear})`);
  await page.close();
});

// ======================================================================================================
// 4. LIVE: the repaint ticker redraws a parked night camera, and only then.
// ======================================================================================================
await stage('live', async () => {
  const L = TUNE.live;
  // [label, query, what to do to the page after load, expect redraws?]. The default arm passes no shimmer switch at all: it is what a
  // visitor on a graphics card gets. The two low-tier arms put the page where a phone or an integrated chip would be.
  const arms = [
    ['card, default', '', null, true],
    ['card, twinkle=0', 'twinkle=0', null, false],
    ['card, frozen night', 'nightfreeze=1&twinkle=1', null, false],
    ['integrated chip (no card)', '', () => { window.GFX_GPU_CARD = () => false; }, false],
    ['phone profile', '', () => { window.LITE_PROFILE = Object.assign(window.LITE_PROFILE || {}, { on: true }); }, false],
  ];
  for (const [label, q, prep, want] of arms) {
    const page = await open(q); await settle(page, TUNE.poses[L.pose]);
    if (prep) { await page.evaluate(prep); await page.waitForTimeout(1500); }   // let a redraw that was already queued finish
    await page.evaluate(() => window.dispatchEvent(new Event('pointermove')));   // someone is at the screen (the ticker stops after 5 idle minutes)
    const frames = await page.evaluate(sec => new Promise(r => { let n = 0; const m = window.__map; const f = () => n++; m.on('render', f); setTimeout(() => { m.off('render', f); r(n); }, sec * 1000); }), L.seconds);
    const fps = frames / L.seconds;
    data.live = data.live || {}; data.live[label] = { frames, fps: +fps.toFixed(1) };
    console.log(`live ${label.padEnd(28)} ${frames} frames in ${L.seconds} s on a parked camera (${fps.toFixed(1)} a second)`);
    report(`live: parked night camera, ${label}: ${want ? 'redraws' : 'draws 0 extra frames'}`, want ? fps >= L.minFps : frames <= 1, `${frames} frames`);
    await page.close();
  }
});

// ======================================================================================================
// 5. COST: milliseconds a frame, each part on and off, interleaved, minimum of the reps (README rule 10).
// ======================================================================================================
await stage('cost', async () => {
  const C = TUNE.cost, pose = TUNE.poses[C.pose];
  const page = await open('nightfreeze=1&twinkle=1'); await settle(page, pose);
  data.renderer = data.renderer || await gpu(page);
  const arms = {
    all_off: { twinkle: 0, glare: 0, drift: false },
    twinkle: { twinkle: 1, glare: 0, drift: false },
    glare: { twinkle: 0, glare: 1, drift: false },
    drift: { twinkle: 0, glare: 0, drift: true },
    all_on: { twinkle: 1, glare: 1, drift: true },
  };
  const mins = {}; const all = {};
  for (let rep = 0; rep < C.reps; rep++) {
    for (const [arm, v] of Object.entries(arms)) {
      const ms = await page.evaluate(({ v, frames }) => {
        const e = window.CityNight.eye; e.twinkle = v.twinkle; e.glare = v.glare; e.drift = v.drift;
        const m = window.__map, gl = m.painter.context.gl, px = new Uint8Array(4);
        for (let i = 0; i < 3; i++) { m.redraw(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
        const t0 = performance.now();
        // a camera nudge per frame (a ten-thousandth of a degree) so the sky and effects pass runs each frame, as it does while the camera moves
        const b0 = m.getBearing();
        for (let i = 0; i < frames; i++) { window.CityNight.hold(1000 + i * 40); m.jumpTo({ bearing: b0 + (i % 2 ? 0.0001 : 0) }); m.redraw(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
        m.jumpTo({ bearing: b0 });
        return (performance.now() - t0) / frames;
      }, { v, frames: C.frames });
      (all[arm] ||= []).push(+ms.toFixed(2)); mins[arm] = Math.min(mins[arm] ?? 1e9, ms);
    }
  }
  data.cost = { msPerFrameMin: Object.fromEntries(Object.entries(mins).map(([k, v]) => [k, +v.toFixed(2)])), reps: all, frames: C.frames };
  console.log('cost (ms a frame, minimum of ' + C.reps + ' interleaved reps, ' + C.pose + ', ' + (data.renderer || '?') + ')', JSON.stringify(data.cost.msPerFrameMin));
  const extra = mins.all_on - mins.all_off;
  data.cost.extraMs = +extra.toFixed(2);
  report('cost: everything on costs at most ' + C.maxExtraMs + ' ms a frame more than everything off', extra <= C.maxExtraMs, `+${extra.toFixed(2)} ms`);
  await page.close();
});

data.errors = [...new Set(errors)].slice(0, 12);
data.results = results;
fs.writeFileSync(path.join(OUT, 'night-eye.json'), JSON.stringify(data, null, 1));
console.log('WROTE ' + path.join(OUT, 'night-eye.json'));
if (data.errors.length) console.log('PAGE ERRORS', data.errors);
await browser.__done?.();
await browser.close().catch(() => {});
process.exit(results.some(r => !r.ok) ? 1 : 0);
