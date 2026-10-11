/** Round-2 evidence gate. Current finite-sampling construction is UNPROVEN.
 * --report out/r2-acceptance.json; --self-test (synthetic logic only); --manifest
 * Quality row schema follows round1 plus arm/source/runtimeManifestSHA256.
 * Cost row: {machine,source,runtimeManifestSHA256}; source is r2 cold cost.json.
 * Top-level: reference,baselineCommit,errors,quality,cost,runtimeSHA256,
 * evidenceSHA256,construction. Capture manifests must describe code AT CAPTURE.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
export const VIEWS=['campus-far','west-mid','guad-street','downtown-far','campus-far-night','guad-street-night'];
export const MODES=['rest','step','drag'];
export const MACHINES=['intel','amd-laptop','phone-emulated'];
export const ROUNDING_ALLOWANCE=.005,MAX_NOISE=.01;
// Published two-decimal round-1 lattice values, not a new perceptual threshold.
export const PUBLISHED={
 'campus-far':{rest:[.23],step:[.23,.28],drag:[.25,.37]},
 'west-mid':{rest:[.89],step:[.89,1.07],drag:[.90,1.19]},
 'guad-street':{rest:[.20],step:[.22,.33],drag:[.24,.34]},
 'downtown-far':{rest:[.36],step:[.36,.45],drag:[.37,.57]},
 'campus-far-night':{rest:[.14],step:[.14,.20],drag:[.14,.22]},
 'guad-street-night':{rest:[.09],step:[.10,.16],drag:[.10,.16]}
};
const number=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
export const manifestDigest=m=>sha(JSON.stringify(Object.entries(m||{}).sort(([a],[b])=>a.localeCompare(b))));
export function runtimeManifest(root=process.cwd()){
 const files=[];
 const walk=(dir,accept)=>{if(!fs.existsSync(path.join(root,dir)))return;for(const e of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){
  if(e.isSymbolicLink()||['node_modules','.git','__pycache__'].includes(e.name))continue;
  const rel=path.posix.join(dir,e.name);if(e.isDirectory())walk(rel,accept);else if(accept(rel))files.push(rel);
 }};
 walk('js',p=>p.endsWith('.js'));walk('src',p=>p.endsWith('.js'));
 walk('data/apartments',p=>p.endsWith('.json'));
 walk('scripts',p=>!p.startsWith('scripts/verify/')&&/\.(py|js|mjs|rs)$/.test(p));
 if(fs.existsSync(path.join(root,'index.html')))files.push('index.html');
 return Object.fromEntries(files.sort().map(p=>[p,sha(fs.readFileSync(path.join(root,p)))]));
}
export function inspect(report,{root=process.cwd(),read=file=>fs.readFileSync(path.resolve(root,file)),currentManifest=runtimeManifest(root)}={}){
 const bad=[],r=report||{};
 if(r.reference!=='fixed-main-16-jitter-float')bad.push('fixed same-resolution main 16-jitter float truth required');
 if(!/^[a-f0-9]{40}$/.test(r.baselineCommit||''))bad.push('full baseline commit missing');
 if(!Array.isArray(r.errors)||r.errors.length)bad.push('instrument errors or missing error list');
 if(!r.runtimeSHA256||Object.keys(currentManifest).length===0)bad.push('runtime source manifest missing');
 for(const [file,hash] of Object.entries(currentManifest))if(r.runtimeSHA256?.[file]!==hash)bad.push('stale/missing runtime hash: '+file);
 for(const file of Object.keys(r.runtimeSHA256||{}))if(!(file in currentManifest))bad.push('runtime manifest contains removed/unscoped source: '+file);
 const digest=manifestDigest(r.runtimeSHA256),cache=new Map();
 function evidence(file){
  if(!file){bad.push('raw evidence source missing');return null;}
  if(cache.has(file))return cache.get(file);
  try{const bytes=read(file);if(r.evidenceSHA256?.[file]!==sha(bytes))bad.push('stale/missing evidence hash: '+file);
   const obj=JSON.parse(bytes.toString());cache.set(file,obj);return obj;
  }catch(e){bad.push('unreadable evidence: '+file);cache.set(file,null);return null;}
 }
 for(const view of VIEWS)for(const mode of MODES){
  const list=r.quality?.filter(x=>x.view===view&&x.mode===mode)||[],name=view+'/'+mode;
  if(list.length!==1){bad.push(name+': exactly one measurement required');continue;}const row=list[0];
  if(row.runtimeManifestSHA256!==digest)bad.push(name+': capture source manifest missing/stale');
  if(!number(row.frames)||row.frames<(mode==='rest'?1:3))bad.push(name+': insufficient captured frames');
  if(mode!=='rest'&&(row.settledBetweenFrames!==false||row.cameraMoved!==true))bad.push(name+': consecutive moving frames required');
  if(mode==='drag'&&row.capture!=='pointer-events-then-pose-replay')bad.push(name+': actual pointer path and candidate pose replay required');
  if(!number(row.buildingPixels)||row.buildingPixels<1000)bad.push(name+': building mask absent');
  const limits=PUBLISHED[view][mode].map(v=>v+ROUNDING_ALLOWANCE);
  // This explicit improvement requirement is stricter than the old West value.
  if(view==='west-mid'&&mode==='step'){limits[0]=.30;limits[1]=.40;}
  for(const [i,field] of ['error','flicker'].entries()){
   if(mode==='rest'&&field==='flicker')continue; // R1 rest published E only.
   if(!number(row[field])||row[field]>limits[i])bad.push(`${name}: ${field} ${row[field]} exceeds ${limits[i]} or invalid`);
  }
  for(const field of ['imageNoise','truthNoise'])if(!number(row[field])||row[field]>MAX_NOISE)bad.push(name+': noisy/missing '+field);
  const raw=evidence(row.source),rawRow=raw?.rows?.find(x=>x.name===view),arm=rawRow?.arms?.[row.arm||'lattice']?.all;
  if(!rawRow||!arm||rawRow.failed)bad.push(name+': candidate raw row absent');
  else {
   for(const [field,key] of [['error','err'],['flicker','flicker']])if(!(mode==='rest'&&field==='flicker')&&(!number(arm[key])||Math.abs(arm[key]-row[field])>1e-10))bad.push(name+': summary differs from raw '+field);
   if(raw.frames!==row.frames||(raw.motion||'rest')!==mode)bad.push(name+': raw mode/frame mismatch');
   for(const [field,key] of [['imageNoise','px'],['truthNoise','truthPx']])if(!number(rawRow.noise?.all?.[key])||Math.abs(rawRow.noise.all[key]-row[field])>1e-10)bad.push(name+': noise differs from raw');
  }
 }
 for(const machine of MACHINES){
  const found=r.cost?.filter(x=>x.machine===machine)||[];
  if(found.length!==1){bad.push(machine+': exactly one cost source required');continue;}const row=found[0],raw=evidence(row.source);
  if(row.runtimeManifestSHA256!==digest)bad.push(machine+': capture source manifest missing/stale');
  if(!raw)continue;const s=raw.settings||{},rows=raw.reps||[];
  if(s.coldContext!==true||s.serviceWorkers!=='block'||s.cpuThrottle!==1||s.vsync!==false||s.hardware!==true)bad.push(machine+': cold hardware/vsync/CPU protocol missing');
  if(!Array.isArray(raw.errors)||raw.errors.length||rows.some(x=>x.failed||!Array.isArray(x.errors)||x.errors.length))bad.push(machine+': measurement errors');
  if(rows.length<6||s.repetitions<3)bad.push(machine+': three cold interleaved repetitions required');
  for(let rep=0;rep<3;rep++)for(const [i,arm] of (rep%2?['candidate','main']:['main','candidate']).entries())if(rows[rep*2+i]?.rep!==rep||rows[rep*2+i]?.arm!==arm)bad.push(machine+': interleaving broken at rep '+rep);
  if((machine==='phone-emulated')!==!!s.phone)bad.push(machine+': wrong viewport profile');
  if(s.phone&&(s.viewport?.width!==390||s.viewport?.height!==844||s.deviceScaleFactor!==3))bad.push(machine+': phone profile must be 390x844 DPR3');
  for(const sample of rows){
   const label=machine+'/'+sample.arm+'/'+sample.rep,n=sample.network;
   if(!sample.renderer||(machine==='intel'&&!/Intel/i.test(sample.renderer))||(machine==='amd-laptop'&&!/AMD|Radeon/i.test(sample.renderer)))bad.push(label+': wrong/missing renderer identity');
   if(sample.arm==='main'&&(/[?&,](samplelattice|samplegrad|samplelight|samplepcf|samplehistory)=/.test(sample.url||'')||sample.lattice))bad.push(label+': main contains candidate hooks');
   if(!n||sample.completeNetwork!==true||n.failed?.length||n.unfinished?.length||n.sizeErrors?.length||!number(n.workerOrOtherTargetResponses)||!Array.isArray(n.rows)||!Object.keys(n.encodings||{}).length)bad.push(label+': incomplete worker-inclusive encoded downloads');
   if(sample.timingNetworkQuiet!==true)bad.push(label+': loading overlaps timed frames');
   if(!Array.isArray(sample.times)||sample.times.length<32||sample.times.some(x=>!number(x)))bad.push(label+': insufficient frame samples');
   if(!number(sample.heap?.usedSize)||!number(sample.heap?.backingStorageSize))bad.push(label+': heap plus backing-store memory unmeasured');
  }
  const metrics={p50:x=>x.p50,p90:x=>x.p90,gpuBytes:x=>x.gpu?.total,jsBytes:x=>number(x.heap?.usedSize)&&number(x.heap?.backingStorageSize)?x.heap.usedSize+x.heap.backingStorageSize:NaN,downloadedBodyBytes:x=>x.network?.encodedBodyBytes};
  for(const [key,get] of Object.entries(metrics)){
   const arms=['main','candidate'].map(arm=>rows.filter(x=>x.arm===arm).map(get));
   if(arms.some(a=>a.length<3||a.some(x=>!number(x)))){bad.push(machine+': '+key+' missing/invalid');continue;}
   const main=Math.min(...arms[0]),candidate=Math.min(...arms[1]);if(candidate>main)bad.push(`${machine}: ${key} overhead (${candidate} > ${main})`);
  }
 }
 const c=r.construction;
 if(c?.proven!==true)bad.push('future-content representation guarantee UNPROVEN');
 for(const field of ['allBakesCovered','allShadersCovered','visibilityCovered','unsupportedContentRejected'])if(c?.[field]!==true)bad.push('construction proof missing: '+field);
 if(c?.runtimeManifestSHA256!==digest)bad.push('construction proof not bound to current sources');
 if(!c?.proofSource||!c?.proofSHA256)bad.push('reviewable representation proof missing');
 else try{if(sha(read(c.proofSource))!==c.proofSHA256)bad.push('representation proof hash mismatch');}catch(e){bad.push('representation proof unreadable');}
 return bad;
}
function selfTest(){
 // Entire fixture remains in memory. Its invented proof is ONLY a logic test.
 const files=new Map(),manifest={'js/synthetic-fixture.js':sha('synthetic source')},digest=manifestDigest(manifest);
 const r={reference:'fixed-main-16-jitter-float',baselineCommit:'0'.repeat(40),errors:[],runtimeSHA256:manifest,evidenceSHA256:{},quality:[],cost:[],construction:{proven:true,allBakesCovered:true,allShadersCovered:true,visibilityCovered:true,unsupportedContentRejected:true,runtimeManifestSHA256:digest,proofSource:'SYNTHETIC-PROOF',proofSHA256:sha('test-only')}};
 files.set('SYNTHETIC-PROOF',Buffer.from('test-only'));
 const put=(file,data)=>{const text=Buffer.from(JSON.stringify(data));files.set(file,text);r.evidenceSHA256[file]=sha(text);};
 for(const view of VIEWS)for(const mode of MODES){const source=view+'-'+mode+'.json';put(source,{frames:3,motion:mode,rows:[{name:view,arms:{lattice:{all:{err:.01,flicker:.01}}},noise:{all:{px:0,truthPx:0}}}]});r.quality.push({view,mode,frames:3,source,arm:'lattice',runtimeManifestSHA256:digest,error:.01,flicker:.01,buildingPixels:10000,imageNoise:0,truthNoise:0,cameraMoved:true,settledBetweenFrames:false,capture:'pointer-events-then-pose-replay'});}
 for(const machine of MACHINES){const source=machine+'.json',phone=machine==='phone-emulated',raw={settings:{coldContext:true,serviceWorkers:'block',cpuThrottle:1,vsync:false,hardware:true,repetitions:3,phone,viewport:{width:390,height:844},deviceScaleFactor:3},errors:[],reps:[]};
  for(let rep=0;rep<3;rep++)for(const arm of rep%2?['candidate','main']:['main','candidate'])raw.reps.push({rep,arm,renderer:machine==='intel'?'Intel':'AMD',url:'http://fixture/',errors:[],p50:10,p90:12,gpu:{total:100},heap:{usedSize:50,backingStorageSize:50},times:Array(32).fill(10),timingNetworkQuiet:true,completeNetwork:true,network:{encodedBodyBytes:100,workerOrOtherTargetResponses:1,rows:[],encodings:{identity:100},failed:[],unfinished:[],sizeErrors:[]}});
  put(source,raw);r.cost.push({machine,source,runtimeManifestSHA256:digest});
 }
 const options={read:file=>{if(!files.has(file))throw Error('missing');return files.get(file);},currentManifest:manifest};
 assert.deepEqual(inspect(r,options),[]);
 const thresholdTest=(view,mode,field,limit)=>{
  const row=r.quality.find(x=>x.view===view&&x.mode===mode),saved=files.get(row.source);
  try {for(const [value,passes] of [[limit,true],[limit+.000001,false]]){
   const copy=structuredClone(r),changed=copy.quality.find(x=>x.view===view&&x.mode===mode),raw=JSON.parse(saved);
   changed[field]=value;raw.rows[0].arms.lattice.all[field==='error'?'err':'flicker']=value;
   const bytes=Buffer.from(JSON.stringify(raw));files.set(row.source,bytes);copy.evidenceSHA256[row.source]=sha(bytes);
   const result=inspect(copy,options);if(passes)assert.deepEqual(result,[]);else assert.ok(result.some(x=>x.includes('exceeds')));
  }} finally {files.set(row.source,saved);}
 };
 thresholdTest('campus-far','rest','error',.23+ROUNDING_ALLOWANCE);
 thresholdTest('campus-far','step','flicker',.28+ROUNDING_ALLOWANCE);
 thresholdTest('west-mid','step','error',.30);thresholdTest('west-mid','step','flicker',.40);
 const fail=change=>{const copy=structuredClone(r);change(copy);assert.ok(inspect(copy,options).length);};
 fail(x=>x.construction.proven=false);fail(x=>delete x.construction.proofSource);fail(x=>delete x.cost[2]);fail(x=>x.quality.pop());
 fail(x=>x.quality[0].error=NaN);fail(x=>x.quality[0].truthNoise=.02);fail(x=>x.quality[1].settledBetweenFrames=true);fail(x=>x.runtimeSHA256['js/synthetic-fixture.js']='stale');
 fail(x=>delete x.evidenceSHA256[x.quality[0].source]);fail(x=>x.quality.find(y=>y.view==='west-mid'&&y.mode==='step').error=.301);
 for(const key of ['p50','p90','gpu','heap','network']){
  const saved=files.get('intel.json'),raw=JSON.parse(saved);for(const row of raw.reps.filter(x=>x.arm==='candidate')){
   if(key==='gpu')row.gpu.total++;else if(key==='heap')row.heap.backingStorageSize++;else if(key==='network')row.network.encodedBodyBytes++;else row[key]++;
  }
  const copy=structuredClone(r),bytes=Buffer.from(JSON.stringify(raw));files.set('intel.json',bytes);copy.evidenceSHA256['intel.json']=sha(bytes);assert.ok(inspect(copy,options).some(s=>s.includes('overhead')));files.set('intel.json',saved);
 }
 console.log('PASS: synthetic gate logic rejects missing construction, stale hashes, noisy/missing/misreported quality, West regression, and all cost regressions. NOT a city acceptance result.');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);
 if(args.includes('--self-test'))selfTest();
 else if(args.includes('--manifest'))console.log(JSON.stringify(runtimeManifest(),null,2));
 else {
  const file=args.includes('--report')?args[args.indexOf('--report')+1]:'out/r2-acceptance.json';
  try{const report=JSON.parse(fs.readFileSync(file,'utf8'));if(args.includes('--break')){report.construction??={};report.construction.proven=false;}
   const bad=inspect(report);console.log(bad.length?'FAIL\n'+bad.join('\n'):'PASS: supplied R2 evidence meets this gate');process.exitCode=bad.length?1:0;
  }catch(e){console.error('FAIL: '+e.message);process.exitCode=1;}
 }
}
