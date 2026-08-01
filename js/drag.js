/**
 * drag.js — the student half of campus: PCL, Gregory Gym, the Texas Union, the
 * University Co-op and the Guadalupe streetwall between 21st and 24th.
 *
 * WHAT THIS REPLACES. Every one of these buildings was picking its facade by
 * HEIGHT alone (js/facades.js:familyFor), so a 1970s brutalist library, a 1930
 * brick gymnasium, a limestone student union and a row of one-storey shops all
 * wore the same punched-window grid. On the shops that is not a near miss: it
 * puts apartment windows on the ground floor of a bookstore, when a shopfront is
 * one tall glass band with a bulkhead under it and a sign band over it.
 *
 * WHY THIS FILE CARRIES ITS OWN TILES. js/facades.js belongs to another pass and
 * its five families (lo/mr/mh/tr/tg) are all *windows in a wall* — the one thing
 * none of these buildings is. So the geometry comes from scripts/bake_drag.py and
 * the eleven tiles below are registered here under `dg-` ids, painted by this
 * module's own layer. Nothing in facades.js is touched, no shared palette entry
 * is claimed, and the atlas cost is eleven to fifteen images, listed in the
 * console line at the bottom of initDrag.
 *
 * ── THE TWO RULES THESE TILES OBEY, AND WHY ──────────────────────────────────
 *
 * `fill-extrusion-pattern` is TILE-locked, not world-locked: a 64 px repeat
 * covers ~30 m of wall at tile zoom 17 and ~59 m at 16, and it repeats from the
 * extrusion with no idea where the building's top or bottom is.
 *
 *   1. VERTICAL EVENTS ARE GEOMETRY. Shopfront, sign band, upper floors,
 *      parapet, cornice, coffer row: each is a separate feature with its own
 *      base and height, emitted by the bake. Nothing below tries to put a
 *      cornice "at the top".
 *
 *   2. EVERY TILE IS STATIONARY IN Y. A band here is 1-9 m tall against a tile
 *      that spans 30-59 m, so a band shows an arbitrary horizontal SLICE of its
 *      tile — and *which* slice moves as you zoom. So no tile below draws
 *      anything that varies with y. Piers, mullions, fins, reveals and jambs are
 *      vertical and survive. Arch heads, window heads, sills and string courses
 *      are horizontal and are simply not drawn.
 *
 *      That last one is a real loss on Gregory Gym, whose three great round
 *      arches are the building's signature. It is the correct loss: at the
 *      camera's working distance one pixel of wall is about half a metre, an
 *      arch head is a two-pixel curve, and drawing it anyway would place it at a
 *      different height at every zoom. What an arcade actually reads as from 400
 *      m is light piers against dark voids, and that is what `gymArcade` draws.
 *      Same argument js/facades.js uses for not drawing brick coursing.
 *
 * ── GLAZING ─────────────────────────────────────────────────────────────────
 * js/facades.js's measured references: UT campus historic 15-18%, mid-century
 * academic 20-26%. And its hard-won constraint is on the GAP, not the ratio —
 * under about 5 px of wall between openings and a facade stops reading as
 * punched windows and starts reading as ribbed metal. Every family below is
 * audited against both at load; see dragTileAudit(), which prints a warning
 * rather than letting a 2x error ship silently. The one deliberate exemption is
 * `shopGlass`: a shopfront IS continuous glass on thin mullions, so the pier
 * minimum is the wrong rule there, exactly as `tg` is exempt in facades.js.
 *
 * Public (window) API:
 *   initDrag(map)              — add the source + layers (called automatically)
 *   applyDragColors(map, p)    — retint for time-of-day p (hooked automatically)
 *   applyDragSettings(map)     — re-read DRAG after a live edit
 *   dragTileAudit()            — the glazing/gap table
 *   DRAG                       — the taste block (below)
 */
