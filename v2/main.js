// Flyover v2: one three.js renderer for the whole city (no MapLibre).
//   ground + roads + sidewalks + trees + plain extrusions (built in city-worker.js from the repo's data)
//   + the Blender-model tiles (tiles.js, from v2/tiles/manifest.json; ?tiles=test loads the one-building test set)
//   + a walking route (route-worker.js, A* on data/walk_graph.json).
//
// GROUND NOTE: the repo has no elevation model, so the ground is flat at y = 0 (the old app's ground is flat too).
// Every height here is metres above that plane, as in the tile contract.
import * as THREE from 'three';
import { FlyControls, CollisionField, FLY } from './flycam.js';
import { LOOK, QUALITY } from './look.js';
import { ORIGIN, setOrigin, toLocal, toLonLat } from './geo.js';
import { TileStreamer, TILES } from './tiles.js';
import { MapLite, MarkerLayer, MercatorCoordinate } from './maplite.js';
import { MapLayers } from './map-layers.js';
import { Labels, blenderItems, homeItems, campusItems } from './labels.js';
import { installGround } from './ground.js';

const params = new URLSearchParams(location.search);

// The haze (LOOK.HAZE_*), for every lit material: the old app's exponential day haze instead of three.js's linear fog. three.js
// mixes fog into the colour AFTER tone mapping and the output encoding, so the haze colour gets the same tone map and encoding
// here, and the far city meets the sky dome (drawn through the same two steps) at exactly the dome's colour.
THREE.ShaderChunk.fog_fragment = /* glsl */`
#ifdef USE_FOG
  float hazeK = ${LOOK.HAZE_MAX.toFixed(4)} * (1.0 - exp(-vFogDepth / ${LOOK.HAZE_DIST_M.toFixed(1)}));
  hazeK = mix(hazeK, 1.0, smoothstep(${LOOK.HAZE_EDGE_M[0].toFixed(1)}, ${LOOK.HAZE_EDGE_M[1].toFixed(1)}, vFogDepth));
  #ifdef TONE_MAPPING
    vec3 hazeC = toneMapping(fogColor);
  #else
    vec3 hazeC = fogColor;
  #endif
  hazeC = linearToOutputTexel(vec4(hazeC, 1.0)).rgb;
  gl_FragColor.rgb = mix(gl_FragColor.rgb, hazeC, hazeK);
#endif
`;
const PHONE = matchMedia('(max-width: 600px), (pointer: coarse)').matches;

// ── camera and controls (not taste: limits that keep the city usable). The controls are v1's flycam (flycam.js, FLY). ──
export const VIEW = {
  FOV_DEG: 40,
  NEAR_M: 1.5,                 // the near plane at height; flycam.js lowers it with the eye (FLY.NEAR_PER_M)
  FAR_M: 16000,
  MIN_DISTANCE_M: 25,          // flyTo (the ?panel=1 planner) keeps at least 4x this from its target
  MAX_DISTANCE_M: 5200,
  BOUNDS: { minX: -2600, maxX: 2600, minZ: -2000, maxZ: 4200 },   // the camera's eye stays inside this (campus, West Campus, downtown)
  START: { target: [-260, 0, 60], distance: 1350, polarDeg: 56, azimuthDeg: 28 },   // ?intro=0 (the verify scripts), and where the flight stops if it is cut short
  FLY_MS: 1100,
};

// ── the opening: the old app's loading screen, then the old app's opening flight (js/app.js INTRO, same poses, same timings) ──
// Poses are MapLibre's (centre, zoom, pitch, bearing); maplite.js turns them into v2's camera with the same framing at the centre.
export const INTRO = {
  on: params.get('intro') !== '0',
  start: { center: [-97.7420, 30.2680], zoom: 16.2,  pitch: 78, bearing: 5 },
  crest: { center: [-97.7404, 30.2748], zoom: 15.45, pitch: 71, bearing: 3 },
  end:   { center: [-97.7365, 30.2900], zoom: 16.45, pitch: 74, bearing: 202 },
  leg1Ms: 6000,      // the rise out of downtown, decelerating into the crest
  leg2Ms: 6600,      // the run north into campus, the bank, and the long settle
  minVeilMs: 2500,   // the loading screen stays at least this long, so it is seen, not flashed (v2 loads in a few seconds)
  maxVeilMs: 30000,  // and lifts by this time whatever is still loading
  liftMs: 1150,      // the fade (style.css #veil transition)
};

const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const status = (msg, done = false) => { statusEl.textContent = msg; statusEl.classList.toggle('done', done); };

// ── renderer ───────────────────────────────────────────────────────────
const canvas = $('view');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: QUALITY.MSAA, powerPreference: 'high-performance',
    reversedDepthBuffer: params.get('revdepth') !== '0' });
} catch (e) {
  status('This map needs WebGL 2, which this browser does not offer.');
  throw e;
}
const DPR = Math.min(devicePixelRatio || 1, PHONE ? QUALITY.MAX_PIXEL_RATIO_PHONE : QUALITY.MAX_PIXEL_RATIO);
renderer.outputColorSpace = THREE.SRGBColorSpace;
// 'standard': Blender's Standard view (exposure, then the sRGB curve) below LOOK.TONE_SHOULDER, and above it the highlight
// roll-off of Khronos PBR Neutral, WITHOUT Neutral's dark offset (which subtracts the darkest channel from dark colours and turned
// every shade navy). Shade and mid-tones are exactly the Blender renders'; a sunlit white roof rolls off instead of clipping flat.
THREE.ShaderChunk.tonemapping_pars_fragment = THREE.ShaderChunk.tonemapping_pars_fragment.replace('vec3 CustomToneMapping( vec3 color ) { return color; }', `
vec3 CustomToneMapping( vec3 color ) {
  const float S = ${LOOK.TONE_SHOULDER.toFixed(4)};
  const float Desaturation = 0.15;
  color *= toneMappingExposure;
  float peak = max( color.r, max( color.g, color.b ) );
  if ( peak < S ) return color;
  float d = 1. - S;
  float newPeak = 1. - d * d / ( peak + d - S );
  color *= newPeak / peak;
  float g = 1. - 1. / ( Desaturation * ( peak - newPeak ) + 1. );
  return mix( color, vec3( newPeak ), g );
}`);
renderer.toneMapping = { standard: THREE.CustomToneMapping, agx: THREE.AgXToneMapping, aces: THREE.ACESFilmicToneMapping, neutral: THREE.NeutralToneMapping, none: THREE.NoToneMapping }[LOOK.TONE_MAPPING] ?? THREE.AgXToneMapping;
renderer.toneMappingExposure = LOOK.EXPOSURE;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(VIEW.FOV_DEG, 1, VIEW.NEAR_M, VIEW.FAR_M);

// The camera bumps into the buildings and trunks (flycam.js CollisionField: filled from the city worker, the Blender tops, the trees).
const field = new CollisionField();
const controls = new FlyControls(camera, canvas, {
  bounds: VIEW.BOUNDS, field,
  isEasing: () => !!(map && map.isEasing()) || !!flight,
  home: (ms) => map.easeTo({ ...INTRO.end, duration: ms, essential: true }),
  joystick: { zone: $('joystick-zone'), base: $('joystick-base'), knob: $('joystick-knob') },
});

