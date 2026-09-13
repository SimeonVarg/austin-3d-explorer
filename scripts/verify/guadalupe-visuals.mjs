import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright-core';
import {launch,BASE} from './chrome.mjs';
const out=process.env.VERIFY_OUT,stage=process.env.GUAD_STAGE||'after';
if(!out)throw new Error('VERIFY_OUT must be a scratch directory');
fs.mkdirSync(out,{recursive:true});
const poses=[
 ['south-guad',[-97.74218,30.2830],75,340,4,62],
 ['coop-street',[-97.74170,30.28612],3.2,278,0,86,true],
 ['guad-middle',[-97.7419,30.2865],105,330,5,62],
 ['guad-north',[-97.74165,30.2913],100,325,4,62],
 ['hole-in-wall',[-97.74132,30.29002],3.2,285,0,86,true],
 ['waterloo-rise',[-97.74393,30.2872],175,310,22,58],
 ['torre',[-97.74425,30.2836],110,310,20,58],
 ['pearl-apartments',[-97.74635,30.2855],125,315,10,58],
 ['north-apartments',[-97.7476,30.2903],140,305,9,58]
];
const browser=await launch(chromium,{gl:'hardware',maxMs:600000});
try{
 const page=await browser.newPage({viewport:{width:1440,height:960},reducedMotion:'reduce'}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error'&&/\[slopes-apartments\]/.test(m.text()))errors.push(m.text())});
 await page.addInitScript(()=>{const t=setInterval(()=>{if(window.cancelGraphicsAutoDetect){cancelGraphicsAutoDetect();clearInterval(t)}},50)});
 if(stage==='before')await page.route('**/data/campus_landscape.json',r=>r.fulfill({contentType:'application/json',body:execFileSync('git',['show','2f4bc2e:data/campus_landscape.json'],{maxBuffer:4000000})}));
 if(stage==='before')await page.route('**/data/apartments/index.json',r=>r.fulfill({contentType:'application/json',body:execFileSync('git',['show','2f4bc2e:data/apartments/index.json'],{maxBuffer:2000000})}));
 await page.goto(BASE+'/index.html?intro=0&drift=0'+(stage==='before'?'&guadalupe=0':''),{waitUntil:'domcontentloaded',timeout:180000});
 await page.waitForFunction(()=>window.slopesApartments?.count.done&&window.__fly?.indexed()&&!__fly.eye().driving,null,{timeout:180000});
 await page.waitForTimeout(5000);
 console.log('models',await page.evaluate(()=>slopesApartments.count.buildings));
 for(const [name,ll,alt,bearing,targetZ,pitch,eye=false]of poses){
  if(process.env.GUAD_ONLY&&!process.env.GUAD_ONLY.split(',').includes(name))continue;
  await page.evaluate(({ll,alt,bearing,targetZ,pitch,eye})=>{
   for(const l of __map.getStyle().layers)if(l.type==='symbol')__map.setLayoutProperty(l.id,'visibility','none');
   const r=Math.PI/180,lead=(eye?alt:targetZ)*Math.tan(pitch*r),mx=111320*Math.cos(ll[1]*r);
   const center=[ll[0]+lead*Math.sin(bearing*r)/mx,ll[1]+lead*Math.cos(bearing*r)/111320];
   const zoom=Math.log2(__map.transform.cameraToCenterDistance*40075016.686*Math.cos(ll[1]*r)*Math.cos(pitch*r)/(512*alt));
   applyTimeOfDay(__map,.12,true);__map.stop();__map.jumpTo({center,zoom,pitch,bearing,padding:{top:0,bottom:0,left:0,right:0}});
  },{ll,alt,bearing,targetZ,pitch,eye});
  await page.waitForTimeout(4500);const path=out+'/'+name+'-'+stage+'.jpg';await page.screenshot({path,quality:88});await page.waitForTimeout(900);await page.screenshot({path,quality:88});console.log(name);
  if(name==='coop-street')console.log('foreground',await page.evaluate(()=>({features:__map.queryRenderedFeatures([900,735]).slice(0,12).map(f=>({layer:f.layer.id,p:f.properties})),ray:slopes.raycast(900,735)?.object?.name})));

 }
 if(errors.length)throw new Error(errors.join('\n'));
 console.log('PASS matched Guadalupe views');
}finally{await browser.__done()}
