import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../../js/graphics.js',import.meta.url),'utf8');
const end=source.indexOf('  // ── DOM ');assert.ok(end>0);
function boot({width=651,height=598,dpr=1.5,mobile=false,search='',saved=null}={}) {
  let stored=saved===null?null:JSON.stringify(saved);
  const window={innerWidth:width,innerHeight:height,devicePixelRatio:dpr,LITE_PROFILE:{on:mobile,safe:false}};
  vm.runInNewContext(source.slice(0,end)+'})();',{window,location:{search},URLSearchParams,console,
    localStorage:{getItem:()=>stored,setItem:(_key,value)=>{stored=value;}}});
  return {gfx:window.GFX,msaa:window.GFX_MSAA,stored};
}
const old={preset:'performance',rev:2,custom:false,autoDetected:true,msaa:false,renderScale:.75,clouds:.22};
assert.equal(boot({search:'?preset=performance'}).msaa,true,'small desktop default');
const migrated=boot({saved:old});assert.equal(migrated.msaa,true);assert.equal(migrated.gfx.clouds,.22);assert.equal(migrated.gfx.autoDetected,true);
assert.equal(boot({saved:{...old,custom:true}}).msaa,false,'manual off survives');
assert.equal(boot({width:2560,height:1440,saved:{...old,custom:true,msaa:true}}).msaa,true,'manual on survives');
assert.equal(boot({width:2560,height:1440,saved:{...old,rev:3,msaa:true}}).msaa,false,'inherited setting follows larger viewport');
assert.equal(boot({mobile:true,search:'?lite=1&preset=performance'}).msaa,false,'phone profile unchanged');
assert.equal(boot({mobile:true,search:'?preset=ultra'}).msaa,true,'explicit ultra unchanged');
assert.equal(boot({width:2560,height:1440,search:'?preset=performance'}).msaa,false,'large framebuffer default unchanged');
assert.equal(boot({search:'?preset=performance',saved:{...old,custom:true}}).stored,JSON.stringify({...old,custom:true}),'capture override does not persist');
console.log('PASS: bounded desktop default, migration, custom overrides, resize, phone, ultra and capture persistence');
