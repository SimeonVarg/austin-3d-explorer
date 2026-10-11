/** Round-2 cold-page cost meter. No draw queries, inventory rebuild, or readback.
 * node scripts/verify/moire-r2-cost.mjs --snapshot-main --compact --tiles 2 --frames 32 --out DIR
 * --q samplelattice=1,samplegrad=1,samplelight=1,samplepcf=1 --phone --reps 3
 * --snapshot-main creates a pristine HEAD root using unprivileged hardlinks.
 * --main-base URL chooses an already prepared baseline without rebuilding it.
 * URL main has common flags only; every arm/repetition gets a fresh context.
 */
import {chromium} from 'playwright-core';
import {BASE,launch,HW_ARGS} from './chrome.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createMainSnapshot} from './moire-main-snapshot.mjs';
const args=process.argv.slice(2),opt=(k,d)=>args.includes(k)?args[args.indexOf(k)+1]:d;
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
if(args.includes('--snapshot-main')) {
 const snapshot=createMainSnapshot(root);
 console.error(`[r2-cost] pristine main HEAD ${snapshot.baselineHEAD}; ${snapshot.hardlinks.length} hardlinks, ${snapshot.copies.length} copy fallbacks`);
}
const mainBase=(args.includes('--snapshot-main')?BASE.replace(/\/$/,'')+'/out/r2-main':opt('--main-base',BASE)).replace(/\/$/,'');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
function captureManifest(){
 const files=[];const walk=(dir,accept)=>{if(!fs.existsSync(path.join(root,dir)))return;for(const e of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){
  if(e.isSymbolicLink()||['node_modules','.git','__pycache__'].includes(e.name))continue;
  const rel=path.posix.join(dir,e.name);if(e.isDirectory())walk(rel,accept);else if(accept(rel))files.push(rel);
 }};
 walk('js',p=>p.endsWith('.js'));walk('src',p=>p.endsWith('.js'));walk('data/apartments',p=>p.endsWith('.json'));
 walk('scripts',p=>!p.startsWith('scripts/verify/')&&/\.(py|js|mjs|rs)$/.test(p));files.push('index.html');
 const manifest=Object.fromEntries(files.sort().map(p=>[p,hash(fs.readFileSync(path.join(root,p)))]));
 return {runtimeSHA256:manifest,runtimeManifestSHA256:hash(JSON.stringify(Object.entries(manifest).sort(([a],[b])=>a.localeCompare(b))))};
}
const captureAtStart=captureManifest();
const baselineHEAD=execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
let mainSnapshot=null;
if(mainBase.endsWith('/out/r2-main')&&fs.existsSync(path.join(root,'out/r2-main/snapshot.json')))mainSnapshot=JSON.parse(fs.readFileSync(path.join(root,'out/r2-main/snapshot.json'),'utf8'));
const out=opt('--out','out/moire-r2-cost'),phone=args.includes('--phone'),compact=args.includes('--compact');
const tiles=Number(opt('--tiles','1')),frames=Number(opt('--frames','32')),repetitions=Number(opt('--reps','3'));
if(![tiles,frames,repetitions].every(n=>Number.isInteger(n)&&n>0))throw Error('tiles/frames/reps must be positive integers');
const candidateFlags=opt('--q','samplelattice=1,samplegrad=1,samplelight=1,samplepcf=1').split(',').filter(Boolean);
const common=['intro=0','drift=0','namelabels=0','facadepace=0','timeofdaypace=0','smooth=0','restaccum=0',...(phone?['lite=1']:[])];
const scene=opt('--view','campus-far')==='west-mid'?{center:[-97.7445,30.2880],zoom:16.6,pitch:72,bearing:300}:{center:[-97.7393,30.2874],zoom:16.85,pitch:74,bearing:197.4};
const settings={phone,compact,tiles,frames,repetitions,candidateFlags,scene,vsync:false,cpuThrottle:1,mainBase,candidateBase:BASE,baselineHEAD,mainSnapshot,capturedAt:new Date().toISOString(),...captureAtStart,
 viewport:phone?{width:390,height:844}:{width:960,height:600},deviceScaleFactor:phone?3:1,
 coldContext:true,serviceWorkers:'block',hardware:true,
 gpuMethod:'Round-1 allocation tracker; textures + buffers + renderbuffers; excludes implicit default framebuffer and driver overhead.',
 heapMethod:'Runtime.getHeapUsage after HeapProfiler.collectGarbage; page V8 heap, not worker heap/process RSS.',
 networkMethod:'Context-wide completed requests including workers; Request.sizes responseBodySize is encoded body. Page CDP cache and encodedDataLength override page transfers. Worker/other-target sizes use Playwright Chromium loadingFinished accounting. No content-length sum or response-body reads.',
 networkLimits:'Redirects may use Playwright header fallback; recorded separately. In-flight/failed requests and size errors are reported. Local-server encoding is recorded; these are not production CDN byte measurements.'};
