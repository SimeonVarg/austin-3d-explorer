/**
 * v2-trees-look.mjs - one page load, several tree settings and views drawn in it (rule 13: load once, test many): the tree layer's
 * look for before/after sheets, plus its stats and any page error. REAL GPU only.
 *
 *   VERIFY_GL=hardware VERIFY_URL=http://127.0.0.1:8631 node scripts/verify/v2-trees-look.mjs OUT_DIR "PAGE_QUERY" [view ...]
 *   PAGE_QUERY: the v2 page's query (e.g. "moment=IMG_1778"); V2_DIR=folder for another copy of the app (default v2).
 *   Views: drag-eye (Guadalupe at 21st, eye height, looking north), southmall-eye, opening (the start view), aerial-300.
 *   Writes OUT_DIR/<view>.png (1440x900 at device scale 2; tiles settled; drawn twice, the second kept) and prints the trees' stats.
 */
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { launch, BASE, HW_ARGS } from './chrome.mjs';

const OUT = process.argv[2] || 'v2-trees-look';
const Q = process.argv[3] || '';
const ONLY = process.argv.slice(4);
fs.mkdirSync(OUT, { recursive: true });
const VIEWS = [
  { name: 'drag-eye', eye: [-252, 246, 4.8, 1.8] },
  { name: 'southmall-eye', eye: [0, 175, 0, 1.8], pitchUp: 6 },
  { name: 'speedway-eye', eye: [243.9, -424.5, 184.8, 1.8] },
  { name: 'opening', start: true },
  { name: 'aerial-300', target: [-235, 0, 30], distance: 300, polar: 60, azimuth: 250 },
  { name: 'westcampus-150', target: [-560, 0, -120], distance: 150, polar: 64, azimuth: 200 },
].filter((v) => !ONLY.length || ONLY.includes(v.name));
const browser = await launch(chromium, { args: HW_ARGS, maxMs: 1200000 });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (/tree/i.test(m.text())) console.log('[page]', m.text()); });
await page.goto(`${BASE.replace(/\/$/, '')}/${process.env.V2_DIR || 'v2'}/?intro=0&fade=0${Q ? '&' + Q : ''}`, { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction(() => window.__v2 && window.__v2.ready, null, { timeout: 180000 });
await page.evaluate(() => { window.cancelGraphicsAutoDetect?.(); return window.__v2.ready; });
await page.addStyleTag({ content: 'body > *:not(canvas) { visibility: hidden !important; } canvas { visibility: visible !important; }' });
const start = await page.evaluate(() => { const { camera, controls } = window.__v2; return { p: camera.position.toArray(), t: controls.target.toArray() }; });
await page.waitForFunction(() => window.__v2trees && window.__v2trees.stats().ready, null, { timeout: 120000 }).catch(() => {});
for (const v of VIEWS) {
  await page.evaluate(([v, start]) => {
    const { THREE, camera, controls } = window.__v2;
    if (v.eye) {   // as v2-view-shots.mjs places an eye view
      const [x, z, hdg, h] = v.eye, up = v.pitchUp || 0, r = THREE.MathUtils.degToRad(hdg), ahead = 30;
      window.__v2.placeCamera({ target: [x + Math.sin(r) * ahead, 0, z - Math.cos(r) * ahead], distance: Math.hypot(ahead, h), polarDeg: 90 - Math.atan2(h, ahead) * 180 / Math.PI, azimuthDeg: hdg + 180 });
      if (up) { controls.update = () => false; camera.rotateX(THREE.MathUtils.degToRad(up + Math.atan2(h, ahead) * 180 / Math.PI)); camera.updateMatrixWorld(); }
    } else if (v.start) { camera.position.fromArray(start.p); controls.target.fromArray(start.t); camera.lookAt(controls.target); }
    else window.__v2.placeCamera({ target: v.target, distance: v.distance, polarDeg: v.polar, azimuthDeg: v.azimuth });
    window.__v2.redraw();
  }, [v, start]);
  let calm = 0; const t0 = Date.now();
  while (calm < 3 && Date.now() - t0 < 180000) { const s = await page.evaluate(() => { window.__v2.redraw(); return window.__v2.tiles(); }); calm = s && s.planned && s.loading === 0 && !s.fading ? calm + 1 : 0; await page.waitForTimeout(700); }
  await page.evaluate(() => { const t = window.__v2.tileStreamer && window.__v2.tileStreamer(); t && t.settle(); window.__v2.redraw(); });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/${v.name}.png` }); await page.waitForTimeout(600); await page.screenshot({ path: `${OUT}/${v.name}.png` });
  const st = await page.evaluate(() => ({ trees: window.__v2trees && window.__v2trees.stats(), real: window.__v2treesReal && window.__v2treesReal.stats() }));
  console.log(v.name, JSON.stringify({ total: st.trees && st.trees.total, source: st.trees && st.trees.source, real: st.trees && st.trees.real, realError: st.trees && st.trees.realError, near: st.real && st.real.near, mid: st.real && st.real.mid, solid: st.real && st.real.solid, ms: st.real && +st.real.ms.toFixed(2) }));
}
console.log('errors', JSON.stringify(errs.slice(0, 5)));
await browser.close();
