/**
 * lib/pattern.mjs - the window rule of a `bays` skin, in plain JavaScript. Two jobs:
 *   1. windowsFor(): the rectangles the app's generator (js/slopes-apartments.js: skinBays + windowsFromBays) cuts
 *      on a wall of length L, from the recipe's numbers only. verify-recipe.mjs compares this to the geometry.
 *   2. cum1D() / coverage(): the closed-form integral the fragment shader uses (page/facade.js has the GLSL twin of
 *      the same function). selftest.mjs checks it against brute-force sampling, so the shader's maths is tested
 *      without a GPU.
 * Every number comes from the recipe (data/apartments/<slug>.json): bay, window {w,h,sill}, reveal, floors.
 */

/** the generator's own rule: n = max(1, round(L / bay)), mod = L / n, one window per bay per floor, a window is
 *  kept only when it clears the wall's ends by 0.05 m and its top is inside the band (windowsFromBays). */
export function windowsFor(Lgeom, r, hs = 1) {
  const L = Lgeom / hs, n = Math.max(1, Math.round(L / r.bay)), mod = L / n, out = [];
  for (let k = 0; k < r.rowCount; k++) {
    const zb = r.rowFirst + k * r.rowPitch + r.window.sill, zt = zb + r.window.h;
    if (zt > r.z1 + 1e-6) continue;
    for (let i = 0; i < n; i++) {
      const c = (i + 0.5) * mod, s0 = c - r.window.w / 2, s1 = c + r.window.w / 2;
      if (s0 < 0.05 || s1 > L - 0.05) continue;
      out.push({ s0: s0 * hs, s1: s1 * hs, z0: zb, z1: zt });
    }
  }
  return out;
}

/** the shader's per-face constants for the s axis: which bays carry a window. */
export function bayParams(Lgeom, r, hs = 1) {
  const L = Lgeom / hs, n = Math.max(1, Math.round(L / r.bay)), mod = L / n;
  const a = mod / 2 - r.window.w / 2, ok = a >= 0.05;
  return { n, mod: mod * hs, a: a * hs, b: (a + r.window.w) * hs, i0: ok ? 0 : 1, i1: ok ? n : n - 1 };
}

/** integral from 0 to x of a train of pulses [i*P + a, i*P + b] for i in [i0, i1). Closed form, no loop. */
export function cum1D(x, P, a, b, i0, i1) {
  if (i1 <= i0 || x <= 0) return 0;
  const k = Math.floor(x / P), full = Math.min(Math.max(k, i0), i1) - i0;
  let c = full * (b - a);
  if (k >= i0 && k < i1) c += Math.min(Math.max(x - k * P - a, 0), b - a);
  return c;
}
/** box-filtered value of the pulse train over [x - h, x + h]: 0 to 1. */
export function coverage(x, h, P, a, b, i0, i1) {
  h = Math.max(h, 1e-5);
  return (cum1D(x + h, P, a, b, i0, i1) - cum1D(x - h, P, a, b, i0, i1)) / (2 * h);
}
