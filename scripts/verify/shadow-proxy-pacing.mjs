// The shadow proxy is rebuilt when what it is built from changes, never while
// the camera flies. Exercises the real js/city-lighting.js shadowProxy code
// (no browser) against a scripted map: a flight made of per-frame jumpTo moves
// (move + moveend each frame, as the flycam flies), tiles arriving mid-flight,
// a flight at 2.5 fps, an ease, and moves that do / do not change the tile set.
// Then the authored apartments: 350 buildings built one by one under the veil
// (no rebuild: the proxy reads none of that progress), the build landing, an
// area attaching, the switch, and the base layer's hide list (one rebuild each).
//   node shadow-proxy-pacing.mjs                must exit 0
//   node shadow-proxy-pacing.mjs --break        restores "rebuild 300 ms after any move": must exit 1
//   node shadow-proxy-pacing.mjs --break-storm  restores "rebuild whenever count.buildings moves": must exit 1
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const src=fs.readFileSync(new URL('../../js/city-lighting.js',import.meta.url),'utf8');
const start=src.indexOf('  function shadowProxy(map) {'),end=src.indexOf('  function install(map)',start);
let code=src.slice(start,end);
const BREAK=process.argv.includes('--break');
if(BREAK){
  const pace='const wait=flying?PROXY_PACE.settleMs:PROXY_PACE.settleMs-(Date.now()-proxyMovedAt);';
  if(!code.includes(pace)){console.error('--break: pacing line not found; update the sabotage');process.exit(2);}
  code=code.replace(pace,'const wait=0;');
}
const STORM=process.argv.includes('--break-storm');
if(STORM){
  const sig='return [A?.count.triangles,';
  if(!code.includes(sig)){console.error('--break-storm: signature line not found; update the sabotage');process.exit(2);}
  code=code.replace(sig,'return [A?.count.buildings,');
}

// ── a clock and timers the test owns ─────────────────────────────────────────
let now=1e6,nextId=0;const timers=new Map();
const advance=ms=>{const until=now+ms;for(;;){let due=null;for(const [id,t] of timers)if(t.at<=until&&(!due||t.at<due[1].at))due=[id,t];if(!due)break;timers.delete(due[0]);now=Math.max(now,due[1].at);due[1].fn();}now=until;};

// ── a map: one caster source, tiles with decoded-data objects, one layer ─────
const handlers={};const emit=(n,e)=>(handlers[n]||[]).forEach(f=>f(e));
const square=(x,y,s=1)=>[[x,y],[x+s,y],[x+s,y+s],[x,y+s],[x,y]];
const tile=(key,n)=>({key,index:{},features:Array.from({length:n},(_,i)=>({id:key+i,properties:{id:key+'-'+i,h:20+i},geometry:{type:'Polygon',coordinates:[square(i*2,key.length,1)]}}))});
let tiles=[tile('a',3),tile('b',2)];
const layer={id:'outer-3d',type:'fill-extrusion',source:'austin-outer',sourceLayer:undefined,filter:['>','h',0],visibility:'visible'};
let moving=false,driving=false,qsf=0,b3dFilter=null;
const map={
  on:(n,f)=>(handlers[n]=handlers[n]||[]).push(f),isMoving:()=>moving,triggerRepaint(){},
  getSource:id=>id==='austin-outer'?{}:null,
  getStyle:()=>({layers:[{id:'buildings-3d',type:'fill-extrusion',source:'austin',filter:null},{id:layer.id,type:layer.type,source:layer.source,filter:layer.filter,layout:layer.visibility?{visibility:layer.visibility}:undefined}]}),
  getLayersOrder:()=>['buildings-3d',layer.id],
  getLayer:id=>id===layer.id?layer:id==='buildings-3d'?{id,type:'fill-extrusion',source:'austin',filter:b3dFilter}:null,
  querySourceFeatures:()=>{qsf++;return tiles.flatMap(t=>t.features);},
  style:{tileManagers:{'austin-outer':{getRenderableIds:()=>tiles.map(t=>t.key),getTileByID:id=>{const t=tiles.find(t=>t.key===id);return t&&{latestFeatureIndex:t.index};}}}},
};
class Vector2{constructor(x,y){this.x=x;this.y=y;}}
let built=0;
class Geometry{constructor(){built++;}setAttribute(n,a){this.count=a.n;}dispose(){}}
const THREE={Vector2,BufferGeometry:Geometry,Float32BufferAttribute:class{constructor(a){this.n=a.length/9;}},BufferAttribute:class{constructor(a){this.n=a.length/9;}},Mesh:class{constructor(g,m){this.geometry=g;this.material=m;}},MeshBasicMaterial:class{dispose(){}},
  ShapeUtils:{triangulateShape:c=>c.slice(2).map((_,i)=>[0,i+1,i+2])}};
