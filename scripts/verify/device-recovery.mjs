// Real-city recovery integration; desktop Chromium touch emulation, NOT a
// physical iPhone/Safari, thermal, GPU-memory, or performance benchmark.
// VERIFY_URL=... node scripts/verify/device-recovery.mjs --out <scratch-directory>
// --break-injection omits loss and must fail the observed-loss assertion.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {BASE, launch} from './chrome.mjs';

const args=process.argv.slice(2), at=args.indexOf('--out');
if(at<0||!args[at+1]||args[at+1].startsWith('--')){
  console.error('Usage: node device-recovery.mjs --out <scratch-directory> [--break-injection]');
  process.exit(2);
}
const OUT=path.resolve(args[at+1]);
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const relative=path.relative(ROOT,OUT);
if(!relative||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative))){
  console.error('--out must be outside the repository; recovery records are scratch artifacts.');
  process.exit(2);
}
const BROKEN=args.includes('--break-injection');
const READY_MS=Number(process.env.DEVICE_READY_MS||300000);
if(!Number.isFinite(READY_MS)||READY_MS<1000){console.error('Invalid DEVICE_READY_MS');process.exit(2);}
fs.mkdirSync(OUT,{recursive:true});
const report={kind:'desktop Chromium touch-emulated recovery integration',base:BASE,brokenInjection:BROKEN,
  limitations:['Not physical-phone or iPhone Safari evidence.','Not a performance, thermal, or total/GPU-memory benchmark.',
    'Large viewport is a DPR1 resize of the recovered touch-profile session, not fresh desktop-default settings.'],
  settings:{gpu:'hardware',cpuThrottle:1,tiles:'normal application tiles',initialViewport:{width:390,height:844,dpr:3}},
  valid:false,events:[],errors:[],consoleErrors:[],loading:[],screens:[]};
const save=()=>fs.writeFileSync(path.join(OUT,BROKEN?'device-recovery-broken.json':'device-recovery.json'),JSON.stringify(report,null,2));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let browser,page,context;
const full=s=>s.ready&&s.buildings===196&&!s.veil&&s.indexed&&!s.driving&&s.tiles&&s.slopesOn;
async function state(){return page.evaluate(()=>({
  ready:!!window.slopesApartments?.readyToReveal?.(),buildings:window.slopesApartments?.count?.buildings,
  veil:!!document.getElementById('veil'),indexed:!!window.__fly?.indexed?.(),driving:!!window.__fly?.eye?.().driving,
  tiles:!!window.__map?.areTilesLoaded?.(),slopesOn:!!window.SLOPES?.on,preset:window.GFX?.preset,
  coarse:matchMedia('(pointer: coarse)').matches,touch:navigator.maxTouchPoints,
  doc:window.__recoveryDocument,visibility:document.visibilityState,eye:window.__fly?.eye?.(),
  canvas:window.__map?{width:window.__map.getCanvas().width,height:window.__map.getCanvas().height,
    connected:window.__map.getCanvas().isConnected}:null,
  lost:window.__map?.painter?.context?.gl?.isContextLost(),
  phone:window.LITE_PROFILE?{on:window.LITE_PROFILE.on,safe:window.LITE_PROFILE.safe}:null,
  viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},
}));}
function healthy(){
  assert.equal(report.crashed,false,'page crashed');
  assert.equal(report.errors.length,0,'uncaught page errors');
  assert.equal(report.consoleErrors.length,0,'console errors');
  if(report.recovered)assert.equal(report.events.filter(e=>e.type==='document-start').length,2,'unexpected additional reload');
}
async function ready(label){
  const started=Date.now();let lastLog=0;
  while(Date.now()-started<READY_MS){
    healthy();
    let s;try{s=await state();}catch(e){s={evaluationError:String(e)};}
    report.lastState=s;
    if(Date.now()-lastLog>=10000){
      report.loading.push({label,elapsedMs:Date.now()-started,state:s});save();lastLog=Date.now();
      console.log(label,s.buildings,s.ready,s.tiles);
    }
    if(full(s)){
      assert.equal(s.lost,false,'ready city must have a live context');
      assert.equal(s.preset,'performance','natural touch profile must select performance');
      assert.ok(s.phone?.on&&!s.phone.safe,'full natural phone profile required');
      return s;
    }
    await sleep(1000);
  }
  throw Error('Full-city readiness timed out; partial city is not valid evidence');
}
// A resize lands a frame or more after it is asked for, and ready() read
// before it passes on the OLD canvas's tiles — then the capture catches the
// new viewport's tiles loading and "city must remain ready at capture" fails
// (seen 2026-09-24 at recovered-large: viewport 2560x1440, canvas still
// 1899x877 when ready() returned). Ready means ready at the requested view.
const settledAt=(s,e)=>!!(s.viewport&&s.viewport.width===e.width&&s.viewport.height===e.height&&s.viewport.dpr===e.dpr&&
  s.canvas&&s.canvas.height>0&&Math.abs(s.canvas.width/s.canvas.height-e.width/e.height)<.02);
