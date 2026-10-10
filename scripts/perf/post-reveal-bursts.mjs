/**
 * post-reveal-bursts.mjs — when does the wall-tiers painting (js/facades.js WALL TIERS) hold the main thread, and how
 * long, AFTER the veil has lifted? (written 2026-10-10)
 *
 * Per rep, in a FRESH Chrome with an empty cache: load the page, wait for the reveal ("city ready") and for the opening
 * flight to finish (--settle), then FLY: jump the camera to each of the ten cameras of scripts/verify/ci/poses.json
 * (with its hour), then zoom from high to street level in half-zoom steps over the spawn point, so new patterns and the
 * near tier are met for the first time. Records, from the page:
 *   - every burst (one tile request that painted or answered images): time since the reveal, images, ms, how many
 *     were answered flat (js/facades.js `__facadeWallTiers.burstLog`), and the longest frame gap (rAF to rAF);
 *   - the same for the part BEFORE the reveal, for contrast.
 *
 * Arms are extra queries, crossed with the CPU throttles, run interleaved: --qarms 'wtcap=0;' (cap off, cap on).
 * SETTINGS THAT COLOUR THE NUMBERS: as scripts/perf/load-profile.mjs (throttle slows the page main thread only; hardware
 * graphics; 1280x800 at 1.5; ?drift=0; auto-detect cancelled). Quote them with the numbers.
 *
 *   node scripts/perf/post-reveal-bursts.mjs --url http://127.0.0.1:8442/ --throttle 1,4 --qarms 'wtcap=0;' --reps 3 --out DIR
 *   print from files already in DIR:  --from DIR
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startChrome, machineLoad } from './lib/cdp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const URL0 = arg('--url', (process.env.VERIFY_URL || 'http://127.0.0.1:8099') + '/');
const THROTTLES = arg('--throttle', '1').split(',').map(Number);
const QARMS = arg('--qarms', '').split(';');
const REPS = +arg('--reps', 3);
const GL = arg('--gl', 'hardware');
const SETTLE = +arg('--settle', 10000);
const MAX = +arg('--max', 420000);
const OUT = arg('--out', path.join(process.env.TMPDIR || '/tmp', 'post-reveal-bursts'));
const FROM = arg('--from', '');
// a burst is "long" above this (ms), per throttle: the ask was 50 ms at 1x and 200 ms at 4x
const LONG = { 1: 50, 4: 200 };
const POSES = JSON.parse(fs.readFileSync(path.join(HERE, '../verify/ci/poses.json'), 'utf8'));
const INSTRUMENT = fs.readFileSync(path.join(HERE, 'lib/instrument.js'), 'utf8');
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };

// runs in the page: fly, return when done
// wraps every styledata / data listener of the map with a timer, to name the expensive one
const PROBE = `(() => {
  const m = window.__map, acc = window.__listenerCost = {};
  const L = m._listeners || {};
  for (const ev of ['styledata', 'data']) {
    const arr = L[ev] || [];
    for (let i = 0; i < arr.length; i++) {
      const fn = arr[i]; if (typeof fn !== 'function') continue;
      const name = ev + ' #' + i + ' ' + String(fn).replace(/\\s+/g, ' ').slice(0, 110);
      acc[name] = { n: 0, ms: 0 };
      arr[i] = function () { const t = performance.now(); try { return fn.apply(this, arguments); } finally { const e = acc[name]; e.n++; e.ms += performance.now() - t; } };
    }
  }
  return Object.keys(acc).length;
})()`;
const FLIGHT = `(async (poses) => {
  const m = window.__map, wait = (ms) => new Promise(r => setTimeout(r, ms));
  const settle = async (cap) => { await Promise.race([new Promise(r => m.once('idle', () => r())), wait(cap)]); await wait(600); };
  window.__gaps = []; let last = performance.now();
  const tick = (t) => { if (t - last > 40) window.__gaps.push([+t.toFixed(0), +(t - last).toFixed(1)]); last = t; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  const t0 = performance.now();
  for (const s of poses) {
    if (m.isEasing && m.isEasing()) m.stop();
    m.jumpTo({ center: s.center, zoom: s.zoom, pitch: s.pitch, bearing: s.bearing });
    if (typeof s.p === 'number') window.applyTimeOfDay(m, s.p);
    await settle(5000);
  }
  // high to street level over the spawn point
  const c = poses[0].center;
  for (let z = 13; z <= 19.5; z += 0.5) { m.jumpTo({ center: c, zoom: z, pitch: 62, bearing: 90 }); await settle(3500); }
  // idle tail: anything still being painted shows up here
  await wait(3000);
  return { startedAt: t0, endedAt: performance.now() };
})`;

async function runOnce(throttle, qi, rep) {
  const label = `t${throttle}q${qi}-r${rep}`;
  const chrome = await startChrome({ gl: GL, width: 1280, height: 800, vsync: 'off', maxMs: MAX + 300000 });
  const page = await chrome.newPage();
  try {
    await page.send('Page.enable'); await page.send('Runtime.enable');
    const pageErrors = [];
    page.on('Runtime.exceptionThrown', e => { if (pageErrors.length < 8) pageErrors.push(((e.exceptionDetails && (e.exceptionDetails.exception && e.exceptionDetails.exception.description || e.exceptionDetails.text)) || '').slice(0, 300)); });
    page.on('Runtime.consoleAPICalled', e => { if (e.type === 'error' && pageErrors.length < 8) pageErrors.push('console.error ' + (e.args || []).map(a => String(a.value || a.description || '')).join(' ').slice(0, 300)); });
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1.5, mobile: false });
    if (throttle > 1) await page.send('Emulation.setCPUThrottlingRate', { rate: throttle });
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__PERF_CFG=${JSON.stringify({ wrap: [], autodetect: false })};` + INSTRUMENT });
    const url = URL0 + (URL0.includes('?') ? '&' : '?') + 'drift=0' + (QARMS[qi] ? '&' + QARMS[qi] : '');
    const tNav = Date.now();
    await page.send('Page.navigate', { url });
    for (;;) {
      await sleep(500);
      let st = null;
      try { st = JSON.parse((await page.send('Runtime.evaluate', { expression: 'JSON.stringify({m:window.__perf&&window.__perf.marks,now:performance.now()})', returnByValue: true })).result.value || 'null'); } catch (e) {}
      if (st && st.m && st.m.introReveal && st.now - st.m.introReveal >= SETTLE) break;
      if (Date.now() - tNav > MAX) { console.error(`[${label}] hit the ceiling before ready; last state ${JSON.stringify(st)}; page errors ${JSON.stringify(pageErrors)}`); throw new Error('no reveal'); }
    }
    const ev = async (expr) => (await page.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
    // listener timers are installed BEFORE the flight but AFTER the opening flight (which is the burst we are after): the
    // probe is for the cost of one addImage, which any later flat answer pays too
    const probed = await ev(PROBE);
    const flight = await ev(`${FLIGHT}(${JSON.stringify(POSES)}).then(r => JSON.stringify(r))`);
    // what one addImage costs on a settled page, and which styledata / data listeners it wakes
    await ev(`(async () => { const m = window.__map; const N = 20; for (const k in window.__listenerCost) { window.__listenerCost[k].n = 0; window.__listenerCost[k].ms = 0; }
      const t = performance.now(); for (let i = 0; i < N; i++) m.addImage('__probe' + i, { width: 8, height: 8, data: new Uint8Array(256) });
      window.__addProbe = { n: N, ms: performance.now() - t }; await new Promise(r => setTimeout(r, 50)); for (let i = 0; i < N; i++) m.removeImage('__probe' + i); return 1; })()`);
    const data = JSON.parse(await ev(`JSON.stringify({ addProbe: window.__addProbe,
      reveal: window.__perf.marks.introReveal, veilGone: window.__perf.marks.veilGone, wt: window.facadeWallTiersStats && window.facadeWallTiersStats(),
      gaps: window.__gaps, pace: window.__facadePace, listeners: window.__listenerCost, probed: null, nowMs: performance.now(), url: location.href })`));
    const res = { label, throttle, qi, query: QARMS[qi], rep, flight: JSON.parse(flight), machine: machineLoad(), chrome: chrome.version.product, ...data };
    fs.writeFileSync(path.join(OUT, `${label}.json`), JSON.stringify(res));
    return res;
  } finally { await chrome.close(); }
}

const results = [];
if (FROM) { for (const f of fs.readdirSync(FROM).sort()) if (/^t\d+q\d+-r\d+\.json$/.test(f)) results.push(JSON.parse(fs.readFileSync(path.join(FROM, f), 'utf8'))); }
else {
  const arms = [];
  for (const t of THROTTLES) for (let qi = 0; qi < QARMS.length; qi++) arms.push({ t, qi });
  for (let r = 1; r <= REPS; r++) {
    for (const a of (r % 2 ? arms : [...arms].reverse())) {
      const t0 = Date.now();
      try {
        const res = await runOnce(a.t, a.qi, r);
        results.push(res);
        const post = (res.wt.burstLog || []).filter(b => b[0] > res.reveal);
        console.error(`  ${res.label}: reveal ${Math.round(res.reveal)} ms, ${post.length} bursts after, longest ${Math.max(0, ...post.map(b => b[2]))} ms, ${Math.round((Date.now() - t0) / 1000)} s`);
      } catch (e) { console.error(`  t${a.t}q${a.qi}-r${r} FAILED: ${e.stack || e}`); }
    }
  }
}

// ---- report
const out = [];
const fmt = n => n == null ? '-' : String(Math.round(n * 10) / 10);
out.push('# post-reveal bursts');
out.push(`url ${URL0}  gl ${GL}  1280x800 at 1.5  ?drift=0  settle ${SETTLE} ms after reveal, then the ten cameras and a zoom 13 to 19.5  arms (extra query): ${QARMS.map((q, i) => `q${i}="${q}"`).join(' ')}`);
if (results[0]) out.push(`chrome ${results[0].chrome}`);
const stat = a => a.length ? `${fmt(Math.min(...a))} / ${fmt(med(a))} / ${fmt(Math.max(...a))}` : '-';
const keys = [...new Set(results.map(r => `${r.throttle}|${r.qi}`))].sort();
for (const k of keys) {
  const [t, qi] = k.split('|').map(Number);
  const rs = results.filter(r => r.throttle === t && r.qi === qi);
  const longMs = LONG[t] || 50;
  const rows = [
    ['bursts after the reveal (count)', r => r.wt.burstLog.filter(b => b[0] > r.reveal).length],
    ['images painted or answered after the reveal', r => r.wt.burstLog.filter(b => b[0] > r.reveal).reduce((s, b) => s + b[1], 0)],
    ['  of which answered flat (cap)', r => r.wt.burstLog.filter(b => b[0] > r.reveal).reduce((s, b) => s + b[3], 0)],
    ['longest burst after the reveal, ms', r => Math.max(0, ...r.wt.burstLog.filter(b => b[0] > r.reveal).map(b => b[2]))],
    ['most images in one burst after the reveal', r => Math.max(0, ...r.wt.burstLog.filter(b => b[0] > r.reveal).map(b => b[1]))],
    [`bursts over ${longMs} ms after the reveal`, r => r.wt.burstLog.filter(b => b[0] > r.reveal && b[2] > longMs).length],
    ['main thread spent in those bursts, ms', r => r.wt.burstLog.filter(b => b[0] > r.reveal).reduce((s, b) => s + b[2], 0)],
    ['longest burst BEFORE the reveal, ms (hidden by the veil)', r => Math.max(0, ...r.wt.burstLog.filter(b => b[0] <= r.reveal).map(b => b[2]))],
    ['longest frame gap during the flight, ms', r => Math.max(0, ...r.gaps.filter(g => g[0] >= r.flight.startedAt).map(g => g[1]))],
    ['frame gaps over 100 ms during the flight (count)', r => r.gaps.filter(g => g[0] >= r.flight.startedAt && g[1] > 100).length],
    ['city ready, ms', r => r.reveal],
  ];
  out.push(`\n## CPU throttle ${t}x, arm q${qi} "${rs[0]?.query || ''}", ${rs.length} reps (min / median / max)`);
  for (const [name, f] of rows) { const v = rs.map(r => { try { return f(r); } catch (e) { return null; } }).filter(x => x != null && isFinite(x)); out.push(`${name.padEnd(58)} ${stat(v)}   [${v.map(fmt).join(', ')}]`); }
  const worst = rs.map(r => r.wt.burstLog.filter(b => b[0] > r.reveal).sort((a, b) => b[2] - a[2]).slice(0, 3).map(b => `+${Math.round(b[0] - r.reveal)}ms: ${b[1]} img ${b[2]} ms (${b[3]} flat)`).join('; '));
  rs.forEach((r, i) => {
    if (r.addProbe) out.push(`  [r${i + 1}] one map.addImage of an 8x8 image on the settled page: ${fmt(r.addProbe.ms / r.addProbe.n)} ms (${r.addProbe.n} in a row); listeners it woke, ms per call: ` +
      Object.entries(r.listeners || {}).filter(([, v]) => v.n).sort((a, b) => b[1].ms - a[1].ms).slice(0, 6).map(([k, v]) => `${fmt(v.ms / Math.max(1, v.n))} ms x${v.n} ${k}`).join(' || '));
    out.push(`  [r${i + 1}] wall images: real paints ${r.wt.syncPainted} (${fmt(r.wt.syncMs)} ms), flat answers ${r.wt.placeholders} (${fmt(r.wt.flatMs)} ms), map.addImage inside them ${fmt(r.wt.addMs)} ms`);
    out.push(`  [r${i + 1}] images asked after the reveal (s after reveal, flat flag): ` + (r.wt.askLog || []).filter(a => a[0] > r.reveal).map(a => `${((a[0] - r.reveal) / 1000).toFixed(1)}:${a[1]}${a[2] ? '*' : ''}`).join(' '));
    const big = r.wt.burstLog.filter(b => b[0] > r.reveal && b[2] >= 20).map(b => `+${Math.round(b[0] - r.reveal)}ms ${b[1]}img ${b[2]}ms ${b[3]}flat`);
    out.push(`  [r${i + 1}] post-reveal bursts >= 20 ms (${big.length}): ${big.join(' | ')}; slowest single images ${JSON.stringify(r.wt.slow)}; frame gaps >100 ms: ${JSON.stringify(r.gaps.filter(g => g[1] > 100 && g[0] >= r.flight.startedAt).map(g => [Math.round(g[0] - r.reveal), g[1]]))}`);
  });
  out.push('three longest post-reveal bursts per rep: ' + worst.map((w, i) => `[r${i + 1}] ${w}`).join(' | '));
}
const text = out.join('\n');
fs.writeFileSync(path.join(OUT, 'report.txt'), text);
console.log(text);
process.exit(0);
