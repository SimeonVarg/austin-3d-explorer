/**
 * outer-check.mjs — assert the outer ring is what it claims to be.
 *
 * The tiering in docs/OUTER_RING.md is a promise about cost, and a promise about
 * cost decays the moment someone "just adds a roof cap to the ring too". These
 * assertions are the promise written down somewhere a change can trip over.
 *
 * The important ones are the NEGATIVES — the ring must NOT have picked up the
 * core's expensive layers — because those are the failures that look fine in a
 * screenshot and cost frames.
 *
 * Runs against _harness.html (which carries the outer.js script tag) at
 * swiftshader speed; nothing here is a timing assertion. See outer-perf.mjs for
 * those.
 *
 * Usage:  node outer-check.mjs
 */
import { chromium } from 'playwright-core';
import { chromePath, GL_ARGS, BASE, launch } from './chrome.mjs';

const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const logs = [];
page.on('console', m => logs.push(m.text()));

await page.goto(`${BASE}/_harness.html?intro=0&drift=0`, { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 90000 });
await page.waitForFunction(() => window.__map.getLayer('outer-3d'), null, { timeout: 90000 })
  .catch(() => {});
await page.waitForTimeout(9000);
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

// Put the camera somewhere with both tiers in frame and let the sources settle.
// querySourceFeatures only reports tiles loaded for the CURRENT viewport, so
// asking at the spawn pose before anything has moved returns 0 for the core
// too — which reads as "nothing is drawing" in a scene that is fine.
await page.evaluate(() => {
  window.__map.jumpTo({ center: [-97.7425, 30.2860], zoom: 15.1, pitch: 74, bearing: 180 });
});
// 3 s was not enough under swiftshader on a cold load and the ring reported 0
// source features while visibly present — a harness settle bug that reads
// exactly like a broken layer.
await page.waitForTimeout(6000);
await page.evaluate(() => new Promise(r => {
  const m = window.__map;
  if (m.loaded()) return r();
  m.once('idle', r);
  setTimeout(r, 20000);
}));

const s = await page.evaluate(() => {
  const m = window.__map;
  const style = m.getStyle();
  const ids = style.layers.map(l => l.id);
  const layer = id => style.layers.find(l => l.id === id);
  const outerLayers = ids.filter(id => id.startsWith('outer-'));
  const src = m.getSource('austin-outer');
  return {
    outerLayers,
    layerTypes: outerLayers.map(id => layer(id).type),
    flatHasPattern: !!(layer('outer-3d') || {}).paint?.['fill-extrusion-pattern'],
    towerHasPattern: !!(layer('outer-tower') || {}).paint?.['fill-extrusion-pattern'],
    midHasPattern: !!(layer('outer-midrise') || {}).paint?.['fill-extrusion-pattern'],
    sourceMaxzoom: src && src.maxzoom,
    // The maxzoom the ring is SUPPOSED to have, read from the shared block
    // rather than written here as a literal. The literal said 15 and the
    // shared block has said 16 since the pattern-tiling fix, so the assert has
    // been red for a reason that was never a defect.
    wantMaxzoom: (window.PATTERN_TILING || {}).maxzoom,
    // A VECTOR source needs its source-layer or this returns [] — which is why
    // this read 0 and "the ring tiled and is drawing" failed on `main` too.
    // It only started failing honestly when _harness.html was given the pmtiles
    // library; before that TILES.on was false and the ring was never tiled at
    // all, so the assert was measuring the GeoJSON fallback and passing.
    ringTiled: (() => {
      try {
        const sl = (layer('outer-3d') || {})['source-layer'];
        return m.querySourceFeatures('austin-outer', sl ? { sourceLayer: sl } : undefined).length;
      } catch (e) { return 0; }
    })(),
    coreTiled: (() => { try { return m.querySourceFeatures('austin-buildings').length; } catch (e) { return 0; } })(),
    // The ring must not GROW the palette. An absolute count is the wrong test:
    // it reads 20, not 14, because quantiseStadiumFacades legitimately appends
    // the six DKR wall materials the city palette does not have. What matters
    // is that re-running the ring's own snap appends nothing — it is the one
    // quantiser that is forbidden from calling addImage.
    bucketsBefore: (window.facadePalette() || []).length,
    bucketsAfterResnap: (() => {
      const fake = [{ properties: { wd: '#8fa3b4' } }, { properties: { wd: '#123456' } }];
      window.quantiseOuterFacades(fake);
      return (window.facadePalette() || []).length;
    })(),
    // Density knob
    density: window.GFX.outerDensity,
    outerDensityInPerformance: window.GFX_PRESETS
      ? window.GFX_PRESETS.performance.outerDensity : null,
  };
});

const ring = await (await fetch(`${BASE}/data/outer_ring.geojson`)).json();
const props = ring.features.map(f => f.properties);
const towers = props.filter(p => p.t === 1);

const checks = [];
const ok = (name, cond, detail) => checks.push({ name, pass: !!cond, detail });

