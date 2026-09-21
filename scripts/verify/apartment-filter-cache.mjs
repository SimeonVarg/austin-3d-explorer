// Exercise the real filter guard without loading the renderer. Browser checks
// additionally cover MapLibre filter replacement and late-layer repair.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../../js/slopes-apartments.js',import.meta.url),'utf8');
const start=source.indexOf('  let _expectedFilters = null;');
const end=source.indexOf('\n  /**',source.indexOf('  function filtersMissing()',start)+30);
assert.ok(start>=0&&end>start);
let serializations=0;
const clause=['!', ['in',['get','id'],['literal',['authored-a','authored-b']]]];
const layer={filter:['all',['has','id'],clause]};
const layers={buildings:layer};
const scope=vm.createContext({_data:{},_map:{getLayer:id=>layers[id],getFilter:id=>structuredClone(layers[id]?.filter??null)},filterPlan:()=>[['buildings',clause]],JSON:{stringify:value=>{serializations++;return JSON.stringify(value);}}});
vm.runInContext(source.slice(start,end),scope);
// An applied plan is stable until setFilters replaces it.
vm.runInContext('_expectedFilters = filterPlan();',scope);
const missing=()=>Array.from(vm.runInContext('filtersMissing()',scope));
assert.deepEqual(missing(),[]);const warm=serializations;
for(let i=0;i<100;i++)assert.deepEqual(missing(),[]);
assert.equal(serializations,warm,'unchanged filters must not be serialized by the poll');
layer.filter=['has','id'];assert.deepEqual(missing(),['buildings'],'filter replacement must invalidate the cache');
layer.filter=['all',['has','id'],clause];assert.deepEqual(missing(),[],'repair must be recognized');
delete layers.buildings;assert.deepEqual(missing(),[],'absent layers are not failures');
layers.buildings={filter:null};assert.deepEqual(missing(),['buildings'],'late layers need checking');
layers.buildings={};assert.deepEqual(missing(),['buildings'],'missing filter API must take the public fallback');
console.log('PASS: unchanged polls do no serialization; rewritten, repaired, absent, and late filters are handled');
