/**
 * v2-full-detail.mjs - every Blender building in v2 draws its full model at every distance, and a tile fades in.
 *
 *   VERIFY_URL=http://127.0.0.1:8099 node scripts/verify/v2-full-detail.mjs
 *
 * Owner, 2026-10-18: "can you also get rid fo the rule that converts buildings to bad lesser detailed ones when theyre at a
 * distance? its really disturbing." v2/tiles.js no longer swaps a tile to its far file (lod1) at any distance.
 *
 * Asserts:
 *   1. from DKR at 2 km and from the opening view, no far file (*.far.glb) is ever requested, and every loaded tile is full (lod1 = 0);
 *   2. tiles arrive with a fade: at least one tile was seen mid-fade while loading, and once settled every tile's fade is 0
 *      (the model is drawn at its own colours) and no plain extrusion is left in the haze.
 * Runs on any renderer.
 */
import { chromium } from 'playwright-core';
import { launch, BASE } from './chrome.mjs';

const browser = await launch(chromium, { maxMs: 1500000 });
const page = await (await browser.newContext({ viewport: { width: 1000, height: 640 } })).newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
const far = []; page.on('request', (r) => { if (/\.far\.glb(\?|$)/.test(r.url())) far.push(r.url()); });
await page.goto(`${BASE.replace(/\/$/, '')}/v2/?intro=0`, { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction(() => window.__v2 && window.__v2.ready, null, { timeout: 600000 });
await page.evaluate(() => window.__v2.ready);
let sawFade = 0;
const settle = async () => {
  let calm = 0; const t0 = Date.now();
  while (calm < 3 && Date.now() - t0 < 900000) {
    const s = await page.evaluate(() => { window.__v2.redraw(); return window.__v2.tiles(); });
    if (s.fading) sawFade++;
    calm = s.loading === 0 && !s.fading ? calm + 1 : 0;
    await page.waitForTimeout(150);
  }
};
await settle();
const man = await page.evaluate(() => fetch('./tiles/manifest.json').then((r) => r.json()));
const dkr = man.buildings['dkr-memorial-stadium'];
await page.evaluate(([x, z]) => window.__v2.placeCamera({ target: [x, 0, z], distance: 2000, polarDeg: 72, azimuthDeg: 200 }), [dkr.x, dkr.z]);
await settle();
const s = await page.evaluate(() => {
  const v = window.__v2, t = v.tiles();
  let fades = 0, hazed = 0;
  v.scene.getObjectByName('blender-tiles').children.forEach((o) => { if (o.userData.fade && o.userData.fade.value !== 0) fades++; });
  for (const b of v.city.buildings) { const a = b.mesh.geometry.attributes.hz; if (a) for (let i = 0; i < a.array.length; i++) if (a.array[i]) { hazed++; break; } }
  return { t, fades, hazed, dkrTile: v.scene.getObjectByName('blender-tiles').children.some((o) => /t_2_0/.test(o.name)) };
});
await browser.close();
let ok = true;
const check = (c, msg) => { console.log((c ? 'PASS ' : '*FAIL ') + msg); ok &&= !!c; };
console.log('tiles', JSON.stringify(s.t));
check(far.length === 0, `no far file requested (${far.length})`);
check(s.t.lod1 === 0 && s.t.lod0 > 0, `${s.t.lod0} tiles full, ${s.t.lod1} far`);
check(s.dkrTile, 'DKR (2 km away) is drawn from its full tile');
check(sawFade > 0, `tiles faded in (${sawFade} samples mid-fade)`);
check(s.fades === 0, `settled: every tile at its own colours (${s.fades} still hazed)`);
check(s.hazed === 0, `settled: no plain building left in the haze (${s.hazed} extrusion tiles)`);
if (errs.length) { console.log('page errors:', errs.slice(0, 3)); ok = false; }
process.exit(ok ? 0 : 1);
