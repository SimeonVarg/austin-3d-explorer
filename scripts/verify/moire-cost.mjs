/**
 * moire-cost.mjs - what the moire fix costs a frame, and what its tables weigh. Timing: a tool, not a check (run it on a quiet GPU).
 *
 * One page load. At each view the map is redrawn FRAMES times with the fix off and FRAMES times with it on, REPS times, interleaved
 * (off, on, off, on ...), each redraw closed by a one-pixel read so the GPU has really finished. Reported: the MINIMUM over the reps of
 * the median frame, per arm, and the difference. Also: the fix's table sizes (MoireFix.info) and the triangles drawn.
 * Quote the machine with the number: this page is CPU-bound on a fast card, so a difference under the spread is no difference.
 *
 *   VERIFY_URL=http://127.0.0.1:<port> VERIFY_GL=hardware node moire-cost.mjs [--out dir] [--size 1440x900] [--frames 60] [--reps 5] [--msaa 0|1]
 */
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';

const VIEWS = [
  { name: 'campus-far',  p: 0.2, center: [-97.7393, 30.2874],   zoom: 16.85, pitch: 74, bearing: 197.4 },
  { name: 'west-mid',    p: 0.2, center: [-97.7445, 30.2880],   zoom: 16.6,  pitch: 72, bearing: 300 },
  { name: 'guad-street', p: 0.2, center: [-97.74175, 30.28700], zoom: 18.6,  pitch: 82, bearing: 356 },
  { name: 'west-tower',  p: 0.2, center: [-97.74495, 30.2866],  zoom: 17.9,  pitch: 70, bearing: 205 },   // walls fill the screen: the most pixels the fix can touch
  { name: 'campus-far-night', p: 1.0, center: [-97.7393, 30.2874], zoom: 16.85, pitch: 74, bearing: 197.4 },
];
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const OUT = opt('--out', process.env.VERIFY_OUT || null);
const [W, H] = opt('--size', '1440x900').split('x').map(Number);
const FRAMES = +opt('--frames', '60'), REPS = +opt('--reps', '5'), MSAA = opt('--msaa', '0') === '1';
const browser = await launch(chromium, { maxMs: 40 * 60000 });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.addInitScript(cfg => { try { const K = 'austin3d.gfx.v1', cur = JSON.parse(localStorage.getItem(K) || '{}'); cur.msaa = cfg.msaa; cur.autoDetected = true; cur.autoExposure = false; localStorage.setItem(K, JSON.stringify(cur)); } catch (e) {} }, { msaa: MSAA });
await page.goto(`${BASE}/_harness.html?intro=0&drift=0&namelabels=0&facadepace=0&timeofdaypace=0&moirefix=1&smooth=${MSAA ? 1 : 0}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 420000 });
await page.waitForFunction(() => !document.getElementById('veil'), null, { timeout: 420000, polling: 500 });   // the app is still booting when the style has loaded (see moire-bar.mjs)
await page.waitForFunction(() => { const A = window.slopesApartments; return !A || !!(A.count.done && A.group); }, null, { timeout: 420000, polling: 500 });
await page.waitForTimeout(1500);
await page.evaluate(() => { window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect(); if (window.GFX) window.GFX.autoExposure = false; });
const rows = [];
for (const v of VIEWS) {
  const r = await page.evaluate(async ([v, FRAMES, REPS]) => {
    const m = window.__map, gl = m.painter.context.gl, sleep = ms => new Promise(r => setTimeout(r, ms)), px = new Uint8Array(4);
    const quiet = () => { const A = window.slopesApartments && window.slopesApartments.count, L = window.CityLighting && window.CityLighting.stats; return !(A && !A.done) && !(L && L.shadowProxyBuilding); };
    m.stop(); m.jumpTo({ center: v.center, zoom: v.zoom, pitch: v.pitch, bearing: v.bearing });
    if (window.applyTimeOfDay) window.applyTimeOfDay(m, v.p, true);
    for (let k = 0; k < 3; k++) { const t = Date.now(); while (!quiet() && Date.now() - t < 120000) await sleep(100); await new Promise(r => { const to = setTimeout(r, 20000); m.once('idle', () => { clearTimeout(to); r(); }); m.triggerRepaint(); }); await sleep(300); }
    const frame = () => new Promise(res => { const t0 = performance.now(); m.once('render', () => { gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); res(performance.now() - t0); }); m.triggerRepaint(); });
    const median = a => a.slice().sort((x, y) => x - y)[a.length >> 1];
    const out = { off: [], on: [] };
    for (let rep = 0; rep < REPS; rep++) for (const arm of ['off', 'on']) {
      window.MoireFix.reset(); window.MoireFix.set(arm);
      for (let i = 0; i < 8; i++) await frame();
      const t = []; for (let i = 0; i < FRAMES; i++) t.push(await frame());
      out[arm].push(median(t));
    }
    window.MoireFix.set('on');
    const st = window.slopes.stats();
    return { name: v.name, off: Math.min(...out.off), on: Math.min(...out.on), offAll: out.off, onAll: out.on, tris: st.triangles };
  }, [v, FRAMES, REPS]);
  rows.push(r);
  console.error(`[cost] ${r.name} off ${r.off.toFixed(2)} ms  on ${r.on.toFixed(2)} ms  (${(r.on - r.off >= 0 ? '+' : '') + (r.on - r.off).toFixed(2)})`);
}
const info = await page.evaluate(() => { const gl = window.__map.painter.context.gl, e = gl.getExtension('WEBGL_debug_renderer_info'); return { fix: window.MoireFix.info(), renderer: e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?', samples: gl.getParameter(gl.SAMPLES) }; });
const lines = [`moire-cost  ${W}x${H}  msaa=${MSAA ? 'on' : 'off'} (samples ${info.samples})  frames=${FRAMES} reps=${REPS}  renderer=${info.renderer}`,
  'frame = one forced redraw + a one-pixel read; min over reps of the median, ms', 'view                 off      on    diff   spread off        spread on         triangles'];
for (const r of rows) lines.push(r.name.padEnd(18) + r.off.toFixed(2).padStart(7) + r.on.toFixed(2).padStart(8) + ((r.on - r.off >= 0 ? '+' : '') + (r.on - r.off).toFixed(2)).padStart(8) + ('   ' + Math.min(...r.offAll).toFixed(2) + '-' + Math.max(...r.offAll).toFixed(2)).padEnd(19) + (Math.min(...r.onAll).toFixed(2) + '-' + Math.max(...r.onAll).toFixed(2)).padEnd(18) + r.tris);
lines.push(`tables: ${info.fix.faces} wall faces, ${(info.fix.tableBytes / 1048576).toFixed(2)} MiB in ${info.fix.tables} table set(s) (face records + row strips + edge strips); vertices and vertex bytes unchanged`);
console.log(lines.join('\n'));
if (OUT) { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'cost.txt'), lines.join('\n') + '\n'); fs.writeFileSync(path.join(OUT, 'cost.json'), JSON.stringify({ size: [W, H], msaa: MSAA, info, rows }, null, 1)); }
await browser.__done();
