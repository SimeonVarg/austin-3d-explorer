/**
 * v2-light.mjs - the two light defects of 2026-10-20 cannot come back unseen (owner: "Some pillars are see through and wall detail
 * doesn't show. I've noticed this applies to all buildings."):
 *   ao      - every Blender tile drawn carries its baked ambient occlusion (_AO, scripts/v2/ao_bake.mjs) on EVERY mesh, the material
 *             draws it (program key v2-ao), and it is not a no-op: some of the model is darker than open sky (AO < AO_DARK) and the
 *             open walls are not darkened (75th percentile over the vertices >= AO_OPEN_P75). Without it, recesses, reveals, loggias and
 *             arcades draw the same colour as the wall in front of them: columns read as painted on a wall, "see through".
 *   acne    - every Blender tile mesh draws its shadow-map depth with the slope offset (LOOK.SHADOW_SLOPE_BIAS, glPolygonOffset). The
 *             tiles are double-sided, so without it every narrow lit part (bands, sills, pillars) falls in its own shadow in diagonal
 *             stripes whenever the shadow box is big (aerial views): Jester's cream bands drew as grey streaks, porch pillars striped.
 *   old     - ?light=old turns both off (the before/after switch stays honest).
 *
 *   VERIFY_GL=hardware VERIFY_URL=http://127.0.0.1:8131 node scripts/verify/v2-light.mjs
 *
 * Instrument: 1280x800 at device scale 1, any GL (the assertions read the scene, not pixels), the camera over the South Mall where
 * the Tower, Batts/Mezes/Benedict and Calhoun tiles load; tiles settled (3 calm polls). Exit 1 on any failure.
 */
import { chromium } from 'playwright-core';
import { launch, BASE } from './chrome.mjs';

const AO_DARK = 0.6, AO_OPEN_P75 = 0.8;   // (vertices sit mostly at details: windows, mullions, reveals; the open walls are the top quarter)
const browser = await launch(chromium, { gl: process.env.VERIFY_GL || (process.env.CI ? undefined : 'hardware'), maxMs: 1200000 });
let fail = 0;
async function load(q) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { console.log('page error:', e.message); fail++; });
  await page.goto(`${BASE.replace(/\/$/, '')}/v2/?intro=0${q ? '&' + q : ''}`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.__v2 && window.__v2.ready, null, { timeout: 180000 });
  await page.evaluate(() => window.__v2.ready);
  const man = await page.evaluate(() => fetch('./tiles/manifest.json').then((r) => r.json()));
  const b = man.buildings['ut-tower-main-building'];
  await page.evaluate(([x, z]) => window.__v2.placeCamera({ target: [x, 0, z + 120], distance: 420, polarDeg: 60, azimuthDeg: 200 }), [b.x, b.z]);
  let calm = 0; const t0 = Date.now();
  while (calm < 3 && Date.now() - t0 < 240000) { const s = await page.evaluate(() => window.__v2.tiles()); calm = s && s.planned && s.loading === 0 && !s.fading ? calm + 1 : 0; await page.waitForTimeout(700); }
  await page.evaluate(() => { const t = window.__v2.tileStreamer(); t && t.settle(); window.__v2.redraw(); });
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => {
    const out = { meshes: 0, withAO: 0, aoKey: 0, slope: 0, factor: null, values: 0, dark: 0, all: [] };
    const g = window.__v2.scene.getObjectByName('blender-tiles');
    g.traverse((o) => {
      if (!o.isMesh) return;
      out.meshes++;
      const a = o.geometry.attributes._ao;
      if (a) {
        out.withAO++;
        const step = Math.max(1, Math.floor(a.count / 2000));
        for (let i = 0; i < a.count; i += step) { const v = a.getX(i); out.values++; if (v < 0.6) out.dark++; out.all.push(v); }
      }
      if ((o.material.customProgramCacheKey?.() || '').includes('v2-ao')) out.aoKey++;
      const d = o.customDepthMaterial;
      if (d && d.polygonOffset && d.polygonOffsetFactor > 0) { out.slope++; out.factor = d.polygonOffsetFactor; }
    });
    out.all.sort((x, y) => x - y);
    out.p75 = out.all.length ? out.all[Math.floor(out.all.length * 0.75)] : null;
    delete out.all;
    out.slopeBias = window.__v2.LOOK.SHADOW_SLOPE_BIAS; out.aoOn = window.__v2.LOOK.AO.ON;
    return out;
  });
  await ctx.close();
  return r;
}
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fail++; };

const now = await load('');
console.log('default:', JSON.stringify(now));
check(now.meshes > 0, `Blender tile meshes drawn: ${now.meshes}`);
check(now.withAO === now.meshes, `ao: meshes carrying the baked AO ${now.withAO} of ${now.meshes}`);
check(now.aoKey === now.meshes, `ao: meshes whose material draws it ${now.aoKey} of ${now.meshes}`);
check(now.values > 0 && now.dark / now.values > 0.01, `ao: share of sampled vertices darker than ${AO_DARK}: ${(100 * now.dark / Math.max(1, now.values)).toFixed(1)} % (> 1 %: it does something)`);
check(now.p75 !== null && now.p75 >= AO_OPEN_P75, `ao: 75th percentile of AO ${now.p75?.toFixed(3)} >= ${AO_OPEN_P75} (open walls are not darkened)`);
check(now.slope === now.meshes && now.slopeBias > 0, `acne: meshes with the shadow slope offset ${now.slope} of ${now.meshes} (factor ${now.factor})`);

const old = await load('light=old');
console.log('light=old:', JSON.stringify(old));
check(old.aoKey === 0 && old.slope === 0, `old: ?light=old draws without AO (${old.aoKey}) and without the slope offset (${old.slope})`);

await browser.close();
console.log(fail ? `FAILED (${fail})` : 'ALL PASS');
process.exit(fail ? 1 : 0);
