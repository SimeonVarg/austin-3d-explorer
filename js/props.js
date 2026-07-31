/**
 * props.js — the small things that give a place scale and identity.
 *
 * Everything here comes from data/props.geojson (see scripts/bake_props.py).
 * Six kinds of feature, keyed by `k`:
 *
 *   art   UT's Landmarks collection — Clock Knot, Monochrome for Austin,
 *         Circle with Towers, The Torchbearers, Ellsworth Kelly's Austin…
 *         POSITION and NAME are factual, from OSM. The FORM IS NOT THE
 *         ARTWORK: we do not model di Suvero's steel or Rubins' aluminium
 *         boats. Each piece is a plinth-and-mass stand-in sized by its
 *         artwork_type; the NAME carries the identity, which is why the label
 *         matters more than the geometry here.
 *   furn  the low stuff — benches, bins, bike racks, bollards, planters,
 *         shelters, scooters, hydrants, post boxes. A bench is what tells you
 *         how big the building behind it is.
 *   lamp  the tall thin stuff — lamp posts, bus-stop poles, flagpoles, masts,
 *         blue-light emergency phones. Its own layer because a lamp RUN is
 *         what draws a street, and that reads from much further out than a bin
 *         does; this layer comes in a full zoom level earlier than `furn`.
 *   lit   Point features at the head of every lamp and every emergency phone.
 *         Drawn as the pool of light the thing actually throws, so what we add
 *         participates in night instead of going flat black beside the
 *         streetlights js/night.js samples off the road network.
 *   line  fences, walls, hedges, flowerbeds and garden beds, extruded low from
 *         their REAL OSM geometry — not a stand-in box at the centroid.
 *   cons  current construction sites (Mulva Hall, Villas on 24th…).
 *
 * WHAT IS FACT AND WHAT IS NOT. Every feature carries `src`:
 *   osm   POSITION from OpenStreetMap.
 *   city  POSITION from a City of Austin survey — the ATD bike-rack inventory,
 *         the MetroBike kiosks, the public art collection. Where one of these
 *         exists it also sets the drawn SIZE (a 13-rack corral really is 6.5 m,
 *         a 15-dock station really is 11 m), and it beats the procedural rule.
 *   proc  POSITION placed by the rule named in `rule` — always riding real
 *         geometry (OSM path centrelines from data/ground.geojson, baked
 *         building footprints, OSM plaza polygons).
 * FORM is generative throughout. docs/GROUND_LIFE.md has the full ledger.
 *
 * COLOUR is per-kind and that is the point: a bench, a bollard and a bike rack
 * must not be the same box in the same grey. Each feature carries a colour
 * class `c` (wood / steel / dark / stone / green / glass / sign / blue) and the
 * layer resolves it through one `match`, blended day→golden→night like every
 * other palette in the scene.
 *
 * DENSITY. Every furn/lamp/lit feature carries `d`, a QUANTILE in 0..1, and the
 * layers filter `d <= density`. So 0.6 draws 60% of them whatever the file
 * holds, and the thinning drops bins and scooters before it drops a lamp run.
 * The knob rides GFX.propDensity when the graphics menu defines one and is
 * otherwise derived from GFX.treeDensity, so the existing quality presets and
 * the ~30 fps auto-detect already move it. See wireDensity() at the bottom.
 *
 * Public (window) API:
 *   initProps(map)             — add source + layers
 *   applyPropColors(map, p)    — retint (and re-light) for time-of-day p
 *   applyPropDensity(map)      — re-read the density knob
 *   PROPS                      — the taste block
 */
