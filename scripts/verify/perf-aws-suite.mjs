/**
 * perf-aws-suite.mjs — runs the scripts/perf measurements ONE AFTER ANOTHER on the AWS GPU runner, which
 * starts every listed check in parallel and would make timing runs disturb each other. Not a check: no
 * verdict, exit code is the last failure. Listed under laptop_only in ci/checks.json.
 *
 * In order (each is its own fresh Chrome; settings are in each tool's header and printed in its output):
 *   1 apartment-buffers (desktop)   2 apartment-buffers --phone   3 mobile-memory (phone profile, 2 reps)
 *   4 frame-profile --phone (2 reps)   5 load-profile 1x,4x x3 reps + warm   6 load-profile --profile 1x,4x x1
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { refuseLive } from '../perf/lib/outcome.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.VERIFY_OUT || '/tmp/perf-aws-suite';
const URLB = process.env.VERIFY_URL || 'http://127.0.0.1:8442';
refuseLive(URLB, process.argv.slice(2));   // six cold loads of the city: exit 2 unless the target is this machine or --allow-live / PERF_ALLOW_LIVE=1 was given
const STEPS = [
  ['buffers', '../perf/apartment-buffers.mjs', ['--url', URLB + '/']],
  ['buffers-phone', '../perf/apartment-buffers.mjs', ['--url', URLB + '/', '--phone']],
  ['phonemem', 'mobile-memory.mjs', ['--arms', 'main=' + URLB, '--query', '?drift=0', '--reps', '2']],
  ['frame-phone', '../perf/frame-profile.mjs', ['--url', URLB + '/', '--phone', '--reps', '2', '--seconds', '10', '--label', 'phone']],
  ['load', '../perf/load-profile.mjs', ['--url', URLB + '/', '--throttle', '1,4', '--reps', '3', '--warm', '--label', 'load']],
  ['load-profile', '../perf/load-profile.mjs', ['--url', URLB + '/', '--throttle', '1,4', '--reps', '1', '--profile', '--label', 'profile']],
];
const passLive = process.argv.includes('--allow-live') ? ['--allow-live'] : [];   // the children refuse a live target too, unless told
let code = 0;
for (const [name, file, args] of STEPS) {
  console.log(`\n===== ${name} =====`);
  const r = spawnSync('node', [path.join(HERE, file), ...args, ...passLive, '--out', path.join(OUT, name)], { stdio: 'inherit', env: process.env, cwd: HERE });
  if (r.status) { console.log(`[${name}] exit ${r.status}`); code = r.status; }
}
process.exit(code);
