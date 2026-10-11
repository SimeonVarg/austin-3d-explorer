/**
 * Experimental spatial coverage sampler. Opt in: ?samplelattice=1.
 * The camera and material footprint stay at native resolution; only coverage
 * is sampled on a denser lattice. Every frame is independent (no history).
 * NOT accepted as zero-moire or zero-cost. See out/STATE.md.
 */
(function () {
  'use strict';
  const Q = new URLSearchParams(location.search);
  const TUNE = { grid: 4, samples: 0, tiles: 1 };
  let on = Q.get('samplelattice') === '1', attached = false;
  let map, gl, native, target, program, vao, sampler,resolveOffset;
  let tileY=0;
  const band={low:-1,high:1};
  let active = false, drawing = null, currentProgram = null, lastScale = -1;
  let historyEnabled=false,history=null,jitterFrame=0,range3d=[0,1];
  const locations = new WeakMap(), failures = [];
  const sources=new WeakMap();
  const stats = { frames: 0, gpuBytes: 0, patched: 0, unpatched: 0, failures };
  function drop() {
    if (!target) return;
    gl.deleteFramebuffer(target.fbo);
    if(target.samples) {gl.deleteRenderbuffer(target.color);gl.deleteTexture(target.resolved);gl.deleteFramebuffer(target.resolveFbo);} else gl.deleteTexture(target.color);
    if(target.depthTexture)gl.deleteTexture(target.depth);else gl.deleteRenderbuffer(target.depth); target = null; stats.gpuBytes = 0;
  }
  function compile(type, text) {
    const s = gl.createShader(type);
    native.shaderSource.call(gl, s, text); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error(log);
    }
    return s;
  }
  function ensure(w, h) {
    if (target && target.w === w && target.h === h) return;
    drop();
    const size = TUNE.grid;
    if (Math.max(w,h)*size > gl.getParameter(gl.MAX_TEXTURE_SIZE)) throw new Error('sample lattice exceeds texture size');
    const samples=TUNE.samples?Math.min(TUNE.samples,gl.getParameter(gl.MAX_SAMPLES)):0;
    const depthTexture=historyEnabled&&!samples;
    const color = samples?gl.createRenderbuffer():gl.createTexture(), depth = depthTexture?gl.createTexture():gl.createRenderbuffer(), fbo = gl.createFramebuffer();
    let resolved=null,resolveFbo=null;
    if(samples){
      gl.bindRenderbuffer(gl.RENDERBUFFER,color);gl.renderbufferStorageMultisample(gl.RENDERBUFFER,samples,gl.RGBA8,w*size,h*size);
      gl.bindRenderbuffer(gl.RENDERBUFFER,depth);gl.renderbufferStorageMultisample(gl.RENDERBUFFER,samples,gl.DEPTH24_STENCIL8,w*size,h*size);
      native.bindFramebuffer.call(gl,gl.FRAMEBUFFER,fbo);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.RENDERBUFFER,color);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_STENCIL_ATTACHMENT,gl.RENDERBUFFER,depth);
      if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('incomplete multisample target');
      if(size>1){
        resolved=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,resolved);
        gl.texStorage2D(gl.TEXTURE_2D,1,gl.RGBA8,w*size,h*size);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
        resolveFbo=gl.createFramebuffer();native.bindFramebuffer.call(gl,gl.FRAMEBUFFER,resolveFbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,resolved,0);
      }
    } else {
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,color);
    gl.texStorage2D(gl.TEXTURE_2D,1,gl.RGBA8,w*size,h*size);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    if(depthTexture){
      gl.bindTexture(gl.TEXTURE_2D,depth);gl.texStorage2D(gl.TEXTURE_2D,1,gl.DEPTH24_STENCIL8,w*size,h*size);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    }else{
      gl.bindRenderbuffer(gl.RENDERBUFFER,depth);gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH24_STENCIL8,w*size,h*size);
    }
    native.bindFramebuffer.call(gl,gl.FRAMEBUFFER,fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,color,0);
    if(depthTexture)gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.DEPTH_STENCIL_ATTACHMENT,gl.TEXTURE_2D,depth,0);
    else gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_STENCIL_ATTACHMENT,gl.RENDERBUFFER,depth);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE) throw new Error('incomplete sample target');
    }
    target={color,depth,fbo,w,h,samples,resolved,resolveFbo,depthTexture}; stats.gpuBytes=w*h*size*size*(samples?8*samples+(size>1?4:0):8);
    stats.maxSamples=gl.getParameter(gl.MAX_SAMPLES);stats.samples=samples;
    if (!program) {
      program=gl.createProgram();
      const vs=compile(gl.VERTEX_SHADER,`#version 300 es
      void main(){gl_Position=vec4(float((gl_VertexID<<1)&2)*2.-1.,float(gl_VertexID&2)*2.-1.,0.,1.);}`);
      const fs=compile(gl.FRAGMENT_SHADER,`#version 300 es
      precision highp float; uniform highp sampler2D samples; uniform float resolveOffset; out vec4 color;
      void main(){ivec2 p=ivec2(gl_FragCoord.xy-vec2(0.,resolveOffset))*${size}; vec4 sum=vec4(0.);
      for(int y=0;y<${size};y++)for(int x=0;x<${size};x++)sum+=texelFetch(samples,p+ivec2(x,y),0);
      color=sum/${(size*size).toFixed(1)};}`);
      gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);
      gl.deleteShader(vs);gl.deleteShader(fs);
      if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));
      sampler=gl.getUniformLocation(program,'samples');resolveOffset=gl.getUniformLocation(program,'resolveOffset');vao=gl.createVertexArray();
    }
  }
  function scale() { return active && drawing === target?.fbo ? TUNE.grid : 1; }
  function update() {
    if (!currentProgram) return;
    const value=scale();
    if (lastScale===value) return;
    const loc=locations.get(currentProgram);
    if (loc!=null) {
      const offset=active&&drawing===target?.fbo?tileY:0;
      if(loc.value!==value){gl.uniform1f(loc.scale,value);loc.value=value;}
      if(loc.offsetValue!==offset){gl.uniform1f(loc.offset,offset);loc.offsetValue=offset;}
    }
    lastScale=value;
  }
  function patch(source) {
    const v300=/^\s*#version\s+300\s+es/.test(source);
    // Diagnostic upper bound only; never enable this on a changing clock.
    if(Q.get('samplefixedday')==='1')source=source.replace('if(u_sunlight.x<.5||u_sunPresence.x<=0.0)return original;','').replace('return mix(original,displayColour(diffuse),u_sunPresence.x);','return displayColour(diffuse);').replaceAll('u_cityNight.x','0.0');
    if(Q.get('samplework')==='1')source=source.replace('if(kind>.5 && u_surfaceRange.x>.5) {',`if(kind>.5 && u_surfaceRange.x>.5 && (distance(u_eye,v_pos)<u_surfaceRange.z || (kind>1.5&&kind<2.5&&u_brickMottle.x>0.0&&distance(u_eye,v_pos)<u_brickMottle.w))) {`);
    if(Q.get('sampleshade')==='1')source=source.replace('vec3 n=normalize(normal),view=normalize(u_eye-pos);','vec2 shadeOffset=fract(SL_LIVE_FRAG.xy/sl_scale)-.5;pos-=dFdx(pos)*shadeOffset.x+dFdy(pos)*shadeOffset.y;vec3 n=normalize(normal),view=normalize(u_eye-pos);');
    if(Q.get('samplelight')==='1')source=source.replace('float visibility=sunlightVisibility(pos,n);','float visibility=facing>0.0?sunlightVisibility(pos,n):1.0;');
    // Calls only; keep preprocessor aliases such as '#define texture2D texture'.
    let s=source.replace(/\b(dFdx|dFdy|fwidth)\s*\(/g,(_,f)=>'sl_'+f+'(')
      .replace(/\bgl_FragCoord\b/g,'sl_fragCoord()')
      .replace(/\b(texture2D|texture)\s*\(/g,(_,f)=>'sl_'+f+'(');
    s=s.replaceAll('SL_LIVE_FRAG','gl_FragCoord');
    // Shadow maps have one nearest-filtered level; their footprint is invariant.
    if(Q.get('samplelight')==='1')s=s.replace(/sl_texture2D\(shadowMap,/g,'texture2D(shadowMap,');
    let prefix='\nprecision highp float; precision highp int; uniform highp float sl_scale; uniform highp float sl_offset;\n';
    prefix+='vec4 sl_fragCoord(){return vec4((floor(gl_FragCoord.xy/sl_scale+vec2(0.,sl_offset))+.5),gl_FragCoord.zw);}\n';
    if (/\bsl_(dFdx|dFdy|fwidth)\(/.test(s)) {
      for(const type of ['float','vec2','vec3','vec4'])for(const f of ['dFdx','dFdy','fwidth'])
        prefix+=`${type} sl_${f}(${type} v){return ${f}(v)*sl_scale;}\n`;
    }
    const tex=(name,builtin,type,coord)=>{
      if(v300 && Q.get('samplegrad')==='1'){
        const c=type==='sampler2DArray'?'uv.xy':'uv';
        prefix+=`vec4 ${name}(highp ${type} t,${coord} uv){if(sl_scale==1.)return ${builtin}(t,uv);return textureGrad(t,uv,dFdx(${c})*sl_scale,dFdy(${c})*sl_scale);}\n`;
        prefix+=`vec4 ${name}(highp ${type} t,${coord} uv,float bias){if(sl_scale==1.)return ${builtin}(t,uv,bias);float k=sl_scale*exp2(bias);return textureGrad(t,uv,dFdx(${c})*k,dFdy(${c})*k);}\n`;
      }else{
        prefix+=`vec4 ${name}(highp ${type} t,${coord} uv){return ${builtin}(t,uv,log2(sl_scale));}\n`;
        prefix+=`vec4 ${name}(highp ${type} t,${coord} uv,float bias){return ${builtin}(t,uv,bias+log2(sl_scale));}\n`;
      }
    };
    if(v300){
      for(const name of ['sl_texture','sl_texture2D']) if(s.includes(name+'(')) {
        tex(name,'texture','sampler2D','vec2');
        tex(name,'texture','sampler2DArray','vec3');
        tex(name,'texture','sampler3D','vec3');
        tex(name,'texture','samplerCube','vec3');
      }
    } else if(s.includes('sl_texture2D(')) tex('sl_texture2D','texture2D','sampler2D','vec2');
    // Extensions must appear before declarations. Put helper code after the last
    // extension, or the version line. Do not change a vertex program.
    let at=0;
    for(const m of s.matchAll(/^\s*#(?:version|extension)[^\n]*\n/gm))at=m.index+m[0].length;
    stats.patched++;return s.slice(0,at)+prefix+s.slice(at);
  }
  const API=window.SampleLattice={TUNE,stats,
    set(value){const changed=on!==!!value;on=!!value;if(map){if(!on){drop();if(changed)history?.reset('off');}map.triggerRepaint();}},
    history(value){if(historyEnabled!==!!value){historyEnabled=!!value;drop();history?.reset('switch');jitterFrame=0;}if(historyEnabled&&!history)history=window.TemporalResolve.create(gl,native);return history;},
    get temporal(){return history;},
    tiles(n){n=Math.max(1,Math.round(n));if(n!==TUNE.tiles){drop();TUNE.tiles=n;}},
    configure(grid=4,samples=0){if(grid!==TUNE.grid||samples!==TUNE.samples){drop();if(program)gl.deleteProgram(program);if(vao)gl.deleteVertexArray(vao);program=vao=null;TUNE.grid=grid;TUNE.samples=samples;}},
    get on(){return on;},get attached(){return attached;},
    get currentBand(){return active&&drawing===target?.fbo&&TUNE.tiles>1?band:null;},
    attach(m){
      if(attached)return;
      map=m;gl=m.painter.context.gl;
      if(!(gl instanceof WebGL2RenderingContext))throw new Error('sample lattice requires WebGL2');
      const names=['bindFramebuffer','viewport','scissor','useProgram','shaderSource','linkProgram','drawBuffers','readBuffer','depthRange'];
      native=Object.fromEntries(names.map(n=>[n,gl[n]])); native.render=m.painter.render;
      gl.depthRange=function(a,b){if(active&&a===0&&b>.5&&b<1)range3d=[a,b];return native.depthRange.call(this,a,b);};
      gl.shaderSource=function(shader,source){
        if(Q.get('sampleprofile')==='1')sources.set(shader,source);
        if(gl.getShaderParameter(shader,gl.SHADER_TYPE)===gl.FRAGMENT_SHADER)source=patch(source);
        return native.shaderSource.call(this,shader,source);
      };
      gl.linkProgram=function(p){const result=native.linkProgram.call(this,p);locations.set(p,{scale:gl.getUniformLocation(p,'sl_scale'),offset:gl.getUniformLocation(p,'sl_offset')});if(Q.get('sampleprofile')==='1'){API.programSources??=new Map();API.programSources.set(p,(gl.getAttachedShaders(p)||[]).map(s=>sources.get(s)||'').join('\n'));}return result;};
      gl.useProgram=function(p){const r=native.useProgram.call(this,p);currentProgram=p;lastScale=-1;update();return r;};
      gl.bindFramebuffer=function(t,fb){
        const f=active&&!fb?target.fbo:fb;
        const r=native.bindFramebuffer.call(this,t,f);
        if(t!==gl.READ_FRAMEBUFFER){drawing=f;lastScale=-1;update();}return r;
      };
      gl.viewport=function(x,y,w,h){const s=scale();return native.viewport.call(this,x*s,(y-(active&&drawing===target?.fbo?tileY:0))*s,w*s,h*s);};
      gl.scissor=function(x,y,w,h){const s=scale();return native.scissor.call(this,x*s,(y-(active&&drawing===target?.fbo?tileY:0))*s,w*s,h*s);};
      gl.drawBuffers=function(b){return native.drawBuffers.call(this,active&&b.length===1&&b[0]===gl.BACK?[gl.COLOR_ATTACHMENT0]:b);};
      gl.readBuffer=function(b){return native.readBuffer.call(this,active&&b===gl.BACK?gl.COLOR_ATTACHMENT0:b);};
      m.painter.render=function(){
        if(!on||gl.isContextLost()||document.getElementById('veil'))return native.render.apply(this,arguments);
        const w=gl.drawingBufferWidth,h=gl.drawingBufferHeight;
        if(TUNE.tiles>1&&(historyEnabled||TUNE.samples))throw Error('tiling requires independent spatial samples');
        const bandH=Math.ceil(h/TUNE.tiles);
        for(let tile=0;tile<TUNE.tiles;tile++){
        tileY=tile*bandH;const tileH=Math.min(bandH,h-tileY);if(tileH<=0)break;
        band.low=Math.max(-1,2*(tileY-1)/h-1);band.high=Math.min(1,2*(tileY+tileH+1)/h-1);
        ensure(w,bandH);
        let basePadding=null,jitter=[0,0];
        if(historyEnabled){
          const side=4/TUNE.grid,j=jitterFrame++%(side*side);
          jitter=[((j%side)+.5)/4-1/(2*TUNE.grid),(Math.floor(j/side)+.5)/4-1/(2*TUNE.grid)];
          basePadding=map.transform.padding;
          const ratio=map.getPixelRatio(),dx=2*jitter[0]/ratio,dy=-2*jitter[1]/ratio;
          map.transform.setPadding({left:basePadding.left+Math.max(0,dx),right:basePadding.right+Math.max(0,-dx),top:basePadding.top+Math.max(0,dy),bottom:basePadding.bottom+Math.max(0,-dy)});
        }
        active=true;drawing=target.fbo;
        native.bindFramebuffer.call(gl,gl.FRAMEBUFFER,drawing);
        map.painter.context.setDirty();
        try { native.render.apply(this,arguments); }
        finally {
          active=false;drawing=null;native.bindFramebuffer.call(gl,gl.FRAMEBUFFER,null);
          if(basePadding)map.transform.setPadding(basePadding);
        }
        gl.disable(gl.DEPTH_TEST);gl.disable(gl.STENCIL_TEST);gl.disable(gl.CULL_FACE);
        gl.disable(gl.SCISSOR_TEST);gl.disable(gl.BLEND);gl.colorMask(true,true,true,true);
        if(historyEnabled){
          const r=history.resolve({color:target.color,depth:target.depth,w,h,grid:TUNE.grid,currentMatrix:window.slopes.camera.projectionMatrix,depthRange:range3d,jitter});
          native.bindFramebuffer.call(gl,gl.READ_FRAMEBUFFER,r.fbo);native.bindFramebuffer.call(gl,gl.DRAW_FRAMEBUFFER,null);
          gl.blitFramebuffer(0,0,w,h,0,0,w,h,gl.COLOR_BUFFER_BIT,gl.NEAREST);
          native.bindFramebuffer.call(gl,gl.FRAMEBUFFER,null);
          gl.colorMask(false,false,false,true);gl.clearColor(0,0,0,1);gl.clear(gl.COLOR_BUFFER_BIT);gl.colorMask(true,true,true,true);
          map.painter.context.setDirty();stats.frames++;stats.history=history.stats;
          if(!r.converged)map.triggerRepaint();return;
        }
        if(target.samples){
          native.bindFramebuffer.call(gl,gl.READ_FRAMEBUFFER,target.fbo);
          native.bindFramebuffer.call(gl,gl.DRAW_FRAMEBUFFER,target.resolveFbo);
          gl.blitFramebuffer(0,0,w*TUNE.grid,h*TUNE.grid,0,0,w*TUNE.grid,h*TUNE.grid,gl.COLOR_BUFFER_BIT,gl.NEAREST);
          native.bindFramebuffer.call(gl,gl.FRAMEBUFFER,null);
          if(TUNE.grid===1){map.painter.context.setDirty();stats.frames++;return;}
        }
        native.viewport.call(gl,0,tileY,w,tileH);gl.useProgram(program);gl.uniform1f(resolveOffset,tileY);gl.bindVertexArray(vao);
        gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,target.resolved||target.color);gl.uniform1i(sampler,0);
        gl.drawArrays(gl.TRIANGLES,0,3);gl.bindTexture(gl.TEXTURE_2D,null);gl.bindVertexArray(null);
        map.painter.context.setDirty();stats.frames++;
        }
        tileY=0;
      };
      gl.canvas.addEventListener('webglcontextlost',()=>{target=program=vao=null;stats.gpuBytes=0;active=false;});
      attached=true;
    }
  };
})();
