/**
 * boot.mjs — where do the fifteen seconds before the city appears actually go?
 *
 * THE QUESTION, AND WHY GUESSING AT IT HAS BEEN WRONG EVERY TIME. A visitor
 * waits ~15 s. The obvious culprit was the payload, and tiling the trees took
 * 28.4 MB down to 19.7 MB — which moved the wait by about a second. So the bytes
 * were never most of it, and every remaining theory about that time (the
 * graphics probe, the GPU, the number of layers) has been tested and been wrong.
 *
 * So: stop theorising, timestamp the boot.
 *
 * HOW IT INSTRUMENTS WITHOUT EDITING THE APP. The passes that matter are plain
 * globals — quantiseFacades, mergeCapitolScene, applyUnion24, initCapitol and
 * friends — assigned to `window` by their own modules at load. This installs a
 * SETTER for each name before any page script runs, so the moment a module
 * assigns its function it gets wrapped and timed. Nothing in js/ changes, and a
 * function that never appears simply never reports.
 *
 * `fetch` is wrapped the same way, per URL, so network time is separable from
 * the JavaScript that runs on the result. That distinction is the whole point:
 * fetching 9 MB and parsing 9 MB are both "slow load" and have completely
 * different fixes.
 *
 * WHAT IT CANNOT SEE, stated because a profiler that hides its blind spots is
 * how you end up confidently optimising the wrong thing:
 *   - work inside MapLibre's WORKER (tiling geometry) — it is off the main
 *     thread and invisible here. If main-thread time plus fetch time does not
 *     add up to the wall clock, the remainder is the worker.
 *   - GPU time.
 *
 * Usage:  VERIFY_URL=http://127.0.0.1:8123 node scripts/verify/boot.mjs
 */
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';

const WRAP = [
  'quantiseFacades', 'quantisePartFacades', 'mergeCapitolScene', 'applyUnion24',
  'initCapitol', 'initGround', 'initRoofs', 'initProps', 'initOuter',
  'initTower', 'initWestCampus', 'initDrag', 'initArts', 'initMoody',
  'initPlaces', 'initShadows', 'initSigns', 'initNight', 'applyTimeOfDay',
  'buildFacadeAtlas', 'treeFilter',
];

