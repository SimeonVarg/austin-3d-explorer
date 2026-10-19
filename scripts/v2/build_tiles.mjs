// v2 tiles: every current best Blender build -> streamed 250 m map tiles for the v2 app (v2/tiles/manifest.json).
//
//   Trial, no Blender/cache writes or far rebuilds: node scripts/v2/build_tiles.mjs --cached --tiles t_-1_-4,t_2_0,t_3_2,t_1_3
//   PATH=~/miniforge3/envs/utx/bin:$PATH node scripts/v2/build_tiles.mjs [--only slugA,slugB] [--no-export] [--force] [--jobs 2]
//
// Incremental. A building is re-exported only when its .blend's sha256 or the exporter changed; a tile is rebuilt only when the set of
// its buildings, any of their .blend hashes, or this script changed. manifest.json and inventory.json are rewritten atomically (tmp + rename).
//   1. scripts/v2/sources.py          which .blend is each building's best build, its hash, and where it stands (origin, frame x/z, tile)
//   2. scripts/v2/blender_export_v2.py one plain near .glb + far .glb per building (headless Blender through brender.sh: at most two
//                                      Blenders on this Mac, shared with the builders)
//   3. scripts/v2/check_place.py       does each model stand on its surveyed outline (the placement table, flags)
//   3c. scripts/v2/app_copy.mjs        for the builds named in app_copy.json only: the light APP COPY, made afterwards from the detailed export
//                                      (site ground graded onto the app's flat ground, simplified to a triangle number). The detailed export stays;
//                                      the placement check, the far mass and the tile all read the copy.
//   4. here                            per tile, with glTF Transform: dedup -> palette -> flatten -> join, glass apart from the rest,
//                                      then Meshopt (reorder + quantize + EXT_meshopt_compression). lod1 (far): weld -> simplify first.
// The export cache (per-building .glb, state) lives OUTSIDE the repo: $V2_CACHE (default ~/flyover-private/v2-tiles-cache).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Document, Logger, NodeIO } from '@gltf-transform/core';
const QUIET = new Logger(Logger.Verbosity.ERROR);   // (quantize says it skips _BUILDING: that is wanted, the ids stay whole numbers)
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, flatten, join, mergeDocuments, meshopt, palette, prune, simplify, unpartition, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { makeAppCopy } from './app_copy.mjs';
import { fineData, fixVenueCoplanar } from './fine_repeat.mjs';

// ── PARAMETERS ──────────────────────────────────────────────────────────
const ORIGIN = { lat: 30.28601, lon: -97.73932 };   // must equal sources.py ORIGIN
const TILE_M = 250;
const FAR_SIMPLIFY_RATIO = 0.5;      // lod1 keeps at most this share of triangles...
const FAR_SIMPLIFY_ERROR = 0.002;    // ...and moves no surface by more than this share of the tile's size (0.002 x ~250 m = 0.5 m)
const MESHOPT_LEVEL = 'high';     // filter mode (octahedral normals etc.): about a fifth smaller than 'medium', keeps the dense West Campus tile under the phone line
// 14 bits over a ~260 m tile = 1.6 cm; 16 bits = 0.4 cm. At 1.6 cm the builders' layered surfaces (field markings, painted aisles, seat blocks laid
// 1-3 cm over each other) land on the same step and fight for the pixel: the end zones, lettering and aisle bands were lost that way (2026-10-18).
const QUANT = { quantizePosition: +(process.env.V2_QUANT_BITS || 16), quantizeNormal: 10, quantizeTexcoord: 12 };
// A near tile over this is reported. Why 2 MB: a phone on cellular (~5-10 Mbit/s) fetches it in 2-3 s, and its decoded vertex and index
// buffers (about 3-4x the Meshopt file) stay under ~8 MB of GPU memory, so the dozen or so tiles around the camera fit the phone's budget
// (the iPhone has already lost the live page twice for memory). Far tiles are a tenth of that.
const PHONE_TILE_LIMIT_MB = 2.0;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
// V2_TILES_DIR / V2_APP_COPY: a trial run writes v2/<dir>/ (and reads another app_copy json) so a variant can be looked at in the app with ?manifest=./<dir>/manifest.json
const TILES_DIR = process.env.V2_TILES_DIR || 'tiles';
const OUT = path.join(REPO, 'v2', TILES_DIR);
const CACHE = process.env.V2_CACHE || path.join(os.homedir(), 'flyover-private/v2-tiles-cache');
const EXPORT = path.join(CACHE, 'export');
const PY = process.env.PY || path.join(os.homedir(), 'miniforge3/envs/utx/bin/python3');
const BRENDER = process.env.BRENDER || path.join(os.homedir(), 'Projects/flyover-blender/scripts/brender.sh');

