/**
 * ci/summary.mjs — turn every shard's results into ONE markdown report: the PR
 * comment and the run's summary page. Plain words first, the failures at the
 * top with the line that says why, everything else folded away.
 *
 * Usage (the workflow's summary job):
 *   node scripts/verify/ci/summary.mjs --results <dir> [--pictures <dir>]
 *        [--probe mac=<dir>] [--probe linux=<dir>] [--artifacts <jsonl>]
 *        [--run-url <url>] [--sha <sha>]
 *        --out summary.md
 *
 * <dir>s are searched recursively, because downloaded artifacts land one
 * folder per artifact. Exit 1 if any check did not pass or any shard sent no
 * results at all (a shard that died silently must not read as green).
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, plan, shardOf } from './plan.mjs';

export const MARKER = '<!-- visual-checks-summary -->';
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };

function* files(dir, re) {
  if (!dir || !fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* files(p, re);
    else if (re.test(e.name)) yield p;
  }
}
const readJSON = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } };
const esc = s => String(s ?? '').replace(/\|/g, '\\|').replace(/`/g, "'").replace(/\r?\n/g, ' ').trim();
const short = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** The line of a script's output that best says why it failed. */
function why(tail) {
  const lines = String(tail || '').split('\n').map(l => l.trim()).filter(Boolean)
    .filter(l => !l.startsWith('[chrome.mjs]') && !/^at\s/.test(l));
  const pick = [...lines].reverse().find(l => /\bFAIL|Error|error:|assert|watchdog|killed/i.test(l));
  return short(esc(pick || lines[lines.length - 1] || 'no output'), 160);
}

const config = loadConfig();
const { run, excluded } = plan(config);
const OF = config.shards || 1;

// ---- checks ------------------------------------------------------------
const shards = new Map();
for (const p of files(opt('--results'), /^shard-.*\.json$/)) {
  const j = readJSON(p);
  if (j) shards.set(String(j.shard), j);
}
const rows = [...shards.values()].flatMap(s => s.rows || []);
const seen = new Set(rows.map(r => r.script));
// Planned but never reported: the shard died, or was cancelled, before it got
// there, or never started. A hand-picked run (--only) expects only its picks.
const onlyRun = [...shards.values()].some(s => s.only);
const lost = [];
if (onlyRun) {
  for (const s of shards.values()) for (const f of s.planned || []) if (!seen.has(f)) lost.push({ script: f, shard: 0 });
} else {
  for (let k = 0; k < OF; k++) {
    for (const r of shardOf(run, k, OF)) if (!seen.has(r.script)) lost.push({ script: r.script, shard: k });
  }
}
const bad = rows.filter(r => r.verdict !== 'pass').sort((a, b) => a.script.localeCompare(b.script));
const good = rows.filter(r => r.verdict === 'pass').sort((a, b) => a.script.localeCompare(b.script));

// ---- artifacts ---------------------------------------------------------
// A JSON array, or one JSON object per line (what `gh api --paginate --jq` gives).
const artifacts = (() => {
  const p = opt('--artifacts');
  if (!p || !fs.existsSync(p)) return [];
  const s = fs.readFileSync(p, 'utf8').trim();
  try { return JSON.parse(s); } catch (e) {}
  return s.split('\n').map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
})();
const runUrl = opt('--run-url', '');
const artLink = name => {
  const a = artifacts.find(x => x.name === name);
  return a && runUrl ? `${runUrl}/artifacts/${a.id}` : null;
};
const OS = opt('--os', '');
const shardArt = k => artLink(`checks-${OS ? OS + '-' : ''}shard-${onlyRun ? 'only' : k}`);
const shardFor = script => {
  const r = rows.find(x => x.script === script);
  for (const [k, s] of shards) if ((s.rows || []).includes(r)) return Number(k);
  return null;
};

// ---- pictures ----------------------------------------------------------
let pictures = null;
for (const p of files(opt('--pictures'), /^pictures\.json$/)) pictures = readJSON(p);
// Graphics probes: `--probe name=dir`, repeatable (mac, linux).
const probes = [];
argv.forEach((a, i) => {
  if (a !== '--probe') return;
  const [name, dir] = String(argv[i + 1] || '').split('=');
  for (const p of files(dir, /^gpu-probe\.json$/)) probes.push({ name, report: readJSON(p) });
});

// ---- report ------------------------------------------------------------
const sha = (opt('--sha', '') || '').slice(0, 7);
const L = [MARKER];
const failing = bad.length + lost.length;
L.push(`## Visual checks: ${failing ? `${failing} not passing, ` : 'all '}${good.length} passed${sha ? ` (commit ${sha})` : ''}`);
L.push('');
L.push(`Every check in \`scripts/verify\` that can run without a graphics card, on GitHub's machines${OS ? ` (\`${OS}\`)` : ''}, software-rendered. ` +
       `How to read this: \`scripts/verify/README.md\`, section "CI: the checks on every pull request".`);
L.push('');

