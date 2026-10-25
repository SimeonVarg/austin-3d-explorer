// v2-wire-shimmer.mjs: native (dpr 1) and supersampled truth (dpr SS) of the same poses, one browser: node shim.mjs CAMS.json OUTPREFIX SS [query]
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { launch, BASE } from './chrome.mjs';
const [camPath, out, ssS = '4', query = ''] = process.argv.slice(2);
const cams = JSON.parse(fs.readFileSync(camPath, 'utf8')); const { w, h } = cams[0];
const browser = await launch(chromium, { gl: process.env.VERIFY_GL || 'hardware', maxMs: 900000 });
for (const [tag, dpr] of [['native', 1], ['truth', +ssS]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
  const page = await ctx.newPage();
  await page.goto(`${BASE.replace(/\/$/, '')}/v2/?intro=0&fade=0&adapt=0${query}`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.__v2 && window.__v2.ready, null, { timeout: 180000 });
  await page.evaluate(() => { window.cancelGraphicsAutoDetect?.(); });
  await page.addStyleTag({ content: 'body > *:not(canvas) { visibility: hidden !important; } canvas { visibility: visible !important; }' });
  for (let i = 0; i < cams.length; i++) {
    const c = cams[i];
    await page.evaluate((c) => { const { camera, controls } = window.__v2; controls.update = () => false; controls.enabled = false; camera.fov = c.fov; camera.near = 0.3; camera.updateProjectionMatrix(); camera.position.set(...c.pos); camera.up.set(0, 1, 0); camera.lookAt(...c.look); camera.updateMatrixWorld(); controls.focus.set(c.look[0], 0, c.look[2]); controls.target.set(c.look[0], 0, c.look[2]); window.__v2.redraw(); }, c);
    let calm = 0; const t0 = Date.now();
    while (calm < 3 && Date.now() - t0 < 120000) { const s = await page.evaluate(() => window.__v2.tiles()); calm = s && s.loading === 0 ? calm + 1 : 0; await page.waitForTimeout(400); }
    await page.waitForTimeout(i === 0 ? 2500 : 900);
    await page.screenshot({ path: `${out}_${tag}_${i}.png` });
    if (i === 0) console.log(tag, JSON.stringify(await page.evaluate(() => window.__v2.info().adapt)));
  }
  await ctx.close();
}
await browser.close();
