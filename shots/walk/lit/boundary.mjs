/**
 * boundary.mjs — the band round 3 left out, which is the band that matters.
 *
 * Round 3's confusion matrix (docs/walk-lit.md §18) sampled "unmapped" sites
 * only where the nearest counted lamp is more than 60 m away, "clear of the
 * 25 m boundary on purpose, so the sample tests the claim rather than the
 * arithmetic either side of it". That is a fair thing to do and it means the
 * clean result was obtained on the easy half of the problem.
 *
 * The hard half is the band from `litRadiusM` (25 m) out to 60 m: places the
 * card calls unmapped where a mapped street lamp is standing just off the
 * radius. If a lamp is plainly visible from the pavement there, then "no
 * mapped streetlight along this route" is true about the index and misleading
 * about the walk, and the honest fixes are a wider radius or a different
 * sentence — not a quieter test.
 *
 * So: sample sites inside the band, fly to each at night, and count how often
 * a warm street lamp is actually on screen at the pose a person would stand in.
 * This test has no pass/fail. It is a measurement, and the number decides.
 *
 * Usage: VERIFY_URL=http://127.0.0.1:8714 node shots/walk/lit/boundary.mjs [n]
 */
import fs from 'node:fs';
import { chromium } from '../../../scripts/verify/node_modules/playwright-core/index.mjs';
import { BASE, launch } from '../../../scripts/verify/chrome.mjs';

const OUT = 'shots/walk/lit';
const NIGHT = 0.92, ZOOM = 19.8;
const BAND = [25, 60];       // metres from the nearest counted warm lamp
const WANT = Number(process.argv[2] || 18);
const LAMP_GREEN_MIN = 200;  // same bar as round 3 / strip-scene

// ── decode the shipped index in node, so "nearest lamp" is measured against
//    the very file the card counts from, not against a re-derivation.
const J = JSON.parse(fs.readFileSync('data/walk_lamps.json', 'utf8'));
const q = J.q || 1e-6;
const dec = (o) => {
  const xs = (o && o.x) || [], ys = (o && o.y) || [];
  const X = [], Y = []; let ax = 0, ay = 0;
  for (let i = 0; i < xs.length; i++) { ax += xs[i]; ay += ys[i]; X.push(ax * q); Y.push(ay * q); }
  return { X, Y, n: X.length };
};
const WARM = dec(J.warm);
const MPD_LAT = 111320, MPD_LON = 111320 * Math.cos(30.285 * Math.PI / 180);
const nearestWarm = (lon, lat) => {
  let best = Infinity;
  for (let i = 0; i < WARM.n; i++) {
    const dx = (WARM.X[i] - lon) * MPD_LON, dy = (WARM.Y[i] - lat) * MPD_LAT;
    const d = Math.hypot(dx, dy);
    if (d < best) best = d;
  }
  return best;
};
console.log(`index: ${WARM.n} warm street lamps, band ${BAND[0]}-${BAND[1]} m`);

const CODES = Object.keys(JSON.parse(fs.readFileSync('data/walk_graph.json', 'utf8')).code);
let seed = 4041;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

