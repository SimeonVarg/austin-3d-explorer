import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
let created=0,disposed=0;
class DataTexture {constructor(data,width,height){this.image={data,width,height};this.colorSpace='';created++;}dispose(){disposed++;}}
class Vector {constructor(...v){this.values=v;}}
const T={DataTexture,Vector3:Vector,Vector4:Vector,RGBAFormat:1,UnsignedByteType:2,RepeatWrapping:3,LinearFilter:4,LinearMipmapLinearFilter:5,NoColorSpace:''};
const t={on:true,valleyWidth:.12,lipWidth:.035,lipCurve:.18,tones:['#96502d','#b76b42','#ce824e','#e8a06c','#f9d29e'],weights:[.2,.44,.18,.1175,.0625],axisFilter:[.6,1],clayFilter:[.2,.65],filter:[.65,1.25],slopeDeg:[6,80],paleRun:[2,3],weatherScale:[3,5],hourContrast:[1,.85,.22],photoMean:['#b06e42','#c5824e','#16131e'],pitchM:.25,courseM:.45,strength:1,seed:51};
const window={THREE:T,SLOPES_ROOFS:{tiles:t},slopes:{renderer:null}};
vm.runInNewContext(fs.readFileSync(new URL('../../js/wall-patterns.js',import.meta.url),'utf8'),{window});
const R=window.RoofTiles,U1={},U2={};R.sync(U1);R.sync(U2);
assert.equal(created,1);assert.equal(disposed,0);assert.equal(U1.u_roofReliefAtlas,U2.u_roofReliefAtlas);
const first=U1.u_roofReliefAtlas.value,firstData=first.image.data;
assert.equal(first.anisotropy,1);assert.equal(firstData.length,262144);
window.slopes.renderer={capabilities:{getMaxAnisotropy:()=>16}};R.sync(U1);
assert.equal(created,1);assert.equal(first.anisotropy,8);
// Compare every byte to the actual runtime experiment's bake, not a second
// transcription of the production formula.
const setupWindow={THREE:T,SLOPES_ROOFS:{tiles:t},slopes:window.slopes};
vm.runInNewContext(fs.readFileSync(new URL('roof-study/atlas-setup.js',import.meta.url),'utf8'),{window:setupWindow,performance});
assert.deepEqual(Buffer.from(firstData),Buffer.from(setupWindow.__roofMipExperiment.texture.image.data));
const afterReference=created;
t.strength=.7;t.tones[0]='#97502d';t.filter=[.35,.65];R.sync(U1);
assert.equal(created,afterReference);assert.equal(U1.u_rtCell.value.values[2],.7);
assert.deepEqual(Array.from(U1.u_rtFilter.value.values.slice(0,2)),[.35,.65]);
t.valleyWidth=.14;R.sync(U2);assert.equal(created,afterReference+1);assert.equal(disposed,1);
const second=U1.u_roofReliefAtlas.value;assert.notEqual(second,first);assert.equal(U2.u_roofReliefAtlas.value,second);
assert.equal(second.anisotropy,8);
t.on=false;t.lipCurve=.2;R.sync(U1);assert.equal(created,afterReference+1);assert.equal(disposed,1);
t.on=true;R.sync(U1);assert.equal(created,afterReference+2);assert.equal(disposed,2);
const final=U1.u_roofReliefAtlas.value,finalData=final.image.data;
// Renderer recreation changes only sampler capability, not the bake/CPU data.
window.slopes.renderer={capabilities:{getMaxAnisotropy:()=>4}};R.sync(U2);
assert.equal(created,afterReference+2);assert.equal(final.anisotropy,4);assert.equal(final.image.data,finalData);
// Invalid live shape cannot poison the last good texture or dispose it.
t.lipWidth=NaN;assert.throws(()=>R.sync(U1),/Invalid roof relief shape/);
assert.equal(U1.u_roofReliefAtlas.value,final);assert.equal(disposed,2);
t.lipWidth=.035;R.sync(U1);assert.equal(created,afterReference+2);
const means=[0,0,0,0];for(let i=0;i<firstData.length;i++)means[i%4]+=firstData[i]/(255*256*256);
for(const [i,expected] of [.5,.12,.035,.035].entries())assert.ok(Math.abs(means[i]-expected)<1e-5);
const result={pass:true,scope:'CPU VM, no real GL/context recovery',runtime_bake_byte_identical:true,quantizedMeans:means,productionTexturesCreated:created-1,replacedTexturesDisposed:disposed,one_shared_uniform:true,renderer_change_reuses_pixels:true,invalid_shape_preserves_previous:true};
console.log(result);
