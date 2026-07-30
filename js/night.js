/**
 * night.js — night-only scene lighting beyond the windows (streetlights).
 *
 * Owned by the night workstream. Wired from app.js as step('night') and driven
 * from timeofday.js via window.applyNightLayer(map, p).
 *
 * Streets after dark were pure voids between the lit buildings. This module
 * samples lamp points along the basemap's road geometry (the same
 * `transportation` classes timeofday keeps visible), and renders each lamp as
 * a soft warm pool of light flat on the ground. The layers sit BEFORE the
 * building extrusions in the style, so towers occlude the pools behind them.
 *
 * Road geometry comes from `querySourceFeatures` on the Liberty basemap, which
 * only returns features for LOADED tiles — so generation waits for `idle` and
 * clips to the baked-buildings bounding box (the camera fence covers the same
 * area, so those tiles are resident at spawn). Points are computed once and
 * deduplicated on a metric grid, because tile borders return the same road
 * twice.
 *
 * Public (window) API:
 *   initNight(map)           — add source/layers, schedule point generation
 *   applyNightLayer(map, p)  — fade lamps for time-of-day p (0 day … 1 night)
 */
(function () {
  'use strict';

  // ── Streetlights — every taste value in one place ───────────────────
  const LIGHTS = {
    // Which basemap road classes get lamps, and how far apart (metres).
    // Classes measured in the Liberty tiles here: motorway 233, primary 559,
    // secondary 759, tertiary 383, minor 339 segments (trunk/street absent
    // but kept for safety — other areas may carry them).
    MAJOR_CLASSES: ['motorway', 'trunk', 'primary', 'secondary'],
    MINOR_CLASSES: ['tertiary', 'minor', 'street'],
    SPACING_MAJOR_M: 62,
    SPACING_MINOR_M: 88,
    DEDUPE_GRID_M: 32,        // no two lamps closer than ~this; also merges
                              // dual-carriageway twin lines into one lamp run
    FENCE_PAD_M: 150,         // beyond the buildings bbox, streets stay dark

    // Pool: the soft ground glow. Core: the small bright lamp head inside it.
    COLOR_MAJOR: '#ffb45c',   // high-pressure sodium
    COLOR_MINOR: '#ffc57e',   // warmer residential tier
    CORE_COLOR:  '#ffe0a8',
    POOL_OPACITY_MAJOR: 0.52,
    POOL_OPACITY_MINOR: 0.36,
    CORE_OPACITY: 0.9,
    POOL_BLUR: 0.85,
    CORE_BLUR: 0.4,
    // circle-radius zoom curve for the pool (px); minor tier and the core are
    // scaled off it so one curve rules the sizes.
    POOL_RADIUS: [13, 2.5, 15, 6, 17, 16, 19.5, 44],
    MINOR_RADIUS_SCALE: 0.72,
    CORE_RADIUS_SCALE: 0.22,

    // Lamps come on through dusk, slightly before full night.
    NIGHT_START: 0.58,
    NIGHT_FULL: 0.85,

    MAX_POINTS: 12000,        // hard cap; generation warns if it ever trims
    IDLE_RETRIES: 5,          // querySourceFeatures can race tile loading
  };

  const SRC = 'night-streetlights';
  const POOL = 'night-streetlight-pool';
  const CORE = 'night-streetlight-core';

  const M_LAT = 110540;
  const mLon = lat => 111320 * Math.cos(lat * Math.PI / 180);

  let _points = null;      // generated once
  let _tries = 0;
  let _lastP = 0;

  function tierMatch(prop, major, minor) {
    return ['match', ['get', 'tier'], 'major', major, minor];
  }

  function addLayers(map) {
    if (!map.getSource(SRC)) {
      map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    const beforeId = map.getLayer('buildings-shadow') ? 'buildings-shadow'
                   : map.getLayer('buildings-3d') ? 'buildings-3d' : undefined;
    // POOL_RADIUS alternates [zoom, px, zoom, px…]. The zoom interpolate MUST
    // be the top-level expression — nesting it inside a ['match'] is rejected
    // by the style validator, and a rejected paint property takes the whole
    // layer down with it (measured: the pool layer silently never existed
    // while the core layer rendered). Per-tier scaling goes INSIDE each output.
    const radiusExpr = (k) => ['interpolate', ['exponential', 1.7], ['zoom'],
      ...LIGHTS.POOL_RADIUS.map((v, i) => i % 2
        ? tierMatch('tier', v * k, v * k * LIGHTS.MINOR_RADIUS_SCALE)
        : v)];
    if (!map.getLayer(POOL)) {
      map.addLayer({
        id: POOL, type: 'circle', source: SRC, minzoom: 13,
        paint: {
          'circle-pitch-alignment': 'map',
          'circle-color': tierMatch('tier', LIGHTS.COLOR_MAJOR, LIGHTS.COLOR_MINOR),
          'circle-blur': LIGHTS.POOL_BLUR,
          'circle-radius': radiusExpr(1),
          'circle-opacity': 0,   // driven by applyNightLayer
        },
      }, beforeId);
    }
    if (!map.getLayer(CORE)) {
      map.addLayer({
        id: CORE, type: 'circle', source: SRC, minzoom: 14,
        paint: {
          'circle-pitch-alignment': 'map',
          'circle-color': LIGHTS.CORE_COLOR,
          'circle-blur': LIGHTS.CORE_BLUR,
          'circle-radius': radiusExpr(LIGHTS.CORE_RADIUS_SCALE),
          'circle-opacity': 0,
        },
      }, beforeId);
    }
  }

  function buildingsBbox(map) {
    const src = map.getSource('austin-buildings');
    if (!src) return null;
    // In this MapLibre build `_data` is a truthy wrapper WITHOUT `.features`
    // (measured), so take whichever candidate actually carries the geometry.
    const data = [src._data, src.serialize && src.serialize().data]
      .find(d => d && typeof d !== 'string' && d.features && d.features.length);
    if (!data) return null;
    let w = 180, s = 90, e = -180, n = -90;
    const walk = cs => {
      for (const c of cs) {
        if (typeof c[0] === 'number') {
          if (c[0] < w) w = c[0]; if (c[0] > e) e = c[0];
          if (c[1] < s) s = c[1]; if (c[1] > n) n = c[1];
        } else walk(c);
      }
    };
    for (const f of data.features) if (f.geometry) walk(f.geometry.coordinates);
    const padLng = LIGHTS.FENCE_PAD_M / mLon((s + n) / 2), padLat = LIGHTS.FENCE_PAD_M / M_LAT;
    return { w: w - padLng, s: s - padLat, e: e + padLng, n: n + padLat };
  }

  /** Place points every `spacing` metres along a coordinate array. */
  function sampleLine(coords, spacing, emit) {
    let rem = spacing * 0.5;
    for (let i = 1; i < coords.length; i++) {
      const x0 = coords[i - 1][0], y0 = coords[i - 1][1];
      const x1 = coords[i][0], y1 = coords[i][1];
      const mx = mLon(y0);
      const segLen = Math.hypot((x1 - x0) * mx, (y1 - y0) * M_LAT);
      if (!(segLen > 0)) continue;
      let d = rem;
      while (d < segLen) {
        const t = d / segLen;
        emit(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
        d += spacing;
      }
      rem = d - segLen;
    }
  }

  function generate(map) {
    if (_points) return;
    const style = map.getStyle();
    const vecSrc = Object.keys(style.sources).find(id => style.sources[id].type === 'vector');
    if (!vecSrc) return;
    let feats;
    try { feats = map.querySourceFeatures(vecSrc, { sourceLayer: 'transportation' }); }
    catch (err) { feats = []; }
    if (!feats || !feats.length) {
      // Tiles not resident yet — try again on a later idle.
      if (++_tries <= LIGHTS.IDLE_RETRIES) map.once('idle', () => generate(map));
      else console.warn('[night] no transportation features found; streetlights skipped');
      return;
    }

    const bbox = buildingsBbox(map);
    const seen = new Set();
    const features = [];
    let trimmed = false;
    const emitFor = tier => (lng, lat) => {
      if (bbox && (lng < bbox.w || lng > bbox.e || lat < bbox.s || lat > bbox.n)) return;
      const key = Math.round(lng * mLon(lat) / LIGHTS.DEDUPE_GRID_M) + ':' +
                  Math.round(lat * M_LAT / LIGHTS.DEDUPE_GRID_M);
      if (seen.has(key)) return;
      seen.add(key);
      if (features.length >= LIGHTS.MAX_POINTS) { trimmed = true; return; }
      features.push({ type: 'Feature', properties: { tier }, geometry: { type: 'Point', coordinates: [lng, lat] } });
    };

    // Majors first so the dedupe grid lets the brighter tier win crossings.
    for (const pass of [
      { classes: LIGHTS.MAJOR_CLASSES, spacing: LIGHTS.SPACING_MAJOR_M, tier: 'major' },
      { classes: LIGHTS.MINOR_CLASSES, spacing: LIGHTS.SPACING_MINOR_M, tier: 'minor' },
    ]) {
      const emit = emitFor(pass.tier);
      for (const f of feats) {
        const p = f.properties || {};
        if (pass.classes.indexOf(p.class) === -1) continue;
        if (p.brunnel === 'tunnel') continue;
        const g = f.geometry;
        if (!g) continue;
        if (g.type === 'LineString') sampleLine(g.coordinates, pass.spacing, emit);
        else if (g.type === 'MultiLineString') for (const c of g.coordinates) sampleLine(c, pass.spacing, emit);
      }
    }

    _points = { type: 'FeatureCollection', features };
    const srcObj = map.getSource(SRC);
    if (srcObj) srcObj.setData(_points);
    const majors = features.reduce((n, f) => n + (f.properties.tier === 'major' ? 1 : 0), 0);
    console.log('[night] streetlights:', features.length, `(${majors} major / ${features.length - majors} minor)`,
                bbox ? `fenced ${bbox.w.toFixed(3)}..${bbox.e.toFixed(3)} / ${bbox.s.toFixed(3)}..${bbox.n.toFixed(3)}` : 'UNFENCED',
                trimmed ? 'TRIMMED at cap' : '');
    window.__nightLights = { count: features.length, major: majors, trimmed, fenced: !!bbox };
    // The lamps may be born mid-evening — fade them to the current hour.
    window.applyNightLayer(map, _lastP);
  }

  window.initNight = function initNight(map) {
    addLayers(map);
    map.once('idle', () => generate(map));
  };

  // Called from timeofday's heavy path. p: 0 day … 1 night.
  window.applyNightLayer = function applyNightLayer(map, p) {
    if (!map || !map.getLayer) return;
    _lastP = p == null ? _lastP : p;
    const t = Math.max(0, Math.min(1,
      (_lastP - LIGHTS.NIGHT_START) / (LIGHTS.NIGHT_FULL - LIGHTS.NIGHT_START)));
    try {
      if (map.getLayer(POOL)) {
        map.setPaintProperty(POOL, 'circle-opacity',
          tierMatch('tier', LIGHTS.POOL_OPACITY_MAJOR * t, LIGHTS.POOL_OPACITY_MINOR * t));
      }
      if (map.getLayer(CORE)) {
        map.setPaintProperty(CORE, 'circle-opacity', LIGHTS.CORE_OPACITY * t);
      }
    } catch (err) { /* layers not ready yet */ }
  };
})();
