/**
 * v2-pairs.mjs - the app half of the pair sheets: the live v2 app from the same camera poses as the Blender renders (scripts/v2/blender_pair.py).
 *
 *   VERIFY_GL=hardware VERIFY_URL=https://flyover-utx.vercel.app node scripts/verify/v2-pairs.mjs OUT_DIR [slug ...]
 *   (V2_QUERY='?manifest=./tiles-test/manifest.json' looks at a trial tile set; V2_VIEW=name part; V2_TAG=label for the file; V2_NOSHADOW=1 draws without the shadow map, a diagnosis)
 *
 * Poses are in scripts/v2/pair_views.json (the build's own frame); here they become the app's frame with manifest.buildings[slug].x/z. The camera is
 * set directly (the orbit controls' own update is switched off for the shot: it would turn the camera back to a target on the ground). 1440x900 at
 * device scale 4/3 = 1920x1200, the Blender render's size. Tiles settle first; the second picture is kept.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { launch, BASE } from './chrome.mjs';

const OUT = process.argv[2] || 'v2-pairs'; const ONLY = process.argv.slice(3);
const views = JSON.parse(fs.readFileSync(new URL('../v2/pair_views.json', import.meta.url), 'utf8'));
fs.mkdirSync(OUT, { recursive: true });
const browser = await launch(chromium, { gl: process.env.VERIFY_GL || 'hardware', maxMs: 900000 });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 4 / 3 });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`${BASE.replace(/\/$/, '')}/v2/${process.env.V2_QUERY || ''}`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__v2 && window.__v2.ready, null, { timeout: 120000 });
await page.evaluate(() => window.__v2.ready);
const man = await page.evaluate(() => fetch('./tiles/manifest.json').then((r) => r.json()));
for (const slug of Object.keys(views).filter((k) => !k.startsWith('_') && k !== 'fov_deg' && (!ONLY.length || ONLY.includes(k)))) {
  const b = man.buildings[slug];
  for (const v of views[slug].filter((x) => !process.env.V2_VIEW || x.name.includes(process.env.V2_VIEW))) {
    // build frame (x east, y north, z up) -> app frame (x east, y up, z south), origin at the building's tile offset
    const toApp = (p) => [b.x + p[0], p[2], b.z - p[1]];
    await page.evaluate(([cam, tgt, fov]) => {
      const { THREE, camera, controls } = window.__v2;
      controls.update = () => false; controls.enabled = false;
      camera.fov = fov; camera.updateProjectionMatrix();
      camera.position.set(...cam); controls.target.set(...tgt); camera.lookAt(controls.target); camera.updateMatrixWorld(); window.__v2.redraw();
    }, [toApp(v.pos), toApp(v.target), views.fov_deg || 40]);
    if (process.env.V2_NOSHADOW) await page.evaluate(() => { const { renderer, scene } = window.__v2; renderer.shadowMap.enabled = false; scene.traverse((o) => { if (o.isLight) o.castShadow = false; if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); }); window.__v2.redraw(); });   // diagnosis only: the picture without the shadow map
    let calm = 0; const t0 = Date.now();
    while (calm < 3 && Date.now() - t0 < 120000) { const s = await page.evaluate(() => window.__v2.tiles()); calm = s && s.loading === 0 ? calm + 1 : 0; await page.waitForTimeout(700); }
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(OUT, v.name + '.tmp.png') });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, v.name + (process.env.V2_TAG ? '.' + process.env.V2_TAG : '') + '.app.png') });
    fs.rmSync(path.join(OUT, v.name + '.tmp.png'), { force: true });
    console.log('APP', v.name, errs.slice(0, 2).join(' | '));
  }
}
await browser.close();
