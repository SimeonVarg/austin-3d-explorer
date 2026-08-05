/**
 * westcampus.js — West Campus, as stacked bands: ten student high-rises and
 * fourteen mid-rise blocks.
 *
 * WHY THIS FILE EXISTS. Ten towers between 55 and 82 m stand in the four blocks
 * the camera flies through most, and every one of them arrived from Overture as
 * a single prism wearing ONE facade tile from grade to roofline. A wall pattern
 * has no vertical anchor (docs/PASS_COMMON.md section 3), so the two things that
 * actually distinguish these buildings — a parking podium at the bottom and a
 * crown at the top — could not be said at all.
 *
 * TIER THREE went sideways with the same idea. A wall pattern has no HORIZONTAL
 * anchor either, so the bake now also cuts the tower band into vertical COLOUR
 * BAYS — The Standard's cream / warm-grey / slate panel field, Block on 25th
 * East's burnt-orange corner mass, 2400 Nueces' honey limestone volume — each
 * bay its own feature with its own atlas entry. Plus the thing that was missing
 * from every balcony in the pass: a 1.05 m RAIL standing on the slab. A slab on
 * its own is a ledge.
 *
 * The same was true of the fourteen MID-RISE blocks added in the second tier,
 * and worse: they are what you actually fly past, they are where students
 * actually live, and the fourteen-bucket facade election was also repainting
 * their measured wall colour (Rambler's brick #966753 came out #af785d). The
 * bake's MIDRISE header has the whole argument and the list of what that tier
 * deliberately does not touch.
 *
 * scripts/bake_westcampus.py emits each tower as a vertical STACK instead:
 * base / podium / tower / crown, each its own feature with its own base, height,
 * colour and pattern family, plus the things that make a student high-rise read
 * as apartments rather than an office block — projecting balcony slabs, an
 * amenity deck with a pool and a shade structure, a mechanical penthouse, and
 * one lit crown sign. That is the same shape scripts/bake_stadium.py uses for
 * DKR, and this module is the same shape as addStadiumLayers().
 *
 * TWO KINDS OF FEATURE, and they are coloured by two different systems:
 *   kind:"wall"   textured. Goes through quantiseStadiumFacades(), which gives
 *                 each (family, colour) its OWN palette entry rather than
 *                 snapping it to the city's fourteen mostly-tan buckets. That
 *                 matters here: nearest-RGB turns Callaway's red brick and
 *                 Dobie's teal curtain wall back into tan, which erases the two
 *                 buildings in the group with a different material.
 *   kind:"solid"  flat. Never touches the atlas — the deck, pool, turf, court,
 *                 shade, furniture, mechanical penthouse, balconies and sign are
 *                 coloured from the SOLID trios below, the same way app.js
 *                 colours the stadium seating.
 *
 * Public (window) API:
 *   initWestcampus(map)             — add the source + layers (called automatically)
 *   applyWestcampusColors(map, p)   — retint for time-of-day p (hooked automatically)
 *   WESTCAMPUS                      — the taste block
 */
