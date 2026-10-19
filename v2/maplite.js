// A small MapLibre-shaped face on v2's three.js camera, so the old app's own modules (the loading screen js/loader.js, the
// apartment finder js/finder.js) and the old opening flight run in v2 unchanged. It answers in MapLibre's terms:
//   center [lng, lat], zoom, pitch (0 = straight down), bearing (the compass direction the camera looks).
// zoom <-> distance: MapLibre puts the camera cameraToCenterDistance pixels from the centre, and a pixel at zoom z is
// C cos(lat) / (512 2^z) metres; with v2's own field of view the same zoom frames the same ground at the centre of the screen.
//
// What it is not: a map. Layers are only what the finder adds (geojson fills, lines and circles), drawn by v2 (main.js).
import * as THREE from 'three';
import { toLocal, toLonLat } from './geo.js';

const C_EARTH = 40075016.686;
const D2R = Math.PI / 180;

export class MercatorCoordinate {
  constructor(x, y, z = 0) { this.x = x; this.y = y; this.z = z; }
  static fromLngLat(ll, alt = 0) {
    const [lng, lat] = Array.isArray(ll) ? ll : [ll.lng, ll.lat];
    const x = (180 + lng) / 360;
    const y = (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * D2R) / 2))) / 360;
    return new MercatorCoordinate(x, y, alt);
  }
  toLngLat() {
    const lng = this.x * 360 - 180;
    const y2 = 180 - this.y * 360;
    const lat = (360 / Math.PI) * Math.atan(Math.exp(y2 * D2R)) - 90;
    return { lng, lat };
  }
}

const lngLatOf = (c) => (Array.isArray(c) ? { lng: c[0], lat: c[1] } : { lng: c.lng ?? c.lon, lat: c.lat });
const wrap180 = (d) => ((d % 360) + 540) % 360 - 180;

export class MapLite {
  constructor({ camera, controls, canvas, redraw, limits }) {
    this.camera = camera; this.controls = controls; this.canvas = canvas; this.redraw = redraw || (() => {});
    this.limits = limits || {};
    this.handlers = new Map();
    this.style = { layers: [{ id: 'buildings-3d', type: 'fill-extrusion' }] };   // the finder places its layers relative to this one
    this.sources = new Map();
    this.ease = null;
    this.tilesLoaded = () => true;
    this.onLayers = () => {};
    const self = this;
    this.transform = { get cameraToCenterDistance() { return 0.5 * self.canvas.clientHeight / Math.tan((self.camera.fov * D2R) / 2); } };
  }

  // ── events ──
  on(type, fn) { (this.handlers.get(type) || this.handlers.set(type, new Set()).get(type)).add(fn); return this; }
  off(type, fn) { this.handlers.get(type)?.delete(fn); return this; }
  once(type, fn) { const f = (e) => { this.off(type, f); fn(e); }; return this.on(type, f); }
  fire(type, data = {}) { for (const fn of [...(this.handlers.get(type) || [])]) { try { fn({ type, target: this, ...data }); } catch (e) { console.error('[maplite]', type, e); } } }

  // ── the camera in MapLibre's terms ──
  metresPerPixel(zoom, lat) { return (C_EARTH * Math.cos(lat * D2R)) / (512 * Math.pow(2, zoom)); }
  distanceFor(zoom, lat) { return this.metresPerPixel(zoom, lat) * this.transform.cameraToCenterDistance; }
  getCenter() { const [lng, lat] = toLonLat(this.controls.target.x, this.controls.target.z); return { lng, lat }; }
  offset() { return this.camera.position.clone().sub(this.controls.target); }
  getZoom() {
    const lat = this.getCenter().lat, d = this.offset().length();
    return Math.log2((C_EARTH * Math.cos(lat * D2R) * this.transform.cameraToCenterDistance) / (512 * d));
  }
  getPitch() { const o = this.offset(); return Math.acos(THREE.MathUtils.clamp(o.y / o.length(), -1, 1)) / D2R; }
  getBearing() { const o = this.offset(); return wrap180(-Math.atan2(o.x, o.z) / D2R); }
  getFreeCameraOptions() { return {}; }
  getCanvas() { return this.canvas; }
  getContainer() { return this.canvas.parentElement; }
  isStyleLoaded() { return true; }
  areTilesLoaded() { return this.tilesLoaded(); }
  isMoving() { return !!this.ease; }
  isEasing() { return !!this.ease; }
  loaded() { return true; }
  triggerRepaint() { this.redraw(); }

