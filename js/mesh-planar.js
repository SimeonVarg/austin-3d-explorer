/* Experimental exact planar cleanup. Meshoptimizer proposes; exact dyadic
 * plane, orientation and directed-boundary checks decide. No appearance LOD. */
(function(){
  'use strict';
  const TUNE={module:'../out/meshopt/node_modules/meshoptimizer/meshopt_simplifier.js',minTriangles:16,targetRatio:.05,proposalErrorM:.01};
  const stats={done:false,running:false,trianglesBefore:0,trianglesAfter:0,indexBytesSaved:0,accepted:0,refused:{},meshes:[]};
  const refuse=k=>{stats.refused[k]=(stats.refused[k]||0)+1;};
  const list=x=>Array.isArray(x)?x:[x];
  const source=document.currentScript?.src||new URL('js/mesh-planar.js',location.href).href;
  const raw=a=>a.BYTES_PER_ELEMENT===4?new Uint32Array(a.buffer,a.byteOffset,a.length):a.BYTES_PER_ELEMENT===2?new Uint16Array(a.buffer,a.byteOffset,a.length):new Uint8Array(a.buffer,a.byteOffset,a.length);
  // Float32 is an integer multiple of 2^-149. No tolerance or approximate
  // zero is used by this representation or the acceptance proof below.
  function integer(b){const e=(b>>>23)&255;if(e===255)throw new Error('nonfinite-position');const m=BigInt((b&8388607)|(e?8388608:0));return (b>>>31?-m:m)<<BigInt(e?e-1:0);}
  const sub=(a,b)=>a.map((v,i)=>v-b[i]);
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  function boundary(ix){const e=new Map();for(let i=0;i<ix.length;i+=3)for(let k=0;k<3;k++){
    const a=ix[i+k],b=ix[i+(k+1)%3],key=a<b?a+','+b:b+','+a,d=a<b?1:-1;
    const n=(e.get(key)||0)+d;if(n)e.set(key,n);else e.delete(key);
  }return e;}
  function sameBoundary(a,b){const x=boundary(a),y=boundary(b);if(x.size!==y.size)return false;for(const[k,v]of x)if(y.get(k)!==v)return false;return true;}
  function proof(before,after,p){
    const pb=raw(p),cache=new Map(),point=v=>{let q=cache.get(v);if(!q){q=[integer(pb[v*3]),integer(pb[v*3+1]),integer(pb[v*3+2])];cache.set(v,q);}return q;};
    const o=point(before[0]),n=cross(sub(point(before[1]),o),sub(point(before[2]),o));
    if(n.every(x=>x===0n))return 'degenerate-plane';
    const vertices=new Set(before);for(const v of after)if(!vertices.has(v))return 'new-vertex';
    for(const v of vertices)if(dot(n,sub(point(v),o))!==0n)return 'not-exactly-coplanar';
    let area0=0n,area1=0n;
    for(const [ix,which]of [[before,0],[after,1]])for(let i=0;i<ix.length;i+=3){
      const a=point(ix[i]),b=point(ix[i+1]),c=point(ix[i+2]),area=dot(n,cross(sub(b,a),sub(c,a)));
      if(area<=0n)return 'orientation-or-degenerate';if(which)area1+=area;else area0+=area;
    }
    if(area0!==area1)return 'area-changed';
    if(!sameBoundary(before,after))return 'boundary-changed';
    return null;
  }
  function patchKey(a,b,c,p,attrs){
    let key='';for(const {data,k}of attrs)for(let j=0;j<k;j++){
      const v=data[a*k+j];if(v!==data[b*k+j]||v!==data[c*k+j])return null;key+=v+',';
    }
    const u=[p[b*3]-p[a*3],p[b*3+1]-p[a*3+1],p[b*3+2]-p[a*3+2]],v=[p[c*3]-p[a*3],p[c*3+1]-p[a*3+1],p[c*3+2]-p[a*3+2]];
    const n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],s=Math.hypot(...n);
    if(!s)return null;for(let i=0;i<3;i++)n[i]/=s;
    const d=n[0]*p[a*3]+n[1]*p[a*3+1]+n[2]*p[a*3+2];
    // Coarse bucketing proposes possible planes only. Exact proof rejects
    // buckets containing even one noncoplanar Float32 vertex.
    return key+'|'+n.map(x=>x.toFixed(5)).join(',')+'|'+d.toFixed(2);
  }
  function ranges(m,g){
    const c=m.userData.cull;if(c)return c.start.map((s,i)=>({start:s,count:c.count[i],materialIndex:0,cull:i}));
    return g.groups.length?g.groups.map(x=>({...x})):[{start:0,count:g.index.count,materialIndex:0}];
  }
  function simplifyRange(ix,p,attrs,opt){
    const parts=[];let lastKey=null,lastPart=null;
    for(let i=0;i<ix.length;i+=3){
      const a=ix[i],b=ix[i+1],c=ix[i+2],key=patchKey(a,b,c,p,attrs);
      if(key===null){parts.push([a,b,c]);lastKey=lastPart=null;continue;}
      // Contiguous runs only: regrouping separated material patches could
      // reorder coplanar overlaps and change LEQUAL visibility.
      if(key!==lastKey){lastPart=[];parts.push(lastPart);lastKey=key;}
      lastPart.push(a,b,c);
    }
    let count=0;
    for(let i=0;i<parts.length;i++){
      const part=parts[i];if(part.length<TUNE.minTriangles*3){count+=part.length;continue;}
      const before=Uint32Array.from(part);
      let candidate;
      // Meshopt's quadrics report small positive error even for a perfectly
      // planar grid. The nonzero proposal allowance is NOT acceptance: exact
      // plane/orientation/area/boundary equality below has zero tolerance.
      try {const [out,error]=opt.simplify(before,p,3,Math.floor(before.length*TUNE.targetRatio/3)*3,TUNE.proposalErrorM,['LockBorder','ErrorAbsolute','Sparse']);
        if(!Number.isFinite(error)||error>TUNE.proposalErrorM){refuse('proposal-error');count+=part.length;continue;}candidate=out;
      }catch(e){refuse('simplifier-error');count+=part.length;continue;}
      if(candidate.length>=before.length){count+=part.length;continue;}
      const bad=proof(before,candidate,p);
      if(bad){refuse(bad);count+=part.length;continue;}
      parts[i]=candidate;count+=candidate.length;stats.accepted++;
    }
    const out=new Uint32Array(count);let at=0;for(const part of parts){out.set(part,at);at+=part.length;}return out;
  }
  let pending;
  async function apply(){
    const S=window.slopes,T=window.THREE;if(!S?.root||!T)throw new Error('scene-not-ready');
    stats.running=true;const t=performance.now();
    try {
      const {MeshoptSimplifier:opt}=await import(new URL(TUNE.module,source).href);await opt.ready;
      if(!opt.supported)throw new Error('simplifier-unavailable');
      const meshes=[];S.root.traverse(m=>{if(m.isMesh)meshes.push(m);});
      const counts=new Map();for(const m of meshes)counts.set(m.geometry,(counts.get(m.geometry)||0)+1);
      for(const m of meshes){
        const g=m.geometry,row={name:m.parent?.name+'/'+m.name,before:g.index?.count/3||0,after:g.index?.count/3||0};stats.trianglesBefore+=row.before;
        try {
          if(counts.get(g)!==1)throw new Error('shared-geometry');
          if(!(g.attributes.position?.array instanceof Float32Array)||g.attributes.position.itemSize!==3||!g.index)throw new Error('unsupported-position');
          if(Object.keys(g.morphAttributes||{}).length||g.drawRange.start!==0||g.drawRange.count!==Infinity)throw new Error('morph-or-draw-range');
          if(list(m.material).some(mat=>!mat?.isShaderMaterial||mat.transparent||/\bgl_VertexID\b/.test(mat.vertexShader)))throw new Error('unsupported-material');
          const attrs=Object.entries(g.attributes).filter(([k])=>k!=='position').map(([name,a])=>{
            if(!a.isBufferAttribute||a.isInterleavedBufferAttribute||a.count!==g.attributes.position.count||a.array.BYTES_PER_ELEMENT>4)throw new Error('unsupported-attribute:'+name);
            return {data:raw(a.array),k:a.itemSize};
          });
          const rs=ranges(m,g),parts=[];let beforeEnd=0,total=0;
          for(const r of rs){if(r.start!==beforeEnd||r.count%3)throw new Error('nonpartitioned-ranges');beforeEnd=r.start+r.count;
            const out=simplifyRange(g.index.array.subarray(r.start,r.start+r.count),g.attributes.position.array,attrs,opt);parts.push(out);total+=out.length;}
          if(beforeEnd!==g.index.count)throw new Error('incomplete-ranges');
          if(total===g.index.count){row.skipped='no-proved-reduction';stats.meshes.push(row);stats.trianglesAfter+=row.after;continue;}
          const ix=new g.index.array.constructor(total);let at=0;const offsets=[];
          for(const out of parts){offsets.push(at);ix.set(out,at);at+=out.length;}
          // Keep geometry identity and ALL lifecycle/culling listeners. Only
          // Three's audited GPU-buffer cleanup runs before index replacement.
          const cleanup=g._listeners?.dispose?.find(fn=>fn.name==='onGeometryDispose'||/releaseStatesOfGeometry/.test(String(fn)));
          if(!cleanup)throw new Error('gpu-cleanup-hook-unavailable');
          cleanup.call(g,{type:'dispose',target:g});
          const oldBytes=g.index.array.byteLength;g.setIndex(new T.BufferAttribute(ix,1));g.clearGroups();
          if(m.userData.cull){const c=m.userData.cull;c.start=offsets;c.count=parts.map(x=>x.length);c.total=total;c.pool=[];g.addGroup(0,total,0);}
          else if(rs.length>1||list(m.material).length>1)for(let i=0;i<rs.length;i++)g.addGroup(offsets[i],parts[i].length,rs[i].materialIndex);
          row.after=total/3;row.exactPlaneBoundaryArea=true;row.indexBytesSaved=oldBytes-ix.byteLength;stats.indexBytesSaved+=row.indexBytesSaved;
        }catch(e){row.skipped=String(e.message||e);refuse(row.skipped);}
        stats.trianglesAfter+=row.after;stats.meshes.push(row);await new Promise(resolve=>setTimeout(resolve,0));
      }
      stats.ms=performance.now()-t;stats.done=true;window.__map?.triggerRepaint?.();return stats;
    }finally{stats.running=false;}
  }
  window.MeshPlanar={TUNE,stats,apply(){return pending||(pending=apply());},proof};
})();
