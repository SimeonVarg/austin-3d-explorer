/**
 * gaps-recheck.mjs — which UT building codes can a schedule NOT be routed to?
 *
 * Asks the running app rather than trusting a written-down list, because the
 * list this lane was handed was wrong twice in opposite directions and only
 * running it found either error (docs/si-parser.md):
 *
 *   - it named SSW as "not in UT's own building register at all", when SSW is
 *     0.88 km from MAI with two surveyed doors in UT_CELEBRATED — its absence
 *     is from THIS repo's data/ut_buildings.json;
 *   - it missed HLB, which reports `routable: false` from the search index and
 *     then routes perfectly well at 1,339 m off a virtual door.
 *
 * So the check is in two halves on purpose. `wayfindSearch` answers "is it in
 * the index"; only `wayfindRoute` answers "can you walk there", and the two
 * disagree for at least one building.
 *
 *   python scripts/serve.py 8911
 *   VERIFY_URL=http://127.0.0.1:8911 node scripts/verify/schedule-fixtures/gaps-recheck.mjs
 */
import { chromium } from 'playwright-core';
import { launch, BASE } from '../chrome.mjs';

const URL = `${BASE}/index.html?walk=1&drift=0&intro=0`;
const browser = await launch(chromium, { maxMs: 300000 });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', e => console.error('PAGEERROR', e.message));
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
await page.waitForFunction(() => !document.getElementById('veil'), null, { timeout: 120000 });
await page.waitForFunction(() => typeof window.wayfindRoute === 'function', null, { timeout: 60000 });

const out = await page.evaluate(async () => {
  await window.wayfindRoute('WEL', 'MAI');            // force the graph to load
  const oracle = window.wayfindUTDoors();
  const rows = [];
  for (const c of oracle.codes) {
    const top = (window.wayfindSearch(c) || [])[0] || null;
    rows.push({
      code: c,
      indexed: !!(top && top.code === c),
      flaggedRoutable: !!(top && top.code === c && top.routable),
      name: top ? top.name : '',
    });
  }
  return { oracle: { doors: oracle.doors, buildings: oracle.buildings }, rows };
});

const suspect = out.rows.filter(r => !r.flaggedRoutable);
console.log(`UT survey: ${out.oracle.doors} doors on ${out.oracle.buildings} buildings`);
console.log(`the index flags ${suspect.length} of them unroutable — now actually try each:\n`);

const tried = await page.evaluate(async (codes) => {
  const o = [];
  for (const c of codes) {
    let r;
    try { r = await window.wayfindRoute('PCL', c); } catch (e) { r = { ok: false, why: 'threw' }; }
    const doors = window.wayfindUTDoors(c);
    o.push({
      code: c, ok: !!r.ok, why: r.why || null,
      distM: r.distM != null ? Math.round(r.distM) : null,
      lat: doors[0] ? doors[0].lat : null, lon: doors[0] ? doors[0].lon : null,
    });
  }
  return o;
}, suspect.map(r => r.code));

// MAI's own celebrated door is the campus origin; metres per degree at lat 30.285.
const [CLON, CLAT, MPD_LON, MPD_LAT] = [-97.739719, 30.286186, 96061, 111195];
const kmOut = (lon, lat) => (lon == null ? null :
  Math.round(Math.hypot((lon - CLON) * MPD_LON, (lat - CLAT) * MPD_LAT) / 100) / 10);

const offMap = [], onCampus = [], liars = [];
for (const r of tried) {
  const km = kmOut(r.lon, r.lat);
  const line = `  ${r.code}  ${String(km).padStart(5)} km from MAI  ` +
    (r.ok ? `ROUTES (${r.distM} m)` : `no route (${r.why})`);
  if (r.ok) liars.push(line);
  else if (km != null && km > 3) offMap.push(line);
  else onCampus.push(line);
}
console.log('OFF THIS MAP (Pickle Research Campus) — correctly unroutable:');
console.log(offMap.join('\n') || '  (none)');
console.log('\nON THE MAIN CAMPUS and still unroutable — these are real gaps:');
console.log(onCampus.join('\n') || '  (none)');
console.log('\nFLAGGED UNROUTABLE BY THE INDEX AND ROUTES ANYWAY — do not trust `routable`:');
console.log(liars.join('\n') || '  (none)');

await browser.__done();
