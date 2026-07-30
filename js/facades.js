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
  //   st  stadiums + arenas: masonry piers, NOT windows (see drawStadium)
  const GRIDS = {
    lo: { rows: 2, cols: 3, w: 13, h: 11 },
    md: { rows: 5, cols: 4, w: 10, h: 8 },
    tw: { rows: 6, cols: 6, w: 7,  h: 7 },
    dk: null, // drawn as bands
    st: null, // drawn as piers + spandrel/slot tiers (drawStadium)
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
    SN_COURSE: 4,          // px between mortar courses
    SN_COURSE_DARK: 0.07,
    SN_COLS: 5, SN_TIERS: 5,
    SN_W: 6, SN_H: 8,
    SN_TOWER_EVERY: 32, SN_TOWER_W: 9, SN_TOWER_LIGHT: 0.13,

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
  const DKR_GAIN = { sp: 1.20, sb: 1.14, sn: 1.10, sf: 1.06, sg: 1.12, sd: 1.04 };

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
  const PANE_BRIGHT_MIN = 0.40;
  const PANE_BRIGHT_MAX = 1.00;
  // A rare "hot pane" much brighter than its neighbours — pushed toward white.
  const HOT_PANE_RATE  = 0.05;   // fraction of LIT panes
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
  const OCCUPANCY = {
    lo: [0.14, 0.40],
    md: [0.12, 0.42],
    tw: [0.08, 0.36],
    dk: [0.00, 0.00],  // parking decks have no glazing (drawn as bands)
  };
  // Compresses a family's tone roll into the warm end of WINDOW_TONES.
  // 1.0 = full palette; 0.6 = houses almost never go fluorescent.
  const TONE_WARM_BIAS = { lo: 0.60, md: 1.00, tw: 1.00, dk: 1.00 };
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
  function familyFor(props) {
    const cls = props.building_class || '';
    if (/parking|garage|carport/.test(cls)) return 'dk';
    // A stadium is not an office building. Before this, DKR was 63 m tall so it
    // fell through to `tw` and wore a dense curtain-wall grid — the single
    // loudest wrong note on campus. Class comes from the Overture/OSM bake.
    if (/stadium|arena|sports_centre|grandstand/.test(cls)) return 'st';
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
      const fam = span >= 26 ? 'tw' : span < 5 ? 'lo' : 'md';
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
      // MapLibre would paint the wall transparent.
      try {
        if (!(map.hasImage && map.hasImage(p.wp))) {
          map.addImage(p.wp, tileData(fam, idx, window.__todCurrentP != null ? window.__todCurrentP : 0.5));
          added++;
        }
      } catch (e) { /* already added */ }
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

    /** sn — 2008 north end zone: brick veneer, punched windows, pier towers. */
    sn(ctx, wall, dark, night, golden, glass, seed) {
      const T = TILE, w = dkrWall(wall, 'sn');
      const fill = (c, x, y, ww, hh) => { ctx.fillStyle = css(c); ctx.fillRect(x, y, ww, hh); };
      fill(w, 0, 0, T, T);
      const course = mix(w, [0, 0, 0], DKR.SN_COURSE_DARK);
      for (let y = 0; y < T; y += DKR.SN_COURSE) fill(course, 0, y, T, 1);
      const stepX = T / DKR.SN_COLS, stepY = T / DKR.SN_TIERS;
      for (let r = 0; r < DKR.SN_TIERS; r++) {
        for (let c = 0; c < DKR.SN_COLS; c++) {
          const x = Math.round(c * stepX + (stepX - DKR.SN_W) / 2);
          const y = Math.round(r * stepY + (stepY - DKR.SN_H) / 2);
          fill(mix(w, [255, 255, 255], 0.16 * (1 - dark * 0.8)), x - 1, y - 1, DKR.SN_W + 2, DKR.SN_H + 2);
          let pane = glass;
          if (night > 0.02 && hash01(seed, r, c) < 0.22) {
            pane = mix(glass, pickTone(hash01(seed + 5, r, c)), night * 0.8);
          }
          fill(pane, x, y, DKR.SN_W, DKR.SN_H);
        }
      }
      const tower = mix(w, [255, 255, 255], DKR.SN_TOWER_LIGHT * (1 - dark * 0.8));
      for (let x = 0; x < T; x += DKR.SN_TOWER_EVERY) {
        fill(tower, x, 0, DKR.SN_TOWER_W, T);
        fill(mix(w, [0, 0, 0], 0.20), x + DKR.SN_TOWER_W, 0, 1, T);
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
    // Continuous occupancy per (family × bucket) hash — see OCCUPANCY above.
    // `seed` decorrelates the per-pane rolls between families sharing a bucket
    // and between the four rolls each pane makes (lit / tone / bright / hot);
    // the salts are primes far larger than any bucket index so the streams
    // can't collide.
    const famIdx = fam === 'lo' ? 0 : fam === 'md' ? 1 : fam === 'tw' ? 2 : 3;
    const seed = bucketIdx * 4 + famIdx;
    const occRange = OCCUPANCY[fam] || OCCUPANCY.md;
    const occRoll = hash01(seed + 4001, 0, 0);
    const occupancy = occRange[0] + (occRange[1] - occRange[0]) * occRoll * occRoll;
    const warmBias = TONE_WARM_BIAS[fam] != null ? TONE_WARM_BIAS[fam] : 1;

    for (let r = 0; r < g.rows; r++) {
      for (let c = 0; c < g.cols; c++) {
        const x = Math.round(c * stepX + offX), y = Math.round(r * stepY + offY);
        ctx.fillStyle = css(frame);
        ctx.fillRect(x - 1, y - 1, g.w + 2, g.h + 2);

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
