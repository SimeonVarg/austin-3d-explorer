/** Strict acceptance contract. Missing evidence and the current prototype FAIL.
 * node scripts/verify/moire-zero-gate.mjs --report out/acceptance.json
 * node scripts/verify/moire-zero-gate.mjs --self-test
 * --break injects an over-limit moving-frame result into a supplied report.
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';
export const LIMIT = 0.16;
export const VIEWS = ['campus-far','west-mid','guad-street','downtown-far','campus-far-night','guad-street-night'];
export const MODES = ['rest','step','drag'];
export const MACHINES = ['intel','rtx','cloud','phone-emulated'];
const number=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
export function inspect(r) {
  const bad=[];
  if(r?.reference!=='fixed-main-16-jitter-float')bad.push('reference must remain fixed main, 16 same-resolution lens shifts');
  if(!r?.baselineCommit)bad.push('baseline commit missing');
  if(r?.errors?.length||!Array.isArray(r?.errors))bad.push('instrument errors or missing error list');
  for(const view of VIEWS)for(const mode of MODES){
    const row=r?.quality?.find(x=>x.view===view&&x.mode===mode);
    const name=view+'/'+mode;
    if(!row){bad.push(name+': missing');continue;}
    if(!(row.frames>=(mode==='rest'?2:3)))bad.push(name+': insufficient frames');
    if(mode!=='rest'&&row.settledBetweenFrames!==false)bad.push(name+': not consecutive frames');
    if(!number(row.buildingPixels)||row.buildingPixels<1000)bad.push(name+': missing building coverage');
    for(const field of ['error','flicker'])if(!number(row[field])||row[field]>LIMIT)bad.push(name+': '+field+' exceeds '+LIMIT+' or is invalid');
    for(const field of ['imageNoise','truthNoise'])if(!number(row[field])||row[field]>0.01)bad.push(name+': noisy/missing instrument repeat');
    if(row.lowerBound>LIMIT)bad.push(name+': acceptance below proven output quantization floor');
  }
  for(const machine of MACHINES){
    const row=r?.cost?.find(x=>x.machine===machine);
    if(!row){bad.push(machine+': missing cost evidence');continue;}
    if(!row.renderer||!row.load||row.repetitions<3)bad.push(machine+': incomplete measurement provenance');
    for(const key of ['p50','p90','gpuBytes','jsBytes','gzipBytes']){
      if(!number(row.main?.[key])||!number(row.candidate?.[key])||row.candidate[key]>row.main[key])bad.push(machine+': '+key+' overhead or unmeasured');
    }
  }
  if(r?.construction?.proven!==true)bad.push('future-content representation guarantee unproven');
  if(r?.killSwitchExact!==true)bad.push('exact kill switch unproven');
  return bad;
}
function fixture(){return {reference:'fixed-main-16-jitter-float',baselineCommit:'fixture',errors:[],killSwitchExact:true,construction:{proven:true},
 quality:VIEWS.flatMap(view=>MODES.map(mode=>({view,mode,frames:3,settledBetweenFrames:false,buildingPixels:10000,error:.10,flicker:.10,imageNoise:0,truthNoise:0,lowerBound:0}))),
 cost:MACHINES.map(machine=>({machine,renderer:'fixture',load:[0,0,0],repetitions:3,main:{p50:10,p90:12,gpuBytes:100,jsBytes:100,gzipBytes:100},candidate:{p50:10,p90:12,gpuBytes:100,jsBytes:100,gzipBytes:100}}))};}
function selfTest(){
 assert.deepEqual(inspect(fixture()),[]);
 for(const field of ['error','flicker'])for(const value of [.160001,NaN,Infinity,-1,undefined]){const r=fixture();r.quality[0][field]=value;assert.ok(inspect(r).length);}
 for(const kind of ['quality','cost']){const r=fixture();r[kind].pop();assert.ok(inspect(r).length);}
 for(const field of ['p50','p90','gpuBytes','jsBytes','gzipBytes']){const r=fixture();r.cost[0].candidate[field]++;assert.ok(inspect(r).length);}
 for(const field of ['imageNoise','truthNoise']){const r=fixture();r.quality[0][field]=.011;assert.ok(inspect(r).length);}
 const r=fixture();r.quality[1].settledBetweenFrames=true;assert.ok(inspect(r).length);
 assert.ok(inspect({}).length);
 console.log('PASS: threshold, missing evidence, NaN, noisy truth, settled motion, and each cost regression are rejected. Synthetic fixture only; not city acceptance.');
}
const args=process.argv.slice(2);
if(args.includes('--self-test'))selfTest();
else{
 const file=args.includes('--report')?args[args.indexOf('--report')+1]:'out/acceptance.json';
 let r;try{r=JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){console.error('FAIL: acceptance evidence unavailable: '+file);process.exit(1);}
 if(args.includes('--break')){r.quality??=[];r.quality.unshift({...fixture().quality[1],flicker:LIMIT+1});}
 const bad=inspect(r);console.log(bad.length?'FAIL\n'+bad.join('\n'):'PASS: supplied evidence meets the strict contract');process.exitCode=bad.length?1:0;
}
