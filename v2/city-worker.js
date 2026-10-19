// Builds the city's plain geometry off the main thread: extruded building outlines, road and sidewalk ribbons, tree points.
// It only READS the repo's data files (the same ones the old app uses); nothing here is baked or written.
//
// Messages out (all arrays are transferred, not copied):
//   {type:'buildings', tiles:[{key, pos, nrm, col, idx, ids, starts, counts}]}   one merged mesh per 250 m tile
//   {type:'roads', tiles:[{key, pos, col, idx}]}  {type:'sidewalks', tiles:[...]}  {type:'trees', data:Float32Array[x,z,r,h,shade]*}
//   {type:'log', msg}  {type:'error', msg}  {type:'done', stats}
import { ShapeUtils, Vector2 } from './vendor/three/build/three.core.js';
import { toLocal, tileOf, setOrigin } from './geo.js';

const DATA = (p) => new URL('../data/' + p, import.meta.url).href;
const SOURCES = {
  campus: 'snapshots/2026-09-15/buildings.detailed.geojson',
  lidar: 'lidar_heights.json',
  downtown: 'outer/downtown_massing.json',
  roads: 'roads.geojson',
  walk: 'walk_graph.json',
};
const DEFAULT_HEIGHT_M = 9;       // an outline with no height anywhere
const MIN_HEIGHT_M = 2.5;

let LOOK = null;
// every data file is reported to the page (the loading screen counts them: js/loader.js "Paperwork")
const getJSON = async (p) => {
  const url = DATA(p);
  postMessage({ type: 'file', url, phase: 'start' });
  try { const r = await fetch(url); if (!r.ok) throw new Error(p + ' ' + r.status); const j = await r.json(); postMessage({ type: 'file', url, phase: 'done' }); return j; }
  catch (e) { postMessage({ type: 'file', url, phase: 'error' }); throw e; }
};

// ── colour ─────────────────────────────────────────────────────────────
function hexToLinear(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
}
// the hue of `hex` at the brightness of `base` (so a surveyed colour tints a plain extrusion without making it lighter or darker)
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const hueOf = (hex, base) => { const c = hexToLinear(hex), k = lum(base) / Math.max(1e-4, lum(c)); return c.map((v) => v * k); };
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const to8 = (c) => c.map((v) => Math.max(0, Math.min(255, Math.round(v * 255))));

// ── a growable typed buffer set per tile ───────────────────────────────
class Buf {
  constructor() { this.pos = []; this.nrm = []; this.col = []; this.fac = []; this.idx = []; this.ids = []; this.starts = []; this.counts = []; }
  get n() { return this.pos.length / 3; }
  pack(withNormals = true) {
    const o = { pos: new Float32Array(this.pos), col: new Uint8Array(this.col), idx: new Uint32Array(this.idx) };
    if (withNormals) o.nrm = new Int8Array(this.nrm);
    if (this.fac.length) o.fac = new Float32Array(this.fac);
    if (this.ids.length) { o.ids = this.ids; o.starts = new Uint32Array(this.starts); o.counts = new Uint32Array(this.counts); }
    return o;
  }
}
const tiles = (map, key) => { let b = map.get(key); if (!b) { b = new Buf(); map.set(key, b); } return b; };
const keyOf = (x, z) => { const [i, j] = tileOf(x, z); return `${i}_${j}`; };
// Ribbons are cheap per triangle but many per tile: group them in bigger squares so the draw-call count stays low.
const RIBBON_TILE_M = 750;
const ribbonKey = (x, z) => `${Math.floor(x / RIBBON_TILE_M)}_${Math.floor(z / RIBBON_TILE_M)}`;
// Roads beyond this box (local metres) are not drawn: the camera target never leaves VIEW.BOUNDS (main.js) and fog hides the rest.
const ROAD_BOX = { minX: -6000, maxX: 6000, minZ: -5500, maxZ: 7500 };

