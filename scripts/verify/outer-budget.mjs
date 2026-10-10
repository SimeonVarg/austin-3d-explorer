/**
 * outer-budget.mjs - what do the outer city's houses and trees cost? A measurement, not a gate.
 *
 * Per layer (js/outer-homes.js, js/outer-trees.js), in one page:
 *   instances   built, and drawn at each camera
 *   triangles   the three.js scene draws in one frame with the layer on, minus with it off
 *               (renderer.info for the main pass: after frustum culling, what the GPU is handed)
 *   gpu bytes   the vertex buffers the layer uploads (exact: the arrays' own sizes)
 *   js bytes    what stays in JavaScript: the decoded file, and the buffers' CPU copies
 *               (a phone frees the copies after upload: LITE.budget.freeGeometryCpu)
 *   requests    whether data/outer_homes.bin and data/outer_trees.bin were fetched at all
 *
 *   node outer-budget.mjs                      desktop profile
 *   node outer-budget.mjs --phone              the phone profile (390 x 844, DPR 3, touch, ?lite=1)
 *   node outer-budget.mjs --phone --query homes=0     with a layer switched off by its flag
 *   node outer-budget.mjs --json FILE
 *
 * Exit 0 unless it could not run. For the page's whole memory on the phone
 * profile use mobile-memory.mjs (it counts every WebGL byte by owner file).
 */
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';
import fs from 'node:fs';

const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const PHONE = process.argv.includes('--phone');
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ctx = PHONE ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE_UA }
                  : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
// Made-up cameras. `spawn` is the app's own opening view (js/app.js SPAWN); `high` is the highest the camera climbs.
const VIEWS = [
  { name: 'spawn', center: [-97.7445, 30.2880], zoom: 16.5, pitch: 70, bearing: 250 },
  { name: 'high', center: [-97.7370, 30.2900], zoom: 13.6, pitch: 45, bearing: 0 },
  { name: 'over-tarrytown', center: [-97.7760, 30.2990], zoom: 16.0, pitch: 60, bearing: 300 },
];
const t0 = Date.now();
const log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(0).padStart(4) + ' s', ...a);

const browser = await launch(chromium, { maxMs: 1500000 });
const context = await browser.newContext(ctx);
const page = await context.newPage();
const fetched = {};
page.on('request', r => { const m = /data\/(outer_homes|outer_trees)\.bin/.exec(r.url()); if (m) fetched[m[1]] = (fetched[m[1]] || 0) + 1; });
let veilGoneAt = null;
const firstFetch = {};
page.on('request', r => { const m = /data\/(outer_homes|outer_trees)\.bin/.exec(r.url()); if (m && !firstFetch[m[1]]) firstFetch[m[1]] = Date.now() - t0; });
await page.route('**/js/controls.js*', r => r.fulfill({ contentType: 'application/javascript', body: 'function initControls(){return function(){};}' }));
await page.addInitScript(() => {
  const t = setInterval(() => { if (window.cancelGraphicsAutoDetect) { window.cancelGraphicsAutoDetect(); clearInterval(t); } }, 20);
  setTimeout(() => clearInterval(t), 30000);
});
const q = '/?intro=0&drift=0&namelabels=0' + (PHONE ? '&lite=1' : '') + (arg('--query') ? '&' + arg('--query') : '');
await page.goto(BASE + q, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 300000 });
await page.waitForFunction(() => !document.getElementById('veil'), null, { timeout: 900000, polling: 500 }).catch(() => log('WARN: veil still up'));
veilGoneAt = Date.now() - t0;
// both modules decide within fetchAfterMs of the veil; give them that, then read
await page.waitForFunction(() => (!window.outerHomes || window.outerHomes.stats().done) && (!window.outerTrees || window.outerTrees.stats().done), null, { timeout: 120000, polling: 500 }).catch(() => {});
await page.waitForTimeout(6000);
const out = await page.evaluate(async (VIEWS) => {
  const m = window.__map, S = window.slopes, R = S && S.renderer;
  const res = { profile: window.LITE_PROFILE ? { on: window.LITE_PROFILE.on, tier: window.LITE_PROFILE.tierName, budget: window.LITE_PROFILE.budget && { outerHomes: window.LITE_PROFILE.budget.outerHomes, outerHomeWindows: window.LITE_PROFILE.budget.outerHomeWindows, outerTrees: window.LITE_PROFILE.budget.outerTrees } } : null,
    preset: window.GFX && window.GFX.preset, treeDensity: window.GFX && window.GFX.treeDensity, outerDensity: window.GFX && window.GFX.outerDensity,
    homes: window.outerHomes ? window.outerHomes.stats() : null, trees: window.outerTrees ? window.outerTrees.stats() : null,
    on: { homes: !!(window.OUTER_HOMES && window.OUTER_HOMES.on), trees: !!(window.OUTER_TREES && window.OUTER_TREES.on) }, views: {} };
  const bytes = o => { let n = 0; if (!o) return 0; for (const k of Object.keys(o)) { const v = o[k]; if (v && v.buffer instanceof ArrayBuffer) n += v.byteLength; } return n; };
  res.jsBytes = { homesDecoded: bytes(window.outerHomes && window.outerHomes.data), treesDecoded: bytes(window.outerTrees && window.outerTrees.data) };
  const cpu = g => { let n = 0; const seen = new Set(); if (!g) return 0; for (const mesh of g.children) for (const k in mesh.geometry.attributes) { const a = mesh.geometry.attributes[k]; if (a.array && a.array.buffer && !seen.has(a.array.buffer)) { seen.add(a.array.buffer); n += a.array.byteLength; } } return n; };
  res.jsBytes.homesCpuCopies = cpu(window.outerHomes && window.outerHomes.group); res.jsBytes.treesCpuCopies = cpu(window.outerTrees && window.outerTrees.group);
  if (!R) return res;
  const frame = () => new Promise(r => { m.once('render', () => r({ calls: R.info.render.calls, triangles: R.info.render.triangles })); m.triggerRepaint(); });
  const set = async (homes, trees) => {
    if (window.OUTER_HOMES && res.on.homes) { window.OUTER_HOMES.on = homes; window.applyOuterHomes(m); }
    if (window.OUTER_TREES && res.on.trees) { window.OUTER_TREES.on = trees; window.applyOuterTrees(m); }
    await new Promise(r => setTimeout(r, 300)); await frame(); return frame();
  };
  if (window.GFX) { window.GFX.renderDistance = 1500; if (window.applyLOD) window.applyLOD(m); }
  for (const v of VIEWS) {
    m.jumpTo({ center: v.center, zoom: v.zoom, pitch: v.pitch, bearing: v.bearing });
    await new Promise(r => setTimeout(r, 2500));
    const none = await set(false, false), homes = await set(true, false), both = await set(true, true);
    res.views[v.name] = { sceneWithout: none, homesTriangles: homes.triangles - none.triangles, homesCalls: homes.calls - none.calls,
      treesTriangles: both.triangles - homes.triangles, treesCalls: both.calls - homes.calls,
      treesTiers: window.outerTrees ? (({ near, far, horizon, drawn }) => ({ near, far, horizon, drawn }))(window.outerTrees.stats()) : null,
      homesDrawn: window.outerHomes ? window.outerHomes.stats().drawn : null };
  }
  return res;
}, VIEWS);
out.fetched = fetched; out.firstFetchMs = firstFetch; out.veilGoneMs = veilGoneAt; out.phone = PHONE; out.query = q;
console.log(JSON.stringify(out, null, 1));
if (arg('--json')) fs.writeFileSync(arg('--json'), JSON.stringify(out, null, 1));
await browser.close();
