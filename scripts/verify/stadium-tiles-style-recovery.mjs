import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

let stadium=fs.readFileSync(new URL('../../js/slopes-stadium.js',import.meta.url),'utf8');
let tiles=fs.readFileSync(new URL('../../js/tiles.js',import.meta.url),'utf8');
if(process.argv.includes('--break')||process.argv.includes('--break-stadium')){
  stadium=stadium.replace('if(!map?.style)return;','');
}
if(process.argv.includes('--break')||process.argv.includes('--break-tiles')){
  tiles=tiles.replace('if (!map.style) return;','');
}
const slice=(source,start,end)=>{
  const a=source.indexOf(start),b=source.indexOf(end,a);
  assert.ok(a>=0&&b>a,`missing test boundary ${start}`);
  return source.slice(a,b);
};
const own=['!=',['literal','dkr-mesh'],['literal','dkr-mesh']];
const original=['==',['get','other-owner'],true];
const filters=new Map([['stadium-seating',original],['buildings-3d',original]]);
const frames=[],events={};let layerReads=0,filterWrites=0;
const map={style:{},
  getLayer(id){assert.ok(this.style,'getLayer during absent style');layerReads++;return filters.has(id);},
  getFilter(id){assert.ok(this.style,'getFilter during absent style');return filters.get(id);},
  setFilter(id,value){assert.ok(this.style,'setFilter during absent style');filterWrites++;filters.set(id,value);},
  on(event,callback){events[event]=callback;},
};
const tune={on:true},saved=new Map();
const context=vm.createContext({map,TUNE:tune,window:{SLOPES:{on:true}},saved,
  LEGACY:['stadium-seating'],VOLUMES:['buildings-3d'],tag:own,
  replacementPolygon:()=>({type:'Polygon',coordinates:[]}),
  requestAnimationFrame:fn=>frames.push(fn),filtered:false});
vm.runInContext(slice(stadium,'  function filter(on) {','  function updateLOD() {')+
  slice(stadium,'      let pending=false;','      const original=window.applySlopesSettings;')+
  '\nglobalThis.runFilter=filter;',context);
context.runFilter(true);
assert.equal(saved.size,2);
const applied=JSON.stringify([...filters]);
context.runFilter(true);
assert.equal(filterWrites,2,'ordinary repeated filtering is idempotent');
map.style=null;tune.on=false;
context.runFilter(false);events.styledata();
assert.equal(saved.size,2,'absent style must not discard clauses awaiting removal');
assert.equal(JSON.stringify([...filters]),applied);
assert.equal(frames.length,0,'no work is queued for a detached style');
map.style={};events.styledata();assert.equal(frames.length,1);
map.style=null;const beforeReads=layerReads;frames.shift()();
assert.equal(layerReads,beforeReads,'style may disappear between event and RAF');
assert.equal(saved.size,2);
map.style={};events.styledata();frames.shift()();
assert.equal(saved.size,0,'later ready event retries deferred disable cleanup');
for(const value of filters.values())assert.equal(JSON.stringify(value),JSON.stringify(original));
tune.on=true;events.styledata();events.styledata();
assert.equal(frames.length,1,'style event bursts stay coalesced');
frames.shift()();assert.equal(saved.size,2,'enabled filtering resumes');

// Boot's polling guard must also avoid getLayer before a style exists.
const bootPrefix=slice(stadium,'  async function boot(){','    booting=true;');
const bootContext=vm.createContext({window:{__map:{style:null,getLayer(){throw Error('boot style read');}},slopes:{root:{}}}});
vm.runInContext('let booting=false,map;'+bootPrefix+'}\nglobalThis.boot=boot;',bootContext);
await bootContext.boot();

// Installation during loss must still subscribe, without reading/serializing
// style. Neither missing-style events nor repeated events poison the WeakSet.
const sources={},listeners={},once={},cache={on:true,stats:{sources:0}};
let styleReads=0,sourceReads=0,setters=0;
const calculate=()=>12,custom=()=>42;
const tileMap={style:null,
  getStyle(){assert.ok(this.style,'getStyle during absent style');styleReads++;return {sources};},
  getSource(id){assert.ok(this.style,'getSource during absent style');sourceReads++;return sources[id];},
  setSourceTileLodParams(a,b,id){assert.equal(a,9.314);assert.equal(b,3);setters++;sources[id].calculateTileZoom=calculate;},
  on(event,fn){listeners[event]=fn;},once(event,fn){once[event]=fn;},
  off(event,fn){assert.equal(listeners[event],fn);delete listeners[event];},
};
const tileContext=vm.createContext({window:{},maplibregl:{getVersion:()=> '5.24.0'},
  TILE_LOD_CACHE:cache,memoTileZoom:fn=>(...args)=>fn(...args)});
vm.runInContext(slice(tiles,'  window.initTileLodCache =','  // Taste/behaviour block'),tileContext);
tileContext.window.initTileLodCache(tileMap);
sources.first={};listeners.sourcedata({sourceId:'first'});
assert.equal(sourceReads,0);assert.equal(styleReads,0);
tileMap.style={};listeners.sourcedata({sourceId:'first'});
const installed=sources.first.calculateTileZoom;
assert.equal(typeof installed,'function');assert.equal(cache.stats.sources,1);
listeners.sourcedata({sourceId:'first'});assert.equal(cache.stats.sources,1);
tileMap.style=null;sources.late={};listeners.sourcedata({sourceId:'late'});
assert.equal(sources.late.calculateTileZoom,undefined);
tileMap.style={};listeners.sourcedata({sourceId:'late'});
assert.equal(sources.late.calculateTileZoom,installed);
sources.custom={calculateTileZoom:custom};listeners.sourcedata({sourceId:'custom'});
assert.equal(sources.custom.calculateTileZoom,custom);
sources.first={};listeners.sourcedata({sourceId:'first'});
assert.equal(sources.first.calculateTileZoom,installed,'new source object after recovery must be attached');
assert.equal(cache.stats.sources,3);assert.equal(setters,1);
assert.equal(styleReads,0,'hot callbacks never serialize style');
once.remove();assert.equal(listeners.sourcedata,undefined);
console.log('PASS: stadium RAF/disable cleanup and tile source attachment pause across absent style, then retry without losing filters or custom LOD');
