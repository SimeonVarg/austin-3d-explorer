/**
 * build-worker-parity.mjs — ?buildworker=1: the generator run in a WORKER, then replayed by the main thread, leaves the page exactly as building on the
 * main thread does, for all 198 buildings.
 *
 * Node only; needs three.js r159 OUTSIDE the repo (THREE_JS=/path/three.min.js; prints SKIP without it, so it is quarantined in ci/checks.json). Two children:
 *   direct   today's path on one thread (js/slopes-apartments.js buildOnce(), no worker).
 *   worker   a real node:worker_threads thread running the UNMODIFIED js/build-worker.js (through a thin adapter that gives it `self`, `importScripts` and
 *            postMessage with transfer) builds the mesh; then THIS process, which never ran the generator (empty registries), runs buildOnce() with the
 *            worker's result, exactly what the page does: the mesh from the transferred arrays, the registrations replayed, the building records,
 *            tallies, failures, facade-filter faces and cull starts taken from the list.
 * Both load the page's own js/wall-patterns.js, js/slopes.js, js/city-night.js, js/slopes-roofs.js and js/slopes-apartments.js. Compared: triangle counts, the
 * sha256 of all eight arrays, the tallies, the per-building records, the failed list, the registries (night profiles, fixtures, the wall-pattern texture's
 * bytes and row count), the cull starts and every facade-filter face (its wall frame sampled at three points).
 *
 *   THREE_JS=... node scripts/verify/build-worker-parity.mjs [--only "Moontower,The Standard,21 Rio"] [--break]
 *   --break  moves every footprint 2 m in the worker's input only: must report a difference and exit 1
 *   --unpacked  the plain layout (the shipped default is packed: tone and normal tables are compared too)
 *   --byterule reciprocal  the page's GPU multiplies by 1/255 (SwiftShader); the page hands its measurement to the worker, the tables must still be equal
 *   --byterule reciprocal --break-rule  the page does not hand it over: must report a difference and exit 1
 */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path'; import vm from 'node:vm'; import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const ci = argv.indexOf('--child');

