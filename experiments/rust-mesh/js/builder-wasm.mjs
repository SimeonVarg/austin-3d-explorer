// Drives rust/target/.../meshkernel.wasm (flat C ABI, no wasm-bindgen): palette in, stream in batches, views out.
import { REC, hexBytes } from './common.mjs';

export function instantiate(mod) { return new WebAssembly.Instance(mod, {}).exports; }
/**
 * batchRecords: how many records go over per process() call (the generator would stage ~16k-64k and flush).
 * copyIn: true = the stream sits in a JS Float64Array and is copied into wasm memory (the benchmark's situation);
 * the real generator would write straight into the staging view, so the report prints the copy separately.
 */
export function runWasm(x, palette, stream, records, { batchRecords = 32768, reserve = 0, timing = null } = {}) {
  x.init(reserve);
  for (const p of palette) {
    const d = hexBytes(p.hex[0]), g = hexBytes(p.hex[1]), n = hexBytes(p.hex[2]), s = p.surface || [0, 0, 0, 0];
    x.palette_add(d[0], d[1], d[2], g[0], g[1], g[2], n[0], n[1], n[2], s[0], s[1], s[2], s[3]);
  }
  let copyMs = 0, procMs = 0;
  for (let r = 0; r < records; r += batchRecords) {
    const n = Math.min(batchRecords, records - r);
    const t0 = performance.now();
    const ptr = x.stage(n);
    new Float64Array(x.memory.buffer, ptr, n * REC).set(stream.subarray(r * REC, (r + n) * REC));   // views are re-taken after stage(): it may grow memory
    const t1 = performance.now();
    x.process(n);
    const t2 = performance.now();
    copyMs += t1 - t0; procMs += t2 - t1;
  }
  x.release_stage();
  if (timing) { timing.copyMs = copyMs; timing.procMs = procMs; }
  return viewsOf(x);
}
/** zero-copy typed-array views of the finished buffers (valid until the next call that grows memory) */
export function viewsOf(x) {
  const v = x.vertex_count(), i = x.index_count(), m = x.memory.buffer;
  return { position: new Float32Array(m, x.position_ptr(), v * 3), normal: new Float32Array(m, x.normal_ptr(), v * 3),
    cDay: new Uint8Array(m, x.day_ptr(), v * 3), cGold: new Uint8Array(m, x.golden_ptr(), v * 3), cNight: new Uint8Array(m, x.night_ptr(), v * 3),
    aFacet: new Uint8Array(m, x.facet_ptr(), v), aSurface: new Float32Array(m, x.surface_ptr(), v * 4), index: new Uint32Array(m, x.index_ptr(), i), triangles: x.triangle_count() };
}
