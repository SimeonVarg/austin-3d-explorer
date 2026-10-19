// Offline geometry/packing regression. No browser or private input.
import assert from 'node:assert/strict';
import { Document, NodeIO, Logger } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import { fineData, FINE } from './fine_repeat.mjs';
const d=new Document().setLogger(new Logger(Logger.Verbosity.ERROR)),buf=d.createBuffer(),scene=d.createScene();
const wall=d.createMaterial('wall').setBaseColorFactor([0.1,0.2,0.4,1]);
const pane=d.createMaterial('pane').setBaseColorFactor([0.01,0.01,0.01,1]);
const parts=[];
function part(name,points,indices,mat=wall,b=0) {
  const P=d.createAccessor().setType('VEC3').setArray(new Float32Array(points.flat())).setBuffer(buf);
  const p=d.createPrimitive().setAttribute('POSITION',P).setAttribute('_BUILDING',d.createAccessor().setType('SCALAR').setArray(new Float32Array(points.length).fill(b)).setBuffer(buf)).setIndices(d.createAccessor().setType('SCALAR').setArray(new Uint32Array(indices)).setBuffer(buf)).setMaterial(mat);
  scene.addChild(d.createNode(name).setMesh(d.createMesh(name).addPrimitive(p)));parts.push({name,p});return p;
}
// One ten metre panel, many arbitrarily skinny triangles. Their diagonals must not affect size.
const pts=[],idx=[];
for(let i=0;i<=100;i++)pts.push([i/10,0,0],[i/10,10,0]);
for(let i=0;i<100;i++)idx.push(i*2,i*2+2,i*2+1,i*2+1,i*2+2,i*2+3);
const big=part('big navy panel',pts,idx);
// White strips use the SAME material as the broad panel; dark panes are a separate primitive.
const strip=part('strip',[[12,0,0],[12.2,0,0],[12.2,10,0],[12,10,0]],[0,1,2,0,2,3]);
const window=part('window',[[12.2,0,0],[13.2,0,0],[13.2,10,0],[12.2,10,0]],[0,1,2,0,2,3],pane);
// Closed fin: 0.1 m thickness, 1 m projection, 10 m tall, with hard-normal style seams.
const finPts=[[14,0,0],[14.1,0,0],[14.1,10,0],[14,10,0],[14,0,1],[14.1,0,1],[14.1,10,1],[14,10,1]];
const fin=part('fin',finPts,[0,1,2,0,2,3,4,7,6,4,6,5,0,4,5,0,5,1,3,2,6,3,6,7,0,3,7,0,7,4,1,5,6,1,6,2]);
// Coincident geometry in another building cannot pollute the first building's facade average.
part('neighbour',[[12,0,0],[13.2,0,0],[13.2,10,0],[12,10,0]],[0,1,2,0,2,3],d.createMaterial().setBaseColorFactor([1,0,0,1]),255);
const count=()=>parts.reduce((s,{p})=>s+p.getIndices().getCount(),0),before=count();
const stats=await fineData(d);assert.equal(count(),before);
const size=p=>{const A=p.getAttribute('_FINE');return Array.from({length:A.getCount()},(_,i)=>{const q=A.getElement(i,[])[1];return q?FINE.SIZE_BASE_M*2**((q-1)/FINE.SIZE_STEPS):Infinity;});};
assert(size(big).every(v=>v>=9.9),'triangle cuts must not turn a broad panel into fine detail');
assert(size(strip).every(v=>v>=0.199&&v<0.21),'same-palette wall strips need their own local width');
assert(size(window).every(v=>v>=0.999&&v<1.05));
assert(size(fin).every(v=>v>=0.099&&v<0.105),'all fin sides inherit the narrow part thickness');
const f=d.getRoot().getExtras().fine,bytes=Buffer.from(f.table,'base64');
const entries=Array.from({length:f.count},(_,i)=>Array.from({length:6},(_,k)=>{const v=bytes.readUInt16LE(i*12+k*2)/65535;return k<3?v:v*2-1;}));
for(const p of [strip,window]) {
  const a=p.getAttribute('_FINE').getElement(0,[]),e=entries[a[2]+256*a[3]];
  assert(e[0]<0.1&&e[0]>0.01,'facade average includes dark panes and wall');assert(e[1]>e[0],'other buildings must not tint this patch red');
  assert(Math.abs(Math.hypot(...e.slice(3))-1)<3e-5);
}
const original=parts.map(({p})=>Array.from(p.getAttribute('_FINE').getArray()));
await MeshoptEncoder.ready;await MeshoptDecoder.ready;
await d.transform(meshopt({encoder:MeshoptEncoder,level:'high',quantizePosition:16}));
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.encoder':MeshoptEncoder,'meshopt.decoder':MeshoptDecoder});
const decoded=await io.readBinary(await io.writeBinary(d));
for(const mesh of decoded.getRoot().listMeshes())for(const p of mesh.listPrimitives()) {
  const a=p.getAttribute('_FINE');assert.equal(a.getComponentType(),5121);assert.equal(a.getElementSize(),4);assert.equal(a.getNormalized(),false);assert(!p.getAttribute('_BUILDING'));
  // Reorder may permute vertices, but every packed record must survive bit-exactly.
  const expected=new Set(original[parts.findIndex(x=>x.name===mesh.getName())].reduce((a,_,i,all)=>{if(i%4===0)a.push(all.slice(i,i+4).join(','));return a;},[]));
  for(let i=0;i<a.getCount();i++)assert(expected.has(a.getElement(i,[]).join(',')));
}
console.log('PASS connected widths, wall strips, fin sides, building isolation, unit normals, triangle counts and 4-byte meshopt round trip',stats);

