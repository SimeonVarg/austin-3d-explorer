/**
 * perf-net-ab.mjs — the network changes A/B on the AWS GPU runner (2026-10-10). Measures; it is not a check on the page.
 * One step after another so nothing disturbs another's timing (the runner starts listed checks in parallel and
 * splits `--check` strings at commas, hence this wrapper):
 *
 *   1  wayfind-lazy.mjs --browser: a real page load requests js/wayfind.js only when the walking feature is asked for.
 *   2  load-profile, arms old (`wayfind=eager&roofsreuse=0&gatepoll=style`: the three switches that restore the old behaviour:
 *      js/wayfind.js downloaded on every visit, roofs.geojson fetched twice, the full-style poll) and new (default), at
 *      CPU throttle 1x and 4x, interleaved and counterbalanced, a fresh Chrome with an empty cache per load. The report
 *      lists every request, so wire bytes, request count, and whether roofs.geojson / wayfind.js were fetched, are in it.
 *
 *   node scripts/verify/perf-net-ab.mjs [--reps 3] [--skip-load] [--skip-browser]
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const OUT = process.env.VERIFY_OUT || '/tmp/perf-net-ab';
const URLB = process.env.VERIFY_URL || 'http://127.0.0.1:8480';
let code = 0;
if (!argv.includes('--skip-browser')) {
  const r = spawnSync('node', [path.join(HERE, 'wayfind-lazy.mjs'), '--browser'], { stdio: 'inherit', env: process.env });
  if (r.status) { console.log(`[wayfind-lazy] exit ${r.status}`); code = r.status; }
}
if (!argv.includes('--skip-load')) {
  const r = spawnSync('node', [path.join(HERE, '../perf/load-profile.mjs'), '--url', URLB + '/', '--throttle', '1,4', '--reps', arg('--reps', '3'),
    '--arms', 'old=drift=0&wayfind=eager&roofsreuse=0&gatepoll=style|new=drift=0', '--label', 'net-ab', '--out', path.join(OUT, 'load')], { stdio: 'inherit', env: process.env });
  if (r.status) { console.log(`[load] exit ${r.status}`); code = r.status; }
}
process.exit(code);
