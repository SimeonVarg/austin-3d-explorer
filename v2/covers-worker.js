// Measures, off the main thread, which plain extrusions a Blender tile stands over (covers.js). One message per tile:
//   in  { job, meshes: [meshArrays...], outlines: [{ id, rings }] }
//   out { job, covered: [{ id, share, top }], raster: { x0, z0, nx, nz, C, h } (the model's height per cell: names hide behind it), ms }
import { rasterOf, coveredBy } from './covers.js';

onmessage = (ev) => {
  const { job, meshes, outlines } = ev.data, t0 = performance.now();
  let covered = [], raster = null;
  try { raster = rasterOf(meshes); covered = coveredBy(raster, outlines); } catch (e) { postMessage({ job, covered: [], error: e.message }); return; }
  postMessage({ job, covered, raster, ms: performance.now() - t0 }, raster ? [raster.h.buffer] : []);
};
