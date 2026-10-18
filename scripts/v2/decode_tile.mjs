// Decode a v2 tile (Meshopt + quantized) into a plain .glb (float positions, world frame) for checking it without a browser.
//   node scripts/v2/decode_tile.mjs v2/tiles/t_0_-3.glb OUT.glb
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize, flatten, clearNodeTransform } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const [src, dst] = process.argv.slice(2);
const doc = await io.read(src);
await doc.transform(dequantize(), flatten());
for (const n of doc.getRoot().listNodes()) if (n.getMesh()) clearNodeTransform(n);
for (const e of doc.getRoot().listExtensionsUsed()) if (e.extensionName === 'EXT_meshopt_compression' || e.extensionName === 'KHR_mesh_quantization') e.dispose();
await io.write(dst, doc);
const meshes = doc.getRoot().listMeshes().map((m) => `${m.getName()}: ${m.listPrimitives().map((p) => `${p.getIndices().getCount() / 3} tris ${p.listSemantics().join('/')}`).join(', ')}`);
console.log('DECODED', src, '->', dst, meshes.join(' | '));
