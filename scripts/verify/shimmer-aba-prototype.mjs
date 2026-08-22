// Same A-B-A discriminator as scripts/verify/zfight.mjs, but stepping BEARING
// and POSITION — the axes the flight actually moves on. A depth tie's winner is
// decided by view angle, so a zoom-only step can miss it entirely.
const PW='file:///C:/Users/simip/Projects/austin-3d-explorer/scripts/verify/node_modules/playwright-core/index.mjs';
const {chromium}=await import(PW); const fs=await import('node:fs');
const exe='C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE=process.env.BASE||'http://127.0.0.1:8099';
const SHOTS=[
 {name:'A-near', center:[-97.7393,30.2874],zoom:16.85,pitch:74,bearing:197.4},
 {name:'B-park', center:[-97.7395,30.2872],zoom:16.6, pitch:72,bearing:186},
];
const DB=0.25, DLAT=-0.00012;          // per step: 0.25 deg of yaw + ~13 m of travel
const b=await chromium.launch({headless:true,executablePath:exe,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox']});
const p=await (await b.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1})).newPage();
await p.goto(BASE+'/_harness.html?intro=0&drift=0',{waitUntil:'networkidle',timeout:120000});
await p.waitForFunction(()=>window.__map&&window.__map.isStyleLoaded(),null,{timeout:120000});
await p.waitForTimeout(9000);
await p.evaluate(()=>window.cancelGraphicsAutoDetect&&window.cancelGraphicsAutoDetect());
await p.evaluate(v=>{window.__PRESET=v;},process.env.PRESET||'cinematic');
await p.evaluate(()=>{window.__f=[];window.__grab=i=>{const gl=window.__map.getCanvas();
  if(!window.__cv){window.__cv=document.createElement('canvas');window.__cv.width=gl.width;window.__cv.height=gl.height;
    window.__cx=window.__cv.getContext('2d',{willReadFrequently:true});}
  window.__cx.drawImage(gl,0,0);window.__f[i]=window.__cx.getImageData(0,0,window.__cv.width,window.__cv.height).data;};});
console.log('--- preset='+(process.env.PRESET||'cinematic'));
for(const s of SHOTS){
  for(let k=0;k<3;k++){
    await p.evaluate(({s,k,DB,DLAT,RS})=>{const m=window.__map;
      const PR=window.__PRESET;
      if(PR&&window.GFX_PRESETS&&window.GFX_PRESETS[PR]&&window.GFX.__p!==PR){
        Object.assign(window.GFX,window.GFX_PRESETS[PR]);window.GFX.__p=PR;window.applyGraphics&&window.applyGraphics();}
      m.jumpTo({center:[s.center[0],s.center[1]+k*DLAT],zoom:s.zoom,pitch:s.pitch,bearing:s.bearing+k*DB});
      window.applyTimeOfDay(m,0.5,true);},{s,k,DB,DLAT,RS:+(process.env.RS||0)});
    await p.waitForTimeout(k===0?4500:2000);
    await p.evaluate(()=>new Promise(r=>{const m=window.__map;if(m.loaded())return r();m.once('idle',r);setTimeout(r,12000);}));
    await p.evaluate(()=>window.__map.triggerRepaint());
    await p.waitForTimeout(700);
    await p.evaluate(i=>window.__grab(i),k);
  }
  const r=await p.evaluate(()=>{const [a,bb,c]=window.__f,W=window.__cv.width,H=window.__cv.height;
    const flag=new Uint8Array(W*H);let n=0,moved=0;
    const lum=(z,i)=>(z[i]*299+z[i+1]*587+z[i+2]*114)/1000;
    for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){const pp=y*W+x,i=pp*4;
      const ac=Math.abs(a[i]-c[i])+Math.abs(a[i+1]-c[i+1])+Math.abs(a[i+2]-c[i+2]);
      const ab=Math.abs(a[i]-bb[i])+Math.abs(a[i+1]-bb[i+1])+Math.abs(a[i+2]-bb[i+2]);
      if(ab>=18)moved++;
      if(ac>10)continue; if(ab<18)continue;
      const l0=lum(a,i);let flat=true;
      for(let dy=-1;dy<=1&&flat;dy++)for(let dx=-1;dx<=1;dx++){if(Math.abs(lum(a,((y+dy)*W+(x+dx))*4)-l0)>6){flat=false;break;}}
      if(!flat)continue; flag[pp]=1;n++;}
    // cluster
    const seen=new Uint8Array(W*H);let best=0,box=null;
    for(let i=0;i<W*H;i++){if(!flag[i]||seen[i])continue;
      const st=[i];seen[i]=1;let cnt=0,x0=1e9,y0=1e9,x1=-1,y1=-1;
      while(st.length){const q=st.pop();cnt++;const qx=q%W,qy=(q/W)|0;
        if(qx<x0)x0=qx;if(qy<y0)y0=qy;if(qx>x1)x1=qx;if(qy>y1)y1=qy;
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const nx=qx+dx,ny=qy+dy;
          if(nx<0||ny<0||nx>=W||ny>=H)continue;const nq=ny*W+nx;
          if(flag[nq]&&!seen[nq]){seen[nq]=1;st.push(nq);}}}
      if(cnt>best){best=cnt;box=[x0,y0,x1-x0,y1-y0];}}
    const cv=document.createElement('canvas');cv.width=W;cv.height=H;
    const cx=cv.getContext('2d');const img=cx.createImageData(W,H);
    for(let i=0;i<W*H;i++){const j=i*4;
      if(flag[i]){img.data[j]=255;img.data[j+1]=0;img.data[j+2]=255;img.data[j+3]=255;}
      else{img.data[j]=a[j]*0.5|0;img.data[j+1]=a[j+1]*0.5|0;img.data[j+2]=a[j+2]*0.5|0;img.data[j+3]=255;}}
    cx.putImageData(img,0,0);
    return{moved:+(100*moved/(W*H)).toFixed(2),flick:+(100*n/(W*H)).toFixed(3),best,box,png:cv.toDataURL('image/png')};});
  fs.writeFileSync('C:/Users/simip/AppData/Local/Temp/claude/C--Users-simip-Projects-austin-3d-explorer/f1fdeeb4-0ee7-4425-add0-dd602bc41391/scratchpad/tb/flick-'+s.name+'.png',Buffer.from(r.png.split(',')[1],'base64'));
  console.log(`${s.name.padEnd(9)} ${String(r.moved).padStart(6)}%  ${String(r.flick).padStart(7)}%   ${String(r.best).padStart(8)}   ${r.box?r.box.join(','):'-'}`);
}
await b.close();
