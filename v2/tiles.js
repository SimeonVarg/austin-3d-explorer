// Streams the Blender-model tiles listed in a manifest (the contract: v2/tiles/manifest.json, built on mac/v2-tiles).
//   - every tile draws its FULL model (lod0) at every distance: there is no swap to a lesser far copy (owner, 2026-10-18:
//     "get rid of the rule that converts buildings to bad lesser detailed ones when theyre at a distance"). The manifest's lod1
//     files and per-tile lod1_m are no longer read;
//   - the far copy (on with the fast mode, look.js FAST; ?far=0 turns it off): a tile far enough away draws its FAR COPY instead (FAR below, scripts/v2/far_coat.py): a tight shell of
//     what can be seen of each building from outside, with the full model's own colours laid on it as one picture. Every part
//     smaller than a texel (frames, rails, fins) is paint on the shell, so the GPU filters it like any texture (mip maps) and it
//     has nothing left to flicker with; and the tile costs about a tenth of the triangles. It takes over only where one texel is
//     already smaller than a screen pixel, and the full model comes back before that;
//   - the nearest tiles in view load first, then the nearest out of view; tiles beyond LOAD_DISTANCE_M are not loaded;
//   - at most MAX_DECODES loads (fetch + meshopt decode + parse) run at once (RUSH_DECODES behind the loading screen);
//   - a load whose tile is no longer wanted is aborted, or thrown away the moment it finishes;
//   - a tile that arrives FADES in instead of popping (FADE): the plain extrusions it replaces first fade into the haze, then
//     the model takes their place and fades out of the haze (both opaque, no sorting, no dither: see setFade / the haze mix);
//   - tiles beyond UNLOAD_DISTANCE_M are removed and their GPU memory freed; three.js frustum-culls every mesh.
// While a tile is on screen its buildings' map ids are hidden in the plain extrusions (onShow / onHide).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { brickMipChain, BRICK_MIPS } from './brick-mips.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { LOOK, BRICK_MIPS_SLUGS, fastPart } from './look.js';

const PQ = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
export const TILES = {
  MAX_DECODES: 2,
  // ...and this many while the loading screen is up (main.js sets rush): nothing is on screen that a slow frame could spoil.
  // Measured 2026-11-12 on the owner's Mac at his monitor's size (2560 x 1300, 1x): the opening flight starts 4.8 s after the
  // page opens instead of 7.5 s. ?rush=2: as before.
  RUSH_DECODES: PQ.has('rush') ? +PQ.get('rush') : 10,
  LOAD_DISTANCE_M: 2600,       // tiles nearer than this are wanted
  UNLOAD_DISTANCE_M: 3200,     // tiles beyond this are dropped (must be > LOAD_DISTANCE_M)
  TILE_TOP_M: 160,             // assumed top of a tile, for the in-view test
  UPDATE_EVERY_MS: 200,        // how often the load plan is made again (the fades run every frame)
  MAX_TRIES: 2,                // a tile that fails this many times is left out (the plain extrusions stay)
  FADE: {
    OUT_MS: 350,               // the plain extrusions a tile replaces fade into the haze over this
    IN_MS: 650,                // then the model fades out of the haze over this
  },
};

const smooth = (k) => k * k * (3 - 2 * k);
const LEVELS = ['far', 'lod0'];