if (bad.length || lost.length) {
  L.push('### Not passing');
  L.push('');
  L.push('| check | result | time | what it said | log + pictures |');
  L.push('|---|---|---|---|---|');
  for (const r of bad) {
    const k = shardFor(r.script);
    const link = k != null && shardArt(k) ? `[shard ${k + 1}](${shardArt(k)})` : '';
    const res = r.verdict === 'timeout' ? `timed out (${r.timeout_s} s ceiling)`
      : r.verdict === 'cannot-run' ? 'could not run (exit 2)' : `failed (exit ${r.code})`;
    L.push(`| \`${r.script}\` | ${res} | ${Math.round(r.secs)} s | ${why(r.tail)} | ${link} |`);
  }
  for (const r of lost) {
    L.push(`| \`${r.script}\` | no result: shard ${r.shard + 1} stopped before it ran | | | ${shardArt(r.shard) ? `[shard ${r.shard + 1}](${shardArt(r.shard)})` : ''} |`);
  }
  L.push('');
}

if (pictures) {
  const changed = (pictures.poses || []).filter(p => p.changed);
  L.push('### Pictures, before and after');
  L.push('');
  if (pictures.error) {
    L.push(`The before/after pictures could not be made: ${esc(pictures.error)}`);
  } else {
    const link = artLink('pictures-before-after');
    L.push(`${changed.length} of ${(pictures.poses || []).length} views look different from \`${esc(pictures.beforeLabel || 'main')}\`` +
           ` (a pixel counts if any colour channel moved more than ${pictures.tolerance}; a view counts if more than ${pictures.minPct}% of its pixels did).` +
           (link ? ` [Download the side-by-sides](${link}).` : ''));
    L.push('');
    L.push('| view | pixels that moved | same page shot twice | biggest channel change |');
    L.push('|---|---|---|---|');
    for (const p of pictures.poses || []) {
      L.push(`| ${p.changed ? '**' + esc(p.name) + ' (changed)**' : esc(p.name)} | ${p.error ? esc(p.error) : p.pct + '%'} | ` +
             `${p.noisePct != null ? p.noisePct + '%' : ''} | ${p.maxChannelDiff ?? ''} |`);
    }
    L.push('');
    if (pictures.shotQuery) {
      L.push(`Shot with \`?${esc(pictures.shotQuery)}\`${/namelabels=0/.test(pictures.shotQuery) ? ': name labels off, because they pick what to show from timing and two loads of the same page differ' : ''}.`);
      L.push('');
    }
    L.push('Pictures never fail the run: a change can be the point of the pull request. They are here to be looked at.');
  }
  L.push('');
}

const retried = rows.filter(r => r.retried);
if (retried.length) {
  L.push(`Run twice because Chrome could not take a screenshot the first time (not a verdict; ` +
         `every other failure stands): ${retried.map(r => `\`${r.script}\` (${r.verdict === 'pass' ? 'passed the second time' : 'failed again'})`).join(', ')}.`);
  L.push('');
}

if (good.length) {
  L.push(`<details><summary>${good.length} passed</summary>`);
  L.push('');
  L.push(good.map(r => `\`${r.script}\` ${Math.round(r.secs)} s${r.pictures ? `, ${r.pictures} pictures` : ''}`).join(' · '));
  L.push('');
  L.push('</details>');
  L.push('');
}

const byBucket = b => Object.entries(excluded).filter(([, v]) => v.bucket === b);
const q = byBucket('quarantine');
L.push(`<details><summary>Not run here: ${q.length} quarantined, ${byBucket('laptop_only').length} timing (laptop only), ${byBucket('tools').length} tools with no verdict</summary>`);
L.push('');
if (q.length) {
  L.push('Quarantined (listed in `scripts/verify/ci/checks.json`, with the reason):');
  L.push('');
  for (const [f, v] of q) L.push(`- \`${f}\`: ${esc(v.why)}`);
  L.push('');
}
L.push('Timing stays on the laptop: a shared cloud CPU drawing in software measures the machine, not the code.');
L.push('');
L.push('</details>');
L.push('');

if (probes.length) {
  L.push('<details><summary>Graphics probes: which renderer Chrome gets, and how fast the city draws</summary>');
  L.push('');
  L.push('| machine | launch mode | renderer | page load | frames per second |');
  L.push('|---|---|---|---|---|');
  for (const { name, report } of probes) {
    for (const m of report?.modes || []) {
      L.push(`| ${esc(name)} (${report.cpus} cores) | ${esc(m.mode)} | ${m.renderer ? '`' + esc(m.renderer) + '`' : ''} | ` +
             `${m.loadSecs != null ? m.loadSecs + ' s' : ''} | ${m.fps ?? (m.error ? 'error: ' + esc(short(m.error, 80)) : '')} |`);
    }
    const link = artLink(`${name}-probe`);
    if (link) L.push(`| ${esc(name)} | [screenshots](${link}) | | | |`);
  }
  L.push('');
  L.push('</details>');
  L.push('');
}

const links = [];
for (let k = 0; k < OF; k++) if (shardArt(k)) links.push(`[${k + 1}](${shardArt(k)})`);
if (links.length) L.push(`Logs and every picture a check wrote, per shard: ${links.join(' ')}. `);
if (runUrl) L.push(`[The whole run](${runUrl}).`);

let md = L.join('\n');
if (md.length > 60000) md = md.slice(0, 59000) + '\n\n(cut short: the full report is on the run page)';
fs.writeFileSync(opt('--out', 'summary.md'), md);
console.log(md);
process.exitCode = failing ? 1 : 0;
