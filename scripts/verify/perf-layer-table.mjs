/**
 * perf-layer-table.mjs — wrapper so the AWS GPU runner can start scripts/perf/layer-speed.mjs with THREE arms (2026-10-17,
 * mac/layer-table-505; a measurement tool, no verdict, not a check):
 *   off   the plain URL (layer off)
 *   on    ?gltf=1 as main ships it (far copy from about 800 m, atlas targets 128 MB)
 *   both  ?gltf=1&gltffardist=400&gltfatlasmb=96 (draft #505's far distance and #504's 96 MB targets)
 * Two measurements one after the other (two at once would disturb each other's timing):
 *   1 desktop 1280x800 DPR1.5, 4 poses, 3 reps, 60 frames a pass
 *   2 SIMULATED phone: 390x844 DPR3 mobile emulation + CDP CPU throttle 4x, 4 poses, 3 reps, 24 frames a pass
 * The arms' order is rotated each rep so every arm takes every place. Extra arguments are passed to both.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.VERIFY_OUT || '/tmp/perf-layer-table';
const URLB = process.env.VERIFY_URL || 'http://127.0.0.1:8442';
const POSES = 'spawn,start-close,west-campus,union-close';
const ARMS = 'off,on,both';
const RUNS = [
  ['desktop', ['--reps', '3', '--frames', '60', '--poses', POSES, '--arms', ARMS, '--deadline-min', '26']],
  ['phone4x', ['--reps', '3', '--frames', '24', '--poses', POSES, '--arms', ARMS, '--phone', '--throttle', '4', '--deadline-min', '26']],
];
// --only desktop|phone4x: run just that measurement. The AWS machine's idle watchdog stops it when ONE check runs longer than 20 minutes
// (it is fed when a check starts), so the two measurements together (about 35 minutes) go in two runs.
const oi = process.argv.indexOf('--only'), ONLY = oi >= 0 ? process.argv.splice(oi, 2)[1] : null;
let code = 0;
for (const [label, args] of RUNS.filter(r => !ONLY || r[0] === ONLY)) {
  console.log(`\n===== ${label} =====`);
  const r = spawnSync('node', [path.join(HERE, '../perf/layer-speed.mjs'), '--url', URLB + '/', '--label', label, '--out', path.join(OUT, label), ...args, ...process.argv.slice(2)], { stdio: 'inherit', env: process.env, cwd: HERE });
  if (r.status) { console.log(`[${label}] exit ${r.status}`); code = r.status; }
}
process.exit(code);
