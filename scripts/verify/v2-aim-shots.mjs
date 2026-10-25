/**
 * v2-aim-shots.mjs - before/after pictures of the shadow aim (LOOK.SHADOW_AIM, 2026-10-25) in the city: one page load per view, the
 * same frame drawn with the aim OFF (the shadow box follows the flycam's ground focus, as before) and ON, flipped inside the page.
 *
 *   VERIFY_GL=hardware VERIFY_URL=http://127.0.0.1:8131 node scripts/verify/v2-aim-shots.mjs OUT_DIR [view ...]
 *
 * Views: the seven of v2-demo-checks.mjs (finder left out: same camera as the opening), Calhoun's east face from the street,. 1440x900 at device scale 2, tiles settled (3 calm
 * polls), every picture drawn twice and the second kept. Prints the shadow box (half-width, aim hit) for both arms.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { launch, BASE } from './chrome.mjs';

const OUT = process.argv[2] || 'v2-aim-shots';
const ONLY = process.argv.slice(3);
fs.mkdirSync(OUT, { recursive: true });
// target [x, z], distance, polar, azimuth (placeCamera); or eye [x, z, heading, height]
const VIEWS = [
  { name: 'opening', start: true },
  { name: 'dkr-near', xz: [621, 228], distance: 170, polar: 68, azimuth: 200 },
  { name: 'dkr-far', xz: [621, 228], distance: 380, polar: 58, azimuth: 235 },
  { name: 'tower-near', xz: [0, -0.5], distance: 150, polar: 74, azimuth: 185 },
  { name: 'tower-far', xz: [0, -0.5], distance: 330, polar: 62, azimuth: 200 },
  { name: 'speedway-eye', eye: [243.9, -424.5, 184.8, 1.8] },
  { name: 'calhoun-east-eye', eye: [-35, 166, 270, 1.8], pitchUp: 8 },
].filter((v) => !ONLY.length || ONLY.includes(v.name));

const browser = await launch(chromium, { gl: process.env.VERIFY_GL || 'hardware', maxMs: 1800000 });
const rows = [];
for (const v of VIEWS) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`${BASE.replace(/\/$/, '')}/v2/?intro=0&fade=0`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.__v2 && window.__v2.ready, null, { timeout: 180000 });
  await page.evaluate(() => { window.cancelGraphicsAutoDetect?.(); return window.__v2.ready; });
  await page.addStyleTag({ content: 'body > *:not(canvas) { visibility: hidden !important; } canvas { visibility: visible !important; }' });
  if (v.eye) {
    await page.evaluate(([x, z, hdg, h, up]) => {
      const { THREE, camera } = window.__v2, r = THREE.MathUtils.degToRad(hdg), ahead = 30;
      window.__v2.placeCamera({ target: [x + Math.sin(r) * ahead, 0, z - Math.cos(r) * ahead], distance: Math.hypot(ahead, h), polarDeg: 90 - Math.atan2(h, ahead) * 180 / Math.PI, azimuthDeg: hdg + 180 });
      if (up) {   // the flycam looks no higher than level (FLY.PITCH_MAX): hold the camera still, as v2-exact.mjs does, to look up
        window.__v2.controls.update = () => false;
        camera.rotateX(THREE.MathUtils.degToRad(up + Math.atan2(h, ahead) * 180 / Math.PI)); camera.updateMatrixWorld();
      }
      window.__v2.redraw();
    }, [...v.eye, v.pitchUp || 0]);
  } else if (v.xz) {
    await page.evaluate(([x, z, d, p, a]) => window.__v2.placeCamera({ target: [x, 0, z], distance: d, polarDeg: p, azimuthDeg: a }), [v.xz[0], v.xz[1], v.distance, v.polar, v.azimuth]);
  }
  let calm = 0; const t0 = Date.now();
  while (calm < 3 && Date.now() - t0 < 240000) { const s = await page.evaluate(() => window.__v2.tiles()); calm = s && s.planned && s.loading === 0 && !s.fading ? calm + 1 : 0; await page.waitForTimeout(700); }
  await page.evaluate(() => { const t = window.__v2.tileStreamer(); t && t.settle(); });
  const row = { view: v.name };
  for (const [arm, on] of [['before', false], ['after', true]]) {
    await page.evaluate((on) => { window.__v2.LOOK.SHADOW_AIM.ON = on; window.__v2.redraw(); }, on);
    await page.waitForTimeout(1200);
    const f = path.join(OUT, `${v.name}.${arm}.png`);
    await page.screenshot({ path: f + '.tmp.png' }); await page.evaluate(() => window.__v2.redraw()); await page.waitForTimeout(700);
    await page.screenshot({ path: f }); fs.rmSync(f + '.tmp.png', { force: true });
    const s = await page.evaluate(() => window.__v2.info().shadow);
    row[arm] = { extent: Math.round(s.extent), aim: s.aim, aimMs: s.aimMs };
  }
  row.errors = errs.slice(0, 2);
  rows.push(row); console.log(JSON.stringify(row));
  await ctx.close();
}
console.log(`instrument: 1440x900 @2, ${process.env.VERIFY_GL || 'hardware'} GL, ${BASE}`);
await browser.close();
