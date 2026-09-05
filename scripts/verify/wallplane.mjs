/**
 * wallplane.mjs — is every door on the wall its own building DRAWS, and is
 * GDC's atrium behind the brick instead of in front of it?
 *
 *   node scripts/verify/wallplane.mjs
 *
 * NO BROWSER, deliberately. Both claims are about coordinates in files the
 * renderer reads verbatim, and a screenshot can only tell you that a door looks
 * attached from the one bearing you happened to shoot. This measures the
 * distance instead, on every entrance of every building whose walls are
 * authored geometry rather than the footprint ring.
 *
 * WHAT IT COUNTS, and why it is a count and not a zero. Six passes re-draw
 * whole buildings, and their geometry does not agree with the footprint ring
 * everywhere: a door can sit on a face the authored mass simply does not have
 * (EER's ring covers a paved courtyard the hero bake deliberately refuses to
 * build), and no rule that moves doors a few metres can fix that. So this gate
 * names three populations and holds each to the number it was left at, exactly
 * the way the rest of this directory names its pixels:
 *
 *   FLOAT BAND   0.60-6.00 m off the drawn wall — a door hanging in the air in
 *                front of a wall that IS there. main: 34. Now: 12.
 *   ORPHANS      over 6.00 m — a door on a face nothing draws. main: 7. This
 *                is not the wall-plane rule's problem and it must not GROW.
 *   BURIED       a leaf inside a drawn mass by more than 0.25 m. main: 2
 *                (Cambridge Tower, MAI). Seating must add none, and no buried
 *                leaf may carry a seat vector.
 *
 * Then two assertions that are zeros because they are about this change only:
 * EER must not move (its bands are at inset 0, so the rule has nothing to do
 * there — the regression half), and every seated entrance must float again
 * when its `wp` is added back, which is what ?wallplane=0 hands the renderer.
 *
 * Finally, GDC's atrium is MEASURED rather than asserted: its outer face
 * projected on the notch's own outward direction, against the brick body's.
 * Negative is behind the brick, which is what the imagery shows and what main
 * had at +2.50 m.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const M_LAT = 111320.0;
const LAT0 = 30.2849;
const KX = Math.cos(LAT0 * Math.PI / 180) * M_LAT;

// ── the numbers this gate is made of ──────────────────────────────────
const ON_WALL = 0.60;      // m; at or under this a door is ON its wall. 0.13 is
                           // the bank's own PROUD_DOOR standoff and 0.35 is
                           // BURIED_PROUD for a relocated door; 0.60 clears
                           // both and fails a 2.63 m float by four times over.
const REACH = 6.00;        // m; bake_entrances.py's WALL_SEAT_MAX. Past this
                           // the door is not on that wall at all.
const FLOAT_BAND_MAX = 12; // main is 34
const ORPHAN_MAX = 7;      // main is 7 and this may not grow
const BURIED_MAX = 2;      // main is 2, both pre-existing
const BURIED_OUT = 0.25;   // m; bake_entrances.py's BURIED_TEST_OUT
const GROUND_MAX = 2.0;    // m of base; its BURIED_BASE_MAX
const TOP_MIN = 3.0;       // m; its BURIED_TOP_MIN
const NEAR_HOST = 40.0;    // m a mass may sit from the host ring it belongs to

const J = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const toM = c => [c[0] * KX, c[1] * M_LAT];
const ringM = g => (g && g.type === 'Polygon') ? g.coordinates[0].map(toM) : null;

/** Distance from a point to a closed ring. Negative inside. */
function ringDist(p, ring) {
  let best = Infinity, inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length - 1; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > p[1]) !== (b[1] > p[1])
        && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    const A = ring[i], B = ring[i + 1];
    const dx = B[0] - A[0], dy = B[1] - A[1];
    const L2 = dx * dx + dy * dy;
    let t = L2 > 0 ? ((p[0] - A[0]) * dx + (p[1] - A[1]) * dy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(p[0] - (A[0] + t * dx), p[1] - (A[1] + t * dy));
    if (d < best) best = d;
  }
  return inside ? -best : best;
}

