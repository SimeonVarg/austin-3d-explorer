/**
 * v2-shots.mjs - pictures of the v2 app (/v2/), from a place by building name, with the page's own hooks (window.__v2).
 *
 *   VERIFY_GL=hardware VERIFY_URL=https://flyover-utx.vercel.app node scripts/verify/v2-shots.mjs OUT_DIR [view ...]
 *
 * Views (name = slug in v2/tiles/manifest.json, or a fixed pose): each is { slug | target, distance, polar, azimuth, w, h, dpr }.
 * A view is shot only after the camera is placed, every tile has finished loading (3 polls in a row), and the frame has been drawn twice
 * (README: screenshot twice, trust the second). The picture is checked for being blank (one colour over 70 % of it) and the run FAILS if so.
 * Instrument settings are printed with the result: GL renderer string, viewport, device scale factor.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { launch, BASE } from './chrome.mjs';

const OUT = process.argv[2] || 'v2-shots';
const ONLY = process.argv.slice(3);
fs.mkdirSync(OUT, { recursive: true });

const DESKTOP = { w: 1440, h: 900, dpr: 2 };
const PHONE = { w: 390, h: 844, dpr: 3 };
const VIEWS = [
  { name: '1-opening-desktop', ...DESKTOP, pose: 'start' },
  { name: '2-dkr-close-desktop', ...DESKTOP, slug: 'dkr-memorial-stadium', distance: 330, polar: 58, azimuth: 235 },
  { name: '3-dkr-and-surroundings-desktop', ...DESKTOP, slug: 'dkr-memorial-stadium', distance: 900, polar: 48, azimuth: 200 },
  { name: '4-campus-museum-desktop', ...DESKTOP, slug: 'texas-memorial-museum', distance: 260, polar: 60, azimuth: 150 },
  { name: '5-west-campus-desktop', ...DESKTOP, slug: 'the-venue', distance: 380, polar: 55, azimuth: 30 },
  { name: '6-downtown-phone', ...PHONE, slug: 'frost-bank-tower', distance: 900, polar: 58, azimuth: 300 },
].filter((v) => !ONLY.length || ONLY.some((o) => v.name.includes(o)));

const browser = await launch(chromium, { gl: process.env.VERIFY_GL || 'hardware', maxMs: 600000 });
const results = [];
for (const v of VIEWS) {
  const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h }, deviceScaleFactor: v.dpr, isMobile: v.w < 600, hasTouch: v.w < 600 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console] ' + m.text()); });
  const failedReq = [];
  page.on('response', (r) => { if (r.status() >= 400) failedReq.push(r.status() + ' ' + r.url()); });
  await page.goto(`${BASE.replace(/\/$/, '')}/v2/`, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => window.__v2 && window.__v2.ready, null, { timeout: 90000 });
  await page.evaluate(() => window.__v2.ready);
  const man = await page.evaluate(() => fetch('./tiles/manifest.json').then((r) => r.json()));
  if (v.slug) {
    const b = man.buildings[v.slug];
    if (!b) throw new Error('no building ' + v.slug + ' in the manifest');
    await page.evaluate(([x, z, d, p, a]) => window.__v2.placeCamera({ target: [x, 0, z], distance: d, polarDeg: p, azimuthDeg: a }), [b.x, b.z, v.distance, v.polar, v.azimuth]);
  }
  // all tiles finished loading, 3 polls in a row
  let calm = 0; const t0 = Date.now();
  while (calm < 3 && Date.now() - t0 < 120000) {
    const s = await page.evaluate(() => window.__v2.tiles());
    calm = s && s.loading === 0 ? calm + 1 : 0; await page.waitForTimeout(700);
  }
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, v.name + '.tmp.png') });      // first one drawn: thrown away
  await page.waitForTimeout(800);
  const file = path.join(OUT, v.name + '.png');
  await page.screenshot({ path: file });
  fs.rmSync(path.join(OUT, v.name + '.tmp.png'), { force: true });
  const info = await page.evaluate(() => {
    const gl = window.__v2.renderer.getContext(); const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return { ...window.__v2.info(), tiles: window.__v2.tiles(), renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
  });
  // blank check on the picture: share of the most common colour (8-level buckets), from the canvas readback
  const blank = await page.evaluate(() => {
    const c = document.createElement('canvas');
    return new Promise((res) => { window.__v2.redraw(); requestAnimationFrame(() => {   // (the page's own frame runs first in this frame; the drawing buffer is read before it is presented)
      const src = window.__v2.renderer.domElement; c.width = 160; c.height = Math.round(160 * src.height / src.width);
      const g = c.getContext('2d'); g.drawImage(src, 0, 0, c.width, c.height); const d = g.getImageData(0, 0, c.width, c.height).data; const h = {}; let n = 0, max = 0;
      for (let i = 0; i < d.length; i += 4) { const k = (d[i] >> 3) + ',' + (d[i + 1] >> 3) + ',' + (d[i + 2] >> 3); h[k] = (h[k] || 0) + 1; n++; if (h[k] > max) max = h[k]; }
      res(max / n);
    }); });
  });
  results.push({ view: v.name, file, viewport: `${v.w}x${v.h}@${v.dpr}`, canvas: info.size, tiles: `${info.tiles.lod0} lod0 / ${info.tiles.lod1} lod1 of ${info.tiles.tiles}, ${info.tiles.failed} failed`, triangles: info.triangles, draws: info.calls,
    renderer: info.renderer, commonColourShare: +blank.toFixed(2), errors: errs.slice(0, 3), http_errors: failedReq.slice(0, 3) });
  await ctx.close();
}
await browser.close();
for (const r of results) console.log(JSON.stringify(r));
const bad = results.filter((r) => r.commonColourShare > 0.7 || r.errors.length || r.http_errors.length || /swiftshader/i.test(r.renderer));
if (bad.length) { console.log('*FAIL', bad.map((b) => b.view).join(', ')); process.exit(1); }
console.log(`${results.length}/${results.length} pictures ok (not blank, no console or http errors, hardware renderer)`);
