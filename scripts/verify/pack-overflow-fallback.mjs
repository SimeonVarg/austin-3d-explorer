/**
 * pack-overflow-fallback.mjs — a packed build whose tone or normal table overflows is rebuilt UNPACKED, the buildings are all there, and one console line says so.
 *
 * Node only; needs three.js r159 outside the repo (THREE_JS=...; SKIP without it, so it is quarantined in ci/checks.json: run it by hand). The real generator
 * (the page's own night, wall-pattern and roof modules) builds three buildings in three child processes:
 *   plain       no switch                           -> the unpacked layout (the reference)
 *   packed      ?packverts=1                        -> the packed layout (aPack, no normal/colour attributes)
 *   overflow    ?packverts=1&packtonebits=4         -> 16 tones is not enough: js/slopes.js throws a packOverflow error, js/slopes-apartments.js builds this one
 *                                                      unpacked: the same triangles and the same position bytes as `plain`, exactly one overflow line on the console
 * (packtonebits is a test seam; the shipped value is 14, 16,384 tones, against the 14,719 the real catalog uses.)
 *   THREE_JS=... node scripts/verify/pack-overflow-fallback.mjs [--break]     --break leaves the overflow arm at 14 bits: no overflow, so the check must fail
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
if (argv.includes('--child')) {
  const sha = a => crypto.createHash('sha256').update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest('hex');
  const { loadApp } = await import(pathToFileURL(path.join(REPO, 'experiments/rust-mesh/profile/app-env.mjs')));
  const { A, specs, ctx } = await loadApp({});
  const warns = []; ctx.console.warn = (...a) => warns.push(a.join(' '));
  const g = await A.build(specs);
  const meshes = []; g.traverse(o => { if (o.isMesh) meshes.push(o.geometry); });
  fs.writeSync(1, '@@' + JSON.stringify({ meshes: meshes.length, packed: !!meshes[0].userData.pack, attrs: Object.keys(meshes[0].attributes), tris: A.count.triangles, position: sha(meshes[0].attributes.position.array), index: sha(meshes[0].index.array), overflowLines: warns.filter(w => /distinct (tones|normals).*unpacked/.test(w)).length }) + '\n');
  process.exit(0);
}
if (!process.env.THREE_JS) { console.log('SKIP: set THREE_JS to three@0.159.0 build/three.min.js (https://unpkg.com/three@0.159.0/build/three.min.js); the repo does not carry it'); process.exit(0); }
const run = extra => {
  const r = spawnSync(process.execPath, ['--max-old-space-size=4096', fileURLToPath(import.meta.url), '--child'], { env: { ...process.env, REAL_NIGHT: '1', REAL_PATTERNS: '1', REAL_ROOFS: '1', ONLY: 'Moontower,The Standard,21 Rio', EXTRA_Q: extra }, encoding: 'utf8' });
  const line = (r.stdout || '').split('\n').find(l => l.startsWith('@@'));
  if (!line) { console.log('FAIL: a child produced nothing\n' + (r.stderr || '').slice(-500)); process.exit(1); }
  return JSON.parse(line.slice(2));
};
const plain = run(''), packed = run('&packverts=1'), over = run('&packverts=1&packtonebits=' + (argv.includes('--break') ? 14 : 4));
let bad = 0; const say = (ok, m) => { console.log((ok ? 'PASS ' : 'FAIL ') + m); if (!ok) bad++; };
say(!plain.packed && plain.attrs.includes('normal'), 'no switch: the unpacked layout');
say(packed.packed && packed.attrs.join() === 'position,aPack' && packed.tris === plain.tris && packed.position === plain.position, `?packverts=1: the packed layout (position + aPack), the same ${packed.tris} triangles and position bytes`);
say(!over.packed && over.attrs.includes('normal') && over.attrs.includes('cNight'), 'a table that overflows: the build is UNPACKED (normal and colour attributes are back)');
say(over.tris === plain.tris && over.position === plain.position && over.index === plain.index, `and it is the same mesh as the plain build: ${over.tris} triangles, position and index bytes equal, nothing missing`);
say(over.overflowLines === 1, `and the console said so exactly once (${over.overflowLines} line)`);
console.log(bad ? `\nFAIL: ${bad}${argv.includes('--break') ? ' (--break: this is the expected result)' : ''}` : '\nPASS: an overflowing packed build falls back to the unpacked layout');
process.exit(bad ? 1 : 0);
