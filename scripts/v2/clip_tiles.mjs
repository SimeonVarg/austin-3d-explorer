// v2 tiles, stage 5: hide the parts of one Blender model that stand up through another model's roof (scripts/v2/tile_clips.json).
//
//   PATH=~/miniforge3/envs/utx/bin:$PATH node scripts/v2/clip_tiles.mjs [--dir v2/tiles] [--dry]
//
// Run it after scripts/v2/build_tiles.mjs (a rebuilt tile gets the part back; scripts/verify/v2-tile-pokes.mjs fails until this is run again).
// Same way as the AO bake into built tiles (ao_bake.mjs CLI): read the tile, change it, encode it again with the build's own
// settings (tile_encoding.mjs; no dequantize: the quantized attributes stay as built), write it in place, and bring the byte counts in manifest.json and inventory.json along. Only triangles are
// dropped; no vertex of the rest moves, so the picture away from the part is the same. Idempotent: a tile that has no triangle left in a
// clip's box is left as it is.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { reorder } from '@gltf-transform/functions';
import { EXTMeshoptCompression } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { MESHOPT_LEVEL } from './tile_encoding.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const DIR = path.resolve(opt('--dir') || path.join(HERE, '../../v2/tiles'));
const DRY = argv.includes('--dry');
const TOL_M = 0.05;
const clips = JSON.parse(fs.readFileSync(path.join(HERE, 'tile_clips.json'), 'utf8')).clips || [];
const manifestRaw = fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'), manifest = JSON.parse(manifestRaw);
const writeLike = (file, obj, raw) => fs.writeFileSync(file, JSON.stringify(obj, null, /\n( +)\S/.exec(raw)[1].length) + (raw.endsWith('\n') ? '\n' : ''));   // (the file's own indent and last newline)
await MeshoptDecoder.ready; await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const byTile = new Map();
for (const c of clips) (byTile.get(c.tile) || byTile.set(c.tile, []).get(c.tile)).push(c);
let failed = false, tilesChanged = false;
for (const [tileId, list] of byTile) {
  const tile = manifest.tiles.find((t) => t.id === tileId);
  if (!tile) { console.error(`CLIP ${tileId}: not in the manifest`); failed = true; continue; }
  const file = path.join(DIR, `${tileId}.glb`);
  const before = fs.statSync(file).size;
  const doc = await io.read(file);
  // 1. every triangle of the clip's building that lies wholly in its box (world corners), per primitive
  const cand = new Map(list.map((c) => [c, []]));          // clip -> [{ idx, t, v: [[x,y,z] x3] }]
  const prims = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    const M = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION'), ids = prim.getAttribute('_BUILDING'), idx = prim.getIndices(), uvs = prim.getAttribute('TEXCOORD_0');
      if (!pos || !ids || !idx) continue;
      const I = idx.getArray(), tmp = [0, 0, 0];
      const world = (v) => { pos.getElement(v, tmp); const [x, y, z] = tmp; return [M[0] * x + M[4] * y + M[8] * z + M[12], M[1] * x + M[5] * y + M[9] * z + M[13], M[2] * x + M[6] * y + M[10] * z + M[14]]; };
      const rec = { idx, I, drop: new Set() }; prims.push(rec);
      for (let t = 0; t < I.length; t += 3) {
        const b = Math.round(ids.getScalar(I[t]));
        for (const c of list) {
          if (tile.buildings[b] !== c.slug) continue;
          if (c.uv) { const u = uvs?.getElement(I[t], [0, 0]); if (!u || Math.abs(u[0] - c.uv[0]) > 0.002 || Math.abs(u[1] - c.uv[1]) > 0.002) continue; }   // (a clip with "uv": only the triangles painted that palette colour; "up": only upward-facing ones))
          const v = [world(I[t]), world(I[t + 1]), world(I[t + 2])];
          if (!v.every((p) => p.every((q, a) => q >= c.box[a] - TOL_M && q <= c.box[a + 3] + TOL_M))) continue;
          if (c.up) { const e1 = [0, 1, 2].map((a) => v[1][a] - v[0][a]), e2 = [0, 1, 2].map((a) => v[2][a] - v[0][a]);   // "up": only triangles that face up (|normal.y| above it): a ground sheet, not the walls and steps that share its colour
            const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]; if (Math.abs(n[1]) / (Math.hypot(...n) || 1) <= c.up) continue; }
          cand.get(c).push({ rec, t, v });
        }
      }
    }
  }
  // 2. the part = the triangles in the box joined to the clip's seed corner by shared (welded) corners
  const dropped = new Map();
  for (const [c, tris] of cand) {
    const key = (p) => `${Math.round(p[0] / 0.01)},${Math.round(p[1] / 0.01)},${Math.round(p[2] / 0.01)}`;
    const at = new Map();
    tris.forEach((T, i) => T.v.forEach((p) => { const k = key(p); (at.get(k) || at.set(k, []).get(k)).push(i); }));
    const seen = new Uint8Array(tris.length), stack = [];
    if (c.uv && !c.joined) { tris.forEach((T) => T.rec.drop.add(T.t)); dropped.set(c, tris.length); continue; }   // "uv": every such triangle in the box goes (a ground sheet is many pieces; no seed)
    tris.forEach((T, i) => { if (T.v.some((p) => Math.hypot(p[0] - c.seed[0], p[1] - c.seed[1], p[2] - c.seed[2]) < 0.03) && !seen[i]) { seen[i] = 1; stack.push(i); } });
    let n = 0;
    while (stack.length) { const i = stack.pop(); n++; tris[i].rec.drop.add(tris[i].t); for (const p of tris[i].v) for (const j of at.get(key(p))) if (!seen[j]) { seen[j] = 1; stack.push(j); } }
    dropped.set(c, n);
  }
  for (const r of prims) if (r.drop.size) {
    const keep = []; for (let t = 0; t < r.I.length; t += 3) if (!r.drop.has(t)) keep.push(r.I[t], r.I[t + 1], r.I[t + 2]);
    r.idx.setArray(r.I instanceof Uint16Array ? Uint16Array.from(keep) : Uint32Array.from(keep));
  }
  let changed = false;
  for (const [c, n] of dropped) {
    if (n === 0) { console.log(`CLIP ${c.slug} in ${tileId}: nothing in the box (already clipped)`); continue; }
    if (n !== c.tris) { console.error(`CLIP ${c.slug} in ${tileId}: the box holds ${n} triangles, tile_clips.json says ${c.tris}. The model changed: run scripts/verify/v2-tile-pokes.mjs and look again.`); failed = true; continue; }
    console.log(`CLIP ${c.slug} in ${tileId}: ${n} triangles hidden (${c.why.slice(0, 70)}...)`); changed = true;
  }
  if (!changed || failed || DRY) continue;
  // Not meshopt(): its quantize step gives the node a new scale and offset from the bounds of what is LEFT, and skips the attributes that are
  // already 16-bit, so a clip that shortens the tile's extent (a ground sheet at its edge) would move every building (found 2026-10-27, t_2_0:
  // the Cowboys Pavilion came out 9 m off). reorder drops the unused corners and keeps the values; the compression is switched on as meshopt() does.
  await doc.transform(reorder({ encoder: MeshoptEncoder, target: 'size' }));
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: MESHOPT_LEVEL === 'medium' ? EXTMeshoptCompression.EncoderMethod.QUANTIZE : EXTMeshoptCompression.EncoderMethod.FILTER });
  const bin = await io.writeBinary(doc);
  fs.writeFileSync(file + '.tmp', bin); fs.renameSync(file + '.tmp', file);
  const t = manifest.tiles.find((x) => x.id === tileId); if (t?.bytes) t.bytes[0] = bin.byteLength;
  const invF = path.join(DIR, 'inventory.json');
  if (fs.existsSync(invF)) {                      // a text edit of this tile's two numbers (the file's other numbers keep their spelling)
    let tris = 0; for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) tris += p.getIndices().getCount() / 3;
    const re = new RegExp('("' + tileId + '": \\{\\s*"hash": "[^"]*",\\s*"near": \\{\\s*"bytes": )\\d+(,\\s*"tris": )\\d+');
    const raw = fs.readFileSync(invF, 'utf8');
    if (re.test(raw)) fs.writeFileSync(invF, raw.replace(re, `$1${bin.byteLength}$2${tris}`)); else console.error(`inventory.json: no entry for ${tileId}`);
  }
  tilesChanged = true;
  console.log(`TILE ${tileId}: ${(before / 1e6).toFixed(3)} -> ${(bin.byteLength / 1e6).toFixed(3)} MB`);
}
if (!DRY && tilesChanged) writeLike(path.join(DIR, 'manifest.json'), manifest, manifestRaw);
process.exit(failed ? 1 : 0);
