/**
 * verify-recipe.mjs - THE CORRECTNESS TEST OF THE IDEA, no GPU, no browser, no dump needed (it reads the fixture).
 *
 * Question: do the window rectangles that the recipe's numbers predict (lib/pattern.mjs windowsFor, the same rule the
 * shader draws) land where the app's own geometry has its glass cells, on every wall of the tower?
 *
 *   node experiments/facade-shader/verify-recipe.mjs [--slug dobie-twenty21] [--tol 0.003]
 *
 * For each wall: the glass cells are read out of the fixture's triangles (vertices set back by the reveal, in the
 * glass tone), joined into rectangles, expressed in the wall's own (s, z); the predicted rectangles are matched to them
 * one to one (the wall runs the same either way round, the pattern being mirror-symmetric, so both directions are tried).
 * Exit code 1 when any wall disagrees by more than the tolerance (metres) or the counts differ.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { windowsFor } from './lib/pattern.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SLUG = opt('--slug', 'dobie-twenty21'), TOL = +opt('--tol', '0.005');
const meta = JSON.parse(fs.readFileSync(path.join(HERE, 'fixture', SLUG + '.json'), 'utf8'));
const raw = zlib.gunzipSync(fs.readFileSync(path.join(HERE, 'fixture', SLUG + '.facade.bin.gz')));
const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length);
const F = meta.facade, v16 = new Int16Array(ab, 0, F.vertexCount * 12), u8 = new Uint8Array(ab, 0, F.vertexBytes), idx = new Uint32Array(ab, F.vertexBytes, F.indexCount);
const [cx, cy, cz] = F.centre, sc = F.scale, glass = meta.tones.glass.day;
const pos = v => [v16[v * 12] * sc + cx, v16[v * 12 + 1] * sc + cy, v16[v * 12 + 2] * sc + cz];
const isGlass = v => u8[v * 24 + 12] === glass[0] && u8[v * 24 + 13] === glass[1] && u8[v * 24 + 14] === glass[2];

// glass triangles -> rectangles (join triangles that share a vertex)
const parent = new Map(); const find = a => { while (parent.get(a) !== a) { parent.set(a, parent.get(parent.get(a))); a = parent.get(a); } return a; };
const gt = [];
for (let k = 0; k < idx.length; k += 3) { const t = [idx[k], idx[k + 1], idx[k + 2]]; if (!t.every(isGlass)) continue; gt.push(t); for (const v of t) if (!parent.has(v)) parent.set(v, v); parent.set(find(t[0]), find(t[1])); parent.set(find(t[1]), find(t[2])); }
const comps = new Map(); for (const t of gt) for (const v of t) { const r = find(v); if (!comps.has(r)) comps.set(r, new Set()); comps.get(r).add(v); }
const rects = [...comps.values()].map(S => { const ps = [...S].map(pos); return ps; });

let bad = 0, totalPred = 0, totalAct = 0, worst = 0;
const byFace = meta.faces.map(() => []);
for (const ps of rects) {
  // the wall the rectangle sits on: the face whose plane it is within the reveal behind, and whose s range holds it
  const cxm = ps.reduce((a, p) => a + p[0], 0) / ps.length, cym = ps.reduce((a, p) => a + p[1], 0) / ps.length, czm = ps.reduce((a, p) => a + p[2], 0) / ps.length;
  let hit = -1;
  meta.faces.forEach((f, i) => { const dl = f.nx * cxm + f.ny * cym - f.d, s = -f.ny * cxm + f.nx * cym; if (Math.abs(dl + meta.recipe.reveal) < 0.004 && s > f.s0 && s < f.s1 && czm > f.z0 && czm < f.z1) hit = i; });
  if (hit < 0) { bad++; console.log('a glass rectangle belongs to no wall', cxm, cym, czm); continue; }
  const f = meta.faces[hit], ss = ps.map(p => -f.ny * p[0] + f.nx * p[1] - f.s0), zs = ps.map(p => p[2]);
  byFace[hit].push({ s0: Math.min(...ss), s1: Math.max(...ss), z0: Math.min(...zs), z1: Math.max(...zs) });
}
meta.faces.forEach((f, i) => {
  const L = f.s1 - f.s0, pred = windowsFor(L, meta.recipe, f.hs), act = byFace[i];
  totalPred += pred.length; totalAct += act.length;
  if (pred.length !== act.length) { bad++; console.log(`wall ${i}: L ${L.toFixed(3)} predicted ${pred.length} windows, geometry has ${act.length}`); return; }
  const cmp = (flip) => { // greedy match after sorting by (z, s)
    const A = act.map(r => flip ? { s0: L - r.s1, s1: L - r.s0, z0: r.z0, z1: r.z1 } : r);
    const key = r => [Math.round(r.z0 * 100), r.s0];
    const sa = A.slice().sort((p, q) => key(p)[0] - key(q)[0] || p.s0 - q.s0), sp = pred.slice().sort((p, q) => key(p)[0] - key(q)[0] || p.s0 - q.s0);
    if (false && i === 26 && !flip) sa.slice(0, 3).forEach((r, j) => console.log('act', JSON.stringify(r), 'pred', JSON.stringify(sp[j])));
    let e = 0; sa.forEach((r, j) => { e = Math.max(e, Math.abs(r.s0 - sp[j].s0), Math.abs(r.s1 - sp[j].s1), Math.abs(r.z0 - sp[j].z0), Math.abs(r.z1 - sp[j].z1)); }); return e;
  };
  const e = Math.min(cmp(false), cmp(true)); worst = Math.max(worst, e);
  if (e > TOL) { bad++; console.log(`wall ${i}: L ${L.toFixed(3)} worst edge error ${(e * 1000).toFixed(1)} mm`); }
});
console.log(`${meta.name}: ${meta.faces.length} walls, ${totalAct} glass cells in the geometry, ${totalPred} windows predicted from the recipe; worst edge error ${(worst * 1000).toFixed(2)} mm (tolerance ${TOL * 1000} mm); ${bad ? bad + ' PROBLEM(S)' : 'every wall agrees'}`);
process.exit(bad ? 1 : 0);
