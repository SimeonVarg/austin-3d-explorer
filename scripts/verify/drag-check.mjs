/**
 * drag-check.mjs — assert that the Drag pass is what docs/PASS_DRAG.md claims.
 *
 * Most of these are NEGATIVES, deliberately. The regressions that matter here
 * are the ones that still look plausible in a screenshot:
 *
 *   - the replaced buildings still drawing underneath, so a 27.5 m PCL has a
 *     15.8 m ghost inside it and the bands are invisible from every angle
 *     except overhead;
 *   - the layer anchored to the wrong symbol layer, so the whole pass sits
 *     UNDER `ground-areas` (this already happened to the stadium);
 *   - a tile silently registered at twice its intended glazing, which is what
 *     js/facades.js's own grid audit exists to catch;
 *   - the time-of-day hook missing, so the pass is correct at noon and a bright
 *     patch of daylight at midnight.
 *
 * Run against a server you own — three agents on 8099 is a real failure mode
 * here (scripts/verify/README.md). VERIFY_URL=http://127.0.0.1:8127 node drag-check.mjs
 */
import { chromium } from 'playwright-core';
import { chromePath, GL_ARGS, BASE } from './chrome.mjs';

const browser = await chromium.launch({
  executablePath: chromePath(), headless: true,
  args: [...GL_ARGS, '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));
page.on('console', m => { if (m.type() === 'error') pageErrors.push('CONSOLE ' + m.text()); });

await page.goto(BASE + '/_harness.html?intro=0&drift=0', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
await page.waitForFunction(() => window.__map.getLayer('drag-wall'), null, { timeout: 60000 })
  .catch(() => {});
await page.waitForTimeout(6000);
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

// A source only tiles what the camera asks for, so park over the Drag before
// counting source features — querySourceFeatures on an unvisited area is 0 and
// reads exactly like a layer that failed to load.
await page.evaluate(() => window.__map.jumpTo({
  center: [-97.7405, 30.2855], zoom: 15.6, pitch: 55, bearing: 0,
}));
await page.evaluate(() => new Promise(r => {
  const m = window.__map; if (m.loaded()) return r(); m.once('idle', r); setTimeout(r, 15000);
}));

const R = await page.evaluate(async () => {
  const m = window.__map;
  const layers = m.getStyle().layers.map(l => l.id);
  const gj = await (await fetch('data/drag.geojson')).json();
  const replaced = gj.replacedBuildingIds || [];

  const filterMentions = (id) => {
    try { return JSON.stringify(m.getFilter(id) || '').indexOf(replaced[0]) !== -1; }
    catch (e) { return false; }
  };
  // querySourceFeatures, not queryRenderedFeatures: the latter returns 0 at a
  // flying pitch in a scene visibly full of buildings (verify/README.md).
  const srcIds = new Set();
  for (const f of m.querySourceFeatures('austin-buildings')) {
    if (f.properties && f.properties.id) srcIds.add(f.properties.id);
  }
  const dragFeat = m.querySourceFeatures('austin-drag');
  const kinds = {};
  for (const f of dragFeat) kinds[f.properties.kind] = (kinds[f.properties.kind] || 0) + 1;

  // Every pattern id a wall feature asks for must actually be registered, or
  // MapLibre paints that wall transparent and says nothing.
  //
  // Asked of the MODULE, not of a re-fetched data/drag.geojson: `wp` is stamped
  // at runtime onto the module's own copy of the features, so a fresh fetch has
  // none and this check passed over an empty set the first time it ran.
  const combos = window.dragCombos();
  const missing = combos.filter(c => !m.hasImage(c.id)).map(c => c.id);
  // ... and the reverse direction: every family the bake emits must have got a
  // combo, or a whole band type is silently unpainted.
  const bakeFams = new Set(gj.features.filter(f => f.properties.kind === 'wall')
                                      .map(f => f.properties.fam));
  const comboFams = new Set(combos.map(c => c.fam));
  const famsWithoutImage = [...bakeFams].filter(f => !comboFams.has(f));

  // PCL's whole point is that it is nearly twice as tall as the snapshot says.
  // WALL bands only: the cap sits a further 1.0 m above the wall, so including
  // it would measure the parapet lip and not the building.
  const pclTop = Math.max(...gj.features
    .filter(f => f.properties.grp === 'pcl' && f.properties.kind === 'wall')
    .map(f => f.properties.h));
  // The shared datum: every shopfront band on the streetwall tops out on one
  // line. That continuity is what makes a run of twenty small buildings read as
  // a street rather than as twenty objects.
  const shopTops = gj.features
    .filter(f => f.properties.grp === 'shop' && f.properties.band === 'shop')
    .map(f => f.properties.h);
  const onDatum = shopTops.filter(h => Math.abs(h - 4.3) < 0.01).length;

  const ix = id => layers.indexOf(id);
  return {
    hasWall: !!m.getLayer('drag-wall'),
    hasCap: !!m.getLayer('drag-cap'),
    features: gj.features.length,
    replaced: replaced.length,
    dragSourceFeatures: dragFeat.length,
    kinds,
    filteredFrom3d: filterMentions('buildings-3d'),
    filteredFromRoof: filterMentions('buildings-roof'),
    replacedStillInBuildingsSource: replaced.filter(id => srcIds.has(id)).length,
    // The source keeps them (it is one shared source); the FILTER is what must
    // exclude them. Counted so a future reader is not surprised by the number.
    wallAboveGround: ix('drag-wall') > ix('ground-areas'),
    wallAboveBuildings: ix('drag-wall') > ix('buildings-3d'),
    capAboveWall: ix('drag-cap') > ix('drag-wall'),
    patternImagesMissing: missing,
    famsWithoutImage,
    imageCount: combos.length,
    pclTop, shopTops: shopTops.length, onDatum,
    audit: window.dragTileAudit(),
    todHooked: !!window.__dragTodHooked,
    // The tiles as DRAWN, with no map, no light and no post-process involved.
    // A screenshot cannot distinguish "the shopfront tile never repainted for
    // midnight" from "it repainted and the scene light dimmed it" — the wall
    // shading changes so much between noon and midnight that both look the
    // same. This can, and it is the assertion that the night look exists at all.
    tiles: ['shopGlass', 'signBand', 'retUpper', 'pclCoffer', 'uniWin']
      .map(f => ({ fam: f, day: window.dragTileSample(f, 0.14), night: window.dragTileSample(f, 0.86) }))
      .filter(r => r.day && r.night)
      .map(r => ({ fam: r.fam, day: r.day.luma, night: r.night.luma })),
    verticalGradient: m.getPaintProperty('drag-wall', 'fill-extrusion-vertical-gradient'),
    // Every building's bands must tile its full height with no gap and no
    // overlap. A gap is a stripe of sky through the middle of a building; an
    // overlap is two coplanar surfaces with different colours, which is
    // textbook z-fighting and flips as the camera moves (js/app.js's parapet
    // comment is a whole essay on having shipped exactly that). Both are close
    // to invisible in a still frame, which is why this is a number.
    //
    // Merged as INTERVALS rather than compared pairwise, because PCL's coffer
    // bands are inset 0.7 m and so are not the same ring as the spandrels
    // around them — they are still part of the same vertical stack.
    bandSpans: (() => {
      const byB = new Map();
      for (const f of gj.features) {
        const p = f.properties;
        if (!byB.has(p.bid)) byB.set(p.bid, []);
        byB.get(p.bid).push([p.base, p.h]);
      }
      let gaps = 0, overlaps = 0, notFromZero = 0;
      for (const spans of byB.values()) {
        spans.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        if (spans[0][0] > 0.02) notFromZero++;
        let reach = spans[0][1];
        for (let i = 1; i < spans.length; i++) {
          const [b, h] = spans[i];
          if (b > reach + 0.02) gaps++;
          else if (b < reach - 0.02) overlaps++;
          reach = Math.max(reach, h);
        }
      }
      return { gaps, overlaps, notFromZero, buildings: byB.size };
    })(),
  };
});

// Night behaviour: the pass must go dark with the city. Sample the mean luma of
// the drag layers alone at noon and at midnight — a pass that only looks right
// at noon is not done, and an unlit building brighter than the night sky is the
// inverted-silhouette failure night-silhouette.mjs exists to catch.
const luma = {};
for (const [tag, p] of [['day', 0.14], ['night', 0.86]]) {
  await page.evaluate(async (p) => {
    const m = window.__map;
    m.jumpTo({ center: [-97.74195, 30.28690], zoom: 17.4, pitch: 66, bearing: 288 });
    window.applyTimeOfDay(m, p, true);
    for (const l of m.getStyle().layers) {
      const keep = /^drag-/.test(l.id) || l.id === 'background';
      try { m.setLayoutProperty(l.id, 'visibility', keep ? 'visible' : 'none'); } catch (e) {}
    }
  }, p);
  await page.waitForTimeout(3500);
  await page.evaluate(() => window.__map.triggerRepaint());
  await page.waitForTimeout(1200);
  luma[tag] = await page.evaluate(() => {
    const c = window.__map.getCanvas();
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    const buf = new Uint8Array(c.width * c.height * 4);
    gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    // Only pixels the drag layers actually painted: everything else is the
    // background colour, and averaging it in would measure the sky.
    let sum = 0, n = 0, bg = null;
    for (let i = 0; i < buf.length; i += 4) {
      const key = (buf[i] << 16) | (buf[i + 1] << 8) | buf[i + 2];
      if (bg === null && i === 0) bg = key;
    }
    for (let i = 0; i < buf.length; i += 4) {
      const key = (buf[i] << 16) | (buf[i + 1] << 8) | buf[i + 2];
      if (key === bg) continue;
      sum += 0.30 * buf[i] + 0.59 * buf[i + 1] + 0.11 * buf[i + 2];
      n++;
    }
    return { mean: n ? +(sum / n).toFixed(1) : -1, coverage: +(n / (c.width * c.height)).toFixed(4) };
  });
}

const A = [];
const t = (name, cond, detail) => A.push({ name, pass: !!cond, detail });

t('drag-wall layer exists', R.hasWall);
t('drag-cap layer exists', R.hasCap);
t('bake emitted features', R.features > 60, R.features);
t('24 buildings replaced', R.replaced === 24, R.replaced);
t('source tiles the bands', R.dragSourceFeatures > 40, JSON.stringify(R.kinds));
t('buildings-3d filters the replaced ids', R.filteredFrom3d);
t('buildings-roof filters the replaced ids', R.filteredFromRoof);
t('walls anchored ABOVE ground-areas', R.wallAboveGround);
t('walls anchored ABOVE buildings-3d', R.wallAboveBuildings);
t('every pattern image is registered', R.patternImagesMissing.length === 0, R.patternImagesMissing);
t('every band family got a combo', R.famsWithoutImage.length === 0, R.famsWithoutImage);
t('atlas cost stays small', R.imageCount > 0 && R.imageCount <= 18, R.imageCount + ' images');
t('PCL is emitted at its derived 27.5 m, not the baked 15.8', Math.abs(R.pclTop - 27.5) < 0.6, R.pclTop);
t('the streetwall shares one shopfront datum',
  R.onDatum >= 16, `${R.onDatum} of ${R.shopTops} shopfronts at exactly 4.3 m`);
t('every tile within its glazing/gap spec', R.audit.every(r => r.ok),
  R.audit.filter(r => !r.ok).map(r => r.fam).join(',') || 'all ok');
// Not `window.applyTimeOfDay.__drag`: six passes wrap that same function and
// whichever boots LAST owns the outermost closure, so the property is false for
// every pass but one even though all of them are being called. That version of
// this check read as "the drag pass never hooked time-of-day" while the drag
// pass was demonstrably repainting.
t('applyTimeOfDay is wrapped', R.todHooked);
const tile = f => R.tiles.find(t => t.fam === f) || { day: 0, night: 0 };
t('shopfronts light up at night, hard',
  tile('shopGlass').night > tile('shopGlass').day * 3,
  `${tile('shopGlass').day} -> ${tile('shopGlass').night}`);
t('sign bands light up at night',
  tile('signBand').night > tile('signBand').day,
  `${tile('signBand').day} -> ${tile('signBand').night}`);
for (const f of ['retUpper', 'pclCoffer', 'uniWin']) {
  t(`${f} goes dark at night`, tile(f).night < tile(f).day * 0.55,
    `${tile(f).day} -> ${tile(f).night}`);
}
t('vertical gradient OFF on banded walls', R.verticalGradient === false, R.verticalGradient);
t('bands tile each building with no gap or overlap',
  R.bandSpans.gaps === 0 && R.bandSpans.overlaps === 0 && R.bandSpans.notFromZero === 0,
  JSON.stringify(R.bandSpans));
t('the pass paints pixels', luma.day.coverage > 0.01, JSON.stringify(luma.day));
t('night is much darker than day', luma.night.mean < luma.day.mean * 0.62,
  `day ${luma.day.mean} -> night ${luma.night.mean}`);
t('no page errors', pageErrors.length === 0, pageErrors.slice(0, 4));

let fail = 0;
for (const a of A) {
  if (!a.pass) fail++;
  console.log(`${a.pass ? 'PASS' : 'FAIL'}  ${a.name}${a.detail !== undefined ? '   [' + a.detail + ']' : ''}`);
}
console.log('\nglazing audit:');
for (const r of R.audit) console.log(' ', JSON.stringify(r));
console.log(`\n${A.length - fail}/${A.length} passed`);
await browser.close();
process.exit(fail ? 1 : 0);
