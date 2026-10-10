/**
 * build-worker.js — the apartment generator and the shared mesh builder, run in a Web Worker (?buildworker=1, js/apartments-worker.js starts it).
 *
 * WHY. The authored-building build is 4 to 9 s of compute but 60 to 128 s inside the page, because it is time-sliced on the one thread that also parses
 * map tiles (docs/rust-study-2026-10-09.md, #440). A worker has no such neighbour.
 *
 * HOW (the design Astra, the owner's second opinion, gave): a classic worker that importScripts the REAL files, unmodified, behind a `window` shim, in the
 * page's own order: js/wall-patterns.js (it must be the real one: register() writes each patterned material's surface row back into the palette, so
 * the mesh depends on it), three.js, js/slopes.js, js/city-night.js (which windows are lit), js/slopes-roofs.js (emit() draws the pitched roofs),
 * js/slopes-apartments.js. The page's query string rides on the worker URL (the generator reads some flags from location.search); slopes=0 is added so
 * no file boots a map layer. Two permanent seams: `slopes.initOrigin()` and `window.__aptsBuild`.
 *
 * THE SPLIT. buildingOne() also REGISTERS things the page needs (night profile, wall patterns, fixtures): here they run in this worker's own registries
 * AND are recorded as plain data (`record`), which the main thread replays (applyRegistrations). Each building's record (name, top, roofs, rakes...), the
 * tallies, the facade-filter faces (wall frames as data: serializeFace) and each building's first triangle come back with the geometry.
 *
 * PROTOCOL.  page -> worker  { init: { base, three } }                       once; the scripts load while the page still fetches the catalog
 *            worker -> page  { ready }
 *            page -> worker  { build: { specs, gfxPreset, lite, facadeFilter } }
 *            worker -> page  { done: { meshes, pack, triangles, registrations, built, failed, filterFaces, starts, count, ms } }
 *                            every typed array's ArrayBuffer is TRANSFERRED, not copied.
 */
'use strict';
self.window = self;
self.document = { getElementById: () => null, hidden: false, readyState: 'complete', createElement: () => ({ getContext: () => null, style: {} }), addEventListener() {}, body: {} };
let base = null;
self.addEventListener('message', async ev => {
  const m = ev.data || {};
  try {
    if (m.init) { await init(m.init); self.postMessage({ ready: true }); }
    else if (m.build) await run(m.build);
  } catch (e) { self.postMessage({ error: String(e && e.stack || e) }); }
});
async function init({ base: b, three }) {
  base = b;
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
  Object.assign(self, { CityLighting: loose(), RoofTiles: loose(), GroundTexture: loose(), CityTexture: loose() });
  self.GFX = { preset: 'balanced' };
  const js = n => new URL(n, base + 'js/').href;
  importScripts(js('wall-patterns.js'));      // before slopes.js, as in the page
  importScripts(three);
  importScripts(js('slopes.js'));
  importScripts(js('city-night.js'));
  self.slopes.initOrigin();
  self.slopes.material = () => ({ dispose() {} });   // build() asks for a material last; it needs a GL context
  importScripts(js('slopes-roofs.js'));
  importScripts(js('slopes-apartments.js'));
}
async function run({ specs, gfxPreset, lite, facadeFilter }) {
  self.GFX.preset = gfxPreset || 'balanced';
  self.LITE_PROFILE = lite && lite.on ? { on: true, budget: lite.budget } : undefined;
  // the page has a facade filter (js/facade-filter.js) or not; the generator only asks whether it EXISTS, and collects the faces it would rasterise
  self.FacadeFilter = facadeFilter ? { planFaces() { return null; } } : undefined;
  const A = self.__aptsBuild, rec = [], starts = [], keepFilter = [], t0 = performance.now();
  const g = await A.build(specs, undefined, { wasm: false, noworker: true, record: rec, starts, keepFilter });
  const ms = performance.now() - t0, meshes = [], transfer = [], seen = new Set();
  const own = a => { if (!seen.has(a.buffer)) { seen.add(a.buffer); transfer.push(a.buffer); } return a; };
  let pack = null;
  g.traverse(o => {
    if (!o.isMesh) return;
    const gm = o.geometry, out = { attributes: {}, index: null };
    for (const k in gm.attributes) { const a = gm.attributes[k]; out.attributes[k] = { array: own(a.array), itemSize: a.itemSize, normalized: a.normalized }; }
    if (gm.index) out.index = own(gm.index.array);
    const pk = gm.userData && gm.userData.pack;
    if (pk && !pack) pack = { tones: own(pk.tones.slice(0, pk.nTones * 16)), nTones: pk.nTones, normals: own(pk.normals.slice(0, pk.nNormals * 4)), nNormals: pk.nNormals };
    meshes.push(out);
  });
  const count = JSON.parse(JSON.stringify(A.count));   // plain numbers and arrays
  self.postMessage({ done: { meshes, pack, triangles: A.count.triangles, registrations: rec, built: self.slopesApartments.built, failed: A.failed(),
    filterFaces: keepFilter.map(A.serializeFace), starts, count, ms } }, transfer);
}