function placeCamera({ target, distance, polarDeg, azimuthDeg }) {
  const p = THREE.MathUtils.degToRad(polarDeg), a = THREE.MathUtils.degToRad(azimuthDeg);
  camera.position.set(target[0] + distance * Math.sin(p) * Math.sin(a), target[1] + distance * Math.cos(p), target[2] + distance * Math.sin(p) * Math.cos(a));
  camera.lookAt(...target);
  camera.updateMatrixWorld();
  controls.syncFromCamera();
}

// The old app's modules talk to "the map" (window.__map, maplibregl.Marker): maplite.js answers for v2's camera.
// (the flights start from wherever the flycam is: its whole pitch range and down to its 1.7 m eye, so a flight never jumps first)
const map = new MapLite({ camera, controls, canvas, redraw: () => { dirty = true; },
  limits: { maxPitch: FLY.PITCH_MAX, minDistance: 1, maxDistance: VIEW.MAX_DISTANCE_M } });
placeCamera(VIEW.START);
const markers = new MarkerLayer(map, $('markers'));
window.__map = map;
window.maplibregl = Object.assign(window.maplibregl || {}, { Marker: markers.make(), MercatorCoordinate });
const mapLayers = new MapLayers({ map, scene, markers, redraw: () => { dirty = true; } });

controls.addEventListener('change', () => { dirty = true; });

// ── sky: one shader for the visible dome AND the environment light ─────
const sunDir = (() => {
  const az = THREE.MathUtils.degToRad(LOOK.SUN_AZIMUTH_DEG), el = THREE.MathUtils.degToRad(LOOK.SUN_ELEVATION_DEG);
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
})();
// The sky as a ramp by the sine of the height above the level line (LOOK.SKY_STOPS), times a per-use scale:
//   the visible dome  x SKY_DOME_GAIN          (tone mapped like everything else)
//   the light         x SKY_GAIN x LIGHT_B.sky, with the ground's bounce below the level line
//   what glass sees   x LIGHT_B.mirror, with GROUND_MIRROR below the level line
const lin255 = (c) => { const k = new THREE.Color().setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace); return [k.r, k.g, k.b]; };
const STOPS = LOOK.SKY_STOPS.map(([z, c]) => [z, lin255(c)]);
const sunRGB = LOOK.SUN_STRENGTH.map((v) => v * LOOK.LIGHT_B.sun);
const sunMax = Math.max(...sunRGB);
function skyMaterial(scale, below, glow, stops = STOPS) {
  return new THREE.ShaderMaterial({
    name: 'v2-sky',
    uniforms: {
      sines: { value: stops.map((s) => s[0]) }, cols: { value: stops.map((s) => new THREE.Vector3(...s[1])) },
      scale: { value: new THREE.Vector3(...scale) }, below: { value: new THREE.Vector3(...(below || [0, 0, 0])) },
      sunDir: { value: sunDir }, sunColor: { value: new THREE.Vector3(...sunRGB.map((v) => v / sunMax)) }, glow: { value: glow },
    },
    defines: { N: STOPS.length, HAS_BELOW: below ? 1 : 0 },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform float sines[N]; uniform vec3 cols[N]; uniform vec3 scale, sunColor, sunDir, below; uniform float glow;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float z = d.y;
        vec3 c = cols[0];
        for (int i = 1; i < N; i++) {
          if (z > sines[i - 1]) c = mix(cols[i - 1], cols[i], clamp((z - sines[i - 1]) / (sines[i] - sines[i - 1]), 0.0, 1.0));
        }
        c *= scale;
        #if HAS_BELOW
        if (z < -0.01) c = below;
        #endif
        float s = max(dot(d, normalize(sunDir)), 0.0);
        c += sunColor * glow * (pow(s, 24.0) * 0.5 + pow(s, 600.0) * 4.0);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
  });
}
const domeScale = [LOOK.SKY_DOME_GAIN, LOOK.SKY_DOME_GAIN, LOOK.SKY_DOME_GAIN];
// The visible dome: below the horizon stop it is the horizon (= the haze colour), not the far land the LIGHT sees there, so the hazed
// ground meets it without a band (the light keeps the far-land stops: walls still get the dark land's bounce).
const domeStops = STOPS.map((s, i) => (i < 2 ? [s[0], STOPS[2][1]] : s));
const dome = new THREE.Mesh(new THREE.SphereGeometry(VIEW.FAR_M * 0.8, 48, 24), skyMaterial(domeScale, null, LOOK.SKY_SUN_GLOW * LOOK.SKY_DOME_GAIN, domeStops));
dome.renderOrder = -10; dome.frustumCulled = false;
scene.add(dome);
// fog = the dome's horizon, in the same (pre tone map) units
scene.fog = new THREE.Fog(new THREE.Color().setRGB(...STOPS[2][1].map((v) => v * LOOK.SKY_DOME_GAIN), THREE.LinearSRGBColorSpace), 1, VIEW.FAR_M);   // near/far unused: see fog_fragment above

// the bounce: the ground (LIGHT_B.ground) lit by the sun and the sky, seen from a wall: radiance = albedo x irradiance / pi
const skyLightScale = LOOK.SKY_GAIN.map((g) => g * LOOK.LIGHT_B.sky);
const zenithAvg = STOPS[STOPS.length - 1][1].map((v, i) => v * skyLightScale[i]);
const groundIrr = sunRGB.map((v, i) => v * Math.sin(THREE.MathUtils.degToRad(LOOK.SUN_ELEVATION_DEG)) + Math.PI * 0.5 * (zenithAvg[i] + STOPS[3][1][i] * skyLightScale[i]));
const bounce = groundIrr.map((e) => (LOOK.LIGHT_B.ground * e) / Math.PI);

const pmrem = new THREE.PMREMGenerator(renderer);
function envFrom(mat) {
  const s = new THREE.Scene(); s.add(new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), mat));
  const rt = pmrem.fromScene(s, 0, 1, 1000);
  mat.dispose();
  return rt.texture;
}
// What lights a surface and what a surface MIRRORS are two different skies in the old app's light (city-sky.js: "two different
// numbers"). three.js has one environment map for both, so: the environment map is the MIRROR sky (every specular reflection and
// all glass see it), and a light probe adds the rest of the diffuse light: (the lighting sky + the ground's bounce) - the mirror sky.
const mirrorScale = [LOOK.LIGHT_B.mirror, LOOK.LIGHT_B.mirror, LOOK.LIGHT_B.mirror];
scene.environment = envFrom(skyMaterial(mirrorScale, LOOK.GROUND_MIRROR, 0));
scene.environmentIntensity = 1;
function skyAt(z, scale, below) {
  if (below && z < -0.01) return below;
  let c = STOPS[0][1];
  for (let i = 1; i < STOPS.length; i++) if (z > STOPS[i - 1][0]) { const t = THREE.MathUtils.clamp((z - STOPS[i - 1][0]) / (STOPS[i][0] - STOPS[i - 1][0]), 0, 1); c = STOPS[i - 1][1].map((v, k) => v + (STOPS[i][1][k] - v) * t); }
  return c.map((v, k) => v * scale[k]);
}
const diffuseProbe = (() => {
  // project (lighting sky - mirror sky) radiance onto 9 spherical harmonics by brute force over the sphere
  const sh = new THREE.SphericalHarmonics3(), basis = new Array(9).fill(0), d = new THREE.Vector3(), NU = 64, NV = 128;
  for (let i = 0; i < NU; i++) {
    const th = ((i + 0.5) / NU) * Math.PI, w = Math.sin(th) * (Math.PI / NU) * ((2 * Math.PI) / NV);
    for (let j = 0; j < NV; j++) {
      const ph = ((j + 0.5) / NV) * 2 * Math.PI;
      d.set(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph));
      const L = skyAt(d.y, skyLightScale, bounce), M = skyAt(d.y, mirrorScale, LOOK.GROUND_MIRROR);
      THREE.SphericalHarmonics3.getBasisAt(d, basis);
      for (let k = 0; k < 9; k++) sh.coefficients[k].add(new THREE.Vector3(Math.max(0, L[0] - M[0]), Math.max(0, L[1] - M[1]), Math.max(0, L[2] - M[2])).multiplyScalar(basis[k] * w));
    }
  }
  return new THREE.LightProbe(sh, 1);
})();
scene.add(diffuseProbe);

