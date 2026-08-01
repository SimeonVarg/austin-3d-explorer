/**
 * lod-perf.mjs — does dropping DETAIL LAYERS actually buy frames?
 *
 * This is the experiment that decides whether a render-distance mode is worth
 * building at all. The project's own history says be suspicious: HANDOFF §20.1
 * measured the bottleneck as FILL RATE, and every geometry-removal A/B since —
 * trees, the 7,625-building outer ring, the roads, 2,338 lamps, the pitched
 * roofs — landed inside the noise floor. Only the roofscape's TIER SPLIT
 * produced a clean number, and there it was the split, not the density knob.
 *
 * So: measure the lever before building a UI for it.
 *
 * HOW THIS RUNS, and why each choice is not optional (scripts/verify/README.md):
 *
 *  - HEADED. The rest of the suite uses --use-angle=swiftshader, which is right
 *    for pixel assertions and useless for timing: software rasterisation moves
 *    the whole cost onto the CPU and flatters every GPU change. NOTE that
 *    commit 90ad9d7 silently stripped `headless: false` from the existing perf
 *    scripts, so their current numbers are invalid — this file does not rely on
 *    them.
 *  - NOT _harness.html. Its rAF shim pins the loop at ~60 Hz no matter how slow
 *    a frame really is.
 *  - DROPPED FRAMES, not a median. The median sits on the 16.7 ms vsync floor
 *    even while half the frames are being dropped, and every subsystem delta
 *    then reads as exactly 0.0 ms.
 *  - A SCRIPTED BEARING SWEEP, not held keys. Flying with W makes every run
 *    cover different buildings, which was a bigger noise source than anything
 *    being compared.
 *  - INTERLEAVED **and COUNTERBALANCED**. The machine drifts warmer across a
 *    run, so whichever configuration always goes first wins by construction.
 *    The order reverses on alternate reps.
 *  - Anti-throttling flags + bringToFront: Chrome throttles rAF in a window it
 *    believes is occluded, which once produced a p10 of exactly 50.00 ms — 20 Hz,
 *    quantised, identical for both configurations, i.e. the window manager.
 *
 * Usage: node lod-perf.mjs [reps]        (default 3)
 */
import { chromium } from 'playwright-core';
import { BASE as SERVER, launch, MARK_ARG } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';

const REPS = Number(process.argv[2] || 3);
const POSE = { center: [-97.7434, 30.2857], zoom: 15.0, pitch: 74, bearing: 0 };
const SWEEP_MS = 5000;

// The tiers a render-distance mode would drop, coarsest last. Chosen by what
// they COST to draw (one full fill-extrusion or symbol pass each), not by how
// many features they carry.
const TIER1 = [   // fine detail: invisible past a few hundred metres
  'props-lit', 'props-art', 'props-art-label', 'props-furniture', 'props-construction',
  'props-flat', 'props-pole', 'props-canopy',
  'trees-trunk', 'roofscape-minor', 'tower-detail', 'arts-panel', 'arts-glass',
  'moody-plant', 'places-glass', 'stadium-detail', 'drag-cap', 'wc-wall-cap',
];
const TIER2 = [   // mid detail: reads as texture at distance, not as shape
  'trees-canopy', 'roofscape-major', 'roofscape-deck', 'buildings-roof',
  'parts-roof', 'outer-tower-roof', 'roofs-pitched', 'moody-roof', 'arts-cap',
];

const CONFIGS = [
  ['baseline', async page => setHidden(page, [])],
  ['tier1-off', async page => setHidden(page, TIER1)],
  ['tier1+2-off', async page => setHidden(page, [...TIER1, ...TIER2])],
  // The known-good lever, as a yardstick: if the tiers cannot beat this, say so.
  ['renderScale-0.75', async page => { await setHidden(page, []); await setScale(page, 0.75); }],
];

async function setHidden(page, ids) {
  await page.evaluate(ids => {
    const m = window.__map;
    for (const l of m.getStyle().layers) {
      if (!String(l.source || '').startsWith('austin')) continue;
      const want = ids.includes(l.id) ? 'none' : 'visible';
      try {
        if ((m.getLayoutProperty(l.id, 'visibility') || 'visible') !== want)
          m.setLayoutProperty(l.id, 'visibility', want);
      } catch (e) {}
    }
  }, ids);
}
async function setScale(page, s) {
  await page.evaluate(s => { window.GFX.renderScale = s; window.applyGraphics && window.applyGraphics(); }, s);
}

