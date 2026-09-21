import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../../js/facades.js',import.meta.url),'utf8');
const body=source.match(/function hash01\(a, b, c\) \{[\s\S]*?\n  \}/)?.[0];
assert.ok(body,'facade random function must be available');
function audit(code){
 const hash=vm.runInNewContext('('+code+')');
 const bins=Array(10).fill(0);let n=0,sum=0;
 for(let seed=1;seed<=128;seed++)for(let row=0;row<32;row++)for(let room=0;room<16;room++){
  const r=hash(seed,row,room);
  assert.ok(r>=0&&r<=1,'room rolls must remain probabilities');
  assert.equal(r,hash(seed,row,room),'room occupancy must be stable across repaints');
  bins[Math.min(9,Math.floor(r*10))]++;sum+=r;n++;
 }
 assert.ok(Math.abs(sum/n-.5)<.02,'room rolls must not favor either half of the palette');
 for(const count of bins)assert.ok(count/n>.08&&count/n<.12,'every tenth of the occupancy/tone range must be reachable');
 return {samples:n,mean:sum/n,bins};
}
console.log(JSON.stringify(audit(body)));
assert.throws(()=>audit(body.replace('x >>> 16','x >> 16')),/favor|reachable/,'the previous signed-shift defect must fail');
console.log('PASS: full probability range, stable rooms, and signed-shift negative control');