// ── sun with a stable shadow box ───────────────────────────────────────
const sun = new THREE.DirectionalLight(new THREE.Color().setRGB(...sunRGB.map((v) => v / sunMax), THREE.LinearSRGBColorSpace), sunMax);
sun.castShadow = true;
const SHADOW_SIZE = PHONE ? LOOK.SHADOW_MAP_SIZE_PHONE : LOOK.SHADOW_MAP_SIZE;
sun.shadow.mapSize.set(SHADOW_SIZE, SHADOW_SIZE);
sun.shadow.radius = LOOK.SHADOW_RADIUS;
// The shadow box's size, fitted to the view (LOOK.SHADOW_FIT): one of a fixed ladder of sizes, chosen with hysteresis.
const SHADOW_LADDER = [];
for (let e = LOOK.SHADOW_EXTENT_MIN_M; e < LOOK.SHADOW_EXTENT_MAX_M * 1.001; e *= LOOK.SHADOW_EXTENT_STEP) SHADOW_LADDER.push(e);
let shadowRung = -1, shadowExtent = 0, shadowStep = 0;
function setShadowExtent(rung) {
  shadowRung = rung; shadowExtent = SHADOW_LADDER[rung];
  const c = sun.shadow.camera, depth = SUN_DISTANCE_M * 2;
  Object.assign(c, { left: -shadowExtent, right: shadowExtent, top: shadowExtent, bottom: -shadowExtent, near: 1, far: depth });
  c.updateProjectionMatrix();
  const texel = (2 * shadowExtent) / SHADOW_SIZE;
  shadowStep = texel * LOOK.SHADOW_STEP_TEXELS;
  // a reversed depth buffer flips the sign of the shadow bias (measured: a negative bias self-shadows every Blender roof when reversed)
  sun.shadow.bias = -(LOOK.SHADOW_BIAS_M / depth) * (renderer.capabilities.reversedDepthBuffer ? -1 : 1);
  sun.shadow.normalBias = texel * LOOK.SHADOW_NORMAL_BIAS_TEXELS;
  shadowKey = '';
}
function fitShadow() {
  const want = LOOK.SHADOW_FIT * camera.position.distanceTo(controls.focus);
  const H = LOOK.SHADOW_EXTENT_HYSTERESIS;
  if (shadowRung >= 0) {
    const e = SHADOW_LADDER[shadowRung];
    if (want <= e * (1 + H) && want >= e / LOOK.SHADOW_EXTENT_STEP * (1 - H)) return;   // still inside this rung, with the margin
  }
  let r = SHADOW_LADDER.findIndex((e) => e >= want);
  if (r < 0) r = SHADOW_LADDER.length - 1;
  if (r !== shadowRung) setShadowExtent(r);
}
scene.add(sun, sun.target);

// The shadow map is drawn again only when it can change (QUALITY.SHADOW_CACHE). three.js's default redraws it on EVERY frame: every
// caster in the light's box (most of the city's triangles) drawn a second time into a 4096 x 4096 map, for a picture that is the
// same unless the light box moved (followShadow sets needsUpdate) or a caster changed. A caster change is caught generically, so a
// layer added later needs no hook: just before three.js would draw the shadow, a signature of every visible shadow-casting mesh
// (which mesh, its geometry and that geometry's version, its instance count and matrices, where it stands) is compared with the
// last one, and any difference redraws the map.
const SHADOW_CACHE = QUALITY.SHADOW_CACHE && params.get('shadowcache') !== '0';
sun.shadow.autoUpdate = !SHADOW_CACHE;
const shadowStats = { redraws: 0, frames: 0, sigMs: 0 };
function casterSignature(root) {
  let a = 0x811c9dc5, b = 0;
  const mix = (v) => { a = Math.imul(a ^ (v | 0), 0x01000193); b = (b + Math.imul(v | 0, 0x9e3779b1)) | 0; };
  const visit = (o) => {
    if (!o.visible) return;
    if (o.castShadow && o.geometry) {
      const g = o.geometry, p = g.attributes.position, e = o.matrixWorld.elements;
      mix(o.id); mix(g.id); mix(p ? p.version : -1); mix(g.index ? g.index.version : -1); mix(g.drawRange.start); mix(Math.min(g.drawRange.count, 2e9));
      if (o.isInstancedMesh) { mix(o.count); mix(o.instanceMatrix.version); }
      mix(e[12] * 256); mix(e[13] * 256); mix(e[14] * 256); mix(e[0] * 4096); mix(e[5] * 4096); mix(e[10] * 4096);
    }
    const c = o.children;
    for (let i = 0; i < c.length; i++) visit(c[i]);
  };
  visit(root);
  return a + ':' + b;
}
if (SHADOW_CACHE) {
  const drawShadows = renderer.shadowMap.render;
  let lastSig = '';
  renderer.shadowMap.render = function (lights, s, cam) {
    if (s === scene) {
      const t = performance.now();
      const sig = casterSignature(scene);
      shadowStats.sigMs += performance.now() - t; shadowStats.frames++;
      if (sig !== lastSig) { lastSig = sig; sun.shadow.needsUpdate = true; }
      if (sun.shadow.needsUpdate) shadowStats.redraws++;
    }
    return drawShadows.call(this, lights, s, cam);
  };
}
if (LOOK.HEMI_INTENSITY > 0) scene.add(new THREE.HemisphereLight(LOOK.HEMI_SKY, LOOK.HEMI_GROUND, LOOK.HEMI_INTENSITY));

const SUN_DISTANCE_M = 1500;   // the shadow camera stands this far up the sun from the target (covers the tallest tower in the largest box)
const lightF = sunDir.clone().negate(), lightR = new THREE.Vector3().crossVectors(lightF, new THREE.Vector3(0, 1, 0)).normalize();
const lightU = new THREE.Vector3().crossVectors(lightR, lightF).normalize();
let shadowKey = '';
function followShadow() {
  fitShadow();
  // Move the shadow box in whole steps measured in the light's own axes, so every shadow texel stays where it was.
  const t = controls.focus;
  const a = Math.round(t.dot(lightR) / shadowStep) * shadowStep, b = Math.round(t.dot(lightU) / shadowStep) * shadowStep;
  const key = a + ',' + b;
  if (key === shadowKey) return;
  shadowKey = key;
  const c = lightR.clone().multiplyScalar(a).addScaledVector(lightU, b);
  // put the centre back on the ground plane along the light's view direction
  const k = -c.y / lightF.y; c.addScaledVector(lightF, k);
  sun.target.position.copy(c);
  sun.position.copy(c).addScaledVector(sunDir, SUN_DISTANCE_M);
  sun.target.updateMatrixWorld();
  sun.shadow.needsUpdate = true;
}

