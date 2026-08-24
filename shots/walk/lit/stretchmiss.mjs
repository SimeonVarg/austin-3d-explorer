/**
 * stretchmiss.mjs — sizing the one thing round 4 wrote down and did not answer.
 *
 * docs/walk-lit.md §28 ends: "The clause answers the route-level sentence. It
 * does not answer the stretch-level one: a *cool segment of the strip* 28 m
 * from a lamp still reads as cool, and 9-in-18 says a lamp is often visible
 * from there. Sizing that properly needs a per-stretch measurement over a real
 * sample, and the honest options then are a second strip colour for 'just
 * outside' or nothing at all."
 *
 * This is that measurement. It answers three questions in order, and the third
 * one is the only one that decides anything:
 *
 *   1. HOW MUCH cool strip is actually near a mapped lamp? Every 8 m step of
 *      every cool run over a seeded sample of real routes, nearest-warm-lamp
 *      distance computed in node against the SHIPPED data/walk_lamps.json —
 *      the very file the card counts from, not a re-derivation.
 *   2. WHAT WOULD IT COST TO DRAW? Splitting a cool run at the 50 m boundary
 *      turns one segment into several. A strip that becomes a barcode is a
 *      worse answer to "where" than a strip with two colours, so the extra
 *      segment count is a price, not a detail.
 *   3. DOES THE SCENE SEPARATE THE TWO POPULATIONS? That is stretchscene.mjs,
 *      which runs after this one and uses the sites this one writes out. A
 *      third colour that the night frame cannot tell from the second one is
 *      decoration, and this lane already measured one of those out
 *      (`litCanopyMult`, §21).
 *
 * There is no pass/fail here. It is a measurement and the numbers decide.
 *
 * Usage: VERIFY_URL=http://127.0.0.1:8814 node shots/walk/lit/stretchmiss.mjs [pairs]
 */
import fs from 'node:fs';
import { chromium } from '../../../scripts/verify/node_modules/playwright-core/index.mjs';
import { BASE, launch } from '../../../scripts/verify/chrome.mjs';

const OUT = 'shots/walk/lit';
const WANT = Number(process.argv[2] || 60);
const RADIUS = 25;        // WAYFIND.litRadiusM — a cool step is beyond this by construction
const NEAR = 50;          // WAYFIND.litNearMissM — the ring the card already names at route level
const FAR_FOR_SITES = 120; // for the scene test: a cool step this far from any lamp is the control
// STRATIFIED, AND PER-ROUTE CAPPED, BECAUSE THE FIRST CUT WAS NEITHER. It
// stashed every qualifying step until a flat 400-site cap filled, so both pools
// came off the first handful of routes walked — the FAR pool ended up 5 sites
// from one pair. That is the same defect round 4's boundary.mjs has (§28: six
// routes, eighteen sites, two of them 24 m apart), and it is how a sample stops
// describing the city and starts describing one street. Two caps now: at most
// SITES_PER_ROUTE from any one route, and at most SITES_PER_BUCKET in each
// distance band, so the scene test can ask whether the surprise falls off with
// distance instead of averaging over a band eight metres of mast wide.
const BUCKETS = [[25, 30], [30, 35], [35, 40], [40, 50]];
const SITES_PER_ROUTE = 3;
const SITES_PER_BUCKET = 60;

