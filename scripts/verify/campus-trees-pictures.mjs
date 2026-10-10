/**
 * campus-trees-pictures.mjs: the campus trees drawn the plain way and as instances, in ONE page, same cameras.
 *
 * Loads the app once, then for each state (plain, instanced, plain again) flips CAMPUS_LANDSCAPE.instancing.on,
 * rebuilds the planting, and photographs the ten cameras of scripts/verify/ci/poses.json plus two campus close-ups.
 * The second plain pass is the noise floor (the same page twice). Prints, per view, the share of pixels that moved
 * by more than LOOK.tolerance, the largest channel difference, and the noise floor; writes side-by-side pictures.
 * Also prints what each state cost (build time, bytes, draw calls, triangles).
 *
 *   node scripts/verify/campus-trees-pictures.mjs [--out DIR]     (VERIFY_URL=http://127.0.0.1:PORT, VERIFY_GL=hardware)
 *
 * Load once, test many (CLAUDE.md rule 13): two states from one load, not two loads. The page is loaded with
 * facadepace=0&timeofdaypace=0&namelabels=0, the switches scripts/verify/ci/pictures.mjs uses for deterministic pictures.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { launch, BASE } from './chrome.mjs';
import { decodePNG } from './lib/png.mjs';
import { waitForApartmentBuild } from './lib/apartment-ready.mjs';

// ---- every threshold and look value, in one place ----------------------
const LOOK = {
  tolerance: 12,        // a pixel "moved" if any RGB channel moved more than this (0-255), as ci/pictures.mjs counts it
  viewport: { width: 1440, height: 900 },
  query: 'intro=0&drift=0&facadepace=0&timeofdaypace=0&namelabels=0',
  settleMs: 3500,       // after a camera move or a rebuild, before the picture
  maxSettleMs: 60000,
  panelScale: 0.5, labelPx: 20, jpegQuality: 88,
};
// Two close-ups where trees are large: the densest 90 m of planting (47 trees within 45 m) and the biggest live oak
// south of the Tower, both read off data/campus_landscape.json.
const CLOSEUPS = [
  { name: 'closeup-grove', p: 0.25, center: [-97.7314202, 30.2898782], zoom: 18.4, pitch: 60, bearing: 200 },
  { name: 'closeup-liveoak', p: 0.25, center: [-97.7390223, 30.2851635], zoom: 19.2, pitch: 62, bearing: 20 },
];
const argv = process.argv.slice(2);
const OUT = path.resolve(argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : 'ci-out/campus-trees-pictures');
fs.mkdirSync(OUT, { recursive: true });
const poses = [...JSON.parse(fs.readFileSync(new URL('./ci/poses.json', import.meta.url), 'utf8')), ...CLOSEUPS];

const browser = await launch(chromium, { gl: process.env.VERIFY_GL || 'hardware', maxMs: 40 * 60 * 1000 });
const report = { instrument: { url: BASE, gl: process.env.VERIFY_GL || 'hardware', viewport: LOOK.viewport, query: LOOK.query, tolerance: LOOK.tolerance }, states: {}, views: [] };
try {
  const page = await browser.newPage({ viewport: LOOK.viewport, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && /campus-landscape|THREE|WebGL|shader/i.test(m.text())) errors.push(m.text()); });
  await page.addInitScript(() => { const t = setInterval(() => { if (window.cancelGraphicsAutoDetect) { cancelGraphicsAutoDetect(); clearInterval(t); } }, 50); });
  await page.goto(`${BASE}/index.html?${LOOK.query}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => window.slopesApartments?.count.done && window.campusLandscape?.count.done && window.__fly?.indexed(), null, { timeout: 600000 });
  await waitForApartmentBuild(page);
  report.instrument.renderer = await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
  console.log('renderer:', report.instrument.renderer);

  const settle = async () => {
    await page.waitForTimeout(LOOK.settleMs);
    await page.evaluate(ms => new Promise(r => { const m = window.__map; if (m.loaded()) return r(); m.once('idle', () => r()); setTimeout(r, ms); }), LOOK.maxSettleMs);
    await page.waitForFunction(() => !(window.CityLighting?.stats?.shadowProxyBuilding) && !(window.__facadePace?.busy), null, { timeout: LOOK.maxSettleMs }).catch(() => {});
    await page.evaluate(() => window.__map.triggerRepaint());
    await page.waitForTimeout(1500);
  };
  const setState = async state => {
    await page.evaluate(on => { CAMPUS_LANDSCAPE.instancing.on = on; campusLandscape.rebuild(); }, state !== 'plain');
    await page.waitForFunction(() => campusLandscape.group && campusLandscape.count.trees > 0, null, { timeout: 120000 });
    // (The apartments are not rebuilt by a planting rebuild, so there is nothing more to wait for here; the first load waited for them.)
  };
  const pass = async (state, label) => {
    await setState(state);
    const cost = { state };
    for (const p of poses) {
      await page.evaluate(p => {
        GFX.autoExposure = false;
        // Things that move on their own (clouds, stars, god rays, lens flare) would show up as "noise" and hide what is being compared.
        Object.assign(GFX, { clouds: 0, stars: 0, godRays: 0, flare: 0 }); window.applyGraphics();
        __map.stop(); __map.jumpTo({ center: p.center, zoom: p.zoom, pitch: p.pitch, bearing: p.bearing, padding: 0 });
        window.applyTimeOfDay(__map, p.p, true);
      }, p);
      await settle();
      const file = path.join(OUT, `${label}-${p.name}.png`);
      await page.screenshot({ path: file });
      await page.waitForTimeout(500);
      await page.screenshot({ path: file });   // trust the second
      if (!cost.atFirstView) {
        cost.atFirstView = await page.evaluate(() => {
          const s = slopes.stats(), c = campusLandscape.count, g = campusLandscape.group, r = slopes.renderer.info;
          let treeMeshes = 0; g.traverse(o => { if (o.isMesh && /^campus-(trees-|-?\d+,)/.test(o.name)) treeMeshes++; });
          return { frameCalls: s.calls, frameTriangles: s.triangles, geometries: r.memory.geometries, treeMeshes };
        });
      }
    }
    cost.count = await page.evaluate(() => campusLandscape.count);
    report.states[label] = cost;
    console.log(label, JSON.stringify(cost));
  };
  await pass('plain', 'plain1');
  await pass('instanced', 'instanced');
  await pass('plain', 'plain2');
  report.errors = errors;

  // ---- compare ----
  // `beyond noise`: pixels that moved between plain and instanced AND did not move between the two plain passes.
  const diff = (fa, fb, fc) => {
    const A = decodePNG(fa), B = decodePNG(fb), C = fc ? decodePNG(fc) : null, n = A.width * A.height;
    let moved = 0, any = 0, max = 0, sumsq = 0, beyond = 0;
    for (let i = 0; i < n; i++) {
      let d = 0, dn = 0;
      for (let c = 0; c < 3; c++) {
        d = Math.max(d, Math.abs(A.data[i * A.bpp + c] - B.data[i * B.bpp + c]));
        if (C) dn = Math.max(dn, Math.abs(A.data[i * A.bpp + c] - C.data[i * C.bpp + c]));
      }
      if (d > max) max = d; if (d > LOOK.tolerance) { moved++; if (C && dn <= LOOK.tolerance) beyond++; } if (d > 0) any++; sumsq += d * d;
    }
    const r = { movedPct: +(100 * moved / n).toFixed(4), anyDiffPct: +(100 * any / n).toFixed(4), maxChannelDiff: max, rms: +Math.sqrt(sumsq / n).toFixed(4) };
    if (C) r.movedBeyondNoisePct = +(100 * beyond / n).toFixed(4);
    return r;
  };
  for (const p of poses) {
    const f = s => path.join(OUT, `${s}-${p.name}.png`);
    const row = { view: p.name, vsInstanced: diff(f('plain1'), f('instanced'), f('plain2')), noise: diff(f('plain1'), f('plain2')) };
    report.views.push(row);
    console.log(p.name.padEnd(18), 'plain vs instanced moved', String(row.vsInstanced.movedPct).padStart(8) + '%', ' beyond noise', String(row.vsInstanced.movedBeyondNoisePct).padStart(8) + '%', ' any', String(row.vsInstanced.anyDiffPct).padStart(8) + '%', ' max', String(row.vsInstanced.maxChannelDiff).padStart(3),
      '| noise (plain vs plain) moved', row.noise.movedPct + '%', 'any', row.noise.anyDiffPct + '%', 'max', row.noise.maxChannelDiff);
  }
  fs.writeFileSync(path.join(OUT, 'campus-trees-pictures.json'), JSON.stringify(report, null, 1));

  // ---- side by side: plain | instanced | where they differ (any channel) ----
  const url = f => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
  const w = Math.round(LOOK.viewport.width * LOOK.panelScale), h = Math.round(LOOK.viewport.height * LOOK.panelScale);
  const shot = await browser.newPage({ viewport: { width: w * 3, height: h + LOOK.labelPx + 16 } });
  for (const row of report.views) {
    const f = s => path.join(OUT, `${s}-${row.view}.png`);
    await shot.setContent(`<body style="margin:0;display:flex;background:#111">${[['PLAIN (treeinstancing=0)', f('plain1')], ['INSTANCED', f('instanced')], ['PLAIN AGAIN (noise)', f('plain2')]].map(([t, file]) =>
      `<figure style="margin:0;width:${w}px"><figcaption style="height:${LOOK.labelPx + 16}px;line-height:${LOOK.labelPx + 16}px;padding:0 8px;font:600 ${LOOK.labelPx}px system-ui;color:#fff">${row.view} - ${t}</figcaption><img src="${url(file)}" style="display:block;width:${w}px;height:${h}px"></figure>`).join('')}</body>`);
    await shot.screenshot({ path: path.join(OUT, `${row.view}-compare.jpg`), type: 'jpeg', quality: LOOK.jpegQuality });
  }
  if (errors.length) console.log('ERRORS', errors.slice(0, 10));
} finally {
  await browser.__done();
}
