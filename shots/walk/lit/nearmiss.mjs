/**
 * nearmiss.mjs — how often would the near-miss clause fire, and how big is it?
 *
 * Copy gets written after the distribution, not before it. A clause that fires
 * on every route is noise; a clause that fires on none is dead code; a clause
 * that says "and 40 more just off it" is telling the user the radius is wrong
 * rather than qualifying it.
 *
 * Usage: VERIFY_URL=http://127.0.0.1:8714 node shots/walk/lit/nearmiss.mjs [n]
 */
import fs from 'node:fs';
import { chromium } from '../../../scripts/verify/node_modules/playwright-core/index.mjs';
import { BASE, launch } from '../../../scripts/verify/chrome.mjs';

const N = Number(process.argv[2] || 60);
const CODES = Object.keys(JSON.parse(fs.readFileSync('data/walk_graph.json', 'utf8')).code);
let s = 20260824;
const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pairs = [];
for (let i = 0; i < N * 4 && pairs.length < N; i++) {
  const a = CODES[Math.floor(rnd() * CODES.length)], b = CODES[Math.floor(rnd() * CODES.length)];
  if (a !== b) pairs.push([a, b]);
}

const browser = await launch(chromium, { gl: 'hardware' });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
await page.goto(BASE + '/_harness.html?intro=0&drift=0&walk=1', { waitUntil: 'networkidle', timeout: 180000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
await page.evaluate(() => { if (window.cancelGraphicsAutoDetect) window.cancelGraphicsAutoDetect(); });
await page.waitForFunction(() => !document.getElementById('veil'), null, { timeout: 120000 });

const rows = [];
for (const [a, b] of pairs) {
  const r = await page.evaluate(async ([f, t]) => {
    const res = await window.wayfindRoute(f, t, {});
    if (!res.ok) return null;
    const lit = await window.wayfindLit();
    return lit.ok ? { f, t, distM: lit.totalM, lamps: lit.lamps, nearMiss: lit.nearMiss, ring: lit.nearMissM } : null;
  }, [a, b]);
  if (r) rows.push(r);
}
const zero = rows.filter(r => r.lamps === 0);
const zeroWithNear = zero.filter(r => r.nearMiss > 0);
const med = (xs) => xs.length ? xs.slice().sort((p, q) => p - q)[Math.floor(xs.length / 2)] : 0;
console.log(`routes: ${rows.length}   ring: ${rows[0] ? rows[0].ring : '?'} m`);
console.log(`routes with NO counted lamp:                 ${zero.length} (${Math.round(100 * zero.length / rows.length)}%)`);
console.log(`  ...of those, some lamp in the outer ring:  ${zeroWithNear.length} (${Math.round(100 * zeroWithNear.length / Math.max(1, zero.length))}% of them)`);
console.log(`  near-miss count on those: median ${med(zeroWithNear.map(r => r.nearMiss))}, ` +
  `max ${Math.max(0, ...zeroWithNear.map(r => r.nearMiss))}`);
console.log(`near-miss on routes that DO have counted lamps: median ${med(rows.filter(r => r.lamps).map(r => r.nearMiss))}`);
fs.writeFileSync('shots/walk/lit/nearmiss.json', JSON.stringify(rows, null, 1));
await browser.close();
