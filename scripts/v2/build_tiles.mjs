// v2 tiles: every current best Blender build -> streamed 250 m map tiles for the v2 app (v2/tiles/manifest.json).
//
//   PATH=~/miniforge3/envs/utx/bin:$PATH node scripts/v2/build_tiles.mjs [--only slugA,slugB] [--no-export] [--force] [--jobs 2]
//
// Incremental. A building is re-exported only when its .blend's sha256 or the exporter changed; a tile is rebuilt only when the set of
// its buildings, any of their .blend hashes, or this script changed. manifest.json and inventory.json are rewritten atomically (tmp + rename).
//   1. scripts/v2/sources.py          which .blend is each building's best build, its hash, and where it stands (origin, frame x/z, tile)
//   2. scripts/v2/blender_export_v2.py one plain near .glb + far .glb per building (headless Blender through brender.sh: at most two
//                                      Blenders on this Mac, shared with the builders)
//   3. scripts/v2/check_place.py       does each model stand on its surveyed outline (the placement table, flags)
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

// ── PARAMETERS ──────────────────────────────────────────────────────────
const ORIGIN = { lat: 30.28601, lon: -97.73932 };   // must equal sources.py ORIGIN
const TILE_M = 250;
const FAR_SIMPLIFY_RATIO = 0.5;      // lod1 keeps at most this share of triangles...
const FAR_SIMPLIFY_ERROR = 0.002;    // ...and moves no surface by more than this share of the tile's size (0.002 x ~250 m = 0.5 m)
const MESHOPT_LEVEL = 'high';     // filter mode (octahedral normals etc.): about a fifth smaller than 'medium', keeps the dense West Campus tile under the phone line
const QUANT = { quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 };  // 14 bits over a ~260 m tile = 1.6 cm
// A near tile over this is reported. Why 2 MB: a phone on cellular (~5-10 Mbit/s) fetches it in 2-3 s, and its decoded vertex and index
// buffers (about 3-4x the Meshopt file) stay under ~8 MB of GPU memory, so the dozen or so tiles around the camera fit the phone's budget
// (the iPhone has already lost the live page twice for memory). Far tiles are a tenth of that.
const PHONE_TILE_LIMIT_MB = 2.0;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const OUT = path.join(REPO, 'v2/tiles');
const CACHE = process.env.V2_CACHE || path.join(os.homedir(), 'flyover-private/v2-tiles-cache');
const EXPORT = path.join(CACHE, 'export');
const PY = process.env.PY || path.join(os.homedir(), 'miniforge3/envs/utx/bin/python3');
const BRENDER = process.env.BRENDER || path.join(os.homedir(), 'Projects/flyover-blender/scripts/brender.sh');

const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? (argv[i + 1] || '') : null; };
const ONLY = opt('--only') ? new Set(opt('--only').split(',').filter(Boolean)) : null;
const NO_EXPORT = argv.includes('--no-export');
const FORCE = argv.includes('--force');
const JOBS = +(opt('--jobs') || 2);

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const EXPORTER = path.join(HERE, 'blender_export_v2.py');
const EXPORTER_HASH = sha(fs.readFileSync(EXPORTER)).slice(0, 16);
const TILER_HASH = sha(fs.readFileSync(fileURLToPath(import.meta.url))).slice(0, 16);

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
{
  const r = await run(PY, [path.join(HERE, 'sources.py'), SRC]);
  process.stdout.write(r.out.split('\n').filter((l) => !l.startsWith('  ORIGIN?')).join('\n') + '\n');
  if (r.code) throw new Error('sources.py failed');
}
const sources = readJSON(SRC, {});

// ── 2. export (only what changed) ────────────────────────────────────────
const keyOf = (s) => `${sources[s].blend_sha256}:${EXPORTER_HASH}`;
const stateFile = (s) => path.join(EXPORT, `${s}.key`);
const exported = (s) => fs.existsSync(stateFile(s)) && fs.readFileSync(stateFile(s), 'utf8') === keyOf(s)
  && fs.existsSync(path.join(EXPORT, `${s}.near.glb`)) && fs.existsSync(path.join(EXPORT, `${s}.far.glb`));
