// Material authoring contract for js/wall-patterns.js, plus the three hooks the
// renderer needs. Rendering and motion still need a look in the full city.
// Run: node scripts/verify/wall-patterns-contract.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const root=new URL('../../',import.meta.url);
const read=f=>fs.readFileSync(new URL(f,root),'utf8');
const ctx={window:{THREE:{DataTexture:class {constructor(data,w,h){this.data=data;this.width=w;this.height=h;}},RGBAFormat:1,FloatType:2,NearestFilter:3}}};
vm.runInNewContext(read('js/wall-patterns.js'),ctx);
const api=ctx.window.WallPatterns;
const palette=()=>({wall:['#aaaaaa','#bbbbbb','#222222'],pale:['#dddddd','#eeeeee','#333333'],dark:['#777777','#888888','#111111']});
const frame={at:()=>[500,-200,0],U:[0,1],V:[-1,0]};
const spec={materials:{wall:{type:'brick',scale:[.28,.087],pattern:{version:1,seed:28,tones:[['pale',2],['dark',1]],joint:{width:.014,tone:'wall'}}}}};
const legacy=palette(),snapshot=JSON.stringify(legacy);
api.register(legacy,{materials:{wall:{type:'brick'}}},frame);
assert.equal(JSON.stringify(legacy),snapshot,'a building without a pattern keeps its palette');assert.equal(api.size,0);
const p=palette();api.register(p,spec,frame);assert.equal(p.wall.surface[0],100);
api.register(palette(),spec,frame);assert.equal(api.size,1,'rebuild must reuse its row');
api.register(palette(),spec,{...frame,at:()=>[501,-200,0]});assert.equal(api.size,2,'different origins need separate alignment');
const mat={uniforms:{sun:{value:9}}};api.attach(mat);assert.equal(mat.uniforms.sun.value,9);
assert.equal(mat.uniforms.u_wallPatterns.value.width,32);
for(const mutate of [s=>s.materials.wall.pattern.tones[0][1]=0,s=>s.materials.wall.pattern.joint.width=.1,
 s=>s.materials.wall.pattern.axis=[0,0],s=>s.materials.wall.pattern.filter=[1,.5],s=>s.materials.wall.pattern.tones[0][0]='missing']) {
  const bad=structuredClone(spec);mutate(bad);assert.throws(()=>api.register(palette(),bad,frame));
}
// The hooks: each exactly once, and the module loads before the renderer.
const count=(s,x)=>s.split(x).length-1;
const slopes=read('js/slopes.js'),apartments=read('js/slopes-apartments.js');
assert.equal(count(slopes,'window.WallPatterns.attach(mat);'),1);
assert.equal(count(slopes,'${window.WallPatterns.glsl}'),1);
assert.equal(count(slopes,'${window.WallPatterns.apply}'),1);
assert.equal(count(apartments,'window.WallPatterns.register(P,spec,F);'),1);
for(const page of ['index.html','_harness.html']) {
  const s=read(page),a=s.indexOf('src="js/wall-patterns.js"'),b=s.indexOf('src="js/slopes.js"');
  assert.ok(a>0&&b>a,page+': js/wall-patterns.js must load before js/slopes.js');
}
console.log('PASS: legacy palette, stable registration, independent alignment, invalid authoring, shared uniforms, hooks, load order');
