// The real material partition and per-draw reset, without launching a browser.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const outer=fs.readFileSync(new URL('../../js/outer.js',import.meta.url),'utf8');
const lighting=fs.readFileSync(new URL('../../js/city-lighting.js',import.meta.url),'utf8');
const data=JSON.parse(fs.readFileSync(new URL('../../data/outer_ring.geojson',import.meta.url),'utf8'));
const start=outer.indexOf("  const IS_DETAIL ="),end=outer.indexOf('  const IS_WALL',start);
const filterScope=vm.createContext({});
vm.runInContext(outer.slice(start,end)+'\nglobalThis.filters=[IS_FLAT_DETAIL,IS_LANDMARK_GLASS,IS_LANDMARK_LIGHT];',filterScope);
function evalFilter(e,p){
  if(!Array.isArray(e))return e;
  const [op,...a]=e;
  if(op==='get')return p[a[0]];
  if(op==='has')return Object.hasOwn(p,a[0]);
  if(op==='any')return a.some(x=>evalFilter(x,p));
  if(op==='all')return a.every(x=>evalFilter(x,p));
  if(op==='==')return evalFilter(a[0],p)===evalFilter(a[1],p);
  if(op==='!=')return evalFilter(a[0],p)!==evalFilter(a[1],p);
  throw Error(op);
}
const counts=[0,0,0];
for(const {properties:p} of data.features){
  const matches=Array.from(filterScope.filters,f=>evalFilter(f,p));
  assert.equal(matches.filter(Boolean).length,Object.hasOwn(p,'k')&&p.lmThin!==1&&!(p.lm==='sixth-guadalupe'&&['balcony-rail','balcony-divider'].includes(p.part))?1:0,'each detail gets exactly one material');
  if(!p.lm&&p.k)assert.deepEqual(matches,[true,false,false],'unrelated detail retains its original layer');
  matches.forEach((yes,i)=>{if(yes)counts[i]++;});
}
assert.ok(counts.every(n=>n>0));
const selector=lighting.match(/const solidSurfaceFor=([^;]+);/)[0];
const scope=vm.createContext({window:{},stats:{solidGlassDraws:0,solidLightDraws:0},depthPool:()=>false});
vm.runInContext(selector,scope);
const values=[];
scope.gl={uniform1f:(_,value)=>values.push(value)};
scope.u={u_citySolidSurface:{}};scope.p={};
const resetStart=lighting.indexOf('      const surface=activeSolidSurface;');
const resetEnd=lighting.indexOf('      if(p.serial!==serial)',resetStart);
const reset=lighting.slice(resetStart,resetEnd);
const native=(...args)=>{
  vm.runInContext('{'+reset+'}',scope);
  if(args[2].throw)throw Error('expected draw failure');
};
scope.drawFunctions={fillExtrusion:native,circle:()=>{}};
scope.painter={drawFunctions:scope.drawFunctions};
const wrapStart=lighting.indexOf('    let activeSolidSurface=0;');
const wrapEnd=lighting.indexOf('    let current=null;',wrapStart);
vm.runInContext(lighting.slice(wrapStart,wrapEnd),scope);
const draw=id=>scope.painter.drawFunctions.fillExtrusion(null,null,{id});
draw('outer-landmark-glass');draw('outer-landmark-light');draw('heroes-gdc-glass');draw('outer-detail');draw('buildings-3d');
assert.deepEqual(values,[1,2,3,0],'shared program must reset after a semantic layer; unchanged ordinary draws do no uniform write');
assert.throws(()=>scope.painter.drawFunctions.fillExtrusion(null,null,{id:'outer-landmark-light',throw:true}));
assert.equal(vm.runInContext('activeSolidSurface',scope),0,'failed draws restore prior semantic state');

// The ordinary solid path is deliberately the previous shader expression.
const ordinary=lighting.split('if(u_citySolidSurface<.5){')[1].split('}else')[0].replace(/\s+/g,'');
const expected=`vec3 shaded=cityShade(v_color.rgb/max(v_color.a,.0001),v_cityAlbedo.rgb,v_cityPos,v_cityNormal,0.0);
shaded=cityCrown(shaded,v_cityPos,v_cityNormal);
fragColor=vec4(cityLocalLight(shaded,min(v_cityAlbedo.rgb*4.0,vec3(1.0)),v_cityPos,v_cityNormal,0.0)*v_color.a,v_color.a);`.replace(/\s+/g,'');
assert.equal(ordinary,expected);
// Exercise the actual scalar GLSL formula against independent area sampling.
// A point-sampled thin strip vanishes for most phases; this representation
// must preserve its area as pixels become wider than a complete storey.
const integral=lighting.match(/float stripIntegral\(float x,float width\)\{([^}]+)\}/)[1];
const coverage=lighting.match(/float stripCoverage\(float position,float pitch,float width\)\{([^}]+)\}/)[1].replace(/\bfloat\b/g,'let');
const strips=vm.createContext({floor:Math.floor,fract:x=>x-Math.floor(x),min:Math.min,max:Math.max,
 clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),fwidth:()=>pixelWidth});
let pixelWidth=1;
vm.runInContext(`function stripIntegral(x,width){${integral}};function stripCoverage(position,pitch,width){${coverage}}`,strips);
for(const dx of [.03,.3,1,3.7,10]){
 pixelWidth=dx;
 for(const phase of [-.37,0,.05,.19,.83,1.07]){
  const actual=strips.stripCoverage(phase,1,.08);
  let sum=0;const n=20000;
  for(let i=0;i<n;i++){const x=phase-dx/2+dx*(i+.5)/n;sum+=(x-Math.floor(x))<.08?1:0;}
  assert.ok(Math.abs(actual-sum/n)<.0002,`filtered coverage differs at footprint ${dx}, phase ${phase}`);
  if(dx===1||dx===10)assert.ok(Math.abs(actual-.08)<1e-8,'distant bands retain their area independently of phase');
 }
}
console.log('PASS: disjoint real-data material partition, ordinary layer preservation, per-draw uniform reset/failure recovery, unchanged ordinary shader branch',counts);
console.log('PASS: analytic strip coverage agrees with independent supersampling and preserves subpixel band area');
