/**
 * canopy-ab.mjs — does charging more for a tree-covered lamp change any route,
 * over enough routes to mean something?
 *
 * canopy.mjs A/B'd twelve fixed pairs and got 0/12 — but only ONE of those
 * twelve routes carried a covered lamp at all, so 0/12 was not evidence, it was
 * an empty test wearing a number. This runs the same A/B over a large seeded
 * sample of real building pairs, and reports the sub-population that could
 * possibly be affected (routes with at least one covered lamp) separately from
 * the whole, because the whole is mostly routes the setting cannot touch.
 *
 * The decision it exists to settle: `litCanopyMult` ships at 1.25 or at 1.0.
 * A term in a cost function that provably moves nothing should not ship at all,
 * and the count can be printed either way.
 *
 * Usage:
 *   VERIFY_MAX_MS=1500000 VERIFY_URL=http://127.0.0.1:8714 \
 *     node shots/walk/lit/canopy-ab.mjs [--pairs 60]
 */
import { chromium } from '../../../scripts/verify/node_modules/playwright-core/index.mjs';
import { BASE, launch } from '../../../scripts/verify/chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const N_PAIRS = parseInt(opt('--pairs', '60'), 10);
const TOD = parseFloat(opt('--tod', '0.92'));
const OUT = 'shots/walk/lit';
const MULTS = [1.25, 1.0];

const log = [];
const say = (s) => { console.log(s); log.push(s); };
fs.mkdirSync(OUT, { recursive: true });

// Codes come out of the shipped entrances file, so the sample is the buildings
// the app actually ships doors for, not a list somebody typed.
const ent = JSON.parse(fs.readFileSync('data/entrances.geojson', 'utf8'));
const refs = [...new Set(ent.features.map(f => f.properties.ref || f.properties.code).filter(Boolean))].sort();
say(`# canopy-ab — ${new Date().toISOString()}`);
say(`${refs.length} building codes in data/entrances.geojson`);

const rnd = (() => { let s = 20260824; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
const pairs = [];
const seen = new Set();
while (pairs.length < N_PAIRS && seen.size < N_PAIRS * 12) {
  const a = refs[Math.floor(rnd() * refs.length)], b = refs[Math.floor(rnd() * refs.length)];
  const k = a + '>' + b;
  if (a === b || seen.has(k)) continue;
  seen.add(k); pairs.push([a, b]);
}
say(`sampling ${pairs.length} seeded pairs`);

const browser = await launch(chromium, { gl: 'hardware' });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
page.on('pageerror', e => say('  [pageerror] ' + e.message));
await page.goto(BASE + '/_harness.html?intro=0&drift=0&walk=1', { waitUntil: 'networkidle', timeout: 180000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
await page.evaluate(() => { if (window.cancelGraphicsAutoDetect) window.cancelGraphicsAutoDetect(); });
await page.waitForFunction(() => !document.getElementById('veil'), null, { timeout: 120000 });
await page.evaluate((v) => {
  const el = document.getElementById('tod-slider');
  if (el) { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
  if (typeof window.applyTimeOfDay === 'function') window.applyTimeOfDay(window.__map, v, true);
}, TOD);
await page.waitForTimeout(1500);
const gotP = await page.evaluate(() => window.__todCurrentP);
say(`tod: ${gotP}`);

const runs = {};
for (const mult of MULTS) {
  const ok = await page.evaluate((m) => {
    window.WAYFIND.litCanopyMult = m;
    return typeof window.wayfindLitReprice === 'function' && window.wayfindLitReprice();
  }, mult);
  if (!ok) { say('FAIL: no wayfindLitReprice hook — this A/B would be meaningless'); await browser.close(); process.exit(1); }
  const out = [];
  for (let i = 0; i < pairs.length; i++) {
    const [a, b] = pairs[i];
    const r = await page.evaluate(async ([f, t]) => {
      let res;
      try { res = await window.wayfindRoute(f, t, {}); } catch (e) { return null; }
      if (!res || !res.ok) return null;
      const lit = await window.wayfindLit();
      return {
        distM: Math.round(res.distM), lamps: lit.lamps, canopy: lit.lampsUnderCanopy,
        alt: lit.alt ? { extraM: lit.alt.extraM, lamps: lit.alt.lamps, why: lit.alt.why, distM: lit.alt.distM } : null,
      };
    }, [a, b]);
    out.push({ pair: a + '>' + b, r });
    // reprice between routes too: litEdgeWeights memoises once per graph, and a
    // route computed before a constant changed would carry the old answer.
    await page.evaluate(() => window.wayfindLitReprice());
    if (i % 10 === 9) process.stdout.write(`\r  mult ${mult}: ${i + 1}/${pairs.length}   `);
  }
  process.stdout.write('\n');
  runs[mult] = out;
}

const A = runs[MULTS[0]], B = runs[MULTS[1]];
let routed = 0, withCanopy = 0, offersA = 0, offersB = 0, differ = 0, differWithCanopy = 0;
const diffs = [];
for (let i = 0; i < A.length; i++) {
  const a = A[i].r, b = B[i].r;
  if (!a || !b) continue;
  routed++;
  const hasCan = a.canopy > 0;
  if (hasCan) withCanopy++;
  if (a.alt) offersA++;
  if (b.alt) offersB++;
  const ka = a.alt ? `${a.alt.distM}/${a.alt.lamps}/${a.alt.why}` : 'none';
  const kb = b.alt ? `${b.alt.distM}/${b.alt.lamps}/${b.alt.why}` : 'none';
  if (ka !== kb) {
    differ++;
    if (hasCan) differWithCanopy++;
    diffs.push({ pair: A[i].pair, canopy: a.canopy, at1_25: ka, at1_0: kb });
  }
}
say('');
say(`routed pairs                                    ${routed}/${pairs.length}`);
say(`...carrying at least one tree-covered lamp      ${withCanopy}`);
say(`offers made at litCanopyMult 1.25               ${offersA}`);
say(`offers made at litCanopyMult 1.0                ${offersB}`);
say(`routes where the OFFER differs between the two  ${differ}`);
say(`...of those, routes that had a covered lamp     ${differWithCanopy}`);
if (diffs.length) say('differences: ' + JSON.stringify(diffs.slice(0, 12), null, 1));
say('');
say(differ === 0
  ? 'VERDICT: the multiplier moves nothing. Ship the count, ship the constant at 1.0.'
  : `VERDICT: the multiplier changes ${differ} offer(s). Keep it, and say what it bought.`);

fs.writeFileSync(path.join(OUT, 'canopy-ab.json'), JSON.stringify({
  when: new Date().toISOString(), tod: gotP, pairs: pairs.length, routed, withCanopy,
  offersA, offersB, differ, differWithCanopy, diffs, runs,
}, null, 1));
fs.writeFileSync(path.join(OUT, 'canopy-ab.log'), log.join('\n') + '\n');
await browser.close();
