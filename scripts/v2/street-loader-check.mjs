// Build the real street geometry on the CPU; no browser, timing claim or extra runtime dependency.
// node scripts/v2/street-loader-check.mjs [--baseline /path/to/old-v2] [--missing-safe]
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
const root=process.cwd();
const baseArg=process.argv.indexOf('--baseline');
const base=baseArg<0?root+'/v2':process.argv[baseArg+1];
const baseline=baseArg>=0;
const missingSafe=process.argv.includes('--missing-safe');
const missingSigns=process.argv.includes('--missing-signs');
const requests=new Map();
const THREE=await import(pathToFileURL(root+'/v2/vendor/three/build/three.module.js'));
globalThis.location={search:''};globalThis.window={};
// TextureLoader's DOM image is replaced only in this CPU geometry harness. Verify the real PNG header/dimensions.
THREE.TextureLoader.prototype.load=function(url,onLoad,onProgress,onError){try {const b=fs.readFileSync(new URL(url));if(b.toString('ascii',1,4)!=='PNG')throw Error('invalid sign atlas');const t=new THREE.Texture({width:b.readUInt32BE(16),height:b.readUInt32BE(20)});queueMicrotask(()=>onLoad(t));return t;}catch(e){onError?.(e);}};
globalThis.fetch=async(url)=>{requests.set(url,(requests.get(url)||0)+1);try { const p=new URL(url);if(missingSigns && /\/sign_faces\.json$/.test(p.pathname))throw Error('missing sign identities');if(missingSafe && /\/safe(_osm)?\.json$/.test(p.pathname))throw Error('missing validated inventory');return {ok:true,json:async()=>JSON.parse(fs.readFileSync(p,'utf8'))};} catch(e){return {ok:false,json:async()=>{throw e;}};}};
const scene=new THREE.Scene();
const {installStreetNear}=await import(pathToFileURL(base+'/street_near.js'));
const {installStreet}=await import(pathToFileURL(base+'/street.js'));
const near=installStreetNear({THREE,scene,redraw:()=>{},phone:true});const street=installStreet({THREE,scene,redraw:()=>{},phone:true});
for(let i=0;i<1000 && !(near.stats().ready && street.stats().ready);i++){
 await new Promise(r=>setTimeout(r,10));
 if(near.stats().error||street.stats().error)throw Error(JSON.stringify([near.stats(),street.stats()]));
}
if(!near.stats().ready || !street.stats().ready)throw Error('not ready');
if(!baseline)for(const [url,n] of requests)if(/\/safe(_osm)?\.json$/.test(new URL(url).pathname) && n!==1)throw Error('duplicate safe inventory fetch');
if(missingSafe && (near.stats().sign_posts || near.stats().arrows || street.stats().signal_poles || street.stats().lamps))throw Error('raw furniture restored after failed safe fetch');
let signClearance={panels:0,too_low:0,min_bottom_m:Infinity};
for(const mesh of near.group.children.filter(m=>m.name.startsWith('signs '))) {mesh.geometry.computeBoundingBox();const m=new THREE.Matrix4();for(let i=0;i<mesh.count;i++){mesh.getMatrixAt(i,m);const b=mesh.geometry.boundingBox.clone().applyMatrix4(m);signClearance.panels++;signClearance.min_bottom_m=Math.min(signClearance.min_bottom_m,b.min.y);if(b.min.y<2.1-.001)signClearance.too_low++;}}
if(!baseline && signClearance.too_low)throw Error('signs below pedestrian clearance '+JSON.stringify(signClearance));
let signals={heads:0,below_clearance:0,wrong_height:0,min_bottom_m:Infinity,max_height_m:0,without_lenses:0};
const heads=street.group.children.find(m=>m.name==='signal heads'), lenses=street.group.children.find(m=>m.name==='signal lenses');
if(heads) {
  heads.geometry.computeBoundingBox();const box=heads.geometry.boundingBox,matrix=new THREE.Matrix4();
  for(let i=0;i<heads.count;i++) {heads.getMatrixAt(i,matrix);const b=box.clone().applyMatrix4(matrix),height=b.max.y-b.min.y;signals.heads++;signals.min_bottom_m=Math.min(signals.min_bottom_m,b.min.y);signals.max_height_m=Math.max(signals.max_height_m,height);if(b.min.y<4.6)signals.below_clearance++;if(Math.abs(height-1.1)>.11)signals.wrong_height++;}
  signals.without_lenses=lenses?Math.max(0,heads.count-lenses.count):heads.count;
}
if(!baseline && (signals.below_clearance || signals.wrong_height || signals.without_lenses))throw Error('signal head geometry '+JSON.stringify(signals));
if(!baseline && !missingSafe && !missingSigns && near.stats().sign_panels!==JSON.parse(fs.readFileSync(root+'/v2/data/street/sign_faces.json')).counts.legends)throw Error('blank/missing sign faces');
if(missingSigns && near.stats().sign_panels)throw Error('unidentified sign faces displayed');
// Invisible raised pavement must discard fragments before it can write depth.
if(!baseline)for(const m of near.group.children.filter(m=>['near walk','near curb'].includes(m.name))) {
 const sh={vertexShader:'#include <common>\n#include <begin_vertex>',fragmentShader:'#include <common>\n#include <alphatest_fragment>'};m.material.onBeforeCompile(sh);if(!sh.fragmentShader.includes('discard'))throw Error('invisible pavement still writes depth');
}
let bytes=0,triangles=0,invalid=0;
scene.traverse(m=>{const g=m.geometry;if(!g)return;for(const a of Object.values(g.attributes)){bytes+=a.array.byteLength;for(const v of a.array)if(!Number.isFinite(v))invalid++;}bytes+=g.index?.array.byteLength||0;if(m.instanceMatrix)bytes+=m.instanceMatrix.array.byteLength;triangles+=(g.index?.count||g.attributes.position.count)/3*(m.isInstancedMesh?m.count:1);});
if(invalid)throw Error('nonfinite geometry');
const asphalt=near.group.children.filter(m=>m.name==='near asphalt');if(!baseline && asphalt.length!==1)throw Error('asphalt draw count '+asphalt.length);
const material=asphalt[0].material;if(!baseline && (material.transparent || !material.depthWrite))throw Error('asphalt is not opaque');
let sh={vertexShader:'#include <common>\n#include <begin_vertex>',fragmentShader:'#include <common>\n#include <alphatest_fragment>'};material.onBeforeCompile(sh);
if(!baseline && /diffuseColor.a \*=/.test(sh.fragmentShader))throw Error('asphalt fades');
let samples=[];
for(const [name,x,z,y] of [['Drag',-252,246,8],['West Campus',-515,-213,8],['downtown',-335,1997,8],['high view',0,0,600]]){
 const camera=new THREE.PerspectiveCamera(55,1.6,.1,10000);camera.position.set(x,y,z+45);camera.lookAt(x,0,z);camera.updateMatrixWorld();scene.onBeforeRender(null,scene,camera,null);
 if(!baseline && !asphalt[0].visible)throw Error('asphalt hidden '+name);
 const fr=new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
 const objects=scene.children.flatMap(g=>g.children).filter(m=>m.visible && fr.intersectsObject(m));
 const submittedTriangles=objects.reduce((sum,m)=>sum+(m.geometry.index?.count||m.geometry.attributes.position.count)/3*(m.isInstancedMesh?m.count:1),0);
 samples.push({name,draws:objects.length,submittedTriangles,asphalt:asphalt.some(m=>m.visible),asphaltDraws:asphalt.filter(m=>m.visible && fr.intersectsObject(m)).length});
}
console.log(JSON.stringify({baseline,missingSafe,missingSigns,signals,signClearance,near:near.stats(),street:street.stats(),bufferMB:bytes/1e6,triangles,samples},null,2));
