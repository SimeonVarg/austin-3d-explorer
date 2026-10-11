/** Final matched visual clip; PNG readback means this is NOT a speed test.
 * --out SCRATCH --q flag=1,flag=1 (candidate only); 30 fixed R1 poses.
 * Creates pristine HEAD snapshot, then captures main/candidate in fresh contexts.
 */
import {chromium} from 'playwright-core';
import {BASE,launch,HW_ARGS} from './chrome.mjs';
import {createMainSnapshot} from './moire-main-snapshot.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const args=process.argv.slice(2),opt=(key,value)=>args.includes(key)?args[args.indexOf(key)+1]:value;
const out=opt('--out','out/r2-clip-frames');
const flags=opt('--q','samplelattice=1,samplegrad=1,samplelight=1,samplepcf=1,samplebounds=1,samplework=1,samplecompact=1,sampleday=1').split(',').filter(Boolean);
const common=['intro=0','drift=0','namelabels=0','facadepace=0','timeofdaypace=0','smooth=0','restaccum=0'];
const camera={center:[-97.7393,30.2874],zoom:16.85,pitch:74,bearing:197.4};
const snapshot=createMainSnapshot();
fs.mkdirSync(out,{recursive:true});
const meta={createdAt:new Date().toISOString(),baselineHEAD:snapshot.baselineHEAD,candidateFlags:flags,
 width:960,height:600,dpr:1,frames:30,durationMs:6000,poseStepDegrees:.04,camera,arms:{},errors:[],
 method:'Pristine HEAD and candidate in serial fresh contexts; fixed R1 path, one completed rendered frame per pose. PNG readback; playback is not a speed test.'};
const save=()=>fs.writeFileSync(path.join(out,'meta.json'),JSON.stringify(meta,null,2));
console.error('[r2-clip] baseline HEAD '+snapshot.baselineHEAD);save();
const browser=await launch(chromium,{gl:'hardware',headless:true,maxMs:900000,args:[...HW_ARGS,'--disable-gpu-vsync','--disable-frame-rate-limit']});
try {
 for(const arm of ['main','candidate']){
  const context=await browser.newContext({viewport:{width:960,height:600},deviceScaleFactor:1,serviceWorkers:'block'});
  const record=meta.arms[arm]={errors:[],url:BASE.replace(/\/$/,'')+(arm==='main'?'/out/r2-main':'')+'/index.html?'+common.concat(arm==='candidate'?flags:[]).join('&')};
  try {
   await context.addInitScript(()=>{
    localStorage.setItem('austin3d.gfx.v1',JSON.stringify({autoDetected:true,autoExposure:false}));
    const timer=setInterval(()=>{if(window.cancelGraphicsAutoDetect){window.cancelGraphicsAutoDetect();clearInterval(timer);}},20);
   });
   if(args.includes('--prefer-discrete'))await context.addInitScript(()=>{
    const get=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(type,attributes){return get.call(this,type,/^webgl/.test(type)?{...attributes,powerPreference:'high-performance'}:attributes);};
   });
   const page=await context.newPage();page.on('pageerror',e=>record.errors.push(e.message));
   page.on('console',m=>{if(m.type()==='error')record.errors.push(m.text());});
   await page.goto(record.url,{waitUntil:'domcontentloaded',timeout:180000});
   await page.waitForFunction(()=>!document.getElementById('veil')&&window.slopesApartments?.count.done&&window.slopesApartments?.group,null,{timeout:240000});
   // Set the final area immediately, before awaiting automatic compaction.
   await page.evaluate(({camera,arm})=>{
    window.cancelGraphicsAutoDetect();window.GFX.autoExposure=false;
    if(arm==='main'&&(window.SampleLattice||window.MoireRuntime||window.MeshCompact))throw Error('pristine main contains candidate hooks');
    const m=window.__map;window.applyTimeOfDay(m,.2,true);
    for(const id of m.getLayersOrder())if(m.getLayer(id).type==='symbol')m.setLayoutProperty(id,'visibility','none');
    m.jumpTo(camera);m.triggerRepaint();
   },{camera,arm});
   if(arm==='candidate'&&flags.includes('samplecompact=1'))await page.evaluate(async()=>{
    if(!window.MoireRuntime?.ready)throw Error('requested MoireRuntime readiness is missing');
    await window.MoireRuntime.ready;if(window.MoireRuntime.stats.error)throw Error(window.MoireRuntime.stats.error);
   });
   await page.waitForFunction(()=>window.__map.loaded(),null,{timeout:60000});
   await page.waitForTimeout(1000);
   const captured=await page.evaluate(async({camera,arm,frames})=>{
    const m=window.__map,source=m.getCanvas(),canvas=document.createElement('canvas');
    canvas.width=source.width;canvas.height=source.height;const ctx=canvas.getContext('2d');
    const render=()=>new Promise((resolve,reject)=>{
     const timer=setTimeout(()=>{m.off('render',done);reject(Error('render timed out'));},30000);
     function done(){clearTimeout(timer);resolve();}m.once('render',done);m.triggerRepaint();
    });
    m.jumpTo(camera);await render();ctx.drawImage(source,0,0); // first capture discarded
    await render();ctx.drawImage(source,0,0); // trust settled second capture
    if(arm==='candidate'&&window.MoireRuntime?.stats.error)throw Error(window.MoireRuntime.stats.error);
    const images=[],poses=[];
    for(let f=0;f<frames;f++){
     m.jumpTo({...camera,bearing:camera.bearing+f*.04});
     await render(); // consecutive application render at this exact R1 pose
     ctx.drawImage(source,0,0);images.push(canvas.toDataURL('image/png'));
     const c=m.getCenter();poses.push({center:[c.lng,c.lat],zoom:m.getZoom(),pitch:m.getPitch(),bearing:m.getBearing()});
    }
    const gl=m.painter.context.gl,ext=gl.getExtension('WEBGL_debug_renderer_info');
    return {images,poses,renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unknown',canvas:[canvas.width,canvas.height],
     candidateOn:window.SampleLattice?.on??false,runtime:window.MoireRuntime?.stats??null};
   },{camera,arm,frames:30});
   if(captured.canvas[0]!==960||captured.canvas[1]!==600)throw Error('capture must be 960x600 DPR1');
   if(arm==='candidate'&&flags.includes('samplelattice=1')&&!captured.candidateOn)throw Error('candidate lattice unexpectedly disabled');
   record.png=[];
   for(let i=0;i<captured.images.length;i++){
    const name=arm+'-'+String(i).padStart(2,'0')+'.png',bytes=Buffer.from(captured.images[i].split(',')[1],'base64');
    fs.writeFileSync(path.join(out,name),bytes);record.png.push({name,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
   }
   delete captured.images;Object.assign(record,captured);
   if(record.errors.length)throw Error(arm+' emitted errors: '+record.errors.join('; '));
   console.error('[r2-clip] '+arm+' 30 poses '+record.renderer);save();
  }catch(error){record.failed=String(error.stack||error);meta.errors.push({arm,error:String(error)});throw error;}
  finally {save();await context.close();}
 }
 meta.complete=true;save();
} finally {save();await browser.__done();}
