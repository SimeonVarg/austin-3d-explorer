// Compare the optimized traversal with the retained pre-change implementation,
// including alpha, edge wrapping, fractional blending and reused scratch sizes.
import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const load=s=>{const c=vm.createContext({window:{}});vm.runInContext(s,c);return c.window.PatternLowpass.blurWrap;};
// Frozen column-first oracle from 3b28126. Keep independent of the optimized code.
let _tmp = null;
  function blurWrap(d, res, r, a) {
    if (!r || a <= 0) return;
    const N = res * res, win = r * 2 + 1, area = win * win;
    if (!_tmp || _tmp.length < N * 4) _tmp = new Float32Array(N * 4);
    const tmp = _tmp;
    const wrap = i => ((i % res) + res) % res;
    // horizontal — tmp keeps the window SUM
    for (let y = 0; y < res; y++) {
      const row = y * res;
      let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
      for (let k = -r; k <= r; k++) {
        const i = (row + wrap(k)) * 4;
        s0 += d[i]; s1 += d[i + 1]; s2 += d[i + 2]; s3 += d[i + 3];
      }
      for (let x = 0; x < res; x++) {
        const o = (row + x) * 4;
        tmp[o] = s0; tmp[o + 1] = s1; tmp[o + 2] = s2; tmp[o + 3] = s3;
        const ia = (row + wrap(x + r + 1)) * 4, is = (row + wrap(x - r)) * 4;
        s0 += d[ia] - d[is]; s1 += d[ia + 1] - d[is + 1]; s2 += d[ia + 2] - d[is + 2]; s3 += d[ia + 3] - d[is + 3];
      }
    }
    // vertical, and blend straight back into the pixel buffer
    for (let x = 0; x < res; x++) {
      let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
      for (let k = -r; k <= r; k++) {
        const o = (wrap(k) * res + x) * 4;
        s0 += tmp[o]; s1 += tmp[o + 1]; s2 += tmp[o + 2]; s3 += tmp[o + 3];
      }
      for (let y = 0; y < res; y++) {
        const i = (y * res + x) * 4;
        d[i]     += (s0 / area - d[i])     * a;
        d[i + 1] += (s1 / area - d[i + 1]) * a;
        d[i + 2] += (s2 / area - d[i + 2]) * a;
        d[i + 3] += (s3 / area - d[i + 3]) * a;
        const oa = (wrap(y + r + 1) * res + x) * 4, os = (wrap(y - r) * res + x) * 4;
        s0 += tmp[oa] - tmp[os]; s1 += tmp[oa + 1] - tmp[os + 1]; s2 += tmp[oa + 2] - tmp[os + 2]; s3 += tmp[oa + 3] - tmp[os + 3];
      }
    }
  }

const before=blurWrap;
let candidate=fs.readFileSync(root+'/js/pattern-lowpass.js','utf8');
if(process.argv.includes('--break'))candidate=candidate.replace('_leave[i] = wrap(i - r) * 4;','_leave[i] = wrap(i - r + 1) * 4;');
const after=load(candidate);
const seed=(res,n)=>{const d=new Uint8ClampedArray(res*res*4);let s=n;for(let i=0;i<d.length;i++){s=(Math.imul(s,1664525)+1013904223)>>>0;d[i]=s>>>24;}return d;};
let tests=0;
for(const res of [1,3,8,17,32,64,256,512,1024,17,64,3])for(const r of [0,1,3,12,res<33?res+2:5])for(const amount of [0,.15,.85,1]){
 const input=seed(res,tests+1),a=input.slice(),b=input.slice();before(a,res,r,amount);after(b,res,r,amount);assert.deepEqual(b,a,`${res}/${r}/${amount}`);tests++;
}
for(const [res,r] of [[2048,12],[3,40000]]){
 const input=seed(res,123),a=input.slice(),b=input.slice();before(a,res,r,.85);after(b,res,r,.85);assert.deepEqual(b,a,`${res}/${r}/large`);tests++;
}
console.log(`PASS: ${tests} exact RGBA cases including scratch growth/shrink and wrapped radii beyond image size`);
if(process.argv.includes('--bench')){
 const source=seed(1024,42),times={before:[],after:[]};
 for(let rep=0;rep<6;rep++)for(const [name,fn] of rep%2?[['after',after],['before',before]]:[['before',before],['after',after]]){const d=source.slice(),t=performance.now();fn(d,1024,12,.85);times[name].push(performance.now()-t);}
 console.log(JSON.stringify({times},null,2));
}
