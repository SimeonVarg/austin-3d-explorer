/**
 * westcampus.js — the ten West Campus student high-rises, as stacked bands.
 *
 * WHY THIS FILE EXISTS. Ten towers between 55 and 82 m stand in the four blocks
 * the camera flies through most, and every one of them arrived from Overture as
 * a single prism wearing ONE facade tile from grade to roofline. A wall pattern
 * has no vertical anchor (docs/PASS_COMMON.md section 3), so the two things that
 * actually distinguish these buildings — a parking podium at the bottom and a
 * crown at the top — could not be said at all.
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
    // Moontower's roof sign. Dark bronze letters by day, and the only thing in
    // this pass that gets BRIGHTER after dark.
    sign:  ['#8a4a22', '#b4622c', '#ff8a3c'],
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

  let _added = false;
  // The buildings layers' filters as they were BEFORE we subtracted the ten
  // replaced ids, so applyWestcampusSettings() can put the generic prisms back.
  // Without that, turning the pass off leaves ten holes in the city rather than
  // ten plain towers, and the A/B measures the wrong thing.
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

    // Stamp the facade pattern BEFORE addSource. MapLibre serialises a GeoJSON
    // source to its worker on addSource, so mutating the same objects afterwards
    // never reaches the tiles and every wall band renders with NO pattern —
    // which MapLibre draws as transparent, i.e. the towers disappear. app.js
    // documents the same trap for the stadium.
    let added = 0;
    if (typeof window.quantiseStadiumFacades === 'function') {
      added = window.quantiseStadiumFacades(map, gj.features);
    }

    map.addSource(SRC, { type: 'geojson', data: gj });

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
