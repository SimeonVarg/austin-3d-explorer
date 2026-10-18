// Draws the layers the old app's modules add to "the map" (maplite.js) in v2's scene: the finder's minutes-to-class wash
// (fill / fill-extrusion of coloured squares), its routes (lines, widths in screen pixels like MapLibre's) and its stops
// (circles, as small DOM markers). Only the expression forms those layers use are understood; anything else draws nothing.
import * as THREE from 'three';
import { toLocal } from './geo.js';

export const MAP_LAYERS = {
  FILL_Y_M: 0.3,            // the wash sits just above the pavement (ground layers write no depth, so nothing fights it)
  LINE_Y_M: 0.45,
  REWIDTH: 0.12,            // line widths are in pixels: rebuild a line when the zoom has moved this many zoom levels
  RENDER_ORDER: 2.5,        // after the sidewalks (main.js ORDER), before v2's own route
};

// ── MapLibre expressions, the few forms in use ──
function ev(x, f, zoom) {
  if (!Array.isArray(x)) return x;
  const [op, ...a] = x;
  switch (op) {
    case 'get': return f?.properties?.[a[0]];
    case 'zoom': return zoom;
    case 'literal': return a[0];
    case 'coalesce': for (const y of a) { const v = ev(y, f, zoom); if (v != null) return v; } return null;
    case 'interpolate': {
      const z = ev(a[1], f, zoom), st = a.slice(2);
      if (z <= st[0]) return ev(st[1], f, zoom);
      for (let i = 0; i + 2 < st.length; i += 2) if (z <= st[i + 2]) { const t = (z - st[i]) / (st[i + 2] - st[i]); return ev(st[i + 1], f, zoom) * (1 - t) + ev(st[i + 3], f, zoom) * t; }
      return ev(st[st.length - 1], f, zoom);
    }
    case '==': return ev(a[0], f, zoom) === ev(a[1], f, zoom);
    case '!=': return ev(a[0], f, zoom) !== ev(a[1], f, zoom);
    case 'match': {
      const v = ev(a[0], f, zoom);
      for (let i = 1; i + 1 < a.length; i += 2) { const k = a[i]; if (Array.isArray(k) ? k.includes(v) : k === v) return ev(a[i + 1], f, zoom); }
      return ev(a[a.length - 1], f, zoom);
    }
    case 'all': return a.every((y) => ev(y, f, zoom));
    case 'any': return a.some((y) => ev(y, f, zoom));
    default: return null;
  }
}
const pass = (layer, f, zoom) => !layer.filter || !!ev(layer.filter, f, zoom);
// a CSS colour; an rgba() alpha is returned apart (THREE.Color has none) and becomes the mesh's own opacity
const alphaOf = (c) => { const m = /rgba\([^)]*,\s*([\d.]+)\s*\)/.exec(String(c)); return m ? +m[1] : 1; };
const colour = (c) => { try { return new THREE.Color().setStyle(String(c || '#ffffff').replace(/rgba\(([^,]+),([^,]+),([^,]+),[^)]*\)/, 'rgb($1,$2,$3)'), THREE.SRGBColorSpace); } catch (e) { return new THREE.Color(1, 1, 1); } };

function lineRibbon(coords, width) {
  const pts = []; for (const c of coords) { const p = toLocal(c[0], c[1]); const q = pts[pts.length - 1]; if (!q || Math.hypot(q[0] - p[0], q[1] - p[1]) > 0.05) pts.push(p); }
  if (pts.length < 2) return null;
  const pos = [], idx = [], h = width / 2;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b[0] - a[0], dz = b[1] - a[1]; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    pos.push(pts[i][0] - dz * h, 0, pts[i][1] + dx * h, pts[i][0] + dz * h, 0, pts[i][1] - dx * h);
    if (i < pts.length - 1) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
  // round joins and caps: a disc at every point (cheap, routes are a few hundred points)
  const seg = 10;
  for (const p of pts) {
    const c = pos.length / 3; pos.push(p[0], 0, p[1]);
    for (let s = 0; s <= seg; s++) { const t = (s / seg) * Math.PI * 2; pos.push(p[0] + Math.cos(t) * h, 0, p[1] + Math.sin(t) * h); if (s) idx.push(c, c + s + 1, c + s); }
  }
  return { pos, idx };
}

