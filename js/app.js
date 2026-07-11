/**
 * app.js — Austin 3D Explorer main entry point
 *
 * Buildings are a plain GeoJSON source (baked by scripts/bake_detail.py with
 * per-feature day/golden/night colours). PMTiles was dropped: at 2,443
 * buildings the GeoJSON is ~1.4 MB and MapLibre client-tiles it in a worker,
 * which also removes the Vercel byte-range/Brotli failure mode entirely.
 */
(function () {
  'use strict';

  // Spawn inside the West Campus tower cluster (Dobie, Castilian, Skyloft,
  // Moontower, Ion nearby) so you're among buildings on load, not on a lawn.
  // Pitch 64 + a 58° vertical FOV keep the horizon (and the v5 sky gradient)
  // on screen — at the default 36.87° FOV the sky is invisible below ~71°.
  const SPAWN = { center: [-97.7434, 30.2857], zoom: 16.5, pitch: 64, bearing: 90 };
  const DEFAULT_P = (typeof window.TOD_DEFAULT_P === 'number') ? window.TOD_DEFAULT_P : 0.30;

  const COLOR_DEBUG = ['match',['get','source_height'],'overture','#4CAF50','hero_override','#9C27B0','#FF9800'];
  const BUILDING_OPACITY = 1.0, BUILDING_OPACITY_DEBUG = 0.88;

  let map=null, activeDate=null, manifest=null;

  // ── Debug gate ────────────────────────────────────────────────────
  const debugParam = new URLSearchParams(window.location.search).get('debug') === '1';
  let debugVisible = debugParam;
  function applyDebugVisibility() {
    const p = document.getElementById('debug-panel');
    if (p) p.classList.toggle('hidden', !debugVisible);
  }
  window.addEventListener('keydown', e => {
    if (e.shiftKey && e.key === 'D') { debugVisible = !debugVisible; applyDebugVisibility(); }
  });

  // ── Manifest ──────────────────────────────────────────────────────
  async function loadManifest() {
    try { const r = await fetch('data/manifest.json'); if (!r.ok) throw new Error(r.status); return await r.json(); }
    catch(e) { console.warn('manifest:', e.message); return null; }
  }

  function snapshotUrlFor(date) { return `data/snapshots/${date}/buildings.detailed.geojson`; }
  window.snapshotUrlFor = snapshotUrlFor;

  // ── Init ──────────────────────────────────────────────────────────
  async function init() {
    manifest = await loadManifest();
    const el = document.getElementById('hud-snapshot');
    if (manifest && manifest.latest) {
      activeDate = manifest.latest;
      if (el) el.textContent = `Data snapshot: ${activeDate}`;
    } else {
      if (el) el.textContent = 'No snapshot found — run the data pipeline first';
    }

    map = new maplibregl.Map({
      container:'map', style:'https://tiles.openfreemap.org/styles/liberty',
      center:SPAWN.center, zoom:SPAWN.zoom, pitch:SPAWN.pitch, bearing:SPAWN.bearing,
      maxPitch:85, scrollZoom:false,
      // v5: antialias moved into canvasContextAttributes
      canvasContextAttributes: { antialias: true },
    });
    if (typeof map.setVerticalFieldOfView === 'function') map.setVerticalFieldOfView(58);

    map.on('error', (e) => {
      const msg = (e && e.error && e.error.message) ? e.error.message : 'unknown';
      console.warn('MAP ERROR:', msg);
    });

    map.on('load', () => {
      // NOTE: terrain intentionally disabled — it culled buildings and made
      // them float on slopes (see HANDOFF §7.4). Slope is deprioritised.
      if (activeDate) addBuildingLayers(snapshotUrlFor(activeDate));
      addDetailLayers();
      if (typeof initSigns === 'function') initSigns(map);
      if (typeof cleanupBasemap === 'function') cleanupBasemap(map);
      initControls(map);
      if (manifest) initDateSwitcher(map, manifest, activeDate, onDateChanged);
      applyDebugVisibility();
      wireDebugToggle();
      if (typeof applyTimeOfDay === 'function') {
        applyTimeOfDay(map, DEFAULT_P);
        initTimeOfDayUI(map, DEFAULT_P);
      }
    });

    map.on('styledata', () => {
      // Strip the basemap's own buildings/POIs as soon as the style parses —
      // earlier than the 'load' event — so they never flash on screen. The
      // _cleaned guard inside makes repeat calls no-ops.
      if (typeof cleanupBasemap === 'function') cleanupBasemap(map);
      if (activeDate && !map.getSource('austin-buildings')) {
        addBuildingLayers(snapshotUrlFor(activeDate));
        addDetailLayers();
        if (typeof initSigns === 'function') initSigns(map);
        if (typeof applyTimeOfDay === 'function')
          applyTimeOfDay(map, window.__todCurrentP != null ? window.__todCurrentP : DEFAULT_P);
      }
    });
  }

  // ── Building layers ───────────────────────────────────────────────
  // Buildings whose volume is replaced by OSM building:parts carry
  // has_parts=1 and are excluded from the base layers; parts-* render the
  // detailed massing (podium + tower setbacks) instead.
  const NO_PARTS = ['!', ['has', 'has_parts']];
  const CAP_MIN_HEIGHT = 4; // sheds don't get a parapet cap

  window.addBuildingLayers = function addBuildingLayers(url) {
    if (!map.getSource('austin-buildings')) {
      map.addSource('austin-buildings', { type:'geojson', data:url });
    }
    if (!map.getLayer('buildings-3d')) {
      map.addLayer({
        id:'buildings-3d', type:'fill-extrusion',
        source:'austin-buildings', filter: NO_PARTS,
        paint:{
          'fill-extrusion-color':['to-color',['get','wd']],
          'fill-extrusion-height':['get','final_height'],
          'fill-extrusion-base':0,
          'fill-extrusion-opacity':BUILDING_OPACITY,
          'fill-extrusion-vertical-gradient':true,
        },
      });
    }
    // Parapet/roof cap: the top ~1.2 m re-extruded in the roof colour, ending
    // slightly above the wall so the top face reads as a roof from the air.
    if (!map.getLayer('buildings-roof')) {
      map.addLayer({
        id:'buildings-roof', type:'fill-extrusion',
        source:'austin-buildings',
        filter:['all', NO_PARTS, ['>=', ['get','final_height'], CAP_MIN_HEIGHT]],
        paint:{
          'fill-extrusion-color':['to-color',['get','rd']],
          'fill-extrusion-height':['+', ['get','final_height'], 0.4],
          'fill-extrusion-base':['-', ['get','final_height'], 1.2],
          'fill-extrusion-opacity':1.0,
        },
      });
    }

    const signLayout = {
      'text-field':['get','name'],
      // Only Noto Sans Regular/Bold/Italic exist on OpenFreeMap's glyph
      // server — a missing fontstack 404s and MapLibre discards the whole
      // tile it was needed for.
      'text-font':['Noto Sans Bold'],
      'text-size':['interpolate',['linear'],['zoom'],15.5,9,17,13,19,16],
      'text-anchor':'center', 'symbol-placement':'point', 'text-offset':[0,-1],
    };

    if (!map.getLayer('buildings-labels')) {
      map.addLayer({
        id:'buildings-labels', type:'symbol',
        source:'austin-buildings',
        minzoom:15.5, filter:['!=',['get','name'],null],
        layout:Object.assign({},signLayout,{'text-allow-overlap':false}),
        paint:{
          'text-color':'#fff8e8','text-halo-color':'rgba(30,15,0,0.85)','text-halo-width':1.5,
          'text-opacity':['interpolate',['linear'],['zoom'],15.5,0,16,1],
        },
      });
    }
  };

  // ── Detail layers: OSM building parts, trees, pitches, fountains ──
  function addDetailLayers() {
    if (!map.getSource('austin-parts')) {
      map.addSource('austin-parts', { type:'geojson', data:'data/snapshots/' + activeDate + '/parts.detailed.geojson' });
    }
    if (!map.getLayer('parts-3d')) {
      map.addLayer({
        id:'parts-3d', type:'fill-extrusion', source:'austin-parts',
        paint:{
          'fill-extrusion-color':['to-color',['get','wd']],
          'fill-extrusion-height':['get','h'],
          'fill-extrusion-base':['get','base'],
          'fill-extrusion-opacity':1.0,
          'fill-extrusion-vertical-gradient':true,
        },
      }, map.getLayer('buildings-labels') ? 'buildings-labels' : undefined);
    }
    if (!map.getLayer('parts-roof')) {
      map.addLayer({
        id:'parts-roof', type:'fill-extrusion', source:'austin-parts',
        filter:['>=', ['-', ['get','h'], ['get','base']], CAP_MIN_HEIGHT],
        paint:{
          'fill-extrusion-color':['to-color',['get','rd']],
          'fill-extrusion-height':['+', ['get','h'], 0.4],
          'fill-extrusion-base':['-', ['get','h'], 1.2],
          'fill-extrusion-opacity':1.0,
        },
      }, map.getLayer('buildings-labels') ? 'buildings-labels' : undefined);
    }

    if (!map.getSource('austin-trees')) {
      map.addSource('austin-trees', { type:'geojson', data:'data/trees.geojson' });
    }
    if (!map.getLayer('trees-trunk')) {
      map.addLayer({
        id:'trees-trunk', type:'fill-extrusion', source:'austin-trees',
        minzoom:14, filter:['==',['get','kind'],'trunk'],
        paint:{
          'fill-extrusion-color':'#6b4f38',
          'fill-extrusion-height':['get','h'],
          'fill-extrusion-base':0,
          'fill-extrusion-opacity':1.0,
        },
      }, map.getLayer('buildings-labels') ? 'buildings-labels' : undefined);
    }
    if (!map.getLayer('trees-canopy')) {
      map.addLayer({
        id:'trees-canopy', type:'fill-extrusion', source:'austin-trees',
        minzoom:14, filter:['==',['get','kind'],'canopy'],
        paint:{
          'fill-extrusion-color':'#7d9a62',
          'fill-extrusion-height':['get','h'],
          'fill-extrusion-base':['get','base'],
          'fill-extrusion-opacity':1.0,
          'fill-extrusion-vertical-gradient':true,
        },
      }, map.getLayer('buildings-labels') ? 'buildings-labels' : undefined);
    }

    if (!map.getSource('austin-landscape')) {
      map.addSource('austin-landscape', { type:'geojson', data:'data/landscape.geojson' });
    }
    if (!map.getLayer('landscape-pitch')) {
      map.addLayer({
        id:'landscape-pitch', type:'fill', source:'austin-landscape',
        filter:['==',['get','kind'],'pitch'],
        paint:{ 'fill-color':'#9dbd7e', 'fill-opacity':0.9 },
      }, map.getLayer('buildings-3d') ? 'buildings-3d' : undefined);
    }
    if (!map.getLayer('landscape-fountain')) {
      map.addLayer({
        id:'landscape-fountain', type:'fill', source:'austin-landscape',
        filter:['==',['get','kind'],'fountain'],
        paint:{ 'fill-color':'#b7d2dc', 'fill-opacity':1 },
      }, map.getLayer('buildings-3d') ? 'buildings-3d' : undefined);
    }
  }
  window.addDetailLayers = addDetailLayers;

  // ── Date change ───────────────────────────────────────────────────
  function onDateChanged(newDate) {
    const prev = activeDate; activeDate = newDate;
    const el = document.getElementById('hud-snapshot');
    if (el) el.textContent = `Data snapshot: ${newDate}`;
    if (!manifest || !prev || prev === newDate) return;
    const diff = (manifest.diffs||[]).find(d => d.includes(`${prev}_to_${newDate}`) || d.includes(`${newDate}_to_${prev}`));
    if (diff) {
      const from = diff.match(/(\d{4}-\d{2}-\d{2})_to_/)?.[1];
      const to   = diff.match(/_to_(\d{4}-\d{2}-\d{2})/)?.[1];
      if (from && to && typeof initDiffTour === 'function') initDiffTour(map, manifest, from, to);
    }
  }

  // ── Debug toggle ──────────────────────────────────────────────────
  function wireDebugToggle() {
    const toggle = document.getElementById('debug-toggle');
    const legend = document.getElementById('debug-legend');
    if (!toggle) return;
    toggle.addEventListener('change', () => {
      const on = toggle.checked;
      window.__debugActive = on;
      if (legend) legend.classList.toggle('hidden', !on);
      if (!map.getLayer('buildings-3d')) return;
      if (on) {
        map.setPaintProperty('buildings-3d','fill-extrusion-color',COLOR_DEBUG);
        map.setPaintProperty('buildings-3d','fill-extrusion-opacity',BUILDING_OPACITY_DEBUG);
      } else {
        map.setPaintProperty('buildings-3d','fill-extrusion-opacity',BUILDING_OPACITY);
        if (typeof applyTimeOfDay === 'function')
          applyTimeOfDay(map, window.__todCurrentP != null ? window.__todCurrentP : DEFAULT_P);
      }
    });
  }

  init();
})();
