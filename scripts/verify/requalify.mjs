/**
 * requalify.mjs — which pixel scripts can move to the GPU, and which must not?
 *
 * THE PRIZE. Around a hundred scripts here draw the city with SwiftShader, a
 * software renderer, at a measured 3.7 fps where this machine's discrete GPU
 * does 35.3. That 9.4x is why a fourteen-script loop takes half an hour. It is a
 * far bigger lever than running scripts concurrently, which measured only 1.5x
 * (see run.mjs) because software rendering is CPU-bound and concurrent runs just
 * queue for the same cores.
 *
 * WHY THEY ARE ALL ON THE CPU ANYWAY. Software and hardware rasterisers
 * genuinely disagree: measured on this scene, 26-42% of pixels differ, worst
 * channel delta 192 out of 255. A script asserting an exact hex at a named pixel
 * would break the moment the backend changed, and a suite that changes its mind
 * about the same code is worse than a slow one.
 *
 * BUT THAT REASON DOES NOT BIND EVERY SCRIPT. It binds the ones asserting exact
 * colour. Plenty assert a THRESHOLD instead — retint.mjs asks "is night darker
 * than 38 luma", horizon-probe asks "is this line above the buildings". A 40%
 * pixel difference does not move a verdict like that unless it was marginal
 * already.
 *
 * So the question is per-script and empirical, and this answers it empirically:
 * run the thing on both backends and compare what it actually said.
 *
 * WHAT "SAFE" MEANS HERE, AND WHY IT IS STRICTER THAN "IT PASSED".
 * Matching exit codes are necessary and nowhere near sufficient. A threshold
 * assertion that clears its bar by 0.3 on hardware is not qualified, it is
 * lucky — the next scene change tips it and someone spends an evening on a
 * "regression" that is really a backend artefact. So this also diffs every
 * number the script printed and reports the largest relative move. A script is
 * only a candidate if the verdict matches AND the numbers barely moved.
 *
 * IT DOES NOT CONVERT ANYTHING. It prints a recommendation. Bulk-converting on
 * this tool's say-so is the exact failure it exists to prevent — take one script,
 * read what it actually asserts, and put the both-backends comparison in the PR.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT IT FOUND FIRST TIME OUT, WHICH IS NOT WHAT IT WAS BUILT TO FIND:
 *
 *     retint          soft 141 s   hardware 138 s    1.0x
 *     horizon-probe   soft  80 s   hardware  74 s    1.1x
 *
 * THE GPU DOES NOT MAKE THESE SCRIPTS FASTER. The 9.4x is real and it is a
 * rendering number; it does not survive contact with a whole script, because a
 * whole script is barely rendering. It is loading 28 MB, and then sleeping.
 *
 * Counted across the suite: 880 seconds of hardcoded `waitForTimeout` in 87
 * scripts, and that is one pass through each file with loops NOT multiplied. So
 * roughly fifteen minutes of every full run is the harness deliberately doing
 * nothing, plus ~10-17 s per script of loading the same city again.
 *
 * That reorders the whole speed problem:
 *
 *   1. the sleeps            ~880 s, mechanical to fix, needs care per script
 *   2. the payload           ~10-17 s x every script, fixed by vector tiles
 *   3. more machines         real concurrency, unlike sharing one CPU
 *   4. the GPU               1.0x. Bottom of the list, not the top.
 *
 * A WARNING ABOUT THIS TOOL'S OWN NUMBERS, WRITTEN AFTER BEING BITTEN. Load time
 * here varies enormously run to run — 11 s to 65 s for the identical page and
 * flags, on a quiet machine. A single reading of anything in this suite is
 * worthless. I built a whole theory on one (that 33 scripts skipping
 * `cancelGraphicsAutoDetect()` were paying ~50 s each); two clean interleaved
 * reps showed the probe costs nothing at all and the 50 s was a cold first run.
 * CLAUDE.md rule 8 says take the minimum of interleaved reps. It says that
 * because of days like this one.
 *
 * Usage:
 *   node scripts/verify/requalify.mjs retint horizon-probe
 *   node scripts/verify/requalify.mjs --list check
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKIP = new Set(['requalify.mjs', 'run.mjs', 'chrome.mjs', 'reap.mjs', 'gl-check.mjs']);

// A number that moved by more than this fraction is not "the same result on a
// different backend", it is a different result. 2% is generous for a luma mean
// and tight enough to catch a verdict that only just held.
const NUMBER_TOLERANCE = 0.02;

const argv = process.argv.slice(2);
let names = [];
const li = argv.indexOf('--list');
if (li !== -1) {
  const pat = argv[li + 1];
  names = fs.readdirSync(HERE)
    .filter(f => f.endsWith('.mjs') && !SKIP.has(f) && f.includes(pat))
    .map(f => f.replace(/\.mjs$/, ''));
} else {
  names = argv.filter(a => !a.startsWith('--')).map(n => n.replace(/\.mjs$/, ''));
}
names = names.filter(n => fs.existsSync(path.join(HERE, n + '.mjs')));
if (!names.length) { console.log('usage: requalify.mjs <script...> | --list PAT'); process.exit(2); }

function run(name, gl) {
  return new Promise(resolve => {
    const t0 = Date.now();
    const child = spawn(process.execPath, [path.join(HERE, name + '.mjs')], {
      cwd: path.resolve(HERE, '..', '..'),
      env: { ...process.env, VERIFY_GL: gl, VERIFY_MAX_MS: '280000' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (e) {} }, 290000);
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ code, out, secs: (Date.now() - t0) / 1000 });
    });
  });
}

/** Every number the script printed, in order. Shape is the comparison. */
const numbersIn = s => (s.match(/-?\d+\.?\d*/g) || []).map(Number);

