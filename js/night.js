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
  //
  // What this layer was actually contributing before the July 31 night pass,
  // measured by scripts/verify/night-luma.mjs rather than guessed:
  //   1,039 lamps for the entire 3.3 x 3.1 km detailed bbox; 0.4-1.7% of the
  //   pixels in a night frame; +0.15 to +0.57 luma across the whole frame.
  // Where a lamp lands it is strong (+34 to +37 luma). There are just almost
  // none of them. So this is a DENSITY problem before it is a brightness one,
  // and the tone curve in graphics.js is not eating them: its toe LIFTS the
  // night shadows (a raw 13/255 lands at 9/255 after the filmic blend, against
  // 3/255 for the straight linear grade), it does not crush them.
  //
  // The dark campus core had a specific cause. `service` (246 features — the
  // campus drives and lot aisles) and `path` (170 — Speedway, the East Mall,
  // every lit walk) are the two biggest classes in the basemap's
  // `transportation` layer after the numbered roads, and NEITHER tier claimed
  // them. Campus is almost entirely those two classes, so campus got no lamps
  // at all while West Campus, which is on the street grid, did — which is why
  // the middle of the frame was the darkest part of the city.
  const LIGHTS = {
    // Which basemap road classes get lamps, and how far apart (metres).
    // Classes measured in the Liberty tiles here: path 170, service 246,
    // secondary 154, minor 112, primary 67, tertiary 56, motorway 42
    // (trunk/street absent but kept for safety — other areas may carry them).
    MAJOR_CLASSES: ['motorway', 'trunk', 'primary', 'secondary'],
    MINOR_CLASSES: ['tertiary', 'minor', 'street'],
    // The campus tier. Pole lamps along a walk are closer together and smaller
    // than a highway mast, which is why this is its own tier and not `minor`
    // with a different spacing.
    WALK_CLASSES: ['service', 'path'],
    // ...but not every `path` is a lit walk. Steps and platforms are not.
    // (The `*_construction` classes need no filter here: they are their own
    // class values and so match none of the three lists above.)
    WALK_SUBCLASS_SKIP: ['steps', 'platform'],
    SPACING_MAJOR_M: 46,      // was 62
    SPACING_MINOR_M: 64,      // was 88
    // The walk tier came out as 64% of all lamps at 54 m — every footway and
    // cycleway in West Campus, which is a blanket rather than a street grid.
    // 70 m keeps the campus malls reading as lit walks without the foreground
    // turning into a carpet of light.
    SPACING_WALK_M: 70,
    DEDUPE_GRID_M: 28,        // no two lamps closer than ~this; also merges
                              // dual-carriageway twin lines into one lamp run
                              // (was 32)
    FENCE_PAD_M: 150,         // beyond the buildings bbox, streets stay dark

    // ── Warm core, cool edges ──────────────────────────────────────
    // The scene was one amber everywhere. Real cities are not: the dense core
    // keeps older high-pressure sodium and carries far more warm sign and
    // interior spill, while the outer residential streets have been retrofitted
    // to ~4000K LED, which is visibly blue-white next to it. That split is the
    // single cheapest way to give a night city a centre.
    //
    // GENERATIVE, not sourced. Austin has no published per-fixture colour-
    // temperature map and this is not derived from one. It is a taste call
    // about how a city reads from 400 m up, anchored on the campus core.
    //
    // Costs nothing at render time: `w` (1 core … 0 edge) is computed once per
    // lamp at generation and the final colour is BAKED into the feature, so
    // the paint property is a plain ['get','color'] — the same shape
    // signs-ground-glow already uses. No per-frame expression work.
    WARM_ANCHOR: [-97.7394, 30.2862],   // the Main Building / UT Tower
    WARM_FULL_M: 430,          // inside this radius, full sodium
    WARM_FADE_M: 1250,         // beyond this, full cool LED
    CORE_OPACITY_BOOST: 0.22,  // core lamps also read a touch stronger

    // Pool: the soft ground glow. Core: the small bright lamp head inside it.
    // Each tier carries a core (warm) and an edge (cool) end; a lamp's own
    // colour is mixed between them by `w`.
    //
    // The two ends are LUMA-MATCHED, and that is not cosmetic. The first cut
    // used honest cool-LED hexes (#d8e2ff and friends) and they are far lighter
    // than the sodium they replace — #ffa63f is luma 177, #d8e2ff is luma 226 —
    // so the "cooler edge" came out as the BRIGHTEST thing in the frame, a belt
    // of white blobs across the West Campus foreground out-punching the core it
    // was supposed to defer to. Measured at the same time: the west pose's frame
    // p50 rose 10% while its p99/p50 contrast stayed flat, which is that exact
    // failure written as a number. Each EDGE colour below now sits within ~3
    // luma of its CORE partner, so the gradient is a change of HUE only and the
    // core keeps the emphasis (via CORE_OPACITY_BOOST, which is the one thing
    // that should differ in brightness).
    COLOR_MAJOR_CORE: '#ffa63f', COLOR_MAJOR_EDGE: '#9db4e6',   // luma 177 / 179
    COLOR_MINOR_CORE: '#ffbc6c', COLOR_MINOR_EDGE: '#b8c8ee',   // luma 197 / 199
    COLOR_WALK_CORE:  '#ffcf90', COLOR_WALK_EDGE:  '#ccd8f2',   // luma 213 / 215
    HEAD_COLOR_CORE:  '#ffe6b4', HEAD_COLOR_EDGE:  '#dde7f7',   // luma 232 / 230
    POOL_OPACITY_MAJOR: 0.66,   // was 0.52
    POOL_OPACITY_MINOR: 0.50,   // was 0.36
    POOL_OPACITY_WALK:  0.28,
    CORE_OPACITY: 0.9,
    POOL_BLUR: 0.85,
    CORE_BLUR: 0.4,
    // circle-radius zoom curve for the pool (px); the other tiers and the lamp
    // head are scaled off it so one curve rules the sizes. Widened only in the
    // 15-17 band, which is where the flying camera lives and where the mid
    // ground was going dark; the z19.5 end is untouched because the near-field
    // pools were already the largest thing in the frame and fill rate at that
    // radius is the one part of this that could cost frames.
    POOL_RADIUS: [13, 2.8, 15, 7.5, 17, 19, 19.5, 44],
    MINOR_RADIUS_SCALE: 0.74,
    WALK_RADIUS_SCALE: 0.46,
    CORE_RADIUS_SCALE: 0.22,

    // Lamps come on through dusk, slightly before full night.
    NIGHT_START: 0.58,
    NIGHT_FULL: 0.85,

    MAX_POINTS: 12000,        // hard cap; generation warns if it ever trims
    IDLE_RETRIES: 5,          // querySourceFeatures can race tile loading
  };

  // Backstop for a map that never goes idle — see initNight.
  const IDLE_FALLBACK_MS = 6000;

  const SRC = 'night-streetlights';
  const POOL = 'night-streetlight-pool';
  const CORE = 'night-streetlight-core';

  const M_LAT = 110540;
  const mLon = lat => 111320 * Math.cos(lat * Math.PI / 180);

  let _points = null;      // generated once
  let _tries = 0;
  let _lastP = 0;

  function tierMatch(major, minor, walk) {
    return ['match', ['get', 'tier'], 'major', major, 'minor', minor, walk];
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
    // Same rule is why the warm/cool gradient is a BAKED per-feature colour
    // rather than an interpolate on ['get','w'] wrapped in a tier match.
    const radiusExpr = (k) => ['interpolate', ['exponential', 1.7], ['zoom'],
      ...LIGHTS.POOL_RADIUS.map((v, i) => i % 2
        ? tierMatch(v * k, v * k * LIGHTS.MINOR_RADIUS_SCALE, v * k * LIGHTS.WALK_RADIUS_SCALE)
        : v)];
    if (!map.getLayer(POOL)) {
      map.addLayer({
        id: POOL, type: 'circle', source: SRC, minzoom: 13,
        paint: {
          'circle-pitch-alignment': 'map',
          'circle-color': ['get', 'color'],
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
          'circle-color': ['get', 'head'],
          'circle-blur': LIGHTS.CORE_BLUR,
          'circle-radius': radiusExpr(LIGHTS.CORE_RADIUS_SCALE),
          'circle-opacity': 0,
        },
      }, beforeId);
    }
  }

  // ── Warm core → cool edge ─────────────────────────────────────────
  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function mixHex(a, b, t) {
    const A = hexToRgb(a), B = hexToRgb(b);
    const c = n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
    return `#${c(A[0] + (B[0] - A[0]) * t)}${c(A[1] + (B[1] - A[1]) * t)}${c(A[2] + (B[2] - A[2]) * t)}`;
  }
  /** 1 at the campus core, 0 past WARM_FADE_M, smoothstepped between. */
  function warmthAt(lng, lat) {
    const [alng, alat] = LIGHTS.WARM_ANCHOR;
    const d = Math.hypot((lng - alng) * mLon(lat), (lat - alat) * M_LAT);
    const t = (d - LIGHTS.WARM_FULL_M) / (LIGHTS.WARM_FADE_M - LIGHTS.WARM_FULL_M);
    const u = Math.max(0, Math.min(1, t));
    return 1 - u * u * (3 - 2 * u);
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

  // MapLibre fires `idle` from inside its own render loop, and an exception
  // thrown in a listener there does NOT reliably surface as a page error — it
  // just leaves `_points` null and no log at all, which reads exactly like
  // "the tiles were not resident yet". Twenty minutes went into that once.
  // Anything that goes wrong in generation says so, loudly, from here on.
  function generate(map) {
    try { generateInner(map); }
    catch (err) {
      console.error('[night] streetlight generation FAILED:', err && err.stack || err);
      window.__nightLights = { count: 0, error: String(err) };
    }
  }

  function generateInner(map) {
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
    let warmSum = 0;
    const emitFor = pass => (lng, lat) => {
      if (bbox && (lng < bbox.w || lng > bbox.e || lat < bbox.s || lat > bbox.n)) return;
      const key = Math.round(lng * mLon(lat) / LIGHTS.DEDUPE_GRID_M) + ':' +
                  Math.round(lat * M_LAT / LIGHTS.DEDUPE_GRID_M);
      if (seen.has(key)) return;
      seen.add(key);
      if (features.length >= LIGHTS.MAX_POINTS) { trimmed = true; return; }
      // Bake the hour-independent half of the look now: colour by distance from
      // the core, and the core's opacity boost. applyNightLayer then only has to
      // scale one number per tier for the time of day.
      const w = warmthAt(lng, lat);
      warmSum += w;
      features.push({
        type: 'Feature',
        properties: {
          tier: pass.tier,
          w: +w.toFixed(3),
          color: mixHex(pass.edge, pass.core, w),
          head:  mixHex(LIGHTS.HEAD_COLOR_EDGE, LIGHTS.HEAD_COLOR_CORE, w),
          ob:    +(1 + LIGHTS.CORE_OPACITY_BOOST * w).toFixed(3),
        },
        geometry: { type: 'Point', coordinates: [lng, lat] },
      });
    };

    // Majors first so the dedupe grid lets the brighter tier win crossings, and
    // walks last so a campus path running beside a street does not double up.
    for (const pass of [
      { classes: LIGHTS.MAJOR_CLASSES, spacing: LIGHTS.SPACING_MAJOR_M, tier: 'major',
        core: LIGHTS.COLOR_MAJOR_CORE, edge: LIGHTS.COLOR_MAJOR_EDGE },
      { classes: LIGHTS.MINOR_CLASSES, spacing: LIGHTS.SPACING_MINOR_M, tier: 'minor',
        core: LIGHTS.COLOR_MINOR_CORE, edge: LIGHTS.COLOR_MINOR_EDGE },
      { classes: LIGHTS.WALK_CLASSES,  spacing: LIGHTS.SPACING_WALK_M,  tier: 'walk',
        core: LIGHTS.COLOR_WALK_CORE,  edge: LIGHTS.COLOR_WALK_EDGE },
    ]) {
      const emit = emitFor(pass);
      for (const f of feats) {
        const p = f.properties || {};
        if (pass.classes.indexOf(p.class) === -1) continue;
        if (p.brunnel === 'tunnel') continue;
        if (pass.tier === 'walk' && LIGHTS.WALK_SUBCLASS_SKIP.indexOf(p.subclass) !== -1) continue;
        const g = f.geometry;
        if (!g) continue;
        if (g.type === 'LineString') sampleLine(g.coordinates, pass.spacing, emit);
        else if (g.type === 'MultiLineString') for (const c of g.coordinates) sampleLine(c, pass.spacing, emit);
      }
    }

    _points = { type: 'FeatureCollection', features };
    const srcObj = map.getSource(SRC);
    if (srcObj) srcObj.setData(_points);
    const count = t => features.reduce((n, f) => n + (f.properties.tier === t ? 1 : 0), 0);
    const majors = count('major'), minors = count('minor'), walks = count('walk');
    console.log('[night] streetlights:', features.length, `(${majors} major / ${minors} minor / ${walks} walk)`,
                `mean warmth ${(warmSum / Math.max(1, features.length)).toFixed(2)}`,
                bbox ? `fenced ${bbox.w.toFixed(3)}..${bbox.e.toFixed(3)} / ${bbox.s.toFixed(3)}..${bbox.n.toFixed(3)}` : 'UNFENCED',
                trimmed ? 'TRIMMED at cap' : '');
    window.__nightLights = { count: features.length, major: majors, minor: minors, walk: walks,
                             meanWarmth: +(warmSum / Math.max(1, features.length)).toFixed(3),
                             trimmed, fenced: !!bbox };
    // The lamps may be born mid-evening — fade them to the current hour.
    window.applyNightLayer(map, _lastP);
  }

  window.initNight = function initNight(map) {
    addLayers(map);
    // `idle` is the RIGHT signal — querySourceFeatures only sees loaded tiles —
    // but it is not a reliable one here. Measured on this scene: with the
    // camera sitting still after boot, `idle` did not fire once in 28 seconds
    // (`map.loaded()` stayed false the whole time) and only arrived after a
    // jumpTo. On a page nobody touches, that is a city with no streetlights for
    // as long as the visitor leaves it alone.
    //
    // So take whichever comes first. `generate` is idempotent (`_points`
    // guards it) and re-arms its own retry if the tiles genuinely are not
    // resident yet, so an early timer attempt costs one cheap query.
    map.once('idle', () => generate(map));
    setTimeout(() => generate(map), IDLE_FALLBACK_MS);
  };

  // Called from timeofday's heavy path. p: 0 day … 1 night.
  window.applyNightLayer = function applyNightLayer(map, p) {
    if (!map || !map.getLayer) return;
    _lastP = p == null ? _lastP : p;
    const t = Math.max(0, Math.min(1,
      (_lastP - LIGHTS.NIGHT_START) / (LIGHTS.NIGHT_FULL - LIGHTS.NIGHT_START)));
    try {
      if (map.getLayer(POOL)) {
        // `ob` is the baked core-vs-edge boost. No zoom term here, so wrapping
        // the tier match in a `*` is legal — the top-level-interpolate rule
        // that shapes `radiusExpr` only applies to zoom expressions.
        map.setPaintProperty(POOL, 'circle-opacity',
          ['*', tierMatch(LIGHTS.POOL_OPACITY_MAJOR * t,
                          LIGHTS.POOL_OPACITY_MINOR * t,
                          LIGHTS.POOL_OPACITY_WALK  * t),
                ['number', ['get', 'ob'], 1]]);
      }
      if (map.getLayer(CORE)) {
        map.setPaintProperty(CORE, 'circle-opacity',
          ['*', LIGHTS.CORE_OPACITY * t, ['number', ['get', 'ob'], 1]]);
      }
    } catch (err) { /* layers not ready yet */ }
  };
})();