// ── polygons ───────────────────────────────────────────────────────────
function ringLocal(ring) {
  const out = [];
  for (const [lon, lat] of ring) {
    const p = toLocal(lon, lat);
    const q = out[out.length - 1];
    if (!q || Math.abs(q[0] - p[0]) > 0.01 || Math.abs(q[1] - p[1]) > 0.01) out.push(p);
  }
  if (out.length > 1) { const a = out[0], b = out[out.length - 1]; if (Math.abs(a[0] - b[0]) < 0.01 && Math.abs(a[1] - b[1]) < 0.01) out.pop(); }
  return out;
}
function area(r) { let s = 0; for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; }
function centroid(r) { let x = 0, z = 0; for (const p of r) { x += p[0]; z += p[1]; } return [x / r.length, z / r.length]; }
function pointInRing(x, z, r) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i], b = r[j];
    if ((a[1] > z) !== (b[1] > z) && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
// GeoJSON Polygon coordinates or MultiPolygon coordinates -> [[outer, ...holes], ...] in local metres, outer CCW (+area), holes CW.
function polysOf(coords) {
  const multi = Array.isArray(coords[0][0][0]);
  const list = multi ? coords : [coords];
  const out = [];
  for (const poly of list) {
    const rings = poly.map(ringLocal).filter((r) => r.length >= 3);
    if (!rings.length) continue;
    if (area(rings[0]) < 0) rings[0].reverse();
    for (let k = 1; k < rings.length; k++) if (area(rings[k]) > 0) rings[k].reverse();
    out.push(rings);
  }
  return out;
}

// One prism: walls from y0 to y1 for every ring, a flat roof at y1. Indexed; flat normals per wall quad.
// Facade coordinates (main.js draws the windows from them): per vertex [bay, storey]. A wall of length L holds
// n = round(L / bay) equal bays, bay runs 0..n along it; storey = height / the building's storey height. A wall too short for
// one bay, and every roof, gets [-1, -1]: no windows.
let FAC_CLASS = 0;
function extrude(buf, rings, y0, y1, wallC, roofC, storeyM) {
  if (y1 - y0 < 0.05) return;
  for (const r of rings) {
    for (let i = 0; i < r.length; i++) {
      const p = r[i], q = r[(i + 1) % r.length];
      const dx = q[0] - p[0], dz = q[1] - p[1], L = Math.hypot(dx, dz);
      if (L < 1e-3) continue;
      const nx = Math.round((dz / L) * 127), nz = Math.round((-dx / L) * 127);
      const b = buf.n;
      buf.pos.push(p[0], y0, p[1], q[0], y0, q[1], q[0], y1, q[1], p[0], y1, p[1]);
      for (let k = 0; k < 4; k++) { buf.nrm.push(nx, 0, nz); buf.col.push(...wallC); }
      const bays = L >= LOOK.FACADE.MIN_WALL_M ? Math.max(1, Math.round(L / LOOK.FACADE.BAY_M)) : 0;
      // the building's class rides in the bay coordinate's thousands (the shader splits it off): 1000 x class + bay
      if (bays && storeyM) { const c = FAC_CLASS * 1000; buf.fac.push(c, y0 / storeyM, c + bays, y0 / storeyM, c + bays, y1 / storeyM, c, y1 / storeyM); }
      else buf.fac.push(-1, -1, -1, -1, -1, -1, -1, -1);
      // (p0, p1, q0) and (q0, p1, q1): counter-clockwise seen from outside
      buf.idx.push(b, b + 3, b + 1, b + 1, b + 3, b + 2);
    }
  }
  const contour = rings[0].map((p) => new Vector2(p[0], p[1]));
  const holes = rings.slice(1).map((h) => h.map((p) => new Vector2(p[0], p[1])));
  let tris;
  try { tris = ShapeUtils.triangulateShape(contour, holes); } catch (e) { return; }
  const flat = rings.flat();
  const b = buf.n;
  for (const p of flat) { buf.pos.push(p[0], y1, p[1]); buf.nrm.push(0, 127, 0); buf.col.push(...roofC); buf.fac.push(-1, -1); }
  for (const t of tris) {
    const A = flat[t[0]], B = flat[t[1]], C = flat[t[2]];
    // y of (B-A) x (C-A) = uz*vx - ux*vz; it must be positive (facing up)
    const ny = (B[1] - A[1]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[1] - A[1]);
    if (ny >= 0) buf.idx.push(b + t[0], b + t[1], b + t[2]); else buf.idx.push(b + t[0], b + t[2], b + t[1]);
  }
}

// ── buildings ──────────────────────────────────────────────────────────
async function buildBuildings() {
  const [campus, lidar, downtown] = await Promise.all([getJSON(SOURCES.campus), getJSON(SOURCES.lidar).catch(() => ({})), getJSON(SOURCES.downtown).catch((e) => { postMessage({ type: 'error', msg: 'downtown massing: ' + e.message }); return { rows: [] }; })]);
  const L = lidar.buildings || {};
  const WALL = hexToLinear(LOOK.BUILDING_WALL), ROOF = hexToLinear(LOOK.BUILDING_ROOF), T = LOOK.BUILDING_TINT;
  const out = new Map();
  let nCampus = 0, nDown = 0, nDup = 0, nLidar = 0;

  // A coarse grid of the campus outlines, so downtown rows that the campus file already has are dropped.
  const GRID = 50, grid = new Map();
  const put = (x, z, v) => { const k = Math.floor(x / GRID) + ',' + Math.floor(z / GRID); (grid.get(k) || grid.set(k, []).get(k)).push(v); };

  // the camera's collision footprints (flycam.js CollisionField): every level of every building, outer ring + holes, with its top
  const CO = { coords: [], ringStart: [0], polyRing: [0], polyTop: [], polyId: [], ids: [], idIndex: new Map() };
  const collide = (id, levels) => {
    let k = CO.idIndex.get(id); if (k == null) { k = CO.ids.length; CO.ids.push(id); CO.idIndex.set(id, k); }
    for (const lv of levels) for (const rings of lv.polys) {
      for (const r of rings) { for (const p of r) CO.coords.push(p[0], p[1]); CO.ringStart.push(CO.coords.length / 2); }
      CO.polyRing.push(CO.ringStart.length - 1); CO.polyTop.push(lv.y1); CO.polyId.push(k);
    }
  };
  const add = (id, polys, levels, wd, rd) => {
    collide(String(id), levels);
    const [cx, cz] = centroid(polys[0][0]);
    const buf = tiles(out, keyOf(cx, cz));
    const wallC = to8(wd ? mix(WALL, hueOf(wd, WALL), T) : WALL);
    const roofC = to8(rd ? mix(ROOF, hueOf(rd, ROOF), T) : ROOF);
    const start = buf.n;
    // the storey height: the class of building by its height (LOOK.FACADE.STOREYS), then stretched so the top is a whole storey
    const H = Math.max(...levels.map((lv) => lv.y1));
    let ci = LOOK.FACADE.STOREYS.findIndex((c) => H <= c[0]); if (ci < 0) ci = LOOK.FACADE.STOREYS.length - 1;
    const cls = LOOK.FACADE.STOREYS[ci]; FAC_CLASS = ci;
    const storeyM = H >= LOOK.FACADE.MIN_HEIGHT_M ? H / Math.max(1, Math.round(H / cls[1])) : 0;
    for (const lv of levels) for (const rings of lv.polys) extrude(buf, rings, lv.y0, lv.y1, wallC, roofC, storeyM);
    if (buf.n > start) { buf.ids.push(id); buf.starts.push(start); buf.counts.push(buf.n - start); }
  };

  for (const f of campus.features) {
    const p = f.properties, g = f.geometry;
    if (!g) continue;
    const polys = polysOf(g.coordinates);
    if (!polys.length) continue;
    const s = L[p.id];
    let h = p.final_height;
    if (s && s.h && !s.rv) { h = s.h; nLidar++; }
    h = Math.max(MIN_HEIGHT_M, h || DEFAULT_HEIGHT_M);
    add(p.id, polys, [{ polys, y0: 0, y1: h }], p.wd, p.rd);
    outlineById.set(String(p.id).slice(0, 8), polys.map((r) => r[0]));
    for (const rings of polys) { const [cx, cz] = centroid(rings[0]); put(cx, cz, rings[0]); for (const q of rings[0]) put(q[0], q[1], rings[0]); }
    nCampus++;
  }

  for (const r of downtown.rows) {
    if (!r.g) continue;
    const polys = polysOf(r.g);
    if (!polys.length) continue;
    const [cx, cz] = centroid(polys[0][0]);
    const near = grid.get(Math.floor(cx / GRID) + ',' + Math.floor(cz / GRID));
    if (near && near.some((ring) => pointInRing(cx, cz, ring))) { nDup++; continue; }
    const levels = [];
    if (Array.isArray(r.lv) && r.lv.length) {
      let y0 = 0;
      for (const [top, plans] of r.lv) {
        const lp = plans ? polysOf(plans) : polys;
        if (top > y0) levels.push({ polys: lp, y0, y1: top });
        y0 = Math.max(y0, top);
      }
    } else {
      const h = r.p90 || r.osm_h || r.city_h || DEFAULT_HEIGHT_M;
      levels.push({ polys, y0: 0, y1: Math.max(MIN_HEIGHT_M, h) });
    }
    add(String(r.id), polys, levels, null, null);
    nDown++;
  }

  const list = [], transfer = [];
  for (const [key, buf] of out) { const o = buf.pack(); o.key = key; list.push(o); transfer.push(o.pos.buffer, o.nrm.buffer, o.col.buffer, o.fac.buffer, o.idx.buffer, o.starts.buffer, o.counts.buffer); }
  postMessage({ type: 'buildings', tiles: list }, transfer);
  const co = { coords: new Float32Array(CO.coords), ringStart: new Uint32Array(CO.ringStart), polyRing: new Uint32Array(CO.polyRing),
    polyTop: new Float32Array(CO.polyTop), polyId: new Uint32Array(CO.polyId), ids: CO.ids };
  postMessage({ type: 'collide', data: co }, [co.coords.buffer, co.ringStart.buffer, co.polyRing.buffer, co.polyTop.buffer, co.polyId.buffer]);
  return { campus: nCampus, downtown: nDown, downtownDropped: nDup, lidarHeights: nLidar, tiles: list.length };
}

// ── ribbons (roads, sidewalks) ─────────────────────────────────────────
// A polyline as a flat strip on y=0: two vertices per point, offset along the averaged (mitred, capped) normal.
function ribbon(buf, pts, w, c) {
  if (pts.length < 2) return;
  const h = w / 2, b = buf.n;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], a = pts[Math.max(0, i - 1)], n = pts[Math.min(pts.length - 1, i + 1)];
    let d1x = p[0] - a[0], d1z = p[1] - a[1], d2x = n[0] - p[0], d2z = n[1] - p[1];
    const l1 = Math.hypot(d1x, d1z) || 1, l2 = Math.hypot(d2x, d2z) || 1;
    d1x /= l1; d1z /= l1; d2x /= l2; d2z /= l2;
    if (i === 0) { d1x = d2x; d1z = d2z; }
    if (i === pts.length - 1) { d2x = d1x; d2z = d1z; }
    let nx = -(d1z + d2z), nz = d1x + d2x;
    let nl = Math.hypot(nx, nz);
    if (nl < 1e-6) { nx = -d2z; nz = d2x; nl = 1; }
    nx /= nl; nz /= nl;
    const cos = nx * -d2z + nz * d2x;           // miter length = 1 / cos(half angle), capped
    const m = h / Math.max(0.5, cos);
    buf.pos.push(p[0] + nx * m, 0, p[1] + nz * m, p[0] - nx * m, 0, p[1] - nz * m);
    buf.col.push(...c, ...c);
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const k = b + i * 2;
    buf.idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
  }
}
function fixUp(buf) {
  // make every triangle face up (+y), whatever the line's direction
  const P = buf.pos, I = buf.idx;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ny = (P[b + 2] - P[a + 2]) * (P[c] - P[a]) - (P[b] - P[a]) * (P[c + 2] - P[a + 2]);
    if (ny < 0) { const s = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = s; }
  }
}
function sendRibbons(type, map) {
  const list = [], transfer = [];
  for (const [key, buf] of map) { fixUp(buf); const o = buf.pack(false); o.key = key; list.push(o); transfer.push(o.pos.buffer, o.col.buffer, o.idx.buffer); }
  postMessage({ type, tiles: list }, transfer);
  return list.length;
}

