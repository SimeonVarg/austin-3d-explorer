// Interleaved timing of the whole real build (the generator plus the vertex store) in four ways, one FRESH process per run (cold JIT, like a page
// load), the order rotated each round so no variant always runs first. CPU time is process.cpuUsage around A.build, wall is the clock; both
// include the generator (4 to 9 s of it), which is the same JS in every variant. The machine load average is written beside every sample.
//   THREE_JS=... [REAL_NIGHT=1] node profile/packed-bench.mjs <streamDir with expected.json> [rounds=3] [variants=js-packed,rust-packed,rust-packed-reserve,rust-unpacked,js-unpacked]
import { spawnSync } from 'node:child_process'; import path from 'node:path'; import os from 'node:os';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const dir = process.argv[2], rounds = Number(process.argv[3] || 3);
const variants = (process.argv[4] || 'js-packed,rust-packed,rust-packed-reserve,rust-unpacked,js-unpacked').split(',');
if (!dir) throw new Error('usage: packed-bench.mjs <dir with expected.json> [rounds] [variants]');
const wasm = path.join(repo, 'wasm/meshkernel.wasm');
const env = {
  'js-packed': {}, 'js-unpacked': { PACK: '0' },
  'rust-packed': { WASM: wasm }, 'rust-packed-reserve': { WASM: wasm, RESERVE: '6523203' },
  'rust-unpacked': { WASM: wasm, PACK: '0' }, 'rust-unpacked-reserve': { WASM: wasm, PACK: '0', RESERVE: '6523203' },
};
const rows = Object.fromEntries(variants.map(v => [v, []]));
for (let r = 0; r < rounds; r++) {
  const order = variants.map((_, i) => variants[(i + r) % variants.length]);
  for (const v of order) {
    const p = spawnSync(process.execPath, ['--max-old-space-size=6000', path.join(here, 'packed-end-to-end.mjs'), dir], { env: { ...process.env, JSON: '1', ...env[v] }, encoding: 'utf8', maxBuffer: 1 << 26 });
    const line = (p.stdout || '').trim().split('\n').pop();
    let j; try { j = JSON.parse(line); } catch { console.log(`round ${r} ${v}: FAILED to produce a result (exit ${p.status}) ${String(p.stderr).slice(-300)}`); continue; }
    j.loadAfter = os.loadavg()[0]; rows[v].push(j);
    console.log(`round ${r} ${v.padEnd(22)} wall ${String(j.wallMs).padStart(6)} ms  cpu ${String(j.cpuMs).padStart(6)} ms  rss ${String(j.maxRssMB).padStart(5)} MB  identical-to-recorded=${j.ok}  load(1m) ${j.load.toFixed(1)}`);
  }
}
const min = a => Math.min(...a), max = a => Math.max(...a);
console.log('\nvariant                 runs  wall min (spread) ms     cpu min (spread) ms      rss MB   all identical');
for (const v of variants) {
  const R = rows[v]; if (!R.length) continue;
  console.log(`${v.padEnd(22)} ${String(R.length).padStart(4)}  ${String(min(R.map(x => x.wallMs))).padStart(6)} (${min(R.map(x => x.wallMs))}-${max(R.map(x => x.wallMs))})`.padEnd(58) + `${String(min(R.map(x => x.cpuMs))).padStart(6)} (${min(R.map(x => x.cpuMs))}-${max(R.map(x => x.cpuMs))})`.padEnd(26) + `${min(R.map(x => x.maxRssMB))}`.padEnd(9) + R.every(x => x.ok));
}
console.log('machine: ' + os.cpus().length + ' cores, load average now ' + os.loadavg().map(x => x.toFixed(1)).join(' '));
