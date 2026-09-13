import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright-core';
import {launch,BASE} from './chrome.mjs';
const read=f=>JSON.parse(fs.readFileSync(new URL('../../'+f,import.meta.url)));
const index=read('data/apartments/index.json');
const expected=index.buildings.length+index.collections.reduce((n,f)=>n+read(f).buildings.length,0);
const browser=await launch(chromium,{gl:'hardware',maxMs:600000});
try{
 const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{
  // Blank cornices and lintels intentionally have no floor-aligned windows.
  // Their diagnostic is not a render failure; invalid skins/faces are checked below.
  const floorBand=m.type()==='warning'&&/^\[slopes-apartments\].*band z0 .*floor line/.test(m.text());
  if(!floorBand&&/MAP ERROR:|\[(roofscape|slopes-apartments|buildScene)\]/.test(m.text())&&['error','warning'].includes(m.type()))errors.push(m.text());
 });
 await page.addInitScript(()=>{const t=setInterval(()=>{if(window.cancelGraphicsAutoDetect){cancelGraphicsAutoDetect();clearInterval(t)}},50)});
 await page.goto(BASE+'/index.html?intro=0&drift=0&livehere=1',{waitUntil:'domcontentloaded',timeout:180000});
 await page.waitForFunction(()=>window.slopesApartments?.count.done&&window.roofscapeAnchors&&window.__map?.getLayer('roofscape-deck')&&window.__fly?.indexed(),null,{timeout:180000});
 assert.equal(await page.evaluate(()=>slopesApartments.count.buildings),expected);
 assert.deepEqual(await page.evaluate(()=>slopesApartments.hidden.missing),[]);
 assert.ok(await page.evaluate(()=>{
  let ok=true;slopesApartments.group.traverse(o=>{if(!o.geometry)return;
   const a=o.geometry.attributes,n=a.position.count;
   for(const k of ['position','normal','cDay','cGold','cNight'])if(a[k].count!==n||a[k].array.some(v=>!Number.isFinite(v)))ok=false;
  });return ok;
 }),'finite aligned building buffers');
 await page.evaluate(()=>{GFX.autoExposure=false;__map.jumpTo({center:[-97.7388,30.2831],zoom:19,pitch:0,bearing:0});setRoofDetail(1)});
 await page.waitForTimeout(6500);
 assert.ok(await page.evaluate(()=>__map.getLayer('roofscape-minor')),'minor tier loaded');
 if(process.argv.includes('--break'))await page.evaluate(()=>{
  const expr=__map.getPaintProperty('roofscape-deck','fill-extrusion-base');
  for(let i=1;i<expr.length-1;i+=2)expr[i][1]=['within',expr[i][1][1][1]];
  __map.setPaintProperty('roofscape-deck','fill-extrusion-base',expr);
 });
 for(const name of ['University Christian Church','University Catholic Center']){
  await page.evaluate(name=>{
   const a=roofscapeAnchors.anchors.find(a=>a.name===name),r=a.geometry.coordinates[0];
   const center=r.reduce((v,p)=>[v[0]+p[0]/r.length,v[1]+p[1]/r.length],[0,0]);
   __map.jumpTo({center,zoom:20,pitch:0,bearing:0});
  },name);
  await page.waitForTimeout(2500);
  const result=await page.evaluate(name=>{
   const a=roofscapeAnchors.anchors.find(a=>a.name===name);
   return ['roofscape-deck','roofscape-major','roofscape-minor'].map(id=>JSON.stringify(__map.getPaintProperty(id,'fill-extrusion-base')).includes(String(a.delta)));
  },name);
  assert.ok(result.every(Boolean),name+' translation reaches every loaded tier');
  const evaluated=await page.evaluate(name=>{
   const a=roofscapeAnchors.anchors.find(a=>a.name===name),expr=__map.getPaintProperty('roofscape-deck','fill-extrusion-base');
   const i=roofscapeAnchors.anchors.indexOf(a),condition=expr[1+i*2];
   // Ask the real expression engine to evaluate the polygon predicate. Merely
   // finding a delta in the paint JSON let the unsupported `within` pass.
   return __map.queryRenderedFeatures({layers:['roofscape-deck'],filter:condition}).some(f=>f.properties.b===a.oldDeck);
  },name);
  assert.ok(evaluated,name+' predicate matches its actual rendered polygon');
 }
 await page.evaluate(()=>__map.jumpTo({center:[-97.7388,30.2831],zoom:19,pitch:0,bearing:0}));
 await page.waitForTimeout(2500);
 const buried=await page.evaluate(()=>{
  const ring=slopesApartments.data.buildings.find(b=>b.code==='UTC').footprint.ring;
  function inside(p){let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){
   const a=ring[i],b=ring[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;
  }return yes}
  return __map.queryRenderedFeatures({layers:['roofscape-deck','roofscape-major','roofscape-minor']})
   .filter(f=>inside(f.geometry.coordinates[0][0])).map(f=>[f.layer.id,f.properties.b]);
 });
 assert.deepEqual(buried,[],'old UTC roof and equipment disappear above the shorter model');
 const overlap=await page.evaluate(()=>{
  const ids=new Set(slopesApartments.data.replacedBuildingIds);
  return __map.queryRenderedFeatures({layers:['drag-wall','drag-cap','drag-detail']})
   .filter(f=>ids.has(f.properties.bid)).map(f=>f.properties.bid);
 });
 assert.deepEqual(overlap,[],'legacy PCL and campus facade overlays stay retired');
 const warning=await page.evaluate(()=>slopesApartments.count.warnings.filter(w=>/no skin|not a face/.test(w)));
 assert.deepEqual(warning,[]);
 await page.waitForFunction(()=>typeof window.wayfindStairs==='function',null,{timeout:120000});
 const routes=await page.evaluate(async()=>Promise.all([['UTC','GSB'],['UTC','PCL'],['JES','GDC'],['BUR','CBA']].map(async p=>({pair:p,route:await wayfindStairs(...p)}))));
 assert.ok(routes.every(r=>r.route.ok),'campus routes remain usable');
 await page.evaluate(()=>{__usePreset('performance');applyTimeOfDay(__map,1,true)});
 assert.equal(await page.evaluate(()=>slopesApartments.count.buildings),expected);
 await page.waitForTimeout(2000);
 assert.deepEqual(errors,[]);
 console.log('PASS',expected,'models, finite geometry, all roof tiers, retired UTC roof, campus routes and night/performance preset');
}finally{await browser.__done()}
