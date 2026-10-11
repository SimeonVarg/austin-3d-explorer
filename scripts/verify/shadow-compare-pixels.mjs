/** Compare the actual cold shadow programs, baseline/candidate/baseline.
 * Native app, frozen cameras/time, second captures. Any control noise is inconclusive.
 * --break removes sunlight shadows in the candidate and must fail.
 */
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright-core';
import {BASE,launch,HW_ARGS} from './chrome.mjs';
import {decodePNG} from './lib/png.mjs';
const args=process.argv.slice(2),opt=(k,d)=>args.includes(k)?args[args.indexOf(k)+1]:d;
const out=path.resolve(opt('--out',process.env.VERIFY_OUT||'/tmp/shadow-compare'));
const poses=[
 {name:'campus-far',p:.2,center:[-97.7393,30.2874],zoom:16.85,pitch:74,bearing:197.4},
 {name:'west-mid',p:.2,center:[-97.7445,30.288],zoom:16.6,pitch:72,bearing:300},
 {name:'campus-night',p:1,center:[-97.7393,30.2874],zoom:16.85,pitch:74,bearing:197.4}
];
const wanted=opt('--views','campus-far,west-mid').split(',');
if(wanted.some(n=>!poses.some(p=>p.name===n)))throw Error('Unknown view');
const views=poses.filter(p=>wanted.includes(p.name));fs.mkdirSync(out,{recursive:true});
const browser=await launch(chromium,{gl:'hardware',args:HW_ARGS,maxMs:1200000});
const result={settings:{width:960,height:600,dpr:1,secondCaptures:true,programs:'Unmodified production except explicit --break'},arms:[],comparisons:[]};
const save=()=>fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));
function difference(a,b){const A=decodePNG(a),B=decodePNG(b);let moved=0,max=0,sum=0,over1=0,over12=0;for(let i=0;i<A.width*A.height;i++){let d=0;for(let c=0;c<3;c++){const x=Math.abs(A.data[i*A.bpp+c]-B.data[i*B.bpp+c]);d=Math.max(d,x);sum+=x;}moved+=d>0;over1+=d>1;over12+=d>12;max=Math.max(max,d);}return {moved,over1,over12,max,mae:sum/(A.width*A.height*3)};}
try{
 for(const arm of ['original','candidate','again']){
  const query=arm==='candidate'?opt('--query-b','shadowcompare=1&smooth=0'):opt('--query-a','shadowcompare=0&smooth=0');
  const ctx=await browser.newContext({viewport:{width:960,height:600},deviceScaleFactor:1});
  const row={arm,query,errors:[],shots:{}};result.arms.push(row);save();
  try{
   const page=await ctx.newPage();page.on('pageerror',e=>row.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')row.errors.push(m.text().slice(0,200));});
   if(args.includes('--break')&&arm==='candidate')await page.route('**/js/city-lighting.js',r=>r.fulfill({contentType:'text/javascript',body:fs.readFileSync(new URL('../../js/city-lighting.js',import.meta.url),'utf8').replace('float visibility=facing>0.0?sunlightVisibility(pos,n):1.0;','float visibility=1.0;')}));
   await page.addInitScript(()=>{localStorage.setItem('austin3d.gfx.v1',JSON.stringify({autoDetected:true,autoExposure:false}));const t=setInterval(()=>{if(window.cancelGraphicsAutoDetect){window.cancelGraphicsAutoDetect();clearInterval(t);}},20);});
   await page.goto(BASE+'/index.html?intro=0&drift=0&namelabels=0&facadepace=0&timeofdaypace=0&skyfreeze=0&'+query,{waitUntil:'domcontentloaded',timeout:180000});
   await page.waitForFunction(()=>!document.getElementById('veil')&&window.slopesApartments?.count.done&&window.slopesApartments?.group,null,{timeout:300000});
   await page.evaluate(()=>{window.cancelGraphicsAutoDetect();window.GFX.autoExposure=false;window.applyGraphics();const m=window.__map;for(const l of m.getStyle().layers)if(l.type==='symbol')m.setLayoutProperty(l.id,'visibility','none');const jump=m.jumpTo,roll=m.setRoll;m.jumpTo=function(p,e){return e?.fly?this:jump.call(this,p,e);};if(roll)m.setRoll=function(v,e){return e?.fly?this:roll.call(this,v,e);};});
   row.hardware=await page.evaluate(()=>{const g=window.slopes.renderer.getContext(),e=g.getExtension('WEBGL_debug_renderer_info');return {renderer:e?g.getParameter(e.UNMASKED_RENDERER_WEBGL):g.getParameter(g.RENDERER),samples:g.getParameter(g.SAMPLES),comparison:window.CityLighting.shadowCompare,shaderFailures:window.CityLighting.stats.failures,antialias:g.getContextAttributes().antialias};});
   if(row.hardware.comparison!==(new URLSearchParams(query).get('shadowcompare')==='1'))throw Error('Requested shadow program did not activate');
   if(row.hardware.shaderFailures.length)throw Error('Shader compilation failures');
   console.log('[shadow-compare] loaded '+arm+' '+JSON.stringify(row.hardware));save();
   for(const view of views){
    await page.evaluate(v=>{window.__map.stop();window.__map.jumpTo(v);window.applyTimeOfDay(window.__map,v.p,true);},view);
    console.log('[shadow-compare] pose '+arm+' '+view.name);
    await page.waitForTimeout(4000);
    await page.evaluate(()=>new Promise(r=>{const m=window.__map;m.once('idle',r);m.triggerRepaint();setTimeout(r,15000);}));
    await page.waitForFunction(()=>!window.__facadePace?.busy&&!window.CityLighting?.stats.shadowProxyBuilding,null,{timeout:90000});
    const file=path.join(out,arm+'.'+view.name+'.png');await page.screenshot({path:file});await page.waitForTimeout(600);await page.screenshot({path:file});row.shots[view.name]=file;save();
   }
  }finally{await ctx.close();}
 }
 for(const view of views){const [a,b,c]=result.arms;const change=difference(a.shots[view.name],b.shots[view.name]),control=difference(a.shots[view.name],c.shots[view.name]);const row={view:view.name,change,control,exact:change.moved===0&&control.moved===0};result.comparisons.push(row);console.log(JSON.stringify(row));}
 result.pass=result.comparisons.every(r=>r.exact)&&result.arms.every(r=>!r.errors.length);save();process.exitCode=result.pass?0:1;
}finally{save();await browser.__done();}
