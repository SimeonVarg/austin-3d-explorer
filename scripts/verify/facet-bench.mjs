/** facet-bench.mjs - AWS GPU runner entry for experiments/facet: compile, run the no-GPU tests, then the lab sweep on the real GPU. Exit 0 unless a step crashed. */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url)), EXP = path.resolve(HERE, '../../experiments/facet');
const OUT = process.env.VERIFY_OUT || path.join(os.tmpdir(), 'facet-bench-out'); fs.mkdirSync(OUT, { recursive: true });
const env = { ...process.env, VERIFY_GL: process.env.VERIFY_GL || 'hardware', RENDERER_OUT: fs.mkdtempSync(path.join(os.tmpdir(), 'fc-')) };
let failed = 0;
const step = (name, args) => { console.log(`\n##### ${name}`); const r = spawnSync(process.execPath, args, { cwd: EXP, env, stdio: 'inherit', timeout: 25 * 60 * 1000 }); console.log(`##### ${name}: exit ${r.status}`); if (r.status !== 0) failed++; };
step('compile the Dobie tower', ['facetc.mjs', 'compile']);
step('refusal coverage over the catalog', ['facetc.mjs', 'refuse']);
step('facet selftest (no GPU)', ['selftest.mjs']);
step('lab: F against A, B and A4 over a distance sweep', ['run.mjs']);
console.log('\nresults in', OUT, fs.readdirSync(OUT)); process.exit(failed ? 1 : 0);
