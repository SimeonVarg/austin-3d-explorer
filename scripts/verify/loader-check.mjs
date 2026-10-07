/**
 * loader-check.mjs — does the progress bar track the load, or does it perform it?
 *
 * Reported (old loader): "The progress bar jumps from 7% to almost-done." Its
 * rail sat at 7.5% through the fetch and parse, every named stage fired inside
 * 276 ms, and the last two thirds was a timed CSS creep to a literal "ALMOST".
 *
 * The loader since 2026-09-28 (js/loader.js, the owner-approved Tower screen)
 * reports measured work: map/tiles 20, parsed data 20, authored buildings 45,
 * lighting 5, reveal 10. Measured on a real load, the RAW reading dips 11-21
 * times (new data files are discovered mid-load; the opening camera re-requests
 * tiles under the veil and costs -10 for the last ~12 s), so the bar shows the
 * highest reading so far. `window.__loading.history` keeps both: `percent`
 * (raw) and `shown` (what the bar drew).
 *
 * This samples the rail through a REAL cold load and asserts on the shape of
 * what was shown: enough distinct values that it is not a two-state step
 * function, never backwards, no single update that yanks it most of the way,
 * no fake "ALMOST", a time line that counts real seconds, and 100% once the
 * city is actually complete. It also screenshots the load screen.
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
    const f = document.querySelector('#load-city .load-rail i');
    if (!f || window.__loading?.reveal) return;
    const m = new DOMMatrixReadOnly(getComputedStyle(f).transform);
    window.__railTrace.push({ t: +(performance.now() - t0).toFixed(0), x: +m.a.toFixed(4),
      pct: document.getElementById('load-percent')?.textContent || '', est: document.getElementById('load-estimate')?.textContent || '' });
  }, 100);
});

await page.goto(`${SERVER}/index.html?intro=0&drift=0`, { waitUntil: 'commit', timeout: 180000 });
await page.waitForFunction(() => typeof window.cancelGraphicsAutoDetect === 'function', null, { timeout: 120000, polling: 100 })
  .then(() => page.evaluate(() => window.cancelGraphicsAutoDetect())).catch(() => {});

// Catch the load screen while it is still up. Pictures only, never a verdict:
// under SwiftShader the main thread can be building for longer than a
// screenshot is allowed to wait, and a missed frame must not fail the check.
const shot = name => page.screenshot({ path: path.join(outDir, name), timeout: 60000 })
  .catch(e => console.log(`(screenshot ${name} skipped: ${e.message.split('\n')[0]})`));
await page.waitForSelector('#load-city', { timeout: 60000 });
await page.waitForTimeout(2600);
await shot('loading-early.png');
await page.waitForTimeout(2500);
await shot('loading-mid.png');

await page.waitForFunction(() => window.__loading?.reveal, null, { timeout: 240000, polling: 250 });
// A reveal can come before the last building (the app's ceiling); the bar only
// claims 100% once the city is really complete, so give it time to get there.
await page.waitForFunction(() => window.__loading?.complete === true, null, { timeout: 120000, polling: 500 }).catch(() => {});
await page.waitForTimeout(800);

const trace = await page.evaluate(() => window.__railTrace);
const history = await page.evaluate(() => window.__loading.history);
const fin = await page.evaluate(() => ({ complete: window.__loading.complete, current: window.__loading.current, reveal: window.__loading.reveal }));
fs.writeFileSync(path.join(outDir, 'rail-trace.json'), JSON.stringify(trace, null, 1));
fs.writeFileSync(path.join(outDir, 'loading-history.json'), JSON.stringify(history, null, 1));

const shown = history.map(h => h.shown ?? h.percent), raw = history.map(h => h.percent);
const distinct = [...new Set(shown)];
let backwards = 0, biggest = 0, bigAt = 0;
for (let i = 1; i < shown.length; i++) {
  if (shown[i] < shown[i - 1]) backwards++;
  const d = shown[i] - shown[i - 1];
  // The reveal's own 10 (and whatever lands with it) is the finish, not a yank.
  if (d > biggest && !(history[i].complete && shown[i] === 100)) { biggest = d; bigAt = history[i].ms; }
}
let rawDips = 0; for (let i = 1; i < raw.length; i++) if (raw[i] < raw[i - 1]) rawDips++;
const xs = trace.map(r => r.x);
let railBack = 0; for (let i = 1; i < xs.length; i++) if (xs[i] < xs[i - 1] - 0.001) railBack++;
const ests = [...new Set(trace.map(r => r.est).filter(Boolean))];

const results = [];
const check = (n, p, d) => results.push({ n, p, d });
check('the rail is not a two-state step function', distinct.length >= 5,
  `${distinct.length} distinct shown values: ${distinct.join(' ')}`);
check('the bar never slides back', backwards === 0 && railBack === 0,
  `${backwards} backward steps in the write log, ${railBack} in ${trace.length} rail samples (the raw measurement dipped ${rawDips} times; the bar holds its best)`);
check('no single update yanks the bar most of the way', biggest < 50,
  `largest single step ${biggest} points at ${bigAt} ms`);
check('the percentage keeps counting instead of giving up', !trace.some(r => /ALMOST/i.test(r.pct)),
  'numeric throughout');
check('the time line counts real seconds, no promised duration', ests.length > 0 && ests.every(e => /^\d+s in\. /.test(e)) && !ests.some(e => /Usually about/.test(e)),
  `${ests.length} distinct lines, e.g. ${JSON.stringify(ests.slice(-2))}`);
check('it finishes at 100% once the city is complete', fin.complete === true && shown.at(-1) === 100,
  `complete=${fin.complete}, last shown ${shown.at(-1)}%, built ${fin.current?.built}/${fin.current?.total}, reveal ${fin.reveal?.reason}`);
check('no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | ') || 'none');

let bad = 0;
for (const r of results) { console.log(`${r.p ? ' PASS ' : '*FAIL '} ${r.n}\n         ${r.d}`); if (!r.p) bad++; }
console.log(`\n${results.length - bad}/${results.length} passed`);
console.log('shown curve (ms -> %):', history.filter((_, i) => i % 4 === 0).map(h => `${h.ms}:${h.shown ?? h.percent}`).join('  '));
console.log('shots in', outDir);
browser.__done?.();
process.exitCode = bad ? 1 : 0;
