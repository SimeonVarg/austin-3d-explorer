const assert=require('node:assert/strict');
const C=require('../../js/live-here-core.js');
(async()=>{
  const rows=[{code:'A',days:['MO','WE'],startMin:600,endMin:650},{code:'B',days:['MO','WE'],startMin:700,endMin:750},
    {code:'C',days:['TU'],startMin:600,endMin:650}];
  const homes=[{name:'Home 1'},{name:'Home 2'}],codes=new Set(['A','B','C']);let calls=0;
  const route=async(a,b)=>{calls++;return {ok:true,lo:a.startsWith('Home')||b.startsWith('Home')?10:3,hi:20,distM:100};};
  const r=await C.compare(rows,homes,route,codes);
  assert.equal(r.complete,true);assert.equal(r.shared.lo,6,'between-class walks counted once for each meeting day');
  assert.equal(r.apartments[0].total.lo,60,'only home-first and last-home count toward apartment comparison');
  assert.equal(calls,9,'repeated weekday pairs reuse route calculations');
  const failed=await C.compare(rows,homes,async(a,b)=>b==='B'?{ok:false}:route(a,b),codes);
  assert.equal(failed.complete,false);assert.equal(failed.shared,null,'a failed walk is never zero');
  const homeFailed=await C.compare(rows,homes,async(a,b)=>a==='Home 1'?{ok:false}:route(a,b),codes);
  assert.equal(homeFailed.apartments[0].total,null);assert.ok(homeFailed.apartments[1].ok);
  assert.match(C.validate([{...rows[0],endMin:550}],codes),/times/);
  assert.match(C.validate([{...rows[0],days:[]}],codes),/days/);
  assert.match(C.validate([{...rows[0],code:'UNKNOWN'}],codes),/building/);
  assert.match(C.validate([rows[0],{...rows[1],startMin:640}],codes),/overlap/);
  const imported=C.imported({events:[{code:'A',days:['MO'],startMin:600,endMin:650,title:'Synthetic private label'},
    {status:'failed',code:'UNKNOWN',days:[],startMin:null,endMin:null}]});
  assert.equal(imported.length,2,'unresolved imported entries remain visible');
  assert.equal('title' in imported[0],false,'only required schedule fields are copied');
  assert.match(C.validate(imported,codes),/review/);
  assert.equal(C.imported({events:[{...rows[0],confidence:0.8,status:'ok'}]})[0].needsReview,true,'uncertain imports require review even with plausible fields');
  console.log('PASS weekly totals, route caching, failure propagation, invalid/overlapping times, unresolved imports and field minimization');
})().catch(e=>{console.error(e);process.exitCode=1;});