(function () {
  'use strict';

  const PROPS = {
    on: true,
    artMinZoom: 15.5,       // sculptures are 1–3 m wide; below this they are noise
    artLabelZoom: 16.6,     // the name is the payoff — but only when you're close
    lampMinZoom: 15.8,      // a lamp run draws a street from further out than a bin
    furnMinZoom: 16.6,      // benches and bins earn their place lower still
    lineMinZoom: 15.4,      // hedges and fences are mass, not detail
    litMinZoom: 14.6,       // the glow is the cheapest thing here and the furthest-read
    consMinZoom: 15.0,
    labelSize: [16.6, 10, 18.5, 13],   // zoom, px, zoom, px

    // Lamp light. Deliberately TIGHTER and dimmer than night.js's road pools —
    // these are walkway lamps standing among them, not a second copy of the
    // street lighting. Radii are px at the listed zooms.
    litRadius: [14.5, 1.6, 16, 5, 17.5, 13, 19.5, 34],
    litOpacity: 0.42,
    litCoreOpacity: 0.85,
    litBlur: 0.9,
    nightStart: 0.58, nightFull: 0.85,   // same handover as night.js

    // propDensity = base + span·treeDensity when the graphics menu has no knob
    // of its own. At the cinematic preset (trees 1.0) this is 1.0; at the
    // performance preset (0.52) it is 0.69 — furniture thins later than trees
    // because there is less of it and it is what gives the ground its scale.
    densityFromTrees: [0.35, 0.65],
  };
  window.PROPS = PROPS;

  const SRC = 'austin-props';
  const ART = 'props-art', FURN = 'props-furn', CONS = 'props-cons';
  const LAMP = 'props-lamp', LINE = 'props-line';
  const LIT = 'props-lit', LIT_CORE = 'props-lit-core';
  const ART_LBL = 'props-art-label';

  // ── Palette. Day / golden / night, blended the same way as every other. ──
  // Muted on purpose: the protected palette is terracotta roofs over tan/olive
  // walls, and the buildings have to keep winning the frame. Nothing here is
  // more saturated than a roof.
  const COL = {
    art:   ['#8d8f96', '#8a7a6a', '#20222c'],   // weathered metal & stone
    cons:  ['#c8a44a', '#c19040', '#2a2418'],   // site hoarding yellow
    // colour classes carried on `c`
    wood:  ['#7a6046', '#7c583a', '#191b22'],
    steel: ['#8d9198', '#8a7a68', '#1b1e26'],
    dark:  ['#4e5058', '#4c4238', '#15171d'],
    stone: ['#c0b49c', '#c3a781', '#1e202a'],
    green: ['#6f8a52', '#71804a', '#101a13'],
    glass: ['#a6b8c0', '#b09a86', '#1d222c'],
    sign:  ['#b0562f', '#b05226', '#241820'],
    // UT's blue-light phones stay blue after dark — that is the whole point of
    // them, and it is the one accent on a night path that is not sodium.
    blue:  ['#3f6ea6', '#4a6c95', '#2b4a75'],
  };
  const CLASSES = ['wood', 'steel', 'dark', 'stone', 'green', 'glass', 'sign', 'blue'];

  const hex2rgb = h => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
  const rgb2hex = (r,g,b) => '#' + [r,g,b].map(v =>
    Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join('');
  function pick(triple, p) {
    const a = p <= 0.5 ? triple[0] : triple[1];
    const b = p <= 0.5 ? triple[1] : triple[2];
    const t = p <= 0.5 ? p / 0.5 : (p - 0.5) / 0.5;
    const A = hex2rgb(a), B = hex2rgb(b);
    return rgb2hex(A[0]+(B[0]-A[0])*t, A[1]+(B[1]-A[1])*t, A[2]+(B[2]-A[2])*t);
  }
  /** ['match', ['get','c'], 'wood', '#..', …, fallback] */
  function classMatch(p) {
    const e = ['match', ['get', 'c']];
    for (const k of CLASSES) e.push(k, pick(COL[k], p));
    e.push(pick(COL.steel, p));
    return e;
  }
  const clamp01 = v => Math.max(0, Math.min(1, v));

  // ── density ──────────────────────────────────────────────────────────
  function density() {
    const g = window.GFX;
    if (g && typeof g.propDensity === 'number') return clamp01(g.propDensity);
    const t = (g && typeof g.treeDensity === 'number') ? g.treeDensity : 1;
    return clamp01(PROPS.densityFromTrees[0] + PROPS.densityFromTrees[1] * t);
  }
  /** filter for one `k`, gated by the density quantile */
  function kFilter(k) {
    const d = density();
    // `coalesce` rather than a bare `['get','d']`: `all` short-circuits today,
    // so an art/line/cons feature never reaches the comparison — but a filter
    // that type-errors takes the whole layer down silently, and that is not a
    // failure worth leaving one refactor away.
    return d >= 1
      ? ['==', ['get', 'k'], k]
      : ['all', ['==', ['get', 'k'], k], ['<=', ['coalesce', ['get', 'd'], 0], d]];
  }

  window.applyPropDensity = function applyPropDensity(map) {
    if (!map || !map.getLayer) return;
    for (const [id, k] of [[FURN, 'furn'], [LAMP, 'lamp'], [LIT, 'lit'], [LIT_CORE, 'lit']]) {
      try { if (map.getLayer(id)) map.setFilter(id, kFilter(k)); } catch (e) {}
    }
  };

  // js/graphics.js owns the quality presets and the ~30 fps auto-detect, and it
  // calls window.applyTreeDensity on every settings change. Riding that call is
  // how the prop density knob moves with the presets WITHOUT editing graphics.js
  // or app.js, which this workstream does not own. If a `propDensity` entry is
  // ever added to the graphics SCHEMA (the snippet is in docs/GROUND_LIFE.md),
  // density() picks it up automatically and this wrapper keeps working.
  function wireDensity(map) {
    if (window.__propsDensityWired) return;
    window.__propsDensityWired = true;
    const prev = window.applyTreeDensity;
    window.applyTreeDensity = function (m) {
      if (typeof prev === 'function') prev(m);
      try { window.applyPropDensity(m || map); } catch (e) {}
    };
  }

  // ── layers ───────────────────────────────────────────────────────────
  window.initProps = function initProps(map) {
    if (!PROPS.on || map.getSource(SRC)) return;
    map.addSource(SRC, { type: 'geojson', data: 'data/props.geojson' });
    const p = window.__todCurrentP != null ? window.__todCurrentP : 0.5;

    // The light pools go UNDER the building extrusions, so a tower occludes the
    // lamps behind it instead of glowing through — same rule night.js follows.
    const underBuildings = ['buildings-shadow', 'buildings-ao', 'buildings-3d']
      .find(id => map.getLayer(id));

    const radiusExpr = k => ['interpolate', ['exponential', 1.7], ['zoom'],
      ...PROPS.litRadius.map((v, i) => (i % 2 ? v * k : v))];

    if (!map.getLayer(LIT)) {
      map.addLayer({
        id: LIT, type: 'circle', source: SRC, minzoom: PROPS.litMinZoom,
        filter: kFilter('lit'),
        paint: {
          'circle-pitch-alignment': 'map',
          'circle-color': ['match', ['get', 'c'], 'blue', '#6fa8ff', '#ffc27a'],
          'circle-blur': PROPS.litBlur,
          'circle-radius': radiusExpr(1),
          'circle-opacity': 0,          // driven by applyPropColors
        },
      }, underBuildings);
    }
    if (!map.getLayer(LIT_CORE)) {
      map.addLayer({
        id: LIT_CORE, type: 'circle', source: SRC, minzoom: PROPS.litMinZoom + 1.2,
        filter: kFilter('lit'),
        paint: {
          'circle-pitch-alignment': 'map',
          'circle-color': ['match', ['get', 'c'], 'blue', '#bcd8ff', '#ffe6bd'],
          'circle-blur': 0.35,
          'circle-radius': radiusExpr(0.24),
          'circle-opacity': 0,
        },
      }, underBuildings);
    }

    if (!map.getLayer(CONS)) {
      map.addLayer({
        id: CONS, type: 'fill-extrusion', source: SRC, minzoom: PROPS.consMinZoom,
        filter: ['==', ['get', 'k'], 'cons'],
        paint: { 'fill-extrusion-color': pick(COL.cons, p),
                 'fill-extrusion-height': ['get', 'h'],
                 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 0.9 },
      });
    }
    // Fences, walls, hedges and flowerbeds: real geometry, drawn low. No
    // density filter — there are 142 of them and each one is a real edge.
    if (!map.getLayer(LINE)) {
      map.addLayer({
        id: LINE, type: 'fill-extrusion', source: SRC, minzoom: PROPS.lineMinZoom,
        filter: ['==', ['get', 'k'], 'line'],
        paint: { 'fill-extrusion-color': classMatch(p),
                 'fill-extrusion-height': ['get', 'h'],
                 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 1,
                 'fill-extrusion-vertical-gradient': true },
      });
    }
    if (!map.getLayer(FURN)) {
      map.addLayer({
        id: FURN, type: 'fill-extrusion', source: SRC, minzoom: PROPS.furnMinZoom,
        filter: kFilter('furn'),
        paint: { 'fill-extrusion-color': classMatch(p),
                 'fill-extrusion-height': ['get', 'h'],
                 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 1,
                 'fill-extrusion-vertical-gradient': true },
      });
    }
    if (!map.getLayer(LAMP)) {
      map.addLayer({
        id: LAMP, type: 'fill-extrusion', source: SRC, minzoom: PROPS.lampMinZoom,
        filter: kFilter('lamp'),
        paint: { 'fill-extrusion-color': classMatch(p),
                 'fill-extrusion-height': ['get', 'h'],
                 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 1,
                 'fill-extrusion-vertical-gradient': true },
      });
    }
    if (!map.getLayer(ART)) {
      map.addLayer({
        id: ART, type: 'fill-extrusion', source: SRC, minzoom: PROPS.artMinZoom,
        filter: ['==', ['get', 'k'], 'art'],
        paint: { 'fill-extrusion-color': pick(COL.art, p),
                 'fill-extrusion-height': ['get', 'h'],
                 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 1,
                 'fill-extrusion-vertical-gradient': true },
      });
    }
    if (!map.getLayer(ART_LBL)) {
      map.addLayer({
        id: ART_LBL, type: 'symbol', source: SRC, minzoom: PROPS.artLabelZoom,
        filter: ['==', ['get', 'k'], 'art'],
        layout: {
          'text-field': ['get', 'name'],
          // Only Noto Sans Regular/Bold/Italic exist on OpenFreeMap's glyph
          // server; a missing fontstack 404s and drops the whole tile.
          'text-font': ['Noto Sans Italic'],
          'text-size': ['interpolate', ['linear'], ['zoom'],
            PROPS.labelSize[0], PROPS.labelSize[1], PROPS.labelSize[2], PROPS.labelSize[3]],
          'text-anchor': 'bottom', 'text-offset': [0, -0.5],
          'text-max-width': 9, 'text-padding': 8, 'text-allow-overlap': false,
        },
        paint: {
          'text-color': '#f6ead2', 'text-halo-color': 'rgba(20,12,4,0.92)',
          'text-halo-width': 1.4, 'text-halo-blur': 0.4,
          'text-opacity': ['interpolate', ['linear'], ['zoom'],
            PROPS.artLabelZoom, 0, PROPS.artLabelZoom + 0.5, 0.9],
        },
      });
    }

    wireDensity(map);
    window.applyPropColors(map, p);
  };

  window.applyPropColors = function applyPropColors(map, p) {
    if (!map || !map.getLayer || !map.getLayer(ART)) return;
    const set = (id, prop, v) => { try { if (map.getLayer(id)) map.setPaintProperty(id, prop, v); } catch (e) {} };
    const cm = classMatch(p);
    set(ART, 'fill-extrusion-color', pick(COL.art, p));
    set(CONS, 'fill-extrusion-color', pick(COL.cons, p));
    set(FURN, 'fill-extrusion-color', cm);
    set(LAMP, 'fill-extrusion-color', cm);
    set(LINE, 'fill-extrusion-color', cm);

    // Lamps come on through dusk on the same ramp as night.js's streetlights,
    // so the two tiers arrive together rather than in two visible waves.
    const t = clamp01((p - PROPS.nightStart) / (PROPS.nightFull - PROPS.nightStart));
    set(LIT, 'circle-opacity', PROPS.litOpacity * t);
    set(LIT_CORE, 'circle-opacity', PROPS.litCoreOpacity * t);
  };
})();
