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
import { TileStreamer, TILES, setAOPixelScale } from './tiles.js';
import { COVER, objectArrays, outlinesNear } from './covers.js';
import { MapLite, MarkerLayer, MercatorCoordinate } from './maplite.js';
import { MapLayers } from './map-layers.js';
import { Labels, blenderItems, homeItems, campusItems } from './labels.js';
import { installGround } from './ground.js';
import { exactPrepare, exactProbe, exactState } from './exact-pilot.js';
import { austinToUtc, sunPosition, buildMoment, momentSky, cloudGLSL, nightGLSL, SKY_TABLE, sunTransmittance } from './sky.js';
import { loadRealSky, placeRealSky, realAt, realSkyGLSL, realSkyUniforms, setAnisotropy } from './sky-real.js';

const params = new URLSearchParams(location.search);
// exact-photo pilot: put the sun where it stood in a photograph (?sunaz=242.4&sunel=20.2); absent = the app's own sun
if (params.get('sunaz')) LOOK.SUN_AZIMUTH_DEG = +params.get('sunaz');
if (params.get('sunel')) LOOK.SUN_ELEVATION_DEG = +params.get('sunel');

// The sky of a moment (sky.js): ?moment=2026-10-24T17:07 (Austin's clock) or ?moment=IMG_1778 (v2/data/moments.json), with optional
// &haze= &cover= &exposure= &sun= overrides. Without ?moment nothing below runs and the light is Light B as before.
let MOMENT = null;
if (params.get('moment')) {
  try {
    const m = params.get('moment');
    let spec;
    if (/^\d{4}-\d\d-\d\d/.test(m)) spec = { time: m };
    else {
      const all = await (await fetch(new URL('./data/moments.json', import.meta.url))).json();
      if (!all.moments[m]) throw new Error('no moment named ' + m);
      spec = { name: m, ...all.moments[m] };
    }
    for (const k of ['haze', 'cover', 'exposure', 'sun', 'ms', 'sat']) if (params.get(k)) spec[k] = +params.get(k);
    if (params.get('wb')) { const [r, b] = params.get('wb').split(',').map(Number); spec.wb = [r, 1, b]; }   // ?wb=1.1,0.9: the camera's white balance
    spec.utcMs = austinToUtc(spec.time);
    if (!Number.isFinite(spec.utcMs)) throw new Error('cannot read the time ' + spec.time);
    const p = sunPosition(spec.utcMs, ORIGIN.lat, ORIGIN.lon);
    spec.az = params.get('sunaz') ? LOOK.SUN_AZIMUTH_DEG : p.az;
    spec.el = params.get('sunel') ? LOOK.SUN_ELEVATION_DEG : p.el;
    // the light's direction (shadows) never goes below LOOK.MOMENT.MIN_LIGHT_EL: after sunset the sun's strength is 0 anyway (sky.js)
    LOOK.SUN_AZIMUTH_DEG = spec.az; LOOK.SUN_ELEVATION_DEG = Math.max(spec.el, LOOK.MOMENT.MIN_LIGHT_EL);
    MOMENT = spec;
  } catch (e) { console.warn('[v2 moment]', e.message); }
}
// A real captured sky (sky-real.js): ?sky=NAME (v2/data/sky/skies.json), or the sky a moment preset names ("sky", and "photo" for
// the owner's photo's own sky). ?sky=NAME without a moment: Light B's sun azimuth, the HDRI's own sun elevation (so the light
// agrees with the sky it shows). ?sky=param: the parametric sky of #551 for a moment preset that names a real one.
let REAL_SKY = null;
{
  const want = params.get('sky') || (MOMENT && MOMENT.sky) || null;
  if (want && want !== 'param') {
    try {
      const photo = MOMENT && MOMENT.photo && !params.get('sky') ? MOMENT.photo : (params.get('skyphoto') || null);
      REAL_SKY = await loadRealSky(want, photo, null);
      if (!MOMENT) {
        const s = REAL_SKY.S.sun || REAL_SKY.S.glow;
        MOMENT = { name: 'sky:' + want, az: LOOK.SUN_AZIMUTH_DEG, el: s ? (s.sun_el_deg ?? s.el_deg) : LOOK.SUN_ELEVATION_DEG };
        for (const k of ['haze', 'exposure', 'sun', 'ms', 'sat']) if (params.get(k)) MOMENT[k] = +params.get(k);
        LOOK.SUN_ELEVATION_DEG = Math.max(MOMENT.el, LOOK.MOMENT.MIN_LIGHT_EL);
      }
    } catch (e) { console.warn('[v2 sky-real]', e.message); REAL_SKY = null; }
  }
}
// PR #550's cause 4, with a moment (or ?groundshade=1): the ground's bounce assumed sunlit ground everywhere, so a face looking at ground
// in a building's own shadow (a tower's east side at 17:07, its shadow ~560 m long) got the sun's share of the bounce anyway. Shadow-map
// taps at the ground points the face looks at (one halfway between its normal and straight down, LOOK.MOMENT.GROUND_TAPS - 1 more on a
// ring around it: a face 150 m up sees a wide patch of ground) take the sun's share out where that ground is in shadow:
// irradiance -= (shadowed share) x ground albedo x the sun's irradiance on the ground x the ground's share of the face's view ((1 - n.y) / 2).
const GROUND_SHADE = (MOMENT && LOOK.MOMENT.GROUND_SHADE && params.get('groundshade') !== '0') || params.get('groundshade') === '1';
if (GROUND_SHADE) {
  THREE.ShaderChunk.shadowmap_pars_fragment += `
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0 && defined( SHADOWMAP_TYPE_PCF )
uniform mat4 directionalShadowMatrix[ NUM_DIR_LIGHT_SHADOWS ];
#define V2_GROUND_SHADE 1
#endif`;
  THREE.ShaderChunk.lights_fragment_maps = `
#if defined( V2_GROUND_SHADE ) && defined( RE_IndirectDiffuse ) && NUM_DIR_LIGHTS > 0
{
  vec3 v2n = inverseTransformDirection( geometryNormal, viewMatrix );
  vec3 v2p = cameraPosition + ( vec4( geometryPosition, 0.0 ) * viewMatrix ).xyz;
  float v2w = 0.5 * ( 1.0 - v2n.y );
  if ( v2w > 0.02 && v2p.y > 0.2 ) {
    vec3 v2d = normalize( v2n - vec3( 0.0, 1.0, 0.0 ) );
    vec3 v2t1 = normalize( cross( v2d, abs( v2d.y ) > 0.9 ? vec3( 1.0, 0.0, 0.0 ) : vec3( 0.0, 1.0, 0.0 ) ) ), v2t2 = cross( v2d, v2t1 );
    float v2dark = 0.0, v2n0 = 0.0;
    for ( int v2i = 0; v2i < ${LOOK.MOMENT.GROUND_TAPS}; v2i ++ ) {
      // the first tap looks along v2d; the others on a ring GROUND_SPREAD around it (the ground a high face sees is wide)
      float v2a = float( v2i - 1 ) * 1.5707963;
      vec3 v2r = v2i == 0 ? v2d : normalize( v2d + ${(+LOOK.MOMENT.GROUND_SPREAD).toFixed(3)} * ( cos( v2a ) * v2t1 + sin( v2a ) * v2t2 ) );
      if ( v2r.y > -0.05 ) continue;
      vec3 v2g = v2p + v2r * min( v2p.y / -v2r.y, ${(+LOOK.MOMENT.GROUND_MAX_M || 600).toFixed(1)} );
      v2g.y = 0.0;
      vec4 v2s = directionalShadowMatrix[ 0 ] * vec4( v2g, 1.0 );
      v2s.xyz /= v2s.w;
      float v2lit = 1.0;
      if ( v2s.x >= 0.0 && v2s.x <= 1.0 && v2s.y >= 0.0 && v2s.y <= 1.0 && v2s.z <= 1.0 )
        v2lit = texture( directionalShadowMap[ 0 ], vec3( v2s.xy, v2s.z + directionalLightShadows[ 0 ].shadowBias ) );
      v2dark += 1.0 - v2lit; v2n0 += 1.0;
    }
    v2dark /= max( v2n0, 1.0 );
    vec3 v2up = ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz;
    vec3 v2sunG = directionalLights[ 0 ].color * max( dot( directionalLights[ 0 ].direction, v2up ), 0.0 );
    irradiance = max( irradiance - v2dark * ${(+LOOK.MOMENT.GROUND_ALBEDO).toFixed(4)} * v2sunG * v2w, vec3( 0.0 ) );
  }
}
#endif
` + THREE.ShaderChunk.lights_fragment_maps;
}

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
  color *= toneMappingExposure;${MOMENT && (MOMENT.sat ?? 1) !== 1 ? `
  color = max(mix(vec3(dot(color, vec3(0.2126, 0.7152, 0.0722))), color, ${(+MOMENT.sat).toFixed(4)}), 0.0);   // the photo camera's saturation (moment)` : ''}
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
// The point the shadow box follows (LOOK.SHADOW_AIM). The flycam's focus is a GROUND point at most FOCUS_PITCH_DEG's lead ahead: at a
// person's eye height that is ~10 m in front of the feet, so the box (90 m at that distance) never reached a tower 200 m away, and the
// tower drew with no sun shadow at all: lit loggias, lit undersides of its overhangs (measured at the owner's photo IMG_1778's
// camera, 2026-10-25: balcony recesses 127 grey in the app, 51 in Blender under the same light). With the aim, the box follows the
// first building (the collision field: plain extrusions and Blender tops) or ground that the middle of the view meets, and is sized by
// its distance, ONLY when that is farther than the flycam's focus: a view that looks down at the ground (every aerial) keeps its box
// exactly as before; a view that looks out over the city gets a box that reaches what it looks at. The box still moves only in whole
// texels and changes size only in whole rungs, with hysteresis (rule 15).
const shadowAim = { p: new THREE.Vector3(), dir: new THREE.Vector3(), q: new THREE.Vector3(), key: '', hit: false, ms: 0 };
function shadowFocus() {
  const A = LOOK.SHADOW_AIM;
  if (!A.ON || !field.ready) return controls.focus;
  const e = camera.matrixWorld.elements, key = e[12] + ',' + e[13] + ',' + e[14] + ',' + e[8] + ',' + e[9] + ',' + e[10];
  const pick = () => (shadowAim.hit && camera.position.distanceTo(shadowAim.p) > camera.position.distanceTo(controls.focus) ? shadowAim.p : controls.focus);
  if (key === shadowAim.key) return pick();
  const t0 = performance.now();
  shadowAim.key = key;
  const o = camera.position, d = camera.getWorldDirection(shadowAim.dir), q = shadowAim.q;
  // only a hit FARTHER than the focus is used, and every building stands on the ground: a ray that reaches the ground no farther than
  // the focus (every view looking down: all the aerials) needs no march at all; above the tallest top the march starts at that height
  const toGround = o.y > 0 && d.y < 0 ? o.y / -d.y : Infinity;
  let t = A.START_M, hit = false;
  if (toGround <= o.distanceTo(controls.focus) || (o.y > A.TOP_M && d.y >= 0)) t = Infinity;
  else if (o.y > A.TOP_M) t = Math.max(t, (o.y - A.TOP_M) / -d.y);
  while (t < A.MAX_M) {
    q.copy(o).addScaledVector(d, t);
    if (o.y > 0 && q.y <= 0) { q.copy(o).addScaledVector(d, o.y / Math.max(1e-6, -d.y)); hit = true; break; }
    const h = field.heightIn(q.x, q.z, 0);
    if (h > 0 && q.y < h) { hit = true; break; }
    t += Math.max(A.STEP_M, t * A.STEP_GROW);
  }
  shadowAim.hit = hit;
  if (hit) shadowAim.p.copy(q);
  shadowAim.ms = performance.now() - t0;
  return pick();
}
function fitShadow() {
  const want = LOOK.SHADOW_FIT * camera.position.distanceTo(shadowFocus());
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

// ── the sky of a moment (sky.js; only with ?moment) ─────────────────────
// It replaces, in the same units and the same roles: the visible dome (+ clouds + the sun's halo), the fog (the sky at the horizon),
// the mirror environment (x LIGHT_B.mirror), the diffuse light probe ((the lighting sky x SKY_GAIN x LIGHT_B.sky + the bounce) - the
// mirror sky), the ground's bounce (the moment's sun on the ground + its sky, x LIGHT_B.ground) and the sun's colour and strength.
let momentNow = null, momentTex = null;
function momentMaterial(M, scale, below, glow) {
  const C = M.C, N = M.night, sMax = Math.max(...M.sunRGB, 1e-9);
  return new THREE.ShaderMaterial({
    name: 'v2-moment-sky',
    uniforms: {
      tab: { value: momentTex }, scale: { value: new THREE.Vector3(...scale) }, below: { value: new THREE.Vector3(...(below || [0, 0, 0])) },
      sunDir: { value: new THREE.Vector3(...M.sunDir) }, sunXZ: { value: new THREE.Vector2(...M.sunXZ) }, glow: { value: glow },
      sunColor: { value: new THREE.Vector3(...M.sunRGB.map((v) => (sMax > 1e-6 ? v / sMax : 0))) },
      cA: { value: new THREE.Vector4(C.ALT_M / C.SIZE_M, C.T, C.SOFT, C.MIN_SIN) },
      cB: { value: new THREE.Vector4(C.OFFSET[0] / C.SIZE_M, C.OFFSET[1] / C.SIZE_M, C.OCTAVES, 0) }, cH: { value: new THREE.Vector2(...C.HORIZON) },
      cSun: { value: new THREE.Vector3(...M.sunCloud) }, cK: { value: new THREE.Vector4(C.SUN, C.SILVER, C.G, C.AMBIENT) },
      cK2: { value: new THREE.Vector2(C.BASE_DARK, C.OPACITY) }, skyMean: { value: new THREE.Vector3(...M.skyMean) },
      nightK: { value: M.nightK }, nZen: { value: new THREE.Vector3(...N.ZENITH) }, nGlow: { value: new THREE.Vector3(...N.GLOW) }, nGS: { value: N.GLOW_SINE },
    },
    defines: { NPHI: SKY_TABLE.NPHI.toFixed(1), NEL: SKY_TABLE.NEL.toFixed(1), HAS_BELOW: below ? 1 : 0 },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform sampler2D tab; uniform vec3 scale, below, sunDir, sunColor, cSun, skyMean, nZen, nGlow; uniform vec2 sunXZ, cH, cK2;
      uniform vec4 cA, cB, cK; uniform float glow, nightK, nGS;
      varying vec3 vDir;
      const float V2PI = 3.141592653589793;
      ${cloudGLSL}
      ${nightGLSL}
      void main() {
        vec3 d = normalize(vDir);
        float h = length(d.xz);
        float cphi = h > 1e-5 ? clamp(dot(d.xz / h, sunXZ), -1.0, 1.0) : 1.0;
        vec2 uv = vec2(sqrt(acos(cphi) / V2PI), sqrt(asin(clamp(d.y, 0.0, 1.0)) / (0.5 * V2PI)));
        uv = uv * (vec2(NPHI, NEL) - 1.0) / vec2(NPHI, NEL) + 0.5 / vec2(NPHI, NEL);
        vec3 c = texture2D(tab, uv).rgb + v2night(d, nightK, nZen, nGlow, nGS);
        float den = v2cloud(d, cA, cB, cH);
        if (den > 0.0) {
          float mu = dot(d, sunDir), g = cK.z;
          float hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * mu, 1.5) / (4.0 * V2PI);
          vec3 cc = cSun * (cK.x + cK.y * hg) * (1.0 - cK2.x * den) + cK.w * skyMean;
          c = mix(c, cc, den * cK2.y);
        }
        c *= scale;
        #if HAS_BELOW
        if (d.y < -0.01) c = below;
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
// the sky in direction d, as one of the three uses sees it (JS, for the probe): 'light' | 'mirror'
function applyMoment(spec) {
  const M = buildMoment(spec, LOOK, ORIGIN, lin255);
  momentNow = M;
  // the sky table -> a half-float texture (linear, so the dome interpolates it)
  const { NPHI, NEL } = SKY_TABLE, half = new Uint16Array(M.tab.length);
  for (let i = 0; i < half.length; i++) half[i] = THREE.DataUtils.toHalfFloat(Math.min(M.tab[i], 65000));
  if (momentTex) momentTex.dispose();
  momentTex = new THREE.DataTexture(half, NPHI, NEL, THREE.RGBAFormat, THREE.HalfFloatType);
  momentTex.minFilter = momentTex.magFilter = THREE.LinearFilter; momentTex.wrapS = momentTex.wrapT = THREE.ClampToEdgeWrapping;
  momentTex.needsUpdate = true;
  // the sun
  const sMax = Math.max(...M.sunRGB);
  if (sMax > 1e-6) sun.color.setRGB(...M.sunRGB.map((v) => v / sMax), THREE.LinearSRGBColorSpace);
  sun.intensity = sMax;
  sun.castShadow = sMax > 1e-6;
  // integrals over the sky (JS): the lighting sky's irradiance on a level surface, the fog colour (the sky just above the horizon, all round)
  const dirs = [], NT = 32, NP = 64;
  for (let j = 0; j < NT; j++) for (let i = 0; i < NP; i++) {
    const th = ((j + 0.5) / NT) * Math.PI, ph = ((i + 0.5) / NP) * 2 * Math.PI;
    dirs.push([Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph), Math.sin(th) * (Math.PI / NT) * ((2 * Math.PI) / NP)]);
  }
  let skyVals = dirs.map((d) => (d[1] >= -0.01 ? momentSky(M, [d[0], Math.max(d[1], 0), d[2]]) : null));
  const levelE = (vals) => { const E = [0, 0, 0]; dirs.forEach((d, k) => { if (d[1] > 0) for (let c = 0; c < 3; c++) E[c] += vals[k][c] * M.ref.LIGHT * d[1] * d[3]; }); return E; };
  // a real captured sky (sky-real.js) replaces the model sky in every use; the model only calibrates it (Light B's units)
  const R = REAL_SKY;
  if (R) {
    setAnisotropy(R, renderer);
    const sunAtEl = (el) => { const T = sunTransmittance(el, M.haze); return M.sunB.map((v, c) => (M.ref.T[c] > 0 ? (v * T[c]) / M.ref.T[c] : 0)); };
    placeRealSky(R, M, sunAtEl, M.ref.LIGHT, levelE(skyVals), M.exposure, LOOK.MOMENT.REAL.FIT_SLOPE_MAX);
    skyVals = dirs.map((d) => (d[1] >= -0.01 ? realAt(R, [d[0], Math.max(d[1], 0), d[2]]) : null));
  }
  // The LIGHT a real sky casts is the visible sky with Light B's own chroma relation: Light B lights with its sky stops x SKY_GAIN
  // (per channel), a much paler light than the deep blue it shows (a camera's sky is far more saturated than the sky's light). One
  // number s, fitted so that toward-grey(stops irradiance, s) has the colour of (stops x SKY_GAIN): the same s applied to a real sky
  // turns Light B's own sky into Light B's own light exactly, keeps white clouds white and a sunset's warm light warm.
  const sB = R ? lightDesat() : 1;
  const toLight = (v) => { if (sB === 1) return v.map((x) => x * M.ref.LIGHT); const l = 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; return v.map((x) => (l + LOOK.MOMENT.REAL.LIGHT_SAT * sB * (x - l)) * M.ref.LIGHT); };
  const lightVals = skyVals.map((v) => v && toLight(v));
  const skyAtM = R ? (d) => realAt(R, d) : (d) => momentSky(M, d);
  const Esky = levelE(lightVals.map((v) => v && v.map((x) => x / M.ref.LIGHT)));
  const sinEl = Math.max(0, Math.sin(THREE.MathUtils.degToRad(M.el)));
  const groundE = M.sunRGB.map((v, c) => v * sinEl + Esky[c]);
  const bounceM = groundE.map((e) => (LOOK.LIGHT_B.ground * e) / Math.PI);
  const groundEB = sunRGB.map((v, c) => v * Math.sin(THREE.MathUtils.degToRad(LOOK.MOMENT.REF.EL)) + Math.PI * 0.5 * (zenithAvg[c] + STOPS[3][1][c] * skyLightScale[c]));
  const groundMirror = LOOK.GROUND_MIRROR.map((v, c) => v * groundE[c] / groundEB[c]);
  const fog = [0, 0, 0];
  for (let i = 0; i < 64; i++) { const a = (i / 64) * 2 * Math.PI, s = skyAtM([Math.cos(a) * 0.9998, LOOK.MOMENT.REAL.FOG_SINE, Math.sin(a) * 0.9998]); for (let c = 0; c < 3; c++) fog[c] += s[c] / 64; }
  scene.fog.color.setRGB(...fog.map((v) => v * LOOK.SKY_DOME_GAIN), THREE.LinearSRGBColorSpace);
  // the visible dome (its horizon below the level line = the fog), the mirror environment, the diffuse probe
  const old = dome.material;
  const mat = R ? (sc, below, glow) => realMaterial(R, M, sc, below, glow) : (sc, below, glow) => momentMaterial(M, sc, below, glow);
  dome.material = SKY_KEY ? skyKeyMaterial() : mat(domeScale, fog.map((v) => v * LOOK.SKY_DOME_GAIN), (R ? LOOK.MOMENT.REAL.DISC_GLOW : LOOK.MOMENT.SKY_GLOW) * LOOK.SKY_DOME_GAIN);
  old.dispose();
  if (scene.environment) scene.environment.dispose();
  scene.environment = envFrom(mat(mirrorScale, groundMirror, 0));
  const sh = new THREE.SphericalHarmonics3(), basis = new Array(9).fill(0), v = new THREE.Vector3(), add = new THREE.Vector3();
  dirs.forEach((d, k) => {
    const S = skyVals[k];
    const L = S ? lightVals[k] : bounceM, Mi = S ? S.map((x) => x * LOOK.LIGHT_B.mirror) : groundMirror;
    THREE.SphericalHarmonics3.getBasisAt(v.set(d[0], d[1], d[2]), basis);
    add.set(Math.max(0, L[0] - Mi[0]), Math.max(0, L[1] - Mi[1]), Math.max(0, L[2] - Mi[2]));
    for (let b = 0; b < 9; b++) sh.coefficients[b].addScaledVector(add, basis[b] * d[3]);
  });
  diffuseProbe.sh.copy(sh);
  renderer.toneMappingExposure = LOOK.EXPOSURE * M.exposure;
  sun.shadow.needsUpdate = true;   // (the caller redraws: at load the frame loop is not set up yet)
  return { az: M.az, el: M.el, haze: M.haze, sunRGB: M.sunRGB, groundE, bounce: bounceM, fog, cover: M.C.COVER, exposure: M.exposure, nightK: M.nightK,
    real: R ? { name: R.name, calib: R.calib, k: R.k, fit: R.fit, photo: !!R.photo, photoScale: R.photo ? R.photo.scale : null, Esky, lightSat: sB * LOOK.MOMENT.REAL.LIGHT_SAT } : null };
}
// Light B's sky -> light chroma relation (see applyMoment): s with grey(E) + s (E - grey(E)) ~ the colour of E x SKY_GAIN, over the stops' irradiance
let lightDesatS = null;
function lightDesat() {
  if (lightDesatS != null) return lightDesatS;
  const E = [0, 0, 0], Eg = [0, 0, 0], NT = 32, NP = 64;
  for (let j = 0; j < NT; j++) for (let i = 0; i < NP; i++) {
    const th = ((j + 0.5) / NT) * (Math.PI / 2), w = Math.cos(th) * Math.sin(th);
    const a = skyAt(Math.cos(th), [1, 1, 1]), b = skyAt(Math.cos(th), skyLightScale);
    for (let c = 0; c < 3; c++) { E[c] += a[c] * w; Eg[c] += b[c] * w; }
  }
  const lum = (v) => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2], l = lum(E), t = Eg.map((v) => (v * l) / lum(Eg));
  let num = 0, den = 0; for (let c = 0; c < 3; c++) { num += (t[c] - l) * (E[c] - l); den += (E[c] - l) ** 2; }
  lightDesatS = den > 0 ? num / den : 1;
  return lightDesatS;
}
// ?skykey=1 (verification only): the visible dome drawn flat magenta, so a picture of the app shows exactly where it draws sky
const SKY_KEY = params.get('skykey') === '1';
function skyKeyMaterial() { return new THREE.MeshBasicMaterial({ color: 0xff00ff, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false, toneMapped: false }); }
// the real sky (sky-real.js) as the dome / the mirror environment: the same roles and units as momentMaterial; glow = the sun's DISC
// only (the HDRI holds its own halo)
function realMaterial(R, M, scale, below, glow) {
  const sMax = Math.max(...M.sunRGB, 1e-9);
  return new THREE.ShaderMaterial({
    name: 'v2-real-sky',
    uniforms: {
      ...realSkyUniforms(R), scale: { value: new THREE.Vector3(...scale) }, below: { value: new THREE.Vector3(...(below || [0, 0, 0])) },
      sunDir: { value: new THREE.Vector3(...M.sunDir) }, glow: { value: M.el > 0 ? glow : 0 },
      sunColor: { value: new THREE.Vector3(...M.sunRGB.map((v) => (sMax > 1e-6 ? v / sMax : 0))) },
    },
    defines: { HAS_BELOW: below ? 1 : 0, ...(R.photo ? { R_PHOTO: 1 } : {}) },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform vec3 scale, below, sunDir, sunColor; uniform float glow;
      varying vec3 vDir;
      ${realSkyGLSL}
      void main() {
        vec3 d = normalize(vDir);
        vec3 c = v2real(d) * scale;
        #if HAS_BELOW
        if (d.y < -0.01) c = below;
        #endif
        float s = max(dot(d, normalize(sunDir)), 0.0);
        c += sunColor * glow * pow(s, 600.0) * 4.0;
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
  });
}
if (MOMENT) applyMoment(MOMENT);
if (params.get('sun') === '0') sun.intensity = 0;   // diagnosis: the indirect light alone

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
// Casters whose shadow cannot reach anything on screen are left out of the shadow map (QUALITY.SHADOW_VIEW_CULL). A shadow on a
// visible point P comes from a caster point Q up the sun from P (P = Q - t * sunDir, P above the ground), so a caster whose
// bounding sphere, swept down the sun to the ground and widened by a margin for the shadow filter, misses the camera's view
// cannot shade any visible pixel. The test is conservative. It is one-sided, so turning the camera does not redraw the map on
// every frame: the map is redrawn when a caster the view NEEDS is not in it (or the box moved, or a caster changed); a caster in
// the map that the view no longer needs stays until the next redraw (it only shades what is off screen).
const SHADOW_VIEW_CULL = SHADOW_CACHE && (params.get('shadowcull') ? params.get('shadowcull') !== '0' : QUALITY.SHADOW_VIEW_CULL);
const viewFrustum = new THREE.Frustum(), viewPM = new THREE.Matrix4(), sweepBox = new THREE.Box3(), sweepS = new THREE.Sphere(), sweepEnd = new THREE.Vector3();
let inMap = new Set();            // the casters drawn into the map now
const needed = [], notNeeded = [];
// fills `needed` / `notNeeded` with the visible casters; true when a needed one is not in the map
function sortCasters(root, cam) {
  viewPM.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  viewFrustum.setFromProjectionMatrix(viewPM, cam.coordinateSystem, cam.reversedDepth);
  const margin = (2 * shadowExtent / SHADOW_SIZE) * LOOK.SHADOW_VIEW_CULL_MARGIN_TEXELS;
  let missing = false;
  const visit = (o) => {
    if (!o.visible) return;
    if (o.castShadow && o.geometry) {
      let need = true;
      if (o.frustumCulled) {
        const g = o.geometry;
        if (o.isInstancedMesh) { if (!o.boundingSphere) o.computeBoundingSphere(); sweepS.copy(o.boundingSphere); }   // every instance
        else { if (!g.boundingSphere) g.computeBoundingSphere(); sweepS.copy(g.boundingSphere); }
        sweepS.applyMatrix4(o.matrixWorld);
        const r = sweepS.radius + margin, c = sweepS.center;
        const k = Math.max(0, c.y + r) / sunDir.y;              // down the sun until below the ground
        sweepEnd.copy(c).addScaledVector(sunDir, -k);
        sweepBox.min.set(Math.min(c.x, sweepEnd.x) - r, Math.min(c.y, sweepEnd.y) - r, Math.min(c.z, sweepEnd.z) - r);
        sweepBox.max.set(Math.max(c.x, sweepEnd.x) + r, Math.max(c.y, sweepEnd.y) + r, Math.max(c.z, sweepEnd.z) + r);
        need = viewFrustum.intersectsBox(sweepBox);
      }
      if (need) { needed.push(o); if (!inMap.has(o)) missing = true; } else notNeeded.push(o);
    }
    const ch = o.children;
    for (let i = 0; i < ch.length; i++) visit(ch[i]);
  };
  visit(root);
  return missing;
}
if (SHADOW_CACHE) {
  const drawShadows = renderer.shadowMap.render;
  let lastSig = '';
  renderer.shadowMap.render = function (lights, s, cam) {
    if (s !== scene) return drawShadows.call(this, lights, s, cam);
    const t = performance.now();
    const sig = casterSignature(scene);
    if (sig !== lastSig) { lastSig = sig; sun.shadow.needsUpdate = true; }
    if (SHADOW_VIEW_CULL && sortCasters(scene, cam)) sun.shadow.needsUpdate = true;
    shadowStats.sigMs += performance.now() - t; shadowStats.frames++;
    const redraw = sun.shadow.needsUpdate || sun.shadow.autoUpdate;
    if (redraw) shadowStats.redraws++;
    if (!redraw || !SHADOW_VIEW_CULL) { needed.length = 0; notNeeded.length = 0; return drawShadows.call(this, lights, s, cam); }
    for (const o of notNeeded) o.castShadow = false;
    try { return drawShadows.call(this, lights, s, cam); }
    finally {
      for (const o of notNeeded) o.castShadow = true;
      inMap = new Set(needed); shadowStats.culled = notNeeded.length; shadowStats.kept = needed.length;
      needed.length = 0; notNeeded.length = 0;
    }
  };
}
if (LOOK.HEMI_INTENSITY > 0) scene.add(new THREE.HemisphereLight(LOOK.HEMI_SKY, LOOK.HEMI_GROUND, LOOK.HEMI_INTENSITY));

const SUN_DISTANCE_M = 1500;   // the shadow camera stands this far up the sun from the target (covers the tallest tower in the largest box)
const lightF = sunDir.clone().negate(), lightR = new THREE.Vector3().crossVectors(lightF, new THREE.Vector3(0, 1, 0)).normalize();
const lightU = new THREE.Vector3().crossVectors(lightR, lightF).normalize();
let shadowKey = '';
// in motion the box may move in bigger steps (LOOK.SHADOW_STEP_TEXELS_MOVING, ?shadowmove=N texels): fewer redraws of the map while
// the camera travels; the moment it stops the box is placed on the still step again, so a still is the same picture
const SHADOW_MOVE_MULT = Math.max(1, Math.round((+params.get('shadowmove') || LOOK.SHADOW_STEP_TEXELS_MOVING) / LOOK.SHADOW_STEP_TEXELS));
function followShadow(moving = false) {
  fitShadow();
  // Move the shadow box in whole steps measured in the light's own axes, so every shadow texel stays where it was.
  const t = shadowFocus(), step = moving ? shadowStep * SHADOW_MOVE_MULT : shadowStep;
  const a = Math.round(t.dot(lightR) / step) * step, b = Math.round(t.dot(lightU) / step) * step;
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
// After dusk under a moment (first pass): a share of the windows lit (LOOK.MOMENT.NIGHT), one random choice per window cell, faded to
// the lit share as the cell nears the pixel's footprint (the facade's own FADE_PX), so far walls glow evenly instead of flickering.
function nightWindowsGLSL(cell, footprint, cover, f) {
  const N = momentNow && momentNow.nightK > 0 ? momentNow.night : null;
  if (!N) return '';
  const k = momentNow.nightK, W = N.WINDOWS.map((v, c) => v * k * momentNow.wb[c]);
  return `
  {
    float v2h = fract(sin(dot(${cell}, vec2(12.9898, 78.233))) * 43758.5453);
    float v2lit = mix(step(${f(1 - N.LIT_SHARE)}, v2h), ${f(N.LIT_SHARE)}, smoothstep(${f(LOOK.FACADE.FADE_PX[0])}, ${f(LOOK.FACADE.FADE_PX[1])}, ${footprint}));
    totalEmissiveRadiance += vec3(${W.map((v) => v.toExponential(4)).join(', ')}) * ${cover} * v2lit;
  }`;
}
// ...and the Blender tiles' glass (material extras v2_kind "glass"): a cell of NIGHT.CELL_M (storey x bay) on the wall, from the
// world position (no per-pane ids in the merged tiles yet)
function nightGlass(obj) {
  if (!(momentNow && momentNow.nightK > 0)) return;
  obj.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m || m.userData.v2Night || !(m.userData.v2_kind === 'glass' || /^glass/.test(m.name || ''))) continue;
      m.userData.v2Night = true;
      const prev = m.onBeforeCompile, C = momentNow.night.CELL_M, f = (v) => v.toFixed(5);
      m.onBeforeCompile = (sh, r) => {
        prev && prev.call(m, sh, r);
        sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_begin>', `
  {
    vec3 v2wp = cameraPosition + ( vec4( -vViewPosition, 0.0 ) * viewMatrix ).xyz;
    vec2 v2c = vec2( ( v2wp.x + v2wp.z ) / ${f(C[1])}, v2wp.y / ${f(C[0])} );
    vec2 v2w = fwidth( v2c );${nightWindowsGLSL('floor(v2c)', 'max(v2w.x, v2w.y)', '1.0', f)}
  }
#include <lights_fragment_begin>`);
      };
      const key = m.customProgramCacheKey ? m.customProgramCacheKey.bind(m) : () => '';
      m.customProgramCacheKey = () => key() + '|v2-night';
      m.needsUpdate = true;
    }
  });
}
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
  roughnessFactor = mix(roughnessFactor, ${f(F.GLASS_ROUGHNESS)}, win);${nightWindowsGLSL('floor(fc) + vec2(cls * 7.13, 0.0)', 'max(w.x, w.y)', 'win', f)}
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
    else if (m.type === 'collide') { field.setFootprints(m.data); applyBlenderTops(); coverLate(); labels.dirty = true; labels.occGen = (labels.occGen || 0) + 1; }
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
      // the camera's collision tops from the model (#529), and the plain blocks the model stands over (covers.js)
      prepare: (obj, def, s) => { exactPrepare(obj, def); nightGlass(obj); if (field.ready) field.addTile(obj, def, t.manifest.buildings || {}); coverOf(obj, def, s); },
      onChange: () => { dirty = true; sun.shadow.needsUpdate = true; labels.occGen = (labels.occGen || 0) + 1; labels.dirty = true; }, onAnimate: () => { dirty = true; } });
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

