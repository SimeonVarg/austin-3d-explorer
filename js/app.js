/**
 * app.js — Austin 3D Explorer main entry point
 *
 * 1. Registers the PMTiles protocol with MapLibre.
 * 2. Fetches data/manifest.json to find the latest snapshot date.
 * 3. Initialises MapLibre with an OpenFreeMap basemap.
 * 4. On map load: adds austin.pmtiles as a vector source, then:
 *    - fill-extrusion layer  (buildings, height = final_height)
 *    - symbol layer          (building name labels, skipping nulls)
 * 5. Debug toggle: re-colours buildings by source_height.
 */

(function () {
  'use strict';

  // ── PMTiles protocol ────────────────────────────────────────────
  const protocol = new pmtiles.Protocol();
  maplibregl.addProtocol('pmtiles', protocol.tile.bind(protocol));

  // ── Camera defaults ─────────────────────────────────────────────
  const SPAWN = {
    center:  [-97.7404, 30.2849], // UT Tower / Drag intersection
    zoom:    16.8,
    pitch:   62,
    bearing: 15,
  };

  // ── Colour palettes ─────────────────────────────────────────────
  const COLOR_NORMAL = [
    'interpolate', ['linear'],
    ['get', 'final_height'],
      0,  '#c8a96e',
     20,  '#b8956a',
     40,  '#a07850',
     70,  '#8a6040',
    100,  '#6b4226',
  ];

  const COLOR_DEBUG = [
    'match', ['get', 'source_height'],
    'overture',      '#4CAF50',  // green  — LiDAR
    'hero_override', '#9C27B0',  // purple — manual correction
    '#FF9800',                   // orange — estimated (osm_*, class_default, floors)
  ];

  const BUILDING_OPACITY       = 0.92;
  const BUILDING_OPACITY_DEBUG = 0.88;

  let map = null;

  // ── Manifest → latest snapshot ───────────────────────────────────
  async function resolveSnapshot() {
    try {
      const res = await fetch('data/manifest.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const manifest = await res.json();
      if (!manifest.latest) throw new Error('manifest.latest missing');

      document.getElementById('hud-snapshot').textContent =
        `Data snapshot: ${manifest.latest}`;

      return {
        url:  `pmtiles://data/snapshots/${manifest.latest}/austin.pmtiles`,
        date: manifest.latest,
      };
    } catch (err) {
      console.warn('manifest.json not found or invalid:', err.message);
      document.getElementById('hud-snapshot').textContent =
        'No snapshot found — run the data pipeline first';
      return null;
    }
  }

  // ── Map init ─────────────────────────────────────────────────────
  async function init() {
    const snapshot = await resolveSnapshot();

    map = new maplibregl.Map({
      container:  'map',
      style:      'https://tiles.openfreemap.org/styles/liberty',
      center:     SPAWN.center,
      zoom:       SPAWN.zoom,
      pitch:      SPAWN.pitch,
      bearing:    SPAWN.bearing,
      maxPitch:   85,
      antialias:  true,
      scrollZoom: false,
    });

    map.on('load', () => {
      if (snapshot) addBuildingLayers(snapshot.url);
      initControls(map);
      wireDebugToggle();
    });

    // Re-add layers if the style reloads (shouldn't happen normally, but safe)
    map.on('styledata', () => {
      if (snapshot && !map.getSource('austin-buildings')) {
        addBuildingLayers(snapshot.url);
      }
    });
  }

  // ── PMTiles source + layers ──────────────────────────────────────
  function addBuildingLayers(pmtilesUrl) {
    if (!map.getSource('austin-buildings')) {
      map.addSource('austin-buildings', {
        type:    'vector',
        url:     pmtilesUrl,
        minzoom: 12,
        maxzoom: 16,
      });
    }

    // Extrusion
    if (!map.getLayer('buildings-3d')) {
      map.addLayer({
        id:             'buildings-3d',
        type:           'fill-extrusion',
        source:         'austin-buildings',
        'source-layer': 'buildings',
        paint: {
          'fill-extrusion-color':   COLOR_NORMAL,
          'fill-extrusion-height':  ['get', 'final_height'],
          'fill-extrusion-base':    0,
          'fill-extrusion-opacity': BUILDING_OPACITY,
          'fill-extrusion-ambient-occlusion-intensity': 0.35,
          'fill-extrusion-ambient-occlusion-radius':    3,
        },
      });
    }

    // Name labels — float above the roof, fade in at zoom 15.5+
    if (!map.getLayer('buildings-labels')) {
      map.addLayer({
        id:             'buildings-labels',
        type:           'symbol',
        source:         'austin-buildings',
        'source-layer': 'buildings',
        minzoom:        15.5,
        filter:         ['!=', ['get', 'name'], null],
        layout: {
          'text-field':            ['get', 'name'],
          'text-font':             ['Open Sans Semibold', 'Arial Unicode MS Bold'],
          'text-size': [
            'interpolate', ['linear'], ['zoom'],
            15.5, 9,
            17,   13,
            19,   16,
          ],
          'text-anchor':           'center',
          'text-allow-overlap':    false,
          'symbol-placement':      'point',
          'text-offset':           [0, -1],
        },
        paint: {
          'text-color':      '#fff8e8',
          'text-halo-color': 'rgba(30,15,0,0.85)',
          'text-halo-width': 1.5,
          'text-opacity': [
            'interpolate', ['linear'], ['zoom'],
            15.5, 0,
            16,   1,
          ],
        },
      });
    }
  }

  // ── Debug toggle ──────────────────────────────────────────────────
  function wireDebugToggle() {
    const toggle = document.getElementById('debug-toggle');
    const legend = document.getElementById('debug-legend');
    if (!toggle) return;

    toggle.addEventListener('change', () => {
      const on = toggle.checked;
      legend.classList.toggle('hidden', !on);
      if (!map.getLayer('buildings-3d')) return;
      map.setPaintProperty('buildings-3d', 'fill-extrusion-color',
        on ? COLOR_DEBUG : COLOR_NORMAL);
      map.setPaintProperty('buildings-3d', 'fill-extrusion-opacity',
        on ? BUILDING_OPACITY_DEBUG : BUILDING_OPACITY);
    });
  }

  init();
})();
