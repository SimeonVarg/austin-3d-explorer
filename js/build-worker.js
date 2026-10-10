/**
 * build-worker.js — the apartment generator and the shared mesh builder, run in a Web Worker (EXPERIMENT; nothing in the page starts it).
 *
 * WHY. The authored-building build is 4 to 9 s of compute but 60 to 128 s inside the page, because it is time-sliced on the one thread that
 * also parses map tiles (docs/rust-study-2026-10-09.md, #440). A worker has no such neighbour.
 *
 * HOW (the design Astra, the owner's second opinion, gave): a classic worker that importScripts the REAL files, unmodified, behind a `window`
 * shim: js/slopes.js (the builder), js/city-night.js (which windows are lit: it must be the real one, a stand-in lights every window alike and
 * makes a different mesh), js/slopes-apartments.js. The two permanent seams are `slopes.initOrigin()` and `window.__aptsBuild`. The page's
 * own query string rides on the worker URL (`new Worker('js/build-worker.js' + location.search)`), because the generator reads some flags from
 * location.search; slopes=0 is added so neither file boots a map layer.
 *
 * PROTOCOL.  page -> worker  { init: { base, three, gfxPreset, specs } }       (once; `specs` is the catalog the page already fetched)
 *            worker -> page  { ready }
 *            page -> worker  { build: true }
 *            worker -> page  { done: { ms, count, meshes: [ { attributes: { name: { array, itemSize, normalized } }, index } ] } }
 *                            every array's ArrayBuffer is TRANSFERRED, not copied.
 * What it deliberately does not do: the generator also REGISTERS things the page needs (wall patterns, night profiles, each building's frame,
 * the facade filter's face list). Those side effects stay on the main thread, so this file alone cannot replace the page's build; see #<this PR>.
 */
'use strict';
self.window = self;
self.document = { getElementById: () => null, hidden: false, readyState: 'complete', createElement: () => ({ getContext: () => null, style: {} }), addEventListener() {}, body: {} };
self.addEventListener('message', async ev => {
  const m = ev.data || {};
  if (m.init) {
    try { await init(m.init); self.postMessage({ ready: true }); }
    catch (e) { self.postMessage({ error: String(e && e.stack || e) }); }
  } else if (m.build) {
    try { await run(); } catch (e) { self.postMessage({ error: String(e && e.stack || e) }); }
  }
});
let specs = null;
async function init({ base, three, gfxPreset, specs: s }) {
  specs = s;
  // relative URLs inside the generator (data/...) resolve against the page, not js/
  const f = self.fetch.bind(self); self.fetch = (u, o) => f(typeof u === 'string' ? new URL(u, base).href : u, o);
  // maplibregl.MercatorCoordinate: the standard Web Mercator formulas MapLibre uses (slopes.js only calls fromLngLat and meterInMercatorCoordinateUnits)
  const EARTH = 2 * Math.PI * 6371008.8;
  self.maplibregl = { MercatorCoordinate: class {
    constructor(x, y, z = 0) { this.x = x; this.y = y; this.z = z; }
    static fromLngLat(ll, alt = 0) { const lat = ll.lat; return new this((180 + ll.lng) / 360, (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))) / 360, alt / (EARTH * Math.cos(lat * Math.PI / 180))); }
    meterInMercatorCoordinateUnits() { return 1 / (EARTH * Math.cos(this.toLngLat().lat * Math.PI / 180)); }
    toLngLat() { const y2 = 180 - this.y * 360; return { lng: this.x * 360 - 180, lat: 360 / Math.PI * Math.atan(Math.exp(y2 * Math.PI / 180)) - 90 }; }
    toAltitude() { return this.z * EARTH * Math.cos(this.toLngLat().lat * Math.PI / 180); }
  } };
  const loose = () => new Proxy({}, { get: (t, k) => k === Symbol.toPrimitive ? () => '' : (k in t ? t[k] : '') });
  Object.assign(self, { CityLighting: loose(), RoofTiles: loose(), GroundTexture: loose(), CityTexture: loose(), WallPatterns: { register() {}, attach() {} } });
  self.GFX = { preset: gfxPreset };
  importScripts(three);
  importScripts(new URL('slopes.js', base + 'js/').href);
  importScripts(new URL('city-night.js', base + 'js/').href);
  self.slopes.initOrigin();
  self.slopes.material = () => ({ dispose() {} });   // build() asks for a material last; it needs a GL context
  importScripts(new URL('slopes-apartments.js', base + 'js/').href);
}
async function run() {
  const t0 = performance.now();
  const g = await self.__aptsBuild.build(specs);
  const ms = performance.now() - t0, meshes = [], transfer = [], seen = new Set();
  g.traverse(o => {
    if (!o.isMesh) return;
    const gm = o.geometry, out = { attributes: {}, index: null };
    for (const k in gm.attributes) { const a = gm.attributes[k]; out.attributes[k] = { array: a.array, itemSize: a.itemSize, normalized: a.normalized }; if (!seen.has(a.array.buffer)) { seen.add(a.array.buffer); transfer.push(a.array.buffer); } }
    if (gm.index) { out.index = gm.index.array; if (!seen.has(gm.index.array.buffer)) { seen.add(gm.index.array.buffer); transfer.push(gm.index.array.buffer); } }
    meshes.push(out);
  });
  self.postMessage({ done: { ms, count: Object.assign({}, self.__aptsBuild.count, { names: undefined }), meshes } }, transfer);
}