const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? (argv[i + 1] || '') : null; };
const ONLY = opt('--only') ? new Set(opt('--only').split(',').filter(Boolean)) : null;
const CACHED = argv.includes('--cached'); // read the private export cache; never rewrite it (bounded tile trial)
const SELECT_TILES = opt('--tiles') ? new Set(opt('--tiles').split(',').filter(Boolean)) : null;
const NO_EXPORT = CACHED || argv.includes('--no-export');
const FORCE = argv.includes('--force');
const JOBS = +(opt('--jobs') || 2);

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const EXPORTER = path.join(HERE, 'blender_export_v2.py');
const EXPORTER_HASH = sha(fs.readFileSync(EXPORTER)).slice(0, 16);
const TILER_HASH = sha(Buffer.concat([fs.readFileSync(fileURLToPath(import.meta.url)), fs.readFileSync(path.join(HERE, 'fine_repeat.mjs'))])).slice(0, 16);

function run(cmd, args, logFile) {
  return new Promise((res) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => { if (logFile) fs.writeFileSync(logFile, out); res({ code, out }); });
  });
}
function writeAtomic(file, data) {
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, data); fs.renameSync(tmp, file);
}
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

// ── 1. sources ───────────────────────────────────────────────────────────
fs.mkdirSync(EXPORT, { recursive: true }); fs.mkdirSync(OUT, { recursive: true });
const SRC = path.join(CACHE, 'sources.json');
if (!CACHED) {
  const r = await run(PY, [path.join(HERE, 'sources.py'), SRC]);
  process.stdout.write(r.out.split('\n').filter((l) => !l.startsWith('  ORIGIN?')).join('\n') + '\n');
  if (r.code) throw new Error('sources.py failed');
}
const sources = readJSON(SRC, {});
// builds that get an app copy (scripts/v2/app_copy.json: slug -> { triangles, crease_deg, site }); their copies live in $V2_CACHE/export/app
const APP_COPY = readJSON(process.env.V2_APP_COPY || path.join(HERE, 'app_copy.json'), {});
const APP_DIR = path.join(EXPORT, 'app');
const APPMASS_DIR = path.join(EXPORT, 'appmass');     // the app copy without its ground: the far mass is made from it
fs.mkdirSync(APP_DIR, { recursive: true }); fs.mkdirSync(APPMASS_DIR, { recursive: true });
const APP_CODE_HASH = sha(fs.readFileSync(path.join(HERE, 'app_copy.mjs'))).slice(0, 16);
const dirOf = (s) => (APP_COPY[s] ? APP_DIR : EXPORT);
const massDirOf = (s) => (APP_COPY[s] ? APPMASS_DIR : EXPORT);

// ── 2. export (only what changed) ────────────────────────────────────────
// builds named in frozen.json keep the export already in the cache whatever their .blend does later (a builder may still be saving it): not
// re-exported, always usable, their key is the one they were exported under
const FROZEN = readJSON(path.join(HERE, 'frozen.json'), {});
// objects left out of a build's export (neighbours the app draws itself): export_skip.json, run through blender_export_skip.py; part of the export key
// builds with a fine repeat (louvre plates, grille blades) that ask for their tile's far file sooner (metres; the default is 700): lod1.json
const LOD1_M = readJSON(path.join(HERE, 'lod1.json'), {});
const EXPORT_SKIP = readJSON(path.join(HERE, 'export_skip.json'), {});
const SKIP_PY = path.join(HERE, 'blender_export_skip.py');
const keyOf = (s) => (FROZEN[s] ? ((() => { try { return fs.readFileSync(path.join(EXPORT, `${s}.key`), 'utf8'); } catch { return 'frozen'; } })()) : `${sources[s].blend_sha256}:${EXPORTER_HASH}${EXPORT_SKIP[s] ? ':skip' + sha(Buffer.from(EXPORT_SKIP[s])).slice(0, 8) : ''}`);
const stateFile = (s) => path.join(EXPORT, `${s}.key`);
const exported = (s) => fs.existsSync(stateFile(s)) && (FROZEN[s] || fs.readFileSync(stateFile(s), 'utf8') === keyOf(s))
  && fs.existsSync(path.join(EXPORT, `${s}.near.glb`)) && fs.existsSync(path.join(EXPORT, `${s}.far.glb`));
