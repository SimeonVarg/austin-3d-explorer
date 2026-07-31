/**
 * westcampus-isolate.mjs — ONE labelled render that says where each band went.
 *
 * `queryRenderedFeatures` on a fill-extrusion answers by FOOTPRINT, so it cannot
 * tell you which band owns a pixel — and at a flying pitch it returns 0 anyway.
 * The repo's own answer to "where does this actually go" is to paint it a key
 * colour and take one render, and that is what this does: every band of the
 * stack gets a different flat colour in one frame, next to the same frame drawn
 * normally.
 *
 *   base   red        podium  magenta     tower  green
 *   crown  blue       solids  yellow
 *
 * It also prints the SHARE OF THE FRAME each key colour covers, which is the
 * number that actually matters: a 25 m parking podium that reads as 0.1% of a
 * pose is not doing any work, however correct it is in the data.
 *
 * Usage: node westcampus-isolate.mjs [shotsJson]
 */
import { chromium } from 'playwright-core';
import { chromePath, GL_ARGS, BASE as SERVER } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';

const SHOTS = JSON.parse(fs.readFileSync(process.argv[2] || 'shots-westcampus.json', 'utf8'))
  .filter(s => !/night|golden/.test(s.name));
const outDir = path.resolve('../../shots');
fs.mkdirSync(outDir, { recursive: true });

const KEY = {
  base: '#ff2020', podium: '#ff00ff', tower: '#00d000', crown: '#2060ff', solid: '#ffe000',
};

// Same projection helper as westcampus-shot.mjs: a shot names the point to LOOK
// at and how far in front of the camera to put it, not the map centre.
const FOV_DEG = 58, VIEW_H = 900;
function centerFor(s) {
  if (!s.look) return s.center;
  const lat = s.look[1], zoom = s.zoom ?? 16.5, pitch = s.pitch ?? 64;
  const mpp = 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, zoom);
  const ground = ((VIEW_H / 2) / Math.tan(FOV_DEG * Math.PI / 360)) * mpp * Math.sin(pitch * Math.PI / 180);
  const push = ground - (s.dist ?? 200);
  const b = (s.bearing ?? 0) * Math.PI / 180;
  return [s.look[0] + (push * Math.sin(b)) / (111320 * Math.cos(lat * Math.PI / 180)),
          s.look[1] + (push * Math.cos(b)) / 111320];
}

const browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: GL_ARGS });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.goto(SERVER + '/_harness.html?intro=0&drift=0', { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
await page.waitForFunction(() => window.__map.getSource('austin-westcampus'), null, { timeout: 60000 })
  .catch(() => console.log('WARN: westcampus source never appeared'));
await page.waitForTimeout(8000);
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

// ORDER MATTERS, and getting it wrong wasted a run each way.
//
// 1. Set the hour FIRST. applyWestcampusColors() rewrites wc-solid's colour, so
//    keying before a time-of-day call just paints the key straight back over.
// 2. Turn the post-process stack OFF. With bloom and tone mapping on, a keyed
//    pixel does not come back anywhere near the hex that was set, and the whole
//    frame is pushed warm — a first attempt at scoring these renders classified
//    the sunset sky as "base red" and the tan ground as "solid yellow" and
//    reported 57% / 23% coverage for a pass that covers a few percent. With the
//    stack off, an exact-hex test is exact.
await page.evaluate(() => {
  const m = window.__map;
  window.applyTimeOfDay(m, 0.12, true);
  if (window.GFX) {
    Object.assign(window.GFX, { bloom: false, vignette: false, grain: false,
                                tone: false, ao: false, rays: false });
    if (window.applyGraphics) window.applyGraphics();
  }
});
// The atlas repaint that applyTimeOfDay triggers has to land before we key, or
// the key is written and then overwritten. See westcampus-shot.mjs.
await page.waitForTimeout(5000);
await page.evaluate(() => new Promise(r => {
  const m = window.__map;
  if (m.loaded()) return r();
  m.once('idle', r); setTimeout(r, 12000);
}));

await page.evaluate((KEY) => {
  const m = window.__map;
  m.setPaintProperty('wc-wall', 'fill-extrusion-pattern', null);
  m.setPaintProperty('wc-wall', 'fill-extrusion-color',
    ['match', ['get', 'band'], 'base', KEY.base, 'podium', KEY.podium,
     'tower', KEY.tower, 'crown', KEY.crown, '#ffffff']);
  m.setPaintProperty('wc-solid', 'fill-extrusion-color', KEY.solid);
  m.setLayoutProperty('wc-wall-cap', 'visibility', 'none');
}, KEY);

const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
for (const s of SHOTS) {
  s.center = centerFor(s);
  await page.evaluate((s) => {
    const m = window.__map;
    if (m.isEasing && m.isEasing()) m.stop();
    m.jumpTo({ center: s.center, zoom: s.zoom ?? 16.5, pitch: s.pitch ?? 64, bearing: s.bearing ?? 0 });
  }, s);
  await page.waitForTimeout(4000);
  await page.evaluate(() => new Promise(r => {
    const m = window.__map;
    if (m.loaded()) return r();
    m.once('idle', r); setTimeout(r, 15000);
  }));
  await page.waitForTimeout(1500);
  const file = path.join(outDir, `westcampus-key-${s.name}.png`);
  await page.screenshot({ path: file });
  await page.waitForTimeout(500);
  await page.screenshot({ path: file });

  // Do the reduction IN THE PAGE. Handing a 1440x900 framebuffer back through
  // CDP as an array is 5M numbers; that ran for twenty minutes at 2 GB once.
  const share = await page.evaluate((KEY) => {
    const cv = window.__map.getCanvas();
    const gl = cv.getContext('webgl2') || cv.getContext('webgl');
    const w = cv.width, h = cv.height;
    const buf = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    const keys = Object.entries(KEY).map(([k, v]) => [k,
      [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)]]);
    const n = {}; for (const [k] of keys) n[k] = 0;
    // Match on CHROMATICITY, not on the hex.
    //
    // An exact-hex test scored base and solid correctly and tower/podium/crown
    // at a flat 0% in a frame that visibly contained all five. The reason is
    // fill-extrusion's own per-face lighting: a TOP face comes back near the
    // colour you set, a SIDE face comes back multiplied by its orientation. So
    // the two keys whose surfaces are mostly horizontal passed and the three
    // that are mostly wall failed. Normalising each pixel by its own maximum
    // channel divides that lighting factor straight out.
    const norm = c => { const m = Math.max(...c) || 1; return c.map(v => v / m); };
    const nk = keys.map(([k, c]) => [k, norm(c)]);
    for (let i = 0; i < buf.length; i += 4) {
      const mx = Math.max(buf[i], buf[i + 1], buf[i + 2]);
      if (mx < 40) continue;                       // too dark to classify
      const p0 = buf[i] / mx, p1 = buf[i + 1] / mx, p2 = buf[i + 2] / mx;
      for (const [k, c] of nk) {
        // 0.30, not 0.18. The sun tint is added on top of the face lighting and
        // is warm, so a magenta wall comes back with its green channel lifted;
        // at 0.18 the podium scored 0.015% in a frame where it is plainly a
        // third of the building. Normalising removes the multiplicative part of
        // the lighting, not the additive part.
        if (Math.abs(p0 - c[0]) < 0.30 && Math.abs(p1 - c[1]) < 0.30 &&
            Math.abs(p2 - c[2]) < 0.30) { n[k]++; break; }
      }
    }
    const tot = w * h;
    const out = {};
    for (const k in n) out[k] = +(100 * n[k] / tot).toFixed(3);
    return out;
  }, KEY);
  console.log(s.name.padEnd(16),
    Object.entries(share).map(([k, v]) => k + '=' + v + '%').join('  '));
}
await browser.close();
