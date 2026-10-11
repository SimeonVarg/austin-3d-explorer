/** Actual rendered night emission, per authored building. --break must fail.
 * Isolate one recipe in the apartment batch, then rebuild the identical geometry
 * with production, dark, and fully lit explicit room openings. Existing normal
 * skins remain unchanged in those controls; normal-skin-only recipes instead
 * control CityNight.room. Only gain
 * inside the all-lit/dark difference mask counts: neighboring windows cannot pass.
 * The floor is 15% of the building's sampled CityNight occupancy (perspective,
 * pane area, and occlusion differ from a room count). This catches absent lighting,
 * not artistic occupancy changes. Capture twice after render/readiness fences.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
import {launch,BASE} from './chrome.mjs';
import {waitForApartmentBuild} from './lib/apartment-ready.mjs';
import {decodePNG} from './lib/png.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const OUT=process.env.VERIFY_OUT||fs.mkdtempSync(path.join(os.tmpdir(),'authored-night-windows-'));fs.mkdirSync(OUT,{recursive:true});
console.log('Artifacts: '+OUT);
const broken=process.argv.includes('--break');
const grandfathered={'moontower.json':536,'welch-hall.json':5,'robert-b-rowling-hall.json':168,'union-on-24th.json':10,'2400-nueces.json':98,'union-on-san-antonio.json':1743,'the-castilian.json':1,'inspire-on-22nd.json':4,'norman-hackerman-building.json':252};
function openings(x,out=[]){if(!x||typeof x!=='object')return out;if(Array.isArray(x.openings))out.push(...x.openings.filter(o=>o.glass));for(const [k,v]of Object.entries(x))if(k!=='openings')openings(v,out);return out;}
const recipes=fs.readdirSync(path.join(ROOT,'data/apartments')).filter(f=>f.endsWith('.json')).map(file=>({file,spec:JSON.parse(fs.readFileSync(path.join(ROOT,'data/apartments',file)))}));
const report={broken,checks:[],errors:[],exclusions:{'26 West Garage':'Car and railing glass is not residential room glazing.','Union on 24th':'Ten inherited entry-door openings are grandfathered; no newly authored residential explicit glass.'}};
function check(name,pass,detail){report.checks.push({name,pass,detail});console.log(`${pass?'PASS':'FAIL'} ${name}: ${JSON.stringify(detail)}`);}
for(const {file,spec}of recipes){const glass=openings(spec),invalid=glass.filter(o=>o.lit!=null&&![true,false,'room'].includes(o.lit));if(invalid.length)check('valid glazing lighting value '+file,false,{invalid:invalid.map(o=>o.lit),action:'Use lit: room, true, or false.'});const omitted=glass.filter(o=>o.lit==null).length;if(omitted)check('explicit glazing intent '+file,omitted<=(grandfathered[file]||0),{omitted,allowed:grandfathered[file]||0,action:'New glass requires lit: room, true, or false.'});}
const names=recipes.filter(r=>openings(r.spec).some(o=>o.lit==='room')).map(r=>r.spec.name);
for(const name of ['Rise at West Campus','26 West Rio Grande Bar','Noble 2500','The Quarters Nueces House','Texan Tower','Yugo The Corner'])check('room recipe selected '+name,names.includes(name),{});
names.push('The Standard','The Mark Austin','Twenty Two 15');
const browser=await launch(chromium,{maxMs:1500000});
try{
 const page=await browser.newPage({viewport:{width:960,height:720},deviceScaleFactor:1});page.on('pageerror',e=>report.errors.push(e.message));
 await page.addInitScript(()=>{const t=setInterval(()=>{if(window.cancelGraphicsAutoDetect){cancelGraphicsAutoDetect();clearInterval(t)}},20)});
 await page.goto(BASE+'/?intro=0&drift=0&namelabels=0',{waitUntil:'domcontentloaded',timeout:120000});
 await waitForApartmentBuild(page);await page.waitForFunction(()=>!document.getElementById('veil')&&!window.__fly?.eye().driving,null,{timeout:240000});
 report.settings=await page.evaluate(()=>{cancelGraphicsAutoDetect();GFX.autoExposure=false;GFX.grain=0;GFX.clouds=0;SKY_TUNE.TWINKLE.AMP=0;SKY_TUNE.GL.DRIFT=0;applyGraphics();applyTimeOfDay(__map,.95,true);window.__nightSpecs=structuredClone(slopesApartments.data.buildings);window.__realRoom=CityNight.room;const gl=slopes.renderer.getContext();return{viewport:[innerWidth,innerHeight],dpr:devicePixelRatio,renderer:gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL),time:.95,autoExposure:GFX.autoExposure};});
 async function settled(){await waitForApartmentBuild(page);await page.waitForFunction(()=>__map.areTilesLoaded()&&!__map.isMoving()&&Math.abs(__todCurrentP-.95)<.001,null,{timeout:240000});await page.evaluate(()=>new Promise(resolve=>{let n=0;const f=()=>{if(++n>=3){__map.off('render',f);resolve()}else __map.triggerRepaint()};__map.on('render',f);__map.triggerRepaint()}));}
 async function shot(name){await settled();await page.screenshot();const p=path.join(OUT,name+'.png');await page.screenshot({path:p});return p;}
 for(const name of names){
  const slug=name.toLowerCase().replace(/[^a-z0-9]+/g,'-');
  const meta=await page.evaluate(name=>{const spec=__nightSpecs.find(s=>s.name===name);if(!spec)throw Error('Missing runtime recipe '+name);let hits=0;for(let f=0;f<40;f++)for(let b=0;b<50;b++)hits+=__realRoom((spec.id||spec.name)+'|occupancy-probe|v0',f,b).lit;const ring=spec.footprint.ring;const center=ring.slice(0,-1).reduce((a,p)=>[a[0]+p[0]/(ring.length-1),a[1]+p[1]/(ring.length-1)],[0,0]);__map.stop();__map.jumpTo({center,zoom:18,pitch:55,bearing:25,padding:{top:210,bottom:0,left:0,right:0}});return{occupancy:hits/2000,id:spec.id};},name);
  const paths={};
  for(const mode of ['production','dark','full']){
   await page.evaluate(({name,mode,broken})=>{const spec=structuredClone(__nightSpecs.find(s=>s.name===name));let explicit=0;const visit=x=>{if(!x||typeof x!=='object')return;if(Array.isArray(x.openings))for(const o of x.openings)if(o.glass&&o.lit==='room'){explicit++;if(mode!=='production'||broken)o.lit=mode==='full'};for(const [k,v]of Object.entries(x))if(k!=='openings')visit(v)};visit(spec);slopesApartments.data.buildings=[spec];CityNight.room=explicit?__realRoom:(...args)=>{const room=__realRoom(...args);return mode==='production'&&!broken?room:{...room,lit:mode==='full'}};slopesApartments.rebuild();},{name,mode,broken});
   paths[mode]=await shot(slug+'-'+mode);
   const isolated=await page.evaluate(()=>slopesApartments.count.names);
   if(isolated.length!==1||isolated[0]!==name)throw Error('Apartment isolation failed: '+JSON.stringify(isolated));
  }
  const A=decodePNG(paths.production),D=decodePNG(paths.dark),F=decodePNG(paths.full);let capacity=0,gain=0;let bbox=[A.width,A.height,-1,-1];
  for(let p=0;p<A.width*A.height;p++){const ia=p*A.bpp,id=p*D.bpp,iff=p*F.bpp;const full=(F.data[iff]+F.data[iff+1]+F.data[iff+2])-(D.data[id]+D.data[id+1]+D.data[id+2]);if(full<30)continue;capacity++;const x=p%A.width,y=Math.floor(p/A.width);bbox=[Math.min(bbox[0],x),Math.min(bbox[1],y),Math.max(bbox[2],x),Math.max(bbox[3],y)];const own=(A.data[ia]+A.data[ia+1]+A.data[ia+2])-(D.data[id]+D.data[id+1]+D.data[id+2]);if(own>=30)gain++;}
  const fraction=gain/Math.max(1,capacity),minimum=meta.occupancy*.15;
  check(name+' own room emission',capacity>=100&&fraction>=minimum,{...meta,capacity,gain,fraction,minimum,bbox});
  if(broken)break; // One real dark render is enough to prove the gate rejects its negative control.
 }
 check('no runtime errors',report.errors.length===0,report.errors);
}finally{fs.writeFileSync(path.join(OUT,'result.json'),JSON.stringify(report,null,2));await browser.close();await browser.__done();}
if(report.checks.some(c=>!c.pass))process.exitCode=1;
