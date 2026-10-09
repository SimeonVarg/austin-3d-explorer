/**
 * skyturn.mjs - when the camera turns, tilts or banks, does the drawn sky move on the
 * screen the way the world does?
 *
 * WHY IT EXISTS. Owner's words: "camera tilt and sky go in opposite directions when
 * turning". A cloud sits at a fixed compass direction, so it has to cross the screen
 * exactly like a far building at that same direction: turn right and both slide left,
 * pitch up and both slide down, bank right and both rotate so the right side rises.
 * Every other sky check here looks at ONE frame; this is the first that moves the camera
 * and compares what the sky does with what the world does.
 *
 *   node skyturn.mjs                  both tiers (desktop 1280x800, phone 390x844 touch)
 *   node skyturn.mjs --tier phone     one tier
 *   node skyturn.mjs --report         print the numbers, never fail
 *   node skyturn.mjs --frames DIR     also write the cloud images it correlated (PNG)
 *   node skyturn.mjs --skyjs FILE     serve FILE in place of js/sky.js (the BEFORE arm)
 *
 * Run it through the GPU slot: node <lanes>/gpu-run.mjs --label skyturn -- node skyturn.mjs
 * It serves this checkout itself (scripts/serve.py on a free port) unless VERIFY_URL is set,
 * and stops the server when it exits.
 *
 * HOW IT MEASURES (every number is a pixel of a finished frame, read after the render):
 *   - The camera is moved with the EYE FIXED (calculateCenterFromCameraLngLatAlt), so a
 *     yaw or a pitch is a pure rotation of the view and nothing in the world has parallax.
 *   - Two frames per pose, same pose, one render apart: the world alone (SKY_COMP.on = false,
 *     MapLibre's own sky gradient and the city) and the world with the sky layer on.
 *     The sky layer's own picture is their difference, and only where the world frame
 *     shows plain sky (a row's dominant colour) - buildings that cross the sky would
 *     otherwise move with the world and pull the sky number toward the world's.
 *   - SKY motion: normalised cross-correlation of that cloud picture between two poses,
 *     searched over BOTH signs. WORLD motion: the same correlation on the city below the
 *     horizon in the world-alone frames. The search window is wide enough to find a
 *     wrong-way answer; it is never centred on the answer it is checking.
 *   - An independent pinhole model (built here from rotations, not from js/sky.js) predicts
 *     where each direction lands. It is only trusted once the rendered world agrees with it.
 *   - Roll is the camera BANK: the flight controller banks into every turn (js/controls.js,
 *     TUNE.BANK_MAX) and MapLibre rolls the whole picture about the view axis. Roll > 0
 *     lifts the right end of the horizon. The tilt is read from the left half against the
 *     right half of each region.
 *   - The controller zeroes roll whenever it is idle, so the harness blocks setRoll(0) while
 *     it holds a pose. Nothing else of the controller is touched.
 *
 * ASSERTIONS, per tier (a, b: the instrument; c-g: the sky):
 *   a  the sky layer is really drawn: GL mode, cloud pictures have energy, glDraws moved
 *   b  the independent model predicts the RENDERED world within WORLD_TOL
 *   c  yaw        sky moves the same way as the world, size within SIZE_TOL
 *   d  yaw tilted same, at the steeper pitch
 *   e  pitch      same, vertically
 *   f  combined   yaw and pitch together
 *   g  bank       the sky tilts the same way and by the same angle as the world
 * Exit 0 all pass, 1 any sky assertion fails, 2 the instrument is not trustworthy.
 */
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { launch } from './chrome.mjs';

const argv = process.argv.slice(2);
const has = n => argv.includes(n);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const REPORT = has('--report');
const FRAMES = arg('--frames', null);
const SKYJS = arg('--skyjs', null);
const TIER = arg('--tier', 'both');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

// ---- taste of the test: all thresholds and poses in one place -------------------
const TUNE = {
  STEP_DEG: 4,            // one turn / one tilt, degrees (task: 3 to 6)
  ROLL_DEG: 5,            // one bank, degrees (TUNE.BANK_MAX in js/controls.js is 5)
  SIZE_TOL: 0.12,         // sky px per degree within this fraction of what the model predicts
  WORLD_TOL: 0.10,        // the model within this fraction of the rendered world
  ROLL_TOL_DEG: 0.8,      // the sky's bank within this many degrees of the world's
  MIN_SIGNAL: 0.30,       // lowest correlation score a measurement may report and still count
  MIN_CLOUD_PX: 3000,     // pixels in the cloud picture that differ from the plain sky
  BASE: { bearing: 150, pitch: 80, roll: 0 },
  CENTER: [-97.7434, 30.2857], ZOOM: 16.4,
  P: 0.25,                // time of day: noon, clouds at full strength
  ROI_X: [0.30, 0.70],    // yaw/pitch: the middle of the frame, where the field is most even
};
const TIERS = {
  desktop: { viewport: { width: 1280, height: 800 }, dpr: 1, ctx: {} },
  phone: {
    viewport: { width: 390, height: 844 }, dpr: 2,
    ctx: {
      isMobile: true, hasTouch: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    },
  },
};

