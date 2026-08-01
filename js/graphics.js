/**
 * graphics.js — the post-process stack, and a menu to drive it
 *
 * MapLibre gives you no shader hooks: you cannot insert a pass into its pipeline
 * and you cannot read its framebuffer without `preserveDrawingBuffer`, which
 * costs a full-frame copy on every draw. So the "RTX" layer here is built the way
 * a compositor can do it for free — as blend layers stacked over the WebGL
 * canvas:
 *
 *   downscale + threshold + blur + add -> bloom      (canvas, from the GL canvas)
 *   additive wedges from the sun       -> god rays   (canvas)
 *   ghosts + anamorphic streak         -> lens flare (canvas)
 *   masked blur at the horizon         -> aerial DOF (CSS backdrop-filter)
 *   tonemap/exposure/saturation        -> grade      (CSS filter on #map)
 *   overlay noise                      -> film grain (tiled canvas)
 *
 * BLOOM: CSS CANNOT DO THIS, and the way it fails is worth writing down. The
 * obvious trick is one full-screen div with
 * `backdrop-filter: brightness(.45) contrast(4) blur(25px)` and
 * `mix-blend-mode: screen` — threshold, blur, add, all in the compositor, free.
 * It does not work. Chrome paints the filtered backdrop as the element's own
 * content and the blend mode never gets to add it back, so instead of light on
 * top of the frame you get a crushed, dark, BLURRED copy laid over it at the
 * element's opacity. Rendered side by side the whole city went muddy brown and
 * soft — a screen blend can only ever lighten, so "it got darker" was proof the
 * blend was not happening.
 *
 * So bloom is done for real: copy the GL canvas into a 256-px-wide scratch canvas
 * with `filter = brightness(t) contrast(4) blur(r)` (that one drawImage does the
 * downscale, the threshold and the blur at once), then composite it back up over
 * the frame with `globalCompositeOperation = 'lighter'`. Cheap because the blur
 * happens at 1/10 resolution, which is also where a bloom belongs.
 *
 * The catch is that reading the GL canvas needs `preserveDrawingBuffer`, which
 * cannot be changed on a live context. So it is switched on at construction
 * whenever the SAVED bloom setting is above zero, and turning bloom on from zero
 * asks for a reload — the same deal as MSAA. Measured cost of the buffer plus the
 * pass, flying at 2560x1400: 56.8 -> 46.0 fps.
 *
 * EVERY effect here costs fill rate, and this app was already GPU-bound before
 * any of them existed: measured at 2560x1400 the baseline dropped 53.6% of its
 * frames while flying. So each one is individually switchable, presets exist, the
 * first run auto-detects, and the menu shows live fps — turning an effect on and
 * watching what it costs is the whole point.
 *
 * Public (window) API:
 *   GFX                      — the live settings object (read by sky.js, app.js)
 *   initGraphics(map)        — build the DOM, restore settings, wire the menu
 *   renderFX(map, skyFrame)  — per-frame pass, called by sky.js
 *   applyGraphics()          — push settings to the map/CSS after a change
 *   setGrade(grade)          — time-of-day grade, called by timeofday.js
 *   GFX_MSAA                 — read by app.js at map construction
 */
