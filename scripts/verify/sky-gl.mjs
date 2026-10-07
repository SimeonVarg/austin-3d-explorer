/**
 * sky-gl.mjs - the GL sky (SKY_COMP.mode = 'gl') against today's 2D-canvas sky.
 *
 * WHY IT EXISTS. In Safari on an Intel Mac, redrawing the 5120 x 960 sky canvas
 * and copying it into a GL texture every frame while the camera turns cost about
 * 58 ms of a 195 ms frame (docs/perf/safari-frame-floor.md). The GL sky draws the
 * same sky in the map's own pass from textures uploaded once, so a turn changes
 * uniforms only. This script is the gate for that claim and for the look not
 * having moved where it must not.
 *
 *   node sky-gl.mjs                 gate (run it through gpu-run.mjs on the laptop)
 *   node sky-gl.mjs --break         the SAME gate with one deliberate defect per
 *                                   assertion; every one of them must come back RED
 *   node sky-gl.mjs --shots DIR     also write labelled frames (canvas / gl look A /
 *                                   gl look B at noon, sunset, night) into DIR
 *   node sky-gl.mjs --report        print the numbers, never fail
 *
 * Uses _harness.html (readPixels needs the preserved drawing buffer) and reads the
 * MAP canvas, so every number is a pixel of the finished frame, not a number the
 * sky code reports about itself.
 *
 * What is asserted (each has a break switch, see BREAKS):
 *   a  atmosphere   with clouds and stars off, 'gl' and 'canvas' agree at 45 named
 *                   sample points over the sky at noon, sunset and night
 *   b  seam         no vertical discontinuity where the cloud panorama wraps, in the
 *                   file (last column against first) and on screen
 *   c  feather      the row where the sky wash has fallen to half sits where it
 *                   does in 'canvas' mode (the horizon feather)
 *   d  clouds       clouds are really drawn in 'gl' mode (and the set knob changes them)
 *   e  turning      while the camera turns in 'gl' mode there are no 2D sky draws and
 *                   no sky texture uploads, by the app's counters AND by a wrapper on
 *                   texImage2D that this script installs itself; the 'canvas' control
 *                   run must show both, or the instrument is dead
 *   g  own output   the pixels come from the GL path: the 2D canvas is not drawn, GL
 *                   draws are counted, and zeroing the GL atmosphere changes the pixels
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { BASE, launch } from './chrome.mjs';

const argv = process.argv.slice(2);
const has = n => argv.includes(n);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const BREAK = has('--break');
const REPORT = has('--report');
const SHOTS = arg('--shots', null);
const ONLY = arg('--only', null);        // e.g. --only c,e : run just those assertions (to iterate on one)

// ---- thresholds and poses, all in one place (CLAUDE.md rule 11) ---------------
const TUNE = {
  ATMOS_MAX: 4,            // largest per-channel difference allowed at any sample point (measured: 2)
  ATMOS_MEAN: 0.8,         // mean per-channel difference allowed over all sample points (measured: 0.2)
  FEATHER_PX: 2.5,         // the half-way row may differ by this many CSS px
  SEAM_RATIO: 2.5,         // seam column step <= this x the 95th percentile of the others
  SEAM_FLOOR: 8,           // ...plus this many levels (sum over rows) so flat sky passes
  CLOUD_FRAC: 0.03,        // share of sky pixels clouds must change by CLOUD_LEVELS or more
  CLOUD_LEVELS: 25,
  TURN_FRAMES: 40,
  TURN_STEP_DEG: 2,
};
const POSES = {
  noon:   { p: 0.25, pitch: 84, bearing: 150 },
  sunset: { p: 0.52, pitch: 80, bearing: 256 },
  night:  { p: 0.90, pitch: 82, bearing: 111 },
};
const FRACS = [0.08, 0.3, 0.55, 0.8, 0.93];       // of the sky band, top of frame down to the horizon
const COLS = [0.15, 0.5, 0.85];
const HZ_OFFS = [-30, -16, -8, 0, 6, 12];          // CSS px about the horizon row, for the feather

// One deliberate defect per assertion. Each is a page-side edit that touches only
// the thing that assertion is about, and each assertion must fail under it.
const BREAKS = {
  a: { name: 'atmosphere gain 1.6', dbg: { atmoGain: 1.6 } },
  b: { name: 'seam: texture shifted 0.37 on one side', dbg: { seamShift: 0.37 } },
  c: { name: 'feather moved 30 px', dbg: { featherShiftPx: 30 } },
  d: { name: 'cloud gain 0', dbg: { cloudGain: 0 } },
  e: { name: 'turn run done in canvas mode', turnMode: 'canvas' },
  g: { name: 'GL path off (mode canvas)', ownMode: 'canvas' },
};

const browser = await launch(chromium, { maxMs: 600000 });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
page.on('console', m => { if (m.type() === 'error' || /\[sky\]/.test(m.text())) errs.push(m.text()); });

// An independent instrument: count every texImage2D / texSubImage2D whose source is the
// 2D sky canvas or any canvas wider than 2048. The app's own counter can be wrong; this
// cannot be, because it sits under the app.
await page.addInitScript(() => {
  window.__texCalls = { skyCanvas: 0, wide: 0, total: 0 };
  for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!C) continue;
    for (const fn of ['texImage2D', 'texSubImage2D']) {
      const orig = C.prototype[fn];
      C.prototype[fn] = function (...a) {
        const src = a[a.length - 1];
        window.__texCalls.total++;
        if (src && src.tagName === 'CANVAS') {
          if (src.id === 'sky-canvas') window.__texCalls.skyCanvas++;
          if (src.width >= 2048) window.__texCalls.wide++;
        }
        return orig.apply(this, a);
      };
    }
  }
});

await page.goto(`${BASE}/_harness.html?drift=0&intro=0`, { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 90000 });
await page.waitForTimeout(4000);
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
// The veil holds the map at a reduced pixel ratio until it lifts; sample only after.
await page.waitForFunction(() => (window.__veilRenderScale === undefined) || window.__veilRenderScale === 1,
  null, { timeout: 60000 }).catch(() => {});

const hasGL = await page.evaluate(() => !!(window.SKY_COMP && 'mode' in window.SKY_COMP && window.__skyGL));
if (!hasGL) {
  console.log('FAIL  the build has no SKY_COMP.mode / window.__skyGL: nothing to check');
  await browser.__done();
  process.exit(1);
}
// Cloud textures load after first paint; wait for both looks.
await page.evaluate(async () => {
  window.SKY_COMP.mode = 'gl';
  const t0 = performance.now();
  for (const set of ['A', 'B']) {
    window.SKY_TUNE.cloudSet = set;
    while (!window.__skyGL.cloudsReady() && performance.now() - t0 < 60000) {
      window.__map.triggerRepaint();
      await new Promise(r => setTimeout(r, 200));
    }
  }
  window.SKY_TUNE.cloudSet = 'A';
});
const cloudsLoaded = await page.evaluate(() => window.__skyGL.cloudsReady());

// ---- in-page toolkit ----------------------------------------------------------
await page.evaluate(() => {
  const T = window.__T = {};
  T.frames = async (k) => {
    const m = window.__map;
    for (let i = 0; i < k; i++) { m.triggerRepaint(); await new Promise(r => m.once('render', r)); }
  };
  T.hz = () => {
    const m = window.__map, cv = m.getCanvas();
    const rad = d => d * Math.PI / 180, fov = m.getVerticalFieldOfView();
    const off = Math.tan(rad(90 - m.getPitch())) / Math.tan(rad(fov / 2));
    return (0.5 - 0.5 * off) * cv.clientHeight;
  };
  // Read pixels straight after a render event, from the finished frame.
  T.read = (pts) => new Promise(res => {
    const m = window.__map;
    m.once('render', () => {
      const cv = m.getCanvas();
      const gl = cv.getContext('webgl2') || cv.getContext('webgl');
      const sx = cv.width / cv.clientWidth, sy = cv.height / cv.clientHeight;
      const out = [], px = new Uint8Array(4);
      for (const [x, y] of pts) {
        gl.readPixels(Math.round(x * sx), cv.height - 1 - Math.round(y * sy), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        out.push([px[0], px[1], px[2]]);
      }
      res(out);
    });
    m.triggerRepaint();
  });
  T.state = async (pose, st) => {
    const m = window.__map;
    window.SKY_COMP.mode = st.mode;
    window.SKY_TUNE.cloudSet = st.set || 'A';
    window.GFX.clouds = st.clouds; window.GFX.stars = st.stars;
    window.SKY_TUNE.TWINKLE.AMP = 0;
    if (window.SKY_TUNE.GL) { window.SKY_TUNE.GL.DRIFT = 0; window.SKY_TUNE.GL.ROT = st.rot || 0; }
    Object.assign(window.SKY_GL_DEBUG, { atmoGain: 1, cloudGain: 1, featherShiftPx: 0, seamShift: 0 }, st.dbg || {});
    m.jumpTo({ center: [-97.7434, 30.2857], zoom: 16.4, pitch: pose.pitch, bearing: pose.bearing });
    window.applyTimeOfDay(m, pose.p, true);
    await T.frames(5);
  };
});

const results = [];
const check = (id, name, pass, detail) => results.push({ id, name, pass, detail: String(detail) });

const skyPoints = (hz, W) => {
  const pts = [];
  for (const f of FRACS) for (const c of COLS) pts.push([c * W, f * hz]);
  return pts;
};
const rowPts = (hz, W) => {
  const pts = [];
  for (const o of HZ_OFFS) for (const c of COLS) pts.push([c * W, hz + o]);
  return pts;
};

// ---- a. atmosphere agrees ------------------------------------------------------
async function runA(brk) {
  const dbg = brk ? BREAKS.a.dbg : {};
  let worst = 0, sum = 0, n = 0, where = '';
  for (const [name, pose] of Object.entries(POSES)) {
    const grab = async (mode) => {
      await page.evaluate(([pose, st]) => window.__T.state(pose, st),
        [pose, { mode, clouds: 0, stars: 0, dbg: mode === 'gl' ? dbg : {} }]);
      return page.evaluate(() => {
        const T = window.__T, W = window.__map.getCanvas().clientWidth, hz = T.hz();
        const pts = [];
        for (const f of [0.08, 0.3, 0.55, 0.8, 0.93]) for (const c of [0.15, 0.5, 0.85]) pts.push([c * W, f * hz]);
        for (const o of [-30, -16, -8, 0, 6, 12]) for (const c of [0.15, 0.5, 0.85]) pts.push([c * W, hz + o]);
        return T.read(pts);
      });
    };
    const A = await grab('canvas'), B = await grab('gl');
    for (let i = 0; i < A.length; i++) for (let k = 0; k < 3; k++) {
      const d = Math.abs(A[i][k] - B[i][k]);
      sum += d; n++;
      if (d > worst) { worst = d; where = `${name} point ${i} ch ${k}: canvas ${A[i][k]} gl ${B[i][k]}`; }
    }
  }
  const mean = sum / n;
  return { pass: worst <= TUNE.ATMOS_MAX && mean <= TUNE.ATMOS_MEAN,
           detail: `max ${worst} (${where}), mean ${mean.toFixed(2)} over ${n} channel samples; limits max ${TUNE.ATMOS_MAX}, mean ${TUNE.ATMOS_MEAN}` };
}

// ---- b. no seam at the panorama wrap -------------------------------------------
async function runB(brk) {
  const dbg = brk ? BREAKS.b.dbg : {};
  // File level: the last column of the cloud file must continue into the first.
  // Fetched and decoded here, by this script, from the URL the app itself uses; the app is
  // not asked about its own file. `edge` is how different the last column is from the first,
  // `typ` how different neighbouring columns are on average, both over coverage and shade.
  const fileSeam = async (set) => page.evaluate(async (set) => {
    const url = window.SKY_TUNE.GL.PANO[set];
    const img = new Image(); img.src = url; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data, W = c.width, H = c.height;
    const col = (x, y, k) => d[(y * W + x) * 4 + k];
    let edge = 0, typ = 0, nt = 0;
    for (let y = 0; y < H; y++) for (const k of [0, 1]) {
      edge += Math.abs(col(W - 1, y, k) - col(0, y, k));
      for (let x = 0; x < W - 1; x += 17) { typ += Math.abs(col(x, y, k) - col(x + 1, y, k)); nt++; }
    }
    edge /= H * 2; typ /= nt;
    return { edge, typ, ratio: edge / Math.max(typ, 0.25), w: W, h: H };
  }, set);
  const files = { A: await fileSeam('A'), B: await fileSeam('B') };
  const file = files.A.ratio >= files.B.ratio ? files.A : files.B;
  // Screen level: centre the seam, read a strip of columns across it, in cloudy rows.
  await page.evaluate(([pose, st]) => window.__T.state(pose, st),
    [POSES.noon, { mode: 'gl', clouds: 1, stars: 0, set: 'A', rot: 0, dbg }]);
  const seamAz = await page.evaluate(() => window.__skyGL.seamAz());
  const best = { score: -1 };
  // Look along the seam at several pitches and take the row set with the most cloud in it,
  // so a clear gap cannot pass the test by being empty.
  for (const pitch of [78, 82, 86]) {
    await page.evaluate(([pose, st]) => window.__T.state(pose, st),
      [{ ...POSES.noon, pitch, bearing: seamAz }, { mode: 'gl', clouds: 1, stars: 0, set: 'A', rot: 0, dbg }]);
    const r = await page.evaluate(() => {
      const T = window.__T, W = window.__map.getCanvas().clientWidth, hz = T.hz();
      const rows = [];
      for (let i = 0; i < 14; i++) rows.push(hz * (0.12 + 0.8 * i / 13));
      const x0 = Math.round(W / 2) - 40, pts = [];
      for (const y of rows) for (let k = 0; k <= 80; k++) pts.push([x0 + k, y]);
      return T.read(pts).then(px => ({ px, nrows: rows.length, x0, W }));
    });
    const cols = 81, steps = [];
    for (let k = 0; k < cols - 1; k++) {
      let s = 0, ink = 0;
      for (let ri = 0; ri < r.nrows; ri++) {
        const a = r.px[ri * cols + k], b = r.px[ri * cols + k + 1];
        s += Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
        ink += (a[0] + a[1] + a[2]) / 3;
      }
      steps.push(s);
    }
    // A cloudy strip is one whose pixels vary: the sum of steps away from the seam.
    const away = steps.filter((_, k) => Math.abs(k - 40) > 3);
    const sorted = away.slice().sort((x, y) => x - y);
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const seamStep = Math.max(steps[38], steps[39], steps[40], steps[41]);
    const activity = away.reduce((x, y) => x + y, 0) / away.length;
    if (activity > best.score) Object.assign(best, { score: activity, p95, seamStep, pitch });
  }
  const limit = TUNE.SEAM_RATIO * best.p95 + TUNE.SEAM_FLOOR;
  const fileOk = file.ratio <= TUNE.SEAM_RATIO + 1;
  return { pass: best.seamStep <= limit && fileOk && best.score > 2,
           detail: `screen: seam step ${best.seamStep} vs limit ${limit.toFixed(1)} (p95 of other columns ${best.p95}, strip activity ${best.score.toFixed(1)}, pitch ${best.pitch}); ` +
                   `files (worse of A and B): last-to-first column step ${file.edge.toFixed(2)} vs typical neighbour step ${file.typ.toFixed(2)}, ${file.w}x${file.h}` };
}

// ---- c. the horizon feather sits where it does today ---------------------------
// A tower in front of the horizon hides the sky behind it in BOTH modes, so a fixed column
// can end up reading a building. The column is therefore picked from the 'canvas' profile
// (the one with the most wash above the feather and a clean fall through it) and the same
// column is read in 'gl'.
async function runC(brk) {
  const dbg = brk ? BREAKS.c.dbg : {};
  const NCOL = 24;
  const prof = async (mode, extraDbg) => {
    await page.evaluate(([pose, st]) => window.__T.state(pose, st),
      [POSES.sunset, { mode, clouds: 0, stars: 0, dbg: extraDbg }]);
    return page.evaluate((NCOL) => {
      const T = window.__T, W = window.__map.getCanvas().clientWidth, hz = T.hz();
      const H = window.__map.getCanvas().clientHeight;
      const y0 = Math.max(2, Math.round(hz - 60)), y1 = Math.round(hz + 30);
      const pts = [];
      for (let c = 0; c < NCOL; c++) for (let y = y0; y <= y1; y++) pts.push([Math.round(W * (0.04 + 0.92 * c / (NCOL - 1))), y]);
      return T.read(pts).then(px => ({ px, y0, y1, hz, fade: 0.036 * H, n: y1 - y0 + 1 }));
    }, NCOL);
  };
  const base = await prof('gl', { atmoGain: 0 });
  const cv = await prof('canvas', {});
  const gl = await prof('gl', dbg);
  // How much the sky wash adds at a pixel: the distance from the same pixel with no GL atmosphere
  // (sum of the three channels). Luminance alone is blind to it at sunset, where the wash is
  // nearly the colour the map's own sky already is.
  const col = (P, c) => P.px.slice(c * P.n, (c + 1) * P.n);
  const contrib = (P, c) => col(P, c).map((p, i) => {
    const b = base.px[c * P.n + i];
    return Math.abs(p[0] - b[0]) + Math.abs(p[1] - b[1]) + Math.abs(p[2] - b[2]);
  });
  // the clean column: the biggest wash in the top rows of the window, which only a column with
  // no building above the horizon band can have
  let bestC = 0, bestTop = -1e9;
  for (let c = 0; c < NCOL; c++) {
    const cc = contrib(cv, c);
    const top = cc.slice(0, 6).reduce((a, b) => a + b, 0) / 6;
    const holes = cc.slice(0, Math.max(3, Math.round(cv.hz - 0.5 * cv.fade - cv.y0 - 4))).filter(v => v < 0.5 * top).length;
    if (holes === 0 && top > bestTop) { bestTop = top; bestC = c; }
  }
  const half = (P) => {
    const cc = contrib(P, bestC);
    const top = Math.max(...cc.slice(0, Math.max(3, Math.round(P.hz - 0.5 * P.fade - P.y0 - 4))));
    if (!(top > 6)) return { y: null, top };
    for (let i = 0; i < cc.length; i++) {
      const y = P.y0 + i;
      if (y > P.hz - 0.5 * P.fade - 4 && cc[i] < 0.5 * top) return { y, top };
    }
    return { y: null, top };
  };
  const hC = half(cv), hG = half(gl);
  const ok = hC.y != null && hG.y != null && Math.abs(hC.y - hG.y) <= TUNE.FEATHER_PX
    && Math.abs(hC.y - cv.hz) <= 0.5 * cv.fade + 2;
  return { pass: ok, detail: `half-way row: canvas ${hC.y}, gl ${hG.y} (horizon ${cv.hz.toFixed(1)}, feather width ${cv.fade.toFixed(1)} px, peak wash ${hC.top.toFixed(1)} / ${hG.top.toFixed(1)} levels, column ${bestC} of ${NCOL}); limit ${TUNE.FEATHER_PX} px` };
}

// ---- d. clouds are drawn in gl mode --------------------------------------------
async function runD(brk) {
  const dbg = brk ? BREAKS.d.dbg : {};
  const meas = async (set, clouds) => {
    await page.evaluate(([pose, st]) => window.__T.state(pose, st),
      [POSES.noon, { mode: 'gl', clouds, stars: 0, set, dbg: clouds ? dbg : {} }]);
    return page.evaluate(() => {
      const T = window.__T, W = window.__map.getCanvas().clientWidth, hz = T.hz();
      const pts = [];
      for (let yi = 0; yi < 40; yi++) for (let xi = 0; xi < 64; xi++)
        pts.push([(xi + 0.5) / 64 * W, 4 + (yi + 0.5) / 40 * Math.max(10, hz - 8)]);
      return T.read(pts);
    });
  };
  const off = await meas('A', 0);
  const on = await meas('A', 1);
  const onB = await meas('B', 1);
  const frac = (X, Y) => {
    let c = 0;
    for (let i = 0; i < X.length; i++) {
      const d = Math.max(Math.abs(X[i][0] - Y[i][0]), Math.abs(X[i][1] - Y[i][1]), Math.abs(X[i][2] - Y[i][2]));
      if (d >= TUNE.CLOUD_LEVELS) c++;
    }
    return c / X.length;
  };
  const fa = frac(on, off), fb = frac(onB, off), ab = frac(on, onB);
  return { pass: cloudsLoaded && fa >= TUNE.CLOUD_FRAC,
           detail: `look A changes ${(fa * 100).toFixed(1)}% of sky samples by >= ${TUNE.CLOUD_LEVELS} levels (need ${(TUNE.CLOUD_FRAC * 100).toFixed(0)}%); look B ${(fb * 100).toFixed(1)}%; A vs B differ on ${(ab * 100).toFixed(1)}%; panoramas loaded: ${cloudsLoaded}` };
}

// ---- e. turning: no 2D sky draws, no uploads -----------------------------------
async function runE(brk) {
  const run = async (mode) => {
    await page.evaluate(([pose, st]) => window.__T.state(pose, st),
      [POSES.noon, { mode, clouds: 1, stars: 1 }]);
    return page.evaluate(async ({ frames, step }) => {
      const m = window.__map, S = window.__sky, X = window.__texCalls;
      const s0 = { d2: S.draws2d, up: S.uploads, gl: S.glDraws, calls: S.calls };
      const x0 = { sky: X.skyCanvas, wide: X.wide, tot: X.total };
      const b0 = m.getBearing();
      for (let i = 1; i <= frames; i++) {
        m.jumpTo({ bearing: b0 + i * step });
        await new Promise(r => m.once('render', r));
      }
      return { d2: S.draws2d - s0.d2, up: S.uploads - s0.up, gl: S.glDraws - s0.gl, calls: S.calls - s0.calls,
               skyCanvas: X.skyCanvas - x0.sky, wide: X.wide - x0.wide, total: X.total - x0.tot };
    }, { frames: TUNE.TURN_FRAMES, step: TUNE.TURN_STEP_DEG });
  };
  const turn = await run(brk ? BREAKS.e.turnMode : 'gl');
  const ctl = await run('canvas');
  const clean = turn.d2 === 0 && turn.up === 0 && turn.skyCanvas === 0 && turn.wide === 0 && turn.gl >= TUNE.TURN_FRAMES * 0.8;
  const alive = ctl.d2 >= TUNE.TURN_FRAMES * 0.8 && ctl.skyCanvas >= TUNE.TURN_FRAMES * 0.8;
  return { pass: clean && alive,
           detail: `gl turn of ${TUNE.TURN_FRAMES} frames: 2D draws ${turn.d2}, app uploads ${turn.up}, wrapper-seen sky-canvas uploads ${turn.skyCanvas}, wide-canvas uploads ${turn.wide}, GL draws ${turn.gl}, updateSky calls ${turn.calls}; ` +
                   `canvas control: 2D draws ${ctl.d2}, wrapper-seen uploads ${ctl.skyCanvas} (instrument ${alive ? 'alive' : 'DEAD'})` };
}

// ---- g. we are sampling our own output ------------------------------------------
async function runG(brk) {
  const mode = brk ? BREAKS.g.ownMode : 'gl';
  await page.evaluate(([pose, st]) => window.__T.state(pose, st),
    [POSES.sunset, { mode, clouds: 0, stars: 0 }]);
  const info = await page.evaluate(async () => {
    const T = window.__T, S = window.__sky, W = window.__map.getCanvas().clientWidth, hz = T.hz();
    const cv = document.getElementById('sky-canvas');
    const g0 = S.glDraws;
    await T.frames(3);
    const glDrew = S.glDraws - g0;
    const pts = [[W * 0.5, hz * 0.8], [W * 0.5, hz - 10], [W * 0.3, hz - 20]];
    const withGL = await T.read(pts);
    window.SKY_GL_DEBUG.atmoGain = 0;
    await T.frames(3);
    const noGL = await T.read(pts);
    window.SKY_GL_DEBUG.atmoGain = 1;
    let diff = 0;
    for (let i = 0; i < pts.length; i++) for (let k = 0; k < 3; k++) diff = Math.max(diff, Math.abs(withGL[i][k] - noGL[i][k]));
    return { canvasW: cv ? cv.width : -1, glDrew, diff, mode: window.SKY_COMP.mode };
  });
  const pass = info.mode === 'gl' && info.canvasW <= 4 && info.glDrew >= 3 && info.diff >= 6;
  return { pass, detail: `mode ${info.mode}, 2D sky canvas ${info.canvasW} px wide, GL sky draws in 3 frames ${info.glDrew}, zeroing the GL atmosphere moves pixels by up to ${info.diff} levels` };
}

const SUITE = [
  ['a', 'atmosphere agrees at noon, sunset, night', runA],
  ['b', 'no seam at the panorama wrap', runB],
  ['c', 'horizon feather sits where it does today', runC],
  ['d', 'clouds are drawn in gl mode', runD],
  ['e', 'turning costs no 2D draw and no upload', runE],
  ['g', 'the pixels are the GL path\'s own', runG],
];

if (ONLY) { for (let i = SUITE.length - 1; i >= 0; i--) if (!ONLY.split(',').includes(SUITE[i][0])) SUITE.splice(i, 1); }
if (!BREAK) {
  for (const [id, name, fn] of SUITE) {
    const r = await fn(false);
    check(id, name, r.pass, r.detail);
  }
} else {
  // Each break must turn ITS assertion red. Run the clean one too, so a gate that is
  // always red cannot pass as "every break failed".
  for (const [id, name, fn] of SUITE) {
    const clean = await fn(false);
    const broke = await fn(true);
    check(id, `${name}  [break: ${BREAKS[id].name}]`, clean.pass && !broke.pass,
      `clean ${clean.pass ? 'green' : 'RED'}, broken ${broke.pass ? 'GREEN (the assertion cannot fail)' : 'red as it must be'} | clean: ${clean.detail} | broken: ${broke.detail}`);
  }
}

// ---- pictures ---------------------------------------------------------------------
if (SHOTS) {
  fs.mkdirSync(SHOTS, { recursive: true });
  for (const [name, pose] of Object.entries(POSES)) {
    for (const [label, st] of [['canvas', { mode: 'canvas', set: 'A' }], ['glA', { mode: 'gl', set: 'A' }], ['glB', { mode: 'gl', set: 'B' }]]) {
      await page.evaluate(([pose, st]) => window.__T.state(pose, { ...st, clouds: 1, stars: 1 }), [pose, st]);
      await page.evaluate(() => { window.SKY_TUNE.TWINKLE.AMP = 0; });
      await page.evaluate(() => window.__T.frames(3));
      await page.screenshot({ path: path.join(SHOTS, `sky-${name}-${label}.png`) });
    }
  }
}

if (errs.length) console.log('page messages:\n  ' + [...new Set(errs)].slice(0, 8).join('\n  '));
let bad = 0;
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.id}. ${r.name}\n        ${r.detail}`);
  if (!r.pass) bad++;
}
console.log(`\n${results.length - bad}/${results.length} ${BREAK ? 'break switches turned their assertion red' : 'assertions pass'}`);
await browser.__done();
process.exit(REPORT ? 0 : (bad ? 1 : 0));
