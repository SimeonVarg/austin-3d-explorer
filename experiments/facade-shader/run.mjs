/**
 * run.mjs - drive page/index.html in a real-GPU Chrome and write the numbers and pictures.
 *
 *   VERIFY_URL=http://127.0.0.1:<port> VERIFY_GL=hardware VERIFY_OUT=<dir> node experiments/facade-shader/run.mjs [--views a,b] [--no-perf] [--no-quality] [--quick]
 *
 * VERIFY_URL is a server whose root is the repo (scripts/serve.py does it; the AWS runner sets it). Without VERIFY_URL a
 * tiny built-in server is started on the repo root. Frame times are only meaningful with VERIFY_GL=hardware; the script
 * says so in its output when it is not. Do NOT run this on a machine whose graphics chip is shared with other work.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium, launch } from '../renderer/lib/app.mjs';
import { glArgsFor } from '../../scripts/verify/chrome.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, '../..');
const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; }, flag = k => argv.includes(k);
const OUT = process.env.VERIFY_OUT || path.join(os.tmpdir(), 'facade-shader-out');
fs.mkdirSync(OUT, { recursive: true });
const HW = (process.env.VERIFY_GL || 'swiftshader') === 'hardware';
const QUICK = flag('--quick');

let base = process.env.VERIFY_URL, server = null;
if (!base) {
  const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.gz': 'application/octet-stream' };
  server = http.createServer((req, res) => { const f = path.join(REPO, decodeURIComponent(req.url.split('?')[0])); if (!f.startsWith(REPO) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); base = 'http://127.0.0.1:' + server.address().port;
}
console.log('facade-shader run: page at', base, '| GL', HW ? 'HARDWARE' : 'software (pictures only: frame times are NOT valid)', '| out', OUT);

const args = [...glArgsFor(HW ? 'hardware' : undefined), '--disable-gpu-vsync', '--disable-frame-rate-limit', '--enable-webgl-developer-extensions', '--enable-webgl-draft-extensions'];
const browser = await launch(chromium, { gl: HW ? 'hardware' : undefined, maxMs: 30 * 60 * 1000, args });
const page = await (await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 })).newPage();
const errors = []; page.on('pageerror', e => errors.push(String(e).slice(0, 300))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
const result = { when: new Date().toISOString(), hardware: HW, quality: {}, perf: {} };
try {
  await page.goto(base + '/experiments/facade-shader/page/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__labReady, null, { timeout: 120000 });
  result.info = await page.evaluate(() => window.__lab.info()); result.stats = await page.evaluate(() => window.__lab.stats());
  console.log('GL', JSON.stringify(result.info)); console.log('stats', JSON.stringify(result.stats));
  const want = (opt('--views', '') || '').split(',').filter(Boolean);
  const views = (await page.evaluate(() => window.__lab.views.map(v => v.name))).filter(n => !want.length || want.includes(n));
  const fmt = x => (x == null ? '-' : x);
  if (!flag('--no-quality')) {
    for (const name of views) {
      const t = Date.now();
      const r = await page.evaluate(n => window.__lab.quality(n, {}), name);
      if (r.picture) { fs.writeFileSync(path.join(OUT, `quality-${name}.png`), Buffer.from(r.picture.split(',')[1], 'base64')); delete r.picture; }
      result.quality[name] = r;
      const a = r.arms;
      console.log(`${name.padEnd(12)} ${r.mPerPx} m/px, ${r.bayPx} px/bay, ${r.pixels.interiorPct}% facade px | err mean A ${a.A.err.mean} B ${a.B.err.mean} A4x ${a.A4.err.mean} | detail A ${a.A.errDetail.mean} B ${a.B.errDetail.mean} | band A ${a.A.band} B ${a.B.band} | flicker A ${a.A.flicker.mean} B ${a.B.flicker.mean} A4x ${a.A4.flicker.mean} | B vs truth(A) ${r.cross['B vs truth(A)'].mean} | ${((Date.now() - t) / 1000).toFixed(0)} s`);
    }
  }
  if (!flag('--no-perf')) {
    const city = { name: 'city', dist: 650, el: 30, az: 200, tz: 30 };
    const scenes = [
      { id: '1 tower, 1440x900', W: 1440, H: 900, towers: 1, viewName: 'mid-230m', parts: 'facade' },
      { id: '1 tower close, 1440x900', W: 1440, H: 900, towers: 1, viewName: 'near-110m', parts: 'facade' },
      { id: '100 towers (city of 4.2M triangles), 1440x900', W: 1440, H: 900, towers: 100, view: city, parts: 'facade' },
      { id: '100 towers, 3840x2160', W: 3840, H: 2160, towers: 100, view: city, parts: 'facade' },
      { id: '100 towers + podiums, 1440x900', W: 1440, H: 900, towers: 100, view: city, parts: 'all' },
      { id: '100 towers, 640x400', W: 640, H: 400, towers: 100, view: city, parts: 'facade' },
    ];
    for (const s of (QUICK ? scenes.slice(2, 4) : scenes)) {
      const r = await page.evaluate(o => window.__lab.perf(o), { ...s, reps: QUICK ? 3 : 7, frames: 20 });
      result.perf[s.id] = r;
      console.log(`${s.id.padEnd(48)} covered ${r.coveredPct}% | tris A ${r.trianglesA} B ${r.trianglesB} | wall min ms A ${r.A.wallMin} B ${r.B.wallMin} | GPU timer min ms A ${fmt(r.A.gpuMin)} B ${fmt(r.B.gpuMin)}`);
    }
  }
} catch (e) { console.log('RUN FAILED', e); result.error = String(e); }
result.errors = errors.slice(0, 10);
fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(result, null, 1));
console.log('errors', JSON.stringify(result.errors));
await browser.__done?.(); server && server.close();
process.exit(result.error ? 1 : 0);