(function () {
  'use strict';

  const KEY = 'austin3d.gfx.v1';
  const clamp01 = v => Math.max(0, Math.min(1, v));

  // ── Settings ──────────────────────────────────────────────────────
  // `renderScale` multiplies devicePixelRatio: 0.75 on a 2x display still draws
  // 1.5x native. It is the master lever — cost scales with its square.
  const SCHEMA = [
    { key: 'renderScale', label: 'Render scale',   min: 0.5,  max: 2,   step: 0.05, group: 'perf', fmt: v => v.toFixed(2) + '×' },
    { key: 'msaa',        label: 'Anti-aliasing',  type: 'bool', group: 'perf', reload: true,
      hint: 'MSAA. The most expensive single option: turning it off cut dropped frames from 128 to 53 in a 4 s flight at 2560×1400.' },
    { key: 'bloom',       label: 'Bloom',          min: 0, max: 1, step: 0.02, group: 'lens' },
    { key: 'godRays',     label: 'God rays',       min: 0, max: 1, step: 0.02, group: 'lens' },
    { key: 'flare',       label: 'Lens flare',     min: 0, max: 1, step: 0.02, group: 'lens' },
    { key: 'dof',         label: 'Distance blur',  min: 0, max: 1, step: 0.02, group: 'lens' },
    { key: 'exposure',    label: 'Exposure',       min: 0.7, max: 1.4, step: 0.01, group: 'grade' },
    { key: 'autoExposure', label: 'Auto exposure', type: 'bool', group: 'grade',
      hint: 'Nudges exposure toward the hour’s typical brightness, metered from the rendered frame. Needs the preserved buffer bloom uses (reload with bloom > 0).' },
    { key: 'contrast',    label: 'Contrast',       min: 0.8, max: 1.5, step: 0.01, group: 'grade' },
    { key: 'saturation',  label: 'Saturation',     min: 0.6, max: 1.6, step: 0.01, group: 'grade' },
    { key: 'filmic',      label: 'Filmic curve',   min: 0, max: 1, step: 0.02, group: 'grade',
      hint: 'Tone curve with a toe and a shoulder: highlights roll off instead of clipping to flat white, shadows keep detail instead of crushing to black.' },
    { key: 'vignette',    label: 'Vignette',       min: 0, max: 1.6, step: 0.02, group: 'grade' },
    { key: 'grain',       label: 'Film grain',     min: 0, max: 1, step: 0.02, group: 'grade' },
    { key: 'ao',          label: 'Contact shadows', type: 'bool', group: 'world' },
    { key: 'shadows',     label: 'Sun shadows',    type: 'bool', group: 'world' },
    { key: 'treeDensity', label: 'Tree density',   min: 0.2, max: 1, step: 0.025, group: 'world',
      fmt: v => Math.round(v * 100) + '%',
      hint: 'Thins the small trees first and keeps the big live oaks. The full 2,572 trees cost about 6–7 fps at 1440×900; this is the knob for that, rather than dropping a region.' },
    { key: 'outerDensity', label: 'Outer city',    min: 0.2, max: 1, step: 0.025, group: 'world',
      fmt: v => Math.round(v * 100) + '%',
      hint: 'The rest of Austin outside the modelled core — downtown, the lake, the neighbourhoods. Thins the small and the far first; the downtown towers rank in the top 2% and are never dropped. Turning it to 20% is the cheapest way to buy frames back on a weak GPU.' },
    { key: 'clouds',      label: 'Clouds',         min: 0, max: 1, step: 0.05, group: 'world' },
    { key: 'stars',       label: 'Stars',          min: 0, max: 1, step: 0.05, group: 'world' },
    { key: 'fov',         label: 'Field of view',  min: 42, max: 82, step: 1, group: 'world', fmt: v => v.toFixed(0) + '°' },
    { key: 'renderDistance', label: 'Render distance', min: 400, max: 4000, step: 50, group: 'perf',
      fmt: v => v >= 4000 ? 'unlimited' : (v >= 1000 ? (v / 1000).toFixed(1) + ' km' : v.toFixed(0) + ' m'),
      hint: 'How far from the camera fine detail is still drawn. Detail is dropped by whole draw passes, not by feature — measured at +6.0 fps (31.0 -> 37.0, dropped frames 135 -> 109) with both tiers off, which beat renderScale 0.75 on the same machine. Lower it first on a weak GPU.' },
  ];
  const GROUPS = [
    ['perf',  'Performance'],
    ['lens',  'Light & lens'],
    ['grade', 'Colour & film'],
    ['world', 'World'],
  ];

  // ── The grade is NOT a quality setting ──────────────────────────────
  //
  // A preset picks how much work the GPU does. It must not change what colour
  // the city is. It used to: saturation ran 1.00 / 1.10 / 1.18 / 1.20 across the
  // four presets and contrast 1.00 / 1.06 / 1.12 / 1.14, so turning the quality
  // up also turned the colour up, and a machine that could only run
  // `performance` saw a different-looking Austin from one that could run
  // `ultra`. Reported as "higher graphics presets change the color character".
  //
  // These values multiply the HOUR's authored grade (js/timeofday.js PRESETS),
  // which is where the look actually lives — applyGrade() computes
  // `grade.saturation * GFX.saturation`. Holding this block constant means the
  // hour alone decides colour, at every preset.
  //
  // TASTE: `saturation: 1.0` means "the authored hour, unmodified" — that is
  // what natural means here. The old default multiplied it by 1.1. One number
  // to change if it should be richer, and it changes everywhere at once, which
  // is the point.
  const GRADE = {
    exposure: 1.03,
    contrast: 1.06,
    saturation: 1.0,
    filmic: 0.65,
    vignette: 1.0,
  };

  // `autoExposure` is deliberately NOT in GRADE, and it is the one honest
  // exception to "presets never change colour".
  //
  // It cannot be free: GFX_PDB (line ~172) requests `preserveDrawingBuffer`
  // whenever auto-exposure is on, so sharing it would force the preserved
  // buffer onto the `performance` preset — the one that exists for machines
  // already dropping frames. And it does not change the authored look anyway:
  // its correction has a log-space KNEE of 0.16, so any pose within ~±17% of
  // the hour's measured target gets NO correction at all, and settled poses
  // cluster inside that (day 0.49-0.56, golden 0.49-0.50). It only pulls back
  // when you stare into bright sky and lifts in a dark canyon. That is a
  // corrective, not a look — so `performance` skips it and pays nothing.

  // Grain is deliberately NOT in GRADE. It is a texture effect, not a colour
  // one, and it is the most expensive item in the stack: measured per-effect at
  // 2560x1400, removing it returned 4.8 fps — more than the colour grade (3.8)
  // or the contact shadows (3.6) — because it is a full-screen `overlay` blend
  // running every frame. So it earns its keep at cinematic and stays out of the
  // default that has to feel smooth.
  const PRESETS = {
    performance: {
      renderScale: 0.75, msaa: false, bloom: 0, godRays: 0, flare: 0, dof: 0,
      ...GRADE, autoExposure: false, grain: 0, renderDistance: 900,
      ao: false, shadows: true, clouds: 0.4, stars: 0.5, fov: 58, treeDensity: 0.52, outerDensity: 0.45,
    },
    balanced: {
      renderScale: 1.0, msaa: false, bloom: 0.40, godRays: 0.5, flare: 0.3, dof: 0.30,
      ...GRADE, autoExposure: true, grain: 0, renderDistance: 2000,
      ao: true, shadows: true, clouds: 1, stars: 1, fov: 58, treeDensity: 0.675, outerDensity: 1,
    },
    cinematic: {
      renderScale: 1.0, msaa: false, bloom: 0.62, godRays: 0.78, flare: 0.55, dof: 0.45,
      ...GRADE, autoExposure: true, grain: 0.22, renderDistance: 4000,
      ao: true, shadows: true, clouds: 1, stars: 1, fov: 62, treeDensity: 1, outerDensity: 1,
    },
    ultra: {
      renderScale: 1.5, msaa: true, bloom: 0.72, godRays: 0.9, flare: 0.65, dof: 0.50,
      ...GRADE, autoExposure: true, grain: 0.18, renderDistance: 4000,
      ao: true, shadows: true, clouds: 1, stars: 1, fov: 62, treeDensity: 1, outerDensity: 1,
    },
  };
  window.GFX_GRADE = GRADE;   // read by scripts/verify/preset-colour.mjs

  const GFX = Object.assign({}, PRESETS.balanced, { preset: 'balanced', autoDetected: false });
  window.GFX = GFX;

  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
  if (saved && typeof saved === 'object') {
    for (const s of SCHEMA) if (saved[s.key] !== undefined) GFX[s.key] = saved[s.key];
    if (saved.preset) GFX.preset = saved.preset;
    GFX.autoDetected = !!saved.autoDetected;
  }
  // Read before the map exists — app.js needs both at construction time, and
  // neither `antialias` nor `preserveDrawingBuffer` can be changed on a live
  // WebGL context. Bloom needs to read the GL canvas, so it needs the buffer
  // kept; asking for it only when bloom is actually wanted means the performance
  // preset stops paying for it on the next load.
  window.GFX_MSAA = !!GFX.msaa;
  window.GFX_PDB = GFX.bloom > 0.01 || !!GFX.autoExposure;  // auto-exposure meters the same buffer

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(GFX)); } catch (e) {}
  }

  // ── DOM ───────────────────────────────────────────────────────────
  let _map = null, fxCanvas = null, fx = null, mapCanvas = null;
  let bloomCv = null, bloomCtx = null, bloomOK = false;
  let elDof = null, elGrain = null, elVig = null;
  let grade = { exposure: 1, contrast: 1, saturation: 1, tint: null, vignette: 0.1 };

  // The FX canvas holds nothing but soft gradients — bloom, shafts, flare ghosts
  // — so it is rendered at half linear resolution and CSS-scaled back up. That is
  // invisible in the result and it quarters the texture the compositor has to
  // re-upload every frame. The sky canvas learned the same lesson the expensive
  // way: it was uploading 13.7 MB/frame at 2560x1400, 98% of it empty.
  const FX_SCALE = 0.5;
  const BLOOM_W = 256;

  function el(id, parent) {
    const d = document.createElement('div');
    d.id = id;
    (parent || document.body).appendChild(d);
    return d;
  }

  /**
   * A 50%-grey noise tile. Composited with `overlay`, mid-grey is a no-op and
   * the deviations become grain, so this darkens and lightens symmetrically
   * instead of just fogging the frame.
   */
  function grainTile(size) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const img = g.createImageData(size, size);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 128 + (Math.random() - 0.5) * 150;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c.toDataURL();
  }

  window.initGraphics = function initGraphics(map) {
    _map = map;

    // Order is the post-processing order, bottom to top: distance blur reads the
    // raw geometry, bloom must see the sky overlay and the rays, and the
    // vignette has to survive the bloom that would otherwise re-light the
    // corners it just darkened. Grain goes last, over everything.
    elDof = el('fx-dof');                       // z 2 — under #sky
    fxCanvas = document.createElement('canvas');
    fxCanvas.id = 'fx-canvas';                  // z 6 — bloom/rays over the sky
    document.body.appendChild(fxCanvas);
    fx = fxCanvas.getContext('2d');
    elVig = document.getElementById('vignette');// z 7 (already in the markup)
    elGrain = el('fx-grain');                   // z 8
    elGrain.style.backgroundImage = `url(${grainTile(128)})`;

    mapCanvas = map.getCanvas();
    bloomCv = document.createElement('canvas');
    bloomCtx = bloomCv.getContext('2d');

    // Did we actually get the buffer we asked for? Don't assume — if bloom is
    // turned on mid-session the context was created without it and the copy
    // would come back solid black, which looks exactly like "bloom is subtle".
    try {
      const gl = mapCanvas.getContext('webgl2') || mapCanvas.getContext('webgl');
      bloomOK = !!(gl && gl.getContextAttributes().preserveDrawingBuffer);
    } catch (e) { bloomOK = false; }
    if (!bloomOK) console.log('[graphics] bloom unavailable: this context has no preserveDrawingBuffer (reload with bloom > 0)');

    buildMenu();
    applyGraphics();
    if (!GFX.autoDetected) scheduleAutoDetect();
  };

  // ── Apply ─────────────────────────────────────────────────────────
  window.applyGraphics = function applyGraphics() {
    if (!_map) return;

    // Render scale. MapLibre takes an absolute ratio, so multiply the device's.
    const dpr = window.devicePixelRatio || 1;
    if (typeof _map.setPixelRatio === 'function') {
      const want = +(dpr * GFX.renderScale).toFixed(3);
      if (Math.abs((_map.getPixelRatio ? _map.getPixelRatio() : dpr) - want) > 0.001) {
        try { _map.setPixelRatio(want); } catch (e) {}
      }
    }

    if (typeof _map.setVerticalFieldOfView === 'function' &&
        Math.abs(_map.getVerticalFieldOfView() - GFX.fov) > 0.01) {
      try { _map.setVerticalFieldOfView(GFX.fov); } catch (e) {}
    }

    setLayers(['buildings-ao', 'parts-ao'], GFX.ao);
    setLayers(['buildings-shadow'], GFX.shadows);
    // Tree density is a filter on a keep-order baked into the data, so lowering
    // it thins the small trees and keeps the big oaks rather than clipping a
    // region away. See window.treeFilter in app.js.
    if (typeof window.applyTreeDensity === 'function') window.applyTreeDensity(_map);
    // Same idea one scale up: the outer ring is filtered on a baked importance
    // rank, so this thins the small and the far and never the skyline.
    // See js/outer.js:densityFilter.
    if (typeof window.applyOuterSettings === 'function') window.applyOuterSettings(_map);
    // Render distance: whole detail passes on or off (js/lod.js).
    if (typeof window.applyLOD === 'function') window.applyLOD(_map);
    if (typeof window.applyGroundSettings === 'function') window.applyGroundSettings(_map);

    applyGrade();
    applyGrain();

    // An element with no work to do is display:none, not opacity:0 — a
    // zero-opacity full-screen blend layer is still a full-screen blend layer to
    // the compositor.
    if (elDof) elDof.style.display = GFX.dof > 0.01 ? 'block' : 'none';
    if (fxCanvas) fxCanvas.style.display = fxWanted() ? 'block' : 'none';

    // Bloom asked for after the context was built without preserveDrawingBuffer
    // needs a reload to take effect. Say so rather than drawing nothing.
    if (GFX.bloom > 0.01 && !bloomOK) markReload();

    save();
    if (typeof window.updateSky === 'function' && _map)
      window.updateSky(_map, window.__todCurrentP != null ? window.__todCurrentP : 0.3);
  };

  function setLayers(ids, on) {
    for (const id of ids) {
      try {
        if (_map.getLayer && _map.getLayer(id))
          _map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
      } catch (e) {}
    }
  }

  /** Time-of-day grade, multiplied by the user's offsets. */
  window.setGrade = function setGrade(g) {
    grade = Object.assign({}, grade, g || {});
    applyGrade();
  };

  // ── Filmic tone curve ─────────────────────────────────────────────
  // `brightness() contrast()` is a straight line through [0,1] that CLIPS both
  // ends: with exposure 1.05 x contrast 1.12 everything above ~0.90 lands on
  // flat 255 (the golden-hour horizon was a plateau with zero gradient) and
  // shadows crush symmetrically to flat 0. A film curve instead has a TOE
  // (shadows compress gently, keeping detail) and a SHOULDER (highlights roll
  // off asymptotically, never slamming into white).
  //
  // CSS has no LUT primitive, but SVG filters do: feComponentTransfer
  // type="table" is a per-channel lookup table, and `filter: url(#a3d-tone)`
  // chains it with the other CSS filter functions. So exposure, contrast AND
  // the curve are baked into ONE table here — that matters, because CSS filter
  // functions clamp between stages, so a separate brightness() would have
  // already destroyed the overshoot the shoulder exists to recover.
  //
  // The curve: IDENTITY through the mid-band, a cubic-Hermite shoulder above
  // SHOULDER_AT and a cubic-Hermite toe below TOE_AT, each with slope 1 at the
  // join so the transition is invisible. The first cut used a tanh S-curve
  // through a pivot instead — its slope at the pivot was 1.5, which re-graded
  // every midtone (measured: night city mean 46 -> 16, day city -16%). The hour
  // grades are already tuned; the curve's ONLY job is to rescue the ends.
  const TONE = {
    SAMPLES: 33,        // LUT resolution; feComponentTransfer lerps between entries
    TOE_AT: 0.14,       // below this the toe starts (display-linear units)
    SHOULDER_AT: 0.72,  // above this the shoulder starts
    OVER: 1.28,         // highlight headroom: linear values up to this stay distinct
    UNDER: -0.10,       // shadow headroom for contrast-crushed negatives
    FLOOR: 0.010,       // what the deepest shadow maps to (a lifted, detailed black)
    END_SLOPE: 0.06,    // curve slope at the far ends (0 = hard plateau again)
  };
  let toneFuncs = null, toneLast = null;

  function ensureToneFilter() {
    if (toneFuncs) return true;
    try {
      const NS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('width', '0');
      svg.setAttribute('height', '0');
      svg.style.cssText = 'position:absolute;left:-9999px;top:-9999px';
      const filter = document.createElementNS(NS, 'filter');
      filter.setAttribute('id', 'a3d-tone');
      // sRGB, not the SVG default linearRGB: the grade is authored against the
      // frame as displayed, and linearRGB silently re-lights the whole scene.
      filter.setAttribute('color-interpolation-filters', 'sRGB');
      const fct = document.createElementNS(NS, 'feComponentTransfer');
      toneFuncs = ['feFuncR', 'feFuncG', 'feFuncB'].map(tag => {
        const f = document.createElementNS(NS, tag);
        f.setAttribute('type', 'table');
        f.setAttribute('tableValues', '0 1');
        fct.appendChild(f);
        return f;
      });
      filter.appendChild(fct);
      svg.appendChild(filter);
      document.body.appendChild(svg);
      return true;
    } catch (e) { toneFuncs = null; return false; }
  }

  /** Cubic Hermite on [0,1] with g(0)=0, g(1)=1 and given end slopes. */
  function hermite01(t, m0, m1) {
    const t2 = t * t, t3 = t2 * t;
    return (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) + (t3 - t2) * m1;
  }

  /** The filmic map for one unclamped display-linear value. */
  function toneCurve(lin) {
    const T = TONE;
    if (lin >= T.SHOULDER_AT) {
      // [SHOULDER_AT .. OVER] -> [SHOULDER_AT .. 1], slope 1 at the join.
      const t = Math.min(1, (lin - T.SHOULDER_AT) / (T.OVER - T.SHOULDER_AT));
      const m0 = (T.OVER - T.SHOULDER_AT) / (1 - T.SHOULDER_AT);   // slope 1 in display units
      return T.SHOULDER_AT + (1 - T.SHOULDER_AT) * hermite01(t, m0, T.END_SLOPE);
    }
    if (lin <= T.TOE_AT) {
      // [UNDER .. TOE_AT] -> [FLOOR .. TOE_AT], slope 1 at the join.
      const t = Math.max(0, (lin - T.UNDER) / (T.TOE_AT - T.UNDER));
      const m1 = (T.TOE_AT - T.UNDER) / (T.TOE_AT - T.FLOOR);      // slope 1 in display units
      return T.FLOOR + (T.TOE_AT - T.FLOOR) * hermite01(t, T.END_SLOPE, m1);
    }
    return lin;                                                    // mid-band: identity
  }

  /** exposure+contrast+filmic in one table. Returns false if the SVG route failed. */
  function updateToneLUT(ex, co, strength) {
    if (!ensureToneFilter()) return false;
    const key = `${ex.toFixed(3)}|${co.toFixed(3)}|${strength.toFixed(2)}`;
    if (toneLast === key) return true;
    toneLast = key;
    const vals = [];
    for (let i = 0; i < TONE.SAMPLES; i++) {
      const x = i / (TONE.SAMPLES - 1);
      const lin = (x * ex - 0.5) * co + 0.5;          // UNCLAMPED linear grade
      const out = clamp01(lin) * (1 - strength) + clamp01(toneCurve(lin)) * strength;
      vals.push(out.toFixed(4));
    }
    const table = vals.join(' ');
    for (const f of toneFuncs) f.setAttribute('tableValues', table);
    return true;
  }

  // ── Auto-exposure ─────────────────────────────────────────────────
  // Mean luma is nearly free once the preserved buffer exists for bloom: one
  // 40x24 drawImage of the GL canvas + getImageData per frame. Two design
  // decisions that matter:
  //   1. OPEN LOOP. It meters the RAW frame, before the CSS grade applies the
  //      gain, so the gain cannot feed back on its own output and pump.
  //   2. The target is NOT fixed mid-grey. The day look is intentionally
  //      high-key (raw mean ~0.6) and the night look intentionally dark
  //      (~0.08); a 0.42 target would permanently re-grade both. The target
  //      follows the hour's AUTHORED typical luma, so at a normal flying pose
  //      the gain sits at ~1.0 and it only corrects DEVIATIONS — staring into
  //      bright sky pulls back, a dark canyon of towers lifts.
  const AE = {
    // Typical RAW frame luma at each hour's spawn pose — measured by
    // light-ae.mjs on SETTLED, idle frames, not guessed. (A 0.075 night guess
    // pegged the clamp; a 0.80 day read turned out to be a mid-shadow-load
    // frame. Settled poses across the whole day cluster remarkably tight:
    // day 0.49-0.56, golden 0.49-0.50, night 0.135-0.136 — flat-lit
    // extrusions — so with the knee below, real poses meter as "authored".)
    TARGET_DAY: 0.52,
    TARGET_GOLDEN: 0.50,
    TARGET_NIGHT: 0.135,
    KNEE: 0.16,           // log-space dead zone: deviations within ~±17% of the
                          // hour's target are the AUTHORED look and get NO
                          // correction — only real outliers move the gain
    STRENGTH: 0.7,        // fraction of the beyond-knee correction applied
    TAU_MS: 900,          // EMA time constant of the meter
    MIN: 0.85, MAX: 1.20, // hard gain clamps
    W: 40, H: 24,         // meter buffer
    DEADBAND: 0.006,      // skip the style write for gain moves below this
  };
  let aeCv = null, aeCtx = null, aeLuma = null, aeGain = 1, aeLast = 0;

  function aeMeter(F) {
    if (!(GFX.autoExposure && bloomOK && mapCanvas)) {
      if (aeGain !== 1) { aeGain = 1; aeLuma = null; aeLast = 0; applyGrade(); }
      return;
    }
    const now = performance.now();
    const dt = aeLast ? Math.min(250, now - aeLast) : 16.7;
    aeLast = now;
    if (!aeCv) {
      aeCv = document.createElement('canvas');
      aeCv.width = AE.W; aeCv.height = AE.H;
      aeCtx = aeCv.getContext('2d', { willReadFrequently: true });
    }
    let luma = null;
    try {
      aeCtx.drawImage(mapCanvas, 0, 0, AE.W, AE.H);
      const d = aeCtx.getImageData(0, 0, AE.W, AE.H).data;
      let s = 0;
      for (let i = 0; i < d.length; i += 4) s += d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722;
      luma = s / (255 * (d.length / 4));
    } catch (e) { return; }
    aeLuma = aeLuma == null ? luma : aeLuma + (luma - aeLuma) * (1 - Math.exp(-dt / AE.TAU_MS));
    const target = (AE.TARGET_DAY + (AE.TARGET_GOLDEN - AE.TARGET_DAY) * F.golden) * (1 - F.night)
                 + AE.TARGET_NIGHT * F.night;
    const err = Math.log(target / Math.max(0.02, aeLuma));
    const mag = Math.max(0, Math.abs(err) - AE.KNEE);        // dead zone first
    const g = Math.max(AE.MIN, Math.min(AE.MAX,
      Math.exp(Math.sign(err) * mag * AE.STRENGTH)));
    if (Math.abs(g - aeGain) > AE.DEADBAND) { aeGain = g; applyGrade(); }
  }
  window.__ae = () => ({ gain: aeGain, luma: aeLuma });   // debug/test hook
  // Test hook: the EMA deliberately persists across hour changes in
  // production; a test sampling five poses back to back needs a clean seed.
  window.__aeReset = () => { aeLuma = null; aeLast = 0; };

  function applyGrade() {
    const host = document.getElementById('map');
    if (!host) return;
    const ex = (grade.exposure || 1) * GFX.exposure * aeGain;
    const co = (grade.contrast || 1) * GFX.contrast;
    const sa = (grade.saturation || 1) * GFX.saturation;
    const filmic = GFX.filmic || 0;
    const parts = [];
    if (filmic > 0.01 && updateToneLUT(ex, co, filmic)) {
      // Exposure and contrast live inside the LUT; saturation stays a plain
      // CSS function after it, same relative order as the legacy chain.
      parts.push('url(#a3d-tone)');
      if (Math.abs(sa - 1) > 0.004) parts.push(`saturate(${sa.toFixed(3)})`);
    } else {
      if (Math.abs(ex - 1) > 0.004) parts.push(`brightness(${ex.toFixed(3)})`);
      if (Math.abs(co - 1) > 0.004) parts.push(`contrast(${co.toFixed(3)})`);
      if (Math.abs(sa - 1) > 0.004) parts.push(`saturate(${sa.toFixed(3)})`);
    }
    const filterStr = parts.length ? parts.join(' ') : '';
    if (host.style.filter !== filterStr) host.style.filter = filterStr;
    if (elVig) {
      elVig.style.opacity = String(clamp01((grade.vignette || 0) * GFX.vignette));
      applyVignetteTint();
    }
  }

  // ── Vignette tint by hour ─────────────────────────────────────────
  // One black radial at every hour is a missed cue: real optics go warm-dark
  // at golden hour and blue-black at night, and a plain black corner at
  // midday reads as dirt on the lens. The element's gradient is rewritten
  // inline from these keyframes (style.css keeps the plain-black fallback);
  // its OPACITY stays the hour grade x the user's slider, exactly as before.
  const VIG_HOURS = [
    { p: 0.00, c: [16, 18, 24],  a: 0.42 },   // midday: near-neutral, barely there
    { p: 0.35, c: [26, 16, 8],   a: 0.55 },
    { p: 0.50, c: [40, 15, 2],   a: 0.72 },   // golden: warm-dark
    { p: 0.68, c: [18, 10, 26],  a: 0.68 },   // dusk: violet
    { p: 1.00, c: [3, 6, 20],    a: 0.74 },   // night: blue-black
  ];
  const VIG_INNER = 54;      // % radius where the tint starts (0 in the centre)
  const VIG_PQ = 96;         // p quantisation for the style rewrite
  let vigLastQ = null;

  function applyVignetteTint() {
    const p = clamp01(window.__todCurrentP != null ? window.__todCurrentP : 0.3);
    const q = Math.round(p * VIG_PQ);
    if (q === vigLastQ) return;
    vigLastQ = q;
    let a = VIG_HOURS[0], b = VIG_HOURS[VIG_HOURS.length - 1], t = 0;
    for (let i = 1; i < VIG_HOURS.length; i++) {
      if (p <= VIG_HOURS[i].p) {
        a = VIG_HOURS[i - 1]; b = VIG_HOURS[i];
        t = (p - a.p) / (b.p - a.p);
        break;
      }
    }
    const c = [0, 1, 2].map(i => Math.round(a.c[i] + (b.c[i] - a.c[i]) * t));
    const al = (a.a + (b.a - a.a) * t).toFixed(3);
    elVig.style.background =
      `radial-gradient(ellipse at center, rgba(0,0,0,0) ${VIG_INNER}%, ` +
      `rgba(${c[0]},${c[1]},${c[2]},${al}) 100%)`;
  }

  function fxWanted() {
    return (GFX.bloom > 0.01 && bloomOK) || GFX.godRays > 0.01 || GFX.flare > 0.01;
  }

  function applyGrain() {
    if (!elGrain) return;
    if (GFX.grain <= 0.01) { elGrain.style.display = 'none'; return; }
    elGrain.style.display = 'block';
    elGrain.style.opacity = (GFX.grain * 0.5).toFixed(3);
  }

  // ── Per-frame pass ────────────────────────────────────────────────
  // Taste values for the rays/flare pass, exposed as window.FX_TUNE so any of
  // them can be overruled live from the console with a one-line edit.
  const FX_TUNE = {
    RAYS: {
      ANISO: 0.85,     // 0 = uniform starburst fan, 1 = fully horizon-weighted
      HORIZ_EXP: 2.4,  // falloff of wedge alpha with angle from horizontal
      UP_FACTOR: 0.5,  // upward wedges keep this fraction (shafts streak side/down)
      GAIN: 1.35,      // compensates the light the anisotropy removes
    },
    GHOSTS: {
      SKY_DAMP: 0.35,  // ghosts above the horizon dim by this (second-sun fix)
    },
  };
  window.FX_TUNE = FX_TUNE;

  let grainStep = 0;

  window.renderFX = function renderFX(map, F) {
    if (!F) return;

    aeMeter(F);

    // Distance blur: strongest at the horizon, gone by mid-frame. This is the
    // only depth cue available without a depth buffer, and it happens to match
    // what aerial haze does anyway, so it reads as distance rather than as blur.
    if (elDof && GFX.dof > 0.01) {
      const hz = F.horizonPx;
      // Was `hz < -40`. js/sky.js collapses its own canvas clip once the horizon
      // is above -0.018*H (about -16 px at 900), so between those two thresholds
      // there was a ~1.25 degree window of pitch where the sky had stopped
      // decorating but this band had not stopped drawing — and with the horizon
      // off the top of the viewport, `top` clamps to 0 and the blur pins itself
      // across the top quarter of the frame with nothing but sky in it. That is
      // the "pink gap between the actual horizon and where the line begins" that
      // opens as you gain altitude.
      //
      // Above the viewport there is no ground band to blur, so the honest value
      // is zero.
      if (hz < 0 || hz > F.H) {
        elDof.style.opacity = '0';
      } else {
        const top = Math.max(0, hz);
        // 0.34H from the horizon is not "the distance" at a high pitch — it is
        // the whole mid-ground, and it was visibly blurring buildings you were
        // flying past.
        const h = Math.min(F.H - top, 0.24 * F.H);
        elDof.style.opacity = '1';
        elDof.style.top = top.toFixed(0) + 'px';
        elDof.style.height = h.toFixed(0) + 'px';
        elDof.style.backdropFilter = elDof.style.webkitBackdropFilter =
          `blur(${(0.9 + 3.0 * GFX.dof).toFixed(2)}px)`;
      }
    }

    if (elGrain && GFX.grain > 0.01) {
      // Cycled from the render pass rather than its own rAF: a dedicated loop
      // would force a compositor frame forever, including when the camera is
      // parked, for a effect nobody looks at while nothing moves.
      grainStep = (grainStep + 1) % 7;
      const o = [0, 37, 71, 113, 17, 89, 53][grainStep];
      elGrain.style.backgroundPosition = `${o}px ${(o * 3) % 128}px`;
    }

    if (!fxCanvas) return;
    const S = F.sun;
    // Rays and ghosts need the sun itself in frame. Below the horizon there is
    // no disc to shaft from, and the moon does not throw god rays.
    const sunLive = S.front && S.elev > -1 && S.fade > 0.02 && !F.moonUp;
    const wantBloom = GFX.bloom > 0.01 && bloomOK;
    const wantRays = sunLive && (GFX.godRays > 0.01 || GFX.flare > 0.01);

    if (!wantBloom && !wantRays) {
      // Clear ONCE, then leave it alone: clearing an untouched canvas every frame
      // still dirties it and forces a fresh upload.
      if (fxCanvas.dataset.blank !== '1') {
        fx.setTransform(1, 0, 0, 1, 0, 0);
        fx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
        fxCanvas.dataset.blank = '1';
      }
      return;
    }
    fxCanvas.dataset.blank = '0';

    if (fxCanvas.width !== Math.round(F.W * FX_SCALE) || fxCanvas.height !== Math.round(F.H * FX_SCALE)) {
      fxCanvas.width = Math.round(F.W * FX_SCALE);
      fxCanvas.height = Math.round(F.H * FX_SCALE);
      fxCanvas.style.width = F.W + 'px';
      fxCanvas.style.height = F.H + 'px';
    }
    // Draw in CSS pixels regardless of the backing scale.
    fx.setTransform(FX_SCALE, 0, 0, FX_SCALE, 0, 0);
    fx.clearRect(0, 0, F.W, F.H);
    fx.globalCompositeOperation = 'lighter';

    // ── Bloom ──
    // One drawImage does the downscale, the highlight threshold and the blur
    // together; a second adds it back over the frame. The threshold is what makes
    // this a bloom and not a haze — without the crush, shadows lift as much as
    // highlights.
    if (wantBloom) {
      const bh = Math.max(48, Math.round(BLOOM_W * F.H / Math.max(1, F.W)));
      if (bloomCv.width !== BLOOM_W || bloomCv.height !== bh) { bloomCv.width = BLOOM_W; bloomCv.height = bh; }
      const a = GFX.bloom;
      // `contrast(4)` maps out = 4*in - 1.5, so after `brightness(t)` only inputs
      // above 0.375/t survive at all. That threshold is the difference between a
      // bloom and a haze, and it is easy to get wrong in BOTH directions:
      //   t = 0.50  -> keeps everything above 0.75. Golden hour (R near 1.0 over
      //               half the frame) came through as one orange wash that
      //               bleached the mid-distance city white.
      //   t = 0.404 -> keeps only above 0.93, which nothing in a DAYTIME frame
      //               reaches: the pale sky tops out around 0.91, so bloom
      //               silently did nothing for most of the day. Caught by a test
      //               that checks day and golden separately.
      // ~0.48 keeps the top fifth of the range. The bleaching turned out to be
      // the alpha (0.89, now 0.4), not the threshold.
      const thr = 0.50 - 0.04 * a;
      const blur = (2.2 + 4.0 * a).toFixed(2);   // in 256-px space: ~10x that on screen
      bloomCtx.setTransform(1, 0, 0, 1, 0, 0);
      bloomCtx.globalCompositeOperation = 'source-over';
      bloomCtx.clearRect(0, 0, BLOOM_W, bh);
      bloomCtx.filter = `brightness(${thr.toFixed(2)}) contrast(4) saturate(1.3) blur(${blur}px)`;
      try { bloomCtx.drawImage(mapCanvas, 0, 0, BLOOM_W, bh); } catch (e) { bloomOK = false; }
      bloomCtx.filter = 'none';
      // 0.45 + 0.75a put cinematic at 0.89 and buried the city under its own
      // highlights. Bloom is a highlight lift, not a second exposure.
      fx.globalAlpha = Math.min(1, 0.16 + 0.38 * a);
      fx.drawImage(bloomCv, 0, 0, F.W, F.H);
      fx.globalAlpha = 1;
    }

    if (!wantRays) { fx.globalCompositeOperation = 'source-over'; return; }

    const col = F.haloColour;
    const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
    const diag = Math.hypot(F.W, F.H);

    // Shafts are a low-sun phenomenon; a noon sun does not throw visible rays,
    // it just glares. Ramp them in as the sun drops below ~35 deg.
    const lowSun = clamp01(1 - Math.max(0, S.elev) / 35);
    const rayA = GFX.godRays * S.fade * (0.16 + 0.5 * lowSun) * (0.5 + 0.5 * F.golden);

    if (rayA > 0.004) {
      const N = 22;
      const T = FX_TUNE.RAYS;
      // The sun's azimuth seeds the ray phase, so the fan rotates with the sun
      // over the day instead of being welded to the screen.
      const phase = S.az * 0.031;
      for (let i = 0; i < N; i++) {
        const t = i / N;
        const ang = t * Math.PI * 2 + phase;
        // Deterministic per-ray variation — no Math.random, or the fan would
        // hiss with noise every frame.
        const j = Math.sin(i * 12.9898 + 4.1) * 0.5 + 0.5;
        const k = Math.sin(i * 78.233 + 1.7) * 0.5 + 0.5;
        const len = diag * (0.30 + 0.90 * j);
        const halfW = (0.004 + 0.016 * k) * diag;
        // Shafts from a low sun streak sideways and down, they do not radiate
        // uniformly — a uniform fan reads as a starburst sticker. Weight each
        // wedge by its angle from horizontal (canvas y grows DOWN, so
        // sin(ang) < 0 is an upward wedge).
        const sinA = Math.sin(ang);
        const wHor = Math.pow(1 - Math.abs(sinA), T.HORIZ_EXP);
        const wDir = wHor * (sinA < 0 ? T.UP_FACTOR : 1);
        const w = (1 - T.ANISO) + T.ANISO * wDir;
        const a = rayA * T.GAIN * (0.22 + 0.55 * k) * w;
        if (a < 0.003) continue;
        fx.save();
        fx.translate(S.x, S.y);
        fx.rotate(ang);
        const g = fx.createLinearGradient(0, 0, len, 0);
        // Falls off fast. A shaft is brightest in the first fifth of its
        // length; the old slow ramp is what made the fan read as a ring of hard
        // triangles instead of light.
        g.addColorStop(0, rgba(col, a));
        g.addColorStop(0.14, rgba(col, a * 0.46));
        g.addColorStop(0.42, rgba(col, a * 0.13));
        g.addColorStop(1, rgba(col, 0));
        fx.fillStyle = g;
        fx.beginPath();
        fx.moveTo(0, 0);
        fx.lineTo(len, -halfW);
        fx.lineTo(len, halfW);
        fx.closePath();
        fx.fill();
        fx.restore();
      }
    }

    const flA = GFX.flare * S.fade;
    if (flA > 0.004) {
      // Anamorphic streak. One horizontal bar through the disc — the single most
      // recognisable "this is a camera looking at a light" cue there is.
      const sw = diag * (0.30 + 0.55 * F.golden);
      const sh = Math.max(2, 0.004 * diag);
      const g = fx.createLinearGradient(S.x - sw, 0, S.x + sw, 0);
      g.addColorStop(0, rgba(col, 0));
      g.addColorStop(0.5, rgba(col, flA * 0.36));
      g.addColorStop(1, rgba(col, 0));
      fx.fillStyle = g;
      fx.fillRect(S.x - sw, S.y - sh / 2, sw * 2, sh);

      // Ghosts along the sun -> screen-centre axis, continuing past centre.
      const cx = F.W / 2, cy = F.H / 2;
      const vx = cx - S.x, vy = cy - S.y;
      // The two big warm ghosts used to be [1.05, 0.066, rose] and
      // [1.72, 0.088, warm amber] — at some bearings the amber one landed in
      // open sky as a large soft glow with no streak context and read as a
      // SECOND SUN (orbit-mid.png). Smaller now, and the biggest one is COOL:
      // a blue ghost never reads as a celestial body.
      const GHOSTS = [
        [0.42, 0.048, [120, 190, 255], 0.20],
        [0.72, 0.026, [255, 190, 120], 0.30],
        [1.05, 0.052, [255, 130, 170], 0.13],
        [1.34, 0.034, [150, 255, 215], 0.20],
        [1.72, 0.058, [168, 196, 255], 0.08],
        [2.05, 0.020, [190, 170, 255], 0.24],
      ];
      for (const [k, rf, c, m] of GHOSTS) {
        const gx = S.x + vx * k, gy = S.y + vy * k;
        const r = rf * diag;
        if (gx < -r || gx > F.W + r || gy < -r || gy > F.H + r) continue;
        let a = flA * m;
        // A ghost floating ABOVE the horizon is what creates the second-sun
        // illusion; one overlapping the city reads as a lens artifact. Damp
        // the sky ones instead of deleting them.
        if (gy < F.horizonPx - r * 0.3) a *= FX_TUNE.GHOSTS.SKY_DAMP;
        if (a < 0.003) continue;
        const rg = fx.createRadialGradient(gx, gy, 0, gx, gy, r);
        // Hollow centre with a bright rim — an iris ghost, not a soft blob.
        rg.addColorStop(0, rgba(c, a * 0.30));
        rg.addColorStop(0.72, rgba(c, a * 0.16));
        rg.addColorStop(0.92, rgba(c, a));
        rg.addColorStop(1, rgba(c, 0));
        fx.fillStyle = rg;
        fx.beginPath();
        fx.arc(gx, gy, r, 0, Math.PI * 2);
        fx.fill();
      }
    }

    fx.globalCompositeOperation = 'source-over';
  };

  // ── Auto-detect ───────────────────────────────────────────────────
  // Presets are guesses about a machine we cannot see, so measure instead. Runs
  // once ever (the result is persisted), well after load so tile decoding and
  // the intro tween are not counted as the steady-state cost.
  // Two things this got wrong, both worth remembering.
  //
  // 1. IT MEASURED AN IDLE CAMERA. MapLibre renders nothing when the camera is
  //    parked, so the probe saw a flat 16.7 ms, concluded "60 fps, plenty of
  //    headroom" and UPGRADED to cinematic — on a machine that had just been
  //    described as super laggy while flying. The probe now nudges the bearing by
  //    a hundredth of a degree per frame (alternating, so it nets to zero and is
  //    invisible) to force a real redraw, and skips the nudge if the user is
  //    already flying, which is representative on its own.
  // 2. IT COULD UPGRADE AT ALL. vsync clamps the measurement at 16.7 ms, so
  //    "hits 60 at balanced" and "could run three times that" are
  //    indistinguishable — there is no evidence for an upgrade, only for a
  //    downgrade. Auto-detect now only ever steps DOWN to performance; cinematic
  //    and ultra stay opt-in.
  //
  // It is also cancelled the instant the user touches anything, because a probe
  // that lands 11 seconds in and silently resets a preset the user just picked is
  // worse than no probe at all. (That also made the graphics test flaky: it fired
  // mid-run and put renderScale back, which read as the render-scale lever not
  // working.)
  let autoTimer = null, autoCancelled = false;
  function cancelAutoDetect() {
    autoCancelled = true;
    if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
  }

  /**
   * Measure `ms` of real frame times and return the median, or null if the probe
   * could not gather enough frames. Exposed as `window.__gfxProbe()` so a test can
   * run it in a second instead of waiting out the 11 s delay — waiting was how a
   * broken probe went unnoticed in the first place.
   */
  function measureFrames(ms) {
    return new Promise(resolve => {
      const dts = [];
      let last = null;
      const t0 = performance.now();
      // `driving` also counts an in-flight easeTo: the probe's bearing nudge and
      // snapshot-restore CANCEL an ease (measured: the intro tween froze at
      // bearing 257 of a 250 target). While either is running the camera is
      // already forcing real frames, so the nudge is unnecessary anyway.
      const driving = () => {
        try {
          if (window.__fly && window.__fly.eye().driving) return true;
          return !!(_map && typeof _map.isEasing === 'function' && _map.isEasing());
        } catch (e) { return false; }
      };
      // Snapshot and restore rather than trusting the alternating nudge to cancel:
      // with an odd frame count, or two probes overlapping, it does not. Measured
      // 1.68 deg of leftover drift before this. Restore ONLY if we nudged — an
      // unconditional jumpTo at the end would cancel an ease that started
      // mid-probe and strand the camera off-pose.
      let bearing0 = null, nudged = false, sawEase = false;
      try { bearing0 = _map ? _map.getBearing() : null; } catch (e) {}
      const done = (v) => {
        if (nudged && !sawEase && bearing0 !== null) { try { _map.jumpTo({ bearing: bearing0 }); } catch (e) {} }
        resolve(v);
      };
      const step = ts => {
        if (autoCancelled) return done(null);
        if (last !== null) dts.push(ts - last);
        last = ts;
        try { if (_map && typeof _map.isEasing === 'function' && _map.isEasing()) sawEase = true; } catch (e) {}
        if (_map && !driving()) {
          try { _map.jumpTo({ bearing: bearing0 + (dts.length % 2 ? 0.01 : -0.01) }); nudged = true; } catch (e) {}
        }
        if (performance.now() - t0 < ms) return requestAnimationFrame(step);
        // FOUR frames, not twelve. The first cut demanded 12 and a machine slow
        // enough to miss that — under ~9 fps — got "cannot judge, keep the
        // heavier preset", which is exactly backwards: failing to gather frames
        // IS the measurement. Below 4 there is genuinely nothing to take a median
        // of (a backgrounded tab, a page that never rendered).
        if (dts.length < 4) return done(null);
        const sorted = dts.slice().sort((a, b) => a - b);
        done(sorted[Math.floor(sorted.length / 2)]);
      };
      requestAnimationFrame(step);
    });
  }

  async function runProbe() {
    const med = await measureFrames(1400);
    if (med == null || autoCancelled) {
      console.log('[graphics] auto-detect: not enough frames to judge, keeping ' + GFX.preset);
      return null;
    }
    const fps = 1000 / med;
    GFX.autoDetected = true;
    // Downgrade only — see the note above on why an upgrade is unmeasurable.
    if (med > 21.5 && GFX.preset === 'balanced') {
      usePreset('performance', true);
      toast(`${fps.toFixed(0)} fps measured — switched to the Performance preset. Press G to change.`,
        TOAST_PROBE_MS);
    } else {
      // Changed nothing -> say nothing. The old confirmation toast sat over the
      // hero frame for 5.2 s on every first visit, announcing a no-op.
      save();
    }
    console.log(`[graphics] auto-detect median frame ${med.toFixed(1)} ms (${fps.toFixed(0)} fps) -> ${GFX.preset}`);
    return { med, fps, preset: GFX.preset };
  }
  window.__gfxProbe = runProbe;

  // The probe must not land while a camera ease is in flight: measureFrames'
  // nudge/restore cancels an easeTo mid-tween (measured: the long intro froze
  // at bearing 257 of a 250 target). Deferring — not skipping — keeps the
  // downgrade path alive for weak phones; an ease is real rendering load
  // anyway, so waiting costs nothing.
  const PROBE_DELAY_MS = 11000;   // first attempt; the intro tween runs ~9-11.5 s
  const PROBE_RETRY_MS = 3500;    // re-check cadence while an ease is still running
  const TOAST_PROBE_MS = 2600;    // the downgrade toast (the default hold covered the hero frame)
  const TOAST_DEFAULT_MS = 5200;

  function scheduleAutoDetect(delay) {
    autoTimer = setTimeout(() => {
      autoTimer = null;
      if (autoCancelled) return;
      let easing = false;
      try { easing = !!(_map && typeof _map.isEasing === 'function' && _map.isEasing()); } catch (e) {}
      if (easing) { scheduleAutoDetect(PROBE_RETRY_MS); return; }
      runProbe();
    }, delay == null ? PROBE_DELAY_MS : delay);
  }

  function toast(msg, ms) {
    let t = document.getElementById('gfx-toast');
    if (!t) t = el('gfx-toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), ms == null ? TOAST_DEFAULT_MS : ms);
  }
  window.__gfxToast = toast;      // debug/test hook

  // ── Menu ──────────────────────────────────────────────────────────
  let panel = null, rows = {}, fpsRaf = null;

  function usePreset(name, keepAuto) {
    const p = PRESETS[name];
    if (!p) return;
    if (!keepAuto) cancelAutoDetect();
    const msaaWas = GFX.msaa;
    Object.assign(GFX, p);
    GFX.preset = name;
    if (!keepAuto) GFX.autoDetected = true;
    applyGraphics();
    syncMenu();
    if (GFX.msaa !== msaaWas) markReload();
  }

  function markReload() {
    const b = document.getElementById('gfx-reload');
    if (b) b.classList.add('show');
  }

  function buildMenu() {
    const btn = document.createElement('button');
    btn.id = 'gfx-button';
    btn.title = 'Graphics settings (G)';
    btn.setAttribute('aria-label', 'Graphics settings');
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">' +
      '<circle cx="12" cy="12" r="3.1"/><path d="M12 2.6v3M12 18.4v3M2.6 12h3M18.4 12h3' +
      'M5.4 5.4l2.1 2.1M16.5 16.5l2.1 2.1M18.6 5.4l-2.1 2.1M7.5 16.5l-2.1 2.1"/></svg>';
    document.body.appendChild(btn);

    panel = el('gfx-panel');
    panel.classList.add('hidden');

    const head = document.createElement('div');
    head.id = 'gfx-head';
    head.innerHTML = '<span id="gfx-title">Graphics</span>' +
      '<span id="gfx-fps">—</span>' +
      '<button id="gfx-close" title="Close">✕</button>';
    panel.appendChild(head);

    const presetRow = document.createElement('div');
    presetRow.id = 'gfx-presets';
    for (const name of Object.keys(PRESETS)) {
      const b = document.createElement('button');
      b.className = 'gfx-preset';
      b.dataset.preset = name;
      b.textContent = name[0].toUpperCase() + name.slice(1);
      b.addEventListener('click', () => usePreset(name));
      presetRow.appendChild(b);
    }
    panel.appendChild(presetRow);

    const body = document.createElement('div');
    body.id = 'gfx-body';
    panel.appendChild(body);

    for (const [gid, gLabel] of GROUPS) {
      const h = document.createElement('div');
      h.className = 'gfx-group';
      h.textContent = gLabel;
      body.appendChild(h);
      for (const s of SCHEMA.filter(x => x.group === gid)) body.appendChild(makeRow(s));
    }

    const foot = document.createElement('div');
    foot.id = 'gfx-foot';
    foot.innerHTML =
      '<button id="gfx-reload" title="Anti-aliasing changes need a new WebGL context">Reload to apply AA</button>' +
      '<button id="gfx-reset">Reset</button>';
    panel.appendChild(foot);

    foot.querySelector('#gfx-reset').addEventListener('click', () => usePreset('balanced'));
    foot.querySelector('#gfx-reload').addEventListener('click', () => location.reload());
    head.querySelector('#gfx-close').addEventListener('click', () => toggle(false));
    btn.addEventListener('click', () => toggle(panel.classList.contains('hidden')));

    // `G` is a settings key, not a movement key, so it does not collide with
    // WASD/QE. Ignore it while a control has focus or the slider would eat it.
    window.addEventListener('keydown', e => {
      if (e.key !== 'g' && e.key !== 'G') return;
      const t = e.target;
      if (t && /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(t.tagName)) return;
      toggle(panel.classList.contains('hidden'));
    });

    syncMenu();
  }

  function makeRow(s) {
    const row = document.createElement('label');
    row.className = 'gfx-row';
    if (s.hint) row.title = s.hint;
    const name = document.createElement('span');
    name.className = 'gfx-name';
    name.textContent = s.label;
    row.appendChild(name);

    if (s.type === 'bool') {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'gfx-check';
      cb.addEventListener('change', () => {
        cancelAutoDetect();
        GFX[s.key] = cb.checked;
        GFX.preset = 'custom';
        applyGraphics();
        syncPresetButtons();
        if (s.reload) markReload();
      });
      row.appendChild(cb);
      rows[s.key] = { input: cb };
      return row;
    }

    const val = document.createElement('span');
    val.className = 'gfx-val';
    const rng = document.createElement('input');
    rng.type = 'range';
    rng.min = s.min; rng.max = s.max; rng.step = s.step;
    const fmt = s.fmt || (v => v.toFixed(2));
    rng.addEventListener('input', () => {
      cancelAutoDetect();
      GFX[s.key] = parseFloat(rng.value);
      GFX.preset = 'custom';
      val.textContent = fmt(GFX[s.key]);
      applyGraphics();
      syncPresetButtons();
    });
    row.appendChild(rng);
    row.appendChild(val);
    rows[s.key] = { input: rng, val, fmt };
    return row;
  }

  function syncPresetButtons() {
    if (!panel) return;
    for (const b of panel.querySelectorAll('.gfx-preset'))
      b.classList.toggle('active', b.dataset.preset === GFX.preset);
  }

  function syncMenu() {
    if (!panel) return;
    for (const s of SCHEMA) {
      const r = rows[s.key];
      if (!r) continue;
      if (s.type === 'bool') r.input.checked = !!GFX[s.key];
      else { r.input.value = String(GFX[s.key]); r.val.textContent = r.fmt(GFX[s.key]); }
    }
    syncPresetButtons();
  }

  function toggle(on) {
    if (!panel) return;
    panel.classList.toggle('hidden', !on);
    // The open panel sits exactly on top of the time-of-day slider and the
    // snapshot picker on a desktop layout; style.css slides them clear.
    document.body.classList.toggle('gfx-open', on);
    const btn = document.getElementById('gfx-button');
    if (btn) btn.classList.toggle('active', on);
    if (on) { syncMenu(); startFps(); } else stopFps();
  }

  /** Live fps, only while the menu is open — the point is watching an option cost something. */
  function startFps() {
    stopFps();
    const out = document.getElementById('gfx-fps');
    let last = null, acc = 0, n = 0;
    const step = ts => {
      if (last !== null) { acc += ts - last; n++; }
      last = ts;
      if (acc > 420 && n) {
        const ms = acc / n;
        if (out) {
          out.textContent = `${(1000 / ms).toFixed(0)} fps · ${ms.toFixed(1)} ms`;
          out.className = ms < 20 ? 'good' : ms < 34 ? 'ok' : 'bad';
        }
        acc = 0; n = 0;
      }
      fpsRaf = requestAnimationFrame(step);
    };
    fpsRaf = requestAnimationFrame(step);
  }
  function stopFps() { if (fpsRaf) cancelAnimationFrame(fpsRaf); fpsRaf = null; }

  window.GFX_PRESETS = PRESETS;
  window.cancelGraphicsAutoDetect = cancelAutoDetect;
  // Test hook: preset-colour.mjs has to switch presets the way the menu does —
  // via usePreset, so the reload marker, the menu sync and applyGraphics all
  // run. Assigning to GFX directly would test a path no user can reach.
  window.__usePreset = usePreset;
})();
