/**
 * proto/maplibre.js - path A as it would be wired in: the same renderer, added to a real MapLibre map
 * as a custom layer, so the camera matrix is whatever MapLibre hands the layer (mainMatrix), composed
 * by renderer.js's localMatrix(). The map has no basemap, only a flat #ff00ff background.
 *   __proto.init(size, cam, fov)   __proto.drawFrame({cam, u})   -> waits for the map to render
 */
import { loadPacked, makeMapLibreLayer } from './renderer.js';

const q = new URLSearchParams(location.search);
const T = { scriptStart: performance.now() };
let map = null, uniforms = null, layer = null;
window.__proto = {
  timeline: T,
  async init(size, cam, fov, aa) {
    const packed = await loadPacked(q.get('data') || '/data/apartments.packed');
    T.fetched = performance.now();
    map = new maplibregl.Map({ container: 'map', interactive: false, fadeDuration: 0, maxPitch: 85, attributionControl: false, canvasContextAttributes: { antialias: !!aa, preserveDrawingBuffer: true },
      style: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#ff00ff' } }] },
      center: cam.center, zoom: cam.zoom, pitch: cam.pitch, bearing: cam.bearing });
    if (fov && map.setVerticalFieldOfView) map.setVerticalFieldOfView(fov);
    await new Promise(r => map.once('load', r));
    layer = makeMapLibreLayer({ packed, origin: packed.meta.origin, uniforms: () => uniforms, maplibregl });
    map.addLayer(layer);
    T.layerAdded = performance.now();
    return T;
  },
  async drawFrame(f) {
    uniforms = f.u;
    map.jumpTo(f.cam);
    await new Promise(r => { map.once('idle', () => r()); map.triggerRepaint(); });
    await new Promise(r => { map.once('render', () => r()); map.triggerRepaint(); });
    if (T.firstFrame == null) T.firstFrame = performance.now();
    return layer.renderer ? { ...layer.renderer.stats } : null;
  },
  get info() { return { canvas: [map.getCanvas().width, map.getCanvas().height], fov: map.getVerticalFieldOfView && map.getVerticalFieldOfView() }; },
};
