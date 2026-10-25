// v2-pokes.mjs - parts of one Blender model that stand up through ANOTHER Blender model's roof (no browser; world-space triangles from
// loadTileTriangles). Shared by scripts/verify/v2-tile-pokes.mjs (the check) and scripts/v2/clip_tiles.mjs (the pipeline stage that hides them).
//
// Why a check by geometry, not by names: the tile is one merged mesh (v2/tiles/t_*.glb, one draw), the parts have no names left, and a
// poke is a fact about two models together (2026-10-24: DKR's guessed entry-pavilion canopy, a 34 m slab sloping 12.4 -> 10.2 m, stood
// 0.3-0.5 m above Moncrief-Neuhaus's red hall roof, 12.0-12.4 m, and drew as a tan patch on it).
//
// Rule. B's roof = the highest UP-facing surface of B in every ROOF_CELL_M cell; a cell is B's INTERIOR when its eight neighbours are
// roof too (a wall that abuts B at its edge never counts). A triangle of A POKES when it faces up (ny >= UP_NY) and, sampled at its
// corners, middle and on a ROOF_CELL_M grid inside B's interior, it is both ABOVE the roof by more than EPS_M and BELOW it by more than
// EPS_M: it crosses B's roof surface, so part of it is buried and part shows (a part resting on the roof, or a wall at B's edge, does not
// cross). A PART is the flagged triangles plus everything connected to them by shared corners (welded to WELD_M). Parts bigger than
// MAX_PART_TRIS triangles or MAX_PART_M metres are two buildings overlapping, not a part poking, and are listed as `deep`.
export const POKE = {
  ROOF_CELL_M: 1, UP_NY: 0.5, EPS_M: 0.05, WELD_M: 0.01,
  MAX_PART_TRIS: 400, MAX_PART_M: 60,
  SHOW_M: 1.5,            // a part that stands this far (or less) above B's roof is a poke; higher is an overlap of two tall things (deep)
};

function bboxOf(tris) {
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tris.length; i += 3) for (let k = 0; k < 3; k++) { const v = tris[i + k]; if (v < b[k]) b[k] = v; if (v > b[k + 3]) b[k + 3] = v; }
  return b;
}
const hit = (a, c, m = 0) => a[0] <= c[3] + m && a[3] >= c[0] - m && a[2] <= c[5] + m && a[5] >= c[2] - m;
function normalY(t, o) {
  const ux = t[o + 3] - t[o], uy = t[o + 4] - t[o + 1], uz = t[o + 5] - t[o + 2], vx = t[o + 6] - t[o], vy = t[o + 7] - t[o + 1], vz = t[o + 8] - t[o + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  return ny / (Math.hypot(nx, ny, nz) || 1);
}
const cellKey = (i, j) => i * 65536 + j;

// B's roof raster: Map cellKey -> highest up-facing y; and its interior test
export function roofOf(tris, C = POKE.ROOF_CELL_M) {
  const ras = new Map();
  for (let i = 0; i < tris.length; i += 9) {
    if (normalY(tris, i) < POKE.UP_NY) continue;
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = tris.subarray(i, i + 9);
    const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(den) < 1e-9) continue;
    const x0 = Math.floor(Math.min(ax, bx, cx) / C), x1 = Math.floor(Math.max(ax, bx, cx) / C), z0 = Math.floor(Math.min(az, bz, cz) / C), z1 = Math.floor(Math.max(az, bz, cz) / C);
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const px = (x + 0.5) * C, pz = (z + 0.5) * C;
      const l1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / den, l2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / den, l3 = 1 - l1 - l2;
      if (l1 < -0.02 || l2 < -0.02 || l3 < -0.02) continue;
      const y = l1 * ay + l2 * by + l3 * cy, k = cellKey(x, z);
      if (!(ras.get(k) >= y)) ras.set(k, y);
    }
  }
  const interior = (x, z) => {
    const i = Math.floor(x / C), j = Math.floor(z / C);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (!ras.has(cellKey(i + a, j + b))) return undefined;
    return ras.get(cellKey(i, j));
  };
  return { ras, interior };
}

