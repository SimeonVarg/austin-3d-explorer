// Real curtain-wall glass for every Blender-built building (2026-10-25).
//
// The owner, on The Independent at his photo IMG_1778: "the exact way the light reflects off the windows — the app windows is still
// a flat reflection gradient". In the photograph each pane mirrors a slightly different piece of sky and cloud: panes on one storey
// differ in brightness, the reflection breaks at every mullion, clouds come back bent, and some panes read dark because the room
// behind shows. Real glazing does this because no two panes are flat in the same way: heat-strengthened glass has a slight bow and
// roller wave, and a sealed double pane pillows in or out with the air inside it. So, per pane:
//
//  1. TILT: the pane's reflection normal is turned by a fraction of a degree in a random direction (the pane sits a little off the
//     plane of its neighbours). A mirror turned by a degrees turns its reflection by 2a, so neighbours mirror different sky.
//  2. BOW: the normal also turns across the pane, out from its middle (a pillowed pane, convex or concave by its own sign), so a
//     cloud or a tower in the pane is bent and the reflection jumps at the mullion where the next pane starts.
//  3. COATING: the reflection strength and roughness vary a little from pane to pane.
//  4. ROOM: what the glass shows of the room behind it (its diffuse colour) is darker or lighter per pane, and some panes have their
//     blinds part down (a lighter band from the top). Looking straight at the glass the reflection is weakest (Fresnel), so the room
//     shows most there, as in the photo.
//
// The pane is found, not guessed: every pane in a Blender master is its own object (named by storey and column), and stays its own
// island of vertices in the app's glb and in the tiles (measured: The Independent 5,868 islands of 4 vertices; tile t_1_1 8,381
// islands, median 4). paneIds() finds the islands once per mesh at load (union-find over the index) and writes, per vertex, the
// offset from its pane's middle and a seed made from that middle's position (so the same pane gets the same look on every load, in
// every tile, at every LOD: nothing changes from frame to frame).
//
// Rule 15 (no shimmer, blur is not a fix): every per-pane term fades out by the pane's size on screen, BEFORE a pane is small enough
// to switch pixels as the camera moves: the bow (which varies inside a pane) is gone below BOW_PX, the rest below VAR_PX. What is
// left far away is exactly the glass as it was (each term is centred on it), so the far city does not change and cannot sparkle.
// Every value below is a taste value (rule 11): one line to change it. ?glassreal=0 turns it all off.
import * as THREE from 'three';