async function buildRoads() {
  const roads = await getJSON(SOURCES.roads);
  const out = new Map();
  const cols = {};
  for (const [k, v] of Object.entries(LOOK.ROAD)) cols[k] = to8(hexToLinear(v));
  const cycle = to8(hexToLinear(LOOK.CYCLE));
  let n = 0;
  for (const f of roads.features) {
    const p = f.properties, g = f.geometry;
    if (!g || g.type !== 'LineString' || p.k === 'stopbar') continue;
    const pts = ringLocalLine(g.coordinates);
    if (pts.length < 2) continue;
    const mid = pts[pts.length >> 1];
    if (mid[0] < ROAD_BOX.minX || mid[0] > ROAD_BOX.maxX || mid[1] < ROAD_BOX.minZ || mid[1] > ROAD_BOX.maxZ) continue;
    const buf = tiles(out, ribbonKey(mid[0], mid[1]));
    if (p.k === 'cycle') ribbon(buf, pts, LOOK.CYCLE_WIDTH_M, cycle);
    else ribbon(buf, pts, (p.w || 7) * LOOK.ROAD_WIDTH_SCALE, cols[p.c] || cols.default);
    n++;
  }
  return { roads: n, tiles: sendRibbons('roads', out) };
}
function ringLocalLine(coords) {
  const out = [];
  for (const [lon, lat] of coords) { const p = toLocal(lon, lat); const q = out[out.length - 1]; if (!q || Math.hypot(q[0] - p[0], q[1] - p[1]) > 0.05) out.push(p); }
  return out;
}

