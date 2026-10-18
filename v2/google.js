// Google mode: Google's Photorealistic 3D Tiles around our Blender buildings, streamed live through Google's Map Tiles API.
//
// OFF unless a Google Maps API key is saved in this browser (the "Google 3D" control, bottom of the screen). The key lives
// in this browser's localStorage only; it is never in the repo. Without a key v2 is exactly as before: this file then adds
// one small button and nothing else, and makes no request to Google.
//
// What the terms allow and require (the quotes and links are in docs/v2-google-mode.md):
//   - Google tiles are streamed and drawn, never stored: no copy on disk, no service worker, the browser's own HTTP cache
//     obeys Google's Cache-Control headers, and the renderer keeps only its working set in memory.
//   - The Google Maps logo and the data attributions of the tiles in view are shown on the map, together and apart from
//     any other credit; the screen says which part of the scene is Google's and which is ours.
//   - "No use with non-Google maps": in Google mode every v2 layer that is a map (the ground, roads, sidewalks, plain
//     extrusions, map trees, and any layer another lane adds later) is hidden. What stays: Google's tiles, our own
//     Blender models (own 3D objects, which the policy allows on top of Photorealistic 3D Tiles), the walking route
//     overlay, the sky and the lights.
//
// How Google's mesh is put on v2's coordinates (accuracy is the point):
//   1. FRAME. v2's frame (v2/geo.js) is equirectangular on the equatorial radius, not metric: north-south it is 0.4 %
//      longer than the ground (13 m at downtown). Google's mesh is metric ECEF. The group puts the mesh in a local
//      east/up/south frame at the origin; a quadratic map (fitted here from geo.js itself, at startup) takes that frame to
//      v2's. Fit residual: under 4 cm across the tiles' area, under 8 cm across 8 x 9 km (printed by state()).
//   2. HEIGHT. v2 is flat: everything stands on y = 0. Google's mesh carries the real terrain (the ground falls about 48 m
//      from the Tower to the lake). Each Google vertex is lowered by the real ground height there (v2/google/ground-dem.*,
//      the 2021 lidar bare earth, NOT Google data), so Google's ground lies on y = 0 and its buildings keep their heights.
//      y = 0 is the origin's ground: NAVD88 + GEOID18 + the NAD83(2011) -> ITRF height change (the .json says each).
//      Then a ground check (GOOGLE.ANCHOR) compares Google's own ground with that at open road points in view and takes
//      out what is left (Google's own height error); it is held in memory only, for drawing.
//   3. HIDING. Where our Blender buildings stand, Google's mesh above GOOGLE.CLIP_ABOVE_M is not drawn, so the two do not
//      overlap. The mask is a top-down picture of our own loaded tiles, so it follows exactly what is on screen.
//   Every number above is a parameter in GOOGLE below.
import * as THREE from 'three';
import { ORIGIN, EARTH_R, toLocal, toLonLat } from './geo.js';

const params = new URLSearchParams(location.search);
// ?gmock=<tileset url>: a stand-in tileset for scripts/verify/v2-google.mjs, honoured on a local server only (so no public link
// can put other content under Google's logo)
const MOCK_OK = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
const PHONE = matchMedia('(max-width: 600px), (pointer: coarse)').matches;

export const GOOGLE = {
  ROOT_URL: 'https://tile.googleapis.com/v1/3dtiles/root.json',
  KEY_STORE: 'v2.googleMapsKey',           // localStorage
  // detail and memory
  ERROR_TARGET_CSS_PX: PHONE ? 24 : 16,   // CSS pixels (the library sizes the screen from renderer.getSize)
  CACHE_MIN_MB: PHONE ? 140 : 350,
  CACHE_MAX_MB: PHONE ? 240 : 650,
  DOWNLOAD_JOBS: PHONE ? 6 : 16,
  PARSE_JOBS: PHONE ? 2 : 4,
  ANISOTROPY: 8,                           // sharp, steady photo texture at a grazing angle (rule 15), with mipmaps
  // frame and height
  FLATTEN: params.get('gterrain') !== '1', // ?gterrain=1 shows Google's real terrain (our buildings then float or sink)
  ANCHOR: params.get('gclamp') !== '0',    // the ground check (?gclamp=0: datum constants only)
  ANCHOR_SAMPLES: 18, ANCHOR_RADIUS_M: 700, ANCHOR_MIN_INLIERS: 6, ANCHOR_INLIER_M: 1.5, ANCHOR_MAX_M: 6, ANCHOR_EVERY_MS: 4000,
  SHIFT_M: (params.get('gshift') || '0,0').split(',').map(Number).map((v) => (Number.isFinite(v) ? v : 0)),   // east, south nudge
  // hiding Google's mesh under our buildings
  CLIP: params.get('gclip') !== '0',
  CLIP_ABOVE_M: 0.6,                       // Google's ground and kerbs stay; walls, roofs, trees and cars above this go
  DILATE_M: 2.0,                           // the mask reaches this far past our walls (Google's walls are a little soft)
  SINK_M: 0.3,                             // Google's ground sinks this much under our models, so a model's own paving wins
  ROUTE_LIFT_M: 0.8,                       // the walking route rides this far above Google's ground (its kerbs, cars and bumps)
  MASK_M_PER_PX: PHONE ? 2.0 : 1.25,
  MASK_MARGIN_M: 120,
  MASK_EVERY_MS: 400,
  SESSION_REFRESH_S: 2.75 * 3600,          // a root request gives at least 3 hours of tile requests
  LOGO_HEIGHT_PX: 18,                      // the policy: 16 to 19 dp
};

const WGS84 = { a: 6378137, f: 1 / 298.257223563 };
const D2R = Math.PI / 180;
const here = (p) => new URL(p, import.meta.url).href;

