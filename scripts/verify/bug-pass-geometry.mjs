import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const root=new URL('../../',import.meta.url);
function exercise(source){
  const start=source.indexOf('  function balconyStack('),end=source.indexOf('\n  // ── openings:',start);
  const calls=[],count={balconies:0},fn=Function('box','count','warnOnce',source.slice(start,end)+';return balconyStack')((B,W,a,b,d0,d1,z0,z1)=>calls.push({a,b,z0,z1}),count,()=>{});
  const spec={s0:.1,s1:2.7,proj:1.15,slabT:.28,railH:.95};
  fn({}, {L:2.8},spec,[0,3,6,9],{slab:[],rail:[]},9.5);
  return {calls,count};
}
const current=exercise(fs.readFileSync(new URL('js/slopes-apartments.js',root),'utf8'));
assert.equal(current.count.balconies,3);
assert.ok(current.calls.every(b=>b.z1<=9.5&&b.a>=0&&b.b<=2.8));
const old=exercise(execFileSync('git',['show','14d2bc1:js/slopes-apartments.js'],{cwd:root,encoding:'utf8',maxBuffer:3000000}));
assert.ok(old.calls.some(b=>b.z1>9.5),'baseline reproduces balcony-above-roof failure');
console.log('PASS balcony geometry stays below roof; original generator demonstrably fails');
function enclosure(source){
  const start=source.indexOf('  function facade('),end=source.indexOf('  function tower(',start),solids=[];
  const tune={facadeWallDepth:.55,facadeFloor:4.6,facadeBand:.55,facadePierWidth:1.15};
  const fn=Function('TUNE','data','lerp','slab','quad','box','beam',source.slice(start,end)+';return facade')(
    tune,{details:{facadeBay:8}},(a,b,t)=>a+(b-a)*t,(B,ring,lo,hi)=>solids.push({ring,lo,hi}),()=>{},()=>{},()=>{});
  fn({},[-122,-78],[-122,79],43,[-1,0]);
  return solids.some(s=>s.lo<=8&&s.hi>=8&&Math.min(...s.ring.map(p=>p[1]))<=0&&Math.max(...s.ring.map(p=>p[1]))>=0);
}
assert.ok(enclosure(fs.readFileSync(new URL('js/slopes-stadium.js',root),'utf8')),'upper facade has continuous opaque backing behind its bays');
assert.ok(!enclosure(execFileSync('git',['show','14d2bc1:js/slopes-stadium.js'],{cwd:root,encoding:'utf8'})),'baseline leaves gaps between panes and piers');
console.log('PASS stadium upper enclosure closes the original facade gaps; ground gates remain below the wall');
const source=fs.readFileSync(new URL('js/slopes-apartments.js',root),'utf8');
const start=source.indexOf('  function replacementCatalog('),end=source.indexOf('  function fetchModel(',start);
const catalog=Function(source.slice(start,end)+';return replacementCatalog')();
const idx={replacedBuildingIds:['good','failed','extra'],replacedNames:['Good','Failed','Extra']};
const partial=catalog(idx,[{id:'good',name:'Good'},null],[[{id:'campus',name:'Campus'}]]);
assert.deepEqual(partial.replacedBuildingIds,['good','campus']);
assert.deepEqual(partial.replacedNames,['Good','Campus']);
assert.ok(catalog(idx,[{id:'good',name:'Good'},{id:'failed',name:'Failed'}],[]).replacedBuildingIds.includes('extra'));
console.log('PASS failed model keeps its legacy fallback; complete index retains extra replacement aliases');
