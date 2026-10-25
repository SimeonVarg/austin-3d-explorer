// Real captured skies (2026-10-25; ONLY with ?sky=NAME or a moment that names a sky; without them nothing here runs).
//
// The owner, on the parametric sky of #551: "you need to notice the intricacies in sky detail ... to replicate the colors and
// patterns and lines and faults". A gradient and noise clouds cannot. So the sky of a moment is a PHOTOGRAPHED sky:
//
//   1. a library of CC0 HDRIs (Poly Haven, v2/data/sky/, scripts/v2/sky_bake.py): the upper half of each, its sun painted out
//      and measured (the app draws its own sun: a light with shadows), stored as an sRGB WebP of radiance / white;
//   2. turned about the vertical so ITS sun stands at the moment's sun azimuth;
//   3. in Light B's units: the HDRI is scaled so that its own sun, at its own elevation, equals the app's sun model there (sky.js,
//      calibrated to Light B); the sky keeps the real ratio of sky light to sunlight. A sky with no sun disc (sunset, dusk,
//      night) is scaled so its light on a level surface equals the model sky's;
//   4. for the owner's photo moments, HIS photo's sky (v2/data/sky/photo-NAME.*, scripts/v2/sky_photo_bake.py): its sky pixels,
//      put back through the photo's solved camera, so the app at that camera shows exactly his sky; the HDRI fills the rest of
//      the dome, its colour matched to his photo per channel along the elevation (fitted here, on the overlap);
//   5. one texture, mipmapped, sampled with derivatives that ignore the seam at the back (no seam line, no shimmer in a pan:
//      rule 15) for the visible dome, the mirror environment (PMREM) and the diffuse light probe.
import * as THREE from 'three';

const BASE = new URL('./data/sky/', import.meta.url);
const LUM = [0.2126, 0.7152, 0.0722];
const lum = (v) => LUM[0] * v[0] + LUM[1] * v[1] + LUM[2] * v[2];
const s2l = (x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);

// read an image back at a small size (linear values x scale), for the light probe and the colour fit
function readback(img, w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data, out = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { for (let k = 0; k < 3; k++) out[i * 4 + k] = s2l(d[i * 4 + k] / 255); out[i * 4 + 3] = d[i * 4 + 3] / 255; }
  return { w, h, px: out };
}
function loadTex(url, renderer) {
  return new Promise((res, rej) => new THREE.TextureLoader().load(url, (t) => {
    t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    if (renderer) t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    res(t);
  }, undefined, rej));
}

// name: a key of v2/data/sky/skies.json; photo: a photo moment's name (v2/data/sky/photo-NAME.json) or null; renderer may be null
// (then setAnisotropy later)
export function setAnisotropy(R, renderer) {
  const a = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  for (const t of [R.tex, R.photo && R.photo.tex, R.cloud && R.cloud.tex]) if (t && t.anisotropy !== a) { t.anisotropy = a; t.needsUpdate = true; }
}
// clouds: another sky of the library whose CLOUDS are laid over this one (a cloud layer), or null; see placeRealSky / cloudAt
export async function loadRealSky(name, photo, renderer, clouds = null) {
  const all = await (await fetch(new URL('skies.json', BASE))).json();
  const S = all.skies[name];
  if (!S) throw new Error('no sky named ' + name + ' (v2/data/sky/skies.json: ' + Object.keys(all.skies).join(', ') + ')');
  const tex = await loadTex(new URL(S.file, BASE).href, renderer);
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
  const R = { name, S, tex, grid: readback(tex.image, 256, 64), photo: null, cloud: null };
  if (clouds && all.skies[clouds] && clouds !== name) {
    try {
      const CS = all.skies[clouds], ctex = await loadTex(new URL(CS.file, BASE).href, renderer);
      ctex.wrapS = THREE.RepeatWrapping; ctex.wrapT = THREE.ClampToEdgeWrapping;
      R.cloud = { name: clouds, S: CS, tex: ctex, grid: readback(ctex.image, 512, 128) };
    } catch (e) { console.warn('[v2 sky-real] no cloud layer', clouds, e.message); }
  }
  if (photo) {
    try {
      const P = await (await fetch(new URL('photo-' + photo + '.json', BASE))).json();
      const ptex = await loadTex(new URL(P.file, BASE).href, renderer);
      ptex.wrapS = ptex.wrapT = THREE.ClampToEdgeWrapping;
      R.photo = { P, tex: ptex, grid: readback(ptex.image, Math.round(P.size[0] / 8), Math.round(P.size[1] / 8)),
        M: new THREE.Matrix3().set(...P.M.flat()) };
    } catch (e) { console.warn('[v2 sky-real] no photo sky for', photo, e.message); }
  }
  return R;
}

