/**
 * heroes.js — three modern campus buildings that were drawn at half their height.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SECOND PASS, QUEUE PART G: the height was the canvas. This one paints.
 *
 * PR #118 (below) fixed the massing and stopped there, and the measurement that
 * says so is one number: EER's rendered wall came out **#b9956b, luma 155,
 * R-B 78 — against #c29d72/163/80 for T.S. Painter and #ac8c60/145/76 for
 * Physics-Math-Astronomy in the SAME frame.** EER is a pale limestone building
 * standing in a block of tan brick and it was rendering as one of the tan bricks.
 *
 * The cause is not the renderer. `data/facade_palette.json` bucket 5 is
 * **#e3dac8** and PR #118 gave EER **#e2dacb** — a three-count difference on one
 * channel. The "own colour" was one of the city's fourteen, so of course it read
 * as one of the fourteen. Every hex in PALETTE below was pulled off a named
 * photograph instead, and each one is checked against those fourteen before it
 * ships (see PALETTE's header for the check).
 *
 * WHAT WAS ESTABLISHED FROM REFERENCES, and what was not — the full list, with
 * the frame each fact came off, is HANDOFF.md §59. In short:
 *
 *   EER   Two 80.5 x 22.7 m nine-storey limestone bars, a 21.3 m canyon between
 *         them, a black steel space frame closing the east end. The facade is
 *         NARROW VERTICAL SLOTS in irregular CLUSTERS — runs of two to four
 *         together, then three to six bays of blank stone — one row per floor,
 *         over a continuous stone plane with NO dark band at the floor line.
 *         PR #118 drew evenly-scattered slots and a 20%-dark ribbon across every
 *         floor; the ribbon is not in any photograph of this building. Above the
 *         top row of slots is a BLANK stone band a full floor tall, then a pale
 *         metal coping. The ground floor is a dark glazed recess. The canyon
 *         faces are full-height curtain wall, and a glass ribbon turns each
 *         bar's canyon-side corner onto the end elevation.
 *   GDC   Pelli's module is a pale CAST-STONE spandrel at every floor line, a
 *         buff brick pier grid, a dark blue-grey glazed bay, and a projecting
 *         TERRACOTTA perforated sunscreen over the head of each bay. PR #118 had
 *         the screen as mud (#8a6a55) and the glass as sky blue (#4f86b4) — the
 *         blue is the SKY REFLECTED in the photograph, exactly the trap
 *         docs/PASS_ARTS.md records, and a facade that samples the sky comes out
 *         cyan in a renderer that already draws its own sky.
 *   NHB   Not re-researched this pass. Left as PR #118 shipped it, and said so
 *         rather than nudged.
 *
 * COMPOSITION IS AUTHORED AT LOAD, not baked — `authorEER()` / `authorGDC()`
 * below. `scripts/bake_heroes.py` and `data/heroes.geojson` belong to another
 * lane this round, so this follows the js/union24.js precedent instead: find the
 * features by name, edit them in place, append the new bands, with every
 * dimension carrying the working that produced it. Nothing here is a pattern
 * that tries to place something "at the top" — every band is its own prism with
 * its own base and height, the way js/drag.js does shopfronts.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS. QUEUE F4: *"also add some UT buildings too - some of them
 * look really cool like EER but rn theyre a block. DO those"*. He is right, and
 * the reason is not that nobody modelled them — it is that their HEIGHTS are
 * wrong in the source data in a way that is easy to miss:
 *
 *   EER  8 floors x 2.84 m = 22.7   real: 9 floors, 40.5 m
 *   GDC  6 floors x 2.80 m = 16.8   real: 7 floors, 29.5 m
 *   NHB  6 floors x 2.80 m = 16.8   real: 7 storeys, 32.3 m to the louvre plane
 *
 * A 2.8 m floor is an apartment. These are wet-lab and teaching buildings whose
 * floors measure 4.1-4.7 m. So all three arrive as squat blocks, and no amount of
 * facade work makes a squat block look like a nine-storey building.
 * scripts/bake_heroes.py carries the derivation of every number, with the
 * photograph and the nadir tile each one came off.
 *
 * WHAT IS DRAWN, and it is deliberately little per building — the massing is the
 * whole point and detail below about a metre aliases at the zooms this app flies:
 *
 *   EER   two limestone bars, a glazed canyon between them with a glass roof over
 *         its middle 56 m, and the black steel space-frame LATTICE that closes the
 *         canyon's east end above the entrance. The snapshot footprint also covers
 *         the paved courtyard north of the north bar — there are cars parked on it
 *         in the z20 nadir tile — so this pass makes EER SMALLER in plan.
 *   GDC   two brick bars under a roof plane that oversails them by 2.5 m, joined
 *         by a seven-storey glass atrium standing proud of the brick.
 *   NHB   a limestone base under Acme brick, a four-storey recessed glass volume
 *         in the south face, and the perforated steel louvre plane floating over
 *         the middle 65 m of the roof.
 *
 * FIVE PATTERN IMAGES, and each one earns itself. The shared facade atlas is
 * fourteen colour buckets derived from Austin's building stock and they are
 * almost all tan, so handing it a blue curtain wall gets brick back —
 * docs/PASS_ARTS.md measured exactly that on the Bass lobby. Two of these
 * buildings are substantially glass and the third's identifying feature is a
 * black steel diagrid; none of that survives the atlas.
 *
 * REGISTRATION. Self-booting, like js/arts.js and js/outer.js — js/app.js is
 * owned by another pass and will not call this module. The <script> tag is in
 * BOTH index.html and _harness.html; scripts/verify/harness-drift.mjs is the
 * check that they stay in step.
 *
 * Public (window) API:
 *   initHeroes(map)            — add source + layers (called automatically)
 *   applyHeroColors(map, p)    — retint for time-of-day p (hooked automatically)
 *   HEROES                     — the taste block
 */
