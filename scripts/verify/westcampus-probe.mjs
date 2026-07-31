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
import { chromePath, GL_ARGS, BASE as SERVER, launch } from './chrome.mjs';

const URL = SERVER + '/_harness.html?intro=0&drift=0';
const results = [];
const ok = (name, pass, detail) => {
  results.push({ name, pass: !!pass, detail });
  console.log((pass ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : ''));
};

const browser = await launch(chromium);

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
ok('nothing stands above final_height', d.tooTall.length === 0, d.tooTall.join(' | '));
ok('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

const failed = results.filter(r => !r.pass);
console.log('\n  %d/%d assertions passed', results.length - failed.length, results.length);
await browser.__done();
process.exit(failed.length ? 1 : 0);
