/**
 * pattern-lowpass.js — the wrap-safe separable box blur that band-limits a
 * fill-extrusion-pattern tile before MapLibre samples it LINEAR with no
 * mipmaps (docs/pattern-sampling.md §1: `ImageManager.bind()` hardcodes
 * `gl.LINEAR`, no mip level ever generated). This is the "shim-lowpass" fix
 * (docs/shimmer-verdict.md) — a real, blind-confirmed, partial mitigation
 * for the window-crawl defect (docs/shimmer-mechanism.md) — EXTRACTED so
 * more than one atlas can share it (QUEUE, docs/facade-atlas-map.md §2: six
 * files paint `fill-extrusion-pattern` with no band-limit at all).
 *
 * This file is math ONLY, originally extracted from js/facades.js's own
 * `softenTile`. It carries no taste (no per-family radius, no per-tier
 * calibration) — each caller keeps its own SOFTEN-shaped config, because
 * facades.js's families and drag.js's families are different vocabularies
 * and a shared taste table would be the wrong shape (see the commit message
 * for why a shared *config* was rejected but a shared *kernel* was not).
 *
 * WHY WRAPPING. The tile repeats, so a clamped blur would darken the four
 * edges and put a visible grid seam every repeat across every wall in the
 * city — the same class of bug as the fascia band that appeared three times
 * up DKR's elevation (js/facades.js's own comment, quoted there verbatim).
 *
 * WHY A SLIDING WINDOW. O(res^2) regardless of radius, not O(res^2 * r): step
 * the window by one and the new sum is the old sum plus the entering sample
 * minus the leaving one. facades.js's own measurement: adding the two-tier
 * chain took `updateFacades` 57.7ms -> 119.7ms, and switching its blur to
 * this shape bought back ~19ms of that. Do not go back to a re-summed loop.
 *
 * `tmp` holds the horizontal window SUM, not the mean, so the vertical
 * running total is a sum of small integers in double and carries no rounding
 * — verified against the old per-pixel implementation over the real atlas:
 * max channel difference 0 on every image (see the facades.js history this
 * was lifted from).
 *
 * Public: window.PatternLowpass = { blurWrap }
 */
(function () {
  'use strict';

  // Reused scratch buffer across every call, from every caller. Safe because
  // this is synchronous, single-threaded canvas work — only one blur is ever
  // in flight — same lifetime facades.js's own module-private `_blurTmp` had,
  // just no longer duplicated per file.
  let _tmp = null;
  // Extra scratch is 40 bytes per largest-seen side texel, not per image.
  // Wrap indices are keyed by both size and radius; no pixel results are cached.
  let _sums = null, _enter = null, _leave = null;
  let _indexRes = 0, _indexRadius = 0;

  /**
   * Wrap-safe separable box blur, blended back over `d` by amount `a`.
   *
   * @param {Uint8ClampedArray} d   RGBA buffer, res*res*4 bytes, mutated in
   *                                place. Alpha is filtered too: opaque facade
   *                                atlases carry their glass mask in alpha.
   * @param {number} res   width == height of `d`, in texels.
   * @param {number} r     box radius in texels. 0 (or falsy) is a no-op.
   * @param {number} a     0..1 blend amount. <= 0 is a no-op.
   */
  function blurWrap(d, res, r, a) {
    if (!r || a <= 0) return;
    const N = res * res, win = r * 2 + 1, area = win * win;
    if (!_tmp || _tmp.length < N * 4) _tmp = new Float32Array(N * 4);
    const tmp = _tmp;
    const wrap = i => ((i % res) + res) % res;
    const stride = res * 4;
    if (!_sums || _sums.length < stride) _sums = new Float64Array(stride);
    if (!_enter || _enter.length < res) {
      _enter = new Int32Array(res); _leave = new Int32Array(res);
    }
    if (_indexRes !== res || _indexRadius !== r) {
      for (let i = 0; i < res; i++) {
        _enter[i] = wrap(i + r + 1) * 4;
        _leave[i] = wrap(i - r) * 4;
      }
      _indexRes = res; _indexRadius = r;
    }
    // horizontal — tmp keeps the window SUM
    for (let y = 0; y < res; y++) {
      const row = y * res;
      let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
      for (let k = -r; k <= r; k++) {
        const i = (row + wrap(k)) * 4;
        s0 += d[i]; s1 += d[i + 1]; s2 += d[i + 2]; s3 += d[i + 3];
      }
      for (let x = 0; x < res; x++) {
        const o = (row + x) * 4;
        tmp[o] = s0; tmp[o + 1] = s1; tmp[o + 2] = s2; tmp[o + 3] = s3;
        const ia = row * 4 + _enter[x], is = row * 4 + _leave[x];
        s0 += d[ia] - d[is]; s1 += d[ia + 1] - d[is + 1]; s2 += d[ia + 2] - d[is + 2]; s3 += d[ia + 3] - d[is + 3];
      }
    }
    // Keep one running vertical sum per column, but visit full contiguous rows.
    // The former column-first pass jumped an entire row for every sample and
    // repeatedly evicted cache lines on the larger facade repeats. Each lane
    // still receives the identical additions/subtractions in the same order.
    // Float64 matches the previous local-number accumulators; the horizontal
    // intermediate remains Float32, preserving the original rounding contract.
    const sums = _sums;
    sums.fill(0, 0, stride);
    for (let k = -r; k <= r; k++) {
      const row = wrap(k) * stride;
      for (let x = 0; x < stride; x++) sums[x] += tmp[row + x];
    }
    for (let y = 0; y < res; y++) {
      const row = y * stride, enter = _enter[y] * res, leave = _leave[y] * res;
      for (let x = 0; x < stride; x++) {
        const i = row + x;
        d[i] += (sums[x] / area - d[i]) * a;
        sums[x] += tmp[enter + x] - tmp[leave + x];
      }
    }
  }

  window.PatternLowpass = { blurWrap };
})();
