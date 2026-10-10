// One process, one implementation: a COLD build (the situation at page load: nothing is JIT-warmed), then warm repeats.
// Prints one JSON line. Orchestrated by bench-node.mjs, which interleaves implementations across processes.
//   node --expose-gc bench-one.mjs <impl> <streamDir> [warmReps]
// impl: app | typed | typed-exact | wasm | wasm-exact | wasm-copy | materialize
import crypto from 'node:crypto'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { loadStream, hexBytes } from './js/stream.mjs';
import { makeBuild, toneObjects, runApp, materializeOnly } from './js/builder-app.mjs';
import { runTyped } from './js/builder-typed.mjs';
import fs from 'node:fs';
import { runWasm } from './js/builder-wasm.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const [impl, dir, warm = '2'] = process.argv.slice(2);
const wasmPath = process.env.WASM || path.join(here, 'dist/meshkernel.wasm');
const { stream, records, palette, expected } = loadStream(dir);
const tonesBytes = { bytes: new Uint8Array(palette.length * 9), surf: new Float32Array(palette.length * 4) };
palette.forEach((p, i) => { tonesBytes.bytes.set([...hexBytes(p.hex[0]), ...hexBytes(p.hex[1]), ...hexBytes(p.hex[2])], i * 9); if (p.surface) tonesBytes.surf.set(p.surface, i * 4); });
const mod = impl.startsWith('wasm') ? new WebAssembly.Module(fs.readFileSync(wasmPath)) : null;   // compile outside the timed region; instantiate time is measured separately
const build = impl === 'app' ? makeBuild(fs.readFileSync(path.join(here, '../../js/slopes.js'), 'utf8')) : null, tones = impl === 'app' ? toneObjects(palette) : null;
let last, timing = {};
const once = () => {
  const t0 = performance.now();
  if (impl === 'app') last = runApp(build, tones, stream, records, 1 << 16);
  else if (impl === 'typed') last = runTyped(tonesBytes, stream, records);
  else if (impl === 'typed-exact') last = runTyped(tonesBytes, stream, records, Math.ceil((expected.meshes[0]?.vertices || 1 << 16) * 1.0) + 8, false);   // capacity known in advance, views not copies
  else if (impl === 'materialize') materializeOnly(stream, records);
  else if (impl.startsWith('wasm')) {
    const t = performance.now(); const x = new WebAssembly.Instance(mod, {}).exports; timing.instantiateMs = performance.now() - t;
    last = runWasm(x, palette, stream, records, { reserve: impl === 'wasm-exact' ? (expected.meshes[0]?.vertices || 0) : 0, timing });   // wasm-exact: capacity known in advance
    if (impl === 'wasm-copy') { const o = {}; for (const k in last) o[k] = last[k].slice ? last[k].slice() : last[k]; last = o; }
    timing.wasmPages = x.memory.buffer.byteLength / 65536;
  }
  return performance.now() - t0;
};
// CPU time (user+system of THIS process) next to wall time: on a shared laptop wall time moves with everyone else's load,
// CPU time mostly does not. The study quotes CPU time and keeps wall time as the secondary column.
const cpuNow = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };
const timed = () => { const c0 = cpuNow(); const w = once(); return [w, cpuNow() - c0]; };
const [cold, coldCpu] = timed();
const rssAfterCold = process.resourceUsage().maxRSS / 1024;   // MB (macOS reports bytes/1024 via libuv: normalised below)
const warms = [], warmCpus = []; for (let i = 0; i < Number(warm); i++) { if (global.gc) global.gc(); const [w, c] = timed(); warms.push(w); warmCpus.push(c); }
let ok = null;
if (last && expected.meshes.length === 1) { const sha = a => crypto.createHash('sha256').update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest('hex'); const e = expected.meshes[0].sha; ok = Object.keys(e).every(k => sha(last[k === 'index' ? 'index' : k]) === e[k]); }
console.log(JSON.stringify({ impl, records, cold, coldCpu, warms, warmCpus, maxRssMB: process.resourceUsage().maxRSS / 1024, identicalToApp: ok, triangles: last?.triangles, ...timing }));