console.log('script                    verdict          soft      hw    speedup   worst number move');
console.log('-'.repeat(92));

const rows = [];
for (const name of names) {
  // Interleaved and in this order so a cold OS file cache penalises SOFTWARE,
  // not hardware — that biases against the conclusion this tool wants to reach.
  const soft = await run(name, 'swiftshader');
  const hard = await run(name, 'hardware');

  const sameVerdict = soft.code === hard.code;
  const ns = numbersIn(soft.out), nh = numbersIn(hard.out);
  let worst = 0, comparable = ns.length === nh.length && ns.length > 0;
  if (comparable) {
    for (let i = 0; i < ns.length; i++) {
      const a = ns[i], b = nh[i];
      const denom = Math.max(Math.abs(a), Math.abs(b), 1);
      worst = Math.max(worst, Math.abs(a - b) / denom);
    }
  }

  let verdict, note;
  if (!sameVerdict) {
    verdict = 'KEEP SOFTWARE'; note = `exit ${soft.code} vs ${hard.code}`;
  } else if (soft.code !== 0) {
    verdict = 'BROKEN BOTH';   note = 'fails on both - fix it first';
  } else if (!comparable) {
    verdict = 'READ IT';       note = 'output shape differs - a human must look';
  } else if (worst > NUMBER_TOLERANCE) {
    verdict = 'KEEP SOFTWARE'; note = 'passed, but numbers moved';
  } else {
    verdict = 'CANDIDATE';     note = 'verdict and numbers both hold';
  }

  const speed = hard.secs > 0 ? (soft.secs / hard.secs).toFixed(1) + 'x' : '-';
  console.log(name.padEnd(24) + ' ' + verdict.padEnd(15)
              + soft.secs.toFixed(0).padStart(6) + 's'
              + hard.secs.toFixed(0).padStart(6) + 's'
              + speed.padStart(9)
              + (comparable ? (worst * 100).toFixed(1) + '%' : 'n/a').padStart(9)
              + '   ' + note);
  rows.push({ name, verdict, soft: soft.secs, hard: hard.secs });
}

const cand = rows.filter(r => r.verdict === 'CANDIDATE');
const saved = cand.reduce((s, r) => s + (r.soft - r.hard), 0);
console.log('-'.repeat(92));
console.log(`${cand.length} of ${rows.length} are candidates`
            + (cand.length ? `, worth ${saved.toFixed(0)} s per full run` : ''));
console.log('\nCANDIDATE is a recommendation, not a conversion. Read what the script');
console.log('actually asserts before moving it, and put both columns in the PR.');
