// CPU-only lifecycle contract for the actual roof-underside installer.
// --break restores the discarded-group toggle bug and must fail.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source=fs.readFileSync(new URL('../../js/heroes.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const begin=source.indexOf('  function installRoofUndersides(map, gj) {');
const end=source.indexOf('\n  let _added = false;',begin);
assert(begin>=0&&end>begin,'actual installer boundary must exist');
let installer=source.slice(begin,end);
if(process.argv.includes('--break')){
  const original='if (group) S.remove(group);\n        return;';
  assert(installer.includes(original),'toggle sabotage still targets the real branch');
  installer=installer.replace(original,'if (group) S.remove(group); group = null;\n        return;');
}
for(const building of ['nhb']) if(process.argv.includes('--break-'+building)){
  const original="f.properties.b === '"+building+"'";
  assert(installer.includes(original),'omission control targets the actual '+building+' selector');
  installer=installer.replace(original,'false');
}
const gj=JSON.parse(fs.readFileSync(new URL('../../data/heroes.geojson',import.meta.url),'utf8'));
// Explicit expected parts avoid silently including solid parapets or the NHB
// louvre sitting on the deck. These are the four exposed roof planes.
const roofs=gj.features.filter(({properties:p})=>
  (p.b==='gdc'&&p.cap===1)||(p.b==='nhb'&&p.band==='deck'));
assert.equal(roofs.length,4);
assert.equal(roofs.filter(f=>f.properties.b==='gdc').length,3);
assert.ok(roofs.every(f=>f.geometry.type==='Polygon'&&f.geometry.coordinates.length===1),
  'these exposed roofs must have simple rings, without courtyard holes');
const plain=v=>JSON.parse(JSON.stringify(v));

function fixture(late=false){
  const polygons=[],hooks=[],timers=new Map(),listeners=new Map();
  const count={builds:0,geometries:0,materials:0,geometryDisposals:0,materialDisposals:0,repaints:0};
  let nextTimer=0;
  class Group{
    constructor(){this.children=[];this.userData={};this.parent=null;}
    add(o){if(o.parent)o.parent.remove(o);this.children.push(o);o.parent=this;}
    remove(o){this.children=this.children.filter(c=>c!==o);if(o.parent===this)o.parent=null;}
    traverse(fn){fn(this);for(const child of this.children)child.traverse?child.traverse(fn):fn(child);}
  }
  class Mesh{constructor(geometry,material){this.geometry=geometry;this.material=material;this.parent=null;}}
  const root=new Group();
  const slopes={root:late?null:root,
    toLocal:(lng,lat,z)=>({x:lng*1000,y:lat*1000,z}),
    onSwitch:fn=>hooks.push(fn),
    add:g=>slopes.root.add(g),remove:g=>slopes.root?.remove(g),
    build(){count.builds++;let triangles=0;return {
      polygon(points,colours,normal,plane){polygons.push(plain({points,colours,normal,plane}));triangles+=points.length-2;},
      geometry(){count.geometries++;return {dispose(){count.geometryDisposals++;}};},
      get triangles(){return triangles;},
    };},
    material(){count.materials++;return {dispose(){count.materialDisposals++;}};},
  };
  const window={slopes,THREE:{Group,Mesh},SLOPES:{on:true},__heroes:{}};
  const map={once:(name,fn)=>listeners.set(name,fn),triggerRepaint:()=>count.repaints++};
  const scope=vm.createContext({window,HEROES:{on:true,minZoom:14},console,
    setTimeout(fn){const id=++nextTimer;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id)});
  vm.runInContext(installer+'\nwindow.install=installRoofUndersides;',scope);
  window.install(map,gj);
  return {count,root,slopes,window,polygons,hooks,timers,
    toggle(on){window.SLOPES.on=on;for(const hook of hooks)hook(on);},
    remove(){const fn=listeners.get('remove');listeners.delete('remove');fn?.();},
    tick(){const entries=[...timers];timers.clear();for(const [,fn]of entries)fn();},
  };
}

const live=fixture();
assert.equal(live.count.builds,1);
assert.equal(live.root.children.length,1);
assert.equal(live.polygons.length,4,'NHB deck and the three existing GDC caps');
assert.equal(live.window.__heroes.roofUndersides.triangles,
  roofs.reduce((n,f)=>n+f.geometry.coordinates[0].length-3,0));
for(let i=0;i<roofs.length;i++){
  const roof=roofs[i],emitted=live.polygons[i];
  assert.deepEqual(emitted.normal,[0,0,-1],'undersides must face down');
  assert.equal(emitted.plane,'xy');
  assert.deepEqual(emitted.points,roof.geometry.coordinates[0].slice(0,-1).map(([lng,lat])=>[lng*1000,lat*1000,roof.properties.base]),'use the baked roof perimeter and underside elevation');
  assert.deepEqual(emitted.colours,[roof.properties.wd,roof.properties.wg,roof.properties.wn]);
}
const originalGroup=live.root.children[0];
assert.equal(originalGroup.userData.minzoom,14);
for(let i=0;i<3;i++)forToggle();
function forToggle(){
  live.toggle(false);assert.equal(live.root.children.length,0);
  assert.equal(live.count.geometryDisposals,0,'toggle retains resources');
  live.toggle(true);assert.equal(live.root.children.length,1);
  assert.equal(live.root.children[0],originalGroup,'reattach the same owned mesh');
  assert.equal(live.count.builds,1,'no allocation on repeated toggles');
}
live.remove();
assert.equal(live.root.children.length,0);
assert.equal(live.count.geometryDisposals,1);
assert.equal(live.count.materialDisposals,1);
live.toggle(false);live.toggle(true);
assert.equal(live.root.children.length,0,'removed map cannot reattach geometry');
assert.equal(live.count.builds,1);

const detached=fixture();detached.toggle(false);detached.remove();
assert.equal(detached.count.geometryDisposals,1,'removed map also disposes a retained but detached group');
assert.equal(detached.count.materialDisposals,1);

const late=fixture(true);
assert.equal(late.count.builds,0);assert.equal(late.timers.size,1);
late.slopes.root=late.root;late.tick();
assert.equal(late.count.builds,1,'late renderer boot builds once');
assert.equal(late.timers.size,0);late.remove();
assert.equal(late.count.geometryDisposals,1);

const cancelled=fixture(true);
const staleCallback=[...cancelled.timers.values()][0];
cancelled.remove();assert.equal(cancelled.timers.size,0,'remove cancels pending boot timer');
cancelled.slopes.root=cancelled.root;staleCallback();
assert.equal(cancelled.count.builds,0,'even an already-queued boot must respect removed');
assert.equal(cancelled.hooks.length,0);
assert.equal(cancelled.root.children.length,0);
console.log('PASS: four downward roof caps (GDC, NHB); retained toggles; disposal; late boot and cancellation');
