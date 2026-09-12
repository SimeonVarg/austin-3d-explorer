import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright-core';
import {launch,BASE,HW_ARGS} from './chrome.mjs';
const root=new URL('../../',import.meta.url),out=process.env.VERIFY_OUT;
const read=f=>JSON.parse(fs.readFileSync(new URL(f,root)));
const old=f=>JSON.parse(execFileSync('git',['show','8ba4920:'+f],{cwd:root,maxBuffer:4000000}));
const idx=old('data/apartments/index.json'),bundle=read('data/campus_buildings.json');
const before={buildings:idx.buildings.map(f=>old('data/apartments/'+f)),replacedBuildingIds:idx.replacedBuildingIds,replacedNames:idx.replacedNames};
assert.equal(bundle.buildings.length,36);
const snapshot=read('data/snapshots/2026-09-12/buildings.detailed.geojson').features;
for(const b of bundle.buildings){
 const f=snapshot.find(f=>f.properties.id===b.id);
 assert.ok(f,b.name+' has a mapped identity');
 assert.deepEqual(b.footprint.ring,f.geometry.coordinates[0],b.name+' retains footprint');
 assert.deepEqual(b.footprint.holes,f.geometry.coordinates.slice(1),b.name+' retains all courts');
}
const browser=await launch(chromium,{gl:'hardware',args:[...HW_ARGS,'--disable-gpu-vsync','--disable-frame-rate-limit'],maxMs:600000});
try{
 const page=await browser.newPage({viewport:{width:1440,height:960},reducedMotion:'reduce'}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error'&&/\[(campus-landscape|slopes-apartments)\]/.test(m.text()))errors.push(m.text())});
 await page.addInitScript(()=>{const t=setInterval(()=>{if(window.cancelGraphicsAutoDetect){cancelGraphicsAutoDetect();clearInterval(t)}},50)});
 await page.goto(BASE+'/index.html?intro=0&drift=0',{waitUntil:'domcontentloaded',timeout:180000});
 await page.waitForFunction(()=>window.slopesApartments?.count.done&&window.campusLandscape?.count.done&&window.slopesRoofs?.data&&window.__fly?.indexed(),null,{timeout:180000});
 const after=await page.evaluate(()=>structuredClone(slopesApartments.data));
 const info=await page.evaluate(()=>({halls:slopesApartments.count.buildings,planting:campusLandscape.count,hidden:slopesApartments.hidden}));
 assert.equal(info.halls,76);assert.ok(info.planting.trees>1500);assert.ok(info.planting.gardens>30);assert.ok(info.planting.triangles>300000);
 assert.deepEqual(info.hidden.missing,[]);assert.deepEqual(info.hidden.rigsMissing,[]);
 assert.ok(await page.evaluate(()=>{
  const g=campusLandscape.group;if(!g||!g.children.length)return false;
  for(const m of g.children)for(const key of ['position','normal','cDay','cNight'])if(m.geometry.attributes[key].array.some(x=>!Number.isFinite(x)))return false;
  return true;
 }),'finite planting geometry and colours');
 // Whole-crown replacement must remove the original visible tiers, not draw
 // a nicer tree underneath them. This fails with the initial within filter.
 await page.evaluate(()=>{__map.jumpTo({center:[-97.7408,30.2854],zoom:17.5,pitch:58,bearing:280});applyTimeOfDay(__map,.12,true)});
 await page.waitForTimeout(7000);
 const retired=()=>page.evaluate(()=>{
  const keys=new Set(campusLandscape.data.canopyKeys);
  return __map.queryRenderedFeatures({layers:['trees-canopy']}).filter(f=>keys.has([f.properties.d,f.properties.sp||'other',f.properties.r0||0,f.properties.j||0].join('|'))).length;
 });
 assert.equal(await retired(),0,'old canopy tiers disappear');
 // A courtyard is a physical opening, even with the existing roof rigs shown.
 const court=await page.evaluate(()=>{
  const b=slopesApartments.data.buildings.find(b=>b.code==='GOL'),F=b.frame.obb;
  const ll=[F.o[0]+(30*F.ax-40*F.ay)/F.mx,F.o[1]+(30*F.ay+40*F.ax)/F.my],p=slopes.toLocal(...ll,80);
  const r=new THREE.Raycaster(new THREE.Vector3(p.x,p.y,p.z),new THREE.Vector3(0,0,-1));
  for(const g of [slopesApartments.group,slopesRoofs.group])g.updateMatrixWorld(true);
  return r.intersectObjects([slopesApartments.group,slopesRoofs.group],true).map(h=>h.point.z);
 });
 assert.equal(court.length,0,'Goldsmith courtyard remains open to sky');
 const courtFloor=await page.evaluate(()=>{
  const ll=(u,v)=>slopesApartments.uvToLngLat('Goldsmith Hall',u,v);
  return {court:__fly.roofAt(...ll(30,40),0),wing:__fly.roofAt(...ll(6,40),0)};
 });
 assert.ok(courtFloor.court<1,'Goldsmith court has no invisible collision roof');
 assert.ok(courtFloor.wing>10,'Goldsmith wing remains solid');
 const disposal=await page.evaluate(()=>{
  let expected=0,disposed=0;
  for(const g of [campusLandscape.group,slopesApartments.group])g.traverse(o=>{if(o.geometry){expected++;o.geometry.addEventListener('dispose',()=>disposed++)}});
  CAMPUS_LANDSCAPE.on=false;applyCampusLandscape();slopesApartments.rebuild();
  return {expected,disposed};
 });
 assert.equal(disposal.disposed,disposal.expected,'old planting/building GPU buffers are released on rebuild');
 assert.equal(await page.evaluate(()=>!!campusLandscape.group),false);
 await page.waitForTimeout(4000);assert.ok(await retired()>0,'fallback restores old crowns');
 await page.evaluate(()=>{CAMPUS_LANDSCAPE.on=true;applyCampusLandscape()});
 await page.waitForTimeout(4000);assert.equal(await retired(),0,'mesh replacement restores');
 const counts=[];
 for(const preset of ['performance','cinematic']){
  await page.evaluate(p=>__usePreset(p),preset);
  counts.push(await page.evaluate(()=>campusLandscape.count.trees));
  assert.equal(await page.evaluate(()=>slopesApartments.count.buildings),76);
 }
 assert.ok(counts[0]<counts[1],'tree density follows graphics preset');
 await page.evaluate(()=>{__usePreset('balanced');applyTimeOfDay(__map,.12,true)});
 const frames=[];
 if(process.env.CAMPUS_PERF){
  for(const state of ['after','before','before','after','before','after']){
   await page.evaluate(({data,on})=>{
    Object.assign(slopesApartments.data,data);slopesApartments.rebuild();CAMPUS_LANDSCAPE.on=on;applyCampusLandscape();
    GFX.autoExposure=false;__map.jumpTo({center:[-97.7396,30.2881],zoom:17.2,pitch:58,bearing:15,padding:0});applyTimeOfDay(__map,.12,true);
   },{data:state==='before'?before:after,on:state==='after'});
   await page.waitForTimeout(2500);
   const median=await page.evaluate(async()=>{
    const samples=[];let last=performance.now();await new Promise(resolve=>{function step(t){samples.push(t-last);last=t;__map.setBearing(15+samples.length*.12);if(samples.length<150)requestAnimationFrame(step);else resolve()}requestAnimationFrame(step)});
    const sorted=samples.slice(20).sort((a,b)=>a-b);return sorted[Math.floor(sorted.length/2)];
   });frames.push({state,median});console.log('frame',state,median.toFixed(2),'ms');
  }
  const min=s=>Math.min(...frames.filter(r=>r.state===s).map(r=>r.median));
  assert.ok(min('after')<=min('before')*1.35+2,'campus detail frame budget '+JSON.stringify(frames));
 }
 // Exercise the rasterizer's actual hole semantics. A pavilion in a courtyard
 // must stay solid; subtracting holes from the shared grid would erase it.
 const raster=await page.evaluate(()=>{
  const origin=[-97.7409,30.2856],mx=111320*Math.cos(origin[1]*Math.PI/180);
  const ll=(u,v)=>[origin[0]+u/mx,origin[1]+v/111320];
  const ring=(a,b,c,d)=>[ll(a,c),ll(b,c),ll(b,d),ll(a,d),ll(a,c)];
  const f=(coordinates,h)=>({type:'Feature',geometry:{type:'Polygon',coordinates},properties:{final_height:h}});
  // Keep the empty sample more than one conservative 6 m raster cell from
  // a wall. This is a topology check, not a claim of sub-cell precision.
  __flyRebuildCollision({buildings:{type:'FeatureCollection',features:[f([ring(46,54,46,54)],6),f([ring(0,100,0,100),ring(20,80,20,80)],12)]}});
  return [__fly.roofAt(...ll(34,50),0),__fly.roofAt(...ll(50,50),0),__fly.roofAt(...ll(4,50),0)];
 });
 assert.deepEqual(raster,[0,6,12],'hole, separate courtyard pavilion and outer wing');
 assert.deepEqual(errors,[]);
 if(out)fs.writeFileSync(out+'/campus-everywhere-gates.json',JSON.stringify({info,presetCounts:counts,frames,errors},null,2));
 console.log('PASS 36 halls, all footprint holes, open roof court, whole trees, gardens, fallback, presets'+(frames.length?', interleaved frame budget':''));
}finally{await browser.__done()}
