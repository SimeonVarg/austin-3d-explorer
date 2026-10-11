// Exercise the real culling functions with controlled camera/chunk positions.
// No browser required. The private photo pass also retains real Mac before/after frames.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const functionSource = (source, name) => {
  const start = source.indexOf(`  function ${name}(`);
  assert(start >= 0, `Missing production function ${name}`);
  const body = source.indexOf('{', start);
  let depth = 1, end = body + 1;
  while (depth && end < source.length) { if (source[end] === '{') depth++; if (source[end] === '}') depth--; end++; }
  assert.equal(depth, 0);
  return source.slice(start, end);
};
let checks = 0;
for (const module of ['homes', 'trees']) {
  const source = fs.readFileSync(new URL(`../../js/outer-${module}.js`, import.meta.url), 'utf8');
  const setting = key => Number(source.match(new RegExp(`${key}:\\s*([\\d.]+)`))?.[1]);
  const H = {walkPitch: setting('walkPitch'), walkHeight: setting('walkHeight'), walkRadius: setting('walkRadius'), nearMetres: 900, farMetres: 3000, hysteresis: 120};
  assert.equal(H.walkRadius, 650, 'Walking range must not silently expand');
  assert.equal(H.walkHeight, 15);
  const camera = {pitch: 88, x: 0, y: 0, z: 1.6};
  const S = {toLocal: (x,y,z) => ({x,y,z})};
  const map = {getPitch: () => camera.pitch, getCenter: () => ({lng: 3000, lat: 0}),
    getFreeCameraOptions: () => ({position: {toLngLat: () => ({lng: camera.x,lat: camera.y}), toAltitude: () => camera.z}})};
  const mesh = x => ({visible: true, geometry: {}, userData: {total: 10, firsts: Array.from({length:11},(_,i)=>i), centre:[x,0], radius:0, triangles: 1}});
  const chunks = [mesh(0), mesh(3000)];
  if (module === 'trees') for (const chunk of chunks) chunk.userData.set = {near:mesh(0),far:mesh(0),horizon:mesh(0)};
  const context = vm.createContext({window:{slopes:S}, OUTER_HOMES:H, OUTER_TREES:H,
    _group:{children:chunks}, _map:map, _mat:{uniforms:{u_eye:{value:camera}}},
    densityNow:()=>1, _lastDensity:null, _lastKey:null, count:{}});
  vm.runInContext(functionSource(source,'walkingEye')+'\n'+functionSource(source,'update'), context);
  const update = () => vm.runInContext('update(true)',context);
  const drawn = () => module === 'homes' ? chunks.map(c=>c.geometry.instanceCount) : chunks.map(c=>Object.values(c.userData.set).filter(m=>m.visible).reduce((n,m)=>n+m.geometry.instanceCount,0));
  update(); assert.deepEqual(drawn(),[10,0], `${module}: street draws around eye, not distant map centre`);checks++;
  camera.z=96;update();assert.deepEqual(drawn(),[10,10],`${module}: rooftop restores nearby and distant chunks`);checks++;
  camera.z=H.walkHeight;update();assert.deepEqual(drawn(),[10,0],`${module}: walking height boundary`);checks++;
  camera.z=H.walkHeight+.001;update();assert.deepEqual(drawn(),[10,10],`${module}: above walking height`);checks++;
  camera.z=1.6;camera.pitch=H.walkPitch;update();assert.deepEqual(drawn(),[10,10],`${module}: pitch boundary`);checks++;
  camera.pitch=88;camera.x=H.walkRadius;update();assert.equal(drawn()[0],10,`${module}: inclusive radius boundary`);checks++;
  camera.x=H.walkRadius+.001;update();assert.equal(drawn()[0],0,`${module}: outside radius`);checks++;
  camera.x=0;camera.z=NaN;assert.equal(vm.runInContext('walkingEye(_map, window.slopes, OUTER_HOMES)',context),null,`${module}: invalid pose cannot hide chunks`);checks++;
}
console.log(`PASS ${checks} real-function culling cases: street, rooftop, height, pitch, radius, invalid pose`);
