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
 *  3. AT NIGHT THE GLASS IS LIT AND THE STONE IS DARK. An entrance is one of
 *     the few things on a building that is genuinely lit after hours — a
 *     vestibule light burns all night while the offices above it are black. The
 *     bake writes glass `wn` at #4f493e, a dim warm grey, which is what glass
 *     REFLECTS at night, not what a lit lobby EMITS. So the glass layer's night
 *     stop is re-pointed at ENT.glassLit here rather than at the feature's own
 *     `wn` — except where the bake authored a bright `wn` on purpose (the Harry
 *     Ransom Center's #e8d9ae beacon, and Battle and Sutton's lanterns), which
 *     pass through untouched. See nightGlass(): the dim tones are listed by
 *     hex, so an authored bright one can never be overwritten by accident.
 *     Plus ENT.pool — a soft ground pool at every door, on night.js's own lamp
 *     schedule, because 1.2 m of lit glass is under a pixel from 300 m up and
 *     the pool is what actually says "that building is open" from the air.
 *
 *  4. THE INSCRIPTIONS ARE LABELS, NOT CARVING, AND THAT IS A MEASURED CALL.
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
    // ?entlabels=0 drops the two carved inscriptions' text.
    labels: q.get('entlabels') !== '0',

    // A portal is ~3 m wide. Below 15.2 it is two pixels and the pass is only
    // costing frames. buildings-labels-major starts at 15.3, so this arrives
    // with the building names rather than before them.
    minZoom: 15.2,
    // Stairs, rails and reveals are 0.06-0.35 m features. They earn their place
    // one zoom step later than the door does.
    detailMinZoom: 16.0,
    // The inscription text. Late on purpose — see INSCRIPTIONS.
    labelMinZoom: 17.4,
    labelSize: [17.4, 8.5, 19, 12.5, 20.5, 15],   // zoom, px, ...

    opacity: 1.0,

    // Vertical gradient OFF, for the same reason js/places.js turns it off: it
    // darkens the BOTTOM of every extrusion, and the median piece here is
    // 0.35 m tall, so the whole piece falls inside the gradient and a stair
    // tread renders as a dark smear instead of a light one. The bake already
    // carries the vertical hierarchy in the tread/riser tones.
    verticalGradient: false,

    // ── night ─────────────────────────────────────────────────────────
    // A lit vestibule seen from outside. Warmer and paler than the Drag's shop
    // glow (places.js T.NIGHT_TONE #ffce94) because a lobby is fluorescent-ish
    // and a shopfront is incandescent-ish, and because these sit in the middle
    // of dark stone rather than in a continuous lit run.
    glassLit: '#ffd9a4',
    // Three tones so 584 entrances are not one flat value. Keyed on `eid`, so a
    // whole entrance lights as one unit and it never flickers between repaints.
    glassLitVary: ['#ffd9a4', '#ffe6c0', '#f6c98c'],
    // The `wn` values the bake writes for UNLIT glass. Anything NOT in this list
    // is an authored night colour and passes through — that is the whole reason
    // this is a list of hexes rather than a blanket override.
    glassDim: ['#4f493e', '#4f483d', '#514a3e', '#4d463b'],

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

    // The inscription label's own colour: carved limestone with a deep shadow
    // halo, so it reads as lettering rather than as a map annotation.
    labelColor: '#f2ead6',
    labelHalo: '#2b241a',
    labelHaloWidth: 1.6,
    labelLetterSpacing: 0.22,   // em; an inscription is spaced, a caption is not

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
   * THE CARVED TEXT, AND WHY IT IS A LABEL.
   *
   * Simeon asked for accurate text and these are the only two buildings on the
   * Forty Acres whose lettering could be sourced (docs/entrances/celebrated.md
   * §MAI and §GAR; the bake carries the same two entries in its INSCRIPTIONS
   * table and nothing else, because nothing else could be cited). Everything
   * below is copied from that document, not paraphrased.
   *
   * I DID NOT CARVE THEM AS GEOMETRY, AND HERE IS THE ARITHMETIC.
   * The Main Building's inscription band, as baked, is 8.29 m long and 1.10 m
   * tall. Nicar's own constraint is 108 letters and spaces for the twelve
   * words; split either side of the seal that is 23 characters on the left. Fit
   * 23 characters into the ~3.2 m the band gives a clause and one letter is
   * 0.14 m wide with a 0.023 m stroke. This app's camera is at z16-19 for the
   * whole flight, where one screen pixel is 2.0 m to 0.25 m of ground; even
   * pinned to MapLibre's z22 ceiling a pixel is 0.032 m. A 0.023 m stroke is
   * therefore under one pixel at EVERY zoom the app can reach. Carving it would
   * put ~1,700 sub-pixel boxes on two buildings and render them as a shimmering
   * speckle that aliases differently every frame — the definition of unreadable
   * noise. Garrison Hall is worse: six names across a 4.66 m band is a 0.117 m
   * cap height.
   *
   * So the band is drawn as a band, darkened so it reads as incised (see
   * ENT.signCarveDark), and the WORDS are delivered as a symbol label that
   * arrives at z17.4 when you are close enough to care. It is honestly a label
   * and not a carving, and it is the only way the text is actually accurate on
   * screen rather than accurate in a data file.
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
   * Night colour for glazing. ENT.glassDim lists the tones the bake writes for
   * UNLIT glass; those become a lit vestibule, varied per ENTRANCE (not per
   * piece, or the two leaves of one door would be different colours) off `eid`.
   * Everything else — the Ransom Center's authored beacon, the Battle and
   * Sutton lanterns — keeps its own `wn`.
   */
  function nightGlass() {
    const v = ENT.glassLitVary.length ? ENT.glassLitVary : [ENT.glassLit];
    const vary = ['match', ['%', ['to-number', ['get', 'eid'], 0], v.length]];
    for (let i = 0; i < v.length - 1; i++) vary.push(i, v[i]);
    vary.push(v[v.length - 1]);
    return ['match', ['to-string', ['get', 'wn']],
      ENT.glassDim, vary,
      ['to-color', ['get', 'wn'], ENT.glassLit]];
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
    const labelFeatures = [];
    for (const f of gj.features) {
      const pr = f.properties;
      if (pr.k !== 'sign' || pr.mat !== 'limestone') continue;
      const text = INSCRIPTIONS[pr.ref];
      if (!text) continue;
      const ring = f.geometry.coordinates[0];
      let x = 0, y = 0;
      for (let i = 0; i < 4; i++) { x += ring[i][0]; y += ring[i][1]; }
      labelFeatures.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [x / 4, y / 4] },
        properties: { ref: pr.ref, nm: pr.nm, text },
      });
    }
    if (labelFeatures.length && !map.getSource(SRC + '-text')) {
      map.addSource(SRC + '-text', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: labelFeatures },
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
        minzoom: ENT.labelMinZoom,
        layout: {
          'text-field': ['get', 'text'],
          // ONE font, not a fallback list. MapLibre requests a fontstack as a
          // single URL and OpenFreeMap serves only Noto Sans Regular/Bold/
          // Italic; a 404 glyph makes MapLibre discard the ENTIRE tile that
          // needed it (HANDOFF 7.12, and js/places.js carries the same note).
          'text-font': ['Noto Sans Bold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], ...ENT.labelSize],
          'text-letter-spacing': ENT.labelLetterSpacing,
          'text-max-width': 30,     // the clause split is the line break, not the wrap
          'text-padding': 4,
          'text-allow-overlap': false,
          'text-anchor': 'bottom',
          'text-offset': [0, -0.4],
          'visibility': ENT.labels ? 'visible' : 'none',
        },
        paint: {
          'text-color': ENT.labelColor,
          'text-halo-color': ENT.labelHalo,
          'text-halo-width': ENT.labelHaloWidth,
          'text-halo-blur': 0.3,
          'text-opacity': 0.96,
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
      inscriptions: labelFeatures.map(f => f.properties.ref),
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
                _stats.detailLevel, ', inscriptions:', _stats.inscriptions.join(',') || 'none');

    wireDensity(map);
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
      } catch (e) {}
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
