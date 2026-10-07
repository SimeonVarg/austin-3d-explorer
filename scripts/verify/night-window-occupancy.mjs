// No GPU required: exercise production occupancy and drawn-opening generators.
// Reports horizontal runs, not just overall lit fraction. Natural long runs
// remain valid; systematic pairs/fours are detected by neighbour correlation.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const read = name => fs.readFileSync(new URL('../../js/'+name, import.meta.url), 'utf8');
const window = {};
new Function('window','location','URLSearchParams',read('city-night.js'))(window,{search:''},URLSearchParams);
const night = window.CityNight;
const apartments = read('slopes-apartments.js'), facades = read('facades.js'), heroes = read('heroes.js');
function section(source, start, end) { const i=source.indexOf(start); assert.ok(i>=0,start); return source.slice(i,source.indexOf(end,i)); }
const windows = new Function('window','APTS','h01',section(apartments,'  function windowsFromBays(','\n  /**')+';return windowsFromBays;')(window,{nightLit:.45},night.hash);
const facadeHash = new Function(section(facades,'  function hash01(','\n  }')+'\n};return hash01;')();
const heroHash = new Function(section(heroes,'  function hash01(','\n  }')+'\n};return hash01;')();
const paneExpression = facades.match(/const paneIndex = ([^;]+);/);
assert.ok(paneExpression,'facade painter exposes the actual drawn-column choice');
const paneIndex = new Function('window','c','return '+paneExpression[1]);
const rollExpression=facades.match(/const roll = ([^;]+);\s*const isLit = night > 0.05/);
assert.ok(rollExpression,'use the production facade occupancy expression');
const facadeRoll=new Function('window','hash01','seed','r','c','paneIndex','const scatter=window.CityNight.tune.windowScatter;return '+rollExpression[1]);
assert.match(apartments,/CityNight.room\(key,storey,ci,pi\)/);
assert.match(apartments,/'public-room',fi,window.CityNight.tune.windowScatter \? i : Math.floor\(i\/2\)/);

export function runStats(rows) {
  const histogram={}; let lit=0,total=0,neighbours=0,litNeighbours=0,runs=0;
  for(const row of rows) { let run=0;
    for(let i=0;i<=row.length;i++) {
      if(i<row.length) {total++;if(row[i])lit++;if(i&&row[i-1]){neighbours++;if(row[i])litNeighbours++;}}
      if(row[i])run++; else if(run){histogram[run]=(histogram[run]||0)+1;runs++;run=0;}
    }
  }
  return {litFraction:lit/total,meanRun:lit/runs,singleRunFraction:(histogram[1]||0)/runs,
    nextLitGivenLit:litNeighbours/neighbours,histogram,windows:total};
}
const floors=Array.from({length:32},(_,i)=>i*3);
const ctx={len:192,z0:0,z1:96,floors,allFloors:floors};
function modelRows(parts) {
  const rows=[];
  for(let building=0;building<24;building++) {
    const id='occupancy-fixture-'+building;night.register({id});
    const spec={bay:3,window:{w:1,h:2,sill:.7,...(parts===2?{offsets:[[-.75,.6],[.75,.6]]}:{})}};
    const drawn=windows(spec,ctx,{},id+'|east|wall');
    for(const z of floors)rows.push(drawn.filter(w=>Math.abs(w.z0-z-.7)<1e-7).sort((a,b)=>a.s0-b.s0).map(w=>w.lit));
  }
  return rows;
}
function facadeRows() { const rows=[];for(let seed=0;seed<48;seed++)for(let r=0;r<32;r++)rows.push(Array.from({length:64},(_,c)=>facadeRoll(window,facadeHash,seed,r,c,paneIndex(window,c))<.38));return rows; }
const result={};
for(const [family,make] of Object.entries({facade:facadeRows,authored:()=>modelRows(1),multipleOpeningsPerBay:()=>modelRows(2)})) {
  night.tune.windowScatter=false;const before=runStats(make());
  night.tune.windowScatter=true;const afterRows=make(),after=runStats(afterRows);
  assert.deepEqual(make(),afterRows,family+' stable across time/repaints');
  assert.ok(Math.abs(after.litFraction-before.litFraction)<.025,family+' retains occupancy');
  assert.ok(after.meanRun<before.meanRun*.7,family+' removes forced runs');
  assert.ok(after.singleRunFraction>.45,family+' individual lit openings occur');
  result[family]={before,after};
}
// Hero tiles already pick per drawn c/r. Keep their existing density; include
// them in the report so they cannot silently become grouped in a later pass.
assert.match(heroes,/hash01\(c \+ 11, r \+ 4\) < HEROES.glassLit/);
const heroRows=Array.from({length:96},(_,r)=>Array.from({length:64},(_,c)=>heroHash(c+11,r+4)<.4));
result.heroUnchanged=runStats(heroRows);
assert.ok(result.heroUnchanged.singleRunFraction>.1,'hero has independent openings');
console.log(JSON.stringify(result,null,2));
console.error('PASS: occupancy retained; forced horizontal runs removed; stable drawn-window picks');
