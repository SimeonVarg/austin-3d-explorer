/* Experimental exact post-build storage compaction. No scene/triangle changes.
 * Cold-page switch: load this file, then await MeshCompact.apply(). */
(function () {
  'use strict';
  const TUNE = { minVertices: 256, pack: true };
  const stats = { running: false, done: false, beforeBytes: 0, afterBytes: 0,
    savedBytes: 0, verticesBefore: 0, verticesAfter: 0, triangles: 0, meshes: [], failures: [] };
  let pending;
  const list = m => Array.isArray(m) ? m : [m];
  const bytes = g => Object.values(g.attributes).reduce((n,a)=>n+a.array.byteLength,0)+(g.index?.array.byteLength||0);
  const bits = a => a.BYTES_PER_ELEMENT === 4 ? new Uint32Array(a.buffer,a.byteOffset,a.length)
    : a.BYTES_PER_ELEMENT === 2 ? new Uint16Array(a.buffer,a.byteOffset,a.length)
    : a.BYTES_PER_ELEMENT === 1 ? new Uint8Array(a.buffer,a.byteOffset,a.length) : null;
  function supported(g) {
    const n=g.attributes.position?.count;
    if (!n || !g.index || g.morphAttributes && Object.keys(g.morphAttributes).length) return 'unindexed-or-morph';
    for (const a of Object.values(g.attributes)) if (!a.isBufferAttribute || a.isInterleavedBufferAttribute
      || a.isInstancedBufferAttribute || a.count!==n || !ArrayBuffer.isView(a.array)
      || !bits(a.array) || a.usage!==THREE.StaticDrawUsage) return 'unsupported-attribute';
    return null;
  }
  let byteMap;
  function conversion(S) {
    if (byteMap) return byteMap;
    const t=S.packTables(); if(!t)throw new Error('packed-layout-unavailable');
    byteMap=new Float32Array(256);
    for(let i=0;i<256;i++){
      const h='#'+i.toString(16).padStart(2,'0').repeat(3), id=t.tone([h,h,h]);
      byteMap[i]=t.tones[id*16];
    }
    return byteMap;
  }
  function colorValue(a,i,bf) {
    if(a.array instanceof Uint8Array && a.normalized)return bf[a.array[i]];
    if(a.array instanceof Float32Array && !a.normalized)return a.array[i];
    throw new Error('unsupported-colour-type');
  }
  function packedAttributes(g,S) {
    const a=g.attributes,n=a.position.count;
    if(a.aPack)return null;
    if(!(a.normal?.array instanceof Float32Array) || a.normal.normalized || a.normal.itemSize!==3
      || !(a.aSurface?.array instanceof Float32Array) || a.aSurface.normalized || a.aSurface.itemSize!==4
      || !a.aFacet || a.aFacet.itemSize!==1 || a.aFacet.normalized)throw new Error('unsupported-pack-layout');
    for(const k of ['cDay','cGold','cNight']) if(!a[k] || a[k].itemSize!==3
      || !(a[k].array instanceof Uint8Array && a[k].normalized || a[k].array instanceof Float32Array && !a[k].normalized))throw new Error('unsupported-colour-type');
    const tables=S.packTables();if(!tables)throw new Error('packed-layout-unavailable');
    const bf=conversion(S), max=2**S.packInfo().toneBits, words=new Uint16Array(n*2);
    const f=new Float32Array(16), u=new Uint32Array(f.buffer), tones=new Map();
    for(let v=0;v<n;v++) {
      for(let c=0;c<3;c++)for(let j=0;j<3;j++)f[c*4+j]=colorValue(a[['cDay','cGold','cNight'][c]],v*3+j,bf);
      for(let j=0;j<4;j++)f[12+j]=a.aSurface.array[v*4+j];
      // Bit keys preserve -0, exact Float32 values, and all surface fields.
      const key=Array.from(u).join(',');let id=tones.get(key);
      if(id===undefined){
        id=tables.nTones++;if(id>=max)throw new Error('tone-table-overflow');
        if((id+1)*16>tables.tones.length){const next=new Float32Array(tables.tones.length*2);next.set(tables.tones);tables.tones=next;}
        tables.tones.set(f,id*16);tones.set(key,id);
      }
      const facet=a.aFacet.array[v];if(facet!==0&&facet!==1)throw new Error('nonbinary-facet');
      const normal=tables.normal(a.normal.array[v*3],a.normal.array[v*3+1],a.normal.array[v*3+2]);
      words[v*2]=tables.wordLo(id,facet,normal);words[v*2+1]=tables.wordHi(normal);
    }
    const attrs={...a,aPack:new THREE.BufferAttribute(words,2,false)};
    for(const k of ['normal','cDay','cGold','cNight','aFacet','aSurface'])delete attrs[k];
    return { attrs,tables };
  }
  function compact(g,attrs) {
    const T=THREE,n=attrs.position.count,entries=Object.entries(attrs);
    const keys=entries.map(([,a])=>({a,b:bits(a.array),k:a.itemSize}));
    let size=1;while(size<n*2)size*=2;
    const hash=new Int32Array(size),remap=new Uint32Array(n),unique=new Uint32Array(n);let used=0;
    const equal=(v,w)=>{for(const {b,k}of keys)for(let j=0;j<k;j++)if(b[v*k+j]!==b[w*k+j])return false;return true;};
    for(let v=0;v<n;v++){
      let h=2166136261;
      for(const {b,k}of keys)for(let j=0;j<k;j++)h=Math.imul(h^b[v*k+j],16777619);
      let slot=(h^(h>>>16))&(size-1);
      while(hash[slot] && !equal(v,unique[hash[slot]-1]))slot=(slot+1)&(size-1);
      if(!hash[slot]){unique[used]=v;hash[slot]=++used;}
      remap[v]=hash[slot]-1;
    }
    const out=new T.BufferGeometry();
    for(const [name,a]of entries){
      const data=new a.array.constructor(used*a.itemSize);
      // Copy bytes, not float assignments: preserve NaN payloads and -0.
      const src=bits(a.array),dst=bits(data);
      for(let v=0;v<used;v++)for(let j=0;j<a.itemSize;j++)dst[v*a.itemSize+j]=src[unique[v]*a.itemSize+j];
      const attr=a.isFloat16BufferAttribute?new T.Float16BufferAttribute(data,a.itemSize):new T.BufferAttribute(data,a.itemSize,a.normalized);
      attr.name=a.name;attr.setUsage(a.usage);attr.gpuType=a.gpuType;out.setAttribute(name,attr);
    }
    const ix=used<=65535?new Uint16Array(g.index.count):new Uint32Array(g.index.count);
    for(let i=0;i<ix.length;i++)ix[i]=remap[g.index.array[i]];
    out.setIndex(new T.BufferAttribute(ix,1));
    for(const r of g.groups)out.addGroup(r.start,r.count,r.materialIndex);
    out.setDrawRange(g.drawRange.start,g.drawRange.count);
    out.boundingBox=g.boundingBox?.clone()||null;out.boundingSphere=g.boundingSphere?.clone()||null;
    out.name=g.name;out.userData={...g.userData};
    // Every index still addresses the exact input attribute tuple. This gate
    // checks ALL corners and attributes, not sampled positions alone.
    for(const [name,a]of entries){
      const src=bits(a.array),dst=bits(out.attributes[name].array),k=a.itemSize;
      for(let i=0;i<ix.length;i++)for(let j=0;j<k;j++)if(src[g.index.array[i]*k+j]!==dst[ix[i]*k+j])throw new Error('corner-parity:'+name);
    }
    return out;
  }
  async function apply() {
    const S=window.slopes,T=window.THREE;
    if(!S?.root || !T)throw new Error('scene-not-ready');
    stats.running=true;const start=performance.now(),template=S.material(), groups=new Map(),oldMaterials=new Set();
    S.root.traverse(m=>{if(m.isMesh&&m.geometry){if(!groups.has(m.geometry))groups.set(m.geometry,[]);groups.get(m.geometry).push(m);}});
    try {
      for(const [g,meshes]of groups){
        const row={name:meshes.map(m=>m.parent?.name+'/'+m.name).join('|'),before:bytes(g),after:bytes(g),vertices:g.attributes.position?.count||0};
        stats.beforeBytes+=row.before;stats.verticesBefore+=row.vertices;
        let out,pm;
        try {
          const reason=supported(g);if(reason)throw new Error(reason);
          if(row.vertices<TUNE.minVertices)throw new Error('small-mesh');
          if(meshes.some(m=>list(m.material).some(mat=>/\bgl_VertexID\b/.test(mat?.vertexShader||''))))throw new Error('vertex-id-dependent-shader');
          let packed=null;
          const standard=meshes.every(m=>list(m.material).every(mat=>mat?.isShaderMaterial
            && mat.vertexShader===template.vertexShader && mat.fragmentShader===template.fragmentShader && !mat.defines?.PACKED_TONES));
          if(TUNE.pack && !g.attributes.aPack && standard){
            try {packed=packedAttributes(g,S);}catch(e){row.packSkipped=String(e.message||e);}
          } else if(!g.attributes.aPack)row.packSkipped='custom-material';
          out=compact(g,packed?.attrs||g.attributes);
          let extra=0;
          if(packed){
            pm=S.material({pack:packed.tables});
            extra=packed.tables.tex.tones.image.data.byteLength+packed.tables.tex.normals.image.data.byteLength;
          }
          const after=bytes(out)+extra;
          if(after>=row.before){out.dispose();pm?.dispose();out=pm=null;throw new Error('no-byte-saving');}
          const replacement=new Map();
          for(const m of meshes){
            if(packed){
              const swap=mat=>{
                if(replacement.has(mat))return replacement.get(mat);
                const next=mat.clone();next.uniforms={...mat.uniforms,u_packTones:pm.uniforms.u_packTones,u_packNormals:pm.uniforms.u_packNormals};
                next.defines={...mat.defines,...pm.defines};next.defaultAttributeValues={...mat.defaultAttributeValues};
                next.onBeforeCompile=mat.onBeforeCompile;next.customProgramCacheKey=mat.customProgramCacheKey;next.needsUpdate=true;
                replacement.set(mat,next);oldMaterials.add(mat);return next;
              };
              m.material=Array.isArray(m.material)?m.material.map(swap):swap(m.material);
            }
            m.geometry=out;
          }
          if(packed){
            out.userData.pack=packed.tables;
            out.addEventListener('dispose',()=>pm.dispose());
            // Only table data required by restoration remains; hashing maps
            // and overallocated CPU staging are not needed after conversion.
            packed.tables.tones=new Float32Array(0);packed.tables.normals=new Float32Array(0);packed.tables.nbits=null;
            packed.tables.hash=new Int32Array(0);packed.tables.toneOf.clear();packed.tables.toneByObject=new WeakMap();
          }
          row.after=after;row.verticesAfter=out.attributes.position.count;row.packed=!!packed;row.indexBytes=out.index.array.BYTES_PER_ELEMENT;
          row.cornerParity=true;row.triangles=out.index.count/3;stats.triangles+=row.triangles;
          // Culling belongs to the mesh lifecycle, not the replaced GPU store.
          // Transfer only that known listener; Three/GeometryMemory still free
          // the old GPU buffers. Unknown callbacks are left intact.
          for(const fn of [...(g._listeners?.dispose||[])])if(String(fn).includes('_cullMeshes.delete(mesh)')){
            g.removeEventListener('dispose',fn);out.addEventListener('dispose',fn);
          }
          g.dispose();
        }catch(e){row.skipped=String(e.message||e);if(out&&meshes[0].geometry!==out){out.dispose();pm?.dispose();} }
        stats.afterBytes+=row.after;stats.verticesAfter+=row.verticesAfter||row.vertices;stats.meshes.push(row);
        await new Promise(resolve=>setTimeout(resolve,0));
      }
      const live=new Set();S.root.traverse(m=>{if(m.isMesh)for(const mat of list(m.material))live.add(mat);});
      for(const mat of oldMaterials)if(!live.has(mat))mat.dispose();
      // Disposal closures share this invocation's lexical context. Empty staging
      // collections explicitly so they cannot retain the replaced geometries.
      groups.clear();oldMaterials.clear();
      window.GpuMemory?.track(S.root);
      stats.savedBytes=stats.beforeBytes-stats.afterBytes;stats.ms=performance.now()-start;stats.done=true;
      window.map?.triggerRepaint?.();return stats;
    } finally {template.dispose();stats.running=false;}
  }
  window.MeshCompact={TUNE,stats,apply(){return pending||(pending=apply());}};
})();