// an export made from the same .blend by an OLDER exporter still serves the tiles until it is redone (so an exporter change, or a
// partial --only run, never empties a tile)
const stateOf = (s) => { try { return fs.readFileSync(stateFile(s), 'utf8'); } catch { return ''; } };
const usable = (s) => (FROZEN[s] || stateOf(s).startsWith(sources[s].blend_sha256 + ':'))
  && fs.existsSync(path.join(EXPORT, `${s}.near.glb`)) && fs.existsSync(path.join(EXPORT, `${s}.far.glb`));
const placeable = Object.keys(sources).filter((s) => !sources[s].skip);
const want = placeable.filter((s) => !ONLY || ONLY.has(s));
const todo = NO_EXPORT ? [] : want.filter((s) => FORCE || !exported(s));
const failed = {};
console.log(`EXPORT ${todo.length} to do (${want.length - todo.length} current), ${JOBS} at a time`);
{
  let next = 0, done = 0;
  const worker = async () => {
    while (next < todo.length) {
      const s = todo[next++]; const t0 = Date.now();
      const base = path.join(EXPORT, s);
      const r = await run(BRENDER, ['-b', sources[s].blend, '-P', EXPORT_SKIP[s] ? SKIP_PY : EXPORTER, '--', ...(EXPORT_SKIP[s] ? [EXPORT_SKIP[s]] : []), `${base}.near.glb`, `${base}.far.glb`, `${base}.json`], `${base}.log`);
      const ok = r.code === 0 && /V2EXPORT/.test(r.out);
      if (ok) fs.writeFileSync(stateFile(s), keyOf(s)); else failed[s] = (r.out.match(/Error[^\n]*/) || [`exit ${r.code}`])[0].slice(0, 200);
      done++; console.log(`  [${done}/${todo.length}] ${s} ${ok ? 'ok' : 'FAILED ' + failed[s]} ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(JOBS, todo.length) }, worker));
}

// ── 2b. app copies (only the builds named in app_copy.json) ───────────────
const io = new NodeIO().setLogger(QUIET).registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
await MeshoptEncoder.ready; await MeshoptSimplifier.ready; await MeshoptDecoder.ready;
// the app copy of a build is current when it was made from this .blend's export, by this code, with these numbers
const appKey = (s) => (APP_COPY[s] ? sha(Buffer.from(keyOf(s) + ':' + APP_CODE_HASH + ':' + JSON.stringify(APP_COPY[s]))).slice(0, 16) : '');
const appState = (s) => { try { return fs.readFileSync(path.join(APP_DIR, `${s}.key`), 'utf8'); } catch { return ''; } };
const appStats = (s) => readJSON(path.join(APP_DIR, `${s}.json`), null);
const appMade = [];
for (const s of placeable.filter((x) => !CACHED && APP_COPY[x] && usable(x) && (!ONLY || ONLY.has(x)))) {
  if (!FORCE && appState(s) === appKey(s) && fs.existsSync(path.join(APP_DIR, `${s}.near.glb`))) continue;
  const t0 = Date.now();
  const st = await makeAppCopy({ io, MeshoptSimplifier, MeshoptEncoder, src: path.join(EXPORT, `${s}.near.glb`), dst: path.join(APP_DIR, `${s}.near.glb`), dstMass: path.join(APPMASS_DIR, `${s}.near.glb`), dstFarKeep: path.join(APP_DIR, `${s}.farkeep.glb`), dstFarCopy: path.join(APP_DIR, `${s}.farcopy.glb`), spec: APP_COPY[s] });
  fs.writeFileSync(path.join(APP_DIR, `${s}.json`), JSON.stringify(st, null, 1)); fs.writeFileSync(path.join(APP_DIR, `${s}.key`), appKey(s));
  try { fs.unlinkSync(path.join(EXPORT, `${s}.mass.key`)); } catch {}     // the far mass is made again from the new copy
  appMade.push(s);
  console.log(`APPCOPY ${s}: ${st.detailed_tris} -> ${st.app_tris} triangles (target ${APP_COPY[s].triangles}, simplify error ${st.simplify_error}); ground ${st.grading.site_tris_before} -> ${st.grading.site_tris_after}  ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

// ── 3. placement check ───────────────────────────────────────────────────
const PLACE = path.join(CACHE, 'placement.json');
{
  const show = (r) => (r.code ? console.log(r.out) : console.log(r.out.split('\n').filter((l) => /flags|centre|area|base/.test(l)).join('\n')));
  const plain = todo.filter((s) => !failed[s] && !APP_COPY[s]);
  if (!CACHED && (plain.length || !fs.existsSync(PLACE))) show(await run(PY, [path.join(HERE, 'check_place.py'), SRC, EXPORT, PLACE, ...plain]));
  // an app copy is checked as the app will draw it (its ground graded, not the builder's 4.5 km of terrain)
  if (appMade.length) show(await run(PY, [path.join(HERE, 'check_place.py'), SRC, APP_DIR, PLACE, ...appMade]));
}
const place = readJSON(PLACE, {});

// ── 3b. far masses (lod1): scripts/v2/far_mass.py, only where the near file or the mass code changed ──
const MASS_HASH = sha(Buffer.concat([fs.readFileSync(path.join(HERE, 'far_mass.py')), fs.readFileSync(path.join(REPO, 'scripts/gltf_far.py'))])).slice(0, 16);
const massKey = (s) => `${keyOf(s)}:${MASS_HASH}${APP_COPY[s] ? ':app' + appKey(s) : ''}`;
const massFile = (s) => path.join(EXPORT, `${s}.mass.key`);
const massState = (s) => { try { return fs.readFileSync(massFile(s), 'utf8'); } catch { return ''; } };
const hasMass = (s) => massState(s) === massKey(s) + ':ok' && fs.existsSync(path.join(massDirOf(s), `${s}.mass.glb`));
{
  const need = placeable.filter((s) => !CACHED && exported(s) && (FORCE && todo.includes(s) || !massState(s).startsWith(massKey(s))));
  const groups = [[EXPORT, need.filter((s) => !APP_COPY[s])], [APPMASS_DIR, need.filter((s) => APP_COPY[s])]];   // an app copy's mass is made from the copy
  for (const [dir, list] of groups) for (let i = 0; i < list.length; i += 40) {
    const chunk = list.slice(i, i + 40);
    const r = await run(PY, [path.join(HERE, 'far_mass.py'), dir, ...chunk]);
    for (const line of r.out.split('\n')) {
      const m = line.match(/^MASS(-FAILED)? (\S+)/);
      if (m) fs.writeFileSync(massFile(m[2]), massKey(m[2]) + (m[1] ? ':failed ' + line.slice(m[0].length).trim().slice(0, 160) : ':ok'));
    }
    if (r.code) console.log(r.out.slice(-2000));
  }
  if (need.length) console.log(`MASS ${need.length} made, ${need.filter((s) => !hasMass(s)).length} fell back to the near model without its small parts`);
}

// ── 4. tiles ─────────────────────────────────────────────────────────────
const inTiles = placeable.filter((s) => usable(s));
const tiles = {};
for (const s of inTiles) (tiles[sources[s].tile] ||= []).push(s);
for (const t in tiles) tiles[t].sort();

const isGlass = (m) => m && ((m.getExtras() || {}).v2_kind || 'plain') !== 'plain';

async function buildingDoc(s, lod, idx, part) {
  const farCopy = lod === 1 && APP_COPY[s] && APP_COPY[s].far_copy;     // a far file made from the app copy itself, not the mass
  const doc = await io.read(farCopy ? path.join(APP_DIR, `${s}.farcopy.glb`) : path.join(lod === 1 ? (hasMass(s) ? massDirOf(s) : EXPORT) : dirOf(s), `${s}.${lod === 0 ? 'near' : hasMass(s) ? 'mass' : 'far'}.glb`));
  // lod1 of an app-copy build also keeps the named surfaces of the copy (a field's turf: the far mass is walls and roofs and has no ground in it)
  if (lod === 1 && !farCopy && hasMass(s) && APP_COPY[s] && APP_COPY[s].far_keep) {
    const extra = await io.read(path.join(APP_DIR, `${s}.farkeep.glb`));
    mergeDocuments(doc, extra);
    const sc0 = doc.getRoot().listScenes()[0];
    for (const sc of doc.getRoot().listScenes().slice(1)) { for (const n of sc.listChildren()) sc0.addChild(n); sc.dispose(); }
    await doc.transform(unpartition(), flatten(), join({ keepNamed: false }));
  }
  if (lod === 0) { const repair = fixVenueCoplanar(doc, s); if (repair) console.log('COPLANAR', JSON.stringify(repair)); }
  const root = doc.getRoot(); const buf = root.listBuffers()[0];
  for (const n of root.listNodes()) n.setName(s).setTranslation([sources[s].x, 0, sources[s].z]);   // (every node: a far file that kept a surface of the app copy has two)
  for (const mesh of root.listMeshes()) {
    mesh.setName(s);
    for (const prim of mesh.listPrimitives()) {
      const glassy = lod === 0 && isGlass(prim.getMaterial());     // lod1: glass is opaque and joins the rest
      if ((part === 'glass') !== glassy) { prim.dispose(); continue; }
      const n = prim.getAttribute('POSITION').getCount();
      prim.setAttribute('_BUILDING', doc.createAccessor().setType('SCALAR').setArray(new Float32Array(n).fill(idx)).setBuffer(buf));
    }
  }
  return doc;
}

async function partDoc(slugs, lod, part) {
  const doc = new Document().setLogger(QUIET); doc.createBuffer(); const scene = doc.createScene('tile'); doc.getRoot().setDefaultScene(scene);
  for (let i = 0; i < slugs.length; i++) {
    const src = await buildingDoc(slugs[i], lod, i, part);
    mergeDocuments(doc, src);
  }
  for (const sc of doc.getRoot().listScenes()) {
    if (sc === scene) continue;
    for (const n of sc.listChildren()) scene.addChild(n);
    sc.dispose();
  }
  await doc.transform(unpartition(), prune());
  if (!doc.getRoot().listMeshes().some((m) => m.listPrimitives().length)) return null;
  const steps = [dedup()];
  if (lod === 1) steps.push(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: FAR_SIMPLIFY_RATIO, error: FAR_SIMPLIFY_ERROR }));
  steps.push(palette({ min: 2 }), flatten(), join({ keepNamed: false }), prune());
  await doc.transform(...steps);
  // The builders' faces are wound either way (Blender draws both sides, so nobody saw it): on 280 of 304 builds some faces that look at the sky are
  // wound downward, DKR's whole seat rake among them. Drawn single-sided those are culled and the viewer looks through them at what lies beneath
  // (2026-10-18: DKR's bowl was the concrete under the seats, Moody's roof a hole). The opaque part is drawn double-sided; three flips the normal of
  // a back face, so the light is right.
  if (part === 'opaque') for (const mt of doc.getRoot().listMaterials()) mt.setDoubleSided(true);
  for (const m of doc.getRoot().listMeshes()) m.setName(part);
  for (const n of doc.getRoot().listNodes()) n.setName(part);
  return doc;
}

async function buildTile(t, slugs, lod) {
  const opaque = await partDoc(slugs, lod, 'opaque');
  const glass = lod === 0 ? await partDoc(slugs, lod, 'glass') : null;
  const doc = opaque || glass;
  if (opaque && glass) {
    mergeDocuments(doc, glass);
    const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];
    for (const sc of doc.getRoot().listScenes()) { if (sc === scene) continue; for (const n of sc.listChildren()) scene.addChild(n); sc.dispose(); }
    await doc.transform(unpartition());
  }
  doc.getRoot().getAsset().generator = 'flyover scripts/v2/build_tiles.mjs (glTF Transform 4.5.0)';
  doc.getRoot().setExtras({ tile: t, lod, buildings: slugs, building_attribute: lod === 0 ? '_FINE.x = index into buildings; .y = log size; .zw = patch index' : '_BUILDING = index into buildings' });
  if (lod === 0) console.log('FINE', t, JSON.stringify(await fineData(doc, msg => console.log(`  ${t} ${msg}`)))); // both opaque and glass in the same facade table
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: MESHOPT_LEVEL, ...QUANT }));
  const bin = await io.writeBinary(doc);
  const file = `${t}${lod === 0 ? '' : '.far'}.glb`;
  writeAtomic(path.join(OUT, file), bin);
  let tris = 0, draws = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) { draws++; tris += (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3; }
  return { file, bytes: bin.byteLength, tris, draws };
}