// ── the sky's radiance in direction d (JS, for the probe, the fog and the fit), in the HDRI's units x gain ────────────────
// the texture column of a compass azimuth: the HDRI's sun column (S.sun.u or S.glow.u) sits at the moment's sun azimuth
export function columnOf(R, azRad) { return R.uSun + (azRad - R.azSun) / (2 * Math.PI); }
function gridAt(G, u, v) {   // bilinear, u wraps, v clamps; v = 0 at the horizon, 1 at the zenith (the image's top row)
  const x = (((u % 1) + 1) % 1) * G.w - 0.5, y = (1 - THREE.MathUtils.clamp(v, 0, 1)) * G.h - 0.5;
  const x0 = Math.floor(x), y0 = THREE.MathUtils.clamp(Math.floor(y), 0, G.h - 1), y1 = Math.min(G.h - 1, y0 + 1), fx = x - x0, fy = THREE.MathUtils.clamp(y - y0, 0, 1);
  const X0 = ((x0 % G.w) + G.w) % G.w, X1 = (X0 + 1) % G.w;
  const at = (xx, yy, k) => G.px[(yy * G.w + xx) * 4 + k];
  return [0, 1, 2].map((k) => (at(X0, y0, k) * (1 - fx) + at(X1, y0, k) * fx) * (1 - fy) + (at(X0, y1, k) * (1 - fx) + at(X1, y1, k) * fx) * fy);
}
// The fit's colour is evidence only for sky as far from the sun as the photo's sky (2026-10-25). A clear sky's colour depends on the
// height (which the fit follows) AND on the angle to the sun: round the sun it is pale and white, far from it deep blue. His photo
// looks away from the sun, so its colour applied to the whole dome turned the pale sky round the sun (behind him, what his south
// glass mirrors) deep blue, and white clouds blue. So: the fit's colour holds beyond fade[1] degrees from the sun, is gone within
// fade[0]; its brightness holds everywhere (the photo camera's exposure).
const sstep = (a, b, x) => { const t = THREE.MathUtils.clamp((x - a) / Math.max(1e-6, b - a), 0, 1); return t * t * (3 - 2 * t); };
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export function fitWeight(R, d) {
  if (!R.fade || !R.sunDir) return 1;
  return 1 - sstep(R.fade[1], R.fade[0], dot3(d, R.sunDir));   // fade = cosines of [gone within, full beyond]
}
// the cloud layer gives way to the photo inside the photo's view (where the photo is the evidence; near its edges the photo's sky
// mask leaves gaps round the building, which must not fill with clouds): none within cfade[0] of its middle, all beyond cfade[1]
function cloudPhotoWeight(R, d) {
  if (!R.cfade || !R.photoDir) return 1;
  return 1 - sstep(R.cfade[1], R.cfade[0], dot3(d, R.photoDir));
}
// w < 1 fades the fit's COLOUR only; its brightness (the photo camera's exposure vs the HDRI's) holds over the whole dome
export function gainAt(R, elRad, w = 1) {
  const e = THREE.MathUtils.clamp(elRad, R.fit.elMin, R.fit.elMax) - R.fit.el0;
  const lg = [0, 1, 2].map((c) => R.fit.a[c] + R.fit.b[c] * e), L = LUM[0] * lg[0] + LUM[1] * lg[1] + LUM[2] * lg[2];
  return lg.map((g) => Math.exp(L + w * (g - L)));
}
// the HDRI (without the photo) in dome units, in direction d (app frame: x east, y up, z south)
export function hdriAt(R, d) {
  const el = Math.asin(THREE.MathUtils.clamp(d[1], 0, 1)), az = Math.atan2(d[0], -d[2]);
  const c = gridAt(R.grid, columnOf(R, az), el / (Math.PI / 2)), g = gainAt(R, el, fitWeight(R, d));
  return c.map((v, k) => v * R.white * R.k * g[k]);
}
// The cloud layer (2026-10-25): the clouds of a second HDRI laid over this sky, so a clear sky with the right sun (golden_hour at 19
// degrees) can carry the scattered cumulus of the day. A pixel of the cloud HDRI is cloud by its whiteness (min/max of its linear
// rgb: the blue sky is ~0.35, cloud ~0.8; ALPHA = [none below, full above]); the cloud's own radiance is kept, on the cloud sky's own
// calibration (its sun = the app's sun model at its elevation) and the fit's brightness. It is the SKY, so the dome, every mirror
// and the light all see the same clouds. cfg: LOOK.MOMENT.REAL.CLOUDS.
export function cloudAt(R, d) {
  const C = R.cloud;
  if (!C || !C.on) return null;
  const el = Math.asin(THREE.MathUtils.clamp(d[1], 0, 1)), az = Math.atan2(d[0], -d[2]);
  const c = gridAt(C.grid, C.uSun + (az - R.azSun) / (2 * Math.PI) + C.uOff, el / (Math.PI / 2));
  const a = THREE.MathUtils.clamp((Math.min(...c) / Math.max(...c, 1e-6) - C.alpha[0]) / (C.alpha[1] - C.alpha[0]), 0, 1);
  const g = gainAt(R, el, 0);
  return [...c.map((v, k) => v * C.white * C.k * C.gain * g[k]), a * a * (3 - 2 * a) * C.cover * cloudPhotoWeight(R, d) * sstep(C.elS[0], C.elS[1], d[1])];
}
// with the photo where it has sky
// cloudK: how much of the cloud layer counts (1 = all; the LIGHT a moment casts uses CLOUDS.LIGHT, see main.js applyMoment)
export function realAt(R, d, cloudK = 1) {
  let c = hdriAt(R, d);
  const cl = cloudAt(R, d);
  if (cl) { const a = cl[3] * cloudK; c = c.map((v, k) => v * (1 - a) + cl[k] * a); }
  if (!R.photo) return c;
  const p = photoAt(R.photo, d);
  if (!p || p[3] <= 0) return c;
  return c.map((v, k) => v * (1 - p[3]) + p[k] * R.photo.scale * p[3]);
}
function photoAt(Ph, d) {
  const m = Ph.P.M, q = [0, 1, 2].map((r) => m[r][0] * d[0] + m[r][1] * d[1] + m[r][2] * d[2]);
  if (q[2] <= 1e-6) return null;
  const u = q[0] / q[2], v = q[1] / q[2];
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  const G = Ph.grid, x = Math.min(G.w - 1, Math.floor(u * G.w)), y = Math.min(G.h - 1, Math.floor((1 - v) * G.h)), o = (y * G.w + x) * 4;
  const g = Ph.P.gamma || 1;
  return [G.px[o] ** g, G.px[o + 1] ** g, G.px[o + 2] ** g, G.px[o + 3]];
}

