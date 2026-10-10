// Interleaved Node benchmark: for each round, one fresh process per implementation (cold JIT, as at page load, plus warm repeats).
// Reports min / median / max over the rounds and the machine load before each child, because a shared laptop
// swings these numbers by 2x (this repo's own rule: take the minimum of interleaved reps, never one reading).
//   node bench-node.mjs <streamDir> [rounds=9] [impls=app,typed,wasm,wasm-copy,materialize]  > result.json
import { spawnSync } from 'node:child_process'; import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = process.argv[2], rounds = Number(process.argv[3] || 9), impls = (process.argv[4] || 'app,typed,wasm,wasm-copy,materialize').split(',');
const rows = [];
for (let r = 0; r < rounds; r++) for (const impl of (r % 2 ? [...impls].reverse() : impls)) {
  const load = os.loadavg()[0];
  const p = spawnSync(process.execPath, ['--expose-gc', path.join(here, 'bench-one.mjs'), impl, dir, '2'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (p.status) { console.error(impl, 'failed', p.stderr.slice(0, 300)); continue; }
  const j = JSON.parse(p.stdout.trim().split('\n').pop()); j.round = r; j.load1 = +load.toFixed(1); rows.push(j);
  console.error(`round ${r} ${impl.padEnd(11)} cold wall ${j.cold.toFixed(0).padStart(6)} ms cpu ${j.coldCpu.toFixed(0).padStart(6)}  warm ${j.warms.map(w => w.toFixed(0)).join('/')}  load ${load.toFixed(1)}`);
}
const stat = a => { const s = [...a].sort((x, y) => x - y); return { min: s[0], median: s[s.length >> 1], max: s[s.length - 1], n: s.length }; };
const summary = {};
for (const impl of impls) {
  const m = rows.filter(r => r.impl === impl); if (!m.length) continue;
  summary[impl] = { cold: stat(m.map(r => r.cold)), coldCpu: stat(m.map(r => r.coldCpu)), warm: stat(m.flatMap(r => r.warms)), warmCpu: stat(m.flatMap(r => r.warmCpus)), maxRssMB: stat(m.map(r => r.maxRssMB)), identicalToApp: m.every(r => r.identicalToApp !== false), triangles: m[0].triangles,
    ...(m[0].copyMs != null ? { copyInMs: stat(m.map(r => r.copyMs)), processMs: stat(m.map(r => r.procMs)), instantiateMs: stat(m.map(r => r.instantiateMs)), wasmMiB: m[0].wasmPages * 64 / 1024 } : {}) };
}
console.log(JSON.stringify({ host: `${os.cpus()[0].model} x${os.cpus().length}`, node: process.version, dir, rounds, records: rows[0]?.records, summary, rows }, null, 1));
