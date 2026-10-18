/**
 * v2-street-shots.mjs - before/after pictures of the v2 street layers (aerial ground, street furniture, trees) at street level and
 * from about 150 m up, in West Campus, on the Drag (Guadalupe), the South Mall and downtown.
 *
 *   VERIFY_GL=hardware VERIFY_URL=https://flyover-utx.vercel.app node scripts/verify/v2-street-shots.mjs OUT_DIR [--q "aerial=0"] [--tag before] [--dpr 2] [view ...]
 *   (with VERIFY_OUT set, as on the AWS GPU runner, every argument after the options names a view)
 *
 * A view is shot after the camera is placed, every Blender tile AND every aerial tile in view has finished loading (3 polls in a row;
 * window.__v2ground.stats()), and the frame has been drawn twice (README: screenshot twice, trust the second). Pictures are checked
 * for being blank. Instrument settings are printed: renderer string, viewport, device scale factor, query.
 * The page's own clock and nothing else: no throttling. A manual hardware tool, not a CI check (it needs a real GPU and the network).
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { launch, BASE } from './chrome.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); if (i < 0) return d; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const Q = opt('--q', '');
const TAG = opt('--tag', '');
const DPR = +opt('--dpr', 2);
// the output folder: VERIFY_OUT (the AWS GPU runner sets it) or the first argument; the rest name views
const OUT = process.env.VERIFY_OUT || argv.shift() || 'v2-street-shots';
const ONLY = argv;
fs.mkdirSync(OUT, { recursive: true });

const D = { w: 1440, h: 900, dpr: DPR };
// target [x, z] in v2 metres (v2/geo.js: x east, z SOUTH of the origin at the UT Tower), distance m, polar deg (0 = straight down), azimuth
// deg (the camera sits at target + this bearing: 0 = south of the target looking north, 90 = east looking west)
const VIEWS = [
  // street views: the camera stands in the street about 45 m back from a crossing, 8 m up, looking along the street
  // (Austin's grid: West Campus and the Drag run 4.7 degrees east of north, Congress 18 degrees)
  { name: 'wc-street', xz: [-515, -213], distance: 45, polar: 80, azimuth: 355 },        // Rio Grande at 24th, looking north
  { name: 'wc-150m', xz: [-450, -200], distance: 300, polar: 60, azimuth: 200 },
  { name: 'drag-street', xz: [-252, 246], distance: 45, polar: 80, azimuth: 355 },       // Guadalupe at 21st, looking north up the Drag
  { name: 'drag-150m', xz: [-235, 30], distance: 300, polar: 60, azimuth: 250 },
  { name: 'southmall-street', xz: [0, 110], distance: 50, polar: 80, azimuth: 0 },        // the South Mall, looking north to the Tower
  { name: 'southmall-150m', xz: [0, 150], distance: 300, polar: 60, azimuth: 20 },
  { name: 'downtown-street', xz: [-335, 1997], distance: 45, polar: 80, azimuth: 342 },   // Congress at 6th, looking north to the Capitol
  { name: 'downtown-150m', xz: [-320, 1950], distance: 300, polar: 60, azimuth: 30 },
  { name: 'speedway-150m', xz: [240, -420], distance: 300, polar: 60, azimuth: 200 },
  // eye level: a camera 1.8 m up in the street, 40 m before a crossing, looking along the street (compass heading). The app's own
  // controls stop at 4.3 m (main.js VIEW: 25 m from the target, 80 degrees); these pictures lift that limit for the shot only.
  { name: 'drag-eye', eye: [-255.5, 285.6, 4.7, 1.8] },          // Guadalupe, looking north to 21st
  { name: 'speedway-eye', eye: [243.9, -424.5, 184.8, 1.8] },    // Speedway, looking south to Dean Keeton
  { name: 'congress-eye', eye: [-347.5, 2034.8, 18, 1.8] },      // Congress, looking north to 6th and the Capitol
  { name: 'wc-eye', eye: [-757.2, -234.2, 94.5, 1.8] },          // West 24th, looking east past Pearl
].filter((v) => !ONLY.length || ONLY.some((o) => v.name.includes(o)));

const browser = await launch(chromium, { gl: process.env.VERIFY_GL || 'hardware', maxMs: 900000 });
const results = [];
for (const v of VIEWS) {
  const ctx = await browser.newContext({ viewport: { width: D.w, height: D.h }, deviceScaleFactor: D.dpr });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console] ' + m.text()); });
  const failedReq = [];
  page.on('response', (r) => { if (r.status() >= 400) failedReq.push(r.status() + ' ' + r.url()); });
  await page.goto(`${BASE.replace(/\/$/, '')}/v2/?intro=0${Q ? '&' + Q : ''}`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__v2 && window.__v2.ready, null, { timeout: 120000 });
  await page.evaluate(() => window.__v2.ready);
  if (v.eye) {
    await page.evaluate(([x, z, hdg, h]) => {
      const { controls, THREE } = window.__v2, r = THREE.MathUtils.degToRad(hdg), ahead = 30;
      controls.minDistance = 1; controls.maxPolarAngle = THREE.MathUtils.degToRad(89.5);
      window.__v2.placeCamera({ target: [x + Math.sin(r) * ahead, 0, z - Math.cos(r) * ahead], distance: Math.hypot(ahead, h),
        polarDeg: THREE.MathUtils.radToDeg(Math.atan2(ahead, h)), azimuthDeg: -hdg });
    }, v.eye);
  } else {
    await page.evaluate(([x, z, d, p, a]) => window.__v2.placeCamera({ target: [x, 0, z], distance: d, polarDeg: p, azimuthDeg: a }), [v.xz[0], v.xz[1], v.distance, v.polar, v.azimuth]);
  }
  let calm = 0; const t0 = Date.now(); let g = null;
  while (calm < 3 && Date.now() - t0 < 150000) {
    const s = await page.evaluate(() => { window.__v2.redraw(); return { t: window.__v2.tiles(), g: window.__v2ground ? window.__v2ground.stats() : null }; });
    g = s.g;
    const groundCalm = !g || g.failed || (g.index && g.missing === 0 && g.loading === 0 && g.waitingUpload === 0 && g.queued === 0);
    calm = s.t && s.t.loading === 0 && groundCalm ? calm + 1 : 0;
    await page.waitForTimeout(700);
  }
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.__v2.redraw());
  await page.screenshot({ path: path.join(OUT, v.name + '.tmp.png') });
  await page.waitForTimeout(800);
  const file = path.join(OUT, (TAG ? TAG + '-' : '') + v.name + '.png');
  await page.screenshot({ path: file });
  fs.rmSync(path.join(OUT, v.name + '.tmp.png'), { force: true });
  const info = await page.evaluate(() => {
    const gl = window.__v2.renderer.getContext(); const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return { ...window.__v2.info(), ground: window.__v2ground ? window.__v2ground.stats() : null, renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
  });
  results.push({ view: v.name, file, query: Q, viewport: `${D.w}x${D.h}@${D.dpr}`, canvas: info.size, draws: info.calls, triangles: info.triangles, renderer: info.renderer,
    ground: info.ground && { shown: info.ground.shown, byZoom: info.ground.byZoom, liveOk: info.ground.liveOk, liveFail: info.ground.liveFail, localOk: info.ground.localOk, missing: info.ground.missing },
    settledMs: Date.now() - t0, errors: errs.slice(0, 3), http_errors: failedReq.slice(0, 3) });
  await ctx.close();
}
await browser.close();
for (const r of results) console.log(JSON.stringify(r));
const bad = results.filter((r) => r.errors.length);
if (bad.length) { console.log('*FAIL (page errors)', bad.map((b) => b.view).join(', ')); process.exit(1); }
console.log(`${results.length} pictures`);
