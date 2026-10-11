/** Compare actual cold production graphics programs, baseline/candidate/baseline.
 * Native app, frozen cameras/time, second captures. Any control noise is inconclusive.
 * --break removes sunlight shadows in the candidate and must fail.
 */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
import {BASE,launch,HW_ARGS} from './chrome.mjs';
import {decodePNG} from './lib/png.mjs';
const args=process.argv.slice(2),opt=(k,d)=>args.includes(k)?args[args.indexOf(k)+1]:d;
const out=path.resolve(opt('--out',process.env.VERIFY_OUT||'/tmp/graphics-parity'));
const repo=fileURLToPath(new URL('../../',import.meta.url));
const refA=opt('--ref-a',null),refB=opt('--ref-b',null);
const queryA=opt('--query-a','smooth=0'),queryB=opt('--query-b','smooth=0');
for(const query of [queryA,queryB]) {
 if(query.includes('@@'))throw Error('Unexpanded template placeholder in query');
 const parsed=new URLSearchParams(query);
 for(const flag of ['smooth','packmerge','packverts']) {
  const values=parsed.getAll(flag);
  if(values.length>1||values.some(v=>v!=='0'&&v!=='1'))throw Error('Expected one binary '+flag+' query value');
 }
}
if(!refA&&!refB&&queryA===queryB&&!args.includes('--break'))throw Error('Supply a source ref or different queries to compare');
const resolved=ref=>ref?execFileSync('git',['rev-parse','--verify',ref+'^{commit}'],{cwd:repo,encoding:'utf8'}).trim():null;
const refs={a:resolved(refA),b:resolved(refB)};
const sha=x=>createHash('sha256').update(x).digest('hex');
const local={head:resolved('HEAD'),status:execFileSync('git',['status','--porcelain'],{cwd:repo,encoding:'utf8'}).trim(),diffSha256:sha(execFileSync('git',['diff','HEAD'],{cwd:repo,maxBuffer:64<<20})),served:{}};
for(const f of ['js/city-lighting.js','js/slopes.js','js/slopes-apartments.js','js/wall-patterns.js']) {
 const response=await fetch(BASE+'/'+f);if(!response.ok)throw Error('Cannot fingerprint served '+f);
 local.served[f]=sha(Buffer.from(await response.arrayBuffer()));
}
const cache=new Map();
const poses=[
 {name:'campus-far',p:.2,center:[-97.7393,30.2874],zoom:16.85,pitch:74,bearing:197.4},
 {name:'west-mid',p:.2,center:[-97.7445,30.288],zoom:16.6,pitch:72,bearing:300},
 {name:'campus-night',p:1,center:[-97.7393,30.2874],zoom:16.85,pitch:74,bearing:197.4}
];
const wanted=opt('--views','campus-far,west-mid').split(',');
if(wanted.some(n=>!poses.some(p=>p.name===n)))throw Error('Unknown view');
const views=poses.filter(p=>wanted.includes(p.name));fs.mkdirSync(out,{recursive:true});
const browser=await launch(chromium,{gl:'hardware',args:HW_ARGS,maxMs:1200000});
const result={settings:{callerArgs:args,queries:{a:queryA,b:queryB},width:960,height:600,dpr:1,secondCaptures:true,refs,local,programs:'Unmodified production except explicit --break'},arms:[],comparisons:[]};
const save=()=>fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));
function difference(a,b){const A=decodePNG(a),B=decodePNG(b);let moved=0,max=0,sum=0,over1=0,over12=0;for(let i=0;i<A.width*A.height;i++){let d=0;for(let c=0;c<3;c++){const x=Math.abs(A.data[i*A.bpp+c]-B.data[i*B.bpp+c]);d=Math.max(d,x);sum+=x;}moved+=d>0;over1+=d>1;over12+=d>12;max=Math.max(max,d);}return {moved,over1,over12,max,mae:sum/(A.width*A.height*3)};}
try{
 for(const arm of ['original','candidate','again']){
  const query=arm==='candidate'?queryB:queryA;
  const ref=arm==='candidate'?refs.b:refs.a;
  const ctx=await browser.newContext({viewport:{width:960,height:600},deviceScaleFactor:1});
  const row={arm,query,ref,errors:[],shots:{}};result.arms.push(row);save();
  try{
   const page=await ctx.newPage();page.on('pageerror',e=>row.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')row.errors.push(m.text().slice(0,200));});
   if(ref)await page.route(url=>/^\/(js\/[^?]+\.(?:js|mjs)|[^/?]+\.html|[^/?]+\.css)$/.test(new URL(url).pathname),(route,req)=>{
    const f=new URL(req.url()).pathname.slice(1),key=ref+':'+f;
    if(!cache.has(key))cache.set(key,execFileSync('git',['show',key],{cwd:repo,maxBuffer:64<<20}));
    return route.fulfill({status:200,contentType:/\.m?js$/.test(f)?'application/javascript':f.endsWith('.css')?'text/css':'text/html',body:cache.get(key)});
   });
   if(args.includes('--break')&&arm==='candidate')await page.route('**/js/city-lighting.js',r=>r.fulfill({contentType:'text/javascript',body:fs.readFileSync(new URL('../../js/city-lighting.js',import.meta.url),'utf8').replace('float visibility=facing>0.0?sunlightVisibility(pos,n):1.0;','float visibility=1.0;')}));
   await page.addInitScript(()=>{localStorage.setItem('austin3d.gfx.v1',JSON.stringify({autoDetected:true,autoExposure:false}));const t=setInterval(()=>{if(window.cancelGraphicsAutoDetect){window.cancelGraphicsAutoDetect();clearInterval(t);}},20);});
   await page.goto(BASE+'/index.html?intro=0&drift=0&namelabels=0&facadepace=0&timeofdaypace=0&skyfreeze=0&'+query,{waitUntil:'domcontentloaded',timeout:180000});
   await page.waitForFunction(()=>!document.getElementById('veil')&&window.slopesApartments?.count.done&&window.slopesApartments.count.buildings>0&&window.slopesApartments?.group,null,{timeout:300000});
   await page.evaluate(()=>{window.cancelGraphicsAutoDetect();window.GFX.autoExposure=false;window.applyGraphics();const m=window.__map;for(const l of m.getStyle().layers)if(l.type==='symbol')m.setLayoutProperty(l.id,'visibility','none');const jump=m.jumpTo,roll=m.setRoll;m.jumpTo=function(p,e){return e?.fly?this:jump.call(this,p,e);};if(roll)m.setRoll=function(v,e){return e?.fly?this:roll.call(this,v,e);};});
   row.hardware=await page.evaluate(()=>{const g=window.slopes.renderer.getContext(),e=g.getExtension('WEBGL_debug_renderer_info');return {renderer:e?g.getParameter(e.UNMASKED_RENDERER_WEBGL):g.getParameter(g.RENDERER),samples:g.getParameter(g.SAMPLES),shaderFailures:window.CityLighting.stats.failures,antialias:g.getContextAttributes().antialias};});
   row.effectiveUrl=page.url();
   const intended=new URLSearchParams(query),effective=new URL(row.effectiveUrl).searchParams;
   for(const flag of ['smooth','packmerge','packverts'])if(intended.has(flag)&&effective.get(flag)!==intended.get(flag))throw Error('Effective '+flag+' differs from caller query');
   const smooth=intended.get('smooth');
   if((smooth==='0'&&row.hardware.samples!==0)||(smooth==='1'&&row.hardware.samples===0))throw Error('Requested MSAA state did not activate');
   if(/swiftshader|llvmpipe|software/i.test(row.hardware.renderer))throw Error('Hardware GL required');
   if(row.hardware.shaderFailures.length)throw Error('Shader compilation failures');
   row.geometry=await page.evaluate(()=>{let triangles=0,vertices=0,bytes=0,packedMeshes=0,packedU16Meshes=0;window.slopesApartments.group.traverse(o=>{const g=o.geometry;if(!g?.index)return;triangles+=g.index.count/3;vertices+=g.attributes.position.count;if(g.userData.pack){packedMeshes++;if(g.index.array instanceof Uint16Array)packedU16Meshes++;}bytes+=g.index.array.byteLength;for(const a of Object.values(g.attributes))bytes+=a.array.byteLength;});return {triangles,vertices,bytes,packedMeshes,packedU16Meshes};});
   if(new URLSearchParams(query).get('packmerge')==='1'&&(!row.geometry.packedMeshes||row.geometry.packedU16Meshes!==row.geometry.packedMeshes))throw Error('Packed merge did not activate');
   console.log('[graphics-parity] loaded '+arm+' '+JSON.stringify(row.hardware));save();
   for(const view of views){
    await page.evaluate(v=>{window.__map.stop();window.__map.jumpTo(v);window.applyTimeOfDay(window.__map,v.p,true);},view);
    console.log('[graphics-parity] pose '+arm+' '+view.name);
    await page.waitForTimeout(4000);
    await page.evaluate(()=>new Promise(r=>{const m=window.__map;m.once('idle',r);m.triggerRepaint();setTimeout(r,15000);}));
    // A single idle event can precede a delayed proxy/area rebuild. Require
    // three quiet reads of the scene counters and loaded tiles before capture.
    await page.evaluate(()=>{window.__parityStable=null;});
    await page.waitForFunction(()=>{
      const m=window.__map,A=window.slopesApartments,C=window.CityLighting.stats;
      if(!m.areTilesLoaded()||window.__facadePace?.busy||!A.count.done||C.shadowProxyBuilding){window.__parityStable=null;return false;}
      const key=JSON.stringify([A.count.triangles,C.shadowProxyTriangles,C.shadowProxyRebuilds,window.slopes.sunlightStats()]);
      const old=window.__parityStable;
      window.__parityStable={key,n:old?.key===key?old.n+1:1};return window.__parityStable.n>=3;
    },null,{timeout:90000,polling:500});
    row.scene??={};row.scene[view.name]=await page.evaluate(()=>({camera:{center:window.__map.getCenter(),zoom:window.__map.getZoom(),pitch:window.__map.getPitch(),bearing:window.__map.getBearing()},triangles:window.slopesApartments.count.triangles,shadow:window.slopes.sunlightStats(),proxyTriangles:window.CityLighting.stats.shadowProxyTriangles}));
    const file=path.join(out,arm+'.'+view.name+'.png');await page.screenshot({path:file});await page.waitForTimeout(600);await page.screenshot({path:file});row.shots[view.name]=file;save();
   }
  }finally{await ctx.close();}
 }
 for(const view of views){const [a,b,c]=result.arms;const change=difference(a.shots[view.name],b.shots[view.name]),control=difference(a.shots[view.name],c.shots[view.name]);const row={view:view.name,change,control,exact:change.moved===0&&control.moved===0};result.comparisons.push(row);console.log(JSON.stringify(row));}
 result.pass=result.comparisons.every(r=>r.exact)&&result.arms.every(r=>!r.errors.length);save();process.exitCode=result.pass?0:1;
}catch(error){result.pass=false;result.error=String(error.stack||error);throw error;}finally{save();await browser.close();await browser.__done();}
