/**
 * art-sheet.mjs — one command, one image, every authored sculpture side by side.
 *
 * WHY THIS EXISTS. Simeon, 2026-08-02: "make monochrome for austin look better
 * not like a silver tree. clock not looks like a fireplace and not big enough. I
 * don't even want to check out the other landmarks PLEASE make them accurate to
 * size and architecture."
 *
 * Ten sculptures redrawn by hand is ten chances to fix one and break another,
 * and flying to each of them one at a time is how a pass ends up having only
 * really looked at the first three. So: photograph every piece at the SAME
 * ground scale, lay them out in a grid, and print each one's measured size next
 * to the real work's published size underneath it. The wrong ones are then
 * obvious in two ways at once — the picture and the number — and neither can
 * quietly agree with a mistake the other made.
 *
 * THE SCALE IS THE POINT. Every tile is the same metres-per-pixel, so the tiles
 * are comparable to each other, not just each to its own caption. A 15 m Rubins
 * and a 4 m armadillo have to look 15 m and 4 m in the same grid or the sheet is
 * decoration.
 *
 * "measured" is read out of data/art.geojson itself — max part height and the
 * bbox of every part — so it reports what the bake actually emitted, never what
 * a recipe intended. `real` is the published dimension of the real artwork, with
 * its source, in REAL below. A blank there means nobody has sourced it yet and
 * the tile is a picture only.
 *
 * Usage:
 *   VERIFY_URL=http://127.0.0.1:8134 node scripts/verify/art-sheet.mjs \
 *     --out shots/art/sheet-after.png --tod 0.30
 *
 *   --only "Clock Knot,Austin"   just those pieces, same framing
 *   --zoom 20                    tighter or wider; the caption follows it
 */
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const OUT = opt('--out', 'shots/art/sheet.png');
const TOD = parseFloat(opt('--tod', '0.30'));
const ZOOM = parseFloat(opt('--zoom', '20'));
const PITCH = parseFloat(opt('--pitch', '55'));
const BEARING = parseFloat(opt('--bearing', '0'));
const ONLY = (opt('--only', '') || '').split(',').map(s => s.trim()).filter(Boolean);
const COLS = parseInt(opt('--cols', '5'), 10);
const RESUME = argv.includes('--resume');

// Tile geometry. TILE metres of ground across a TILE_PX box, so every tile in
// the sheet is the same ruler.
const TILE_PX = 400;
const VIEW_W = 1000, VIEW_H = 900;
const ABOVE = 280;      // px of the box that sits above the map centre; a tall
                        // piece grows upward on a pitched camera and 200 was not
                        // enough for the 15 m Rubins.

/**
 * Published dimensions of the real works. metres, [height, width].
 * Sourced today; anything not here is left blank rather than guessed.
 */
const REAL = {
  'Monochrome for Austin': [15.24, 15.85, "50x52x41 ft — Landmarks UT / CultureMap"],
  'Clock Knot':            [12.65,  6.60, "498x260x420 in — Landmarks UT / Wikipedia"],
  'The West':              [ 1.52,  3.87, "two 5 ft spheres, 12 ft 8 in overall — Met Museum"],
  'Circle with Towers':    [ 4.27,  7.82, "14 ft towers, 25.7 ft ring — Landmarks UT"],
  'Austin':                [ 8.03, 22.25, "60 x 73 x 26 ft 4 in, 2715 sq ft — Wikipedia"],
};

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '..', '..');
const art = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'art.geojson'), 'utf8'));

