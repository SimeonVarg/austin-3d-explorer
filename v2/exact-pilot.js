// Exact-photo pilot (2026-10-25, DRAFT, off unless a manifest asks for it).
//
// The owner's bar: from the camera of one of his photographs the app must look like the photograph, with materials taken FROM
// photographs that react to the app's light. This module is the app half of the pilot on one building (The Independent):
//
//  1. Photo-derived PBR materials. The building's GLB carries its own textures (an albedo map taken from his photograph for the
//     crown screen) and plain base colours that were solved from the photograph under a matched sky. tiles.js keeps GLB materials,
//     so textures arrive as they are; only the glass is adjusted here (three clamps IOR at 2.333, so the coated glass's reflectance
//     at normal incidence, 0.36 in Blender, is reached with specularColor instead).
//  2. A local reflection probe: once the city around the building has loaded, a CubeCamera at the building's middle renders the
//     app's own scene (sky dome, neighbours, ground) with the building hidden; PMREM turns it into the glass's envMap. Nothing from
//     a photograph is in the reflection: the glass mirrors the app's city, so it stays right when the camera moves.
//  3. The old model of the same building in a shared tile is hidden by its _building index (manifest "exactHide").
//
// Manifest keys (only in a trial manifest, e.g. v2/tiles-exact/manifest.json):
//   tile entry  "exact": { "probe": [x, y, z], "probeSize": 256, "glass": { "f0": 0.36, "rough": 0.03, "envIntensity": 1 } }
//   tile entry  "exactHide": [index, ...]      // _building values to drop from that (shared) tile
import * as THREE from 'three';

const EXACT = {
  PROBE_SIZE: 256,          // cube face size of the local probe (px)
  PROBE_NEAR_M: 2, PROBE_FAR_M: 12000,
  GLASS_F0: 0.36,           // coated glass reflectance at normal incidence (Blender pilot: IOR 4.0)
  GLASS_ROUGH: 0.03,
  ENV_INTENSITY: 1.0,
};
export const exactState = { tiles: [], probe: null, probeMs: null, hidden: 0 };

function buildingAttr(geo) {
  for (const k of Object.keys(geo.attributes)) if (k.toLowerCase() === '_building') return geo.attributes[k];
  return null;
}

// drop the triangles of the listed _building values from a shared tile (the old model of the building this pilot replaces)
function hideBuildings(obj, values) {
  const drop = new Set(values);
  obj.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry, a = buildingAttr(g);
    if (!a) return;
    const idx = g.index ? g.index.array : null;
    const n = idx ? idx.length : a.count;
    const keep = [];
    for (let i = 0; i < n; i += 3) {
      const v = idx ? idx[i] : i;
      if (!drop.has(Math.round(a.getX(v)))) { keep.push(idx ? idx[i] : i, idx ? idx[i + 1] : i + 1, idx ? idx[i + 2] : i + 2); }
      else exactState.hidden++;
    }
    g.setIndex(keep);
  });
}

function tuneGlass(obj, def) {
  const G = { f0: EXACT.GLASS_F0, rough: EXACT.GLASS_ROUGH, envIntensity: EXACT.ENV_INTENSITY, ...(def.exact.glass || {}) };
  const glass = [];
  obj.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach((m, i) => {
      if (!/^glass/.test(m.name || '')) return;
      let p = m;
      if (!m.isMeshPhysicalMaterial) {
        p = new THREE.MeshPhysicalMaterial({ name: m.name, color: m.color, roughness: m.roughness, metalness: 0 });
        if (m.onBeforeCompile) p.onBeforeCompile = m.onBeforeCompile;
        if (Array.isArray(o.material)) o.material[i] = p; else o.material = p;
      }
      p.metalness = 0; p.roughness = G.rough; p.ior = 2.333;
      const f0max = Math.pow((p.ior - 1) / (p.ior + 1), 2);
      p.specularIntensity = 1; p.specularColor = new THREE.Color(G.f0 / f0max, G.f0 / f0max, G.f0 / f0max);
      p.envMapIntensity = G.envIntensity;
      p.needsUpdate = true;
      glass.push(p);
    });
  });
  return glass;
}

export function exactPrepare(obj, def) {
  if (def.exactHide) hideBuildings(obj, def.exactHide);
  if (!def.exact) return;
  const glass = tuneGlass(obj, def);
  exactState.tiles.push({ obj, def, glass });
}

// Render the local probe for every exact tile (call when the surroundings have loaded). Returns the time it took.
export function exactProbe(renderer, scene) {
  const t0 = performance.now();
  const pmrem = new THREE.PMREMGenerator(renderer);
  for (const t of exactState.tiles) {
    const size = t.def.exact.probeSize || EXACT.PROBE_SIZE;
    const rt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false });
    const cam = new THREE.CubeCamera(EXACT.PROBE_NEAR_M, EXACT.PROBE_FAR_M, rt);
    cam.position.fromArray(t.def.exact.probe);
    scene.add(cam);
    const vis = t.obj.visible; t.obj.visible = false;
    const sh = renderer.shadowMap.autoUpdate; renderer.shadowMap.autoUpdate = false;
    cam.update(renderer, scene);
    renderer.shadowMap.autoUpdate = sh; t.obj.visible = vis;
    scene.remove(cam);
    const env = pmrem.fromCubemap(rt.texture).texture;
    rt.dispose();
    if (t.env) t.env.dispose();
    t.env = env;
    for (const m of t.glass) { m.envMap = env; m.needsUpdate = true; }
  }
  pmrem.dispose();
  exactState.probeMs = performance.now() - t0;
  return exactState.probeMs;
}
