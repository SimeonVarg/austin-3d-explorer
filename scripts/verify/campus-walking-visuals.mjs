import fs from 'node:fs';
import {chromium} from 'playwright-core';
import {launch,BASE} from './chrome.mjs';
const root=new URL('../../',import.meta.url),out=process.env.VERIFY_OUT;
if(!out)throw new Error('Set VERIFY_OUT to a scratch directory for visual evidence');
fs.mkdirSync(out,{recursive:true});
const stage=process.env.WALK_STAGE||'after';
const halls=[...JSON.parse(fs.readFileSync(new URL('data/campus_buildings.json',root))).buildings,...JSON.parse(fs.readFileSync(new URL('data/speedway_buildings.json',root))).buildings];
const ll=(code,u,v)=>{const F=halls.find(b=>b.code===code).frame.obb;return [F.o[0]+(u*F.ax-v*F.ay)/F.mx,F.o[1]+(u*F.ay+v*F.ax)/F.my]};
const poses=[
 ['goldsmith',ll('GOL',30,35),2.2,5,86,true],
 ['gearing',ll('GEA',26,-9),2.2,5,86,true],
 ['utc',[-97.73891,30.28358],3,190,85,true],
 ['pcl',[-97.7377,30.2828],4.5,280,85,true],
 ['gregory',[-97.73702,30.28421],5,100,84,true],
 ['speedway',[-97.73702,30.28367],6,10,83,true],
 ['patton',[-97.73530,30.28495],75,35,60,false],
 ['powers-entry',ll('WCP',64,52),8,185,84,true],
 ['powers',[-97.7367,30.28489],6,95,83,true],
 ['district',[-97.7379,30.28395],140,310,60,false]
];
const browser=await launch(chromium,{gl:'hardware',maxMs:600000});
try{
 const page=await browser.newPage({viewport:{width:1440,height:960},reducedMotion:'reduce'}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error'&&/\[(slopes|campus-landscape)|THREE.WebGL/.test(m.text()))errors.push(m.text())});
 await page.addInitScript(()=>{const t=setInterval(()=>{if(window.cancelGraphicsAutoDetect){cancelGraphicsAutoDetect();clearInterval(t)}},50)});
 await page.goto(BASE+'/index.html?intro=0&drift=0',{waitUntil:'domcontentloaded',timeout:180000});
 await page.waitForFunction(()=>window.slopesApartments?.count.done&&window.campusLandscape?.count.done&&window.__fly?.indexed()&&!__fly.eye().driving,null,{timeout:180000});
 const ownership={};
 for(const [name,center,alt,bearing,pitch,eye]of poses){
  if(process.env.WALK_ONLY&&!process.env.WALK_ONLY.split(',').includes(name))continue;
  await page.evaluate(({center,alt,bearing,pitch,eye})=>{
   for(const l of __map.getStyle().layers)if(l.type==='symbol')__map.setLayoutProperty(l.id,'visibility','none');
   const r=Math.PI/180,lead=(eye?alt:0)*Math.tan(pitch*r),mx=111320*Math.cos(center[1]*r);
   const target=[center[0]+lead*Math.sin(bearing*r)/mx,center[1]+lead*Math.cos(bearing*r)/111320];
   const zoom=Math.log2(__map.transform.cameraToCenterDistance*40075016.686*Math.cos(center[1]*r)*Math.cos(pitch*r)/(512*alt));
   GFX.autoExposure=false;applyTimeOfDay(__map,.12,true);__map.stop();__map.jumpTo({center:target,zoom,pitch,bearing,padding:0});
  },{center,alt,bearing,pitch,eye});
  await page.waitForFunction(()=>__map.getSource('austin-entrances')&&__map.isSourceLoaded('austin-entrances'),null,{timeout:180000});
  await page.waitForTimeout(4000);const path=out+'/'+name+'-'+stage+'.jpg';await page.screenshot({path,quality:90});await page.waitForTimeout(900);await page.screenshot({path,quality:90});
  if(['gearing','goldsmith'].includes(name))ownership[name]=await page.evaluate(()=>[[700,810],[1250,805],[250,842],[650,915]].map(p=>({pixel:p,ll:__map.unproject(p).toArray(),hits:__map.queryRenderedFeatures(p).map(f=>({layer:f.layer.id,p:f.properties}))})));
  console.log(name);
 }
 fs.writeFileSync(out+'/ownership-'+stage+'.json',JSON.stringify(ownership,null,2));
 if(errors.length)throw new Error(errors.join('\n'));console.log('PASS walking views');
}finally{await browser.__done()}
