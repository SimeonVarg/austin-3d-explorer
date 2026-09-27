/**
 * ci/run-checks.mjs — run one shard of the verify suite on a CI runner.
 *
 * WHY THIS IS NOT run.mjs OR inventory.mjs. Both were written for the owner's
 * laptop: run.mjs runs four browsers at once (on a 4-core runner that turns
 * every millisecond assertion into a coin toss), and inventory.mjs kills at a
 * short budget and calls survivors "unknown". Here each shard is a whole
 * machine, so scripts run ONE AT A TIME with the ceiling they actually need,
 * and every outcome gets a verdict.
 *
 * WHICH SCRIPTS: see plan.mjs. Every top-level scripts/verify/*.mjs runs unless
 * checks.json names it under quarantine / laptop_only / tools / harness.
 *
 * WHAT IT WRITES (under --out):
 *   results/shard-<k>.json    one row per script: verdict, exit code, seconds
 *   logs/<script>.log         everything the script printed
 *   pictures/<script>/...     every image the script wrote while it ran
 *
 * Verdicts: pass (exit 0), fail (exit 1 or any crash), cannot-run (exit 2),
 * timeout (exit 124 from chrome.mjs's watchdog, or killed at the ceiling).
 * Anything but pass turns the shard red.
 *
 * Usage:
 *   node scripts/verify/ci/run-checks.mjs --list                 what runs, as JSON
 *   node scripts/verify/ci/run-checks.mjs --matrix               shard indices, for the workflow
 *   node scripts/verify/ci/run-checks.mjs --shard 3 --of 16 --out ci-out
 *   node scripts/verify/ci/run-checks.mjs --only sky.mjs,dusk.mjs --out ci-out
 *
 * It reaps leftover harness browsers between scripts ONLY when GITHUB_ACTIONS
 * is set: reap.mjs kills every harness browser on the machine, and on the
 * owner's laptop that includes other lanes'.
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { VERIFY, REPO, loadConfig, plan, entry, shardOf } from './plan.mjs';

const CONFIG = loadConfig();
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const OF = Number(opt('--of', CONFIG.shards || 1));
const SHARD = Number(opt('--shard', 0));
const OUT = path.resolve(opt('--out', 'ci-out'));
const ONLY = opt('--only', null);
const IN_CI = process.env.GITHUB_ACTIONS === 'true';

// Pictures are the point; a sweep can write hundreds, so cap per script.
const PICTURE_RE = /\.(png|jpe?g|webp|gif)$/i;
const MAX_PICTURES = 80;
const MAX_PICTURE_BYTES = 60e6;
const SCAN_SKIP = new Set(['node_modules', '.git', '.claude']);

const { run, excluded, missing } = plan(CONFIG);

if (argv.includes('--list')) {
  console.log(JSON.stringify({ shards: OF, run, excluded, missing }, null, 1));
  process.exit(0);
}
if (argv.includes('--matrix')) {
  console.log(JSON.stringify(Array.from({ length: OF }, (_, i) => i)));
  process.exit(0);
}

function* walk(dir, skip) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const e of ents) {
    if (SCAN_SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (skip && p === skip) continue;
    if (e.isDirectory()) yield* walk(p, skip);
    else if (e.isFile()) yield p;
  }
}

// Images written anywhere in the checkout since the script started get copied
// into its picture folder. Scripts write to shots/, docs/shots/, out/, an
// --out dir... asking each one where would be another hand-kept list.
function collectPictures(since, dest) {
  const found = [];
  for (const p of walk(REPO, OUT)) {
    if (!PICTURE_RE.test(p)) continue;
    let st; try { st = fs.statSync(p); } catch (e) { continue; }
    if (st.mtimeMs >= since) found.push({ p, size: st.size });
  }
  found.sort((a, b) => a.p.localeCompare(b.p));
  let bytes = 0, kept = 0;
  for (const f of found) {
    if (kept >= MAX_PICTURES || bytes + f.size > MAX_PICTURE_BYTES) break;
    fs.mkdirSync(dest, { recursive: true });
    fs.copyFileSync(f.p, path.join(dest, path.relative(REPO, f.p).replace(/[\\/]/g, '__')));
    kept++; bytes += f.size;
  }
  // Plus whatever the script wrote straight into its own folder via {out}.
  let own = 0;
  for (const p of walk(dest)) if (PICTURE_RE.test(p)) own++;
  return { found: found.length, kept, own };
}

function reap() {
  if (!IN_CI) return;
  try { execFileSync(process.execPath, [path.join(VERIFY, 'reap.mjs')], { stdio: 'ignore', timeout: 30000 }); } catch (e) {}
}

function runOne(r) {
  const name = r.script.replace(/\.mjs$/, '');
  const picDir = path.join(OUT, 'pictures', name);
  fs.mkdirSync(picDir, { recursive: true });
  const args = r.args.map(a => a.replace('{out}', picDir));
  const log = fs.openSync(path.join(OUT, 'logs', name + '.log'), 'w');
  const t0 = Date.now();
  fs.writeSync(log, `$ node ${r.script} ${args.join(' ')}\n# ceiling ${r.timeout_s}s, VERIFY_URL=${process.env.VERIFY_URL}\n\n`);

  return new Promise(resolve => {
    const child = spawn(process.execPath, [r.script, ...args], {
      cwd: VERIFY,
      env: {
        ...process.env,
        // chrome.mjs's watchdog fires a little before ours, so a slow script
        // reports exit 124 (its own verdict) rather than a bare kill.
        VERIFY_MAX_MS: String(Math.max(30000, r.timeout_s * 1000 - 15000)),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let tail = '';
    const take = d => { fs.writeSync(log, d); tail = (tail + d.toString()).slice(-6000); };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    let killed = false;
    const timer = setTimeout(() => { killed = true; try { child.kill('SIGKILL'); } catch (e) {} }, r.timeout_s * 1000);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const secs = +((Date.now() - t0) / 1000).toFixed(1);
      reap();
      let verdict;
      if (killed || code === 124) verdict = 'timeout';
      else if (code === 0) verdict = 'pass';
      else if (code === 2) verdict = 'cannot-run';
      else verdict = 'fail';
      const pics = collectPictures(t0 - 1000, picDir);
      fs.writeSync(log, `\n# exit ${code}${signal ? ' signal ' + signal : ''}${killed ? ' (killed at the ceiling)' : ''} after ${secs}s; pictures: ${pics.kept} copied of ${pics.found} written in the checkout, ${pics.own} in its own folder\n`);
      fs.closeSync(log);
      try { if (!fs.readdirSync(picDir).length) fs.rmdirSync(picDir); } catch (e) {}
      resolve({ script: r.script, args: r.args, verdict, code, signal, secs,
                timeout_s: r.timeout_s, pictures: pics.kept + pics.own, tail: tail.slice(-2500) });
    });
  });
}

let mine;
if (ONLY) {
  mine = ONLY.split(',').map(s => s.trim().replace(/(\.mjs)?$/, '.mjs'))
    .map(w => run.find(r => r.script === w) || entry(CONFIG, w));
} else {
  mine = shardOf(run, SHARD, OF);
}

fs.mkdirSync(path.join(OUT, 'results'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'logs'), { recursive: true });
const resultPath = path.join(OUT, 'results', `shard-${ONLY ? 'only' : SHARD}.json`);
const rows = [];
const meta = {
  shard: SHARD, of: OF, only: !!ONLY, os: process.platform, node: process.version,
  sha: process.env.GITHUB_SHA || null, planned: mine.map(r => r.script), missing,
};
// Written after every script: a shard that dies half way still reports the half.
const flush = () => fs.writeFileSync(resultPath, JSON.stringify({ ...meta, rows }, null, 1));
flush();

console.log(`shard ${SHARD + 1}/${OF}: ${mine.length} script(s), ~${mine.reduce((s, r) => s + r.est_s, 0)} s estimated`);
for (const r of mine) {
  if (IN_CI) console.log(`::group::${r.script}`);
  const res = await runOne(r);
  rows.push(res);
  flush();
  console.log(res.tail.split('\n').slice(-40).join('\n'));
  if (IN_CI) console.log('::endgroup::');
  console.log(`${res.verdict.toUpperCase().padEnd(10)} ${r.script.padEnd(34)} ${String(res.secs).padStart(7)} s  exit ${res.code}`);
  if (res.verdict !== 'pass' && IN_CI) {
    console.log(`::error title=${r.script}: ${res.verdict}::exit ${res.code} after ${res.secs}s. Its log is logs/${r.script.replace(/\.mjs$/, '')}.log in this shard's artifact.`);
  }
}
const bad = rows.filter(r => r.verdict !== 'pass');
console.log(`\n${rows.length - bad.length} passed, ${bad.length} not passed`);
process.exitCode = bad.length ? 1 : 0;
