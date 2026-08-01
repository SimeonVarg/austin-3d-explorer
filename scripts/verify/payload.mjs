/**
 * payload.mjs — what does a VISITOR actually pay to get the city on screen?
 *
 * WHY THIS EXISTS. Nothing in this repo had ever measured the thing that governs
 * a first-time visitor's experience. Every other script here measures pixels or
 * frame time, which is what matters once you are flying. Before that there is a
 * wait, and the wait is bytes over a wire plus work on the main thread.
 *
 * IT ALSO EXISTS BECAUSE THE TWO OBVIOUS WAYS TO MEASURE IT ARE BOTH WRONG.
 *
 * Adding up the files in data/ counts six snapshot directories when one loads,
 * misses the basemap, the glyphs and the library from unpkg, reports raw bytes
 * when the wire carries gzip, and cannot see a file fetched twice.
 *
 * Counting Playwright `response` events and their content-length is worse,
 * because it looks right. THIS SCRIPT'S FIRST VERSION DID THAT AND PRODUCED A
 * WRONG HEADLINE. It reported that removing a duplicate fetch saved 9.94 MB of
 * a 39.73 MB load. It did not. A `response` event fires for cache hits too and
 * carries the cached response's content-length — so a file served from memory
 * for free is counted at its full size. GitHub Pages sends
 * `Cache-Control: max-age=600` on this repo's assets (verified 2026-08-01), so
 * on the real site a second request seconds later never touches the network.
 * The bytes were never being sent twice; only the report said so.
 *
 * So this asks CDP instead. `Network.loadingFinished.encodedDataLength` is bytes
 * actually received — compressed, including headers — and it is 0 for a cache
 * hit. `Network.responseReceived.response.fromDiskCache` and
 * `Network.requestServedFromCache` name them outright. Those are ground truth;
 * content-length is not.
 *
 * THE DUPLICATE SECTION IS STILL THE POINT — just not for the reason it looked
 * like. A repeated URL is nearly free on the wire and expensive everywhere else:
 * a second full JSON parse of the file, and, if the result is handed to
 * `setData()`, a complete re-tile of that source in the worker while the user is
 * staring at a loading screen. That cost is invisible in a network waterfall,
 * which is exactly why it survived so long. Count duplicates; do not price them
 * in bytes.
 *
 * Usage:  VERIFY_URL=http://127.0.0.1:8123 node scripts/verify/payload.mjs
 */
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';

const IDLE_TIMEOUT_MS = 120000;

const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

// TWO COLLECTORS, because neither alone is right.
//
// CDP `Network.*` gives true wire bytes and names cache hits, but a session
// opened on the page target only sees the PAGE's traffic. MapLibre fetches every
// GeoJSON source inside a worker, which is most of the payload — a CDP-only
// version of this script reported 7.22 MB for a load that moves closer to 26 MB,
// and the missing 19 MB was every scene file in the app.
//
// Playwright's page-level `response` event does see worker traffic. So: CDP is
// the authority on bytes and cache status where it has an opinion, and the
// response event supplies everything CDP never saw, priced with
// `request.sizes().responseBodySize`. Rows filled in from the second collector
// are marked `~` in the output, because that number is a body size rather than
// an encoded transfer size and should not be read to two decimal places.
const cdp = await page.context().newCDPSession(page);
await cdp.send('Network.enable');

const byId = new Map();
cdp.on('Network.requestWillBeSent', e => {
  byId.set(e.requestId, { url: e.request.url, wire: 0, cached: false, status: 0 });
});
cdp.on('Network.responseReceived', e => {
  const r = byId.get(e.requestId);
  if (!r) return;
  r.status = e.response.status;
  if (e.response.fromDiskCache || e.response.fromPrefetchCache) r.cached = true;
});
cdp.on('Network.requestServedFromCache', e => {
  const r = byId.get(e.requestId);
  if (r) { r.cached = true; if (!r.status) r.status = 200; }
});
cdp.on('Network.loadingFinished', e => {
  const r = byId.get(e.requestId);
  if (r) r.wire = e.encodedDataLength || 0;
});

const seen = [];
page.on('response', async res => {
  let bytes = 0;
  try { bytes = (await res.request().sizes()).responseBodySize || 0; } catch (e) {}
  seen.push({ url: res.url(), status: res.status(), bytes });
});

