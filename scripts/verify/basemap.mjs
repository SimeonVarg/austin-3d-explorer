/**
 * basemap.mjs — what is the OpenFreeMap basemap actually drawing for us?
 *
 * THE QUESTION. `perf.mjs` reports that hiding every basemap layer is the single
 * biggest frame-time saving available — ~90 ms of a ~126 ms frame under its 4×
 * CPU throttle, more than double all of our own extrusions combined. That is a
 * tempting thing to act on and a dangerous one, because "costs the most" and
 * "can be removed" are different claims. The basemap is underneath the city:
 * some of it is genuinely invisible, and some of it IS the ground you see
 * between the buildings and out to the horizon.
 *
 * So before culling anything: photograph the city with it and without it, and
 * list what is actually in it, grouped so a human can decide.
 *
 * WHAT IT PRINTS
 *   - every still-visible basemap layer, grouped by source-layer and type,
 *     with the count and the ids
 *   - frame time with the basemap on and off, interleaved, minimum of reps
 *   - two screenshots to compare
 *
 * NOTE js/ground.js ALREADY HIDES SOME OF IT. `hideBasemapRoads` removes every
 * basemap `transportation` line layer, because our own asphalt replaced them.
 * Anything this script still sees is what survived that, so do not double-count
 * roads when reading the output.
 *
 * Usage:  VERIFY_URL=http://127.0.0.1:8123 node scripts/verify/basemap.mjs
 */
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';
import fs from 'node:fs';

const OUT = 'shots/basemap';
fs.mkdirSync(OUT, { recursive: true });

const REPS = Number(process.env.REPS || 3);
const FRAMES = 90;
// perf.mjs uses 4. Same number here so the two are comparable, and named rather
// than buried — an instrument's throttle is part of its answer.
const THROTTLE = Number(process.env.CPU_THROTTLE || 4);

const POSES = [
  ['south-mall',  { center: [-97.7395, 30.2845], zoom: 16.6, pitch: 68, bearing: 8 }],
  ['aerial-wide', { center: [-97.7390, 30.2840], zoom: 14.4, pitch: 55, bearing: 20 }],
];

const browser = await launch(chromium, { gl: 'hardware' });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('pageerror', e => console.log('  [pageerror] ' + e.message));

