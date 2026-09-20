#!/usr/bin/env node
/**
 * night-compare.mjs — the night renderer's comparison harness.
 *
 * Shoots every pose in `night-routes.json` at every requested lighting regime
 * (blue hour, twilight, full night by default), for one build or for TWO builds
 * or flag sets side by side, and writes:
 *
 *   <out>/frames/<side>-<route>-<pose>-<regime>.jpg   the kept (second) screenshot
 *   <out>/sheet-<route>-<pose>.jpg     rows = regimes; columns = A | B | reference
 *   <out>/overview-<side>-<n>.jpg      rows = poses; columns = regimes (one side)
 *   <out>/regions-<route>-<pose>.jpg   with --show-regions: the named regions drawn
 *   <out>/report.json                  every setting, camera check and measurement
 *
 * ── Running it ────────────────────────────────────────────────────────────
 *
 * Serve the checkout on your own port, then run it THROUGH the machine's GPU
 * slot wrapper. Parallel hardware-GL Chromes have blue-screened the Acer, so on
 * that machine every browser-launching command is wrapped:
 *
 *   python scripts/serve.py 8661            # from the repo root
 *   node <lanes>/gpu-run.mjs --label night-compare -- \
 *     node scripts/verify/night-compare.mjs --out <scratch>/run1
 *
 * (`gpu-run.mjs` lives in the session's lanes scratch folder, not in the repo:
 * it holds one of three machine-wide browser slots and passes the exit code
 * through. On a machine without it, run the command bare, one at a time.)
 *
 *   --out <dir>            required. Frames, sheets and report go here (use a scratch
 *                          folder: a full run is ~50 MB of JPEG).
 *   --a '<query>'          side A: appended to the page URL (default '' = the build as
 *                          shipped). '&flag=1', '?flag=1' and 'flag=1' all work.
 *   --b '<query>'          side B. Omit it for a one-sided run.
 *   --a-site / --b-site    serve two different BUILDS (e.g. main on :8661 and a
 *                          branch worktree on :8662). Default VERIFY_URL, then SITE.
 *   --a-label / --b-label  column titles (default: the query, or "as shipped").
 *   --only r1,r2/pose      route ids, or route/pose ids, to shoot.
 *   --regimes blue,night   override every route's regimes (names in night-routes.json:
 *                          day golden blue twilight early night).
 *   --routes <file>        default scripts/verify/night-routes.json.
 *   --local <file|none>    an overlay of extra or replacement routes that must NOT be
 *                          committed (matched poses for the owner's photos, with their
 *                          refs). Default: <repo>/../austin-reference-images/_night/
 *                          night-routes.local.json when it exists. Loaded loudly.
 *   --refs off             no reference column (use this for sheets you will commit:
 *                          third-party and owner photographs are never committed).
 *   --tile <px>            sheet tile width (default 560).
 *   --same <pct>           ASSERT: in every frame, fewer than <pct>% of pixels differ
 *                          between A and B by more than 16 luma. For "this change does
 *                          not move day/golden" (plan A9). Exit 1 when it does not hold.
 *   --break                sabotage side B in the page only (the authored apartments are
 *                          hidden). With --same it must go red: that is the watched failure.
 *   --from <dir>           re-measure an earlier run's frames with the CURRENT regions
 *                          and rewrite its report and sheets. No app is loaded.
 *   --show-regions         write regions-<route>-<pose>.jpg: side A's frame with the pose's
 *                          regions drawn on a labelled 5% grid, so the next rectangle is READ
 *                          OFF the frame. Poses with no regions get one too.
 *   --gl hardware|swiftshader   default hardware (screenshots; see chrome.mjs).
 *
 * ── What each shot does ───────────────────────────────────────────────────
 *
 * Page: index.html?intro=0&drift=0&clip=1<query>, 1440x900 at DPR 1. The graphics
 * auto-detect probe is cancelled at once; the harness then waits for the real veil
 * to lift AND for window.slopesApartments.readyToReveal() with a built group — the
 * authored buildings, not the legacy fallback. If the app has switched the authored
 * buildings off for the visit (js/app.js, INTRO.authoredCeilingMs, which fires under
 * machine load), they are switched back on and the report says so. If they cannot be
 * had, the run exits 2: frames of the fallback city are not frames of our city.
 *
 * Regimes are applied once each (applyTimeOfDay(map, p, true)); every pose is then
 * shot under that regime: jumpTo, auto-exposure meter reset, wait for tiles + idle
 * + the authored buildings' sources, re-pose, settle 3 s, screenshot, 1 s,
 * screenshot again and KEEP THE SECOND. If the two disagree (more than SETTLE.maxPct
 * of pixels by more than SETTLE.luma), it waits and shoots again, up to
 * SETTLE.retries times, and records how settled the kept frame was.
 *
 * The camera is checked against what was asked (pitch, and eye altitude from
 * window.__fly.eye() for eye/target poses). A pose the camera did not reach is
 * "uninterpretable" and makes the run exit 2 (the frame is still written).
 *
 * ── What it measures ──────────────────────────────────────────────────────
 *
 * From the kept JPEG, in the page (never as a 1.3 M-entry array over CDP), with
 * 256-bin histograms:
 *   luma  Rec.709 weights on the graded sRGB values, 0-255 (the unit of every
 *         table in docs/night-implementation-plan.md §1.4);
 *   Y     linear relative luminance (sRGB decoded), 0-1: the unit for RATIOS.
 * For the whole frame and each named region: mean and p10/p50/p90 (luma also p1,
 * p99); hot = % of pixels over luma 120 and over 200.
 * Ratios: wall/sky, ground/sky, water/sky, wall/ground, from median Y. A region
 * named anything else (dome, tower) is measured and reported but not divided.
 * Windows (MEASURE below): in the `wall` region, a pixel is a BRIGHT WINDOW when
 * its Y is at least relK x the region's median Y, its luma is at least minLuma,
 * and R >= B (warm or neutral: the night-luma.mjs split, so pale masonry
 * reflecting a blue sky is not a window). Reported as a % of the region, with the
 * mean sRGB of those pixels. `abs` is the cruder "% over luma 120 with R >= B"
 * the plan's §1.2 quotes.
 * These are pixel classes, not truth: at blue hour a sunlit warm wall can pass the
 * absolute test, and a lit wall region with no windows in it measures nothing.
 * A pose with NO wall region falls back to the whole frame, and then the number is
 * not a window count at all -- at blue hour it is mostly sky and lit pavement. That
 * sets windows.fallback and stars the number in the table. Give the pose a wall.
 * A/B: mean |delta luma|, % of pixels over 16 and over 48, per frame.
 *
 * ── Exit codes (scripts/verify/README.md) ─────────────────────────────────
 *   0  every shot taken and interpretable (and --same held, when given)
 *   1  --same failed: A and B differ beyond tolerance in at least one frame
 *   2  cannot run or cannot interpret: bad arguments, the page never became ready,
 *      the authored buildings are missing, a pose not reached, a blank frame
 *   124 the chrome.mjs watchdog
 */
