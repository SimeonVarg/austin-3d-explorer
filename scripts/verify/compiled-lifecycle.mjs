// Actual-city lifecycle proof. No fixture scene or renderer substitutions.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
import {launch,HW_ARGS} from './chrome.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const args=process.argv.slice(2),arg=k=>args[args.indexOf(k)+1];
if(!args.includes('--out')||!process.env.VERIFY_URL)throw Error('--out and VERIFY_URL required');
const OUT=path.resolve(arg('--out'));if(OUT.startsWith(ROOT+path.sep))throw Error('Use external evidence');
fs.mkdirSync(OUT,{recursive:true});
const IDs={welch:'ca0207d3-bbf8-408d-a319-9407d7bd0dd2',painter:'82bcddc0-ec33-4a0a-a9f2-f380a838a40f',gdc:'44e418d6-dd3a-48da-8e9d-c29e59593299',nueces:'01b885c4-03ff-45d4-b394-707735cb6958',standard:'36365d18-2eb6-43c5-b042-6197e7767e17'};
const WELCH={center:[-97.73785,30.2867],zoom:18.5,pitch:57,bearing:22};
const WEST={center:[-97.745,30.28745],zoom:17.5,pitch:64,bearing:60};
const manifestOnDisk=JSON.parse(fs.readFileSync(path.join(ROOT,'data/compiled-buildings/manifest.json'),'utf8'));
function buildingPose(key,pose){const b=manifestOnDisk.buildings.find(e=>e.id===IDs[key]).bounds;
  return {...pose,localCentre:[(b.min[0]+b.max[0])/2,(b.min[1]+b.max[1])/2]};}
const report={started:new Date().toISOString(),checks:[],errors:[],warnings:[],gpuWarnings:[],shots:[],states:[]};
const save=()=>fs.writeFileSync(path.join(OUT,'lifecycle.json'),JSON.stringify(report,null,2));
const browser=await launch(chromium,{gl:'hardware',maxMs:720000,args:[...HW_ARGS,'--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling']});
let context,page,phase='boot';
async function state(label){
  phase=label;
  const s=await page.evaluate(()=>({residency:window.slopesApartments?.residency?.snapshot(),count:{buildings:window.slopesApartments?.count.buildings,triangles:window.slopesApartments?.count.triangles},
    ready:window.slopesApartments?.readyToReveal(),tiles:window.__map?.areTilesLoaded(),shadow:window.slopes?.sunlightStats(),
    lighting:window.CityLighting?.stats,invalidDeletes:window.__glDeleteAudit||[],
    frames:window.slopes?.frames,sceneRoot:window.slopes?.root?.uuid,rendererReady:!!window.slopes?.renderer,
    customLayer:!!window.__map?.getLayer(window.SLOPES?.layerId),contextLost:window.__map?.getCanvas().getContext('webgl2').isContextLost(),
    groupChildren:window.slopesApartments?.group?.children.map(g=>({id:g.userData.buildingId||g.name,coarse:!!g.userData.coarse,pickId:g.userData.pickId}))}));
  report.states.push({label,at:new Date().toISOString(),...s});save();return s;
}
async function settle(){await page.evaluate(async()=>{await window.slopesApartments.residency.settled({timeoutMs:150000});});
  await page.waitForFunction(()=>window.slopesApartments.readyToReveal()&&window.__map.areTilesLoaded(),null,{timeout:60000});}
async function shot(name,pose,p=.3){pose=await page.evaluate(pose=>{if(pose.localCentre){const c=window.slopes.toLngLat(...pose.localCentre,0);pose.center=[c.lng,c.lat];delete pose.localCentre;}return pose;},pose);
  await page.evaluate(({pose,p})=>{window.__map.jumpTo(pose);window.applyTimeOfDay(window.__map,p,true);}, {pose,p});
  await settle();await page.evaluate(()=>{window.slopesApartments.group.uuid=window.THREE.MathUtils.generateUUID();window.__map.triggerRepaint();});await page.waitForTimeout(2200);await page.screenshot();await page.waitForTimeout(650);
  await page.screenshot({path:path.join(OUT,name+'.png')});report.shots.push({name,pose,p});await state(name);}
