/** Optional, static enclosure shading. No runtime ray tracing or extra GPU buffer.
 * Integration contract: attach before publishing a newly built mesh; dispose the
 * returned lease before rebuilding it. Missing/stale assets leave the city intact.
 * Deliberately independent of the building generator and Three.js version. */
(function (root) {
  'use strict';
  const VERSION = 1;
  const DEFAULTS = Object.freeze({strength: .8, timeoutMs: 2000, maxVertices: 200000, maxPayloadBytes: 200000});
  const owners = new WeakMap();
  const check = (ok, message) => { if (!ok) throw new Error('Enclosure: ' + message); };
  const hex = buffer => Array.from(new Uint8Array(buffer), n => n.toString(16).padStart(2,'0')).join('');
  async function sha256(bytes) {
    return hex(await root.crypto.subtle.digest('SHA-256', bytes));
  }
  // Explicit little endian floats, with JSON's -0/+0 difference canonicalized.
  function floats(array, start, end) {
    const bytes = new Uint8Array((end-start)*4), view = new DataView(bytes.buffer);
    for(let i=start;i<end;i++) {
      check(Number.isFinite(array[i]), 'nonfinite geometry');
      view.setFloat32((i-start)*4, array[i] === 0 ? 0 : array[i], true);
    }
    return bytes;
  }
  async function fingerprint(geometry, range, limits=DEFAULTS) {
    const index = geometry.index?.array, attrs = geometry.attributes;
    check(index && attrs?.position && attrs?.normal && attrs?.aSurface && attrs?.aFacet, 'missing attributes');
    check(Number.isSafeInteger(range.start) && Number.isSafeInteger(range.end) && range.start>=0 && range.end>range.start && range.end*3<=index.length, 'triangle range');
    let lo=Infinity, hi=-1;
    for(let i=range.start*3;i<range.end*3;i++) {lo=Math.min(lo,index[i]);hi=Math.max(hi,index[i]);}
    const vertices=hi-lo+1;
    check(vertices<=limits.maxVertices && hi<attrs.position.count, 'vertex range/limit');
    const rebased=new Uint8Array((range.end-range.start)*12), view=new DataView(rebased.buffer);
    for(let i=range.start*3;i<range.end*3;i++)view.setUint32((i-range.start*3)*4,index[i]-lo,true);
    const hashes={index:await sha256(rebased)};
    for(const [name,size] of [['position',3],['normal',3],['aSurface',4]]) {
      const a=attrs[name];
      check(a.itemSize===size && a.count>hi && a.array instanceof Float32Array && !a.normalized, 'attribute format '+name);
      hashes[name]=await sha256(floats(a.array,lo*size,(hi+1)*size));
    }
    const facet=attrs.aFacet;
    check(facet.array instanceof Uint8Array && !facet.normalized && facet.itemSize===1 && facet.count>hi, 'facet format');
    const base=facet.array.slice(lo,hi+1);
    for(const value of base)check(value===0 || value===1,'already packed or unsupported facet');
    hashes.facet=await sha256(base);
    return {lo,hi,vertices,triangles:range.end-range.start,hashes};
  }
  function replaceOnce(text, from, to) {
    check(text.split(from).length===2, 'shader contract changed: '+from.slice(0,50));
    return text.replace(from,to);
  }
  function shaders(vertex,fragment) {
    vertex=replaceOnce(vertex,'attribute float aFacet;','attribute float aFacet;\nvarying float v_bakedOcclusion;');
    vertex=replaceOnce(vertex,'aFacet > 0.5','mod(aFacet,2.0) > 0.5');
    vertex=replaceOnce(vertex,'v_albedo = cDay;','v_bakedOcclusion=floor(aFacet*.5)/127.0;\nv_albedo = cDay;');
    fragment=replaceOnce(fragment,'varying vec3 v_albedo;','varying vec3 v_albedo;\nvarying float v_bakedOcclusion; uniform float u_bakedDepth;');
    fragment=replaceOnce(fragment,'vec3 cityShade(vec3 original,vec3 albedo,vec3 pos,vec3 normal,float glass)',
      'vec3 cityShadeOccluded(vec3 original,vec3 albedo,vec3 pos,vec3 normal,float glass,float occlusion)');
    fragment=replaceOnce(fragment,'linearColour(u_shadeColour)*(u_sunlight.y+skyFill)',
      'linearColour(u_shadeColour)*(u_sunlight.y+skyFill)*(1.0-occlusion)');
    fragment=replaceOnce(fragment,'cityShade(col/max(baseColor.a,.0001),albedo,v_pos,v_normal,glassResponse)',
      'cityShadeOccluded(col/max(baseColor.a,.0001),albedo,v_pos,v_normal,glassResponse,v_bakedOcclusion*u_bakedDepth)');
    return {vertex,fragment};
  }
  function validateManifest(manifest, limits) {
    check(manifest?.version===VERSION && manifest.encoding==='facet-low-bit-occlusion-7bit', 'asset version');
    check(Array.isArray(manifest.targets) && manifest.targets.length>0 && manifest.targets.length<=32, 'target limit');
    const names=new Set();let end=0;
    for(const t of manifest.targets) {
      check(typeof t.id==='string' && !names.has(t.id), 'duplicate/missing identity');names.add(t.id);
      check(Number.isSafeInteger(t.vertices) && t.vertices>0 && t.vertices<=limits.maxVertices, 'vertex count');
      check(t.offset===end && t.bytes===t.vertices, 'payload layout');end+=t.bytes;
      check(typeof t.sha256==='string' && /^[a-f0-9]{64}$/.test(t.sha256), 'payload digest');
    }
    check(end<=limits.maxPayloadBytes && manifest.bytes===end, 'payload size/limit');
    return end;
  }
  async function prepare(geometry,ranges,manifest,payload,limits=DEFAULTS) {
    const size=validateManifest(manifest,limits);
    check(payload instanceof Uint8Array && payload.length===size, 'payload size');
    const prepared=[];
    for(const t of manifest.targets) {
      const matches=ranges.filter(r=>r.id===t.id);
      check(matches.length===1, 'missing/duplicate building '+t.id);
      check(!matches[0].filtered, 'filtered facade needs its own bake '+t.id);
      const actual=await fingerprint(geometry,matches[0],limits);
      check(actual.vertices===t.vertices && actual.triangles===t.triangles, 'stale counts '+t.id);
      for(const k of ['position','normal','aSurface','index','facet'])check(actual.hashes[k]===t.hashes?.[k], 'stale '+k+' '+t.id);
      const bytes=payload.slice(t.offset,t.offset+t.bytes);
      check(await sha256(bytes)===t.sha256, 'corrupt payload '+t.id);
      const base=geometry.attributes.aFacet.array.slice(actual.lo,actual.hi+1);
      for(let i=0;i<bytes.length;i++) {
        check((bytes[i]&1)===base[i], 'facet bit changed');
        const kind=geometry.attributes.aSurface.array[(actual.lo+i)*4];
        check(!(kind>3.5&&kind<6.5) || bytes[i]===base[i], 'glass/emission occlusion');
      }
      for(const p of prepared)check(actual.lo>p.hi || actual.hi<p.lo, 'overlapping building spans');
      prepared.push({...actual,bytes,base,id:t.id});
    }
    return prepared;
  }
  function create(options={}) {
    const config={...DEFAULTS,...options};
    check(Number.isFinite(config.strength) && config.strength>=0 && config.strength<=1, 'strength');
    let generation=0, disposed=false, lease=null, controller=null;
    const state={status:'idle',reason:null,applied:[],milliseconds:0};
    function invalidate() {generation++;controller?.abort();controller=null;lease?.dispose();lease=null;}
    async function attach({mesh,ranges,manifest,payload,manifestURL,payloadURL,fetcher=root.fetch?.bind(root)}) {
      check(!disposed, 'disposed session');invalidate();const token=generation,start=performance.now();
      state.status='loading';state.reason=null;state.applied=[];
      const abort=new AbortController();controller=abort;
      const timer=setTimeout(()=>abort.abort(),config.timeoutMs);
      try {
        const read=async(url,json)=>{
          check(fetcher && url,'missing asset URL');
          const response=await fetcher(url,{signal:abort.signal});check(response.ok,'asset HTTP '+response.status);
          // Production assets are small and same-origin; reject oversized declared downloads.
          const length=Number(response.headers?.get('content-length'));
          check(!length || length<=config.maxPayloadBytes,'asset response too large');
          return json?response.json():new Uint8Array(await response.arrayBuffer());
        };
        [manifest,payload]=await Promise.all([manifest || read(manifestURL,true),payload || read(payloadURL,false)]);
        const g=mesh.geometry,m=mesh.material;
        check(!Array.isArray(m) && !owners.has(g) && !owners.has(m),'mesh already owned');
        const patched=shaders(m.vertexShader,m.fragmentShader);
        const prepared=await prepare(g,ranges,manifest,payload,config);
        check(!abort.signal.aborted && token===generation && !disposed && mesh.geometry===g && mesh.material===m,'cancelled or replaced build');
        check(!owners.has(g) && !owners.has(m),'mesh acquired during preparation');
        const facet=g.attributes.aFacet;
        const saved={vertex:m.vertexShader,fragment:m.fragmentShader,uniforms:m.uniforms};
        const ownership={};owners.set(g,ownership);owners.set(m,ownership);
        // Commit is synchronous: encoded bytes are never paired with the old shader.
        for(const p of prepared)facet.array.set(p.bytes,p.lo);
        facet.needsUpdate=true;
        m.vertexShader=patched.vertex;m.fragmentShader=patched.fragment;
        m.uniforms={...saved.uniforms,u_bakedDepth:{value:config.strength}};m.needsUpdate=true;
        let released=false;
        lease={
          setStrength(value) {check(!released && Number.isFinite(value) && value>=0 && value<=1,'strength/lease');m.uniforms.u_bakedDepth.value=value;},
          dispose() {
            if(released)return;released=true;
            for(const p of prepared)facet.array.set(p.base,p.lo);
            facet.needsUpdate=true;
            m.vertexShader= saved.vertex;m.fragmentShader=saved.fragment;m.uniforms=saved.uniforms;m.needsUpdate=true;
            owners.delete(g);owners.delete(m);
          }
        };
        state.status='ready';state.applied=prepared.map(p=>p.id);state.milliseconds=performance.now()-start;
        return lease;
      } catch(error) {
        if(token===generation){state.status=abort.signal.aborted?'cancelled':'fallback';state.reason=String(error.message);state.milliseconds=performance.now()-start;}
        return null;
      } finally {clearTimeout(timer);if(controller===abort)controller=null;}
    }
    return {config,state,attach,cancel(){invalidate();state.status='cancelled';state.applied=[];},dispose(){invalidate();disposed=true;state.status='disposed';state.applied=[];}};
  }
  root.BakedEnclosure=Object.freeze({VERSION,DEFAULTS,sha256,fingerprint,shaders,prepare,create});
})(globalThis);
