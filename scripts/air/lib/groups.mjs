/**
 * groups.mjs — named towers as groups of solids, and the gap between two of them.
 * Used by the placement script to put a ring "between" two real towers.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadObstacles, bbox, distToRings, inRings, REPO } from './obstacles.mjs';
const require = createRequire(import.meta.url);
const G = require('../../../js/air/geo.js');

/** { name -> { name, parts:[obstacle], top, bbox, c:{x,y} } } for West Campus names and outer-ring landmarks. */
export function namedTowers(obstacles) {
  const groups = {};
  const put = (name, o) => {
    const g = groups[name] ||= { name, parts: [], top: 0, bb: [Infinity, Infinity, -Infinity, -Infinity] };
    g.parts.push(o); g.top = Math.max(g.top, o.top);
    const b = bbox(o.rings); g.bb = [Math.min(g.bb[0], b[0]), Math.min(g.bb[1], b[1]), Math.max(g.bb[2], b[2]), Math.max(g.bb[3], b[3])];
  };
  for (const o of obstacles) if (o.src === 'westcampus' && o.name) put(o.name, o);
  const ring = JSON.parse(fs.readFileSync(path.join(REPO, 'data/outer_ring.geojson'), 'utf8'));
  // the outer ring's landmark tag is not carried into the obstacle list: rebuild it from the file, same projection
  for (const f of ring.features) {
    const lm = f.properties && f.properties.lm; if (!lm) continue;
    const rings = f.geometry.coordinates.map(r => r.map(c => { const l = G.toLocal(c[0], c[1]); return [l.x, l.y]; }));
    put(lm, { rings, top: +f.properties.h || 0, base: +f.properties.b || 0, src: 'outer-ring', name: lm });
  }
  for (const g of Object.values(groups)) g.c = { x: (g.bb[0] + g.bb[2]) / 2, y: (g.bb[1] + g.bb[3]) / 2 };
  return groups;
}

/** Nearest approach between two groups (outlines of their tall parts, sampled every 3 m, de-duplicated). */
export function gapBetween(A, B) {
  const samples = g => { const seen = new Set(), pts = [];
    for (const o of g.parts) { if (o.top < 0.6 * g.top) continue;
      for (const r of o.rings) for (let k = 0; k < r.length - 1; k++) {
        const p = r[k], q = r[k + 1], L = Math.hypot(q[0] - p[0], q[1] - p[1]), n = Math.max(1, Math.ceil(L / 3));
        for (let s = 0; s < n; s++) { const x = p[0] + (q[0] - p[0]) * s / n, y = p[1] + (q[1] - p[1]) * s / n;
          const key = Math.round(x / 3) + ',' + Math.round(y / 3); if (!seen.has(key)) { seen.add(key); pts.push([x, y]); } } } }
    return pts; };
  const pa = samples(A), pb = samples(B);
  let best = Infinity, a0 = null, b0 = null;
  for (const a of pa) for (const b of pb) { const d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (d < best) { best = d; a0 = a; b0 = b; } }
  return { width: best, a: a0, b: b0, mid: { x: (a0[0] + b0[0]) / 2, y: (a0[1] + b0[1]) / 2 } };
}
