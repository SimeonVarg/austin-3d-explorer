/**
 * coplanar.mjs — the static half of the z-fighting hunt.
 *
 * Two extrusions whose TOP faces are at the same height and whose footprints
 * overlap have no defined draw order. Which one wins is decided by depth-buffer
 * rounding, so it changes as the camera moves and the shared area breaks into a
 * comb of scanlines along the boundary. That is what "the roof is glitching"
 * looks like, and it is invisible in a still frame taken at one pose.
 *
 * zfight.mjs finds it by rendering. This finds it by arithmetic, which is
 * cheaper, exhaustive, and does not depend on the camera happening to be
 * pointed at it. Run both: this one cannot see a z-fight BETWEEN two different
 * sources with different height fields, and the renderer one cannot see a
 * z-fight that is off screen.
 *
 * Reports pairs of features that
 *   - come from the same document,
 *   - have top heights within `--eps` metres (default 0.01), and
 *   - whose footprints overlap by more than `--frac` of the smaller (0.30).
 *
 * Overlap is estimated by sampling points of the smaller polygon against the
 * larger — exact polygon clipping is not worth it to answer "do these two
 * substantially cover each other".
 *
 *   node scripts/verify/coplanar.mjs [file.geojson ...] [--eps 0.01] [--frac 0.3]
 */
import { readFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const num = (flag, dflt) => {
  const i = argv.indexOf(flag);
  return i < 0 ? dflt : Number(argv[i + 1]);
};
const EPS = num('--eps', 0.01);
const FRAC = num('--frac', 0.30);
const files = argv.filter(a => a.endsWith('.geojson'));
const TARGETS = files.length ? files : ['roofscape', 'roofscape.detail', 'roofs', 'tower',
  'westcampus', 'drag', 'arts', 'moody'].map(s => join(ROOT, 'data', s + '.geojson'));

const M_LAT = 110574;
const mLon = lat => 111320 * Math.cos(lat * Math.PI / 180);

const ringsOf = g => !g ? [] : g.type === 'Polygon' ? g.coordinates
  : g.type === 'MultiPolygon' ? g.coordinates.flat() : [];

function inRing(x, y, r) {
  let h = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) h = !h;
  }
  return h;
}
const inPoly = (x, y, rings) => {
  let s = false;
  for (const r of rings) if (inRing(x, y, r)) s = !s;
  return s;
};

/** Fraction of A's area that also lies inside B, by grid sampling A's bbox. */
function overlapFrac(A, B) {
  const [alo, ahi] = A.bb;
  const N = 22;
  let inA = 0, inBoth = 0;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const x = alo[0] + (ahi[0] - alo[0]) * (i + 0.5) / N;
    const y = alo[1] + (ahi[1] - alo[1]) * (j + 0.5) / N;
    if (!inPoly(x, y, A.rings)) continue;
    inA++;
    if (inPoly(x, y, B.rings)) inBoth++;
  }
  return inA ? inBoth / inA : 0;
}

let totalPairs = 0;

for (const path of TARGETS) {
  let gj;
  try { gj = JSON.parse(readFileSync(path, 'utf8')); } catch { continue; }
  const items = [];
  gj.features.forEach((f, idx) => {
    const rings = ringsOf(f.geometry);
    if (!rings.length) return;
    const p = f.properties || {};
    const top = p.h != null ? p.h : p.height;
    if (!Number.isFinite(top)) return;
    let lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
    for (const r of rings) for (const q of r) {
      lo = [Math.min(lo[0], q[0]), Math.min(lo[1], q[1])];
      hi = [Math.max(hi[0], q[0]), Math.max(hi[1], q[1])];
    }
    const lat0 = (lo[1] + hi[1]) / 2;
    const area = (hi[0] - lo[0]) * mLon(lat0) * (hi[1] - lo[1]) * M_LAT;
    items.push({ idx, p, rings, bb: [lo, hi], top, area, lat0 });
  });

  // bucket by rounded top height, so only plausible pairs are ever compared
  const bucket = new Map();
  for (const it of items) {
    const k = Math.round(it.top / Math.max(EPS, 1e-6));
    for (const kk of [k - 1, k, k + 1]) {
      if (!bucket.has(kk)) bucket.set(kk, []);
      bucket.get(kk).push(it);
    }
  }

  const seen = new Set(), hits = [];
  for (const list of bucket.values()) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const A = list[i], B = list[j];
      if (A.idx === B.idx) continue;
      if (Math.abs(A.top - B.top) > EPS) continue;
      const key = A.idx < B.idx ? `${A.idx},${B.idx}` : `${B.idx},${A.idx}`;
      if (seen.has(key)) continue;
      // bbox reject first
      if (A.bb[1][0] < B.bb[0][0] || A.bb[0][0] > B.bb[1][0] ||
          A.bb[1][1] < B.bb[0][1] || A.bb[0][1] > B.bb[1][1]) { seen.add(key); continue; }
      seen.add(key);
      const [S, L] = A.area <= B.area ? [A, B] : [B, A];
      const f = overlapFrac(S, L);
      if (f < FRAC) continue;
      hits.push({ S, L, f });
    }
  }

  const label = basename(path).padEnd(26);
  if (!hits.length) {
    console.log(`${label} ${String(items.length).padStart(6)} features  no coplanar overlaps`);
    continue;
  }
  totalPairs += hits.length;
  console.log(`${label} ${String(items.length).padStart(6)} features  ${hits.length} COPLANAR OVERLAP(S) at the same top height`);
  const byKind = new Map();
  for (const h of hits) {
    const k = `${h.S.p.k || h.S.p.kind || h.S.p.part || '?'} / ${h.L.p.k || h.L.p.kind || h.L.p.part || '?'}`;
    byKind.set(k, (byKind.get(k) || 0) + 1);
  }
  for (const [k, n] of [...byKind].sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(5)}  ${k}`);
  console.log('    worst by shared area:');
  for (const h of hits.sort((a, b) => b.S.area * b.f - a.S.area * a.f).slice(0, 12)) {
    const c = h.S.bb[0];
    console.log(
      `      #${String(h.S.idx).padEnd(6)} + #${String(h.L.idx).padEnd(6)} ` +
      `${(h.S.p.k || h.S.p.kind || '?').padEnd(7)} top=${h.S.top}  ` +
      `${(h.S.area).toFixed(0).padStart(6)} m^2 x ${(h.f * 100).toFixed(0)}% shared   @ ${c[0].toFixed(5)},${c[1].toFixed(5)}`
    );
  }
}
console.log('');
process.exit(totalPairs ? 1 : 0);
