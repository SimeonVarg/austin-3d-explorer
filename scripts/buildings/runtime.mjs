import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import * as THREE from 'three';

export const GENERATOR_FILES = ['js/city-night.js', 'js/city-lighting.js', 'js/slopes.js', 'js/slopes-roofs.js', 'js/facade-filter.js', 'js/slopes-apartments.js'];
export const HERO_GENERATOR_FILES = ['js/city-night.js', 'js/city-lighting.js', 'js/slopes.js', 'js/heroes.js'];
// MapLibre 5.24's MercatorCoordinate formula; ENU units come from initSlopes.
// No terrain or second coordinate origin is introduced by the compiler.
const EARTH_CIRCUMFERENCE = 2 * Math.PI * 6371008.8;
export class MercatorCoordinate {
  constructor(x, y, z = 0) { this.x = x; this.y = y; this.z = z; }
  static fromLngLat(ll, altitude = 0) {
    const lng = Array.isArray(ll) ? ll[0] : ll.lng;
    const lat = Array.isArray(ll) ? ll[1] : ll.lat;
    return new MercatorCoordinate((180 + lng) / 360,
      (180 - (180 / Math.PI * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)))) / 360,
      altitude / (EARTH_CIRCUMFERENCE * Math.cos(lat * Math.PI / 180)));
  }
  toLngLat() { return { lng: this.x * 360 - 180, lat: 360 / Math.PI * Math.atan(Math.exp((180 - this.y * 360) * Math.PI / 180)) - 90 }; }
  toAltitude() { return this.z * EARTH_CIRCUMFERENCE * Math.cos(this.toLngLat().lat * Math.PI / 180); }
  meterInMercatorCoordinateUnits() {
    // Keep MapLibre's multiplication order. Dividing by cos instead rounds the
    // ENU scale differently and changes tiny, nonzero normals in authored roofs.
    return 1 / EARTH_CIRCUMFERENCE * (1 / Math.cos(this.toLngLat().lat * Math.PI / 180));
  }
}

/** Evaluate the real, complete sources, without a renderer, network, DOM or boot timers. */
export async function createCompilerRuntime(rootDir, { quiet = true } = {}) {
  const warnings = [];
  const context = vm.createContext({
    THREE, performance, URL, URLSearchParams, TextEncoder, TextDecoder,
    ArrayBuffer, DataView, Float32Array, Float64Array, Uint8Array, Uint8ClampedArray,
    Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array,
    location: { search: '?preset=balanced&intro=0&drift=0' },
    document: { readyState: 'loading', hidden: false, addEventListener() {}, getElementById() { return null; } },
    navigator: { userAgent: 'Flyover offline building compiler' },
    console: {
      log: quiet ? () => {} : (...args) => console.log(...args),
      warn: (...args) => { warnings.push(args.join(' ')); if (!quiet) console.warn(...args); },
      error: (...args) => { throw new Error(args.join(' ')); },
    },
    setTimeout() { return 0; }, clearTimeout() {}, setInterval() { return 0; }, clearInterval() {},
    requestAnimationFrame() { return 0; }, cancelAnimationFrame() {},
    addEventListener() {}, removeEventListener() {},
    fetch() { throw new Error('Offline compiler attempted a network fetch'); },
    GFX: { preset: 'balanced' }, LITE_PROFILE: { on: false, budget: null },
    maplibregl: { MercatorCoordinate },
  });
  context.window = context;
  const layers = new Map();
  const map = { getLayer: id => layers.get(id), getStyle: () => ({ layers: [...layers.values()] }),
    addLayer: layer => layers.set(layer.id, layer), triggerRepaint() {}, on() {}, once() {} };
  for (const file of GENERATOR_FILES) vm.runInContext(await fs.readFile(path.join(rootDir, file), 'utf8'), context, { filename: file });
  context.initSlopes(map);
  if (typeof context.slopesApartments?.compileBuilding !== 'function') throw new Error('slopesApartments.compileBuilding hook is missing');
  return {
    THREE, context, warnings,
    async compile(spec, options) {
      warnings.length = 0;
      if (spec.renderer === 'heroes' && !context.compileHeroBuilding) vm.runInContext(await fs.readFile(path.join(rootDir, 'js/heroes.js'), 'utf8'), context, { filename: 'js/heroes.js' });
      const result = spec.renderer === 'heroes'
        ? context.compileHeroBuilding(spec.featureCollection, { id: spec.id, name: spec.name })
        : await context.slopesApartments.compileBuilding(spec, options);
      return { ...result, warnings: [...warnings] };
    },
    dispose(result) {
      const materials = new Set();
      result.group.traverse(mesh => {
        mesh.geometry?.dispose();
        if (mesh.userData.disposeFacade) mesh.userData.disposeFacade();
        else if (mesh.material) materials.add(mesh.material);
      });
      for (const material of materials) material.dispose();
    },
  };
}