const Q = typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search);
// ?glassreflect=0: the reflection pass of 2026-10-25 off (here: the tilt and bow as before; main.js: no cloud layer, the sky fit as before)
export const GLASS_REFLECT = Q.get('glassreflect') !== '0';
export const GLASS_REAL = {
  ON: Q.get('glassreal') !== '0',
  // 2026-10-25, measured at his photo's camera: in his glass one cloud runs on across many panes, offset a little at each mullion. The
  // BOW is what smeared it: a pane whose normal turns 0.9 deg to its edge squeezes ~4 deg of sky into one pane, so every pane showed a
  // smooth average of the sky (the "flat gradient"); with the bow at 0.2 the cloud carries across the panes and the tilt breaks it.
  TILT_DEG: GLASS_REFLECT ? 1.2 : 0.45,   // per-pane tilt of the reflection normal, the spread (each of two axes, a uniform -1..1 times this)
  BOW_DEG: GLASS_REFLECT ? 0.2 : 0.9,     // per-pane bow: how far the normal turns at the pane's edge vs its middle (sign random per pane)
  ROUGH_VAR: 0.35,         // per-pane roughness, x (1 +- this)
  SPEC_VAR: 0.12,          // per-pane reflection strength (coating), x (1 +- this)
  ROOM_VAR: 0.4,           // per-pane room brightness, x (1 +- this)
  BLINDS_SHARE: 0.15,      // share of panes with blinds part down
  BLINDS_COLOR: [0.12, 0.12, 0.115], // blinds, linear albedo (neutral: a tinted glass colour must not tint them pink or green)
  BLINDS_DOWN: [0.15, 0.85],        // how far down the blinds come, share of the pane height (uniform in this range)
  // fades by the pane's size on screen (its smaller side, in pixels): [gone below, full above]
  VAR_PX: [3, 7],          // tilt, coating, room
  BOW_PX: [10, 24],        // the bow varies inside a pane, so it goes first
  MAX_PANE_M: 12,          // islands bigger than this (a whole glazed wall in one piece) get no per-pane look
  // The SKY in every glass read straight from the sky's own texture, sharp, not from a PMREM map (2026-10-25). A flat mirror shows the
  // sky at the camera's own angular scale (0.02 deg a pixel at the owner's street photo); a 256 px environment face is 0.35 deg a texel,
  // so every cloud came back smeared over ~17 pixels. Only with a real sky (a moment that names one); mip-filtered by the reflection's
  // own derivatives, so far glass gets the sky's average, not its noise (rule 15). SKY_ROUGH: [full, none] roughness for the sharp sky.
  // ?skydirect=0 (or ?glassreflect=0) = off.
  SKY_DIRECT: GLASS_REFLECT && Q.get('skydirect') !== '0',
  SKY_ROUGH: [0.08, 0.2],
};
// the sharp sky: realSkyGLSL + its uniforms (sky-real.js, set by main.js for the moment's sky), as stable {value} holders so compiled
// glass follows a change of sky; every patched glass material is kept to recompile when the sky's defines change
export const SKY = { glsl: null, defines: '', key: '', U: {} };
const glassMats = new Set();
export function setSkyDirect(glsl, uniforms, defines) {
  if (!GLASS_REAL.SKY_DIRECT) return;
  const key = Object.keys(defines || {}).sort().join(',');
  const recompile = !SKY.glsl || key !== SKY.key;
  SKY.glsl = glsl; SKY.key = key; SKY.defines = Object.keys(defines || {}).map((k) => `#define ${k} ${defines[k]}`).join('\n');
  for (const [k, u] of Object.entries(uniforms)) { if (SKY.U[k]) SKY.U[k].value = u.value; else SKY.U[k] = { value: u.value }; }
  if (recompile) for (const m of glassMats) m.needsUpdate = true;
}
// the sharp sky's GLSL (after realSkyGLSL): sd = the sky in direction d as the dome draws it, at the mirror's scale
const SKY_DECL = `uniform vec3 v2SkyScale, v2SkySunDir, v2SkySunCol; uniform float v2SkyGlow;`;
export const SKY_FN = `vec3 v2SharpSky(vec3 d) { return v2real(d) * v2SkyScale + v2SkySunCol * v2SkyGlow * pow(max(dot(d, v2SkySunDir), 0.0), 600.0) * 4.0; }
float v2SharpW(vec3 d, float rough) { return (1.0 - smoothstep(${(+GLASS_REAL.SKY_ROUGH[0]).toFixed(4)}, ${(+GLASS_REAL.SKY_ROUGH[1]).toFixed(4)}, rough)) * smoothstep(-0.02, 0.03, d.y); }`;
export function skyHeader() { return `${SKY_DECL}\n${SKY.defines}\n${SKY.glsl}\n${SKY_FN}`; }

// the pane look of a pane middle: one seed in [0, 1) from its position (rounded to 5 cm, so tiny export differences cannot move it)
function seedOf(x, y, z) {
  let h = 2166136261 >>> 0;
  for (const v of [Math.round(x * 20), Math.round(y * 20), Math.round(z * 20)]) { h ^= v & 0xffff; h = Math.imul(h, 16777619); h ^= v >>> 16; h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 8) / 16777216;
}

// per-vertex pane attributes: v2pane = (offset from the pane's middle, object units; seed), v2paneS = (half width m, half height m)
// mat: the mesh's matrix relative to its tile (quantized positions are scaled by it), so sizes and seeds are in metres
export function paneIds(geo, mat) {
  if (geo.attributes.v2pane) return 0;
  const pos = geo.attributes.position, n = pos.count, idx = geo.index ? geo.index.array : null;
  const par = new Int32Array(n); for (let i = 0; i < n; i++) par[i] = i;
  const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
  const tri = idx ? idx.length : n;
  for (let i = 0; i < tri; i += 3) {
    const a = find(idx ? idx[i] : i), b = find(idx ? idx[i + 1] : i + 1), c = find(idx ? idx[i + 2] : i + 2);
    par[b] = a; par[c] = a;
  }
  const v = new THREE.Vector3();
  const lo = new Map(), hi = new Map();
  const world = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mat); world.set([v.x, v.y, v.z], i * 3);
    const r = find(i);
    if (!lo.has(r)) { lo.set(r, v.clone()); hi.set(r, v.clone()); } else { lo.get(r).min(v); hi.get(r).max(v); }
  }
  const inv = new THREE.Matrix4().copy(mat).invert();
  const a = new Float32Array(n * 4), s = new Float32Array(n * 2);
  const info = new Map();
  for (const [r, l] of lo) {
    const h = hi.get(r), mid = l.clone().add(h).multiplyScalar(0.5), size = h.clone().sub(l);
    const horiz = Math.hypot(size.x, size.z), vert = size.y;
    const big = Math.max(horiz, vert) > GLASS_REAL.MAX_PANE_M;
    info.set(r, { mid, hw: horiz / 2, hh: vert / 2, seed: big ? -1 : seedOf(mid.x, mid.y, mid.z) });
  }
  for (let i = 0; i < n; i++) {
    const p = info.get(find(i));
    // the offset from the pane's middle, back in the mesh's own units (the shader turns it to metres with modelViewMatrix)
    v.set(world[i * 3] - p.mid.x, world[i * 3 + 1] - p.mid.y, world[i * 3 + 2] - p.mid.z);
    // exact inverse of the linear part (transformDirection normalises, so use the 3x3 directly)
    const e = inv.elements, ox = e[0] * v.x + e[4] * v.y + e[8] * v.z, oy = e[1] * v.x + e[5] * v.y + e[9] * v.z, oz = e[2] * v.x + e[6] * v.y + e[10] * v.z;
    a.set([ox, oy, oz, p.seed], i * 4);
    s.set([Math.max(p.hw, 0.05), Math.max(p.hh, 0.05)], i * 2);
  }
  geo.setAttribute('v2pane', new THREE.BufferAttribute(a, 4));
  geo.setAttribute('v2paneS', new THREE.BufferAttribute(s, 2));
  return info.size;
}

