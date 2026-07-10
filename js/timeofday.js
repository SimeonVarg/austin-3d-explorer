/**
 * timeofday.js — Time-of-day system for Austin 3D Explorer
 *
 * Single value p (0 = day, 0.5 = golden hour, 1 = night) drives the scene.
 * Three keyframe presets, linearly interpolated:
 *   p ∈ [0,   0.5]  →  DAY   ↔ GOLDEN
 *   p ∈ [0.5, 1.0]  →  GOLDEN ↔ NIGHT
 *
 * Public (window) API:
 *   cleanupBasemap(map)            — strip Liberty clutter, categorise layers
 *   applyTimeOfDay(map, p)         — apply the mood for value p
 *   initTimeOfDayUI(map, defaultP) — wire the slider + play button
 *   TOD_DEFAULT_P                  — 0.30
 */

(function () {
  'use strict';

  const TOD_DEFAULT_P = 0.30;

  // ── Keyframe presets ──────────────────────────────────────────────
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

  const RAMP_STOPS = [0, 25, 55, 90];

  // ── Colour lerp helpers ───────────────────────────────────────────
  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
  }
  function rgbToHex(r, g, b) {
    const c = n => Math.max(0,Math.min(255,Math.round(n))).toString(16).padStart(2,'0');
    return `#${c(r)}${c(g)}${c(b)}`;
  }
  function lerpNum(a, b, t) { return a + (b - a) * t; }
  function lerpHex(a, b, t) {
    const A = hexToRgb(a), B = hexToRgb(b);
    return rgbToHex(lerpNum(A[0],B[0],t), lerpNum(A[1],B[1],t), lerpNum(A[2],B[2],t));
  }
  function lerpArr(a, b, t) { return a.map((v,i) => lerpNum(v, b[i], t)); }
  function lerpRamp(a, b, t) { return a.map((c,i) => lerpHex(c, b[i], t)); }
  function clamp01(v) { return Math.max(0, Math.min(1, v)); }

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
  let _bgLayers=[], _groundFills=[], _waterFills=[], _waterLines=[], _roadLines=[];
  let _cleaned = false;

  function isOurLayer(layer) {
    return layer.source === 'austin-buildings' ||
           layer.source === 'terrain-dem'      ||
           layer.id === 'hillshade'            ||
           layer.id.startsWith('buildings-');
  }

  function cleanupBasemap(map) {
    if (_cleaned) return;
    const style = map.getStyle();
    if (!style || !style.layers) return;
    const hidden = [], kept = [], ours = [];
    for (const layer of style.layers) {
      if (isOurLayer(layer)) { ours.push(layer.id); continue; }
      const id   = layer.id;
      const idl  = id.toLowerCase();
      const src  = (layer['source-layer'] || '').toLowerCase();
      const type = layer.type;

      // Background — keep, tinted as ground
      if (type === 'background') { _bgLayers.push(id); kept.push(id + '[bg]'); continue; }

      // All basemap symbol layers = labels/icons — hide the lot
      if (type === 'symbol') { hide(map, id); hidden.push(id); continue; }

      // Basemap fill-extrusion buildings — hide (we render our own)
      if (type === 'fill-extrusion') { hide(map, id); hidden.push(id + '[fill-ext]'); continue; }

      // Water fills / lines — keep, tinted
      if (src === 'water' || src === 'ocean' || idl === 'water' || idl === 'ocean') {
        (type === 'line' ? _waterLines : _waterFills).push(id); kept.push(id + '[water]'); continue;
      }
      // Waterways (Waller Creek!) — keep as thin water lines
      if (src === 'waterway') { _waterLines.push(id); kept.push(id + '[waterway]'); continue; }

      // Parks — keep as ground-tinted fills
      if (src === 'park') { type === 'fill' ? _groundFills.push(id) : hide(map, id); kept.push(id + '[park]'); continue; }

      // Road lines — thin and tint the important ones, hide the rest
      if (type === 'line') {
        if (isMajorRoad(idl, src)) { _roadLines.push(id); thinRoad(map, id); kept.push(id + '[road]'); }
        else                       { hide(map, id); hidden.push(id + '[minor-road]'); }
        continue;
      }

      // Fill layers (landuse, landcover, boundaries, etc.) — tint as ground
      if (type === 'fill') { _groundFills.push(id); kept.push(id + '[fill]'); continue; }

      // Everything else — leave as-is
      kept.push(id + '[other]');
    }
    console.log('[cleanupBasemap] OUR layers (skipped):', ours);
    console.log('[cleanupBasemap] Hidden:', hidden);
    console.log('[cleanupBasemap] Kept:', kept);
    _cleaned = true;
  }

  function isMajorRoad(idl, src) {
    // Match by source-layer name (more reliable than ID heuristics)
    if (src === 'transportation') {
      return /motorway|trunk|primary|secondary|tertiary/.test(idl) &&
             !/path|pedestrian|service|track|minor|footway|cycleway|rail|ferry|construction|bridge|tunnel/.test(idl);
    }
    // Fallback: ID-based heuristic for styles that don't use 'transportation' source-layer
    return /motorway|trunk|primary|secondary|tertiary/.test(idl);
  }
  function hide(map, id) { try { map.setLayoutProperty(id,'visibility','none'); } catch(e){} }
  function thinRoad(map, id) {
    try {
      map.setPaintProperty(id,'line-width',['interpolate',['linear'],['zoom'],12,0.4,15,1.2,18,3]);
      map.setPaintProperty(id,'line-opacity',0.7);
    } catch(e) {}
  }

  // ── Apply ─────────────────────────────────────────────────────────
  function applyTimeOfDay(map, p) {
    if (!map) return;
    const s = presetAt(p);
    window.__todCurrentP = p;

    if (typeof map.setSky === 'function') {
      map.setSky({
        'sky-color': s.sky, 'sky-horizon-blend': 0.6,
        'horizon-color': s.horizon, 'horizon-fog-blend': 0.5,
        'fog-color': s.fog, 'fog-ground-blend': 0.5,
        'atmosphere-blend': lerpNum(0.8, 0.4, clamp01(p)),
      });
    }

    if (typeof map.setLight === 'function') {
      map.setLight({ anchor:'map', color:s.lightColor, intensity:s.lightIntensity, position:s.lightPosition });
    }

    if (!window.__debugActive && map.getLayer && map.getLayer('buildings-3d')) {
      const litF = clamp01((p - 0.6) / 0.4) * 0.18;
      const ramp = s.buildingRamp.map(c => litF > 0 ? lerpHex(c, '#ffe0b0', litF) : c);
      safePaint(map, 'buildings-3d', 'fill-extrusion-color', [
        'interpolate',['linear'],['get','final_height'],
        RAMP_STOPS[0],ramp[0], RAMP_STOPS[1],ramp[1],
        RAMP_STOPS[2],ramp[2], RAMP_STOPS[3],ramp[3],
      ]);
    }

    for (const id of _bgLayers)    safePaint(map, id, 'background-color', s.ground);
    for (const id of _groundFills) safePaint(map, id, 'fill-color',       s.ground);
    for (const id of _waterFills)  safePaint(map, id, 'fill-color',       s.water);
    for (const id of _waterLines)  safePaint(map, id, 'line-color',       s.water);
    for (const id of _roadLines)   safePaint(map, id, 'line-color',       s.road);

    if (map.getLayer && map.getLayer('buildings-signs-glow')) {
      safePaint(map, 'buildings-signs-glow', 'text-halo-color', s.accent);
      safePaint(map, 'buildings-signs-glow', 'text-opacity',
        ['interpolate',['linear'],['zoom'],15.5,0,16,s.signGlow]);
    }

    const vig = document.getElementById('vignette');
    if (vig) vig.style.opacity = String(clamp01((p - 0.35) / 0.65) * 0.55);
  }

  function safePaint(map, id, prop, val) {
    try { if (map.getLayer && !map.getLayer(id)) return; map.setPaintProperty(id, prop, val); } catch(e) {}
  }

  // ── UI ────────────────────────────────────────────────────────────
  let _autoRaf=null, _autoDir=1;
  const AUTO_PER_MS = 1/22000;

  function initTimeOfDayUI(map, defaultP) {
    const slider = document.getElementById('tod-slider');
    const play   = document.getElementById('tod-play');
    const p0 = defaultP != null ? defaultP : TOD_DEFAULT_P;
    if (slider) {
      slider.value = String(p0);
      slider.addEventListener('input', () => { stopAuto(play); applyTimeOfDay(map, parseFloat(slider.value)); });
    }
    if (play) play.addEventListener('click', () => _autoRaf ? stopAuto(play) : startAuto(map, slider, play));
  }

  function startAuto(map, slider, play) {
    if (play) play.textContent = '⏸';
    let last = performance.now();
    let p = slider ? parseFloat(slider.value) : (window.__todCurrentP ?? TOD_DEFAULT_P);
    _autoDir = 1;
    const step = now => {
      const dt = now - last; last = now;
      p += _autoDir * dt * AUTO_PER_MS;
      if (p >= 1) { p=1; _autoDir=-1; } else if (p <= 0) { p=0; _autoDir=1; }
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

  window.TOD_DEFAULT_P   = TOD_DEFAULT_P;
  window.cleanupBasemap  = cleanupBasemap;
  window.applyTimeOfDay  = applyTimeOfDay;
  window.initTimeOfDayUI = initTimeOfDayUI;
})();
