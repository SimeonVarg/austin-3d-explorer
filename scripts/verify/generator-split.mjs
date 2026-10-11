/**
 * generator-split.mjs — the apartment generator's SPLIT is a pure refactor: the geometry it makes and what it registers do not change.
 *
 * js/slopes-apartments.js buildingOne() used to do three things inline besides emitting the mesh: register the building's night profile
 * (js/city-night.js), its wall patterns (js/wall-patterns.js; this also writes each patterned material's surface row back into the palette, so the
 * MESH depends on it) and its night fixtures. They now go through `B.registrations`, which can record them as plain data ({ op, key } in order), so
 * a Web Worker can run the pure half and the main thread can replay the list. This check proves the two ways of running it agree, for ALL 198 buildings.
 *
 * Node only; needs three.js r159 OUTSIDE the repo (THREE_JS=/path/three.min.js; prints SKIP without it, so it is quarantined in ci/checks.json).
 * Two child processes, each loads the page's own js/slopes.js, js/city-night.js, js/wall-patterns.js, js/slopes-apartments.js:
 *   direct   today's path: the generator calls the registries itself.  Records: sha256 of all eight arrays, the log of registry calls, the registry state.
 *   split    the pure pass writes the list (`build(specs, undefined, { record })`); then the registries are replaced by FRESH ones (what a main thread that
 *            never ran the generator has) and the list is replayed with applyRegistrations().  Records the same three things from the replay.
 * PASS when the two meshes are byte-identical, the recorded list equals the direct call log (content and order), the replay's calls equal it too,
 * and the registry state after the replay (night profiles, fixtures, the wall-pattern texture's bytes and row count) equals the direct one.
 *
 *   THREE_JS=... node scripts/verify/generator-split.mjs [--only "Moontower,The Standard"] [--break]
 *   --break  drops one recorded registration before the replay: must report a difference and exit 1
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path'; import vm from 'node:vm'; import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const ci = argv.indexOf('--child');

if (ci >= 0) {
  const mode = argv[ci + 1], BREAK = argv.includes('--break');
  const sha = a => crypto.createHash('sha256').update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest('hex');
  const out = o => { const b = Buffer.from('@@' + JSON.stringify(o) + '\n'); let off = 0; while (off < b.length) { try { off += fs.writeSync(1, b, off); } catch (e) { if (e.code !== 'EAGAIN') throw e; } } };   // a large line must be written whole before process.exit
  const { loadApp } = await import(pathToFileURL(path.join(REPO, 'experiments/rust-mesh/profile/app-env.mjs')));
  const { A, specs, ctx } = await loadApp({});
  const B = ctx.__aptsBuild;
  const keyOf = s => s.id || s.name;
  const log = [];
  const wrap = () => {   // log every registry call as { op, key }
    const cn = ctx.CityNight, wp = ctx.WallPatterns, o1 = cn.register, o2 = cn.registerFixtures, o3 = wp.register;
    cn.register = function (spec) { log.push({ op: 'nightProfile', key: keyOf(spec) }); return o1.apply(this, arguments); };
    cn.registerFixtures = function (spec) { log.push({ op: 'fixtures', key: keyOf(spec) }); return o2.apply(this, arguments); };
    wp.register = function (p, spec) { log.push({ op: 'wallPatterns', key: keyOf(spec) }); return o3.apply(this, arguments); };
  };
  const state = () => {
    const m = { uniforms: {} }; ctx.WallPatterns.attach(m);
    return { profiles: sha(Buffer.from(JSON.stringify([...ctx.CityNight.profiles.entries()]))), fixtures: sha(Buffer.from(JSON.stringify([...ctx.CityNight.fixtures.entries()]))),
      wallPatternRows: ctx.WallPatterns.size, wallPatternTexture: sha(m.uniforms.u_wallPatterns.value.image.data) };
  };
  const meshes = g => { const r = []; g.traverse(o => { if (!o.isMesh) return; const gm = o.geometry, e = {}; for (const k in gm.attributes) e[k] = sha(gm.attributes[k].array); e.index = sha(gm.index.array); r.push(e); }); return r; };
  if (mode === 'direct') {
    wrap();
    const g = await B.build(specs);
    out({ mode, meshes: meshes(g), called: log, state: state(), tris: B.count.triangles, buildings: specs.length });
  } else {
    const rec = [];
    const g = await B.build(specs, undefined, { record: rec });
    const m = meshes(g), tris = B.count.triangles;
    // a main thread that never ran the generator: new, empty registries
    const R = n => vm.runInThisContext(fs.readFileSync(path.join(REPO, 'js', n), 'utf8'), { filename: n });
    ctx.WallPatterns = undefined; R('wall-patterns.js'); ctx.CityNight = undefined; R('city-night.js');
    wrap();
    const list = BREAK ? rec.filter((e, i) => i !== Math.floor(rec.length / 2)) : rec;
    B.applyRegistrations(list, specs);
    out({ mode, meshes: m, recorded: rec, called: log, state: state(), tris, buildings: specs.length });
  }
  process.exit(0);
} else {
  const THREE = process.env.THREE_JS;
  if (!THREE) { console.log('SKIP: set THREE_JS to three@0.159.0 build/three.min.js (https://unpkg.com/three@0.159.0/build/three.min.js); the repo does not carry it'); process.exit(0); }
  const oi = argv.indexOf('--only');
  const env = { ...process.env, REAL_NIGHT: '1', REAL_PATTERNS: '1', REAL_ROOFS: '1' };
  if (oi >= 0) env.ONLY = argv[oi + 1];
  const run = mode => {
    const r = spawnSync(process.execPath, ['--max-old-space-size=8192', fileURLToPath(import.meta.url), '--child', mode, ...(argv.includes('--break') ? ['--break'] : [])], { env, encoding: 'utf8', maxBuffer: 1 << 28 });
    const line = (r.stdout || '').split('\n').find(l => l.startsWith('@@'));
    if (!line) { console.log(`FAIL: the ${mode} run produced nothing\n${(r.stderr || '').slice(-600)}`); process.exit(1); }
    return JSON.parse(line.slice(2));
  };
  const D = run('direct'), S = run('split');
  let bad = 0; const say = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) bad++; };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  say(D.buildings === S.buildings && D.tris === S.tris, `${D.buildings} buildings, ${D.tris} triangles (split ${S.tris})`);
  say(same(D.meshes, S.meshes), `the meshes are byte-identical (all eight arrays, sha256, ${D.meshes.length} mesh(es))`);
  say(same(D.called, S.recorded), `the recorded list equals the direct run's registry calls in content and order (${D.called.length} entries)`);
  say(same(D.called, S.called), 'the replay makes the same registry calls in the same order');
  for (const k of Object.keys(D.state)) say(D.state[k] === S.state[k], `registry after the replay equals the direct one: ${k}${typeof D.state[k] === 'number' ? ' = ' + D.state[k] : ''}`);
  console.log(bad ? `\nFAIL: ${bad} difference(s)${argv.includes('--break') ? ' (--break: this is the expected result)' : ''}` : '\nPASS: the split changes nothing');
  process.exit(bad ? 1 : 0);
}
