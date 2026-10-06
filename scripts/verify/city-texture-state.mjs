/** Borrowed texture units retain the real shared-context state, without draw-time queries.
 * VERIFY_URL=... node scripts/verify/city-texture-state.mjs [--restore] [--out report.json]
 * The comparison reads finished city pixels with tracking on/off, at day and night.
 */
import fs from 'node:fs';
import {chromium} from 'playwright-core';
import {launch,BASE} from './chrome.mjs';
const args=process.argv.slice(2),at=args.indexOf('--out');
const report={checks:[],errors:[]};
const check=(name,pass,detail)=>{report.checks.push({name,pass,detail});console.log(`${pass?'PASS':'FAIL'} ${name}: ${JSON.stringify(detail)}`);};
const browser=await launch(chromium,{gl:'hardware',maxMs:480000});
try{
 const page=await browser.newPage({viewport:{width:1280,height:800},deviceScaleFactor:1});
 page.on('pageerror',e=>report.errors.push(e.message));
 await page.addInitScript(()=>{const t=setInterval(()=>{if(window.cancelGraphicsAutoDetect){cancelGraphicsAutoDetect();clearInterval(t)}},20)});
 await page.goto(BASE+'/?intro=0&drift=0&namelabels=0&glstatecheck=1',{waitUntil:'domcontentloaded',timeout:120000});
 const ready=()=>page.waitForFunction(()=>window.slopesApartments?.readyToReveal()&&!document.getElementById('veil'),null,{timeout:240000});
 await ready();
 report.info=await page.evaluate(()=>{cancelGraphicsAutoDetect();GFX.autoExposure=false;GFX.grain=0;SKY_TUNE.TWINKLE.AMP=0;SKY_TUNE.GL.DRIFT=0;applyGraphics();return{buildings:slopesApartments.count.buildings,renderer:slopes.renderer.getContext().getParameter(37446)}});
 check('bindings agree during initial city load',await page.evaluate(()=>__glStateCheck.mismatches===0&&__glStateCheck.n['city.32873']>0),await page.evaluate(()=>__glStateCheck));
 await page.evaluate(()=>{
  GLSTATE.check=false;
  const gl=slopes.renderer.getContext(),native=gl.getParameter.bind(gl);
  window.__textureQueries=0;
  gl.getParameter=function(p){if(p===gl.ACTIVE_TEXTURE||p===gl.TEXTURE_BINDING_2D)__textureQueries++;return native(p)};
  window.__bindingPixels=()=>{
   const w=gl.drawingBufferWidth,h=gl.drawingBufferHeight;
   const read=on=>{GLSTATE.on=on;__map.redraw();const a=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,a);return a};
   read(false);const q0=__textureQueries,a=read(false),queried=__textureQueries-q0;
   read(true);const q1=__textureQueries,b=read(true),tracked=__textureQueries-q1;
   let changed=0,nonzero=0;for(let i=0;i<a.length;i++){if(a[i]!==b[i])changed++;if(a[i])nonzero++;}
   return{changed,nonzero,queried,tracked,w,h};
  };
 });
 for(const p of [.3,.5,.9]){
  await page.evaluate(p=>{applyTimeOfDay(__map,p,true);__map.jumpTo({center:[-97.7395,30.286],zoom:17.2,pitch:72,bearing:160})},p);
  await page.waitForTimeout(2500);
  const r=await page.evaluate(()=>__bindingPixels());
  check('same finished pixels at hour '+p,r.changed===0&&r.nonzero>1000,r);
  check('draw-time binding queries removed at hour '+p,r.queried>100&&r.tracked===0,r);
 }
 // Exercise both spare units and deletion. The real driver answer, not the
 // tracker's output, is the oracle used by GLSTATE.check on subsequent draws.
 await page.evaluate(()=>{
  GLSTATE.on=true;GLSTATE.check=true;
  const gl=slopes.renderer.getContext(),active=gl.getParameter(gl.ACTIVE_TEXTURE),n=gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),textures=[];
  for(let i=n-2;i<n;i++){const t=gl.createTexture();textures.push(t);gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,t);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([30,60,90,255]));}
  gl.activeTexture(active);__map.redraw();
  textures.forEach(t=>gl.deleteTexture(t));__map.redraw();
 });
 check('binding and deletion keep both renderers in agreement',await page.evaluate(()=>__glStateCheck.mismatches===0),await page.evaluate(()=>__glStateCheck));
 if(args.includes('--restore')){
  await page.evaluate(()=>{window.__textureStateRestored=false;__map.once('webglcontextrestored',()=>window.__textureStateRestored=true);const ext=slopes.renderer.getContext().getExtension('WEBGL_lose_context');ext.loseContext();setTimeout(()=>ext.restoreContext(),300)});
  await page.waitForFunction(()=>window.__textureStateRestored,null,{timeout:30000});
  await ready();await page.waitForTimeout(3000);
  check('bindings agree after graphics-context restoration',await page.evaluate(()=>__glStateCheck.mismatches===0&&CityLighting.stats.failures.length===0),await page.evaluate(()=>({check:__glStateCheck,failures:CityLighting.stats.failures})));
 }
 check('no page errors',report.errors.length===0,report.errors);
}finally{if(at>=0)fs.writeFileSync(args[at+1],JSON.stringify(report,null,2));await browser.__done()}
if(report.checks.some(c=>!c.pass))process.exitCode=1;