const browser = await launch(chromium, { gl: 'hardware' });
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto(BASE + '/_harness.html?intro=0&drift=0&walk=1', { waitUntil: 'networkidle', timeout: 180000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
await page.evaluate(() => { if (window.cancelGraphicsAutoDetect) window.cancelGraphicsAutoDetect(); });
await page.waitForFunction(() => !document.getElementById('veil'), null, { timeout: 120000 });
await page.evaluate((p) => {
  const el = document.getElementById('tod-slider');
  if (el) { el.value = String(p); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
  if (typeof window.applyTimeOfDay === 'function') window.applyTimeOfDay(window.__map, p, true);
}, NIGHT);
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const r = document.getElementById('wf-root');
  if (r) r.style.display = 'none';    // never measure through the card
});

// ── collect candidate sites off real routes ───────────────────────────────
const sites = [];
const tried = new Set();
for (let attempt = 0; attempt < 90 && sites.length < WANT; attempt++) {
  const a = CODES[Math.floor(rnd() * CODES.length)], b = CODES[Math.floor(rnd() * CODES.length)];
  if (a === b || tried.has(a + b)) continue;
  tried.add(a + b);
  const runs = await page.evaluate(async ([f, t]) => {
    const res = await window.wayfindRoute(f, t, {});
    if (!res.ok) return null;
    const lit = await window.wayfindLit();
    return lit.ok ? lit.runsAt.filter(r => !r.lit) : null;
  }, [a, b]);
  if (!runs) continue;
  for (const run of runs) {
    for (const ll of run.line) {
      const d = nearestWarm(ll[0], ll[1]);
      if (d >= BAND[0] && d < BAND[1]) {
        // one site per run, so a single long run cannot fill the sample
        sites.push({ from: a, to: b, ll, nearestM: +d.toFixed(1) });
        break;
      }
    }
    if (sites.length >= WANT) break;
  }
}
console.log(`sites in the band: ${sites.length} (from ${tried.size} routes tried)`);

// ── look at each one ──────────────────────────────────────────────────────
const rows = [];
for (let i = 0; i < sites.length; i++) {
  const s = sites[i];
  await page.evaluate(([ll, z]) => { window.__map.jumpTo({ center: ll, zoom: z, pitch: 0, bearing: 0 }); }, [s.ll, ZOOM]);
  await page.waitForTimeout(700);
  await page.evaluate(() => new Promise((r) => { const t = setTimeout(r, 2500); window.__map.once('idle', () => { clearTimeout(t); r(); }); }));
  const disc = await page.evaluate(([ll, rad]) => {
    const m = window.__map, c = m.project(ll);
    const dLon = rad / (111320 * Math.cos(ll[1] * Math.PI / 180));
    return { cx: c.x, cy: c.y, r: Math.abs(m.project([ll[0] + dLon, ll[1]]).x - c.x) };
  }, [s.ll, 25]);
  const base = await page.screenshot({ clip: { x: 0, y: 0, width: 960, height: 600 } });
  await page.evaluate(() => {
    const m = window.__map; m.__save = {};
    const paint = {
      'props-lit': ['match', ['get', 'c'], 'blue', '#0000ff', '#00ff00'],
      'props-lit-core': ['match', ['get', 'c'], 'blue', '#0000ff', '#00ffff'],
    };
    for (const id of Object.keys(paint)) {
      if (!m.getLayer(id)) continue;
      m.__save[id] = { color: m.getPaintProperty(id, 'circle-color'), op: m.getPaintProperty(id, 'circle-opacity') };
      m.setPaintProperty(id, 'circle-color', paint[id]);
      m.setPaintProperty(id, 'circle-opacity', 1);
    }
  });
  await page.waitForTimeout(600);
  const mask = await page.screenshot({ clip: { x: 0, y: 0, width: 960, height: 600 } });
  await page.evaluate(() => {
    const m = window.__map;
    for (const id of Object.keys(m.__save || {})) {
      m.setPaintProperty(id, 'circle-color', m.__save[id].color);
      m.setPaintProperty(id, 'circle-opacity', m.__save[id].op);
    }
  });
  // Two windows: the 25 m disc the card's claim is ABOUT, and the whole frame,
  // which is what a person standing there can see. The card can be right about
  // the first and still surprise somebody about the second, and that gap is the
  // entire question this script exists to size.
  const px = await page.evaluate(async ([b64a, b64b, cx, cy, r]) => {
    const load = (b) => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,' + b; });
    const [A, B] = await Promise.all([load(b64a), load(b64b)]);
    const im = (I) => { const c = document.createElement('canvas'); c.width = I.width; c.height = I.height; c.getContext('2d').drawImage(I, 0, 0); return c.getContext('2d').getImageData(0, 0, I.width, I.height).data; };
    const a = im(A), b = im(B), W = A.width, H = A.height, sx = W / 960;
    const PX = cx * sx, PY = cy * sx, PR = r * sx;
    let inDisc = 0, inFrame = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (a[i] === b[i] && a[i + 1] === b[i + 1] && a[i + 2] === b[i + 2]) continue;
      const R = b[i], G = b[i + 1], Bl = b[i + 2], mx = Math.max(R, G, Bl);
      if (mx < 12) continue;
      const hiR = R > mx * .55, hiG = G > mx * .55, hiB = Bl > mx * .55;
      if (!(hiG && !hiB && !hiR)) continue;   // the warm lamp's POOL only
      inFrame++;
      const dx = x - PX, dy = y - PY;
      if (dx * dx + dy * dy <= PR * PR) inDisc++;
    }
    return { inDisc, inFrame };
  }, [base.toString('base64'), mask.toString('base64'), disc.cx, disc.cy, disc.r]);
  const row = { ...s, ...px, seen: px.inFrame >= LAMP_GREEN_MIN };
  rows.push(row);
  // Keep a frame for every site that shows a lamp, and the first two that do
  // not — a failure nobody can look at is a number, and so is a pass.
  if (row.seen || i < 2) {
    fs.writeFileSync(`${OUT}/r4-band-${String(i).padStart(2, '0')}-${Math.round(s.nearestM)}m.png`, base);
  }
  console.log(`  ${String(i).padStart(2)}  ${s.from}->${s.to}  nearest counted lamp ${s.nearestM} m` +
    `   pool px: in the 25 m disc ${px.inDisc}, anywhere in frame ${px.inFrame}   ${row.seen ? 'LAMP VISIBLE' : '-'}`);
}

const seen = rows.filter(r => r.seen);
const inDisc = rows.filter(r => r.inDisc >= LAMP_GREEN_MIN);
console.log(`\nsites measured: ${rows.length}`);
console.log(`  a warm lamp is somewhere in frame:            ${seen.length} / ${rows.length}`);
console.log(`  ...and inside the 25 m disc the claim is about: ${inDisc.length} / ${rows.length}`);
if (rows.length) {
  const ds = rows.map(r => r.nearestM).sort((a, b) => a - b);
  console.log(`  nearest-lamp distance across the sample: min ${ds[0]} m, median ${ds[Math.floor(ds.length / 2)]} m, max ${ds[ds.length - 1]} m`);
}
fs.writeFileSync(`${OUT}/r4-band.json`, JSON.stringify({ band: BAND, zoom: ZOOM, greenMin: LAMP_GREEN_MIN, rows, errs }, null, 1));
console.log('errors:', errs.length ? errs.slice(0, 3) : 'none');
await browser.close();
