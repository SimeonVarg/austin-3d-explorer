import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright-core';
import {launch,BASE,HW_ARGS} from './chrome.mjs';
const root=new URL('../../',import.meta.url),out=process.env.VERIFY_OUT;
const read=path=>JSON.parse(fs.readFileSync(new URL(path,root)));
const old=path=>JSON.parse(execFileSync('git',['show','d549ef0:'+path],{cwd:root,maxBuffer:3000000}));
const index=read('data/apartments/index.json');
const beforeIndex=old('data/apartments/index.json');
const before={buildings:beforeIndex.buildings.map(f=>old('data/apartments/'+f)),replacedBuildingIds:beforeIndex.replacedBuildingIds,replacedNames:beforeIndex.replacedNames};
const browser=await launch(chromium,{gl:'hardware',args:[...HW_ARGS,'--disable-gpu-vsync','--disable-frame-rate-limit'],maxMs:600000});
let failed=false;
try{
 const page=await browser.newPage({viewport:{width:1440,height:960},reducedMotion:'reduce'}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error'&&m.text().includes('[slopes-'))errors.push(m.text())});
 await page.addInitScript(()=>{const t=setInterval(()=>{if(window.cancelGraphicsAutoDetect){cancelGraphicsAutoDetect();clearInterval(t)}},50)});
 await page.goto(BASE+'/index.html?intro=0&drift=0&livehere=1',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.slopesApartments?.count.done&&window.slopesRoofs?.data&&window.__fly?.indexed(),null,{timeout:180000});
 const after=await page.evaluate(()=>structuredClone(slopesApartments.data));
 const info=await page.evaluate(()=>({count:slopesApartments.count,hidden:slopesApartments.hidden,roofKeys:Object.keys(slopesRoofs.data.roofs)}));
 assert.equal(info.count.buildings,index.buildings.length,'every registered building builds');assert.equal(info.count.signMissing,0);assert.deepEqual(info.hidden.missing,[]);assert.deepEqual(info.hidden.rigsMissing,[]);
 for(const s of after.buildings.filter(s=>s.preserveRoof))assert.ok(info.roofKeys.some(k=>k.startsWith(s.id+'/')),'preserved roof '+s.name);
 assert.ok(info.count.warnings.every(w=>!w.includes('no skin')&&!w.includes('cannot')&&!w.includes('not a face')),JSON.stringify(info.count.warnings));
 assert.ok(await page.evaluate(()=>{
  for(const g of [slopesApartments.group,slopesRoofs.group]){
   if(!g)continue;let ok=true;g.traverse(o=>{for(const key of ['position','normal']){const a=o.geometry?.attributes[key]?.array;if(a&&a.some(x=>!Number.isFinite(x)))ok=false;}});if(!ok)return false;
  }return true;
 }),'finite vertices and normals');
 const rays=()=>page.evaluate(()=>{
  const group=slopesApartments.group;group.updateMatrixWorld(true);
  const cast=(name,u,v,z=140,dir=null)=>{
   const ll=slopesApartments.uvToLngLat(name,u,v),p=slopes.toLocal(...ll,z);
   const r=new THREE.Raycaster(new THREE.Vector3(p.x,p.y,p.z),dir||new THREE.Vector3(0,0,-1));
   const h=r.intersectObject(group,true)[0];return h?{z:h.point.z,distance:h.distance,normal:h.face.normal.toArray()}:null;
  };
  const b=slopesApartments.data.buildings.find(s=>s.name==='Battle Hall'),F=b.frame.obb;
  const direction=new THREE.Vector3(-F.ax,-F.ay,0);
  const results={north:cast('Union on San Antonio',10,10),south:cast('Union on San Antonio',80,22),terrace:cast('Union on San Antonio',80,7),pointe:cast('Pointe on Rio',18,28),rambler:cast('Rambler',23,45),villasWell:cast('Villas on Rio',43,22),villasSlot:cast('Villas on Rio',47,31),villasControl:cast('Villas on Rio',35,22),archCorner:cast('Battle Hall',37.45,40.14,14.5,direction),archPane:cast('Battle Hall',37.45,38.39,11.2,direction)};
  const villas=slopesApartments.data.buildings.find(s=>s.name==='Villas on 24th'),V=villas.frame.obb;
  results.facet=cast('Villas on 24th',V.L+3,V.W/2,8,new THREE.Vector3(-V.ax,-V.ay,0));
  const icon=slopesApartments.uvToLngLat('Icon',3,3);results.iconCollision=__fly.roofAt(...icon,0);
  return results;
 });
 const r=await rays();console.log('rays',JSON.stringify(r));
 assert.ok(r.north.z>98&&r.south.z>98&&r.terrace.z<22,'Union has two full-height wings and a low terrace');
 assert.ok(r.pointe.z<5&&r.rambler.z<1,'courtyards are open');
 assert.equal(r.villasWell,null);assert.equal(r.villasSlot,null);assert.ok(r.villasControl.z>30,'Villas on Rio roof cuts remain intact');
 assert.ok(r.archPane.distance-r.archCorner.distance>.3,'arched spandrel is in front of recessed pane');
 assert.ok(Math.abs(r.facet.normal[2])>.05,'Villas bronze panels have sloping faces');
 assert.ok(r.iconCollision>85,'new Icon footprint participates in collision');
 // Observe the old broken plan and square window heads fail these same probes.
 await page.evaluate(oldUnion=>{
  const a=slopesApartments.data.buildings;a[a.findIndex(s=>s.name==='Union on San Antonio')]=oldUnion;
  const b=a.find(s=>s.name==='Battle Hall');delete b.skins.arches.window.arch;slopesApartments.rebuild();
 },before.buildings.find(s=>s.name==='Union on San Antonio'));
 const broken=await rays();assert.ok(broken.south.z<30,'guard catches old short tower');assert.ok(broken.archCorner.distance-r.archCorner.distance>.3,'guard catches square heads');
 const swap=async data=>page.evaluate(data=>{
  APARTMENTS.on=false;applySlopesApartments();Object.assign(slopesApartments.data,structuredClone(data));APARTMENTS.on=true;slopesApartments.rebuild();
 },data);
 await swap(after);assert.deepEqual(await rays(),r,'restoring specs restores the same ray results');
 console.log('PASS models, preserved roofs, open courts, Icon collision, shaped windows, folded panels; both original defects observed failing');
 // Look closely at the details, with the same hardware renderer used above.
 for(const [name,u,v,targetZ,bearing,alt]of [['Villas on 24th',19,19,12,140,42],['Rambler',48,80,22,215,65],['Battle Hall',25,23,9,265,45],['Union Building',26,6,9,15,50]]){
  await page.evaluate(({name,u,v,targetZ,bearing,alt})=>{
   document.querySelector('#live-here').hidden=true;for(const el of document.querySelectorAll('.lh-map-label'))el.hidden=true;
   for(const l of __map.getStyle().layers)if(l.type==='symbol')__map.setLayoutProperty(l.id,'visibility','none');
   const ll=slopesApartments.uvToLngLat(name,u,v),pitch=55,rad=Math.PI/180,lead=targetZ*Math.tan(pitch*rad);
   const center=[ll[0]+lead*Math.sin(bearing*rad)/(111320*Math.cos(ll[1]*rad)),ll[1]+lead*Math.cos(bearing*rad)/111320];
   const zoom=Math.log2(__map.transform.cameraToCenterDistance*40075016.686*Math.cos(ll[1]*rad)*Math.cos(pitch*rad)/(512*alt));
   applyTimeOfDay(__map,.12,true);__map.stop();__map.jumpTo({center,zoom,pitch,bearing,padding:{top:0,bottom:0,left:0,right:0}});
  },{name,u,v,targetZ,bearing,alt});
  if(out){await page.waitForTimeout(4500);const path=out+'/'+name.replaceAll(' ','-').toLowerCase()+'-detail.jpg';await page.screenshot({path,quality:90});await page.waitForTimeout(900);await page.screenshot({path,quality:90});}
 }
 // Runtime fallbacks restore their geometry and filters, then rebuild cleanly.
 await page.evaluate(()=>{APARTMENTS.on=false;applySlopesApartments()});
 assert.equal(await page.evaluate(()=>slopesApartments.group),null);
 await page.evaluate(()=>{APARTMENTS.on=true;applySlopesApartments()});
 assert.equal(await page.evaluate(()=>slopesApartments.count.buildings),index.buildings.length);
 const results=[];
 if(process.env.VISUAL_PERF){
  for(const state of ['after','before','before','after','before','after']){
   await swap(state==='before'?before:after);
   await page.evaluate(()=>{GFX.autoExposure=false;applyTimeOfDay(__map,.12,true);__map.jumpTo({center:[-97.7416,30.2854],zoom:16.9,pitch:55,bearing:0,padding:{top:0,bottom:0,left:0,right:0}})});
   await page.waitForTimeout(2200);
   const sample=await page.evaluate(async()=>{
    let last=performance.now();const a=[];
    await new Promise(resolve=>{function step(now){a.push(now-last);last=now;__map.setBearing(a.length*.18);if(a.length<150)requestAnimationFrame(step);else resolve()}requestAnimationFrame(step)});
    const sorted=a.slice(20).sort((a,b)=>a-b);return {median:sorted[Math.floor(sorted.length/2)],triangles:slopesApartments.count.triangles};
   });results.push({state,...sample});console.log('frame rep',state,JSON.stringify(sample));
  }
  const min=state=>Math.min(...results.filter(r=>r.state===state).map(r=>r.median));
  assert.ok(min('after')<min('before')*1.35+2,'no material frame regression: '+JSON.stringify(results));
  await swap(after);
 }
 await page.evaluate(()=>applyTimeOfDay(__map,1,true));await page.waitForTimeout(4000);
 assert.ok(await page.evaluate(()=>{const a=slopesApartments.group.children[0].geometry.attributes.cNight.array;for(let i=0;i<a.length;i+=3)if(a[i]>.65&&a[i+1]>.4&&a[i+2]<a[i])return true;return false}),'warm night window colors remain');
 assert.deepEqual(errors,[]);
 if(out)fs.writeFileSync(out+'/visual-gates.json',JSON.stringify({info,rays:r,watchedFailure:broken,frames:results,errors},null,2));
 console.log('PASS runtime fallback, restored filters, day/night, '+(results.length?'interleaved frame budget':'no frame benchmark requested'));
}catch(e){failed=true;console.error(e.stack)}finally{await browser.__done()}
if(failed)process.exitCode=1;
