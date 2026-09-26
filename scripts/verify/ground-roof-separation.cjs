/* Executes the production vertical resolver. Raised ground must follow steps
 * without entering rooftop smoothing; roof avoidance and free flight retain
 * their existing response. Real keyboard walking is still required. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.resolve(__dirname, '../../js/controls.js'), 'utf8').replace(/\r/g, '');
const start = source.indexOf('    // \u2500\u2500 Rooftop floor');
const end = source.indexOf('    // \u2500\u2500 Hard net:', start);
assert(start >= 0 && end > start, 'Production resolver boundaries');
const resolve = source.slice(start, end);
const constants = Object.fromEntries(['TAU_FLOOR_UP','TAU_FLOOR_DOWN','LIFT','FALL','FLOOR_LOOKAHEAD','SAFE_ALT'].map(k => {
  const match = source.match(new RegExp(`\\b${k} = ([0-9.]+)[,;]`));
  assert(match, k); return [k, Number(match[1])];
}));
function run(overrides = {}) {
  const state = vm.createContext({...constants, gridBuilt: true, eye: {lng: 0, lat: 0},
    vel: {e: 0, n: 0}, mLon: () => 1, M_LAT: 1, rCam: () => 1,
    maxHeightIn: () => 0, skinV: () => .1, stepUp: () => .45,
    groundEyeMin: () => 0, altFloorMin: () => 1.7, altCeiling: () => 1000,
    clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
    altUser: 1.8, altFloor: 0, alt: 1.8, stepFloor: 0, dt: 1 / 60, ...overrides});
  vm.runInContext(resolve, state); return state;
}
// Each tread has a direct hard floor. Restarting on a landing must not seed a
// lingering rooftop floor that leaves the pedestrian floating during descent.
for (const ground of [1.5,1.35,1.2,1.05,.9,.75,.6,.45,.3,.15,0]) {
  const s = run({groundEyeMin: () => ground > 0 ? ground + 1.7 : 0, altUser: ground + 1.8});
  assert.equal(s.altFloor, 0, 'Ground does not enter rooftop smoothing');
  assert.equal(s.alt, ground + 1.8, 'Walking clearance follows tread');
  const hard = run({groundEyeMin: () => ground + 1.7});
  assert(hard.alt >= ground + 1.7, 'Hard minimum survives an undershooting user target');
}
// Below/above the target: rooftop and obstacle step floors retain both time
// constants and rate limits. Raised ground cannot alter their smoothed value.
for (const dt of [.009,.018,.033,.064]) for (const prior of [0,2,10,40]) {
  for (const roof of [0,2,12]) for (const stepFloor of [0,2.1]) {
    const a = run({dt, altFloor: prior, altUser: 20, maxHeightIn: () => roof, stepFloor});
    const b = run({dt, altFloor: prior, altUser: 20, maxHeightIn: () => roof, stepFloor, groundEyeMin: () => 3.2});
    const want = Math.max(roof ? roof + .1 : 0, stepFloor);
    const tau = want > prior ? constants.TAU_FLOOR_UP : constants.TAU_FLOOR_DOWN;
    const change = (want - prior) * (1 - Math.exp(-dt / tau));
    const expected = prior + Math.max(-constants.FALL * dt, Math.min(constants.LIFT * dt, change));
    assert(Math.abs(a.altFloor - expected) < 1e-12, 'Rooftop/step response preserved');
    assert.equal(a.altFloor, b.altFloor, 'Ground cannot change roof smoothing');
    assert.equal(a.alt, b.alt, 'Higher free flight unchanged');
  }
}
assert.equal(run({maxHeightIn: () => 100}).altFloor, 0, 'Tall obstacle cannot lift a pedestrian over its roof');
assert.equal(run({gridBuilt: false}).altFloor, constants.SAFE_ALT, 'Missing collision grid remains fail safe');
console.log('PASS: raised-ground hard minimum, landing restart/descent, rooftop/step rise and decay, free flight, tall obstacle and collision fail safe.');
