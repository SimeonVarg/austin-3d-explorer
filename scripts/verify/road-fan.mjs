/**
 * road-fan.mjs — does a road stay the width it says it is as the camera pitches?
 *
 * THE DEFECT. "i look closer to horizontal (low) and speedway gets super wide
 * and right after monochrome is a seperate layer thats a bit narrower that also
 * grows wider as i approach 90 degrees."
 *
 * Two layers fanning together says one shared rule, and both of those are drawn
 * by `widthExpr` in ground.js. Speedway is `w: 9.1` metres in the data, so the
 * data is not the problem.
 *
 * WHY THIS MEASURES INSTEAD OF ARGUING. Three plausible stories fit the symptom
 * and they disagree about the sign:
 *
 *   - a `line-width` in screen pixels is constant along the line, so ground
 *     that recedes toward the horizon gets more metres per pixel and the road
 *     fans OUT
 *   - controls.js holds ALTITUDE and varies pitch, and MapLibre's zoom is
 *     defined at the map centre; as pitch rises the centre runs away, zoom
 *     drops by ~log2(1/cos p), and the line should get THINNER
 *   - the near ground also recedes as the camera lies down, which pushes the
 *     other way again
 *
 * Reasoning about that is how an hour went last night. So: ask the renderer.
 *
 * THE RULER. `map.project()` knows the full perspective transform, so projecting
 * two points 9.1 m apart ACROSS Speedway gives the true on-screen width of the
 * real thing at that spot. `widthExpr`'s value at the live zoom is what the
 * layer actually draws. Their ratio is the defect, in one number, per pitch.
 *
 * ratio 1.0 = the road is exactly as wide as it claims. 4.0 = four times too
 * wide, which is what "super wide" looks like.
 *
 * WHAT IT REPORTS NOW. `ground-paths` was fixed by moving the width into the
 * geometry (bake_ground.py buffers the centreline; the layer is a fill), so it
 * has no line-width left to evaluate and this prints GEOMETRY for it -- a fill
 * is width-correct at every pitch by construction and there is nothing to
 * measure. `ground-road` still carries the defect and still measures, which is
 * the point of leaving it in: the number here is the size of the next job.
 *
 * Usage:  VERIFY_URL=http://127.0.0.1:8123 node scripts/verify/road-fan.mjs
 */
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';

/**
 * SAMPLE ALONG THE ROAD, NOT AT THE MAP CENTRE. The first cut of this probe
 * measured one point at the centre of the screen and reported a flat 1.00x at
 * every pitch — which is true, and useless. `widthExpr` is DERIVED from the
 * centre-scale relation, so at the centre it agrees with map.project() by
 * construction. The whole defect is that a `line-width` is one constant number
 * of screen pixels for the entire line while the true width of 9.1 m of ground
 * collapses toward the horizon. You only see it by walking up the road.
 */
const SPEEDWAY_LNG = -97.7371;
const CAM_LAT = 30.2820;                 // south end, looking north up the promenade
const SAMPLE_LATS = [30.2830, 30.2845, 30.2860, 30.2875, 30.2890, 30.2910];
const SPEEDWAY_W = 9.1;                  // metres, straight off the feature
const PITCHES = [20, 40, 60, 75, 82, 86];
const LAYER = process.argv[2] || 'ground-paths';