// ---- a server for this checkout ---------------------------------------------------
async function freePort() {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
    s.on('error', rej);
  });
}
async function startServer() {
  if (process.env.VERIFY_URL) return { url: process.env.VERIFY_URL, stop() {} };
  const port = await freePort();
  const py = spawn(process.platform === 'win32' ? 'python' : 'python3', ['scripts/serve.py', String(port), ROOT],
    { cwd: ROOT, stdio: 'ignore', windowsHide: true });
  const stop = () => { try { py.kill(); } catch (e) {} };
  process.once('exit', stop);
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(url + '/_harness.html'); if (r.ok) return { url, stop }; } catch (e) {}
    await new Promise(r => setTimeout(r, 250));
  }
  stop();
  throw new Error('serve.py did not answer on ' + url);
}

// ---- small image tools -------------------------------------------------------------
function crc32(buf) {
  let c, crc = ~0;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}
function writeGrayPNG(file, w, h, px) {
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w + 1)] = 0; for (let x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = px[y * w + x]; }
  const chunk = (t, d) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(d.length);
    const td = Buffer.concat([Buffer.from(t), d]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

// ---- the independent pinhole model -------------------------------------------------
// Built from rotations applied to a camera that starts level and facing north, NOT from
// the basis js/sky.js writes down, so a mistake in one is not copied into the other.
const R = d => d * Math.PI / 180;
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function camera(bearing, pitch, roll, W, H, fovDeg) {
  const e = R(pitch - 90);                         // MapLibre pitch is from straight down
  let f = [0, Math.cos(e), Math.sin(e)];
  let right = [1, 0, 0];
  let up = [0, -Math.sin(e), Math.cos(e)];
  const ro = R(roll);                              // roll > 0 renders as a right bank: right end UP
  const r2 = right.map((v, i) => v * Math.cos(ro) - up[i] * Math.sin(ro));
  const u2 = up.map((v, i) => v * Math.cos(ro) + right[i] * Math.sin(ro));
  const b = R(bearing);                            // yaw about z, clockwise seen from above
  const yaw = v => [v[0] * Math.cos(b) + v[1] * Math.sin(b), -v[0] * Math.sin(b) + v[1] * Math.cos(b), v[2]];
  f = yaw(f); right = yaw(r2); up = yaw(u2);
  const tv = Math.tan(R(fovDeg) / 2), th = tv * W / H;
  return {
    toScreen(d) {
      const fd = dot3(d, f);
      if (fd <= 1e-6) return null;
      return [W / 2 + (dot3(d, right) / fd) / th * W / 2, H / 2 - (dot3(d, up) / fd) / tv * H / 2];
    },
    toDir(x, y) {
      const a = (x - W / 2) / (W / 2) * th, c = -(y - H / 2) / (H / 2) * tv;
      const d = [f[0] + right[0] * a + up[0] * c, f[1] + right[1] * a + up[1] * c, f[2] + right[2] * a + up[2] * c];
      const n = Math.hypot(...d);
      return [d[0] / n, d[1] / n, d[2] / n];
    },
    horizonRow() { return (0.5 - 0.5 * Math.tan(R(90 - pitch)) / tv) * H; },
  };
}
const median = a => { const s = [...a].sort((p, q) => p - q); return s.length ? s[s.length >> 1] : NaN; };

/** Where the pixels of ROI move to between two poses, by the model: median (dx, dy) over the pixels. */
function modelShift(A, B, roi, mask, W) {
  const dxs = [], dys = [];
  for (let y = roi.y0; y < roi.y1; y += 3) for (let x = roi.x0; x < roi.x1; x += 3) {
    if (mask && !mask[y * W + x]) continue;
    const d = A.toDir(x + 0.5, y + 0.5), s = B.toScreen(d);
    if (!s) continue;
    dxs.push(s[0] - (x + 0.5)); dys.push(s[1] - (y + 0.5));
  }
  return { dx: median(dxs), dy: median(dys), n: dxs.length };
}

// ---- normalised cross-correlation of two pictures, masked, coarse to fine --------------
function boxDown(src, W, H, k, mask) {
  const w = Math.floor(W / k), h = Math.floor(H / k);
  const v = new Float32Array(w * h), m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, ok = 1;
    for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) {
      const o = (y * k + j) * W + x * k + i;
      s += src[o]; if (mask && !mask[o]) ok = 0;
    }
    v[y * w + x] = s / (k * k); m[y * w + x] = ok;
  }
  return { v, m, w, h };
}
function corrAt(A, B, ma, mb, w, h, roi, dx, dy) {
  let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  const y0 = Math.max(roi.y0, -dy), y1 = Math.min(roi.y1, h - dy);
  const x0 = Math.max(roi.x0, -dx), x1 = Math.min(roi.x1, w - dx);
  for (let y = y0; y < y1; y++) {
    const ra = y * w, rb = (y + dy) * w + dx;
    for (let x = x0; x < x1; x++) {
      if (!ma[ra + x] || !mb[rb + x]) continue;
      const a = A[ra + x], b = B[rb + x];
      n++; sa += a; sb += b; saa += a * a; sbb += b * b; sab += a * b;
    }
  }
  if (n < 40) return { s: -1, n };
  const va = saa - sa * sa / n, vb = sbb - sb * sb / n;
  if (va < 1e-6 || vb < 1e-6) return { s: -1, n };
  return { s: (sab - sa * sb / n) / Math.sqrt(va * vb), n };
}
/**
 * Where did picture A go in picture B?  B(x+dx, y+dy) ~ A(x, y).  Searches the window
 * [-rx, rx] x [-ry, ry] (CSS px) at 4x coarser first, then refines, then fits a parabola.
 */
