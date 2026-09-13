import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright-core';
import {launch,BASE,HW_ARGS} from './chrome.mjs';
const root=new URL('../../',import.meta.url),read=f=>JSON.parse(fs.readFileSync(new URL(f,root)));
const idx=read('data/apartments/index.json'),shops=read('data/guadalupe.json').buildings,homes=read('data/neighborhood_apartments.json').buildings;
const all=[...idx.buildings.map(f=>read('data/apartments/'+f)),...(idx.collections||[]).flatMap(f=>read(f).buildings)];
assert.equal(new Set(all.map(b=>b.id)).size,all.length,'one authored model per footprint');
assert.equal(shops.length,67);assert.ok(homes.length>=39);
const snapshot=new Map(read('data/snapshots/2026-09-12/buildings.detailed.geojson').features.map(f=>[f.properties.id,f]));
for(const b of [...shops,...homes]){
 assert.ok(b.sources.reference&&b.sources.observations,b.name+' has provenance');
 assert.ok(b.levels.floors.every((h,i,a)=>Number.isFinite(h)&&(!i||h>a[i-1])),b.name+' has ordered floors');
 if(b.balcony)assert.ok(b.colours[b.balcony.slabTone]&&b.colours[b.balcony.railTone],b.name+' has balcony colours');
 if(b.preserveRoofscape)assert.ok(Math.abs(b.blocks[0].z1-snapshot.get(b.id).properties.final_height)<.05,b.name+' retained roof matches original elevation');
}
const old=f=>JSON.parse(execFileSync('git',['show','2f4bc2e:'+f],{cwd:root,maxBuffer:5000000}));
const oi=old('data/apartments/index.json');
const beforeBuildings=[...oi.buildings.map(f=>old('data/apartments/'+f)),...(oi.collections||[]).flatMap(f=>old(f).buildings)];
const before={buildings:beforeBuildings,replacedBuildingIds:[...new Set([...oi.replacedBuildingIds,...beforeBuildings.map(b=>b.id)])],replacedNames:[...new Set([...oi.replacedNames,...beforeBuildings.map(b=>b.name)])]};
const browser=await launch(chromium,{gl:'hardware',args:process.env.GUAD_PERF?[...HW_ARGS,'--disable-gpu-vsync','--disable-frame-rate-limit']:HW_ARGS,maxMs:720000});
try{
 const page=await browser.newPage({viewport:{width:1440,height:960},reducedMotion:'reduce'}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error'&&/\[(slopes-apartments|campus-landscape)\]/.test(m.text()))errors.push(m.text())});
 await page.addInitScript(()=>{const t=setInterval(()=>{if(window.cancelGraphicsAutoDetect){cancelGraphicsAutoDetect();clearInterval(t)}},50)});
 await page.goto(BASE+'/index.html?intro=0&drift=0',{waitUntil:'domcontentloaded',timeout:180000});
 await page.waitForFunction(()=>window.slopesApartments?.count.done&&window.campusLandscape?.count.done&&window.__fly?.indexed(),null,{timeout:180000});
 assert.equal(await page.evaluate(()=>slopesApartments.count.buildings),all.length);
 assert.deepEqual(await page.evaluate(()=>slopesApartments.hidden.missing),[]);
 assert.deepEqual(await page.evaluate(()=>slopesApartments.hidden.rigsMissing),[]);
 assert.deepEqual(errors,[]);console.log('loaded',all.length);
 const shape=await page.evaluate(()=>{
  const result=[];
  for(const group of [slopesApartments.group,campusLandscape.group])group.traverse(o=>{
   if(!o.geometry)return;const attrs=o.geometry.attributes,n=attrs.position.count;
   for(const key of ['position','normal','cDay','cGold','cNight'])result.push([o.name,key,attrs[key].count===n&&!attrs[key].array.some(v=>!Number.isFinite(v))]);
  });return result;
 });assert.ok(shape.every(x=>x[2]),JSON.stringify(shape.filter(x=>!x[2])));
 console.log('finite geometry');
 // An invalid palette formerly left one vertex in the combined buffer. Every
 // later building then used the wrong vertex/colour correspondence.
 assert.deepEqual(await page.evaluate(()=>{
  const b=slopes.build(),a=[0,0,0],c=[1,0,0],d=[0,1,0];
  try{b.tri(a,c,d,undefined)}catch{}
  b.tri(a,c,d,['#ffffff','#ffffff','#ffffff']);const g=b.geometry();
  const n=['position','normal','cDay','cGold','cNight'].map(k=>g.attributes[k].count);g.dispose();return n;
 }),[3,3,3,3,3],'rejected triangle leaves all buffers aligned');
 if(process.argv.includes('--break'))await page.evaluate(()=>{slopesApartments.data.buildings.find(b=>b.name==='The Quarters Karnes House').blocks[0].z1=36.6;slopesApartments.rebuild()});
 const height=await page.evaluate(()=>Object.fromEntries(slopesApartments.built.map(b=>[b.name,b.top])));
 assert.ok(height['The Quarters Karnes House']<9,'Karnes stays two floors');
 for(const name of ['Torre Student Living','Yugo Austin Waterloo','Rise at West Campus','Lark Austin']){
  const b=homes.find(b=>b.name===name);assert.ok(b);assert.ok(height[name]>50,name+' replaces the short placeholder');
 }
 assert.ok(height['Guadalupe retail frontage']<15,'former leasing office stays low');
 const ids=shops.map(b=>b.id),layers=['drag-wall','drag-cap','drag-detail','places-solid','places-glass','places-entry','entrances-portal','entrances-glass'];
 for(const center of [[-97.7419,30.284],[-97.7418,30.287],[-97.7415,30.2904],[-97.7422,30.294]]){
  await page.evaluate(center=>{__map.jumpTo({center,zoom:17.7,pitch:55,bearing:280});applyTimeOfDay(__map,.12,true)},center);
  await page.waitForTimeout(3500);
  console.log('frontage',center);
  const oldFronts=await page.evaluate(({ids,layers})=>__map.queryRenderedFeatures({layers:layers.filter(l=>__map.getLayer(l))}).filter(f=>ids.includes(f.properties.bid)).map(f=>[f.layer.id,f.properties.bid]),{ids,layers});
  assert.deepEqual(oldFronts,[],'old frontage is replaced throughout Guad');
 }
 console.log('frontages pass');
 // This center lies inside Medici's measured deck. A broad viewport query
 // would pass on neighboring roofs even if this roof were still erased.
 await page.evaluate(()=>__map.jumpTo({center:[-97.74214339872687,30.28545225],zoom:21,pitch:0,bearing:0}));await page.waitForTimeout(3000);
 assert.ok(await page.evaluate(()=>__map.queryRenderedFeatures(__map.project([-97.74214339872687,30.28545225]),{layers:['roofscape-deck']}).length)>0,'Medici retains its measured roof deck');
 console.log('surveyed roof retained');
 const fences=()=>page.evaluate(()=>__map.queryRenderedFeatures({layers:['props-line']}).filter(f=>f.properties.u==='fence'&&f.geometry.coordinates.flat(2).some((v,i,a)=>i%2===0&&v> -97.74181&&v< -97.74170&&a[i+1]>30.28609&&a[i+1]<30.28639)).length);
 await page.evaluate(()=>__map.jumpTo({center:[-97.74178,30.2862],zoom:19.5,pitch:0,bearing:0}));await page.waitForTimeout(3500);
 assert.equal(await fences(),0,'solid fences disappear at the Co-op');
 assert.equal(await page.evaluate(()=>campusLandscape.count.railings),2);
 await page.evaluate(()=>{CAMPUS_LANDSCAPE.on=false;applyCampusLandscape()});await page.waitForTimeout(1500);
 assert.ok(await fences()>0,'landscape fallback restores original fences');console.log('railings and fence fallback pass');
 await page.evaluate(()=>{CAMPUS_LANDSCAPE.on=true;applyCampusLandscape();APARTMENTS.on=false;applySlopesApartments()});await page.waitForTimeout(1500);
 assert.equal(await page.evaluate(()=>slopesApartments.group),null);
 const restored=await page.evaluate(({ids,layers})=>__map.queryRenderedFeatures({layers:layers.filter(l=>__map.getLayer(l))}).some(f=>ids.includes(f.properties.bid)),{ids,layers});
 assert.ok(restored,'building fallback restores the old Co-op frontage');
 await page.evaluate(()=>{APARTMENTS.on=true;applySlopesApartments()});
 console.log('building fallback pass');
 for(const preset of ['performance','cinematic','balanced']){
  await page.evaluate(p=>__usePreset(p),preset);
  assert.equal(await page.evaluate(()=>slopesApartments.count.buildings),all.length);console.log('preset',preset);
 }
 await page.evaluate(()=>applyTimeOfDay(__map,1,true));await page.waitForTimeout(1200);
 assert.deepEqual(errors,[]);
 const after=await page.evaluate(()=>structuredClone(slopesApartments.data)),samples=[];
 if(process.env.GUAD_PERF){
  for(const state of ['after','before','before','after','before','after']){
   await page.evaluate(({data})=>{APARTMENTS.on=false;applySlopesApartments();Object.assign(slopesApartments.data,data);APARTMENTS.on=true;applySlopesApartments();GFX.autoExposure=false;__map.jumpTo({center:[-97.7423,30.2879],zoom:16.8,pitch:58,bearing:310,padding:0});applyTimeOfDay(__map,.12,true)},{data:state==='before'?before:after});
   await page.waitForTimeout(2200);
   const median=await page.evaluate(async()=>{
    const a=[];let last=performance.now();await new Promise(resolve=>{function step(t){a.push(t-last);last=t;__map.setBearing(310+a.length*.12);if(a.length<150)requestAnimationFrame(step);else resolve()}requestAnimationFrame(step)});
    const sorted=a.slice(20).sort((a,b)=>a-b);return sorted[Math.floor(sorted.length/2)];
   });samples.push({state,median});console.log('frame',state,median.toFixed(2),'ms');
  }
  const min=s=>Math.min(...samples.filter(x=>x.state===s).map(x=>x.median));
  assert.ok(min('after')<min('before')*1.35+2,'frame regression: '+JSON.stringify(samples));
 }
 if(process.env.VERIFY_OUT)fs.writeFileSync(process.env.VERIFY_OUT+'/guadalupe-check.json',JSON.stringify({models:all.length,homes:homes.length,shops:shops.length,samples,settings:'Hardware GL, 1440x960, balanced, no CPU throttle; minimum of three interleaved medians. Landscape held constant.'},null,2));
 console.log('PASS Guadalupe geometry, replacement, railings, fallbacks, presets, night and buffer alignment');
}finally{await browser.__done()}