// The fade: every lit material of a tile mixes its final colour toward the haze colour (main.js fog_fragment's hazeC) by uFade.
// One uniform per tile, shared by the tile's materials; the program is shared by every tile (customProgramCacheKey).
// The baked ambient occlusion (vertex attribute _AO, scripts/v2/ao_bake.mjs; LOOK.AO): multiplies the indirect light only, as
// three.js's own aoMap does (diffuse sky + bounce, and the specular occlusion of what the surface mirrors). Tiles without the
// attribute draw as before.
const AO_STRENGTH = { value: LOOK.AO.STRENGTH };
const AO_FAR = { value: new THREE.Vector4(...LOOK.AO.FAR_PX_M) };
// the canvas's adaptive scale (main.js, in motion only): the AO steps are chosen by the FULL-resolution pixel, so they do not move when
// the canvas drops to fewer pixels in motion and comes back when it stops
const AO_SCALE = { value: 1 }, MOTION = { scale: 1 };
// s = the scale motion draws at (1 = standing still); shader = what the pixel-size rules below multiply their pixel by
export function setAOPixelScale(s, shader = s) { MOTION.scale = s; AO_SCALE.value = shader; }
const AO_SHOW = typeof location !== 'undefined' && new URLSearchParams(location.search).get('aoshow') === '1';   // diagnosis: draw the baked AO itself
function fadeable(material, uniform, ao) {
  if (!material || material.userData.v2Fade) return;
  material.userData.v2Fade = true;
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    sh.uniforms.uFade = uniform;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uFade;')
      .replace('#include <fog_fragment>', '#include <fog_fragment>\n#ifdef USE_FOG\n  gl_FragColor.rgb = mix(gl_FragColor.rgb, hazeC, uFade);\n#endif');
    if (ao) {
      sh.uniforms.uAOStrength = AO_STRENGTH;
      sh.uniforms.uAOFar = AO_FAR; sh.uniforms.uAOScale = AO_SCALE;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 _ao;\nvarying float vV2AO;\nvarying float vV2AOF;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvV2AO = _ao.x;\nvV2AOF = _ao.y;');
      if (AO_SHOW) sh.fragmentShader = sh.fragmentShader.replace('#include <dithering_fragment>', '#include <dithering_fragment>\n  gl_FragColor = vec4(vec3(v2aoSeen), 1.0);');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vV2AO;\nvarying float vV2AOF;\nuniform float uAOStrength;\nuniform vec4 uAOFar;\nuniform float uAOScale;\nfloat v2aoSeen = 1.0;')
        .replace('#include <aomap_fragment>', `#include <aomap_fragment>
  {
    // near: the AO of each face; as a pixel grows (metres per pixel, uAOFar.xy) the far AO (the same box-filtered over a few metres),
    // and as it grows on (uAOFar.zw) none: far off, the city draws as it did before the AO
    float v2px = max(length(dFdx(vViewPosition)), length(dFdy(vViewPosition))) * uAOScale;
    float v2raw = mix(mix(vV2AO, vV2AOF, smoothstep(uAOFar.x, uAOFar.y, v2px)), 1.0, smoothstep(uAOFar.z, uAOFar.w, v2px));
    v2aoSeen = v2raw;
    float v2ao = clamp(mix(1.0, v2raw, uAOStrength), 0.0, 1.0);
    reflectedLight.indirectDiffuse *= v2ao;
    #if defined( USE_ENVMAP ) && defined( STANDARD )
      float v2dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
      reflectedLight.indirectSpecular *= computeSpecularOcclusion( v2dotNV, v2ao, material.roughness );
    #endif
  }`);
    }
  };
  const key = material.customProgramCacheKey ? material.customProgramCacheKey.bind(material) : () => '';
  material.customProgramCacheKey = () => key() + '|v2-fade' + (ao ? '|v2-ao' : '');
  material.needsUpdate = true;
}
// Coverage fade (rule 15) for fine parts a build marks in scripts/v2/photo_materials.json ("fade": eave brackets, a trim line): as the
// pixel grows past the part's size (metres per pixel, as the AO above measures it), the part's colour goes over to the colour of the
// surface behind it, so a repeat finer than a pixel has nothing left to flicker with. Band-limited by the part's own size, not a blur.
// The tile build marks the material with extras v2_fade_to (rgb, linear) and v2_fade_m (the part's size, metres).
// Photo textures (scripts/v2/photo_materials.json): their sampling is set per building by the spec's "filter" (the tile build copies it into
// the material extras v2_photo_aniso / v2_photo_bias; absent = plain trilinear, as before). Why: on PMA at 250 m the brick and precast
// textures are far below a texel per pixel, and plain trilinear mip filtering averaged them more than the supersampled truth does, so the
// wall measured softer than the truth (v2-shimmer "soft" +0.02, PR #562). Anisotropy narrows the footprint on slanted walls; a small
// negative mip bias (-0.15) takes the mip level back to about a texel per pixel. Measured: soft <= 0 again, shimmer not above main's.
// ?photoaniso=N / ?photobias=B override both for every photo material (an A/B in one page load).
// The far copy. Why it exists: measured 2026-11-11 in the opening flight on the owner's Mac, a frame drew 6 M triangles, most of them
// smaller than a pixel, at 70 to 100 ms, so the canvas fell to a quarter of its pixels for the whole flight (the shimmer he sees).
export const FAR = {
  ON: fastPart('far') && !PQ.has('moment'),   // part of the fast mode (look.js FAST: on for a desktop; ?far=0 or ?fast=0 turns it off); a far copy has no lit windows, so night moments keep the full models
  MODEL: 3,                   // how a far copy holds its colours (bright part + dark share, below); a file of another model is not drawn
  INDEX: 'tiles/coats.json',  // { tile id: { file, texel_m, triangles } }, written by scripts/v2/far_coat.py
  PX: PQ.has('farpx') ? +PQ.get('farpx') : 1.5,   // the far copy draws where a pixel of the canvas, as it is now, is this many of its texels or more...
  BACK: 0.85,                 // ...and the full model draws again when the pixel is under this x that size (no flipping at the line)
  ANISOTROPY: PQ.has('faraniso') ? +PQ.get('faraniso') : 8,   // slanted walls stay sharp
  WALL_ROUGHNESS: PQ.has('farrough') ? +PQ.get('farrough') : 0.9,   // the rough part's roughness (the builds' walls and roofs are 0.85 to 1)
  MIP_BIAS: PQ.has('farbias') ? +PQ.get('farbias') : 0,
  FORCE: PQ.get('farforce') || '',   // 'far' / 'full': every tile draws that copy (a test at one camera)
  SCALE: 0,                   // (a test) not 0: draw as if the canvas's adaptive scale were this
  // In motion the line is set by ONE scale, not by the scale the canvas has at that moment: the two fed each other (a higher scale drew
  // more full models, which made frames slower, which lowered the scale again: measured 2026-11-11, 22 canvas resizes in one flight).
  MOTION_SCALE: 0.5,
};
// The far copy's material (model 3). Its one picture holds, per texel, the two things a far pixel is made of: rgb = the colour of the
// texel's BRIGHT part (wall, roof), and 1 - alpha = the share of the texel that is DARK (panes, dark panels). Both are plain averages,
// so the mip maps filter them exactly. The dark part's own colour and mirror are one value a face (vertex attributes _gloss: mirror
// strength rgb + mirror roughness; _gloss2: smooth share + the square root of the dark colour), from scripts/v2/far_coat.py.
function farMaterial(material) {
  if (!material || material.userData.v2Far) return;
  material.userData.v2Far = true;
  if (material.map) { material.map.anisotropy = FAR.ANISOTROPY; material.map.needsUpdate = true; }
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 _gloss;\nattribute vec4 _gloss2;\nvarying vec4 vFarGloss;\nvarying vec4 vFarDark;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFarGloss = _gloss;\nvFarDark = _gloss2;');
    if (FAR.MIP_BIAS) sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', THREE.ShaderChunk.map_fragment.replace('texture2D( map, vMapUv, v2LodBias )', 'texture2D( map, vMapUv, v2LodBias + ' + FAR.MIP_BIAS.toFixed(3) + ' )'));
    // A texel of the far copy holds two things at once: its BRIGHT part (wall, roof: the picture's colour) and its DARK part (panes,
    // dark panels: 1 - alpha is its share; its colour and its mirror are one value a face, _gloss / _gloss2). They go to the screen
    // APART and are mixed there. Why: the screen clips bright light (LOOK.TONE_MAPPING), and a white wall in the sun is over the clip. Lit
    // as one mixed colour, a texel that is half dark pane was still over the clip and drew white: the window rows washed out of every
    // pale tower (measured 2026-11-11 against the full models drawn with 9 samples a pixel). The full model's own pixels clip the wall
    // and the pane each by itself; so does this.
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec4 vFarGloss;\nvarying vec4 vFarDark;')
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
  float v2d = 0.0; vec3 v2bright = vec3(0.0), v2mirror = vec3(0.0);
  #ifdef USE_MAP
    v2d = 1.0 - sampledDiffuseColor.a;                         // the dark share of this texel
    v2bright = diffuseColor.rgb;                               // the colour of its bright part
    material.diffuseContribution = vec3(1.0);                  // the light is gathered for a white surface; each part takes its own colour below
    material.metalness = 0.0;
    material.specularColor = vec3(0.04); material.specularColorBlended = material.specularColor; material.specularF90 = 1.0;
    material.roughness = min(${FAR.WALL_ROUGHNESS.toFixed(3)} + geometryRoughness, 1.0);   // the bright part's soft sheen of the sky
  #endif`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
  #if defined( USE_ENVMAP ) && defined( USE_MAP )
  if (v2d > 0.002 && vFarDark.x > 0.004) {                     // (most texels are plain wall or roof: no second look at the sky for them)
    float v2nv = saturate(dot(geometryNormal, geometryViewDir));
    vec3 v2F = vFarGloss.rgb + max(vec3(vFarDark.x) - vFarGloss.rgb, 0.0) * pow(1.0 - v2nv, 5.0);   // the dark part's mirror: its strength straight on, its smooth share at a low angle
    v2mirror = v2F * getIBLRadiance(geometryViewDir, geometryNormal, max(vFarGloss.a, 0.0525));
  }
  #endif`)
      .replace('#include <tonemapping_fragment>', `
  #ifdef USE_MAP
  { vec3 v2E = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
    vec3 v2w = v2E * v2bright + reflectedLight.directSpecular + reflectedLight.indirectSpecular;
    vec3 v2p = v2E * vFarDark.yzw * vFarDark.yzw + v2mirror;   // (the dark colour is stored as its square root: fine steps near black)
    #if defined( TONE_MAPPING )
      gl_FragColor.rgb = mix(clamp(toneMapping(v2w), 0.0, 1.0), clamp(toneMapping(v2p), 0.0, 1.0), v2d);
    #else
      gl_FragColor.rgb = mix(v2w, v2p, v2d);
    #endif
  }
  #else
  #include <tonemapping_fragment>
  #endif`);
  };
  const key = material.customProgramCacheKey ? material.customProgramCacheKey.bind(material) : () => '';
  material.customProgramCacheKey = () => key() + '|v2-far3' + FAR.MIP_BIAS;
  material.needsUpdate = true;
}
const PHOTO_ANISO_Q = PQ.has('photoaniso') ? +PQ.get('photoaniso') : null, PHOTO_BIAS_Q = PQ.has('photobias') ? +PQ.get('photobias') : null;
function photoTextures(material) {
  const u = material && material.userData;
  if (!u || !u.photo_material || u.v2Photo) return;
  u.v2Photo = true;
  const aniso = PHOTO_ANISO_Q ?? (+u.v2_photo_aniso || 1), bias = PHOTO_BIAS_Q ?? (+u.v2_photo_bias || 0);
  for (const t of [material.map, material.normalMap]) if (t && aniso > 1) { t.anisotropy = aniso; t.needsUpdate = true; }
  if (!bias || !material.map) return;
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>',
      THREE.ShaderChunk.map_fragment.replace('texture2D( map, vMapUv, v2LodBias )', 'texture2D( map, vMapUv, v2LodBias + ' + bias.toFixed(3) + ' )'));
  };
  const key = material.customProgramCacheKey ? material.customProgramCacheKey.bind(material) : () => '';
  material.customProgramCacheKey = () => key() + '|v2-pbias' + bias;
  material.needsUpdate = true;
}
// Brick mip chain (v2/brick-mips.js, rule 15): every photo brick texture (a photo material whose name says brick) gets its own
// mip levels in which the staggered head joints are removed before they are small enough to fold into a diagonal cross-hatch,
// then the courses, then one even tone. Made here from the texture the tile already carries: no extra download, no tile rebuild.
// The albedo's measured course is used for its normal map too. Opt-in per building: BRICK_MIPS_SLUGS in look.js.
const BRICK_MIPS_Q = PQ.has('brickmips') ? PQ.get('brickmips') !== '0' : null;   // null: the opt-in list decides (look.js)
// ?brickjoint=FULL,NONE / ?brickcourse=FULL,NONE override the thresholds of v2/brick-mips.js (texels at a level) for an A/B
const BRICK_P = { ...BRICK_MIPS };
for (const [q, a, b] of [['brickjoint', 'JOINT_FULL', 'JOINT_NONE'], ['brickcourse', 'COURSE_FULL', 'COURSE_NONE']]) if (PQ.has(q)) [BRICK_P[a], BRICK_P[b]] = PQ.get(q).split(',').map(Number);
const brickSeen = new WeakSet();
function brickMips(material, optedIn) {
  if (!(BRICK_MIPS_Q ?? optedIn) || !material || !material.userData || !material.userData.photo_material || !/brick/i.test(material.name || '')) return;
  let periods = null;
  for (const t of [material.map, material.normalMap]) {
    const img = t && t.image; if (!img || !img.width || brickSeen.has(t)) continue;
    brickSeen.add(t);
    try {
      const w = img.width, h = img.height, cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
      const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(img, 0, 0);
      const chain = brickMipChain(cx.getImageData(0, 0, w, h).data, w, h, { linear: t !== material.map, periods, P: BRICK_P });
      if (!chain) continue;
      periods ||= chain.periods;
      t.mipmaps = chain.map((l) => new ImageData(l.data, l.width, l.height));
      t.generateMipmaps = false; t.needsUpdate = true;
    } catch (e) { console.warn('brick mips skipped', material.name, e); }
  }
}
const FADE_K = [0.25, 0.6];     // fade from size x K[0] to size x K[1] metres per pixel
function coverageFade(material) {
  const to = material && material.userData && material.userData.v2_fade_to;
  if (!to || material.userData.v2CoverageFade) return;
  material.userData.v2CoverageFade = true;
  const size = +material.userData.v2_fade_m || 0.3;
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    sh.uniforms.uV2FadeTo = { value: new THREE.Vector3(...to) }; sh.uniforms.uV2FadeM = { value: new THREE.Vector2(size * FADE_K[0], size * FADE_K[1]) };
    sh.uniforms.uV2CScale = AO_SCALE;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uV2FadeTo;\nuniform vec2 uV2FadeM;\nuniform float uV2CScale;')
      .replace('#include <color_fragment>', `#include <color_fragment>
  {
    float v2cpx = max(length(dFdx(vViewPosition)), length(dFdy(vViewPosition))) * uV2CScale;
    diffuseColor.rgb = mix(diffuseColor.rgb, uV2FadeTo, smoothstep(uV2FadeM.x, uV2FadeM.y, v2cpx));
  }`);
  };
  const key = material.customProgramCacheKey ? material.customProgramCacheKey.bind(material) : () => '';
  material.customProgramCacheKey = () => key() + '|v2-cfade';
  material.needsUpdate = true;
}
// The models' shadow-map depth, pushed away from the sun by their slope (LOOK.SHADOW_SLOPE_BIAS): no self-shadow stripes on lit faces.
// (three.js flips the factor's sign itself under a reversed depth buffer.)
const shadowDepth = LOOK.SHADOW_SLOPE_BIAS > 0
  ? new THREE.MeshDepthMaterial({ polygonOffset: true, polygonOffsetFactor: LOOK.SHADOW_SLOPE_BIAS, polygonOffsetUnits: 0 }) : null;

