/**
 * herowhere.mjs — re-shoot the H1 spawn hero pose on both arms and answer the
 * ONE question the pixel count cannot: are the changed pixels ONLY doorways?
 *
 * "447 pixels changed, 0.04 % of frame" is not evidence of anything on its own.
 * A gate exists to catch UNINTENDED drift, so clearing it honestly means showing
 * that every changed pixel sits where a door was deliberately added — not that
 * the total is small.
 *
 * Method:
 *   1. Same browser, same page, same pose. The BASE arm is produced by routing
 *      js/wayfind.js, data/walk_graph.json and data/entrances.geojson to
 *      origin/main's copies. All THREE matter: swapping only the first two
 *      compares the new doors against themselves and reports "identical".
 *   2. Both arms shot twice, interleaved, so each arm's own cross-launch floor
 *      is measured before any A/B number is believed.
 *   3. The diff is clustered (8-connected flood fill), and every cluster centre
 *      is compared against the projected screen position of the 737 new door
 *      pieces. A cluster near a new door piece is the feature. A cluster that is
 *      NOT near one is unexplained drift, and is reported as such.
 */
import { chromium } from 'playwright-core';
import { chromePath, launch } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';

const PORT = process.env.PORT || '8431';
const SC = process.env.SCRATCH;
const BASE = `http://127.0.0.1:${PORT}/index.html?intro=0&drift=0`;
const outDir = path.resolve(process.argv[2] || 'shots/walk/doors15');
fs.mkdirSync(outDir, { recursive: true });
const SPAWN = { center: [-97.7434, 30.2857], zoom: 16.5, pitch: 74, bearing: 250 };
const NEWDOORS = JSON.parse(fs.readFileSync(path.join(SC, 'newdoor_points.json'), 'utf8'));

const MAIN = {
  '/js/wayfind.js':            path.join(SC, 'main_wayfind.js'),
  '/data/walk_graph.json':     path.join(SC, 'main_walk_graph.json'),
  '/data/entrances.geojson':   path.join(SC, 'entrances_main.geojson'),
};

const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
let arm = 'cand';
await page.route('**/*', route => {
  const u = new URL(route.request().url());
  if (arm === 'base' && MAIN[u.pathname]) {
    return route.fulfill({ status: 200, path: MAIN[u.pathname],
      headers: { 'content-type': u.pathname.endsWith('.js') ? 'application/javascript' : 'application/json' } });
  }
  return route.continue();
});

async function shoot(which, tag) {
  arm = which;
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const m = window.__map;
    if (!m || !m.getSource('austin-buildings')) return false;
    return ['austin-buildings','austin-ground','austin-trees','austin-roofscape','austin-tower',
            'austin-westcampus','austin-drag','austin-arts','austin-moody','austin-stadium']
      .every(s => !m.getSource(s) || m.isSourceLoaded(s));
  }, null, { timeout: 120000 }).catch(() => {});
  await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
  await page.waitForFunction(() => {
    const m = window.__map, s = m.getSource('austin-entrances');
    return !!s && m.isSourceLoaded('austin-entrances');
  }, null, { timeout: 120000 }).catch(() => console.log('WARN ent source'));
  await page.evaluate((S) => {
    const m = window.__map;
    if (m.isEasing && m.isEasing()) m.stop();
    m.jumpTo({ center: S.center, zoom: S.zoom, pitch: S.pitch, bearing: S.bearing });
    if (typeof window.applyTimeOfDay === 'function') window.applyTimeOfDay(m, 0.12);
  }, SPAWN);
  await page.waitForTimeout(4500);
  await page.evaluate(() => new Promise(r => {
    const m = window.__map; if (m.loaded()) return r();
    m.once('idle', r); setTimeout(r, 8000);
  }));
  await page.evaluate(() => window.__map.triggerRepaint());
  await page.waitForTimeout(1500);
  const f = path.join(outDir, `_h1-${tag}.png`);
  await page.screenshot({ path: f });
  await page.waitForTimeout(500);
  await page.screenshot({ path: f });
  return f;
}

// interleaved: base, cand, base, cand — each arm's own floor before any A/B
const b1 = await shoot('base', 'base-r1');
const c1 = await shoot('cand', 'cand-r1');
const b2 = await shoot('base', 'base-r2');
const c2 = await shoot('cand', 'cand-r2');

// project the new door pieces to screen on the candidate arm, for attribution
const proj = await page.evaluate((pts) => {
  const m = window.__map;
  return pts.map(p => { const q = m.project(p); return [Math.round(q.x), Math.round(q.y)]; });
}, NEWDOORS);
fs.writeFileSync(path.join(SC, 'newdoor_screen.json'), JSON.stringify(proj));


