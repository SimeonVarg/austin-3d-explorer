// Whole-generator build inside headless Chrome, interleaved real / timed / null pages. One browser at a time on this Mac:
//   THREE_JS=/path/three.min.js node ~/Projects/astra-pipe/tools/gpu-run.mjs --label rust -- node bench-browser-build.mjs [rounds=5] [modes=real,timed,null]
// (or NOGPU=1 node bench-browser-build.mjs ...: a CPU-only page needs no GPU slot)
import os from 'node:os'; import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../../scripts/verify/package.json', import.meta.url))('playwright-core');   // installed by `cd scripts/verify && npm install`
import { launch, HW_ARGS, MARK_ARG } from '../../scripts/verify/chrome.mjs';
import { startServer } from './serve-lib.mjs';
const rounds = Number(process.argv[2] || 5), modes = (process.argv[3] || 'real,timed,null').split(',');
const { server, base } = await startServer(null);
const browser = await launch(chromium, { headless: true, maxMs: 3600000, args: [...(process.env.NOGPU ? ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] : HW_ARGS), '--js-flags=--max-old-space-size=8192', MARK_ARG] });
const rows = [];
for (let r = 0; r < rounds; r++) for (const mode of (r % 2 ? [...modes].reverse() : modes)) {
  const load = os.loadavg()[0]; const ctx = await browser.newContext(); const page = await ctx.newPage();
  await page.goto(`${base}/bench-browser-build.html?mode=${mode}&reps=3`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__result, null, { timeout: 900000, polling: 1000 });
  const j = await page.evaluate(() => window.__result); j.round = r; j.load1 = +load.toFixed(1); await ctx.close(); rows.push(j);
  console.error(`round ${r} ${mode.padEnd(5)} ${j.error ? 'ERROR ' + j.error.slice(0, 300) : j.runs.map(x => x.ms.toFixed(0) + (x.triangles !== 3113629 && j.mode !== 'null' ? ' !TRIANGLES ' + x.triangles : '') + (x.builderMs != null ? ' (builder ' + x.builderMs.toFixed(0) + ')' : '')).join(' / ') + ' ms'} load ${load.toFixed(1)}`);
}
await browser.close(); server.close();
const mins = m => { const a = rows.filter(r => r.mode === m && !r.error).flatMap(r => r.runs.map(x => x.ms)).sort((x, y) => x - y); return a.length ? { min: a[0], median: a[a.length >> 1], max: a.at(-1), n: a.length } : null; };
const shares = rows.filter(r => r.mode === 'timed' && !r.error).flatMap(r => r.runs.map(x => x.builderMs / x.ms)).sort((a, b) => a - b);
console.log(JSON.stringify({ host: `${os.arch()} laptop-class CPU x${os.cpus().length} threads`, ua: rows[0]?.ua, rounds, modes: Object.fromEntries(modes.map(m => [m, mins(m)])), builderShareOfBuild: shares.length ? { min: shares[0], median: shares[shares.length >> 1], max: shares.at(-1) } : null, rows }, null, 1));
