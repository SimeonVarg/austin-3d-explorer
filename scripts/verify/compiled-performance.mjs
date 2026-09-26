// Frozen actual-city AB/BA gates. Hardware GL, no CPU throttling. Every raw
// rendered-frame sample is retained; shadow/proxy stalls are not discarded.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {chromium} from 'playwright-core';
import {launch,HW_ARGS} from './chrome.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const args=process.argv.slice(2),arg=k=>args[args.indexOf(k)+1];
assert(args.includes('--out')&&args.includes('--baseline')&&process.env.VERIFY_URL,'--out, --baseline and VERIFY_URL required');
const OUT=path.resolve(arg('--out')),baseline=JSON.parse(fs.readFileSync(arg('--baseline'),'utf8'));
assert(!OUT.startsWith(ROOT+path.sep),'Use external evidence');fs.mkdirSync(OUT,{recursive:true});
const frozen=baseline.gates,base=baseline.cold[0],outsideIds=base.perBuilding.filter(r=>r.outsideActive).map(r=>r.id);
const WELCH={center:[-97.73785,30.2867],zoom:18.5,pitch:57,bearing:22};
const manifestOnDisk=JSON.parse(fs.readFileSync(path.join(ROOT,'data/compiled-buildings/manifest.json'),'utf8'));
function buildingPose(key,pose){const b=manifestOnDisk.buildings.find(e=>e.key===key).bounds;
  return {...pose,localCentre:[(b.min[0]+b.max[0])/2,(b.min[1]+b.max[1])/2]};}
const route=[{center:[-97.745,30.28745],zoom:17.5,pitch:64,bearing:60},
  {center:[-97.7425,30.2869],zoom:17.3,pitch:64,bearing:78},
  {center:[-97.73785,30.2867],zoom:18.1,pitch:57,bearing:22}];
const poses=[{name:'welch-day',...WELCH,p:.3},{name:'welch-night',...WELCH,p:.82},
  {name:'welch-grazing',center:WELCH.center,zoom:18.1,pitch:68,bearing:78,p:.3},
  {name:'west-day',...route[0],p:.3},{name:'west-night',...route[0],p:.82},
  buildingPose('standard',{name:'standard-day',zoom:18,pitch:55,bearing:150,p:.3}),
  buildingPose('standard',{name:'standard-night',zoom:18,pitch:55,bearing:150,p:.82}),
  buildingPose('nueces',{name:'nueces-day',zoom:18.2,pitch:55,bearing:40,p:.3}),
  buildingPose('nueces',{name:'nueces-night',zoom:18.2,pitch:55,bearing:40,p:.82}),
  buildingPose('gdc',{name:'gdc-day',zoom:19,pitch:66,bearing:-45,p:.3}),
  buildingPose('gdc',{name:'gdc-night',zoom:19,pitch:66,bearing:-45,p:.82}),
  buildingPose('painter',{name:'painter-day',zoom:19.2,pitch:60,bearing:155,p:.3})];
// These scopes are disjoint: generation next(), generator finalization, then
// reconstruction/ownership work after compilation or worker decoding. A
// returned Promise ends a synchronous scope; its eventual wait is not timed.
function installWorkTiming(){
  window.__recordBuildingWork=(mode,bucket,phase,id,started)=>{
    const finished=performance.now(),ms=finished-started,key=mode==='compiled'?'__compiledWork':'__assetBaseline';
    const work=window[key]||={generationMs:0,finalizationMs:0,reconstructionMs:0,generationCalls:0,finalizationCalls:0,reconstructionCalls:0,phases:{}};
    work[bucket+'Ms']+=ms;work[bucket+'Calls']++;
    const entry=work.phases[phase]||={bucket,calls:0,ms:0};entry.calls++;entry.ms+=ms;
    const c=window.__compiledPerf;
    if(c?.active)c.generatorSlices.push({type:bucket,phase,id,started:performance.timeOrigin+started,finished:performance.timeOrigin+finished,ms});
    return ms;
  };
  window.__measureBuildingWork=(mode,bucket,phase,id,work)=>{
    const started=performance.now();
    try{return work();}finally{window.__recordBuildingWork(mode,bucket,phase,id,started);}
  };
}
let source=fs.readFileSync(path.join(ROOT,'js/slopes-apartments.js'),'utf8').replace(/\r\n/g,'\n');
function patch(a,b){assert.equal(source.split(a).length,2,'Instrumentation drift: '+a);source=source.replace(a,b);}
patch('    for (const spec of _data.buildings) {\n      const pendingStart=',`    const timedNext=(it,id)=>window.__measureBuildingWork('legacy','generation','generator',id,()=>it.next());
    for (const spec of _data.buildings) {
      const pendingStart=`);
