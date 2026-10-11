/**
 * smooth-cost.mjs - what Smooth edges (4 samples a pixel) costs a MOVING frame, and what the at-rest accumulation costs. Timing: a tool, not a check.
 *
 * ONE page load of the real page (index.html: the harness shims requestAnimationFrame). Smooth edges is a live switch
 * (js/frame-target.js), so the two arms are flipped inside the page: off, on, off, on ... REPS times. A frame is one
 * camera step along a flight, drawn, and closed by a one-pixel read so the GPU has really finished. Reported per
 * flight: the MINIMUM over the reps of the median (p50) and of the 90th percentile (p90) frame, per arm, the
 * difference, and the spread of the reps. Then, parked at the end of the flight: how long the accumulation's cycle
 * takes, how many frames it draws, and how many frames follow it.
 * Memory: the buffers' sizes by arithmetic (they are ours, so the sizes are exact), and on an NVIDIA card the change
 * in the card's used memory between the arms (nvidia-smi, the whole card: other programs move it too).
 * Quote the machine and its load with every number. A difference under the spread is no difference.
 *
 *   VERIFY_URL=http://127.0.0.1:<port> VERIFY_GL=hardware node smooth-cost.mjs [--out dir] [--size 1280x680] [--dpr 1.5]
 *        [--frames 120] [--reps 3] [--flights spawn-orbit,downtown-pan,guad-walk] [--preset balanced] [--q k=v,...] [--headed]
 */
import { chromium } from 'playwright-core';
import { BASE, launch, HW_ARGS } from './chrome.mjs';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const FLIGHTS = {
  'spawn-orbit':  { p: 0.2, from: { center: [-97.7434, 30.2857], zoom: 16.5, pitch: 74, bearing: 214 }, to: { center: [-97.7434, 30.2857], zoom: 16.5, pitch: 74, bearing: 286 } },
  'downtown-pan': { p: 0.2, from: { center: [-97.7460, 30.2667], zoom: 16.3, pitch: 72, bearing: 25 },  to: { center: [-97.7400, 30.2687], zoom: 16.3, pitch: 72, bearing: 25 } },
  'guad-walk':    { p: 0.2, from: { center: [-97.74175, 30.28620], zoom: 18.6, pitch: 82, bearing: 356 }, to: { center: [-97.74175, 30.28780], zoom: 18.6, pitch: 82, bearing: 356 } },
  'campus-night': { p: 1.0, from: { center: [-97.7393, 30.2874], zoom: 16.85, pitch: 74, bearing: 180 }, to: { center: [-97.7393, 30.2874], zoom: 16.85, pitch: 74, bearing: 215 } },
};
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const OUT = opt('--out', process.env.VERIFY_OUT || null);
const [W, H] = opt('--size', '1280x680').split('x').map(Number), DPR = +opt('--dpr', '1.5');
const FRAMES = +opt('--frames', '120'), REPS = +opt('--reps', '3'), PRESET = opt('--preset', 'balanced');
const names = opt('--flights', 'spawn-orbit,downtown-pan,guad-walk').split(',');
const QS = ['intro=0', 'drift=0', 'timeofdaypace=0', 'smooth=0', 'restaccum=0'].concat((opt('--q', '') || '').split(',').filter(Boolean));
const nv = () => { try { return +String(execFileSync('nvidia-smi', ['--query-gpu=memory.used', '--format=csv,noheader,nounits'], { stdio: ['ignore', 'pipe', 'ignore'] })).split('\n')[0]; } catch (e) { return null; } };

