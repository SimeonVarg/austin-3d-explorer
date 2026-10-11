/** Shared shadow work probe. One city load, original/guard/original arms.
 * The verifier alone injects a uniform to flip the branch without rebuilding.
 * Its timing is diagnostic; final performance requires untouched cold programs.
 * --break forces sun-facing shadows off and must change the picture.
 */
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright-core';
import {BASE,launch,HW_ARGS} from './chrome.mjs';
import {decodePNG} from './lib/png.mjs';
const args=process.argv.slice(2),opt=(k,d)=>args.includes(k)?args[args.indexOf(k)+1]:d;
const out=path.resolve(opt('--out',process.env.VERIFY_OUT||'/tmp/shadow-work'));
const broken=args.includes('--break'),frames=Number(opt('--frames','0'));
const views=[
 {name:'campus-far',p:.2,center:[-97.7393,30.2874],zoom:16.85,pitch:74,bearing:197.4},
 {name:'west-mid',p:.2,center:[-97.7445,30.288],zoom:16.6,pitch:72,bearing:300},
 {name:'campus-night',p:1,center:[-97.7393,30.2874],zoom:16.85,pitch:74,bearing:197.4}
].filter(v=>opt('--views','campus-far,west-mid').split(',').includes(v.name));
if(!views.length||!Number.isInteger(frames)||frames<0)throw Error('Need supported views and a nonnegative integer frame count');
fs.mkdirSync(out,{recursive:true});
const browser=await launch(chromium,{gl:'hardware',maxMs:900000,args:[...HW_ARGS,'--disable-gpu-vsync','--disable-frame-rate-limit']});
const results={settings:{viewport:[960,600],dpr:1,cpuThrottle:1,vsync:false,frames,broken,instrument:'One program with verifier-only uniform; timings are diagnostic'},views:[],errors:[]};
try{
 const page=await browser.newPage({viewport:{width:960,height:600},deviceScaleFactor:1});
 page.on('pageerror',e=>(results.errors.push(e.message),console.error('[page]',e.message.slice(0,200))));
 page.on('console',m=>{if(m.type()==='error')results.errors.push(m.text().slice(0,250));});
 await page.route('**/js/city-lighting.js',async route=>{
  let src=fs.readFileSync(new URL('../../js/city-lighting.js',import.meta.url),'utf8');
  const needle='float visibility=facing>0.0?sunlightVisibility(pos,n):1.0;';
  if(!src.includes(needle))throw Error('Guard source missing; refusing a dead comparison');
  src=src.replace('uniform vec3 u_skyZenith','uniform float u_shadowSkip;\n    uniform vec3 u_skyZenith')
   .replace(needle,`float visibility=u_shadowSkip>.5${broken?'':'&&facing<=0.0'}?1.0:sunlightVisibility(pos,n);`);
  await route.fulfill({contentType:'text/javascript',body:src});
 });
 await page.route('**/js/slopes.js',async route=>{
  let src=fs.readFileSync(new URL('../../js/slopes.js',import.meta.url),'utf8');
  const needle='u_sunShadow0:{value:null},u_sunShadow1:{value:null},';
  if(!src.includes(needle))throw Error('Uniform initialization missing');
  src=src.replace(needle,'u_shadowSkip:{value:0},'+needle);
  await route.fulfill({contentType:'text/javascript',body:src});
 });
 await page.addInitScript(()=>{
  localStorage.setItem('austin3d.gfx.v1',JSON.stringify({autoDetected:true,autoExposure:false}));
  const timer=setInterval(()=>{if(window.cancelGraphicsAutoDetect){window.cancelGraphicsAutoDetect();clearInterval(timer);}},20);
 });
 await page.goto(BASE+'/index.html?intro=0&drift=0&namelabels=0&facadepace=0&timeofdaypace=0&skyfreeze=0&smooth=0',{waitUntil:'domcontentloaded',timeout:180000});
 await page.waitForFunction(()=>!document.getElementById('veil')&&window.slopesApartments?.count.done&&window.slopesApartments?.group,null,{timeout:300000});
 await page.evaluate(()=>{
  window.cancelGraphicsAutoDetect();window.GFX.autoExposure=false;window.applyGraphics();
  const m=window.__map;for(const l of m.getStyle().layers)if(l.type==='symbol')m.setLayoutProperty(l.id,'visibility','none');
  const jump=m.jumpTo,roll=m.setRoll;m.jumpTo=function(p,e){if(e?.fly)return this;return jump.call(this,p,e);};
  if(roll)m.setRoll=function(v,e){if(e?.fly)return this;return roll.call(this,v,e);};
  window.__shadowWorkFrame=()=>new Promise(r=>{m.once('render',r);m.triggerRepaint();});
 });
 console.log('[shadow-work] city ready');
 results.hardware=await page.evaluate(()=>{const g=window.slopes.renderer.getContext(),e=g.getExtension('WEBGL_debug_renderer_info');return {renderer:e?g.getParameter(e.UNMASKED_RENDERER_WEBGL):g.getParameter(g.RENDERER),samples:g.getParameter(g.SAMPLES)};});
 for(const view of views){
  const row={name:view.name,timing:[],images:{}};results.views.push(row);
  await page.evaluate(v=>{window.__map.stop();window.__map.jumpTo(v);window.applyTimeOfDay(window.__map,v.p,true);},view);
  await page.waitForTimeout(4000);
  await page.evaluate(()=>new Promise(r=>{const m=window.__map;m.once('idle',r);m.triggerRepaint();setTimeout(r,15000);}));
  await page.waitForFunction(()=>!window.__facadePace?.busy&&!window.CityLighting?.stats.shadowProxyBuilding,null,{timeout:90000});
  for(const [name,on]of [['original',0],['guard',1],['again',0]]){
   await page.evaluate(async on=>{window.slopes.uniforms().u_shadowSkip.value=on;await window.__shadowWorkFrame();await window.__shadowWorkFrame();},on);
   const file=path.join(out,view.name+'.'+name+'.png');
   await page.screenshot({path:file});await page.waitForTimeout(600);await page.screenshot({path:file});row.images[name]=file;
  }
  if(frames>0)for(let rep=0;rep<3;rep++)for(const on of rep%2?[1,0]:[0,1]){
   const values=await page.evaluate(async({on,frames})=>{
    const m=window.__map;window.slopes.uniforms().u_shadowSkip.value=on;
    const poses=[];for(let i=0;i<frames+8;i++){const c=m.unproject([480+i*.35,300]);poses.push([c.lng,c.lat]);}
    const times=[];let prior;
    for(let i=0;i<poses.length;i++){m.jumpTo({center:poses[i]});await window.__shadowWorkFrame();const now=performance.now();if(i>8)times.push(now-prior);prior=now;}
    m.jumpTo({center:poses[0]});return times;
   },{on,frames});
   const sorted=[...values].sort((a,b)=>a-b);row.timing.push({rep,arm:on?'guard':'original',p50:sorted[Math.floor(sorted.length*.5)],p90:sorted[Math.floor(sorted.length*.9)],values});
   fs.writeFileSync(path.join(out,'partial.json'),JSON.stringify(results,null,2));
  }
  const diff=(a,b)=>{const A=decodePNG(a),B=decodePNG(b);let moved=0,max=0,total=0;for(let i=0;i<A.width*A.height;i++){let d=0;for(let c=0;c<3;c++){const delta=Math.abs(A.data[i*A.bpp+c]-B.data[i*B.bpp+c]);d=Math.max(d,delta);total+=delta;}moved+=d>0;max=Math.max(max,d);}return {moved,max,mae:total/(A.width*A.height*3)};};
  row.change=diff(row.images.original,row.images.guard);row.control=diff(row.images.original,row.images.again);
  row.pass=row.control.moved===0&&row.change.moved===0;
  console.log(JSON.stringify({view:row.name,change:row.change,control:row.control,pass:row.pass,timing:row.timing.map(({values,...v})=>v)}));
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(results,null,2));
 }
 results.pass=results.views.every(v=>v.pass)&&!results.errors.length;
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(results,null,2));
 console.log(JSON.stringify({pass:results.pass,hardware:results.hardware,errors:results.errors}));
 process.exitCode=results.pass?0:1;
}finally{await browser.__done();}