import { chromium } from 'playwright-core';
import { launch, BASE } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

// ── Parameters (every threshold in one place) ───────────────────────────────
const FOV = 58, MAX_PITCH = 88;              // the app's camera (js/controls.js)
const WAIT = {
  styleMs: 180000,       // map + style
  veilMs: 300000,        // the veil lifting
  authoredMs: 600000,    // authored buildings ready (after a re-enable, a full build)
  regimeIdleMs: 30000,   // after applyTimeOfDay
  tilesMs: 45000,        // per pose: tiles + authored sources
  idleMs: 20000,         // per pose: then one 'idle'
  settleMs: 3000,        // per pose: then this long before the first screenshot
  secondShotMs: 1000,    // the second screenshot, which is the one kept
};
const SETTLE = { luma: 24, maxPct: 0.25, retries: 2, waitMs: 3000 };
const CAMERA = { pitchTol: 0.6, altTolAbs: 1.5, altTolRel: 0.05, zoomTol: 0.02 };
const MEASURE = { relK: 4, minLuma: 40, absLuma: 120, hotLuma: 120, veryHotLuma: 200, blankStd: 1.0 };
const DIFF = { luma: 16, lumaBig: 48 };
const JPEG_Q = 90, SHEET_Q = 0.82;

// ── Arguments ───────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
function arg(name, dflt) {
  const i = argv.indexOf('--' + name);
  if (i < 0) return dflt;
  const v = argv[i + 1];
  if (v === undefined || (v.startsWith('--') && v.length > 2)) return '';   // --a with an empty value
  return v;
}
const has = name => argv.includes('--' + name);
function die(msg) { console.error('night-compare: ' + msg); process.exit(2); }

