// One browser, direct legacy/current comparisons, source isolation, real scene.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {BASE,launch} from './chrome.mjs';
const OUT=process.env.VERIFY_OUT;
if(!OUT)throw new Error('Set VERIFY_OUT to a scratch directory');
fs.mkdirSync(OUT,{recursive:true});
const browser=await launch(chromium,{gl:'hardware'});
const results={checks:[],errors:[],poses:[]};
const check=(name,ok,detail)=>{results.checks.push({name,ok,detail});console.log((ok?'PASS ':'FAIL ')+name+' '+JSON.stringify(detail??''));};
try{
 const page=await browser.newPage({viewport:{width:1600,height:1000}});
 page.on('pageerror',e=>results.errors.push(e.message));
 await page.addInitScript(()=>{const t=setInterval(()=>{if(window.cancelGraphicsAutoDetect){window.cancelGraphicsAutoDetect();clearInterval(t);}},50);});
 await page.goto(BASE+'/index.html?intro=0&drift=0',{waitUntil:'domcontentloaded',timeout:180000});
 await page.waitForFunction(()=>window.slopesStadium?.count.done&&window.slopesApartments?.count.done,null,{timeout:240000});
 await page.waitForTimeout(4500);
 const info=await page.evaluate(()=>{
  const s=window.slopesStadium,m=window.__map;
  return {count:s.count,filters:Object.fromEntries(m.getStyle().layers.filter(l=>l.id.startsWith('stadium-')).map(l=>[l.id,m.getFilter(l.id)])),
   ground:s.heightAt(...s.ll(0,0)),west:s.heightAt(...s.ll(-95,0)),north:s.heightAt(...s.ll(0,113)),
   collisionGround:window.__fly.roofAt(...s.ll(0,0),0.1),board:s.data.board};
 });
 results.info=info;check('88 sections built',info.count.sections===88,info.count);
 check('field collision stays at ground',info.ground<0.6&&info.collisionGround<0.6,info);
 check('upper decks have height',info.west>35&&info.north>25,[info.west,info.north]);
 check('current screen dimensions',info.board.width===48.768&&info.board.height===13.4112,info.board);
 const pose=async(name,view,tod=0.3)=>{
  await page.evaluate(({view,tod})=>{window.__map.jumpTo(view);const el=document.getElementById('tod-slider');el.value=String(tod);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));},{view,tod});
  await page.waitForTimeout(4300);await page.evaluate(()=>window.__map.triggerRepaint());
  const path=`${OUT}/${name}.jpg`;await page.screenshot({path,quality:90});await page.waitForTimeout(900);await page.screenshot({path,quality:90});
  results.poses.push(name);console.log('SHOT '+name);
 };
 const overview={center:[-97.7323,30.2835],zoom:16.7,pitch:58,bearing:330};
 const bowl={center:[-97.7323,30.2835],zoom:17.4,pitch:65,bearing:170};
 await page.evaluate(()=>window.slopesStadium.setEnabled(false));
 await pose('dkr-legacy',bowl);
 // Isolate the old, always-on solid substitute from the legacy model.
 const isolate=await page.evaluate(()=>{
  const m=window.__map,old=m.getFilter('stadium-seating');window.__dkrOldSeat=old;
  m.setFilter('stadium-seating',['all',old,['has','base']]);return old;
 });
 await pose('dkr-legacy-no-coarse',bowl);
 await page.evaluate(()=>{window.__map.setFilter('stadium-seating',window.__dkrOldSeat);window.slopesStadium.setEnabled(true);});
 await pose('dkr-new-bowl',bowl);
 const overlap=await page.evaluate(()=>{
  const m=window.__map,ids=['stadium-wall','stadium-wall-roof','stadium-seating','stadium-detail','stadium-field'];
  return Object.fromEntries(ids.map(id=>[id,m.queryRenderedFeatures({layers:[id]}).length]));
 });check('legacy geometry fully hidden',Object.values(overlap).every(n=>n===0),overlap);
 await pose('dkr-new-overview',overview);
 await pose('dkr-new-northwest',{center:[-97.7325,30.2838],zoom:17.1,pitch:60,bearing:135});
 await pose('dkr-new-south',{center:[-97.73258,30.2831],zoom:18.35,pitch:72,bearing:180});
 const near=await page.evaluate(()=>window.slopesStadium.lod);
 check('close camera uses actual row geometry',near.near,near);
 await pose('dkr-new-north-gates',{center:[-97.73238,30.28484],zoom:18.45,pitch:78,bearing:180});
 await pose('dkr-new-west-ramp',{center:[-97.73380,30.28298],zoom:18.5,pitch:75,bearing:40});
 await pose('dkr-new-night',bowl,1);
 await pose('dkr-new-night-overview',overview,1);
 // Filters contributed after our boot must survive toggling DKR off.
 const filters=await page.evaluate(()=>{
  const m=window.__map,s=window.slopesStadium,id='parts-3d';
  const before=m.getFilter(id),sentinel=['!=',['get','name'],'__dkr_regression__'];
  m.setFilter(id,['all',before,sentinel]);s.setEnabled(false);
  const off=m.getFilter(id);s.setEnabled(true);
  m.setFilter(id,before);
  return {preserved:JSON.stringify(off).includes('__dkr_regression__'),active:s.filtered};
 });check('unrelated filters survive switch',filters.preserved&&filters.active,filters);
 await page.evaluate(()=>{window.SLOPES.on=false;});await page.waitForTimeout(500);
 const off=await page.evaluate(()=>!window.slopesStadium.group&&!window.slopesStadium.filtered);
 check('global switch restores fallback',off);
 await page.evaluate(()=>{window.SLOPES.on=true;});await page.waitForTimeout(700);
 check('global switch restores mesh',await page.evaluate(()=>!!window.slopesStadium.group&&window.slopesStadium.filtered));
 if(process.argv.includes('--perf')){
   await page.evaluate(v=>window.__map.jumpTo(v),bowl);
   const reps=[];
   for(let rep=-1;rep<3;rep++)for(const enabled of [false,true]){
     await page.evaluate(on=>window.slopesStadium.setEnabled(on),enabled);await page.waitForTimeout(1600);
     const sample=await page.evaluate(async()=>{
       const frames=[];let prev=performance.now();
       for(let i=0;i<181;i++){const now=await new Promise(requestAnimationFrame);if(i>0)frames.push(now-prev);prev=now;}
       frames.sort((a,b)=>a-b);return {p50:frames[90],p90:frames[162]};
     });
     if(rep>=0)reps.push({enabled,...sample});
   }
   results.perf={conditions:'Headless hardware WebGL, 1600x1000, 180 frames per rep, one warmup pair discarded, 3 interleaved pairs, vsync defaults; minimum per-rep medians. This is not physical-screen FPS.',reps};
   const before=Math.min(...reps.filter(r=>!r.enabled).map(r=>r.p50)),after=Math.min(...reps.filter(r=>r.enabled).map(r=>r.p50));
   check('frame time budget (3 ms)',after-before<3,{before,after,delta:after-before});
   await page.evaluate(()=>window.slopesStadium.setEnabled(true));
 }
 check('no page errors',results.errors.length===0,results.errors);
 fs.writeFileSync(`${OUT}/dkr-results.json`,JSON.stringify(results,null,2));
 assert.ok(results.checks.every(c=>c.ok),'DKR verification failed');
}finally{await browser.__done();}