fs.mkdirSync(out,{recursive:true});
const rows=[],errors=[];
const save=()=>{
 const minima={};for(const arm of ['main','candidate','msaa']){
  const rs=rows.filter(r=>r.arm===arm&&!r.failed);if(!rs.length)continue;
  minima[arm]={p50:Math.min(...rs.map(r=>r.p50)),p90:Math.min(...rs.map(r=>r.p90)),gpuBytes:Math.min(...rs.map(r=>r.gpu.total)),heapUsed:Math.min(...rs.map(r=>r.heap.usedSize)),downloadedBodyBytes:Math.min(...rs.map(r=>r.network.encodedBodyBytes)),transferBytes:Math.min(...rs.map(r=>r.network.transferBytes))};
 }
 fs.writeFileSync(path.join(out,'cost.json'),JSON.stringify({settings,minima,errors,reps:rows},null,2));
};
const browser=await launch(chromium,{gl:'hardware',headless:true,maxMs:1800000,args:[...HW_ARGS,'--disable-gpu-vsync','--disable-frame-rate-limit']});
const snap=()=>os.cpus().reduce((a,c)=>{const t=c.times;a.busy+=t.user+t.nice+t.sys+t.irq;a.total+=t.user+t.nice+t.sys+t.irq+t.idle;return a;},{busy:0,total:0});
try {
 for(let rep=0;rep<repetitions;rep++)for(const arm of rep%2?['msaa','candidate','main']:['main','candidate','msaa']){
  const context=await browser.newContext({viewport:settings.viewport,deviceScaleFactor:settings.deviceScaleFactor,serviceWorkers:'block'});
  const row={rep,arm,url:(arm==='main'?mainBase:BASE.replace(/\/$/,''))+'/index.html?'+(arm==='msaa'?['smooth=1']:[]).concat(arm!=='main'?candidateFlags:[]).concat(common).join('&'),errors:[],runtimeManifestSHA256:captureManifest().runtimeManifestSHA256,baselineHEAD};
  const requests=[],active=new Set(),pageNetwork=new Map();let changed=Date.now();
  context.on('request',r=>{if(/^https?:/.test(r.url())){requests.push({request:r,url:r.url(),type:r.resourceType(),finished:false});active.add(r);changed=Date.now();}});
  context.on('requestfinished',r=>{const item=requests.findLast(e=>e.request===r);if(item)item.finished=true;active.delete(r);changed=Date.now();});
  context.on('requestfailed',r=>{const item=requests.findLast(e=>e.request===r);if(item)item.failure=r.failure()?.errorText||'failed';active.delete(r);changed=Date.now();});
  try {
   await context.addInitScript(glInit);
   await context.addInitScript(()=>{
    localStorage.setItem('austin3d.gfx.v1',JSON.stringify({autoDetected:true,autoExposure:false}));
    const timer=setInterval(()=>{if(window.cancelGraphicsAutoDetect){window.cancelGraphicsAutoDetect();clearInterval(timer);}},20);
   });
   if(args.includes('--prefer-discrete'))await context.addInitScript(()=>{
    const get=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(type,attributes){return get.call(this,type,/^webgl/.test(type)?{...attributes,powerPreference:'high-performance'}:attributes);};
   });
   const page=await context.newPage();page.on('pageerror',e=>row.errors.push(e.message));
   const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});await cdp.send('Network.enable');
   cdp.on('Network.requestWillBeSent',e=>{
    if(e.redirectResponse){const old=pageNetwork.get(e.requestId);if(old)old.redirect=true;}
    pageNetwork.set(e.requestId,{url:e.request.url,finished:false,transfer:0,cached:false});
   });
   cdp.on('Network.responseReceived',e=>{const r=pageNetwork.get(e.requestId);if(r){r.status=e.response.status;r.cached=!!(e.response.fromDiskCache||e.response.fromPrefetchCache);}});
   cdp.on('Network.requestServedFromCache',e=>{const r=pageNetwork.get(e.requestId);if(r)r.cached=true;});
   cdp.on('Network.loadingFinished',e=>{const r=pageNetwork.get(e.requestId);if(r){r.finished=true;r.transfer=e.encodedDataLength||0;}});
   const started=Date.now();console.error(`[r2-cost] rep ${rep} ${arm} cold load`);
   await page.goto(row.url,{waitUntil:'domcontentloaded',timeout:180000});
   await page.waitForFunction(()=>!document.getElementById('veil')&&window.slopesApartments?.count.done&&window.slopesApartments?.group,null,{timeout:240000});
   await page.evaluate(async({scene,arm,tiles})=>{
    window.cancelGraphicsAutoDetect();window.GFX.autoExposure=false;
    if(arm==='main'&&(window.SampleLattice||window.MeshCompact||window.TemporalResolve))throw Error('main is contaminated by candidate modules');
    if(arm!=='main'&&window.SampleLattice)window.SampleLattice.tiles(tiles);
    const m=window.__map;window.applyTimeOfDay(m,.2,true);
    for(const id of m.getLayersOrder())if(m.getLayer(id).type==='symbol')m.setLayoutProperty(id,'visibility','none');
    m.jumpTo(scene);await new Promise(r=>setTimeout(r,1500));
   },{scene,arm,tiles});
   if(arm!=='main'&&compact){
    await page.addScriptTag({url:BASE.replace(/\/$/,'')+'/js/mesh-compact.js'});
    row.compact=await page.evaluate(async()=>{const s=await window.MeshCompact.apply();window.__map.triggerRepaint();return JSON.parse(JSON.stringify(s));});
   }
   if(arm!=='main'&&candidateFlags.includes('samplecompact=1'))await page.evaluate(async()=>{await window.MoireRuntime.ready;});
   if(arm!=='main'&&args.includes('--day')){
    await page.addScriptTag({url:BASE.replace(/\/$/,'')+'/js/day-specialize.js'});await page.evaluate(()=>window.DaySpecialize.attach());
   }
   if(arm!=='main'&&args.includes('--strip-cull')){
    await page.addScriptTag({url:BASE.replace(/\/$/,'')+'/js/strip-cull.js'});await page.evaluate(()=>window.StripCull.attach());
   }
   if(arm!=='main'&&args.includes('--prepass')){
    await page.addScriptTag({url:BASE.replace(/\/$/,'')+'/js/scene-depth-prepass.js'});await page.evaluate(()=>window.SceneDepthPrepass.attach());
   }
   // Let selected-area loading and compilation finish before measurement.
   await page.waitForFunction(()=>window.__map.loaded(),null,{timeout:30000}).catch(()=>{row.mapLoadedTimeout=true;});
   const quietDeadline=Date.now()+15000;
   while(Date.now()<quietDeadline&&(active.size||Date.now()-changed<1000))await new Promise(r=>setTimeout(r,100));
   row.readyMs=Date.now()-started;row.requestsInFlightBeforeTiming=active.size;
   await page.evaluate(()=>new Promise(done=>{
    let n=0;const m=window.__map;const tick=()=>{if(++n>=4){m.off('render',tick);done();}else m.triggerRepaint();};m.on('render',tick);m.triggerRepaint();
   }));
   await cdp.send('HeapProfiler.collectGarbage');
   const startCpu=snap();row.load=os.loadavg();const countAtStart=requests.length;
   const measured=await page.evaluate(async({scene,frames})=>{
    const m=window.__map,times=[],warmup=8;let last=null,n=0;
    await new Promise((done,reject)=>{
     const timeout=setTimeout(()=>{m.off('render',tick);reject(Error('moving frame run timed out'));},120000);
     function tick(){
      const now=performance.now();if(last!==null&&n>warmup)times.push(now-last);last=now;
      if(times.length>=frames){clearTimeout(timeout);m.off('render',tick);done();return;}
      n++;m.jumpTo({...scene,bearing:scene.bearing+(n-warmup)*.03});m.triggerRepaint();
     }
     m.on('render',tick);m.jumpTo({...scene,bearing:scene.bearing-warmup*.03});m.triggerRepaint();
    });
    // Queries occur only after the final measured interval.
    const g=m.painter.context.gl,e=g.getExtension('WEBGL_debug_renderer_info'),M=window.__mm;
    return {times,canvas:[g.drawingBufferWidth,g.drawingBufferHeight],renderer:e?g.getParameter(e.UNMASKED_RENDERER_WEBGL):'unknown',
     gpu:{textures:M.tex,buffers:M.buf,renderbuffers:M.rb,total:M.tex+M.buf+M.rb,peak:M.peak},
     lattice:window.SampleLattice?JSON.parse(JSON.stringify(window.SampleLattice.stats)):null,
     stripCull:window.StripCull?.stats,prepass:window.SceneDepthPrepass?.stats,
     detailCut:window.DetailCut,draw:window.slopes.stats(),antialias:g.getContextAttributes().antialias,samples:g.getParameter(g.SAMPLES),recovered:!!window.LITE_PROFILE?.recovery};
   },{scene,frames});
   const endCpu=snap();Object.assign(row,measured);row.cpuBusy=(endCpu.busy-startCpu.busy)/(endCpu.total-startCpu.total);
   row.requestsStartedDuringTiming=requests.length-countAtStart;
   row.timingNetworkQuiet=row.requestsInFlightBeforeTiming===0&&row.requestsStartedDuringTiming===0;
   await cdp.send('HeapProfiler.collectGarbage');row.heap=await cdp.send('Runtime.getHeapUsage');
   const sorted=[...row.times].sort((a,b)=>a-b);row.p50=sorted[Math.floor(sorted.length*.5)];row.p90=sorted[Math.floor(sorted.length*.9)];
   const deadline=Date.now()+15000;while(active.size&&Date.now()<deadline)await new Promise(r=>setTimeout(r,100));
   // Collect response-size RPCs only AFTER frame timing. No bodies are read.
   const available=new Map();for(const item of pageNetwork.values())if(item.finished){const q=available.get(item.url)||[];q.push(item);available.set(item.url,q);}
   const network={encodedBodyBytes:0,transferBytes:0,responses:0,pageCdpResponses:0,workerOrOtherTargetResponses:0,cachedPageResponses:0,encodings:{},failed:[],unfinished:[],sizeErrors:[],redirects:[],rows:[]};
   for(const item of requests){
    if(item.failure){network.failed.push({url:item.url,error:item.failure});continue;}
    if(!item.finished){network.unfinished.push(item.url);continue;}
    try {
     const response=await item.request.response(),sizes=await item.request.sizes();
     const encoding=response?.headers()['content-encoding']||'identity';
     const queue=available.get(item.url),native=queue?.shift();
     let body=Math.max(0,sizes.responseBodySize),transfer=Math.max(0,sizes.responseBodySize+sizes.responseHeadersSize);
     if(native){network.pageCdpResponses++;transfer=native.cached?0:native.transfer;if(native.cached||transfer===0){body=0;network.cachedPageResponses++;}}
     else network.workerOrOtherTargetResponses++;
     const detail={url:item.url,type:item.type,status:response?.status(),encoding,body,transfer,method:native?'page CDP transfer + Playwright encoded body':'Playwright worker/other target encoded sizes'};
     if(detail.status>=300&&detail.status<400)network.redirects.push(item.url);
     network.rows.push(detail);network.responses++;network.encodedBodyBytes+=body;network.transferBytes+=transfer;
     network.encodings[encoding]=(network.encodings[encoding]||0)+body;
    }catch(error){network.sizeErrors.push({url:item.url,error:String(error)});}
   }
   row.network=network;
   if(arm==='main'&&network.rows.some(r=>/\/(sample-lattice|temporal-resolve|mesh-compact)\.js(?:\?|$)/.test(r.url)))throw Error('main downloaded a candidate module');
   row.completeNetwork=!network.unfinished.length&&!network.sizeErrors.length;
   console.error('[r2-cost] '+JSON.stringify({rep,arm,renderer:row.renderer,p50:row.p50,p90:row.p90,gpu:row.gpu.total,heap:row.heap.usedSize,body:network.encodedBodyBytes,transfer:network.transferBytes,workerOrOtherTargetResponses:network.workerOrOtherTargetResponses,encodings:network.encodings}));
  }catch(error){row.failed=String(error.stack||error);errors.push({rep,arm,error:String(error)});console.error(`[r2-cost] ${arm} FAILED ${error}`);}
  finally{rows.push(row);save();await context.close();}
 }
} finally {save();await browser.__done();}
if(rows.some(r=>r.failed))process.exitCode=1;

