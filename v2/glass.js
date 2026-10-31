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
//
// FAR FADE (2026-10-30, rule 15). The fades above take away the per-pane VARIATION, but not the pane's contrast against the wall: a
// pane 2 px wide that is darker (or brighter, mirroring sky) than the wall around it still aliases as the camera moves, and its
// mirror image (the parallax probes reflect the city, so it changes from pixel to pixel) sparkles inside it. T. S. Painter Hall's
// new west wall measured 0.13 frame-to-frame change at 600 m against main's 0.07, all of the extra on panes about 2 px wide. So as
// the pane's smaller side on screen drops from FAR_PX[1] to FAR_PX[0], the whole pane goes over to a plain matte surface: base
// colour to a far colour, roughness to FAR_ROUGH, metalness to 0, direct and indirect specular (and transmission) to 0, opacity 1.
// The far colour: the material's glTF extras v2_glass_far (linear rgb) when the tile build gives one (the colour of the wall around
// the panes, measured off the photograph); otherwise the glass's own base colour x FAR_GAIN, lit as a matte surface. Why that
// default: the shader cannot know the wall, and whatever the pane is replaced with, the far city must not get lighter or darker as a
// whole. A pane far away returns (its room colour) + (its average reflection); with the reflection gone, FAR_GAIN puts the average
// reflection back as a matte brightness (measured on the far views so the frame's mean colour stays put). A per-material colour
// fade on its own did nothing on screen, because the glass is mostly reflection: the reflection has to go with it.
// ?glassfar=0 turns the far fade off (also at run time: __v2.glassFar(0|1), for an A/B in one page load).
import * as THREE from 'three';

export const GLASS_REAL = {
  ON: typeof location === 'undefined' || new URLSearchParams(location.search).get('glassreal') !== '0',
  TILT_DEG: 0.45,          // per-pane tilt of the reflection normal, the spread (each of two axes, a uniform -1..1 times this)
  BOW_DEG: 0.9,            // per-pane bow: how far the normal turns at the pane's edge vs its middle (sign random per pane)
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
  FAR_ON: typeof location === 'undefined' || new URLSearchParams(location.search).get('glassfar') !== '0',
  // the far fade on glass WITHOUT a v2_glass_far from its tile (it then fades to the default colour below). On by default.
  FAR_DEFAULT: true,
  FAR_PX: [1.5, 3],        // far fade by the pane's smaller side on screen, pixels: [fully matte below, glass as before above]
  FAR_ROUGH: 1.0,          // roughness of the far (matte) pane
  FAR_GAIN: 1.0,           // default far colour (no v2_glass_far from the tile): the glass's own base colour x this, for clear (non-metal) glass
  FAR_GAIN_METAL: 0.15,    // ... and x this for mirror glass (metalness 1): its look is the sky it mirrors, not its base colour lit
                           // (tuned 2026-10-30 in one page load, 0 / 0.15 / 0.25 / 0.4 / 0.6 / 1: 0.15 had the lowest shimmer on every view tried)
};

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
export function setGlassFootprintScale(s) { GLASS_FP.value = s; }
// strength of the far fade, at run time (1 = on; 0 = exactly the glass without it)
const GLASS_FAR = { value: GLASS_REAL.FAR_ON ? 1 : 0 };
const GLASS_FAR_G = { value: new THREE.Vector2(GLASS_REAL.FAR_GAIN, GLASS_REAL.FAR_GAIN_METAL) };
const GLASS_FAR_PX = { value: new THREE.Vector2(...GLASS_REAL.FAR_PX) };
const GLASS_FAR_D = { value: GLASS_REAL.FAR_DEFAULT ? 1 : 0 };
const GLASS_FAR_OVR = { value: new THREE.Vector4(0, 0, 0, 0) };   // measuring: one far colour for every glass (w = 1), as if each tile gave it
// measuring: k = strength; the two default-colour gains (clear, mirror) can be set too, for tuning in one page load
// (k, gainMetal, gainClear, px0, px1, useDefault 0|1, r, g, b): positional so a measuring flip can pass "1:0.15:1:1.5:3:1"
export function setGlassFar(k, gainMetal, gainClear, px0, px1, useDefault, r, g, b) {
  GLASS_FAR.value = k;
  if (px1 > 0) GLASS_FAR_PX.value.set(px0, px1);
  if (useDefault === 0 || useDefault === 1) GLASS_FAR_D.value = useDefault;
  if (b != null && !Number.isNaN(b)) GLASS_FAR_OVR.value.set(r, g, b, r >= 0 ? 1 : 0);
  if (gainMetal != null && !Number.isNaN(gainMetal)) GLASS_FAR_G.value.y = gainMetal;
  if (gainClear != null && !Number.isNaN(gainClear)) GLASS_FAR_G.value.x = gainClear;
}
const K = GLASS_REAL;
const DEG = Math.PI / 180;

