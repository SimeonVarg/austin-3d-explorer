// v2 ground near the camera (owner, 2026-10-27: the aerial at street level is "glue"): the ground in front of the buildings drawn as
// concrete, brick / stone pavers, lawn, planting beds and asphalt, with textures cut from the owner's photographs, instead of the
// City's aerial photograph. Far away the aerial stays. Values: street-look.js GROUND_NEAR_LOOK (rule 11); ?groundnear=0 turns it off.
//
// How: the inventory (v2/data/ground/near/, scripts/v2/ground_near.py; one file per 128 m cell, fetched only around a low camera, so
// a phone never holds the whole city's ground) is rasterised with antialiasing into a class window
// around the camera (RGBA: R pavers, G lawn, B bed, RGB all = asphalt, A = mapped; mapped with no colour = concrete). The aerial
// tiles' own shader (ground.js) reads the window, decodes the five surfaces, takes ground the inventory does not name from the
// aerial's colour, and crossfades to the aerial by distance. No new geometry and no new draw: the aerial quads are the ground.
//
// Rule 15: every texture is mipmapped and anisotropic and sampled with the true ground-space gradients (textureGrad), so the paver
// pattern goes to its mean colour before it is smaller than a pixel; the class edges are the coverage's own antialiasing.
import { GROUND_NEAR_LOOK as GN } from './street-look.js';

const params = new URLSearchParams(location.search);
const DATA = new URL('./data/ground/near/', import.meta.url).href;
const KEEP_CELLS = 64;                         // cells kept in memory (least recently used go first); the window needs at most 16
const MAT = new URL('./data/materials/', import.meta.url).href;
const SURF = ['CONCRETE', 'PAVERS', 'GRASS', 'BED', 'ASPHALT'];
const FILL = { 1: 'rgb(255,0,0)', 2: 'rgb(0,255,0)', 3: 'rgb(0,0,255)', 4: 'rgb(0,0,0)', 5: 'rgb(255,255,255)' };

export function groundNearEnabled() { return GN.ON && params.get('groundnear') !== '0'; }
// ?groundveg=0 leaves out the lawns and beds read off the z19 aerial (scripts/v2/ground_veg.py); window.__v2groundNear.setVeg(bool) flips
// it in place (the shimmer A/B in one page load, scripts/verify/v2-ground-shimmer.mjs)

