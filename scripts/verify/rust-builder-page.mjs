/**
 * rust-builder-page.mjs — the REAL page, the JS vertex store against the Rust one (?rustbuilder=1), interleaved.
 *
 * LAPTOP ONLY (timing; listed under laptop_only in ci/checks.json). The byte-for-byte proof that the two builders make the
 * same buffers is wasm-mesh-parity.mjs, which needs no browser; THIS script is about speed, so it loads index.html (not the
 * harness page) in a fresh headless Chrome per run, on the real GPU, and reads what the app itself reports.
 *
 *   node ~/Projects/astra-pipe/tools/gpu-run.mjs --label rustwire -- \
 *     env VERIFY_URL=http://127.0.0.1:8478 node scripts/verify/rust-builder-page.mjs [runs=5] [modes=off,on] [--out file.json]
 *
 * PER RUN (one fresh browser each, so a warm JIT or cache never carries over; modes alternate off,on / on,off / ...):
 *   count.ms       slopesApartments.count.ms: what the app itself calls the authored-building build, including the time it
 *                  waits for its turn on the main thread between 12 ms slices (the owner's "29 s")
 *   builtAt        performance.now() when count.ms first existed (the page's clock starts at navigation)
 *   readyAt        performance.now() when the opening veil began to lift (window.__intro.reason set): "city ready"
 *   heapPeak       peak performance.memory.usedJSHeapSize, sampled every sampleMs (--enable-precise-memory-info). Typed arrays
 *                  live OUTSIDE the JS heap, and so does Wasm memory: read it next to rssPeak
 *   rssPeak        peak resident memory of the whole browser process tree (ps), sampled every rssSampleMs. Includes the GPU process.
 *   geomSha        sha256 of all eight arrays of every apartments mesh, so a "faster" run that built something else is caught
 * The spread of each is printed (min / median / max): other lanes share this Mac, so the minimum is the number to quote.
 */
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { BASE, launch, HW_ARGS, MARK_ARG } from './chrome.mjs';

const PARAMS = {
  query: 'intro=0&drift=0&namelabels=0&facadepace=0&timeofdaypace=0',   // the deterministic page the pictures use; no opening flight to steal the main thread
  viewport: { width: 1440, height: 900 }, dpr: 1,
  sampleMs: 50, rssSampleMs: 400,
  waitReadyMs: 420000,                // one run's ceiling for the build to finish and the veil to lift
  settleMs: 3000,                     // after both, so the last memory peak is seen
  modes: {
    off: '',
    on: '&rustbuilder=1',
    reserve: '&rustbuilder=1&rustreserve=6523203',   // the Rust builder told the vertex count (the study: 650 MiB of linear memory -> 357 MiB)
    // the phone profile is a different script (mobile-memory.mjs); this one is the desktop page
  },
};
const argv = process.argv.slice(2);
const flag = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const pos = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--out');
const RUNS = Number(pos[0] || 5);
const MODES = (pos[1] || 'off,on').split(',');
const OUT = flag('--out');

const stats = a => { const s = [...a].sort((x, y) => x - y); return { min: s[0], median: s[s.length >> 1], max: s[s.length - 1] }; };
const fmt = (a, d = 0) => { const s = stats(a); return `${s.min.toFixed(d)} / ${s.median.toFixed(d)} / ${s.max.toFixed(d)}`; };

function treeRssMb(rootPid) {
  try {
    const rows = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,rss='], { encoding: 'utf8' }).trim().split('\n').map(l => l.trim().split(/\s+/).map(Number));
    const kids = new Map(); for (const [pid, ppid, rss] of rows) { if (!kids.has(ppid)) kids.set(ppid, []); kids.get(ppid).push([pid, rss]); }
    const own = new Map(rows.map(r => [r[0], r[2]]));
    let total = 0; const stack = [rootPid];
    while (stack.length) { const p = stack.pop(); total += own.get(p) || 0; for (const [c] of kids.get(p) || []) stack.push(c); }
    return total / 1024;
  } catch (e) { return 0; }
}

