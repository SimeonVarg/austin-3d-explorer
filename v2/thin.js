// v2/thin.js - a part thinner than a pixel is drawn ONE pixel wide, at an alpha equal to its true share of the pixel (2026-11-12).
//
// PROTOTYPE behind ?thin=1 (rule 15). On a screen with one canvas pixel per CSS pixel (the owner's monitor) a window bar 0.1 m wide
// is under a pixel from about 200 m on. Four samples a pixel then draw it as dashes, and the dashes crawl when the camera moves
// (measured 2026-11-12 at 2560 x 1300: 29 % of all frame-to-frame flicker sits in 5 % of the pixels, on such bars). A 16-sample
// picture shows what is right: a faint, CONTINUOUS line. This rule draws that line: in the vertex shader the bar is widened about
// its own axis until it is THIN.PX pixels wide, and its alpha is its true width over the drawn width; the canvas's multisampling
// turns the alpha into coverage (alphaToCoverage), so nothing is blended and nothing is sorted.
//
// A bar here is a separate piece of the mesh (triangles joined through shared positions) that is long and at most MAX_W wide
// (the prototype's detector; bars that are joined into a lattice need the local width of a face, measured when the tile is built).
// Per vertex: aThin.xyz = the vector from the bar's axis to the vertex, aThin.w = the bar's width in metres (0 = not a bar).
import * as THREE from 'three';

const PQ = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
export const THIN = {
  ON: PQ.get('thin') === '1',
  MAX_W: 0.35,        // a bar's two short sides are at most this (metres)...
  MIN_ASPECT: 3,      // ...and it is at least this many times as long as it is wide
  PX: PQ.has('thinpx') ? +PQ.get('thinpx') : 1.5,   // a bar is never drawn narrower than this many full-size pixels
  MAX_F: 8,           // ...nor widened more than this many times (past that it is under 1/8 of a pixel: it is left out)
};
export const THIN_PIX = { value: 0 };     // what one full-size pixel spans at 1 m, x THIN.PX (tiles.js sets it)
const MAX_F = { value: THIN.MAX_F };
export const thinStats = { meshes: 0, bars: 0, vertices: 0, ms: 0 };