function ecef(latDeg, lonDeg, h) {
  const e2 = WGS84.f * (2 - WGS84.f), p = latDeg * D2R, l = lonDeg * D2R;
  const N = WGS84.a / Math.sqrt(1 - e2 * Math.sin(p) ** 2);
  return [(N + h) * Math.cos(p) * Math.cos(l), (N + h) * Math.cos(p) * Math.sin(l), (N * (1 - e2) + h) * Math.sin(p)];
}
// world frame of the Google group: x = east, y = up, z = south, metres, from (ORIGIN, h0) on the ellipsoid
function frameAt(h0) {
  const p = ORIGIN.lat * D2R, l = ORIGIN.lon * D2R;
  const E = [-Math.sin(l), Math.cos(l), 0];
  const N = [-Math.sin(p) * Math.cos(l), -Math.sin(p) * Math.sin(l), Math.cos(p)];
  const U = [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)];
  const O = ecef(ORIGIN.lat, ORIGIN.lon, h0);
  const S = N.map((v) => -v);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const m = new THREE.Matrix4().set(
    E[0], E[1], E[2], -dot(E, O),
    U[0], U[1], U[2], -dot(U, O),
    S[0], S[1], S[2], -dot(S, O),
    0, 0, 0, 1);
  const toWorld = (P) => [dot(E, P) - dot(E, O), dot(U, P) - dot(U, O), dot(S, P) - dot(S, O)];
  return { matrix: m, toWorld };
}

// ── the frame map: world (east, up, south from the ellipsoid at the origin) -> v2 (geo.js), a quadratic fitted at startup ──
// 1, the linear terms, the curvature terms (x², z², xz) and the tilt of "up" away from the origin (xy, zy)
// (in kilometres, so the fit is well conditioned; the shader does the same)
const FEATURES = (m) => { const w = [m[0] / 1000, m[1] / 1000, m[2] / 1000]; return [1, w[0], w[1], w[2], w[0] * w[0], w[2] * w[2], w[0] * w[2], w[0] * w[1], w[2] * w[1]]; };
const NF = 9;
function fitFrame(h0, toWorld) {
  const rows = [];
  for (let x = -5200; x <= 5200; x += 400) for (let z = -4400; z <= 6800; z += 400) for (const dh of [-70, 0, 60, 200, 400]) {
    const [lon, lat] = toLonLat(x, z);
    rows.push({ w: toWorld(ecef(lat, lon, h0 + dh)), o: [x, dh, z] });
  }
  const coef = [0, 1, 2].map((k) => {
    const n = NF, A = Array.from({ length: n }, () => new Float64Array(n)), b = new Float64Array(n);
    for (const r of rows) { const f = FEATURES(r.w); for (let i = 0; i < n; i++) { b[i] += f[i] * r.o[k]; for (let j = 0; j < n; j++) A[i][j] += f[i] * f[j]; } }
    for (let i = 0; i < n; i++) {                       // Gauss-Jordan with partial pivoting
      let pv = i; for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[pv][i])) pv = r;
      [A[i], A[pv]] = [A[pv], A[i]]; [b[i], b[pv]] = [b[pv], b[i]];
      for (let r = 0; r < n; r++) if (r !== i) { const q = A[r][i] / A[i][i]; for (let c = i; c < n; c++) A[r][c] -= q * A[i][c]; b[r] -= q * b[i]; }
    }
    return Array.from(b, (v, i) => v / A[i][i]);
  });
  const apply = (w) => { const f = FEATURES(w); return coef.map((c) => c.reduce((s, v, i) => s + v * f[i], 0)); };
  let maxTiles = 0, maxAll = 0;
  for (const r of rows) {
    const o = apply(r.w), e = Math.hypot(o[0] - r.o[0], o[1] - r.o[1], o[2] - r.o[2]);
    maxAll = Math.max(maxAll, e);
    if (r.o[0] >= -1500 && r.o[0] <= 1300 && r.o[2] >= -1500 && r.o[2] <= 3500) maxTiles = Math.max(maxTiles, e);
  }
  // the inverse, for rays: Newton steps on the (constant) linear part
  const J = new THREE.Matrix3().set(coef[0][1], coef[0][2], coef[0][3], coef[1][1], coef[1][2], coef[1][3], coef[2][1], coef[2][2], coef[2][3]).multiplyScalar(0.001);
  const Ji = J.clone().invert(), v = new THREE.Vector3();
  const invert = (o) => {
    let w = [o[0], o[1], o[2]];
    for (let it = 0; it < 6; it++) {
      const f = apply(w); v.set(f[0] - o[0], f[1] - o[1], f[2] - o[2]).applyMatrix3(Ji);
      w = [w[0] - v.x, w[1] - v.y, w[2] - v.z];
    }
    return w;
  };
  return { coef, apply, invert, maxTilesM: maxTiles, maxAllM: maxAll };
}