// Coplanar repair translates a complete brick slab (including split-normal seams), never just its front vertices.
const { fixVenueCoplanar } = await import('./fine_repeat.mjs');
const repairDoc=new Document(),rb=repairDoc.createBuffer(),rm=repairDoc.createMesh(),rn=repairDoc.createNode().setMesh(rm);repairDoc.createScene().addChild(rn);
const slab=[[0,0,0],[5,0,0],[5,4,0],[0,4,0],[0,0,-0.12],[5,0,-0.12],[5,4,-0.12],[0,4,-0.12]];
let brickPos;
for(const [name,p,idx] of [['brick_red',slab,[0,1,2,0,2,3,4,7,6,4,6,5,0,4,5,0,5,1,3,2,6,3,6,7,0,3,7,0,7,4,1,5,6,1,6,2]],['wall_white',[[-1,-1,0],[6,-1,0],[6,5,0],[-1,5,0]],[0,1,2,0,2,3]]]) {
  const P=repairDoc.createAccessor().setType('VEC3').setArray(new Float32Array(p.flat())).setBuffer(rb);
  rm.addPrimitive(repairDoc.createPrimitive().setAttribute('POSITION',P).setIndices(repairDoc.createAccessor().setType('SCALAR').setArray(new Uint16Array(idx)).setBuffer(rb)).setMaterial(repairDoc.createMaterial(name)));
  if(name==='brick_red')brickPos=P;
}
const repair=fixVenueCoplanar(repairDoc,'the-venue');assert.equal(repair.coplanar_m2,20);assert.equal(repair.triangles,2);
for(let i=0;i<slab.length;i++)assert(Math.abs(brickPos.getElement(i,[])[2]-slab[i][2]-FINE.VENUE_RELIEF_M)<1e-7);
assert.equal(fixVenueCoplanar(repairDoc,'the-venue').coplanar_m2,0);
console.log('PASS coplanar detection, complete slab translation and repeat repair');

// Partial intersections count their overlap, including when the brick's corners/centre miss the wall.
for(let i=0;i<slab.length;i++)brickPos.setElement(i,slab[i]);
const whitePos=rm.listPrimitives()[1].getAttribute('POSITION');
for(const i of [1,2]) {const p=whitePos.getElement(i,[]);p[0]=2.5;whitePos.setElement(i,p);}
assert.equal(fixVenueCoplanar(repairDoc,'the-venue').coplanar_m2,10);
for(let i=0;i<slab.length;i++)assert(Math.abs(brickPos.getElement(i,[])[2]-slab[i][2]-FINE.VENUE_RELIEF_M)<1e-7);
console.log('PASS partial coplanar intersection area');
