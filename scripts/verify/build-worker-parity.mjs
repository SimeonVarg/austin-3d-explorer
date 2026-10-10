/**
 * build-worker-parity.mjs — the apartment generator + builder run in a WORKER (js/build-worker.js) make the same bytes as on the main thread.
 *
 * Node only, no browser. It needs three.js r159 (the file index.html loads from unpkg) OUTSIDE the repo: THREE_JS=/path/three.min.js. Without it
 * the check says so and exits 0 (a skip, printed as SKIP; it is listed under quarantine in ci/checks.json for that reason).
 *
 * The worker is a real Node worker_thread running the UNMODIFIED js/build-worker.js, through a thin adapter that gives the thread what a browser
 * worker has (`self`, `importScripts`, `postMessage` with transfer): so js/build-worker.js, js/slopes.js, js/city-night.js and
 * js/slopes-apartments.js are the very files the page would load. The reference is the same generator run in this process (profile/app-env.mjs,
 * with the real city-night.js: REAL_NIGHT=1). Compared: triangle count, and the sha256 of all eight arrays of every mesh.
 *
 *   THREE_JS=... node scripts/verify/build-worker-parity.mjs [--only "Moontower,The Standard,21 Rio"] [--full] [--break]
 *   --break  moves every footprint 2 m in the worker's input only: must report MISMATCH and exit 1
 */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import fs from 'node:fs'; import path from 'node:path'; import vm from 'node:vm'; import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

if (!isMainThread) {
  // ── inside the worker thread: a browser worker's globals, then the real js/build-worker.js ──
  const { base, three } = workerData;
  globalThis.self = globalThis;
  const listeners = [];
  globalThis.addEventListener = (type, fn) => { if (type === 'message') listeners.push(fn); };
  globalThis.postMessage = (data, transfer) => parentPort.postMessage(data, transfer || []);
  globalThis.location = { search: '?slopes=0&facadefilter=0', href: base };
  const toPath = u => { u = String(u); return u.startsWith('file://') ? fileURLToPath(u) : u; };
  globalThis.importScripts = (...urls) => { for (const u of urls) vm.runInThisContext(fs.readFileSync(toPath(u), 'utf8'), { filename: toPath(u) }); };
  console.warn = console.log = console.info = () => {};
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node-worker' }, configurable: true });
  parentPort.on('message', data => { for (const fn of listeners) fn({ data }); });
  importScripts(path.join(REPO, 'js/build-worker.js'));
  parentPort.postMessage({ booted: true });
} else {
  const THREE = process.env.THREE_JS;
  if (!THREE) { console.log('SKIP: set THREE_JS to three@0.159.0 build/three.min.js (https://unpkg.com/three@0.159.0/build/three.min.js); this check needs it and the repo does not carry it'); process.exit(0); }
  const argv = process.argv.slice(2), BREAK = argv.includes('--break'), FULL = argv.includes('--full');
  const oi = argv.indexOf('--only');
  process.env.ONLY = FULL ? '' : (oi >= 0 ? argv[oi + 1] : 'Moontower,The Standard,21 Rio');
  if (!process.env.ONLY) delete process.env.ONLY;
  process.env.REAL_NIGHT = '1';
  const sha = a => crypto.createHash('sha256').update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest('hex');
  const out = (...a) => process.stdout.write(a.join(' ') + '\n');
  const { loadApp } = await import(pathToFileURL(path.join(REPO, 'experiments/rust-mesh/profile/app-env.mjs')));

  // the worker first (it must not see this process's globals): same specs, as plain data
  const { catalog } = await import(pathToFileURL(path.join(REPO, 'experiments/rust-mesh/profile/app-patch.mjs')));
  let specs = await catalog(async f => JSON.parse(fs.readFileSync(path.join(REPO, f), 'utf8')));
  if (process.env.ONLY) { const keep = process.env.ONLY.split(','); specs = specs.filter(s => keep.includes(s.name)); }
  const workerSpecs = structuredClone(specs);
  if (BREAK) for (const sp of workerSpecs) for (const pt of sp.footprint.ring) pt[0] += 2e-5;   // about 2 m east, every footprint, the worker's input only
  const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { base: pathToFileURL(REPO + '/').href, three: THREE } });
  const once = pred => new Promise((res, rej) => { const h = m => { if (m.error) { worker.off('message', h); rej(new Error(m.error)); } else if (pred(m)) { worker.off('message', h); res(m); } }; worker.on('message', h); });
  await once(m => m.booted);
  worker.postMessage({ init: { base: pathToFileURL(REPO + '/').href, three: pathToFileURL(THREE).href, gfxPreset: 'balanced', specs: workerSpecs } });
  await once(m => m.ready);
  worker.postMessage({ build: true });
  const done = (await once(m => m.done)).done;
  await worker.terminate();
  const wMeshes = done.meshes.map(m => ({ position: m.attributes.position.array, normal: m.attributes.normal.array, cDay: m.attributes.cDay.array, cGold: m.attributes.cGold.array, cNight: m.attributes.cNight.array, aFacet: m.attributes.aFacet.array, aSurface: m.attributes.aSurface.array, index: m.index }));
  const wSha = wMeshes.map(m => Object.fromEntries(Object.entries(m).map(([k, a]) => [k, sha(a)])));

  // the reference: the same generator on this thread
  const { A, specs: refSpecs } = await loadApp({});
  const g = await A.build(refSpecs);
  const rSha = []; g.traverse(o => { if (!o.isMesh) return; const gm = o.geometry, e = {}; for (const k in gm.attributes) e[k] = sha(gm.attributes[k].array); e.index = sha(gm.index.array); rSha.push(e); });

  let bad = 0;
  out(`buildings: ${specs.length}${process.env.ONLY ? ' (' + process.env.ONLY + ')' : ' (the whole catalog)'}; worker ${done.ms.toFixed(0)} ms, ${wMeshes.length} mesh(es), ${wMeshes[0].index.length / 3} triangles`);
  if (wSha.length !== rSha.length) { out(`FAIL: ${wSha.length} meshes from the worker, ${rSha.length} from the main thread`); bad++; }
  for (let i = 0; i < Math.min(wSha.length, rSha.length); i++) for (const k of Object.keys(rSha[i])) if (wSha[i][k] !== rSha[i][k]) { out(`MISMATCH mesh ${i} ${k}`); bad++; }
  out(bad ? `FAIL: ${bad} difference(s)${BREAK ? ' (--break: this is the expected result)' : ''}` : 'PASS: the worker built identical bytes (all eight arrays, sha256)');
  process.exit(bad ? 1 : 0);
}
