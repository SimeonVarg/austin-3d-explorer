/**
 * mobile-budget.mjs — how much memory does this page need on a phone?
 *
 * WHY. On 2026-09-15 the site was reported loading and then crash-looping on an
 * iPhone in both Safari ("A problem repeatedly occurred") and Chrome for iOS
 * ("Can't open this page") while desktop was fine. That pair of messages is
 * WebKit killing a tab for memory. It throws nothing, logs nothing, and leaves
 * no stack — so the only way to see it coming from a desktop is to measure the
 * heap the page retains and compare it against what a phone will tolerate.
 * Desktop Chrome's own limit is 4096 MB, which is why 1.1 GB was invisible.
 *
 * WHAT IT MEASURES, and the two things that make the number honest:
 *
 *   1. AFTER A FORCED GC. `--expose-gc`, two collections, then the reading, so
 *      this is memory the page is HOLDING and not whatever the allocator had
 *      not swept yet. Without it the same build reads ~60 MB apart run to run.
 *   2. AFTER THE VEIL LIFTS. The veil is the app's own "the city is built"
 *      signal, so every build is measured at the same point in its life.
 *
 * It reports `performance.memory.usedJSHeapSize`, which is the JS heap only:
 * GPU buffers, tile workers and the decoded basemap are all ON TOP of it. So
 * the numbers here are a floor, not a total, and the gap between two builds is
 * the trustworthy part rather than any single absolute.
 *
 * WHAT IT NEEDS. The real basemap (tiles.openfreemap.org) and the three CDN
 * libraries. Where those are unreachable — a sandboxed CI container — pass
 * VERIFY_STUB=1 and it serves a minimal background-only style plus the
 * libraries from node_modules, which changes the absolute numbers (no basemap
 * tiles in the heap) but not the comparison between builds.
 *
 * USAGE
 *   python scripts/serve.py 8442                      # from the repo root
 *   cd scripts/verify
 *   VERIFY_URL=http://127.0.0.1:8442 node mobile-budget.mjs
 *   ... node mobile-budget.mjs '?lite=0' '?slopes=0'  # compare arms
 *
 * MEASURED ON THIS BUILD (390x844 at DPR 3, VERIFY_STUB=1). MINIMUM of the
 * reps, per CLAUDE.md rule 10 — the heap moved 60 MB and the veil a factor of
 * two run to run, so the spread is quoted and only the GAP is load-bearing:
 *
 *     ?lite=0  (the full scene)     1035 MB  (1035-1109)   veil 39 s
 *     default  (the phone profile)   189 MB  (189-222)     veil 14 s
 *
 * The whole difference is js/slopes.js: it draws 3,294,128 triangles and
 * 2,570,081 of them are js/slopes-apartments.js, non-indexed, at 22 floats a
 * vertex — 679 MB of attribute buffer for one generator. See js/mobile.js.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { chromePath } from './chrome.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = process.env.VERIFY_URL || 'http://127.0.0.1:8099';
const WAIT = +(process.env.VERIFY_WAIT || 240000);
const STUB = process.env.VERIFY_STUB === '1';
const ARMS = process.argv.slice(2).length ? process.argv.slice(2) : [''];

// A phone, not a narrow desktop window: js/mobile.js asks for a coarse pointer
// AND a touch digitiser, and a context without both is a desktop to it.
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };

const STUB_LIBS = {
  'maplibre-gl.css': 'maplibre-gl/dist/maplibre-gl.css',
  'maplibre-gl.js': 'maplibre-gl/dist/maplibre-gl.js',
  'pmtiles.js': 'pmtiles/dist/pmtiles.js',
  'three.min.js': 'three/build/three.min.js',
};

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || chromePath(),
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
         '--enable-unsafe-swiftshader', '--disable-dev-shm-usage',
         // Without this `window.gc` is absent and every reading is allocator
         // noise rather than retained memory.
         '--js-flags=--expose-gc'],
});

const rows = [];
for (const arm of ARMS) {
  const ctx = await browser.newContext(PHONE);
  if (STUB) {
    const modules = process.env.VERIFY_STUB_MODULES || path.join(ROOT, 'node_modules');
    await ctx.route('https://unpkg.com/**', (r) => {
      const url = r.request().url();
      const key = Object.keys(STUB_LIBS).find(k => url.endsWith(k));
      if (!key) return r.abort();
      return r.fulfill({
        status: 200,
        contentType: key.endsWith('.css') ? 'text/css' : 'application/javascript',
        body: fs.readFileSync(path.join(modules, STUB_LIBS[key])),
      });
    });
    await ctx.route('https://tiles.openfreemap.org/**', (r) => (
      r.request().url().includes('/styles/liberty')
        ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
            version: 8, name: 'stub', sources: {},
            layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#0d1117' } }],
          })})
        : r.abort()
    ));
  }

  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  page.on('crash', () => errs.push('*** PAGE CRASHED ***'));

  const t0 = Date.now();
  // An arm may be a full URL, so two servers (e.g. main and a branch) can be
  // interleaved in one run: node mobile-budget.mjs http://a/?x http://b/?x ...
  await page.goto(/^https?:/.test(arm) ? arm : BASE + '/' + arm, { waitUntil: 'load', timeout: WAIT });

  // The app's own "the city is built" signal, so every arm is read at the same
  // point in its life rather than after a fixed sleep.
  let veil = null;
  const deadline = Date.now() + WAIT;
  while (Date.now() < deadline) {
    const lifted = await page.evaluate(() => {
      const v = document.getElementById('veil');
      return !v || getComputedStyle(v).opacity === '0' || v.style.display === 'none';
    }).catch(() => false);
    if (lifted) { veil = Date.now() - t0; break; }
    await page.waitForTimeout(500);
  }
  // Since 2026-09-19 a phone can lift the veil BEFORE the authored buildings
  // land (js/mobile.js LITE.lateAuthored). Reading the heap then would measure
  // a scene without its biggest layer and look better for it. Wait for them.
  let landed = null;
  while (Date.now() < deadline) {
    const done = await page.evaluate(() => !(window.SLOPES && window.SLOPES.on) || !(window.APARTMENTS && window.APARTMENTS.on) ||
      !!(window.slopesApartments && window.slopesApartments.group)).catch(() => false);
    if (done) { landed = Date.now() - t0; break; }
    await page.waitForTimeout(500);
  }

  await page.waitForTimeout(2000);
  await page.evaluate(() => { if (window.gc) { window.gc(); window.gc(); } }).catch(() => {});
  await page.waitForTimeout(1500);

  const m = await page.evaluate(() => ({
    heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
    limit: performance.memory ? Math.round(performance.memory.jsHeapSizeLimit / 1048576) : null,
    lite: window.LITE_PROFILE || null,
    // js/mobile.js puts the visitor's own URL back after boot, so the profile
    // that was in force is LITE_PROFILE.applied, not location.search.
    search: location.search + (window.LITE_PROFILE && window.LITE_PROFILE.applied.length ? '  [+' + window.LITE_PROFILE.applied.join('&') + ']' : ''),
    slopes: window.slopes && window.slopes.stats ? window.slopes.stats().triangles : 0,
  }));

  rows.push({ arm: arm || '(default)', ...m, veilMs: veil, landedMs: landed, errors: errs });
  await ctx.close();
}
await browser.close();

console.log(`base ${BASE}${STUB ? '   [VERIFY_STUB=1: stubbed basemap, absolute heap is a floor]' : ''}`);
console.log('');
console.log('arm'.padEnd(26), 'heap MB'.padStart(8), 'veil'.padStart(9), 'landed'.padStart(9), 'slopes tris'.padStart(12), '  effective query');
for (const r of rows) {
  console.log(
    r.arm.padEnd(26),
    String(r.heap).padStart(8),
    (r.veilMs === null ? 'NEVER' : r.veilMs + ' ms').padStart(9),
    (r.landedMs === null ? 'NEVER' : r.landedMs + ' ms').padStart(9),
    String(r.slopes).padStart(12),
    '  ' + (r.search || '(none)'),
  );
  for (const e of r.errors) console.log('   ! ' + e);
}
console.log('');
console.log('heap limit in this browser:', rows[0] && rows[0].limit, 'MB — a phone is nowhere near it.');
