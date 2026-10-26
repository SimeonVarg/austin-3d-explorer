// v2/data/roof_glass.json: which buildings are campus buildings (their window glass gets the campus pane look, v2/roofglass.js) and which
// colours in each campus building's tile are its CLAY TILE ROOF (they get the one clay-tile material taken from the owner's photograph).
//
//   PATH=~/miniforge3/envs/utx/bin:$PATH node scripts/v2/roof_glass_data.mjs [EXPORT_DIR ...]
//
// The tiles keep no material names (build_tiles.mjs palettes every plain material into one texture), so the roof is found by name in
// the per-building export (the builders name it: roof_tile, roof_tile_clay, ridge_tile, ...) and then by its colour in the tile: a
// clay colour counts for a building only where that building's own vertices in the tile use it. A building whose roof colour changes in
// a later rebuild simply drops out (it keeps the builder's colour) until this script is run again; nothing else can be painted clay.
//   campus:  BUILDS.json rows with kind "campus" and status "best" (private ledger), intersected with the tile manifest
//   exports: $V2_CACHE/export (+ /app) and any EXPORT_DIR given (lanes that built in a cloned cache)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const CACHE = process.env.V2_CACHE || path.join(os.homedir(), 'flyover-private/v2-tiles-cache');
const LEDGER = process.env.BUILDS_JSON || path.join(os.homedir(), 'flyover-private/blender-2026-10-11/batch1/BUILDS.json');
// a clay tile roof, by the builders' material names (checked by eye against the list this prints)
const CLAY = /^(roof_tile|roof_tile_clay|roof_tile_red|roof_tile_terracotta|roof_tile_weathered|roof_cap_clay|roof_clay_tile|tile_clay|tile_red|ridge_tile|roof_red)$/;
const NOT_CLAY = { 'moncrief-neuhaus-athletic-center': ['roof_red'] };   // painted panels, not tile

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const manifest = JSON.parse(fs.readFileSync(path.join(REPO, 'v2/tiles/manifest.json'), 'utf8'));
const ledger = JSON.parse(fs.readFileSync(LEDGER, 'utf8')).builds;
const campus = [...new Set(ledger.filter((r) => r.status === 'best' && r.kind === 'campus').map((r) => r.slug))].filter((s) => manifest.buildings[s]).sort();

const glbJSON = (f) => { const b = fs.readFileSync(f); const n = b.readUInt32LE(12); return JSON.parse(b.subarray(20, 20 + n).toString()); };
const toS8 = (v) => Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
const dirs = [path.join(CACHE, 'export', 'app'), path.join(CACHE, 'export'), ...process.argv.slice(2).flatMap((d) => [path.join(d, 'app'), d])];
const clayCols = {};   // slug -> Map(key -> {name, rgb8})
for (const s of campus) {
  for (const d of dirs) {
    const f = path.join(d, `${s}.near.glb`);
    if (!fs.existsSync(f)) continue;
    for (const m of glbJSON(f).materials || []) {
      if (!CLAY.test(m.name || '') || (NOT_CLAY[s] || []).includes(m.name)) continue;
      const c = (m.pbrMetallicRoughness || {}).baseColorFactor || [1, 1, 1];
      const rgb8 = c.slice(0, 3).map(toS8);
      (clayCols[s] ||= new Map()).set(rgb8.join(','), { name: m.name, rgb8 });
    }
  }
}

// per tile: the palette colours each building's vertices use
const out = { _about: 'Written by scripts/v2/roof_glass_data.mjs; read by v2/roofglass.js. campus: slugs whose window glass gets the campus pane look. clay: slug -> sRGB 8-bit palette colours of its clay tile roof in its tile.', campus, clay: {} };
const missing = [];
for (const t of manifest.tiles) {
  const slugs = t.buildings.filter((s) => clayCols[s]);
  if (!slugs.length || !t.lod0) continue;
  const doc = await io.read(path.join(REPO, 'v2', t.lod0));
  const used = new Map();   // building index -> Set(rgb8 key)
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    const mat = p.getMaterial(); const tex = mat && mat.getBaseColorTexture();
    if (!tex || !/^Palette/.test(mat.getName())) continue;
    const { data, info } = await sharp(Buffer.from(tex.getImage())).raw().toBuffer({ resolveWithObject: true });
    const uv = p.getAttribute('TEXCOORD_0'), b = p.getAttribute('_BUILDING'); const n = uv.getCount();
    const e = [0, 0], bb = [0];
    for (let i = 0; i < n; i++) {
      uv.getElement(i, e); b.getElement(i, bb);
      const x = Math.min(info.width - 1, Math.floor(e[0] * info.width)), y = Math.min(info.height - 1, Math.floor(e[1] * info.height));
      const o = (y * info.width + x) * info.channels;
      const k = `${data[o]},${data[o + 1]},${data[o + 2]}`;
      const bi = Math.round(bb[0]);
      (used.get(bi) || used.set(bi, new Set()).get(bi)).add(k);
    }
  }
  for (const s of slugs) {
    const bi = t.buildings.indexOf(s); const u = used.get(bi) || new Set();
    const hit = [];
    for (const { name, rgb8 } of clayCols[s].values()) {
      // the palette PNG may round a channel the other way: accept +-1
      for (const k of u) { const c = k.split(',').map(Number); if (c.every((v, i) => Math.abs(v - rgb8[i]) <= 1)) hit.push({ name, rgb8: c }); }
    }
    const uniq = [...new Map(hit.map((h) => [h.rgb8.join(','), h])).values()];
    if (uniq.length) out.clay[s] = uniq.map((h) => h.rgb8);
    else missing.push(s + ' (' + [...clayCols[s].values()].map((v) => v.name + ' ' + v.rgb8).join('; ') + ')');
    console.log(`${t.id} ${s}: ${uniq.map((h) => h.name + ' ' + h.rgb8).join('; ') || 'NOT FOUND'}`);
  }
}
fs.writeFileSync(path.join(REPO, 'v2/data/roof_glass.json'), JSON.stringify(out) + '\n');
console.log(`campus ${campus.length}, clay roofs ${Object.keys(out.clay).length}, not found ${missing.length}`);
for (const m of missing) console.log('  not found:', m);
