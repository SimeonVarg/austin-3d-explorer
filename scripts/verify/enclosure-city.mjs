import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {integrationOverlay} from '../enclosure/integration-overlay.mjs';
import {chromium} from 'playwright-core';
import {launch,HW_ARGS} from './chrome.mjs';
const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const args=process.argv.slice(2),arg=args.indexOf('--out');
assert(arg>=0&&args[arg+1],'usage: set VERIFY_URL and pass --out <outside-repo directory>');
const out=path.resolve(args[arg+1]),relative=path.relative(ROOT,out);
assert(relative.startsWith('..'+path.sep)||path.isAbsolute(relative),'capture output must be outside repository');
fs.mkdirSync(out,{recursive:true});process.chdir(out);
const url=new URL(process.env.VERIFY_URL||'http://127.0.0.1:8000');
assert(['localhost','127.0.0.1','[::1]'].includes(url.hostname),'use the local checkout server');
url.pathname='/index.html';url.search='intro=0&drift=0&preset=balanced&clip=1';
const report={started:new Date().toISOString(),settings:{cpu:1,dpr:1,viewport:[1440,960],fov:74,preset:'balanced',hardware:true},errors:[],shots:[],performance:[]};
const save=()=>fs.writeFileSync('report.json',JSON.stringify(report,null,2));
let apartments=integrationOverlay(fs.readFileSync(ROOT+'/js/slopes-apartments.js','utf8'),fs.readFileSync(ROOT+'/js/baked-enclosure.js','utf8'));
fs.writeFileSync('integration-apartments.js',apartments);
const lighting=fs.readFileSync(ROOT+'/js/city-lighting.js','utf8').replace('  function install(map) {','window.__depthProxyPending=()=>({dirty:!!proxyDirty,timer:!!proxyTimer});\n  function install(map) {');
const poses=[{"name":"battle-front","building":"Battle Hall","eye":[70,21.55],"target":[34.45,21.55],"alt":1.8,"pitch":88,"eyeLL":[-97.73979915823257,30.28537500916119],"bearing":-85.00000210641477},{"name":"union-front","eye":[26.85,-16],"target":[-97.74124578134443,30.285999867514185],"pitch":88,"alt":1.8,"eyeLL":[-97.7412602881938,30.28585668466142],"bearing":5.000031408256012},{"name":"gearing-court","eye":[26.1,-10],"eyeLL":[-97.73924014728303,30.287478156928522],"alt":1.8,"pitch":88,"bearing":5.0000000009998145,"target":[-97.73921612001382,30.287715303528408]}];
const browser=await launch(chromium,{gl:'hardware',maxMs:600000,args:[...HW_ARGS,'--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling']});
try {
 const page=await browser.newPage({viewport:{width:1440,height:960},deviceScaleFactor:1});
 const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});
 page.on('pageerror',e=>{report.errors.push(String(e));save()});
 await page.route('**/js/slopes-apl*',r=>r.continue());
 await page.route('**/js/slopes-apartments.js*',r=>r.fulfill({contentType:'application/javascript',body:apartments}));
 await page.route('**/js/city-lighting.js*',r=>r.fulfill({contentType:'application/javascript',body:lighting}));
 await page.addInitScript(()=>{const t=setInterval(()=>{window.cancelGraphicsAutoDetect?.();if(window.cancelGraphicsAutoDetect)clearInterval(t)},10)});
 await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:120000});
 const ready=()=>page.waitForFunction(()=>window.slopesApartments?.group&&slopesApartments.readyToReveal()&&!document.getElementById('veil')&&!window.__fly?.eye().driving&&slopesApartments.hidden.missing.length===0,null,{timeout:240000});
 await ready();
 report.initial=await page.evaluate(()=>{
  cancelGraphicsAutoDetect();GFX.autoExposure=false;GFX.fov=74;GFX.stars=0;GFX.grain=0;applyGraphics();if(window.WAYFIND)WAYFIND.on=false;
  const gl=__map.getCanvas().getContext('webgl2'),e=gl.getExtension('WEBGL_debug_renderer_info');
  window.__enclosureMesh=()=>slopesApartments.group.children.find(m=>m.name==='apartments');
  window.__setEnclosureStrength=s=>{__enclosureMesh().userData.enclosure.lease.setStrength(s);__map.triggerRepaint()};
  return {count:slopesApartments.count.buildings,renderer:gl.getParameter(e.UNMASKED_RENDERER_WEBGL),build:__enclosureBuild,attributes:Object.keys(__enclosureMesh().geometry.attributes)};
 });
 assert.equal(report.initial.count,196);assert.equal(report.initial.build.status,'ready');assert(report.initial.build.beforeSceneAdd);assert(!/swiftshader|software/i.test(report.initial.renderer));save();
 const settle=async()=>{await page.waitForFunction(()=>{const p=__depthProxyPending(),sun=__enclosureMesh().material.uniforms.u_sunDirection.value.z;return __map.areTilesLoaded()&&!p.timer&&(!p.dirty||sun<=0)},null,{timeout:60000});await page.waitForTimeout(1800)};
 const pose=async p=>{await page.evaluate(p=>{
  __map.stop();const rad=Math.PI/180,C=40030228.884,ML=C/360,lead=p.alt*Math.tan(p.pitch*rad),mx=ML*Math.cos(p.eyeLL[1]*rad),center=[p.eyeLL[0]+lead*Math.sin(p.bearing*rad)/mx,p.eyeLL[1]+lead*Math.cos(p.bearing*rad)/ML],camPx=.5*__map.getCanvas().clientHeight/Math.tan(__map.getVerticalFieldOfView()*rad/2),zoom=Math.log2(camPx*C*Math.cos(center[1]*rad)*Math.cos(p.pitch*rad)/(512*p.alt));
  __map.jumpTo({center,zoom,pitch:p.pitch,bearing:p.bearing,padding:{top:0,bottom:0,left:0,right:0}});
 },p);await settle()};
 const shot=async(name,p)=>{await page.screenshot({path:name+'-first.png'});await page.waitForTimeout(600);await page.screenshot({path:name+'.png'});const state=await page.evaluate(()=>({eye:__fly.eye(),calls:slopes.renderer.info.render.calls,triangles:slopes.renderer.info.render.triangles}));assert(Math.abs(state.eye.alt-p.alt)<.05);report.shots.push({name,pose:p,state});save();console.log('shot',name)};
 for(const p of poses){await pose(p);for(const [label,t] of (p.name==='union-front'?[['day',.3],['sunset',.5],['night',.78]]:[['sunset',.5]])){
  await page.evaluate(t=>applyTimeOfDay(__map,t,true),t);await settle();
  for(const [mode,s] of [['before',0],['after',.8],['return',0]]){await page.evaluate(s=>__setEnclosureStrength(s),s);await page.waitForTimeout(300);await shot(p.name+'-'+label+'-'+mode,p)}
 }}
 await pose(poses[1]);await page.evaluate(()=>applyTimeOfDay(__map,.3,true));await settle();
 report.picking=await page.evaluate(()=>{const pick=()=>{const r=slopes.raycast(720,480);return r&&{point:r.point,name:r.object.name,distance:r.distance}};__setEnclosureStrength(0);const before=pick();__setEnclosureStrength(.8);return {before,after:pick()}});assert(report.picking.before);assert.deepEqual(report.picking.before,report.picking.after);
 for(let rep=0;rep<6;rep++) {
  const on=rep%2===1;
  const status=await page.evaluate(async on=>{
   const mesh=__enclosureMesh(),e=mesh.userData.enclosure;
   if(on)e.lease=await e.session.attach({mesh,ranges:e.ranges,manifestURL:'data/enclosure/manifest.json',payloadURL:'data/enclosure/enclosure.bin'});
   else e.session.cancel();
   return {status:e.session.state.status,lease:!!e.lease};
  },on);if(on)assert.equal(status.status,'ready');
  await page.waitForTimeout(1800);
  const leg=await page.evaluate(()=>new Promise(resolve=>{let last=0;const times=[];const cb=()=>{const n=performance.now();if(last)times.push(n-last);last=n;if(times.length===160){__map.off('render',cb);resolve({times,calls:slopes.renderer.info.render.calls,triangles:slopes.renderer.info.render.triangles})}else __map.triggerRepaint()};__map.on('render',cb);__map.triggerRepaint()}));report.performance.push({rep,on,...leg});save();console.log('performance',rep,on);
 }
 // A normal full-city rebuild must retire the old lease and attach to the new geometry.
 await page.evaluate(()=>{window.__oldEnclosure=__enclosureMesh().userData.enclosure.session;window.__oldGeometry=__enclosureMesh().geometry;slopesApartments.rebuild()});
 await ready();report.rebuild=await page.evaluate(()=>({old:__oldEnclosure.state.status,new:__enclosureMesh().userData.enclosure.session.state,replaced:__oldGeometry!==__enclosureMesh().geometry,count:slopesApartments.count.buildings}));assert.equal(report.rebuild.old,'disposed');assert.equal(report.rebuild.new.status,'ready');assert(report.rebuild.replaced);assert.equal(report.rebuild.count,196);save();
 await pose(poses[1]);await page.evaluate(()=>applyTimeOfDay(__map,.5,true));await settle();await shot('union-rebuild-sunset',poses[1]);
 // Deliberately stale manifest: the actual city remains usable and unmodified.
 report.stale=await page.evaluate(async()=>{
  const mesh=__enclosureMesh(),e=mesh.userData.enclosure;e.session.cancel();
  const manifest=await fetch('data/enclosure/manifest.json').then(r=>r.json());manifest.targets[0].hashes.position='0'.repeat(64);
  const result=await e.session.attach({mesh,ranges:e.ranges,manifest,payloadURL:'data/enclosure/enclosure.bin'});
  return {status:e.session.state.status,reason:e.session.state.reason,result:!!result,packed:mesh.geometry.attributes.aFacet.array.some(v=>v>1)};
 });assert.equal(report.stale.status,'fallback');assert.equal(report.stale.packed,false);await settle();await shot('union-stale-fallback',poses[1]);
 report.programs=await page.evaluate(()=>slopes.renderer.info.programs.map(p=>p.diagnostics).filter(Boolean));assert(!report.programs.some(d=>d.runnable===false));assert.equal(report.errors.length,0);report.success=true;
}catch(e){report.failure=String(e.stack||e);console.error(report.failure);process.exitCode=1}finally{report.finished=new Date().toISOString();save();await browser.close();await browser.__done()}