async function one(mode, run) {
  const browser = await launch(chromium, {
    maxMs: PARAMS.waitReadyMs + 120000,
    args: [...HW_ARGS, '--enable-precise-memory-info', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', MARK_ARG],
  });
  const pid = browser.process()?.pid;
  let rssPeak = 0;
  const rssTimer = setInterval(() => { const m = treeRssMb(pid); if (m > rssPeak) rssPeak = m; }, PARAMS.rssSampleMs);
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: PARAMS.viewport, deviceScaleFactor: PARAMS.dpr });
    page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
    await page.addInitScript(({ sampleMs }) => {
      const rb = window.__rb = { heapPeak: 0, readyAt: null, builtAt: null };
      setInterval(() => {
        const m = performance.memory; if (m && m.usedJSHeapSize > rb.heapPeak) rb.heapPeak = m.usedJSHeapSize;
        const now = performance.now();
        if (rb.readyAt === null && window.__intro && window.__intro.reason) rb.readyAt = now;
        const c = window.slopesApartments && window.slopesApartments.count;
        if (rb.builtAt === null && c && c.ms > 0) rb.builtAt = now;
      }, sampleMs);
    }, { sampleMs: PARAMS.sampleMs });
    const url = `${BASE}/index.html?${PARAMS.query}${PARAMS.modes[mode]}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 180000 });
    await page.waitForFunction(() => window.cancelGraphicsAutoDetect, null, { timeout: 120000 }).catch(() => {});
    await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
    await page.waitForFunction(() => window.__rb.builtAt !== null && window.__rb.readyAt !== null, null, { timeout: PARAMS.waitReadyMs, polling: 250 });
    await page.waitForTimeout(PARAMS.settleMs);
    const r = await page.evaluate(async () => {
      const A = window.slopesApartments, c = A.count, rb = window.__rb;
      const sha = async a => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(a.buffer, a.byteOffset, a.byteLength)))].map(b => b.toString(16).padStart(2, '0')).join('');
      let parts = [], tris = 0, bytes = 0;
      const group = (window.slopes.root ? window.slopes.root.children : []).find(g => g.name === 'slopes-apartments');
      if (group) for (const o of group.children) {
        const g = o.geometry; if (!g || !g.index || !g.attributes.cDay) continue;
        for (const k of ['position', 'normal', 'cDay', 'cGold', 'cNight', 'aFacet', 'aSurface']) { const a = g.attributes[k].array; if (a) { parts.push(await sha(a)); bytes += a.byteLength; } }
        parts.push(await sha(g.index.array)); bytes += g.index.array.byteLength; tris += g.index.count / 3;
      }
      return { countMs: c.ms, slices: c.buildSlices, triangles: c.triangles, builtAt: rb.builtAt, readyAt: rb.readyAt, heapPeakMb: rb.heapPeak / 1048576,
        rust: window.slopes.rustInfo(), geomBytesMb: bytes / 1048576, geomTris: tris, geomSha: parts.length ? await sha(new TextEncoder().encode(parts.join(''))) : null,
        gfx: window.GFX && window.GFX.preset };
    });
    r.mode = mode; r.run = run; r.rssPeakMb = rssPeak; r.errors = errors.slice(0, 5);
    return r;
  } finally { clearInterval(rssTimer); await browser.__done(); }
}

const results = [];
console.log(`${RUNS} runs per mode, modes ${MODES.join(' / ')}, interleaved; ${BASE}/index.html?${PARAMS.query}[mode]`);
for (let r = 0; r < RUNS; r++) {
  const order = r % 2 ? [...MODES].reverse() : MODES;
  for (const m of order) {
    const t0 = Date.now();
    try {
      const x = await one(m, r);
      results.push(x);
      console.log(`run ${r} ${m.padEnd(7)} count.ms ${String(x.countMs).padStart(8)}  builtAt ${(x.builtAt / 1000).toFixed(1)}s  readyAt ${(x.readyAt / 1000).toFixed(1)}s  heapPeak ${x.heapPeakMb.toFixed(0)} MB  rssPeak ${x.rssPeakMb.toFixed(0)} MB  tris ${x.triangles}  sha ${String(x.geomSha).slice(0, 10)}  rust ${x.rust.state}${x.errors.length ? '  ERRORS ' + x.errors.join(' | ') : ''}  (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    } catch (e) { console.log(`run ${r} ${m}: FAILED ${e.message.split('\n')[0]}`); results.push({ mode: m, run: r, failed: e.message.split('\n')[0] }); }
  }
}
if (OUT) fs.writeFileSync(OUT, JSON.stringify({ params: PARAMS, runs: results }, null, 1));
console.log('\nmin / median / max over the runs that finished (other lanes share this machine; quote the minimum)');
for (const m of MODES) {
  const rs = results.filter(x => x.mode === m && !x.failed);
  if (!rs.length) { console.log(m.padEnd(8) + ' no finished runs'); continue; }
  console.log(`${m.padEnd(8)} n=${rs.length}  count.ms ${fmt(rs.map(x => x.countMs))}   builtAt s ${fmt(rs.map(x => x.builtAt / 1000), 1)}   readyAt s ${fmt(rs.map(x => x.readyAt / 1000), 1)}   heapPeak MB ${fmt(rs.map(x => x.heapPeakMb))}   rssPeak MB ${fmt(rs.map(x => x.rssPeakMb))}   geometry ${[...new Set(rs.map(x => x.geomSha && x.geomSha.slice(0, 10)))].join(',')}`);
}
const shas = new Set(results.filter(x => !x.failed).map(x => x.geomSha));
console.log(shas.size === 1 ? 'every run built the identical geometry (sha256 of all eight arrays)' : `GEOMETRY DIFFERS between runs: ${[...shas].join(' ')}`);
process.exit(shas.size === 1 ? 0 : 1);
