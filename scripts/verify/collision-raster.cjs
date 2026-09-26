/* CPU-only collision regression. Executes the production field builder and
 * query functions against synthetic footprints and the current baked scene.
 * Run from any directory: node scripts/verify/collision-raster.cjs
 * This does not replace real keyboard movement or visual verification.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {performance} = require('node:perf_hooks');
const root = path.resolve(__dirname, '../..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const json = p => JSON.parse(read(p));
const source = read('js/controls.js').replace(/\r/g, '');
const metre = 40030228.884 / 360;
function between(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, `Production extraction failed: ${start}`);
  return source.slice(a, b);
}
const buildSource = between('  let grid = null,', '  // ── The outer collision field');
const querySource = between('  function gridHeightAt(', '  // ── Derived bounds.');
// Previous coarse query retained only as a regression/cost comparator. It
// reads the production raster builder, but is not the live collision query.
const coarseQuerySource = `function gridHeightAt(lng,lat,r) {
  const ring=outerHeightIn(lng,lat,r); if(!gridBuilt)return ring;
  const mx=mLon(lat),my=M_LAT;
  const i0=Math.floor((lng-r/mx-gx0)*mx/CELL),i1=Math.floor((lng+r/mx-gx0)*mx/CELL);
  const j0=Math.floor((lat-r/my-gy0)*my/CELL),j1=Math.floor((lat+r/my-gy0)*my/CELL);
  let best=ring;
  for(let j=Math.max(0,j0);j<=Math.min(gny-1,j1);j++)
    for(let i=Math.max(0,i0);i<=Math.min(gnx-1,i1);i++)best=Math.max(best,grid[j*gnx+i]);
  return best;
}`;
const withRaster = s => s.replace(querySource,coarseQuerySource);
function field(scene, mutate = s => s) {
  const context = vm.createContext({scene, CELL: 6, FENCE_PAD: 250, ALT_GROUND: 12, alt: 2,
    M_LAT: metre, mLon: lat => metre * Math.cos(lat * Math.PI / 180),
    MODELLED: {w: -98, e: 1, s: -1, n: 31}, outerHeightIn: () => 0});
  const t = performance.now();
  vm.runInContext(mutate(buildSource + querySource) +
    '\nbuildHeightField(scene);this.at=gridHeightAt;this.stats=()=>({...coreStats});this.rebuild=buildHeightField;', context);
  context.buildMs = performance.now() - t;
  return context;
}
const ring = points => [...points, points[0]].map(([x,y]) => [x / metre, y / metre]);
const rect = (x0,y0,x1,y1) => ring([[x0,y0],[x1,y0],[x1,y1],[x0,y1]]);
const feature = (rings, height) => ({type: 'Feature', geometry: {type: 'Polygon', coordinates: rings}, properties: {final_height: height}});
const scene = features => ({buildings: {type: 'FeatureCollection', features}, parts: {features: []}});
const at = (f, x, y, radius = 0) => f.at(x / metre, y / metre, radius);

// An inclusive ceil(right crossing) adds a whole extra column. Edge stamping
// still conservatively covers the actual footprint's boundary cell.
const rectangle = scene([feature([rect(0,0,10.1,10.1)], 8)]);
const raster = field(rectangle, withRaster); raster.alt = 100;
assert.equal(at(raster, 14, 5), 0, 'No extra column beyond the right edge');
const brokenRaster = field(rectangle, s => withRaster(s).replace('Math.ceil(xsAt[s + 1]) - 1', 'Math.ceil(xsAt[s + 1])'));
brokenRaster.alt = 100;
assert.equal(at(brokenRaster, 14, 5), 8, 'Negative control reproduces extra column');

const concave = field(scene([feature([ring([[0,0],[10,0],[10,20],[30,20],[30,0],[40,0],[40,30],[0,30]])], 13)]));
assert.equal(at(concave, 20, 10, 1.8), 0, 'Concave courtyard remains open');
assert.equal(at(concave, 10.8, 10, 1), 13, 'Live radius still meets courtyard wall');
assert.equal(at(concave, 11.2, 10, 1), 0, 'Outside wall clearance remains open');
assert.equal(at(concave, 5, 10), 13, 'Solid wing is still solid');

const holes = field(scene([feature([rect(0,0,40,40), rect(10,10,30,30)], 12), feature([rect(18,18,22,22)], 7)]));
assert.equal(at(holes, 15, 15, 1), 0, 'Hole remains open');
assert.equal(at(holes, 20, 20), 7, 'Separate building inside hole is retained');
assert.equal(at(holes, 17.5, 20, 1), 7, 'Radius meets separate hole building');
assert.equal(at(holes, 10.5, 15, 1), 12, 'Hole boundary wall still blocks');

// A rotated 20 cm wall must neither vanish between raster samples nor become
// a multi-metre solid cell at walking height.
const theta = .61, rotate = ([x,y]) => [x*Math.cos(theta)-y*Math.sin(theta), x*Math.sin(theta)+y*Math.cos(theta)];
const thin = field(scene([feature([ring([[-10,-.1],[10,-.1],[10,.1],[-10,.1]].map(rotate))], 5)]));
assert.equal(at(thin, ...rotate([0,.15]), .1), 5, 'Thin rotated wall intersects radius');
assert.equal(at(thin, ...rotate([0,.25]), .1), 0, 'Thin rotated wall does not inflate');

// Low queries retain outer-city obstacles even where core geometry is absent.
holes.outerHeightIn = () => 29;
assert.equal(at(holes, 15, 15), 29, 'Outer collision remains intact');
holes.rebuild({buildings:{features:[]},parts:{features:[]}});
assert.equal(at(holes, 20, 20), 29, 'Empty rebuild clears core, keeps outer field');
assert.equal(holes.stats().polygons, 0);

const latest = json('data/manifest.json').latest;
const buildings = json(`data/snapshots/${latest}/buildings.detailed.geojson`);
const parts = json(`data/snapshots/${latest}/parts.detailed.geojson`);
buildings.features.push(...json('data/capitol.geojson').features);
parts.features.push(...json('data/capitol_parts.geojson').features);
const realScene = {buildings, parts}, real = field(realScene);
const frame = json('data/campus_buildings.json').buildings.find(b => b.code === 'GEA').frame.obb;
const ll = (u,v) => [frame.o[0]+(u*frame.ax-v*frame.ay)/frame.mx, frame.o[1]+(u*frame.ay+v*frame.ax)/frame.my];
assert.equal(real.at(...ll(23.4,4), 1.8), 0, 'Actual court false positive is removed');
assert.equal(real.at(...ll(31.76,15.95), 0), 0, 'Upper ramp point is outside solid footprint');
assert.equal(real.at(...ll(31.76,15.95), 1), 12.9, 'Upper ramp start is too near the real rear wall');
assert.equal(real.at(...ll(31.76,14.5), 1.8), 0, 'Ramp has a safe upper approach');
assert.equal(real.at(...ll(31.76,16.7), 0), 12.9, 'Rear wall remains solid');
for (let v = .5; v <= 14.5; v += .1) assert.equal(real.at(...ll(31.76,v), 1.8), 0, 'Ramp descent stays clear');

// Check the whole inferred rear crossover, including both terrace sides. Use
// the production floor index and radius blend: a raised eye has a larger probe
// than the nominal 1 m ground radius. This is a geometry gate, not a walk replay.
const groundData = json('data/campus_landscape.json');
const landscapeSource = read('js/campus-landscape.js').replace(/\r/g, '');
function groundPart(start, end) {
  const a = landscapeSource.indexOf(start), b = landscapeSource.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, `Ground extraction failed: ${start}`);
  return landscapeSource.slice(a, b);
}
function constant(name) {
  const match = source.match(new RegExp(`\\b${name} = ([0-9.]+)[,;]`));
  assert(match, `Production constant missing: ${name}`);
  return Number(match[1]);
}
const ground = vm.createContext({data: groundData, structuralGroup: {}, C: {on: true}, window: {SLOPES: {on: true}},
  ALT_GROUND: constant('ALT_GROUND'), ALT_MIN: constant('ALT_MIN'), R_CAM: constant('R_CAM'),
  R_CAM_GROUND: constant('R_CAM_GROUND'), alt: 0,
  clamp: (v,lo,hi) => Math.min(hi,Math.max(lo,v)), lerp: (a,b,t) => a+(b-a)*t});
vm.runInContext(groundPart(' const GROUND_CELL=', ' const hash=') +
  groundPart(' function inRing(', '\n function shrubs(') +
  between('  const groundMix =', '  const skinV ') +
  '\nindexGround();this.floor=floorAt;this.radius=rCam;', ground);
let maxCrossoverStep = 0, maxCrossoverRadius = 0;
for (const v of [14.6,14.65]) {
  let previousFloor = ground.floor(...ll(29.3,v));
  for (let i = 0; i <= 440; i++) {
    const point = ll(29.3+i*.01,v), floor = ground.floor(...point);
    assert(floor > 1.3 && floor <= 1.5701, 'Crossover has continuous elevated support');
    ground.alt = real.alt = floor + 1.8;
    const radius = ground.radius();
    assert.equal(real.at(...point,radius), 0, `Crossover clears true walls at v=${v}, sample=${i}`);
    maxCrossoverRadius = Math.max(maxCrossoverRadius,radius);
    maxCrossoverStep = Math.max(maxCrossoverStep,Math.abs(floor-previousFloor));
    previousFloor = floor;
  }
}
assert(maxCrossoverStep < constant('STEP_UP_GROUND'), 'Crossover level difference is within the existing step limit');
const rails = groundData.gardens.places.find(p => p.name === 'Gearing courtyard').features.filter(f => f.kind === 'raisedRail');
assert.equal(rails.length,2, 'Both ramp-side rails remain');
for (const rail of rails) for (const p of rail.line) {
  const x=(p[0]-frame.o[0])*frame.mx, y=(p[1]-frame.o[1])*frame.my;
  assert(-x*frame.ay+y*frame.ax < 14.051, 'Rails end before the rear crossover');
}

// Altitude alone cannot change footprint geometry. In particular, crossing
// the old 12 m switch must not turn a clear courtyard into an inflated roof.
const coarse = field(realScene,withRaster);
for (let u=0;u<=52;u+=2) for(let v=-4;v<=34;v+=2) for(const radius of [0,1.8,6]) {
  real.alt=2; const expected=real.at(...ll(u,v),radius);
  for(const altitude of [11.999,12,12.001,100]) {
    real.alt=altitude;
    assert.equal(real.at(...ll(u,v),radius),expected,'Core geometry is altitude invariant');
  }
}
holes.outerHeightIn=()=>0;
holes.rebuild(scene([feature([rect(0,0,40,40),rect(10,10,30,30)],12),feature([rect(18,18,22,22)],7)]));
for(const altitude of [2,11.999,12,12.001,100]) {
  concave.alt=holes.alt=thin.alt=altitude;
  assert.equal(at(concave,20,10,6),0,'Court stays open while flying');
  assert.equal(at(concave,5,10,0),13,'Solid wing remains solid while flying');
  assert.equal(at(holes,15,15,1),0,'Hole remains open while flying');
  assert.equal(at(holes,20,20,0),7,'Separate hole building remains solid while flying');
  assert.equal(at(thin,...rotate([0,.25]),.1),0,'Precise wall clearance while flying');
  assert.equal(at(thin,...rotate([0,.25]),.2),5,'Larger radius reaches thin wall');
}
for(const altitude of [2,6,11.999,12,12.001,100]) {
  ground.alt=altitude; const radius=ground.radius();
  assert(radius>=constant('R_CAM_GROUND') && radius<=constant('R_CAM'),'Live radius stays in configured bounds');
}
ground.alt=11.999; const justBelow=ground.radius();ground.alt=12.001;
assert(Math.abs(ground.radius()-justBelow)<.001,'Live radius stays continuous across 12 m');
real.alt = 3.3; coarse.alt = 3.3;
assert(coarse.at(...ll(31.76,14.5),1.8) > 0, 'Negative control: coarse raster still obstructs safe ramp');
assert.equal(real.at(...ll(31.76,14.5),1.8), 0, 'Exact query resolves residual raster obstruction');

// Deterministic result checks above are gates. These counts/timings only report
// cost; elapsed CPU time is not a portable pass/fail threshold or GPU claim.
const points=buildings.features.filter(f=>f.geometry.type==='Polygon').map(f=>f.geometry.coordinates[0][0]);
const timings=[];
for(const [altitude,radius] of [[3.37,1.8106796116504862],[100,6]]) {
  const exact=[],raster=[];
  for(let rep=0;rep<4;rep++) for(const [name,f,result] of rep%2 ? [['raster',coarse,raster],['exact',real,exact]] : [['exact',real,exact],['raster',coarse,raster]]) {
    f.alt=altitude; const t=performance.now(); let checksum=0;
    for(let i=0;i<20000;i++)checksum+=f.at(...points[i%points.length],radius);
    result.push({ms:performance.now()-t,checksum});
  }
  timings.push({altitude,radius,queries:20000,exactMinMs:Math.min(...exact.map(t=>t.ms)),rasterMinMs:Math.min(...raster.map(t=>t.ms)),exact,raster});
}
console.log(JSON.stringify({pass:true,scene:latest,core:real.stats(),buildMs:real.buildMs,
  crossover:{maxStep:maxCrossoverStep,maxRadius:maxCrossoverRadius},
  timings,
  coverage:'scanline, concave court, holes and separate buildings, rotated thin walls, real ramp and crossover, outer field, altitude invariance, radius continuity, negative controls'}, null, 2));
