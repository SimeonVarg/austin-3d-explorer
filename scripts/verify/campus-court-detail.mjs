// Garden detail validation must be atomic so one malformed addition cannot
// discard other places or leave half a mesh behind.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const src=fs.readFileSync(new URL('../../js/campus-landscape.js',import.meta.url),'utf8');
const start=src.indexOf(' function detailMesh(B,f){'),end=src.indexOf(' function buildGardens(B){',start);
assert.ok(start>=0&&end>start);
const scope=vm.createContext({slopes:{toLocal:(lng,lat,z)=>({x:lng,y:lat,z})}});
vm.runInContext(src.slice(start,end),scope);
const emitted=[];const B={tri(...args){emitted.push(args);}};
const good={kind:'detailMesh',colour:['#998877','#aa9977','#222222'],vertices:[[0,0,0],[1,0,0],[0,1,0]],triangles:[[0,1,2]]};
assert.equal(scope.detailMesh(B,good),true);assert.equal(emitted.length,1);
for(const change of [
 {triangles:[[0,1,2],[0,1,3]]},{triangles:[[0,1,2],[0,1,1.5]]},
 {triangles:[[0,1,2],[0,1,1]]},
 {vertices:[[0,0,0],[1,0,0],[2,0,0]]},
 {vertices:[[0,0,0],[1,0,0],[NaN,1,0]]},{colour:['red','#aa9977','#222222']}
]){emitted.length=0;assert.equal(scope.detailMesh(B,{...good,...change}),false);assert.equal(emitted.length,0,'reject the entire feature before emitting any triangle');}
const data=JSON.parse(fs.readFileSync(new URL('../../data/campus_landscape.json',import.meta.url),'utf8'));
const court=data.gardens.places.find(p=>p.name==='Goldsmith Box Courtyard');
const meshes=court.features.filter(f=>f.kind==='detailMesh');
assert.ok(meshes.length>=10,'court contains distinct material batches');
let triangles=0;
for(const feature of meshes){emitted.length=0;assert.equal(scope.detailMesh(B,feature),true);triangles+=emitted.length;}
assert.ok(triangles>1000&&triangles<20000,'court detail remains a bounded mesh addition');
assert.equal(court.features.filter(f=>f.kind==='lawn').length,4,'mapped lawn panels remain separate');
assert.equal(court.features.filter(f=>f.kind==='bench').length,0,'old crossing-path benches are replaced, not duplicated');
console.log('PASS: valid court meshes emit; malformed late triangles/coordinates/materials are atomic skips; four lawn panels and bounded geometry:',triangles,'triangles');
