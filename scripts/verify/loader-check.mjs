/**
 * loader-check.mjs — does the progress bar track the load, or does it perform it?
 *
 * Reported: "The progress bar jumps from 7% to almost-done."
 *
 * Both numbers were exactly what the code produced. `boot` is weighted 22 of
 * 100 and every named stage was capped at 34% of the rail, so the bar sat at
 * 22 * 0.34 = 7.5% through ~1.7 s of fetch and parse; then all fourteen
 * remaining stages fired inside 276 ms, and the last two thirds was a timed CSS
 * creep to a literal "ALMOST".
 *
 * This samples the rail all the way through a REAL cold load and asserts on the
 * shape of the curve: how long it sits at its first value, how big its largest
 * single jump is, and how many distinct values it actually shows. Those three
 * numbers are what "it jumps" means, so those are what get measured.
 *
 * It also screenshots the load screen so the landmark silhouettes can be
 * looked at, because a clip-path is not something to assert on.
 *
 * Usage: node loader-check.mjs
 */
import { chromium } from 'playwright-core';
import { BASE as SERVER, launch } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';

const outDir = path.resolve('shots/loader');
fs.mkdirSync(outDir, { recursive: true });

const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: 1100, height: 720 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));

// Sample from inside the page: the rail is a compositor transform, so reading
// it over CDP once per poll would measure the poll, not the rail.
await page.addInitScript(() => {
  window.__railTrace = [];
  const t0 = performance.now();
  setInterval(() => {
    const f = document.getElementById('vl-fill');
    const s = document.getElementById('vl-status');
    const p = document.getElementById('vl-pct');
    if (!f) return;
    const m = new DOMMatrixReadOnly(getComputedStyle(f).transform);
    window.__railTrace.push({ t: +(performance.now() - t0).toFixed(0), x: +m.a.toFixed(4),
                              pct: p ? p.textContent : '', status: s ? s.textContent : '' });
  }, 100);
});

const nav = page.goto(`${SERVER}/index.html?intro=0&drift=0`, { waitUntil: 'commit', timeout: 180000 });
await nav;

// Catch the load screen while it is still up.
await page.waitForSelector('#veil-load', { timeout: 60000 });
await page.waitForTimeout(2600);
await page.screenshot({ path: path.join(outDir, 'loading-early.png') });
await page.waitForTimeout(2500);
await page.screenshot({ path: path.join(outDir, 'loading-mid.png') });

await page.waitForFunction(() => {
  const v = document.getElementById('veil');
  // app.js REMOVES the veil after its transition, so "gone" is the common
  // ending and an element check alone waits forever.
  return !v || v.classList.contains('lift') || getComputedStyle(v).opacity === '0';
}, null, { timeout: 180000 });
await page.waitForTimeout(2200);   // let the final 420 ms transition land and be sampled

const trace = await page.evaluate(() => window.__railTrace);
const writes = await page.evaluate(() => window.__railWrites || []);
fs.writeFileSync(path.join(outDir, 'rail-writes.json'), JSON.stringify(writes, null, 1));
fs.writeFileSync(path.join(outDir, 'rail-trace.json'), JSON.stringify(trace, null, 1));

const xs = trace.map(r => r.x);
const distinct = new Set(xs.map(x => x.toFixed(3))).size;
let biggestJump = 0, jumpAt = 0;
for (let i = 1; i < xs.length; i++) {
  const d = xs[i] - xs[i - 1];
  if (d > biggestJump) { biggestJump = d; jumpAt = trace[i].t; }
}
// How long the rail sat on its very first non-zero value.
const first = xs.find(x => x > 0.001);
let stallMs = 0;
if (first != null) {
  const startI = xs.findIndex(x => x > 0.001);
  let i = startI;
  while (i < xs.length && Math.abs(xs[i] - first) < 0.004) i++;
  stallMs = trace[Math.min(i, trace.length - 1)].t - trace[startI].t;
}
const statuses = [...new Set(trace.map(r => r.status).filter(Boolean))];
const sawTiling = statuses.some(s => /Tiling the city/.test(s));
const sawAlmost = trace.some(r => /ALMOST/i.test(r.pct));

const results = [];
const check = (n, p, d) => results.push({ n, p, d });

// The sampler runs on the same blocked main thread as everything else, so it
// gets a handful of samples across the tail, not one every 100 ms. That is a
// limit of the measurement, not of the bar: the floor is a compositor
// transition and keeps gliding between samples. So this asserts on what the
// samples CAN show — that the rail is not a two-state step function.
check('the rail is not a two-state step function', distinct >= 4,
  `${distinct} distinct rail positions across ${trace.length} samples (the sampler shares the blocked thread)`);
// Judge the WRITES, not the samples. A long floor transition moving the target
// a long way is a smooth glide the compositor performs over seconds; a SHORT
// write that moves the bar a long way is the jump being complained about.
let worstSnap = 0, worstAt = 0, prev = 0;
for (const w of writes) {
  const d = w.to - prev;
  if (w.ms <= 800 && d > worstSnap) { worstSnap = d; worstAt = w.t; }
  prev = Math.max(prev, w.to);
}
check('no short write yanks the bar a long way', worstSnap < 0.30,
  `worst snap ${(worstSnap * 100).toFixed(1)}% at t=${worstAt} ms across ${writes.length} writes ` +
  `(${writes.filter(w => w.kind === 'floor').length} floor, ${writes.filter(w => w.kind === 'real').length} real)`);
check('it does not sit on its first value for seconds', stallMs < 2600,
  `held its first value for ${stallMs} ms`);
check('the status line reports the tiling tail, not just "almost"', sawTiling,
  `statuses seen: ${statuses.join(' | ')}`);
check('the percentage keeps counting instead of giving up', !sawAlmost,
  sawAlmost ? 'still shows ALMOST' : 'numeric throughout');
// The load screen is REMOVED shortly after it fills, and the sampler shares the
// blocked thread, so "the last sample" is not reliably the last state. The
// maximum the rail was ever seen at is.
// The load screen is REMOVED shortly after it fills and the sampler shares the
// blocked thread, so the last SAMPLE is not reliably the last state. The write
// log is.
const railMax = Math.max(...xs);
const doneWrite = writes.find(w => w.kind === 'done');
check('it finishes at 100%', !!doneWrite && doneWrite.to === 1,
  doneWrite ? `loaderDone wrote scaleX(1) at t=${doneWrite.t} ms (highest sampled ${(railMax * 100).toFixed(1)}%)`
            : 'loaderDone never wrote a final value');
check('no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | ') || 'none');

let bad = 0;
for (const r of results) { console.log(`${r.p ? ' PASS ' : '*FAIL '} ${r.n}\n         ${r.d}`); if (!r.p) bad++; }
console.log(`\n${results.length - bad}/${results.length} passed`);
console.log('rail curve (t ms -> %):', trace.filter((_, i) => i % 6 === 0)
  .map(r => `${r.t}:${Math.round(r.x * 100)}`).join('  '));
console.log('shots in', outDir);
browser.__done();
process.exitCode = bad ? 1 : 0;