// Set the moment-dependent numbers: the rotation, the scale (Light B's units) and the colour fit to the photo.
//   M: sky.js buildMoment's result; sunAtEl(el) -> the app's sun (rgb, light units) at that elevation; LIGHT: the lighting sky / dome
//   modelLevelE: the model sky's light on a level surface (rgb, LIGHT units) at the moment; photoExposure: the moment's camera exposure
//   fadeDeg: [gone within, full beyond] degrees from the sun for the colour of the fit (null: the whole dome, as before)
//   clouds: { COVER, ALPHA, GAIN, AZ_DEG, PHOTO_DEG } for the cloud layer (null: none)
export function placeRealSky(R, M, sunAtEl, LIGHT, modelLevelE, photoExposure, slopeMax = Infinity, fadeDeg = null, clouds = null) {
  const S = R.S, D2R = Math.PI / 180, s = S.sun || S.glow;
  R.uSun = s ? s.u : 0.5; R.azSun = M.az * D2R;
  R.white = S.white;
  R.fit = { a: [0, 0, 0], b: [0, 0, 0], el0: 0, elMin: 0, elMax: Math.PI / 2, n: 0 };
  if (S.sun && S.sun.E_rgb[1] > 0) {
    // the HDRI's sun at its own elevation = the app's sun there: the whole HDRI scaled by that (its sky light keeps the real ratio)
    R.k = lum(sunAtEl(S.sun.el_deg)) / lum(S.sun.E_rgb) / LIGHT; R.calib = 'sun';
  } else {
    R.k = lum(modelLevelE) / Math.max(1e-12, lum(S.E_sky_level_rgb)) / LIGHT; R.calib = 'sky';
  }
  if (R.cloud) {
    const C = R.cloud, cs = C.S.sun || C.S.glow;
    C.on = !!(clouds && clouds.COVER > 0);
    C.uSun = cs ? cs.u : 0.5; C.white = C.S.white;
    C.k = C.S.sun && C.S.sun.E_rgb[1] > 0 ? lum(sunAtEl(C.S.sun.el_deg)) / lum(C.S.sun.E_rgb) / LIGHT : lum(modelLevelE) / Math.max(1e-12, lum(C.S.E_sky_level_rgb)) / LIGHT;
    if (clouds) Object.assign(C, { cover: clouds.COVER, alpha: clouds.ALPHA, gain: clouds.GAIN, uOff: (clouds.AZ_DEG || 0) / 360,
      elS: (clouds.EL_DEG || [0, 0.01]).map((e) => Math.sin(e * D2R)), blur: Math.max(0, clouds.ALPHA_LOD || 0) });
  }
  R.fade = null; R.photoDir = null; R.cfade = null;
  R.sunDir = M.sunDir ? [...M.sunDir] : null;
  if (R.photo) {
    const mi = R.photo.P.Minv, pd = [0, 1, 2].map((r) => mi[r][0] * 0.5 + mi[r][1] * 0.5 + mi[r][2]), pn = Math.hypot(...pd);
    R.photoDir = pd.map((t) => t / pn);
    if (fadeDeg && R.sunDir) R.fade = [Math.cos(fadeDeg[0] * D2R), Math.cos(fadeDeg[1] * D2R)];
    if (clouds && clouds.PHOTO_DEG) R.cfade = [Math.cos(clouds.PHOTO_DEG[0] * D2R), Math.cos(clouds.PHOTO_DEG[1] * D2R)];
    // the photo's sky in dome units = its pixels / (the camera's exposure when it was baked) x (that exposure / now)
    R.photo.scale = R.photo.P.scale * (R.photo.P.exposure / photoExposure);
    // the colour fit: log(photo / HDRI) per channel = a + b (el - el0), over the photo's sky (alpha > 0.9), least squares
    const G = R.photo.grid, m = R.photo.P.Minv, rows = [];
    for (let y = 0; y < G.h; y++) for (let x = 0; x < G.w; x++) {
      const o = (y * G.w + x) * 4;
      if (G.px[o + 3] < 0.9) continue;
      const u = (x + 0.5) / G.w, v = 1 - (y + 0.5) / G.h;
      let d = [0, 1, 2].map((r) => m[r][0] * u + m[r][1] * v + m[r][2]);
      const n = Math.hypot(...d); d = d.map((t) => t / n);
      if (d[1] <= 0.005) continue;
      const el = Math.asin(d[1]), az = Math.atan2(d[0], -d[2]);
      const h = gridAt(R.grid, columnOf(R, az), el / (Math.PI / 2)).map((t) => t * R.white * R.k);
      const p = [0, 1, 2].map((k) => G.px[o + k] ** (R.photo.P.gamma || 1) * R.photo.scale);
      if (Math.min(...h) <= 1e-9 || Math.min(...p) <= 1e-9) continue;
      rows.push([el, p.map((t, k) => Math.log(t / h[k]))]);
    }
    if (rows.length > 20) {
      const els = rows.map((r) => r[0]).sort((a, b) => a - b);
      const el0 = els[Math.floor(els.length / 2)], n = rows.length;
      let sx = 0, sxx = 0; for (const [e] of rows) { sx += e - el0; sxx += (e - el0) ** 2; }
      const a = [0, 0, 0], b = [0, 0, 0];
      for (let k = 0; k < 3; k++) {
        let sy = 0, sxy = 0; for (const [e, l] of rows) { sy += l[k]; sxy += (e - el0) * l[k]; }
        const den = n * sxx - sx * sx;
        b[k] = den > 1e-12 ? (n * sxy - sx * sy) / den : 0;
        b[k] = Math.max(-slopeMax, Math.min(slopeMax, b[k]));   // a sky unlike his along the height must not be bent into a band
        a[k] = (sy - b[k] * sx) / n;
      }
      R.fit = { a, b, el0, elMin: els[Math.floor(n * 0.02)], elMax: els[Math.floor(n * 0.98)], n };
    }
  }
  return R;
}

