/**
 * perf-trees-ab.mjs: the campus trees drawn the plain way against drawn as instances, cold loads interleaved.
 *
 * Not a check: it has no verdict (listed under laptop_only in ci/checks.json). It runs on the AWS GPU runner
 * (scripts/aws-gpu) or on the laptop, one arm after the other, never in parallel:
 *   --pictures      first run scripts/verify/campus-trees-pictures.mjs (the ten cameras + two close-ups, plain vs instanced)
 *   --reps N        cold loads per arm (default 5); arms alternate  A B  B A  A B ...
 *   --throttle R    Chrome CPU throttle on the page main thread (1 = none, 4 = a phone-class stand-in; workers not slowed)
 *   --settle MS     wait after "city ready" (default 6000, load-profile's own)
 * Each load is scripts/perf/load-profile.mjs, one fresh Chrome with an empty cache, ?drift=0, auto-detect cancelled, 1280x800
 * at device ratio 1.5, and the arm is the query switch ?treeinstancing=0 (plain) or nothing (instanced).
 * Prints, per arm, min / median / max of the load marks and of what the planting reports about itself
 * (campusLandscape.count: treeMs, buildMs, triangles, bytes, meshes) and of the page's WebGL buffer bytes and draw calls.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const OUT = process.env.VERIFY_OUT || '/tmp/perf-trees-ab';
const URLB = process.env.VERIFY_URL || 'http://127.0.0.1:8481';
const REPS = +arg('--reps', 5), THROTTLE = +arg('--throttle', 1), SETTLE = arg('--settle', '6000');
const ARMS = [['plain', 'drift=0&treeinstancing=0'], ['instanced', 'drift=0']];
fs.mkdirSync(OUT, { recursive: true });

if (argv.includes('--pictures')) {
  console.log('\n===== pictures: plain vs instanced, same page =====');
  spawnSync('node', [path.join(HERE, 'campus-trees-pictures.mjs'), '--out', path.join(OUT, 'pictures')], { stdio: 'inherit', env: process.env, cwd: HERE });
}

console.log(`\n===== cold loads: ${REPS} per arm, throttle ${THROTTLE}x, settle ${SETTLE} ms, url ${URLB} =====`);
for (let rep = 0; rep < REPS; rep++) {
  const order = rep % 2 ? [...ARMS].reverse() : ARMS;
  for (const [name, query] of order) {
    const dir = path.join(OUT, name);
    const r = spawnSync('node', [path.join(HERE, '../perf/load-profile.mjs'), '--url', URLB + '/', '--throttle', String(THROTTLE), '--reps', '1', '--rep-offset', String(rep),
      '--query', query, '--settle', SETTLE, '--label', name, '--out', dir], { stdio: 'inherit', env: process.env, cwd: HERE });
    if (r.status) console.log(`[${name} rep ${rep}] exit ${r.status}`);
  }
}

const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const fmt = (v, d = 0) => v == null ? '-' : (+v).toFixed(d);
const rows = [
  ['CITY READY (veil lifts), ms', r => r.marks.introReveal, 0],
  ['apartments build done, ms', r => r.marks.apartmentsDone, 0],
  ['planting: tree build, ms (campusLandscape.count.treeMs)', r => r.landscape?.treeMs, 1],
  ['planting: whole build, ms (count.buildMs)', r => r.landscape?.buildMs, 1],
  ['planting: triangles drawn per frame', r => r.landscape?.triangles, 0],
  ['planting: triangles built in JS (trees only)', r => r.landscape?.treeBuiltTriangles, 0],
  ['planting: array bytes in JS (whole group), MB', r => r.landscape?.bytes / 2 ** 20, 2],
  ['planting: array bytes, trees only, MB', r => r.landscape?.treeBytes / 2 ** 20, 2],
  ['planting: meshes (draw calls from the group)', r => r.landscape?.meshes, 0],
  ['long tasks over 50 ms: total, ms', r => r.long.reduce((s, x) => s + x[1], 0), 0],
  ['longest task, ms', r => Math.max(0, ...r.long.map(x => x[1])), 0],
  ['script time (CDP ScriptDuration), ms', r => r.cdpMetrics.ScriptDuration * 1000, 0],
  ['WebGL buffer bytes at the end, MB', r => r.gl.buf / 2 ** 20, 1],
  ['WebGL peak buffer bytes, MB', r => r.gl.peak.buf / 2 ** 20, 1],
  ['JS heap used, MB', r => r.heap && r.heap.usedSize / 2 ** 20, 0],
];
console.log('\n# trees plain vs instanced: min / median / max over the cold loads (per arm), machine load average noted');
const byArm = {};
for (const [name] of ARMS) {
  byArm[name] = fs.existsSync(path.join(OUT, name)) ? fs.readdirSync(path.join(OUT, name)).filter(f => /^t\d+-r\d+\.json$/.test(f)).map(f => JSON.parse(fs.readFileSync(path.join(OUT, name, f), 'utf8'))) : [];
  console.log(`${name}: ${byArm[name].length} loads; load average before each: ${byArm[name].map(r => r.machine.before.load1).join(', ')}`);
}
for (const [label, f, d] of rows) {
  const cells = ARMS.map(([name]) => {
    const v = byArm[name].map(r => { try { return f(r); } catch (e) { return null; } }).filter(x => x != null && isFinite(x));
    return v.length ? `${fmt(Math.min(...v), d)} / ${fmt(med(v), d)} / ${fmt(Math.max(...v), d)}` : '-';
  });
  console.log(label.padEnd(60), ARMS.map(([n], i) => `${n}: ${cells[i]}`).join('   '));
}
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(Object.fromEntries(ARMS.map(([n]) => [n, byArm[n].map(r => ({ marks: r.marks, landscape: r.landscape, gl: r.gl, machine: r.machine, long: r.long.length }))])), null, 1));
