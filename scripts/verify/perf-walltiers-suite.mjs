/**
 * perf-walltiers-suite.mjs — the A/B for js/facades.js WALL TIERS (`?walltiers=0` is the old eager painting, the
 * default is the new lazy painting), run ONE STEP AFTER ANOTHER on the AWS GPU runner (which starts listed checks in
 * parallel, and timing runs must not disturb each other). Not a check: no verdict, exit code is the last failure.
 * Listed under laptop_only in ci/checks.json.
 *
 *   node perf-walltiers-suite.mjs [--steps load,pics,mem,picsnow] [--reps N]
 *
 * Steps (each its own fresh Chrome per load; settings are in each tool's header and are printed in its output):
 *   load  scripts/perf/load-profile.mjs, throttle 1,4 crossed with {?walltiers=0, default}, --reps (default 5),
 *         interleaved; reports min / median / max per arm of time to city ready, initFacades, worker busy ms, ...
 *   mem   scripts/verify/mobile-memory.mjs (phone profile), 2 reps per arm, the two arms one after the other
 *   pics  the ten cameras of ci/poses.json shot with the old and the new painting on the SAME server, twice for
 *         the old one (its own noise), with walls painted in paced jobs (the real page) and again with
 *         facadepace=0&timeofdaypace=0 (walls at once), then ci/pictures.mjs --compare on each
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const STEPS = arg('--steps', 'load,pics,mem,picsnow').split(',');
const REPS = +arg('--reps', 5);
const OUT = process.env.VERIFY_OUT || '/tmp/perf-walltiers-suite';
const URLB = process.env.VERIFY_URL || 'http://127.0.0.1:8442';
let code = 0;
const run = (name, file, args, opts = {}) => {
  console.log(`\n===== ${name} =====`);
  const r = spawnSync('node', [path.join(HERE, file), ...args], { stdio: 'inherit', env: { ...process.env, ...(opts.env || {}) }, cwd: opts.cwd || HERE });
  if (r.status) { console.log(`[${name}] exit ${r.status}`); code = r.status; }
};

if (STEPS.includes('load')) {
  run('load', '../perf/load-profile.mjs', ['--url', URLB + '/', '--throttle', '1,4', '--qarms', 'walltiers=0;', '--reps', String(REPS), '--label', 'walltiers', '--out', path.join(OUT, 'load')]);
}
// pics = walls painted in paced jobs (the real page); picsnow = walls painted at once (facadepace=0&timeofdaypace=0,
// the setting ci/pictures.mjs uses), old painting shot once only.
const pictures = (mode, base, sides) => {
  const poses = path.join(HERE, 'ci/poses.json');
  const dir = path.join(OUT, 'pics-' + mode);
  for (const [side, extra] of sides) {
    fs.mkdirSync(path.join(dir, side), { recursive: true });
    run(`pics ${mode} ${side}`, 'shot.mjs', [side, poses], { cwd: path.join(dir, side), env: { SHOT_Q: base + extra } });
  }
  run(`pics ${mode} compare`, 'ci/pictures.mjs', ['--compare', '--out', dir, '--label', 'walltiers=0', ...(sides.length < 3 ? ['--no-again'] : [])]);
};
if (STEPS.includes('pics')) pictures('paced', 'namelabels=0', [['before', '&walltiers=0'], ['after', ''], ['again', '&walltiers=0']]);
if (STEPS.includes('mem')) {
  [['eager', '?drift=0&walltiers=0'], ['lazy', '?drift=0'], ['eager', '?drift=0&walltiers=0'], ['lazy', '?drift=0']].forEach(([name, q], i) => {
    run('mem-' + name, 'mobile-memory.mjs', ['--arms', name + '=' + URLB, '--query', q, '--reps', '1', '--out', path.join(OUT, 'mem-' + name + '-' + i)]);
  });
}
if (STEPS.includes('picsnow')) pictures('atonce', 'namelabels=0&facadepace=0&timeofdaypace=0', [['before', '&walltiers=0'], ['after', '']]);
process.exit(code);