// patch a glass material (MeshStandardMaterial or MeshPhysicalMaterial; chains any onBeforeCompile already on it)
export function realGlass(material) {
  if (!K.ON || !material || material.userData.v2GlassReal) return;
  material.userData.v2GlassReal = true;
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    sh.uniforms.v2GlassK = GLASS_K; sh.uniforms.v2GlassFp = GLASS_FP; sh.uniforms.v2GlassFarK = GLASS_FAR; sh.uniforms.v2GlassFarG = GLASS_FAR_G; sh.uniforms.v2GlassFarPx = GLASS_FAR_PX; sh.uniforms.v2GlassFarD = GLASS_FAR_D; sh.uniforms.v2GlassFarO = GLASS_FAR_OVR;
    const fc = material.userData.v2_glass_far;
    sh.uniforms.v2GlassFarC = { value: new THREE.Vector4(...(Array.isArray(fc) && fc.length >= 3 ? [fc[0], fc[1], fc[2], 1] : [0, 0, 0, 0])) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 v2pane;\nattribute vec2 v2paneS;\nvarying vec3 vPaneOff;\nvarying vec3 vPaneSeed;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPaneOff = (modelViewMatrix * vec4(v2pane.xyz, 0.0)).xyz;\nvPaneSeed = vec3(v2pane.w, v2paneS);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vPaneOff;
varying vec3 vPaneSeed;
uniform float v2GlassK;
uniform float v2GlassFp;
uniform float v2GlassFarK;
uniform vec2 v2GlassFarPx;  // the far fade band, pixels (GLASS_REAL.FAR_PX)
uniform vec2 v2GlassFarG;
uniform float v2GlassFarD;  // 1: glass without a far colour fades to its own colour x gain; 0: it does not fade
uniform vec4 v2GlassFarO;   // default far colour gains: x clear glass, y mirror glass
uniform vec4 v2GlassFarC;   // rgb: the far colour from the tile (w = 1), or w = 0: the glass's own colour x FAR_GAIN
float v2SpecVar = 1.0;
float v2Far = 0.0;          // 0 = the glass, 1 = the far pane
float v2FarS = 0.0;         // how much of the specular (and transmission) goes: as v2Far
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
      vec2 tilt = (pr.xy * 2.0 - 1.0) * ${f(K.TILT_DEG * DEG)} * vf + vec2(u, w) * bowSign * ${f(K.BOW_DEG * DEG)} * (0.5 + pr.w) * bf;
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
    // far fade: a pane only a pixel or two wide becomes a plain matte surface (no contrast left to alias, no mirror to sparkle)
    vec4 v2fc4 = v2GlassFarO.w > 0.5 ? v2GlassFarO : v2GlassFarC;
    v2Far = (1.0 - smoothstep(v2GlassFarPx.x, v2GlassFarPx.y, v2px)) * v2GlassFarK * max(v2fc4.w, v2GlassFarD);
    if (v2Far > 0.0) {
      vec3 v2fc = v2fc4.w > 0.5 ? v2fc4.rgb : diffuseColor.rgb * mix(v2GlassFarG.x, v2GlassFarG.y, metalnessFactor);
      diffuseColor = mix(diffuseColor, vec4(v2fc, 1.0), v2Far);
      roughnessFactor = mix(roughnessFactor, ${f(K.FAR_ROUGH)}, v2Far);
      metalnessFactor = mix(metalnessFactor, 0.0, v2Far);
    }
    v2FarS = v2Far;
  }`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
  material.specularColor *= 1.0 - v2FarS; material.specularColorBlended *= 1.0 - v2FarS; material.specularF90 *= 1.0 - v2FarS;
#ifdef USE_CLEARCOAT
  material.clearcoat *= 1.0 - v2FarS;
#endif
#ifdef USE_SHEEN
  material.sheenColor *= 1.0 - v2FarS;
#endif
#ifdef USE_IRIDESCENCE
  material.iridescence *= 1.0 - v2FarS;
#endif`)
      .replace('#include <transmission_fragment>', THREE.ShaderChunk.transmission_fragment.replace('material.transmission = transmission;', 'material.transmission = transmission * (1.0 - v2FarS);'))
      .replace('#include <aomap_fragment>', `reflectedLight.indirectSpecular *= v2SpecVar * (1.0 - v2FarS); reflectedLight.directSpecular *= 1.0 - v2FarS;\n#include <aomap_fragment>`);
  };
  const key = material.customProgramCacheKey ? material.customProgramCacheKey.bind(material) : () => '';
  material.customProgramCacheKey = () => key() + '|v2-glass-real';
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