const browser = await launch(chromium, {
  gl: 'hardware',
  headless: false,
  args: [
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    '--disable-features=CalculateNativeWinOcclusion',
    MARK_ARG,
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
await page.bringToFront();

await page.goto(`${SERVER}/index.html?intro=0&drift=0`, { waitUntil: 'networkidle', timeout: 180000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 180000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
await page.waitForFunction(() => {
  const m = window.__map;
  return m && m.getSource('austin-buildings') && m.getSource('austin-outer');
}, null, { timeout: 180000 });
await page.evaluate(p => window.__map.jumpTo(p), POSE);
await page.waitForTimeout(9000);

/** One deterministic bearing sweep; returns dropped-frame count and timings. */
async function sweep(page) {
  return page.evaluate(async ms => {
    const m = window.__map;
    const t = [];
    let last = performance.now();
    const start = last;
    await new Promise(res => {
      function step(now) {
        t.push(now - last); last = now;
        m.setBearing(((now - start) / ms) * 120);
        if (now - start < ms) requestAnimationFrame(step); else res();
      }
      requestAnimationFrame(step);
    });
    const f = t.slice(3);                     // drop the first frames after the switch
    const sorted = [...f].sort((a, b) => a - b);
    return {
      frames: f.length,
      dropped: f.filter(x => x > 20).length,  // anything past ~vsync+3 ms
      p50: +sorted[Math.floor(sorted.length * 0.5)].toFixed(2),
      p90: +sorted[Math.floor(sorted.length * 0.9)].toFixed(2),
      fps: +(1000 * f.length / f.reduce((a, b) => a + b, 0)).toFixed(1),
    };
  }, SWEEP_MS);
}

const results = {};
for (const [name] of CONFIGS) results[name] = [];

for (let rep = 0; rep < REPS; rep++) {
  // Counterbalance: reverse the order every other rep so no configuration
  // always gets the cool slot.
  const order = rep % 2 === 0 ? CONFIGS : [...CONFIGS].reverse();
  for (const [name, apply] of order) {
    await setScale(page, 1.0);
    await apply(page);
    await page.evaluate(p => window.__map.jumpTo(p), POSE);
    await page.waitForTimeout(2500);
    const r = await sweep(page);
    results[name].push(r);
    console.log(`rep ${rep + 1}  ${name.padEnd(18)} dropped ${String(r.dropped).padStart(3)}/${r.frames}  fps ${String(r.fps).padStart(5)}  p90 ${r.p90} ms`);
  }
}

const med = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
console.log('\n=== medians over ' + REPS + ' interleaved, counterbalanced reps ===');
const table = [];
for (const [name] of CONFIGS) {
  const d = results[name].map(r => r.dropped), f = results[name].map(r => r.fps);
  const row = { config: name, droppedMed: med(d), droppedAll: d, fpsMed: med(f), fpsAll: f };
  table.push(row);
  console.log(`${name.padEnd(18)} dropped ${String(row.droppedMed).padStart(3)}  [${d.join(', ')}]   fps ${String(row.fpsMed).padStart(5)}  [${f.join(', ')}]`);
}
const base = table[0];
console.log('\nagainst baseline:');
for (const row of table.slice(1)) {
  const spreadBase = Math.max(...base.fpsAll) - Math.min(...base.fpsAll);
  const spreadRow = Math.max(...row.fpsAll) - Math.min(...row.fpsAll);
  const delta = row.fpsMed - base.fpsMed;
  const overlap = Math.min(...base.fpsAll) <= Math.max(...row.fpsAll) &&
                  Math.min(...row.fpsAll) <= Math.max(...base.fpsAll);
  console.log(`  ${row.config.padEnd(18)} ${delta >= 0 ? '+' : ''}${delta.toFixed(1)} fps   ` +
    (overlap ? `NO RESULT — spreads overlap (base ${spreadBase.toFixed(1)}, this ${spreadRow.toFixed(1)})`
             : 'separated'));
}
fs.mkdirSync(path.resolve('shots'), { recursive: true });
fs.writeFileSync(path.resolve('shots/lod-perf.json'), JSON.stringify({ REPS, POSE, results }, null, 1));
browser.__done();
