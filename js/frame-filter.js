/* Opt-in temporal frame filter. One native scene render per requested frame.
 * The soft depth gate can admit wrong-surface history at disocclusions; RGB
 * clamping limits trails but does not prove detail preservation. Hardware
 * quality/cost/recovery validation is required before enabling by default.
 */
(() => {
  const W=window;
  if(W.FrameFilter)return;
  const params={postResolveNames:true,stableBackground:true,historyWeight:.875,rejectedHistoryWeight:.5,depthBase:.000002,depthSlope:1,depthMax:.0001,
    cutDegrees:.002,cutZoom:.35,cutBearing:25,cutPitch:15,jitterScale:1,
    jitterOffsets:[[-.375,-.125],[.125,.375],[.375,-.375],[-.125,.125],[.125,-.125],[-.375,.375],[-.125,-.375],[.375,.125]]};
  function createEngine(map,P,fail){
  const slopes=W.slopes,renderer=slopes.renderer,sceneLayer=slopes.layer,painter=map.painter,gl=painter.context.gl;
  if(W.FrameTarget?.attached)throw Error('Another frame target is attached');
  // graphics.js seeds this before attach so a later AE toggle cannot wrap our hook.
  if(W.GLSTATE?.on&&!gl.__aeState)throw Error('Initialize graphics GL tracking before FrameFilter');
  const attrs=gl.getContextAttributes();
  if(!gl.createVertexArray||!attrs||attrs.antialias||!attrs.preserveDrawingBuffer)
    throw Error('Frame filter needs non-MSAA WebGL2 with preserved canvas');
  const nameLayer=map.style?._layers?.['city-name-labels']?.implementation;
  if(typeof nameLayer?.render!=='function')throw Error('Ready city-name-labels custom layer required');
  if(gl.getParameter(gl.FRAMEBUFFER_BINDING)!==null)throw Error('Install names trial at default framebuffer');
  const defaultDepthBits=gl.getParameter(gl.DEPTH_BITS),defaultStencilBits=gl.getParameter(gl.STENCIL_BITS);
  const native={bind:gl.bindFramebuffer,draw:gl.drawBuffers,read:gl.readBuffer,
    render:painter.render,layer:sceneLayer.render,names:nameLayer.render};
  if(typeof painter.context.setDefault!=='function'||typeof painter.context.viewport?.set!=='function')
    throw Error('MapLibre context defaults and viewport setter required');
  // One-time contract check only. Current MapLibre/Three/project callers use
  // texture state, not sampler objects; do not silently erase foreign samplers.
  const initialTextureUnit=gl.getParameter(gl.ACTIVE_TEXTURE);
  try{for(let i=0;i<4;i++){
    gl.activeTexture(gl.TEXTURE0+i);
    if(gl.getParameter(gl.SAMPLER_BINDING)!==null)throw Error('Neutral handoff requires unbound sampler units0..3');
  }}finally{gl.activeTexture(initialTextureUnit);}
  // BEGIN DEPTH RANGE TRACKER: no queries on normal per-frame setters/reads.
  const nativeDepthRange=gl.depthRange;
  let depthTrackingActive=true;
  const depthRangeRecord={known:false,value:null,queries:0,calls:0,invalidations:0};
  function invalidateDepthRange(){depthRangeRecord.known=false;depthRangeRecord.invalidations++;}
  function seedDepthRange(){
    const actual=gl.getParameter(gl.DEPTH_RANGE);depthRangeRecord.queries++;
    depthRangeRecord.known=!gl.isContextLost()&&!!actual&&actual.length===2&&Array.from(actual).every(Number.isFinite);
    if(depthRangeRecord.known)depthRangeRecord.value=Array.from(actual);
    return depthRangeRecord.known;
  }
  function readDepthRange(){
    if(!depthRangeRecord.known&&!seedDepthRange())throw Error('Actual depth range unavailable');
    const value=depthRangeRecord.value.slice(),GS=W.GLSTATE;
    if(GS?.check)GS.verify(gl,'taa.depthRange',gl.DEPTH_RANGE,value);
    return value;
  }
  const trackedDepthRange=function(n,f){
    if(!depthTrackingActive)return nativeDepthRange.apply(this,arguments);
    depthRangeRecord.calls++;
    const ordinary=this===gl&&arguments.length===2&&typeof n==='number'&&typeof f==='number'&&
      Number.isFinite(n)&&Number.isFinite(f)&&n<=f&&Number.isFinite(Math.fround(n))&&Number.isFinite(Math.fround(f));
    // Mark unknown first: if native conversion/validation throws, it stays so.
    invalidateDepthRange();
    const result=nativeDepthRange.apply(this,arguments);
    if(ordinary&&!gl.isContextLost()){
      // WebIDL GLclampf converts to float32, then GL clamps to [0,1]. For a
      // reversed pair, deliberately query later instead of guessing whether
      // validation happened before or after clamp/conversion.
      depthRangeRecord.value=[n,f].map(x=>Math.fround(Math.max(0,Math.min(1,Math.fround(x)))));
      depthRangeRecord.known=true;
    }
    return result;
  };
  if(!seedDepthRange())throw Error('Install tracked depth only on a live context');
  gl.depthRange=trackedDepthRange;
  // END DEPTH RANGE TRACKER
  let nameTrackingActive=true,deferredNames=null,depthCopySizeKey='',postNameCalls=0,postNameDepthChecks=0;
  let on=false,painting=false,redirect=null,targets=null,program=null,vao=null,U=null;
  let prev=null,captured=null,jitter=[0,0],seq=0,valid=false,historyIndex=0,age=0,lastCamera=null,lastHour=null;
  const stats={sceneFrames:0,resolves:0,captures:0,resets:0,lastReset:'install',failures:0,neutralHandoffs:0,fallbackFrames:0};
  // Offsets are in drawing-buffer pixels; y below is screen-down.
  const offsets=P.jitterOffsets;
  const dirty=()=>painter.context.setDirty();
  function reset(reason='manual'){valid=false;age=0;prev=null;stats.resets++;stats.lastReset=reason;}
  const vertex=`#version 300 es
  void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.-1.,0.,1.);}`;
  const fragment=`#version 300 es
  precision highp float;
  precision highp sampler2D;
  uniform sampler2D curColor,curDepth,oldColor,oldDepth;
  uniform mat4 reprojectionMatrix;
  uniform vec2 size,rangeNow,rangePrevious,jitterNow,jitterPrevious;
  uniform vec4 rejection;
  uniform float weight,stableBackground;
  out vec4 outColor;
  void main(){
    ivec2 ip=ivec2(gl_FragCoord.xy), hi=ivec2(size)-1;
    vec2 uv=gl_FragCoord.xy/size;
    vec4 c=texelFetch(curColor,ip,0);
    float d=texelFetch(curDepth,ip,0).r;
    gl_FragDepth=d;
    outColor=c;
    float z=2.*(d-rangeNow.x)/(rangeNow.y-rangeNow.x)-1.;
    vec4 p=reprojectionMatrix*vec4(uv*2.-1.,z,1.);
    vec3 ndc=p.xyz/max(p.w,1.e-20);
    // Cancel only lens jitter from camera motion. Static surfaces retain
    // new subpixel samples instead of re-aligning every frame's sample grid.
    vec2 oldDepthUV=ndc.xy*.5+.5;
    vec2 oldUV=oldDepthUV-jitterPrevious+jitterNow;
    float expected=mix(rangePrevious.x,rangePrevious.y,ndc.z*.5+.5);
    float slope=abs(dFdx(expected))+abs(dFdy(expected));
    float tolerance=min(rejection.z,rejection.x+rejection.y*slope);
    bool accept=weight>0.&&d>rangeNow.x&&d<rangeNow.y&&p.w>0.&&
      ndc.z> -1.&&ndc.z<1.&&all(greaterThanEqual(oldUV,vec2(.5)/size))&&
      all(lessThanEqual(oldUV,vec2(1.)-vec2(.5)/size));
    accept=accept&&all(greaterThanEqual(oldDepthUV,vec2(.5)/size))&&all(lessThanEqual(oldDepthUV,vec2(1.)-vec2(.5)/size));
    // Experimental coverage acceptance: the four depth texels around the
    // actual previous projection may contain different subpixel surfaces.
    // Exclude sky/invalid range so a clear depth cannot widen the interval.
    // A min/max interval can still bridge separate opaque surfaces: the
    // unchanged color clamp does NOT guarantee absence of disocclusion trails.
    ivec2 previousBase=ivec2(floor(oldDepthUV*size-.5));
    float depthLo=rangePrevious.y,depthHi=rangePrevious.x;
    bool depthCovered=false;
    for(int dy=0;dy<2;dy++)for(int dx=0;dx<2;dx++){
      float q=texelFetch(oldDepth,clamp(previousBase+ivec2(dx,dy),ivec2(0),hi),0).r;
      if(q>rangePrevious.x&&q<rangePrevious.y){depthLo=min(depthLo,q);depthHi=max(depthHi,q);depthCovered=true;}
    }
    accept=accept&&depthCovered;
    bool depthMatches=expected>=depthLo-tolerance&&expected<=depthHi+tolerance;
    vec3 lo=c.rgb, hiColor=c.rgb;
    for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
      vec3 s=texelFetch(curColor,clamp(ip+ivec2(x,y),ivec2(0),hi),0).rgb;
      lo=min(lo,s);hiColor=max(hiColor,s);
    }
    vec3 h=clamp(texture(oldColor,clamp(oldUV,vec2(0.),vec2(1.))).rgb,lo,hiColor);
    // A reset/invalid projection still gives zero history. A depth mismatch
    // gets at most rejectedHistoryWeight, never more than the ordinary age weight.
    float historyWeight=accept?(depthMatches?weight:min(weight,rejection.w)):0.;
    outColor=vec4(mix(c.rgb,h,historyWeight),c.a);
    // Keep this after every derivative-dependent computation and all 3D
    // shading. A scene shifted by +J has C(u)=F(u-J), hence C(u+J)=F(u).
    // Explicit LOD avoids derivatives in this potentially divergent branch.
    // No broad geometry/material classification: only the existing depth range.
    if(stableBackground>.5&&!(d>rangeNow.x&&d<rangeNow.y)){
      outColor=textureLod(curColor,clamp(uv+jitterNow,vec2(.5)/size,vec2(1.)-vec2(.5)/size),0.);
    }
  }`;
  function makeProgram(){
    const shaders=[];
    try{
      for(const [type,source] of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]]){
        const s=gl.createShader(type);shaders.push(s);gl.shaderSource(s,source);gl.compileShader(s);
        if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));
      }
      program=gl.createProgram();for(const s of shaders)gl.attachShader(program,s);gl.linkProgram(program);
      if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
      vao=gl.createVertexArray();U={};
      for(const n of ['curColor','curDepth','oldColor','oldDepth','reprojectionMatrix','size','rangeNow','rangePrevious','jitterNow','jitterPrevious','rejection','weight','stableBackground'])U[n]=gl.getUniformLocation(program,n);
    }catch(e){if(program)gl.deleteProgram(program);program=null;throw e;}
    finally{for(const s of shaders)gl.deleteShader(s);}
  }
  function freeTargets(){
    if(targets)for(const t of targets){gl.deleteFramebuffer(t.fb);gl.deleteTexture(t.color);gl.deleteTexture(t.depth);}
    targets=null;reset('target disposed');
  }
  function ensure(){
    const w=gl.drawingBufferWidth,h=gl.drawingBufferHeight;
    if(targets&&targets[0].w===w&&targets[0].h===h)return;
    freeTargets();if(!program)makeProgram();
    const old={read:gl.getParameter(gl.READ_FRAMEBUFFER_BINDING),draw:gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING),tex:gl.getParameter(gl.TEXTURE_BINDING_2D)};
    targets=[];
    try{
      for(let i=0;i<3;i++){
        const t={fb:gl.createFramebuffer(),color:gl.createTexture(),depth:gl.createTexture(),w,h};targets.push(t);
        for(const [texture,depth] of [[t.color,false],[t.depth,true]]){
          gl.bindTexture(gl.TEXTURE_2D,texture);
          gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,depth?gl.NEAREST:gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,depth?gl.NEAREST:gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
          gl.texImage2D(gl.TEXTURE_2D,0,depth?gl.DEPTH24_STENCIL8:gl.RGBA8,w,h,0,depth?gl.DEPTH_STENCIL:gl.RGBA,depth?gl.UNSIGNED_INT_24_8:gl.UNSIGNED_BYTE,null);
        }
        native.bind.call(gl,gl.FRAMEBUFFER,t.fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,t.color,0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.DEPTH_STENCIL_ATTACHMENT,gl.TEXTURE_2D,t.depth,0);
        t.complete=gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE;
        if(!t.complete)throw Error('TAA texture framebuffer incomplete');
      }
    }catch(e){freeTargets();throw e;}
    finally{gl.bindTexture(gl.TEXTURE_2D,old.tex);native.bind.call(gl,gl.READ_FRAMEBUFFER,old.read);native.bind.call(gl,gl.DRAW_FRAMEBUFFER,old.draw);dirty();}
  }
  const bind=function(kind,fb){return native.bind.call(this,kind,fb===null&&redirect?redirect:fb);};
  const draw=function(b){return native.draw.call(this,redirect&&b.length===1&&b[0]===gl.BACK?[gl.COLOR_ATTACHMENT0]:b);};
  const read=function(b){return native.read.call(this,redirect&&b===gl.BACK?gl.COLOR_ATTACHMENT0:b);};
  gl.bindFramebuffer=bind;gl.drawBuffers=draw;gl.readBuffer=read;
  const layer=function(glArg,args,prepareOnly=false){
    const before=slopes.frames,range=painting&&!prepareOnly?readDepthRange():null;
    const result=native.layer.apply(this,arguments);
    if(painting&&!prepareOnly&&slopes.frames>before){
      captured={matrix:slopes.camera.projectionMatrix.clone(),inverse:slopes.camera.projectionMatrixInverse.clone(),range,jitter:jitter.slice()};stats.captures++;
    }
    return result;
  };
  sceneLayer.render=layer;
  const namesRender=function(glArg,args){
    if(!nameTrackingActive||!on||!painting||!P.postResolveNames)return native.names.apply(this,arguments);
    if(deferredNames)throw Error('Expected one city-name-labels draw per scene frame');
    const original=args.defaultProjectionData?.mainMatrix;
    if(!original||original.length!==16)throw Error('Custom name projection missing');
    const M=Array.from(original);
    // Remove clip-space lens translation, retaining z/w and all world units.
    for(let col=0;col<4;col++){
      M[col*4]-=2*jitter[0]*original[col*4+3];
      M[col*4+1]-=2*jitter[1]*original[col*4+3];
    }
    deferredNames={receiver:this,args:{...args,defaultProjectionData:{...args.defaultProjectionData,mainMatrix:M}},
      range:readDepthRange(),currentLayer:map.painter.currentLayer,renderPass:map.painter.renderPass};
  };
  nameLayer.render=namesRender;
  function drawDeferredNames(){
    const d=deferredNames;deferredNames=null;
    if(!d||gl.isContextLost())return;
    if(defaultDepthBits!==24||defaultStencilBits!==8)throw Error('Default24/8 depth/stencil required for raw-depth name copy');
    const context=map.painter.context,painter=map.painter,t=targets[0];
    const oldLayer=painter.currentLayer,oldPass=painter.renderPass,key=t.w+'x'+t.h;
    try{
      gl.disable(gl.SCISSOR_TEST);
      if(depthCopySizeKey!==key){const error=gl.getError();if(error)throw Error('GL error before name depth copy: '+error);}
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER,t.fb);gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,null);
      gl.blitFramebuffer(0,0,t.w,t.h,0,0,t.w,t.h,gl.DEPTH_BUFFER_BIT,gl.NEAREST);
      if(depthCopySizeKey!==key){const error=gl.getError();if(error)throw Error('Default depth-copy incompatibility: '+error);depthCopySizeKey=key;postNameDepthChecks++;}
      if(gl.isContextLost())return;
      // The label's copyDepth reads this real default framebuffer and the
      // same3D range as its original MapLibre custom-layer callback.
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);context.setDirty();context.bindFramebuffer.set(null);
      painter.currentLayer=d.currentLayer;painter.renderPass=d.renderPass;
      painter.setCustomLayerDefaults();context.setDepthMode(painter.getDepthModeFor3D());context.depthRange.set(d.range);
      context.viewport.set([0,0,painter.width,painter.height]);
      native.names.call(d.receiver,gl,d.args);postNameCalls++;
    }finally{
      painter.currentLayer=oldLayer;painter.renderPass=oldPass;
      if(!gl.isContextLost()){
        context.setDirty();context.setDefault();painter.setBaseState();gl.bindFramebuffer(gl.FRAMEBUFFER,null);
        if(gl.__aeState){gl.__aeState.read=null;gl.__aeState.draw=null;}context.setDirty();
      }
    }
  }

  const passCaps=[gl.BLEND,gl.DEPTH_TEST,gl.STENCIL_TEST,gl.SCISSOR_TEST,gl.CULL_FACE,gl.RASTERIZER_DISCARD,gl.POLYGON_OFFSET_FILL];
  function neutralHandoff(){
    if(gl.isContextLost())return;
    const context=painter.context;
    try{
      for(let i=0;i<4;i++){
        gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,null);gl.bindSampler(i,null);
      }
      // These are not covered by MapLibre Context.setDefault/setDirty.
      gl.disable(gl.SCISSOR_TEST);gl.disable(gl.RASTERIZER_DISCARD);gl.disable(gl.POLYGON_OFFSET_FILL);
      context.setDirty();context.setDefault();
      context.viewport.set([0,0,painter.width,painter.height]);
    }finally{
      if(!gl.isContextLost()){
        gl.bindFramebuffer(gl.FRAMEBUFFER,null);
        if(gl.__aeState){gl.__aeState.read=null;gl.__aeState.draw=null;}
        // Ensure later resource preparation also rebinds its own textures/VAO.
        context.setDirty();
      }
    }
    stats.neutralHandoffs++;
  }
  function resolve(){
    if(!captured)throw Error('No real slopes render captured for this TAA frame');
    const current=targets[0],old=targets[1+historyIndex],dest=targets[2-historyIndex];
    try{
      for(const k of passCaps)gl.disable(k);gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.ALWAYS);gl.depthMask(true);gl.depthRange(0,1);gl.colorMask(true,true,true,true);
      gl.viewport(0,0,current.w,current.h);gl.useProgram(program);gl.bindVertexArray(vao);
      native.bind.call(gl,gl.FRAMEBUFFER,dest.fb);native.draw.call(gl,[gl.COLOR_ATTACHMENT0]);
      for(const [i,texture] of [current.color,current.depth,old.color,old.depth].entries()){
        gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,texture);gl.bindSampler(i,null);
      }
      for(const [i,n] of ['curColor','curDepth','oldColor','oldDepth'].entries())gl.uniform1i(U[n],i);
      const previous=prev||captured;
      // Compose in CPU double precision before converting once for GLSL.
      const reprojection=previous.matrix.clone().multiply(captured.inverse);
      gl.uniformMatrix4fv(U.reprojectionMatrix,false,reprojection.elements);
      gl.uniform2f(U.size,current.w,current.h);gl.uniform2fv(U.rangeNow,captured.range);gl.uniform2fv(U.rangePrevious,previous.range);
      gl.uniform2fv(U.jitterNow,captured.jitter);gl.uniform2fv(U.jitterPrevious,previous.jitter);
      gl.uniform4f(U.rejection,P.depthBase,P.depthSlope,P.depthMax,Math.max(0,Math.min(1,P.rejectedHistoryWeight)));
      gl.uniform1f(U.weight,valid?Math.max(0,Math.min(.99,P.historyWeight,age/(age+1))):0);
      gl.uniform1f(U.stableBackground,P.stableBackground?1:0);
      gl.drawArrays(gl.TRIANGLES,0,3);
      if(gl.isContextLost()){reset('context loss during resolve');return;}
      native.bind.call(gl,gl.READ_FRAMEBUFFER,dest.fb);native.bind.call(gl,gl.DRAW_FRAMEBUFFER,null);
      gl.blitFramebuffer(0,0,current.w,current.h,0,0,current.w,current.h,gl.COLOR_BUFFER_BIT,gl.NEAREST);
      prev=captured;historyIndex=1-historyIndex;valid=true;age++;stats.resolves++;
    }finally{
      if(!gl.isContextLost())neutralHandoff();
    }
  }
  function camera(){const c=map.getCenter();return [c.lng,c.lat,map.getZoom(),map.getBearing(),map.getPitch()];}
  function cut(c){return lastCamera&&(Math.abs(c[0]-lastCamera[0])>P.cutDegrees||Math.abs(c[1]-lastCamera[1])>P.cutDegrees||Math.abs(c[2]-lastCamera[2])>P.cutZoom||Math.abs(((c[3]-lastCamera[3]+540)%360)-180)>P.cutBearing||Math.abs(c[4]-lastCamera[4])>P.cutPitch);}
  const render=function(){
    if(!on||gl.isContextLost()||map.painter!==painter||slopes.renderer!==renderer)return native.render.apply(this,arguments);
    try{ensure();}catch(e){on=false;stats.failures++;fail(e);return native.render.apply(this,arguments);}
    const c=camera(),hour=W.__todCurrentP??null;
    if(cut(c))reset('camera cut');if(hour!==lastHour)reset('hour');lastCamera=c;lastHour=hour;
    const tr=map.transform,base={...tr.padding},[jx,jy]=offsets[seq++%offsets.length],ratio=map.getPixelRatio();
    const dx=2*jx*P.jitterScale/ratio,dy=2*jy*P.jitterScale/ratio;
    jitter=[jx*P.jitterScale/gl.drawingBufferWidth,-jy*P.jitterScale/gl.drawingBufferHeight];
    captured=null;deferredNames=null;painting=true;redirect=targets[0].fb;native.bind.call(gl,gl.FRAMEBUFFER,redirect);
    let completed=false;
    try{
      tr.setPadding({left:base.left+Math.max(0,dx),right:base.right+Math.max(0,-dx),top:base.top+Math.max(0,dy),bottom:base.bottom+Math.max(0,-dy)});
      const result=native.render.apply(this,arguments);completed=true;stats.sceneFrames++;return result;
    }finally{
      // Always restore real camera and remove redirection, including failed draws.
      tr.setPadding(base);redirect=null;
      try{if(completed&&!gl.isContextLost()){resolve();drawDeferredNames();}else reset('incomplete scene');}
      catch(e){
        on=false;stats.failures++;reset('resolve failed');
        // Preserve this frame's native scene instead of drawing the city twice.
        if(!gl.isContextLost()&&targets){
          try{native.bind.call(gl,gl.READ_FRAMEBUFFER,targets[0].fb);native.bind.call(gl,gl.DRAW_FRAMEBUFFER,null);
            gl.blitFramebuffer(0,0,targets[0].w,targets[0].h,0,0,targets[0].w,targets[0].h,gl.COLOR_BUFFER_BIT,gl.NEAREST);drawDeferredNames();stats.fallbackFrames++;
          }catch(copyError){e=new Error(e.message+'; native frame copy: '+copyError.message);}
          finally{try{neutralHandoff();}catch(cleanupError){e=new Error(e.message+'; cleanup: '+cleanupError.message);}}
        }
        fail(e);
      }
      finally{painting=false;if(!gl.isContextLost()){native.bind.call(gl,gl.FRAMEBUFFER,null);if(gl.__aeState){gl.__aeState.read=null;gl.__aeState.draw=null;}dirty();}}
    }
  };
  painter.render=render;
  return {painter,renderer,gl,nameLayer,layer:sceneLayer,
    enable(){ensure();on=true;seq=0;lastCamera=null;lastHour=null;reset('enabled');},
    reset,
    proof(){return {on,...stats,historyValid:valid,historyAge:age,sequence:seq,
      postResolveNames:{enabled:P.postResolveNames,calls:postNameCalls,depthCopyChecks:postNameDepthChecks,defaultDepthBits,defaultStencilBits},
      depthRangeTracking:{...depthRangeRecord,value:depthRangeRecord.value?.slice()},
      depthRange:captured?.range,jitterUV:captured?.jitter,
      currentMatrix:captured?.matrix.elements.slice(),inverseMatrix:captured?.inverse.elements.slice(),
      textureFramebuffersComplete:!!targets&&targets.every(t=>t.complete),
      size:targets?[targets[0].w,targets[0].h]:null,nominalTextureBytes:targets?targets[0].w*targets[0].h*24:0};},
    dispose(){on=false;redirect=null;deferredNames=null;nameTrackingActive=false;
      if(nameLayer.render===namesRender)nameLayer.render=native.names;
      depthTrackingActive=false;invalidateDepthRange();
      if(gl.depthRange===trackedDepthRange)gl.depthRange=nativeDepthRange;
      if(gl.bindFramebuffer===bind)gl.bindFramebuffer=native.bind;
      if(gl.drawBuffers===draw)gl.drawBuffers=native.draw;if(gl.readBuffer===read)gl.readBuffer=native.read;
      if(painter.render===render)painter.render=native.render;
      if(sceneLayer.render===layer)sceneLayer.render=native.layer;
      if(!gl.isContextLost()){freeTargets();if(program)gl.deleteProgram(program);if(vao)gl.deleteVertexArray(vao);dirty();}
      targets=null;program=null;vao=null;reset('detached');
    }
  };
  }

  let map=null,canvas=null,engine=null,desired=false,blocked=false,lastError=null,lastProof=null;
  const lifecycle={attachments:0,recoveries:0,failures:0};
  function drop(){if(engine){lastProof=engine.proof();engine.dispose();engine=null;}}
  function failed(error){lastError=String(error?.message||error);blocked=true;lifecycle.failures++;}
  function ready(){const S=W.slopes,A=W.slopesApartments;
    return map&&map.painter?.context?.gl&&!map.painter.context.gl.isContextLost()&&S?.renderer&&S.camera&&S.layer&&
      map.getLayer(S.layer.id)&&typeof map.style?._layers?.['city-name-labels']?.implementation?.render==='function'&&A?.count?.done&&A.readyToReveal();}
  function sync(){
    if(engine&&(engine.painter!==map?.painter||engine.renderer!==W.slopes?.renderer||engine.layer!==W.slopes?.layer||engine.nameLayer!==map.style?._layers?.['city-name-labels']?.implementation||blocked||!desired||!ready()))drop();
    if(!desired||blocked||engine||!ready())return;
    try{engine=createEngine(map,params,failed);engine.enable();lifecycle.attachments++;map.triggerRepaint();}
    catch(e){failed(e);drop();}
  }
  function lost(){blocked=true;drop();}
  function restored(){blocked=false;lifecycle.recoveries++;sync();}
  function style(){engine?.reset('style load');sync();}
  const api={params,
    attach(next){if(map===next)return api;if(map)api.detach();map=next;canvas=map.getCanvas();
      map.on('render',sync);map.on('style.load',style);map.on('styledata',sync);map.on('resize',sync);map.on('remove',api.detach);
      canvas.addEventListener('webglcontextlost',lost);canvas.addEventListener('webglcontextrestored',restored);sync();return api;},
    setEnabled(value){desired=!!value;blocked=false;lastError=null;sync();map?.triggerRepaint();return api;},
    reset(){engine?.reset('manual');map?.triggerRepaint();},
    proof(){return {desired,attached:!!engine,blocked,lastError,...lifecycle,engine:engine?.proof()||null,lastEngine:lastProof,params};},
    detach(){drop();if(map){map.off('render',sync);map.off('style.load',style);map.off('styledata',sync);map.off('resize',sync);map.off('remove',api.detach);
      canvas.removeEventListener('webglcontextlost',lost);canvas.removeEventListener('webglcontextrestored',restored);}
      map=null;canvas=null;return api;}
  };
  W.FrameFilter=api;
})();
