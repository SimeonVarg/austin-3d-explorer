/**
 * build-worker-page.mjs — in the REAL page: does the generator + builder in a Web Worker finish sooner than the page's own time-sliced build,
 * and are its bytes the same?
 *
 * LAPTOP ONLY (timing). The page builds the authored buildings on the main thread as usual. As soon as the page has fetched the catalog
 * (slopesApartments.data) this script starts js/build-worker.js with the same specs, so the two builds RUN AT THE SAME TIME under the same load;
 * it then reports when each finished and compares the sha256 of all eight arrays of the worker's mesh against the page's own mesh.
 *   count.ms        the page's build, as the app reports it            workerMs   the worker's build, inside the worker
 *   workerDoneAt    performance.now() when the worker's result reached the page    builtAt   when the page's build finished
 * This is NOT ?buildworker=1: the worker's result is only measured and hashed, never shown. What the page would still have to do on its own thread
 * for a real hand-off (the generator's side effects: wall patterns, night profiles, each building's frame, the facade filter list) is in the PR.
 *
 *   node ~/Projects/astra-pipe/tools/gpu-run.mjs --label rustwire -- env VERIFY_URL=http://127.0.0.1:PORT node scripts/verify/build-worker-page.mjs [runs=3]
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { BASE, launch, glArgsFor, MARK_ARG } from './chrome.mjs';
const PARAMS = { query: 'intro=0&drift=0&namelabels=0&facadepace=0&timeofdaypace=0', viewport: { width: 1440, height: 900 }, waitMs: 1500000 };
const argv = process.argv.slice(2);
const RUNS = Number(argv.find(a => /^\d+$/.test(a)) || 3);
const oi = argv.indexOf('--out'), OUT = oi >= 0 ? argv[oi + 1] : null;

async function one(run) {
  const browser = await launch(chromium, { maxMs: PARAMS.waitMs + 120000, args: [...glArgsFor(process.env.VERIFY_GL || 'hardware'), '--enable-precise-memory-info', MARK_ARG] });
  try {
    const page = await browser.newPage({ viewport: PARAMS.viewport });
    const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
    await page.goto(`${BASE}/index.html?${PARAMS.query}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
    await page.evaluate(() => { window.__w = { startedAt: null, doneAt: null, res: null, err: null, builtAt: null }; });
    await page.evaluate(() => {
      const w = window.__w;
      const poll = setInterval(() => {
        const A = window.slopesApartments, now = performance.now();
        if (w.builtAt === null && A && A.count.ms > 0 && A.group) w.builtAt = now;
        if (w.startedAt !== null || !(A && A.data && A.data.buildings && window.THREE)) return;
        w.startedAt = now; clearInterval(poll);
        const flags = new URLSearchParams(location.search); flags.set('slopes', '0'); flags.set('facadefilter', '0');
        const worker = new Worker('js/build-worker.js?' + flags.toString());
        worker.onerror = e => { w.err = 'worker error: ' + (e.message || e); };
        worker.onmessage = ev => {
          const m = ev.data;
          if (m.error) w.err = m.error;
          else if (m.ready) worker.postMessage({ build: true });
          else if (m.done) { w.doneAt = performance.now(); w.res = m.done; worker.terminate(); }
        };
        worker.postMessage({ init: { base: location.href.replace(/[^/]*([?#].*)?$/, ''), three: document.querySelector('script[src*="three"]').src, gfxPreset: window.GFX && window.GFX.preset, specs: A.data.buildings } });
      }, 50);
    });
    await page.waitForFunction(() => { const w = window.__w; return w.err || (w.doneAt !== null && w.builtAt !== null); }, null, { timeout: PARAMS.waitMs, polling: 500 });
    const r = await page.evaluate(async () => {
      const w = window.__w, A = window.slopesApartments;
      if (w.err) return { err: w.err };
      const sha = async a => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(a.buffer, a.byteOffset, a.byteLength)))].map(b => b.toString(16).padStart(2, '0')).join('');
      const mainSha = [], workSha = [], names = ['position', 'normal', 'cDay', 'cGold', 'cNight', 'aFacet', 'aSurface'];
      let mainTris = 0;
      A.group.traverse(o => { if (o.geometry && o.geometry.index && o.geometry.attributes.cDay) mainTris += o.geometry.index.count / 3; });
      const mm = []; A.group.traverse(o => { if (o.geometry && o.geometry.index && o.geometry.attributes.cDay) mm.push(o.geometry); });
      for (const g of mm) { for (const k of names) mainSha.push(await sha(g.attributes[k].array)); mainSha.push(await sha(g.index.array)); }
      for (const m of w.res.meshes) { for (const k of names) workSha.push(await sha(m.attributes[k].array)); workSha.push(await sha(m.index)); }
      const same = mainSha.length === workSha.length && mainSha.every((x, i) => x === workSha[i]);
      return { countMs: A.count.ms, builtAt: w.builtAt, startedAt: w.startedAt, workerDoneAt: w.doneAt, workerMs: w.res.ms, workerTris: w.res.meshes.reduce((s, m) => s + m.index.length / 3, 0), mainTris, same, meshes: [mm.length, w.res.meshes.length] };
    });
    r.run = run; r.errors = errors.slice(0, 3);
    return r;
  } finally { await browser.__done(); }
}
const results = [];
for (let i = 0; i < RUNS; i++) {
  try { const r = await one(i); results.push(r); console.log(r.err ? `run ${i}: FAILED ${r.err.slice(0, 300)}` : `run ${i}: page count.ms ${r.countMs}  built at ${(r.builtAt / 1000).toFixed(1)} s | worker started ${(r.startedAt / 1000).toFixed(1)} s, ran ${(r.workerMs / 1000).toFixed(1)} s, result in page at ${(r.workerDoneAt / 1000).toFixed(1)} s | triangles page ${r.mainTris} worker ${r.workerTris} | bytes identical: ${r.same}${r.errors.length ? '  errors: ' + r.errors.join(' | ') : ''}`); }
  catch (e) { console.log(`run ${i}: FAILED ${e.message.split('\n')[0]}`); results.push({ run: i, failed: e.message.split('\n')[0] }); }
}
if (OUT) fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
const ok = results.filter(r => r.same !== undefined);
const mn = a => Math.min(...a);
if (ok.length) console.log(`\nmin over ${ok.length} run(s): page count.ms ${mn(ok.map(r => r.countMs))}, worker ${mn(ok.map(r => r.workerMs)).toFixed(0)} ms, worker started at ${(mn(ok.map(r => r.startedAt)) / 1000).toFixed(1)} s; bytes identical in every run: ${ok.every(r => r.same)}`);
process.exit(ok.length && ok.every(r => r.same) ? 0 : 1);