// ── ground layers: flat, painted in order (no depth write, so nothing on the ground can z-fight) ──
const ORDER = { GROUND: 0, ROADS: 1, SIDEWALKS: 2, ROUTE: 3 };
// the ground reaches past the far plane in every direction the camera can look from inside VIEW.BOUNDS: its edge is never seen
const ground = new THREE.Mesh(new THREE.PlaneGeometry(VIEW.FAR_M * 2 + 6000, VIEW.FAR_M * 2 + 6000).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: LOOK.GROUND, roughness: 1, metalness: 0, depthWrite: false }));
ground.position.set(0, 0, 1000);
ground.receiveShadow = true; ground.renderOrder = ORDER.GROUND;
scene.add(ground);

const flatMaterial = () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, depthWrite: false });
const buildingMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: LOOK.BUILDING_ROUGHNESS, metalness: 0 });
// The plain buildings' facades (LOOK.FACADE): windows and slab lines from each wall's [bay, storey] coordinates, box-filtered
// over the pixel's footprint so they are sharp close up and their exact average far away (rule 15: no flicker, and not a blur).
// A plain building whose Blender model is arriving first fades into the haze (attribute hz, 0..1: tiles.js FADE), so the model
// that replaces it can come out of the haze instead of popping in.
const FACADES = LOOK.FACADE.ON && params.get('facades') !== '0';
buildingMaterial.onBeforeCompile = (sh) => {
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float hz;\nvarying float vHz;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHz = hz;');
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vHz;')
    .replace('#include <fog_fragment>', '#include <fog_fragment>\n#ifdef USE_FOG\n  gl_FragColor.rgb = mix(gl_FragColor.rgb, hazeC, vHz);\n#endif');
  if (FACADES) facadeShader(sh);
};
buildingMaterial.customProgramCacheKey = () => 'v2-buildings' + (FACADES ? '-facades' : '');
function facadeShader(sh) {
  const F = LOOK.FACADE, glass = new THREE.Color(F.GLASS);
  const f = (v) => v.toFixed(5);
  {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 fac;\nvarying vec2 vFac;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFac = fac;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec2 vFac;
// the share of [x - w/2, x + w/2] that lies inside the pulses [a, b] of a pattern with period 1 (an exact box filter)
float pulseI(float x, float a, float b) { return floor(x) * (b - a) + clamp(fract(x), a, b) - a; }
float pulseF(float x, float w, float a, float b) {
  w = max(w, 1e-4);
  float k = (pulseI(x + 0.5 * w, a, b) - pulseI(x - 0.5 * w, a, b)) / w;
  return mix(k, b - a, smoothstep(${f(F.FADE_PX[0])}, ${f(F.FADE_PX[1])}, w));
}`).replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
if (vFac.x >= 0.0) {
  float cls = floor(vFac.x / 1000.0);
  vec2 fc = vec2(vFac.x - cls * 1000.0, vFac.y);
  vec2 w = fwidth(fc);
  vec3 win3 = ${F.STOREYS.map((c, i) => `cls < ${i}.5 ? vec3(${f(c[2])}, ${f(c[3])}, ${f(c[4])}) :`).join(' ')} vec3(0.5);
  float wx = pulseF(fc.x, w.x, 0.5 - 0.5 * win3.x, 0.5 + 0.5 * win3.x);
  float wy = pulseF(fc.y, w.y, win3.z, win3.z + win3.y);
  float win = wx * wy;
  float band = ${F.BAND > 0 ? `pulseF(fc.y, w.y, 0.0, ${f(F.BAND)})` : '0.0'};
  diffuseColor.rgb *= mix(1.0, ${f(F.BAND_SHADE)}, band * (1.0 - win));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(${f(glass.r)}, ${f(glass.g)}, ${f(glass.b)}), win);
  roughnessFactor = mix(roughnessFactor, ${f(F.GLASS_ROUGHNESS)}, win);
}`);
  }
}

const city = { buildings: [], byId: new Map(), roads: [], sidewalks: [], trees: null, hidden: new Set(), stats: null };
const cityGroup = new THREE.Group(); cityGroup.name = 'city';
scene.add(cityGroup);
// the City's 2025 aerial on the ground, the street layers and the credits link (ground.js; it hooks scene.onBeforeRender itself)
installGround({ THREE, scene, camera, renderer, city, redraw: () => { dirty = true; }, phone: PHONE,
  lodHeight: () => Math.floor(innerHeight * DPR) });

function geometryOf(t, normals) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(t.pos, 3));
  if (normals) g.setAttribute('normal', new THREE.BufferAttribute(t.nrm, 3, true));
  g.setAttribute('color', new THREE.BufferAttribute(t.col, 3, true));
  if (t.fac) g.setAttribute('fac', new THREE.BufferAttribute(t.fac, 2));
  if (t.fac) g.setAttribute('hz', new THREE.BufferAttribute(new Uint8Array(t.pos.length / 3), 1, true));   // buildings: the haze fade
  g.setIndex(new THREE.BufferAttribute(t.idx, 1));
  g.computeBoundingSphere(); g.computeBoundingBox();
  return g;
}
function addRibbons(list, order, into) {
  const mat = flatMaterial();
  for (const t of list) {
    const m = new THREE.Mesh(geometryOf(t, false), mat);
    m.receiveShadow = true; m.renderOrder = order; m.name = 'ribbon ' + t.key;
    // a flat ribbon needs an up normal for lighting; one shared attribute value is enough
    const n = new Int8Array((t.pos.length / 3) * 3); for (let i = 1; i < n.length; i += 3) n[i] = 127;
    m.geometry.setAttribute('normal', new THREE.BufferAttribute(n, 3, true));
    cityGroup.add(m); into.push(m);
  }
}
const idKeys = (id) => { id = String(id); return id.length > 8 && /^[0-9a-f]{8}-/.test(id) ? [id, id.slice(0, 8)] : [id]; };

function addBuildings(list) {
  for (const t of list) {
    const m = new THREE.Mesh(geometryOf(t, true), buildingMaterial);
    m.castShadow = true; m.receiveShadow = true; m.name = 'buildings ' + t.key;
    const rec = { mesh: m, orig: t.pos.slice(0), ids: t.ids, starts: t.starts, counts: t.counts };
    t.ids.forEach((id, k) => { for (const key of idKeys(id)) { const l = city.byId.get(key) || []; l.push([rec, k]); city.byId.set(key, l); } });
    cityGroup.add(m); city.buildings.push(rec);
  }
  if (city.hidden.size) setHidden([...city.hidden], true, true);
}

// Hide (collapse) or show (restore) the extrusions with these map ids. The geometry stays one merged mesh per tile.
function setHidden(ids, hide, force = false) {
  const touched = new Set();
  for (const raw of ids) {
    const id = String(raw);
    if (!force && hide === city.hidden.has(id)) continue;
    if (hide) city.hidden.add(id); else city.hidden.delete(id);
    for (const [rec, k] of city.byId.get(id) || []) {
      const P = rec.mesh.geometry.attributes.position.array, s = rec.starts[k] * 3, n = rec.counts[k] * 3;
      if (hide) for (let i = 0; i < n; i++) P[s + i] = rec.orig[s + (i % 3)]; else P.set(rec.orig.subarray(s, s + n), s);
      const attr = rec.mesh.geometry.attributes.position;
      attr.addUpdateRange(s, n); attr.needsUpdate = true;
      touched.add(rec);
    }
  }
  if (touched.size) { dirty = true; sun.shadow.needsUpdate = true; }
  return touched.size;
}

