// geomlint.mjs — static geometry sanity across the authored bakes.
//
// "A long line going out of the Tower into the Biomedical Engineering Building"
// is what a single stray vertex looks like once it is extruded: the ring closes
// through a point hundreds of metres away and MapLibre triangulates a sliver
// spanning the gap. That defect is invisible in a bake summary and obvious in
// the frame, so check the numbers rather than the picture.
//
// Also flags the other cheap static failures:
//   - rings that do not close, or carry fewer than 4 positions
//   - non-finite coordinates
//   - a vertex outside the detailed bbox (or wildly outside its own feature)
//   - zero/negative extrusion span (h <= b), which renders as nothing or as a
//     z-fighting sheet at exactly the neighbouring surface's height
//   - features whose footprint area is ~0 (a degenerate slab)
//
//   node scripts/verify/geomlint.mjs [file.geojson ...]
//
// With no arguments it lints every bake this session owns.

import { readFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT = ['tower', 'westcampus', 'drag', 'arts', 'moody', 'roofscape', 'roofscape.detail', 'roofs'];

// detailed bbox from PASS_COMMON.md §0
const BBOX = [-97.752, 30.276, -97.726, 30.296];

const M_PER_DEG_LAT = 110574;
const mPerDegLon = (lat) => 111320 * Math.cos((lat * Math.PI) / 180);

function ringsOf(g) {
  if (!g) return [];
  if (g.type === 'Polygon') return g.coordinates;
  if (g.type === 'MultiPolygon') return g.coordinates.flat();
  return [];
}

function area2(ring, lat0) {
  // shoelace in metres^2, sign preserved (positive = CCW in lon/lat order)
  const kx = mPerDegLon(lat0), ky = M_PER_DEG_LAT;
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
    s += (x1 * kx) * (y2 * ky) - (x2 * kx) * (y1 * ky);
  }
  return s / 2;
}

const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : DEFAULT.map((s) => join(ROOT, 'data', s + '.geojson'));

let bad = 0;

for (const path of files) {
  let gj;
  try {
    gj = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    console.log(`${basename(path)}: unreadable — ${e.message.slice(0, 70)}`);
    continue;
  }
  const feats = gj.features || [];
  const issues = [];
  let maxSpan = 0, maxSpanIdx = -1;

  feats.forEach((f, i) => {
    const p = f.properties || {};
    const tag = `#${i} ${p.kind || p.k || p.part || '?'}${p.name ? ' ' + p.name : ''}`;
    const rings = ringsOf(f.geometry);
    if (!rings.length) {
      issues.push(`${tag}: no polygon rings (${f.geometry && f.geometry.type})`);
      return;
    }
    rings.forEach((ring, ri) => {
      if (ring.length < 4) {
        issues.push(`${tag} ring${ri}: only ${ring.length} positions`);
        return;
      }
      const a = ring[0], z = ring[ring.length - 1];
      if (a[0] !== z[0] || a[1] !== z[1]) issues.push(`${tag} ring${ri}: not closed`);

      let lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
      for (const q of ring) {
        if (!Number.isFinite(q[0]) || !Number.isFinite(q[1])) {
          issues.push(`${tag} ring${ri}: non-finite vertex ${JSON.stringify(q)}`);
          continue;
        }
        if (q[0] < BBOX[0] || q[0] > BBOX[2] || q[1] < BBOX[1] || q[1] > BBOX[3]) {
          issues.push(`${tag} ring${ri}: vertex outside detailed bbox ${q[0].toFixed(5)},${q[1].toFixed(5)}`);
        }
        lo = [Math.min(lo[0], q[0]), Math.min(lo[1], q[1])];
        hi = [Math.max(hi[0], q[0]), Math.max(hi[1], q[1])];
      }
      // How big is this one ring, in metres? A wall band is a few tens of
      // metres; anything hundreds of metres across is the stray-vertex bug.
      const lat0 = (lo[1] + hi[1]) / 2;
      const w = (hi[0] - lo[0]) * mPerDegLon(lat0);
      const h = (hi[1] - lo[1]) * M_PER_DEG_LAT;
      const span = Math.hypot(w, h);
      if (span > maxSpan) { maxSpan = span; maxSpanIdx = i; }
      if (span > 260) issues.push(`${tag} ring${ri}: spans ${span.toFixed(0)} m (${w.toFixed(0)}x${h.toFixed(0)})`);

      // 0.02 m^2, not 0.5. The tower's window slots are a real 1.42 x 0.30 m
      // and its clock dials 3.05 x 0.16 m, so a half-square-metre floor flags
      // sixteen features that are exactly as authored. Only a ring with no area
      // at all is a defect.
      const ar = Math.abs(area2(ring, lat0));
      if (ri === 0 && ar < 0.02) issues.push(`${tag} ring${ri}: area ${ar.toFixed(4)} m^2 — degenerate`);
      // A sliver: long but with almost no area. This is the shape a stray
      // vertex makes, and it is how "a long line" gets on screen.
      if (span > 40 && ar / span < 0.6) {
        issues.push(`${tag} ring${ri}: SLIVER span ${span.toFixed(0)} m, area ${ar.toFixed(1)} m^2 (w=${(ar / span).toFixed(2)} m)`);
      }
    });

    const b = p.base != null ? p.base : p.b;
    const ht = p.height != null ? p.height : p.h;
    if (b != null && ht != null) {
      if (!(Number.isFinite(b) && Number.isFinite(ht))) issues.push(`${tag}: non-finite base/height ${b}/${ht}`);
      else if (ht < b) issues.push(`${tag}: height ${ht} BELOW base ${b}`);
      else if (ht === b) issues.push(`${tag}: zero-span extrusion at ${b} m`);
    }
  });

  const label = basename(path).padEnd(26);
  if (!issues.length) {
    console.log(`${label} ${String(feats.length).padStart(6)} features  clean   (largest ring ${maxSpan.toFixed(0)} m)`);
  } else {
    bad++;
    console.log(`${label} ${String(feats.length).padStart(6)} features  ${issues.length} ISSUE(S)  (largest ring ${maxSpan.toFixed(0)} m @ #${maxSpanIdx})`);
    for (const s of issues.slice(0, 30)) console.log('    ' + s);
    if (issues.length > 30) console.log(`    ... and ${issues.length - 30} more`);
  }
}

process.exit(bad ? 1 : 0);
