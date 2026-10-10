// The second kernel: js/pattern-lowpass.js blurWrap (the wrap-safe box blur on every facade pattern tile; the top function by
// self time in the speed lane's cold-load profile) against blur_wrap in the same .wasm, scalar and simd128 builds.
//   node blur/compare-and-bench.mjs [compare|bench|both]    (WASM / WASM_SIMD override the paths)
// compare: random facade-like RGBA tiles, many (res, radius, amount) triples, every byte must match the JS.
// bench:   interleaved rounds in one warm process, CPU time, per tile; with and without copying the tile in and out of Wasm memory.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const mode = process.argv[2] || 'both';
// the JS is the app's own file, evaluated as the page does
const win = {}; new Function('window', fs.readFileSync(path.join(repo, 'js/pattern-lowpass.js'), 'utf8'))(win);
const jsBlur = win.PatternLowpass.blurWrap;
const load = p => new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync(p)), {}).exports;
const variants = { 'wasm-scalar': load(process.env.WASM || path.join(here, '../dist/meshkernel.wasm')), 'wasm-simd128': load(process.env.WASM_SIMD || path.join(here, '../dist/meshkernel-simd.wasm')) };
let seed = 11; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
// a facade-like tile: glass cells on a panel, noise, an alpha mask
const tile = res => { const d = new Uint8ClampedArray(res * res * 4); for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) { const o = (y * res + x) * 4, win_ = (x % 16 > 3 && x % 16 < 13 && y % 20 > 4 && y % 20 < 16); const base = win_ ? 40 : 190; d[o] = base + rnd() * 30; d[o + 1] = base + rnd() * 30; d[o + 2] = base + 10 + rnd() * 30; d[o + 3] = win_ ? 255 : (rnd() < 0.9 ? 255 : 0); } return d; };
const viaWasm = (x, src, res, r, a, copy = true, fn = 'blur_wrap') => { const p = x.blur_buf(src.length); const mem = new Uint8Array(x.memory.buffer, p, src.length); mem.set(src); x[fn](res, r, a); return copy ? new Uint8ClampedArray(new Uint8Array(x.memory.buffer, p, src.length)) : null; };
if (mode !== 'bench') {
  let cases = 0, bad = 0;
  for (const res of [8, 16, 32, 64, 128, 192, 256, 512]) for (const r of [0, 1, 2, 3, 5, 9]) for (const a of [0, 0.33, 0.85, 1]) {
    const src = tile(res), want = Uint8ClampedArray.from(src); jsBlur(want, res, r, a);
    for (const [name, x] of Object.entries(variants)) { const got = viaWasm(x, src, res, r, a); cases++; if (Buffer.compare(Buffer.from(got.buffer), Buffer.from(want.buffer)) !== 0) { bad++; if (bad < 5) console.log('MISMATCH', name, { res, r, a }); } }
  }
  // extremes: all-zero, all-255, checkerboard (maximum rounding stress for the ties-even clamp)
  for (const fill of [() => 0, () => 255, (i) => (i >> 2) & 1 ? 255 : 0, (i) => (i * 37) & 255]) for (const [r, a] of [[1, 1], [3, 0.5], [2, 0.85]]) { const res = 64, src = new Uint8ClampedArray(res * res * 4).map((_, i) => fill(i)), want = Uint8ClampedArray.from(src); jsBlur(want, res, r, a); for (const [name, x] of Object.entries(variants)) { cases++; if (Buffer.compare(Buffer.from(viaWasm(x, src, res, r, a).buffer), Buffer.from(want.buffer)) !== 0) { bad++; console.log('MISMATCH extreme', name); } } }
  console.log(bad ? `FAIL: ${bad} of ${cases} blur cases differ from js/pattern-lowpass.js` : `PASS: ${cases} blur cases byte-identical to js/pattern-lowpass.js (scalar and simd128 builds)`);
  if (bad) process.exit(1);
}
if (mode === 'approx' || mode === 'both') {
  // how far does the approximate (f32, reciprocal, round-half-up) variant stray from the JS?
  let n = 0, diff = 0, big = 0, maxd = 0;
  for (const [res, r, a] of [[128, 3, 1], [256, 3, 1], [128, 2, 0.85], [128, 1, 0.85]]) { const src = tile(res), want = Uint8ClampedArray.from(src); jsBlur(want, res, r, a); const got = viaWasm(variants['wasm-simd128'], src, res, r, a, true, 'blur_wrap_approx'); for (let i = 0; i < want.length; i++) { n++; const dd = Math.abs(want[i] - got[i]); if (dd) diff++; if (dd > 1) big++; maxd = Math.max(maxd, dd); } }
  console.log(`approx variant vs JS over ${n} bytes: ${diff} differ (${(100 * diff / n).toFixed(3)}%), ${big} by more than 1 level, max difference ${maxd}`);
}
if (mode !== 'compare' && mode !== 'approx') {
  const cpu = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };
  for (const [res, r, a, tiles] of [[128, 3, 1, 400], [256, 3, 1, 100], [512, 2, 0.85, 25]]) {
    const srcs = Array.from({ length: 8 }, () => tile(res)), work = srcs.map(s => Uint8ClampedArray.from(s));
    const runs = { js: [], 'wasm-scalar': [], 'wasm-simd128': [], 'wasm-simd128 (no copy)': [], 'wasm-approx f32 (no copy)': [] };
    const once = {
      js: () => { for (let t = 0; t < tiles; t++) { const w = work[t & 7]; w.set(srcs[t & 7]); jsBlur(w, res, r, a); } },
      'wasm-scalar': () => { for (let t = 0; t < tiles; t++) viaWasm(variants['wasm-scalar'], srcs[t & 7], res, r, a); },
      'wasm-simd128': () => { for (let t = 0; t < tiles; t++) viaWasm(variants['wasm-simd128'], srcs[t & 7], res, r, a); },
      'wasm-approx f32 (no copy)': () => { const x = variants['wasm-simd128']; for (let t = 0; t < tiles; t++) { x.blur_wrap_approx(res, r, a); } },
      'wasm-simd128 (no copy)': () => { const x = variants['wasm-simd128']; for (let t = 0; t < tiles; t++) { x.blur_wrap(res, r, a); } },
    };
    for (const k of Object.keys(once)) { if (k.includes('no copy')) viaWasm(variants['wasm-simd128'], srcs[0], res, r, a, false); for (let w = 0; w < 3; w++) once[k](); }   // warm
    for (let round = 0; round < 9; round++) for (const k of (round % 2 ? Object.keys(once).reverse() : Object.keys(once))) { const c0 = cpu(); once[k](); runs[k].push((cpu() - c0) / tiles); }
    console.log(`\ntile ${res}x${res} RGBA, radius ${r}, amount ${a}, ${tiles} tiles per run, 9 interleaved rounds, CPU time per tile (ms): min / median / max`);
    const base = Math.min(...runs.js);
    for (const [k, v] of Object.entries(runs)) { const s = [...v].sort((a, b) => a - b); console.log(`  ${k.padEnd(24)} ${s[0].toFixed(3)} / ${s[4].toFixed(3)} / ${s.at(-1).toFixed(3)}   ${(base / s[0]).toFixed(2)}x of the JS (min)`); }
  }
}
