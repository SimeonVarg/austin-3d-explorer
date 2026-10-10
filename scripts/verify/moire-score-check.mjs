// No browser. Checks the parts of moire-meter.mjs that decide whether a run can be believed, on small synthetic
// inputs (moire-score.mjs). Four ways the meter used to print a clean-looking answer it had not earned:
//   1. a view with no building pixels scored err 0 / flicker 0, printed "at floor" (Y/Y/Y) and counted in the mean;
//   2. --frames 1 measured flicker as exactly 0 (flicker is a spread over frames and needs two);
//   3. settle() gave up after 120 s / 60 s without saying so, and the meter then read a half-built city;
//   4. none of that could change the exit code.
// Usage: node moire-score-check.mjs   (exits 1 on any failed expectation)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { statOver, settleWith, tableLines, verdict } from './moire-score.mjs';

const P = { FLOOR_SLACK: 1.5, FLOOR_ABS: 0.15, FRAMES: 8 };
const METER = new URL('./moire-meter.mjs', import.meta.url).pathname;
let failed = 0;
async function t(name, fn) {
  try { await fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n       ' + String(e.message).split('\n').join('\n       ')); }
}

// 8 x 8 image, signed error per frame: a constant `base` plus frame-dependent wobble
const W = 8, H = 8, N = W * H;
function errFrames(frames, wobble) {
  return Array.from({ length: frames }, (_, f) => { const E = new Float32Array(N * 3); E.fill(2 + wobble * (f % 2 ? 1 : -1)); return E; });
}
const ctx = frames => ({ e: errFrames(frames, 1), N, W, frames });
const interior = p => (p % W) >= 1 && (p % W) <= W - 2 && p >= W && p < N - W;

await t('a selected view scores its error and its flicker', () => {
  const s = statOver(interior, ctx(4));
  assert.equal(s.n, 36);
  assert.ok(Math.abs(s.err - 2) < 1e-6, 'err ' + s.err);        // |2 +- 1| averaged over frames = 2
  assert.ok(s.flick > 0.5 && s.flick < 1.5, 'flick ' + s.flick); // the +-1 wobble
});
await t('an EMPTY mask is reported as not measured, never as zero error', () => {
  const s = statOver(() => false, ctx(4));
  assert.equal(s.n, 0);
  for (const k of ['err', 'p99', 'band', 'flick', 'flickP99']) assert.ok(s[k] === null || Number.isNaN(s[k]), `${k} must not be a number that looks like a measurement, got ${s[k]}`);
});
await t('ONE frame: flicker is not measured (needs >= 2 frames), error still is', () => {
  const s = statOver(interior, ctx(1));
  assert.ok(Math.abs(s.err - 1) < 1e-6, 'err ' + s.err);
  assert.ok(s.flick === null || Number.isNaN(s.flick), 'flicker of one frame must not be reported as 0, got ' + s.flick);
});

const stat = (n, err = 1, flick = 1) => ({ n, err, p99: err * 8, band: err / 2, flick, flickP99: flick * 4 });
const row = (name, all, floor = stat(100, 0.2, 0.2), extra = {}) => ({ name, arm: 'main', grp: 'g', mask: all.n ? 0.5 : 0, authored: 0.1, maplibre: 0.4, all, apt: stat(10), mpl: stat(10), floor, flatShare: 0.3, ...extra });
const good = row('good', stat(500, 1.1, 1.2));
const empty = row('empty', stat(0, null, null), stat(0, null, null));

await t('verdict names a view whose mask is empty', () => {
  const f = verdict([good, empty], P);
  assert.ok(f.some(x => x.includes('empty') && /no building pixels/i.test(x)), 'got ' + JSON.stringify(f));
});
await t('verdict is quiet for a good run', () => assert.deepEqual(verdict([good, row('good2', stat(300, 0.9, 1))], P), []));
await t('verdict refuses a flicker that was not measured', () => {
  const f = verdict([row('oneframe', stat(500, 1, null))], P);
  assert.ok(f.some(x => x.includes('oneframe') && /flicker/i.test(x)), 'got ' + JSON.stringify(f));
});
await t('the table never says "at floor" for an empty view, and its mean leaves the view out', () => {
  const lines = tableLines([good, empty], P);
  const emptyLine = lines.find(l => l.startsWith('empty'));
  assert.ok(emptyLine && !/Y\/Y\/Y/.test(emptyLine), 'empty view line: ' + emptyLine);
  const mean = lines.find(l => l.startsWith('MEAN'));
  assert.ok(/\b1\.10\b/.test(mean), 'the mean must be the good view alone (1.10), got: ' + mean);
});

// the CLI, end to end without a browser: --from re-scores a saved --json file
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'moire-check-'));
const save = (name, rows) => { const f = path.join(tmp, name); fs.writeFileSync(f, JSON.stringify({ msaa: false, q: [], ss: 4, frames: 8, size: [480, 300], rows })); return f; };
const run = args => spawnSync(process.execPath, [METER, ...args], { encoding: 'utf8', timeout: 20000 });
await t('exit code: a run with an empty view exits non-zero and says why', () => {
  const r = run(['--from', save('empty.json', [good, empty])]);
  assert.notEqual(r.status, 0, 'exit status ' + r.status);
  assert.match(r.stderr, /empty.*no building pixels/i);
});
await t('exit code: a clean run exits 0', () => {
  const r = run(['--from', save('good.json', [good])]);
  assert.equal(r.status, 0, 'exit status ' + r.status + '\n' + r.stderr);
  assert.match(r.stdout, /MEAN main/);
});
await t('--frames 1 is refused before any browser starts', () => {
  const r = run(['--out', path.join(tmp, 'o'), '--frames', '1']);
  assert.equal(r.status, 2, 'exit status ' + r.status + '\n' + r.stderr.slice(0, 300));
  assert.match(r.stderr, /--frames.*2/);
});

// settle(): fake clock, no sleeping
function fakeEnv({ quiet, idle }) {
  let now = 0;
  return { now: () => now, sleep: async ms => { now += ms; }, quiet: () => quiet(now), waitIdle: async ms => { now += idle ? 5 : ms; return idle; }, quietMaxMs: 120000, idleMaxMs: 60000 };
}
await t('settle: a healthy page settles and returns', async () => { await settleWith(fakeEnv({ quiet: () => true, idle: true })); });
await t('settle: a build queue that never finishes is an error, not a silent timeout', async () => {
  await assert.rejects(settleWith(fakeEnv({ quiet: () => false, idle: true })), /not quiet|still busy|120/i);
});
await t('settle: a map that never goes idle is an error, not a silent timeout', async () => {
  await assert.rejects(settleWith(fakeEnv({ quiet: () => true, idle: false })), /idle/i);
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `\nFAIL: ${failed} expectation(s) failed` : '\nPASS: the meter refuses empty views, one-frame flicker and silent settle timeouts');
process.exit(failed ? 1 : 0);