// Fade the extrusions with these map ids k (0..1) of the way into the haze (tiles.js: a Blender tile arriving over them).
function fadeBuildings(ids, k) {
  const v = Math.round(THREE.MathUtils.clamp(k, 0, 1) * 255);
  for (const raw of ids) for (const [rec, j] of city.byId.get(String(raw)) || []) {
    const a = rec.mesh.geometry.attributes.hz; if (!a) continue;
    const s = rec.starts[j], n = rec.counts[j];
    if (a.array[s] === v) continue;
    a.array.fill(v, s, s + n); a.addUpdateRange(s, n); a.needsUpdate = true;
  }
  dirty = true;
}

function addTrees(data) {
  const n = data.length / 5;
  if (!n) return;
  const crownGeo = new THREE.IcosahedronGeometry(1, 1);
  crownGeo.deleteAttribute('normal'); crownGeo.deleteAttribute('uv');
  const crown = mergeToSmooth(crownGeo);
  const trunkGeo = new THREE.CylinderGeometry(0.75, 1, 1, 6, 1, true).translate(0, 0.5, 0);
  const crowns = new THREE.InstancedMesh(crown, new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 }), n);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: LOOK.TREE_TRUNK, roughness: 1 }), n);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3();
  const base = new THREE.Color(LOOK.TREE_CROWN), hsl = {}, c = new THREE.Color();
  base.getHSL(hsl);
  for (let i = 0; i < n; i++) {
    const x = data[i * 5], z = data[i * 5 + 1], r = data[i * 5 + 2], h = data[i * 5 + 3], v = data[i * 5 + 4];
    const ch = Math.max(r * 1.2, h * LOOK.TREE_CROWN_SHARE);
    M.compose(P.set(x, h - ch / 2, z), Q, S.set(r, ch / 2, r)); crowns.setMatrixAt(i, M);
    const tr = 0.12 + r * 0.025;
    M.compose(P.set(x, 0, z), Q, S.set(tr, Math.max(0.5, h - ch * 0.8), tr)); trunks.setMatrixAt(i, M);
    c.setHSL(hsl.h, hsl.s, THREE.MathUtils.clamp(hsl.l * (1 + (v - 0.5) * 2 * LOOK.TREE_CROWN_VARIATION), 0, 1)); crowns.setColorAt(i, c);
  }
  for (const m of [crowns, trunks]) { m.castShadow = true; m.receiveShadow = true; m.computeBoundingSphere(); cityGroup.add(m); }
  // the camera bumps into the trunks (flycam.js; v1 does the same below 12 m)
  const tr = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { const r = data[i * 5 + 2], h = data[i * 5 + 3], ch = Math.max(r * 1.2, h * LOOK.TREE_CROWN_SHARE); tr.set([data[i * 5], data[i * 5 + 1], 0.12 + r * 0.025, Math.max(0.5, h - ch * 0.8)], i * 4); }
  field.setTrunks(tr);
  city.trees = { crowns, trunks, n };
}
function mergeToSmooth(g) {
  // the icosahedron comes unindexed; weld it so its normals are smooth (a round crown, not facets that flicker)
  const p = g.attributes.position, map = new Map(), verts = [], idx = [];
  for (let i = 0; i < p.count; i++) {
    const k = p.getX(i).toFixed(4) + ',' + p.getY(i).toFixed(4) + ',' + p.getZ(i).toFixed(4);
    let j = map.get(k); if (j == null) { j = verts.length / 3; map.set(k, j); verts.push(p.getX(i), p.getY(i), p.getZ(i)); } idx.push(j);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); out.setIndex(idx); out.computeVertexNormals();
  return out;
}

// ── the city worker ────────────────────────────────────────────────────
const timings = { start: performance.now() };
const cityReady = new Promise((resolve) => {
  const w = new Worker(new URL('./city-worker.js', import.meta.url), { type: 'module' });
  w.onmessage = (ev) => {
    const m = ev.data;
    if (m.type === 'file') { try { window.loaderData?.(m.url, m.phase); } catch (e) {} return; }
    if (m.type === 'roads') { addRibbons(m.tiles, ORDER.ROADS, city.roads); timings.roads = performance.now() - timings.start; status('Roads in, raising buildings…'); }
    else if (m.type === 'sidewalks') { addRibbons(m.tiles, ORDER.SIDEWALKS, city.sidewalks); timings.sidewalks = performance.now() - timings.start; }
    else if (m.type === 'buildings') { addBuildings(m.tiles); timings.buildings = performance.now() - timings.start; status('Buildings in, planting trees…'); }
    else if (m.type === 'collide') { field.setFootprints(m.data); applyBlenderTops(); }
    else if (m.type === 'trees') { addTrees(m.data); timings.trees = performance.now() - timings.start; }
    else if (m.type === 'log') console.info('[v2 city]', m.msg);
    else if (m.type === 'error') console.error('[v2 city]', m.msg);
    else if (m.type === 'done') { city.stats = m.stats; timings.city = performance.now() - timings.start; resolve(m.stats); w.terminate(); }
    dirty = true;
  };
  w.onerror = (e) => { console.error('[v2 city] worker', e.message); resolve(null); };
  w.postMessage({ type: 'init', look: LOOK, origin: ORIGIN });
});

// ── Blender tiles ──────────────────────────────────────────────────────
const manifestUrl = new URL(params.get('tiles') === 'test' ? './test-tiles/manifest.json' : (params.get('manifest') || './tiles/manifest.json'), import.meta.url).href;
let tiles = null;
const tilesReady = (async () => {
  try {
    const t = new TileStreamer({ scene, camera, manifestUrl,
      onShow: (ids) => setHidden(ids, true), onHide: (ids) => setHidden(ids, false), onFade: fadeBuildings,
      prepare: (obj, def) => { if (field.ready) field.addTile(obj, def, t.manifest.buildings || {}); },
      onChange: () => { dirty = true; sun.shadow.needsUpdate = true; }, onAnimate: () => { dirty = true; } });
    if (params.get('fade') === '0') t.instant = true;
    const man = await t.load();
    if (man.origin && (Math.abs(man.origin.lat - ORIGIN.lat) > 1e-9 || Math.abs(man.origin.lon - ORIGIN.lon) > 1e-9)) {
      console.warn('[v2 tiles] manifest origin differs from v2/geo.js; using the manifest origin is not supported after the city is built', man.origin);
    }
    tiles = t;
    applyBlenderTops();
    return t.manifest;
  } catch (e) {
    console.info('[v2 tiles] no Blender tile manifest at', manifestUrl, '-', e.message);
    return null;
  }
})();

// the camera bumps into the trunks of v2's trees (trees.js draws them: one instanced mesh, each matrix = position, radius, height)
const trunkWait = setInterval(() => {
  const T = window.__v2trees; if (!T) return;
  const st = T.stats(); if (st.error) { clearInterval(trunkWait); return; } if (!st.ready) return;
  clearInterval(trunkWait);
  const m = T.group.children.find((o) => o.name === 'trunks'); if (!m) return;
  const e = m.instanceMatrix.array, n = m.count, out = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { const o = i * 16; out.set([e[o + 12], e[o + 14], e[o], e[o + 5]], i * 4); }
  field.setTrunks(out);
}, 500);

// the camera bumps into a Blender model's own top where it replaces plain buildings (once both the footprints and the manifest are in)
let topsDone = false;
function applyBlenderTops() {
  if (topsDone || !field.ready || !tiles?.manifest) return;
  topsDone = true;
  for (const b of Object.values(tiles.manifest.buildings || {})) if (b.map_ids) field.setTop(b.map_ids, b.top);
  // Tiles may arrive before the worker's footprints. Cover those too, once the field is ready.
  for (const s of tiles.tiles.values()) if (s.obj) field.addTile(s.obj, s.def, tiles.manifest.buildings || {});
}

