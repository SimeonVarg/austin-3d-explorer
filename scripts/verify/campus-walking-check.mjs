import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright-core';
import {launch,BASE,HW_ARGS} from './chrome.mjs';
const root=new URL('../../',import.meta.url),out=process.env.VERIFY_OUT;
const source=f=>fs.readFileSync(new URL(f,root),'utf8');
const old=f=>execFileSync('git',['show','f919494:'+f],{cwd:root,maxBuffer:4000000}).toString();
const polygon=s=>s.slice(s.indexOf(' function polygon('),s.indexOf(' function boxMesh('));
const shaders=s=>Object.fromEntries(['VERT','FRAG'].map(k=>[k,s.match(new RegExp('const '+k+' = `([\\s\\S]*?)`;'))[1]]));
const original=shaders(old('js/slopes.js'));
const oldLandscape=old('js/campus-landscape.js');
const oldCrown=Function('return ('+oldLandscape.match(/crown:(\{[^\n]+\}),/)[1]+')')();
const oldTrunk=Function('return ('+oldLandscape.match(/trunk:(\{[^\n]+\}),/)[1]+')')();
const browser=await launch(chromium,{gl:'hardware',args:process.env.WALK_PERF?[...HW_ARGS,'--disable-gpu-vsync','--disable-frame-rate-limit']:HW_ARGS,maxMs:720000});
try{
 const page=await browser.newPage({viewport:{width:1440,height:960},reducedMotion:'reduce'}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error'&&/\[(slopes|campus-landscape)|THREE.WebGL/.test(m.text()))errors.push(m.text())});
 await page.addInitScript(()=>{const t=setInterval(()=>{if(window.cancelGraphicsAutoDetect){cancelGraphicsAutoDetect();clearInterval(t)}},50)});
 await page.goto(BASE+'/index.html?intro=0&drift=0',{waitUntil:'domcontentloaded',timeout:180000});
 try{await page.waitForFunction(()=>window.slopesApartments?.count.done&&window.campusLandscape?.count.done&&window.__fly?.indexed(),null,{timeout:180000});}catch(e){console.log('boot',await page.evaluate(()=>({apartments:window.slopesApartments?.count,landscape:window.campusLandscape?.count,fly:window.__fly?.indexed(),entrances:window.__entDefer})),errors);throw e;}
 console.log('walking scene loaded');
 const geometry=await page.evaluate(()=>{
  let meshes=0,stone=0,glass=0,paving=0;
  slopes.root.traverse(o=>{if(!o.geometry?.attributes.aSurface)return;meshes++;
   const a=o.geometry.attributes,n=a.position.count;
   for(const k of ['position','normal','cDay','cGold','cNight','aSurface'])if(a[k].count!==n||a[k].array.some(v=>!Number.isFinite(v)))throw Error(o.name+' '+k);
   for(let i=0;i<n;i++){const kind=a.aSurface.getX(i);if(kind===1)stone++;if(kind===4)glass++;if(kind===3)paving++}
  });return {meshes,stone,glass,paving,trees:campusLandscape.count.trees};
 });
 assert.ok(geometry.stone>1000&&geometry.glass>1000&&geometry.paving>1000);
 assert.deepEqual(await page.evaluate(()=>slopesApartments.hidden.missing),[]);
 const caps=await page.evaluate(({current,previous})=>{
  const shape=[[[0,0],[10,0],[10,10],[0,10],[0,0],[0,0]],[[2,2],[2,4],[4,4],[4,2],[2,2],[2,2]]];
  function area(src){let n=0;const B={tri(a,b,c){n+=Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2}};
   Function('slopes','THREE',src+';return polygon')({toLocal:(x,y,z)=>({x,y,z})},THREE)(B,shape,0,[]);return n;
  }return {current:area(current),previous:area(previous)};
 },{current:polygon(source('js/campus-landscape.js')),previous:polygon(oldLandscape)});
 assert.equal(caps.current,96,'rounded duplicate closing vertices retain correct cap area');
 assert.notEqual(caps.previous,96,'original cap failure is observable');
 const ownership={};
 async function pose(code,u,v,alt=2.2,bearing=5,pitch=86){
  await page.evaluate(({code,u,v,alt,bearing,pitch})=>{
   const b=slopesApartments.data.buildings.find(b=>b.code===code),F=b.frame.obb;
   const center=[F.o[0]+(u*F.ax-v*F.ay)/F.mx,F.o[1]+(u*F.ay+v*F.ax)/F.my],r=Math.PI/180,lead=alt*Math.tan(pitch*r),mx=111320*Math.cos(center[1]*r);
   const target=[center[0]+lead*Math.sin(bearing*r)/mx,center[1]+lead*Math.cos(bearing*r)/111320];
   const zoom=Math.log2(__map.transform.cameraToCenterDistance*40075016.686*Math.cos(center[1]*r)*Math.cos(pitch*r)/(512*alt));
   GFX.autoExposure=false;applyTimeOfDay(__map,.12,true);__map.stop();__map.jumpTo({center:target,zoom,pitch,bearing,padding:0});
   window.__walkExpectedEye=slopes.toLocal(...center,alt);
  },{code,u,v,alt,bearing,pitch});await page.waitForFunction(()=>__map.getSource('austin-entrances')&&__map.isSourceLoaded('austin-entrances'),null,{timeout:180000});await page.waitForTimeout(4000);
 }
 await pose('GEA',26,-9);
 const ramp=await page.evaluate(()=>{
  const r=campusLandscape.data.ramps.find(r=>r.eid===239),lo=r.vertices.filter(v=>Math.abs(v[2]-r.toe)<.001),hi=r.vertices.filter(v=>Math.abs(v[2]-r.top)<.001);
  const mean=v=>v.reduce((s,p)=>s.map((x,i)=>x+p[i]/v.length),[0,0,0]),a=mean(lo),b=mean(hi);
  campusLandscape.group.updateMatrixWorld(true);
  return [0.15,.5,.85].map(t=>{const ll=a.map((x,i)=>x+(b[i]-x)*t),p=slopes.toLocal(ll[0],ll[1],10),expected=ll[2];const hits=new THREE.Raycaster(new THREE.Vector3(p.x,p.y,p.z),new THREE.Vector3(0,0,-1)).intersectObject(campusLandscape.group,true);return {expected,actual:hits[0]?.point.z}});
 });
 assert.ok(ramp.every(p=>Math.abs(p.actual-p.expected)<.005),'continuous Gearing ramp plane '+JSON.stringify(ramp));
 assert.equal(await page.evaluate(()=>__map.queryRenderedFeatures({layers:['entrances-detail']}).filter(f=>f.properties.k==='ramp'&&f.properties.eid===239).length),0,'old ramp steps retire');
 ownership.gearing=await page.evaluate(()=>[[1110,550],[960,484],[1300,600]].map(p=>({pixel:p,features:__map.queryRenderedFeatures(p).map(f=>({layer:f.layer.id,p:f.properties})),mesh:(()=>{const h=slopes.raycast(...p);return h?{name:h.object.name,point:h.point}:null})()})));
 if(out)fs.writeFileSync(out+'/walking-ownership.json',JSON.stringify(ownership,null,2));
 const eye=await page.evaluate(()=>{const a=slopes.uniforms().u_eye.value,b=window.__walkExpectedEye;return {actual:a.toArray(),expected:b,error:Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)}});
 assert.ok(eye.error<.1,'material view vector follows physical camera '+JSON.stringify(eye));
 const filtered=()=>page.evaluate(()=>__map.queryRenderedFeatures({layers:['ground-paths-texture','ground-close-path-grain']}).filter(f=>'walk_z'in f.properties).length);
 assert.equal(await filtered(),0,'old pilot textures retire');
 await page.evaluate(()=>{CAMPUS_LANDSCAPE.on=false;applyCampusLandscape()});await page.waitForTimeout(1500);
 assert.ok(await filtered()>0,'texture fallback restores');
 await page.evaluate(()=>{CAMPUS_LANDSCAPE.on=true;applyCampusLandscape()});
 await pose('GOL',30,35);
 const shots=[];
 for(const on of [true,false,true]){
  await page.evaluate(on=>{SLOPES.surfaces.on=on;__map.triggerRepaint()},on);await page.waitForTimeout(900);
  await page.screenshot();await page.waitForTimeout(300);shots.push((await page.screenshot({clip:{x:450,y:200,width:400,height:650}})).toString('base64'));
 }
 const pixels=await page.evaluate(async shots=>{
  const arrays=[];for(const s of shots){const i=new Image();i.src='data:image/png;base64,'+s;await i.decode();const c=document.createElement('canvas');c.width=i.width;c.height=i.height;const ctx=c.getContext('2d');ctx.drawImage(i,0,0);arrays.push(ctx.getImageData(0,0,c.width,c.height).data)}
  const diff=(a,b)=>{let n=0;for(let i=0;i<a.length;i+=4)if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>6)n++;return n};
  return {changed:diff(arrays[0],arrays[1]),repeat:diff(arrays[0],arrays[2])};
 },shots);
 assert.ok(pixels.changed>1000&&pixels.repeat<pixels.changed*.2,'visible, repeatable surface detail '+JSON.stringify(pixels));
 const bridge=await page.evaluate(()=>{
  const b=slopesApartments.data.buildings.find(b=>b.code==='WCP'),F=b.frame.obb,part=b.blocks.find(b=>b.id==='patton-bridge');
  const c=part.plan.reduce((s,p)=>[s[0]+p[0]/4,s[1]+p[1]/4],[0,0]);
  const ll=[F.o[0]+(c[0]*F.ax-c[1]*F.ay)/F.mx,F.o[1]+(c[0]*F.ay+c[1]*F.ax)/F.my],p=slopes.toLocal(...ll,5);
  slopesApartments.group.updateMatrixWorld(true);const down=new THREE.Raycaster(new THREE.Vector3(p.x,p.y,5),new THREE.Vector3(0,0,-1)).intersectObject(slopesApartments.group,true);const up=new THREE.Raycaster(new THREE.Vector3(p.x,p.y,5),new THREE.Vector3(0,0,1)).intersectObject(slopesApartments.group,true);return {ground:down.length,soffit:up[0]?.point.z,expected:part.z0};
 });assert.equal(bridge.ground,0,'bridge leaves ground passage open');assert.ok(Math.abs(bridge.soffit-bridge.expected)<.001,'bridge has a real underside');
 for(const preset of ['performance','cinematic','balanced']){
  await page.evaluate(p=>{__usePreset(p);applyTimeOfDay(__map,.95,true)},preset);await page.waitForTimeout(900);
  assert.ok(await page.evaluate(()=>slopes.uniforms().u_surfaceSky.value.toArray().every(Number.isFinite)));
 }
 const frames=[];
 if(process.env.WALK_PERF){
  const current=await page.evaluate(()=>({crown:structuredClone(CAMPUS_LANDSCAPE.crown),trunk:structuredClone(CAMPUS_LANDSCAPE.trunk)}));
  // Isolate the expensive shared shader and tree morphology. The new two
  // buildings and pilot ground stay present in both states, explicitly.
  for(const state of ['after','before','before','after','before','after']){
   await page.evaluate(({state,current,oldCrown,oldTrunk,original})=>{
    Object.assign(CAMPUS_LANDSCAPE.crown,state==='before'?{...oldCrown,mainDepth:1,mainRise:0,angleJitter:0,sizeJitter:0}:current.crown);
    Object.assign(CAMPUS_LANDSCAPE.trunk,state==='before'?oldTrunk:current.trunk);campusLandscape.rebuild();
    slopes.root.traverse(o=>{for(const m of (o.material?Array.isArray(o.material)?o.material:[o.material]:[])){
     if(!m.uniforms?.u_surfaceRange)continue;
     if(!m.userData.walkShaders)m.userData.walkShaders={VERT:m.vertexShader,FRAG:m.fragmentShader};
     const s=state==='before'?original:m.userData.walkShaders;m.vertexShader=s.VERT;m.fragmentShader=s.FRAG;m.needsUpdate=true;
    }});
    __map.jumpTo({center:[-97.7379,30.28395],zoom:17.6,pitch:60,bearing:310,padding:0});GFX.autoExposure=false;applyTimeOfDay(__map,.12,true);
   },{state,current,oldCrown,oldTrunk,original});await page.waitForTimeout(2500);
   const median=await page.evaluate(async()=>{const times=[];let last=performance.now();await new Promise(resolve=>{function step(t){times.push(t-last);last=t;__map.setBearing(310+times.length*.1);if(times.length<150)requestAnimationFrame(step);else resolve()}requestAnimationFrame(step)});const a=times.slice(20).sort((a,b)=>a-b);return a[Math.floor(a.length/2)]});
   frames.push({state,median});console.log('frame',state,median.toFixed(2),'ms');
  }
  const min=s=>Math.min(...frames.filter(f=>f.state===s).map(f=>f.median));
  assert.ok(min('after')<=min('before')*1.35+2,'shared shader/tree budget '+JSON.stringify(frames));
 }
 assert.deepEqual(errors,[]);
 if(out)fs.writeFileSync(out+'/walking-gates.json',JSON.stringify({geometry,caps,eye,pixels,bridge,ramp,ownership,frames,errors},null,2));
 console.log('PASS walking materials, watched cap failure, physical camera, texture fallback, elevated passage and presets');
}finally{await browser.__done()}