// ── the shipped index, decoded in node ────────────────────────────────────
const J = JSON.parse(fs.readFileSync('data/walk_lamps.json', 'utf8'));
const q = J.q || 1e-6;
const dec = (o) => {
  const xs = (o && o.x) || [], ys = (o && o.y) || [];
  const X = [], Y = []; let ax = 0, ay = 0;
  for (let i = 0; i < xs.length; i++) { ax += xs[i]; ay += ys[i]; X.push(ax * q); Y.push(ay * q); }
  return { X, Y, n: X.length };
};
const WARM = dec(J.warm);
const MPD_LAT = 111320, MPD_LON = 111320 * Math.cos(30.285 * Math.PI / 180);
const nearestWarm = (lon, lat) => {
  let best = Infinity;
  for (let i = 0; i < WARM.n; i++) {
    const dx = (WARM.X[i] - lon) * MPD_LON, dy = (WARM.Y[i] - lat) * MPD_LAT;
    const d = dx * dx + dy * dy;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
};
const metres = (a, b) => Math.hypot((b[0] - a[0]) * MPD_LON, (b[1] - a[1]) * MPD_LAT);
console.log(`index: ${WARM.n} warm street lamps · counting radius ${RADIUS} m · near ring ${NEAR} m`);

const CODES = Object.keys(JSON.parse(fs.readFileSync('data/walk_graph.json', 'utf8')).code);
let seed = 90210;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

const browser = await launch(chromium, { maxMs: 900000 });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto(BASE + '/_harness.html?intro=0&drift=0&walk=1', { waitUntil: 'networkidle', timeout: 180000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
await page.evaluate(() => { if (window.cancelGraphicsAutoDetect) window.cancelGraphicsAutoDetect(); });
await page.waitForFunction(() => !document.getElementById('veil'), null, { timeout: 120000 });

// ── walk a real sample ────────────────────────────────────────────────────
const routes = [];
const tried = new Set();
for (let attempt = 0; attempt < WANT * 8 && routes.length < WANT; attempt++) {
  const a = CODES[Math.floor(rnd() * CODES.length)], b = CODES[Math.floor(rnd() * CODES.length)];
  if (a === b || tried.has(a + '>' + b)) continue;
  tried.add(a + '>' + b);
  const r = await page.evaluate(async ([f, t]) => {
    const res = await window.wayfindRoute(f, t, {});
    if (!res.ok) return null;
    const lit = await window.wayfindLit();
    return lit.ok ? { runsAt: lit.runsAt, totalM: lit.totalM, lamps: lit.lamps, darkM: lit.darkM } : null;
  }, [a, b]);
  if (r) routes.push({ from: a, to: b, ...r });
}
console.log(`routed: ${routes.length} pairs (of ${tried.size} tried)\n`);

// ── question 1: how much cool strip is near a mapped lamp ─────────────────
let darkM = 0, nearM = 0, farM = 0;
const perRoute = [];
const bandSites = [], farSites = [], litSites = [];
const bucketCount = BUCKETS.map(() => 0);
const distHist = [];
for (const R of routes) {
  const key = R.from + '>' + R.to;
  // THE OTHER COLUMN. A matrix needs the places this feature is CONFIDENT as
  // well as the places it is unsure — round 3 §18 wrote that down and round 5's
  // first pass sampled only cool stretches, which is a list of the places we
  // already doubted. `lit` sites are stashed off the same walk, from the middle
  // of each lit run so the camera is not standing on a classification boundary.
  for (const run of R.runsAt) {
    if (!run.lit || litSites.length >= 400) continue;
    if (litSites.filter(s => s.key === key).length >= SITES_PER_ROUTE) break;
    const mid = run.line[Math.floor(run.line.length / 2)];
    if (!mid) continue;
    litSites.push({ from: R.from, to: R.to, key, ll: mid, d: +nearestWarm(mid[0], mid[1]).toFixed(1), bucket: -2 });
  }
  let takenBand = 0, takenFar = 0;
  let dM = 0, nM = 0;
  let extraSegs = 0;
  for (const run of R.runsAt) {
    if (run.lit) continue;
    // split the run into "near a lamp" / "not" the way the strip would have to
    let last = null, flips = 0;
    for (let i = 0; i < run.line.length - 1; i++) {
      const a = run.line[i], b = run.line[i + 1];
      const m = metres(a, b);
      if (m < 1e-6) continue;
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const d = nearestWarm(mid[0], mid[1]);
      distHist.push(d);
      const isNear = d < NEAR;
      dM += m;
      if (isNear) nM += m;
      if (last !== null && isNear !== last) flips++;
      last = isNear;
      // stash sites for the scene test: the band, bucketed, and a far control
      if (isNear && d >= RADIUS && takenBand < SITES_PER_ROUTE) {
        const bi = BUCKETS.findIndex(([lo, hi]) => d >= lo && d < hi);
        if (bi >= 0 && bucketCount[bi] < SITES_PER_BUCKET) {
          bucketCount[bi]++; takenBand++;
          bandSites.push({ from: R.from, to: R.to, key, ll: mid, d: +d.toFixed(1), bucket: bi });
        }
      } else if (d >= FAR_FOR_SITES && takenFar < SITES_PER_ROUTE) {
        takenFar++;
        farSites.push({ from: R.from, to: R.to, key, ll: mid, d: +d.toFixed(1), bucket: -1 });
      }
    }
    extraSegs += flips;      // one flip = one extra strip segment
  }
  darkM += dM; nearM += nM; farM += (dM - nM);
  perRoute.push({
    from: R.from, to: R.to, totalM: R.totalM, lamps: R.lamps,
    darkM: Math.round(dM), nearM: Math.round(nM),
    nearFrac: dM > 0 ? nM / dM : 0,
    stripFracOfWalk: R.totalM > 0 ? nM / R.totalM : 0,
    extraSegs, runs: R.runsAt.length,
  });
}

const pct = (a, b) => b > 0 ? (100 * a / b).toFixed(1) + '%' : '—';
const quant = (arr, p) => { const s = arr.slice().sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };

console.log('# 1. how much of the COOL strip is within the near ring');
console.log(`  cool metres over the sample                 ${Math.round(darkM)} m`);
console.log(`  ...within ${NEAR} m of a mapped lamp          ${Math.round(nearM)} m   ${pct(nearM, darkM)}`);
console.log(`  ...and beyond it                            ${Math.round(farM)} m   ${pct(farM, darkM)}`);
console.log(`  nearest-lamp distance at a cool step: p10 ${quant(distHist, .1).toFixed(0)} · median ` +
  `${quant(distHist, .5).toFixed(0)} · p90 ${quant(distHist, .9).toFixed(0)} m`);
const withAny = perRoute.filter(r => r.nearFrac > 0);
const bigShare = perRoute.filter(r => r.nearFrac >= 0.15);
console.log(`  routes with ANY near-ring cool metres        ${withAny.length} / ${perRoute.length}`);
console.log(`  routes where it is >=15% of their cool       ${bigShare.length} / ${perRoute.length}`);
const nf = perRoute.map(r => r.nearFrac);
console.log(`  per-route near share of cool: p25 ${(100 * quant(nf, .25)).toFixed(0)}% · median ` +
  `${(100 * quant(nf, .5)).toFixed(0)}% · p75 ${(100 * quant(nf, .75)).toFixed(0)}% · max ${(100 * Math.max(...nf)).toFixed(0)}%`);

console.log('\n# 2. what a third colour would cost the picture');
const es = perRoute.map(r => r.extraSegs);
console.log(`  extra strip segments per route: median ${quant(es, .5)} · p75 ${quant(es, .75)} · max ${Math.max(...es)}`);
console.log(`  segments today: median ${quant(perRoute.map(r => r.runs), .5)} · max ${Math.max(...perRoute.map(r => r.runs))}`);
const wouldDouble = perRoute.filter(r => r.extraSegs >= r.runs).length;
console.log(`  routes where it would AT LEAST DOUBLE the segment count  ${wouldDouble} / ${perRoute.length}`);
const sw = perRoute.map(r => r.stripFracOfWalk);
console.log(`  share of the WHOLE strip that changes colour: median ${(100 * quant(sw, .5)).toFixed(1)}% · max ${(100 * Math.max(...sw)).toFixed(1)}%`);

// the routes worth photographing: most near-ring cool, and one with none
perRoute.sort((a, b) => b.nearFrac - a.nearFrac);
console.log('\n  top routes by near-ring share of their cool strip:');
for (const r of perRoute.slice(0, 6)) {
  console.log(`    ${r.from}->${r.to}  cool ${r.darkM} m, ${r.nearM} m of it inside ${NEAR} m ` +
    `(${(100 * r.nearFrac).toFixed(0)}%), +${r.extraSegs} segments on ${r.runs}`);
}

console.log('\n# 3. the sample handed to the scene test');
BUCKETS.forEach(([lo, hi], i) => console.log(`  ${lo}-${hi} m: ${bucketCount[i]} sites`));
console.log(`  control (>${FAR_FOR_SITES} m): ${farSites.length} sites`);
console.log(`  the OTHER column, stretches the card calls lit: ${litSites.length} sites`);
console.log(`  distinct routes contributing: band ${new Set(bandSites.map(s => s.key)).size}, ` +
  `control ${new Set(farSites.map(s => s.key)).size}, lit ${new Set(litSites.map(s => s.key)).size}`);

fs.writeFileSync(`${OUT}/stretchmiss.json`, JSON.stringify({
  radiusM: RADIUS, nearM: NEAR, farM: FAR_FOR_SITES, pairs: routes.length,
  buckets: BUCKETS, bucketCount,
  totals: { darkM: Math.round(darkM), nearM: Math.round(nearM), farM: Math.round(farM) },
  perRoute, bandSites, farSites, litSites, errs,
}, null, 1));
console.log(`\nwrote ${OUT}/stretchmiss.json  (${bandSites.length} band sites, ${farSites.length} far sites for the scene test)`);
console.log('errors:', errs.length ? errs.slice(0, 3) : 'none');
await browser.close();
