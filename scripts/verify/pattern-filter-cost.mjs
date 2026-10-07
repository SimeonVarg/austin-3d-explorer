/**
 * pattern-filter-cost.mjs — what the far pattern filter (js/city-lighting.js,
 * CityLighting.patternFilter) costs the GPU, per setting, on this browser.
 *
 * WHY THIS WAY. Frame intervals across fresh loads could not answer it on the
 * AMD integrated chip: the mean frame of the SAME code swung 45-66 ms between
 * loads, while the filter's cost is 1-3 ms. The filter's settings are live
 * uniforms, so every setting can be timed in ONE page, same tiles, same
 * camera. Each timed frame is a synchronous map.redraw() followed by a
 * 1-pixel readPixels, so it includes the GPU finishing that frame; the camera
 * does not move, so the CPU side is the same for every setting. Settings run
 * in alternating order each round (forward, then reversed) so a slow drift
 * cancels. The page loads with ?patfilter=1, so the filter is compiled in on
 * any GPU (by default it compiles only on a graphics card).
 *
 *   VERIFY_URL=http://127.0.0.1:<port> node pattern-filter-cost.mjs \
 *     [--states '{"off":{"on":false},"full":{"on":true},"t2":{"on":true,"maxTaps":2}}'] \
 *     [--rounds 10] [--n 15] [--poses downtown,intro-start,spawn,campus-low]
 *   AMD integrated chip on the test laptop: CHROME_PATH=<msedge.exe> VERIFY_GPU=low
 *
 * Prints, per pose: each setting's median ms a frame over the rounds and, for
 * every setting after the first, the median per-round difference from the
 * first and how many rounds it was slower. Headed, hardware GL, 1280x680 at
 * DPR 1.5 (the owner's screen), balanced preset, auto-detect cancelled.
 *
 * Measured 2026-09-28 (claude/moire-distance), full vs off: RTX 3050 Ti
 * +0 to +1.2 ms (19 ms frames); AMD Radeon integrated +0.7 to +2.5 ms (30-50 ms
 * frames). That is why the filter is on by default only on a graphics card.
 */
import { chromium } from 'playwright-core';
import { BASE, launch, HW_ARGS } from './chrome.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const W = 1280, H = 680, DPR = 1.5;
const STILL = {
  'downtown':    { center: [-97.7430, 30.2690], zoom: 16.4,  pitch: 70, bearing: 20 },
  'intro-start': { center: [-97.7420, 30.2680], zoom: 16.2,  pitch: 78, bearing: 5 },
  'spawn':       { center: [-97.7434, 30.2857], zoom: 16.5,  pitch: 74, bearing: 250 },
  'campus-low':  { center: [-97.7395, 30.2860], zoom: 17.2,  pitch: 72, bearing: 160 },
};
const STATES = JSON.parse(opt('--states', '{"off":{"on":false},"full":{"on":true}}'));
const names = Object.keys(STATES), ROUNDS = +opt('--rounds', '10'), N = +opt('--n', '15');
const poses = opt('--poses', Object.keys(STILL).join(',')).split(',');
for (const p of poses) if (!STILL[p]) { console.error('unknown pose ' + p); process.exit(2); }
const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]; };

const browser = await launch(chromium, { headless: false, gl: 'hardware', maxMs: +(process.env.VERIFY_MAX_MS || 3600000),
  args: [...HW_ARGS, '--disable-gpu-vsync', '--disable-frame-rate-limit',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
const page = await ctx.newPage();
await page.addInitScript(() => {
  try { localStorage.setItem('austin3d.gfx.v1', JSON.stringify({ preset: 'balanced', rev: 3, autoDetected: true })); } catch (e) {}
  const t = setInterval(() => { if (window.cancelGraphicsAutoDetect) { window.cancelGraphicsAutoDetect(); clearInterval(t); } }, 20);
});
await page.goto(`${BASE}/index.html?intro=0&drift=0&patfilter=1`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => window.__map && window.slopesApartments?.count.done && window.slopesApartments.count.buildings > 0 &&
  window.slopesApartments.readyToReveal(), null, { timeout: 300000, polling: 500 });
await page.waitForFunction(() => !document.getElementById('veil'), null, { timeout: 120000, polling: 250 });
const info = await page.evaluate(() => {
  window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect();
  const m = window.__map, gl = m.painter.context.gl, ext = gl.getExtension('WEBGL_debug_renderer_info');
  return { renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '?', samples: gl.getParameter(gl.SAMPLES),
    canvas: m.getCanvas().width + 'x' + m.getCanvas().height, base: { ...window.CityLighting.patternFilter } };
});
console.log(`renderer ${info.renderer}  canvas ${info.canvas}  samples ${info.samples}  compiled ${info.base.compiled}`);
if (!info.base.compiled) { console.error('the filter did not compile into the page: nothing to time'); process.exitCode = 1; }
for (const pose of info.base.compiled ? poses : []) {
  await page.evaluate(async ({ p }) => {
    const m = window.__map;
    m.jumpTo(p);
    await new Promise(r => { const t0 = performance.now(); const tick = () => (m.areTilesLoaded() && performance.now() - t0 > 3000) || performance.now() - t0 > 20000 ? r() : setTimeout(tick, 200); tick(); });
  }, { p: STILL[pose] });
  const res = Object.fromEntries(names.map(n => [n, []]));
  for (let r = 0; r < ROUNDS; r++) {
    for (const n of (r % 2 ? names.slice().reverse() : names)) {
      const ms = await page.evaluate(({ st, base, n }) => {
        const m = window.__map, gl = m.painter.context.gl, px = new Uint8Array(4);
        Object.assign(window.CityLighting.patternFilter, base, st);
        const one = () => { m.redraw(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
        for (let i = 0; i < 3; i++) one();
        const t = [];
        for (let i = 0; i < n; i++) { const t0 = performance.now(); one(); t.push(performance.now() - t0); }
        t.sort((a, b) => a - b);
        return t[Math.floor(t.length / 2)];
      }, { st: STATES[n], base: info.base, n: N });
      res[n].push(ms);
      await new Promise(r => setTimeout(r, 150));
    }
  }
  const ref = names[0];
  const line = names.map(n => {
    if (n === ref) return `${n} ${q(res[n], 0.5).toFixed(2)}`;
    const d = res[n].map((v, i) => v - res[ref][i]);
    return `${n} ${q(res[n], 0.5).toFixed(2)} (${q(d, 0.5) >= 0 ? '+' : ''}${q(d, 0.5).toFixed(2)}, slower ${d.filter(x => x > 0).length}/${d.length})`;
  }).join('  ');
  console.log(`${pose.padEnd(12)} ms/frame, median of ${ROUNDS} rounds x ${N} frames: ${line}`);
}
await page.evaluate(({ base }) => Object.assign(window.CityLighting.patternFilter, base), { base: info.base });
await ctx.close();
browser.__done();
