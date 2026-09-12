import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright-core';
import {launch,BASE} from './chrome.mjs';
const out=process.env.VERIFY_OUT;
// Freeze the comparison before PR #242; origin/main already includes the fix.
const baseline='4493d54';
const index=JSON.parse(fs.readFileSync(new URL('../../data/apartments/index.json',import.meta.url)));
const registered=index.buildings.length+(index.collections||[]).reduce((n,f)=>n+JSON.parse(fs.readFileSync(new URL('../../'+f,import.meta.url))).buildings.length,0);
const previous=['the-standard','villas-on-rio'].map(n=>JSON.parse(execFileSync('git',['show',baseline+':data/apartments/'+n+'.json'],{maxBuffer:1000000}).toString()));
const oldGraph=execFileSync('git',['show',baseline+':data/walk_graph.json'],{maxBuffer:2000000});
const browser=await launch(chromium,{gl:'hardware'});
try {
 const page=await browser.newPage({viewport:{width:1440,height:960},reducedMotion:'reduce'});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{const t=setInterval(()=>{if(window.cancelGraphicsAutoDetect){window.cancelGraphicsAutoDetect();clearInterval(t);}},50);});
 await page.goto(BASE+'/index.html?intro=0&drift=0&livehere=1',{waitUntil:'domcontentloaded',timeout:180000});
 await page.waitForFunction(()=>slopesApartments?.count.done&&liveHereState?.().ready&&__fly?.indexed(),null,{timeout:180000});
 const after=await page.evaluate(()=>slopesApartments.data.buildings.filter(b=>['The Standard','Villas on Rio'].includes(b.name)));
 const camera=async name=>page.evaluate(name=>{
  document.querySelector('#live-here').hidden=true;for(const el of document.querySelectorAll('.lh-map-label'))el.hidden=true;
  for(const layer of __map.getStyle().layers)if(layer.type==='symbol')__map.setLayoutProperty(layer.id,'visibility','none');
  applyTimeOfDay(__map,0.12,true);
  const standard=name==='standard',center=slopesApartments.uvToLngLat('Villas on Rio',43,27);
  __map.stop();
  if(standard){
    const eye=slopesApartments.uvToLngLat('The Standard',106,-15),alt=9,pitch=83,bearing=135,rad=Math.PI/180;
    const lead=alt*Math.tan(pitch*rad),lonScale=111320*Math.cos(eye[1]*rad);
    const zoom=Math.log2(__map.transform.cameraToCenterDistance*40075016.686*Math.cos(eye[1]*rad)*Math.cos(pitch*rad)/(512*alt));
    __map.jumpTo({center:[eye[0]+lead*Math.sin(bearing*rad)/lonScale,eye[1]+lead*Math.cos(bearing*rad)/111320],zoom,pitch,bearing,padding:0});
  }else __map.jumpTo({center,zoom:19.4,pitch:0,bearing:185,padding:0});
 },name);
 const shot=async name=>{if(!out)return;await page.waitForTimeout(4000);await page.screenshot({path:out+'/'+name+'.jpg',quality:90});await page.waitForTimeout(900);await page.screenshot({path:out+'/'+name+'.jpg',quality:90});};
 const swap=async specs=>page.evaluate(specs=>{for(const s of specs){const i=slopesApartments.data.buildings.findIndex(b=>b.name===s.name);slopesApartments.data.buildings[i]=s;}slopesApartments.rebuild();},specs);
 const rays=()=>page.evaluate(()=>{
  const g=slopesApartments.group;g.updateMatrixWorld(true);
  return [[43,22],[47,31],[35,22]].map(([u,v])=>{
   const ll=slopesApartments.uvToLngLat('Villas on Rio',u,v),p=slopes.toLocal(...ll,130);
   const ray=new THREE.Raycaster(new THREE.Vector3(p.x,p.y,p.z),new THREE.Vector3(0,0,-1));
   return ray.intersectObject(g,true).map(h=>h.point.z).filter(z=>z>1);
  });
 });
 const fixedRays=await rays();assert.equal(fixedRays[0].length,0,'light well has no solid roof or suspended equipment');assert.equal(fixedRays[1].length,0,'east slot is open');assert.ok(fixedRays[2].length>0,'control ray still hits tower');
 for(const name of ['standard','villas']){await camera(name);await shot(name+'-after');}
 const afterCount=await page.evaluate(()=>slopesApartments.count);
 assert.equal(afterCount.buildings,registered);assert.equal(afterCount.signMissing,0);
 await swap(previous);const oldRays=await rays();assert.ok(oldRays[0].length>0&&oldRays[1].length>0,'regression guard catches the original filled gaps');
 const oldCount=await page.evaluate(()=>slopesApartments.count);
 // Exact floor boundaries no longer produce spurious floor-below warnings.
 assert.ok(afterCount.warnings.every(w=>!w.includes('no skin')&&!w.includes('not a face')),'no invalid authored facade');
 for(const name of ['standard','villas']){await camera(name);await shot(name+'-before');}
 await swap(after);
 const pairs=[['JES','GDC'],['JES','WEL'],['PCL','RLP'],['GRE','MAI'],['BUR','CBA'],['STD','MAI'],['21 Rio','WEL'],['The Castilian','GDC'],['PCL','JES'],['GDC','BIO'],['WEL','TSG'],['GDC','DMC'],['GRE','MNC'],['GRE','NEZ'],['GRE','TCP'],['GRE','AF2'],['JES','BMS'],['JES','BMK'],['JES','MCA']];
 const getRoutes=()=>page.evaluate(async pairs=>Promise.all(pairs.map(async p=>{const r=await wayfindStairs(...p);return {pair:p.join('>'),ok:r.ok,distM:r.distM};})),pairs);
 const current=await getRoutes();
 await page.route('**/walk_graph.json*',route=>route.fulfill({status:200,contentType:'application/json',body:oldGraph}));
 await page.reload({waitUntil:'domcontentloaded',timeout:180000});await page.waitForFunction(()=>window.liveHereState?.().ready,null,{timeout:180000});
 const original=await getRoutes();
 const drift=current.map((r,i)=>({pair:r.pair,delta:Math.round((r.distM-original[i].distM)*100)/100,oldOK:original[i].ok,ok:r.ok}));
 // Rebuilding also picks up current entrances.geojson: GDC door positions moved
 // about 2.1m and PCL about 0.7m since the shipped August graph. Inspectable in
 // the old/new d[] coordinates and link distances; no network shortcut.
 assert.ok(drift.every(d=>d.ok===d.oldOK&&Math.abs(d.delta)<3),'existing shipped routes stay within three metres: '+JSON.stringify(drift));
 assert.deepEqual(errors,[]);console.log('PASS matched building frames, all registered buildings, valid facade references, real roof-cut rays and original failure, all 19 shipped route pairs within 3m');
}finally{await browser.__done();}
