/**
 * v2-ground-shimmer.mjs - does the drawn ground near the camera flicker in motion? The A/B of one ground layer in ONE page load.
 *
 *   VERIFY_GL=hardware VERIFY_URL=http://127.0.0.1:8099 node scripts/verify/v2-ground-shimmer.mjs [--frames 16] [--ss 3] [--reps 2] [--out dir]
 *
 * Rule 15. v2-shimmer.mjs measures a building's box; this measures the GROUND below the horizon, with the real drawn ground (v2/ground-near.js),
 * and flips the aerial lawns and beds (scripts/v2/ground_veg.py) on and off in place (window.__v2groundNear.setVeg), so on and off share
 * the page, the tiles, the camera and the GPU state. Per view and setting: the camera orbits its target 0.15 degrees a frame; each
 * frame is drawn NATIVE and TRUTH (SS x supersampled, box-filtered down);
 *   shimmer = mean |native(t+1) - native(t)| - mean |truth(t+1) - truth(t)|   (8-bit luma, ground rows only)
 *   soft    = mean |blur(truth) - truth| - mean |blur(native) - native|   (> 0: native softer than truth; blur is not a fix)
 * on and off are interleaved (on, off, off, on, ...) and each takes the minimum of --reps runs. Gate: on <= off + 0.02 in every view.
 * Instrument: 800x500 at device scale 2 (the owner's Mac density); real GPU only.
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { launch, BASE, HW_ARGS } from './chrome.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i < 0 ? d : process.argv[i + 1]; };
const FRAMES = +arg('--frames', 16), SS = +arg('--ss', 3), REPS = +arg('--reps', 2), OUT = arg('--out', ''), TOL = 0.02;
const VIEWS = [   // target on the ground, camera distance, polar (90 = level), azimuth (camera = target + d (sin p sin a, cos p, sin p cos a))
  { name: 'GDC lawn, eye 1.6 m, 30 m', target: [239.6, -44.2], distance: 30, polar: 86.94, azimuth: 250.7 },
  { name: 'campus oblique 120 m', target: [60, 120], distance: 120, polar: 72, azimuth: 200 },
  { name: 'campus oblique 250 m', target: [100, 100], distance: 250, polar: 74, azimuth: 135 },
];
const browser = await launch(chromium, { args: HW_ARGS, maxMs: 1800000 });
const ctx = await browser.newContext({ viewport: { width: 800, height: 500 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('page error:', e.message));
await page.goto(`${BASE.replace(/\/$/, '')}/${process.env.V2_DIR || 'v2'}/?intro=0`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__v2 && window.__v2.ready && window.__v2groundNear, null, { timeout: 120000 });
await page.evaluate(() => window.__v2.ready);
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
const renderer = await page.evaluate(() => { const g = window.__v2.renderer.getContext(); const e = g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : ''; });
const rows = [];
for (const v of VIEWS) {
  const place = () => page.evaluate((v) => window.__v2.placeCamera({ target: [v.target[0], 0, v.target[1]], distance: v.distance, polarDeg: v.polar, azimuthDeg: v.azimuth }), v);
  await place();
  let calm = 0; const t0 = Date.now(); let gs = null;
  while (calm < 3 && Date.now() - t0 < 180000) {
    const s = await page.evaluate(() => { window.__v2.redraw(); const g = window.__v2ground && window.__v2ground.stats(); return { t: window.__v2.tiles(), g, n: window.__v2groundNear.stats() }; });
    const groundCalm = !s.g || s.g.failed || (s.g.index && s.g.missing === 0 && s.g.loading === 0 && s.g.waitingUpload === 0);
    const nearCalm = !s.n.loading && (s.n.on === 1 || s.n.window == null);
    gs = s.n; calm = s.t && s.t.loading === 0 && !s.t.fading && groundCalm && nearCalm ? calm + 1 : 0; await page.waitForTimeout(700);
  }
  const order = [];
  for (let r = 0; r < REPS; r++) order.push(...(r % 2 ? [false, true] : [true, false]));
  for (const veg of order) {
    await place();
    await page.evaluate((on) => { window.__v2groundNear.setVeg(on); window.__v2.redraw(); }, veg);
    await page.waitForTimeout(400);
    const r = await page.evaluate(({ frames, SS }) => {
      const { renderer, scene, camera, controls, THREE } = window.__v2;
      const gl = renderer.getContext(), canvas = renderer.domElement, dpr = renderer.getPixelRatio();
      const W = canvas.clientWidth, H = canvas.clientHeight;
      // the ground rows: from the horizon (a ground point 3 km ahead) down to the bottom of the frame
      const fw = new THREE.Vector3(); camera.getWorldDirection(fw); fw.y = 0; fw.normalize();
      const hz = new THREE.Vector3(camera.position.x + fw.x * 3000, 0, camera.position.z + fw.z * 3000).project(camera);
      const y0 = Math.max(0, Math.min(H - 8, Math.ceil((1 - hz.y) / 2 * H) + 2)), x0 = 0, rw = W, rh = H - y0;
      const grab = (scale) => {
        renderer.setPixelRatio(dpr * scale); renderer.setSize(W, H, false);
        camera.updateMatrixWorld(); renderer.render(scene, camera);
        const k = dpr * scale, gx = Math.round(x0 * k), gy = 0, gw = Math.round(rw * k), gh = Math.round(rh * k);
        const px = new Uint8Array(gw * gh * 4); gl.readPixels(gx, gy, gw, gh, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const nw = Math.round(rw * dpr), nh = Math.round(rh * dpr), out = new Float32Array(nw * nh), s = scale;
        for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
          let acc = 0;
          for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) { const o = ((y * s + j) * gw + (x * s + i)) * 4; acc += 0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2]; }
          out[y * nw + x] = acc / (s * s);
        }
        return { L: out, w: nw, h: nh };
      };
      const blur = (F) => { const o = new Float32Array(F.L.length); for (let y = 0; y < F.h; y++) for (let x = 0; x < F.w; x++) { let a = 0, n = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const xx = x + i, yy = y + j; if (xx < 0 || yy < 0 || xx >= F.w || yy >= F.h) continue; a += F.L[yy * F.w + xx]; n++; } o[y * F.w + x] = a / n; } return o; };
      const mad = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
      const off = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
      let prevN = null, prevT = null, dN = 0, dT = 0, soft = 0, first = null, mean = 0;
      for (let f = 0; f < frames; f++) {
        if (f) { off.copy(camera.position).sub(controls.target).applyAxisAngle(up, THREE.MathUtils.degToRad(0.15)); camera.position.copy(controls.target).add(off); camera.lookAt(controls.target); }
        const N = grab(1), T = grab(SS);
        soft += mad(blur(T), T.L) - mad(blur(N), N.L); mean += N.L.reduce((a, b) => a + b, 0) / N.L.length;
        if (prevN) { dN += mad(N.L, prevN.L); dT += mad(T.L, prevT.L); }
        if (!first) first = N;
        prevN = N; prevT = T;
      }
      renderer.setPixelRatio(dpr); renderer.setSize(W, H, false); window.__v2.redraw();
      const png = (F) => { const cv = document.createElement('canvas'); cv.width = F.w; cv.height = F.h; const g = cv.getContext('2d'); const im = g.createImageData(F.w, F.h); for (let y = 0; y < F.h; y++) for (let x = 0; x < F.w; x++) { const v = F.L[(F.h - 1 - y) * F.w + x], o = (y * F.w + x) * 4; im.data[o] = im.data[o + 1] = im.data[o + 2] = v; im.data[o + 3] = 255; } g.putImageData(im, 0, 0); return cv.toDataURL('image/png'); };
      return { shimmer: (dN - dT) / (frames - 1), nativeChange: dN / (frames - 1), truthChange: dT / (frames - 1), soft: soft / frames, mean: mean / frames, rows: rh, png: png(first),
        near: window.__v2groundNear.stats() };
    }, { frames: FRAMES, SS });
    if (OUT) { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, `${v.name.replace(/[^A-Za-z0-9]+/g, '-')}--veg-${veg ? 'on' : 'off'}.png`), Buffer.from(r.png.split(',')[1], 'base64')); }
    rows.push({ view: v.name, veg, ...r, png: undefined });
  }
}
await browser.close();
const f = (x) => x.toFixed(3);
console.log(`renderer: ${renderer}`);
console.log(`instrument: 800x500 @2, ${FRAMES} frames of orbit at 0.15 deg/frame, truth ${SS}x${SS}; 8-bit luma of the ground rows (horizon to bottom); real drawn ground`);
console.log('view | veg | shimmer | native change | truth change | soft | mean luma | ground rows | near on / drawn features');
for (const r of rows) console.log(`${r.view} | ${r.veg ? 'on' : 'off'} | ${f(r.shimmer)} | ${f(r.nativeChange)} | ${f(r.truthChange)} | ${f(r.soft)} | ${r.mean.toFixed(1)} | ${r.rows} | ${r.near.on}/${r.near.drawn}`);
let ok = true;
for (const v of VIEWS) {
  const g = (on) => rows.filter((r) => r.view === v.name && r.veg === on);
  const on = Math.min(...g(true).map((r) => r.shimmer)), offv = Math.min(...g(false).map((r) => r.shimmer));
  const sOn = Math.max(...g(true).map((r) => r.soft)), sOff = Math.max(...g(false).map((r) => r.soft));
  const pass = on <= offv + TOL; ok &&= pass;
  console.log(`GATE ${v.name}: on ${f(on)} vs off ${f(offv)} (+${TOL}) soft on ${f(sOn)} off ${f(sOff)} -> ${pass ? 'PASS' : 'FAIL'}`);
}
if (/swiftshader/i.test(renderer)) { console.log('*FAIL: software renderer'); process.exit(1); }
console.log(ok ? 'ALL PASS' : 'FAIL'); process.exit(ok ? 0 : 1);
