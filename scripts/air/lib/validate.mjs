/**
 * validate.mjs — the placement checks, shared by place-gates.mjs and the node
 * tests, so "the script placed it" and "the test accepts it" are one rule.
 *
 * clearGate(): every point of the ring's disc (and its tube) is at least
 * `margin` metres (3D) from any solid, read two ways: from the baked raster
 * (conservative: heights rounded up, cells treated as full boxes) and from the
 * raw footprint polygons (exact). A gate passes only if both agree.
 */
import { createRequire } from 'node:module';
import { bbox, inRings, distToRings } from './obstacles.mjs';
const require = createRequire(import.meta.url);
const AIR = require('../../../js/air/params.js');
const G = require('../../../js/air/geo.js');

/** Points of a gate's disc: [{x,y,z}], on a 2 m polar grid out to the tube. */
export function discPoints(g, step = 2) {
  const px = Math.cos(g.yaw * G.RAD), py = -Math.sin(g.yaw * G.RAD), out = [];
  for (let u = -g.r; u <= g.r + 1e-6; u += step) for (let w = -g.r; w <= g.r + 1e-6; w += step) {
    if (u * u + w * w <= (g.r + AIR.gates.tubeRadius) ** 2) out.push({ x: g.x + px * u, y: g.y + py * u, z: g.z + w });
  }
  return out;
}

export function rasterClearance(g, field, limit) {
  let best = limit, at = null;
  for (const p of discPoints(g)) { const d = field.clearance(p.x, p.y, p.z, limit); if (d < best) { best = d; at = p; } }
  return { d: best, at };
}

export function indexObstacles(obstacles) { return obstacles.map(o => ({ o, bb: bbox(o.rings) })); }
export function rawClearance(g, idx, limit) {
  const pts = discPoints(g, 3);
  const x0 = g.x - g.r - limit, x1 = g.x + g.r + limit, y0 = g.y - g.r - limit, y1 = g.y + g.r + limit;
  const near = idx.filter(e => e.bb[2] >= x0 && e.bb[0] <= x1 && e.bb[3] >= y0 && e.bb[1] <= y1 && e.o.top > g.z - g.r - limit);
  let best = limit, at = null;
  for (const p of pts) for (const e of near) {
    const horiz = inRings(e.o.rings, p.x, p.y) ? 0 : distToRings(e.o.rings, p.x, p.y);
    if (horiz >= best) continue;
    const base = e.o.base > 0 ? e.o.base : 0;       // a floating part (a bridge) has air under it; treat the span as solid, like the raster
    const dz = Math.max(0, p.z - e.o.top);
    const d = Math.hypot(horiz, dz);
    if (d < best) { best = d; at = { ...p, by: e.o.name || e.o.src }; }
  }
  return { d: best, at };
}

/** Angle (deg) between two compass bearings. */
export const angDiff = (a, b) => Math.abs(G.wrap180(a - b));
export const bearing = (a, b) => G.wrap360(Math.atan2(b.x - a.x, b.y - a.y) / G.RAD);

/** Kinematic prefilter for one leg: can the model turn and climb that much in that distance? */
export function legFeasible(a, b, P = AIR) {
  const F = P.flight, D = Math.hypot(b.x - a.x, b.y - a.y);
  const need = angDiff(bearing(a, b), a.yaw) + angDiff(bearing(a, b), b.yaw);
  const turnCap = F.yawRateMax * (D / F.vCruise) * 1.0;   // deg available at cruise speed (the autopilot brakes for the rest)
  const climb = Math.atan2(b.z - a.z, D) / G.RAD;
  return { D, need, turnCap, climb, ok: need <= turnCap + 5 && climb <= F.pitchUp * 0.7 && climb >= -F.pitchDown * 0.7 };
}