// ── walking route ──────────────────────────────────────────────────────
const routeWorker = new Worker(new URL('./route-worker.js', import.meta.url), { type: 'module' });
const routeGroup = new THREE.Group(); routeGroup.name = 'route';
scene.add(routeGroup);
let routeSeq = 0;
const pending = new Map();
let catalog = null;
const routeReady = new Promise((resolve) => {
  routeWorker.onmessage = (ev) => {
    const m = ev.data;
    if (m.type === 'ready') { catalog = m; resolve(m); }
    else if (m.type === 'route') { const p = pending.get(m.id); pending.delete(m.id); p && p(m); }
  };
});
routeWorker.postMessage({ type: 'init', origin: ORIGIN });
try { window.loaderGraph?.('start'); } catch (e) {}
routeReady.then(() => { try { window.loaderGraph?.('done'); } catch (e) {} });
const requestRoute = (from, to) => new Promise((res) => { const id = ++routeSeq; pending.set(id, res); routeWorker.postMessage({ type: 'route', id, from, to }); });

function ribbonGeometry(path, width) {
  const n = path.length / 2, pos = new Float32Array(n * 6), idx = [];
  for (let i = 0; i < n; i++) {
    const x = path[i * 2], z = path[i * 2 + 1];
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    let dx = path[b * 2] - path[a * 2], dz = path[b * 2 + 1] - path[a * 2 + 1];
    const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    pos.set([x - dz * width / 2, LOOK.ROUTE_LIFT_M, z + dx * width / 2, x + dz * width / 2, LOOK.ROUTE_LIFT_M, z - dx * width / 2], i * 6);
    if (i < n - 1) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx);
  return g;
}
function pin(x, z, color) {
  const g = new THREE.Group();
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 30, 8).translate(0, 15, 0), new THREE.MeshBasicMaterial({ color }));
  const head = new THREE.Mesh(new THREE.SphereGeometry(4, 16, 10).translate(0, 32, 0), new THREE.MeshBasicMaterial({ color }));
  g.add(stick, head); g.position.set(x, 0, z);
  return g;
}
function drawRoute(r) {
  for (const o of [...routeGroup.children]) { routeGroup.remove(o); o.traverse((c) => { c.geometry && c.geometry.dispose(); c.material && c.material.dispose(); }); }
  if (!r || !r.ok) return;
  const m = new THREE.Mesh(ribbonGeometry(r.path, LOOK.ROUTE_WIDTH_M),
    new THREE.MeshBasicMaterial({ color: LOOK.ROUTE, depthWrite: false, side: THREE.DoubleSide }));
  m.renderOrder = ORDER.ROUTE; m.frustumCulled = false;
  routeGroup.add(m);
  const P = r.path;
  routeGroup.add(pin(P[0], P[1], LOOK.DOOR_START), pin(P[P.length - 2], P[P.length - 1], LOOK.DOOR_END));
  dirty = true;
}

// ── camera flights ─────────────────────────────────────────────────────
let flight = null;
function flyTo(target, distance) {
  const from = { t: controls.target.clone(), off: camera.position.clone().sub(controls.target) };
  const dir = from.off.clone().normalize();
  const to = { t: new THREE.Vector3(target[0], 0, target[1]), off: dir.multiplyScalar(THREE.MathUtils.clamp(distance, VIEW.MIN_DISTANCE_M * 4, VIEW.MAX_DISTANCE_M)) };
  flight = { from, to, t0: performance.now() };
}
function stepFlight(now) {
  if (!flight) return false;
  const k = Math.min(1, (now - flight.t0) / VIEW.FLY_MS), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
  controls.target.lerpVectors(flight.from.t, flight.to.t, e);
  camera.position.copy(controls.target).add(flight.from.off.clone().lerp(flight.to.off, e));
  if (k >= 1) flight = null;
  return true;
}
controls.addEventListener('start', () => { flight = null; map.stop(); body.classList.add('moving'); clearTimeout(movingTimer); });
controls.addEventListener('end', () => { clearTimeout(movingTimer); movingTimer = setTimeout(() => body.classList.remove('moving'), 4000); });
const body = document.body;
let movingTimer = 0;

// ── UI ─────────────────────────────────────────────────────────────────
const aptSel = $('apt'), clsSel = $('cls'), resultEl = $('result');
const store = { get(k) { try { return localStorage.getItem('v2.' + k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem('v2.' + k, v); } catch (e) {} } };
$('fold').addEventListener('click', () => { const p = $('panel'); const f = p.classList.toggle('folded'); $('fold').setAttribute('aria-expanded', String(!f)); $('fold').innerHTML = f ? '+' : '&#8211;'; });

let apartments = [], buildings = [], homesList = [];
if (params.get('panel') === '1') $('panel').hidden = false;   // v2's first walk planner (the finder replaces it)
async function setupUI() {
  const cat = await routeReady;
  // apartments: the finder's home catalog (data/finder/homes.json: the 3D apartment models, the walking graph's homes and the East
  // Riverside complexes, de-duplicated). A home the graph has doors for routes from its doors; the rest from its point.
  const byName = new Map();
  try {
    const hu = new URL('../data/finder/homes.json', location.href).href;
    try { window.loaderData?.(hu, 'start'); } catch (e) {}
    const h = await (await fetch(hu)).json();
    homesList = h.homes || [];
    try { window.loaderData?.(hu, 'done'); } catch (e) {}
    const wc = new Map(cat.apartments.map((a) => [a.name, a.doors]));
    for (const home of h.homes || []) {
      const doors = home.wc && wc.get(home.wc);
      byName.set(home.name.toLowerCase(), doors ? { name: home.name, doors } : { name: home.name, point: toLocal(home.p[0], home.p[1]) });
    }
  } catch (e) { console.warn('[v2] homes.json', e.message); }
  for (const a of cat.apartments) if (!byName.has(a.name.toLowerCase())) byName.set(a.name.toLowerCase(), { name: a.name, doors: a.doors });
  apartments = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  buildings = cat.buildings.filter((b) => b.doors.length);
  aptSel.innerHTML = '<option value="">Choose an apartment</option>' + apartments.map((a, i) => `<option value="${i}">${esc(a.name)}</option>`).join('');
  clsSel.innerHTML = '<option value="">Choose a class building</option>' + buildings.map((b, i) => `<option value="${i}">${esc(b.name)} (${esc(b.code)})</option>`).join('');
  const sa = store.get('apt'), sc = store.get('cls');
  const ai = apartments.findIndex((a) => a.name === sa), ci = buildings.findIndex((b) => b.code === sc);
  if (ai >= 0) aptSel.value = String(ai);
  if (ci >= 0) clsSel.value = String(ci);
  aptSel.addEventListener('change', () => { const a = apartments[+aptSel.value]; if (a) store.set('apt', a.name); update(true); });
  clsSel.addEventListener('change', () => { const b = buildings[+clsSel.value]; if (b) store.set('cls', b.code); update(true); });
  if (ai >= 0 || ci >= 0) update(false);
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const endOf = (a) => (a.doors ? { doors: a.doors } : { x: a.point[0], z: a.point[1] });
const doorXZ = (a) => (a.doors ? catalog.doors[a.doors[0]] : a.point);

async function update(fly) {
  const a = apartments[+aptSel.value], b = aptSel.value === '' ? null : apartments[+aptSel.value];
  const c = clsSel.value === '' ? null : buildings[+clsSel.value];
  if (!b && !c) { drawRoute(null); resultEl.textContent = ''; return; }
  if (!b || !c) {
    drawRoute(null);
    const one = b || c, p = doorXZ(one);
    resultEl.innerHTML = `<span class="muted">${b ? 'Now pick a class building.' : 'Now pick an apartment.'}</span>`;
    if (fly && p) flyTo(p, 500);
    return;
  }
  resultEl.innerHTML = '<span class="muted">Finding the walk…</span>';
  const r = await requestRoute(endOf(a), endOf(c));
  drawRoute(r);
  if (!r.ok) { resultEl.innerHTML = `<span class="muted">No walk found: ${esc(r.reason)}.</span>`; return; }
  resultEl.innerHTML = `<span class="mins">${r.minutes} min</span> walk <span class="muted">· ${Math.round(r.metres)} m at 1.4 m/s</span>`;
  if (fly) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < r.path.length; i += 2) { x0 = Math.min(x0, r.path[i]); x1 = Math.max(x1, r.path[i]); z0 = Math.min(z0, r.path[i + 1]); z1 = Math.max(z1, r.path[i + 1]); }
    const span = Math.max(x1 - x0, z1 - z0, 150);
    flyTo([(x0 + x1) / 2, (z0 + z1) / 2 + (PHONE ? span * 0.5 : 0)], span * (PHONE ? 2.6 : 1.7));   // phone: the panel covers the lower third
  }
}
const setupDone = setupUI();

