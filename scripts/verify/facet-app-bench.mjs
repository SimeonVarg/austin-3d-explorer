/**
 * facet-app-bench.mjs - AWS runner entry for the in-app Facet flag: pictures and memory off | on (facet-app.mjs), then the moire meter with the
 * flag off and on (moire-meter.mjs --q facadeshader=0|1). One browser at a time. Exit 0 unless a step crashed: a measurement, not a gate.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.VERIFY_OUT || path.join(os.tmpdir(), 'facet-app-bench-out'); fs.mkdirSync(OUT, { recursive: true });
let failed = 0;
const step = (name, args, env = {}) => { console.log(`\n##### ${name}`); const t = Date.now(); const r = spawnSync(process.execPath, args, { cwd: HERE, env: { ...process.env, ...env }, stdio: 'inherit', timeout: 40 * 60 * 1000 }); console.log(`##### ${name}: exit ${r.status} in ${Math.round((Date.now() - t) / 1000)} s`); if (r.status !== 0) failed++; };
const only = (process.env.FACET_STEPS || 'app,meter').split(',');
if (only.includes('app')) step('pictures and memory, flag off | on', ['facet-app.mjs', '--out', path.join(OUT, 'app')]);
if (only.includes('meter')) for (const f of [0, 1]) step(`moire meter, facadeshader=${f}`, ['moire-meter.mjs', '--out', path.join(OUT, 'meter' + f), '--q', 'facadeshader=' + f, '--views', process.env.FACET_METER_VIEWS || 'west-far,west-mid,drag-mid', '--json', path.join(OUT, `meter${f}.json`)], { VERIFY_MAX_MS: '3000000' });
console.log('\nresults in', OUT, fs.readdirSync(OUT)); process.exit(failed ? 1 : 0);
