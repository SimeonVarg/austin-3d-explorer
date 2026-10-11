/** Moving-camera costs in one page, interleaved arms; no screenshot readback while timing. */
import {chromium} from 'playwright-core';
import {BASE,launch,HW_ARGS} from './chrome.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const args=process.argv.slice(2),opt=(k,d)=>args.includes(k)?args[args.indexOf(k)+1]:d;
const out=opt('--out','out/moire-clip-frames'),phone=args.includes('--phone');
fs.mkdirSync(out,{recursive:true});
const browser=await launch(chromium,{gl:'hardware',headless:true,maxMs:300000,
  args:[...HW_ARGS,'--disable-gpu-vsync','--disable-frame-rate-limit']});
const page=await browser.newPage({viewport:phone?{width:390,height:844}:{width:960,height:600},deviceScaleFactor:phone?3:1});
if(args.includes('--prefer-discrete'))await page.addInitScript(()=>{
 const get=HTMLCanvasElement.prototype.getContext;
 HTMLCanvasElement.prototype.getContext=function(type,attrs){return get.call(this,type,/^webgl/.test(type)?{...attrs,powerPreference:'high-performance'}:attrs);};
});
const errors=[]; page.on('pageerror',e=>errors.push(e.message));

await page.addInitScript(()=>{
 localStorage.setItem('austin3d.gfx.v1',JSON.stringify({autoDetected:true,autoExposure:false}));
 const t=setInterval(()=>{if(window.cancelGraphicsAutoDetect){window.cancelGraphicsAutoDetect();clearInterval(t);}},20);
});
const cdp=await page.context().newCDPSession(page);
await page.goto(BASE+'/index.html?intro=0&drift=0&namelabels=0&facadepace=0&timeofdaypace=0&samplelattice=1&smooth=0'+(phone?'&lite=1':''),{waitUntil:'domcontentloaded',timeout:180000});
await page.waitForFunction(()=>!document.getElementById('veil')&&window.slopesApartments?.count.done&&window.slopesApartments?.group,null,{timeout:180000});
console.error('[cost] ready');
await page.evaluate(async()=>{
 window.cancelGraphicsAutoDetect();window.GFX.autoExposure=false;
 const m=window.__map;window.SampleLattice.set(false);
 window.applyTimeOfDay(m,.2,true);
 for(const id of m.getLayersOrder())if(m.getLayer(id).type==='symbol')m.setLayoutProperty(id,'visibility','none');
 m.jumpTo({center:[-97.7393,30.2874],zoom:16.85,pitch:74,bearing:197.4});
 await new Promise(r=>setTimeout(r,2000));
});

const frames=30;
for(const on of [false,true]){
 const png=await page.evaluate(async({on,frames})=>{
  const m=window.__map;window.SampleLattice.set(on);
  const base={center:[-97.7393,30.2874],zoom:16.85,pitch:74,bearing:197.4};
  m.jumpTo(base);await new Promise(r=>setTimeout(r,500));
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
  const source=m.getCanvas();canvas.width=source.width;canvas.height=source.height;
  const images=[];
  for(let f=0;f<frames;f++){
   m.jumpTo({...base,bearing:base.bearing+f*.04});
   // One uninterrupted series, one completed rendered frame per camera pose.
   await new Promise(r=>{m.once('render',r);m.triggerRepaint();});
   ctx.drawImage(source,0,0);images.push(canvas.toDataURL('image/png'));
  }
  return images;
 },{on,frames});
 for(let i=0;i<png.length;i++)fs.writeFileSync(path.join(out,(on?'lattice':'main')+'-'+String(i).padStart(2,'0')+'.png'),Buffer.from(png[i].split(',')[1],'base64'));
 console.error('[clip] captured '+(on?'lattice':'main')+' '+png.length+' poses');
}
await browser.__done();