function findShift(imA, imB, W, H, roi, rx, ry) {
  const k = 4;
  const a = boxDown(imA.v, W, H, 1, imA.m), b = boxDown(imB.v, W, H, 1, imB.m);   // full res masks
  const ca = boxDown(imA.v, W, H, k, imA.m), cb = boxDown(imB.v, W, H, k, imB.m);
  const croi = { x0: Math.ceil(roi.x0 / k), x1: Math.floor(roi.x1 / k), y0: Math.ceil(roi.y0 / k), y1: Math.floor(roi.y1 / k) };
  let best = { s: -2, dx: 0, dy: 0 };
  for (let dy = -Math.ceil(ry / k); dy <= Math.ceil(ry / k); dy++)
    for (let dx = -Math.ceil(rx / k); dx <= Math.ceil(rx / k); dx++) {
      const c = corrAt(ca.v, cb.v, ca.m, cb.m, ca.w, ca.h, croi, dx, dy);
      if (c.s > best.s) best = { s: c.s, dx: dx * k, dy: dy * k };
    }
  // refine at full resolution around the coarse peak
  let fine = { s: -2, dx: best.dx, dy: best.dy };
  const sc = {};
  for (let dy = best.dy - k; dy <= best.dy + k; dy++)
    for (let dx = best.dx - k; dx <= best.dx + k; dx++) {
      const c = corrAt(a.v, b.v, a.m, b.m, W, H, roi, dx, dy);
      sc[dx + ',' + dy] = c.s;
      if (c.s > fine.s) fine = { s: c.s, dx, dy, n: c.n };
    }
  const g = (dx, dy) => sc[dx + ',' + dy];
  const par = (m1, c0, p1) => { const d = m1 - 2 * c0 + p1; return d === 0 ? 0 : 0.5 * (m1 - p1) / d; };
  let sx = 0, sy = 0;
  if (g(fine.dx - 1, fine.dy) != null && g(fine.dx + 1, fine.dy) != null) sx = par(g(fine.dx - 1, fine.dy), fine.s, g(fine.dx + 1, fine.dy));
  if (g(fine.dx, fine.dy - 1) != null && g(fine.dx, fine.dy + 1) != null) sy = par(g(fine.dx, fine.dy - 1), fine.s, g(fine.dx, fine.dy + 1));
  return { dx: fine.dx + sx, dy: fine.dy + sy, score: fine.s, n: fine.n || 0 };
}

/**
 * The rotation about the picture's centre that carries A onto B, degrees, + = counter-clockwise
 * on screen (the right end of a level line rises). Searches +-2x the expected angle so a sky that
 * rotates the wrong way, or not at all, is found rather than assumed away.
 */