// ── pixel work, done in the page on a canvas ────────────────────────────
// The suite has no pngjs and deliberately reads pixels through a canvas
// (crop.mjs does the same). The images must come over http, not file://: a
// setContent page has an opaque origin and the browser refuses to read a
// file:// image back out of a canvas.
const url = f => `http://127.0.0.1:${PORT}/` +
  path.relative(path.resolve('.'), path.resolve(f)).split(path.sep).join('/');

await page.route('**/*', r => r.continue());   // stop serving the base arm
const result = await page.evaluate(async ({ a, b, c, d, proj, R }) => {
  const load = src => new Promise((res, rej) => {
    const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src;
  });
  const px = async (src) => {
    const im = await load(src);
    const cv = document.createElement('canvas'); cv.width = im.width; cv.height = im.height;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(im, 0, 0);
    return cx.getImageData(0, 0, im.width, im.height);
  };
  const [B1, C1, B2, C2] = await Promise.all([px(a), px(b), px(c), px(d)]);
  const diff = (A, B) => {
    const W = A.width, H = A.height, mask = new Uint8Array(W * H);
    let over24 = 0, max = 0;
    for (let i = 0; i < W * H; i++) {
      const o = i * 4;
      const e = Math.max(Math.abs(A.data[o] - B.data[o]),
                         Math.abs(A.data[o+1] - B.data[o+1]),
                         Math.abs(A.data[o+2] - B.data[o+2]));
      if (e > max) max = e;
      if (e > 24) { mask[i] = 1; over24++; }
    }
    return { mask, over24, max, W, H };
  };
  const floorB = diff(B1, B2), floorC = diff(C1, C2);
  const ab1 = diff(B1, C1), ab = diff(B2, C2);
  const { mask, W, H } = ab;
  const seen = new Uint8Array(W * H), clusters = [];
  for (let i = 0; i < W * H; i++) {
    if (!mask[i] || seen[i]) continue;
    const st = [i]; seen[i] = 1; let n = 0, sx = 0, sy = 0;
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    while (st.length) {
      const j = st.pop(); const x = j % W, y = (j / W) | 0;
      n++; sx += x; sy += y;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const k = ny * W + nx;
        if (mask[k] && !seen[k]) { seen[k] = 1; st.push(k); }
      }
    }
    clusters.push({ n, cx: Math.round(sx / n), cy: Math.round(sy / n), x0, x1, y0, y1 });
  }
  clusters.sort((p, q) => q.n - p.n);
  let explained = 0; const unexplained = [];
  for (const cl of clusters) {
    const near = proj.some(([qx, qy]) =>
      qx > cl.x0 - R && qx < cl.x1 + R && qy > cl.y0 - R && qy < cl.y1 + R);
    if (near) explained += cl.n; else unexplained.push(cl);
  }
  return {
    floorB: { over24: floorB.over24, max: floorB.max },
    floorC: { over24: floorC.over24, max: floorC.max },
    ab1: { over24: ab1.over24, max: ab1.max },
    ab: { over24: ab.over24, max: ab.max },
    clusters: clusters.slice(0, 80), nClusters: clusters.length,
    explained, unexplained: unexplained.slice(0, 30),
    unexplainedPx: unexplained.reduce((s, c) => s + c.n, 0),
  };
}, { a: url(b1), b: url(c1), c: url(b2), d: url(c2), proj, R: 26 });

console.log(`FLOOR base r1|r2   over24=${result.floorB.over24}  max=${result.floorB.max}`);
console.log(`FLOOR cand r1|r2   over24=${result.floorC.over24}  max=${result.floorC.max}`);
console.log(`A/B   base|cand r1 over24=${result.ab1.over24}  max=${result.ab1.max}`);
console.log(`A/B   base|cand r2 over24=${result.ab.over24}  max=${result.ab.max}`);
console.log(`\nclusters=${result.nClusters}  changed px=${result.ab.over24}`);
console.log(`explained by an added/removed door piece within 26 px : ${result.explained} px`);
console.log(`UNEXPLAINED: ${result.unexplained.length} clusters, ${result.unexplainedPx} px`);
for (const c of result.unexplained.slice(0, 15))
  console.log(`   n=${String(c.n).padStart(4)} at (${c.cx},${c.cy}) box ${c.x0}..${c.x1} x ${c.y0}..${c.y1}`);
fs.writeFileSync(path.join(SC, 'h1clusters.json'), JSON.stringify(result, null, 1));
await browser.__done();