const OUT = arg('out', null);
if (!OUT) die('--out <dir> is required (see the header of this file)');
const FROM = arg('from', null);
const ROUTES_FILE = path.resolve(arg('routes', path.join(HERE, 'night-routes.json')));
const LOCAL_ARG = arg('local', null);
const ONLY = arg('only', null) ? arg('only').split(',').map(s => s.trim()).filter(Boolean) : null;
const REGIMES_ARG = arg('regimes', null) ? arg('regimes').split(',').map(s => s.trim()).filter(Boolean) : null;
const REFS_ON = arg('refs', 'on') !== 'off';
const TILE_W = Math.max(200, Math.min(1440, +arg('tile', 560) || 560));
const SAME = has('same') ? Number(arg('same')) : null;
if (SAME != null && !(SAME >= 0)) die('--same needs a percentage, e.g. --same 1');
const BREAK = has('break');
const SHOW_REGIONS = has('show-regions');
const GL = arg('gl', 'hardware');
const DEFAULT_SITE = (process.env.VERIFY_URL || process.env.SITE || BASE).replace(/\/+$/, '');
const normQ = q => { q = (q || '').trim(); if (!q) return ''; if (q[0] === '?' || q[0] === '&') q = q.slice(1); return '&' + q; };
const SIDES = [{ key: 'A', site: (arg('a-site', '') || DEFAULT_SITE).replace(/\/+$/, ''), query: normQ(arg('a', '')), label: arg('a-label', '') }];
if (has('b') || has('b-site')) SIDES.push({ key: 'B', site: (arg('b-site', '') || DEFAULT_SITE).replace(/\/+$/, ''), query: normQ(arg('b', '')), label: arg('b-label', '') });
for (const s of SIDES) {
  if (!s.label) s.label = (s.site !== DEFAULT_SITE ? s.site.replace(/^https?:\/\//, '') + ' ' : '') + (s.query || 'as shipped');
  if (BREAK && s.key === 'B') s.label += ' [--break]';
}
if (BREAK && SIDES.length < 2) die('--break sabotages side B; pass --b too');
if (SAME != null && SIDES.length < 2 && !FROM) die('--same compares A with B; pass --b too');

// ── Routes ──────────────────────────────────────────────────────────────────
function readJSON(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { die(`cannot read ${f}: ${e.message}`); } }
const CFG = readJSON(ROUTES_FILE);
let localFile = null;
if (LOCAL_ARG === 'none') localFile = null;
else if (LOCAL_ARG) localFile = path.resolve(LOCAL_ARG);
else {
  const d = path.resolve(REPO, '..', 'austin-reference-images', '_night', 'night-routes.local.json');
  if (fs.existsSync(d)) localFile = d;
}
if (LOCAL_ARG && LOCAL_ARG !== 'none' && !fs.existsSync(localFile)) die(`--local ${localFile} does not exist`);
if (localFile) {
  const L = readJSON(localFile);
  console.log(`night-compare: LOCAL OVERLAY LOADED: ${localFile} (${(L.routes || []).length} routes; its poses and refs must never be committed)`);
  for (const r of L.routes || []) {
    r.local = true;
    const i = CFG.routes.findIndex(x => x.id === r.id);
    if (i >= 0) CFG.routes[i] = r; else CFG.routes.push(r);
  }
  Object.assign(CFG.regimes, L.regimes || {});
}
const REF_ROOT = path.resolve(REPO, process.env.NIGHT_REF_ROOT || CFG.refRoot || '../austin-reference-images');
const [VW, VH] = CFG.viewport || [1440, 900];

function validRect(r) { return Array.isArray(r) && r.length === 4 && r.every(v => typeof v === 'number' && v >= 0 && v <= 1) && r[2] > r[0] && r[3] > r[1]; }
function rectsOf(spec) { return validRect(spec) ? [spec] : (Array.isArray(spec) && spec.every(validRect) ? spec : null); }

const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
/** eye/target ([lng, lat, alt] each) -> a MapLibre pose the app's camera can hold. */
function derive(eye, target) {
  const mlon = 111320 * Math.cos(rad(eye[1])), mlat = 110540;
  const dx = (target[0] - eye[0]) * mlon, dy = (target[1] - eye[1]) * mlat;
  const eyeAlt = Math.max(1.6, eye[2]);
  const horiz = Math.hypot(dx, dy);
  const bearing = (deg(Math.atan2(dx, dy)) + 360) % 360;
  let pitch = deg(Math.atan2(horiz, eyeAlt - target[2]));
  if (!isFinite(pitch) || pitch < 0 || pitch > MAX_PITCH) pitch = MAX_PITCH;
  pitch = Math.max(5, pitch);
  const gd = eyeAlt * Math.tan(rad(pitch));
  const lng = eye[0] + Math.sin(rad(bearing)) * gd / mlon, lat = eye[1] + Math.cos(rad(bearing)) * gd / mlat;
  const range = eyeAlt / Math.cos(rad(pitch));
  const c2c = 0.5 * VH / Math.tan(rad(FOV / 2));
  const zoom = Math.log2(40075016.686 * Math.cos(rad(lat)) / (512 * (range / c2c)));
  return { center: [lng, lat], zoom, pitch, bearing, eyeAlt };
}

const POSES = [];
for (const r of CFG.routes || []) {
  if (!r.id || !Array.isArray(r.poses) || !r.poses.length) die(`route ${r.id || '?'} has no poses`);
  for (const p of r.poses) {
    const key = `${r.id}/${p.id}`;
    if (ONLY && !ONLY.includes(r.id) && !ONLY.includes(key)) continue;
    let cam;
    if (p.eye && p.target) {
      if (!(p.eye.length === 3 && p.target.length === 3)) die(`${key}: eye and target are [lng, lat, alt]`);
      cam = derive(p.eye, p.target);
    } else if (p.center && p.zoom != null) {
      cam = { center: p.center, zoom: p.zoom, pitch: p.pitch ?? 0, bearing: p.bearing ?? 0, eyeAlt: null };
    } else die(`${key}: a pose needs eye+target or center+zoom`);
    const regions = {};
    for (const [name, spec] of Object.entries(p.regions || {})) {
      const rs = rectsOf(spec);
      if (!rs) die(`${key}: region ${name} is not [x0,y0,x1,y1] (fractions) or a list of them`);
      regions[name] = rs;
    }
    const regimes = REGIMES_ARG || p.regimes || r.regimes || CFG.defaultRegimes;
    for (const g of regimes) if (!CFG.regimes[g]) die(`${key}: unknown regime ${g}`);
    POSES.push({ route: r.id, pose: p.id, key, title: r.title, local: !!r.local, cam, eye: p.eye || null, target: p.target || null,
      regions, regimes, refs: Object.assign({}, r.refs || {}, p.refs || {}) });
  }
}
if (!POSES.length) die('no poses selected' + (ONLY ? ` by --only ${ONLY.join(',')}` : ''));
const REGIME_ORDER = Object.keys(CFG.regimes);
const REGIMES_USED = REGIME_ORDER.filter(g => POSES.some(p => p.regimes.includes(g)));

const slug = s => String(s).replace(/[^\w.-]+/g, '_');
const FRAMES = path.join(OUT, 'frames');
fs.mkdirSync(FRAMES, { recursive: true });
const frameName = (side, P, g) => `${side}-${slug(P.route)}-${slug(P.pose)}-${g}.jpg`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function gitInfo() {
  try {
    const head = execSync('git rev-parse --short HEAD', { cwd: REPO }).toString().trim();
    const dirty = execSync('git status --porcelain --untracked-files=no', { cwd: REPO }).toString().trim().length > 0;
    return { head, dirty };
  } catch (e) { return null; }
}
/** A fingerprint of the BUILD a site serves: index.html plus every local script it loads. */
async function buildPrint(site) {
  try {
    const h = crypto.createHash('sha1');
    const idx = await (await fetch(site + '/index.html')).text();
    h.update(idx);
    const srcs = [...idx.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => m[1]).filter(s => !/^https?:/.test(s));
    for (const s of srcs) h.update(await (await fetch(site + '/' + s.replace(/^\//, ''))).text());
    return { sha1: h.digest('hex').slice(0, 12), scripts: srcs.length };
  } catch (e) { return { error: e.message }; }
}

// ── In-page helpers (the measuring page; no app loaded in it) ───────────────
/** Decode a JPEG and measure it. Runs in the helper page. */
function pageMeasure({ b64, regions, M }) {
  return (async () => {
    const img = new Image(); img.src = 'data:image/jpeg;base64,' + b64; await img.decode();
    const W = img.width, H = img.height;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, W, H).data;
    const lin = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const v = i / 255; lin[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
    const enc = y => Math.max(0, Math.min(255, Math.round(255 * (y <= 0.0031308 ? 12.92 * y : 1.055 * Math.pow(y, 1 / 2.4) - 0.055))));
    const dec = b => lin[b];
    // one pass over a set of rects -> stats
    function stats(rects) {
      const hl = new Uint32Array(256), hy = new Uint32Array(256);
      let n = 0, sl = 0, sy = 0, sl2 = 0, r = 0, g = 0, bb = 0, hot = 0, vhot = 0;
      for (const [x0, y0, x1, y1] of rects) {
        const X0 = Math.floor(x0 * W), X1 = Math.min(W, Math.ceil(x1 * W)), Y0 = Math.floor(y0 * H), Y1 = Math.min(H, Math.ceil(y1 * H));
        for (let y = Y0; y < Y1; y++) for (let xx = X0; xx < X1; xx++) {
          const i = (y * W + xx) * 4, R = d[i], G = d[i + 1], B = d[i + 2];
          const L = 0.2126 * R + 0.7152 * G + 0.0722 * B;
          const Y = 0.2126 * lin[R] + 0.7152 * lin[G] + 0.0722 * lin[B];
          hl[Math.min(255, L | 0)]++; hy[enc(Y)]++;
          n++; sl += L; sl2 += L * L; sy += Y; r += R; g += G; bb += B;
          if (L > M.hotLuma) hot++; if (L > M.veryHotLuma) vhot++;
        }
      }
      const q = (h, f) => { let acc = 0; for (let v = 0; v < 256; v++) { acc += h[v]; if (acc >= f * n) return v; } return 255; };
      const r4 = v => +v.toPrecision(4);
      return {
        n,
        luma: { mean: +(sl / n).toFixed(1), std: +Math.sqrt(Math.max(0, sl2 / n - (sl / n) ** 2)).toFixed(2), p1: q(hl, .01), p10: q(hl, .1), p50: q(hl, .5), p90: q(hl, .9), p99: q(hl, .99) },
        Y: { mean: r4(sy / n), p10: r4(dec(q(hy, .1))), p50: r4(dec(q(hy, .5))), p90: r4(dec(q(hy, .9))) },
        rgb: [Math.round(r / n), Math.round(g / n), Math.round(bb / n)],
        hot120: +(100 * hot / n).toFixed(3), hot200: +(100 * vhot / n).toFixed(3),
      };
    }
    const frame = stats([[0, 0, 1, 1]]);
    const out = { frame, regions: {} };
    for (const [name, rects] of Object.entries(regions)) out.regions[name] = stats(rects);
    // bright windows in the wall region (or the frame)
    const wr = regions.wall || [[0, 0, 1, 1]];
    const med = (regions.wall ? out.regions.wall : frame).Y.p50;
    const thr = Math.max(M.relK * med, 1e-6);
    let n = 0, win = 0, abs = 0, wr_ = 0, wg = 0, wb = 0;
    for (const [x0, y0, x1, y1] of wr) {
      const X0 = Math.floor(x0 * W), X1 = Math.min(W, Math.ceil(x1 * W)), Y0 = Math.floor(y0 * H), Y1 = Math.min(H, Math.ceil(y1 * H));
      for (let y = Y0; y < Y1; y++) for (let xx = X0; xx < X1; xx++) {
        const i = (y * W + xx) * 4, R = d[i], G = d[i + 1], B = d[i + 2];
        const L = 0.2126 * R + 0.7152 * G + 0.0722 * B;
        const Y = 0.2126 * lin[R] + 0.7152 * lin[G] + 0.0722 * lin[B];
        n++;
        if (R >= B && L >= M.minLuma && Y >= thr) { win++; wr_ += R; wg += G; wb += B; }
        if (R >= B && L > M.absLuma) abs++;
      }
    }
    // With no `wall` region the test runs over the whole frame, where at blue hour
    // bright sky and pavement pass it. That number is NOT a window count; it is
    // flagged so no table can quote it as one.
    out.windows = { region: regions.wall ? 'wall' : 'frame', fallback: !regions.wall, medianY: med, relK: M.relK,
      pct: +(100 * win / n).toFixed(3), absPct: +(100 * abs / n).toFixed(3),
      rgb: win ? [Math.round(wr_ / win), Math.round(wg / win), Math.round(wb / win)] : null };
    const Y50 = k => out.regions[k] ? out.regions[k].Y.p50 : null;
    const ratio = (a, b) => (Y50(a) != null && Y50(b) != null && Y50(b) > 0) ? +(Y50(a) / Y50(b)).toPrecision(3) : undefined;
    out.ratios = {};
    for (const [a, b] of [['wall', 'sky'], ['ground', 'sky'], ['water', 'sky'], ['wall', 'ground']]) { const v = ratio(a, b); if (v !== undefined) out.ratios[a + '/' + b] = v; }
    return out;
  })();
}

/** |delta luma| between two JPEGs of the same size. Runs in the helper page. */
function pageDiff({ a, b, D }) {
  return (async () => {
    const load = async s => { const im = new Image(); im.src = 'data:image/jpeg;base64,' + s; await im.decode(); const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(im, 0, 0); return x.getImageData(0, 0, c.width, c.height); };
    const A = await load(a), B = await load(b);
    if (A.width !== B.width || A.height !== B.height) return { error: 'size mismatch' };
    const da = A.data, db = B.data; let n = 0, s = 0, over = 0, big = 0;
    for (let i = 0; i < da.length; i += 4) {
      const la = 0.2126 * da[i] + 0.7152 * da[i + 1] + 0.0722 * da[i + 2];
      const lb = 0.2126 * db[i] + 0.7152 * db[i + 1] + 0.0722 * db[i + 2];
      const t = Math.abs(la - lb); n++; s += t; if (t > D.luma) over++; if (t > D.lumaBig) big++;
    }
    return { meanAbs: +(s / n).toFixed(3), pctOver: +(100 * over / n).toFixed(3), pctBig: +(100 * big / n).toFixed(3) };
  })();
}

/** Compose a labelled grid of tiles into one JPEG. Runs in the helper page. */
function pageSheet({ title, colHeads, rows, tileW, tileH, q, rowHeadW }) {
  return (async () => {
    const HEAD = 30, COLH = 22, PAD = 4;
    const W = rowHeadW + colHeads.length * (tileW + PAD) + PAD;
    const H = HEAD + COLH + rows.length * (tileH + PAD) + PAD;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    x.fillStyle = '#16181c'; x.fillRect(0, 0, W, H);
    x.fillStyle = '#e8e6e1'; x.textBaseline = 'middle';
    // The title carries the route's one-line purpose, and on a one-column sheet
    // it is wider than the sheet. Step the size down until it fits, then let the
    // canvas condense the remainder rather than clipping it off the right edge:
    // a sheet is read as a picture, and a half-sentence caption reads as a bug.
    let ts = 16;
    for (; ts > 11; ts--) { x.font = `600 ${ts}px system-ui, Segoe UI, sans-serif`; if (x.measureText(title).width <= W - 16) break; }
    x.font = `600 ${ts}px system-ui, Segoe UI, sans-serif`;
    x.fillText(title, 8, HEAD / 2 + 1, W - 16);
    x.font = '600 13px system-ui, Segoe UI, sans-serif';
    colHeads.forEach((h, i) => { x.fillStyle = '#c9c4ba'; x.fillText(h, rowHeadW + PAD + i * (tileW + PAD) + 2, HEAD + COLH / 2); });
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r], y0 = HEAD + COLH + r * (tileH + PAD);
      if (rowHeadW) {
        x.save(); x.fillStyle = '#c9c4ba'; x.font = '600 12px system-ui, Segoe UI, sans-serif';
        const lines = String(row.head || '').split('\n');
        lines.forEach((ln, k) => x.fillText(ln, 6, y0 + 14 + k * 15));
        x.restore();
      }
      for (let i = 0; i < row.tiles.length; i++) {
        const t = row.tiles[i], x0 = rowHeadW + PAD + i * (tileW + PAD);
        x.fillStyle = '#0b0c0e'; x.fillRect(x0, y0, tileW, tileH);
        if (t && t.src) {
          try {
            const blob = await (await fetch(t.src)).blob();
            const bmp = await createImageBitmap(blob);
            const s = Math.min(tileW / bmp.width, tileH / bmp.height);
            const w = bmp.width * s, h = bmp.height * s;
            x.imageSmoothingQuality = 'high';
            x.drawImage(bmp, x0 + (tileW - w) / 2, y0 + (tileH - h) / 2, w, h);
            bmp.close && bmp.close();
          } catch (e) { t.lines = ['(could not decode)', ...(t.lines || [])]; }
          if (t.grid) {
            // A labelled 5% grid, so a rectangle for `regions` is READ OFF the
            // frame rather than guessed. Every tenth line is labelled.
            x.font = '600 11px system-ui, sans-serif';
            for (let k = 1; k < 20; k++) {
              const f = k / 20, major = k % 2 === 0;
              x.strokeStyle = major ? 'rgba(255,226,120,0.80)' : 'rgba(255,255,255,0.24)';
              x.lineWidth = 1;
              x.beginPath(); x.moveTo(x0 + f * tileW, y0); x.lineTo(x0 + f * tileW, y0 + tileH); x.stroke();
              x.beginPath(); x.moveTo(x0, y0 + f * tileH); x.lineTo(x0 + tileW, y0 + f * tileH); x.stroke();
              if (major) {
                x.fillStyle = '#ffe278';
                x.fillText(f.toFixed(1), x0 + f * tileW + 2, y0 + 10);
                x.fillText(f.toFixed(1), x0 + 3, y0 + f * tileH - 4);
              }
            }
          }
          if (t.rects) {
            for (const [name, rects, col] of t.rects) {
              x.strokeStyle = col; x.lineWidth = 2; x.fillStyle = col; x.font = '600 12px system-ui, sans-serif';
              for (const [a, b, cc, d] of rects) { x.strokeRect(x0 + a * tileW, y0 + b * tileH, (cc - a) * tileW, (d - b) * tileH); x.fillText(name, x0 + a * tileW + 4, y0 + b * tileH + 10); }
            }
          }
        }
        const lines = (t && t.lines) || [];
        if (lines.length) {
          x.font = '12px system-ui, Segoe UI, sans-serif';
          const lh = 15, bw = Math.min(tileW - 8, Math.max(...lines.map(l => x.measureText(l).width)) + 10);
          x.fillStyle = 'rgba(0,0,0,0.62)'; x.fillRect(x0 + 4, y0 + tileH - 6 - lines.length * lh, bw, lines.length * lh + 2);
          x.fillStyle = '#f2efe8';
          lines.forEach((l, k) => x.fillText(l, x0 + 9, y0 + tileH - 6 - (lines.length - k - 0.5) * lh));
        }
      }
    }
    return c.toDataURL('image/jpeg', q).split(',')[1];
  })();
}

// ── Shooting (one side = one page load) ─────────────────────────────────────
async function shootSide(browser, side, shots, log) {
  const info = { key: side.key, site: side.site, query: side.query, label: side.label, pageErrors: [], warnings: [] };
  info.build = await buildPrint(side.site);
  const url = `${side.site}/index.html?intro=0&drift=0&clip=1${side.query}`;
  info.url = url;
  const page = await browser.newPage({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 });
  page.on('pageerror', e => { if (info.pageErrors.length < 30) info.pageErrors.push(e.message.slice(0, 300)); });
  page.on('console', m => { if (m.type() === 'error' && info.pageErrors.length < 30) info.pageErrors.push('console: ' + m.text().slice(0, 300)); });
  const t0 = Date.now();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: WAIT.styleMs });
  } catch (e) { await page.close(); return { info, fatal: `side ${side.key}: the app never loaded (${e.message.split('\n')[0]})` }; }
  await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
  info.veil = await page.waitForFunction(() => !document.getElementById('veil'), null, { timeout: WAIT.veilMs }).then(() => 'lifted').catch(() => 'STILL UP');
  info.veilMs = Date.now() - t0;
  // The authored buildings. readyToReveal() is ALSO true when there is no group
  // (a fetch failure keeps the fallback usable), so the group is checked separately.
  const pre = await page.evaluate(() => ({ on: window.APARTMENTS && window.APARTMENTS.on, group: !!(window.slopesApartments && window.slopesApartments.group), intro: window.__intro ? { reason: window.__intro.reason, waitedMs: window.__intro.waitedMs, modelFallback: window.__intro.modelFallback || null, missingAtLift: window.__intro.missingAtLift } : null }));
  info.intro = pre.intro;
  if (pre.on === false) {
    info.authoredReenabled = true;
    info.warnings.push('the app had switched the authored buildings off for this visit (INTRO.authoredCeilingMs under load); switched back on in the page');
    await page.evaluate(() => { window.APARTMENTS.on = true; window.applySlopesApartments && window.applySlopesApartments(window.__map); });
  }
  const ok = await page.waitForFunction(() => !!(window.slopesApartments && window.slopesApartments.group) && window.slopesApartments.readyToReveal(), null, { timeout: WAIT.authoredMs }).then(() => true).catch(() => false);
  info.readyMs = Date.now() - t0;
  info.apartments = await page.evaluate(() => { const A = window.slopesApartments; if (!A) return null; const c = A.count; return { group: !!A.group, buildings: c.buildings, done: c.done, triangles: c.triangles, slopesOn: window.SLOPES && window.SLOPES.on }; });
  if (!ok) { await page.close(); return { info, fatal: `side ${side.key}: the authored buildings never became ready (group ${info.apartments && info.apartments.group}); frames would show the fallback city` }; }
  info.gfx = await page.evaluate(() => { const G = window.GFX || {}; return { preset: G.preset, bloom: G.bloom, godRays: G.godRays, autoExposure: G.autoExposure, renderScale: G.renderScale, filmic: G.filmic, exposure: G.exposure, stars: G.stars }; });
  if (BREAK && side.key === 'B') {
    info.broken = await page.evaluate(() => { const g = window.slopesApartments.group; g.visible = false; window.__map.triggerRepaint(); return 'authored apartments hidden (group.visible = false)'; });
    info.warnings.push('--break: ' + info.broken);
  }
  await sleep(3000);
  log(`[${side.key}] ready in ${(info.readyMs / 1000).toFixed(1)} s (veil ${info.veil} at ${(info.veilMs / 1000).toFixed(1)} s, intro ${pre.intro && pre.intro.reason}); ${info.apartments.buildings} authored buildings; preset ${info.gfx.preset}; build ${info.build.sha1 || info.build.error}`);

  const helper = await browser.newPage({ viewport: { width: 64, height: 64 } });
  for (const g of REGIMES_USED) {
    const R = CFG.regimes[g];
    const todo = POSES.filter(P => P.regimes.includes(g));
    if (!todo.length) continue;
    const rg = await page.evaluate(async ({ p, idleMs }) => {
      const m = window.__map;
      const sl = document.getElementById('tod-slider'); if (sl) sl.value = String(p);
      const t = performance.now();
      window.applyTimeOfDay(m, p, true);
      const applyMs = performance.now() - t;
      await new Promise(r => { const k = setTimeout(r, idleMs); m.once('idle', () => { clearTimeout(k); r(); }); m.triggerRepaint(); });
      const B = window.skyBodies ? window.skyBodies(p) : null;
      return { applyMs: Math.round(applyMs), sunElev: B ? +B.sun.elev.toFixed(2) : null, night: B ? +B.night.toFixed(3) : null, lamps: B ? +B.lamps.toFixed(3) : null, stars: B ? +B.stars.toFixed(3) : null, currentP: window.__todCurrentP };
    }, { p: R.p, idleMs: WAIT.regimeIdleMs });
    if (R.sunElev != null && rg.sunElev != null && Math.abs(rg.sunElev - R.sunElev) > 0.5)
      info.warnings.push(`regime ${g}: p ${R.p} gives sun ${rg.sunElev} deg in this build, routes file says ${R.sunElev}`);
    log(`[${side.key}] regime ${g} p=${R.p} sun ${rg.sunElev} deg (retint ${rg.applyMs} ms)`);
    for (const P of todo) {
      const st = await page.evaluate(async ({ cam, W }) => {
        const m = window.__map;
        const pose = { center: cam.center, zoom: cam.zoom, pitch: cam.pitch, bearing: cam.bearing };
        const t = performance.now();
        m.jumpTo(pose);
        if (window.__aeReset) window.__aeReset();
        const A = window.slopesApartments;
        while (performance.now() - t < W.tilesMs) {
          if (m.loaded() && m.areTilesLoaded() && (!A || A.readyToReveal())) break;
          await new Promise(r => setTimeout(r, 250));
        }
        const tilesOk = m.areTilesLoaded() && (!A || A.readyToReveal());
        await new Promise(r => { const k = setTimeout(r, W.idleMs); m.once('idle', () => { clearTimeout(k); r(); }); m.triggerRepaint(); });
        m.jumpTo(pose);
        await new Promise(r => setTimeout(r, W.settleMs));
        const e = window.__fly && window.__fly.eye ? window.__fly.eye() : null;
        return { waitMs: Math.round(performance.now() - t), tilesOk,
          got: { pitch: +m.getPitch().toFixed(2), bearing: +m.getBearing().toFixed(2), zoom: +m.getZoom().toFixed(3), eyeAlt: e ? +e.alt.toFixed(2) : null },
          ae: window.__ae ? window.__ae() : null, grade: document.getElementById('map') ? document.getElementById('map').style.filter : null };
      }, { cam: P.cam, W: WAIT });
      // Camera check.
      const want = { pitch: +P.cam.pitch.toFixed(2), zoom: +P.cam.zoom.toFixed(3), eyeAlt: P.cam.eyeAlt != null ? +P.cam.eyeAlt.toFixed(2) : null };
      const off = [];
      if (Math.abs(st.got.pitch - want.pitch) > CAMERA.pitchTol) off.push(`pitch ${st.got.pitch} vs ${want.pitch}`);
      if (want.eyeAlt != null && st.got.eyeAlt != null && Math.abs(st.got.eyeAlt - want.eyeAlt) > Math.max(CAMERA.altTolAbs, want.eyeAlt * CAMERA.altTolRel)) off.push(`eye ${st.got.eyeAlt} m vs ${want.eyeAlt} m`);
      if (want.eyeAlt == null && Math.abs(st.got.zoom - want.zoom) > CAMERA.zoomTol) off.push(`zoom ${st.got.zoom} vs ${want.zoom}`);
      // Screenshot twice, keep the second; re-shoot while the frame is still moving.
      const file = path.join(FRAMES, frameName(side.key, P, g));
      let prev = await page.screenshot({ type: 'jpeg', quality: JPEG_Q });
      await sleep(WAIT.secondShotMs);
      let cur = await page.screenshot({ type: 'jpeg', quality: JPEG_Q });
      let settle = await helper.evaluate(pageDiff, { a: prev.toString('base64'), b: cur.toString('base64'), D: { luma: SETTLE.luma, lumaBig: 64 } });
      let tries = 0;
      while (settle.pctOver > SETTLE.maxPct && tries < SETTLE.retries) {
        tries++;
        await sleep(SETTLE.waitMs);
        prev = cur; cur = await page.screenshot({ type: 'jpeg', quality: JPEG_Q });
        settle = await helper.evaluate(pageDiff, { a: prev.toString('base64'), b: cur.toString('base64'), D: { luma: SETTLE.luma, lumaBig: 64 } });
      }
      fs.writeFileSync(file, cur);
      const shot = { side: side.key, route: P.route, pose: P.pose, regime: g, p: R.p, sunElev: rg.sunElev, file: path.relative(OUT, file).split(path.sep).join('/'),
        camera: { want, got: st.got, ok: !off.length, off }, tilesOk: st.tilesOk, waitMs: st.waitMs, ae: st.ae, grade: st.grade,
        settle: { pctOver: settle.pctOver, retries: tries, settled: settle.pctOver <= SETTLE.maxPct } };
      shots.push(shot);
      log(`[${side.key}] ${g.padEnd(8)} ${P.key.padEnd(44)} ${off.length ? 'CAMERA OFF (' + off.join('; ') + ')' : 'camera ok'}${st.tilesOk ? '' : ', tiles NOT all loaded'}${shot.settle.settled ? '' : `, UNSETTLED ${settle.pctOver}%`} (${(st.waitMs / 1000).toFixed(1)} s)`);
    }
  }
  await helper.close();
  await page.close();
  return { info };
}

// ── Measuring, diffing and sheets (also the whole of --from) ────────────────
function refFor(P, g) {
  const rel = P.refs && P.refs[g];
  if (!rel) return null;
  const f = path.isAbsolute(rel) ? rel : path.join(REF_ROOT, rel);
  return fs.existsSync(f) ? f : { missing: f };
}
const dataURL = f => `data:${/\.png$/i.test(f) ? 'image/png' : 'image/jpeg'};base64,` + fs.readFileSync(f).toString('base64');
const fmt = v => v == null ? '-' : (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));