export class TileStreamer {
  constructor({ scene, camera, manifestUrl, onShow, onHide, onChange, onFade, onAnimate, prepare }) {
    this.scene = scene; this.camera = camera; this.url = manifestUrl;
    this.prepare = prepare || (() => {});
    this.onShow = onShow || (() => {}); this.onHide = onHide || (() => {}); this.onChange = onChange || (() => {});
    this.onFade = onFade || (() => {});          // (mapIds, k): the plain extrusions of these ids at k of the way into the haze
    this.onAnimate = onAnimate || (() => {});    // a fade moved: draw a frame
    this.group = new THREE.Group(); this.group.name = 'blender-tiles';
    scene.add(this.group);
    this.tiles = new Map();          // id -> state
    this.fading = new Set();         // states with a fade running
    this.active = 0;
    this.loader = new GLTFLoader();
    try { MeshoptDecoder.useWorkers && MeshoptDecoder.useWorkers(2); } catch (e) {}
    this.loader.setMeshoptDecoder(MeshoptDecoder);
    this.last = 0;
    this.stats = { loaded: 0, aborted: 0, discarded: 0, disposed: 0, failed: 0, bytes: 0 };
    this.frustum = new THREE.Frustum(); this.m = new THREE.Matrix4(); this.box = new THREE.Box3();
    this.instant = false;            // true: tiles appear at once (pictures, the verify scripts' settled views)
    this.far = FAR;                  // (the verify scripts turn FORCE inside the page: one load, both copies)
    this.rush = false;               // main.js: the loading screen is up (TILES.RUSH_DECODES)
  }

