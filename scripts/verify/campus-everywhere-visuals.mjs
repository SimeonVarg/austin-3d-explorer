import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright-core';
import {launch,BASE} from './chrome.mjs';
const out=process.env.VERIFY_OUT,stage=process.env.CAMPUS_STAGE||'after';
if(!out)throw new Error('VERIFY_OUT must be a scratch directory');
fs.mkdirSync(out,{recursive:true});
const poses=[
 ['architecture',[-97.74083,30.28523],110,280,9],
 ['turtle-pond',[-97.73968,30.28693],82,205,7],
 ['honors-courtyard',[-97.73976,30.28852],110,35,8],
 ['dorm-courtyards',[-97.73546,30.28299],130,55,8],
 ['science-courts',[-97.73842,30.28815],125,315,9],
 ['east-academic',[-97.73673,30.28566],115,70,10],
 ['goldsmith-court',null,52,0,0,35,'GOL',30,40],
 ['goldsmith-walk',null,2.2,5,0,86,'GOL',30,35,true],
 ['gearing-walk',null,2.2,5,0,86,'GEA',26,-9,true]
];
const browser=await launch(chromium,{gl:'hardware',maxMs:600000});
try{
 const page=await browser.newPage({viewport:{width:1440,height:960},reducedMotion:'reduce'}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error'&&m.text().includes('[campus-landscape]'))errors.push(m.text())});
 await page.addInitScript(()=>{const t=setInterval(()=>{if(window.cancelGraphicsAutoDetect){cancelGraphicsAutoDetect();clearInterval(t)}},50)});
 if(stage==='before')await page.route('**/data/apartments/index.json',r=>r.fulfill({contentType:'application/json',body:execFileSync('git',['show','8ba4920:data/apartments/index.json'],{maxBuffer:2000000})}));
 await page.goto(BASE+'/index.html?intro=0&drift=0'+(stage==='before'?'&campuslandscape=0':''),{waitUntil:'domcontentloaded',timeout:180000});
 await page.waitForFunction(()=>window.slopesApartments?.count.done&&window.__fly?.indexed()&&!__fly.eye().driving,null,{timeout:180000});
 if(stage!=='before')await page.waitForFunction(()=>window.campusLandscape?.count.done,null,{timeout:180000});
 console.log('models',await page.evaluate(()=>slopesApartments.count.buildings));
 const halls=JSON.parse(fs.readFileSync(new URL('../../data/campus_buildings.json',import.meta.url))).buildings;
 for(const [name,centerLL,alt,bearing,targetZ,pitch=58,code,u,v,eye=false]of poses){
  if(process.env.CAMPUS_ONLY&&!process.env.CAMPUS_ONLY.split(',').includes(name))continue;
  let ll=centerLL;if(code){const F=halls.find(b=>b.code===code).frame.obb;ll=[F.o[0]+(u*F.ax-v*F.ay)/F.mx,F.o[1]+(u*F.ay+v*F.ax)/F.my]}
  await page.evaluate(({ll,alt,bearing,targetZ,pitch,eye})=>{
   for(const l of __map.getStyle().layers)if(l.type==='symbol')__map.setLayoutProperty(l.id,'visibility','none');
   const r=Math.PI/180,lead=(eye?alt:targetZ)*Math.tan(pitch*r),mx=111320*Math.cos(ll[1]*r);
   const center=[ll[0]+lead*Math.sin(bearing*r)/mx,ll[1]+lead*Math.cos(bearing*r)/111320];
   const zoom=Math.log2(__map.transform.cameraToCenterDistance*40075016.686*Math.cos(ll[1]*r)*Math.cos(pitch*r)/(512*alt));
   applyTimeOfDay(__map,.12,true);__map.stop();__map.jumpTo({center,zoom,pitch,bearing,padding:{top:0,bottom:0,left:0,right:0}});
  },{ll,alt,bearing,targetZ,pitch,eye});
  await page.waitForTimeout(4500);const path=out+'/'+name+'-'+stage+'.jpg';await page.screenshot({path,quality:90});await page.waitForTimeout(900);await page.screenshot({path,quality:90});console.log(name);
 }
 if(errors.length)throw new Error(errors.join('\n'));
 console.log('PASS matched campus views');
}finally{await browser.__done()}
