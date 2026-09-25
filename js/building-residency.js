import {BuildingAssetLoader, createBuildingObject, nextBuildingFrame, uploadBuildingObject} from './building-asset-runtime.js';

const MiB=1024*1024;
// All distance/quality and resource choices are explicit. This first slice is
// opt-in; acceptance uses the frozen actual-city gates, not these defaults.
export const BUILDING_RESIDENCY_DEFAULTS=Object.freeze({
  manifest:'./data/compiled-buildings/manifest.json',
  nearMetres:340, keepMarginMetres:110, zoomReference:18.5,
  maxNearMetres:850, minNearMetres:260,
  cpuBytes:320*MiB, gpuBytes:192*MiB, inactiveBytes:48*MiB, stagingBytes:64*MiB,
  chunkTriangles:8192, buildSliceMs:6, initialSliceMs:16,
  retryMs:30000, eventLimit:2400,
});

const abortError=()=>new DOMException('Cancelled','AbortError');
const now=()=>performance.timeOrigin+performance.now();
export function distanceToBounds(point,bounds) {
  return Math.hypot(Math.max(bounds.min[0]-point.x,0,point.x-bounds.max[0]),
    Math.max(bounds.min[1]-point.y,0,point.y-bounds.max[1]));
}
function segmentDistance(point,a,b) {
  const dx=b.x-a.x,dy=b.y-a.y,n=dx*dx+dy*dy;
  const t=n?Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/n)):0;
  return Math.hypot(point.x-a.x-t*dx,point.y-a.y-t*dy);
}
/** Conservative shadow extrusion in the existing ENU frame, without an
 * arbitrary distance cap at low sun. A distant coarse volume never disappears.
 */
export function canCastIntoDistrict(bounds,centre,radius,sun) {
  if(!sun||sun.z<=0)return false;
  const a={x:(bounds.min[0]+bounds.max[0])/2,y:(bounds.min[1]+bounds.max[1])/2};
  const h=Math.max(0,bounds.max[2]);
  const b={x:a.x-sun.x/sun.z*h,y:a.y-sun.y/sun.z*h};
  const half=Math.hypot(bounds.max[0]-bounds.min[0],bounds.max[1]-bounds.min[1])/2;
  return segmentDistance(centre,a,b)<=radius+half;
}

/** Count distinct backing stores, not per-view aliases. GPU textures include
 * their real mip pyramid. Shared city uniforms/shadow maps are excluded from
 * BOTH treatment and baseline authored-building denominators.
 */
export function buildingResources(group) {
  const arrays=new Set(),attributes=new Set(),textures=new Set(),geometries=new Set();
  let cpuBytes=0,geometryBytes=0,textureBytes=0,textureGpuBytes=0,triangles=0;
  const addArray=array=>{if(array&&!arrays.has(array.buffer)){arrays.add(array.buffer);cpuBytes+=array.buffer.byteLength;}};
  group.traverse(o=>{
    const g=o.geometry;
    if(g&&!geometries.has(g)){
      geometries.add(g);
      for(const a of [...Object.values(g.attributes),g.index].filter(Boolean)){
        const owner=a.isInterleavedBufferAttribute?a.data:a;
        if(owner.array){addArray(owner.array);if(!attributes.has(owner)){attributes.add(owner);geometryBytes+=owner.array.byteLength;}}
      }
      triangles+=(g.index?.count||g.attributes.position?.count||0)/3;
    }
    for(const texture of Object.values(o.userData?.facadeBatch?.textures||{})){
      if(textures.has(texture))continue; textures.add(texture);
      const img=texture.image; if(!img?.data)continue;
      addArray(img.data);textureBytes+=img.data.byteLength;
      let w=img.width,h=img.height,depth=img.depth||1;
      do{textureGpuBytes+=w*h*depth*4;if(!texture.generateMipmaps)break;w=Math.max(1,w>>1);h=Math.max(1,h>>1);}while(w>1||h>1);
      if(texture.generateMipmaps&&(img.width>1||img.height>1))textureGpuBytes+=depth*4;
    }
  });
  return {cpuBytes,geometryBytes,textureBytes,textureGpuBytes,gpuBytes:geometryBytes+textureGpuBytes,triangles};
}

