// Per-vertex fine repeats. No triangle widths, model swaps, geometry removal or image blur.
// _FINE = UBYTE VEC4: [building, logarithmic metres, patch low byte, patch high byte].
// Replaces the float _BUILDING (4 bytes). Patch entries hold linear colour + WORLD-space normal.
import { getPixels } from 'ndarray-pixels';

export const FINE = {
  WELD_M: 0.0001,             // geometric seam tolerance, independent of palette/normal seams
  PLANE_COS: 0.9998,
  BOUNDARY_BIN_M: 1,          // chord queries visit only boundary segments crossing the sample row/column
  FIN_FACE_MAX_M: 2,          // only a narrow face may inherit a solid part's smaller thickness
  PATCH_RADIUS_M: 3,          // square facade neighbourhood, clipped against the actual triangles
  PATCH_STEP_M: 2,            // shared samples; values interpolate on the ORIGINAL vertices
  PATCH_DEPTH_M: 1.5,         // include recessed windows / projecting fins, exclude opposite walls
  ANCHOR_MIN_M: 3,            // broad nearby facade establishes the repeat's plane (including fin sides)
  MAX_SIZE_M: 32,             // larger features never filter
  SIZE_BASE_M: 0.01,
  SIZE_STEPS: 16,             // 16 logarithmic steps per octave, < 4.5% size error
  MAX_PATCHES: 65535,
  VENUE_RELIEF_M: 0.025,      // > position quantization step: brick must remain in front of the white wall
  COPLANAR_M: 0.0002,
};
const dot = (a, b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const sub = (a, b) => a.map((v,k)=>v-b[k]);
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit = (v) => { const d=Math.hypot(...v); return d>1e-12?v.map(x=>x/d):[0,1,0]; };
const canonical = (v) => { const k=v.map(Math.abs).indexOf(Math.max(...v.map(Math.abs))); return v[k]<0?v.map(x=>-x):v; };
const point = (m,p) => [0,1,2].map(k=>m[k]*p[0]+m[4+k]*p[1]+m[8+k]*p[2]+m[12+k]);
const srgb = c => c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4;
const coordKey = p => p.map(x=>Math.round(x/FINE.WELD_M)).join(',');
const edgeKey = (a,b) => a<b?`${a}/${b}`:`${b}/${a}`;
function basis(n) {
  const u=unit(cross(Math.abs(n[1])<0.9?[0,1,0]:[0,0,1],n));
  return [u,unit(cross(n,u))];
}
class Union {
  constructor(n) { this.p=Int32Array.from({length:n},(_,i)=>i); }
  find(i) { while(this.p[i]!==i) { this.p[i]=this.p[this.p[i]]; i=this.p[i]; } return i; }
  join(a,b) { a=this.find(a); b=this.find(b); if(a!==b)this.p[b]=a; }
}
function bounds(points,axes) {
  return axes.map(a=>{let lo=Infinity,hi=-Infinity;for(const p of points){const v=dot(p,a);lo=Math.min(lo,v);hi=Math.max(hi,v);}return [lo,hi];});
}
function clip(poly,axis,limit,sign) {
  const out=[];
  for(let i=0;i<poly.length;i++) {
    const a=poly[i],b=poly[(i+1)%poly.length],da=(dot(a,axis)-limit)*sign,db=(dot(b,axis)-limit)*sign;
    if(da<=0)out.push(a);
    if((da<0&&db>0)||(da>0&&db<0)) {const k=da/(da-db);out.push(a.map((v,j)=>v+(b[j]-v)*k));}
  }
  return out;
}
function clippedArea(t,axes,ranges) {
  let fullyInside=true;
  for(let j=0;j<3;j++) {
    const ds=t.p.map(p=>dot(p,axes[j])),lo=Math.min(...ds),hi=Math.max(...ds);
    if(hi<ranges[j][0]||lo>ranges[j][1])return 0;
    if(lo<ranges[j][0]||hi>ranges[j][1])fullyInside=false;
  }
  if(fullyInside)return t.area;
  let poly=t.p;
  for(let j=0;j<3&&poly.length;j++) {poly=clip(poly,axes[j],ranges[j][0],-1);if(poly.length)poly=clip(poly,axes[j],ranges[j][1],1);}
  let area=0;
  for(let i=1;i+1<poly.length;i++)area+=Math.hypot(...cross(sub(poly[i],poly[0]),sub(poly[i+1],poly[0])))/2;
  return area;
}
// Width of the actual connected face, through this point, along its two facade axes.
// Interior triangulation edges are absent. A huge wall cut into skinny triangles keeps its wall dimensions.
function faceWidth(c,p) {
  const q=[dot(p,c.u),dot(p,c.v)]; let width=Infinity;
  for(let axis=0;axis<2;axis++) {
    let neg=-Infinity,pos=Infinity; const other=1-axis;
    const bin=c.lines[axis].get(Math.floor(q[other]/FINE.BOUNDARY_BIN_M))||[];
    for(const [av,bv] of bin) {
      if((av[other]>q[other])===(bv[other]>q[other]))continue;
      const s=(q[other]-av[other])/(bv[other]-av[other]);
      const hit=av[axis]+(bv[axis]-av[axis])*s-q[axis];
      if(hit<=0)neg=Math.max(neg,hit); if(hit>=0)pos=Math.min(pos,hit);
    }
    if(Number.isFinite(pos-neg))width=Math.min(width,pos-neg);
  }
  return Number.isFinite(width)?width:Math.min(...c.extent);
}

// Repair before quantization / palette conversion. Intersect coplanar triangles, including partial overlaps.
// Translate the WHOLE connected brick slab so its side returns and split-normal seams stay closed.
export function fixVenueCoplanar(doc,slug) {
  if(!['the-venue','the-venue-on-guadalupe'].includes(slug))return null;
  const whites=[],bricks=[];
  for(const mesh of doc.getRoot().listMeshes())for(const prim of mesh.listPrimitives()) {
    const name=prim.getMaterial()?.getName()||'';
    if(!/^(brick_red|wall_white)$/.test(name))continue;
    const P=prim.getAttribute('POSITION'),N=prim.getAttribute('NORMAL'),I=prim.getIndices();
    for(let i=0;i<(I?I.getCount():P.getCount());i+=3) {
      const ids=[0,1,2].map(k=>I?I.getScalar(i+k):i+k),p=ids.map(k=>P.getElement(k,[]));
      const cr=cross(sub(p[1],p[0]),sub(p[2],p[0])),a=Math.hypot(...cr)/2;
      if(a<1e-10)continue;
      const t={P,N,ids,p,n:unit(cr),a}; (name==='wall_white'?whites:bricks).push(t);
    }
  }
  let area=0,faces=0;
  for(const P of new Set(bricks.map(t=>t.P))) {
    const ts=bricks.filter(t=>t.P===P),parts=new Union(P.getCount()),welded=new Map();
    for(let i=0;i<P.getCount();i++) {const key=coordKey(P.getElement(i,[]));if(welded.has(key))parts.join(i,welded.get(key));else welded.set(key,i);}
    for(const t of ts) {parts.join(t.ids[0],t.ids[1]);parts.join(t.ids[1],t.ids[2]);}
    const offsets=new Map();
    for(const t of ts) {
      let overlap=0;
      for(const w of whites) {
        if(Math.abs(dot(t.n,w.n))<FINE.PLANE_COS||t.p.some(p=>Math.abs(dot(sub(p,w.p[0]),w.n))>FINE.COPLANAR_M))continue;
        let poly=t.p;
        for(let k=0;k<3&&poly.length;k++) {
          const edge=sub(w.p[(k+1)%3],w.p[k]),inward=cross(w.n,edge);
          poly=clip(poly,inward,dot(w.p[k],inward),-1);
        }
        for(let k=1;k+1<poly.length;k++)overlap+=Math.hypot(...cross(sub(poly[k],poly[0]),sub(poly[k+1],poly[0])))/2;
      }
      overlap=Math.min(t.a,overlap);
      if(overlap<1e-6)continue;
      area+=overlap;faces++;
      const id=parts.find(t.ids[0]),old=offsets.get(id);
      if(!old||overlap>old.overlap)offsets.set(id,{overlap,n:t.N?unit(t.N.getElement(t.ids[0],[])):t.n});
    }
    for(let i=0;i<P.getCount();i++) {const move=offsets.get(parts.find(i));if(move)P.setElement(i,P.getElement(i,[]).map((v,k)=>v+move.n[k]*FINE.VENUE_RELIEF_M));}
  }
  return {slug,coplanar_m2:+area.toFixed(4),triangles:faces,offset_m:FINE.VENUE_RELIEF_M};
}

export async function fineData(doc, log = () => {}) {
  const root=doc.getRoot(),records=[],tri=[],texCache=new Map();
  // All parts together: a transparent window and an opaque wall must see the same neighbourhood.
  for(const node of root.listNodes()) {
    const mesh=node.getMesh();if(!mesh)continue;
    mesh.setExtras(Object.fromEntries(Object.entries(mesh.getExtras()).filter(([k])=>k!=='fine')));
    const M=node.getWorldMatrix(),columns=[[M[0],M[1],M[2]],[M[4],M[5],M[6]],[M[8],M[9],M[10]]];
    const cof=[cross(columns[1],columns[2]),cross(columns[2],columns[0]),cross(columns[0],columns[1])],sign=Math.sign(dot(columns[0],cof[0]))||1;
    const normalToWorld=n=>unit([0,1,2].map(k=>sign*(cof[0][k]*n[0]+cof[1][k]*n[1]+cof[2][k]*n[2])));
    for(const prim of mesh.listPrimitives()) {
      const P=prim.getAttribute('POSITION'),N=prim.getAttribute('NORMAL'),B=prim.getAttribute('_BUILDING'),UV=prim.getAttribute('TEXCOORD_0'),I=prim.getIndices(),mat=prim.getMaterial();
      if(!P||!B)continue;
      const tex=mat?.getBaseColorTexture();let pixels;
      if(tex) {if(!texCache.has(tex))texCache.set(tex,await getPixels(tex.getImage(),tex.getMimeType()));pixels=texCache.get(tex);}
      const rec={prim,mesh,P,B,world:Array.from({length:P.getCount()},(_,i)=>point(M,P.getElement(i,[]))),triangles:[],sizes:new Float64Array(P.getCount()),areas:new Float64Array(P.getCount()),anchor:new Array(P.getCount()),best:new Float64Array(P.getCount())};
      records.push(rec);
      for(let i=0;i<(I?I.getCount():P.getCount());i+=3) {
        const ids=[0,1,2].map(k=>I?I.getScalar(i+k):i+k),p=ids.map(k=>rec.world[k]);
        const cr=cross(sub(p[1],p[0]),sub(p[2],p[0])),area=Math.hypot(...cr)/2;
        if(area<1e-10)continue;
        let col=(mat?.getBaseColorFactor()||[1,1,1]).slice(0,3);
        if(pixels&&UV) {const uv=UV.getElement(ids[0],[]),x=Math.min(pixels.shape[0]-1,Math.max(0,Math.floor(uv[0]*pixels.shape[0]))),y=Math.min(pixels.shape[1]-1,Math.max(0,Math.floor(uv[1]*pixels.shape[1])));col=col.map((v,k)=>v*srgb(pixels.get(x,y,k)/255));}
        const t={rec,ids,p,n:unit(cr),area,col,b:B.getScalar(ids[0]),c:p[0].map((v,k)=>(v+p[1][k]+p[2][k])/3),v:p.map(coordKey)};
        t.shadeN=N?normalToWorld(ids.reduce((acc,id)=>{const n=N.getElement(id,[]);return acc.map((v,k)=>v+n[k]);},[0,0,0])):t.n;
        t.key=`${t.b}:${col.map(v=>v.toFixed(6)).join(',')}`;t.id=tri.length;tri.push(t);rec.triangles.push(t);
      }
    }
  }
  log(`geometry: ${tri.length} triangles`);
  const solid=new Union(tri.length),planar=new Union(tri.length),edges=new Map();
  for(const t of tri)for(let j=0;j<3;j++) {
    const key=t.key+':'+edgeKey(t.v[j],t.v[(j+1)%3]);
    const prev=edges.get(key);
    if(prev)for(const q of prev) {solid.join(t.id,q);if(Math.abs(dot(t.n,tri[q].n))>FINE.PLANE_COS)planar.join(t.id,q);}
    if(prev)prev.push(t.id);else edges.set(key,[t.id]);
  }
  const comps=new Map(),solids=new Map();
  for(const t of tri) {
    const pid=planar.find(t.id),sid=solid.find(t.id);
    if(!comps.has(pid))comps.set(pid,{ts:[],edges:new Map(),n:canonical(t.n),b:t.b});
    const c=comps.get(pid);c.ts.push(t);t.face=c;
    if(!solids.has(sid))solids.set(sid,[]);solids.get(sid).push(t);t.solid=sid;
    for(let j=0;j<3;j++) {const key=edgeKey(t.v[j],t.v[(j+1)%3]);if(c.edges.has(key))c.edges.get(key).count++;else c.edges.set(key,{count:1,p:[t.p[j],t.p[(j+1)%3]]});}
  }
  const thickness=new Map();
  for(const [id,ts] of solids) {
    const main=ts.reduce((a,b)=>a.area>b.area?a:b),n=canonical(main.n),[u,v]=basis(n);
    const ext=bounds(ts.flatMap(t=>t.p),[u,v,n]).map(([a,b])=>b-a);
    thickness.set(id,Math.min(...ext));
  }
  const anchors=new Map();
  for(const c of comps.values()) {
    [c.u,c.v]=basis(c.n);
    const points=c.ts.flatMap(t=>t.p),bb=bounds(points,[c.u,c.v]);c.extent=bb.map(([a,b])=>b-a);
    c.d=dot(c.ts[0].p[0],c.n);
    const boundary=[...c.edges.values()].filter(e=>e.count===1).map(e=>e.p);delete c.edges;
    c.lines=[new Map(),new Map()];
    for(const edge of boundary) {
      const ab=edge.map(p=>[dot(p,c.u),dot(p,c.v)]);
      for(let axis=0;axis<2;axis++) {
        const other=1-axis,lo=Math.floor(Math.min(ab[0][other],ab[1][other])/FINE.BOUNDARY_BIN_M),hi=Math.floor(Math.max(ab[0][other],ab[1][other])/FINE.BOUNDARY_BIN_M);
        if(Math.abs(ab[0][other]-ab[1][other])<1e-9)continue;
        for(let k=lo;k<=hi;k++) {if(!c.lines[axis].has(k))c.lines[axis].set(k,[]);c.lines[axis].get(k).push(ab);}
      }
    }
    c.bb=bounds(points,[[1,0,0],[0,1,0],[0,0,1]]);
    if(Math.min(...c.extent)>=FINE.ANCHOR_MIN_M) {if(!anchors.has(c.b))anchors.set(c.b,[]);anchors.get(c.b).push(c);}
  }
  for(const c of comps.values()) {
    const p=c.ts.reduce((a,t)=>a.map((v,k)=>v+t.c[k]*t.area),[0,0,0]).map(v=>v/c.ts.reduce((a,t)=>a+t.area,0));
    let anchor=c,score=Infinity;
    for(const a of anchors.get(c.b)||[]) {
      if(Math.abs(Math.abs(a.n[1])-Math.abs(c.n[1]))>0.5)continue;
      const dist=Math.abs(dot(p,a.n)-a.d);
      if(dist>FINE.PATCH_DEPTH_M)continue;
      const outside=Math.hypot(...p.map((v,k)=>Math.max(a.bb[k][0]-v,0,v-a.bb[k][1])));
      if(outside>FINE.PATCH_RADIUS_M)continue;
      const s=dist+outside;
      if(s<score) {anchor=a;score=s;}
    }
    for(const t of c.ts) {
      let width=faceWidth(c,t.c),thick=thickness.get(t.solid);
      if(width<FINE.FIN_FACE_MAX_M&&thick>FINE.WELD_M)width=Math.min(width,thick);
      width=Math.max(width,FINE.SIZE_BASE_M);
      for(const id of t.ids) {
        t.rec.sizes[id]+=width*t.area;t.rec.areas[id]+=t.area;
        if(t.area>t.rec.best[id]) {t.rec.best[id]=t.area;t.rec.anchor[id]=anchor;}
      }
    }
  }
  log(`widths: ${comps.size} connected faces, ${solids.size} parts`);
  // Spatial grid includes LARGE triangles in every touched cell, not just their centroids.
  const grid=new Map(),C=FINE.PATCH_RADIUS_M*2;
  const cellKey=(b,x,y,z)=>`${b}:${x},${y},${z}`;
  for(const t of tri) {
    const bb=bounds(t.p,[[1,0,0],[0,1,0],[0,0,1]]).map(([a,b])=>[Math.floor(a/C),Math.floor(b/C)]);
    for(let x=bb[0][0];x<=bb[0][1];x++)for(let y=bb[1][0];y<=bb[1][1];y++)for(let z=bb[2][0];z<=bb[2][1];z++) {const key=cellKey(t.b,x,y,z);if(!grid.has(key))grid.set(key,[]);grid.get(key).push(t);}
  }
  const entries=[],patches=new Map(),unique=new Map();
  function patch(b,p,a) {
    const u=Math.round(dot(p,a.u)/FINE.PATCH_STEP_M)*FINE.PATCH_STEP_M,v=Math.round(dot(p,a.v)/FINE.PATCH_STEP_M)*FINE.PATCH_STEP_M;
    const d=a.d,key=`${b}:${a.n.map(x=>x.toFixed(4))}:${d.toFixed(3)}:${u},${v}`;
    if(patches.has(key))return patches.get(key);
    const axes=[a.u,a.v,a.n],ranges=[[u-FINE.PATCH_RADIUS_M,u+FINE.PATCH_RADIUS_M],[v-FINE.PATCH_RADIUS_M,v+FINE.PATCH_RADIUS_M],[d-FINE.PATCH_DEPTH_M,d+FINE.PATCH_DEPTH_M]];
    const centre=[0,1,2].map(k=>a.u[k]*u+a.v[k]*v+a.n[k]*d);
    const bb=centre.map((x,k)=>{const r=(Math.abs(a.u[k])+Math.abs(a.v[k]))*FINE.PATCH_RADIUS_M+Math.abs(a.n[k])*FINE.PATCH_DEPTH_M;return [Math.floor((x-r)/C),Math.floor((x+r)/C)];}),candidates=new Set();
    for(let x=bb[0][0];x<=bb[0][1];x++)for(let y=bb[1][0];y<=bb[1][1];y++)for(let z=bb[2][0];z<=bb[2][1];z++)for(const t of grid.get(cellKey(b,x,y,z))||[])candidates.add(t);
    const col=[0,0,0],normal=[0,0,0];let sum=0;
    for(const t of candidates) {
      // Keep a roof/ground out of a facade patch and vice versa. Perpendicular fin sides remain in it.
      if(Math.abs(a.n[1])<0.5&&Math.abs(t.n[1])>0.9)continue;
      if(Math.abs(a.n[1])>0.9&&Math.abs(t.n[1])<0.5)continue;
      const w=clippedArea(t,axes,ranges);if(w<1e-10)continue;
      const sign=dot(t.shadeN,a.n)<-0.01?-1:1;
      for(let k=0;k<3;k++) {col[k]+=w*t.col[k];normal[k]+=w*t.shadeN[k]*sign;}sum+=w;
    }
    const n=Math.hypot(...normal)>1e-7?unit(normal):a.n;
    // U16 linear RGB + signed-normal mapped to U16. Table precision is much finer than the palette PNG.
    const values=[...(sum?col.map(v=>v/sum):[0,0,0]),...n.map(v=>v*0.5+0.5)];
    if(values.some(v=>v< -1e-6||v>1+1e-6))throw new Error('fine table value outside U16 range');
    const packed=values.map(v=>Math.round(Math.max(0,Math.min(1,v))*65535)),ekey=packed.join(',');
    let id=unique.get(ekey);
    if(id===undefined) {
      id=entries.length;if(id>=FINE.MAX_PATCHES)throw new Error('fine patch index overflow; increase PATCH_STEP_M');
      entries.push(packed);unique.set(ekey,id);
    }
    patches.set(key,id);return id;
  }
  let vertices=0,filterable=0;
  for(const rec of records) {
    const data=new Uint8Array(rec.P.getCount()*4);
    for(let i=0;i<rec.P.getCount();i++) {
      const b=rec.B.getScalar(i);if(b<0||b>255||b!==Math.floor(b))throw new Error('fine building index exceeds UBYTE');data[i*4]=b;
      const size=rec.areas[i]?rec.sizes[i]/rec.areas[i]:Infinity;
      if(size<FINE.MAX_SIZE_M&&rec.anchor[i]) {
        const id=patch(b,rec.world[i],rec.anchor[i]);
        data[i*4+1]=Math.max(1,Math.min(255,1+Math.ceil(FINE.SIZE_STEPS*Math.log2(size/FINE.SIZE_BASE_M))));
        data[i*4+2]=id&255;data[i*4+3]=id>>8;filterable++;
      }
    }
    rec.prim.setAttribute('_BUILDING',null).setAttribute('_FINE',doc.createAccessor().setType('VEC4').setArray(data).setBuffer(root.listBuffers()[0]));vertices+=rec.P.getCount();
  }
  for(const old of new Set(records.map(r=>r.B)))old.dispose(); // no dead float building stream in the output
  // One table per tile, shared across opaque/glass materials, not repeated in mesh extras.
  const table=Buffer.alloc(entries.length*12);
  entries.forEach((e,i)=>e.forEach((v,k)=>table.writeUInt16LE(v,i*12+k*2)));
  root.setExtras({...root.getExtras(),fine:{version:2,sizeBase:FINE.SIZE_BASE_M,sizeSteps:FINE.SIZE_STEPS,count:entries.length,table:table.toString('base64')}});
  return {vertices,filterable,patches:entries.length,samples:patches.size,tableBytes:entries.length*12,triangles:tri.length};
}
