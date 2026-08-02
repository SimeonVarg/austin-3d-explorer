/**
 * run.mjs — run many verify scripts at once, safely.
 *
 * THE PROBLEM THIS SOLVES. Simeon, watching a 14-script loop crawl: "theres
 * gotta be a faster way to do these bash runs i swear they take so long like 7
 * minutes AT LEAST." He is right, and the reason is not that any one script is
 * slow. Measured on the Acer, 2026-08-01:
 *
 *     launch Chrome                       3-5 s
 *     load the page and tile 28 MB        ~16 s
 *     hardcoded waitForTimeout "settle"   4-10 s
 *     ------------------------------------------
 *     dead time before measuring anything ~25 s
 *
 * A serial loop over 14 scripts pays that twenty-five seconds fourteen times.
 * Six minutes of the run is startup. Running them concurrently is the single
 * biggest win available and needs no change to the 187 scripts themselves.
 *
 * WHY NOBODY DID IT SOONER, AND THE RULE THAT MUST NOT BE BROKEN. Unbounded
 * concurrency here is exactly what took the laptop down: 38 orphaned swiftshader
 * Chromes at 100% CPU and memory, in the middle of a deadline. So this runner is
 * bounded by construction and refuses to be talked out of it:
 *
 *   - a hard concurrency cap, defaulting to a quarter of the cores and never
 *     more than MAX_JOBS, whatever anyone passes;
 *   - a per-script timeout that KILLS the child, so one wedged run cannot hold
 *     a slot forever;
 *   - reap.mjs on the way out, always, including on Ctrl-C and on a throw,
 *     because the whole point of failure is that it is unplanned.
 *
 * Each script still gets its own browser. Sharing one across scripts would be
 * faster again, but they mutate map state, install init scripts and throttle the
 * CPU, so a shared page would make every result depend on what ran before it.
 * That is a worse failure than a slow suite: it is a suite that lies.
 *
 * MEMORY IS THE REAL CAP, NOT CORES. A swiftshader Chrome on this scene runs
 * 400-700 MB. The default pool is deliberately far below what the core count
 * would allow, because the machine Simeon is sitting at has to stay usable.
 *
 * Usage:
 *   node scripts/verify/run.mjs movement collision sky
 *   node scripts/verify/run.mjs --jobs 4 --list perf
 *   node scripts/verify/run.mjs --all
 *
 *   --jobs N     concurrency (default: min(4, cores/4), hard max 8)
 *   --timeout S  per script, seconds (default 300)
 *   --list PAT   run every *PAT*.mjs
 *   --all        run every script (excludes this one, chrome.mjs, reap.mjs)
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Not negotiable. See the header — this exists because of a real incident.
const MAX_JOBS = 8;
const NEVER_RUN = new Set(['run.mjs', 'chrome.mjs', 'reap.mjs', 'gl-check.mjs']);

/**
 * NEVER RUN THESE CONCURRENTLY — they will report FALSE FAILURES.
 *
 * Caught the first time this runner was tested. `retint.mjs` asserts that the
 * scene finishes retinting "within 2500 ms of moving the slider". Alone it
 * passes 5/5. Three-at-a-time it FAILS — not because anything is broken, but
 * because two other SwiftShader browsers were eating the CPU it needed to hit
 * its own deadline. A suite that fails when it is busy is worse than a slow
 * suite: it trains you to re-run until green.
 *
 * This is NOT just the *-perf scripts. Any assertion with a millisecond budget
 * in it is measuring the machine as much as the code, and the machine is now
 * shared. The list below is the `-perf` family plus every script whose pass/fail
 * depends on elapsed time, found by grepping for a clock read next to a
 * threshold. It over-matches on purpose: serialising a script that did not need
 * it costs seconds, and parallelising one that did costs a wrong answer.
 *
 * These are not skipped. They run AFTER the parallel batch, one at a time, so
 * the rest of the suite still gets the concurrency win.
 */
const SERIAL_ONLY = new Set([
  // asserts a millisecond deadline; measured to fail under contention
  'retint',
  // the -perf family: frame time is the result
  'arts-perf', 'drag-perf', 'facade-perf', 'ground-perf', 'ground-tex-perf',
  'light-perf', 'lod-perf', 'moody-perf', 'night-perf', 'outer-perf',
  'perf', 'perf2', 'perf3', 'places-perf', 'post-perf', 'roads-perf',
  'roof-perf', 'roofscape-perf', 'stadium-perf', 'tower-perf', 'westcampus-perf',
  // clock read next to a threshold
  'light-probe', 'loader-check', 'lod-capability', 'lod-within', 'moody-check',
  'moody-roofprobe', 'moody-shot', 'motion-feel',
]);

