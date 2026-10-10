/**
 * renderer-bench.mjs - entry point for the AWS GPU runner (and any machine) for the custom-renderer
 * study (docs/custom-renderer-study-2026-10-09.md, experiments/renderer/README.md).
 *
 * Runs, in order, against the page served at VERIFY_URL on the machine's real GPU:
 *   1. dump-apartments.mjs   the built geometry of the authored apartments -> scratch (not the repo, not the results)
 *   2. pack.mjs              the packed format + the meshopt wire size
 *   3. measure-app.mjs       draw calls / state changes / frame time of the app, with and without three.js
 *   4. compare.mjs           the app against the prototype, ten cameras (standalone page, then inside MapLibre),
 *                            and once with the prototype deliberately broken
 * Only small JSON and PNG files are copied to VERIFY_OUT (what the runner uploads); the binaries stay in scratch.
 * Exit code is 0 unless a step crashed: this is a measurement, not a gate.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const EXP = path.join(REPO, 'experiments/renderer');
const OUT = process.env.VERIFY_OUT || path.join(os.tmpdir(), 'renderer-bench-out');
const SCRATCH = process.env.RENDERER_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'renderer-'));
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(SCRATCH, { recursive: true });
const env = { ...process.env, RENDERER_OUT: SCRATCH, RENDERER_NOVSYNC: '1', VERIFY_GL: process.env.VERIFY_GL || 'hardware' };
let failed = 0;
const step = (name, cmd, args, opts = {}) => {
  console.log(`\n##### ${name}`); const t = Date.now();
  const r = spawnSync(cmd, args, { cwd: opts.cwd || EXP, env, stdio: 'inherit', timeout: 25 * 60 * 1000 });
  console.log(`##### ${name}: exit ${r.status} in ${Math.round((Date.now() - t) / 1000)} s`);
  if (r.status !== 0) failed++;
  return r.status === 0;
};
console.log('renderer-bench: VERIFY_URL', process.env.VERIFY_URL, 'scratch', SCRATCH, 'out', OUT, 'GL', env.VERIFY_GL);
step('npm install (meshoptimizer, for the wire-size step)', 'npm', ['install', '--no-audit', '--no-fund']);
// the MapLibre variant of the prototype page loads the same library files the app does; fetch them once into scratch/libs
try {
  fs.mkdirSync(path.join(SCRATCH, 'libs'), { recursive: true });
  for (const [f, u] of [['maplibre-gl.js', 'maplibre-gl@5.24.0/dist/maplibre-gl.js'], ['maplibre-gl.css', 'maplibre-gl@5.24.0/dist/maplibre-gl.css'], ['three.min.js', 'three@0.159.0/build/three.min.js'], ['pmtiles.js', 'pmtiles@3.0.6/dist/pmtiles.js']]) {
    const r = await fetch('https://unpkg.com/' + u); if (r.ok) fs.writeFileSync(path.join(SCRATCH, 'libs', f), Buffer.from(await r.arrayBuffer()));
  }
} catch (e) { console.log('could not fetch the libraries (the MapLibre variant will not run):', String(e).slice(0, 120)); }
if (step('dump', process.execPath, ['dump-apartments.mjs'])) {
  step('pack', process.execPath, ['pack.mjs']);
  step('measure-app', process.execPath, ['measure-app.mjs', '--out', path.join(SCRATCH, 'measure-app.json')]);
  step('compare (app + standalone prototype)', process.execPath, ['compare.mjs']);
  step('compare (prototype inside MapLibre)', process.execPath, ['compare.mjs', '--mode', 'maplibre', '--phase', 'proto']);
  step('compare (prototype, wire form: meshopt + brotli)', process.execPath, ['compare.mjs', '--phase', 'proto', '--format', 'meshopt']);
  step('compare (prototype broken on purpose: light)', process.execPath, ['compare.mjs', '--break', 'light', '--phase', 'proto']);
  step('compare (prototype broken on purpose: quant)', process.execPath, ['compare.mjs', '--break', 'quant', '--phase', 'proto']);
  step('compare (prototype broken on purpose: facet)', process.execPath, ['compare.mjs', '--break', 'facet', '--phase', 'proto']);
}
// copy the small results out
const keep = f => /\.(json|png|log)$/.test(f) && !/apartments\.(packed\.)?json$/.test(f);
const copy = (dir, rel = '') => { for (const f of fs.readdirSync(dir)) { const p = path.join(dir, f); const st = fs.statSync(p); if (st.isDirectory()) { if (f !== 'libs') copy(p, path.join(rel, f)); } else if (keep(f) && st.size < 6e6) { fs.mkdirSync(path.join(OUT, rel), { recursive: true }); fs.copyFileSync(p, path.join(OUT, rel, f)); } } };
copy(SCRATCH);
console.log('\nresults copied to', OUT, fs.readdirSync(OUT));
process.exit(failed ? 1 : 0);
