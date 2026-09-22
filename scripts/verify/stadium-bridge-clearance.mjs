import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

let source=fs.readFileSync(new URL('../../js/slopes-stadium.js',import.meta.url),'utf8');
if(process.argv.includes('--break'))source=source.replace('if(eyeAltitude<clearance-TUNE.collisionMargin)continue;','');
const extract=(text,start,end)=>{
  const a=text.indexOf(start),b=text.indexOf(end,a);
  assert.ok(a>=0&&b>a,`missing source boundary: ${start}`);
  return text.slice(a,b);
};
const slice=(start,end)=>extract(source,start,end);
const data=JSON.parse(fs.readFileSync(new URL('../../data/stadium.mesh.json',import.meta.url),'utf8'));
const ctx=vm.createContext({data,URLSearchParams,location:{search:''},window:{THREE:{
  Vector2:class{constructor(x,y){this.x=x;this.y=y;}},
  // Every slab emitted by northEntrance is a convex rectangle.
  ShapeUtils:{triangulateShape:()=>[[0,1,2],[0,2,3]]},
}}});
vm.runInContext(slice('  const TUNE =','  let data,')+`
const collision=new Map(),up=[0,0,1],east=[1,0],north=[0,1];
let group={},filtered=true;
const point=p=>p,colour=k=>k,lerp=(a,b,t)=>a+(b-a)*t;
`+slice('  function ll(','  const point =')+
slice('  function collisionTri(','  function sectionPoint(')+
slice('  function northEntrance(','  function officeTower(')+
slice('  function heightAt(','  window.slopesStadium=')+`
globalThis.api={TUNE,ll,heightAt,northEntrance,box,
  enable(on){group=on?{}:null;},filter(on){filtered=on;}};`,ctx);
const {api}=ctx,B={quad(){},polygon(){}},height=31;
api.northEntrance(B,B,height);
const e=api.TUNE.north.entrance,underside=height*e.bridgeBaseShare,roof=height*e.bridgeTopShare;
const at=(x,y,alt)=>api.heightAt(...api.ll(x,y),alt);
const near=(a,b,msg)=>assert.ok(Math.abs(a-b)<1e-7,`${msg}: ${a} vs ${b}`);
for(const x of [-10,0,10])for(const y of [124.4,127,131]){
  near(at(x,y,1.7),0,'walking approach passes below bridge');
  near(at(x,y,underside-api.TUNE.collisionMargin-0.01),0,'clearance below underside');
  near(at(x,y,underside),roof,'bridge volume blocks at underside');
  near(at(x,y,roof+1.7),roof,'rooftop collision remains');
  near(at(x,y),roof,'default query retains highest surface');
}
near(at(0,131,underside-api.TUNE.collisionMargin+0.01),roof,'clearance margin blocks');
near(at(0,124.2,1.7),height,'actual recessed rear wall stops walkers');
near(at(e.shaftX,131,1.7),height,'adjacent stair shaft stays solid');
api.box(B,70,130,2,2,5,9,'stone');
near(at(70,130,1.7),9,'untagged elevated slabs remain solid');
near(at(0,134,1.7),0,'outside bridge remains clear');
api.enable(false);assert.equal(at(0,131,1.7),undefined,'disabled mesh relinquishes collision');
api.enable(true);api.filter(false);assert.equal(at(0,131),undefined,'unfiltered mesh relinquishes collision');

// Exercise the actual controls query, including center and all footprint samples.
const controls=fs.readFileSync(new URL('../../js/controls.js',import.meta.url),'utf8');
const calls=[],controlCtx=vm.createContext({window:{slopesStadium:{heightAt(...args){calls.push(args);return 0;}}}});
vm.runInContext(`let alt=1.7;const rCam=()=>0.5,mLon=()=>111320,M_LAT=111320;
`+extract(controls,'  function maxHeightIn(','  function gridHeightAt(')+
'globalThis.query=maxHeightIn;globalThis.setAltitude=a=>alt=a;',controlCtx);
for(const altitude of [1.7,roof+1.7]){
  calls.length=0;controlCtx.setAltitude(altitude);controlCtx.query(...api.ll(0,131));
  assert.equal(calls.length,10,'center eligibility plus nine footprint queries');
  assert.ok(calls.every(args=>args[2]===altitude),'all controls samples pass current eye altitude');
}
console.log('PASS: north bridge admits ground approach, retains bridge/roof and rear-wall collision; ordinary surfaces/defaults and controls altitude forwarding remain intact');
