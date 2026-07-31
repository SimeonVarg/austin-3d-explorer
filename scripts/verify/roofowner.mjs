// roofowner.mjs — who is drawing a roof on this building, and at what height?
//
// Nothing in data/roofs.geojson or data/roofscape.geojson carries a building
// id, so "is this building getting two roofs?" cannot be answered by reading
// the bakes. It has to be answered geometrically. This attributes every roof
// feature to a snapshot building by point-in-polygon on the feature's centroid,
// then reports:
//
//   1. buildings covered by BOTH bakes (roofs.py's pitched stack AND
//      roofscape.py's flat deck) — interpenetrating roof systems, which is what
//      "the roof is glitching" looks like from the air;
//   2. buildings a building pass REPLACED that still carry a roofscape deck or
//      pitched roof baked against the OLD final_height;
//   3. buildings with NO roof from either bake (roofscape skipped them as
//      "already pitched" but bake_roofs.py then rejected them downstream).
//
//   node scripts/verify/roofowner.mjs [--list]
//
// Attribution is by centroid, so a feature straddling a party wall can be
// misfiled. Counts are indicative; the named collisions are checked against
// heights, which is the part that matters.

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATA = join(ROOT, 'data');
const LIST = process.argv.includes('--list');

const snap = JSON.parse(
  readFileSync(join(DATA, 'snapshots', '2026-07-30', 'buildings.detailed.geojson'), 'utf8')
);

// ── a coarse grid index over building footprints, so this is not O(n*m) ──────
const CELL = 0.0012; // ~110 m
const grid = new Map();
const key = (x, y) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;

