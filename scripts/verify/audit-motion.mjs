/**
 * audit-motion.mjs — the things that only go wrong while something MOVES:
 * shadow cascades as the camera travels, the sunset handover while the time
 * slider is dragged, auto-exposure while flying, and the LOD tiers during a
 * climb. Every moving test is a frame-indexed scripted trajectory (the same
 * pose on frame i every run, whatever the fps) recorded as a CDP screencast
 * of the COMPOSITED page — sky canvas, CSS grade and all — because that is
 * what a person sees.
 *
 *   VERIFY_URL=http://127.0.0.1:8671 node audit-motion.mjs <outDir> [--tests a,b] [--lite]
 *
 * Tests: shadow (static A/Bs of the two-cascade sun shadows), sunset (the
 *        horizon crossing, fine p steps), drag (the real slider, 0.30 -> 1.0),
 *        ae (a yaw sweep at golden hour, auto-exposure on vs off),
 *        lod (a vertical climb through both detail tiers).
 *
 * Output: <outDir>/motion.json plus frames/diff maps named after the test.
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { BASE, launch } from './chrome.mjs';
import { applySwaps } from './audit-lib.mjs';
import { decodePNG } from './lib/png.mjs';

const OUT = process.argv[2];
if (!OUT) { console.error('usage: audit-motion.mjs <outDir> [--tests shadow,sunset,drag,ae,lod] [--lite]'); process.exit(2); }
const ti = process.argv.indexOf('--tests');
const TESTS = (ti > 0 ? process.argv[ti + 1] : 'shadow,sunset,drag,ae,lod').split(',');
const LITE = process.argv.includes('--lite');
const TAG = LITE ? 'lite-' : '';
fs.mkdirSync(OUT, { recursive: true });
const TMP = path.join(OUT, '_tmp');
fs.mkdirSync(TMP, { recursive: true });

// ── tiny PNG writer (diff maps) ─────────────────────────────────────
function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
function encodePNG(w, h, rgba) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const lumAt = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
function diffImages(A, B, file) {
  const w = A.width, h = A.height, out = new Uint8Array(w * h * 4);
  let changed = 0, maxd = 0, sum = 0, minx = 1e9, miny = 1e9, maxx = -1, maxy = -1;
  const rows = new Array(h).fill(0);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x, i = p * A.bpp, j = p * B.bpp;
    const d = Math.max(Math.abs(A.data[i] - B.data[j]), Math.abs(A.data[i + 1] - B.data[j + 1]), Math.abs(A.data[i + 2] - B.data[j + 2]));
    sum += d; if (d > maxd) maxd = d;
    if (d > 10) { changed++; rows[y]++; if (x < minx) minx = x; if (y < miny) miny = y; if (x > maxx) maxx = x; if (y > maxy) maxy = y; }
    const v = Math.min(255, d * 4), o = p * 4;
    out[o] = v; out[o + 1] = d > 10 ? v : v >> 1; out[o + 2] = d > 10 ? 0 : v >> 1; out[o + 3] = 255;
  }
  if (file) fs.writeFileSync(file, encodePNG(w, h, out));
  // the screen band (as fractions of height) the change lives in
  const tot = rows.reduce((s, v) => s + v, 0);
  let acc = 0, y10 = null, y90 = null;
  for (let y = 0; y < h; y++) { acc += rows[y]; if (y10 == null && acc >= tot * 0.1) y10 = y; if (y90 == null && acc >= tot * 0.9) y90 = y; }
  return { changedShare: +(changed / (w * h)).toFixed(4), meanAbs: +(sum / (w * h)).toFixed(3), max: maxd,
           bbox: changed ? [minx, miny, maxx, maxy] : null, band: tot ? [+(y10 / h).toFixed(2), +(y90 / h).toFixed(2)] : null };
}
function meanLuma(img, y0 = 0, y1 = 1) {
  let s = 0, n = 0;
  for (let y = Math.floor(y0 * img.height); y < Math.floor(y1 * img.height); y++) for (let x = 0; x < img.width; x++) { s += lumAt(img.data, (y * img.width + x) * img.bpp); n++; }
  return s / n;
}

const report = { base: BASE, lite: LITE, tests: {} };
// Written after every test, not only at the end: one long run that dies in its
// fourth test still leaves the first three measured.
const save = () => fs.writeFileSync(path.join(OUT, `${TAG}motion.json`), JSON.stringify(report, null, 1));
const browser = await launch(chromium, { gl: 'hardware', maxMs: 3600000 });
const ctx = await browser.newContext(LITE
  ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
  : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
await applySwaps(ctx);
const page = await ctx.newPage();
page.on('pageerror', e => console.log('PAGEERROR', e.message));
const T0 = Date.now();
await page.goto(BASE + '/?intro=0&drift=0&clip=1' + (LITE ? '&lite=1' : ''), { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded() && !document.getElementById('veil'), null, { timeout: 400000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
// js/app.js drops the authored buildings for the whole visit when they are not
// ready 90 s into the load (INTRO.authoredCeilingMs) — which happens on this
// laptop whenever other lanes' browsers are running, and it turns
// `APARTMENTS.on` OFF. An earlier cut of this file read that flag to decide
// whether the scene had authored buildings AT ALL and skipped the whole shadow
// test when the ceiling had fired: the one run that mattered measured nothing.
// So: ask whether the page CAN have them (the data switch, not the live flag),
// then put them back and wait, and say so.
const canApts = await page.evaluate(() => !!(window.SLOPES && window.SLOPES.on && window.APARTMENTS));
if (canApts) {
  const handoff = await page.evaluate(() => ({ on: !!window.APARTMENTS.on, group: !!(window.slopesApartments && window.slopesApartments.group), fallback: window.__intro && window.__intro.modelFallback || null }));
  if (!handoff.on || !handoff.group) {
    console.log('[audit] authored buildings were not in the scene (' + JSON.stringify(handoff) + ') - re-enabling and waiting');
    await page.evaluate(() => { window.APARTMENTS.on = true; window.applySlopesApartments(window.__map); });
  }
  await page.waitForFunction(() => window.slopesApartments && window.slopesApartments.group && window.slopesApartments.readyToReveal(), null, { timeout: 900000 });
}
const hasApts = await page.evaluate(() => !!(window.slopesApartments && window.slopesApartments.group && window.slopesApartments.count.triangles > 0));
report.authored = { canApts, hasApts, triangles: await page.evaluate(() => window.slopesApartments ? window.slopesApartments.count.triangles : 0) };
// The shadow test needs js/slopes.js (the three.js layer that owns the cascades),
// not the authored buildings; it says which scene it measured.
const hasSlopes = await page.evaluate(() => !!(window.slopes && window.slopes.sunlightStats));
console.log(`[motion] ready after ${((Date.now() - T0) / 1000).toFixed(0)} s; preset ${await page.evaluate(() => window.GFX.preset)}; authored ${JSON.stringify(report.authored)}; slopes ${hasSlopes}`);

// Page-side helpers: place the EYE (not the look-at centre) like match.mjs.
await page.evaluate(() => {
  const m = window.__map, rad = d => d * Math.PI / 180;
  // Count shadow-proxy rebuilds (js/city-lighting.js shadowProxy triangulates
  // every footprint on each rebuild; nothing else calls this after load) and
  // record main-thread long tasks.
  window.__triCalls = 0; window.__longTasks = [];
  try { const T = window.THREE, o = T.ShapeUtils.triangulateShape; T.ShapeUtils.triangulateShape = function () { window.__triCalls++; return o.apply(this, arguments); }; } catch (e) {}
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__longTasks.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: false }); } catch (e) {}
  window.__audit = {
    eyePose(lng, lat, alt, pitch, bearing) {
      const D = alt / Math.cos(rad(pitch)), lead = D * Math.sin(rad(pitch));
      const mLat = 110540, mLon = 111320 * Math.cos(rad(lat));
      const clat = lat + lead * Math.cos(rad(bearing)) / mLat, clng = lng + lead * Math.sin(rad(bearing)) / mLon;
      const c2c = m.transform.cameraToCenterDistance;
      const zoom = Math.log2(40075016.686 * Math.cos(rad(clat)) / (512 * (D / c2c)));
      return { center: [clng, clat], zoom, pitch, bearing, lead };
    },
    put(o) { m.jumpTo(o); },
    state() {
      const e = window.__fly ? window.__fly.eye() : null;
      const lod = window.LOD_TIERS ? [...window.LOD_TIERS.fine, ...window.LOD_TIERS.mid].filter(id => window.LOD_isHidden(id)) : [];
      return { p: window.__todCurrentP, alt: e ? +e.alt.toFixed(1) : null, ae: window.__ae ? window.__ae() : null,
               filter: document.getElementById('map').style.filter, shadow: window.slopes && window.slopes.sunlightStats ? window.slopes.sunlightStats() : null,
               lodHidden: lod.length, lodFine: lod.includes('props-lit') || lod.includes('trees-trunk'), lodMid: lod.includes('trees-canopy') || lod.includes('roofs-pitched'),
               zoom: +m.getZoom().toFixed(3), tri: window.__triCalls, lt: window.__longTasks.length, now: Math.round(performance.now()) };
    },
    settle(ms = 6000) {
      return new Promise(r => { let done = false; const f = () => { if (!done) { done = true; r(); } }; m.once('idle', f); setTimeout(f, ms); m.triggerRepaint(); });
    },
  };
});

async function still(name) {
  await page.evaluate(() => window.__audit.settle(8000));
  await page.waitForTimeout(1200);
  const f = path.join(TMP, name + '.png');
  await page.screenshot({ path: f, type: 'png' });
  await page.waitForTimeout(500);
  await page.screenshot({ path: f, type: 'png' });
  return { file: f, img: decodePNG(f) };
}
async function waitShadowUpdate(prev) {
  await page.waitForFunction(p => (window.slopes.sunlightStats().shadowUpdates || 0) > p, prev, { timeout: 15000 }).catch(() => {});
}
const shadowUpdates = () => page.evaluate(() => window.slopes && window.slopes.sunlightStats ? window.slopes.sunlightStats().shadowUpdates : 0);

// Recorder: a CDP screencast of the composited page while an in-page,
// frame-indexed trajectory runs. Returns frames (on disk) + the page log.
async function record(name, stepSrc, nFrames, arg) {
  const cdp = await ctx.newCDPSession(page);
  const frames = [];
  let k = 0;
  cdp.on('Page.screencastFrame', f => {
    const file = path.join(TMP, `${name}-${String(k++).padStart(4, '0')}.png`);
    fs.writeFileSync(file, Buffer.from(f.data, 'base64'));
    frames.push({ file, ts: f.metadata.timestamp * 1000 });
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'png', maxWidth: LITE ? 390 : 640, maxHeight: LITE ? 844 : 400, everyNthFrame: 1 });
  await page.waitForTimeout(400);
  const log = await page.evaluate(({ stepSrc, nFrames, arg }) => new Promise(resolve => {
    const step = new Function('i', 'n', 'arg', 'A', stepSrc);
    const out = [];
    let i = 0;
    const tick = () => {
      if (i >= nFrames) { resolve(out); return; }
      const extra = step(i, nFrames, arg, window.__audit) || {};
      out.push({ i, wall: Date.now(), ...window.__audit.state(), ...extra });
      i++;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), { stepSrc, nFrames, arg });
  await page.waitForTimeout(600);
  await cdp.send('Page.stopScreencast');
  await cdp.detach();
  // attach each frame to the last log entry written before it was captured
  let j = 0;
  for (const f of frames) { while (j + 1 < log.length && log[j + 1].wall <= f.ts) j++; f.log = log[j]; }
  return { frames, log };
}
function analyse(frames, band = [0.35, 1.0]) {
  let prev = null;
  for (const f of frames) {
    const img = decodePNG(f.file);
    f.luma = +meanLuma(img).toFixed(2);
    f.lumaCity = +meanLuma(img, band[0], band[1]).toFixed(2);
    f.lumaSky = +meanLuma(img, 0, 0.25).toFixed(2);
    if (prev) {
      let s = 0; const n = img.width * img.height;
      for (let p = 0; p < n; p++) s += Math.abs(lumAt(img.data, p * img.bpp) - lumAt(prev.data, p * prev.bpp));
      f.dPrev = +(s / n).toFixed(3);
    } else f.dPrev = 0;
    prev = img;
  }
  return frames;
}
function keepFrames(name, frames, idxs) {
  const kept = [];
  for (const i of [...new Set(idxs)].filter(i => i >= 0 && i < frames.length)) {
    const dst = path.join(OUT, `${name}-f${String(i).padStart(4, '0')}.png`);
    fs.copyFileSync(frames[i].file, dst); kept.push(dst);
  }
  for (const f of frames) try { fs.unlinkSync(f.file); } catch (e) {}
  return kept;
}

// Poses, as EYE positions (lng, lat, metres up, pitch, bearing).
const POSES = {
  // spawn-like flying view over the campus toward downtown
  flying: [-97.7372, 30.2905, 160, 72, 200],
  // low flight over West Campus apartments
  low: [-97.7455, 30.2905, 55, 70, 150],
  // near the ground, at a roof-level eye, looking along 24th
  street: [-97.7440, 30.2890, 14, 82, 95],
};
async function place(name, p) {
  const P = POSES[name];
  const o = await page.evaluate(({ P }) => { const o = window.__audit.eyePose(...P); window.__audit.put(o); return o; }, { P });
  if (p != null) await page.evaluate(p => { const sl = document.getElementById('tod-slider'); if (sl) sl.value = String(p); window.applyTimeOfDay(window.__map, p, true); }, p);
  return o;
}

// ─────────────────────────────────────────────────────────── shadow ──
if (TESTS.includes('shadow') && hasSlopes) {
  const R = report.tests.shadow = {};
  for (const pose of ['flying', 'low', 'street']) {
    const o = await place(pose, 0.36);
    const set = (patch) => page.evaluate(patch => { const s = window.SLOPES.sunlight; for (const k in patch) s[k] = patch[k]; window.__map.triggerRepaint(); }, patch);
    const DEF = await page.evaluate(() => ({ shadowSnap: window.SLOPES.sunlight.shadowSnap, shadowRadii: window.SLOPES.sunlight.shadowRadii.slice() }));
    let u = await shadowUpdates();
    await page.waitForTimeout(1500);
    const A = await still(`${TAG}shadow-${pose}-A`);
    const info = await page.evaluate(() => {
      const m = window.__map, c = m.getCenter(), e = window.__fly.eye();
      const dx = (c.lng - e.lng) * 111320 * Math.cos(c.lat * Math.PI / 180), dy = (c.lat - e.lat) * 110540;
      return { eyeToCentre_m: +Math.hypot(dx, dy).toFixed(0), alt: +e.alt.toFixed(1), shadow: window.slopes.sunlightStats() };
    });
    const out = { pose: POSES[pose], lead_m: +o.lead.toFixed(0), ...info };
    // B: the same camera, the cascade re-centred by a different snap (what a
    //    20 m step of travel does to every shadow in view)
    u = await shadowUpdates(); await set({ shadowSnap: 17 }); await waitShadowUpdate(u);
    const B = await still(`${TAG}shadow-${pose}-B-resnap`);
    out.recentre = diffImages(A.img, B.img, path.join(OUT, `${TAG}shadow-${pose}-diff-recentre.png`));
    // C: near cascade widened to the far one's radius -> where the near map is
    u = await shadowUpdates(); await set({ shadowSnap: DEF.shadowSnap, shadowRadii: [DEF.shadowRadii[1], DEF.shadowRadii[1]] }); await waitShadowUpdate(u);
    const C = await still(`${TAG}shadow-${pose}-C-single`);
    out.nearCascadeFootprint = diffImages(A.img, C.img, path.join(OUT, `${TAG}shadow-${pose}-diff-nearcascade.png`));
    // D: far cascade widened to 4 km -> the shadows that end at 1,400 m
    u = await shadowUpdates(); await set({ shadowRadii: [DEF.shadowRadii[0], 4000], shadowDistance: 4200 }); await waitShadowUpdate(u);
    const D = await still(`${TAG}shadow-${pose}-D-far4k`);
    out.farCutoff = diffImages(A.img, D.img, path.join(OUT, `${TAG}shadow-${pose}-diff-farcutoff.png`));
    // E: near cascade CENTRED ON THE EYE instead of the look-at point
    //    (not a supported switch: emulated by snapping the centre so it lands
    //    under the camera is not possible from outside, so this is reported
    //    as the geometry only — eyeToCentre_m against the 240 m radius).
    await set({ shadowRadii: DEF.shadowRadii, shadowSnap: DEF.shadowSnap, shadowDistance: 1500 });
    u = await shadowUpdates(); await page.evaluate(() => { window.GFX.shadows = false; window.applyGraphics(); });
    const E = await still(`${TAG}shadow-${pose}-E-off`);
    out.allShadows = diffImages(A.img, E.img, path.join(OUT, `${TAG}shadow-${pose}-diff-shadowsoff.png`));
    await page.evaluate(() => { window.GFX.shadows = true; window.applyGraphics(); });
    await page.waitForTimeout(1500);
    fs.copyFileSync(A.file, path.join(OUT, `${TAG}shadow-${pose}-A.png`));
    for (const f of [A, B, C, D, E]) try { fs.unlinkSync(f.file); } catch (e) {}
    R[pose] = out;
    console.log(`[shadow] ${pose}: ${JSON.stringify(out)}`);
  }
  // Travel: 360 frames straight ahead at 1.2 m/frame at the low pose; count
  // shadow re-renders and look for frame-to-frame spikes that line up with them.
  const Pl = POSES.low;
  const rec = await record(`${TAG}travel`, `
    const P = arg.P, rad = Math.PI / 180;
    const d = i * arg.step, lat = P[1] + d * Math.cos(P[4] * rad) / 110540, lng = P[0] + d * Math.sin(P[4] * rad) / (111320 * Math.cos(P[1] * rad));
    A.put(A.eyePose(lng, lat, P[2], P[3], P[4]));
  `, 360, { P: Pl, step: 1.2 });
  analyse(rec.frames);
  const upd = rec.log.map(l => l.shadow ? l.shadow.shadowUpdates : 0);
  const events = []; for (let i = 1; i < upd.length; i++) if (upd[i] !== upd[i - 1]) events.push(i);
  const d = rec.frames.map(f => f.dPrev).filter((v, i) => i > 0);
  const med = d.slice().sort((a, b) => a - b)[Math.floor(d.length / 2)];
  const spikes = rec.frames.map((f, i) => ({ i, d: f.dPrev, upd: f.log && f.log.shadow ? f.log.shadow.shadowUpdates : null })).filter(f => f.d > med * 2.5);
  const tri = rec.log.map(l => l.tri); const proxyBuilds = []; for (let i = 1; i < tri.length; i++) if (tri[i] - tri[i - 1] > 100) proxyBuilds.push(i);
  const t0 = rec.log[0].now, t1 = rec.log[rec.log.length - 1].now;
  const lts = await page.evaluate(([a, b]) => window.__longTasks.filter(t => t[0] >= a && t[0] <= b), [t0, t1]);
  const snapCrossings = (() => { let n = 0; const P = Pl, s = 20; let prev = null; for (let i = 0; i < 360; i++) { const d = i * 1.2; const k = Math.round((d * Math.cos(P[4] * Math.PI / 180) + 0) / s) + ',' + Math.round((d * Math.sin(P[4] * Math.PI / 180)) / s); if (prev != null && k !== prev) n++; prev = k; } return n; })();
  R.travel = { frames: rec.frames.length, logFrames: rec.log.length, shadowRerenders: events.length, metresPerRerender: +(360 * 1.2 / Math.max(1, events.length)).toFixed(1),
               snapCrossingsApprox: snapCrossings, proxyRebuilds: proxyBuilds.length, proxyRebuildFrames: proxyBuilds.slice(0, 20),
               wallSeconds: +((t1 - t0) / 1000).toFixed(1), longTasks: lts.length, longTaskMsTotal: lts.reduce((s, t) => s + t[1], 0), longTaskMax: Math.max(0, ...lts.map(t => t[1])),
               dPrevMedian: med, spikes: spikes.slice(0, 30) };
  const keep = spikes.slice(0, 4).flatMap(s => [s.i - 1, s.i]);
  R.travel.kept = keepFrames(`${TAG}travel`, rec.frames, keep);
  console.log(`[shadow] travel: ${JSON.stringify({ ...R.travel, spikes: R.travel.spikes.length })}`);
  save();
}

// ─────────────────────────────────────────────────────────── sunset ──
if (TESTS.includes('sunset')) {
  const R = report.tests.sunset = {};
  const p0 = await page.evaluate(() => {
    let prev = null;
    for (let p = 0.3; p <= 0.9; p += 0.0005) { const e = window.skyBodies(p).sun.elev; if (prev != null && prev > 0 && e <= 0) return +p.toFixed(4); prev = e; }
    return null;
  });
  R.horizonP = p0;
  await place('low', p0 - 0.03);
  const ps = [-0.03, -0.01, -0.004, -0.0015, -0.0005, 0.0005, 0.0015, 0.004, 0.01, 0.03].map(d => +(p0 + d).toFixed(4));
  const rows = [];
  for (const shadows of [true, false]) {
    await page.evaluate(s => { window.GFX.shadows = s; window.applyGraphics(); }, shadows);
    let prev = null;
    for (const p of ps) {
      await page.evaluate(p => window.applyTimeOfDay(window.__map, p, true), p);
      await page.waitForTimeout(700);
      const S = await still(`${TAG}sunset-${shadows ? 'on' : 'off'}-${p}`);
      const st = await page.evaluate(p => ({ elev: +window.skyBodies(p).sun.elev.toFixed(2), maps: window.slopes.sunlightStats().shadowMaps }), p);
      const row = { shadows, p, ...st, luma: +meanLuma(S.img, 0.35, 1).toFixed(2) };
      if (prev) row.vsPrev = diffImages(prev.img, S.img, (shadows && Math.abs(p - p0) < 0.001) ? path.join(OUT, `${TAG}sunset-diff-${p}.png`) : null);
      if (shadows && Math.abs(p - p0) < 0.0016) fs.copyFileSync(S.file, path.join(OUT, `${TAG}sunset-${p}.png`));
      if (prev) try { fs.unlinkSync(prev.file); } catch (e) {}
      prev = S; rows.push(row);
    }
    if (prev) try { fs.unlinkSync(prev.file); } catch (e) {}
  }
  await page.evaluate(() => { window.GFX.shadows = true; window.applyGraphics(); });
  R.rows = rows;
  for (const r of rows) console.log(`[sunset] shadows ${r.shadows ? 'on ' : 'off'} p ${r.p} elev ${r.elev} luma ${r.luma} ${r.vsPrev ? 'Δ ' + r.vsPrev.meanAbs + ' changed ' + r.vsPrev.changedShare : ''}`);
  save();
}

// ─────────────────────────────────────────────────────────── zfight ──
//
// Z-fighting does not need the camera to move: two coplanar faces at the same
// depth swap which one wins per frame as soon as anything jitters the matrices,
// and the result is a fixed camera whose pixels will not sit still. So hold the
// camera still, take six frames a quarter-second apart, and measure how many
// pixels change between consecutive frames. Grain is turned off first (it is a
// per-frame noise field by design and would swamp the signal); clouds and the
// sun disc still move, which is why the bands the change falls in are reported
// — a sky-only band is weather, a band down in the city is not.
if (TESTS.includes('zfight')) {
  const R = report.tests.zfight = {};
  const grainWas = await page.evaluate(() => { const g = window.GFX.grain; window.GFX.grain = 0; window.applyGraphics(); return g; });
  for (const pose of ['flying', 'low', 'street']) {
    await place(pose, 0.36);
    await page.waitForTimeout(3000);
    const shots = [];
    for (let i = 0; i < 6; i++) {
      const f = path.join(TMP, `${TAG}zf-${pose}-${i}.png`);
      await page.screenshot({ path: f, type: 'png' });
      shots.push({ file: f, img: decodePNG(f) });
      await page.waitForTimeout(250);
    }
    const steps = [];
    for (let i = 1; i < shots.length; i++)
      steps.push(diffImages(shots[i - 1].img, shots[i].img, i === 1 ? path.join(OUT, `${TAG}zfight-${pose}-diff.png`) : null));
    R[pose] = { steps, worst: steps.reduce((a, b) => (b.changedShare > a.changedShare ? b : a)) };
    fs.copyFileSync(shots[0].file, path.join(OUT, `${TAG}zfight-${pose}.png`));
    for (const s of shots) try { fs.unlinkSync(s.file); } catch (e) {}
    console.log(`[zfight] ${pose}: worst consecutive-frame change ${JSON.stringify(R[pose].worst)}`);
  }
  await page.evaluate(g => { window.GFX.grain = g; window.applyGraphics(); }, grainWas);
  save();
}

// ─────────────────────────────────────────────────────────── lowsun ──
//
// The sunset series found a STEP: with shadows on, city luma went 87.5 -> 99.8
// between sun elevation +0.35 deg and +0.10 deg — one 0.0025 notch of the time
// slider — and with shadows off the same notch moved it by 0.5. The sun
// presence ramp cannot explain it (js/slopes.js smoothsteps it from -6 deg to
// 0 deg, so it is pinned at 1 across the whole step). This test asks the direct
// question instead of reasoning about it: how much of the frame IS shadow at
// each elevation? A/B the same pose against GFX.shadows=false and report the
// share of pixels the shadows are worth. If that share collapses before the sun
// reaches the horizon, the shadow maps are degenerating at a grazing sun, and
// the step is them going out.
if (TESTS.includes('lowsun')) {
  const R = report.tests.lowsun = { pose: POSES.low };
  const p0 = await page.evaluate(() => {
    let prev = null;
    for (let p = 0.3; p <= 0.9; p += 0.0005) { const e = window.skyBodies(p).sun.elev; if (prev != null && prev > 0 && e <= 0) return +p.toFixed(4); prev = e; }
    return null;
  });
  R.horizonP = p0;
  await place('low', p0 - 0.02);
  const ps = [-0.05, -0.03, -0.02, -0.01, -0.006, -0.004, -0.003, -0.002, -0.0015, -0.001, -0.0005, 0].map(d => +(p0 + d).toFixed(4));
  R.rows = [];
  for (const p of ps) {
    await page.evaluate(p => { window.GFX.shadows = true; window.applyGraphics(); window.applyTimeOfDay(window.__map, p, true); }, p);
    await page.waitForTimeout(900);
    const A = await still(`${TAG}lowsun-${p}-on`);
    await page.evaluate(() => { window.GFX.shadows = false; window.applyGraphics(); });
    await page.waitForTimeout(900);
    const B = await still(`${TAG}lowsun-${p}-off`);
    const d = diffImages(A.img, B.img, path.join(OUT, `${TAG}lowsun-${p}-shadowmap.png`));
    const st = await page.evaluate(p => ({ elev: +window.skyBodies(p).sun.elev.toFixed(2), maps: window.slopes.sunlightStats().shadowMaps, updates: window.slopes.sunlightStats().shadowUpdates }), p);
    const row = { p, ...st, shadowShare: d.changedShare, shadowMeanAbs: d.meanAbs, shadowBand: d.band,
                  lumaShadowsOn: +meanLuma(A.img, 0.35, 1).toFixed(2), lumaShadowsOff: +meanLuma(B.img, 0.35, 1).toFixed(2) };
    R.rows.push(row);
    fs.copyFileSync(A.file, path.join(OUT, `${TAG}lowsun-${p}-on.png`));
    for (const f of [A, B]) try { fs.unlinkSync(f.file); } catch (e) {}
    console.log(`[lowsun] p ${p} elev ${row.elev} — shadows cover ${(100 * row.shadowShare).toFixed(1)}% of the frame (mean ${row.shadowMeanAbs}); luma on ${row.lumaShadowsOn} off ${row.lumaShadowsOff}`);
  }
  await page.evaluate(() => { window.GFX.shadows = true; window.applyGraphics(); });
  save();
}

// ───────────────────────────────────────────────────────────── drag ──
if (TESTS.includes('drag')) {
  await place('flying', 0.30);
  await page.waitForTimeout(2500);
  const rec = await record(`${TAG}drag`, `
    const p = 0.30 + 0.70 * i / (n - 1);
    const sl = document.getElementById('tod-slider');
    sl.value = String(p); sl.dispatchEvent(new Event('input', { bubbles: true }));
    return { slider: +p.toFixed(4) };
  `, 420, {});
  analyse(rec.frames);
  const fr = rec.frames.filter(f => f.log);
  const jumps = fr.map((f, i) => ({ i, p: f.log.slider, luma: f.lumaCity, sky: f.lumaSky, d: f.dPrev, ae: f.log.ae && +f.log.ae.gain.toFixed(3) }))
                  .sort((a, b) => b.d - a.d).slice(0, 8);
  report.tests.drag = { frames: rec.frames.length, logFrames: rec.log.length,
    curve: fr.filter((f, i) => i % 6 === 0).map(f => [f.log.slider, f.lumaCity, f.lumaSky, f.log.ae ? +f.log.ae.gain.toFixed(3) : null]),
    biggestJumps: jumps };
  report.tests.drag.kept = keepFrames(`${TAG}drag`, rec.frames, jumps.slice(0, 3).flatMap(j => [j.i - 1, j.i]));
  console.log(`[drag] ${rec.frames.length} frames; biggest frame-to-frame changes: ${JSON.stringify(jumps.slice(0, 5))}`);
  save();
}

// ─────────────────────────────────────────────────────────────── ae ──
if (TESTS.includes('ae')) {
  const R = report.tests.ae = {};
  for (const ae of [true, false, true]) {   // interleaved
    await page.evaluate(a => { window.GFX.autoExposure = a; window.applyGraphics(); window.__aeReset && window.__aeReset(); }, ae);
    await place('flying', 0.5);
    await page.waitForTimeout(3000);
    const rec = await record(`${TAG}ae-${ae ? 'on' : 'off'}`, `
      const P = arg.P;
      // yaw a full turn, hold 60 frames, turn back
      const b = i < 240 ? P[4] + 360 * i / 240 : i < 300 ? P[4] : P[4] + 360 * (1 - (i - 300) / 240);
      A.put(A.eyePose(P[0], P[1], P[2], P[3], b));
      return { bearing: +b.toFixed(1) };
    `, 540, { P: POSES.flying });
    analyse(rec.frames, [0, 1]);
    const g = rec.log.map(l => l.ae ? l.ae.gain : 1);
    let rev = 0; for (let i = 2; i < g.length; i++) if (Math.sign(g[i] - g[i - 1]) && Math.sign(g[i - 1] - g[i - 2]) && Math.sign(g[i] - g[i - 1]) !== Math.sign(g[i - 1] - g[i - 2])) rev++;
    const L = rec.frames.map(f => f.luma);
    const mean = L.reduce((s, v) => s + v, 0) / L.length, sd = Math.sqrt(L.reduce((s, v) => s + (v - mean) ** 2, 0) / L.length);
    const holdGain = rec.log.filter(l => l.i >= 240 && l.i < 300).map(l => l.ae ? l.ae.gain : 1);
    const key = `ae-${ae ? 'on' : 'off'}` + (R[`ae-${ae ? 'on' : 'off'}`] ? '-2' : '');
    R[key] = { frames: rec.frames.length, gainMin: +Math.min(...g).toFixed(3), gainMax: +Math.max(...g).toFixed(3), gainReversals: rev,
      gainDriftWhileParked: holdGain.length ? +(Math.max(...holdGain) - Math.min(...holdGain)).toFixed(3) : null,
      lumaMean: +mean.toFixed(1), lumaSD: +sd.toFixed(2), maxFrameDelta: Math.max(...rec.frames.map(f => f.dPrev)),
      series: rec.frames.filter((f, i) => i % 10 === 0).map(f => [f.log ? f.log.i : null, f.luma, f.log && f.log.ae ? +f.log.ae.gain.toFixed(3) : null]) };
    keepFrames(`${TAG}${key}`, rec.frames, []);
    console.log(`[ae] ${key}: ${JSON.stringify({ ...R[key], series: undefined })}`);
  }
  await page.evaluate(() => { window.GFX.autoExposure = true; window.applyGraphics(); });
  save();
}

// ────────────────────────────────────────────────────────────── lod ──
if (TESTS.includes('lod')) {
  await place('low', 0.36);
  await page.waitForTimeout(2500);
  const P = POSES.low;
  const rec = await record(`${TAG}lod`, `
    const P = arg.P;
    // log-spaced climb 40 m -> 880 m, then hold
    const t = Math.min(1, i / (n - 60));
    const alt = 40 * Math.pow(880 / 40, t);
    A.put(A.eyePose(P[0], P[1], alt, 62, P[4]));
    return { target: +alt.toFixed(1) };
  `, 520, { P });
  analyse(rec.frames, [0.3, 1]);
  const fr = rec.frames.filter(f => f.log);
  const toggles = [];
  for (let i = 1; i < fr.length; i++) if (fr[i].log.lodHidden !== fr[i - 1].log.lodHidden) toggles.push({ i, alt: fr[i].log.alt, hidden: fr[i].log.lodHidden, d: fr[i].dPrev, dBefore: fr[i - 1].dPrev });
  const d = fr.map(f => f.dPrev).slice(1).sort((a, b) => a - b);
  report.tests.lod = { frames: rec.frames.length, renderDistance: await page.evaluate(() => window.GFX.renderDistance), toggles, dPrevMedian: d[Math.floor(d.length / 2)],
    spikes: fr.map((f, i) => ({ i, alt: f.log.alt, d: f.dPrev, hidden: f.log.lodHidden })).filter(f => f.d > d[Math.floor(d.length / 2)] * 3).slice(0, 20) };
  report.tests.lod.kept = keepFrames(`${TAG}lod`, rec.frames, toggles.flatMap(t => [t.i - 1, t.i + 1]));
  console.log(`[lod] ${JSON.stringify({ ...report.tests.lod, kept: undefined })}`);
  save();
}

fs.writeFileSync(path.join(OUT, `${TAG}motion.json`), JSON.stringify(report, null, 1));
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
await browser.__done();
