/**
 * signs.js — curated branded landmark signage for Austin 3D Explorer
 *
 * Loads data/signs.json (a small, hand-curated GeoJSON whose coordinates and
 * heights come straight from the baked snapshot, so each sign sits on the right
 * building).
 *
 * Design note — the labels used to be brand-coloured at every hour, which put
 * ~50 saturated words of six different hues over the scene at once and read as
 * a debug overlay. They're calm cream by day and only take their brand colour
 * as night falls, which is when a lit sign is supposed to be the thing you
 * notice. Priority-2 names hold back until you're close enough to care.
 *
 * Public (window) API:
 *   initSigns(map, data)                  — add source + layers
 *   applySignGlowLayer(map, signGlow, p)  — 0 (day) … 1 (night)
 */
(function () {
  'use strict';

  const SRC = 'austin-signs', LABEL = 'signs-label', POOL = 'signs-ground-glow';

  // Heroes (priority 1) are larger and win placement. Sizes ramp with zoom.
  const TEXT_SIZE = [
    'interpolate', ['linear'], ['zoom'],
    13, ['match', ['get', 'priority'], 1, 11, 9],
    16, ['match', ['get', 'priority'], 1, 15, 11],
    19, ['match', ['get', 'priority'], 1, 20, 14],
  ];

  // Heroes carry from far out; everything else waits until you're in the
  // neighbourhood. This one expression is most of the declutter.
  //
  // It has to be a SINGLE zoom interpolate with data-driven outputs — nesting
  // one zoom curve per priority inside a `case` is rejected outright ("Only one
  // zoom-based step or interpolate subexpression may be used"), and a rejected
  // paint property takes the whole layer down with it.
  const hero = (a, b) => ['case', ['==', ['get', 'priority'], 1], a, b];
  const TEXT_OPACITY = [
    'interpolate', ['linear'], ['zoom'],
    13.5, hero(0, 0),
    14.6, hero(1, 0),
    15.9, hero(1, 0),
    16.7, hero(1, 1),
  ];

  window.initSigns = function initSigns(map, data) {
    if (!map.getSource(SRC)) {
      map.addSource(SRC, { type: 'geojson', data: data || 'data/signs.json' });
    }

    // Ground light pool — a soft brand-coloured disc flat on the ground under
    // each landmark. MapLibre has no fill-extrusion flood light, so this is the
    // low-poly stand-in. Kept deliberately tight: the previous radii (60 px at
    // z16, 380 px at z19) merged 48 pools into one mustard wash across the
    // whole ground plane at night.
    if (!map.getLayer(POOL)) {
      const beforeId = map.getLayer('buildings-shadow') ? 'buildings-shadow'
                     : map.getLayer('buildings-3d') ? 'buildings-3d' : undefined;
      map.addLayer({
        id: POOL, type: 'circle', source: SRC, minzoom: 14,
        paint: {
          'circle-pitch-alignment': 'map',
          'circle-color': ['get', 'color'],
          'circle-blur': 1.0,
          'circle-radius': ['interpolate', ['exponential', 2], ['zoom'],
            14, ['match', ['get', 'priority'], 1, 5, 3],
            16, ['match', ['get', 'priority'], 1, 20, 12],
            19, ['match', ['get', 'priority'], 1, 150, 90],
          ],
          'circle-opacity': 0, // driven by applySignGlowLayer()
        },
      }, beforeId);
    }

    // NOTE: there is deliberately NO separate glow-underlay symbol layer.
    // A second text layer with allow-overlap renders orphaned colour blocks
    // wherever the label layer's declutterer dropped the label (v5). The neon
    // comes from the label taking its brand colour at night + ground pools.
    if (!map.getLayer(LABEL)) {
      map.addLayer({
        id: LABEL, type: 'symbol', source: SRC, minzoom: 13.5,
        layout: {
          'text-field': ['get', 'label'],
          // Only Noto Sans Regular/Bold/Italic exist on OpenFreeMap's glyph
          // server — a missing fontstack 404s and MapLibre discards the whole
          // tile it was needed for.
          'text-font': ['Noto Sans Bold'],
          'text-size': TEXT_SIZE,
          'text-anchor': 'center',
          'text-max-width': 8,
          'text-padding': 14,
          'text-allow-overlap': false,
          // Lower sort-key places first → priority-1 heroes beat priority-2.
          'symbol-sort-key': ['get', 'priority'],
        },
        paint: {
          'text-color': '#fff6e4',
          'text-halo-color': 'rgba(22,13,4,0.9)',
          'text-halo-width': 1.5,
          'text-halo-blur': 0.3,
          'text-opacity': TEXT_OPACITY,
        },
      });
    }
  };

  // signGlow: 0 = day (no glow), 1 = night (full neon). Called from timeofday.
  window.applySignGlowLayer = function applySignGlowLayer(map, signGlow, p) {
    const g = Math.max(0, Math.min(1, signGlow));
    if (map.getLayer && map.getLayer(LABEL)) {
      try {
        // Cream by day → the building's own brand colour once it's dark.
        map.setPaintProperty(LABEL, 'text-color', [
          'interpolate', ['linear'], (p == null ? g : p),
          0,    '#fff6e4',
          0.55, '#fff6e4',
          1,    ['to-color', ['get', 'color'], '#ffffff'],
        ]);
        map.setPaintProperty(LABEL, 'text-halo-color', `rgba(6,5,14,${0.9 + g * 0.08})`);
        map.setPaintProperty(LABEL, 'text-halo-width', 1.5 + g * 1.1);
        map.setPaintProperty(LABEL, 'text-halo-blur', 0.3 + g * 1.4);
      } catch (e) {}
    }
    if (map.getLayer && map.getLayer(POOL)) {
      try { map.setPaintProperty(POOL, 'circle-opacity', g * 0.2); } catch (e) {}
    }
  };
})();