  pose() { return { center: this.getCenter(), zoom: this.getZoom(), pitch: this.getPitch(), bearing: this.getBearing() }; }
  // Place the camera (no events of its own: the controls' change event marks the frame dirty).
  setPose({ center, zoom, pitch, bearing }) {
    const cur = this.pose();
    const c = center ? lngLatOf(center) : cur.center;
    const z = zoom ?? cur.zoom, p = THREE.MathUtils.clamp(pitch ?? cur.pitch, 0, this.limits.maxPitch ?? 85), b = bearing ?? cur.bearing;
    const [x, zz] = toLocal(c.lng, c.lat);
    const d = THREE.MathUtils.clamp(this.distanceFor(z, c.lat), this.limits.minDistance ?? 1, this.limits.maxDistance ?? 1e9);
    const pr = p * D2R, a = -b * D2R;
    this.controls.target.set(x, 0, zz);
    this.camera.position.set(x + d * Math.sin(pr) * Math.sin(a), d * Math.cos(pr), zz + d * Math.sin(pr) * Math.cos(a));
    this.camera.lookAt(this.controls.target);
    this.redraw();
  }
  jumpTo(o, data) { this.stop(); this.setPose(o); this.fire('move', data); this.fire('moveend', data); return this; }
  easeTo(o, data = {}) {
    this.stop();
    const from = this.pose();
    const to = { center: o.center ? lngLatOf(o.center) : from.center, zoom: o.zoom ?? from.zoom, pitch: o.pitch ?? from.pitch,
      bearing: from.bearing + wrap180((o.bearing ?? from.bearing) - from.bearing) };
    const ms = o.duration ?? 500, easing = o.easing || ((t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2));
    if (!ms || matchMedia('(prefers-reduced-motion: reduce)').matches && !o.essential) return this.jumpTo(to, data);
    this.ease = { from, to, t0: performance.now(), ms, easing, data };
    this.fire('movestart', data);
    this.redraw();
    return this;
  }
  flyTo(o, data) { return this.easeTo({ duration: 1600, ...o }, data); }
  fitBounds(b, o = {}) {
    const [[w, s], [e, n]] = Array.isArray(b[0]) ? b : [[b[0], b[1]], [b[2], b[3]]];
    const [x0, z0] = toLocal(w, n), [x1, z1] = toLocal(e, s);
    const span = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0), 100);
    const lat = (s + n) / 2;
    const pad = typeof o.padding === 'number' ? o.padding : 40;
    const px = Math.max(100, Math.min(this.canvas.clientWidth, this.canvas.clientHeight) - 2 * pad);
    const zoom = Math.min(o.maxZoom ?? 22, Math.log2((C_EARTH * Math.cos(lat * D2R) * px) / (512 * span)));
    return this.easeTo({ center: [(w + e) / 2, lat], zoom, pitch: o.pitch, bearing: o.bearing, duration: o.duration ?? 1200 });
  }
  stop() {
    if (!this.ease) return this;
    const data = this.ease.data; this.ease = null;
    this.fire('moveend', data);
    return this;
  }
  // called by v2's frame loop; true while easing
  step(now) {
    const E = this.ease; if (!E) return false;
    const k = Math.min(1, (now - E.t0) / E.ms), e = E.easing(k);
    const lerp = (a, b) => a + (b - a) * e;
    this.setPose({ center: [lerp(E.from.center.lng, E.to.center.lng), lerp(E.from.center.lat, E.to.center.lat)], zoom: lerp(E.from.zoom, E.to.zoom),
      pitch: lerp(E.from.pitch, E.to.pitch), bearing: lerp(E.from.bearing, E.to.bearing) });
    this.fire('move', E.data);
    if (k >= 1) { this.ease = null; this.fire('moveend', E.data); }
    return true;
  }

  // ── screen <-> ground ──
  project(ll) {
    const c = lngLatOf(ll), [x, z] = toLocal(c.lng, c.lat);
    const v = new THREE.Vector3(x, 0, z).project(this.camera);
    return { x: (v.x + 1) / 2 * this.canvas.clientWidth, y: (1 - v.y) / 2 * this.canvas.clientHeight, behind: v.z > 1 || v.z < -1 };
  }
  unproject(p) {
    const [px, py] = Array.isArray(p) ? p : [p.x, p.y];
    const ndc = new THREE.Vector3((px / this.canvas.clientWidth) * 2 - 1, -(py / this.canvas.clientHeight) * 2 + 1, 0.5).unproject(this.camera);
    const o = this.camera.position, d = ndc.sub(o).normalize();
    const t = d.y < -1e-6 ? -o.y / d.y : 1e5;
    const [lng, lat] = toLonLat(o.x + d.x * t, o.z + d.z * t);
    return { lng, lat };
  }

  // ── style: only what the finder asks for ──
  getStyle() { return this.style; }
  getLayer(id) { return this.style.layers.find((l) => l.id === id); }
  addLayer(spec, before) {
    if (this.getLayer(spec.id)) return this;
    const i = before ? this.style.layers.findIndex((l) => l.id === before) : -1;
    if (i >= 0) this.style.layers.splice(i, 0, spec); else this.style.layers.push(spec);
    this.onLayers(this); return this;
  }
  removeLayer(id) { this.style.layers = this.style.layers.filter((l) => l.id !== id); this.onLayers(this); return this; }
  getSource(id) { return this.sources.get(id); }
  addSource(id, spec) {
    const self = this;
    const src = { id, data: spec.data || { type: 'FeatureCollection', features: [] }, version: 0,
      setData(d) { this.data = d; this.version++; self.onLayers(self); return this; } };
    this.sources.set(id, src); this.onLayers(this); return this;
  }
  removeSource(id) { this.sources.delete(id); this.onLayers(this); return this; }
  setPaintProperty(id, k, v) { const l = this.getLayer(id); if (l) { (l.paint ||= {})[k] = v; this.onLayers(this); } return this; }
  setLayoutProperty(id, k, v) { const l = this.getLayer(id); if (l) { (l.layout ||= {})[k] = v; this.onLayers(this); } return this; }
  setFilter(id, f) { const l = this.getLayer(id); if (l) { l.filter = f; this.onLayers(this); } return this; }
}