function ringsOf(g) {
  if (!g) return [];
  if (g.type === 'Polygon') return g.coordinates;
  if (g.type === 'MultiPolygon') return g.coordinates.flat();
  return [];
}
function bboxOf(rings) {
  let lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
  for (const r of rings) for (const q of r) {
    lo = [Math.min(lo[0], q[0]), Math.min(lo[1], q[1])];
    hi = [Math.max(hi[0], q[0]), Math.max(hi[1], q[1])];
  }
  return [lo, hi];
}
function centroidOf(rings) {
  const r = rings[0];
  let x = 0, y = 0;
  for (let i = 0; i < r.length - 1; i++) { x += r[i][0]; y += r[i][1]; }
  const n = Math.max(1, r.length - 1);
  return [x / n, y / n];
}
function inRing(x, y, r) {
  let hit = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

const buildings = [];
for (const f of snap.features) {
  const rings = ringsOf(f.geometry);
  if (!rings.length) continue;
  const [lo, hi] = bboxOf(rings);
  const b = { p: f.properties, rings, lo, hi, idx: buildings.length };
  buildings.push(b);
  for (let gx = Math.floor(lo[0] / CELL); gx <= Math.floor(hi[0] / CELL); gx++)
    for (let gy = Math.floor(lo[1] / CELL); gy <= Math.floor(hi[1] / CELL); gy++) {
      const k = `${gx},${gy}`;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(b);
    }
}

function ownerOf(x, y) {
  const cands = grid.get(key(x, y)) || [];
  for (const b of cands) {
    if (x < b.lo[0] || x > b.hi[0] || y < b.lo[1] || y > b.hi[1]) continue;
    // outer ring in, and not inside a hole
    let inside = false;
    for (let i = 0; i < b.rings.length; i++) {
      if (inRing(x, y, b.rings[i])) inside = !inside;
    }
    if (inside) return b;
  }
  return null;
}

// ── who is claimed by a building pass ───────────────────────────────────────
const claimedBy = new Map();
for (const fn of readdirSync(DATA).filter((f) => f.endsWith('.geojson'))) {
  let j;
  try { j = JSON.parse(readFileSync(join(DATA, fn), 'utf8')); } catch { continue; }
  for (const id of j.replacedBuildingIds || []) claimedBy.set(String(id), fn.replace('.geojson', ''));
}

// ── attribute the two roof bakes ────────────────────────────────────────────
function attribute(file, pick) {
  const gj = JSON.parse(readFileSync(join(DATA, file), 'utf8'));
  const per = new Map(); // building idx -> {n, minB, maxH}
  let orphan = 0;
  for (const f of gj.features) {
    if (pick && !pick(f.properties)) continue;
    const rings = ringsOf(f.geometry);
    if (!rings.length) continue;
    const [cx, cy] = centroidOf(rings);
    const b = ownerOf(cx, cy);
    if (!b) { orphan++; continue; }
    const p = f.properties;
    const lo = p.b != null ? p.b : p.base, hi = p.h != null ? p.h : p.height;
    const e = per.get(b.idx) || { n: 0, minB: Infinity, maxH: -Infinity };
    e.n++;
    if (Number.isFinite(lo)) e.minB = Math.min(e.minB, lo);
    if (Number.isFinite(hi)) e.maxH = Math.max(e.maxH, hi);
    per.set(b.idx, e);
  }
  return { per, orphan, total: gj.features.length };
}

const pitched = attribute('roofs.geojson');
const deck = attribute('roofscape.geojson', (p) => p.k === 'deck');
const clutter = attribute('roofscape.geojson', (p) => p.k !== 'deck');

console.log('attribution');
console.log(`  roofs.geojson        ${pitched.total} features, ${pitched.per.size} buildings, ${pitched.orphan} unattributed`);
console.log(`  roofscape decks      ${deck.per.size} buildings, ${deck.orphan} unattributed`);
console.log(`  roofscape clutter    ${clutter.per.size} buildings, ${clutter.orphan} unattributed`);

// ── 1. both bakes on one building ───────────────────────────────────────────
const both = [...pitched.per.keys()].filter((i) => deck.per.has(i));
console.log(`\n1. BUILDINGS WITH BOTH A PITCHED STACK AND A FLAT DECK: ${both.length}`);
for (const i of both.slice(0, LIST ? 999 : 25)) {
  const b = buildings[i], a = pitched.per.get(i), d = deck.per.get(i);
  // do the two z-ranges actually interpenetrate?
  const overlap = Math.min(a.maxH, d.maxH) - Math.max(a.minB, d.minB);
  console.log(
    `   ${(b.p.name || '(unnamed)').slice(0, 40).padEnd(42)} h=${String(b.p.final_height).padEnd(6)}` +
    ` pitched ${a.minB}-${a.maxH} (${a.n})  deck ${d.minB}-${d.maxH}` +
    (overlap > -0.001 ? `  OVERLAP ${overlap.toFixed(2)} m` : '')
  );
}
if (!LIST && both.length > 25) console.log(`   ... and ${both.length - 25} more (--list for all)`);

// ── 2. roof geometry on a building a pass replaced ──────────────────────────
console.log('\n2. ROOF GEOMETRY ON A BUILDING A BUILDING PASS REPLACED');
let stale = 0;
for (const [id, pass] of claimedBy) {
  if (pass === 'stadium') continue; // roofscape already excludes these on purpose
  const b = buildings.find((x) => String(x.p.id) === id);
  if (!b) continue;
  const a = pitched.per.get(b.idx), d = deck.per.get(b.idx), c = clutter.per.get(b.idx);
  if (!a && !d && !c) continue;
  stale++;
  const bits = [];
  if (a) bits.push(`pitched ${a.minB}-${a.maxH} (${a.n})`);
  if (d) bits.push(`deck ${d.minB}-${d.maxH}`);
  if (c) bits.push(`clutter ${c.n} @${c.minB}`);
  console.log(
    `   ${pass.padEnd(12)} ${(b.p.name || '(unnamed)').slice(0, 34).padEnd(36)} snapshot h=${String(b.p.final_height).padEnd(6)} ${bits.join('  ')}`
  );
}
if (!stale) console.log('   none');

// ── 3. no roof at all ───────────────────────────────────────────────────────
const runs = JSON.parse(readFileSync(join(DATA, 'roof_runs.json'), 'utf8'));
const measuredPitched = new Set();
for (const [k, v] of Object.entries(runs)) if (v && v[0] >= 2.0) measuredPitched.add(k.split('/')[0]);

const gap = [];
for (const b of buildings) {
  const h = b.p.final_height || 0;
  if (h < 4) continue;                       // below both bakes' floors
  if (claimedBy.has(String(b.p.id))) continue;
  if (b.p.has_parts) continue;
  if (!measuredPitched.has(String(b.p.id))) continue; // roofscape skipped it...
  if (pitched.per.has(b.idx)) continue;               // ...and roofs.py did draw it
  gap.push(b);
}
console.log(`\n3. SKIPPED BY ROOFSCAPE AS "ALREADY PITCHED" BUT NOT DRAWN BY roofs.py: ${gap.length}`);
for (const b of gap.slice(0, LIST ? 999 : 20)) {
  console.log(`   ${(b.p.name || '(unnamed)').slice(0, 44).padEnd(46)} h=${b.p.final_height}  run=${(runs[b.p.id + '/0'] || [])[0]}`);
}
if (!LIST && gap.length > 20) console.log(`   ... and ${gap.length - 20} more (--list for all)`);
console.log('');
