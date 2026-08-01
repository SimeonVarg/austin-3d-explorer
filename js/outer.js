/**
 * outer.js — the outer ring: the rest of Austin, drawn cheap.
 *
 * THE PROBLEM. scripts/config.sh models 2.5 x 2.2 km. Fly two blocks past its
 * edge in any direction and the city stops dead — no downtown, no lake, no
 * neighbourhoods, just the basemap plain running to the horizon. The Capitol
 * pass (js/capitol.js) fixed one 600 m strip of that. This is the other 55 km2.
 *
 * THE CONSTRAINT. The core scene was ALREADY at its frame budget before this
 * existed — js/graphics.js measures the frame and drops itself to the
 * performance preset at ~30 fps. So the ring is not "more of the same city". It
 * is a second, cheaper class of building, and every cut is deliberate:
 *
 *   the core gets                        the outer ring gets
 *   ------------------------------------ ------------------------------------
 *   a facade pattern from the atlas      a flat baked colour  (towers excepted)
 *   buildings-ao, a 44 px blurred        nothing. That layer was measured at
 *     contact shadow per footprint         3.6 fps on 2,400 footprints alone
 *   a parapet roof cap (2nd extrusion)   nothing  (towers excepted)
 *   a swept ground shadow (shadows.js)   nothing
 *   an OSM label                         nothing
 *   hero palettes, OSM parts, pitched    nothing
 *     roofs, curated signage
 *   full Overture geometry               85% fewer vertices, holes dropped,
 *                                          largest ring only
 *   14 data-derived colour buckets       6 tones
 *   every footprint in the box           a minimum-area cull that GROWS with
 *                                          distance: 33,307 of 40,656 dropped
 *
 * THE ONE EXCEPTION is downtown towers (`t=1`, at or above 40 m). They keep the
 * core's facade pattern and a roof cap, because the skyline silhouette is the
 * entire reason the box reaches south to the lake, and they cost nothing extra
 * in atlas terms — facades.js:quantiseOuterFacades snaps them onto patterns
 * that already exist and never registers a new image.
 *
 * REGISTRATION. This module bootstraps itself: it waits for window.__map and
 * for the core building layers to exist, then inserts itself underneath them.
 * The only wiring needed is the script tag — see docs/OUTER_RING.md.
 *
 * Public (window) API:
 *   initOuter(map)            — add the source + layers (called automatically)
 *   applyOuterColors(map, p)  — retint for time-of-day p (hooked automatically)
 *   applyOuterSettings(map)   — re-read OUTER after a live edit / preset change
 *   OUTER                     — the taste block (below)
 */