if (!isMainThread) {
  // ── inside the worker thread: a browser worker's globals, then the real js/build-worker.js ──
  const { base, three, search } = workerData;
  globalThis.self = globalThis;
  const listeners = [];
  globalThis.addEventListener = (type, fn) => { if (type === 'message') listeners.push(fn); };
  globalThis.postMessage = (data, transfer) => parentPort.postMessage(data, transfer || []);
  globalThis.location = { search, href: base };
  const toPath = u => { u = String(u); return u.startsWith('file://') ? fileURLToPath(u) : u; };
  globalThis.importScripts = (...urls) => { for (const u of urls) vm.runInThisContext(fs.readFileSync(toPath(u), 'utf8'), { filename: toPath(u) }); };
  console.warn = console.log = console.info = () => {};
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node-worker' }, configurable: true });
  parentPort.on('message', data => { for (const fn of listeners) fn({ data }); });
  importScripts(path.join(REPO, 'js/build-worker.js'));
  parentPort.postMessage({ booted: true });
} else if (ci >= 0) {
  const mode = argv[ci + 1], BREAK = argv.includes('--break');
  const sha = a => crypto.createHash('sha256').update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest('hex');
  const out = o => { const b = Buffer.from('@@' + JSON.stringify(o) + '\n'); let off = 0; while (off < b.length) { try { off += fs.writeSync(1, b, off); } catch (e) { if (e.code !== 'EAGAIN') throw e; } } };
  const { loadApp } = await import(pathToFileURL(path.join(REPO, 'experiments/rust-mesh/profile/app-env.mjs')));
  const { A, specs, ctx } = await loadApp({});
  const B = ctx.__aptsBuild;
  // --byterule reciprocal: the page's GPU multiplies a normalised byte by 1/255 instead of dividing (SwiftShader does). A worker has no GL, so the page measures
  // the rule and hands the 256 floats over with the build message; both children here hold the same measurement, and a packed tone table must come out equal.
  const RULE = process.env.BYTE_RULE === 'reciprocal' ? Array.from({ length: 256 }, (_, c) => Math.fround(c * Math.fround(1 / 255))) : null;
  if (RULE) ctx.slopes.byteFloatsSet(RULE);
  const BREAK_RULE = process.env.BREAK_RULE === '1';   // --break-rule: the page does NOT hand the measurement over: the worker keeps the spec rule and the tone tables must differ
  // what the main thread's facade filter would be handed: the faces, with their wall frames sampled
  const faces = [];
  ctx.FacadeFilter = { planFaces({ faces: list }) { for (const f of list) faces.push({ len: f.len, z0: f.z0, z1: f.z1, at: [f.W.at(0.3, 0.1, 0.2), f.W.at(1.7, 0.4, 2.2), f.W.at(5.1, 0.9, 7.3)], T: f.W.T, N: f.W.N, rects: f.rects.map(r => [r[0], r[1], r[2], r[3], r[4].slice(), r[4].surface || null]) }); return null; } };
  let result = null, starts = [];
  if (mode === 'worker') {
    const keyOf = s => s.id || s.name;
    const wspecs = structuredClone(specs);
    if (BREAK) for (const sp of wspecs) for (const pt of sp.footprint.ring) pt[0] += 2e-5;
    const search = ctx.location.search.replace(/^\?/, '');
    const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { base: pathToFileURL(REPO + '/').href, three: pathToFileURL(process.env.THREE_JS).href, search: '?' + search } });
    const once = pred => new Promise((res, rej) => { const h = m => { if (m.error) { worker.off('message', h); rej(new Error(m.error)); } else if (pred(m)) { worker.off('message', h); res(m); } }; worker.on('message', h); });
    await once(m => m.booted);
    worker.postMessage({ init: { base: pathToFileURL(REPO + '/').href, three: pathToFileURL(process.env.THREE_JS).href } });
    await once(m => m.ready);
    worker.postMessage({ build: { specs: wspecs, gfxPreset: 'balanced', lite: null, facadeFilter: true, byteFloats: BREAK_RULE ? null : RULE } });
    result = (await once(m => m.done)).done;
    await worker.terminate();
    out({ progress: 'worker built', ms: result.ms });
  }
  const logCalls = [];
  const cn = ctx.CityNight, wp = ctx.WallPatterns;
  const o1 = cn.register, o2 = cn.registerFixtures, o3 = wp.register, key = s => s.id || s.name;
  cn.register = function (s) { logCalls.push({ op: 'nightProfile', key: key(s) }); return o1.apply(this, arguments); };
  cn.registerFixtures = function (s) { logCalls.push({ op: 'fixtures', key: key(s) }); return o2.apply(this, arguments); };
  wp.register = function (p, s) { logCalls.push({ op: 'wallPatterns', key: key(s) }); return o3.apply(this, arguments); };
  const g = await B.build(specs, undefined, result ? { fromWorker: result, noworker: true } : { noworker: true, starts });
  const meshes = []; g.traverse(o => { if (!o.isMesh) return; const gm = o.geometry, e = {}; for (const k in gm.attributes) e[k] = sha(gm.attributes[k].array); e.index = sha(gm.index.array); const pk = gm.userData && gm.userData.pack; if (pk) { e.packTones = sha(pk.tones.slice(0, pk.nTones * 16)); e.packNormals = sha(pk.normals.slice(0, pk.nNormals * 4)); e.nTones = pk.nTones; e.nNormals = pk.nNormals; } meshes.push(e); });
  const m = { uniforms: {} }; ctx.WallPatterns.attach(m);
  const count = JSON.parse(JSON.stringify(B.count)); delete count.ms; delete count.buildSlices; delete count.done;
  out({ mode, meshes, count, built: ctx.slopesApartments.built, failed: B.failed(), faces,
    calls: logCalls, starts: result ? result.starts : starts,
    state: { profiles: sha(Buffer.from(JSON.stringify([...cn.profiles.entries()]))), fixtures: sha(Buffer.from(JSON.stringify([...cn.fixtures.entries()]))), wallPatternRows: wp.size, wallPatternTexture: sha(m.uniforms.u_wallPatterns.value.image.data) }, workerMs: result && result.ms });
  process.exit(0);
} else {
  const THREE = process.env.THREE_JS;
  if (!THREE) { console.log('SKIP: set THREE_JS to three@0.159.0 build/three.min.js (https://unpkg.com/three@0.159.0/build/three.min.js); the repo does not carry it'); process.exit(0); }
  const oi = argv.indexOf('--only');
  const env = { ...process.env, REAL_NIGHT: '1', REAL_PATTERNS: '1', REAL_ROOFS: '1', FACADE_FILTER: '1' };   // the facade filter ON: its buildings hand the main thread faces to rasterise
  if (oi >= 0) env.ONLY = argv[oi + 1];
  // the shipped default is the PACKED layout (js/slopes.js PACK_DEFAULT_ON): the worker must build it, tone and normal tables included. --unpacked checks the plain layout.
  if (!argv.includes('--unpacked')) env.EXTRA_Q = (env.EXTRA_Q || '') + '&packverts=1';
  if (argv.includes('--break-rule')) env.BREAK_RULE = '1';
  const bi = argv.indexOf('--byterule'); if (bi >= 0) env.BYTE_RULE = argv[bi + 1];
  const run = mode => {
    const r = spawnSync(process.execPath, ['--max-old-space-size=10000', fileURLToPath(import.meta.url), '--child', mode, ...(argv.includes('--break') ? ['--break'] : [])], { env, encoding: 'utf8', maxBuffer: 1 << 29 });
    const line = (r.stdout || '').split('\n').find(l => l.startsWith('@@{"mode"'));
    if (!line) { console.log(`FAIL: the ${mode} run produced nothing\n${(r.stderr || '').slice(-800)}\n${(r.stdout || '').slice(-300)}`); process.exit(1); }
    return JSON.parse(line.slice(2));
  };
  const D = run('direct'), W = run('worker');
  let bad = 0; const say = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) bad++; };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  say(D.count.triangles === W.count.triangles, `${D.built.length} buildings built, ${D.count.triangles} triangles (worker ${W.count.triangles}; the worker took ${(W.workerMs / 1000).toFixed(1)} s in Node)`);
  if (!argv.includes('--unpacked')) say(D.meshes.length > 0 && D.meshes.every(m => m.aPack && m.packTones && m.nTones > 0), `the build is PACKED (an aPack attribute and tone/normal tables on every mesh: ${D.meshes.map(m => m.nTones + ' tones, ' + m.nNormals + ' normals').join('; ')})`);
  say(same(D.meshes, W.meshes), `the meshes are byte-identical (every array, the packed tone and normal tables too, sha256, ${D.meshes.length} mesh(es))`);
  say(same(D.count, W.count), 'the tallies (cells, faces, windows, roofs ... and the warnings) are equal');
  say(same(D.built, W.built), 'the per-building records are equal (name, id, top, roofs, rakes, signs, insets)');
  say(same(D.failed, W.failed), `the failed list is equal (${D.failed.length})`);
  say(same(D.calls, W.calls), `the main thread made the same registry calls in the same order (${D.calls.length})`);
  for (const k of Object.keys(D.state)) say(D.state[k] === W.state[k], `registry state equal: ${k}${typeof D.state[k] === 'number' ? ' = ' + D.state[k] : ''}`);
  say(same(D.starts, W.starts), `each building's first triangle is equal (${D.starts.length} starts)`);
  if (!same(D.faces, W.faces) && D.faces.length === W.faces.length) { const i = D.faces.findIndex((f, k) => !same(f, W.faces[k])); const f = D.faces[i], g = W.faces[i]; console.log(`  first differing face #${i}: ` + Object.keys(f).filter(k => !same(f[k], g[k])).map(k => k + ' ' + JSON.stringify(f[k]).slice(0, 160) + ' vs ' + JSON.stringify(g[k]).slice(0, 160)).join(' | ')); }
  say(same(D.faces, W.faces), `the facade-filter faces are equal, wall frames rebuilt on this side (${D.faces.length} faces)`);
  console.log(bad ? `\nFAIL: ${bad} difference(s)${argv.includes('--break') ? ' (--break: this is the expected result)' : ''}` : '\nPASS: the worker path leaves the page exactly as the main-thread build does');
  process.exit(bad ? 1 : 0);
}