async function retry(entry){await page.evaluate(entry=>window.slopesApartments.residency.retry(entry.id,entry),entry);await settle();}
async function record(id){return page.evaluate(id=>window.slopesApartments.residency.snapshot().records.find(r=>r.id===id),id);}
async function initialLoss(){
  phase='initial-context-loss';
  await page.waitForFunction(()=>window.slopes?.renderer&&window.slopesApartments?.count.generationMs>0&&!window.slopesApartments.group,null,{timeout:180000});
  await page.evaluate(()=>{
    const map=window.__map,gl=map.painter.context.gl,canvas=map.getCanvas();
    const ext=gl.getExtension('WEBGL_lose_context');
    if(!ext||window.slopes.renderer.getContext()!==gl)throw Error('Expected live context during initial coarse construction');
    window.__initialLoss={events:[],extension:ext};
    for(const type of ['webglcontextlost','webglcontextrestored'])canvas.addEventListener(type,()=>{
      window.__initialLoss.events.push({type,lost:gl.isContextLost(),at:performance.timeOrigin+performance.now()});
    },{once:true});
    ext.loseContext();
  });
  await page.waitForFunction(()=>window.__initialLoss.events.some(e=>e.type==='webglcontextlost'&&e.lost),null,{timeout:30000});
  await page.waitForTimeout(250);
  const first=await page.evaluate(()=>({generationMs:window.slopesApartments.count.generationMs,group:!!window.slopesApartments.group}));
  await page.waitForTimeout(400);
  const second=await page.evaluate(()=>({generationMs:window.slopesApartments.count.generationMs,group:!!window.slopesApartments.group}));
  assert(first.generationMs>0&&!first.group&&!second.group,'loss interrupts real initial construction before publication');
  assert.equal(second.generationMs,first.generationMs,'initial geometry work pauses while the real context is lost');
  await page.evaluate(()=>window.__initialLoss.extension.restoreContext());
  await page.waitForFunction(()=>window.__initialLoss.events.some(e=>e.type==='webglcontextrestored'&&!e.lost),null,{timeout:60000});
  report.initialContextLoss={first,second,events:await page.evaluate(()=>window.__initialLoss.events)};
  report.checks.push('Actual context loss during initial coarse construction pauses and resumes the existing build');save();
}
async function lifecycleFaults(){
  await page.evaluate(pose=>{window.__map.jumpTo(pose);window.applyTimeOfDay(window.__map,.3,true);},WELCH);await settle();
  const manifest=await page.evaluate(async()=>await(await fetch('/data/compiled-buildings/manifest.json')).json());
  const entry=manifest.buildings.find(e=>e.id===IDs.welch);
  assert(entry);
  const original=await record(entry.id);
  assert(original.active);
  await page.evaluate(id=>{
    const map=window.__map,A=window.slopesApartments;
    window.__ownershipFrames=[];
    const check=()=>{const groups=A.group?.children.filter(g=>g.userData.buildingId===id)||[];
      window.__ownershipFrames.push({at:performance.timeOrigin+performance.now(),count:groups.length,coarse:groups.filter(g=>g.userData.coarse).length,picks:groups.map(g=>g.userData.pickId)});};
    window.__ownershipCheck=check;map.on('render',check);
  },entry.id);
  await retry({...entry,file:'deliberately-missing.fba'});
  let r=await record(entry.id);assert(r.active&&/HTTP 404/.test(r.error),'failed replacement retains prior detailed object');
  await retry(entry);assert((await record(entry.id)).active);
  await retry({...entry,hash:'0'.repeat(64)});
  r=await record(entry.id);assert(r.active&&/SHA-256 mismatch/.test(r.error),'corrupt payload rejects before replacing the active object');
  await retry(entry);
  await retry({...entry,bytes:64*1024*1024+1});
  r=await record(entry.id);assert(r.active&&/budget/i.test(r.error),'oversized declared payload never starts allocation');
  await retry(entry);
  report.checks.push('404, wrong hash, and oversized replacement keep previous detailed building');

  await page.evaluate(id=>window.slopesApartments.residency.evict(id,{forget:true}),entry.id);
  await retry({...entry,file:'deliberately-missing.fba'});
  r=await record(entry.id);assert(!r.active&&r.coarse&&/HTTP 404/.test(r.error),'failed first load leaves independent coarse building');
  await state('failed-asset-coarse');
  await retry(entry);

  let release;const delayed=new Promise(resolve=>{release=resolve;});let intercepted=false;
  await context.route('**/deliberately-delayed.fba',async route=>{intercepted=true;await delayed;try{await route.fulfill({body:fs.readFileSync(path.join(ROOT,'data/compiled-buildings',entry.file)),contentType:'application/octet-stream'});}catch{}});
  await page.evaluate(entry=>window.slopesApartments.residency.retry(entry.id,{...entry,file:'deliberately-delayed.fba'}),entry);
  await page.waitForFunction(id=>window.slopesApartments.residency.snapshot().pending===id,entry.id,{timeout:30000});
  for(let i=0;i<100&&!intercepted;i++)await page.waitForTimeout(50);
  assert(intercepted,'cancel must interrupt an actual fetch');
  await page.evaluate(id=>window.slopesApartments.residency.evict(id,{forget:true}),entry.id);release();
  await settle();await context.unroute('**/deliberately-delayed.fba');
  r=await record(entry.id);assert(!r.active&&r.coarse,'late cancelled fetch cannot overwrite fallback');
  await retry(entry);
  await page.evaluate(id=>window.slopesApartments.residency.evict(id),entry.id);
  assert((await page.evaluate(()=>window.slopesApartments.residency.snapshot().cachedIds)).includes(entry.id));
  await page.evaluate(id=>window.slopesApartments.residency.retry(id),entry.id);await settle();
  assert((await record(entry.id)).active,'cached reentry rebuilds uploaded object');
  const end=await state('faults-and-reentry');
  assert(end.residency.events.some(e=>e.type==='cancelled'&&e.id===entry.id));
  assert(end.residency.events.some(e=>e.type==='cache-hit'&&e.id===entry.id));
  for(const key of ['Cpu','Gpu','Staging'])assert(end.residency['highWater'+key+'Bytes']<=end.residency.limits[key.toLowerCase()+'Bytes']);
  report.ownershipFrames=await page.evaluate(()=>{window.__map.off('render',window.__ownershipCheck);return window.__ownershipFrames;});
  assert(report.ownershipFrames.length>20);
  assert(report.ownershipFrames.every(f=>f.count===1&&f.picks[0]===original.pickId),'every rendered frame has exactly one owner with a stable pick ID');
  report.checks.push('Actual in-flight fetch cancellation retains fallback','Eviction disposes GPU objects, bounded decoded cache supports reentry','Every rendered frame owns exactly one Welch representation with a stable compact pick ID');
  console.log('Lifecycle fault checks passed');save();
}
async function rebuildAndRecovery(){
  const before=await state('before-rebuild');
  await page.evaluate(()=>{window.__retiredResidency=window.slopesApartments.residency;window.slopesApartments.rebuild();});
  await page.waitForFunction(()=>window.slopesApartments.residency&&window.slopesApartments.residency!==window.__retiredResidency&&window.slopesApartments.group,null,{timeout:180000});
  await settle();
  const retired=await page.evaluate(async()=>{await window.__retiredResidency.drained();return window.__retiredResidency.snapshot();});
  assert(retired.closed&&retired.records.length===0&&retired.cpuBytes===0&&retired.gpuBytes===0,'retired runtime releases all owned resources');
  const rebuilt=await state('rebuilt');
  assert.deepEqual(rebuilt.residency.records.map(r=>[r.id,r.pickId]),before.residency.records.map(r=>[r.id,r.pickId]),'rebuild preserves compact identities');
  for(const id of Object.values(IDs).slice(0,3))assert(rebuilt.residency.records.find(r=>r.id===id)?.active,'district details return after rebuild');
  assert.equal(new Set(rebuilt.groupChildren.map(g=>g.id)).size,rebuilt.groupChildren.length,'rebuild has one group per owner');
  report.checks.push('Full runtime rebuild drains the old allocator and preserves building/pick identities');

  phase='shared-context-loss';
  await page.evaluate(()=>{
    const map=window.__map,gl=map.painter.context.gl,canvas=map.getCanvas(),ext=gl.getExtension('WEBGL_lose_context');
    if(!ext||window.slopes.renderer.getContext()!==gl)throw Error('Expected the live shared WebGL context');
    window.__compiledRecovery=[];
    for(const type of ['webglcontextlost','webglcontextrestored'])canvas.addEventListener(type,()=>{
      window.__compiledRecovery.push({type,lost:gl.isContextLost(),at:performance.timeOrigin+performance.now()});
    },{once:true});
    ext.loseContext();setTimeout(()=>ext.restoreContext(),1000);
  });
  await page.waitForFunction(()=>window.__compiledRecovery.some(e=>e.type==='webglcontextlost'&&e.lost)&&window.__compiledRecovery.some(e=>e.type==='webglcontextrestored'&&!e.lost),null,{timeout:60000});
  await settle();
  const frameAfterRestore=await page.evaluate(()=>window.slopes.frames);
  await page.waitForFunction(frame=>window.slopes.frames>frame,frameAfterRestore,{timeout:30000});
  const restored=await state('context-restored');
  report.contextEvents=await page.evaluate(()=>window.__compiledRecovery);
  assert(!restored.contextLost&&restored.tiles&&restored.ready&&restored.rendererReady&&restored.customLayer&&restored.frames>frameAfterRestore,'same desktop document renders after actual context restoration');
  assert.deepEqual(restored.lighting?.failures,[],'restored MapLibre lighting shaders remain valid');
  assert.equal(restored.sceneRoot,rebuilt.sceneRoot,'context restoration reattaches the retained scene root');
  for(const id of Object.values(IDs).slice(0,3))assert(restored.residency.records.find(r=>r.id===id)?.active,'district detail survives context restoration');
  await shot('compiled-context-restored',WELCH);
  await shot('compiled-context-restored-night',WELCH,.82);
  report.checks.push('Actual shared-context loss and restoration retain the district and a rendering map');

  phase='page-reload';await page.reload({waitUntil:'domcontentloaded',timeout:120000});
  await page.waitForFunction(()=>window.slopesApartments?.group&&window.slopesApartments.residency&&!document.getElementById('veil')&&!window.__fly?.eye().driving,null,{timeout:180000});
  await page.evaluate(pose=>{window.cancelGraphicsAutoDetect();window.__map.jumpTo(pose);},WELCH);await settle();
  const reloaded=await state('page-reloaded');
  assert.equal(reloaded.count.buildings,196);assert.equal(reloaded.residency.records.length,197);
  assert(reloaded.residency.records.find(r=>r.id===IDs.welch)?.active,'normal page reload loads the compiled district');
  report.checks.push('Normal page reload re-enters the compiled district');

  phase='map-remove';
  const removed=await page.evaluate(async()=>{const A=window.slopesApartments,R=A.residency;window.__map.remove();await R.drained();return {runtime:R.snapshot(),group:!!A.group,invalidDeletes:window.__glDeleteAudit||[]};});
  report.removed=removed;
  assert(removed.runtime.closed&&removed.runtime.records.length===0&&removed.runtime.cpuBytes===0&&removed.runtime.gpuBytes===0&&!removed.group,'map removal closes workers, jobs and all building owners');
  report.checks.push('Removing the real map drains the worker/runtime and releases every building owner');
  console.log('Rebuild, shared-context recovery, page reload and map removal passed');save();
}
try{
  context=await browser.newContext({viewport:{width:1280,height:720},deviceScaleFactor:1});page=await context.newPage();
  page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{
    if((m.type()==='warning'||m.type()==='error')&&!report.warnings.includes(m.text()))report.warnings.push(m.text());
    if(/INVALID_|object does not belong|not a valid WebGL/i.test(m.text()))report.gpuWarnings.push({at:Date.now(),phase,text:m.text(),location:m.location()});
  });
  if(args.includes('--trace-deletes'))await page.addInitScript(()=>{
    // Diagnostic only: keep owner/context generation records without querying
    // or consuming GL errors. No production rendering path is changed.
    const owners=new WeakMap(),contexts=new WeakMap();window.__glDeleteAudit=[];
    const get=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(){const gl=get.apply(this,arguments);
      if(gl&&typeof gl.isContextLost==='function'&&!contexts.has(gl)){
        const state={epoch:0};contexts.set(gl,state);this.addEventListener('webglcontextlost',()=>{state.epoch++;});
      }return gl;};
    for(const proto of [window.WebGLRenderingContext?.prototype,window.WebGL2RenderingContext?.prototype].filter(Boolean))
      for(const type of ['Buffer','Texture','Program','Shader','Framebuffer','Renderbuffer','VertexArray','Query','Sampler','TransformFeedback']){
        const create=proto['create'+type],remove=proto['delete'+type];if(!create||!remove)continue;
        proto['create'+type]=function(){const value=create.apply(this,arguments);if(value)owners.set(value,{gl:this,epoch:contexts.get(this)?.epoch||0});return value;};
        proto['delete'+type]=function(value){const owner=value&&owners.get(value),epoch=contexts.get(this)?.epoch||0;
          if(owner&&!this.isContextLost()&&(owner.gl!==this||owner.epoch!==epoch))window.__glDeleteAudit.push({type,at:performance.timeOrigin+performance.now(),epoch,createdEpoch:owner.epoch,sameContext:owner.gl===this,stack:new Error().stack});
          return remove.apply(this,arguments);};
      }
  });
  await page.addInitScript(()=>{const t=setInterval(()=>{if(window.cancelGraphicsAutoDetect){window.cancelGraphicsAutoDetect();clearInterval(t);}},10);});
  const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});
  const t0=Date.now();await page.goto(process.env.VERIFY_URL.replace(/\/$/,'')+'/index.html?intro=0&drift=0&preset=balanced&clip=1&buildings=compiled',{waitUntil:'domcontentloaded',timeout:120000});
  if(args.includes('--initial-loss'))await initialLoss();
  await page.waitForFunction(()=>window.slopesApartments?.residency&&window.slopesApartments?.group&&!document.getElementById('veil')&&!window.__fly?.eye().driving,null,{timeout:180000});
  await page.evaluate(pose=>{window.cancelGraphicsAutoDetect();window.GFX.autoExposure=false;window.GFX.stars=0;window.GFX.grain=0;window.applyGraphics();if(window.WAYFIND)window.WAYFIND.on=false;window.applyTimeOfDay(window.__map,.3,true);window.__map.jumpTo(pose);},WELCH);
  await settle();report.firstUsefulDistrictMs=Date.now()-t0;
  const first=await state('first-welch');
  if(first.count.buildings!==196||first.residency.records.length!==197)throw Error('Incomplete actual city');
  for(const key of ['welch','painter','gdc'])if(!first.residency.records.find(r=>r.id===IDs[key])?.active)throw Error('District asset did not load: '+key);
  for(const key of ['cpuBytes','gpuBytes'])if(first.residency[key]>first.residency.limits[key])throw Error('Residency exceeds '+key);
  report.checks.push('196 independent coarse buildings plus GDC present','Welch/Painter/GDC active within budgets');
  console.log('First compiled district',JSON.stringify({ms:report.firstUsefulDistrictMs,generationMs:first.residency.generationMs,finalizationMs:first.residency.finalizationMs,cpuBytes:first.residency.cpuBytes,gpuBytes:first.residency.gpuBytes,active:first.residency.records.filter(r=>r.active).length,errors:first.residency.records.filter(r=>r.error)}));
  await shot('compiled-welch-day',WELCH);await shot('compiled-welch-night',WELCH,.82);
  await shot('compiled-welch-grazing',{center:[-97.73785,30.2867],zoom:18.1,pitch:68,bearing:78});
  if(!args.includes('--smoke')){
    await shot('compiled-west-day',WEST);
    const west=report.states.at(-1);
    for(const key of ['standard','nueces'])if(!west.residency.records.find(r=>r.id===IDs[key])?.active)throw Error('Apartment asset did not load: '+key);
    report.checks.push('Standard and 2400 Nueces independently enter the active district');
    await shot('compiled-west-night',WEST,.82);
    await shot('compiled-standard-day',buildingPose('standard',{zoom:18,pitch:55,bearing:150}));
    await shot('compiled-nueces-day',buildingPose('nueces',{zoom:18.2,pitch:55,bearing:40}));
    await shot('compiled-gdc-day',buildingPose('gdc',{zoom:19,pitch:66,bearing:-45}));
    await lifecycleFaults();
    await rebuildAndRecovery();
  }
  if(report.errors.length)throw Error(report.errors.join('; '));
  assert(!report.warnings.some(w=>/INVALID_OPERATION.*(?:bindTexture|bindBuffer|useProgram)|object does not belong to this context/i.test(w)),
    'restoration must not reuse invalid raw GPU handles');
  if(args.includes('--trace-deletes'))assert(report.states.every(s=>!s.invalidDeletes?.length)&&!report.removed?.invalidDeletes?.length,
    'no retired-context resource may be deleted after restoration');
  report.pass=true;report.finished=new Date().toISOString();save();
}catch(error){report.pass=false;report.fatal=String(error.stack||error);console.error(error);if(page&&!page.isClosed()){try{await state('failure');await page.screenshot({path:path.join(OUT,'failure.png')});}catch{}}process.exitCode=1;save();}
finally{await browser.close();browser.__done?.();save();}
