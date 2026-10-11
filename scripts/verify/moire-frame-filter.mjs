import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../../js/frame-filter.js',import.meta.url),'utf8');
// Translation matrices suffice to test sign, jitter cancellation and depth UV
// separation. These are not a substitute for the real map/GPU proof.
const matrix=(x=0,y=0)=>({elements:[1,0,0,0,0,1,0,0,0,0,1,0,x,y,0,1],clone(){return matrix(this.elements[12],this.elements[13]);},multiply(other){this.elements[12]+=other.elements[12];this.elements[13]+=other.elements[13];return this;}});
const project=(M,p)=>[p[0]+M.elements[12],p[1]+M.elements[13]];
for(const [jNow,jPrev,motion] of [[.125,-.375,0],[-.375,.375,.03],[.375,.125,-.04]]){
  const uv=.45,scale=960,cur=matrix(2*jNow/scale),old=matrix(2*(jPrev/scale+motion));
  const world=project(matrix(-cur.elements[12]),[uv*2-1,0]);
  const prevClip=project(old,world),depthUV=prevClip[0]*.5+.5,colorUV=depthUV-jPrev/scale+jNow/scale;
  assert.ok(Math.abs(colorUV-(uv+motion))<1e-12);
  assert.ok(Math.abs(depthUV-(uv+motion+(jPrev-jNow)/scale))<1e-12);
}
let parameterQueries=0,contextLost=false;
let read=null,draw=null,active=0,range=[0,.958984],currentProgram=null,vao=null,padding={left:0,right:0,top:0,bottom:0},sceneDraws=0,fullDraws=0,blits=0,deletes=0;
let width=960,height=600,center={lng:0,lat:0},layers=0;
const tex={},samplers={},listeners={},uniforms={},enabled=new Set();
const constants=['FRAMEBUFFER','READ_FRAMEBUFFER','DRAW_FRAMEBUFFER','READ_FRAMEBUFFER_BINDING','DRAW_FRAMEBUFFER_BINDING','BACK','COLOR_ATTACHMENT0','TEXTURE_2D','TEXTURE_BINDING_2D','TEXTURE_MIN_FILTER','TEXTURE_MAG_FILTER','TEXTURE_WRAP_S','TEXTURE_WRAP_T','NEAREST','LINEAR','CLAMP_TO_EDGE','DEPTH24_STENCIL8','RGBA8','DEPTH_STENCIL','RGBA','UNSIGNED_INT_24_8','UNSIGNED_BYTE','DEPTH_STENCIL_ATTACHMENT','FRAMEBUFFER_COMPLETE','VERTEX_SHADER','FRAGMENT_SHADER','COMPILE_STATUS','LINK_STATUS','BLEND','DEPTH_TEST','STENCIL_TEST','SCISSOR_TEST','CULL_FACE','RASTERIZER_DISCARD','POLYGON_OFFSET_FILL','CURRENT_PROGRAM','VERTEX_ARRAY_BINDING','ACTIVE_TEXTURE','VIEWPORT','DEPTH_RANGE','DEPTH_FUNC','DEPTH_WRITEMASK','COLOR_WRITEMASK','SAMPLER_BINDING','ALWAYS','TRIANGLES','COLOR_BUFFER_BIT','SAMPLES','FRAMEBUFFER_BINDING','DEPTH_BITS','STENCIL_BITS','DEPTH_BUFFER_BIT'];
const gl={TEXTURE0:0,get drawingBufferWidth(){return width;},get drawingBufferHeight(){return height;}};
for(const k of constants)gl[k]=k;
Object.assign(gl,{
 getError:()=>0,getContextAttributes:()=>({antialias:false,preserveDrawingBuffer:true}),isContextLost:()=>contextLost,
 canvas:{addEventListener:(n,f)=>{(listeners[n]??=new Set()).add(f);},removeEventListener:(n,f)=>listeners[n]?.delete(f)},
 getParameter(k){parameterQueries++;return {FRAMEBUFFER_BINDING:draw,DEPTH_BITS:24,STENCIL_BITS:8,READ_FRAMEBUFFER_BINDING:read,DRAW_FRAMEBUFFER_BINDING:draw,TEXTURE_BINDING_2D:tex[active]??null,CURRENT_PROGRAM:currentProgram,VERTEX_ARRAY_BINDING:vao,ACTIVE_TEXTURE:active,VIEWPORT:[0,0,width,height],DEPTH_RANGE:range.slice(),DEPTH_FUNC:'ALWAYS',DEPTH_WRITEMASK:true,COLOR_WRITEMASK:[true,true,true,true],SAMPLER_BINDING:samplers[active]??null,SAMPLES:0}[k];},
 createVertexArray:()=>({}),createShader:()=>({}),shaderSource:()=>{},compileShader:()=>{},getShaderParameter:()=>true,deleteShader:()=>{},
 createProgram:()=>({}),attachShader:()=>{},linkProgram:()=>{},getProgramParameter:()=>true,getUniformLocation:(_,n)=>n,deleteProgram:()=>{},deleteVertexArray:()=>{},
 createFramebuffer:()=>({}),createTexture:()=>({}),deleteFramebuffer:()=>deletes++,deleteTexture:()=>deletes++,
 bindTexture:(_,t)=>tex[active]=t,texParameteri:()=>{},texImage2D:()=>{},
 bindFramebuffer(k,f){if(k==='FRAMEBUFFER'||k==='READ_FRAMEBUFFER')read=f;if(k==='FRAMEBUFFER'||k==='DRAW_FRAMEBUFFER')draw=f;},
 framebufferTexture2D(_,attachment,kind,t){draw[attachment]=t;},checkFramebufferStatus:()=>gl.FRAMEBUFFER_COMPLETE,
 drawBuffers:()=>{},readBuffer:()=>{},isEnabled:k=>enabled.has(k),enable:k=>enabled.add(k),disable:k=>enabled.delete(k),
 activeTexture:i=>active=i,bindSampler:(i,s)=>samplers[i]=s,useProgram:p=>currentProgram=p,bindVertexArray:v=>vao=v,viewport:()=>{},
 depthRange(a,b){
   if(this!==gl)throw Error('illegal receiver');if(arguments.length<2)throw Error('missing depth range argument');
   a=Math.fround(Number(a));b=Math.fround(Number(b));
   if(!Number.isFinite(a)||!Number.isFinite(b)||a>b)return;
   range=[a,b].map(x=>Math.fround(Math.max(0,Math.min(1,x))));
 },depthFunc:()=>{},depthMask:()=>{},colorMask:()=>{},
 uniform1i:(n,v)=>uniforms[n]=v,uniformMatrix4fv:(n,t,v)=>uniforms[n]=v.slice(),uniform2f:(n,a,b)=>uniforms[n]=[a,b],uniform2fv:(n,v)=>uniforms[n]=v.slice(),uniform4f:()=>{},uniform1f:(n,v)=>uniforms[n]=v,
 drawArrays(){assert.ok(draw);assert.ok(!Object.values(tex).includes(draw.COLOR_ATTACHMENT0));assert.ok(!Object.values(tex).includes(draw.DEPTH_STENCIL_ATTACHMENT));assert.deepEqual(range,[0,1]);fullDraws++;},
 blitFramebuffer(...args){assert.ok(read);assert.equal(draw,null);blits++;order.push(args[8]===gl.DEPTH_BUFFER_BIT?'depth-copy':'color-copy');},__aeState:{known:true,read:null,draw:null}
});
const slopes={renderer:{},frames:0,camera:{projectionMatrix:matrix(),projectionMatrixInverse:matrix()},layer:{id:'slopes',render(g,args,prepare=false){if(prepare)return;layers++;slopes.frames++;
 const x=(padding.left-padding.right)/width,y=-(padding.top-padding.bottom)/height;
 slopes.camera.projectionMatrix=matrix(x,y);slopes.camera.projectionMatrixInverse=matrix(-x,-y);
}}};
const context={gl,bindFramebuffer:{set:v=>gl.bindFramebuffer(gl.FRAMEBUFFER,v)},depthRange:{set:v=>gl.depthRange(...v)},setDepthMode:()=>{},setDirty:()=>{},setDefault(){gl.bindVertexArray(null);gl.useProgram(null);gl.activeTexture(0);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.depthRange(0,1);gl.disable(gl.DEPTH_TEST);},viewport:{set:v=>gl.viewport(...v)}};
let sceneReady=false,namesHidden=false,nameCalls=0;const nameArgs=[],order=[];const nameLayer={render(g,args){nameCalls++;order.push('names');nameArgs.push(args);}};const nativeNames=nameLayer.render;const events={};
const emit=n=>{for(const f of [...(events[n]||[])])f();};
const canvasEvent=n=>{for(const f of [...(listeners[n]||[])])f();};
const map={style:{_layers:{'city-name-labels':{implementation:nameLayer}}},painter:{get width(){return width;},get height(){return height;},context,setCustomLayerDefaults:()=>{},getDepthModeFor3D:()=>({}),setBaseState:()=>{},render(){gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.depthRange(0,.958984);slopes.layer.render(gl,{},true);slopes.layer.render(gl,{},false);if(!namesHidden)map.style._layers['city-name-labels'].implementation.render(gl,{defaultProjectionData:{mainMatrix:slopes.camera.projectionMatrix.elements.slice()}});context.setDefault();sceneDraws++;return 42;}},
 transform:{get padding(){return padding;},setPadding:p=>padding={...p}},getPixelRatio:()=>1,triggerRepaint:()=>{},getCenter:()=>center,getZoom:()=>16,getBearing:()=>0,getPitch:()=>55,on:(n,f)=>{(events[n]??=new Set()).add(f);},off:(n,f)=>events[n]?.delete(f),getCanvas:()=>gl.canvas,getLayer:()=>sceneReady};
