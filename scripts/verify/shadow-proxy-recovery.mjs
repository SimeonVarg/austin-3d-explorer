// Exercise the real deferred shadow builder across a missing/restored style.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const src=fs.readFileSync(new URL('../../js/city-lighting.js',import.meta.url),'utf8');
const start=src.indexOf('  function shadowProxy(map) {'),end=src.indexOf('  function install(map)',start);
let code=src.slice(start,end);
if(process.argv.includes('--break'))code=code.replace('map.getStyle()?.layers','map.getStyle().layers');
const timers=new Map();let next=0,allocated=0,disposed=0,style;
class Geometry{constructor(){allocated++;}setAttribute(){}dispose(){disposed++;}}
class Material{dispose(){disposed++;}}
class Mesh{constructor(geometry,material){this.geometry=geometry;this.material=material;}}
const handlers=new Map();
const map={on:(name,fn)=>handlers.set(name,fn),isMoving:()=>false,getStyle:()=>style,triggerRepaint(){}};
const scope=vm.createContext({window:{THREE:{BufferGeometry:Geometry,Float32BufferAttribute:class{},Mesh,MeshBasicMaterial:Material},slopes:{}},stats:{},casterSources:[],buildings:[],
  setTimeout(fn){timers.set(++next,fn);return next;},clearTimeout:id=>timers.delete(id)});
vm.runInContext('let proxy=null,proxyMap=null,proxyDirty=true,proxyTimer=null,proxyBuilt=0; const hiddenIds=()=>new Set();\n'+code+'\nglobalThis.build=shadowProxy;',scope);
const tick=()=>{const pending=[...timers.values()];timers.clear();pending.forEach(fn=>fn());};
scope.build(map);assert.equal(timers.size,1);tick();
assert.equal(allocated,0,'absent style must defer geometry construction');
assert.equal(vm.runInContext('proxyDirty',scope),true,'retry remains pending');
style={layers:[]};scope.build(map);tick();
assert.equal(allocated,1,'restored style builds normally');
assert.ok(scope.build(map));assert.equal(timers.size,0,'unchanged scene does not schedule again');
handlers.get('moveend')();scope.build(map);assert.equal(timers.size,1);
handlers.get('remove')();assert.equal(timers.size,0);assert.equal(disposed,2);
assert.equal(vm.runInContext('proxyTimer',scope),null,'cancelled timer cannot block a later map');
scope.build(map);tick();assert.equal(allocated,2,'a later map can build a fresh proxy');
handlers.get('remove')();
console.log('PASS: missing style defers shadow work; restored style retries; map removal cancels and disposes');