const f = (x) => Number(x).toFixed(5);
// strength of the whole per-pane look, at run time (1 = on; 0 = the glass as before, for A/B in one page load)
const GLASS_K = { value: 1 };
export function setGlassReal(k) { GLASS_K.value = k; }
// measuring only (v2-glass-shimmer.mjs): a supersampled TRUTH frame multiplies the pixel footprint by its supersampling factor, so
// the fades decide exactly as in the native frame and the truth is the same picture, sampled finely
const GLASS_FP = { value: 1 };
// tilt and bow (radians) as uniforms, so an A/B can change them inside one page load (window.__v2.glassTilt)
const GLASS_TB = { value: null };
export function setGlassTilt(tiltDeg, bowDeg) { GLASS_TB.value.set(tiltDeg * Math.PI / 180, bowDeg * Math.PI / 180); }
export function setGlassFootprintScale(s) { GLASS_FP.value = s; }
const K = GLASS_REAL;
const DEG = Math.PI / 180;
GLASS_TB.value = new THREE.Vector2(K.TILT_DEG * DEG, K.BOW_DEG * DEG);

// patch a glass material (MeshStandardMaterial or MeshPhysicalMaterial; chains any onBeforeCompile already on it)
export function realGlass(material) {
  if (!K.ON || !material || material.userData.v2GlassReal) return;
  material.userData.v2GlassReal = true;
  glassMats.add(material);
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    // the sharp sky for glass that mirrors the environment map (the sky alone); glass with a local probe stack (exact-pilot.js) has
    // already replaced this chunk and does it there, with its neighbours
    if (SKY.glsl && !material.envMap && sh.fragmentShader.includes('#include <envmap_physical_pars_fragment>')) {
      Object.assign(sh.uniforms, SKY.U);
      const pars = THREE.ShaderChunk.envmap_physical_pars_fragment.replace(
        'vec4 envMapColor = textureCubeUV( envMap, envMapRotation * reflectVec, roughness );',
        'vec4 envMapColor = textureCubeUV( envMap, envMapRotation * reflectVec, roughness );\n\t\tenvMapColor.rgb = mix( envMapColor.rgb, v2SharpSky( reflectVec ), v2SharpW( reflectVec, roughness ) );');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + skyHeader()).replace('#include <envmap_physical_pars_fragment>', pars);
    }
    sh.uniforms.v2GlassK = GLASS_K; sh.uniforms.v2GlassFp = GLASS_FP; sh.uniforms.v2GlassTB = GLASS_TB;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 v2pane;\nattribute vec2 v2paneS;\nvarying vec3 vPaneOff;\nvarying vec3 vPaneSeed;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPaneOff = (modelViewMatrix * vec4(v2pane.xyz, 0.0)).xyz;\nvPaneSeed = vec3(v2pane.w, v2paneS);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vPaneOff;
