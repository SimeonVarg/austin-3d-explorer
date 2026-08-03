/**
 * tower.js — the UT Tower and the Main Building it rises from.
 *
 * WHAT WAS THERE. The Overture feature named "UT Tower" is the whole Main
 * Building complex — a 25-vertex footprint 79.5 x 87.2 m — and it carries
 * `has_parts: 1`, so js/app.js filters it out of `buildings-3d` entirely. What
 * actually rendered was two OSM building:parts: the 94 m shaft as a single
 * prism wearing the generic office-tower window grid, and one 12.8 m block.
 * The Main Building had no wings, no arcade and no red tile roof, and nothing
 * in roofscape.geojson or roofs.geojson falls inside the footprint either. The
 * icon of the campus was a grey box.
 *
 * WHY IT IS GEOMETRY AND NOT A TEXTURE. Two measured properties of
 * fill-extrusion-pattern decide almost every choice in this file and in
 * scripts/bake_tower.py:
 *
 *   1. A pattern has NO VERTICAL ANCHOR. It repeats from the extrusion base
 *      with no idea where the top is, so a cornice drawn "at the top" appears
 *      every ~40 m up the shaft. The Tower is nothing BUT vertical events, so
 *      it is emitted as stacked bands, each its own feature — the same shape as
 *      the BANDS list in scripts/bake_stadium.py.
 *   2. A pattern is TILE-locked. A 64 px repeat covers ~30 m of wall at tile
 *      zoom 17 and ~59 m at 16, and it never aligns to a building corner. The
 *      Tower's shaft has exactly THREE window slots on a 22.56 m face; no tile
 *      can say "three". So the slots are prisms standing 0.30 m proud of each
 *      face, and so are the belfry colonnade, the four clock faces, and the
 *      windows that light the numeral at night.
 *
 * That leaves the tiles doing the one job a tile is good at: material. Every
 * pattern here varies only in x — vertical strips and per-block value scatter,
 * constant down the tile — which is the trick that makes an unanchored,
 * unaligned repeat harmless. It is the same reason js/facades.js draws its
 * weathering as full-height columns.
 *
 * NIGHT. The convention is sourced (tower.utexas.edu/lighting): seven
 * configurations, of which this builds "Orange Tower with No. 1", the
 * national-championship state. The tower floods orange, the Main Building stays
 * dark, the clock dials stay cream, and the shaft's three window columns light
 * a numeral 1 — centre column full height, all three across the bottom, two
 * cells in the left column near the top. That is what a photograph of the real
 * thing shows, and three window columns is exactly enough to write a 1.
 *
 * The STRUCTURE of that light — which parts glow, how much, and why it is not
 * one orange repaint — is the NIGHT block below. Read it before touching any
 * night hex here or in scripts/bake_tower.py.
 *
 * Reference table, sources and the honest sourced/generative split:
 * docs/PASS_TOWER.md.
 *
 * Public (window) API:
 *   initTower(map)            — add source + layers (called automatically)
 *   applyTowerColors(map, p)  — retint for time-of-day p (hooked automatically)
 *   TOWER                     — the taste block
 */
