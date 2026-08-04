/**
 * src-ready.mjs — WHICH source is still not ready, and when did each become ready?
 *
 * WHY THIS EXISTS. `boot.mjs` waits for every `austin-*` source to report
 * `isSourceLoaded`, and on 2026-08-04 that wait ran past its own 180 s timeout
 * and then past chrome.mjs's 300 s watchdog, so the script died before printing
 * anything at all. "Some source never loaded" is not a usable finding; WHICH one
 * is. This polls every source by name on a fixed cadence and prints the first
 * moment each flips true, then names the ones that never did.
 *
 * THE TRAP THIS IS BUILT AROUND. `isSourceLoaded(id)` answers *for the current
 * viewport*, not "has this file downloaded" — HANDOFF §73 is the whole story. A
 * source can be fully fetched and still answer false because a tile for the
 * current view is in flight, and it can answer TRUE before it has fetched
 * anything at all if nothing in view needs it. So this also records
 * `sourcedata` events and the source's own tile count, and prints both. Two
 * disagreeing readings are the finding, not a bug in the instrument.
 *
 * Usage:  VERIFY_URL=http://127.0.0.1:8211 node scripts/verify/src-ready.mjs
 *         WAIT=60  seconds to poll for (default 60)
 */
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';

const WAIT_S = Number(process.env.WAIT || 60);

const browser = await launch(chromium, { gl: 'hardware' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e => console.log('  [pageerror] ' + e.message));

await page.addInitScript(() => {
  const T0 = performance.now();
  window.__t0 = T0;
  window.__ready = {};        // id -> ms at which isSourceLoaded first went true
  window.__sdata = {};        // id -> count of sourcedata events
  let _m;
  Object.defineProperty(window, '__map', {
    configurable: true,
    get() { return _m; },
    set(v) {
      _m = v;
      try {
        v.on('sourcedata', e => {
          if (!e.sourceId) return;
          window.__sdata[e.sourceId] = (window.__sdata[e.sourceId] || 0) + 1;
        });
      } catch (e) {}
    },
  });
  // Poll every source by name. Cheap, and it is the only way to catch the
  // moment a source flips without depending on an event that may not fire.
  const tick = () => {
    const m = window.__map;
    if (m && m.getStyle && m.isStyleLoaded && m.isStyleLoaded()) {
      for (const id of Object.keys(m.getStyle().sources)) {
        if (window.__ready[id] != null) continue;
        let ok = false;
        try { ok = m.isSourceLoaded(id); } catch (e) {}
        if (ok) window.__ready[id] = performance.now() - T0;
      }
    }
    setTimeout(tick, 100);
  };
  tick();
});

const t0 = Date.now();
await page.goto(BASE + '/index.html?intro=0&drift=0', { waitUntil: 'commit', timeout: 120000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
console.log('style loaded at ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s; polling for ' + WAIT_S + ' s');

await page.waitForTimeout(WAIT_S * 1000);

const out = await page.evaluate(() => {
  const m = window.__map;
  const ids = Object.keys(m.getStyle().sources);
  return ids.map(id => {
    const s = m.getSource(id);
    let kind = s && s.type;
    let loadedNow = false;
    try { loadedNow = m.isSourceLoaded(id); } catch (e) {}
    // How many tiles does this source currently hold, and how many are still
    // loading? A GeoJSON source that never tiled shows zero of both.
    let tiles = -1, loading = -1;
    try {
      const cache = m.style.sourceCaches[id] || (m.style._otherSourceCaches || {})[id];
      if (cache) {
        const t = cache.getVisibleCoordinates ? cache.getVisibleCoordinates().length : -1;
        tiles = t;
        loading = Object.values(cache._tiles || {}).filter(x => x.state === 'loading').length;
      }
    } catch (e) {}
    return { id, kind, at: window.__ready[id], loadedNow, sdata: window.__sdata[id] || 0, tiles, loading };
  });
});

const ours = out.filter(r => /^austin-/.test(r.id));
const rest = out.filter(r => !/^austin-/.test(r.id));

const row = r =>
  '  ' + (r.at == null ? '  NEVER' : (r.at / 1000).toFixed(2).padStart(7) + ' s') +
  '  now=' + (r.loadedNow ? 'yes' : 'NO ') +
  '  ' + String(r.kind).padEnd(8) +
  '  sourcedata x' + String(r.sdata).padStart(3) +
  '  tiles ' + String(r.tiles).padStart(3) + ' (' + r.loading + ' loading)' +
  '  ' + r.id;

console.log('\n=== our sources, first moment isSourceLoaded() went true ===');
for (const r of ours.sort((a, b) => (a.at ?? 1e9) - (b.at ?? 1e9))) console.log(row(r));
console.log('\n=== everything else ===');
for (const r of rest.sort((a, b) => (a.at ?? 1e9) - (b.at ?? 1e9))) console.log(row(r));

const never = out.filter(r => r.at == null);
console.log('\n' + never.length + ' source(s) never reported loaded in ' + WAIT_S + ' s'
            + (never.length ? ': ' + never.map(r => r.id).join(', ') : ''));

await browser.__done();
