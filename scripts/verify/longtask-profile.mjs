/**
 * longtask-profile.mjs — WHICH FUNCTION owns the longest main-thread task.
 *
 * The build worker removes the apartment build from the main thread but the longest single task barely moved (about 2.7 s on the laptop, 1.5 s on an L4).
 * This loads the page the way rust-builder-timing.mjs does, runs the V8 sampling profiler (CDP Profiler, 1 ms interval) over the whole load, records every
 * 'longtask' entry with its start and duration, and for the N longest prints the functions that own the time INSIDE that window: self time by function
 * (url:line), and the sum by file. Profile time and performance.now() are aligned by sampling both at Profiler.start.
 *
 *   VERIFY_URL=http://127.0.0.1:PORT node scripts/verify/longtask-profile.mjs [--query "&buildworker=1"] [--top 3] [--throttle 1] [--out file.json]
 * Not a verdict: a measurement. The worker's own thread is not in this profile (it is a separate isolate).
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { BASE, launch, glArgsFor } from './chrome.mjs';

const PARAMS = {
  query: 'intro=0&drift=0&namelabels=0&facadepace=0&timeofdaypace=0',
  viewport: { width: 1440, height: 900 },
  samplingIntervalUs: 1000,    // V8 sampling profiler interval
  topTasks: 3, topFunctions: 8,
  readyMs: 1200000, settleMs: 3000,
};
const argv = process.argv.slice(2);
const flag = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const QUERY = flag('--query', '&buildworker=1'), TOP = Number(flag('--top', PARAMS.topTasks)), THROTTLE = Number(flag('--throttle', 1)), OUT = flag('--out', null);

const browser = await launch(chromium, { maxMs: PARAMS.readyMs + 120000, args: glArgsFor(process.env.VERIFY_GL || 'hardware') });
try {
  const page = await browser.newPage({ viewport: PARAMS.viewport, deviceScaleFactor: 1 });
  await page.addInitScript(() => {
    window.__lt = [];
    try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push({ start: e.startTime, dur: e.duration }); }).observe({ type: 'longtask', buffered: true }); } catch (e) {}
  });
  const cdp = await page.context().newCDPSession(page);
  if (THROTTLE > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: PARAMS.samplingIntervalUs });
  await cdp.send('Profiler.start');
  await page.goto(`${BASE}/index.html?${PARAMS.query}${QUERY}`, { waitUntil: 'domcontentloaded', timeout: 600000 });
  await page.waitForFunction(() => window.cancelGraphicsAutoDetect, null, { timeout: 120000 }).catch(() => {});
  await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
  await page.waitForFunction(() => { const A = window.slopesApartments; return !!(A && A.count.done && A.group) && window.__intro && window.__intro.reason; }, null, { timeout: PARAMS.readyMs, polling: 500 });
  await page.waitForTimeout(PARAMS.settleMs);
  const nowPerf = await page.evaluate(() => performance.now());
  const { profile } = await cdp.send('Profiler.stop');
  const tasks = await page.evaluate(() => window.__lt);
  // profile.startTime/endTime are microseconds on the profiler's clock; the profile spans [start, end] and ends about when nowPerf was read
  const endUs = profile.endTime, perfAt = us => nowPerf - (endUs - us) / 1000;   // performance.now() of a profile timestamp
  const byId = new Map(profile.nodes.map(n => [n.id, n]));
  let t = profile.startTime; const samples = profile.samples.map((id, i) => { t += profile.timeDeltas[i]; return { id, t }; });
  const label = n => { const c = n.callFrame; return `${c.functionName || '(anonymous)'} ${c.url.replace(/^https?:\/\/[^/]+\//, '')}:${c.lineNumber + 1}`; };
  const top = [...tasks].sort((a, b) => b.dur - a.dur).slice(0, TOP);
  const report = [];
  console.log(`${tasks.length} long tasks (over 50 ms), total ${tasks.reduce((s, x) => s + x.dur, 0).toFixed(0)} ms; query ${QUERY || '(default)'}, CPU throttle ${THROTTLE}x`);
  for (const k of top) {
    const self = new Map(), byFile = new Map(); let total = 0;
    for (let i = 0; i < samples.length; i++) {
      const p = perfAt(samples[i].t); if (p < k.start || p > k.start + k.dur) continue;
      const dt = (profile.timeDeltas[i + 1] ?? profile.timeDeltas[i]) / 1000, n = byId.get(samples[i].id); total += dt;
      const l = label(n); self.set(l, (self.get(l) || 0) + dt);
      const f = n.callFrame.url.replace(/^https?:\/\/[^/]+\//, '') || '(' + (n.callFrame.functionName || 'native') + ')'; byFile.set(f, (byFile.get(f) || 0) + dt);
    }
    const rows = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, PARAMS.topFunctions), files = [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    console.log(`\nlong task at ${(k.start / 1000).toFixed(1)} s, ${k.dur.toFixed(0)} ms (${total.toFixed(0)} ms sampled)`);
    for (const [l, ms] of rows) console.log(`  ${ms.toFixed(0).padStart(6)} ms  ${l}`);
    console.log('  by file: ' + files.map(([f, ms]) => `${f} ${ms.toFixed(0)} ms`).join('; '));
    report.push({ start: k.start, dur: k.dur, sampled: total, functions: rows, files });
  }
  if (OUT) fs.writeFileSync(OUT, JSON.stringify({ query: QUERY, throttle: THROTTLE, tasks: report }, null, 1));
} finally { await browser.__done(); }
