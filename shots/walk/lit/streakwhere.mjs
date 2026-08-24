/**
 * streakwhere.mjs — the pixels a whole-frame lamp diff counts are not
 * necessarily AT the site, and this is the run that proves it.
 *
 * `sceneproof.mjs` photographed the middle of the 698 m unmapped run on the
 * GDC -> The Castilian walk home. The card says *"No mapped streetlight along
 * this route"*, the nearest mapped lamp is 208.2 m away, and the masked diff
 * still scored ~3,200 px of light that vanishes when `props-lit` is hidden.
 * The mask (`r7-scene-GDC-unmapped-mask.png`) shows those pixels are one hard-
 * edged diagonal streak in the bottom-right corner plus a scatter on a distant
 * facade — not a pool on the pavement.
 *
 * The question this answers is which ground those pixels are standing on.
 * `map.unproject` turns a screen point back into a coordinate; measure that
 * coordinate against the eye and against `data/walk_lamps.json`, and the
 * mechanism stops being a guess.
 *
 * IT MATTERS BECAUSE §44's EYE COLUMN IS READ THE SAME WAY. Round 6 wrote that
 * the eye column is "read off the masked diff over the whole frame" — because
 * a screen-space disc at a grazing pitch counts things far outside it (§49b).
 * Whole-frame removes that error and introduces this one: at pitch 84 the frame
 * contains hundreds of metres of ground, so "lamplight in the frame you
 * actually see" is true and "lamplight at this site" is not the same sentence.
 *
 * Usage: VERIFY_URL=http://127.0.0.1:8814 node shots/walk/lit/streakwhere.mjs
 */
import fs from 'node:fs';
import { chromium } from '../../../scripts/verify/node_modules/playwright-core/index.mjs';
import { BASE, launch } from '../../../scripts/verify/chrome.mjs';

const OUT = 'shots/walk/lit';
const NIGHT = 0.92;
const EYE = { pitch: 84, altM: 1.70, zoom0: 19.2 };
const LAMP_LAYERS = ['props-lit', 'props-lit-core'];
const DIFF_MIN = 26;
const SITE = JSON.parse(fs.readFileSync(`${OUT}/sceneproof.json`, 'utf8')).rows
  .find(r => r.from === 'GDC' && r.kind === 'unmapped');

const J = JSON.parse(fs.readFileSync('data/walk_lamps.json', 'utf8'));
const q = J.q || 1e-6;
const dec = (o) => { const xs = (o && o.x) || [], ys = (o && o.y) || []; const X = [], Y = []; let ax = 0, ay = 0; for (let i = 0; i < xs.length; i++) { ax += xs[i]; ay += ys[i]; X.push(ax * q); Y.push(ay * q); } return { X, Y, n: X.length }; };
const WARM = dec(J.warm);
const MPD_LAT = 111320, MPD_LON = 111320 * Math.cos(SITE.ll[1] * Math.PI / 180);
const nearestWarm = (lon, lat) => { let b = Infinity; for (let i = 0; i < WARM.n; i++) { const d = Math.hypot((WARM.X[i] - lon) * MPD_LON, (WARM.Y[i] - lat) * MPD_LAT); if (d < b) b = d; } return b; };

const browser = await launch(chromium, { gl: 'hardware', maxMs: 900000 });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
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
await page.waitForFunction(() => { const m = window.__map; return !!(m && m.getLayer('props-lit') && m.getLayer('props-lit-core')); }, null, { timeout: 120000 });
await page.evaluate(async ([f, t]) => { await window.wayfindRoute(f, t, { expand: true }); }, ['GDC', 'The Castilian']);
await page.waitForTimeout(1500);

await page.evaluate(([ll, pitch, wantAlt, z0, brg]) => {
  const m = window.__map;
  const camLL = () => { const t = m.transform; const c = t.getCameraLngLat ? t.getCameraLngLat() : null; return c ? [c.lng, c.lat] : null; };
  const camAlt = () => { const t = m.transform; return t.getCameraAltitude ? t.getCameraAltitude() : NaN; };
  let z = z0, centre = [ll[0], ll[1]];
  for (let k = 0; k < 5; k++) {
    m.jumpTo({ center: centre, zoom: z, pitch, bearing: brg });
    const alt = camAlt(); if (isFinite(alt) && alt > 0) z = z + Math.log2(alt / wantAlt);
    m.jumpTo({ center: centre, zoom: z, pitch, bearing: brg });
    const c = camLL(); if (!c) break;
    centre = [centre[0] + (ll[0] - c[0]), centre[1] + (ll[1] - c[1])];
  }
  m.jumpTo({ center: centre, zoom: z, pitch, bearing: brg });
}, [SITE.ll, EYE.pitch, EYE.altM, EYE.zoom0, SITE.bearing]);
await page.waitForTimeout(1800);