async function analyse(helper, report) {
  const byKey = new Map();
  for (const s of report.shots) {
    const P = POSES.find(q => q.route === s.route && q.pose === s.pose);
    const regions = P ? P.regions : {};
    const buf = fs.readFileSync(path.join(OUT, s.file));
    s.metrics = await helper.evaluate(pageMeasure, { b64: buf.toString('base64'), regions, M: MEASURE });
    s.blank = s.metrics.frame.luma.std < MEASURE.blankStd;
    byKey.set(`${s.side}|${s.route}/${s.pose}|${s.regime}`, s);
  }
  // A/B
  for (const s of report.shots) {
    if (s.side !== 'B') continue;
    const a = byKey.get(`A|${s.route}/${s.pose}|${s.regime}`);
    if (!a) continue;
    s.diffA = await helper.evaluate(pageDiff, { a: fs.readFileSync(path.join(OUT, a.file)).toString('base64'), b: fs.readFileSync(path.join(OUT, s.file)).toString('base64'), D: DIFF });
  }
  return byKey;
}

function tileLines(s, sideLabel) {
  if (!s) return ['(not shot)'];
  const m = s.metrics, L = [];
  L.push(`${sideLabel}  ${s.regime} p${s.p} sun ${s.sunElev}°`);
  const r = m.ratios;
  const rs = Object.entries(r).map(([k, v]) => `${k} ${fmt(v)}`).join('  ');
  L.push(`mean ${m.frame.luma.mean}  p99 ${m.frame.luma.p99}  win ${m.windows.pct}%${m.windows.fallback ? '*' : ''}${rs ? '  ' + rs : ''}`);
  if (m.windows.fallback) L.push('* no wall region: whole-frame count, not windows');
  if (s.diffA) L.push(`vs A: ${s.diffA.pctOver}% px >${DIFF.luma}  mean|d| ${s.diffA.meanAbs}`);
  if (!s.camera.ok) L.push('CAMERA OFF: ' + s.camera.off.join('; '));
  if (s.settle && !s.settle.settled) L.push(`UNSETTLED ${s.settle.pctOver}%`);
  return L;
}

