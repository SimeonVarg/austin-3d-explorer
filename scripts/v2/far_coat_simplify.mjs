// node simplify.mjs <prefix> <abs error m> : reads <prefix>.pos.f32 / .idx.u32, writes <prefix>.out.u32 (error-bounded edge collapse, meshoptimizer)
import fs from 'node:fs';
import { MeshoptSimplifier } from 'meshoptimizer';
await MeshoptSimplifier.ready;
const [p, err, flags = 'ErrorAbsolute,Prune'] = process.argv.slice(2);
const pos = new Float32Array(new Uint8Array(fs.readFileSync(p + '.pos.f32')).buffer), idx = new Uint32Array(new Uint8Array(fs.readFileSync(p + '.idx.u32')).buffer);
const [out, e] = MeshoptSimplifier.simplify(idx, pos, 3, 0, +err, flags.split(',').filter(Boolean));
fs.writeFileSync(p + '.out.u32', Buffer.from(out.buffer, out.byteOffset, out.byteLength));
console.log(JSON.stringify({ in: idx.length / 3, out: out.length / 3, error: e }));
