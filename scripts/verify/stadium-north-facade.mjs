import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

// Capture actual renderer faces, then probe their geometry without a browser.
const source = fs.readFileSync(new URL('../../js/slopes-stadium.js', import.meta.url), 'utf8');
const slice = (start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `missing renderer boundary: ${start}`);
  return source.slice(a, b);
};
const context = vm.createContext({ window: { THREE: {
  Vector2: class { constructor(x,y) { this.x=x; this.y=y; } },
  // All slabs in this focused pass have convex rectangular plans. Collision
  // bookkeeping is irrelevant here; capture the actual polygon faces below.
  ShapeUtils: { triangulateShape: () => [[0,1,2],[0,2,3]] },
}}, location: { search: '' }, URLSearchParams });
vm.runInContext(slice('  const TUNE =', '  let data,') + `
const up=[0,0,1], east=[1,0], north=[0,1];
const lerp=(a,b,t)=>a+(b-a)*t, point=p=>p, colour=k=>k;
const collisionTri=()=>{};
` + slice('  function quad(', '  function sectionPoint(') +
slice('  function northFacade(', '  function officeTower(') +
'globalThis.api={TUNE,northFacade,northEntrance};', context);
const { api } = context;
if (process.argv.includes('--break')) api.TUNE.north.depth = 0;
if (process.argv.includes('--break-piers')) api.TUNE.north.pierDepth = api.TUNE.north.depth;
function collector() {
  return { faces: [], quad(a,b,c,d,key) { this.faces.push({p:[a,b,c,d],key}); },
    polygon(p,key) { this.faces.push({p,key}); } };
}
const height=31, facade=collector(), rails=collector(), entry=collector();
api.northFacade(facade,rails,[0,0],[34,0],height,[0,1]);
api.northEntrance(entry,collector(),height);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
for (const mesh of [facade,rails,entry]) for (const {p} of mesh.faces) {
  assert.ok(p.every(v=>v.length===3 && v.every(Number.isFinite)), 'finite vertices');
  assert.ok(p.every(v=>v[2]>=-1e-8 && v[2]<=height+1e-8), 'preserve 31m envelope');
  for(let i=1;i<p.length-1;i++) assert.ok(Math.hypot(...cross(sub(p[i],p[0]),sub(p[i+1],p[0])))>1e-9,
    'no degenerate triangles');
}
// Intersect an inward horizontal ray with actual faces. Using projected
// barycentrics also catches an accidentally restored front glass/wall plane.
function hits(mesh,x,z,directionX=0) {
  const out=[];
  for(const {p,key} of mesh.faces) for(let i=1;i<p.length-1;i++) {
    // Shear into ray space: x grows by directionX for each metre inward
    // (-y), so x + directionX*y is constant along the probe ray.
    const [a,b,c]=[p[0],p[i],p[i+1]].map(v=>[v[0]+directionX*v[1],v[1],v[2]]);
    const den=(b[2]-c[2])*(a[0]-c[0])+(c[0]-b[0])*(a[2]-c[2]);
    if(Math.abs(den)<1e-10) continue;
    const u=((b[2]-c[2])*(x-c[0])+(c[0]-b[0])*(z-c[2]))/den;
    const v=((c[2]-a[2])*(x-c[0])+(a[0]-c[0])*(z-c[2]))/den,w=1-u-v;
    if(Math.min(u,v,w)>=-1e-8) out.push({y:u*a[1]+v*b[1]+w*c[1],key});
  }
  return out.sort((a,b)=>b.y-a.y);
}
const near=(a,b,msg)=>assert.ok(Math.abs(a-b)<1e-7,`${msg}: ${a} vs ${b}`);
for(const x of [4.25,12.75,21.25,29.75]) for(const z of [3,10,17,24]) {
  const first=hits(facade,x,z)[0];
  assert.ok(first && first.key==='riser' && first.y<=-3,
    'lower gallery openings must expose a rear wall at least 3m behind the facade');
}
for(const directionX of [-1.6,1.6]) {
  const first=hits(facade,12.75,10,directionX)[0];
  assert.ok(first && first.key==='riser' && first.y<=-3,
    'oblique gallery views must reach the rear wall, not full-depth brick partitions');
}
assert.ok(facade.faces.filter(f=>f.key==='glass').every(f=>f.p.every(p=>p[2]>27)),
  'glazing belongs only in the top register');
assert.equal(hits(facade,3.6,29)[0].key,'glass','top register stays glazed');
assert.equal(hits(facade,8.5,10)[0].key,'brick','substantial dividing brick piers');
assert.ok(rails.faces.length>0 && rails.faces.every(f=>f.p.every(p=>p[1]<-0.6)),
  'gallery rails are real recessed geometry');
assert.ok(facade.faces.some(f=>f.key==='concrete' &&
  Math.max(...f.p.map(p=>p[1]))-Math.min(...f.p.map(p=>p[1]))>=3),
  'gallery slabs span a meaningful depth');
const e=api.TUNE.north.entrance;
const opening=hits(entry,0,10)[0];
assert.equal(opening.key,'brick');
near(opening.y,e.front-e.entryDepth,'entry remains deeply recessed below bridge');
const bridge=hits(entry,0.7,25)[0];
assert.equal(bridge.key,'glass');
near(bridge.y,e.front-e.bridgeSetback,'raised bridge projects ahead of entrance recess');
for(const sign of [-1,1]) {
  const shaft=hits(entry,sign*e.shaftX+0.4,10)[0];
  assert.equal(shaft.key,'glass','each shaft has narrow recessed vertical glazing');
  near(shaft.y,e.front-api.TUNE.north.glassRecess,'shaft glass recess');
  assert.equal(hits(entry,sign*e.shaftX+3,10)[0].key,'brick','solid flanking shaft masonry');
}
console.log('PASS: north galleries have open fronts, deep slabs and recessed rails; glazed top, paired masonry shafts and raised bridge remain inside the existing height envelope');