const t0 = Date.now();
await page.goto(BASE + '/?intro=0&drift=0', { waitUntil: 'load', timeout: 90000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

// "Loaded" here means the map stopped asking for things, not that the load event
// fired — every scene file is fetched after that.
await page.waitForFunction(
  () => window.__map && window.__map.isStyleLoaded() && window.__map.loaded(),
  null, { timeout: IDLE_TIMEOUT_MS },
).catch(() => console.log('WARN: map never reported loaded; numbers are a lower bound'));
const idleMs = Date.now() - t0;
await page.waitForTimeout(3000);

// Union the two collectors. CDP rows win; response-event rows fill the gaps,
// matched by URL and occurrence count so a URL fetched twice contributes twice.
const reqs = [...byId.values()].filter(r => r.status);
const cdpSeen = new Map();
for (const r of reqs) cdpSeen.set(r.url, (cdpSeen.get(r.url) || 0) + 1);
let workerReqs = 0;
for (const s of seen) {
  const left = cdpSeen.get(s.url) || 0;
  if (left > 0) { cdpSeen.set(s.url, left - 1); continue; }
  reqs.push({ url: s.url, status: s.status, wire: s.bytes, cached: false, est: true });
  workerReqs++;
}
const mb = n => (n / 1048576).toFixed(2).padStart(7) + ' MB';
const short = u => u.replace(BASE + '/', '').replace(/^https?:\/\//, '');

// ── duplicates ────────────────────────────────────────────────────────────
const byUrl = new Map();
for (const r of reqs) {
  const e = byUrl.get(r.url) || { n: 0, wire: 0, cachedHits: 0 };
  e.n++; e.wire += r.wire; if (r.cached) e.cachedHits++;
  byUrl.set(r.url, e);
}
const dupes = [...byUrl.entries()].filter(([, e]) => e.n > 1)
  .sort((a, b) => b[1].wire - a[1].wire);

console.log('\n=== same URL requested more than once ===');
if (!dupes.length) console.log('  none');
for (const [url, e] of dupes) {
  console.log('  ' + e.n + 'x  wire ' + mb(e.wire) + '  ' + e.cachedHits
              + ' from cache   ' + short(url));
}
console.log('  A cached repeat costs ~0 bytes. It still costs a full JSON parse,');
console.log('  and via setData() a full re-tile of that source. Neither appears in');
console.log('  a waterfall. That is the cost worth removing, not the bytes.');

// ── by host ───────────────────────────────────────────────────────────────
const byHost = new Map();
for (const r of reqs) {
  let h; try { h = new URL(r.url).host; } catch (e) { h = '?'; }
  const e = byHost.get(h) || { n: 0, wire: 0 };
  e.n++; e.wire += r.wire;
  byHost.set(h, e);
}
console.log('\n=== wire bytes by host ===');
for (const [h, e] of [...byHost.entries()].sort((a, b) => b[1].wire - a[1].wire)) {
  console.log('  ' + mb(e.wire) + '  ' + String(e.n).padStart(4) + ' req  ' + h);
}

console.log('\n=== 12 biggest ===');
for (const r of [...reqs].sort((a, b) => b.wire - a.wire).slice(0, 12)) {
  console.log('  ' + mb(r.wire) + (r.cached ? ' [cache]' : r.est ? ' ~worker' : '        ')
              + '  ' + short(r.url).slice(0, 70));
}

const wire = reqs.reduce((s, r) => s + r.wire, 0);
const cachedN = reqs.filter(r => r.cached).length;
console.log('\nTOTAL ' + mb(wire) + '  across ' + reqs.length + ' requests ('
            + cachedN + ' from cache, ' + workerReqs + ' worker-side, ~estimated)');
console.log('IDLE  ' + (idleMs / 1000).toFixed(1) + ' s to map.loaded()');
console.log('\nREAD THIS BEFORE QUOTING A NUMBER:');
console.log('  - worker rows are body sizes, not encoded transfer sizes');
console.log('  - a duplicate URL is a COUNT, not bytes saved: whether the repeat');
console.log('    costs wire depends on cache headers AND on whether the two');
console.log('    requests overlap in flight (an in-flight repeat is never cached)');
console.log('  - this server\'s cache policy may not match GitHub Pages\'');
console.log('    (max-age=600); compare like with like before claiming a delta');

await browser.__done();
