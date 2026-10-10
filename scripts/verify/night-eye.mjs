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
  },
  determinism: { pose: 'tower-night', loads: 2, tolerance: 12 },
  sequence: { pose: 'west-far', frames: 8, stepMs: 250, nearM: 250, farM: 900, litLuma: 70,
              minFarOverNear: 3, minFarCv: 0.02, maxNearCv: 0.01 },
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
const diff = (fa, fb, tol) => {
  const A = decodePNG(fa), B = decodePNG(fb); let n = 0, any = 0, max = 0;
  for (let i = 0; i < A.data.length; i += A.bpp) {
    const d = Math.max(Math.abs(A.data[i] - B.data[i]), Math.abs(A.data[i + 1] - B.data[i + 1]), Math.abs(A.data[i + 2] - B.data[i + 2]));
    if (d > tol) n++; if (d > 0) any++; if (d > max) max = d;
  }
  const total = A.width * A.height; return { pctOver: +(100 * n / total).toFixed(4), pctAny: +(100 * any / total).toFixed(4), max };
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
  await page.evaluate(() => window.__map.triggerRepaint());
  await page.waitForTimeout(1500);
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
  const arms = { before: 'nighteye=0', after_unfrozen: '', after_frozen: 'nightfreeze=1', after_frozen_seed7: 'nightseed=7' };
  data.determinism = {};
  for (const [arm, q] of Object.entries(arms)) {
    const files = [];
    for (let i = 0; i < D.loads; i++) {
      const page = await open(q); await settle(page, pose);
      files.push(await shot(page, path.join(dir, `${arm}-${i}.png`)));
      if (i === 0 && arm === 'before') data.renderer = await gpu(page);
      await page.close();
    }
    const d = diff(files[0], files[1], D.tolerance);
    data.determinism[arm] = d;
    console.log(`determinism ${arm.padEnd(18)} moved ${d.pctOver}% of pixels by more than ${D.tolerance}; ${d.pctAny}% by any amount; biggest change ${d.max}/255`);
  }
  report('determinism: the frozen night moves 0% between two loads', data.determinism.after_frozen.pctAny === 0, `${data.determinism.after_frozen.pctAny}% any, ${data.determinism.after_frozen.pctOver}% over ${D.tolerance}`);
  report('determinism: a different seed is a different night (the switch does something)', diff(path.join(dir, 'after_frozen-0.png'), path.join(dir, 'after_frozen_seed7-0.png'), 0).pctAny > 0);
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
// 3. SEQUENCE: eight frames, 0.25 s apart, on a frozen clock that is stepped by hand.
// ======================================================================================================
await stage('sequence', async () => {
  const S = TUNE.sequence, pose = TUNE.poses[S.pose], dir = path.join(OUT, 'sequence'); fs.mkdirSync(dir, { recursive: true });
  const page = await open('nightfreeze=1'); await settle(page, pose);
  // Distance of each screen row to the camera, along the ground (an upper bound for a wall on that row).
  const rowDist = await page.evaluate(() => {
    const m = window.__map, cam = m.getFreeCameraOptions().position, ll = cam.toLngLat(), alt = cam.toAltitude();
    const H = m.getCanvas().clientHeight, W = m.getCanvas().clientWidth, out = [];
    const toM = (a, b) => { const dx = (a.lng - b.lng) * 111320 * Math.cos(b.lat * Math.PI / 180), dy = (a.lat - b.lat) * 110540; return Math.hypot(dx, dy); };
    for (let y = 0; y < H; y++) { let d = null; try { const g = m.unproject([W / 2, y]); if (g && isFinite(g.lng)) d = Math.hypot(toM(g, ll), alt); } catch (e) {} out.push(d); }
    return out;
  });
  const frames = [];
  for (const mode of ['on', 'off']) {
    await page.evaluate(m => { window.CityNight.eye.twinkle = m === 'on' ? 1 : 0; window.CityNight.eye.drift = false; }, mode);   // shimmer alone: the slow change is measured by its own claim
    for (let k = 0; k < S.frames; k++) {
      await page.evaluate(ms => window.CityNight.hold(ms), 1000 + k * S.stepMs);
      await page.evaluate(() => new Promise(r => { window.__map.once('render', () => requestAnimationFrame(() => requestAnimationFrame(() => r()))); window.__map.triggerRepaint(); }));
      await page.waitForTimeout(300);
      const f = path.join(dir, `${mode}-${k}.png`); await page.screenshot({ path: f }); frames.push([mode, k, f]);
    }
  }
  // per pixel: lit in the reference (twinkle off, frame 0) -> temporal mean and std of luma over the 8 frames
  const stats = mode => {
    const imgs = frames.filter(f => f[0] === mode).map(f => decodePNG(f[2])), ref = decodePNG(frames.find(f => f[0] === 'off' && f[1] === 0)[2]);
    const W = ref.width, H = ref.height, band = { near: { n: 0, s: 0, cv: 0 }, far: { n: 0, s: 0, cv: 0 } };
    for (let y = 0; y < H; y++) {
      const d = rowDist[y]; if (d == null) continue;
      const b = d < S.nearM ? 'near' : d > S.farM ? 'far' : null; if (!b) continue;
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * ref.bpp;
        const l0 = 0.2126 * ref.data[i] + 0.7152 * ref.data[i + 1] + 0.0722 * ref.data[i + 2];
        if (l0 < S.litLuma || ref.data[i] < ref.data[i + 2]) continue;      // lit and warm: a window or a lamp, not a pale wall
        let mu = 0, ss = 0; const ls = imgs.map(im => 0.2126 * im.data[i] + 0.7152 * im.data[i + 1] + 0.0722 * im.data[i + 2]);
        ls.forEach(v => mu += v); mu /= ls.length; ls.forEach(v => ss += (v - mu) * (v - mu)); const sd = Math.sqrt(ss / ls.length);
        band[b].n++; band[b].s += sd * sd; band[b].cv += sd / Math.max(1, mu);
      }
    }
    for (const b of Object.values(band)) { b.variance = b.n ? +(b.s / b.n).toFixed(3) : null; b.cv = b.n ? +(b.cv / b.n).toFixed(4) : null; delete b.s; }
    return band;
  };
  data.sequence = { on: stats('on'), off: stats('off'), frames: S.frames, stepMs: S.stepMs, nearM: S.nearM, farM: S.farM };
  const on = data.sequence.on, off = data.sequence.off;
  console.log('sequence shimmer ON  near', JSON.stringify(on.near), ' far', JSON.stringify(on.far));
  console.log('sequence shimmer OFF near', JSON.stringify(off.near), ' far', JSON.stringify(off.far));
  const ratio = on.far.variance && on.near.variance != null ? on.far.variance / Math.max(on.near.variance, 0.01) : null;
  data.sequence.farOverNear = ratio;
  report('sequence: lit pixels were found in both bands', on.near.n > 50 && on.far.n > 50, `near ${on.near.n}, far ${on.far.n}`);
  report('sequence: with shimmer off nothing moves (the measurement is clean)', off.far.variance === 0 && off.near.variance === 0, `far ${off.far.variance}, near ${off.near.variance}`);
  report('sequence: far lights shimmer', on.far.cv >= S.minFarCv, `coefficient of variation ${on.far.cv} (want >= ${S.minFarCv})`);
  report('sequence: near lights hold still', on.near.cv <= S.maxNearCv, `coefficient of variation ${on.near.cv} (want <= ${S.maxNearCv})`);
  report('sequence: far varies much more than near', ratio != null && ratio >= S.minFarOverNear, `variance ratio far/near ${ratio && ratio.toFixed(1)} (want >= ${S.minFarOverNear})`);
  await page.close();
});