const INV = path.join(OUT, 'inventory.json');
const prevInv = readJSON(INV, { tiles: {} });
const prevManifest = readJSON(path.join(OUT, 'manifest.json'), null);
if (SELECT_TILES && (!prevManifest || !Object.keys(prevInv.tiles).length)) throw new Error('--tiles requires an existing manifest and inventory');
if (SELECT_TILES) for (const t of SELECT_TILES) if (!tiles[t]) throw new Error('unknown tile ' + t);
const tileHash = (t) => sha(JSON.stringify([TILER_HASH, MASS_HASH, tiles[t].map((s) => [s, stateOf(s), sources[s].x, sources[s].z, hasMass(s), ...(APP_COPY[s] ? [appKey(s)] : [])])])).slice(0, 16);
const tileInfo = {};
let rebuilt = 0;
for (const t of Object.keys(tiles).sort()) {
  if (SELECT_TILES && !SELECT_TILES.has(t)) { tileInfo[t] = prevInv.tiles[t]; continue; }
  if (SELECT_TILES && prevManifest.tiles.find(e => e.id === t)?.buildings.join(',') !== tiles[t].join(',')) throw new Error('cached building membership changed: ' + t);
  const h = tileHash(t); const prev = prevInv.tiles[t];
  if (!FORCE && prev && prev.hash === h && fs.existsSync(path.join(OUT, `${t}.glb`)) && fs.existsSync(path.join(OUT, `${t}.far.glb`))) { tileInfo[t] = prev; continue; }
  const t0 = Date.now();
  const near = await buildTile(t, tiles[t], 0); const far = SELECT_TILES ? { ...prevInv.tiles[t].far } : await buildTile(t, tiles[t], 1);
  tileInfo[t] = { hash: h, near: { bytes: near.bytes, tris: near.tris, draws: near.draws }, far: { bytes: far.bytes, tris: far.tris, draws: far.draws } };
  rebuilt++;
  console.log(`TILE ${t} ${tiles[t].length} buildings  near ${(near.bytes / 1e6).toFixed(2)} MB ${near.tris} tris ${near.draws} draws  far ${(far.bytes / 1e6).toFixed(2)} MB ${far.tris} tris ${far.draws} draws  ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
// tiles that no longer hold any building
for (const f of fs.readdirSync(OUT)) {
  const m = f.match(/^(t_-?\d+_-?\d+)(\.far)?\.glb$/);
  if (!SELECT_TILES && m && !tiles[m[1]]) { fs.unlinkSync(path.join(OUT, f)); console.log('REMOVED', f); }
}

// ── manifest + inventory (atomic) ────────────────────────────────────────
const manifest = {
  origin: ORIGIN,
  frame: 'local metres: x east, y up, z south (three.js); y = metres above ground at the building',
  projection: 'equirectangular round the origin, as v2/geo.js: x = R cos(lat0) (lon - lon0), z = -R (lat - lat0), radians, R = 6378137',
  map_ids: 'ids the app hides extrusions by: the city map\'s 8-hex id or \'w<way>\' (OSM, as in data/outer/downtown_massing.json); the package\'s outlines, any map/massing building whose middle lies inside them, and any whose area the model\'s footprint covers by more than half',
  tile_m: TILE_M,
  notes: 'Each tile .glb: one opaque mesh (palette texture, one draw) and in lod0 one glass mesh; EXT_meshopt_compression + KHR_mesh_quantization (use MeshoptDecoder); vertex attribute _BUILDING (far/old tiles) or _FINE.x (new near tiles) = index into the tile\'s buildings list; colours are the builds\' linear base colours on the Blender light rig scale (white paint ~0.17).',
  tiles: Object.keys(tiles).sort().map((t) => {
    const [, i, j] = t.match(/^t_(-?\d+)_(-?\d+)$/).map(Number);
    const l1 = Math.min(...tiles[t].map((b) => (APP_COPY[b] && APP_COPY[b].lod1_m) || LOD1_M[b] || Infinity));   // a build with a fine repeat (fins) asks for its far file sooner
    return { id: t, bounds: [i * TILE_M, j * TILE_M, (i + 1) * TILE_M, (j + 1) * TILE_M], lod0: `${TILES_DIR}/${t}.glb`, lod1: `${TILES_DIR}/${t}.far.glb`, ...(Number.isFinite(l1) ? { lod1_m: l1 } : {}), buildings: tiles[t],
      bytes: [tileInfo[t].near.bytes, tileInfo[t].far.bytes] };
  }),
  buildings: Object.fromEntries(inTiles.sort().map((s) => [s, { tile: sources[s].tile, map_ids: [...new Set([...sources[s].map_ids, ...((place[s] && place[s].hides) || [])])], name: sources[s].name, model: sources[s].model,
    x: sources[s].x, z: sources[s].z, top: place[s] ? place[s].height_m : null }])),
};
const inventory = {
  about: 'Every current best Blender build (BUILDS.json status "best") and whether it is in the v2 tiles. Written by scripts/v2/build_tiles.mjs.',
  built: new Date().toISOString(), exporter: EXPORTER_HASH, tiler: TILER_HASH,
  totals: { best: Object.keys(sources).length, exported: inTiles.length },
  buildings: Object.fromEntries(Object.keys(sources).sort().map((s) => {
    const r = sources[s]; const p = place[s];
    let reason = r.skip || null;
    if (!reason && !usable(s)) reason = failed[s] ? 'export failed: ' + failed[s] : 'not exported yet';
    return [s, { exported: !reason, reason, model: r.model, kind: r.kind, tile: r.tile || null, blend_sha256: r.blend_sha256 ? r.blend_sha256.slice(0, 16) : null,
      lod1: reason ? null : hasMass(s) ? "mass" : "near without small parts",
      app_copy: !reason && APP_COPY[s] ? { triangles: (appStats(s) || {}).app_tris, detailed_triangles: (appStats(s) || {}).detailed_tris, target: APP_COPY[s].triangles, simplify_error: (appStats(s) || {}).simplify_error, ground_triangles: (appStats(s) || {}).grading ? [appStats(s).grading.site_tris_before, appStats(s).grading.site_tris_after] : null } : undefined,
      placement: p && !reason ? { height_m: p.height_m, area_ratio: p.area_ratio, centre_off_m: p.centre_off_m, flags: p.flags } : null }];
  })),
  tiles: tileInfo,
};
if (SELECT_TILES) {
  // A trial changes only the chosen near files and their receipts, never unselected tiles, far copies or placement.
  for (const t of SELECT_TILES) {
    prevInv.tiles[t] = tileInfo[t];
    const entry = prevManifest.tiles.find(e => e.id === t);
    if (entry.buildings.join(',') !== tiles[t].join(',')) throw new Error('cached building membership changed: ' + t);
    entry.bytes[0] = tileInfo[t].near.bytes;
    for (const s of tiles[t]) {
      prevInv.buildings[s] = inventory.buildings[s];
      prevManifest.buildings[s] = manifest.buildings[s];
    }
  }
  writeAtomic(INV, JSON.stringify(prevInv, null, 1));
  writeAtomic(path.join(OUT, 'manifest.json'), JSON.stringify(prevManifest, null, 1));
} else {
  writeAtomic(INV, JSON.stringify(inventory, null, 1));
  writeAtomic(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
}
const total = Object.values(tileInfo).reduce((a, t) => a + t.near.bytes + t.far.bytes, 0);
const big = Object.entries(tileInfo).filter(([, t]) => t.near.bytes > PHONE_TILE_LIMIT_MB * 1e6).map(([k]) => k);
console.log(`DONE ${inTiles.length}/${Object.keys(sources).length} buildings in ${Object.keys(tiles).length} tiles (${rebuilt} rebuilt), ${(total / 1e6).toFixed(2)} MB total${big.length ? '; over ' + PHONE_TILE_LIMIT_MB + ' MB: ' + big.join(', ') : ''}`);
