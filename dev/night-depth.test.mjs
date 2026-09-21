import fs from 'node:fs';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../js/city-lighting.js',import.meta.url),'utf8');
const start=source.indexOf('    const groundLights=new Set(');
const end=source.indexOf('    let current=null;',start);
assert(start>=0&&end>start);
const install=new Function('window','map',source.slice(start,end));
const legacy={func:519,mask:false,range:[1,1]},solid={func:515,mask:true,range:[0,.999]};
let throws=false;
const circle=p=>{if(throws)throw Error('draw failure');return p.getDepthModeForSublayer(0,false);};
const painter={drawFunctions:{circle,other:42},getDepthModeForSublayer:()=>legacy,getDepthModeFor3D:()=>solid};
const original=painter.getDepthModeForSublayer,w={NIGHT_TUNE:{DEPTH_POOLS:true}};
install(w,{painter});
for(const id of ['night-streetlight-pool','night-streetlight-core','night-tower-pool-fill',
 'entrances-pool','signs-ground-glow','props-lit','props-lit-core']){
 assert.deepEqual(painter.drawFunctions.circle(painter,null,{id}),{...solid,mask:false});
 assert.equal(painter.getDepthModeForSublayer,original);
}
assert.equal(painter.drawFunctions.circle(painter,null,{id:'unrelated-marker'}),legacy);
assert.equal(painter.drawFunctions.other,42);
w.NIGHT_TUNE.DEPTH_POOLS=false;
assert.equal(painter.drawFunctions.circle(painter,null,{id:'night-streetlight-pool'}),legacy);
w.NIGHT_TUNE.DEPTH_POOLS=true;throws=true;
assert.throws(()=>painter.drawFunctions.circle(painter,null,{id:'props-lit'}));
assert.equal(painter.getDepthModeForSublayer,original,'restore painter state even if a draw throws');
console.log('PASS ground-light-only 3D depth, read-only buffer, legacy toggle and exception restoration');