// ── the ground height grid (lidar bare earth, v2/google/ground-dem.*) ──
async function loadDem() {
  const meta = await (await fetch(here('./google/ground-dem.json'))).json();
  const buf = await (await fetch(here('./google/ground-dem.bin'))).arrayBuffer();
  const cm = new Int16Array(buf);
  if (cm.length !== meta.cols * meta.rows) throw new Error('ground grid size ' + cm.length);
  const m = new Float32Array(cm.length);
  for (let i = 0; i < cm.length; i++) m[i] = cm[i] / 100;
  const tex = new THREE.DataTexture(m, meta.cols, meta.rows, THREE.RedFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
  const at = (x, z) => {
    const fx = (x - meta.x0) / meta.cell - 0.5, fz = (z - meta.z0) / meta.cell - 0.5;
    const i0 = Math.floor(fx), j0 = Math.floor(fz), tx = fx - i0, tz = fz - j0;
    const c = (i, j) => m[THREE.MathUtils.clamp(j, 0, meta.rows - 1) * meta.cols + THREE.MathUtils.clamp(i, 0, meta.cols - 1)];
    return (c(i0, j0) * (1 - tx) + c(i0 + 1, j0) * tx) * (1 - tz) + (c(i0, j0 + 1) * (1 - tx) + c(i0 + 1, j0 + 1) * tx) * tz;
  };
  return { meta, tex, at };
}

// ── the shader patch every Google material gets ──
const U = {
  gPX: { value: [] }, gPY: { value: [] }, gPZ: { value: [] },
  gShift: { value: new THREE.Vector2() },
  gDem: { value: null }, gDemRect: { value: new THREE.Vector3() }, gDemSize: { value: new THREE.Vector2() },
  gFlat: { value: 1 }, gDy: { value: 0 },
  gMask: { value: null }, gMaskRect: { value: new THREE.Vector4(0, 0, 1, 1) }, gMaskOn: { value: 0 },
  gClip: { value: 1 }, gClipAbove: { value: GOOGLE.CLIP_ABOVE_M }, gDil: { value: new THREE.Vector2() }, gSink: { value: GOOGLE.SINK_M },
};
const GLSL_COMMON = /* glsl */`
  uniform sampler2D gMask; uniform vec4 gMaskRect; uniform float gMaskOn;
  varying vec2 vGXZ; varying float vGAbove;
  vec2 gMaskUV(vec2 p) { return vec2((p.x - gMaskRect.x) / gMaskRect.z, 1.0 - (p.y - gMaskRect.y) / gMaskRect.w); }
  float gInRect(vec2 uv) { return step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0); }
`;
const GLSL_VERTEX = GLSL_COMMON + /* glsl */`
  uniform float gPX[9]; uniform float gPY[9]; uniform float gPZ[9];
  uniform vec2 gShift;
  uniform sampler2D gDem; uniform vec3 gDemRect; uniform vec2 gDemSize;
  uniform float gFlat, gDy, gSink;
  #define GPOLY(c, w) (c[0] + c[1] * w.x + c[2] * w.y + c[3] * w.z + c[4] * w.x * w.x + c[5] * w.z * w.z + c[6] * w.x * w.z + c[7] * w.x * w.y + c[8] * w.z * w.y)
  float gGround(vec2 p) {
    vec2 f = (p - gDemRect.xy) / gDemRect.z - 0.5;
    vec2 i0 = floor(f), t = f - i0;
    ivec2 hi = ivec2(gDemSize) - 1;
    ivec2 a = clamp(ivec2(i0), ivec2(0), hi), b = clamp(ivec2(i0) + 1, ivec2(0), hi);
    float h00 = texelFetch(gDem, ivec2(a.x, a.y), 0).r, h10 = texelFetch(gDem, ivec2(b.x, a.y), 0).r;
    float h01 = texelFetch(gDem, ivec2(a.x, b.y), 0).r, h11 = texelFetch(gDem, ivec2(b.x, b.y), 0).r;
    return mix(mix(h00, h10, t.x), mix(h01, h11, t.x), t.y);
  }
  vec3 gWarp(vec3 w) {
    vec3 k = w * 0.001;
    vec3 o = vec3(GPOLY(gPX, k), GPOLY(gPY, k), GPOLY(gPZ, k));
    o.xz += gShift;
    float g = gGround(o.xz);
    vGAbove = o.y + gDy - g;
    o.y += gDy - gFlat * g;
    vec2 uv = gMaskUV(o.xz);
    o.y -= gSink * gMaskOn * gInRect(uv) * step(0.5, textureLod(gMask, uv, 0.0).r);
    vGXZ = o.xz;
    return o;
  }
`;
const GLSL_FRAGMENT = GLSL_COMMON + /* glsl */`
  uniform float gClip, gClipAbove; uniform vec2 gDil;
  float gMasked(vec2 p) {
    vec2 uv = gMaskUV(p);
    if (gInRect(uv) < 0.5) return 0.0;
    float m = texture(gMask, uv).r;
    m = max(m, texture(gMask, uv + vec2(gDil.x, 0.0)).r); m = max(m, texture(gMask, uv - vec2(gDil.x, 0.0)).r);
    m = max(m, texture(gMask, uv + vec2(0.0, gDil.y)).r); m = max(m, texture(gMask, uv - vec2(0.0, gDil.y)).r);
    m = max(m, texture(gMask, uv + gDil * 0.7071).r); m = max(m, texture(gMask, uv - gDil * 0.7071).r);
    m = max(m, texture(gMask, uv + vec2(gDil.x, -gDil.y) * 0.7071).r); m = max(m, texture(gMask, uv + vec2(-gDil.x, gDil.y) * 0.7071).r);
    return m;
  }
`;
function patchMaterial(m) {
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    shader.vertexShader = GLSL_VERTEX + shader.vertexShader.replace('#include <project_vertex>', /* glsl */`
      vec4 gW = modelMatrix * vec4(transformed, 1.0);
      vec3 gO = gWarp(gW.xyz);
      vec4 mvPosition = viewMatrix * vec4(gO, 1.0);
      gl_Position = projectionMatrix * mvPosition;`);
    shader.fragmentShader = GLSL_FRAGMENT + shader.fragmentShader.replace(/void\s+main\(\)\s*\{/, (s) => s + /* glsl */`
      if (gClip > 0.5 && gMaskOn > 0.5 && vGAbove > gClipAbove && gMasked(vGXZ) > 0.5) discard;`);
  };
  m.customProgramCacheKey = () => 'v2-google-1';
  m.needsUpdate = true;
}

// ── the Map Tiles API: key and session on Google's host only, readable errors, no key in any message ──
class FlyoverGoogleAuth {
  constructor(key, onStatus) {
    this.name = 'FLYOVER_GOOGLE_AUTH'; this.key = key; this.onStatus = onStatus;
    this.session = null; this.sessionAt = 0; this.host = new URL(GOOGLE.ROOT_URL).host; this.credits = new Map();
    this.lastError = null; this.requests = 0; this.rootRequests = 0;
  }
  init(tiles) {
    this.tiles = tiles;
    this._vis = ({ tile, visible }) => {
      const line = tile.engineData?.metadata?.asset?.copyright || '';
      for (const t of line.split(';').map((s) => s.trim()).filter(Boolean)) {
        const n = (this.credits.get(t) || 0) + (visible ? 1 : -1);
        if (n > 0) this.credits.set(t, n); else this.credits.delete(t);
      }
    };
    tiles.addEventListener('tile-visibility-change', this._vis);
  }
  // the data attributions of the tiles on screen: all of them, sorted by how many tiles carry them, in one line (the policy)
  attributions() { return [...this.credits.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]); }
  async fetchData(url, options) {
    const u = new URL(url);
    const google = u.host === this.host;
    const isRoot = google && /\/3dtiles\/root\.json$/.test(u.pathname);
    if (google && this.key) u.searchParams.set('key', this.key);
    if (google && this.session && !isRoot) u.searchParams.set('session', this.session);
    this.requests++; if (isRoot) this.rootRequests++;
    let res;
    try { res = await fetch(u, options); } catch (e) {
      if (e.name === 'AbortError') throw e;
      this.fail(0, 'the network request failed'); throw new Error('Google 3D: network error');
    }
    if (!res.ok) {
      // a session lasts at least 3 hours; past that, one new root request starts a new one
      if (google && !isRoot && res.status >= 400 && res.status < 500 && performance.now() - this.sessionAt > GOOGLE.SESSION_REFRESH_S * 1000) {
        await this.refresh(options);
        if (this.session) { u.searchParams.set('session', this.session); res = await fetch(u, options); }
      }
      if (!res.ok) { if (isRoot || res.status === 403 || res.status === 401) this.fail(res.status, await reason(res)); throw new Error('Google 3D: HTTP ' + res.status); }
    }
    if (isRoot) {
      const json = await res.json();
      this.session = sessionOf(json); this.sessionAt = performance.now();
      return json;
    }
    return res;
  }
  async refresh(options) {
    const u = new URL(GOOGLE.ROOT_URL); if (this.key) u.searchParams.set('key', this.key);
    this.rootRequests++;
    try { const r = await fetch(u, options); if (r.ok) { this.session = sessionOf(await r.json()); this.sessionAt = performance.now(); } } catch (e) { /* the next tile error reports */ }
  }
  fail(status, why) { this.lastError = { status, why }; this.onStatus && this.onStatus(this.lastError); }
  dispose() { this.tiles && this.tiles.removeEventListener('tile-visibility-change', this._vis); }
}
async function reason(res) {
  try { const j = await res.clone().json(); return String(j?.error?.status || j?.error?.message || '').slice(0, 120).replace(/key=[^&\s]+/g, 'key=…'); } catch (e) { return res.statusText || ''; }
}
function sessionOf(json) {
  let s = null;
  const walk = (t) => { if (s || !t) return; const uri = t.content?.uri || t.content?.url; if (uri && uri.includes('session=')) { s = new URL(uri, GOOGLE.ROOT_URL).searchParams.get('session'); return; } (t.children || []).forEach(walk); };
  walk(json && json.root);
  return s;
}

