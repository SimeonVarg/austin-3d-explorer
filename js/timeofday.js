/**
 * timeofday.js — Time-of-day system for Austin 3D Explorer (v2)
 *
 * Single value p (0 = day, 0.5 = golden hour, 1 = night) drives the scene.
 *
 * Building/part/roof colours are BAKED per feature by scripts/bake_detail.py
 * as wd/wg/wn (wall day/golden/night) and rd/rg/rn (roof cap). The client
 * blends between them with one expression whose interpolate input is the
 * constant p — so every feature keeps its own identity at every hour.
 *
 * Public (window) API:
 *   cleanupBasemap(map)            — strip Liberty clutter, categorise layers
 *   applyTimeOfDay(map, p)         — apply the mood for value p
 *   initTimeOfDayUI(map, defaultP) — wire the slider + play button
 *   TOD_DEFAULT_P                  — 0.30
 */

(function () {
  'use strict';

  // Late-morning default: full palette variety visible, faint warmth.
  const TOD_DEFAULT_P = 0.12;

  // ── Scene keyframes (everything not baked per-building) ──────────
  const PRESETS = {
    day: {
      sky: '#7fb2e5', horizon: '#e9e4d0', skyBlend: 0.5, horizonBlend: 0.8,
      lightColor: '#fff6e0', lightIntensity: 0.45, lightPosition: [1.15, 210, 35],
      ground: '#e8e1d0', park: '#adc48d', road: '#dad2bd', water: '#9fc3d2',
      canopy: '#7d9a62', canopyTop: '#93ad76', trunk: '#6b4f38',
      pitch: '#94b573', fountain: '#a5cbd8',
      accent: '#d15f27', signGlow: 0, labelHalo: 'rgba(30,15,0,0.85)',
    },
    golden: {
      sky: '#c96f3e', horizon: '#f7c778', skyBlend: 0.9, horizonBlend: 0.9,
      lightColor: '#ffb46a', lightIntensity: 0.5, lightPosition: [1.3, 255, 75],
      ground: '#e5cda2', park: '#adb271', road: '#d5bd92', water: '#c8ad92',
      canopy: '#8a935a', canopyTop: '#a5a468', trunk: '#5f4632',
      pitch: '#a2a768', fountain: '#d4b894',
      accent: '#ff7a2f', signGlow: 0.4, labelHalo: 'rgba(50,20,0,0.85)',
    },
    night: {
      sky: '#0a0f24', horizon: '#2c3050', skyBlend: 0.65, horizonBlend: 0.85,
      lightColor: '#5566aa', lightIntensity: 0.28, lightPosition: [1.4, 300, 60],
      ground: '#11141f', park: '#131c16', road: '#232739', water: '#0c1830',
      canopy: '#1a251c', canopyTop: '#233026', trunk: '#171210',
      pitch: '#15201a', fountain: '#12233a',
      accent: '#ff7a2f', signGlow: 1.0, labelHalo: 'rgba(0,0,10,0.9)',
    },
  };

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
  function clamp01(v) { return Math.max(0, Math.min(1, v)); }

  function presetAt(p) {
    p = clamp01(p);
    let a, b, t;
    if (p <= 0.5) { a = PRESETS.day;    b = PRESETS.golden; t = p / 0.5; }
    else          { a = PRESETS.golden; b = PRESETS.night;  t = (p - 0.5) / 0.5; }
    const out = {};
    for (const k of Object.keys(a)) {
      const av = a[k], bv = b[k];
      if (typeof av === 'number')      out[k] = lerpNum(av, bv, t);
      else if (Array.isArray(av))      out[k] = lerpArr(av, bv, t);
      else if (av[0] === '#')          out[k] = lerpHex(av, bv, t);
      else                             out[k] = t < 0.5 ? av : bv; // rgba strings snap
    }
    return out;
  }

  // Per-feature baked colour, blended for the current hour. The interpolate
  // input is the CONSTANT p — output still varies per feature via ['get'].
  function bakedColor(p, dayProp, goldenProp, nightProp) {
    p = clamp01(p);
    return ['interpolate', ['linear'], p,
      0,   ['to-color', ['get', dayProp],    '#888888'],
      0.5, ['to-color', ['get', goldenProp], '#888888'],
      1,   ['to-color', ['get', nightProp],  '#333344'],
    ];
  }

  // ── Basemap cleanup ───────────────────────────────────────────────
  let _bgLayers=[], _groundFills=[], _parkFills=[], _waterFills=[], _waterLines=[], _roadLines=[];
  let _cleaned = false;

  function isOurLayer(layer) {
    return layer.source === 'austin-buildings' ||
           layer.source === 'austin-parts'     ||
           layer.source === 'austin-trees'     ||
           layer.source === 'austin-landscape' ||
           layer.source === 'austin-signs'     ||
           layer.id.startsWith('buildings-')   ||
           layer.id.startsWith('parts-')       ||
           layer.id.startsWith('trees-')       ||
           layer.id.startsWith('landscape-')   ||
           layer.id.startsWith('signs-');
  }

  function cleanupBasemap(map) {
    if (_cleaned) return;
    const style = map.getStyle();
    if (!style || !style.layers) return;
    const hidden = [], kept = [];
    for (const layer of style.layers) {
      if (isOurLayer(layer)) continue;
      const id   = layer.id;
      const idl  = id.toLowerCase();
      const src  = (layer['source-layer'] || '').toLowerCase();
      const type = layer.type;

      if (type === 'background') { _bgLayers.push(id); continue; }

      // All basemap symbol layers = labels/icons — hide the lot
      if (type === 'symbol') { hide(map, id); hidden.push(id); continue; }

      // Basemap fill-extrusion buildings — hide (we render our own)
      if (type === 'fill-extrusion') { hide(map, id); hidden.push(id); continue; }

      // Water fills / lines — keep, tinted
      if (src === 'water' || src === 'ocean' || idl === 'water' || idl === 'ocean') {
        (type === 'line' ? _waterLines : _waterFills).push(id); continue;
      }
      if (src === 'waterway') { _waterLines.push(id); continue; } // Waller Creek

      // Parks, grass, woods — the GREEN bucket (was ground-tinted before,
      // which flattened campus lawns into pavement colour)
      if (src === 'park' || src === 'landcover' || /park|grass|wood|forest|garden/.test(idl)) {
        if (type === 'fill') { _parkFills.push(id); } else { hide(map, id); hidden.push(id); }
        continue;
      }

      if (type === 'line') {
        if (isMajorRoad(idl, src)) { _roadLines.push(id); thinRoad(map, id); }
        else                       { hide(map, id); hidden.push(id); }
        continue;
      }

      if (type === 'fill') {
        // Pattern fills (pedestrian plazas, wetland hatching) ignore
        // fill-color tints and glow white at night — hide them.
        const paint = layer.paint || {};
        if (paint['fill-pattern']) { hide(map, id); hidden.push(id); continue; }
        _groundFills.push(id); continue;
      }
    }
    console.log('[cleanupBasemap] hidden', hidden.length, 'layers; parks:', _parkFills.length,
                'ground:', _groundFills.length, 'roads:', _roadLines.length);
    _cleaned = true;
  }

  function isMajorRoad(idl, src) {
    if (src === 'transportation') {
      return /motorway|trunk|primary|secondary|tertiary|street|minor/.test(idl) &&
             !/path|pedestrian|service|track|footway|cycleway|rail|ferry|construction|tunnel|casing/.test(idl);
    }
    return /motorway|trunk|primary|secondary|tertiary|street/.test(idl);
  }
  function hide(map, id) { try { map.setLayoutProperty(id,'visibility','none'); } catch(e){} }
  function thinRoad(map, id) {
    try {
      map.setPaintProperty(id,'line-width',['interpolate',['linear'],['zoom'],12,0.5,15,1.6,18,4]);
      map.setPaintProperty(id,'line-opacity',0.85);
    } catch(e) {}
  }

  // ── Apply ─────────────────────────────────────────────────────────
  function applyTimeOfDay(map, p) {
    if (!map) return;
    const s = presetAt(p);
    window.__todCurrentP = p;

    if (typeof map.setSky === 'function') {
      map.setSky({
        'sky-color': s.sky,
        'horizon-color': s.horizon,
        'fog-color': s.horizon,
        'sky-horizon-blend': s.skyBlend,
        'horizon-fog-blend': s.horizonBlend,
        'fog-ground-blend': 0.5,
        'atmosphere-blend': 0,
      });
    }

    if (typeof map.setLight === 'function') {
      map.setLight({ anchor:'map', color:s.lightColor, intensity:s.lightIntensity, position:s.lightPosition });
    }

    // Baked per-feature colours, blended for the hour
    if (!window.__debugActive) {
      safePaint(map, 'buildings-3d',  'fill-extrusion-color', bakedColor(p,'wd','wg','wn'));
      safePaint(map, 'buildings-roof','fill-extrusion-color', bakedColor(p,'rd','rg','rn'));
      safePaint(map, 'parts-3d',      'fill-extrusion-color', bakedColor(p,'wd','wg','wn'));
      safePaint(map, 'parts-roof',    'fill-extrusion-color', bakedColor(p,'rd','rg','rn'));
    }

    // Trees: canopy gets a vertical top-lit gradient feel via two stops on height
    safePaint(map, 'trees-canopy', 'fill-extrusion-color', s.canopy);
    safePaint(map, 'trees-trunk',  'fill-extrusion-color', s.trunk);
    safePaint(map, 'landscape-pitch',    'fill-color', s.pitch);
    safePaint(map, 'landscape-fountain', 'fill-color', s.fountain);

    for (const id of _bgLayers)    safePaint(map, id, 'background-color', s.ground);
    for (const id of _groundFills) safePaint(map, id, 'fill-color',       s.ground);
    for (const id of _parkFills)   safePaint(map, id, 'fill-color',       s.park);
    for (const id of _waterFills)  safePaint(map, id, 'fill-color',       s.water);
    for (const id of _waterLines)  safePaint(map, id, 'line-color',       s.water);
    for (const id of _roadLines)   safePaint(map, id, 'line-color',       s.road);

    if (map.getLayer && map.getLayer('buildings-labels')) {
      safePaint(map, 'buildings-labels', 'text-halo-color', s.labelHalo);
    }

    // Curated branded landmark signs (signs.js) — glow + ground light pools.
    if (typeof applySignGlowLayer === 'function') applySignGlowLayer(map, s.signGlow);

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