async function sheets(helper, report, byKey) {
  const written = [];
  const sides = report.sides.map(s => s.key);
  const tileH = Math.round(TILE_W * VH / VW);
  const put = async (name, spec) => { const b64 = await helper.evaluate(pageSheet, spec); fs.writeFileSync(path.join(OUT, name), Buffer.from(b64, 'base64')); written.push(name); };
  const sideLabel = k => { const s = report.sides.find(x => x.key === k); return `${k}: ${s ? s.label : ''}`; };
  // per pose: rows = regimes, cols = sides (+ ref)
  for (const P of POSES) {
    const regs = REGIME_ORDER.filter(g => P.regimes.includes(g) && sides.some(k => byKey.get(`${k}|${P.key}|${g}`)));
    if (!regs.length) continue;
    const withRef = REFS_ON && regs.some(g => refFor(P, g));
    const colHeads = [...sides.map(sideLabel), ...(withRef ? ['reference (local, not committed)'] : [])];
    const rows = regs.map(g => {
      const tiles = sides.map(k => { const s = byKey.get(`${k}|${P.key}|${g}`); return { src: s ? dataURL(path.join(OUT, s.file)) : null, lines: tileLines(s, k) }; });
      if (withRef) {
        const f = refFor(P, g);
        tiles.push(f && typeof f === 'string' ? { src: dataURL(f), lines: [path.basename(f).slice(0, 70)] } : { src: null, lines: [f && f.missing ? 'missing: ' + path.basename(f.missing) : 'no reference for ' + g] });
      }
      return { head: '', tiles };
    });
    await put(`sheet-${slug(P.route)}-${slug(P.pose)}.jpg`, { title: `${P.key} — ${P.title || ''}`, colHeads, rows, tileW: TILE_W, tileH, q: SHEET_Q, rowHeadW: 0 });
  }
  // overview per side: rows = poses, cols = regimes
  const OV_ROWS = 8, ovW = Math.min(TILE_W, 400), ovH = Math.round(ovW * VH / VW);
  for (const k of sides) {
    const regs = REGIME_ORDER.filter(g => report.shots.some(s => s.side === k && s.regime === g));
    const poses = POSES.filter(P => report.shots.some(s => s.side === k && s.route === P.route && s.pose === P.pose));
    for (let i = 0, n = 1; i < poses.length; i += OV_ROWS, n++) {
      const rows = poses.slice(i, i + OV_ROWS).map(P => ({ head: P.route + '\n' + P.pose, tiles: regs.map(g => { const s = byKey.get(`${k}|${P.key}|${g}`); return { src: s ? dataURL(path.join(OUT, s.file)) : null, lines: s ? [`${g} p${s.p}  mean ${s.metrics.frame.luma.mean}  win ${s.metrics.windows.pct}%`] : ['(not shot)'] }; }) }));
      await put(`overview-${k}-${n}.jpg`, { title: `${sideLabel(k)} — ${report.when.slice(0, 16).replace('T', ' ')} — build ${(report.sides.find(x => x.key === k).build || {}).sha1 || '?'}`, colHeads: regs, rows, tileW: ovW, tileH: ovH, q: SHEET_Q, rowHeadW: 170 });
    }
  }
  if (SHOW_REGIONS) {
    // One render per pose PER REGIME, with a labelled grid and whatever regions the
    // pose has. Poses with no regions get one too: drawing them is the point, and
    // a rectangle has to hold at every regime, not just the one it was drawn on.
    const COL = { sky: '#4aa3ff', wall: '#ff5a4a', ground: '#5cd65c', water: '#3fe0e0' };
    const gw = Math.max(TILE_W, 1000), gh = Math.round(gw * VH / VW);
    for (const P of POSES) {
      const rects = Object.entries(P.regions).map(([n, r]) => [n, r, COL[n] || '#ffd24a']);
      // The geometry is the same at every regime, so one frame is enough to draw on:
      // take the brightest-lit regime available, where the silhouette reads best.
      const g = REGIME_ORDER.find(k => byKey.get(`A|${P.key}|${k}`));
      if (!g) continue;
      const s = byKey.get(`A|${P.key}|${g}`);
      await put(`regions-${slug(P.route)}-${slug(P.pose)}.jpg`,
        { title: `${P.key} — ${g} p${s.p} — 5% grid (x along the top, y down the left)${rects.length ? '' : ' — NO REGIONS YET'}`,
          colHeads: [''], rows: [{ head: '', tiles: [{ src: dataURL(path.join(OUT, s.file)), rects, grid: true, lines: [] }] }],
          tileW: gw, tileH: gh, q: 0.85, rowHeadW: 0 });
    }
  }
  return written;
}