// A Blender model hides every plain extrusion it stands over, not only the ones its manifest entry lists (covers.js). Measured
// once when the tile arrives, in a worker (covers-worker.js): the answer usually comes back while the plain extrusions are still
// fading into the haze, so the extra ones fade and swap with the tile's own (tiles.js reads s.mapIds at every step); one that
// comes back after the swap hides them at once. A tile that arrives before the city's outlines waits in coverWait.
// Names whose building is hidden this way are lifted onto the model's top (coverTop, labels.js liftOf).
if (params.get('cover') === '0') COVER.ON = false;
const coverWait = new Set(), coverStats = { tiles: 0, ids: 0, workerMs: 0, mainMs: 0 }, coverJobs = new Map(), coverTop = new Map();
let coverWorker = null, coverSeq = 0;
function coverOf(obj, def, s) {
  if (!COVER.ON) return [];
  if (!field.ready) { coverWait.add(s); return []; }
  const t0 = performance.now();
  if (!coverWorker) {
    coverWorker = new Worker(new URL('./covers-worker.js', import.meta.url), { type: 'module' });
    coverWorker.onmessage = (ev) => coverDone(ev.data);
  }
  const job = ++coverSeq, meshes = objectArrays(obj);
  coverJobs.set(job, { s, obj });
  coverWorker.postMessage({ job, meshes, outlines: outlinesNear(field, def.bounds) }, meshes.flatMap((m) => [m.pos.buffer, ...(m.idx ? [m.idx.buffer] : [])]));
  coverStats.mainMs += performance.now() - t0;
  return [];
}
function coverDone({ job, covered, raster, ms, error }) {
  const J = coverJobs.get(job); coverJobs.delete(job);
  if (error) console.warn('[v2 covers]', error);
  if (!J || J.s.obj !== J.obj) return;                      // the tile was dropped (or loaded again) meanwhile
  const s = J.s, own = new Set(s.mapIds.flatMap((id) => idKeys(id)));
  const under = covered.filter((c) => c.share >= COVER.HIDE_SHARE);
  const extra = under.filter((c) => !idKeys(c.id).some((k) => own.has(k))).map((c) => c.id);
  coverStats.tiles++; coverStats.ids += extra.length; coverStats.workerMs += ms || 0;
  for (const c of under) for (const e of field.byId.get(c.id) || []) coverTop.set(e, { top: c.top, id: c.id });
  if (raster) {                                             // the model's heights, for the names (modelHeightAt)
    const R = { ...raster, s, obj: J.obj }, G = MODEL_GRID_M;
    for (let i = Math.floor(R.x0 / G); i <= Math.floor((R.x0 + R.nx * R.C) / G); i++) for (let j = Math.floor(R.z0 / G); j <= Math.floor((R.z0 + R.nz * R.C) / G); j++) {
      const k = i * 65536 + j, l = (modelGrid.get(k) || []).filter((r) => r.s.obj === r.obj); l.push(R);
      l.max = Math.max(...l.map((r) => r.top ??= r.h.reduce((m, v) => (v > m ? v : m), 0))); modelGrid.set(k, l);
    }
  }
  labels.dirty = true; labels.occGen = (labels.occGen || 0) + 1;   // the names ask again who hides them
  if (!extra.length) return;
  s.mapIds = [...new Set([...s.mapIds, ...extra])];
  if (J.obj.parent) setHidden(extra, true);                 // already swapped in: hide them now
}
const isHiddenId = (id) => idKeys(id).some((k) => city.hidden.has(k));
// The highest point of a Blender model on screen at (x, z) (0 = none): the names hide behind the models' real shapes, not behind
// the plain outlines the models replace (labels.js hiddenFrom).
const MODEL_GRID_M = 256, modelGrid = new Map();
function modelHeightAt(x, z, above = 0) {
  const l = modelGrid.get(Math.floor(x / MODEL_GRID_M) * 65536 + Math.floor(z / MODEL_GRID_M));
  if (!l || !(l.max > above)) return 0;                     // nothing in this 256 m square that tall: the cheap answer
  let top = 0;
  for (const R of l) {
    if (R.s.obj !== R.obj || !R.obj.parent) continue;       // dropped, or not swapped in yet
    const i = Math.floor((x - R.x0) / R.C), j = Math.floor((z - R.z0) / R.C);
    if (i >= 0 && j >= 0 && i < R.nx && j < R.nz && R.h[j * R.nx + i] > top) top = R.h[j * R.nx + i];
  }
  return top;
}
// a plain outline that a Blender model hides does not hide names (the model does, through modelHeightAt)
function outlineHidden(e) {
  if (e.mapId === undefined) {                              // tag every outline with its id once (the first key: the full id)
    for (const [id, list] of field.byId) for (const p of list) p.mapId ??= id;
    e.mapId ??= null;
  }
  return !!e.mapId && isHiddenId(e.mapId);
}
function coverLate() {
  for (const s of coverWait) { coverWait.delete(s); if (s.obj) coverOf(s.obj, s.def, s); }
}
// a name's point inside an outline that a Blender model hides: the model's top there (labels.js lifts the name onto it)
function coverLift(x, z) {
  if (!coverTop.size || !field.ready) return 0;
  const B = CollisionField.B;
  let top = 0;
  for (const e of field.buckets.get(Math.floor(x / B) * 65536 + Math.floor(z / B)) || []) {
    const c = coverTop.get(e);
    if (c && c.top > top && isHiddenId(c.id) && field.touches(e, x, z, 5)) top = c.top;   // only while the model hides it
  }
  return top;
}

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
let dirty = true, frames = 0, wasMoving = false;
const frameLog = { on: false, dts: [], cpu: [], scales: [], last: 0 };
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setDrawingBufferSize(w, h, DPR * adapt.scale);   // = setPixelRatio + setSize(w, h, false), with one canvas resize
  setAOPixelScale(adapt.scale);   // (the AO's near/far steps follow the full-resolution pixel)
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
  samples: [], lastDraw: 0, lastMove: 0, changes: 0, movingDraw: false, lastDown: null, learnedFloor: 0, learnedAt: 0,
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
  // a step down that did not make frames faster (the frame is not bound by its pixels, e.g. the CPU is): undo it, and never go
  // below that scale for A.RELEARN_MS (softer for nothing is not a trade)
  const prev = adapt.lastDown; adapt.lastDown = null;
  if (prev && A.MIN_GAIN > 0 && med > prev.med * A.MIN_GAIN) { adapt.learnedFloor = prev.scale; adapt.learnedAt = now; adapt.motionScale = prev.scale; setScale(prev.scale); return; }
  if (now - adapt.learnedAt > A.RELEARN_MS) adapt.learnedFloor = 0;
  const floor = Math.max(adapt.floor, adapt.learnedFloor);
  if (med > adapt.budgetMs * A.DOWN_AT && adapt.scale > floor + 1e-3) { adapt.lastDown = { scale: adapt.scale, med }; adapt.motionScale = Math.max(floor, adapt.scale * A.STEP); }
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
  if (!moving && wasMoving && SHADOW_MOVE_MULT > 1) dirty = true;   // the camera stopped: draw the still with the still's shadow box
  wasMoving = moving;
  if (moved) { markers.update(); if (!easing) map.fire('move'); }
  if (frameLog.on && frameLog.orbit) { orbitStep(); }
  if (tiles) tiles.update(now);
  if (moved || mapLayers.dirty) { mapLayers.dirty = false; mapLayers.update(); }
  labels.update(now);
  if (!(moved || dirty || frameLog.on)) return;
  dirty = false;
  followShadow(moving);
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
  pickRoots: () => [cityGroup, ...(tiles ? [tiles.group] : [])], onCard: showCard,
  field, obstacles: () => markers.pinRects(), liftOf: coverLift, modelHeightAt, outlineHidden });   // names hide behind buildings, keep off the finder's pins
