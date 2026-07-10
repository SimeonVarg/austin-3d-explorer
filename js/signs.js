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

  const SRC = 'austin-signs', GLOW = 'signs-glow', LABEL = 'signs-label';

  // Heroes (priority 1) are larger and win placement. Sizes ramp with zoom.
  const TEXT_SIZE = [
    'interpolate', ['linear'], ['zoom'],
    13, ['match', ['get', 'priority'], 1, 12, 9],
    16, ['match', ['get', 'priority'], 1, 17, 12],
    19, ['match', ['get', 'priority'], 1, 22, 16],
  ];

  const BASE_LAYOUT = {
    'text-field': ['get', 'label'],
    'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
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

    // Glow underlay — colored blurred halo, always laid out, faded by time.
    if (!map.getLayer(GLOW)) {
      map.addLayer({
        id: GLOW, type: 'symbol', source: SRC, minzoom: 13,
        layout: Object.assign({}, BASE_LAYOUT, {
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        }),
        paint: {
          'text-color': ['get', 'color'],
          'text-halo-color': ['get', 'color'],
          'text-halo-width': 7,
          'text-halo-blur': 5,
          'text-opacity': 0, // driven by applySignGlowLayer()
        },
      });
    }

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
    if (map.getLayer && map.getLayer(GLOW)) {
      try { map.setPaintProperty(GLOW, 'text-opacity', g); } catch (e) {}
    }
    // Nudge the label's brand halo brighter as night falls so it reads as lit.
    if (map.getLayer && map.getLayer(LABEL)) {
      try { map.setPaintProperty(LABEL, 'text-halo-width', 1.6 + g * 1.6); } catch (e) {}
    }
  };
})();
