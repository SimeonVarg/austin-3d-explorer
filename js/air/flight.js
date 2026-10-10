/**
 * flight.js — the Air Race flight model. Pure maths: no DOM, no MapLibre, so
 * node tests (scripts/verify/air-flight.mjs) run the very same step the page
 * does.
 *
 * ONE RULE (the same one js/controls.js lives by): THE CRAFT IS THE STATE.
 * Position (x east, y north, z up, metres), heading (yaw, degrees clockwise
 * from north), pitch, bank and one scalar speed along the nose. The camera and
 * the map pose are OUTPUTS derived from it (js/air/camera.js); nothing steers
 * the map.
 *
 * ENERGY. The gravity term is the only one that changes speed without a
 * thrust / drag target, and it is written so speed and height trade exactly:
 * v' = v - G sin(p) dt, z' = z + mean(v, v') sin(p) dt, hence
 * v^2/2 + G z is conserved to float precision when the thrust and bleed terms
 * are switched off (scripts/verify/air-flight.mjs asserts it). A dive is a gift
 * of speed that the bleed term then takes back over tauBleed seconds.
 *
 * THE FLOOR IS SOFT. `world.maxHeight(x, y, r)` answers "the highest roof
 * within r metres, 0 over open ground". The craft is held `clearGround` above
 * the ground and `clearRoof` above any roof it can feel, by a spring (never an
 * instant move), a nose-up assist from what lies ahead (lookAheadS), and a
 * sideways push away from a roof that is higher than the craft. Nothing ends the
 * run.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./params.js'), require('./geo.js'));
  else root.AirFlight = factory(root.AIR, root.AirGeo);
})(typeof self !== 'undefined' ? self : this, function (AIR, G) {
  'use strict';
  const { RAD, clamp, wrap360 } = G;
  const sin = Math.sin, cos = Math.cos, exp = Math.exp;

  function newCraft(x, y, z, yaw, speed) {
    const F = AIR.flight;
    return { x, y, z, yaw: yaw || 0, pitch: 0, roll: 0, v: speed == null ? F.vCruise : speed,
             sP: 0, sB: 0, floor: 0, t: 0 };
  }
  const NO_INPUT = Object.freeze({ pitch: 0, bank: 0, boost: 0, brake: 0 });
  const NO_WORLD = { maxHeight: () => 0 };

  /** Advance the craft by dt seconds (dt <= 1/stepHz for the honest result). */
  function step(c, inp, dt, world, P) {
    const F = (P || AIR).flight;
    world = world || NO_WORLD;
    inp = inp || NO_INPUT;

    // 1. the stick, smoothed: a key is 0 or 1, this makes it analogue
    const ks = 1 - exp(-dt / F.tauStick);
    c.sB += (clamp(inp.bank || 0, -1, 1) - c.sB) * ks;
    c.sP += (clamp(inp.pitch || 0, -1, 1) - c.sP) * ks;

    // 2. bank follows the stick
    const rollT = c.sB * F.rollMax;
    c.roll += (rollT - c.roll) * (1 - exp(-dt / F.tauRoll));

    // 3. the turn: yaw rate follows the bank, softened at speed
    const yawRate = F.yawRateMax * (sin(c.roll * RAD) / sin(F.rollMax * RAD)) *
                    Math.pow(F.vRef / Math.max(c.v, 1), F.yawSpeedExp);
    c.yaw = wrap360(c.yaw + yawRate * dt);

    // 4. the floor, felt: probes at now, half and full look-ahead
    let required0 = F.clearGround, deficitAhead = 0, gx = 0, gy = 0, roofHere = 0;
    const sy = sin(c.yaw * RAD), cy = cos(c.yaw * RAD);
    const vh = c.v * cos(c.pitch * RAD), climb = c.v * sin(c.pitch * RAD);
    for (let i = 0; i < 3; i++) {
      const tt = i === 0 ? 0 : F.lookAheadS * (i / 2);
      const px = c.x + sy * vh * tt, py = c.y + cy * vh * tt;
      const h = world.maxHeight(px, py, F.probeRadius);
      const need = Math.max(F.clearGround, h > 0 ? h + F.clearRoof : 0);
      if (i === 0) { required0 = need; roofHere = h; }
      else deficitAhead = Math.max(deficitAhead, need - (c.z + climb * tt));
    }
    if (roofHere > 0 && c.z < roofHere + F.clearRoof * 0.6) {
      const d = 6, hx = world.maxHeight(c.x + d, c.y, F.probeRadius) - world.maxHeight(c.x - d, c.y, F.probeRadius);
      const hy = world.maxHeight(c.x, c.y + d, F.probeRadius) - world.maxHeight(c.x, c.y - d, F.probeRadius);
      const n = Math.hypot(hx, hy);
      if (n > 1e-6) { gx = -hx / n; gy = -hy / n; }
    }

    // 5. pitch: the stick commands a rate; with no stick it levels; the floor adds nose-up
    const stickMag = Math.abs(c.sP);
    let pitchRate = c.sP * F.pitchRate - (c.pitch / F.tauLevel) * (1 - stickMag);
    if (deficitAhead > 0) pitchRate += F.floorPitchAssist * clamp(deficitAhead / (F.clearRoof * 2.5), 0, 1);
    c.pitch = clamp(c.pitch + pitchRate * dt, -F.pitchDown, F.pitchUp);

    // 6. speed: thrust / brake / bleed toward the target, plus exact gravity
    const target = inp.brake ? F.vBrake : inp.boost ? F.vBoost : F.vCruise;
    let dv = -F.gravity * sin(c.pitch * RAD) * dt;
    if (target > c.v) dv += (target - c.v) * (1 - exp(-dt / F.tauThrust));
    else dv += (target - c.v) * (1 - exp(-dt / (inp.brake ? F.tauBrake : F.tauBleed)));
    const v0 = c.v;
    c.v = clamp(c.v + dv, F.vMin, F.vMax);
    const vm = 0.5 * (v0 + c.v);

    // 7. move (trapezoid in speed, so height and speed trade exactly)
    const ph = c.pitch * RAD;
    c.x += sy * cos(ph) * vm * dt;
    c.y += cy * cos(ph) * vm * dt;
    c.z += sin(ph) * vm * dt;

    // 8. the soft floor, as a spring and a sideways push
    c.floor = 0;
    if (c.z < required0) {
      c.z += (required0 - c.z) * (1 - exp(-F.floorSpring * dt));
      c.floor = 1;
      if (roofHere > 0 && (gx || gy)) {
        c.x += gx * F.pushSide * dt; c.y += gy * F.pushSide * dt;
      }
      c.v = Math.max(F.vMin, c.v * (1 - 0.35 * dt));       // a scrape costs a little speed
    }
    c.t += dt;
    return c;
  }

  /** Specific energy per unit mass in this model's units: v^2/2 + G z. */
  const energy = (c, P) => 0.5 * c.v * c.v + (P || AIR).flight.gravity * c.z;
  const cloneCraft = c => Object.assign({}, c);
  return { newCraft, step, energy, cloneCraft, NO_INPUT };
});
