/**
 * obstacles.mjs — every solid the sky race has to stay out of, read from the
 * repo's own baked data, in the game's local metre frame.
 *
 * Height semantics (checked against the files, not assumed): in tower.geojson,
 * westcampus.geojson, heroes.geojson, stadium.geojson, capitol*.geojson,
 * drag.geojson, moody.geojson and outer_ring.geojson the property `h` is the
 * TOP of the extrusion above ground (MapLibre's fill-extrusion-height), `base`
 * / `b` its bottom. The campus snapshot uses `final_height`. A solid is treated
 * as filled from the ground up to its top: from the air that is the only thing
 * that matters and it can only make the validator stricter.
 *
 * Each obstacle: { rings: [[ [x,y], ... ], ...] (first = shell, rest = holes),
 *                  top, base, src, name }.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const G = require('../../../js/air/geo.js');

export const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const readJSON = f => JSON.parse(fs.readFileSync(path.join(REPO, f), 'utf8'));

function ringsOf(geom) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  return polys.map(p => p.map(r => r.map(c => { const l = G.toLocal(c[0], c[1]); return [l.x, l.y]; })));
}

export function loadObstacles(opts = {}) {
  const out = [];
  const counts = {};
  const add = (src, geom, top, base, name) => {
    if (!(top > 0) || !geom) return;
    for (const rings of ringsOf(geom)) { out.push({ rings, top, base: base || 0, src, name: name || null }); counts[src] = (counts[src] || 0) + 1; }
  };
  const num = v => (v == null || v === '' ? NaN : +v);
  const fc = (file, src, topKey, baseKey, nameKey) => {
    const d = readJSON(file);
    for (const f of d.features) {
      const p = f.properties || {};
      add(src, f.geometry, num(p[topKey]), num(p[baseKey]) || 0, nameKey ? p[nameKey] : null);
    }
  };

  // The campus core snapshot, with the laser-scan raises the app applies on load.
  const manifest = readJSON('data/manifest.json');
  const raises = (readJSON('data/lidar_raises.json').buildings) || {};
  const snap = readJSON(`data/snapshots/${manifest.latest}/buildings.detailed.geojson`);
  for (const f of snap.features) {
    const p = f.properties || {};
    let h = num(p.final_height);
    const r = raises[p.id]; if (r > 0) h = Math.max(h || 0, +r);
    add('snapshot', f.geometry, h, 0, p.name);
  }
  const sp = readJSON(`data/snapshots/${manifest.latest}/parts.detailed.geojson`);
  for (const f of sp.features) { const p = f.properties || {}; add('snapshot-parts', f.geometry, num(p.height_m), num(p.min_height_m) || 0, null); }

  fc('data/outer_ring.geojson', 'outer-ring', 'h', 'b');
  fc('data/tower.geojson', 'tower', 'h', 'base');
  fc('data/westcampus.geojson', 'westcampus', 'h', 'base', 'name');
  fc('data/heroes.geojson', 'heroes', 'h', 'base');
  fc('data/stadium.geojson', 'stadium', 'h', 'base', 'name');
  fc('data/capitol.geojson', 'capitol', 'final_height', null, 'name');
  fc('data/capitol_parts.geojson', 'capitol-parts', 'h', 'base');
  fc('data/capitol_dome.geojson', 'capitol-dome', 'h', 'base');
  fc('data/drag.geojson', 'drag', 'h', 'base');
  fc('data/moody.geojson', 'moody', 'h', 'base');
  fc('data/parts.geojson', 'parts', 'height_m', 'min_height_m');
  return { obstacles: out, counts };
}

/** Point in polygon (even-odd over shell + holes). */
export function inRings(rings, x, y) {
  let inside = false;
  for (const r of rings) {
    for (let a = 0, b = r.length - 1; a < r.length; b = a++) {
      const p = r[a], q = r[b];
      if ((p[1] > y) !== (q[1] > y) && x < (q[0] - p[0]) * (y - p[1]) / (q[1] - p[1]) + p[0]) inside = !inside;
    }
  }
  return inside;
}
/** Distance from (x,y) to the outline of the rings (metres). */
export function distToRings(rings, x, y) {
  let best = Infinity;
  for (const r of rings) for (let a = 0, b = r.length - 1; a < r.length; b = a++) {
    const p = r[a], q = r[b], dx = q[0] - p[0], dy = q[1] - p[1], l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((x - p[0]) * dx + (y - p[1]) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(x - p[0] - t * dx, y - p[1] - t * dy));
  }
  return best;
}
export function bbox(rings) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of rings[0]) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  return [x0, y0, x1, y1];
}
