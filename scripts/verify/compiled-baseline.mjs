// Three cold legacy repetitions against frozen resource and generation gates.
// VERIFY_URL and external --out are required; --gates overrides the recorded gate file.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const args=process.argv.slice(2),arg=k=>args[args.indexOf(k)+1];
assert(args.includes('--out'),'--out DIRECTORY required');
const OUT=path.resolve(arg('--out'));
assert(OUT!==ROOT&&!OUT.startsWith(ROOT+path.sep),'Use external evidence');
fs.mkdirSync(OUT,{recursive:true});
const gatePath=args.includes('--gates')?path.resolve(arg('--gates')):path.join(ROOT,'scripts/verify/compiled-gates.json');
const {chromium}=await import(pathToFileURL(path.join(ROOT,'scripts/verify/node_modules/playwright-core/index.mjs')));
const {launch,HW_ARGS}=await import(pathToFileURL(path.join(ROOT,'scripts/verify/chrome.mjs')));
const VERIFY_URL=process.env.VERIFY_URL;
if(!VERIFY_URL)throw Error('VERIFY_URL required');
const report={revision:'9670a1e50a07ee2a8c210d4351b671627faa738b',started:new Date().toISOString(),gates:JSON.parse(fs.readFileSync(gatePath,'utf8')),cold:[],shots:[],motion:[],errors:[]};
const save=()=>fs.writeFileSync(path.join(OUT,'baseline.json'),JSON.stringify(report,null,2));
let source=fs.readFileSync(path.join(ROOT,'js/slopes-apartments.js'),'utf8').replace(/\r\n/g,'\n');
report.generatorSha256=createHash('sha256').update(source).digest('hex');
function patch(a,b){if(source.split(a).length!==2)throw Error('Instrumentation must match once: '+a);source=source.replace(a,b);}
patch('    for (const spec of _data.buildings) {\n      const pendingStart=',`    window.__assetBaseline={ranges:[],generationMs:0,finalizationMs:0};
    const timedNext=it=>{const t=performance.now();try{return it.next();}finally{window.__assetBaseline.generationMs+=performance.now()-t;}};
    for (const spec of _data.buildings) {
      const rangeStart=B.triangles*3;
      const pendingStart=`);
