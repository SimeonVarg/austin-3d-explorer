// Node-only shader-hook / texture-lifecycle check. Does not compile GLSL or claim GPU acceptance.
// node --experimental-vm-modules scripts/v2/test_fine_shader.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../../v2/vendor/three/build/three.module.js';
const context=vm.createContext({Uint16Array,Uint8Array,DataView,Float32Array,Math,atob,URL,URLSearchParams});
function mock(values) {const keys=Object.keys(values);return new vm.SyntheticModule(keys,function(){keys.forEach(k=>this.setExport(k,values[k]));},{context});}
const three=mock(THREE),loader=mock({GLTFLoader:class{}}),meshopt=mock({MeshoptDecoder:{}});
const mod=new vm.SourceTextModule(fs.readFileSync(new URL('../../v2/tiles.js',import.meta.url),'utf8'),{context});
await mod.link(s=>s==='three'?three:s.includes('GLTFLoader')?loader:meshopt);await mod.evaluate();
const packed=Buffer.alloc(12);[10000,20000,30000,32768,32768,65535].forEach((v,k)=>packed.writeUInt16LE(v,k*2));
const table=mod.namespace.fineTexture({version:2,sizeBase:0.01,sizeSteps:16,count:1,table:packed.toString('base64')});
assert.equal(table.tex.type,THREE.HalfFloatType);assert.equal(table.tex.minFilter,THREE.NearestFilter);
assert(Math.abs(THREE.DataUtils.fromHalfFloat(table.tex.image.data[0])-10000/65535)<0.0002);
assert.equal(THREE.DataUtils.fromHalfFloat(table.tex.image.data[6]),1);
const material=new THREE.MeshStandardMaterial(),shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};
mod.namespace.fineable(material,table);material.onBeforeCompile(shader);
assert(shader.vertexShader.includes('attribute vec4 _fine;'));assert(shader.vertexShader.includes('exp2((_fine.y - 1.0) / uFineDecode.y)'));
assert(shader.fragmentShader.indexOf('fineK = smoothstep')<shader.fragmentShader.indexOf('#include <normal_fragment_begin>'));
assert(shader.fragmentShader.indexOf('normal = normalize(mix(normal, patchNormal, fineK))')>shader.fragmentShader.indexOf('#include <normal_fragment_maps>'));
assert(shader.fragmentShader.includes('if (fineK > 0.0)'));
assert.equal(shader.uniforms.uFineTex.value,table.tex);
const root=new THREE.Group();root.userData.v2FineTexture=table.tex;let disposed=0;table.tex.addEventListener('dispose',()=>disposed++);
mod.namespace.disposeObject(root);assert.equal(disposed,1);
assert.equal(mod.namespace.fineTexture({version:1}),null);
console.log('PASS actual Three standard-shader hooks, half-float table decode and one-time texture disposal (no GPU compile)');