function findRoll(imA, imB, W, H, roi, expectDeg) {
  const k = 2;
  const a = boxDown(imA.v, W, H, k, imA.m), b = boxDown(imB.v, W, H, k, imB.m);
  const w = a.w, h = a.h, cx = W / 2 / k, cy = H / 2 / k;
  const r0 = { x0: Math.ceil(roi.x0 / k), x1: Math.floor(roi.x1 / k), y0: Math.ceil(roi.y0 / k), y1: Math.floor(roi.y1 / k) };
  const score = deg => {
    const t = R(deg), c = Math.cos(t), s = Math.sin(t);
    let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
    for (let y = r0.y0; y < r0.y1; y++) for (let x = r0.x0; x < r0.x1; x++) {
      if (!b.m[y * w + x]) continue;
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      const ix = Math.round(cx + dx * c - dy * s - 0.5), iy = Math.round(cy + dx * s + dy * c - 0.5);
      if (ix < 0 || iy < 0 || ix >= w || iy >= h || !a.m[iy * w + ix]) continue;
      const va = a.v[iy * w + ix], vb = b.v[y * w + x];
      n++; sa += va; sb += vb; saa += va * va; sbb += vb * vb; sab += va * vb;
    }
    if (n < 60) return -1;
    const A2 = saa - sa * sa / n, B2 = sbb - sb * sb / n;
    return A2 < 1e-6 || B2 < 1e-6 ? -1 : (sab - sa * sb / n) / Math.sqrt(A2 * B2);
  };
  const span = 2 * Math.max(1, expectDeg);
  let best = { s: -2, d: 0 };
  for (let d = -span; d <= span + 1e-9; d += 0.25) { const s = score(d); if (s > best.s) best = { s, d }; }
  let fine = { ...best };
  const pts = {};
  for (let d = best.d - 0.25; d <= best.d + 0.25 + 1e-9; d += 0.05) { const s = score(d); pts[d.toFixed(2)] = s; if (s > fine.s) fine = { s, d }; }
  const g = d => pts[d.toFixed(2)];
  const lo = g(fine.d - 0.05), hi = g(fine.d + 0.05);
  let sub = 0;
  if (lo != null && hi != null) { const q = lo - 2 * fine.s + hi; if (q !== 0) sub = 0.5 * (lo - hi) / q * 0.05; }
  return { deg: fine.d + sub, score: fine.s };
}

