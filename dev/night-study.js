// Named public routes, never a private photo's rooftop position.
(async()=>{
 const routes=await (await fetch('../scripts/verify/night-routes.json')).json();
 const select=document.getElementById('building');
 for(const route of routes.routes)for(const p of route.poses){
  if(!p.eye||!p.target)continue;
  const dx=(p.eye[0]-p.target[0])*111320*Math.cos(p.target[1]*Math.PI/180),dy=(p.eye[1]-p.target[1])*111320;
  const id=route.id+'/'+p.id,range=Math.hypot(dx,dy),az=Math.atan2(dx,dy)*180/Math.PI;
  poses[id]={lng:p.target[0],lat:p.target[1],z:p.target[2],eye:p.eye[2],range,az,other:{range,az}};
  const option=document.createElement('option');option.value=id;option.textContent=p.id;select.append(option);
 }
 const tools=document.createElement('div');tools.style='position:fixed;top:54px;left:12px;padding:6px;background:#101820df;border-radius:6px;display:flex;gap:6px;z-index:5';document.body.append(tools);
 const button=(text,fn)=>{const b=document.createElement('button');b.textContent=text;b.onclick=fn;tools.append(b);return b;};
 for(const [label,p] of [['Blue hour',.62],['Twilight',.69]])button(label,()=>{hour=p;apply();});
 button('Sources off',()=>{win().CityNight.tune.on=false;apply();});
 button('Sources on',()=>{win().CityNight.tune.on=true;apply();});
 button('Fixtures off',()=>{win().CityNight.tune.fixtureGain=0;apply();});
 button('Fixtures on',()=>{win().CityNight.tune.fixtureGain=1;apply();});
 button('Break emitters',()=>{win().CityNight.tune.emissionGain=0;apply();});
 button('Night benchmark',async()=>{
  if(!ready)return;
  const w=win(),old=w.CityNight.tune.on,oldHour=hour,rows=[];
  document.querySelectorAll('button,select,input').forEach(el=>el.disabled=true);
  try{hour=1;for(let i=0;i<4;i++){w.CityNight.tune.on=i%2===1;apply();await settle();const r=await measure();rows.push({...r,nightSources:w.CityNight.tune.on});}
   document.getElementById('inspection').textContent=JSON.stringify({viewport:[w.innerWidth,w.innerHeight],preset:w.GFX?.preset,rows},null,2);
  }finally{hour=oldHour;w.CityNight.tune.on=old;apply();document.querySelectorAll('button,select,input').forEach(el=>el.disabled=false);}
 });
 button('Night checks',async()=>{
  if(!ready)return;
  const w=win(),m=w.__map,oldHour=hour,oldOn=w.CityNight.tune.on,result={};
  const cap=()=>new Promise(resolve=>{m.once('render',()=>{const gl=w.slopes.renderer.getContext(),a=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,a);resolve(a);});m.triggerRepaint();});
  const loaded=async()=>{const end=performance.now()+60000;while(!m.areTilesLoaded()&&performance.now()<end)await new Promise(r=>setTimeout(r,250));if(!m.areTilesLoaded())throw Error('Tile load did not settle');};
  const diff=(a,b)=>{let n=0;for(let i=0;i<a.length;i+=4)if(Math.max(...[0,1,2].map(k=>Math.abs(a[i+k]-b[i+k])))>2)n++;return n;};
  document.querySelectorAll('button,select,input').forEach(el=>el.disabled=true);
  try{
   hour=.5;w.CityNight.tune.on=true;apply();await settle();await loaded();await settle();await cap();const day=await cap();
   result.dayControlChanged=diff(day,await cap());
   w.CityNight.tune.on=false;await cap();result.dayChanged=diff(day,await cap());
   hour=1;w.CityNight.tune.on=true;apply();await settle();await loaded();await settle();await cap();const night=await cap();
   const gain=w.CityNight.tune.emissionGain;
   w.CityNight.tune.emissionGain=0;await cap();result.nightChanged=diff(night,await cap());
   w.CityNight.tune.emissionGain=gain;
   result.glError=w.slopes.renderer.getContext().getError();result.failures=w.CityLighting.stats.failures;
   result.shaderFailures=w.slopes.renderer.info.programs.filter(p=>p.diagnostics?.runnable===false).length;
   result.triangles=w.slopesApartments.count.triangles;result.buildings=w.slopesApartments.count.buildings;
   result.streetlights=w.__nightLights?.count;result.activeFixtures=w.CityNight.nearest(w.slopes.uniforms().u_eye.value).length;result.profiles=w.CityNight.profiles.size;result.emissionGain=w.CityNight.tune.emissionGain;
   const tones=new Set();w.slopesApartments.group.traverse(o=>{const g=o.geometry;if(!g)return;const c=g.attributes.cNight,s=g.attributes.aSurface;if(!c||!s)return;for(let i=0;i<c.count&&tones.size<32;i++)if(s.getX(i)===4&&c.getX(i)+c.getY(i)+c.getZ(i)>1)tones.add([c.getX(i),c.getY(i),c.getZ(i)].join(','));});result.litTones=tones.size;
   result.pass=result.dayControlChanged===0&&result.dayChanged===0&&result.nightChanged>100&&result.litTones>10&&result.glError===0&&!result.failures.length&&!result.shaderFailures;
   document.getElementById('inspection').textContent=JSON.stringify(result,null,2);
  }finally{hour=oldHour;w.CityNight.tune.on=oldOn;apply();document.querySelectorAll('button,select,input').forEach(el=>el.disabled=false);}
 });
})();