patch('        let r = it.next();','        let r = timedNext(it);');
patch('while (!r.done) { await pause(); r = it.next(); }','while (!r.done) { await pause(); r = timedNext(it); }');
patch('      await pause();\n    }\n    count.buildSlices','      window.__assetBaseline.ranges.push({id:spec.id,name:spec.name,start:rangeStart,end:B.triangles*3});\n      await pause();\n    }\n    count.buildSlices');
patch('        addFilteredFace(B,entry.face,entry.options);','        const rasterStart=performance.now(); addFilteredFace(B,entry.face,entry.options); window.__assetBaseline.finalizationMs+=performance.now()-rasterStart;');
patch('      B.filtered=batchFiltered(B.filtered);','      const assemblyStart=performance.now();\n      B.filtered=batchFiltered(B.filtered);');
patch('      count.triangles = B.triangles;','      window.__assetBaseline.finalizationMs+=performance.now()-assemblyStart;\n      count.triangles = B.triangles;');
const viewport={width:1280,height:720};
const welch={center:[-97.73785,30.2867],zoom:18.5,pitch:57,bearing:22};
const poses=[{name:'welch-day',...welch,p:.3},{name:'welch-night',...welch,p:.82},{name:'welch-grazing',center:welch.center,zoom:18.1,pitch:68,bearing:78,p:.3},{name:'west-campus-day',center:[-97.745,30.28745],zoom:16.8,pitch:64,bearing:-55,p:.3}];
const browser=await launch(chromium,{gl:'hardware',maxMs:660000,args:[...HW_ARGS,'--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling','--disable-features=CalculateNativeWinOcclusion']});
try{
 for(let rep=0;rep<3;rep++){
  const context=await browser.newContext({viewport,deviceScaleFactor:1});
  const page=await context.newPage();
  page.on('pageerror',e=>report.errors.push({rep,error:String(e)}));
  await page.route('**/js/slopes-apartments.js*',r=>r.fulfill({contentType:'application/javascript',body:source}));
  await page.addInitScript(()=>{const t=setInterval(()=>{if(window.cancelGraphicsAutoDetect){window.cancelGraphicsAutoDetect();clearInterval(t);}},10);});
  const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
  const t0=Date.now(); console.log('Cold baseline',rep);
  await page.goto(VERIFY_URL.replace(/\/$/,'')+'/index.html?intro=0&drift=0&preset=balanced&clip=1&buildings=legacy',{waitUntil:'domcontentloaded',timeout:120000});
  await page.waitForFunction(()=>window.__map&&window.slopesApartments?.group&&window.slopesApartments.readyToReveal()&&!document.getElementById('veil')&&!window.__fly?.eye().driving,null,{timeout:180000});
  await page.evaluate(p=>{window.cancelGraphicsAutoDetect();window.GFX.autoExposure=false;window.GFX.stars=0;window.GFX.grain=0;window.applyGraphics();if(window.WAYFIND)window.WAYFIND.on=false;window.applyTimeOfDay(window.__map,.3,true);window.__map.jumpTo(p);},welch);
  await page.waitForFunction(()=>window.__map.areTilesLoaded(),null,{timeout:60000});
  const data=await page.evaluate(()=>{
   const A=window.slopesApartments,S=window.slopes,T=window.THREE,g=A.group.children.find(x=>x.name==='apartments')?.geometry;
   if(!g||A.data.buildings.length!==196||A.count.buildings!==196||window.__assetBaseline.ranges.length!==196)throw Error('Incomplete full authored city');
   const gl=window.__map.getCanvas().getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info');
   const centre=S.toLocal(-97.73785,30.2867,0),index=g.index.array,pos=g.attributes.position.array;
   const vertexBytes=Object.values(g.attributes).reduce((n,a)=>n+a.array.byteLength/g.attributes.position.count,0);
   const rows=window.__assetBaseline.ranges.map(r=>{let lo=Infinity,hi=-1,min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(let i=r.start;i<r.end;i++){const v=index[i];lo=Math.min(lo,v);hi=Math.max(hi,v);for(let k=0;k<3;k++){min[k]=Math.min(min[k],pos[v*3+k]);max[k]=Math.max(max[k],pos[v*3+k]);}}const dx=Math.max(min[0]-centre.x,0,centre.x-max[0]),dy=Math.max(min[1]-centre.y,0,centre.y-max[1]);return {...r,vertices:hi>=lo?hi-lo+1:0,geometryBytes:(hi>=lo?hi-lo+1:0)*vertexBytes+(r.end-r.start)*4,bounds:{min,max},outsideActive:Math.hypot(dx,dy)>300};});
   const allGeometries=new Set(),allArrays=new Set();let actualGeometryBytes=0,textureBytes=0;
   A.group.traverse(o=>{if(o.geometry&&!allGeometries.has(o.geometry)){allGeometries.add(o.geometry);for(const a of [...Object.values(o.geometry.attributes),o.geometry.index].filter(Boolean))if(a.array&&!allArrays.has(a.array.buffer)){allArrays.add(a.array.buffer);actualGeometryBytes+=a.array.buffer.byteLength;}}for(const u of Object.values(o.material?.uniforms||{})){const t=u?.value;if(t?.isTexture&&t.image?.data&&!allArrays.has(t.image.data.buffer)){allArrays.add(t.image.data.buffer);textureBytes+=t.image.data.buffer.byteLength;}}});
   return {renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null,count:A.count,catalog:A.data.buildings.length,generationMs:window.__assetBaseline.generationMs,finalizationMs:window.__assetBaseline.finalizationMs,actualGeometryBytes,textureBaseBytes:textureBytes,outsideActiveGeometryBytes:rows.filter(x=>x.outsideActive).reduce((n,x)=>n+x.geometryBytes,0),perBuilding:rows,shadow:S.sunlightStats(),ready:A.readyToReveal()};
  });
  if(!data.renderer||/swiftshader|software/i.test(data.renderer))throw Error('Hardware required');
  report.cold.push({rep,firstUsefulViewMs:Date.now()-t0,...data});save();console.log('Ready',rep,data.count.triangles,data.generationMs.toFixed(0)+'ms generation',data.actualGeometryBytes+' resident bytes');
  if(rep===0&&!args.includes('--no-shots')){
   for(const pose of poses){await page.evaluate(p=>{window.__map.jumpTo(p);window.applyTimeOfDay(window.__map,p.p,true);window.slopesApartments.group.uuid=window.THREE.MathUtils.generateUUID();window.__map.triggerRepaint();},pose);await page.waitForFunction(()=>window.__map.areTilesLoaded()&&window.slopesApartments.readyToReveal(),null,{timeout:60000});await page.waitForTimeout(4000);await page.screenshot();await page.waitForTimeout(1000);const file='baseline-'+pose.name+'.png';await page.screenshot({path:path.join(OUT,file)});report.shots.push({file,pose,state:await page.evaluate(()=>({shadow:window.slopes.sunlightStats(),p:window.__todCurrentP,tiles:window.__map.areTilesLoaded(),contextLost:window.__map.getCanvas().getContext('webgl2').isContextLost()}))});save();}
  }
  await context.close();
 }
 report.finished=new Date().toISOString();save();console.log('Baseline frozen',report.cold.length,'cold reps');
}catch(e){report.fatal=String(e.stack||e);save();console.error(e);process.exitCode=1;}
finally{await browser.close();browser.__done?.();save();}
