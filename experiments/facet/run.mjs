/**
 * run.mjs - the Facet lab on a real GPU: arm F (the compiler's shader) against A (geometry), B (the hand-written shader) and A4 (4x MSAA geometry),
 * over a camera DISTANCE SWEEP, then the budget. Writes sweep.json, budget.json, result.json and pictures to VERIFY_OUT.
 *   VERIFY_URL=<server rooted at the repo> VERIFY_GL=hardware VERIFY_OUT=<dir> node experiments/facet/run.mjs [--gate 1.5]
 * Use the AWS runner (scripts/verify/facet-bench.mjs); never a shared laptop chip.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium, launch } from '../renderer/lib/app.mjs';
import { glArgsFor } from '../../scripts/verify/chrome.mjs';
import { budget } from './lib/facet.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, '../..');
const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const OUT = process.env.VERIFY_OUT || path.join(os.tmpdir(), 'facet-out'); fs.mkdirSync(OUT, { recursive: true });
const HW = (process.env.VERIFY_GL || 'swiftshader') === 'hardware', GATE = +opt('--gate', '1.5');
let base = process.env.VERIFY_URL, server = null;
if (!base) { server = http.createServer((req, res) => { const f = path.join(REPO, decodeURIComponent(req.url.split('?')[0])); if (!f.startsWith(REPO) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' }[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); }); await new Promise(r => server.listen(0, '127.0.0.1', r)); base = 'http://127.0.0.1:' + server.address().port; }
console.log('facet run: page at', base, '| GL', HW ? 'HARDWARE' : 'software (frame times NOT valid)', '| gate', GATE);
const args = [...glArgsFor(HW ? 'hardware' : undefined), '--disable-gpu-vsync', '--disable-frame-rate-limit', '--enable-webgl-developer-extensions'];
const browser = await launch(chromium, { gl: HW ? 'hardware' : undefined, maxMs: 30 * 60 * 1000, args });
const page = await (await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 })).newPage();
const errors = []; page.on('pageerror', e => errors.push(String(e).slice(0, 400))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 400)); });
const result = { when: new Date().toISOString(), hardware: HW, gate: GATE }; let code = 0;
try {
  await page.goto(base + '/experiments/facet/page/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__facetReady, null, { timeout: 120000 });
  result.info = await page.evaluate(() => window.__lab.info()); result.facet = await page.evaluate(() => window.__lab.facet); result.stats = await page.evaluate(() => window.__lab.stats());
  console.log('GL', result.info.renderer); console.log('facet', JSON.stringify(result.facet));
  const DISTS = [40, 55, 80, 110, 160, 230, 330, 500, 700, 1100, 1600];
  const PICS = new Set([55, 230, 500]);
  const rows = [];
  for (const d of DISTS) {
    const view = { name: 'sweep-' + d, dist: d, el: 20, az: 200, tz: 42 };
    const r = await page.evaluate(([v, pic]) => window.__lab.qualityView(v, { arms: ['A', 'B', 'F', 'A4'], pictures: pic, pictureArms: ['A', 'F'] }), [view, PICS.has(d)]);
    if (r.picture) { fs.writeFileSync(path.join(OUT, `sweep-${d}m.png`), Buffer.from(r.picture.split(',')[1], 'base64')); delete r.picture; }
    const a = r.arms, c = r.cross;
    rows.push({ dist: d, bayPx: r.bayPx, mPerPx: r.mPerPx, interiorPct: r.pixels.interiorPct, errA: a.A.err.mean, errB: a.B.err.mean, errF: a.F.err.mean, errNear: a.A4.err.mean, flickA: a.A.flicker.mean, flickB: a.B.flicker.mean, flickF: a.F.flicker.mean, flickNear: a.A4.flicker.mean, bandF: a.F.band, bandNear: a.A4.band, FvsB: c['F vs B (the compiler against the hand-written shader)'].mean, FvsA4: c['F vs A4 (the switch)'].mean, FvsTruthA: c['F vs truth(A)'].mean });
    console.log(`d ${String(d).padStart(5)} m  ${r.bayPx} px/bay | err A ${a.A.err.mean} B ${a.B.err.mean} F ${a.F.err.mean} A4 ${a.A4.err.mean} | flicker A ${a.A.flicker.mean} F ${a.F.flicker.mean} A4 ${a.A4.flicker.mean} | F vs B ${rows.at(-1).FvsB} | F vs A4 ${rows.at(-1).FvsA4}`);
  }
  result.sweep = rows; fs.writeFileSync(path.join(OUT, 'sweep.json'), JSON.stringify(rows, null, 1));
  const b = budget(rows.map(r => ({ dist: r.dist, bayPx: r.bayPx, errF: r.errF, errNear: r.errNear, flickF: r.flickF, flickNear: r.flickNear })), GATE);
  result.budget = b; fs.writeFileSync(path.join(OUT, 'budget.json'), JSON.stringify(b, null, 1));
  console.log(`BUDGET gate ${GATE}: worst error ratio F / A4 ${b.worstRatioErr.toFixed(2)}, worst flicker ratio ${b.worstRatioFlick.toFixed(2)}; ${b.note}`);
  // hybrid: geometry with MSAA at or below the switch distance, the shader wall beyond it
  const sw = b.switchBayPx == null ? (b.pass ? 0 : Infinity) : b.switchBayPx;   // pass: shader everywhere; no clean split: report only
  const hyb = rows.map(r => ({ dist: r.dist, uses: r.bayPx > sw ? 'geometry 4x MSAA' : 'Facet shader wall', err: r.bayPx > sw ? r.errNear : r.errF, flick: r.bayPx > sw ? r.flickNear : r.flickF, errNear: r.errNear, popAtSwitch: r.FvsA4 }));
  result.hybrid = hyb; console.log('hybrid:', JSON.stringify(hyb.map(h => [h.dist, h.uses, h.err])));
  // frame time for the compiler's shader against the hand-written one and the geometry, a city of 100 towers
  const city = { name: 'city', dist: 650, el: 30, az: 200, tz: 30 };
  result.perf = await page.evaluate(o => window.__lab.perf(o), { W: 1440, H: 900, towers: 100, view: city, parts: 'facade', arms: ['A', 'B', 'F'], reps: 7, frames: 20 });
  const p = result.perf; console.log(`perf 100 towers 1440x900 (GPU timer ms): A ${p.A.gpuMin} B ${p.B.gpuMin} F ${p.F.gpuMin}`);
  result.overdraw = null;
} catch (e) { console.log('RUN FAILED', e); result.error = String(e); code = 1; }
result.errors = errors.slice(0, 10); console.log('errors', JSON.stringify(result.errors));
fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(result, null, 1));
await browser.__done?.(); server && server.close(); process.exit(code);
