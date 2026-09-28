import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../../js/graphics.js',import.meta.url),'utf8');
const end=source.indexOf('  // ── DOM ');assert.ok(end>0);
const GPU_KEY='austin3d.gpu.renderer.v1';
// gpu: the renderer a throwaway WebGL context reports (null: no WebGL at all).
// savedGpu: the renderer an earlier visit saved.
function boot({width=651,height=598,dpr=1.5,mobile=false,search='',saved=null,gpu=null,savedGpu=null}={}) {
  let stored=saved===null?null:JSON.stringify(saved);
  const window={innerWidth:width,innerHeight:height,devicePixelRatio:dpr,LITE_PROFILE:{on:mobile,safe:false}};
  const document={createElement:()=>({getContext:()=>gpu===null?null:
    {RENDERER:0x1F01,getParameter:()=>gpu,getExtension:()=>null}})};
  vm.runInNewContext(source.slice(0,end)+'})();',{window,document,location:{search},URLSearchParams,console,
    localStorage:{getItem:key=>key===GPU_KEY?savedGpu:stored,setItem:(key,value)=>{if(key!==GPU_KEY)stored=value;}}});
  return {gfx:window.GFX,msaa:window.GFX_MSAA,stored,gate:window.__gfxGpu};
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
// The 1080p budget is for a graphics card only (claude/no-moire).
const CARD='ANGLE (NVIDIA, NVIDIA GeForce RTX 3050 Ti Laptop GPU (0x000025A0) Direct3D11 vs_5_0 ps_5_0, D3D11)';
const IGPU='ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 vs_5_0 ps_5_0, D3D11)';
const SOFT='ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)';
const laptop={width:1280,height:680,dpr:1.5};
assert.equal(boot({...laptop,gpu:CARD}).msaa,true,'1080p at 150% on a graphics card');
assert.equal(boot({width:1920,height:1080,dpr:1,gpu:CARD}).msaa,true,'1080p at 100% on a graphics card');
assert.equal(boot({...laptop,gpu:'ANGLE (AMD, AMD Radeon RX 6700 XT (0x000073DF) Direct3D11 vs_5_0 ps_5_0, D3D11)'}).msaa,true,'a Radeon RX card');
assert.equal(boot({...laptop,gpu:'ANGLE (Intel, Intel(R) Arc(TM) Graphics (0x00007D55) Direct3D11 vs_5_0 ps_5_0, D3D11)'}).msaa,false,'Core Ultra integrated Arc');
assert.equal(boot({...laptop,gpu:IGPU}).msaa,false,'an integrated chip keeps the old budget');
assert.equal(boot({...laptop,gpu:SOFT}).msaa,false,'a software renderer (the harness) keeps the old budget');
assert.equal(boot({...laptop}).msaa,false,'no WebGL to ask keeps the old budget');
const fromSaved=boot({...laptop,savedGpu:CARD});
assert.equal(fromSaved.msaa,true,'a saved renderer decides with no context');assert.equal(fromSaved.gate.from,'saved');
assert.equal(boot({width:2560,height:1440,dpr:1,gpu:CARD}).msaa,false,'1440p keeps the old default on a card');
assert.equal(boot({mobile:true,search:'?lite=1&preset=performance',gpu:CARD}).msaa,false,'phone profile unchanged on a card');
assert.equal(boot({...laptop,gpu:CARD,saved:{...old,custom:true}}).msaa,false,'manual off survives on a card');
console.log('PASS: bounded desktop default, migration, custom overrides, resize, phone, ultra, capture persistence, and the graphics-card budget');
