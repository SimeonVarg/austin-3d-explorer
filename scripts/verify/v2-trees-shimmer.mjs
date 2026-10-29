/**
 * v2-trees-shimmer.mjs - does the tree layer flicker in a slow pan? (rule 15). The method of v2-shimmer.mjs, for trees:
 *
 *   VERIFY_GL=hardware VERIFY_URL=http://127.0.0.1:8099 node scripts/verify/v2-trees-shimmer.mjs [--q "trees=0|trees=real|"] [--frames 16] [--ss 3] [--out dir]
 *
 * Each frame of a slow orbit (0.15 degrees, the app's own measuring orbit) is drawn twice: NATIVE (the canvas at its pixel ratio, with
 * its own antialiasing) and TRUTH (SS x the pixel ratio, box-filtered back down). Over the whole canvas (the trees plus the city
 * behind them, identical in every variant):
 *   shimmer = mean |native(t+1) - native(t)| - mean |truth(t+1) - truth(t)|     (8-bit luma): frame-to-frame change the truth lacks
 *   alias   = mean |native - truth|     still-frame error;   soft = > 0 when native is softer than the truth (a blur "fix")
 * Run it over `trees=0` (no trees: the city's own floor), `` (today's balls) and `trees=real`: the trees' share is variant - floor.
 * Views sit over tree-dense ground (the South Mall, the Drag, Speedway) at 80 / 200 / 500 / 1000 m so every band is seen: near cards,
 * mid cards, impostors. Instrument: 800x500 at device scale 2 (canvas 1600x1000), tiles and fades settled first, REAL GPU only.
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { launch, BASE, HW_ARGS } from './chrome.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i < 0 ? d : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };
const FRAMES = +arg('--frames', 16), SS = +arg('--ss', 3), OUT = arg('--out', '');
const QS = String(arg('--q', 'trees=0|trees=real|')).split('|');
const VIEWS = [
  { name: 'South Mall 80 m', xz: [0, 130], distance: 80, polar: 76, azimuth: 20 },
  { name: 'South Mall 200 m', xz: [0, 130], distance: 200, polar: 74, azimuth: 20 },
  { name: 'Speedway 500 m', xz: [243, -420], distance: 500, polar: 76, azimuth: 200 },
  { name: 'Drag 1000 m', xz: [-235, 30], distance: 1000, polar: 78, azimuth: 250 },
  // street level, along the sidewalks and curbs (v2/street-look.js SIDEWALK_LOOK; --views street): Rio Grande at 24th, Congress at 6th
  { name: 'street Rio Grande 45 m', xz: [-515, -213], distance: 45, polar: 80, azimuth: 355 },
  { name: 'street Congress 45 m', xz: [-335, 1997], distance: 45, polar: 80, azimuth: 342 },
].filter((v) => !arg('--views', '') || String(arg('--views', '')).split(';').some((s) => v.name.includes(s)));
const browser = await launch(chromium, { args: HW_ARGS, maxMs: 2400000 });
const rows = []; let renderer = '';
for (const q of QS) {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 500 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('page error:', e.message));
  await page.goto(`${BASE.replace(/\/$/, '')}/${process.env.V2_DIR || 'v2'}/?intro=0${q ? '&' + q : ''}`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__v2 && window.__v2.ready, null, { timeout: 120000 });
  await page.evaluate(() => window.__v2.ready);
  if (!renderer) renderer = await page.evaluate(() => { const g = window.__v2.renderer.getContext(); const e = g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER); });
  for (const v of VIEWS) {
    await page.evaluate(([x, z, d, p, a]) => window.__v2.placeCamera({ target: [x, 0, z], distance: d, polarDeg: p, azimuthDeg: a }), [v.xz[0], v.xz[1], v.distance, v.polar, v.azimuth]);
    let calm = 0; const t0 = Date.now();
    while (calm < 3 && Date.now() - t0 < 180000) {
      const s = await page.evaluate(() => { window.__v2.redraw(); const g = window.__v2ground && window.__v2ground.stats(); return { t: window.__v2.tiles(), g, tr: window.__v2trees && window.__v2trees.stats() }; });
      const groundCalm = !s.g || s.g.failed || (s.g.index && s.g.missing === 0 && s.g.loading === 0 && s.g.waitingUpload === 0);
      calm = s.t && s.t.loading === 0 && !s.t.fading && groundCalm && (!s.tr || s.tr.ready || s.tr.error) ? calm + 1 : 0; await page.waitForTimeout(700);
    }
    await page.waitForTimeout(1200);
    const r = await page.evaluate(({ frames, SS }) => {
      const { renderer, scene, camera, controls, THREE } = window.__v2;
      const gl = renderer.getContext(), canvas = renderer.domElement, dpr = renderer.getPixelRatio();
      const W = canvas.clientWidth, H = canvas.clientHeight;
      const grab = (scale) => {
        renderer.setPixelRatio(dpr * scale); renderer.setSize(W, H, false);
        camera.updateMatrixWorld(); renderer.render(scene, camera);
        const k = dpr * scale, gw = Math.round(W * k), gh = Math.round(H * k);
        const px = new Uint8Array(gw * gh * 4); gl.readPixels(0, 0, gw, gh, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const nw = Math.round(W * dpr), nh = Math.round(H * dpr), out = new Float32Array(nw * nh), s = scale;
        for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
          let acc = 0;
          for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) { const o = ((y * s + j) * gw + (x * s + i)) * 4; acc += 0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2]; }
          out[y * nw + x] = acc / (s * s);
        }
        return { L: out, w: nw, h: nh };
      };
      const blur = (F) => { const o = new Float32Array(F.L.length); for (let y = 0; y < F.h; y++) for (let x = 0; x < F.w; x++) { let a = 0, n = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const xx = x + i, yy = y + j; if (xx >= 0 && yy >= 0 && xx < F.w && yy < F.h) { a += F.L[yy * F.w + xx]; n++; } } o[y * F.w + x] = a / n; } return { L: o }; };
      const mad = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
      const off = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
      let prevN = null, prevT = null, dN = 0, dT = 0, alias = 0, soft = 0, first = null, prevMask = null, mN = 0, mT = 0, mCount = 0, shareSum = 0;
      const trees = window.__v2trees && window.__v2trees.group;
      const info0 = window.__v2.info(), tr = window.__v2treesReal && window.__v2treesReal.stats();
      for (let f = 0; f < frames; f++) {
        if (f) { off.copy(camera.position).sub(controls.target).applyAxisAngle(up, THREE.MathUtils.degToRad(0.15)); camera.position.copy(controls.target).add(off); camera.lookAt(controls.target); }
        const N = grab(1), T = grab(SS);
        // the tree pixels: where the frame differs from the same frame with the tree layer hidden
        let mask = null;
        if (trees) { trees.visible = false; const N0 = grab(1); trees.visible = true; mask = new Uint8Array(N.L.length); let c = 0; for (let i = 0; i < mask.length; i++) if (Math.abs(N.L[i] - N0.L[i]) > 10) { mask[i] = 1; c++; } shareSum += c / mask.length; }
        alias += mad(N.L, T.L); soft += mad(blur(T).L, T.L) - mad(blur(N).L, N.L);
        if (prevN) {
          dN += mad(N.L, prevN.L); dT += mad(T.L, prevT.L);
          if (mask && prevMask) for (let i = 0; i < mask.length; i++) if (mask[i] && prevMask[i]) { mN += Math.abs(N.L[i] - prevN.L[i]); mT += Math.abs(T.L[i] - prevT.L[i]); mCount++; }
        }
        if (!first) first = { N };
        prevN = N; prevT = T; prevMask = mask;
      }
      renderer.setPixelRatio(dpr); renderer.setSize(W, H, false); window.__v2.redraw();
      return { shimmer: (dN - dT) / (frames - 1), nativeChange: dN / (frames - 1), truthChange: dT / (frames - 1), alias: alias / frames, soft: soft / frames, bands: tr && { near: tr.near, mid: tr.mid, far: tr.far }, treeShimmer: mCount ? (mN - mT) / mCount : null, treeChange: mCount ? mN / mCount : null, treeShare: shareSum / frames };
    }, { frames: FRAMES, SS });
    rows.push({ q: q || '(today)', view: v.name, ...r });
  }
  await ctx.close();
}
await browser.close();
const f = (x) => x.toFixed(2);
console.log(`renderer: ${renderer}`);
console.log(`instrument: 800x500 @2 (canvas 1600x1000), ${FRAMES} frames of orbit at 0.15 deg/frame, truth = ${SS}x${SS} supersample box-filtered; 8-bit luma over the whole canvas`);
console.log('query | view | shimmer (native change - truth change) | native change | truth change | alias | soft (>0: native softer than truth) | tree bands in view (near/mid/far) | shimmer INSIDE the tree pixels (native - truth change, 8-bit luma) | native change inside | tree share of the canvas');
for (const r of rows) console.log(`${r.q} | ${r.view} | ${f(r.shimmer)} | ${f(r.nativeChange)} | ${f(r.truthChange)} | ${f(r.alias)} | ${f(r.soft)} | ${r.bands ? [r.bands.near, r.bands.mid, r.bands.far].join('/') : '-'} | ${r.treeShimmer == null ? '-' : f(r.treeShimmer)} | ${r.treeChange == null ? '-' : f(r.treeChange)} | ${(100 * r.treeShare).toFixed(0)} %`);
if (/swiftshader/i.test(renderer)) { console.log('*FAIL: software renderer'); process.exit(1); }
