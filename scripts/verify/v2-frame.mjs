/**
 * v2-frame.mjs - frame time of the v2 app (/v2/), by the page's own requestAnimationFrame intervals during a slow orbit.
 *
 *   VERIFY_GL=hardware VERIFY_URL=http://127.0.0.1:8099 node scripts/verify/v2-frame.mjs [--uncapped] [--reps 3] [--ms 4000]
 *
 * Instrument (printed with every number, README: "an instrument's defaults are part of its answer"):
 *   - REAL GPU only: the run fails if the renderer string says SwiftShader.
 *   - rAF intervals are capped at the display's 60 Hz (16.7 ms floor) unless --uncapped (adds --disable-gpu-vsync --disable-frame-rate-limit,
 *     then the number is the page's real cost per frame, not a frame-rate cap).
 *   - arms: desktop = 1440x900 at device scale 2 (canvas 2880x1800), CPU x1; phone = 390x844 at device scale 3 (the app caps its canvas at
 *     780x1688), CPU throttled 4x through CDP (the repo's simulated phone). Views: the opening view, DKR Memorial Stadium close, West Campus.
 *   - one fresh page per (arm, rep); the arms are rotated each rep; every view waits for all tiles to settle, then 1.5 s, then 4 s of orbit
 *     (0.15 degrees a frame). Reported: the MINIMUM over reps of each rep's median interval (and the minimum p95), never one reading.
 *   - The v2 app has no graphics auto-detect probe (that is the old app's `cancelGraphicsAutoDetect`), so there is nothing to cancel.
 */
import { chromium } from 'playwright-core';
import { launch, BASE, HW_ARGS } from './chrome.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i < 0 ? d : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };
const UNCAPPED = process.argv.includes('--uncapped');
const REPS = +arg('--reps', 3), MS = +arg('--ms', 4000);
const ARMS = [
  { name: 'desktop 1440x900@2, CPU x1', w: 1440, h: 900, dpr: 2, cpu: 1, mobile: false },
  { name: 'phone 390x844@3, CPU x4', w: 390, h: 844, dpr: 3, cpu: 4, mobile: true },
];
const VIEWS = [
  { name: 'opening view', pose: null },
  { name: 'DKR close', slug: 'dkr-memorial-stadium', distance: 330, polar: 58, azimuth: 235 },
  { name: 'West Campus (The Venue)', slug: 'the-venue', distance: 380, polar: 55, azimuth: 30 },
];
const args = [...HW_ARGS, ...(UNCAPPED ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [])];
const browser = await launch(chromium, { args, maxMs: 1500000 });
const rec = {};   // `${arm}|${view}` -> [{median,p95,calls,triangles}]
let renderer = '';
for (let rep = 0; rep < REPS; rep++) {
  const order = rep % 2 ? [...ARMS].reverse() : ARMS;
  for (const arm of order) {
    const ctx = await browser.newContext({ viewport: { width: arm.w, height: arm.h }, deviceScaleFactor: arm.dpr, isMobile: arm.mobile, hasTouch: arm.mobile });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    if (arm.cpu > 1) { const c = await ctx.newCDPSession(page); await c.send('Emulation.setCPUThrottlingRate', { rate: arm.cpu }); }
    await page.goto(`${BASE.replace(/\/$/, '')}/v2/`, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => window.__v2 && window.__v2.ready, null, { timeout: 120000 });
    await page.evaluate(() => window.__v2.ready);
    const man = await page.evaluate(() => fetch('./tiles/manifest.json').then((r) => r.json()));
    if (!renderer) renderer = await page.evaluate(() => { const g = window.__v2.renderer.getContext(); const e = g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER); });
    for (const v of VIEWS) {
      if (v.slug) { const b = man.buildings[v.slug]; await page.evaluate(([x, z, d, p, a]) => window.__v2.placeCamera({ target: [x, 0, z], distance: d, polarDeg: p, azimuthDeg: a }), [b.x, b.z, v.distance, v.polar, v.azimuth]); }
      let calm = 0; const t0 = Date.now();
      while (calm < 3 && Date.now() - t0 < 180000) { const s = await page.evaluate(() => window.__v2.tiles()); calm = s && s.loading === 0 ? calm + 1 : 0; await page.waitForTimeout(700); }
      await page.waitForTimeout(1500);
      const m = await page.evaluate((ms) => window.__v2.measure(ms, 0.15), MS);
      (rec[`${arm.name}|${v.name}`] ||= []).push({ median: m.medianFrameMs, p95: m.p95FrameMs, cpu: m.medianRenderCallMs, calls: m.calls, triangles: m.triangles, frames: m.frames, size: m.size });
    }
    if (errs.length) console.log('page errors:', errs.slice(0, 3));
    await ctx.close();
  }
}
await browser.close();
const f = (x) => (x == null ? 'n/a' : x.toFixed(1));
console.log(`renderer: ${renderer}`);
console.log(`instrument: ${UNCAPPED ? 'vsync and frame-rate limit OFF (real cost per frame)' : 'rAF at the 60 Hz cap (16.7 ms floor)'}; ${REPS} reps, arms rotated, ${MS} ms orbit at 0.15 deg/frame, min of per-rep medians`);
console.log('arm | view | min median ms | min p95 ms | reps (medians) | draw calls | triangles | canvas');
for (const [k, rows] of Object.entries(rec)) {
  const [arm, view] = k.split('|');
  console.log(`${arm} | ${view} | ${f(Math.min(...rows.map((r) => r.median)))} | ${f(Math.min(...rows.map((r) => r.p95)))} | ${rows.map((r) => f(r.median)).join(' / ')} | ${rows[0].calls} | ${rows[0].triangles} | ${rows[0].size.join('x')}`);
}
if (/swiftshader/i.test(renderer)) { console.log('*FAIL: software renderer'); process.exit(1); }
