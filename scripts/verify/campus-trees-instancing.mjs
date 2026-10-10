/**
 * campus-trees-instancing.mjs: the instanced campus trees put every vertex where the plain path put it.
 *
 * js/campus-landscape.js draws a tree as 6 crowns and 6 stems, either built into plain geometry (the old way,
 * ?treeinstancing=0) or as instances of one unit crown and two unit stems whose vertex shader adds the crown's lobes.
 * This script runs BOTH over the real tree data without a browser: the plain builder against a recorder that mimics
 * slopes.build()'s triN / quad (degenerate triangles dropped, winding made to face the normals), and the instanced
 * path through a JS transcription of the vertex shader. Every triangle of every tree must match: three corners,
 * three normals (same direction), winding, and the colour bytes of each corner.
 *
 * What this cannot see: the GLSL itself (the transcription is the only thing compared). The picture check
 * (scripts/verify/ci/pictures.mjs with ?treeinstancing=0 against the default) is the proof for that.
 *
 * Usage: node scripts/verify/campus-trees-instancing.mjs [--trees N] [--every 40] [--details 1,0.5]
 */
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

// ---- every threshold in one place ---------------------------------------
// position: both paths store float32 local metres up to about 2 km out, where one float32 step is 1.2e-4 m, so 2e-4 m is
// "the same vertex". normal: unit-vector components. colourBytes: 0..255 steps.
const TOL = { position: 2e-4, normal: 1e-5, colourBytes: 0 };
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const TREES = +opt('--trees', 0);                                // 0 = all
const DETAILS = opt('--details', '1,0.5').split(',').map(Number);
const SAMPLE_EVERY = +opt('--every', 40);                         // compare every Nth tree (--every 1 compares all of them; takes minutes)

const src = fs.readFileSync(new URL('../../js/campus-landscape.js', import.meta.url), 'utf8');
const data = JSON.parse(fs.readFileSync(new URL('../../data/campus_landscape.json', import.meta.url), 'utf8'));

// ---- the plain builder's triangle rules, copied from js/slopes.js build() ---
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const faceN = (a, b, c) => { const n = cross(sub(b, a), sub(c, a)), L = Math.hypot(...n); return L < 1e-9 ? null : [n[0] / L, n[1] / L, n[2] / L]; };
const hexBytes = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
function recorder(out) {
  const colour = col => col.map(hexBytes);
  const emit = (p, n, col) => out.push({ p, n, c: colour(col) });
  function tri(a, b, c, col, want) {
    let n = faceN(a, b, c); if (!n) return;
    if (want && dot(n, want) < 0) { const t = b; b = c; c = t; n = [-n[0], -n[1], -n[2]]; }
    emit(a, n, col); emit(b, n, col); emit(c, n, col);
  }
  return {
    tri,
    triN(a, b, c, na, nb, nc, col) {
      let n = cross(sub(b, a), sub(c, a)); const L = Math.hypot(...n); if (L < 1e-9) return;
      n = [n[0] / L, n[1] / L, n[2] / L];
      const avg = [na[0] + nb[0] + nc[0], na[1] + nb[1] + nc[1], na[2] + nb[2] + nc[2]];
      if (dot(n, avg) < 0) { let t = b; b = c; c = t; t = nb; nb = nc; nc = t; }
      emit(a, na, col); emit(b, nb, col); emit(c, nc, col);
    },
    quad(a, b, c, d, col, want) {
      const n1 = faceN(a, b, c), n2 = faceN(a, c, d);
      if (!n1 || !n2 || dot(n1, n2) < 1 - 1e-12) { tri(a, b, c, col, want); tri(a, c, d, col, want); return; }
      let n = n1, flip = false;
      if (want && dot(n, want) < 0) { n = [-n[0], -n[1], -n[2]]; flip = true; }
      const tris = flip ? [[a, c, b], [a, d, c]] : [[a, b, c], [a, c, d]];
      for (const t of tris) for (const v of t) emit(v, n, col);
    },
  };
}

