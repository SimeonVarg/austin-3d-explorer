/**
 * v2-cost.mjs - where a v2 frame's time goes: the sun's shadow pass, pixels, shading, the Blender tiles, the CPU's submit.
 *
 *   VERIFY_GL=hardware VERIFY_URL=http://127.0.0.1:8099 node scripts/verify/v2-cost.mjs [--phone] [--reps 3] [--n 24] [--dir v2]
 *
 * Instrument (README: "an instrument's defaults are part of its answer"):
 *   - REAL GPU only (fails on SwiftShader). Each number is a GPU-synced render: renderer.render() then a 1-pixel readPixels that
 *     waits for the GPU; the median of --n renders, a slow 0.15 degree orbit between renders; MIN over --reps fresh pages.
 *   - arms: desktop 1440x900 at device scale 2 (canvas 2880x1800), CPU x1; --phone: 390x844 at scale 3 (canvas capped by the app), CPU x4.
 *   - conditions, all on the same page and pose, interleaved within each rep:
 *       full        the shadow map is redrawn on every render (what main did on every frame: three.js's shadow autoUpdate)
 *       cached      the shadow map is kept (redrawn only when the light box moves or a caster changes)
 *       cached-dpr1 cached, canvas at device pixel ratio 1 (a quarter of the pixels): the pixel-bound share
 *       cached-flat cached, every surface drawn with one unlit material: the shading share
 *       cached-notiles cached, the Blender tiles hidden: the tiles' share
 *       submit      cached, CPU time of render() alone, with no wait for the GPU
 *     draw calls and triangles are three.js's own count for one render (they include the shadow pass when it runs).
 */
import { chromium } from 'playwright-core';
import { launch, BASE, HW_ARGS } from './chrome.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i < 0 ? d : process.argv[i + 1]; };
const REPS = +arg('--reps', 3), N = +arg('--n', 24), DIR = arg('--dir', 'v2'), Q = arg('--q', '');
const ARM = process.argv.includes('--phone')
  ? { name: 'phone 390x844@3, CPU x4', w: 390, h: 844, dpr: 3, cpu: 4, mobile: true }
  : { name: 'desktop 1440x900@2, CPU x1', w: 1440, h: 900, dpr: 2, cpu: 1, mobile: false };
const VIEWS = [
  { name: 'opening view', pose: null },
  { name: 'street level (Guadalupe at 21st)', xz: [-252, 246], distance: 45, polar: 80, azimuth: 355 },
  { name: 'DKR close', slug: 'dkr-memorial-stadium', distance: 330, polar: 58, azimuth: 235 },
];
const CONDS = ['full', 'cached', 'cached-dpr1', 'cached-flat', 'cached-notiles', 'submit'];

