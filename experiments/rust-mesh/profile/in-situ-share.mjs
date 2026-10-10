// How much of the real build is the SHARED BUILDER (tri/quad/triN: vertex store, normals, colours, index) as opposed to the
// generator (skins, rows, windows, hashing, point arrays)? The builder's entry points are wrapped with a clock (outermost call
// only) and the same build is timed whole. Load on the machine moves both numbers together, so the SHARE is robust even when
// the milliseconds are not. geometry() (the final trim copy) is timed too.
//   THREE_JS=... node in-situ-share.mjs [reps=5]
import { loadApp } from './app-env.mjs';
globalThis.__BMS = 0;
const { A, specs } = await loadApp({ timeBuilder: true });
const reps = Number(process.argv[2] || 5), rows = [];
for (let r = 0; r < reps; r++) {
  globalThis.__BMS = 0;
  const t0 = performance.now(); const g = await A.build(specs); const total = performance.now() - t0;
  rows.push({ total, builder: globalThis.__BMS }); g.traverse(o => o.geometry?.dispose?.());
  process.stdout.write(`rep ${r}: build ${total.toFixed(0)} ms, inside tri/quad/triN ${globalThis.__BMS.toFixed(0)} ms = ${(100 * globalThis.__BMS / total).toFixed(0)}%  (timer overhead included on both)\n`);
}
const share = rows.map(r => r.builder / r.total).sort((a, b) => a - b);
process.stdout.write(`share of build inside the shared builder: min ${(100 * share[0]).toFixed(0)}%  median ${(100 * share[share.length >> 1]).toFixed(0)}%  max ${(100 * share.at(-1)).toFixed(0)}%\n`);
