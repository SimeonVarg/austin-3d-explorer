import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

let source=fs.readFileSync(new URL('../../js/capitol.js',import.meta.url),'utf8');
if(process.argv.includes('--break-absent'))source=source.replace(
  'return !!map?.style && map.style._loaded !== false;','return true;');
if(process.argv.includes('--break-loading'))source=source.replace(
  'return !!map?.style && map.style._loaded !== false;','return !!map?.style;');
const tasks=[],paint=new Map(),filters=new Map(),layouts=new Map();
let reads=0,writes=0;
const ids=['ground-areas','ground-texture','ground-paths','trees-canopy','trees-trunk',
  'capitol-ground-areas','capitol-ground-texture','capitol-ground-paths',
  'trees-canopy-capitol','trees-trunk-capitol','capitol-dome'];
const layers=new Set(ids);
const map={style:{_loaded:true},
  getLayer(id){assert.ok(this.style,'layer read during absent style');assert.notEqual(this.style._loaded,false,'layer read before style JSON loads');reads++;return layers.has(id);},
  getPaintProperty(id,key){return paint.get(id+'/'+key);},
  setPaintProperty(id,key,value){assert.ok(this.style?._loaded,'paint while style unavailable');writes++;paint.set(id+'/'+key,value);},
  getFilter(id){return filters.get(id);},
  setFilter(id,value){assert.ok(this.style?._loaded);filters.set(id,value);},
  setLayoutProperty(id,key,value){assert.ok(this.style?._loaded);layouts.set(id+'/'+key,value);},
  getStyle(){throw Error('mirror must not serialize the style');},
  isStyleLoaded(){throw Error('streaming source tiles must not gate color mirrors');},
};
const scope=vm.createContext({window:{},setTimeout:fn=>tasks.push(fn),console});
vm.runInContext(source,scope);
const colors=scope.window.applyCapitolColors,settings=scope.window.applyCapitolSettings;
const setShared=(color,opacity)=>{
  paint.set('ground-areas/fill-color',color);paint.set('ground-areas/fill-opacity',opacity);
  paint.set('ground-texture/fill-pattern',['get','surface']);
  paint.set('ground-paths/fill-extrusion-color',color);paint.set('ground-paths/fill-extrusion-opacity',opacity);
  for(const id of ['trees-canopy','trees-trunk']){
    paint.set(id+'/fill-extrusion-color',color);paint.set(id+'/fill-extrusion-opacity',opacity);
    filters.set(id,['>=',['get','density'],opacity]);
  }
};
const assertMirrored=(color,opacity)=>{
  for(const id of ['capitol-ground-areas','capitol-ground-paths','trees-canopy-capitol','trees-trunk-capitol']){
    assert.equal(paint.get(id+'/fill-extrusion-color'),color);
    assert.equal(paint.get(id+'/fill-extrusion-opacity'),opacity);
  }
  assert.equal(paint.get('capitol-ground-texture/fill-extrusion-pattern'),paint.get('ground-texture/fill-pattern'));
  assert.equal(paint.get('capitol-ground-texture/fill-extrusion-opacity'),scope.window.CAPITOL.grainOpacity);
  for(const id of ['trees-canopy','trees-trunk'])assert.equal(filters.get(id+'-capitol'),filters.get(id));
};
setShared('#789065',.8);colors(map,.3);assertMirrored('#789065',.8);
assert.equal(tasks.length,1);
// Deferred pass still observes newer tree/ground values written later in TOD.
setShared('#405238',.6);tasks.shift()();assertMirrored('#405238',.6);
const domeBefore=JSON.stringify(paint.get('capitol-dome/fill-extrusion-color'));
colors(map,.3);map.style=null;
const lostReads=reads,lostWrites=writes;tasks.shift()();colors(map,.9);settings(map);
assert.equal(reads,lostReads);assert.equal(writes,lostWrites);assert.equal(tasks.length,0);
assert.equal(JSON.stringify(paint.get('capitol-dome/fill-extrusion-color')),domeBefore);
map.style={_loaded:false};colors(map,.9);settings(map);
assert.equal(reads,lostReads);assert.equal(writes,lostWrites);assert.equal(tasks.length,0);
// The next ordinary ready event retries; no sticky pending flag or stale colors.
map.style={_loaded:true};setShared('#152619',.35);colors(map,.9);assertMirrored('#152619',.35);
tasks.shift()();assertMirrored('#152619',.35);
assert.notEqual(JSON.stringify(paint.get('capitol-dome/fill-extrusion-color')),domeBefore);
settings(map);assert.equal(layouts.get('capitol-dome/visibility'),'visible');
assert.equal(paint.get('capitol-dome/fill-extrusion-opacity'),scope.window.CAPITOL.domeOpacity);
// A second race can leave a style object present but not yet loaded at timeout.
colors(map,.9);map.style={_loaded:false};const before=reads;tasks.shift()();assert.equal(reads,before);
map.style={_loaded:true};colors(map,.9);tasks.shift()();assertMirrored('#152619',.35);
console.log('PASS: Capitol color/ground/tree mirrors and deferred callbacks pause for absent/unloaded styles, preserve shared values, and resume on the next ready update');
