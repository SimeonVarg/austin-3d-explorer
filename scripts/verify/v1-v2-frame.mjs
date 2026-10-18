/**
 * v1-v2-frame.mjs - the old app (/) against v2 (/v2/), the SAME views with the SAME instrument: load time and frame time.
 *
 *   VERIFY_URL=http://127.0.0.1:8099 node scripts/verify/v1-v2-frame.mjs [--uncapped] [--reps 3] [--ms 4000] [--arms desktop,phone]
 *
 * Instrument (printed with every number; README: "an instrument's defaults are part of its answer"):
 *   - REAL GPU only (HW_ARGS): the run fails if the renderer string says SwiftShader.
 *   - --uncapped adds --disable-gpu-vsync --disable-frame-rate-limit, so a rAF interval is the page's real cost per frame,
 *     not the display's 60 Hz floor. Without it every number below 16.7 ms reads 16.7.
 *   - arms: desktop = 1440x900 at device scale 2, CPU x1; phone = 390x844 at device scale 3, CPU throttled 4x through CDP (the repo's
 *     simulated phone, NOT a phone). One fresh page per (app, arm, rep); the order of the two apps is swapped every rep.
 *   - v1: ?intro=0&drift=0, the graphics auto-detect probe cancelled at once (window.cancelGraphicsAutoDetect), its default preset.
 *     v2: ?intro=0. "Load" = navigation start to the old app's veil lifting (v1) / to the plain city in and every Blender tile in view
 *     standing (v2: the same gate that lifts v2's veil, without its 2.5 s minimum).
 *   - views, as MapLibre poses (v2 frames the same ground at the centre of the screen through v2/maplite.js; v2's lens is 40 degrees,
 *     v1's 58): the opening flight's landing, DKR close, West Campus. Each waits for the app to settle (v1: map idle; v2: tiles
 *     settled), then 1.5 s, then MS ms turning 0.15 degrees a frame. Reported: the MINIMUM over reps of each rep's median interval.
 */
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { launch, BASE, HW_ARGS } from './chrome.mjs';

// The AWS GPU runner (scripts/aws-gpu/user-data) stops the machine after 20 minutes with no heartbeat, and it beats only between
// checks. This one check runs longer than that (two apps, two arms, three reps, run one after another on purpose: timing checks must
// not share the GPU), so it feeds the heartbeat itself while it works. Elsewhere the file does not exist and this does nothing.
const HEARTBEAT = '/opt/flyover/heartbeat';
const beat = setInterval(() => { try { if (fs.existsSync(HEARTBEAT)) { const t = new Date(); fs.utimesSync(HEARTBEAT, t, t); } } catch (e) {} }, 60000);
beat.unref();

const arg = (k, d) => { const i = process.argv.indexOf(k); return i < 0 ? d : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };
const UNCAPPED = process.argv.includes('--uncapped');
const REPS = +arg('--reps', 3), MS = +arg('--ms', 4000);
const ARMS = [
  { id: 'desktop', name: 'desktop 1440x900@2, CPU x1', w: 1440, h: 900, dpr: 2, cpu: 1, mobile: false },
  { id: 'phone', name: 'phone 390x844@3, CPU x4 (simulated)', w: 390, h: 844, dpr: 3, cpu: 4, mobile: true },
].filter((a) => String(arg('--arms', 'desktop,phone')).split(',').includes(a.id));
const VIEWS = [
  { name: 'opening (flight landing)', pose: { center: [-97.7365, 30.2900], zoom: 16.45, pitch: 74, bearing: 202 } },
  { name: 'DKR close', pose: { center: [-97.73286, 30.28396], zoom: 17.2, pitch: 58, bearing: 125 } },
  { name: 'West Campus (The Venue)', pose: { center: [-97.7419, 30.2942], zoom: 17.0, pitch: 55, bearing: 330 } },
];
const APPS = ['v1', 'v2'];
const args = [...HW_ARGS, ...(UNCAPPED ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [])];
const browser = await launch(chromium, { args, maxMs: 3000000 });
const rec = {}, load = {};
let renderers = new Set();
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };

for (let rep = 0; rep < REPS; rep++) {
  for (const arm of ARMS) {
    for (const app of rep % 2 ? [...APPS].reverse() : APPS) {
      const ctx = await browser.newContext({ viewport: { width: arm.w, height: arm.h }, deviceScaleFactor: arm.dpr, isMobile: arm.mobile, hasTouch: arm.mobile });
      const page = await ctx.newPage();
      if (arm.cpu > 1) { const c = await ctx.newCDPSession(page); await c.send('Emulation.setCPUThrottlingRate', { rate: arm.cpu }); }
      const t0 = Date.now();
      if (app === 'v1') {
        await page.goto(`${BASE.replace(/\/$/, '')}/?intro=0&drift=0`, { waitUntil: 'domcontentloaded', timeout: 180000 });
        await page.waitForFunction(() => typeof window.cancelGraphicsAutoDetect === 'function', null, { timeout: 120000 });
        await page.evaluate(() => window.cancelGraphicsAutoDetect());
        await page.waitForFunction(() => !document.getElementById('veil') || document.getElementById('veil').classList.contains('lift'), null, { timeout: 300000, polling: 100 });
      } else {
        await page.goto(`${BASE.replace(/\/$/, '')}/v2/?intro=0`, { waitUntil: 'domcontentloaded', timeout: 180000 });
        await page.waitForFunction(() => window.__v2 && window.__v2.map && window.__v2.map.areTilesLoaded(), null, { timeout: 300000, polling: 100 });
      }
      const loadS = (Date.now() - t0) / 1000;
      (load[`${arm.name}|${app}`] ||= []).push(loadS);
      renderers.add(await page.evaluate(() => { const c = document.createElement('canvas').getContext('webgl2'); const e = c && c.getExtension('WEBGL_debug_renderer_info'); return e ? c.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; }));
      for (const v of VIEWS) {
        await page.evaluate(([a, p]) => (a === 'v1' ? window.__map : window.__v2.map).jumpTo(p), [app, v.pose]);
        // settle: v1 map idle, v2 tiles settled; then 1.5 s
        if (app === 'v1') await page.evaluate(() => new Promise((r) => { const m = window.__map; if (m.loaded() && m.areTilesLoaded()) r(); else m.once('idle', r); setTimeout(r, 60000); }));
        else await page.waitForFunction(() => window.__v2.map.areTilesLoaded() && window.__v2.tiles().loading === 0, null, { timeout: 120000, polling: 200 });
        await page.waitForTimeout(1500);
        const m = await page.evaluate(([a, ms, pose]) => new Promise((res) => {
          const map = a === 'v1' ? window.__map : window.__v2.map, dts = []; let last = 0, b = pose.bearing; const end = performance.now() + ms;
          const step = (now) => { if (last) dts.push(now - last); last = now; b += 0.15; map.jumpTo({ ...pose, bearing: b }); if (now < end) requestAnimationFrame(step); else res(dts); };
          requestAnimationFrame(step);
        }), [app, MS, v.pose]);
        (rec[`${arm.name}|${v.name}|${app}`] ||= []).push({ median: median(m), p95: pct(m, 0.95), frames: m.length });
      }
      await ctx.close();
    }
  }
}
await browser.close();
if ([...renderers].some((r) => /swiftshader/i.test(r))) { console.error('FAIL: a software renderer:', [...renderers]); process.exit(1); }
const f = (x) => x.toFixed(1);
console.log(`instrument: renderer ${[...renderers].join(' / ')}; ${UNCAPPED ? 'vsync and frame-rate limit OFF (real cost per frame)' : 'rAF at the 60 Hz cap (16.7 ms floor)'}; ${REPS} reps, app order swapped each rep, ${MS} ms turning 0.15 deg/frame; min of per-rep medians`);
console.log('arm | app | load s (min; reps)');
for (const [k, v] of Object.entries(load)) { const [arm, app] = k.split('|'); console.log(`${arm} | ${app} | ${f(Math.min(...v))} (${v.map(f).join(' / ')})`); }
console.log('arm | view | v1 frame ms (min median; p95) | v2 frame ms (min median; p95) | v1 / v2');
for (const arm of ARMS) for (const v of VIEWS) {
  const a = rec[`${arm.name}|${v.name}|v1`], b = rec[`${arm.name}|${v.name}|v2`];
  const am = Math.min(...a.map((r) => r.median)), bm = Math.min(...b.map((r) => r.median));
  console.log(`${arm.name} | ${v.name} | ${f(am)} (${f(Math.min(...a.map((r) => r.p95)))}) | ${f(bm)} (${f(Math.min(...b.map((r) => r.p95)))}) | ${(am / bm).toFixed(1)}x`);
}
