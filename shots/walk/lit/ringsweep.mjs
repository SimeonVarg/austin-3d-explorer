/**
 * ringsweep.mjs — pricing the near-miss ring at the width the SCENE says it is.
 *
 * Round 4 shipped `litNearMissM: 50` and said so plainly in §31: "twice the
 * counting radius and inside round 3's 60 m, which is a reason, not a
 * measurement." Round 5 measured it. `stretchscene.mjs`, 24 sites in four
 * distance buckets, deduplicated by coordinate and spread over 35 routes, flown
 * to at night and read off masked pixels:
 *
 *   25-30 m from a mapped lamp   a lamp is on screen at  5 / 6
 *   30-35 m                                              4 / 6
 *   35-40 m                                              3 / 6
 *   40-50 m                                              0 / 6
 *   >120 m (control)                                     0 / 12
 *
 * So the outer half of the shipped ring contains lamps nobody standing there
 * can see. The clause exists to stop "No mapped streetlight along this route"
 * being called wrong by a person who walks out and looks at one — a lamp that
 * cannot be seen from the pavement is not that person's objection, and counting
 * it makes the sentence longer and less true at the same time.
 *
 * This script prices the change before it is made: over the same 60 seeded
 * routes, how often does the clause fire and what number does it say, at each
 * candidate ring?
 *
 * ONE THING TO KNOW BEFORE COPYING THIS. `LAMPS.gWarmWide` is built ONCE in
 * loadLamps at the shipped `litNearMissM`, and `lampsNear` visits only the 3x3
 * block around a point — exact while the cell is at least the query radius. So
 * flipping the constant DOWN at runtime is exact and flipping it UP is not.
 * This sweep only goes down, and the shipped value is measured first so the
 * page's own answer is the anchor.
 *
 * Usage: VERIFY_URL=http://127.0.0.1:8814 node shots/walk/lit/ringsweep.mjs [n]
 */
import fs from 'node:fs';
import { chromium } from '../../../scripts/verify/node_modules/playwright-core/index.mjs';
import { BASE, launch } from '../../../scripts/verify/chrome.mjs';

const OUT = 'shots/walk/lit';
const N = Number(process.argv[2] || 60);
const RINGS = [50, 45, 40, 35, 30];   // shipped first, then downward only

const CODES = Object.keys(JSON.parse(fs.readFileSync('data/walk_graph.json', 'utf8')).code);
let s = 20260824;                      // the same seed nearmiss.mjs used
const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pairs = [];
for (let i = 0; i < N * 4 && pairs.length < N; i++) {
  const a = CODES[Math.floor(rnd() * CODES.length)], b = CODES[Math.floor(rnd() * CODES.length)];
  if (a !== b) pairs.push([a, b]);
}

const browser = await launch(chromium, { maxMs: 1200000 });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto(BASE + '/_harness.html?intro=0&drift=0&walk=1', { waitUntil: 'networkidle', timeout: 180000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
await page.evaluate(() => { if (window.cancelGraphicsAutoDetect) window.cancelGraphicsAutoDetect(); });
await page.waitForFunction(() => !document.getElementById('veil'), null, { timeout: 120000 });

const shipped = await page.evaluate(() => window.WAYFIND.litNearMissM);
console.log(`shipped ring: ${shipped} m · ${pairs.length} seeded routes\n`);
if (Math.max(...RINGS) > shipped) {
  console.log('*REFUSING: this sweep may only go DOWN from the shipped ring (grid cell size).');
  process.exit(1);
}

const byRing = {};
for (const ring of RINGS) {
  // A hook that quietly is not there looks exactly like a clean null result —
  // round 3 lost a whole A/B to that. Check the return value, every pass.
  const hooked = await page.evaluate((r) => {
    window.WAYFIND.litNearMissM = r;
    return typeof window.wayfindLitReprice === 'function' && window.wayfindLitReprice() === true;
  }, ring);
  if (!hooked) { console.log('*FAIL: no reprice hook — the sweep would be measuring the first pass'); break; }
  const rows = [];
  for (const [a, b] of pairs) {
    const r = await page.evaluate(async ([f, t]) => {
      const res = await window.wayfindRoute(f, t, {});
      if (!res.ok) return null;
      const lit = await window.wayfindLit();
      return lit.ok ? { f, t, lamps: lit.lamps, nearMiss: lit.nearMiss, ring: lit.nearMissM } : null;
    }, [a, b]);
    if (r) rows.push(r);
  }
  const usedRing = rows.length ? rows[0].ring : null;
  if (usedRing !== ring) console.log(`  *the page reports ring ${usedRing}, asked for ${ring}`);
  const zero = rows.filter(r => r.lamps === 0);
  const fires = zero.filter(r => r.nearMiss > 0);
  const counts = fires.map(r => r.nearMiss).sort((x, y) => x - y);
  byRing[ring] = { routes: rows.length, zeroLamp: zero.length, fires: fires.length, counts, rows };
  console.log(`ring ${String(ring).padStart(2)} m   zero-lamp routes ${String(zero.length).padStart(2)}/${rows.length}` +
    `   the clause fires on ${String(fires.length).padStart(2)} of them` +
    `   count says: median ${counts.length ? counts[Math.floor(counts.length / 2)] : '-'}, max ${counts.length ? counts[counts.length - 1] : '-'}`);
}

// restore, so nothing after this measures a mutated page
await page.evaluate((r) => { window.WAYFIND.litNearMissM = r; window.wayfindLitReprice(); }, shipped);

// Which routes CHANGE between the shipped ring and the measured one — named,
// because "3 routes lose the clause" is a number and "these three" is checkable.
const A = byRing[50], B = byRing[40];
if (A && B) {
  const key = r => r.f + '->' + r.t;
  const mA = new Map(A.rows.map(r => [key(r), r])), mB = new Map(B.rows.map(r => [key(r), r]));
  const changed = [];
  for (const [k, ra] of mA) {
    const rb = mB.get(k);
    if (rb && ra.lamps === 0 && (ra.nearMiss > 0) !== (rb.nearMiss > 0)) changed.push([k, ra.nearMiss, rb.nearMiss]);
  }
  console.log(`\nzero-lamp routes whose clause changes between 50 m and 40 m: ${changed.length}`);
  for (const c of changed) console.log(`  ${c[0]}   50 m says ${c[1]}, 40 m says ${c[2]}`);
}

fs.writeFileSync(`${OUT}/ringsweep.json`, JSON.stringify({ shipped, rings: RINGS, pairs: pairs.length, byRing, errs }, null, 1));
console.log(`\nwrote ${OUT}/ringsweep.json`);
console.log('errors:', errs.length ? errs.slice(0, 3) : 'none');
await browser.close();
