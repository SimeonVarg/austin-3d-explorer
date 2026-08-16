/**
 * inventory.mjs — WHAT IS THE HEALTH OF THIS SUITE?
 *
 * WHY THIS EXISTS. On 2026-08-16 nobody could answer "which of these 140
 * scripts still run?" Three separate passes had written "could not measure"
 * against QUEUE Y15, and `dusk.mjs`, `silhouette.mjs` and `banding.mjs` were
 * known to crash — but only because someone had happened to type their names.
 * A suite whose health nobody knows is not a suite; it is a directory.
 *
 * WHAT IT CLASSIFIES, and the distinction that matters most:
 *
 *   CRASHES        the process threw before it could assert anything. A stack
 *                  trace from node itself, or an exit inside the first few
 *                  seconds with no verdict printed. THIS IS THE BUCKET THAT
 *                  MATTERS: a crashing guard protects nothing, and it has been
 *                  protecting nothing silently.
 *   FAILS          it ran, it looked, and it says the thing it guards is wrong.
 *                  A healthy state for the suite even though it is red.
 *   PASSES         it ran, it looked, it is happy.
 *   REACHES-BROWSER  still alive at the phase-A budget. It got a page open, so
 *                  it is not in the crash bucket; whether it passes is unknown
 *                  from this run and is NOT reported as PASSES. Guessing here
 *                  is exactly the sin this file exists to stop.
 *   NEEDS-ARGS     exited fast asking for an argument it was not given.
 *
 * It never runs `reap.mjs` (it would kill the sibling lanes' browsers) and
 * never runs itself.
 *
 * PHASE B, added 2026-08-16 (§152). Phase A's 25 s budget left 107 of 138
 * scripts in REACHES-BROWSER, i.e. unknown, and §149 wrote that down as its
 * first unestablished item. Phase B is the same instrument with a budget large
 * enough that finishing is the normal outcome and being killed is the finding:
 *
 *   node inventory.mjs --budget 300 --exclude perf
 *
 * WHY `--exclude perf` IS NOT LAZINESS. The ~22 timing scripts launch HEADED
 * (README: swiftshader "is right for pixel assertions and useless for timing"),
 * they run for minutes each, and README states their numbers are trustworthy
 * "only on an otherwise idle desktop". A run taken while another lane holds a
 * browser measures that lane. Excluding them is the instrument's own rule; a
 * verdict on them is a separate pass on a quiet machine, and it must be
 * REPORTED AS EXCLUDED rather than folded into the totals.
 *
 * Usage:
 *   node inventory.mjs                 phase A, 25 s each
 *   node inventory.mjs --budget 90     longer budget
 *   node inventory.mjs --only a.mjs,b.mjs
 *   node inventory.mjs --exclude perf,tour   skip files matching any substring
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argVal = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const BUDGET = Number(argVal('--budget', 25)) * 1000;
const ONLY = argVal('--only', null);
const EXCLUDE = (argVal('--exclude', '') || '').split(',').map(s => s.trim()).filter(Boolean);

// reap.mjs is excluded on purpose: it kills every harness browser on the
// machine by flag match, including a sibling lane's. chrome.mjs is a library.
const SKIP = new Set(['chrome.mjs', 'reap.mjs', 'inventory.mjs', 'run.mjs', 'warmup.mjs']);

const all = fs.readdirSync(HERE).filter(f => f.endsWith('.mjs') && !SKIP.has(f)).sort();

// `--gates` — THE SET THAT ANSWERS "HOW MANY OF MY CHECKS ACTUALLY RUN?"
// (added 2026-08-16, §152).
//
// A phase-B pass over all 138 was projected at twelve hours, and most of that
// was spent on tools rather than checks: `art-sheet.mjs` and `arts-shots.mjs`
// each burned the full 240 s budget photographing poses. Photographing is not
// asserting. So the health question is scoped to the files that can actually
// FAIL: a script is a GATE if it prints a PASS/FAIL verdict AND has some path to
// a non-zero exit. Everything else is a tool, a probe or a shot list — useful,
// but it has no verdict to report and no verdict can be claimed for it.
//
// The classification is mechanical and derived from the source every run, not a
// hand-maintained list. A hand-maintained list of families is precisely what
// went stale and gave this repo one of its four blind guards.
const GATES_ONLY = args.includes('--gates');
const isGate = (f) => {
  const s = fs.readFileSync(path.join(HERE, f), 'utf8');
  const verdict = /\bPASS\b/.test(s) && /FAIL\b/.test(s);
  const canGoRed = /process\.exit\s*\((?!\s*0\s*\))|process\.exitCode\s*=\s*(?!0)/.test(s);
  return verdict && canGoRed;
};

let files = all.filter(f => !EXCLUDE.some(p => f.includes(p)));
let excluded = all.filter(f => EXCLUDE.some(p => f.includes(p)));
if (GATES_ONLY) {
  const gates = files.filter(isGate);
  excluded = excluded.concat(files.filter(f => !isGate(f)));
  files = gates;
}
if (ONLY) { files = ONLY.split(',').map(s => s.trim()); excluded = []; }

// A node-level throw. These strings only appear when the runtime itself gave
// up — a script that PRINTS the word "Error" in a report is not a crash.
const CRASH_RE = /\b(ReferenceError|SyntaxError|ERR_MODULE_NOT_FOUND|ERR_UNSUPPORTED|Cannot find module|is not defined|is not a function|ENOENT: no such file)\b/;
// playwright/browser failures are real crashes too, but a different family.
const BROWSER_ERR_RE = /(browserType\.launch|No Chrome found|Executable doesn't exist|net::ERR_CONNECTION_REFUSED|page\.goto: )/;

const run = (file) => new Promise((resolve) => {
  const t0 = Date.now();
  const p = spawn(process.execPath, [file], {
    cwd: HERE,
    env: { ...process.env, VERIFY_URL: process.env.VERIFY_URL || 'http://127.0.0.1:8442' },
    windowsHide: true,
  });
  let out = '', err = '', killed = false;
  p.stdout.on('data', d => { out += d; if (out.length > 200000) out = out.slice(-200000); });
  p.stderr.on('data', d => { err += d; if (err.length > 200000) err = err.slice(-200000); });
  const timer = setTimeout(() => { killed = true; p.kill('SIGKILL'); }, BUDGET);
  p.on('error', e => { clearTimeout(timer); resolve({ file, code: -1, ms: Date.now() - t0, out, err: err + String(e), killed }); });
  p.on('close', code => { clearTimeout(timer); resolve({ file, code, ms: Date.now() - t0, out, err, killed }); });
});

const classify = (r) => {
  const all = r.out + '\n' + r.err;
  if (r.killed) return ['REACHES-BROWSER', `alive at ${(BUDGET / 1000)}s`];
  if (CRASH_RE.test(r.err)) {
    const m = r.err.match(/^(?:[A-Za-z]*Error|Error).*$/m) || r.err.match(CRASH_RE);
    return ['CRASHES', (m ? m[0] : 'node threw').slice(0, 90)];
  }
  if (BROWSER_ERR_RE.test(r.err)) {
    const m = r.err.match(BROWSER_ERR_RE);
    return ['CRASHES', 'browser/nav: ' + m[0].slice(0, 70)];
  }
  if (/usage:|Usage:|give me a prefix|requires? an? argument|missing .*argument/i.test(all) && r.ms < 8000)
    return ['NEEDS-ARGS', (all.match(/[Uu]sage:.*/) || [''])[0].slice(0, 70)];
  // Exited very fast with a non-zero code and NOTHING TO SHOW FOR IT. The
  // stdout test matters: `dupids.mjs` finishes a full static audit in 1.2 s and
  // prints a report that never says the word PASS, and calling that a crash is
  // the same class of error this file exists to stop.
  const hasVerdict = /\bPASS\b|\bFAIL\b|\bOK\b|\bok\b/.test(all);
  if (r.ms < 4000 && !hasVerdict && r.out.trim().length < 200)
    return ['CRASHES', `exit ${r.code} in ${r.ms} ms, no output and no verdict`];
  if (r.code === 0) return ['PASSES', (all.match(/.*\bPASS\b.*/) || [`exit 0, ${r.out.split('\n').length} lines of report`])[0].trim().slice(0, 70)];
  return ['FAILS', `exit ${r.code}: ` + ((all.match(/.*\bFAIL\b.*/) || [''])[0].trim().slice(0, 70) || 'no FAIL line')];
};

