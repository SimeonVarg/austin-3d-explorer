/**
 * params.js — every number that decides how Air Race FEELS, in one object.
 *
 * Overrule any of it in one line, live: `AIR.flight.vCruise = 70`. Nothing in
 * js/air/*.js hides a taste constant in a function body (CLAUDE.md rule 11).
 * Units: metres, seconds, degrees. The spec is docs/air-race.md.
 *
 * Plain script AND node module (scripts/verify/air-*.mjs require it), so it
 * touches no DOM and no MapLibre.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AIR = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const AIR = {
    // ── The world the sim lives in ────────────────────────────────────
    // Local metres: x east, y north, z up (above the flat ground; the app has
    // terrain off, so ground is 0 everywhere). One origin for everything, the
    // UT Tower, so a gate, a ghost sample and the craft share one frame.
    origin: { lng: -97.73939, lat: 30.28601 },
    mPerDegLat: 111195.08,           // 2*PI*6371008.8/360, same as js/controls.js

    // ── Fixed-step simulation ─────────────────────────────────────────
    stepHz: 120,                     // the sim step; the same inputs give the same flight anywhere
    maxFrameS: 0.1,                  // a long frame (tab switch, tile stall) is clipped, not replayed

    // ── Flight model ──────────────────────────────────────────────────
    flight: {
      vCruise: 62, vBoost: 98, vBrake: 34,   // speed targets, m/s
      vMin: 24, vMax: 135,                   // hard limits (no stall; a dive tops out)
      tauThrust: 1.5,                        // s, speed -> a target ABOVE it
      tauBrake: 0.9,                         // s, speed -> a target BELOW it
      tauBleed: 3.5,                         // s, speed above the target decays back
      gravity: 12,                           // m/s^2 a 90 degree dive adds (arcade; real is 9.8)
      rollMax: 62,                           // deg of bank at full stick
      tauRoll: 0.18,                         // s, bank follows the stick
      yawRateMax: 38,                        // deg/s at full bank at vRef
      vRef: 62,                              // yaw rate is scaled (vRef/v)^yawSpeedExp
      yawSpeedExp: 0.35,
      pitchRate: 55,                         // deg/s at full stick
      pitchUp: 45, pitchDown: 60,            // limits, deg
      tauLevel: 1.2,                         // s, pitch returns to level with no stick
      tauStick: 0.10,                        // s, stick smoothing (a key is 0/1; this makes it analogue)
      // The soft floor. Never a crash: a spring up and a push sideways.
      clearGround: 22,                       // m above the ground (tree height + a little)
      clearRoof: 14,                         // m above any roof inside the probe
      probeRadius: 14,                       // m, how wide the craft "feels" the roofs
      lookAheadS: 1.4,                       // s, how far ahead it feels them
      floorSpring: 6.0,                      // 1/s, how fast it lifts out of the margin
      pushSide: 26,                          // m/s, sideways push when a roof is above the craft
      floorPitchAssist: 28,                  // deg/s of automatic nose-up when the floor is close ahead
    },

    // ── The camera ────────────────────────────────────────────────────
    camera: {
      back: 24, up: 7,                       // m behind and above the craft (at cruise)
      backBoost: 8,                          // extra m back at top boost (speed feel)
      tauPos: 0.12,                          // s, position lag
      tauYaw: 0.16,                          // s, heading lag
      tauPitch: 0.30,                        // s, pitch lag
      bankFollow: 0.40,                      // the camera rolls this share of the craft's bank
      lookAheadM: 70,                        // m, the camera looks at a point this far ahead of the craft
      fovBase: 58, fovMax: 70,               // vertical FOV, deg, at cruise / at vMax
      pitchMin: 4, pitchMax: 82,             // MapLibre pitch limits for the chase (deg from straight down)
      maxPitchMap: 88,                       // app.js passes maxPitch 88
    },

    // ── Gates, timer, penalties ───────────────────────────────────────
    gates: {
      margin: 12,                            // m of clear air round every ring (placement test)
      tubeRadius: 1.6,                       // m, the ring's tube
      hitSlack: 2.0,                         // m, a craft this far outside the inner radius still counts
      showAhead: 3,                          // how many gates ahead are drawn at full strength
    },
    penaltyS: 3.0,                           // s added for a missed gate
    countdownS: 3,                           // 3-2-1
    startHoldS: 0.0,                         // seconds the craft is held at the start after "go"

    // ── Ghost / share link ────────────────────────────────────────────
    ghost: {
      hz: 5,                                 // samples a second
      quantM: 1.0,                           // m, residual step
      maxLinkChars: 2000,
      maxPathErrorM: 1.5,                    // the round-trip test's stated bound (vs the true path)
    },

    // ── Autopilot (the house ghost and the recorded clip) ─────────────
    autopilot: {
      lookAheadS: 1.15,                      // s of flight ahead to aim at
      aimBeyondGateM: 90,                    // m past the ring centre, along its axis
      yawGain: 1.25, pitchGain: 1.4,         // stick per radian of error
      boostAligned: 12,                      // boost when yaw error < this many deg
      brakeYawErr: 55,                       // brake when the turn needed is bigger than this (deg)
      boostMaxTurn: 40,                      // no boost when the turn after the next gate is bigger than this (deg)
      brakeTurn: 50,                         // brake to cruise before a turn this big...
      brakeLeadS: 3.0,                       // ...starting this many seconds out
      skill: 1.0,                            // 1 = the racing line; the house time uses AIR.house.skill
    },
    house: { skill: 0.92 },

    // ── Look ──────────────────────────────────────────────────────────
    look: {
      gateColour: '#ffb347', gateNextColour: '#7df9ff', gateDoneColour: '#4a5568',
      gateMissColour: '#ff4d6d', ghostColour: '#9be564',
      nightGlow: 2.2,                        // emissive multiplier at night
      lineToNext: true,                      // a guide line from the craft to the next ring
      windStreaks: true,                     // a few cheap line streaks at speed
      streakCount: 36,
    },

    // ── The air graphics budget (js/air/budget.js reads this) ─────────
    budget: {
      renderScale: 1.0,                      // 0.75 on integrated / phone
      // Modules air.html does not load at all are listed in air.html itself;
      // these are the URL flags the shared modules already honour.
      flags: { intro: '0', drift: '0', finder: '0', campuslandscape: '0', walk: '0' },
    },
  };
  return AIR;
});
