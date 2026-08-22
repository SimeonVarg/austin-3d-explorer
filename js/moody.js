/**
 * moody.js — the modern east precinct: Moody Center and the two Dell Med blocks.
 *
 * WHAT THIS FIXES. Everything else on this campus is 1930s limestone and red
 * tile. These three are 2018-2022 and they are the contrast that makes the
 * flyover read as a city rather than a heritage diorama — and all three were
 * rendering as flat tan mesas wearing the generic office-window grid. What this
 * pass gives them is a ground floor, a mechanical crown and a roof edge, which
 * a single extrusion wearing a single tile cannot have at all.
 *
 * ONE CLAIM THIS FILE USED TO MAKE, AND WHY IT IS GONE. The snapshot paints
 * Moody Center's roof #434347 (luma 67) while data/roof_survey.json measures
 * the real membrane at [255,255,253], so "the roof renders as a dark lid" read
 * as the obvious headline. Measured off matched before/after frames it is
 * false: the roof went luma 200.6 -> 192.6, against a control building that
 * moved 0.6. It was ALREADY pale, because in this scene a top face is lifted
 * hard by the sun and exposure and because js/roofs.js's measured roofscape
 * already covers most of it. What this pass actually adds up there is the
 * stepped, oversailing apron rim (+6.6 luma and a visible light ring), not a
 * brightness rescue. See docs/PASS_MOODY.md; the number that was almost
 * shipped came from an isolated render of this module alone, which is a
 * perfectly good measurement of the wrong thing.
 *
 * WHY THIS MODULE DOES NOT USE js/facades.js. That file quantises ~900 baked
 * wall colours down to fourteen buckets derived from the data, and the data is
 * Austin, so nearly all of them are tan. Anything with a distinctive material
 * loses: bake_stadium.py's header records the 2008 brick end zone being folded
 * back into tan by exactly this path. Moody's dark bronze and Dell Med's cream
 * podium are the entire point of the pass, so this module registers its OWN
 * images, one per band, with the colour baked into the tile — eight images, no
 * quantiser, no bucket to lose to. It also means js/facades.js needs no edit,
 * which matters with six passes running at once.
 *
 * WHAT CANNOT BE DRAWN HERE, measured rather than assumed. `fill-extrusion-
 * pattern` is TILE-locked: a 64 px repeat covers ~30 m of wall at tile zoom 17
 * and ~59 m at 16, so at the zooms this app actually flies one texel is
 * 0.5-0.9 m. Moody's aluminium airfoil fins are 12 in wide on 15-16 in centres
 * — 0.30 m at a 0.39 m pitch, less than half a texel. They CANNOT be drawn, and
 * drawing them anyway would assert a 1.4 m fin, which is a column. What is
 * drawn instead is the fin FIELD: a vertical striation at the finest pitch that
 * survives camera motion, which is the honest distant read of that wall.
 *
 * EVERY TILE HERE IS VERTICALLY UNIFORM, and that is deliberate. The repo's own
 * documentation disagrees with itself about whether a pattern's vertical phase
 * is anchored to the extrusion base or is uncontrollable, so this module
 * assumes neither: no tile puts a one-off feature at a particular height, and
 * all vertical hierarchy comes from the BAND BOUNDARIES, which are geometry.
 * scripts/verify/moody-check.mjs measures which of the two is actually true and
 * prints it, so the next person does not have to guess either.
 *
 * Public (window) API:
 *   initMoody(map)             — add the source + layers (called automatically)
 *   applyMoodyColors(map, p)   — repaint the tiles for time-of-day p (hooked)
 *   moodyGridAudit()           — the glazing check, asserted not claimed
 *   MOODY                      — the taste block (below)
 */
