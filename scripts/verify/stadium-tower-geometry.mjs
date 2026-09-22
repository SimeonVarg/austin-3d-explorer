import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source=fs.readFileSync(new URL('../../js/slopes-stadium.js',import.meta.url),'utf8');
const data=JSON.parse(fs.readFileSync(new URL('../../data/stadium.mesh.json',import.meta.url)));
if(process.argv.includes('--break'))data.officeTower.recess=0;
const start=source.indexOf('  function officeTower('),end=source.indexOf('  function tower(',start);
assert.ok(start>=0&&end>start);
const faces=[],slabs=[],beams=[];
const ctx=vm.createContext({data,TUNE:{towerSegments:32},Math,
  lerp:(a,b,t)=>a+(b-a)*t,
  quad:(_B,a,b,c,d,key,normal)=>faces.push({points:[a,b,c,d],key,normal}),
  slab:(_B,poly,z0,z1,key)=>slabs.push({poly,z0,z1,key}),
  beam:(_B,a,b,width,key)=>beams.push({a,b,width,key})});
vm.runInContext(source.slice(start,end)+';this.buildTower=officeTower;',ctx);
const t=data.towers.find(t=>t.kind==='office');ctx.buildTower({},t);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
for(const {points} of faces){
  assert.ok(points.flat().every(Number.isFinite),'nonfinite tower vertex');
  const [a,b,c]=points;
  assert.ok(Math.hypot(...cross(b.map((v,i)=>v-a[i]),c.map((v,i)=>v-a[i])))>1e-8,'degenerate tower face');
}
const shaftGlass=faces.filter(f=>f.key==='glass'&&f.normal);
assert.equal(shaftGlass.length,data.officeTower.facets*(data.officeTower.lowerFloors*data.officeTower.windowsPerFace+1));
const apothem=t.radius*Math.cos(Math.PI/data.officeTower.facets);
for(const f of shaftGlass){
  const [nx,ny]=f.normal;
  for(const p of f.points){
    const distance=(p[0]-t.x)*nx+(p[1]-t.y)*ny;
    assert.ok(distance<apothem-0.1,'glass must sit behind masonry, not coplanar');
    assert.ok(Math.abs(distance-(apothem-data.officeTower.recess))<1e-8);
  }
}
assert.equal(slabs.at(-1).z1,t.height+data.officeTower.capThickness,'preserve cap height');
assert.ok(beams.every(b=>b.width>0&&Math.hypot(...b.a.map((v,i)=>v-b.b[i]))>0));
console.log('PASS: tower openings have finite nondegenerate faces, recessed glass and bounded cap height');