// Sidewalks: the walking graph's own edges (the router walks exactly these), minus plaza chords, road legs and crossings.
async function buildSidewalks() {
  const w = await getJSON(SOURCES.walk);
  const q = w.q;
  const X = [], Z = [];
  let ax = 0, ay = 0;
  for (let i = 0; i < w.n.x.length; i++) { ax += w.n.x[i]; ay += w.n.y[i]; const p = toLocal(ax * q, ay * q); X.push(p[0]); Z.push(p[1]); }
  const skip = new Set();
  for (const list of [w.re || [], w.pe || []]) { let k = 0; for (const d of list) { k += d; skip.add(k); } }
  const out = new Map();
  const c = to8(hexToLinear(LOOK.SIDEWALK));
  let a = 0, n = 0;
  for (let e = 0; e < w.e.a.length; e++) {
    a += w.e.a[e];
    const b = a + w.e.b[e];
    if (skip.has(e) || (w.e.f[e] & 2)) continue;
    const pts = [[X[a], Z[a]], [X[b], Z[b]]];
    const buf = tiles(out, ribbonKey((X[a] + X[b]) / 2, (Z[a] + Z[b]) / 2));
    ribbon(buf, pts, LOOK.SIDEWALK_WIDTH_M, c);
    n++;
  }
  return { sidewalks: n, tiles: sendRibbons('sidewalks', out) };
}

// Trees are NOT built here any more: data/canopy_detected.json was detected on Esri World Imagery, which a public product may not
// use (2026-10-18). v2/trees.js draws trees from the City's inventories and its 2025 aerial (scripts/v2/street_trees.py) instead.
// The outlines are still kept by id (buildBuildings fills this map).
const outlineById = new Map();

onmessage = async (ev) => {
  const m = ev.data;
  if (m.type !== 'init') return;
  LOOK = m.look;
  if (m.origin) setOrigin(m.origin.lat, m.origin.lon);
  const stats = {};
  const t0 = performance.now();
  const step = async (name, fn) => {
    try { Object.assign(stats, { [name]: await fn() }); postMessage({ type: 'log', msg: `${name} ${Math.round(performance.now() - t0)} ms` }); }
    catch (e) { postMessage({ type: 'error', msg: name + ': ' + (e && e.message) }); }
  };
  // Order = what the eye needs first.
  await step('roads', buildRoads);
  await step('buildings', buildBuildings);
  await step('sidewalks', buildSidewalks);
  postMessage({ type: 'done', stats, ms: Math.round(performance.now() - t0) });
};