markers.onPins = () => { labels.dirty = true; };
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
  THREE, scene, camera, controls, renderer, city, LOOK, VIEW, TILES, FLY, fly: () => controls.state(), field, COVER, coverStats, tileStreamer: () => tiles,
  ready: Promise.all([cityReady, tilesReady, routeReady]),
  tiles: () => tiles && tiles.summary(),
  exactProbe: () => {
    // what a local probe sees of the sky must be the MIRROR sky (LOOK.LIGHT_B.mirror x the stops), as the environment map every other
    // mirror sees: the visible dome is drawn x SKY_DOME_GAIN, so it is switched to the mirror's scale for the probe's six faces
    const u = dome.material.uniforms ? dome.material.uniforms.scale.value : new THREE.Vector3(), was = u.clone();   // (?skykey: no uniforms)
    if (LOOK.PROBE_MIRROR_SKY) u.set(...mirrorScale);
    const ms = exactProbe(renderer, scene); u.copy(was); dirty = true; return ms;
  }, exact: () => ({ tiles: exactState.tiles.length, glass: exactState.tiles.map((t) => t.glass.length), hidden: exactState.hidden, probeMs: exactState.probeMs }),
  timings: () => ({ ...timings }),
  // the moment (sky.js): its numbers, and a change of its haze / clouds / exposure inside the page (the sun's direction stays)
  moment: () => (momentNow ? { name: MOMENT.name || null, az: momentNow.az, el: momentNow.el, haze: momentNow.haze, cover: momentNow.C.COVER,
    exposure: momentNow.exposure, wb: momentNow.wb, ms: momentNow.ms, sunRGB: momentNow.sunRGB, nightK: momentNow.nightK, groundShade: GROUND_SHADE,
    real: REAL_SKY ? { name: REAL_SKY.name, calib: REAL_SKY.calib, k: REAL_SKY.k, fit: REAL_SKY.fit, photo: !!REAL_SKY.photo } : null } : null),
  setMoment: (o = {}) => {
    if (!MOMENT) return null;
    Object.assign(MOMENT, o, { clouds: { ...(MOMENT.clouds || {}), ...(o.clouds || {}) } });
    const r = applyMoment(MOMENT); dirty = true; return r;
  },
  // swap the real sky inside the page (rule 13: load once, test many); keeps the moment's photo sky. 'param' = the parametric sky
  setSky: async (name, photo) => {
    if (!MOMENT) return null;
    const ph = photo === undefined || photo === '__keep' ? (REAL_SKY && REAL_SKY.photo ? MOMENT.photo : null) : photo;
    REAL_SKY = name && name !== 'param' ? await loadRealSky(name, ph, renderer) : null;
    const r = applyMoment(MOMENT); dirty = true; return r;
  },
  setHidden, placeCamera: (p) => { skipIntro(); placeCamera(p); }, flyTo, map, INTRO, skipIntro,
  intro: () => introFlight.flight && { ...introFlight.flight },
  labels: () => ({ items: labels.items.length, shown: labels.shown, merged: labels.merged || 0, occluded: labels.occludedN || 0, selected: labels.selected?.name || null }),
  pick: (x, y) => labels.pick(x, y), openCard: (name) => { const it = labels.items.find((i) => i.name === name); if (it) labels.open(it); return !!it; }, requestRoute, drawRoute, redraw: () => { dirty = true; },
  pickApartment: (name) => { const i = apartments.findIndex((a) => a.name === name); if (i >= 0) { aptSel.value = String(i); return update(true); } },
  pickBuilding: (code) => { const i = buildings.findIndex((b) => b.code === code); if (i >= 0) { clsSel.value = String(i); return update(true); } },
  info: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures,
    dpr: renderer.getPixelRatio(), size: [renderer.domElement.width, renderer.domElement.height], reversedDepth: renderer.capabilities.reversedDepthBuffer, frames,
    shadow: { cache: SHADOW_CACHE, ...shadowStats, extent: shadowExtent, aim: LOOK.SHADOW_AIM.ON && shadowFocus() === shadowAim.p, aimMs: +shadowAim.ms.toFixed(3) }, adapt: { on: adapt.on, floor: adapt.floor, learnedFloor: adapt.learnedFloor, scale: adapt.scale, motionScale: adapt.motionScale, changes: adapt.changes } }),
  async measure(ms = 4000, degPerFrame = 0.15) {
    Object.assign(frameLog, { on: true, orbit: degPerFrame > 0, degPerFrame, dts: [], cpu: [], scales: [], last: 0 });
    await new Promise((r) => setTimeout(r, ms));
    frameLog.on = false;
    return { frames: frameLog.dts.length, medianFrameMs: median(frameLog.dts), p95FrameMs: pct(frameLog.dts, 0.95), medianRenderCallMs: median(frameLog.cpu), medianScale: median(frameLog.scales), ...this.info() };
  },
};