const window={__map:map,slopes,slopesApartments:{count:{done:true},readyToReveal:()=>sceneReady},THREE:{},__todCurrentP:.5,renderFX:()=>9};

const nativeRender=map.painter.render,nativeBind=gl.bindFramebuffer,nativeLayer=slopes.layer.render,nativeDepthRange=gl.depthRange;
vm.runInNewContext(source,{window,Error,Array,Math});
const api=window.FrameFilter,checks=[];
function check(name,fn){fn();checks.push(name);}
check('load is inert, attach does not activate',()=>{api.attach(map);assert.equal(map.painter.render,nativeRender);assert.equal(api.proof().attached,false);});
check('requested mode waits for real scene',()=>{api.setEnabled(true);assert.equal(api.proof().desired,true);assert.equal(api.proof().attached,false);sceneReady=true;emit('render');assert.equal(api.proof().attached,true);});
check('one scene draw, neutral handoff, exact padding restoration',()=>{let q=parameterQueries;assert.equal(map.painter.render(),42);assert.equal(parameterQueries-q,0);assert.equal(sceneDraws,1);assert.equal(fullDraws,1);assert.equal(blits,2);assert.equal(uniforms.weight,0);assert.deepEqual(padding,{left:0,right:0,top:0,bottom:0});assert.equal(read,null);assert.equal(draw,null);assert.equal(currentProgram,null);assert.equal(vao,null);for(let i=0;i<4;i++)assert.equal(tex[i],null);});
check('history advances, explicit reset and camera cut discard history',()=>{map.painter.render();assert.equal(uniforms.weight,.5);api.reset();map.painter.render();assert.equal(uniforms.weight,0);center={lng:.01,lat:0};map.painter.render();assert.equal(uniforms.weight,0);});
check('resize frees old targets and resets history',()=>{const d=deletes;width=800;map.painter.render();assert.equal(deletes-d,9);assert.equal(uniforms.weight,0);assert.deepEqual(Array.from(api.proof().engine.size),[800,600]);});
check('off removes hooks and frees targets; repeat off is safe',()=>{api.setEnabled(false);assert.equal(map.painter.render,nativeRender);assert.equal(gl.bindFramebuffer,nativeBind);assert.equal(gl.depthRange,nativeDepthRange);assert.equal(slopes.layer.render,nativeLayer);const d=deletes;api.setEnabled(false);assert.equal(deletes,d);});
check('resolve failure keeps same native scene without second draw',()=>{api.setEnabled(true);const originalDraw=gl.drawArrays,scenes=sceneDraws,copies=blits;gl.drawArrays=()=>{throw Error('injected resolve failure');};assert.doesNotThrow(()=>map.painter.render());assert.equal(sceneDraws,scenes+1);assert.equal(blits,copies+2);assert.equal(api.proof().blocked,true);assert.equal(api.proof().engine.on,false);assert.equal(read,null);assert.equal(draw,null);assert.deepEqual(padding,{left:0,right:0,top:0,bottom:0});gl.drawArrays=originalDraw;emit('render');assert.equal(map.painter.render,nativeRender);});
check('allocation failure goes straight to native scene',()=>{const originalComplete=gl.checkFramebufferStatus;gl.checkFramebufferStatus=()=>0;api.setEnabled(true);assert.equal(api.proof().attached,false);assert.equal(api.proof().blocked,true);const before=sceneDraws;map.painter.render();assert.equal(sceneDraws,before+1);gl.checkFramebufferStatus=originalComplete;});
check('context loss releases hooks and preserves desired mode',()=>{api.setEnabled(true);contextLost=true;canvasEvent('webglcontextlost');assert.equal(api.proof().desired,true);assert.equal(api.proof().attached,false);assert.equal(map.painter.render,nativeRender);assert.equal(gl.bindFramebuffer,nativeBind);sceneReady=false;});
check('restoration waits, then uses replacement painter and renderer once',()=>{const oldPainter=map.painter;map.painter={...oldPainter,render:nativeRender};slopes.renderer={};contextLost=false;read=draw=null;canvasEvent('webglcontextrestored');assert.equal(api.proof().attached,false);sceneReady=true;emit('render');const hooked=map.painter.render,n=api.proof().attachments;assert.notEqual(hooked,nativeRender);emit('render');api.attach(map);assert.equal(api.proof().attachments,n);assert.equal(map.painter.render,hooked);assert.equal(oldPainter.render,nativeRender);map.painter.render();assert.equal(uniforms.weight,0);});
check('loss during resolve does not touch lost GL or lose requested mode',()=>{const originalDraw=gl.drawArrays;gl.drawArrays=()=>{contextLost=true;canvasEvent('webglcontextlost');};assert.doesNotThrow(()=>map.painter.render());assert.equal(api.proof().attached,false);assert.equal(api.proof().desired,true);assert.deepEqual(padding,{left:0,right:0,top:0,bottom:0});gl.drawArrays=originalDraw;contextLost=false;read=draw=null;canvasEvent('webglcontextrestored');});
check('renderer replacement detaches stale hooks',()=>{const oldLayer=slopes.layer;slopes.layer={id:'slopes',render:nativeLayer};slopes.renderer={};emit('render');assert.equal(oldLayer.render,nativeLayer);assert.notEqual(slopes.layer.render,nativeLayer);});
check('detach removes all listeners and wrappers',()=>{api.detach();assert.equal(map.painter.render,nativeRender);assert.equal(gl.bindFramebuffer,nativeBind);assert.equal(gl.depthRange,nativeDepthRange);assert.equal(slopes.layer.render,nativeLayer);assert.ok(Object.values(events).every(s=>s.size===0));assert.ok(Object.values(listeners).every(s=>s.size===0));});
check('tracked depth clamps and rounds like GLclampf without normal queries',()=>{
 api.attach(map).setEnabled(true);const q=parameterQueries;
 gl.depthRange(-.1,.123456789);assert.deepEqual(Array.from(api.proof().engine.depthRangeTracking.value),[0,Math.fround(.123456789)]);assert.equal(parameterQueries,q);
});
check('unusual and invalid setters invalidate then seed actual depth',()=>{
 gl.depthRange('.1','.8');assert.equal(api.proof().engine.depthRangeTracking.known,false);
 // Prevent the mock painter setter from replacing this value before capture.
 const wrapped=gl.depthRange;let skip=true;gl.depthRange=function(){if(skip){skip=false;return;}return wrapped.apply(this,arguments);};let q=parameterQueries;map.painter.render();assert.equal(parameterQueries-q,1);gl.depthRange=wrapped;
 gl.depthRange(.8,.2);assert.equal(api.proof().engine.depthRangeTracking.known,false);
 assert.throws(()=>gl.depthRange(Symbol('n'),.8));assert.equal(api.proof().engine.depthRangeTracking.known,false);
 gl.depthRange(0,1);assert.equal(api.proof().engine.depthRangeTracking.known,true);
});
check('check mode verifies tracker against actual depth',()=>{
 let calls=0;window.GLSTATE={check:true,verify(g,name,pname,value){calls++;assert.equal(name,'taa.depthRange');assert.deepEqual(Array.from(value),Array.from(g.getParameter(pname)));}};
 map.painter.render();assert.equal(calls,2);delete window.GLSTATE;
});
check('foreign depth wrapper survives detach and old tracker becomes inert',()=>{
 const tracker=gl.depthRange,proof=api.proof().engine;let calls=0;
 const foreign=function(){calls++;return tracker.apply(this,arguments);};gl.depthRange=foreign;api.setEnabled(false);
 assert.equal(gl.depthRange,foreign);gl.depthRange(.2,.7);assert.equal(calls,1);assert.deepEqual(range,[Math.fround(.2),Math.fround(.7)]);
 api.setEnabled(true);assert.notEqual(gl.depthRange,foreign);api.setEnabled(false);assert.equal(gl.depthRange,foreign);
 gl.depthRange=nativeDepthRange;api.detach();
});
check('stable background parameter defaults on and reaches shader',()=>{api.attach(map).setEnabled(true);map.painter.render();assert.equal(api.params.stableBackground,true);assert.equal(uniforms.stableBackground,1);api.params.stableBackground=false;map.painter.render();assert.equal(uniforms.stableBackground,0);api.params.stableBackground=true;api.detach();});
check('custom names outside painter render remain immediate',()=>{api.attach(map).setEnabled(true);let n=nameCalls;nameLayer.render(gl,{defaultProjectionData:{mainMatrix:matrix().elements}});assert.equal(nameCalls,n+1);});
check('names follow color resolve and raw-depth copy once',()=>{order.length=0;let n=nameCalls;map.painter.render();assert.equal(nameCalls,n+1);assert.deepEqual(order,['color-copy','depth-copy','names']);});
check('deferred names remove jitter without mutating input matrix',()=>{
 const jittered=slopes.camera.projectionMatrix.elements.slice(),got=nameArgs.at(-1).defaultProjectionData.mainMatrix;
 assert.ok(Math.abs(got[12])<1e-12);assert.ok(Math.abs(got[13])<1e-12);assert.notDeepEqual(got,jittered);assert.deepEqual(slopes.camera.projectionMatrix.elements,jittered);
});
check('hidden names are not manufactured after resolve',()=>{namesHidden=true;let n=nameCalls;order.length=0;map.painter.render();assert.equal(nameCalls,n);assert.deepEqual(order,['color-copy']);namesHidden=false;});
check('names switch off uses original in-scene callback',()=>{api.params.postResolveNames=false;order.length=0;map.painter.render();assert.deepEqual(order,['names','color-copy']);api.params.postResolveNames=true;});
check('name depth compatibility checks repeat only after resize',()=>{let n=api.proof().engine.postResolveNames.depthCopyChecks;map.painter.render();assert.equal(api.proof().engine.postResolveNames.depthCopyChecks,n);width+=10;map.painter.render();assert.equal(api.proof().engine.postResolveNames.depthCopyChecks,n+1);});
check('foreign name wrapper retained and stale deferral disabled on detach',()=>{
 const hooked=nameLayer.render;let n=0;const foreign=function(){n++;return hooked.apply(this,arguments);};nameLayer.render=foreign;api.setEnabled(false);assert.equal(nameLayer.render,foreign);const before=nameCalls;nameLayer.render(gl,{defaultProjectionData:{mainMatrix:matrix().elements}});assert.equal(n,1);assert.equal(nameCalls,before+1);nameLayer.render=nativeNames;
});
check('replacement custom name layer hooks once and restores on detach',()=>{api.setEnabled(true);const old=map.style._layers['city-name-labels'].implementation;const next={render:nativeNames};map.style._layers['city-name-labels'].implementation=next;emit('render');assert.equal(old.render,nativeNames);let n=nameCalls;map.painter.render();assert.equal(nameCalls,n+1);api.detach();assert.equal(next.render,nativeNames);});
check('no independent frame or timer scheduler',()=>{assert.ok(!/requestAnimationFrame|setInterval|setTimeout/.test(source));});
console.log(JSON.stringify({passed:checks.length,noGpu:true}));