// WRITE AFTER EVERY SCRIPT, not at the end (added 2026-08-16, §152). A phase-B
// run is hours long and the end-of-run write meant a run that was interrupted —
// by a reboot, a reaped browser, a wall clock — produced NOTHING, which is how
// "run the whole suite" stayed undone. A partial inventory is a real result;
// losing it is not a tidier one.
// `out/` is gitignored, so a fresh worktree does not have it and the old
// end-of-run write died on ENOENT after the whole run had already happened.
const outName = argVal('--out', 'inventory.json');
fs.mkdirSync(path.join(HERE, 'out'), { recursive: true });
const outPath = path.join(HERE, 'out', outName);
const rows = [];
const flush = () => fs.writeFileSync(outPath, JSON.stringify(
  { budgetMs: BUDGET, exclude: EXCLUDE, excluded, done: rows.length, of: files.length, rows }, null, 1));
flush();
for (const f of files) {
  const r = await run(f);
  const [verdict, note] = classify(r);
  rows.push({ file: f, verdict, note, ms: r.ms, code: r.code,
              out: r.out.slice(-1500), err: r.err.slice(-1500) });
  flush();
  console.error(`[${String(rows.length).padStart(3)}/${files.length}] ${verdict.padEnd(16)} ${f.padEnd(26)} ${String(r.ms).padStart(6)} ms  ${note}`);
}

const order = ['CRASHES', 'FAILS', 'NEEDS-ARGS', 'PASSES', 'REACHES-BROWSER'];
console.log('\n\n=== SUITE INVENTORY ===');
console.log(`budget ${BUDGET / 1000}s per script, VERIFY_URL=${process.env.VERIFY_URL}`);
console.log(`REACHES-BROWSER at this budget means: still running when killed at ${BUDGET / 1000}s.`);
console.log('It is NOT a pass and it is NOT a crash. Read it as "costs more than the budget".\n');
for (const v of order) {
  const g = rows.filter(r => r.verdict === v);
  if (!g.length) continue;
  console.log(`\n--- ${v}  (${g.length})`);
  for (const r of g) console.log(`  ${r.file.padEnd(26)} ${String(r.ms).padStart(6)} ms  ${r.note}`);
}
if (excluded.length) {
  console.log(`\n--- EXCLUDED BY --exclude ${EXCLUDE.join(',')}  (${excluded.length})  NO VERDICT IS CLAIMED FOR THESE`);
  for (const f of excluded) console.log(`  ${f}`);
}
console.log('\ntotals: ' + order.map(v => `${v} ${rows.filter(r => r.verdict === v).length}`).join(' / ') + `  (of ${rows.length} run, ${excluded.length} excluded, ${rows.length + excluded.length} in the directory)`);
flush();
