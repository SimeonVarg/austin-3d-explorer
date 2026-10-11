/** Experimental temporal resolve, not an accepted stability guarantee.
 * Parent owns current color/depth and calls after scene rendering.
 *
 * const taa = TemporalResolve.create(gl, {shaderSource, bindFramebuffer});
 * const result = taa.resolve({color, depth, w, h, grid:1, currentMatrix,
 *   depthRange:[0,.958984375], jitter:[dx,dy]});
 * result = {texture, color, fbo, converged, stats}; texture alpha is confidence.
 * currentMatrix: column-major local-world -> clip INCLUDING raster jitter.
 * jitter: native pixels, positive x right, positive y UP, already in matrix.
 * depthRange: the actual range used for the 3D scene, not the final GL state.
 * The input depth is an ordinary depth texture, never a multisample texture.
 * Call reset() on content, lighting, viewport, render-scale or material changes.
 * A scene with mixed depth ranges must supply a compatible depth surface/mask;
 * sky/clear depth is rejected, but this helper cannot identify arbitrary 2D UI.
 * Leaves its FBO/program/textures bound; parent must invalidate GL state caches.
 * No readback, GPU timers, repaint scheduling, or ownership of parent textures.
 */
(function () {
  'use strict';
  const VERTEX = `#version 300 es
  void main(){gl_Position=vec4(float((gl_VertexID<<1)&2)*2.-1.,float(gl_VertexID&2)*2.-1.,0.,1.);}`;
  const FRAGMENT = `#version 300 es
  precision highp float;
  precision highp int;
  uniform highp sampler2D u_color,u_depth,u_history,u_historyDepth;
  uniform mat4 u_inverseRaster,u_current,u_previous;
  uniform vec2 u_size,u_range,u_previousRange;
  uniform int u_grid;
  uniform float u_valid,u_samples,u_depthFloor,u_depthSlope,u_clamp;
  layout(location=0) out vec4 outColor;
  layout(location=1) out vec4 outDepth;
  // 24-bit normalized depth in RGB. Alpha distinguishes geometry from clear.
  vec4 packDepth(float d,float valid){
    float n=floor(clamp(d,0.,1.)*16777215.+.5);
    float hi=floor(n/65536.);n-=hi*65536.;
    float mid=floor(n/256.);return vec4(hi,mid,n-mid*256.,valid*255.)/255.;
  }
  float unpackDepth(vec4 v){return dot(floor(v.rgb*255.+.5),vec3(65536.,256.,1.))/16777215.;}
  ivec2 bounded(ivec2 p){return clamp(p,ivec2(0),ivec2(u_size)-1);}
  vec3 currentColor(ivec2 p){
    ivec2 base=bounded(p)*u_grid;vec3 sum=vec3(0.);
    for(int y=0;y<4;y++)for(int x=0;x<4;x++){
      if(x<u_grid&&y<u_grid)sum+=texelFetch(u_color,base+ivec2(x,y),0).rgb;
    }
    return sum/float(u_grid*u_grid);
  }
  void main(){
    ivec2 pixel=ivec2(gl_FragCoord.xy);vec2 uv=(vec2(pixel)+.5)/u_size;
    vec3 fresh=currentColor(pixel);
    // Center subpixel is the representative surface for grid > 1. A resolved
    // color crossing surfaces has no exact single depth: edge rejection and
    // clipping are safeguards, not proof of exact reconstruction.
    ivec2 dp=pixel*u_grid+ivec2(u_grid/2);
    float depth=texelFetch(u_depth,dp,0).r;
    float low=min(u_range.x,u_range.y),high=max(u_range.x,u_range.y);
    bool geometry=depth>=low&&depth<high-0.00000012;
    outDepth=packDepth(depth,geometry?1.:0.);
    outColor=vec4(fresh,1./u_samples);
    // Reconstruct the actual sampled ray, including its subpixel position.
    vec2 sampleUV=(vec2(dp)+.5)/(u_size*float(u_grid));
    float ndcDepth=2.*(depth-u_range.x)/(u_range.y-u_range.x)-1.;
    vec4 world=u_inverseRaster*vec4(sampleUV*2.-1.,ndcDepth,1.);
    vec4 now=u_current*world,old=u_previous*world;
    bool projectable=abs(world.w)>1e-12&&now.w>0.&&old.w>0.;
    vec2 nowUV=now.xy/max(now.w,1e-12)*.5+.5;
    vec2 oldUV=old.xy/max(old.w,1e-12)*.5+.5;
    // Jitter-free motion keeps history stationary at rest, accumulating actual
    // coverage samples rather than translating the previous jittered picture.
    vec2 historyUV=uv+oldUV-nowUV;
    float predicted=(old.z/max(old.w,1e-12)*.5+.5)*(u_previousRange.y-u_previousRange.x)+u_previousRange.x;
    // Derivatives are outside divergent branches. The slope term tolerates
    // depth changes across a footprint; the fixed term covers 24-bit depth.
    float tolerance=u_depthFloor+u_depthSlope*(abs(dFdx(predicted))+abs(dFdy(predicted)));
    if(u_valid<.5||!geometry||!projectable||any(lessThan(historyUV,vec2(0.)))||any(greaterThan(historyUV,vec2(1.))))return;
    vec2 at=historyUV*u_size-.5;ivec2 base=ivec2(floor(at));vec2 f=fract(at);
    vec3 history=vec3(0.);float accepted=0.,count=0.;
    for(int y=0;y<2;y++)for(int x=0;x<2;x++){
      ivec2 p=base+ivec2(x,y);
      float weight=(x==0?1.-f.x:f.x)*(y==0?1.-f.y:f.y);
      if(any(lessThan(p,ivec2(0)))||any(greaterThanEqual(p,ivec2(u_size))))continue;
      vec4 storedDepth=texelFetch(u_historyDepth,p,0);
      float previousDepth=unpackDepth(storedDepth);
      if(storedDepth.a<.5||abs(previousDepth-predicted)>tolerance)continue;
      vec4 c=texelFetch(u_history,p,0);
      history+=weight*c.rgb;count+=weight*c.a*u_samples;accepted+=weight;
    }
    if(accepted<.05)return;
    history/=accepted;count/=accepted;
    // Optional five-neighbor color clipping prevents long color trails; it
    // can bias subpixel patterns, so it is exposed for the fixed-truth A/B.
    if(u_clamp>0.){
      vec3 lo=fresh,hi=fresh;
      vec3 a=currentColor(pixel+ivec2(1,0));lo=min(lo,a);hi=max(hi,a);
      a=currentColor(pixel+ivec2(-1,0));lo=min(lo,a);hi=max(hi,a);
      a=currentColor(pixel+ivec2(0,1));lo=min(lo,a);hi=max(hi,a);
      a=currentColor(pixel+ivec2(0,-1));lo=min(lo,a);hi=max(hi,a);
      history=mix(history,clamp(history,lo,hi),u_clamp);
    }
    // A partly disoccluded footprint receives less history confidence.
    count=min(count*accepted,u_samples-1.);
    outColor=vec4((fresh+history*count)/(count+1.),(count+1.)/u_samples);
  }`;

  function matrix(value) {
    const a=value?.elements||value;
    if(!a||a.length!==16||Array.from(a).some(v=>!Number.isFinite(v)))throw Error('TemporalResolve requires a finite 4x4 currentMatrix');
    return new Float64Array(a);
  }
  function inverse(a) {
    // Gauss-Jordan with partial pivoting, retaining double precision on CPU.
    const r=Array.from({length:4},(_,y)=>Array.from({length:8},(_,x)=>x<4?a[x*4+y]:+(x-4===y)));
    for(let c=0;c<4;c++){
      let best=c;for(let y=c+1;y<4;y++)if(Math.abs(r[y][c])>Math.abs(r[best][c]))best=y;
      if(Math.abs(r[best][c])<1e-15)return null;
      [r[c],r[best]]=[r[best],r[c]];const n=r[c][c];for(let x=0;x<8;x++)r[c][x]/=n;
      for(let y=0;y<4;y++)if(y!==c){const f=r[y][c];for(let x=0;x<8;x++)r[y][x]-=r[c][x]*f;}
    }
    return Float64Array.from({length:16},(_,i)=>r[i%4][4+Math.floor(i/4)]);
  }
  function unjitter(a,jitter,w,h) {
    const out=new Float64Array(a),dx=2*(jitter?.[0]||0)/w,dy=2*(jitter?.[1]||0)/h;
    for(let c=0;c<4;c++){out[c*4]-=dx*a[c*4+3];out[c*4+1]-=dy*a[c*4+3];}
    return out;
  }
  function transform(a,p) {return [0,1,2,3].map(r=>a[r]*p[0]+a[4+r]*p[1]+a[8+r]*p[2]+a[12+r]*p[3]);}
  function movement(current,previous) {
    const inv=inverse(current);if(!inv)return Infinity;
    let maximum=0;
    for(const z of [0,.99])for(const x of [-.6,.6])for(const y of [-.6,.6]){
      const p=transform(previous,transform(inv,[x,y,z,1]));
      if(p[3]<=0)return Infinity;
      maximum=Math.max(maximum,Math.abs(p[0]/p[3]-x),Math.abs(p[1]/p[3]-y));
    }
    return maximum;
  }
  function create(gl,native={}) {
    if(typeof gl.texStorage2D!=='function')throw Error('TemporalResolve requires WebGL2');
    const source=native.shaderSource||gl.shaderSource,bind=native.bindFramebuffer||gl.bindFramebuffer;
    const tune={samples:16,depthFloor:0.000002,depthSlope:1.5,clamp:1,cutNdc:1.5,stillPixels:.01};
    const stats={frames:0,gpuBytes:0,floatHistory:false,resets:0,cuts:0,stillFrames:0,converged:false,lastReset:'new'};
    let program=null,vao=null,uniforms=null,targets=[],width=0,height=0,index=0,valid=false,previous=null,previousRange=[0,1],disposed=false;
    const useNative=(target,fbo)=>bind.call(gl,target,fbo);
    function reset(reason='explicit') {
      valid=false;previous=null;stats.stillFrames=0;stats.converged=false;stats.resets++;stats.lastReset=reason;
    }
    function releaseTargets() {
      for(const t of targets){gl.deleteFramebuffer(t.fbo);gl.deleteTexture(t.color);gl.deleteTexture(t.depth);}
      targets=[];width=height=0;stats.gpuBytes=0;
    }
    function compile(type,text) {
      const shader=gl.createShader(type);source.call(gl,shader,text);gl.compileShader(shader);
      if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){const error=gl.getShaderInfoLog(shader);gl.deleteShader(shader);throw Error('TemporalResolve shader: '+error);}
      return shader;
    }
    function ensureProgram() {
      if(program)return;
      const shaders=[];
      try {
        shaders.push(compile(gl.VERTEX_SHADER,VERTEX),compile(gl.FRAGMENT_SHADER,FRAGMENT));
        program=gl.createProgram();for(const shader of shaders)gl.attachShader(program,shader);gl.linkProgram(program);
        if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error('TemporalResolve link: '+gl.getProgramInfoLog(program));
        vao=gl.createVertexArray();uniforms={};
        for(const name of ['color','depth','history','historyDepth','inverseRaster','current','previous','size','range','previousRange','grid','valid','samples','depthFloor','depthSlope','clamp'])uniforms[name]=gl.getUniformLocation(program,'u_'+name);
      } catch(e){if(program)gl.deleteProgram(program);program=null;throw e;}
      finally{for(const shader of shaders)gl.deleteShader(shader);}
    }
    function texture(format,w,h) {
      const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texStorage2D(gl.TEXTURE_2D,1,format,w,h);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      return t;
    }
    function ensure(w,h) {
      ensureProgram();if(width===w&&height===h&&targets.length===2)return;
      releaseTargets();reset('resize');
      const floats=!!gl.getExtension('EXT_color_buffer_float');
      // RGBA8 depth avoids relying on independently renderable float R targets.
      for(const floating of floats?[true,false]:[false]){
        try {
          for(let i=0;i<2;i++){
            const t={fbo:gl.createFramebuffer(),color:null,depth:null};targets.push(t);
            t.color=texture(floating?gl.RGBA16F:gl.RGBA8,w,h);t.depth=texture(gl.RGBA8,w,h);
            useNative(gl.FRAMEBUFFER,t.fbo);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,t.color,0);
            gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT1,gl.TEXTURE_2D,t.depth,0);
            gl.drawBuffers([gl.COLOR_ATTACHMENT0,gl.COLOR_ATTACHMENT1]);
            if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('TemporalResolve incomplete history FBO');
          }
          width=w;height=h;stats.floatHistory=floating;stats.gpuBytes=w*h*2*(floating?12:8);index=0;return;
        }catch(e){releaseTargets();if(!floating)throw e;}
      }
    }
    function resolve({color,depth,w,h,grid=1,currentMatrix,depthRange=[0,1],jitter=[0,0]}) {
      if(disposed)throw Error('TemporalResolve is disposed');
      if(!Number.isInteger(w)||!Number.isInteger(h)||w<1||h<1||!Number.isInteger(grid)||grid<1||grid>4)throw Error('TemporalResolve dimensions/grid invalid (grid 1..4)');
      if(!color||!depth)throw Error('TemporalResolve requires color and depth textures');
      if(depthRange.length!==2||depthRange.some(v=>!Number.isFinite(v))||depthRange[0]===depthRange[1])throw Error('TemporalResolve invalid depthRange');
      const raster=matrix(currentMatrix),inv=inverse(raster);if(!inv)throw Error('TemporalResolve singular currentMatrix');
      const current=unjitter(raster,jitter,w,h);
      ensure(w,h);
      const delta=previous?movement(current,previous):Infinity;
      if(valid&&delta>tune.cutNdc){reset('camera-cut');stats.cuts++;}
      const still=valid&&delta*Math.max(w,h)*.5<=tune.stillPixels;
      stats.stillFrames=still?stats.stillFrames+1:1;
      const output=targets[index],history=targets[1-index];
      useNative(gl.FRAMEBUFFER,output.fbo);gl.drawBuffers([gl.COLOR_ATTACHMENT0,gl.COLOR_ATTACHMENT1]);
      gl.viewport(0,0,w,h);gl.disable(gl.DEPTH_TEST);gl.disable(gl.STENCIL_TEST);gl.disable(gl.BLEND);gl.disable(gl.SCISSOR_TEST);gl.disable(gl.CULL_FACE);
      gl.colorMask(true,true,true,true);gl.useProgram(program);gl.bindVertexArray(vao);
      [color,depth,history.color,history.depth].forEach((texture,i)=>{gl.activeTexture(gl.TEXTURE0+i);gl.bindSampler(i,null);gl.bindTexture(gl.TEXTURE_2D,texture);gl.uniform1i(uniforms[['color','depth','history','historyDepth'][i]],i);});
      gl.uniformMatrix4fv(uniforms.inverseRaster,false,new Float32Array(inv));
      gl.uniformMatrix4fv(uniforms.current,false,new Float32Array(current));
      gl.uniformMatrix4fv(uniforms.previous,false,new Float32Array(previous||current));
      gl.uniform2f(uniforms.size,w,h);gl.uniform2f(uniforms.range,...depthRange);gl.uniform2f(uniforms.previousRange,...previousRange);
      gl.uniform1i(uniforms.grid,grid);gl.uniform1f(uniforms.valid,valid?1:0);
      const samples=Math.max(1,Math.min(64,Math.round(tune.samples)));
      gl.uniform1f(uniforms.samples,samples);gl.uniform1f(uniforms.depthFloor,tune.depthFloor);gl.uniform1f(uniforms.depthSlope,tune.depthSlope);gl.uniform1f(uniforms.clamp,Math.max(0,Math.min(1,tune.clamp)));
      // Packed depth bytes must not be dithered. Restore the caller's setting.
      const dither=gl.isEnabled(gl.DITHER);gl.disable(gl.DITHER);
      try {gl.drawArrays(gl.TRIANGLES,0,3);} finally {if(dither)gl.enable(gl.DITHER);}
      index=1-index;valid=true;previous=current;previousRange=Array.from(depthRange);stats.frames++;
      // CPU convergence reports a stable camera and enough submitted samples,
      // not measured per-pixel confidence or a promise of visual convergence.
      stats.converged=stats.stillFrames>=samples;
      return {texture:output.color,color:output.color,fbo:output.fbo,converged:stats.converged,stats};
    }
    function dispose() {
      if(disposed)return;releaseTargets();if(program)gl.deleteProgram(program);if(vao)gl.deleteVertexArray(vao);
      program=vao=null;disposed=true;valid=false;previous=null;
    }
    return {resolve,reset,dispose,tune,stats};
  }
  window.TemporalResolve={create};
})();