// an export made from the same .blend by an OLDER exporter still serves the tiles until it is redone (so an exporter change, or a
// partial --only run, never empties a tile)
const stateOf = (s) => { try { return fs.readFileSync(stateFile(s), 'utf8'); } catch { return ''; } };
const usable = (s) => stateOf(s).startsWith(sources[s].blend_sha256 + ':')
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
      const r = await run(BRENDER, ['-b', sources[s].blend, '-P', EXPORTER, '--', `${base}.near.glb`, `${base}.far.glb`, `${base}.json`], `${base}.log`);
      const ok = r.code === 0 && /V2EXPORT/.test(r.out);
      if (ok) fs.writeFileSync(stateFile(s), keyOf(s)); else failed[s] = (r.out.match(/Error[^\n]*/) || [`exit ${r.code}`])[0].slice(0, 200);
      done++; console.log(`  [${done}/${todo.length}] ${s} ${ok ? 'ok' : 'FAILED ' + failed[s]} ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(JOBS, todo.length) }, worker));
}

// ── 3. placement check ───────────────────────────────────────────────────
const PLACE = path.join(CACHE, 'placement.json');
if (todo.length || !fs.existsSync(PLACE)) {
  const r = await run(PY, [path.join(HERE, 'check_place.py'), SRC, EXPORT, PLACE, ...todo.filter((s) => !failed[s])]);
  if (r.code) console.log(r.out); else if (todo.length) console.log(r.out.split('\n').filter((l) => /flags|centre|area|base/.test(l)).join('\n'));
}
const place = readJSON(PLACE, {});

// ── 3b. far masses (lod1): scripts/v2/far_mass.py, only where the near file or the mass code changed ──
const MASS_HASH = sha(Buffer.concat([fs.readFileSync(path.join(HERE, 'far_mass.py')), fs.readFileSync(path.join(REPO, 'scripts/gltf_far.py'))])).slice(0, 16);
const massKey = (s) => `${keyOf(s)}:${MASS_HASH}`;
const massFile = (s) => path.join(EXPORT, `${s}.mass.key`);
const massState = (s) => { try { return fs.readFileSync(massFile(s), 'utf8'); } catch { return ''; } };
const hasMass = (s) => massState(s) === massKey(s) + ':ok' && fs.existsSync(path.join(EXPORT, `${s}.mass.glb`));
{
  const need = placeable.filter((s) => exported(s) && (FORCE && todo.includes(s) || !massState(s).startsWith(massKey(s))));
  for (let i = 0; i < need.length; i += 40) {
    const chunk = need.slice(i, i + 40);
    const r = await run(PY, [path.join(HERE, 'far_mass.py'), EXPORT, ...chunk]);
    for (const line of r.out.split('\n')) {
      const m = line.match(/^MASS(-FAILED)? (\S+)/);
      if (m) fs.writeFileSync(massFile(m[2]), massKey(m[2]) + (m[1] ? ':failed ' + line.slice(m[0].length).trim().slice(0, 160) : ':ok'));
    }
    if (r.code) console.log(r.out.slice(-2000));
  }
  if (need.length) console.log(`MASS ${need.length} made, ${need.filter((s) => !hasMass(s)).length} fell back to the near model without its small parts`);
}

// ── 4. tiles ─────────────────────────────────────────────────────────────
const io = new NodeIO().setLogger(QUIET).registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
await MeshoptEncoder.ready; await MeshoptSimplifier.ready; await MeshoptDecoder.ready;

const inTiles = placeable.filter((s) => usable(s));
const tiles = {};
for (const s of inTiles) (tiles[sources[s].tile] ||= []).push(s);
for (const t in tiles) tiles[t].sort();

const isGlass = (m) => m && ((m.getExtras() || {}).v2_kind || 'plain') !== 'plain';

async function buildingDoc(s, lod, idx, part) {
  const doc = await io.read(path.join(EXPORT, `${s}.${lod === 0 ? 'near' : hasMass(s) ? 'mass' : 'far'}.glb`));
  const root = doc.getRoot(); const buf = root.listBuffers()[0];
  root.listNodes()[0].setName(s).setTranslation([sources[s].x, 0, sources[s].z]);
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
  doc.getRoot().setExtras({ tile: t, lod, buildings: slugs, building_attribute: '_BUILDING = index into buildings' });
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
const tileHash = (t) => sha(JSON.stringify([TILER_HASH, MASS_HASH, tiles[t].map((s) => [s, stateOf(s), sources[s].x, sources[s].z, hasMass(s)])])).slice(0, 16);
const tileInfo = {};
let rebuilt = 0;
for (const t of Object.keys(tiles).sort()) {
  const h = tileHash(t); const prev = prevInv.tiles[t];
  if (!FORCE && prev && prev.hash === h && fs.existsSync(path.join(OUT, `${t}.glb`)) && fs.existsSync(path.join(OUT, `${t}.far.glb`))) { tileInfo[t] = prev; continue; }
  const t0 = Date.now();
  const near = await buildTile(t, tiles[t], 0); const far = await buildTile(t, tiles[t], 1);
  tileInfo[t] = { hash: h, near: { bytes: near.bytes, tris: near.tris, draws: near.draws }, far: { bytes: far.bytes, tris: far.tris, draws: far.draws } };
  rebuilt++;
  console.log(`TILE ${t} ${tiles[t].length} buildings  near ${(near.bytes / 1e6).toFixed(2)} MB ${near.tris} tris ${near.draws} draws  far ${(far.bytes / 1e6).toFixed(2)} MB ${far.tris} tris ${far.draws} draws  ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
// tiles that no longer hold any building
for (const f of fs.readdirSync(OUT)) {
  const m = f.match(/^(t_-?\d+_-?\d+)(\.far)?\.glb$/);
  if (m && !tiles[m[1]]) { fs.unlinkSync(path.join(OUT, f)); console.log('REMOVED', f); }
}

// ── manifest + inventory (atomic) ────────────────────────────────────────
const manifest = {
  origin: ORIGIN,
  frame: 'local metres: x east, y up, z south (three.js); y = metres above ground at the building',
  projection: 'equirectangular round the origin, as v2/geo.js: x = R cos(lat0) (lon - lon0), z = -R (lat - lat0), radians, R = 6378137',
  map_ids: 'ids the app hides extrusions by: the city map\'s 8-hex id or \'w<way>\' (OSM, as in data/outer/downtown_massing.json); the package\'s outlines plus any map/massing building whose middle lies inside them',
  tile_m: TILE_M,
  notes: 'Each tile .glb: one opaque mesh (palette texture, one draw) and in lod0 one glass mesh; EXT_meshopt_compression + KHR_mesh_quantization (use MeshoptDecoder); vertex attribute _BUILDING = index into the tile\'s buildings list; colours are the builds\' linear base colours on the Blender light rig scale (white paint ~0.17).',
  tiles: Object.keys(tiles).sort().map((t) => {
    const [, i, j] = t.match(/^t_(-?\d+)_(-?\d+)$/).map(Number);
    return { id: t, bounds: [i * TILE_M, j * TILE_M, (i + 1) * TILE_M, (j + 1) * TILE_M], lod0: `tiles/${t}.glb`, lod1: `tiles/${t}.far.glb`, buildings: tiles[t],
      bytes: [tileInfo[t].near.bytes, tileInfo[t].far.bytes] };
  }),
  buildings: Object.fromEntries(inTiles.sort().map((s) => [s, { tile: sources[s].tile, map_ids: sources[s].map_ids, name: sources[s].name, model: sources[s].model,
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
      placement: p && !reason ? { height_m: p.height_m, area_ratio: p.area_ratio, centre_off_m: p.centre_off_m, flags: p.flags } : null }];
  })),
  tiles: tileInfo,
};
writeAtomic(INV, JSON.stringify(inventory, null, 1));
writeAtomic(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
const total = Object.values(tileInfo).reduce((a, t) => a + t.near.bytes + t.far.bytes, 0);
const big = Object.entries(tileInfo).filter(([, t]) => t.near.bytes > PHONE_TILE_LIMIT_MB * 1e6).map(([k]) => k);
console.log(`DONE ${inTiles.length}/${Object.keys(sources).length} buildings in ${Object.keys(tiles).length} tiles (${rebuilt} rebuilt), ${(total / 1e6).toFixed(2)} MB total${big.length ? '; over ' + PHONE_TILE_LIMIT_MB + ' MB: ' + big.join(', ') : ''}`);
