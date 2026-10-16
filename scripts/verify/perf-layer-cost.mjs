/**
 * perf-layer-cost.mjs — wrapper so the AWS GPU runner (scripts/aws-gpu, which runs files in this directory) can start
 * scripts/perf/layer-cost.mjs: WHERE the Blender-building layer's (?gltf=1) frame time goes, part by part, in one page load.
 * Not a check: no verdict, listed under tools in ci/checks.json. Two measurements one after the other (two at once would
 * disturb each other's timing):
 *   1 desktop 1280x800 DPR1.5, 4 poses, 4 rounds
 *   2 SIMULATED phone: 390x844 DPR3 mobile emulation + CDP CPU throttle 4x, 4 poses, 2 rounds
 * Extra arguments are passed to both (for example --query gltfcast=0).
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.VERIFY_OUT || '/tmp/perf-layer-cost';
const URLB = process.env.VERIFY_URL || 'http://127.0.0.1:8442';
const EXTRA = process.argv.slice(2);
const RUNS = [
  ['desktop', ['--rounds', '4', '--deadline-min', '24']],
  ['phone4x', ['--rounds', '2', '--frames', '20', '--warm', '8', '--phone', '--throttle', '4', '--deadline-min', '24']],
];
let code = 0;
for (const [label, args] of RUNS) {
  console.log(`\n===== ${label} =====`);
  const r = spawnSync('node', [path.join(HERE, '../perf/layer-cost.mjs'), '--url', URLB + '/', '--label', label, '--out', path.join(OUT, label), ...args, ...EXTRA], { stdio: 'inherit', env: process.env, cwd: HERE });
  if (r.status) { console.log(`[${label}] exit ${r.status}`); code = r.status; }
}
process.exit(code);
