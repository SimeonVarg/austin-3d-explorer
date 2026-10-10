/**
 * autopilot.js — flies the course on a racing line. Used three ways: the
 * HOUSE GHOST (the time to beat when a link has no ghost), the recorded clip,
 * and the placement test that proves every gate is reachable by the real
 * flight model (scripts/verify/air-course.mjs).
 *
 * Pure pursuit with two refinements: the aim point slides from the ring
 * centre to a point beyond it along the ring's axis as the craft closes (so it
 * leaves straight), and it boosts when it is lined up and brakes for a hard
 * turn. It sees only the craft and the gate list, no world: the soft floor in
 * the flight model keeps it off roofs, and the placement test proves the line
 * does not need it.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./params.js'), require('./geo.js'));
  else root.AirAutopilot = factory(root.AIR, root.AirGeo);
})(typeof self !== 'undefined' ? self : this, function (AIR, G) {
  'use strict';
  const { RAD, wrap180, clamp } = G;

  function aimPoint(c, gates, next, P) {
    const A = P.autopilot, g = gates[Math.min(next, gates.length - 1)];
    const d = Math.hypot(g.x - c.x, g.y - c.y);
    const L = Math.max(60, c.v * A.lookAheadS * 1.6);
    const w = clamp(1 - d / L, 0, 1);
    return { x: g.x + g.ax * A.aimBeyondGateM * w, y: g.y + g.ay * A.aimBeyondGateM * w, z: g.z, d };
  }

  /** The stick for this frame. `next` is the index of the gate being chased. */
  function control(c, gates, next, P) {
    P = P || AIR;
    const A = P.autopilot, F = P.flight, skill = A.skill;
    const t = aimPoint(c, gates, next, P);
    const want = Math.atan2(t.x - c.x, t.y - c.y) / RAD;
    const err = wrap180(want - c.yaw);
    const yawRate = F.yawRateMax * (c.roll / F.rollMax);
    let bank = clamp(A.yawGain * err / F.yawRateMax - 0.012 * yawRate * 0, -1, 1);
    const dh = Math.max(Math.hypot(t.x - c.x, t.y - c.y), 25);
    const wantPitch = clamp(Math.atan2(t.z - c.z, dh) / RAD, -F.pitchDown * 0.8, F.pitchUp * 0.8);
    const pitch = clamp(A.pitchGain * (wantPitch - c.pitch) / (F.pitchRate * 0.5), -1, 1);
    // How hard is the turn AFTER this gate? Fast into a hairpin is a miss.
    const g = gates[Math.min(next, gates.length - 1)], g2 = gates[next + 1];
    let phi = 0;
    if (g2) phi = Math.abs(wrap180(Math.atan2(g2.x - g.x, g2.y - g.y) / RAD - Math.atan2(g.x - c.x, g.y - c.y) / RAD));
    const aligned = Math.abs(err) < A.boostAligned * skill;
    const boost = aligned && t.d > 60 / skill && phi < A.boostMaxTurn ? 1 : 0;
    const brake = (Math.abs(err) > A.brakeYawErr && c.v > F.vCruise * 0.9) ||
                  (phi > A.brakeTurn && c.v > F.vCruise * 1.06 && t.d < c.v * A.brakeLeadS) ? 1 : 0;
    return { pitch, bank, boost: brake ? 0 : boost, brake };
  }
  return { control, aimPoint };
});
