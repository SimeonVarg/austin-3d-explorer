// Manual hardware gate: run through GPU queue with VERIFY_URL and --out DIR.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {chromium} from 'playwright-core';
import {launch,BASE} from './chrome.mjs';
const argv=process.argv.slice(2),out=argv.includes('--out')?argv[argv.indexOf('--out')+1]:null;
if(!out)throw Error('Supply --out DIR for screenshots and checks');
const src=new URL('../../js/',import.meta.url).pathname;fs.mkdirSync(out,{recursive:true});
const checks=[],errors=[];const check=(name,pass,detail)=>{checks.push({name,pass,detail});console.log(pass?'PASS':'FAIL',name,JSON.stringify(detail));fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify({checks,errors},null,2));};
const browser=await launch(chromium,{gl:'hardware',maxMs:900000});
try{
 const page=await browser.newPage({viewport:{width:960,height:600},deviceScaleFactor:1});
 page.on('pageerror',e=>errors.push(e.message));
 for(const f of ['graphics.js','frame-filter.js'])await page.route('**/js/'+f,route=>route.fulfill({path:path.resolve(src,f),contentType:'application/javascript'}));
 await page.addInitScript(()=>{const t=setInterval(()=>{if(window.cancelGraphicsAutoDetect){window.cancelGraphicsAutoDetect();clearInterval(t);}},20);localStorage.setItem('austin3d.gfx.v1',JSON.stringify({msaa:false,autoExposure:false,bloom:0,custom:true,autoDetected:true}));});
 await page.goto(BASE+'/_harness.html?intro=0&drift=0&facadepace=0&timeofdaypace=0&framefilter=1&glstatecheck=1&namelabels=1',{waitUntil:'domcontentloaded',timeout:180000});
 await page.waitForFunction(()=>!document.getElementById('veil')&&window.FrameFilter?.proof().attached&&window.slopesApartments?.readyToReveal(),null,{timeout:420000});
 await page.evaluate(()=>{window.cancelGraphicsAutoDetect();window.GFX.autoExposure=false;window.GFX.bloom=0;window.applyGraphics();window.applyTimeOfDay(window.__map,.2,true);window.__map.jumpTo({center:[-97.7445,30.288],zoom:16.6,pitch:72,bearing:300});});
 await page.waitForTimeout(1800);
 const ready=async()=>{await page.waitForFunction(()=>window.FrameFilter.proof().attached&&window.slopesApartments.readyToReveal()&&!window.slopes?.pending&&!window.CityLighting?.stats?.shadowProxyBuilding,null,{timeout:240000});await page.waitForTimeout(1200);};
 await ready();
 const proof=async()=>page.evaluate(()=>{const m=window.__map,g=m.painter.context.gl;return{filter:window.FrameFilter.proof(),error:g.getError(),state:window.__glStateCheck,defaultRead:g.getParameter(g.READ_FRAMEBUFFER_BINDING)===null,defaultDraw:g.getParameter(g.DRAW_FRAMEBUFFER_BINDING)===null,tracker:!g.__aeState||(g.__aeState.read===null&&g.__aeState.draw===null),attrs:g.getContextAttributes(),ae:window.GFX.autoExposure,bloom:window.GFX.bloom};});
 const draw=async(n=3)=>page.evaluate(n=>{for(let i=0;i<n;i++)window.__map.redraw();},n);
 const shot=async(name)=>{await draw();await page.screenshot({path:path.join(out,name+'-first.png')});await page.screenshot({path:path.join(out,name+'-second.png')});};
 const clean=p=>p.filter.attached&&!p.filter.blocked&&!p.filter.lastError&&!p.error&&!p.state?.mismatches&&p.defaultRead&&p.defaultDraw&&p.tracker&&p.filter.engine.textureFramebuffersComplete;
 await draw(18);await shot('day');let p=await proof();check('URL loader and active GPU filter',clean(p)&&p.filter.engine.sceneFrames===p.filter.engine.resolves,p);

 const probeLabels=names=>page.evaluate(async names=>{const api=window.nameLabels,rows=api.visibility(),stats=api.stats();const targets=names?names.map(name=>rows.find(r=>r.name===name)).filter(Boolean):[rows.find(r=>r.alpha>.95&&r.raw),rows.find(r=>r.layoutAlpha>.9&&r.alpha<.001&&!r.raw)].filter(Boolean);const cases=[];for(const row of targets){const result=await api.hitTest((row.box[0]+row.box[2])/2,(row.box[1]+row.box[3])/2);cases.push({name:row.name,alpha:row.alpha,raw:row.raw,hit:result?.properties?.name||null});}return{failed:stats.failed,submitted:stats.submitted,cases};},names);
 const labels=await probeLabels(null);
 await page.evaluate(()=>window.FrameFilter.setEnabled(false));await page.waitForTimeout(2200);await draw(18);
 const nativeLabels=await probeLabels(labels.cases.map(c=>c.name));
 // Native Intel rendering can return an occluded name from its hit query.
 // Preserve actual baseline behavior; do not silently claim that existing bug is fixed.
 check('label hit behavior matches native control',!labels.failed&&!nativeLabels.failed&&labels.cases.some(c=>c.alpha>.95&&c.hit===c.name)&&labels.cases.length===nativeLabels.cases.length&&labels.cases.every(c=>nativeLabels.cases.some(n=>n.name===c.name&&n.hit===c.hit)),{filtered:labels,native:nativeLabels});
 await page.evaluate(()=>window.FrameFilter.setEnabled(true));await ready();
 await page.evaluate(()=>window.FrameFilter.setEnabled(false));await page.waitForTimeout(2200);await draw(18);const read=()=>page.evaluate(()=>{window.__map.redraw();const g=window.__map.painter.context.gl,d=new Uint8Array(g.drawingBufferWidth*g.drawingBufferHeight*4);g.readPixels(0,0,g.drawingBufferWidth,g.drawingBufferHeight,g.RGBA,g.UNSIGNED_BYTE,d);return Array.from(d);});const off1=await read();await draw(2);const offControl=await read();
 check('off frees filter',!(await proof()).filter.attached,(await proof()).filter);
 await page.evaluate(()=>window.FrameFilter.setEnabled(true));await draw(18);await page.evaluate(()=>window.FrameFilter.setEnabled(false));await page.waitForTimeout(2200);await draw(18);const off2=await read();
 const diff=(a,b)=>{let sum=0,over=0;for(let i=0;i<a.length;i+=4){let high=0;for(let c=0;c<3;c++){const d=Math.abs(a[i+c]-b[i+c]);sum+=d;high=Math.max(high,d);}if(high>12)over++;}return{mean:sum/(a.length*.75),fraction:over/(a.length/4)};};const control=diff(off1,offControl),toggle=diff(off1,off2);check('off restores native pixels within repeated-control noise',toggle.mean<=control.mean+.05&&toggle.fraction<=control.fraction+.0005,{control,toggle});
 await page.evaluate(()=>window.FrameFilter.setEnabled(true));await draw(18);
 for(const time of [.2,1]){await page.evaluate(time=>{window.GFX.autoExposure=true;window.GFX.bloom=.4;window.applyGraphics();window.applyTimeOfDay(window.__map,time,true);},time);await ready();await page.waitForTimeout(1800);await shot('effects-'+time);p=await proof();check('exposure and bloom '+time,clean(p),p);}
 await page.setViewportSize({width:900,height:560});await ready();await page.waitForTimeout(1000);await draw(3);p=await proof();check('resize targets',clean(p)&&p.filter.engine.size.join('x')==='900x560',p);
 await page.evaluate(()=>{const gl=window.__map.painter.context.gl;window.__loss=gl.getExtension('WEBGL_lose_context');window.__loss.loseContext();});await page.waitForTimeout(150);check('actual context loss drops filter',!(await page.evaluate(()=>window.FrameFilter.proof())).attached,await page.evaluate(()=>window.FrameFilter.proof()));
 await page.evaluate(()=>window.__loss.restoreContext());await page.waitForFunction(()=>window.FrameFilter?.proof().attached&&window.FrameFilter.proof().recoveries>0&&window.slopesApartments?.readyToReveal(),null,{timeout:240000});await page.waitForTimeout(1800);await draw(18);await shot('recovered-night');p=await proof();check('actual context restoration',clean(p)&&p.filter.recoveries>0,p);
 await page.evaluate(()=>{window.FrameFilter.detach();window.FrameFilter.attach(window.__map).setEnabled(true);});await draw(18);p=await proof();check('detach and reattach',clean(p),p);
 check('no page errors',errors.length===0,errors);
 fs.writeFileSync(path.join(out,'sources.json'),JSON.stringify(Object.fromEntries(['graphics.js','frame-filter.js'].map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(src,f))).digest('hex')])),null,2));
 process.exitCode=checks.some(c=>!c.pass)?1:0;
}finally{await browser.__done();}
