// Offline trial receipt: triangle / vertex counts, packed streams and file / lookup memory.
// Compares DKR with local origin/main (#530); other trial tiles with HEAD (#531). No network or browser.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { NodeIO, Logger } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const io=new NodeIO().setLogger(new Logger(Logger.Verbosity.ERROR)).registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder});
const slugs=['t_-1_-4','t_1_3','t_2_0','t_3_2'];
function geometry(d) {
  let triangles=0,vertices=0,attributes=0,buildingBytes=0;
  for(const m of d.getRoot().listMeshes())for(const p of m.listPrimitives()) {
    triangles+=(p.getIndices()?.getCount()||p.getAttribute('POSITION').getCount())/3;
    vertices+=p.getAttribute('POSITION').getCount();
    for(const a of p.listAttributes())attributes+=a.getArray().byteLength;
    const b=p.getAttribute('_FINE')||p.getAttribute('_BUILDING');buildingBytes+=b?.getArray().byteLength||0;
  }
  return {triangles,vertices,attributeBytes:attributes,buildingBytes};
}
const vertexViews = bytes => {
  const json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
  return json.bufferViews.filter(v=>v.target===34962).reduce((n,v)=>n+v.byteLength,0);
};
function buildingCounts(d) {
  const counts={};
  for(const m of d.getRoot().listMeshes())for(const p of m.listPrimitives()) {
    const b=p.getAttribute('_FINE')||p.getAttribute('_BUILDING'),I=p.getIndices();
    for(let i=0;i<b.getCount();i++) {const id=b.getElement(i,[])[0];(counts[id] ||= [0,0])[0]++;}
    for(let i=0;i<(I?.getCount()||b.getCount());i+=3) {
      const ids=[0,1,2].map(k=>b.getElement(I?I.getScalar(i+k):i+k,[])[0]);
      assert(ids.every(id=>id===ids[0]),'triangle crosses building IDs');counts[ids[0]][1]++;
    }
  }
  return counts;
}
const rows=[];
for(const slug of slugs) {
  const file=`v2/tiles/${slug}.glb`,ref=slug==='t_2_0'?'origin/main':'HEAD';
  const before=execFileSync('git',['show',`${ref}:${file}`],{maxBuffer:1<<28}),after=fs.readFileSync(file);
  assert.equal(vertexViews(after),vertexViews(before),slug+' changed decoded GPU vertex views');
  const old=await io.readBinary(before),doc=await io.readBinary(after),a=geometry(old),b=geometry(doc);
  assert.deepEqual(buildingCounts(doc),buildingCounts(old),slug+' changed building IDs');
  assert.equal(b.triangles,a.triangles,`${slug} changed triangle counts vs ${ref}`);
  assert.equal(b.vertices,a.vertices,`${slug} changed vertex counts vs ${ref}`);
  assert.equal(b.buildingBytes,b.vertices*4);
  assert.equal(b.attributeBytes,a.attributeBytes,`${slug} grew vertex memory`);
  for(const m of doc.getRoot().listMeshes())for(const p of m.listPrimitives()) {
    assert(!p.getAttribute('_BUILDING'),slug+' still has the old stream');const f=p.getAttribute('_FINE');assert(f);assert.equal(f.getType(),'VEC4');assert.equal(f.getComponentType(),5121);assert.equal(f.getNormalized(),false);
  }
  // A detached old building accessor would still waste the promised four bytes in the file.
  assert(!doc.getRoot().listAccessors().some(a=>a.listParents().every(p=>p.propertyType==='Root')),'orphan accessor');
  const fine=doc.getRoot().getExtras().fine;assert.equal(fine.version,2);
  const table=Buffer.from(fine.table,'base64');assert.equal(table.length,fine.count*12);
  for(const m of doc.getRoot().listMeshes())for(const p of m.listPrimitives()) {
    const f=p.getAttribute('_FINE');for(let i=0;i<f.getCount();i++) {const v=f.getElement(i,[]);assert(v[0]<doc.getRoot().getExtras().buildings.length);if(v[1])assert(v[2]+v[3]*256<fine.count);}
  }
  rows.push({tile:slug,baseline:ref,...b,decodedVertexBytes:vertexViews(after),oldBytes:before.length,newBytes:after.length,deltaBytes:after.length-before.length,oldGzip:gzipSync(before).length,newGzip:gzipSync(after).length,patches:fine.count,lookupBytes:1024*Math.ceil(fine.count*2/1024)*8});
}
console.log(JSON.stringify(rows,null,2));
console.log('PASS trial triangle/vertex counts, flat vertex memory, exact building IDs / patch ranges and no orphan accessors');
