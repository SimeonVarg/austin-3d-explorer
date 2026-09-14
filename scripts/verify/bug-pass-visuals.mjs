import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright-core';
import {launch,BASE} from './chrome.mjs';
const root=new URL('../../',import.meta.url),out=process.env.VERIFY_OUT;
if(!out)throw new Error('Set VERIFY_OUT to a scratch directory for visual evidence');
fs.mkdirSync(out,{recursive:true});
const stage=process.env.WALK_STAGE||'after';
const idx=JSON.parse(fs.readFileSync(new URL('data/apartments/index.json',root)));
const buildings=idx.buildings.map(f=>JSON.parse(fs.readFileSync(new URL('data/apartments/'+f,root)))).concat(idx.collections.flatMap(f=>JSON.parse(fs.readFileSync(new URL(f,root))).buildings));
const targets=[['mark','The Mark Austin',140,5,60],['standard','The Standard',110,310,64],['pcl','Perry-Casta�eda Library',95,205,62],['welch','Robert A. Welch Hall',115,280,65],['jester','Jester West Hall',100,190,65],['sarah','Sarah M. and Charles E. Seay Building',95,320,65]];
const poses=targets.map(([key,name,alt,bearing,pitch])=>{const b=buildings.find(b=>b.name===name || (key==="pcl" && b.name.startsWith("Perry"))),r=b.footprint.ring;return [key,[r.reduce((s,p)=>s+p[0],0)/r.length,r.reduce((s,p)=>s+p[1],0)/r.length],alt,bearing,pitch,false]});
poses.push(['gdc',[-97.7366,30.2863],100,95,62,false],['eer',[-97.7357,30.2889],115,95,62,false],['west',[-97.73765,30.28550],2.2,305,80,true],['dkr',[-97.7321,30.2848],105,5,65,false],['speedway',[-97.73702,30.28367],6,10,83,true],['welch-road',[-97.7375,30.28515],95,5,45,false],['union-across',[-97.74535,30.2875],165,5,55,false]);
poses.push(['road-crossing',[-97.73798,30.28562],65,5,25,false]);
poses.push(['mark-close',[-97.74630,30.28726],64,5,55,true]);
poses.push(['dkr-exterior',[-97.7344,30.28355],22,80,65,true]);
poses.push(['square-tilt',[-97.73794,30.283205],2.2,185,80,true]);
poses.push(['union-day',[-97.74535,30.28795],17,5,65,true]);
poses.push(['family',[-97.7383,30.2837],8,5,75,true]);
poses.push(['union-street',[-97.74535,30.28795],17,5,65,true],['jester-entry',[-97.7368,30.28345],25,185,70,true]);
poses.push(['union-south',[-97.74515,30.28715],100,185,60,false],['union-north',[-97.7451,30.2882],70,5,60,false]);
poses.push(['mustangs',[-97.7333523,30.2870677],15,5,60,false],['eer-garden',[-97.7363,30.28835],80,95,55,false],['pcl-patio',[-97.73772,30.28317],12,185,62,false],['welch-entry',[-97.73698,30.28654],5,275,83,true],['gdc-entry',[-97.73728,30.28628],5,95,82,true],['dkr-wall',[-97.73395,30.28375],12,95,78,true],['sarah-close',[-97.73755,30.29021],35,5,60,false]);
const browser=await launch(chromium,{gl:'hardware',maxMs:600000});
try{
 const page=await browser.newPage({viewport:{width:1440,height:960},reducedMotion:'reduce'}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error'&&/\[(slopes|campus-landscape)|THREE.WebGL/.test(m.text()))errors.push(m.text())});
 if(stage==='before') for(const file of execFileSync('git',['diff','--diff-filter=M','--name-only','14d2bc1'],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(f=>/^(js|data)\//.test(f))) {
  let body;try{body=execFileSync('git',['show','14d2bc1:'+file],{cwd:root,maxBuffer:50000000})}catch{continue}
  await page.route('**/'+file,r=>r.fulfill({body,contentType:file.endsWith('.js')?'application/javascript':'application/json'}));
 }
 await page.addInitScript(()=>{const t=setInterval(()=>{if(window.cancelGraphicsAutoDetect){cancelGraphicsAutoDetect();clearInterval(t)}},50)});
 await page.goto(BASE+'/index.html?intro=0&drift=0&bugnight='+ (process.env.BUG_NIGHT||''),{waitUntil:'domcontentloaded',timeout:180000});
 await page.waitForFunction(()=>window.slopesApartments?.count.done&&window.campusLandscape?.count.done&&window.__fly?.indexed()&&!__fly.eye().driving,null,{timeout:180000});
 await page.waitForFunction(()=>!document.getElementById('veil')&&window.slopesArt?.count.done,null,{timeout:180000});
 const ownership={};
 for(const [name,center,alt,bearing,pitch,eye]of poses){
  if(process.env.WALK_ONLY&&!process.env.WALK_ONLY.split(',').includes(name))continue;
  await page.evaluate(({center,alt,bearing,pitch,eye})=>{
   for(const l of __map.getStyle().layers)if(l.type==='symbol')__map.setLayoutProperty(l.id,'visibility','none');
   const r=Math.PI/180,lead=(eye?alt:(alt<30?1:20))*Math.tan(pitch*r),mx=111320*Math.cos(center[1]*r);
   const target=[center[0]+lead*Math.sin(bearing*r)/mx,center[1]+lead*Math.cos(bearing*r)/111320];
   const zoom=Math.log2(__map.transform.cameraToCenterDistance*40075016.686*Math.cos(center[1]*r)*Math.cos(pitch*r)/(512*alt));
   GFX.autoExposure=false;applyTimeOfDay(__map,Number(new URLSearchParams(location.search).get("bugnight")||.12),true);__map.stop();__map.jumpTo({center:target,zoom,pitch,bearing,padding:0});
  },{center,alt,bearing,pitch,eye});
  await page.waitForFunction(()=>__map.getSource('austin-entrances')&&__map.isSourceLoaded('austin-entrances'),null,{timeout:180000});
  await page.waitForTimeout(4000);const path=out+'/'+name+'-'+stage+'.jpg';await page.screenshot({path,quality:90});await page.waitForTimeout(900);await page.screenshot({path,quality:90});
  if(['union-street','welch-road','pcl-patio','dkr-wall'].includes(name))ownership[name]=await page.evaluate(()=>[[700,810],[1250,805],[250,842],[650,915]].map(p=>({pixel:p,ll:__map.unproject(p).toArray(),hits:__map.queryRenderedFeatures(p).map(f=>({layer:f.layer.id,p:f.properties}))})));
  if(process.env.BUG_DIAG){
    const d=await page.evaluate(()=>({hits:[[300,470],[320,615],[1120,470],[710,330],[600,540]].map(p=>({p,ll:__map.unproject(p).toArray(),features:__map.queryRenderedFeatures(p).map(f=>({layer:f.layer.id,p:f.properties})).slice(0,8)})),rays:[[-97.73765,30.2902],[-97.7374,30.2898]].map(ll=>{const p=slopes.toLocal(...ll,100);return new THREE.Raycaster(new THREE.Vector3(p.x,p.y,p.z),new THREE.Vector3(0,0,-1)).intersectObject(slopesApartments.group,true).slice(0,3).map(h=>({z:h.point.z,n:h.face.normal.toArray(),side:h.object.material.side,det:h.object.matrixWorld.determinant(),ndc:[h.face.a,h.face.b,h.face.c].map(i=>new THREE.Vector3().fromBufferAttribute(h.object.geometry.attributes.position,i).applyMatrix4(slopes.camera.projectionMatrix).toArray())}))}),camera:{det:slopes.camera.projectionMatrix.determinant(),eye:slopes.uniforms().u_eye.value.toArray()}}));
    fs.writeFileSync(out+'/'+name+'-diag.json',JSON.stringify(d,null,2));
    await page.evaluate(()=>{slopesApartments.group.traverse(o=>{if(o.material){o.material.side=THREE.DoubleSide;o.material.needsUpdate=true}});__map.triggerRepaint()});await page.waitForTimeout(900);await page.screenshot({path:out+'/'+name+'-double.jpg',quality:90});
    await page.evaluate(()=>{campusLandscape.group.visible=false;__map.triggerRepaint()});await page.waitForTimeout(900);await page.screenshot({path:out+'/'+name+'-no-land.jpg',quality:90});
  }
  console.log(name);
 }
 fs.writeFileSync(out+'/runtime-'+stage+'.json',JSON.stringify(await page.evaluate(()=>({count:slopesApartments.count,landscape:campusLandscape.count,art:slopesArt.count})),null,2));
 fs.writeFileSync(out+'/ownership-'+stage+'.json',JSON.stringify(ownership,null,2));
 if(errors.length)throw new Error(errors.join('\n'));console.log('PASS walking views');
}finally{await browser.__done()}

