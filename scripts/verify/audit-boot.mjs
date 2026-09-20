/**
 * audit-boot.mjs — first load, as a stranger sees it: every request, every
 * console error, when the veil lifts, and two frames after it.
 *
 *   node audit-boot.mjs <label> <site> <outDir> [--lite] [--query "&x=1"]
 *
 *   <site>   http://127.0.0.1:8671  or  https://flyover-utx.vercel.app
 *   --lite   the phone profile: 390x844 at DPR 2, touch, and ?lite=1
 *
 * Read-only against any site: it loads the page in a FRESH context (no
 * storage, no cache) and records. It never clicks and never submits.
 *
 * Requests are taken from the CONTEXT, not the page, so a dedicated worker's
 * fetches (MapLibre's tiles) are counted too; CLAUDE.md records a page-scoped
 * session under-reporting a load by 19 MB. `bytes` is the decoded body size
 * Playwright reports at `requestfinished`, so a 304/cache hit is not counted at
 * full price.
 *
 * Output: <outDir>/<label>.json and <label>-veil.jpg / <label>-settled.jpg.
 * Exit 0 always when it ran (it is an audit, not a gate); 2 on bad args.
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { launch } from './chrome.mjs';

const [label, site, outDir] = process.argv.slice(2);
if (!label || !site || !outDir) { console.error('usage: audit-boot.mjs <label> <site> <outDir> [--lite] [--query q]'); process.exit(2); }
const LITE = process.argv.includes('--lite');
const qi = process.argv.indexOf('--query');
const EXTRA = qi > 0 ? process.argv[qi + 1] : '';
fs.mkdirSync(outDir, { recursive: true });

const browser = await launch(chromium, { gl: 'hardware', maxMs: 420000 });
const ctx = await browser.newContext(LITE
  ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
  : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();

const T0 = Date.now();
const t = () => +((Date.now() - T0) / 1000).toFixed(2);
const origin = new URL(site).origin;
const short = u => u.startsWith(origin) ? u.slice(origin.length) : u;
const reqs = new Map();
const consoleMsgs = [], pageErrors = [];

ctx.on('request', r => reqs.set(r, { url: short(r.url()), method: r.method(), type: r.resourceType(), t0: t() }));
ctx.on('requestfinished', async r => {
  const e = reqs.get(r); if (!e) return;
  try {
    const res = await r.response();
    e.status = res ? res.status() : null;
    e.cache = res ? (res.headers()['cache-control'] || '') : '';
    const s = await r.sizes();
    e.bytes = s.responseBodySize;
  } catch (err) { e.err = String(err.message || err); }
  e.t1 = t();
});
ctx.on('requestfailed', r => {
  const e = reqs.get(r); if (!e) return;
  e.failure = r.failure() ? r.failure().errorText : 'failed';
  e.t1 = t();
});
page.on('console', m => {
  if (m.type() === 'error' || m.type() === 'warning')
    consoleMsgs.push({ t: t(), type: m.type(), text: m.text().slice(0, 400) });
});
page.on('pageerror', e => pageErrors.push({ t: t(), text: String(e.message).slice(0, 400) }));

const url = site.replace(/\/$/, '') + '/?drift=0' + (LITE ? '&lite=1' : '') + EXTRA;
console.log(`[audit-boot] ${label}: ${url}`);
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });

// Poll the app's own signals. The veil element is REMOVED after its fade.
const marks = {};
const deadline = Date.now() + 240000;
while (Date.now() < deadline) {
  const s = await page.evaluate(() => {
    const v = document.getElementById('veil');
    const gone = !v || v.classList.contains('gone') || v.style.display === 'none' || getComputedStyle(v).opacity === '0';
    let ready = null;
    try { ready = window.slopesApartments ? !!window.slopesApartments.readyToReveal() : null; } catch (e) { ready = 'threw'; }
    return { gone, ready, map: !!window.__map, style: !!(window.__map && window.__map.isStyleLoaded && window.__map.isStyleLoaded()) };
  }).catch(() => null);
  if (s) {
    if (s.map && marks.map == null) marks.map = t();
    if (s.style && marks.style == null) marks.style = t();
    if (s.ready === true && marks.ready == null) marks.ready = t();
    if (s.gone && marks.veilGone == null) { marks.veilGone = t(); break; }
  }
  await page.waitForTimeout(250);
}
await page.waitForTimeout(1000);
await page.screenshot({ path: path.join(outDir, label + '-veil.jpg'), type: 'jpeg', quality: 80 });
// Settle: the intro flight runs ~10 s after the veil; take the frame after it.
await page.waitForTimeout(14000);
await page.screenshot({ path: path.join(outDir, label + '-settled.jpg'), type: 'jpeg', quality: 80 });
await page.waitForTimeout(1000);
await page.screenshot({ path: path.join(outDir, label + '-settled.jpg'), type: 'jpeg', quality: 80 });

const state = await page.evaluate(() => {
  const m = window.__map;
  const out = {
    lite: window.LITE_PROFILE || null,
    href: location.search,
    gfx: window.GFX ? { preset: window.GFX.preset, renderScale: window.GFX.renderScale, autoDetected: window.GFX.autoDetected } : null,
    pixelRatio: m && m.getPixelRatio ? m.getPixelRatio() : null,
    layers: m ? m.getStyle().layers.length : null,
    apartments: window.slopesApartments ? { done: window.slopesApartments.count.done, buildings: window.slopesApartments.count.buildings, triangles: window.slopesApartments.count.triangles, warnings: (window.slopesApartments.count.warnings || []).slice(0, 20) } : null,
    cityLighting: window.CityLighting ? { ...window.CityLighting.stats, failures: window.CityLighting.stats.failures.slice(0, 10) } : null,
    storage: (() => { try { return Object.keys(localStorage); } catch (e) { return 'threw'; } })(),
  };
  try { const gl = m.getCanvas().getContext('webgl2'); out.ctx = gl.getContextAttributes(); } catch (e) {}
  return out;
});

const list = [...reqs.values()].sort((a, b) => a.t0 - b.t0);
const bad = list.filter(r => r.failure || (r.status != null && r.status >= 400));
const summary = {
  label, url, lite: LITE, marks, requests: list.length,
  bytes: list.reduce((s, r) => s + (r.bytes || 0), 0),
  byStatus: list.reduce((o, r) => { const k = r.failure ? 'failed' : String(r.status); o[k] = (o[k] || 0) + 1; return o; }, {}),
  bad, consoleErrors: consoleMsgs.filter(m => m.type === 'error'), consoleWarnings: consoleMsgs.filter(m => m.type === 'warning').length,
  pageErrors, state,
};
fs.writeFileSync(path.join(outDir, label + '.json'), JSON.stringify({ ...summary, list }, null, 1));
console.log(JSON.stringify({ ...summary, consoleWarnings: consoleMsgs.filter(m => m.type === 'warning').slice(0, 15) }, null, 1).slice(0, 6000));
await browser.__done();
