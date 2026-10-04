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
  return {gfx:window.GFX,msaa:window.GFX_MSAA,stored,gate:window.__gfxGpu,card:window.GFX_GPU_CARD,recheck:window.__gfxWeakRecheck()};
}
// rev 4: a save the stamp-era code wrote. (A rev below 4 with an automatic, unstamped
// Performance is healed once; that is asserted at the end of this block.)
const old={preset:'performance',rev:4,custom:false,autoDetected:true,msaa:false,renderScale:.75,clouds:.22};
assert.equal(boot({search:'?preset=performance'}).msaa,true,'small desktop default');
const migrated=boot({saved:old});assert.equal(migrated.msaa,true);assert.equal(migrated.gfx.clouds,.22);assert.equal(migrated.gfx.autoDetected,true);
assert.equal(boot({saved:{...old,custom:true}}).msaa,false,'manual off survives');
assert.equal(boot({width:2560,height:1440,saved:{...old,custom:true,msaa:true}}).msaa,true,'manual on survives');
assert.equal(boot({width:2560,height:1440,saved:{...old,msaa:true}}).msaa,false,'inherited setting follows larger viewport');
// js/graphics.js REV_UNSTAMPED_AUTO: an old unstamped automatic Performance save goes back to balanced, once.
const unstamped=boot({saved:{...old,rev:3}});
assert.equal(unstamped.gfx.preset,'balanced','old unstamped auto save: back to balanced');
assert.equal(unstamped.gfx.autoDetected,false,'old unstamped auto save: probe armed');
assert.equal(unstamped.gfx.rev,4);assert.equal(JSON.parse(unstamped.stored).preset,'balanced','and the heal is saved');
assert.equal(boot({saved:{...old,rev:3,autoDownAt:Date.now()-3600e3}}).gfx.preset,'performance','a fresh stamp is left alone');
assert.equal(boot({saved:{...old,rev:3,custom:true}}).gfx.preset,'performance','custom is left alone');
assert.equal(boot({saved:old}).gfx.preset,'performance','a rev 4 hand pick (no stamp) stays');
assert.equal(boot({mobile:true,saved:{...old,rev:3}}).gfx.preset,'performance','the phone profile is left on its own default');
assert.equal(boot({saved:{...old,rev:3,preset:'balanced'}}).gfx.preset,'balanced');
assert.equal(boot({mobile:true,search:'?lite=1&preset=performance'}).msaa,false,'phone profile unchanged');
assert.equal(boot({mobile:true,search:'?preset=ultra'}).msaa,true,'explicit ultra unchanged');
assert.equal(boot({width:2560,height:1440,search:'?preset=performance'}).msaa,false,'large framebuffer default unchanged');
assert.equal(boot({search:'?preset=performance',saved:{...old,custom:true}}).stored,JSON.stringify({...old,custom:true}),'capture override does not persist');
// The weak tier (js/graphics.js WEAK_TIER) is an automatic downgrade like the Performance step it sits on:
// it carries the stamp, expires with it, a bad saved value heals, and a hand pick is never overruled.
const DAY=24*3600e3,ALL=2000,WEAK=700;
const weak={...old,autoDownAt:Date.now()-3600e3,fullDetailM:WEAK,weakChecked:true};
const wFresh=boot({saved:weak});
assert.equal(wFresh.gfx.preset,'performance','weak tier: fresh stamp stays on performance');
assert.equal(wFresh.gfx.fullDetailM,WEAK,'weak tier: fresh stamp keeps the tier');
assert.equal(wFresh.gfx.weakChecked,true);assert.equal(wFresh.recheck,false,'weak tier: fresh stamp is not re-measured');
const wOld=boot({saved:{...weak,autoDownAt:Date.now()-30*DAY}});
assert.equal(wOld.gfx.preset,'performance','weak tier: an expired stamp does NOT throw the machine back to balanced');
assert.equal(wOld.gfx.fullDetailM,WEAK,'weak tier: an expired stamp keeps the tier until it is measured');
assert.equal(wOld.recheck,true,'weak tier: an expired stamp arms the measurement at the saved tier');
assert.equal(wOld.gfx.autoDetected,true);
assert.equal(boot({saved:{...weak,autoDownAt:Date.now()+30*DAY}}).recheck,true,'weak tier: a stamp from the future (clock set back) is expired too');
// An expired automatic Performance with no weak tier still goes back to balanced (main's rule).
const pOld=boot({saved:{...old,autoDownAt:Date.now()-30*DAY,weakChecked:true}});
assert.equal(pOld.gfx.preset,'balanced');assert.equal(pOld.gfx.weakChecked,false,'expired performance: the judged flag is cleared');
assert.equal(pOld.recheck,false);assert.equal(pOld.gfx.fullDetailM,ALL);
// No stamp = not the probe's: hand-picked Performance, wrong preset, phone. All go back to "all".
for(const [why,saved,opt] of [
  ['no stamp',{...weak,autoDownAt:undefined}],
  ['stamp 0',{...weak,autoDownAt:0}],
  ['balanced',{...weak,preset:'balanced'}],
  ['phone',{...weak},{mobile:true}],
]){const b=boot({saved,...(opt||{})});
  assert.equal(b.gfx.fullDetailM,ALL,'weak tier: '+why+' goes back to all');assert.equal(b.gfx.weakChecked,false,'weak tier: '+why+' is not judged');
  assert.equal(b.recheck,false);assert.equal(JSON.parse(b.stored).fullDetailM,ALL,'weak tier: '+why+' heal is saved');}