// DOM markers over the canvas, placed from lng/lat every frame the camera moves (MapLibre's Marker, the parts the finder uses).
export class MarkerLayer {
  constructor(map, container) {
    this.map = map; this.container = container; this.list = new Set();
  }
  make() {
    const layer = this;
    return class Marker {
      constructor(o = {}) {
        this._el = o.element || document.createElement('div');
        this._anchor = o.anchor || 'center'; this._offset = o.offset || [0, 0]; this._ll = null; this._on = false;
        this._el.classList.add('v2-marker');
      }
      setLngLat(ll) { this._ll = lngLatOf(ll); if (this._on) layer.place(this); return this; }
      getLngLat() { return this._ll; }
      getElement() { return this._el; }
      addTo() { if (!this._on) { this._on = true; layer.container.append(this._el); layer.list.add(this); layer.place(this); } return this; }
      remove() { this._on = false; this._el.remove(); layer.list.delete(this); layer.soon(); return this; }
      setOffset(o) { this._offset = o; return this; }
    };
  }
  place(m) {
    if (!m._ll) return;
    const p = this.map.project(m._ll);
    const tx = { center: '-50%,-50%', bottom: '-50%,-100%', top: '-50%,0', left: '0,-50%', right: '-100%,-50%' }[m._anchor] || '-50%,-50%';
    if (p.behind) { m._el.style.display = 'none'; m._at = null; return; }
    m._el.style.display = '';
    m._at = [p.x + m._offset[0], p.y + m._offset[1]];
    m._el.style.transform = `translate(${m._at[0].toFixed(1)}px,${m._at[1].toFixed(1)}px) translate(${tx})`;
    this.soon();
  }
  soon() { if (!this.dq) this.dq = requestAnimationFrame(() => { this.dq = 0; this.declutter(); }); }
  update() { for (const m of this.list) this.place(m); this.declutter(); }

  // The finder's number pins never sit on each other (2026-10-19 demo walk: 25 hidden behind 29, 20/21/15 stacked): a pin that
  // touches a better-ranked one hides (PIN.COVERED_CLASS) until the camera separates them. The selected and the hovered pin always
  // show. pinRects() hands the shown pins to the names (labels.js), which then keep off them.
  pinList() {
    const out = [];
    for (const m of this.list) {
      const el = m._el;
      if (!el.classList.contains(PIN.CLASS) || !m._at || el.style.display === 'none' || el.style.visibility === 'hidden') continue;
      const cls = el.className.replace(' ' + PIN.COVERED_CLASS, '');
      if (m._cls !== cls || !m._box) {            // the pin's size, measured again only when its classes change (selected, hovered)
        const b = el.querySelector(PIN.HEAD) || el, inner = b !== el;     // the round head, placed inside the (positioned) pin
        m._box = { w: el.offsetWidth, h: el.offsetHeight, bx: inner ? b.offsetLeft : 0, by: inner ? b.offsetTop : 0, bw: b.offsetWidth, bh: b.offsetHeight };
        m._cls = cls;
      }
      const B = m._box, x0 = m._at[0] - B.w / 2 + B.bx, y0 = m._at[1] - B.h + B.by;      // anchor 'bottom' (the finder's pins)
      const top = el.classList.contains('sel') || el.classList.contains('hot');
      out.push({ m, r: [x0, y0, x0 + B.bw, y0 + B.bh], rank: top ? -1 : (parseInt(el.textContent, 10) || 1e6) });
    }
    return out.sort((a, b) => a.rank - b.rank);
  }
  declutter() {
    const pins = this.pinList(), shown = [], P = PIN.PAD_PX;
    for (const p of pins) {
      const r = p.r, off = shown.some((q) => r[0] - P < q[2] && r[2] + P > q[0] && r[1] - P < q[3] && r[3] + P > q[1]);
      p.m._el.classList.toggle(PIN.COVERED_CLASS, off && p.rank >= 0);
      if (!off || p.rank < 0) shown.push(r);
    }
    // the names lay out again when the set of pins changed (not when they only slid with the camera: that is a layout anyway)
    this.shownPins = shown;
    const sig = pins.length + ':' + shown.length;
    if (sig !== this.pinSig) { this.pinSig = sig; this.onPins?.(); }
  }
  pinRects() { return this.shownPins || []; }
}

export const PIN = { CLASS: 'fd-pinwrap', HEAD: '.fd-pin', COVERED_CLASS: 'v2-covered', PAD_PX: 1 };
