/**
 * facades.js — procedural facade textures for Austin 3D Explorer
 *
 * MapLibre v5 supports `fill-extrusion-pattern`, and it tiles in WORLD space:
 * a pattern keeps a constant physical size as you fly, so a window grid reads
 * as real windows rather than screen-space noise. That is the single biggest
 * upgrade available to a fill-extrusion city — it turns flat prisms into
 * buildings.
 *
 * The catch: a pattern REPLACES `fill-extrusion-color`, so per-building colour
 * would be lost. Fix: quantise the 900-odd baked wall colours down to a small
 * adaptive palette (~14 buckets), then generate one pattern image per
 * (facade family × colour bucket). Buildings keep their identity, and the
 * flattening is an art-direction win — 14 deliberate tones beat 900 muddy
 * near-duplicates.
 *
 * Patterns are regenerated (in place, via map.updateImage) when the
 * time-of-day changes, so glass goes cool-dark by day, amber-reflective at
 * golden hour, and a scatter of windows lights up warm at night.
 *
 * Public (window) API:
 *   quantiseFacades(features)  — assign wp/wf per feature, build the palette
 *   initFacades(map)           — register every needed pattern image
 *   updateFacades(map, p)      — repaint the images for time-of-day p
 *   FACADE_PATTERN_EXPR        — paint value for fill-extrusion-pattern
 */
