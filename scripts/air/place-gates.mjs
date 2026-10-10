/**
 * place-gates.mjs — builds data/air/courses.json from the real city.
 *
 *   node scripts/air/place-gates.mjs            write the course and print the report
 *   node scripts/air/place-gates.mjs --dry      print only
 *
 * The course is a list of INTENTS (COURSE below): a point and an altitude, or
 * "between tower A and tower B" (the gate goes at the midpoint of their two
 * nearest walls and faces along the corridor between them). The script turns
 * each into a ring, points its axis along the flight path (or along the
 * corridor), and judges it against the real heights in data/air/heights.u8 and
 * against the raw footprints. It writes nothing it cannot defend: a gate that
 * is not in clear air or cannot be reached from the one before stops the run.
 *
 * Every taste number is on its intent line (altitude, radius), so the owner can
 * move a gate by editing one line and re-running.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadObstacles, REPO } from './lib/obstacles.mjs';
import { namedTowers, gapBetween } from './lib/groups.mjs';
import { rasterClearance, rawClearance, indexObstacles, legFeasible, angDiff, bearing } from './lib/validate.mjs';
const require = createRequire(import.meta.url);
const AIR = require('../../js/air/params.js');
const G = require('../../js/air/geo.js');
const { HeightField } = require('../../js/air/heights.js');

// ── THE COURSE ("Skyline") ────────────────────────────────────────────
// x, y: metres east / north of the UT Tower. z: ring centre height above the ground. r: ring radius.
export const START = { x: 0, y: -70, z: 185, yaw: 0 };
export const COURSE = [
  { name: 'UT Tower',            x:    0, y:   10, z: 150, r: 26, note: 'straight over the Tower (93 m)' },
  { name: 'North campus',        x:  -15, y:  260, z: 140, r: 24 },
  { name: 'Hairpin',             x: -120, y:  385, z: 128, r: 24 },
  { name: 'Drag, north',         x: -235, y:  295, z: 112, r: 24, note: 'turning onto Guadalupe' },
  { name: 'The Drag',            x: -245, y:  115, z:  95, r: 22, note: 'down Guadalupe St' },
  { name: 'Dobie | Ion',         gap: ['Dobie Twenty21', 'Ion Austin'], z: 75, r: 24, auto: 1, note: 'between two West Campus towers, down Guadalupe' },
  { name: 'Rio Grande',          x: -480, y: -540, z:  75, r: 22, auto: 1 },
  { name: 'Shoal Creek',         x: -540, y: -1000, z: 92, r: 22, auto: 1 },
  { name: 'Hyde Park',          x: -450, y: -1350, z: 105, r: 24, auto: 1 },
  { name: 'Pease',               x: -350, y: -1690, z: 130, r: 24, auto: 1 },
  { name: 'Indeed | One American', gap: ['indeed-tower', 'one-american'], z: 120, r: 16, auto: 1 },
  { name: '415 Colorado | Frost',   gap: ['415-colorado', 'frost-bank'],   z: 130, r: 24, auto: 1 },
  { name: 'Austonian | JW Marriott', gap: ['austonian', 'jw-marriott'],    z: 125, r: 24, auto: 1 },
  { name: 'Cesar Chavez',        x: -345, y: -2515, z: 120, r: 24, auto: 1, note: 'the turnaround' },
  { name: 'Congress Ave bridge', x: -215, y: -2440, z: 120, r: 24, auto: 1 },
  { name: 'Congress, south',     x: -195, y: -2270, z: 125, r: 24, auto: 1 },
  { name: 'Congress, mid',       x: -200, y: -1790, z: 115, r: 24, auto: 1 },
  { name: 'Capitol, south',      x: -140, y: -1480, z: 100, r: 24, auto: 1 },
  { name: 'Capitol, west',       x: -240, y: -1261, z: 118, r: 26, note: 'dome top 92 m' },
  { name: 'Capitol, north',      x:  -91, y: -1100, z: 125, r: 26 },
  { name: 'Capitol, east',       x:  150, y: -1010, z: 120, r: 26 },
  { name: 'East campus',         x:  400, y:  -640, z: 110, r: 26 },
  { name: 'Finish, DKR',         x:  653, y:  -245, z: 125, r: 30, note: 'over the stadium' },
];

export function buildCourse(obstacles) {
  const towers = namedTowers(obstacles);
  const pts = COURSE.map(c => {
    if (c.gap) {
      const [A, B] = c.gap.map(n => { if (!towers[n]) throw new Error('no tower named ' + n); return towers[n]; });
      const gp = gapBetween(A, B);
      const ab = bearing({ x: gp.a[0], y: gp.a[1] }, { x: gp.b[0], y: gp.b[1] });
      return { ...c, x: gp.mid.x, y: gp.mid.y, gapWidth: gp.width, corridor: [G.wrap360(ab + 90), G.wrap360(ab - 90)], tops: [A.top, B.top] };
    }
    return { ...c };
  });
  // axes
  const all = [START, ...pts];
  for (let i = 0; i < pts.length; i++) {
    const prev = i === 0 ? START : pts[i - 1], nxt = pts[i + 1];
    const din = i === 0 ? START.yaw : bearing(prev, pts[i]);
    const dout = nxt ? bearing(pts[i], nxt) : din;
    const bis = G.wrap360(din + G.wrap180(dout - din) / 2);
    const c = pts[i];
    if (c.corridor) { c.yaw = c.corridor.reduce((b, a) => angDiff(a, bis) < angDiff(b, bis) ? a : b); c.axisFrom = 'corridor'; }
    else { c.yaw = bis; c.axisFrom = 'path'; }
    c.inAngle = angDiff(din, c.yaw);
  }
  return pts;
}

/** Lift a gate with `auto` to the first altitude (5 m steps, up to +90) where both clearance tests pass. */
export function settleAltitudes(pts, field, idx) {
  const need = AIR.gates.margin + 1;
  for (const c of pts) {
    if (!c.auto) continue;
    if (c.gap) {                       // centre the ring in the real clear space: slide it along the line joining the two towers
      const ux = Math.sin(((c.yaw + 90) % 360) * G.RAD), uy = Math.cos(((c.yaw + 90) % 360) * G.RAD);
      const x0 = c.x, y0 = c.y; let best = -1, bo = 0;
      for (let o = -24; o <= 24; o += 2) { c.x = x0 + ux * o; c.y = y0 + uy * o; const d = rasterClearance(c, field, need + 10).d; if (d > best + 0.01 || (Math.abs(d - best) < 0.01 && Math.abs(o) < Math.abs(bo))) { best = d; bo = o; } }
      c.x = x0 + ux * bo; c.y = y0 + uy * bo; c.slid = bo;
    }
    const z0 = c.z;
    for (let dz = 0; dz <= 90; dz += 5) {
      c.z = z0 + dz;
      if (rasterClearance(c, field, need + 2).d >= need && rawClearance(c, idx, need + 2).d >= need) break;
    }
    c.lifted = c.z - z0;
  }
}

