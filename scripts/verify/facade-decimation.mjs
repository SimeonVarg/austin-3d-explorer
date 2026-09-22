// CPU-only byte contract for the actual facade tier decimator. This is not a
// city performance or motion acceptance test. --break corrupts the alpha sample.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../../js/facades.js', import.meta.url), 'utf8');
const begin = source.indexOf('  function decimate(');
const end = source.indexOf('  /** The image for one tier:', begin);
assert(begin >= 0 && end > begin, 'actual decimator boundary must exist');
let code = source.slice(begin, end);
if (process.argv.includes('--break')) {
  const sample = 'src[i + stride + 7]';
  assert(code.includes(sample), 'control must target the actual fast path');
  code = code.replace(sample, 'src[i + stride + 6]');
}
const decimate = vm.runInNewContext('(' + code + ')', { Uint8ClampedArray });

// Independent mathematical oracle: accumulate each channel of each source
// block, then use the same byte format's specified ties-to-even conversion.
function reference(src, res, div) {
  const side = res / div;
  const sums = new Float64Array(side * side * 4);
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const target = (Math.floor(y / div) * side + Math.floor(x / div)) * 4;
      const input = (y * res + x) * 4;
      for (let c = 0; c < 4; c++) sums[target + c] += src[input + c];
    }
  }
  return Uint8ClampedArray.from(sums, sum => sum / (div * div));
}

let cases = 0;
function check(src, res, div, label) {
  const unchanged = src.slice();
  const actual = decimate(src, res, div);
  assert.deepEqual(actual, reference(src, res, div), label);
  assert.deepEqual(src, unchanged, label + ': source must not be mutated');
  assert.notEqual(actual.buffer, src.buffer, label + ': result must own its storage');
  cases++;
  return actual;
}

for (const res of [2, 4, 8, 64, 128, 256, 512, 1024, 2048]) {
  const src = new Uint8ClampedArray(res * res * 4);
  let seed = 123;
  for (let i = 0; i < src.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    src[i] = seed >>> 24;
  }
  check(src, res, 2, 'random RGBA ' + res);
  if (res <= 128) {
    check(src, res, 1, 'generic identity ' + res);
    if (res >= 4) check(src, res, 4, 'generic 4x ' + res);
    for (const value of [0, 191, 255]) {
      src.fill(value);
      check(src, res, 2, 'constant ' + value + ' at ' + res);
    }
  }
}

// Every possible average in quarters, especially .5 ties, across distinct
// channel values: no floor/round substitution may alter the byte contract.
for (let sum = 0; sum <= 1020; sum++) {
  const src = new Uint8ClampedArray(16);
  for (let c = 0; c < 4; c++) {
    let left = (sum + c * 193) % 1021;
    for (let pixel = 0; pixel < 4; pixel++) {
      src[pixel * 4 + c] = Math.min(255, left);
      left -= src[pixel * 4 + c];
    }
  }
  check(src, 2, 2, 'quarter average ' + sum);
}
console.log(`PASS facade decimation: ${cases} exact RGBA cases, rounding, source ownership and fallback`);