// One pass, so a flag's VALUE can never be mistaken for a script name — the
// obvious `argv.filter(a => !a.startsWith('--'))` would happily try to run a
// script called "4".
const argv = process.argv.slice(2);
const opt = { jobs: 0, timeout: 300, list: null, all: false };
const bare = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--all') opt.all = true;
  else if (a === '--jobs') opt.jobs = Number(argv[++i]);
  else if (a === '--timeout') opt.timeout = Number(argv[++i]);
  else if (a === '--list') opt.list = argv[++i];
  else if (a.startsWith('--')) { console.log('unknown flag ' + a); process.exit(2); }
  else bare.push(a);
}

const jobs = Math.max(1, Math.min(MAX_JOBS,
  opt.jobs || Math.max(1, Math.floor(os.cpus().length / 4))));
const timeoutMs = opt.timeout * 1000;

const every = () => fs.readdirSync(HERE)
  .filter(f => f.endsWith('.mjs') && !NEVER_RUN.has(f))
  .map(f => f.replace(/\.mjs$/, ''));

let names = bare;
if (opt.all) names = every();
if (opt.list) names = every().filter(n => n.includes(opt.list));

const missing = [];
names = [...new Set(names.map(n => n.replace(/\.mjs$/, '')))]
  .filter(n => {
    const ok = fs.existsSync(path.join(HERE, n + '.mjs'));
    if (!ok) missing.push(n);
    return ok;
  });
// Say what was dropped. A runner that silently skips a name you asked for reads
// as "everything passed".
if (missing.length) console.log('no such script, skipped: ' + missing.join(', '));

if (!names.length) {
  console.log('nothing to run.  node run.mjs <script...> | --list PAT | --all');
  process.exit(2);
}

const free = os.freemem() / 1073741824;
console.log(`${names.length} scripts, ${jobs} at a time`
            + `  (${os.cpus().length} cores, ${free.toFixed(1)} GB free)`);
if (free < 3) {
  console.log('  WARNING: under 3 GB free. Each browser wants 400-700 MB.');
}
console.log('');

const live = new Set();
const results = [];
let killedAll = false;

function cleanup(why) {
  if (killedAll) return;
  killedAll = true;
  for (const c of live) { try { c.kill('SIGKILL'); } catch (e) {} }
  if (why) console.error('\n[run.mjs] ' + why + ' — reaping');
  // Synchronous on purpose: an async reap during process exit does not finish.
  try {
    execFileSync(process.execPath, [path.join(HERE, 'reap.mjs')], { stdio: 'inherit' });
  } catch (e) {}
}
process.on('SIGINT', () => { cleanup('SIGINT'); process.exit(130); });
process.on('SIGTERM', () => { cleanup('SIGTERM'); process.exit(143); });

function runOne(name) {
  return new Promise(resolve => {
    const t0 = Date.now();
    const child = spawn(process.execPath, [path.join(HERE, name + '.mjs')], {
      cwd: path.resolve(HERE, '..', '..'),
      env: { ...process.env, VERIFY_MAX_MS: String(timeoutMs - 5000) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    live.add(child);
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });

    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (e) {}
      out += '\n[run.mjs] killed at ' + (timeoutMs / 1000) + ' s\n';
    }, timeoutMs);

    child.on('close', code => {
      clearTimeout(timer);
      live.delete(child);
      const secs = (Date.now() - t0) / 1000;
      results.push({ name, code, secs, out });
      console.log((code === 0 ? '  ok   ' : '  FAIL ') + name.padEnd(24)
                  + secs.toFixed(1).padStart(6) + ' s'
                  + (code === 0 ? '' : '   exit ' + code));
      resolve();
    });
  });
}

const t0 = Date.now();

// Phase 1: everything that does not care how busy the machine is.
const queue = names.filter(n => !SERIAL_ONLY.has(n));
const serialQueue = names.filter(n => SERIAL_ONLY.has(n));

if (queue.length) {
  await Promise.all(Array.from({ length: jobs }, async () => {
    while (queue.length) await runOne(queue.shift());
  }));
}

// Phase 2: one at a time, because their answer depends on the machine being
// free. See SERIAL_ONLY.
if (serialQueue.length) {
  console.log('\n  -- ' + serialQueue.length + ' time-sensitive, running alone --');
  for (const n of serialQueue) await runOne(n);
}
const wall = (Date.now() - t0) / 1000;

const serial = results.reduce((s, r) => s + r.secs, 0);
const failed = results.filter(r => r.code !== 0);

console.log('\n' + '-'.repeat(56));
console.log(`wall clock ${wall.toFixed(1)} s   serial would be ${serial.toFixed(1)} s`
            + `   ${(serial / wall).toFixed(1)}x`);
console.log(`${results.length - failed.length} passed, ${failed.length} failed`);

if (failed.length) {
  console.log('\n=== output from failures only ===');
  for (const r of failed) {
    console.log('\n########## ' + r.name + '  (exit ' + r.code + ')');
    console.log(r.out.trim().split('\n').slice(-25).join('\n'));
  }
}

// Belt and braces. Every script's own chrome.mjs reaps on exit, but a SIGKILLed
// child never runs its handlers, and that is precisely the case that once left
// 38 browsers behind.
cleanup(null);
process.exitCode = failed.length ? 1 : 0;
