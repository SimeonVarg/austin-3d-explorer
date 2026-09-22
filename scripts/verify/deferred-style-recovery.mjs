// Real module timers cross a missing-style interval, recover, then receive removal.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
function fixture(file, hook = '') {
  const timers = new Map(), handlers = new Map(); let seq=0, reads=0, writes=0, queries=0;
  const setTimeout = (fn, ms) => {const id=++seq;timers.set(id,{fn,ms});return id;};
  const clearTimeout = id => timers.delete(id);
  const layers = {'buildings-3d': {type:'fill-extrusion'}};
  const sources = {};
  const check = () => {reads++;if(!map.style)throw Error('missing style access');};
  const map = {
    style:{sources:{basemap:{type:'vector'}}},
    getStyle(){check();return this.style;},
    getLayer(id){check();return layers[id];},
    getSource(id){check();return sources[id];},
    addSource(id,spec){sources[id]={...spec,setData(){writes++;}};},
    addLayer(layer){layers[layer.id]=layer;},
    setPaintProperty(){writes++;},setLayoutProperty(){writes++;},moveLayer(){writes++;},
    getCenter:()=>({lng:-97.74,lat:30.28}),getZoom:()=>17,
    querySourceFeatures(){queries++;return [];},
    on(name,fn){const list=handlers.get(name)||[];list.push({fn});handlers.set(name,list);},
    once(name,fn){const list=handlers.get(name)||[];list.push({fn,once:true});handlers.set(name,list);},
    off(name,fn){handlers.set(name,(handlers.get(name)||[]).filter(x=>x.fn!==fn));},
    fire(name){for(const x of [...(handlers.get(name)||[])]){if(x.once)this.off(name,x.fn);x.fn();}}
  };
  const errors=[];
  const window={__map:map,__fly:{eye:()=>({alt:500})},GFX:{renderDistance:100}};
  const scope=vm.createContext({window,console:{log(){},warn(){},error(...args){errors.push(args);}},setTimeout,clearTimeout,setInterval:setTimeout,clearInterval:clearTimeout});
  let source=fs.readFileSync(new URL('../../js/'+file,import.meta.url),'utf8');
  if(process.argv.includes('--break'))source=source.replace('if (!_map.style) { schedule(); return; }','');
  const at=source.lastIndexOf('})();');
  vm.runInContext(source.slice(0,at)+hook+source.slice(at),scope);
  const run=ms=>{const item=[...timers].find(([,t])=>t.ms===ms);assert.ok(item,`pending ${ms}ms callback`);timers.delete(item[0]);item[1].fn();};
  return {map,window,timers,run,layers,errors,get reads(){return reads},get writes(){return writes},get queries(){return queries}};
}
const lod=fixture('lod.js');
lod.map.fire('move');lod.map.style=null;
const lodReads=lod.reads;lod.run(140);lod.run(140);
assert.equal(lod.reads,lodReads,'LOD avoids absent-style lookup and rearms');
lod.map.style={};lod.run(140);assert.ok(lod.reads>lodReads,'LOD resumes without another camera move');
lod.map.fire('zoom');const staleLod=[...lod.timers.values()][0].fn;
lod.map.fire('remove');assert.equal(lod.timers.size,0);staleLod();assert.equal(lod.timers.size,0);
const night=fixture('night.js');
night.window.initNight(night.map);
night.window.__nightLights={count:42};
night.map.fire('moveend');night.map.style=null;
const nightReads=night.reads;night.run(800);night.run(800);
assert.equal(night.reads,nightReads);
assert.equal(night.window.__nightLights.count,42,'temporary loss must not replace successful diagnostics with failure');
assert.equal(night.errors.length,0);
night.map.style={sources:{basemap:{type:'vector'}}};night.run(800);
assert.equal(night.queries,1,'deferred road coverage resumes');
night.map.style=null;night.map.fire('moveend');night.run(800);
const staleNight=[...night.timers.values()].map(t=>t.fn);
night.map.fire('remove');assert.equal(night.timers.size,0);staleNight.forEach(fn=>fn());
assert.equal(night.timers.size,0);assert.equal(night.errors.length,0);
const shadows=fixture('shadows.js');
shadows.window.initShadows(shadows.map,[],.1);
shadows.window.updateShadows(shadows.map,.4);
shadows.map.style=null;const shadowReads=shadows.reads;
shadows.run(140);shadows.run(140);shadows.run(250);
assert.equal(shadows.reads,shadowReads,'cast and ring placement avoid absent style');
shadows.map.style={};shadows.layers['outer-3d']={};
shadows.run(250);shadows.run(140);shadows.run(140);
assert.ok(shadows.writes>1,'deferred shadow update and placement resume');
shadows.window.updateShadows(shadows.map,.7);
const staleShadow=[...shadows.timers.values()].map(t=>t.fn);
shadows.map.fire('remove');shadows.map.style=null;
assert.equal(shadows.timers.size,0);staleShadow.forEach(fn=>fn());assert.equal(shadows.timers.size,0);
console.log('PASS: LOD, night coverage and shadow timers defer absent style, resume without interaction, preserve diagnostics and cancel on removal');
