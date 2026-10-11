/**
 * probe.mjs - run page/probe.html on a real GPU and print what limits the chip. Same environment variables as run.mjs.
 * Run it on a QUIET machine: a chip shared with other drawing work reads slower in every row, and the result is meaningless.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium, launch } from '../renderer/lib/app.mjs';
import { glArgsFor } from '../../scripts/verify/chrome.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, '../..');
const OUT = process.env.VERIFY_OUT || path.join(os.tmpdir(), 'facade-shader-out'); fs.mkdirSync(OUT, { recursive: true });
const HW = (process.env.VERIFY_GL || 'swiftshader') === 'hardware';
let base = process.env.VERIFY_URL, server = null;
if (!base) { server = http.createServer((req, res) => { const f = path.join(REPO, decodeURIComponent(req.url.split('?')[0])); if (!f.startsWith(REPO) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html' : 'text/javascript' }); fs.createReadStream(f).pipe(res); }); await new Promise(r => server.listen(0, '127.0.0.1', r)); base = 'http://127.0.0.1:' + server.address().port; }
const args = [...glArgsFor(HW ? 'hardware' : undefined), '--disable-gpu-vsync', '--disable-frame-rate-limit'];
const browser = await launch(chromium, { gl: HW ? 'hardware' : undefined, maxMs: 15 * 60 * 1000, args });
const page = await (await browser.newContext({ viewport: { width: 800, height: 600 } })).newPage();
const errors = []; page.on('pageerror', e => errors.push(String(e).slice(0, 300))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
let code = 0;
try {
  await page.goto(base + '/experiments/facade-shader/page/probe.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__probeReady, null, { timeout: 8 * 60 * 1000 });
  const r = await page.evaluate(() => window.__probe);
  console.log('probe on', r.renderer, HW ? '(hardware)' : '(software: not valid)');
  for (const [k, v] of Object.entries(r.tests)) console.log(k.padEnd(52), JSON.stringify(v));
  console.log('app workload estimate', JSON.stringify(r.appWorkloadEstimate));
  fs.writeFileSync(path.join(OUT, 'probe.json'), JSON.stringify(r, null, 1));
} catch (e) { console.log('PROBE FAILED', e, errors); code = 1; }
await browser.__done?.(); server && server.close(); process.exit(code);
