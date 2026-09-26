import assert from 'node:assert/strict';
import {test} from 'node:test';
import '../../js/baked-enclosure.js';
const api=globalThis.BakedEnclosure;
const vertex='attribute float aFacet;\nif(aFacet > 0.5) {}\nv_albedo = cDay;';
const fragment='varying vec3 v_albedo;\nvec3 cityShade(vec3 original,vec3 albedo,vec3 pos,vec3 normal,float glass) { return linearColour(u_shadeColour)*(u_sunlight.y+skyFill); }\ncityShade(col/max(baseColor.a,.0001),albedo,v_pos,v_normal,glassResponse)';
function geometry(prefix=0) {
  const attrs={};
  for(const [name,size] of [['position',3],['normal',3],['aSurface',4],['aFacet',1]]) {
    const array=new (name==='aFacet'?Uint8Array:Float32Array)((3+prefix)*size);
    attrs[name]={array,count:3+prefix,itemSize:size,normalized:false};
  }
  attrs.position.array.set([0,0,0,1,0,0,0,1,0],prefix*3);
  attrs.normal.array.set([0,0,1,0,0,1,0,0,1],prefix*3);
  attrs.aSurface.array[(prefix+2)*4]=4;
  return {attributes:attrs,index:{array:new Uint32Array([prefix,prefix+1,prefix+2])}};
}
async function fixture(prefix=0) {
  const g=geometry(prefix),range={id:'arch',start:0,end:1},fp=await api.fingerprint(g,range),payload=new Uint8Array([32,64,0]);
  const manifest={version:1,encoding:'facet-low-bit-occlusion-7bit',bytes:3,targets:[{id:'arch',vertices:3,triangles:1,hashes:fp.hashes,sha256:await api.sha256(payload),offset:0,bytes:3}]};
  const mesh={geometry:g,material:{vertexShader:vertex,fragmentShader:fragment,uniforms:{sun:{value:1}}}};
  return {mesh,ranges:[range],manifest,payload};
}
test('pack, tune, release, idempotent release, repeated attach',async()=>{
  const f=await fixture(),s=api.create(),original=f.mesh.material.uniforms;
  const lease=await s.attach(f);assert(lease);assert.equal(s.state.status,'ready');
  assert.deepEqual([...f.mesh.geometry.attributes.aFacet.array],[32,64,0]);
  assert.equal(f.mesh.material.uniforms.sun,original.sun);assert.notEqual(f.mesh.material.uniforms,original);
  lease.setStrength(.2);assert.equal(f.mesh.material.uniforms.u_bakedDepth.value,.2);
  assert.throws(()=>lease.setStrength(2));lease.dispose();lease.dispose();
  assert.deepEqual([...f.mesh.geometry.attributes.aFacet.array],[0,0,0]);assert.equal(f.mesh.material.vertexShader,vertex);assert.equal(f.mesh.material.uniforms,original);
  assert(await s.attach(f));s.dispose();assert.equal(s.state.status,'disposed');assert.deepEqual([...f.mesh.geometry.attributes.aFacet.array],[0,0,0]);
});
test('building survives shifted global vertex offsets',async()=>{
  const f=await fixture(),shifted=await fixture(11);
  assert.deepEqual(f.manifest.targets[0].hashes,shifted.manifest.targets[0].hashes);
  const s=api.create();assert(await s.attach({...shifted,manifest:f.manifest}));
  assert.deepEqual([...shifted.mesh.geometry.attributes.aFacet.array.slice(0,11)],Array(11).fill(0));s.dispose();
});
for(const kind of ['position','normal','aSurface','index','facet','payload','filtered','duplicate','missing','version','oversize','shader'])test('fail open: '+kind,async()=>{
  const f=await fixture();
  if(['position','normal','aSurface'].includes(kind))f.mesh.geometry.attributes[kind].array[0]+=.1;
  if(kind==='index')f.mesh.geometry.index.array[1]=2;
  if(kind==='facet')f.mesh.geometry.attributes.aFacet.array[0]=1;
  if(kind==='payload')f.payload[0]++;
  if(kind==='filtered')f.ranges[0].filtered=true;
  if(kind==='duplicate')f.ranges.push({...f.ranges[0]});
  if(kind==='missing')f.ranges=[];
  if(kind==='version')f.manifest.version=2;
  if(kind==='oversize')f.manifest.bytes=9000000;
  if(kind==='shader')f.mesh.material.fragmentShader+='\nvarying vec3 v_albedo;';
  const before=[...f.mesh.geometry.attributes.aFacet.array],shader=f.mesh.material.fragmentShader;
  const s=api.create();assert.equal(await s.attach(f),null);assert.equal(s.state.status,'fallback');
  assert.deepEqual([...f.mesh.geometry.attributes.aFacet.array],before);assert.equal(f.mesh.material.fragmentShader,shader);s.dispose();
});
test('correctly hashed payload cannot shade glass or change facet meaning',async()=>{
  const f=await fixture();f.payload[2]=20;f.manifest.targets[0].sha256=await api.sha256(f.payload);
  assert.equal(await api.create().attach(f),null);
});
test('late network response after cancel cannot publish',async()=>{
  const f=await fixture(),s=api.create();let resolve;
  const request=new Promise(r=>resolve=r);
  const pending=s.attach({...f,payload:null,payloadURL:'/bytes',fetcher:()=>request});
  s.cancel();resolve({ok:true,headers:new Headers(),arrayBuffer:async()=>f.payload.buffer});
  assert.equal(await pending,null);assert.equal(s.state.status,'cancelled');assert.deepEqual([...f.mesh.geometry.attributes.aFacet.array],[0,0,0]);
});
test('failed network does not hold city initialization',async()=>{
  const f=await fixture(),s=api.create({timeoutMs:10});
  const fetcher=(_,opts)=>new Promise((_,reject)=>opts.signal.addEventListener('abort',()=>reject(new Error('aborted'))));
  assert.equal(await s.attach({...f,payload:null,payloadURL:'/bytes',fetcher}),null);assert.equal(s.state.status,'cancelled');
});
test('concurrent owners cannot both publish',async()=>{
  const f=await fixture(),a=api.create(),b=api.create();
  const results=await Promise.all([a.attach(f),b.attach(f)]);assert.equal(results.filter(Boolean).length,1);
  a.dispose();b.dispose();assert.deepEqual([...f.mesh.geometry.attributes.aFacet.array],[0,0,0]);
});
test('negative zero canonicalization and unsupported attribute protection',async()=>{
  const f=await fixture();f.mesh.geometry.attributes.position.array[0]=-0;
  assert(await api.create().attach(f));
  const bad=await fixture();bad.mesh.geometry.attributes.aFacet.normalized=true;assert.equal(await api.create().attach(bad),null);
});
