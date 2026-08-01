/**
 * payload.mjs — what does a VISITOR actually download before the city appears?
 *
 * WHY THIS EXISTS. Nothing in this repo has ever measured the thing that
 * governs a first-time visitor's experience. Every other script here measures
 * pixels or frame time, which is what matters once you are flying. Before that
 * there is a wait, and the wait is bytes over a wire.
 *
 * It also exists because the obvious way to answer "how big is the site" —
 * adding up the files in data/ — is WRONG in both directions. It counts files
 * the app never requests (six snapshot directories, only one of which loads),
 * it misses the basemap, the font glyphs and the library from unpkg, it reports
 * raw bytes when the wire carries gzip, and it cannot see a file fetched twice.
 * Ask the browser instead.
 *
 * WHAT IT REPORTS
 *   - every request the page makes up to `idle`, with transfer size and origin
 *   - the same list rolled up by host, so third-party weight is visible
 *   - DUPLICATE URLs, which is the one this was written to catch
 *   - the biggest single files, since that is where any fix starts
 *
 * READ THE `same URL fetched more than once` SECTION FIRST. A second fetch of
 * the same URL is usually served from the HTTP cache and costs ~0 bytes, so it
 * will not show up in a byte total — but if the response is then handed to
 * `setData()` it costs a full re-parse and a full re-tile of that source on the
 * main thread, which is load time you pay for and cannot see in a waterfall.
 *
 * Usage:  VERIFY_URL=http://127.0.0.1:8123 node scripts/verify/payload.mjs
 */
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';

const IDLE_TIMEOUT_MS = 120000;

const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const reqs = [];
page.on('response', async res => {
  const req = res.request();
  let bytes = 0;
  try {
    const h = await res.headerValue('content-length');
    if (h) bytes = Number(h);
  } catch (e) {}
  if (!bytes) {
    // No content-length (chunked/compressed streams often omit it). Fall back
    // to the decoded body, and flag it so the total is not read as gospel.
    try { bytes = (await res.body()).length; } catch (e) { bytes = 0; }
  }
  reqs.push({
    url: req.url(),
    type: req.resourceType(),
    status: res.status(),
    bytes,
    fromCache: res.fromServiceWorker(),
  });
});

const t0 = Date.now();
await page.goto(BASE + '/?intro=0&drift=0', { waitUntil: 'load', timeout: 90000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

// "Loaded" for this purpose means the map stopped asking for things, not that
// the load event fired — the scene data is all fetched after that.
await page.waitForFunction(
  () => window.__map && window.__map.isStyleLoaded() && window.__map.loaded(),
  null, { timeout: IDLE_TIMEOUT_MS },
).catch(() => console.log('WARN: map never reported loaded; numbers are a lower bound'));
await page.waitForTimeout(4000);
const elapsed = Date.now() - t0;

const mb = n => (n / 1048576).toFixed(2).padStart(7) + ' MB';
const short = u => u.replace(BASE + '/', '').replace(/^https?:\/\//, '');

// ── duplicates: the finding this script was written for ───────────────────
const byUrl = new Map();
for (const r of reqs) {
  const e = byUrl.get(r.url) || { n: 0, bytes: 0 };
  e.n++; e.bytes += r.bytes;
  byUrl.set(r.url, e);
}
const dupes = [...byUrl.entries()].filter(([, e]) => e.n > 1)
  .sort((a, b) => b[1].bytes - a[1].bytes);

console.log('\n=== same URL fetched more than once ===');
if (!dupes.length) console.log('  none');
for (const [url, e] of dupes) {
  console.log('  ' + String(e.n) + 'x  ' + mb(e.bytes) + '  ' + short(url));
}
console.log('  A repeat is usually a cache hit (~0 extra bytes) but still costs');
console.log('  a full parse, and a setData() repeat costs a full re-tile.');

// ── by host ───────────────────────────────────────────────────────────────
const byHost = new Map();
for (const r of reqs) {
  let h;
  try { h = new URL(r.url).host; } catch (e) { h = '?'; }
  const e = byHost.get(h) || { n: 0, bytes: 0 };
  e.n++; e.bytes += r.bytes;
  byHost.set(h, e);
}
console.log('\n=== by host ===');
for (const [h, e] of [...byHost.entries()].sort((a, b) => b[1].bytes - a[1].bytes)) {
  console.log('  ' + mb(e.bytes) + '  ' + String(e.n).padStart(4) + ' req  ' + h);
}

// ── biggest files ─────────────────────────────────────────────────────────
console.log('\n=== 15 biggest responses ===');
for (const r of [...reqs].sort((a, b) => b.bytes - a.bytes).slice(0, 15)) {
  console.log('  ' + mb(r.bytes) + '  ' + short(r.url).slice(0, 78));
}

const total = reqs.reduce((s, r) => s + r.bytes, 0);
console.log('\nTOTAL ' + mb(total) + '  across ' + reqs.length + ' responses'
            + '   (' + (elapsed / 1000).toFixed(1) + ' s to map idle)');

await browser.__done();