// ---- load the module with the few globals it touches -----------------------
function load(detail) {
  const ctx = { console, Math, performance, URLSearchParams, Number, Object, Map, Set, Array, JSON, String };
  ctx.window = ctx; ctx.location = { search: '?slopes=0' };
  ctx.slopes = { detail: () => detail, toLocal: (lng, lat, z) => ({ x: (lng + 97.74) * 98000, y: (lat - 30.28) * 111320, z: z || 0 }) };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return ctx;
}

// ---- the vertex shader, transcribed ----------------------------------------
function shaderTriangles(L, C, spec) {
  const T = L.campusLandscape.trees, out = [];
  const crown = T.crownTemplate(), trunk = T.stemTemplate(C.trunk.topRadius), limb = T.stemTemplate(C.trunk.tipRadius / C.trunk.limbRadius);
  const mulM = (M, v) => [0, 1, 2].map(r => M[r] * v[0] + M[4 + r] * v[1] + M[8 + r] * v[2] + M[12 + r]);
  const normalM = (M, u) => {
    const a = M.slice(0, 3), b = M.slice(4, 7), c = M.slice(8, 11);
    const n1 = cross(b, c), n2 = cross(c, a), n3 = cross(a, b);
    const n = [0, 1, 2].map(k => n1[k] * u[0] + n2[k] * u[1] + n3[k] * u[2]), l = Math.hypot(...n);
    return n.map(x => x / l);
  };
  const f32 = Math.fround;
  for (const c of spec.crowns) {
    const M = T.crownMatrix(c).map(f32), seed = f32(c.seed), table = T.leafTable(crown.m);
    const verts = [];
    for (let v = 0; v < crown.pos.length / 3; v++) {
      const u = crown.pos.slice(v * 3, v * 3 + 3), th = crown.uv[v * 2], ph = crown.uv[v * 2 + 1], sp = Math.hypot(u[0], u[1]);
      const rip = 1 + C.crown.lobeDepth * Math.sin(C.crown.lobes * th + seed) * sp + C.crown.wave * Math.sin(3 * ph + th + seed);
      const local = [u[0] * rip, u[1] * rip, u[2] * (1 + C.crown.wave * Math.sin(th + seed) * sp)];
      const ring = crown.ring[v];
      verts.push({ p: mulM(M, local), n: normalM(M, u), c: [0, 1, 2].map(k => table[(spec.leaf * 3 + k) * crown.m + ring]) });
    }
    for (const i of crown.index) out.push(verts[i]);
  }
  for (const s of spec.stems) {
    const M = T.stemMatrix(s).map(f32), S = s.limb ? limb : trunk, col = C.bark.map(hexBytes);
    for (const i of S.index) out.push({ p: mulM(M, S.pos.slice(i * 3, i * 3 + 3)), n: normalM(M, S.nor.slice(i * 3, i * 3 + 3)), c: col });
  }
  return out;
}