(function () {
  'use strict';

  const q = new URLSearchParams(window.location.search);

  const TOWER = {
    // ?tower=0 removes the whole pass at load, so scripts/verify/tower-perf.mjs
    // can A/B on one build instead of on two checkouts.
    on: q.get('tower') !== '0',
    minZoom: 14,
    // The window slots, the belfry columns and the clock slabs are 1-1.5 m
    // features. At the altitude this app flies one pixel is roughly half a
    // metre, so they are 2-3 px and worth drawing; below this zoom they are
    // sub-pixel and are pure overdraw.
    detailMinZoom: 14.6,
    opacity: 1.0,
  };
  window.TOWER = TOWER;

  /**
   * ══ THE CROWN AND THE SHAFT BAYS ═══════════════════════════════════
   *
   * WHY THIS IS HERE AND NOT IN scripts/bake_tower.py. It should be in the
   * bake — the bake and data/tower.geojson have moved together in all five
   * commits either has ever had, and that invariant is worth keeping. This
   * pass was scoped to js/tower.js and data/tower.geojson only, with seven
   * other sessions live in the tree. Hand-editing the data file would have put
   * the fix one `python scripts/bake_tower.py` away from being silently
   * deleted, which is the single most expensive failure mode in this repo's
   * history. So the detail is DERIVED AT LOAD from the bands the bake already
   * emits — the shaft's own ring gives the plan and the frame, each band's own
   * feature gives its height and its colour trio — and the bake stays the only
   * thing that decides where the Tower is and how tall each band is. Nothing
   * here can drift from it, because nothing here restates it.
   *
   * `REPLACED` is the list of bake parts this supersedes; they are dropped
   * from the feature list before the new ones are built. They are still in the
   * downloaded file (~24 KB of the 71 KB) until the bake is updated, which is
   * the one real cost of doing it this way and is written down so it is not
   * discovered later as a mystery.
   *
   * WHAT WAS WRONG, measured on shots/tw-before-day/:
   *
   *   1. THE CLOCK DID NOT READ, and it is not a size problem. The bezel was
   *      five SOLID chord slabs, so it was a filled gold rectangle with a
   *      3.05 m dark square laid on the middle of it — a picture frame with a
   *      hole, and the dial had been shrunk from its sourced 12 ft precisely
   *      because a solid bezel left no ring to see. It is an ANNULUS now (two
   *      slabs per band, outer chord minus inner chord), which puts the whole
   *      sourced geometry back: 5.60 m rim, 0.97 m of gilt, 3.66 m dial. And
   *      it has HANDS, which is the actual reason a clock reads as a clock at
   *      100 m — sourced: "The rim and hands of the Tower clock are gilded
   *      with gold leaf" (tower.utexas.edu/history).
   *
   *   2. THE BELFRY WAS A WALL WITH HAIRLINE CRACKS. 1.70 m corner piers and
   *      1.10 m columns on an 11.08 m face leave gaps of 0.30 m — a fifth of a
   *      pixel from any altitude this app flies — with all the openness in one
   *      2.12 m hole in the middle. A colonnade reads as RHYTHM, so the
   *      members are slimmer and the four openings per face are real.
   *
   *   3. THE OBSERVATION DECK WAS A BARE STEP. The Tower is "crowned by an
   *      observation deck and a carillon" (guidetoaustinarchitecture.com) and
   *      the deck is the 2.0 m ledge at the top of the bracketed cornice —
   *      70.1 m, which is the sourced 231 ft. Nothing stood on it, or on the
   *      4.0 m belfry terrace above it. Both are balustraded now.
   *
   *   4. THE CAP WAS A FLAT GREEN PLATE. One 1.6 m verdigris box. It is a
   *      stepped copper pyramid behind its own parapet with a finial on top,
   *      and the summit is still exactly 94.0 m — 307 ft to the top of the
   *      finial is the number every source repeats.
   *
   *   5. THE SHAFT WAS A BARBER POLE. Three bays of alternating charcoal glass
   *      and #8a7448 bronze, the bronze rendering as saturated orange under
   *      this scene's warm grade, each bay 1.42 m of glass in a 1.42 m channel
   *      so there was no stone reveal anywhere. Same channel width and same
   *      measured 4.05 m pitch — those are sourced and they stay — but the
   *      glass is narrower than the channel it sits in and the spandrel is a
   *      muted bronze instead of a gold one.
   *
   * Every number below is a one-line override (CLAUDE.md rule 11), and
   * ?towerdetail=0 takes the whole thing off for an A/B in one build.
   */
  const CROWN = {
    on: q.get('towerdetail') !== '0',

    // ── the shaft's window bays ──────────────────────────────────────
    slot: {
      w: 1.42,            // the channel. MEASURED, docs/PASS_TOWER.md §1.
      pitch: 4.05,        // MEASURED. Three bays per face, blank stone either side.
      depth: 0.30,
      glassW: 0.98,       // NEW. The glass is narrower than its channel, so the
                          // bay has a stone-lined reveal instead of reading as
                          // one unbroken ribbon of glass.
      glassDepth: 0.36,
      floor: 3.46,        // MEASURED (gold spandrel pitch). Unchanged.
      winH: 1.90,         // was 2.20 — 64% of every floor was glass.
      from: 24.5,
      rows: 12,
      // was '#8a7448'. Authored hex is not what lands (HANDOFF §36): this scene
      // grades warm, so a gilt bronze arrives as saturated orange and becomes
      // the loudest thing on a limestone tower. Same warmth, far less chroma.
      spandrel: '#6b5d47',
      spandrelNight: '#3a2410',
    },

    // ── the belfry colonnade ─────────────────────────────────────────
    // The COUNT and the 2+2 grouping were counted off a 5x enlargement and are
    // kept; only the members' widths and their spacing move, which is what
    // decides whether the openings survive to the screen.
    belfry: { pierW: 1.40, colW: 0.78, colT: [0.13, 0.37, 0.63, 0.87] },

    // ── the clock ────────────────────────────────────────────────────
    clock: {
      rimD: 5.60,         // SOURCED (gilt bezel).
      dialD: 3.66,        // SOURCED, 12 ft. Restored — see the note above.
      mid: 74.60,
      bands: 7,           // horizontal slabs the ring is cut into
      dialBands: 7,       // 5 left the dial visibly stepped at a close crop
      rimDepth: 0.34,     // the rim stands proud of the dial, so the ring casts
      dialDepth: 0.20,    // an edge instead of being coplanar with it
      handDepth: 0.30,
      time: [10, 10],     // taste: the pose that reads as "clock" at a glance
      handLen: [1.15, 1.70],   // hour, minute
      handW: [0.32, 0.24],
      handSteps: 5,       // a diagonal is a staircase in a fill-extrusion
      tickR: 1.58, tickLen: 0.42, tickW: 0.24,
      gold: '#d8b247', goldNight: '#3a2f14',
      dial: '#3d4b56', dialNight: '#f2ecc8',
      handNight: '#241c10',   // dark, so the hands silhouette on a LIT dial
    },

    // ── the observation deck and the belfry terrace ──────────────────
    // A balustrade, not a parapet: the gaps are what stop a crown reading as a
    // stack of boxes. At 1.55 m they blur into a light band at flying altitude,
    // which is exactly what a real balustrade does at that distance.
    deck: {
      on: true,
      inset: 0.20,        // back from the outer face of the band below
      plinthH: 0.22, balH: 0.66, railH: 0.20,
      balW: 0.30, balPitch: 1.55,
      postW: 0.58, plinthD: 0.36, railD: 0.46,
    },

    // ── the cap ──────────────────────────────────────────────────────
    // The measured silhouette (docs/PASS_TOWER.md) is a flat-topped block at
    // plan x0.362, and that is kept as a PARAPET; the pyramid sits inside it,
    // which is why the photograph's silhouette and a pyramidal roof are not in
    // conflict. Nothing rises above 94.0.
    cap: {
      // First cut had the cap block ending at its baked 92.40 and a 0.60 m
      // parapet on top of it, which left 1.2 m for the roof — an 18 degree
      // pyramid, entirely hidden behind its own parapet from a camera BELOW the
      // summit, which is every camera this app has. Photographed, the top read
      // FLATTER than the flat green plate it replaced. The block gives 0.60 m
      // back to the roof and the parapet is a cornice, not a wall.
      blockTop: 91.80,
      parapetTop: 92.25, parapetS: 0.362, parapetT: 0.55,
      roofTop: 93.45, roofSteps: 5, roofS0: 0.315, roofS1: 0.075,
      finialTop: 94.00, finialS: 0.055, finialNeck: 0.030,
      acroteria: 0.66,    // corner blocks on the parapet
    },
  };
  window.TOWER_CROWN = CROWN;

  /**
   * ══ THE FLOODLIGHTING ══════════════════════════════════════════════
   *
   * WHAT WAS WRONG. The Tower's night state was three flat hexes — shaft
   * `#b03a15`, cornice `#c9501c`, crown `#dd6420` — one per band, with the
   * CROWN brightest. Measured on screen at tod 0.95 (a vertical scan of the
   * blank stone either side of the window slots, `00-plain.png`):
   *
   *     top of shaft  R 72.2   middle R 74.8   bottom of shaft R 67.1
   *
   * — 51 m of tower varying by 1.12x, and very slightly brighter at the TOP.
   * That is the "flat orange slab" in the sweep. Every photograph says the
   * opposite, and says it by a factor of five.
   *
   * WHERE THE LAMPS ACTUALLY ARE. Sourced (jimnicar.com, "Tower Light, Tower
   * Bright"), and it is the whole answer: **292 floodlights, half orange and
   * half white, on the four recesses or "setbacks" of the Tower** —
   *
   *     96 x 1000 W  at the Tower BASE            -> washes the shaft, upward
   *     64 x  250 W  on the OBSERVATION DECK      -> washes the clock stage
   *     48 x  500 W  projectors at the BELFRY     -> the colonnade
   *     84 x  100 W  around the PARAPET at the top-> the cap
   *
   * with "two circuits at each setback: one for all-orange lights, the other
   * for all-white", switchable per level. The modern rig is 244 lamps on a
   * control box in the clock room for "the lights on the Tower's crown, the
   * lights above the Tower's clock and the lights on the Tower's observation
   * deck" (tower.utexas.edu).
   *
   * So the Tower is not one lit object. It is FOUR lit objects stacked, each
   * washed from its own floor, each independently orange or white — which is
   * exactly why "White Tower with Orange Top" is one of the seven named
   * configurations and not a special effect. CONFIGS below is that switchboard.
   *
   * WHAT THE PHOTOGRAPHS MEASURE. Three, sampled pixel by pixel rather than
   * remembered (Wikimedia Commons: `UT-Tower-BurntOrange.jpg` 1126x1710 close
   * on the crown, `UT_tower_lit_entirely_in_orange.jpg` a wider worm's-eye, and
   * `UT_Tower_lit_white_with_orange_top.jpg` for the unclipped white shaft):
   *
   *   1. THE SHAFT FALLS OFF UPWARD, HARD. Red channel bottom -> top of the
   *      visible shaft: 254 -> 47 (5.4x, and the bottom is clipped so the true
   *      ratio is larger); the second photograph reads 243 -> 30 on its south
   *      face (8x); the white-lit one reads 122 -> 15 in luma (8x) and is not
   *      clipped anywhere, so this is not a clipping artefact.
   *      Fitted over the unclipped part of the first: R(z) = 1109*exp(-z/20.3),
   *      which reproduces every sample within 4% (117 measured / 118 fitted at
   *      z 45.4, 68 / 71 at 55.7, 47 / 47 at 64.2). Hence L below.
   *   2. THE CORNICE IS THE DARKEST BAND, not the second brightest. It reads
   *      (16,5,3) in the close photograph: it overhangs, so it is above the
   *      base floods' throw and below the deck's, and the deck fixtures stand
   *      ON it pointing up and away. It is the single strongest cue that the
   *      shaft and the crown are different light sources.
   *   3. THE CLOCK STAGE IS THE BRIGHTEST AND THE YELLOWEST BAND — (242,118,4)
   *      at its foot against (97,27,4) near its top, a 2.5x falloff over 4.7 m,
   *      because 64 lamps sit on the deck immediately below it.
   *   4. THE BELFRY IS DEEP RED WITH BLACK OPENINGS. The projectors light the
   *      columns; the bell chamber behind them is unlit and reads black.
   *   5. THE CLOCK DIALS ARE LIT FROM WITHIN and are the brightest thing in
   *      every frame — (231,229,199), (224,217,192), and clipped white in the
   *      third. Near-neutral cream, not gold: the gilt RIM and the hands read
   *      DARK against them.
   *   6. THE MAIN BUILDING IS NOT LIT. Measured (7,19,7) — black. Unchanged.
   *
   * WHAT THE RENDERER CAN ACTUALLY DO, measured rather than assumed, because
   * PR #56 concluded from the last attempt that it can do nothing. Pushing a
   * ladder of known texel values through `map.updateImage` and reading the
   * screenshot back (the tone curve is a CSS filter and the bloom a second
   * canvas, so only a screenshot sees what Simeon sees) at tod 0.95:
   *
   *     texel  64 -> screen  21.4      texel 192 -> screen  74.8
   *     texel 128 -> screen  49.4      texel 255 -> screen 102.7
   *
   * — linear, gain 0.40, monotonic over the whole range. There is ample room
   * for a 5x gradient. TWO REAL CEILINGS, though:
   *   - A lit face cannot exceed ~103/255. `setLight` at night is
   *     `{color:'#9aa6da', intensity:0.066}` and that is the cap.
   *   - THERE IS NO BLOOM TO HELP. graphics.js thresholds with `contrast(4)`,
   *     which passes only inputs above 0.375, and 103/255 = 0.40 sits on the
   *     line. Measured: the halo ring around the detail layer moves by 0.2 of
   *     one level across the entire ladder from `#040404` to `#ffffff`. PR #56
   *     was RIGHT that a fill-extrusion cannot be made to glow here and WRONG
   *     that the colours are indistinguishable — `#ffffff` lands (94,82,101),
   *     `#f2ecc8` lands (91,76,80) and `#ffd27a` lands (93,68,51), which are
   *     three different colours, not one. Structure is available; glow is not.
   *     So this pass buys the read with CONTRAST, never with brightness.
   *
   * Everything below is a one-line override (CLAUDE.md rule 11).
   * `?towerlight=white-orange-top` switches configuration without an edit, and
   * `?towernight=0` takes the whole relight off for an A/B in one build.
   */
  const NIGHT = {
    on: q.get('towernight') !== '0',

    // Which of the seven sourced configurations to fly. 'orange-no1' is the
    // national-championship state and the only one that writes the numeral;
    // it is the default because it is the one the bake's window data builds.
    config: q.get('towerlight') || 'orange-no1',

    // The switchboard, one row per named configuration, one column per
    // setback. 'o' = the orange circuit, 'w' = the white circuit, '-' = off.
    // This IS the 1937 wiring: two circuits per setback, chosen per level.
    CONFIGS: {
      'white':            { shaft: 'w', deck: 'w', belfry: 'w', cap: 'w', numeral: 0 },
      'white-orange-top': { shaft: 'w', deck: 'o', belfry: 'o', cap: 'o', numeral: 0 },
      'orange':           { shaft: 'o', deck: 'o', belfry: 'o', cap: 'o', numeral: 0 },
      'orange-no1':       { shaft: 'o', deck: 'o', belfry: 'o', cap: 'o', numeral: 1 },
      'dark-white-cap':   { shaft: '-', deck: 'w', belfry: '-', cap: 'w', numeral: 0 },
      'dark':             { shaft: '-', deck: '-', belfry: '-', cap: '-', numeral: 0 },
    },

    /**
     * One entry per setback.
     *   z0     the floor the fixtures stand on, metres (the setback itself)
     *   L      e-folding length of the wash in metres. 20.3 on the shaft is
     *          FITTED to the close photograph; the upper levels are shorter
     *          because a 250 W lamp at 2 m does not throw like a 1 kW at 40.
     *   gain   how far OVER the circuit colour the lamp datum sits. The fit
     *          puts the shaft at R 410 where it emerges from the Main Building
     *          roof — 1.6x the top of the texel range — and that is not a
     *          mistake to correct, it is the reason every photograph of an
     *          orange Tower is blown out for the first 15 m of shaft. The
     *          first cut of this pass set the datum to a legal 252 and the
     *          whole shaft came out a third too dark, because the part of it
     *          you can actually SEE starts at z 29 (the Main Building hides
     *          the rest) by which point the wash has already dropped to 0.65.
     *   floor  the wash never goes below this. Ambient, spill off the stone
     *          and the city's own skyglow are all real — the west face of the
     *          second photograph only falls 3.5x, against 8x on the south —
     *          and it is also what stops the top of the shaft dropping out of
     *          the frame entirely against a black sky, which would read as a
     *          missing chunk of building rather than as distance.
     *   bands  how many sub-bands the wash is quantised into. The edges are
     *          spaced by equal WASH RATIO rather than equal height, so the
     *          visible step is the same all the way up instead of being
     *          coarsest at the bottom where the gradient is steepest. (For the
     *          exponential part that works out to equal heights anyway — the
     *          two only differ where the floor binds — but the construction is
     *          what guarantees it, not the arithmetic coincidence.)
     *
     *          COUNT IS A MEASURED NUMBER, not a guess. 20 bands over a 5x
     *          range is an 8% step, and on the WHITE configuration — the worst
     *          case, because the same relative step lands at three times the
     *          luma — that measured as visible Mach banding: 4-row plateaus
     *          with 10-luma jumps between them (50 51 51 54 | 57 57 58 58 |
     *          63 64 64 64 | ... | 107 108 108 109). The night atlas cannot
     *          dither it away either: the ashlar mottle is scaled by
     *          (1 - dark*0.6), so after sunset its amplitude is 2% and it is at
     *          its weakest exactly where it is needed. 40 halves the step.
     *   o / w  the circuit colour at the lamp datum, in TEXEL space (this is
     *          multiplied by the wash and then by the 0.40 render gain). The
     *          orange ratio 1 : 0.20 : 0.11 is the mean of the unclipped
     *          samples across all three photographs (south face 1:0.11:0.06,
     *          west face 1:0.19:0.09, belfry 1:0.23:0.13, cap 1:0.19:0.13).
     *          The deck runs yellower because the photograph says it does.
     */
    // Predicted screen R for the shaft from these numbers, against the close
    // photograph's own (measured through the 0.40 render gain):
    //     z 29  102 / 102clip    z 35  79 / 79     z 45  47 / 47
    //     z 55   29 / 27         z 66  19 / 19
    LEVELS: {
      shaft:  { z0: 20.2, L: 20.3, gain: 1.63, floor: 0.115, bands: 40, o: [252, 62, 32],  w: [216, 210, 198] },
      deck:   { z0: 70.1, L: 6.4,  gain: 1.00, floor: 0.34,  bands: 10, o: [250, 112, 42], w: [238, 232, 216] },
      belfry: { z0: 79.2, L: 14.0, gain: 1.25, floor: 0.62,  bands: 4,  o: [216, 54, 30],  w: [216, 210, 198] },
      cap:    { z0: 90.7, L: 5.0,  gain: 1.00, floor: 0.68,  bands: 2,  o: [238, 64, 34],  w: [226, 218, 204] },
    },

    // The bracketed cornice, 66.3-70.1. Its own level in everything but name:
    // it takes the SHAFT's circuit (so "white with orange top" keeps it white,
    // which is what that photograph shows) at the shaft's top-of-throw value,
    // knocked down again because it overhangs its own light.
    // 0.34 reproduced the close photograph's (16,5,3) exactly and rendered as a
    // black GAP between the shaft and the crown at flying distance, which reads
    // as missing geometry rather than as an unlit band. 0.45 is still darker
    // than anything else on the tower and still clearly a separate light.
    corniceShade: 0.45,

    // The bronze window channel is in the wash but recessed 0.30 m, so it sits
    // in its own shadow; the bell chamber behind the colonnade is not lit at
    // all; the copper roof is above every fixture on the building.
    slotShade: 0.42,
    voidHex: '#0d0c10',
    capRoofHex: '#191412',    // was #1a2028 — blue-black under a blue night
                              // light reads as a teal chip on an orange tower.
    // The obstruction light on the finial. Sourced: the "Dark Tower" state is
    // "completely darkened except for its clock face and AIRCRAFT WARNING
    // LIGHTS", so this is the one thing on the building that is never off. Red,
    // pre-divided for the blue night light like the dial. Invisible against a
    // lit cap; the point of it is the two dark configurations.
    beaconHex: '#9d190c',

    // The balustrade stands IN the fixtures, so it is brighter than the band it
    // rises from. This is how the visible lamp flare in the photographs gets
    // into the render without adding 100 sub-pixel light-fitting prisms.
    deckLamp: 1.30,

    // Lit from within and unaffected by which circuit is on — the dial glows in
    // 'dark' too, which is why "completely darkened except for its clock face"
    // is a configuration at all. Cream, NOT gold: the gilt rim and the hands
    // are the dark shapes on it.
    //
    // WHY THESE TWO HEXES ARE PRE-DIVIDED BY THE NIGHT LIGHT. MapLibre's
    // fill-extrusion shader multiplies the feature colour by the light colour
    // CHANNEL BY CHANNEL, and at night this scene's light is `#9aa6da` — blue.
    // Blue therefore gets 0.855/0.604 = 1.42x the gain red does, and a warm
    // cream authored honestly comes out cold: `#ffeec4` measured, isolated by
    // filtering the detail layer to the dial alone, lands (111, 113, 126). The
    // dial that a photograph shows as the warmest thing on the building was
    // rendering as the bluest. So the authored value is the wanted screen
    // colour DIVIDED by the light: `#ffd67e` lands about (110, 82, 60), which
    // is the cream the photographs measure. This is the same trap PR #56 hit
    // and read as "the colours are indistinguishable".
    dialHex: '#ffd67e',
    handHex: '#241c10',
    rimHex: '#3a2f14',
    // The numeral. Office fluorescent behind glass — the photographs measure it
    // near-NEUTRAL (233,230,208), not warm, so this one is only half corrected.
    numeralHex: '#ffeaba',
    darkWinHex: '#14161c',
  };
  window.TOWER_NIGHT = NIGHT;

  const SRC = 'austin-tower';
  const L_WALL = 'tower-wall';     // banded walls, on our own pattern atlas
  const L_SOLID = 'tower-solid';   // roof facets and everything flat-coloured
  const L_DETAIL = 'tower-detail'; // slots, windows, columns, clock
  const LAYERS = [L_WALL, L_SOLID, L_DETAIL];
  const DATA = 'data/tower.geojson';
  const TILE = 64;

  const HAS_PAT = ['has', 'pat'];
  const NO_PAT = ['!', HAS_PAT];
  const DETAIL_KINDS = ['slot', 'win', 'post', 'clock'];
  const IS_DETAIL = ['in', ['get', 'kind'], ['literal', DETAIL_KINDS]];
  const NOT_DETAIL = ['!', IS_DETAIL];

  /**
   * How each pattern family is drawn. `strip` is the ONLY structure any of them
   * carries and it is deliberately x-only: pitch and width in tile pixels, plus
   * how far the strip is mixed toward black. A 64 px tile covers 30-59 m at the
   * zooms this app flies, so ~7 px is a 3.5-7 m bay — which is the real bay on
   * this building at the middle of that range, and errs to "fine texture" when
   * you fly close, the correct failure direction.
   *
   *   twshaft  Indiana limestone, blank. The shaft's only openings are the
   *            three geometry slots, so this must NOT draw windows.
   *   twplain  the same stone, brighter: cornice, balustrade, crown.
   *   twwall   Main Building piano nobile — tall punched windows on a 4.3 m bay
   *   twbase   the rusticated arcade storey: wide, deep, dark openings
   *   twattic  the attic loggia: openings on a red-brown ground
   *   twvoid   the bell chamber behind the colonnade
   */
  const FAM = {
    twshaft: { strip: null,                   mottle: 0.055, streaks: 5 },
    twplain: { strip: null,                   mottle: 0.045, streaks: 3 },
    twwall:  { strip: [7, 2, 0.42],           mottle: 0.060, streaks: 5 },
    twbase:  { strip: [10, 4, 0.50],          mottle: 0.070, streaks: 4 },
    twattic: { strip: [7, 3, 0.46],           mottle: 0.050, streaks: 2 },
    twvoid:  { strip: null,                   mottle: 0.030, streaks: 0 },
  };

  // ── colour helpers, matching the ramp the rest of the scene uses ────
  const hx = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const css = (c, a) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a == null ? 1 : a})`;

  function rampAt(trio, p) {
    p = Math.max(0, Math.min(1, p));
    return p <= 0.5 ? mix(hx(trio[0]), hx(trio[1]), p / 0.5)
                    : mix(hx(trio[1]), hx(trio[2]), (p - 0.5) / 0.5);
  }

  /** ['interpolate', p, day, golden, night] — timeofday.js's own shape. */
  function bakedColor(p) {
    p = Math.max(0, Math.min(1, p));
    return ['interpolate', ['linear'], p,
      0, ['to-color', ['get', 'wd'], '#cbc0aa'],
      0.5, ['to-color', ['get', 'wg'], '#cbc0aa'],
      1, ['to-color', ['get', 'wn'], '#20222a'],
    ];
  }

  // Deterministic 0..1. Same generator js/facades.js uses, so a tile drawn here
  // cannot flicker between repaints the way Math.random would.
  function hash01(a, b, c) {
    let x = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
    x = (x ^ (x >> 13)) * 1274126177;
    return ((x ^ (x >> 16)) >>> 0) / 4294967295;
  }

  // ── the tile atlas ──────────────────────────────────────────────────
  let _canvas = null, _ctx = null;

  /**
   * One 64 px tile for (family, colour) at time-of-day p.
   *
   * The block-to-block value scatter is applied to the finished pixel buffer
   * rather than composited from a second canvas: drawImage INTO a
   * willReadFrequently context takes the CPU path and js/facades.js measured
   * that at 230 ms against 22 ms. This context has to be willReadFrequently
   * because it ends in getImageData.
   */
  function tileData(fam, trio, p, seed) {
    if (!_canvas) {
      _canvas = document.createElement('canvas');
      _canvas.width = _canvas.height = TILE;
      _ctx = _canvas.getContext('2d', { willReadFrequently: true });
    }
    const spec = FAM[fam] || FAM.twplain;
    const wall = rampAt(trio, p);
    // How far the sun is down. Walls follow the sun, not the hour — the same
    // split js/facades.js documents, and the reason the scene silhouettes
    // correctly through dusk instead of glowing against a darker sky.
    const sunElev = (typeof window.skyBodies === 'function') ? window.skyBodies(p).sun.elev : (0.5 - p) * 100;
    const dark = Math.max(0, Math.min(1, Math.max((p - 0.55) / 0.45, -sunElev / 9)));

    const ctx = _ctx;
    ctx.clearRect(0, 0, TILE, TILE);
    ctx.fillStyle = css(wall);
    ctx.fillRect(0, 0, TILE, TILE);

    // Weathering: aperiodic in x, CONSTANT in y. Tiles in both axes, needs no
    // anchor, and cannot moire against the strips.
    for (let s = 0; s < spec.streaks; s++) {
      const x = Math.round(hash01(seed + 5623, s, 0) * TILE);
      const w = 2 + Math.round(hash01(seed + 5641, s, 0) * 2);
      ctx.fillStyle = css(mix(wall, [0, 0, 0], 0.07), 0.20 * (1 - dark * 0.7));
      for (const xx of [x, x - TILE]) if (xx + w > 0) ctx.fillRect(xx, 0, w, TILE);
    }

    if (spec.strip) {
      const [pitch, w, depth] = spec.strip;
      // Openings go dark, and the pier beside each one takes a lit edge. Both
      // fade as the sun goes down: a pale grid over every wall after dark is
      // what turns a city into graph paper.
      const op = css(mix(wall, [0, 0, 0], depth * (1 - dark * 0.35)));
      const lit = css(mix(wall, [255, 255, 255], 0.10 * (1 - dark * 0.85)));
      for (let x = 0; x < TILE; x += pitch) {
        ctx.fillStyle = lit; ctx.fillRect(x, 0, 1, TILE);
        ctx.fillStyle = op;  ctx.fillRect(x + 1, 0, w, TILE);
      }
    }

    const img = ctx.getImageData(0, 0, TILE, TILE);
    const d = img.data;
    const amp = spec.mottle * (1 - dark * 0.6);
    if (amp > 0.001) {
      // 4 px cells => ~2-4 m, one ashlar block face. The photographs of this
      // building show strong block-to-block value scatter and nothing finer:
      // a real ashlar course is 0.2-0.3 m, which is well under one texel, and
      // drawing it anyway would assert half-metre coursing on a limestone hall.
      const N = TILE / 4;
      for (let y = 0; y < TILE; y++) {
        const row = ((y / 4) | 0) * N;
        for (let x = 0; x < TILE; x++) {
          const t = hash01(seed + 5501, (x / 4) | 0, row / N) * 2 - 1;
          if (!t) continue;
          const k = amp * Math.abs(t), tgt = t < 0 ? 0 : 255, i = (y * TILE + x) * 4;
          d[i] += (tgt - d[i]) * k;
          d[i + 1] += (tgt - d[i + 1]) * k;
          d[i + 2] += (tgt - d[i + 2]) * k;
        }
      }
    }
    return { width: TILE, height: TILE, data: new Uint8Array(d.buffer.slice(0)) };
  }

  // pattern id -> { fam, trio, seed }. Built from the BAKE's own colours, so the
  // hexes live in exactly one place (scripts/bake_tower.py) and the two halves
  // cannot drift apart.
  //
  // `pat` and `fam` are DIFFERENT properties and the difference matters: `fam`
  // is how the tile is drawn, `pat` is which image the feature asks for. Seven
  // bands share the plain-ashlar family and four different palettes, so the
  // bake allocates `twplain`, `twplain2`, `twplain3`… — one image per
  // (family, colour). Keying the image off the family alone made every crown
  // band inherit whichever palette happened to be emitted first, which by day
  // was invisible and at night left the top 28 m of the Tower unlit.
  let _pats = null;

  // A sub-band's pattern id is `parent~i`. It is a DIFFERENT image — it has to
  // be, because it holds a different night colour — but it must be the SAME
  // STONE, so the texture seed is allocated per PARENT id. Seeding off the full
  // id gave each of the shaft's twenty sub-bands its own mottle and its own
  // weathering streaks, and by day, where every sub-band is the identical
  // limestone, that drew twenty visible horizontal seams up a blank wall.
  const patBase = id => { const i = id.indexOf('~'); return i < 0 ? id : id.slice(0, i); };

  function collectPatterns(gj) {
    const pats = {}, seeds = {};
    let seed = 11;
    for (const f of gj.features) {
      const p = f.properties;
      if (!p || !p.pat || pats[p.pat]) continue;
      const base = patBase(p.pat);
      if (seeds[base] == null) seeds[base] = (seed += 7);
      pats[p.pat] = { fam: p.fam || base, trio: [p.wd, p.wg, p.wn], seed: seeds[base] };
      // Register the PARENT id too, even though the relight leaves no feature
      // asking for it. scripts/verify/tower-check.mjs reads the pattern list
      // out of data/tower.geojson and asserts every id in it exists, and it is
      // right to: a fill-extrusion whose image MapLibre does not have is
      // painted transparent rather than defaulted, so a missing id is an
      // invisible band, not an error. One 64 px tile is a cheap invariant.
      if (base !== p.pat && !pats[base]) {
        pats[base] = { fam: p.fam || base, trio: [p.wd, p.wg, p.wn], seed: seeds[base] };
      }
    }
    return pats;
  }

  function registerPatterns(map, p) {
    if (!_pats) return 0;
    let n = 0;
    for (const id of Object.keys(_pats)) {
      const s = _pats[id];
      try {
        if (map.hasImage && map.hasImage(id)) continue;
        map.addImage(id, tileData(s.fam, s.trio, p, s.seed));
        n++;
      } catch (e) { /* already added */ }
    }
    return n;
  }

  function repaintPatterns(map, p) {
    if (!_pats) return;
    for (const id of Object.keys(_pats)) {
      const s = _pats[id];
      try {
        if (map.hasImage && map.hasImage(id)) map.updateImage(id, tileData(s.fam, s.trio, p, s.seed));
        else map.addImage(id, tileData(s.fam, s.trio, p, s.seed));
      } catch (e) { /* not registered yet */ }
    }
  }

  // ── stop the generic geometry drawing underneath ────────────────────
  /**
   * Two different exclusions, because this building is drawn two different ways.
   *
   * The FOOTPRINT is excluded by id, the way data/stadium.geojson does it. That
   * is belt and braces today — the feature carries has_parts, so app.js's
   * NO_PARTS filter already drops it — but a future bake that stops emitting
   * building:parts would otherwise put a 94 m grey box back inside all of this.
   *
   * The two OSM building:parts have to go too, and they used to be the awkward
   * half: parts.detailed.geojson carried {h, base, wd, wg, wn, rd, rg, rn} and
   * NO id, so they were matched on wall colour — unique to this building across
   * every snapshot on disk, which was true and was still a time bomb. The moment
   * a building is recoloured, an authored pass starts drawing on top of a raw
   * OSM prism it can no longer see.
   *
   * scripts/bake_detail.py now emits `pid`, the parent building's id, so a part
   * is filtered exactly the way its building is: by the SAME replacedBuildingIds
   * list. The colour match is kept only as a fallback for an older snapshot
   * loaded through the date switcher, which will not carry `pid`.
   */
  function hideOriginals(map, gj) {
    const ids = gj.replacedBuildingIds || [];
    if (ids.length) {
      const keep = ['!', ['in', ['get', 'id'], ['literal', ids]]];
      for (const id of ['buildings-3d', 'buildings-roof']) {
        if (!map.getLayer(id)) continue;
        const f = map.getFilter(id);
        try { map.setFilter(id, f ? ['all', f, keep] : keep); } catch (e) {}
      }
    }
    const wd = gj.replacedPartWallColour;
    const partKeep = [];
    if (ids.length) partKeep.push(['!', ['in', ['get', 'pid'], ['literal', ids]]]);
    if (wd) partKeep.push(['!=', ['get', 'wd'], wd]);
    if (partKeep.length) {
      const keep = partKeep.length > 1 ? ['all'].concat(partKeep) : partKeep[0];
      for (const id of ['parts-3d', 'parts-roof']) {
        if (!map.getLayer(id)) continue;
        const f = map.getFilter(id);
        try { map.setFilter(id, f ? ['all', f, keep] : keep); } catch (e) {}
      }
    }
  }

  async function getJSON(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(url + ': ' + r.status);
    return await r.json();
  }

  // ══ the crown / shaft builder ══════════════════════════════════════

  /** day -> golden hour. The same relationship scripts/bake_tower.py uses. */
  function goldenOf(hexCol, t) {
    const c = hx(hexCol), w = [255, 190, 130];
    return '#' + [0, 1, 2].map(i => {
      const v = Math.round(c[i] + (w[i] - c[i]) * (t == null ? 0.16 : t));
      return Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0');
    }).join('');
  }
  const trioOf = (day, night, t) => [day, goldenOf(day, t), night];

  /**
   * The shaft's own frame, read off the shaft ring the bake wrote.
   *
   * The Tower is 4.9 degrees off the axes, so every part of this has to be
   * placed in the building's frame and converted out — building it in lon/lat
   * and hoping is how a rotated building gets sheared detail. `u` is the first
   * ring edge (the 22.56 m elevation) and `v` the second (20.84 m), which is
   * exactly the (W, D) the bake's own rect() uses, so `col === 0` here is the
   * same elevation-left the numeral rule already means by it.
   */
  function frameOf(ring) {
    const mx = 111320 * Math.cos(ring[0][1] * Math.PI / 180), my = 111320;
    const M = p => [p[0] * mx, p[1] * my];
    const a = M(ring[0]), b = M(ring[1]), c = M(ring[2]);
    let ux = b[0] - a[0], uy = b[1] - a[1];
    const W = Math.hypot(ux, uy); ux /= W; uy /= W;
    let vx = c[0] - b[0], vy = c[1] - b[1];
    const D = Math.hypot(vx, vy); vx /= D; vy /= D;
    const cx = (a[0] + c[0]) / 2, cy = (a[1] + c[1]) / 2;
    return {
      W, D,
      pt: (u, v) => [
        +((cx + u * ux + v * vx) / mx).toFixed(7),
        +((cy + u * uy + v * vy) / my).toFixed(7),
      ],
      inv: p => {
        const x = p[0] * mx - cx, y = p[1] * my - cy;
        return [x * ux + y * uy, x * vx + y * vy];
      },
    };
  }

  const rectOf = (F, u, v, w, d) => ({
    type: 'Polygon',
    coordinates: [[F.pt(u - w / 2, v - d / 2), F.pt(u + w / 2, v - d / 2),
                   F.pt(u + w / 2, v + d / 2), F.pt(u - w / 2, v + d / 2),
                   F.pt(u - w / 2, v - d / 2)]],
  });

  // Parts the bake emits that this supersedes. Kept as one list so the drop and
  // the rebuild cannot disagree.
  const REPLACED = ['slot', 'win', 'win-lit', 'clock-bezel', 'clock-dial',
                    'belfry-void', 'belfry-pier', 'belfry-col', 'cap-roof'];

  function buildDetail(gj) {
    const feats = gj.features;
    const shaft = feats.find(f => f.properties && f.properties.part === 'shaft');
    if (!shaft) { console.warn('[tower] no shaft band — detail not built'); return; }
    const F = frameOf(shaft.geometry.coordinates[0]);
    const W = F.W, D = F.D;

    // Every band's height and plan, read back out of the bake's own output.
    const band = {};
    for (const f of feats) {
      const p = f.properties, part = p && p.part;
      if (!part || band[part]) continue;
      let u0 = 1e9, v0 = 1e9, u1 = -1e9, v1 = -1e9;
      for (const c of f.geometry.coordinates[0]) {
        const [u, v] = F.inv(c);
        u0 = Math.min(u0, u); u1 = Math.max(u1, u);
        v0 = Math.min(v0, v); v1 = Math.max(v1, v);
      }
      band[part] = { base: p.base, top: p.h, w: u1 - u0, d: v1 - v0, props: p };
    }

    const out = feats.filter(f => REPLACED.indexOf(f.properties.part) < 0);
    const add = (geom, base, top, tri, kind, part, props) => {
      if (top - base < 0.02) return;
      out.push({
        type: 'Feature',
        properties: Object.assign({ kind, part, base: +base.toFixed(2), h: +top.toFixed(2),
                                    wd: tri[0], wg: tri[1], wn: tri[2] }, props || {}),
        geometry: geom,
      });
    };
    const box = (u, v, w, d, base, top, tri, kind, part, props) =>
      add(rectOf(F, u, v, w, d), base, top, tri, kind, part, props);

    // ── 1. the shaft's three bays per face ─────────────────────────
    const S = CROWN.slot;
    const shaftTop = band.shaft.top;
    const cSlot = trioOf(S.spandrel, S.spandrelNight, 0.10);
    const glassProps = feats.find(f => f.properties.part === 'win');
    const litProps = feats.find(f => f.properties.part === 'win-lit');
    const cGlass = glassProps
      ? [glassProps.properties.wd, glassProps.properties.wg, glassProps.properties.wn]
      : trioOf('#3a4048', '#14161c', 0.06);
    const cLit = litProps
      ? [litProps.properties.wd, litProps.properties.wg, litProps.properties.wn]
      : trioOf('#3a4048', '#ffdca8', 0.06);

    // The numeral, unchanged: the middle bay full height, all three across the
    // bottom, two cells in the left bay near the top. Three bays is exactly
    // enough to write a 1, which is why the bay count is not a free parameter.
    const lit = (col, row) =>
      col === 1 || row === 0 || (col === 0 && (row === S.rows - 2 || row === S.rows - 3));

    const faces = [[0, -1, D / 2], [0, 1, D / 2], [-1, 0, W / 2], [1, 0, W / 2]];
    for (const [nu, nv, half] of faces) {
      const alongU = nu === 0;
      for (const col of [-1, 0, 1]) {
        const off = col * S.pitch;
        if (alongU) box(off, nv * (half + S.depth / 2), S.w, S.depth,
                        S.from - 1.5, shaftTop - 1.2, cSlot, 'slot', 'slot');
        else box(nu * (half + S.depth / 2), off, S.depth, S.w,
                 S.from - 1.5, shaftTop - 1.2, cSlot, 'slot', 'slot');
        for (let row = 0; row < S.rows; row++) {
          const z = S.from + row * S.floor;
          if (z + S.winH > shaftTop - 1.2) break;
          const on = lit(col + 1, row);
          const tri = on ? cLit : cGlass;
          const part = on ? 'win-lit' : 'win';
          if (alongU) box(off, nv * (half + S.glassDepth / 2), S.glassW, S.glassDepth,
                          z, z + S.winH, tri, 'win', part, { lit: on ? 1 : 0 });
          else box(nu * (half + S.glassDepth / 2), off, S.glassDepth, S.glassW,
                   z, z + S.winH, tri, 'win', part, { lit: on ? 1 : 0 });
        }
      }
    }

    // ── 2. the belfry colonnade ────────────────────────────────────
    const B = CROWN.belfry;
    const bf = band['belfry-foot'], be = band['belfry-entab'];
    const z0 = bf.top, z1 = be.base;
    const cCrown = [bf.props.wd, bf.props.wg, bf.props.wn];
    // The colonnade ring is the belfry's own plan, which the bake writes as the
    // entablature's minus its overhang; take it from the pier ring the bake
    // emitted rather than restating S_BELFRY here.
    const oldPiers = feats.filter(f => f.properties.part === 'belfry-pier');
    let bw = W * 0.491, bd = D * 0.491;
    if (oldPiers.length === 4) {
      let u0 = 1e9, v0 = 1e9, u1 = -1e9, v1 = -1e9;
      for (const f of oldPiers) for (const c of f.geometry.coordinates[0]) {
        const [u, v] = F.inv(c);
        u0 = Math.min(u0, u); u1 = Math.max(u1, u);
        v0 = Math.min(v0, v); v1 = Math.max(v1, v);
      }
      bw = u1 - u0; bd = v1 - v0;
    }
    const voidProps = feats.find(f => f.properties.part === 'belfry-void');
    if (voidProps) {
      const vp = voidProps.properties;
      out.push({
        type: 'Feature',
        properties: Object.assign({}, vp, { base: z0, h: z1 }),
        geometry: rectOf(F, 0, 0, bw - 2 * B.pierW, bd - 2 * B.pierW),
      });
    }
    for (const su of [-1, 1]) for (const sv of [-1, 1]) {
      box(su * (bw - B.pierW) / 2, sv * (bd - B.pierW) / 2, B.pierW, B.pierW,
          z0, z1, cCrown, 'post', 'belfry-pier');
    }
    for (const [span, alongU] of [[bw, true], [bd, false]]) {
      const clear = span - 2 * B.pierW;
      for (const t of B.colT) {
        const off = -clear / 2 + clear * t;
        for (const s of [-1, 1]) {
          if (alongU) box(off, s * (bd - B.colW) / 2, B.colW, B.colW, z0, z1, cCrown, 'post', 'belfry-col');
          else box(s * (bw - B.colW) / 2, off, B.colW, B.colW, z0, z1, cCrown, 'post', 'belfry-col');
        }
      }
    }

    // ── 3. the four clock faces ────────────────────────────────────
    const C = CROWN.clock;
    const cs = band.clockstage;
    const cGold = trioOf(C.gold, C.goldNight, 0.10);
    const cDial = trioOf(C.dial, C.dialNight, 0.05);
    const cHand = trioOf(C.gold, C.handNight, 0.10);
    const R = C.rimD / 2, Ri = C.dialD / 2;

    for (const [nu, nv] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const alongU = nu === 0;
      const half = alongU ? cs.d / 2 : cs.w / 2;
      // slab(x, z, width, height, depth, trio, part), in the FACE's own plane:
      // x runs screen-right as seen from outside that elevation, which is +u on
      // the south face and -u on the north. Getting that sign wrong mirrors the
      // hands on half the clocks and nothing in a screenshot says so — 10:10
      // mirrored is 1:50 and still looks like a clock.
      const slab = (x, zc, wid, hei, dep, tri, part) => {
        if (wid < 0.06 || hei < 0.06) return;
        if (alongU) box(-nv * x, nv * (half + dep / 2), wid, dep, zc - hei / 2, zc + hei / 2, tri, 'clock', part);
        else box(nu * (half + dep / 2), nu * x, dep, wid, zc - hei / 2, zc + hei / 2, tri, 'clock', part);
      };

      // the RIM as an annulus: two slabs per band, outer chord minus inner
      for (let i = 0; i < C.bands; i++) {
        const t0 = -1 + 2 * i / C.bands, t1 = -1 + 2 * (i + 1) / C.bands;
        const tm = (t0 + t1) / 2, zc = C.mid + tm * R, hei = (t1 - t0) * R;
        const xo = R * Math.sqrt(Math.max(0, 1 - tm * tm));
        const zz = Math.abs(tm * R);
        const xi = zz < Ri ? Math.sqrt(Ri * Ri - zz * zz) : 0;
        if (xi < 0.14) slab(0, zc, 2 * xo, hei, C.rimDepth, cGold, 'clock-rim');
        else for (const s of [-1, 1]) slab(s * (xo + xi) / 2, zc, xo - xi, hei, C.rimDepth, cGold, 'clock-rim');
      }
      // the DIAL as a disc, not a square
      for (let i = 0; i < C.dialBands; i++) {
        const t0 = -1 + 2 * i / C.dialBands, t1 = -1 + 2 * (i + 1) / C.dialBands;
        const tm = (t0 + t1) / 2;
        slab(0, C.mid + tm * Ri, 2 * Ri * Math.sqrt(Math.max(0, 1 - tm * tm)),
             (t1 - t0) * Ri, C.dialDepth, cDial, 'clock-dial');
      }
      // four gilt marks at 12 / 3 / 6 / 9
      slab(0, C.mid + C.tickR, C.tickW, C.tickLen, C.handDepth, cGold, 'clock-tick');
      slab(0, C.mid - C.tickR, C.tickW, C.tickLen, C.handDepth, cGold, 'clock-tick');
      slab(+C.tickR, C.mid, C.tickLen, C.tickW, C.handDepth, cGold, 'clock-tick');
      slab(-C.tickR, C.mid, C.tickLen, C.tickW, C.handDepth, cGold, 'clock-tick');
      // the HANDS. A fill-extrusion only rises vertically, so a hand at an
      // angle is a staircase of small slabs along its own axis — the same
      // trick the rim's chords use, and the reason the step count is a knob.
      const [hh, mm] = C.time;
      const ang = [((hh % 12) + mm / 60) * 30, mm * 6];
      for (let k = 0; k < 2; k++) {
        const th = ang[k] * Math.PI / 180, L = C.handLen[k], wdt = C.handW[k];
        const st = L / C.handSteps;
        for (let j = 0; j < C.handSteps; j++) {
          const rm = (j + 0.5) * st;
          slab(rm * Math.sin(th), C.mid + rm * Math.cos(th),
               Math.max(wdt, Math.abs(Math.sin(th)) * st * 1.15),
               Math.max(wdt, Math.abs(Math.cos(th)) * st * 1.15),
               C.handDepth, cHand, 'clock-hand');
        }
      }
    }

    // ── 4. the observation deck and the belfry terrace ─────────────
    const K = CROWN.deck;
    if (K.on) {
      for (const under of ['cornice', 'clockstage']) {
        const bd0 = band[under];
        if (!bd0) continue;
        const tri = [bd0.props.wd, bd0.props.wg, bd0.props.wn];
        const zP = bd0.top, zB = zP + K.plinthH, zR = zB + K.balH, zT = zR + K.railH;
        const hu = bd0.w / 2 - K.inset - K.railD / 2;
        const hv = bd0.d / 2 - K.inset - K.railD / 2;
        for (const su of [-1, 1]) for (const sv of [-1, 1])
          box(su * hu, sv * hv, K.postW, K.postW, zP, zT, tri, 'post', 'deck-post');
        for (const [alongU, s] of [[true, -1], [true, 1], [false, -1], [false, 1]]) {
          const spanHalf = alongU ? hu : hv;
          const len = 2 * spanHalf + K.postW;
          const o = alongU ? [0, s * hv] : [s * hu, 0];
          const dim = w => (alongU ? [len, w] : [w, len]);
          box(o[0], o[1], dim(K.plinthD)[0], dim(K.plinthD)[1], zP, zB, tri, 'post', 'deck-plinth');
          box(o[0], o[1], dim(K.railD)[0], dim(K.railD)[1], zR, zT, tri, 'post', 'deck-rail');
          const clear = 2 * spanHalf - K.postW;
          const n = Math.max(2, Math.round(clear / K.balPitch));
          for (let i = 1; i < n; i++) {
            const t = -clear / 2 + clear * i / n;
            if (alongU) box(t, s * hv, K.balW, K.balW, zB, zR, tri, 'post', 'deck-baluster');
            else box(s * hu, t, K.balW, K.balW, zB, zR, tri, 'post', 'deck-baluster');
          }
        }
      }
    }

    // ── 5. the cap: a copper pyramid behind its parapet, and a finial ─
    const P = CROWN.cap;
    const capB = band.cap;
    if (capB) {
      const capF = out.find(f => f.properties.part === 'cap');
      if (capF) capF.properties.h = P.blockTop;
      const stone = [capB.props.wd, capB.props.wg, capB.props.wn];
      const old = feats.find(f => f.properties.part === 'cap-roof');
      const cop = old ? [old.properties.wd, old.properties.wg, old.properties.wn]
                      : trioOf('#6f8477', '#1a2028', 0.06);
      // the parapet: four bars on the measured x0.362 ring, so the photographed
      // silhouette survives while the roof inside it is free to be a pyramid
      const pw = W * P.parapetS, pd = D * P.parapetS;
      for (const [alongU, s] of [[true, -1], [true, 1], [false, -1], [false, 1]]) {
        if (alongU) box(0, s * (pd - P.parapetT) / 2, pw, P.parapetT, P.blockTop, P.parapetTop, stone, 'roof', 'cap-parapet');
        else box(s * (pw - P.parapetT) / 2, 0, P.parapetT, pd, P.blockTop, P.parapetTop, stone, 'roof', 'cap-parapet');
      }
      for (const su of [-1, 1]) for (const sv of [-1, 1])
        box(su * (pw - P.acroteria) / 2, sv * (pd - P.acroteria) / 2, P.acroteria, P.acroteria,
            P.blockTop, P.parapetTop + 0.34, stone, 'roof', 'cap-acroterion');
      // the pyramid
      const rise = (P.roofTop - P.blockTop) / P.roofSteps;
      for (let i = 0; i < P.roofSteps; i++) {
        const s0 = P.roofS0 + (P.roofS1 - P.roofS0) * (i / P.roofSteps);
        box(0, 0, W * s0, D * s0, P.blockTop + i * rise, P.blockTop + (i + 1) * rise, cop, 'roof', 'cap-roof');
      }
      // the finial: 307 ft is to the top of THIS, so nothing rises above it
      const fz = P.blockTop + P.roofSteps * rise;
      box(0, 0, W * P.finialS, D * P.finialS, fz, fz + (P.finialTop - fz) * 0.55, cop, 'roof', 'finial');
      box(0, 0, W * P.finialNeck, D * P.finialNeck, fz + (P.finialTop - fz) * 0.55, P.finialTop, cop, 'roof', 'finial');
    }

    gj.features = out;
    return out.length;
  }

  // ══ the floodlighting ══════════════════════════════════════════════
  //
  // Runs LAST, over whatever the bake and buildDetail between them produced,
  // and touches nothing but `wn` and — for the two tall banded walls — where
  // one feature is cut into several. Day and golden hour come out bit for bit
  // identical: every sub-band inherits its parent's `wd` and `wg`, and the
  // texture seed follows the parent id (see patBase).

  const clamp255 = v => Math.max(0, Math.min(255, Math.round(v)));
  const hexOf = rgb => '#' + rgb.map(v => clamp255(v).toString(16).padStart(2, '0')).join('');
  /** A circuit colour dimmed to `k` of its value at the lamp. */
  const dim = (rgb, k) => hexOf([rgb[0] * k, rgb[1] * k, rgb[2] * k]);

  /**
   * The wash: how much of a setback's light reaches height z. Exponential
   * above the lamp, flat below it (you cannot be closer to a floodlight than
   * standing on it), never below the level's floor.
   */
  function washAt(lv, z) {
    return Math.max(lv.floor, Math.exp(-Math.max(0, z - lv.z0) / lv.L));
  }

  /**
   * Cut [b, t] into `n` sub-bands whose WASH ratios are equal, not whose
   * heights are. Equal heights put the whole visible step at the bottom of the
   * shaft, where the curve is steepest — the top half would be twenty bands of
   * an identical dark and the bottom two would jump 40%.
   */
  function washEdges(lv, b, t, n) {
    const w0 = washAt(lv, b), w1 = washAt(lv, t);
    const out = [b];
    if (n > 1 && w1 < w0 - 1e-6) {
      for (let i = 1; i < n; i++) {
        const z = lv.z0 - lv.L * Math.log(w0 * Math.pow(w1 / w0, i / n));
        const zz = Math.max(b, Math.min(t, z));
        if (zz > out[out.length - 1] + 0.15 && t - zz > 0.15) out.push(zz);
      }
    }
    out.push(t);
    return out;
  }

  function relightNight(gj) {
    if (!NIGHT.on) return 0;
    const cfg = NIGHT.CONFIGS[NIGHT.config] || NIGHT.CONFIGS['orange-no1'];
    const feats = gj.features;
    const baseOf = part => {
      const f = feats.find(x => x.properties && x.properties.part === part);
      return f ? f.properties.base : null;
    };
    // The four setback floors, read back out of the bake rather than restated,
    // so a height change in scripts/bake_tower.py moves the lights with it.
    const B = {
      cornice: baseOf('cornice') ?? 66.3,
      stage: baseOf('clockstage') ?? 70.1,
      belfry: baseOf('belfry-foot') ?? 78.2,
      cap: baseOf('cap') ?? 90.7,
    };
    const L = NIGHT.LEVELS;
    L.shaft.z0 = 20.2;            // the Main Building roof the base floods sit on
    L.deck.z0 = B.stage;
    L.belfry.z0 = B.belfry;
    L.cap.z0 = B.cap;

    const levelAt = z => (z < B.cornice ? 'shaft' : z < B.stage ? 'cornice'
                        : z < B.belfry ? 'deck' : z < B.cap ? 'belfry' : 'cap');

    /** The lit colour of a surface at height z, on whichever circuit is up. */
    function lit(name, z, extra) {
      const key = name === 'cornice' ? 'shaft' : name;
      const lv = L[key], c = cfg[key];
      if (c === '-') return NIGHT.capRoofHex;       // that setback is switched off
      const k = washAt(lv, z) * lv.gain
              * (name === 'cornice' ? NIGHT.corniceShade : extra == null ? 1 : extra);
      return dim(c === 'w' ? lv.w : lv.o, k);
    }

    // ── the two tall banded walls become stacks of sub-bands ──────────
    // Anything else keeps one feature and takes the wash at its own middle.
    const SPLIT = { shaft: 'shaft', clockstage: 'deck' };
    const out = [];
    let split = 0;
    for (const f of feats) {
      const p = f.properties, part = p && p.part;
      if (!part || !SPLIT[part] || !p.pat) { out.push(f); continue; }
      const lv = L[SPLIT[part]];
      const edges = washEdges(lv, p.base, p.h, lv.bands);
      for (let i = 0; i < edges.length - 1; i++) {
        const b = edges[i], t = edges[i + 1];
        const props = Object.assign({}, p, {
          base: +b.toFixed(2), h: +t.toFixed(2),
          pat: p.pat + '~' + i, fam: p.fam || patBase(p.pat),
          wn: lit(SPLIT[part], (b + t) / 2),
        });
        out.push({ type: 'Feature', properties: props, geometry: f.geometry });
        split++;
      }
    }

    // ── everything else: one value each, by part, then by height ──────
    for (const f of out) {
      const p = f.properties, part = p.part;
      if (!part || SPLIT[part]) continue;             // sub-bands are done
      if (part.indexOf('mb-') === 0) continue;        // the Main Building is not floodlit
      const mid = (p.base + p.h) / 2;

      if (part === 'belfry-void') { p.wn = NIGHT.voidHex; continue; }
      if (part === 'cap-roof') { p.wn = NIGHT.capRoofHex; continue; }
      // Only the top half of the finial — the neck below it stays copper, so
      // the beacon reads as a light ON the summit rather than as a red spike.
      if (part === 'finial') { p.wn = p.h >= 93.99 ? NIGHT.beaconHex : NIGHT.capRoofHex; continue; }
      if (part === 'clock-dial') { p.wn = NIGHT.dialHex; continue; }
      if (part === 'clock-hand') { p.wn = NIGHT.handHex; continue; }
      if (part === 'clock-rim' || part === 'clock-tick' || part === 'clock-bezel') { p.wn = NIGHT.rimHex; continue; }
      if (part === 'win-lit') { p.wn = cfg.numeral ? NIGHT.numeralHex : NIGHT.darkWinHex; continue; }
      if (part === 'win') { p.wn = NIGHT.darkWinHex; continue; }
      if (part === 'slot') { p.wn = lit('shaft', mid, NIGHT.slotShade); continue; }
      // The balustrades stand in the fixtures, so they read as the light source.
      if (part.indexOf('deck-') === 0) { p.wn = lit(levelAt(p.base), p.base, NIGHT.deckLamp); continue; }
      p.wn = lit(levelAt(mid), mid);
    }

    gj.features = out;
    window.__towerNight = { config: NIGHT.config, split, features: out.length, floors: B };
    return split;
  }

  let _added = false;

  window.initTower = async function initTower(map) {
    if (!TOWER.on || _added || map.getSource(SRC)) return;
    _added = true;

    let gj;
    try {
      gj = await getJSON(DATA);
    } catch (e) {
      console.warn('[tower]', e.message, '- tower not drawn');
      return;
    }

    const nBake = gj.features.length;
    if (CROWN.on) { try { buildDetail(gj); } catch (e) { console.warn('[tower] detail:', e.message); } }
    let nSplit = 0;
    try { nSplit = relightNight(gj); } catch (e) { console.warn('[tower] night:', e.message); }

    const p = (window.__todCurrentP != null) ? window.__todCurrentP : 0.3;
    _pats = collectPatterns(gj);
    // Register BEFORE addLayer: a fill-extrusion asking for an image MapLibre
    // does not have is painted transparent, not defaulted.
    const nImg = registerPatterns(map, p);

    map.addSource(SRC, { type: 'geojson', data: gj, ...(window.PATTERN_TILING || {}) });
    hideOriginals(map, gj);

    // The anchor must be the first symbol layer AFTER our buildings. The
    // basemap puts its symbol layers immediately after `background`, so
    // anchoring at the first symbol layer in the style drops everything to the
    // BOTTOM of the stack, under the ground fill — which is how the stadium
    // once rendered underneath `ground-areas`. Same loop, same reason.
    const stack = map.getStyle().layers;
    const after = Math.max(0, stack.findIndex(l => l.id === 'buildings-3d'));
    const anchor = (stack.slice(after + 1).find(l => l.type === 'symbol') || {}).id;

    if (!map.getLayer(L_WALL)) {
      map.addLayer({
        id: L_WALL, type: 'fill-extrusion', source: SRC, minzoom: TOWER.minZoom,
        filter: ['all', HAS_PAT, NOT_DETAIL],
        paint: {
          'fill-extrusion-pattern': ['get', 'pat'],
          'fill-extrusion-height': ['get', 'h'],
          'fill-extrusion-base': ['get', 'base'],
          'fill-extrusion-opacity': TOWER.opacity,
          // OFF. The gradient darkens the bottom of every extrusion and these
          // are nine stacked bands, so it would draw a dark seam at each of the
          // eight boundaries — and the 1.0 m belfry plinth would fall entirely
          // inside its own gradient and render black. The band tones already
          // carry the vertical hierarchy.
          'fill-extrusion-vertical-gradient': false,
        },
      }, anchor);
    }
    if (!map.getLayer(L_SOLID)) {
      map.addLayer({
        id: L_SOLID, type: 'fill-extrusion', source: SRC, minzoom: TOWER.minZoom,
        filter: ['all', NO_PAT, NOT_DETAIL],
        paint: {
          'fill-extrusion-color': bakedColor(p),
          'fill-extrusion-height': ['get', 'h'],
          'fill-extrusion-base': ['get', 'base'],
          'fill-extrusion-opacity': 1.0,
          // Also off: the roof facets are 1.5 m steps, and a gradient over
          // 1.5 m is a black line under every tread.
          'fill-extrusion-vertical-gradient': false,
        },
      }, anchor);
    }
    if (!map.getLayer(L_DETAIL)) {
      map.addLayer({
        id: L_DETAIL, type: 'fill-extrusion', source: SRC, minzoom: TOWER.detailMinZoom,
        filter: IS_DETAIL,
        paint: {
          'fill-extrusion-color': bakedColor(p),
          'fill-extrusion-height': ['get', 'h'],
          'fill-extrusion-base': ['get', 'base'],
          'fill-extrusion-opacity': 1.0,
          'fill-extrusion-vertical-gradient': false,
        },
      }, anchor);
    }

    // Exposed for scripts/verify/tower-*.mjs, which must not carry its own copy
    // of the image list — the bake allocates one per (family, palette) and that
    // set grows whenever a band gets its own colour.
    window.__towerPats = Object.keys(_pats);
    window.__towerFeatures = gj.features.length;
    console.log('[tower]', nBake, 'baked ->', gj.features.length, 'features,', nImg, 'pattern images,',
                'replacing', (gj.replacedBuildingIds || []).length, 'building +',
                '2 OSM parts; night "' + NIGHT.config + '",', nSplit, 'wash bands');
  };

  /**
   * QUANTISED, and this is a real fix rather than a micro-optimisation.
   *
   * js/timeofday.js splits applyTimeOfDay into a cheap half that runs every
   * frame (the sky overlay, which tracks the camera) and a heavy half — the
   * facade atlas, the interpolate expressions, the basemap sweep — which it
   * quantises to 1/128 of the ramp, "1,920 heavy passes per sweep to 128 with
   * no visible stepping". This module hooks applyTimeOfDay from OUTSIDE that
   * split, so it never saw the quantisation: the Tower's atlas was rebuilt on
   * all 1,920 frames of a 32 s auto cycle. That was already the case with the
   * bake's 8 pattern images; the floodlight bands take it to 58, measured at
   * 10-16 ms per rebuild, which is a whole frame budget spent every frame.
   *
   * Same PQ as timeofday.js on purpose. A different divisor would step the
   * Tower's hour at moments the rest of the city does not, which is worse than
   * either quantisation on its own.
   */
  let _lastPq = null;
  const PQ = 128;

  window.applyTowerColors = function applyTowerColors(map, p, force) {
    if (!map || !map.getLayer) return;
    const pq = Math.round(Math.max(0, Math.min(1, p)) * PQ) / PQ;
    if (force !== true && _lastPq !== null && pq === _lastPq) return;
    _lastPq = pq;
    const col = bakedColor(p);
    for (const id of [L_SOLID, L_DETAIL]) {
      try { if (map.getLayer(id)) map.setPaintProperty(id, 'fill-extrusion-color', col); } catch (e) {}
    }
    repaintPatterns(map, p);
  };

  /** Visibility switch, so scripts/verify/tower-perf.mjs can A/B in one build. */
  window.setTowerVisible = function setTowerVisible(on) {
    const map = window.__map;
    if (!map) return;
    for (const id of LAYERS) {
      try {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
      } catch (e) {}
    }
  };

  // ── bootstrap ───────────────────────────────────────────────────────
  // js/app.js is owned by another pass, so rather than ask for a call inside
  // buildScene() this waits for the map and for the layers it has to insert
  // itself above and filter, then runs. Copied from the boot() at the bottom of
  // js/outer.js. It also wraps applyTimeOfDay here, after every module has
  // loaded, so script order cannot break the hook.
  function boot() {
    const map = window.__map;
    if (!map) return setTimeout(boot, 60);

    const hookTod = () => {
      if (typeof window.applyTimeOfDay !== 'function' || window.applyTimeOfDay.__tower) return;
      const prev = window.applyTimeOfDay;
      const wrapped = function (m, p, force) {
        const r = prev.apply(this, arguments);
        // `force` has to travel: a jump straight to an hour (the verify suite,
        // the snapshot switcher) must repaint even if p quantises to where it
        // already was, or the Tower keeps the previous hour's atlas.
        try { window.applyTowerColors(m, p, force); } catch (e) {}
        return r;
      };
      wrapped.__tower = true;
      window.applyTimeOfDay = wrapped;
    };

    let tries = 0;
    const go = () => {
      // parts-3d as well as buildings-3d: this building renders through the
      // PARTS layer today, and hideOriginals() has to be able to filter it. If
      // it is somehow never added, give up waiting after ~30 s and draw anyway
      // rather than leaving the tower undrawn.
      const ready = map.getLayer('buildings-3d') && (map.getLayer('parts-3d') || ++tries > 250);
      if (!ready) return setTimeout(go, 120);
      hookTod();
      window.initTower(map);
    };
    if (map.isStyleLoaded && map.isStyleLoaded()) go();
    else map.once('load', () => setTimeout(go, 0));
  }
  boot();
})();