// ---- the page --------------------------------------------------------------------------
const PAGE_KIT = () => {
  const m = window.__map, T = window.__ST = {};
  T.hold = false;
  const origSetRoll = m.setRoll.bind(m);
  m.setRoll = (v, o) => (T.hold ? m : origSetRoll(v, o));        // the controller's idle self-heal
  T.frame = () => new Promise(res => { m.once('render', res); m.triggerRepaint(); });
  T.settle = async n => { for (let i = 0; i < (n || 3); i++) await T.frame(); };
  T.setEye = () => {
    const t = m.transform;
    T.eye = { lngLat: t.getCameraLngLat(), alt: t.getCameraAltitude() };
    return { lng: T.eye.lngLat.lng, lat: T.eye.lngLat.lat, alt: T.eye.alt };
  };
  T.pose = async (p) => {
    const c = m.transform.calculateCenterFromCameraLngLatAlt(T.eye.lngLat, T.eye.alt, p.bearing, p.pitch);
    m.jumpTo({ center: c.center, zoom: c.zoom, bearing: p.bearing, pitch: p.pitch, roll: p.roll || 0 });
    await T.settle(3);
    const e = m.transform.getCameraLngLat();
    const mPerDeg = 111320;
    return {
      eyeErrM: Math.hypot((e.lng - T.eye.lngLat.lng) * mPerDeg * Math.cos(e.lat * Math.PI / 180), (e.lat - T.eye.lngLat.lat) * mPerDeg),
      altErrM: Math.abs(m.transform.getCameraAltitude() - T.eye.alt),
      bearing: m.getBearing(), pitch: m.getPitch(), roll: m.getRoll ? m.getRoll() : 0,
    };
  };
  const b64 = u8 => {
    let s = ''; const k = 0x8000;
    for (let i = 0; i < u8.length; i += k) s += String.fromCharCode.apply(null, u8.subarray(i, i + k));
    return btoa(s);
  };
  // One finished frame as grey, in CSS pixels (box-averaged when the canvas is denser).
  T.grab = (skyOn) => new Promise(async res => {
    window.SKY_COMP.on = skyOn;
    await T.settle(2);
    const g0 = window.__sky.glDraws;
    m.once('render', () => {
      const cv = m.getCanvas(), gl = cv.getContext('webgl2') || cv.getContext('webgl');
      const bw = cv.width, bh = cv.height, W = cv.clientWidth, H = cv.clientHeight;
      const buf = new Uint8Array(bw * bh * 4);
      gl.readPixels(0, 0, bw, bh, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      // The canvas is DPR x render-scale CSS-pixel dense (a phone runs 2 x 0.75 = 1.5), so the
      // grid is sampled at each CSS pixel's centre rather than assuming a whole-number ratio.
      const sx = bw / W, sy = bh / H, out = new Uint8Array(W * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const ix = Math.min(bw - 1, Math.floor((x + 0.5) * sx)), iy = Math.min(bh - 1, Math.floor((y + 0.5) * sy));
        const o = ((bh - 1 - iy) * bw + ix) * 4;
        out[y * W + x] = Math.round(0.299 * buf[o] + 0.587 * buf[o + 1] + 0.114 * buf[o + 2]);
      }
      res({ W, H, k: sx, gray: b64(out), glDraws: window.__sky.glDraws - g0, mode: window.SKY_COMP.mode,
            bearing: m.getBearing(), pitch: m.getPitch(), roll: m.getRoll ? m.getRoll() : 0 });
    });
    m.triggerRepaint();
  });
};

async function setup(browser, server, name) {
  const T = TIERS[name];
  const ctx = await browser.newContext({ viewport: T.viewport, deviceScaleFactor: T.dpr, ...T.ctx });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error' || /\[sky\]/.test(m.text())) errs.push(m.text()); });
  if (SKYJS) {
    const body = fs.readFileSync(SKYJS, 'utf8');
    await page.route('**/js/sky.js*', r => r.fulfill({ status: 200, contentType: 'application/javascript', body }));
  }
  // The sky always draws at full cloud strength; labels off so they cannot differ between frames.
  await page.goto(`${server.url}/_harness.html?drift=0&intro=0&namelabels=0`, { waitUntil: 'networkidle', timeout: 150000 });
  await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 150000 });
  await page.waitForTimeout(3000);
  await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
  await page.waitForFunction(() => (window.__veilRenderScale === undefined) || window.__veilRenderScale === 1,
    null, { timeout: 60000 }).catch(() => {});
  await page.evaluate(PAGE_KIT);
  const info = await page.evaluate(async (c) => {
    const m = window.__map;
    window.SKY_TUNE.GL.DRIFT = 0;
    window.SKY_TUNE.TWINKLE.AMP = 0;
    window.SKY_COMP.mode = 'gl';
    const t0 = performance.now();
    while (!window.__skyGL.cloudsReady() && performance.now() - t0 < 60000) {
      m.triggerRepaint(); await new Promise(r => setTimeout(r, 200));
    }
    m.jumpTo({ center: c.center, zoom: c.zoom, pitch: c.pose.pitch, bearing: c.pose.bearing, roll: 0 });
    window.applyTimeOfDay(m, c.p, true);
    await window.__ST.settle(6);
    window.__ST.hold = true;
    const eye = window.__ST.setEye();
    return { eye, fov: m.getVerticalFieldOfView(), mode: window.SKY_COMP.mode, clouds: window.__skyGL.cloudsReady(),
             gfxClouds: window.GFX.clouds, lite: !!(window.LITE_PROFILE && window.LITE_PROFILE.on),
             W: m.getCanvas().clientWidth, H: m.getCanvas().clientHeight, dpr: window.devicePixelRatio,
             canvasPx: m.getCanvas().width };
  }, { center: TUNE.CENTER, zoom: TUNE.ZOOM, pose: TUNE.BASE, p: TUNE.P });
  return { page, ctx, errs, info };
}

const unb64 = s => new Uint8Array(Buffer.from(s, 'base64'));

/** Move to a pose and take the two frames. */
async function shoot(page, pose) {
  const st = await page.evaluate(p => window.__ST.pose(p), pose);
  const off = await page.evaluate(() => window.__ST.grab(false));
  const on = await page.evaluate(() => window.__ST.grab(true));
  return { pose, st, off, on, W: off.W, H: off.H, offG: unb64(off.gray), onG: unb64(on.gray) };
}

