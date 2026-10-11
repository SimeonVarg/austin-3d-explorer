/**
 * facet-app-bench.mjs - AWS runner entry for the in-app Facet flag: pictures and memory off | on (facet-app.mjs), then the moire meter with the
 * flag off and on (moire-meter.mjs --q facadeshader=0|1), FACET_METER_REPS times each, interleaved. One browser at a time. Exit 0 unless a step crashed: a measurement, not a gate.
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
// --meter-reps N (or FACET_METER_REPS) meter runs per flag, interleaved off|on|off|on... so a slow drift of the machine hits both arms; run 0 keeps the old names (meter0, meter1), the others are meter0-r1, meter1-r1, ...
const argRep = process.argv.indexOf('--meter-reps'), REPS = +(argRep >= 0 ? process.argv[argRep + 1] : (process.env.FACET_METER_REPS || '1'));
if (only.includes('meter')) for (let r = 0; r < REPS; r++) for (const f of [0, 1]) { const tag = `meter${f}${r ? '-r' + r : ''}`; step(`moire meter, facadeshader=${f}${r ? ' (repeat ' + r + ')' : ''}`, ['moire-meter.mjs', '--out', path.join(OUT, tag), '--q', 'facadeshader=' + f, '--views', process.env.FACET_METER_VIEWS || 'west-far,west-mid,drag-mid', '--json', path.join(OUT, `${tag}.json`)], { VERIFY_MAX_MS: '3000000' }); }
console.log('\nresults in', OUT, fs.readdirSync(OUT)); process.exit(failed ? 1 : 0);