(function () {
  'use strict';

  const q = new URLSearchParams(window.location.search);

  const OUTER = {
    // ?outer=0 removes the ring entirely at load. This exists for
    // scripts/verify/outer-perf.mjs, which measures the A/B on the same build
    // rather than on two checkouts.
    on: q.get('outer') !== '0',
    // Below this the ring is off screen anyway and the tiles are wasted work.
    // 12.6 is roughly "the whole box fills the frame".
    minZoom: 12.6,
    // At or above this a ring building is a tower: pattern + roof cap.
    // Matches TOWER_H in scripts/bake_outer.py, which stamps `t`.
    towerCap: true,
    opacity: 1.0,
  };
  window.OUTER = OUTER;

  const SRC = 'austin-outer';
  const L_FLAT = 'outer-3d';
  const L_TOWER = 'outer-tower';
  const L_TOWER_ROOF = 'outer-tower-roof';
  const DATA = 'data/outer_ring.geojson';

  const IS_TOWER = ['==', ['get', 't'], 1];
  const NOT_TOWER = ['!=', ['get', 't'], 1];

  /**
   * The density filter, shaped exactly like js/app.js:treeFilter.
   *
   * `d` is baked as an importance rank (0 = most worth drawing), so a density
   * below 1 thins the small and the far first, evenly, everywhere — instead of
   * deleting a neighbourhood. Towers rank in the top 1.6% and are never thinned
   * by any density above 0.02.
   */
  function densityFilter(base) {
    const dens = (window.GFX && typeof window.GFX.outerDensity === 'number')
      ? window.GFX.outerDensity : 1;
    return dens >= 1 ? base : ['all', base, ['<=', ['get', 'd'], dens]];
  }

  /** ['interpolate', p, day, golden, night] — the shape timeofday.js bakes with. */
  function tod(p, d, g, n) {
    p = Math.max(0, Math.min(1, p));
    return ['interpolate', ['linear'], p,
      0, ['to-color', ['get', d], '#888888'],
      0.5, ['to-color', ['get', g], '#888888'],
      1, ['to-color', ['get', n], '#333344'],
    ];
  }
  const bakedColor = p => tod(p, 'wd', 'wg', 'wn');
  const roofColor = p => tod(p, 'rd', 'rg', 'rn');

  async function getJSON(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(url + ': ' + r.status);
    return await r.json();
  }

  let _added = false;
  let _gj = null;          // kept for the palette-churn re-snap, below
  let _palSig = null;

  /** A cheap signature of the facade palette, to notice when it changes. */
  function paletteSignature() {
    try {
      return (window.facadePalette() || []).map(k => k.wd).join('|');
    } catch (e) { return null; }
  }

  /**
   * Re-snap the towers if the facade palette moved under them.
   *
   * Switching snapshot date re-runs quantiseFacades on the new buildings, which
   * re-derives the fourteen buckets FROM THAT DATA. If a bucket shifts, the
   * pattern ids the towers were stamped with at load either point at a
   * different colour now or stop being repainted by updateFacades at all — a
   * downtown that silently stops following the time of day.
   *
   * In practice the four snapshots on disk are the same buildings, so the
   * signature check makes this a no-op and the re-tile is never paid. It exists
   * so that stops being true quietly.
   */
  function resnapIfPaletteChanged(map) {
    if (!_gj || !map.getSource(SRC)) return;
    const sig = paletteSignature();
    if (!sig || sig === _palSig) return;
    _palSig = sig;
    const towers = _gj.features.filter(f => f.properties && f.properties.t === 1);
    const n = window.quantiseOuterFacades(towers);
    map.getSource(SRC).setData(_gj);
    console.log('[outer] facade palette changed —', n, 'towers re-snapped');
  }

  window.initOuter = async function initOuter(map) {
    if (!OUTER.on || _added || map.getSource(SRC)) return;
    _added = true;

    let gj;
    try {
      gj = await getJSON(DATA);
    } catch (e) {
      console.warn('[outer]', e.message, '- ring not drawn');
      return;
    }

    // The towers are stamped with a pattern id BEFORE addSource. MapLibre
    // serialises a GeoJSON source to its worker on addSource, so mutating the
    // same objects afterwards changes nothing on screen — the same trap
    // js/app.js documents for the stadium.
    let patterned = 0;
    const towers = gj.features.filter(f => f.properties && f.properties.t === 1);
    if (typeof window.quantiseOuterFacades === 'function') {
      patterned = window.quantiseOuterFacades(towers);
    }
    _gj = gj;
    _palSig = paletteSignature();

    // The snapshot picker is app.js's, and app.js is owned by another pass, so
    // this listens to the <select> rather than asking for a callback.
    const sel = document.getElementById('date-select');
    if (sel) sel.addEventListener('change', () => {
      // app.js refetches, re-quantises and setData()s the core source; give it
      // a beat to land before reading the palette it produced.
      setTimeout(() => resnapIfPaletteChanged(map), 1500);
    });

    map.addSource(SRC, {
      type: 'geojson',
      data: gj,
      // Three tiler settings, and all three are the point of this layer.
      //   maxzoom 15  stop generating tiles above z15. The spawn pose is z16.5,
      //               so the ring is permanently overzoomed — which is exactly
      //               the LOD wanted, and it means the tile set is built once
      //               instead of re-cut at every zoom the camera passes.
      //   tolerance   geojson-vt's own simplification, on top of the 85% the
      //               bake already removed. Cheap, and invisible at this range.
      //   buffer      left at MapLibre's default 128 on purpose. Lowering it
      //               saves duplicated geometry across tile seams and clips
      //               large footprints, which shows up as a wall face floating
      //               at a tile boundary — a visible artefact to save bytes
      //               that gzip mostly gets back anyway.
      // maxzoom 15 was already the right instinct and it is what
      // window.PATTERN_TILING generalised to every other patterned source after
      // the city-wide window flicker was traced to fill-extrusion-pattern being
      // TILE-anchored and cross-faded between zoom levels. This source was the
      // one that never got it, and it is the one carrying the 114 downtown
      // towers' curtain-wall pattern (L_TOWER below) from OUTER.minZoom 12.6 —
      // so a descent over downtown crosses an uncapped tile boundary and blends
      // two scales of the same window grid onto one tower face. Same defect,
      // most-filmed subject in the scene.
      //
      // Spread the shared block rather than restating the numbers, so the ring
      // can never drift away from the rest of the city again. It resolves to
      // maxzoom 16 / tolerance 0.5 / buffer 128 — a z16 tile is ~611 m and the
      // ring's own bake has already removed 85% of its vertices, so the finer
      // tolerance costs little and buys back the "wall face floating at a tile
      // boundary" clipping this comment used to worry about.
      ...(window.PATTERN_TILING || { maxzoom: 15, tolerance: 1.5 }),
    });

    // Underneath everything of ours. `buildings-ao` is the first layer app.js
    // adds for the core, so inserting before it keeps the ring at the bottom of
    // our stack and above the basemap. (Depth testing makes fill-extrusion
    // order mostly moot; this matters for the AO line, which is 2D.)
    const before = ['buildings-ao', 'buildings-3d', 'buildings-labels']
      .find(id => map.getLayer(id));
    const p = (window.__todCurrentP != null) ? window.__todCurrentP : 0.3;

    // 1. The ring proper: ONE fill-extrusion, flat colour, no cap, no AO.
    map.addLayer({
      id: L_FLAT, type: 'fill-extrusion', source: SRC,
      minzoom: OUTER.minZoom,
      filter: densityFilter(NOT_TOWER),
      paint: {
        'fill-extrusion-color': bakedColor(p),
        'fill-extrusion-height': ['get', 'h'],
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': OUTER.opacity,
        // Kept ON. It is a shader constant, not a draw, and it is most of what
        // stops 6,800 flat prisms reading as a carpet: the darkened base gives
        // every box a self-shadow and the block reads as depth.
        'fill-extrusion-vertical-gradient': true,
      },
    }, before);

    // 2. The exception: downtown towers, on the core's existing atlas.
    map.addLayer({
      id: L_TOWER, type: 'fill-extrusion', source: SRC,
      minzoom: OUTER.minZoom,
      filter: IS_TOWER,
      paint: {
        'fill-extrusion-pattern': window.FACADE_PATTERN_EXPR,
        'fill-extrusion-height': ['get', 'h'],
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': OUTER.opacity,
        'fill-extrusion-vertical-gradient': true,
      },
    }, before);

    // 3. A parapet cap on the towers only, using app.js's shared geometry rule
    //    so the ring cannot drift from the core's. Without it the window
    //    pattern wraps over the roof plane, and from campus you look slightly
    //    DOWN at downtown — those roofs are in frame.
    const G = window.CAP_GEOM;
    if (OUTER.towerCap && G) {
      map.addLayer({
        id: L_TOWER_ROOF, type: 'fill-extrusion', source: SRC,
        minzoom: OUTER.minZoom,
        filter: IS_TOWER,
        paint: {
          // rd/rg/rn are baked for the TOWERS ONLY — 114 features, not 7,138 —
          // for exactly the reason the rest of the ring does not get them:
          // three more hex strings on every house would be most of the file for
          // a roof plane nobody ever sees. This first reused wd/wg/wn, which
          // painted the parapet the same colour as the wall it sits on: a cap
          // you cannot see is a draw call you are paying for.
          'fill-extrusion-color': roofColor(p),
          'fill-extrusion-height': G.height(['get', 'h']),
          'fill-extrusion-base': G.base(['get', 'h']),
          'fill-extrusion-opacity': 1.0,
        },
      }, before);
    }

    console.log('[outer]', gj.features.length, 'ring buildings (',
                towers.length, 'towers,', patterned, 'patterned from the',
                'existing atlas — 0 new images )');
  };

  window.applyOuterColors = function applyOuterColors(map, p) {
    if (!map || !map.getLayer) return;
    try {
      if (map.getLayer(L_FLAT))
        map.setPaintProperty(L_FLAT, 'fill-extrusion-color', bakedColor(p));
    } catch (e) {}
    try {
      if (map.getLayer(L_TOWER_ROOF))
        map.setPaintProperty(L_TOWER_ROOF, 'fill-extrusion-color', roofColor(p));
    } catch (e) {}
    // L_TOWER carries its colour inside the shared facade atlas, which
    // updateFacades() has already repainted by the time we get here.
  };

  /** Re-read OUTER / GFX.outerDensity after a live edit or a preset change. */
  window.applyOuterSettings = function applyOuterSettings(map) {
    if (!map || !map.getLayer) return;
    for (const id of [L_FLAT, L_TOWER, L_TOWER_ROOF]) {
      if (!map.getLayer(id)) continue;
      try {
        map.setLayoutProperty(id, 'visibility', OUTER.on ? 'visible' : 'none');
        map.setPaintProperty(id, 'fill-extrusion-opacity',
                             id === L_TOWER_ROOF ? 1.0 : OUTER.opacity);
      } catch (e) {}
    }
    try {
      if (map.getLayer(L_FLAT)) map.setFilter(L_FLAT, densityFilter(NOT_TOWER));
    } catch (e) {}
  };

  // ── bootstrap ─────────────────────────────────────────────────────
  // A new module needs a <script> tag and nothing else. js/app.js is owned by
  // another pass, so rather than ask for a call inside buildScene(), this waits
  // for the map and for the core layers to be up and then inserts itself under
  // them. It also wraps applyTimeOfDay the same way — installed here, after
  // every module has loaded, so script order cannot break it.
  function boot() {
    const map = window.__map;
    if (!map) return setTimeout(boot, 60);

    const hookTod = () => {
      if (typeof window.applyTimeOfDay !== 'function' || window.applyTimeOfDay.__outer) return;
      const prev = window.applyTimeOfDay;
      const wrapped = function (m, p, force) {
        const r = prev.apply(this, arguments);
        try { window.applyOuterColors(m, p); } catch (e) {}
        return r;
      };
      wrapped.__outer = true;
      window.applyTimeOfDay = wrapped;
    };

    const go = () => {
      // Wait for the core buildings AND the facade atlas: the towers snap onto
      // patterns that must already be registered, and a tower that asks for an
      // image MapLibre does not have is painted transparent.
      if (!map.getLayer('buildings-3d') || typeof window.quantiseOuterFacades !== 'function') {
        return setTimeout(go, 120);
      }
      hookTod();
      window.initOuter(map);
    };
    if (map.isStyleLoaded && map.isStyleLoaded()) go();
    else map.once('load', () => setTimeout(go, 0));
  }
  boot();
})();