function generatedObject(result,T) {
  const group=result.group;
  group.userData.retainGeometryCpu=true;
  const bounds=new T.Box3().setFromObject(group);
  const resources=buildingResources(group);
  let disposed=false;
  return {...result,...resources,bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()},
    dispose(){
      if(disposed)return;disposed=true;
      const materials=new Set();
      group.traverse(o=>{o.geometry?.dispose();if(o.userData?.disposeFacade)o.userData.disposeFacade();else if(o.material)materials.add(o.material);});
      for(const material of materials)material.dispose();group.clear();
    }};
}

export async function createBuildingResidency({map,THREE:T,slopes:S,catalog,compile,detail=1,signal,
  config={},onMetadata=()=>{},onFailure=()=>{},onMetrics=()=>{}}) {
  const tune={...BUILDING_RESIDENCY_DEFAULTS,...globalThis.BUILDING_RESIDENCY,...config};
  for(const key of ['nearMetres','minNearMetres','maxNearMetres','cpuBytes','gpuBytes','inactiveBytes','stagingBytes','chunkTriangles','retryMs'])
    if(!Number.isFinite(tune[key])||tune[key]<=0)throw Error('Invalid building residency budget: '+key);
  for(const key of ['keepMarginMetres','buildSliceMs','initialSliceMs'])
    if(!Number.isFinite(tune[key])||tune[key]<0)throw Error('Invalid building residency budget: '+key);
  if(!Number.isFinite(tune.zoomReference)||!Number.isSafeInteger(tune.eventLimit)||tune.eventLimit<=0||
    tune.minNearMetres>tune.maxNearMetres||!Number.isSafeInteger(tune.chunkTriangles))
    throw Error('Invalid building residency configuration');
  const group=new T.Group();group.userData.retainGeometryCpu=true;
  const records=new Map(),cache=new Map(),events=[],pins=new Set();
  const metrics={generationMs:0,finalizationMs:0,buildSlices:0,commits:0,evictions:0,cancellations:0,
    highWaterCpuBytes:0,highWaterGpuBytes:0,highWaterStagingBytes:0,visibleTriangles:0};
  let closed=false,started=false,contextLost=!!S.renderer?.getContext?.()?.isContextLost?.(),busy=false,dirty=false,job=null,refreshQueued=false,manifest=null,pumpPromise=Promise.resolve();
  let manifestURL=new URL(tune.manifest,location.href),baseURL=new URL('.',manifestURL);
  const canvas=map.getCanvas();
  const emit=event=>{events.push({at:now(),...event});if(events.length>tune.eventLimit)events.splice(0,events.length-tune.eventLimit);};
  const loader=new BuildingAssetLoader({concurrency:1,onEvent:emit});
  const checkAlive=()=>{if(closed||signal?.aborted||S.contextFallback)throw abortError();};
  const check=()=>{checkAlive();if(contextLost)throw abortError();};
  // Initial construction has no published controller to restart it. Keep its
  // completed coarse objects and pause at the next cooperative yield instead
  // of abandoning the whole build when the context is temporarily lost.
  const initialContext=async()=>{
    while(contextLost){checkAlive();await nextBuildingFrame();}
    checkAlive();
  };
  let slice=performance.now();
  const pause=async(initial=false)=>{
    if(initial)await initialContext();else check();
    if(performance.now()-slice<(initial?tune.initialSliceMs:tune.buildSliceMs))return;
    metrics.buildSlices++;map.triggerRepaint();await nextBuildingFrame();slice=performance.now();
    if(initial)await initialContext();else check();
  };
  function totals() {
    let cpuBytes=0,gpuBytes=0,geometryBytes=0,coarseBytes=0,activeBytes=0,inactiveBytes=0;
    for(const r of records.values()){
      cpuBytes+=r.coarse?.cpuBytes||0;gpuBytes+=r.coarse?.gpuBytes||0;
      geometryBytes+=r.coarse?.geometryBytes||0;coarseBytes+=r.coarse?.geometryBytes||0;
      if(r.active){cpuBytes+=r.active.cpuBytes;gpuBytes+=r.active.gpuBytes;
        geometryBytes+=r.active.geometryBytes;activeBytes+=r.active.geometryBytes;}
    }
    for(const item of cache.values())inactiveBytes+=item.bytes;
    cpuBytes+=inactiveBytes;
    const stagingCpuBytes=job?.cpuBytes||0,stagingGpuBytes=job?.gpuBytes||0;
    cpuBytes+=stagingCpuBytes;gpuBytes+=stagingGpuBytes;
    return {cpuBytes,gpuBytes,geometryBytes,coarseBytes,activeBytes,inactiveBytes,stagingCpuBytes,stagingGpuBytes};
  }
  function updateMetrics() {
    const n=totals();
    metrics.highWaterCpuBytes=Math.max(metrics.highWaterCpuBytes,n.cpuBytes);
    metrics.highWaterGpuBytes=Math.max(metrics.highWaterGpuBytes,n.gpuBytes);
    metrics.highWaterStagingBytes=Math.max(metrics.highWaterStagingBytes,n.stagingCpuBytes);
    metrics.visibleTriangles=[...records.values()].reduce((n,r)=>n+(r.active?.triangles||r.coarse?.triangles||0),0);
    onMetrics({...metrics,...n});return n;
  }
  const touchShadows=()=>{group.uuid=T.MathUtils.generateUUID();map.triggerRepaint();};
  function trimCache(required=0) {
    while(cache.size&&(totals().inactiveBytes>tune.inactiveBytes||totals().cpuBytes+required>tune.cpuBytes)){
      const [id,item]=cache.entries().next().value;cache.delete(id);emit({type:'cache-evict',id,bytes:item.bytes});
    }
  }
  function retainAsset(r,object) {
    if(!object.asset||closed)return;
    cache.delete(r.id);cache.set(r.id,{asset:object.asset,bytes:object.cpuBytes,hash:object.assetHash});trimCache();
  }
  function evict(r,{cacheAsset=true}={}) {
    if(!r.active)return;
    const object=r.active;r.active=null;
    r.budgetNeed={cpu:object.cpuBytes,gpu:object.gpuBytes};
    group.remove(object.group);if(r.coarse)group.add(r.coarse.group);
    const hero=r.hero;r.hero=null;hero?.dispose();
    if(cacheAsset)retainAsset(r,object);
    object.dispose();metrics.evictions++;emit({type:'evicted',id:r.id});touchShadows();updateMetrics();
  }
  function requestState() {
    const c=map.getCenter(),centre=S.toLocal(c.lng,c.lat,0),zoom=map.getZoom();
    const radius=Math.max(tune.minNearMetres,Math.min(tune.maxNearMetres,tune.nearMetres*Math.pow(2,(tune.zoomReference-zoom)/2)));
    const sun=S.uniforms()?.u_sunDirection?.value;
    const wanted=[];
    for(const r of records.values()){
      const d=distanceToBounds(centre,r.bounds);
      const casting=canCastIntoDistrict(r.bounds,centre,radius,sun);
      r.distance=d;r.shadowCaster=casting;
      r.wanted=pins.has(r.id)||d<=radius||casting;
      r.keep=r.wanted||(r.active&&d<=radius+tune.keepMarginMetres);
      r.rank=Infinity;
      if(r.wanted)wanted.push(r);
    }
    wanted.sort((a,b)=>(pins.has(b.id)-pins.has(a.id))||(a.distance-b.distance)||a.id.localeCompare(b.id));
    wanted.forEach((r,i)=>{r.rank=i;});
    return {centre,radius,wanted};
  }
  function cancelJob(reason) {
    if(!job||job.controller.signal.aborted)return;
    job.controller.abort();metrics.cancellations++;emit({type:'cancel-request',id:job.id,reason});
  }
  function schedule() {
    if(closed||contextLost||!started||refreshQueued)return;
    refreshQueued=true;
    queueMicrotask(()=>{refreshQueued=false;if(!closed)refresh();});
  }
  function refresh() {
    if(closed||contextLost||!started)return;
    const state=requestState();
    for(const r of records.values())if(r.active&&!r.keep&&!pins.has(r.id))evict(r);
    if(job&&!records.get(job.id)?.wanted)cancelJob('outside active district');
    dirty=true;
    if(!busy)pumpPromise=pump();
    return state;
  }
  function roomCandidates(except) {
    const target=records.get(except);
    // Only a strictly higher-priority request may displace resident detail.
    // That lets a nearer building enter a full district without two requested
    // buildings continually evicting and rebuilding one another.
    return [...records.values()].filter(r=>r.active&&r.id!==except&&!pins.has(r.id)&&
      (!r.wanted||r.rank>(target?.rank??Infinity)))
      .sort((a,b)=>(b.rank-a.rank)||(b.distance-a.distance));
  }
  function canMakeRoom(cpu,gpu,except) {
    const n=totals();let availableCpu=n.cpuBytes-n.inactiveBytes,availableGpu=n.gpuBytes;
    for(const r of roomCandidates(except)){availableCpu-=r.active.cpuBytes;availableGpu-=r.active.gpuBytes;}
    return availableCpu+cpu<=tune.cpuBytes&&availableGpu+gpu<=tune.gpuBytes;
  }
  function makeRoom(cpu,gpu,except) {
    trimCache(cpu);
    const candidates=roomCandidates(except);
    while(candidates.length&&(totals().cpuBytes+cpu>tune.cpuBytes||totals().gpuBytes+gpu>tune.gpuBytes))
      evict(candidates.shift(),{cacheAsset:false});
    return totals().cpuBytes+cpu<=tune.cpuBytes&&totals().gpuBytes+gpu<=tune.gpuBytes;
  }
  async function loadRecord(r) {
    const controller=new AbortController();job={id:r.id,controller,cpuBytes:0,gpuBytes:0};
    const entry=r.entry,revision=r.revision||0;
    const current=()=>{check();if(controller.signal.aborted||(r.revision||0)!==revision)throw abortError();};
    let object=null,hero=null;
    const startedAt=now();
    try {
      current();let loaded;
      if(entry){
        const cached=cache.get(r.id);
        if(cached?.hash===entry.hash){
          cache.delete(r.id);loaded={asset:cached.asset,bytes:cached.bytes};
          job.cpuBytes=loaded.bytes;updateMetrics();emit({type:'cache-hit',id:r.id});
        }
        else {
          cache.delete(r.id);
          if(!Number.isSafeInteger(entry.bytes)||entry.bytes<=0)throw Error('Invalid building asset byte count');
          if(entry.bytes>tune.stagingBytes)throw Error('Building staging budget exceeded');
          if(!makeRoom(entry.bytes,0,r.id)){
            r.budgetNeed={cpu:entry.bytes,gpu:0};
            const error=Error('Building residency budget deferred');error.name='BuildingBudgetDeferred';throw error;
          }
          job.cpuBytes=entry.bytes;updateMetrics();
          loaded=await loader.load(entry,baseURL,{signal:controller.signal});
        }
        current();
        object=createBuildingObject(loaded.asset,{THREE:T,slopes:S,pickId:r.pickId});
        Object.assign(object,buildingResources(object.group),{triangles:loaded.asset.stats.triangles,bounds:r.bounds});
        // The decoded typed views share the whole FBA backing store, including
        // metadata padding. Keep that actual owner in CPU accounting.
        object.cpuBytes=Math.max(object.cpuBytes,loaded.bytes);object.assetHash=entry.hash;
        if(loaded.asset.maplibre){
          const {BuildingHeroAdapter}=await import('./building-hero-adapter.js');
          const adapter=new BuildingHeroAdapter({map,id:r.id,onState(state,detail){
            if(state!=='restored'||!['context-lost','style-reset'].includes(detail?.reason))return;
            queueMicrotask(()=>{if(!closed&&r.hero===adapter){evict(r);r.retryAt=0;schedule();}});
          }});
          hero=adapter;
          await adapter.prepare(loaded.asset.maplibre.featureCollection,{signal:controller.signal});
        }
      } else {
        const t=now();
        const result=await compile(r.spec,{detail,filteredResolutionLevel:1,chunkTriangles:tune.chunkTriangles,
          retainGeometryCpu:true,yieldWalls:true,signal:controller.signal,pause:()=>pause(false)});
        metrics.generationMs+=result.counts.generationMs;metrics.finalizationMs+=result.counts.finalizationMs;
        emit({type:'generated',id:r.id,started:t,finished:now(),generationMs:result.counts.generationMs,finalizationMs:result.counts.finalizationMs});
        object=generatedObject(result,T);
      }
      current();
      if(object.cpuBytes>tune.stagingBytes)throw Error('Building staging budget exceeded');
      job.cpuBytes=0;
      if(!makeRoom(object.cpuBytes,object.gpuBytes,r.id)){
        r.budgetNeed={cpu:object.cpuBytes,gpu:object.gpuBytes};
        const error=Error('Building residency budget deferred');error.name='BuildingBudgetDeferred';throw error;
      }
      job.cpuBytes=object.cpuBytes;job.gpuBytes=object.gpuBytes;updateMetrics();
      await uploadBuildingObject(object,{THREE:T,slopes:S,map,signal:controller.signal,onEvent:emit});
      current();requestState();if(!r.wanted)throw abortError();
      // prepare has finished its source work; the geometry and source switch
      // happen in this task before another map frame can draw either version.
      const previous=r.active,previousHero=r.hero,ownedGroup=object.group;
      const attach=()=>{if(previous)group.remove(previous.group);if(r.coarse)group.remove(r.coarse.group);group.add(ownedGroup);};
      const detach=()=>{group.remove(ownedGroup);if(r.coarse)group.add(r.coarse.group);};
      // Callbacks and the MapLibre opacity switch are synchronous. There is
      // no frame with both versions or neither version in the color pass.
      if(hero)hero.commit({attach,detach});else attach();
      object.group.userData.pickId=r.pickId;
      r.active=object;r.hero=hero;r.lastUsed=now();r.error=null;r.retryAt=0;
      r.replace=false;r.budgetNeed=null;
      object=null;hero=null;job.cpuBytes=0;job.gpuBytes=0;
      previousHero?.dispose();previous?.dispose();
      metrics.commits++;touchShadows();emit({type:'committed',id:r.id,started:startedAt,finished:now(),compiled:!!entry,assetHash:entry?.hash});
    } catch(error) {
      if(error.name==='BuildingBudgetDeferred'){
        r.error=null;r.retryAt=0;emit({type:'budget-deferred',id:r.id,...r.budgetNeed});
      } else if(error.name!=='AbortError'&&!controller.signal.aborted&&(r.revision||0)===revision){
        r.error=error.message;r.retryAt=now()+tune.retryMs;
        emit({type:'failed',id:r.id,error:error.message});
        console.warn('[compiled-buildings]',r.name,error.message);
      }
    } finally {
      hero?.dispose();object?.dispose();job=null;trimCache();updateMetrics();
    }
  }
  async function pump() {
    busy=true;
    try {
      while(!closed&&!contextLost){
        dirty=false;
        const state=requestState();
        const next=state.wanted.find(r=>(!r.active||r.replace)&&(!r.retryAt||r.retryAt<=now())&&
          (!r.budgetNeed||canMakeRoom(r.budgetNeed.cpu,r.budgetNeed.gpu,r.id)));
        if(!next)break;
        await loadRecord(next);
        // Yield even for an immediate failure. A missing/corrupt asset cannot
        // spin or hold the main thread, and its existing fallback stays visible.
        await pause(false);
      }
    } catch(error){if(error.name!=='AbortError')emit({type:'runtime-error',error:error.message});}
    finally{busy=false;if(dirty&&!closed&&!contextLost)schedule();}
  }
  const loss=()=>{contextLost=true;cancelJob('context lost');};
  const restored=()=>{contextLost=false;schedule();};
  const removeContextListeners=()=>{
    canvas.removeEventListener('webglcontextlost',loss);
    canvas.removeEventListener('webglcontextrestored',restored);
  };
  const onRender=()=>{
    // Hour changes alter which off-screen buildings can cast into the view.
    const sun=S.uniforms()?.u_sunDirection?.value;
    const key=sun?[sun.x,sun.y,sun.z].join(','):'';
    if(onRender.sun!==key){onRender.sun=key;schedule();}
  };
  try {
    // Install before the first await: loss can occur while fetching the
    // manifest or while the first coarse building is still being generated.
    canvas.addEventListener('webglcontextlost',loss);
    canvas.addEventListener('webglcontextrestored',restored);
    checkAlive();
    try {
      const response=await fetch(manifestURL,{signal});if(!response.ok)throw Error('Compiled manifest HTTP '+response.status);
      manifest=await response.json();
      if(manifest?.schemaVersion!==1||!Array.isArray(manifest.buildings))throw Error('Invalid compiled building manifest');
      const ids=new Set();
      for(const entry of manifest.buildings){
        const bounds=entry?.bounds;
        if(!entry||typeof entry.id!=='string'||!entry.id||ids.has(entry.id)||
          typeof entry.file!=='string'||!entry.file||!Number.isSafeInteger(entry.bytes)||entry.bytes<=0||
          typeof entry.hash!=='string'||!/^[a-f0-9]{64}$/.test(entry.hash)||
          !['min','max'].every(key=>Array.isArray(bounds?.[key])&&bounds[key].length===3&&bounds[key].every(Number.isFinite))||
          bounds.min.some((value,i)=>value>bounds.max[i]))throw Error('Invalid compiled building manifest entry');
        ids.add(entry.id);
      }
    } catch(error){
      if(error.name==='AbortError')throw error;
      emit({type:'manifest-failed',error:error.message});manifest={buildings:[]};
    }
    checkAlive();
    const entries=new Map(manifest.buildings.map(e=>[e.id,e]));
    for(const [i,spec]of catalog.entries()){
      await initialContext();
      let coarse=null;
      try {
        const result=await compile(spec,{coarse:true,detail:0,filtered:false,chunkTriangles:tune.chunkTriangles,
          retainGeometryCpu:true,yieldWalls:true,signal,pause:()=>pause(true)});
        metrics.generationMs+=result.counts.generationMs;metrics.finalizationMs+=result.counts.finalizationMs;
        coarse=generatedObject(result,T);checkAlive();
        coarse.group.userData.coarse=true;coarse.group.userData.pickId=i+1;
        onMetadata(result.metadata,spec);
        records.set(spec.id,{id:spec.id,name:spec.name,spec,coarse,bounds:coarse.bounds,entry:entries.get(spec.id),
          pickId:i+1,active:null,wanted:false,distance:Infinity});
        group.add(coarse.group);coarse=null;
      } catch(error){coarse?.dispose();if(error.name==='AbortError')throw error;onFailure(spec.id);emit({type:'coarse-failed',id:spec.id,error:error.message});}
      const n=updateMetrics();
      if(n.cpuBytes>tune.cpuBytes||n.gpuBytes>tune.gpuBytes)throw Error('Coarse city exceeds building residency budget');
      await pause(true);
    }
    // GDC remains rendered by its existing source until its independently
    // decoded source is ready. It is outside the apartment byte denominator.
    for(const entry of entries.values())if(!records.has(entry.id)&&entry.key==='gdc'){
      records.set(entry.id,{id:entry.id,name:entry.name,bounds:entry.bounds,entry,pickId:records.size+1,
        active:null,coarse:null,wanted:false,distance:Infinity});
    }
    const n=updateMetrics();
    if(n.cpuBytes>tune.cpuBytes||n.gpuBytes>tune.gpuBytes)throw Error('Coarse city exceeds building residency budget');
  } catch(error){
    closed=true;removeContextListeners();loader.close();
    for(const r of records.values())r.coarse?.dispose();records.clear();group.clear();throw error;
  }

  return {
    group,config:Object.freeze({...tune}),
    start(){if(started||closed)return;started=true;map.on('move',schedule);map.on('render',onRender);refresh();},
    refresh,
    snapshot(){
      const n=updateMetrics();return {...metrics,...n,closed,contextLost,busy,pending:job?.id||null,
        cachedIds:[...cache.keys()],events:events.slice(),limits:{cpuBytes:tune.cpuBytes,gpuBytes:tune.gpuBytes,
          inactiveBytes:tune.inactiveBytes,stagingBytes:tune.stagingBytes},
        records:[...records.values()].map(r=>({id:r.id,name:r.name,pickId:r.pickId,bounds:r.bounds,
          active:!!r.active,activeAssetHash:r.active?.assetHash||null,compiled:!!r.entry,coarse:!!r.coarse,wanted:r.wanted,shadowCaster:r.shadowCaster,
          distance:r.distance,error:r.error||null,coarseGeometryBytes:r.coarse?.geometryBytes||0,
          budgetDeferred:!!r.budgetNeed&&!r.active,
          activeGeometryBytes:r.active?.geometryBytes||0,cpuBytes:(r.coarse?.cpuBytes||0)+(r.active?.cpuBytes||0),
          gpuBytes:(r.coarse?.gpuBytes||0)+(r.active?.gpuBytes||0),maplibreGpuBytes:r.entry?.key==='gdc'?null:0}))};
    },
    pin(ids){for(const id of ids)if(!records.has(id))throw Error('Unknown building id: '+id);
      pins.clear();for(const id of ids)pins.add(id);refresh();},
    evict(id,{forget=false}={}){const r=records.get(id);if(!r)throw Error('Unknown building id: '+id);
      if(job?.id===id)cancelJob('explicit eviction');evict(r,{cacheAsset:!forget});if(forget)cache.delete(id);
      r.retryAt=now()+tune.retryMs;updateMetrics();},
    retry(id,entry){const r=records.get(id);if(!r)throw Error('Unknown building id: '+id);
      if(entry){if(entry.id!==id)throw Error('Replacement ID differs');r.entry={...entry};cache.delete(id);}
      r.revision=(r.revision||0)+1;if(job?.id===id)cancelJob('superseded replacement');
      r.replace=!!r.active;r.retryAt=0;r.error=null;r.budgetNeed=null;refresh();},
    async settled({timeoutMs=60000}={}){
      const until=performance.now()+timeoutMs;
      while(!closed&&(busy||refreshQueued||dirty)){if(performance.now()>until)throw Error('Building residency did not settle');await nextBuildingFrame();}
      return this.snapshot();
    },
    drained(){return pumpPromise;},
    dispose(){if(closed)return pumpPromise;closed=true;cancelJob('disposed');loader.close();
      map.off('move',schedule);map.off('render',onRender);removeContextListeners();
      for(const r of records.values()){r.hero?.dispose();r.active?.dispose();r.coarse?.dispose();}
      cache.clear();records.clear();group.clear();emit({type:'disposed'});return pumpPromise;},
  };
}
