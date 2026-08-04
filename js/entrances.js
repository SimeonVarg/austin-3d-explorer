/**
 * entrances.js — the doors. 584 entrances on 258 campus buildings, 10,051
 * pieces, drawn as geometry that stands PROUD of its host wall and claims no
 * building id.
 *
 * Simeon: "just add the entrances to the buildings on campus... make entrances
 * extremely accurate with accurate text and design, some of these are
 * celebrated entrances. Do all entrances and exits, correct types of doors,
 * amount of doors + stairs, rails, glass, and material."
 *
 * scripts/bake_entrances.py did the placing and the assembling and prints its
 * own recovery rate on every run; docs/entrances/{placement,eras,celebrated}.md
 * are the specs. This file is only the renderer, and it exists because the bake
 * deliberately writes no js. It is built on the js/places.js pattern: it
 * registers its OWN source and layers, it is not called from js/app.js, and it
 * needs no edit to any file but the two <script> lists.
 *
 * ── THE FOUR THINGS THIS FILE HAS TO GET RIGHT ───────────────────────────────
 *
 *  1. `h` IS A THICKNESS, NOT A TOP. data/places.geojson stores `h` as the
 *     absolute top of a band; data/entrances.geojson follows the schema Simeon
 *     fixed for it — "height of this piece in metres". So the height paint
 *     property here is `base + h`, not `h`. The bake's own docstring calls this
 *     "the single most likely thing for the renderer to get wrong", so it is
 *     asserted by window.entrancesStats().hContract, which reports the tallest
 *     piece both ways so a verification script can catch a regression without a
 *     screenshot: `asThickness` 6.81 m is the true top of the tallest piece in
 *     the file, `asTop` 6.59 m is what you get reading `h` as an absolute. The
 *     two are close enough at the top of the range to look plausible, which is
 *     the trap — the damage is at the bottom, where a sign band at base 5.16
 *     with h 1.10 would be drawn from 5.16 to 1.10, i.e. inverted and buried.
 *
 *  2. THE SOURCE MAY NOT BE SIMPLIFIED. The median piece here is a 0.35 m stair
 *     nosing and the smallest is 0.06 m. window.PATTERN_TILING — which almost
 *     every other pass spreads into its source — is `maxzoom 16, tolerance 0.5`,
 *     tuned for 40 m wall panels: at z16 one tile pixel is ~2.4 m of ground, so
 *     a 0.35 m tread is a quarter of a tile pixel and geojson-vt's simplifier is
 *     entitled to delete it, and everything above z16 then re-uses that gutted
 *     z16 tile. So this pass tiles at maxzoom 18 with tolerance 0 instead. It is
 *     the one place this module deliberately disagrees with its neighbours, and
 *     ENT.tiling is a one-line override if the cost ever matters.
 *
 *  3. AT NIGHT THE GLASS IS LIT, AND THE BAKE IS THE ONE THAT SAYS SO.
 *     An entrance is one of the few things on a building that is genuinely lit
 *     after hours — a vestibule light burns all night while the offices above
 *     it are black. This file USED to force that, because the bake was writing
 *     an unlit `wn` of #4f493e. It no longer is: every glazing piece now
 *     carries an authored, PRE-COMPENSATED warm `wn` (#ffaa3c / #ffc06a /
 *     #f09a35 / #ffd07a, four values over 1,398 pieces) — pre-compensated
 *     because MapLibre multiplies a fill-extrusion by `setLight`, which at
 *     night is the blue #9aa6da, so anything warm you enter comes back about a
 *     third less warm. So the renderer's job here is to GET OUT OF THE WAY and
 *     pass `wn` through. The old override list survived the bake fix as dead
 *     code that read as if it were doing the work; it is gone. ENT.glassNightTint
 *     is the escape hatch, empty by default, and entrancesStats().nightGlass
 *     audits the file so a neutral can never creep back in unnoticed.
 *
 *     MEASURED, not asserted from the expression (2026-08-04, tod 0.92, z19.2
 *     to 19.8, magenta-masked so the pixel set is the layer's own and not a
 *     hand-picked box). mean rgb / luma / frame-median luma / R:B:
 *       Battle          (133,103,74)  107   41   1.79
 *       Main Building   (133,101, 66) 105   45   2.02
 *       PCL             (143,109, 62) 113   37   2.31
 *       Gregory         (143,107, 69) 112   35   2.09
 *       Welch           (129, 95, 58) 100   31   2.21
 *     Compare §86's reading of the same layer before the bake fix:
 *     rgb(134,121,118), luma 124, channels within 16 — a pale neutral that was
 *     BRIGHTER than these and still read dead, because brightness was never the
 *     problem. Warmth was. And the day side of the same Battle glazing is
 *     (59,76,91), R:B 0.65 — blue by day, warm by night, off one `wn`/`wd` pair.
 *
 *     Plus ENT.pool — a soft ground pool at every door, on night.js's own lamp
 *     schedule, because 1.2 m of lit glass is under a pixel from 300 m up and
 *     the pool is what actually says "that building is open" from the air.
 *
 *  4. THE INSCRIPTIONS ARE OFF BY DEFAULT, AND THAT IS A MEASURED CALL.
 *     See INSCRIPTIONS below. Read that comment before "fixing" it.
 *
 * ── LOD ──────────────────────────────────────────────────────────────────────
 * 10,051 pieces across 374 buildings is a lot of very small boxes, so the pass
 * is split by how much of an entrance each kind is worth:
 *
 *   PORTAL  door glass transom surround canopy column sign   (3,447 pieces)
 *   DETAIL  step reveal rail ramp                            (6,604 pieces)
 *
 * PORTAL comes in at ENT.minZoom, DETAIL at ENT.detailMinZoom, and DETAIL is
 * additionally gated on a density knob that rides GFX.treeDensity exactly as
 * js/props.js's does — so the four quality presets and the ~30 fps auto-detect
 * already move it without this file editing js/graphics.js. At the performance
 * preset the 3,710 stair treads on the far side of campus stop being drawn; the
 * doors never do.
 *
 * ── IT REPLACES NOTHING ──────────────────────────────────────────────────────
 * `replacedBuildingIds` is empty and this module writes no filter on
 * `buildings-3d`. Every piece stands proud of the wall it belongs to, so this
 * pass cannot collide with facades.js, drag.js, westcampus.js, heroes.js,
 * moody.js, arts.js, capitol.js or tower.js in either order, whether or not
 * they have already rebuilt the wall behind it.
 *
 * Public (window) API:
 *   initEntrances(map)             — add source + layers (called automatically)
 *   applyEntranceColors(map, p)    — retint for time-of-day p (hooked automatically)
 *   applyEntranceDensity(map)      — re-read the LOD knob
 *   applyEntranceSettings(map)     — re-read ENT after a live edit
 *   entrancesStats()               — what actually got drawn
 *   ENT                            — the taste block (below)
 */