// The GLSL the aerial shader gets (ground.js patch): declarations, and the code that turns the aerial albedo `aer` into the
// drawn ground's albedo near the camera. Needs: vGroundXZ (world xz), vViewPosition, vMapUv, map, mk (the shadow mask sample).
export const GN_DECL = `
  uniform float gnOn; uniform sampler2D gnClass; uniform vec4 gnBox; uniform vec2 gnFade; uniform float gnEdge;
  uniform sampler2D gnTex0, gnTex1, gnTex2, gnTex3; uniform vec3 gnAlb[5]; uniform vec2 gnTile[5]; uniform float gnMean[5];
  uniform float gnContrast[5]; uniform vec2 gnSharp; uniform float gnVary, gnVaryM, gnHintBlur, gnHintM, gnShadowLight;
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
    if (gw > 0.002) {
      // the aerial's hint is a MAJORITY over gnHintM metres of ground (a fixed ground footprint, not a share of the screen pixel: near
      // the camera that was ~2 cm and every aerial pixel became its own island), and never finer than the old screen-relative blur
      vec2 mdx = dFdx(vMapUv) * gnHintBlur, mdy = dFdy(vMapUv) * gnHintBlur;
      float uvpm = max(length(dFdx(vMapUv)) / max(length(gdx), 1e-5), length(dFdy(vMapUv)) / max(length(gdy), 1e-5)) * gnHintM;
      if (uvpm > max(length(mdx), length(mdy))) { mdx = vec2(uvpm, 0.0); mdy = vec2(0.0, uvpm); }
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
  // the drawn ground waits for its textures: an unloaded texture samples black, and a surface at full texture contrast then draws as
  // a flat dark slab (live look 2026-10-30, the Anna Hiss pavers); a texture that fails draws its surface's flat albedo instead
  let pending = 0;
  const loadTex = (file) => {
    pending++;
    const t = new THREE.TextureLoader().load(MAT + file, () => { pending--; redraw(); }, undefined, () => {
      pending--; const c = document.createElement('canvas'); c.width = c.height = 1; const x = c.getContext('2d');
      x.fillStyle = '#bcbcbc'; x.fillRect(0, 0, 1, 1); t.image = c; t.needsUpdate = true; redraw(); });
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
    gnHintBlur: { value: GN.HINT_BLUR }, gnHintM: { value: GN.HINT_MAJORITY_M }, gnGreen: { value: new THREE.Vector2(...GN.HINT_GREEN) }, gnDark: { value: new THREE.Vector2(...GN.HINT_DARK) },
    gnShadowLight: { value: GN.HINT_SHADOW_LIGHT },
  };

  // ── the inventory, by cell ──
  let index = null, vegOn = params.get('groundveg') !== '0';
  const big = [], cells = new Map();            // key -> { feats, used } | 'loading'
  const parse = (u, rows) => rows.map((f) => {
    const rings = f.slice(2).map((r) => Float32Array.from(r, (v) => v * u));
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    const o = rings[0]; for (let k = 0; k < o.length; k += 2) { x0 = Math.min(x0, o[k]); x1 = Math.max(x1, o[k]); z0 = Math.min(z0, o[k + 1]); z1 = Math.max(z1, o[k + 1]); }
    return { i: f[0], c: f[1], rings, x0, x1, z0, z1 };
  });
  Promise.all([fetch(DATA + 'index.json').then((r) => r.json()), fetch(DATA + 'big.json').then((r) => r.json())]).then(([d, b]) => {
    index = { ...d, has: new Set(d.cells) }; big.push(...parse(d.unit_m || 0.1, b.f));
    stats.features = d.count; dirty = true; redraw();
  }).catch((e) => { stats.error = e.message; console.warn('[v2 ground-near]', e.message); });
  const cellKeys = (x0, z0, size) => {
    const C = index.cell_m, out = [];
    for (let cx = Math.floor(x0 / C); cx <= Math.floor((x0 + size) / C); cx++) for (let cz = Math.floor(z0 / C); cz <= Math.floor((z0 + size) / C); cz++) {
      const k = cx + '_' + cz; if (index.has.has(k)) out.push(k);
    }
    return out;
  };
  let tick = 0, dirty = false;
  function want(keys) {                         // true when every cell is in memory; starts the fetches of the rest
    let ready = true;
    for (const k of keys) {
      const c = cells.get(k);
      if (c && c !== 'loading') { c.used = ++tick; continue; }
      ready = false; if (c) continue;
      cells.set(k, 'loading'); stats.fetches++;
      fetch(DATA + k + '.json').then((r) => r.json()).then((d) => { cells.set(k, { feats: parse(index.unit_m || 0.1, d.f), used: ++tick }); dirty = true; redraw(); })
        .catch((e) => { cells.set(k, { feats: [], used: ++tick }); dirty = true; stats.error = e.message; });
    }
    if (cells.size > KEEP_CELLS) {
      const old = [...cells].filter(([, c]) => c !== 'loading').sort((a, b) => a[1].used - b[1].used).slice(0, cells.size - KEEP_CELLS);
      for (const [k] of old) cells.delete(k);
    }
    stats.cells = cells.size; stats.loading = [...cells.values()].filter((c) => c === 'loading').length;
    return ready;
  }

  // ── the class window ──
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = NPX;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let lastC = null; const stats = { features: 0, rasters: 0, lastMs: 0, window: null, fetches: 0, cells: 0 };
  function raster(cx, cz) {
    const t0 = performance.now();
    const x0 = cx - SIZE / 2, z0 = cz - SIZE / 2;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, NPX, NPX);
    ctx.setTransform(1 / RES, 0, 0, 1 / RES, -x0 / RES, -z0 / RES);
    const seen = new Set(), list = [];
    const add = (f) => { if (seen.has(f.i) || f.x1 < x0 || f.x0 > x0 + SIZE || f.z1 < z0 || f.z0 > z0 + SIZE) return;
      if (!vegOn && f.i >= index.veg[0] && f.i < index.veg[1]) return; seen.add(f.i); list.push(f); };
    big.forEach(add);
    for (const k of cellKeys(x0, z0, SIZE)) { const c = cells.get(k); if (c && c !== 'loading') c.feats.forEach(add); }
    list.sort((a, b) => a.i - b.i);                 // painter's order of the bake
    for (const f of list) {
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
    U.gnOn.value = low && index && lastC && !pending ? 1 : 0;
    if (!low || !index || pending) return;
    if (!lastC || dirty || Math.hypot(c.position.x - lastC[0], c.position.z - lastC[1]) > SLACK) {
      const C = [Math.round(c.position.x / 8) * 8, Math.round(c.position.z / 8) * 8];
      if (!want(cellKeys(C[0] - SIZE / 2, C[1] - SIZE / 2, SIZE))) return;   // waits for its cells (drawn ground stays as it was)
      lastC = C; dirty = false; raster(lastC[0], lastC[1]);
      U.gnOn.value = 1;
    }
  };
  const api = { uniforms: U, stats: () => ({ ...stats, on: U.gnOn.value, slack: SLACK, veg: vegOn }),
    setVeg: (on) => { vegOn = !!on; if (lastC) raster(lastC[0], lastC[1]); redraw(); } };
  window.__v2groundNear = api;
  return api;
}
