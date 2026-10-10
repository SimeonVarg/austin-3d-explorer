// The perf tools' exit codes and the live-site guard, held with no browser (about a second).
//
// WHY. scripts/perf/load-profile.mjs, frame-profile.mjs and apartment-buffers.mjs ended with process.exit(0) however the run went, so
// a page that never became ready, a repetition that threw or a failed page read became a line in a report and exit 0; and any of them
// could be pointed at the production site by one mistyped flag (48 MB a cold load, repeated). This holds, on the tools' own code:
//   1. lib/outcome.mjs: the target guard, the readiness test and the exit-code rules, case by case;
//   2. the three real scripts as child processes: a live --url is refused with exit 2 BEFORE any browser could start, --allow-live
//      lifts the refusal (checked by the message, not by running a browser);
//   3. load-profile.mjs --from <saved reps>: a saved repetition whose page never reached the reveal makes the real script exit 1, a ready
//      one exits 0, a directory with no matching file exits 1 (no browser: --from only rebuilds the report);
//   4. the suite wrapper (verify/perf-aws-suite.mjs) refuses a live VERIFY_URL before running six steps.
// The end-to-end case the reviewer asked for (a local server that answers 500 for the main script, real Chrome) is perf-exit-500.mjs;
// it needs a browser and is listed in ci/checks.json under quarantine until it has been run once.
//
//   node scripts/verify/perf-outcome.mjs            exit 0 = all of the above
//   node scripts/verify/perf-outcome.mjs --break    runs the unit cases against the OLD behaviour (nothing guarded, every run exits 0): must exit 1
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const BREAK = process.argv.includes('--break');
const O = await import(pathToFileURL(path.join(REPO, 'scripts/perf/lib/outcome.mjs')).href);
let failed = 0;
const say = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) failed++; };

// --break: the old behaviour, to prove the cases below can see it
const checkTarget = BREAK ? () => ({ local: true }) : O.checkTarget;
const repsExitCode = BREAK ? () => ({ code: 0, problems: [] }) : O.repsExitCode;
const buffersExitCode = BREAK ? () => ({ code: 0, problems: [] }) : O.buffersExitCode;
const run = (script, args, env = {}) => spawnSync(process.execPath, [path.join(REPO, script), ...args], { encoding: 'utf8', timeout: 60000, env: { ...process.env, PERF_ALLOW_LIVE: '', ...env } });

// 1. unit cases
for (const u of ['http://127.0.0.1:8473/', 'http://localhost:8099/', 'http://[::1]:8000/', 'http://foo.localhost/']) say(!throws(() => checkTarget(u, [], {})), `a local target is allowed: ${u}`);
for (const u of ['https://fly-over-utx.vercel.app/', 'https://simeonvarg.github.io/austin-3d-explorer/', 'http://192.168.1.20:8000/']) say(throws(() => checkTarget(u, [], {})), `a non-local target is refused by default: ${u}`);
say(!throws(() => checkTarget('https://fly-over-utx.vercel.app/', ['--allow-live'], {})), '--allow-live lifts the refusal');
say(!throws(() => checkTarget('https://fly-over-utx.vercel.app/', [], { PERF_ALLOW_LIVE: '1' })), 'PERF_ALLOW_LIVE=1 lifts the refusal');
say(throws(() => checkTarget('not a url', [], {})), 'a malformed --url is an error');
function throws(f) { try { f(); return false; } catch (e) { return true; } }

const ok = { label: 't1-r1', marks: { introReveal: 5000, apartmentsDone: 4000 }, ready: true };
const bad = { label: 't1-r2', marks: { mapCreated: 100 }, ready: false };
say(repsExitCode({ planned: 2, results: [ok, ok] }).code === 0, 'every planned rep ran and was ready: exit 0');
say(repsExitCode({ planned: 2, results: [ok, bad] }).code === 1, 'one rep never became ready: exit 1');
say(repsExitCode({ planned: 2, results: [ok], failures: 1 }).code === 1, 'one rep threw: exit 1');
say(repsExitCode({ planned: 2, results: [ok] }).code === 1, 'fewer reps ran than planned: exit 1');
say(repsExitCode({ planned: 2, results: [], failures: 2 }).code === 1, 'no result at all: exit 1');
say(repsExitCode({ planned: 0, results: [ok], from: true }).code === 0 && repsExitCode({ planned: 0, results: [], from: true }).code === 1, '--from: a report from saved reps needs at least one');
say(buffersExitCode({ meshes: [{}] }).code === 0, 'apartment-buffers: a page read with meshes: exit 0');
say(buffersExitCode({ error: 'x is not defined' }).code === 1 && buffersExitCode(null).code === 1 && buffersExitCode({ meshes: [] }).code === 1, 'apartment-buffers: an error, nothing, or no meshes: exit 1');

