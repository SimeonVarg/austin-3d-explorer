/* Opt-in exact daylight algebra for standard slopes materials.
 * Load after the scene, then DaySpecialize.attach(); set(false) disables.
 * GPU compiler elimination and performance still require measurement. */
(function(){
  'use strict';
  const stats={attached:false,on:false,frames:0,specializedFrames:0,lastMeshes:0,lastMaterials:0,variants:0,failures:[]};
  const allowedDefines=new Set(['PACKED_TONES','PACK_TONES','PACK_NLOW','PACK_TEXW','FACADE_FILTER','FACADE_FILTER_ARRAY']);
  const renderState=['visible','side','shadowSide','transparent','opacity','alphaTest','alphaHash','alphaToCoverage',
    'blending','blendSrc','blendDst','blendEquation','blendSrcAlpha','blendDstAlpha','blendEquationAlpha',
    'depthFunc','depthTest','depthWrite','colorWrite','stencilWrite','stencilWriteMask','stencilFunc','stencilRef',
    'stencilFuncMask','stencilFail','stencilZFail','stencilZPass','polygonOffset','polygonOffsetFactor',
    'polygonOffsetUnits','wireframe','wireframeLinewidth','forceSinglePass','premultipliedAlpha','dithering',
    'toneMapped','fog','lights','clipping','clipIntersection','clipShadows','precision','glslVersion'];
  let S,renderer,native,template,fragment,enabled=false,active=false,cache=new WeakMap();
  const owned=new Set(),restore=[],frameCache=new Map();
  function replaceOnce(source,needle,value){
    if(source.split(needle).length!==2)throw new Error('day shader source changed: '+needle);
    return source.replace(needle,value);
  }
  function daylight(m){
    const u=m.uniforms;
    return u?.u_sunlight?.value?.x>=.5&&u?.u_sunPresence?.value?.x===1&&u?.u_cityNight?.value?.x===0;
  }
  function select(original){
    if(frameCache.has(original))return frameCache.get(original);
    const T=window.THREE;
    if(!original?.isShaderMaterial||original.vertexShader!==template.vertexShader||original.fragmentShader!==template.fragmentShader
      ||original.onBeforeCompile!==T.Material.prototype.onBeforeCompile||original.uniformsGroups?.length
      ||Object.keys(original.defines||{}).some(k=>!allowedDefines.has(k))||!daylight(original)){
      frameCache.set(original,original);return original;
    }
    let record=cache.get(original);
    if(!record||record.version!==original.version){
      if(record){record.material.dispose();owned.delete(record.material);}
      // Material.copy preserves render state without ShaderMaterial.copy's
      // unnecessary deep clone of every shared uniform and palette texture.
      const material=new T.ShaderMaterial();
      T.Material.prototype.copy.call(material,original);
      material.vertexShader=original.vertexShader;material.fragmentShader=fragment;
      material.defines=original.defines;material.uniforms=original.uniforms;
      material.defaultAttributeValues=original.defaultAttributeValues;
      material.extensions=original.extensions;material.glslVersion=original.glslVersion;
      material.fog=original.fog;material.lights=original.lights;material.clipping=original.clipping;
      record={material,version:original.version};cache.set(original,record);owned.add(material);stats.variants=owned.size;
    }
    const variant=record.material;
    // Keep direct runtime render-state edits as well as uniform-holder swaps.
    for(const key of renderState)if(variant[key]!==original[key]){variant[key]=original[key];variant.needsUpdate=true;}
    variant.clippingPlanes=original.clippingPlanes;variant.uniforms=original.uniforms;
    variant.defaultAttributeValues=original.defaultAttributeValues;
    frameCache.set(original,variant);stats.lastMaterials++;return variant;
  }
  function render(scene,camera){
    if(!enabled||active||scene!==S.scene||camera!==S.camera||scene.overrideMaterial)return native.apply(this,arguments);
    active=true;stats.lastMeshes=stats.lastMaterials=0;frameCache.clear();
    try{
      scene.traverse(object=>{
        if(!object.isMesh||object.onBeforeRender!==window.THREE.Object3D.prototype.onBeforeRender)return;
        const original=object.material;
        if(Array.isArray(original)){
          const selected=original.map(select);
          if(selected.some((m,i)=>m!==original[i])){restore.push([object,original]);object.material=selected;stats.lastMeshes++;}
        }else{
          const selected=select(original);
          if(selected!==original){restore.push([object,original]);object.material=selected;stats.lastMeshes++;}
        }
      });
      const result=native.apply(this,arguments);stats.frames++;if(stats.lastMeshes)stats.specializedFrames++;return result;
    }catch(e){stats.failures.push(String(e.message||e));throw e;}
    finally{for(const [object,material]of restore)object.material=material;restore.length=0;frameCache.clear();active=false;}
  }
  const api={stats,
    attach(){
      S=window.slopes;if(!S?.renderer||!S.scene||!S.camera)throw new Error('slopes scene not ready');
      if(stats.attached&&renderer===S.renderer){enabled=stats.on=true;return stats;}
      if(renderer?.render===render)renderer.render=native;
      const m=S.material();template={vertexShader:m.vertexShader,fragmentShader:m.fragmentShader};m.dispose();
      fragment=replaceOnce(template.fragmentShader,'if(u_sunlight.x<.5||u_sunPresence.x<=0.0)return original;','');
      fragment=replaceOnce(fragment,'return mix(original,displayColour(diffuse),u_sunPresence.x);','return displayColour(diffuse);');
      fragment=fragment.replace(/\bu_cityNight\.x\b/g,'0.0');
      renderer=S.renderer;native=renderer.render;renderer.render=render;enabled=stats.on=stats.attached=true;return stats;
    },
    apply(){return api.attach();},
    set(on){enabled=stats.on=!!on;if(enabled)api.attach();return stats;},
    dispose(){if(renderer?.render===render)renderer.render=native;for(const m of owned)m.dispose();owned.clear();cache=new WeakMap();stats.variants=0;enabled=stats.on=stats.attached=false;},
  };
  window.DaySpecialize=api;
})();