async function secondShot(name,largeCDP=null){
  const want=name==='recovered-large'?{width:2560,height:1440,dpr:1}:
    name==='recovered-landscape'?{width:844,height:390,dpr:3}:{width:390,height:844,dpr:3};
  const t0=Date.now();
  for(;;){const s=await ready(name);if(settledAt(s,want)||Date.now()-t0>READY_MS)break;await sleep(500);}
  await sleep(2500);
  // Playwright screenshot reapplies its context viewport/DPR. Preserve the
  // explicit large-screen CDP metrics by capturing through CDP in that case.
  if(largeCDP)await largeCDP.send('Page.captureScreenshot',{format:'jpeg',quality:88});
  else await page.screenshot();
  await sleep(1200);
  const s=await state();assert.ok(full(s),'city must remain ready at capture');healthy();
  if(report.recovered)assert.equal(s.doc,report.recovered.doc,'recovered document changed');
  const expected=name==='recovered-large'?{width:2560,height:1440,dpr:1}:
    name==='recovered-landscape'?{width:844,height:390,dpr:3}:{width:390,height:844,dpr:3};
  assert.deepEqual(s.viewport,expected,'capture viewport and DPR must match the requested check');
  const file=path.join(OUT,name+'.jpg');
  if(largeCDP){
    const shot=await largeCDP.send('Page.captureScreenshot',{format:'jpeg',quality:88});
    fs.writeFileSync(file,Buffer.from(shot.data,'base64'));
  }else await page.screenshot({path:file,type:'jpeg',quality:88});
  report.screens.push({name,file,state:s});save();
}
try{
  report.crashed=false;save();
  browser=await launch(chromium,{gl:'hardware',maxMs:READY_MS*5+120000});
  context=await browser.newContext({viewport:{width:390,height:844},screen:{width:390,height:844},deviceScaleFactor:3,
    isMobile:true,hasTouch:true});
  await context.exposeBinding('__recoveryEvent',(_source,event)=>{report.events.push(event);save();});
  await context.addInitScript(()=>{
    if(location.href==='about:blank')return;
    window.__recoveryDocument=Date.now()+':'+Math.random();
    const emit=(type,extra={})=>window.__recoveryEvent({type,doc:window.__recoveryDocument,at:performance.now(),...extra}).catch(()=>{});
    emit('document-start');
    for(const type of ['webglcontextlost','webglcontextrestored','pageshow','pagehide'])
      addEventListener(type,e=>emit(type,{persisted:e.persisted}),true);
    const timer=setInterval(()=>{if(window.cancelGraphicsAutoDetect){window.cancelGraphicsAutoDetect();clearInterval(timer);}},20);
  });
  page=await context.newPage();page.setDefaultTimeout(15000);
  page.on('pageerror',e=>{report.errors.push({message:e.message,stack:e.stack});save();});
  page.on('console',m=>{if(m.type()==='error'){report.consoleErrors.push(m.text());save();}});
  page.on('crash',()=>{report.crashed=true;save();});
  const cdp=await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});
  const url=new URL('/',BASE);url.search='?intro=0&drift=0';
  await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:120000});
  report.initial=await ready('initial');
  assert.ok(report.initial.coarse&&report.initial.touch>0,'touch emulation must be active');
  await page.evaluate(()=>{window.cancelGraphicsAutoDetect();if(window.WAYFIND)window.WAYFIND.on=false;});
  await secondShot('before-recovery');
  const doc=report.initial.doc;
  assert.equal(report.events.filter(e=>e.type==='document-start').length,1,'unexpected reload before injection');
  report.todStart=await page.evaluate(()=>{
    const slider=document.getElementById('tod-slider'),play=document.getElementById('tod-play');
    slider.value='.8';slider.dispatchEvent(new Event('input',{bubbles:true}));play.click();
    return Number(slider.value);
  });
  await sleep(500);
  report.activeTimeOfDay=await page.evaluate(()=>({playing:document.getElementById('tod-play').classList.contains('playing'),
    value:Number(document.getElementById('tod-slider').value)}));
  assert.ok(report.activeTimeOfDay.playing&&report.activeTimeOfDay.value!==report.todStart,'TOD playback must actually advance');
  report.injection=await page.evaluate(broken=>{
    const map=window.__map,canvas=map.getCanvas(),gl=map.painter.context.gl;
    const emit=(type,extra={})=>window.__recoveryEvent({type,doc:window.__recoveryDocument,at:performance.now(),...extra}).catch(()=>{});
    const identity={connected:canvas.isConnected,glCanvas:gl.canvas===canvas,
      rendererMatches:window.slopes?.renderer?.getContext()===gl,lostBefore:gl.isContextLost()};
    if(!identity.connected||!identity.glCanvas||!identity.rendererMatches||identity.lostBefore)throw Error('Invalid live shared map context');
    const ext=gl.getExtension('WEBGL_lose_context');if(!ext)throw Error('WEBGL_lose_context unavailable');
    for(const type of ['webglcontextlost','webglcontextrestored'])canvas.addEventListener(type,()=>emit('direct-'+type,{lost:gl.isContextLost()}),{once:true});
    if(!broken)ext.loseContext();
    emit('loss-called',{lost:gl.isContextLost(),broken});
    setTimeout(()=>emit('loss-next-task',{lost:gl.isContextLost()}),0);
    if(!broken)setTimeout(()=>{try{ext.restoreContext();emit('restore-called',{lost:gl.isContextLost()});}
      catch(e){emit('restore-error',{error:String(e)});}},1800);
    return identity;
  },BROKEN);save();
  const observed=type=>report.events.some(e=>e.doc===doc&&e.type===type);
  const lossDeadline=Date.now()+(BROKEN?5000:15000);
  while(Date.now()<lossDeadline&&!observed('direct-webglcontextlost')){healthy();await sleep(250);}
  assert.ok(observed('direct-webglcontextlost'),'No actual context-loss event observed');
  assert.ok(report.events.some(e=>e.doc===doc&&e.type==='direct-webglcontextlost'&&e.lost),'loss event must report lost context');
  const reloadDeadline=Date.now()+45000;
  while(Date.now()<reloadDeadline&&!report.events.some(e=>e.type==='document-start'&&e.doc!==doc)){healthy();await sleep(500);}
  assert.ok(observed('direct-webglcontextrestored'),'No actual context-restored event observed');
  assert.ok(!observed('restore-error'),'restoreContext threw');
  assert.ok(report.events.some(e=>e.type==='document-start'&&e.doc!==doc),'Expected app recovery reload was not observed');
  report.recovered=await ready('recovered');
  healthy();
  const movementStart=await page.evaluate(()=>window.__fly.eye());
  await page.keyboard.down('w');await sleep(1000);await page.keyboard.up('w');await sleep(500);
  const movementEnd=await page.evaluate(()=>window.__fly.eye());
  report.movementMetres=Math.hypot((movementEnd.lng-movementStart.lng)*111320*Math.cos(movementStart.lat*Math.PI/180),
    (movementEnd.lat-movementStart.lat)*111320);
  assert.ok(report.movementMetres>=.5,'Movement did not resume after recovery');
  await ready('before-touch');
  const joy=await page.locator('#joystick-base').boundingBox();
  assert.ok(joy&&joy.width>0&&joy.height>0,'visible touch joystick required');
  const touchStart=await page.evaluate(()=>window.__fly.eye());
  const point={x:joy.x+joy.width/2,y:joy.y+joy.height/2,id:1};
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
  try{
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...point,y:point.y-joy.height*.3}]});
    await sleep(1000);
  }finally{await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
  const touchEnd=await page.evaluate(()=>window.__fly.eye());
  report.touchMovementMetres=Math.hypot((touchEnd.lng-touchStart.lng)*111320*Math.cos(touchStart.lat*Math.PI/180),
    (touchEnd.lat-touchStart.lat)*111320);
  assert.ok(report.touchMovementMetres>=.5,'Touch joystick did not resume after recovery');
  await secondShot('recovered-portrait');
  await page.setViewportSize({width:844,height:390});await secondShot('recovered-landscape');
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:2560,height:1440,deviceScaleFactor:1,mobile:false});
  await secondShot('recovered-large',cdp);
  healthy();report.valid=true;console.log('PASS: real full-city context loss, restoration, reload, movement and viewport recovery');
}catch(e){report.failure=String(e);console.error(report.failure);process.exitCode=1;}
finally{save();if(browser)await browser.__done();}
