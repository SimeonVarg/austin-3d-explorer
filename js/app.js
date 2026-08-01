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
  // Pitch 74 (was 64) holds the horizon about a fifth from the top of a
  // portrait frame instead of a tenth — the sky work is finally IN the phone
  // frame. Bearing 250 faces the golden-hour sun (az ≈ 247–256 near p = 0.5)
  // instead of leaving it behind the camera. Both are one-line taste edits.
  const SPAWN = { center: [-97.7434, 30.2857], zoom: 16.5, pitch: 74, bearing: 250 };
  // ?p=0.32 overrides the opening hour for filming without touching the UI.
  const urlP = parseFloat(new URLSearchParams(window.location.search).get('p'));
  const DEFAULT_P = (isFinite(urlP) && urlP >= 0 && urlP <= 1) ? urlP
    : (typeof window.TOD_DEFAULT_P === 'number') ? window.TOD_DEFAULT_P : 0.30;

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

    // The Capitol Complex, south of the snapshot's own bbox, is spliced in
    // HERE — before quantisation and before the label pass — so it earns
    // facade patterns, shadows, labels and collision like anything else
    // rather than being a second class of building. See js/capitol.js.
    if (typeof mergeCapitolScene === 'function') {
      await mergeCapitolScene(buildings, parts);
    }

    // Union on 24th arrives from Overture as one solid quad, so its 36 m court —
    // the most visible feature in West Campus from the air — is simply missing.
    // Footprint is not overridable via hero_overrides.json, so it is corrected in
    // place here, before quantisation, for the same reason the Capitol is.
    if (typeof applyUnion24 === 'function') applyUnion24(buildings.features);

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
      // v5: antialias moved into canvasContextAttributes. It defaults OFF here
      // because it is the most expensive single option in the whole app —
      // measured over a 4 s flight at 2560x1400, turning MSAA off took dropped
      // frames from 128 to 53. There is no way to change it on a live WebGL
      // context, so it has to be read from the saved settings at construction;
      // the graphics menu offers it with a reload prompt.
      // preserveDrawingBuffer is what lets the bloom pass read the rendered frame
      // back out (graphics.js). It is not free, so it is only requested when the
      // saved settings actually want bloom.
      canvasContextAttributes: { antialias: !!window.GFX_MSAA, preserveDrawingBuffer: !!window.GFX_PDB },
    });
    window.__map = map;
    if (typeof map.setVerticalFieldOfView === 'function')
      map.setVerticalFieldOfView((window.GFX && window.GFX.fov) || 58);

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
    // The load screen's progress is these calls and nothing else — no timer, no
    // fake creep. A stage that throws still reports, because the user is waiting
    // on the stage AFTER it and a bar frozen at 40% is a worse lie than one that
    // moves on. js/loader.js ignores names it does not know.
    try { if (window.loaderStage) window.loaderStage(name); } catch (e) {}
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
      // After the buildings exist (initGround inserts itself UNDER them) and
      // before shadows, so the swept shadows land on the real surfaces.
      step('ground',   () => { if (typeof initGround === 'function') initGround(map); });
      step('props',    () => { if (typeof initProps === 'function') initProps(map); });
      step('shadows',  () => initShadows(map, scene.buildings.features, p));
      step('roofs',    () => addRoofLayers());
      step('stadium',  () => addStadiumLayers());
      step('detail',   () => addDetailLayers(scene));
      // After 'ground' and 'detail': initCapitol merges into austin-ground and
      // austin-trees, so both sources have to exist first.
      step('capitol',  () => { if (typeof initCapitol === 'function') initCapitol(map); });
      step('labels',   () => addLabelLayers());
    }
    step('signs',    () => initSigns(map, scene && scene.signs));
    step('night',    () => { if (typeof initNight === 'function') initNight(map); });
    step('sky',      () => initSky(map));
    // After sky (renderFX is driven from updateSky) and after the layers exist,
    // because applyGraphics() toggles buildings-ao / buildings-shadow.
    step('graphics', () => initGraphics(map));
    step('basemap',  () => cleanupBasemap(map));
    step('controls', () => initControls(map, scene));
    step('dates',    () => { if (manifest) initDateSwitcher(map, manifest, activeDate, onDateChanged); });
    step('debug',    () => { applyDebugVisibility(); wireDebugToggle(); });
    step('tod',      () => { applyTimeOfDay(map, p); initTimeOfDayUI(map, p); });
    step('reveal',   () => revealAndIntro());
    // Never in the pixel harness: a camera that starts moving on its own mid-
    // assertion is exactly the flake the trap list warns about. Drift is
    // verified through index.html scripts instead.
    step('idle',     () => { if (!window.__HARNESS) initIdleCinema(); });
    step('orbit',    () => initLandmarkOrbit());
    step('tour',     () => initTourKey());
    step('photo',    () => initPhotoKey());
  }

  // ── Building layers ───────────────────────────────────────────────
  // Buildings whose volume is replaced by OSM building:parts carry
  // has_parts=1 and are excluded from the base layers; parts-* render the
  // detailed massing (podium + tower setbacks) instead.
  // ── Why every patterned source is capped at maxzoom 16 ────────────
  //
  // Reported as "glitchy whenever I move", city-wide, worse at night, unrelated
  // to the day cycle. A screen recording settled it in two frames: the same wall,
  // one frame a clean regular grid of lit windows, the next frame that same grid
  // PLUS a superimposed torn copy of itself at a narrower, squeezed scale. Not
  // shimmer — two patterns at two different scales composited into one wall.
  // In his words, "most of the vision is a blur between the states".
  //
  // That is what `*-pattern` does by design. MapLibre anchors it to the TILE, not
  // to the world, so its size in metres is a function of the tile's zoom
  // (measured: a 64 px repeat covers ~33 m at z16, ~16.5 at z17, ~8.2 at z18),
  // and it CROSS-FADES between adjacent zoom levels while both are on screen.
  // While the camera moves, tiles are constantly being served, replaced and
  // over-zoomed, so a given wall keeps changing which tile zoom it is drawn from
  // — and every one of those changes drags the window grid through a blend
  // between two different scales. Stationary, nothing changes and it looks fine,
  // which is exactly the reported behaviour.
  //
  // Capping the source's own maxzoom fixes it at the root. Above the cap every
  // tile is an OVERSCALE of one level, so the pattern's size in tile units — and
  // therefore in metres — stops changing, there is no adjacent level to fade to,
  // and the window grid becomes world-locked the way it always should have been.
  // 16 is the cap because a z16 tile is ~611 m at this latitude, which keeps
  // geometry precision at 611/4096 = 0.15 m, far finer than any wall detail here.
  //
  // The same trick, for the same underlying reason, already fixed the lid over
  // DKR's bowl (geojson-vt dropping a hole when a tile fell entirely inside it).
  // Both are "the tile grid is not the world" bugs.
  window.PATTERN_TILING = { maxzoom: 16, tolerance: 0.5, buffer: 128 };

  const NO_PARTS = ['!', ['has', 'has_parts']];
  const CAP_MIN_HEIGHT = 2.5; // sheds don't get a parapet cap

  // Parapet cap geometry. It used to be `base: h - 1.2, height: h + 0.4` — a cap
  // whose side faces were EXACTLY COPLANAR with the wall's over a 1.2 m band.
  // Two coplanar surfaces with different colours is textbook z-fighting: which
  // one wins is decided by depth-buffer rounding, so it flips as the camera
  // moves. Desktop's 24-bit depth mostly hides it; a phone's does not, which is
  // exactly where it showed up ("roofs glitch out while I'm moving").
  // Sitting the cap ON the wall instead of inside it removes the shared surface
  // altogether, and reads the same from the air — a raised parapet lip.
  // The remaining risk after removing the shared side faces is the two
  // horizontal faces: the wall's top at h and the cap's top just above it. A
  // phone's depth buffer is often 16-bit, and MapLibre's far plane at a flying
  // pitch is kilometres away, so a fraction of a metre of separation at
  // mid-distance can fall below the depth resolution and let the wall's roof
  // poke through the cap's in a speckle. Scaling the lift with height gives the
  // buildings that are furthest away (the tall ones you see across the city) the
  // most separation, and 1.0-1.5 m is a real parapet anyway.
  const capLiftNum = h => Math.max(1.0, 0.015 * h);            // metres, for a known h
  const capLift    = h => ['max', 1.0, ['*', 0.015, h]];       // the same rule, as an expression
  const capHeight  = h => ['+', h, capLift(h)];
  const capBase    = h => h;
  // Exported because diff-tour.js overrides these same two properties while it
  // tweens a building's height and then has to restore them. It used to carry
  // its own copy of the `+0.4 / -1.2` literals in three places, so the geometry
  // rule lived in two files and could silently diverge.
  window.CAP_GEOM = { liftFor: capLiftNum, height: capHeight, base: capBase, minHeight: CAP_MIN_HEIGHT };

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
      map.addSource('austin-buildings', { type:'geojson', data: sc.buildings, ...window.PATTERN_TILING });
    }
    // Contact shadows (ambient occlusion, near enough). A blurred dark line ON
    // the footprint outline puts half its width inside the building — where the
    // extrusion hides it — and half outside, which lands as a soft dark halo
    // hugging every base. Without it, extrusions look pasted onto the ground
    // rather than standing on it, and no amount of sun shadow fixes that,
    // because sun shadow falls on one side only. No NO_PARTS filter here: a
    // parts building still has a ground footprint that needs grounding.
    if (!map.getLayer('buildings-ao')) {
      map.addLayer({
        id:'buildings-ao', type:'line', source:'austin-buildings', minzoom:14,
        layout:{ 'line-join':'round', visibility: (window.GFX && window.GFX.ao === false) ? 'none' : 'visible' },
        paint:{
          'line-color':'#120c06',
          // First attempt used 0.38 alpha on a ~5 px line and was invisible in a
          // side-by-side render. Occlusion is a big soft gradient, not an
          // outline: the blur has to be WIDER than the line for the hard edge to
          // disappear, and the opacity has to be high enough to survive it.
          // Blur radius is fill rate: at 84 px on ~2,400 footprints this layer
          // measured 3.6 fps at 2560x1400. Halving the radii keeps the halo
          // reading as occlusion (it still exceeds the line width, which is what
          // hides the hard edge) at roughly half the overdraw.
          'line-opacity':['interpolate',['linear'],['zoom'],14,0.32,16,0.62,18,0.74],
          'line-width':['interpolate',['exponential',1.6],['zoom'],14,1.5,16,4,18,12,20,28],
          'line-blur' :['interpolate',['exponential',1.6],['zoom'],14,2,16,7,18,19,20,44],
        },
      });
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
          'fill-extrusion-height':capHeight(['get','final_height']),
          'fill-extrusion-base':capBase(['get','final_height']),
          'fill-extrusion-opacity':1.0,
        },
      });
    }
  };

  // Tree density: 1.0 draws every tree, 0.5 keeps the biggest half, and so on.
  // Lives on GFX so the graphics menu and the auto-detect probe can move it.
  window.treeFilter = function treeFilter(kind) {
    const dens = (window.GFX && typeof window.GFX.treeDensity === 'number')
      ? window.GFX.treeDensity : 1;
    return dens >= 1
      ? ['==', ['get', 'kind'], kind]
      : ['all', ['==', ['get', 'kind'], kind], ['<=', ['get', 'd'], dens]];
  };
  window.applyTreeDensity = function applyTreeDensity(map) {
    for (const [id, kind] of [['trees-trunk', 'trunk'], ['trees-canopy', 'canopy']]) {
      try { if (map.getLayer(id)) map.setFilter(id, window.treeFilter(kind)); } catch (e) {}
    }
  };

  // ── Pitched roofs across campus ───────────────────────────────────
  // fill-extrusion has exactly one roof shape — flat — and a campus of flat
  // prisms is the loudest tell that a scene is generated. data/roofs.geojson
  // (scripts/bake_roofs.py) approximates a hip with STEPPED INSET FACETS on 100
  // buildings. WHICH buildings, and HOW FAR IN the slope runs, are both factual:
  // each footprint's offset rings are sampled for terracotta against nadir
  // aerial imagery, calibrated on the buildings OSM tags with roof:shape. The
  // stepped SHAPE is generative and reads as a pitch from the air.
  // Each facet carries `az`, the direction its slope faces, and its colour is
  // chosen between a dark and a bright baked end by timeofday.js from the live
  // sun — without that, every horizontal tread shades identically and the roof
  // renders as a flat plane with stripes on it. See roofFacetColor().
  window.addRoofLayers = function addRoofLayers() {
    if (map.getSource('austin-roofs')) return;
    map.addSource('austin-roofs', { type:'geojson', data:'data/roofs.geojson' });
    if (!map.getLayer('roofs-pitched')) {
      map.addLayer({
        id:'roofs-pitched', type:'fill-extrusion', source:'austin-roofs', minzoom:14,
        paint:{
          // Derived from the same baked per-feature colours as the wall cap it
          // sits on, so the two can never drift apart across the day. This is
          // only the first frame's value — applyTimeOfDay replaces it with the
          // sun-aware per-facet expression immediately.
          'fill-extrusion-color':['to-color',['get','rd']],
          'fill-extrusion-height':['get','h'],
          'fill-extrusion-base':['get','b'],
          'fill-extrusion-opacity':1.0,
        },
      });
    }
  };

  // ── Stadium: an open bowl, not a mesa ─────────────────────────────
  // A stadium footprint is a ring, and extruding it gives a solid lid with a
  // pit in it — DKR's ring is 82% of its footprint area, so 82% of the stadium
  // was being drawn as roof. In the aerial almost all of that is open seating,
  // and it is the BRIGHTEST large surface in the photograph. So the building's
  // own extrusion is replaced here by a thin perimeter WALL plus SEATING bands
  // that span the full ring. See scripts/bake_stadium.py.
  //
  // Seating tones. Two measured facts set these. First, in the aerial the deck
  // is the BRIGHTEST large surface in the photograph. Second, and less obvious:
  // an extrusion's top face picks up the sun tint, so it renders far warmer
  // than the colour you type. A neutral #c9bdaa (R/B 1.18) came back on screen
  // at R/B 1.85 — sand, indistinguishable from the tan campus around it, while
  // the flat ground fill next to it only warmed to 1.34. So these are entered
  // COOL to land neutral, which is also what the material actually is:
  // aluminium bench seating on concrete, not stone.
  // The night values are deliberately as dark as a night WALL. An unlit bowl is
  // not a pale lid: the first cut left the deck at luma ~70 against a city at
  // ~30 and DKR glowed as the brightest thing on the east side of campus, which
  // is the inverted-silhouette failure night-silhouette.mjs exists to catch.
  //
  // The A/B pairs are the ROW STRIPE. The aerial's deck has a luma SD of 51.6
  // and a p10/p90 of 79/228 — it is not a silver surface, it is a hard fine
  // stripe of lit plank against shadowed riser, and painting its MEAN is why
  // v1's bowl read as a smooth dish. bake_stadium.py now emits 44 stepped bands
  // instead of 12 so the geometry itself supplies the risers; these alternating
  // tones keep that stripe alive at 200-900 m, where a 0.74 m step is well under
  // one pixel and the geometry alone would average back to flat.
  //
  // `orange` is the chairback seating that fills the top third of the lower bowl
  // in every interior photograph. Entered COOL for the same reason as the rest:
  // a top face that renders at R/B 1.85 from an input of 1.18 turns a true burnt
  // orange into traffic cone.
  // `stain` is the measured one: clean aluminium reads luma 149.5 in the aerial
  // and weathered aluminium 122.9, in blotches two to eight metres across, and
  // that mottling is a large part of why the real deck never looks like a
  // painted surface. `void` is the black slot under each deck's overhang — the
  // two dark bands that, more than anything else, are what makes a bowl read as
  // a bowl from above.
  // These are not guesses. The first cut of them was, and it measured wrong: an
  // isolated nadir render sampled at R/B 1.21-1.33 and luma 162-176 across the
  // three decks, against the aerial's 1.09 and 149.5. Every deck was coming out
  // at or beyond the warmth of *stained* aluminium, and too bright. The gain
  // from entered to rendered came out at R/B x1.46, so these are entered at
  // R x0.94 / B x1.06 and 9% darker to land on the photograph.
  //
  // The A/B split is also wider than the first cut. The aerial's deck has a luma
  // SD of 51.6; the first render managed 35-42, so the stripe was still being
  // averaged away.
  // NIGHT IS BURNT ORANGE ON PURPOSE, and it is sourced. DKR's 2023-24 lighting
  // upgrade is an instant-start multi-colour LED system whose signature trick is
  // turning the entire stadium burnt orange, and it is the most recognisable
  // thing the building does after dark.
  //
  // These values are set against a MEASUREMENT, after the first attempt failed.
  // Sampling a night frame: DKR came out at mean luma 12.6 against unlit ground
  // and trees at 13.4 — the stadium was literally indistinguishable from bare
  // dirt — while the lit city ran mean 33 with highlights to 92. A cautious lift
  // to ~40 as entered rendered at 12.6, because night attenuation here is about
  // 0.32x; landing at a visible ~45-55 needs entered luma near 150, which is
  // where these sit.
  //
  // This does NOT break the rule that an unlit surface must never come out
  // brighter than the city around it — the rule is about UNLIT things. A
  // floodlit stadium genuinely is one of the brightest objects in a night city,
  // and the void bands stay dark on purpose so the bowl still reads as a bowl
  // rather than as one orange blob.
  const SEAT_COL = {
    lower:     ['#9aacc3', '#b0aea9', '#d87c34'],   // day / golden / night
    lowerB:    ['#8395ab', '#9c9a96', '#c26e2c'],
    mid:       ['#a1b2c8', '#b6b4af', '#e08438'],
    midB:      ['#899ab0', '#a2a09b', '#ca7530'],
    upper:     ['#a7bbd4', '#bcbab5', '#e88c3e'],
    upperB:    ['#8fa3ba', '#a8a6a1', '#d27a34'],
    stain:     ['#8b8d8d', '#9a9083', '#c07038'],   // measured: luma 122.9, R/B 1.32
    stainB:    ['#808282', '#8d8478', '#ac6430'],
    orange:    ['#91706b', '#a3785f', '#f09a48'],   // club chairbacks, most lit
    orangeB:   ['#82645f', '#946b55', '#d8883e'],
    void:      ['#41454f', '#3f3c36', '#2a1810'],   // the slot STAYS dark: it is
    concourse: ['#849aa7', '#9f9e9a', '#8a5228'],   // what gives the bowl shape
  };
  // The parapet ring reads as the top of the bowl from every angle. Reusing the
  // building's baked roof colour (#756f66) put a wide chocolate-brown band right
  // around the rim; the real one is the same pale concrete as the structure.
  const RIM_COL = ['#b4b7bb', '#c1bcb2', '#191c25'];
  window.SEAT_COL = SEAT_COL;
  const hx3 = h => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
  // Same day→golden→night ramp every other colour in the scene uses.
  const rampAt = (trio, p) => {
    const t = p <= 0.5 ? p / 0.5 : (p - 0.5) / 0.5;
    const A = hx3(trio[p <= 0.5 ? 0 : 1]), B = hx3(trio[p <= 0.5 ? 1 : 2]);
    return '#' + [0,1,2].map(i =>
      Math.round(A[i] + (B[i]-A[i])*t).toString(16).padStart(2,'0')).join('');
  };
  const seatColourAt = p => {
    const e = ['match', ['get', 's']];
    for (const k of Object.keys(SEAT_COL)) e.push(k, rampAt(SEAT_COL[k], p));
    e.push(rampAt(SEAT_COL.lower, p));
    return e;
  };
  // Everything that is not wall or seating — turf, yard paint, the video board,
  // the Longhorn balcony, the ramp towers, the light masts, the aisle stairs —
  // is seven different materials that must all ride the same day ramp as the
  // rest of the scene. Rather than seven layers, the bake writes a day/golden/
  // night trio onto each feature and this blends between two of them. The input
  // to `interpolate` is a plain number, which is a legal expression: it just
  // evaluates the blend once per feature instead of per zoom level.
  const detailColourAt = p => (p <= 0.5
    ? ['interpolate', ['linear'], p / 0.5, 0, ['get', 'cd'], 1, ['get', 'cg']]
    : ['interpolate', ['linear'], (p - 0.5) / 0.5, 0, ['get', 'cg'], 1, ['get', 'cn']]);
  const DETAIL_KINDS = ['board', 'logo', 'ramp', 'mast', 'aisle'];

  /**
   * The midfield Longhorn, drawn once into a canvas and registered as an image.
   *
   * It cannot be geometry. The real mark is about 15 m across, which is thirty
   * pixels from the flying camera, and an alphabet or a silhouette built from
   * polygons would be a hundred features to fill thirty pixels. A map-aligned
   * symbol lies flat on the turf exactly the way paint does, costs one icon, and
   * stays legible because MapLibre scales it per zoom rather than per metre.
   */
  // The Longhorn silhouette, as supplied by Simeon. My own attempt at drawing
  // one from proportions came out looking like a beetle — short stubby horns on
  // an oversized head — and a real longhorn mark is overwhelmingly HORN: nearly
  // two to one across, with a small head low between the roots.
  //
  // Kept as SVG path data and filled through Path2D rather than loaded as an
  // <img>, because Path2D is SYNCHRONOUS. An image would have to decode before
  // map.addImage could take it, which means either an async hole in the layer
  // setup or a frame where the field has no mark on it.
  const LONGHORN_PATH = 'M0 0c-9.484 2.578-20.969 0.665-30.204-2.164-17.64-5.659-32.6'
    + '99-17.641-49.091-26.211-8.655-3.661-20.555-4.41-28.542 0.583-1.913 1.358-5.38 0'
    + '.388-5.38 0.388-1.109 0.831-2.352 1.148-3.856 0.611-3.994-2.914-8.155 1.58-12.3'
    + '96-0.75-4.242 2.33-8.402-2.164-12.396 0.75-1.505 0.537-2.747 0.22-3.856-0.611 0'
    + ' 0-3.469 0.97-5.382-0.388-7.986-4.993-19.885-4.244-28.539-0.583-16.394 8.57-31.'
    + '452 20.552-49.092 26.211-9.236 2.829-20.72 4.742-30.205 2.164-1.248-0.832-2.664'
    + '-2.331-2.331-4.161 0.666-1.082 1.333-2.58 2.747-2.83 33.95 5.076 52.254-28.623 '
    + '80.712-37.526 0.055-0.361-1.609-1.747-3.413-2.718-4.021-2.22-9.985-1.359-10.4-6'
    + '.851 1.081-3.413 5.241-4.661 8.237-5.991 7.073-3.997 15.562-0.668 21.967 2.578 '
    + '0.748 0.75 1.997 0.334 2.578-0.416-0.499-15.395 11.234-25.63 13.397-39.941 1.24'
    + '9-6.657-2.912-11.564-3.411-17.806-0.055-2.303 1.747-0.778 2.718-8.404 0.417-1.3'
    + '87 3.884-5.271 7.018-6.906 2.893-1.14 6.246-1.472 9.651-1.383 3.404-0.089 6.757'
    + ' 0.243 9.65 1.383 3.134 1.635 6.602 5.519 7.015 6.906 0.974 7.626 2.776 6.101 2'
    + '.721 8.404-0.5 6.242-4.66 11.149-3.412 17.806 2.164 14.311 13.896 24.546 13.396'
    + ' 39.941 0.584 0.75 1.833 1.166 2.581 0.416 6.405-3.246 14.892-6.575 21.967-2.57'
    + '8 2.995 1.33 7.155 2.578 8.237 5.991-0.417 5.492-6.381 4.631-10.4 6.851-1.805 0'
    + '.971-3.469 2.357-3.415 2.718 28.459 8.903 46.765 42.602 80.714 37.526 1.414 0.2'
    + '5 2.08 1.748 2.744 2.83 0.323 1.828-1.09 3.327-2.338 4.159';
  const LONGHORN_VB = [331.62189, 168.97772];   // the source viewBox

  function longhornImage() {
    const W = 512, H = Math.round(W * LONGHORN_VB[1] / LONGHORN_VB[0]);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d');
    x.fillStyle = '#bf5700';                 // UT burnt orange, the official hex
    x.scale(W / LONGHORN_VB[0], H / LONGHORN_VB[1]);
    // The two <g> transforms off the source SVG, in order. The outer one flips
    // Y, which is why the mark would be upside down without it.
    x.transform(1.25, 0, 0, -1.25, -390.11, 305.09);
    x.translate(574.03, 241.88);
    x.fill(new Path2D(LONGHORN_PATH));
    return x.getImageData(0, 0, W, H);
  }

  /**
   * The whole field as ONE image, registered to its four real corners.
   *
   * Why an image and not layers of geometry plus a symbol layer, which is what
   * this was: MapLibre `symbol` layers DO NOT DEPTH-TEST AGAINST FILL
   * EXTRUSIONS. They are composited over the finished frame, so TEXAS and the
   * midfield Longhorn were legible through 63 m of grandstand from outside the
   * stadium. There is no symbol-layer setting that fixes it — not
   * pitch-alignment, not sort key, not placement. The only fix is to stop being
   * a symbol. A raster on the ground plane is ordinary ground: the walls are
   * drawn after it and paint over it exactly as they do over the streets.
   *
   * Fill-extrusion-pattern would not have worked either — it is locked to the
   * tile, so one field image would repeat rather than land once on the field.
   * An `image` source takes explicit corner coordinates, which is precisely the
   * "put this picture exactly there" primitive this needs.
   *
   * Canvas is portrait with NORTH AT THE TOP, matching the corner order the bake
   * emits (NW, NE, SE, SW).
   */
  const FIELD_L = 109.73, FIELD_W = 48.77, ENDZONE = 9.14;
  function fieldImage() {
    const H = 1400, W = Math.round(H * FIELD_W / FIELD_L);
    const S = H / FIELD_L;                       // px per metre
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d');
    const m = v => v * S;

    x.fillStyle = '#3f6b3a';                     // FieldTurf, post-2021 dark green
    x.fillRect(0, 0, W, H);
    // Mow stripes run ACROSS the field, in bands the width of five yards, which
    // is why a real field looks banded from the air rather than flat green.
    x.fillStyle = 'rgba(255,255,255,.045)';
    for (let i = 0; i < 24; i += 2) x.fillRect(0, m(ENDZONE + i * 4.572), W, m(4.572));

    // End zones. Burnt orange since the 2021 turf, which also darkened the green.
    x.fillStyle = '#bf5700';
    x.fillRect(0, 0, W, m(ENDZONE));
    x.fillRect(0, H - m(ENDZONE), W, m(ENDZONE));
    // The orange border runs only to the 20-yard lines — NOT around the whole
    // field. That is the specific thing the 2021 repaint changed and it is
    // visible in the aerial.
    const b = m(1.5), to20 = m(ENDZONE + 18.29);
    for (const [y0, y1] of [[0, to20], [H - to20, H]]) {
      x.fillRect(0, y0, b, y1 - y0);
      x.fillRect(W - b, y0, b, y1 - y0);
    }

    // Yard lines every 5 yd, goal line to goal line.
    x.fillStyle = '#f0ece4';
    for (let i = 0; i <= 20; i++) x.fillRect(0, m(ENDZONE + i * 4.572) - 1, W, 2.5);
    x.fillRect(0, m(ENDZONE) - 1, W, 4);                      // goal lines, heavier
    x.fillRect(0, H - m(ENDZONE) - 3, W, 4);
    // College hash marks sit 20 yd in from each sideline, one per yard.
    const hx = [m(18.29), W - m(18.29)];
    for (let yd = 1; yd < 100; yd++) {
      const y = m(ENDZONE + yd * 0.9144);
      for (const h of hx) x.fillRect(h - m(0.3), y - 1, m(0.6), 2);
    }

    // Yard numbers, facing the nearer sideline the way they are painted.
    x.font = '900 ' + Math.round(m(1.6)) + 'px "Arial Black",Arial,sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    for (let i = 1; i <= 9; i++) {
      const n = String(i <= 5 ? i * 10 : (10 - i) * 10);
      const y = m(ENDZONE + i * 9.144);
      for (const [px_, rot] of [[m(7.5), Math.PI / 2], [W - m(7.5), -Math.PI / 2]]) {
        x.save(); x.translate(px_, y); x.rotate(rot);
        x.fillText(n, 0, 0); x.restore();
      }
    }

    // End zone lettering. Each word is condensed to the width available, which
    // is how a real field fits LONGHORNS and TEXAS at the same cap height.
    const word = (w, cy, flip) => {
      x.save(); x.translate(W / 2, cy); if (flip) x.rotate(Math.PI);
      x.font = '900 ' + Math.round(m(5.4)) + 'px "Arial Black",Arial,sans-serif';
      const t = w.split('').join(' ');
      x.scale(Math.min(1.6, (W - m(3)) / (x.measureText(t).width || 1)), 1);
      x.fillStyle = '#f4f1ea';
      x.fillText(t, 0, 0);
      x.restore();
    };
    word('TEXAS', m(ENDZONE / 2), false);
    word('LONGHORNS', H - m(ENDZONE / 2), true);

    // Midfield Longhorn, ~15 m across, from Simeon's SVG.
    x.save();
    const lw = m(15), lh = lw * LONGHORN_VB[1] / LONGHORN_VB[0];
    x.translate(W / 2 - lw / 2, H / 2 - lh / 2);
    x.scale(lw / LONGHORN_VB[0], lh / LONGHORN_VB[1]);
    x.transform(1.25, 0, 0, -1.25, -390.11, 305.09);
    x.translate(574.03, 241.88);
    x.fillStyle = '#bf5700';
    x.fill(new Path2D(LONGHORN_PATH));
    x.restore();
    return c.toDataURL('image/png');
  }


  window.addStadiumLayers = function addStadiumLayers() {
    if (map.getSource('austin-stadium')) return;
    // Fetched rather than handed to addSource as a URL because the same
    // document carries `replacedBuildingIds`, and the buildings layers have to
    // stop drawing those before the wall can be seen. One request, both uses.
    fetch('data/stadium.geojson').then(r => r.json()).then(gj => {
      if (map.getSource('austin-stadium')) return;
      // Stamp the facade pattern BEFORE addSource. MapLibre serialises GeoJSON
      // to its worker on addSource, so a later mutation of the same objects
      // never reaches the tiles — the walls would render with no pattern.
      if (typeof window.quantiseStadiumFacades === 'function') {
        window.quantiseStadiumFacades(map, gj.features);
      }
      // maxzoom 15 IS THE FIX FOR THE GIANT BLOCK OVER THE BOWL, and it is not
      // a performance knob. Every seat band is a ring WITH A HOLE — the field.
      // MapLibre tiles GeoJSON with geojson-vt, which clips each ring to each
      // tile independently, and a tile that falls ENTIRELY INSIDE the hole gets
      // a full-tile outer ring and a full-tile inner ring with the same winding.
      // The hole is lost and that tile fills solid. The field hole is 68 x 123 m,
      // so this cannot happen until tiles are smaller than that: at the default
      // maxzoom 18 a tile is ~150 m and the bowl fills with a flat lid the
      // moment you fly close, which is exactly the reported symptom.
      //
      // Capped at 15, one tile is ~1.2 km, far larger than the hole, so no tile
      // can ever sit inside it; every closer view over-zooms that same intact
      // geometry. Precision at 15 is 1200/4096 = 0.3 m, finer than the 0.74 m
      // seat rows, so nothing visible is lost.
      map.addSource('austin-stadium', {
        type:'geojson', data: gj, maxzoom: 15, tolerance: 0.25, buffer: 128,
      });
      // This runs after a fetch, so the label layers may already exist. Without
      // an anchor these extrusions would be appended above them and swallow
      // every label behind the stadium.
      //
      // The anchor must be the first symbol layer AFTER our buildings, not the
      // first in the style: the basemap puts symbol layers right after
      // `background`, and anchoring there dropped the whole stadium to the
      // BOTTOM of the stack, under `ground-areas` and `buildings-shadow`. It
      // still rendered — as tiers, in roughly the right shape — just repainted
      // by the ground fill on top of it, which measured as a deck at luma 99
      // where the aerial says it should be the brightest surface in the frame.
      const stack = map.getStyle().layers;
      const after = Math.max(0, stack.findIndex(l => l.id === 'buildings-3d'));
      const anchor = (stack.slice(after + 1).find(l => l.type === 'symbol') || {}).id;

      const gone = gj.replacedBuildingIds || [];
      if (gone.length) {
        const notReplaced = ['!', ['in', ['get','id'], ['literal', gone]]];
        for (const id of ['buildings-3d', 'buildings-roof']) {
          if (!map.getLayer(id)) continue;
          const f = map.getFilter(id);
          try { map.setFilter(id, f ? ['all', f, notReplaced] : notReplaced); } catch (e) {}
        }
      }

      // THE FIELD, before anything else, so every stadium layer added after it
      // draws on top and hides it exactly the way the real grandstand does.
      // This replaced a symbol layer that rendered TEXAS and the Longhorn
      // straight through the building from outside.
      if (gj.fieldCorners && !map.getSource('austin-field')) {
        map.addSource('austin-field', {
          type: 'image', url: fieldImage(), coordinates: gj.fieldCorners,
        });
        map.addLayer({
          id:'stadium-field', type:'raster', source:'austin-field', minzoom:14,
          paint:{ 'raster-opacity':1, 'raster-fade-duration':0,
                  'raster-resampling':'linear' },
        }, anchor);
      }

      // The perimeter wall. Same facade paint as every other building, so it
      // picks up the `st` tile, the day/night atlas and the vertical gradient
      // without a second code path.
      if (!map.getLayer('stadium-wall')) {
        map.addLayer({
          id:'stadium-wall', type:'fill-extrusion', source:'austin-stadium', minzoom:14,
          filter:['==', ['get','kind'], 'wall'],
          paint: Object.assign(facadePaint(['get','h'], ['get','base']), {
            // OFF, unlike every other building. The gradient darkens the bottom
            // of an extrusion, and these are three stacked extrusions per side —
            // so it restarted at each band boundary and put a dark line under
            // all three. On the 9.4 m plinth the whole band fell inside the
            // gradient and the arcade rendered as a row of black teeth. The
            // band tones already carry the vertical hierarchy.
            'fill-extrusion-vertical-gradient': false,
          }),
        }, anchor);
      }
      // ... and its parapet cap, matching the rule every other roof follows.
      if (!map.getLayer('stadium-wall-roof')) {
        map.addLayer({
          id:'stadium-wall-roof', type:'fill-extrusion', source:'austin-stadium', minzoom:14,
          // Only the topmost band gets a parapet. Capping every band would put a
          // lip at 10.7 m and 37.8 m as well — three ledges up a blank wall.
          filter:['all', ['==', ['get','kind'], 'wall'], ['==', ['get','band'], 'fascia']],
          paint:{
            'fill-extrusion-color': rampAt(RIM_COL, window.__todCurrentP != null ? window.__todCurrentP : 0.5),
            'fill-extrusion-height':capHeight(['get','h']),
            'fill-extrusion-base':capBase(['get','h']),
            'fill-extrusion-opacity':1.0,
          },
        }, anchor);
      }
      if (!map.getLayer('stadium-seating')) {
        map.addLayer({
          id:'stadium-seating', type:'fill-extrusion', source:'austin-stadium', minzoom:14,
          filter:['==', ['get','kind'], 'seat'],
          paint:{
            'fill-extrusion-color': seatColourAt(window.__todCurrentP != null ? window.__todCurrentP : 0.5),
            'fill-extrusion-height':['get','h'],
            'fill-extrusion-base':0,
            'fill-extrusion-opacity':1.0,
            'fill-extrusion-vertical-gradient':true,
          },
        }, anchor);
      }
      // Turf, yard paint, the video board, the Longhorn balcony, the ramp
      // towers, the light masts and the aisle stairs — one layer, seven
      // materials, colour carried per feature. The vertical gradient is off:
      // these are stacked on and around the seating, and a gradient that
      // restarts per extrusion would put a dark line under every one of them.
      if (!map.getLayer('stadium-detail')) {
        map.addLayer({
          id:'stadium-detail', type:'fill-extrusion', source:'austin-stadium', minzoom:14,
          filter:['in', ['get','kind'], ['literal', DETAIL_KINDS]],
          paint:{
            'fill-extrusion-color': detailColourAt(window.__todCurrentP != null ? window.__todCurrentP : 0.5),
            'fill-extrusion-height':['get','h'],
            'fill-extrusion-base':['coalesce', ['get','base'], 0],
            'fill-extrusion-opacity':1.0,
            'fill-extrusion-vertical-gradient':false,
          },
        }, anchor);
      }
    }).catch(() => {});
  };
  window.applyStadiumColors = function applyStadiumColors(p) {
    if (!map || !map.getLayer || !map.getLayer('stadium-seating')) return;
    try { map.setPaintProperty('stadium-seating', 'fill-extrusion-color', seatColourAt(p)); } catch (e) {}
    try { map.setPaintProperty('stadium-wall-roof', 'fill-extrusion-color', rampAt(RIM_COL, p)); } catch (e) {}
    try { map.setPaintProperty('stadium-detail', 'fill-extrusion-color', detailColourAt(p)); } catch (e) {}
    // The field image is a photograph of paint, not a material, so it rides
    // the day ramp as exposure rather than as colour. Floodlit at night, so
    // it dims far less than the unlit structure around it.
    try {
      const night = Math.max(0, (p - 0.62) / 0.38);
      map.setPaintProperty('stadium-field', 'raster-brightness-max', 1 - 0.42 * night);
      map.setPaintProperty('stadium-field', 'raster-saturation', -0.10 * night);
    } catch (e) {}
  };

  // ── Detail layers: OSM building parts, trees, pitches, fountains ──
  function addDetailLayers(sc) {
    if (!map.getSource('austin-parts')) {
      map.addSource('austin-parts', { type:'geojson', data: sc.parts, ...window.PATTERN_TILING });
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
          'fill-extrusion-height':capHeight(['get','h']),
          'fill-extrusion-base':capBase(['get','h']),
          'fill-extrusion-opacity':1.0,
        },
      });
    }

    if (!map.getSource('austin-trees')) {
      map.addSource('austin-trees', { type:'geojson', data:'data/trees.geojson' });
    }
    // Tree DENSITY is a parameter, not a cull. Every tree carries `d`, a
    // keep-order in 0..1 biased so that thinning drops the small trees first
    // and keeps the big live oaks — which are what you actually see from 60 m.
    // Measured at 1440x900: the full set costs ~6-7 fps against trees-off, and
    // the trees are the cost (the ground fills are within noise). So the knob
    // exists and the presets set it; nothing is silently dropped.
    if (!map.getLayer('trees-trunk')) {
      map.addLayer({
        id:'trees-trunk', type:'fill-extrusion', source:'austin-trees',
        minzoom:14, filter:window.treeFilter('trunk'),
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
        minzoom:14, filter:window.treeFilter('canopy'),
        paint:{
          'fill-extrusion-color':['interpolate',['linear'],['get','h'],6,'#93ad70',15,'#5f7d4a'],
          'fill-extrusion-height':['get','h'],
          'fill-extrusion-base':['get','base'],
          'fill-extrusion-opacity':1.0,
          'fill-extrusion-vertical-gradient':true,
        },
      });
    }

    // NOTE: the old `austin-landscape` pitch/fountain layers are GONE.
    // data/ground.geojson now carries every pitch (101 of them) and fountain
    // with a real surface class, and it drew them correctly — but
    // landscape-pitch sat ABOVE ground-areas in the style and repainted each
    // one flat green, which is what was burying DKR's burnt-orange end zones.
    // One source for the ground, not two.
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
      // Held back until you descend BELOW the spawn zoom (16.5): at spawn the
      // curated signs carry the identity, and the old 16.4 start meant dozens
      // of 10–40%-opacity ghost labels smudging the hero frame.
      minzoom:16.7, filter:['==',['get','lbl'],1],
      layout:{
        'text-field':['get','name'],
        // Only Noto Sans Regular/Bold/Italic exist on OpenFreeMap's glyph
        // server — a missing fontstack 404s and MapLibre discards the whole
        // tile it was needed for.
        'text-font':['Noto Sans Regular'],
        'text-size':['interpolate',['linear'],['zoom'],16.7,10,18,12,19.5,14],
        'text-anchor':'center', 'text-offset':[0,-0.6],
        'text-max-width':7, 'text-padding':9,
        'text-allow-overlap':false,
        'symbol-sort-key':['-', 0, ['get','final_height']],
      },
      paint:{
        'text-color':'#f3e6cd','text-halo-color':'rgba(24,14,5,0.9)','text-halo-width':1.3,
        'text-opacity':['interpolate',['linear'],['zoom'],16.8,0,17.5,0.82],
      },
    });
  }

  // ── Cinematic intro ───────────────────────────────────────────────
  // A real journey now, not a dolly around a fixed centre: the flight starts
  // low over campus ~430 m east of the spawn, runs west down the 24th Street
  // canyon with the towers rising past the frame edges, then sweeps into the
  // spawn pose facing the sunset. Any input cancels it immediately.
  // Every value here is a one-line taste edit.
  const INTRO = {
    startEastM: 430,                     // where the flight begins, m east of spawn
    midEastM: 80,                        // leg-1 endpoint, m east of spawn
    startZoom: 17.25, midZoom: 16.85,    // low over the street → rising
    startPitch: 70,   midPitch: 72,      // street-focused → lifting the eyes
    startBearing: 274, midBearing: 266,  // near-west the whole run…
    leg1Ms: 6200, leg2Ms: 5200,          // …then the arrival settle onto SPAWN
    maxVeilMs: 7000,                     // a stalled tile must never hold a black screen
  };

  // The veil (see index.html/#veil) holds an authored dark frame over the
  // basemap's pale first paint. The intro start pose is primed UNDER the veil,
  // so the tiles it needs are loading before anything is visible; on the first
  // idle frame (or the timeout) the veil lifts and the flight departs — the
  // first thing a visitor ever sees is the city already golden and in motion.
  function revealAndIntro() {
    const q = new URLSearchParams(window.location.search);
    const doTour = q.get('tour') === '1';           // ?tour=1 replaces the intro
    const doIntro = !doTour && q.get('intro') !== '0';
    const flight = doIntro ? primeIntro() : null;
    let revealed = false;
    const reveal = () => {
      if (revealed) return;
      revealed = true;
      // Fill the skyline before the veil goes, so the last thing seen is the
      // city fully lit rather than a bar stranded at 80%.
      try { if (window.loaderDone) window.loaderDone(); } catch (e) {}
      const veil = document.getElementById('veil');
      if (veil) {
        veil.classList.add('lift');
        veil.addEventListener('transitionend', () => veil.remove(), { once: true });
        setTimeout(() => { const v = document.getElementById('veil'); if (v) v.remove(); }, 2600);
      }
      if (flight) flight.fly();
      else if (doTour) startTour();
    };
    map.once('idle', reveal);
    setTimeout(reveal, INTRO.maxVeilMs);
  }

  function primeIntro() {
    let cancelled = false, leg2Timer = null;
    const cancel = () => {
      if (cancelled) return;
      cancelled = true;
      clearTimeout(leg2Timer);
      map.stop();
      // Land on the full spawn pose. Stopping mid-ease used to strand the
      // camera at whatever partial zoom/pitch the tween had reached.
      map.jumpTo({ center: SPAWN.center, zoom: SPAWN.zoom, pitch: SPAWN.pitch, bearing: SPAWN.bearing });
      off();
    };
    const evts = ['mousedown','wheel','keydown','touchstart'];
    const off = () => evts.forEach(e => window.removeEventListener(e, cancel, true));
    evts.forEach(e => window.addEventListener(e, cancel, true));

    const eastOf = m => [
      SPAWN.center[0] + m / (111195.08 * Math.cos(SPAWN.center[1] * Math.PI / 180)),
      SPAWN.center[1],
    ];
    map.jumpTo({ center: eastOf(INTRO.startEastM), zoom: INTRO.startZoom,
                 pitch: INTRO.startPitch, bearing: INTRO.startBearing });

    const fly = () => {
      if (cancelled) return;
      map.easeTo({ center: eastOf(INTRO.midEastM), zoom: INTRO.midZoom,
                   pitch: INTRO.midPitch, bearing: INTRO.midBearing,
                   duration: INTRO.leg1Ms,
                   easing: t => 0.5 - 0.5 * Math.cos(Math.PI * t) });  // gentle both ends
      leg2Timer = setTimeout(() => {
        if (cancelled) return;
        map.easeTo({ center: SPAWN.center, zoom: SPAWN.zoom, pitch: SPAWN.pitch, bearing: SPAWN.bearing,
                     duration: INTRO.leg2Ms,
                     easing: t => 1 - Math.pow(1 - t, 3) });           // long settle
        setTimeout(off, INTRO.leg2Ms + 600);
      }, INTRO.leg1Ms + 30);
    };
    return { fly };
  }

  // ── Idle cinema ───────────────────────────────────────────────────
  // After DRIFT.idleMs of input silence the camera begins a slow orbital
  // drift and the hour creeps forward — an unattended screen becomes a
  // screensaver of the city instead of a frozen frame. Any input (or any
  // camera movement that isn't ours) returns control instantly.
  // ?drift=0 disables it for scripted runs against index.html.
  const DRIFT = {
    idleMs: 25000,      // input silence before the drift starts
    stepMs: 12000,      // one easing leg
    bearingStep: 13,    // degrees per leg, clockwise toward the sun's set point
    pStep: 0.010,       // hour creep per leg (bounces at 0 and 1)
    zoomBreathe: 0.05,  // gentle alternating zoom in/out per leg
  };
  function initIdleCinema() {
    if (new URLSearchParams(window.location.search).get('drift') === '0') return;
    let idleTimer = null, legTimer = null, drifting = false, legIx = 0, pDir = 1;
    const banner = document.getElementById('diff-banner');
    const canRun = () => document.visibilityState === 'visible' &&
                         (!banner || banner.classList.contains('hidden')) &&
                         !(window.__fly && window.__fly.eye().driving) &&
                         !(map.isEasing && map.isEasing());
    const stop = () => {
      if (drifting && map.isEasing && map.isEasing()) map.stop();
      drifting = false;
      clearTimeout(legTimer);
    };
    const rearm = () => { stop(); clearTimeout(idleTimer); idleTimer = setTimeout(begin, DRIFT.idleMs); };
    const begin = () => {
      if (!canRun()) { clearTimeout(idleTimer); idleTimer = setTimeout(begin, DRIFT.idleMs); return; }
      drifting = true;
      legIx = 0;
      leg();
    };
    const leg = () => {
      if (!drifting) return;
      // The hour creeps unless the auto day-cycle is already driving it.
      const play = document.getElementById('tod-play');
      if (!(play && play.classList.contains('playing'))) {
        let p = (window.__todCurrentP != null ? window.__todCurrentP : DEFAULT_P) + pDir * DRIFT.pStep;
        if (p >= 1) { p = 1; pDir = -1; } else if (p <= 0) { p = 0; pDir = 1; }
        const sl = document.getElementById('tod-slider');
        if (sl) sl.value = String(p);
        applyTimeOfDay(map, p);
      }
      legIx++;
      map.easeTo({
        bearing: map.getBearing() - DRIFT.bearingStep,
        zoom: map.getZoom() + (legIx % 2 ? DRIFT.zoomBreathe : -DRIFT.zoomBreathe),
        duration: DRIFT.stepMs,
        easing: t => t,                       // linear: constant, calm
      }, { drift: true });
      legTimer = setTimeout(leg, DRIFT.stepMs + 60);
    };
    // Camera movement that is NOT drift-tagged re-arms the countdown; our own
    // legs are tagged so the drift cannot reset itself.
    map.on('movestart', e => { if (!e || !e.drift) rearm(); });
    ['pointerdown', 'wheel', 'keydown', 'touchstart'].forEach(t =>
      window.addEventListener(t, rearm, { capture: true, passive: true }));
    rearm();
  }

  // ── Landmark orbit ────────────────────────────────────────────────
  // Tap a landmark sign and the camera glides to that building and slowly
  // circles it. Any input hands control straight back. A tap is a press under
  // ORBIT.tapMs that moved less than ORBIT.tapPx — everything else is a look
  // swipe and never reaches here.
  const ORBIT = {
    zoom: 17.1, pitch: 73,      // the framing the approach settles on
    approachMs: 2400,           // glide to the landmark
    legMs: 9000, bearingStep: 40,  // one slow circling leg (linear, chained)
    tapMs: 350, tapPx: 9, hitPad: 14,
  };
  function initLandmarkOrbit() {
    const canvas = map.getCanvas();
    let downAt = 0, downX = 0, downY = 0;
    let orbiting = false, legTimer = null;
    const stop = () => {
      if (!orbiting) return;
      orbiting = false;
      clearTimeout(legTimer);
      if (map.isEasing && map.isEasing()) map.stop();
    };
    canvas.addEventListener('pointerdown', e => {
      downAt = performance.now(); downX = e.clientX; downY = e.clientY;
      stop();                              // touching the world during an orbit ends it
    });
    canvas.addEventListener('pointerup', e => {
      if (performance.now() - downAt > ORBIT.tapMs) return;
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > ORBIT.tapPx) return;
      let hits = [];
      try {
        const p = ORBIT.hitPad;
        // Only RENDERED labels can be hit — which is the correct contract: you
        // tap a sign you can see. (A not-yet-rendered label is not tappable.)
        hits = map.queryRenderedFeatures(
          [[e.clientX - p, e.clientY - p], [e.clientX + p, e.clientY + p]],
          { layers: ['signs-label'] });
      } catch (err) { return; }
      const f = hits && hits[0];
      if (!f || !f.geometry || f.geometry.type !== 'Point') return;
      const target = f.geometry.coordinates.slice(0, 2);
      orbiting = true;
      map.easeTo({ center: target, zoom: ORBIT.zoom, pitch: ORBIT.pitch,
                   duration: ORBIT.approachMs }, { orbit: true });
      const leg = () => {
        if (!orbiting) return;
        map.easeTo({ bearing: map.getBearing() + ORBIT.bearingStep,
                     duration: ORBIT.legMs, easing: t => t }, { orbit: true });
        legTimer = setTimeout(leg, ORBIT.legMs + 50);
      };
      legTimer = setTimeout(leg, ORBIT.approachMs + 60);
    });
    window.addEventListener('wheel', stop, { capture: true, passive: true });
    window.addEventListener('keydown', stop, true);
  }

  // ── The Forty Acres tour ──────────────────────────────────────────
  // A pre-authored tracking shot through the campus landmarks: down the Drag,
  // up the South Mall to the Tower, a quarter-orbit, across to DKR, and a long
  // settle back into the sunset. T starts it (and ?tour=1 starts it in place
  // of the intro — ?clip=1&tour=1 is a pure footage run). Any input ends it
  // where it is. Every waypoint is a one-line taste edit.
  const TOUR = [
    // [center,                zoom,  pitch, bearing, ms]
    // Every hero arrival is followed by a short push-in dwell, so the postcard
    // is HELD on screen instead of existing for a single frame between legs.
    [[-97.7414, 30.2838],      16.6,  73,    160,     8000],   // south down the Drag
    [[-97.7394, 30.2841],      16.95, 75,    5,       7500],   // arrive: South Mall, Tower ahead
    [[-97.73935, 30.2848],     17.1,  74.5,  5,       4000],   // dwell: push in on the Tower
    [[-97.73932, 30.28601],    17.0,  73,    62,      8000],   // quarter-orbit the Tower
    [[-97.7335, 30.2839],      16.5,  71,    95,      9000],   // glide to DKR
    [[-97.7333, 30.28396],     16.62, 71.5,  95,      3500],   // dwell: push in on DKR
    [[SPAWN.center[0], SPAWN.center[1]], SPAWN.zoom, SPAWN.pitch, SPAWN.bearing, 10500], // home into the sunset
  ];
  let _tourStop = null;
  function startTour() {
    if (_tourStop) _tourStop();
    let cancelled = false, timer = null;
    const evts = ['pointerdown', 'wheel', 'keydown', 'touchstart'];
    const stop = () => {
      if (cancelled) return;
      cancelled = true;
      clearTimeout(timer);
      if (map.isEasing && map.isEasing()) map.stop();
      evts.forEach(t => window.removeEventListener(t, stop, true));
      _tourStop = null;
    };
    _tourStop = stop;
    // Deferred a tick so the T keydown that started us doesn't also stop us.
    setTimeout(() => { if (!cancelled) evts.forEach(t => window.addEventListener(t, stop, true)); }, 80);
    let i = 0;
    const leg = () => {
      if (cancelled || i >= TOUR.length) { if (!cancelled) stop(); return; }
      const [center, zoom, pitch, bearing, ms] = TOUR[i++];
      map.easeTo({ center, zoom, pitch, bearing, duration: ms,
                   easing: t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2 },  // ease-in-out
                 { tour: true });
      timer = setTimeout(leg, ms + 80);
    };
    leg();
  }
  function initTourKey() {
    window.addEventListener('keydown', e => {
      if (e.code !== 'KeyT' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t && (/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(t.tagName) || t.isContentEditable)) return;
      startTour();
    });
  }
  window.__startTour = startTour;   // for scripted verification

  // ── Photo mode ────────────────────────────────────────────────────
  // P toggles the same chrome-free view as ?clip=1 — for lining up a shot
  // live without reloading. Ignored while a form control has focus.
  function initPhotoKey() {
    window.addEventListener('keydown', e => {
      if (e.code !== 'KeyP' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t && (/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(t.tagName) || t.isContentEditable)) return;
      document.documentElement.classList.toggle('clip');
    });
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
