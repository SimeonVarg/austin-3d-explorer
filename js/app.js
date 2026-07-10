/**
 * app.js — Austin 3D Explorer main entry point
 *
 * Responsibilities:
 *  1. Register PMTiles protocol.
 *  2. Fetch data/manifest.json, resolve the latest (or selected) snapshot.
 *  3. Init MapLibre with OpenFreeMap basemap + terrain DEM.
 *  4. Add fill-extrusion + label layers from the snapshot PMTiles.
 *  5. Init flythrough controls (controls.js).
 *  6. Init date switcher (date-switcher.js) — shows when >1 snapshot exists.
 *  7. Gate debug panel behind ?debug=1 or Shift+D.
 *  8. Wire diff-tour (diff-tour.js) — triggered by date-switcher when a diff exists.
 *
 * addBuildingLayers() is intentionally left on window so date-switcher.js
 * can call it after a source swap.
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
    '#FF9800',                   // orange — estimated
  ];

  const BUILDING_OPACITY       = 0.92;
  const BUILDING_OPACITY_DEBUG = 0.88;

  // ── State ────────────────────────────────────────────────────────
  let map           = null;
  let activeDate    = null; // currently loaded snapshot date string
  let manifest      = null;

  // ── Debug gate ───────────────────────────────────────────────────
  // Debug panel visible only with ?debug=1 OR after Shift+D is pressed.
  const debugParam = new URLSearchParams(window.location.search).get('debug') === '1';
  let debugVisible = debugParam;

  function applyDebugVisibility() {
    const panel = document.getElementById('debug-panel');
    if (!panel) return;
    panel.classList.toggle('hidden', !debugVisible);
  }

  window.addEventListener('keydown', (e) => {
    if (e.shiftKey && e.key === 'D') {
      debugVisible = !debugVisible;
      applyDebugVisibility();
    }
  });

  // ── Manifest → snapshot ──────────────────────────────────────────
  async function loadManifest() {
    try {
      const res = await fetch('data/manifest.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn('manifest.json not found or invalid:', err.message);
      return null;
    }
  }

  function snapshotUrlFor(date) {
    return `pmtiles://data/snapshots/${date}/austin.pmtiles`;
  }

  // ── Map init ─────────────────────────────────────────────────────
  async function init() {
    manifest = await loadManifest();

    if (manifest && manifest.latest) {
      activeDate = manifest.latest;
      document.getElementById('hud-snapshot').textContent =
        `Data snapshot: ${activeDate}`;
    } else {
      document.getElementById('hud-snapshot').textContent =
        'No snapshot found — run the data pipeline first';
    }

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
      addTerrain();
      if (activeDate) addBuildingLayers(snapshotUrlFor(activeDate));

      initControls(map);

      if (manifest) {
        initDateSwitcher(map, manifest, activeDate, onDateChanged);
      }

      applyDebugVisibility();
      wireDebugToggle();
    });

    // Re-add layers if the base style ever reloads
    map.on('styledata', () => {
      if (activeDate && !map.getSource('austin-buildings')) {
        addBuildingLayers(snapshotUrlFor(activeDate));
      }
    });
  }

  // ── Terrain ──────────────────────────────────────────────────────
  // Global elevation from the AWS Open Data "Terrain Tiles" set (Mapzen/Tilezen
  // Terrarium-encoded PNGs). Free, no API key, and — unlike the previous
  // demotiles.maplibre.org demo endpoint — it actually has coverage for Austin,
  // so the West Campus → Waller Creek slope (RESEARCH.md §4) renders instead of
  // silently staying flat.
  function addTerrain() {
    if (map.getSource('terrain-dem')) return;

    map.addSource('terrain-dem', {
      type:     'raster-dem',
      tiles:    ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
      encoding: 'terrarium',
      tileSize: 256,
      maxzoom:  15,
    });

    map.setTerrain({
      source:     'terrain-dem',
      exaggeration: 1.5,   // slight boost so the 30 m creek-to-campus rise reads clearly
    });

    // Subtle hillshade layer underneath buildings
    if (!map.getLayer('hillshade')) {
      map.addLayer(
        {
          id:     'hillshade',
          type:   'hillshade',
          source: 'terrain-dem',
          paint: {
            'hillshade-illumination-anchor': 'map',
            'hillshade-intensity':           0.25,
            'hillshade-shadow-color':        '#3a200a',
            'hillshade-highlight-color':     '#f5dfa0',
          },
        },
        'water', // insert below the water layer so it doesn't overwrite it
      );
    }
  }

  // ── Building layers ───────────────────────────────────────────────
  // Exposed on window so date-switcher.js can call it after a source swap.
  window.addBuildingLayers = function addBuildingLayers(pmtilesUrl) {
    if (!map.getSource('austin-buildings')) {
      map.addSource('austin-buildings', {
        type:    'vector',
        url:     pmtilesUrl,
        minzoom: 12,
        maxzoom: 16,
      });
    }

    // Fill-extrusion
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
  };

  // ── Date change callback ──────────────────────────────────────────
  function onDateChanged(newDate) {
    const prevDate = activeDate;
    activeDate = newDate;

    document.getElementById('hud-snapshot').textContent =
      `Data snapshot: ${newDate}`;

    // If there's a diff between prevDate and newDate, offer the tour
    if (!manifest || !prevDate || prevDate === newDate) return;
    const diffs = manifest.diffs || [];
    const diffFile = diffs.find(d =>
      d.includes(`${prevDate}_to_${newDate}`) ||
      d.includes(`${newDate}_to_${prevDate}`)
    );
    if (diffFile) {
      // Auto-start the diff tour so the user immediately sees what changed
      const from = diffFile.match(/(\d{4}-\d{2}-\d{2})_to_/)?.[1];
      const to   = diffFile.match(/_to_(\d{4}-\d{2}-\d{2})/)?.[1];
      if (from && to && typeof initDiffTour === 'function') {
        initDiffTour(map, manifest, from, to);
      }
    }
  }

  // ── Debug toggle ──────────────────────────────────────────────────
  function wireDebugToggle() {
    const toggle = document.getElementById('debug-toggle');
    const legend = document.getElementById('debug-legend');
    if (!toggle) return;

    toggle.addEventListener('change', () => {
      const on = toggle.checked;
      if (legend) legend.classList.toggle('hidden', !on);
      if (!map.getLayer('buildings-3d')) return;
      map.setPaintProperty('buildings-3d', 'fill-extrusion-color',
        on ? COLOR_DEBUG : COLOR_NORMAL);
      map.setPaintProperty('buildings-3d', 'fill-extrusion-opacity',
        on ? BUILDING_OPACITY_DEBUG : BUILDING_OPACITY);
    });
  }

  // ── Go ────────────────────────────────────────────────────────────
  init();
})();
