// Exercise the production tiler, including its clipped-window copy. The draw
// sink records colours after window classification, not a reimplementation.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const source=readFileSync(new URL('../js/slopes-apartments.js',import.meta.url),'utf8');
const start=source.indexOf('  function tileFace('),end=source.indexOf('  // ── blades:',start);
assert.ok(start>0&&end>start);
const out=[],night={tune:{on:true,unlitGlass:'#101823'}};
const tile=new Function('window','APTS','wantReveals','rectInCut','faceCell','count',
 source.slice(start,end)+'\nreturn tileFace;')({CityNight:night},{nightLitTone:'#eadfc8'},()=>false,()=>true,
 (...args)=>{out.push(args[7]);return true;},{frames:0,cells:0,windows:0,faces:0});
function draw(lit,{tone,kind=4,nightTone='#cbdde2'}={}){
 out.length=0;
 const glass=['#445566','#8899aa','#e9c27a'];glass.surface=[kind,1,1,1];
 const P={glass,custom:glass,wall:['#aaaabb','#bbbbaa','#111122'],_surfaceGlass:[4,1,1,1]};
 tile({}, {W:{},len:2,z0:0,z1:3}, {rows:()=>[],cols:()=>[],tone:()=>P.wall,
   windows:[{s0:.2,s1:1.8,z0:.5,z1:2.5,lit,nightTone,tone}]},P,{});
 return out.find(c=>c.surface);
}
assert.equal(draw(false)[2],night.tune.unlitGlass,'unoccupied glass must not inherit the bright storefront palette');
assert.equal(draw(false,{tone:'custom'})[2],night.tune.unlitGlass,'explicit glass tone must honor occupancy');
assert.equal(draw(true)[2],'#cbdde2','individual room colour must survive clipping and tiling');
assert.equal(draw(undefined)[2],'#e9c27a','unspecified occupancy preserves authored night lighting');
assert.equal(draw(false,{tone:'custom',kind:1})[2],'#e9c27a','a masonry opening must not be recoloured as glass');
night.tune.on=false;
assert.equal(draw(false)[2],'#e9c27a','disabled system preserves the legacy palette');
console.log('PASS closed rooms, explicit glass, retained room tones, authored exceptions, masonry and legacy fallback');
