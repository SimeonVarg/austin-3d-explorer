/**
 * facade-shader-bench.mjs - entry for the AWS GPU runner (and any machine with a quiet real GPU) for the graphics-basics study
 * (docs/graphics-basics-study-2026-10-10.md, experiments/facade-shader/README.md). Runs the facade-shader lab and the chip probe
 * against the page served at VERIFY_URL on the machine's real GPU. Exit code 0 unless a step crashed: a measurement, not a gate.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, '../..'), EXP = path.join(REPO, 'experiments/facade-shader');
const OUT = process.env.VERIFY_OUT || path.join(os.tmpdir(), 'facade-shader-bench-out');
fs.mkdirSync(OUT, { recursive: true });
const env = { ...process.env, VERIFY_GL: process.env.VERIFY_GL || 'hardware', RENDERER_OUT: fs.mkdtempSync(path.join(os.tmpdir(), 'fs-')) };
let failed = 0;
const step = (name, args) => { console.log(`\n##### ${name}`); const t = Date.now(); const r = spawnSync(process.execPath, args, { cwd: EXP, env, stdio: 'inherit', timeout: 25 * 60 * 1000 }); console.log(`##### ${name}: exit ${r.status} in ${Math.round((Date.now() - t) / 1000)} s`); if (r.status !== 0) failed++; };
step('verify-recipe (no GPU)', ['verify-recipe.mjs']);
step('selftest of the pattern maths (no GPU)', ['selftest.mjs']);
for (const f of (process.env.FS_STEPS || 'lab,probe').split(',')) {
  if (f === 'lab') step('lab: arm A (geometry) against arm B (shader)', ['run.mjs']);
  if (f === 'probe') step('probe: what limits this chip', ['probe.mjs']);
}
console.log('\nresults in', OUT, fs.readdirSync(OUT));
process.exit(failed ? 1 : 0);
