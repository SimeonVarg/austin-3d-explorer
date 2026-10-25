/**
 * v2-exact-ab.mjs - v2-exact.mjs for A/B: ONE page load at a solved photo camera, then several states flipped inside the page
 * (rule 13: load once, test many), one picture per state.
 *
 *   VERIFY_GL=hardware VERIFY_URL=http://127.0.0.1:8473 node scripts/verify/v2-exact-ab.mjs CAMERA.json OUTDIR query ox oz \
 *       'NAME=JS' ['NAME2=JS2' ...]
 *   JS runs in the page (window.__v2 is there; may return a promise); "reprobe" anywhere in it renders the exact tiles' local probes
 *   again after it (a state that changes what the probe sees). Pictures: OUTDIR/NAME.png. Camera, size and EXACT_NEAR as v2-exact.mjs.
 */
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { launch, BASE } from './chrome.mjs';

const [camPath, outDir, query = '', oxs = '-1138.87', ozs = '2026.95', ...states] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const cam = JSON.parse(fs.readFileSync(camPath, 'utf8'));
const [w, h] = cam.standard_size || [1500, 2000];
const ox = +oxs, oz = +ozs;
const K = cam.K, R = cam.R_world_to_cam, C = cam.position_m;
const fov = 2 * Math.atan(h / 2 / K[1][1]) * 180 / Math.PI;
const toApp = (v) => [v[0], v[2], -v[1]];
const right = toApp(R[0]), up = toApp(R[1].map((x) => -x)), back = toApp(R[2].map((x) => -x));
const pos = [ox + C[0], C[2], oz - C[1]];
const browser = await launch(chromium, { gl: process.env.VERIFY_GL || 'hardware', maxMs: +(process.env.VERIFY_MAX_MS || 900000) });
const ctx = await browser.newContext({ viewport: { width: w / 2, height: h / 2 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (/exact|glass|tiles\]/.test(m.text())) console.log('[page]', m.text().slice(0, 300)); });
await page.goto(`${BASE.replace(/\/$/, '')}/${process.env.V2_DIR || 'v2'}/?intro=0&fade=0${query}`, { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction(() => window.__v2 && window.__v2.ready, null, { timeout: 180000 });
await page.evaluate(() => { window.cancelGraphicsAutoDetect?.(); return window.__v2.ready; });
const place = () => page.evaluate(([pos, right, up, back, fov, nearM]) => {
  const NEAR = nearM || window.__v2.camera.near;
  const { THREE, camera, controls } = window.__v2;
  controls.update = () => false; controls.enabled = false;
  camera.fov = fov; camera.near = NEAR; camera.updateProjectionMatrix();
  camera.position.set(...pos);
  const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...right), new THREE.Vector3(...up), new THREE.Vector3(...back));
  camera.quaternion.setFromRotationMatrix(m); camera.updateMatrixWorld();
  controls.focus.set(pos[0], 0, pos[2]); controls.target.set(pos[0], 0, pos[2]);
  window.__v2.redraw();
}, [pos, right, up, back, fov, +(process.env.EXACT_NEAR || 0) || null]);
await page.addStyleTag({ content: 'body > *:not(canvas) { visibility: hidden !important; } canvas { visibility: visible !important; }' });
await place();
let calm = 0; const t0 = Date.now();
while (calm < 3 && Date.now() - t0 < 180000) { const s = await page.evaluate(() => window.__v2.tiles()); calm = s && s.loading === 0 ? calm + 1 : 0; await page.waitForTimeout(800); }
const hasExact = await page.evaluate(() => !!(window.__v2.exact && window.__v2.exact().tiles));
const probe = async () => (hasExact ? page.evaluate(() => window.__v2.exactProbe()) : null);
let probeMs = await probe(); await place();
const res = [];
for (const s of states) {
  const i = s.indexOf('='), name = s.slice(0, i), js = s.slice(i + 1);
  const r = await page.evaluate(async (js) => { const v = await (0, eval)(js); return v === undefined ? null : JSON.parse(JSON.stringify(v)); }, js);
  if (/reprobe/.test(js)) { probeMs = await probe(); }
  await place();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${outDir}/${name}.tmp.png` });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${outDir}/${name}.png` });
  fs.rmSync(`${outDir}/${name}.tmp.png`, { force: true });
  res.push({ name, r, probeMs });
  console.log(JSON.stringify({ name, r, probeMs }));
}
console.log(JSON.stringify({ outDir, fov, pos, errors: errs.slice(0, 3) }));
await browser.close();