export const realSkyGLSL = /* glsl */`
uniform sampler2D rTex; uniform float rU0, rBase; uniform vec3 rLogA, rGainB; uniform vec3 rFit;   // rFit: el0, elMin, elMax
#ifdef R_PHOTO
uniform sampler2D pTex; uniform mat3 pM; uniform float pScale, pGamma; uniform vec3 rPDir, rSunD; uniform vec2 rFade, rCFade;
#endif
#ifdef R_CLOUD
uniform sampler2D cTex; uniform float cU0, cBase, cCover, cBlur; uniform vec2 cAlpha, cEl;
#endif
vec3 v2real(vec3 d) {
  float el = asin(clamp(d.y, 0.0, 1.0));
  float az = atan(d.x, -d.z);
  vec2 uv = vec2(rU0 + az * 0.15915494, el * 0.63661977);
  // derivatives with the seam taken out (u jumps by 1 at the back): the mip level never sees the jump, so no seam line
  vec2 dx = dFdx(uv), dy = dFdy(uv);
  dx.x -= floor(dx.x + 0.5); dy.x -= floor(dy.x + 0.5);
  vec3 c = textureGrad(rTex, vec2(fract(uv.x), uv.y), dx, dy).rgb;
  float e = clamp(el, rFit.y, rFit.z) - rFit.x;
  float fw = 1.0;
#ifdef R_PHOTO
  if (rFade.x > rFade.y) fw = 1.0 - smoothstep(rFade.y, rFade.x, dot(d, rSunD));
#endif
  vec3 lg = rLogA + rGainB * e; float lgL = dot(lg, vec3(0.2126, 0.7152, 0.0722));
  c *= rBase * exp(lgL + fw * (lg - lgL));   // the fit's colour fades near the sun; its brightness holds
#ifdef R_CLOUD
  {
    vec2 cuv = vec2(cU0 + az * 0.15915494, uv.y);
    vec3 cc = textureGrad(cTex, vec2(fract(cuv.x), cuv.y), dx, dy).rgb;
    // the cloud/sky decision from a coarser level of the texture (at least mip cBlur): a threshold on the fine texture draws contour
    // lines inside the clouds (where their own shading dips in whiteness); the cloud's look stays sharp from the fine colour
    vec2 cts = vec2(textureSize(cTex, 0));
    float clod = log2(max(max(length(dx * cts), length(dy * cts)), 1.0));
    vec3 cb = textureLod(cTex, vec2(fract(cuv.x), cuv.y), max(clod, cBlur)).rgb;
    float ca = smoothstep(cAlpha.x, cAlpha.y, min(cb.r, min(cb.g, cb.b)) / max(max(cb.r, max(cb.g, cb.b)), 1e-5)) * cCover * smoothstep(cEl.x, cEl.y, d.y);
#ifdef R_PHOTO
    if (rCFade.x > rCFade.y) ca *= 1.0 - smoothstep(rCFade.y, rCFade.x, dot(d, rPDir));
#endif
    c = mix(c, cc * cBase * exp(lgL), ca);
  }
#endif
#ifdef R_PHOTO
  vec3 q = pM * d;
  vec2 pv = q.xy / max(q.z, 1e-6);
  vec2 pdx = dFdx(pv), pdy = dFdy(pv);
  if (q.z > 0.0 && pv.x >= 0.0 && pv.x <= 1.0 && pv.y >= 0.0 && pv.y <= 1.0) {
    vec4 p = textureGrad(pTex, pv, pdx, pdy);
    c = mix(c, pow(p.rgb, vec3(pGamma)) * pScale, p.a);
  }
#endif
  return c;
}`;

