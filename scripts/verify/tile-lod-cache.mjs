import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../../js/tiles.js',import.meta.url),'utf8');
const start=source.indexOf('  function memoTileZoom('),end=source.indexOf('\n  window.initTileLodCache',start);
assert.ok(start>=0&&end>start);
const memo=vm.runInNewContext('('+source.slice(start,end).trim()+')');
const tune={on:true,maxDistances:2,maxZooms:2,stats:{calls:0,hits:0}};
let calls=0;const original=(...args)=>{calls++;return args.reduce((n,x,i)=>n+Math.sin(x)*(i+1),0);};
const cached=memo(original,tune),base=[16.5,.003,.001,.002,58];
const wanted=original(...base);calls=0;
for(let i=0;i<100;i++)assert.equal(cached(...base),wanted);
assert.equal(calls,1,'identical inputs must reuse the result');assert.equal(tune.stats.hits,99);
for(let axis=0;axis<5;axis++){const args=base.slice();args[axis]+=.0001;assert.equal(cached(...args),original(...args),'every input affects the key');}
for(let i=0;i<20;i++){const args=[16+i%4,.001*i,.001,.002,58];assert.equal(cached(...args),original(...args),'bounded eviction must preserve answers');}
tune.on=false;const before=calls;cached(...base);cached(...base);assert.equal(calls-before,2,'off switch must call the original');
console.log('PASS: identical inputs reuse results; all inputs, bounded eviction and the off switch preserve answers');

// Exercise installation too: MapLibre exposes getVersion(), not .version.
const initStart=source.indexOf('  window.initTileLodCache =');
const initEnd=source.indexOf('\n  // Taste/behaviour block',initStart);
assert.ok(initStart>=0&&initEnd>initStart);
const custom=()=>42,sources={first:{},custom:{calculateTileZoom:custom}};
const listeners={},installed={on:true,stats:{calls:0,hits:0,sources:0},maxDistances:8,maxZooms:2};
let version='5.24.0';
const scope=vm.createContext({window:{},maplibregl:{getVersion:()=>version},TILE_LOD_CACHE:installed,memoTileZoom:fn=>memo(fn,installed)});
vm.runInContext(source.slice(initStart,initEnd),scope);
const map={getSource:id=>sources[id],getStyle:()=>({sources}),setSourceTileLodParams:(a,b,id)=>{assert.equal(a,9.314);assert.equal(b,3);sources[id].calculateTileZoom=original;},on:(event,fn)=>{listeners[event]=fn;},once:()=>{},off:()=>{}};
scope.window.initTileLodCache(map);
assert.equal(installed.stats.sources,1);
assert.equal(sources.custom.calculateTileZoom,custom);
sources.late={};listeners.sourcedata({sourceId:'late'});
assert.equal(sources.late.calculateTileZoom,sources.first.calculateTileZoom);
assert.equal(installed.stats.sources,2);
listeners.sourcedata({sourceId:'late'});assert.equal(installed.stats.sources,2);
version='future';const future={};scope.window.initTileLodCache(future);
assert.equal(future.__tileLodCache,undefined);
console.log('PASS: public version API activates default and late sources, preserves custom functions, and rejects unknown versions');
