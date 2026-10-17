/**
 * perf-layer-cost.mjs — wrapper so the AWS GPU runner (scripts/aws-gpu, which runs files in this directory) can start
 * scripts/perf/layer-cost.mjs: WHERE the Blender-building layer's (?gltf=1) frame time goes, part by part, in one page load.
 * Not a check: no verdict, listed under tools in ci/checks.json. Two measurements one after the other (two at once would
 * disturb each other's timing):
 *   1 desktop 1280x800 DPR1.5, 4 poses, 4 rounds
 *   2 SIMULATED phone: 390x844 DPR3 mobile emulation + CDP CPU throttle 4x, 4 poses, 3 rounds
 * Extra arguments are passed to both (for example --query gltfcast=0).
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.VERIFY_OUT || '/tmp/perf-layer-cost';
const URLB = process.env.VERIFY_URL || 'http://127.0.0.1:8442';
// --shots POSE first takes the before/after pictures of one pose at 1440x900 DPR 2 (a dense laptop screen); the rest is passed to both timings
const argv = process.argv.slice(2), si = argv.indexOf('--shots');
const SHOTS = si >= 0 ? argv.splice(si, 2)[1] : null;
// --motion POSE[,POSE..] (2026-10-16): the camera flying forward in real time at 1440x900 DPR 2, a screencast of each --motion-ab variant
const mi = argv.indexOf('--motion'), MOTION = mi >= 0 ? argv.splice(mi, 2)[1] : null;
// --phone-variants LIST: the simulated phone measures only these (it is about four times slower a variant); default: the same as the desktop
const pv = argv.indexOf('--phone-variants'), PHONE_VARIANTS = pv >= 0 ? argv.splice(pv, 2)[1] : null;
// --only desktop|phone4x (2026-10-17): just that timing (the AWS machine's idle watchdog stops ONE check after 20 minutes, so the two go
// in two checks of one run)
const oi = argv.indexOf('--only'), ONLY = oi >= 0 ? argv.splice(oi, 2)[1] : null;
const EXTRA = argv;
const RUNS = [
  ...(SHOTS ? [['shots', ['--shots', SHOTS, '--width', '1440', '--height', '900', '--dpr', '2']]] : []),
  ...(MOTION ? [['motion', ['--motion', MOTION, '--width', '1440', '--height', '900', '--dpr', '2']]] : []),
  ['desktop', ['--rounds', '4', '--deadline-min', '24']],
  ['phone4x', ['--rounds', '3', '--frames', '20', '--warm', '8', '--phone', '--throttle', '4', '--deadline-min', '24']],
];
if (PHONE_VARIANTS) RUNS[RUNS.length - 1][1].push('--variants', PHONE_VARIANTS);
let code = 0;
for (const [label, args] of RUNS.filter(r => !ONLY || r[0] === ONLY || r[0] === 'shots' || r[0] === 'motion')) {
  console.log(`\n===== ${label} =====`);
  const r = spawnSync('node', [path.join(HERE, '../perf/layer-cost.mjs'), '--url', URLB + '/', '--label', label, '--out', path.join(OUT, label), ...args, ...EXTRA], { stdio: 'inherit', env: process.env, cwd: HERE });
  if (r.status) { console.log(`[${label}] exit ${r.status}`); code = r.status; }
}
process.exit(code);
