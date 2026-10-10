/**
 * frame-profile.mjs — what does a FRAME cost while flying over West Campus and the main campus?
 * (written 2026-10-09)
 *
 * Loads the real city once (cold, fresh Chrome), waits for "city ready" + settle, then flies two scripted,
 * time-based routes (so every run draws the same places): `west` over the West Campus apartment blocks and
 * `campus` over the Tower, the mall, GDC and Moody. Each route runs three passes in the same page:
 *   warm    discarded (tiles, shader programs, facade atlases settle)
 *   free    measured
 *   stall   measured with a 1x1 gl.readPixels at the end of every map render, which cannot return until the
 *           GPU has finished: a frame then costs CPU + GPU in sequence, so (stall - free) says how much of
 *           a free-running frame the GPU was hiding. Frame time while stalled is a ceiling on the GPU's share.
 * Per pass: frame interval p50/p95/p99/max, frames over 33/50/100 ms, main-thread busy share and
 * script/layout/style time per frame (CDP Performance.getMetrics deltas), draw calls and triangles per
 * frame and texture/buffer bytes and JS heap at the end (WebGL calls are counted in the page, see
 * lib/instrument.js). A frame interval is the time between two requestAnimationFrame callbacks.
 *
 * SETTINGS (quote them with the numbers): --gl hardware (never swiftshader for frame time), --phone
 * (390x844 DPR3 mobile emulation), --throttle N (CDP CPU throttle on the page main thread only), --preset
 * NAME (window.__usePreset), --vsync off (default; frame intervals then show the work, not 16.7 ms steps),
 * ?intro=0&drift=0 always, the auto-detect probe cancelled. One pass of --seconds (default 14).
 * Only the minimum of several reps means anything on a shared laptop: run it with --reps 3 and read
 * `min of p50` and `min of p95` (the table does).
 *
 *   node ~/Projects/astra-pipe/tools/gpu-run.mjs --label speed -- \
 *     node scripts/perf/frame-profile.mjs --url http://127.0.0.1:8473/ --reps 3 --out DIR
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startChrome, machineLoad, idleSeconds } from './lib/cdp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const URL0 = arg('--url', (process.env.VERIFY_URL || 'http://127.0.0.1:8099') + '/');
const GL = arg('--gl', 'hardware');
const PHONE = argv.includes('--phone');
const THROTTLE = +arg('--throttle', 1);
const REPS = +arg('--reps', 1);
const SECONDS = +arg('--seconds', 14);
const PRESET = arg('--preset', '');
const OUT = arg('--out', process.env.VERIFY_OUT || path.join(process.env.TMPDIR || '/tmp', 'frame-profile'));
const SETTLE = +arg('--settle', 12000);
const MAX = +arg('--max', 420000);
const REQUIRE_IDLE = +arg('--require-idle', GL === 'hardware' && process.platform === 'darwin' ? 600 : 0);
const ROUTES = (arg('--routes', 'west,campus')).split(',');
const LABEL = arg('--label', 'frame');
fs.mkdirSync(OUT, { recursive: true });
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Waypoints are real poses from scripts/verify (shots-westcampus.json, apts-poses.json, shots-tower.json area).
const ROUTE_DEFS = {
  west: { zoom: 17.0, pitch: 62, speed: 28, pts: [[-97.74578, 30.28699], [-97.74330, 30.28270], [-97.74117, 30.28250], [-97.74245, 30.28660], [-97.7422, 30.2903], [-97.74578, 30.28699]] },
  campus: { zoom: 17.0, pitch: 62, speed: 28, pts: [[-97.7394, 30.2849], [-97.7370, 30.2862], [-97.7336, 30.2832], [-97.7306, 30.2809], [-97.7340, 30.2850], [-97.7394, 30.2849]] },
};

const PAGE_FLY = `(async (cfg) => {
  const m = window.__map, P = window.__perf, G = P.gl;
  const R = 111320, toM = (a, b) => { const k = Math.cos(a[1] * Math.PI / 180); return [(b[0] - a[0]) * R * k, (b[1] - a[1]) * R]; };
  const segs = []; let len = 0;
  for (let i = 0; i + 1 < cfg.pts.length; i++) { const d = toM(cfg.pts[i], cfg.pts[i + 1]); const l = Math.hypot(d[0], d[1]); segs.push({ a: cfg.pts[i], b: cfg.pts[i + 1], l, s: len, h: (Math.atan2(d[0], d[1]) * 180 / Math.PI + 360) % 360 }); len += l; }
  const at = s => { s = s % len; const g = segs.find(x => s >= x.s && s <= x.s + x.l) || segs[segs.length - 1]; const u = (s - g.s) / g.l; return { c: [g.a[0] + (g.b[0] - g.a[0]) * u, g.a[1] + (g.b[1] - g.a[1]) * u], h: g.h }; };
  const gl = m.painter && m.painter.context && m.painter.context.gl;
  let stall = null;
  if (cfg.stall && gl) { const px = new Uint8Array(4); stall = () => { try { gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); } catch (e) {} }; m.on('render', stall); }
  const f0 = P.frames.length, g0 = G.perFrame.length, t0 = performance.now(), dts = [];
  let bearing = null;
  await new Promise(res => {
    let last = performance.now();
    const step = (ts) => {
      const t = (performance.now() - t0) / 1000;
      if (t >= cfg.seconds) return res();
      const p = at(t * cfg.speed);
      bearing = bearing == null ? p.h : bearing + ((((p.h - bearing) % 360) + 540) % 360 - 180) * 0.04;
      m.jumpTo({ center: p.c, zoom: cfg.zoom, pitch: cfg.pitch, bearing });
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  if (stall) m.off('render', stall);
  const frames = P.frames.slice(f0), per = G.perFrame.slice(g0);
  return { frames, per, wallMs: performance.now() - t0, tex: G.texBytes, buf: G.bufBytes, peak: G.peak, own: G.own };
})`;

function pct(a, q) { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null; }
function summarise(r, mBefore, mAfter, wallMs) {
  const f = r.frames.slice(3);
  const per = r.per.slice(3).filter(x => x[0] > 0);
  const d = n => (mAfter[n] - mBefore[n]) * 1000;
  return {
    frames: f.length, fps: +(f.length / (wallMs / 1000)).toFixed(1),
    p50: +pct(f, 0.5).toFixed(1), p95: +pct(f, 0.95).toFixed(1), p99: +pct(f, 0.99).toFixed(1), max: +Math.max(...f).toFixed(1),
    over33: f.filter(x => x > 33.4).length, over50: f.filter(x => x > 50).length, over100: f.filter(x => x > 100).length,
    mainBusyPct: +(100 * d('TaskDuration') / wallMs).toFixed(0),
    scriptMsPerFrame: +(d('ScriptDuration') / f.length).toFixed(1), layoutMsPerFrame: +(d('LayoutDuration') / f.length).toFixed(2), styleMsPerFrame: +(d('RecalcStyleDuration') / f.length).toFixed(2),
    drawsPerFrame: per.length ? Math.round(per.reduce((s, x) => s + x[0], 0) / per.length) : null,
    trisPerFrameK: per.length ? Math.round(per.reduce((s, x) => s + x[1], 0) / per.length / 1000) : null,
  };
}

async function oneRep(rep) {
  if (REQUIRE_IDLE) for (;;) { const i = await idleSeconds(); if (i == null || i >= REQUIRE_IDLE) break; await sleep(15000); }
  const W = PHONE ? 390 : 1280, H = PHONE ? 844 : 800, DPR = PHONE ? 3 : 1.5;
  const chrome = await startChrome({ gl: GL, width: W, height: H, vsync: 'off', maxMs: 1500000 });
  try {
    const page = await chrome.newPage();
    await page.send('Page.enable'); await page.send('Runtime.enable'); await page.send('Performance.enable');
    await page.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: PHONE });
    if (PHONE) { await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }); await page.send('Emulation.setUserAgentOverride', { userAgent: IPHONE_UA, platform: 'iPhone' }); }
    if (THROTTLE > 1) await page.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__PERF_CFG=${JSON.stringify({ wrap: [], autodetect: false })};` + fs.readFileSync(path.join(HERE, 'lib/instrument.js'), 'utf8') });
    const ev = async (expr) => { const r = await page.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed'); return r.result.value; };
    const t0 = Date.now();
    await page.send('Page.navigate', { url: URL0 + (URL0.includes('?') ? '&' : '?') + 'intro=0&drift=0' });
    for (;;) {
      await sleep(500);
      let st = null; try { st = JSON.parse(await ev('JSON.stringify({m:window.__perf&&window.__perf.marks,now:performance.now()})')); } catch (e) {}
      if (st && st.m && st.m.introReveal && st.m.apartmentsDone && st.now - Math.max(st.m.introReveal, st.m.apartmentsDone) >= SETTLE) break;
      if (Date.now() - t0 > MAX) throw new Error('city not ready within ' + MAX + ' ms');
    }
    if (PRESET) { await ev(`window.__usePreset && window.__usePreset(${JSON.stringify(PRESET)}, true)`); await sleep(3000); }
    const env = JSON.parse(await ev(`JSON.stringify({
      preset: window.GFX && window.GFX.preset, renderScale: window.GFX && window.GFX.renderScale, msaa: window.GFX && window.GFX.msaa, shadows: window.GFX && window.GFX.shadows, ao: window.GFX && window.GFX.ao,
      bloom: window.GFX && window.GFX.bloom, renderDistance: window.GFX && window.GFX.renderDistance, treeDensity: window.GFX && window.GFX.treeDensity, outerDensity: window.GFX && window.GFX.outerDensity,
      lite: window.LITE_PROFILE && { on: window.LITE_PROFILE.on, tier: window.LITE_PROFILE.tierName, applied: window.LITE_PROFILE.applied },
      apts: window.slopesApartments && { tris: window.slopesApartments.count.triangles }, cull: window.slopesApartments && window.slopesApartments.cull,
      canvas: [document.querySelector('canvas').width, document.querySelector('canvas').height], dpr: devicePixelRatio, reveal: window.__intro && window.__intro.reason })`));
    const gpuRenderer = await ev(`(()=>{const g=document.createElement('canvas').getContext('webgl');const d=g.getExtension('WEBGL_debug_renderer_info');return d?g.getParameter(d.UNMASKED_RENDERER_WEBGL):null})()`);
    const result = { rep, env, gpuRenderer, machine: machineLoad(), routes: {} };
    const metrics = async () => Object.fromEntries((await page.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
    for (const name of ROUTES) {
      const def = { ...ROUTE_DEFS[name], seconds: SECONDS };
      await ev(`${PAGE_FLY}(${JSON.stringify({ ...def, stall: false, seconds: 10 })}).then(()=>0)`);       // warm, discarded
      const out = {};
      for (const pass of ['free', 'stall']) {
        const m0 = await metrics();
        const r = await ev(`${PAGE_FLY}(${JSON.stringify({ ...def, stall: pass === 'stall' })}).then(r=>JSON.stringify(r))`).then(JSON.parse);
        const m1 = await metrics();
        out[pass] = summarise(r, m0, m1, r.wallMs);
        out.gl = { texMB: +(r.tex / 2 ** 20).toFixed(0), bufMB: +(r.buf / 2 ** 20).toFixed(0), peakTexMB: +(r.peak.tex / 2 ** 20).toFixed(0), peakBufMB: +(r.peak.buf / 2 ** 20).toFixed(0) };
        out.own = Object.fromEntries(Object.entries(r.own).map(([k, v]) => [k, { texMB: +(v.tex / 2 ** 20).toFixed(1), bufMB: +(v.buf / 2 ** 20).toFixed(1) }]).filter(([, v]) => v.texMB > 1 || v.bufMB > 1));
      }
      const hu = await page.send('Runtime.getHeapUsage'); out.heapMB = +(hu.usedSize / 2 ** 20).toFixed(0); out.backingMB = +((hu.backingStorageSize || 0) / 2 ** 20).toFixed(0);
      result.routes[name] = out;
    }
    result.machineAfter = machineLoad();
    return result;
  } finally { await chrome.close(); }
}

const results = [];
for (let r = 1; r <= REPS; r++) {
  try { const res = await oneRep(r); results.push(res); fs.writeFileSync(path.join(OUT, `${LABEL}-r${r}.json`), JSON.stringify(res, null, 1)); console.error(`rep ${r} done`); }
  catch (e) { console.error(`rep ${r} FAILED: ${e.stack || e}`); }
}
const out = [];
if (results[0]) {
  const e = results[0].env;
  out.push(`# frame-profile  url ${URL0}  gl ${GL}  ${PHONE ? 'phone 390x844 DPR3' : 'desktop 1280x800 DPR1.5'}  cpu throttle ${THROTTLE}x  preset ${e.preset}${PRESET ? ' (forced ' + PRESET + ')' : ''}  canvas ${e.canvas.join('x')}  seconds/pass ${SECONDS}  vsync off`);
  out.push(`renderer ${results[0].gpuRenderer}`);
  out.push(`graphics: renderScale ${e.renderScale} msaa ${e.msaa} shadows ${e.shadows} ao ${e.ao} bloom ${e.bloom} renderDistance ${e.renderDistance} treeDensity ${e.treeDensity} outerDensity ${e.outerDensity}  phone tier: ${JSON.stringify(e.lite)}`);
  out.push(`authored apartments: ${e.apts && e.apts.tris} triangles; cull ${JSON.stringify(e.cull)}`);
  out.push(`machine load average at start: ${results.map(r => r.machine.load1).join(', ')}`);
  for (const name of ROUTES) for (const pass of ['free', 'stall']) {
    const rs = results.map(r => r.routes[name][pass]).filter(Boolean);
    const mn = k => Math.min(...rs.map(x => x[k]));
    out.push(`\n${name} / ${pass}: reps ${rs.length}`);
    out.push(`  frame ms p50 ${mn('p50')}  p95 ${mn('p95')}  p99 ${mn('p99')}  max ${mn('max')}   (MIN over reps; per rep p50 [${rs.map(x => x.p50).join(', ')}], p95 [${rs.map(x => x.p95).join(', ')}])`);
    out.push(`  fps ${Math.max(...rs.map(x => x.fps))}  frames>33ms ${mn('over33')}  >50ms ${mn('over50')}  >100ms ${mn('over100')}  main thread busy ${mn('mainBusyPct')}%  script ${mn('scriptMsPerFrame')} ms/frame  layout ${mn('layoutMsPerFrame')}  style ${mn('styleMsPerFrame')}`);
    out.push(`  draw calls/frame ${rs[0].drawsPerFrame}  triangles/frame ${rs[0].trisPerFrameK}k`);
  }
  const g = results[0].routes[ROUTES[0]];
  out.push(`\nWebGL live at end (page-requested bytes): textures ${g.gl.texMB} MB (peak ${g.gl.peakTexMB}), buffers ${g.gl.bufMB} MB (peak ${g.gl.peakBufMB}); JS heap ${g.heapMB} MB, ArrayBuffer backing ${g.backingMB} MB`);
  out.push('by allocating file (MB): ' + Object.entries(g.own).sort((a, b) => (b[1].texMB + b[1].bufMB) - (a[1].texMB + a[1].bufMB)).map(([k, v]) => `${k} tex ${v.texMB} buf ${v.bufMB}`).join('; '));
}
const text = out.join('\n');
fs.writeFileSync(path.join(OUT, `report-${LABEL}.txt`), text);
console.log(text);
process.exit(0);
