/**
 * v2-glass-shimmer.mjs - does the per-pane glass look (v2/glass.js) flicker in a slow pan? Rule 15.
 *
 *   VERIFY_GL=hardware VERIFY_URL=http://127.0.0.1:8597 node scripts/verify/v2-glass-shimmer.mjs OUT.json "manifest=./tiles-exact/manifest-ao.json" [frames=24] [CLIPDIR]
 *
 * One page load. For each view (a glass tower from near, from the distance where its panes are a few pixels, and from far), the camera
 * pans 0.15 degrees a frame (the app's measuring pan), twice: with the per-pane look OFF (k=0, the glass as before) and ON (k=1).
 * Every frame is drawn NATIVE and TRUTH (3x the pixel ratio, box-filtered back down), as v2-sky-shimmer.mjs; in the truth the
 * per-pane fades decide by the native pixel's footprint, so the truth is the same picture sampled finely (a fair truth). Measured only where the
 * look changes the picture (pixels where k=0 and k=1 differ by more than 1 luma in the first truth frame):
 *   shimmer = mean |native(t+1) - native(t)| - mean |truth(t+1) - truth(t)|   (8-bit luma; the flicker the truth does not have)
 *   alias   = mean |native - truth|
 * Pass (rule 15): shimmer with the look ON is no more than with it OFF (+0.1).
 * With CLIPDIR: also writes a side-by-side clip (OFF | ON, native) of each view as JPEG frames, for a video.
 * Viewport 800x500 at device scale 2.
 */
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { launch, BASE } from './chrome.mjs';