(function () {
  'use strict';

  const TILE = 64;              // px per pattern repeat (~20 m of wall)
  const TARGET_BUCKETS = 14;    // colour buckets kept after merging

  // Facade families — window geometry, chosen by height/class.
  //   lo  low-rise houses + sheds: sparse, large openings
  //   md  walk-ups, campus halls: punched-window grid
  //   tw  towers: dense curtain-wall grid
  //   dk  parking decks: open horizontal slots, no glass
  const GRIDS = {
    lo: { rows: 2, cols: 3, w: 13, h: 11 },
    md: { rows: 5, cols: 4, w: 10, h: 8 },
    tw: { rows: 6, cols: 6, w: 7,  h: 7 },
    dk: null, // drawn as bands
  };

  let palette = [];   // [{ wd, wg, wn }]
  let combos = [];    // ['md07', 'tw03', ...] — only families/buckets in use

  // ── colour helpers ────────────────────────────────────────────────
  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
  }
  function rgbToHex(r,g,b) {
    const c = n => Math.max(0,Math.min(255,Math.round(n))).toString(16).padStart(2,'0');
    return `#${c(r)}${c(g)}${c(b)}`;
  }
  function mix(a, b, t) {
    const A = Array.isArray(a) ? a : hexToRgb(a), B = Array.isArray(b) ? b : hexToRgb(b);
    return [A[0]+(B[0]-A[0])*t, A[1]+(B[1]-A[1])*t, A[2]+(B[2]-A[2])*t];
  }
  function rgbToHsl(r,g,b) {
    r/=255; g/=255; b/=255;
    const mx = Math.max(r,g,b), mn = Math.min(r,g,b), l = (mx+mn)/2;
    if (mx === mn) return [0, 0, l];
    const d = mx-mn, s = l > 0.5 ? d/(2-mx-mn) : d/(mx+mn);
    let h;
    if (mx === r)      h = ((g-b)/d + (g < b ? 6 : 0));
    else if (mx === g) h = (b-r)/d + 2;
    else               h = (r-g)/d + 4;
    return [h/6, s, l];
  }
  function dist2(a, b) {
    // Weighted RGB — cheap and good enough for "nearest surviving bucket".
    const dr = a[0]-b[0], dg = a[1]-b[1], db = a[2]-b[2];
    return 2*dr*dr + 4*dg*dg + 3*db*db;
  }

  /**
   * Night walls come from the baked `wn`, which is now correct.
   *
   * History worth keeping, so nobody re-adds it: the bake used to mix 30% of a
   * warm "lit window" tint into the WALL, landing the whole city on mid
   * olive-khaki after dark (#63615b, #7b6d53) — brighter than the night sky
   * behind it, so the skyline had no silhouette. This file worked around it by
   * deriving its own night wall and ignoring `wn`. That workaround is gone:
   * scripts/bake_detail.py:night_wall() now IS that derivation, verified to
   * produce byte-identical values across all 2,453 features, so there is one
   * definition instead of two.
   */
  function familyFor(props) {
    const cls = props.building_class || '';
    if (/parking|garage|carport/.test(cls)) return 'dk';
    const h = props.final_height || 0;
    if (h < 5)  return 'lo';
    if (h >= 26) return 'tw';
    return 'md';
  }

  // ── quantisation ──────────────────────────────────────────────────
  /**
   * Assign `wp` (pattern image id) and `wf` (family) to every feature, and
   * derive the shared colour palette from the data itself so the scene keeps
   * its real character instead of snapping to a guessed set of tones.
   */
  window.quantiseFacades = function quantiseFacades(features) {
    // 1. coarse keys → groups
    const groups = new Map();
    for (const f of features) {
      const p = f.properties;
      if (!p || !p.wd) continue;
      const rgb = hexToRgb(p.wd);
      const [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
      const key = s < 0.10
        ? `n${Math.floor(l * 5)}`
        : `${Math.floor(h * 12)}-${Math.floor(l * 5)}-${s < 0.22 ? 0 : 1}`;
      let g = groups.get(key);
      if (!g) { g = { n: 0, wd: [0,0,0], wg: [0,0,0], wn: [0,0,0] }; groups.set(key, g); }
      g.n++;
      const acc = (arr, c) => { arr[0]+=c[0]; arr[1]+=c[1]; arr[2]+=c[2]; };
      acc(g.wd, rgb); acc(g.wg, hexToRgb(p.wg || p.wd)); acc(g.wn, hexToRgb(p.wn || p.wd));
    }

    // 2. keep the most populous groups, mean-colour each
    const all = [...groups.entries()]
      .map(([key, g]) => ({
        key,
        n: g.n,
        wd: g.wd.map(v => v / g.n),
        wg: g.wg.map(v => v / g.n),
        wn: g.wn.map(v => v / g.n),
      }))
      .sort((a, b) => b.n - a.n);

    const kept = all.slice(0, TARGET_BUCKETS);
    const index = new Map();                       // group key → bucket idx
    kept.forEach((k, i) => index.set(k.key, i));
    // 3. fold the tail into its nearest survivor
    for (const g of all.slice(TARGET_BUCKETS)) {
      let best = 0, bestD = Infinity;
      kept.forEach((k, i) => { const d = dist2(g.wd, k.wd); if (d < bestD) { bestD = d; best = i; } });
      index.set(g.key, best);
    }

    palette = kept.map(k => ({
      wd: rgbToHex(...k.wd), wg: rgbToHex(...k.wg), wn: rgbToHex(...k.wn),
    }));

    // 4. stamp every feature, collecting the (family, bucket) combos in use
    const used = new Set();
    for (const f of features) {
      const p = f.properties;
      if (!p || !p.wd) continue;
      const rgb = hexToRgb(p.wd);
      const [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
      const key = s < 0.10
        ? `n${Math.floor(l * 5)}`
        : `${Math.floor(h * 12)}-${Math.floor(l * 5)}-${s < 0.22 ? 0 : 1}`;
      const b = index.get(key) || 0;
      const fam = familyFor(p);
      const id = fam + String(b).padStart(2, '0');
      p.wp = id;
      p.wf = fam;
      used.add(id);
    }
    combos = [...used];
    return { buckets: palette.length, patterns: combos.length };
  };

  // Parts inherit their parent's look; they carry baked colours but no class,
  // so classify them by their own volume.
  window.quantisePartFacades = function quantisePartFacades(features) {
    if (!palette.length) return;
    for (const f of features) {
      const p = f.properties;
      if (!p || !p.wd) continue;
      const rgb = hexToRgb(p.wd);
      const [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
      let best = 0, bestD = Infinity;
      palette.forEach((k, i) => { const d = dist2(rgb, hexToRgb(k.wd)); if (d < bestD) { bestD = d; best = i; } });
      const span = (p.h || 0) - (p.base || 0);
      const fam = span >= 26 ? 'tw' : span < 5 ? 'lo' : 'md';
      p.wp = fam + String(best).padStart(2, '0');
      p.wf = fam;
      if (combos.indexOf(p.wp) === -1) combos.push(p.wp);
    }
  };

  // ── pattern drawing ───────────────────────────────────────────────
  function lerpHexAt(bucket, p) {
    return p <= 0.5
      ? mix(bucket.wd, bucket.wg, p / 0.5)
      : mix(bucket.wg, bucket.wn, (p - 0.5) / 0.5);
  }

  // Deterministic 0..1 — lets each bucket light a different window scatter at
  // night without any randomness that would flicker between repaints.
  function hash01(a, b, c) {
    let x = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
    x = (x ^ (x >> 13)) * 1274126177;
    return ((x ^ (x >> 16)) >>> 0) / 4294967295;
  }

  function css(rgb, alpha) {
    return `rgba(${Math.round(rgb[0])},${Math.round(rgb[1])},${Math.round(rgb[2])},${alpha == null ? 1 : alpha})`;
  }

  /** Draw one (family, bucket) tile for time-of-day p into a canvas ctx. */
  function drawTile(ctx, fam, bucketIdx, p) {
    const bucket = palette[bucketIdx] || palette[0];
    const wallBase = lerpHexAt(bucket, p);
    // TWO night factors, deliberately on different schedules.
    //
    // `night` (p-driven) drives the LIT WINDOWS, and its lag is intentional:
    // the city's lights come up as the sky finishes darkening, not the instant
    // the sun clears the horizon.
    //
    // `dark` (sun-elevation-driven) drives how far the WALL itself falls. Riding
    // the p-schedule for both left walls 60% golden-lit at p=0.7, when the sun is
    // already 8° below the horizon — measured as an INVERTED dusk silhouette
    // (sky luma 75.7 against wall 88.5), the city glowing against a darker sky.
    // Walls follow the sun; windows follow the hour.
    const night = Math.max(0, (p - 0.55) / 0.45);
    const sunElev = (typeof window.skyBodies === 'function') ? window.skyBodies(p).sun.elev : (0.5 - p) * 100;
    const dark = Math.max(night, Math.min(1, Math.max(0, -sunElev / 9)));
    const golden = 1 - Math.abs(p - 0.5) / 0.5;     // peaks at golden hour

    // Pull the wall the rest of the way toward its night tone once the sun is
    // actually down, so the skyline silhouettes correctly through dusk.
    const wall = mix(wallBase, bucket ? hexToRgb(bucket.wn) : wallBase, Math.max(0, dark - night));
    ctx.clearRect(0, 0, TILE, TILE);
    ctx.fillStyle = css(wall);
    ctx.fillRect(0, 0, TILE, TILE);

    // Glass tone: cool + dark by day, amber-reflective at golden, near-black at
    // night (the lit windows are painted over it).
    let glass = mix(wall, [46, 58, 74], 0.62);
    glass = mix(glass, [255, 176, 96], golden * 0.45);
    glass = mix(glass, [12, 15, 28], dark * 0.9);
    // Two brightnesses of lit window. One flat value makes every tower read as
    // a block of white noise from a distance; a dim tier gives the skyline
    // texture and keeps the bright ones feeling like actual lights.
    const litBright = [232, 176, 104];
    const litDim    = [126, 100, 66];

    if (fam === 'dk') {
      // Parking deck: open horizontal slots + a thin bright deck edge.
      const shade = mix(wall, [0, 0, 0], 0.55 + night * 0.2);
      for (let y = 5; y < TILE; y += 13) {
        ctx.fillStyle = css(shade);
        ctx.fillRect(0, y, TILE, 7);
        ctx.fillStyle = css(mix(wall, [255, 255, 255], 0.18), 0.85);
        ctx.fillRect(0, y + 7, TILE, 1);
      }
      return;
    }

    const g = GRIDS[fam] || GRIDS.md;
    const stepX = TILE / g.cols, stepY = TILE / g.rows;
    const offX = (stepX - g.w) / 2, offY = (stepY - g.h) / 2;

    // Faint floor lines give the wall texture even where windows are sparse.
    ctx.fillStyle = css(mix(wall, [0, 0, 0], 0.14), 0.55);
    for (let r = 0; r < g.rows; r++) ctx.fillRect(0, Math.round(r * stepY), TILE, 1);

    // A bright reveal reads as a recessed opening in daylight, but after dark a
    // pale grid over every wall turns the city into graph paper — so the frame
    // fades toward the wall as night falls, leaving only the lit panes.
    const frame = mix(wall, [255, 255, 255], 0.22 * (1 - dark * 0.85));
    const sill  = mix(wall, [0, 0, 0], 0.3);
    // Occupancy varies by bucket so neighbouring buildings don't light up in
    // lockstep — a whole city at one brightness reads as a texture, not a city.
    const occupancy = 0.14 + (bucketIdx % 5) * 0.06;

    for (let r = 0; r < g.rows; r++) {
      for (let c = 0; c < g.cols; c++) {
        const x = Math.round(c * stepX + offX), y = Math.round(r * stepY + offY);
        ctx.fillStyle = css(frame);
        ctx.fillRect(x - 1, y - 1, g.w + 2, g.h + 2);

        const roll = hash01(bucketIdx, r, c);
        const isLit = night > 0.05 && roll < occupancy;
        const lit = roll < occupancy * 0.45 ? litBright : litDim;
        ctx.fillStyle = isLit
          ? css(mix(glass, lit, Math.min(1, night * 1.3)))
          : css(glass);
        ctx.fillRect(x, y, g.w, g.h);

        // Sill shadow — one pixel of contact under every opening.
        ctx.fillStyle = css(sill, 0.6 * (1 - dark * 0.6));
        ctx.fillRect(x - 1, y + g.h + 1, g.w + 2, 1);
      }
    }
  }

  let _canvas = null, _ctx = null;
  function tileData(fam, bucketIdx, p) {
    if (!_canvas) {
      _canvas = document.createElement('canvas');
      _canvas.width = _canvas.height = TILE;
      _ctx = _canvas.getContext('2d', { willReadFrequently: true });
    }
    drawTile(_ctx, fam, bucketIdx, p);
    const img = _ctx.getImageData(0, 0, TILE, TILE);
    return { width: TILE, height: TILE, data: new Uint8Array(img.data.buffer.slice(0)) };
  }

  function parseId(id) { return { fam: id.slice(0, 2), idx: parseInt(id.slice(2), 10) }; }

  window.initFacades = function initFacades(map, p) {
    if (!palette.length) return 0;
    for (const id of combos) {
      const { fam, idx } = parseId(id);
      if (map.hasImage && map.hasImage(id)) continue;
      try { map.addImage(id, tileData(fam, idx, p)); } catch (e) { /* already added */ }
    }
    return combos.length;
  };

  window.updateFacades = function updateFacades(map, p) {
    if (!palette.length) return;
    for (const id of combos) {
      const { fam, idx } = parseId(id);
      try {
        if (map.hasImage && map.hasImage(id)) map.updateImage(id, tileData(fam, idx, p));
        else map.addImage(id, tileData(fam, idx, p));
      } catch (e) { /* image not registered yet */ }
    }
  };

  // Fall back to a plain fill where a feature somehow has no pattern.
  window.FACADE_PATTERN_EXPR = ['coalesce', ['get', 'wp'], 'md00'];
  window.facadePalette = () => palette;
})();