(function () {
  'use strict';

  const q = new URLSearchParams(window.location.search);

  const DRAG = {
    // ?drag=0 removes the whole pass at load, so scripts/verify/drag-perf.mjs
    // can measure the A/B on ONE build instead of two checkouts.
    on: q.get('drag') !== '0',
    minZoom: 14,
    opacity: 1.0,
  };
  window.DRAG = DRAG;

  const SRC = 'austin-drag';
  const L_WALL = 'drag-wall';
  const L_CAP = 'drag-cap';
  const DATA = 'data/drag.geojson';
  const TILE = 64;

  // ── taste: the tile geometry, in tile pixels ────────────────────────
  // One tile is ~40 m of wall in the middle of the flying range, so 1 px is
  // about 0.63 m. Every dimension below is quoted in metres at that scale.
  const T = {
    // pclCoffer — PCL's deep rectangular coffers. 7 bays = 5.7 m centres,
    // 4 px (2.5 m) of glass behind 5.1 px (3.2 m) of precast pier.
    //
    // THAT PIER IS TOO WIDE AND IT IS A RESOLUTION LIMIT, NOT A CHOICE. On the
    // building the opening is ~2.7 m and the pier between two coffers is ~1.3 m
    // — the openings are WIDER than the piers. One tile pixel here is ~0.63 m,
    // so a truthful 1.3 m pier is 2 px, and js/facades.js's hard-won minimum is
    // 5 px of wall between openings: under that, the gaps fuse at any real
    // viewing distance and the facade stops reading as punched openings and
    // starts reading as ribbed metal. So the bay is drawn at roughly double the
    // real pitch, one drawn coffer standing for two. The GLAZING RATIO is what
    // survives to the camera, and it is right; the pitch is not.
    PCL_BAYS: 7, PCL_GLASS: 4, PCL_REVEAL: 0.42, PCL_JAMB: 0.55,
    // The coffer is a hole 0.7 m deep in a wall, lit only by sky. So its shadow
    // is COOL, not black — which is also what stops PCL rendering warmer than
    // the tan brick next door (it measured R/B 1.75 against 1.41 when this was
    // a mix toward pure black).
    PCL_DEEP: 0.55, PCL_DEEP_TONE: [18, 24, 34],
    PCL_PANEL: 13,           // px between precast panel joints (~8 m)
    PCL_JOINT: 0.055,
    PCL_NIGHT_LIT: 0.34,     // a library is lit late; this is the share of slots

    // gymArcade — 3 bays = 13.3 m centres, 5 px (3.2 m) of void. Gregory is a
    // gymnasium: the elevations are overwhelmingly blank brick and the openings
    // are few and enormous.
    GYM_BAYS: 3, GYM_VOID: 5, GYM_VOID_DARK: 0.52, GYM_JAMB: 0.30,
    GYM_PIER_LIGHT: 0.055,
    // gymFrieze — the arcaded corbel table under the gable. Its individual
    // arches are ~0.9 m, which is 1.4 tile pixels, so they cannot be drawn at
    // their real pitch: a 1-px-on/1-px-off rhythm is a checkerboard that moires
    // against the pixel grid as you fly. So the band is drawn at 4 px (2.5 m),
    // roughly every third arch, at the value the real band averages to — a
    // lighter, finely textured strip under the gable. The FREQUENCY IS WRONG
    // and the value and position are right; that is the trade, and it is the
    // same one js/facades.js makes when it refuses to draw brick coursing.
    GYM_DENTIL: 4, GYM_DENTIL_DARK: 0.13, GYM_FRIEZE_LIFT: 0.05,

    // uniArcade — the Union's ground-floor run of round-arched windows.
    // 6 bays = 6.7 m centres, 3 px (1.9 m) of opening.
    UNI_BAYS: 6, UNI_VOID: 3, UNI_VOID_DARK: 0.46,
    // uniWin — plain ashlar with punched rectangles. 6 bays, 2 px (1.3 m).
    UNI_WIN_BAYS: 6, UNI_WIN_W: 2,
    UNI_COURSE: 16, UNI_COURSE_DARK: 0.05,   // ashlar block joints (~10 m)

    // shopGlass — a shopfront. Mullions every 5 px (3.2 m), 1 px wide. This is
    // the one family exempt from the pier minimum.
    SHOP_MULL: 5, SHOP_MULL_DARK: 0.34,
    // 0.66 rendered the shopfront as a near-black stripe under every building —
    // luma 83 against a 145 wall — which reads as a void, not as glass. Real
    // shop glazing by day is mid-dark with the sky in it, so it is lightened
    // and given a sky reflection that fades out as the sun goes down.
    SHOP_GLASS_DARK: 0.50,   // how far the glass goes from the wall by day
    SHOP_SKY: [126, 148, 176], SHOP_SKY_MIX: 0.20,
    SHOP_NIGHT: 0.86,        // ... and how hard it glows after dark
    SHOP_NIGHT_TONE: [255, 206, 148],
    SHOP_BAY_RATE: 0.34,     // share of bays that are a brighter shop interior

    // signBand — the fascia over the glass. Dark, with lit signage on it.
    SIGN_BLOCKS: 5, SIGN_BLOCK_W: 7, SIGN_BLOCK_RATE: 0.55,
    SIGN_NIGHT: 0.80,

    // retUpper — the floors above the shop. Stucco or painted brick with small
    // punched openings. 6 bays = 6.7 m centres, 2 px (1.3 m).
    RET_BAYS: 6, RET_WIN: 2, RET_NIGHT_LIT: 0.26,
    RET_STREAKS: 5, RET_STREAK_DARK: 0.06, RET_STREAK_ALPHA: 0.20,

    // Shared. The pattern removes mean luma, so every family puts some back —
    // per family, because one shared gain over-lit the near-blank tiles while
    // barely covering the deep-void ones. Same lesson as DKR_GAIN in facades.js.
    GAIN: { pclSolid: 1.04, pclCoffer: 1.13, gymSolid: 1.04, gymArcade: 1.11,
            gymFrieze: 1.07, uniArcade: 1.10, uniWin: 1.06, uniSolid: 1.03,
            shopGlass: 1.30, signBand: 1.06, retUpper: 1.07 },
    MOTTLE: 0.055,           // block-to-block value scatter, 4 px cell (~2.5 m)
    MOTTLE_CELL: 4,
  };
  window.DRAG_T = T;

  // Which families are windowless enough that the pier minimum does not apply.
  const CURTAIN = { shopGlass: true, signBand: true };
  const MIN_PIER = 5;   // px, from js/facades.js

  // ── colour helpers (this module's own; facades.js's are private) ────
  function hexToRgb(hex) {
    const h = String(hex || '#888888').replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function mix(a, b, t) {
    const A = Array.isArray(a) ? a : hexToRgb(a), B = Array.isArray(b) ? b : hexToRgb(b);
    return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t];
  }
  function css(rgb, alpha) {
    return `rgba(${Math.round(rgb[0])},${Math.round(rgb[1])},${Math.round(rgb[2])},${alpha == null ? 1 : alpha})`;
  }
  /** Deterministic 0..1 — the night scatter must not flicker between repaints. */
  function hash01(a, b, c) {
    let x = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
    x = (x ^ (x >> 13)) * 1274126177;
    return ((x ^ (x >> 16)) >>> 0) / 4294967295;
  }

  // ── the tiles ───────────────────────────────────────────────────────
  // Every one of these takes (ctx, w, k, seed) where `w` is the lifted wall
  // colour and `k` carries the light: k.dark (how far the sun is down),
  // k.night (how lit the interiors are), k.golden, k.glass (the day glass tone).
  //
  // NOT ONE OF THEM MAY READ y. If you add a fillRect whose y is anything but 0
  // and whose height is anything but TILE, it will appear at a different height
  // at every zoom level and on every building. That is not a style preference;
  // it is the trap in docs/PASS_COMMON.md §3.
  const fillC = (ctx, c, x, w, a) => {
    ctx.fillStyle = css(c, a);
    x = ((x % TILE) + TILE) % TILE;
    ctx.fillRect(x, 0, w, TILE);
    if (x + w > TILE) ctx.fillRect(x - TILE, 0, w, TILE);
  };

  const TILES = {
    /** pclSolid — precast limestone, near blank. Panel joints and weathering. */
    pclSolid(ctx, w, k, seed) {
      fillC(ctx, w, 0, TILE);
      const joint = mix(w, [0, 0, 0], T.PCL_JOINT);
      const lip = mix(w, [255, 255, 255], T.PCL_JOINT * 0.7 * (1 - k.dark * 0.8));
      for (let x = 0; x < TILE; x += T.PCL_PANEL) {
        fillC(ctx, joint, x, 1);
        fillC(ctx, lip, x + 1, 1);
      }
    },

    /** pclCoffer — the glazed plane at the back of the coffer grid. */
    pclCoffer(ctx, w, k, seed) {
      fillC(ctx, w, 0, TILE);
      const pitch = TILE / T.PCL_BAYS;
      // The glass of a deeply recessed opening is not the building's glass
      // tone: it is that tone in permanent shade. In every photograph of PCL
      // these read very near black even in full sun, which is most of why the
      // building looks solid from across the plaza.
      const deep = mix(k.glass, T.PCL_DEEP_TONE, T.PCL_DEEP);
      for (let b = 0; b < T.PCL_BAYS; b++) {
        const x = Math.round(b * pitch);
        let pane = deep;
        if (k.night > 0.02 && hash01(seed + 17, b, 0) < T.PCL_NIGHT_LIT) {
          pane = mix(deep, [255, 226, 186], Math.min(1, k.night * 1.25) * 0.72);
        }
        fillC(ctx, pane, x, T.PCL_GLASS);
        // One jamb lit, one in shade: a two-sided reveal reads as an outline,
        // which is the "spreadsheet cell" failure facades.js already removed.
        fillC(ctx, mix(pane, [0, 0, 0], T.PCL_JAMB), x, 1);
        fillC(ctx, mix(w, [255, 255, 255], T.PCL_REVEAL * (1 - k.dark * 0.8)),
              x + T.PCL_GLASS, 1);
      }
    },

    /** gymSolid — brick or cast stone with nothing on it but material. */
    gymSolid(ctx, w, k, seed) {
      fillC(ctx, w, 0, TILE);
      for (let s = 0; s < 4; s++) {
        const x = Math.round(hash01(seed + 61, s, 0) * TILE);
        fillC(ctx, mix(w, [0, 0, 0], 0.05), x, 2, 0.5);
      }
    },

    /** gymArcade — broad brick piers, few and enormous dark openings. */
    gymArcade(ctx, w, k, seed) {
      fillC(ctx, w, 0, TILE);
      const pitch = TILE / T.GYM_BAYS;
      const voidC = mix(w, [0, 0, 0], T.GYM_VOID_DARK);
      const lit = mix(voidC, [255, 196, 128], 0.34 * k.night);
      for (let b = 0; b < T.GYM_BAYS; b++) {
        const x = Math.round(b * pitch + (pitch - T.GYM_VOID) / 2);
        const back = k.night > 0.02 ? lit : voidC;
        fillC(ctx, back, x, T.GYM_VOID);
        fillC(ctx, mix(back, [0, 0, 0], T.GYM_JAMB), x, 1);
        fillC(ctx, mix(w, [255, 255, 255], T.GYM_PIER_LIGHT * (1 - k.dark * 0.8)),
              x + T.GYM_VOID, 1);
      }
    },

    /** gymFrieze — the corbel table, drawn as its frequency, not its arches. */
    gymFrieze(ctx, w, k, seed) {
      const lifted = mix(w, [255, 255, 255], T.GYM_FRIEZE_LIFT * (1 - k.dark * 0.8));
      fillC(ctx, lifted, 0, TILE);
      const d = mix(lifted, [0, 0, 0], T.GYM_DENTIL_DARK);
      for (let x = 0; x < TILE; x += T.GYM_DENTIL) fillC(ctx, d, x, 1);
    },

    /** uniArcade — the Union's ground-floor arched openings, in ashlar. */
    uniArcade(ctx, w, k, seed) {
      fillC(ctx, w, 0, TILE);
      const pitch = TILE / T.UNI_BAYS;
      const voidC = mix(k.glass, [0, 0, 0], T.UNI_VOID_DARK);
      for (let b = 0; b < T.UNI_BAYS; b++) {
        const x = Math.round(b * pitch + (pitch - T.UNI_VOID) / 2);
        let pane = voidC;
        if (k.night > 0.02 && hash01(seed + 29, b, 0) < 0.42) {
          pane = mix(voidC, [255, 214, 168], Math.min(1, k.night * 1.3) * 0.7);
        }
        fillC(ctx, pane, x, T.UNI_VOID);
        fillC(ctx, mix(pane, [0, 0, 0], 0.34), x, 1);
        fillC(ctx, mix(w, [255, 255, 255], 0.16 * (1 - k.dark * 0.8)), x + T.UNI_VOID, 1);
      }
      uniCourse(ctx, w, k);
    },

    /** uniWin — ashlar with small punched openings. */
    uniWin(ctx, w, k, seed) {
      fillC(ctx, w, 0, TILE);
      const pitch = TILE / T.UNI_WIN_BAYS;
      for (let b = 0; b < T.UNI_WIN_BAYS; b++) {
        const x = Math.round(b * pitch + (pitch - T.UNI_WIN_W) / 2);
        let pane = k.glass;
        if (k.night > 0.02 && hash01(seed + 31, b, 0) < 0.30) {
          pane = mix(k.glass, [255, 208, 156], Math.min(1, k.night * 1.3) * 0.78);
        }
        fillC(ctx, pane, x, T.UNI_WIN_W);
        fillC(ctx, mix(pane, [0, 0, 0], 0.32), x, 1);
      }
      uniCourse(ctx, w, k);
    },

    /** uniSolid — the deep frieze the tile roof's eave overhangs. */
    uniSolid(ctx, w, k, seed) {
      fillC(ctx, mix(w, [255, 255, 255], 0.04 * (1 - k.dark * 0.8)), 0, TILE);
      uniCourse(ctx, w, k);
    },

    /** shopGlass — the whole point of this pass. One tall band of glass on thin
     * mullions, dark and reflective by day, a continuous warm ribbon at night.
     * NOT a scatter of lit panes: the reference (the Drag after dark) is an
     * unbroken run of lit shop interiors, and a per-pane scatter would read as
     * apartments, which is the exact error being fixed. */
    shopGlass(ctx, w, k, seed) {
      let glass = mix(k.glass, [0, 0, 0], T.SHOP_GLASS_DARK * (1 - k.night));
      // Sky in the glass, by day only. A shopfront is the one surface in this
      // pass that is a mirror, and without it the band reads as a hole.
      glass = mix(glass, T.SHOP_SKY, T.SHOP_SKY_MIX * (1 - k.dark));
      fillC(ctx, glass, 0, TILE);
      if (k.night > 0.02) {
        const glow = mix(glass, T.SHOP_NIGHT_TONE, T.SHOP_NIGHT * Math.min(1, k.night * 1.35));
        fillC(ctx, glow, 0, TILE);
        // Shop to shop the interiors differ in brightness; the tenancies are
        // ~7 m apart, not 3 m, so this runs on a coarser rhythm than the
        // mullions and cannot beat against them.
        for (let b = 0; b < 6; b++) {
          if (hash01(seed + 71, b, 0) > T.SHOP_BAY_RATE) continue;
          fillC(ctx, mix(glow, [255, 240, 214], 0.30 * k.night),
                Math.round(b * TILE / 6) + 1, Math.round(TILE / 6) - 2);
        }
      }
      const mull = mix(glass, [0, 0, 0], T.SHOP_MULL_DARK);
      for (let x = 0; x < TILE; x += T.SHOP_MULL) fillC(ctx, mull, x, 1);
    },

    /** signBand — the fascia over the glass, with signage that lights. */
    signBand(ctx, w, k, seed) {
      fillC(ctx, w, 0, TILE);
      for (let b = 0; b < T.SIGN_BLOCKS; b++) {
        if (hash01(seed + 83, b, 0) > T.SIGN_BLOCK_RATE) continue;
        const x = Math.round(b * TILE / T.SIGN_BLOCKS) + 1;
        // A sign is a rectangle of colour, and after dark it is the brightest
        // thing on a two-storey building.
        const hue = hash01(seed + 91, b, 0);
        const base = hue < 0.34 ? [196, 88, 44] : hue < 0.67 ? [212, 196, 150] : [96, 118, 132];
        const c = k.night > 0.02
          ? mix(mix(w, base, 0.55), [255, 236, 200], T.SIGN_NIGHT * Math.min(1, k.night * 1.3))
          : mix(w, base, 0.42 * (1 - k.dark * 0.6));
        fillC(ctx, c, x, T.SIGN_BLOCK_W);
      }
    },

    /** retUpper — the floors over a shop: mostly wall, small punched openings. */
    retUpper(ctx, w, k, seed) {
      fillC(ctx, w, 0, TILE);
      // Weathering, aperiodic in x and constant in y, so it tiles in both axes.
      for (let s = 0; s < T.RET_STREAKS; s++) {
        const x = Math.round(hash01(seed + 5623, s, 0) * TILE);
        const wd = 2 + Math.round(hash01(seed + 5641, s, 0) * 2);
        fillC(ctx, mix(w, [0, 0, 0], T.RET_STREAK_DARK), x, wd,
              T.RET_STREAK_ALPHA * (1 - k.dark * 0.7));
      }
      const pitch = TILE / T.RET_BAYS;
      for (let b = 0; b < T.RET_BAYS; b++) {
        const x = Math.round(b * pitch + (pitch - T.RET_WIN) / 2);
        let pane = k.glass;
        if (k.night > 0.02 && hash01(seed + 37, b, 0) < T.RET_NIGHT_LIT) {
          pane = mix(k.glass, [255, 198, 132], Math.min(1, k.night * 1.3) * 0.75);
        }
        fillC(ctx, pane, x, T.RET_WIN);
        fillC(ctx, mix(pane, [0, 0, 0], 0.30), x, 1);
      }
    },
  };

  /** The Union's ashlar joints. Vertical only — a horizontal course would be a
   * y-dependent feature, and at 0.3 m a course is half a pixel anyway. */
  function uniCourse(ctx, w, k) {
    const j = mix(w, [0, 0, 0], T.UNI_COURSE_DARK);
    for (let x = 0; x < TILE; x += T.UNI_COURSE) fillC(ctx, j, x, 1);
  }

  // ── the audit ───────────────────────────────────────────────────────
  // Arithmetic in a comment is a claim; arithmetic in code is a fact. This is
  // the same guard js/facades.js added after a grid shipped at twice the
  // glazing its own comment stated.
  const GEOM = {
    // 44%, not the building's real ~67%: the pier is held at the 5 px minimum,
    // which is the resolution limit documented on PCL_BAYS above.
    pclCoffer: { bays: () => T.PCL_BAYS, open: () => T.PCL_GLASS, want: 0.44 },
    gymArcade: { bays: () => T.GYM_BAYS, open: () => T.GYM_VOID, want: 0.23 },
    uniArcade: { bays: () => T.UNI_BAYS, open: () => T.UNI_VOID, want: 0.28 },
    uniWin: { bays: () => T.UNI_WIN_BAYS, open: () => T.UNI_WIN_W, want: 0.19 },
    retUpper: { bays: () => T.RET_BAYS, open: () => T.RET_WIN, want: 0.19 },
    shopGlass: { bays: () => TILE / T.SHOP_MULL, open: () => T.SHOP_MULL - 1, want: 0.80 },
  };
  window.dragTileAudit = function dragTileAudit() {
    const rows = [];
    for (const [fam, g] of Object.entries(GEOM)) {
      const pitch = TILE / g.bays();
      const open = g.open();
      const glaze = open / pitch;
      const pier = pitch - open;
      const ok = Math.abs(glaze - g.want) < 0.05 && (CURTAIN[fam] || pier >= MIN_PIER);
      const row = { fam, glaze: +(glaze * 100).toFixed(1), want: +(g.want * 100).toFixed(1),
                    pierPx: +pier.toFixed(1), ok };
      rows.push(row);
      if (!ok) console.warn('[drag] tile out of spec:', row);
    }
    return rows;
  };

  // ── image registration ──────────────────────────────────────────────
  // The mottle depends only on the seed — not on colour and not on the hour —
  // so it is built once per combo as signed deltas in [-1,1] and reused. The
  // first cut re-hashed per PIXEL inside the repaint loop: 4,096 hashes a tile
  // times sixteen tiles on every time-of-day step, and applyTimeOfDay quantises
  // to 1/128, so dragging the hour slider would have paid it 128 times.
  // js/facades.js learned the same lesson the harder way (44 ms -> 230 ms).
  const _noise = new Map();
  function noiseCells(seed) {
    let a = _noise.get(seed);
    if (a) return a;
    const N = TILE / T.MOTTLE_CELL;
    a = new Float32Array(N * N);
    for (let i = 0; i < a.length; i++) a[i] = hash01(seed + 5501, i % N, (i / N) | 0) * 2 - 1;
    _noise.set(seed, a);
    return a;
  }

  let _canvas = null, _ctx = null;
  const _combos = [];          // [{id, fam, wd, wg, wn}]

  function lerpAt(c, p) {
    return p <= 0.5 ? mix(c.wd, c.wg, p / 0.5) : mix(c.wg, c.wn, (p - 0.5) / 0.5);
  }

  /** The light at hour p, derived the same way js/facades.js derives it so this
   * module and the rest of the city agree about when dusk is. Walls follow the
   * SUN (so the skyline silhouettes correctly through dusk); interiors follow
   * the HOUR (lights come up as the sky finishes darkening, not at sunset). */
  function lightAt(p, wall) {
    const night = Math.max(0, (p - 0.55) / 0.45);
    const sunElev = (typeof window.skyBodies === 'function')
      ? window.skyBodies(p).sun.elev : (0.5 - p) * 100;
    const dark = Math.max(night, Math.min(1, Math.max(0, -sunElev / 9)));
    const golden = 1 - Math.abs(p - 0.5) / 0.5;
    let glass = mix(wall, [46, 58, 74], 0.62);
    glass = mix(glass, [255, 176, 96], golden * 0.45);
    glass = mix(glass, [12, 15, 28], dark * 0.9);
    return { night, dark, golden, glass };
  }

  function tileData(combo, p) {
    if (!_canvas) {
      _canvas = document.createElement('canvas');
      _canvas.width = _canvas.height = TILE;
      // willReadFrequently because this always ends in getImageData. Do NOT
      // composite a second canvas in here: drawImage into a CPU-backed context
      // took the facade atlas from 44 ms to 230 ms (js/facades.js).
      _ctx = _canvas.getContext('2d', { willReadFrequently: true });
    }
    const ctx = _ctx;
    const base = lerpAt(combo, p);
    const k = lightAt(p, base);
    // Pull the wall the rest of the way to its night tone once the sun is
    // actually down, so it silhouettes rather than glowing through dusk.
    const wall0 = mix(base, hexToRgb(combo.wn), Math.max(0, k.dark - k.night));
    const wall = wall0.map(c => Math.min(250, c * (T.GAIN[combo.fam] || 1.05)));
    ctx.clearRect(0, 0, TILE, TILE);
    (TILES[combo.fam] || TILES.retUpper)(ctx, wall, k, combo.seed);

    const img = ctx.getImageData(0, 0, TILE, TILE);
    const d = img.data;
    // Block-to-block value scatter over the finished tile — one 4 px cell is
    // ~2.5 m, one block face. Written into the buffer we are already reading
    // rather than composited, for the reason above.
    const N = TILE / T.MOTTLE_CELL, amp = T.MOTTLE * (1 - k.dark * 0.6);
    const cells = noiseCells(combo.seed);
    for (let y = 0; y < TILE; y++) {
      const row = ((y / T.MOTTLE_CELL) | 0) * N;
      for (let x = 0; x < TILE; x++) {
        const t = cells[row + ((x / T.MOTTLE_CELL) | 0)];
        if (!t) continue;
        const kk = amp * Math.abs(t), tgt = t < 0 ? 0 : 255, i = (y * TILE + x) * 4;
        d[i] += (tgt - d[i]) * kk;
        d[i + 1] += (tgt - d[i + 1]) * kk;
        d[i + 2] += (tgt - d[i + 2]) * kk;
      }
    }
    return { width: TILE, height: TILE, data: new Uint8Array(d.buffer.slice(0)) };
  }

  /**
   * Stamp `wp` on every wall feature and collect the (family x material) combos.
   *
   * MUST run BEFORE addSource. MapLibre serialises a GeoJSON source to its
   * worker on addSource, so mutating the same objects afterwards never reaches
   * the tiles and the walls render with no pattern at all — the trap js/app.js
   * documents for the stadium and js/outer.js repeats for the ring.
   */
  function stampPatterns(features) {
    const seen = new Map();
    for (const f of features) {
      const p = f.properties;
      if (!p || p.kind !== 'wall') continue;
      const key = p.fam + '|' + p.wd;
      let id = seen.get(key);
      if (!id) {
        id = 'dg-' + p.fam + '-' + seen.size.toString(36);
        seen.set(key, id);
        _combos.push({ id, fam: p.fam, wd: p.wd, wg: p.wg, wn: p.wn,
                       seed: _combos.length * 7 + 13 });
      }
      p.wp = id;
    }
    return _combos.length;
  }

  function registerImages(map, p) {
    let n = 0;
    for (const c of _combos) {
      if (map.hasImage && map.hasImage(c.id)) continue;
      try { map.addImage(c.id, tileData(c, p)); n++; } catch (e) { /* already there */ }
    }
    return n;
  }

  // ── layers ──────────────────────────────────────────────────────────
  /** ['interpolate', p, wd, wg, wn] — the shape timeofday.js bakes with. */
  function bakedColor(p) {
    p = Math.max(0, Math.min(1, p));
    return ['interpolate', ['linear'], p,
      0, ['to-color', ['get', 'wd'], '#888888'],
      0.5, ['to-color', ['get', 'wg'], '#888888'],
      1, ['to-color', ['get', 'wn'], '#333344'],
    ];
  }

  let _added = false, _gone = [];

  /**
   * Stop `buildings-3d` and `buildings-roof` drawing the buildings this pass
   * has replaced, and KEEP them stopped.
   *
   * The re-check is not paranoia. js/app.js's stadium loader does the same
   * read-modify-write on the same two filters after its own fetch resolves, and
   * six building passes are landing on this file; if two of them read the
   * filter before either writes it, the second write silently drops the first
   * pass's exclusions and one layer renders inside another. Re-asserting a few
   * times is cheap and makes the order irrelevant.
   */
  function ensureFiltered(map) {
    if (!_gone.length) return;
    const mine = ['!', ['in', ['get', 'id'], ['literal', _gone]]];
    const carries = (f) => JSON.stringify(f || '').indexOf(_gone[0]) !== -1;
    for (const id of ['buildings-3d', 'buildings-roof']) {
      if (!map.getLayer(id)) continue;
      let f = null;
      try { f = map.getFilter(id); } catch (e) { continue; }
      if (carries(f)) continue;
      try { map.setFilter(id, f ? ['all', f, mine] : mine); } catch (e) {}
    }
  }

  window.initDrag = async function initDrag(map) {
    if (!DRAG.on || _added || map.getSource(SRC)) return;
    _added = true;

    let gj;
    try {
      const r = await fetch(DATA);
      if (!r.ok) throw new Error(DATA + ': ' + r.status);
      gj = await r.json();
    } catch (e) {
      console.warn('[drag]', e.message, '- pass not drawn');
      return;
    }

    const p = (window.__todCurrentP != null) ? window.__todCurrentP : 0.3;
    const combos = stampPatterns(gj.features);
    const imgs = registerImages(map, p);
    map.addSource(SRC, { type: 'geojson', data: gj, ...(window.PATTERN_TILING || {}) });

    _gone = gj.replacedBuildingIds || [];
    ensureFiltered(map);
    // ... and again after the other passes' own fetches have had time to land.
    for (const ms of [700, 2500, 6000]) setTimeout(() => ensureFiltered(map), ms);

    // The anchor must be the first symbol layer AFTER our buildings, not the
    // first in the style. The basemap puts symbol layers immediately after
    // `background`, so anchoring there drops the whole pass to the BOTTOM of
    // the stack, under the ground — which is exactly what happened to the
    // stadium, and it still renders, just repainted by the ground fill on top.
    const stack = map.getStyle().layers;
    const after = Math.max(0, stack.findIndex(l => l.id === 'buildings-3d'));
    const anchor = (stack.slice(after + 1).find(l => l.type === 'symbol') || {}).id;

    if (!map.getLayer(L_WALL)) {
      map.addLayer({
        id: L_WALL, type: 'fill-extrusion', source: SRC, minzoom: DRAG.minZoom,
        filter: ['==', ['get', 'kind'], 'wall'],
        paint: {
          // No `coalesce` fallback: every wall feature is stamped by
          // stampPatterns above, and a fallback id would have to be one that is
          // guaranteed registered — which is exactly the kind of quiet
          // assumption that leaves a wall painted transparent. drag-check.mjs
          // asserts instead that every `wp` in the file has an image.
          'fill-extrusion-pattern': ['get', 'wp'],
          'fill-extrusion-height': ['get', 'h'],
          'fill-extrusion-base': ['get', 'base'],
          'fill-extrusion-opacity': DRAG.opacity,
          // OFF. The gradient darkens the BOTTOM of every extrusion, and these
          // are three to fifteen stacked extrusions per building — so it draws
          // a dark line under each band. On a 4.3 m shopfront the whole band
          // falls inside the gradient and the glass goes black. The band tones
          // already carry the vertical hierarchy. (Same call as stadium-wall.)
          'fill-extrusion-vertical-gradient': false,
        },
      }, anchor);
    }
    if (!map.getLayer(L_CAP)) {
      map.addLayer({
        id: L_CAP, type: 'fill-extrusion', source: SRC, minzoom: DRAG.minZoom,
        filter: ['==', ['get', 'kind'], 'cap'],
        paint: {
          'fill-extrusion-color': bakedColor(p),
          'fill-extrusion-height': ['get', 'h'],
          'fill-extrusion-base': ['get', 'base'],
          'fill-extrusion-opacity': 1.0,
        },
      }, anchor);
    }

    const audit = window.dragTileAudit();
    console.log('[drag]', gj.features.length, 'features,', _gone.length,
                'buildings replaced,', combos, 'tile combos (', imgs, 'new images ),',
                audit.filter(r => !r.ok).length, 'tiles out of spec');
  };

  /** The (family x material) combos actually registered. Exposed because the
   * `wp` ids are stamped at RUNTIME onto this module's copy of the features —
   * a verification script that re-fetches data/drag.geojson sees none of them
   * and its "every pattern image is registered" check passes over an empty set,
   * which is how a vacuous assertion gets shipped as a green one. */
  window.dragCombos = () => _combos.map(c => ({ id: c.id, fam: c.fam, wd: c.wd }));

  /**
   * The mean colour a family's tile is DRAWN at, for a given hour.
   *
   * This separates two questions that look identical on screen and have
   * completely different fixes: "is the tile wrong?" and "is the tile right and
   * the renderer/light doing something to it?". The shopfront came back dark at
   * midnight in a screenshot; the wall shading changes so much between noon and
   * midnight that the frame could not distinguish a tile that had never been
   * repainted from one that had. This can: it re-runs the draw and reads the
   * bytes, with no map, no light and no post-process involved.
   */
  window.dragTileSample = function dragTileSample(fam, p) {
    const c = _combos.find(x => x.fam === fam);
    if (!c) return null;
    const d = tileData(c, p).data;
    let r = 0, g = 0, b = 0;
    const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    r /= n; g /= n; b /= n;
    return { fam, id: c.id, p, mean: [Math.round(r), Math.round(g), Math.round(b)],
             luma: +(0.30 * r + 0.59 * g + 0.11 * b).toFixed(1) };
  };

  window.applyDragColors = function applyDragColors(map, p) {
    if (!map || !map.getLayer) return;
    for (const c of _combos) {
      try {
        if (map.hasImage && map.hasImage(c.id)) map.updateImage(c.id, tileData(c, p));
        else map.addImage(c.id, tileData(c, p));
      } catch (e) { /* not registered yet */ }
    }
    try {
      if (map.getLayer(L_CAP))
        map.setPaintProperty(L_CAP, 'fill-extrusion-color', bakedColor(p));
    } catch (e) {}
  };

  /** Re-read DRAG after a live edit. */
  window.applyDragSettings = function applyDragSettings(map) {
    if (!map || !map.getLayer) return;
    for (const id of [L_WALL, L_CAP]) {
      if (!map.getLayer(id)) continue;
      try {
        map.setLayoutProperty(id, 'visibility', DRAG.on ? 'visible' : 'none');
        map.setPaintProperty(id, 'fill-extrusion-opacity',
                             id === L_CAP ? 1.0 : DRAG.opacity);
      } catch (e) {}
    }
  };

  // ── bootstrap ───────────────────────────────────────────────────────
  // js/app.js is owned by another pass and will not call us. Copied verbatim
  // from the boot() at the bottom of js/outer.js, including the applyTimeOfDay
  // wrap — installed here, after every module has loaded, so script order
  // cannot break it.
  function boot() {
    const map = window.__map;
    if (!map) return setTimeout(boot, 60);

    const hookTod = () => {
      if (typeof window.applyTimeOfDay !== 'function' || window.applyTimeOfDay.__drag) return;
      const prev = window.applyTimeOfDay;
      const wrapped = function (m, p, force) {
        const r = prev.apply(this, arguments);
        try { window.applyDragColors(m, p); } catch (e) {}
        return r;
      };
      wrapped.__drag = true;
      // ALSO a global, and not only a property on the wrapper: six passes are
      // wrapping this same function and whichever one boots last owns the
      // outermost closure, so `window.applyTimeOfDay.__drag` is false for every
      // pass except that one even though all of them are being called. A check
      // written against the property read as "the drag pass never hooked
      // time-of-day" while the drag pass was demonstrably going dark at night.
      window.__dragTodHooked = true;
    };

    const go = () => {
      // Wait for the core buildings: the filters that stop them drawing the
      // replaced footprints cannot be written before those layers exist, and a
      // pass that adds its bands under a building still being extruded is
      // invisible from every angle except directly overhead.
      if (!map.getLayer('buildings-3d')) return setTimeout(go, 120);
      hookTod();
      window.initDrag(map);
    };
    if (map.isStyleLoaded && map.isStyleLoaded()) go();
    else map.once('load', () => setTimeout(go, 0));
  }
  boot();
})();
