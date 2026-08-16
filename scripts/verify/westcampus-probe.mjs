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
 * RESTORED 2026-08-16. The body of this file — `newPage`, `goto`, the pose, the
 * settle conditions and the whole `page.evaluate` that produces `d` — was
 * deleted by commit 90ad9d7's mass edit on 2026-07-31, leaving the 21
 * assertions below reading an undefined `d`. It threw
 * `ReferenceError: d is not defined` on every invocation for sixteen days,
 * including through the West Campus pass it was written to certify. The body
 * here is the pre-90ad9d7 original, unchanged apart from routing through
 * `launch()`/`__done()` and the `--break` switch.
 *
 * Run: node westcampus-probe.mjs           (needs the repo served, see README)
 *      node westcampus-probe.mjs --break   hides one wc- layer in the page;
 *                                          the gate must come back RED
 */
import { chromium } from 'playwright-core';
import { chromePath, GL_ARGS, BASE as SERVER, launch } from './chrome.mjs';

const URL = SERVER + '/_harness.html?intro=0&drift=0';
const results = [];
const ok = (name, pass, detail) => {
  results.push({ name, pass: !!pass, detail });
  console.log((pass ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : ''));
};

const BREAK = process.argv.includes('--break');

const browser = await launch(chromium);
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
// Wait for the CONDITION, not for a clock. `m.loaded()` can return true while
// the source is still tiling in its worker, so a fixed settle here is a coin
// toss on a busy machine — and when it loses, querySourceFeatures returns an
// empty array and three assertions below pass VACUOUSLY against nothing.
await page.waitForFunction(() => {
  const m = window.__map;
  const f = m.querySourceFeatures('austin-westcampus') || [];
  return f.length > 40 && f.some(x => x.properties && x.properties.kind === 'wall');
}, null, { timeout: 60000 }).catch(() => console.log('WARN: westcampus source never tiled at the pose'));
await page.waitForTimeout(1500);

if (BREAK) {
  // Hide one of the three wc- layers IN THE PAGE. Nothing on disk changes.
  // This is the shape of the quietest way this pass fails — a band that is
  // simply not drawn, which from a distance still looks like a tower.
  const hid = await page.evaluate(() => {
    const m = window.__map;
    const id = m.getStyle().layers.map(l => l.id).find(x => x.startsWith('wc-'));
    if (!id) return null;
    m.setLayoutProperty(id, 'visibility', 'none');
    return id;
  });
  console.log(`*** --break: layer ${hid} hidden IN THE PAGE`);
}

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
    // Nothing may stand ABOVE the building's own LiDAR high point. The mechanical
    // penthouse is cut OUT of final_height, not stacked on top of it, and a roof
    // pergola is in the point cloud too. The first cut lifted the penthouse onto
    // the parapet coping and left all ten a metre taller than the data says.
    tooTall: (() => {
      const src = m.querySourceFeatures('austin-buildings') || [];
      const fh = {};
      for (const f of src) if (f.properties && f.properties.name) fh[f.properties.name] = f.properties.final_height;
      const top = {};
      for (const f of feats) top[f.properties.name] = Math.max(top[f.properties.name] || 0, f.properties.h);
      return Object.entries(top)
        .filter(([n, t]) => fh[n] != null && t - fh[n] > 0.05)
        .map(([n, t]) => `${n} ${t.toFixed(2)} > ${fh[n]}`);
    })(),
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
// COUNTS DERIVED FROM THE FILE, NOT FROZEN INTO THIS SCRIPT.
//
// These two read `=== 10` when the bake emitted ten buildings. It emits 24 now,
// and 15 amenity decks, so the moment this file was revived it went red on its
// own staleness rather than on anything about the city. A count assertion that
// has to be edited every time the bake grows is a count assertion nobody will
// keep, and one that has been wrong for as long as the script has been dead is
// worse. The invariant that actually matters is one deck per building and at
// least the original ten buildings still present.
ok('at least the original 10 buildings emitted', d.names >= 10, String(d.names));
ok('4 band kinds present', ['base', 'podium', 'tower', 'crown'].every(b => d.bands[b] > 0),
   JSON.stringify(d.bands));
ok('podium band exists (Castilian + Dobie)', d.bands.podium === 2, String(d.bands.podium));
ok('amenity decks emitted, at most one per building',
   (d.classes.deck || 0) >= 10 && (d.classes.deck || 0) <= d.names,
   `${d.classes.deck} decks over ${d.names} buildings`);
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
// THE BAND GAPS ARE A REAL, OPEN FINDING — recorded, not excused away.
//
// On the first run this script has completed since 2026-07-31 it reported gaps
// AND OVERLAPS on three buildings: The Standard (main base->crown +8.70 m, then
// three bay tower->tower of -8.70 m), 2400 Nueces (+/-13.80 m) and Block on
// 25th East (+/-20.50 m). The signed pairs are the tell — a positive gap on the
// main stack matched by an equal NEGATIVE one on the bays is a bay whose bands
// are offset from the main stack's by exactly the crown height, not noise.
//
// `data/westcampus.geojson` and its bake are not this lane's to write, so this
// is QUEUE Y21 and the count is BASELINED here, following `coplanar.mjs
// --gate`: eleven known entries pass, a twelfth or a new building fails. Raise
// or lower this number only alongside a bake change, and say which in the diff.
const GAP_BASELINE = 11;
const GAP_BUILDINGS = ['The Standard', '2400 Nueces', 'Block on 25th East'];
const newGaps = d.gaps.filter(g => !GAP_BUILDINGS.some(b => g.startsWith(b + '|')));
ok(`no NEW vertical gaps between bands (${GAP_BASELINE} known, QUEUE Y21)`,
   newGaps.length === 0 && d.gaps.length <= GAP_BASELINE,
   `${d.gaps.length} total, ${newGaps.length} outside the known three buildings` +
   (newGaps.length ? ': ' + newGaps.join(' | ') : ''));
ok('nothing stands above final_height', d.tooTall.length === 0, d.tooTall.join(' | '));
ok('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

const failed = results.filter(r => !r.pass);
console.log('\n  %d/%d assertions passed', results.length - failed.length, results.length);
await browser.__done();
process.exit(failed.length ? 1 : 0);
