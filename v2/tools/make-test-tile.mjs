// Makes the TEST tile set in v2/test-tiles/ so the v2 loader can be exercised before the real Blender tiles land
// (they are built on mac/v2-tiles into v2/tiles/). Open the app with ?tiles=test to load it.
//
// It takes ONE real Blender build (26 West, data/gltf/26-west-look.glb.gz), places it in the v2 frame (v2/geo.js), and writes
// it twice in the contract's format: lod0 meshopt-compressed + quantized, lod1 simplified to about a quarter of the triangles.
//
// Run from the repo root, with the packages below installed anywhere on NODE_PATH (dev only, nothing ships):
//   npm i @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 meshoptimizer@0.22
//   node v2/tools/make-test-tile.mjs
import fs from 'node:fs';
import zlib from 'node:zlib';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, quantize, meshopt, simplify, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { toLocal, tileOf, TILE_M, ORIGIN } from '../geo.js';

// Where the model's own origin stands (js/gltf-layer.js, the "26 West" row: origin = mean of its surveyed outline).
const SRC = 'data/gltf/26-west-look.glb.gz';
const LNG = -97.7436263, LAT = 30.2913934;
const MAP_IDS = ['9363b194', '38b2cf1c', '23994eaf', '529724dc'];
const SLUG = '26-west';

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

const [x, z] = toLocal(LNG, LAT);
const [i, j] = tileOf(x, z);
const id = `t_${i}_${j}`;
fs.mkdirSync('v2/test-tiles/tiles', { recursive: true });

async function build(far) {
  const doc = await io.readBinary(new Uint8Array(zlib.gunzipSync(fs.readFileSync(SRC))));
  const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];
  const root = doc.createNode(SLUG).setTranslation([x, 0, z]);
  for (const n of scene.listChildren()) { scene.removeChild(n); root.addChild(n); }
  scene.addChild(root);
  const steps = [dedup(), weld()];
  if (far) steps.push(simplify({ simplifier: MeshoptSimplifier, ratio: 0.25, error: 0.01 }));
  steps.push(prune(), quantize(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await doc.transform(...steps);
  return io.writeBinary(doc);
}

const lod0 = await build(false), lod1 = await build(true);
fs.writeFileSync(`v2/test-tiles/tiles/${id}.glb`, lod0);
fs.writeFileSync(`v2/test-tiles/tiles/${id}.far.glb`, lod1);
const manifest = {
  origin: { lat: ORIGIN.lat, lon: ORIGIN.lon },
  frame: 'local metres: x east, y up (metres above the origin ground), z south (three.js); v2/geo.js',
  note: 'TEST tile set made by v2/tools/make-test-tile.mjs (one Blender build, 26 West). The real set is v2/tiles/manifest.json.',
  tiles: [{ id, bounds: [i * TILE_M, j * TILE_M, (i + 1) * TILE_M, (j + 1) * TILE_M],
    lod0: `test-tiles/tiles/${id}.glb`, lod1: `test-tiles/tiles/${id}.far.glb`, buildings: [SLUG] }],
  buildings: { [SLUG]: { tile: id, map_ids: MAP_IDS, name: '26 West' } },
};
fs.writeFileSync('v2/test-tiles/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
console.log(id, 'lod0', lod0.byteLength, 'lod1', lod1.byteLength, 'at', x.toFixed(1), z.toFixed(1));