assert.equal(boot({saved:{...weak,custom:true,fullDetailM:400}}).gfx.fullDetailM,400,'weak tier: a moved slider (custom) is kept');
assert.equal(boot({saved:{...weak,custom:true,fullDetailM:400,autoDownAt:Date.now()-30*DAY}}).gfx.fullDetailM,400,'weak tier: custom never expires');
assert.equal(boot({saved:{...weak,custom:true,fullDetailM:400,autoDownAt:Date.now()-30*DAY}}).recheck,false);
// A bad saved value is dropped, and a "judged" flag saved beside it is void.
for(const bad of ['far',5,99999,-1,null,[700],NaN]){const b=boot({saved:{...weak,fullDetailM:bad}});
  assert.equal(b.gfx.fullDetailM,ALL,'weak tier: bad value '+JSON.stringify(bad)+' dropped');assert.equal(b.gfx.weakChecked,false,'weak tier: bad value voids the judged flag');
  assert.equal(b.recheck,false);}
assert.equal(boot({saved:{...weak,fullDetailM:5,autoDownAt:Date.now()-30*DAY}}).gfx.preset,'balanced','weak tier: bad value + expired stamp = balanced');
assert.equal(boot({saved:{...weak,weakChecked:'yes'}}).gfx.weakChecked,true,'weak tier: a saved tier is judged by definition');
assert.equal(boot({saved:{...old,autoDownAt:Date.now()-3600e3,weakChecked:'yes'}}).gfx.weakChecked,false,'weakChecked must be a real boolean');
assert.equal(boot({saved:{...weak,fullDetailM:850}}).gfx.fullDetailM,WEAK,'weak tier follows the current constant');
assert.equal(boot({saved:{...old,autoDownAt:Date.now()-3600e3}}).gfx.weakChecked,false,'a fresh Performance with no weak verdict is still to be judged');
assert.equal(boot({saved:weak,search:'?preset=performance'}).gfx.fullDetailM,ALL,'weak tier: a URL preset is chosen, not measured');
assert.equal(boot({saved:{...weak,autoDownAt:Date.now()-30*DAY},search:'?preset=performance'}).recheck,false,'weak tier: a URL preset is never re-measured');
assert.equal(boot({saved:weak,search:'?preset=performance'}).gfx.autoDownAt,0);
assert.equal(boot({saved:weak,search:'?preset=performance'}).stored,JSON.stringify(weak),'weak tier: a URL preset does not persist');
assert.equal(boot({saved:{...old,autoDownAt:Date.now()-3600e3}}).gfx.fullDetailM,ALL,'performance with no weak tier stays at all');
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
// js/city-lighting.js's far pattern filter is on by default only where this says card (claude/moire-distance).
assert.equal(boot({...laptop,gpu:CARD}).card(),true,'pattern filter: a graphics card');
assert.equal(boot({...laptop,gpu:IGPU}).card(),false,'pattern filter: not on the integrated chip');
assert.equal(boot({...laptop,gpu:SOFT}).card(),false,'pattern filter: not on the harness');
console.log('PASS: bounded desktop default, migration, custom overrides, resize, phone, ultra, capture persistence, the graphics-card budget, and the pattern-filter card test');
