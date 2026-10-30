// v2 ground near the camera (owner, 2026-10-27: the aerial at street level is "glue"): the ground in front of the buildings drawn as
// concrete, brick / stone pavers, lawn, planting beds and asphalt, with textures cut from the owner's photographs, instead of the
// City's aerial photograph. Far away the aerial stays. Values: street-look.js GROUND_NEAR_LOOK (rule 11); ?groundnear=0 turns it off.
//
// How: the inventory (v2/data/ground/near.json, scripts/v2/ground_near.py) is rasterised with antialiasing into a class window
// around the camera (RGBA: R pavers, G lawn, B bed, RGB all = asphalt, A = mapped; mapped with no colour = concrete). The aerial
// tiles' own shader (ground.js) reads the window, decodes the five surfaces, takes ground the inventory does not name from the
// aerial's colour, and crossfades to the aerial by distance. No new geometry and no new draw: the aerial quads are the ground.
//
// Rule 15: every texture is mipmapped and anisotropic and sampled with the true ground-space gradients (textureGrad), so the paver
// pattern goes to its mean colour before it is smaller than a pixel; the class edges are the coverage's own antialiasing.
import { GROUND_NEAR_LOOK as GN } from './street-look.js';

const params = new URLSearchParams(location.search);
const DATA = new URL('./data/ground/near.json', import.meta.url).href;
const MAT = new URL('./data/materials/', import.meta.url).href;
const SURF = ['CONCRETE', 'PAVERS', 'GRASS', 'BED', 'ASPHALT'];
const FILL = { 1: 'rgb(255,0,0)', 2: 'rgb(0,255,0)', 3: 'rgb(0,0,255)', 4: 'rgb(0,0,0)', 5: 'rgb(255,255,255)' };

export function groundNearEnabled() { return GN.ON && params.get('groundnear') !== '0'; }

// The GLSL the aerial shader gets (ground.js patch): declarations, and the code that turns the aerial albedo `aer` into the
// drawn ground's albedo near the camera. Needs: vGroundXZ (world xz), vViewPosition, vMapUv, map, mk (the shadow mask sample).
export const GN_DECL = `
  uniform float gnOn; uniform sampler2D gnClass; uniform vec4 gnBox; uniform vec2 gnFade; uniform float gnEdge;
  uniform sampler2D gnTex0, gnTex1, gnTex2, gnTex3; uniform vec3 gnAlb[5]; uniform vec2 gnTile[5]; uniform float gnMean[5];
  uniform float gnContrast[5]; uniform vec2 gnSharp; uniform float gnVary, gnVaryM, gnHintBlur, gnShadowLight;
  uniform vec2 gnGreen, gnDark;
  float gnHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float gnNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(gnHash(i), gnHash(i + vec2(1, 0)), f.x), mix(gnHash(i + vec2(0, 1)), gnHash(i + vec2(1, 1)), f.x), f.y); }
  vec3 gnSample(sampler2D t, int k, vec2 xz, vec2 dx, vec2 dy) {
    vec2 s = 1.0 / gnTile[k];
    vec3 c = textureGrad(t, xz * s, dx * s, dy * s).rgb / gnMean[k];
    return gnAlb[k] * mix(vec3(1.0), c, gnContrast[k]);
  }`;