const heroes = J('data/heroes.geojson');
const ents = J('data/entrances.geojson');
const snap = J('data/snapshots/' + ents.snapshot + '/buildings.detailed.geojson');

// ── the masses each authored pass draws at grade, per host it claims ───
const FILES = ['heroes', 'stadium', 'moody', 'arts', 'drag', 'capitol', 'tower',
               'westcampus', 'parts'];
const hostRing = {};
for (const f of snap.features) hostRing[f.properties.id] = ringM(f.geometry);
const ownMasses = {};
for (const fn of FILES) {
  const p = path.join(ROOT, 'data', fn + '.geojson');
  if (!fs.existsSync(p)) continue;
  const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
  const claims = (doc.replacedBuildingIds || []).map(String).filter(b => hostRing[b]);
  if (!claims.length) continue;
  for (const f of doc.features || []) {
    const pr = f.properties || {};
    const base = pr.base != null ? pr.base : (pr.min_height_m || 0);
    const top = pr.h != null ? pr.h : (pr.final_height || pr.height_m || 0);
    if (base > GROUND_MAX || top < TOP_MIN) continue;
    const r = ringM(f.geometry);
    if (!r) continue;
    const c = r.reduce((a, q) => [a[0] + q[0] / r.length, a[1] + q[1] / r.length], [0, 0]);
    let bid = null, bd = Infinity;
    for (const b of claims) {
      const d = Math.abs(ringDist(c, hostRing[b]));
      if (d < bd) { bd = d; bid = b; }
    }
    if (bid && bd < NEAR_HOST) (ownMasses[bid] = ownMasses[bid] || []).push(r);
  }
}

const byEid = new Map();
for (const f of ents.features) {
  const e = f.properties.eid;
  if (!byEid.has(e)) byEid.set(e, []);
  byEid.get(e).push(f);
}

let fail = 0;
const say = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fail++; };
const meanM = (feats, shift) => {
  let sx = 0, sy = 0, n = 0;
  for (const f of feats) for (const r of f.geometry.coordinates) for (const c of r) {
    const m = toM(shift ? [c[0] + shift[0], c[1] + shift[1]] : c);
    sx += m[0]; sy += m[1]; n++;
  }
  return [sx / n, sy / n];
};
const nearest = (p, rings) => rings.reduce((b, r) => Math.min(b, Math.abs(ringDist(p, r))), Infinity);

const rows = [];
for (const [eid, feats] of byEid) {
  const pr = feats[0].properties;
  const masses = ownMasses[pr.bid];
  if (!masses) continue;
  const wpF = feats.find(f => f.properties.wp);
  const door = feats.find(f => f.properties.k === 'door');
  rows.push({
    eid, bid: pr.bid, ref: pr.ref || pr.nm, feats, masses,
    d: nearest(meanM(feats), masses),
    leaf: door ? Math.min(...masses.map(r => ringDist(meanM([door]), r))) : null,
    wp: wpF ? wpF.properties.wp : null,
  });
}
rows.sort((a, b) => b.d - a.d);

const band = rows.filter(r => r.d > ON_WALL && r.d <= REACH);
const orphans = rows.filter(r => r.d > REACH);
const buried = rows.filter(r => r.leaf != null && r.leaf < -BURIED_OUT);

console.log('%d entrances on %d buildings whose walls are authored geometry',
            rows.length, Object.keys(ownMasses).length);

console.log('A. the float band — a door hanging in front of a wall that IS there');
for (const r of band) console.log('     eid %d %s  %s m', r.eid, r.ref, r.d.toFixed(2));
say(band.length <= FLOAT_BAND_MAX,
    band.length + ' between ' + ON_WALL.toFixed(2) + ' and ' + REACH.toFixed(2)
    + ' m off the drawn wall (main 34, ceiling ' + FLOAT_BAND_MAX + ')');

