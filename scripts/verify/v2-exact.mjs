/**
 * v2-exact.mjs - exact-photo pilot: the v2 app drawn from a SOLVED PHOTO CAMERA (OpenCV K, R world->camera, C; private camera file),
 * so the frame can be laid over the photograph pixel for pixel. Draft tool (2026-10-25), see v2/exact-pilot.js.
 *
 *   VERIFY_GL=hardware VERIFY_URL=http://127.0.0.1:8473 node scripts/verify/v2-exact.mjs CAMERA.json OUT.png [query] [ox oz]
 *   CAMERA.json: { "K": 3x3 at size [w,h], "R_world_to_cam": 3x3, "position_m": [x,y,z], "standard_size": [w,h] } in a local frame
 *   (x east, y north, z up) whose origin sits at app (ox, 0, oz). query: extra URL query, e.g. "&manifest=./tiles-exact/manifest.json".
 *   EXACT_NEAR=m clips everything nearer than m metres (foreground trees and street objects; the building comparison only).
 *   The viewport is w/2 x h/2 at device scale 2, so the picture is exactly w x h. If the page has exact tiles, their local reflection
 *   probe is rendered after the tiles settle. Prints the app's draw stats and the probe time.
 */
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { launch, BASE } from './chrome.mjs';

const [camPath, out, query = '', oxs = '-1138.87', ozs = '2026.95'] = process.argv.slice(2);
const cam = JSON.parse(fs.readFileSync(camPath, 'utf8'));
const [w, h] = cam.standard_size || [1500, 2000];
const ox = +oxs, oz = +ozs;
const K = cam.K, R = cam.R_world_to_cam, C = cam.position_m;
const fov = 2 * Math.atan(h / 2 / K[1][1]) * 180 / Math.PI;
const toApp = (v) => [v[0], v[2], -v[1]];                         // local direction -> app direction
const right = toApp(R[0]), up = toApp(R[1].map((x) => -x)), back = toApp(R[2].map((x) => -x));
const pos = [ox + C[0], C[2], oz - C[1]];
const browser = await launch(chromium, { gl: process.env.VERIFY_GL || 'hardware', maxMs: 900000 });
const ctx = await browser.newContext({ viewport: { width: w / 2, height: h / 2 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (/exact|tiles\]/.test(m.text())) console.log('[page]', m.text()); });
await page.goto(`${BASE.replace(/\/$/, '')}/v2/?intro=0&fade=0${query}`, { waitUntil: 'load', timeout: 180000 });
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
  // the flycam's focus of a person standing here (its ground point under the eye), not the start view's 2 km away: with the old focus the
  // shadow box sat over campus and the photographed building had no sun shadow at all (pilot frames of 2026-10-25)
  controls.focus.set(pos[0], 0, pos[2]); controls.target.set(pos[0], 0, pos[2]);
  window.__v2.redraw();
}, [pos, right, up, back, fov, +(process.env.EXACT_NEAR || 0) || null]);
await page.addStyleTag({ content: 'body > *:not(canvas) { visibility: hidden !important; } canvas { visibility: visible !important; }' });
await place();
let calm = 0; const t0 = Date.now();
while (calm < 3 && Date.now() - t0 < 180000) { const s = await page.evaluate(() => window.__v2.tiles()); calm = s && s.loading === 0 ? calm + 1 : 0; await page.waitForTimeout(800); }
const ex = await page.evaluate(() => window.__v2.exact ? window.__v2.exact() : null);
let probeMs = null;
if (ex && ex.tiles) { probeMs = await page.evaluate(() => window.__v2.exactProbe()); await place(); }
await page.waitForTimeout(2500);
await page.screenshot({ path: out + '.tmp.png' });
await page.waitForTimeout(800);
await page.screenshot({ path: out });
fs.rmSync(out + '.tmp.png', { force: true });
const info = await page.evaluate(() => ({ ...window.__v2.info(), exact: window.__v2.exact ? window.__v2.exact() : null, glass: window.__v2.glass ? window.__v2.glass() : null, tiles: window.__v2.tiles(), mem: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null }));
console.log(JSON.stringify({ out, fov, pos, probeMs, info, errors: errs.slice(0, 3) }));
await browser.close();
