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
