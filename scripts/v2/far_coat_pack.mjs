// node scripts/v2/far_coat_pack.mjs <in.glb> <out.glb>: weld + quantize + Meshopt for a far copy (far_coat.py); the WebP picture passes through.
import { NodeIO, Logger } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const [src, dst] = process.argv.slice(2);
const doc = await io.read(src); doc.setLogger(new Logger(Logger.Verbosity.ERROR));
await doc.transform(weld(), meshopt({ encoder: MeshoptEncoder, level: 'high', quantizePosition: 16, quantizeNormal: 8, quantizeTexcoord: 14 }));
await io.write(dst, doc);
const p = doc.getRoot().listMeshes()[0].listPrimitives()[0];
console.log(JSON.stringify({ triangles: p.getIndices().getCount() / 3, vertices: p.getAttribute('POSITION').getCount() }));
