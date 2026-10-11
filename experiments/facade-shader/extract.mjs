/**
 * extract.mjs - take ONE authored tower out of the app's own built geometry (the dump of
 * experiments/renderer/dump-apartments.mjs) and write the small fixture the facade-shader prototype draws.
 *
 *   node experiments/facade-shader/extract.mjs [--dump <dir>] [--slug dobie-twenty21] [--band tower]
 *
 * Reads   <dump>/apartments.json + apartments.bin     the app's arrays, as the page builds them at run time
 *         data/apartments/<slug>.json                 the recipe (hand-authored numbers)
 * Writes  fixture/<slug>.facade.bin.gz   the triangles the cell tiler made for the tower's window wall, in the
 *                                        renderer study's 24-byte packed vertex (so "the app's own geometry")
 *         fixture/<slug>.rest.bin.gz     every other triangle of the building (podium, crown, roof): drawn the same
 *                                        in both arms, only for the pictures
 *         fixture/<slug>.json            metadata: faces (one rectangle per wall), the recipe's pattern numbers,
 *                                        tone triples, the light uniforms, byte counts of the app's own format
 *
 * HOW THE FACES ARE FOUND. The wall of a face is a plane; the cell tiler emits its "field" cells (the spandrel
 * tone) on it, so the faces are the planes holding field-coloured, vertical triangles, split where they are not
 * contiguous. A triangle is "facade" if it lies on such a plane within the window reveal (0.06 m) behind it, inside
 * the face's rectangle. That covers the field cells, the glass cells (set back by the reveal) and the reveal strips.
 * In a production bake the same rectangles come straight from the ring (the generator's wallFrame); finding them in
 * the geometry here keeps the prototype independent of the generator's frame code and tests the one thing under test:
 * the SHADER's pattern against the geometry's, with the pattern numbers read from the recipe.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const DUMP = opt('--dump', process.env.RENDERER_OUT || path.join(process.env.HOME, 'flyover-private/renderer-2026-10-09'));
const SLUG = opt('--slug', 'dobie-twenty21');
const BAND = opt('--band', 'tower');
const OUT = path.join(HERE, 'fixture');
fs.mkdirSync(OUT, { recursive: true });

const recipe = JSON.parse(fs.readFileSync(path.join(REPO, 'data/apartments', SLUG + '.json'), 'utf8'));
const man = JSON.parse(fs.readFileSync(path.join(DUMP, 'apartments.json'), 'utf8'));
const bin = fs.readFileSync(path.join(DUMP, 'apartments.bin'));
const ab = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);
const CT = { Float32Array, Uint32Array, Uint16Array, Int16Array, Uint8Array, Int8Array, Int32Array, Float64Array };
const view = d => new CT[d.type](ab, d.offset, d.bytes / CT[d.type].BYTES_PER_ELEMENT);
const m = man.meshes[0];
const bi = man.buildings.findIndex(b => b.name === recipe.name);
if (bi < 0) throw new Error('building not in the dump: ' + recipe.name);
const c = m.cull, start = view(c.start)[bi], count = view(c.count)[bi];
const P = view(m.attrs.position), N = view(m.attrs.normal), D = view(m.attrs.cDay), G = view(m.attrs.cGold), NI = view(m.attrs.cNight), IDX = view(m.index);
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const tri = [];
for (let k = start; k < start + count; k += 3) tri.push([IDX[k], IDX[k + 1], IDX[k + 2]]);
console.log(`${recipe.name}: ${tri.length} triangles in the dump (app: ${(m.vertexCount)} vertices in the mesh)`);

// ---- the band: the recipe's window wall -----------------------------------------------------------------------------------------
const blk = recipe.blocks.find(b => b.id === BAND);
const skinName = blk.bands[0].skin, skin = recipe.skins[skinName];
if (skin.kind !== 'bays' || !skin.window || skin.strip || skin.fields || skin.louvre) throw new Error('this prototype handles the plain bays skin: ' + JSON.stringify(skin).slice(0, 200));
const z0 = blk.bands[0].z0, z1 = blk.bands[0].z1;
const fieldTone = skin.field, glassTone = skin.glass, revealTone = skin.frame;
const fieldRGB = hex(recipe.colours[fieldTone].hex);
const same = (v, rgb) => D[v * 3] === rgb[0] && D[v * 3 + 1] === rgb[1] && D[v * 3 + 2] === rgb[2];

// ---- 1. faces: planes holding vertical field-coloured triangles --------------------------------------------------------------
const cand = [];
for (const t of tri) {
  const [a, b, cc] = t;
  if (!same(a, fieldRGB)) continue;
  const nx = N[a * 3], ny = N[a * 3 + 1], nz = N[a * 3 + 2];
  if (Math.abs(nz) > 0.02) continue;
  const zs = [P[a * 3 + 2], P[b * 3 + 2], P[cc * 3 + 2]];
  if (Math.min(...zs) < z0 - 0.01 || Math.max(...zs) > z1 + 0.01) continue;
  const ang = Math.atan2(ny, nx) * 180 / Math.PI;
  const d = nx * P[a * 3] + ny * P[a * 3 + 1];
  const s = [a, b, cc].map(v => -ny * P[v * 3] + nx * P[v * 3 + 1]);
  cand.push({ ang, nx, ny, d, s0: Math.min(...s), s1: Math.max(...s), zlo: Math.min(...zs), zhi: Math.max(...zs) });
}
// group by normal direction (gap > 0.05 degrees starts a new direction), not by rounding: a rounded bucket splits a plane whose
// angle sits on a bucket edge into two partial faces
cand.sort((p, q) => p.ang - q.ang);
const groups = []; { let g = null; for (const q of cand) { if (g && q.ang - g[g.length - 1].ang <= 0.05) g.push(q); else { g = [q]; groups.push(g); } } }
const faces = [];
for (const arr of groups) {
  arr.sort((p, q) => p.d - q.d);
  let cur = [arr[0]];
  const flush = () => {
    // one plane: split into contiguous segments along s
    cur.sort((p, q) => p.s0 - q.s0);
    let seg = null;
    const out = [];
    for (const q of cur) { if (seg && q.s0 <= seg.s1 + 0.02) { seg.s1 = Math.max(seg.s1, q.s1); seg.zlo = Math.min(seg.zlo, q.zlo); seg.zhi = Math.max(seg.zhi, q.zhi); seg.sx.push(q); } else { if (seg) out.push(seg); seg = { s0: q.s0, s1: q.s1, zlo: q.zlo, zhi: q.zhi, nx: q.nx, ny: q.ny, sx: [q] }; } }
    if (seg) out.push(seg);
    for (const sg of out) { const dd = sg.sx.reduce((a, q) => a + q.d, 0) / sg.sx.length; faces.push({ nx: sg.nx, ny: sg.ny, d: dd, s0: sg.s0, s1: sg.s1, z0: sg.zlo, z1: sg.zhi }); }
  };
  for (let i = 1; i < arr.length; i++) { if (arr[i].d - cur[cur.length - 1].d > 0.03) { flush(); cur = [arr[i]]; } else cur.push(arr[i]); }
  flush();
}
// normalise each face's normal and drop slivers
for (const f of faces) { const l = Math.hypot(f.nx, f.ny); f.nx /= l; f.ny /= l; f.L = f.s1 - f.s0; }
const kept = faces.filter(f => f.L > 0.3 && f.z1 - f.z0 > 5);
if (process.env.DEBUG_FACES) for (const f of faces.filter(f => !(f.L > 0.3 && f.z1 - f.z0 > 5)).slice(0, 25)) console.log('dropped', f.L.toFixed(3), f.z0.toFixed(2), f.z1.toFixed(2), (Math.atan2(f.ny, f.nx) * 180 / Math.PI).toFixed(2), f.d.toFixed(2));
console.log(`faces: ${kept.length} (dropped ${faces.length - kept.length} slivers); lengths ${Math.min(...kept.map(f => f.L)).toFixed(2)} to ${Math.max(...kept.map(f => f.L)).toFixed(2)} m, z ${Math.min(...kept.map(f => f.z0)).toFixed(2)} to ${Math.max(...kept.map(f => f.z1)).toFixed(2)}`);

// ---- 2. classify every triangle -----------------------------------------------------------------------------------------------------
const REV = (skin.reveal != null ? skin.reveal : 0.1);
const facesOf = (v) => {
  const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2], out = [];
  for (let i = 0; i < kept.length; i++) {
    const f = kept[i];
    if (z < f.z0 - 0.01 || z > f.z1 + 0.01) continue;
    const dl = f.nx * x + f.ny * y - f.d; if (dl > 0.01 || dl < -(REV + 0.01)) continue;
    const s = -f.ny * x + f.nx * y; if (s < f.s0 - 0.011 || s > f.s1 + 0.011) continue;
    out.push(i);
  }
  return out;
};
// a corner vertex lies on two faces; a triangle belongs to the face ALL its vertices lie on
const faceOf = t => { const a = facesOf(t[0]), b = facesOf(t[1]), c = facesOf(t[2]); return a.find(i => b.includes(i) && c.includes(i)) ?? -1; };
const facadeTris = [], restTris = [], faceTris = kept.map(() => 0);
for (const t of tri) { const f = faceOf(t); if (f >= 0) { facadeTris.push(t); faceTris[f]++; } else restTris.push(t); }
console.log(`facade triangles ${facadeTris.length}, the rest ${restTris.length}`);
if (process.env.DEBUG_FACES) { let n = 0; for (const t of restTris) { const v = t[0]; if (!same(v, fieldRGB) || Math.abs(N[v * 3 + 2]) > 0.02) continue; const z = P[v * 3 + 2]; if (z < 17 || z > 79) continue; if (n++ > 6) break; console.log('rest', faceOf(t), t.map(q => [P[q * 3].toFixed(2), P[q * 3 + 1].toFixed(2), P[q * 3 + 2].toFixed(2)].join('/')).join(' | '), 'n', N[v * 3].toFixed(3), N[v * 3 + 1].toFixed(3)); } }

// ---- 3. pack both sets in the study's 24-byte vertex, one chunk each ---------------------------------------------------------
function pack(tris, name) {
  const map = new Map(), verts = [];
  const ib = new Uint32Array(tris.length * 3);
  tris.forEach((t, k) => t.forEach((v, j) => { let i = map.get(v); if (i === undefined) { i = verts.length; map.set(v, i); verts.push(v); } ib[k * 3 + j] = i; }));
  let x0 = 1e9, y0 = 1e9, z0_ = 1e9, x1 = -1e9, y1 = -1e9, z1_ = -1e9;
  for (const v of verts) { const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2]; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); z0_ = Math.min(z0_, z); z1_ = Math.max(z1_, z); }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0_ + z1_) / 2, ext = Math.max(x1 - x0, y1 - y0, z1_ - z0_) / 2, scale = ext / 32767;
  const vb = new ArrayBuffer(verts.length * 24), v16 = new Int16Array(vb), v8 = new Int8Array(vb), u16 = new Uint16Array(vb), u8 = new Uint8Array(vb);
  let maxErr = 0;
  verts.forEach((v, o) => {
    const q = [0, 1, 2].map(j => Math.round((P[v * 3 + j] - [cx, cy, cz][j]) / scale));
    q.forEach((qq, j) => { v16[o * 12 + j] = qq; maxErr = Math.max(maxErr, Math.abs(qq * scale + [cx, cy, cz][j] - P[v * 3 + j])); });
    u16[o * 12 + 3] = 0;
    for (let j = 0; j < 3; j++) v8[o * 24 + 8 + j] = Math.round(N[v * 3 + j] * 127);
    v8[o * 24 + 11] = 0;
    for (let j = 0; j < 3; j++) { u8[o * 24 + 12 + j] = D[v * 3 + j]; u8[o * 24 + 16 + j] = G[v * 3 + j]; u8[o * 24 + 20 + j] = NI[v * 3 + j]; }
    u8[o * 24 + 15] = 0; u8[o * 24 + 19] = 0; u8[o * 24 + 23] = 0;
  });
  const table = new Float32Array([cx, cy, cz, scale]);
  const vBytes = verts.length * 24, iBytes = ib.byteLength;
  const out = Buffer.alloc(vBytes + iBytes + 16);
  Buffer.from(vb).copy(out, 0); Buffer.from(ib.buffer).copy(out, vBytes); Buffer.from(table.buffer).copy(out, vBytes + iBytes);
  fs.writeFileSync(path.join(OUT, `${SLUG}.${name}.bin.gz`), zlib.gzipSync(out, { level: 9 }));
  console.log(`${name}: ${verts.length} vertices, ${tris.length} triangles, ${(out.length / 1e6).toFixed(2)} MB raw, ${(fs.statSync(path.join(OUT, `${SLUG}.${name}.bin.gz`)).size / 1e6).toFixed(2)} MB gz; max quantisation error ${(maxErr * 1000).toFixed(2)} mm`);
  // what the same triangles cost in the app's own arrays (55.7 B/vertex incl. the four-float surface attribute, 4 B indices)
  const appBytes = verts.length * (12 + 12 + 3 * 3 + 1 + 16) + tris.length * 3 * 4;
  return { vertexCount: verts.length, indexCount: tris.length * 3, triangles: tris.length, vertexBytes: vBytes, indexBytes: iBytes, centre: [cx, cy, cz], scale, appBytes, bbox: [x0, y0, z0_, x1, y1, z1_] };
}
// THE GENERATOR'S METRES ARE NOT QUITE THE MAP'S. js/slopes-apartments.js turns a recipe metre into degrees with 111320*cos(lat)
// (east) and 110540 (north), and the map turns degrees into local metres with its own sphere (111194.9 m a degree, times cos(lat)
// east): so a recipe metre is 0.99887 local metres going east and 1.00592 going north. A wall's own scale is the mix along its
// direction. Measured below against the glass cells.
const R_EARTH = 6371008.8, M_DEG = 2 * Math.PI * R_EARTH / 360;
const SX = M_DEG / 111320, SY = M_DEG / 110540;                       // lat factors cancel (cos(lat0) of the ring against cos(lat) of the origin differ by 6e-6)
for (const f of kept) { const tx = -f.ny, ty = f.nx; f.hs = Math.hypot(SX * tx, SY * ty); }
const glassRGB = hex(recipe.colours[skin.glass].hex), wd = [];
for (const t of facadeTris) {
  if (!t.every(v => same(v, glassRGB))) continue;
  const f = kept[faceOf(t)]; const ss = t.map(v => -f.ny * P[v * 3] + f.nx * P[v * 3 + 1]);
  wd.push((Math.max(...ss) - Math.min(...ss)) / (skin.window.w * f.hs));
}
wd.sort((a, b) => a - b);
console.log(`glass cell width / (recipe width x predicted wall scale): median ${wd[wd.length >> 1].toFixed(5)}, range ${wd[0].toFixed(4)} to ${wd[wd.length - 1].toFixed(4)} over ${wd.length} glass triangles (1 means the scale is right)`);
const fa = pack(facadeTris, 'facade'), re = pack(restTris, 'rest');

// ---- 4. the recipe's pattern numbers (the ONLY inputs the shader gets besides the face rectangles) ----------------------------
const win = skin.window;
const floors = recipe.levels.floors.filter(f => f >= z0 - 1e-6 && f < z1 - 1e-6);
const rows = floors.filter(f => f + (win.sill ?? 0.8) + win.h <= z1 + 1e-6);
const pitches = new Set(); for (let i = 1; i < rows.length; i++) pitches.add(+(rows[i] - rows[i - 1]).toFixed(4));
if (pitches.size > 1) throw new Error('floors are not evenly spaced; the prototype needs one pitch per band: ' + [...pitches]);
const tone = t => ({ name: t, day: hex(recipe.colours[t].hex) });
const vtxOfTone = rgb => { for (const t of facadeTris) for (const v of t) if (D[v * 3] === rgb[0] && D[v * 3 + 1] === rgb[1] && D[v * 3 + 2] === rgb[2]) return v; return -1; };
const triple = t => { const v = vtxOfTone(hex(recipe.colours[t].hex)); return v < 0 ? null : { day: [0, 1, 2].map(j => D[v * 3 + j]), gold: [0, 1, 2].map(j => G[v * 3 + j]), night: [0, 1, 2].map(j => NI[v * 3 + j]) }; };
const meta = {
  format: 'facade-fixture-1', slug: SLUG, name: recipe.name, band: BAND, skinName, source: 'data/apartments/' + SLUG + '.json',
  dumpWhen: man.when, buildingTriangles: tri.length,
  frameScale: { sx: SX, sy: SY }, recipe: { bay: skin.bay, window: { w: win.w, h: win.h, sill: win.sill }, reveal: REV, z0, z1, rowFirst: rows[0], rowPitch: rows.length > 1 ? rows[1] - rows[0] : 3, rowCount: rows.length, fieldTone, glassTone, revealTone },
  tones: { field: triple(fieldTone), glass: triple(glassTone), reveal: triple(revealTone) },
  faces: kept.map(f => ({ hs: +f.hs.toFixed(6), nx: +f.nx.toFixed(6), ny: +f.ny.toFixed(6), d: +f.d.toFixed(4), s0: +f.s0.toFixed(4), s1: +f.s1.toFixed(4), z0: +f.z0.toFixed(4), z1: +f.z1.toFixed(4) })),
  facade: fa, rest: re,
  mesh: { wholeCityVertices: m.vertexCount, wholeCityTriangles: man.count.triangles },
  light: (() => { try { const fr = JSON.parse(fs.readFileSync(path.join(DUMP, 'frames.json'), 'utf8')).views; const pick = k => { const u = fr[k].u; return { lightpos: u.u_lightpos, lightcolor: u.u_lightcolor, lightintensity: u.u_lightintensity, materialP: u.u_materialP, opacity: u.u_opacity }; }; return { day: pick('spawn-day'), golden: pick('spawn-golden'), source: 'the real app, uniforms read off its material at the spawn camera (renderer study frames.json)' }; } catch (e) { return null; } })(),
};
fs.writeFileSync(path.join(OUT, SLUG + '.json'), JSON.stringify(meta));
console.log('wrote', path.join(OUT, SLUG + '.json'), 'rows', rows.length, 'pitch', meta.recipe.rowPitch, 'tones', JSON.stringify(meta.tones));