// find the bars of one mesh and give its geometry the aThin attribute; false when it has none
export function thinBars(mesh) {
  const t0 = performance.now(), g = mesh.geometry, pos = g.attributes.position, idx = g.index;
  if (!pos || !idx || g.attributes.aThin) return !!(g.attributes.aThin);
  mesh.updateWorldMatrix(true, false);
  const M = mesh.matrixWorld, n = pos.count, W = new Float32Array(n * 3), v = new THREE.Vector3();
  for (let i = 0; i < n; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(M); W[i * 3] = v.x; W[i * 3 + 1] = v.y; W[i * 3 + 2] = v.z; }
  // pieces: triangles joined through positions that are the same to 2 mm
  const key = new Map(), vid = new Int32Array(n); let nv = 0;
  for (let i = 0; i < n; i++) { const k = Math.round(W[i * 3] * 500) + ',' + Math.round(W[i * 3 + 1] * 500) + ',' + Math.round(W[i * 3 + 2] * 500); let q = key.get(k); if (q === undefined) { q = nv++; key.set(k, q); } vid[i] = q; }
  const par = new Int32Array(nv); for (let i = 0; i < nv; i++) par[i] = i;
  const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
  const I = idx.array;
  for (let t = 0; t < I.length; t += 3) { const a = find(vid[I[t]]); par[find(vid[I[t + 1]])] = a; par[find(vid[I[t + 2]])] = a; }
  const pieces = new Map();
  for (let i = 0; i < n; i++) { const r = find(vid[i]); let p = pieces.get(r); if (!p) pieces.set(r, p = []); p.push(i); }
  const out = new Float32Array(n * 4), inv = new THREE.Matrix3().setFromMatrix4(M).invert(), o = new THREE.Vector3();
  let bars = 0, verts = 0;
  for (const p of pieces.values()) {
    if (p.length < 4 || p.length > 400) continue;
    let mx = 0, my = 0, mz = 0; for (const i of p) { mx += W[i * 3]; my += W[i * 3 + 1]; mz += W[i * 3 + 2]; } mx /= p.length; my /= p.length; mz /= p.length;
    const C = [0, 0, 0, 0, 0, 0]; for (const i of p) { const x = W[i * 3] - mx, y = W[i * 3 + 1] - my, z = W[i * 3 + 2] - mz; C[0] += x * x; C[1] += x * y; C[2] += x * z; C[3] += y * y; C[4] += y * z; C[5] += z * z; }
    // the long axis: the covariance's first direction (power iteration)
    let a = [1, 0.37, 0.21];
    for (let k = 0; k < 40; k++) { const b = [C[0] * a[0] + C[1] * a[1] + C[2] * a[2], C[1] * a[0] + C[3] * a[1] + C[4] * a[2], C[2] * a[0] + C[4] * a[1] + C[5] * a[2]], l = Math.hypot(b[0], b[1], b[2]) || 1; a = [b[0] / l, b[1] / l, b[2] / l]; }
    let lo = 1e9, hi = -1e9, r2 = 0;
    for (const i of p) { const x = W[i * 3] - mx, y = W[i * 3 + 1] - my, z = W[i * 3 + 2] - mz, d = x * a[0] + y * a[1] + z * a[2]; if (d < lo) lo = d; if (d > hi) hi = d; r2 = Math.max(r2, x * x + y * y + z * z - d * d); }
    const width = 2 * Math.sqrt(r2), length = hi - lo;     // (the widest the piece is across its axis: a little over a box's diagonal)
    if (!(width > 0.005 && width <= THIN.MAX_W * 1.42 && length >= THIN.MIN_ASPECT * width)) continue;
    bars++; verts += p.length;
    for (const i of p) { const x = W[i * 3] - mx, y = W[i * 3 + 1] - my, z = W[i * 3 + 2] - mz, d = x * a[0] + y * a[1] + z * a[2];
      o.set(x - d * a[0], y - d * a[1], z - d * a[2]).applyMatrix3(inv);
      out[i * 4] = o.x; out[i * 4 + 1] = o.y; out[i * 4 + 2] = o.z; out[i * 4 + 3] = width / 1.42; }
  }
  if (!bars) { thinStats.ms += performance.now() - t0; return false; }
  g.setAttribute('aThin', new THREE.BufferAttribute(out, 4));
  // the bars are drawn as a group of their own (thinMaterial: blended): all other triangles first in the index, then the bars
  { const A = [], B = []; for (let t = 0; t < I.length; t += 3) (out[I[t] * 4 + 3] > 0 ? B : A).push(I[t], I[t + 1], I[t + 2]);
    const J = new (I.constructor)(I.length); J.set(A, 0); J.set(B, A.length); g.setIndex(new THREE.BufferAttribute(J, 1));
    g.clearGroups(); g.addGroup(0, A.length, 0); g.addGroup(A.length, B.length, 1); }
  thinStats.ms += performance.now() - t0;
  thinStats.meshes++; thinStats.bars += bars; thinStats.vertices += verts;
  return true;
}

// The material of the bars of a mesh: the mesh's own material, widened in the vertex shader, alpha = true width / drawn width,
// BLENDED over what is behind (it is drawn after everything opaque; it still writes depth). Alpha to coverage was tried first:
// with 4 samples a pixel a faint line has 0 or 1 sample, and the line came out dotted (2026-11-12).
export function thinMaterial(material) {
  if (!material) return material;
  if (material.userData.v2ThinTwin) return material.userData.v2ThinTwin;
  const twin = material.clone();
  const base = material.onBeforeCompile, key = material.customProgramCacheKey ? material.customProgramCacheKey.bind(material) : () => '';
  twin.onBeforeCompile = (sh, r) => {
    if (base) base.call(material, sh, r);
    sh.uniforms.uThinPix = THIN_PIX; sh.uniforms.uThinMaxF = MAX_F;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aThin;\nuniform float uThinPix;\nuniform float uThinMaxF;\nvarying float vThinA;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  vThinA = 1.0;
  if (aThin.w > 0.0) {
    float v2tz = -(modelViewMatrix * vec4(transformed, 1.0)).z;
    float v2tf = v2tz * uThinPix / aThin.w;                 // how many times too narrow the bar is for the pixel here
    vThinA = v2tf > uThinMaxF ? 0.0 : 1.0 / max(v2tf, 1.0);
    transformed += aThin.xyz * (clamp(v2tf, 1.0, uThinMaxF) - 1.0);
  }`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vThinA;')
      .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.a *= vThinA;\n  if (diffuseColor.a <= 0.003) discard;');
  };
  twin.customProgramCacheKey = () => key() + '|v2-thin';
  twin.transparent = true; twin.depthWrite = true; twin.userData = { ...material.userData, v2ThinTwin: null, v2IsThin: true };
  material.userData.v2ThinTwin = twin;
  return twin;
}