export const GN_MIX = `
  {
    vec2 gdx = dFdx(vGroundXZ), gdy = dFdy(vGroundXZ);
    vec2 cuv = (vGroundXZ - gnBox.xy) * gnBox.zw;
    float gdist = length(vViewPosition);
    vec2 ein = min(cuv, 1.0 - cuv) / (gnBox.zw * gnEdge);
    float gw = gnOn * (1.0 - smoothstep(gnFade.x, gnFade.y, gdist)) * clamp(min(ein.x, ein.y), 0.0, 1.0);
    vec2 mdx = dFdx(vMapUv) * gnHintBlur, mdy = dFdy(vMapUv) * gnHintBlur;
    if (gw > 0.002) {
      vec4 c = textureGrad(gnClass, cuv, gdx * gnBox.zw, gdy * gnBox.zw);
      float wa = min(c.r, min(c.g, c.b));
      float wp = c.r - wa, wg = c.g - wa, wb = c.b - wa, wc = max(c.a - wa - wp - wg - wb, 0.0), wu = 1.0 - c.a;
      // the aerial's hint where the inventory names nothing: a ~2 m blur of the photograph, shadow-lifted
      vec3 lo = textureGrad(map, vMapUv, mdx, mdy).rgb;
      float ll = dot(lo, vec3(0.2126, 0.7152, 0.0722));
      lo *= mix(vec3(1.0), gWarm * gLift, mk.r * (1.0 - smoothstep(gDark.x, gDark.y, ll)));
      ll = dot(lo, vec3(0.2126, 0.7152, 0.0722));
      float hg = smoothstep(gnGreen.x, gnGreen.y, (lo.g - max(lo.r, lo.b)) / max(ll, 1e-3));
      float hd = (1.0 - smoothstep(gnDark.x, gnDark.y, ll)) * (1.0 - hg) * (1.0 - mk.r * gnShadowLight);
      wg += wu * hg; wa += wu * hd; wc += wu * max(1.0 - hg - hd, 0.0);
      // sharpen the coverage toward the mapped edge (the filter has already antialiased it)
      vec4 w4 = smoothstep(gnSharp.x, gnSharp.y, vec4(wp, wg, wb, wa)); float w5 = smoothstep(gnSharp.x, gnSharp.y, wc);
      float sum = w4.x + w4.y + w4.z + w4.w + w5;
      if (sum < 1e-3) { w5 = 1.0; sum = 1.0; }
      vec2 xz = vGroundXZ;
      vec3 g = vec3(0.0);
      if (w5 > 0.0) g += w5 * gnSample(gnTex0, 0, xz, gdx, gdy);
      if (w4.x > 0.0) g += w4.x * gnSample(gnTex1, 1, xz, gdx, gdy);
      if (w4.y > 0.0) g += w4.y * gnSample(gnTex2, 2, xz, gdx, gdy);
      if (w4.z > 0.0) g += w4.z * gnSample(gnTex3, 3, xz, gdx, gdy);
      if (w4.w > 0.0) g += w4.w * gnSample(gnTex0, 4, xz + 37.0, gdx, gdy);
      g /= sum;
      g *= 1.0 + gnVary * (gnNoise(xz / gnVaryM) + 0.5 * gnNoise(xz / (gnVaryM * 0.37)) - 0.75);
      aer = mix(aer, g, gw);
    }
  }`;