// A NAMED SET, not a count. "Exactly three" was written when the ring was
// three layers, and it has been red ever since outer-tower-roof was added — so
// a check that exists to notice a new draw call has been unable to say WHICH
// one appeared. The cost the count was defending is still defended: this list
// is the budget, and adding to it is a deliberate edit here.
const WANT_LAYERS = [
  'outer-3d',            // the 7,511 flat low-rise prisms
  'outer-tower',         // downtown towers, patterned
  'outer-midrise',       // the downtown streetwall, patterned
  'outer-detail',        // crowns, masts, bands, park pads, roof plant
  'outer-tower-roof',    // parapet on the towers
  'outer-midrise-roof',  // parapet on the streetwall
];
ok('the ring is on the map', s.outerLayers.length > 0, s.outerLayers.join(', '));
ok('the ring draws exactly its budgeted layers, no more',
   s.outerLayers.length === WANT_LAYERS.length &&
   WANT_LAYERS.every(id => s.outerLayers.includes(id)),
   `${s.outerLayers.length}: ${s.outerLayers.join(', ')}`);
ok('no AO / contact-shadow layer for the ring',
   !s.outerLayers.some(id => /ao|shadow/.test(id)));
ok('no label layer for the ring',
   !s.outerLayers.some(id => /label/.test(id)));
ok('the bulk of the ring is FLAT — no facade pattern', !s.flatHasPattern);
ok('the towers DO get the facade pattern', s.towerHasPattern);
ok('the downtown STREETWALL gets the facade pattern too', s.midHasPattern);
ok('the source maxzoom matches the shared PATTERN_TILING block',
   s.sourceMaxzoom === s.wantMaxzoom, `${s.sourceMaxzoom} vs ${s.wantMaxzoom}`);
ok('the ring tiled and is drawing', s.ringTiled > 100, `${s.ringTiled} source features`);
ok('the core still tiles', s.coreTiled > 100, `${s.coreTiled} source features`);

ok('the ring cannot grow the facade palette',
   s.bucketsAfterResnap === s.bucketsBefore,
   `${s.bucketsBefore} -> ${s.bucketsAfterResnap}`);
const patternLog = logs.find(l => l.startsWith('[scene]')) || '';
// The PATTERN count moves whenever a family x bucket combination is added and
// is not the invariant; the BUCKET count is. It said 44 and the core has
// reported 64 since the tower buckets landed, so this was red for a change it
// was never about.
ok('the core still elects 14 colour buckets',
   /14 colour buckets/.test(patternLog), patternLog);
const outerLog = logs.find(l => l.startsWith('[outer]')) || '';
// WAS 'the towers added ZERO new pattern images'. That was true when the ring
// snapped onto the campus palette, and PR #84 deliberately ended it: the towers
// now register their OWN buckets because campus tan on a glass tower was the
// defect. Asserting the old behaviour made the check red for the fix.
ok('downtown registers its buckets from the BAKED ordinals',
   /baked ordinals/.test(outerLog) && !/NO STREETWALL/.test(outerLog), outerLog);

ok('no ring feature carries a name or a label flag',
   props.every(p => !p.name && !p.lbl));
ok('no ring feature carries a building class or a height source',
   props.every(p => !p.building_class && !p.source_height));
ok('every ring feature carries a density rank',
   props.every(p => typeof p.d === 'number'));
ok('towers rank in the top 2% and survive any density above 0.02',
   towers.every(p => p.d <= 0.02), `worst tower d = ${Math.max(...towers.map(p => p.d))}`);
// Towers AND the downtown streetwall carry rd/rg/rn, because both are capped
// with a parapet (js/outer.js, shared CAP_GEOM). Nothing else may: three more
// hex strings on 6,866 backdrop prisms is most of the file for a roof plane
// nobody sees, which is the original point of this assert and still holds.
ok('roof colours are baked for the capped classes ONLY',
   props.filter(p => p.t === 1 || p.t === 2).every(p => p.rd) &&
   props.filter(p => p.t !== 1 && p.t !== 2).every(p => !p.rd));
ok('the performance preset thins the ring',
   s.outerDensityInPerformance != null && s.outerDensityInPerformance < 1,
   String(s.outerDensityInPerformance));

const avgVerts = ring.features.reduce((a, f) => a + f.geometry.coordinates[0].length, 0)
  / ring.features.length;
ok('geometry is genuinely simplified (< 12 vertices/footprint average)',
   avgVerts < 12, avgVerts.toFixed(1));

const tall = props.filter(p => p.h >= 200).length;
ok('the seven 200 m+ towers are present', tall >= 7, `${tall} at or above 200 m`);

let failed = 0;
for (const c of checks) {
  if (!c.pass) failed++;
  console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? '   [' + c.detail + ']' : ''}`);
}
console.log(`\n${checks.length - failed}/${checks.length} passed`);
console.log(`ring: ${ring.features.length} buildings, ${towers.length} towers, ` +
            `${avgVerts.toFixed(1)} vertices/footprint average`);

await browser.__done();
process.exit(failed ? 1 : 0);