patch('        let r = it.next();','        let r = timedNext(it,spec.id);');
patch('while (!r.done) { await pause(); r = it.next(); }','while (!r.done) { await pause(); r = timedNext(it,spec.id); }');
patch('      const plan=window.FacadeFilter?.planFaces({faces:B.filterPending,options:APTS.facadeFilter});',
  "      const plan=window.__measureBuildingWork('legacy','finalization','filtered-plan',null,()=>window.FacadeFilter?.planFaces({faces:B.filterPending,options:APTS.facadeFilter}));");
patch('        addFilteredFace(B,entry.face,entry.options);',
  "        window.__measureBuildingWork('legacy','finalization','filtered-raster',null,()=>addFilteredFace(B,entry.face,entry.options));");
const legacyAssembly=`      B.filtered=batchFiltered(B.filtered);
      count.filteredBatches=B.filtered.length;
      geom = B.geometries ? B.geometries() : [B.geometry()];
      const mat = S.material({side:APTS.twoSided?T.DoubleSide:T.FrontSide});
      const g = new T.Group();
      g.userData.lod = APTS.lod;
      g.userData.minzoom = APTS.minzoom;
      g.name = 'slopes-apartments';
      _builtFrame = S.frames;
      geom.forEach((gm, i) => {
        const mesh = new T.Mesh(gm, mat);
        mesh.name = i ? 'apartments-' + (i + 1) : 'apartments';
        g.add(mesh);
      });
      for(const m of B.filtered)g.add(m);`;
patch(legacyAssembly,`      const g=window.__measureBuildingWork('legacy','finalization','assembly',null,()=>{
${legacyAssembly}
        return g;
      });`);
// Count every synchronous compiler slice immediately, including work retired
// by cancellation before compileBuilding returns. Keep production metrics too
// so missing or mismatched accounting is visible in the evidence.
patch('    const started=performance.now(); let generationMs=0, finalizationMs=0;',`    const started=performance.now(); let generationMs=0, finalizationMs=0;
    const measure=(type,t,phase)=>window.__recordBuildingWork('compiled',type,phase,spec.id,t);`);
patch('        const t=performance.now(); result=it.next(); generationMs+=performance.now()-t;',
  "        const t=performance.now();try{result=it.next();}finally{generationMs+=measure('generation',t,'generator');}");
patch('      const plan=window.FacadeFilter?.planFaces({faces:B.filterPending,options:filterOptions});',
  "      const plan=window.__measureBuildingWork('compiled','finalization','filtered-plan',spec.id,()=>window.FacadeFilter?.planFaces({faces:B.filterPending,options:filterOptions}));");
patch('        const t=performance.now(); addFilteredFace(B,entry.face,entry.options); finalizationMs+=performance.now()-t;',
  "        const t=performance.now();try{addFilteredFace(B,entry.face,entry.options);}finally{finalizationMs+=measure('finalization',t,'filtered-raster');}");
const compiledAssembly=`      B.filterPending.length=0; B.filtered=batchFiltered(B.filtered);
      geometries=B.geometries();
      const group=new T.Group(); group.name=spec.id; group.userData.buildingId=spec.id;
      group.userData.retainGeometryCpu=!!options.retainGeometryCpu;
      material=S.material({side:APTS.twoSided?T.DoubleSide:T.FrontSide});
      for (const [i,geometry] of geometries.entries()) {
        geometry.computeBoundingBox(); geometry.computeBoundingSphere();
        const mesh=new T.Mesh(geometry,material); mesh.name=spec.id+'/opaque/'+String(i).padStart(4,'0');
        mesh.userData.buildingId=spec.id; group.add(mesh);
      }
      for (const mesh of B.filtered) { mesh.userData.buildingId=spec.id; group.add(mesh); }`;
patch('      const t=performance.now();\n'+compiledAssembly+'\n      finalizationMs+=performance.now()-t;',
  `      const t=performance.now();let group;
      try {
${compiledAssembly.replace('const group=new T.Group();','group=new T.Group();')}
      } finally {finalizationMs+=measure('finalization',t,'assembly');}`);
