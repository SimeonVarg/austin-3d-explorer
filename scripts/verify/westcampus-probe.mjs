/**
 * westcampus-probe.mjs — assert that the West Campus pass is what it claims.
 *
 * Most of these are NEGATIVES, because the failures this pass can have all look
 * fine in a thumbnail:
 *   - a wall band whose pattern image was never registered renders TRANSPARENT,
 *     not wrong-coloured, so the tower silently loses a storey band;
 *   - the generic 82 m prism not being filtered out buries every band inside it,
 *     and from a distance a solid tower still looks like a tower;
 *   - anchoring to the wrong symbol layer drops the whole pass under the ground
 *     fill, which the stadium already did once;
 *   - a roof deck placed at the parapet is swallowed by the parapet cap.
 *
 * Run: node westcampus-probe.mjs      (needs the repo served, see README)
 */
import { chromium } from 'playwright-core';
import { chromePath, GL_ARGS, BASE as SERVER } from './chrome.mjs';

const URL = SERVER + '/_harness.html?intro=0&drift=0';
const results = [];
const ok = (name, pass, detail) => {
  results.push({ name, pass: !!pass, detail });
  console.log((pass ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : ''));
};

const browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: GL_ARGS });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));

await page.goto(URL, { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
// The module self-boots on a poll, and the source tiles in a worker afterwards.
await page.waitForFunction(() => window.__map.getSource('austin-westcampus'), null, { timeout: 60000 })
  .catch(() => {});
await page.waitForTimeout(4000);

// PUT THE CAMERA ON WEST CAMPUS FIRST. querySourceFeatures only sees LOADED
// tiles, so probing from the spawn pose returns an empty array — and an empty
// array passes "every wall band carries a pattern id" and "every pattern image
// is registered" vacuously. The first run of this script did exactly that and
// reported both green while measuring nothing, which is the trap
// docs/PASS_COMMON.md section 2 calls "confirm you are sampling YOUR output".
const POSE = { center: [-97.7434, 30.2848], zoom: 16.1, pitch: 66, bearing: 205 };
await page.evaluate(async (pose) => {
  const m = window.__map;
  if (m.isEasing && m.isEasing()) m.stop();
  m.jumpTo(pose);
}, POSE);
await page.waitForTimeout(2500);
await page.evaluate(() => new Promise(r => {
  const m = window.__map;
  if (m.loaded()) return r();
  m.once('idle', r); setTimeout(r, 15000);
}));
await page.waitForTimeout(1500);

const d = await page.evaluate(async () => {
  const m = window.__map;
  const gj = await (await fetch('data/westcampus.geojson')).json();
  const feats = gj.features;
  const walls = feats.filter(f => f.properties.kind === 'wall');
  const solids = feats.filter(f => f.properties.kind === 'solid');
  const bands = {}, classes = {};
  for (const f of walls) bands[f.properties.band] = (bands[f.properties.band] || 0) + 1;
  for (const f of solids) classes[f.properties.s] = (classes[f.properties.s] || 0) + 1;

  // Every wall band must have been stamped with a pattern id AND that image must
  // actually be registered. A `wp` pointing at an image MapLibre does not have is
  // painted transparent, which is the single quietest way this pass can fail.
  const src = m.getSource('austin-westcampus');
  const inSource = m.querySourceFeatures('austin-westcampus') || [];
  const stamped = inSource.filter(f => f.properties && f.properties.kind === 'wall');
  const missingImg = [...new Set(stamped.map(f => f.properties.wp).filter(Boolean))]
    .filter(id => !m.hasImage(id));
  const unstamped = stamped.filter(f => !f.properties.wp).length;

  // The generic prisms must be gone from BOTH building layers.
  const gone = gj.replacedBuildingIds || [];
  const still = [];
  for (const id of ['buildings-3d', 'buildings-roof']) {
    if (!m.getLayer(id)) continue;
    const fs = m.querySourceFeatures('austin-buildings') || [];
    const filt = JSON.stringify(m.getFilter(id) || '');
    for (const g of gone) if (!filt.includes(g)) { still.push(id + ':' + g); break; }
  }

  // Layer order: our layers must sit ABOVE the ground fill, not under it.
  const order = m.getStyle().layers.map(l => l.id);
  const iGround = order.indexOf('ground-areas');
  const iWall = order.indexOf('wc-wall');
  const iB3d = order.indexOf('buildings-3d');

  return {
    features: feats.length, walls: walls.length, solids: solids.length,
    bands, classes,
    hasSource: !!src,
    layers: ['wc-wall', 'wc-wall-cap', 'wc-solid'].filter(id => !!m.getLayer(id)),
    visible: ['wc-wall', 'wc-wall-cap', 'wc-solid']
      .filter(id => m.getLayer(id) && m.getLayoutProperty(id, 'visibility') !== 'none'),
    sourceFeatures: inSource.length,
    stampedWalls: stamped.length, unstamped, missingImg,
    replaced: gone.length, stillDrawn: still,
    order: { iGround, iWall, iB3d },
    // Vertical extent: the stack must actually span from grade to the crown.
    zmin: Math.min(...feats.map(f => f.properties.base)),
    zmax: Math.max(...feats.map(f => f.properties.h)),
    names: [...new Set(feats.map(f => f.properties.name))].length,
    // No band may be inverted or zero-height — a silent way to lose a storey.
    badSpan: feats.filter(f => f.properties.h - f.properties.base <= 0.02).length,
    // Bands within one building must tile with no gap and no overlap.
    // Keyed by (building, STACK). A stepped building has two parallel stacks —
    // the tower and the lower wing — and sorting all of its bands into one list
    // reports the wing's crown as a 27 m hole in the tower. That was this
    // script's bug, not the bake's.
    gaps: (() => {
      const by = {};
      for (const f of walls) {
        const k = f.properties.name + '|' + (f.properties.stack || 'main');
        (by[k] = by[k] || []).push(f.properties);
      }
      const bad = [];
      for (const [k, arr] of Object.entries(by)) {
        const st = arr.slice().sort((a, b) => a.base - b.base);
        for (let i = 1; i < st.length; i++) {
          const gap = st[i].base - st[i - 1].h;
          if (Math.abs(gap) > 0.05) bad.push(`${k} ${st[i - 1].band}->${st[i].band} ${gap.toFixed(2)}m`);
        }
      }
      return bad;
    })(),
  };
});

console.log('\n-- West Campus probe ------------------------------------------');
console.log('  features %d (%d wall, %d solid) over %d buildings',
            d.features, d.walls, d.solids, d.names);
console.log('  bands   ', JSON.stringify(d.bands));
console.log('  solids  ', JSON.stringify(d.classes));
// Node's console.log does not understand a precision specifier — it leaves
// "%.1f" as literal text and shifts every later argument into the wrong slot.
console.log('  z span   ' + d.zmin.toFixed(1) + ' .. ' + d.zmax.toFixed(1) + ' m');
console.log('  layers   ', d.order, '\n');

ok('source austin-westcampus exists', d.hasSource);
ok('all three layers added', d.layers.length === 3, d.layers.join(','));
ok('all three layers visible', d.visible.length === 3, d.visible.join(','));
ok('10 buildings emitted', d.names === 10, String(d.names));
ok('4 band kinds present', ['base', 'podium', 'tower', 'crown'].every(b => d.bands[b] > 0),
   JSON.stringify(d.bands));
ok('podium band exists (Castilian + Dobie)', d.bands.podium === 2, String(d.bands.podium));
ok('amenity decks emitted', (d.classes.deck || 0) === 10, String(d.classes.deck));
ok('pools emitted', (d.classes.pool || 0) >= 8, String(d.classes.pool));
ok('balcony slabs emitted', (d.classes.balc || 0) >= 60, String(d.classes.balc));
ok('mechanical penthouses emitted', (d.classes.mech || 0) === 10, String(d.classes.mech));
ok('source has tiled features at the pose', d.sourceFeatures > 40, String(d.sourceFeatures));
ok('wall bands present in the tiled set', d.stampedWalls > 20, String(d.stampedWalls));
ok('every wall band carries a pattern id', d.unstamped === 0, d.unstamped + ' unstamped');
ok('every pattern image is registered', d.missingImg.length === 0, d.missingImg.join(','));
ok('all 10 generic prisms filtered out', d.stillDrawn.length === 0, d.stillDrawn.join(','));
ok('wc-wall sits above ground-areas', d.order.iWall > d.order.iGround,
   `wall@${d.order.iWall} ground@${d.order.iGround}`);
ok('wc-wall sits above buildings-3d', d.order.iWall > d.order.iB3d,
   `wall@${d.order.iWall} b3d@${d.order.iB3d}`);
ok('no zero-height features', d.badSpan === 0, String(d.badSpan));
ok('no vertical gaps between bands', d.gaps.length === 0, d.gaps.join(' | '));
ok('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

const failed = results.filter(r => !r.pass);
console.log('\n  %d/%d assertions passed', results.length - failed.length, results.length);
await browser.close();
process.exit(failed.length ? 1 : 0);
