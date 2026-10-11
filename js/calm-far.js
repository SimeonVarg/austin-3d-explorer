/** Generated far representations for the apartment cell tiler. No building list. */
(function () {
  'use strict';
  const on = new URLSearchParams(location.search).get('calm') === '1' && !window.LITE_PROFILE?.on;
  const tune = { enterPixels: 1.7, leavePixels: 2, minCells: 8 };
  const stats = { faces: 0, eligible: 0, farBuildings: 0, switches: 0 };
  const hex = v => '#' + v.map(x => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('');
  const rgb = h => [1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16));
  function rhythm(values, lo, hi) {
    const s = [...new Set([lo, ...values.filter(x => x > lo && x < hi), hi])].sort((a,b) => a-b);
    const gaps = s.slice(1).map((v,i) => v-s[i]).sort((a,b) => a-b);
    return s.length>2 ? gaps[Math.floor(gaps.length/2)] : null;
  }
  function windowRhythm(windows,axis) {
    const other=axis==='s'?'z':'s', groups=new Map();let period=0;
    for(const w of windows) {
      const key=((w[other+'0']+w[other+'1'])/2).toFixed(4);
      const centers=groups.get(key)||new Set();
      centers.add(+((w[axis+'0']+w[axis+'1'])/2).toFixed(4));groups.set(key,centers);
    }
    for(const centers of groups.values()) {
      if(centers.size<3)continue; // One pair does not establish a repetition.
      const sorted=[...centers].sort((a,b)=>a-b);
      for(let i=1;i<sorted.length;i++)period=Math.max(period,sorted[i]-sorted[i-1]);
    }
    return period||null;
  }
  function begin(face, skin) {
    const windows=skin.windows||[];
    // Bays often emit no skin column cuts: their window edges are cut later.
    // Repeated aligned window centres establish the actual bay/storey period.
    const row = Math.max(rhythm(skin.rows(face.z0, face.z1), face.z0, face.z1)||0,windowRhythm(windows,'z')||0) || face.z1-face.z0;
    const col = Math.max(rhythm(skin.cols((face.z0+face.z1)/2, face.len), 0, face.len)||0,windowRhythm(windows,'s')||0) || face.len;
    const windowSize=windows.reduce((n,w)=>Math.max(n,w.s1-w.s0,w.z1-w.z0),0);
    return { face, sum: Array.from({length:3},()=>[0,0,0]), area:0, glass:0, response:0, emission:0, cells:0,
      period: Math.max(row, col, windowSize), eligible: !face.cut && !skin.facets && !(skin.windows||[]).some(w=>w.arch||w.mullion) };
  }
  function cell(rec, sa, sb, za, zb, col) {
    const a = (sb-sa)*(zb-za); if (!(a>0)) return;
    rec.area+=a;rec.cells++;
    for(let t=0;t<3;t++){ const v=rgb(col[t]||col[0]);for(let k=0;k<3;k++)rec.sum[t][k]+=a*v[k]; }
    const s=col.surface||[0,0,0,0], g=s[0]===4||s[0]===6?1:0;
    rec.glass+=a*g;rec.response+=a*g*(s[0]===6?1:Math.max(0,Math.min(1,s[3])));
    rec.emission+=a*(g||s[0]===5?1:0);
  }
  function mean(rec) {
    const c=rec.sum.map(v=>hex(v.map(x=>x/rec.area)));
    // Kind 8: area shares, never an integer material ID averaged with another.
    c.surface=[8,rec.glass/rec.area,rec.response/rec.area,rec.emission/rec.area];
    return c;
  }
  function record(B, rec) {
    stats.faces++;
    rec.eligible &&= rec.cells>=tune.minCells && rec.period>0;
    if(rec.eligible)stats.eligible++;
    delete rec.face;delete rec.sum;
    B.calmFaces.push(rec);
  }
  /** Build two index streams from identical vertices. Untouched features are reused. */
  function indices(index, first, end, offset, faces) {
    const records=faces.filter(f=>f.start>=offset+first&&f.farEnd<=offset+end);
    if(!records.length)return null;
    const near=[], far=[];let cursor=first;
    for(const f of records) {
      const a=f.start-offset,b=f.end-offset,c=f.farStart-offset,d=f.farEnd-offset;
      for(let i=cursor;i<a;i++){near.push(index[i]);far.push(index[i]);}
      for(let i=a;i<c;i++)near.push(index[i]);
      if(f.eligible){for(let i=c;i<d;i++)far.push(index[i]);for(let i=b;i<c;i++)far.push(index[i]);}
      else for(let i=a;i<c;i++)far.push(index[i]);
      cursor=d;
    }
    for(let i=cursor;i<end;i++){near.push(index[i]);far.push(index[i]);}
    const eligible=records.filter(f=>f.eligible);
    return {near,far:eligible.length?far:null,period:Math.max(0,...eligible.map(f=>f.period))};
  }
  /** Upper bound on pixel displacement per local metre throughout a sphere.
   * MapLibre puts view AND projection in THREE.Camera.projectionMatrix. The
   * caller supplies P*V; compose with the mesh before differentiating x/w,y/w.
   * For A=clip-X row and W=clip-W row, J=(A*w-W*x)/w². Its numerator changes
   * by at most radius*|A cross W| over a sphere. No perspective-camera fields.
   */
  function projectedPeriod(S,j,period,p,e,width,height) {
    const ax=p[0]*e[0]+p[4]*e[1]+p[8]*e[2]+p[12]*e[3];
    const ay=p[0]*e[4]+p[4]*e[5]+p[8]*e[6]+p[12]*e[7];
    const az=p[0]*e[8]+p[4]*e[9]+p[8]*e[10]+p[12]*e[11];
    const at=p[0]*e[12]+p[4]*e[13]+p[8]*e[14]+p[12]*e[15];
    const bx=p[1]*e[0]+p[5]*e[1]+p[9]*e[2]+p[13]*e[3];
    const by=p[1]*e[4]+p[5]*e[5]+p[9]*e[6]+p[13]*e[7];
    const bz=p[1]*e[8]+p[5]*e[9]+p[9]*e[10]+p[13]*e[11];
    const bt=p[1]*e[12]+p[5]*e[13]+p[9]*e[14]+p[13]*e[15];
    const wx=p[3]*e[0]+p[7]*e[1]+p[11]*e[2]+p[15]*e[3];
    const wy=p[3]*e[4]+p[7]*e[5]+p[11]*e[6]+p[15]*e[7];
    const wz=p[3]*e[8]+p[7]*e[9]+p[11]*e[10]+p[15]*e[11];
    const wt=p[3]*e[12]+p[7]*e[13]+p[11]*e[14]+p[15]*e[15];
    const x=ax*S[j]+ay*S[j+1]+az*S[j+2]+at;
    const y=bx*S[j]+by*S[j+1]+bz*S[j+2]+bt;
    const w=wx*S[j]+wy*S[j+1]+wz*S[j+2]+wt, r=S[j+3];
    const nearest=w-r*Math.hypot(wx,wy,wz);
    if(!(nearest>0))return Infinity;
    const dx=(Math.hypot(ax*w-wx*x,ay*w-wy*x,az*w-wz*x)+r*Math.hypot(ay*wz-az*wy,az*wx-ax*wz,ax*wy-ay*wx))/(nearest*nearest);
    const dy=(Math.hypot(bx*w-wx*y,by*w-wy*y,bz*w-wz*y)+r*Math.hypot(by*wz-bz*wy,bz*wx-bx*wz,bx*wy-by*wx))/(nearest*nearest);
    return period*.5*Math.hypot(width*dx,height*dy);
  }
  function select(c,i,camera,mesh,width,height,projection) {
    const frame=window.FrameTarget, phase=frame?.state?.();
    // A converged still image uses precisely the original full-detail scene.
    if(frame?.shifted||phase==='cycle'||phase==='done')return false;
    if(!window.CalmFar.enabled||!c.farCount?.[i]||camera.isOrthographicCamera)return false;
    const px=projectedPeriod(c.sph,i*4,c.period[i],projection.elements,mesh.matrixWorld.elements,width,height);
    const old=!!c.isFar[i],next=px<(old?tune.leavePixels:tune.enterPixels);
    if(next!==old)stats.switches++;
    c.isFar[i]=next;return next;
  }
  window.CalmFar={enabled:on,tune,stats,begin,cell,mean,record,indices,projectedPeriod,select};
})();
