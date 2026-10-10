// Records every tri / quad / triN / facet call the REAL apartment generator makes into the shared builder
// (the stream that js/slopes.js build() turns into vertex buffers), plus the buffers the real builder
// produced from it. The kernel benchmark replays the stream through three builders and checks all three
// reproduce those buffers byte for byte.
//
//   THREE_JS=... node record-stream.mjs <outDir> [--only "The Standard,Icon"]
//
// Files written to <outDir>:
//   stream.f64       records of 28 doubles: [op, colId, hasWant, wx,wy,wz, ax,ay,az, bx..bz, cx..cz, dx..dz, nax..naz, nbx..nbz, ncx..ncz, facet]
//                    op 0=tri(a,b,c,want) 1=quad(a,b,c,d,want) 2=triN(a,b,c,na,nb,nc) 3=facet(flag in field 27)
//   palette.json     colId -> { hex: [day, golden, night], surface: [4 floats] | null }
//   expected.json    counts, and a sha256 of every attribute array the REAL builder produced
import fs from 'node:fs'; import crypto from 'node:crypto'; import path from 'node:path';
import { loadApp } from './app-env.mjs';
const outDir = process.argv[2]; if (!outDir) throw new Error('usage: record-stream.mjs <outDir> [--only "a,b"]');
const onlyAt = process.argv.indexOf('--only'); if (onlyAt > 0) process.env.ONLY = process.argv[onlyAt + 1];
fs.mkdirSync(outDir, { recursive: true });
const { A, specs, ctx } = await loadApp({ record: true });

const REC = 28;
let buf = new Float64Array(REC * (1 << 16)), n = 0;
// A tone is its three hexes plus its optional surface quad. The app keys its colour cache on the array OBJECT,
// so a window cell that copies its pane tone makes a fresh entry each time; the bytes only depend on the value.
const palette = [], ids = new Map();
const idOf = col => { const key = col[0] + col[1] + col[2] + (col.surface ? col.surface.join(',') : ''); let i = ids.get(key); if (i === undefined) { i = palette.length; ids.set(key, i); palette.push({ hex: [col[0], col[1], col[2]], surface: col.surface ? Array.from(col.surface) : null }); } return i; };
const put = (o, p) => { if (p) { buf[o] = p[0]; buf[o + 1] = p[1]; buf[o + 2] = p[2]; } };
ctx.__REC = (op, a, b, c, d, col, want, na, nb, nc, flag) => {
  if (n * REC >= buf.length) { const g = new Float64Array(buf.length * 2); g.set(buf); buf = g; }
  const o = n * REC; n++;
  buf[o] = op;
  if (op === 3) { buf[o + 27] = flag ? 1 : 0; return; }
  buf[o + 1] = idOf(col);
  if (want) { buf[o + 2] = 1; put(o + 3, want); }
  put(o + 6, a); put(o + 9, b); put(o + 12, c); put(o + 15, d); put(o + 18, na); put(o + 21, nb); put(o + 24, nc);
};
const g = await A.build(specs);
ctx.__REC = null;
const sha = a => crypto.createHash('sha256').update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest('hex');
const expected = { records: n, palette: palette.length, meshes: [] };
g.traverse(o => { if (!o.isMesh) return; const gm = o.geometry, e = { vertices: gm.attributes.position.count, indices: gm.index.count, sha: {} };
  for (const k in gm.attributes) e.sha[k] = sha(gm.attributes[k].array); e.sha.index = sha(gm.index.array); expected.meshes.push(e); });
fs.writeFileSync(path.join(outDir, 'stream.f64'), Buffer.from(buf.buffer, 0, n * REC * 8));
fs.writeFileSync(path.join(outDir, 'palette.json'), JSON.stringify(palette));
fs.writeFileSync(path.join(outDir, 'expected.json'), JSON.stringify(expected, null, 1));
console.error(`recorded ${n} records (${(n * REC * 8 / 1048576).toFixed(0)} MB), ${palette.length} palette entries, ${expected.meshes.length} mesh(es), ${expected.meshes.map(m => m.vertices).join('+')} vertices`);
