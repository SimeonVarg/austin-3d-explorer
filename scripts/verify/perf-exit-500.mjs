// The reviewer's end-to-end case for the perf tools: a local server that answers 500 for the main script, the REAL tool in a REAL
// Chrome, and the exit code must be non-zero. (The no-browser half of this is perf-outcome.mjs.)
//
// NEEDS CHROME. Written on 2026-10-10 on a Mac that could not start a browser, so it has NEVER BEEN RUN: it is listed under
// "quarantine" in ci/checks.json until someone runs it once and deletes that line. The page it serves is a stub with no city in it, so
// the wait for the reveal can only end at the ceiling (--max 6000 ms); software GL is enough.
//
//   node scripts/verify/perf-exit-500.mjs        exit 0 = load-profile and apartment-buffers both exited non-zero on the broken page
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/js/')) { res.writeHead(500, { 'content-type': 'text/plain' }); res.end('server error'); return; }   // the main script: 500
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<!doctype html><title>stub</title><script src="/js/app.js"></script><body>stub</body>');
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;
let failed = 0;
const say = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) failed++; };
const out = () => fs.mkdtempSync(path.join(os.tmpdir(), 'perf500-'));
for (const [script, args] of [
  ['scripts/perf/load-profile.mjs', ['--reps', '1', '--throttle', '1', '--gl', 'swiftshader', '--require-idle', '0', '--settle', '0', '--max', '6000']],
  ['scripts/perf/apartment-buffers.mjs', ['--gl', 'swiftshader', '--max', '6000']],
]) {
  const r = spawnSync(process.execPath, [path.join(REPO, script), '--url', url, ...args, '--out', out()], { encoding: 'utf8', timeout: 240000 });
  say(r.status !== 0 && r.status !== null, `${path.basename(script)} against a page whose main script answers 500: exit ${r.status}${r.status === 0 ? ' (an error became a result again)' : ''}`);
}
server.close();
process.exit(failed ? 1 : 0);