let residencySource=fs.readFileSync(path.join(ROOT,'js/building-residency.js'),'utf8').replace(/\r\n/g,'\n');
function patchResidency(a,b){assert.equal(residencySource.split(a).length,2,'Residency instrumentation drift: '+a);residencySource=residencySource.replace(a,b);}
const emitNeedle='  const emit=event=>{events.push({at:now(),...event});if(events.length>tune.eventLimit)events.splice(0,events.length-tune.eventLimit);};';
patchResidency(emitNeedle,`  const emit=event=>{const item={at:now(),...event};events.push(item);
    const c=window.__compiledPerf;if(c?.active)c.loaderEvents.push(item);
    if(events.length>tune.eventLimit)events.splice(0,events.length-tune.eventLimit);};`);
// Instrument the helper, not selected call sites: this includes all coarse
// envelopes and every generated detail, including work later cancelled.
patchResidency('function generatedObject(result,T) {',`function generatedObject(result,T) {
  return window.__measureBuildingWork('compiled','reconstruction','generated-object',result.metadata?.id||result.group.userData.buildingId,()=>generatedObjectWork(result,T));
}
function generatedObjectWork(result,T) {`);
const assetObject=`        object=createBuildingObject(loaded.asset,{THREE:T,slopes:S,pickId:r.pickId});
        Object.assign(object,buildingResources(object.group),{triangles:loaded.asset.stats.triangles,bounds:r.bounds});
        // The decoded typed views share the whole FBA backing store, including
        // metadata padding. Keep that actual owner in CPU accounting.
        object.cpuBytes=Math.max(object.cpuBytes,loaded.bytes);object.assetHash=entry.hash;`;
patchResidency(assetObject,`        window.__measureBuildingWork('compiled','reconstruction','asset-object',r.id,()=>{
${assetObject}
        });`);
const heroPrepare=`          const adapter=new BuildingHeroAdapter({map,id:r.id,onState(state,detail){
            if(state!=='restored'||!['context-lost','style-reset'].includes(detail?.reason))return;
            queueMicrotask(()=>{if(!closed&&r.hero===adapter){evict(r);r.retryAt=0;schedule();}});
          }});
          hero=adapter;
          await adapter.prepare(loaded.asset.maplibre.featureCollection,{signal:controller.signal});`;
patchResidency(heroPrepare,`          const prepared=window.__measureBuildingWork('compiled','reconstruction','hero-prepare',r.id,()=>{
${heroPrepare.replace('          await adapter.prepare(', '          return adapter.prepare(')}
          });
          await prepared;`);
patchResidency('      if(hero)hero.commit({attach,detach});else attach();',
  "      if(hero)window.__measureBuildingWork('compiled','reconstruction','hero-commit',r.id,()=>hero.commit({attach,detach}));else attach();");
let lightingSource=fs.readFileSync(path.join(ROOT,'js/city-lighting.js'),'utf8').replace(/\r\n/g,'\n');
const proxyNeedle='  function proxyRebuild(map) {';
assert.equal(lightingSource.split(proxyNeedle).length,2,'Scheduled shadow rebuild instrumentation drift');
lightingSource=lightingSource.replace(proxyNeedle,`  function proxyRebuild(map) {
    const c=window.__compiledPerf,t=performance.timeOrigin+performance.now();
    try{return proxyRebuildWork(map);}finally{if(c?.active)c.shadowRebuilds.push({started:t,finished:performance.timeOrigin+performance.now()});}
  }
  function proxyRebuildWork(map) {`);
const report={started:new Date().toISOString(),settings:{viewport:frozen.viewport,cpuThrottle:1,preset:'balanced',gl:'hardware',route,legMs:6000},
  accounting:{version:2,total:'synchronousMs = generationMs + finalizationMs + reconstructionMs',
    generation:'Synchronous generator next() calls, including cancelled or failed builds',
    finalization:'Filtered-face planning/rasterization and geometry/material/group assembly',
    reconstruction:'Every generated-object bounds/resource scan, compiled asset geometry/resources, synchronous GDC prepare prefix and commit',
    excluded:'Worker decode, async imports, readiness/yield waits and GPU upload; production reported metrics are separate, never added again'},
  frozen,runs:[],errors:[],shots:[]};
