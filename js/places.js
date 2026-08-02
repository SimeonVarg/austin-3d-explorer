/**
 * places.js — the storefronts. 133 real businesses on the campus edge, West
 * Campus and Guadalupe, each given a shopfront on its host building's ground
 * floor in the brand's real sign colour, with the business name as a label.
 *
 * WHAT THIS ADDS THAT js/drag.js DOES NOT. drag.js fixed the SHAPE of the
 * problem for Guadalupe between 21st and 24th: it stopped painting apartment
 * windows on the ground floor of a bookstore and gave that run a shopfront
 * vocabulary — glass band, bulkhead, sign band, upper floors. This file keeps
 * every one of those decisions and adds the thing drag.js could not know: WHICH
 * BUSINESS is behind each stretch of glass, and therefore what colour its
 * fascia is. It also carries the vocabulary off the Drag and onto the ~90 other
 * storefronts in the bbox that had none — West Campus, the Speedway edge,
 * 26th Street, Dobie, MLK.
 *
 * NO BRAND ARTWORK. Not one logo image is fetched, embedded or drawn. That is
 * partly a trademark call — this is going out on AWS Kiro's channels — and
 * partly that it would be wasted bytes: the camera flies 200-900 m up, one
 * pixel of wall is about half a metre, and a logo is four pixels of mush. What
 * a person actually recognises from a block away is the SIGN COLOUR and the
 * NAME, and those are what this draws.
 *
 * ── THE THREE THINGS THAT MAKE IT READ ───────────────────────────────────────
 *
 *   1. THE FASCIA IS FLAT COLOUR, NOT A PATTERN. A brand colour is one value.
 *      Painting it through a 64 px tile would put the renderer's pattern
 *      machinery between the sourced hex and the screen for no gain, and would
 *      cost one atlas image per brand. So the sign band is a plain
 *      fill-extrusion-color driven off the feature's own wd/wg/wn, which is
 *      also what lets 35 different sourced hexes cost exactly zero images.
 *
 *   2. THE SIGN GOES UP AT NIGHT, NOT DOWN. Every other surface in this repo
 *      rides a ramp that ends dark. A shop fascia is the opposite: channel
 *      letters and lightboxes are the brightest thing on a two-storey building
 *      after dark, and it is the entire reason the Drag reads at night. The
 *      `wn` the bake writes for a sign is the brand hue at near-full chroma and
 *      high value. Run a sign through the wall ramp and Chipotle's red lands at
 *      #29181f, which deletes the pass at exactly the hour it matters most.
 *
 *   3. THE AWNING IS WHAT THE FLYING CAMERA ACTUALLY SEES. At 60-75 degrees of
 *      pitch a vertical fascia is foreshortened to roughly a third of its true
 *      height while a horizontal surface is seen at nearly full size. So the
 *      surface that delivers "that is a Whataburger" from altitude is the
 *      awning's TOP face, not the sign. That is why the bake cantilevers one
 *      1.3 m deep off every shopfront and pre-corrects its colour cool for the
 *      sun tint the top face picks up.
 *
 * ── THE TRAP THIS PASS IS BUILT AROUND ───────────────────────────────────────
 * `fill-extrusion-pattern` is TILE-locked and has NO VERTICAL ANCHOR: it repeats
 * from the extrusion base with no idea where the building's top or bottom is. So
 * a ground-floor shopfront painted into a wall tile reappears every ~40 m all
 * the way up. Every band here is therefore its own feature with its own `base`
 * and `h`, emitted by scripts/bake_places.py — bake_stadium.py's BANDS list,
 * applied per tenant. The single pattern this file registers (the glazing's
 * mullions) is STATIONARY IN Y, exactly as js/drag.js's tiles are: vertical
 * mullions survive a moving slice, a transom bar would not, so there is no
 * transom bar.
 *
 * ── IT REPLACES NOTHING ──────────────────────────────────────────────────────
 * `replacedBuildingIds` is empty on purpose and this module writes no filter on
 * `buildings-3d`. The shopfronts are a thin slab standing 0.30 m PROUD of the
 * host wall, so they can never z-fight with the building behind them, they work
 * whether or not drag.js has already rebuilt that wall, and — the reason that
 * matters — this pass cannot collide with any of the six others landing on this
 * repo, because it never claims a building any of them might also claim.
 *
 * Public (window) API:
 *   initPlaces(map)             — add the source + layers (called automatically)
 *   applyPlacesColors(map, p)   — retint for time-of-day p (hooked automatically)
 *   applyPlacesSettings(map)    — re-read PLACES after a live edit
 *   placesTileSample(p)         — the glass tile's mean colour at hour p, no map
 *   placesStats()              — what actually got drawn
 *   PLACES                      — the taste block (below)
 */
