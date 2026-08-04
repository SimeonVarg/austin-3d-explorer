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

  // ── Which buildings get named, and how loudly ─────────────────────
  // TASTE, all of it. Every boundary here is a one-line edit, and none of it is
  // buried inside a draw call.
  //
  // The old rule was `final_height >= 12`, one flat gate, then three tiers split
  // on height alone. Measured on the 2026-08-02 snapshot that is 218 names, and
  // height ranked them badly: "State Parking Garage R" outranked the Harry
  // Ransom Center, and a chiller plant sat in the same tier as the PCL. BUILT
  // VOLUME (footprint x height) is the signal that ranks this campus the way a
  // person would — DKR, Bellmont, Union on 24th, Moody Center, Jester West at
  // the top; Chevron, Möge Tee, Chabad House at the bottom.
  const LABEL_RANK = {
    minHeight:   12,        // m — under this a building is never named at all
    landmarkVol: 130000,    // m³ of built volume …
    landmarkH:   55,        // … or this tall. Either one qualifies as a landmark.
    majorVol:    42000,
    majorH:      30,
    minorVol:    13000,     // below this: no label, at any zoom
    longName:    34,        // chars — a longer name costs one tier of distance
    // Plant, not place. Demoted TWO tiers, not one: at one tier a 196,000 m³
    // parking garage was still a landmark.
    utility: /\b(garage|parking|cooling tower|chilling|chiller|power plant|substation|annex|utility plant|storage|maintenance)\b/i,
  };

  /** Planar footprint area in m², good to a fraction of a percent at this latitude. */
  function footprintArea(g) {
    if (!g) return 0;
    const rings = g.type === 'Polygon' ? [g.coordinates[0]]
                : g.type === 'MultiPolygon' ? g.coordinates.map(p => p[0]) : [];
    let a = 0;
    for (const r of rings) {
      if (!r || r.length < 4) continue;
      let s = 0;
      for (let i = 0; i < r.length - 1; i++) s += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
      a += Math.abs(s) / 2;
    }
    const k = 111320 * Math.cos(30.285 * Math.PI / 180);
    return a * k * 111320;
  }

  /**
   * The name that gets DRAWN. `text-max-width` cannot rescue a 69-character
   * name: at 7 ems "O'Donnell Building for Applied Computational Engineering
   * and Sciences" became a five-line block that was the largest object in the
   * street frame and the least readable thing in it.
   *
   * Three rules, in order, each checked against every name in the snapshot
   * before any of this was drawn:
   *   1. drop a "Permanently CLOSED:" prefix and any parenthetical
   *   2. cut at " for " — but ONLY on names already over the length budget, so
   *      "Belo Center for New Media" (25 chars) survives whole and
   *      "O'Donnell Building for Applied…" (69) becomes "O'Donnell Building"
   *   3. drop a trailing "Building"/"Complex"/"Facility" when three words are
   *      left without it, so "Graduate School of Business Building" loses it
   *      and "KXAN Building" keeps it
   * It changes 36 of 218 names and leaves the rest alone.
   */
  function shortenLabel(n) {
    let s = String(n || '').replace(/^permanently closed:\s*/i, '').replace(/\s*\([^)]*\)/g, '').trim();
    if (s.length > 30) s = s.replace(/^(.+?\s+\S+)\s+for\s+.+$/i, '$1');
    const w = s.split(/\s+/);
    if (w.length >= 4 && /^(building|complex|facility)$/i.test(w[w.length - 1])) s = w.slice(0, -1).join(' ');
    return s;
  }

  // Taste, so the whole thing is one line to overrule: `false` puts every
  // parapet cap back on the building's terracotta roof colour. The colour
  // itself is not here on purpose — it is measured per building off nadir
  // imagery by bake_roofscape.py and carried through bake_roofs.py's `caps`
  // table, so there is no constant to tune. CAP_DECK_TINT in bake_roofs.py is
  // the knob if the coping should read lighter than the membrane it caps.
  // `?roofcaps=0` turns it off for one load, which is how the before/after in
  // scripts/verify/roof-ring.mjs is measured on ONE build rather than by
  // checking out an older one — three sessions share this working tree and
  // HANDOFF §32 records what a mid-pass `git checkout` costs.
  const ROOF_CAP = { on: !/[?&]roofcaps=0\b/.test(location.search) };
  window.ROOF_CAP = ROOF_CAP;

  async function loadScene(date) {
    const [buildings, parts, signs, extraNames, roofs] = await Promise.all([
      getJSON(snapshotUrlFor(date), { type:'FeatureCollection', features: [] }),
      getJSON(`data/snapshots/${date}/parts.detailed.geojson`, { type:'FeatureCollection', features: [] }),
      getJSON('data/signs.json', { type:'FeatureCollection', features: [] }),
      // Names recovered from the OSM cache by scripts/name_buildings.py for
      // buildings the snapshot has none for. A side file, not a snapshot edit:
      // a re-bake would silently wipe the latter.
      getJSON('data/building_names.json', {}),
      // The pitched roofs, fetched HERE rather than left to `addRoofLayers`'s
      // source URL, for one reason: it carries `caps`, and a cap colour has to
      // be on the building feature BEFORE `austin-buildings` is added or it
      // costs a full re-tile to change afterwards. It is the same single
      // request either way — addRoofLayers is handed this parsed object. It
      // runs inside the existing Promise.all, so it is not serialised in front
      // of anything; the snapshot beside it is larger and lands later.
      getJSON('data/roofs.geojson', { type:'FeatureCollection', features: [] }),
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
    const tierCount = [0, 0, 0, 0];
    for (const f of buildings.features) {
      const p = f.properties;
      if (!p.name && extraNames && extraNames[p.id]) p.name = extraNames[p.id];
      const name = p && p.name;
      if (!name || isDuplicate(name)) continue;
      const h = p.final_height || 0;
      if (h < LABEL_RANK.minHeight) continue;

      // The name that gets DRAWN, which is not always the name in the data.
      // `text-max-width` cannot rescue "O'Donnell Building for Applied
      // Computational Engineering and Sciences" — at 7 ems it became a five-line
      // block that was simultaneously the largest object on screen and the least
      // readable thing in the frame. Shortened here, once, so the rule is
      // inspectable rather than buried in a wrap setting.
      p.name = shortenLabel(name);

      // IMPORTANCE. Height alone was the old signal and it is not enough: it put
      // "Chilling Station No. 6" and the Perry-Castañeda Library in the same
      // tier, which is the "a parking garage and the UT Tower are the same size"
      // complaint. BUILT VOLUME (footprint x height) ranks this campus properly —
      // measured over the 2026-08-02 snapshot it puts DKR, Bellmont, Union on
      // 24th, Moody Center and Jester West at the top and Chevron, Möge Tee and
      // Chabad House at the bottom, which is the order a person would give.
      const a = footprintArea(f.geometry);
      const v = a * h;
      p.lv = Math.round(v);
      let t = (v >= LABEL_RANK.landmarkVol || h >= LABEL_RANK.landmarkH) ? 0
            : (v >= LABEL_RANK.majorVol   || h >= LABEL_RANK.majorH)    ? 1
            : (v >= LABEL_RANK.minorVol)                                 ? 2
            : 3;
      // A chiller plant is not a landmark however big it is. Two tiers, not one,
      // because at one tier "State Parking Garage R" (196,000 m³) still outranked
      // the Harry Ransom Center.
      if (LABEL_RANK.utility.test(p.name)) t = Math.min(3, t + 2);
      // A long name needs more screen, so it has to earn more zoom.
      if (p.name.length > LABEL_RANK.longName) t = Math.min(3, t + 1);
      tierCount[t]++;
      if (t > 2) continue;               // tier 3 is never drawn, at any zoom

      p.lbl = 1; p.lt = t; labelled++;
    }

    // ── A membrane roof does not get a terracotta parapet ──────────────
    //
    // `buildings-roof` is the parapet cap over every building's top face and it
    // is painted from the building's own `rd` — a terracotta roof colour. On a
    // building whose roof is grey membrane, bake_roofscape.py's deck sits 1.1 m
    // inside that cap, so the cap showed as a hard burnt-orange OUTLINE round a
    // pale grey deck, on hundreds of buildings, in every daytime frame. Proved
    // with the magenta-mask trick rather than by eye: at `day-tower-close`
    // `buildings-roof` owns 9,543 px at rgb(173,88,51) around
    // `roofscape-deck`'s 81,414 px at rgb(151,138,114)
    // (scripts/verify/roof-ring.mjs).
    //
    // scripts/bake_roofs.py joins each deck to its building offline and writes
    // {id: [rd, rg, rn]} — the DECK'S OWN VALUES, not a re-measurement, so the
    // two surfaces cannot disagree by a little instead of a lot. Applying it to
    // the feature rather than to the layer's paint is what makes it stick:
    // `js/timeofday.js` re-paints `buildings-roof` from `rd`/`rg`/`rn` at every
    // hour, so a paint expression set here would be overwritten on the first
    // move of the time slider, while the DATA is read by whatever it sets.
    // Buildings with a real tiled roof are excluded by the bake — their cap sits
    // under the eave of a hip and terracotta is right there.
    if (ROOF_CAP.on && roofs && roofs.caps) {
      let capped = 0;
      for (const f of buildings.features) {
        const c = roofs.caps[f.properties.id];
        if (!c) continue;
        f.properties.rd = c[0]; f.properties.rg = c[1]; f.properties.rn = c[2];
        capped++;
      }
      console.log('[roof caps]', capped, 'parapets took their deck colour of',
                  Object.keys(roofs.caps).length, 'in the table');
    }

    console.log('[scene]', buildings.features.length, 'buildings,',
                stats ? `${stats.buckets} colour buckets / ${stats.patterns} facade patterns,` : '',
                labelled, 'OSM labels kept of', (signs.features || []).length, 'signs');
    console.log('[labels] tiers  major', tierCount[0], '| mid', tierCount[1],
                '| minor', tierCount[2], '| dropped', tierCount[3]);
    return { buildings, parts, signs, roofs };
  }

  // ── Init ──────────────────────────────────────────────────────────
  async function init() {
    manifest = await loadManifest();
    // The "Data snapshot: 2026-08-01" line is gone from the HUD with the rest of
    // the feature. It sat in the top-centre of every single frame, which is dead
    // weight in a flyover and worse in footage anyone else is going to watch.
    const el = document.getElementById('hud-snapshot');
    if (manifest && manifest.latest) {
      activeDate = manifest.latest;
    } else {
      if (el) el.textContent = 'No snapshot found — run the data pipeline first';
    }

    map = new maplibregl.Map({
      container:'map', style:'https://tiles.openfreemap.org/styles/liberty',
      center:SPAWN.center, zoom:SPAWN.zoom, pitch:SPAWN.pitch, bearing:SPAWN.bearing,
      // 88, not 85: MapLibre 5.24's own hard ceiling is 90 (verified against the
      // running library, scripts/verify/pitch-probe.mjs) and the flycam's
      // eye->pose derivation goes singular there. See js/controls.js PITCH_MAX.
      maxPitch:88, scrollZoom:false, attributionControl:{ compact:true },
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
  // stage after it (a crash in one boot stage silently cost the whole scene
  // its sky, shadows and signage), and that failure mode is invisible on screen.
  function step(name, fn) {
    try { fn(); } catch (e) { console.error(`[buildScene] ${name} failed:`, e); }
    // These calls are the NAMED part of the load screen's progress. They are
    // only ~30% of it: measured, every stage fires inside 276 ms and the veil
    // does not lift for another seven seconds, so the rest of the rail rides
    // MapLibre's own per-source loading (window.loaderWatch, wired below). A
    // stage that throws still reports, because the user is waiting on the stage
    // AFTER it and a bar frozen at 40% is a worse lie than one that moves on.
    // js/loader.js ignores names it does not know.
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
    // The load screen's long tail is MapLibre tiling what buildScene() just
    // handed it. Subscribe before that work starts, not after.
    try { if (window.loaderWatch) window.loaderWatch(map); } catch (e) {}
    step('signs',    () => initSigns(map, scene && scene.signs));
    step('night',    () => { if (typeof initNight === 'function') initNight(map); });
    step('sky',      () => initSky(map));
    // After sky (renderFX is driven from updateSky) and after the layers exist,
    // because applyGraphics() toggles buildings-ao / buildings-shadow.
    step('graphics', () => initGraphics(map));
    step('basemap',  () => cleanupBasemap(map));
    step('controls', () => initControls(map, scene));
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

  // ── The DKR field used to need a camera gate. It does not any more. ──
  //
  // What stood here was a per-frame rule that faded the turf out by PITCH and
  // by how close the map CENTRE was to the field, because the turf painted
  // straight through 63 m of grandstand. It was tuned three times and the
  // report — "field is visible through north wall still there" — kept coming
  // back, because the premise underneath it was wrong.
  //
  // The premise, written in this file, was: "A raster on the ground plane is
  // ordinary ground: the walls are drawn after it and paint over it exactly as
  // they do over the streets." That is measurably false. `stadium-field` sat at
  // style index 145 and `stadium-wall` at 146 — the wall IS after it — and the
  // turf still painted on the outside face of the north wall
  // (scripts/verify/field-bleed.mjs, 3318 px at pitch 79, box 581,381-687,422;
  // the frame is in the PR). A `raster` layer does not share the depth buffer
  // the 3D pass writes, so being below a fill-extrusion in the stack buys
  // nothing. Symbols had already failed the same way, for the same reason.
  //
  // A fill-extrusion over the identical quad, tested side by side: invisible
  // from outside the north wall, fully visible and correctly cut by the near
  // rim from above. So the field is now GEOMETRY (see fieldFeatures below) and
  // the gate is gone. Nothing decides whether the turf "may" be drawn; the
  // grandstand occludes it because it is in front of it, which is also true
  // when half the field is behind the rim and no opacity number can express
  // that.
  //
  // DO NOT reintroduce a raster or a symbol here to get finer paint detail
  // back. Every version of that bleeds, and the bleed is what Simeon reports.

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
  // Exported so anything that tweens a building's height can restore the cap
  // rule rather than carrying its own copy of the literals — which is how the
  // geometry rule once lived in two files and silently diverged. Its original
  // consumer, the diff tour, was removed with the snapshot feature; the export
  // stays because the rule belongs in one place either way.
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

  // ── Taste block: how a crown is shaded ────────────────────────────
  //
  // Reported as *"every tree is a stack of flat discs"*, and it was. The paint
  // this replaces was
  // `interpolate ['get','h'] 6 -> canopyLo, 15 -> canopyHi`, which is wrong
  // three separate ways, all measured in scripts/shape_trees.py's own notes:
  //
  //   1. it ramps on the tier's TOP HEIGHT, a SIZE, so the two tiers of one
  //      small crown differ by a fraction of the ramp while two tiers of a big
  //      one differ by most of it — the gradient is a function of the tree, not
  //      of where you are in its crown;
  //   2. 34% of all tiers (8,489 below and 2,464 above, of 32,651) fall outside
  //      the 6..15 m window and clamp to one flat endpoint;
  //   3. it is INVERTED. `canopyHi` is the darker colour, so a taller tier — the
  //      top of the canopy, the part in the sun — is drawn DARKER than the
  //      shaded underside.
  //
  // `tf` fixes all three at once: it is the tier's own centre as a fraction of
  // its crown, 0 at the base and 1 at the top, baked per feature, so the ramp is
  // over crown POSITION and works identically on a one-tier sapling and a
  // five-tier live oak. `j` is a per-tree hue bucket, constant down a crown, so
  // 57,548 trees stop being one green.
  //
  // Both were baked and left unread; this is the one-liner they were baked for.
  //
  // DEPTH and JITTER are the two knobs. `depth: 0` is exactly the old flat look
  // (every tier the palette's mid green) and `jitter: 0` makes every tree the
  // same green — either is a one-line flatten.
  window.TREE_SHADE = {
    depth: 0.85,    // 0 = flat, 1 = the palette's full canopyHi..canopyLo spread
    jitter: 0.07,   // per-tree hue spread. SMALL: this is a stylised city and a
                    // rainbow forest is worse than a flat one.
  };
  const _hx = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16),
                    parseInt(h.slice(5, 7), 16)];
  const _hex = c => '#' + c.map(v =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  const _mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

  /**
   * The canopy colour expression for one hour's palette.
   *
   * Two nested interpolates: `tf` down the crown, `j` across the forest. The
   * four endpoints are computed here rather than in the expression because they
   * change once per retint and would otherwise be four colour mixes per
   * fragment.
   */
  window.treeCanopyColour = function treeCanopyColour(s) {
    const k = window.TREE_SHADE;
    const lit = _hx(s.canopyLo), shade = _hx(s.canopyHi);
    // The neutral both ends collapse to at depth 0 — the palette's own `canopy`
    // where it exists, otherwise the midpoint of the pair.
    const mid = s.canopy ? _hx(s.canopy) : _mix(lit, shade, 0.5);
    const dark = _mix(mid, shade, k.depth);
    const light = _mix(mid, lit, k.depth);
    // Warm and cool poles for the jitter. Deliberately a HUE nudge and not a
    // value one: varying brightness per tree would fight the crown gradient
    // that is the whole point of this change.
    const warm = [232, 196, 96], cool = [96, 158, 132];
    const pole = (c, p) => _hex(_mix(c, p, k.jitter));
    const byJ = c => (k.jitter <= 0 ? _hex(c)
      : ['interpolate', ['linear'], ['coalesce', ['get', 'j'], 0.5],
         0, pole(c, warm), 1, pole(c, cool)]);
    // `coalesce` so a tile baked before `tf` existed lands mid-crown rather
    // than painting the whole canopy at the shaded end.
    return ['interpolate', ['linear'], ['coalesce', ['get', 'tf'], 0.5],
            0, byJ(dark), 1, byJ(light)];
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
    // loadScene already fetched and parsed this file for its `caps` table (see
    // there). Handing MapLibre the object it already has costs one request
    // instead of two; the URL stays as the fallback for the case where that
    // fetch failed, so a missing roofs.geojson degrades to "no pitched roofs"
    // rather than to a boot error.
    const data = (scene && scene.roofs && scene.roofs.features && scene.roofs.features.length)
      ? scene.roofs : 'data/roofs.geojson';
    map.addSource('austin-roofs', { type:'geojson', data });
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
  //
  // THE NIGHT COLUMN WAS BACKWARDS AND SIMEON HAS REJECTED IT TWICE.
  //
  //   "now the seats become bright yellow and everything else is dull - what?
  //    the lights are supposed to illuminate everything"
  //
  // He is right, and the old note above defending this as a floodlit stadium had
  // the physics inverted. Floodlights sit on the RIM pointing INWARD and DOWN.
  // The field is the brightest surface in the frame; the lower bowl is lit and
  // falls off with height; the seats are what the light LANDS on, not what emits
  // it. Making the seat bands the brightest thing in a black city is a stadium
  // lit from inside its own chairs.
  //
  // So the night column is now dark upholstery catching a little spill —
  // brightest at the bottom of the bowl where the fixtures actually reach,
  // falling off upward. The burnt-orange club chairs keep a touch more because
  // they are a lighter material, not because they glow.
  const SEAT_COL = {
    lower:     ['#9aacc3', '#b0aea9', '#3a3d47'],   // day / golden / night
    lowerB:    ['#8395ab', '#9c9a96', '#34373f'],
    mid:       ['#a1b2c8', '#b6b4af', '#33363f'],
    midB:      ['#899ab0', '#a2a09b', '#2e3138'],
    upper:     ['#a7bbd4', '#bcbab5', '#2b2e36'],
    upperB:    ['#8fa3ba', '#a8a6a1', '#272931'],
    stain:     ['#8b8d8d', '#9a9083', '#31333a'],   // measured: luma 122.9, R/B 1.32
    stainB:    ['#808282', '#8d8478', '#2c2e34'],
    orange:    ['#91706b', '#a3785f', '#4a3a33'],   // club chairbacks, a lighter
    orangeB:   ['#82645f', '#946b55', '#41332d'],   // material, not a light source
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
  // `pier`, `lintel`, `shop`, `gate` and `canopy` are the arcade around the
  // concourse — see the ARCADE block in scripts/bake_stadium.py. They ride this
  // layer rather than the wall layer because they are materials, not facades:
  // each one carries its own day/golden/night trio and none of them wants a
  // window pattern. A pier wearing the wall's tile would have windows on a
  // column.
  const DETAIL_KINDS = ['board', 'logo', 'ramp', 'mast', 'aisle',
                        'pier', 'lintel', 'shop', 'gate', 'canopy'];

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
   * The whole field as FLAT GEOMETRY — one thin slab per class of paint.
   *
   * This replaces a canvas image on an `image` source. The image was replacing a
   * symbol layer. Both were abandoned for the same reason and it is worth
   * writing down once, because it is the reason this bug came back twice:
   *
   *   symbol  — composited over the finished frame. TEXAS and the midfield
   *             Longhorn were legible through 63 m of grandstand.
   *   raster  — does not share the depth buffer the 3D pass writes. Being BELOW
   *             the wall in the layer stack does not help: measured at style
   *             index 145 against the wall's 146, the turf still painted on the
   *             outside face of the north wall.
   *   geometry— a fill-extrusion is in the 3D pass, so the grandstand occludes
   *             it per pixel, at every angle, with no rule to tune. Measured
   *             side by side against the raster on the identical quad:
   *             0 px from outside the north wall, and correctly cut by the near
   *             rim from above.
   *
   * WHAT THIS COSTS, stated plainly: the yard numbers, the TEXAS / LONGHORNS
   * end-zone lettering and the midfield Longhorn are gone. They were canvas
   * text and an SVG path, and neither survives the trip to polygons without a
   * path flattener. Everything with an edge you can see from the air — turf,
   * mow bands, end zones, the sideline border, yard and goal lines — is here.
   * At the distance the field is legible from (200 m+, where 1 px is ~0.4 m) the
   * numbers were already under two pixels tall. The hash marks are dropped for
   * that reason too: 0.6 m wide is one and a half pixels.
   *
   * Field space is the canvas's: `u` runs west→east 0..FIELD_W, `v` runs
   * north→south 0..FIELD_L, matching the corner order the bake emits
   * (NW, NE, SE, SW). Every number below is the one that was in the canvas.
   */
  const FIELD_L = 109.73, FIELD_W = 48.77, ENDZONE = 9.14;

  // ── Taste block: the paint ──────────────────────────────────────────
  // Straight off the canvas this replaces, so the day field is the same paint
  // it has always been. `mow` is the canvas's 4.5% white wash over the turf,
  // pre-blended: a real field looks banded from the air rather than flat green.
  const FIELD_COL = {
    turf: '#3f6b3a',   // FieldTurf, post-2021 dark green
    mow:  '#477143',   // turf + 4.5% white — the five-yard mow band
    end:  '#bf5700',   // end zones and the sideline border, burnt orange
    line: '#dcd7cb',   // yard lines, goal lines — see FIELD_LINE_W
    logo: '#bf5700',   // the midfield Longhorn, UT burnt orange
  };
  // A yard line is 4 inches (0.10 m) in life, and was 0.20 m on the canvas this
  // replaces. Neither width survives as geometry. From the nadir the field
  // renders at 1.7 px per metre, so a 0.20 m slab covers a third of a pixel and
  // the rasteriser lights whichever pixel centres happen to land inside it: the
  // lines came out as a field of broken dashes, which reads worse than no lines
  // at all. The raster never had this problem because mipmapping averages
  // sub-pixel paint into a continuous tint, and geometry has no such filter.
  //
  // So these are the widths that SURVIVE TO THE SCREEN rather than the widths
  // on the pitch — about one pixel from over the rim — and FIELD_COL.line is
  // pulled back from the canvas's #f0ece4 so the extra width does not also read
  // as extra paint. All three are taste knobs.
  const FIELD_LINE_W = 0.55, FIELD_GOAL_W = 0.80;
  // Paint lies ON turf, so each class gets its own slab and the taller one
  // wins. The order is the canvas's draw order. 6 cm steps: invisible at any
  // distance the field can be seen from, and far coarser than the depth
  // buffer's resolution there, so nothing z-fights.
  const FIELD_Z = {
    turf: [0, 0.20], mow: [0.20, 0.26], end: [0.26, 0.32],
    border: [0.32, 0.38], line: [0.38, 0.44], logo: [0.44, 0.50],
  };
  // Which paint each slab uses. `border` is the same orange as the end zones;
  // it is a separate slab only so the yard lines can sit above it, exactly as
  // the canvas drew the lines last.
  const FIELD_PAINT = { turf: 'turf', mow: 'mow', end: 'end', border: 'end',
                        line: 'line', logo: 'logo' };

  /**
   * The midfield Longhorn, as a polygon flattened from Simeon's own SVG path.
   *
   * This is the one piece of the canvas field worth getting back as geometry.
   * The end-zone wordmarks are not: from the nadir the end zone is ~30 px wide,
   * so a letter stroke lands at 0.7 px and a rect font reads as noise rather
   * than as TEXAS. The mark is 15 m across — about 25 px from the same camera —
   * and a silhouette at 25 px still reads as a longhorn.
   *
   * Flattened by the BROWSER, not by a bezier routine written here.
   * `SVGPathElement.getPointAtLength` is exact, it is a dozen lines, and it
   * cannot disagree with the path the way a hand-rolled cubic subdivider can.
   * The path is one closed contour of `c` segments — checked, not assumed — so
   * one sampling run gives one simple ring with no subpath joins to bridge.
   */
  const LONGHORN_M = 15.0;    // taste: the real mark is about 15 m across
  const LONGHORN_PTS = 240;   // samples round the contour, ~6 cm apart at 15 m
  function longhornRing() {
    try {
      const NS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden');
      const el = document.createElementNS(NS, 'path');
      el.setAttribute('d', LONGHORN_PATH);
      svg.appendChild(el);
      document.body.appendChild(svg);
      const L = el.getTotalLength();
      const ring = [];
      if (L > 0) {
        for (let i = 0; i < LONGHORN_PTS; i++) {
          const p = el.getPointAtLength(L * i / LONGHORN_PTS);
          ring.push([p.x, p.y]);
        }
      }
      svg.remove();
      return ring.length > 8 ? ring : null;
    } catch (e) { return null; }
  }

  function fieldFeatures(corners) {
    const [NW, NE, SE, SW] = corners;
    const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const at = (u, v) => mix(mix(NW, NE, u / FIELD_W), mix(SW, SE, u / FIELD_W), v / FIELD_L);

    const out = [];
    const rect = (kind, u0, v0, u1, v1) => {
      v0 = Math.max(0, v0); v1 = Math.min(FIELD_L, v1);
      if (v1 - v0 <= 0 || u1 - u0 <= 0) return;
      const [b, h] = FIELD_Z[kind];
      out.push({ type: 'Feature',
        properties: { t: FIELD_PAINT[kind], b, h },
        geometry: { type: 'Polygon', coordinates: [[
          at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1), at(u0, v0)]] } });
    };

    rect('turf', 0, 0, FIELD_W, FIELD_L);
    // Mow bands run ACROSS the field, five yards wide, every other band.
    for (let i = 0; i < 24; i += 2) {
      rect('mow', 0, ENDZONE + i * 4.572, FIELD_W, ENDZONE + (i + 1) * 4.572);
    }
    rect('end', 0, 0, FIELD_W, ENDZONE);
    rect('end', 0, FIELD_L - ENDZONE, FIELD_W, FIELD_L);
    // The orange border runs only to the 20-yard lines — NOT around the whole
    // field. That is the specific thing the 2021 repaint changed and it is
    // visible in the aerial.
    const to20 = ENDZONE + 18.29;
    for (const [v0, v1] of [[0, to20], [FIELD_L - to20, FIELD_L]]) {
      rect('border', 0, v0, 1.5, v1);
      rect('border', FIELD_W - 1.5, v0, FIELD_W, v1);
    }
    // Yard lines every 5 yd, goal line to goal line; the goal lines heavier, as
    // they are on a real field and as the canvas drew them.
    for (let i = 0; i <= 20; i++) {
      const w = (i === 0 || i === 20) ? FIELD_GOAL_W : FIELD_LINE_W;
      const c = ENDZONE + i * 4.572;
      rect('line', 0, c - w / 2, FIELD_W, c + w / 2);
    }

    // The midfield Longhorn. The transform chain is the canvas's own, composed
    // by hand and read the way canvas applies it — the LAST transform set is
    // the FIRST one a point goes through — with the canvas's pixels replaced by
    // metres so it lands in field space directly.
    const ring = longhornRing();
    if (ring) {
      const lw = LONGHORN_M, lh = lw * LONGHORN_VB[1] / LONGHORN_VB[0];
      const place = ([x, y]) => {
        const x1 = x + 574.03, y1 = y + 241.88;
        const x2 = 1.25 * x1 - 390.11, y2 = -1.25 * y1 + 305.09;
        return at((FIELD_W - lw) / 2 + x2 * lw / LONGHORN_VB[0],
                  (FIELD_L - lh) / 2 + y2 * lh / LONGHORN_VB[1]);
      };
      const coords = ring.map(place);
      coords.push(coords[0]);
      const [b, h] = FIELD_Z.logo;
      out.push({ type: 'Feature', properties: { t: 'logo', b, h },
                 geometry: { type: 'Polygon', coordinates: [coords] } });
    }
    return out;
  }

  /**
   * The field's colour at time-of-day `p`.
   *
   * The raster this replaces rode the day ramp as EXPOSURE rather than colour —
   * `raster-brightness-max` and `raster-saturation`, because paint on turf is a
   * photograph of paint, not a material with its own night tone. That behaviour
   * is reproduced here exactly, arithmetic and all, so this change moves the
   * bleed and nothing else. DKR's actual night colour is a separate question and
   * a separate pass (MAC_QUEUE M1c).
   */
  const fieldColourAt = p => {
    const night = Math.max(0, (p - 0.62) / 0.38);
    const k = 1 - 0.42 * night;            // was raster-brightness-max
    const s = 1 - 0.10 * night;            // was raster-saturation
    const dim = hex => {
      const c = hx3(hex);
      const L = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
      return '#' + c.map(v =>
        Math.max(0, Math.min(255, Math.round((L + (v - L) * s) * k)))
          .toString(16).padStart(2, '0')).join('');
    };
    const e = ['match', ['get', 't']];
    for (const [name, hex] of Object.entries(FIELD_COL)) e.push(name, dim(hex));
    e.push(dim(FIELD_COL.turf));
    return e;
  };


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

      // THE FIELD, as geometry in the same 3D pass as the grandstand, so the
      // grandstand occludes it. Reported repeatedly: "when looking at DKR from
      // top right looking down left the whole field bleeds through the wall and
      // i can see just the field with the orange endzones through the walls."
      // Every previous shape of this layer — symbol, then raster — was
      // composited outside the depth buffer and bled; see fieldFeatures above
      // for the measurement. There is no camera rule here any more and there
      // should never be one again.
      if (gj.fieldCorners && !map.getSource('austin-field')) {
        map.addSource('austin-field', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: fieldFeatures(gj.fieldCorners) },
          // The field is 68 x 123 m and its slabs are thin bands within that. At
          // the default maxzoom geojson-vt would clip them per tile; capping at
          // 15 keeps one tile (~1.2 km) far larger than the whole field, the
          // same reason the bowl's own source is capped — see above.
          maxzoom: 15, tolerance: 0.25, buffer: 128,
        });
        map.addLayer({
          id:'stadium-field', type:'fill-extrusion', source:'austin-field', minzoom:14,
          paint:{
            'fill-extrusion-color': fieldColourAt(window.__todCurrentP != null ? window.__todCurrentP : 0.5),
            'fill-extrusion-base': ['get','b'],
            'fill-extrusion-height': ['get','h'],
            'fill-extrusion-opacity': 1.0,
            // OFF: the gradient darkens the bottom of an extrusion, and these
            // are 20 cm slabs, so the whole slab would fall inside it and the
            // turf would render as a dark smear.
            'fill-extrusion-vertical-gradient': false,
          },
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
            // A SEAT DECK IS NOT A SOLID CONE. This was the literal `0`, so every
            // seat feature extruded from the ground however the bake shaped it —
            // 44 nested rings of rising height are then not an approximation of a
            // bowl, they ARE a solid stepped pyramid. That is exactly Simeon's
            // "your current seats look like cutouts from a big pyramid", and it
            // was a description of the geometry rather than of the styling.
            // An upper deck needs a void under it; a void needs a base.
            'fill-extrusion-base':['coalesce', ['get','base'], 0],
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
    // The field is paint, not a material, so it rides the day ramp as exposure
    // rather than as colour — fieldColourAt does the same arithmetic the
    // raster's brightness/saturation properties used to. Floodlit at night, so
    // it dims far less than the unlit structure around it.
    try {
      map.setPaintProperty('stadium-field', 'fill-extrusion-color', fieldColourAt(p));
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

    // data/trees.geojson is 9.13 MB — the largest single file the app fetches
    // and a third of what a first-time visitor downloads before the city
    // appears. As vector tiles the browser fetches only what is under the
    // camera. js/tiles.js returns null if the archives are not built (a fresh
    // clone, or a branch where CI has not run), and then this is byte-identical
    // to what it always was. See scripts/tile.sh.
    const treeTiles = window.tileSource && window.tileSource('trees');
    if (!map.getSource('austin-trees')) {
      map.addSource('austin-trees', treeTiles
        ? treeTiles.source
        : { type:'geojson', data:'data/trees.geojson' });
    }
    // Spread into BOTH tree layers. A vector source without `source-layer`
    // draws absolutely nothing and reports no error, which reads as "the trees
    // are gone" rather than as a wiring mistake.
    const treeLP = treeTiles ? treeTiles.layerProps : {};
    // Tree DENSITY is a parameter, not a cull. Every tree carries `d`, a
    // keep-order in 0..1 biased so that thinning drops the small trees first
    // and keeps the big live oaks — which are what you actually see from 60 m.
    // Measured at 1440x900: the full set costs ~6-7 fps against trees-off, and
    // the trees are the cost (the ground fills are within noise). So the knob
    // exists and the presets set it; nothing is silently dropped.
    if (!map.getLayer('trees-trunk')) {
      map.addLayer({
        id:'trees-trunk', type:'fill-extrusion', source:'austin-trees', ...treeLP,
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
        id:'trees-canopy', type:'fill-extrusion', source:'austin-trees', ...treeLP,
        minzoom:14, filter:window.treeFilter('canopy'),
        paint:{
          // First paint only; applyTimeOfDay replaces this on the next tick
          // through the same function, so the two cannot drift apart.
          'fill-extrusion-color': window.treeCanopyColour(
            { canopy:'#7d9a62', canopyLo:'#93ad70', canopyHi:'#5f7d4a' }),
          'fill-extrusion-height':['get','h'],
          'fill-extrusion-base':['get','base'],
          'fill-extrusion-opacity':1.0,
          // OFF now. This darkens the bottom of every extrusion, and with a
          // real crown gradient it was darkening the bottom of every TIER —
          // five shadows up one tree, which is the banding the tiers were
          // rotated to hide.
          'fill-extrusion-vertical-gradient':false,
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
  // Real OSM building names. THREE TIERS, not one layer: a symbol layer's
  // minzoom is a single number and MapLibre will not take ['zoom'] inside a data
  // filter, so "name the landmarks from far away and the small stuff only up
  // close" has to be three layers over one source, split on the `lt` tier
  // stamped at load by the ranking pass above.
  //
  //   major  volume >= 130,000 m³ or >= 55 m   ~29 buildings   from z15.3
  //   mid    volume >=  42,000 m³ or >= 30 m   ~67 buildings   from z16.6
  //   minor  volume >=  13,000 m³              ~79 buildings   from z17.9
  //   (everything below that is never labelled — 43 names dropped outright)
  //
  // ─────────────────────────────────────────────────────────────────────────
  // THE ID ORDER LOOKS WRONG AND IS NOT. `buildings-labels` is the SMALLEST
  // tier. Do not "tidy" these ids back into order.
  //
  // js/timeofday.js hardcodes that one id and, at every hour, overwrites its
  // text-opacity outright:
  //     ['interpolate',['zoom'], 16.8, 0, 17.5, 0.82 * (1 - 0.45 * night)]
  // Two consequences, and this lane owns neither that file nor that constant:
  //
  //   1. whichever tier holds the id is INVISIBLE below z16.8. It was holding
  //      the LANDMARK tier, whose own minzoom is 15.8 — so the one tier that
  //      exists to read from a distance was pinned at zero opacity everywhere
  //      below z16.8, at every hour, and nothing in app.js could change it
  //      because tod runs last. Measured at the day/street pose before the fix:
  //      `buildings-labels` placed ONE label and owned 389 px of the frame,
  //      against 13,277 px for the mid tier.
  //   2. whichever tier holds it is dimmed 45% after dark. That is a deliberate
  //      earlier call — "the curated signage is the night story" — and it is
  //      right for the quietest tier and wrong for the tier carrying most of
  //      campus at street level, which is what made the night frames a field of
  //      grey smudges.
  //
  // So the id goes to the MINOR tier, where both behaviours are what you'd have
  // chosen anyway, and the two tiers that have to stay readable get new ids and
  // full control. Renaming `buildings-labels` outright is not an option: six
  // files and five verify scripts reference the string, places.js anchors its
  // shop names before it for collision priority, and places-check.mjs asserts
  // exactly that ordering — which still holds, since places-label still sits
  // ahead of it.
  //
  // The cost, written down so it is a choice and not a surprise: the minor tier
  // POPS IN at z17.9 with no fade, because tod's ramp is already flat by 17.5
  // and app.js's own text-opacity on that layer is overwritten on the first
  // move of the time slider. The alternative was starting the minor tier at
  // z17.2 to get the fade, which puts 79 more small names on screen at street
  // level — the exact clutter this pass exists to remove.
  // ─────────────────────────────────────────────────────────────────────────
  //
  // LOOK: one set of values, all three tiers, all three hours. Small cream type
  // at 82% alpha on a 1.3 px halo measured 1.14 contrast at the 10th percentile
  // and 3.22 at the glyph core against a tan-and-terracotta city — under every
  // legibility threshold there is, and dimmer still at night, where tod knocks
  // another 45% off. Near-white glyph on a nearly opaque near-black halo reads
  // on ANY background, which is the whole reason map labels are drawn this way:
  // the halo IS the local backdrop, so the scene behind it stops mattering.
  // Halo width is a fixed FRACTION of text size, so a 19 px landmark and a 10 px
  // annexe get the same relative weight instead of the same absolute 1.3 px.
  const LABEL_LOOK = {
    ink:       '#fffaf0',   // warm near-white
    halo:      'rgba(10,7,2,0.97)',
    haloRatio: 0.17,        // halo width ÷ text size
    haloBlur:  0.35,
    maxWidth:  9,           // ems — wider than 7 because the names are shorter now
    opacity:   1.0,
  };
  const LABEL_TIERS = [
    // id                          lt  minzoom  size at minzoom → size 2.7 zooms later   pad
    { id: 'buildings-labels-major', lt: 0, minzoom: 15.3, size: [13.5, 19.5], pad: 17 },
    { id: 'buildings-labels-mid',   lt: 1, minzoom: 16.6, size: [11,   14.5], pad: 13 },
    { id: 'buildings-labels',       lt: 2, minzoom: 17.9, size: [9.5,  12  ], pad: 10 },
  ];

  function addLabelLayers() {
    if (map.getLayer('buildings-labels')) return;
    for (const t of LABEL_TIERS) {
      const size = ['interpolate', ['linear'], ['zoom'],
        t.minzoom, t.size[0], t.minzoom + 2.7, t.size[1]];
      map.addLayer({
        id: t.id, type:'symbol',
        source:'austin-buildings',
        minzoom: t.minzoom,
        filter:['all', ['==',['get','lbl'],1], ['==',['get','lt'], t.lt]],
        layout:{
          'text-field':['get','name'],
          // Only Noto Sans Regular/Bold/Italic exist on OpenFreeMap's glyph
          // server — a missing fontstack 404s and MapLibre discards the whole
          // tile it was needed for.
          //
          // Bold for the landmark tier only. This is the cheapest hierarchy
          // signal there is and it costs no extra screen: weight separates a
          // landmark from a hall even when both are small in the frame.
          'text-font': t.lt === 0 ? ['Noto Sans Bold'] : ['Noto Sans Regular'],
          'text-size': size,
          'text-anchor':'center', 'text-offset':[0,-0.6],
          'text-max-width': LABEL_LOOK.maxWidth, 'text-padding': t.pad,
          'text-allow-overlap':false,
          // Within a tier, the bigger building wins the box. `final_height` was
          // the old key and it is the wrong one for the same reason it was the
          // wrong tier signal: it hands the box to whatever is tallest, which on
          // this campus is regularly a parking garage.
          'symbol-sort-key':['-', 0, ['get','lv']],
        },
        paint:{
          'text-color': LABEL_LOOK.ink,
          'text-halo-color': LABEL_LOOK.halo,
          'text-halo-width': ['interpolate', ['linear'], ['zoom'],
            t.minzoom,       +(t.size[0] * LABEL_LOOK.haloRatio).toFixed(2),
            t.minzoom + 2.7, +(t.size[1] * LABEL_LOOK.haloRatio).toFixed(2)],
          'text-halo-blur': LABEL_LOOK.haloBlur,
          // A SHORT fade, 0.3 of a zoom level, not the old 1.1. The long ramp
          // was why a label spent most of its useful zoom range translucent:
          // at the z16.4 aerial the mid tier was at 37% of its already-low 82%.
          'text-opacity':['interpolate',['linear'],['zoom'],
            t.minzoom, 0, t.minzoom + 0.3, LABEL_LOOK.opacity],
        },
      });
    }
    orderLabelLayers();
  }

  /**
   * COLLISION PRIORITY, which in MapLibre is layer order and nothing else:
   * whatever is earlier in the style is placed first and everything later is
   * dropped where it would overlap.
   *
   * `initSigns()` runs at step 'signs', AFTER step 'labels', with no beforeId —
   * so the curated hero names (UT Tower, Gregory Gym, Dobie) were appended to
   * the very END of the style and had the LOWEST priority in the whole map.
   * The top of the hierarchy was losing its box to OSM building names and to
   * shop fascias.
   *
   * Only this lane's own layers are moved. `places-label` is left exactly where
   * places.js put it — scripts/verify/places-check.mjs asserts it sits before
   * `buildings-labels`, and it still does.
   */
  function orderLabelLayers() {
    const order = ['signs-label', 'buildings-labels-major', 'places-label',
                   'buildings-labels-mid', 'buildings-labels'];
    // Walk from the back, moving each layer before the one that should follow
    // it. Anything not present yet is skipped; initSigns calls this again once
    // `signs-label` exists, so a late arrival still lands in the right place.
    //
    // The LAST layer in the list is deliberately never moved. `moveLayer(id)`
    // with no beforeId sends a layer to the very end of the style, i.e. above
    // every prop and every 3D layer added after the label step, which is a
    // draw-order change nobody asked for. Everything else is positioned
    // relative to it instead.
    let after = null;
    for (let i = order.length - 1; i >= 0; i--) {
      const id = order[i];
      if (!map.getLayer(id)) continue;
      if (after && id !== 'places-label') {                  // places-label is not ours to move
        try { map.moveLayer(id, after); } catch (e) {}
      }
      after = id;
    }
  }
  window.orderLabelLayers = orderLabelLayers;

  // ── Cinematic intro ───────────────────────────────────────────────
  // The opening shot RISES OUT OF DOWNTOWN AND LANDS ON CAMPUS. Three poses,
  // two eased legs, ~12.6 s:
  //
  //   start  low on Congress Avenue among the downtown towers, looking north
  //          up the avenue with the sunset sky behind them
  //   crest  climbing over the Capitol — the city opens out and the Forty
  //          Acres appears in the distance
  //   end    the UT Tower centred, the South Mall below it, campus filling
  //          the frame. It ends on the thing the app is *of*.
  //
  // The old flight started low over campus and ran west down 24th into West
  // Campus, i.e. it ended on apartment blocks; this one ends on the Tower.
  //
  // WHY THE CLIMB IS ALSO THE CHEAP OPTION, not just the pretty one. A flight
  // from downtown to campus has to pay for two neighbourhoods of tiles either
  // way. Pulling back to `crest.zoom` on leg 1 puts campus on screen at a
  // COARSE tile level a whole leg before leg 2 needs it sharp, so the
  // destination streams in while the camera is still over downtown instead of
  // popping in on arrival. The cost that buys it is one wide frame at the
  // crest — `crest.zoom` is the dial for that, and raising it by 0.3 cuts the
  // drawn area by about a third if a weaker device ever needs it.
  //
  // Every value here is a one-line taste edit. Any input cancels the flight and
  // skips to `end`, which is what pressing a key during a title sequence means.
  const INTRO = {
    start: { center: [-97.7420, 30.2680], zoom: 16.2,  pitch: 78, bearing: 5 },
    crest: { center: [-97.7404, 30.2748], zoom: 15.45, pitch: 71, bearing: 3 },
    end:   { center: [-97.7394, 30.2836], zoom: 16.9,  pitch: 72, bearing: 2 },
    leg1Ms: 6000,      // the rise out of downtown, decelerating into the crest
    leg2Ms: 6600,      // the run north into campus and the long settle
    maxVeilMs: 7000,   // a stalled tile must never hold a black screen
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
      // Skip to the END pose, not to SPAWN. Stopping mid-ease strands the
      // camera at whatever partial zoom/pitch the tween had reached, and on
      // this path that is somewhere over the Capitol — nowhere anyone asked to
      // be. Cancelling a title sequence should give you its last frame.
      map.jumpTo(INTRO.end);
      off();
    };
    const evts = ['mousedown','wheel','keydown','touchstart'];
    const off = () => evts.forEach(e => window.removeEventListener(e, cancel, true));
    evts.forEach(e => window.addEventListener(e, cancel, true));

    map.jumpTo(INTRO.start);

    const fly = () => {
      if (cancelled) return;
      // Leg 1: gentle at both ends. The deceleration into the crest is what
      // makes the top of the arc read as a held beat rather than a waypoint.
      map.easeTo({ ...INTRO.crest, duration: INTRO.leg1Ms,
                   easing: t => 0.5 - 0.5 * Math.cos(Math.PI * t) });
      leg2Timer = setTimeout(() => {
        if (cancelled) return;
        // Leg 2: ease-in-out cubic. Starts from the crest's zero velocity with
        // no jerk, carries more speed through the middle than a cosine would,
        // and has the longer tail that the arrival on the Tower wants.
        map.easeTo({ ...INTRO.end, duration: INTRO.leg2Ms,
                     easing: t => t < 0.5 ? 4 * t * t * t
                                          : 1 - Math.pow(-2 * t + 2, 3) / 2 });
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

  // The snapshot switcher and the "what changed" diff tour used to live here.
  // Simeon: "get rid of the snapshot feature, we'll just do the latest one,
  // snapshot feature is useless." The BAKE still writes into a dated folder and
  // data/manifest.json still records it — that is how the data pipeline works and
  // it is untouched. The client simply always loads `manifest.latest`, which boot
  // was already doing; only the UI that let you pick a different one is gone.

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
