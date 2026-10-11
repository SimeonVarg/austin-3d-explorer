/* Experimental within-building planar regrouping. NOT an exact transform:
 * separated coplanar surfaces can change LEQUAL ordering. Compare against
 * frozen main before enabling. Plane tolerance is 0.2 mm, never an LOD. */
(function(){
  'use strict';
  // Meshopt's positive quadric floor affects even exactly flat grids. Its
  // 1 cm proposal allowance is separate from the unchanged 0.2 mm plane gate.
  const TUNE={module:'../out/meshopt/node_modules/meshoptimizer/meshopt_simplifier.js',minTriangles:4,targetRatio:.05,proposalErrorM:.01,planeErrorM:.0002,compact:true};
  const stats={done:false,running:false,trianglesBefore:0,trianglesAfter:0,bytesBefore:0,bytesAfter:0,accepted:0,proposalVertices:0,maxLocalVertices:0,maxPlaneDeviationM:0,maxProposalErrorM:0,maxAreaDifference:0,reorderingUnproven:true,refused:{},meshes:[]};
  const source=document.currentScript?.src||new URL('js/mesh-regions.js',location.href).href;
  const refuse=k=>{stats.refused[k]=(stats.refused[k]||0)+1;};
  const list=x=>Array.isArray(x)?x:[x];
  const raw=a=>a.BYTES_PER_ELEMENT===4?new Uint32Array(a.buffer,a.byteOffset,a.length):a.BYTES_PER_ELEMENT===2?new Uint16Array(a.buffer,a.byteOffset,a.length):new Uint8Array(a.buffer,a.byteOffset,a.length);
  const bytes=g=>g.index.array.byteLength+Object.values(g.attributes).reduce((s,a)=>s+a.array.byteLength,0);
  const point=(p,v)=>[p[v*3],p[v*3+1],p[v*3+2]];
  const sub=(a,b)=>a.map((x,i)=>x-b[i]);
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  function trianglePlane(a,b,c,p){
    const o=point(p,a),n=cross(sub(point(p,b),o),sub(point(p,c),o)),length=Math.hypot(...n);
    return length>0&&Number.isFinite(length)?{o,n:n.map(x=>x/length)}:null;
  }
  function attributeKey(a,b,c,attrs){
    let key='';for(const {data,k}of attrs)for(let j=0;j<k;j++){
      const v=data[a*k+j];if(v!==data[b*k+j]||v!==data[c*k+j])return null;key+=v+',';
    }return key;
  }
  function boundary(ix){
    const edges=new Map();for(let i=0;i<ix.length;i+=3)for(let k=0;k<3;k++){
      const a=ix[i+k],b=ix[i+(k+1)%3],key=a<b?a+','+b:b+','+a;
      const sum=(edges.get(key)||0)+(a<b?1:-1);if(sum)edges.set(key,sum);else edges.delete(key);
    }return edges;
  }
  function proof(before,after,p,plane){
    plane??=trianglePlane(before[0],before[1],before[2],p);
    if(!plane)return {bad:'degenerate-plane'};
    const vertices=new Set(before);let maxPlane=0;
    for(const v of after)if(!vertices.has(v))return {bad:'new-vertex'};
    for(const v of vertices)maxPlane=Math.max(maxPlane,Math.abs(dot(plane.n,sub(point(p,v),plane.o))));
    if(maxPlane>TUNE.planeErrorM)return {bad:'plane-tolerance'};
    const a=boundary(before),b=boundary(after);
    if(a.size!==b.size)return {bad:'boundary-changed'};
    for(const [k,v]of a)if(b.get(k)!==v)return {bad:'boundary-changed'};
    let area0=0,area1=0,roundoffScale=0;
    for(const [ix,afterFlag]of [[before,false],[after,true]])for(let i=0;i<ix.length;i+=3){
      const q=point(p,ix[i]),u=sub(point(p,ix[i+1]),q),v=sub(point(p,ix[i+2]),q),area=dot(plane.n,cross(u,v));
      if(!(area>0))return {bad:'orientation-or-degenerate'};
      roundoffScale+=Math.hypot(...u)*Math.hypot(...v);
      if(afterFlag)area1+=area;else area0+=area;
    }
    // Identical directed boundaries imply identical projected signed area.
    // This accepts only summation roundoff, not a geometric area allowance.
    const areaDifference=Math.abs(area0-area1),areaBound=64*Number.EPSILON*(before.length+after.length)*roundoffScale;
    if(areaDifference>areaBound)return {bad:'projected-area-changed'};
    return {maxPlane,areaDifference,areaBound};
  }
  function simplifyRange(ix,p,attrs,opt){
    const groups=new Map(),parts=[];
    for(let i=0;i<ix.length;i+=3){
      const a=ix[i],b=ix[i+1],c=ix[i+2],key=attributeKey(a,b,c,attrs),plane=trianglePlane(a,b,c,p);
      if(key===null||!plane){parts.push([a,b,c]);continue;}
      let planes=groups.get(key);if(!planes){planes=[];groups.set(key,planes);}
      // A list of actual planes avoids origin-dependent quantization errors.
      let part=planes.find(part=>dot(part.plane.n,plane.n)>.999999&&[a,b,c].every(v=>Math.abs(dot(part.plane.n,sub(point(p,v),part.plane.o)))<=TUNE.planeErrorM));
      if(!part){part=[];part.plane=plane;planes.push(part);parts.push(part);}
      part.push(a,b,c);
    }
    let count=0,accepted=0;
    for(let i=0;i<parts.length;i++){
      const part=parts[i];if(part.length<TUNE.minTriangles*3||!part.plane){count+=part.length;continue;}
      const before=Uint32Array.from(part);let out,error;
      // Sparse only affects the native algorithm: the JS wrapper still copies
      // its whole positions argument into WASM. Supply this region alone.
      const localIds=[],localMap=new Map(),localIndex=new Uint32Array(before.length);
      for(let j=0;j<before.length;j++){
        const v=before[j];let id=localMap.get(v);
        if(id===undefined){id=localIds.length;localIds.push(v);localMap.set(v,id);}
        localIndex[j]=id;
      }
      const localPositions=new Float32Array(localIds.length*3);
      for(let j=0;j<localIds.length;j++)for(let k=0;k<3;k++)localPositions[j*3+k]=p[localIds[j]*3+k];
      stats.proposalVertices+=localIds.length;stats.maxLocalVertices=Math.max(stats.maxLocalVertices,localIds.length);
      try{
        [out,error]=opt.simplify(localIndex,localPositions,3,Math.max(3,Math.floor(before.length*TUNE.targetRatio/3)*3),TUNE.proposalErrorM,['LockBorder','ErrorAbsolute','Sparse']);
        out=Uint32Array.from(out,v=>localIds[v]);
      }
      catch(e){refuse('simplifier-error');count+=part.length;continue;}
      if(!Number.isFinite(error)||error>TUNE.proposalErrorM){refuse('proposal-error');count+=part.length;continue;}
      if(out.length>=before.length){count+=part.length;continue;}
      const result=proof(before,out,p,part.plane);
      if(result.bad){refuse(result.bad);count+=part.length;continue;}
      parts[i]=out;count+=out.length;accepted++;stats.accepted++;
      stats.maxPlaneDeviationM=Math.max(stats.maxPlaneDeviationM,result.maxPlane);
      stats.maxProposalErrorM=Math.max(stats.maxProposalErrorM,error);
      stats.maxAreaDifference=Math.max(stats.maxAreaDifference,result.areaDifference);
    }
    // No useful reduction means no reordering at all for this building/range.
    if(!accepted)return Uint32Array.from(ix);
    const out=new Uint32Array(count);let at=0;for(const part of parts){out.set(part,at);at+=part.length;}return out;
  }
  function compact(g,ix,T){
    const n=g.attributes.position.count,remap=new Uint32Array(n),used=new Uint32Array(n);let count=0;
    for(const v of ix)if(remap[v]===0){used[count]=v;remap[v]=++count;}
    const index=count<=65535?new Uint16Array(ix.length):new Uint32Array(ix.length);
    for(let i=0;i<ix.length;i++)index[i]=remap[ix[i]]-1;
    const attributes={};for(const [name,a]of Object.entries(g.attributes)){
      const array=new a.array.constructor(count*a.itemSize),src=raw(a.array),dst=raw(array);
      for(let v=0;v<count;v++)for(let k=0;k<a.itemSize;k++)dst[v*a.itemSize+k]=src[used[v]*a.itemSize+k];
      const b=a.isFloat16BufferAttribute?new T.Float16BufferAttribute(array,a.itemSize):new T.BufferAttribute(array,a.itemSize,a.normalized);
      b.name=a.name;b.setUsage(a.usage);b.gpuType=a.gpuType;attributes[name]=b;
    }
    return {index,attributes,vertices:count};
  }
  let pending;
  async function apply(){
    const S=window.slopes,T=window.THREE;if(!S?.root||!T)throw new Error('scene-not-ready');
    stats.running=true;const start=performance.now();
    try{
      const {MeshoptSimplifier:opt}=await import(new URL(TUNE.module,source).href);await opt.ready;
      if(!opt.supported)throw new Error('simplifier-unavailable');
      const meshes=[];S.root.traverse(m=>{if(m.isMesh)meshes.push(m);});
      const counts=new Map();for(const m of meshes)counts.set(m.geometry,(counts.get(m.geometry)||0)+1);
      for(const m of meshes){
        const g=m.geometry,row={name:m.parent?.name+'/'+m.name,before:g.index?.count/3||0,after:g.index?.count/3||0,beforeBytes:0,afterBytes:0};
        stats.trianglesBefore+=row.before;
        try{
          if(counts.get(g)!==1||m.isInstancedMesh||m.isSkinnedMesh)throw new Error('shared-or-deformed-geometry');
          if(!(g.attributes.position?.array instanceof Float32Array)||g.attributes.position.itemSize!==3||!g.index)throw new Error('unsupported-position');
          if(Object.keys(g.morphAttributes||{}).length||g.drawRange.start!==0||g.drawRange.count!==Infinity)throw new Error('morph-or-draw-range');
          if(list(m.material).some(mat=>!mat?.isShaderMaterial||mat.transparent||/\bgl_VertexID\b/.test(mat.vertexShader)))throw new Error('unsupported-material');
          row.beforeBytes=row.afterBytes=bytes(g);
          const attrs=Object.entries(g.attributes).filter(([key])=>key!=='position').map(([name,a])=>{
            if(!a.isBufferAttribute||a.isInterleavedBufferAttribute||a.isInstancedBufferAttribute||a.count!==g.attributes.position.count||a.array.BYTES_PER_ELEMENT>4)throw new Error('unsupported-attribute:'+name);
            return {data:raw(a.array),k:a.itemSize};
          });
          const c=m.userData.cull;
          if(c&&list(m.material).length!==1)throw new Error('multi-material-cull-range');
          const ranges=c?c.start.map((at,i)=>({start:at,count:c.count[i],materialIndex:0})):g.groups.length?g.groups.map(r=>({...r})):[{start:0,count:g.index.count,materialIndex:0}];
          const parts=[],offsets=[];let end=0,total=0;
          for(const r of ranges){
            if(r.start!==end||r.count%3)throw new Error('nonpartitioned-ranges');end=r.start+r.count;
            const part=simplifyRange(g.index.array.subarray(r.start,end),g.attributes.position.array,attrs,opt);offsets.push(total);parts.push(part);total+=part.length;
          }
          if(end!==g.index.count)throw new Error('incomplete-ranges');
          if(total===g.index.count){row.skipped='no-accepted-reduction';}
          else{
            const index=new Uint32Array(total);for(let i=0;i<parts.length;i++)index.set(parts[i],offsets[i]);
            const next=TUNE.compact?compact(g,index,T):{index,attributes:g.attributes,vertices:g.attributes.position.count};
            const cleanup=g._listeners?.dispose?.find(fn=>fn.name==='onGeometryDispose'||/releaseStatesOfGeometry/.test(String(fn)));
            if(!cleanup)throw new Error('gpu-cleanup-hook-unavailable');
            cleanup.call(g,{type:'dispose',target:g});
            for(const [name,a]of Object.entries(next.attributes))g.setAttribute(name,a);
            g.setIndex(new T.BufferAttribute(next.index,1));g.clearGroups();
            if(c){c.start=offsets;c.count=parts.map(p=>p.length);c.total=total;c.pool=[];g.addGroup(0,total,0);}
            else if(ranges.length>1||list(m.material).length>1)for(let i=0;i<ranges.length;i++)g.addGroup(offsets[i],parts[i].length,ranges[i].materialIndex);
            row.after=total/3;row.afterBytes=bytes(g);row.vertices=next.vertices;row.reordered=true;
          }
        }catch(e){row.skipped=String(e.message||e);refuse(row.skipped);}
        stats.trianglesAfter+=row.after;stats.bytesBefore+=row.beforeBytes;stats.bytesAfter+=row.afterBytes;stats.meshes.push(row);
        await new Promise(resolve=>setTimeout(resolve,0));
      }
      stats.ms=performance.now()-start;stats.done=true;window.__map?.triggerRepaint?.();return stats;
    }finally{stats.running=false;}
  }
  window.MeshRegions={TUNE,stats,apply(){return pending||(pending=apply());},proof};
})();