const browser = await launch(chromium, { args: [...HW_ARGS], maxMs: 1500000 });
const rec = {};
let renderer = '';
for (let rep = 0; rep < REPS; rep++) {
  const ctx = await browser.newContext({ viewport: { width: ARM.w, height: ARM.h }, deviceScaleFactor: ARM.dpr, isMobile: ARM.mobile, hasTouch: ARM.mobile });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  if (ARM.cpu > 1) { const c = await ctx.newCDPSession(page); await c.send('Emulation.setCPUThrottlingRate', { rate: ARM.cpu }); }
  await page.goto(`${BASE.replace(/\/$/, '')}/${DIR}/?intro=0&fade=0${Q ? '&' + Q : ''}`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__v2 && window.__v2.ready, null, { timeout: 120000 });
  await page.evaluate(() => window.__v2.ready);
  const man = await page.evaluate(() => fetch('./tiles/manifest.json').then((r) => r.json()));
  if (!renderer) renderer = await page.evaluate(() => { const g = window.__v2.renderer.getContext(); const e = g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER); });
  for (const v of VIEWS) {
    const pose = v.slug ? [man.buildings[v.slug].x, man.buildings[v.slug].z, v.distance, v.polar, v.azimuth] : v.xz ? [v.xz[0], v.xz[1], v.distance, v.polar, v.azimuth] : null;
    if (pose) await page.evaluate(([x, z, d, p, a]) => window.__v2.placeCamera({ target: [x, 0, z], distance: d, polarDeg: p, azimuthDeg: a }), pose);
    let calm = 0; const t0 = Date.now();
    while (calm < 3 && Date.now() - t0 < 180000) {
      const s = await page.evaluate(() => { window.__v2.redraw(); const g = window.__v2ground && window.__v2ground.stats(); return { t: window.__v2.tiles(), g }; });
      const groundCalm = !s.g || s.g.failed || (s.g.index && s.g.missing === 0 && s.g.loading === 0 && s.g.waitingUpload === 0);
      calm = s.t && s.t.loading === 0 && groundCalm ? calm + 1 : 0; await page.waitForTimeout(700);
    }
    await page.waitForTimeout(1500);
    const order = CONDS.map((_, i) => CONDS[(i + rep) % CONDS.length]);
    for (const cond of order) {
      const r = await page.evaluate(([cond, n]) => {
        const { renderer, scene, camera, controls, THREE } = window.__v2;
        const gl = renderer.getContext(), px = new Uint8Array(4), ts = [];
        const sun = scene.children.find((o) => o.isDirectionalLight);
        const tiles = scene.children.find((o) => o.name === 'blender-tiles');
        const dpr0 = renderer.getPixelRatio(), size = renderer.getSize(new THREE.Vector2());
        const auto0 = sun.shadow.autoUpdate;
        const flat = new THREE.MeshBasicMaterial({ color: 0x808080 });
        if (cond === 'cached-dpr1') { renderer.setPixelRatio(1); renderer.setSize(size.x, size.y, false); }
        if (cond === 'cached-flat') scene.overrideMaterial = flat;
        if (cond === 'cached-notiles' && tiles) tiles.visible = false;
        const off = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
        // one warm-up render with the shadow drawn, so every condition starts from a current shadow map
        sun.shadow.needsUpdate = true; renderer.render(scene, camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        sun.shadow.autoUpdate = cond === 'full';
        let calls = 0, tris = 0;
        for (let i = 0; i < n; i++) {
          off.copy(camera.position).sub(controls.target).applyAxisAngle(up, THREE.MathUtils.degToRad(0.15)); camera.position.copy(controls.target).add(off); camera.lookAt(controls.target); camera.updateMatrixWorld();
          const t = performance.now(); renderer.render(scene, camera);
          if (cond === 'submit') { ts.push(performance.now() - t); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
          else { gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); ts.push(performance.now() - t); }
          calls = renderer.info.render.calls; tris = renderer.info.render.triangles;
        }
        sun.shadow.autoUpdate = auto0; scene.overrideMaterial = null; flat.dispose(); if (tiles) tiles.visible = true;
        if (cond === 'cached-dpr1') { renderer.setPixelRatio(dpr0); renderer.setSize(size.x, size.y, false); }
        ts.sort((a, b) => a - b);
        return { median: ts[n >> 1], calls, tris, canvas: [renderer.domElement.width, renderer.domElement.height] };
      }, [cond, N]);
      (rec[`${v.name}|${cond}`] ||= []).push(r);
    }
  }
  if (errs.length) console.log('page errors:', errs.slice(0, 3));
  await ctx.close();
}
await browser.close();
const f = (x) => (x == null ? 'n/a' : x.toFixed(1));
console.log(`renderer: ${renderer}`);
console.log(`instrument: ${ARM.name}; /${DIR}/${Q ? ' ?' + Q : ''}; GPU-synced render (readPixels), median of ${N}, MIN over ${REPS} fresh pages; conditions interleaved`);
console.log('view | condition | ms (min of medians) | reps | draw calls | triangles | canvas');
for (const [k, rows] of Object.entries(rec)) {
  const [view, cond] = k.split('|');
  console.log(`${view} | ${cond} | ${f(Math.min(...rows.map((r) => r.median)))} | ${rows.map((r) => f(r.median)).join(' / ')} | ${rows[0].calls} | ${rows[0].tris} | ${rows[0].canvas.join('x')}`);
}
if (/swiftshader/i.test(renderer)) { console.log('*FAIL: software renderer'); process.exit(1); }