// ── install: called once by main.js with window.__v2 ──
export function install(v2) {
  const { scene, camera, renderer } = v2;
  const redraw = () => v2.redraw && v2.redraw();
  const store = {
    get() { try { return localStorage.getItem(GOOGLE.KEY_STORE) || ''; } catch (e) { return ''; } },
    set(k) { try { localStorage.setItem(GOOGLE.KEY_STORE, k); return true; } catch (e) { return false; } },
    clear() { try { localStorage.removeItem(GOOGLE.KEY_STORE); } catch (e) {} },
  };
  const S = { on: false, starting: null, tiles: null, auth: null, group: null, frame: null, dem: null, hidden: new Map(), mask: null,
    maskSig: '', maskAt: 0, anchor: { estimates: [], last: 0, applied: 0, inliers: 0, spread: null }, mock: MOCK_OK ? params.get('gmock') : null, status: '', loaded: 0 };
  const ui = makeUI({ onKey: (k) => { store.set(k); enable(); }, onForget: () => { store.clear(); disable(); ui.render(state()); },
    onToggle: () => (S.on ? disable() : enable()) });

  function say(msg) { S.status = msg; ui.render(state()); }

  async function enable() {
    if (S.on || S.starting) return S.starting;
    const key = store.get();
    if (!key && !S.mock) { say('Paste a Google Maps API key to turn on Google 3D.'); return; }
    S.starting = (async () => {
      say('Google 3D: loading…');
      try {
        const [lib, dem] = await Promise.all([import('./vendor/3d-tiles-renderer/tiles-google.min.js'), S.dem ? S.dem : loadDem()]);
        S.dem = dem;
        const h0 = dem.meta.origin.ground_ellipsoid_itrf_m;
        const frame = frameAt(h0);
        S.frame = fitFrame(h0, frame.toWorld);
        U.gPX.value = S.frame.coef[0]; U.gPY.value = S.frame.coef[1]; U.gPZ.value = S.frame.coef[2];
        U.gShift.value.set(GOOGLE.SHIFT_M[0] || 0, GOOGLE.SHIFT_M[1] || 0);
        U.gDem.value = dem.tex; U.gDemRect.value.set(dem.meta.x0, dem.meta.z0, dem.meta.cell); U.gDemSize.value.set(dem.meta.cols, dem.meta.rows);
        U.gFlat.value = GOOGLE.FLATTEN ? 1 : 0; U.gClip.value = GOOGLE.CLIP ? 1 : 0;

        const tiles = new lib.TilesRenderer(S.mock || GOOGLE.ROOT_URL);
        const auth = new FlyoverGoogleAuth(S.mock ? '' : key, (err) => {
          const why = err.status === 403 || err.status === 401
            ? `Google refused the key (HTTP ${err.status}${err.why ? ', ' + err.why : ''}). Check that the Map Tiles API is on for the key's project, billing is on, and this site's address is allowed for the key.`
            : err.status === 429 ? 'Google 3D: over the quota for now (HTTP 429).'
              : `Google 3D could not load (${err.status ? 'HTTP ' + err.status : err.why}).`;
          // a refused key or a failed root: back to v2 as it was (the message stays); one root request, no retry loop
          if (err.status !== 429 || !S.loaded) setTimeout(() => { teardown(); say(why); }, 0);
          else say(why);
        });
        tiles.registerPlugin(auth);
        const draco = new lib.DRACOLoader().setDecoderPath(here('./vendor/draco/'));
        tiles.registerPlugin(new lib.GLTFExtensionsPlugin({ dracoLoader: draco, rtc: true, metadata: false }));
        tiles.errorTarget = GOOGLE.ERROR_TARGET_CSS_PX;
        tiles.lruCache.minBytesSize = GOOGLE.CACHE_MIN_MB * 2 ** 20;
        tiles.lruCache.maxBytesSize = GOOGLE.CACHE_MAX_MB * 2 ** 20;
        tiles.downloadQueue.maxJobs = GOOGLE.DOWNLOAD_JOBS;
        tiles.parseQueue.maxJobs = GOOGLE.PARSE_JOBS;
        tiles.setCamera(camera);
        tiles.setResolutionFromRenderer(camera, renderer);
        frame.matrix.decompose(tiles.group.position, tiles.group.quaternion, tiles.group.scale);
        tiles.group.name = 'google-3d';
        tiles.group.updateMatrixWorld(true);
        const aniso = Math.min(GOOGLE.ANISOTROPY, renderer.capabilities.getMaxAnisotropy());
        tiles.addEventListener('load-model', ({ scene: model }) => {
          model.traverse((o) => {
            if (!o.isMesh) return;
            o.castShadow = false; o.receiveShadow = false;
            const old = o.material;
            const m = old.isMeshBasicMaterial ? old : new THREE.MeshBasicMaterial({ map: old.map || null, color: old.color ? old.color.clone() : 0xffffff,
              vertexColors: !!o.geometry.attributes.color, side: old.side, transparent: old.transparent, opacity: old.opacity, alphaTest: old.alphaTest });
            if (m !== old) old.dispose();
            if (m.map) { m.map.anisotropy = aniso; }
            m.toneMapped = false;                        // Google's photo colours as they are, not through our tone curve
            patchMaterial(m);
            o.material = m;
          });
          if (++S.loaded === 1 && /^Google 3D: loading/.test(S.status)) say('');
          redraw();
        });
        tiles.addEventListener('needs-update', () => { S.needsUpdate = true; redraw(); });
        tiles.addEventListener('tiles-load-end', () => { S.needsUpdate = true; redraw(); });
        scene.add(tiles.group);
        Object.assign(S, { tiles, auth, group: tiles.group, on: true });
        hideMaps(true);
        for (const n of OVERLAYS) { const o = scene.getObjectByName(n); if (o) o.position.y = GOOGLE.ROUTE_LIFT_M; }
        say('Google 3D: loading the city…');
        redraw();
      } catch (e) {
        console.warn('[v2 google] could not start:', e.message);
        say('Google 3D could not start: ' + e.message);
        teardown();
      } finally { S.starting = null; }
    })();
    return S.starting;
  }

  function teardown() {
    if (S.tiles) { scene.remove(S.tiles.group); S.tiles.dispose(); }
    if (S.auth) S.auth.dispose();
    S.tiles = S.auth = S.group = null; S.on = false; S.loaded = 0;
    hideMaps(false);
    for (const n of OVERLAYS) { const o = scene.getObjectByName(n); if (o) o.position.y = 0; }
    U.gMaskOn.value = 0; S.maskSig = '';
    S.anchor = { estimates: [], last: 0, applied: 0, inliers: 0, spread: null }; U.gDy.value = 0;
    redraw();
  }
  function disable() { teardown(); say(''); }

  // ── "no use with non-Google maps": while Google mode is on, every scene layer that is not on this list is hidden ──
  // kept: Google's group, our Blender models, and our own overlays (the route, and the finder's routes / minutes wash / stops in
  // 'map-layers'): overlaid geodata is allowed on top of Google's tiles, a separate map is not
  const OVERLAYS = ['route', 'map-layers'];
  const keep = (o) => o === S.group || o.name === 'blender-tiles' || OVERLAYS.includes(o.name) || o.isLight || o.isLightProbe
    || o.userData?.googleKeep === true || /sky|haze|dome|sun/i.test(o.name || '') || (o.material && /sky|haze/i.test(o.material.name || ''))
    || (o.type === 'Object3D' && !o.children.length && !o.isMesh);   // light targets
  function hideMaps(on) {
    if (on) { for (const o of scene.children) if (!keep(o) && o.visible) { if (!S.hidden.has(o)) S.hidden.set(o, true); o.visible = false; } }
    else { for (const [o, v] of S.hidden) o.visible = v; S.hidden.clear(); }
  }

  // ── the mask: a top-down picture of our loaded Blender tiles ──
  const maskScene = new THREE.Scene();
  maskScene.overrideMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  const maskCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 6000);
  function updateMask(now) {
    const bt = scene.getObjectByName('blender-tiles');
    if (!bt || now - S.maskAt < GOOGLE.MASK_EVERY_MS) return;
    const sig = bt.children.map((c) => c.name).join('|');
    if (sig === S.maskSig) return;
    S.maskAt = now; S.maskSig = sig;
    const box = new THREE.Box3().setFromObject(bt);
    if (box.isEmpty()) { U.gMaskOn.value = 0; redraw(); return; }
    const M = GOOGLE.MASK_MARGIN_M, x0 = box.min.x - M, z0 = box.min.z - M, w = box.max.x - box.min.x + 2 * M, h = box.max.z - box.min.z + 2 * M;
    const maxTex = Math.min(renderer.capabilities.maxTextureSize, 8192);
    const res = Math.max(GOOGLE.MASK_M_PER_PX, w / maxTex, h / maxTex);
    const W = Math.ceil(w / res), H = Math.ceil(h / res);
    if (!S.mask || S.mask.width !== W || S.mask.height !== H) {
      if (S.mask) S.mask.dispose();
      S.mask = new THREE.WebGLRenderTarget(W, H, { format: THREE.RedFormat, type: THREE.UnsignedByteType, depthBuffer: true,
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
    }
    Object.assign(maskCam, { left: -w / 2, right: w / 2, top: h / 2, bottom: -h / 2 });
    maskCam.up.set(0, 0, -1);
    maskCam.position.set(x0 + w / 2, 3000, z0 + h / 2); maskCam.lookAt(x0 + w / 2, 0, z0 + h / 2);
    maskCam.updateProjectionMatrix(); maskCam.updateMatrixWorld();
    const parent = bt.parent, prevTarget = renderer.getRenderTarget(), prevClear = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
    const prevShadow = renderer.shadowMap.autoUpdate, prevVis = bt.visible;
    maskScene.add(bt); bt.visible = true;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(S.mask); renderer.setClearColor(0x000000, 1); renderer.clear(true, true, false);
    renderer.render(maskScene, maskCam);
    // and a coarse RGBA copy for the CPU (the ground check keeps its samples off our models)
    const cres = Math.max(4, res), CW = Math.ceil(w / cres), CH = Math.ceil(h / cres);
    if (!S.cpuRT || S.cpuRT.width !== CW || S.cpuRT.height !== CH) { if (S.cpuRT) S.cpuRT.dispose(); S.cpuRT = new THREE.WebGLRenderTarget(CW, CH); }
    renderer.setRenderTarget(S.cpuRT); renderer.clear(true, true, false);
    renderer.render(maskScene, maskCam);
    const px = new Uint8Array(CW * CH * 4);
    renderer.readRenderTargetPixels(S.cpuRT, 0, 0, CW, CH, px);
    S.cpuMask = { x0, z0, res: w / CW, W: CW, H: CH, px };
    renderer.setRenderTarget(prevTarget); renderer.setClearColor(prevClear, prevAlpha);
    renderer.shadowMap.autoUpdate = prevShadow;
    bt.visible = prevVis; parent.add(bt);
    U.gMask.value = S.mask.texture; U.gMaskRect.value.set(x0, z0, w, h); U.gMaskOn.value = 1;
    U.gDil.value.set(GOOGLE.DILATE_M / w, GOOGLE.DILATE_M / h);
    redraw();
  }

  // ── the ground check: Google's own ground at open road points in view, against the lidar ground ──
  const ray = new THREE.Raycaster();
  function anchorStep(now) {
    if (!GOOGLE.ANCHOR || S.mock || !S.tiles || now - S.anchor.last < GOOGLE.ANCHOR_EVERY_MS) return;
    S.anchor.last = now;
    const roads = (v2.city && v2.city.roads) || [];
    if (!roads.length) return;
    const t = v2.controls ? v2.controls.target : new THREE.Vector3();
    const pts = [];
    // road ribbon triangle centres (open ground) near the view's centre, outside our models' footprints
    for (const m of roads) {
      const g = m.geometry, P = g.attributes.position.array, I = g.index ? g.index.array : null;
      if (!g.boundingSphere || g.boundingSphere.center.distanceTo(t) > GOOGLE.ANCHOR_RADIUS_M + g.boundingSphere.radius) continue;
      const n = I ? I.length / 3 : P.length / 9, step = Math.max(1, Math.floor(n / 40));
      for (let k = 0; k < n; k += step) {
        const a = I ? I[k * 3] : k * 3, b = I ? I[k * 3 + 1] : k * 3 + 1, c = I ? I[k * 3 + 2] : k * 3 + 2;
        const x = (P[a * 3] + P[b * 3] + P[c * 3]) / 3, z = (P[a * 3 + 2] + P[b * 3 + 2] + P[c * 3 + 2]) / 3;
        if (Math.hypot(x - t.x, z - t.z) < GOOGLE.ANCHOR_RADIUS_M && !inMask(x, z)) pts.push([x, z]);
      }
    }
    if (pts.length < GOOGLE.ANCHOR_MIN_INLIERS) return;
    for (let i = pts.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [pts[i], pts[j]] = [pts[j], pts[i]]; }
    const res = [];
    S.group.updateMatrixWorld(true);
    for (const [x, z] of pts.slice(0, GOOGLE.ANCHOR_SAMPLES)) {
      const hit = googleGroundAt(x, z);
      if (hit != null) res.push(hit - S.dem.at(x, z));
    }
    if (res.length < GOOGLE.ANCHOR_MIN_INLIERS) return;
    res.sort((a, b) => a - b);
    const med = res[res.length >> 1], inl = res.filter((r) => Math.abs(r - med) < GOOGLE.ANCHOR_INLIER_M);
    if (inl.length < GOOGLE.ANCHOR_MIN_INLIERS || Math.abs(med) > GOOGLE.ANCHOR_MAX_M) return;
    const est = inl.reduce((s, v) => s + v, 0) / inl.length;
    S.anchor.estimates.push(est); if (S.anchor.estimates.length > 9) S.anchor.estimates.shift();
    const e = [...S.anchor.estimates].sort((a, b) => a - b), use = e[e.length >> 1];
    S.anchor.inliers = inl.length; S.anchor.spread = inl[inl.length - 1] - inl[0];
    if (Math.abs(-use - U.gDy.value) > 0.05) { U.gDy.value = -use; S.anchor.applied = -use; redraw(); }
  }
  // the height (v2 metres, before flattening and the check) of Google's topmost surface above (x, z), or null
  function googleGroundAt(x, z) {
    const top = S.frame.invert([x - U.gShift.value.x, 400, z - U.gShift.value.y]);
    const bot = S.frame.invert([x - U.gShift.value.x, -200, z - U.gShift.value.y]);
    // the group sits in the scene at its own matrix, so "world" here is the group frame the map was fitted in
    const o = new THREE.Vector3(...top), d = new THREE.Vector3(...bot).sub(o);
    ray.set(o, d.normalize());
    ray.far = 700;
    const hits = ray.intersectObject(S.group, true);
    if (!hits.length) return null;
    const p = hits[0].point;
    return S.frame.apply([p.x, p.y, p.z])[1];
  }
  // the CPU copy of the mask (coarser, read back once per mask update): is (x, z) on or within a few metres of our models?
  function inMask(x, z) {
    const c = S.cpuMask;
    if (!c) return false;
    const i = Math.floor((x - c.x0) / c.res), j = Math.floor((z - c.z0) / c.res);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= c.W || jj >= c.H) continue;
      if (c.px[((c.H - 1 - jj) * c.W + ii) * 4] > 127) return true;   // row 0 of the read-back is the bottom (south) edge
    }
    return false;
  }

  // ── per frame (after main.js has drawn): stream, mask, check, attributions ──
  let lastCam = new THREE.Matrix4(), lastAttr = 0;
  function tick(now) {
    requestAnimationFrame(tick);
    if (now - (S.lastLayout || 0) > 500) { S.lastLayout = now; ui.layout(); }
    if (!S.on || !S.tiles) return;
    camera.updateMatrixWorld();
    const moved = !lastCam.equals(camera.matrixWorld);
    if (moved || S.needsUpdate || now - (S.lastUpdate || 0) > 500) {
      lastCam.copy(camera.matrixWorld); S.needsUpdate = false; S.lastUpdate = now;
      S.tiles.setResolutionFromRenderer(camera, renderer);
      S.tiles.errorTarget = GOOGLE.ERROR_TARGET_CSS_PX;
      S.tiles.update();
      if (!moved) redraw();
    }
    updateMask(now);
    anchorStep(now);
    // a layer another module adds later is hidden too
    if (scene.children.some((o) => !keep(o) && o.visible)) { hideMaps(true); redraw(); }
    if (now - lastAttr > 500) { lastAttr = now; ui.attr(S.auth ? S.auth.attributions() : []); }
  }
  requestAnimationFrame(tick);

  function state() {
    return { on: S.on, keySaved: !!store.get(), mock: !!S.mock, status: S.status, starting: !!S.starting,
      loadedModels: S.loaded, requests: S.auth ? S.auth.requests : 0, rootRequests: S.auth ? S.auth.rootRequests : 0,
      lastError: S.auth ? S.auth.lastError : null,
      frameFitMaxM: S.frame ? { tilesArea: +S.frame.maxTilesM.toFixed(3), all: +S.frame.maxAllM.toFixed(3) } : null,
      datum: S.dem ? S.dem.meta.origin : null,
      anchor: { applied: +U.gDy.value.toFixed(3), estimates: S.anchor.estimates.map((v) => +v.toFixed(3)), inliers: S.anchor.inliers, spread: S.anchor.spread },
      mask: U.gMaskOn.value ? { rect: U.gMaskRect.value.toArray().map((v) => +v.toFixed(1)), px: S.mask ? [S.mask.width, S.mask.height] : null } : null,
      hiddenLayers: [...S.hidden.keys()].map((o) => o.name || o.type),
      tiles: S.tiles ? { visible: S.tiles.visibleTiles.size, cachedMB: +(S.tiles.lruCache.cachedBytes / 2 ** 20).toFixed(1) } : null,
      attributions: S.auth ? S.auth.attributions() : [] };
  }

  const api = {
    GOOGLE, enable, disable, state,
    // for checks: v2 metres of a world point of the Google group, and the ground grid
    toV2: (w) => { if (!S.frame) return null; const o = S.frame.apply(w); o[0] += U.gShift.value.x; o[2] += U.gShift.value.y; const g = S.dem.at(o[0], o[2]); return [o[0], o[1] + U.gDy.value - U.gFlat.value * g, o[2]]; },
    groundAt: (x, z) => (S.dem ? S.dem.at(x, z) : null),
    group: () => S.group,
    // the visual alignment check: Google's own buildings are drawn too (no hiding), so its walls and ours show together
    setClip: (on) => { U.gClip.value = on ? 1 : 0; redraw(); },
    setFlatten: (on) => { U.gFlat.value = on ? 1 : 0; redraw(); },
    maskAt: (x, z) => (S.cpuMask ? (inMask(x, z) ? 1 : 0) : null),
  };
  v2.google = api;
  if (params.get('galign') === '1') api.setClip(false);
  ui.render(state());
  if (params.get('google') !== '0' && (store.get() || S.mock)) enable();
  return api;
}

