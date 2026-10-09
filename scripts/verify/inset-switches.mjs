/*
 * A band's own switches for what closes its recess:
 *
 *     "inset": { "d": 2.0, "soffit": false, "floor": false, "returns": false }
 *
 * Why they exist: a recessed band draws a soffit at its top, a floor at its
 * foot (when the foot is above the block's foot) and a return at each open
 * end. One recessed glass wall that a height slice cuts into two stacked
 * bands therefore got a ceiling plate across its middle, and the only way
 * round it was free geometry. Each band can now leave its own out.
 *
 * The check works on the mesh, not on a picture. The Standard's corner bay,
 * band 1 of its north face (z 6.0 to 18.4, above the block's foot, so all
 * three surfaces are drawn), is set 2.0 m back in every variant:
 *
 *   - the object form with no switches is the number form, vertex for vertex;
 *   - each switch removes vertices and only its own: turned off together they
 *     remove exactly the sum, so no switch touches another's surface;
 *   - the recessed wall itself (vertices on the plane 2.0 m behind the face)
 *     is the same in every variant;
 *   - a band's own `soffit: true` or `floor: true` draws that surface with the
 *     layer default (`APARTMENTS.insetSoffit`, city-wide) off;
 *   - taking the inset away again restores the vertex count it started with.
 *
 * Run it through the GPU slot like every other hardware check.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { launch, BASE } from './chrome.mjs';

const NAME = 'The Standard';
const browser = await launch(chromium, { gl: 'hardware', maxMs: 300000 });
try {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { const t = setInterval(() => { if (window.cancelGraphicsAutoDetect) { cancelGraphicsAutoDetect(); clearInterval(t); } }, 50); });
  await page.goto(BASE + '/index.html?intro=0&drift=0', { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => window.slopesApartments?.count.done && window.slopesApartments.readyToReveal() && !document.getElementById('veil'), null, { timeout: 180000 });

  // a rebuild is sliced over frames, so every variant is: change the band, rebuild, wait for the build, read the mesh
  const measure = async (inset, layerSoffit) => {
    await page.evaluate(([name, inset, has, layerSoffit]) => {
      const A = window.slopesApartments, cb = A.data.buildings.find(b => b.name === name).blocks.find(k => k.id === 'cornerBay');
      const band = cb.faces.v0.bands[1];
      if (!('__had' in window)) window.__had = band.inset, window.__layer = window.APARTMENTS.insetSoffit;
      if (has) band.inset = inset; else if (window.__had === undefined) delete band.inset; else band.inset = window.__had;
      window.APARTMENTS.insetSoffit = layerSoffit == null ? window.__layer : layerSoffit;
      A.rebuild();
    }, [NAME, inset === undefined ? null : inset, inset !== undefined, layerSoffit == null ? null : layerSoffit]);
    await page.waitForFunction(() => { const A = window.slopesApartments; return !!A.group && A.count.done; }, null, { timeout: 180000 });
    return page.evaluate(name => {
      const A = window.slopesApartments, S = window.slopes, D = 2.0;
      const cb = A.data.buildings.find(b => b.name === name).blocks.find(k => k.id === 'cornerBay'), band = cb.faces.v0.bands[1];
      let verts = 0, wall = 0;
      A.group.traverse(m => {
        const p = m.geometry && m.geometry.getAttribute('position');
        if (!p) return;
        verts += p.count;
        for (let i = 0; i < p.count; i++) {
          const z = p.getZ(i);
          if (z < band.z0 + 0.3 || z > band.z1 - 0.3) continue;
          const ll = S.toLngLat(p.getX(i), p.getY(i), z);
          const uv = A.lngLatToUV(name, ll.lng != null ? ll.lng : ll[0], ll.lat != null ? ll.lat : ll[1]);
          if (uv && uv[0] > 83 && uv[0] < 93 && Math.abs(uv[1] - D) < 0.05) wall++;
        }
      });
      return { verts, wall, insets: A.count.insets, z0: band.z0, z1: band.z1, blockZ0: cb.z0 || 0 };
    }, NAME);
  };
  const D = 2.0, r = {};
  r.flush = await measure(undefined);
  r.number = await measure(D);
  r.object = await measure({ d: D });
  r.noSoffit = await measure({ d: D, soffit: false });
  r.noFloor = await measure({ d: D, floor: false });
  r.noReturns = await measure({ d: D, returns: false });
  r.noLo = await measure({ d: D, returns: { lo: false } });
  r.noHi = await measure({ d: D, returns: { hi: false } });
  r.bare = await measure({ d: D, soffit: false, floor: false, returns: false });
  r.defaultOff = await measure({ d: D }, false);
  r.defaultOffOwnSoffit = await measure({ d: D, soffit: true }, false);
  r.defaultOffOwnFloor = await measure({ d: D, floor: true }, false);
  r.restored = await measure(undefined);
  Object.assign(r, { z0: r.number.z0, z1: r.number.z1, blockZ0: r.number.blockZ0 });

  const v = k => r[k].verts, soffit = v('number') - v('noSoffit'), floor = v('number') - v('noFloor'), returns = v('number') - v('noReturns');
  const lo = v('number') - v('noLo'), hi = v('number') - v('noHi');
  console.log(`band z ${r.z0} to ${r.z1}, block foot ${r.blockZ0}; vertices: flush ${v('flush')}, recessed ${v('number')}; a switch takes away: soffit ${soffit}, floor ${floor}, returns ${returns} (lo ${lo}, hi ${hi}); all off ${v('number') - v('bare')}; recessed-wall vertices ${r.number.wall}`);

  assert.equal(r.number.insets, r.flush.insets + 1, 'the recess is built');
  assert.ok(r.number.wall >= 20 && r.flush.wall === 0, `the wall stands 2.0 m back only when recessed (${r.flush.wall} -> ${r.number.wall})`);
  assert.equal(v('object'), v('number'), 'the object form with no switches is the number form');
  assert.ok(soffit > 0, 'soffit: false removes the soffit');
  assert.ok(floor > 0, 'floor: false removes the floor (this band starts above the block foot)');
  assert.ok(returns >= 0 && lo >= 0 && hi >= 0 && lo + hi === returns, `returns: false removes both ends, { lo } / { hi } one each (${lo} + ${hi} = ${returns})`);
  assert.equal(v('number') - v('bare'), soffit + floor + returns, 'the three switches are independent: together they remove exactly the sum');
  for (const k of ['object', 'noSoffit', 'noFloor', 'noReturns', 'noLo', 'noHi', 'bare', 'defaultOff', 'defaultOffOwnSoffit', 'defaultOffOwnFloor'])
    assert.equal(r[k].wall, r.number.wall, `${k}: the recessed wall itself is unchanged`);
  // the layer default is city-wide: it takes the soffit and floor off every recess, this band's among them
  assert.ok(v('defaultOff') <= v('number') - soffit - floor, 'the layer default off removes soffit and floor, as before');
  assert.equal(v('defaultOffOwnSoffit'), v('defaultOff') + soffit, 'a band\'s own soffit: true overrules the layer default');
  assert.equal(v('defaultOffOwnFloor'), v('defaultOff') + floor, 'a band\'s own floor: true overrules the layer default');
  assert.equal(v('restored'), v('flush'), 'taking the inset away restores the mesh');
  assert.deepEqual(errors, []);
  console.log('PASS a band switches its own recess soffit, floor and returns; the wall and every other band are untouched');
} finally { await browser.__done(); }
