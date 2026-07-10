/**
 * app.js — Austin 3D Explorer main entry point
 */
(function () {
  'use strict';

  const protocol = new pmtiles.Protocol();
  maplibregl.addProtocol('pmtiles', protocol.tile.bind(protocol));

  // Spawn inside the West Campus tower cluster (Dobie, Castilian, Skyloft,
  // Moontower, Ion nearby) so you're among buildings on load, not on a lawn.
  const SPAWN = { center: [-97.7434, 30.2857], zoom: 16.5, pitch: 60, bearing: 90 };
  const DEFAULT_P = (typeof window.TOD_DEFAULT_P === 'number') ? window.TOD_DEFAULT_P : 0.30;

  const COLOR_NORMAL = ['interpolate',['linear'],['get','final_height'],0,'#c8a96e',20,'#b8956a',40,'#a07850',70,'#8a6040',100,'#6b4226'];
  const COLOR_DEBUG  = ['match',['get','source_height'],'overture','#4CAF50','hero_override','#9C27B0','#FF9800'];
  const BUILDING_OPACITY = 0.92, BUILDING_OPACITY_DEBUG = 0.88;

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
  // Download the whole .pmtiles once and read tiles from memory instead of via
  // HTTP range requests. The file is small (~0.6 MB) and this sidesteps hosts
  // (e.g. Vercel) that Brotli-compress the file and/or don't support byte-range
  // requests — which silently breaks range-based PMTiles so most tiles never
  // load. Host-agnostic; verified against a Vercel-mimicking server.
  const registeredKeys = new Set();
  async function registerSnapshotSource(date) {
    const key = `austin-${date}.pmtiles`;
    if (!registeredKeys.has(key)) {
      const resp = await fetch(`data/snapshots/${date}/austin.pmtiles`);
      if (!resp.ok) throw new Error(`pmtiles HTTP ${resp.status}`);
      const buf = await resp.arrayBuffer();
      protocol.add(new pmtiles.PMTiles(new pmtiles.FileSource(new File([buf], key))));
      registeredKeys.add(key);
    }
    return `pmtiles://${key}`;
  }
  window.registerSnapshotSource = registerSnapshotSource;

  function snapshotUrlFor(date) { return `pmtiles://austin-${date}.pmtiles`; }

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

    // Load the snapshot fully into memory before the map needs it.
    if (activeDate) {
      try { await registerSnapshotSource(activeDate); }
      catch (e) { console.warn('pmtiles load failed:', e.message); }
    }

    map = new maplibregl.Map({
      container:'map', style:'https://tiles.openfreemap.org/styles/liberty',
      center:SPAWN.center, zoom:SPAWN.zoom, pitch:SPAWN.pitch, bearing:SPAWN.bearing,
      maxPitch:85, antialias:true, scrollZoom:false,
    });

    // ── Live diagnostics ──────────────────────────────────────────
    // On-screen readout so the deployed app can report its own runtime state
    // (screenshot it to debug). Captures map errors + rebuilds a status line
    // every second: building features currently rendered, whether the tile
    // source is loaded, current zoom, and any tile/source error.
    let errCount = 0, lastErr = '';
    map.on('error', (e) => {
      errCount++;
      lastErr = (e && e.error && e.error.message) ? String(e.error.message).slice(0, 90) : 'unknown';
      console.warn('MAP ERROR:', lastErr);
    });
    function updateDiag() {
      const el = document.getElementById('diag');
      if (!el || !map) return;
      // loaded = features present in loaded tiles (camera-independent, the real
      // "did tiles load" signal). view = queryRenderedFeatures (in-view only,
      // unreliable for 3D at an angle — informational).
      let loaded = 'n/a', view = 'n/a';
      try { loaded = map.getSource('austin-buildings') ? map.querySourceFeatures('austin-buildings', { sourceLayer: 'buildings' }).length : 'no-src'; } catch (e) {}
      try { view = map.getLayer('buildings-3d') ? map.queryRenderedFeatures({ layers: ['buildings-3d'] }).length : 'no-layer'; } catch (e) {}
      let srcLoaded = '?';
      try { srcLoaded = map.getSource('austin-buildings') ? map.isSourceLoaded('austin-buildings') : 'no-src'; } catch (e) {}
      el.textContent =
        `loaded:${loaded}  view:${view}  src:${srcLoaded}  z:${map.getZoom().toFixed(1)}  err:${errCount}` +
        (lastErr ? `\n${lastErr}` : '');
    }
    setInterval(updateDiag, 1000);

    map.on('load', () => {
      // NOTE: terrain intentionally disabled. Terrain + setSky + 3D
      // fill-extrusions made buildings render one frame then get culled behind
      // the raised ground surface (and caused buildings to float on slopes).
      // Slope is deprioritised for now; revisit with a draped, non-exaggerated
      // approach later. See addTerrain() below (kept, not called).
      if (activeDate) addBuildingLayers(snapshotUrlFor(activeDate));
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
        if (typeof initSigns === 'function') initSigns(map);
        if (typeof applyTimeOfDay === 'function')
          applyTimeOfDay(map, window.__todCurrentP != null ? window.__todCurrentP : DEFAULT_P);
      }
    });
  }

  // ── Terrain ───────────────────────────────────────────────────────
  function addTerrain() {
    if (map.getSource('terrain-dem')) return;
    map.addSource('terrain-dem', {
      type:'raster-dem',
      tiles:['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
      encoding:'terrarium', tileSize:256, maxzoom:15,
    });
    map.setTerrain({ source:'terrain-dem', exaggeration:1.5 });
    if (!map.getLayer('hillshade')) {
      map.addLayer({
        id:'hillshade', type:'hillshade', source:'terrain-dem',
        paint:{ 'hillshade-illumination-anchor':'map','hillshade-intensity':0.25,'hillshade-shadow-color':'#3a200a','hillshade-highlight-color':'#f5dfa0' },
      }, 'water');
    }
  }

  // ── Building layers ───────────────────────────────────────────────
  window.addBuildingLayers = function addBuildingLayers(pmtilesUrl) {
    if (!map.getSource('austin-buildings')) {
      map.addSource('austin-buildings', { type:'vector', url:pmtilesUrl, minzoom:12, maxzoom:16 });
    }
    if (!map.getLayer('buildings-3d')) {
      map.addLayer({
        id:'buildings-3d', type:'fill-extrusion',
        source:'austin-buildings', 'source-layer':'buildings',
        paint:{
          'fill-extrusion-color':COLOR_NORMAL,
          'fill-extrusion-height':['get','final_height'],
          'fill-extrusion-base':0,
          'fill-extrusion-opacity':BUILDING_OPACITY,
          // NOTE: fill-extrusion-ambient-occlusion-* are MapLibre v5-only. This
          // app loads v4.7.1, where they're invalid and cause addLayer to reject
          // the whole layer — so buildings never rendered (you were seeing the
          // basemap's own buildings, which cleanupBasemap then hid). Use
          // vertical-gradient (v4-valid) for depth instead.
          'fill-extrusion-vertical-gradient':true,
        },
      });
    }

    const signLayout = {
      'text-field':['get','name'],
      'text-font':['Open Sans Semibold','Arial Unicode MS Bold'],
      'text-size':['interpolate',['linear'],['zoom'],15.5,9,17,13,19,16],
      'text-anchor':'center', 'symbol-placement':'point', 'text-offset':[0,-1],
    };

    if (!map.getLayer('buildings-signs-glow')) {
      map.addLayer({
        id:'buildings-signs-glow', type:'symbol',
        source:'austin-buildings', 'source-layer':'buildings',
        minzoom:15.5, filter:['!=',['get','name'],null],
        // Declutter like the label layer so night mode isn't a wall of
        // overlapping glow. Curated branded signs (data/signs.json) layer
        // on top of this as the real hero signage.
        layout:Object.assign({},signLayout,{'text-allow-overlap':false}),
        paint:{'text-color':'#ffd9a0','text-halo-color':'#ff7a2f','text-halo-width':8,'text-halo-blur':6,'text-opacity':0},
      });
    }
    if (!map.getLayer('buildings-labels')) {
      map.addLayer({
        id:'buildings-labels', type:'symbol',
        source:'austin-buildings', 'source-layer':'buildings',
        minzoom:15.5, filter:['!=',['get','name'],null],
        layout:Object.assign({},signLayout,{'text-allow-overlap':false}),
        paint:{
          'text-color':'#fff8e8','text-halo-color':'rgba(30,15,0,0.85)','text-halo-width':1.5,
          'text-opacity':['interpolate',['linear'],['zoom'],15.5,0,16,1],
        },
      });
    }
  };

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
        else
          map.setPaintProperty('buildings-3d','fill-extrusion-color',COLOR_NORMAL);
      }
    });
  }

  init();
})();
