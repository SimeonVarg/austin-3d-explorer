/**
 * timeofday.js — Time-of-day system for Austin 3D Explorer (v3)
 *
 * Single value p (0 = day, 0.5 = golden hour, 1 = night) drives the scene.
 *
 * Walls are drawn with `fill-extrusion-pattern` (see facades.js), so the wall
 * colour for the hour lives inside the pattern image and is repainted there.
 * Everything the pattern can't carry — sky, fog, light, roof caps, ground,
 * roads, water, trees, shadows, signage — is keyframed here.
 *
 * Roof caps stay on baked per-feature colours (wd/wg/wn, rd/rg/rn from
 * scripts/bake_detail.py) and are blended with one `interpolate` expression
 * whose input is the constant p, so every feature keeps its own identity.
 *
 * Public (window) API:
 *   cleanupBasemap(map)            — strip Liberty clutter, categorise layers
 *   applyTimeOfDay(map, p)         — apply the mood for value p
 *   initTimeOfDayUI(map, defaultP) — wire the slider + play button
 *   TOD_DEFAULT_P                  — 0.12
 */

(function () {
  'use strict';

  // Late-morning default: full palette variety visible, faint warmth.
  const TOD_DEFAULT_P = 0.12;

  // ── Scene keyframes (everything not carried by the facade patterns) ──
  //
  // `fog` here is the aerial-perspective colour, tinted toward the SKY rather
  // than the ground. It drives the horizon haze band in atmosphere.js — NOT
  // MapLibre's `setSky` fog, which only paints the sky dome (sweeping
  // fog-ground-blend 0→1 leaves every ground pixel bit-identical, measured).
  // The sky fog values are still passed through so the dome itself reads right.
  const PRESETS = {
    day: {
      sky: '#21529f', horizon: '#b7daec', fog: '#b7daec',
      skyBlend: 0.5, horizonBlend: 0.92, fogGround: 0.08,
      lightColor: '#ffeeda', lightIntensity: 0.28, lightPosition: [1.15, 205, 32],
      ground: '#ded3bc', park: '#a9c489', road: '#e2dac7', roadCasing: '#bfb49d',
      water: '#8fbccd',
      canopy: '#7d9a62', trunk: '#6b4f38',
      pitch: '#94b573', fountain: '#a5cbd8',
      signGlow: 0, labelHalo: 'rgba(24,14,5,0.9)', vignette: 0.10, haze: 0.92,
    },
    golden: {
      sky: '#6a2a4a', horizon: '#ffb45e', fog: '#ffb45e',
      skyBlend: 0.86, horizonBlend: 0.94, fogGround: 0.06,
      lightColor: '#ffd7a8', lightIntensity: 0.30, lightPosition: [1.35, 252, 76],
      ground: '#d9b98c', park: '#a9a866', road: '#e8c79a', roadCasing: '#b78c60',
      water: '#c9a184',
      canopy: '#8a935a', trunk: '#5f4632',
      pitch: '#a2a768', fountain: '#d4b894',
      signGlow: 0.42, labelHalo: 'rgba(46,18,0,0.88)', vignette: 0.26, haze: 0.72,
    },
    night: {
      sky: '#040713', horizon: '#2c3a63', fog: '#3a4a72',
      skyBlend: 0.6, horizonBlend: 0.9, fogGround: 0.1,
      // Near-zero intensity on purpose. MapLibre's extrusion lighting washes
      // faces toward a warm mid-tone as intensity rises: at 0.3 the baked navy
      // roof #10121d renders #312c1b (measured), which put an olive tarp over
      // the whole night city. At ~0 the baked colours come through, and after
      // dark there's no sun to model anyway — the windows are the light source.
      lightColor: '#8fa0e0', lightIntensity: 0.04, lightPosition: [1.4, 300, 60],
      ground: '#090b12', park: '#0b120e', road: '#2a2519', roadCasing: '#0b0d13',
      water: '#070f1e',
      canopy: '#111a14', trunk: '#100d0c',
      pitch: '#0d1512', fountain: '#0e1c30',
      signGlow: 1.0, labelHalo: 'rgba(4,4,12,0.92)', vignette: 0.38, haze: 0.55,
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

  // Twilight cannot be a straight RGB lerp. Interpolating golden→night directly
  // drags the highest-alpha layers through desaturated tan and then dead-neutral
  // grey — measured: haze colour (174,123,87) khaki at p=0.65 and (74,60,62) at
  // p=0.875. Real twilight goes orange → rose → violet → deep blue and never
  // loses its saturation. These four tracks override the linear result for
  // p > 0.5; their p=0.50 and p=1.00 keys equal PRESETS.golden and PRESETS.night
  // exactly, so there is no discontinuity at either end of the sweep.
  const DUSK = {
    sky:     [[0.50, '#6a2a4a'], [0.60, '#3a1c48'], [0.72, '#10173a'], [1.00, '#040713']],
    horizon: [[0.50, '#ffb45e'], [0.60, '#b0526a'], [0.72, '#3a4780'], [1.00, '#2c3a63']],
    fog:     [[0.50, '#ffb45e'], [0.60, '#965460'], [0.72, '#33406e'], [1.00, '#3a4a72']],
    haze:    [[0.50, 0.72],      [0.60, 0.68],      [0.72, 0.60],      [1.00, 0.55]],
  };
  function duskAt(keys, p) {
    if (p <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      if (p <= keys[i][0]) {
        const [pa, va] = keys[i - 1], [pb, vb] = keys[i];
        const t = (p - pa) / (pb - pa);
        return typeof va === 'number' ? lerpNum(va, vb, t) : lerpHex(va, vb, t);
      }
    }
    return keys[keys.length - 1][1];
  }

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
    if (p > 0.5) for (const k of Object.keys(DUSK)) out[k] = duskAt(DUSK[k], p);
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
           layer.source === 'austin-shadows'   ||
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
        if (isMajorRoad(idl, src)) { _roadLines.push(id); styleRoad(map, id, idl); }
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
             !/path|pedestrian|service|track|footway|cycleway|rail|ferry|construction|tunnel/.test(idl);
    }
    return /motorway|trunk|primary|secondary|tertiary|street/.test(idl);
  }
  function hide(map, id) { try { map.setLayoutProperty(id,'visibility','none'); } catch(e){} }

  // Streets are the only structure the ground plane has. Liberty's defaults are
  // hairlines that vanish at flythrough pitch, so widen them into readable
  // ribbons — casings included, which is what makes the grid read as a grid.
  const _casings = new Set();
  function styleRoad(map, id, idl) {
    const casing = /casing|outline/.test(idl);
    if (casing) _casings.add(id);
    try {
      map.setPaintProperty(id, 'line-width', casing
        ? ['interpolate',['exponential',1.5],['zoom'],12,1.2,15,4.5,18,17,20,40]
        : ['interpolate',['exponential',1.5],['zoom'],12,0.8,15,3.2,18,13,20,32]);
      map.setPaintProperty(id, 'line-opacity', casing ? 0.55 : 1);
    } catch (e) {}
  }

  // ── Apply ─────────────────────────────────────────────────────────
  // The auto day/night cycle calls this on EVERY frame — ~1,920 times per 32 s
  // sweep — and the expensive half of it does not need that resolution. Each
  // call repaints the whole facade atlas (a 64x64 getImageData readback per
  // pattern, the slowest common canvas2d op on iOS, then a map.updateImage that
  // dirties the sprite atlas and re-renders every pattern-using tile), rebuilds
  // two interpolate expressions, and sweeps setPaintProperty across every
  // basemap layer. Quantising p to 1/128 (0.25 s of cycle time) cuts that from
  // 1,920 heavy passes per sweep to 128 with no visible stepping, while the
  // cheap half — the sky overlay, which has to track the camera — still runs
  // every frame.
  let _lastPq = null;
  const PQ = 128;

  function applyTimeOfDay(map, p, force) {
    if (!map) return;
    const s = presetAt(p);
    window.__todCurrentP = p;

    const pq = Math.round(clamp01(p) * PQ) / PQ;
    const heavy = force === true || _lastPq === null || pq !== _lastPq;
    if (heavy) _lastPq = pq;

    if (!heavy) {
      // Cheap per-frame work only: the sky overlay is camera-dependent and must
      // not be quantised, and the vignette is a single style write.
      if (typeof updateSky === 'function') updateSky(map, p);
      if (typeof setHazeColor === 'function') setHazeColor(s.fog, s.haze);
      const vigFast = document.getElementById('vignette');
      if (vigFast) vigFast.style.opacity = String(s.vignette);
      return;
    }

    if (typeof map.setSky === 'function') {
      // Only three of the seven properties do anything here: fog-color,
      // horizon-fog-blend and fog-ground-blend are terrain-only (measured —
      // sweeping fog-ground-blend 0→1 left every pixel bit-identical), and
      // atmosphere-blend only matters on the globe projection.
      map.setSky({
        'sky-color': s.sky,
        'horizon-color': s.horizon,
        'sky-horizon-blend': s.skyBlend,
      });
    }

    if (typeof map.setLight === 'function') {
      // Position comes from the shared sun (sky.js), so the shading, the ground
      // shadows and the visible disc can never disagree. MapLibre's light
      // position is [radial, azimuthal-from-north, polar-from-straight-up], so
      // polar = 90 - elevation.
      let pos = s.lightPosition;
      if (typeof window.skyBodies === 'function') {
        const sun = window.skyBodies(p).sun;
        pos = [1.25, ((sun.az % 360) + 360) % 360, clamp01((90 - sun.elev) / 180) * 180];
      }
      map.setLight({ anchor:'map', color:s.lightColor, intensity:s.lightIntensity, position:pos });
    }

    // Walls carry their colour inside the facade pattern; repaint the atlas.
    if (!window.__debugActive && typeof updateFacades === 'function') updateFacades(map, p);
    // Roof caps stay on baked per-feature colours.
    if (!window.__debugActive) {
      safePaint(map, 'buildings-roof','fill-extrusion-color', bakedColor(p,'rd','rg','rn'));
      safePaint(map, 'parts-roof',    'fill-extrusion-color', bakedColor(p,'rd','rg','rn'));
    }

    if (typeof updateShadows === 'function') updateShadows(map, p);

    safePaint(map, 'trees-canopy', 'fill-extrusion-color', s.canopy);
    safePaint(map, 'trees-trunk',  'fill-extrusion-color', s.trunk);
    safePaint(map, 'landscape-pitch',    'fill-color', s.pitch);
    safePaint(map, 'landscape-fountain', 'fill-color', s.fountain);

    for (const id of _bgLayers)    safePaint(map, id, 'background-color', s.ground);
    for (const id of _groundFills) safePaint(map, id, 'fill-color',       s.ground);
    for (const id of _parkFills)   safePaint(map, id, 'fill-color',       s.park);
    for (const id of _waterFills)  safePaint(map, id, 'fill-color',       s.water);
    for (const id of _waterLines)  safePaint(map, id, 'line-color',       s.water);
    for (const id of _roadLines)   safePaint(map, id, 'line-color', _casings.has(id) ? s.roadCasing : s.road);

    safePaint(map, 'buildings-labels', 'text-halo-color', s.labelHalo);

    // Curated branded landmark signs (signs.js) — glow + ground light pools.
    if (typeof applySignGlowLayer === 'function') applySignGlowLayer(map, s.signGlow, p);

    if (typeof setHazeColor === 'function') setHazeColor(s.fog, s.haze);
    if (typeof updateSky === 'function') updateSky(map, p);

    const vig = document.getElementById('vignette');
    if (vig) vig.style.opacity = String(s.vignette);
  }

  function safePaint(map, id, prop, val) {
    try { if (map.getLayer && !map.getLayer(id)) return; map.setPaintProperty(id, prop, val); } catch(e) {}
  }

  // ── UI ────────────────────────────────────────────────────────────
  let _autoRaf=null, _autoDir=1;
  const AUTO_PER_MS = 1/32000;

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
    if (play) { play.textContent = '❚❚'; play.classList.add('playing'); }
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
    if (play) { play.textContent = '▶'; play.classList.remove('playing'); }
  }

  window.TOD_DEFAULT_P   = TOD_DEFAULT_P;
  window.cleanupBasemap  = cleanupBasemap;
  window.applyTimeOfDay  = applyTimeOfDay;
  window.initTimeOfDayUI = initTimeOfDayUI;
})();
