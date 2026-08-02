/**
 * facades.js — procedural facade textures for Austin 3D Explorer
 *
 * MapLibre v5 supports `fill-extrusion-pattern`. NOTE, because the comment
 * here used to say the opposite and it cost a whole investigation: the pattern
 * does NOT tile in world space. It is scaled by the TILE grid, so a 64 px
 * repeat covers ~14.8 m at tile zoom 18 and doubles with every zoom out —
 * ~118 m by zoom 15. See the measurement note above GRIDS.
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

  const TILE = 64;              // DRAWING units per pattern repeat
  const TARGET_BUCKETS = 14;    // colour buckets kept after merging

  // ── The pattern is SCREEN-locked, and that is the whole of two defects ──
  //
  // MEASURED, and it is definitional rather than empirical: one repeat covers
  // `image.width / image.pixelRatio` CSS PIXELS of screen, at every zoom. With
  // a 64 px image at pixelRatio 1 that is 64 CSS px, always. Convert it to
  // metres at this latitude (res = 67551 / 2^zoom m per CSS px) and the world
  // size of one repeat is:
  //
  //     zoom      14      15      16      17      18
  //     m/repeat  264     132      66      33      16
  //
  // A downtown tower is 30-60 m wide. So at the zooms this app actually flies —
  // and the tour's own downtown pose is z15.2 — the repeat is TWO TO FOUR TIMES
  // WIDER THAN THE BUILDING, and each tower shows an arbitrary FRAGMENT of one
  // repeat: whichever slice of the 64 px tile its footprint happens to land on.
  // A tower that lands on the tile's pier band gets no windows at all; one that
  // lands on a single column of openings gets exactly one window column. That is
  // the reported "sometimes like one window column renders per downtown
  // building", and it is not intermittent — it is a phase, fixed by where the
  // building sits, and it changes as you fly.
  //
  // The same fact is half of "windows are super blurred": at z15-16 one texel is
  // 1-2 m of wall, so a window is one or two texels wide before anything is
  // drawn.
  //
  // THE FIX IS A MIP CHAIN, hand-rolled, because MapLibre samples the pattern
  // atlas LINEAR with no mipmaps (atlases cannot be mipmapped without bleeding
  // between images). Three tiers of the SAME drawing at three screen sizes,
  // selected by a `step` on zoom, which keeps the repeat inside 16-33 m of wall
  // across the entire flying range instead of 16-264 m:
  //
  //     tier   css px   z14   z15   z16   z17   z18
  //     far      16      66    33    16     -     -
  //     mid      32       -     -    33    16     -
  //     near     64       -     -     -    33    16
  //
  // `pixelRatio` is what buys the smaller screen size: a 64-texel image declared
  // at pixelRatio 4 occupies 16 CSS px. It is minified 4x on the way, so each
  // tier carries the box prefilter that minification needs — which is exactly
  // what a mip level is, and it is why the NEAR tier can now be drawn sharp.
  // Before this, one tile had to serve 1:1 and 4:1 at once, so it wore a
  // radius-2/amount-0.9 low-pass at every zoom: a 5x5 box over a 5x4 window.
  // That is the other half of "super blurred", and it was authored, not a bug.
  //
  // TASTE KNOB: `css` is the world scale of the windows (bigger = fewer, larger
  // windows); `minZoom` is where each tier takes over. Stops are INTEGERS on
  // purpose — MapLibre evaluates a *-pattern property at floor(zoom) and
  // floor(zoom)+1 and cross-fades between them, so a fractional stop would not
  // land where it was written, and an integer one gives a free LOD dissolve.
  const TIERS = [
    // `soften` is the box-blur radius in 64-unit drawing space, and it is a
    // MATCHED prefilter, not a taste value: a tier minified Nx needs a box N
    // texels wide, i.e. radius (N-1)/2. Far is 4x -> 1.5, mid is 2x -> 0.75,
    // near is 1:1 -> none. Radius 3 was tried on the far tier first and it is
    // measurably too much: a 7-texel box is wider than the 8-texel row pitch,
    // so it erased every floor line while leaving the full-height piers and
    // weathering streaks untouched, and the tower read as corduroy.
    { id: 'x', css: 16, minZoom: 0,  soften: 1.5 },   // far
    { id: 'f', css: 32, minZoom: 16, soften: 0.75 },  // mid
    { id: '',  css: 64, minZoom: 17, soften: 0.0 },   // near — sharp
  ];
  window.FACADE_TIERS = TIERS;

  // Texels per repeat in the NEAR tier. A screen shows `css * devicePixelRatio`
  // device pixels per repeat, so drawing more texels than that is minification
  // and drawing fewer is magnification — a 1x tile composited at 2x is soft by
  // construction, which is the third candidate on the list and the only one that
  // costs anything to fix. Quantised, and capped at 2: nothing on a phone is
  // reading a window at 3x.
  const SCALE = Math.max(1, Math.min(2, Math.round(window.devicePixelRatio || 1)));
  const RES = TILE * SCALE;     // real canvas texels per repeat
  // The pixelRatio each tier is registered with. RES texels over `css` CSS px.
  const tierPixelRatio = t => RES / t.css;

  // Facade families — window geometry, chosen by height/class.
  //   lo  low-rise houses + sheds: sparse, large openings
  //   md  walk-ups, campus halls: punched-window grid
  //   tw  towers: dense curtain-wall grid
  //   dk  parking decks: open horizontal slots, no glass
  //   st  stadiums + arenas: masonry piers, NOT windows (see drawStadium)
  // ── The scale bug these numbers exist to fix ────────────────────────
  //
  // The module header above used to claim the pattern tiles in WORLD space and
  // "keeps a constant physical size as you fly". MEASURED, that is false: a
  // 64 px repeat covers ~14.8 m at tile zoom 18, ~30 m at 17, ~59 m at 16 and
  // ~118 m at 15. It HALVES at every integer zoom, because MapLibre scales
  // *-pattern by the tile grid, not by the world. Confirmed by rendering one
  // tower at z17.6 / z16.6 / z15.6 and counting window rows down its face: the
  // count halves each step. If the pattern were world-locked it would not move.
  //
  // The old grids were sized for a 20 m tile, which only exists near zoom 18.
  // At the zooms this app actually flies — 15 to 17 — the same tile spans
  // 30-118 m, so one "window" was drawn 5 to 18 m across. That is the whole of
  // the reported "huge blocky uniform windows": a scale bug, not a taste one.
  //
  // These are sized for the middle of the real flying range (tile zoom 16-17,
  // 30-59 m per tile), which puts floor-to-floor in the 3-6 m band where it
  // belongs. Very close in they read as fine texture, which is the correct
  // failure direction — a real window at cruise IS sub-pixel.
  //
  // GLAZING is the second correction. Measured references: UT campus historic
  // 15-18%, mid-century academic ~20-26%, West Campus student mid-rise 20-28%,
  // curtain-wall towers 55-70%. The old `md` was 39% and `tw` 43% — the
  // midpoint of everything, which is why one texture looked wrong on a
  // limestone hall AND on a glass tower. `tg` now goes UP, the rest come DOWN.
  // A WALL IS MOSTLY WALL. That is the rule the first cut of these numbers broke
  // and it is worth stating as a rule, because the failure does not look like
  // "too much glass" — it looks like scaffolding. Packing the openings closer
  // together left 1.3 to 3 px of wall between them, and at any real viewing
  // distance those hairlines fuse: the facade stops reading as punched windows
  // and starts reading as ribbed metal, or a parking deck with no floors.
  //
  // So the constraint is on the GAP, not just the ratio: at least MIN_PIER px of
  // wall across and MIN_SPANDREL px down, between every pair of openings.
  //
  // `want` is the intended glazing fraction, and it is CHECKED against the
  // geometry at load (see the audit below) rather than trusted. The previous
  // values carried hand-written comments claiming half the glazing the numbers
  // actually produced — 17.1% written next to a grid that computes to 34.2% —
  // and that wrong number was reported as a fix. Arithmetic in a comment is a
  // claim; arithmetic in code is a fact.
  const MIN_PIER = 5, MIN_SPANDREL = 3;
  const GRIDS = {
    lo: { rows: 2, cols: 3, w: 8, h: 7, want: 0.08 },  // houses, sheds
    mr: { rows: 6, cols: 5, w: 6, h: 4, want: 0.18 },  // 2-3 storey walk-ups, shops
    mh: { rows: 8, cols: 5, w: 5, h: 4, want: 0.20 },  // 4-7 storey campus halls
    tr: { rows: 9, cols: 5, w: 5, h: 4, want: 0.22 },  // residential towers
    // `curtain` exempts a family from the pier/spandrel minimum: real curtain
    // wall IS tight glass on thin mullions, so the gap rule that stops punched
    // facades reading as scaffolding is simply the wrong rule here.
    tg: { rows: 10, cols: 7, w: 6, h: 5, want: 0.51, curtain: true },
    dk: null, // drawn as bands
    st: null, // drawn as piers + spandrel/slot tiers (drawStadium)
  };

  // ── Wall material ───────────────────────────────────────────────────
  //
  // The wall between the openings was a flat colour field, which is the other
  // half of "ALL walls are just so many windows" — there was no wall, only a
  // grid.
  //
  // WHAT CANNOT BE DRAWN, measured rather than assumed. At this app's flying
  // zooms a 64 px repeat covers 30-59 m, so one texel is 0.43-0.65 m of wall
  // and the smallest feature that survives camera motion is about two texels,
  // ~1.0-1.3 m. That rules out every masonry unit outright: a modular brick
  // course is 0.068 m = 0.1 texels; an ashlar course 0.2-0.3 m = 0.3-0.7; a
  // precast panel joint 0.019 m = 0.03. Drawing brick at the 1 px floor does
  // not draw brick — it asserts a 0.5 m course, which is concrete block, and
  // states it confidently on a limestone hall. So no coursing, on anything.
  //
  // WHAT SURVIVES, and is therefore all we draw: block-to-block value scatter
  // at ~2 m, vertical weathering, and the structural bay.
  //
  // Also ruled out by the tile itself: cornices, plinths, string courses and
  // ground-floor storefronts. The tile repeats vertically with no anchor, so
  // anything keyed to the top or bottom of a building appears every ~40 m up
  // the wall. That needs stacked geometry (bake_stadium.py does it for DKR) and
  // is not attempted here.
  const WALL = {
    CELL: 4,                     // px per mottle cell -> 1.7-2.6 m, one block face
    MOTTLE:  { lo: 0.070, mr: 0.075, mh: 0.080, tr: 0.055, tg: 0.030 },
    STREAKS: { lo: 3, mr: 5, mh: 7, tr: 6, tg: 3 },
    STREAK_DARK: 0.07,
    STREAK_ALPHA: 0.22,
    PIER: { mr: 1, mh: 1, tr: 1 },   // masonry families only; not tg, not lo
    PIER_LIGHT: 0.045,
    PIER_SHADOW: 0.055,
  };

  // The mottle depends only on (family, seed) — not on wall colour and not on
  // the hour — so it is built once and composited. Emitting 256 fillRects per
  // tile instead would land on updateFacades, which repaints every image on
  // every time-of-day step.
  // Cells are signed deltas in [-1,1], not a canvas. The first cut built a 64x64
  // canvas per (family,bucket) and composited it with drawImage; correct, but it
  // took the atlas repaint from 44 ms to 230 ms, because the tile context is
  // `willReadFrequently` (it has to be — tileData ends in getImageData) and
  // drawImage into a CPU-backed canvas takes the slow path. applyTimeOfDay
  // quantises to 1/128, so dragging the hour slider would have paid that 128
  // times. Applied to the pixel buffer we are already reading instead.
  const _noise = new Map();
  function noiseCells(seed) {
    let a = _noise.get(seed);
    if (a) return a;
    const N = TILE / WALL.CELL;
    a = new Float32Array(N * N);
    for (let i = 0; i < a.length; i++) a[i] = hash01(seed + 5501, i % N, (i / N) | 0) * 2 - 1;
    _noise.set(seed, a);
    return a;
  }

  // Set by drawTile, consumed by tileData on the same call.
  let _mottle = null;

  /** Fill a full-height column, wrapping across the tile seam. */
  function fillWrap(ctx, x, w, style) {
    ctx.fillStyle = style;
    x = ((x % TILE) + TILE) % TILE;
    ctx.fillRect(x, 0, w, TILE);
    if (x + w > TILE) ctx.fillRect(x - TILE, 0, w, TILE);
  }

  function drawWallMaterial(ctx, fam, wall, dark, seed) {
    // Mottle is handed to tileData rather than drawn — see noiseCells above.
    const amp = WALL.MOTTLE[fam];
    _mottle = amp ? { cells: noiseCells(seed), amp: amp * (1 - dark * 0.6) } : null;
    // Weathering: aperiodic in x, CONSTANT in y, so it tiles in both axes with
    // no anchor dependency and cannot moire against the window grid. Same
    // technique as DKR's `sd` band, which is the one large flat surface in this
    // file that already does not read as plastic.
    const n = WALL.STREAKS[fam] || 0;
    for (let s = 0; s < n; s++) {
      const x = Math.round(hash01(seed + 5623, s, 0) * TILE);
      const w = 2 + Math.round(hash01(seed + 5641, s, 0) * 2);   // 2-4 px, never 1
      fillWrap(ctx, x, w, css(mix(wall, [0, 0, 0], WALL.STREAK_DARK),
                              WALL.STREAK_ALPHA * (1 - dark * 0.7)));
    }
  }

  // Runtime audit. Cheap, runs once, and turns a silent 2x error into a console
  // line. Exposed so a verification script can assert on it too.
  window.facadeGridAudit = function facadeGridAudit() {
    const rows = [];
    for (const [fam, g] of Object.entries(GRIDS)) {
      if (!g) continue;
      const glaze = (g.rows * g.cols * g.w * g.h) / (TILE * TILE);
      const pier = TILE / g.cols - g.w, spandrel = TILE / g.rows - g.h;
      const ok = Math.abs(glaze - g.want) < 0.04 &&
                 (g.curtain || (pier >= MIN_PIER && spandrel >= MIN_SPANDREL));
      rows.push({ fam, glaze: +(glaze * 100).toFixed(1), want: +(g.want * 100).toFixed(1),
                  pierPx: +pier.toFixed(1), spandrelPx: +spandrel.toFixed(1), ok });
      if (!ok) console.warn('[facades] grid out of spec:', fam, rows[rows.length - 1]);
    }
    return rows;
  };

  // ── Stadium facade ──────────────────────────────────────────────────
  // A stadium is not an office building, and DKR in particular has almost NO
  // glass: what reads as windows in every photograph is open VOID — recessed
  // slots, vomitory mouths, the shadow under a cantilevered deck. A punched
  // window grid therefore puts glazing where there is literally a hole. The
  // right read is a structural frame: full-height piers crossed by stacked
  // spandrel-and-slot bands, one material, one colour, light doing the work.
  //
  // Researched, not assumed. The obvious guess — brick, because the north end
  // zone masonry is well documented — is WRONG for the building as a whole:
  // the dominant surface is cast-in-place concrete, repainted 2012-13 and
  // again on the west face in 2017, reading warm off-white. Brick appears only
  // at the 2008 north end zone. Sampled references: sunlit painted concrete on
  // DKR's own concourse decks #C5C1B6 (from data/dkr_aerial.png), recessed
  // voids #14100A, deck soffit in shade #4E433F, UT burnt orange #BF5700
  // (Pantone 159, published).
  //
  // ANCHOR-AGNOSTIC BY DESIGN. The tile repeats every ~20 m VERTICALLY as well
  // as horizontally, so nothing here may assume it sits at the roofline or at
  // grade. A first cut had a fascia band near the tile top and a plinth band at
  // the bottom; they landed adjacent across the seam and produced a phantom
  // dark-light-dark stripe three times up the wall. Everything below is
  // designed to tile.
  const STADIUM = {
    GAIN: 1.15,            // wall lift: the pattern removes ~13% of mean luma
    WARM: 0.25,            // pull toward warm concrete, luminance-gated
    WARM_TINT: [232, 222, 206],

    TIERS: 5,              // bands per 20 m -> ~4.0 m floor-to-floor
    SLOT_H: 4,             // px recessed slot (~1.25 m)
    SLOT_DARK: 0.50,
    CORE_DARK: 0.66,       // 1 px deep core at the head of the slot
    LIP_LIGHT: 0.16,       // 1 px sunlit hood above the slot

    CONCOURSE_TIER: 1,     // one tier in five is the deep concourse band, so a
    CONCOURSE_H: 7,        // concourse recurs every 20 m -> 3 on a 63 m bowl,
    CONCOURSE_DARK: 0.58,  // which is what DKR actually has

    PIERS: 4,              // per 20 m -> 5.0 m bay centres
    PIER_W: 5,             // px (~1.6 m)
    MAJOR_PIER_W: 7,       // pier 0 is the wider circulation pier
    PIER_LIGHT: 0.10,
    PIER_SHADOW: 0.28,     // hard shadow down the right flank of each pier
    GOLDEN_WARM: 0.25,

    NIGHT_GLOW: [255, 186, 110],
    NIGHT_CONCOURSE: 0.30, // a lit concourse is a RIBBON, not a window scatter
    NIGHT_PORTAL: 0.35,
    PORTAL_RATE: 0.30,
  };

  /** One stadium tile: prepared wall, spandrel/slot tiers, night ribbon, piers. */
  function drawStadium(ctx, wall, dark, night, golden, seed) {
    const T = TILE;
    const fill = (c, x, y, w, h) => { ctx.fillStyle = css(c); ctx.fillRect(x, y, w, h); };

    // Brightness compensation. The pattern darkens the wall ~13% on average, so
    // without this DKR renders darker and greyer than its baked colour intends.
    // MULTIPLICATIVE on purpose: a mix-to-white would lift a dark building far
    // more in relative terms and turn Moody Center's #4c4c51 into mid grey.
    let w = wall.map(c => Math.min(250, c * STADIUM.GAIN));
    const lum = (0.30 * w[0] + 0.59 * w[1] + 0.11 * w[2]) / 255;
    // Gate the warm-concrete pull on luminance so it applies to DKR and the
    // pale grandstands and effectively not at all to a dark arena.
    const warmT = STADIUM.WARM * Math.max(0, Math.min(1, (lum - 0.35) / 0.30));
    w = mix(w, STADIUM.WARM_TINT, warmT);

    fill(w, 0, 0, T, T);

    // ── horizontal tiers: spandrel, then a recessed slot with a lit hood
    let concourseY = 0, concourseH = 0;
    for (let k = 0; k < STADIUM.TIERS; k++) {
      const y1 = Math.round((k + 1) * T / STADIUM.TIERS);
      const isC = (k === STADIUM.CONCOURSE_TIER);
      const sh = isC ? STADIUM.CONCOURSE_H : STADIUM.SLOT_H;
      const sy = y1 - sh - 1;                       // 1 px of spandrel below each
      fill(mix(w, [255, 255, 255], STADIUM.LIP_LIGHT * (1 - dark * 0.8)), 0, sy - 1, T, 1);
      fill(mix(w, [0, 0, 0], isC ? STADIUM.CONCOURSE_DARK : STADIUM.SLOT_DARK), 0, sy, T, sh);
      fill(mix(w, [0, 0, 0], STADIUM.CORE_DARK), 0, sy, T, 1);
      if (isC) { concourseY = sy; concourseH = sh; }
    }

    // ── night: a continuous ribbon of concourse light, with brighter portals.
    // Deliberately NOT the per-pane scatter the window families use — a lit
    // stadium concourse is a strip, and the slots staying dark is what keeps
    // DKR reading as the big silhouette on the east side of campus.
    if (night > 0.02 && concourseH) {
      const base = mix(w, [0, 0, 0], STADIUM.CONCOURSE_DARK);
      const glow = mix(base, STADIUM.NIGHT_GLOW, STADIUM.NIGHT_CONCOURSE * night);
      fill(glow, 0, concourseY, T, concourseH);
      for (let b = 0; b < 8; b++) {
        if (hash01(seed + 7001, b, 0) > STADIUM.PORTAL_RATE) continue;
        fill(mix(glow, STADIUM.NIGHT_GLOW, STADIUM.NIGHT_PORTAL * night),
             Math.round(b * T / 8) + 2, concourseY + 1, 4, concourseH - 2);
      }
    }

    // ── piers last, so they cross the slots and the night ribbon like real
    // structure standing in front of the openings.
    const hi = mix(mix(w, [255, 255, 255], STADIUM.PIER_LIGHT * (1 - dark * 0.8)),
                   [255, 198, 132], STADIUM.GOLDEN_WARM * golden);
    const sha = mix(w, [0, 0, 0], STADIUM.PIER_SHADOW);
    for (let i = 0; i < STADIUM.PIERS; i++) {
      const x = Math.round(i * T / STADIUM.PIERS);
      const pw = i === 0 ? STADIUM.MAJOR_PIER_W : STADIUM.PIER_W;
      fill(hi, x, 0, pw, T);
      fill(sha, x + pw, 0, 1, T);
    }
  }

  // ── DKR's four elevations, and the two bands they share ─────────────
  //
  // These are the tiles for the stacked wall bands baked by bake_stadium.py.
  // Each band is 11-25 m tall, so a 20 m tile shows roughly one repeat and the
  // texture can finally mean something instead of marching up 63 m of wall.
  //
  // STILL ANCHOR-AGNOSTIC. The tile's vertical phase within a band is not
  // controllable, so no tile below puts a one-off feature near its top or
  // bottom edge — that is what produced a phantom dark-light-dark stripe three
  // times up the wall on the first attempt. Vertical hierarchy comes from the
  // BAND BOUNDARIES, which are geometry, not from the texture.
  const DKR = {
    GAIN: 1.15,            // the pattern removes ~13% of mean luma; put it back
    WARM: 0.22,
    WARM_TINT: [232, 222, 206],

    // sp — concourse arcade. Massive piers, deep portals between them. This is
    // the band at eye level from San Jacinto, so it does most of the work of
    // saying "you cannot walk into an office building here".
    SP_BAYS: 4,            // per 20 m -> 5 m bay centres
    SP_PIER: 7,            // px (~2.2 m) of pier
    SP_VOID: 0.56,         // how dark the opening goes. 0.74 went effectively
                           // black and the plinth read as a row of teeth
                           // rather than an arcade you could walk into.
    SP_FLOOR: 0.34,        // light spilling across the floor of the opening
    SP_NIGHT: 0.42,        // a lit concourse is a continuous glow, not panes

    // sb — Bellmont Hall (west): eleven levels of 1972 concrete with deep-set
    // horizontal window bands and slim vertical fins.
    SB_TIERS: 5,           // ~4 m floor-to-floor
    SB_GLASS_H: 5,
    SB_REVEAL: 0.20,       // lit hood over each band
    SB_SPANDREL: 0.13,
    SB_FIN_EVERY: 8,
    SB_FIN_LIGHT: 0.11,

    // sn — 2008 north end zone: brick veneer, punched windows, pier towers.
    // North end zone: chamfered brick piers with OPEN bays between them, per
    // the 2008 photograph. 3 bays across a 64 px tile puts the pier centres at
    // roughly 5-10 m depending on zoom, which is the real spacing.
    SN_BAYS: 3,
    SN_PIER: 11,           // px of brick pier
    SN_PIER_LIGHT: 0.11,
    SN_PIER_SHADE: 0.26,   // the chamfered return, in shadow
    SN_STONE: 0.30,        // buff cast-stone quoin at the chamfer
    SN_VOID: 0.62,         // how dark the open bay goes
    SN_SLAB: 0.34,         // lit slab edge of each concourse deck inside
    SN_DECK: 9,            // px between those decks
    SN_MULLION: 4,
    SN_NIGHT: 0.30,

    // sf — east grandstand back: cast-in-place concrete, board-formed, almost
    // solid. A few narrow slots are the backs of the vomitories.
    SF_BOARD: 4,           // px between form-board lines
    SF_BOARD_DARK: 0.06,
    SF_SLOTS: 3, SF_SLOT_W: 3, SF_SLOT_DARK: 0.50,

    // sg — 2021 south end zone: club and suite levels, so horizontal glazing.
    SG_TIERS: 4,           // ~5 m floor-to-floor
    SG_GLASS_H: 8,
    SG_MULLION: 6,
    SG_METAL: 0.10,        // spandrel panel, cooler than the concrete

    // sd — back of the upper deck. NOT a blank wall: the first cut made this a
    // near-featureless slab and, at 34% of a 63 m elevation, it became the
    // dominant surface and read as fog. What is actually up there is the
    // exposed structural bay rhythm carrying the raked deck — piers with
    // shallow recesses between them. Lower contrast than the plinth, because
    // these recesses are shallow and those are holes through the building.
    SD_BAYS: 4,            // per 20 m -> 5 m bay centres, same grid as the piers below
    SD_PIER: 6,
    SD_RECESS: 0.10,       // 0.19 turned the whole top third into a picket fence
    SD_PIER_LIGHT: 0.05,
    SD_PANEL: 11,          // px between vertical joints inside a recess
    SD_JOINT_DARK: 0.10,
    SD_STAIN: 0.05,        // faint vertical weathering, the thing that stops a
                           // large surface reading as untextured plastic
  };

  // How much each tile darkens its wall on average, and therefore how much
  // brightness to put back. One shared 1.15 over-lit the near-blank fascia into
  // a pale haze while barely covering the deep-portal plinth.
  // Per-family brightness. `sn` is BELOW 1 on purpose: it is the one brick
  // elevation, the gain and the warm tint together were lifting it into the same
  // pale tan as the concrete sides, and a north end zone that does not read as
  // brick is the whole per-side facade idea failing quietly.
  const DKR_GAIN = { sp: 1.20, sb: 1.14, sn: 0.92, sf: 1.06, sg: 1.12, sd: 1.04 };

  let palette = [];   // [{ wd, wg, wn }]
  let combos = [];    // ['md07', 'tw03', ...] — only families/buckets in use


  // ── Night windows — every taste value in one place ─────────────────
  //
  // Real cities are not one amber. Most windows are warm-white at slightly
  // different temperatures, a minority are cooler fluorescent/office light,
  // and the occasional pane flickers TV-blue. Weights are relative (normalised
  // at pick time). Order matters: the warm tones come first so a per-family
  // warm bias (below) can compress rolls into the warm end of the list.
  const WINDOW_TONES = [
    { rgb: [255, 191, 115], w: 0.40 },  // warm incandescent
    { rgb: [255, 209, 150], w: 0.30 },  // warm-white LED
    { rgb: [244, 235, 200], w: 0.18 },  // neutral white
    { rgb: [205, 219, 235], w: 0.09 },  // cool fluorescent (office)
    { rgb: [150, 190, 255], w: 0.03 },  // TV blue
  ];
  // Per-pane brightness, biased BRIGHT (1 - roll² keeps most panes near full
  // and leaves a dim tail). First cut used roll² — biased dim — and measurably
  // hollowed the city out: lit-pixel share in a fixed night crop fell from
  // 3.97% to 2.13% and the skyline went sleepy.
  //
  // MIN raised 0.40 -> 0.58 by the July 31 night pass. The dim tail was the
  // half of the scatter you could not see. Measured by night-luma.mjs with the
  // streetlights hidden, so this is the windows alone: lit window pixels were
  // 4.5% of a night frame at the campus core and 2.8% at the western edge, with
  // a MEDIAN lit pane at luma 70-86 — against unlit pale limestone that was the
  // brightest large surface in the same frame. The floor of the tail is what
  // moves here; PANE_BRIGHT_MAX is untouched, so nothing new clips.
  const PANE_BRIGHT_MIN = 0.58;
  const PANE_BRIGHT_MAX = 1.00;
  // A rare "hot pane" much brighter than its neighbours — pushed toward white.
  const HOT_PANE_RATE  = 0.07;   // fraction of LIT panes (was 0.05)
  const HOT_PANE_BOOST = 0.35;   // extra mix toward white
  // Occupancy range per family, hashed per (family × bucket) into a continuous
  // value — replaces the old `0.14 + (bucketIdx % 5) * 0.06`, which lit
  // neighbouring buildings in five visible lockstep classes. Family baselines
  // are urban truth: offices (tw) go dark at night, walk-up apartments (md)
  // don't, houses (lo) glow warm but sparse.
  // The roll is squared before mapping into the range, so most buildings sit
  // near the low end and a scatter run lively — matching the baseline look's
  // density (the dominant colour buckets sat at the low end of the old
  // formula too; a uniform roll here measured 2× the baseline lit-pixel
  // share and washed the skyline).
  //
  // The LOW ends were raised by the July 31 night pass (the high ends move with
  // them, by the same amount, so the spread per family is unchanged). Because
  // the roll is squared, the low end is what most buildings actually get:
  // E[occupancy] = lo + (hi-lo)/3, so raising `lo` by 0.12 moves the typical
  // building's occupancy by the full 0.12 while a building at the top of its
  // range barely notices. That is deliberately the shape of the fix — the
  // complaint is that the ordinary background city is too dark, not that the
  // liveliest towers are.
  //
  // Ceiling on this: the same comment above warns that a uniform (unsquared)
  // roll measured 2x the baseline lit-pixel share and washed the skyline out.
  // These land at ~1.5-1.7x the baseline mean occupancy, deliberately under it.
  // The check that says so is `scripts/verify/night-luma.mjs --baseline`, which
  // asserts the unlit mass did not rise with the lights. NOT night-silhouette
  // .mjs: that one locates its roofline with queryRenderedFeatures and finds no
  // column about two thirds of the time at its own pose (see docs/PASS_NIGHT.md
  // §4), so a green run from it is not evidence of much.
  const OCCUPANCY = {
    lo: [0.22, 0.46],   // houses: warm but sparse, moved least
    mr: [0.25, 0.54],   // walk-ups and shops: people are home
    mh: [0.24, 0.52],   // campus halls: partly offices, partly dorms
    tr: [0.28, 0.58],   // residential towers stay lit latest
    tg: [0.20, 0.46],   // offices go dark — but not to 8% of panes
    md: [0.24, 0.54],   // kept: parts still classify into it via span
    tw: [0.20, 0.48],
    dk: [0.00, 0.00],  // parking decks have no glazing (drawn as bands)
  };
  // Compresses a family's tone roll into the warm end of WINDOW_TONES.
  // 1.0 = full palette; 0.6 = houses almost never go fluorescent.
  //
  // `mh` and `tg` — campus halls and campus offices — were pulled warm by the
  // July 31 night pass as the facade half of the warm-core/cool-edge read.
  // Be honest about how weak a lever this is: the atlas is keyed by
  // (family x colour bucket) and carries NO position, so it cannot do a spatial
  // gradient at all. It only works here because the campus families happen to
  // sit in the core and the residential ones (`mr`, `tr`) happen to sit in West
  // Campus. The gradient that is actually spatial is the streetlights'
  // (js/night.js, WARM_ANCHOR).
  const TONE_WARM_BIAS = { lo: 0.60, mr: 0.85, mh: 0.74, tr: 0.80, tg: 0.86, md: 1.00, tw: 1.00, dk: 1.00 };
  // Parking decks at night: the deck-edge strip takes a cool fluorescent cast
  // and a touch more brightness — garages are the one building type lit cool.
  const DK_EDGE_NIGHT_TINT  = [190, 210, 235];
  const DK_EDGE_NIGHT_MIX   = 0.55;   // how far the edge shifts toward the tint
  const DK_EDGE_NIGHT_BOOST = 0.14;   // extra white in the edge at full night

  const TONE_CUM = [];
  { let acc = 0; for (const t of WINDOW_TONES) TONE_CUM.push(acc += t.w); }
  function pickTone(roll) {
    const x = roll * TONE_CUM[TONE_CUM.length - 1];
    for (let i = 0; i < TONE_CUM.length; i++) if (x <= TONE_CUM[i]) return WINDOW_TONES[i].rgb;
    return WINDOW_TONES[WINDOW_TONES.length - 1].rgb;
  }

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
  const RESIDENTIAL = /apartment|dormitory|residential|hotel|condo/;
  // Tall, and NOT curtain wall. Height alone cannot tell an office tower from a
  // science building, and on this campus the difference is the whole look: a
  // 1970s lab block is a punched masonry grid and a downtown office box is
  // glass. The `tg` fallthrough was answering "is it over 26 m and not flats?"
  // and calling everything else glass, which put 51% glazing on 19 university
  // buildings, 3 churches, 2 hospitals, a presidential library and a chilled
  // water plant. Named casualties included Patton Hall, the Harry Ransom
  // Center, the Neural Molecular Science Building and Chilling Station No. 6.
  //
  // Two of the buildings Simeon reported sit here: Gary L. Thomas clears the
  // 26 m line by 0.8 m (26.8 m over 8 floors is 3.35 m floor to floor, which is
  // an academic building, not a tower) and Biomedical Engineering at 32.6 m.
  // `tg` is also the only family exempt from the MIN_PIER / MIN_SPANDREL guard
  // via `curtain: true`, so it is the one family whose mullions land near the
  // pixel floor — which is the best available candidate for "glitches badly".
  const PUNCHED = new RegExp([
    'university', 'college', 'school', 'kindergarten',
    'church', 'chapel', 'cathedral', 'synagogue', 'mosque', 'temple',
    'hospital', 'clinic', 'civic', 'public', 'government',
    'library', 'museum', 'train_station', 'transportation',
    'industrial', 'manufacture', 'warehouse', 'utility', 'service',
  ].join('|'));

  function familyFor(props) {
    const cls = props.building_class || '';
    if (/parking|garage|carport/.test(cls)) return 'dk';
    // A stadium is not an office building. Before this, DKR was 63 m tall so it
    // fell through to `tw` and wore a dense curtain-wall grid — the single
    // loudest wrong note on campus. Class comes from the Overture/OSM bake.
    if (/stadium|arena|sports_centre|grandstand/.test(cls)) return 'st';
    const h = props.final_height || 0;
    if (h < 5)   return 'lo';
    if (h < 12)  return 'mr';
    if (h < 26)  return 'mh';
    // Above 26 m, class decides. Note the ORDER: a university dormitory matches
    // both lists, and it is a dormitory first — punched windows with the
    // residential rhythm, not a lab grid.
    if (RESIDENTIAL.test(cls)) return 'tr';
    // A tall punched building still wants the taller family's rhythm; `mh` is
    // sized for a 4-7 storey hall and reads squat on a 40 m block.
    if (PUNCHED.test(cls)) return h < 45 ? 'mh' : 'tr';
    // Everything left is unclassed or genuinely commercial. Downtown's towers
    // are almost entirely unclassed and land here, which is what `tg` is for.
    return 'tg';
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

    // 2b. Protected colours survive the cut regardless of how few buildings
    // wear them. Keeping the 14 most POPULOUS tones is the right default —
    // it is what stops 900 near-duplicates becoming mud — but it also means a
    // one-off material on a landmark is guaranteed to lose, and gets folded
    // into whatever tan its neighbours happen to average to. That is how the
    // Texas Capitol came back with a Sunset Red granite dome (its own layer)
    // standing on tan office walls (this atlas). A protected entry keeps its
    // EXACT colour rather than its group's mean, because the point is the
    // material, not the neighbourhood.
    const protectedIn = Array.isArray(window.FACADE_PROTECTED) ? window.FACADE_PROTECTED : [];
    const protectedBuckets = [];
    const protectedKeys = new Map();               // group key → protected idx
    for (const spec of protectedIn) {
      if (!spec || !spec.wd) continue;
      const rgb = hexToRgb(spec.wd);
      const [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
      const key = s < 0.10
        ? `n${Math.floor(l * 5)}`
        : `${Math.floor(h * 12)}-${Math.floor(l * 5)}-${s < 0.22 ? 0 : 1}`;
      if (protectedKeys.has(key)) continue;
      protectedKeys.set(key, protectedBuckets.length);
      protectedBuckets.push({
        key, n: 0, wd: rgb,
        wg: hexToRgb(spec.wg || spec.wd),
        wn: hexToRgb(spec.wn || spec.wd),
      });
    }

    const kept = protectedBuckets.concat(
      all.filter(g => !protectedKeys.has(g.key))
         .slice(0, Math.max(0, TARGET_BUCKETS - protectedBuckets.length)));
    const index = new Map();                       // group key → bucket idx
    kept.forEach((k, i) => index.set(k.key, i));
    // 3. fold the tail into its nearest survivor
    for (const g of all) {
      if (index.has(g.key)) continue;
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
      const fam = span < 5 ? 'lo' : span < 12 ? 'mr' : span < 26 ? 'mh' : 'tg';
      p.wp = fam + String(best).padStart(2, '0');
      p.wf = fam;
      if (combos.indexOf(p.wp) === -1) combos.push(p.wp);
    }
  };

  // The stadium's perimeter wall is baked geometry, not a building feature, so
  // it misses quantiseFacades. It also needs something the buildings source
  // cannot express: a different pattern per ELEVATION and per HEIGHT BAND. The
  // tile repeats every ~20 m in both axes, so a single 63 m extrusion can only
  // ever wear one texture from grade to rim — which is precisely the "big
  // repetitive window pattern" being fixed. bake_stadium.py emits twelve wall
  // features (four sides x three bands) each carrying its own `fam` and `wd`.
  window.quantiseStadiumFacades = function quantiseStadiumFacades(map, features) {
    if (!palette.length) return 0;
    let added = 0;
    const own = new Map();          // baked hex -> palette index
    for (const f of features) {
      const p = f.properties;
      if (!p || p.kind !== 'wall' || !p.wd) continue;
      // Its OWN palette entries, not the nearest of the city's fourteen. Those
      // buckets are the means of Austin's building colours and are almost all
      // tan; snapping to them turned the 2008 north end zone's brick veneer
      // back into tan and erased the one elevation with a different material.
      let idx = own.get(p.wd);
      if (idx == null) {
        idx = palette.length;
        palette.push({ wd: p.wd, wg: p.wg || p.wd, wn: p.wn || p.wd });
        own.set(p.wd, idx);
      }
      const fam = p.fam || 'st';
      p.wp = fam + String(idx).padStart(2, '0');
      p.wf = fam;
      if (combos.indexOf(p.wp) === -1) combos.push(p.wp);
      // initFacades has already run by now, so a new combo has no image yet and
      // MapLibre would paint the wall transparent. Every tier, not just the one
      // on screen — see ensureImages.
      added += ensureImages(map, p.wp, window.__todCurrentP != null ? window.__todCurrentP : 0.5);
    }
    return added;
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

  // ── DKR's per-elevation tiles ─────────────────────────────────────
  // One function per band family. All six share the same preamble: lift the
  // wall (the pattern costs ~13% of mean luma) and pull it a little toward warm
  // concrete, gated on luminance so a dark surface is left alone.
  function dkrWall(wall, fam) {
    let w = wall.map(c => Math.min(250, c * (DKR_GAIN[fam] || DKR.GAIN)));
    const lum = (0.30 * w[0] + 0.59 * w[1] + 0.11 * w[2]) / 255;
    return mix(w, DKR.WARM_TINT, DKR.WARM * Math.max(0, Math.min(1, (lum - 0.35) / 0.30)));
  }

  const DKR_TILES = {
    /** sp — concourse arcade: piers with deep portals between them. */
    sp(ctx, wall, dark, night, golden, glass, seed) {
      const T = TILE, w = dkrWall(wall, 'sp');
      const fill = (c, x, y, ww, hh) => { ctx.fillStyle = css(c); ctx.fillRect(x, y, ww, hh); };
      fill(w, 0, 0, T, T);
      const bay = T / DKR.SP_BAYS;
      const voidC = mix(w, [0, 0, 0], DKR.SP_VOID);
      const floor = mix(voidC, [255, 240, 215], DKR.SP_FLOOR * (1 - dark));
      const lit = mix(voidC, [255, 186, 110], DKR.SP_NIGHT * night);
      for (let b = 0; b < DKR.SP_BAYS; b++) {
        const x = Math.round(b * bay) + DKR.SP_PIER;
        const ow = Math.round(bay) - DKR.SP_PIER;
        if (ow <= 0) continue;
        const back = night > 0.02 ? lit : voidC;
        fill(back, x, 0, ow, T);
        // The opening is a hole through a thick wall, so one jamb is in deep
        // shade and the far side of the reveal catches light. Both run the FULL
        // tile height — nothing here may key off the top or bottom edge.
        fill(mix(back, [0, 0, 0], 0.40), x, 0, 1, T);
        fill(mix(back, night > 0.02 ? [255, 210, 150] : floor, 0.5), x + ow - 1, 0, 1, T);
      }
      // Piers last so they stand IN FRONT of the openings.
      const hi = mix(mix(w, [255, 255, 255], 0.09 * (1 - dark * 0.8)), [255, 198, 132], 0.22 * golden);
      const sha = mix(w, [0, 0, 0], 0.30);
      for (let b = 0; b < DKR.SP_BAYS; b++) {
        const x = Math.round(b * bay);
        fill(hi, x, 0, DKR.SP_PIER, T);
        fill(sha, x + DKR.SP_PIER, 0, 1, T);
      }
    },

    /** sb — Bellmont Hall: 1972 concrete, deep horizontal window bands. */
    sb(ctx, wall, dark, night, golden, glass, seed) {
      const T = TILE, w = dkrWall(wall, 'sb');
      const fill = (c, x, y, ww, hh) => { ctx.fillStyle = css(c); ctx.fillRect(x, y, ww, hh); };
      fill(w, 0, 0, T, T);
      const step = T / DKR.SB_TIERS;
      for (let k = 0; k < DKR.SB_TIERS; k++) {
        const y = Math.round(k * step + (step - DKR.SB_GLASS_H) / 2);
        fill(mix(w, [0, 0, 0], DKR.SB_SPANDREL), 0, y - 2, T, DKR.SB_GLASS_H + 4);
        fill(glass, 0, y, T, DKR.SB_GLASS_H);
        // A lit hood over the band is what makes it read RECESSED rather than
        // painted on — the single cheapest depth cue on a flat extrusion.
        fill(mix(w, [255, 255, 255], DKR.SB_REVEAL * (1 - dark * 0.8)), 0, y - 1, T, 1);
        if (night > 0.02) {
          for (let c = 0; c < 10; c++) {
            const r = hash01(seed, k, c);
            if (r > 0.34) continue;
            const tone = pickTone(hash01(seed + 11, k, c));
            const br = PANE_BRIGHT_MIN + (PANE_BRIGHT_MAX - PANE_BRIGHT_MIN) * (1 - Math.pow(hash01(seed + 3, k, c), 2));
            fill(mix(glass, tone, night * br), Math.round(c * T / 10) + 1, y, Math.round(T / 10) - 2, DKR.SB_GLASS_H);
          }
        }
      }
      const fin = mix(w, [255, 255, 255], DKR.SB_FIN_LIGHT * (1 - dark * 0.8));
      for (let x = 0; x < T; x += DKR.SB_FIN_EVERY) {
        fill(fin, x, 0, 2, T);
        fill(mix(w, [0, 0, 0], 0.16), x + 2, 0, 1, T);
      }
    },

    /** sn — 2008 north end zone. NOT a window wall; go and look at it.
     *
     * The reference is Commons `DKR_new_north_end_2008-08-30.JPG`, and it shows
     * something this tile previously got completely wrong. There is no punched
     * window grid on the north elevation. There are MASSIVE CHAMFERED BRICK
     * PIERS, and between them the bays are simply OPEN — you see straight
     * through to the stacked concourse decks inside, their slab edges catching
     * light against a deep shadow. That open-bay-and-pier rhythm is the entire
     * character of the elevation, and it is what the contractor meant by
     * "radiused block walls on the pedestrian ramps ... creates the angular
     * expression seen from the exterior".
     *
     * Drawing windows here was the same mistake as the city-wide one: reaching
     * for a window because it is a building, instead of looking at the building.
     * A few bays do carry tall grey-mullioned glass, so those are kept — as the
     * exception the photograph shows them to be, roughly one bay in three.
     */
    sn(ctx, wall, dark, night, golden, glass, seed) {
      const T = TILE, w = dkrWall(wall, 'sn');
      const fill = (c, x, y, ww, hh) => { ctx.fillStyle = css(c); ctx.fillRect(x, y, ww, hh); };
      fill(w, 0, 0, T, T);
      // Brick coursing is 68 mm and one texel is half a metre, so a "course"
      // here would be a lie about the material. What survives at this scale is
      // block-to-block colour scatter, which is what brick actually reads as.
      const bay = T / DKR.SN_BAYS;
      const deep = mix(w, [0, 0, 0], DKR.SN_VOID);
      const slab = mix(deep, [235, 226, 210], DKR.SN_SLAB * (1 - dark * 0.7));
      const rail = mix(deep, [90, 110, 96], 0.45);          // the green guardrails
      const litVoid = mix(deep, [255, 196, 122], DKR.SN_NIGHT * night);
      for (let b = 0; b < DKR.SN_BAYS; b++) {
        const x = Math.round(b * bay) + DKR.SN_PIER;
        const ow = Math.round(bay) - DKR.SN_PIER;
        if (ow <= 0) continue;
        const isGlass = ((b + (seed | 0)) % 3) === 1;
        if (isGlass) {
          // A tall grey-mullioned curtain panel, set back behind the piers.
          fill(mix(w, [138, 146, 152], 0.75), x - 1, 0, ow + 2, T);
          fill(glass, x, 0, ow, T);
          if (night > 0.02) fill(mix(glass, [255, 226, 186], night * 0.55), x, 0, ow, T);
          for (let m = 0; m < ow; m += DKR.SN_MULLION) fill(mix(w, [0, 0, 0], 0.34), x + m, 0, 1, T);
        } else {
          fill(night > 0.02 ? litVoid : deep, x, 0, ow, T);
          // The stacked concourse decks seen through the opening. These run the
          // FULL tile height and repeat on the tile's own period — nothing here
          // may key off a top or a bottom edge, because the pattern has neither.
          for (let y = DKR.SN_DECK; y < T; y += DKR.SN_DECK) {
            fill(slab, x, y, ow, 2);
            fill(rail, x, y - 2, ow, 2);
          }
          fill(mix(deep, [0, 0, 0], 0.45), x, 0, 1, T);       // shaded jamb
        }
      }
      // Piers last, so they stand in FRONT of the openings. Each is chamfered:
      // a lit return on one side, a shadowed one on the other, which is what
      // gives the elevation its faceted, sawtooth read from an oblique camera.
      const face = mix(mix(w, [255, 255, 255], DKR.SN_PIER_LIGHT * (1 - dark * 0.8)),
                       [255, 198, 132], 0.20 * golden);
      const cham = mix(w, [0, 0, 0], DKR.SN_PIER_SHADE);
      const stone = mix(w, [232, 224, 205], DKR.SN_STONE);   // buff cast stone
      for (let b = 0; b < DKR.SN_BAYS; b++) {
        const x = Math.round(b * bay);
        fill(face, x, 0, DKR.SN_PIER, T);
        fill(stone, x + 1, 0, 2, T);                          // quoin at the chamfer
        fill(cham, x + DKR.SN_PIER - 2, 0, 2, T);
        fill(mix(w, [0, 0, 0], 0.24), x + DKR.SN_PIER, 0, 1, T);
      }
    },

    /** sf — east grandstand back: board-formed concrete, near solid. */
    sf(ctx, wall, dark, night, golden, glass, seed) {
      const T = TILE, w = dkrWall(wall, 'sf');
      const fill = (c, x, y, ww, hh) => { ctx.fillStyle = css(c); ctx.fillRect(x, y, ww, hh); };
      fill(w, 0, 0, T, T);
      const board = mix(w, [0, 0, 0], DKR.SF_BOARD_DARK);
      const lip = mix(w, [255, 255, 255], 0.05 * (1 - dark * 0.8));
      for (let x = 0; x < T; x += DKR.SF_BOARD) { fill(board, x, 0, 1, T); fill(lip, x + 1, 0, 1, T); }
      const slot = mix(w, [0, 0, 0], DKR.SF_SLOT_DARK);
      const glow = mix(slot, [255, 186, 110], 0.30 * night);
      for (let s = 0; s < DKR.SF_SLOTS; s++) {
        const x = Math.round((s + 0.5) * T / DKR.SF_SLOTS) - 1;
        fill(night > 0.02 ? glow : slot, x, 0, DKR.SF_SLOT_W, T);
      }
    },

    /** sg — 2021 south end zone: club and suite levels, horizontal glazing. */
    sg(ctx, wall, dark, night, golden, glass, seed) {
      const T = TILE, w = dkrWall(wall, 'sg');
      const fill = (c, x, y, ww, hh) => { ctx.fillStyle = css(c); ctx.fillRect(x, y, ww, hh); };
      const metal = mix(w, [206, 212, 219], DKR.SG_METAL);
      fill(metal, 0, 0, T, T);
      const step = T / DKR.SG_TIERS;
      for (let k = 0; k < DKR.SG_TIERS; k++) {
        const y = Math.round(k * step + (step - DKR.SG_GLASS_H) / 2);
        fill(glass, 0, y, T, DKR.SG_GLASS_H);
        fill(mix(metal, [255, 255, 255], 0.16 * (1 - dark * 0.8)), 0, y - 1, T, 1);
        fill(mix(metal, [0, 0, 0], 0.18), 0, y + DKR.SG_GLASS_H, T, 1);
        // Club levels are lit as a continuous room, not as a pane scatter.
        if (night > 0.02) {
          fill(mix(glass, [255, 214, 168], night * 0.62), 0, y, T, DKR.SG_GLASS_H);
          for (let c = 0; c < 8; c++) {
            if (hash01(seed, k, c) > 0.45) continue;
            fill(mix(glass, [255, 232, 200], night * 0.78),
                 Math.round(c * T / 8) + 1, y, Math.round(T / 8) - 2, DKR.SG_GLASS_H);
          }
        }
        for (let x = 0; x < T; x += DKR.SG_MULLION) {
          fill(mix(metal, [0, 0, 0], 0.22), x, y, 1, DKR.SG_GLASS_H);
        }
      }
    },

    /** sd — back of the upper deck: the exposed structural bay rhythm. */
    sd(ctx, wall, dark, night, golden, glass, seed) {
      const T = TILE, w = dkrWall(wall, 'sd');
      const fill = (c, x, y, ww, hh) => { ctx.fillStyle = css(c); ctx.fillRect(x, y, ww, hh); };
      fill(w, 0, 0, T, T);
      const bay = T / DKR.SD_BAYS;
      const recess = mix(w, [0, 0, 0], DKR.SD_RECESS);
      const joint = mix(recess, [0, 0, 0], DKR.SD_JOINT_DARK);
      for (let b = 0; b < DKR.SD_BAYS; b++) {
        const x = Math.round(b * bay) + DKR.SD_PIER;
        const ow = Math.round(bay) - DKR.SD_PIER;
        if (ow <= 0) continue;
        fill(recess, x, 0, ow, T);
        for (let j = x + DKR.SD_PANEL; j < x + ow; j += DKR.SD_PANEL) fill(joint, j, 0, 1, T);
      }
      // Weathering streaks. Deterministic and full height, so they tile.
      for (let s = 0; s < 7; s++) {
        const x = Math.round(hash01(seed + 91, s, 0) * T);
        const wd = 1 + Math.round(hash01(seed + 92, s, 0) * 2);
        ctx.fillStyle = css(mix(w, [0, 0, 0], DKR.SD_STAIN), 0.6);
        ctx.fillRect(x, 0, wd, T);
      }
      // Piers last, standing in front of the recesses.
      const hi = mix(mix(w, [255, 255, 255], DKR.SD_PIER_LIGHT * (1 - dark * 0.8)),
                     [255, 198, 132], 0.20 * golden);
      const sha = mix(w, [0, 0, 0], 0.22);
      for (let b = 0; b < DKR.SD_BAYS; b++) {
        const x = Math.round(b * bay);
        fill(hi, x, 0, DKR.SD_PIER, T);
        fill(sha, x + DKR.SD_PIER, 0, 1, T);
      }
    },
  };

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

    if (fam === 'st') {
      // Stadium/arena masonry: piers and bays, not windows. See drawStadium.
      drawStadium(ctx, wall, dark, night, golden, bucketIdx * 4 + 3);
      return;
    }

    if (fam.length === 2 && fam[0] === 's' && DKR_TILES[fam]) {
      DKR_TILES[fam](ctx, wall, dark, night, golden, glass, bucketIdx * 4 + 5);
      return;
    }

    if (fam === 'dk') {
      // Parking deck: open horizontal slots + a thin bright deck edge.
      // At night the edge goes cool-fluorescent (see DK_EDGE_NIGHT_*).
      const shade = mix(wall, [0, 0, 0], 0.55 + night * 0.2);
      let edge = mix(wall, [255, 255, 255], 0.18 + night * DK_EDGE_NIGHT_BOOST);
      edge = mix(edge, DK_EDGE_NIGHT_TINT, night * DK_EDGE_NIGHT_MIX);
      for (let y = 5; y < TILE; y += 13) {
        ctx.fillStyle = css(shade);
        ctx.fillRect(0, y, TILE, 7);
        ctx.fillStyle = css(edge, 0.85);
        ctx.fillRect(0, y + 7, TILE, 1);
      }
      return;
    }

    // `GRIDS.md` does not exist — the families are lo/mr/mh/tr/tg/dk/st — so
    // this fallback threw on an unregistered family instead of degrading to
    // one. `mh` is the intended default: the punched campus-hall grid, the
    // safest thing to put on a wall we cannot classify.
    const g = GRIDS[fam] || GRIDS.mh;
    const stepX = TILE / g.cols, stepY = TILE / g.rows;
    const offX = (stepX - g.w) / 2, offY = (stepY - g.h) / 2;

    // WHAT USED TO BE HERE, and why it is gone: a full-width dark line across
    // the whole tile at EVERY floor —
    //     for (let r = 0; r < g.rows; r++) ctx.fillRect(0, r * stepY, TILE, 1);
    // — sold as "faint floor lines give the wall texture". Combined with the
    // per-window head shadow and sill landing on those same rows, that is three
    // horizontal darks per storey, one of them spanning the entire facade.
    // Continuous full-width horizontal banding is not texture: it is the exact
    // primitive the `dk` family uses to say PARKING DECK (see the `dk` branch
    // above, which draws bands at a 13 px pitch and nothing else). So every
    // building in the city was wearing the garage texture, reported verbatim as
    // "maybe theyre all garages going all the way up". It stays in `dk`, which
    // is a garage. Wall texture now comes from material, below.
    const famIdx = ['lo','mr','mh','tr','tg','dk','st'].indexOf(fam) + 1;
    const seed = bucketIdx * 4 + famIdx;
    drawWallMaterial(ctx, fam, wall, dark, seed);

    // Pilaster relief, LOCKED to the window column pitch and given no count of
    // its own. A second vertical frequency near but not equal to the window
    // pitch beats against it, and that is the ribbed-metal failure this file has
    // already shipped once.
    if (WALL.PIER[fam]) {
      const lit = css(mix(wall, [255,255,255], WALL.PIER_LIGHT * (1 - dark * 0.8)));
      const sha = css(mix(wall, [0,0,0], WALL.PIER_SHADOW * (1 - dark * 0.5)));
      for (let c = 0; c < g.cols; c++) {
        const xc = Math.round(c * stepX);       // cell boundary = pier centre
        fillWrap(ctx, xc - 1, 2, lit);
        fillWrap(ctx, xc + 1, 1, sha);
      }
    }

    // A bright reveal reads as a recessed opening in daylight, but after dark a
    // pale grid over every wall turns the city into graph paper — so the frame
    // fades toward the wall as night falls, leaving only the lit panes.
    const frame = mix(wall, [255, 255, 255], 0.22 * (1 - dark * 0.85));
    const sill  = mix(wall, [0, 0, 0], 0.3);
    // Continuous occupancy per (family × bucket) hash — see OCCUPANCY above.
    // `seed` decorrelates the per-pane rolls between families sharing a bucket
    // and between the four rolls each pane makes (lit / tone / bright / hot);
    // the salts are primes far larger than any bucket index so the streams
    // can't collide.
    const occRange = OCCUPANCY[fam] || OCCUPANCY.mh;
    const occRoll = hash01(seed + 4001, 0, 0);
    const occupancy = occRange[0] + (occRange[1] - occRange[0]) * occRoll * occRoll;
    const warmBias = TONE_WARM_BIAS[fam] != null ? TONE_WARM_BIAS[fam] : 1;

    for (let r = 0; r < g.rows; r++) {
      for (let c = 0; c < g.cols; c++) {
        const x = Math.round(c * stepX + offX), y = Math.round(r * stepY + offY);
        // NO bright rectangle around the opening. A 1 px light frame on all four
        // sides is the single biggest contributor to the "blocky" read — it
        // outlines every window like a cell in a spreadsheet, and no real
        // building has one. Real depth is directional: the head is in shadow,
        // the sill catches light. Head goes on first so the glass covers its
        // inner edge; the sill is drawn after the pane, below.
        ctx.fillStyle = css(mix(wall, [0, 0, 0], 0.30), 0.7 * (1 - dark * 0.6));
        ctx.fillRect(x, y - 1, g.w, 1);

        const roll = hash01(seed, r, c);
        const isLit = night > 0.05 && roll < occupancy;
        if (isLit) {
          let tone = pickTone(hash01(seed + 1009, r, c) * warmBias);
          const bRoll = hash01(seed + 2003, r, c);
          let bright = PANE_BRIGHT_MIN + (PANE_BRIGHT_MAX - PANE_BRIGHT_MIN) * (1 - bRoll * bRoll);
          if (hash01(seed + 3001, r, c) < HOT_PANE_RATE) {
            tone = mix(tone, [255, 255, 255], HOT_PANE_BOOST);
            bright = PANE_BRIGHT_MAX;
          }
          ctx.fillStyle = css(mix(glass, tone, Math.min(1, night * 1.3) * bright));
        } else {
          ctx.fillStyle = css(glass);
        }
        ctx.fillRect(x, y, g.w, g.h);

        // Reveal: the jamb the opening is recessed behind, on one side only.
        // One-sided because the sun is on one side — a symmetric reveal reads
        // as an outline again, which is what we just removed.
        if (g.w >= 4) {
          ctx.fillStyle = css(mix(glass, [0, 0, 0], 0.35), 0.75);
          ctx.fillRect(x, y, 1, g.h);
        }
        // Sill — a lit lip directly under the opening. Sits tight against the
        // pane (was one pixel clear of it, which read as a detached underline).
        ctx.fillStyle = css(sill, 0.6 * (1 - dark * 0.6));
        ctx.fillRect(x - 1, y + g.h, g.w + 2, 1);
      }
    }
  }

  let _canvas = null, _ctx = null;
  // One draw serves all three tiers — they are the SAME picture at three screen
  // sizes, and only the prefilter differs. Drawing once and blurring three ways
  // is what keeps a three-tier atlas from costing three times the repaint.
  let _rawKey = null, _raw = null;

  /** Draw (fam, bucket, p) once into a RES x RES buffer, mottle applied. */
  function rawTile(fam, bucketIdx, p) {
    const key = fam + '|' + bucketIdx + '|' + p;
    if (_rawKey === key) return _raw;
    if (!_canvas) {
      _canvas = document.createElement('canvas');
      _canvas.width = _canvas.height = RES;
      _ctx = _canvas.getContext('2d', { willReadFrequently: true });
    }
    _mottle = null;
    // Everything below draws in 64-unit space; the transform puts it on RES
    // texels. Every rect in this file is on integer 64-space coordinates, so at
    // an integer SCALE they stay pixel-aligned and nothing gains an AA fringe.
    _ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    drawTile(_ctx, fam, bucketIdx, p);
    _ctx.setTransform(1, 0, 0, 1, 0, 0);
    const d = _ctx.getImageData(0, 0, RES, RES).data;
    if (_mottle) {
      // Block-to-block value scatter, one 4-unit cell = ~2 m of wall. Applied
      // over the finished tile so the openings pick it up too, which is right:
      // the glass in a weathered wall is not uniformly clean either.
      const { cells, amp } = _mottle;
      const N = TILE / WALL.CELL, C = WALL.CELL * SCALE;
      for (let y = 0; y < RES; y++) {
        const row = ((y / C) | 0) * N;
        for (let x = 0; x < RES; x++) {
          const t = cells[row + ((x / C) | 0)];
          if (!t) continue;
          const k = amp * Math.abs(t), tgt = t < 0 ? 0 : 255, i = (y * RES + x) * 4;
          d[i]     += (tgt - d[i])     * k;
          d[i + 1] += (tgt - d[i + 1]) * k;
          d[i + 2] += (tgt - d[i + 2]) * k;
        }
      }
    }
    _rawKey = key; _raw = d;
    return d;
  }

  /** The image for one tier: the shared drawing, prefiltered for its minification. */
  function tileData(fam, bucketIdx, p, tier) {
    const raw = rawTile(fam, bucketIdx, p);
    const d = new Uint8ClampedArray(raw);
    softenTile(d, fam, tier);
    return { width: RES, height: RES, data: new Uint8Array(d.buffer.slice(0)) };
  }

  // ── The windows crawl while the camera moves ──────────────────────
  //
  // Reported: "it's glitchy whenever I move... a ton of diagonal lines that go
  // across the window that are lit and not lit", and — the part that names the
  // cause — on Biological Laboratories' north face, far away almost the whole
  // wall crawls, and as the camera closes the NEARER side settles first while
  // the far tenth holds out longest.
  //
  // That is texture minification, not z-fighting. Measured with
  // scripts/verify/shimmer.mjs, which steps the camera in equal increments and
  // counts sign changes in each pixel's luma: real geometry under a monotonic
  // camera move changes monotonically, aliasing oscillates. Stripping
  // fill-extrusion-pattern and painting flat colour instead cut the crawling
  // share roughly in half at every pose (bme-near 6.96% -> 3.41%, waggener-n
  // 9.78% -> 6.06%, and a 0.10 zoom step 40.23% -> 26.17%). The mask PNGs show
  // the flagged pixels lying in the shape of the window grid itself.
  //
  // Two things make it unavoidable at source. MapLibre samples the pattern atlas
  // LINEAR with no mipmaps — atlases cannot be mipmapped without bleeding
  // between images — so there is no filtering as the texture minifies. And the
  // pattern is TILE-locked, so its metres-per-texel HALVES at every integer
  // zoom (measured: 33.0 m at z16, 16.5 at z17, 8.2 at z18), which drags the
  // window pitch through the one-pixel danger zone on the way in.
  //
  // MSAA does not help: it antialiases geometry EDGES, not texture interiors.
  // Measured at 4 samples, the crawl went UP on every pose, because smoothing
  // edges adds small per-frame variation of its own. Depth is 24-bit here, so
  // the file's older "a phone's 16-bit depth buffer" reasoning does not apply
  // to this defect either.
  //
  // What is left is to stop putting energy into the tile at frequencies that
  // cannot survive. This is a wrap-aware low-pass — the poor man's mipmap, done
  // once at generation instead of per sample. RADIUS is in texels and one texel
  // is 0.43-0.65 m of wall at the zooms this app flies, so a radius of 1 is a
  // ~0.5 m soft edge: invisible from a flying camera, and the difference between
  // a window that reads and a window that strobes.
  //
  // Per family, because the need is not uniform. `tg` is the worst by
  // construction — 1.40 px of spandrel and 3.14 px of pier, the only family
  // exempt from MIN_SPANDREL/MIN_PIER via `curtain: true` — and `lo` has big
  // sparse openings that never approach the pixel floor.
  //
  // TASTE KNOB: set any of these to 0 to get the old razor-sharp, strobing tile
  // back for that family. Nothing else has to change.
  // HOW STRONG, measured rather than guessed. Every number below is a shimmer.mjs
  // run, % of pixels crawling, same poses each time:
  //
  //   pose          pattern on   r1/a0.6   HERE     r6/a1.0   pattern OFF
  //   bme-near          6.96       5.84     5.57      3.50        3.41
  //   waggener-n        9.78       8.67     8.15      6.78        6.06
  //   bme-zoom         40.23      38.76    38.72     26.16       26.17
  //
  // Two things to read off that, and the second one matters more than the fix.
  //
  // First, the crawl has a FLOOR — the pattern-off column — and a big enough
  // low-pass reaches it exactly (26.16 against 26.17). So sharpness is the whole
  // lever, and this is a pure sharpness-versus-crawl trade with a known bottom.
  //
  // Second, and honestly: RADIUS is doing the work, not amount, and the radius
  // that gets most of the win is 6 — a 13-texel box, which at z17 is 3.4 m of
  // wall and visibly mushes the windows. The setting below is the strongest one
  // that still reads as punched windows up close, and it only recovers about a
  // third of the available win at translation and almost none at the zoom step.
  // A single fixed tile cannot be both crisp near and quiet far. The complete
  // fix is two tiers switched by zoom — a soft tile on a far layer, the sharp
  // one on a near layer — which is a bigger change than this and is written up
  // in the PR rather than half-done here.
  //
  // The blur is in TEXEL space, which at least biases it the right way: a texel
  // is 0.26 m of wall at z17 and 0.52 m at z16, so it softens hardest at the
  // distances where the crawl is worst and least where you can read a window.
  //
  // WHAT CHANGED, and it is the whole of "windows are super blurred". The
  // numbers above were one setting for every zoom, because there was one tile
  // for every zoom: radius 2 at amount 0.9 is a 5x5 box over a 5x4 window, run
  // on the tile you are looking at from fifty metres as well as the one two
  // kilometres away. The tier chain above splits that. Each tier now carries
  // only the prefilter its OWN minification needs — a box the width of the
  // minification factor, which is what a mip level is — and the near tier,
  // which is 1:1 with the screen and cannot alias from minification at all,
  // carries none. Sharp near, quiet far, from one drawing.
  const SOFTEN = {
    // Multiplier on the tier's radius, per family. `lo` has big sparse openings
    // that never approach the pixel floor; `tg` is the one curtain-wall family
    // and lands nearest it (1.40 units of spandrel, 3.14 of pier).
    // TASTE KNOB: set a family to 0 for the old razor-sharp, strobing tile.
    FAMILY: { lo: 0.5, mr: 1.0, mh: 1.0, tr: 1.0, tg: 1.2, dk: 1.0, st: 0.8 },
    AMOUNT_BASE: 1.0,
    // Per-family OVERRIDES, null meaning "use the tier's own prefilter". They
    // exist as objects keyed by family because scripts/verify/shimmer.mjs
    // sweeps them by name, and that script is how the low-pass was calibrated
    // in the first place — breaking its sweep would take the instrument away
    // from the next person who has to argue about this trade.
    RADIUS: { lo: null, mr: null, mh: null, tr: null, tg: null, dk: null, st: null },
    AMOUNT: { lo: null, mr: null, mh: null, tr: null, tg: null, dk: null, st: null },
  };
  // Exposed so scripts/verify/shimmer.mjs can sweep it, and so an aesthetic call
  // here can be overruled from the console without an edit.
  window.FACADE_SOFTEN = SOFTEN;

  /**
   * Separable box blur, WRAPPING on both axes, blended back over the original.
   *
   * The wrap is not a detail: the tile repeats, so a clamped blur would darken
   * the four edges and put a visible grid seam every ~40 m up and across every
   * wall in the city — which is the same class of bug as the fascia band that
   * appeared three times up DKR's elevation.
   */
  function softenTile(d, fam, tier) {
    const mult = SOFTEN.FAMILY[fam] != null ? SOFTEN.FAMILY[fam] : 1;
    const rOv = SOFTEN.RADIUS[fam], aOv = SOFTEN.AMOUNT[fam];
    const r = Math.round((rOv != null ? rOv : (tier ? tier.soften : 0) * mult) * SCALE);
    const a = aOv != null ? aOv : SOFTEN.AMOUNT_BASE;
    if (!r || a <= 0) return;
    const N = RES * RES, win = r * 2 + 1;
    const tmp = new Float32Array(N * 3);
    // horizontal
    for (let y = 0; y < RES; y++) {
      for (let x = 0; x < RES; x++) {
        let s0 = 0, s1 = 0, s2 = 0;
        for (let k = -r; k <= r; k++) {
          const i = (y * RES + ((x + k + RES) % RES)) * 4;
          s0 += d[i]; s1 += d[i + 1]; s2 += d[i + 2];
        }
        const o = (y * RES + x) * 3;
        tmp[o] = s0 / win; tmp[o + 1] = s1 / win; tmp[o + 2] = s2 / win;
      }
    }
    // vertical, and blend straight back into the pixel buffer
    for (let x = 0; x < RES; x++) {
      for (let y = 0; y < RES; y++) {
        let s0 = 0, s1 = 0, s2 = 0;
        for (let k = -r; k <= r; k++) {
          const o = (((y + k + RES) % RES) * RES + x) * 3;
          s0 += tmp[o]; s1 += tmp[o + 1]; s2 += tmp[o + 2];
        }
        const i = (y * RES + x) * 4;
        d[i]     += (s0 / win - d[i])     * a;
        d[i + 1] += (s1 / win - d[i + 1]) * a;
        d[i + 2] += (s2 / win - d[i + 2]) * a;
      }
    }
  }

  function parseId(id) { return { fam: id.slice(0, 2), idx: parseInt(id.slice(2), 10) }; }

  // ── the tier chain: selection, registration, repaint ────────────────

  /** The tier a given camera zoom reads from. */
  function tierForZoom(z) {
    let t = TIERS[0];
    for (const c of TIERS) if (z >= c.minZoom) t = c;
    return t;
  }

  /**
   * The tiers a camera at this zoom can actually SAMPLE — which is two of them
   * whenever floor(zoom) and floor(zoom)+1 fall in different tiers, because
   * MapLibre evaluates a *-pattern property at both and cross-fades. Getting
   * this wrong shows up as a tower going flat for the width of one zoom level,
   * which is exactly the class of defect this whole change is about.
   */
  function activeTiers(map) {
    const z = (map && map.getZoom) ? map.getZoom() : 17;
    const a = tierForZoom(Math.floor(z)), b = tierForZoom(Math.floor(z) + 1);
    return a === b ? [a] : [a, b];
  }

  const suffixed = (base, id) => (id ? ['concat', base, id] : base);

  /**
   * Wrap a base pattern-id expression in the zoom `step` that picks a tier.
   *
   * Exposed rather than inlined because more than one layer names its bucket its
   * own way — the outer ring reads an `fb` ordinal off a vector tile it cannot
   * mutate — and every one of them needs the same stops. Restating the stops per
   * layer is how a tier boundary drifts between two layers and nobody notices.
   */
  window.facadeTierExpr = function facadeTierExpr(baseId) {
    const expr = ['step', ['zoom'], suffixed(baseId, TIERS[0].id)];
    for (let i = 1; i < TIERS.length; i++) {
      expr.push(TIERS[i].minZoom, suffixed(baseId, TIERS[i].id));
    }
    return expr;
  };

  /** Every tier's image for one combo, registered if missing. */
  function ensureImages(map, id, p) {
    const { fam, idx } = parseId(id);
    let added = false;
    for (const t of TIERS) {
      const key = id + t.id;
      try {
        if (map.hasImage && map.hasImage(key)) continue;
        map.addImage(key, tileData(fam, idx, p, t), { pixelRatio: tierPixelRatio(t) });
        added = true;
      } catch (e) { /* already added */ }
    }
    return added ? 1 : 0;
  }

  // The time of day the atlas currently holds, and the tiers that are older
  // than it. A tier is only repainted when the camera can see it: repainting all
  // three on every time-of-day step would triple a measured 55 ms, and the
  // slider quantises to 1/128. In practice the hour does not change mid-flight,
  // so the lazy repaint is free; when it does, the first zoom that crosses into
  // a stale tier pays one repaint.
  let _atlasP = 0.5;
  const _stale = new Set();

  // Combos OUTSIDE, tiers INSIDE, so rawTile's one-deep cache actually hits:
  // repainting two tiers costs one draw plus two blurs, not two draws.
  function paintTiers(map, tiers, p) {
    for (const id of combos) {
      const { fam, idx } = parseId(id);
      for (const tier of tiers) {
        const key = id + tier.id;
        try {
          if (map.hasImage && map.hasImage(key)) map.updateImage(key, tileData(fam, idx, p, tier));
          else map.addImage(key, tileData(fam, idx, p, tier), { pixelRatio: tierPixelRatio(tier) });
        } catch (e) { /* image not registered yet */ }
      }
    }
  }

  function watchTierZoom(map) {
    if (map.__facadeTierWatch) return;
    map.__facadeTierWatch = true;
    map.on('zoom', () => {
      if (!_stale.size) return;
      const want = activeTiers(map).filter(t => _stale.has(t.id));
      if (!want.length) return;
      for (const t of want) _stale.delete(t.id);
      paintTiers(map, want, _atlasP);
    });
  }

  window.initFacades = function initFacades(map, p) {
    if (!palette.length) return 0;
    // facadeGridAudit had ZERO call sites — the guard written to catch a grid
    // whose arithmetic disagrees with its own `want`, in a file whose comments
    // record shipping exactly that (17.1% written beside a grid computing
    // 34.2%), had never once run. It is pure arithmetic over five constants, so
    // running it at init costs nothing and warns in the console if a future edit
    // pushes a family out of spec.
    try { window.facadeGridAudit(); } catch (e) { /* audit must never break init */ }
    _atlasP = p;
    _stale.clear();
    // ALL tiers at boot, not just the visible one: the `step` can select a tier
    // the moment the camera moves, and MapLibre paints an unregistered pattern
    // id transparent — a building-shaped hole, which is the failure mode
    // HANDOFF §30 already paid for once.
    for (const id of combos) ensureImages(map, id, p);
    watchTierZoom(map);
    return combos.length;
  };

  window.updateFacades = function updateFacades(map, p) {
    if (!palette.length) return;
    _atlasP = p;
    const active = activeTiers(map);
    for (const t of TIERS) if (active.indexOf(t) === -1) _stale.add(t.id);
    for (const t of active) _stale.delete(t.id);
    paintTiers(map, active, p);
    watchTierZoom(map);
  };

  /**
   * Snap the OUTER RING's towers onto patterns that already exist — and only
   * onto those.
   *
   * The outer ring (js/outer.js) is deliberately cheaper than the core: 6,800
   * simplified footprints wearing a flat colour, no atlas, no cap, no shadow.
   * Downtown towers are the one exception, because the skyline silhouette is
   * the whole reason the box reaches south, and a 267 m flat slab reads as a
   * monolith rather than a building.
   *
   * The rule that makes that exception free is here: this NEVER calls addImage.
   * quantiseStadiumFacades may, because twelve stadium walls carrying materials
   * the city palette does not have is worth twelve textures. A hundred downtown
   * towers are not worth a hundred more, and the atlas is a texture upload plus
   * a repaint on every time-of-day tick — the cost is per IMAGE, not per
   * building. So each tower takes the nearest EXISTING (family, bucket) combo,
   * and if the family it wants has no combo at all it borrows another family's
   * at the same bucket. Zero new images, zero new cost per frame.
   *
   * Call after quantiseFacades and after initFacades.
   */
  /**
   * The 114 downtown TOWERS get their own colours; the 7,511 low-rise buildings
   * behind them keep snapping to the campus palette.
   *
   * "downtown - more accurate and more vibrant." The accuracy was already there:
   * every named landmark is present at a curated height. The flatness was this
   * function. It snapped every outer feature to the nearest of the fourteen
   * CAMPUS buckets, which are the means of Austin's campus building colours and
   * are almost all tan brick and limestone — so the Austonian, Frost Bank Tower,
   * the Independent and 111 more arrived downtown wearing the same four or five
   * browns, and the skyline read as one grey-brown mass.
   *
   * It is the same mistake quantiseStadiumFacades already records and refuses to
   * make: "Its OWN palette entries, not the nearest of the city's fourteen...
   * snapping to them turned the 2008 north end zone's brick veneer back into tan
   * and erased the one elevation with a different material."
   *
   * So the towers are clustered on their own baked `wd` instead. Clustered, not
   * one-per-hex: the atlas is repainted per image on every time-of-day step, so
   * 114 new images would be a real cost for no visible gain at skyline distance.
   * TOWER_BUCKETS is the knob — raise it for more variety, lower it for a
   * cheaper atlas.
   *
   * The low-rise ring is deliberately left on the campus palette. It IS mostly
   * the same brick and stucco as campus, it is 66x the feature count, and it is
   * the backdrop rather than the subject.
   */
  const TOWER_BUCKETS = 10;

  /** k-means on RGB, seeded evenly through the sorted-by-luma list. */
  function clusterColours(hexes, k) {
    const pts = hexes.map(hexToRgb);
    if (pts.length <= k) return pts;
    const lum = c => c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114;
    const sorted = [...pts].sort((a, b) => lum(a) - lum(b));
    let cent = Array.from({ length: k }, (_, i) =>
      sorted[Math.floor((i + 0.5) * sorted.length / k)].slice());
    for (let iter = 0; iter < 12; iter++) {
      const sum = cent.map(() => [0, 0, 0, 0]);
      for (const p of pts) {
        let bi = 0, bd = Infinity;
        for (let i = 0; i < cent.length; i++) {
          const d = dist2(p, cent[i]);
          if (d < bd) { bd = d; bi = i; }
        }
        sum[bi][0] += p[0]; sum[bi][1] += p[1]; sum[bi][2] += p[2]; sum[bi][3]++;
      }
      cent = cent.map((c, i) => sum[i][3]
        ? [sum[i][0] / sum[i][3], sum[i][1] / sum[i][3], sum[i][2] / sum[i][3]]
        : c);
    }
    return cent;
  }

  const toHex = c => '#' + c.map(v =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

  window.quantiseOuterFacades = function quantiseOuterFacades(features, map) {
    if (!palette.length || !combos.length) return 0;
    // Snapshot the campus bucket count BEFORE any tower entries are appended.
    // The low-rise pass below must not snap a warehouse onto a glass tower's new
    // colour, and must not overwrite the towers it is about to skip.
    const campusBuckets = palette.length;

    // ── towers first, on their own colours ──────────────────────────
    const towers = features.filter(f => f.properties && f.properties.t === 1 && f.properties.wd);
    let towersDone = 0;
    if (towers.length && map) {
      const cent = clusterColours(towers.map(f => f.properties.wd), TOWER_BUCKETS);
      const idxOf = cent.map(c => {
        const i = palette.length;
        const wd = toHex(c);
        // Golden and night are derived the way the bake derives them, so a tower
        // follows the same day->golden->night ramp as everything else rather
        // than sitting at one colour all day.
        palette.push({
          wd,
          wg: toHex(c.map((v, j) => v * (j === 2 ? 0.92 : 1.06))),
          wn: toHex(c.map((v, j) => v * 0.34 + [17, 22, 42][j] * 0.30)),
        });
        return i;
      });
      const p = window.__todCurrentP != null ? window.__todCurrentP : 0.5;
      for (const f of towers) {
        const rgb = hexToRgb(f.properties.wd);
        let best = 0, bd = Infinity;
        for (let i = 0; i < cent.length; i++) {
          const d = dist2(rgb, cent[i]);
          if (d < bd) { bd = d; best = i; }
        }
        const idx = idxOf[best];
        const id = 'tg' + String(idx).padStart(2, '0');
        f.properties.wp = id;
        f.properties.wf = 'tg';
        if (combos.indexOf(id) === -1) combos.push(id);
        // initFacades has already run, so a new combo has no image yet and
        // MapLibre would paint the wall transparent.
        ensureImages(map, id, p);
        towersDone++;
      }
    }

    // bucket index -> the combos that exist for it, keyed by family
    const have = new Map();
    for (const id of combos) {
      const { fam, idx } = parseId(id);
      if (!have.has(idx)) have.set(idx, new Map());
      have.get(idx).set(fam, id);
    }
    const buckets = palette.slice(0, campusBuckets).map(k => hexToRgb(k.wd));
    let n = 0;
    for (const f of features) {
      const p = f.properties;
      if (!p || !p.wd) continue;
      if (p.t === 1 && p.wp) continue;   // a tower already has its own colour
      const rgb = hexToRgb(p.wd);
      let best = 0, bestD = Infinity;
      for (let i = 0; i < buckets.length; i++) {
        const d = dist2(rgb, buckets[i]);
        if (d < bestD) { bestD = d; best = i; }
      }
      // Walk outward from the nearest bucket until one has ANY pattern.
      let pick = null;
      for (let step = 0; step < palette.length && !pick; step++) {
        for (const idx of [best - step, best + step]) {
          const fams = have.get(idx);
          if (!fams) continue;
          pick = fams.get('tg') || fams.get('mh') || fams.get('mr') || fams.values().next().value;
          if (pick) break;
        }
      }
      if (!pick) continue;
      p.wp = pick;
      p.wf = pick.slice(0, 2);
      n++;
    }
    return n + towersDone;
  };

  // Fall back to a plain fill where a feature somehow has no pattern, then wrap
  // the whole thing in the zoom step that picks a mip tier.
  window.FACADE_PATTERN_EXPR = window.facadeTierExpr(['coalesce', ['get', 'wp'], 'mh00']);
  window.facadePalette = () => palette;
})();