const window={THREE,slopes:{toLocal:(x,y)=>({x,y})},__fly:{eye:()=>({driving})}};
const scope=vm.createContext({window,stats:{failures:[]},casterSources:['austin-outer'],buildings:[],console,
  setTimeout:(fn,ms)=>{timers.set(++nextId,{fn,at:now+(ms||0)});return nextId;},clearTimeout:id=>timers.delete(id)});
vm.runInContext('Date.now=()=>globalThis.__now();',scope);scope.__now=()=>now;
vm.runInContext('let proxy=null,proxyMap=null,proxyDirty=true,proxyTimer=null,proxySigBuilt=null; const hiddenIds=()=>new Set();\n'+code+'\nglobalThis.build=shadowProxy;',scope);
const frame=(ms,jump=true)=>{if(jump){emit('move');emit('moveend');}scope.build(map);advance(ms);};
const tris=()=>scope.build(map)?.geometry.count;
const results=[];
const check=(name,fn)=>{try{fn();results.push(['PASS',name]);}catch(e){results.push(['FAIL',name+': '+e.message]);}};

// 1. at rest: one rebuild, settleMs after the shadow path first asks
scope.build(map);advance(299);
check('rest: nothing before settleMs',()=>assert.equal(built,0));
advance(1);
check('rest: one rebuild at settleMs',()=>assert.equal(built,1));
const first=tris();

// 2. a boosted flight: a jumpTo every 50 ms for 12 s, a new tile landing at 4 s
driving=true;
for(let i=0;i<240;i++){if(i===80){tiles.push(tile('c',4));emit('sourcedata',{sourceId:'austin-outer'});}frame(50);}
check('flight: no rebuild during a 12 s flight with a tile landing mid-flight',()=>assert.equal(built,1));
// the flycam still owns the camera but has stopped writing to it
for(let i=0;i<20;i++)frame(50,false);
check('flight: no rebuild while the flycam still owns the camera',()=>assert.equal(built,1));
// its last writes (the fx tail), then it lets go
for(let i=0;i<10;i++)frame(50);
driving=false;scope.build(map);advance(249);
check('flight end: not before the camera has been still for settleMs',()=>assert.equal(built,1));
advance(301);
check('flight end: exactly one rebuild once still',()=>assert.equal(built,2));
check('flight end: the rebuild includes the tile that landed mid-flight',()=>assert.ok(tris()>first,`${tris()} vs ${first}`));

// 3. a slow flight: 2.5 fps, so jumps are further apart than settleMs
driving=true;tiles.push(tile('d',1));emit('sourcedata',{sourceId:'austin-outer'});
for(let i=0;i<30;i++)frame(400);
check('slow flight: no rebuild at 2.5 fps while the flycam drives',()=>assert.equal(built,2));
driving=false;scope.build(map);advance(1000);
check('slow flight end: one rebuild',()=>assert.equal(built,3));

// 4. a move that changes nothing the proxy is built from: checked, not rebuilt
const q0=qsf;frame(0);advance(1000);
check('same tiles: a moveend does not rebuild',()=>assert.equal(built,3));
check('same tiles: and does not even query features',()=>assert.equal(qsf,q0));

