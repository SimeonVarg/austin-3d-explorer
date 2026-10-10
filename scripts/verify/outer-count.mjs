/**
 * outer-count.mjs - nobody may get LESS outer city than `main` drew.
 *
 * WHY. The houses layer (js/outer-homes.js) took 4,882 house-sized boxes out of
 * the outer ring and draws them, and 35,000 more, with roofs, in the three.js
 * scene. A visitor without that scene (the phone's `safe` tier, ?slopes=0) or
 * without the file would then see FEWER buildings than before the change, and
 * a picture test at the default settings would never notice. This counts the
 * outer city's buildings in five ways of opening the page and holds each to
 * what `main` drew:
 *
 *   desktop          the default page
 *   safe-tier        a phone on the `safe` tier (no three.js layer; ?lite=safe)
 *   slopes-off       a desktop with ?slopes=0
 *   phone-tier       a phone on the normal phone tier (?lite=1)
 *   no-decompress    a desktop whose browser has no DecompressionStream
 *
 * WHAT IS COUNTED, in the page itself:
 *   ring     the plain low-rise bodies of data/outer_ring.geojson outside the
 *            downtown box (no tower, no streetwall body, no detail piece) that
 *            the `outer-3d` layer draws at the page's own "City beyond campus"
 *            density (the layer's own filter: `d` <= density);
 *   houses   the buildings js/outer-homes.js is drawing: in the scene
 *            (stats().buildingsDrawn, at the page's density) or as plain boxes
 *            (the fallback), and only when the layer that draws them exists.
 * `main` has no houses layer, so its count is the ring's.
 *
 *   node outer-count.mjs                      this build against the committed baseline
 *   node outer-count.mjs --main URL           ... against a `main` served at URL, measured now
 *   node outer-count.mjs --main URL --write-baseline     write outer-count-baseline.json from it
 *   node outer-count.mjs --break              switch the houses off (?homes=0): the check MUST fail
 *   node outer-count.mjs --only safe-tier,slopes-off
 *
 * Exit 0 when every case draws at least what `main` drew, 1 otherwise.
 * No timing, no pixels: SwiftShader is fine.
 */
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const BASELINE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'outer-count-baseline.json');
const MAIN = arg('--main');
const BREAK = process.argv.includes('--break');
const WRITE = process.argv.includes('--write-baseline');
const ONLY = arg('--only') ? arg('--only').split(',') : null;
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
// DPR 1, not 3: the profile is chosen by touch and width, and a count does not need the pixels.
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, userAgent: IPHONE_UA };
const DESK = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 };
const CASES = [
  { name: 'desktop', ctx: DESK, q: '' },
  { name: 'safe-tier', ctx: PHONE, q: '&lite=safe' },
  { name: 'slopes-off', ctx: DESK, q: '&slopes=0' },
  { name: 'phone-tier', ctx: PHONE, q: '&lite=1' },
  { name: 'no-decompress', ctx: DESK, q: '', noDecompress: true },
].filter(c => !ONLY || ONLY.includes(c.name));
const DOWNTOWN = [-97.7580, 30.2560, -97.7280, 30.2770];     // scripts/bake_outer.py DOWNTOWN
const t0 = Date.now();
const log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(0).padStart(4) + ' s', ...a);

