// Times the REAL apartment build (js/slopes-apartments.js build()) over the REAL catalog in Node, no browser.
// Run under `node --cpu-prof` to see where the time goes. See app-env.mjs for how the sources are loaded.
//   THREE_JS=/path/to/three.min.js node node-apartments-build.mjs [reps]     (ONLY="The Standard,Icon" narrows it)
import { loadApp } from './app-env.mjs';
const REPS = Number(process.argv.find((a, i) => i > 1 && /^\d+$/.test(a)) || 1);
const out = (...a) => process.stdout.write(a.join(' ') + '\n');
const NULL = process.argv.includes('--null-builder');   // generator only, builder replaced by no-ops
const WASM = process.argv.includes('--wasm') ? (process.env.WASM || new URL('../dist/meshkernel.wasm', import.meta.url).pathname) : null;   // the Rust builder behind the real generator
const { A, specs } = await loadApp({ nullBuilder: NULL, wasm: WASM });
out('buildings in catalog:', specs.length);
const times = [], cpus = [];
const cpuNow = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };
for (let r = 0; r < REPS; r++) {
  const t0 = performance.now(), c0 = cpuNow();
  const g = await A.build(specs);
  const ms = performance.now() - t0, cpu = cpuNow() - c0; times.push(ms); cpus.push(cpu);
  const c = A.count; let tris = 0, verts = 0, bytes = 0;
  g.traverse(o => { if (o.isMesh) { const gm = o.geometry; tris += gm.index.count / 3; verts += gm.attributes.position.count; for (const k in gm.attributes) bytes += gm.attributes[k].array.byteLength; bytes += gm.index.array.byteLength; } });
  if (process.env.EXPECT && r === 0) { const fs = await import('node:fs'), crypto = await import('node:crypto'); const e = JSON.parse(fs.readFileSync(process.env.EXPECT, 'utf8')).meshes[0].sha; let ok = true; g.traverse(o => { if (!o.isMesh) return; const sha = a => crypto.createHash('sha256').update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest('hex'); for (const k in o.geometry.attributes) if (sha(o.geometry.attributes[k].array) !== e[k]) ok = false; if (sha(o.geometry.index.array) !== e.index) ok = false; }); out('geometry identical to the recorded in-app build (sha256, all 8 arrays):', ok); }
  out(`rep ${r}: ${ms.toFixed(0)} ms wall, ${cpu.toFixed(0)} ms cpu  built=${c.buildings} blocks=${c.blocks} faces=${c.faces} cells=${c.cells}  triangles=${tris} vertices=${verts}  geometry bytes=${(bytes / 1048576).toFixed(0)} MB`);
}
out('min', Math.min(...times).toFixed(0), 'ms   (spread', Math.min(...times).toFixed(0) + '-' + Math.max(...times).toFixed(0) + ')');
