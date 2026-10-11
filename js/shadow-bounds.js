/* Optional shadow-kernel bounds. Existing colour attachments hold the output;
 * no bounds render-target texture is allocated. Called only on shadow refresh. */
(function(){
  'use strict';
  const contexts=new WeakMap(),stats={refreshes:0,targetBytes:0,failures:[]};
  function create(gl){
    const compile=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);
      if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){const msg=gl.getShaderInfoLog(s);gl.deleteShader(s);throw new Error(msg);}return s;};
    const vs=compile(gl.VERTEX_SHADER,`#version 300 es
      void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.-1.,0.,1.);}`);
    const fs=compile(gl.FRAGMENT_SHADER,`#version 300 es
      precision highp float; precision highp int;
      uniform highp sampler2D sourceDepth; out vec4 bounds;
      void main(){
        ivec2 p=ivec2(gl_FragCoord.xy),size=textureSize(sourceDepth,0);
        float lo=1.0,hi=0.0;
        for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
          float d=texelFetch(sourceDepth,clamp(p+ivec2(x,y),ivec2(0),size-1),0).r;
          lo=min(lo,d);hi=max(hi,d);
        }
        // The extra quantum covers floating mul/div rounding at exact
        // quantization boundaries; it can only prevent an early-out.
        float a=max(0.0,floor(lo*65535.0)-1.0);
        float b=min(65535.0,ceil(hi*65535.0)+1.0);
        vec2 high=floor(vec2(a,b)/256.0),low=vec2(a,b)-high*256.0;
        bounds=vec4(high.x,low.x,high.y,low.y)/255.0;
      }`);
    const program=gl.createProgram();gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS)){const msg=gl.getProgramInfoLog(program);gl.deleteProgram(program);throw new Error(msg);}
    const sampler=gl.createSampler();gl.samplerParameteri(sampler,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.samplerParameteri(sampler,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    gl.samplerParameteri(sampler,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.samplerParameteri(sampler,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.samplerParameteri(sampler,gl.TEXTURE_COMPARE_MODE,gl.NONE);
    // Only the existing temporal resolver changes DITHER, restoring it in
    // finally. Cache the app's setting once, not a synchronous query per frame.
    const state={program,sampler,fbo:gl.createFramebuffer(),vao:gl.createVertexArray(),location:gl.getUniformLocation(program,'sourceDepth'),dither:gl.isEnabled(gl.DITHER)};
    gl.canvas?.addEventListener('webglcontextlost',()=>contexts.delete(gl),{once:true});
    return state;
  }
  function update(renderer,target){
    const gl=renderer.getContext();let s=contexts.get(gl);
    try{
      if(!s){s=create(gl);contexts.set(gl,s);}
      const depth=renderer.properties.get(target.depthTexture).__webglTexture,color=renderer.properties.get(target.texture).__webglTexture;
      if(!depth||!color)throw new Error('shadow textures have not been allocated');
      // This FBO has ONLY colour attached. Sampling the depth texture while
      // it remained attached to the render-target FBO would be feedback.
      gl.bindFramebuffer(gl.FRAMEBUFFER,s.fbo);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,color,0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);gl.viewport(0,0,target.width,target.height);
      gl.disable(gl.SCISSOR_TEST);gl.disable(gl.DEPTH_TEST);gl.disable(gl.STENCIL_TEST);gl.disable(gl.BLEND);gl.disable(gl.CULL_FACE);gl.disable(gl.DITHER);
      gl.colorMask(true,true,true,true);gl.useProgram(s.program);gl.bindVertexArray(s.vao);
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,depth);gl.bindSampler(0,s.sampler);gl.uniform1i(s.location,0);
      gl.drawArrays(gl.TRIANGLES,0,3);stats.refreshes++;
    }catch(e){stats.failures.push(String(e.message||e));throw e;}
    finally{
      gl.bindSampler(0,null);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,null);gl.bindVertexArray(null);
      if(s){gl.bindFramebuffer(gl.FRAMEBUFFER,s.fbo);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,null,0);}
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);if(s?.dither)gl.enable(gl.DITHER);
      // Three and MapLibre own caches for this shared GL context. Both must
      // reconstruct their state before drawing; no stale sampler can escape.
      renderer.resetState();window.__map?.painter?.context?.setDirty?.();
    }
  }
  window.ShadowBounds={update,stats};
})();