const browser = await launch(chromium, { headless: !argv.includes('--headed'), gl: 'hardware', maxMs: +(process.env.VERIFY_MAX_MS || 45 * 60000),
  // --headed: a real window, which is how a laptop with two graphics chips hands Chrome the big one (headless got the integrated chip on
  // the Windows laptop, 2026-10-10). It is opened off the screen and unfocused work goes on: the occlusion switches keep it drawing.
  args: [...HW_ARGS, '--disable-gpu-vsync', '--disable-frame-rate-limit', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
    ...(argv.includes('--headed') ? ['--window-position=-32000,-32000', '--disable-features=CalculateNativeWinOcclusion'] : [])] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.exposeFunction('__nv', nv);
await page.addInitScript(preset => { try { localStorage.setItem('austin3d.gfx.v1', JSON.stringify({ preset, rev: 3, autoDetected: true })); } catch (e) {}
  const t = setInterval(() => { if (window.cancelGraphicsAutoDetect) { window.cancelGraphicsAutoDetect(); clearInterval(t); } }, 20); }, PRESET);
const load0 = os.loadavg()[0];
await page.goto(`${BASE}/index.html?${QS.join('&')}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => window.__map && window.slopesApartments?.count.done && window.slopesApartments.count.buildings > 0 && window.slopesApartments.readyToReveal(), null, { timeout: 600000, polling: 500 });
await page.waitForFunction(() => !document.getElementById('veil'), null, { timeout: 300000, polling: 250 });
await page.waitForTimeout(2000);
const rows = [];
for (const name of names) {
  const fl = FLIGHTS[name]; if (!fl) { console.error('unknown flight ' + name); continue; }
  const r = await page.evaluate(async ([fl, FRAMES, REPS]) => {
    const m = window.__map, F = window.FrameTarget, gl = m.painter.context.gl, sleep = ms => new Promise(r => setTimeout(r, ms)), px = new Uint8Array(4);
    window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect();
    const lerp = (a, b, t) => a + (b - a) * t;
    const at = t => ({ center: [lerp(fl.from.center[0], fl.to.center[0], t), lerp(fl.from.center[1], fl.to.center[1], t)], zoom: lerp(fl.from.zoom, fl.to.zoom, t), pitch: lerp(fl.from.pitch, fl.to.pitch, t), bearing: lerp(fl.from.bearing, fl.to.bearing, t) });
    const quiet = () => { const A = window.slopesApartments && window.slopesApartments.count, L = window.CityLighting && window.CityLighting.stats, P = window.__facadePace; return !(P && P.busy) && !(A && !A.done) && !(L && L.shadowProxyBuilding); };
    const settle = async () => { for (let k = 0; k < 2; k++) { const t = Date.now(); while (!quiet() && Date.now() - t < 120000) await sleep(100); await new Promise(r => { const to = setTimeout(r, 20000); m.once('idle', () => { clearTimeout(to); r(); }); m.triggerRepaint(); }); await sleep(200); } };
    F.setRest(false); F.setSmooth(false);
    if (window.applyTimeOfDay) window.applyTimeOfDay(m, fl.p, true);
    for (let i = 0; i <= 6; i++) { m.jumpTo(at(i / 6)); await settle(); }                         // the whole path once, so both arms find it loaded
    const frame = cam => new Promise(res => { const t0 = performance.now(); m.once('render', () => { gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); res(performance.now() - t0); }); m.jumpTo(cam); });
    const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]; };
    const out = { off: [], on: [], nvOff: [], nvOn: [] };
    for (let rep = 0; rep < REPS; rep++) for (const arm of (rep % 2 ? ['on', 'off'] : ['off', 'on'])) {
      F.setSmooth(arm === 'on');
      for (let i = 0; i < 12; i++) await frame(at(0.002 * (i % 2)));
      const t = []; for (let i = 0; i < FRAMES; i++) t.push(await frame(at(i / (FRAMES - 1))));
      out[arm].push({ p50: q(t, 0.5), p90: q(t, 0.9), mean: t.reduce((a, b) => a + b, 0) / t.length });
      out[arm === 'on' ? 'nvOn' : 'nvOff'].push(await window.__nv());
    }
    // parked at the end of the flight: the accumulation's cycle, with Smooth edges off and on
    const cyc = {};
    for (const arm of ['off', 'on']) {
      F.setSmooth(arm === 'on'); F.setRest(false); m.jumpTo(at(1)); await settle();
      const s0 = { ...F.stats }, t0 = performance.now();
      F.stats.who = {}; F.stats.why = {}; F.trace = true;
      F.setRest(true);
      while (F.state() !== 'done' && performance.now() - t0 < 30000) await sleep(10);
      const tDone = performance.now() - t0, s1 = { ...F.stats };
      await sleep(1500); const s2 = { ...F.stats }; await sleep(3000); const s3 = { ...F.stats };
      F.trace = false;
      cyc[arm] = { who: { ...F.stats.who }, why: { ...F.stats.why }, breaks: F.stats.breaks, ms: Math.round(tDone), state: F.state(), shifts: s1.sample - s0.sample, framesToDone: s1.frames - s0.frames, after: s2.frames - s1.frames, parked3s: s3.frames - s2.frames, frameMs: +F.stats.frameMs.toFixed(1) };
      F.setRest(false);
    }
    F.setSmooth(false);
    const best = (a, k) => Math.min(...a.map(x => x[k]));
    return { off: { p50: best(out.off, 'p50'), p90: best(out.off, 'p90'), mean: best(out.off, 'mean') }, on: { p50: best(out.on, 'p50'), p90: best(out.on, 'p90'), mean: best(out.on, 'mean') },
      reps: out, cyc, canvas: [m.getCanvas().width, m.getCanvas().height], tris: window.slopes && window.slopes.stats ? window.slopes.stats().triangles : null };
  }, [fl, FRAMES, REPS]);
  r.name = name; rows.push(r);
  console.error(`[cost] ${name} off ${r.off.p50.toFixed(1)}/${r.off.p90.toFixed(1)} ms  on ${r.on.p50.toFixed(1)}/${r.on.p90.toFixed(1)} ms  cycle ${r.cyc.off.ms} ms`);
}
const info = await page.evaluate(() => { const m = window.__map, gl = m.painter.context.gl, e = gl.getExtension('WEBGL_debug_renderer_info'), F = window.FrameTarget;
  return { renderer: e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?', own: F.own(), samples: Math.min(F.SMOOTH.samples, gl.getParameter(gl.MAX_SAMPLES)), canvas: [m.getCanvas().width, m.getCanvas().height],
    preset: window.GFX && window.GFX.preset, scale: window.GFX && window.GFX.renderScale, pdb: gl.getContextAttributes().preserveDrawingBuffer, count: F.REST.count }; });
const px = info.canvas[0] * info.canvas[1], MB = b => (b / 1048576).toFixed(1);
const f1 = x => x.toFixed(1), pc = (a, b) => ((b / a - 1) * 100 >= 0 ? '+' : '') + ((b / a - 1) * 100).toFixed(0) + '%';
const lines = [`smooth-cost  ${W}x${H} @ ${DPR} = canvas ${info.canvas.join('x')} (${(px / 1e6).toFixed(2)} MP)  preset ${info.preset}  frames=${FRAMES} reps=${REPS}  renderer=${info.renderer}`,
  `machine: ${os.cpus().length} cpus, load average ${load0.toFixed(1)} at start, ${os.loadavg()[0].toFixed(1)} at end. frame = one camera step drawn + a one-pixel read; min over reps, ms`,
  'flight          off p50   on p50    diff | off p90   on p90    diff | reps p50 off            reps p50 on            | nvidia MiB on-off'];
for (const r of rows) {
  const d = r.reps.nvOn.map((v, i) => v == null || r.reps.nvOff[i] == null ? null : v - r.reps.nvOff[i]).filter(v => v != null).sort((a, b) => a - b);
  lines.push(r.name.padEnd(14) + f1(r.off.p50).padStart(8) + f1(r.on.p50).padStart(9) + pc(r.off.p50, r.on.p50).padStart(8) + ' |' + f1(r.off.p90).padStart(8) + f1(r.on.p90).padStart(9) + pc(r.off.p90, r.on.p90).padStart(8) + ' | ' +
    r.reps.off.map(x => f1(x.p50)).join(' ').padEnd(23) + r.reps.on.map(x => f1(x.p50)).join(' ').padEnd(23) + '| ' + (d.length ? d[d.length >> 1] : '-'));
}
lines.push('', 'parked at the end of each flight: the accumulation (Smooth edges off | on): ms to converge, shifted frames, frames drawn until converged, frames after, frames in the next 3 s');
for (const r of rows) lines.push(r.name.padEnd(14) + ['off', 'on'].map(a => { const c = r.cyc[a]; return `${String(c.ms).padStart(6)} ms ${c.shifts} shifts ${c.framesToDone} frames, then ${c.after}, then ${c.parked3s}${c.state === 'done' ? '' : ' NOT CONVERGED (' + c.state + ') why ' + JSON.stringify(c.why) + ' who ' + JSON.stringify(c.who)}`; }).join('  |  '));
lines.push('', `memory by arithmetic at ${info.canvas.join('x')}: Smooth edges ${MB(px * info.samples * 8)} MiB (${info.samples} samples x colour and depth; the canvas keeps its own ${MB(px * 8)}), ` +
  `accumulation ${MB(px * 12)} MiB (one 8-bit copy + one half-float mean, made on the first still camera)`);
if (errs.length) lines.push('PAGE ERRORS: ' + [...new Set(errs)].slice(0, 5).join(' | '));
console.log(lines.join('\n'));
if (OUT) { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'cost.txt'), lines.join('\n') + '\n'); fs.writeFileSync(path.join(OUT, 'cost.json'), JSON.stringify({ size: [W, H], dpr: DPR, info, load: [load0, os.loadavg()[0]], rows }, null, 1)); }
await browser.__done();
