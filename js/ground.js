/**
 * ground.js — the ground plane, made of what is actually there.
 *
 * Before this, everything below the buildings was two flat colours: one green
 * for "park", one tan for "ground". A city read as extrusions pushed up out of
 * a blank sheet — and worse, every footpath in the basemap was deliberately
 * hidden by cleanupBasemap (it keeps only major roads), so the paths people
 * actually walk were switched off. On campus that is most of the ground.
 *
 * This draws data/ground.geojson: real OSM paths, plazas, lawns, water,
 * pitches, tracks and parking, differentiated by what each surface IS. It also
 * takes the ROADS off the basemap — see the roads section below for why they
 * cannot stay there.
 *
 * TRUTH: every POSITION comes from OSM (see scripts/bake_ground.py) or from the
 * basemap's own OSM-derived `transportation` layer. What is generative is FORM
 * — the drawn width of a path OSM does not measure, the colour chosen for a
 * named surface, and the surface noise. No feature here is decorative.
 *
 * Public (window) API:
 *   initGround(map)              — add the source + layers under the buildings
 *   applyGroundColors(map, p)    — retint every surface for time-of-day p
 *   applyGroundSettings(map)     — re-read GROUND after a live edit
 *   GROUND                       — the taste block (below)
 */
(function () {
  'use strict';

  // ── Taste block. Every value here is a one-line override. ───────────
  const GROUND = {
    on: true,
    pathOpacity: 0.92,      // paths are the strongest read; keep them confident
    areaOpacity: 0.95,
    minZoom: 13.5,          // below this the ground is too far to earn the fill
    pathFadeZoom: [14.2, 15.4],   // paths fade in across this zoom range
    widthScale: 1.0,        // multiply every path width (form, not fact)
    kerbLight: 0.10,        // how much the path edge lightens (fake bevel)

    // ── Roads ─────────────────────────────────────────────────────────
    roads: true,            // false = hand the roads back to the basemap
    roadWidthScale: 1.0,
    // Metres of pavement, edge to edge, by OpenMapTiles `class`. GENERATIVE:
    // the tiles carry no width and no lane count, so these are the honest
    // typical section for each class in Austin, not a measurement.
    roadWidth: {
      motorway: 30, trunk: 24, primary: 20, secondary: 16,
      tertiary: 12.5, minor: 9.5, service: 5.5,
    },
    roadLinkWidth: 8.5,     // ramps (`ramp` = 1) are one lane plus shoulders
    roadFallbackWidth: 9,
    roadCasingScale: 1.16,  // kerb + gutter, as a multiple of the pavement
    roadCasingDark: 0.38,   // how much darker than the asphalt the kerb reads
    roadMinZoom: 12.6,
    roadServiceFade: [15.2, 16.3],  // alleys arrive only once you are low enough

    // Lane markings, and ONLY where a real road has them: an undivided major
    // gets the yellow centre line, a oneway or divided carriageway gets the
    // white lane divider. Everything below `laneClasses` — every minor street,
    // every alley, every campus walkway — gets nothing.
    lanes: true,
    laneClasses: ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'],
    laneMinZoom: 15.3,
    laneWidthFrac: 0.035,   // of the road width, so dashes stay metre-true
    laneMinPx: 1.1,
    // In line-width units, so constant in METRES. 1:3 on:off, which is the real
    // US ratio (10 ft line, 30 ft gap). The first pass ran 2.6:3.6 at width
    // 0.055 and opacity 0.6, and six parallel I-35 carriageways came out looking
    // like an airstrip — a lane marking is a hint from 400 m, not a feature.
    laneDash: [2.4, 7.0],
    laneWarm: '#cfae62',    // undivided centre line (US yellow, dulled down)
    laneCool: '#c6c2b6',    // lane divider on a oneway carriageway
    laneOpacity: 0.42,
    laneNightFade: 0.5,     // markings still catch headlights, just dimmer

    // ── Texture ───────────────────────────────────────────────────────
    // MEASURED (scripts/verify/pattern-scale.mjs): fill-pattern is anchored in
    // TILE space at the image's native pixel size and resets at every integer
    // zoom — a 32 px tile measured 33.0 m across at z16, 16.5 m at z17 and
    // 8.2 m at z18. So the feature size in metres HALVES every zoom level and
    // snaps back on the way. The only tile that survives that is scale-free
    // noise: anything with a recognisable motif visibly pops at each integer
    // zoom. That is why these tiles are blobs and speckle and nothing else.
    texture: true,
    texTile: 64,            // px => ~66 m at z16, ~33 m at z17, ~16 m at z18
    texOpacity: 0.62,       // master; multiplies every per-class strength
    texStrength: {          // per surface family, 0..1
      grass: 1.0, asphalt: 0.9, water: 0.95, paving: 0.5,
    },
    texNightFade: 0.55,     // texture recedes after dark, never vanishes
    texWaterNightKeep: 0.8, // water keeps more of it — still reads as water
    // The catch-all ground under everything OSM does not classify measured 54%
    // of an isolated ground frame — by far the largest flat region in the
    // scene, and the one the "walkway of flour" complaint is really about. Its
    // colour belongs to timeofday.js, which this pass does not own, so it gets
    // its own patterned background layer stacked under ours instead.
    texGround: true,
    texGroundOpacity: 0.5,  // relative to texOpacity
    texGroundMaxZoom: 22,

    // Per-feature lightness jitter, as a FRACTION of that surface's own luma,
    // so one number is right at noon and automatically quiet at night. This is
    // what stops 4,900 areas being 14 exact hexes.
    jitter: 0.06,
    pathJitter: 0.03,       // smaller: paths must not lose their separation
  };
  window.GROUND = GROUND;

  const SRC = 'austin-ground';
  const AREA = 'ground-areas', TEX = 'ground-texture', BASE_TEX = 'ground-base-texture';
  const ROAD_CASE = 'ground-road-casing', ROAD = 'ground-road', LANE = 'ground-road-lane';
  const PATH_CASE = 'ground-paths-casing', PATH = 'ground-paths';
  const TEX_IMG = { grass: 'gnd-tex-grass', asphalt: 'gnd-tex-asphalt',
                    water: 'gnd-tex-water', paving: 'gnd-tex-paving' };

  // ── Surface palettes, per hour ──────────────────────────────────────
  // Chosen against the protected palette: terracotta roofs over tan/olive
  // walls. So ground brick is browner and darker than any roof, and limestone
  // stays cooler than the wall tan — the buildings must still win the frame.
  const SURF = {
    // Paths must sit LIGHT on the mid-grey `ground` in timeofday.js and dark
    // where they are asphalt. Target ≥40 luma of separation from the ground —
    // the first attempt had 3.5 and the whole path network was invisible even
    // though it was rendering correctly (proved with a magenta pass).
    //
    // `asphalt` carries a second job now: it is the road surface as well as the
    // parking lots, because the roads moved off the basemap and onto this
    // palette. It went darker and COOLER than any pedestrian tone here — the
    // measured gap between a road and a footpath was 6.2 luma by day and 0.4
    // luma at night, which is why a six-lane arterial and a 2 m walkway were
    // the same object. Keep asphalt at least 60 luma below `concrete`.
    day: {
      limestone:'#efe6cf', concrete:'#dfd9cb', paving:'#e6ddc9', brick:'#9a6249',
      asphalt:'#5e6165', gravel:'#c9bfa9', dirt:'#a28b6c', sand:'#e2d2ab',
      grass:'#8fa869', turf:'#4f7a3c', wood:'#5d7a48', water:'#8fbccd',
      track:'#a8503c', endzone:'#bf5700',
    },
    golden: {
      limestone:'#f4e0b8', concrete:'#e3cba6', paving:'#ecd6ac', brick:'#8f5439',
      asphalt:'#655d5a', gravel:'#cdb28d', dirt:'#a37f5b', sand:'#e7cb9c',
      grass:'#8a9457', turf:'#4a6b36', wood:'#5a6a3c', water:'#c9a184',
      track:'#a5482f', endzone:'#b04e00',
    },
    night: {
      limestone:'#1b1e28', concrete:'#181b24', paving:'#1a1d26',
      brick:'#1d1720', asphalt:'#0d1017', gravel:'#1b1a22', dirt:'#191620',
      sand:'#201d26', grass:'#111a14', turf:'#0d1710', wood:'#0c130f',
      water:'#070f1e', track:'#1d1418', endzone:'#2a1608',
    },
  };
  const KEYS = Object.keys(SURF.day);

  // Which noise tile each surface wears. Everything paved that is not asphalt
  // shares the aggregate speckle; anything unmapped falls through to it too.
  // An endzone is painted TURF, not pavement — it belongs with the grass, and
  // wearing the asphalt speckle was visibly wrong on the practice fields.
  const TEX_FAMILY = {
    grass: 'grass', turf: 'grass', wood: 'grass', endzone: 'grass',
    asphalt: 'asphalt', track: 'asphalt',
    water: 'water',
  };

  // ── colour helpers (same convention as timeofday.js) ────────────────
  const hex2rgb = h => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
  const rgb2hex = (r,g,b) => '#' + [r,g,b].map(v =>
    Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join('');
  function lerpHex(a, b, t) {
    const A = hex2rgb(a), B = hex2rgb(b);
    return rgb2hex(A[0]+(B[0]-A[0])*t, A[1]+(B[1]-A[1])*t, A[2]+(B[2]-A[2])*t);
  }
  const clamp01 = v => Math.max(0, Math.min(1, v));
  const luma = c => 0.2126*c[0] + 0.7152*c[1] + 0.0722*c[2];

  /** The palette at hour p, blended day→golden→night like every other colour. */
  function paletteAt(p) {
    p = clamp01(p);
    const a = p <= 0.5 ? SURF.day : SURF.golden;
    const b = p <= 0.5 ? SURF.golden : SURF.night;
    const t = p <= 0.5 ? p / 0.5 : (p - 0.5) / 0.5;
    const out = {};
    for (const k of KEYS) out[k] = lerpHex(a[k], b[k], t);
    return out;
  }
  /** How far into night we are — the same second half of the palette blend. */
  const nightAmt = p => clamp01((clamp01(p) - 0.5) / 0.5);

  /** ['match', ['get','s'], 'grass', '#..', …, fallback] */
  function matchExpr(pal, tweak) {
    const e = ['match', ['get', 's']];
    for (const k of KEYS) e.push(k, tweak ? tweak(pal[k]) : pal[k]);
    e.push(tweak ? tweak(pal.concrete) : pal.concrete);
    return e;
  }

  /** Lighten a hex by t toward white — used for the path kerb highlight. */
  function lighten(h, t) {
    const c = hex2rgb(h);
    return rgb2hex(c[0]+(255-c[0])*t, c[1]+(255-c[1])*t, c[2]+(255-c[2])*t);
  }
  /** Darken a hex by t toward black — the road kerb. */
  function darken(h, t) {
    const c = hex2rgb(h);
    return rgb2hex(c[0]*(1-t), c[1]*(1-t), c[2]*(1-t));
  }
  /**
   * Shift a colour along its own luma by `frac` of that luma, hue intact.
   * Expressing the jitter as a fraction rather than an absolute step is what
   * makes ONE number correct at every hour: ±6% of a 217-luma daytime path is
   * ±13, and ±6% of the same path at night (luma 27) is ±1.6 — loud where the
   * eye can see it, silent where it would just look like noise.
   */
  function shiftLuma(h, frac) {
    const c = hex2rgb(h), d = luma(c) * frac;
    return rgb2hex(c[0]+d, c[1]+d, c[2]+d);
  }

  /**
   * Feature id → [0,1). `generateId` on the source hands every feature a stable
   * integer; ×2654435761 mod 1024 is a bijection whose step (433) is coprime
   * with 1024, so neighbouring ids land far apart and two adjacent lawns never
   * come out the same shade. Features with no id (there should be none) fall
   * back to 0, which is simply the low end of the jitter.
   */
  const hash01 = () => ['/', ['%', ['*', ['to-number', ['id'], 0], 2654435761], 1024], 1024];

  /** matchExpr, but every feature sits somewhere in a ±amp band of its colour. */
  function jitterExpr(pal, amp, tweak) {
    const base = c => (tweak ? tweak(c) : c);
    if (!amp) return matchExpr(pal, base);
    return ['interpolate', ['linear'], hash01(),
      0, matchExpr(pal, c => shiftLuma(base(c), -amp)),
      1, matchExpr(pal, c => shiftLuma(base(c), +amp))];
  }

  // Path width: OSM metres → screen px. MapLibre uses 512 px tiles, so one
  // pixel is 78271.517·cos(lat)/2^zoom metres; at Austin's latitude that is
  // 67546/2^zoom. Width in px is therefore w·2^zoom/67546, which is exactly a
  // base-2 exponential in zoom — so two stops describe it perfectly.
  const PX_AT = z => Math.pow(2, z) / 67546;
  function widthExpr(scale) {
    return ['interpolate', ['exponential', 2], ['zoom'],
      14, ['*', ['get', 'w'], PX_AT(14) * scale],
      21, ['*', ['get', 'w'], PX_AT(21) * scale]];
  }

  // ── Roads ───────────────────────────────────────────────────────────
  //
  // Roads are NOT in data/ground.geojson: bake_ground.py reads footways,
  // plazas, landuse, water, sport and parking, and nothing drivable. Every road
  // in the frame was the Liberty basemap's own `transportation` lines, kept by
  // cleanupBasemap and painted from the `road`/`roadCasing` entries in
  // timeofday.js — a pale warm cream, ONE width for every class. Measured, that
  // put a six-lane arterial 6.2 luma from a 2 m campus footpath by day and 0.4
  // luma from it at night. They were the same object.
  //
  // Fixing it inside timeofday.js was not enough even in principle: styleRoad
  // writes one width expression across every kept layer, so a motorway and a
  // residential street cannot differ, and the layer ids come from whatever
  // version of the basemap style loads. So this takes the roads over: the
  // basemap's road lines are hidden and redrawn here off the same vector tiles,
  // with width by class and the asphalt tone from the palette above. Set
  // GROUND.roads = false to hand them straight back.
  const ROAD_CLASSES = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service'];
  let _hiddenBasemapRoads = [];

  /** The vector source the basemap tiles come from, whatever it is called. */
  function vectorSourceId(map) {
    const s = map.getStyle().sources;
    return Object.keys(s).find(id => s[id].type === 'vector');
  }

  /** Metres of pavement for this feature. */
  function roadMetres() {
    const m = ['match', ['get', 'class']];
    for (const k of ROAD_CLASSES) m.push(k, GROUND.roadWidth[k]);
    m.push(GROUND.roadFallbackWidth);
    return ['case', ['==', ['get', 'ramp'], 1], GROUND.roadLinkWidth, m];
  }
  function roadWidthExpr(scale) {
    const m = roadMetres();
    return ['interpolate', ['exponential', 2], ['zoom'],
      13, ['*', m, PX_AT(13) * scale],
      21, ['*', m, PX_AT(21) * scale]];
  }
  const ROAD_FILTER = ['all',
    ['==', ['geometry-type'], 'LineString'],
    ['match', ['get', 'class'], ROAD_CLASSES, true, false],
    ['!=', ['get', 'brunnel'], 'tunnel'],
  ];
  /**
   * Alleys and driveways (`service`, 246 of them over campus) are real and they
   * are what breaks a West Campus block up — but at altitude 246 extra hairlines
   * read as noise, so they arrive on a zoom fade. Written as stop VALUES of a
   * top-level zoom interpolate because ['zoom'] is only legal there.
   */
  function roadOpacityExpr(base) {
    const isService = ['==', ['get', 'class'], 'service'];
    return ['interpolate', ['linear'], ['zoom'],
      GROUND.roadServiceFade[0], ['case', isService, 0, base],
      GROUND.roadServiceFade[1], base];
  }
  const LANE_FILTER = () => ['all',
    ['==', ['geometry-type'], 'LineString'],
    ['match', ['get', 'class'], GROUND.laneClasses, true, false],
    ['!=', ['get', 'ramp'], 1],
    ['!=', ['get', 'brunnel'], 'tunnel'],
  ];
  /** Constant in metres where it can be, with a floor so it never disappears. */
  function laneWidthExpr() {
    const m = ['*', roadMetres(), GROUND.laneWidthFrac];
    return ['interpolate', ['exponential', 2], ['zoom'],
      GROUND.laneMinZoom, GROUND.laneMinPx,
      17, ['max', GROUND.laneMinPx, ['*', m, PX_AT(17)]],
      21, ['*', m, PX_AT(21)]];
  }
  /** Yellow down the middle of an undivided road, white on a oneway carriageway. */
  function laneColorExpr(p) {
    const n = nightAmt(p);
    const dim = c => lerpHex(c, '#0a0c12', n * GROUND.laneNightFade);
    return ['case',
      ['any', ['==', ['get', 'oneway'], 1], ['==', ['get', 'oneway'], -1]],
      dim(GROUND.laneCool), dim(GROUND.laneWarm)];
  }

  // ── Texture tiles ───────────────────────────────────────────────────
  //
  // These are pure ALPHA modulation — black where they darken, white where they
  // lighten, and nothing in between — which is the whole reason they are cheap.
  // The facade atlas has to be redrawn on every time-of-day tick because its
  // colour lives inside the image; these carry no colour at all, so they are
  // generated once at load and never touched again. Time of day moves the
  // layer's opacity, which is one setPaintProperty.
  //
  // Every blob is drawn nine times, offset by ±TILE, so the tile wraps without
  // a seam. Seams are the failure mode you only see once it is tiled 400 times
  // across a lawn.
  function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  function wrapped(ctx, T, x, y, draw) {
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) draw(x + dx*T, y + dy*T);
  }
  function blob(ctx, T, x, y, r, rgb, a) {
    wrapped(ctx, T, x, y, (px, py) => {
      const g = ctx.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, `rgba(${rgb},${a})`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
    });
  }
  function speckle(ctx, T, rand, n, maxA, size) {
    for (let i = 0; i < n; i++) {
      const light = rand() < 0.5;
      ctx.fillStyle = `rgba(${light ? '255,255,255' : '0,0,0'},${(0.25 + rand()*0.75) * maxA})`;
      ctx.fillRect(Math.floor(rand()*T), Math.floor(rand()*T), size, size);
    }
  }

  function drawTexture(family, T) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = T;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, T, T);
    const rand = rng({ grass: 12345, asphalt: 777, water: 4242, paving: 90210 }[family]);

    if (family === 'grass') {
      // Clumps at a range of sizes — mown stripes and beds would be a motif and
      // would pop at every integer zoom, so this is deliberately shapeless.
      // Many small clumps, not few large ones: at z16 the tile spans ~66 m, so
      // a 4 px blob is a 4 m patch, which is the scale that survives the flying
      // camera. The first pass used 34 blobs up to 20 px and read as weather.
      for (let i = 0; i < 62; i++) {
        const r = 3 + rand() * 8, dark = rand() < 0.55;
        blob(ctx, T, rand()*T, rand()*T, r, dark ? '20,26,10' : '236,246,206',
             (0.05 + rand()*0.10) * (dark ? 1 : 0.8));
      }
      speckle(ctx, T, rand, 900, 0.10, 1);
    } else if (family === 'asphalt') {
      // Aggregate, then the patching. A road surface is never one age.
      speckle(ctx, T, rand, 2100, 0.12, 1);
      for (let i = 0; i < 9; i++) {
        const r = 6 + rand() * 13, fresh = rand() < 0.6;
        blob(ctx, T, rand()*T, rand()*T, r, fresh ? '0,0,0' : '255,255,255',
             (0.04 + rand()*0.05));
      }
    } else if (family === 'water') {
      // Four crossing waves at integer frequencies, so the tile wraps and so no
      // single one of them dominates. The first pass was one band plus a wobble
      // at 0.26 alpha and Waller Creek came out a zebra ribbon — a period the
      // eye can count is the one thing that must not happen here, because
      // fill-pattern resets at every integer zoom and a countable period pops.
      const WAVES = [
        [0, 3, 0.00, 0.45],   // [freq x, freq y, phase, weight]
        [1, 7, 1.10, 0.28],
        [2, 5, 2.40, 0.20],
        [3, -2, 0.40, 0.16],
      ];
      const norm = WAVES.reduce((a, w) => a + w[3], 0);
      const img = ctx.createImageData(T, T);
      for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
        let v = 0;
        for (const [fx, fy, ph, wt] of WAVES) v += wt * Math.sin(2*Math.PI*(fx*x + fy*y)/T + ph);
        v /= norm;
        const a = Math.min(1, Math.abs(v) * 0.11);
        const i = (y*T + x) * 4, light = v > 0;
        img.data[i] = img.data[i+1] = img.data[i+2] = light ? 255 : 0;
        img.data[i+3] = Math.round(a * 255);
      }
      ctx.putImageData(img, 0, 0);
      speckle(ctx, T, rand, 520, 0.08, 1);
    } else {
      // Paving / concrete / gravel / sand: aggregate and a few old stains. The
      // paving tones are pale ON PURPOSE, so this is the gentlest of the four —
      // it must add grain without eating the path-versus-ground separation.
      // Stains stay small: at 10-24 px they rendered as literal round spots on
      // a light surface rather than as a wash.
      speckle(ctx, T, rand, 1500, 0.09, 1);
      for (let i = 0; i < 9; i++) {
        blob(ctx, T, rand()*T, rand()*T, 5 + rand()*7, '0,0,0', 0.02 + rand()*0.018);
      }
    }
    const d = ctx.getImageData(0, 0, T, T);
    return { width: T, height: T, data: new Uint8Array(d.data.buffer.slice(0)) };
  }

  function initTextures(map) {
    const T = GROUND.texTile;
    for (const [family, id] of Object.entries(TEX_IMG)) {
      if (map.hasImage && map.hasImage(id)) continue;
      try { map.addImage(id, drawTexture(family, T)); } catch (e) {}
    }
  }
  /** ['match', ['get','s'], …, imageName] — one tile per surface family. */
  function texPatternExpr() {
    const e = ['match', ['get', 's']];
    for (const k of KEYS) e.push(k, TEX_IMG[TEX_FAMILY[k] || 'paving']);
    e.push(TEX_IMG.paving);
    return e;
  }
  /** Per-surface strength × master × the night fade. */
  function texOpacityExpr(p) {
    const n = nightAmt(p);
    const fade = f => GROUND.texOpacity * f * (1 - n * (1 - GROUND.texNightFade));
    const waterFade = GROUND.texOpacity * GROUND.texStrength.water *
                      (1 - n * (1 - GROUND.texWaterNightKeep));
    const e = ['match', ['get', 's']];
    for (const k of KEYS) {
      const fam = TEX_FAMILY[k] || 'paving';
      e.push(k, +(fam === 'water' ? waterFade : fade(GROUND.texStrength[fam])).toFixed(3));
    }
    e.push(+fade(GROUND.texStrength.paving).toFixed(3));
    return e;
  }
  /** The base-ground grain rides the same night fade as everything else. */
  function baseTexOpacity(p) {
    const n = nightAmt(p);
    return +(GROUND.texOpacity * GROUND.texStrength.paving * GROUND.texGroundOpacity *
             (1 - n * (1 - GROUND.texNightFade))).toFixed(3);
  }

  window.initGround = function initGround(map) {
    if (!GROUND.on || map.getSource(SRC)) return;
    // generateId is what makes the per-feature jitter possible: without it
    // ['id'] is null for every feature and 4,900 areas stay 14 exact hexes.
    // Nothing in the app puts feature-state on this source, so it is free.
    map.addSource(SRC, { type: 'geojson', data: 'data/ground.geojson', generateId: true });

    // Under everything of ours: the buildings' contact shadows and extrusions
    // must sit ON the ground, not under it.
    const under = ['buildings-shadow', 'buildings-ao', 'buildings-3d']
      .find(id => map.getLayer(id));

    const p = window.__todCurrentP != null ? window.__todCurrentP : 0.5;
    const pal = paletteAt(p);

    // Images before any layer references them, or MapLibre logs "image not
    // found" and paints the fill transparent — the same trap as the facades.
    if (GROUND.texture) initTextures(map);

    // Order, bottom to top: the base ground grain, the areas, their texture,
    // the roads, the road markings, then the paths over everything. Each
    // addLayer inserts immediately before `under`, so the call order below IS
    // the paint order.
    if (GROUND.texture && GROUND.texGround && !map.getLayer(BASE_TEX)) {
      map.addLayer({
        id: BASE_TEX, type: 'background',
        minzoom: GROUND.minZoom, maxzoom: GROUND.texGroundMaxZoom,
        paint: {
          'background-pattern': TEX_IMG.paving,
          'background-opacity': baseTexOpacity(p),
        },
      }, under);
    }

    if (!map.getLayer(AREA)) {
      map.addLayer({
        id: AREA, type: 'fill', source: SRC, minzoom: GROUND.minZoom,
        filter: ['==', ['get', 'k'], 'area'],
        paint: {
          'fill-color': jitterExpr(pal, GROUND.jitter),
          'fill-opacity': GROUND.areaOpacity,
          'fill-antialias': true,
        },
      }, under);
    }

    if (GROUND.texture && !map.getLayer(TEX)) {
      map.addLayer({
        id: TEX, type: 'fill', source: SRC, minzoom: GROUND.minZoom,
        filter: ['==', ['get', 'k'], 'area'],
        paint: {
          'fill-pattern': texPatternExpr(),
          'fill-opacity': texOpacityExpr(p),
          'fill-antialias': false,   // the fill under it already drew the edge
        },
      }, under);
    }

    if (GROUND.roads) addRoadLayers(map, pal, p, under);

    // A slightly wider, lighter line under each path reads as the kerb/edge
    // catching light — the cheapest thing that stops a path looking like a
    // sticker laid on the grass.
    if (!map.getLayer(PATH_CASE)) {
      map.addLayer({
        id: PATH_CASE, type: 'line', source: SRC, minzoom: GROUND.minZoom,
        filter: ['==', ['get', 'k'], 'path'],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': jitterExpr(pal, GROUND.pathJitter, c => lighten(c, GROUND.kerbLight)),
          'line-width': widthExpr(GROUND.widthScale * 1.34),
          'line-opacity': ['interpolate', ['linear'], ['zoom'],
            GROUND.pathFadeZoom[0], 0, GROUND.pathFadeZoom[1], GROUND.pathOpacity * 0.8],
        },
      }, under);
    }

    if (!map.getLayer(PATH)) {
      map.addLayer({
        id: PATH, type: 'line', source: SRC, minzoom: GROUND.minZoom,
        filter: ['==', ['get', 'k'], 'path'],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': jitterExpr(pal, GROUND.pathJitter),
          'line-width': widthExpr(GROUND.widthScale),
          'line-opacity': ['interpolate', ['linear'], ['zoom'],
            GROUND.pathFadeZoom[0], 0, GROUND.pathFadeZoom[1], GROUND.pathOpacity],
        },
      }, under);
    }
  };

  function addRoadLayers(map, pal, p, under) {
    const vec = vectorSourceId(map);
    if (!vec) { console.warn('[ground] no vector source; roads left on the basemap'); return; }

    // Hide the basemap's own road lines FIRST. Leaving them on paints a pale
    // cream ribbon under every road we draw, which shows at every kerb.
    hideBasemapRoads(map);

    if (!map.getLayer(ROAD_CASE)) {
      map.addLayer({
        id: ROAD_CASE, type: 'line', source: vec, 'source-layer': 'transportation',
        minzoom: GROUND.roadMinZoom, filter: ROAD_FILTER,
        layout: { 'line-join': 'round', 'line-cap': 'butt' },
        paint: {
          'line-color': darken(pal.asphalt, GROUND.roadCasingDark),
          'line-width': roadWidthExpr(GROUND.roadWidthScale * GROUND.roadCasingScale),
          'line-opacity': roadOpacityExpr(0.9),
        },
      }, under);
    }
    if (!map.getLayer(ROAD)) {
      map.addLayer({
        id: ROAD, type: 'line', source: vec, 'source-layer': 'transportation',
        minzoom: GROUND.roadMinZoom, filter: ROAD_FILTER,
        layout: { 'line-join': 'round', 'line-cap': 'butt' },
        paint: {
          'line-color': pal.asphalt,
          'line-width': roadWidthExpr(GROUND.roadWidthScale),
          'line-opacity': roadOpacityExpr(1),
        },
      }, under);
    }
    if (GROUND.lanes && !map.getLayer(LANE)) {
      map.addLayer({
        id: LANE, type: 'line', source: vec, 'source-layer': 'transportation',
        minzoom: GROUND.laneMinZoom, filter: LANE_FILTER(),
        layout: { 'line-join': 'round', 'line-cap': 'butt' },
        paint: {
          'line-color': laneColorExpr(p),
          'line-width': laneWidthExpr(),
          'line-dasharray': GROUND.laneDash.slice(),
          'line-opacity': GROUND.laneOpacity,
        },
      }, under);
    }
  }

  /**
   * Every basemap line off the `transportation` source-layer goes dark, and we
   * remember which ones we turned off so GROUND.roads = false can put them back
   * exactly. timeofday.js still writes `road`/`roadCasing` colours to these
   * layers on every tick; those writes are now harmless no-ops on a hidden
   * layer, which is the cheapest possible way to not have to edit that file.
   */
  function hideBasemapRoads(map) {
    if (_hiddenBasemapRoads.length) return;
    // OUR road layers read from the same vector source and the same
    // `transportation` source-layer, so "every visible transportation line"
    // matches them too. It cost a real bug: toggling GROUND.roads back ON
    // showed the three layers and then this immediately hid them again on the
    // same call, and the frame proved it — our asphalt covered 27.8% of the
    // pose with roads on, 3.2% with them off, and 3.2% again after turning
    // them back on. Assert on pixels and the lie is one line long.
    const ours = new Set([ROAD, ROAD_CASE, LANE]);
    for (const l of map.getStyle().layers) {
      if (ours.has(l.id)) continue;
      if ((l['source-layer'] || '') !== 'transportation') continue;
      if (l.type !== 'line') continue;
      if ((l.layout && l.layout.visibility) === 'none') continue;
      try {
        map.setLayoutProperty(l.id, 'visibility', 'none');
        _hiddenBasemapRoads.push(l.id);
      } catch (e) {}
    }
  }
  function showBasemapRoads(map) {
    for (const id of _hiddenBasemapRoads) {
      try { map.setLayoutProperty(id, 'visibility', 'visible'); } catch (e) {}
    }
    _hiddenBasemapRoads = [];
  }

  window.applyGroundColors = function applyGroundColors(map, p) {
    if (!map || !map.getLayer || !map.getLayer(AREA)) return;
    const pal = paletteAt(p);
    const set = (id, prop, val) => { try { map.setPaintProperty(id, prop, val); } catch (e) {} };
    set(AREA, 'fill-color', jitterExpr(pal, GROUND.jitter));
    set(PATH, 'line-color', jitterExpr(pal, GROUND.pathJitter));
    set(PATH_CASE, 'line-color', jitterExpr(pal, GROUND.pathJitter, c => lighten(c, GROUND.kerbLight)));
    // The texture images carry no colour, so time of day only moves opacity —
    // no getImageData readback, no atlas upload, nothing per tick.
    set(TEX, 'fill-opacity', texOpacityExpr(p));
    set(BASE_TEX, 'background-opacity', baseTexOpacity(p));
    set(ROAD, 'line-color', pal.asphalt);
    set(ROAD_CASE, 'line-color', darken(pal.asphalt, GROUND.roadCasingDark));
    set(LANE, 'line-color', laneColorExpr(p));
  };

  /** Re-read GROUND after a live edit (widths, opacity, scale). */
  window.applyGroundSettings = function applyGroundSettings(map) {
    if (!map.getLayer(PATH)) return;
    const set = (id, prop, val) => { try { map.setPaintProperty(id, prop, val); } catch (e) {} };
    set(PATH, 'line-width', widthExpr(GROUND.widthScale));
    set(PATH_CASE, 'line-width', widthExpr(GROUND.widthScale * 1.34));
    set(AREA, 'fill-opacity', GROUND.areaOpacity);
    set(ROAD, 'line-width', roadWidthExpr(GROUND.roadWidthScale));
    set(ROAD_CASE, 'line-width', roadWidthExpr(GROUND.roadWidthScale * GROUND.roadCasingScale));
    set(LANE, 'line-width', laneWidthExpr());
    set(LANE, 'line-dasharray', GROUND.laneDash.slice());
    set(LANE, 'line-opacity', GROUND.laneOpacity);
    const p = window.__todCurrentP != null ? window.__todCurrentP : 0.5;
    set(TEX, 'fill-opacity', texOpacityExpr(p));
    set(BASE_TEX, 'background-opacity', baseTexOpacity(p));

    const show = (id, on) => {
      try { map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'); } catch (e) {}
    };
    for (const id of [AREA, PATH, PATH_CASE]) show(id, GROUND.on);
    show(TEX, GROUND.on && GROUND.texture);
    show(BASE_TEX, GROUND.on && GROUND.texture && GROUND.texGround);
    for (const id of [ROAD, ROAD_CASE]) show(id, GROUND.on && GROUND.roads);
    show(LANE, GROUND.on && GROUND.roads && GROUND.lanes);
    // Turning our roads off has to give the basemap's back, or the scene ends
    // up with no roads at all and that reads as a broken layer, not a setting.
    if (GROUND.on && GROUND.roads) hideBasemapRoads(map); else showBasemapRoads(map);
  };
})();
