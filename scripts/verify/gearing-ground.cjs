/* CPU regression for explicit courtyard floors. Run: node scripts/verify/gearing-ground.cjs
 * Executes the production index and isolated control statements, not a copied
 * height formula. It does not simulate keyboard input, render a frame or prove
 * full-controller collision behavior; those require the real browser walk.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r/g, '');
const landscape = read('js/campus-landscape.js');
const controls = read('js/controls.js');
const data = JSON.parse(read('data/campus_landscape.json'));
const hall = JSON.parse(read('data/campus_buildings.json')).buildings.find(b => b.code === 'GEA');
const frame = hall.frame.obb, architecture = hall.gearingCourtParameters;
const ll = (u, v) => [frame.o[0] + (u * frame.ax - v * frame.ay) / frame.mx,
  frame.o[1] + (u * frame.ay + v * frame.ax) / frame.my];
const near = (actual, expected, message, tolerance = 1e-8) =>
  assert(Math.abs(actual - expected) < tolerance, `${message}: ${actual} vs ${expected}`);
function between(source, first, last) {
  const start = source.indexOf(first), end = source.indexOf(last, start + first.length);
  assert(start >= 0 && end > start, `Production source boundary missing: ${first}`);
  return source.slice(start, end);
}
function block(source, marker) {
  const start = source.indexOf(marker), open = source.indexOf('{', start);
  assert(start >= 0 && open > start, `Production block missing: ${marker}`);
  let depth = 1, end = open + 1;
  while (depth && end < source.length) {
    if (source[end] === '{') depth++;
    if (source[end] === '}') depth--;
    end++;
  }
  assert.equal(depth, 0, `Unclosed production block: ${marker}`);
  return source.slice(start, end);
}
function constant(name) {
  const match = controls.match(new RegExp(`\\b${name} = ([0-9.]+)[,;]`));
  assert(match, `Production constant missing: ${name}`);
  return Number(match[1]);
}
const context = vm.createContext({data, structuralGroup: {}, C: {on: true}, window: {SLOPES: {on: true}, slopesApartments: {group: {}, built: [{id: hall.id}]}}});
const run = source => vm.runInContext(source, context);
run(between(landscape, ' const GROUND_CELL=', ' const hash=') +
  between(landscape, ' function inRing(', '\n function shrubs(') +
  '\nindexGround();this.query=floorAt;this.reindex=indexGround;');
const at = (u, v) => context.query(...ll(u, v));
near(at(26, 10), 1.57, 'Raised terrace');
assert.equal(at(26, -4), 0, 'Outside remains ordinary ground');
assert.equal(at(10, 10), 0, 'Building wing is not a ground surface');

const ramp = data.ramps.find(r => r.eid === 239);
assert(ramp, 'Original accessible ramp exists');
const [a, b] = ramp.vertices, c = ramp.vertices[5], d = ramp.vertices[6];
for (let i = 1; i < 20; i++) {
  const t = i / 20;
  const p = a.map((x, j) => (x + b[j]) / 2 * (1 - t) + (c[j] + d[j]) / 2 * t);
  near(context.query(p[0], p[1]), p[2], `Ramp sample ${i}`, .0001);
}
const tread = i => ll(26.1, -2.9 + (i + .5) * .32);
for (let i = 0; i < 10; i++) near(context.query(...tread(i)), 1.57 * (i + 1) / 10, `Stair ${i + 1}`);
// Independent bakes own visible stairs and walk support. Their actual extents
// must coincide, including the outer edges, not just the centre walking line.
const uv = p => {
  const x = (p[0] - frame.o[0]) * frame.mx, y = (p[1] - frame.o[1]) * frame.my;
  return [x * frame.ax + y * frame.ay, -x * frame.ay + y * frame.ax];
};
// Other campus entrances also own floor surfaces. Count only Gearing's actual
// stair footprint; height alone would count unrelated 0.15 m Union treads.
const gearingStairs = data.walkableGround.filter(f => f.rings?.[0]?.every(p => {
  const [u, v] = uv(p);
  return u >= architecture.gateCentre - architecture.stairWidth / 2 - .001 &&
    u <= architecture.gateCentre + architecture.stairWidth / 2 + .001 &&
    v >= architecture.gateV - architecture.stairRun - .001 && v <= architecture.gateV + .001;
}));
const treads = gearingStairs.filter(f => f.height > 0 && f.height < architecture.grade);
assert.equal(treads.length, architecture.stairCount - 1, 'Stair floor count matches architecture');
for (let i = 0; i < architecture.stairCount; i++) {
  const height = architecture.grade * (i + 1) / architecture.stairCount;
  const front = architecture.gateV - architecture.stairRun + i * architecture.stairRun / architecture.stairCount;
  const candidates = gearingStairs.filter(f => Math.abs(f.height - height) < 1e-8);
  const floor = candidates.find(f => Math.abs(Math.min(...f.rings[0].map(p => uv(p)[1])) - front) < .001);
  assert(floor, `Visible tread ${i + 1} has matching walking support`);
  const points = floor.rings[0].map(uv);
  near(Math.min(...points.map(p => p[0])), architecture.gateCentre - architecture.stairWidth / 2, 'Left stair edge', .001);
  near(Math.max(...points.map(p => p[0])), architecture.gateCentre + architecture.stairWidth / 2, 'Right stair edge', .001);
  near(Math.max(...points.map(p => p[1])), front + architecture.stairRun / architecture.stairCount, 'Rear tread edge', .001);
}
context.C.on = false; near(at(26, 10), 1.57, 'Phone floor independent of planting'); context.C.on = true;
context.window.SLOPES.on = false; assert.equal(at(26, 10), 0); context.window.SLOPES.on = true;
context.structuralGroup = null; assert.equal(at(26, 10), 0); context.structuralGroup = {};
context.structuralGroup.visible = false; assert.equal(at(26, 10), 0); context.structuralGroup.visible = true;
context.window.slopesApartments.group = null; assert.equal(context.query(...tread(0)), 0);
context.window.slopesApartments.group = {}; context.window.slopesApartments.built = [{id: 'another-building'}];
assert.equal(context.query(...tread(0)), 0, 'Missing authored model has no invisible stair support');
context.window.slopesApartments.group = {}; context.window.slopesApartments.built = [{id: hall.id}];
near(context.query(...tread(0)), 1.57 / 10, 'Successful authored model activates its stair support');
context.window.slopesApartments.group.visible = false; assert.equal(context.query(...tread(0)), 0);
context.window.slopesApartments.group = null;
near(at(26, 10), 1.57, 'Visible terrace independent of authored build completion');
context.window.slopesApartments.group = {};

// Once compiled, queries must never revisit garden or source-floor arrays.
context.data = new Proxy(data, {get() { throw new Error('Floor query rescanned source data'); }});
near(at(26, 10), 1.57, 'Cached query');
assert.equal(at(100, 100), 0, 'Empty grid cell');
context.data = data;

// A synthetic floor with a hole verifies polygon semantics independently of
// this bake's particular tessellation. An overhead garden surface is ignored.
const rect = (x0, y0, x1, y1) => [[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]].map(p => ll(...p));
context.data = {walkableGround: [{height: 2, structural: true, rings: [rect(0,0,10,10), rect(3,3,7,7)]},
  {height: 50, rings: [rect(0,0,10,10)]}],
  gardens: {places: [{features: [{height: 50, rings: [rect(0,0,10,10)]}]}]}};
context.reindex(); near(at(1, 1), 2, 'Explicit synthetic floor');
assert.equal(at(5, 5), 0, 'Floor hole remains open below overhead geometry');
context.data = data; context.reindex();

Object.assign(context, {eye: {}, alt: constant('ALT_MIN'), ALT_MIN: constant('ALT_MIN'),
  STEP_UP_GROUND: constant('STEP_UP_GROUND'), GROUND_FOLLOW_MARGIN: constant('GROUND_FOLLOW_MARGIN')});
context.window.campusLandscape = {floorAt: context.query};
run(between(controls, '  const groundFloorAt =', '\n\n') +
  '\nthis.blocked=groundBlockedAt;this.minimum=groundEyeMin;');
const place = p => { context.eye.lng = p[0]; context.eye.lat = p[1]; };
place(ll(18, -1));
assert(context.blocked(...ll(18, .5)), 'Retaining edge cannot be climbed in one step');
assert(!context.blocked(...tread(0)), 'First stair is climbable');
assert(!context.blocked(...ll(26, -4)), 'Outside movement remains unblocked by ground');
for (let i = 0; i < 9; i++) {
  place(tread(i)); context.alt = context.ALT_MIN + context.query(...tread(i));
  assert(!context.blocked(...tread(i + 1)), `Stair transition ${i + 1}`);
  near(context.minimum(), context.alt, 'Eye minimum follows current floor');
}

const follow = block(controls, '    if (altUser <= groundBeforeMove');
context.altUser = context.ALT_MIN;
let prior = 0;
function followTo(p) {
  place(p); context.groundBeforeMove = prior; run(follow);
  prior = context.query(...p);
  near(context.altUser, context.ALT_MIN + prior, 'Walking clearance survives floor transition');
}
for (let i = 0; i < 10; i++) followTo(tread(i));
for (let i = 9; i >= 0; i--) followTo(tread(i));
followTo(ll(26.1, -3.5));

// Exercise the actual idle/takeover pose reader with a minimal map. Pitch zero
// keeps the fixture independent of camera placement formulas. Full movement,
// rooftop probes and stop timing remain the browser regression's responsibility.
const landing = ll(26, 10), resumedClearance = context.ALT_MIN + .1;
Object.assign(context, {map: {getCenter: () => ({lng: landing[0], lat: landing[1]}),
  getBearing: () => 0, getPitch: () => 0, getZoom: () => 0},
  clamp: (v, lo, hi) => Math.min(hi, Math.max(lo, v)), rad: v => v * Math.PI / 180,
  PITCH_MIN: 0, PITCH_MAX: 89, camPx: () => 1, mpp: () => 1.57 + resumedClearance,
  mLon: () => frame.mx, M_LAT: frame.my, vel: {e: 1, n: 1},
  pendingYaw: 1, pendingPitch: 1, wheelLogAcc: 1, touchLogAcc: 1});
run(block(controls, '  function syncFromMap(') + '\nthis.sync=syncFromMap;');
context.sync(false);
assert.equal(context.vel.e, 0); assert.equal(context.vel.n, 0);
assert.equal(context.pendingYaw, 0); near(context.altUser, 1.57 + resumedClearance, 'Idle landing altitude');
context.pendingYaw = 2; context.sync(true);
assert.equal(context.pendingYaw, 2, 'Takeover retains first input');
context.groundBeforeMove = 1.57; place(tread(8)); run(follow);
near(context.altUser, context.query(...tread(8)) + resumedClearance, 'Takeover continues following descending floor');
context.altUser = 20; context.groundBeforeMove = 0; place(ll(26, 10)); run(follow);
assert.equal(context.altUser, 20, 'High free flight retains absolute altitude');

console.log('PASS: indexed floors, ramp plane, ten stairs, holes, visibility, cached queries, retaining edge, isolated rise/descent and idle/takeover statements. Browser walking remains required.');