varying vec3 vPaneSeed;
uniform float v2GlassK;
uniform float v2GlassFp;
uniform vec2 v2GlassTB;
float v2SpecVar = 1.0;
// four numbers in [0, 1) from the pane's seed (per pane, constant: nothing here changes from frame to frame)
vec4 v2paneRand(float s) { return fract(sin(vec4(s * 91.317 + 0.13, s * 47.731 + 1.37, s * 13.137 + 2.71, s * 71.917 + 4.13)) * 43758.5453); }
vec4 v2paneRand2(float s) { return fract(sin(vec4(s * 29.771 + 5.31, s * 63.113 + 6.47, s * 37.519 + 7.93, s * 83.371 + 8.17)) * 24634.6345); }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  if (vPaneSeed.x >= 0.0) {
    vec4 pr = v2paneRand(vPaneSeed.x), pr2 = v2paneRand2(vPaneSeed.x);
    // the pane's size on screen: its smaller side over the pixel's footprint (metres per pixel)
    float v2fp = max(length(dFdx(vViewPosition)), length(dFdy(vViewPosition))) * v2GlassFp;
    float v2px = 2.0 * min(vPaneSeed.y, vPaneSeed.z) / max(v2fp, 1e-5);
    float vf = smoothstep(${f(K.VAR_PX[0])}, ${f(K.VAR_PX[1])}, v2px) * v2GlassK;
    float bf = smoothstep(${f(K.BOW_PX[0])}, ${f(K.BOW_PX[1])}, v2px) * v2GlassK;
    // the pane's plane: across (level) and up, in view space
    vec3 v2up = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
    vec3 t1 = cross(v2up, normal); float t1l = length(t1);
    if (t1l > 0.2) {
      t1 /= t1l; vec3 t2 = cross(normal, t1);
      float u = clamp(dot(vPaneOff, t1) / vPaneSeed.y, -1.0, 1.0), w = clamp(dot(vPaneOff, t2) / vPaneSeed.z, -1.0, 1.0);
      float bowSign = pr.z < 0.5 ? -1.0 : 1.0;
      vec2 tilt = (pr.xy * 2.0 - 1.0) * v2GlassTB.x * vf + vec2(u, w) * bowSign * v2GlassTB.y * (0.5 + pr.w) * bf;
      normal = normalize(normal + t1 * tilt.x + t2 * tilt.y);
      // the room behind: darker or lighter per pane; some panes with blinds part down (a band from the top)
      float room = 1.0 + (pr2.x * 2.0 - 1.0) * ${f(K.ROOM_VAR)};
      float down = mix(${f(K.BLINDS_DOWN[0])}, ${f(K.BLINDS_DOWN[1])}, pr2.y);
      float blinds = (pr2.z < ${f(K.BLINDS_SHARE)} && w > 1.0 - 2.0 * down) ? bf : 0.0;   // an edge inside the pane: it goes with the bow
      vec3 roomC = mix(diffuseColor.rgb * room, vec3(${f(K.BLINDS_COLOR[0])}, ${f(K.BLINDS_COLOR[1])}, ${f(K.BLINDS_COLOR[2])}), blinds);
      // far away: the expected room (blinds share x their colour + the rest x the plain room), so the wall's average stays put
      diffuseColor.rgb = mix(diffuseColor.rgb, roomC, vf);
      roughnessFactor = clamp(roughnessFactor * (1.0 + (pr2.w * 2.0 - 1.0) * ${f(K.ROUGH_VAR)} * vf), 0.0, 1.0);
      v2SpecVar = 1.0 + (fract(pr.x * 7.31 + pr.y * 3.17) * 2.0 - 1.0) * ${f(K.SPEC_VAR)} * vf;
    }
  }`)
      .replace('#include <aomap_fragment>', `reflectedLight.indirectSpecular *= v2SpecVar;\n#include <aomap_fragment>`);
  };
  const key = material.customProgramCacheKey ? material.customProgramCacheKey.bind(material) : () => '';
  material.customProgramCacheKey = () => key() + '|v2-glass-real' + (SKY.glsl && !material.envMap ? '|sky:' + SKY.key : '');
  material.needsUpdate = true;
}

export const glassState = { meshes: 0, panes: 0, ms: 0 };
const isGlassName = (s) => /glass/i.test(s || '');

// every glass mesh of a loaded tile (tiles: the mesh named "glass"; single models: materials named glass_*)
export function glassPrepare(obj) {
  if (!K.ON) return;
  const t0 = performance.now();
  obj.updateMatrixWorld(true);
  const rootInv = new THREE.Matrix4().copy(obj.matrixWorld).invert();
  obj.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (!isGlassName(o.name) && !mats.some((m) => isGlassName(m && m.name))) return;
    if (mats.length > 1 || o.geometry.groups.length > 1) return;   // a glass material shared in one mesh with others: not touched
    const mat = new THREE.Matrix4().multiplyMatrices(rootInv, o.matrixWorld);
    glassState.panes += paneIds(o.geometry, mat);
    glassState.meshes++;
    realGlass(mats[0]);
  });
  glassState.ms += performance.now() - t0;
}