const browser = await launch(chromium, { gl: 'hardware' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', e => console.log('  [pageerror] ' + e.message));

await page.goto(BASE + '/index.html?intro=0&drift=0', { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
await page.waitForTimeout(2500);

const rows = await page.evaluate(async ([lng, camLat, lats, wM, pitches, layer]) => {
  const m = window.__map;
  const M_LAT = 111195.08;
  const mLon = lat => M_LAT * Math.cos(lat * Math.PI / 180);

  /**
   * Evaluate the layer's OWN line-width expression at the live zoom rather than
   * re-deriving it here. Re-deriving is how you end up testing your copy of the
   * formula instead of the one that ships.
   */
  const widthPx = (layerId, zoom) => {
    if (!m.getLayer(layerId)) return null;
    // A fill has no line-width. That is the fix, not a failure to read it.
    if (m.getLayer(layerId).type !== 'line') return 'GEOMETRY';
    const e = m.getPaintProperty(layerId, 'line-width');
    if (!Array.isArray(e) || e[0] !== 'interpolate') return null;
    // ['interpolate', ['exponential', b], ['zoom'], z0, v0, z1, v1, ...]
    const base = e[1][1];
    const stops = [];
    for (let i = 3; i < e.length; i += 2) {
      let v = e[i + 1];
      // ['*', ['get','w'], k]  ->  w * k, with w taken from the feature.
      if (Array.isArray(v) && v[0] === '*') {
        const k = v.find(x => typeof x === 'number');
        v = wM * k;
      }
      if (typeof v === 'number') stops.push([e[i], v]);
    }
    if (stops.length < 2) return null;
    let a = stops[0], b2 = stops[stops.length - 1];
    for (let i = 0; i < stops.length - 1; i++) {
      if (zoom >= stops[i][0] && zoom <= stops[i + 1][0]) { a = stops[i]; b2 = stops[i + 1]; }
    }
    const t = (Math.pow(base, zoom - a[0]) - 1) / (Math.pow(base, b2[0] - a[0]) - 1);
    return a[1] + t * (b2[1] - a[1]);
  };

  const H = m.getCanvas().clientHeight;

  const out = [];
  for (const pitch of pitches) {
    // Sit on the south end of the promenade and look north along it, which is
    // exactly the view the report describes.
    m.jumpTo({ center: [lng, camLat], zoom: 17.0, pitch, bearing: 0 });
    await new Promise(r => setTimeout(r, 700));

    const zoom = m.getZoom();
    const drawn = widthPx(layer, zoom);
    if (drawn === 'GEOMETRY') {
      out.push({ pitch, zoom: +zoom.toFixed(3), geometry: true, samples: [] });
      continue;
    }
    const half = wM / 2 / mLon(camLat);

    const samples = [];
    for (const lat of lats) {
      const L = m.project([lng - half, lat]);
      const R = m.project([lng + half, lat]);
      const truePx = Math.hypot(R.x - L.x, R.y - L.y);
      // Off the bottom or above the horizon: not something the viewer sees.
      const onScreen = L.y > 0 && L.y < H && truePx > 0.01;
      samples.push({ lat, truePx: +truePx.toFixed(2), y: Math.round(L.y), onScreen });
    }
    out.push({ pitch, zoom: +zoom.toFixed(3), drawn: +drawn.toFixed(2), samples });
  }
  return out;
}, [SPEEDWAY_LNG, CAM_LAT, SAMPLE_LATS, SPEEDWAY_W, PITCHES, LAYER]);

console.log('\nSpeedway is 9.1 m wide in the data. Camera on its south end at zoom 17, looking north.');
console.log('true = what map.project() says 9.1 m of ground is, in px, at that point up the road.');
console.log('drawn = the single line-width the layer paints for the WHOLE line.');
console.log('ratio = drawn / true. 1.00 is correct; 4.00 means four times too wide there.\n');

if (rows.every(r => r.geometry)) {
  console.log('layer ' + LAYER + ' is a FILL: its width lives in the geometry, so it is');
  console.log('width-correct at every pitch by construction and there is nothing to measure.');
  console.log('Re-run against a line layer to see the defect:  node road-fan.mjs ground-road');
  await browser.__done();
  process.exit(0);
}

let worst = { ratio: 0 };
for (const r of rows) {
  const vis = r.samples.filter(s => s.onScreen);
  console.log('pitch ' + String(r.pitch).padStart(2) + '   zoom ' + r.zoom.toFixed(2)
    + '   drawn ' + r.drawn.toFixed(1) + ' px for every metre of the line');
  for (const s of r.samples) {
    const ratio = r.drawn / s.truePx;
    const flag = !s.onScreen ? '   (off screen)' : ratio > 1.6 ? '   <-- too wide' : '';
    console.log('     ' + (s.lat.toFixed(4)) + '   y=' + String(s.y).padStart(5)
      + '   true ' + String(s.truePx.toFixed(1)).padStart(6) + ' px'
      + '   ratio ' + (ratio.toFixed(2) + 'x').padStart(8) + flag);
    if (s.onScreen && ratio > worst.ratio) worst = { ratio, pitch: r.pitch, lat: s.lat };
  }
  if (vis.length > 1) {
    const near = vis[0], far = vis[vis.length - 1];
    console.log('     spread across the visible road: '
      + (r.drawn / near.truePx).toFixed(2) + 'x near -> '
      + (r.drawn / far.truePx).toFixed(2) + 'x far');
  }
  console.log('');
}
console.log('worst on-screen ratio: ' + worst.ratio.toFixed(2) + 'x at pitch ' + worst.pitch
  + ', lat ' + worst.lat);

await browser.__done();