  async load() {
    const r = await fetch(this.url, { cache: 'no-cache' });
    if (!r.ok) throw new Error('manifest ' + r.status);
    this.manifest = await r.json();
    // tile paths in the manifest are relative to the APP (v2/), as in the contract: "lod0": "tiles/t_i_j.glb"
    this.base = new URL('./', import.meta.url).href;
    for (const t of this.manifest.tiles || []) {
      if (!t.lod0) continue;                                   // a tile with no full model is not drawn (the extrusions stay)
      const mapIds = [];
      for (const slug of t.buildings || []) { const b = this.manifest.buildings?.[slug]; if (b?.map_ids) mapIds.push(...b.map_ids.map(String)); }
      this.tiles.set(t.id, { def: t, mapIds, want: null, have: null, obj: null, full: null, far: null, jobs: { lod0: null, far: null }, fade: null, fadeU: { value: 0 }, coat: null, line: Infinity, d: 0 });
    }
    if (FAR.ON) {
      try {
        const c = await fetch(new URL(FAR.INDEX, this.base).href, { cache: 'no-cache' }).then((x) => (x.ok ? x.json() : null));
        // a far copy is drawn only for the tile it was made from (the manifest's byte count of the full model): a tile rebuilt since
        // then draws its full model until scripts/v2/far_coat_all.py has run again
        for (const [id, v] of Object.entries(c || {})) { const s = this.tiles.get(id); if (s && v && v.file && v.model === FAR.MODEL && (!v.tile_bytes || !s.def.bytes || v.tile_bytes === s.def.bytes[0])) s.coat = v; else if (s && v) this.stats.staleCoats = (this.stats.staleCoats || 0) + 1; }
      } catch (e) { console.info('[v2 tiles] no far copies:', e.message); }
    }
    return this.manifest;
  }

