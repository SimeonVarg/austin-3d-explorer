// Runs the actual app region, not a parallel copy of the near-plane algorithm.
// Usage: node roof-near-plane.mjs [app.js] [Union recipe]
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const appPath=process.argv[2] || new URL('../../js/app.js',import.meta.url);
const unionPath=process.argv[3] || new URL('../../data/apartments/union-on-24th.json',import.meta.url);
const source=fs.readFileSync(appPath,'utf8');
const begin=source.indexOf('  const WALK_NEAR ='),end=source.indexOf('  // ?p=0.32',begin);
assert.ok(begin>=0&&end>begin,'production near-plane region found');
const appWindow={};
const {installWalkingNearPlane,roofSurfaceClearance}=new Function('window',source.slice(begin,end)+'\nreturn {installWalkingNearPlane,roofSurfaceClearance};')(appWindow);
class Transform {
 constructor(alt=96,lng=0,lat=0){this.alt=alt;this.eye={lng,lat};this.elevation=0;this._helper={autoCalculateNearFarZ:true,_pixelPerMeter:2,_nearZ:72,_farZ:6000};this.defNear=72;this.defFar=6000;}
 _calculateNearFarZIfNeeded(){this.calls=(this.calls||0)+1;if(this._helper?.autoCalculateNearFarZ){this._helper._nearZ=this.defNear;this._helper._farZ=this.defFar;}}
 getCameraAltitude(){return this.alt;}
 getCameraLngLat(){return this.eye;}
 step(){this._calculateNearFarZIfNeeded(999,.8,{});return this._helper._nearZ/this._helper._pixelPerMeter;}
}
const t=new Transform();assert.equal(installWalkingNearPlane({transform:t}),true);const patched=Transform.prototype._calculateNearFarZIfNeeded;
assert.equal(installWalkingNearPlane({transform:t}),true);assert.equal(Transform.prototype._calculateNearFarZIfNeeded,patched);
const spec={name:'fixture',footprint:{ring:[[-.01,-.01],[.01,-.01],[.01,.01],[-.01,.01],[-.01,-.01]]},blocks:[]};
let built=true,uv=[5,5];appWindow.slopesApartments={data:{buildings:[spec]},lngLatToUV(){return built?uv:null;}};
const block=(z0,z1,plan=[0,10,0,10])=>({z0,z1,plan});
// Existing pavement behavior remains bit-for-bit, independent of rooftop data.
for(const alt of [1.7,2,8,20,39.999]){t.alt=alt;const x=(alt-2)/38,u=x<=0?0:x>=1?1:x*x*(3-2*x);const expected=36*Math.pow(.12/36,1-u);assert.equal(t.step(),expected);assert.equal(t._helper._farZ,6000);}
// The pavilion roof above the eye must not hide its lower walking surface.
t.alt=96;spec.blocks=[block(0,94.38),block(98.38,98.93)];assert.ok(Math.abs(roofSurfaceClearance(t,96)-1.62)<1e-9);assert.equal(t.step(),1);assert.equal(t._helper._farZ,6000);
// Ceiling alone also counts, without replacing or freezing the far plane.
spec.blocks=[block(98,99)];assert.equal(t.step(),1);t.defFar=12000;t.step();assert.equal(t._helper._farZ,12000);
// No invented floor at the base of a volume containing the eye.
spec.blocks=[block(80,120)];assert.equal(t.step(),36);
// A lightwell's center has no roof, but a nearby actual edge can activate.
spec.blocks=[block(0,94,{ring:[0,20,0,20],holes:[[4,16,4,16]]})];uv=[10,10];assert.equal(t.step(),36);uv=[4.5,10];assert.equal(t.step(),1);
// A polygon, footprint plan, and a camera just outside its edge work as well.
spec.blocks=[block(0,94,[[0,0],[10,0],[10,10],[0,10]])];uv=[-1,5];assert.equal(t.step(),1);uv=[-3,5];assert.equal(t.step(),36);
spec.blocks=[block(0,94,'footprint')];uv=[0,0];appWindow.slopesApartments.lngLatToUV=(name,lng,lat)=>[lng*1000,lat*1000];assert.equal(t.step(),1);
appWindow.slopesApartments.lngLatToUV=()=>built?uv:null;uv=[5,5];spec.blocks=[block(0,94)];
// The default intro and high flight are untouched; no global altitude ceiling change.
for(const alt of [113.9,162.9,400]){t.alt=alt;assert.equal(t.step(),36);assert.equal(t._helper._farZ,12000);}
t.alt=100;assert.ok(t.step()>1&&t.step()<36);t.alt=102;assert.equal(t.step(),36);
// Clones use THEIR transform position and altitude, not the installed map's eye.
const clone=new Transform(96,1,1);assert.equal(clone.step(),36);clone.eye={lng:0,lat:0};assert.equal(clone.step(),1);assert.equal(clone.calls,2);
// A replacement class receives the patch; no map-instance/closure dependence.
class Replacement {
 constructor(){Object.assign(this,new Transform());}
 _calculateNearFarZIfNeeded(){this.calls=(this.calls||0)+1;this._helper._nearZ=this.defNear;this._helper._farZ=this.defFar;}
 getCameraAltitude(){return this.alt;} getCameraLngLat(){return this.eye;}
 step(){return Transform.prototype.step.call(this);}
}
const replacement=new Replacement();assert.equal(installWalkingNearPlane({transform:replacement}),true);assert.equal(replacement.step(),1);
// External ownership, already-near values, missing data and invalid numbers fail safe.
t.alt=96;t._helper.autoCalculateNearFarZ=false;t._helper._nearZ=11;t._helper._farZ=22;t.step();assert.deepEqual([t._helper._nearZ,t._helper._farZ],[11,22]);t._helper.autoCalculateNearFarZ=true;
t.defNear=1;assert.equal(t.step(),.5);t.defNear=72;
for(const alt of [NaN,Infinity,-Infinity]){t.alt=alt;assert.equal(t.step(),36);}t.alt=96;
for(const ppm of [NaN,Infinity,0,-1]){t._helper._pixelPerMeter=ppm;t.step();assert.equal(t._helper._nearZ,72);}t._helper._pixelPerMeter=2;
t.eye={lng:NaN,lat:0};assert.equal(t.step(),36);t.eye={lng:0,lat:0};built=false;assert.equal(t.step(),36);built=true;
spec.blocks=[block(NaN,94),block(0,NaN)];assert.equal(t.step(),36);
spec.blocks=[block(0,94,{ring:[0,20,0,20],holes:[[[NaN,0],[1,1],[2,0]]]})];assert.equal(t.step(),36);
spec.blocks=[block(0,94)];t.elevation=NaN;assert.equal(t.step(),36);t.elevation=0;
const oldNear=appWindow.__walkNear.NEAR_M;t.alt=2;appWindow.__walkNear.NEAR_M=-1;assert.equal(t.step(),36);appWindow.__walkNear.NEAR_M=oldNear;t.alt=96;
appWindow.slopesApartments.data=null;assert.equal(t.step(),36);
// Real Union data, with the actual coordinate API contract and pavilion/floor.
const union=JSON.parse(fs.readFileSync(unionPath,'utf8'));
const apartmentSource=fs.readFileSync(resolve(dirname(typeof unionPath==='string'?unionPath:fileURLToPath(unionPath)),'../../js/slopes-apartments.js'),'utf8');
const obbStart=apartmentSource.indexOf('  function obbOf('),obbEnd=apartmentSource.indexOf('\n  /**',obbStart);
const obb=new Function('mLon','M_LAT',apartmentSource.slice(obbStart,obbEnd)+';return obbOf;')(lat=>111320*Math.cos(lat*Math.PI/180),110540);
const f=union.frame?.obb || obb(union.footprint.ring);
const ll=(u,v)=>({lng:f.o[0]+(u*f.ax-v*f.ay)/f.mx,lat:f.o[1]+(u*f.ay+v*f.ax)/f.my});
appWindow.slopesApartments={data:{buildings:[union]},lngLatToUV(name,lng,lat){const x=(lng-f.o[0])*f.mx,y=(lat-f.o[1])*f.my;return [x*f.ax+y*f.ay,-x*f.ay+y*f.ax];}};
t.eye=ll(30,25);t.alt=96;assert.equal(t.step(),1);assert.ok(Math.abs(roofSurfaceClearance(t,96)-1.56)<.001);
t.alt=162.9;assert.equal(t.step(),36);
console.log('PASS actual app near-plane: ground compatibility, real Union floor under canopy, polygon/holes/edges, cloned/replaced transforms, unchanged intro/far, external override and invalid inputs. No GPU or visual acceptance claimed.');
