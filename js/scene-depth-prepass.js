/* Optional opaque depth prefill. No new geometry, buffer or render target.
 * Load after the scene, then SceneDepthPrepass.attach(); set(false) disables. */
(function(){
  'use strict';
  const stats={attached:false,on:false,frames:0,depthTriangles:0,lastDepthTriangles:0,lastEligibleMeshes:0,lastSkippedMeshes:0,materials:0,failures:[]};
  let enabled=false,active=false,renderer,native,S,template,depthMaterials=new WeakMap();
  const owned=new Set(),restore=[],noop=function(){};
  const list=m=>Array.isArray(m)?m:[m];
  const allowedDefines=new Set(['PACKED_TONES','PACK_TONES','PACK_NLOW','PACK_TEXW']);
  function eligible(mesh){
    const T=window.THREE,g=mesh.geometry;
    if(!mesh.isMesh||mesh.isSkinnedMesh||mesh.isInstancedMesh||g?.isInstancedBufferGeometry||!g?.attributes?.position||g.attributes.position.itemSize!==3)return false;
    if(Object.keys(g.morphAttributes||{}).length||mesh.onBeforeRender!==T.Object3D.prototype.onBeforeRender||mesh.onAfterRender!==T.Object3D.prototype.onAfterRender)return false;
    return list(mesh.material).every(m=>m?.isShaderMaterial&&m.visible&&!m.transparent&&!m.alphaTest&&!m.alphaHash&&!m.alphaToCoverage
      &&m.depthTest&&m.depthWrite&&m.colorWrite&&m.depthFunc===T.LessEqualDepth&&!m.polygonOffset&&!m.wireframe&&!m.clipping
      &&!(m.clippingPlanes?.length)&&!m.extensions?.clipCullDistance&&m.blending===T.NoBlending
      &&m.vertexShader===template.vertexShader&&m.fragmentShader===template.fragmentShader
      &&m.onBeforeCompile===T.Material.prototype.onBeforeCompile&&Object.keys(m.defines||{}).every(k=>allowedDefines.has(k)));
  }
  function depthMaterial(original){
    let record=depthMaterials.get(original);
    // A side/precision change must not leave a stale depth representation.
    const signature=[original.side,original.precision,original.glslVersion].join('|');
    if(record?.signature===signature)return record.material;
    if(record){record.material.dispose();owned.delete(record.material);}
    const T=window.THREE;
    const material=new T.ShaderMaterial({
      vertexShader:'void main(){gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);}',
      fragmentShader:'void main(){gl_FragColor=vec4(0.0);}',
      side:original.side,precision:original.precision,glslVersion:original.glslVersion,
      colorWrite:false,depthWrite:true,depthTest:true,depthFunc:T.LessEqualDepth,
      blending:T.NoBlending,transparent:false,toneMapped:false,
    });
    record={signature,material};depthMaterials.set(original,record);owned.add(material);stats.materials=owned.size;return material;
  }
  function restoreObjects(){
    for(const r of restore){r.object.visible=r.visible;if(r.material!==undefined)r.object.material=r.material;}
    restore.length=0;
  }
  function render(scene,camera){
    if(!enabled||active||scene!==S.scene||camera!==S.camera||scene.overrideMaterial||renderer.autoClear
      ||renderer.clippingPlanes?.length)return native.apply(this,arguments);
    active=true;stats.lastEligibleMeshes=stats.lastSkippedMeshes=0;
    const before=scene.onBeforeRender,after=scene.onAfterRender;
    try{
      scene.traverse(object=>{
        if(!(object.isMesh||object.isLine||object.isPoints||object.isSprite))return;
        const record={object,visible:object.visible};
        if(eligible(object)){
          record.material=object.material;
          object.material=Array.isArray(object.material)?object.material.map(depthMaterial):depthMaterial(object.material);
          stats.lastEligibleMeshes++;
        }else{object.visible=false;stats.lastSkippedMeshes++;}
        restore.push(record);
      });
      if(!stats.lastEligibleMeshes){restoreObjects();return native.apply(this,arguments);}
      // Cull each pass with that pass's visible objects. Ineligible meshes
      // are hidden here, so the colour pass must run the hook again after
      // their original materials and visibility have been restored.
      scene.onBeforeRender=before;scene.onAfterRender=noop;
      native.call(this,scene,camera);
      stats.lastDepthTriangles=renderer.info?.render?.triangles||0;stats.depthTriangles+=stats.lastDepthTriangles;
      restoreObjects();scene.onBeforeRender=before;scene.onAfterRender=after;
      // Preserve original LEQUAL and triangle/material order. Prefilled
      // nearest depth rejects hidden fragments; tied surfaces still render
      // in the original order, with the original shader and colour writes.
      const result=native.call(this,scene,camera);stats.frames++;return result;
    }catch(e){stats.failures.push(String(e.message||e));throw e;}
    finally{restoreObjects();scene.onBeforeRender=before;scene.onAfterRender=after;active=false;}
  }
  window.SceneDepthPrepass={stats,
    attach(){
      if(stats.attached){enabled=stats.on=true;return stats;}
      S=window.slopes;renderer=S?.renderer;if(!renderer||!S.scene||!S.camera)throw new Error('slopes scene not ready');
      const m=S.material();template={vertexShader:m.vertexShader,fragmentShader:m.fragmentShader};m.dispose();
      // Source equality above excludes active FACADE_FILTER discard and any
      // custom vertex deformation. The only accepted position expression is
      // reproduced verbatim, including matrix multiply association.
      if(!/gl_Position = projectionMatrix \* modelViewMatrix \* vec4\(position, 1\.0\);/.test(template.vertexShader))throw new Error('standard position shader changed');
      const opaqueSource=template.fragmentShader.replace('if(faceMix<=0.0)discard;','');
      if(/\bdiscard\b|\bgl_FragDepth\b/.test(opaqueSource))throw new Error('new standard fragment coverage/depth operation needs review');
      native=renderer.render;renderer.render=render;enabled=stats.on=stats.attached=true;return stats;
    },
    set(on){enabled=!!on;stats.on=enabled;if(enabled&&!stats.attached)this.attach();return stats;},
    dispose(){if(renderer&&renderer.render===render)renderer.render=native;for(const m of owned)m.dispose();owned.clear();depthMaterials=new WeakMap();enabled=false;stats.on=stats.attached=false;},
  };
})();
