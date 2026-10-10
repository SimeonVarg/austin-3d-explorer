import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

// Round brick towers (TUNE.roundTowers in js/slopes-stadium.js): geometry checks without a browser.
const source=fs.readFileSync(new URL('../../js/slopes-stadium.js',import.meta.url),'utf8');
const tuneStart=source.indexOf('    roundTowers: {'),tuneEnd=source.indexOf('    boardSegments:');
assert.ok(tuneStart>=0&&tuneEnd>tuneStart);
const TUNE={towerSegments:32};
vm.runInNewContext('TUNE.roundTowers={'+source.slice(tuneStart+'    roundTowers: {'.length,source.lastIndexOf('    },',tuneEnd))+'};',{TUNE});
if(process.argv.includes('--break'))TUNE.roundTowers.glassRecess=0;
const start=source.indexOf('  function roundTower('),end=source.indexOf('  function tower(',start);
assert.ok(start>=0&&end>start);
const faces=[],slabs=[],beams=[];
const ctx=vm.createContext({TUNE,Math,
  lerp:(a,b,t)=>a+(b-a)*t,
  quad:(_B,a,b,c,d,key,normal)=>faces.push({points:[a,b,c,d],key,normal}),
  slab:(_B,poly,z0,z1,key)=>slabs.push({poly,z0,z1,key}),
  beam:(_B,a,b,width,key)=>beams.push({a,b,width,key})});
vm.runInContext(source.slice(start,end)+';this.buildTower=roundTower;',ctx);
const s=TUNE.roundTowers,cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
for(const site of s.sites){
  faces.length=slabs.length=beams.length=0;
  ctx.buildTower({},site);
  for(const {points} of faces){
    assert.ok(points.flat().every(Number.isFinite),'nonfinite tower vertex');
    const [a,b,c]=points;
    assert.ok(Math.hypot(...cross(b.map((v,i)=>v-a[i]),c.map((v,i)=>v-a[i])))>1e-8,'degenerate tower face');
  }
  // Drum glass strips are the tall glass quads with an outward normal; they must sit behind the brick piers.
  const strips=faces.filter(f=>f.key==='glass'&&f.normal&&f.points[2][2]-f.points[0][2]>s.glass*0.9);
  assert.equal(strips.length,s.strips*s.stripColumns,site.id+': glass strip count');
  for(const f of strips)for(const p of f.points)
    assert.ok(Math.hypot(p[0]-site.x,p[1]-site.y)<s.drumRadius-0.1,'glass must sit behind masonry, not coplanar');
  assert.equal(Math.max(...slabs.map(x=>x.z1)),site.top,site.id+': cap height');
  assert.ok(slabs.some(x=>x.z0===0),site.id+': stands on the ground');
  assert.ok(beams.every(b=>b.width>0&&Math.hypot(...b.a.map((v,i)=>v-b.b[i]))>0));
  // The stack must add up: nothing below the ground.
  assert.ok(site.top-(s.capBox+s.rim+s.lantern+s.ledge+s.lintel+s.glass+s.band)>2,site.id+': lower body at least 2 m tall');
}
console.log('PASS: round towers have finite nondegenerate faces, recessed glass, the scan cap height and a lower body');
