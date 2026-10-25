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
  // A stack of probes up the building, blended by height, each looked up through a sphere around it (parallax), so a pane low on the
  // tower mirrors the neighbour across the street as seen from ITS height, not from the probe's (2026-10-25, IMG_1778: the lower panes
  // mirror a dark tower and its skyline; one probe at 120 m saw over it, so the app showed sky there). manifest "exact.probes" overrides.
  PROBES: +(typeof location !== 'undefined' && new URLSearchParams(location.search).get('probes')) || 4,   // probes, evenly up the building (?probes=1: the old single probe)
  PROBE_R_M: 160,           // the parallax sphere: about how far the neighbours are (m)
};
const MAXP = 4;
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
      probeStack(p, def);
      p.needsUpdate = true;
      glass.push(p);
    });
  });
  return glass;
}

// the stack's uniforms, one set per exact tile (shared by its glass materials)
function stackUniforms(def) {
  if (def._stackU) return def._stackU;
  def._stackU = { v2ProbeY: { value: new Float32Array(MAXP) }, v2ProbeXZ: { value: new THREE.Vector2() }, v2ProbeR: { value: EXACT.PROBE_R_M },
    v2ProbeN: { value: 0 } };
  for (let k = 0; k < MAXP; k++) def._stackU['v2Probe' + k] = { value: null };
  return def._stackU;
}
function probeStack(m, def) {
  const U = stackUniforms(def), prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    if (!U.v2ProbeN.value) return;
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vV2W;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvV2W = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    const decl = Array.from({ length: MAXP }, (_, k) => `uniform sampler2D v2Probe${k};`).join('\n');
    const taps = Array.from({ length: MAXP }, (_, k) => `
      if (v2ProbeN > ${k}) { float wk = max(0.0, 1.0 - abs(y - v2ProbeY[${k}]) / sp); if (wk > 0.0) {
        vec3 o = vV2W - vec3(v2ProbeXZ.x, v2ProbeY[${k}], v2ProbeXZ.y); float b = dot(o, d), c = dot(o, o) - v2ProbeR * v2ProbeR;
        vec3 dir = normalize(o + d * (-b + sqrt(max(b * b - c, 0.0))));
        acc += wk * textureCubeUV(v2Probe${k}, envMapRotation * dir, rough).rgb; ws += wk; } }`).join('');
    const pars = THREE.ShaderChunk.envmap_physical_pars_fragment.replace(
      'vec4 envMapColor = textureCubeUV( envMap, envMapRotation * reflectVec, roughness );',
      'vec4 envMapColor = vec4(v2ProbeStack(reflectVec, roughness), 1.0);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vV2W;
uniform float v2ProbeY[${MAXP}]; uniform vec2 v2ProbeXZ; uniform float v2ProbeR; uniform int v2ProbeN;
${decl}`).replace('#include <envmap_physical_pars_fragment>', `#ifdef ENVMAP_TYPE_CUBE_UV
// the probes above and below this point, blended by height (hat weights), each through its parallax sphere
vec3 v2ProbeStack(vec3 d, float rough) {
  float sp = v2ProbeN > 1 ? max(v2ProbeY[1] - v2ProbeY[0], 1.0) : 1e6;
  float y = clamp(vV2W.y, v2ProbeY[0], v2ProbeY[v2ProbeN - 1]);
  vec3 acc = vec3(0.0); float ws = 0.0;${taps}
  return acc / max(ws, 1e-4);
}
#endif
${pars}`);
  };
  const key = m.customProgramCacheKey ? m.customProgramCacheKey.bind(m) : () => '';
  m.customProgramCacheKey = () => key() + '|v2-probe-stack' + (U.v2ProbeN.value ? U.v2ProbeN.value : 0);
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
    const c = t.def.exact.probe;
    // heights: evenly up the building (the middle of each of N equal bands), or the manifest's list
    const box = new THREE.Box3().setFromObject(t.obj);
    const n = Math.min(MAXP, t.def.exact.probes ? t.def.exact.probes.length : EXACT.PROBES);
    const ys = t.def.exact.probes || (n <= 1 ? [c[1]] : Array.from({ length: n }, (_, k) => box.min.y + (box.max.y - box.min.y) * (k + 0.5) / n));
    const envs = [];
    const vis = t.obj.visible; t.obj.visible = false;
    const sh = renderer.shadowMap.autoUpdate; renderer.shadowMap.autoUpdate = false;
    for (const y of ys) {
      const rt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false });
      const cam = new THREE.CubeCamera(EXACT.PROBE_NEAR_M, EXACT.PROBE_FAR_M, rt);
      cam.position.set(c[0], y, c[2]);
      scene.add(cam); cam.update(renderer, scene); scene.remove(cam);
      envs.push(pmrem.fromCubemap(rt.texture).texture);
      rt.dispose();
    }
    renderer.shadowMap.autoUpdate = sh; t.obj.visible = vis;
    for (const e of t.envs || []) e.dispose();
    t.envs = envs; t.env = envs[0];
    const U = stackUniforms(t.def);
    U.v2ProbeN.value = envs.length > 1 ? envs.length : 0;
    ys.forEach((y, k) => { U.v2ProbeY.value[k] = y; });
    U.v2ProbeXZ.value.set(c[0], c[2]);
    if (t.def.exact.probeR) U.v2ProbeR.value = t.def.exact.probeR;
    for (let k = 0; k < MAXP; k++) U['v2Probe' + k].value = envs[Math.min(k, envs.length - 1)];
    for (const m of t.glass) { m.envMap = envs[0]; m.needsUpdate = true; }
    exactState.probeYs = ys.map((y) => Math.round(y));
  }
  pmrem.dispose();
  exactState.probeMs = performance.now() - t0;
  return exactState.probeMs;
}
