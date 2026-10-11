/** Check production four-tap PCF against all 512 possible 3x3 visibility grids.
 * --break changes a production coefficient in memory and must fail.
 * This establishes filter algebra, not depth-attachment precision on a GPU.
 */
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
let source=fs.readFileSync(new URL('../../js/city-lighting.js',import.meta.url),'utf8');
if(process.argv.includes('--break'))source=source.replace('(4.0*a+2.0*b+2.0*c+d)/9.0','(3.0*a+2.0*b+2.0*c+d)/9.0');
const context={URLSearchParams,location:{search:'?shadowcompare=1'}};context.window=context;
vm.runInNewContext(source,context);
const glsl=context.CityLighting.glsl;
const kernel=glsl.match(/float shadowSample\(highp sampler2DShadow[\s\S]+?\n    }/)[0];
const taps=[...kernel.matchAll(/float ([a-z])=textureLod\(shadowMap,vec3\(center\+vec2\(([-.\d]+),([-.\d]+)\)\*stepUV,ref\),0\.0\);/g)].map(m=>({name:m[1],x:Number(m[2]),y:Number(m[3])}));
assert.equal(taps.length,4,'production kernel must expose four comparison samples');
const expression=kernel.match(/return (.+);/)[1];
const combine=new Function(...taps.map(t=>t.name),'return '+expression);
function bilinear(grid,x,y){
 const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;
 const at=(a,b)=>grid[(Math.max(-1,Math.min(1,b))+1)*3+Math.max(-1,Math.min(1,a))+1];
 return at(ix,iy)*(1-fx)*(1-fy)+at(ix+1,iy)*fx*(1-fy)+at(ix,iy+1)*(1-fx)*fy+at(ix+1,iy+1)*fx*fy;
}
let maxError=0;
for(let mask=0;mask<512;mask++){
 const grid=Array.from({length:9},(_,i)=>(mask>>i)&1),expected=grid.reduce((a,b)=>a+b,0)/9;
 const actual=combine(...taps.map(t=>bilinear(grid,t.x,t.y)));
 maxError=Math.max(maxError,Math.abs(actual-expected));
 assert.equal(actual,expected,`visibility grid ${mask}: hardware weights differ from nine equal comparisons`);
}
console.log(JSON.stringify({pass:true,grids:512,maxError,taps,limits:'GPU depth precision, sampler behavior and state restoration still require render checks'}));