// Uniforms (merged into the aerial's) and the per-frame window update. Returns null when off.
export function installGroundNear({ THREE, scene, camera, renderer, redraw, phone = false }) {
  if (!groundNearEnabled()) return null;
  const NPX = phone ? GN.WINDOW_PX_PHONE : GN.WINDOW_PX, RES = phone ? GN.WINDOW_RES_M_PHONE : GN.WINDOW_RES_M;
  const SIZE = NPX * RES, FADE = phone ? GN.FADE_PHONE : GN.FADE;
  const SLACK = Math.max(4, SIZE / 2 - FADE[1] - GN.WINDOW_EDGE_M);     // the camera may move this far before the window is redrawn
  const ANISO = Math.min(16, renderer.capabilities.getMaxAnisotropy());
  const lin = (hex) => new THREE.Color(hex);
  const loadTex = (file) => {
    const t = new THREE.TextureLoader().load(MAT + file, () => redraw());
    t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = ANISO;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true;
    return t;
  };
  const texByFile = new Map();
  const tex = (f) => texByFile.get(f) || texByFile.set(f, loadTex(f)).get(f);
  const data = new Uint8Array(NPX * NPX * 4);
  const cls = new THREE.DataTexture(data, NPX, NPX, THREE.RGBAFormat);
  cls.flipY = false; cls.generateMipmaps = true; cls.minFilter = THREE.LinearMipmapLinearFilter; cls.magFilter = THREE.LinearFilter;
  cls.colorSpace = THREE.NoColorSpace; cls.anisotropy = ANISO; cls.needsUpdate = true;
  const S = SURF.map((k) => GN[k]);
  const U = {
    gnOn: { value: 0 }, gnClass: { value: cls }, gnBox: { value: new THREE.Vector4(0, 0, 1 / SIZE, 1 / SIZE) },
    gnFade: { value: new THREE.Vector2(...FADE) }, gnEdge: { value: GN.WINDOW_EDGE_M },
    gnTex0: { value: tex(GN.CONCRETE.tex) }, gnTex1: { value: tex(GN.PAVERS.tex) }, gnTex2: { value: tex(GN.GRASS.tex) }, gnTex3: { value: tex(GN.BED.tex) },
    gnAlb: { value: S.map((s) => lin(s.color)) }, gnTile: { value: S.map((s) => new THREE.Vector2(...s.tile)) },
    gnMean: { value: S.map((s) => s.texMean) },
    gnContrast: { value: ['concrete', 'pavers', 'grass', 'bed', 'asphalt'].map((k) => GN.TEX_CONTRAST[k]) },
    gnSharp: { value: new THREE.Vector2(...GN.EDGE_SHARPEN) }, gnVary: { value: GN.VARIATION }, gnVaryM: { value: GN.VARIATION_M },
    gnHintBlur: { value: GN.HINT_BLUR }, gnGreen: { value: new THREE.Vector2(...GN.HINT_GREEN) }, gnDark: { value: new THREE.Vector2(...GN.HINT_DARK) },
    gnShadowLight: { value: GN.HINT_SHADOW_LIGHT },
  };

  // ── the inventory, bucketed ──
  let feats = null; const buckets = new Map(); const B = GN.BUCKET_M;
  fetch(DATA).then((r) => r.json()).then((d) => {
    const u = d.unit_m || 0.1;
    feats = d.f.map((f, i) => {
      const rings = f.slice(1).map((r) => Float32Array.from(r, (v) => v * u));
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      const o = rings[0]; for (let k = 0; k < o.length; k += 2) { x0 = Math.min(x0, o[k]); x1 = Math.max(x1, o[k]); z0 = Math.min(z0, o[k + 1]); z1 = Math.max(z1, o[k + 1]); }
      for (let bx = Math.floor(x0 / B); bx <= Math.floor(x1 / B); bx++) for (let bz = Math.floor(z0 / B); bz <= Math.floor(z1 / B); bz++) {
        const k = bx + ',' + bz; (buckets.get(k) || buckets.set(k, []).get(k)).push(i);
      }
      return { c: f[0], rings, x0, x1, z0, z1 };
    });
    stats.features = feats.length; lastC = null; redraw();
  }).catch((e) => { stats.error = e.message; console.warn('[v2 ground-near]', e.message); });

  // ── the class window ──
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = NPX;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let lastC = null; const stats = { features: 0, rasters: 0, lastMs: 0, window: null };
  function raster(cx, cz) {
    const t0 = performance.now();
    const x0 = cx - SIZE / 2, z0 = cz - SIZE / 2;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, NPX, NPX);
    ctx.setTransform(1 / RES, 0, 0, 1 / RES, -x0 / RES, -z0 / RES);
    const seen = new Set(), list = [];
    for (let bx = Math.floor(x0 / B); bx <= Math.floor((x0 + SIZE) / B); bx++) for (let bz = Math.floor(z0 / B); bz <= Math.floor((z0 + SIZE) / B); bz++)
      for (const i of buckets.get(bx + ',' + bz) || []) if (!seen.has(i)) { seen.add(i); list.push(i); }
    list.sort((a, b) => a - b);                   // painter's order of the bake
    for (const i of list) {
      const f = feats[i];
      ctx.beginPath();
      for (const r of f.rings) { ctx.moveTo(r[0], r[1]); for (let k = 2; k < r.length; k += 2) ctx.lineTo(r[k], r[k + 1]); ctx.closePath(); }
      ctx.fillStyle = FILL[f.c]; ctx.fill('evenodd');
    }
    data.set(ctx.getImageData(0, 0, NPX, NPX).data);
    cls.needsUpdate = true;
    U.gnBox.value.set(x0, z0, 1 / SIZE, 1 / SIZE);
    stats.rasters++; stats.lastMs = +(performance.now() - t0).toFixed(1); stats.window = [x0, z0, SIZE]; stats.drawn = list.length;
  }
  const prev = scene.onBeforeRender;
  scene.onBeforeRender = function (r, s, c, t) {
    prev.call(this, r, s, c, t);
    if (t || c !== camera) return;
    const low = c.position.y < GN.MAX_CAMERA_Y_M;
    U.gnOn.value = low && feats && lastC ? 1 : 0;
    if (!low || !feats) return;
    if (!lastC || Math.hypot(c.position.x - lastC[0], c.position.z - lastC[1]) > SLACK) {
      lastC = [Math.round(c.position.x / 8) * 8, Math.round(c.position.z / 8) * 8];
      raster(lastC[0], lastC[1]);
      U.gnOn.value = 1;
    }
  };
  const api = { uniforms: U, stats: () => ({ ...stats, on: U.gnOn.value, slack: SLACK }) };
  window.__v2groundNear = api;
  return api;
}
