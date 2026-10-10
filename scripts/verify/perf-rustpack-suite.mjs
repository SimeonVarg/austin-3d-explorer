/**
 * perf-rustpack-suite.mjs — the quiet-machine A/B for #440 (?rustbuilder=1), #453 (?packverts=1), their combination and ?buildworker=1, run ONE STEP AFTER
 * ANOTHER on the AWS GPU runner (aws-gpu.yml starts listed checks in parallel; timing runs must not disturb each other). Not a check: no verdict.
 * Listed under laptop_only in ci/checks.json. Modelled on perf-walltiers-suite.mjs.
 *
 *   node perf-rustpack-suite.mjs [--steps desktop,phone,mem] [--reps N] [--arms off,default,on,pack,packrust]   (off+on+pack ... also works: the AWS workflow splits its checks on commas)
 *
 * Steps (each is its own fresh Chrome per load; every setting is printed by the tool it calls):
 *   desktop  rust-builder-timing.mjs at 1440x900, the arms interleaved rep by rep (A B C D, B C D A, ...), --reps (default 5): min / median / max of
 *            slopesApartments.count.ms, the time the veil lifts, peak and settled JS heap, GPU buffer bytes, peak browser memory, the longest main-thread task
 *   phone    the same with --phone (390x844 @3x, the phone profile: chunked build, CPU copies freed after upload)
 *   mem      mobile-memory.mjs (the phone profile as scripts/verify/mobile-memory.mjs measures it: JS heap + backing store + every GL texture, buffer and
 *            renderbuffer, peak during the intro and settled), once per arm, --memreps reps (default 3)
 * Arm names: off = both switches off explicitly; default = no switch (a desktop: both off; a phone profile: packed vertices on); on = ?rustbuilder=1;
 * pack = ?packverts=1; packrust = both (the packed layout written by the Rust builder).
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const STEPS = arg('--steps', 'desktop,phone,mem').split(',');
const REPS = +arg('--reps', 5), MEMREPS = +arg('--memreps', 3);
const ARMS = arg('--arms', 'off,default,on,pack,packrust').replace(/\+/g, ',');   // aws-gpu.yml splits its `checks` input on commas, so arms may be given as off+on+pack
const OUT = process.env.VERIFY_OUT || '/tmp/perf-rustpack-suite';
const URLB = process.env.VERIFY_URL || 'http://127.0.0.1:8442';
const QUERY = { off: 'rustbuilder=0&packverts=0', default: '', on: 'rustbuilder=1', pack: 'packverts=1', packrust: 'rustbuilder=1&packverts=1' };   // off = both switches off explicitly (a phone profile turns packed vertices on by itself); default = no switch
let code = 0;
const run = (name, file, args, env = {}) => {
  console.log(`\n===== ${name} =====`);
  const r = spawnSync('node', [path.join(HERE, file), ...args], { stdio: 'inherit', env: { ...process.env, VERIFY_URL: URLB, ...env }, cwd: HERE });
  if (r.status) { console.log(`[${name}] exit ${r.status}`); code = r.status; }
};
console.log(`perf-rustpack-suite: ${new Date().toISOString()}  url ${URLB}  arms ${ARMS}  reps ${REPS}`);
if (STEPS.includes('desktop')) run('desktop', 'rust-builder-timing.mjs', [String(REPS), ARMS, '--out', path.join(OUT, 'desktop.json')]);
if (STEPS.includes('phone')) run('phone', 'rust-builder-timing.mjs', [String(REPS), ARMS.split(',').join(','), '--phone', '--out', path.join(OUT, 'phone.json')]);
if (STEPS.includes('mem')) for (const arm of ARMS.split(',')) run('mem-' + arm, 'mobile-memory.mjs', ['--arms', arm + '=' + URLB, '--query', '?drift=0' + (QUERY[arm] ? '&' + QUERY[arm] : ''), '--reps', String(MEMREPS), '--out', path.join(OUT, 'mem-' + arm)]);
process.exit(code);
