/**
 * v2-split.mjs - what each new layer (real trees, real glass, the moment's sky) costs.
 *
 *   VERIFY_GL=hardware VERIFY_URL=http://127.0.0.1:8611 node scripts/verify/v2-split.mjs \
 *       --variants "v2-ref-origin_main:moment=IMG_1778|v2:moment=IMG_1778&trees=real|v2:moment=IMG_1778&trees=real&groundshade=0" [--reps 3]
 *
 * Each variant is a page (folder:query); the pages are loaded in turn, the order rotated each rep (interleaved), min of reps reported.
 * Inside each page (rule 13: load once, test many) these in-page states are timed, interleaved too:
 *   all      - the page as loaded
 *   -trees   - the real trees (and their shadow proxy) hidden, the plain ball trees shown instead (= main's trees)
 *   -glass   - every real-glass material swapped for a plain copy of itself (no per-pane shader)
 *   -dome    - the visible sky dome hidden (its own pass)
 * (--states all, or V2_SPLIT_STATES="all", to time the page alone.) Things compiled into every shader (the moment's ground shade) need a page variant.
 * Instrument: arms desktop 1440x900@2 CPU x1 and phone 390x844@3 CPU x4 (as v2-frame.mjs); ?adapt=0 so every page and state draws the
 * same canvas; each measurement puts the camera at the view's pose, draws 8 frames, then times N renders each followed by a 1-pixel
 * read (GPU-synced), turning 0.15 deg a frame, the same N poses for every state; the shadow map is redrawn once before each run.
 * And the page's own CPU cost per frame (rAF, uncapped) during a 2 s orbit from the same pose (--raf).
 */
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, BASE, HW_ARGS } from './chrome.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i < 0 ? d : process.argv[i + 1]; };
// a folder "@REF" is that git ref's v2/, extracted beside v2/ as v2-ref-REF/ (as v2-frame.mjs --refs; fetched from origin if missing)
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
function refFolder(ref) {
  const run = (...a) => execFileSync('git', a, { cwd: REPO, encoding: 'utf8' }).trim();
  let sha = '';
  try { sha = run('rev-parse', '--verify', '--quiet', ref + '^{commit}'); } catch (e) { sha = ''; }
  if (!sha) { run('fetch', '--depth', '1', 'origin', ref); sha = run('rev-parse', 'FETCH_HEAD'); }
  const dir = 'v2-ref-' + ref.replace(/[^A-Za-z0-9._-]+/g, '_');
  fs.rmSync(path.join(REPO, dir), { recursive: true, force: true });
  const tar = execFileSync('git', ['archive', '--format=tar', `--prefix=${dir}/`, `${sha}:v2`], { cwd: REPO, maxBuffer: 1 << 30 });
  execFileSync('tar', ['-x', '-C', REPO], { input: tar, maxBuffer: 1 << 30 });
  if (fs.existsSync(path.join(REPO, 'v2/tiles-exact'))) fs.cpSync(path.join(REPO, 'v2/tiles-exact'), path.join(REPO, dir, 'tiles-exact'), { recursive: true });   // the private trial tile, when this machine has it
  console.log(`ref ${ref} = ${sha.slice(0, 10)} -> /${dir}/`);
  return dir;
}
const VARIANTS = arg('--variants', 'v2:moment=IMG_1778&trees=real&manifest=./tiles-exact/manifest.json').split('|').map((s) => { const i = s.indexOf(':'); const d = s.slice(0, i); return { dir: d.startsWith('@') ? refFolder(d.slice(1)) : d, q: s.slice(i + 1) }; });
const REPS = +arg('--reps', 3), N = +arg('--n', 40), RAF = process.argv.includes('--raf');
const ARMS = [
  { name: 'desktop', w: 1440, h: 900, dpr: 2, cpu: 1, mobile: false },
  { name: 'phone', w: 390, h: 844, dpr: 3, cpu: 4, mobile: true },
].filter((a) => !process.env.V2_FRAME_ARMS || process.env.V2_FRAME_ARMS.split(/[|;]/).some((k) => a.name.includes(k)));
const VIEWS = [
  { name: 'opening', target: [-260, 0, 60], distance: 1350, polar: 56, azimuth: 28 },
  { name: 'street', xz: [-252, 246], distance: 45, polar: 80, azimuth: 355 },
  { name: 'independent', slug: 'the-independent', distance: 420, polar: 72, azimuth: 20 },
  { name: 'drag300', xz: [-235, 30], distance: 300, polar: 60, azimuth: 250 },
  { name: 'southmall', xz: [0, 110], distance: 50, polar: 80, azimuth: 0 },
].filter((v) => !process.env.V2_FRAME_VIEWS || process.env.V2_FRAME_VIEWS.split(/[|;]/).some((k) => v.name.includes(k)));
const STATES = (arg('--states', '') || process.env.V2_SPLIT_STATES || 'all|-trees|-glass|-dome').split('|');
const browser = await launch(chromium, { args: [...HW_ARGS, '--disable-gpu-vsync', '--disable-frame-rate-limit'], maxMs: +process.env.VERIFY_MAX_MS || 3300000 });
const rec = {};
let renderer = '';
for (let rep = 0; rep < REPS; rep++) for (const arm of rep % 2 ? [...ARMS].reverse() : ARMS) for (let vi = 0; vi < VARIANTS.length; vi++) {
  const variant = VARIANTS[(vi + rep) % VARIANTS.length], vname = `${variant.dir}:${variant.q}`;
  const ctx = await browser.newContext({ viewport: { width: arm.w, height: arm.h }, deviceScaleFactor: arm.dpr, isMobile: arm.mobile, hasTouch: arm.mobile });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  if (arm.cpu > 1) { const c = await ctx.newCDPSession(page); await c.send('Emulation.setCPUThrottlingRate', { rate: arm.cpu }); }
  await page.goto(`${BASE.replace(/\/$/, '')}/${variant.dir}/?intro=0&adapt=0${variant.q ? '&' + variant.q : ''}`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.__v2 && window.__v2.ready, null, { timeout: 180000 });
  await page.evaluate(() => window.__v2.ready);
  if (!renderer) renderer = await page.evaluate(() => { const g = window.__v2.renderer.getContext(); const e = g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : ''; });
  const man = await page.evaluate(() => fetch('./tiles/manifest.json').then((r) => r.json()));
  await page.evaluate(() => {
    const V = window.__v2, S = (window.__split = { glass: null });
    S.set = (st) => {
      if (!S.glass) { S.glass = []; V.scene.traverse((o) => { if (o.isMesh && !Array.isArray(o.material) && o.material && o.material.userData.v2GlassReal) S.glass.push({ o, real: o.material, plain: null }); }); }
      const T = window.__v2trees, R = window.__v2treesReal, off = (k) => st === '-' + k;
      if (R) { R.root.visible = !off('trees'); if (R.proxy) R.proxy.castShadow = !off('trees'); for (const o of T.group.children) if (o.name.startsWith('crowns') || o.name === 'trunks') o.visible = off('trees'); }
      for (const g of S.glass) { if (!g.plain) { g.plain = g.real.clone(); g.plain.userData = {}; } g.o.material = off('glass') ? g.plain : g.real; }
      const dome = V.scene.children.find((o) => o.isMesh && o.material && o.material.side === 1 && o.renderOrder === -10); if (dome) dome.visible = !off('dome');
    };
  });
  for (const v of VIEWS) {
    const b = v.slug ? man.buildings[v.slug] : null;
    const pose = { target: v.target || (b ? [b.x, 0, b.z] : [v.xz[0], 0, v.xz[1]]), distance: v.distance, polarDeg: v.polar, azimuthDeg: v.azimuth };
    await page.evaluate((p) => window.__v2.placeCamera(p), pose);
    let calm = 0; const t0 = Date.now();
    while (calm < 3 && Date.now() - t0 < 180000) {
      const s = await page.evaluate(() => { window.__v2.redraw(); const g = window.__v2ground && window.__v2ground.stats(); return { t: window.__v2.tiles(), g }; });
      const groundCalm = !s.g || s.g.failed || (s.g.index && s.g.missing === 0 && s.g.loading === 0 && s.g.waitingUpload === 0);
      calm = s.t && s.t.loading === 0 && groundCalm ? calm + 1 : 0; await page.waitForTimeout(700);
    }
    await page.evaluate(() => { const e = window.__v2.exact && window.__v2.exact(); if (e && e.tiles && e.probeMs == null) window.__v2.exactProbe(); });
    for (let si = 0; si < STATES.length; si++) {
      const st = STATES[(si + rep) % STATES.length];
      await page.evaluate((s) => window.__split.set(s), st);
      const r = await page.evaluate(([p, n]) => {
        const { renderer, scene, camera, controls, THREE } = window.__v2; const gl = renderer.getContext(); const px = new Uint8Array(4); const ts = [];
        window.__v2.placeCamera(p); camera.updateMatrixWorld();
        renderer.shadowMap.needsUpdate = true;
        for (let i = 0; i < 8; i++) renderer.render(scene, camera);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const off = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0); let tris = 0, calls = 0;
        for (let i = 0; i < n; i++) {
          off.copy(camera.position).sub(controls.target).applyAxisAngle(up, THREE.MathUtils.degToRad(0.15)); camera.position.copy(controls.target).add(off); camera.lookAt(controls.target); camera.updateMatrixWorld();
          const t = performance.now(); renderer.render(scene, camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); ts.push(performance.now() - t);
          tris = renderer.info.render.triangles; calls = renderer.info.render.calls;
        }
        ts.sort((a, b) => a - b); return { sync: ts[n >> 1], tris, calls, size: [renderer.domElement.width, renderer.domElement.height], treeMs: window.__v2treesReal ? window.__v2treesReal.stats().ms : null };
      }, [pose, N]);
      if (RAF) { await page.evaluate((p) => window.__v2.placeCamera(p), pose); const m = await page.evaluate(() => window.__v2.measure(2000, 0.15)); r.raf = m.medianFrameMs; r.cpu = m.medianRenderCallMs; }
      const k = `${arm.name}|${v.name}|${vname}|${st}`;
      (rec[k] ||= []).push(r);
      console.log(`rep ${rep + 1} | ${k} | sync ${r.sync.toFixed(1)} ms${r.raf != null ? ` | rAF ${r.raf.toFixed(2)} cpu ${r.cpu.toFixed(2)}` : ''} | calls ${r.calls} | tris ${r.tris} | treeUpd ${r.treeMs == null ? '-' : r.treeMs.toFixed(2)} | ${r.size.join('x')}`);
    }
  }
  if (errs.length) console.log('page errors:', errs.slice(0, 3));
  await ctx.close();
}
await browser.close();
console.log(`renderer: ${renderer}; adapt=0, vsync off; GPU-synced median of ${N} renders; min of ${REPS} interleaved reps`);
console.log('arm | view | page | state | GPU-synced min ms | rAF min ms | calls | triangles | canvas');
const f = (x) => (x == null || !isFinite(x) ? '-' : x.toFixed(1));
for (const [k, rows] of Object.entries(rec)) {
  const [arm, view, page, st] = k.split('|');
  console.log(`${arm} | ${view} | ${page} | ${st} | ${f(Math.min(...rows.map((r) => r.sync)))} | ${f(Math.min(...rows.map((r) => r.raf ?? Infinity)))} | ${rows[0].calls} | ${rows[0].tris} | ${rows[0].size.join('x')}`);
}