// ── frame loop (renders only when something moved) ────────────────────
let dirty = true, frames = 0;
const frameLog = { on: false, dts: [], cpu: [], scales: [], last: 0 };
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setDrawingBufferSize(w, h, DPR * adapt.scale);   // = setPixelRatio + setSize(w, h, false), with one canvas resize
  camera.aspect = w / h; camera.updateProjectionMatrix();
  dirty = true;
}

// ── adaptive resolution, in motion only (QUALITY.ADAPT) ────────────────
// While the camera moves, the rAF interval of frames drawn back to back is measured. When its median over A.WINDOW frames is slower
// than the target, the canvas steps down to fewer pixels; when it is well inside the target it steps back up. The moment the camera
// has been still for A.STILL_MS the canvas is back at the full pixel ratio and the still is drawn at full sharpness. The scale it
// settled on is kept for the next motion, so a weak GPU starts the next move already at its scale. On a GPU that holds the target the
// first decision is "stay", and the canvas never changes.
const A = QUALITY.ADAPT;
const adapt = {
  on: A.ON && params.get('adapt') !== '0',
  budgetMs: 1000 / (+params.get('adaptfps') || A.TARGET_FPS),
  floor: Math.min(1, Math.max(A.MIN_SCALE, A.MIN_PIXEL_RATIO / DPR)),
  scale: 1,            // the canvas's scale now
  motionScale: 1,      // the scale motion runs at (learned)
  samples: [], lastDraw: 0, lastMove: 0, changes: 0, movingDraw: false,
};
function setScale(s) {
  s = THREE.MathUtils.clamp(s, adapt.floor, 1);
  if (Math.abs(s - adapt.scale) < 1e-3) return;
  adapt.scale = s; adapt.samples = []; adapt.changes++;
  resize();
}
// at the top of every rAF: `moved` = the camera moves in this frame
function adaptFrame(now, moved) {
  const prevMovingDraw = adapt.movingDraw;
  adapt.movingDraw = false;
  if (!adapt.on || adapt.floor >= 1) return;
  if (moved) {
    adapt.lastMove = now;
    if (adapt.scale !== adapt.motionScale) { setScale(adapt.motionScale); return; }
  } else {
    if (adapt.scale < 1 && now - adapt.lastMove > A.STILL_MS) setScale(1);
    return;
  }
  // the interval since the last drawn frame, when that frame was drawn in motion at this scale (it is that frame's cost)
  if (!prevMovingDraw || now - adapt.lastDraw > 1000) return;
  adapt.samples.push(now - adapt.lastDraw);
  if (adapt.samples.length < A.WINDOW) return;
  const s = [...adapt.samples].sort((x, y) => x - y), med = s[s.length >> 1];
  adapt.samples = [];
  if (med > adapt.budgetMs * A.DOWN_AT && adapt.scale > adapt.floor) adapt.motionScale = Math.max(adapt.floor, adapt.scale * A.STEP);
  else if (med < adapt.budgetMs * A.UP_AT && adapt.scale < 1) adapt.motionScale = Math.min(1, adapt.scale / A.STEP);
  else return;
  setScale(adapt.motionScale);
}
addEventListener('resize', resize);
resize();

function frame(now) {
  requestAnimationFrame(frame);
  const flying = stepFlight(now);
  const easing = map.step(now);
  const turned = controls.update();
  const moved = turned || flying || easing;
  const moving = moved || (frameLog.on && frameLog.orbit);   // the verify scripts' timed orbit is camera motion too
  adaptFrame(now, moving);
  if (moved) { markers.update(); if (!easing) map.fire('move'); }
  if (frameLog.on && frameLog.orbit) { orbitStep(); }
  if (tiles) tiles.update(now);
  if (moved || mapLayers.dirty) { mapLayers.dirty = false; mapLayers.update(); }
  labels.update(now);
  if (!(moved || dirty || frameLog.on)) return;
  dirty = false;
  followShadow();
  dome.position.copy(camera.position);
  const t0 = performance.now();
  renderer.render(scene, camera);
  adapt.lastDraw = now; adapt.movingDraw = moving;
  if (!frames) { try { window.loaderSceneReady?.(); } catch (e) {} }
  if (frameLog.on) { frameLog.cpu.push(performance.now() - t0); frameLog.scales.push(adapt.scale); if (frameLog.last) frameLog.dts.push(now - frameLog.last); frameLog.last = now; }
  frames++;
}
requestAnimationFrame(frame);

function orbitStep() {
  // a slow orbit around the target: the motion the frame-time number is taken in
  const off = camera.position.clone().sub(controls.target);
  off.applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(frameLog.degPerFrame));
  camera.position.copy(controls.target).add(off); camera.lookAt(controls.target);
}

// ── the loading screen (js/loader.js, the old app's, unchanged) and the opening flight ──────────────────────
// The loading card reads "the map" through these few names (loader.js readings()): the streets and plain city are in, the
// Blender buildings in view are standing (counted per building), the light is drawn. Every number is v2's own, measured.
const inViewTiles = () => tiles ? [...tiles.tiles.values()].filter((s) => s.want && s.inView) : [];
const tilesSettled = () => !!tiles && !!tiles.last && inViewTiles().every((s) => s.have);
let cityDone = false;
cityReady.then(() => { cityDone = true; });
map.tilesLoaded = () => cityDone && tilesSettled();
window.slopesApartments = {
  data: { get buildings() { return { length: inViewTiles().reduce((n, s) => n + (s.def.buildings || []).length, 0) }; } },
  count: { get names() { return { length: inViewTiles().reduce((n, s) => n + (s.have ? (s.def.buildings || []).length : 0), 0) }; } },
  readyToReveal: () => true,
};
window.CityLighting = { get stats() { return { draws: frames > 0 ? 1 : 0, failures: [] }; } };

