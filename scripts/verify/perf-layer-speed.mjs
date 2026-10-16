/**
 * perf-layer-speed.mjs — wrapper so the AWS GPU runner (scripts/aws-gpu, which runs files in this directory) can start
 * scripts/perf/layer-speed.mjs: frame time and page memory with the Blender-building layer off and on (?gltf=1).
 * Not a check: no verdict, listed under tools in ci/checks.json. It runs TWO measurements one after the other (the runner
 * would run two listed checks at once and they would disturb each other's timing):
 *   1 desktop 1280x800 DPR1.5, 4 poses, 3 reps, 60 frames a pass
 *   2 SIMULATED phone: 390x844 DPR3 mobile emulation + CDP CPU throttle 4x, 4 poses, 3 reps, 24 frames a pass
 * Each stops starting new arms at its own deadline (30 and 26 minutes) and reports what it has.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.VERIFY_OUT || '/tmp/perf-layer-speed';
const URLB = process.env.VERIFY_URL || 'http://127.0.0.1:8442';
const POSES = 'spawn,start-close,west-campus,union-close';
const RUNS = [
  ['desktop', ['--reps', '3', '--frames', '60', '--poses', POSES, '--deadline-min', '30']],
  ['phone4x', ['--reps', '3', '--frames', '24', '--poses', POSES, '--phone', '--throttle', '4', '--deadline-min', '26']],
];
let code = 0;
for (const [label, args] of RUNS) {
  console.log(`\n===== ${label} =====`);
  const r = spawnSync('node', [path.join(HERE, '../perf/layer-speed.mjs'), '--url', URLB + '/', '--label', label, '--out', path.join(OUT, label), ...args], { stdio: 'inherit', env: process.env, cwd: HERE });
  if (r.status) { console.log(`[${label}] exit ${r.status}`); code = r.status; }
}
process.exit(code);
