/**
 * moody-pose.mjs — solve camera poses instead of guessing them.
 *
 * The first hand-written shot list for this pass put Moody Center off screen
 * entirely: the frame came back as empty ground and read exactly like "the
 * building failed to render". Placing the camera N metres back along the
 * bearing does NOT put the target at a predictable screen height, because at
 * pitch 68 the map centre sits far below the screen centre and the ground-plane
 * scale ahead of it is wildly non-linear.
 *
 * So: ask the renderer. For each (target, bearing, zoom, pitch) this walks the
 * pull-back distance until map.project(target) lands at the requested fraction
 * down the frame, and prints a ready-to-paste shot entry. map.project is the
 * same transform that draws the scene, so a solved pose cannot disagree with
 * what the screenshot shows.
 *
 * Usage: node moody-pose.mjs            (prints the solved shot list)
 */
import { chromium } from 'playwright-core';
import { chromePath, BASE as SERVER, launch } from './chrome.mjs';

// name, [lng,lat], bearing, zoom, pitch, wanted screen-Y fraction.
//
// wantY must be BELOW 0.5 and that is not a taste call. MapLibre always projects
// the map centre to the middle of the canvas, so with the camera pulled back
// along the view bearing the target can only ever sit ABOVE centre — f = 0.5 at
// zero pull-back, falling toward the horizon as the camera retreats. The first
// run asked for 0.62, which is unreachable, so the bisection ran to its bound
// and every pose came back 1.4 km short of the building.
const WANT = [
  ['moody-west',    [-97.730624, 30.280934],  90, 16.6, 68, 0.44],
  ['moody-south',   [-97.730624, 30.280934],   0, 16.6, 68, 0.44],
  ['moody-air-ne',  [-97.730624, 30.280934], 218, 16.2, 60, 0.42],
  ['dellmed-west',  [-97.734930, 30.277550],  86, 16.7, 68, 0.44],
  ['dellmed-south', [-97.734930, 30.277550],   4, 16.7, 68, 0.44],
  ['nms-south',     [-97.737687, 30.289193],   2, 16.9, 68, 0.44],
  ['precinct',      [-97.733000, 30.279500], 315, 15.7, 70, 0.42],
];

const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('PAGEERR', e.message));

await page.goto(SERVER + '/_harness.html?intro=0&drift=0', { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 90000 });
await page.waitForTimeout(3000);

const out = [];
for (const [name, target, bearing, zoom, pitch, wantY] of WANT) {
  const r = await page.evaluate(([target, bearing, zoom, pitch, wantY]) => {
    const m = window.__map;
    const H = m.getCanvas().clientHeight, W = m.getCanvas().clientWidth;
    const lat0 = target[1];
    const mPerDegLat = 111320, mPerDegLon = 111320 * Math.cos(lat0 * Math.PI / 180);
    // Camera centre = target pulled BACK along the view bearing by d metres.
    const centreFor = d => {
      const rad = bearing * Math.PI / 180;
      return [target[0] - Math.sin(rad) * d / mPerDegLon,
              target[1] - Math.cos(rad) * d / mPerDegLat];
    };
    // Bisect on d. f is MONOTONICALLY DECREASING in d: at d = 0 the target is
    // the map centre and projects to f = 0.5; pulling the camera back walks it
    // up toward the horizon. So "too high in frame" means pull back LESS.
    let lo = 0, hi = 1400, best = null;
    for (let i = 0; i < 24; i++) {
      const d = (lo + hi) / 2;
      m.jumpTo({ center: centreFor(d), zoom, pitch, bearing });
      const p = m.project(target);
      const f = p.y / H;
      best = { d, f, x: p.x / W, centre: centreFor(d) };
      if (f < wantY) hi = d; else lo = d;
    }
    return best;
  }, [target, bearing, zoom, pitch, wantY]);
  const ok = Math.abs(r.f - wantY) < 0.04 && r.x > 0.2 && r.x < 0.8;
  console.log('%s  d=%s m  screenY=%s  screenX=%s  %s',
    name.padEnd(14), r.d.toFixed(0).padStart(5), r.f.toFixed(3), r.x.toFixed(3),
    ok ? 'OK' : 'OUT OF FRAME');
  out.push({ name, center: [+r.centre[0].toFixed(6), +r.centre[1].toFixed(6)], zoom, pitch, bearing, ok });
}

console.log('\n--- solved poses ---');
for (const o of out) {
  console.log(' {"name":"%s","center":[%s,%s],"zoom":%s,"pitch":%s,"bearing":%s},',
    o.name, o.center[0], o.center[1], o.zoom, o.pitch, o.bearing);
}
await browser.__done();
