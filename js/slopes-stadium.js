/* DKR: section-based meshes, using the city's shared depth, sun and haze.
 * data/stadium.mesh.json is written only by bake_stadium_mesh.py.
 * ?stadiumMesh=0 restores the legacy stadium, as does the global slopes switch.
 */
(function () {
  'use strict';
  const TUNE = window.STADIUM_MESH = {
    on: new URLSearchParams(location.search).get('stadiumMesh') !== '0',
    url: 'data/stadium.mesh.json',
    flat: false,                 // untextured massing review
    portalRow: 22, portalRows: 6,
    chairbackRows: 18,
    arcSegments: 5, facadeFloor: 4.6, facadeGlassShare: 0.70,
    facadePierWidth: 1.15, facadePierDepth: 0.7, facadeBand: 0.55,
    supportPitch: 13, supportWidth: 0.65,
    towerSegments: 32, rampTurns: 3, rampSegments: 96,
    boardSegments: 24, boardBorder: 0.65,
    trussBase: 58.4, trussTop: 66, trussX: -117.5,
    surfaceOffset: 0.035, farStripeEvery: 3,
    fieldHeight: 0.25, fieldLineWidth: 0.105,
    collisionCell: 5, collisionMargin: 0.15,
    nightStart: 0.58, nightFull: 0.92, lowerSpill: 0.92, upperSpill: 0.62,
  };
  let data, map, group, origin, east, north, lastNear, lastRail;
  let filtered = false, timer, booting = false;
  const saved = new Map();
  const collision = new Map();
  const count = {done:false, sections:0, rows:0, portals:0, triangles:0, warnings:[]};
  const LEGACY = ['stadium-wall','stadium-wall-roof','stadium-seating','stadium-detail','stadium-field'];
  const VOLUMES = ['buildings-3d','buildings-roof','parts-3d','parts-roof','campus-storeys',
    'roofscape-deck','roofscape-major','roofscape-minor','roofs-pitched'];
  const up = [0,0,1], lerp = (a,b,t)=>a+(b-a)*t;
  const mix = (a,b,t)=>a.map((v,i)=>lerp(v,b[i],t));
  function ll(x,y) {
    const mx=111320*Math.cos(data.origin[1]*Math.PI/180);
    return [data.origin[0]+(x*data.east[0]+y*data.north[0])/mx,
      data.origin[1]+(x*data.east[1]+y*data.north[1])/111320];
  }
  function uv(lng,lat) {
    const x=(lng-data.origin[0])*111320*Math.cos(data.origin[1]*Math.PI/180), y=(lat-data.origin[1])*111320;
    return [x*data.east[0]+y*data.east[1],x*data.north[0]+y*data.north[1]];
  }
  const point = p=>[origin.x+east[0]*p[0]+north[0]*p[1],origin.y+east[1]*p[0]+north[1]*p[1],p[2]];
  const colour = key=>TUNE.flat ? data.palette.concrete : (data.palette[key] || data.palette.concrete);
  function collisionTri(a,b,c) {
    const den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);
    if(Math.abs(den)<0.01)return;
    const cell=TUNE.collisionCell;
    const tri={a,b,c,den};
    const minX=Math.floor(Math.min(a[0],b[0],c[0])/cell),maxX=Math.floor(Math.max(a[0],b[0],c[0])/cell);
    const minY=Math.floor(Math.min(a[1],b[1],c[1])/cell),maxY=Math.floor(Math.max(a[1],b[1],c[1])/cell);
    for(let x=minX;x<=maxX;x++)for(let y=minY;y<=maxY;y++){
      const key=x+','+y;if(!collision.has(key))collision.set(key,[]);collision.get(key).push(tri);
    }
  }
  function quad(B,a,b,c,d,key,want,solid=false) {
    B.quad(point(a),point(b),point(c),point(d),colour(key),want &&
      [want[0]*east[0]+want[1]*north[0],want[0]*east[1]+want[1]*north[1],want[2]]);
    if(solid){collisionTri(a,b,c);collisionTri(a,c,d);}
  }
  function slab(B,poly,z0,z1,key='concrete',side=key) {
    const top=poly.map(p=>[p[0],p[1],z1]);
    B.polygon(top.map(point),colour(key),up,'xy');
    // Collision triangulation must respect concave plans (Longhorn terrace).
    const T=window.THREE, shape=poly.map(p=>new T.Vector2(...p));
    for(const [i,j,k] of T.ShapeUtils.triangulateShape(shape,[]))collisionTri(top[i],top[j],top[k]);
    for(let i=0;i<poly.length;i++){
      const a=poly[i],b=poly[(i+1)%poly.length];
      quad(B,[...a,z0],[...b,z0],[...b,z1],[...a,z1],side);
    }
    B.polygon(poly.map(p=>point([...p,z0])),colour(side),[0,0,-1],'xy');
  }
  function box(B,x,y,w,d,z0,z1,key='concrete') {
    slab(B,[[x-w/2,y-d/2],[x+w/2,y-d/2],[x+w/2,y+d/2],[x-w/2,y+d/2]],z0,z1,key);
  }
  function beam(B,a,b,w,key='steel') {
    const dx=b[0]-a[0],dy=b[1]-a[1],dz=b[2]-a[2],len=Math.hypot(dx,dy,dz);
    if(len<0.001)return;
    const n=Math.hypot(dx,dy)>0.01?[-dy/Math.hypot(dx,dy)*w/2,dx/Math.hypot(dx,dy)*w/2,0]:[w/2,0,0];
    const v=[(dy*n[2]-dz*n[1])/len,(dz*n[0]-dx*n[2])/len,(dx*n[1]-dy*n[0])/len];
    const corners=p=>[[1,1],[-1,1],[-1,-1],[1,-1]].map(([s,t])=>p.map((q,i)=>q+s*n[i]+t*v[i]));
    const aa=corners(a),bb=corners(b);
    for(let i=0;i<4;i++){const j=(i+1)%4;quad(B,aa[i],aa[j],bb[j],bb[i],key);}
  }
  function sectionPoint(s,t,u,z) {
    if(s.arc){const a=(lerp(s.arc.a0,s.arc.a1,u))*Math.PI/180,r=lerp(s.arc.r0,s.arc.r1,t);
      return [s.arc.centre[0]+r*Math.cos(a),s.arc.centre[1]+r*Math.sin(a),z];}
    const p=mix(mix(s.inner[0],s.inner[1],u),mix(s.outer[0],s.outer[1],u),t);return [...p,z];
  }
  function emitSection(s,B,R,F,rails) {
    const d=data.details, steps=s.arc?TUNE.arcSegments:1;
    const z=t=>s.base+s.rise*t;
    // The underside is a thin inclined slab, never an extrusion to ground.
    for(let k=0;k<steps;k++){
      const u=k/steps,v=(k+1)/steps;
      const slices=s.rows>30?[[0,TUNE.portalRow/s.rows],[TUNE.portalRow/s.rows,(TUNE.portalRow+TUNE.portalRows)/s.rows],[(TUNE.portalRow+TUNE.portalRows)/s.rows,1]]:[[0,1]];
      for(let j=0;j<slices.length;j++){
        const [a,b]=slices[j],ranges=j===1&&s.rows>30?[[u,Math.min(v,0.36)],[Math.max(u,0.64),v]]:[[u,v]];
        for(const [lo,hi] of ranges)if(hi>lo)quad(B,sectionPoint(s,a,lo,z(a)-d.slabThickness),sectionPoint(s,b,lo,z(b)-d.slabThickness),
          sectionPoint(s,b,hi,z(b)-d.slabThickness),sectionPoint(s,a,hi,z(a)-d.slabThickness),'riser',[0,0,-1]);
      }
      quad(F,sectionPoint(s,0,u,z(0)),sectionPoint(s,0,v,z(0)),sectionPoint(s,1,v,z(1)),sectionPoint(s,1,u,z(1)),s.tier==='south-chairback'?'orangeSeat':'bench',up);
      if(s.orange){const t=Math.min(1,TUNE.chairbackRows/s.rows);quad(F,sectionPoint(s,0,u,z(0)+0.04),sectionPoint(s,0,v,z(0)+0.04),sectionPoint(s,t,v,z(t)+0.04),sectionPoint(s,t,u,z(t)+0.04),'orangeSeat',up);}
    }
    for(const u of [0,1])quad(B,sectionPoint(s,0,u,z(0)-d.slabThickness),sectionPoint(s,1,u,z(1)-d.slabThickness),
      sectionPoint(s,1,u,z(1)),sectionPoint(s,0,u,z(0)),'concrete');
    const width=Math.hypot(...sectionPoint(s,0.6,1,0).slice(0,2).map((v,i)=>v-sectionPoint(s,0.6,0,0)[i]));
    const aisle=Math.min(0.20,d.aisleWidth/Math.max(3,width)/2);
    for(let row=0;row<s.rows;row++){
      const a=row/s.rows,b=(row+1)/s.rows,za=z(a),zb=z(b);
      const portal=s.rows>30 && row>=TUNE.portalRow && row<TUNE.portalRow+TUNE.portalRows;
      const seatTone=s.orange&&row<TUNE.chairbackRows?'orangeSeat':'bench';
      for(let k=0;k<steps;k++){
        const u=k/steps,v=(k+1)/steps;
        const ranges=portal?[[u,Math.min(v,0.36)],[Math.max(u,0.64),v]]:[[u,v]];
        for(const [lo,hi] of ranges)if(hi>lo){
          quad(R,sectionPoint(s,a,lo,zb),sectionPoint(s,a,hi,zb),sectionPoint(s,b,hi,zb),sectionPoint(s,b,lo,zb),'concrete',up,true);
          quad(R,sectionPoint(s,a,lo,za),sectionPoint(s,a,hi,za),sectionPoint(s,a,hi,zb),sectionPoint(s,a,lo,zb),'riser');
        }
      }
      // Aisle steps remain concrete. Each seating row stops at both aisles.
      const ranges=portal?[[aisle,0.36],[0.64,1-aisle]]:[[aisle,1-aisle]];
      for(const [lo,hi] of ranges)for(let k=0;k<steps;k++){
        const u=lerp(lo,hi,k/steps),v=lerp(lo,hi,(k+1)/steps),t=a+(b-a)*0.55;
        const ta=Math.min(b,t+d.benchDepth/s.run);
        quad(R,sectionPoint(s,t,u,zb+d.benchHeight),sectionPoint(s,t,v,zb+d.benchHeight),
          sectionPoint(s,ta,v,zb+d.benchHeight),sectionPoint(s,ta,u,zb+d.benchHeight),seatTone,up);
        quad(R,sectionPoint(s,t,u,zb+0.05),sectionPoint(s,t,v,zb+0.05),
          sectionPoint(s,t,v,zb+d.benchHeight),sectionPoint(s,t,u,zb+d.benchHeight),seatTone);
      }
      if(portal){
        // An actual opening through treads AND underside. Jambs and a floor
        // below the deck give it depth rather than painting a black rectangle.
        for(const u of [0.36,0.64])quad(B,sectionPoint(s,a,u,zb-2.5),sectionPoint(s,b,u,zb-2.5),
          sectionPoint(s,b,u,zb),sectionPoint(s,a,u,zb),'concrete');
        quad(B,sectionPoint(s,a,0.36,zb-2.5),sectionPoint(s,a,0.64,zb-2.5),
          sectionPoint(s,b,0.64,zb-2.5),sectionPoint(s,b,0.36,zb-2.5),'black',up,true);
      }
      if(row%TUNE.farStripeEvery===0){
        for(let k=0;k<steps;k++)quad(F,sectionPoint(s,a,k/steps,za+TUNE.surfaceOffset),
          sectionPoint(s,a,(k+1)/steps,za+TUNE.surfaceOffset),sectionPoint(s,a+0.003,(k+1)/steps,za+0.07),
          sectionPoint(s,a+0.003,k/steps,za+0.07),'riser',up);
      }
      count.rows++;
    }
    if(s.rows>30){
      const t=(TUNE.portalRow+TUNE.portalRows)/s.rows,p=sectionPoint(s,t,0.5,z(t));
      const l=sectionPoint(s,t,0.35,z(t)),r=sectionPoint(s,t,0.65,z(t));
      quad(B,[l[0],l[1],p[2]], [r[0],r[1],p[2]], [r[0],r[1],p[2]+data.details.portalHeight],
        [l[0],l[1],p[2]+data.details.portalHeight],'black');
      beam(B,[...l.slice(0,2),p[2]+data.details.portalHeight],[...r.slice(0,2),p[2]+data.details.portalHeight],0.32,'stone');
      count.portals++;
    }
    for(let k=0;k<steps;k++){
      beam(rails,sectionPoint(s,1,k/steps,z(1)+d.railHeight),sectionPoint(s,1,(k+1)/steps,z(1)+d.railHeight),d.railThickness);
    }
    for(const u of [0.02,0.98])for(let row=2;row<s.rows;row+=6){
      const t=row/s.rows,p=sectionPoint(s,t,u,z(t));
      beam(rails,p,[p[0],p[1],p[2]+d.railHeight],d.railThickness);
      const t1=Math.min(1,t+6/s.rows);
      beam(rails,[p[0],p[1],p[2]+d.railHeight],sectionPoint(s,t1,u,z(t1)+d.railHeight),d.railThickness);
    }
    if(s.tier.includes('upper'))for(const t of [0.1,0.85]){
      const p=sectionPoint(s,t,0.5,z(t)-d.slabThickness);
      box(B,p[0],p[1],TUNE.supportWidth,TUNE.supportWidth,0,p[2],'concrete');
      beam(B,sectionPoint(s,0,0.5,s.base-1),sectionPoint(s,1,0.5,z(1)-1),0.75,'concrete');
    }
  }
  function facade(B,a,b,height,outward) {
    const len=Math.hypot(b[0]-a[0],b[1]-a[1]),n=Math.max(1,Math.round(len/data.details.facadeBay));
    const at=(t,z,o=0)=>[lerp(a[0],b[0],t)+outward[0]*o,lerp(a[1],b[1],t)+outward[1]*o,z];
    for(let i=0;i<n;i++){
      const u=i/n,v=(i+1)/n,c=(u+v)/2;
      // Ground level has genuinely open gates between piers.
      const p=at(c,0);box(B,p[0],p[1],TUNE.facadePierWidth,TUNE.facadePierWidth,0,height,'brick');
      for(let z=TUNE.facadeFloor;z<height;z+=TUNE.facadeFloor){
        quad(B,at(u,z),at(v,z),at(v,Math.min(height,z+TUNE.facadeBand)),at(u,Math.min(height,z+TUNE.facadeBand)),'stone',outward.concat(0));
        const lo=u+(v-u)*0.12,hi=v-(v-u)*0.12,top=Math.min(height,z+TUNE.facadeFloor-TUNE.facadeBand);
        quad(B,at(lo,z+TUNE.facadeBand,-0.35),at(hi,z+TUNE.facadeBand,-0.35),at(hi,top,-0.35),at(lo,top,-0.35),'glass',outward.concat(0));
        beam(B,at(c,z+TUNE.facadeBand,-0.30),at(c,top,-0.30),0.12,'stone');
      }
    }
    beam(B,at(0,height),at(1,height),0.8,'stone');
    const inside=a.map((v,i)=>v-outward[i]*5),insideB=b.map((v,i)=>v-outward[i]*5);
    slab(B,[a,b,insideB,inside],height-0.5,height,'stone');
  }
  function tower(B,R,t) {
    const n=TUNE.towerSegments,ring=r=>Array.from({length:n},(_,i)=>[t.x+r*Math.cos(i*2*Math.PI/n),t.y+r*Math.sin(i*2*Math.PI/n)]);
    if(t.kind==='ramp'){
      // Open helical walkway and guard, not stacked filled discs.
      const nr=TUNE.rampSegments;
      const p=(i,r,z)=>[t.x+r*Math.cos(i/nr*Math.PI*2*TUNE.rampTurns),t.y+r*Math.sin(i/nr*Math.PI*2*TUNE.rampTurns),z];
      for(let i=0;i<nr;i++){
        const z=i/nr*t.height,zz=(i+1)/nr*t.height;
        quad(B,p(i,2,z),p(i,t.radius,z),p(i+1,t.radius,zz),p(i+1,2,zz),'concrete',up,true);
        quad(B,p(i,t.radius,z),p(i+1,t.radius,zz),p(i+1,t.radius,zz+0.8),p(i,t.radius,z+0.8),'stone');
        beam(R,p(i,t.radius,z+1),p(i+1,t.radius,zz+1),0.06);
      }
      for(let i=0;i<8;i++){const p=ring(t.radius-0.5)[i*4];box(B,p[0],p[1],0.65,0.65,0,t.height,'stone');}
    }else{
      const q=ring(t.radius);
      for(let i=0;i<n;i++){
        const a=q[i],b=q[(i+1)%n],c=i%8<3?'glass':'brick';
        quad(B,[...a,0],[...b,0],[...b,t.height],[...a,t.height],c,[(a[0]-t.x)/t.radius,(a[1]-t.y)/t.radius,0]);
      }
      for(let z=4.6;z<t.height;z+=4.6){
        const a=ring(t.radius+0.08);for(let i=0;i<n;i++){const b=a[(i+1)%n];quad(B,[...a[i],z],[...b,z],[...b,z+0.32],[...a[i],z+0.32],'stone');}
      }
    }
    slab(B,ring(t.radius+0.5),t.height,t.height+0.45,'stone');
  }
  // Small, generated lettering: no downloaded advertising or unlicensed textures.
  const FONT={A:['01110','10001','10001','11111','10001','10001','10001'],B:['11110','10001','10001','11110','10001','10001','11110'],
    D:['11110','10001','10001','10001','10001','10001','11110'],E:['11111','10000','10000','11110','10000','10000','11111'],
    F:['11111','10000','10000','11110','10000','10000','10000'],G:['01111','10000','10000','10111','10001','10001','01110'],
    H:['10001','10001','10001','11111','10001','10001','10001'],I:['11111','00100','00100','00100','00100','00100','11111'],
    K:['10001','10010','10100','11000','10100','10010','10001'],L:['10000','10000','10000','10000','10000','10000','11111'],
    M:['10001','11011','10101','10101','10001','10001','10001'],N:['10001','11001','10101','10011','10001','10001','10001'],
    O:['01110','10001','10001','10001','10001','10001','01110'],R:['11110','10001','10001','11110','10100','10010','10001'],
    S:['01111','10000','10000','01110','00001','00001','11110'],T:['11111','00100','00100','00100','00100','00100','00100'],
    U:['10001','10001','10001','10001','10001','10001','01110'],X:['10001','10001','01010','00100','01010','10001','10001'],
    Y:['10001','10001','01010','00100','00100','00100','00100'],
    0:['01110','10001','10011','10101','11001','10001','01110'],1:['00100','01100','00100','00100','00100','00100','01110'],
    2:['01110','10001','00001','00010','00100','01000','11111'],3:['11110','00001','00001','01110','00001','00001','11110'],
    4:['00010','00110','01010','10010','11111','00010','00010'],5:['11111','10000','10000','11110','00001','00001','11110']};
  function text(B,str,width,height,at,key='paint') {
    const cell=width/(str.length*6-1);
    [...str].forEach((c,i)=>(FONT[c]||[]).forEach((line,row)=>[...line].forEach((v,col)=>{
      if(v!=='1')return;
      const x=-width/2+(i*6+col)*cell,y=height/2-row*height/7;
      quad(B,at(x,y),at(x+cell,y),at(x+cell,y-height/7),at(x,y-height/7),key);
    })));
  }
  function field(B) {
    const f=data.field,z=TUNE.fieldHeight,w=f.width/2,l=f.length/2;
    // Paint is a single surface. Closed millimetre-thick boxes draw both
    // faces under the double-sided material and alias against themselves.
    const paint=(x,y,width,length,zz,key)=>quad(B,[x-width/2,y-length/2,zz],[x+width/2,y-length/2,zz],
      [x+width/2,y+length/2,zz],[x-width/2,y+length/2,zz],key,up,true);
    box(B,0,0,f.apronWidth,f.apronLength,0,z,'concrete');
    for(let i=0;i<12;i++)paint(0,-l+(i+0.5)*9.144,f.width,9.144,z+0.08,i===0||i===11?'endzone':i%2?'turf':'turfAlt');
    const zz=z+0.17;
    for(let y=-45.72;y<=45.73;y+=4.572)paint(0,y,f.width,TUNE.fieldLineWidth,zz,'paint');
    for(const x of [-w,w])paint(x,0,TUNE.fieldLineWidth,f.length,zz,'paint');
    for(let yard=-49;yard<50;yard++)for(const x of [-w+0.3,-6.096,6.096,w-0.3])paint(x,yard*0.9144,0.6,0.09,zz,'paint');
    for(let line=-4;line<=4;line++){
      const label=String(50-Math.abs(line)*10);
      for(const sign of [-1,1])text(B,label,2.8,2.0,(x,y)=>[sign*16+sign*y,line*9.144+sign*x,zz+0.04]);
    }
    text(B,'TEXAS',32,5.1,(x,y)=>[x,l-4.572+y,zz+0.04]);
    text(B,'LONGHORNS',39,4.6,(x,y)=>[-x,-l+4.572-y,zz+0.04]);
    const horn=[[-1,0.6],[-0.7,0.1],[-0.32,0.12],[-0.22,-0.2],[-0.15,-0.8],[0.15,-0.8],[0.22,-0.2],[0.32,0.12],[0.7,0.1],[1,0.6],[0.65,0.45],[0.28,0.45],[0.18,0.25],[-0.18,0.25],[-0.28,0.45],[-0.65,0.45]];
    slab(B,horn.map(([x,y])=>[x*7,y*5]),zz,zz+0.05,'orange');
    for(const sign of [-1,1]){
      const y=sign*(l+1.5);beam(B,[0,y,0],[0,y,3.05],0.16,'light');
      beam(B,[-2.8194,y,3.05],[2.8194,y,3.05],0.13,'light');
      for(const x of [-2.8194,2.8194])beam(B,[x,y,3.05],[x,y,9.1],0.13,'light');
    }
  }
  function south(B,R) {
    const d=data.south,board=data.board;
    box(B,0,-94,60,10,0,16,'stone');
    facade(B,[-28,-87],[28,-87],19,[0,1]);
    for(const sign of [-1,1]){
      const x=sign*d.towerX;
      box(B,x,d.towerY,d.towerWidth,d.towerDepth,0,d.towerHeight,'glass');
      for(let z=4.5;z<d.towerHeight;z+=4.8){box(B,x,d.towerY+0.2,d.towerWidth+0.6,d.towerDepth+0.5,z,z+0.65,'stone');}
      for(const dx of [-d.towerWidth/2,d.towerWidth/2])box(B,x+dx,d.towerY,0.85,d.towerDepth+0.8,0,d.towerHeight+1,'orange');
      box(B,x,d.towerY,d.towerWidth+0.8,d.towerDepth+0.8,d.towerHeight,d.towerHeight+0.7,'orange');
    }
    const by=x=>board.y+board.curve*x*x;
    for(let i=0;i<TUNE.boardSegments;i++){
      const a=lerp(-board.width/2,board.width/2,i/TUNE.boardSegments),b=lerp(-board.width/2,board.width/2,(i+1)/TUNE.boardSegments);
      const z=board.base,h=board.height;
      quad(B,[a,by(a),z],[b,by(b),z],[b,by(b),z+h],[a,by(a),z+h],'black',[0,1,0]);
      beam(B,[a,by(a),z-0.4],[b,by(b),z-0.4],0.8,'steel');
      beam(B,[a,by(a),z+h+0.4],[b,by(b),z+h+0.4],0.8,'steel');
    }
    text(B,'TEXAS',32,6.4,(x,y)=>[-x,by(x)+0.05,board.base+board.height/2+y],'screenOrange');
    text(B,'LONGHORNS',35,1.5,(x,y)=>[-x,by(x)+0.06,board.base+2+y]);
    text(B,'DARRELL K ROYAL',46,1.15,(x,y)=>[-x,by(x)+0.04,board.base+board.height+1.4+y]);
    slab(B,d.balcony,d.balconyBase,d.balconyTop,'concrete','orange');
    for(let i=0;i<d.balcony.length;i++){
      const a=d.balcony[i],b=d.balcony[(i+1)%d.balcony.length];
      quad(B,[...a,d.balconyTop],[...b,d.balconyTop],[...b,d.balconyTop+0.85],[...a,d.balconyTop+0.85],'orange');
      beam(R,[...a,d.balconyTop+1],[...b,d.balconyTop+1],0.065);
    }
    // Terraced loge boxes stand behind the carved balcony's horns.
    for(let row=0;row<4;row++)for(let col=-3;col<=3;col++){
      const x=col*6.5,y=-81-row*2.1,z=14+row*1.3;
      box(B,x,y,5.8,1.85,z-0.4,z,'stone');
      box(B,x,y+0.65,5.5,0.24,z,z+0.7,'orangeSeat');
      for(const dx of [-2.9,2.9])box(B,x+dx,y,0.15,1.85,z,z+0.8,'stone');
    }
  }
  function architecture(B,R) {
    facade(B,[-122,-78],[-122,79],43,[-1,0]);
    facade(B,[105,70],[105,-66],29,[1,0]);
    const path=[];
    for(let i=0;i<=24;i++){
      const a=i/24*Math.PI;
      const x=(a<Math.PI/2?34.2:-34.2)+67.8*Math.cos(a),y=61.6+67.8*Math.sin(a);
      path.push([x,y]);
    }
    // Explicit straight north front between the two quarter circles.
    const front=[];
    for(let i=0;i<=8;i++){const a=i/8*Math.PI/2;front.push([34.2+67.8*Math.cos(a),61.6+67.8*Math.sin(a)]);}
    front.push([-34.2,129.4]);
    for(let i=1;i<=8;i++){const a=Math.PI/2+i/8*Math.PI/2;front.push([-34.2+67.8*Math.cos(a),61.6+67.8*Math.sin(a)]);}
    for(let i=0;i<front.length-1;i++){
      const a=front[i],b=front[i+1],dx=b[0]-a[0],dy=b[1]-a[1],l=Math.hypot(dx,dy);
      facade(B,a,b,31,[dy/l,-dx/l]);
    }
    for(const t of data.towers)tower(B,R,t);
    // West press/suite strip and its open light gantry.
    box(B,-120,0,5,152,43,55,'stone');
    for(let y=-72;y<75;y+=6)box(B,-116.9,y,0.25,5,46,50,'glass');
    for(let y=-76;y<=76;y+=19){
      beam(B,[TUNE.trussX,y,55],[TUNE.trussX,y,TUNE.trussTop],0.65,'stone');
      if(y<76)beam(B,[TUNE.trussX,y,TUNE.trussBase],[TUNE.trussX,y+19,TUNE.trussTop],0.15,'steel');
    }
    for(const z of [TUNE.trussBase,TUNE.trussTop])beam(B,[TUNE.trussX,-79,z],[TUNE.trussX,79,z],0.55,'steel');
    for(let y=-76;y<=76;y+=3.8)box(B,TUNE.trussX+0.4,y,0.8,2.8,TUNE.trussTop-0.45,TUNE.trussTop,'light');
    for(let y=-62;y<=60;y+=19){
      beam(B,[101,y,40.4],[101,y,45.2],0.45,'stone');
      box(B,100.5,y,0.8,5.3,44.5,45.2,'light');
    }
    text(B,'TEXAS LONGHORNS',56,2.2,(x,z)=>[-x,129.5,6.8+z],'stone');
  }
  function dispose() {
    if(!group)return;
    window.slopes.remove(group);
    const materials=new Set();group.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material)materials.add(o.material);});
    materials.forEach(m=>m.dispose());group=null;collision.clear();
  }
  function build() {
    const S=window.slopes,T=window.THREE;
    origin=S.toLocal(...data.origin,0);
    const e=S.toLocal(...ll(1,0),0),n=S.toLocal(...ll(0,1),0);
    east=[e.x-origin.x,e.y-origin.y];north=[n.x-origin.x,n.y-origin.y];
    const B=S.build(),R=S.build(),F=S.build(),rails=S.build();
    collision.clear();count.rows=0;count.portals=0;
    for(const s of data.sections)emitSection(s,B,R,F,rails);
    field(B);south(B,rails);architecture(B,rails);
    group=new T.Group();group.name='slopes-stadium';group.userData.minzoom=data.details.minZoom;group.userData.lod=null;
    const mat=S.material({side:T.DoubleSide});
    // Stadium-only authored floodlight spill. The shared sun still shades
    // daytime geometry; at night a per-vertex mask supplies neutral local
    // illumination. This is not a real-time spotlight or a seat emission map.
    mat.uniforms={...mat.uniforms,
      u_dkrNightStart:{value:TUNE.nightStart},u_dkrNightFull:{value:TUNE.nightFull}};
    mat.vertexShader=mat.vertexShader.replace('attribute float aFacet;',
      'attribute float aFacet; attribute float aStadiumLight; uniform float u_dkrNightStart; uniform float u_dkrNightFull;');
    mat.vertexShader=mat.vertexShader.replace('v_color = vec4(lit * k, 1.0) * u_opacity;',
      'lit = mix(lit, max(lit, cNight * aStadiumLight), smoothstep(u_dkrNightStart, u_dkrNightFull, u_p)); v_color = vec4(lit * k, 1.0) * u_opacity;');
    for(const [name,b] of [['structure',B],['rows',R],['far-seating',F],['rails',rails]]){
      const geo=b.geometry(),pos=geo.attributes.position,cn=geo.attributes.cNight;
      const illumination=new Float32Array(pos.count);
      const rgb=key=>new T.Color(data.palette[key][2]);
      // THREE.Color applies colour-space conversion on some revisions;
      // generator attributes are raw hexadecimal/255, so parse directly.
      const match=(i,key)=>{const hex=data.palette[key][2].slice(1);return [0,2,4].every((s,j)=>Math.abs(cn.array[i*3+j]-parseInt(hex.slice(s,s+2),16)/255)<0.002);};
      for(let i=0;i<pos.count;i++){
        const z=pos.getZ(i);
        if(name==='rows'||name==='far-seating')illumination[i]=lerp(TUNE.lowerSpill,TUNE.upperSpill,Math.min(1,z/60));
        else if(match(i,'light')||match(i,'screenOrange')||match(i,'paint'))illumination[i]=1;
        else if(z<1)illumination[i]=1;
      }
      geo.setAttribute('aStadiumLight',new T.BufferAttribute(illumination,1));
      const m=new T.Mesh(geo,mat);m.name=name;group.add(m);
    }
    count.sections=data.sections.length;count.triangles=B.triangles+R.triangles+F.triangles+rails.triangles;
    S.add(group);lastNear=lastRail=null;updateLOD();
  }
  function replacementPolygon() {
    const [a,b,c,d]=data.bounds;
    return {type:'Polygon',coordinates:[[[a,b],[c,b],[c,d],[a,d],[a,b]].map(p=>ll(...p))]};
  }
  const tag=['!=',['literal','dkr-mesh'],['literal','dkr-mesh']];
  function filter(on) {
    if(!map)return;
    // Remove only OUR clause. Other generators may have changed a shared
    // building filter since boot; restoring a snapshot would erase their work.
    const strip=(f,clause)=>{
      if(JSON.stringify(f)===JSON.stringify(clause))return null;
      if(!Array.isArray(f)||f[0]!=='all')return f;
      const rest=f.slice(1).map(x=>strip(x,clause));
      if(rest.every((x,i)=>x===f[i+1]))return f;
      const keep=rest.filter(x=>x!=null);return keep.length>1?['all',...keep]:keep[0]||null;
    };
    for(const id of [...LEGACY,...VOLUMES]){
      if(!map.getLayer(id))continue;
      if(on){
        const clause=LEGACY.includes(id)?tag:['>', ['distance',replacementPolygon()],0];
        const orig=map.getFilter(id)||null;
        saved.set(id,clause);
        if(strip(orig,clause)!==orig)continue;
        map.setFilter(id,orig?['all',orig,clause]:clause);
      }else if(saved.has(id)){
        map.setFilter(id,strip(map.getFilter(id)||null,saved.get(id)));saved.delete(id);
      }
    }
    filtered=on;
  }
  function updateLOD() {
    if(!group||!map)return;
    // Read this camera pose directly: the controller syncs after the move
    // event, so consulting its eye here left detail one camera move behind.
    const c=map.getCenter(),tr=map.transform;
    const distance=tr.cameraToCenterDistance/tr.pixelsPerMeter;
    const pitch=map.getPitch()*Math.PI/180,bearing=map.getBearing()*Math.PI/180;
    const alt=distance*Math.cos(pitch),lead=distance*Math.sin(pitch);
    const ex=-lead*Math.sin(bearing),ey=-lead*Math.cos(bearing),centre=uv(c.lng,c.lat);
    const x=centre[0]+ex*data.east[0]+ey*data.east[1],y=centre[1]+ex*data.north[0]+ey*data.north[1];
    const dist=Math.hypot(x,y,alt);
    const near=dist<data.details.rowGeometryDistance,rail=dist<data.details.railDistance;
    if(near!==lastNear||rail!==lastRail){
      group.getObjectByName('rows').visible=near;group.getObjectByName('far-seating').visible=!near;
      group.getObjectByName('rails').visible=rail;lastNear=near;lastRail=rail;map.triggerRepaint();
    }
  }
  function apply() {
    if(!data||!map)return;
    const on=TUNE.on&&window.SLOPES.on;
    if(on&&!group)build();else if(!on&&group)dispose();
    filter(on);map.triggerRepaint();
  }
  function heightAt(lng,lat) {
    if(!group||!filtered)return undefined;
    const [x,y]=uv(lng,lat),b=data.bounds;
    if(x<b[0]||x>b[2]||y<b[1]||y>b[3])return undefined;
    let top=0;
    for(const t of collision.get(Math.floor(x/TUNE.collisionCell)+','+Math.floor(y/TUNE.collisionCell))||[]){
      const {a,b,c,den}=t;
      const u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/den;
      const v=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/den;
      if(u>=-1e-6&&v>=-1e-6&&u+v<=1+1e-6)top=Math.max(top,u*a[2]+v*b[2]+(1-u-v)*c[2]);
    }
    return top;
  }
  window.slopesStadium={
    get count(){return {...count};},get data(){return data;},get group(){return group;},get filtered(){return filtered;},
    get lod(){return {near:lastNear,rails:lastRail};},ll,uv,heightAt,
    rebuild(){dispose();apply();},setEnabled(on){TUNE.on=!!on;apply();},
  };
  async function boot(){
    if(booting)return;map=window.__map;
    if(!map||!window.slopes?.root||!map.getLayer('stadium-seating'))return;
    booting=true;
    try{
      data=await window.slopes.fetchJSON(TUNE.url);
      if(!data?.sections?.length)throw new Error('Missing stadium sections');
      window.slopes.onSwitch(apply);
      // Run after other generators have registered their filters.
      apply();map.on('move',updateLOD);
      // Sky repaints keep MapLibre from becoming idle. Filters are also
      // rewritten by other generators after our asynchronous boot.
      let pending=false;
      map.on('styledata',()=>{
        if(pending||!TUNE.on||!window.SLOPES.on)return;
        pending=true;requestAnimationFrame(()=>{pending=false;if(TUNE.on&&window.SLOPES.on)filter(true);});
      });
      const original=window.applySlopesSettings;
      if(typeof original==='function')window.applySlopesSettings=function(){const r=original.apply(this,arguments);apply();return r;};
      count.done=true;clearInterval(timer);
      console.log('[slopes-stadium]',count.sections,'sections',count.rows,'rows',count.triangles,'triangles');
    }catch(e){count.warnings.push(e.message);count.done=true;clearInterval(timer);console.error('[slopes-stadium]',e);}
  }
  if(new URLSearchParams(location.search).get('slopes')!=='0')timer=setInterval(boot,350);
})();
