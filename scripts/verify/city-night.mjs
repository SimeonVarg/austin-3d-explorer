// Real-app night integration: shader variants, sources, pavement occlusion,
// unchanged sunset, and interleaved incremental frame cost. One GPU browser.
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright-core';
import {BASE,launch} from './chrome.mjs';
const out=process.env.VERIFY_OUT;
if(!out)throw Error('Set VERIFY_OUT to a scratch directory');
fs.mkdirSync(out,{recursive:true});
const broken=process.argv.includes('--break'),lite=process.argv.includes('--lite');
const result={when:new Date().toISOString(),site:BASE,broken,lite,checks:[],errors:[],perf:[]};
const check=(name,ok,detail)=>{result.checks.push({name,ok,detail});console.log(`${ok?'PASS':'FAIL'} ${name} ${JSON.stringify(detail??'')}`);};
const browser=await launch(chromium,{gl:'hardware',maxMs:10*60000});
try{
 const page=await browser.newPage({viewport:lite?{width:393,height:852}:{width:1440,height:900},deviceScaleFactor:1});
 page.on('pageerror',e=>{result.errors.push(e.message);console.log('PAGE ERROR '+e.message);});
 page.on('console',m=>{if(m.type()==='error'){result.errors.push(m.text().slice(0,600));console.log('CONSOLE ERROR '+m.text().slice(0,600));}});

 await page.goto(`${BASE}/index.html?intro=0&drift=0&clip=1&labels=0&${lite?'lite=1':'preset=balanced'}`,{waitUntil:'domcontentloaded',timeout:120000});
 console.log('LOADED '+JSON.stringify(await page.evaluate(()=>({intro:window.__intro,on:window.APARTMENTS?.on,group:!!window.slopesApartments?.group,count:window.slopesApartments?.count?.buildings,map:!!window.__map,veil:!!document.getElementById('veil')}))));
 await page.waitForFunction(()=>window.__map?.isStyleLoaded(),null,{timeout:90000});
 await page.evaluate(()=>window.cancelGraphicsAutoDetect());
 await page.waitForFunction(()=>window.slopesApartments?.readyToReveal()&&window.slopesApartments.group&&!document.getElementById('veil'),null,{timeout:300000}).catch(async e=>{console.log('LOAD STATE '+JSON.stringify(await page.evaluate(()=>({group:!!window.slopesApartments?.group,count:window.slopesApartments?.count?.buildings,ms:window.slopesApartments?.count?.ms,hidden:window.slopesApartments?.hidden,frames:window.slopes?.frames,veil:!!document.getElementById('veil'),intro:window.__intro&&{reason:window.__intro.reason,modelLate:window.__intro.modelLate,modelFallback:window.__intro.modelFallback},errors:window.__errors}))));console.log('LOAD ERRORS '+JSON.stringify(result.errors));await page.screenshot({path:path.join(out,'load-failed.jpg')});throw e;});
 result.loaded=await page.evaluate(()=>({buildMs:window.slopesApartments.count.ms,buildings:window.slopesApartments.count.buildings,group:!!window.slopesApartments.group,intro:window.__intro&&{reason:window.__intro.reason,modelLate:window.__intro.modelLate,modelFallback:window.__intro.modelFallback}}));console.log('READY '+JSON.stringify(result.loaded));
 await page.evaluate(()=>{
  window.cancelGraphicsAutoDetect();
  window.__nightCapture=()=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('capture timed out')),15000);const m=window.__map;m.once('render',()=>{try{const gl=m.painter.context.gl,a=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,a);clearTimeout(timer);resolve(a);}catch(e){clearTimeout(timer);reject(e);}});m.triggerRepaint();});
  window.__nightDiff=(a,b,region=[0,0,1,1])=>{const gl=window.__map.painter.context.gl,W=gl.drawingBufferWidth,H=gl.drawingBufferHeight;let changed=0,n=0;
   for(let y=Math.floor(region[1]*H);y<Math.floor(region[3]*H);y++)for(let x=Math.floor(region[0]*W);x<Math.floor(region[2]*W);x++){const i=((H-1-y)*W+x)*4;n++;if(Math.max(Math.abs(a[i]-b[i]),Math.abs(a[i+1]-b[i+1]),Math.abs(a[i+2]-b[i+2]))>3)changed++;}return {changed,n,fraction:changed/Math.max(1,n)};};
 });
 async function pose(view,p){
  await page.evaluate(({view,p})=>{const m=window.__map;m.stop();m.jumpTo({...view,roll:0});window.applyTimeOfDay(m,p,true);},{view,p});
  await page.waitForFunction(()=>window.__map.areTilesLoaded()&&window.slopesApartments.readyToReveal(),null,{timeout:90000});
  await page.waitForTimeout(4200);
  await page.evaluate(async()=>{await window.__nightCapture();});console.log('POSE '+p);
 }
 async function shot(name){await page.screenshot();await page.waitForTimeout(800);await page.screenshot({path:path.join(out,name+'.jpg'),type:'jpeg',quality:90});}
 const routes=JSON.parse(fs.readFileSync(new URL('./night-routes.json',import.meta.url),'utf8'));
 function routeView(eye,target){
  const rad=v=>v*Math.PI/180,deg=v=>v*180/Math.PI,mlon=111320*Math.cos(rad(eye[1])),mlat=110540;
  const dx=(target[0]-eye[0])*mlon,dy=(target[1]-eye[1])*mlat,bearing=deg(Math.atan2(dx,dy));
  const pitch=Math.min(88,Math.max(5,deg(Math.atan2(Math.hypot(dx,dy),eye[2]-target[2]))));
  const d=eye[2]*Math.tan(rad(pitch)),lat=eye[1]+Math.cos(rad(bearing))*d/mlat;
  const zoom=Math.log2(40075016.686*Math.cos(rad(lat))/(512*(eye[2]/Math.cos(rad(pitch))/(450/Math.tan(rad(29))))));
  return {center:[eye[0]+Math.sin(rad(bearing))*d/mlon,lat],zoom,pitch,bearing};
 }
 if(process.argv.includes('--ground-study')){
  result.study='Fixed public poses; legacy street strength .62/spread 1.5 versus .18/.85, all other render settings retained.';
  for(const routeId of ['skyline-south-shore','wc-street']){
   const route=routes.routes.find(r=>r.id===routeId),p=routeId==='wc-street'?route.poses.find(p=>p.id==='rio-grande-23rd'):route.poses[0];
   await pose(routeView(p.eye,p.target),1);
   await page.evaluate(()=>{window.NIGHT_TUNE.LAMP_DIM=.62;window.NIGHT_TUNE.LAMP_SPREAD=1.5;window.nightRetune(window.__map);});
   await shot(routeId+'-legacy-strength');
   console.log('GROUND '+JSON.stringify(await page.evaluate(()=>({lights:window.__nightLights,layers:window.__map.getStyle().layers.filter(l=>l.type==='circle').map(l=>l.id)}))));
   await page.evaluate(()=>{window.NIGHT_TUNE.PAVEMENT_POOLS=false;window.nightRetune(window.__map);});await shot(routeId+'-old-order');
   await page.evaluate(()=>{window.NIGHT_TUNE.PAVEMENT_POOLS=true;window.nightRetune(window.__map);for(const id of ['night-streetlight-pool','night-streetlight-core'])window.__map.setLayoutProperty(id,'visibility','none');});await shot(routeId+'-streetlamps-off');
   await page.evaluate(()=>{for(const l of window.__map.getStyle().layers)if(l.type==='circle')window.__map.setLayoutProperty(l.id,'visibility','none');});await shot(routeId+'-all-circles-off');
   await page.evaluate(()=>{for(const l of window.__map.getStyle().layers)if(l.type==='circle')window.__map.setLayoutProperty(l.id,'visibility','visible');window.NIGHT_TUNE.LAMP_DIM=.18;window.NIGHT_TUNE.LAMP_SPREAD=.85;window.nightRetune(window.__map);});await shot(routeId+'-tuned');
   await page.evaluate(()=>{window.NIGHT_TUNE.LAMP_DIM=.62;window.NIGHT_TUNE.LAMP_SPREAD=1.5;window.nightRetune(window.__map);});
  }
 } else {
 const wc={center:[-97.7448,30.2872],zoom:17.3,pitch:72,bearing:292};
 await pose(wc,.5);
 const day=await page.evaluate(async()=>{
  const n=window.CityNight;await window.__nightCapture();const a=await window.__nightCapture(),control=window.__nightDiff(a,await window.__nightCapture());
  n.tune.on=false;await window.__nightCapture();const toggle=window.__nightDiff(a,await window.__nightCapture());n.tune.on=true;return {control,toggle};
 });
 check('night sources preserve sunset pixels',day.toggle.changed<=day.control.changed+10,day);
 await shot('sunset');
 await pose(wc,1);
 if(broken)await page.evaluate(()=>window.CityNight.tune.emissionGain=0);
 const emission=await page.evaluate(async()=>{
  const n=window.CityNight;await window.__nightCapture();const a=await window.__nightCapture(),control=window.__nightDiff(a,await window.__nightCapture()),gain=n.tune.emissionGain;
  n.tune.emissionGain=0;await window.__nightCapture();const effect=window.__nightDiff(a,await window.__nightCapture());n.tune.emissionGain=gain;return {control,effect};
 });
 check('window emission changes the actual night image',emission.effect.changed>Math.max(100,emission.control.changed*4),emission);
 await shot('west-campus-night');
 if(!broken){
 // Render the subclass that extends the shared vertex shader. A test looking
 // only at apartments missed the removed u_p declaration used by DKR.
 await pose({center:[-97.7323,30.2835],zoom:17.4,pitch:65,bearing:170},.69);
 const shaders=await page.evaluate(()=>({stadium:window.slopesStadium.count,nightClock:window.slopes.uniforms().u_nightLamps.value,
  failures:window.slopes.renderer.info.programs.filter(p=>p.diagnostics?.runnable===false).map(p=>p.diagnostics),cityFailures:window.CityLighting.stats.failures,gl:window.slopes.renderer.getContext().getError()}));
 check('DKR and shared shaders compile at twilight',shaders.stadium.sections===88&&shaders.failures.length===0&&shaders.cityFailures.length===0&&shaders.gl===0&&shaders.nightClock>.99,shaders);
 await shot('dkr-twilight');
 if(!lite){
  const street=routes.routes.find(r=>r.id==='wc-street').poses.find(p=>p.id==='rio-grande-23rd');
  await pose(routeView(street.eye,street.target),1);
  await page.waitForFunction(()=>window.__map.areTilesLoaded(),null,{timeout:90000});await page.waitForTimeout(4200);
  await shot('street-night');
  const pools=await page.evaluate(async regions=>{
   const m=window.__map,ids=['night-streetlight-pool','night-streetlight-core'];await window.__nightCapture();const lit=await window.__nightCapture(),control=window.__nightDiff(lit,await window.__nightCapture());
   for(const id of ids)m.setLayoutProperty(id,'visibility','none');await window.__nightCapture();const dark=await window.__nightCapture();
   for(const id of ids)m.setLayoutProperty(id,'visibility','visible');await window.__nightCapture();
   window.NIGHT_TUNE.PAVEMENT_POOLS=false;window.nightRetune(m);await window.__nightCapture();const oldOrder=await window.__nightCapture();
   window.NIGHT_TUNE.PAVEMENT_POOLS=true;window.nightRetune(m);await window.__nightCapture();const newOrder=await window.__nightCapture();
   window.NIGHT_TUNE.DEPTH_POOLS=false;await window.__nightCapture();const overlay=await window.__nightCapture();window.NIGHT_TUNE.DEPTH_POOLS=true;await window.__nightCapture();
   return {control,overlayWalls:regions.wall.map(r=>window.__nightDiff(lit,overlay,r)),source:window.__nightDiff(lit,dark),walls:regions.wall.map(r=>window.__nightDiff(lit,dark,r)),pavement:window.__nightDiff(oldOrder,newOrder),order:m.getStyle().layers.map(l=>l.id).filter(id=>/^(night-streetlight|ground-paths|props-cons)/.test(id))};
  },street.regions);
  check('street lamps illuminate ground without painting over walls',pools.source.changed>100&&pools.walls.every(r=>r.fraction<.005),pools);
  check('wall check detects disabled depth testing',pools.overlayWalls.some(r=>r.fraction>.005),pools.overlayWalls);
  check('raised pavements receive the lamp layer',pools.pavement.changed>10,pools.pavement);
 }
 await pose(wc,1);
 const perf=await page.evaluate(()=>{
  const n=window.CityNight,m=window.__map,gl=m.painter.context.gl,rows=[];
  for(let rep=-1;rep<3;rep++)for(const on of (rep%2?[true,false]:[false,true])){n.tune.on=on;for(let i=0;i<4;i++){m.redraw();gl.finish();}const start=performance.now();for(let i=0;i<24;i++){m.redraw();gl.finish();}if(rep>=0)rows.push({rep,on,ms:(performance.now()-start)/24});}
  n.tune.on=true;m.triggerRepaint();const ext=gl.getExtension('WEBGL_debug_renderer_info');
  return {rows,renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),viewport:[innerWidth,innerHeight],preset:window.GFX.preset,renderScale:window.GFX.renderScale,cpuThrottle:1,
   note:'One hardware browser; actual map.redraw plus gl.finish; one warmup pair discarded, three interleaved pairs. Isolates shared night sources at a fixed night scene, not total main-vs-branch cost.'};
 });
 result.perf=perf;
 const off=Math.min(...perf.rows.filter(r=>!r.on).map(r=>r.ms)),on=Math.min(...perf.rows.filter(r=>r.on).map(r=>r.ms));
 console.log('PERF '+JSON.stringify({off,on,delta:on-off,...perf}));
 }
 }
 check('no browser or shader errors',result.errors.length===0,result.errors);
}catch(e){
 result.fatal=e.stack||String(e);console.error(result.fatal);
}finally{
 const failed=result.checks.filter(c=>!c.ok);
 result.expectedFailure=broken&&!result.fatal&&failed.length===1&&failed[0].name==='window emission changes the actual night image';
 fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify(result,null,2));
 await browser.__done();
}
// A load/shader failure is not a successful emitter sabotage.
process.exit(result.fatal?2:broken?(result.expectedFailure?1:2):result.checks.every(c=>c.ok)?0:1);
