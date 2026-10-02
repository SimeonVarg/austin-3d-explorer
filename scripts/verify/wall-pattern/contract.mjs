// Material authoring contract; rendering/motion still require the full-city proof.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {slopesSource,apartmentsSource} from './adapter.mjs';
const root=new URL('../../../',import.meta.url);
const source=fs.readFileSync(new URL('js/wall-pattern-prototype.js',root),'utf8');
const ctx={window:{THREE:{DataTexture:class {constructor(data,w,h){this.data=data;this.width=w;this.height=h;}},RGBAFormat:1,FloatType:2,NearestFilter:3}}};
vm.runInNewContext(source,ctx);
const api=ctx.window.WallPatterns;
const palette=()=>({wall:['#aaaaaa','#bbbbbb','#222222'],pale:['#dddddd','#eeeeee','#333333'],dark:['#777777','#888888','#111111']});
const frame={at:()=>[500,-200,0],U:[0,1],V:[-1,0]};
const spec={materials:{wall:{type:'brick',scale:[.28,.087],pattern:{version:1,seed:28,tones:[['pale',2],['dark',1]],joint:{width:.014,tone:'wall'}}}}};
const legacy=palette(),snapshot=JSON.stringify(legacy);
api.register(legacy,{materials:{wall:{type:'brick'}}},frame);
assert.equal(JSON.stringify(legacy),snapshot);assert.equal(api.size,0);
const p=palette();api.register(p,spec,frame);assert.equal(p.wall.surface[0],100);
api.register(palette(),spec,frame);assert.equal(api.size,1,'rebuild must reuse its row');
api.register(palette(),spec,{...frame,at:()=>[501,-200,0]});assert.equal(api.size,2,'different origins need separate alignment');
const mat={uniforms:{sun:{value:9}}};api.attach(mat);assert.equal(mat.uniforms.sun.value,9);
assert.equal(mat.uniforms.u_wallPatterns.value.width,32);
for(const mutate of [s=>s.materials.wall.pattern.tones[0][1]=0,s=>s.materials.wall.pattern.joint.width=.1,
 s=>s.materials.wall.pattern.axis=[0,0],s=>s.materials.wall.pattern.filter=[1,.5],s=>s.materials.wall.pattern.tones[0][0]='missing']) {
  const bad=structuredClone(spec);mutate(bad);assert.throws(()=>api.register(palette(),bad,frame));
}
const slopes=fs.readFileSync(new URL('js/slopes.js',root),'utf8'),apartments=fs.readFileSync(new URL('js/slopes-apartments.js',root),'utf8');
assert.ok(slopesSource(slopes).includes('window.WallPatterns.attach(mat)'));
assert.ok(apartmentsSource(apartments).includes('window.WallPatterns.register(P,spec,F)'));
assert.throws(()=>slopesSource(slopesSource(slopes)),'adapter must reject double integration');
assert.throws(()=>apartmentsSource('changed renderer'),'adapter must reject missing anchors');
console.log('PASS: legacy palette, stable registration, independent alignment, invalid authoring, shared uniforms, integration drift');
