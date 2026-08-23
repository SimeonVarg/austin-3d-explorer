/**
 * strip-truth.mjs — does the picture claim more light than the count does?
 *
 * The card's lighting strip is a SCHEMATIC: `litStripMinFrac` floors the width
 * of a short run so a single lamp on a 2 km walk is a visible mark rather than
 * a rounding error. Every floor is a lie by a small amount, and on a route made
 * of many tiny runs the floors compound. If they compound upward — if amber
 * ends up a larger share of the bar than lamp-covered metres are of the walk —
 * then the prettiest thing in this block is also the only part of it that
 * overstates the light, which is the one direction this feature has spent
 * three rounds refusing to be wrong in.
 *
 * So: drive N seeded real routes, read the amber share the browser actually
 * laid out (getBoundingClientRect on the segments, not the CSS we asked for),
 * and compare it to `scan.pct` — lamp-covered metres over walked metres, the
 * number the sentence above the strip is derived from.
 *
 * The gate is one-sided on purpose. A strip that under-shows light is a
 * cautious picture; a strip that over-shows it is a false claim.
 *
 * Usage: VERIFY_URL=http://127.0.0.1:8714 node shots/walk/lit/strip-truth.mjs [n]
 */
import fs from 'node:fs';
import { chromium } from '../../../scripts/verify/node_modules/playwright-core/index.mjs';
import { BASE, launch } from '../../../scripts/verify/chrome.mjs';

const N = Number(process.argv[2] || 40);
const OUT = 'shots/walk/lit';
// Over-claiming at all is the failure; this is the tolerance on the LAYOUT
// arithmetic (sub-pixel flex rounding on a ~520 px bar), not a licence to
// overstate. 0.15 % of 520 px is under a pixel.
//
// The first cut of this compared against `lit.pct`, which the test surface
// rounds to a whole percent — so the tolerance and the instrument's own noise
// floor were the same size and the test could not have failed by less than it
// could not see. The truth is taken from `litM/totalM` instead: metres rounded
// to 1 m in ~1,500 is noise of 0.07 %, which leaves the gate something to catch.
const OVERCLAIM_TOL = 0.0015;

const browser = await launch(chromium, { gl: 'hardware' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errs = [];
page.on('pageerror', e => errs.push(e.message));

await page.goto(BASE + '/_harness.html?intro=0&drift=0&walk=1', { waitUntil: 'networkidle', timeout: 180000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
await page.evaluate(() => { if (window.cancelGraphicsAutoDetect) window.cancelGraphicsAutoDetect(); });
await page.waitForFunction(() => !document.getElementById('veil'), null, { timeout: 120000 });
await page.evaluate(() => {
  const el = document.getElementById('tod-slider');
  if (el) { el.value = '0.92'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
  if (typeof window.applyTimeOfDay === 'function') window.applyTimeOfDay(window.__map, 0.92, true);
});
await page.waitForTimeout(1200);

// Pairs from the graph's own building codes, seeded so the run is repeatable.
// Read out of the shipped data file rather than off a window global, because
// the router does not expose the graph and a test that invents its own list of
// buildings is testing its own list of buildings.
const CODES = Object.keys(JSON.parse(fs.readFileSync('data/walk_graph.json', 'utf8')).code);
const pairs = (() => {
  let s = 20260823;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const out = [];
  for (let i = 0; i < N * 4 && out.length < N; i++) {
    const a = CODES[Math.floor(rnd() * CODES.length)];
    const b = CODES[Math.floor(rnd() * CODES.length)];
    if (a && b && a !== b) out.push([a, b]);
  }
  return out;
})();

if (!pairs.length) { console.log('no codes available'); await browser.close(); process.exit(1); }

const rows = [];
for (const [a, b] of pairs) {
  const r = await page.evaluate(async ([f, t]) => {
    const res = await window.wayfindRoute(f, t, { expand: true });
    if (!res.ok) return null;
    const lit = await window.wayfindLit();
    if (!lit.ok) return null;
    const track = document.querySelector('#wf-card [role="img"]');
    if (!track) return null;
    const segs = Array.from(track.children).filter(c => c.style.position !== 'absolute');
    const tw = track.getBoundingClientRect().width;
    let amber = 0;
    // The colour is read back off the laid-out element rather than assumed from
    // the loop that built it: this asserts what the browser painted.
    const want = getComputedStyle(document.documentElement) && window.WAYFIND.litStripLitCol.toLowerCase();
    const hex = (rgb) => {
      const m = /rgb\((\d+), (\d+), (\d+)\)/.exec(rgb);
      return m ? '#' + [1, 2, 3].map(i => (+m[i]).toString(16).padStart(2, '0')).join('') : rgb;
    };
    for (const s of segs) if (hex(getComputedStyle(s).backgroundColor) === want) amber += s.getBoundingClientRect().width;
    return {
      from: f, to: t, distM: Math.round(res.distM), runs: lit.runs,
      pct: lit.totalM > 0 ? lit.litM / lit.totalM : 0, pctShown: lit.pct,
      strip: tw > 0 ? amber / tw : 0, trackW: Math.round(tw),
      lamps: lit.lamps, ticks: (lit.reportedAtM || []).length, reported: lit.reported,
    };
  }, [a, b]);
  if (r) rows.push(r);
}

const errsOver = rows.filter(r => r.strip - r.pct > OVERCLAIM_TOL);
const d = rows.map(r => r.strip - r.pct).sort((x, y) => x - y);
const q = (p) => d.length ? d[Math.min(d.length - 1, Math.floor(p * d.length))] : 0;
const pctf = (x) => (100 * x).toFixed(2) + '%';

console.log(`routes measured: ${rows.length} of ${pairs.length} pairs`);
console.log(`strip amber share MINUS true lamp-covered share:`);
console.log(`  min ${pctf(q(0))}   p25 ${pctf(q(.25))}   median ${pctf(q(.5))}   p75 ${pctf(q(.75))}   max ${pctf(q(.999))}`);
console.log(`routes where the picture shows MORE light than the count: ${errsOver.length}`);
for (const r of errsOver.slice(0, 8)) {
  console.log(`  *OVER  ${r.from}->${r.to}  ${r.distM} m, ${r.runs} runs: strip ${pctf(r.strip)} vs true ${pctf(r.pct)}`);
}
// The worst case for a floor is a route made of many short runs.
const busiest = rows.slice().sort((x, y) => y.runs - x.runs).slice(0, 5);
console.log('most-fragmented routes (where the floor bites hardest):');
for (const r of busiest) {
  console.log(`  ${r.from}->${r.to}  ${r.runs} runs over ${r.distM} m: strip ${pctf(r.strip)} vs true ${pctf(r.pct)}  (${pctf(r.strip - r.pct)})`);
}
const ticked = rows.filter(r => r.ticks);
console.log(`routes with reported-dark ticks: ${ticked.length}; ticks always match the count: ` +
  (ticked.every(r => r.ticks === r.reported) ? 'yes' : '*NO*'));

fs.writeFileSync(`${OUT}/strip-truth.json`, JSON.stringify({ tol: OVERCLAIM_TOL, rows }, null, 1));
console.log('errors:', errs.length ? errs.slice(0, 3) : 'none');
await browser.close();
console.log(errsOver.length ? '\nFAIL — the strip overstates light' : '\nPASS — the strip never shows more light than the count');
process.exit(errsOver.length ? 1 : 0);