const save=()=>fs.writeFileSync(path.join(OUT,'performance.json'),JSON.stringify(report,null,2));
const quantile=(a,p)=>{const b=a.slice().sort((x,y)=>x-y);return b[Math.min(b.length-1,Math.floor((b.length-1)*p))];};
const stats=a=>({count:a.length,min:Math.min(...a),median:quantile(a,.5),p95:quantile(a,.95),max:Math.max(...a)});
const pairs=args.includes('--pairs')?Number(arg('--pairs')):3;
if(args.includes('--check-instrumentation')){
  for(const [name,body] of [['slopes-apartments',source],['building-residency',residencySource],['city-lighting',lightingSource]]){
    const result=spawnSync(process.execPath,['--input-type=module','--check'],{input:body,encoding:'utf8'});
    assert.equal(result.status,0,name+' instrumented syntax: '+(result.error||result.stderr));
  }
  // Calling prepare currently covers all of its main-thread source work. If
  // it gains post-await work, instrument those slices before accepting a run.
  const adapter=fs.readFileSync(path.join(ROOT,'js/building-hero-adapter.js'),'utf8');
  const prepareBody=adapter.slice(adapter.indexOf('  async prepare('),adapter.indexOf('  commit('));
  assert(prepareBody.startsWith('  async prepare(')&&! /\bawait\b/.test(prepareBody),'GDC prepare acquired an untimed async continuation');
  let clock=0;
  const timingWindow={__compiledPerf:{active:true,generatorSlices:[]}};
  vm.runInNewContext('('+installWorkTiming.toString()+')()',{window:timingWindow,performance:{now:()=>clock,timeOrigin:1000}});
  const measure=timingWindow.__measureBuildingWork;
  assert.equal(measure('legacy','generation','generator','test',()=>{clock+=3;return 42;}),42,'return value preserved');
  const failure=new Error('deliberate finalization failure');
  assert.throws(()=>measure('legacy','finalization','assembly','test',()=>{clock+=4;throw failure;}),e=>e===failure);
  assert.equal(timingWindow.__assetBaseline.finalizationMs,4,'failed assembly counted immediately');
  const cancelled=Object.assign(new Error('deliberate cancellation'),{name:'AbortError'});
  assert.throws(()=>measure('compiled','reconstruction','asset-object','test',()=>{clock+=5;throw cancelled;}),e=>e===cancelled);
  assert.equal(timingWindow.__compiledWork.reconstructionMs,5,'cancelled work counted immediately');
  let finish;const pending=new Promise(resolve=>{finish=resolve;});
  const returned=measure('compiled','reconstruction','hero-prepare','test',async()=>{clock+=6;await pending;clock+=7;});
  assert.equal(timingWindow.__compiledWork.reconstructionMs,11,'async prefix counted before readiness');
  clock+=10000;finish();await returned;
  assert.equal(timingWindow.__compiledWork.reconstructionMs,11,'wait and continuation excluded from prefix');
  measure('legacy','generation','generator','test',()=>{clock+=2;});
  assert.equal(timingWindow.__assetBaseline.generationMs,5,'subsequent builds retain prior work');
  for(const work of [timingWindow.__assetBaseline,timingWindow.__compiledWork])for(const bucket of ['generation','finalization','reconstruction']){
    const phases=Object.values(work.phases).filter(p=>p.bucket===bucket);
    assert.equal(phases.reduce((n,p)=>n+p.ms,0),work[bucket+'Ms'],'phase milliseconds partition '+bucket);
    assert.equal(phases.reduce((n,p)=>n+p.calls,0),work[bucket+'Calls'],'phase calls partition '+bucket);
  }
  assert.equal(timingWindow.__compiledPerf.generatorSlices.length,5,'all timed work retained in the motion trace');
  console.log('Three instrumented modules parse; timing return, failure, cancellation, async-prefix, accumulation and partition controls pass');
  process.exit(0);
}
const browser=await launch(chromium,{gl:'hardware',maxMs:2400000,args:[...HW_ARGS,'--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling']});
let page,context;
async function settle(){
  for(let attempt=0;attempt<6;attempt++){
    await page.evaluate(async()=>{await window.slopesApartments.residency?.settled({timeoutMs:150000});});
    await page.waitForFunction(()=>window.slopesApartments.readyToReveal()&&window.__map.areTilesLoaded(),null,{timeout:60000});
    const before=await page.evaluate(()=>{
      const r=window.slopesApartments.residency?.snapshot(),frame=window.slopes.frames;
      window.__map.triggerRepaint();
      return {frame,idle:!r||(!r.busy&&!r.pending),event:JSON.stringify(r?.events.at(-1)??null)};
    });
    // Attachment is not a useful view until the new detail has actually drawn.
    await page.waitForFunction(frame=>{
      const ready=window.slopes.frames>=frame+2&&window.slopesApartments.readyToReveal()&&window.__map.areTilesLoaded();
      if(!ready)window.__map.triggerRepaint();
      return ready;
    },before.frame,{timeout:60000});
    const after=await page.evaluate(()=>{
      const r=window.slopesApartments.residency?.snapshot();
      return {idle:!r||(!r.busy&&!r.pending),event:JSON.stringify(r?.events.at(-1)??null)};
    });
    if(before.idle&&after.idle&&before.event===after.event)return;
  }
  throw new Error('Residency changed throughout six fresh rendered-view checks');
}
// Never return MapLibre's map or event to Playwright: serializing that graph
// can wedge the measurement before the first route sample is collected.
async function visit(pose){await page.evaluate(pose=>{window.__map.jumpTo(pose);},pose);await settle();await page.waitForTimeout(800);}
async function traverse(){
  const legs=[];
  for(const pose of route.slice(1))legs.push(await page.evaluate(pose=>new Promise((resolve,reject)=>{
    const m=window.__map,started=performance.now(),token='compiled-performance-'+started;
    let timer;
    const finish=error=>{
      clearTimeout(timer);m.off('moveend',onEnd);
      if(error){reject(error);return;}
      const c=m.getCenter(),actual={center:[c.lng,c.lat],zoom:m.getZoom(),pitch:m.getPitch(),bearing:m.getBearing()};
      const bearingError=Math.abs(((actual.bearing-pose.bearing+540)%360)-180);
      if(Math.abs(c.lng-pose.center[0])>1e-6||Math.abs(c.lat-pose.center[1])>1e-6||Math.abs(actual.zoom-pose.zoom)>1e-5||Math.abs(actual.pitch-pose.pitch)>1e-5||bearingError>1e-5){
        reject(new Error('Camera leg ended away from its target: '+JSON.stringify(actual)));return;
      }
      resolve({elapsedMs:performance.now()-started,actual});
    };
    const onEnd=event=>{if(event.compiledPerformanceLeg===token)finish();};
    timer=setTimeout(()=>finish(new Error('Camera leg exceeded 30 seconds')),30000);
    m.on('moveend',onEnd);
    try{m.easeTo({...pose,duration:6000,essential:true,easing:t=>t},{compiledPerformanceLeg:token});}catch(error){finish(error);}
  }),pose));
  await page.waitForTimeout(2000);return legs;
}
async function snapshot(){return page.evaluate(outsideIds=>{
  const A=window.slopesApartments,S=window.slopes,R=A.residency?.snapshot(),outside=new Set(outsideIds);
  const work=window.__compiledWork||window.__assetBaseline;
  const gl=window.__map.getCanvas().getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info');
  const arrays=new Set(),attrs=new Set(),geometries=new Set();let cpu=0,gpu=0;
  A.group.traverse(o=>{if(o.geometry&&!geometries.has(o.geometry)){geometries.add(o.geometry);for(const a of [...Object.values(o.geometry.attributes),o.geometry.index].filter(Boolean)){
    if(a.array&&!arrays.has(a.array.buffer)){arrays.add(a.array.buffer);cpu+=a.array.buffer.byteLength;}
    if(a.array&&!attrs.has(a)){attrs.add(a);gpu+=a.array.byteLength;}
  }}});
  return {renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null,count:A.count.buildings,triangles:A.count.triangles,
    generationMs:work.generationMs,finalizationMs:work.finalizationMs,reconstructionMs:work.reconstructionMs,
    synchronousMs:work.generationMs+work.finalizationMs+work.reconstructionMs,
    generationCalls:work.generationCalls,finalizationCalls:work.finalizationCalls,reconstructionCalls:work.reconstructionCalls,workPhases:work.phases,
    reportedGenerationMs:R?.generationMs??null,reportedFinalizationMs:R?.finalizationMs??null,
    groupCpuGeometryBytes:cpu,groupGpuGeometryBytes:gpu,residency:R,
    outsideCpuBytes:R?R.records.filter(r=>outside.has(r.id)).reduce((n,r)=>n+r.cpuBytes,0)+R.inactiveBytes:null,
    outsideGpuBytes:R?R.records.filter(r=>outside.has(r.id)).reduce((n,r)=>n+r.coarseGeometryBytes+r.activeGeometryBytes,0):null,
    shadow:S.sunlightStats(),tiles:window.__map.areTilesLoaded(),ready:A.readyToReveal()};
},outsideIds);}
function assertHealthy(s,label){
  assert(s.ready&&s.tiles,label+': useful rendered view');
  for(const bucket of ['generation','finalization','reconstruction']){
    const phases=Object.values(s.workPhases).filter(p=>p.bucket===bucket);
    assert(Math.abs(phases.reduce((n,p)=>n+p.ms,0)-s[bucket+'Ms'])<.001,label+': '+bucket+' phase accounting');
    assert.equal(phases.reduce((n,p)=>n+p.calls,0),s[bucket+'Calls'],label+': '+bucket+' call accounting');
  }
  if(!s.residency)return;
  const r=s.residency;
  assert(!r.closed&&!r.contextLost&&!r.busy&&!r.pending,label+': no pending allocator');
  assert.equal(r.stagingCpuBytes,0,label+': no CPU staging owner');assert.equal(r.stagingGpuBytes,0,label+': no GPU staging owner');
  assert.deepEqual(r.records.filter(x=>x.error),[],label+': no failed detail');
  assert.deepEqual(r.records.filter(x=>x.wanted&&!x.active&&!x.budgetDeferred),[],label+': every requested detail is active or explicitly budget deferred');
  for(const key of ['cpuBytes','gpuBytes','inactiveBytes'])assert(r[key]<=r.limits[key],label+': '+key+' within limit');
  assert(!r.events.some(e=>['runtime-error','coarse-failed','manifest-failed','failed'].includes(e.type)),label+': no hidden runtime failure');
}
try{
 for(let pair=0;pair<pairs;pair++)for(const mode of pair%2?['compiled','legacy']:['legacy','compiled']){
  context=await browser.newContext({viewport:{width:1280,height:720},deviceScaleFactor:1});page=await context.newPage();
  const errors=[],warnings=[];page.on('pageerror',e=>errors.push(String(e)));
  page.on('console',m=>{if(['warning','error'].includes(m.type()))warnings.push({at:Date.now(),type:m.type(),text:m.text()});});
  await page.route('**/js/slopes-apartments.js*',r=>r.fulfill({contentType:'application/javascript',body:source}));
  await page.route('**/js/building-residency.js*',r=>r.fulfill({contentType:'application/javascript',body:residencySource}));
  await page.route('**/js/city-lighting.js*',r=>r.fulfill({contentType:'application/javascript',body:lightingSource}));
  await page.addInitScript(installWorkTiming);
  await page.addInitScript(()=>{const t=setInterval(()=>{window.cancelGraphicsAutoDetect?.();if(window.cancelGraphicsAutoDetect)clearInterval(t);},10);});
  const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
  console.log('Cold',pair,mode);const t0=Date.now();
  await page.goto(process.env.VERIFY_URL.replace(/\/$/,'')+'/index.html?intro=0&drift=0&preset=balanced&clip=1&buildings='+mode,{waitUntil:'domcontentloaded',timeout:120000});
  await page.waitForFunction(()=>window.slopesApartments?.group&&window.slopesApartments.readyToReveal()&&!document.getElementById('veil')&&!window.__fly?.eye().driving,null,{timeout:180000});
  await page.evaluate(pose=>{window.cancelGraphicsAutoDetect();window.GFX.autoExposure=false;window.GFX.stars=0;window.GFX.grain=0;window.applyGraphics();if(window.WAYFIND)window.WAYFIND.on=false;window.applyTimeOfDay(window.__map,.3,true);window.__map.jumpTo(pose);},WELCH);
  await settle();const cold={firstUsefulDistrictMs:Date.now()-t0,...await snapshot()};
  assertHealthy(cold,'cold '+mode);
  assert.equal(cold.count,196);assert(cold.renderer&&!/software|swiftshader|llvmpipe/i.test(cold.renderer));
  if(mode==='compiled'){
    for(const id of ['ca0207d3-bbf8-408d-a319-9407d7bd0dd2','82bcddc0-ec33-4a0a-a9f2-f380a838a40f','44e418d6-dd3a-48da-8e9d-c29e59593299'])assert(cold.residency.records.find(r=>r.id===id)?.active,'first useful district has all three full assets');
    assert(cold.workPhases['generated-object']?.calls>=cold.count,'every coarse object finalization counted');
    assert(cold.workPhases['asset-object']?.calls>=3,'all first-view asset reconstructions counted');
    assert(cold.workPhases['hero-prepare']?.calls>=1&&cold.workPhases['hero-commit']?.calls>=1,'GDC synchronous source preparation and commit counted');
  }
  else assert.equal(cold.groupGpuGeometryBytes,base.actualGeometryBytes,'baseline geometry must stay unchanged');
  const run={pair,mode,cold,errors,warnings};report.runs.push(run);save();
  console.log('Ready',pair,mode,JSON.stringify({wallMs:cold.firstUsefulDistrictMs,syncMs:cold.synchronousMs,reconstructionMs:cold.reconstructionMs,outsideCpu:cold.outsideCpuBytes,outsideGpu:cold.outsideGpuBytes}));
  // Routing disables caching in Playwright's page and worker sessions. The
  // instrumented modules have loaded, so remove interception before warming.
  await page.unroute('**/js/slopes-apartments.js*');
  await page.unroute('**/js/building-residency.js*');
  await page.unroute('**/js/city-lighting.js*');
  await cdp.send('Network.setCacheDisabled',{cacheDisabled:false});
  // Visit both endpoints and the intervening actual city before measuring.
  // The second traversal still exercises eviction/reentry under normal limits.
  report.phase={pair,mode,step:'warm-route',at:new Date().toISOString()};save();
  await visit(route[0]);run.warmRoute=await traverse();await settle();await visit(route[0]);
  report.phase={pair,mode,step:'measured-route',at:new Date().toISOString()};save();
  await page.evaluate(()=>{
    const S=window.slopes,render=S.renderer.render,proxy=window.CityLighting.shadowProxy;
    const capture=window.__compiledPerf={active:false,frames:[],otherRenderPasses:[],shadow:[],shadowRebuilds:[],longTasks:[],loaderEvents:[],generatorSlices:[]};
    S.renderer.render=function(scene,camera){const colour=scene===S.scene&&camera===S.camera,t=performance.timeOrigin+performance.now();
      const result=render.apply(this,arguments);if(capture.active){
        const pass={started:t,finished:performance.timeOrigin+performance.now()};
        if(colour)capture.frames.push(pass);else capture.otherRenderPasses.push({...pass,kind:scene===S.scene?'sun-shadow':'staging',target:!!this.getRenderTarget(),cameraType:camera.type});
      }return result;};
    window.CityLighting.shadowProxy=function(){const t=performance.timeOrigin+performance.now();const result=proxy.apply(this,arguments);
      if(capture.active)capture.shadow.push({started:t,finished:performance.timeOrigin+performance.now()});return result;};
    capture.observer=new PerformanceObserver(list=>{if(capture.active)for(const e of list.getEntries())capture.longTasks.push({started:performance.timeOrigin+e.startTime,ms:e.duration});});
    capture.observer.observe({type:'longtask',buffered:false});capture.active=true;capture.started=performance.timeOrigin+performance.now();
  });
  run.measuredRoute=await traverse();
  run.motion=await page.evaluate(()=>{const c=window.__compiledPerf;c.active=false;const finished=performance.timeOrigin+performance.now();
    for(const e of c.observer.takeRecords())c.longTasks.push({started:performance.timeOrigin+e.startTime,ms:e.duration});c.observer.disconnect();
    return {started:c.started,finished,frames:c.frames,otherRenderPasses:c.otherRenderPasses,shadow:c.shadow,shadowRebuilds:c.shadowRebuilds,longTasks:c.longTasks,events:c.loaderEvents,generatorSlices:c.generatorSlices};});
  // Worker 'started' includes fetch/stream time. Decode is an off-thread
  // interval ending at finished; network overlap is never labelled decoding.
  run.motion.decodes=run.motion.events.filter(e=>e.type==='decoded').map(e=>({...e,requestStarted:e.started,started:e.finished-e.decodeMs,offMainThread:true}));
  const frames=run.motion.frames;assert(frames.length>100,'need real rendered frames throughout the route');
  run.frameStats=stats(frames.slice(1).map((f,i)=>f.finished-frames[i].finished));
  const boundaries=[{started:run.motion.started,finished:frames[0].finished,boundary:'start'},
    ...frames.slice(1).map((f,i)=>({started:frames[i].finished,finished:f.finished})),
    {started:frames.at(-1).finished,finished:run.motion.finished,boundary:'end'}];
  run.gaps=boundaries.map(g=>({...g,ms:g.finished-g.started})).filter(g=>g.ms>100).map(g=>({...g,
    uploads:run.motion.events.filter(e=>['upload','texture-upload'].includes(e.type)&&e.finished>=g.started&&e.started<=g.finished),
    decodes:run.motion.decodes.filter(e=>e.finished>=g.started&&e.started<=g.finished),
    generated:run.motion.events.filter(e=>e.type==='generated'&&e.finished>=g.started&&e.started<=g.finished),
    generatorSlices:run.motion.generatorSlices.filter(e=>e.finished>=g.started&&e.started<=g.finished),
    shadow:run.motion.shadow.filter(e=>e.finished>=g.started&&e.started<=g.finished&&e.finished-e.started>5),
    shadowRebuilds:run.motion.shadowRebuilds.filter(e=>e.finished>=g.started&&e.started<=g.finished),
    otherRenderPasses:run.motion.otherRenderPasses.filter(e=>e.finished>=g.started&&e.started<=g.finished&&e.finished-e.started>5),
    longTasks:run.motion.longTasks.filter(e=>e.started+e.ms>=g.started&&e.started<=g.finished)}));
  await settle();run.after=await snapshot();assertHealthy(run.after,'after route '+mode);save();
  console.log('Warm route',pair,mode,JSON.stringify(run.frameStats),'gaps >100ms',run.gaps.length);
  if(pair===0&&!args.includes('--no-shots'))for(let pose of poses){
    report.phase={pair,mode,step:'screenshot-'+pose.name,at:new Date().toISOString()};save();
    pose=await page.evaluate(pose=>{if(pose.localCentre){const c=window.slopes.toLngLat(...pose.localCentre,0);pose.center=[c.lng,c.lat];delete pose.localCentre;}return pose;},pose);
    await page.evaluate(pose=>{window.applyTimeOfDay(window.__map,pose.p,true);window.__map.jumpTo(pose);},pose);await settle();
    const visible=await snapshot();assertHealthy(visible,'screenshot '+pose.name);
    if(mode==='compiled'){
      const keys=pose.name.startsWith('west-')?['standard','nueces']:[pose.name.split('-')[0]];
      for(const key of keys){const id=manifestOnDisk.buildings.find(e=>e.key===key)?.id;
        assert(id&&visible.residency.records.find(r=>r.id===id)?.active,'full asset visible for '+pose.name);}
    }
    await page.evaluate(()=>{window.slopesApartments.group.uuid=window.THREE.MathUtils.generateUUID();window.__map.triggerRepaint();});
    await page.waitForTimeout(2300);await page.screenshot();await page.waitForTimeout(650);
    const file=mode+'-'+pose.name+'.png';await page.screenshot({path:path.join(OUT,file)});report.shots.push({file,pose,mode});save();
  }
  assert.deepEqual(errors,[]);
  assert(!warnings.some(w=>/\[compiled-buildings\]|INVALID_OPERATION|out of memory|shader.*(?:error|failed)/i.test(w.text)),'no building/GL failures hidden by coarse fallback');
  await context.close();context=null;
 }
 const A=report.runs.filter(r=>r.mode==='legacy'),B=report.runs.filter(r=>r.mode==='compiled');
 report.comparisons=Array.from({length:pairs},(_,pair)=>{const a=A.find(r=>r.pair===pair),b=B.find(r=>r.pair===pair);return {pair,
   medianRatio:b.frameStats.median/a.frameStats.median,p95Ratio:b.frameStats.p95/a.frameStats.p95,
   synchronousReduction:1-b.cold.synchronousMs/a.cold.synchronousMs,
   outsideCpuReduction:1-b.cold.outsideCpuBytes/base.outsideActiveGeometryBytes,outsideGpuReduction:1-b.cold.outsideGpuBytes/base.outsideActiveGeometryBytes};});
 const summary=rows=>Object.fromEntries(['median','p95','max'].map(k=>[k,{min:Math.min(...rows.map(r=>r.frameStats[k])),max:Math.max(...rows.map(r=>r.frameStats[k]))}]));
 report.ranges={legacy:summary(A),compiled:summary(B)};
 report.gates={threePairs:pairs===3,memory:report.comparisons.every(r=>r.outsideCpuReduction>=.5&&r.outsideGpuReduction>=.5),
   generation:report.comparisons.every(r=>r.synchronousReduction>=.3),
   median:report.comparisons.filter(r=>r.medianRatio>1.1).length<2,p95:report.comparisons.filter(r=>r.p95Ratio>1.1).length<2,
   uploadSlices:B.every(r=>r.motion.events.filter(e=>['upload','texture-upload'].includes(e.type)&&e.started>=r.motion.started&&e.started<=r.motion.finished).every(e=>e.ms<=100))};
 report.gapAttribution='All >100ms gaps retained above. Short uploads overlapping an existing shadow stall are not automatically exonerated or blamed; compare paired raw traces before accepting the new-gap gate.';
 report.numericPass=Object.values(report.gates).every(Boolean);
 report.motionAttribution={status:'pending',pass:null,reason:'Inspect every retained render gap and paired traces before accepting the new-gap gate.'};
 report.pass=null;report.status=report.numericPass?'pending-motion-attribution':'failed-numeric-gates';report.finished=new Date().toISOString();save();
 if(!report.numericPass)process.exitCode=1;
 console.log('Frozen numeric gates',JSON.stringify(report.gates));
}catch(e){report.fatal=String(e.stack||e);report.pass=false;save();console.error(e);process.exitCode=1;}
finally{await browser.close();browser.__done?.();save();}
