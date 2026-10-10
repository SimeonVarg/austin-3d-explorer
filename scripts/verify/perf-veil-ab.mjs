/**
 * perf-veil-ab.mjs — the veil gate A/B on the AWS GPU runner (2026-10-10). Not a check on the page: it measures.
 * (The runner starts several checks in parallel and splits `--check` strings at commas, so the arguments live
 * here, in one wrapper that runs its steps ONE AFTER ANOTHER so they never disturb each other's timing.)
 *
 *   1  load-profile, arms old (`veilgate=full`: the gate as it was) and new (the default), CPU throttle 1x and 4x,
 *      `--reps N` each, interleaved and counterbalanced, one fresh Chrome with an empty cache per load.
 *      Prints min / median / max and every load's value, and what the veil waited for (window.__intro.gates).
 *   2  veil-first-frame.mjs: the first frame after the veil lifts against the settled frame, both gates.
 *
 *   node scripts/verify/perf-veil-ab.mjs [--reps 5] [--skip-pictures] [--skip-load] [--extra "<query>"]
 * VERIFY_URL / VERIFY_OUT are set by the runner. `--extra` appends to both arms (for example `intro=0`).
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const OUT = process.env.VERIFY_OUT || '/tmp/perf-veil-ab';
const URLB = process.env.VERIFY_URL || 'http://127.0.0.1:8480';
const REPS = arg('--reps', '5');
const EXTRA = arg('--extra', '');
let code = 0;
if (!argv.includes('--skip-load')) {
  const q = 'drift=0' + (EXTRA ? '&' + EXTRA : '');
  const r = spawnSync('node', [path.join(HERE, '../perf/load-profile.mjs'), '--url', URLB + '/', '--throttle', '1,4', '--reps', REPS,
    '--arms', `old=${q}&veilgate=full|new=${q}`, '--label', 'veil-ab', '--out', path.join(OUT, 'load')], { stdio: 'inherit', env: process.env });
  if (r.status) { console.log(`[load] exit ${r.status}`); code = r.status; }
}
if (!argv.includes('--skip-pictures')) {
  const r = spawnSync('node', [path.join(HERE, 'veil-first-frame.mjs'), '--out', path.join(OUT, 'pictures'), '--reps', '2'], { stdio: 'inherit', env: process.env });
  if (r.status) { console.log(`[pictures] exit ${r.status}`); code = r.status; }
}
process.exit(code);