const [out = 'v2-glass-shimmer.json', q = 'manifest=./tiles-exact/manifest-ao.json', framesArg = '24', clipDir] = process.argv.slice(2);
const FRAMES = +framesArg, SS = 3, CLIP = clipDir ? +(process.env.CLIP_FRAMES || 90) : 0;
// The Independent (app frame: x east, z south); camera [x, y, z] and the point it looks at
const T = [-1131, 0, 2019];
const VIEWS = [
  // where IMG_1778 was taken (near clip 60 m: past the bridge and the trees in front of the photographer)
  { name: 'near, The Independent from the street, 215 m', cam: [-1067, 2, 2225], at: [T[0], 100, T[2]], near: 60 },
  // looking north-west over Lady Bird Lake at downtown's glass towers from 300 m to 1 km (panes a few px to 20 px)
  { name: 'mid, downtown towers 0.3-1 km', cam: [T[0] + 640, 60, T[2] + 640], at: [T[0], 110, T[2]] },
  { name: 'far, downtown from 2 km', cam: [T[0] + 1400, 150, T[2] + 1450], at: [T[0], 110, T[2]] },
].filter((v) => !process.env.VIEWS || process.env.VIEWS.split('|').some((k) => v.name.includes(k)));
const browser = await launch(chromium, { gl: process.env.VERIFY_GL || 'hardware', maxMs: 1800000 });
const ctx = await browser.newContext({ viewport: { width: 800, height: 500 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`${BASE.replace(/\/$/, '')}/v2/?intro=0&fade=0&adapt=0&${q}`, { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction(() => window.__v2 && window.__v2.ready, null, { timeout: 180000 });
await page.evaluate(() => { window.cancelGraphicsAutoDetect?.(); return window.__v2.ready; });
const res = { query: q, frames: FRAMES, ss: SS, views: [] };
for (const v of VIEWS) {
  // put the camera there and let the tiles around it load (and the exact tile's probes render)
  await page.evaluate(([v]) => {
    const { camera, controls } = window.__v2;
    controls.update = () => false; controls.enabled = false;
    camera.fov = 40; if (!window.__near0) window.__near0 = camera.near; camera.near = v.near || window.__near0; camera.updateProjectionMatrix();
    camera.position.set(...v.cam); camera.lookAt(...v.at); camera.updateMatrixWorld();
    controls.focus.set(v.cam[0], 0, v.cam[2]); controls.target.set(...v.at);
    window.__v2.redraw();
  }, [v]);
  let calm = 0; const t0 = Date.now();
  while (calm < 3 && Date.now() - t0 < 180000) { const s = await page.evaluate(() => window.__v2.tiles()); calm = s && s.loading === 0 ? calm + 1 : 0; await page.waitForTimeout(800); }
  if (!res.probed) { const ex = await page.evaluate(() => window.__v2.exact && window.__v2.exact()); if (ex && ex.tiles) { await page.evaluate(() => window.__v2.exactProbe()); res.probed = true; } }
  await page.waitForTimeout(1500);
  const r = await page.evaluate(async ([v, FRAMES, SS]) => {
    const { THREE, camera, renderer, scene } = window.__v2;
    const pr = renderer.getPixelRatio(), W = renderer.domElement.width, H = renderer.domElement.height;
    const gl = renderer.getContext();
    const grab = (scale) => {
      window.__v2.glassReal(window.__glassK, scale);   // the truth decides its fades by the NATIVE pixel (same picture, finer samples)
      renderer.setPixelRatio(pr * scale);
      renderer.render(scene, camera);
      const w = renderer.domElement.width, h = renderer.domElement.height, px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const L = new Float32Array(W * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let s = 0;
        for (let j = 0; j < scale; j++) for (let i = 0; i < scale; i++) {
          const k = ((h - 1 - (y * scale + j)) * w + (x * scale + i)) * 4;
          s += 0.2126 * px[k] + 0.7152 * px[k + 1] + 0.0722 * px[k + 2];
        }
        L[y * W + x] = s / (scale * scale);
      }
      renderer.setPixelRatio(pr); window.__v2.glassReal(window.__glassK, 1);
      return L;
    };
    const dir0 = new THREE.Vector3(...v.at).sub(new THREE.Vector3(...v.cam));
    const aim = (f) => {
      const d = dir0.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(f * 0.15));
      camera.position.set(...v.cam); camera.lookAt(camera.position.clone().add(d)); camera.updateMatrixWorld();
    };
    // the mask: where the look changes the picture
    aim(0);
    window.__glassK = 0; const T0 = grab(SS);
    window.__glassK = 1; const T1 = grab(SS);
    const mask = new Uint8Array(W * H); let mN = 0;
    for (let i = 0; i < mask.length; i++) if (Math.abs(T0[i] - T1[i]) > 1) { mask[i] = 1; mN++; }
    const madM = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) if (mask[i]) s += Math.abs(a[i] - b[i]); return s / Math.max(mN, 1); };
    const out = { view: v.name, maskPx: mN, maskShare: +(mN / mask.length).toFixed(4) };
    for (const k of [0, 1]) {
      window.__glassK = k;
      let pn = null, pt = null, fl = 0, ft = 0, al = 0;
      for (let f = 0; f < FRAMES; f++) {
        aim(f);
        const N = grab(1), Tt = grab(SS);
        if (pn) { fl += madM(N, pn); ft += madM(Tt, pt); }
        al += madM(N, Tt);
        pn = N; pt = Tt;
      }
      out['k' + k] = { shimmer: +((fl - ft) / (FRAMES - 1)).toFixed(3), nativeChange: +(fl / (FRAMES - 1)).toFixed(3), truthChange: +(ft / (FRAMES - 1)).toFixed(3), alias: +(al / FRAMES).toFixed(3) };
    }
    window.__v2.glassReal(1); aim(0); window.__v2.redraw();
    return out;
  }, [v, FRAMES, SS]);
  r.pass = r.k1.shimmer <= r.k0.shimmer + 0.1;
  res.views.push(r); console.log(JSON.stringify(r));
  if (CLIP) {
    fs.mkdirSync(clipDir, { recursive: true });
    for (let f = 0; f < CLIP; f++) {
      const pair = await page.evaluate(([v, f]) => {
        const { THREE, camera, renderer, scene } = window.__v2;
        const d = new THREE.Vector3(...v.at).sub(new THREE.Vector3(...v.cam)).applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(f * 0.15));
        camera.position.set(...v.cam); camera.lookAt(camera.position.clone().add(d)); camera.updateMatrixWorld();
        const shots = [];
        for (const k of [0, 1]) { window.__v2.glassReal(k); renderer.render(scene, camera); shots.push(renderer.domElement.toDataURL('image/jpeg', 0.92)); }
        window.__v2.glassReal(1);
        return shots;
      }, [v, f]);
      pair.forEach((s, k) => fs.writeFileSync(`${clipDir}/${v.name.split(',')[0]}_k${k}_${String(f).padStart(3, '0')}.jpg`, Buffer.from(s.split(',')[1], 'base64')));
    }
  }
}
res.errors = errs.slice(0, 3);
fs.writeFileSync(out, JSON.stringify(res, null, 1));
await browser.close();
