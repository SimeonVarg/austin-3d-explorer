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
 *   - --q "aerial=0|" compares page queries (here: the aerial ground off, then on): every rep runs every variant on a fresh page,
 *     the order rotated each rep, so the A/B is interleaved. A view waits for the aerial ground too (window.__v2ground) when it is there.
 *   - --refs "main|." compares app VERSIONS on one machine, interleaved like --q: each git ref's v2/ folder is extracted to
 *     v2-ref-<ref>/ beside v2/ (so its ../data and ../js are this checkout's) and loaded as its own page; "." is this checkout's v2/.
 *     A ref this clone does not hold is fetched from origin (depth 1). --refs and --q combine (every ref x every query).
 *   - memory, per view: GPU buffers = the bytes of every geometry attribute and index and every texture in the scene, counted from
 *     three.js's own objects (what the page has handed the GPU, not a driver reading); JS heap = performance.memory.usedJSHeapSize.
 *   - The v2 app has no graphics auto-detect probe (that is the old app's `cancelGraphicsAutoDetect`), so there is nothing to cancel.
 */
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, BASE, HW_ARGS } from './chrome.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i < 0 ? d : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };
const UNCAPPED = process.argv.includes('--uncapped');
const REPS = +arg('--reps', 3), MS = +arg('--ms', 4000);
const QARG = arg('--q', '');
const QS = (typeof QARG === 'string' ? QARG : '').split('|');
const RARG = arg('--refs', '.');
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// a git ref -> the served folder holding that ref's v2/ (extracted once per run)
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
const ARMS = [
  { name: 'desktop 1440x900@2, CPU x1', w: 1440, h: 900, dpr: 2, cpu: 1, mobile: false },
  { name: 'phone 390x844@3, CPU x4', w: 390, h: 844, dpr: 3, cpu: 4, mobile: true },
];
const VIEWS = [
  { name: 'opening view', pose: null },
  { name: 'DKR close', slug: 'dkr-memorial-stadium', distance: 330, polar: 58, azimuth: 235 },
  { name: 'West Campus (The Venue)', slug: 'the-venue', distance: 380, polar: 55, azimuth: 30 },
  { name: 'street level (Guadalupe at 21st)', xz: [-252, 246], distance: 45, polar: 80, azimuth: 355 },
  { name: 'DKR from 2 km', slug: 'dkr-memorial-stadium', distance: 2000, polar: 72, azimuth: 200 },
  { name: 'The Independent close', slug: 'the-independent', distance: 420, polar: 72, azimuth: 20 },
].filter((v) => !process.env.V2_FRAME_VIEWS || process.env.V2_FRAME_VIEWS.split('|').some((k) => v.name.includes(k)));
const args = [...HW_ARGS, ...(UNCAPPED ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [])];
const browser = await launch(chromium, { args, maxMs: 1500000 });
const rec = {};   // `${arm}|${view}` -> [{median,p95,calls,triangles}]
let renderer = '';
for (let rep = 0; rep < REPS; rep++) {
  const order = rep % 2 ? [...ARMS].reverse() : ARMS;
  for (const arm of order) {
   const vorder = VARIANTS.map((_, i) => VARIANTS[(i + rep) % VARIANTS.length]);
   for (const variant of vorder) {
    const ctx = await browser.newContext({ viewport: { width: arm.w, height: arm.h }, deviceScaleFactor: arm.dpr, isMobile: arm.mobile, hasTouch: arm.mobile });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    if (arm.cpu > 1) { const c = await ctx.newCDPSession(page); await c.send('Emulation.setCPUThrottlingRate', { rate: arm.cpu }); }
    await page.goto(`${BASE.replace(/\/$/, '')}/${variant.dir}/?intro=0${variant.q ? '&' + variant.q : ''}`, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => window.__v2 && window.__v2.ready, null, { timeout: 120000 });
    await page.evaluate(() => window.__v2.ready);
    const man = await page.evaluate(() => fetch('./tiles/manifest.json').then((r) => r.json()));
    if (!renderer) renderer = await page.evaluate(() => { const g = window.__v2.renderer.getContext(); const e = g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER); });
    for (const v of VIEWS) {
      if (v.slug) { const b = man.buildings[v.slug]; await page.evaluate(([x, z, d, p, a]) => window.__v2.placeCamera({ target: [x, 0, z], distance: d, polarDeg: p, azimuthDeg: a }), [b.x, b.z, v.distance, v.polar, v.azimuth]); }
      if (v.xz) await page.evaluate(([x, z, d, p, a]) => window.__v2.placeCamera({ target: [x, 0, z], distance: d, polarDeg: p, azimuthDeg: a }), [v.xz[0], v.xz[1], v.distance, v.polar, v.azimuth]);
      let calm = 0; const t0 = Date.now();
      while (calm < 3 && Date.now() - t0 < 180000) {
        const s = await page.evaluate(() => { window.__v2.redraw(); const g = window.__v2ground && window.__v2ground.stats(); return { t: window.__v2.tiles(), g }; });
        const groundCalm = !s.g || s.g.failed || (s.g.index && s.g.missing === 0 && s.g.loading === 0 && s.g.waitingUpload === 0);
        calm = s.t && s.t.loading === 0 && groundCalm ? calm + 1 : 0; await page.waitForTimeout(700);
      }
      // a trial manifest with an exact tile: render its local probes once (as v2-exact.mjs does), so its glass is measured as drawn
      await page.evaluate(() => { const e = window.__v2.exact && window.__v2.exact(); if (e && e.tiles && e.probeMs == null) window.__v2.exactProbe(); });
      await page.waitForTimeout(1500);
      const m = await page.evaluate((ms) => window.__v2.measure(ms, 0.15), MS);
      // GPU-synchronous cost: 90 renders, each followed by a 1-pixel read that waits for the GPU (an uncapped rAF only times the CPU's submit rate).
      // The sun's shadow map is not refreshed here (the app refreshes it only in whole texel steps), so this is the steady-state frame.
      const sync = await page.evaluate((n) => {
        const { renderer, scene, camera, controls, THREE } = window.__v2; const gl = renderer.getContext(); const px = new Uint8Array(4); const ts = [];
        const off = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
        for (let i = 0; i < n; i++) {
          off.copy(camera.position).sub(controls.target).applyAxisAngle(up, THREE.MathUtils.degToRad(0.15)); camera.position.copy(controls.target).add(off); camera.lookAt(controls.target); camera.updateMatrixWorld();
          const t = performance.now(); renderer.render(scene, camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); ts.push(performance.now() - t);
        }
        ts.sort((a, b) => a - b); return { median: ts[n >> 1], p95: ts[Math.floor(n * 0.95)] };
      }, 90);
      const mem = await page.evaluate(() => {
        const { scene } = window.__v2; const seen = new Set(), seenT = new Set(); let geo = 0, tex = 0;
        const attr = (a) => { if (!a) return; const d = a.data || a; if (seen.has(d)) return; seen.add(d); geo += d.array ? d.array.byteLength : 0; };
        scene.traverse((o) => {
          if (o.geometry) { for (const a of Object.values(o.geometry.attributes)) attr(a); attr(o.geometry.index); }
          if (o.isInstancedMesh) { attr(o.instanceMatrix); attr(o.instanceColor); }
          for (const m of o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []) for (const k in m) { const t = m[k]; if (t && t.isTexture && !seenT.has(t)) { seenT.add(t); const im = t.image || {}; tex += (im.width || 0) * (im.height || 0) * 4 * (t.generateMipmaps !== false ? 4 / 3 : 1); } }
        });
        const t = window.__v2.tiles && window.__v2.tiles();
        return { gpuMB: (geo + tex) / 1048576, geoMB: geo / 1048576, texMB: tex / 1048576, heapMB: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null,
          lod: t ? `${t.lod0}/${t.lod1 || 0}` : '' };
      });
      (rec[`${arm.name}|${variant.name}|${v.name}`] ||= []).push({ sync, mem, median: m.medianFrameMs, p95: m.p95FrameMs, cpu: m.medianRenderCallMs, calls: m.calls, triangles: m.triangles, frames: m.frames, size: m.size });
    }
    if (errs.length) console.log('page errors:', errs.slice(0, 3));
    await ctx.close();
   }
  }
}
await browser.close();
const f = (x) => (x == null ? 'n/a' : x.toFixed(1));
console.log(`renderer: ${renderer}`);
console.log(`instrument: ${UNCAPPED ? 'vsync and frame-rate limit OFF (real cost per frame)' : 'rAF at the 60 Hz cap (16.7 ms floor)'}; ${REPS} reps, arms rotated, ${MS} ms orbit at 0.15 deg/frame, min of per-rep medians`);
console.log('arm | version/query | view | rAF min median ms | rAF min p95 ms | rAF reps (medians) | GPU-synced render min median ms (p95) | draw calls | triangles | tiles full/far | GPU buffers MB (geometry + textures), max over reps | JS heap MB, max | canvas');
for (const [k, rows] of Object.entries(rec)) {
  const [arm, variant, view] = k.split('|');
  const mx = (g) => Math.max(...rows.map(g).filter((x) => x != null));
  console.log(`${arm} | ${variant} | ${view} | ${f(Math.min(...rows.map((r) => r.median)))} | ${f(Math.min(...rows.map((r) => r.p95)))} | ${rows.map((r) => f(r.median)).join(' / ')} | ${f(Math.min(...rows.map((r) => r.sync.median)))} (${f(Math.min(...rows.map((r) => r.sync.p95)))}; reps ${rows.map((r) => f(r.sync.median)).join(' / ')}) | ${rows[0].calls} | ${rows[0].triangles} | ${rows[0].mem.lod} | ${f(mx((r) => r.mem.gpuMB))} (${f(mx((r) => r.mem.geoMB))} + ${f(mx((r) => r.mem.texMB))}) | ${f(mx((r) => r.mem.heapMB))} | ${rows[0].size.join('x')}`);
}
if (/swiftshader/i.test(renderer)) { console.log('*FAIL: software renderer'); process.exit(1); }
