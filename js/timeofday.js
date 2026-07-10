/**
 * timeofday.js — Time-of-day system for Austin 3D Explorer
 *
 * A single value `p` (0 = day, 0.5 = golden hour, 1 = night) drives the entire
 * scene's mood. Three keyframe presets are linearly interpolated:
 *   p ∈ [0,   0.5]  →  DAY   ↔ GOLDEN
 *   p ∈ [0.5, 1.0]  →  GOLDEN ↔ NIGHT
 *
 * applyTimeOfDay(map, p) updates, in one cheap pass:
 *   • the sky (sky/horizon/fog colors)          via map.setSky
 *   • the extrusion lighting (long warm shadows) via map.setLight
 *   • the building fill-extrusion colour ramp    via setPaintProperty
 *   • the (cleaned) basemap ground/water/road tints
 *   • the sign-glow layer opacity + colour
 *   • a CSS vignette overlay + subtle "lit windows" warm-up at night
 *
 * Public (window) API:
 *   cleanupBasemap(map)            — strip Liberty clutter, categorise layers
 *   applyTimeOfDay(map, p)         — apply the mood for value p
 *   initTimeOfDayUI(map, defaultP) — wire the slider + play button
 *   TOD_DEFAULT_P                  — default starting value (0.30)
 */

(function () {
  'use strict';

  const TOD_DEFAULT_P = 0.30;

  // ── Keyframe presets (exact starting values — tune later) ─────────
  const PRESETS = {
    day: {
      sky: '#bcd4e6', horizon: '#f3e9d2', fog: '#e9e0cf',
      lightColor: '#fff6e0', lightIntensity: 0.5, lightPosition: [1.15, 210, 30],
      buildingRamp: ['#efe3c8', '#d8c09a', '#bfa075', '#a07f55'], accent: '#d15f27',
      ground: '#efeae0', road: '#e3dccb', water: '#cdd8dc', signGlow: 0,
    },
    golden: {
      sky: '#f6b26b', horizon: '#f8d29a', fog: '#e8b98a',
      lightColor: '#ffb46a', lightIntensity: 0.55, lightPosition: [1.3, 250, 72],
      buildingRamp: ['#f0cf9a', '#d9a86a', '#b9814a', '#8f5a30'], accent: '#ff7a2f',
      ground: '#e9d3ad', road: '#dcc39a', water: '#cdb99a', signGlow: 0.4,
    },
    night: {
      sky: '#0b1026', horizon: '#1a2140', fog: '#0d1330',
      lightColor: '#5566aa', lightIntensity: 0.25, lightPosition: [1.4, 300, 60],
      buildingRamp: ['#2a2f3f', '#232838', '#1c2130', '#151a26'], accent: '#ff7a2f',
      ground: '#10131f', road: '#191d2b', water: '#0c1a2a', signGlow: 1.0,
    },
  };

  // Building ramp height stops (metres) mapped to the 4 ramp colours
  const RAMP_STOPS = [0, 25, 55, 90];

  // ── Colour / number lerp helpers ──────────────────────────────────
  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ];
  }
  function rgbToHex(r, g, b) {
    const c = (n) => Math.max(0, Math.min(255, Math.round(n)))
      .toString(16).padStart(2, '0');
    return `#${c(r)}${c(g)}${c(b)}`;
  }
  function lerpNum(a, b, t) { return a + (b - a) * t; }
  function lerpHex(a, b, t) {
    const A = hexToRgb(a), B = hexToRgb(b);
    return rgbToHex(lerpNum(A[0], B[0], t), lerpNum(A[1], B[1], t), lerpNum(A[2], B[2], t));
  }
  function lerpArr(a, b, t) { return a.map((v, i) => lerpNum(v, b[i], t)); }
  function lerpRamp(a, b, t) { return a.map((c, i) => lerpHex(c, b[i], t)); }
  function clamp01(v) { return Math.max(0, Math.min(1, v)); }

  /** Interpolate the full preset at value p. */
  function presetAt(p) {
    p = clamp01(p);
    let a, b, t;
    if (p <= 0.5) { a = PRESETS.day;    b = PRESETS.golden; t = p / 0.5; }
    else          { a = PRESETS.golden; b = PRESETS.night;  t = (p - 0.5) / 0.5; }
    return {
      sky:            lerpHex(a.sky, b.sky, t),
      horizon:        lerpHex(a.horizon, b.horizon, t),
      fog:            lerpHex(a.fog, b.fog, t),
      lightColor:     lerpHex(a.lightColor, b.lightColor, t),
      lightIntensity: lerpNum(a.lightIntensity, b.lightIntensity, t),
      lightPosition:  lerpArr(a.lightPosition, b.lightPosition, t),
      buildingRamp:   lerpRamp(a.buildingRamp, b.buildingRamp, t),
      accent:         lerpHex(a.accent, b.accent, t),
      ground:         lerpHex(a.ground, b.ground, t),
      road:           lerpHex(a.road, b.road, t),
      water:          lerpHex(a.water, b.water, t),
      signGlow:       lerpNum(a.signGlow, b.signGlow, t),
    };
  }

  // ── Basemap cleanup ───────────────────────────────────────────────
  // Categorised basemap layer ids, populated by cleanupBasemap and reused by
  // applyTimeOfDay for tinting. These only ever hold *basemap* layers — never
  // our own building/terrain layers.
  let _bgLayers    = [];
  let _groundFills = [];
  let _waterFills  = [];
  let _waterLines  = [];
  let _roadLines   = [];
  let _cleaned     = false;

  function isOurLayer(layer) {
    return (
      layer.source === 'austin-buildings' ||
      layer.source === 'terrain-dem' ||
      layer.id === 'hillshade' ||
      layer.id.indexOf('buildings-') === 0
    );
  }

  /**
   * Strip the OpenFreeMap "Liberty" style down to a clean low-poly base:
   * hide all POI/transit/place/aeroway labels, the style's own buildings, and
   * minor roads/landuse; keep background, water, parks, waterways and major
   * roads (thinned to faint lines). Categorise the survivors for tinting.
   */
  function cleanupBasemap(map) {
    if (_cleaned) return;
    const style = map.getStyle();
    if (!style || !style.layers) return;

    for (const layer of style.layers) {
      if (isOurLayer(layer)) continue;

      const id    = layer.id;
      const type  = layer.type;
      const src   = layer['source-layer'] || '';
      const idl   = id.toLowerCase();
      const srcl  = src.toLowerCase();

      // Background — keep, tinted as ground
      if (type === 'background') { _bgLayers.push(id); continue; }

      // All symbol layers in the basemap are labels/icons (poi, place, road
      // names, water names, transit, housenumbers) → hide the lot.
      if (type === 'symbol') { hide(map, id); continue; }

      // Water fills / lines — keep, tinted as water
      if (srcl === 'water' || idl.indexOf('water') !== -1) {
        if (type === 'line') _waterLines.push(id); else _waterFills.push(id);
        continue;
      }
      // Waterways (creeks — Waller Creek!) — keep as thin water lines
      if (srcl === 'waterway' || idl.indexOf('waterway') !== -1) {
        _waterLines.push(id);
        continue;
      }

      // Parks — keep as ground-tinted fill
      if (srcl === 'park' || idl.indexOf('park') !== -1) {
        if (type === 'fill') _groundFills.push(id);
        else hide(map, id); // park outlines etc.
        continue;
      }

      // The style's own buildings — hide (we render our own)
      if (srcl === 'building' || idl.indexOf('building') !== -1) {
        hide(map, id);
        continue;
      }

      // Roads / transportation lines
      if (srcl === 'transportation' || type === 'line') {
        if (isMajorRoad(idl)) {
          _roadLines.push(id);
          thinRoad(map, id);
        } else {
          hide(map, id); // minor roads, paths, rail, boundaries, misc lines
        }
        continue;
      }

      // Everything else (landuse/landcover fills, boundaries, etc.) — hide
      hide(map, id);
    }

    _cleaned = true;
  }

  function isMajorRoad(idl) {
    return /motorway|trunk|primary|secondary|tertiary|main|street|road_|highway/.test(idl)
      && !/path|pedestrian|service|track|minor|footway|cycleway|rail|ferry|construction/.test(idl);
  }

  function hide(map, id) {
    try { map.setLayoutProperty(id, 'visibility', 'none'); } catch (e) { /* noop */ }
  }

  function thinRoad(map, id) {
    try {
      map.setPaintProperty(id, 'line-width', [
        'interpolate', ['linear'], ['zoom'],
        12, 0.4,
        15, 1.2,
        18, 3,
      ]);
      map.setPaintProperty(id, 'line-opacity', 0.7);
    } catch (e) { /* some road layers have no line-width */ }
  }

  // ── Apply ─────────────────────────────────────────────────────────
  function applyTimeOfDay(map, p) {
    if (!map) return;
    const s = presetAt(p);
    window.__todCurrentP = p;

    // 1. Sky
    if (typeof map.setSky === 'function') {
      map.setSky({
        'sky-color':         s.sky,
        'sky-horizon-blend': 0.6,
        'horizon-color':     s.horizon,
        'horizon-fog-blend': 0.5,
        'fog-color':         s.fog,
        'fog-ground-blend':  0.5,
        'atmosphere-blend':  lerpNum(0.8, 0.4, clamp01(p)),
      });
    }

    // 2. Light (shades the building extrusions)
    if (typeof map.setLight === 'function') {
      map.setLight({
        anchor:    'map',
        color:     s.lightColor,
        intensity: s.lightIntensity,
        position:  s.lightPosition,
      });
    }

    // 3. Building colour ramp (skip while the debug colouring is active)
    if (!window.__debugActive && map.getLayer && map.getLayer('buildings-3d')) {
      // Bonus: "lit windows" — warm the ramp slightly as night falls (p>0.6)
      const litF = clamp01((p - 0.6) / 0.4) * 0.18;
      const ramp = s.buildingRamp.map((c) =>
        litF > 0 ? lerpHex(c, '#ffe0b0', litF) : c);

      const expr = [
        'interpolate', ['linear'], ['get', 'final_height'],
        RAMP_STOPS[0], ramp[0],
        RAMP_STOPS[1], ramp[1],
        RAMP_STOPS[2], ramp[2],
        RAMP_STOPS[3], ramp[3],
      ];
      safePaint(map, 'buildings-3d', 'fill-extrusion-color', expr);
    }

    // 4. Basemap tints
    for (const id of _bgLayers)    safePaint(map, id, 'background-color', s.ground);
    for (const id of _groundFills) safePaint(map, id, 'fill-color',       s.ground);
    for (const id of _waterFills)  safePaint(map, id, 'fill-color',       s.water);
    for (const id of _waterLines)  safePaint(map, id, 'line-color',       s.water);
    for (const id of _roadLines)   safePaint(map, id, 'line-color',       s.road);

    // 5. Sign glow
    if (map.getLayer && map.getLayer('buildings-signs-glow')) {
      safePaint(map, 'buildings-signs-glow', 'text-halo-color', s.accent);
      safePaint(map, 'buildings-signs-glow', 'text-opacity', [
        'interpolate', ['linear'], ['zoom'],
        15.5, 0,
        16,   s.signGlow,
      ]);
    }

    // 6. Vignette (CSS overlay) — fades in through the evening
    const vig = document.getElementById('vignette');
    if (vig) vig.style.opacity = String(clamp01((p - 0.35) / 0.65) * 0.55);
  }

  function safePaint(map, layerId, prop, value) {
    try {
      if (map.getLayer && !map.getLayer(layerId)) return;
      map.setPaintProperty(layerId, prop, value);
    } catch (e) { /* layer may not support this prop — ignore */ }
  }

  // ── UI wiring (slider + play button) ──────────────────────────────
  let _autoRaf = null;
  let _autoDir = 1;

  function initTimeOfDayUI(map, defaultP) {
    const slider = document.getElementById('tod-slider');
    const play   = document.getElementById('tod-play');
    const p0     = (defaultP != null) ? defaultP : TOD_DEFAULT_P;

    if (slider) {
      slider.value = String(p0);
      slider.addEventListener('input', () => {
        stopAuto(play);
        applyTimeOfDay(map, parseFloat(slider.value));
      });
    }

    if (play) {
      play.addEventListener('click', () => {
        if (_autoRaf) stopAuto(play);
        else          startAuto(map, slider, play);
      });
    }
  }

  // Auto ping-pong 0 → 1 → 0. Full one-way sweep ≈ 22 s (slow, cinematic).
  const AUTO_PER_MS = 1 / 22000;

  function startAuto(map, slider, play) {
    if (play) play.textContent = '⏸';
    let last = performance.now();
    let p = slider ? parseFloat(slider.value) : (window.__todCurrentP ?? TOD_DEFAULT_P);
    _autoDir = 1;

    const step = (now) => {
      const dt = now - last; last = now;
      p += _autoDir * dt * AUTO_PER_MS;
      if (p >= 1) { p = 1; _autoDir = -1; }
      else if (p <= 0) { p = 0; _autoDir = 1; }
      if (slider) slider.value = String(p);
      applyTimeOfDay(map, p);
      _autoRaf = requestAnimationFrame(step);
    };
    _autoRaf = requestAnimationFrame(step);
  }

  function stopAuto(play) {
    if (_autoRaf) cancelAnimationFrame(_autoRaf);
    _autoRaf = null;
    if (play) play.textContent = '▶';
  }

  // ── Exports ───────────────────────────────────────────────────────
  window.TOD_DEFAULT_P   = TOD_DEFAULT_P;
  window.cleanupBasemap  = cleanupBasemap;
  window.applyTimeOfDay  = applyTimeOfDay;
  window.initTimeOfDayUI = initTimeOfDayUI;
})();