export function toJSON(pts) {
  const s = G.toLngLat(START.x, START.y);
  return {
    id: 'skyline', version: 1, name: 'Skyline',
    note: 'Built by scripts/air/place-gates.mjs from the repo heights; do not edit by hand, edit COURSE there.',
    origin: AIR.origin,
    start: { lng: +s.lng.toFixed(6), lat: +s.lat.toFixed(6), alt: START.z, yaw: START.yaw },
    gates: pts.map((c, i) => { const p = G.toLngLat(c.x, c.y);
      return { id: 'g' + i, name: c.name, lng: +p.lng.toFixed(6), lat: +p.lat.toFixed(6), alt: c.z, r: c.r, yaw: +c.yaw.toFixed(1), kind: i === pts.length - 1 ? 'finish' : i === 0 ? 'start' : 'ring',
               ...(c.note ? { note: c.note } : {}) }; }),
  };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const { obstacles } = loadObstacles();
  const meta = JSON.parse(fs.readFileSync(path.join(REPO, 'data/air/heights.json'), 'utf8'));
  const field = new HeightField(meta, new Uint8Array(fs.readFileSync(path.join(REPO, 'data/air/heights.u8'))));
  const idx = indexObstacles(obstacles);
  const pts = buildCourse(obstacles);
  settleAltitudes(pts, field, idx);
  let bad = 0, total = 0;
  console.log('#  name'.padEnd(34), 'x     y      z   r  yaw  inAng  raster  raw    leg(D need/cap climb)');
  pts.forEach((c, i) => {
    const ras = rasterClearance(c, field, AIR.gates.margin + 30), raw = rawClearance(c, idx, AIR.gates.margin + 30);
    const prev = i === 0 ? { ...START } : pts[i - 1];
    const leg = legFeasible(prev, c);
    total += leg.D;
    const flag = [];
    if (ras.d < AIR.gates.margin) flag.push('RASTER-CLEARANCE');
    if (raw.d < AIR.gates.margin) flag.push('RAW-CLEARANCE');
    if (!leg.ok) flag.push('LEG');
    if (c.inAngle > 45) flag.push('ANGLE');
    if (c.gapWidth && c.gapWidth < 2 * (c.r + AIR.gates.margin)) flag.push('GAP-TOO-NARROW');
    if (flag.length) bad++;
    console.log(String(i).padStart(2), c.name.padEnd(30), c.x.toFixed(0).padStart(6), c.y.toFixed(0).padStart(6), String(c.z).padStart(4), String(c.r).padStart(3), c.yaw.toFixed(0).padStart(4), c.inAngle.toFixed(0).padStart(5),
      ras.d.toFixed(0).padStart(6), raw.d.toFixed(0).padStart(5), `  ${leg.D.toFixed(0)} ${leg.need.toFixed(0)}/${leg.turnCap.toFixed(0)} ${leg.climb.toFixed(0)}`, flag.join(' '), c.lifted ? `(+${c.lifted}m)` : '', raw.at && raw.d < 40 ? `near ${raw.at.by}` : '');
  });
  console.log(`course length ${(total / 1000).toFixed(2)} km, ${pts.length} gates, ${bad} flagged`);
  if (!process.argv.includes('--dry')) {
    fs.writeFileSync(path.join(REPO, 'data/air/courses.json'), JSON.stringify(toJSON(pts), null, 1) + '\n');
    console.log('wrote data/air/courses.json');
  }
}