const a = await page.screenshot();
await page.evaluate((ls) => { for (const l of ls) if (window.__map.getLayer(l)) window.__map.setLayoutProperty(l, 'visibility', 'none'); }, LAMP_LAYERS);
await page.waitForTimeout(1400);
const b = await page.screenshot();

// Every differing pixel, unprojected back to a coordinate, bucketed by how far
// that ground point is from the eye.
const pts = await page.evaluate(async ([A, B, MIN]) => {
  const load = (s) => new Promise(r => { const q2 = new Image(); q2.onload = () => r(q2); q2.src = 'data:image/png;base64,' + s; });
  const [ia, ib] = await Promise.all([load(A), load(B)]);
  const c1 = document.createElement('canvas'); c1.width = ia.width; c1.height = ia.height;
  const c2 = document.createElement('canvas'); c2.width = ib.width; c2.height = ib.height;
  c1.getContext('2d').drawImage(ia, 0, 0); c2.getContext('2d').drawImage(ib, 0, 0);
  const da = c1.getContext('2d').getImageData(0, 0, ia.width, ia.height).data;
  const db = c2.getContext('2d').getImageData(0, 0, ib.width, ib.height).data;
  const m = window.__map;
  const out = [];
  // Every 4th differing pixel — 3,000-odd unprojections is plenty and the
  // stride keeps the run short.
  let k = 0;
  for (let y = 0; y < ia.height; y++) for (let x = 0; x < ia.width; x++) {
    const i = (y * ia.width + x) * 4;
    const d = Math.max(da[i] - db[i], da[i + 1] - db[i + 1], da[i + 2] - db[i + 2]);
    if (d < MIN) continue;
    if ((k++ % 4) !== 0) continue;
    const ll = m.unproject([x, y]);
    out.push([x, y, +ll.lng.toFixed(7), +ll.lat.toFixed(7), d]);
  }
  return out;
}, [a.toString('base64'), b.toString('base64'), DIFF_MIN]);
await browser.close();

const eye = SITE.ll;
const rows = pts.map(([x, y, lon, lat, d]) => ({
  x, y, d,
  fromEyeM: Math.hypot((lon - eye[0]) * MPD_LON, (lat - eye[1]) * MPD_LAT),
  toLampM: nearestWarm(lon, lat),
}));
const finite = rows.filter(r => isFinite(r.fromEyeM) && r.fromEyeM < 1e6);
const med = (a2) => { const s = a2.slice().sort((p, q2) => p - q2); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const near = finite.filter(r => r.fromEyeM <= 25);

console.log(`\nWHERE THE "LAMPLIGHT" IN THAT FRAME ACTUALLY IS`);
console.log(`  site: GDC -> The Castilian, middle of the ${SITE.runM} m unmapped run`);
console.log(`  the card says: no mapped streetlight along this route · nearest mapped lamp ${nearestWarm(eye[0], eye[1]).toFixed(1)} m from the eye\n`);
console.log(`  differing pixels sampled (every 4th):      ${rows.length}`);
console.log(`  ...that unproject to real ground:          ${finite.length}`);
console.log(`  distance from the eye to that ground:      median ${med(finite.map(r => r.fromEyeM)).toFixed(0)} m` +
  `   min ${Math.min(...finite.map(r => r.fromEyeM)).toFixed(0)} m   max ${Math.max(...finite.map(r => r.fromEyeM)).toFixed(0)} m`);
console.log(`  ...and to the nearest mapped lamp:         median ${med(finite.map(r => r.toLampM)).toFixed(0)} m`);
console.log(`\n  INSIDE the ${25} m the card counts as covered:  ${near.length} of ${finite.length} sampled pixels` +
  (near.length ? `   median ${med(near.map(r => r.toLampM)).toFixed(0)} m from a lamp` : ''));
fs.writeFileSync(`${OUT}/streakwhere.json`, JSON.stringify({
  site: SITE, diffMin: DIFF_MIN, sampled: rows.length, onGround: finite.length,
  eyeToNearestLampM: +nearestWarm(eye[0], eye[1]).toFixed(1),
  medianFromEyeM: +med(finite.map(r => r.fromEyeM)).toFixed(1),
  minFromEyeM: +Math.min(...finite.map(r => r.fromEyeM)).toFixed(1),
  maxFromEyeM: +Math.max(...finite.map(r => r.fromEyeM)).toFixed(1),
  medianToLampM: +med(finite.map(r => r.toLampM)).toFixed(1),
  within25m: near.length,
}, null, 1));
