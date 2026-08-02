/**
 * outer-facade-parity.mjs — does the Python port bucket the towers the same way
 * the browser does?
 *
 * WHAT IS BEING PROVED, precisely. `scripts/bake_outer_facades.py` is a
 * transcription of `clusterColours` and the tower loop in `js/facades.js`. A
 * transcription checked by re-reading it proves nothing — the same
 * misunderstanding writes both sides. So this runs the REAL browser function on
 * the REAL data and dumps what it decided, and the Python side is compared
 * against that.
 *
 * IT COMPARES THE PARTITION, NOT THE IDS, and that is not a dodge. The browser
 * names a bucket `tg<n>` where n is an offset into the campus palette, so the
 * two sides cannot agree on the string by construction — that offset is the
 * whole reason the port exists. What has to match is which towers land
 * together, and the centroid each group sits on.
 *
 * Note it calls `quantiseOuterFacades` on features it fetched itself rather
 * than on js/outer.js's copy. That is deliberate: it keeps the check
 * independent of whether the ring happens to be on tiles or on GeoJSON today,
 * and on the tile path js/outer.js never fetches the document at all.
 *
 * Writes scripts/verify/out/outer-facade-browser.json.
 * Compare with:  python scripts/verify/outer_facade_parity.py
 *
 * Usage: VERIFY_URL=http://127.0.0.1:8123 node scripts/verify/outer-facade-parity.mjs
 */
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';

const OUT_DIR = path.join('scripts', 'verify', 'out');
fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
page.on('pageerror', e => console.log('  [pageerror] ' + e.message));

await page.goto(BASE + '/index.html?intro=0&drift=0', { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
await page.evaluate(() => new Promise(r => {
  const m = window.__map;
  if (m.loaded()) return r();
  m.once('idle', r); setTimeout(r, 60000);
}));

const result = await page.evaluate(async () => {
  if (typeof window.quantiseOuterFacades !== 'function') {
    return { error: 'quantiseOuterFacades is not defined' };
  }
  const gj = await fetch('data/outer_ring.geojson').then(r => r.json());
  // The same predicate the browser pass uses.
  const towers = gj.features.filter(
    f => f.properties && f.properties.t === 1 && f.properties.wd);
  const n = window.quantiseOuterFacades(towers, window.__map);
  return {
    stamped: n,
    towers: towers.length,
    // File order is the join key: both sides read the same document and neither
    // reorders it. There is no id in the data to key on — checked.
    wp: towers.map(f => f.properties.wp || null),
    wd: towers.map(f => f.properties.wd),
  };
});

if (result.error) {
  console.log('*FAIL — ' + result.error);
  process.exitCode = 1;
} else {
  const groups = new Map();
  for (const id of result.wp) if (id) groups.set(id, (groups.get(id) || 0) + 1);
  console.log(`browser stamped ${result.stamped} of ${result.towers} towers`);
  console.log(`distinct buckets: ${groups.size}`);
  console.log('sizes: ' + [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => `${k}=${v}`).join('  '));
  const file = path.join(OUT_DIR, 'outer-facade-browser.json');
  fs.writeFileSync(file, JSON.stringify(result, null, 1));
  console.log('\nwrote ' + file);
  console.log('now run:  python scripts/verify/outer_facade_parity.py');
  if (result.wp.some(x => !x)) {
    console.log('*FAIL — some towers were left unstamped by the browser');
    process.exitCode = 1;
  }
}

await browser.__done();