function summarise(report) {
  const lines = [];
  const pad = (s, n) => String(s).padEnd(n);
  lines.push(pad('side', 5) + pad('regime', 9) + pad('route/pose', 44) + pad('mean', 7) + pad('p99', 5) + pad('win%', 8) + pad('wall/sky', 10) + pad('grnd/sky', 10) + pad('water/sky', 10) + 'vs A');
  let anyFallback = false;
  for (const s of report.shots) {
    const m = s.metrics, r = m.ratios;
    if (m.windows.fallback) anyFallback = true;
    lines.push(pad(s.side, 5) + pad(s.regime, 9) + pad(`${s.route}/${s.pose}`, 44) + pad(m.frame.luma.mean, 7) + pad(m.frame.luma.p99, 5) + pad(m.windows.pct + (m.windows.fallback ? '*' : ''), 9) +
      pad(fmt(r['wall/sky']), 10) + pad(fmt(r['ground/sky']), 10) + pad(fmt(r['water/sky']), 10) + (s.diffA ? `${s.diffA.pctOver}% >${DIFF.luma}` : ''));
  }
  if (anyFallback) lines.push('* the pose has no `wall` region, so win% counts the whole frame (sky and pavement included). Not a window count.');
  return lines.join('\n');
}

// ── Main ────────────────────────────────────────────────────────────────────
const log = (...a) => { const t = a.join(' '); console.log(t); fs.appendFileSync(path.join(OUT, 'log.txt'), t + '\n'); };
const nShots = SIDES.length * POSES.reduce((n, P) => n + P.regimes.length, 0);
const maxMs = FROM ? 20 * 60000 : Math.round(25 * 60000 + nShots * 60000);
const browser = await launch(chromium, { gl: GL, maxMs });
let exit = 0;
try {
  let report;
  if (FROM) {
    if (path.resolve(FROM) !== path.resolve(OUT)) die('--from re-measures in place: pass the same folder as --out');
    report = readJSON(path.join(OUT, 'report.json'));
    report.remeasured = new Date().toISOString();
    report.routesFile = ROUTES_FILE;
    const keep = new Set(POSES.map(P => P.key));
    report.shots = report.shots.filter(s => keep.has(`${s.route}/${s.pose}`) && fs.existsSync(path.join(OUT, s.file)));
    log(`night-compare --from: re-measuring ${report.shots.length} frames in ${OUT}`);
  } else {
    report = { tool: 'scripts/verify/night-compare.mjs', when: new Date().toISOString(), harnessGit: gitInfo(), routesFile: ROUTES_FILE, localOverlay: localFile,
      viewport: [VW, VH], dpr: 1, gl: GL, args: argv, params: { WAIT, SETTLE, CAMERA, MEASURE, DIFF }, regimes: Object.fromEntries(REGIMES_USED.map(g => [g, CFG.regimes[g]])),
      sides: [], shots: [] };
    log(`night-compare: ${POSES.length} poses x regimes [${REGIMES_USED.join(', ')}] x ${SIDES.length} side(s) = ${nShots} shots; gl ${GL}; out ${OUT}`);
    for (const side of SIDES) {
      const r = await shootSide(browser, side, report.shots, log);
      report.sides.push(r.info);
      if (r.fatal) { log('CANNOT RUN: ' + r.fatal); report.fatal = r.fatal; fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1)); exit = 2; break; }
    }
    // Shooting is the expensive half. Write the report before measuring, so that a
    // crash in the measuring half leaves a run that `--from` can pick up instead of
    // an orphaned folder of frames.
    if (!report.fatal) fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  }
  if (!report.fatal) {
    const helper = await browser.newPage({ viewport: { width: 64, height: 64 } });
    const byKey = await analyse(helper, report);
    report.sheets = await sheets(helper, report, byKey);
    await helper.close();
    // Verdicts.
    const bad = report.shots.filter(s => !s.camera.ok || s.blank);
    const unsettled = report.shots.filter(s => s.settle && !s.settle.settled);
    const verdict = { uninterpretable: bad.map(s => `${s.side} ${s.regime} ${s.route}/${s.pose}: ${s.blank ? 'blank frame' : ''}${s.camera.off.join('; ')}`), unsettled: unsettled.map(s => `${s.side} ${s.regime} ${s.route}/${s.pose} ${s.settle.pctOver}%`) };
    if (bad.length) exit = 2;
    const pairs = report.shots.filter(s => s.diffA);
    if (pairs.length) {
      const d = pairs.map(s => s.diffA.pctOver);
      verdict.abDiff = { frames: pairs.length, pctOverMin: Math.min(...d), pctOverMedian: d.slice().sort((a, b) => a - b)[d.length >> 1], pctOverMax: Math.max(...d) };
    }
    if (SAME != null) {
      const over = pairs.filter(s => s.diffA.pctOver >= SAME);
      verdict.same = { tolPct: SAME, failing: over.map(s => `${s.regime} ${s.route}/${s.pose} ${s.diffA.pctOver}%`) };
      if (!pairs.length) { verdict.same.error = 'no A/B pairs to compare'; exit = Math.max(exit, 2); }
      else if (over.length && exit === 0) exit = 1;
    }
    report.verdict = verdict;
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
    log('\n' + summarise(report));
    for (const s of report.sides) for (const w of s.warnings || []) log(`WARNING [${s.key}] ${w}`);
    for (const s of report.sides) if (s.pageErrors && s.pageErrors.length) log(`[${s.key}] ${s.pageErrors.length} page errors (first: ${s.pageErrors[0]})`);
    if (verdict.unsettled.length) log(`WARNING ${verdict.unsettled.length} frame(s) still changing after ${SETTLE.retries} re-shoots: ${verdict.unsettled.join(', ')}`);
    if (verdict.abDiff) log(`A/B: % of pixels differing by >${DIFF.luma} luma per frame: min ${verdict.abDiff.pctOverMin}, median ${verdict.abDiff.pctOverMedian}, max ${verdict.abDiff.pctOverMax} (${verdict.abDiff.frames} frames)`);
    if (bad.length) log(`CANNOT INTERPRET ${bad.length} frame(s): ${verdict.uninterpretable.join(' | ')}`);
    if (SAME != null) log(verdict.same.failing.length ? `FAIL --same ${SAME}%: ${verdict.same.failing.length} frame(s) differ: ${verdict.same.failing.join(', ')}` : (pairs.length ? `PASS --same ${SAME}%: every A/B frame within tolerance` : 'CANNOT RUN --same: no pairs'));
    log(`sheets: ${report.sheets.length} in ${OUT}; report: ${path.join(OUT, 'report.json')}; exit ${exit}`);
  }
} catch (e) {
  console.error('night-compare: ' + (e && e.stack || e));
  exit = 2;
} finally {
  await browser.__done();
}
process.exit(exit);