console.log('B. orphans — a door on a face nothing draws. Not this rule’s to fix, and it may not grow');
for (const r of orphans) console.log('     eid %d %s  %s m', r.eid, r.ref, r.d.toFixed(2));
say(orphans.length <= ORPHAN_MAX,
    orphans.length + ' over ' + REACH.toFixed(2) + ' m (main ' + ORPHAN_MAX + ')');

console.log('C. buried leaves — seating must not push a door inside anything');
for (const r of buried) {
  console.log('     eid %d %s  %s m inside%s', r.eid, r.ref, (-r.leaf).toFixed(2),
              r.wp ? '  <- SEATED, this one is ours' : '  (pre-existing)');
}
say(buried.length <= BURIED_MAX && buried.every(r => !r.wp),
    buried.length + ' leaves more than ' + BURIED_OUT + ' m inside a drawn mass (main '
    + BURIED_MAX + '), seated among them: ' + buried.filter(r => r.wp).length);

console.log('D. EER is untouched — its bands are at inset 0, so the rule has nothing to do');
const eerBid = (heroes.replacedBuildingIds || []).find(b => {
  const f = snap.features.find(x => x.properties.id === b);
  return f && /Engineering Education/.test(f.properties.name || '');
});
const eerSeated = rows.filter(r => r.bid === eerBid && r.wp);
say(eerSeated.length === 0, 'EER entrances carrying a seat vector: ' + eerSeated.length + ' (want 0)');

console.log('E. ?wallplane=0 puts every seated entrance back where main had it');
const seated = rows.filter(r => r.wp);
let restored = 0;
for (const r of seated) {
  const back = nearest(meanM(r.feats, r.wp), r.masses);
  if (back > ON_WALL) restored++;
  else say(false, 'eid ' + r.eid + ' ' + r.ref + ': wp puts it back only '
                  + back.toFixed(2) + ' m out — the switch restores nothing');
}
say(restored === seated.length,
    restored + ' of ' + seated.length + ' seated entrances float again with the switch off');

// ── the atrium, measured along the notch's own outward direction ───────
const atrium = heroes.features.find(f => f.properties.b === 'gdc' && f.properties.band === 'atrium');
const brick = heroes.features.find(f => f.properties.b === 'gdc' && f.properties.band === 'body');
if (atrium && brick) {
  const a = ringM(atrium.geometry), b = ringM(brick.geometry);
  // The direction to measure along is the notch's own axis, which is the
  // atrium rectangle's LONG edge — not brick-centre-to-atrium-centre, which is
  // a diagonal and answers a different question (it read 4.95 m for a 0.90 m
  // recess). Signed so it points out of the building.
  const cen = r => r.slice(0, -1).reduce((s, q, _, arr) =>
    [s[0] + q[0] / arr.length, s[1] + q[1] / arr.length], [0, 0]);
  const ca = cen(a), cb = cen(b);
  let n = [1, 0], bestLen = -1;
  for (let i = 0; i < a.length - 1; i++) {
    const dx = a[i + 1][0] - a[i][0], dy = a[i + 1][1] - a[i][1];
    const L = Math.hypot(dx, dy);
    if (L > bestLen) { bestLen = L; n = [dx / L, dy / L]; }
  }
  if ((ca[0] - cb[0]) * n[0] + (ca[1] - cb[1]) * n[1] < 0) n = [-n[0], -n[1]];
  const proj = (r, v) => Math.max(...r.map(q => q[0] * v[0] + q[1] * v[1]));
  const gap = proj(a, n) - proj(b, n);
  console.log('GDC atrium: its outer face is %s m %s the brick body’s, along the notch’s own axis'
              + ', outward (main shipped +2.50 m PROUD); wp0 present: %s',
              Math.abs(gap).toFixed(2), gap < 0 ? 'BEHIND' : 'proud of', !!atrium.properties.wp0);
}

console.log(fail ? '\nWALLPLANE ' + fail + ' FAILED' : '\nWALLPLANE all green');
process.exit(fail ? 1 : 0);
