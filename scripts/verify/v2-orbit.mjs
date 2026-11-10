/**
 * v2-orbit.mjs - the v2 app's camera on an arc round one building, one page load, one picture a step: how a building holds up in motion
 * and from places no photograph was taken from (the frames make a clip; rule 15 is judged in motion).
 *
 *   VERIFY_GL=hardware VERIFY_URL=http://127.0.0.1:8473 node scripts/verify/v2-orbit.mjs OUT_DIR SLUG [--radius 45] [--eye 1.7] [--eye2 1.7]
 *        [--target 7] [--from 40] [--to 140] [--frames 60] [--fov 50] [--size 1280x720] [--query "&moment=..."] [--near 0]
 *   Azimuth: degrees clockwise from north, of the camera as seen from the building (90 = the camera stands east of it and looks west).
 *   --eye .. --eye2: the eye's height at the first and the last frame. V2_DIR=folder loads another copy of the app (default v2).
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { launch, BASE } from './chrome.mjs';

const [outDir, slug, ...rest] = process.argv.slice(2);
const opt = (k, d) => { const i = rest.indexOf('--' + k); return i >= 0 ? rest[i + 1] : d; };
const radius = +opt('radius', 45), eye = +opt('eye', 1.7), eye2 = +opt('eye2', opt('eye', 1.7)), target = +opt('target', 7), from = +opt('from', 40), to = +opt('to', 140);
const frames = +opt('frames', 60), fov = +opt('fov', 50), near = +opt('near', 0), query = opt('query', ''), [w, h] = opt('size', '1280x720').split('x').map(Number);
const dir = process.env.V2_DIR || 'v2';
fs.mkdirSync(outDir, { recursive: true });
const browser = await launch(chromium, { gl: process.env.VERIFY_GL || 'hardware', maxMs: 1500000 });
const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`${BASE.replace(/\/$/, '')}/${dir}/?intro=0&fade=0${query}`, { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction(() => window.__v2 && window.__v2.ready, null, { timeout: 180000 });
await page.evaluate(() => { window.cancelGraphicsAutoDetect?.(); return window.__v2.ready; });
const b = await page.evaluate(async ([dir, slug]) => (await (await fetch(`/${dir}/tiles/manifest.json`)).json()).buildings[slug], [dir, slug]);
if (!b) throw new Error('no building ' + slug + ' in the manifest');
await page.addStyleTag({ content: 'body > *:not(canvas) { visibility: hidden !important; } canvas { visibility: visible !important; }' });
const place = (az, ey) => page.evaluate(([cx, cz, az, radius, ey, target, fov, near]) => {
  const { camera, controls } = window.__v2, a = az * Math.PI / 180;
  controls.update = () => false; controls.enabled = false;
  camera.fov = fov; if (near) camera.near = near; camera.updateProjectionMatrix();
  if ('fovBase' in controls) { controls.fovBase = fov; controls.fovKickNow = 0; }
  camera.position.set(cx + radius * Math.sin(a), ey, cz - radius * Math.cos(a)); camera.up.set(0, 1, 0); camera.lookAt(cx, target, cz); camera.updateMatrixWorld();
  controls.focus.set(camera.position.x, 0, camera.position.z); controls.target.set(camera.position.x, 0, camera.position.z);
  window.__v2.redraw();
}, [b.x, b.z, az, radius, ey, target, fov, near]);
const calm = async (need, maxMs) => { let c = 0; const t0 = Date.now(); while (c < need && Date.now() - t0 < maxMs) { const s = await page.evaluate(() => window.__v2.tiles()); c = s && s.loading === 0 && !s.fading ? c + 1 : 0; await page.waitForTimeout(300); } };
for (let i = 0; i < frames; i++) {
  const t = frames > 1 ? i / (frames - 1) : 0, az = from + (to - from) * t, ey = eye + (eye2 - eye) * t;
  await place(az, ey); await calm(i ? 2 : 4, i ? 20000 : 180000); if (!i) { await page.waitForTimeout(2500); await place(az, ey); }
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(outDir, `f${String(i).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 93 });
}
console.log(JSON.stringify({ outDir, slug, frames, at: [b.x, b.z], tiles: await page.evaluate(() => window.__v2.tiles()), errors: errs.slice(0, 3) }));
await browser.close();