export class MapLayers {
  constructor({ map, scene, markers, redraw }) {
    this.map = map; this.scene = scene; this.markers = markers; this.redraw = redraw;
    this.group = new THREE.Group(); this.group.name = 'map-layers'; scene.add(this.group);
    this.built = new Map();   // layer id -> { key, objs, zoom, kind }
    this.dots = new Map();    // layer id -> [Marker]
    map.onLayers = () => { this.dirty = true; this.redraw(); };
    this.dirty = true;
  }
  clear(id) {
    const b = this.built.get(id);
    if (b) for (const o of b.objs) { this.group.remove(o); o.geometry.dispose(); o.material.dispose(); }
    this.built.delete(id);
    for (const m of this.dots.get(id) || []) m.remove();
    this.dots.delete(id);
  }
  // called every frame the camera may have moved; rebuilds only what changed
  update() {
    const zoom = this.map.getZoom();
    const live = new Set();
    this.map.style.layers.forEach((layer, order) => {
      const src = layer.source && this.map.getSource(layer.source);
      if (!src) return;
      live.add(layer.id);
      const b = this.built.get(layer.id), key = src.version + ':' + JSON.stringify(layer.paint || {}) + JSON.stringify(layer.filter || null);
      const isLine = layer.type === 'line';
      const stale = !b || b.key !== key || (isLine && Math.abs(b.zoom - zoom) > MAP_LAYERS.REWIDTH);
      if (stale) { this.clear(layer.id); this.build(layer, src, zoom, key, order); }
      else this.restyle(layer, zoom);
    });
    for (const id of [...this.built.keys(), ...this.dots.keys()]) if (!live.has(id)) this.clear(id);
  }
  restyle(layer, zoom) {
    const b = this.built.get(layer.id); if (!b) return;
    const P = layer.paint || {};
    const o = ev(P['fill-extrusion-opacity'] ?? P['fill-opacity'] ?? P['line-opacity'] ?? 1, null, zoom);
    for (const m of b.objs) { m.material.opacity = (m.userData.alpha ?? 1) * (o ?? 1); m.visible = m.material.opacity > 0.003; }
  }
  build(layer, src, zoom, key, order) {
    const feats = (src.data && src.data.features) || [], P = layer.paint || {}, objs = [];
    const mpp = this.map.metresPerPixel(zoom, this.map.getCenter().lat);
    if (layer.type === 'fill' || layer.type === 'fill-extrusion') {
      const pos = [], col = [], idx = [];
      const cExpr = P['fill-extrusion-color'] ?? P['fill-color'];
      for (const f of feats) {
        if (!pass(layer, f, zoom) || f.geometry?.type !== 'Polygon') continue;
        const ring = f.geometry.coordinates[0].slice(0, -1); if (ring.length < 3) continue;
        const c = colour(ev(cExpr, f, zoom)), b0 = pos.length / 3;
        for (const q of ring) { const p = toLocal(q[0], q[1]); pos.push(p[0], MAP_LAYERS.FILL_Y_M, p[1]); col.push(c.r, c.g, c.b); }
        for (let i = 1; i + 1 < ring.length; i++) idx.push(b0, b0 + i + 1, b0 + i);
      }
      if (idx.length) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx);
        const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true }));
        m.renderOrder = MAP_LAYERS.RENDER_ORDER + order * 0.001; m.frustumCulled = false; objs.push(m);
      }
    } else if (layer.type === 'line') {
      const byColour = new Map();
      for (const f of feats) {
        if (!pass(layer, f, zoom) || f.geometry?.type !== 'LineString') continue;
        const c = String(ev(P['line-color'] ?? '#ffffff', f, zoom)), w = ev(P['line-width'] ?? 2, f, zoom) * mpp;
        const r = lineRibbon(f.geometry.coordinates, w); if (!r) continue;
        const acc = byColour.get(c) || byColour.set(c, { pos: [], idx: [] }).get(c), base = acc.pos.length / 3;
        acc.pos.push(...r.pos); for (const i of r.idx) acc.idx.push(i + base);
      }
      for (const [c, acc] of byColour) {
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(acc.pos, 3)); g.setIndex(acc.idx);
        const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: colour(c), transparent: true, depthWrite: false, side: THREE.DoubleSide }));
        m.userData.alpha = alphaOf(c);
        m.position.y = MAP_LAYERS.LINE_Y_M; m.renderOrder = MAP_LAYERS.RENDER_ORDER + 0.1 + order * 0.001; m.frustumCulled = false; objs.push(m);
      }
    } else if (layer.type === 'circle') {
      const list = [];
      for (const f of feats) {
        if (!pass(layer, f, zoom) || f.geometry?.type !== 'Point') continue;
        const r = ev(P['circle-radius'] ?? 5, f, zoom), sw = ev(P['circle-stroke-width'] ?? 0, f, zoom);
        const el = document.createElement('div');
        Object.assign(el.style, { width: 2 * r + 'px', height: 2 * r + 'px', borderRadius: '50%', boxSizing: 'content-box', pointerEvents: 'none',
          background: String(ev(P['circle-color'] ?? '#fff', f, zoom)), border: `${sw}px solid ${ev(P['circle-stroke-color'] ?? '#000', f, zoom)}` });
        list.push(new window.maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(f.geometry.coordinates).addTo(this.map));
      }
      this.dots.set(layer.id, list);
    }
    for (const o of objs) this.group.add(o);
    this.built.set(layer.id, { key, objs, zoom });
    this.restyle(layer, zoom);
  }
}
