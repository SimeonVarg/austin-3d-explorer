/**
 * v2-moment-shots.mjs - the app at a SOLVED PHOTO CAMERA (as v2-exact.mjs) under a moment's sky (?moment=..., v2/sky.js), drawn for a
 * list of sky settings in ONE page load (rule 13: load once, test many). For fitting a moment's haze / clouds / exposure to a photo.
 *
 *   VERIFY_GL=hardware VERIFY_URL=http://127.0.0.1:8591 node scripts/verify/v2-moment-shots.mjs CAMERA.json OUT_DIR SETTINGS.json [query] [ox oz]
 *   SETTINGS.json: [{ "name": "a", "haze": 1.5, "cover": 0.2, "exposure": 0.8, "clouds": { "SUN": 0.6 } }, ...]  (each is passed to
 *   window.__v2.setMoment; the exact tile's local probe is drawn again after each, so its glass mirrors that sky)
 *   query must hold the moment, e.g. "&moment=IMG_1778&manifest=./tiles-exact/manifest-ao.json". EXACT_NEAR=m as v2-exact.mjs.
 *   WATCH=1 keeps polling OUT_DIR/SETTINGS.json for new entries (a fit loop drives it) until a "done" entry arrives.
 * Prints one JSON line per picture: the file, the moment's numbers (sun, haze, cover, exposure), the probe time.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { launch, BASE } from './chrome.mjs';

const [camPath, outDir, setPath, query = '', oxs = '-1138.87', ozs = '2026.95'] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const cam = JSON.parse(fs.readFileSync(camPath, 'utf8'));
const [w, h] = cam.standard_size || [1500, 2000];
const ox = +oxs, oz = +ozs;
const K = cam.K, R = cam.R_world_to_cam, C = cam.position_m;
const fov = 2 * Math.atan(h / 2 / K[1][1]) * 180 / Math.PI;
const toApp = (v) => [v[0], v[2], -v[1]];
const right = toApp(R[0]), up = toApp(R[1].map((x) => -x)), back = toApp(R[2].map((x) => -x));
const pos = [ox + C[0], C[2], oz - C[1]];
const SCALE = +(process.env.SHOT_SCALE || 1);   // < 1: a smaller picture while iterating (same camera, same framing)
const browser = await launch(chromium, { gl: process.env.VERIFY_GL || 'hardware', maxMs: 3600000 });
const ctx = await browser.newContext({ viewport: { width: Math.round(w / 2 * SCALE), height: Math.round(h / 2 * SCALE) }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (/moment|exact|error/i.test(m.text())) console.log('[page]', m.text().slice(0, 300)); });
await page.goto(`${BASE.replace(/\/$/, '')}/v2/?intro=0&fade=0${query}`, { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction(() => window.__v2 && window.__v2.ready, null, { timeout: 180000 });
await page.evaluate(() => window.__v2.ready);
const place = () => page.evaluate(([pos, right, up, back, fov, nearM]) => {
  const { THREE, camera, controls } = window.__v2;
  controls.update = () => false; controls.enabled = false;
  camera.fov = fov; camera.near = nearM || camera.near; camera.updateProjectionMatrix();
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
const hasExact = await page.evaluate(() => (window.__v2.exact ? window.__v2.exact().tiles : 0));
const done = new Set();
async function shoot(name, s) {
  const r = await page.evaluate((o) => window.__v2.setMoment(o), s);
  let probeMs = null;
  if (hasExact) { probeMs = await page.evaluate(() => window.__v2.exactProbe()); await place(); }
  await page.evaluate(() => window.__v2.redraw());
  await page.waitForTimeout(600);
  const f = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: f + '.tmp.png' });
  await page.evaluate(() => window.__v2.redraw()); await page.waitForTimeout(500);
  await page.screenshot({ path: f }); fs.rmSync(f + '.tmp.png', { force: true });
  console.log(JSON.stringify({ out: f, moment: await page.evaluate(() => window.__v2.moment()), probeMs: probeMs && Math.round(probeMs), set: r && { groundE: r.groundE.map((v) => +v.toFixed(3)), fog: r.fog.map((v) => +v.toFixed(4)) } }));
}
for (;;) {
  let list = [];
  try { list = JSON.parse(fs.readFileSync(setPath, 'utf8')); } catch (e) { list = []; }
  let stop = false;
  for (const s of list) {
    if (s.name === 'done') { stop = true; break; }
    if (done.has(s.name)) continue;
    done.add(s.name);
    const { name, ...o } = s;
    await shoot(name, o);
  }
  if (stop || !process.env.WATCH) break;
  await page.waitForTimeout(1500);
}
if (errs.length) console.log(JSON.stringify({ errors: errs.slice(0, 3) }));
await browser.close();
