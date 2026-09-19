// Independent direct convolution catches wrap/stride mistakes in the shared
// colour and material-mask filter, including kernels wider than the image.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const context={window:{}};
vm.runInNewContext(readFileSync(new URL('../js/pattern-lowpass.js',import.meta.url),'utf8'),context);
const blur=context.window.PatternLowpass.blurWrap;
let cases=0;
for(const size of [1,3,8,16])for(const radius of [0,1,3,10])for(const amount of [0,.4,1]){
  const original=Uint8ClampedArray.from({length:size*size*4},(_,i)=>i%4===3?(i%12===3?191:255):(i*71+23)%256);
  const actual=original.slice(),expected=original.slice(),wrap=i=>(i%size+size)%size;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++)for(let c=0;c<4;c++){
    let sum=0;for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++)sum+=original[(wrap(y+dy)*size+wrap(x+dx))*4+c];
    const i=(y*size+x)*4+c;expected[i]+=(sum/(radius*2+1)**2-original[i])*amount;
  }
  blur(actual,size,radius,amount);assert.deepEqual(actual,expected);cases++;
}
console.log(`PASS: ${cases} RGBA wrap-filter cases against direct convolution`);
