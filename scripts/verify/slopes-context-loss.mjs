// Exercise the production shadow pass and render entry against context loss.
// This is a CPU lifecycle test; real WebGL recovery remains a browser gate.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
let source=fs.readFileSync(new URL('../../js/slopes.js',import.meta.url),'utf8');
if(process.argv.includes('--break')) source=source.replace('if(!viewport||!scissor)return;', 'if(false)return;');
const start=source.indexOf('  function updateSunShadows() {');
const end=source.indexOf('\n  let _mat =',start);
assert.ok(start>=0&&end>start);
const production=source.slice(start,end);
function fixture() {
  const stats={allocations:0,renders:0,queries:0,mapReads:0,clears:0,restores:[]};
  const gl={lost:false,nullQuery:null,VIEWPORT:1,SCISSOR_BOX:2,SCISSOR_TEST:3,
    isContextLost(){return this.lost;},
    getParameter(key){stats.queries++;if(key===this.nullQuery){this.lost=true;return null;}return key===1?[11,12,640,480]:[21,22,320,240];},
    isEnabled:()=>true};
  const vector=()=>({x:0,set(...args){this.x=args[0];this.args=args;return this;},addScaledVector(){return this;}});
  const THREE={
    WebGLRenderTarget:class {constructor(){stats.allocations++;this.texture={};}dispose(){}},
    ShaderMaterial:class {constructor(){stats.allocations++;}dispose(){}},
    OrthographicCamera:class {constructor(){stats.allocations++;this.up=vector();this.position=vector();this.projectionMatrix={};this.matrixWorldInverse={};}updateProjectionMatrix(){}lookAt(){}updateMatrixWorld(){}},
    Color:class {constructor(){stats.allocations++;}}
  };
  const originalTarget={name:'map-target'},originalOverride={name:'existing-override'},originalColor={name:'clear'};
  const scene={overrideMaterial:originalOverride,add(){},remove(){}};
  const renderer={getContext:()=>gl,getRenderTarget:()=>originalTarget,
    getClearColor:()=>originalColor,getClearAlpha:()=>.4,
    setClearColor(...args){stats.restores.push(['color',...args]);},
    setRenderTarget(target){stats.restores.push(['target',target]);},
    clear(){stats.clears++;},render(){assert.equal(gl.lost,false,'must never render after a null state query');stats.renders++;},
    setViewport(...args){stats.restores.push(['viewport',...args]);},
    setScissor(...args){stats.restores.push(['scissor',...args]);},
    setScissorTest(value){stats.restores.push(['scissorTest',value]);}};
  const U={u_shadowSettings:{value:vector()},u_sunDirection:{value:{z:1}},u_p:{value:.3},u_sunShadow0:{},u_sunShadow1:{},
    u_sunShadowMatrix0:{value:{multiplyMatrices(){}}},u_sunShadowMatrix1:{value:{multiplyMatrices(){}}}};
  const scope=vm.createContext({window:{THREE,slopesApartments:{count:{done:true,triangles:100}},CityLighting:{shadowProxy:()=>null}},
    SLOPES:{on:true,sunlight:{on:true,shadows:true,shadowSize:256,shadowRadii:[100,400],shadowDistance:800,shadowSnap:10,shadowBias:.1,shadowNormalBias:.2}},
    U,renderer,scene,root:{children:[]},_sunShadow:null,
    _map:{getCenter(){stats.mapReads++;return {lng:0,lat:0};}},
    releaseSunShadows(){throw Error('unexpected reallocation');},toLocal:()=>({x:0,y:0,z:30})});
  vm.runInContext(production,scope);
  const update=()=>scope.updateSunShadows();
  return {scope,stats,gl,U,scene,originalTarget,originalOverride,originalColor,update};
}
const cold=fixture();cold.gl.lost=true;cold.update();
assert.equal(cold.stats.allocations,0,'known-lost context must not allocate shadow resources');
assert.equal(cold.stats.renders,0);assert.equal(cold.stats.queries,0);assert.equal(cold.stats.mapReads,0);
assert.equal(cold.U.u_shadowSettings.value.x,0);
cold.gl.lost=false;cold.update();
assert.equal(cold.stats.renders,2,'restored context builds both cascades');
assert.equal(cold.U.u_shadowSettings.value.x,1);
assert.equal(cold.scope._sunShadow.updates,1);
const allocations=cold.stats.allocations;cold.update();
assert.equal(cold.stats.allocations,allocations);assert.equal(cold.stats.renders,2,'stable key reuses prior cascades');
for(const query of [1,2]) {
  const f=fixture();f.update();
  f.U.u_p.value=.4;f.gl.nullQuery=query;
  const beforeAlloc=f.stats.allocations,beforeRenders=f.stats.renders,beforeRestores=f.stats.restores.length;
  const key=f.scope._sunShadow.key;
  f.update();
  assert.equal(f.stats.allocations,beforeAlloc,'null GL state must return before temporary color allocation');
  assert.equal(f.stats.renders,beforeRenders);
  assert.equal(f.stats.restores.length,beforeRestores,'null state must never enter render/restoration');
  assert.equal(f.scope._sunShadow.key,key,'failed attempt must not mark new hour as rendered');
  assert.equal(f.U.u_shadowSettings.value.x,0);
  assert.equal(f.scene.overrideMaterial,f.originalOverride);
  f.gl.lost=false;f.gl.nullQuery=null;f.update();
  assert.equal(f.stats.renders,beforeRenders+2,'same hour must retry after restoration');
  assert.equal(f.scope._sunShadow.updates,2);
  assert.equal(f.U.u_shadowSettings.value.x,1);
  assert.deepEqual(f.stats.restores.slice(-5),[
    ['target',f.originalTarget],['color',f.originalColor,.4],['viewport',11,12,640,480],['scissor',21,22,320,240],['scissorTest',true]
  ],'valid GL state restores exactly');
}
// Execute the actual complete render method; only its loss guard should run.
const renderStart=source.indexOf('    render(gl, args, prepareOnly=false) {');
const renderEnd=source.indexOf('\n  };',renderStart);
assert.ok(renderStart>=0&&renderEnd>renderStart);
const trapped=new Proxy({}, {get(){throw Error('render touched map/scene work while context lost');}});
const renderScope=vm.createContext({SLOPES:{on:true},scene:{},_map:trapped,root:trapped,window:trapped});
const layer=vm.runInContext('({'+source.slice(renderStart,renderEnd)+'})',renderScope);
assert.doesNotThrow(()=>layer.render({isContextLost:()=>true},{}));
// Execute the production caller tail, including the actual shadow update:
// loss during its viewport query must also stop the enclosing scene render.
const callerStart=source.indexOf('      updateSunShadows();',renderStart);
const callerEnd=source.indexOf('\n    },',callerStart);
assert.ok(callerStart>renderStart&&callerEnd>callerStart);
let caller=source.slice(callerStart,callerEnd);
if(process.argv.includes('--break-caller')) caller=caller.replace('if(gl.isContextLost())return;','');
const during=fixture();during.update();
during.U.u_p.value=.45;during.gl.nullQuery=during.gl.VIEWPORT;
let frameCalls=0;
during.scope.gl=during.gl;
during.scope.renderer.properties={get:()=>({__webglTexture:{}})};
during.scope.camera={projectionMatrixInverse:{}};
during.scope._frames=0;
during.scope.window.CityLighting.frame=()=>{frameCalls++;};
vm.runInContext('function finishRender(prepareOnly=false){'+caller+'}',during.scope);
const rendersBefore=during.stats.renders;
during.scope.finishRender();
assert.equal(frameCalls,0,'loss inside shadow update must stop caller lighting work');
assert.equal(during.stats.renders,rendersBefore,'loss inside shadow update must stop caller render');
assert.equal(during.scope._frames,0,'lost frame must not increment rendered-frame count');
during.gl.lost=false;during.gl.nullQuery=null;
during.scope.finishRender();
assert.equal(frameCalls,1);
assert.equal(during.stats.renders,rendersBefore+3,'retry draws both shadow cascades and the scene');
assert.equal(during.scope._frames,1);
console.log('PASS: known loss skips allocation/render; null viewport and scissor preserve retry key; restored cascades render and restore state; layer render short-circuits at entry and after shadow loss');