const browser = await launch(chromium, { gl: 'hardware' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e => console.log('  [pageerror] ' + e.message));

await page.addInitScript(names => {
  const T0 = performance.now();
  const calls = [];
  window.__boot = { t0: T0, calls, fetches: [] };

  for (const name of names) {
    let real;
    Object.defineProperty(window, name, {
      configurable: true,
      get() { return real; },
      set(fn) {
        if (typeof fn !== 'function') { real = fn; return; }
        real = function () {
          const s = performance.now();
          const out = fn.apply(this, arguments);
          const done = d => calls.push({ name, at: s - T0, ms: d });
          // Async passes (mergeCapitolScene) must be timed to their PROMISE,
          // not to the synchronous return, or they report ~0 ms and the time
          // they actually cost lands nowhere.
          if (out && typeof out.then === 'function') {
            out.then(() => done(performance.now() - s),
                     () => done(performance.now() - s));
          } else {
            done(performance.now() - s);
          }
          return out;
        };
      },
    });
  }

  /**
   * PER-SOURCE LOAD TIME, which is the number that decides what to tile next.
   *
   * A source's cost is fetch + parse + worker tiling, and only the first of
   * those is visible in a network waterfall. `sourcedata` fires repeatedly while
   * a source works and carries `isSourceLoaded`, so the first event where that
   * flips true is when the source became usable. Recording the FIRST such event
   * per id — later ones are the map re-tiling for a new viewport, not load.
   */
  window.__srcTimes = {};
  const hookMap = m => {
    m.on('sourcedata', e => {
      if (!e.sourceId || !e.isSourceLoaded) return;
      if (window.__srcTimes[e.sourceId] == null) {
        window.__srcTimes[e.sourceId] = performance.now() - T0;
      }
    });
  };
  // __map is assigned once app.js builds it; wait for it the same way.
  let _m;
  Object.defineProperty(window, '__map', {
    configurable: true,
    get() { return _m; },
    set(v) { _m = v; try { if (v && v.on) hookMap(v); } catch (e) {} },
  });

  const realFetch = window.fetch;
  window.fetch = function (input) {
    const url = String((input && input.url) || input);
    const s = performance.now();
    return realFetch.apply(this, arguments).then(r => {
      // Time to HEADERS, not to body — the body is consumed by the caller and
      // its parse cost belongs to whatever called it, not to the network.
      window.__boot.fetches.push({ url, at: s - T0, ms: performance.now() - s });
      return r;
    });
  };
}, WRAP);

/**
 * NETWORK THROTTLING, AND WHY EVERY LOAD MEASUREMENT WITHOUT IT IS MISLEADING.
 *
 * Served from 127.0.0.1 there is no bandwidth limit, so 28 MB and 9 MB arrive in
 * almost the same time and tiling appears to buy nothing. Measured: trees tiled
 * saved ~0.3 s locally. That number is real and it is about the least useful
 * true thing you could say, because a visitor is not on localhost.
 *
 * NET=4g   ~9 Mbps down, 1.5 Mbps up, 85 ms RTT   a decent phone
 * NET=3g   ~1.6 Mbps down, 750 kbps up, 300 ms    a bad connection
 * NET=off  (default) localhost, no limit
 */
const NET = process.env.NET || 'off';
const PROFILES = {
  '4g': { downloadThroughput: 9000e3 / 8, uploadThroughput: 1500e3 / 8, latency: 85 },
  '3g': { downloadThroughput: 1600e3 / 8, uploadThroughput: 750e3 / 8, latency: 300 },
};
if (PROFILES[NET]) {
  const c = await page.context().newCDPSession(page);
  await c.send('Network.enable');
  await c.send('Network.emulateNetworkConditions', { offline: false, ...PROFILES[NET] });
}

const t0 = Date.now();
const EXTRA = process.env.EXTRA || '';
await page.goto(BASE + '/index.html?intro=0&drift=0' + EXTRA, { waitUntil: 'commit', timeout: 120000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
const styleMs = Date.now() - t0;
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

/**
 * "READY" IS `areTilesLoaded()`, NOT `idle`, and the difference is 20 seconds
 * of nonsense.
 *
 * The first version waited on `map.once('idle')` and reported 37.5 s, against
 * payload.mjs's 14.9 s for the same page. `idle` means the map has finished
 * rendering AND has nothing queued — but the sky canvas repaints every frame,
 * so the map is never idle in that sense and the event fires whenever the
 * scheduler happens to allow it. It is not a readiness signal for an app that
 * animates, and 20 of those 37 seconds were the instrument, not the site.
 *
 * `areTilesLoaded()` asks the thing a visitor actually cares about: is every
 * tile for the current view built and drawable.
 */
/**
 * READY = every one of OUR sources reports loaded. Third attempt at this line,
 * and the two before it were both wrong in ways that changed the conclusion:
 *
 *   once('idle')            37 s. The sky canvas repaints every frame so the
 *                           map is never idle; the event fires when the
 *                           scheduler allows. 20 of those seconds were the
 *                           instrument.
 *   areTilesLoaded()        7 s, but NOT COMPARABLE across builds. With GeoJSON
 *                           the tree source has not begun fetching the first
 *                           time it is asked, so it answers "all loaded" and the
 *                           un-tiled build scores an artificially fast time.
 *                           Produced a 3x difference that was entirely metric.
 *   loaded()                never fires on a throttled connection inside 180 s.
 *
 * `isSourceLoaded` per source, over the sources WE add, is comparable by
 * construction: the same ids exist in both builds and each answers about its own
 * data. It is also the thing a visitor is waiting for — our city, not the
 * basemap's fonts.
 */
await page.waitForFunction(() => {
  const m = window.__map;
  const ids = Object.keys(m.getStyle().sources).filter(id => /^austin-/.test(id));
  if (!ids.length) return false;
  return ids.every(id => { try { return m.isSourceLoaded(id); } catch (e) { return false; } });
}, null, { timeout: 180000 })
  .catch(() => console.log('  WARN: some austin-* source never loaded; lower bound'));
const idleMs = Date.now() - t0;

const b = await page.evaluate(() => window.__boot);

const ms = n => n.toFixed(0).padStart(6) + ' ms';
console.log('\n=== wall clock ===');
console.log('  style loaded          ' + ms(styleMs));
console.log('  map idle (city up)    ' + ms(idleMs));

const srcT = await page.evaluate(() => window.__srcTimes || {});
const ours = Object.entries(srcT).filter(([id]) => /^austin-/.test(id))
  .sort((a, b) => b[1] - a[1]);
console.log('\n=== when each of OUR sources became usable (fetch + parse + worker tiling) ===');
for (const [id, t] of ours) {
  console.log('  ' + (t / 1000).toFixed(2).padStart(7) + ' s   ' + id);
}
const others = Object.entries(srcT).filter(([id]) => !/^austin-/.test(id))
  .sort((a, b) => b[1] - a[1]).slice(0, 3);
if (others.length) {
  console.log('  -- not ours --');
  for (const [id, t] of others) console.log('  ' + (t / 1000).toFixed(2).padStart(7) + ' s   ' + id);
}

console.log('\n=== main-thread passes, slowest first ===');
const calls = b.calls.sort((a, c) => c.ms - a.ms);
let mainTotal = 0;
for (const c of calls) {
  mainTotal += c.ms;
  // Millisecond precision on the START time, because rounded to 0.1 s these
  // six init passes all read "+2.1 s" and look concurrent. Whether they are
  // concurrent or stacked is the difference between 1.6 s of the load and 8.5 s.
  if (c.ms >= 5) {
    console.log('  ' + ms(c.ms) + '   start +' + c.at.toFixed(0).padStart(6)
                + ' ms   end +' + (c.at + c.ms).toFixed(0).padStart(6) + ' ms   ' + c.name);
  }
}
console.log('  ' + ms(mainTotal) + '   TOTAL of ' + calls.length + ' instrumented passes');

console.log('\n=== fetches, slowest first (time to headers) ===');
const fs_ = b.fetches.sort((a, c) => c.ms - a.ms);
let netTotal = 0;
for (const f of fs_) {
  netTotal += f.ms;
  if (f.ms >= 20) {
    console.log('  ' + ms(f.ms) + '   at +' + (f.at / 1000).toFixed(1) + ' s   '
                + f.url.replace(BASE + '/', '').slice(0, 60));
  }
}
console.log('  ' + ms(netTotal) + '   TOTAL of ' + fs_.length + ' fetches (overlapping, so not additive)');

const unaccounted = idleMs - mainTotal;
console.log('\n=== what is left ===');
console.log('  ' + ms(idleMs) + '   to a drawn city');
console.log('  ' + ms(mainTotal) + '   instrumented main-thread JS');
console.log('  ' + ms(unaccounted) + '   NOT accounted for  <- worker tiling, GPU,');
console.log('                          style parsing, and anything not wrapped above.');
console.log('\nIf that last line dominates, the fix is not in js/ and not in the');
console.log('payload — it is MapLibre turning GeoJSON into tiles in the worker.');

await browser.__done();