/** The sky layer's own picture and the rows where the world frame shows plain sky. */
function skyPicture(s, hz) {
  const { W, H, offG, onG } = s;
  const v = new Float32Array(W * H), m = new Uint8Array(W * H);
  const hist = new Int32Array(128);
  for (let y = 0; y < H; y++) {
    hist.fill(0);
    for (let x = 0; x < W; x++) hist[offG[y * W + x] >> 1]++;
    let mode = 0;
    for (let i = 1; i < 128; i++) if (hist[i] > hist[mode]) mode = i;
    const sky = mode * 2 + 1;
    // a row is read as sky only above the horizon and only where the plain sky is a majority
    const okRow = y < hz && hist[mode] + (hist[mode - 1] || 0) + (hist[mode + 1] || 0) > W * 0.22;
    for (let x = 0; x < W; x++) {
      const o = y * W + x;
      v[o] = onG[o] - offG[o];
      m[o] = okRow && Math.abs(offG[o] - sky) <= 3 ? 1 : 0;
    }
  }
  return { v, m, W, H };
}
function worldPicture(s, y0) {
  const { W, H, offG } = s;
  const v = new Float32Array(W * H), m = new Uint8Array(W * H);
  for (let y = y0; y < H; y++) for (let x = 0; x < W; x++) { v[y * W + x] = offG[y * W + x]; m[y * W + x] = 1; }
  return { v, m, W, H };
}

// ---- a measurement of one pair of poses -----------------------------------------------------
function measurePair(name, A, B, ctx) {
  const { W, H, fov } = ctx;
  const cA = camera(A.pose.bearing, A.pose.pitch, A.pose.roll || 0, W, H, fov);
  const cB = camera(B.pose.bearing, B.pose.pitch, B.pose.roll || 0, W, H, fov);
  const tilt = r => Math.abs(Math.tan(R(r || 0))) * W / 2;
  const hzMin = Math.min(cA.horizonRow() - tilt(A.pose.roll), cB.horizonRow() - tilt(B.pose.roll));
  const hzMax = Math.max(cA.horizonRow() + tilt(A.pose.roll), cB.horizonRow() + tilt(B.pose.roll));
  const skyRows = Math.max(40, Math.floor(hzMin - 18));
  const worldRow = Math.min(H - 60, Math.ceil(hzMax + 14));
  const dyaw = B.pose.bearing - A.pose.bearing, dpit = B.pose.pitch - A.pose.pitch, droll = (B.pose.roll || 0) - (A.pose.roll || 0);
  const pxA = skyPicture(A, hzMin - 18), pxB = skyPicture(B, hzMin - 18);
  const wA = worldPicture(A, worldRow), wB = worldPicture(B, worldRow);
  const energy = pxA.v.reduce((n, v, i) => n + (pxA.m[i] && Math.abs(v) > 6 ? 1 : 0), 0);

  const out = { name, dyaw, dpit, droll, skyRows, worldRow, cloudPx: energy, regions: {}, frames: { pxA, pxB } };
  if (droll !== 0) {
    // A bank is a rigid rotation of the whole picture about its centre (the eye does not move
    // and the axis is the view axis), so it is measured as ONE angle: the rotation of picture A
    // that best matches picture B, in degrees, + = the right end of the horizon goes up.
    const full = { x0: 0, x1: W };
    out.roll = {
      model: droll,
      sky: findRoll(pxA, pxB, W, H, { ...full, y0: 0, y1: Math.max(40, Math.floor(hzMin - 18)) }, Math.abs(droll)),
      world: findRoll(wA, wB, W, H, { ...full, y0: worldRow, y1: H }, Math.abs(droll)),
    };
    return out;
  }
  const regions = { mid: { x0: Math.round(W * TUNE.ROI_X[0]), x1: Math.round(W * TUNE.ROI_X[1]) } };
  const centreX = r => (r.x0 + r.x1) / 2;
  for (const [rn, r] of Object.entries(regions)) {
    const sroi = { x0: r.x0, x1: r.x1, y0: 0, y1: skyRows };
    const wroi = { x0: r.x0, x1: r.x1, y0: worldRow, y1: H };
    const ms = modelShift(cA, cB, sroi, pxA.m, W), mw = modelShift(cA, cB, wroi, null, W);
    // a window wide enough for a wrong-way answer, never centred on the answer being checked
    const lim = d => Math.round(Math.max(1.6 * Math.abs(d) + 12, 24));
    const sk = findShift(pxA, pxB, W, H, sroi, lim(ms.dx), lim(ms.dy));
    const wd = findShift(wA, wB, W, H, wroi, lim(mw.dx), lim(mw.dy));
    out.regions[rn] = { cx: centreX(r), model: { sky: ms, world: mw }, sky: sk, world: wd };
  }
  return out;
}

// ---- the run -------------------------------------------------------------------------------------
const results = [];
const check = (tier, id, name, pass, detail, kind = 'sky') => {
  results.push({ tier, id, name, pass, detail, kind });
  console.log(`${pass ? 'PASS' : 'FAIL'}  [${tier}] ${id}  ${name}  ${detail}`);
};
const f1 = v => (Number.isFinite(v) ? v.toFixed(2) : 'n/a');

