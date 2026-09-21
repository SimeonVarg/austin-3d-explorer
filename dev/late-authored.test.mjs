import assert from 'node:assert/strict';
import fs from 'node:fs';

// Exercise the real deadline branch without spending 90 seconds per case.
const source=fs.readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
const start=source.indexOf('      if(waitAuthored && ms>=INTRO.authoredCeilingMs');
const end=source.indexOf('      const g = gate();',start);
assert(start>=0&&end>start,'intro deadline branch exists');
const deadline=new Function('window','ms','waitAuthored',`
 const INTRO={authoredCeilingMs:90000},dbg={waitAuthored},map={};
 const console={warn(){}};
 ${source.slice(start,end)}
 return {waitAuthored,dbg};
`);
for(const phone of [false,true]){
 let cancelled=0;
 const w={APARTMENTS:{on:true},LITE_PROFILE:phone?{lateAuthored:true}:undefined,
  slopesApartments:{readyToReveal:()=>false},applySlopesApartments:()=>cancelled++};
 assert.equal(deadline(w,89999,true).waitAuthored,true);
 const late=deadline(w,90000,true);
 assert.equal(late.waitAuthored,false,'deadline releases the veil');
 assert.equal(w.APARTMENTS.on,true,'healthy build remains enabled');
 assert.equal(cancelled,0,'deadline must not discard an in-flight group');
 assert(late.dbg.modelLate&&!late.dbg.modelFallback);
 assert.equal(deadline(w,90001,false).dbg.modelLate,undefined,'late state is entered once');
 w.slopesApartments.readyToReveal=()=>true;
 assert.equal(deadline(w,90000,true).dbg.modelLate,undefined,'completed handoff is untouched');
}
console.log('PASS desktop and phone deadlines release the veil without discarding authored buildings');
