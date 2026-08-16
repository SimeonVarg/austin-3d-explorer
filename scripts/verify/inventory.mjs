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
 * Usage:
 *   node inventory.mjs                 phase A, 25 s each
 *   node inventory.mjs --budget 90     longer budget
 *   node inventory.mjs --only a.mjs,b.mjs
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

// reap.mjs is excluded on purpose: it kills every harness browser on the
// machine by flag match, including a sibling lane's. chrome.mjs is a library.
const SKIP = new Set(['chrome.mjs', 'reap.mjs', 'inventory.mjs', 'run.mjs', 'warmup.mjs']);

let files = fs.readdirSync(HERE).filter(f => f.endsWith('.mjs') && !SKIP.has(f)).sort();
if (ONLY) files = ONLY.split(',').map(s => s.trim());

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

const rows = [];
for (const f of files) {
  const r = await run(f);
  const [verdict, note] = classify(r);
  rows.push({ file: f, verdict, note, ms: r.ms, code: r.code,
              out: r.out.slice(-1500), err: r.err.slice(-1500) });
  console.error(`${verdict.padEnd(16)} ${f.padEnd(26)} ${String(r.ms).padStart(6)} ms  ${note}`);
}

const order = ['CRASHES', 'FAILS', 'NEEDS-ARGS', 'PASSES', 'REACHES-BROWSER'];
console.log('\n\n=== SUITE INVENTORY ===');
console.log(`budget ${BUDGET / 1000}s per script, VERIFY_URL=${process.env.VERIFY_URL}\n`);
for (const v of order) {
  const g = rows.filter(r => r.verdict === v);
  if (!g.length) continue;
  console.log(`\n--- ${v}  (${g.length})`);
  for (const r of g) console.log(`  ${r.file.padEnd(26)} ${String(r.ms).padStart(6)} ms  ${r.note}`);
}
console.log('\ntotals: ' + order.map(v => `${v} ${rows.filter(r => r.verdict === v).length}`).join(' / ') + `  (of ${rows.length})`);
fs.writeFileSync(path.join(HERE, 'out', 'inventory.json'), JSON.stringify(rows, null, 1));