await page.goto(BASE + '/index.html?intro=0&drift=0', { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
await page.evaluate(() => new Promise(r => {
  const m = window.__map;
  if (m.loaded()) return r();
  m.once('idle', r); setTimeout(r, 60000);
}));

// ── inventory ─────────────────────────────────────────────────────────────
const inv = await page.evaluate(() => {
  const m = window.__map;
  // "Ours" by id prefix, the same test perf.mjs uses. Everything else came
  // with the Liberty style.
  // `wc-` (West Campus) and `night-` (streetlights) are OURS and were missed by
  // the first version of this list, which then hid them and attributed our own
  // geometry's cost to the basemap. perf.mjs uses a shorter prefix test and has
  // the same hole; its "minus basemap" number is inflated by however much those
  // five layers cost.
  const OURS = /^(buildings|parts|trees|landscape|signs|capitol|tower|stadium|drag|arts|moody|westcampus|wc-|night-|places|props|roof|outer|ground|road|lane|bike|cycle|stopbar|shadow|fx-|sky)/;
  const rows = [];
  for (const l of m.getStyle().layers) {
    if (OURS.test(l.id)) continue;
    if (m.getLayoutProperty(l.id, 'visibility') === 'none') continue;
    rows.push({ id: l.id, type: l.type, sl: l['source-layer'] || '-', src: l.source || '-' });
  }
  return rows;
});

const groups = new Map();
for (const r of inv) {
  const k = r.sl + '  /  ' + r.type;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(r.id);
}
console.log(`\n=== ${inv.length} basemap layers still visible (after ground.js hides its roads) ===`);
for (const [k, ids] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log('  ' + String(ids.length).padStart(3) + '  ' + k);
  console.log('       ' + ids.join(', ').slice(0, 150));
}

// ── pictures ──────────────────────────────────────────────────────────────
/**
 * THE CANDIDATES, and why culling the whole basemap is not on the table.
 *
 * First run of this script hid all of it and photographed the result: THE
 * GROUND TURNS BLACK. The basemap is not a redundant layer under the city, it
 * IS the surface between and beyond the buildings — `background` plus the
 * landcover and water fills. perf.mjs's "hiding the basemap saves 90 ms" is
 * true and useless, because you cannot hide it.
 *
 * What IS on the table is the subset that draws nothing you can see HERE. Each
 * of these is a hypothesis to be tested by picture, not an assumption:
 *
 *   building        the basemap's own FLAT 2-D building footprints, sitting
 *                   underneath our 3-D extrusions. The best candidate by far.
 *   natural_earth   a low-zoom world raster, for looking at continents. At
 *                   z14-17 it is under every other fill.
 *   landcover_ice   Austin.
 *   landcover_sand  Austin.
 *   aeroway_fill    no airport inside the modelled area.
 *   landuse_pitch   ground.geojson now carries 101 real pitches with real
 *   landuse_track   surface classes, which is what buried DKR's end zones
 *                   when landscape-pitch was repainting them flat green.
 *
 * Kept, because the first run's picture shows them doing visible work:
 * background, water, park, landcover_wood, landcover_grass, waterway_*.
 */
const CANDIDATES = new Set([
  'building', 'natural_earth', 'landcover_ice', 'landcover_sand',
  'aeroway_fill', 'landuse_pitch', 'landuse_track',
]);
const cullIds = inv.filter(r => CANDIDATES.has(r.id)).map(r => r.id);
console.log('\ncull candidates present: ' + (cullIds.join(', ') || 'none'));

const setBasemap = on => page.evaluate(([ids, vis]) => {
  const m = window.__map;
  for (const id of ids) {
    try { m.setLayoutProperty(id, 'visibility', vis ? 'visible' : 'none'); } catch (e) {}
  }
}, [cullIds, on]);

for (const [name, pose] of POSES) {
  await page.evaluate(q => window.__map.jumpTo(q), pose);
  for (const on of [true, false]) {
    await setBasemap(on);
    await page.evaluate(() => new Promise(r => {
      const m = window.__map;
      if (m.loaded() && m.areTilesLoaded()) return r();
      m.once('idle', r); setTimeout(r, 20000);
    }));
    await page.waitForTimeout(1000);
    const f = `${OUT}/${name}-cull-${on ? "kept" : "culled"}.png`;
    await page.screenshot({ path: f + '.tmp.png' });
    await page.waitForTimeout(700);
    await page.screenshot({ path: f });
    fs.unlinkSync(f + '.tmp.png');
    console.log('  ' + f);
  }
  await setBasemap(true);
}

// ── frame time, interleaved ───────────────────────────────────────────────
const cdp = await page.context().newCDPSession(page);
if (THROTTLE > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });

await page.evaluate(q => window.__map.jumpTo(q), POSES[0][1]);
await page.waitForTimeout(2500);

async function frameMs() {
  await page.keyboard.down('w');
  await page.waitForTimeout(700);
  const med = await page.evaluate(async n => {
    const dts = [];
    await new Promise(res => {
      let last = null;
      const step = ts => {
        if (last !== null) dts.push(ts - last);
        last = ts;
        if (dts.length >= n) return res();
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    const s = dts.sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }, FRAMES);
  await page.keyboard.up('w');
  await page.waitForTimeout(400);
  return med;
}

const on = [], off = [];
for (let i = 0; i < REPS; i++) {
  await setBasemap(true);  await page.waitForTimeout(900); on.push(await frameMs());
  await setBasemap(false); await page.waitForTimeout(900); off.push(await frameMs());
}
await setBasemap(true);

// Minimum, not mean. CLAUDE.md rule 10 — a slow rep is contention, not signal.
const min = a => Math.min(...a);
console.log(`\n=== frame time, ${REPS} interleaved reps, CPU throttled ${THROTTLE}x ===`);
console.log('  basemap on   ' + min(on).toFixed(1).padStart(6) + ' ms   (' + on.map(v => v.toFixed(0)).join(', ') + ')');
console.log('  basemap off  ' + min(off).toFixed(1).padStart(6) + ' ms   (' + off.map(v => v.toFixed(0)).join(', ') + ')');
console.log('  saving       ' + (min(on) - min(off)).toFixed(1).padStart(6) + ' ms  ('
            + (100 * (min(on) - min(off)) / min(on)).toFixed(0) + '% of the frame)');
console.log('\nLOOK AT THE SHOTS BEFORE CULLING ANYTHING. A layer that costs a lot');
console.log('and is visible is not a candidate; it is just expensive.');

await browser.__done();