(function () {
  'use strict';

  const q = new URLSearchParams(window.location.search);

  // ── ?wallplane=0 — the doors and the GDC atrium back on the footprint ring.
  //    ONE flag for two layers (js/entrances.js declares the same object, first
  //    loader wins), because they are two halves of one change: an entrance
  //    sits on the wall plane its building DRAWS, and GDC's atrium is on that
  //    plane too instead of 2.5 m out at the roof canopy. With it off, both
  //    layers hand back exactly the geometry main ships.
  window.WALLPLANE = window.WALLPLANE || { on: q.get('wallplane') !== '0' };

  const HEROES = {
    // ?heroes=0 removes the pass at load, so a before/after can be measured on
    // ONE build instead of on two checkouts — the shape js/outer.js established.
    on: q.get('heroes') !== '0',
    minZoom: 14,

    // ── EER limestone ────────────────────────────────────────────────────
    // A 64 px tile covers 30-59 m of wall at the zooms this app flies, so nine
    // rows put a floor line every 3.3-6.6 m against a measured 4.65 m. That is
    // the closest a pattern can get: fill-extrusion-pattern has no vertical
    // anchor and its world scale halves at every integer zoom, so the phase
    // drifts and only the RHYTHM survives.
    //
    // THE RHYTHM, corrected. PR #118 read this facade as "a continuous dark
    // ribbon at every floor line" and scattered slots at a flat 34% per bay.
    // Neither survives the photographs. Enlarge the east elevation out of the
    // Cockrell School aerial, or the two end elevations in the Wikimedia frame
    // (`University of Texas at Austin August 2019 17`), and what is there is:
    //   - a CONTINUOUS pale stone plane, no band at the floor line. What reads
    //     as a line at distance is the shadow of the slot heads lining up.
    //   - slots in CLUSTERS: two to four adjacent bays carry one, then three to
    //     six bays of blank stone. That alternation of dense and empty is the
    //     single most legible fact about this wall and a flat 34% erases it.
    //   - slot WIDTHS vary inside a cluster — most are one bay, some are a
    //     double. Uniform primitives are the null hypothesis (CLAUDE.md), and
    //     here the reference disproves them.
    stoneRows: 9,
    stoneCols: 24,       // bays across the tile. 24 not 16: the slots are narrow
                         // and the blank runs are wide, so the alphabet needs
                         // more cells than PR #118's 16 to say "three together,
                         // then five empty" at all.
    stoneJoint: 0.05,    // the floor joint, as a fraction step DOWN from the
                         // field. Was 0.20 and drew a cage. Not a hex:
                         // docs/PASS_ARTS.md's Ransom Center joint went in as a
                         // sampled dark hex and rendered as a black grid over
                         // grey. A value step averages into the field under
                         // minification instead of aliasing into bars.
    stoneRun: [2, 4],    // slots per cluster, inclusive
    stoneGap: [3, 6],    // blank bays between clusters, inclusive
    stoneWide: 0.30,     // share of slots that are a double-width bay
    stoneSlotTall: 0.74, // slot height as a fraction of the floor. The reference
                         // slot is roughly 1:3.5 and runs most of the storey.
    stoneSlotDark: 0.62, // deeper than PR #118's 0.52: these are deep reveals in
                         // thick stone, and against a #efeadd field a 0.52 step
                         // is a grey smudge rather than a window.
    stoneLit: 0.52,      // fraction of those lit after dusk. Measured at 0.30:
                         // EER's night wall came out at mean luma 19 with a p90
                         // of 27, against 18-28 / 17-54 for the four buildings
                         // around it -- inside the range but with almost no
                         // bright pixels, which on a nine-storey research
                         // building reads as unlit rather than as late.

    // ── GDC brick ────────────────────────────────────────────────────────
    // Pelli's facade is a strict horizontal module and PR #118 named it right —
    // it just drew the wrong three materials. Per floor, top to bottom:
    //   a pale CAST-STONE spandrel band, continuous across the whole elevation
    //   and the strongest line on the building; a TERRACOTTA perforated
    //   sunscreen hung over the head of each bay; the glazed bay itself; and
    //   buff brick piers running through all of it on a stack-bond grid.
    // Eight rows over the tile is a 3.8-7.4 m module against a measured 4.10 m
    // floor.
    brickRows: 8,
    brickPier: 8,        // px. The stack-bond pier rhythm, ~4-7 m — a structural
                         // bay, not a brick. A 7 cm brick course drawn here would
                         // come out as a concrete block; same trap as the Bass
                         // mullions.
    brickBandFrac: 0.22,    // the cast-stone spandrel, of each row
    brickScreenFrac: 0.20,  // the terracotta screen, of each row
    brickGlassFrac: 0.40,   // the glazed bay, of each row
    brickLit: 0.34,

    // ── NHB brick ────────────────────────────────────────────────────────
    // Punched square windows in an Acme tan blend, with the angled brick reveal
    // the architects describe. The reveal is one texel on the sunward side of
    // each opening, which is all a 0.4-0.6 m texel can honestly say about it.
    nbRows: 7,
    nbCols: 9,
    nbWindow: 0.42,      // window as a fraction of the cell
    nbLit: 0.28,

    // ── curtain wall ─────────────────────────────────────────────────────
    glassRows: 6,
    glassCols: 8,
    glassMullion: 1,
    glassLit: 0.40,

    // ── the EER lattice ──────────────────────────────────────────────────
    // Five bays across and five levels, which is what the photograph shows: the
    // cage is 21.4 m wide and 21.1 m tall and its panels are square. The members
    // are 2 px, so 0.9-1.8 m — heavier than the real steel, and deliberately: a
    // 1 px diagonal on a minified tile disappears entirely, and this cage IS the
    // building. It is drawn OVER the glass rather than as a transparent overlay
    // so there is no second surface for the depth buffer to argue about.
    cageBays: 5,
    cageMember: 2,
    cageGlassLit: 0.30,

    // ── the pitches every count above is really made of ──────────────────
    //
    // Metres of wall between one row (or bay) and the next. Two of them are
    // MEASURED and are the reason this block exists rather than being a
    // restatement of the counts:
    //
    //   eerFloorM 4.65 -- `eerFloor` below, bake_heroes.py's own number (a
    //       40.5 m parapet over nine floors less a 3.0 m ground-floor overrun).
    //       The authored `stoneRows: 9` puts a floor line every 3.66 m at
    //       HERO_REF_ZOOM, 21 % too close together, and this file's own comment
    //       admitted it ("that is the closest a pattern can get"). It is not --
    //       it was only true while the count was fixed. Seven rows at 4.71 m is.
    //   gdcFloorM 4.10 -- the measured Pelli module named in the GDC comment.
    //       The authored eight rows already land on it at HERO_REF_ZOOM, so GDC
    //       does not move at cruise at all; it stops collapsing as you come in.
    //
    // The rest are DERIVED from the authored counts at HERO_REF_ZOOM, so they
    // reproduce today's tile exactly there. They are honest placeholders for a
    // measurement, not measurements, and they are marked as such.
    eerFloorM: 4.65,                 // MEASURED
    eerBayM: 32.98 / 24,             // derived from stoneCols
    gdcFloorM: 4.10,                 // MEASURED
    gdcBayM: 32.98 / 16,             // derived
    gdcPierM: 32.98 / 8,             // derived from brickPier (8 px of 64)
    nhbFloorM: 32.98 / 7,            // derived from nbRows
    nhbBayM: 32.98 / 9,              // derived from nbCols
    glassFloorM: 32.98 / 6,          // derived from glassRows
    glassBayM: 32.98 / 8,            // derived from glassCols
    // The CAGE is deliberately not anchored. It is one object, not a rhythm --
    // "the cage is 21.4 m wide and 21.1 m tall and its panels are square" -- so
    // a metre pitch would ask for eight panels where the photograph shows five.
    // Anchoring it needs the cage drawn as geometry at its own size, not a
    // count changed in a tile. Written down rather than half-done.

    // ── EER's authored composition, in metres ────────────────────────────
    // Every one of these is applied by authorEER() as its own banded prism.
    // The bars are 80.5 x 22.7 m (north) and 81.0 x 23.2 m (south) with a
    // 21.3 m canyon, read straight off data/heroes.geojson's own rings.
    eerFloor: 4.65,      // m. 40.5 m parapet over nine floors, less a 3.0 m
                         // ground-floor overrun == 4.65. bake_heroes.py's number.
    eerPlinth: 4.60,     // the dark glazed ground-floor recess. The bars now
                         // START here rather than at grade, so the recess is a
                         // real reveal and not a decal on the stone.
    eerPlinthInset: 0.55,// how far the plinth sits back from the stone above it
    eerCrown: 4.65,      // the BLANK stone band under the coping: one full floor
                         // with no openings, which is what both end elevations
                         // show. PR #118 had 3.15 m and painted it the same hex
                         // as the wall, so it did not exist.
    eerRibbon: 4.80,     // width of the glass ribbon that turns each bar's
                         // canyon-side corner onto the end elevation. Measured
                         // off the Wikimedia frame as very close to a quarter of
                         // the 22.7 m end face.
    eerRibbonProud: 0.40,// how far it stands off the end wall. Enough to catch
                         // its own shading; a coplanar face would z-fight.
    eerCurtainTop: 35.85,// the canyon curtain wall runs to the underside of the
                         // crown, not to 28.8 m. Ennead's own atrium photographs
                         // show glass continuing above the atrium roof.
    eerPent: [12.0, 7.0, 3.4],  // mechanical penthouse L x W x H. One per bar,
                         // plainly visible in the aerial, and the thing that
                         // stops a 80 x 23 m roof reading as a lid.
  };
  window.HEROES = HEROES;

  /**
   * Every hex on these buildings, and where it came from.
   *
   * THE CHECK EACH ONE HAD TO PASS. `data/facade_palette.json` elects fourteen
   * tones for the whole city; the two palest are **#e3dac8** (luma 219) and
   * **#d9d5c8** (213). PR #118's EER limestone was #e2dacb, which is bucket 5
   * to within three counts on one channel — an "own colour" that is literally
   * one of the fourteen. So each hex below is quoted with its luma and its R-B
   * (red minus blue, the plainest one-number reading of how warm a tone is),
   * and every one of them is outside the fourteen on at least one of those.
   *
   * The city's tans run R-B 35..82. A limestone at R-B 12 cannot be mistaken for
   * one of them even where the luma overlaps, and THAT is the separation this
   * pass is buying — the renderer's own warm daylight adds about +45 R-B to
   * everything on screen, so hue survives where absolute brightness cannot.
   */
  const PALETTE = {
    // EER. Sampled off `University of Texas at Austin August 2019 17` (Wikimedia
    // Commons, CC), an OVERCAST frame — which is the useful kind, because a
    // clear-sky shot of a pale building is 40% sky. Limestone read #bab0a0 at a
    // sky of #c9d1dc; the tan-brick tower in the same frame read #88725f. The
    // ratio EER:neighbour is **1.50 in luma and 0.63 in R-B**, and the ratio is
    // the transferable part — the absolute values belong to that grey morning.
    eerStone:  '#efeadd',   // luma 236, R-B 18. Brighter than any of the fourteen
                            // and half the warmth of the palest.
    eerCrown:  '#e9e3d4',   // the blank band reads a shade deeper than the
                            // punched field in every photograph, because there
                            // are no slot highlights in it.
    eerCoping: '#b9bcbc',   // luma 187, R-B -3. Pale metal, faintly COOL. The
                            // one place EER goes to the cold side of neutral and
                            // the reason its parapet line reads at all.
    eerPlinth: '#4d5157',   // the ground-floor recess: dark glass in shadow.
    eerGlass:  '#6a7a86',   // the canyon curtain wall and the atrium's glass
                            // roof — both seen from OUTSIDE the canyon, i.e.
                            // into shade, so they are the dark glass.
    // The corner ribbons are the opposite case and getting them wrong was the
    // first thing this pass had to correct on itself: they were shipped at
    // #5f7080 and rendered at luma 82 against limestone at 163, a ratio of
    // 0.50. In the photograph the ribbon is #9ca9b4 against #bab0a0 stone —
    // a ratio of **0.94**. These face OUT and carry the sky, so they are nearly
    // as bright as the stone, and at 0.50 they read as two black bookends
    // clamping each tower.
    eerGlassP: '#a3b0ba',
    eerSteel:  '#2b2e31',   // the space frame. #3e4143 in the photograph and
                            // that is WITH the sky behind it; the members
                            // themselves are near-black.
    eerCageBg: '#7b8894',   // what shows through the frame: the glazed canyon
                            // end, not sky. PR #118 had #4d81ad here and the
                            // whole cage read as one blue panel.
    eerPent:   '#9b9c99',   // the roof penthouses, grey metal.

    // GDC. Sampled off `Gates-Dell Complex - UT Austin (54984937843)`, a
    // clear-sky frame, k-means over a 450 x 440 px patch of the sunlit south
    // elevation: 25.4% #f8e2c8 (cast stone + lit brick), 27.2% #7c6051 (shaded
    // brick and screen), 18.6% #4c2e1f (screen shadow), 15.0% #487fc0 (glass),
    // 13.8% #c4a48c (mid brick). The 15% blue is SKY IN THE GLASS and is the
    // one cluster that must not be believed.
    gdcBrick:  '#cdac85',   // luma 175, R-B 72. Warmer than any of the fourteen
                            // — UT's buff brick really is this orange next to
                            // limestone — but pulled back from a first cut at
                            // #cfa877 / R-B 88, which the renderer's own warm
                            // daylight then pushed to R-B 130 and GDC came out
                            // the colour of a traffic cone. The photograph's
                            // sunlit brick is #e1bea1 (R-B 64) and its mid tone
                            // #c4a48c (56); a hex that already carries the sun's
                            // warmth gets it applied twice.
    gdcStone:  '#eee5d2',   // the cast-stone spandrel. Luma 228, R-B 24.
    gdcScreen: '#9a5c3e',   // the terracotta perforated sunscreen.
    gdcGlass:  '#42566d',   // luma 84, R-B -19. Dark blue-GREY, not sky blue.
    gdcFascia: '#e4ddcd',   // the oversailing roof plane's edge. The brightest
                            // thing on the building and the reason it reads as a
                            // plane floating over the brick.
    gdcBase:   '#a49f95',   // the cast-stone ground storey. PR #118 had #6b5b4e,
                            // a mud brown that made GDC look like it was sinking.
  };
  window.HEROES_PALETTE = PALETTE;

  const SRC = 'austin-heroes';
  const DATA = 'data/heroes.geojson';
  const L = {
    solid: 'heroes-solid', lime: 'heroes-lime', brick: 'heroes-brick',
    nbrick: 'heroes-nbrick', glass: 'heroes-glass', glassb: 'heroes-glassb',
    glassc: 'heroes-glassc', lattice: 'heroes-lattice', cap: 'heroes-cap',
  };
  const IMG = {
    lime: 'heroes-img-lime', brick: 'heroes-img-brick', nbrick: 'heroes-img-nbrick',
    glass: 'heroes-img-glass', glassb: 'heroes-img-glassb', glassc: 'heroes-img-glassc',
    lattice: 'heroes-img-lattice',
  };

  /** ['interpolate', p, day, golden, night] — the shape js/timeofday.js bakes with. */
  function tod(p, d, g, n) {
    p = Math.max(0, Math.min(1, p));
    return ['interpolate', ['linear'], p,
      0, ['to-color', ['get', d], '#888888'],
      0.5, ['to-color', ['get', g], '#888888'],
      1, ['to-color', ['get', n], '#333344'],
    ];
  }
  const wallColor = p => tod(p, 'wd', 'wg', 'wn');
  const capColor = p => tod(p, 'rd', 'rg', 'rn');

  // ── tiles ───────────────────────────────────────────────────────────
  function hexToRgb(h) {
    return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  }
  function mix(a, b, t) { return a.map((v, i) => v + (b[i] - v) * t); }

  /** The same day -> golden -> night ramp scripts/bake_heroes.py bakes into wd/wg/wn. */
  function ramp(day, golden, night, p) {
    return p <= 0.5 ? mix(day, golden, p / 0.5) : mix(golden, night, (p - 0.5) / 0.5);
  }
  /** wall_ramp() from the bake, so a tile and its building's flat bands agree. */
  function rampOf(hex, p) {
    const c = hexToRgb(hex);
    const g = mix(c, [255, 190, 130], 0.16);
    const n = mix(c.map(v => v * 0.19), [18, 22, 40], 0.42);
    return ramp(c, g, n, p);
  }

  // Deterministic 0..1 — a per-cell scatter has to be stable across repaints or
  // the wall shimmers on every time-of-day tick. Copied from js/arts.js.
  function hash01(a, b) {
    let x = (a * 374761393 + b * 668265263) | 0;
    x = (x ^ (x >> 13)) * 1274126177;
    return ((x ^ (x >> 16)) >>> 0) / 4294967295;
  }

  // ══════════════════════════════════════════════════════════════════
  //  THESE TILES ARE ANCHORED IN METRES TOO
  // ══════════════════════════════════════════════════════════════════
  //
  // Same defect js/facades.js's own header spends four hundred words on, and
  // this file's EER comment already names it: "fill-extrusion-pattern has no
  // vertical anchor and its world scale halves at every integer zoom". These
  // seven tiles are registered with no `pixelRatio`, so displaySize is T and one
  // repeat covers `T * 67551 / 2^tileZoom` metres of wall -- 32.98 m at z17,
  // and 1.03 m by z22. EER's nine rows are a 3.7 m floor at z17 and a 12 cm
  // floor at walking height.
  //
  // So every count below is derived from a PITCH IN METRES against the repeat
  // the camera is drawing at, exactly as js/facades.js now does, and the tiles
  // are redrawn when the anchor moves. It reads the anchor off facades.js
  // (`window.facadeZoomAnchor`) rather than keeping a second one, so the two
  // passes cannot drift apart about what zoom the city is at.
  //
  // HERO_REF_ZOOM is 17 and not 16 because these tiles are pixelRatio 1 where
  // the facade atlas is pixelRatio 2: displaySize T at z17 is the same 32.98 m
  // of wall as the atlas's displaySize 32 at z16. Every authored count in
  // HEROES is a count AT THAT ZOOM, and clamping the anchor there means this
  // can only ever coarsen a wall, never densify one.
  const T = 64;
  const HERO_REF_ZOOM = 17;
  const heroRepeatM = z => T * 67551 / Math.pow(2, z);
  const HERO_REF_M = heroRepeatM(HERO_REF_ZOOM);         // 32.98 m
  function heroAnchorZoom() {
    let z = HERO_REF_ZOOM;
    try { if (typeof window.facadeZoomAnchor === 'function') z = window.facadeZoomAnchor(); } catch (e) {}
    return Math.max(HERO_REF_ZOOM, isFinite(z) ? z : HERO_REF_ZOOM);
  }
  const heroRepeatNowM = () => heroRepeatM(heroAnchorZoom());
  /**
   * Rows (or bays) for a metre pitch, at the anchor, never denser than the
   * count this file authored at HERO_REF_ZOOM.
   */
  const countFor = (pitchM, authored) =>
    Math.max(1, Math.min(authored, Math.round(heroRepeatNowM() / pitchM)));
  window.heroesAnchor = () => ({ zoom: heroAnchorZoom(), repeatM: +heroRepeatNowM().toFixed(2) });

  let _ctx = null;
  function ctx2d() {
    if (!_ctx) {
      const c = document.createElement('canvas');
      c.width = c.height = T;
      // willReadFrequently: this canvas is read back with getImageData on every
      // quantised time-of-day tick and never composited from a GPU surface.
      _ctx = c.getContext('2d', { willReadFrequently: true });
    }
    return _ctx;
  }
  const css = v => `rgb(${v.map(x => Math.round(Math.max(0, Math.min(255, x)))).join(',')})`;
  function grab(ctx) {
    const img = ctx.getImageData(0, 0, T, T);
    return { width: T, height: T, data: new Uint8Array(img.data.buffer.slice(0)) };
  }
  /** 0 before dusk, 1 at full night. Same threshold js/arts.js uses. */
  const nightAt = p => Math.max(0, (p - 0.62) / 0.38);

  /**
   * The CLUSTER walk. Deterministic per row: emit runs of `stoneRun` slots
   * separated by gaps of `stoneGap` blank bays, starting at a phase that differs
   * per row so the wall does not turn into columns.
   *
   * This is the whole correction to PR #118's facade and it is worth being
   * explicit about why a probability was not enough: an independent 34% coin per
   * bay produces a Poisson scatter, and a Poisson scatter has no wide blanks in
   * it — the longest empty run in 24 bays at p=0.34 is about three, where the
   * photograph regularly shows six. Clusters and blanks are a RULE, not a
   * density, so the generator has to walk them.
   */
  function stoneSlotsFor(row, C) {
    const out = [];
    const pick = (r, k, i) => r[0] + Math.floor(hash01(row * 31 + i, k) * (r[1] - r[0] + 1));
    let c = Math.floor(hash01(row + 71, 5) * HEROES.stoneGap[1]);
    for (let i = 0; c < C && i < 40; i++) {
      const run = pick(HEROES.stoneRun, 3, i);
      for (let k = 0; k < run && c < C; k++, c++) {
        out.push({ c, wide: hash01(row + 13, c + 2) < HEROES.stoneWide });
      }
      c += pick(HEROES.stoneGap, 9, i);
    }
    return out;
  }

  /** EER: a continuous pale limestone plane, clustered narrow slot windows. */
  function limeTile(p) {
    const ctx = ctx2d();
    const base = rampOf(PALETTE.eerStone, p);
    const lit = hexToRgb('#f0d9a2');
    const night = nightAt(p);
    ctx.fillStyle = css(base);
    ctx.fillRect(0, 0, T, T);

    const R = countFor(HEROES.eerFloorM, HEROES.stoneRows), step = T / R;
    const C = countFor(HEROES.eerBayM, HEROES.stoneCols), bay = T / C;
    const sh = Math.max(2, Math.round(step * HEROES.stoneSlotTall));
    for (let r = 0; r < R; r++) {
      const y0 = Math.round(r * step);
      // The joint first, so a slot that meets it wins — in the reference the
      // reveal is deeper than the joint and cuts through it.
      ctx.fillStyle = css(mix(base, [0, 0, 0], HEROES.stoneJoint));
      ctx.fillRect(0, y0, T, 1);
      const ys = y0 + Math.max(1, Math.round((step - sh) / 2));
      for (const s of stoneSlotsFor(r, C)) {
        const w = Math.max(1, Math.round(bay * (s.wide ? 0.62 : 0.34)));
        const x = Math.round(s.c * bay + (bay - w) / 2);
        let v = mix(base, [0, 0, 0], HEROES.stoneSlotDark);
        if (night > 0 && hash01(s.c + 7, r + 13) < HEROES.stoneLit) {
          v = mix(v, lit, night * 0.88);
        }
        ctx.fillStyle = css(v);
        ctx.fillRect(x, ys, w, sh);
      }
    }
    return grab(ctx);
  }

  /** GDC: cast-stone spandrel / terracotta screen / glazed bay, per floor. */
  function brickTile(p) {
    const ctx = ctx2d();
    const brick = rampOf(PALETTE.gdcBrick, p);
    const stone = rampOf(PALETTE.gdcStone, p);
    const screen = rampOf(PALETTE.gdcScreen, p);
    const glass = rampOf(PALETTE.gdcGlass, p);
    const lit = hexToRgb('#efd49c');
    const night = nightAt(p);
    ctx.fillStyle = css(brick);
    ctx.fillRect(0, 0, T, T);

    const R = countFor(HEROES.gdcFloorM, HEROES.brickRows), step = T / R;
    const BAYS = countFor(HEROES.gdcBayM, 16);
    const PIER = Math.max(2, Math.round(T / countFor(HEROES.gdcPierM, T / HEROES.brickPier)));
    const bh = Math.max(1, Math.round(step * HEROES.brickBandFrac));
    const sh = Math.max(1, Math.round(step * HEROES.brickScreenFrac));
    const gh = Math.max(1, Math.round(step * HEROES.brickGlassFrac));
    for (let r = 0; r < R; r++) {
      const y0 = Math.round(r * step);
      // 1. the cast-stone spandrel — continuous, edge to edge, the strongest
      //    horizontal on the building.
      ctx.fillStyle = css(stone);
      ctx.fillRect(0, y0, T, bh);
      // 2. the terracotta screen, hung over the head of every bay. It stops
      //    short of each pier, which is what makes it read as a hung panel
      //    rather than as a second spandrel.
      for (let c = 0; c < BAYS; c++) {
        ctx.fillStyle = css(screen);
        ctx.fillRect(Math.round(c * T / BAYS) + 1, y0 + bh, Math.max(1, Math.round(T / BAYS) - 2), sh);
      }
      // 3. the glazed bay under it
      for (let c = 0; c < BAYS; c++) {
        let v = glass;
        if (night > 0 && hash01(c + 4, r + 9) < HEROES.brickLit) v = mix(v, lit, night * 0.70);
        ctx.fillStyle = css(v);
        ctx.fillRect(Math.round(c * T / BAYS) + 1, y0 + bh + sh, Math.max(1, Math.round(T / BAYS) - 2), gh);
      }
    }
    // The stack-bond piers: a brick vertical every structural bay, drawn over
    // the glass and the screen but UNDER nothing — in the photograph the piers
    // run unbroken from the base to the roof plane and everything else is
    // infill between them.
    ctx.fillStyle = css(brick);
    for (let x = 0; x < T; x += PIER) ctx.fillRect(x, 0, 2, T);
    ctx.fillStyle = css(mix(brick, [255, 255, 255], 0.14));
    for (let x = 0; x < T; x += PIER) ctx.fillRect(x, 0, 1, T);
    return grab(ctx);
  }

  /** NHB: Acme tan brick with punched square windows and an angled reveal. */
  function nbrickTile(p) {
    const ctx = ctx2d();
    const brick = rampOf('#c9a37c', p);
    const glass = rampOf('#3d5f7e', p);
    const lit = hexToRgb('#f0d69c');
    const night = nightAt(p);
    ctx.fillStyle = css(brick);
    ctx.fillRect(0, 0, T, T);

    const R = countFor(HEROES.nhbFloorM, HEROES.nbRows);
    const C = countFor(HEROES.nhbBayM, HEROES.nbCols);
    const sx = T / C, sy = T / R;
    const ww = Math.max(1, Math.round(sx * HEROES.nbWindow));
    const wh = Math.max(1, Math.round(sy * HEROES.nbWindow));
    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C; c++) {
        const x = Math.round(c * sx + (sx - ww) / 2);
        const y = Math.round(r * sy + (sy - wh) / 2);
        let v = glass;
        if (night > 0 && hash01(c + 6, r + 2) < HEROES.nbLit) v = mix(v, lit, night * 0.74);
        ctx.fillStyle = css(v);
        ctx.fillRect(x, y, ww, wh);
        // the angled brick reveal — one texel, on one side, catching light
        ctx.fillStyle = css(mix(brick, [255, 255, 255], 0.16));
        ctx.fillRect(x - 1, y, 1, wh);
      }
    }
    return grab(ctx);
  }

  function glassTileOf(dayHex, litHex) {
    return function (p) {
      const ctx = ctx2d();
      const glass = rampOf(dayHex, p);
      const frame = rampOf('#cfd4d6', p);
      const lit = hexToRgb(litHex);
      const night = nightAt(p);
      ctx.fillStyle = css(frame);
      ctx.fillRect(0, 0, T, T);
      const R = countFor(HEROES.glassFloorM, HEROES.glassRows);
      const C = countFor(HEROES.glassBayM, HEROES.glassCols);
      const M = HEROES.glassMullion;
      const sx = T / C, sy = T / R;
      for (let r = 0; r < R; r++) {
        for (let c = 0; c < C; c++) {
          let v = mix(glass, [255, 255, 255], 0.05 * hash01(r + 2, c + 5));
          if (night > 0 && hash01(c + 11, r + 4) < HEROES.glassLit) v = mix(v, lit, night * 0.62);
          ctx.fillStyle = css(v);
          ctx.fillRect(Math.round(c * sx) + M, Math.round(r * sy) + M,
                       Math.round(sx) - M, Math.round(sy) - M);
        }
      }
      return grab(ctx);
    };
  }

  /** EER's space frame: X-braced steel over the atrium's glass. */
  function latticeTile(p) {
    const ctx = ctx2d();
    const glass = rampOf(PALETTE.eerCageBg, p);
    const steel = rampOf(PALETTE.eerSteel, p);
    const lit = hexToRgb('#e8d3a0');
    const night = nightAt(p);
    const B = HEROES.cageBays, M = HEROES.cageMember, step = T / B;

    ctx.fillStyle = css(glass);
    ctx.fillRect(0, 0, T, T);
    if (night > 0) {
      for (let r = 0; r < B; r++) {
        for (let c = 0; c < B; c++) {
          if (hash01(r + 8, c + 1) > HEROES.cageGlassLit) continue;
          ctx.fillStyle = css(mix(glass, lit, night * 0.66));
          ctx.fillRect(Math.round(c * step), Math.round(r * step),
                       Math.round(step), Math.round(step));
        }
      }
    }
    ctx.strokeStyle = css(steel);
    ctx.lineWidth = M;
    ctx.beginPath();
    for (let i = 0; i <= B; i++) {
      const t = Math.round(i * step);
      ctx.moveTo(0, t + 0.5); ctx.lineTo(T, t + 0.5);
      ctx.moveTo(t + 0.5, 0); ctx.lineTo(t + 0.5, T);
    }
    for (let r = 0; r < B; r++) {
      for (let c = 0; c < B; c++) {
        const x = c * step, y = r * step;
        ctx.moveTo(x, y); ctx.lineTo(x + step, y + step);
        ctx.moveTo(x + step, y); ctx.lineTo(x, y + step);
      }
    }
    ctx.stroke();
    return grab(ctx);
  }

  const TILES = {
    [IMG.lime]: limeTile,
    [IMG.brick]: brickTile,
    [IMG.nbrick]: nbrickTile,
    // THREE curtain walls, not two, and the third earns itself: a dark recess
    // (glassb, GDC's atrium and NHB's inset volume) and a bright outward-facing
    // ribbon (glassc, EER's corners) are the SAME material at opposite ends of
    // its range, and one image cannot be both without one of them being wrong.
    [IMG.glass]: glassTileOf(PALETTE.eerGlass, '#efd49c'),
    [IMG.glassb]: glassTileOf(PALETTE.gdcGlass, '#eadfae'),
    [IMG.glassc]: glassTileOf(PALETTE.eerGlassP, '#f2e2b4'),
    [IMG.lattice]: latticeTile,
  };

  function ensureImages(map, p) {
    for (const id of Object.keys(TILES)) {
      try {
        if (map.hasImage && map.hasImage(id)) map.updateImage(id, TILES[id](p));
        else map.addImage(id, TILES[id](p));
      } catch (e) { /* already registered, or the canvas is gone */ }
    }
  }

  /**
   * ?wallplane=0. Every feature the bake moved carries `wp0` — its whole
   * pre-fix ring, not an offset, because the atrium changed SHAPE as well as
   * position (it grew in v to reach the brick flanks the oversail pushed
   * apart). Swapping the ring back is therefore exact.
   */
  function restoreWallPlane(gj) {
    let n = 0;
    for (const f of gj.features || []) {
      const r = f.properties && f.properties.wp0;
      if (!r || !f.geometry || f.geometry.type !== 'Polygon') continue;
      f.geometry.coordinates = [r];
      n++;
    }
    return n;
  }

  async function getJSON(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(url + ': ' + r.status);
    return await r.json();
  }

  // ── authored composition ────────────────────────────────────────────
  // scripts/bake_heroes.py and data/heroes.geojson are another lane's files this
  // round, so the composition is applied to the fetched FeatureCollection the
  // way js/union24.js applies the H-plan to Union on 24th: find the features,
  // edit them in place, append the new bands. Every dimension comes from
  // HEROES above and every hex from PALETTE, so any of it is a one-line
  // override (CLAUDE.md rule 11).

  const rgbToHex = c => '#' + c.map(v => Math.round(Math.max(0, Math.min(255, v)))
    .toString(16).padStart(2, '0')).join('');

  /**
   * Stamp wd/wg/wn from one hex, using the bake's own wall_ramp so an authored
   * band and a baked one bend the same way from noon to midnight. Copying the
   * ramp rather than inventing one is the point: a band whose golden hour is
   * 6% warmer than the wall beside it shows up as a seam at exactly the hour
   * Simeon screenshots.
   */
  function paint(props, hex, roofToo) {
    const c = hexToRgb(hex);
    props.wd = hex;
    props.wg = rgbToHex(mix(c, [255, 190, 130], 0.16));
    props.wn = rgbToHex(mix(c.map(v => v * 0.19), [18, 22, 40], 0.42));
    if (roofToo) { props.rd = props.wd; props.rg = props.wg; props.rn = props.wn; }
    return props;
  }

  const M_PER_DEG_LAT = 111320;

  /**
   * A metre frame on a rotated rectangle's own ring: u along its long edge from
   * corner 0, v along its short edge. Everything EER adds is expressed in this
   * frame, because the bars sit 5.4 degrees off east and hand-writing rotated
   * lng/lat is how a band ends up 0.4 m inside a wall.
   */
  function frameOf(ring) {
    const O = ring[0];
    const kx = Math.cos(O[1] * Math.PI / 180) * M_PER_DEG_LAT, ky = M_PER_DEG_LAT;
    const to = q => [(q[0] - O[0]) * kx, (q[1] - O[1]) * ky];
    const a = to(ring[1]), b = to(ring[3]);
    const Lu = Math.hypot(a[0], a[1]), Lv = Math.hypot(b[0], b[1]);
    const U = [a[0] / Lu, a[1] / Lu], V = [b[0] / Lv, b[1] / Lv];
    const at = (u, v) => [O[0] + (U[0] * u + V[0] * v) / kx, O[1] + (U[1] * u + V[1] * v) / ky];
    return {
      Lu, Lv, at,
      centre: at(Lu / 2, Lv / 2),
      rect: (u0, v0, u1, v1) =>
        [[at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1), at(u0, v0)]],
    };
  }

  const band = (ring, props) => ({ type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: ring } });

  /**
   * EER. Two limestone bars, and this adds the four things that separate the
   * photograph from a pair of punched boxes:
   *
   *   1. the ground floor is a DARK GLAZED RECESS, so the stone starts at 4.6 m
   *      and a real 0.55 m reveal runs round the base;
   *   2. a BLANK stone band one full floor tall under a pale metal coping —
   *      PR #118 had 3.15 m of it in the same hex as the wall, i.e. nothing;
   *   3. the canyon faces are full-height CURTAIN WALL, 80 m of it per bar
   *      rather than 56 m stopping at 28.8, and a glass RIBBON turns each bar's
   *      canyon-side corner onto the end elevation — which is the thing you
   *      actually see from the end of the canyon, and the pose this pass is
   *      photographed from;
   *   4. a mechanical PENTHOUSE on each roof.
   */
  function authorEER(gj) {
    const bars = gj.features.filter(f => f.properties.b === 'eer' && f.properties.lyr === 'lime');
    const crowns = gj.features.filter(f => f.properties.b === 'eer' && f.properties.lyr === 'solid'
                                        && f.properties.cap === 1);
    if (bars.length !== 2 || crowns.length !== 2) return 'eer bars not found (' + bars.length + '/' + crowns.length + ')';

    // The parapet is the crown band's own top — read it, never re-derive it, so
    // a height change in the bake cannot silently strand this composition.
    const H = crowns[0].properties.h;                                    // 40.5 m
    const stoneTop = H - HEROES.eerCrown;
    const frames = bars.map(f => frameOf(f.geometry.coordinates[0]));
    const add = [];

    bars.forEach((f, i) => {
      const fr = frames[i], other = frames[1 - i].centre;
      // Which of the two long edges faces the canyon? Whichever is nearer the
      // OTHER bar's centre. Reading it off the geometry beats assuming the ring
      // winds the same way on both — it does not.
      const d0 = Math.hypot(fr.at(fr.Lu / 2, 0)[0] - other[0], fr.at(fr.Lu / 2, 0)[1] - other[1]);
      const d1 = Math.hypot(fr.at(fr.Lu / 2, fr.Lv)[0] - other[0], fr.at(fr.Lu / 2, fr.Lv)[1] - other[1]);
      const inner = d0 < d1 ? 0 : fr.Lv;                 // v of the canyon face
      const sgn = inner === 0 ? 1 : -1;                  // +v points into the bar

      // 1. the stone starts above the plinth; 2. the crown band gets its floor
      f.properties.base = HEROES.eerPlinth;
      f.properties.h = stoneTop;
      paint(f.properties, PALETTE.eerStone);
      const cr = crowns[i].properties;
      cr.base = stoneTop; cr.h = H;
      // The band is stone; the COPING is a pale metal lip and js/app.js's shared
      // CAP_GEOM draws it at h off rd/rg/rn, so the two are set independently.
      paint(cr, PALETTE.eerCoping, true);
      paint(cr, PALETTE.eerCrown);

      // the dark glazed plinth, inset all round
      const P = HEROES.eerPlinthInset;
      add.push(band(fr.rect(P, P, fr.Lu - P, fr.Lv - P),
        paint({ b: 'eer', lyr: 'solid', base: 0, h: HEROES.eerPlinth, cap: 0 }, PALETTE.eerPlinth)));

      // the canyon curtain wall: a 0.7 m slab standing inside the canyon face,
      // the bar's whole length, plinth to crown
      const t = 0.70;
      add.push(band(fr.rect(0, inner, fr.Lu, inner + sgn * t),
        paint({ b: 'eer', lyr: 'glass', base: HEROES.eerPlinth, h: HEROES.eerCurtainTop, cap: 0 }, PALETTE.eerGlass)));

      // the two corner ribbons, one at each end, on the canyon side
      const W = HEROES.eerRibbon, D = HEROES.eerRibbonProud;
      for (const [u0, u1] of [[-D, 0], [fr.Lu, fr.Lu + D]]) {
        add.push(band(fr.rect(u0, inner, u1, inner + sgn * W),
          paint({ b: 'eer', lyr: 'glassc', base: HEROES.eerPlinth, h: stoneTop, cap: 0 }, PALETTE.eerGlassP)));
      }

      // the mechanical penthouse — offset the two so the roofline is not a
      // mirror, which is what the aerial shows
      const [pl, pw, ph] = HEROES.eerPent;
      const cu = fr.Lu * (i === 0 ? 0.34 : 0.63), cv = fr.Lv * 0.52;
      add.push(band(fr.rect(cu - pl / 2, cv - pw / 2, cu + pl / 2, cv + pw / 2),
        paint({ b: 'eer', lyr: 'solid', base: H, h: H + ph, cap: 0 }, PALETTE.eerPent)));
    });

    // The old 56 m half-height canyon slabs are superseded by the full-height
    // curtain wall above. Dropping them rather than leaving them inside is not
    // tidiness: two coplanar glass faces 0.0 m apart is a depth-buffer fight and
    // it flickers as the camera moves.
    gj.features = gj.features.filter(f => !(f.properties.b === 'eer' && f.properties.lyr === 'glass'
                                            && f.properties.base === 0 && f.properties.h === 28.8));
    gj.features.push(...add);
    return 'eer +' + add.length + ' bands, stone ' + HEROES.eerPlinth + '-' + stoneTop
         + ', crown ' + stoneTop + '-' + H;
  }

  /**
   * GDC. The massing was already right — two brick bars under a roof plane that
   * oversails by 2.5 m. What was wrong was that the plane was painted almost the
   * same colour as the brick and the ground storey was painted mud, so the one
   * gesture the building is known for did not read. Three recolours, no geometry.
   */
  function authorGDC(gj) {
    let n = 0;
    for (const f of gj.features) {
      const p = f.properties;
      if (p.b !== 'gdc') continue;
      if (p.cap === 1) { paint(p, PALETTE.gdcFascia, true); n++; }        // the roof plane
      else if (p.lyr === 'solid' && p.base === 0) { paint(p, PALETTE.gdcBase); n++; }
      else if (p.lyr === 'glass') { p.lyr = 'glassb'; paint(p, PALETTE.gdcGlass); n++; }  // the atrium
    }
    return 'gdc ' + n + ' bands repainted';
  }

  /**
   * Teach the flight controls that these three are 8-18 m taller than the
   * snapshot says.
   *
   * js/controls.js rasterises its collision grid from `scene.buildings`
   * (final_height) and `scene.parts` (h) ONCE at init, and this pass never edits
   * the snapshot — so without this you fly through the top 17.8 m of EER, which
   * is precisely the defect docs/PASS_WESTCAMPUS.md refused to ship on The
   * Standard. `__flyRebuildCollision` takes any scene-shaped object and stamps a
   * MAX per cell, so handing it the real buildings plus these volumes as
   * parts-shaped features raises exactly the cells under them and nothing else.
   */
  function extendCollision(map, gj) {
    if (typeof window.__flyRebuildCollision !== 'function') return 'no collision api';
    const pick = id => {
      const s = map.getSource(id);
      if (!s) return null;
      // In this MapLibre build `_data` is sometimes a wrapper WITHOUT `.features`
      // — the same measurement js/night.js records. Take whichever candidate
      // actually carries geometry.
      return [s._data, s.serialize && s.serialize().data]
        .find(d => d && typeof d !== 'string' && d.features && d.features.length) || null;
    };
    const buildings = pick('austin-buildings');
    if (!buildings) return 'no buildings source';
    const parts = pick('austin-parts');
    const extra = gj.features.map(f => ({
      type: 'Feature', geometry: f.geometry, properties: { h: f.properties.h },
    }));
    window.__flyRebuildCollision({
      buildings,
      parts: { type: 'FeatureCollection', features: ((parts && parts.features) || []).concat(extra) },
    });
    return 'rebuilt with ' + extra.length + ' hero volumes';
  }

  let _added = false;

  window.initHeroes = async function initHeroes(map) {
    if (!HEROES.on || _added || map.getSource(SRC)) return;
    _added = true;

    let gj;
    try {
      gj = await getJSON(DATA);
    } catch (e) {
      console.warn('[heroes]', e.message, '- buildings left as baked');
      return;
    }

    if (!window.WALLPLANE.on) restoreWallPlane(gj);

    // Compose BEFORE the source is added — MapLibre copies the data in, so an
    // edit after addSource needs a setData round trip and a tile rebuild.
    let composed = 'off';
    try {
      composed = authorEER(gj) + ' | ' + authorGDC(gj);
    } catch (e) {
      // A composition that throws must not take the buildings down with it.
      console.warn('[heroes] composition failed, bands left as baked:', e.message);
      composed = 'FAILED ' + e.message;
    }

    const p = (window.__todCurrentP != null) ? window.__todCurrentP : 0.3;
    // Every image must exist BEFORE any layer references it, or MapLibre logs
    // "image not found" and paints those walls transparent.
    ensureImages(map, p);

    map.addSource(SRC, { type: 'geojson', data: gj, ...(window.PATTERN_TILING || {}) });

    // The generic extrusions these bands supersede have to STOP being drawn, or
    // the old 22.7 m box sits inside the new 40.5 m one and its roof cap cuts a
    // bright line across the wall. Same mechanism js/arts.js and js/app.js use.
    const gone = gj.replacedBuildingIds || [];
    if (gone.length) {
      const notReplaced = ['!', ['in', ['get', 'id'], ['literal', gone]]];
      for (const id of ['buildings-3d', 'buildings-roof']) {
        if (!map.getLayer(id)) continue;
        const f = map.getFilter(id);
        try { map.setFilter(id, f ? ['all', f, notReplaced] : notReplaced); } catch (e) {}
      }
    }

    // The anchor must be the first symbol layer AFTER our buildings, not the
    // first in the style — the basemap puts symbol layers immediately after
    // `background`, and anchoring there drops the whole pass under the ground.
    const stack = map.getStyle().layers;
    const after = Math.max(0, stack.findIndex(l => l.id === 'buildings-3d'));
    const anchor = (stack.slice(after + 1).find(l => l.type === 'symbol') || {}).id;

    const geom = { 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-base': ['get', 'base'] };
    const add = (id, lyr, paint) => map.addLayer({
      id, type: 'fill-extrusion', source: SRC, minzoom: HEROES.minZoom,
      filter: ['==', ['get', 'lyr'], lyr],
      paint: Object.assign({}, geom, paint, {
        'fill-extrusion-opacity': 1.0,
        // OFF everywhere in this pass. The gradient darkens the bottom of EACH
        // extrusion and these are stacks of two to four, so it draws a dark seam
        // at every band boundary — on GDC that is a black line right under the
        // roof plane, which is the one edge the building is known for.
        'fill-extrusion-vertical-gradient': false,
      }),
    }, anchor);

    add(L.solid, 'solid', { 'fill-extrusion-color': wallColor(p) });
    add(L.lime, 'lime', { 'fill-extrusion-pattern': IMG.lime });
    add(L.brick, 'brick', { 'fill-extrusion-pattern': IMG.brick });
    add(L.nbrick, 'nbrick', { 'fill-extrusion-pattern': IMG.nbrick });
    add(L.glass, 'glass', { 'fill-extrusion-pattern': IMG.glass });
    add(L.glassb, 'glassb', { 'fill-extrusion-pattern': IMG.glassb });
    add(L.glassc, 'glassc', { 'fill-extrusion-pattern': IMG.glassc });
    add(L.lattice, 'lattice', { 'fill-extrusion-pattern': IMG.lattice });

    // The parapet lip, following app.js's shared CAP_GEOM rule so this pass
    // cannot drift from every other roof in the scene. Only the topmost band of
    // each building carries cap=1.
    const G = window.CAP_GEOM;
    if (G) {
      map.addLayer({
        id: L.cap, type: 'fill-extrusion', source: SRC, minzoom: HEROES.minZoom,
        filter: ['==', ['get', 'cap'], 1],
        paint: {
          'fill-extrusion-color': capColor(p),
          'fill-extrusion-height': G.height(['get', 'h']),
          'fill-extrusion-base': G.base(['get', 'h']),
          'fill-extrusion-opacity': 1.0,
        },
      }, anchor);
    }

    const col = extendCollision(map, gj);
    window.__heroes = { features: gj.features.length, replaced: gone.length,
                        heights: gj.heroHeights || {}, collision: col, composed };
    console.log('[heroes]', gj.features.length, 'band features over', gone.length,
                'replaced buildings; collision', col, '; composed', composed);
  };

  // js/timeofday.js quantises p to 1/128 and skips its expensive path between
  // ticks. A module that wraps applyTimeOfDay does NOT inherit that decision, so
  // the same quantisation is repeated here — six 64 px canvases redrawn and
  // re-uploaded at 60 fps would be 360 texture uploads a second for a colour
  // change nobody can see.
  let _lastPq = null;
  const PQ = 128;

  // The anchor the images currently HOLD. A tile is a function of (hour,
  // anchor), so both have to move it off the quantised early-out below --
  // otherwise crossing a zoom while the clock is still leaves the old rhythm up.
  let _lastAnchor = null;

  window.applyHeroColors = function applyHeroColors(map, p, force) {
    if (!HEROES.on || !map || !map.getLayer) return;
    const pq = Math.round(Math.max(0, Math.min(1, p)) * PQ) / PQ;
    const az = heroAnchorZoom();
    if (force !== true && _lastPq !== null && pq === _lastPq && az === _lastAnchor) return;
    _lastPq = pq;
    _lastAnchor = az;
    try {
      if (map.getLayer(L.solid)) map.setPaintProperty(L.solid, 'fill-extrusion-color', wallColor(p));
    } catch (e) {}
    try {
      if (map.getLayer(L.cap)) map.setPaintProperty(L.cap, 'fill-extrusion-color', capColor(p));
    } catch (e) {}
    // The five patterned surfaces are IMAGES, not paint properties, so they need
    // RE-DRAWING rather than re-expressing. A building that only looks right at
    // noon is not done. This is also where the lattice's glass and both curtain
    // walls come on after dusk.
    ensureImages(map, p);
  };

  // ── bootstrap ─────────────────────────────────────────────────────
  // Copied from the boot() at the bottom of js/arts.js.
  function boot() {
    const map = window.__map;
    if (!map) return setTimeout(boot, 60);

    // Crossing an integer zoom changes what these tiles should draw, the same
    // way crossing an hour does. Cheap to test (one integer compare) and the
    // redraw behind it is six 64 px canvases, so it can hang off `zoom`
    // directly without a debounce of its own.
    if (!map.__heroesZoomWatch) {
      map.__heroesZoomWatch = true;
      map.on('zoom', () => {
        if (heroAnchorZoom() === _lastAnchor) return;
        const p = (window.__todCurrentP != null) ? window.__todCurrentP : 0.3;
        try { window.applyHeroColors(map, p, true); } catch (e) {}
      });
    }

    const hookTod = () => {
      if (typeof window.applyTimeOfDay !== 'function' || window.applyTimeOfDay.__heroes) return;
      const prev = window.applyTimeOfDay;
      const wrapped = function (m, p, force) {
        const r = prev.apply(this, arguments);
        try { window.applyHeroColors(m, p, force); } catch (e) {}
        return r;
      };
      wrapped.__heroes = true;
      window.applyTimeOfDay = wrapped;
    };

    const go = () => {
      // Wait for the core buildings AND for facades.js — the state in which
      // addImage is safe — and for the collision field to have been built once,
      // so the rebuild below replaces a real grid rather than racing it.
      if (!map.getLayer('buildings-3d') || typeof window.initFacades !== 'function') {
        return setTimeout(go, 120);
      }
      hookTod();
      window.initHeroes(map);
    };
    if (map.isStyleLoaded && map.isStyleLoaded()) go();
    else map.once('load', () => setTimeout(go, 0));
  }
  boot();
})();
