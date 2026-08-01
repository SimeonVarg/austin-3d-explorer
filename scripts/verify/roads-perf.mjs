/**
 * roads-perf.mjs — what does moving the roads off the basemap tiles cost?
 *
 * The awkward part of this A/B is that "before" is not a setting. Before this
 * pass the road geometry came from the basemap's vector tiles; after it, from a
 * 2.5 MB GeoJSON source. No GROUND flag reproduces the old state, so toggling
 * inside one page cannot measure it.
 *
 * So the two builds are served side by side and the PAGE is what alternates:
 *   HEAD_URL    a pristine `git archive HEAD` tree  (roads on the basemap tiles)
 *   VERIFY_URL  this branch
 * One browser, one window, one machine, reloaded between configurations and
 * counterbalanced. Page load is not inside the measured window.
 *
 * Every rule from ground-tex-perf.mjs still applies and is not restated here:
 *   HEADED, index.html not _harness.html, scripted bearing sweep, INTERLEAVED
 *   and counterbalanced, report the MINIMUM of the reps, count DROPPED frames,
 *   and the anti-throttling flags.
 *
 * Usage: HEAD_URL=http://127.0.0.1:8172 VERIFY_URL=http://127.0.0.1:8171 \
 *          node roads-perf.mjs [reps]
 */
import { chromium } from 'playwright-core';
import { chromePath, BASE as SERVER, launch } from './chrome.mjs';

const REPS = parseInt(process.argv[2] || '5', 10);
const MS = 4200;
const HEAD_URL = process.env.HEAD_URL;
if (!HEAD_URL) {
  console.error('set HEAD_URL to a server running a pristine `git archive HEAD` tree');
  process.exit(1);
}

// A pose with arterials, campus paths, the Speedway brick and West Campus all
// in frame — measuring the cost of roads over a pose with no roads in it is how
// you prove anything is free.
const POSE = { center: [-97.7396, 30.2852], zoom: 17.0, pitch: 74 };

const CONFIGS = {
  // the previous pass, roads drawn from the basemap's vector tiles
  head:     { url: HEAD_URL,  set: null },
  // this branch with the new layers off: roads from GeoJSON, nothing else new
  roadsOnly:{ url: SERVER, set: { bike: false, stopBars: false, speedway: false } },
  // this branch, everything on
  after:    { url: SERVER, set: { bike: true, stopBars: true, speedway: true } },
};

const browser = await launch(chromium, {
  gl: 'hardware',
  executablePath: chromePath(), headless: false,
  args: ['--no-sandbox',
         '--disable-backgrounding-occluded-windows',
         '--disable-renderer-backgrounding',
         '--disable-background-timer-throttling',
         '--disable-features=CalculateNativeWinOcclusion'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.bringToFront();

let loadedUrl = null;
async function ensure(url) {
  if (loadedUrl === url) return;
  await page.goto(url + '/index.html?intro=0&drift=0', { timeout: 180000 });
  await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 180000 });
  // Wait on the SOURCES, not a clock: roads.geojson is 2.5 MB and a rep that
  // starts while it is still tiling measures the fetch, not the frame.
  await page.waitForFunction(() => {
    const m = window.__map;
    return ['austin-buildings', 'austin-ground', 'austin-trees', 'austin-roads']
      .every(s => !m.getSource(s) || m.isSourceLoaded(s));
  }, null, { timeout: 180000 }).catch(() => console.log('WARN sources not all loaded'));
  await page.waitForTimeout(9000);
  await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
  loadedUrl = url;
}

async function run(cfg) {
  await ensure(cfg.url);
  await page.evaluate((c) => {
    const m = window.__map;
    if (c.set && window.GROUND) {
      Object.assign(window.GROUND, c.set);
      window.applyGroundSettings(m);
    }
    m.jumpTo({ center: c.pose.center, zoom: c.pose.zoom, pitch: c.pose.pitch, bearing: 0 });
  }, { set: cfg.set, pose: POSE });
  await page.waitForTimeout(1800);
  const out = await page.evaluate(async (args) => {
    const m = window.__map, { ms, pose } = args;
    const dts = [];
    let last = performance.now(), t0 = last, b = 0;
    await new Promise(res => {
      const step = () => {
        const now = performance.now();
        dts.push(now - last); last = now;
        b += 0.9;
        m.jumpTo({ center: pose.center, zoom: pose.zoom, pitch: pose.pitch, bearing: b });
        if (now - t0 < ms) requestAnimationFrame(step); else res();
      };
      requestAnimationFrame(step);
    });
    const drop = dts.slice(3).reduce((a, d) => a + Math.max(0, Math.round(d / 16.67) - 1), 0);
    return { dropped: drop, frames: dts.length,
             fps: +(1000 * dts.length / (performance.now() - t0)).toFixed(1) };
  }, { ms: MS, pose: POSE });
  // Echo what is actually on screen next to the number. Four "different"
  // configurations once ran identically while the report printed four numbers.
  const echo = await page.evaluate(() => {
    const m = window.__map;
    const vis = id => { try { const l = m.getLayer(id); return l ? (m.getLayoutProperty(id, 'visibility') || 'vis') : 'absent'; } catch (e) { return 'err'; } };
    return { road: vis('ground-road'), bike: vis('ground-bike-right'),
             stop: vis('ground-stopbar'), brick: vis('ground-speedway-brick'),
             src: !!m.getSource('austin-roads') };
  });
  return { ...out, echo };
}

const results = {};
for (const k of Object.keys(CONFIGS)) results[k] = [];
for (let r = 0; r < REPS; r++) {
  const order = Object.entries(CONFIGS);
  if (r % 2) order.reverse();
  for (const [k, cfg] of order) results[k].push(await run(cfg));
}

const pad = (v, n) => String(v).padStart(n);
console.log('\nconfig      dropMIN   fpsBest   all reps               what was on');
for (const [k, arr] of Object.entries(results)) {
  const drops = arr.map(a => a.dropped);
  const e = arr[arr.length - 1].echo;
  console.log(k.padEnd(11) + pad(Math.min(...drops), 7) +
    pad(Math.max(...arr.map(a => a.fps)).toFixed(1), 10) + '   ' +
    ('[' + drops.join(', ') + ']').padEnd(22) +
    `roadsSrc=${e.src} road=${e.road} bike=${e.bike} stop=${e.stop} brick=${e.brick}`);
}
const min = k => Math.min(...results[k].map(a => a.dropped));
const spread = k => Math.max(...results[k].map(a => a.dropped)) - min(k);
console.log(`\ndelta vs head (dropped frames over ${MS} ms, MIN of ${REPS} reps):`);
for (const k of ['roadsOnly', 'after']) {
  console.log('  ' + k.padEnd(10) + pad((min(k) - min('head') >= 0 ? '+' : '') +
    (min(k) - min('head')), 5) + '    (within-config spread: head ' +
    spread('head') + ', ' + k + ' ' + spread(k) + ')');
}
console.log('\nIf a delta is smaller than the within-config spread there is no result.');
await browser.__done();
