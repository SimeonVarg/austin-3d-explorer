// Deterministic local visibility. Does not modify topology, color or material.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import * as T from 'three';
import {MeshBVH,SAH} from 'three-mesh-bvh';
const args=process.argv.slice(2),arg=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const source=arg('--source'),out=arg('--out');
assert(source&&out,'usage: --source <export directory> --out <scratch bake directory> [--radius 3] [--samples 64]');
const settings={samples:Number(arg('--samples',64)),radius:Number(arg('--radius',3)),bias:.02,strength:.8,maximumOcclusion:.8};
assert(Number.isInteger(settings.samples)&&settings.samples>=8&&settings.samples<=512);
assert(Number.isFinite(settings.radius)&&settings.radius>.02&&settings.radius<=20);
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const sourceManifest=JSON.parse(fs.readFileSync(path.join(source,'manifest.json')));
fs.mkdirSync(out,{recursive:true});
let old={targets:[]};try{old=JSON.parse(fs.readFileSync(path.join(out,'occlusion-manifest.json')))}catch{}
function visibility(bvh,p,n) {
  const up=Math.abs(n.z)<.9?new T.Vector3(0,0,1):new T.Vector3(0,1,0);
  const tangent=new T.Vector3().crossVectors(up,n).normalize(),bitangent=new T.Vector3().crossVectors(n,tangent);
  const ray=new T.Ray(p.clone().addScaledVector(n,settings.bias),new T.Vector3());let occlusion=0;
  for(let j=0;j<settings.samples;j++) {
    const u=(j+.5)/settings.samples,phi=j*2.399963229728653;
    ray.direction.copy(n).multiplyScalar(Math.sqrt(1-u)).addScaledVector(tangent,Math.sqrt(u)*Math.cos(phi)).addScaledVector(bitangent,Math.sqrt(u)*Math.sin(phi)).normalize();
    const hit=bvh.raycastFirst(ray,T.DoubleSide,0,settings.radius);
    if(hit)occlusion+=1-hit.distance/settings.radius;
  }
  return Math.round(Math.min(settings.maximumOcclusion,occlusion/settings.samples)*127);
}
const fixture=new T.PlaneGeometry(100,100);fixture.translate(0,0,1);
const testBVH=new MeshBVH(fixture);
assert.equal(visibility(testBVH,new T.Vector3(0,0,2),new T.Vector3(0,0,1)),0);
assert(visibility(testBVH,new T.Vector3(0,0,0),new T.Vector3(0,0,1))>40);fixture.dispose();
const targets=[],report={settings,baked:[],reused:[]};
for(const t of sourceManifest.targets) {
  const raw=fs.readFileSync(path.join(source,t.slug+'-geometry.json')),geometrySha256=hash(raw);
  const key=hash(JSON.stringify({geometrySha256,settings,algorithm:1,three:'0.159.0',bvh:'0.7.6'}));
  const prior=old.targets.find(p=>p.name===t.name&&p.cacheKey===key);
  if(prior&&fs.existsSync(path.join(out,prior.file))&&hash(fs.readFileSync(path.join(out,prior.file)))===prior.sha256) {
    targets.push(prior);report.reused.push(t.name);continue;
  }
  const start=performance.now(),data=JSON.parse(raw),p=new Float32Array(data.attributes.position.array),n=new Float32Array(data.attributes.normal.array);
  const sf=data.attributes.aSurface.array,fc=data.attributes.aFacet.array;
  const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.BufferAttribute(p,3));geometry.setIndex(new T.BufferAttribute(new Uint32Array(data.indices),1));
  const bvh=new MeshBVH(geometry,{strategy:SAH,maxLeafTris:8,indirect:true}),cache=new Map(),values=new Uint8Array(fc.length);
  for(let i=0;i<fc.length;i++) {
    assert(fc[i]===0||fc[i]===1);
    if(sf[i*4]>3.5&&sf[i*4]<6.5){values[i]=fc[i];continue;}
    const pos=new T.Vector3().fromArray(p,i*3),normal=new T.Vector3().fromArray(n,i*3).normalize();
    const sampleKey=[...pos.toArray(),...normal.toArray()].map(v=>Math.round(v*10000)).join(',');
    let q=cache.get(sampleKey);if(q===undefined){q=visibility(bvh,pos,normal);cache.set(sampleKey,q);}
    values[i]=fc[i]+q*2;
  }
  const file=t.slug+'-occlusion.bin';fs.writeFileSync(path.join(out,file),values);geometry.dispose();
  targets.push({...t,file,cacheKey:key,geometrySha256,sha256:hash(values),bytes:values.length});
  report.baked.push({name:t.name,seconds:(performance.now()-start)/1000});
  console.log('baked',t.name);
}
fs.writeFileSync(path.join(out,'occlusion-manifest.json'),JSON.stringify({settings,targets,sourceCommit:sourceManifest.commit,sourceHashes:sourceManifest.sources},null,2));
fs.writeFileSync(path.join(out,'bake-report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