(function () {
  'use strict';

  const q = new URLSearchParams(window.location.search);

  const MOODY = {
    // ?moody=0 removes the pass entirely at load, so moody-perf.mjs can measure
    // the A/B on the same build instead of on two checkouts.
    on: q.get('moody') !== '0',
    minZoom: 14,
    opacity: 1.0,
    // Design scale: the wall-metres one 64 px repeat is assumed to cover. The
    // real value moves with zoom (30 m at tile z17, 59 m at z16), so this is the
    // middle of the range the camera actually flies, exactly as js/facades.js
    // sizes its grids. moody-check.mjs measures the true figure at three zooms.
    designMetresPerTile: 45,
  };
  window.MOODY = MOODY;

  const SRC = 'austin-moody';
  const L_WALL = 'moody-wall';
  const L_ROOF = 'moody-roof';
  const L_PLANT = 'moody-plant';
  const L_CAP = 'moody-cap';
  const DATA = 'data/moody.geojson';
  const TILE = 64;

  // ── colour helpers ─────────────────────────────────────────────────
  function hexToRgb(h) {
    h = h.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function mix(a, b, t) {
    const A = Array.isArray(a) ? a : hexToRgb(a), B = Array.isArray(b) ? b : hexToRgb(b);
    return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t];
  }
  function css(rgb, alpha) {
    return `rgba(${Math.round(rgb[0])},${Math.round(rgb[1])},${Math.round(rgb[2])},${alpha == null ? 1 : alpha})`;
  }
  /** Deterministic 0..1 — a night scatter that does not flicker between repaints. */
  function hash01(a, b, c) {
    let x = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
    x = (x ^ (x >> 13)) * 1274126177;
    return ((x ^ (x >> 16)) >>> 0) / 4294967295;
  }

  // ── The materials, and what is measured about each ─────────────────
  //
  // Sizes are in TEXELS at MOODY.designMetresPerTile, so the metre figure in
  // each comment is the thing to argue with, not the pixel count.
  const M = {
    // moody-plinth — ALPOLIC/fr dark bronze rainscreen at grade, with the
    // storefront openings of the gates cut into it. Panel joints only: the real
    // cassette is ~1.5 m, which is two texels, so they are drawn as
    // single-pixel verticals and nothing finer is attempted.
    PLINTH_JOINT: 9,          // px between vertical panel joints (~6 m)
    PLINTH_JOINT_DARK: 0.14,
    PLINTH_PORTAL_EVERY: 21,  // a glazed gate opening every ~15 m
    PLINTH_PORTAL_W: 6,
    PLINTH_PORTAL_DARK: 0.44,
    PLINTH_PORTAL_NIGHT: 0.55,

    // moody-fins — 67,000 sq ft of MCM in custom dark bronzes behind a screen of
    // 12 in extruded aluminium airfoil fins on 15-16 in centres. The pitch below
    // is 4 px = 2.8 m, seven times the real spacing, because the real spacing is
    // sub-texel. See the header.
    FIN_PITCH: 4,
    FIN_LIT: 0.30,            // the fin face catching sun
    FIN_SHADE: 0.30,          // its own shadow on the wall behind
    FIN_GOLDEN: 0.34,         // bronze goes hot copper at golden hour
    FIN_TINT: [172, 118, 70], // sampled: the lit fin face, moody/02 cluster

    // moody-glass — the concourse ribbon. Vitro Solarban 70 clear with Solargray
    // sections: colour-neutral and highly reflective, so by day it is mostly
    // SKY and after dark it is the brightest thing on the building.
    GLASS_MULLION: 5,         // px (~3.5 m bay)
    GLASS_MULLION_DARK: 0.30,
    GLASS_SKY: [150, 178, 196],
    GLASS_SKY_MIX: 0.34,
    GLASS_NIGHT: [255, 206, 150],
    GLASS_NIGHT_MIX: 0.72,    // an arena concourse is lit as one continuous room

    // moody-fascia — the roof edge that oversails the wall by 5 m. Its outer
    // face is dark metal; the wood soffit underneath cannot be drawn at all,
    // because fill-extrusion renders no underside faces. What IS available is
    // the warm bounce that soffit throws onto the fascia, so the band carries a
    // warm lift that grows toward golden hour.
    FASCIA_SEAM: 13,
    FASCIA_SEAM_DARK: 0.10,
    SOFFIT_TINT: [129, 75, 37],   // sampled: moody/09 wood soffit, 52% cluster
    SOFFIT_BOUNCE: 0.16,

    // health-podium — the pale ribbed two-storey band along the base of the
    // whole Dell Med block. Measured at luma 230 against 148 for the stone above
    // it: a 1.55x step, and the same 1.55 in a second photograph taken from
    // 400 m away. The horizontal ribbing is NOT drawn — continuous full-width
    // horizontal banding is the primitive js/facades.js uses to say PARKING
    // DECK, and it reported the whole city as garages once.
    POD_BAY: 11,              // px between storefront piers (~7.7 m)
    POD_OPEN_W: 7,
    POD_OPEN_DARK: 0.62,
    POD_OPEN_NIGHT: 0.50,
    POD_PIER_LIGHT: 0.07,

    // health-body — the stone rainscreen with deeply recessed punched windows.
    // MEASURED off 1.86 Mpx of pure elevation by k-means: vision glass 19.8% of
    // the wall, copper reveal 5.6%, stone the rest. The grid below computes to
    // 21.1% — see moodyGridAudit(), which asserts that rather than claiming it
    // in a comment. Not pedantry: this repo has shipped a comment claiming 17.1%
    // next to a grid computing 34.2%, and the wrong number was reported as a fix.
    BODY_ROWS: 9,             // ~5.0 m floor-to-floor at the design scale
    BODY_COLS: 6,
    BODY_W: 4,
    BODY_H: 4,
    BODY_STAGGER: 0.5,        // alternate rows offset half a bay — the signature
    BODY_GLASS: [32, 62, 100],    // sampled: dellmed/00 cluster, 19.8% share
    BODY_REVEAL: [205, 160, 128], // sampled: dellmed/00 warm mask, 5.6% share
    BODY_HEAD_DARK: 0.34,
    BODY_MOTTLE: 0.045,

    // health-attic — the mechanical level. Louvres, not windows: vertical slats
    // over plant. Authored, because no photograph I could source shows it in
    // daylight at a size worth sampling.
    ATTIC_SLAT: 3,
    ATTIC_SLAT_DARK: 0.20,
    ATTIC_PIER_EVERY: 16,
    ATTIC_PIER_LIGHT: 0.07,
  };

  // The tile painters. Each takes the band's own wall colour for this hour, so
  // the colour lives in the DATA (baked by scripts/bake_moody.py) and this file
  // holds only the geometry of each material. One source of truth for the hex.
  const TILES = {
    'moody-plinth'(ctx, w, dark, night, golden, seed) {
      const T = TILE, fill = (c, x, y, ww, hh) => { ctx.fillStyle = css(c); ctx.fillRect(x, y, ww, hh); };
      fill(w, 0, 0, T, T);
      const joint = mix(w, [0, 0, 0], M.PLINTH_JOINT_DARK);
      for (let x = 0; x < T; x += M.PLINTH_JOINT) fill(joint, x, 0, 1, T);
      const voidC = mix(w, [0, 0, 0], M.PLINTH_PORTAL_DARK);
      const lit = mix(voidC, [255, 198, 140], M.PLINTH_PORTAL_NIGHT * night);
      for (let x = 3; x < T; x += M.PLINTH_PORTAL_EVERY) {
        fill(night > 0.02 ? lit : voidC, x, 0, M.PLINTH_PORTAL_W, T);
        // One jamb in deep shade: a hole through a thick wall rather than a
        // rectangle painted on it. Full height, so nothing here depends on
        // where the tile happens to sit vertically.
        fill(mix(w, [0, 0, 0], 0.30), x, 0, 1, T);
      }
    },

    'moody-fins'(ctx, w, dark, night, golden, seed) {
      const T = TILE, fill = (c, x, y, ww, hh) => { ctx.fillStyle = css(c); ctx.fillRect(x, y, ww, hh); };
      fill(w, 0, 0, T, T);
      let face = mix(w, M.FIN_TINT, M.FIN_LIT * (1 - dark * 0.75));
      face = mix(face, [255, 176, 96], M.FIN_GOLDEN * golden);
      const shade = mix(w, [0, 0, 0], M.FIN_SHADE);
      for (let x = 0; x < T; x += M.FIN_PITCH) {
        fill(face, x, 0, 2, T);
        fill(shade, x + 2, 0, 1, T);
      }
    },

    'moody-glass'(ctx, w, dark, night, golden, seed) {
      const T = TILE, fill = (c, x, y, ww, hh) => { ctx.fillStyle = css(c); ctx.fillRect(x, y, ww, hh); };
      // Glass is not one hex, and the brief is right to insist on that. By day
      // this is mostly reflected sky, at golden hour it is amber, after dark it
      // is the room behind it — three characters off one baked colour.
      let g = mix(w, M.GLASS_SKY, M.GLASS_SKY_MIX * (1 - dark));
      g = mix(g, [255, 176, 96], golden * 0.42);
      g = mix(g, [14, 18, 30], dark * 0.86);
      fill(g, 0, 0, T, T);
      if (night > 0.02) {
        const room = mix(g, M.GLASS_NIGHT, M.GLASS_NIGHT_MIX * night);
        fill(room, 0, 0, T, T);
        // Brighter pools where the concourse bays are. NOT a per-pane scatter:
        // an arena concourse is one lit room seen through a continuous ribbon,
        // and a pane scatter would read as an office block.
        for (let b = 0; b < 8; b++) {
          if (hash01(seed + 7001, b, 0) > 0.55) continue;
          fill(mix(room, [255, 236, 200], 0.30 * night),
               Math.round(b * T / 8) + 1, 0, Math.round(T / 8) - 2, T);
        }
      }
      const mull = mix(g, [0, 0, 0], M.GLASS_MULLION_DARK);
      for (let x = 0; x < T; x += M.GLASS_MULLION) fill(mull, x, 0, 1, T);
    },

    'moody-fascia'(ctx, w, dark, night, golden, seed) {
      const T = TILE, fill = (c, x, y, ww, hh) => { ctx.fillStyle = css(c); ctx.fillRect(x, y, ww, hh); };
      // 70,000 sq ft of curved wood-veneered soffit is the single most
      // photographed thing about this building and none of it can be drawn:
      // fill-extrusion renders no undersides. Its warm bounce onto the fascia is
      // the only part of it that is expressible here.
      let f = mix(w, M.SOFFIT_TINT, M.SOFFIT_BOUNCE * (1 - dark * 0.6));
      f = mix(f, [255, 186, 110], 0.26 * golden);
      fill(f, 0, 0, T, T);
      const seam = mix(f, [0, 0, 0], M.FASCIA_SEAM_DARK);
      for (let x = 0; x < T; x += M.FASCIA_SEAM) fill(seam, x, 0, 1, T);
      if (night > 0.02) {
        // The soffit is uplit after dark and that is the building's night image,
        // so the fascia keeps a warm edge instead of going flat with the wall.
        fill(mix(f, [255, 190, 120], 0.24 * night), 0, 0, T, T);
      }
    },

    'health-podium'(ctx, w, dark, night, golden, seed) {
      const T = TILE, fill = (c, x, y, ww, hh) => { ctx.fillStyle = css(c); ctx.fillRect(x, y, ww, hh); };
      fill(w, 0, 0, T, T);
      const openC = mix(w, [0, 0, 0], M.POD_OPEN_DARK);
      const lit = mix(openC, [255, 216, 168], M.POD_OPEN_NIGHT * night);
      const pier = mix(w, [255, 255, 255], M.POD_PIER_LIGHT * (1 - dark * 0.8));
      for (let x = 0; x < T; x += M.POD_BAY) {
        fill(pier, x, 0, M.POD_BAY - M.POD_OPEN_W, T);
        const ox = x + (M.POD_BAY - M.POD_OPEN_W);
        fill(night > 0.02 ? lit : openC, ox, 0, M.POD_OPEN_W, T);
        fill(mix(openC, [0, 0, 0], 0.35), ox, 0, 1, T);
      }
    },

    'health-body'(ctx, w, dark, night, golden, seed) {
      const T = TILE, fill = (c, x, y, ww, hh) => { ctx.fillStyle = css(c); ctx.fillRect(x, y, ww, hh); };
      fill(w, 0, 0, T, T);
      const stepX = T / M.BODY_COLS, stepY = T / M.BODY_ROWS;
      const offX = (stepX - M.BODY_W) / 2, offY = (stepY - M.BODY_H) / 2;
      let glass = mix(w, M.BODY_GLASS, 0.80 * (1 - dark * 0.25));
      glass = mix(glass, [255, 176, 96], golden * 0.30);
      glass = mix(glass, [10, 13, 24], dark * 0.85);
      const reveal = mix(w, M.BODY_REVEAL, 0.78 * (1 - dark * 0.7));
      const head = mix(w, [0, 0, 0], M.BODY_HEAD_DARK);

      for (let r = 0; r < M.BODY_ROWS; r++) {
        // Alternate rows offset half a bay. The openings on this building are
        // genuinely staggered rather than stacked in columns, and at this scale
        // that stagger is the most recognisable thing about the facade — it is
        // what stops a grey block reading as a generic office grid.
        const sx = (r % 2) ? stepX * M.BODY_STAGGER : 0;
        for (let c = 0; c < M.BODY_COLS; c++) {
          const x = Math.round(c * stepX + offX + sx) % T;
          const y = Math.round(r * stepY + offY);
          const draw = (xx) => {
            // Head shadow, then glass, then the copper reveal down ONE jamb.
            // One side only, because the sun is on one side: a reveal on both
            // outlines the opening like a cell in a spreadsheet, which is the
            // exact "blocky" failure js/facades.js removed from every wall.
            ctx.fillStyle = css(head, 0.72 * (1 - dark * 0.6));
            ctx.fillRect(xx, y - 1, M.BODY_W, 1);
            let pane = glass;
            if (night > 0.05 && hash01(seed + 1009, r, c) < 0.30) {
              pane = mix(glass, [255, 206, 150], Math.min(1, night * 1.3) * 0.86);
            }
            fill(pane, xx, y, M.BODY_W, M.BODY_H);
            fill(reveal, xx, y, 1, M.BODY_H);
          };
          draw(x);
          if (x + M.BODY_W > T) draw(x - T);   // wrap the stagger across the seam
        }
      }
      // Block-to-block value scatter at ~2 m. Without it a large stone surface
      // reads as untextured plastic; with much more it reads as noise.
      for (let i = 0; i < 26; i++) {
        const x = Math.round(hash01(seed + 33, i, 0) * T);
        const y = Math.round(hash01(seed + 34, i, 0) * T);
        const s = 2 + Math.round(hash01(seed + 35, i, 0) * 3);
        const t = (hash01(seed + 36, i, 0) - 0.5) * 2 * M.BODY_MOTTLE;
        ctx.fillStyle = css(mix(w, t < 0 ? [0, 0, 0] : [255, 255, 255], Math.abs(t)), 0.7);
        ctx.fillRect(x, y, s, s);
      }
    },

    'health-attic'(ctx, w, dark, night, golden, seed) {
      const T = TILE, fill = (c, x, y, ww, hh) => { ctx.fillStyle = css(c); ctx.fillRect(x, y, ww, hh); };
      fill(w, 0, 0, T, T);
      const slat = mix(w, [0, 0, 0], M.ATTIC_SLAT_DARK);
      for (let x = 0; x < T; x += M.ATTIC_SLAT) fill(slat, x, 0, 1, T);
      const pier = mix(w, [255, 255, 255], M.ATTIC_PIER_LIGHT * (1 - dark * 0.8));
      for (let x = 0; x < T; x += M.ATTIC_PIER_EVERY) {
        fill(pier, x, 0, 2, T);
        fill(mix(w, [0, 0, 0], 0.16), x + 2, 0, 1, T);
      }
    },
  };

  // The two Dell Med blocks share their painters and differ only in the baked
  // stone colour, so four image ids map onto two functions. The attic tone is
  // derived from each building's OWN body colour in the bake rather than shared:
  // one authored tone lands as a 10% step on the grey block and a 30% step on
  // the cream one, and no photograph shows the cream building wearing a dark hat.
  const PAINTER_FOR = {
    'health-body-cream': 'health-body',
    'health-body-grey': 'health-body',
    'health-attic-cream': 'health-attic',
    'health-attic-grey': 'health-attic',
  };

  /**
   * The glazing audit, run once at boot. Cheap, and it turns a silent 2x error
   * into a console line. Exposed so moody-check.mjs can assert on it, because
   * arithmetic in a comment is a claim and arithmetic in code is a fact.
   */
  window.moodyGridAudit = function moodyGridAudit() {
    const glaze = (M.BODY_ROWS * M.BODY_COLS * M.BODY_W * M.BODY_H) / (TILE * TILE);
    const reveal = (M.BODY_ROWS * M.BODY_COLS * 1 * M.BODY_H) / (TILE * TILE);
    const pier = TILE / M.BODY_COLS - M.BODY_W;
    const spandrel = TILE / M.BODY_ROWS - M.BODY_H;
    const mpt = MOODY.designMetresPerTile;
    const row = {
      glazePct: +(glaze * 100).toFixed(1), measuredPct: 19.8,
      revealPct: +(reveal * 100).toFixed(1), measuredRevealPct: 5.6,
      pierPx: +pier.toFixed(1), spandrelPx: +spandrel.toFixed(1),
      floorToFloorM: +(mpt / M.BODY_ROWS).toFixed(2),
      bayM: +(mpt / M.BODY_COLS).toFixed(2),
      finPitchM: +(mpt * M.FIN_PITCH / TILE).toFixed(2),
      // The pier/spandrel floor js/facades.js arrived at the hard way: pack the
      // openings closer than this and the wall between them fuses at viewing
      // distance, so the facade stops reading as punched windows and starts
      // reading as scaffolding.
      ok: Math.abs(glaze * 100 - 19.8) < 4 && pier >= 5 && spandrel >= 3,
    };
    if (!row.ok) console.warn('[moody] grid out of spec:', row);
    return row;
  };

  // ── band-limit (QUEUE F2, docs/facade-atlas-map.md §2) ───────────────
  //
  // This module was one of the five files painting `fill-extrusion-pattern`
  // with zero prefilter (docs/second-front-map.md §5). `health-body`'s 4x4 px
  // window cell on a 9-row/6-col staggered grid is a real, photograph-
  // calibrated window grid — the closest analogue in this file to
  // js/facades.js's own near tier, and the material this front's own ranking
  // (docs/second-front-map.md §8) named as the primary risk. The kernel is
  // the shared one (js/pattern-lowpass.js `blurWrap`, lifted verbatim from
  // js/facades.js's own softenTile, extracted so js/drag.js and this module
  // can share it without sharing a taste table — see that file's header).
  //
  // KEYED BY MATERIAL, not image id: eight registered images
  // (moody-plinth/fins/glass/fascia, health-body/attic x cream/grey) share
  // just seven distinct painters/geometries (health-body-cream and
  // health-body-grey are the SAME grid, different baked colour), and the
  // alias risk is a property of the grid, not the colour. `PAINTER_FOR[id]
  // || id` is the same lookup tileData() already uses to pick a painter, so
  // the softening key and the painter key can never drift apart.
  //
  // STARTING POINT. Simeon flagged this module (with arts.js) as "glass-
  // heavy" and pointed at js/facades.js's own `tg` (curtain-wall) family as
  // the closest calibration: RADIUS 2, AMOUNT 0.85 (facades.js SOFTEN table)
  // — chosen there because `tg`'s own pier/spandrel gap (3.14/1.40 texels)
  // is narrow enough that a wider box erases the glazing instead of
  // anti-aliasing it, not anti-aliasing it. That same logic, applied to each
  // material's OWN measured pitch (M.* above, every one commented in texels
  // AND metres already):
  //
  //   material        finest real feature        radius chosen
  //   health-attic    ATTIC_SLAT: 3 px pitch      1  (a 3-texel box is already
  //                                                    2/3 of the pitch; wider
  //                                                    erases alternating
  //                                                    slats instead of
  //                                                    softening them)
  //   moody-fins      FIN_PITCH: 4 px pitch       1  (same reasoning, one
  //                                                    step more headroom)
  //   moody-glass     GLASS_MULLION: 5 px pitch   2  (tg's own pitch)
  //   health-body     BODY_W/H: 4 px cell,        2  (tg's own radius — the
  //                   ~3.1 px spandrel gap             flagged primary risk)
  //   health-podium   POD_BAY: 11 px, 7 px open   2  (real headroom, kept at
  //                                                    tg's radius rather
  //                                                    than guessed higher)
  //   moody-plinth    PLINTH_JOINT: 9 px pitch,   2
  //                   single-texel stroke
  //   moody-fascia    FASCIA_SEAM: 13 px pitch    2  (coarsest pitch in the
  //                                                    file; still held at
  //                                                    tg's radius, not
  //                                                    pushed higher, because
  //                                                    no measurement argues
  //                                                    for spending it there
  //                                                    — same call
  //                                                    facades.js's own `dk`/
  //                                                    `st` made)
  //
  // MEASURED against scripts/verify/shimmer.mjs (SHIM_SOFTEN_TARGET=moody),
  // scripts/verify/shimmer-poses-moodyarts.json `moody-body-close` — Dell
  // Med's Health Discovery Building (HDB, scripts/verify/moody-check.mjs's
  // own coordinate), boxed to the building's own facade so a neighbouring
  // building/road cannot leak into the number (box [560,335,1170,555],
  // chosen from a framing screenshot, shots/shimmer/front2/moodyarts/):
  //
  //   before (r=0, pre-fix)     2.12% crawl, 49.7% moved
  //   after  (this table)       1.50% crawl, 53.2% moved   (-29% relative)
  //   floor  (SHIM_PATTERN=0)   1.23% crawl                (69% of headroom
  //                                                          recovered)
  //
  // This is health-body's OWN number only — this pose does not exercise
  // health-attic, moody-fins, moody-plinth, moody-fascia, moody-glass or
  // health-podium (Moody Center/the fin field are out of frame at this
  // bearing). Their radii above are the geometric reasoning in the table,
  // NOT independently measured or eye-checked per material — same honest gap
  // facades.js's own `dk`/`st` left open ("no measurement was taken to
  // justify moving them"). The r2 chosen for health-body WAS eye-checked at
  // this pose (shots/shimmer/front2/moodyarts/moody-body-close-{before,
  // after}-*.png) — the checkered window grid on Health Discovery Building
  // still reads as individual punched openings after the blur, not a flat
  // wall.
  //
  // moody-cruise (the wider precinct framing, unboxed) was ALSO measured —
  // 1.57% before, 1.39% after, 0.91% floor — but its single largest cluster
  // (box [5,662,113,742], ~3900px, a corner of frame) is BYTE-IDENTICAL in
  // size across before/after/floor runs, meaning it is not
  // `fill-extrusion-pattern` crawl at all (most likely the ground/road
  // `fill-pattern` bug, docs/GROUND_TEXTURE.md). This module's own
  // contribution at cruise altitude was not cleanly isolated — the close
  // pose above is the trustworthy number.
  //
  // FRAME COST. `scripts/verify/moody-perf.mjs 2` (headed, MIN of 9 reps,
  // includes this blur — the blur runs INSIDE tileData(), called by
  // registerTiles(), called by applyMoodyColors(), the same call chain that
  // already existed): `applyMoodyColors` (all 8 tiles, including the new
  // blur) 14.40 ms, 5% of the whole `applyTimeOfDay` hook (308.50 ms, every
  // module's repaint together). Same shape of cost as the ALREADY-SHIPPED
  // `shim-lowpass`/`js/drag.js` blur — atlas-generation time, on the
  // quantised (1/128) time-of-day step only, never the per-frame render
  // loop, and no new `addImage`/`updateImage` call site was added, so
  // `ATLAS.RELEASE`'s staleness tracking (docs/facade-atlas-map.md §6) is
  // untouched. Not compared against a pre-change baseline in the same run
  // (that needs two checkouts or a temporary revert, not attempted this
  // round) — the DRAW-cost half of the same script (frames dropped flying
  // past the precinct, unaffected by this change since it never touches the
  // render loop) came back inside its own run-to-run noise band.
  //
  // TASTE KNOB: window.MOODY_SOFTEN, same contract as window.FACADE_SOFTEN /
  // window.DRAG_SOFTEN — any value here is a one-line console override, no
  // code change, and scripts/verify/shimmer.mjs's SHIM_SOFTEN/SHIM_SOFTEN_R
  // sweep drives this table by name for the next person who has to argue
  // about this trade.
  const MOODY_SOFTEN = {
    RADIUS: { 'moody-plinth': 2, 'moody-fins': 1, 'moody-glass': 2,
              'moody-fascia': 2, 'health-podium': 2, 'health-body': 2,
              'health-attic': 1 },
    AMOUNT: { 'moody-plinth': 1.0, 'moody-fins': 1.0, 'moody-glass': 1.0,
              'moody-fascia': 1.0, 'health-podium': 1.0, 'health-body': 1.0,
              'health-attic': 1.0 },
  };
  window.MOODY_SOFTEN = MOODY_SOFTEN;

  // ── pattern generation ─────────────────────────────────────────────
  let _canvas = null, _ctx = null;
  let _tileColours = null;   // image id -> {wd, wg, wn}, read from the baked data

  function lerpAt(trio, p) {
    return p <= 0.5 ? mix(trio.wd, trio.wg, p / 0.5) : mix(trio.wg, trio.wn, (p - 0.5) / 0.5);
  }

  function tileData(id, p) {
    if (!_canvas) {
      _canvas = document.createElement('canvas');
      _canvas.width = _canvas.height = TILE;
      // willReadFrequently because this always ends in getImageData. Do NOT
      // composite a second canvas in here: js/facades.js measured drawImage into
      // a CPU-backed context at 230 ms against 22 ms.
      _ctx = _canvas.getContext('2d', { willReadFrequently: true });
    }
    const trio = _tileColours[id];
    const wallBase = lerpAt(trio, p);

    // TWO night factors on deliberately different schedules, taken from
    // js/facades.js so this precinct cannot drift out of step with the city
    // around it. `night` (hour-driven) lights the windows; `dark`
    // (sun-elevation-driven) drops the wall. Riding one schedule for both left
    // walls golden-lit while the sun was already 8 degrees below the horizon —
    // an inverted dusk silhouette, the city glowing against a darker sky.
    const night = Math.max(0, (p - 0.55) / 0.45);
    const sunElev = (typeof window.skyBodies === 'function') ? window.skyBodies(p).sun.elev : (0.5 - p) * 100;
    const dark = Math.max(night, Math.min(1, Math.max(0, -sunElev / 9)));
    const golden = 1 - Math.abs(p - 0.5) / 0.5;
    const wall = mix(wallBase, hexToRgb(trio.wn), Math.max(0, dark - night));

    const matKey = PAINTER_FOR[id] || id;
    const painter = TILES[matKey] || TILES['health-body'];
    _ctx.clearRect(0, 0, TILE, TILE);
    let seed = 0;
    for (let i = 0; i < id.length; i++) seed = (seed * 31 + id.charCodeAt(i)) | 0;
    painter(_ctx, wall, dark, night, golden, Math.abs(seed) % 9973);

    const img = _ctx.getImageData(0, 0, TILE, TILE);
    // Band-limit BEFORE the Uint8Array snapshot, same order js/drag.js draws
    // in (mottle/paint first, blur last) — the blur has to see the same
    // texture MapLibre will sample, not a cleaner draft of it. Unrecognised
    // key falls back to health-body's number rather than silently skipping
    // the low-pass, matching js/drag.js's own fallback shape.
    const rOv = MOODY_SOFTEN.RADIUS[matKey] != null ? MOODY_SOFTEN.RADIUS[matKey] : MOODY_SOFTEN.RADIUS['health-body'];
    const aOv = MOODY_SOFTEN.AMOUNT[matKey] != null ? MOODY_SOFTEN.AMOUNT[matKey] : MOODY_SOFTEN.AMOUNT['health-body'];
    window.PatternLowpass.blurWrap(img.data, TILE, rOv, aOv);
    return { width: TILE, height: TILE, data: new Uint8Array(img.data.buffer.slice(0)) };
  }

  function registerTiles(map, p) {
    let n = 0;
    for (const id of Object.keys(_tileColours)) {
      try {
        if (map.hasImage && map.hasImage(id)) map.updateImage(id, tileData(id, p));
        else { map.addImage(id, tileData(id, p)); n++; }
      } catch (e) { /* already registered */ }
    }
    return n;
  }

  // ── layers ─────────────────────────────────────────────────────────
  /** ['interpolate', p, day, golden, night] — the shape timeofday.js bakes with. */
  function tod(p) {
    p = Math.max(0, Math.min(1, p));
    return ['interpolate', ['linear'], p,
      0, ['to-color', ['get', 'wd'], '#888888'],
      0.5, ['to-color', ['get', 'wg'], '#888888'],
      1, ['to-color', ['get', 'wn'], '#333344'],
    ];
  }

  let _added = false, _replaced = [];

  /**
   * Stop the generic extrusions being drawn, or their flat lids bury every band
   * underneath them.
   *
   * Applied MORE THAN ONCE on purpose. js/app.js's addStadiumLayers does the
   * same job for DKR, from inside its own fetch callback, by reading the current
   * filter and wrapping it. Two modules doing read-modify-write on one filter
   * from two unsequenced fetches is a lost update if they interleave, and the
   * symptom — one building back to being a tan mesa — reads as a bake problem
   * rather than as a race. Re-applying is harmless: ['all', f, mine] is
   * idempotent in effect.
   */
  function hideReplaced(map) {
    if (!_replaced.length) return;
    const gone = ['!', ['in', ['get', 'id'], ['literal', _replaced]]];
    for (const id of ['buildings-3d', 'buildings-roof']) {
      if (!map.getLayer(id)) continue;
      try {
        const f = map.getFilter(id);
        map.setFilter(id, f ? ['all', f, gone] : gone);
      } catch (e) {}
    }
  }

  window.initMoody = async function initMoody(map) {
    if (!MOODY.on || _added || map.getSource(SRC)) return;
    _added = true;

    let gj;
    try {
      const r = await fetch(DATA);
      if (!r.ok) throw new Error(DATA + ': ' + r.status);
      gj = await r.json();
    } catch (e) {
      console.warn('[moody]', e.message, '- precinct not drawn');
      return;
    }

    // Build the id -> colour map from the DATA rather than restating the hexes
    // here. scripts/bake_moody.py owns every colour in this pass; a second copy
    // in this file would be a second thing to keep in step, and it would not be.
    _tileColours = {};
    for (const f of gj.features) {
      const p = f.properties;
      if (p.kind !== 'wall' || !p.tile) continue;
      if (!_tileColours[p.tile]) _tileColours[p.tile] = { wd: p.wd, wg: p.wg, wn: p.wn };
    }
    if (!Object.keys(_tileColours).length) {
      console.warn('[moody] no wall bands in', DATA, '- precinct not drawn');
      return;
    }
    // Stamp the image id onto each wall feature BEFORE addSource. MapLibre
    // serialises a GeoJSON source to its worker on addSource, so mutating these
    // objects afterwards never reaches the tiles and the walls render with no
    // pattern at all — the trap js/app.js documents for the stadium and
    // js/outer.js for the downtown towers.
    for (const f of gj.features) {
      if (f.properties.kind === 'wall') f.properties.wp = f.properties.tile;
    }

    const p = (window.__todCurrentP != null) ? window.__todCurrentP : 0.3;
    const added = registerTiles(map, p);
    const audit = window.moodyGridAudit();

    _replaced = gj.replacedBuildingIds || [];
    hideReplaced(map);
    // See hideReplaced: these are the guard against an interleaved-fetch lost
    // update with js/app.js's own filter write, not belt and braces. The timer
    // covers the common case; the idle covers the one it cannot — app.js's
    // stadium fetch resolving AFTER the timer with a filter it read BEFORE our
    // first write, which would drop our exclusion permanently and put a tan mesa
    // back on top of the precinct.
    setTimeout(() => hideReplaced(map), 2500);
    map.once('idle', () => hideReplaced(map));

    map.addSource(SRC, { type: 'geojson', data: gj, ...(window.PATTERN_TILING || {}) });

    // The anchor must be the first symbol layer AFTER our buildings, not the
    // first in the style. The basemap puts symbol layers immediately after
    // `background`, and anchoring there drops the whole precinct to the BOTTOM
    // of the stack, under `ground-areas` — which already happened to the
    // stadium, and it still rendered, in roughly the right shape, quietly
    // repainted by the ground fill on top of it.
    const stack = map.getStyle().layers;
    const after = Math.max(0, stack.findIndex(l => l.id === 'buildings-3d'));
    const anchor = (stack.slice(after + 1).find(l => l.type === 'symbol') || {}).id;

    if (!map.getLayer(L_WALL)) {
      map.addLayer({
        id: L_WALL, type: 'fill-extrusion', source: SRC, minzoom: MOODY.minZoom,
        filter: ['==', ['get', 'kind'], 'wall'],
        paint: {
          'fill-extrusion-pattern': ['coalesce', ['get', 'wp'], 'health-body-grey'],
          'fill-extrusion-height': ['get', 'h'],
          'fill-extrusion-base': ['get', 'base'],
          'fill-extrusion-opacity': MOODY.opacity,
          // OFF, unlike every other building in the scene. The gradient darkens
          // the bottom of an extrusion, and these are three or four stacked
          // extrusions per building, so it restarts at every band boundary and
          // draws a dark line under all of them. On Moody's 4.4 m glass ribbon
          // the whole band falls inside the gradient and the concourse goes
          // black. The band tones already carry the vertical hierarchy.
          'fill-extrusion-vertical-gradient': false,
        },
      }, anchor);
    }
    // Roof planes, plant screens and parapets: flat colour, never a pattern, so
    // a window grid can never wrap over a horizontal surface.
    for (const [id, kind] of [[L_ROOF, 'roof'], [L_PLANT, 'plant'], [L_CAP, 'cap']]) {
      if (map.getLayer(id)) continue;
      map.addLayer({
        id, type: 'fill-extrusion', source: SRC, minzoom: MOODY.minZoom,
        filter: ['==', ['get', 'kind'], kind],
        paint: {
          'fill-extrusion-color': tod(p),
          'fill-extrusion-height': ['get', 'h'],
          'fill-extrusion-base': ['get', 'base'],
          'fill-extrusion-opacity': 1.0,
        },
      }, anchor);
    }

    console.log('[moody]', gj.features.length, 'features,', added, 'new images,',
                _replaced.length, 'generic extrusions replaced; glazing',
                audit.glazePct + '% (measured ' + audit.measuredPct + '%)',
                audit.ok ? '' : '<- OUT OF SPEC');
  };

  window.applyMoodyColors = function applyMoodyColors(map, p) {
    if (!map || !map.getLayer || !_tileColours) return;
    registerTiles(map, p);
    for (const id of [L_ROOF, L_PLANT, L_CAP]) {
      try { if (map.getLayer(id)) map.setPaintProperty(id, 'fill-extrusion-color', tod(p)); } catch (e) {}
    }
  };

  /**
   * Re-read MOODY.on after a live edit. This is what moody-perf.mjs toggles.
   *
   * The A/B has to be doable WITHIN one page, because the alternative — two page
   * loads — cannot interleave, and an un-interleaved comparison in this repo has
   * already produced a false regression report. ?moody=0 still exists for a
   * cold-start comparison, but the interleaved run uses this.
   */
  window.applyMoodySettings = function applyMoodySettings(map) {
    if (!map || !map.getLayer) return;
    for (const id of [L_WALL, L_ROOF, L_PLANT, L_CAP]) {
      if (!map.getLayer(id)) continue;
      try { map.setLayoutProperty(id, 'visibility', MOODY.on ? 'visible' : 'none'); } catch (e) {}
    }
  };

  // ── bootstrap ──────────────────────────────────────────────────────
  // A new module needs a <script> tag and nothing else. js/app.js belongs to
  // another pass, so rather than ask for a call inside buildScene() this waits
  // for the map and the core building layers and then inserts itself. Same
  // shape as the boot() at the bottom of js/outer.js.
  function boot() {
    const map = window.__map;
    if (!map) return setTimeout(boot, 60);

    const hookTod = () => {
      if (typeof window.applyTimeOfDay !== 'function' || window.applyTimeOfDay.__moody) return;
      const prev = window.applyTimeOfDay;
      const wrapped = function (m, p, force) {
        const r = prev.apply(this, arguments);
        try { window.applyMoodyColors(m, p); } catch (e) {}
        return r;
      };
      wrapped.__moody = true;
      window.applyTimeOfDay = wrapped;
    };

    const go = () => {
      // Wait for the core buildings: the replaced-id filter has to be applied to
      // layers that exist, and the anchor search needs `buildings-3d` in the
      // stack to find the symbol layer that comes after it.
      if (!map.getLayer('buildings-3d')) return setTimeout(go, 120);
      hookTod();
      window.initMoody(map);
    };
    if (map.isStyleLoaded && map.isStyleLoaded()) go();
    else map.once('load', () => setTimeout(go, 0));
  }
  boot();
})();