// ── the control and the attribution line (own styles, so v2.css is untouched) ──
function makeUI({ onKey, onForget, onToggle }) {
  const css = document.createElement('style');
  css.textContent = `
  /* one column at the bottom centre: the control, our own line, then Google's logo and data credits (nothing overlaps the logo) */
  #gwrap { position: fixed; left: 50%; transform: translateX(-50%); bottom: calc(6px + env(safe-area-inset-bottom, 0px)); z-index: 12;
    display: flex; flex-direction: column; align-items: center; max-width: calc(100vw - 24px); pointer-events: none; }
  #g3d { display: flex; flex-direction: column; align-items: center; gap: 6px; font: 12px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif;
    color: #f8ead0; max-width: 100%; pointer-events: none; }
  #g3d > * { pointer-events: auto; }
  #gattr[hidden] { display: none !important; }
  #g3d .pill { background: rgba(18, 11, 4, .72); border: 1px solid rgba(255, 190, 90, .22); border-radius: 999px; padding: 5px 12px; color: inherit;
    font: inherit; cursor: pointer; }
  #g3d .box { background: rgba(17, 10, 3, .97); border: 1px solid rgba(255, 190, 90, .22); border-radius: 12px; padding: 10px 12px; width: 300px;
    max-width: calc(100vw - 24px); box-sizing: border-box; }
  #g3d .box label { display: block; font-weight: 600; margin-bottom: 6px; }
  #g3d .box input { width: 100%; box-sizing: border-box; padding: 7px 9px; border-radius: 8px; border: 1px solid rgba(255, 190, 90, .3);
    background: rgba(0, 0, 0, .35); color: inherit; font: inherit; }
  #g3d .row { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
  #g3d .row button { flex: 1; min-height: 32px; border-radius: 8px; border: 1px solid rgba(255, 190, 90, .3); background: rgba(255, 190, 90, .1);
    color: inherit; font: 600 12px system-ui, sans-serif; cursor: pointer; }
  #g3d .row button.go { background: #ffc663; color: #20160a; border-color: transparent; }
  #g3d .note { margin-top: 8px; color: rgba(248, 234, 208, .7); font-size: 11px; }
  #g3d .note a { color: #ffc663; }
  #g3d .msg { margin-top: 6px; color: #ffd28a; }
  #gattr { display: flex; align-items: flex-end; gap: 0; pointer-events: none; max-width: 100%; }
  /* the logo: 16-19 dp high, clear space 10 left/right/top and 5 below, nothing over it */
  #gattr .logo { display: block; box-sizing: content-box; height: ${GOOGLE.LOGO_HEIGHT_PX}px; width: auto; padding: 10px 10px 5px 10px; flex: none; }
  #gattr .data { font: 11px/1.3 system-ui, sans-serif; color: #fff; background: rgba(0, 0, 0, .55); padding: 2px 7px; border-radius: 4px;
    margin-bottom: 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 60vw; pointer-events: auto; }
  #gours { font: 11px/1.3 system-ui, sans-serif; color: rgba(248, 234, 208, .9); background: rgba(18, 11, 4, .6); border-radius: 6px; padding: 2px 8px;
    text-align: center; }
  @media (max-width: 600px) { #gwrap { bottom: calc(36px + env(safe-area-inset-bottom, 0px)); } #gattr .data { max-width: 52vw; } }
  `;
  document.head.appendChild(css);
  const root = document.createElement('div'); root.id = 'g3d';
  const attr = document.createElement('div'); attr.id = 'gattr'; attr.hidden = true;
  attr.innerHTML = `<img class="logo" src="${here('./google/google-maps-logo.svg')}" alt="Google Maps" aria-label="Google Maps"><span class="data" title=""></span>`;
  const wrap = document.createElement('div'); wrap.id = 'gwrap';
  wrap.append(root, attr);
  document.body.append(wrap);
  const dataEl = attr.querySelector('.data');
  let open = false, last = null;
  const TERMS = 'Google Maps content in this mode is subject to the <a href="https://maps.google.com/help/terms_maps/" target="_blank" rel="noopener">Google Maps Additional Terms of Service</a> and the <a href="https://policies.google.com/privacy" target="_blank" rel="noopener">Google Privacy Policy</a>.';
  function render(st) {
    last = st;
    attr.hidden = !st.on;
    if (st.on) {
      root.innerHTML = (open ? `<div class="box"><div class="row"><button type="button" data-a="toggle">Turn off</button><button type="button" data-a="forget">Forget key</button></div>`
          + `<div class="note">${TERMS}</div></div>` : '')
        + (st.status ? `<div class="pill msg" role="status">${esc(st.status)}</div>` : '')
        + `<button class="pill" type="button" data-a="menu">Google 3D: on</button>`
        + `<div id="gours">3D city: Google Maps. The highlighted buildings and the walking route are Flyover's own, not Google's.</div>`;
    } else if (st.keySaved && !open) {
      root.innerHTML = `<button class="pill" type="button" data-a="menu">Google 3D: off</button>` + (st.status ? `<div class="pill msg" role="status">${esc(st.status)}</div>` : '');
    } else {
      root.innerHTML = open || st.status
        ? `<div class="box"><label for="g3d-key">Google 3D</label>`
          + (st.keySaved ? `<div class="row"><button class="go" type="button" data-a="toggle">Turn on</button><button type="button" data-a="forget">Forget key</button></div>`
            : `<input id="g3d-key" type="password" autocomplete="off" spellcheck="false" placeholder="Google 3D: paste API key">`
            + `<div class="row"><button class="go" type="button" data-a="save">Use this key</button><button type="button" data-a="close">Close</button></div>`)
          + `<div class="note">The key is kept in this browser only, never sent anywhere but Google. ${TERMS}</div>`
          + (st.status ? `<div class="msg" role="status">${esc(st.status)}</div>` : '') + `</div>`
        : `<button class="pill" type="button" data-a="menu">Google 3D</button>`;
    }
  }
  root.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    if (a === 'menu') { open = !open; render(last); }
    else if (a === 'close') { open = false; last.status = ''; render(last); }
    else if (a === 'save') { const v = (root.querySelector('#g3d-key')?.value || '').trim(); if (v) { open = false; onKey(v); } }
    else if (a === 'toggle') { open = false; onToggle(); }
    else if (a === 'forget') { open = false; onForget(); }
  });
  root.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'g3d-key') root.querySelector('[data-a="save"]').click(); });
  // keep clear of the page's own credits footer (#credits): Google's logo and credits must not be overlapped by another
  // attribution, so the column sits above the footer wherever the two would meet
  function layout() {
    const c = document.getElementById('credits');
    let bottom = '';
    if (c && c.getClientRects().length && getComputedStyle(c).visibility !== 'hidden') {
      const r = c.getBoundingClientRect(), w = wrap.getBoundingClientRect();
      if (r.width && r.left < w.right + 8 && r.right > w.left - 8) bottom = `${Math.ceil(innerHeight - r.top + 4)}px`;
    }
    if (wrap.style.bottom !== bottom) wrap.style.bottom = bottom;
  }
  addEventListener('resize', layout);
  return {
    render, layout,
    attr(list) { const s = list.length ? list.join('; ') : 'Google'; if (dataEl.textContent !== s) { dataEl.textContent = s; dataEl.title = s; } },
  };
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// for the check script: the same projection pieces, so a test can place a marker exactly
export const _test = { ecef, frameAt, fitFrame, EARTH_R, toLocal };
