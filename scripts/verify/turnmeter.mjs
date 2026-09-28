/**
 * turnmeter.mjs — what TURNING costs, measured on the real frames.
 *
 * The owner, 2026-09-27: "turning is the biggest inducer of lag." Flying
 * straight held ~30 fps on his NVIDIA; turning while flying dropped frames and
 * hitched. This drives the real index.html the way a person turns — W held and
 * the mouse dragging the view (js/controls.js: 0.20 deg of yaw per pixel) — and
 * compares every turn with a straight flight of the same length from the same
 * pose, so what is turn-specific is separable from what flying costs anyway.
 *
 *   node turnmeter.mjs --arms base=http://127.0.0.1:8977,branch=http://127.0.0.1:8978
 *        [--reps 3] [--gpu high|low] [--poses campus,downtown]
 *        [--scen straight,turn60,turn120,flick,look] [--profile] [--gputime]
 *        [--video DIR] [--query "&x=1"] [--out DIR]
 *
 * Arms run INTERLEAVED (A,B,A,B...), a fresh browser and a fresh load each, so
 * load order and machine drift land on both sides. Every number is printed
 * with the renderer string, the viewport, the DPR and the CPU throttle (none:
 * this harness never throttles). Headed on purpose: a backgrounded headless
 * renderer stops firing rAF (README, perf traps).
 *
 * Scenarios, each from the same reset pose after the tiles there are loaded
 * and the main thread has been quiet for 1.5 s:
 *   straight  W for 6 s, no turn (the control)
 *   turn60    W + a steady 60 deg/s yaw for 6 s (two 180-degree drags)
 *   turn120   W + 120 deg/s for 6 s (four drags, 720 degrees)
 *   flick     W + three 180-degree flicks in 0.5 s each, 1.5 s apart
 *   look      no W: three 90-degree looks in 0.4 s, 1 s pause after each
 * A drag longer than DRAG_PX is lifted and re-grabbed at the left, as a hand
 * does; the pose between is not counted as a turn frame on its own.
 *
 * Per scenario: frame interval p50 / p95 / worst, frames over 50 ms, fps, long
 * tasks, MapLibre's render CPU per frame, the three.js layer's CPU per frame,
 * sun-shadow map re-renders, shadow-proxy rebuilds, tiles that landed, and the
 * yaw actually achieved (read off the bearing every frame). --profile adds a
 * sampled CPU profile per scenario, the drive and the stop together (self
 * time and nearest js/ caller); --profile split profiles them separately
 * (s.profile is the drive, s.tail.profile the stop).
 * "stop" is the --tail ms (2500) after the hand lets go: the worst frame gap,
 * long tasks and proxy rebuilds there, i.e. the hitch on the still picture.
 *
 * It is a measurement and exits 0; the A/B verdict is the reader's.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { launch } from './chrome.mjs';

const A = process.argv.slice(2);
const arg = (k, d) => { const i = A.indexOf('--' + k); return i >= 0 ? (A[i + 1] && !A[i + 1].startsWith('--') ? A[i + 1] : true) : d; };
// An arm is name=url, or name=url|query for a URL switch on that arm only
// (base=http://127.0.0.1:8978|shadowsnapfar=20 against branch=http://127.0.0.1:8978).
const ARMS = String(arg('arms', 'this=' + (process.env.VERIFY_URL || 'http://127.0.0.1:8099'))).split(',').map(s => { const i = s.indexOf('='), [url, q] = s.slice(i + 1).split('|'); return { name: s.slice(0, i), url, q: q || '' }; });
const REPS = Number(arg('reps', 1));
const GPU = String(arg('gpu', 'high'));
const W = Number(arg('w', 1280)), H = Number(arg('h', 680)), DPR = Number(arg('dpr', 1.5));
const POSES = String(arg('poses', 'campus,downtown')).split(',');
const SCEN = String(arg('scen', 'straight,turn60,turn120,flick,look')).split(',');
const PROFILE = arg('profile', false) === 'split' ? 'split' : !!arg('profile', false);
const GPUTIME = !!arg('gputime', false);
const VIDEO = arg('video', null);
const QUERY = String(arg('query', ''));
const OUT = String(arg('out', path.join(process.env.TEMP || '.', 'claude', 'turn-lag', 'runs')));
const DUR = Number(arg('dur', 6));
const VSYNC = String(arg('vsync', 'on'));
const CACHE = String(arg('cache', path.join(process.env.TEMP || '.', 'claude', 'turn-lag', 'http-cache')));
const TAIL_MS = Number(arg('tail', 2500));
fs.mkdirSync(OUT, { recursive: true });

// The flycam's mouse yaw (js/controls.js SENS_YAW_MOUSE). Read back from the
// page at run time; this is only the fallback.
let DEG_PER_PX = 0.20;
const DRAG_PX = 900;                 // one hand's drag before it lifts and re-grabs
const X0 = 150;                      // where a drag starts (CSS px)

// Flyover height over campus is the app's spawn pose (js/app.js SPAWN).
// Downtown: the same height class over Congress Avenue, looking south-west.
const POSE = {
  campus:   { center: [-97.7434, 30.2857], zoom: 16.5, pitch: 74, bearing: 250 },
  downtown: { center: [-97.7445, 30.2668], zoom: 16.3, pitch: 72, bearing: 200 },
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
const r1 = v => v == null || !isFinite(v) ? null : Math.round(v * 10) / 10;
const pct = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const med = a => pct(a, 0.5);
function cpuLoad() {
  try { return execSync('powershell -NoProfile -Command "(Get-CimInstance Win32_Processor).LoadPercentage"', { encoding: 'utf8', timeout: 15000 }).trim(); } catch (e) { return 'n/a'; }
}
function chromeCount() {
  try { return execSync('powershell -NoProfile -Command "(Get-Process chrome -ErrorAction SilentlyContinue | Measure-Object).Count"', { encoding: 'utf8', timeout: 15000 }).trim(); } catch (e) { return 'n/a'; }
}

// ---------- in-page instrumentation (runs before any app script) ----------
function pageInit(opts) {
  if (window.__tm) return;
  const TM = window.__tm = { raf: [], bear: [], lt: [], renders: [], tiles: [], gpu: [], errs: [] };
  const now = () => performance.now();
  const loop = ts => {
    TM.raf.push(ts);
    try { const m = window.__map; if (m) TM.bear.push(m.getBearing()); else TM.bear.push(null); } catch (e) { TM.bear.push(null); }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) TM.lt.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true }); } catch (e) { TM.errs.push('lt ' + e.message); }
  const hook = () => {
    const m = window.__map;
    if (!m || !m.painter || !m.painter.context) return setTimeout(hook, 50);
    const gl = m.painter.context.gl;
    const tq = opts.gputime ? gl.getExtension('EXT_disjoint_timer_query_webgl2') : null;
    TM.hasTQ = !!tq;
    let cur = null, pending = [];
    // Shadow MAP renders: two per update before 2026-09-28 (no shadowMapRenders stat then).
    const shadowN = () => { try { const S = window.slopes.sunlightStats(); return S.shadowMapRenders ?? 2 * S.shadowUpdates; } catch (e) { return 0; } };
    const proxyN = () => { try { return window.CityLighting.stats.shadowProxyRebuilds || 0; } catch (e) { return 0; } };
    const poll = () => {
      while (pending.length) {
        const r = pending[0];
        if (!gl.getQueryParameter(r.q, gl.QUERY_RESULT_AVAILABLE)) break;
        pending.shift();
        const ns = gl.getQueryParameter(r.q, gl.QUERY_RESULT); gl.deleteQuery(r.q);
        if (!gl.getParameter(tq.GPU_DISJOINT_EXT)) TM.gpu.push([r.t, ns / 1e6]);
      }
    };
    TM.poll = () => { if (tq) poll(); };
    const orig = m._render;
    m._render = function () {
      const t0 = now(), sh0 = shadowN();
      let q = null;
      if (tq && pending.length < 300) { q = gl.createQuery(); gl.beginQuery(tq.TIME_ELAPSED_EXT, q); }
      cur = { cl: 0 };
      try { return orig.apply(this, arguments); }
      finally {
        if (q) { gl.endQuery(tq.TIME_ELAPSED_EXT); pending.push({ q, t: t0 }); }
        // [4] is the proxy rebuild COUNT after this render: the rebuild runs in its
        // own timer task, between renders, so a per-render difference is always 0.
        TM.renders.push([t0, now() - t0, cur.cl, shadowN() - sh0, proxyN()]);
        cur = null;
        if (tq) try { poll(); } catch (e) {}
      }
    };
    const wrapCustom = () => {
      try {
        const L = m.style && m.style._layers; if (!L) return;
        for (const id in L) {
          const impl = L[id] && L[id].implementation;
          if (!impl || impl.__tmWrapped || typeof impl.render !== 'function') continue;
          const o = impl.render; impl.__tmWrapped = true;
          impl.render = function () { const t = now(); try { return o.apply(this, arguments); } finally { if (cur) cur.cl += now() - t; } };
        }
      } catch (e) {}
    };
    setInterval(wrapCustom, 500); wrapCustom();
    // Atlas-prep instruments, the same on every arm: every texImage2D that
    // carries a pixel array (tile atlases, and anything three.js uploads), and
    // MapLibre's _getImagesForIds, the main-thread copy of every style image a
    // tile's worker asks for. [start, ms, bytes].
    TM.tex = []; TM.gi = [];
    const ti = gl.texImage2D;
    gl.texImage2D = function () {
      const t = now();
      try { return ti.apply(this, arguments); }
      finally { const d = arguments.length === 9 ? arguments[8] : null; if (d && ArrayBuffer.isView(d)) TM.tex.push([t, now() - t, d.byteLength]); }
    };
    const hookGI = () => {
      const im = m.style && m.style.imageManager, P = im && Object.getPrototypeOf(im);
      if (!P || typeof P._getImagesForIds !== 'function') return setTimeout(hookGI, 100);
      if (P.__tmGI) return; P.__tmGI = true;
      const g = P._getImagesForIds;
      P._getImagesForIds = function () {
        const t = now(), r = g.apply(this, arguments);
        let b = 0; try { for (const k in r) b += r[k].data.data.byteLength; } catch (e) {}
        TM.gi.push([t, now() - t, b]);
        return r;
      };
    };
    hookGI();
    m.on('data', e => { if (e.dataType === 'source' && e.tile) TM.tiles.push([now(), e.sourceId]); });
    TM.hooked = now();
  };
  hook();
}

// ---------- CPU profile summary (self time by function; nearest js/ caller) ----------
function summarizeProfile(p) {
  const byId = new Map(p.nodes.map(n => [n.id, n]));
  const self = new Map();
  const ts = []; let t = p.startTime; for (const d of p.timeDeltas) { t += d; ts.push(t); }
  for (let i = 0; i < p.samples.length; i++) {
    const dt = (i + 1 < ts.length ? ts[i + 1] : p.endTime) - ts[i];
    self.set(p.samples[i], (self.get(p.samples[i]) || 0) + dt);
  }
  const total = (p.endTime - p.startTime) / 1000;
  const parent = new Map();
  for (const n of p.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const nm = n => { const cf = n.callFrame; const f = (cf.url || '').split('/').pop().split('?')[0]; return `${cf.functionName || '(anon)'} ${f}:${cf.lineNumber + 1}`; };
  const isApp = n => /\/js\/[\w.-]+\.js/.test(n.callFrame.url || '');
  const fn = {}, nearest = {}, incl = {};
  for (const [id, us] of self) {
    let n = byId.get(id);
    const leaf = nm(n) + (/maplibre|three/.test(n.callFrame.url || '') ? ':' + n.callFrame.columnNumber : '');
    fn[leaf] = (fn[leaf] || 0) + us / 1000;
    let first = null; const seen = new Set();
    const leafK = (n.callFrame.url || '').includes('maplibre') ? 'maplibre' : (n.callFrame.url || '').includes('three') ? 'three' : (n.callFrame.url ? 'app' : n.callFrame.functionName);
    while (n) {
      if (isApp(n)) { const k = nm(n); if (!first) first = k; if (!seen.has(k)) { seen.add(k); incl[k] = (incl[k] || 0) + us / 1000; } }
      const pid = parent.get(n.id); n = pid != null ? byId.get(pid) : null;
    }
    const k = (first || '(no app frame)') + '  <- ' + leafK;
    nearest[k] = (nearest[k] || 0) + us / 1000;
  }
  const top = (o, n = 20) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => [k, Math.round(v), r1(100 * v / total)]);
  return { totalMs: Math.round(total), self: top(fn, 25), nearestApp: top(nearest, 20), appInclusive: top(incl, 25) };
}

// ---------- window statistics ----------
function windowStats(snap, a, b) {
  const inside = [], bear = [];
  for (let i = 0; i < snap.raf.length; i++) if (snap.raf[i] >= a && snap.raf[i] <= b) { inside.push(snap.raf[i]); bear.push(snap.bear[i]); }
  const before = snap.raf.filter(t => t < a).pop();
  const pts = [before ?? a, ...inside];
  const d = []; for (let i = 1; i < pts.length; i++) d.push(pts[i] - pts[i - 1]);
  if (inside.length) d.push(Math.max(0, b - inside[inside.length - 1]));   // the frame still pending at the end
  const dur = b - a;
  let swept = 0;
  for (let i = 1; i < bear.length; i++) if (bear[i] != null && bear[i - 1] != null) { let x = bear[i] - bear[i - 1]; x = ((x + 540) % 360) - 180; swept += Math.abs(x); }
  const R = snap.renders.filter(x => x[0] >= a && x[0] <= b);
  const R0 = snap.renders.filter(x => x[0] < a).pop();
  const proxyRebuilds = R.length && R0 ? R[R.length - 1][4] - R0[4] : 0;
  const lt = snap.lt.filter(x => x[0] < b && x[0] + x[1] > a);
  const g = snap.gpu.filter(x => x[0] >= a && x[0] <= b).map(x => x[1]);
  const tiles = snap.tiles.filter(x => x[0] >= a && x[0] <= b);
  const sumIn = (arr) => { const v = (arr || []).filter(x => x[0] >= a && x[0] <= b); return { n: v.length, ms: Math.round(v.reduce((s, x) => s + x[1], 0)), MB: r1(v.reduce((s, x) => s + x[2], 0) / 1048576), worst: r1(Math.max(0, ...v.map(x => x[1]))) }; };
  return {
    prep: { tex: sumIn(snap.tex), gi: sumIn(snap.gi) },
    iv: d.map(r1),   // every frame interval, in order (for a frame-time strip)
    durMs: Math.round(dur), frames: inside.length, fps: r1(inside.length / dur * 1000),
    ft: { p50: r1(med(d)), p95: r1(pct(d, 0.95)), worst: r1(Math.max(0, ...d)), over50: d.filter(x => x > 50).length, over100: d.filter(x => x > 100).length },
    yawDegS: r1(swept / dur * 1000), yawDeg: Math.round(swept),
    mapCpu: { p50: r1(med(R.map(x => x[1]))), p95: r1(pct(R.map(x => x[1]), 0.95)), worst: r1(Math.max(0, ...R.map(x => x[1]))), sum: Math.round(R.reduce((s, x) => s + x[1], 0)) },
    threeCpu: { p50: r1(med(R.map(x => x[2]))), p95: r1(pct(R.map(x => x[2]), 0.95)), sum: Math.round(R.reduce((s, x) => s + x[2], 0)) },
    shadowRenders: R.reduce((s, x) => s + x[3], 0), proxyRebuilds,
    gpu: g.length ? { n: g.length, p50: r1(med(g)), p95: r1(pct(g, 0.95)) } : null,
    longTasks: { n: lt.length, sumMs: Math.round(lt.reduce((s, x) => s + x[1], 0)), worst: Math.round(Math.max(0, ...lt.map(x => x[1]))) },
    tiles: tiles.length,
    tilesBy: tiles.reduce((o, x) => (o[x[1]] = (o[x[1]] || 0) + 1, o), {}),
  };
}

// ---------- one arm, one fresh browser ----------
async function runArm(arm, rep) {
  const gpuFlag = GPU === 'low' ? '--force_low_power_gpu' : '--force_high_performance_gpu';
  const args = ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', gpuFlag,
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
    '--disable-features=CalculateNativeWinOcclusion', `--disk-cache-dir=${CACHE}`,
    `--window-size=${W + 16},${H + 140}`, '--window-position=0,0'];
  // --vsync off: frames are not tied to the display. With the laptop's screen
  // asleep a headed window gets ~1 frame per second from Chrome otherwise, and
  // an unpaced frame interval is the frame's real cost, not a vsync multiple.
  if (VSYNC === 'off') args.push('--disable-gpu-vsync', '--disable-frame-rate-limit');
  const browser = await launch(chromium, { headless: false, gl: 'hardware', args, maxMs: Number(arg('maxms', 900000)) });
  const ctxOpts = { viewport: { width: W, height: H }, deviceScaleFactor: DPR };
  if (VIDEO) { fs.mkdirSync(VIDEO, { recursive: true }); ctxOpts.recordVideo = { dir: VIDEO, size: { width: W, height: H } }; }
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const tVideo = Date.now();   // the recording starts with the page: scenario times below are offsets from here
  const errors = [];
  page.on('pageerror', e => errors.push(e.message.slice(0, 200)));
  await page.addInitScript(pageInit, { gputime: GPUTIME });
  const cdp = await ctx.newCDPSession(page);
  const ev = (fn, x) => page.evaluate(fn, x);
  const res = { arm: arm.name, url: arm.url, rep, gpuFlag, vsync: VSYNC, viewport: [W, H], dpr: DPR, cpuThrottle: 1, cpuLoadBefore: cpuLoad(), chromeProcsBefore: chromeCount(), scen: {} };
  const url = `${arm.url}/index.html?drift=0&intro=0${arm.q ? '&' + arm.q : ''}${QUERY}`;
  const tNav = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.bringToFront();
  // renderer proof as soon as the map context exists
  for (let i = 0; i < 600; i++) {
    const r = await ev(() => { try { const m = window.__map; if (!m || !m.painter) return null; const gl = m.painter.context.gl; const d = gl.getExtension('WEBGL_debug_renderer_info');
      return { renderer: gl.getParameter(d.UNMASKED_RENDERER_WEBGL), canvas: [gl.canvas.width, gl.canvas.height], dpr: devicePixelRatio, css: [innerWidth, innerHeight] }; } catch (e) { return null; } }).catch(() => null);
    if (r) { res.renderer = r; break; }
    await sleep(200);
  }
  await ev(() => { try { window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect(); } catch (e) {} });
  console.log(`[turn ${arm.name}#${rep}] ${res.renderer && res.renderer.renderer} canvas ${res.renderer && res.renderer.canvas} css ${res.renderer && res.renderer.css} dpr ${res.renderer && res.renderer.dpr}`);
  // Windows' per-app GPU preference beats --force_low_power_gpu: a chrome.exe
  // set to "High performance" in Settings > Display > Graphics draws on the
  // NVIDIA chip whatever the flag says. Refuse to label that run "low".
  if (GPU === 'low' && /NVIDIA/i.test((res.renderer && res.renderer.renderer) || '')) {
    await ctx.close().catch(() => {}); await browser.__done();
    console.error(`[turn] --gpu low drew on NVIDIA: this Chrome (${process.env.CHROME_PATH || 'the default'}) has a Windows GPU preference. ` +
      'Point CHROME_PATH at a Chrome with none, e.g. Playwright\'s %LOCALAPPDATA%\\ms-playwright\\chromium-*\\chrome-win64\\chrome.exe');
    process.exit(2);
  }
  // loaded: veil gone, authored buildings built and revealed, tiles in
  const t0 = Date.now();
  for (;;) {
    const st = await ev(() => ({ veil: !!document.getElementById('veil'), done: !!(window.slopesApartments && window.slopesApartments.count.done),
      ready: (() => { try { return !!window.slopesApartments.readyToReveal(); } catch (e) { return false; } })(), tiles: (() => { try { return window.__map.areTilesLoaded(); } catch (e) { return false; } })() })).catch(() => null);
    if (st && !st.veil && st.done && st.ready && st.tiles) break;
    if (Date.now() - t0 > 240000) { res.loadTimeout = st; break; }
    await sleep(500);
  }
  res.loadMs = Date.now() - tNav;
  await ev(() => { try { window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect(); } catch (e) {} });
  try { DEG_PER_PX = await ev(() => 0.20); } catch (e) {}
  res.gfx = await ev(() => window.GFX ? { preset: window.GFX.preset, renderScale: window.GFX.renderScale, shadows: window.GFX.shadows, msaa: window.GFX.msaa, bloom: window.GFX.bloom } : null);
  await sleep(4000);

  const quiet = async (maxMs = 20000) => {
    const s0 = Date.now();
    for (;;) {
      const q = await ev(() => { const n = performance.now(), T = window.__tm; let tiles = true; try { tiles = window.__map.areTilesLoaded(); } catch (e) {}
        const moving = (() => { try { return window.__map.isMoving() || !!(window.__fly && window.__fly.eye().driving); } catch (e) { return false; } })();
        // A sliced proxy rebuild makes no long task, so wait for it by its flag
        // (undefined before 2026-09-28, whose one-piece rebuild IS a long task).
        let proxy = false; try { proxy = !!window.CityLighting.stats.shadowProxyBuilding; } catch (e) {}
        return { tiles, moving, proxy, lt: T.lt.filter(x => x[0] + x[1] > n - 1500).length }; });
      if (q.tiles && !q.moving && !q.proxy && !q.lt) return Date.now() - s0;
      if (Date.now() - s0 > maxMs) return -1;
      await sleep(250);
    }
  };
  const place = async (P) => {
    for (let i = 0; i < 40; i++) { const d = await ev(() => { try { return !!window.__fly.eye().driving; } catch (e) { return false; } }); if (!d) break; await sleep(250); }
    await ev(P => { try { window.__map.stop(); } catch (e) {} window.__map.jumpTo(P); }, P);
    await sleep(600);
    return quiet();
  };

  const my = Math.round(H * 0.55);
  // Drive a yaw schedule: yawAt(t) is cumulative degrees at t seconds. The mouse
  // position is set from WALL time, so a stalled page gets the whole pending
  // movement at once, as a real mouse's coalesced events deliver it.
  async function drive(yawAt, dur, holdW) {
    if (holdW) await page.keyboard.down('w');
    let pressed = false, sweep0 = 0, lastPx = 0;
    const tStart = Date.now();
    for (;;) {
      const t = (Date.now() - tStart) / 1000;
      if (t > dur) break;
      const px = Math.round(yawAt(t) / DEG_PER_PX);
      if (px !== lastPx) {
        if (!pressed) { await page.mouse.move(X0, my); await page.mouse.down(); pressed = true; sweep0 = lastPx; }
        if (px - sweep0 > DRAG_PX) { await page.mouse.up(); await page.mouse.move(X0, my); await page.mouse.down(); sweep0 = lastPx; }
        await page.mouse.move(X0 + (px - sweep0), my);
        lastPx = px;
      } else if (pressed && yawAt(t + 0.05) === yawAt(t)) { await page.mouse.up(); pressed = false; }
      await sleep(7);
    }
    if (pressed) await page.mouse.up();
    if (holdW) await page.keyboard.up('w');
  }
  const SCHED = {
    straight: t => 0,
    turn60: t => 60 * t,
    turn120: t => 120 * t,
    // 180 deg in 0.5 s, then 1.5 s straight; three times
    flick: t => { const k = Math.floor(t / 2), f = t - 2 * k; return 180 * k + 180 * Math.min(1, f / 0.5); },
    look: t => { const k = Math.floor(t / 1.4), f = t - 1.4 * k; return 90 * k + 90 * Math.min(1, f / 0.4); },
  };
  const HOLDW = { straight: true, turn60: true, turn120: true, flick: true, look: false };

  await page.mouse.move(W / 2, my);
  for (const poseName of POSES) {
    const P = POSE[poseName];
    await place(P);
    await sleep(3000);
    for (const sc of SCEN) {
      const settle = await place(P);
      if (PROFILE) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start'); }
      // [uploads, bytes, of those premultiplied in a MapLibre worker, main-thread premultiply ms,
      //  pattern images a worker already held (not copied), their bytes]
      // (all but the first two are 0 on a checkout from before ATLAS_WORKER_PM / ATLAS_IMAGE_CACHE, 2026-09-28)
      const atlasNow = () => ev(() => { try { const f = window.facadeMemoryStats(); return [f.fastAtlasUploads || 0, f.fastAtlasBytes || 0, f.workerPmUploads || 0, f.mainPmMs || 0, f.imgCacheStubs || 0, f.imgCacheBytesSaved || 0]; } catch (e) { return [0, 0, 0, 0, 0, 0]; } });
      const at0 = await atlasNow();
      const a = await ev(() => performance.now()), wa = Date.now() - tVideo;
      await drive(SCHED[sc], DUR, HOLDW[sc]);
      const b = await ev(() => performance.now()), wb = Date.now() - tVideo;
      const at1 = await atlasNow();
      let driveProf = null;
      if (PROFILE === 'split') { driveProf = summarizeProfile((await cdp.send('Profiler.stop')).profile); await cdp.send('Profiler.start'); }
      // The STOP: what the page does in the TAIL_MS after the hand lets go
      // (the shadow proxy used to rebuild here, in one piece, ~0.3 s after the
      // camera went still). Frame gaps here are main-thread stalls the person
      // sees as a hitch on the still image.
      await sleep(TAIL_MS);
      const at2 = await atlasNow();
      let prof = null;   // the profile covers the drive AND the stop (or just the stop, split)
      if (PROFILE) { const { profile } = await cdp.send('Profiler.stop'); prof = summarizeProfile(profile); }
      const snap = await ev(([a, b]) => { const T = window.__tm; if (T.poll) try { T.poll(); } catch (e) {}
        const i0 = T.raf.findIndex(t => t >= a - 2000);
        return { raf: T.raf.slice(i0), bear: T.bear.slice(i0), lt: T.lt.filter(x => x[0] + x[1] >= a), renders: T.renders.filter(x => x[0] >= a - 1000), gpu: T.gpu.filter(x => x[0] >= a - 100), tiles: T.tiles.filter(x => x[0] >= a - 100),
          tex: (T.tex || []).filter(x => x[0] >= a - 100), gi: (T.gi || []).filter(x => x[0] >= a - 100) }; }, [a, b]);
      const s = windowStats(snap, a, b);
      const tl = windowStats(snap, b, b + TAIL_MS);
      s.tail = { worst: tl.ft.worst, over50: tl.ft.over50, longTasks: tl.longTasks, proxyRebuilds: tl.proxyRebuilds, shadowRenders: tl.shadowRenders, tiles: tl.tiles, tilesBy: tl.tilesBy, prep: tl.prep, iv: tl.iv };
      s.settleMs = settle;
      // facade atlas uploads (js/facades.js); workerPm = arrived premultiplied
      // from a MapLibre worker, pmMs = main-thread premultiply for the rest
      s.atlas = { uploads: at1[0] - at0[0], MB: r1((at1[1] - at0[1]) / 1048576), workerPm: at1[2] - at0[2], pmMs: Math.round(at1[3] - at0[3]),
        heldImgs: at1[4] - at0[4], heldMB: r1((at1[5] - at0[5]) / 1048576) };
      s.tail.atlas = { uploads: at2[0] - at1[0], MB: r1((at2[1] - at1[1]) / 1048576), workerPm: at2[2] - at1[2], pmMs: Math.round(at2[3] - at1[3]),
        heldImgs: at2[4] - at1[4], heldMB: r1((at2[5] - at1[5]) / 1048576) };
      if (VIDEO) s.videoAt = [wa / 1000, wb / 1000];   // seconds into this arm's --video recording
      if (driveProf) { s.profile = driveProf; s.tail.profile = prof; } else if (prof) s.profile = prof;
      res.scen[poseName + '/' + sc] = s;
      console.log(`[turn ${arm.name}#${rep}] ${poseName}/${sc.padEnd(8)} fps ${String(s.fps).padStart(5)}  p50 ${s.ft.p50}  p95 ${s.ft.p95}  worst ${s.ft.worst}  >50ms ${s.ft.over50}  yaw ${s.yawDegS} deg/s  lt ${s.longTasks.n}/${s.longTasks.sumMs}ms/max ${s.longTasks.worst}  mapCpu p50 ${s.mapCpu.p50} p95 ${s.mapCpu.p95}  three p50 ${s.threeCpu.p50}  shadowR ${s.shadowRenders}  proxy ${s.proxyRebuilds}  tiles ${s.tiles} atlas ${s.atlas.uploads}/${s.atlas.MB}MB wpm ${s.atlas.workerPm} pm ${s.atlas.pmMs}ms held ${s.atlas.heldImgs}/${s.atlas.heldMB}MB tex ${s.prep.tex.ms}ms/${s.prep.tex.MB}MB gi ${s.prep.gi.ms}ms/${s.prep.gi.MB}MB${s.gpu ? '  gpu p50 ' + s.gpu.p50 + ' p95 ' + s.gpu.p95 : ''}  | stop: worst ${s.tail.worst} lt max ${s.tail.longTasks.worst} proxy ${s.tail.proxyRebuilds} atlas ${s.tail.atlas.uploads}/${s.tail.atlas.MB}MB pm ${s.tail.atlas.pmMs}ms tex ${s.tail.prep.tex.ms}ms gi ${s.tail.prep.gi.ms}ms tiles ${s.tail.tiles}`);
      // trim the arrays so a long run does not grow the page's memory
      await ev(() => { const T = window.__tm, n = performance.now() - 5000; const i = T.raf.findIndex(t => t >= n); if (i > 0) { T.raf.splice(0, i); T.bear.splice(0, i); } T.renders = T.renders.filter(x => x[0] >= n); T.gpu = T.gpu.filter(x => x[0] >= n); T.tiles = T.tiles.filter(x => x[0] >= n); T.lt = T.lt.filter(x => x[0] >= n); if (T.tex) T.tex = T.tex.filter(x => x[0] >= n); if (T.gi) T.gi = T.gi.filter(x => x[0] >= n); });
    }
  }
  res.errors = errors.slice(0, 20);
  res.cpuLoadAfter = cpuLoad();
  if (VIDEO) { res.video = await page.video().path().catch(() => null); }
  await ctx.close().catch(() => {});
  await browser.__done();
  return res;
}

const all = [];
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
for (let rep = 0; rep < REPS; rep++) {
  for (const arm of (rep % 2 ? [...ARMS].reverse() : ARMS)) {
    const r = await runArm(arm, rep);
    all.push(r);
    fs.writeFileSync(path.join(OUT, `turn-${stamp}.json`), JSON.stringify(all, null, 1));
  }
}
// ---------- summary: min and median over reps, per arm and scenario ----------
const keys = [...new Set(all.flatMap(r => Object.keys(r.scen)))];
console.log(`\n=== turnmeter summary  gpu=${GPU}  renderer=${all[0] && all[0].renderer && all[0].renderer.renderer}  css ${W}x${H} dpr ${DPR}  cpu throttle none  reps ${REPS}`);
for (const k of keys) {
  for (const arm of ARMS) {
    const rs = all.filter(r => r.arm === arm.name && r.scen[k]).map(r => r.scen[k]);
    if (!rs.length) continue;
    const f = sel => rs.map(sel).filter(v => v != null);
    const mm = sel => { const v = f(sel); return v.length ? `${r1(Math.min(...v))}/${r1(med(v))}/${r1(Math.max(...v))}` : '-'; };
    console.log(`${k.padEnd(18)} ${arm.name.padEnd(8)} fps ${mm(s => s.fps)}  p95 ${mm(s => s.ft.p95)}  worst ${mm(s => s.ft.worst)}  >50 ${mm(s => s.ft.over50)}  yaw ${mm(s => s.yawDegS)}  stop-worst ${mm(s => s.tail && s.tail.worst)}  lt-ms ${mm(s => s.longTasks.sumMs)}  (min/med/max of ${rs.length})`);
  }
}
console.log('wrote', path.join(OUT, `turn-${stamp}.json`));
