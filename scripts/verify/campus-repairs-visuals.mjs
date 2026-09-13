import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright-core';
import {launch,BASE} from './chrome.mjs';
const out=process.env.VERIFY_OUT;
if(!out)throw new Error('VERIFY_OUT must be a scratch directory');
fs.mkdirSync(out,{recursive:true});
const stage=process.env.CAMPUS_STAGE||'after';
const time=Number(process.env.CAMPUS_TIME||.12);
const poses=[
 ['utc-front',[-97.73881,30.28347],38,190,7,64],
 ['church-roof',[-97.73925,30.28329],45,115,12,67],
 ['business-court',[-97.73845,30.28409],70,50,8,62],
 ['sanchez',[-97.73877,30.28168],80,110,8,62],
 ['utc-east',[-97.7388,30.2831],100,285,9,65],
 ['utc-west',[-97.7388,30.2831],100,115,9,65],
 ['utc-north',[-97.7388,30.2831],70,190,8,70],
 ['utc-door',[-97.73891,30.28358],3,190,0,85,true],
 ['21st-speedway',[-97.73855,30.28364],55,320,0,60],
 ['guad-24th',[-97.7414,30.28764],70,310,0,60],
 ['dean-keeton',[-97.7370,30.28976],100,310,0,65],
 ['east-campus',[-97.7332,30.2877],115,295,3,65],
 ['south-mall',[-97.7394,30.2847],90,20,3,60]
];
const browser=await launch(chromium,{gl:'hardware',maxMs:600000});
try{
 const page=await browser.newPage({viewport:{width:1440,height:960},reducedMotion:'reduce'}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('requestfailed',r=>console.log('request failed',r.url(),r.failure()?.errorText));
 page.on('console',m=>{if(m.type()==='error'&&/\[(slopes-apartments|roofscape|buildScene)\]/.test(m.text()))errors.push(m.text())});
 if(stage==='before')for(const file of ['data/apartments/index.json','data/ground.geojson','js/roofs.js','js/slopes-apartments.js'])await page.route('**/'+file,r=>r.fulfill({contentType:file.endsWith('.js')?'application/javascript':'application/json',body:execFileSync('git',['show','9b9aacb:'+file],{maxBuffer:12000000,cwd:new URL('../../',import.meta.url)})}));
 await page.addInitScript(()=>{const t=setInterval(()=>{if(window.cancelGraphicsAutoDetect){cancelGraphicsAutoDetect();clearInterval(t)}},50)});
 await page.goto(BASE+'/index.html?intro=0&drift=0',{waitUntil:'domcontentloaded',timeout:180000});
 await page.waitForFunction(()=>window.slopesApartments?.count.done&&window.campusLandscape?.count.done&&window.__fly?.indexed()&&!__fly.eye().driving,null,{timeout:180000});
 await page.waitForTimeout(4000);
 console.log('models',await page.evaluate(()=>slopesApartments.count.buildings));
 for(const [name,ll,alt,bearing,targetZ,pitch,eye=false]of poses){
  if(process.env.CAMPUS_ONLY&&!process.env.CAMPUS_ONLY.split(',').includes(name))continue;
  await page.evaluate(({ll,alt,bearing,targetZ,pitch,eye,time})=>{
   for(const l of __map.getStyle().layers)if(l.type==='symbol')__map.setLayoutProperty(l.id,'visibility','none');
   const r=Math.PI/180,lead=(eye?alt:targetZ)*Math.tan(pitch*r),mx=111320*Math.cos(ll[1]*r);
   const center=[ll[0]+lead*Math.sin(bearing*r)/mx,ll[1]+lead*Math.cos(bearing*r)/111320];
   const zoom=Math.log2(__map.transform.cameraToCenterDistance*40075016.686*Math.cos(ll[1]*r)*Math.cos(pitch*r)/(512*alt));
   GFX.autoExposure=false;applyTimeOfDay(__map,time,true);__map.stop();__map.jumpTo({center,zoom,pitch,bearing,padding:{top:0,bottom:0,left:0,right:0}});
  },{ll,alt,bearing,targetZ,pitch,eye,time});
  await page.waitForTimeout(4500);const path=out+'/'+name+'-'+stage+'.jpg';await page.screenshot({path,quality:90});await page.waitForTimeout(900);await page.screenshot({path,quality:90});console.log(name);
 }
 fs.writeFileSync(out+'/runtime-'+stage+'.json',JSON.stringify(await page.evaluate(()=>({buildings:slopesApartments.built.map(b=>({name:b.name,top:b.top})),layers:__map.getStyle().layers.map(l=>({id:l.id,type:l.type,source:l.source,filter:l.filter})),rigs:slopesRoofs.data.roofs})),null,2));
 if(errors.length)throw new Error(errors.join('\n'));
 console.log('PASS matched campus visual repair views');
}finally{await browser.__done()}
