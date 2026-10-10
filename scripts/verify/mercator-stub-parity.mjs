/**
 * mercator-stub-parity.mjs — the worker's stand-in for maplibregl.MercatorCoordinate gives the SAME BITS as the real MapLibre.
 *
 * Why: js/build-worker.js has no MapLibre (a worker cannot load it), so it carries a small MercatorCoordinate. js/slopes.js turns every footprint corner and every
 * metre into positions through fromLngLat and meterInMercatorCoordinateUnits. MapLibre computes the metre as `1 / earthCircumference * mercatorScale(lat)`;
 * the stub first wrote `1 / (earthCircumference * cos(lat))`, which rounds differently in the last bit. In the real page that moved apartments.position
 * and apartments.normal (and nothing else) between the main-thread build and the worker build, while the Node parity checks, which run the stub on both sides,
 * passed. This check is the missing one: stub against the real library, over a grid across Austin, compared with ===.
 *
 *   MAPLIBRE_JS=/path/maplibre-gl.js node scripts/verify/mercator-stub-parity.mjs [--break]
 *   --break  uses the stub's old order of operations: must report differences and exit 1
 * Node only; needs maplibre-gl 5.24.0 (the version index.html loads) OUTSIDE the repo; prints SKIP without it, so it is quarantined in ci/checks.json.
 */
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GRID = { latFrom: 30.15, latTo: 30.45, lngFrom: -97.95, lngTo: -97.55, steps: 60, altitudes: [0, 3.2, 17.5, 120] };   // named: the grid is a parameter
const BREAK = process.argv.includes('--break');
if (!process.env.MAPLIBRE_JS) { console.log('SKIP: set MAPLIBRE_JS to maplibre-gl@5.24.0 dist/maplibre-gl.js (https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js); the repo does not carry it'); process.exit(0); }

// the real library, with the few browser globals it touches at load
globalThis.window = globalThis; globalThis.self = globalThis;
globalThis.document = { createElement: () => ({ getContext: () => null, style: {} }), documentElement: { style: {} }, head: {}, body: {}, addEventListener() {}, currentScript: null };
(0, eval)(fs.readFileSync(process.env.MAPLIBRE_JS, 'utf8'));
const Real = globalThis.maplibregl.MercatorCoordinate;

// the stub: the text between `self.maplibregl = {` and its closing `} };` in the REAL js/build-worker.js, not a copy
const src = fs.readFileSync(path.join(REPO, 'js/build-worker.js'), 'utf8');
const a = src.indexOf('self.maplibregl = {'), b = src.indexOf('} };', a);
if (a < 0 || b < 0) { console.log('FAIL: could not find the MercatorCoordinate stub in js/build-worker.js'); process.exit(1); }
let stubSrc = src.slice(a, b + 4);
if (BREAK) stubSrc = stubSrc.replace('1 / EARTH * (1 / Math.cos(this.toLngLat().lat * Math.PI / 180))', '1 / (EARTH * Math.cos(this.toLngLat().lat * Math.PI / 180))');
const EARTH = 2 * Math.PI * 6371008.8;
const holder = {}; new Function('self', 'EARTH', stubSrc)(holder, EARTH);
const Stub = holder.maplibregl.MercatorCoordinate;

const t = { fromLngLat: 0, meter: 0, altitude: 0, lngLat: 0 }; let n = 0;
for (let i = 0; i <= GRID.steps; i++) for (let j = 0; j <= GRID.steps; j++) for (const alt of GRID.altitudes) {
  const ll = { lng: GRID.lngFrom + (GRID.lngTo - GRID.lngFrom) * i / GRID.steps, lat: GRID.latFrom + (GRID.latTo - GRID.latFrom) * j / GRID.steps };
  const r = Real.fromLngLat(ll, alt), s = Stub.fromLngLat(ll, alt); n++;
  if (r.x !== s.x || r.y !== s.y || r.z !== s.z) t.fromLngLat++;
  if (r.meterInMercatorCoordinateUnits() !== s.meterInMercatorCoordinateUnits()) t.meter++;
  if (r.toAltitude() !== s.toAltitude()) t.altitude++;
  const rl = r.toLngLat(), sl = s.toLngLat(); if (rl.lng !== sl.lng || rl.lat !== sl.lat) t.lngLat++;
}
let bad = 0;
for (const [k, v] of Object.entries(t)) { console.log((v ? 'FAIL ' : 'PASS ') + k + ': ' + v + ' of ' + n + ' points differ'); bad += v; }
console.log(bad ? '\nFAIL: the worker\'s MercatorCoordinate differs from MapLibre\'s' : '\nPASS: the worker\'s MercatorCoordinate is bit-identical to MapLibre\'s');
process.exit(bad ? 1 : 0);