// ── measure every piece out of the baked file ────────────────────────────
const M_LAT = 111320;
// The Hal C. Weaver plant rides in the same file and is not artwork.
const NOT_ART = /Cooling Tower|Chilled Water Plant/;
const pieces = new Map();
for (const f of art.features) {
  const p = f.properties || {};
  const name = p.name || '(unnamed)';
  if (p.k !== 'artpart' || NOT_ART.test(name)) continue;
  let e = pieces.get(name);
  if (!e) pieces.set(name, e = { name, n: 0, h: 0, lo: [180, 90], hi: [-180, -90] });
  e.n++;
  e.h = Math.max(e.h, Number(p.h) || 0);
  for (const [x, y] of f.geometry.coordinates[0]) {
    e.lo[0] = Math.min(e.lo[0], x); e.lo[1] = Math.min(e.lo[1], y);
    e.hi[0] = Math.max(e.hi[0], x); e.hi[1] = Math.max(e.hi[1], y);
  }
}
let list = [...pieces.values()];
if (ONLY.length) list = list.filter(e => ONLY.includes(e.name));
for (const e of list) {
  const lat = (e.lo[1] + e.hi[1]) / 2;
  e.center = [(e.lo[0] + e.hi[0]) / 2, lat];
  e.w = (e.hi[0] - e.lo[0]) * M_LAT * Math.cos(lat * Math.PI / 180);
  e.d = (e.hi[1] - e.lo[1]) * M_LAT;
  e.span = Math.max(e.w, e.d);
}
list.sort((a, b) => b.h - a.h);
if (!list.length) { console.error('no artpart features in data/art.geojson'); process.exit(2); }

const mpp = 156543.03392 * Math.cos(30.284 * Math.PI / 180) / Math.pow(2, ZOOM);
console.log(`art-sheet: ${list.length} pieces, zoom ${ZOOM} = ${mpp.toFixed(4)} m/px, ` +
            `tile = ${(TILE_PX * mpp).toFixed(1)} m across`);

// The crops go NEXT TO the sheet, not into a temp dir. A full pass is 34 camera
// moves and on a busy machine that ran ~55 s each and hit the watchdog — at
// which point a temp dir takes twelve perfectly good before-shots with it. On
// disk they survive a killed run and can be looked at one at a time.
const tmp = path.resolve(OUT).replace(/\.png$/, '') + '-crops';
fs.mkdirSync(tmp, { recursive: true });
fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });

const browser = await launch(chromium, { gl: 'hardware' });
const page = await browser.newPage({ viewport: { width: VIEW_W, height: VIEW_H } });
page.on('pageerror', e => console.log('  [pageerror] ' + e.message));

