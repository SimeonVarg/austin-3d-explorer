// Manual, watchable A/B of the real app. No substitute scene or mock geometry.
'use strict';
const frame=document.getElementById('city'),status=document.getElementById('status');
let ready=false,angle=0,hour=.5,enabled=false;
const poses={waterloo:{lng:-97.744121,lat:30.288244,z:53,range:125,az:150,other:{range:110,az:135}},callaway:{lng:-97.74352,lat:30.28478,z:30,range:120,az:300,other:{range:100,az:295}}};
function win(){return frame.contentWindow;}
function pose(){
  if(!ready)return;
  const w=win(),m=w.__map,p=poses[document.getElementById('building').value];
  const rad=Math.PI/180,az=Number(document.getElementById('azimuth').value)*rad,range=Number(document.getElementById('distance').value),eyeAlt=p.z+range*.14;
  const ex=p.lng+Math.sin(az)*range/(111320*Math.cos(p.lat*rad)),ey=p.lat+Math.cos(az)*range/111320;
  const pitch=Math.atan2(range,eyeAlt-p.z),bearing=(az/rad+180)%360,lead=eyeAlt*Math.tan(pitch);
  const lat=ey+lead*Math.cos(bearing*rad)/111320,lng=ex+lead*Math.sin(bearing*rad)/(111320*Math.cos(ey*rad));
  const camPx=m.getCanvas().clientHeight/(2*Math.tan(m.getVerticalFieldOfView()*rad/2));
  const zoom=Math.log2(40075016.686*Math.cos(lat*rad)*camPx/(512*(eyeAlt/Math.cos(pitch))));
  m.stop();m.jumpTo({center:[lng,lat],zoom,pitch:pitch/rad,bearing,roll:0});
  apply();
}
function apply(){
  if(!ready)return;
  const w=win();if(w.SLOPES.sunlight)w.SLOPES.sunlight.on=enabled;
  w.applyTimeOfDay(w.__map,hour,true);
  w.__map.triggerRepaint();
  document.getElementById('before').setAttribute('aria-pressed',String(!enabled));
  document.getElementById('after').setAttribute('aria-pressed',String(enabled));
  status.textContent=(enabled?'After':'Before')+' · '+(hour===0?'day':hour===1?'night':'sunset');
}
document.getElementById('building').onchange=()=>{angle=0;const p=poses[document.getElementById('building').value];document.getElementById('distance').value=p.range;document.getElementById('azimuth').value=p.az;pose();};
document.getElementById('position').onclick=pose;
document.getElementById('shadow').onclick=()=>{const w=win();w.SLOPES.sunlight.shadows=!w.SLOPES.sunlight.shadows;w.__map.triggerRepaint();status.textContent='Shadows '+(w.SLOPES.sunlight.shadows?'on':'off');};
document.getElementById('debug').onclick=()=>{
 if(document.getElementById('inspection').textContent){document.getElementById('inspection').textContent='';return;}
 const w=win(),u=w.slopes.uniforms(),kinds={};
 w.slopesApartments.group.traverse(o=>{const a=o.geometry?.attributes.aSurface;if(a)for(let i=0;i<a.count;i++){const k=a.getX(i);kinds[k]=(kinds[k]||0)+1;}});
 const gl=w.slopes.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');
 document.getElementById('inspection').textContent=JSON.stringify({eye:w.__fly.eye(),sun:w.skyBodies(w.__todCurrentP).sun,u:u.u_sunlight?.value.toArray(),presence:u.u_sunPresence?.value.toArray(),shadow:u.u_shadowSettings?.value.toArray(),kinds,triangles:w.slopesApartments.count.triangles,renderer:gl.getParameter(ext?ext.UNMASKED_RENDERER_WEBGL:gl.RENDERER),measurements:window.frameMeasurements},null,2);
};
document.getElementById('before').onclick=()=>{enabled=false;apply();};
document.getElementById('after').onclick=()=>{enabled=true;apply();};
// Measured clear camera locations: a generic orbit enters neighbouring towers.
document.getElementById('orbit').onclick=()=>{angle=1-angle;const p=poses[document.getElementById('building').value],v=angle?p.other:p;document.getElementById('distance').value=v.range;document.getElementById('azimuth').value=v.az;pose();};
for(const [id,p] of [['day',0],['gold',.5],['night',1]])document.getElementById(id).onclick=()=>{hour=p;pose();};
async function measure(){
  const w=win(),m=w.__map,samples=[],n=90,startFrames=w.slopes.frames;let prev;
  status.textContent='Measuring…';
  // A parked map does not draw on every animation frame. Measure actual map
  // renders and request the next one, or this only measures the display clock.
  await new Promise(resolve=>{function tick(){const t=performance.now();if(prev!=null)samples.push(t-prev);prev=t;if(samples.length<n)m.triggerRepaint();else{m.off('render',tick);resolve();}}m.on('render',tick);m.triggerRepaint();});
  const sorted=[...samples].sort((a,b)=>a-b);
  const result={enabled,building:document.getElementById('building').value,renderedFrames:w.slopes.frames-startFrames,median:sorted[Math.floor(n/2)],p95:sorted[Math.floor(n*.95)],mean:samples.reduce((a,b)=>a+b,0)/n};
  (window.frameMeasurements??=[]).push(result);status.textContent=`${enabled?'After':'Before'}: ${result.mean.toFixed(1)} ms/frame`;
  return result;
}
const settle=()=>new Promise(resolve=>setTimeout(resolve,4200));
document.getElementById('measure').onclick=async()=>{
  if(!ready)return;
  const original=enabled;
  document.querySelectorAll('button,select,input').forEach(el=>el.disabled=true);
  try{
    window.frameMeasurements=[];
    for(let i=0;i<6;i++){enabled=i%2===1;apply();await settle();await measure();}
    document.getElementById('inspection').textContent=JSON.stringify(window.frameMeasurements,null,2);
  }finally{enabled=original;apply();document.querySelectorAll('button,select,input').forEach(el=>el.disabled=false);}
};
document.getElementById('check').onclick=async()=>{
 if(!ready)return;
 const w=win(),m=w.__map,oldHour=hour,oldEnabled=enabled,geometry=w.slopesApartments.group;
 document.querySelectorAll('button,select,input').forEach(el=>el.disabled=true);
 const capture=()=>new Promise(resolve=>{
   m.once('render',()=>{const gl=w.slopes.renderer.getContext(),bytes=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,bytes);resolve(bytes);});m.triggerRepaint();
 });
 try{
   hour=1;enabled=false;pose();await settle();await settle();await capture();
   const control=await capture(),a=await capture();
   // Isolate the shader toggle from time-of-day retile/atlas work. At night
   // the atmosphere blend is zero too; inspect the full UI separately.
   enabled=true;w.SLOPES.sunlight.on=true;await capture();const b=await capture();
   let controlChanged=0;for(let i=0;i<a.length;i+=4)if(Math.max(Math.abs(a[i]-control[i]),Math.abs(a[i+1]-control[i+1]),Math.abs(a[i+2]-control[i+2]))>2)controlChanged++;
   let changed=0,signal=0;for(let i=0;i<a.length;i+=4){if(a[i]||a[i+1]||a[i+2])signal++;if(Math.max(Math.abs(a[i]-b[i]),Math.abs(a[i+1]-b[i+1]),Math.abs(a[i+2]-b[i+2]))>2)changed++;}
   const result={nightControlChangedPixels:controlChanged,nightChangedPixels:changed,nightPixels:a.length/4,nightChangedFraction:changed/(a.length/4),nonblack:signal,geometryUnchanged:geometry===w.slopesApartments.group,nightSun:w.slopes.uniforms().u_sunPresence.value.x,nightShadow:w.slopes.uniforms().u_shadowSettings.value.x};
   hour=.5;enabled=true;pose();await settle();
   const u=w.slopes.uniforms(),body=w.skyBodies(w.__todCurrentP).sun,rad=Math.PI/180;
   const expected=[Math.sin(body.az*rad)*Math.cos(body.elev*rad),Math.cos(body.az*rad)*Math.cos(body.elev*rad),Math.sin(body.elev*rad)];
   result.sunDirectionError=Math.max(...u.u_sunDirection.value.toArray().map((v,i)=>Math.abs(v-expected[i])));
   const initial=w.slopes.sunlightStats();await settle();const later=w.slopes.sunlightStats();
   result.shadowCached=initial.shadowUpdates===later.shadowUpdates;result.shadowMaps=later.shadowMaps;
   result.shadowActive=u.u_shadowSettings.value.x===1;
   result.glError=w.slopes.renderer.getContext().getError();
   result.shaderFailures=w.slopes.renderer.info.programs.filter(p=>p.diagnostics?.runnable===false).length;
   result.pass=result.geometryUnchanged&&result.nonblack>1000&&result.nightChangedFraction<.001&&result.nightSun===0&&result.nightShadow===0&&result.sunDirectionError<1e-6&&result.shadowCached&&result.shadowActive&&result.shadowMaps===2&&result.glError===0&&result.shaderFailures===0;
   window.studyChecks=result;document.getElementById('inspection').textContent=JSON.stringify(result,null,2);
 }finally{hour=oldHour;enabled=oldEnabled;pose();document.querySelectorAll('button,select,input').forEach(el=>el.disabled=false);}
};
const timer=setInterval(()=>{
  const w=win();w.cancelGraphicsAutoDetect?.();
  if(!w.slopesApartments?.count.done||!w.__map||w.__fly?.eye().driving)return;
  ready=true;clearInterval(timer);pose();
},250);
