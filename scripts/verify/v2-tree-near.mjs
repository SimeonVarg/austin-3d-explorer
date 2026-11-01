/**
 * v2-tree-near.mjs - standing and walking under a tree (v2/trees.js nearShader, street-look.js TREE_LOOK.NEAR), A/B in ONE page load:
 * the old solid crowns (window.__v2trees.near(false)) vs the opened canopy (near(true)), interleaved at every frame.
 *
 *   VERIFY_GL=hardware VERIFY_URL=http://127.0.0.1:8099 node scripts/verify/v2-tree-near.mjs WALKS.json OUTDIR [query]
 *   WALKS.json: [{ name, from: [x, z], to: [x, z], eye: 1.6, look: [dx, dy, dz], fov: 60, steps: 48 }, ...]  (app coordinates)
 *
 * Each walk is a slow straight walk at eye height (steps frames), the view direction fixed. Every frame is drawn NATIVE and TRUTH
 * (3x3 supersampled, box-filtered), for both variants:
 *   shimmer = mean |native(t+1) - native(t)| - mean |truth(t+1) - truth(t)|  (8-bit luma, whole canvas; rule 15)
 *   pop     = the largest single-step native change / the median step change  (a crown popping open shows as a spike)
 * Saves OUTDIR/<walk>_<old|new>_<frame>.png for frames 0, 1/3, 2/3 and last, and prints one row per walk and variant.
 */
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { launch, BASE } from './chrome.mjs';

const [walksPath, outDir, query = ''] = process.argv.slice(2);
const WALKS = JSON.parse(fs.readFileSync(walksPath, 'utf8'));
fs.mkdirSync(outDir, { recursive: true });
const browser = await launch(chromium, { gl: process.env.VERIFY_GL || 'hardware', maxMs: 2400000 });
const ctx = await browser.newContext({ viewport: { width: 600, height: 400 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`${BASE.replace(/\/$/, '')}/${process.env.V2_DIR || 'v2'}/?intro=0&fade=0${query}`, { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction(() => window.__v2 && window.__v2.ready, null, { timeout: 180000 });
await page.evaluate(() => { window.cancelGraphicsAutoDetect?.(); return window.__v2.ready; });
await page.waitForFunction(() => window.__v2trees && window.__v2trees.stats().ready, null, { timeout: 120000 });
await page.addStyleTag({ content: 'body > *:not(canvas) { visibility: hidden !important; } canvas { visibility: visible !important; }' });
const renderer = await page.evaluate(() => { const g = window.__v2.renderer.getContext(); const e = g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : ''; });
const place = (p, look, fov) => page.evaluate(([p, look, fov]) => {
  const { THREE, camera, controls } = window.__v2;
  controls.update = () => false; controls.enabled = false;
  camera.fov = fov; camera.updateProjectionMatrix();
  if ('fovBase' in controls) { controls.fovBase = fov; controls.fovKickNow = 0; }
  camera.position.set(...p); camera.lookAt(p[0] + look[0], p[1] + look[1], p[2] + look[2]); camera.updateMatrixWorld();
  controls.focus.set(p[0], 0, p[2]); controls.target.set(p[0], 0, p[2]);
  window.__v2.redraw();
}, [p, look, fov]);
const rows = [];
for (const w of WALKS) {
  const at = (t) => [w.from[0] + (w.to[0] - w.from[0]) * t, w.eye || 1.6, w.from[1] + (w.to[1] - w.from[1]) * t];
  await place(at(0.5), w.look, w.fov || 60);
  let calm = 0; const t0 = Date.now();
  while (calm < 3 && Date.now() - t0 < 180000) { const s = await page.evaluate(() => window.__v2.tiles()); calm = s && s.loading === 0 && !s.fading ? calm + 1 : 0; await page.waitForTimeout(800); }
  await page.waitForTimeout(1500);
  const acc = { old: { dN: [], dT: [] }, new: { dN: [], dT: [] } };
  await page.evaluate(() => { window.__tnPrev = {}; });
  const keep = new Set([0, Math.round(w.steps / 3), Math.round(2 * w.steps / 3), w.steps - 1]);
  for (let f = 0; f < w.steps; f++) {
    await place(at(f / (w.steps - 1)), w.look, w.fov || 60);
    for (const v of ['old', 'new']) {
      const r = await page.evaluate((on) => {
        const { renderer, scene, camera } = window.__v2; window.__v2trees.near(on);
        const gl = renderer.getContext(), canvas = renderer.domElement, dpr = renderer.getPixelRatio(), W = canvas.clientWidth, H = canvas.clientHeight;
        const grab = (s) => {
          renderer.setPixelRatio(dpr * s); renderer.setSize(W, H, false); camera.updateMatrixWorld(); renderer.render(scene, camera);
          const gw = Math.round(W * dpr * s), gh = Math.round(H * dpr * s), px = new Uint8Array(gw * gh * 4); gl.readPixels(0, 0, gw, gh, gl.RGBA, gl.UNSIGNED_BYTE, px);
          const nw = Math.round(W * dpr), nh = Math.round(H * dpr), out = new Float32Array(nw * nh);
          for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) { let a = 0; for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) { const o = ((y * s + j) * gw + (x * s + i)) * 4; a += 0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2]; } out[y * nw + x] = a / (s * s); }
          return out;
        };
        const T = grab(3), N = grab(1);
        renderer.setPixelRatio(dpr); renderer.setSize(W, H, false);
        const mad = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
        const P = (window.__tnPrev = window.__tnPrev || {}), k = on ? 'new' : 'old', p = P[k];
        P[k] = { N, T };
        return p ? { dN: mad(N, p.N), dT: mad(T, p.T) } : null;
      }, v === 'new');
      if (r) { acc[v].dN.push(r.dN); acc[v].dT.push(r.dT); }
      if (keep.has(f)) { await page.evaluate((on) => { window.__v2trees.near(on); window.__v2.renderer.render(window.__v2.scene, window.__v2.camera); }, v === 'new'); await page.screenshot({ path: `${outDir}/${w.name}_${v}_${String(f).padStart(3, '0')}.png` }); }
    }
  }
  for (const v of ['old', 'new']) {
    const { dN, dT } = acc[v], med = [...dN].sort((a, b) => a - b)[dN.length >> 1];
    rows.push({ walk: w.name, v, shimmer: dN.reduce((a, b) => a + b, 0) / dN.length - dT.reduce((a, b) => a + b, 0) / dT.length, change: dN.reduce((a, b) => a + b, 0) / dN.length, pop: Math.max(...dN) / Math.max(med, 1e-3), maxStep: Math.max(...dN), steps: dN.map((x) => +x.toFixed(2)) });
  }
}
await browser.close();
console.log(`renderer: ${renderer}; 600x400 @2, truth 3x3; errors: ${JSON.stringify(errs.slice(0, 3))}`);
console.log('walk | variant | shimmer (native - truth step change) | mean step change | pop (max step / median step) | max step');
for (const r of rows) console.log(`${r.walk} | ${r.v} | ${r.shimmer.toFixed(3)} | ${r.change.toFixed(2)} | ${r.pop.toFixed(2)} | ${r.maxStep.toFixed(2)}`);
fs.writeFileSync(`${outDir}/walks.json`, JSON.stringify({ renderer, rows }, null, 1));