(function () {
  'use strict';

  const q = new URLSearchParams(window.location.search);

  const WC = {
    // ?westcampus=0 removes the whole pass at load. scripts/verify/
    // westcampus-perf.mjs measures the A/B on ONE build with this rather than on
    // two checkouts, the way outer-perf.mjs does.
    on: q.get('westcampus') !== '0',
    minZoom: 14,
    opacity: 1.0,
  };
  window.WESTCAMPUS = WC;

  const SRC = 'austin-westcampus';
  const L_WALL = 'wc-wall';
  const L_CAP = 'wc-wall-cap';
  const L_SOLID = 'wc-solid';
  const DATA = 'data/westcampus.geojson';

  // ── The flat-coloured pieces: day / golden / night ──────────────────
  //
  // Entered COOL on purpose. A fill-extrusion's TOP face picks up the sun tint,
  // and every one of these is read almost entirely as a top face from a 60-75
  // degree camera. app.js measured the size of that: a neutral #c9bdaa (R/B
  // 1.18) came back on screen at R/B 1.85. So the deck paving below is a cool
  // grey and lands as concrete; typing concrete would land as sand.
  //
  // The night column is as dark as a night WALL for everything except the pool
  // and the sign. An unlit surface that stays pale after dark is the inverted-
  // silhouette failure scripts/verify/night-silhouette.mjs exists to catch, and
  // a roof deck is one of the largest pale surfaces this pass adds.
  const SOLID = {
    //          day        golden     night
    deck:  ['#b0b6bd', '#bcbbb6', '#1b1e26'],  // concrete pool deck paving
    pool:  ['#2f86ad', '#4a8096', '#1d4a63'],  // water. Stays visibly blue after
                                               // dark: a pool is lit from inside
                                               // and it is the one thing up there
                                               // that should read at night.
    turf:  ['#4e7d46', '#6b7d49', '#141f19'],  // artificial grass (Dobie)
    court: ['#a0552f', '#ad5f38', '#241a18'],  // sport court (Dobie)
    shade: ['#7e858c', '#8a8781', '#181b23'],  // trellis / canopy plate
    furn:  ['#8d867e', '#988b7a', '#171921'],  // cabana + furniture cluster
    mech:  ['#9ca1a6', '#a8a191', '#1a1d26'],  // mechanical penthouse screen
    balc:  ['#b8b3a9', '#c2b5a1', '#1c1e26'],  // balcony slab edge
    // ── the balustrade standing on that slab ─────────────────────────
    // The one thing that turns a balcony from a ledge into somewhere a person
    // stands, and the bake drew the slab and stopped until tier three. Two
    // classes because two materials: black powder-coated steel on everything
    // built since 2010, and a pale precast/white-metal parapet on Cambridge
    // Tower (Stanley's pierced "Solar Unit" breeze block) and 2400 Nueces.
    //
    // These are NOT entered cool the way the deck and the penthouse are. That
    // correction exists because a fill-extrusion's TOP face takes the sun tint
    // and those pieces are read almost entirely as top faces from a 60-75 deg
    // camera. A rail is 1.05 m tall and 0.11 m thick: its top face is a hairline
    // and what you see is the SIDE. So it is entered as the material reads.
    rail:  ['#2e3136', '#3a3733', '#131519'],  // black steel balustrade
    raill: ['#c6c3bb', '#cdc2ae', '#1e2029'],  // precast / white metal parapet
    // Moontower's roof sign. Dark bronze letters by day, and the only thing in
    // this pass that gets BRIGHTER after dark.
    sign:  ['#8a4a22', '#b4622c', '#ff8a3c'],
    // The Standard's two vertical THE STANDARD signs — brushed white letters on
    // the slate end walls, backlit at night. A separate class from `sign`
    // because Moontower's is warm bronze and this one is cool white, and the
    // difference is the whole reason you can tell the two buildings apart in a
    // night frame.
    signw: ['#e6e5e0', '#efe6d6', '#cdd6e4'],
    // The Standard's outdoor jumbotron on the level-7 pool deck. This trio was
    // named in this file before the screen could be drawn — the bake's MIDRISE
    // header has the three routes that all failed on ONE stale number, 20.5 m
    // for a 17-storey building. That number is corrected in authorStandard()
    // below, so the screen is drawn now, on the trio this file already chose:
    // near-black matt by day, and the one surface in West Campus that is a
    // genuine light source at night, cool 6500 K rather than the sign's warm
    // orange.
    screen: ['#22252b', '#2b2c31', '#7f97b8'],
  };

  const hx3 = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  /** The day->golden->night ramp every other colour in the scene uses. */
  function rampAt(trio, p) {
    p = Math.max(0, Math.min(1, p));
    const t = p <= 0.5 ? p / 0.5 : (p - 0.5) / 0.5;
    const A = hx3(trio[p <= 0.5 ? 0 : 1]), B = hx3(trio[p <= 0.5 ? 1 : 2]);
    return '#' + [0, 1, 2].map(i =>
      Math.round(A[i] + (B[i] - A[i]) * t).toString(16).padStart(2, '0')).join('');
  }
  function solidColourAt(p) {
    const e = ['match', ['get', 's']];
    for (const k of Object.keys(SOLID)) e.push(k, rampAt(SOLID[k], p));
    e.push(rampAt(SOLID.deck, p));
    return e;
  }
  /** ['interpolate', p, day, golden, night] — the shape timeofday.js bakes with. */
  function tod(p, d, g, n) {
    p = Math.max(0, Math.min(1, p));
    return ['interpolate', ['linear'], p,
      0, ['to-color', ['get', d], '#9a9a9a'],
      0.5, ['to-color', ['get', g], '#9a9a9a'],
      1, ['to-color', ['get', n], '#33333f'],
    ];
  }

  // ══════════════════════════════════════════════════════════════════
  //  TIER FOUR — two buildings authored against their own photographs
  // ══════════════════════════════════════════════════════════════════
  //
  // WHY THIS EXISTS. Tiers one to three could only ever return a slightly
  // different box, and Simeon said so: *"looks like u made overall shape a bit
  // more accurate but its like youre trying to draw the mona lisa and you made
  // the canvas the right size"*. He is right, and the reason is structural. A
  // roof in this city is MEASURED — roof_survey.json has 2,312 of them sampled
  // off imagery. A WALL is elected: quantiseFacades picks fourteen tones for
  // the whole of Austin and stamps one per building. Tier three broke half of
  // that by giving West Campus its own palette entries. What it could not break
  // is the other half: **the bake never changes a building's height**, and it
  // says so in its own MIDRISE header, because `js/controls.js` builds the
  // collision field from `final_height` and raising a wall in the bake draws a
  // tower you can fly straight through.
  //
  // So The Standard — Simeon's own building next year, seventeen storeys — has
  // been standing at 20.5 m, which is six. No amount of bay colour fixes that.
  //
  // The block below is the answer to both halves at once. It runs at LOAD, on
  // the fetched GeoJSON, before quantiseStadiumFacades() — the same seam
  // js/union24.js uses to replace Union on 24th's footprint before
  // quantiseFacades() sees it — and it hands the corrected volumes to
  // `__flyRebuildCollision`, the API js/heroes.js already uses to teach the
  // flight controls about EER's real height. Nothing here is baked, so nothing
  // here can collide with scripts/bake_westcampus.py.
  //
  // WHAT IT DOES NOT DO. It does not re-author from scratch. PR #119's colour
  // bays and balcony rails were read off the architects' own photographs and
  // they are right; they were simply stopped at the wrong height with no tower
  // above them. So the bake's own polygons are RESTRETCHED and added to, never
  // replaced — `restack()` below is the whole mechanism.
  //
  // ── EVERY NUMBER, AND WHERE IT CAME FROM ──────────────────────────
  //
  // Plan positions are FRACTIONS OF THE OBB, not coordinates, so a correction
  // is one number. The obb here reproduces the bake's own frame exactly, which
  // is checked rather than assumed: for The Standard it returns L = 94.9 m at
  // bearing 175.3 deg, the two figures the bake's MIDRISE table writes down.
  //
  // THE STANDARD AT AUSTIN, 715 W 23rd. Humphreys & Partners, 2021.
  //   Sources: Humphreys' own StandardAustin_Ext_01 (aerial, dusk, from the
  //   south), _Ext_14 (23rd & Pearl corner) and _Ext_41 (the level-7 pool
  //   deck); Landmark Properties and NAHB for 17 storeys / 287 units / 989
  //   beds / 337,847 sf; an Esri z20 nadir rectified into the obb frame for the
  //   plan.
  //   * SEVEN-STOREY LINER round the whole block, with the amenity level on
  //     top of it. Humphreys: "over 33,000 sq ft of amenity space located on
  //     the 7th floor". Independent confirmation that 21.5 m is that roof and
  //     not a guess: data/roofscape.geojson ALREADY carries a deck at
  //     21.50-21.75 and a mechanical penthouse at 21.75-24.55 over this
  //     footprint, plus 16 detail-tier condensers standing on it. Set the
  //     parapet anywhere else and that furniture floats or drowns; set it at
  //     21.5 and it lands exactly, which is why no penthouse is drawn here.
  //   * TWO TOWER SLABS rising out of it, measured off the rectified nadir as
  //     the two dark-membrane roofs among the condenser fields:
  //       east  u 23.5-41.0, v 17.0-31.4     west  u 57.2-74.3, v 17.0-31.4
  //     ~17.5 x 14.4 m each — narrow slabs, which is why each presents a blank
  //     end wall to the street, and those two end walls are where the vertical
  //     THE STANDARD signs are in Ext_01.
  //   * 17 storeys = 7 + 10. Ground 7.0 (the bake's, a two-storey glazed
  //     base), levels 2-7 to 21.5, then ten more at 3.19 to a 53.4 m parapet.
  //     Checked against Ext_01: from the deck rail to the tower parapet is 10-11
  //     balcony courses.
  //   * THE PIXEL FIELD is the thing you actually recognise: cream / warm-grey /
  //     pale panels laid up in a broken scatter, with terracotta accents. Bay
  //     colours are PR #119's, measured off Ext_14 and unchanged. What is new is
  //     that the tower faces carry the same scatter as a deterministic 3-tone
  //     bay sequence rather than one flat tone — see pixelBays().
  //   * POOL DECK. Ext_41 shows a lap pool, a spa, a turf lounge strip, a
  //     jumbotron and a cabana. The nadir puts the pool along the NORTH parapet,
  //     u 63-90, v 1.2-5.2, with the spa at its west end. The bake measured
  //     these too and then deleted them, and wrote down why: every route to
  //     drawing them failed on 20.5 m. That number is fixed here, so they go in.
  //
  // RAMBLER, 2513 Seton Ave (26th & Nueces). LV Collective, 2023.
  //   Sources: LV Collective's own Kristian Alveo photographs — the Seton Ave
  //   daylight elevation and the corner at blue hour; LV Collective for "eight
  //   levels of residential floors ... four levels of below grade parking".
  //   THE MODEL HAD THIS BUILDING ALMOST ENTIRELY WRONG and the photographs say
  //   so in three separate ways:
  //     - it is not a brick building. It is a CHECKERBOARD OF PALE PANELS —
  //       white, warm greige, light grey — with brick only at the base and in a
  //       few full-height piers. The bake painted the whole body #966753.
  //     - the crown is not a pale coping band. It is a DARK BLUE-TEAL
  //       standing-seam metal band that SWOOPS UP into a curve over the corner,
  //       with RAMBLER lettered on the white panel beneath it. It is the single
  //       most recognisable thing about the building and it was absent.
  //     - eight levels, not 14.4 m. Ground 4.8 + six at 3.05 to 23.1, the teal
  //       band 23.1-26.6 with level eight inside it, and the corner curve to
  //       29.2.
  //   The brick is a LIGHT CORAL, not the dark red the old body implied: the
  //   sunlit pier reads #f9bd9b / #f3b593 / #fcc4a3 (48/24/20%) and the same
  //   photograph's white panel comes back #f0ebe7, i.e. the exposure is near
  //   neutral and the brick really is that light.
  //
  // 21 RIO IS NOT DONE, and is left exactly as the bake has it. Eleven sources
  // were read and not one carried an exterior photograph of it — every gallery
  // that claims to is interiors and amenity rooms. The one thing established is
  // that its balcony rails are BURNT ORANGE, which is visible through the
  // window in Housing Scout's interior shot. That is not enough to author an
  // elevation from, and guessing the rest is the exact failure this tier exists
  // to stop.

  const TIER4 = {
    on: q.get('wc4') !== '0',

    // ── The Standard ────────────────────────────────────────────────
    // The four bay colours are PR #119's, measured off Humphreys' Ext_14 and
    // re-centred on the #b3b0a2 body PR #113 measured off imagery. Repeated
    // here rather than re-derived: the bake owns the derivation, this owns the
    // geometry, and a second derivation of the same number is a second thing to
    // keep in step.
    STD_CREAM: '#e7dec7',
    STD_WARM:  '#aea38f',
    STD_PALE:  '#bab9b0',
    STD_SLATE: '#87929d',   // the corner volume that carries the name
    STD_BASE:  '#3f4348',   // charcoal glazed retail base
    STD_CAP:   '#adb3b7',   // parapet coping
    // NEW, and the one Standard colour PR #119 did not have. The terracotta
    // accent panel is all over Ext_14 — the ground-floor piers and the tower
    // spandrels — and there was no vocabulary for it. Measured off the pier at
    // crop (1216,1664)-(1500,1830): 21.2% #b5753b. Ext_14 is BLUE HOUR, so it is
    // exposure-corrected against that same photograph's cream-panel cluster
    // (#d9d5be measured, #e8e2d2 in daylight) -> #c27c42, then taken at the 0.85
    // area-weighted distant read the rest of this pass uses -> #a56938.
    STD_RUST:  '#a56938',
    STD: {
      liner: 21.5,        // level-7 parapet. Corroborated by roofscape, above.
      cap: 1.1,           // coping band on top of the liner
      rise: 2.3,          // the slate corner volume oversails the coping
      tower: 53.4,        // 21.5 + 10 x 3.19
      towerCap: 1.2,
      // The deck furniture does NOT stand on roofscape's own 21.75 slab, and
      // the two metres matter: `deck` is COMPUTED from CAP_GEOM at load, not
      // typed. The liner's parapet cap is a solid plate over the WHOLE
      // 94.9 x 46.4 m footprint running from the coping's top (22.6) to
      // 22.6 + max(1.0, 0.015h) = 23.6, and THAT plate is the podium roof you
      // see from the air. Two renders were spent putting the pool, the turf and
      // the jumbotron under it, where they drew as nothing at all — the first
      // at 21.75 and the second at 22.55, because the cap was measured from the
      // wrong band. Asking CAP_GEOM removes the arithmetic from this file.
      deck: 0,
      floors: 6,          // liner levels 2-7 carrying balconies
      towerFloors: 10,
      // Two slabs, read off the rectified z20 nadir. u from the Rio Grande end.
      slabs: [[23.5, 41.0, 17.0, 31.4], [57.2, 74.3, 17.0, 31.4]],
      pool: [63.0, 90.0, 1.2, 5.2],
      spa: [90.4, 93.4, 1.2, 5.2],
      turf: [63.0, 78.0, 6.2, 11.0],
      cabana: [79.0, 85.0, 6.5, 10.5],
      screen: [60.0, 71.0, 11.4, 12.1],   // jumbotron, 4.2 m tall, facing north
      deckRail: [58.0, 94.0, 0.35, 0.48],
      signW: 1.3,         // vertical THE STANDARD letter band, m wide
      baySpread: 1.25,    // taste. See spread(); 1.0 is PR #119 unchanged.
    },

    // ── Rambler ─────────────────────────────────────────────────────
    // Sunlit brick #f9bd9b/#f3b593/#fcc4a3 (48/24/20%) off the Seton Ave
    // daylight photograph, crop (1450,350)-(1590,900), area-weighted #f8bd9c.
    // A facade at distance is not all in sun, so the distant read is
    // 0.6*sun + 0.4*(0.55*sun) = 0.82*sun -> #cb9b80.
    RAM_BRICK: '#cb9b80',
    // Panels, measured directly off the same daylight photograph:
    //   white  crop (2750,250)-(3050,330)  39% #f0ebe7 + 26% #f1ece9
    //   warm   crop (3350,100)-(3600,190)  37% #dac9b9 + 27% #d7c6b6
    // The third and fourth tones of the checker are not separable in that
    // photograph, so they are taken from the blue-hour corner shot's field crop
    // (1550,650)-(2050,1300), which gives two panel tones #a0a6b4 (47%) and
    // #92929c (35%) — a ratio of 0.90 — applied to the white above.
    // The four are then SPREAD about their own mean by 1.35 before they are
    // used, and the spread is honest rather than decorative: the atlas draws a
    // window grid over every one of them and that grid costs ~13% of mean luma
    // (js/facades.js's dkrWall records the same number), so four tones inside a
    // 34-RGB band arrive on screen as one tone and the checker stops existing.
    // Measured on the first render: the whole elevation came back a single tan.
    // The mean is untouched, so the building's colour is not moved — only the
    // contrast that survives the pattern is.
    // (238,234,228) (217,200,184) (214,211,206) (190,185,179) about their mean
    // (215,208,199), x1.45, back to hex. The mean comes out (215,207,199).
    RAM_WHITE: '#f8f6f1',
    RAM_WARM:  '#dac4b1',
    RAM_GREY:  '#d6d4d1',
    RAM_MID:   '#b3afaa',
    // The curved crown. Blue-hour metal, crop (1500,250)-(1700,400): 41%
    // #234760 + 38% #133349 -> #1c3d55. Scaled by that photograph's own white
    // point (its white panel reads #9fa9b9 against a daylight #f0ebe7, so
    // x1.44/1.39/1.28) -> #28556d, rounded to #2e5a70.
    RAM_TEAL:  '#2e5a70',
    // The membrane roof behind that parapet. Not measured — the nadir over this
    // block is a light concrete deck under condenser rows, and this is the tone
    // that reads as roof rather than as a fifth wall material.
    RAM_ROOF:  '#6e7275',
    RAM_GLASS: '#97a1b3',   // the chamfered corner bay, blue-green
    RAM: {
      base: 4.8,
      field: 23.1,        // ground + six at 3.05
      crown: 26.6,        // the teal band; level eight sits inside it
      curve: 29.2,        // the corner swoop
      floors: 6,
      // Full-height brick piers, as fractions of the perimeter's arc length.
      // The footprint is an 8-node L — its arc-length runs are, measured:
      //   0.000-0.194  north      0.194-0.442  west  (Nueces)
      //   0.442-0.583  the notch out of the south-west
      //   0.583-0.694  south      0.694-1.000  east  (Seton)
      // so the piers are spread over the three STREET elevations and the notch
      // is left alone.
      piers: [0.06, 0.13, 0.24, 0.32, 0.40, 0.62, 0.75, 0.83, 0.91, 0.98],
      pierW: 0.0125,      // fraction of the 287.3 m perimeter, i.e. ~3.6 m
      pierD: 0.85,        // m it stands proud of / into the wall plane
      // The corner the swoop is over. 0.694 is the ONLY built street-corner on
      // the site: 26th x Seton, where u=0 meets v=0. The other intersection,
      // 26th x Nueces, is notched out of the footprint entirely — which is why
      // the first render put the curve on a back elevation.
      corner: [0.665, 0.725],
    },
  };
  window.WESTCAMPUS_TIER4 = TIER4;

  // ── geometry helpers ──────────────────────────────────────────────
  // Everything below works in metres in a building's own oriented bounding box,
  // so a plan measurement read off a rectified nadir goes in unchanged.

  const M_LAT = 110540;
  const mLon = lat => 111320 * Math.cos(lat * Math.PI / 180);

  /**
   * Min-area rectangle over a footprint ring, +u along the LONG axis.
   *
   * This is a port of the obb in scripts/bake_westcampus.py, and the port is
   * VERIFIED rather than trusted: on The Standard it returns L = 94.9 m at
   * bearing 175.3 deg, which are the two numbers that bake's own MIDRISE table
   * writes down for it. If that ever stops matching, the bays in the GeoJSON
   * and the volumes here are in different frames and everything below is wrong.
   */
  function obbOf(ring) {
    const pts0 = ring.slice(0, ring.length - 1);
    const lat0 = pts0.reduce((a, p) => a + p[1], 0) / pts0.length;
    const mx = mLon(lat0), my = M_LAT;
    const p0 = pts0[0];
    const pts = pts0.map(p => [(p[0] - p0[0]) * mx, (p[1] - p0[1]) * my]);
    let best = null;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      let ax = pts[j][0] - pts[i][0], ay = pts[j][1] - pts[i][1];
      const len = Math.hypot(ax, ay);
      if (len < 1e-6) continue;
      ax /= len; ay /= len;
      let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
      for (const p of pts) {
        const u = p[0] * ax + p[1] * ay, v = -p[0] * ay + p[1] * ax;
        if (u < u0) u0 = u; if (u > u1) u1 = u;
        if (v < v0) v0 = v; if (v > v1) v1 = v;
      }
      const area = (u1 - u0) * (v1 - v0);
      if (!best || area < best.area) best = { area, ax, ay, u0, u1, v0, v1 };
    }
    if (!best) return null;
    let { ax, ay, u0, u1, v0, v1 } = best;
    if (v1 - v0 > u1 - u0) {                       // +u must be the LONG axis
      const nax = -ay, nay = ax;
      const nu0 = v0, nu1 = v1, nv0 = -u1, nv1 = -u0;
      ax = nax; ay = nay; u0 = nu0; u1 = nu1; v0 = nv0; v1 = nv1;
    }
    return {
      o: [p0[0] + (u0 * ax - v0 * ay) / mx, p0[1] + (u0 * ay + v0 * ax) / my],
      ax, ay, mx, my, L: u1 - u0, W: v1 - v0,
    };
  }

  const uv = (fr, u, v) => [fr.o[0] + (u * fr.ax - v * fr.ay) / fr.mx,
                            fr.o[1] + (u * fr.ay + v * fr.ax) / fr.my];

  /** An axis-aligned rectangle in obb metres, as a closed ring. */
  function rectUV(fr, u0, u1, v0, v1) {
    const r = [uv(fr, u0, v0), uv(fr, u1, v0), uv(fr, u1, v1), uv(fr, u0, v1)];
    r.push(r[0]);
    return [r];
  }

  /**
   * A quad hugging the REAL footprint between two arc-length fractions, pushed
   * `depth` metres toward the inside.
   *
   * A brick pier or a crown band has to sit on the wall the building actually
   * has, not on the obb rectangle — West Campus footprints are 8 to 19 sided and
   * an obb strip would float off the face on every non-orthogonal elevation.
   * The inward direction is taken from the ring's own signed area rather than
   * assumed, because these rings arrive in both windings.
   */
  function ringRun(ring, f0, f1, depth) {
    const pts = ring.slice(0, ring.length - 1);
    const n = pts.length;
    const lat0 = pts.reduce((a, p) => a + p[1], 0) / n;
    const mx = mLon(lat0), my = M_LAT;
    const P = pts.map(p => [p[0] * mx, p[1] * my]);
    const seg = [];
    let total = 0;
    for (let i = 0; i < n; i++) {
      const a = P[i], b = P[(i + 1) % n];
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      seg.push({ a, b, d, s: total });
      total += d;
    }
    let area2 = 0;
    for (let i = 0; i < n; i++) {
      const a = P[i], b = P[(i + 1) % n];
      area2 += a[0] * b[1] - b[0] * a[1];
    }
    const inward = area2 > 0 ? 1 : -1;      // left normal for CCW, right for CW
    const at = f => {
      const s = Math.max(0, Math.min(total - 1e-6, f * total));
      const g = seg.find(x => s >= x.s && s < x.s + x.d) || seg[n - 1];
      const t = (s - g.s) / g.d;
      const dx = (g.b[0] - g.a[0]) / g.d, dy = (g.b[1] - g.a[1]) / g.d;
      return { p: [g.a[0] + (g.b[0] - g.a[0]) * t, g.a[1] + (g.b[1] - g.a[1]) * t],
               nx: -dy * inward, ny: dx * inward };
    };
    // Walk the vertices between f0 and f1 so a run that turns a corner turns
    // with it instead of cutting across it.
    const s0 = f0 * total, s1 = f1 * total;
    const outer = [at(f0)];
    for (const g of seg) if (g.s > s0 && g.s < s1) {
      const prev = seg[(seg.indexOf(g) + n - 1) % n];
      const dx = (g.b[0] - g.a[0]) / g.d, dy = (g.b[1] - g.a[1]) / g.d;
      outer.push({ p: g.a, nx: -dy * inward, ny: dx * inward });
      void prev;
    }
    outer.push(at(f1));
    const back = outer.slice().reverse()
      .map(o => [o.p[0] + o.nx * depth, o.p[1] + o.ny * depth]);
    const r = outer.map(o => [o.p[0] / mx, o.p[1] / my])
      .concat(back.map(p => [p[0] / mx, p[1] / my]));
    r.push(r[0]);
    return [r];
  }

  // ── TASTE: TIER FOUR's night ramp. THE MIRROR OF THE BAKE'S, DELIBERATELY. ──
  //
  // scripts/bake_westcampus.py's `wall_ramp()` and its NIGHT_* block are the
  // statement of this rule; these five constants are the same numbers in the
  // other language, because tier four authors its bands at RUNTIME and the bake
  // can never see them. That is a second copy and second copies rot, so it is
  // written down here rather than left to be discovered: change one, change
  // both, and the bake's `check_night_ramp()` only guards the baked file.
  //
  // What the unlit branch is for, in one line: js/facades.js draws no lit-window
  // term for `dk` or `sf`, so a band in one of those families has to carry the
  // night read in its own wall or it renders darker than the sky behind it.
  // The long version, with the measurements, is in the bake's taste block and in
  // docs/night/black-towers.md. Tier four does not currently author a tall band
  // in either family — its `sf` use is 1-5 m crowns — so today this branch never
  // fires. It is here so that the day one of these towers grows a garage podium,
  // it does not ship black.
  //
  // THE TWO LISTS BELOW ARE NO LONGER OPINIONS. The bake now derives them from
  // NIGHT_TILE, a table of what each family's night tile actually MEASURES off
  // the atlas, because the last time this classification was written by hand it
  // went stale and The Callaway House Austin shipped a 49.8 m black tower in a
  // family described in a comment as "punched windows" that had been rewritten
  // into a stadium concourse with no windows at all. These are that derivation's
  // output, copied. If the bake's roll-call ever disagrees with them, the bake
  // is right.
  const T4_NIGHT_GAIN = 0.19;
  const T4_NIGHT_TINT = [18, 22, 40];
  const T4_NIGHT_TOWARD = 0.42;
  const T4_NIGHT_UNLIT_FAMILIES = ['dk', 'sf'];
  const T4_NIGHT_UNLIT_MIN_BAND_M = 8.0;
  const T4_NIGHT_UNLIT_GAIN = 0.40;
  const T4_NIGHT_UNLIT_TINT = [34, 46, 74];
  const T4_NIGHT_UNLIT_TOWARD = 0.30;
  // Families whose night tile has window panes bright enough to read after the
  // light multiply (measured peak luma >= 120: mh/tr/tg peak at ~208, sb 161,
  // sg 143, and everything else cannot pass 111 at ANY wall colour).
  const T4_NIGHT_LIT_FAMILIES = ['mh', 'sb', 'sg', 'tg', 'tr'];
  const T4_NIGHT_LIT_MIN_TOWER_M = 15.0;

  /** The bake's assertion D, mirrored — tier four's bands never reach the bake.
   *  A mass you read a building by has to be in a family that paints a window;
   *  no wall colour substitutes for one. Warns rather than throws, because a
   *  loud console line at authoring time is the cheapest place to catch it and
   *  a thrown error here would take the whole neighbourhood down. */
  function checkT4Night(out) {
    const bad = out.filter(f => {
      const p = f.properties;
      return p.kind === 'wall' && p.band === 'tower'
             && (p.h - p.base) >= T4_NIGHT_LIT_MIN_TOWER_M
             && T4_NIGHT_LIT_FAMILIES.indexOf(p.fam) === -1;
    });
    if (bad.length) {
      console.warn('[wc4] ' + bad.length + ' authored tower band(s) are in a '
        + 'family that draws no lit window and will render black at night: '
        + bad.map(f => f.properties.name + ' ' + f.properties.fam
                       + ' ' + (f.properties.h - f.properties.base).toFixed(1) + ' m')
             .join(', ') + '. Lit families: ' + T4_NIGHT_LIT_FAMILIES.join(', '));
    }
    return bad.length;
  }

  /** day -> golden, night. The same relationship the bake's wall_ramp() uses,
   *  including its family-aware night half — pass `fam` and the band's height. */
  function ramp(hex, fam, bandM) {
    const c = hx3(hex);
    const mixc = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
    const hexify = v => '#' + v.map(x =>
      Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
    const unlit = T4_NIGHT_UNLIT_FAMILIES.indexOf(fam) !== -1
                  && (bandM || 0) >= T4_NIGHT_UNLIT_MIN_BAND_M;
    const night = unlit
      ? mixc(c.map(v => v * T4_NIGHT_UNLIT_GAIN), T4_NIGHT_UNLIT_TINT, T4_NIGHT_UNLIT_TOWARD)
      : mixc(c.map(v => v * T4_NIGHT_GAIN), T4_NIGHT_TINT, T4_NIGHT_TOWARD);
    return [hexify(mixc(c, [255, 190, 130], 0.16)), hexify(night)];
  }

  function wallF(geom, base, h, fam, hex, name, extra) {
    // The coping ramps below call ramp() with no family on purpose: a parapet
    // coping is a horizontal top face, not a facade, and never goes through the
    // facade atlas at all. Same call the bake's wall_feature() makes.
    const r = ramp(hex, fam, h - base);
    return { type: 'Feature', geometry: { type: 'Polygon', coordinates: geom },
             properties: Object.assign({ kind: 'wall', band: 'tower', fam: fam,
               wd: hex, wg: r[0], wn: r[1], base: base, h: h, name: name,
               cap: 0, stack: 't4' }, extra || {}) };
  }
  function solidF(geom, base, h, cls, name) {
    return { type: 'Feature', geometry: { type: 'Polygon', coordinates: geom },
             properties: { kind: 'solid', s: cls, base: base, h: h, name: name } };
  }

  /**
   * The broken "pixel" panel field, as a deterministic bay sequence.
   *
   * Both buildings here wear one: a scatter of light rectangles in three or four
   * tones. A facade PATTERN cannot say it — a pattern has no horizontal anchor
   * (docs/PASS_COMMON.md section 3) — and one flat tone per elevation is exactly
   * the "fourteen tans" ceiling this tier exists to break. So the elevation is
   * cut into bays about one structural module wide and each takes the next tone
   * from a fixed STRIDE through the list.
   *
   * A STRIDE AND NOT A HASH, and the first cut of this was a hash. A hash over
   * six consecutive bays does not give you six sixths: it drew terracotta on
   * three of The Standard's west slab's six bays and the tower rendered as
   * orange candy stripes. 3 is coprime with every list length used here, so the
   * sequence visits every tone exactly once per lap and the proportions are
   * EXACT — which is what makes the next sentence true. Still deterministic, so
   * it cannot flicker between repaints, and because the tones are drawn in equal
   * turns the elevation still AVERAGES to the body colour the imagery measured:
   * the decomposition cannot repaint the building.
   */
  function pixelSeq(i, tones) {
    return tones[(((i * 3) % tones.length) + tones.length) % tones.length];
  }

  /**
   * Push a set of bay tones apart about their own mean, and leave the mean
   * exactly where it was.
   *
   * The atlas draws a window grid over every bay and that grid costs about 13%
   * of mean luma (js/facades.js's dkrWall records the same figure for the
   * stadium). Four measured tones inside a 30-RGB band therefore arrive on
   * screen as ONE tone — measured on the first render of this pass, where The
   * Standard's cream / warm / pale / slate liner came back a single tan and the
   * four-bay decomposition might as well not have existed.
   *
   * Because the mean is held, the building's colour is not moved: PR #113
   * measured the body off imagery and PR #119's bay_mix was written so the bays
   * average back to it, and that guarantee survives this untouched. Only the
   * contrast that survives the pattern changes. `k` is a taste value.
   */
  function spread(hexes, k) {
    const v = hexes.map(hx3);
    const m = [0, 1, 2].map(i => v.reduce((a, c) => a + c[i], 0) / v.length);
    return v.map(c => '#' + [0, 1, 2].map(i =>
      Math.max(0, Math.min(255, Math.round(m[i] + (c[i] - m[i]) * k)))
        .toString(16).padStart(2, '0')).join(''));
  }

  let _t4 = null;   // { name: final_height } for the collision rebuild

  /**
   * Restretch a band the bake emitted, keeping its polygon and its colour.
   *
   * `roof` also repaints rd/rg/rn, which is not cosmetic: the L_CAP layer takes
   * its colour from those three and nothing else, so a crown whose wall is
   * repainted but whose roof trio is not gets a coping in the OLD material —
   * Rambler's teal band came back with a tan lid on the first render.
   */
  function restack(feats, name, band, base, h, hex, roof) {
    let n = 0;
    for (const f of feats) {
      const p = f.properties;
      if (p.name !== name || p.band !== band) continue;
      p.base = base; p.h = h;
      if (hex) { const r = ramp(hex); p.wd = hex; p.wg = r[0]; p.wn = r[1]; }
      if (roof) { const r = ramp(roof); p.rd = roof; p.rg = r[0]; p.rn = r[1]; }
      n++;
    }
    return n;
  }

  /**
   * Re-space the bake's balcony courses over a new floor range.
   *
   * The bake drew four courses because it thought the building stopped at 15.7
   * m. The SLABS AND RAILS THEMSELVES are right — projection, thickness, the
   * 1.05 m rail, which bays get one — so the course geometry is cloned rather
   * than re-derived, and only the z of each course changes.
   */
  function respaceBalconies(feats, out, name, z0, f2f, floors) {
    const rows = new Map();
    for (const f of feats) {
      const p = f.properties;
      if (p.name !== name || p.kind !== 'solid') continue;
      if (p.s !== 'balc' && p.s !== 'rail' && p.s !== 'raill') continue;
      const key = p.base.toFixed(2) + '/' + p.s;
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key).push(f);
      p.__drop = true;
    }
    if (!rows.size) return 0;
    const keys = [...rows.keys()].sort((a, b) => parseFloat(a) - parseFloat(b));
    const slabKey = keys.find(k => k.endsWith('/balc'));
    const railKey = keys.find(k => !k.endsWith('/balc'));
    if (!slabKey) return 0;
    const slabs = rows.get(slabKey), rails = railKey ? rows.get(railKey) : [];
    const slabT = slabs[0].properties.h - slabs[0].properties.base;
    const railT = rails.length ? rails[0].properties.h - rails[0].properties.base : 1.05;
    let n = 0;
    for (let i = 0; i < floors; i++) {
      const b = z0 + i * f2f;
      for (const f of slabs) {
        out.push(solidF(f.geometry.coordinates, b, b + slabT, 'balc', name));
        n++;
      }
      for (const f of rails) {
        out.push(solidF(f.geometry.coordinates, b + slabT, b + slabT + railT,
                        f.properties.s, name));
        n++;
      }
    }
    return n;
  }

  function authorStandard(gj) {
    const T = TIER4, S = T.STD;
    const name = 'The Standard';
    const feats = gj.features;
    const base = feats.find(f => f.properties.name === name && f.properties.band === 'base');
    if (!base) return 0;
    const ring = base.geometry.coordinates[0];
    const fr = obbOf(ring);
    if (!fr) return 0;
    console.log('[wc4] %s obb L=%.1f W=%.1f bearing=%.1f',
                name, fr.L, fr.W, Math.atan2(fr.ay, fr.ax) * 180 / Math.PI);

    const out = [];
    // 1. The liner, restretched from 15.7 m to the level-7 parapet. The four
    //    bay polygons are PR #119's and so are the four hexes; all that happens
    //    to the colour is spread(), which holds their mean — see spread().
    restack(feats, name, 'tower', 7.0, S.liner);
    const lin = feats.filter(f => f.properties.name === name &&
                                  f.properties.band === 'tower' && f.properties.wd);
    const wide = spread(lin.map(f => f.properties.wd), S.baySpread);
    lin.forEach((f, i) => {
      const r = ramp(wide[i]);
      f.properties.wd = wide[i]; f.properties.wg = r[0]; f.properties.wn = r[1];
    });
    // 2. Coping, and the slate corner volume oversailing it with the name on it.
    restack(feats, name, 'crown', S.liner, S.liner + S.cap);
    for (const f of feats) {
      if (f.properties.name === name && f.properties.stack === 'bayrise') {
        f.properties.base = S.liner + S.cap;
        f.properties.h = S.liner + S.cap + S.rise;
      }
    }
    // 3. Balcony courses over levels 2-7 instead of four courses inside six.
    respaceBalconies(feats, out, name, 8.4, (S.liner - 8.9) / (S.floors - 1), S.floors);

    // 4. The two tower slabs. The pixel field is cream / pale / warm in equal
    //    thirds — the three tones PR #119 measured off Ext_14's panel field —
    //    plus ONE narrow terracotta accent bay per slab. Terracotta is in the
    //    field list in NO proportion, deliberately: the accent is a vertical
    //    strip between window bays in Ext_01, not a third of the elevation, and
    //    the first render of this had it on half the west slab.
    const tones = [T.STD_CREAM, T.STD_PALE, T.STD_WARM];
    const zT = S.tower;
    S.slabs.forEach((sl, si) => {
      const [u0, u1, v0, v1] = sl;
      const bays = Math.max(3, Math.round((u1 - u0) / 3.1));
      const bw = (u1 - u0) / bays;
      const accent = si === 0 ? 1 : bays - 2;    // one bay, opposite ends
      for (let i = 0; i < bays; i++) {
        const a = u0 + i * bw, b = u0 + (i + 1) * bw;
        if (i === accent) {
          // The accent strip is a THIRD of the bay wide; the rest of the bay
          // stays panel, so the terracotta reads as a pinstripe and not a band.
          out.push(wallF(rectUV(fr, a, a + bw / 3, v0, v1), S.liner, zT, 'tr',
                         T.STD_RUST, name, { band: 'tower', stack: 't4tower' }));
          out.push(wallF(rectUV(fr, a + bw / 3, b, v0, v1), S.liner, zT, 'tr',
                         T.STD_CREAM, name, { band: 'tower', stack: 't4tower' }));
          continue;
        }
        out.push(wallF(rectUV(fr, a, b, v0, v1), S.liner, zT, 'tr',
                       pixelSeq(si * 5 + i, tones), name,
                       { band: 'tower', stack: 't4tower' }));
      }
      // Parapet coping. `rd/rg/rn` are carried because the L_CAP layer colours
      // itself from those and nothing else — without them the coping falls back
      // to a mid grey and every authored crown gets the same lid.
      const cr = ramp(T.STD_CAP);
      out.push(wallF(rectUV(fr, u0, u1, v0, v1), zT, zT + S.towerCap, 'sf',
                     T.STD_CAP, name, { band: 'crown', cap: 1, stack: 't4tower',
                     rd: T.STD_CAP, rg: cr[0], rn: cr[1] }));
      // The vertical THE STANDARD sign on each end wall, standing 0.14 m proud.
      const ue = si === 0 ? u0 : u1;
      const sg = si === 0 ? [ue - 0.14, ue + 0.05] : [ue - 0.05, ue + 0.14];
      const vc = (v0 + v1) / 2;
      out.push(solidF(rectUV(fr, sg[0], sg[1], vc - S.signW / 2, vc + S.signW / 2),
                      zT - 24.0, zT - 2.5, 'signw', name));
      // Balcony courses up the tower's long faces, every floor, in two vertical
      // columns — Ext_01 has them stacked in columns, not continuous, and the
      // middle of each slab is window wall.
      //
      // THE RAIL IS A THIN STRIP AT THE OUTER EDGE OF THE SLAB, not a box the
      // size of the slab. The first render made the rail the slab's own
      // footprint and 1.05 m tall, which is a 4 x 1.4 x 1.05 m black brick per
      // floor: forty of them turned each tower into a black grid. This is the
      // same 0.11 m the bake uses, and it is the difference between a balcony
      // and a wall of coal.
      const f2f = (zT - S.liner) / S.towerFloors;
      const BW = 2.8, BP = 1.15, BT = 0.28, BR = 0.95, BX = 0.12;
      for (let i = 0; i < S.towerFloors; i++) {
        const b = S.liner + 1.1 + i * f2f;
        for (const [a, c] of [[u0 + 0.7, u0 + 0.7 + BW], [u1 - 0.7 - BW, u1 - 0.7]]) {
          for (const [n0, n1] of [[v1, v1 + BP], [v0 - BP, v0]]) {
            out.push(solidF(rectUV(fr, a, c, n0, n1), b, b + BT, 'balc', name));
            const e = n1 > v1 ? [n1 - BX, n1] : [n0, n0 + BX];
            out.push(solidF(rectUV(fr, a, c, e[0], e[1]), b + BT, b + BT + BR, 'rail', name));
          }
        }
      }
    });

    // 5. The level-7 pool deck, standing on TOP of the liner's parapet cap —
    //    see the note on `deck`. Positions off the rectified nadir; the
    //    furniture off Ext_41.
    const capTop = S.liner + S.cap;
    const G = window.CAP_GEOM;
    const D = S.deck = capTop + (G && G.liftFor ? G.liftFor(capTop) : 1.0) + 0.05;
    out.push(solidF(rectUV(fr, S.pool[0], S.pool[1], S.pool[2], S.pool[3]), D, D + 0.12, 'pool', name));
    out.push(solidF(rectUV(fr, S.spa[0], S.spa[1], S.spa[2], S.spa[3]), D, D + 0.5, 'pool', name));
    out.push(solidF(rectUV(fr, S.turf[0], S.turf[1], S.turf[2], S.turf[3]), D, D + 0.1, 'turf', name));
    out.push(solidF(rectUV(fr, S.cabana[0], S.cabana[1], S.cabana[2], S.cabana[3]), D + 2.6, D + 3.0, 'shade', name));
    out.push(solidF(rectUV(fr, S.cabana[0], S.cabana[1], S.cabana[2], S.cabana[3]), D, D + 0.8, 'furn', name));
    out.push(solidF(rectUV(fr, S.screen[0], S.screen[1], S.screen[2], S.screen[3]), D + 0.9, D + 5.1, 'screen', name));
    out.push(solidF(rectUV(fr, S.deckRail[0], S.deckRail[1], S.deckRail[2], S.deckRail[3]),
                    D, D + 1.15, 'rail', name));

    gj.features = feats.filter(f => !f.properties.__drop).concat(out);
    _t4[name] = zT + S.towerCap;
    return out.length;
  }

  function authorRambler(gj) {
    const T = TIER4, R = T.RAM;
    const name = 'Rambler';
    const feats = gj.features;
    const base = feats.find(f => f.properties.name === name && f.properties.band === 'base');
    if (!base) return 0;
    const ring = base.geometry.coordinates[0];
    const out = [];

    // 1. The base stays brick, but it is the LIGHT coral the photograph shows,
    //    not the dark #7d5747 the shared BASE_BRICK gave it.
    restack(feats, name, 'base', 0, R.base, T.RAM_BRICK);
    // 2. The body is NOT brick. It is the pale panel checker, so the one flat
    //    #966753 band becomes a stack of pixel bays over the same footprint,
    //    cut along the perimeter so every elevation gets the checker.
    for (const f of feats) {
      if (f.properties.name === name && f.properties.band === 'tower') f.properties.__drop = true;
    }
    const tones = [T.RAM_WHITE, T.RAM_GREY, T.RAM_WARM, T.RAM_WHITE,
                   T.RAM_MID, T.RAM_GREY, T.RAM_WHITE, T.RAM_WARM];
    const bays = 30;
    for (let i = 0; i < bays; i++) {
      out.push(wallF(ringRun(ring, i / bays, (i + 1) / bays, 9.0),
                     R.base, R.field, 'mh', pixelSeq(i * 7 + 3, tones), name,
                     { band: 'tower', stack: 't4' }));
    }
    // 3. Full-height brick piers standing proud of that field.
    for (const f0 of R.piers) {
      const w = R.pierW;
      out.push(wallF(ringRun(ring, f0, f0 + w, R.pierD + 0.9),
                     0, R.field, 'mh', T.RAM_BRICK, name,
                     { band: 'tower', stack: 't4pier' }));
    }
    // 4. The chamfered corner bay: blue-green glass, floors two to six.
    out.push(wallF(ringRun(ring, R.corner[0], R.corner[1], 2.2),
                   R.base, R.field, 'tg', T.RAM_GLASS, name,
                   { band: 'tower', stack: 't4' }));
    // 5. THE CROWN. A dark blue-teal standing-seam band round the whole
    //    building, swooping up over the corner. The curve is drawn as three
    //    stepped runs rather than one, because a fill-extrusion has one height:
    //    stepping it is the only way this renderer can say "curved".
    // `rd` is a ROOF grey and not the teal, and the difference is a whole
    // storey of the building. L_CAP does not draw a coping strip: CAP_GEOM
    // spans the feature's own polygon, so on a full-footprint crown band the
    // "coping" IS the roof plane. Painting it teal put a teal lid over the
    // entire 88 x 56 m roof, which from any camera above 40 m is the biggest
    // surface on the building. The teal belongs on the WALL of the band.
    restack(feats, name, 'crown', R.field, R.crown, T.RAM_TEAL, T.RAM_ROOF);
    const tr = ramp(T.RAM_ROOF);
    const c0 = R.corner[0], c1 = R.corner[1], cm = (c0 + c1) / 2;
    const steps = [[c0 - 0.055, c0, 0.34], [c0, cm - 0.012, 0.72],
                   [cm - 0.012, cm + 0.012, 1.0], [cm + 0.012, c1, 0.72],
                   [c1, c1 + 0.055, 0.34]];
    for (const [a, b, k] of steps) {
      out.push(wallF(ringRun(ring, a, b, 5.0), R.crown, R.crown + (R.curve - R.crown) * k,
                     'sf', T.RAM_TEAL, name, { band: 'crown', cap: 1, stack: 't4crown',
                     rd: T.RAM_TEAL, rg: tr[0], rn: tr[1] }));
    }
    // 6. Balcony courses over the six panel floors, from the bake's own slabs.
    respaceBalconies(feats, out, name, R.base + 1.0, (R.field - R.base - 1.6) / (R.floors - 1), R.floors);

    gj.features = feats.filter(f => !f.properties.__drop).concat(out);
    _t4[name] = R.curve;
    return out.length;
  }

  /**
   * Teach the flight controls that these two are 15-34 m taller than the
   * snapshot says.
   *
   * Straight out of js/heroes.js's extendCollision(): controls.js rasterises its
   * grid from `scene.buildings` (final_height) and `scene.parts` (h) ONCE at
   * init, and nothing here edits the snapshot — so without this you fly through
   * the top 33 m of The Standard, which is the exact defect
   * scripts/bake_westcampus.py refused to ship and wrote down as the reason it
   * would not touch a height.
   */
  function extendCollision(map, heights) {
    if (typeof window.__flyRebuildCollision !== 'function') return 'no collision api';
    const pick = id => {
      const s = map.getSource(id);
      if (!s) return null;
      return [s._data, s.serialize && s.serialize().data]
        .find(d => d && typeof d !== 'string' && d.features && d.features.length) || null;
    };
    const buildings = pick('austin-buildings');
    if (!buildings) return 'no buildings source';
    const parts = pick('austin-parts');
    const extra = [];
    for (const f of buildings.features) {
      const h = heights[f.properties && f.properties.name];
      if (h) extra.push({ type: 'Feature', geometry: f.geometry, properties: { h: h } });
    }
    if (!extra.length) return 'no matching footprints';
    window.__flyRebuildCollision({
      buildings,
      parts: { type: 'FeatureCollection', features: ((parts && parts.features) || []).concat(extra) },
    });
    return 'rebuilt with ' + extra.length + ' corrected heights';
  }

  let _added = false;
  // The buildings layers' filters as they were BEFORE we subtracted the ten
  // replaced ids, so applyWestcampusSettings() can put the generic prisms back.
  // Without that, turning the pass off leaves ten holes in the city rather than
  // ten plain towers, and the A/B measures the wrong thing.
  //
  // This snapshot is order-dependent: addStadiumLayers() subtracts DKR's id from
  // the same filters after its own fetch resolves, so if that landed AFTER this
  // did, restoring would also un-hide DKR's prism. In practice the stadium wins
  // the race (its clause is already present when we snapshot — the perf script
  // echoes the filter next to every timing, so a run where that stopped being
  // true would show up rather than quietly skew the numbers). It only affects
  // scripts/verify/westcampus-perf.mjs; nothing on the site calls this.
  const _priorFilter = {};

  window.initWestcampus = async function initWestcampus(map) {
    if (!WC.on || _added || map.getSource(SRC)) return;
    _added = true;

    let gj;
    try {
      const r = await fetch(DATA);
      if (!r.ok) throw new Error(DATA + ': ' + r.status);
      gj = await r.json();
    } catch (e) {
      console.warn('[westcampus]', e.message, '- towers left as baked');
      _added = false;
      return;
    }

    // TIER FOUR runs HERE and nowhere else: after the fetch, before the atlas
    // pass, before addSource. Its new bands have to be in `gj.features` when
    // quantiseStadiumFacades() walks the list or they get no pattern image and
    // MapLibre paints them transparent; and they have to be in the object
    // BEFORE addSource for the reason spelled out immediately below.
    let t4 = 0;
    if (TIER4.on) {
      _t4 = {};
      try {
        t4 = authorStandard(gj) + authorRambler(gj);
        checkT4Night(gj.features.filter(
          f => f.properties && String(f.properties.stack || '').indexOf('t4') === 0));
      } catch (e) {
        console.warn('[wc4] authoring failed, buildings left as baked:', e && e.message);
      }
    }

    // Stamp the facade pattern BEFORE addSource. MapLibre serialises a GeoJSON
    // source to its worker on addSource, so mutating the same objects afterwards
    // never reaches the tiles and every wall band renders with NO pattern —
    // which MapLibre draws as transparent, i.e. the towers disappear. app.js
    // documents the same trap for the stadium.
    let added = 0;
    if (typeof window.quantiseStadiumFacades === 'function') {
      added = window.quantiseStadiumFacades(map, gj.features);
    }

    map.addSource(SRC, { type: 'geojson', data: gj, ...(window.PATTERN_TILING || {}) });

    // The anchor must be the first symbol layer AFTER our buildings, not the
    // first in the style. The basemap puts its symbol layers immediately after
    // `background`, so anchoring there drops the whole pass to the BOTTOM of the
    // stack, under `ground-areas` — it still renders, just repainted by the
    // ground fill on top of it. That already cost this repo a session on the
    // stadium; copied from addStadiumLayers deliberately.
    const stack = map.getStyle().layers;
    const after = Math.max(0, stack.findIndex(l => l.id === 'buildings-3d'));
    const anchor = (stack.slice(after + 1).find(l => l.type === 'symbol') || {}).id;

    // The generic extrusions have to STOP being drawn or their full-height
    // prisms bury every band inside them.
    const gone = gj.replacedBuildingIds || [];
    if (gone.length) {
      window.__wcReplaced = gone;
      const notReplaced = ['!', ['in', ['get', 'id'], ['literal', gone]]];
      for (const id of ['buildings-3d', 'buildings-roof', 'buildings-ao']) {
        if (!map.getLayer(id)) continue;
        const f = map.getFilter(id) || null;
        _priorFilter[id] = f;
        try { map.setFilter(id, f ? ['all', f, notReplaced] : notReplaced); } catch (e) {}
      }
    }

    const p = (window.__todCurrentP != null) ? window.__todCurrentP : 0.3;

    map.addLayer({
      id: L_WALL, type: 'fill-extrusion', source: SRC, minzoom: WC.minZoom,
      filter: ['==', ['get', 'kind'], 'wall'],
      paint: {
        'fill-extrusion-pattern': window.FACADE_PATTERN_EXPR,
        'fill-extrusion-height': ['get', 'h'],
        'fill-extrusion-base': ['get', 'base'],
        'fill-extrusion-opacity': WC.opacity,
        // OFF, unlike every other building in the scene. The gradient darkens
        // the BOTTOM of an extrusion and restarts at every extrusion — so on a
        // four-band stack it draws a dark seam under all four, and on The
        // Castilian's 4.6 m ground floor the entire band falls inside the
        // gradient and the retail level renders black. The bands carry their own
        // vertical hierarchy; the same call stadium-wall makes.
        'fill-extrusion-vertical-gradient': false,
      },
    }, anchor);

    // Parapet coping on the topmost band of each stack only. Capping every band
    // would put a lip at the podium top and the base top as well — three ledges
    // up one wall. `cap` is stamped by the bake, so the rule lives in one place.
    const G = window.CAP_GEOM;
    map.addLayer({
      id: L_CAP, type: 'fill-extrusion', source: SRC, minzoom: WC.minZoom,
      filter: ['all', ['==', ['get', 'kind'], 'wall'], ['==', ['get', 'cap'], 1]],
      paint: {
        'fill-extrusion-color': tod(p, 'rd', 'rg', 'rn'),
        'fill-extrusion-height': G ? G.height(['get', 'h']) : ['+', ['get', 'h'], 1],
        'fill-extrusion-base': G ? G.base(['get', 'h']) : ['get', 'h'],
        'fill-extrusion-opacity': 1.0,
      },
    }, anchor);

    map.addLayer({
      id: L_SOLID, type: 'fill-extrusion', source: SRC, minzoom: WC.minZoom,
      filter: ['==', ['get', 'kind'], 'solid'],
      paint: {
        'fill-extrusion-color': solidColourAt(p),
        'fill-extrusion-height': ['get', 'h'],
        'fill-extrusion-base': ['get', 'base'],
        'fill-extrusion-opacity': 1.0,
        // Same reason as the walls, and more so: a balcony slab is 0.34 m tall
        // and a pool 0.10 m. A vertical gradient across that is 100% dark end.
        'fill-extrusion-vertical-gradient': false,
      },
    }, anchor);

    const walls = gj.features.filter(f => f.properties.kind === 'wall').length;
    console.log('[westcampus]', gj.features.length, 'features (', walls, 'wall bands,',
                gj.features.length - walls, 'solid ),', gone.length,
                'generic extrusions replaced,', added, 'new atlas images');
    if (t4) {
      console.log('[wc4]', t4, 'authored features;', JSON.stringify(_t4),
                  '- collision:', extendCollision(map, _t4));
      window.__wc4 = { added: t4, heights: _t4 };
    }
  };

  window.applyWestcampusColors = function applyWestcampusColors(map, p) {
    if (!map || !map.getLayer) return;
    try {
      if (map.getLayer(L_SOLID))
        map.setPaintProperty(L_SOLID, 'fill-extrusion-color', solidColourAt(p));
    } catch (e) {}
    try {
      if (map.getLayer(L_CAP))
        map.setPaintProperty(L_CAP, 'fill-extrusion-color', tod(p, 'rd', 'rg', 'rn'));
    } catch (e) {}
    // L_WALL carries its colour inside the shared facade atlas, which
    // updateFacades() has already repainted by the time we get here.
  };

  /**
   * Turn the pass on or off at RUNTIME, after a live edit of WESTCAMPUS.on.
   *
   * This exists for scripts/verify/westcampus-perf.mjs. `?westcampus=0` is a
   * load-time flag, and an A/B that has to reload the page between
   * configurations cannot interleave them — and un-interleaved timings in this
   * repo have already produced one false regression report. So the measurement
   * flips this instead, which swaps BOTH halves of the change in one frame: our
   * three layers go away and the ten generic prisms come back.
   */
  window.applyWestcampusSettings = function applyWestcampusSettings(map) {
    if (!map || !map.getLayer) return;
    const vis = WC.on ? 'visible' : 'none';
    for (const id of [L_WALL, L_CAP, L_SOLID]) {
      if (!map.getLayer(id)) continue;
      try { map.setLayoutProperty(id, 'visibility', vis); } catch (e) {}
    }
    const gone = window.__wcReplaced || [];
    if (!gone.length) return;
    const notReplaced = ['!', ['in', ['get', 'id'], ['literal', gone]]];
    for (const id of ['buildings-3d', 'buildings-roof', 'buildings-ao']) {
      if (!map.getLayer(id)) continue;
      const prior = _priorFilter[id] || null;
      const want = WC.on ? (prior ? ['all', prior, notReplaced] : notReplaced) : prior;
      try { map.setFilter(id, want); } catch (e) {}
    }
  };

  // ── bootstrap ─────────────────────────────────────────────────────
  // js/app.js belongs to another pass and will not call us, so this waits for
  // the map, for the core building layers, and for the facade quantiser, then
  // inserts itself. Copied from the boot() at the bottom of js/outer.js — the
  // applyTimeOfDay wrap is installed here, after every module has loaded, so
  // script order cannot break it.
  function boot() {
    const map = window.__map;
    if (!map) return setTimeout(boot, 60);

    const hookTod = () => {
      if (typeof window.applyTimeOfDay !== 'function' || window.applyTimeOfDay.__wc) return;
      const prev = window.applyTimeOfDay;
      const wrapped = function (m, p, force) {
        const r = prev.apply(this, arguments);
        try { window.applyWestcampusColors(m, p); } catch (e) {}
        return r;
      };
      wrapped.__wc = true;
      window.applyTimeOfDay = wrapped;
    };

    const go = () => {
      // Wait for the core buildings AND for quantiseStadiumFacades: the bands
      // ask for pattern images that have to be registered first, and a feature
      // whose image MapLibre does not have is painted transparent.
      if (!map.getLayer('buildings-3d') ||
          typeof window.quantiseStadiumFacades !== 'function') {
        return setTimeout(go, 120);
      }
      hookTod();
      window.initWestcampus(map);
    };
    if (map.isStyleLoaded && map.isStyleLoaded()) go();
    else map.once('load', () => setTimeout(go, 0));
  }
  boot();
})();