// does triangle t (offset o in tris) cross B's roof inside B's interior? returns { above, below } extremes (m) or null
function crossing(tris, o, roof) {
  const C = POKE.ROOF_CELL_M, E = POKE.EPS_M;
  const [ax, ay, az, bx, by, bz, cx, cy, cz] = tris.subarray(o, o + 9);
  let above = 0, below = 0, inside = 0;
  const probe = (x, y, z) => {
    const r = roof.interior(x, z); if (r === undefined) return;
    inside++; const d = y - r; if (d > above) above = d; if (d < below) below = d;
  };
  probe(ax, ay, az); probe(bx, by, bz); probe(cx, cy, cz); probe((ax + bx + cx) / 3, (ay + by + cy) / 3, (az + bz + cz) / 3);
  const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
  const x0 = Math.floor(Math.min(ax, bx, cx) / C), x1 = Math.floor(Math.max(ax, bx, cx) / C), z0 = Math.floor(Math.min(az, bz, cz) / C), z1 = Math.floor(Math.max(az, bz, cz) / C);
  if (Math.abs(den) > 1e-9 && (x1 - x0 + 1) * (z1 - z0 + 1) < 4000) {
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const px = (x + 0.5) * C, pz = (z + 0.5) * C;
      const l1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / den, l2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / den, l3 = 1 - l1 - l2;
      if (l1 < 0 || l2 < 0 || l3 < 0) continue;
      probe(px, l1 * ay + l2 * by + l3 * cy, pz);
    }
  }
  return inside && above > E && below < -E ? { above, below } : null;
}

// connected parts of `tris` (welded corners) that contain any of `seeds` (triangle indices); returns arrays of triangle indices
function partsAround(tris, seeds) {
  const n = tris.length / 9, W = POKE.WELD_M, key = (o) => `${Math.round(tris[o] / W)},${Math.round(tris[o + 1] / W)},${Math.round(tris[o + 2] / W)}`;
  const at = new Map();
  for (let t = 0; t < n; t++) for (let c = 0; c < 3; c++) { const k = key(t * 9 + c * 3); (at.get(k) || at.set(k, []).get(k)).push(t); }
  const seen = new Uint8Array(n), out = [];
  for (const s of seeds) {
    if (seen[s]) continue;
    const part = [], stack = [s]; seen[s] = 1;
    while (stack.length && part.length <= POKE.MAX_PART_TRIS * 4) {
      const t = stack.pop(); part.push(t);
      for (let c = 0; c < 3; c++) for (const u of at.get(key(t * 9 + c * 3))) if (!seen[u]) { seen[u] = 1; stack.push(u); }
    }
    out.push(part);
  }
  return out;
}

// buildings: [{ slug, tile, tris }]  ->  { pokes: [...], deep: [...] }. A poke: { slug, over, tile, seed: [x,y,z] (a corner of a flagged triangle), tris: n, above, below, box, part: [triangle indices in that building] }
export function findPokes(buildings) {
  const boxes = buildings.map((b) => bboxOf(b.tris));
  const roofs = new Map();
  const roofFor = (i) => roofs.get(i) || roofs.set(i, roofOf(buildings[i].tris)).get(i);
  const pokes = [], deep = [];
  for (let a = 0; a < buildings.length; a++) {
    const A = buildings[a]; if (!A.tris.length) continue;
    const found = new Map();                                  // over index -> { seeds, above, below }
    for (let b = 0; b < buildings.length; b++) {
      if (a === b || !buildings[b].tris.length || !hit(boxes[a], boxes[b])) continue;
      const roof = roofFor(b);
      for (let o = 0, t = 0; o < A.tris.length; o += 9, t++) {
        const ta = A.tris;
        if (Math.max(ta[o], ta[o + 3], ta[o + 6]) < boxes[b][0] || Math.min(ta[o], ta[o + 3], ta[o + 6]) > boxes[b][3] || Math.max(ta[o + 2], ta[o + 5], ta[o + 8]) < boxes[b][2] || Math.min(ta[o + 2], ta[o + 5], ta[o + 8]) > boxes[b][5]) continue;
        if (normalY(ta, o) < POKE.UP_NY) continue;
        const c = crossing(ta, o, roof); if (!c) continue;
        const f = found.get(b) || found.set(b, { seeds: [], above: 0, below: 0 }).get(b);
        f.seeds.push(t); f.above = Math.max(f.above, c.above); f.below = Math.min(f.below, c.below);
      }
    }
    for (const [b, f] of found) {
      for (const part of partsAround(A.tris, f.seeds)) {
        const pts = new Float32Array(part.length * 9);
        part.forEach((t, k) => pts.set(A.tris.subarray(t * 9, t * 9 + 9), k * 9));
        const box = bboxOf(pts);
        const inPart = new Set(part), s0 = f.seeds.find((s) => inPart.has(s)) ?? part[0], seed = [...A.tris.subarray(s0 * 9, s0 * 9 + 3)].map((v) => +v.toFixed(3));
        const rec = { slug: A.slug, over: buildings[b].slug, tile: A.tile, seed, tris: part.length, above: +f.above.toFixed(2), below: +f.below.toFixed(2), box: box.map((v) => +v.toFixed(2)), part };
        const big = part.length > POKE.MAX_PART_TRIS || Math.max(box[3] - box[0], box[5] - box[2]) > POKE.MAX_PART_M;
        (big || f.above > POKE.SHOW_M ? deep : pokes).push(rec);
      }
    }
  }
  return { pokes, deep };
}
