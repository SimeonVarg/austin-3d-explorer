/**
 * v2-flight.mjs - frame time of the v2 app's OPENING FLIGHT (the first thing anyone sees), versions interleaved.
 *
 *   VERIFY_GL=hardware VERIFY_URL=http://127.0.0.1:8099 node scripts/verify/v2-flight.mjs [--refs "main|."] [--q "adapt=0|"] [--reps 3] [--phone] [--uncapped]
 *
 * Instrument (README: "an instrument's defaults are part of its answer"):
 *   - REAL GPU only (fails on SwiftShader). A fresh page per (variant, rep), the variants rotated each rep (interleaved A/B).
 *   - the page loads with the loading screen and the opening flight on (no ?intro=0); a requestAnimationFrame loop in the page
 *     records every frame interval from the moment the flight starts ('flying') to its end ('done'): the camera moves in all of them.
 *   - rAF intervals are capped at the display's 60 Hz (16.7 ms floor) unless --uncapped (vsync and the frame-rate limit off).
 *   - reported: the MINIMUM over reps of each rep's median interval, and of its p95; frames over 50 ms (below 20 fps); the median
 *     canvas scale in the flight (1 = full resolution: the adaptive resolution, main.js); shadow-map redraws in the flight.
 *   - arms: desktop 1440x900 at device scale 2 (canvas 2880x1800), CPU x1; --phone: 390x844 at scale 3, CPU x4.
 *   - --refs works as in v2-frame.mjs (each ref's v2/ extracted beside v2/; "." = this checkout).
 */
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, BASE, HW_ARGS } from './chrome.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i < 0 ? d : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };
const UNCAPPED = process.argv.includes('--uncapped');
const REPS = +arg('--reps', 3);
const QARG = arg('--q', ''), QS = (typeof QARG === 'string' ? QARG : '').split('|');
const RARG = arg('--refs', '.');
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
function refFolder(ref) {
  if (ref === '.') return 'v2';
  const run = (...a) => execFileSync('git', a, { cwd: REPO, encoding: 'utf8' }).trim();
  let sha = '';
  try { sha = run('rev-parse', '--verify', '--quiet', ref + '^{commit}'); } catch (e) { sha = ''; }
  if (!sha) { run('fetch', '--depth', '1', 'origin', ref); sha = run('rev-parse', 'FETCH_HEAD'); }
  const dir = 'v2-ref-' + ref.replace(/[^A-Za-z0-9._-]+/g, '_');
  fs.rmSync(path.join(REPO, dir), { recursive: true, force: true });
  const tar = execFileSync('git', ['archive', '--format=tar', `--prefix=${dir}/`, `${sha}:v2`], { cwd: REPO, maxBuffer: 1 << 30 });
  execFileSync('tar', ['-x', '-C', REPO], { input: tar, maxBuffer: 1 << 30 });
  console.log(`ref ${ref} = ${sha.slice(0, 10)} -> /${dir}/`);
  return dir;
}
const REFS = (typeof RARG === 'string' ? RARG : '.').split('|').map((r) => ({ ref: r, dir: refFolder(r) }));
const VARIANTS = REFS.flatMap((r) => QS.map((q) => ({ ...r, q, name: [REFS.length > 1 ? r.ref : '', q].filter(Boolean).join(' ') || '(default)' })));
const ARM = process.argv.includes('--phone')
  ? { name: 'phone 390x844@3, CPU x4', w: 390, h: 844, dpr: 3, cpu: 4, mobile: true }
  : { name: 'desktop 1440x900@2, CPU x1', w: 1440, h: 900, dpr: 2, cpu: 1, mobile: false };

const browser = await launch(chromium, { args: [...HW_ARGS, ...(UNCAPPED ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [])], maxMs: 1500000 });
const rec = {};
let renderer = '';
for (let rep = 0; rep < REPS; rep++) {
  const order = VARIANTS.map((_, i) => VARIANTS[(i + rep) % VARIANTS.length]);
  for (const variant of order) {
    const ctx = await browser.newContext({ viewport: { width: ARM.w, height: ARM.h }, deviceScaleFactor: ARM.dpr, isMobile: ARM.mobile, hasTouch: ARM.mobile });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    if (ARM.cpu > 1) { const c = await ctx.newCDPSession(page); await c.send('Emulation.setCPUThrottlingRate', { rate: ARM.cpu }); }
    // the recorder is installed before the app runs, so the first flying frame is caught
    await page.addInitScript(() => {
      const R = window.__flightRec = { dts: [], scales: [], last: 0, state: '', done: false };
      const tick = (now) => {
        const f = window.__v2 && window.__v2.intro && window.__v2.intro();
        const st = f ? f.state : '';
        if (st === 'flying') {
          if (R.last) { R.dts.push(now - R.last); const i = window.__v2.info(); R.scales.push(i.adapt ? i.adapt.scale : 1); }
          R.last = now;
          if (R.shadow0 == null) { const i = window.__v2.info(); R.shadow0 = i.shadow ? i.shadow.redraws : null; }
        } else if (R.last && (st === 'done' || st === 'cancelled')) { R.done = st; const i = window.__v2.info(); R.shadow1 = i.shadow ? i.shadow.redraws : null; R.size = i.size; return; }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.goto(`${BASE.replace(/\/$/, '')}/${variant.dir}/${variant.q ? '?' + variant.q : ''}`, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => window.__flightRec && window.__flightRec.done, null, { timeout: 180000, polling: 500 });
    if (!renderer) renderer = await page.evaluate(() => { const g = window.__v2.renderer.getContext(); const e = g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER); });
    const r = await page.evaluate(() => {
      const R = window.__flightRec, s = [...R.dts].sort((a, b) => a - b), sc = [...R.scales].sort((a, b) => a - b);
      return { n: s.length, median: s[s.length >> 1], p95: s[Math.floor(s.length * 0.95)], slow: R.dts.filter((d) => d > 50).length,
        scale: sc[sc.length >> 1], redraws: R.shadow0 == null ? null : R.shadow1 - R.shadow0, end: R.done, size: R.size };
    });
    (rec[variant.name] ||= []).push(r);
    if (errs.length) console.log('page errors:', errs.slice(0, 3));
    await ctx.close();
  }
}
await browser.close();
const f = (x) => (x == null ? 'n/a' : typeof x === 'number' ? x.toFixed(1) : String(x));
console.log(`renderer: ${renderer}`);
console.log(`instrument: ${ARM.name}; the opening flight, every frame from 'flying' to 'done'; ${UNCAPPED ? 'vsync and frame-rate limit OFF' : 'rAF at the 60 Hz cap'}; ${REPS} reps interleaved, min of per-rep medians`);
console.log('version/query | median ms (min) | p95 ms (min) | reps (median) | frames | frames > 50 ms | canvas scale (median) | shadow redraws | ended | canvas after');
for (const [k, rows] of Object.entries(rec)) {
  console.log(`${k} | ${f(Math.min(...rows.map((r) => r.median)))} | ${f(Math.min(...rows.map((r) => r.p95)))} | ${rows.map((r) => f(r.median)).join(' / ')} | ${rows.map((r) => r.n).join(' / ')} | ${rows.map((r) => r.slow).join(' / ')} | ${rows.map((r) => f(r.scale)).join(' / ')} | ${rows.map((r) => f(r.redraws)).join(' / ')} | ${rows.map((r) => r.end).join(' / ')} | ${rows[0].size ? rows[0].size.join('x') : ''}`);
}
if (/swiftshader/i.test(renderer)) { console.log('*FAIL: software renderer'); process.exit(1); }