// ======================================================================================================
// 4. LIVE: the repaint ticker redraws a parked night camera, and only then.
// ======================================================================================================
await stage('live', async () => {
  const L = TUNE.live;
  for (const [label, q, want] of [['shimmer on', 'twinkle=1', true], ['shimmer off', 'twinkle=0', false], ['frozen', 'nightfreeze=1&twinkle=1', false]]) {
    const page = await open(q); await settle(page, TUNE.poses[L.pose]);
    await page.evaluate(() => window.dispatchEvent(new Event('pointermove')));   // someone is at the screen (the ticker stops after 5 idle minutes)
    const fps = await page.evaluate(sec => new Promise(r => { let n = 0; const m = window.__map; const f = () => n++; m.on('render', f); setTimeout(() => { m.off('render', f); r(n / sec); }, sec * 1000); }), L.seconds);
    data.live = data.live || {}; data.live[label] = +fps.toFixed(1);
    console.log(`live ${label.padEnd(12)} ${fps.toFixed(1)} frames a second on a parked camera`);
    report(`live: parked night camera, ${label}: ${want ? 'redraws' : 'does not redraw'}`, want ? fps >= L.minFps : fps <= 1, `${fps.toFixed(1)} fps`);
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
        for (let i = 0; i < frames; i++) { window.CityNight.hold(1000 + i * 40); m.redraw(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
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