(function () {
  'use strict';

  const q = new URLSearchParams(window.location.search);

  // ══════════════════════════════════════════════════════════════════════
  //  TASTE BLOCK — CLAUDE.md rule 11. Every aesthetic value in this file is
  //  here. Nothing aesthetic is buried in a function body.
  // ══════════════════════════════════════════════════════════════════════
  const ENT = {
    // ?entrances=0 removes the whole pass at load, so an A/B can be measured on
    // ONE build instead of two checkouts. Same lever js/places.js exposes as
    // ?places=0 and js/drag.js as ?drag=0.
    on: q.get('entrances') !== '0',
    // ?entdetail=0 keeps the doors and drops the steps/rails/reveals, which is
    // how you tell "the entrances are missing" apart from "the entrances are
    // buried under their own stairs" without rebuilding anything.
    detail: q.get('entdetail') !== '0',
    // THE INSCRIPTION TEXT IS OFF BY DEFAULT. `?entlabels=1` brings it back,
    // and so does `ENT.labels = true; applyEntranceSettings(__map)` from the
    // console. See INSCRIPTIONS for the arithmetic behind the default.
    labels: q.get('entlabels') === '1',

    // A portal is ~3 m wide. Below 15.2 it is two pixels and the pass is only
    // costing frames. buildings-labels-major starts at 15.3, so this arrives
    // with the building names rather than before them.
    minZoom: 15.2,
    // Stairs, rails and reveals are 0.06-0.35 m features. They earn their place
    // one zoom step later than the door does.
    detailMinZoom: 16.0,

    opacity: 1.0,

    // Vertical gradient OFF, for the same reason js/places.js turns it off: it
    // darkens the BOTTOM of every extrusion, and the median piece here is
    // 0.35 m tall, so the whole piece falls inside the gradient and a stair
    // tread renders as a dark smear instead of a light one. The bake already
    // carries the vertical hierarchy in the tread/riser tones.
    verticalGradient: false,

    // ── night ─────────────────────────────────────────────────────────
    // THE RENDERER DOES NOT CHOOSE THE NIGHT GLASS ANY MORE. The bake authors a
    // pre-compensated warm `wn` on every glazing piece and this file passes it
    // through — see point 3 in the header, and the measurements there.
    //
    // Taste override, empty by default: {"#ffaa3c": "#ffd0a0", ...}. Any hex
    // listed here is swapped for its replacement at the night stop and nothing
    // else is touched, so retinting one family cannot silently flatten the rest
    // the way the old blanket list did.
    glassNightTint: {},
    // Used ONLY when a glazing piece has no `wn` at all, which the current file
    // never hits (0 of 1,398). It is a visible warm, deliberately: if this ever
    // starts showing up it should look like a bug, not like stone.
    glassNightFallback: '#ffb45c',
    // The audit that replaces the old override. A night colour is "suspect" if
    // its channels are within `neutralSpread` while its luma is at or above
    // `neutralLuma` — that is the Capitol pale-band signature, a value nobody
    // chose. Reported by entrancesStats().nightGlass; 0 in the current file.
    neutralSpread: 14,
    neutralLuma: 40,

    // The ground pool at a door. Ground metres, converted to px per zoom the
    // way js/night.js does it, so it scales with the world and not with the
    // screen. Deliberately smaller and dimmer than a streetlight pool: this is
    // spill off a doorway, not a fixture.
    pool: {
      on: true,
      minZoom: 14.8,
      groundM: [15, 7, 17, 9, 19, 11],   // zoom, radius in ground metres
      colorMain: '#ffc98a',
      colorOther: '#ffb877',
      opacityMain: 0.30,
      opacityOther: 0.16,
      blur: 1.0,
      nightStart: 0.58, nightFull: 0.85,   // only used if js/sky.js is absent
    },

    // ── the inscription band ──────────────────────────────────────────
    // The bake paints the band 10% toward white off the surround tone, which is
    // what a projecting course does. A band with letters cut into it reads
    // DARKER than the wall around it, not lighter, because every letter is a
    // shadow. This nudges it back the other way. Day/golden only — at night the
    // whole stone family is already at #21 and there is nothing to darken.
    signCarveDark: 0.13,

    // The inscription text, when ENT.labels is turned on. Every value here is
    // about keeping it ON ITS OWN BUILDING — see INSCRIPTIONS.
    label: {
      // z19.2 is roughly 0.29 m of ground per pixel: you are standing at the
      // portal, not flying over it. At the z16-19 the camera actually flies,
      // the text is simply absent.
      minZoom: 19.2,
      // Metres from the band, on the ground. Beyond this the words are further
      // from their wall than they are wide, which is when they start reading as
      // an annotation floating over whatever happens to be in front.
      maxDistM: 110,
      // Degrees off the band's own outward normal. Past this you are looking
      // along the wall or at the back of the building, and a symbol layer has
      // no depth test — this is the check that stands in for one.
      arcDeg: 62,
      // Degrees off the direction the camera is POINTING. Distance and facing
      // together still admit a band that is 87° out to the side — measured, at
      // the Battle Hall night pose, where the camera stands 45 m in front of
      // the Main Building's inscription while looking west at Battle. MapLibre
      // culls it, but then the guarantee is MapLibre's frustum and not this
      // gate's, and the whole point of this gate is not to depend on the
      // renderer for that. Roughly the half-width of the frame: at 1440x900
      // and MapLibre's default fov the horizontal half-angle is ~28°.
      viewArcDeg: 40,
      // Screen-pixel type size. Deliberately small: this is lettering on a
      // 1.10 m course, not a place name.
      size: [19.2, 9, 20, 12, 21, 15],   // zoom, px, ...
      // Limestone with its own shadow, not a map annotation's white-on-halo.
      color: '#efe4cc',
      halo: '#3a3025',
      haloWidth: 0.9,
      letterSpacing: 0.22,   // em; an inscription is spaced, a caption is not
      // The band's mid-height, in metres, is converted to a screen offset each
      // time the camera moves so the words sit ON the course instead of across
      // the doors below it. Capped so a near-nadir view cannot fling them off
      // the top of the screen.
      risePxCap: 220,
    },

    // ── LOD ───────────────────────────────────────────────────────────
    // The LOD knob, read off GFX.treeDensity when the graphics menu has no
    // entDetail entry of its own. [treeDensity floor, detail level], first
    // match wins.
    //
    // THE FIRST CUT WAS A LINEAR RAMP AND IT WAS WRONG, measured not guessed:
    // `detail = 0.35 + 0.65 * treeDensity` puts the BALANCED preset — the
    // default, the one almost everyone sees — at 0.79, one step below the top,
    // which silently deleted all 1,752 reveals. A reveal is the shadow that
    // makes a doorway read as a hole in the wall rather than as a panel stuck
    // on it, so the default build was shipping the least convincing version of
    // the pass. Thinning should start BELOW the default, never at it.
    //   balanced/cinematic/ultra (0.675, 1.0, 1.0) -> everything
    //   performance             (0.52)             -> no reveals, no treads
    //   the ~30 fps auto-detect can go lower still  -> rails and ramps only
    detailByTrees: [[0.65, 1.00], [0.40, 0.70], [0.00, 0.40]],
    // Below this the DETAIL layer is not added at all rather than drawn thin.
    detailFloor: 0.34,

    // ── tiling ────────────────────────────────────────────────────────
    // NOT window.PATTERN_TILING. See point 2 in the header.
    tiling: { maxzoom: 18, tolerance: 0, buffer: 64 },
  };
  window.ENT = ENT;

  const SRC = 'austin-entrances';
  const L_PORTAL = 'entrances-portal';
  const L_GLASS = 'entrances-glass';
  const L_DETAIL = 'entrances-detail';
  const L_POOL = 'entrances-pool';
  const L_LABEL = 'entrances-inscription';
  const DATA = 'data/entrances.geojson';

  // Which kinds are the portal and which are the detail. The bake's `k`
  // vocabulary is exactly these eleven; anything it grows later lands in PORTAL
  // by default, which is the safe failure (drawn too early, not never).
  const DETAIL_KINDS = ['step', 'reveal', 'rail', 'ramp'];
  const GLASS_KINDS = ['glass', 'transom'];

  /**
   * THE CARVED TEXT, AND WHY IT IS OFF BY DEFAULT.
   *
   * Simeon asked for accurate text and these are the only two buildings on the
   * Forty Acres whose lettering could be sourced (docs/entrances/celebrated.md
   * §MAI and §GAR; the bake carries the same two entries in its INSCRIPTIONS
   * table and nothing else, because nothing else could be cited). The WORDS
   * below are right and are copied from that document, not paraphrased. What
   * was wrong was the drawing, and the fix is that by default there isn't one.
   *
   * ── WHY IT CANNOT BE CARVED AS GEOMETRY ─────────────────────────────
   * The Main Building's inscription band, as baked, is 8.29 m long and 1.10 m
   * tall. Nicar's own constraint is 108 letters and spaces for the twelve
   * words; split either side of the seal that is 23 characters on the left. Fit
   * 23 characters into the ~3.2 m the band gives a clause and one letter is
   * 0.14 m wide with a 0.023 m stroke. This app's camera is at z16-19 for the
   * whole flight, where one screen pixel is 2.0 m to 0.25 m of ground; even
   * pinned to MapLibre's z22 ceiling a pixel is 0.032 m. A 0.023 m stroke is
   * therefore under one pixel at EVERY zoom the app can reach. Carving it would
   * put ~1,700 sub-pixel boxes on two buildings and render them as a shimmering
   * speckle that aliases differently every frame. Garrison Hall is worse: six
   * names across a 4.66 m band is a 0.117 m cap height.
   *
   * ── AND WHY A LABEL WAS NOT THE ANSWER EITHER ───────────────────────
   * The same arithmetic run the other way is what killed it. Type you can
   * actually read starts at about 9 px; 108 characters at 9 px is ~500 px wide.
   * At z18.6 the band it annotates is 24 px. So a readable label is TWENTY
   * TIMES the width of the thing it is labelling, which on the ground is 85 m
   * of text either side of an 8 m course. MapLibre symbol layers do not depth
   * test against fill-extrusions, so those 500 px land on whatever is in front:
   * shots/entb-MAI-day.png has this sentence lying across the Biological
   * Laboratories 200 m short of the Main Building, and shots/entb-BTL-night.png
   * has it across the Flawn Academic Center in a frame aimed at Battle Hall.
   * There is no zoom where the text is both legible AND at the scale of its own
   * band, so there is no setting of this layer that is honest by default.
   *
   * This is the call scripts/bake_places.py already made for shopfronts: "from
   * the 200-900 m the camera actually flies at ... a logo is three or four
   * pixels and unreadable, while the SIGN COLOUR is a 12 m x 1 m band that
   * reads clearly". It shipped sign colour and no artwork. The equivalent here
   * is the BAND — drawn, and darkened toward its own shadow (ENT.signCarveDark)
   * so a course with letters cut into it reads incised rather than lit. That is
   * what a 0.023 m stroke honestly looks like from the air.
   *
   * ── THE WORDS ARE STILL HERE ────────────────────────────────────────
   * `?entlabels=1` turns the text on, and entrancesStats().inscriptions carries
   * the full sourced strings whether it is on or not, so the accuracy Simeon
   * asked for lives in the app rather than only in a data file. When it IS on
   * it is bound to the geometry rather than floating: gated to ENT.label.minZoom,
   * to ENT.label.maxDistM of its own band, and to ENT.label.arcDeg of that
   * band's outward normal — the facing test standing in for the depth test
   * MapLibre will not do — and lifted to the course's own height each time the
   * camera moves. Those three gates are what make the flag safe to flip; they
   * are not what makes it a good default.
   *
   * If a future pass ever gives the Main Building its real ~30 m frieze instead
   * of an 8.3 m band, carving becomes worth re-testing: at 30 m the same 23
   * characters are 0.22 m letters with a 0.036 m stroke, which resolves at z20.
   */
  const INSCRIPTIONS = {
    // [C] John 8:32 KJV, chosen by the Faculty Building Committee under
    // Dr William Battle, approved by the Board of Regents 28 September 1935
    // (Nicar, "The Inscription", UT History Corner). Two clauses either side of
    // the University seal, twelve words. THE COMMA IS UNRESOLVED between the
    // Alcalde (which prints one) and Nicar (which does not); rendered without,
    // exactly as the bake carves it, and flagged here rather than silently
    // picked. The seal divides the clauses, so the label does too.
    MAI: 'YE SHALL KNOW THE TRUTH   ·   AND THE TRUTH SHALL MAKE YOU FREE',
    // [C] founders of the Republic of Texas, carved below the eaves. The source
    // says "among them", so six is a FLOOR and not a total — which is why this
    // is rendered as a list and not as a sentence.
    GAR: 'HOUSTON · AUSTIN · BURNET · JONES · TRAVIS · LAMAR',
  };

  const SCENE_LAT = 30.285;
  const mPerPx = z => 156543.03392 * Math.cos(SCENE_LAT * Math.PI / 180) / Math.pow(2, z);
  const clamp01 = v => Math.max(0, Math.min(1, v));

  // ── colour ──────────────────────────────────────────────────────────
  function hexToRgb(hex) {
    const h = String(hex || '#888888').replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function mixHex(a, b, t) {
    const A = hexToRgb(a), B = hexToRgb(b);
    const c = i => Math.round(A[i] + (B[i] - A[i]) * t).toString(16).padStart(2, '0');
    return '#' + c(0) + c(1) + c(2);
  }

  /** ['interpolate', p, wd, wg, wn] — the shape timeofday.js bakes with, and
   *  the shape js/places.js already uses, so this pass and the shopfronts agree
   *  about when dusk is. `night` may be an expression, not just ['get','wn']. */
  function ramp(p, night) {
    p = clamp01(p);
    return ['interpolate', ['linear'], p,
      0, ['to-color', ['get', 'wd'], '#888888'],
      0.5, ['to-color', ['get', 'wg'], '#888888'],
      1, night,
    ];
  }

  /**
   * Night colour for glazing: THE FEATURE'S OWN `wn`, and nothing else unless
   * ENT.glassNightTint has been given entries by hand.
   *
   * This function used to force a lit tone over a list of four "dim" hexes the
   * bake was writing. The bake stopped writing them — every glazing piece is
   * authored warm and pre-compensated now — so the list matched nothing and the
   * expression fell through to `wn` anyway. It was dead code that read like
   * live code, which is a worse failure than a wrong colour: the next reader
   * would have believed the renderer was doing the lighting and gone looking
   * for the bug here. Deleted rather than repointed. Do NOT restore it — the
   * tones it forced are the ones that measured neutral in §86.
   */
  function nightGlass() {
    const own = ['to-color', ['get', 'wn'], ENT.glassNightFallback];
    const keys = Object.keys(ENT.glassNightTint || {});
    if (!keys.length) return own;
    const m = ['match', ['to-string', ['get', 'wn']]];
    for (const k of keys) m.push(k, ENT.glassNightTint[k]);
    m.push(own);
    return m;
  }

  /**
   * The audit that replaces the override: over every glazing piece in the file,
   * how many night colours are a neutral nobody chose. Reported by
   * entrancesStats().nightGlass so a verification script can watch it without a
   * screenshot, and logged loudly at init if it is ever non-zero.
   */
  function auditNightGlass(features) {
    let suspect = 0, dark = 0, missing = 0, n = 0;
    const seen = {};
    for (const f of features) {
      const pr = f.properties;
      if (GLASS_KINDS.indexOf(pr.k) < 0) continue;
      n++;
      if (!pr.wn) { missing++; continue; }
      seen[pr.wn] = (seen[pr.wn] || 0) + 1;
      const [r, g, b] = hexToRgb(pr.wn);
      const spread = Math.max(r, g, b) - Math.min(r, g, b);
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (spread <= ENT.neutralSpread && luma >= ENT.neutralLuma) suspect++;
      else if (luma < ENT.neutralLuma) dark++;
    }
    return { glass: n, tones: Object.keys(seen).length, neutralSuspect: suspect,
             dark, missingWn: missing };
  }

  /**
   * The inscription band, darkened toward its own shadow so a course with
   * letters cut into it does not read as a course with a light on it. Applied
   * by day and golden only, and only to the limestone bands — `k` is also
   * `sign` on Battle's and Sutton's LANTERNS, which are steel and must stay
   * bright at night (that is the entire point of them). `mat` separates them.
   */
  function portalColor(p) {
    p = clamp01(p);
    // There is no arithmetic on colours inside a style expression, so the mix
    // is done HERE, per stop, against the band tones the bake actually wrote —
    // collected from the loaded file at init rather than typed in from memory,
    // and falling through to the feature's own colour for anything unlisted.
    const stop = (key) => {
      const tones = _signTones[key] || [];
      const own = ['to-color', ['get', key], '#888888'];
      if (!tones.length) return own;
      const m = ['match', ['to-string', ['get', key]]];
      for (const hex of tones) m.push(hex, mixHex(hex, '#000000', ENT.signCarveDark));
      m.push(own);
      return ['case',
        ['all', ['==', ['get', 'k'], 'sign'], ['==', ['get', 'mat'], 'limestone']],
        m, own];
    };
    return ['interpolate', ['linear'], p,
      0, stop('wd'),
      0.5, stop('wg'),
      1, ['to-color', ['get', 'wn'], '#333344'],
    ];
  }
  // Filled from the real file at init, so the carve mix is against the tone the
  // bake actually wrote and not against a hex typed in from memory.
  const _signTones = { wd: [], wg: [] };

  // ── LOD ─────────────────────────────────────────────────────────────
  function detailLevel() {
    const g = window.GFX;
    if (!ENT.detail) return 0;
    if (g && typeof g.entDetail === 'number') return clamp01(g.entDetail);
    const t = (g && typeof g.treeDensity === 'number') ? g.treeDensity : 1;
    for (const [floor, level] of ENT.detailByTrees) if (t >= floor) return clamp01(level);
    return 0;
  }
  /**
   * The DETAIL filter. There is no per-feature quantile in this file — the bake
   * owns it and this lane may not add one — so the thinning is by KIND, in the
   * order they stop being worth their pixels: 3,710 stair treads first, then the
   * 1,752 reveals, and rails and ramps last because a rail is the thing that
   * says "this is a stair" once the treads are gone.
   */
  function detailFilter() {
    const d = detailLevel();
    const keep = d >= 0.85 ? DETAIL_KINDS
      : d >= 0.60 ? ['step', 'rail', 'ramp']
      : ['rail', 'ramp'];
    return ['match', ['get', 'k'], keep, true, false];
  }

  // ── the inscription gate ────────────────────────────────────────────
  // Everything below exists for one reason: a MapLibre symbol layer has no
  // depth test against fill-extrusions, so "is this text on the right
  // building" has to be answered in JS or not at all. §86 is what "not at all"
  // looks like.
  let _labelFeatures = [];
  let _gateWired = false, _gateLast = '', _gateState = null;

  /** Metres per degree at this latitude, so the tests are in metres. */
  const M_LON = 111320 * Math.cos(SCENE_LAT * Math.PI / 180);
  const M_LAT = 110540;

  /**
   * Outward normal of the wall an entrance sits in, as a unit vector in metre
   * space. Derived from the entrance's own pieces: steps, ramps and rails are
   * outside the wall, doors are in it, so door -> step points out. Falls back to
   * the door -> whole-entrance offset, and finally to due north, which is a
   * value that will fail the facing test rather than pass it wrongly.
   */
  function outwardNormal(features, eid, at) {
    let dx = 0, dy = 0, nOut = 0, cx = 0, cy = 0, nIn = 0;
    for (const f of features) {
      const pr = f.properties;
      if (pr.eid !== eid) continue;
      const out = pr.k === 'step' || pr.k === 'ramp' || pr.k === 'rail';
      const inn = pr.k === 'door' || pr.k === 'glass' || pr.k === 'reveal';
      if (!out && !inn) continue;
      const ring = f.geometry.coordinates[0];
      let x = 0, y = 0, n = 0;
      for (const pt of ring) { x += pt[0]; y += pt[1]; n++; }
      if (!n) continue;
      if (out) { dx += x / n; dy += y / n; nOut++; }
      else { cx += x / n; cy += y / n; nIn++; }
    }
    if (!nOut || !nIn) return [0, 1];
    const vx = (dx / nOut - cx / nIn) * M_LON;
    const vy = (dy / nOut - cy / nIn) * M_LAT;
    const len = Math.hypot(vx, vy);
    if (!(len > 0.05)) return [0, 1];
    return [+(vx / len).toFixed(4), +(vy / len).toFixed(4)];
  }

  /**
   * WHERE THE EYE ACTUALLY IS. It is NOT map.getCenter(): at pitch 62 the
   * centre is the point the camera is aimed at, ~90 m in front of the eye, and
   * a distance-from-the-band test run on the centre passes happily with the
   * building behind you. That is not a hypothetical — this gate was written
   * against `map.getFreeCameraOptions()`, WHICH DOES NOT EXIST IN MAPLIBRE.
   * It is Mapbox GL JS's API; MapLibre 5.24.0 has `transform.getCameraLngLat()`
   * instead. The first version caught the throw, fell back to getCenter(), and
   * therefore reported every pose as "camera at the door, distance 0, facing
   * test skipped" — a gate that passed everything while looking like it was
   * working. Probed, not assumed: `typeof map.getFreeCameraOptions` is
   * "undefined" on 5.24.0.
   *
   * So: the transform's own value first, and if a future MapLibre renames it,
   * an ANALYTIC fallback rather than a wrong-but-quiet one. The camera sits
   * `cameraToCenterDistance * sin(pitch)` pixels behind the centre along the
   * bearing, and cameraToCenterDistance is 0.5 * viewport height / tan(fov/2).
   */
  function cameraLngLat(map) {
    const t = map.transform;
    if (t && typeof t.getCameraLngLat === 'function') {
      const c = t.getCameraLngLat();
      if (c && isFinite(c.lng) && isFinite(c.lat)) return c;
    }
    const centre = map.getCenter();
    const h = (map.getCanvas && map.getCanvas().clientHeight) || 900;
    const fov = (t && (t.fov || t._fov)) || 36.87;
    const c2c = (t && t.cameraToCenterDistance) || 0.5 * h / Math.tan(fov * Math.PI / 360);
    // mPerPx()/2 — the true 512-px-tile ground scale. See labelRisePx.
    const backM = c2c * Math.sin(map.getPitch() * Math.PI / 180) * mPerPx(map.getZoom()) / 2;
    const th = (map.getBearing() + 180) * Math.PI / 180;
    return {
      lng: centre.lng + (backM * Math.sin(th)) / M_LON,
      lat: centre.lat + (backM * Math.cos(th)) / M_LAT,
    };
  }

  /**
   * Which inscriptions may be drawn from where the camera is standing right
   * now. Three tests, all in world units:
   *   zoom     — ENT.label.minZoom, the "you are at the portal" gate
   *   distance — ENT.label.maxDistM from the band
   *   facing   — within ENT.label.arcDeg of the band's outward normal
   */
  function visibleInscriptions(map) {
    if (!ENT.on || !ENT.labels || !_labelFeatures.length) return [];
    const L = ENT.label;
    if (map.getZoom() < L.minZoom) return [];
    const eye = cameraLngLat(map);
    const cosArc = Math.cos(L.arcDeg * Math.PI / 180);
    const cosView = Math.cos(L.viewArcDeg * Math.PI / 180);
    const br = map.getBearing() * Math.PI / 180;
    const look = [Math.sin(br), Math.cos(br)];
    const out = [];
    for (const f of _labelFeatures) {
      const c = f.geometry.coordinates, pr = f.properties;
      const vx = (eye.lng - c[0]) * M_LON;
      const vy = (eye.lat - c[1]) * M_LAT;
      const d = Math.hypot(vx, vy);
      if (d > L.maxDistM || d < 0.5) continue;
      // camera stands in front of the wall the band is cut into
      if ((vx * pr.nx + vy * pr.ny) / d < cosArc) continue;
      // ...and is pointing at it, not merely near it
      if ((-vx * look[0] + -vy * look[1]) / d < cosView) continue;
      out.push(f);
    }
    return out;
  }

  /**
   * Lift the words to the course they are cut into. A symbol's anchor is at
   * ground level, which is why §86's inscription landed across its own doors.
   *
   * TWO THINGS HERE WERE WRONG THE FIRST TIME AND ONLY THE PIXELS SAID SO.
   * The first version was `h / mPerPx(zoom) * cos(pitch)` and it put the words
   * a full band-and-a-half low. Both factors were wrong:
   *
   *   cos -> sin. A world-vertical offset produces NO screen displacement
   *   looking straight down and a 1:1 one at the horizon, so it scales with
   *   sin(pitch), not cos.
   *
   *   mPerPx() IS TWO TIMES THE TRUE GROUND SCALE. js/controls.js already
   *   carries this finding: "MapLibre uses 512-px tiles. The 156543.03392
   *   constant found in most tutorials is the 256-px convention and yields
   *   exactly 2x". mPerPx() in this file is that constant, and js/night.js's is
   *   too. NOT changed here — the two files agree with each other and every
   *   light pool in the city is sized off them, so correcting it silently would
   *   double the radius of every pool in the scene. It is written down instead,
   *   and this one function uses the true scale locally.
   *
   * Plus the perspective term: raising a point moves it toward the camera, so
   * it also gets bigger. Measured against the painted band, magenta-masked,
   * four poses (predicted -> measured px of rise for a 5.71 m course):
   *   z19.6 pitch62  61.7 -> 62.0      z19.6 pitch45  50.4 -> 50.5
   *   z19.6 pitch75  65.7 -> 66.7      z20.4 pitch62 110.7 -> 111.0
   * Within 1.5% at the worst of the four, which is well inside a letter.
   */
  function labelRisePx(map, midH) {
    const t = map.transform;
    const mppTrue = mPerPx(map.getZoom()) / 2;      // see above: 512-px tiles
    const hPx = midH / mppTrue;
    const phi = map.getPitch() * Math.PI / 180;
    const c2c = (t && t.cameraToCenterDistance)
      || 0.5 * ((map.getCanvas && map.getCanvas().clientHeight) || 900)
             / Math.tan(((t && (t.fov || t._fov)) || 36.87) * Math.PI / 360);
    const persp = c2c / Math.max(1, c2c - hPx * Math.cos(phi));
    return -Math.min(ENT.label.risePxCap, hPx * Math.sin(phi) * persp);
  }

  function updateInscriptionGate(map) {
    const src = map.getSource && map.getSource(SRC + '-text');
    if (!src) return;
    const vis = visibleInscriptions(map);
    // Published so a verification script can read the gate's OWN decision.
    // querySourceFeatures() is a tile query and lags a setData by a frame or
    // two, which read as an inverted result the first time this was tested.
    _gateState = {
      zoom: +map.getZoom().toFixed(2),
      eye: (e => [+e.lng.toFixed(6), +e.lat.toFixed(6)])(cameraLngLat(map)),
      visible: vis.map(f => f.properties.ref),
      labelsOn: !!ENT.labels,
    };
    const key = vis.map(f => f.properties.ref).join(',');
    if (key !== _gateLast) {
      _gateLast = key;
      try { src.setData({ type: 'FeatureCollection', features: vis }); } catch (e) {}
    }
    if (!vis.length || !map.getLayer(L_LABEL)) return;
    // One translate for the layer, so it is the shortest band's rise when two
    // are on screen at once. There are two inscriptions in the whole file and
    // they are 70 m apart, so "two at once" is a nicety, not a case.
    const midH = Math.min(...vis.map(f => f.properties.midH));
    try { map.setPaintProperty(L_LABEL, 'text-translate', [0, labelRisePx(map, midH)]); } catch (e) {}
  }
  window.updateInscriptionGate = updateInscriptionGate;
  /** What the gate decided last time the camera moved. Read-only. */
  window.entrancesGateState = () => _gateState;

  function wireGate(map) {
    if (_gateWired) return;
    _gateWired = true;
    const run = () => { try { updateInscriptionGate(map); } catch (e) {} };
    map.on('move', run);
    map.on('moveend', run);
    map.on('zoom', run);
    run();
  }

  // ── layers ──────────────────────────────────────────────────────────
  function poolRadiusExpr() {
    const stops = [];
    for (let i = 0; i < ENT.pool.groundM.length; i += 2) {
      const z = ENT.pool.groundM[i];
      stops.push(z, +(ENT.pool.groundM[i + 1] / mPerPx(z)).toFixed(2));
    }
    return ['interpolate', ['exponential', 1.7], ['zoom'], ...stops];
  }

  let _added = false, _stats = null;

  window.initEntrances = async function initEntrances(map) {
    if (!ENT.on || _added || map.getSource(SRC)) return;
    _added = true;

    let gj;
    try {
      const r = await fetch(DATA);
      if (!r.ok) throw new Error(DATA + ': ' + r.status);
      gj = await r.json();
    } catch (e) {
      console.warn('[entrances]', e.message, '- pass not drawn');
      return;
    }
    // Read the band tones off the real file (see portalColor).
    for (const f of gj.features) {
      const pr = f.properties;
      if (pr.k !== 'sign' || pr.mat !== 'limestone') continue;
      for (const key of ['wd', 'wg']) {
        if (pr[key] && _signTones[key].indexOf(pr[key]) < 0) _signTones[key].push(pr[key]);
      }
    }

    // Streams as tiles the moment a later pass bakes the archive, without an
    // edit here. Asked through TILES.layers rather than tileSource() so an
    // absent entry is silence and not a console warning on every load.
    const tiled = (window.TILES && window.TILES.layers && window.TILES.layers.entrances
                   && window.tileSource) ? window.tileSource('entrances') : null;
    const lp = tiled ? tiled.layerProps : {};
    map.addSource(SRC, tiled ? tiled.source
      : { type: 'geojson', data: gj, ...ENT.tiling });

    // The inscription source: one point per carved band, so the label is a
    // point feature and not a polygon MapLibre has to find a centroid for on
    // every placement pass. Built here because this lane owns no bake.
    //
    // Each point ALSO carries its band's outward normal and its mid-height,
    // which is what lets the gate keep the words on their own building. The
    // normal is taken from the entrance's own step and ramp pieces: those sit
    // OUTSIDE the wall by construction, so door-centroid -> step-centroid points
    // out of the building. Same derivation the pose script uses to put a camera
    // in front of a door, and it lands on the campus grid, which is the check
    // that it is real and not a guess.
    const labelFeatures = [];
    for (const f of gj.features) {
      const pr = f.properties;
      if (pr.k !== 'sign' || pr.mat !== 'limestone') continue;
      const text = INSCRIPTIONS[pr.ref];
      if (!text) continue;
      const ring = f.geometry.coordinates[0];
      let x = 0, y = 0;
      for (let i = 0; i < 4; i++) { x += ring[i][0]; y += ring[i][1]; }
      const c = [x / 4, y / 4];
      const nrm = outwardNormal(gj.features, pr.eid, c);
      labelFeatures.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: c },
        properties: {
          ref: pr.ref, nm: pr.nm, text,
          nx: nrm[0], ny: nrm[1],
          // mid-height of the course, in metres — what the words are lifted to
          midH: +((pr.base || 0) + (pr.h || 0) / 2).toFixed(2),
        },
      });
    }
    _labelFeatures = labelFeatures;
    if (labelFeatures.length && !map.getSource(SRC + '-text')) {
      map.addSource(SRC + '-text', {
        type: 'geojson',
        // EMPTY at add time, always. The gate fills it, and the gate is the
        // only thing that ever puts a feature in front of the camera.
        data: { type: 'FeatureCollection', features: [] },
      });
    }

    const p = (window.__todCurrentP != null) ? window.__todCurrentP : 0.3;

    // The anchor must be the first symbol layer AFTER the buildings, not the
    // first in the style — the basemap puts symbol layers immediately after
    // `background`, so anchoring there drops the whole pass under the ground.
    // (js/places.js records the incident; the stadium went missing that way.)
    const stack = map.getStyle().layers;
    const after = Math.max(0, stack.findIndex(l => l.id === 'buildings-3d'));
    const anchor = (stack.slice(after + 1).find(l => l.type === 'symbol') || {}).id;

    // The light pool goes UNDER the building extrusions, so a wall occludes the
    // glow behind it instead of it shining through — the rule js/night.js and
    // js/props.js both follow.
    const underBuildings = ['buildings-shadow', 'buildings-ao', 'buildings-3d']
      .find(id => map.getLayer(id));

    if (ENT.pool.on && !map.getLayer(L_POOL)) {
      map.addLayer({
        id: L_POOL, type: 'circle', source: SRC, ...lp, minzoom: ENT.pool.minZoom,
        // One pool per DOOR LEAF, deliberately: a four-leaf main entrance
        // therefore glows about twice as hard as a single service door, with no
        // second field in the data and no per-entrance dedupe pass.
        filter: ['==', ['get', 'k'], 'door'],
        paint: {
          'circle-pitch-alignment': 'map',
          'circle-color': ['case', ['==', ['get', 'role'], 'main'],
                           ENT.pool.colorMain, ENT.pool.colorOther],
          'circle-blur': ENT.pool.blur,
          'circle-radius': poolRadiusExpr(),
          'circle-opacity': 0,     // driven by applyEntranceColors
        },
      }, underBuildings);
    }

    // Stairs, rails, reveals, ramps. Added BEFORE the portal layer so the door
    // and its glazing draw over the stair nosings where they overlap at the
    // threshold — depth testing sorts the rest.
    if (!map.getLayer(L_DETAIL)) {
      map.addLayer({
        id: L_DETAIL, type: 'fill-extrusion', source: SRC, ...lp,
        minzoom: ENT.detailMinZoom,
        filter: detailFilter(),
        paint: {
          'fill-extrusion-color': ramp(p, ['to-color', ['get', 'wn'], '#333344']),
          // base + h. NOT h. See point 1 in the header.
          'fill-extrusion-height': ['+', ['get', 'base'], ['get', 'h']],
          'fill-extrusion-base': ['get', 'base'],
          'fill-extrusion-opacity': ENT.opacity,
          'fill-extrusion-vertical-gradient': ENT.verticalGradient,
        },
      }, anchor);
    }

    // Doors, surrounds, canopies, columns, sign bands. One layer: they are all
    // flat colour off the feature's own ramp, so splitting them would buy
    // nothing and cost a draw call per frame.
    if (!map.getLayer(L_PORTAL)) {
      map.addLayer({
        id: L_PORTAL, type: 'fill-extrusion', source: SRC, ...lp,
        minzoom: ENT.minZoom,
        filter: ['match', ['get', 'k'], DETAIL_KINDS.concat(GLASS_KINDS), false, true],
        paint: {
          'fill-extrusion-color': portalColor(p),
          'fill-extrusion-height': ['+', ['get', 'base'], ['get', 'h']],
          'fill-extrusion-base': ['get', 'base'],
          'fill-extrusion-opacity': ENT.opacity,
          'fill-extrusion-vertical-gradient': ENT.verticalGradient,
        },
      }, anchor);
    }

    // Glazing last of the three, so a lit pane wins the pixel against its own
    // frame at night rather than losing it by a millimetre of z.
    if (!map.getLayer(L_GLASS)) {
      map.addLayer({
        id: L_GLASS, type: 'fill-extrusion', source: SRC, ...lp,
        minzoom: ENT.minZoom,
        filter: ['match', ['get', 'k'], GLASS_KINDS, true, false],
        paint: {
          'fill-extrusion-color': ramp(p, nightGlass()),
          'fill-extrusion-height': ['+', ['get', 'base'], ['get', 'h']],
          'fill-extrusion-base': ['get', 'base'],
          'fill-extrusion-opacity': ENT.opacity,
          'fill-extrusion-vertical-gradient': ENT.verticalGradient,
        },
      }, anchor);
    }

    if (labelFeatures.length && !map.getLayer(L_LABEL)) {
      map.addLayer({
        id: L_LABEL, type: 'symbol', source: SRC + '-text',
        minzoom: ENT.label.minZoom,
        layout: {
          'text-field': ['get', 'text'],
          // ONE font, not a fallback list. MapLibre requests a fontstack as a
          // single URL and OpenFreeMap serves only Noto Sans Regular/Bold/
          // Italic; a 404 glyph makes MapLibre discard the ENTIRE tile that
          // needed it (HANDOFF 7.12, and js/places.js carries the same note).
          'text-font': ['Noto Sans Bold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], ...ENT.label.size],
          'text-letter-spacing': ENT.label.letterSpacing,
          'text-max-width': 30,     // the clause split is the line break, not the wrap
          'text-padding': 4,
          'text-allow-overlap': false,
          'text-anchor': 'center',
          'visibility': ENT.labels ? 'visible' : 'none',
        },
        paint: {
          'text-color': ENT.label.color,
          'text-halo-color': ENT.label.halo,
          'text-halo-width': ENT.label.haloWidth,
          'text-halo-blur': 0.3,
          'text-opacity': 0.96,
          // Set live by updateInscriptionGate — the words are lifted to the
          // course rather than sitting on the ground under their own doors.
          'text-translate': [0, 0],
          'text-translate-anchor': 'viewport',
        },
        // Before buildings-labels: this is a two-of-them layer carrying sourced
        // carved text, and it should not lose its box to a building name.
      }, map.getLayer('buildings-labels-major') ? 'buildings-labels-major' : undefined);
    }

    // ── stats, including the `h` contract ──────────────────────────────
    let maxTop = 0, maxH = 0, entrances = new Set(), buildings = new Set();
    const byKind = {}, byRole = {};
    for (const f of gj.features) {
      const pr = f.properties;
      byKind[pr.k] = (byKind[pr.k] || 0) + 1;
      byRole[pr.role] = (byRole[pr.role] || 0) + 1;
      entrances.add(pr.eid); buildings.add(pr.bid);
      maxTop = Math.max(maxTop, pr.base + pr.h);
      maxH = Math.max(maxH, pr.h);
    }
    _stats = {
      features: gj.features.length,
      entrances: entrances.size, buildings: buildings.size,
      byKind, byRole,
      portal: gj.features.filter(f => DETAIL_KINDS.indexOf(f.properties.k) < 0
                                   && GLASS_KINDS.indexOf(f.properties.k) < 0).length,
      glass: gj.features.filter(f => GLASS_KINDS.indexOf(f.properties.k) >= 0).length,
      detail: gj.features.filter(f => DETAIL_KINDS.indexOf(f.properties.k) >= 0).length,
      // The sourced words themselves, on by default or not, so "is the text
      // accurate" is answerable from the console without turning on a layer.
      inscriptions: labelFeatures.map(f => ({
        ref: f.properties.ref, nm: f.properties.nm, text: f.properties.text,
        normal: [f.properties.nx, f.properties.ny], midH: f.properties.midH,
      })),
      inscriptionsDrawn: ENT.labels,
      // Watch this instead of the expression. `neutralSuspect` is the §86
      // defect counted directly in the file: a night colour whose channels are
      // within ENT.neutralSpread while its luma is ENT.neutralLuma or over.
      nightGlass: auditNightGlass(gj.features),
      detailLevel: +detailLevel().toFixed(2),
      tiled: !!tiled,
      // Measured, not asserted from the schema: 6.81 m read as a thickness and
      // 6.59 m read as a top. A verification script can watch this pair without
      // a screenshot — see point 1 in the header for why the damage of getting
      // it wrong is at the BOTTOM of the range and not the top.
      hContract: { asThickness: +maxTop.toFixed(2), asTop: +maxH.toFixed(2) },
      signTones: _signTones.wd.slice(),
    };
    console.log('[entrances]', _stats.entrances, 'entrances on', _stats.buildings,
                'buildings,', _stats.features, 'pieces (', _stats.portal, 'portal /',
                _stats.glass, 'glass /', _stats.detail, 'detail ), detail level',
                _stats.detailLevel, ', inscriptions:',
                _stats.inscriptions.map(i => i.ref).join(',') || 'none',
                _stats.inscriptionsDrawn ? '(drawn, ?entlabels=1)' : '(text off by default)');
    if (_stats.nightGlass.neutralSuspect || _stats.nightGlass.missingWn) {
      console.warn('[entrances] NIGHT GLASS IS GOING NEUTRAL —',
                   _stats.nightGlass.neutralSuspect, 'of', _stats.nightGlass.glass,
                   'glazing pieces carry a colourless `wn`, and', _stats.nightGlass.missingWn,
                   'carry none at all. This is the §86 defect; fix it in the bake, not here.');
    }

    wireDensity(map);
    wireGate(map);
    window.applyEntranceColors(map, p);
  };

  window.entrancesStats = () => _stats;

  window.applyEntranceColors = function applyEntranceColors(map, p) {
    if (!map || !map.getLayer) return;
    const set = (id, prop, v) => { try { if (map.getLayer(id)) map.setPaintProperty(id, prop, v); } catch (e) {} };
    set(L_PORTAL, 'fill-extrusion-color', portalColor(p));
    set(L_DETAIL, 'fill-extrusion-color', ramp(p, ['to-color', ['get', 'wn'], '#333344']));
    set(L_GLASS, 'fill-extrusion-color', ramp(p, nightGlass()));

    // The pool comes up on night.js's own lamp schedule, so the doorways light
    // at the same moment the streetlights do rather than in a second wave.
    const B = (typeof window.skyBodies === 'function') ? window.skyBodies(p) : null;
    const t = (B && typeof B.lamps === 'number') ? B.lamps
      : clamp01((p - ENT.pool.nightStart) / (ENT.pool.nightFull - ENT.pool.nightStart));
    set(L_POOL, 'circle-opacity',
      ['case', ['==', ['get', 'role'], 'main'],
       ENT.pool.opacityMain * t, ENT.pool.opacityOther * t]);
  };

  window.applyEntranceDensity = function applyEntranceDensity(map) {
    if (!map || !map.getLayer || !map.getLayer(L_DETAIL)) return;
    try {
      const d = detailLevel();
      map.setLayoutProperty(L_DETAIL, 'visibility',
        (ENT.on && d >= ENT.detailFloor) ? 'visible' : 'none');
      map.setFilter(L_DETAIL, detailFilter());
    } catch (e) {}
  };

  /** Re-read ENT after a live edit from the console. */
  window.applyEntranceSettings = function applyEntranceSettings(map) {
    if (!map || !map.getLayer) return;
    for (const id of [L_PORTAL, L_GLASS, L_DETAIL]) {
      if (!map.getLayer(id)) continue;
      try {
        map.setLayoutProperty(id, 'visibility', ENT.on ? 'visible' : 'none');
        map.setPaintProperty(id, 'fill-extrusion-opacity', ENT.opacity);
        map.setPaintProperty(id, 'fill-extrusion-vertical-gradient', ENT.verticalGradient);
      } catch (e) {}
    }
    if (map.getLayer(L_LABEL)) {
      try {
        map.setLayoutProperty(L_LABEL, 'visibility',
                              (ENT.on && ENT.labels) ? 'visible' : 'none');
        map.setLayoutProperty(L_LABEL, 'text-size',
                              ['interpolate', ['linear'], ['zoom'], ...ENT.label.size]);
        map.setPaintProperty(L_LABEL, 'text-color', ENT.label.color);
        map.setPaintProperty(L_LABEL, 'text-halo-color', ENT.label.halo);
        map.setPaintProperty(L_LABEL, 'text-halo-width', ENT.label.haloWidth);
      } catch (e) {}
      // Re-run the gate: flipping ENT.labels on must not put stale features in
      // the source, and flipping it off must empty it rather than leave the
      // last frame's words parked in a hidden layer.
      _gateLast = null;
      try { updateInscriptionGate(map); } catch (e) {}
    }
    if (map.getLayer(L_POOL)) {
      try { map.setLayoutProperty(L_POOL, 'visibility', ENT.on ? 'visible' : 'none'); } catch (e) {}
    }
    window.applyEntranceDensity(map);
    window.applyEntranceColors(map, window.__todCurrentP != null ? window.__todCurrentP : 0.3);
  };

  // js/graphics.js owns the quality presets and the ~30 fps auto-detect and
  // calls window.applyTreeDensity on every settings change. Riding that call is
  // how this pass moves with the presets WITHOUT editing js/graphics.js, which
  // this lane does not own — the same wrapper js/props.js installs, and it
  // composes with it because each one calls the previous.
  function wireDensity(map) {
    if (window.__entDensityWired) return;
    window.__entDensityWired = true;
    const prev = window.applyTreeDensity;
    window.applyTreeDensity = function (m) {
      if (typeof prev === 'function') prev(m);
      try { window.applyEntranceDensity(m || map); } catch (e) {}
    };
    window.applyEntranceDensity(map);
  }

  // ── bootstrap ───────────────────────────────────────────────────────
  // js/app.js is owned by another pass and will not call us. Copied from
  // js/places.js, including the applyTimeOfDay wrap and the global flag —
  // several passes wrap that same function and whichever boots last owns the
  // outermost closure, so a check written against the wrapper's own property
  // reads false for every pass except that one.
  function boot() {
    const map = window.__map;
    if (!map) return setTimeout(boot, 60);

    const hookTod = () => {
      if (typeof window.applyTimeOfDay !== 'function' || window.__entTodHooked) return;
      const prev = window.applyTimeOfDay;
      const wrapped = function (m, p) {
        const r = prev.apply(this, arguments);
        try { window.applyEntranceColors(m, p); } catch (e) {}
        return r;
      };
      wrapped.__entrances = true;
      window.applyTimeOfDay = wrapped;
      window.__entTodHooked = true;
    };

    const go = () => {
      // Wait for the core buildings. A door standing proud of a wall that does
      // not exist yet is invisible from every angle except straight down, and
      // the anchor search above depends on `buildings-3d` being in the style.
      if (!map.getLayer('buildings-3d')) return setTimeout(go, 120);
      hookTod();
      window.initEntrances(map);
    };
    if (map.isStyleLoaded && map.isStyleLoaded()) go();
    else map.once('load', () => setTimeout(go, 0));
  }
  boot();
})();
