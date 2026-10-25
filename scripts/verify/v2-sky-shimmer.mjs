/**
 * v2-sky-shimmer.mjs - does the moment's sky (v2/sky.js: the clouds, the sun's halo, the gradient) flicker in a slow pan? Rule 15.
 *
 *   VERIFY_GL=hardware VERIFY_URL=http://127.0.0.1:8591 node scripts/verify/v2-sky-shimmer.mjs OUT.json "moment=IMG_1778&cover=0.35" [frames=24]
 *
 * The method of v2-shimmer.mjs, on the sky: a street-level camera looking 12 degrees up turns 0.15 degrees a frame (the app's own
 * measuring pan); every frame is drawn twice in one synchronous pass, NATIVE (the canvas at its pixel ratio) and TRUTH (3x the pixel
 * ratio, box-filtered back down). In the sky (pixels the dome covers, here the upper 45 % of the frame):
 *   shimmer = mean |native(t+1) - native(t)| - mean |truth(t+1) - truth(t)|   (8-bit luma; the flicker the truth does not have)
 *   alias   = mean |native - truth|;  soft = mean |blur(truth) - truth| - mean |blur(native) - native| (> 0: native is softer)
 * Viewport 800x500 at device scale 2. Two views: looking toward the sun's side and away from it (azimuths from the moment's sun).
 */
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { launch, BASE } from './chrome.mjs';

const [out = 'v2-sky-shimmer.json', q = 'moment=IMG_1778', framesArg = '24'] = process.argv.slice(2);
const FRAMES = +framesArg, SS = 3;
const browser = await launch(chromium, { gl: process.env.VERIFY_GL || 'hardware', maxMs: 1800000 });
const ctx = await browser.newContext({ viewport: { width: 800, height: 500 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`${BASE.replace(/\/$/, '')}/v2/?intro=0&fade=0&adapt=0&${q}`, { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction(() => window.__v2 && window.__v2.ready, null, { timeout: 180000 });
await page.evaluate(() => window.__v2.ready);
await page.waitForTimeout(3000);
const res = { query: q, frames: FRAMES, ss: SS, views: [] };
for (const side of ['toward the sun', 'away from the sun']) {
  const r = await page.evaluate(async ([side, FRAMES, SS]) => {
    const { THREE, camera, controls, renderer, scene } = window.__v2;
    controls.update = () => false; controls.enabled = false;
    const m = window.__v2.moment(), az = (m ? m.az : 215) + (side === 'toward the sun' ? -35 : 145);
    camera.position.set(-260, 1.8, 60); camera.fov = 50; camera.updateProjectionMatrix();
    const pr = renderer.getPixelRatio(), W = renderer.domElement.width, H = renderer.domElement.height, rows = Math.floor(H * 0.45);
    const gl = renderer.getContext();
    const grab = (scale) => {
      renderer.setPixelRatio(pr * scale);
      renderer.render(scene, camera);
      const w = renderer.domElement.width, h = renderer.domElement.height, px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      // luma, box-filtered by `scale`, top rows only (readPixels is bottom-up)
      const L = new Float32Array(W * rows);
      for (let y = 0; y < rows; y++) for (let x = 0; x < W; x++) {
        let s = 0;
        for (let j = 0; j < scale; j++) for (let i = 0; i < scale; i++) {
          const k = ((h - 1 - (y * scale + j)) * w + (x * scale + i)) * 4;
          s += 0.2126 * px[k] + 0.7152 * px[k + 1] + 0.0722 * px[k + 2];
        }
        L[y * W + x] = s / (scale * scale);
      }
      renderer.setPixelRatio(pr);
      return L;
    };
    const blurDiff = (L) => { let s = 0, n = 0; for (let y = 1; y < rows - 1; y++) for (let x = 1; x < W - 1; x++) { const k = y * W + x; s += Math.abs((L[k - 1] + L[k + 1] + L[k - W] + L[k + W] + L[k]) / 5 - L[k]); n++; } return s / n; };
    const mad = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
    let pn = null, pt = null, fl = 0, ft = 0, al = 0, soft = 0, mean = 0;
    for (let f = 0; f < FRAMES; f++) {
      const yaw = THREE.MathUtils.degToRad(az + f * 0.15), pitch = THREE.MathUtils.degToRad(12);
      camera.lookAt(camera.position.x + Math.sin(yaw) * Math.cos(pitch), camera.position.y + Math.sin(pitch), camera.position.z - Math.cos(yaw) * Math.cos(pitch));
      camera.updateMatrixWorld();
      const N = grab(1), T = grab(SS);
      if (pn) { fl += mad(N, pn); ft += mad(T, pt); }
      al += mad(N, T); soft += blurDiff(T) - blurDiff(N);
      for (let i = 0; i < N.length; i += 97) mean += N[i] / Math.ceil(N.length / 97) / FRAMES;
      pn = N; pt = T;
    }
    window.__v2.redraw();
    return { side, azimuth: +az.toFixed(1), shimmer: +((fl - ft) / (FRAMES - 1)).toFixed(3), nativeChange: +(fl / (FRAMES - 1)).toFixed(3), truthChange: +(ft / (FRAMES - 1)).toFixed(3),
      alias: +(al / FRAMES).toFixed(3), soft: +(soft / FRAMES).toFixed(3), meanLuma: +mean.toFixed(1) };
  }, [side, FRAMES, SS]);
  res.views.push(r); console.log(JSON.stringify(r));
}
res.errors = errs.slice(0, 3);
fs.writeFileSync(out, JSON.stringify(res, null, 1));
await browser.close();
