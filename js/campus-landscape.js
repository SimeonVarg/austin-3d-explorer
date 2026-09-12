/* Campus planting: continuous crowns and branching trunks from the existing
 * tree inventory. One compact bake; old tree layers remain the instant fallback.
 * Garden positions and their evidence live in data/campus_gardens.json. */
(function(){
 'use strict';
 const q=new URLSearchParams(location.search);
 const C=window.CAMPUS_LANDSCAPE={
  on:q.get('campuslandscape')!=='0',url:'data/campus_landscape.json',minzoom:14,chunkSize:180,
  crown:{segments:10,rings:5,lobes:5,lobeDepth:.12,wave:.04,mainSpread:.78,clusterSize:.58,clusterOffset:.46,clusterDepth:.71,clusterBase:-.16,clusterJitter:.22,clusterQuality:.7,shade:.90},
  trunk:{radius:.22,largeRadius:.48,radiusRatio:.055,limbs:3,segments:5,branchReach:.63,branchRise:.62,forkHeight:.18,forkMin:1.8,topRadius:.7,limbRadius:.48,tipRadius:.15},
  species:{liveoak:{spread:1.03,depth:.78},oak:{spread:1,depth:.88},elm:{spread:.91,depth:1},pecan:{spread:.92,depth:1.06},crape:{spread:.79,depth:.91},magnolia:{spread:.85,depth:1.04},cedar:{spread:.78,depth:1.2},cypress:{spread:.75,depth:1.25},other:{spread:.95,depth:.93}},
  leaf:[['#54704b','#72704b','#10201a'],['#607c50','#7b784b','#13221a'],['#465f43','#666849','#101d18'],['#6b8057','#827e54','#17251c']],
  bark:['#6d6250','#806a50','#171a19'],
  gardens:{lawn:['#64864f','#7b8450','#112018'],bed:['#69583f','#786046','#171811'],hedge:['#456243','#666b43','#0d1b13'],stone:['#c7bda7','#cdb792','#222320'],pave:['#c8bfaa','#d0b78f','#25251f'],water:['#54776b','#6e826b','#101f21'],bench:['#796149','#8c6d4c','#1d1c19'],mulch:['#746047','#7c6345','#171812']},
  gardenHeights:{lawn:.10,bed:.14,pave:.25,hedge:.78,stone:.45,water:.31},
  livingWall:{bottom:.45,spacing:.65,radius:.4},fountain:{stem:.16,bowl:.55,height:1.45},shrubQuality:1.3,
 };
 let data=null,map=null,group=null,originalFilter=null,lastDensity=-1,lastDetail=-1;
 const count={done:false,trees:0,triangles:0,gardens:0};
 const hash=(n,k=0)=>{const x=Math.sin(n*127.1+k*311.7)*43758.5453;return x-Math.floor(x)};
 const norm=a=>{const l=Math.hypot(...a)||1;return a.map(v=>v/l)};
 const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
 const mixTone=(col,f)=>col.map(h=>'#'+h.slice(1).match(/../g).map(s=>Math.round(Math.min(255,parseInt(s,16)*f)).toString(16).padStart(2,'0')).join(''));
 function stem(B,a,b,r0,r1,col){
  const N=norm(b.map((v,i)=>v-a[i])),U=norm(cross(N,Math.abs(N[2])>.9?[1,0,0]:[0,0,1])),V=cross(N,U),n=C.trunk.segments;
  const ring=(p,r,k)=>p.map((v,i)=>v+r*(Math.cos(k/n*Math.PI*2)*U[i]+Math.sin(k/n*Math.PI*2)*V[i]));
  for(let j=0;j<n;j++){const p=ring(a,r0,j),s=ring(a,r0,j+1),t=ring(b,r1,j+1),u=ring(b,r1,j);B.quad(p,s,t,u,col,p.map((v,i)=>v-a[i]));}
 }
 function crown(B,center,radii,seed,col,quality=1){
  const n=Math.max(6,Math.round(C.crown.segments*slopes.detail()*quality)),m=Math.max(3,Math.round(C.crown.rings*slopes.detail()*quality));
  const at=(i,j)=>{
   const theta=i/n*Math.PI*2,phi=j/m*Math.PI,sp=Math.sin(phi),cp=Math.cos(phi);
   const ripple=1+C.crown.lobeDepth*Math.sin(C.crown.lobes*theta+seed)*sp+C.crown.wave*Math.sin(3*phi+theta+seed);
   const x=Math.cos(theta)*sp,y=Math.sin(theta)*sp,z=cp;
   return {p:[center[0]+radii[0]*x*ripple,center[1]+radii[1]*y*ripple,center[2]+radii[2]*z*(1+C.crown.wave*Math.sin(theta+seed)*sp)],n:norm([x/radii[0],y/radii[1],z/radii[2]])};
  };
  for(let j=0;j<m;j++)for(let i=0;i<n;i++){
   const a=at(i,j),b=at(i+1,j),c=at(i+1,j+1),d=at(i,j+1);
   const tone=mixTone(col,C.crown.shade+(1-C.crown.shade)*(1-j/m));
   B.triN(a.p,b.p,c.p,a.n,b.n,c.n,tone);B.triN(a.p,c.p,d.p,a.n,c.n,d.n,tone);
  }
 }
 function buildTrees(chunks){
  const density=window.GFX?.treeDensity??1;
  count.trees=0;
  for(let i=0;i<data.trees.length;i++){
   const [lng,lat,r,base,top,sp,d,hue]=data.trees[i];if(d>density)continue;
   const p=slopes.toLocal(lng,lat,0),form=C.species[sp]||C.species.other,seed=hash(i,8)*Math.PI*2;
   const key=Math.floor(p.x/C.chunkSize)+','+Math.floor(p.y/C.chunkSize);
   if(!chunks.has(key))chunks.set(key,slopes.build());const B=chunks.get(key);
   const height=Math.max(2,top-base),radius=r*form.spread,half=Math.min(height/2*form.depth,(top-.8)/2),cz=top-half;
   const col=C.leaf[Math.min(C.leaf.length-1,Math.floor(hue*C.leaf.length))],thick=Math.min(C.trunk.largeRadius,Math.max(C.trunk.radius,r*C.trunk.radiusRatio));
   const fork=[p.x+Math.cos(seed)*thick,p.y+Math.sin(seed)*thick,Math.max(C.trunk.forkMin,base+height*C.trunk.forkHeight)];
   stem(B,[p.x,p.y,0],fork,thick,thick*C.trunk.topRadius,C.bark);
   crown(B,[p.x,p.y,cz],[radius*C.crown.mainSpread,radius*C.crown.mainSpread,half],seed,col);
   const limbs=C.trunk.limbs;
   for(let j=0;j<limbs;j++){
    const a=seed+j/limbs*Math.PI*2,reach=radius*C.trunk.branchReach*(.82+hash(i,j)*.24),z=base+height*C.trunk.branchRise;
    const end=[p.x+Math.cos(a)*reach,p.y+Math.sin(a)*reach,z];
    stem(B,fork,end,thick*C.trunk.limbRadius,thick*C.trunk.tipRadius,C.bark);
    // Overlapping crowns make a broad, irregular outline instead of flat tiers.
    const s=C.crown.clusterSize;
    crown(B,[p.x+Math.cos(a)*radius*C.crown.clusterOffset,p.y+Math.sin(a)*radius*C.crown.clusterOffset,cz+half*C.crown.clusterBase+hash(i,j+20)*half*C.crown.clusterJitter],[radius*s,radius*s,half*C.crown.clusterDepth],seed+j,col,C.crown.clusterQuality);
   }
   count.trees++;
  }
 }
 function polygon(B,rings,z,col){
  const R=rings.map(r=>{const open=r.length>1&&r[0][0]===r.at(-1)[0]&&r[0][1]===r.at(-1)[1]?r.slice(0,-1):r;return open.map(ll=>{const p=slopes.toLocal(ll[0],ll[1],z);return [p.x,p.y,p.z]})});
  const flat=R.flat(),indices=THREE.ShapeUtils.triangulateShape(R[0].map(p=>new THREE.Vector2(p[0],p[1])),R.slice(1).map(r=>r.map(p=>new THREE.Vector2(p[0],p[1]))));
  for(const [a,b,c]of indices)B.tri(flat[a],flat[b],flat[c],col,[0,0,1]);
 }
 function boxMesh(B,c,u,v,z0,z1,col,bearing=0){
  const a=bearing*Math.PI/180,cs=Math.cos(a),sn=Math.sin(a);
  const P=(x,y,z)=>[c.x+x*cs-y*sn,c.y+x*sn+y*cs,z];
  const r=[[-u/2,-v/2],[u/2,-v/2],[u/2,v/2],[-u/2,v/2]];
  B.quad(...r.map(([x,y])=>P(x,y,z1)),col,[0,0,1]);
  for(let j=0;j<4;j++){const a=r[j],b=r[(j+1)%4];B.quad(P(...a,z0),P(...b,z0),P(...b,z1),P(...a,z1),col)}
 }
 function inRing(x,y,r){let inside=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside}return inside}
 function shrubs(B,f){
  const R=f.rings.map(r=>r.map(ll=>{const p=slopes.toLocal(...ll,0);return [p.x,p.y]})),xs=R[0].map(p=>p[0]),ys=R[0].map(p=>p[1]),T=data.gardens.detail;
  let i=0;
  for(let x=Math.min(...xs)+T.plantRadius;x<Math.max(...xs);x+=T.plantSpacing)for(let y=Math.min(...ys)+T.plantRadius;y<Math.max(...ys);y+=T.plantSpacing){
   if(!inRing(x,y,R[0])||R.slice(1).some(r=>inRing(x,y,r)))continue;
   const r=T.plantRadius*(.75+hash(i++,x)*.4),z=T.plantHeight*(.7+hash(i,y)*.3);
   crown(B,[x,y,z*.5+.14],[r,r,z*.5],i,C.gardens.hedge,C.shrubQuality);
  }
 }
 function buildGardens(B){
  count.gardens=0;
  for(const place of data.gardens.places||[])for(const f of place.features||[]){
   const col=C.gardens[f.kind]||C.gardens.bed,z=f.height??C.gardenHeights[f.kind]??.1;
   if(f.rings){
    polygon(B,f.rings,z,col);
    if(z>.2)for(const ring of f.rings)for(let i=0;i<ring.length-1;i++){
     const a=slopes.toLocal(...ring[i],0),b=slopes.toLocal(...ring[i+1],0);B.quad([a.x,a.y,0],[b.x,b.y,0],[b.x,b.y,z],[a.x,a.y,z],col);
    }
    if(f.plants)shrubs(B,f);
   }
   if(f.kind==='bench'){
    const T=data.gardens.detail,p=slopes.toLocal(...f.at,0),a=f.bearing||0;
    for(let y=-T.benchWidth/2;y<T.benchWidth/2;y+=T.benchSlat*1.2){
     const r=a*Math.PI/180,c={x:p.x-y*Math.sin(r),y:p.y+y*Math.cos(r)};
     boxMesh(B,c,T.benchLength,T.benchSlat,T.benchHeight-.06,T.benchHeight,C.gardens.bench,a);
    }
    for(const x of [-T.benchLength*.36,T.benchLength*.36]){const r=a*Math.PI/180;boxMesh(B,{x:p.x+x*Math.cos(r),y:p.y+x*Math.sin(r)},.09,T.benchWidth,.1,T.benchHeight,C.bark,a)}
    const r=a*Math.PI/180,back={x:p.x+T.benchWidth*.5*Math.sin(r),y:p.y-T.benchWidth*.5*Math.cos(r)};
    for(let z=T.benchHeight+.16;z<T.benchBack;z+=T.benchSlat*1.3)boxMesh(B,back,T.benchLength,.07,z,z+T.benchSlat,C.gardens.bench,a);
   }
   if(f.kind==='livingWall'){
    const a=slopes.toLocal(...f.line[0],0),b=slopes.toLocal(...f.line[1],0),length=Math.hypot(b.x-a.x,b.y-a.y),T=C.livingWall;
    for(let s=T.spacing/2;s<length;s+=T.spacing)for(let z=T.bottom;z<f.height;z+=T.spacing)crown(B,[a.x+(b.x-a.x)*s/length,a.y+(b.y-a.y)*s/length,z],[T.radius,T.radius,T.radius],s+z,C.gardens.hedge,.6);
   }
   if(f.kind==='fountain'){
    const p=slopes.toLocal(...f.at,0),T=C.fountain;
    stem(B,[p.x,p.y,.46],[p.x,p.y,T.height],T.stem,T.stem,C.gardens.stone);
    crown(B,[p.x,p.y,T.height],[T.bowl,T.bowl,.12],0,C.gardens.stone,.8);
   }
   count.gardens++;
  }
 }
 function build(){
  const chunks=new Map();count.triangles=0;buildTrees(chunks);
  const gardens=slopes.build();buildGardens(gardens);chunks.set('gardens',gardens);
  const g=new THREE.Group();g.name='campus-landscape';g.userData.minzoom=C.minzoom;
  for(const [key,B]of chunks){if(!B.triangles)continue;const mesh=new THREE.Mesh(B.geometry(),slopes.material());mesh.name='campus-'+key;g.add(mesh);count.triangles+=B.triangles}
  lastDensity=window.GFX?.treeDensity??1;lastDetail=slopes.detail();return g;
 }
 const canopyKey=['concat',['to-string',['get','d']],'|',['coalesce',['get','sp'],'other'],'|',['to-string',['coalesce',['get','r0'],0]],'|',['to-string',['coalesce',['get','j'],0]]];
 const trunkKey=['concat',['to-string',['get','d']],'|',['to-string',['get','h']]];
 function drop(){
  if(!group)return;
  slopes.remove(group);group.traverse(o=>o.geometry?.dispose());group=null;
 }
 function apply(){
  if(!data||!map||!window.slopes?.root)return;
  const on=C.on&&SLOPES.on;
  if(group&&(!on||lastDensity!==(window.GFX?.treeDensity??1)||lastDetail!==slopes.detail()))drop();
  if(on&&!group){group=build();slopes.add(group)}
  if(originalFilter)window.applyTreeDensity(map);
  map.triggerRepaint();
 }
 window.applyCampusLandscape=apply;
 window.campusLandscape={get count(){return {...count}},get group(){return group},get data(){return data},rebuild(){drop();apply()}};
 if(q.get('slopes')==='0'){count.done=true;return}
 let busy=false;
 const timer=setInterval(async()=>{
  if(busy||!window.__map?.getLayer('trees-canopy')||!window.slopes?.root||!window.treeFilter)return;
  busy=true;
  try{
   map=window.__map;data=await slopes.fetchJSON(C.url);originalFilter=window.treeFilter;
   window.treeFilter=function(kind){
    const base=originalFilter(kind);if(!C.on||!SLOPES.on||!group)return base;
    const key=kind==='canopy'?canopyKey:trunkKey,keys=kind==='canopy'?data.canopyKeys:data.trunkKeys;
    // MapLibre's within expression does not match polygon features. These
    // recorded compound keys identify whole crowns across all their tiers.
    return ['all',base,['!',['in',key,['literal',keys]]]];
   };
   slopes.onSwitch(apply);apply();count.done=true;console.log('[campus-landscape]',count.trees,'trees',count.gardens,'garden surfaces',count.triangles,'triangles');
   // Presets and density controls already call applyTreeDensity; rebuild the
   // mesh at that same transition, without changing the app's base tree filter.
   const densityApply=window.applyTreeDensity;
   window.applyTreeDensity=function(m){densityApply(m);if(C.on&&SLOPES.on&&((window.GFX?.treeDensity??1)!==lastDensity||slopes.detail()!==lastDetail))apply()};
  }catch(e){console.error('[campus-landscape]',e);count.done=true}
  clearInterval(timer);
 },180);
})();
