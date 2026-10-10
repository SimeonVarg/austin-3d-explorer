// Headless-Chrome benchmark of the same three builders. ONE browser at a time on this Mac, so run it through the lane gate:
//   node ~/Projects/astra-pipe/tools/gpu-run.mjs --label rust -- node bench-browser.mjs <streamDir> [rounds=7]
// NOGPU=1 launches Chrome with --disable-gpu (no WebGL, so no upload timing): a CPU-only page does not need a GPU slot.
// It serves this folder, the repo's js/slopes.js, and the stream folder from a tiny static server, then loads one page per
// implementation per round (cold JIT every time), interleaved, with real hardware GL for the upload timing.
import os from 'node:os'; import path from 'node:path';
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../../scripts/verify/package.json', import.meta.url))('playwright-core');   // installed by `cd scripts/verify && npm install`
import { launch, HW_ARGS, MARK_ARG } from '../../scripts/verify/chrome.mjs';
import { startServer } from './serve-lib.mjs';
const streamDir = path.resolve(process.argv[2]), rounds = Number(process.argv[3] || 7), impls = (process.argv[4] || 'app,typed,wasm').split(',');
const { server, base } = await startServer(streamDir);
const browser = await launch(chromium, { headless: true, maxMs: 3600000, args: [...(process.env.NOGPU ? ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] : HW_ARGS), '--js-flags=--max-old-space-size=8192', MARK_ARG] });
const rows = [];
for (let r = 0; r < rounds; r++) for (const impl of (r % 2 ? [...impls].reverse() : impls)) {
  const load = os.loadavg()[0];
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  await page.goto(`${base}/bench-browser.html?impl=${impl}&warm=2&upload=${!process.env.NOGPU && (r === 0 || impl === 'wasm') ? 1 : 0}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__result, null, { timeout: 600000, polling: 500 });
  const j = await page.evaluate(() => window.__result); j.round = r; j.load1 = +load.toFixed(1);
  await ctx.close(); rows.push(j);
  console.error(`round ${r} ${impl.padEnd(6)} ${j.error ? 'ERROR ' + j.error.slice(0, 200) : `cold ${j.cold.toFixed(0)} ms warm ${j.warms.map(w => w.toFixed(0)).join('/')}${j.upload ? ' upload ' + j.upload.map(u => u.toFixed(0)).join('/') : ''}`} load ${load.toFixed(1)}`);
}
await browser.close(); server.close();
const stat = a => { const s = a.filter(x => x != null).sort((x, y) => x - y); return s.length ? { min: s[0], median: s[s.length >> 1], max: s[s.length - 1], n: s.length } : null; };
const summary = {};
for (const impl of impls) { const m = rows.filter(r => r.impl === impl && !r.error); if (!m.length) continue;
  summary[impl] = { cold: stat(m.map(r => r.cold)), warm: stat(m.flatMap(r => r.warms)), compileMs: stat(m.map(r => r.compileMs)), instantiateMs: stat(m.map(r => r.instantiateMs)), copyInMs: stat(m.map(r => r.copyInMs)), processMs: stat(m.map(r => r.processMs)),
    uploadMs: stat(m.flatMap(r => r.upload || [])), uploadMB: m.find(r => r.uploadMB)?.uploadMB, jsHeapMB: stat(m.map(r => r.jsHeapMB)), wasmMiB: m.find(r => r.wasmMiB)?.wasmMiB, fetchMs: stat(m.map(r => r.fetchMs)) }; }
console.log(JSON.stringify({ host: `${os.arch()} laptop-class CPU x${os.cpus().length} threads`, ua: rows[0]?.ua, renderer: rows.find(r => r.renderer)?.renderer, rounds, summary, rows }, null, 1));