const browser = await launch(chromium, { maxMs: 3000000 });
async function count(base, c, extra) {
  const context = await browser.newContext(c.ctx);
  const page = await context.newPage();
  if (c.noDecompress) await page.addInitScript(() => { try { delete window.DecompressionStream; } catch (e) {} window.DecompressionStream = undefined; });
  await page.addInitScript(() => {
    const t = setInterval(() => { if (window.cancelGraphicsAutoDetect) { window.cancelGraphicsAutoDetect(); clearInterval(t); } }, 20);
    setTimeout(() => clearInterval(t), 30000);
  });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + '/?intro=0&drift=0&namelabels=0' + c.q + (extra || ''), { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded() && window.__map.getLayer('outer-3d'), null, { timeout: 600000, polling: 500 });
  await page.waitForFunction(() => !document.getElementById('veil'), null, { timeout: 900000, polling: 500 }).catch(() => log('WARN: veil still up', c.name));
  // the houses decide after the veil (or OUTER_HOMES.fetchAfterMs); a page with no such module has nothing to wait for
  await page.waitForFunction(() => !window.outerHomes || window.outerHomes.stats().done, null, { timeout: 240000, polling: 500 }).catch(() => log('WARN: houses never settled', c.name));
  await page.waitForTimeout(1500);
  const r = await page.evaluate(async (DT) => {
    const m = window.__map;
    const dens = (window.GFX && typeof window.GFX.outerDensity === 'number') ? window.GFX.outerDensity : 1;
    const ringLayer = !!m.getLayer('outer-3d') && m.getLayoutProperty('outer-3d', 'visibility') !== 'none';
    const gj = await (await fetch('data/outer_ring.geojson')).json();
    let ring = 0, ringAll = 0;
    for (const f of gj.features) {
      const p = f.properties;
      if ('k' in p || p.t === 1 || p.t === 2) continue;
      const pts = f.geometry.coordinates[0];
      let x = 0, y = 0;
      for (const q of pts) { x += q[0]; y += q[1]; }
      x /= pts.length; y /= pts.length;
      if (x >= DT[0] && x <= DT[2] && y >= DT[1] && y <= DT[3]) continue;
      ringAll++;
      if (dens >= 1 || p.d <= dens) ring++;
    }
    if (!ringLayer) ring = 0;
    const H = window.outerHomes ? window.outerHomes.stats() : null;
    let houses = 0, how = 'none';
    if (H && H.mode === 'scene' && H.group && window.SLOPES && window.SLOPES.on && window.slopes && window.slopes.root && window.slopes.root.children.some(g => g.name === 'outer-homes' && g.children.length)) { houses = H.buildingsDrawn; how = 'scene'; }
    else if (H && H.mode === 'boxes' && m.getLayer('outer-homes-flat') && m.getSource('austin-outer-homes')) { houses = H.buildingsDrawn; how = 'boxes'; }
    return { ring, ringAll, houses, how, total: ring + houses, density: dens, preset: window.GFX && window.GFX.preset,
      profile: window.LITE_PROFILE ? { on: window.LITE_PROFILE.on, tier: window.LITE_PROFILE.tierName, safe: window.LITE_PROFILE.safe } : null,
      slopes: !!(window.SLOPES && window.SLOPES.on), decompress: typeof window.DecompressionStream, homesError: H && H.error };
  }, DOWNTOWN);
  r.pageErrors = errors.slice(0, 2);
  await context.close();
  return r;
}

let main = null;
if (MAIN) {
  main = {};
  for (const c of CASES) { main[c.name] = await count(MAIN, c); log('main  ', c.name.padEnd(14), JSON.stringify(main[c.name])); }
  if (WRITE) {
    fs.writeFileSync(BASELINE, JSON.stringify({ _what: 'Outer-city buildings `main` drew in each case, before the houses layer (scripts/verify/outer-count.mjs --main URL --write-baseline). The branch must draw at least this many.',
      written: new Date().toISOString().slice(0, 10), cases: Object.fromEntries(Object.entries(main).map(([k, v]) => [k, { total: v.total, ring: v.ring, density: v.density, preset: v.preset }])) }, null, 1) + '\n');
    log('wrote', BASELINE);
  }
} else {
  main = JSON.parse(fs.readFileSync(BASELINE, 'utf8')).cases;
}
let failed = 0;
const rows = [];
for (const c of CASES) {
  const b = await count(BASE, c, BREAK ? '&homes=0' : '');
  log('branch', c.name.padEnd(14), JSON.stringify(b));
  const want = main[c.name] ? main[c.name].total : null;
  const ok = want != null && b.total >= want && !b.homesError;
  if (!ok) failed++;
  rows.push({ name: c.name, main: want, branch: b.total, ring: b.ring, houses: b.houses, how: b.how, ok });
}
await browser.close();
console.log('\n' + 'case'.padEnd(16) + 'main'.padStart(8) + 'branch'.padStart(9) + '   = ring + houses (drawn how)');
for (const r of rows) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name.padEnd(14) + String(r.main).padStart(5) + String(r.branch).padStart(9) + '   = ' + r.ring + ' + ' + r.houses + ' (' + r.how + ')');
if (BREAK) console.log(failed ? '\n--break: the check failed, as it must' : '\n--break: THE CHECK DID NOT FAIL. It cannot catch a missing houses layer.');
else console.log(failed ? `\n${failed} case(s) draw less outer city than main` : '\nevery case draws at least what main drew');
process.exit(failed ? 1 : 0);
