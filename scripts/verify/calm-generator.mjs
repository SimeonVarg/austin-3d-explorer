/** Real tileFace regression: repeated generated cells require a far representation.
 * node scripts/verify/calm-generator.mjs [--break]
 * --break removes the generator's record hook in memory; must exit nonzero.
 * No browser, no production mutation. Blades, rails, bespoke/MapLibre/roof systems excluded.
 */
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const context={console,URLSearchParams,performance,location:{search:'?slopes=0&calm=1'},setTimeout,clearTimeout,setInterval,clearInterval};
context.window=context;context.document={hidden:false,getElementById:()=>null};context.addEventListener=()=>{};
vm.createContext(context);
vm.runInContext(fs.readFileSync(new URL('../../js/calm-far.js',import.meta.url),'utf8'),context);
let source=fs.readFileSync(new URL('../../js/slopes-apartments.js',import.meta.url),'utf8');
if(process.argv.includes('--break'))source=source.replace('window.CalmFar.record(B,rec);','/* injected missing representation */');
source=source.replace('  window.slopesApartments = {','  window.__calmGeneratorTest = { tileFace };\n  window.slopesApartments = {');
vm.runInContext(source,context);
function builder(calm){
  const b={triangles:0,records:[],calmFaces:calm?[]:null};
  b.tri=(...args)=>{b.triangles++;b.records.push(args);};
  b.quad=(a,bp,c,d,col,n)=>{b.tri(a,bp,c,col,n);b.tri(a,c,d,col,n);};
  b.polygon=(p,col,n)=>{for(let i=1;i<p.length-1;i++)b.tri(p[0],p[i],p[i+1],col,n);};
  return b;
}
const wall=['#c4b396','#d8a472','#181b20'];wall.surface=[1,.8,.3,.68];
const glass=['#304d61','#915b37','#091526'];glass.surface=[4,1,1,.8];
const P={wall,glass,frame:wall};
const face={W:{N:[0,-1,0],T:[1,0,0],at:(s,d,z)=>[s,-d,z]},len:12,z0:0,z1:12};
const rows=()=>[0,3,6,9,12],cols=()=>[0,3,6,9,12];
const fixtures=[
  {rows,cols,tone:()=>wall,windows:[],reveal:.18},
  {rows,cols,tone:()=>wall,windows:Array.from({length:16},(_,i)=>({s0:i%4*3+.5,s1:i%4*3+2.5,z0:Math.floor(i/4)*3+.5,z1:Math.floor(i/4)*3+2.5,lit:i%3===0})),reveal:.18},
  {rows,cols,tone:(z,s)=>s<6?wall:glass,windows:[],reveal:0}
];
fixtures.push({...fixtures[1],rows:()=>[],cols:()=>[]});
for(const [i,skin] of fixtures.entries()){
  const main=builder(false),candidate=builder(true);
  context.__calmGeneratorTest.tileFace(main,face,skin,P);
  context.__calmGeneratorTest.tileFace(candidate,face,skin,P);
  assert.ok(candidate.calmFaces.length===1,`recipe ${i}: repeated detail missing far representation`);
  const r=candidate.calmFaces[0];
  if(i===3)assert.equal(r.period,3,'empty skin cuts still infer the repeated window bay/storey period');
  assert.equal(r.start,0);assert.equal(r.end,main.triangles*3);
  assert.deepEqual(candidate.records.slice(0,main.records.length),main.records,'near geometry unchanged');
  const full=new Uint32Array(candidate.triangles*3).map((_,k)=>k);
  const lod=context.CalmFar.indices(full,0,full.length,0,candidate.calmFaces);
  assert.deepEqual(Array.from(lod.near),Array.from(full.slice(0,main.triangles*3)),'near index stream unchanged');
  assert.ok(lod.far.length<lod.near.length,'far representation must reduce emitted detail');
  const avg=candidate.records.at(-1)[3];
  if(i===1){assert.ok(Math.abs(avg.surface[1]-64/144)<1e-9,'glass coverage is exact');assert.ok(Math.abs(avg.surface[2]-.8*64/144)<1e-9,'glass response is exact');}
}
// Composite matrix: its camera-view translation is in P, while V is identity.
// A translated building at positive world Z must have a finite pixel footprint.
const Pclip=[2,0,0,0, 0,2,0,0, 0,0,-1,-1, -20,-40,99,100];
const identity=[1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
const world=[...identity];world[12]=10;world[13]=20;world[14]=10;
const sphere=[0,0,0,2], project=context.CalmFar.projectedPeriod;
const near=project(sphere,0,1,Pclip,world,1200,800);
world[14]=-100;
const far=project(sphere,0,1,Pclip,world,1200,800);
assert.ok(Number.isFinite(near)&&near>far&&far>0,'composite projection: approaching increases projected period');
world[14]=10;
const equivalent=[10,20,10,2];
assert.ok(Math.abs(near-project(equivalent,0,1,Pclip,identity,1200,800))<1e-10,'mesh translation composes correctly');
// Bound must exceed finite-difference motion in any tested axis throughout sphere.
function screen(v){const x=v[0]+10,y=v[1]+20,z=v[2]+10,w=100-z;return [600*(2*x-20)/w,400*(2*y-40)/w];}
for(const at of [[0,0,0],[2,0,0],[0,2,0],[0,0,2],[0,0,-2]])for(let axis=0;axis<3;axis++){
  const to=[...at];to[axis]+=.00001;const a=screen(at),b=screen(to);
  assert.ok(Math.hypot(b[0]-a[0],b[1]-a[1])/.00001<=near+1e-5,'Jacobian bound covers sphere');
}
assert.equal(project([0,0,100,2],0,1,Pclip,identity,1200,800),Infinity,'sphere crossing camera plane stays detailed');
console.log('PASS: real cell tiler, 4 recipes; far material shares; identical near geometry/indices; composite camera projected-period bound. --break rejects missing emission.');