await page.goto(BASE + '/index.html?intro=0&drift=0', { waitUntil: 'networkidle', timeout: 180000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
// The authored parts arrive by fetch, not as a style source, so isStyleLoaded()
// is true a long time before there is anything to photograph.
await page.waitForFunction(() => window.__map.getLayer('props-artpart'), null, { timeout: 120000 })
  .catch(() => console.log('  WARNING: props-artpart never appeared — the sheet is of the GREY BOX layer'));
await page.evaluate(p => {
  const el = document.getElementById('tod-slider');
  if (el) { el.value = String(p); el.dispatchEvent(new Event('input', { bubbles: true })); }
  else if (typeof window.applyTimeOfDay === 'function') window.applyTimeOfDay(window.__map, p, true);
}, TOD);
await page.waitForTimeout(2500);

const clip = { x: (VIEW_W - TILE_PX) / 2, y: VIEW_H / 2 - ABOVE, width: TILE_PX, height: TILE_PX };
for (const e of list) {
  e.png = path.join(tmp, e.name.replace(/[^\w]+/g, '_') + '.png');
  // --resume: keep a crop that is already on disk. A run of this length gets
  // killed — by the watchdog, or by any OTHER session's reap.mjs, which filters
  // on a marker arg every harness browser is required to carry. Without resume
  // that meant starting the 34 poses again from zero.
  if (RESUME && fs.existsSync(e.png)) { console.log('  keep ' + path.basename(e.png)); continue; }
  await page.evaluate(v => window.__map.jumpTo(v), { center: e.center, zoom: ZOOM, pitch: PITCH, bearing: BEARING });
  // 6 s, not 40. The authored artwork is a plain GeoJSON source that is loaded
  // in full before the first tile, so it is never the thing being waited for —
  // and at zoom 20 the TILED sources routinely never all report loaded, which
  // turned a 40 s catch-and-continue into 37 x 40 s and hit the watchdog.
  await page.waitForFunction(() => {
    const m = window.__map;
    return ['austin-art', 'austin-props'].every(s => !m.getSource(s) || m.isSourceLoaded(s));
  }, null, { timeout: 2500 }).catch(() => {});
  await page.waitForTimeout(900);
  await page.screenshot({ path: e.png, clip });      // discard: often half-drawn
  await page.waitForTimeout(600);
  await page.screenshot({ path: e.png, clip });
}

// ── compose ──────────────────────────────────────────────────────────────
const cell = (e) => {
  const r = REAL[e.name];
  const bad = r && (e.h < r[0] * 0.75 || e.h > r[0] * 1.3 || e.span < r[1] * 0.7 || e.span > r[1] * 1.4);
  const real = r ? `real&nbsp; <b>${r[0].toFixed(1)} h</b> &times; ${r[1].toFixed(1)} w` : '<i>no sourced dimension</i>';
  return `<figure class="${bad ? 'bad' : (r ? 'ok' : '')}">
    <img src="file://${e.png.replace(/\\/g, '/')}">
    <figcaption><b>${e.name}</b>
      <span>bake&nbsp; <b>${e.h.toFixed(1)} h</b> &times; ${e.span.toFixed(1)} w &nbsp;·&nbsp; ${e.n} parts</span>
      <span>${real}</span>
    </figcaption></figure>`;
};
const html = `<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#14161b;color:#e6e2d8;font:13px/1.45 "Segoe UI",system-ui,sans-serif}
 h1{font:600 17px/1 "Segoe UI",sans-serif;margin:16px 18px 4px}
 p.sub{margin:0 18px 14px;color:#8f9099;font-size:12px}
 .grid{display:grid;grid-template-columns:repeat(${COLS},${TILE_PX}px);gap:12px;padding:0 18px 18px}
 figure{margin:0;background:#1d2027;border:1px solid #2b2f39;border-radius:4px;overflow:hidden}
 figure.bad{border-color:#c0472f} figure.ok{border-color:#3f7a4d}
 img{display:block;width:${TILE_PX}px;height:${TILE_PX}px}
 figcaption{padding:7px 9px 9px;display:flex;flex-direction:column;gap:1px}
 figcaption b{color:#fff} figcaption span{color:#9aa0ab;font-size:12px}
 figure.bad figcaption span:last-child{color:#e08a72}
 .ruler{position:absolute;left:9px;bottom:8px;height:3px;background:#ffcf3f;box-shadow:0 0 0 1px #000}
</style></head><body>
 <h1>UT Landmarks — authored artwork, ${list.length} pieces at one ground scale</h1>
 <p class="sub">zoom ${ZOOM} · ${mpp.toFixed(4)} m/px · every tile is ${(TILE_PX * mpp).toFixed(1)} m across ·
 pitch ${PITCH} bearing ${BEARING} · time-of-day ${TOD} ·
 red border = the bake disagrees with the published size</p>
 <div class="grid">${list.map(cell).join('')}</div></body></html>`;

const sheet = path.join(os.tmpdir(), 'art-sheet-' + Date.now() + '.html');
fs.writeFileSync(sheet, html);
const sp = await browser.newPage({ viewport: { width: COLS * (TILE_PX + 12) + 36, height: 1200 } });
await sp.goto('file://' + sheet.replace(/\\/g, '/'));
await sp.waitForTimeout(700);
await sp.screenshot({ path: OUT, fullPage: true });
console.log('WROTE ' + OUT);

for (const e of list) {
  const r = REAL[e.name];
  console.log(`  ${e.name.padEnd(24)} bake ${e.h.toFixed(1).padStart(5)} h ${e.span.toFixed(1).padStart(5)} w  ` +
              (r ? `real ${r[0].toFixed(1).padStart(5)} h ${r[1].toFixed(1).padStart(5)} w` : ''));
}
await browser.__done();