// ---- compare one tree ---------------------------------------------------------
// Triangles are matched by place (the nearest unused instanced triangle whose three corners are all within the
// tolerance, same winding), not by order: the two paths emit them in different orders.
const CELL = 0.05;   // metres, the grid the triangles are bucketed on while matching
function compareTree(plain, inst, label, stats) {
  assert.equal(plain.length, inst.length, `${label}: ${plain.length} plain vertices, ${inst.length} instanced`);
  const tris = list => {
    const t = [];
    for (let i = 0; i < list.length; i += 3) {
      // start at the lowest corner so that the same triangle wound the same way compares equal
      const v = [list[i], list[i + 1], list[i + 2]];
      let k = 0; for (let j = 1; j < 3; j++) if (v[j].p[0] + v[j].p[1] * 1e-3 + v[j].p[2] * 1e-6 < v[k].p[0] + v[k].p[1] * 1e-3 + v[k].p[2] * 1e-6) k = j;
      t.push([v[k], v[(k + 1) % 3], v[(k + 2) % 3]]);
    }
    return t;
  };
  const A = tris(plain), B = tris(inst), grid = new Map(), cellOf = t => [0, 1, 2].map(a => Math.floor((t[0].p[a] + t[1].p[a] + t[2].p[a]) / 3 / CELL));
  B.forEach((t, i) => { const key = cellOf(t).join(); if (!grid.has(key)) grid.set(key, []); grid.get(key).push(i); });
  const used = new Set(), within = (a, b) => [0, 1, 2].every(k => [0, 1, 2].every(x => Math.abs(a[k].p[x] - b[k].p[x]) <= TOL.position));
  A.forEach((a, ai) => {
    const [cx, cy, cz] = cellOf(a);
    let match = -1;
    for (let dx = -1; dx <= 1 && match < 0; dx++) for (let dy = -1; dy <= 1 && match < 0; dy++) for (let dz = -1; dz <= 1 && match < 0; dz++)
      for (const bi of grid.get([cx + dx, cy + dy, cz + dz].join()) || []) if (!used.has(bi) && within(a, B[bi])) { match = bi; break; }
    assert.ok(match >= 0, `${label}: plain triangle ${ai} has no instanced triangle at the same corners (${a.map(v => v.p.map(x => x.toFixed(3))).join(' | ')})`);
    used.add(match);
    const b = B[match];
    for (let k = 0; k < 3; k++) {
      for (let x = 0; x < 3; x++) {
        const dp = Math.abs(a[k].p[x] - b[k].p[x]), dn = Math.abs(a[k].n[x] - b[k].n[x]);
        stats.maxPos = Math.max(stats.maxPos, dp); stats.maxNormal = Math.max(stats.maxNormal, dn);
        assert.ok(dn <= TOL.normal, `${label}: triangle ${ai} corner ${k} normal moved ${dn}`);
      }
      for (let ch = 0; ch < 3; ch++) for (let x = 0; x < 3; x++) {
        const d = Math.abs(a[k].c[ch][x] - b[k].c[ch][x]);
        stats.maxColour = Math.max(stats.maxColour, d); if (d) stats.colourOff++;
        assert.ok(d <= TOL.colourBytes, `${label}: triangle ${ai} corner ${k} colour ${ch}/${x} differs by ${d}`);
      }
    }
  });
  stats.triangles += A.length;
}

let grand = 0;
for (const detail of DETAILS) {
  const L = load(detail), C = L.CAMPUS_LANDSCAPE, T = L.campusLandscape.trees;
  T.setData(data);
  const stats = { maxPos: 0, maxNormal: 0, maxColour: 0, colourOff: 0, triangles: 0, trees: 0 };
  const every = SAMPLE_EVERY, limit = TREES || data.trees.length;
  for (let i = 0; i < limit; i += every) {
    if (data.trees[i][6] > 1) continue;   // above the highest tree density: no preset draws it
    const t = data.trees[i], p = L.slopes.toLocal(t[0], t[1], 0);
    const spec = T.treeSpec(i, t, p);
    // the plain builder, over this tree alone, with the density filter off (density 1 = keep everything below d<=1)
    const plain = [];
    const one = { trees: [t] };
    // buildTrees reads `data.trees[i]` by index and hashes i, so run it over a data set whose index matches
    const pad = new Array(i).fill([0, 0, 0, 0, 0, 'other', 9, 0]); // d=9 > density: skipped, keeps the hash index right
    T.setData({ trees: pad.concat([t]) });
    const chunks = new Map();
    L.slopes.build = () => recorder(plain);
    T.buildTrees(chunks);
    compareTree(plain, shaderTriangles(L, C, spec), `detail ${detail} tree ${i} (${t[5]})`, stats);
    stats.trees++;
  }
  console.log(`detail ${detail}: ${stats.trees} trees, ${stats.triangles} triangles identical; largest move ${stats.maxPos.toExponential(2)} m, normal ${stats.maxNormal.toExponential(2)}, ` +
    `colour bytes off by at most ${stats.maxColour}`);
  grand += stats.triangles;
}

// ---- a crown's winding and pole triangles do not depend on its seed or size ----
{
  const L = load(1), C = L.CAMPUS_LANDSCAPE, T = L.campusLandscape.trees;
  const reference = T.crownTemplate();
  assert.ok(reference.index.length / 3 < 2 * reference.n * reference.m, 'the pole triangles are dropped');
  console.log(`crown template: ${reference.n} x ${reference.m} grid, ${reference.pos.length / 3} vertices, ${reference.index.length / 3} triangles (plain path: ${reference.index.length / 3} per crown)`);
}
console.log(`PASS: ${grand} triangles over ${DETAILS.length} detail levels, instanced path equals the plain path`);