const introFlight = window.__intro = { flight: null };
function primeIntro() {
  const F = introFlight.flight = { state: 'primed', leg: 0, cancelledBy: null };
  map.jumpTo(INTRO.start);
  const cancel = (why) => { if (F.state === 'done' || F.state === 'cancelled') return; F.state = 'cancelled'; F.cancelledBy = why; map.stop(); };
  controls.addEventListener('start', () => cancel('input'));
  const leg = (n) => {
    F.leg = n;
    if (n === 1) map.easeTo({ ...INTRO.crest, duration: INTRO.leg1Ms, essential: true, easing: (t) => 0.5 - 0.5 * Math.cos(Math.PI * t) }, { introLeg: 1 });
    else map.easeTo({ ...INTRO.end, duration: INTRO.leg2Ms, essential: true, easing: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2) }, { introLeg: 2 });
  };
  map.on('moveend', (e) => {
    if (F.state !== 'flying' || e.introLeg !== F.leg) return;
    const p = map.pose(), want = F.leg === 1 ? INTRO.crest : INTRO.end;
    if (Math.abs(p.zoom - want.zoom) > 1e-3) { F.state = 'cancelled'; F.cancelledBy = 'camera moved'; return; }
    if (F.leg === 1) leg(2); else F.state = 'done';
  });
  return { fly: () => { if (F.state === 'primed') { F.state = 'flying'; leg(1); } }, cancel };
}
let intro = null;
function liftVeil(reason) {
  const veil = $('veil');
  if (!veil || veil.classList.contains('lift')) return;
  try { window.loaderDone?.({ reason }); } catch (e) {}
  timings.reveal = performance.now() - timings.start; timings.revealReason = reason;
  veil.classList.add('lift');
  setTimeout(() => veil.remove(), INTRO.liftMs + 200);
  if (intro) intro.fly();
}
function skipIntro() {
  if (intro) intro.cancel('skipped');
  const veil = $('veil'); if (veil) veil.remove();
}
if (INTRO.on) {
  intro = primeIntro();
  const t0 = performance.now();
  const gate = setInterval(() => {
    const ms = performance.now() - t0;
    if (!$('veil')) { clearInterval(gate); return; }
    if ((map.tilesLoaded() && frames > 0 && ms >= INTRO.minVeilMs) || ms >= INTRO.maxVeilMs) { clearInterval(gate); liftVeil(ms >= INTRO.maxVeilMs ? 'ceiling' : 'ready'); }
  }, 200);
} else skipIntro();

Promise.all([cityReady, tilesReady, routeReady]).then(([stats, man]) => {
  timings.ready = performance.now() - timings.start;
  const n = man ? (man.tiles || []).length : 0;
  status(n ? `Ready · ${n} Blender tile${n > 1 ? 's' : ''}` : 'Ready', true);
  dirty = true;
});

// ── names over the city, picking a building, its card ─────────────────────────────────────────────
const labels = new Labels({ camera, canvas, container: $('markers'), scene, phone: PHONE,
  pickRoots: () => [cityGroup, ...(tiles ? [tiles.group] : [])], onCard: showCard });
Promise.all([tilesReady, routeReady, setupDone]).then(([man, cat]) => {
  labels.add(blenderItems(man));
  labels.add(homeItems(homesList, man));
  labels.add(campusItems(cat.buildings, cat.doors));
});
const cardEl = $('card');
function showCard(it) {
  if (!it) { cardEl.hidden = true; return; }
  const kind = it.home ? 'Apartment' : it.kind === 'campus' || it.code ? 'UT building' : 'Building';
  const facts = [];
  if (it.code) facts.push(it.code);
  if (it.home?.addr) facts.push(it.home.addr);
  if (it.top > 3) facts.push(Math.round(it.top) + ' m tall');
  cardEl.innerHTML = `<p class="k">${kind}</p><h2>${esc(it.name)}</h2>${facts.length ? `<p>${facts.map(esc).join(' · ')}</p>` : ''}` +
    `<button class="x" type="button" aria-label="Close">×</button><div class="acts">` +
    (it.home ? `<button class="go" type="button" data-a="walks">Walks to class</button>` : '') +
    `<button type="button" data-a="fly">Fly closer</button></div>`;
  cardEl.hidden = false;
  cardEl.querySelector('.x').onclick = () => labels.close();
  cardEl.querySelector('[data-a="fly"]').onclick = () => {
    const [lng, lat] = toLonLat(it.x, it.z);
    map.easeTo({ center: [lng, lat], zoom: 17.4, pitch: 62, duration: 1400, essential: true });
  };
  const w = cardEl.querySelector('[data-a="walks"]');
  if (w) w.onclick = () => { labels.close(); window.finderOpen?.(); setTimeout(() => window.finderSelect?.(it.home.id), 50); };
}
// a click (not a drag) on the city picks the building under it
let downAt = null;
canvas.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY, t: performance.now() }; });
canvas.addEventListener('pointerup', (e) => {
  if (!downAt) return;
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y), ms = performance.now() - downAt.t; downAt = null;
  if (moved < 6 && ms < 500) labels.pick(e.clientX, e.clientY);
});
addEventListener('keydown', (e) => { if (e.key === 'Escape' && !cardEl.hidden) labels.close(); });

// the old app's apartment finder (js/finder.js, unchanged), on maplite.js
import('./finder-boot.js').catch((e) => console.warn('[v2] finder', e.message));

// ── hooks for the verify scripts (read-only, plus a timed orbit) ──────
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : null; };
window.__v2 = {
  THREE, scene, camera, controls, renderer, city, LOOK, VIEW, TILES, FLY, fly: () => controls.state(),
  ready: Promise.all([cityReady, tilesReady, routeReady]),
  tiles: () => tiles && tiles.summary(),
  timings: () => ({ ...timings }),
  setHidden, placeCamera: (p) => { skipIntro(); placeCamera(p); }, flyTo, map, INTRO, skipIntro,
  intro: () => introFlight.flight && { ...introFlight.flight },
  labels: () => ({ items: labels.items.length, shown: labels.shown, selected: labels.selected?.name || null }),
  pick: (x, y) => labels.pick(x, y), openCard: (name) => { const it = labels.items.find((i) => i.name === name); if (it) labels.open(it); return !!it; }, requestRoute, drawRoute, redraw: () => { dirty = true; },
  pickApartment: (name) => { const i = apartments.findIndex((a) => a.name === name); if (i >= 0) { aptSel.value = String(i); return update(true); } },
  pickBuilding: (code) => { const i = buildings.findIndex((b) => b.code === code); if (i >= 0) { clsSel.value = String(i); return update(true); } },
  info: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures,
    dpr: renderer.getPixelRatio(), size: [renderer.domElement.width, renderer.domElement.height], reversedDepth: renderer.capabilities.reversedDepthBuffer, frames,
    shadow: { cache: SHADOW_CACHE, ...shadowStats }, adapt: { on: adapt.on, floor: adapt.floor, scale: adapt.scale, motionScale: adapt.motionScale, changes: adapt.changes } }),
  async measure(ms = 4000, degPerFrame = 0.15) {
    Object.assign(frameLog, { on: true, orbit: degPerFrame > 0, degPerFrame, dts: [], cpu: [], scales: [], last: 0 });
    await new Promise((r) => setTimeout(r, ms));
    frameLog.on = false;
    return { frames: frameLog.dts.length, medianFrameMs: median(frameLog.dts), p95FrameMs: pct(frameLog.dts, 0.95), medianRenderCallMs: median(frameLog.cpu), medianScale: median(frameLog.scales), ...this.info() };
  },
};
