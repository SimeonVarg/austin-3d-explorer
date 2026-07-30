/**
 * app.js — Austin 3D Explorer main entry point
 *
 * Buildings are a plain GeoJSON source (baked by scripts/bake_detail.py with
 * per-feature day/golden/night colours). PMTiles was dropped: at 2,443
 * buildings the GeoJSON is ~1.4 MB and MapLibre client-tiles it in a worker,
 * which also removes the Vercel byte-range/Brotli failure mode entirely.
 *
 * The snapshot is fetched here rather than handed to MapLibre as a URL,
 * because a single client-side pass over the features earns three things that
 * are impossible to express as style properties:
 *   1. facade patterns  — quantise 900 wall colours into a small palette so
 *      every building can carry a window texture (see facades.js)
 *   2. ground shadows   — swept-silhouette geometry per footprint (shadows.js)
 *   3. label dedup      — suppress the OSM name where a curated sign already
 *      says the same thing ("The Mark" / "The Mark Austin")
 * It's the same one download either way.
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

  let map=null, activeDate=null, manifest=null, scene=null, built=false;

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

  // ── Scene data ────────────────────────────────────────────────────
  async function getJSON(url, fallback) {
    try { const r = await fetch(url); if (!r.ok) throw new Error(r.status); return await r.json(); }
    catch (e) { console.warn('fetch', url, e.message); return fallback; }
  }

  /** Strip decoration so "The Mark Austin" and "The Mark" collide. */
  function normName(s) {
    s = String(s || '').toLowerCase().trim();
    s = s.replace(/[.,–—-]/g, ' ').replace(/\s+/g, ' ').trim();
    if (s.startsWith('the ')) s = s.slice(4);
    if (s.endsWith(' austin')) s = s.slice(0, -7);
    return s;
  }

  async function loadScene(date) {
    const [buildings, parts, signs] = await Promise.all([
      getJSON(snapshotUrlFor(date), { type:'FeatureCollection', features: [] }),
      getJSON(`data/snapshots/${date}/parts.detailed.geojson`, { type:'FeatureCollection', features: [] }),
      getJSON('data/signs.json', { type:'FeatureCollection', features: [] }),
    ]);

    // Facade quantisation — assigns wp (pattern id) + wf (family) per feature.
    let stats = null;
    if (typeof quantiseFacades === 'function') {
      stats = quantiseFacades(buildings.features);
      if (typeof quantisePartFacades === 'function') quantisePartFacades(parts.features);
    }

    // Label eligibility. `name` exists on every feature (often null), so decide
    // it once here instead of fighting null-handling inside a filter expression.
    const signNames = new Set();
    for (const f of (signs.features || [])) {
      const n = normName(f.properties && f.properties.label);
      if (n) signNames.add(n);
    }
    const isDuplicate = (name) => {
      const n = normName(name);
      if (!n) return false;
      if (signNames.has(n)) return true;
      for (const s of signNames) if (s.length >= 6 && (s.includes(n) || n.includes(s))) return true;
      return false;
    };
    let labelled = 0;
    for (const f of buildings.features) {
      const p = f.properties;
      const name = p && p.name;
      // Only name buildings that are big enough to carry a label and aren't
      // already announced by a curated sign. This is what took the scene from
      // ~70 labels a frame down to something you can actually read.
      if (name && !isDuplicate(name) && (p.final_height || 0) >= 12) { p.lbl = 1; labelled++; }
    }

    console.log('[scene]', buildings.features.length, 'buildings,',
                stats ? `${stats.buckets} colour buckets / ${stats.patterns} facade patterns,` : '',
                labelled, 'OSM labels kept of', (signs.features || []).length, 'signs');
    return { buildings, parts, signs };
  }

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
      maxPitch:85, scrollZoom:false, attributionControl:{ compact:true },
      // v5: antialias moved into canvasContextAttributes
      canvasContextAttributes: { antialias: true },
    });
    window.__map = map;
    if (typeof map.setVerticalFieldOfView === 'function') map.setVerticalFieldOfView(58);

    map.on('error', (e) => {
      const msg = (e && e.error && e.error.message) ? e.error.message : 'unknown';
      console.warn('MAP ERROR:', msg);
    });

    const scenePromise = activeDate ? loadScene(activeDate) : Promise.resolve(null);

    map.on('load', async () => {
      // NOTE: terrain intentionally disabled — it culled buildings and made
      // them float on slopes (see HANDOFF §7.4). Slope is deprioritised.
      scene = await scenePromise;
      buildScene();
    });

    map.on('styledata', () => {
      // Strip the basemap's own buildings/POIs as soon as the style parses —
      // earlier than the 'load' event — so they never flash on screen. The
      // _cleaned guard inside makes repeat calls no-ops.
      if (typeof cleanupBasemap === 'function') cleanupBasemap(map);
    });
  }

  // Each stage is isolated: a single throwing subsystem used to take down every
  // stage after it (a stale date-switcher crash silently cost the whole scene
  // its sky, shadows and signage), and that failure mode is invisible on screen.
  function step(name, fn) {
    try { fn(); } catch (e) { console.error(`[buildScene] ${name} failed:`, e); }
  }

  function buildScene() {
    if (built) return;
    built = true;
    const p = DEFAULT_P;

    if (scene) {
      // Facade images must exist before any layer references them, or MapLibre
      // logs "image not found" and paints the walls transparent.
      step('facades',  () => initFacades(map, p));
      step('buildings',() => addBuildingLayers(scene));
      step('shadows',  () => initShadows(map, scene.buildings.features, p));
      step('detail',   () => addDetailLayers(scene));
      step('labels',   () => addLabelLayers());
    }
    step('signs',    () => initSigns(map, scene && scene.signs));
    step('sky',      () => initSky(map));
    step('haze',     () => initAtmosphere(map));
    step('basemap',  () => cleanupBasemap(map));
    step('controls', () => initControls(map, scene));
    step('dates',    () => { if (manifest) initDateSwitcher(map, manifest, activeDate, onDateChanged); });
    step('debug',    () => { applyDebugVisibility(); wireDebugToggle(); });
    step('tod',      () => { applyTimeOfDay(map, p); initTimeOfDayUI(map, p); });
    step('intro',    () => startIntro());
  }

  // ── Building layers ───────────────────────────────────────────────
  // Buildings whose volume is replaced by OSM building:parts carry
  // has_parts=1 and are excluded from the base layers; parts-* render the
  // detailed massing (podium + tower setbacks) instead.
  const NO_PARTS = ['!', ['has', 'has_parts']];
  const CAP_MIN_HEIGHT = 2.5; // sheds don't get a parapet cap

  function facadePaint(heightExpr, baseExpr) {
    return {
      'fill-extrusion-pattern': window.FACADE_PATTERN_EXPR,
      'fill-extrusion-height': heightExpr,
      'fill-extrusion-base': baseExpr,
      'fill-extrusion-opacity': BUILDING_OPACITY,
      'fill-extrusion-vertical-gradient': true,
    };
  }

  window.addBuildingLayers = function addBuildingLayers(sc) {
    if (!map.getSource('austin-buildings')) {
      map.addSource('austin-buildings', { type:'geojson', data: sc.buildings });
    }
    if (!map.getLayer('buildings-3d')) {
      map.addLayer({
        id:'buildings-3d', type:'fill-extrusion',
        source:'austin-buildings', filter: NO_PARTS,
        paint: facadePaint(['get','final_height'], 0),
      });
    }
    // Parapet/roof cap: the top ~1.2 m re-extruded in the roof colour, ending
    // slightly above the wall so the top face reads as a roof from the air —
    // and so the window pattern never wraps over the roof plane.
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
  };

  // ── Detail layers: OSM building parts, trees, pitches, fountains ──
  function addDetailLayers(sc) {
    if (!map.getSource('austin-parts')) {
      map.addSource('austin-parts', { type:'geojson', data: sc.parts });
    }
    if (!map.getLayer('parts-3d')) {
      map.addLayer({
        id:'parts-3d', type:'fill-extrusion', source:'austin-parts',
        paint: facadePaint(['get','h'], ['get','base']),
      });
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
      });
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
      });
    }
    if (!map.getLayer('trees-canopy')) {
      map.addLayer({
        id:'trees-canopy', type:'fill-extrusion', source:'austin-trees',
        minzoom:14, filter:['==',['get','kind'],'canopy'],
        paint:{
          'fill-extrusion-color':['interpolate',['linear'],['get','h'],6,'#93ad70',15,'#5f7d4a'],
          'fill-extrusion-height':['get','h'],
          'fill-extrusion-base':['get','base'],
          'fill-extrusion-opacity':1.0,
          'fill-extrusion-vertical-gradient':true,
        },
      });
    }

    if (!map.getSource('austin-landscape')) {
      map.addSource('austin-landscape', { type:'geojson', data:'data/landscape.geojson' });
    }
    if (!map.getLayer('landscape-pitch')) {
      map.addLayer({
        id:'landscape-pitch', type:'fill', source:'austin-landscape',
        filter:['==',['get','kind'],'pitch'],
        paint:{ 'fill-color':'#9dbd7e', 'fill-opacity':0.9 },
      }, map.getLayer('buildings-shadow') ? 'buildings-shadow' : 'buildings-3d');
    }
    if (!map.getLayer('landscape-fountain')) {
      map.addLayer({
        id:'landscape-fountain', type:'fill', source:'austin-landscape',
        filter:['==',['get','kind'],'fountain'],
        paint:{ 'fill-color':'#b7d2dc', 'fill-opacity':1 },
      }, map.getLayer('buildings-shadow') ? 'buildings-shadow' : 'buildings-3d');
    }
  }
  window.addDetailLayers = addDetailLayers;

  // ── Labels ────────────────────────────────────────────────────────
  // Secondary tier: real OSM building names, held back until you're low
  // enough that they're context rather than clutter. Taller buildings win
  // placement so the skyline reads first.
  function addLabelLayers() {
    if (map.getLayer('buildings-labels')) return;
    map.addLayer({
      id:'buildings-labels', type:'symbol',
      source:'austin-buildings',
      minzoom:16.4, filter:['==',['get','lbl'],1],
      layout:{
        'text-field':['get','name'],
        // Only Noto Sans Regular/Bold/Italic exist on OpenFreeMap's glyph
        // server — a missing fontstack 404s and MapLibre discards the whole
        // tile it was needed for.
        'text-font':['Noto Sans Regular'],
        'text-size':['interpolate',['linear'],['zoom'],16.4,10,18,12,19.5,14],
        'text-anchor':'center', 'text-offset':[0,-0.6],
        'text-max-width':7, 'text-padding':9,
        'text-allow-overlap':false,
        'symbol-sort-key':['-', 0, ['get','final_height']],
      },
      paint:{
        'text-color':'#f3e6cd','text-halo-color':'rgba(24,14,5,0.9)','text-halo-width':1.3,
        'text-opacity':['interpolate',['linear'],['zoom'],16.4,0,17.1,0.82],
      },
    });
  }

  // ── Cinematic intro ───────────────────────────────────────────────
  // A slow dolly-in on load. It costs nothing and it's the difference between
  // "a map loaded" and "a place opened". Any input cancels it immediately.
  function startIntro() {
    if (new URLSearchParams(window.location.search).get('intro') === '0') return;
    let cancelled = false;
    const cancel = () => {
      if (cancelled) return;
      cancelled = true;
      map.stop();
      // Land on the full spawn pose. Stopping mid-ease used to strand the
      // camera at whatever partial zoom/pitch the tween had reached.
      map.jumpTo({ center: SPAWN.center, zoom: SPAWN.zoom, pitch: SPAWN.pitch, bearing: SPAWN.bearing });
      off();
    };
    const evts = ['mousedown','wheel','keydown','touchstart'];
    const off = () => evts.forEach(e => window.removeEventListener(e, cancel, true));
    evts.forEach(e => window.addEventListener(e, cancel, true));

    map.jumpTo({ center: SPAWN.center, zoom: SPAWN.zoom - 1.35, pitch: 52, bearing: SPAWN.bearing - 30 });
    map.easeTo({
      center: SPAWN.center, zoom: SPAWN.zoom, pitch: SPAWN.pitch, bearing: SPAWN.bearing,
      duration: 9000,
      easing: t => 1 - Math.pow(1 - t, 3),   // ease-out cubic: fast settle, long drift
    });
    setTimeout(off, 9600);
  }

  // ── Date change ───────────────────────────────────────────────────
  async function onDateChanged(newDate) {
    const prev = activeDate; activeDate = newDate;
    const el = document.getElementById('hud-snapshot');
    if (el) el.textContent = `Data snapshot: ${newDate}`;
    if (prev !== newDate) {
      scene = await loadScene(newDate);
      if (typeof updateFacades === 'function') updateFacades(map, window.__todCurrentP ?? DEFAULT_P);
      const bs = map.getSource('austin-buildings'); if (bs) bs.setData(scene.buildings);
      const ps = map.getSource('austin-parts');     if (ps) ps.setData(scene.parts);
      if (typeof initShadows === 'function') initShadows(map, scene.buildings.features, window.__todCurrentP ?? DEFAULT_P);
      if (typeof window.__flyRebuildCollision === 'function') window.__flyRebuildCollision(scene);
    }
    if (!manifest || !prev || prev === newDate) return;
    const diff = (manifest.diffs||[]).find(d => {
      const f = typeof d === 'string' ? d : d.file || '';
      return f.includes(`${prev}_to_${newDate}`) || f.includes(`${newDate}_to_${prev}`);
    });
    if (diff) {
      const f = typeof diff === 'string' ? diff : diff.file || '';
      const from = f.match(/(\d{4}-\d{2}-\d{2})_to_/)?.[1];
      const to   = f.match(/_to_(\d{4}-\d{2}-\d{2})/)?.[1];
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
        // A pattern always wins over a colour, so it has to come off first.
        map.setPaintProperty('buildings-3d','fill-extrusion-pattern',null);
        map.setPaintProperty('buildings-3d','fill-extrusion-color',COLOR_DEBUG);
        map.setPaintProperty('buildings-3d','fill-extrusion-opacity',BUILDING_OPACITY_DEBUG);
      } else {
        map.setPaintProperty('buildings-3d','fill-extrusion-pattern',window.FACADE_PATTERN_EXPR);
        map.setPaintProperty('buildings-3d','fill-extrusion-opacity',BUILDING_OPACITY);
        if (typeof applyTimeOfDay === 'function')
          applyTimeOfDay(map, window.__todCurrentP != null ? window.__todCurrentP : DEFAULT_P);
      }
    });
  }

  init();
})();
