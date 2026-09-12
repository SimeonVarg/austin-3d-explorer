import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright-core';
import {launch,BASE} from './chrome.mjs';
const out=process.env.VERIFY_OUT;
if(!out)throw new Error('VERIFY_OUT must point at the scratch directory');
fs.mkdirSync(out,{recursive:true});
const stage=process.env.VISUAL_STAGE||'after';
const root=new URL('../../',import.meta.url);
const targets=[['union-sa','union-on-san-antonio',120,185],['villas24','villas-on-24th',140,165],['icon','icon',315,170],['inspire','inspire-on-22nd',310,130],['rambler','rambler',135,140],['pointe','pointe-on-rio',30,125],['battle','battle-hall',265,65],['union-campus','texas-union',45,140],['pcl','pcl',140,115],['welch','welch-hall',35,145],['south-mall','mezes-hall',90,125],['gregory','gregory',100,125]];
const selected=(process.env.VISUAL_ONLY||'').split(',').filter(Boolean);
const specs=new Map(targets.map(([,slug])=>[slug,slug==='gregory'?{name:'Gregory Gym',footprint:{ring:JSON.parse(fs.readFileSync(new URL('data/snapshots/2026-09-12/buildings.detailed.geojson',root))).features.find(f=>f.properties.name==='Gregory Gym').geometry.coordinates[0]},frame:{},blocks:[{z1:30.4}]}:JSON.parse(fs.readFileSync(new URL('data/apartments/'+slug+'.json',root)))]));
const browser=await launch(chromium,{gl:'hardware',maxMs:600000});
let failed=false;
try{
 const page=await browser.newPage({viewport:{width:1440,height:960},reducedMotion:'reduce'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 if(stage==='before'){
  const paths=['js/slopes-roofs.js','js/slopes-apartments.js','data/apartments/index.json','data/apartments/union-on-san-antonio.json'];
  for(const path of paths){const body=execFileSync('git',['show','d549ef0:'+path],{maxBuffer:3000000,cwd:root});await page.route('**/'+path+'*',r=>r.fulfill({status:200,contentType:path.endsWith('.js')?'text/javascript':'application/json',body}));}
 }
 await page.addInitScript(()=>{const t=setInterval(()=>{if(window.cancelGraphicsAutoDetect){cancelGraphicsAutoDetect();clearInterval(t);}},50)});
 await page.goto(BASE+'/index.html?intro=0&drift=0',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.slopesApartments?.count.done&&window.__fly?.indexed()&&!__fly.eye().driving,null,{timeout:180000});
 console.log(stage,'loaded',await page.evaluate(()=>slopesApartments.count.buildings));
 for(const [name,slug,bearing,alt]of targets){
  if(selected.length&&!selected.includes(name))continue;
  const spec=specs.get(slug);
  const pose=await page.evaluate(({spec,bearing,alt})=>{
   for(const l of __map.getStyle().layers)if(l.type==='symbol')__map.setLayoutProperty(l.id,'visibility','none');
   const F=spec.frame.obb||slopesApartments.obbOf(spec.footprint.ring),u=F.L/2,v=F.W/2;
   const ll=[F.o[0]+(u*F.ax-v*F.ay)/F.mx,F.o[1]+(u*F.ay+v*F.ax)/F.my];
   const h=Math.max(...spec.blocks.map(b=>b.z1+(b.parapet||0))),target=h*.48;
   const pitch=55,rad=Math.PI/180,lead=target*Math.tan(pitch*rad),mx=111320*Math.cos(ll[1]*rad);
   const center=[ll[0]+lead*Math.sin(bearing*rad)/mx,ll[1]+lead*Math.cos(bearing*rad)/111320];
   const zoom=Math.log2(__map.transform.cameraToCenterDistance*40075016.686*Math.cos(ll[1]*rad)*Math.cos(pitch*rad)/(512*alt));
   applyTimeOfDay(__map,.12,true);__map.stop();const pose={center,zoom,pitch,bearing,padding:{top:0,bottom:0,left:0,right:0}};__map.jumpTo(pose);return pose;
  },{spec,bearing,alt});
  await page.waitForTimeout(4500);await page.screenshot({path:out+'/'+name+'-'+stage+'-review.jpg',quality:90});await page.waitForTimeout(900);await page.screenshot({path:out+'/'+name+'-'+stage+'-review.jpg',quality:90});console.log(name,JSON.stringify(pose));
 }
 const info=await page.evaluate(()=>({counts:slopesApartments.count,models:slopesApartments.built,hidden:slopesApartments.hidden}));fs.writeFileSync(out+'/'+stage+'-review-report.json',JSON.stringify({...info,errors},null,2));
 if(errors.length)throw new Error(errors.join('\n'));
}catch(e){failed=true;console.error(e.stack);}finally{await browser.__done();}
if(failed)process.exitCode=1;