  // Which copies of which tiles should be in memory now, from the camera position.
  //   want = 'lod0': the full model (and its far copy too, when it has one: in motion the far copy draws wherever its texel is
  //                  already smaller than the canvas's coarser pixel); 'far': the far copy only; null: nothing.
  plan() {
    const cam = this.camera.position;
    // metres per FULL-resolution screen pixel, per metre of distance
    const mpp = FAR.ON ? 2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) / (innerHeight * Math.min(devicePixelRatio || 1, 2)) : 0;
    this.camera.updateMatrixWorld();
    this.m.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.m);
    const order = [];
    for (const s of this.tiles.values()) {
      const [x0, z0, x1, z1] = s.def.bounds;
      const dx = Math.max(x0 - cam.x, 0, cam.x - x1), dz = Math.max(z0 - cam.z, 0, cam.z - z1);
      const d = Math.hypot(dx, dz, Math.max(0, cam.y - TILES.TILE_TOP_M));
      const cur = s.full || s.far || s.want;
      let want = d <= (cur ? TILES.UNLOAD_DISTANCE_M : TILES.LOAD_DISTANCE_M) ? 'lod0' : null;
      if (want && s.coat) {
        s.line = s.coat.texel_m * FAR.PX / mpp;                // standing still (full resolution), the far copy draws beyond this
        // the full model is in memory out to the line (and stays until a little past it, so it is not loaded and dropped at the line)
        if (FAR.FORCE ? FAR.FORCE === 'far' : d > s.line * (s.full || s.jobs.lod0 ? 1 / FAR.BACK : 1)) want = 'far';
      }
      this.box.min.set(x0, 0, z0); this.box.max.set(x1, TILES.TILE_TOP_M, z1);
      s.want = want; s.d = d; s.inView = this.frustum.intersectsBox(this.box);
      this.note(s);
      order.push(s);
    }
    return order;
  }
  // have = what main.js's loading screen reads: the copy this tile wants is in ('lod0' / 'far'), or null while it is not
  note(s) {
    s.have = s.want === 'lod0' ? (s.full ? 'lod0' : null) : s.want === 'far' ? (s.far ? 'far' : s.full ? 'lod0' : null) : (s.full ? 'lod0' : s.far ? 'far' : null);
    s.obj = s.full || s.far || null;                           // (main.js: the object its covers and the camera's collision are made from)
  }
  wanted(s, level) { return level === 'far' ? !!(s.want && s.coat) : s.want === 'lod0'; }

  // Which copy of each tile DRAWS, every frame (no loading: both are in memory). The far copy draws when the full model is not
  // there, or when one texel of it is smaller than a pixel of the canvas AS IT IS NOW (FAR.PX): the canvas has fewer pixels in
  // motion (main.js adaptive resolution, AO_SCALE), so in motion the far copy reaches nearer; standing still the full model is back.
  show() {
    let changed = false;
    for (const s of this.tiles.values()) {
      if (!s.far) { if (s.full && !s.full.visible) { s.full.visible = true; changed = true; } continue; }
      const far = !s.full || (FAR.FORCE ? FAR.FORCE === 'far' : s.d > s.line * (FAR.SCALE || (MOTION.scale < 0.999 ? FAR.MOTION_SCALE : 1)) * (s.far.visible && s.full.visible === false ? FAR.BACK : 1));
      if (s.far.visible !== far) { s.far.visible = far; changed = true; }
      if (s.full && s.full.visible === far) { s.full.visible = !far; changed = true; }
    }
    if (changed) this.onChange(this);
  }

  update(now = performance.now()) {
    if (this.fading.size) this.stepFades(now);
    if (FAR.ON && this.manifest) this.show();
    if (!this.manifest || now - this.last < TILES.UPDATE_EVERY_MS) return;
    this.last = now;
    const all = this.plan();
    this.plannedFor = this.camera.matrixWorld.elements.join(',');
    for (const s of all) {
      // cancel loads that are no longer wanted, drop copies that are no longer wanted
      for (const level of LEVELS) if (s.jobs[level] && !this.wanted(s, level)) { const j = s.jobs[level]; j.ctrl.abort(); j.stale = true; s.jobs[level] = null; this.active--; this.stats.aborted++; }
      if (!s.want) { if (s.full || s.far) this.drop(s); continue; }
      if (s.full && s.far && !this.wanted(s, 'lod0')) this.dropFull(s);     // past the line: the far copy alone
    }
    // queue: in view first, a tile with nothing on screen before one that only adds a copy, then nearest; the far copy (small) before the full model
    const queue = [];
    for (const s of all) for (const level of LEVELS) if (this.wanted(s, level) && !(level === 'far' ? s.far : s.full) && !s.jobs[level] && ((s.failed || {})[level] || 0) < TILES.MAX_TRIES) queue.push({ s, level });
    queue.sort((a, b) => (b.s.inView - a.s.inView) || (!!(a.s.full || a.s.far) - !!(b.s.full || b.s.far)) || ((a.level === 'far' ? 0 : 1) - (b.level === 'far' ? 0 : 1)) || (a.s.d - b.s.d));
    while (this.active < (this.rush ? TILES.RUSH_DECODES : TILES.MAX_DECODES) && queue.length) { const q = queue.shift(); this.start(q.s, q.level); }
  }

  start(s, level) {
    const ctrl = new AbortController();
    const job = { ctrl, stale: false, level };
    s.jobs[level] = job; this.active++;
    const url = new URL(level === 'far' ? s.coat.file : s.def.lod0, this.base).href;
    (async () => {
      try {
        const r = await fetch(url, { signal: ctrl.signal });
        if (!r.ok) throw new Error(url + ' ' + r.status);
        const buf = await r.arrayBuffer();
        if (job.stale) return;
        const gltf = await this.loader.parseAsync(buf, url.replace(/[^/]*$/, ''));
        this.stats.bytes += buf.byteLength;
        if (job.stale) { disposeObject(gltf.scene); this.stats.discarded++; return; }
        const obj = gltf.scene;
        obj.name = s.def.id + (level === 'far' ? ' far' : '');
        const fade = s.fadeU, brickOptIn = (s.def.buildings || []).some((b) => BRICK_MIPS_SLUGS.has(b));
        obj.traverse((o) => {
          if (!o.isMesh) return;
          o.castShadow = true; o.receiveShadow = true; o.frustumCulled = true;
          if (shadowDepth) o.customDepthMaterial = shadowDepth;
          const ao = LOOK.AO.ON && !!o.geometry.attributes._ao && o.geometry.attributes._ao.itemSize === 2;
          if (!ao && o.geometry.attributes._ao) o.geometry.deleteAttribute('_ao');
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) { if (level === 'far') farMaterial(m); photoTextures(m); brickMips(m, brickOptIn); coverageFade(m); fadeable(m, fade, ao); }
        });
        obj.userData.fade = fade;
        this.prepare(obj, s.def, s);   // (s: main.js adds to s.mapIds the plain extrusions this model stands over, covers.js)
        this.stats.loaded++;
        const first = !s.full && !s.far;
        if (level === 'far') s.far = obj; else s.full = obj;
        this.note(s);
        if (first) { this.appear(s, performance.now()); return; }
        // the other copy of a tile that is already there: no fade of its own (in the middle of the tile's arrival fade it joins it)
        obj.visible = false;
        if (!(s.fade && s.fade.phase === 'out')) { this.group.add(obj); this.show(); this.onAnimate(); }
      } catch (e) {
        if (e.name !== 'AbortError') { this.stats.failed++; console.warn('[v2 tiles]', s.def.id, level, e.message); (s.failed ||= {})[level] = (s.failed[level] || 0) + 1; }
      } finally {
        if (s.jobs[level] === job) { s.jobs[level] = null; this.active--; }
      }
    })();
  }
  add(s) { for (const o of [s.full, s.far]) if (o && !o.parent) this.group.add(o); if (FAR.ON) this.show(); }

  // A tile has arrived: its extrusions fade out into the haze (OUT_MS), then the model replaces them and fades in (IN_MS).
  appear(s, now) {
    if (this.instant || !(TILES.FADE.OUT_MS + TILES.FADE.IN_MS > 0)) {
      s.fadeU.value = 0;
      this.add(s); this.onShow(s.mapIds, s.def); this.onChange(this);
      return;
    }
    s.fade = { phase: 'out', t0: now };
    this.fading.add(s);
    this.stepFades(now);
  }

  stepFades(now) {
    for (const s of this.fading) {
      const F = s.fade;
      if (!F || !(s.full || s.far)) { this.fading.delete(s); continue; }
      if (F.phase === 'out') {
        const k = TILES.FADE.OUT_MS > 0 ? Math.min(1, (now - F.t0) / TILES.FADE.OUT_MS) : 1;
        this.onFade(s.mapIds, smooth(k));
        if (k < 1 && !this.instant) continue;
        // swap: the extrusions are fully in the haze; the model takes their place, fully in the haze, and comes out of it
        s.fadeU.value = 1;
        this.add(s);
        this.onShow(s.mapIds, s.def);
        this.onFade(s.mapIds, 0);                 // (hidden now; reset so they come back unfaded if the tile is dropped)
        this.onChange(this);
        F.phase = 'in'; F.t0 = now;
      } else {
        const k = TILES.FADE.IN_MS > 0 ? Math.min(1, (now - F.t0) / TILES.FADE.IN_MS) : 1;
        s.fadeU.value = this.instant ? 0 : 1 - smooth(k);
        if (k >= 1 || this.instant) { s.fadeU.value = 0; s.fade = null; this.fading.delete(s); }
      }
    }
    this.onAnimate();
  }

  // Finish every running fade at once (a settled picture, or the loading screen lifting with everything in place).
  settle() {
    const was = this.instant; this.instant = true;
    this.stepFades(performance.now()); this.stepFades(performance.now());
    this.instant = was;
  }

  // the full model of a tile whose far copy stays (the camera went past the line): out of memory
  dropFull(s) {
    if (s.fade && s.fade.phase === 'out') return;              // (still arriving: leave it, the next plan sees it again)
    this.group.remove(s.full); disposeObject(s.full); s.full = null;
    this.stats.disposed++;
    this.note(s); this.show(); this.onChange(this);
  }
  drop(s) {
    const shown = !(s.fade && s.fade.phase === 'out');
    if (s.fade) { if (!shown) this.onFade(s.mapIds, 0); s.fade = null; this.fading.delete(s); }
    for (const o of [s.full, s.far]) if (o) { this.group.remove(o); disposeObject(o); this.stats.disposed++; }
    s.full = s.far = null; this.note(s);
    if (shown) { this.onHide(s.mapIds, s.def); this.onChange(this); }
  }

  summary() {
    let lod0 = 0, lod1 = 0, loading = 0, fading = 0, wanting = 0;
    for (const s of this.tiles.values()) {
      if ((s.full || s.far) && !(s.fade && s.fade.phase === 'out')) { if (s.far && s.far.visible && s.far.parent) lod1++; else lod0++; }
      for (const level of LEVELS) { if (s.jobs[level]) loading++; if (this.wanted(s, level) && !(level === 'far' ? s.far : s.full) && ((s.failed || {})[level] || 0) < TILES.MAX_TRIES) wanting++; }
      if (s.fade) fading++;
    }
    // lod1 = tiles drawing their far copy now (0 with ?far=0); planned = the plan ran since the camera last moved
    const cam = this.camera.matrixWorld.elements.join(',');
    return { tiles: this.tiles.size, lod0, lod1, loading, fading, wanting, planned: this.plannedFor === cam, ...this.stats };
  }
}

export function disposeObject(root) {
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) {
      for (const k in m) { const v = m[k]; if (v && v.isTexture) v.dispose(); }
      m.dispose();
    }
  });
}
