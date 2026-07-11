/**
 * signs.js — curated branded landmark signage for Austin 3D Explorer
 *
 * Loads data/signs.json (a small, hand-curated GeoJSON whose coordinates and
 * heights come straight from the baked snapshot, so each sign sits on the right
 * building). Renders two stacked symbol layers:
 *   signs-glow   — colored, blurred halo underlay; opacity driven by time-of-day
 *                  (invisible by day, glowing neon at night)
 *   signs-label  — white text with a thin brand-colored halo, on top
 *
 * Public (window) API:
 *   initSigns(map)                     — add source + layers
 *   applySignGlowLayer(map, signGlow)  — 0 (day) … 1 (night); called by timeofday
 */
(function () {
  'use strict';

  const SRC = 'austin-signs', GLOW = 'signs-glow', LABEL = 'signs-label', POOL = 'signs-ground-glow';

  // Heroes (priority 1) are larger and win placement. Sizes ramp with zoom.
  const TEXT_SIZE = [
    'interpolate', ['linear'], ['zoom'],
    13, ['match', ['get', 'priority'], 1, 12, 9],
    16, ['match', ['get', 'priority'], 1, 17, 12],
    19, ['match', ['get', 'priority'], 1, 22, 16],
  ];

  const BASE_LAYOUT = {
    'text-field': ['get', 'label'],
    // Only Noto Sans Regular/Bold/Italic exist on OpenFreeMap's glyph server —
    // a missing fontstack 404s and MapLibre discards the whole tile.
    'text-font': ['Noto Sans Bold'],
    'text-size': TEXT_SIZE,
    'text-anchor': 'center',
    'text-padding': 6,
    // Lower sort-key places first → priority-1 heroes beat priority-2.
    'symbol-sort-key': ['get', 'priority'],
  };

  window.initSigns = function initSigns(map) {
    if (!map.getSource(SRC)) {
      map.addSource(SRC, { type: 'geojson', data: 'data/signs.json' });
    }

    // Ground light pool — a soft brand-coloured disc flat on the ground under
    // each landmark. MapLibre has no fill-extrusion flood light, so this is
    // the low-poly stand-in: circles pitched into the map plane, blurred wide,
    // faded up at night by applySignGlowLayer. Inserted BELOW the building
    // layers so towers rise out of their own light.
    if (!map.getLayer(POOL)) {
      const beforeId = map.getLayer('buildings-3d') ? 'buildings-3d' : undefined;
      map.addLayer({
        id: POOL, type: 'circle', source: SRC, minzoom: 13,
        paint: {
          'circle-pitch-alignment': 'map',
          'circle-color': ['get', 'color'],
          'circle-blur': 1.4,
          'circle-radius': ['interpolate', ['exponential', 2], ['zoom'],
            13, ['match', ['get', 'priority'], 1, 10, 6],
            16, ['match', ['get', 'priority'], 1, 60, 34],
            19, ['match', ['get', 'priority'], 1, 380, 220],
          ],
          'circle-opacity': 0, // driven by applySignGlowLayer()
        },
      }, beforeId);
    }

    // NOTE: there is deliberately NO separate glow-underlay symbol layer.
    // A second text layer with allow-overlap renders orphaned colour blocks
    // wherever the label layer's declutterer dropped the label (v5). The neon
    // comes from the label's own brand halo widening at night + ground pools.

    // Label — white text, thin brand halo, decluttered.
    if (!map.getLayer(LABEL)) {
      map.addLayer({
        id: LABEL, type: 'symbol', source: SRC, minzoom: 13,
        layout: Object.assign({}, BASE_LAYOUT, {
          'text-allow-overlap': false,
        }),
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': ['get', 'color'],
          'text-halo-width': 1.6,
          'text-halo-blur': 0.4,
        },
      });
    }
  };

  // signGlow: 0 = day (no glow), 1 = night (full neon). Called from timeofday.js.
  window.applySignGlowLayer = function applySignGlowLayer(map, signGlow) {
    const g = Math.max(0, Math.min(1, signGlow));
    // The label's brand halo widens as night falls so it reads as lit neon.
    if (map.getLayer && map.getLayer(LABEL)) {
      try { map.setPaintProperty(LABEL, 'text-halo-width', 1.6 + g * 2.2); } catch (e) {}
    }
    // Ground light pools bloom with the night.
    if (map.getLayer && map.getLayer(POOL)) {
      try { map.setPaintProperty(POOL, 'circle-opacity', g * 0.38); } catch (e) {}
    }
  };
})();