// the uniforms of realSkyGLSL for R (placed)
export function realSkyUniforms(R) {
  const u = {
    rTex: { value: R.tex }, rU0: { value: R.uSun - R.azSun / (2 * Math.PI) },
    rBase: { value: R.white * R.k }, rLogA: { value: new THREE.Vector3(...R.fit.a) },
    rGainB: { value: new THREE.Vector3(...R.fit.b) }, rFit: { value: new THREE.Vector3(R.fit.el0, R.fit.elMin, R.fit.elMax) },
  };
  if (R.cloud && R.cloud.on) Object.assign(u, { cTex: { value: R.cloud.tex }, cU0: { value: R.cloud.uSun + R.cloud.uOff - R.azSun / (2 * Math.PI) },
    cBase: { value: R.cloud.white * R.cloud.k * R.cloud.gain }, cCover: { value: R.cloud.cover }, cAlpha: { value: new THREE.Vector2(...R.cloud.alpha) }, cEl: { value: new THREE.Vector2(...R.cloud.elS) }, cBlur: { value: R.cloud.blur } });
  if (R.photo) Object.assign(u, { pTex: { value: R.photo.tex }, pM: { value: R.photo.M }, pScale: { value: R.photo.scale }, pGamma: { value: R.photo.P.gamma || 1 },
    rPDir: { value: new THREE.Vector3(...R.photoDir) }, rSunD: { value: new THREE.Vector3(...(R.sunDir || [0, 1, 0])) },
    rFade: { value: new THREE.Vector2(...(R.fade || [0, 0])) }, rCFade: { value: new THREE.Vector2(...(R.cfade || [0, 0])) } });
  return u;
}