(function () {
  'use strict';

  const q = new URLSearchParams(window.location.search);

  const PLACES = {
    // ?places=0 removes the whole pass at load, so scripts/verify/places-perf.mjs
    // can measure the A/B on ONE build instead of two checkouts. Same lever
    // js/drag.js exposes as ?drag=0.
    on: q.get('places') !== '0',
    // ?placelabels=0 keeps the geometry and drops the text, which is how you
    // tell "the shopfronts are invisible" apart from "the labels are covering
    // them" without rebuilding anything.
    labels: q.get('placelabels') !== '0',
    minZoom: 15,
    // "restaurant names are a bit too visible from afar". They were: shop names
    // started at z16 in BOLD white on a saturated brand halo, while building names
    // started at 16.7 in regular weight — so a boba shop announced itself sooner
    // and louder than the building it is inside. A storefront is a street-level
    // detail; it should arrive when you are close enough to walk into it.
    labelMinZoom: 17.3,
    opacity: 1.0,
  };
  window.PLACES = PLACES;

  const SRC = 'austin-places';
  const L_SOLID = 'places-solid';
  const L_GLASS = 'places-glass';
  const L_LABEL = 'places-label';
  const DATA = 'data/places.geojson';
  const TILE = 64;
  const GLASS_IMG = 'pl-glass';

  // ── taste: the glazing tile, in tile pixels ─────────────────────────
  // One tile is ~40 m of wall in the middle of the flying range, so 1 px is
  // about 0.63 m. These are drag.js's shopGlass numbers, deliberately: the two
  // passes' glazing sits on the same buildings and must not disagree about what
  // a shopfront window looks like.
  const T = {
    MULL: 5, MULL_DARK: 0.26,      // mullions every ~3.2 m, 1 px wide
    // 0.50 — drag.js's own value — is right when `k.glass` is derived from a
    // sunlit stucco wall, and wrong here, because this pass derives it from ONE
    // fixed base tone instead of per-building. The tile came back at luma 80
    // against a ~145 wall and rendered as a black ribbed void under every
    // shopfront: not glass, a hole. Which is the same failure drag.js already
    // recorded fixing at 0.66, one step further along the same axis. Measured by
    // placesTileSample, not by eye — see scripts/verify/places-check.mjs, which
    // now asserts a floor on this.
    GLASS_DARK: 0.40,              // how far the glass goes from its base tone by day
    SKY: [126, 148, 176], SKY_MIX: 0.26,
    NIGHT: 0.86,                   // ... and how hard it glows after dark
    NIGHT_TONE: [255, 206, 148],
    BAY_RATE: 0.34,                // share of bays that are a brighter interior
    GAIN: 1.42,                    // the pattern removes mean luma; this puts it back
  };
  window.PLACES_T = T;

  // ── colour helpers (this module's own; drag.js's are private) ───────
  function hexToRgb(hex) {
    const h = String(hex || '#888888').replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function mix(a, b, t) {
    const A = Array.isArray(a) ? a : hexToRgb(a), B = Array.isArray(b) ? b : hexToRgb(b);
    return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t];
  }
  function css(rgb, alpha) {
    return `rgba(${Math.round(rgb[0])},${Math.round(rgb[1])},${Math.round(rgb[2])},${alpha == null ? 1 : alpha})`;
  }
  /** Deterministic 0..1 — the night scatter must not flicker between repaints. */
  function hash01(a, b) {
    let x = (a * 374761393 + b * 668265263) | 0;
    x = (x ^ (x >> 13)) * 1274126177;
    return ((x ^ (x >> 16)) >>> 0) / 4294967295;
  }

  /** Fill a vertical stripe that wraps. NOTHING in this tile may read y — a band
   * here is 3.7 m tall against a tile spanning 30-59 m, so it shows an arbitrary
   * horizontal SLICE whose position moves with zoom. Vertical features survive
   * that; horizontal ones appear at a different height on every building. */
  const fillC = (ctx, c, x, w, a) => {
    ctx.fillStyle = css(c, a);
    x = ((x % TILE) + TILE) % TILE;
    ctx.fillRect(x, 0, w, TILE);
    if (x + w > TILE) ctx.fillRect(x - TILE, 0, w, TILE);
  };

  /** The light at hour p, derived the way js/drag.js and js/facades.js derive it
   * so this module and the rest of the city agree about when dusk is. */
  function lightAt(p, wall) {
    const night = Math.max(0, (p - 0.55) / 0.45);
    const sunElev = (typeof window.skyBodies === 'function')
      ? window.skyBodies(p).sun.elev : (0.5 - p) * 100;
    const dark = Math.max(night, Math.min(1, Math.max(0, -sunElev / 9)));
    const golden = 1 - Math.abs(p - 0.5) / 0.5;
    let glass = mix(wall, [46, 58, 74], 0.62);
    glass = mix(glass, [255, 176, 96], golden * 0.45);
    glass = mix(glass, [12, 15, 28], dark * 0.9);
    return { night, dark, golden, glass };
  }

  let _canvas = null, _ctx = null;

  /**
   * The one image this pass registers.
   *
   * A shopfront IS continuous glass on thin mullions, so the pier minimum that
   * governs punched-window families in js/facades.js does not apply — the same
   * exemption drag.js's shopGlass and facades.js's `tg` already carry.
   *
   * And the night state is an unbroken warm ribbon, NOT a per-pane scatter. The
   * reference is the Drag after dark: a continuous run of lit shop interiors. A
   * scatter of lit panes reads as apartments, which is the exact error this
   * whole family of passes exists to fix.
   */
  function glassTile(p) {
    if (!_canvas) {
      _canvas = document.createElement('canvas');
      _canvas.width = _canvas.height = TILE;
      // willReadFrequently because this always ends in getImageData. Do NOT
      // composite a second canvas in here: drawImage into a CPU-backed context
      // took the facade atlas from 44 ms to 230 ms (js/facades.js).
      _ctx = _canvas.getContext('2d', { willReadFrequently: true });
    }
    const ctx = _ctx;
    const base = hexToRgb('#6e7a84');
    const k = lightAt(p, base);
    ctx.clearRect(0, 0, TILE, TILE);

    let glass = mix(k.glass, [0, 0, 0], T.GLASS_DARK * (1 - k.night));
    // Sky in the glass, by day only. A shopfront is the one surface in this pass
    // that is a mirror, and without it the band reads as a hole punched in the
    // building rather than as a window.
    glass = mix(glass, T.SKY, T.SKY_MIX * (1 - k.dark));
    glass = glass.map(c => Math.min(250, c * T.GAIN));
    fillC(ctx, glass, 0, TILE);
    if (k.night > 0.02) {
      const glow = mix(glass, T.NIGHT_TONE, T.NIGHT * Math.min(1, k.night * 1.35));
      fillC(ctx, glow, 0, TILE);
      // Shop to shop the interiors differ in brightness. Tenancies are ~7 m
      // apart, not 3 m, so this runs on a coarser rhythm than the mullions and
      // cannot beat against them.
      for (let b = 0; b < 6; b++) {
        if (hash01(71, b) > T.BAY_RATE) continue;
        fillC(ctx, mix(glow, [255, 240, 214], 0.30 * k.night),
              Math.round(b * TILE / 6) + 1, Math.round(TILE / 6) - 2);
      }
    }
    const mull = mix(glass, [0, 0, 0], T.MULL_DARK);
    for (let x = 0; x < TILE; x += T.MULL) fillC(ctx, mull, x, 1);

    const img = ctx.getImageData(0, 0, TILE, TILE);
    return { width: TILE, height: TILE, data: new Uint8Array(img.data.buffer.slice(0)) };
  }

  /**
   * The mean colour the glass tile is DRAWN at, for a given hour.
   *
   * This separates two questions that look identical on screen and have
   * completely different fixes: "is the tile wrong?" and "is the tile right and
   * the light doing something to it?". It re-runs the draw and reads the bytes,
   * with no map, no light and no post-process involved. Copied in spirit from
   * window.dragTileSample, which existed because a screenshot could not tell a
   * tile that had never been repainted from one that had.
   */
  window.placesTileSample = function placesTileSample(p) {
    const d = glassTile(p == null ? 0.3 : p).data;
    let r = 0, g = 0, b = 0;
    const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    r /= n; g /= n; b /= n;
    return { p, mean: [Math.round(r), Math.round(g), Math.round(b)],
             luma: +(0.30 * r + 0.59 * g + 0.11 * b).toFixed(1) };
  };

  // ── layers ──────────────────────────────────────────────────────────
  /** ['interpolate', p, wd, wg, wn] — the shape timeofday.js bakes with. */
  function bakedColor(p) {
    p = Math.max(0, Math.min(1, p));
    return ['interpolate', ['linear'], p,
      0, ['to-color', ['get', 'wd'], '#888888'],
      0.5, ['to-color', ['get', 'wg'], '#888888'],
      1, ['to-color', ['get', 'wn'], '#333344'],
    ];
  }

  let _added = false, _stats = null;

  window.initPlaces = async function initPlaces(map) {
    if (!PLACES.on || _added || map.getSource(SRC)) return;
    _added = true;

    let gj;
    try {
      const r = await fetch(DATA);
      if (!r.ok) throw new Error(DATA + ': ' + r.status);
      gj = await r.json();
    } catch (e) {
      console.warn('[places]', e.message, '- pass not drawn');
      return;
    }

    const p = (window.__todCurrentP != null) ? window.__todCurrentP : 0.3;
    try { map.addImage(GLASS_IMG, glassTile(p)); } catch (e) { /* already there */ }
    map.addSource(SRC, { type: 'geojson', data: gj, ...(window.PATTERN_TILING || {}) });

    // The anchor must be the first symbol layer AFTER the buildings, not the
    // first in the style. The basemap puts symbol layers immediately after
    // `background`, so anchoring there drops the whole pass to the BOTTOM of the
    // stack, under the ground — which is exactly what happened to the stadium.
    const stack = map.getStyle().layers;
    const after = Math.max(0, stack.findIndex(l => l.id === 'buildings-3d'));
    const anchor = (stack.slice(after + 1).find(l => l.type === 'symbol') || {}).id;

    // Bulkhead, fascia and awning in ONE layer. They are all flat colour off the
    // feature's own ramp, so splitting them would buy nothing and cost a draw
    // call per frame on 919 features. Depth testing sorts the awning in front of
    // the wall for free.
    if (!map.getLayer(L_SOLID)) {
      map.addLayer({
        id: L_SOLID, type: 'fill-extrusion', source: SRC, minzoom: PLACES.minZoom,
        filter: ['!=', ['get', 'fam'], 'plGlass'],
        paint: {
          'fill-extrusion-color': bakedColor(p),
          'fill-extrusion-height': ['get', 'h'],
          'fill-extrusion-base': ['get', 'base'],
          'fill-extrusion-opacity': PLACES.opacity,
          // OFF. The gradient darkens the BOTTOM of every extrusion and these
          // bands are 0.36 m to 1.05 m tall, so the whole band falls inside the
          // gradient and a sourced brand colour renders as a dark smear. The
          // band tones already carry the vertical hierarchy. (Same call as
          // stadium-wall and drag-wall.)
          'fill-extrusion-vertical-gradient': false,
        },
      }, anchor);
    }
    if (!map.getLayer(L_GLASS)) {
      map.addLayer({
        id: L_GLASS, type: 'fill-extrusion', source: SRC, minzoom: PLACES.minZoom,
        filter: ['==', ['get', 'fam'], 'plGlass'],
        paint: {
          'fill-extrusion-pattern': GLASS_IMG,
          'fill-extrusion-height': ['get', 'h'],
          'fill-extrusion-base': ['get', 'base'],
          'fill-extrusion-opacity': PLACES.opacity,
          'fill-extrusion-vertical-gradient': false,
        },
      }, anchor);
    }
    if (!map.getLayer(L_LABEL)) {
      map.addLayer({
        id: L_LABEL, type: 'symbol', source: SRC, minzoom: PLACES.labelMinZoom,
        filter: ['==', ['get', 'kind'], 'label'],
        layout: {
          'text-field': ['get', 'nm'],
          // ONE font, not a fallback list. MapLibre requests a fontstack as a
          // single URL — the three names above became
          // /fonts/Noto%20Sans%20Bold,Open%20Sans%20Bold,Arial%20Unicode%20MS%20Bold/0-255.pbf,
          // which OpenFreeMap 404s because it serves only Noto Sans
          // Regular/Bold/Italic. A 404 glyph is not cosmetic: MapLibre discards
          // the ENTIRE tile that needed it, which is how every building once
          // disappeared with err:0 and no console error (HANDOFF 7.12).
          'text-font': ['Noto Sans Bold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 17.3, 8.5, 18.4, 11, 19.5, 12.5],
          'text-max-width': 8,
          'text-padding': 3,
          'text-allow-overlap': false,
          'text-ignore-placement': false,
          // Within the layer, a brand whose colour is SOURCED outranks one whose
          // colour is a category guess. When 133 names compete for a screenful of
          // boxes, the ones that survive should be the ones carrying real
          // information. (Lower sort key = placed first = wins.)
          'symbol-sort-key': ['case', ['==', ['get', 'src'], 'S'], 0, 1],
          'visibility': PLACES.labels ? 'visible' : 'none',
        },
        paint: {
          // White on a halo of the shop's OWN sign colour. This is doing two
          // jobs: it is legible against anything, and it carries the brand
          // colour at the zooms where a 1 m fascia band is under a pixel and
          // the geometry alone cannot. A label that took its colour FROM the
          // sign would be invisible for every dark fascia (Urban Outfitters is
          // #1a1a1a) and unreadable for every pale one (Pluckers is #ffe525).
          'text-color': '#ffffff',
          'text-halo-color': ['to-color', ['get', 'sign'], '#333333'],
          'text-halo-width': 1.9,
          'text-halo-blur': 0.2,
          'text-opacity': 0.95,
        },
      }, map.getLayer('buildings-labels') ? 'buildings-labels' : undefined);
      // ^ THE ANCHOR ON THIS LAYER IS A COLLISION DECISION, NOT A DRAW-ORDER ONE.
      //
      // MapLibre resolves label collisions in LAYER ORDER: whatever is earlier in
      // the style wins the box and everything later is dropped. The first cut
      // added this with no anchor, which puts it last, which is the lowest
      // priority in the whole style — and it measured exactly that. Labels placed
      // at zoom 15.5: 0. At 16.4: 0. At 17.2: 18. Every shop name was losing its
      // box to `buildings-labels`' apartment-block names, and the pass looked
      // like it had a minzoom bug when it had a priority bug. Anchoring before
      // `buildings-labels` gives a business name precedence over the name of the
      // building it is inside, which is also the right answer on the merits.
    }

    const nSolid = gj.features.filter(f => f.properties.kind !== 'label'
                                        && f.properties.fam !== 'plGlass').length;
    const nGlass = gj.features.filter(f => f.properties.fam === 'plGlass').length;
    const nLabel = gj.features.filter(f => f.properties.kind === 'label').length;
    const src = new Set(), gen = new Set();
    for (const f of gj.features) {
      if (f.properties.kind !== 'label') continue;
      (f.properties.src === 'S' ? src : gen).add(f.properties.nm);
    }
    _stats = { features: gj.features.length, solid: nSolid, glass: nGlass,
               labels: nLabel, shopfronts: nLabel,
               sourcedColour: src.size, generativeColour: gen.size, images: 1 };
    console.log('[places]', _stats.shopfronts, 'shopfronts,', _stats.features,
                'features (', nSolid, 'solid /', nGlass, 'glass /', nLabel,
                'labels ), 1 image,', src.size, 'brands with a sourced colour,',
                gen.size, 'generative');
  };

  window.placesStats = () => _stats;

  window.applyPlacesColors = function applyPlacesColors(map, p) {
    if (!map || !map.getLayer) return;
    try {
      if (map.hasImage && map.hasImage(GLASS_IMG)) map.updateImage(GLASS_IMG, glassTile(p));
      else map.addImage(GLASS_IMG, glassTile(p));
    } catch (e) { /* not registered yet */ }
    try {
      if (map.getLayer(L_SOLID))
        map.setPaintProperty(L_SOLID, 'fill-extrusion-color', bakedColor(p));
    } catch (e) {}
  };

  /** Re-read PLACES after a live edit. */
  window.applyPlacesSettings = function applyPlacesSettings(map) {
    if (!map || !map.getLayer) return;
    for (const id of [L_SOLID, L_GLASS]) {
      if (!map.getLayer(id)) continue;
      try {
        map.setLayoutProperty(id, 'visibility', PLACES.on ? 'visible' : 'none');
        map.setPaintProperty(id, 'fill-extrusion-opacity', PLACES.opacity);
      } catch (e) {}
    }
    if (map.getLayer(L_LABEL)) {
      try {
        map.setLayoutProperty(L_LABEL, 'visibility',
                              (PLACES.on && PLACES.labels) ? 'visible' : 'none');
      } catch (e) {}
    }
  };

  // ── bootstrap ───────────────────────────────────────────────────────
  // js/app.js is owned by another pass and will not call us. Copied from the
  // boot() at the bottom of js/outer.js by way of js/drag.js, including the
  // applyTimeOfDay wrap — installed here, after every module has loaded, so
  // script order cannot break it.
  function boot() {
    const map = window.__map;
    if (!map) return setTimeout(boot, 60);

    const hookTod = () => {
      if (typeof window.applyTimeOfDay !== 'function' || window.applyTimeOfDay.__places) return;
      const prev = window.applyTimeOfDay;
      const wrapped = function (m, p, force) {
        const r = prev.apply(this, arguments);
        try { window.applyPlacesColors(m, p); } catch (e) {}
        return r;
      };
      wrapped.__places = true;
      window.applyTimeOfDay = wrapped;
      // ALSO a global, not only a property on the wrapper: several passes wrap
      // this same function and whichever boots last owns the outermost closure,
      // so `window.applyTimeOfDay.__places` reads false for every pass except
      // that one even though all of them are being called. drag.js shipped a
      // check written against the property that read "the pass never hooked
      // time-of-day" while the pass was demonstrably going dark at night.
      window.__placesTodHooked = true;
    };

    const go = () => {
      // Wait for the core buildings. A shopfront slab added before the wall it
      // stands in front of exists is invisible from every angle except directly
      // overhead, and the anchor search below depends on `buildings-3d` being
      // in the style already.
      if (!map.getLayer('buildings-3d')) return setTimeout(go, 120);
      hookTod();
      window.initPlaces(map);
    };
    if (map.isStyleLoaded && map.isStyleLoaded()) go();
    else map.once('load', () => setTimeout(go, 0));
  }
  boot();
})();