// 5. a move that changes the drawn tile set
tiles=tiles.filter(t=>t.key!=='a');frame(0);advance(1000);
check('tile set changed by a move: rebuild',()=>assert.equal(built,4));
// 6. same tile keys, new decoded data (a reload): the key sees it even without sourcedata
tiles[0]={...tiles[0],index:{}};frame(0);advance(1000);
check('tile data replaced: rebuild',()=>assert.equal(built,5));
// 7. a layer filter changed, then a move
layer.filter=['>','h',21];frame(0);advance(1000);
check('layer filter changed: rebuild',()=>assert.equal(built,6));
// 8. sourcedata always rebuilds at rest, as before
emit('sourcedata',{sourceId:'austin-outer'});scope.build(map);advance(1000);
check('sourcedata at rest: rebuild',()=>assert.equal(built,7));
// 9. an ease: nothing mid-ease, one rebuild after it ends
moving=true;emit('movestart');tiles.push(tile('e',2));emit('sourcedata',{sourceId:'austin-outer'});
for(let i=0;i<60;i++){emit('move');scope.build(map);advance(50);}
check('ease: no rebuild mid-ease',()=>assert.equal(built,7));
moving=false;emit('moveend');scope.build(map);advance(1000);
check('ease end: one rebuild',()=>assert.equal(built,8));
// 10. the authored apartments. The catalogue arrives: one rebuild, and a
// footprint that covers a caster's centre takes that caster out (its authored
// mesh casts instead).
const bare=tris(),atCentre=tiles.flatMap(t=>t.features).filter(f=>f.geometry.coordinates[0][0][0]===0).length;
const around=(x,y,r=0.0005)=>[[x-r,y-r],[x+r,y-r],[x+r,y+r],[x-r,y+r],[x-r,y-r]];
const A={count:{buildings:0,triangles:0,done:true},data:{buildings:[{id:'apt-1',footprint:{ring:around(0.5,1.5)}}]}};
window.slopesApartments=A;window.APARTMENTS={on:true};
scope.build(map);advance(1000);
check('catalogue arrives: one rebuild',()=>assert.equal(built,9));
check('catalogue arrives: the covered casters are left out',()=>{assert.ok(atCentre>0,'no caster under the footprint');assert.equal(tris(),bare-10*atCentre,`${tris()} vs ${bare} - 10 x ${atCentre}`);});
// 11. the time-sliced build under the veil: count.buildings climbs once per
// building for 35 s with the camera still. None of it reaches the proxy.
for(let i=0;i<350;i++){A.count.buildings++;scope.build(map);advance(100);}
check('build progress: no rebuild while 350 buildings are built one by one',()=>assert.equal(built,9));
// 12. the build lands (count.triangles is set once, then): one rebuild
A.count.triangles=3084685;scope.build(map);advance(1000);
check('build lands: one rebuild',()=>assert.equal(built,10));
// 13. an area attaches: a new catalogue object with more footprints
A.data={buildings:[...A.data.buildings,{id:'apt-2',footprint:{ring:around(2.5,1.5)}}]};A.count.triangles+=618286;
scope.build(map);advance(1000);
check('area attaches: one rebuild',()=>assert.equal(built,11));
check('area attaches: its footprints take their casters out too',()=>assert.ok(tris()<bare-10*atCentre,`${tris()}`));
// 14. apartments switched off: the footprints cast again
window.APARTMENTS.on=false;scope.build(map);advance(1000);
check('apartments off: one rebuild, every caster back',()=>{assert.equal(built,12);assert.equal(tris(),bare);});
window.APARTMENTS.on=true;scope.build(map);advance(1000);
// 15. the base layer's hide list replaced. Its source is not a caster, so no
// sourcedata says so; the signature must.
b3dFilter=['!',['in',['get','id'],['literal',['x']]]];scope.build(map);advance(1000);
check('buildings-3d filter replaced: one rebuild',()=>assert.equal(built,14));
// 16. nothing changed at all, for a long while: nothing
scope.build(map);advance(5000);scope.build(map);advance(5000);
check('at rest: no rebuild without a change',()=>assert.equal(built,14));

// 17. the map goes away mid-wait: nothing fires afterwards
emit('moveend');tiles.pop();scope.build(map);emit('remove');advance(2000);
check('remove: a pending check dies with the map',()=>assert.equal(built,14));

for(const [s,n] of results)console.log(s.padEnd(5),n);
const failed=results.filter(r=>r[0]==='FAIL').length;
console.log(failed?`FAIL: ${failed} of ${results.length}${BREAK||STORM?' (--break: expected)':''}`:`PASS: ${results.length} checks${BREAK||STORM?' -- but --break was supposed to fail':''}`);
process.exit(failed?1:0);
