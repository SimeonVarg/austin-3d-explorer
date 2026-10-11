// Opted-in explicit openings must share the engine's stable room lighting.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../../js/slopes-apartments.js',import.meta.url),'utf8');
const extract=name=>{
 const start=source.indexOf(`  function ${name}(`),body=source.indexOf('{',start);
 assert(start>=0);let depth=1,end=body+1;
 while(depth){if(source[end]==='{')depth++;if(source[end]==='}')depth--;end++;}
 return source.slice(start,end);
};
const context=vm.createContext({window:{},location:{search:''},URLSearchParams,
 APTS:{openings:true,balconies:false,openingD:.2,nightLit:.45},count:{openings:0}});
vm.runInContext(fs.readFileSync(new URL('../../js/city-night.js',import.meta.url),'utf8'),context);
vm.runInContext(extract('h01')+'\n'+extract('openings'),context);
const spec={id:'night-fixture',levels:{floors:[0,3,6,9]},night:{occupancy:.43}};
context.window.CityNight.register(spec);
const key=spec.id+'|tower|west';
const ops=Array.from({length:30},(_,i)=>({s0:i*2,s1:i*2+1,z0:3.7,z1:5.5,glass:'glass',lit:'room'}));
const plain=x=>JSON.parse(JSON.stringify(x));
const run=(items=ops,{start=0,len=60,z0=3,z1=6}={})=>{
 const skin={windows:[]};context.openings(skin,{openings:items},len,z0,z1,spec,{floors:[3]}, {},start,key);return plain(skin.windows);
};
const full=run();
assert(full.some(w=>w.lit)&&full.some(w=>!w.lit),'both occupied and closed rooms');
full.forEach((w,i)=>{
 const expected=context.window.CityNight.room(key,1,i);
 assert.equal(w.lit,expected.lit);assert.equal(w.nightTone,expected.nightTone);
});
assert.deepEqual(run(),full,'rebuild is deterministic');
for(const start of [0,17.5,38.5]){
 const part=run(ops,{start,len:20,z0:4,z1:5});
 for(const w of part){
  const original=full.find(o=>Math.abs(o.s0-(w.s0+start))<1e-9);
  assert(original);assert.equal(w.lit,original.lit);assert.equal(w.nightTone,original.nightTone);
 }
}
const modes=[undefined,false,true];
for(const lit of modes){
 const o={s0:0,s1:1,z0:3.7,z1:5.5,glass:'glass'};if(lit!==undefined)o.lit=lit;
 const w=run([o])[0];assert.equal(w.lit,lit===true);assert.equal(w.nightTone,undefined);
}
assert.equal(run([{...ops[0],glass:undefined,lit:'room'}])[0].lit,false,'non-glass does not opt in');
for(const lit of [true,false,'room']) assert.equal(run([{...ops[0],lit,nightTone:'#aabbcc'}])[0].nightTone,'#aabbcc');
context.window.CityNight.tune.windowScatter=false;
const paired=run();for(let i=0;i<30;i++)assert.equal(paired[i].lit,context.window.CityNight.room(key,1,i).lit);
context.window.CityNight.tune.on=false;
const fallback=run();fallback.forEach((w,i)=>{assert.equal(w.lit,context.h01(key,'lit',1,i)<.45);assert.equal(w.nightTone,undefined);});
const saved=context.window.CityNight;delete context.window.CityNight;assert.deepEqual(run(),fallback);context.window.CityNight=saved;
assert.equal((source.match(/openings\(skin, band,.*key\);/g)||[]).length,2,'normal and recessed walls pass stable face keys');
console.log('PASS explicit room openings: engine occupancy/tones, deterministic rebuild, horizontal+vertical clipping, boolean/omitted/non-glass preservation, explicit tones, paired mode and legacy fallback');
