/**
 * roads-probe.mjs — what the road layer actually contains, and what it draws.
 *
 * The trap this exists for: every claim in this pass is about DATA the basemap
 * did not have. "Guadalupe is wider than San Jacinto now" is worth nothing said
 * out loud; it is worth something when the renderer is asked what width it is
 * about to draw and answers in metres.
 *
 * Three checks, in order of how badly they have burned this repo before:
 *   1. the layers exist and the source loaded    (js/roofs.js sat dead for days)
 *   2. the features carry what the bake claims   (class, lanes, cycleway sides)
 *   3. named streets resolve to the widths asserted in docs/PASS_ROADS.md
 *
 * Usage: node roads-probe.mjs
 */
import { chromium } from 'playwright-core';
import { chromePath, GL_ARGS, BASE as SERVER, launch } from './chrome.mjs';

const browser = await launch(chromium, { executablePath: chromePath(), headless: true, args: GL_ARGS });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('PAGEERR', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });

await page.goto(SERVER + '/_harness.html?intro=0&drift=0', { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 90000 });
await page.waitForFunction(() => {
  const m = window.__map;
  return m && m.getSource('austin-roads') && m.isSourceLoaded('austin-roads');
}, null, { timeout: 120000 }).catch(() => console.log('WARN roads source never loaded'));
await page.waitForTimeout(3000);

// ---- 1. the layers exist ------------------------------------------------
const layers = await page.evaluate(() => {
  const m = window.__map;
  const want = ['ground-road-casing', 'ground-road', 'ground-bike-left',
                'ground-bike-right', 'ground-cycleway', 'ground-road-lane',
                'ground-stopbar', 'ground-speedway-brick'];
  return want.map(id => {
    const l = m.getLayer(id);
    return { id, present: !!l,
             visible: l ? (m.getLayoutProperty(id, 'visibility') || 'visible') : '-',
             source: l ? l.source : '-' };
  });
});
console.log('\nLAYERS');
for (const l of layers) {
  console.log('  %s %s vis=%s src=%s', l.present ? 'ok  ' : 'MISS',
              l.id.padEnd(24), String(l.visible).padEnd(8), l.source);
}
const stillOnBasemap = await page.evaluate(() => window.__map.getStyle().layers
  .filter(l => (l['source-layer'] || '') === 'transportation' && l.type === 'line'
               && (l.layout && l.layout.visibility) !== 'none').map(l => l.id));
console.log('  basemap transportation lines still visible: %s',
            stillOnBasemap.length ? stillOnBasemap.join(', ') : 'none (correct)');
console.log('  herringbone image registered: %s',
            await page.evaluate(() => window.__map.hasImage('gnd-tex-herringbone')));

// ---- 2. what the source carries -----------------------------------------
const data = await page.evaluate(async () => {
  const r = await fetch('data/roads.geojson');
  const fc = await r.json();
  const by = {}, bikeBy = {}, surfBy = {};
  let taggedW = 0, defW = 0, green = 0, stop = 0, cycle = 0;
  const named = {};
  for (const f of fc.features) {
    const p = f.properties;
    if (p.k === 'stopbar') { stop++; continue; }
    if (p.k === 'cycle') { cycle++; continue; }
    by[p.c] = (by[p.c] || 0) + 1;
    surfBy[p.s] = (surfBy[p.s] || 0) + 1;
    if (p.wt) taggedW++; else defW++;
    if (p.bl || p.br) {
      const k = (p.bl === 2 || p.br === 2) ? 'track' : 'lane';
      bikeBy[k] = (bikeBy[k] || 0) + 1;
    }
    if (p.gp) green++;
    if (p.name) {
      const n = named[p.name] || (named[p.name] = { w: [], c: new Set(), ln: new Set(), bike: 0 });
      n.w.push(p.w); n.c.add(p.c); if (p.ln) n.ln.add(p.ln);
      if (p.bl || p.br) n.bike++;
    }
  }
  const pick = {};
  for (const want of ['Guadalupe Street', 'West Martin Luther King Jr Boulevard',
                      'East Martin Luther King Jr Boulevard', 'San Jacinto Boulevard',
                      'Speedway', 'West 24th Street', 'East Dean Keeton Street',
                      'Red River Street', 'Whitis Avenue', 'University Avenue']) {
    const n = named[want];
    if (!n) { pick[want] = null; continue; }
    const w = n.w.slice().sort((a, b) => a - b);
    pick[want] = { n: w.length, wmin: w[0], wmed: w[(w.length / 2) | 0], wmax: w[w.length - 1],
                   classes: [...n.c].join('/'), lanes: [...n.ln].sort().join(','), bikeWays: n.bike };
  }
  return { by, bikeBy, surfBy, taggedW, defW, green, stop, cycle, pick,
           total: fc.features.length };
});
console.log('\nSOURCE  %d features', data.total);
console.log('  by class      %s', JSON.stringify(data.by));
console.log('  by surface    %s', JSON.stringify(data.surfBy));
console.log('  width from OSM lanes: %d   from class default: %d   (%s%% of ways measured)',
            data.taggedW, data.defW,
            (100 * data.taggedW / (data.taggedW + data.defW)).toFixed(1));
console.log('  with a bike lane: %s', JSON.stringify(data.bikeBy));
console.log('  green-painted ways: %d      separate cycleways: %d      stop bars: %d',
            data.green, data.cycle, data.stop);

console.log('\nNAMED STREETS — pavement width in metres, straight off the feature');
const pad = (v, n, r) => (r ? String(v).padStart(n) : String(v).padEnd(n));
console.log('  %s%s%s%s%s  %s %s', pad('street', 38), pad('ways', 5, 1), pad('min', 7, 1),
            pad('med', 7, 1), pad('max', 7, 1), pad('class(es)', 30), 'lanes');
for (const [k, v] of Object.entries(data.pick)) {
  if (!v) { console.log('  %s NOT FOUND', pad(k, 38)); continue; }
  console.log('  %s%s%s%s%s  %s %s', pad(k, 38), pad(v.n, 5, 1), pad(v.wmin.toFixed(1), 7, 1),
              pad(v.wmed.toFixed(1), 7, 1), pad(v.wmax.toFixed(1), 7, 1),
              pad(v.classes, 30), v.lanes || '-');
}

// ---- 3. what the renderer resolves those to -----------------------------
// A number in a file is not a number on the screen. Ask MapLibre to evaluate
// the actual paint expressions at a real zoom, on a real feature.
const resolved = await page.evaluate(async () => {
  const m = window.__map;
  const out = [];
  const pose = { center: [-97.7405, 30.2848], zoom: 17, pitch: 0, bearing: 0 };
  m.jumpTo(pose);
  await new Promise(r => (m.loaded() ? r() : m.once('idle', r), setTimeout(r, 8000)));
  for (const id of ['ground-road', 'ground-bike-left', 'ground-bike-right', 'ground-stopbar']) {
    if (!m.getLayer(id)) continue;
    out.push({ id,
      width: JSON.stringify(m.getPaintProperty(id, 'line-width')).slice(0, 90),
      offset: JSON.stringify(m.getPaintProperty(id, 'line-offset') || null).slice(0, 90) });
  }
  return out;
});
console.log('\nRESOLVED PAINT (truncated)');
for (const r of resolved) {
  console.log('  %s width=%s', r.id.padEnd(20), r.width);
  console.log('  %s offset=%s', ''.padEnd(20), r.offset);
}

await browser.__done();
