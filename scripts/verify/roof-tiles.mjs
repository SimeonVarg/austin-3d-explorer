/** Roof tile gate. Actual campus mesh + production material, sampled in metres.
 * --baseline DIR records the unchanged renderer; --out DIR --against DIR checks it.
 * The orthographic measurement is not a replacement for the matched city views.
 * No server is started. Run through the GPU queue with VERIFY_URL set.
 */
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright-core';
import {launch, BASE} from './chrome.mjs';
const args=process.argv.slice(2), opt=(k,d)=>args.includes(k)?args[args.indexOf(k)+1]:d;
const baseline=opt('--baseline',null), out=baseline||opt('--out',null), against=opt('--against',null),legacy=opt('--legacy',null);
if(!out)throw Error('Supply --baseline DIR or --out DIR');
fs.mkdirSync(out,{recursive:true});
const TUNE={name:'Mezes Hall',nonTile:'Prather Hall',apartment:'The Standard',pitchM:.25,periodTolerance:.08,farTolerance:1,signalMin:.4,
  width:768,height:384,span:6,farSpan:384,controlMinPixels:1000,apartmentSpan:100};
const report={checks:[],samples:{},requests:[],contextRequests:[]};
const check=(name,pass,detail)=>{report.checks.push({name,pass,detail});console.log(`${pass?'PASS':'FAIL'} ${name}: ${JSON.stringify(detail)}`);};
const browser=await launch(chromium,{gl:'hardware',maxMs:300000});
try{
 const page=await browser.newPage({viewport:{width:1280,height:800},deviceScaleFactor:1});
 // Route saved source at the original URL so the unchanged comparison has
 // the same resource names and application startup as the candidate.
 if(legacy)for(const name of ['slopes','slopes-roofs','wall-patterns']){
  const source=path.join(legacy,name+'-before.js');
  if(!fs.existsSync(source))throw Error('Missing legacy source: '+name+'-before.js');
  await page.route(new RegExp('/js/'+name+'\\.js(?:\\?.*)?$'),route=>route.fulfill({path:source,contentType:'application/javascript'}));
 }
 page.on('request',r=>report.requests.push(r.url().replace(BASE,'')));
 page.context().on('request',r=>report.contextRequests.push(r.url().replace(BASE,'')));
 page.on('pageerror',e=>console.log('PAGEERROR '+e.message));
 await page.addInitScript(()=>{const t=setInterval(()=>{if(window.cancelGraphicsAutoDetect){window.cancelGraphicsAutoDetect();clearInterval(t);}},20);});
 await page.goto(BASE+'/index.html?intro=0&drift=0&namelabels=0',{waitUntil:'domcontentloaded',timeout:120000});
 await page.waitForFunction(()=>window.slopesRoofs?.group&&window.slopesApartments?.count.done&&!document.getElementById('veil'),null,{timeout:180000});
 await page.evaluate(()=>{window.cancelGraphicsAutoDetect();window.GFX.autoExposure=false;window.__map.jumpTo({center:[-97.739,30.2848],zoom:18,pitch:55,bearing:0});});
 await page.waitForTimeout(1200);
 report.info=await page.evaluate(()=>{
  const S=window.slopes,gl=S.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');
  const groups=S.root.children.filter(g=>/slopes-roofs|slopes-tower/.test(g.name));
  let triangles=0,bytes=0;groups.forEach(g=>g.traverse(m=>{if(!m.geometry)return;const a=m.geometry;triangles+=(a.index?.count||a.attributes.position.count)/3;bytes+=Object.values(a.attributes).reduce((s,x)=>s+x.array.byteLength,0)+(a.index?.array.byteLength||0);}));
  return{triangles,bytes,lines:window.slopesRoofs.count.lines,renderer:gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),lens:window.__map.transform.cameraToCenterDistance,feature:!!window.SLOPES_ROOFS.tiles,groups:groups.map(g=>g.name)};
 });
 check('actual roof mesh present',report.info.triangles>100&&report.info.groups.includes('slopes-roofs'),report.info);
 // Render the actual batched roofs through their own shader. The camera faces
 // the longest slope of the named rig. No test swatch or fallback slab is used.
 await page.evaluate(T=>{
  window.__roofMemory=()=>{
   let triangles=0,bytes=0;
   window.slopes.root.children.filter(g=>/slopes-roofs|slopes-tower/.test(g.name)).forEach(g=>g.traverse(m=>{
    if(!m.geometry)return;const a=m.geometry;triangles+=(a.index?.count||a.attributes.position.count)/3;
    bytes+=Object.values(a.attributes).reduce((s,x)=>s+x.array.byteLength,0)+(a.index?.array.byteLength||0);
   }));return{triangles,bytes};
  };
  const inside=(x,y,ring)=>{let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){
   const a=ring[i],b=ring[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])hit=!hit;
  }return hit;};
  window.__roofRead=(on,far=false,name=T.name)=>{
   const S=window.slopes,R=window.slopesRoofs,TH=window.THREE,r=R.rig(name);
   if(!r)throw Error('Named roof is not present: '+name);const F=r.full||r;
   if(window.SLOPES_ROOFS.tiles)window.SLOPES_ROOFS.tiles.on=on;
   window.__map.redraw();
   let best=0,len=0;
   for(let i=0;i<F.pts.length;i++){const j=(i+1)%F.pts.length,d=Math.hypot(F.pts[j][0]-F.pts[i][0],F.pts[j][1]-F.pts[i][1]);if(d>len){len=d;best=i;}}
   const i=best,j=(i+1)%F.pts.length,d=Math.min(F.caps[i],F.caps[j],F.d)*.45;
   const points=[i,j].map(k=>S.toLocal((F.pts[k][0]+F.rays[k][0]*d)*r.dpm[0],(F.pts[k][1]+F.rays[k][1]*d)*r.dpm[1],r.base+R.data.meta.lip+F.rise*d/F.d));
   const a=new TH.Vector3(...Object.values(points[0])),b=new TH.Vector3(...Object.values(points[1]));
   const c=a.clone().add(b).multiplyScalar(.5),across=b.clone().sub(a).normalize();
   const normal=new TH.Vector3(across.y,-across.x,F.d/F.rise).normalize(),up=new TH.Vector3().crossVectors(normal,across).normalize();
   const span=far?T.farSpan:T.span,cam=new TH.OrthographicCamera(-span/2,span/2,span/4,-span/4,.1,1000);
   cam.position.copy(c).addScaledVector(normal,200);cam.up.copy(up);cam.lookAt(c);cam.updateMatrixWorld(true);
   const scene=new TH.Scene(),original=R.group.children.find(x=>x.isMesh);
   let isolated=null;
   if(name!==T.name){
    // Select real roof triangles inside the named footprint. Retain the
    // production attributes/material; neighbouring tile roofs cannot enter
    // this control through either the camera or a background pixel.
    const g=original.geometry,p=g.attributes.position,idx=g.index,ring=r.pts.map(v=>{
     const q=S.toLocal(v[0]*r.dpm[0],v[1]*r.dpm[1],0);return[q.x,q.y];
    }),indices=[];
    for(let k=0;k<(idx?.count||p.count);k+=3){
     const v=[0,1,2].map(i=>idx?idx.getX(k+i):k+i);
     const x=v.reduce((s,i)=>s+p.getX(i),0)/3,y=v.reduce((s,i)=>s+p.getY(i),0)/3;
     if(inside(x,y,ring))indices.push(...v);
    }
    if(!indices.length)throw Error('No production triangles for '+name);
    isolated=new TH.BufferGeometry();for(const [key,a]of Object.entries(g.attributes))isolated.setAttribute(key,a);
    isolated.setIndex(indices);
   }
   const mesh=new TH.Mesh(isolated||original.geometry,original.material);scene.add(mesh);
   const rt=new TH.WebGLRenderTarget(T.width,T.height),ren=S.renderer,prev=ren.getRenderTarget(),clear=ren.getClearColor(new TH.Color()),alpha=ren.getClearAlpha();
   ren.resetState();ren.setRenderTarget(rt);ren.setClearColor(0,0);ren.clear();ren.render(scene,cam);ren.clear();ren.render(scene,cam);
   const data=new Uint8Array(T.width*T.height*4);ren.readRenderTargetPixels(rt,0,0,T.width,T.height,data);
   ren.setRenderTarget(prev);ren.setClearColor(clear,alpha);rt.dispose();
   // Shared attributes belong to the app, so detach them before disposal.
   if(isolated){for(const key of Object.keys(isolated.attributes))isolated.deleteAttribute(key);isolated.dispose();}
   ren.resetState();window.__map.triggerRepaint();
   return{data:Array.from(data),c:c.toArray(),normal:normal.toArray(),across:across.toArray(),span,name,memory:window.__roofMemory()};
  };
  window.__apartmentRead=on=>{
   const S=window.slopes,A=window.slopesApartments,TH=window.THREE;
   const built=A.built.find(b=>b.name===T.apartment),ll=A.uvToLngLat(T.apartment,0,0);
   if(!built||!ll||!A.group)throw Error('Named apartment is not drawn: '+T.apartment);
   if(window.SLOPES_ROOFS.tiles)window.SLOPES_ROOFS.tiles.on=on;
   window.__map.redraw();
   const p=S.toLocal(ll[0],ll[1],built.top*.5),c=new TH.Vector3(p.x,p.y,p.z),span=T.apartmentSpan;
   const cam=new TH.OrthographicCamera(-span/2,span/2,span/4,-span/4,.1,1000);
   cam.position.copy(c).add(new TH.Vector3(100,-140,90));cam.up.set(0,0,1);cam.lookAt(c);cam.updateMatrixWorld(true);
   // Only existing apartment meshes are drawn. This named-building view
   // includes its finished materials and excludes the campus roofs group.
   const scene=new TH.Scene();A.group.traverse(original=>{if(!original.isMesh)return;
    const material=Array.isArray(original.material)&&original.material.length===1?original.material[0]:original.material;
    const mesh=new TH.Mesh(original.geometry,material);mesh.matrix.copy(original.matrixWorld);mesh.matrixAutoUpdate=false;scene.add(mesh);
   });
   const ren=S.renderer,rt=new TH.WebGLRenderTarget(T.width,T.height),prev=ren.getRenderTarget(),clear=ren.getClearColor(new TH.Color()),alpha=ren.getClearAlpha();
   ren.resetState();ren.setRenderTarget(rt);ren.setClearColor(0,0);ren.clear();ren.render(scene,cam);ren.clear();ren.render(scene,cam);
   const data=new Uint8Array(T.width*T.height*4);ren.readRenderTargetPixels(rt,0,0,T.width,T.height,data);
   ren.setRenderTarget(prev);ren.setClearColor(clear,alpha);rt.dispose();ren.resetState();window.__map.triggerRepaint();
   return{data:Array.from(data),name:built.name,c:c.toArray(),span,memory:window.__roofMemory()};
  };
 },TUNE);
 for(const [name,on,far]of[['close-off',false,false],['close-on',true,false],['far-off',false,true],['far-on',true,true],['close-return',false,false]]){
  const r=await page.evaluate(([a,b])=>window.__roofRead(a,b),[on,far]);
  fs.writeFileSync(path.join(out,name+'.rgba'),Buffer.from(r.data));
  report.samples[name]={c:r.c,normal:r.normal,across:r.across,span:r.span,memory:r.memory};
 }
 const load=n=>fs.readFileSync(path.join(out,n+'.rgba')), off=load('close-off'),on=load('close-on');
 const diff=(a,b)=>{let n=0,max=0;for(let i=0;i<a.length;i+=4){let d=0;for(let c=0;c<3;c++)d=Math.max(d,Math.abs(a[i+c]-b[i+c]));if(d)n++;max=Math.max(max,d);}return{pixels:n,max};};
 check('switch returns identical mesh pixels',off.equals(load('close-return')),diff(off,load('close-return')));
 check('live toggle preserves roof triangles and buffer bytes',JSON.stringify(report.samples['close-off'].memory)===JSON.stringify(report.samples['close-on'].memory),{off:report.samples['close-off'].memory,on:report.samples['close-on'].memory});
 const profile=Array(TUNE.width).fill(0);let signal=0;
 for(let x=0;x<TUNE.width;x++){for(let y=TUNE.height/4;y<3*TUNE.height/4;y++){let i=(y*TUNE.width+x)*4;profile[x]+=(on[i]+on[i+1]+on[i+2]-off[i]-off[i+1]-off[i+2])/(3*TUNE.height/2);}signal+=Math.abs(profile[x])/TUNE.width;}
 let peak={power:0,period:0};
 for(let cycles=8;cycles<=60;cycles+=.05){let re=0,im=0;for(let x=0;x<profile.length;x++){const a=2*Math.PI*cycles*x/profile.length;re+=profile[x]*Math.cos(a);im+=profile[x]*Math.sin(a);}const power=Math.hypot(re,im);if(power>peak.power)peak={power,period:TUNE.span/cycles};}
 check('measured cross-slope brightness period',signal>TUNE.signalMin&&Math.abs(peak.period-TUNE.pitchM)<TUNE.pitchM*TUNE.periodTolerance,{...peak,signal,expected:TUNE.pitchM});
 const fa=load('far-off'),fb=load('far-on');let sum=[0,0,0],n=0;
 for(let i=0;i<fa.length;i+=4)if(fa[i+3]&&fb[i+3]){for(let c=0;c<3;c++)sum[c]+=fb[i+c]-fa[i+c];n++;}
 const mean=sum.map(x=>x/Math.max(n,1));check('far mean remains baked roof colour',n>0&&mean.every(x=>Math.abs(x)<=TUNE.farTolerance),{meanDelta:mean,pixels:n,tolerance:TUNE.farTolerance});
 check('no pale ridge or hip geometry',report.info.lines===0,report.info.lines);
 for(const [key,named]of[['non-tile',TUNE.nonTile],['apartment',TUNE.apartment]]){
  for(const on of [false,true]){
   const result=await page.evaluate(({key,named,on})=>key==='non-tile'?window.__roofRead(on,false,named):window.__apartmentRead(on),{key,named,on});
   const sample=key+(on?'-on':'-off');fs.writeFileSync(path.join(out,sample+'.rgba'),Buffer.from(result.data));
   report.samples[sample]={name:result.name,c:result.c,span:result.span,memory:result.memory};
  }
  const a=load(key+'-off'),b=load(key+'-on');let drawn=0;for(let i=3;i<a.length;i+=4)if(a[i])drawn++;
  check(named+' production mesh has drawn pixels',drawn>=TUNE.controlMinPixels,{drawn,minimum:TUNE.controlMinPixels});
  check(named+' is pixel-identical with tiles on',a.equals(b),diff(a,b));
 }
 // A set tests resource identity, while raw counts remain in the report.
 // Keep page requests for compatibility with the original recorded gate;
 // context requests additionally cover worker-originated traffic.
 const network=urls=>urls.filter(u=>!u.startsWith('blob:')&&!u.startsWith('data:'));
 report.resources=[...new Set(network(report.requests))].sort();
 report.contextResources=[...new Set(network(report.contextRequests))].sort();
 if(against){const old=JSON.parse(fs.readFileSync(path.join(against,'gate.json'),'utf8'));
  check('triangle and buffer byte identity',report.info.triangles===old.info.triangles&&report.info.bytes===old.info.bytes,{before:old.info,after:report.info});
  const oldFrame=fs.readFileSync(path.join(against,'close-off.rgba'));check('feature off equals unchanged renderer',oldFrame.equals(off),diff(oldFrame,off));
  const resourceSet=new Set(network(old.resources||old.requests)),added=report.resources.filter(r=>!resourceSet.has(r));
  check('no new requested resources',added.length===0,{before:resourceSet.size,after:report.resources.length,added,requestCounts:{before:old.requests.length,after:report.requests.length}});
  if(old.contextResources){const previous=new Set(old.contextResources),extra=report.contextResources.filter(r=>!previous.has(r));
   check('no new worker or page resources',extra.length===0,{before:previous.size,after:report.contextResources.length,added:extra});
  }
  for(const [key,named]of[['non-tile',TUNE.nonTile],['apartment',TUNE.apartment]]){
   const file=path.join(against,key+'-off.rgba');
   if(!fs.existsSync(file)){check(named+' equals unchanged renderer',false,'Baseline lacks this control; record it with --baseline DIR --legacy DIR.');continue;}
   const previous=fs.readFileSync(file),current=load(key+'-on');
   check(named+' equals unchanged renderer',previous.equals(current),diff(previous,current));
  }
 }
}finally{await browser.__done();fs.writeFileSync(path.join(out,'gate.json'),JSON.stringify(report,null,2));}
if(report.checks.some(c=>!c.pass))process.exitCode=1;