// 2. the real scripts refuse a live target before any browser
if (!BREAK) {
  for (const [script, extra] of [['scripts/perf/load-profile.mjs', ['--reps', '1']], ['scripts/perf/frame-profile.mjs', ['--reps', '1']], ['scripts/perf/apartment-buffers.mjs', []]]) {
    const r = run(script, ['--url', 'https://fly-over-utx.vercel.app/', ...extra, '--out', fs.mkdtempSync(path.join(os.tmpdir(), 'po-'))]);
    say(r.status === 2 && /refusing to run against fly-over-utx\.vercel\.app/.test(r.stderr), `${path.basename(script)} --url <live>: refused, exit ${r.status}`);
  }
  const suite = run('scripts/verify/perf-aws-suite.mjs', [], { VERIFY_URL: 'https://fly-over-utx.vercel.app', VERIFY_OUT: fs.mkdtempSync(path.join(os.tmpdir(), 'po-')) });
  say(suite.status === 2 && /refusing to run/.test(suite.stderr), `perf-aws-suite.mjs with a live VERIFY_URL: refused before the first step, exit ${suite.status}`);
}

// 3. load-profile --from: the real script, no browser
if (!BREAK) {
  const full = (label, marks) => ({
    label, rep: 1, throttle: 1, gl: 'hardware', phone: false, query: 'drift=0', settleMs: 6000, chrome: 'Chrome/x', gpuRenderer: 'test', machine: { before: { load1: 1, cpus: 8 }, after: { load1: 1 } },
    marks, long: [], cdpMetrics: { ScriptDuration: 1, TaskDuration: 2 }, heap: { usedSize: 2 ** 28 }, apartments: { ms: 1000 },
    net: { total: { n: 1, enc: 1000, dec: 1000 }, cats: { 'own js': { n: 1, enc: 1000, dec: 1000 } }, est: {} },
    ready: !!(marks.introReveal && marks.apartmentsDone),
  });
  const mk = (files) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'po-from-')); for (const [n, j] of Object.entries(files)) fs.writeFileSync(path.join(d, n), JSON.stringify(j)); return d; };
  const go = (dir) => run('scripts/perf/load-profile.mjs', ['--from', dir, '--out', fs.mkdtempSync(path.join(os.tmpdir(), 'po-out-'))]);
  const good = mk({ 't1-r1.json': full('t1-r1', { mapFirstRender: 900, introReveal: 5000, apartmentsDone: 4000 }) });
  const neverReady = mk({ 't1-r1.json': full('t1-r1', { mapFirstRender: 900, introReveal: 5000, apartmentsDone: 4000 }), 't1-r2.json': full('t1-r2', { mapCreated: 100 }) });
  const empty = mk({});
  const g = go(good), n = go(neverReady), e = go(empty);
  say(g.status === 0, `load-profile --from, every saved rep ready: exit ${g.status}`);
  say(n.status === 1 && /t1-r2/.test(n.stderr) && /never became ready/.test(n.stderr), `load-profile --from, one saved rep never reached the reveal: exit ${n.status}${n.status === 1 ? ' and it names t1-r2' : ''}`);
  say(e.status === 1, `load-profile --from, no matching file: exit ${e.status}`);
}

console.log(failed ? `\nFAIL: ${failed} check(s) failed${BREAK ? ' (--break: this is the expected result)' : ''}` : '\nPASS: the perf tools fail when the run failed, and refuse a live target');
process.exit(failed ? 1 : 0);