async function runTier(browser, server, name) {
  console.log(`\n== ${name} tier ==`);
  const { page, errs, info } = await setup(browser, server, name);
  console.log(`   canvas ${info.W}x${info.H} css px (${info.canvasPx} px wide), dpr ${info.dpr}, fov ${f1(info.fov)}, sky mode ${info.mode}, clouds loaded ${info.clouds}, ` +
              `GFX.clouds ${info.gfxClouds}, phone profile ${info.lite}`);
  const B = TUNE.BASE, S = TUNE.STEP_DEG, RL = TUNE.ROLL_DEG;
  const poses = {
    base: B,
    yaw: { ...B, bearing: B.bearing + S },
    tilted: { ...B, pitch: B.pitch + S },
    tiltedYaw: { ...B, bearing: B.bearing + S, pitch: B.pitch + S },
    bankR: { ...B, roll: +RL },
    bankL: { ...B, roll: -RL },
  };
  const shots = {};
  for (const [k, p] of Object.entries(poses)) {
    shots[k] = await shoot(page, p);
    const st = shots[k].st;
    if (st.eyeErrM > 0.5 || st.altErrM > 0.5) console.log(`   (pose ${k}: eye moved ${f1(st.eyeErrM)} m, alt ${f1(st.altErrM)} m)`);
  }
  await page.evaluate(() => { window.SKY_COMP.on = true; });
  const ctx = { W: info.W, H: info.H, fov: info.fov };

  // a. the instrument is looking at the real sky layer
  const gl = Object.values(shots).every(s => s.on.mode === 'gl' && s.on.glDraws > 0) && Object.values(shots).every(s => s.off.glDraws === 0);
  check(name, 'a', 'the sky layer is drawn by the GL path, and is absent from the world-alone frames', gl,
        `GL draws per on-frame ${Object.values(shots).map(s => s.on.glDraws).join(',')}; off-frames ${Object.values(shots).map(s => s.off.glDraws).join(',')}`, 'instrument');

  const pairs = {
    yaw: measurePair('yaw', shots.base, shots.yaw, ctx),
    tiltedYaw: measurePair('yaw while tilted', shots.tilted, shots.tiltedYaw, ctx),
    pitch: measurePair('pitch', shots.base, shots.tilted, ctx),
    combined: measurePair('yaw + pitch', shots.base, shots.tiltedYaw, ctx),
    bankR: measurePair('bank right', shots.base, shots.bankR, ctx),
    bankL: measurePair('bank left', shots.base, shots.bankL, ctx),
  };
  if (FRAMES) {
    fs.mkdirSync(FRAMES, { recursive: true });
    for (const [k, s] of Object.entries(shots)) {
      const p = skyPicture(s, 1e9);
      const img = new Uint8Array(s.W * s.H);
      for (let i = 0; i < img.length; i++) img[i] = p.m[i] ? Math.max(0, Math.min(255, 128 + p.v[i] * 2)) : 0;
      writeGrayPNG(path.join(FRAMES, `${name}-${k}-cloudpicture.png`), s.W, s.H, img);
      writeGrayPNG(path.join(FRAMES, `${name}-${k}-world.png`), s.W, s.H, s.offG);
    }
  }
  const cloudOK = Object.values(pairs).every(p => p.cloudPx >= TUNE.MIN_CLOUD_PX);
  check(name, 'a2', 'the cloud picture has energy in every pose', cloudOK,
        `pixels differing from plain sky: ${Object.entries(pairs).map(([k, p]) => `${k} ${p.cloudPx}`).join(', ')}`, 'instrument');

  const sgn = v => (v > 0 ? '+' : v < 0 ? '-' : '0');
  // b. the model predicts the rendered world (so it can be used as the yardstick)
  let worstWorld = 0, worstWhere = '';
  const worldRows = [];
  for (const [k, p] of Object.entries(pairs)) {
    for (const [rn, r] of Object.entries(p.regions)) {
      if (p.droll !== 0) continue;
      const ax = Math.abs(p.dyaw) > 0 ? 'dx' : 'dy';
      const mod = r.model.world[ax], got = r.world[ax];
      const err = Math.abs(got - mod) / Math.max(1, Math.abs(mod));
      worldRows.push(`${k} ${ax}: rendered ${f1(got)} model ${f1(mod)} px`);
      if (err > worstWorld) { worstWorld = err; worstWhere = k; }
    }
  }
  check(name, 'b', `the independent pinhole model matches the RENDERED world within ${TUNE.WORLD_TOL * 100}%`,
        worstWorld <= TUNE.WORLD_TOL, `worst ${(worstWorld * 100).toFixed(1)}% (${worstWhere}); ${worldRows.join('; ')}`, 'instrument');

  // c-f. shifts
  const shiftCheck = (id, label, p, axes) => {
    const r = p.regions.mid;
    const rows = [], fails = [];
    for (const ax of axes) {
      const deg = ax === 'dx' ? p.dyaw : p.dpit;
      const mS = r.model.sky[ax], mW = r.model.world[ax];
      const sky = r.sky[ax], world = r.world[ax];
      const sameSign = Math.sign(sky) === Math.sign(world) && Math.sign(world) === Math.sign(mW);
      const ratio = sky / mS;
      const ok = sameSign && Math.abs(ratio - 1) <= TUNE.SIZE_TOL && r.sky.score >= TUNE.MIN_SIGNAL;
      rows.push(`${ax}: sky ${f1(sky)} px (${f1(sky / deg)} px/deg, ${sgn(sky)}), world ${f1(world)} px (${f1(world / deg)} px/deg, ${sgn(world)}), ` +
                `model ${f1(mS)}/${f1(mW)} px; sky/model ${f1(ratio)}; corr ${f1(r.sky.score)}/${f1(r.world.score)}`);
      if (!ok) fails.push(ax);
    }
    check(name, id, label, fails.length === 0, rows.join(' | '));
  };
  shiftCheck('c', `yaw ${TUNE.STEP_DEG} deg: the sky slides with the world`, pairs.yaw, ['dx']);
  shiftCheck('d', `yaw ${TUNE.STEP_DEG} deg at the steeper pitch`, pairs.tiltedYaw, ['dx']);
  shiftCheck('e', `pitch ${TUNE.STEP_DEG} deg: the sky slides with the world`, pairs.pitch, ['dy']);
  shiftCheck('f', 'yaw and pitch together', pairs.combined, ['dx', 'dy']);

  // g. bank. The world must really have rolled by the camera's roll (instrument), then the sky by the same.
  const bankRows = [], bankFail = [], worldBank = [];
  let worstBank = 0;
  for (const [k, want] of [['bankR', +RL], ['bankL', -RL]]) {
    const r = pairs[k].roll;
    worstBank = Math.max(worstBank, Math.abs(r.world.deg - want));
    worldBank.push(`${k}: rendered world rolled ${f1(r.world.deg)} deg for a camera roll of ${want}`);
    const ok = Math.sign(r.sky.deg) === Math.sign(r.world.deg) && Math.abs(r.sky.deg - r.world.deg) <= TUNE.ROLL_TOL_DEG &&
               r.sky.score >= TUNE.MIN_SIGNAL;
    bankRows.push(`${k}: sky tilted ${f1(r.sky.deg)} deg (corr ${f1(r.sky.score)}), world tilted ${f1(r.world.deg)} deg (corr ${f1(r.world.score)}), camera roll ${want}`);
    if (!ok) bankFail.push(k);
  }
  check(name, 'b2', `the rendered world rolls by the camera's roll (within ${TUNE.ROLL_TOL_DEG} deg)`, worstBank <= TUNE.ROLL_TOL_DEG,
        worldBank.join('; '), 'instrument');
  check(name, 'g', `bank ${RL} deg each way: the sky tilts with the world`, bankFail.length === 0, bankRows.join(' | '));

  if (errs.length) console.log('   page errors:', errs.slice(0, 4).join(' | '));
  const sky = { tier: name, info, pairs: Object.fromEntries(Object.entries(pairs).map(([k, p]) => { const q = { ...p }; delete q.frames; return [k, q]; })) };
  await page.context().close();
  return sky;
}

const server = await startServer();
const browser = await launch(chromium, { gl: 'hardware', maxMs: 900000 });
const tiers = TIER === 'both' ? ['desktop', 'phone'] : [TIER];
const dump = [];
try {
  for (const t of tiers) dump.push(await runTier(browser, server, t));
} finally {
  await browser.close().catch(() => {});
  server.stop();
}
if (FRAMES) fs.writeFileSync(path.join(FRAMES, 'skyturn.json'), JSON.stringify(dump, null, 1));
const bad = results.filter(r => !r.pass);
const badInst = bad.filter(r => r.kind === 'instrument');
console.log(`\n${results.length - bad.length}/${results.length} passed` +
  (badInst.length ? `, ${badInst.length} instrument check(s) failed - the numbers above cannot be trusted` : ''));
if (REPORT) process.exit(0);
process.exit(badInst.length ? 2 : bad.length ? 1 : 0);