function glInit() {
  if (window.__mm) return;
  const M = window.__mm = { tex: 0, buf: 0, rb: 0, peak: 0, own: {} };
  const TB = new WeakMap(), BB = new WeakMap(), RB = new WeakMap(), LIVE = M.live = new Set();
  const SIZED = { 0x8058: 4, 0x8051: 4, 0x881A: 8, 0x881B: 8, 0x8814: 16, 0x8815: 16, 0x8229: 1, 0x822B: 2, 0x822D: 2, 0x822E: 4,
    0x822F: 4, 0x8230: 8, 0x81A5: 2, 0x81A6: 4, 0x88F0: 4, 0x8CAC: 4, 0x8CAD: 8, 0x8C43: 4, 0x8C41: 4, 0x8D62: 2, 0x8056: 2,
    0x8057: 2, 0x8D48: 1, 0x8C3A: 4, 0x8C3D: 4, 0x8059: 4 };
  const CH = { 0x1908: 4, 0x1907: 3, 0x1906: 1, 0x1909: 1, 0x190A: 2, 0x1903: 1, 0x8227: 2, 0x1902: 1, 0x84F9: 1, 0x8D94: 1, 0x8228: 2, 0x8D98: 4, 0x8D99: 4 };
  const TY = { 0x1401: 1, 0x1400: 1, 0x1406: 4, 0x140B: 2, 0x8D61: 2, 0x1403: 2, 0x1402: 2, 0x1405: 4, 0x1404: 4, 0x84FA: 4, 0x8033: 2, 0x8034: 2, 0x8363: 2, 0x8368: 4, 0x8C3B: 4, 0x8DAD: 8 };
  const bpp = (ifmt, fmt, type) => {
    if (SIZED[ifmt]) return SIZED[ifmt];
    const c = CH[fmt] || CH[ifmt] || 4, t = TY[type] || 1;
    if ([0x8033, 0x8034, 0x8363, 0x84FA, 0x8368, 0x8C3B].includes(type)) return t;
    return Math.max(1, (c === 3 ? 4 : c) * t);
  };
  const texBind = t => t === 0x0DE1 ? 0x8069 : (t >= 0x8515 && t <= 0x851A) || t === 0x8513 ? 0x8514 : t === 0x8C1A ? 0x8C1D : t === 0x806F ? 0x806A : null;
  const bufBind = { 0x8892: 0x8894, 0x8893: 0x8895, 0x8A11: 0x8A28, 0x88EB: 0x88ED, 0x88EC: 0x88EF, 0x8F36: 0x8F36, 0x8F37: 0x8F37, 0x8C8E: 0x8C8F };
  const who = (kind) => {
    try {
      const st = new Error().stack.split('\n');
      for (const l of st) { const m = l.match(/\/(js\/[\w.-]+\.js):\d+/); if (m) return kind + ' ' + m[1]; }
      for (const l of st) { const m = l.match(/(maplibre-gl|three)[^/]*\.js/); if (m) return kind + ' ' + m[1]; }
    } catch (e) {}
    return kind + ' ?';
  };
  const add = (o, d) => { if (o && d) M.own[o] = (M.own[o] || 0) + d; const t = M.tex + M.buf + M.rb; if (t > M.peak) M.peak = t; };
  function setTex(gl, target, key, bytes) {
    const b = texBind(target); if (!b) return;
    const tex = gl.getParameter(b); if (!tex) return;
    let m = TB.get(tex); if (!m) { m = new Map(); m.owner = who('tex'); TB.set(tex, m); LIVE.add(m); }
    const old = m.get(key) || 0; m.set(key, bytes); M.tex += bytes - old; add(m.owner, bytes - old);
  }
  function patch(P) {
    if (!P || P.__mmPatched) return; P.__mmPatched = true;
    const w = (name, fn) => { const o = P[name]; if (typeof o !== 'function') return; P[name] = function () { try { fn.call(this, arguments); } catch (e) {} return o.apply(this, arguments); }; };
    w('texImage2D', function (a) {
      let wd, ht, fmt, type; const ifmt = a[2];
      if (a.length >= 8) { wd = a[3]; ht = a[4]; fmt = a[6]; type = a[7]; }
      else { const s = a[5]; wd = s && (s.videoWidth || s.naturalWidth || s.width) || 0; ht = s && (s.videoHeight || s.naturalHeight || s.height) || 0; fmt = a[3]; type = a[4]; }
      setTex(this, a[0], a[0] + ':' + a[1], wd * ht * bpp(ifmt, fmt, type));
      try { const b = texBind(a[0]); const t = b && this.getParameter(b); const m = t && TB.get(t); if (m && a[1] === 0) m.wh = wd + 'x' + ht; } catch (e) {}
    });
    w('texImage3D', function (a) { setTex(this, a[0], a[0] + ':' + a[1], a[3] * a[4] * a[5] * bpp(a[2], a[7], a[8])); });
    w('texStorage2D', function (a) { let s = 0; for (let l = 0; l < a[1]; l++) s += Math.max(1, a[3] >> l) * Math.max(1, a[4] >> l) * bpp(a[2]); if (a[0] === 0x8513) s *= 6; setTex(this, a[0], 'st', s); });
    w('texStorage3D', function (a) { let s = 0; for (let l = 0; l < a[1]; l++) s += Math.max(1, a[3] >> l) * Math.max(1, a[4] >> l) * a[5] * bpp(a[2]); setTex(this, a[0], 'st', s); });
    w('compressedTexImage2D', function (a) { const d = a[a.length - 1]; setTex(this, a[0], a[0] + ':' + a[1], d && d.byteLength || 0); });
    w('generateMipmap', function (a) {
      const b = texBind(a[0]); if (!b) return; const tex = this.getParameter(b); const m = tex && TB.get(tex); if (!m) return;
      const l0 = m.get(a[0] + ':0') || 0; const old = m.get('mip') || 0; m.set('mip', l0 / 3); M.tex += l0 / 3 - old; add(m.owner, l0 / 3 - old);
    });
    w('deleteTexture', function (a) { const m = a[0] && TB.get(a[0]); if (!m) return; let s = 0; for (const v of m.values()) s += v; M.tex -= s; add(m.owner, -s); TB.delete(a[0]); LIVE.delete(m); });
    w('bufferData', function (a) {
      const b = bufBind[a[0]]; if (!b) return; const buf = this.getParameter(b); if (!buf) return;
      const bytes = typeof a[1] === 'number' ? a[1] : (a.length >= 5 && a[4] ? a[4] * (a[1].BYTES_PER_ELEMENT || 1) : (a[1] ? a[1].byteLength : 0));
      let o = BB.get(buf); if (!o) { o = { b: 0, owner: who('buf') }; BB.set(buf, o); }
      M.buf += bytes - o.b; add(o.owner, bytes - o.b); o.b = bytes;
    });
    w('deleteBuffer', function (a) { const o = a[0] && BB.get(a[0]); if (!o) return; M.buf -= o.b; add(o.owner, -o.b); BB.delete(a[0]); });
    const rbs = (gl, ifmt, wd, ht, samples) => {
      const rb = gl.getParameter(0x8CA7); if (!rb) return;
      const bytes = wd * ht * bpp(ifmt) * Math.max(1, samples);
      let o = RB.get(rb); if (!o) { o = { b: 0, owner: who('rb') }; RB.set(rb, o); }
      M.rb += bytes - o.b; add(o.owner, bytes - o.b); o.b = bytes;
    };
    w('renderbufferStorage', function (a) { rbs(this, a[1], a[2], a[3], 1); });
    w('renderbufferStorageMultisample', function (a) { rbs(this, a[2], a[3], a[4], a[1]); });
    w('deleteRenderbuffer', function (a) { const o = a[0] && RB.get(a[0]); if (!o) return; M.rb -= o.b; add(o.owner, -o.b); RB.delete(a[0]); });
  }
  patch(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype);
  patch(window.WebGLRenderingContext && WebGLRenderingContext.prototype);

}
