/**
 * road-probe.mjs — what does the basemap actually give us for roads?
 *
 * Roads are NOT in data/ground.geojson. The bake only reads footways, plazas,
 * landuse, water, sport and parking, so every drivable surface in the frame is
 * the Liberty basemap's `transportation` source-layer, widened and tinted by
 * cleanupBasemap/styleRoad in js/timeofday.js. Before styling roads ourselves we
 * have to know exactly what classes the tiles carry and what the basemap layers
 * are currently doing with them — deriving the rule before drawing.
 *
 * Prints: the road layers cleanupBasemap kept, and the class/subclass/brunnel
 * histogram of the transportation features actually loaded over campus.
 */
import { chromium } from 'playwright-core';
import { chromePath, BASE as SERVER } from './chrome.mjs';

const browser = await chromium.launch({
  executablePath: chromePath(), headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--ignore-gpu-blocklist', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('PAGEERR', e.message));

await page.goto(SERVER + '/_harness.html?intro=0&drift=0', { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 90000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
await page.evaluate(() => {
  window.__map.jumpTo({ center: [-97.7400, 30.2850], zoom: 15.2, pitch: 0, bearing: 0 });
});
await page.waitForTimeout(6000);
await page.evaluate(() => new Promise(r => {
  const m = window.__map; if (m.loaded()) return r(); m.once('idle', r); setTimeout(r, 20000);
}));

const out = await page.evaluate(() => {
  const m = window.__map;
  const style = m.getStyle();
  const vecSrc = Object.keys(style.sources).find(id => style.sources[id].type === 'vector');

  const roadLayers = style.layers
    .filter(l => (l['source-layer'] || '') === 'transportation')
    .map(l => ({
      id: l.id,
      type: l.type,
      vis: (l.layout && l.layout.visibility) || 'visible',
      filter: JSON.stringify(l.filter || null),
      color: JSON.stringify((l.paint || {})['line-color'] ?? null),
      width: JSON.stringify((l.paint || {})['line-width'] ?? null),
    }));

  const feats = m.querySourceFeatures(vecSrc, { sourceLayer: 'transportation' });
  const hist = {}, sub = {}, brun = {}, propKeys = {}, oneway = {}, laneSplit = {};
  const LANE_CLASSES = window.GROUND ? window.GROUND.laneClasses : [];
  for (const f of feats) {
    const p = f.properties || {};
    hist[p.class] = (hist[p.class] || 0) + 1;
    if (p.subclass) sub[p.class + '/' + p.subclass] = (sub[p.class + '/' + p.subclass] || 0) + 1;
    if (p.brunnel) brun[p.brunnel] = (brun[p.brunnel] || 0) + 1;
    for (const k of Object.keys(p)) propKeys[k] = (propKeys[k] || 0) + 1;

    // The lane-marking rule, evaluated against the real data rather than
    // assumed: which branch does each feature that GETS a marking land on?
    // `oneway` arriving as the string "yes" instead of the number 1 would make
    // every road take the yellow branch and the rule would be silently wrong.
    oneway[typeof p.oneway + ':' + p.oneway] = (oneway[typeof p.oneway + ':' + p.oneway] || 0) + 1;
    if (LANE_CLASSES.includes(p.class) && p.ramp !== 1 && p.brunnel !== 'tunnel') {
      const divided = p.oneway === 1 || p.oneway === -1;
      laneSplit[(divided ? 'white (oneway) ' : 'yellow (undivided) ') + p.class] =
        (laneSplit[(divided ? 'white (oneway) ' : 'yellow (undivided) ') + p.class] || 0) + 1;
    }
  }
  return { vecSrc, roadLayers, total: feats.length, hist, sub, brun, propKeys, oneway, laneSplit,
           sample: feats.slice(0, 3).map(f => f.properties) };
});

console.log('VECTOR SOURCE:', out.vecSrc);
console.log('\nTRANSPORTATION LAYERS IN STYLE (after cleanupBasemap):');
for (const l of out.roadLayers) {
  console.log(`  ${l.vis === 'none' ? 'HIDDEN ' : 'SHOWN  '} ${l.id.padEnd(38)} ${l.type.padEnd(6)} color=${l.color} width=${l.width}`);
}
console.log('\nFEATURES LOADED:', out.total);
console.log('class histogram:', JSON.stringify(out.hist, null, 1));
console.log('class/subclass:', JSON.stringify(out.sub, null, 1));
console.log('brunnel:', JSON.stringify(out.brun, null, 1));
console.log('property keys:', JSON.stringify(out.propKeys, null, 1));
console.log('\noneway values (type:value):', JSON.stringify(out.oneway, null, 1));
console.log('\nWHICH LANE MARKING EACH ELIGIBLE ROAD ACTUALLY GETS:');
for (const [k, v] of Object.entries(out.laneSplit).sort()) console.log('  ' + k.padEnd(34) + v);
console.log('\nsample:', JSON.stringify(out.sample, null, 1));

// GROUND TRUTH CHECK. 74% of the features carry oneway=1, which is far too many
// for it to mean "this carriageway is one-way", so the rule that picks a white
// lane divider over a yellow centre line cannot be trusted on the histogram
// alone. Point-query streets whose real-world direction is not in doubt: at
// pitch 0 the centre pixel IS the street under the crosshair.
const TRUTH = [
  { name: 'Guadalupe @ the Drag', lng: -97.74173, lat: 30.28600, real: 'TWO-WAY' },
  { name: 'Guadalupe @ 21st',     lng: -97.74166, lat: 30.28320, real: 'TWO-WAY' },
  { name: 'MLK Jr Blvd @ Univ',   lng: -97.73920, lat: 30.28090, real: 'TWO-WAY' },
  { name: 'Speedway @ 24th',      lng: -97.73700, lat: 30.28640, real: 'pedestrianised' },
  { name: 'San Jacinto @ 21st',   lng: -97.73310, lat: 30.28350, real: 'TWO-WAY' },
  { name: 'I-35 mainlanes',       lng: -97.72620, lat: 30.28300, real: 'divided, ONE-WAY each' },
  { name: '24th St @ Nueces',     lng: -97.74560, lat: 30.28780, real: 'TWO-WAY' },
];
console.log('\nGROUND TRUTH: what the tiles say about streets whose direction is known');
console.log('street                    class       oneway  ->marking      reality');
for (const t of TRUTH) {
  const r = await page.evaluate((t) => {
    const m = window.__map;
    if (m.isEasing && m.isEasing()) m.stop();
    m.jumpTo({ center: [t.lng, t.lat], zoom: 17.5, pitch: 0, bearing: 0 });
    return new Promise(res => setTimeout(() => {
      const c = m.getCanvas();
      const pt = [c.clientWidth / 2, c.clientHeight / 2];
      let f = [];
      try { f = m.queryRenderedFeatures(pt, { layers: ['ground-road'] }); } catch (e) {}
      if (!f.length) {
        // A miss at the exact centre is a miss on a narrow street, not an
        // absence: widen to a small box before concluding anything.
        try {
          f = m.queryRenderedFeatures(
            [[pt[0] - 14, pt[1] - 14], [pt[0] + 14, pt[1] + 14]], { layers: ['ground-road'] });
        } catch (e) {}
      }
      const p = f.length ? f[0].properties : null;
      res(p ? { cls: p.class, oneway: p.oneway === undefined ? '-' : p.oneway } : null);
    }, 2600));
  }, t);
  const marking = !r ? '?' : (r.oneway === 1 || r.oneway === -1 ? 'white' : 'yellow');
  console.log(t.name.padEnd(26) + (r ? r.cls : 'NO FEATURE').padEnd(12) +
              String(r ? r.oneway : '-').padEnd(8) + marking.padEnd(14) + t.real);
}
await browser.close();
